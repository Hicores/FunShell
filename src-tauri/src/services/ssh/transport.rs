use std::{
    borrow::Cow,
    collections::HashSet,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, ReadBuf},
    net::TcpStream,
    time::timeout,
};
use tokio_socks::tcp::Socks5Stream;

use crate::{
    domain::{ConnectionProfile, ProxyKind, ProxyProfile, RouteCandidate, RouteKind},
    error::{AppError, AppResult},
    persistence::Database,
    security::VaultService,
    services::ssh::{auth::authenticate, client::ClientHandler},
};

pub trait AsyncStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T> AsyncStream for T where T: AsyncRead + AsyncWrite + Unpin + Send {}
pub type BoxedStream = Box<dyn AsyncStream>;

pub async fn connect_for_profile(
    profile: &ConnectionProfile,
    database: &Database,
    vault: &VaultService,
) -> AppResult<BoxedStream> {
    let chain = HashSet::from([profile.id.clone()]);
    let candidate = select_candidate(profile, database, vault, &chain, true).await?;
    connect_candidate(profile, candidate.as_ref(), database, vault, &chain).await
}

async fn select_candidate(
    profile: &ConnectionProfile,
    database: &Database,
    vault: &VaultService,
    chain: &HashSet<String>,
    allow_jump: bool,
) -> AppResult<Option<RouteCandidate>> {
    let Some(route_id) = profile.route_id.as_deref() else {
        return Ok(None);
    };
    let route = database
        .list_routes()?
        .into_iter()
        .find(|route| route.id == route_id)
        .ok_or_else(|| AppError::Validation("连接引用的路由不存在".into()))?;
    let enabled: Vec<_> = route
        .candidates
        .into_iter()
        .filter(|candidate| candidate.enabled)
        .collect();
    if enabled.is_empty() {
        return Err(AppError::Validation("路由没有启用的候选路线".into()));
    }
    if !route.auto_select {
        let selected = enabled
            .into_iter()
            .find(|candidate| Some(&candidate.id) == route.fixed_candidate_id.as_ref())
            .ok_or_else(|| AppError::Validation("固定路由候选不存在".into()));
        return selected.and_then(|candidate| {
            if candidate.kind == RouteKind::JumpHost && !allow_jump {
                Err(AppError::Validation(
                    "跳板连接自身只能使用直连或代理路线".into(),
                ))
            } else {
                Ok(Some(candidate))
            }
        });
    }

    let mut measured = Vec::new();
    for candidate in enabled.iter().cloned() {
        if candidate.kind == RouteKind::JumpHost && !allow_jump {
            continue;
        }
        let mut samples = Vec::new();
        for _ in 0..3 {
            let started = std::time::Instant::now();
            if probe_candidate(profile, &candidate, database, vault, chain)
                .await
                .is_ok()
            {
                samples.push(started.elapsed());
            }
        }
        if let Some(median) = median_duration(samples) {
            measured.push((median, candidate));
        }
    }
    measured.sort_by_key(|(duration, _)| *duration);
    measured
        .into_iter()
        .next()
        .map(|(_, candidate)| Some(candidate))
        .ok_or_else(|| {
            if !allow_jump
                && enabled
                    .iter()
                    .all(|candidate| candidate.kind == RouteKind::JumpHost)
            {
                AppError::Validation("跳板连接自身只能使用直连或代理路线".into())
            } else {
                AppError::Message("所有连接路线均不可用".into())
            }
        })
}

async fn probe_candidate(
    profile: &ConnectionProfile,
    candidate: &RouteCandidate,
    database: &Database,
    vault: &VaultService,
    chain: &HashSet<String>,
) -> AppResult<()> {
    let mut stream = connect_candidate(profile, Some(candidate), database, vault, chain).await?;
    let duration = Duration::from_secs(profile.connect_timeout_seconds.max(1) as u64);
    timeout(duration, async {
        let mut line = Vec::with_capacity(128);
        let mut byte = [0_u8; 1];
        while line.len() < 8192 {
            stream.read_exact(&mut byte).await?;
            line.push(byte[0]);
            if byte[0] == b'\n' {
                if line.starts_with(b"SSH-") {
                    return Ok(());
                }
                line.clear();
            }
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "SSH banner missing",
        ))
    })
    .await
    .map_err(|_| AppError::Message("SSH banner 探测超时".into()))??;
    Ok(())
}

async fn connect_candidate(
    profile: &ConnectionProfile,
    candidate: Option<&RouteCandidate>,
    database: &Database,
    vault: &VaultService,
    chain: &HashSet<String>,
) -> AppResult<BoxedStream> {
    let duration = Duration::from_secs(profile.connect_timeout_seconds.max(1) as u64);
    match candidate.map(|candidate| &candidate.kind) {
        None | Some(RouteKind::Direct) => {
            let stream = timeout(duration, TcpStream::connect((&*profile.host, profile.port)))
                .await
                .map_err(|_| AppError::Message("连接服务器超时".into()))??;
            stream.set_nodelay(true)?;
            Ok(Box::new(stream))
        }
        Some(RouteKind::Proxy) => {
            let proxy_id = candidate
                .and_then(|candidate| candidate.proxy_id.as_deref())
                .ok_or_else(|| AppError::Validation("代理路线没有指定代理".into()))?;
            let proxy = database
                .list_proxies()?
                .into_iter()
                .find(|proxy| proxy.id == proxy_id)
                .ok_or_else(|| AppError::Validation("代理路线引用的代理不存在".into()))?;
            connect_proxy(profile, &proxy, vault, duration).await
        }
        Some(RouteKind::JumpHost) => {
            let jump_id = candidate
                .and_then(|candidate| candidate.jump_connection_id.as_deref())
                .ok_or_else(|| AppError::Validation("跳板路线没有指定连接".into()))?;
            connect_jump(profile, jump_id, database, vault, chain).await
        }
    }
}

async fn connect_jump(
    target: &ConnectionProfile,
    jump_id: &str,
    database: &Database,
    vault: &VaultService,
    chain: &HashSet<String>,
) -> AppResult<BoxedStream> {
    ensure_jump_not_cyclic(chain, jump_id)?;
    let jump = database
        .connection_by_id(jump_id)?
        .filter(|profile| !profile.deleted)
        .ok_or_else(|| AppError::Validation("跳板连接不存在或已删除".into()))?;
    let mut jump_chain = chain.clone();
    jump_chain.insert(jump.id.clone());
    let jump_candidate =
        Box::pin(select_candidate(&jump, database, vault, &jump_chain, false)).await?;
    let stream = Box::pin(connect_candidate(
        &jump,
        jump_candidate.as_ref(),
        database,
        vault,
        &jump_chain,
    ))
    .await?;
    let config = client_config(&jump);
    let (forwarded_sender, _forwarded_receiver) = tokio::sync::mpsc::unbounded_channel();
    let handler = ClientHandler::new(
        database.clone(),
        jump.host.clone(),
        jump.port,
        forwarded_sender,
    );
    let mut handle = russh::client::connect_stream(Arc::new(config), stream, handler).await?;
    authenticate(&mut handle, &jump, database, vault).await?;
    let channel = handle
        .channel_open_direct_tcpip(&target.host, u32::from(target.port), "127.0.0.1", 0)
        .await?;
    Ok(Box::new(JumpStream {
        stream: channel.into_stream(),
        _handle: handle,
    }))
}

fn median_duration(mut samples: Vec<Duration>) -> Option<Duration> {
    samples.sort();
    samples.get(samples.len() / 2).copied()
}

fn ensure_jump_not_cyclic(chain: &HashSet<String>, jump_id: &str) -> AppResult<()> {
    if chain.contains(jump_id) {
        Err(AppError::Validation("SSH 跳板连接存在循环引用".into()))
    } else {
        Ok(())
    }
}

pub fn client_config(profile: &ConnectionProfile) -> russh::client::Config {
    let mut config = russh::client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(Duration::from_secs(profile.keepalive_seconds.max(5) as u64)),
        keepalive_max: 3,
        nodelay: true,
        window_size: 16 * 1024 * 1024,
        channel_buffer_size: 512,
        ..Default::default()
    };
    config.preferred.compression = if profile.compression {
        Cow::Owned(vec![
            russh::compression::ZLIB,
            russh::compression::ZLIB_LEGACY,
            russh::compression::NONE,
        ])
    } else {
        Cow::Owned(vec![russh::compression::NONE])
    };
    config
}

struct JumpStream {
    stream: russh::ChannelStream<russh::client::Msg>,
    _handle: russh::client::Handle<ClientHandler>,
}

impl AsyncRead for JumpStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stream).poll_read(context, buffer)
    }
}

impl AsyncWrite for JumpStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        Pin::new(&mut self.stream).poll_write(context, buffer)
    }

    fn poll_flush(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stream).poll_flush(context)
    }

    fn poll_shutdown(
        mut self: Pin<&mut Self>,
        context: &mut Context<'_>,
    ) -> Poll<std::io::Result<()>> {
        Pin::new(&mut self.stream).poll_shutdown(context)
    }
}

async fn connect_proxy(
    profile: &ConnectionProfile,
    proxy: &ProxyProfile,
    vault: &VaultService,
    duration: Duration,
) -> AppResult<BoxedStream> {
    let password = match proxy.secret_id.as_deref() {
        Some(id) => Some(
            String::from_utf8(vault.reveal(id)?.to_vec())
                .map_err(|_| AppError::Validation("代理密码不是有效 UTF-8".into()))?,
        ),
        None => None,
    };
    match proxy.kind {
        ProxyKind::Socks5 => {
            let target = (profile.host.as_str(), profile.port);
            let proxy_addr = (proxy.host.as_str(), proxy.port);
            let stream = if let (Some(username), Some(password)) = (&proxy.username, password) {
                timeout(
                    duration,
                    Socks5Stream::connect_with_password(proxy_addr, target, username, &password),
                )
                .await
                .map_err(|_| AppError::Message("SOCKS5 代理连接超时".into()))?
                .map_err(|error| AppError::Message(format!("SOCKS5 代理失败: {error}")))?
            } else {
                timeout(duration, Socks5Stream::connect(proxy_addr, target))
                    .await
                    .map_err(|_| AppError::Message("SOCKS5 代理连接超时".into()))?
                    .map_err(|error| AppError::Message(format!("SOCKS5 代理失败: {error}")))?
            };
            Ok(Box::new(stream))
        }
        ProxyKind::HttpConnect => {
            let mut stream = timeout(
                duration,
                TcpStream::connect((proxy.host.as_str(), proxy.port)),
            )
            .await
            .map_err(|_| AppError::Message("HTTP 代理连接超时".into()))??;
            let authorization = match (&proxy.username, password) {
                (Some(username), Some(password)) => format!(
                    "Proxy-Authorization: Basic {}\r\n",
                    STANDARD.encode(format!("{username}:{password}"))
                ),
                _ => String::new(),
            };
            let request = format!(
                "CONNECT {}:{} HTTP/1.1\r\nHost: {}:{}\r\n{}Proxy-Connection: Keep-Alive\r\n\r\n",
                profile.host, profile.port, profile.host, profile.port, authorization
            );
            stream.write_all(request.as_bytes()).await?;
            let mut response = Vec::with_capacity(1024);
            let mut byte = [0_u8; 1];
            while response.len() < 8192 {
                stream.read_exact(&mut byte).await?;
                response.push(byte[0]);
                if response.ends_with(b"\r\n\r\n") {
                    break;
                }
            }
            let status = String::from_utf8_lossy(&response);
            let first_line = status.lines().next().unwrap_or_default();
            if !first_line.contains(" 200 ") {
                return Err(AppError::Message(format!(
                    "HTTP CONNECT 失败: {first_line}"
                )));
            }
            Ok(Box::new(stream))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, time::Duration};

    use crate::domain::{AuthMethod, ConnectionProfile};

    use super::{client_config, ensure_jump_not_cyclic, median_duration};

    fn profile(compression: bool) -> ConnectionProfile {
        ConnectionProfile {
            id: "target".into(),
            folder_id: None,
            name: "Target".into(),
            host: "127.0.0.1".into(),
            port: 22,
            username: "root".into(),
            auth_method: AuthMethod::Password,
            secret_id: None,
            key_id: None,
            route_id: None,
            startup_command: None,
            keepalive_seconds: 30,
            connect_timeout_seconds: 10,
            compression,
            auto_reconnect: true,
            max_reconnect_attempts: 0,
            sort_order: 0,
            deleted: false,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn chooses_median_route_sample() {
        assert_eq!(
            median_duration(vec![
                Duration::from_millis(90),
                Duration::from_millis(12),
                Duration::from_millis(35),
            ]),
            Some(Duration::from_millis(35))
        );
    }

    #[test]
    fn blocks_jump_reference_cycles() {
        let chain = HashSet::from(["target".to_owned(), "jump-a".to_owned()]);
        assert!(ensure_jump_not_cyclic(&chain, "jump-a").is_err());
        assert!(ensure_jump_not_cyclic(&chain, "jump-b").is_ok());
    }

    #[test]
    fn applies_compression_preference() {
        let enabled = client_config(&profile(true));
        let disabled = client_config(&profile(false));
        assert_eq!(enabled.preferred.compression[0], russh::compression::ZLIB);
        assert_eq!(enabled.window_size, 16 * 1024 * 1024);
        assert_eq!(enabled.channel_buffer_size, 512);
        assert_eq!(
            disabled.preferred.compression.as_ref(),
            [russh::compression::NONE]
        );
    }
}

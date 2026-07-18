use std::time::Duration;

use base64::{Engine, engine::general_purpose::STANDARD};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};
use tokio_socks::tcp::Socks5Stream;

use crate::{
    domain::{ConnectionProfile, ProxyKind, ProxyProfile, RouteCandidate, RouteKind},
    error::{AppError, AppResult},
    persistence::Database,
    security::VaultService,
};

pub trait AsyncStream: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T> AsyncStream for T where T: AsyncRead + AsyncWrite + Unpin + Send {}
pub type BoxedStream = Box<dyn AsyncStream>;

pub async fn connect_for_profile(
    profile: &ConnectionProfile,
    database: &Database,
    vault: &VaultService,
) -> AppResult<BoxedStream> {
    let candidate = select_candidate(profile, database, vault).await?;
    connect_candidate(profile, candidate.as_ref(), database, vault).await
}

async fn select_candidate(
    profile: &ConnectionProfile,
    database: &Database,
    vault: &VaultService,
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
        return enabled
            .into_iter()
            .find(|candidate| Some(&candidate.id) == route.fixed_candidate_id.as_ref())
            .map(Some)
            .ok_or_else(|| AppError::Validation("固定路由候选不存在".into()));
    }

    let mut measured = Vec::new();
    for candidate in enabled {
        if candidate.kind == RouteKind::JumpHost {
            continue;
        }
        let mut samples = Vec::new();
        for _ in 0..3 {
            let started = std::time::Instant::now();
            if connect_candidate(profile, Some(&candidate), database, vault)
                .await
                .is_ok()
            {
                samples.push(started.elapsed());
            }
        }
        if !samples.is_empty() {
            samples.sort();
            measured.push((samples[samples.len() / 2], candidate));
        }
    }
    measured.sort_by_key(|(duration, _)| *duration);
    measured
        .into_iter()
        .next()
        .map(|(_, candidate)| Some(candidate))
        .ok_or_else(|| AppError::Message("所有连接路线均不可用".into()))
}

async fn connect_candidate(
    profile: &ConnectionProfile,
    candidate: Option<&RouteCandidate>,
    database: &Database,
    vault: &VaultService,
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
        Some(RouteKind::JumpHost) => Err(AppError::Validation(
            "SSH 跳板路线需要由会话转发层建立".into(),
        )),
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

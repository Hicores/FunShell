use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};

use dashmap::DashMap;
use russh::client::Handle;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;

use crate::{
    domain::{TunnelKind, TunnelProfile, TunnelRuntime, TunnelState},
    error::{AppError, AppResult},
    services::ssh::{SessionManager, client::ClientHandler},
};

struct TunnelStats {
    connections: AtomicU64,
    uploaded: AtomicU64,
    downloaded: AtomicU64,
}

struct ActiveTunnel {
    profile: TunnelProfile,
    session_id: String,
    bound_port: u16,
    cancel: CancellationToken,
    stats: Arc<TunnelStats>,
}

pub struct TunnelManager {
    active: DashMap<String, Arc<ActiveTunnel>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            active: DashMap::new(),
        }
    }

    pub async fn start(
        &self,
        profile: TunnelProfile,
        session_id: String,
        sessions: &SessionManager,
    ) -> AppResult<TunnelRuntime> {
        if let Some(existing) = self.active.get(&profile.id) {
            return Ok(runtime(&existing));
        }
        let cancel = CancellationToken::new();
        let stats = Arc::new(TunnelStats {
            connections: AtomicU64::new(0),
            uploaded: AtomicU64::new(0),
            downloaded: AtomicU64::new(0),
        });
        let bound_port = match profile.kind {
            TunnelKind::Local | TunnelKind::Dynamic => {
                let listener = TcpListener::bind((profile.bind_host.as_str(), profile.bind_port))
                    .await
                    .map_err(|error| AppError::Message(format!("隧道监听失败: {error}")))?;
                let bound_port = listener.local_addr()?.port();
                let handle = sessions.handle(&session_id)?;
                let target = match profile.kind {
                    TunnelKind::Local => Some((
                        profile
                            .target_host
                            .clone()
                            .ok_or_else(|| AppError::Validation("本地转发缺少目标主机".into()))?,
                        profile
                            .target_port
                            .ok_or_else(|| AppError::Validation("本地转发缺少目标端口".into()))?,
                    )),
                    TunnelKind::Dynamic => None,
                    TunnelKind::Remote => unreachable!(),
                };
                spawn_listener(
                    listener,
                    profile.kind.clone(),
                    target,
                    handle,
                    cancel.clone(),
                    stats.clone(),
                );
                bound_port
            }
            TunnelKind::Remote => {
                let target_host = profile
                    .target_host
                    .as_deref()
                    .ok_or_else(|| AppError::Validation("远端转发缺少目标主机".into()))?;
                let target_port = profile
                    .target_port
                    .ok_or_else(|| AppError::Validation("远端转发缺少目标端口".into()))?;
                sessions
                    .start_remote_forward(
                        &session_id,
                        &profile.bind_host,
                        profile.bind_port,
                        target_host,
                        target_port,
                    )
                    .await?
            }
        };
        let active = Arc::new(ActiveTunnel {
            profile: profile.clone(),
            session_id,
            bound_port,
            cancel,
            stats,
        });
        let result = runtime(&active);
        self.active.insert(profile.id, active);
        Ok(result)
    }

    pub async fn stop(&self, profile_id: &str, sessions: &SessionManager) -> AppResult<()> {
        let Some((_, active)) = self.active.remove(profile_id) else {
            return Ok(());
        };
        active.cancel.cancel();
        if active.profile.kind == TunnelKind::Remote {
            sessions
                .stop_remote_forward(
                    &active.session_id,
                    &active.profile.bind_host,
                    active.bound_port,
                )
                .await?;
        }
        Ok(())
    }

    pub fn statuses(&self) -> Vec<TunnelRuntime> {
        self.active
            .iter()
            .map(|entry| runtime(entry.value()))
            .collect()
    }
}

fn runtime(active: &ActiveTunnel) -> TunnelRuntime {
    TunnelRuntime {
        profile_id: active.profile.id.clone(),
        session_id: active.session_id.clone(),
        state: TunnelState::Running,
        bound_port: active.bound_port,
        connections: active.stats.connections.load(Ordering::Relaxed),
        uploaded_bytes: active.stats.uploaded.load(Ordering::Relaxed),
        downloaded_bytes: active.stats.downloaded.load(Ordering::Relaxed),
        error: None,
    }
}

fn spawn_listener(
    listener: TcpListener,
    kind: TunnelKind,
    target: Option<(String, u16)>,
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    cancel: CancellationToken,
    stats: Arc<TunnelStats>,
) {
    tokio::spawn(async move {
        loop {
            let accepted = tokio::select! {
                _ = cancel.cancelled() => break,
                accepted = listener.accept() => accepted,
            };
            let Ok((stream, peer)) = accepted else { break };
            let handle = handle.clone();
            let stats = stats.clone();
            let target = target.clone();
            let kind = kind.clone();
            tokio::spawn(async move {
                let result = match kind {
                    TunnelKind::Local => {
                        let (host, port) = target.expect("local tunnel target");
                        forward_stream(
                            stream,
                            handle,
                            &host,
                            port,
                            &peer.ip().to_string(),
                            peer.port(),
                            &stats,
                        )
                        .await
                    }
                    TunnelKind::Dynamic => dynamic_stream(stream, handle, &stats).await,
                    TunnelKind::Remote => Ok(()),
                };
                if result.is_ok() {
                    stats.connections.fetch_add(1, Ordering::Relaxed);
                }
            });
        }
    });
}

async fn dynamic_stream(
    mut local: TcpStream,
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    stats: &TunnelStats,
) -> AppResult<()> {
    let mut greeting = [0_u8; 2];
    local.read_exact(&mut greeting).await?;
    if greeting[0] != 5 {
        return Err(AppError::Message("SOCKS 客户端版本不受支持".into()));
    }
    let mut methods = vec![0_u8; greeting[1] as usize];
    local.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        local.write_all(&[5, 0xff]).await?;
        return Err(AppError::Message("动态隧道仅支持无认证 SOCKS5".into()));
    }
    local.write_all(&[5, 0]).await?;
    let mut request = [0_u8; 4];
    local.read_exact(&mut request).await?;
    if request[0] != 5 || request[1] != 1 {
        local.write_all(&[5, 7, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
        return Err(AppError::Message("动态隧道仅支持 CONNECT".into()));
    }
    let host = match request[3] {
        1 => {
            let mut address = [0_u8; 4];
            local.read_exact(&mut address).await?;
            std::net::Ipv4Addr::from(address).to_string()
        }
        3 => {
            let length = local.read_u8().await? as usize;
            let mut address = vec![0_u8; length];
            local.read_exact(&mut address).await?;
            String::from_utf8(address)
                .map_err(|_| AppError::Validation("SOCKS 域名编码无效".into()))?
        }
        4 => {
            let mut address = [0_u8; 16];
            local.read_exact(&mut address).await?;
            std::net::Ipv6Addr::from(address).to_string()
        }
        _ => return Err(AppError::Message("SOCKS 地址类型不受支持".into())),
    };
    let port = local.read_u16().await?;
    local.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await?;
    let peer = local.peer_addr()?;
    forward_stream(
        local,
        handle,
        &host,
        port,
        &peer.ip().to_string(),
        peer.port(),
        stats,
    )
    .await
}

async fn forward_stream(
    mut local: TcpStream,
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    host: &str,
    port: u16,
    origin_host: &str,
    origin_port: u16,
    stats: &TunnelStats,
) -> AppResult<()> {
    let channel = handle
        .lock()
        .await
        .channel_open_direct_tcpip(host, u32::from(port), origin_host, u32::from(origin_port))
        .await?;
    let mut remote = channel.into_stream();
    let (uploaded, downloaded) = tokio::io::copy_bidirectional(&mut local, &mut remote).await?;
    stats.uploaded.fetch_add(uploaded, Ordering::Relaxed);
    stats.downloaded.fetch_add(downloaded, Ordering::Relaxed);
    Ok(())
}

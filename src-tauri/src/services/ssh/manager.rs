use std::sync::Arc;

use base64::{Engine, engine::general_purpose::STANDARD};
use dashmap::DashMap;
use russh::{ChannelMsg, Disconnect, client::Handle};
use tauri::{AppHandle, Emitter};
use tokio::{
    net::TcpStream,
    sync::{Mutex, mpsc},
};
use uuid::Uuid;

use crate::{
    domain::{
        ConnectionProfile, ExecResult, SessionDescriptor, SessionStatus, SessionStatusEvent,
        TerminalOutputEvent,
    },
    error::{AppError, AppResult},
    persistence::Database,
    security::VaultService,
    services::ssh::{
        auth::authenticate,
        client::{ClientHandler, ForwardedChannel},
        files::{PipelinedSftpReader, open_pipelined_reader, open_sftp},
        transport::{client_config, connect_for_profile},
    },
};

enum TerminalCommand {
    Data(Vec<u8>),
    Resize { columns: u32, rows: u32 },
    Close,
}

pub struct ManagedSession {
    pub profile: ConnectionProfile,
    handle: Arc<Mutex<Handle<ClientHandler>>>,
    terminal: mpsc::Sender<TerminalCommand>,
    remote_routes: Arc<DashMap<(String, u32), (String, u16)>>,
}

pub struct SessionManager {
    sessions: DashMap<String, Arc<ManagedSession>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }

    pub async fn connect(
        &self,
        app: AppHandle,
        requested_session_id: Option<String>,
        profile: ConnectionProfile,
        database: Database,
        vault: &VaultService,
        terminal_size: (u32, u32),
    ) -> AppResult<SessionDescriptor> {
        let (columns, rows) = terminal_size;
        let session_id = requested_session_id.unwrap_or_else(|| Uuid::new_v4().to_string());
        if self.sessions.contains_key(&session_id) {
            return Err(AppError::Validation("会话标识已存在".into()));
        }
        let stream = connect_for_profile(&profile, &database, vault).await?;
        let config = client_config(&profile);
        let (forwarded_sender, mut forwarded_receiver) =
            mpsc::unbounded_channel::<ForwardedChannel>();
        let handler = ClientHandler::new(
            database.clone(),
            profile.host.clone(),
            profile.port,
            forwarded_sender,
        );
        let mut handle = russh::client::connect_stream(Arc::new(config), stream, handler).await?;
        authenticate(&mut handle, &profile, &database, vault).await?;

        let mut channel = handle.channel_open_session().await?;
        channel
            .request_pty(false, "xterm-256color", columns, rows, 0, 0, &[])
            .await?;
        channel.request_shell(true).await?;
        if let Some(command) = profile.startup_command.as_deref() {
            channel.data(format!("{command}\n").as_bytes()).await?;
        }

        let remote_routes = Arc::new(DashMap::<(String, u32), (String, u16)>::new());
        let forwarded_routes = remote_routes.clone();
        tokio::spawn(async move {
            while let Some(forwarded) = forwarded_receiver.recv().await {
                let target = forwarded_routes
                    .get(&(
                        forwarded.connected_address.clone(),
                        forwarded.connected_port,
                    ))
                    .or_else(|| {
                        forwarded_routes.get(&("0.0.0.0".to_owned(), forwarded.connected_port))
                    })
                    .map(|entry| entry.value().clone());
                if let Some((host, port)) = target {
                    tokio::spawn(async move {
                        if let Ok(mut local) = TcpStream::connect((host.as_str(), port)).await {
                            let mut remote = forwarded.channel.into_stream();
                            let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
                        }
                    });
                }
            }
        });
        let (sender, mut receiver) = mpsc::channel::<TerminalCommand>(256);
        let event_session_id = session_id.clone();
        let event_app = app.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    command = receiver.recv() => match command {
                        Some(TerminalCommand::Data(data)) => {
                            if channel.data(&data[..]).await.is_err() { break; }
                        }
                        Some(TerminalCommand::Resize { columns, rows }) => {
                            if channel.window_change(columns, rows, 0, 0).await.is_err() { break; }
                        }
                        Some(TerminalCommand::Close) | None => {
                            let _ = channel.close().await;
                            break;
                        }
                    },
                    message = channel.wait() => match message {
                        Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                            let _ = event_app.emit("terminal-output", TerminalOutputEvent {
                                session_id: event_session_id.clone(),
                                data_base64: STANDARD.encode(data),
                            });
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                        _ => {}
                    }
                }
            }
            let _ = event_app.emit(
                "session-status",
                SessionStatusEvent {
                    session_id: event_session_id,
                    state: SessionStatus::Disconnected,
                    message: None,
                },
            );
        });

        self.sessions.insert(
            session_id.clone(),
            Arc::new(ManagedSession {
                profile: profile.clone(),
                handle: Arc::new(Mutex::new(handle)),
                terminal: sender,
                remote_routes,
            }),
        );
        Ok(SessionDescriptor {
            id: session_id,
            connection_id: profile.id,
            title: profile.name,
            state: SessionStatus::Connected,
        })
    }

    pub async fn disconnect(&self, session_id: &str) -> AppResult<()> {
        let Some((_, session)) = self.sessions.remove(session_id) else {
            return Ok(());
        };
        let _ = session.terminal.send(TerminalCommand::Close).await;
        session
            .handle
            .lock()
            .await
            .disconnect(
                Disconnect::ByApplication,
                "FunShell session closed",
                "zh-CN",
            )
            .await?;
        Ok(())
    }

    pub async fn input(&self, session_id: &str, data: Vec<u8>) -> AppResult<()> {
        self.get(session_id)?
            .terminal
            .send(TerminalCommand::Data(data))
            .await
            .map_err(|_| AppError::Message("终端会话已关闭".into()))
    }

    pub async fn resize(&self, session_id: &str, columns: u32, rows: u32) -> AppResult<()> {
        self.get(session_id)?
            .terminal
            .send(TerminalCommand::Resize { columns, rows })
            .await
            .map_err(|_| AppError::Message("终端会话已关闭".into()))
    }

    pub async fn execute(&self, session_id: &str, command: &str) -> AppResult<ExecResult> {
        let session = self.get(session_id)?;
        let handle = session.handle.lock().await;
        let mut channel = handle.channel_open_session().await?;
        channel.exec(true, command).await?;
        drop(handle);
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_status = None;
        while let Some(message) = channel.wait().await {
            match message {
                ChannelMsg::Data { data } => stdout.extend_from_slice(&data),
                ChannelMsg::ExtendedData { data, .. } => stderr.extend_from_slice(&data),
                ChannelMsg::ExitStatus {
                    exit_status: status,
                } => exit_status = Some(status),
                ChannelMsg::Eof | ChannelMsg::Close => break,
                _ => {}
            }
        }
        Ok(ExecResult {
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            exit_status,
        })
    }

    pub async fn sftp(&self, session_id: &str) -> AppResult<russh_sftp::client::SftpSession> {
        let session = self.get(session_id)?;
        open_sftp(&session.handle).await
    }

    pub async fn download_reader(
        &self,
        session_id: &str,
        remote_path: String,
    ) -> AppResult<PipelinedSftpReader> {
        let session = self.get(session_id)?;
        open_pipelined_reader(&session.handle, remote_path).await
    }

    pub fn profile(&self, session_id: &str) -> AppResult<ConnectionProfile> {
        Ok(self.get(session_id)?.profile.clone())
    }

    pub async fn start_remote_forward(
        &self,
        session_id: &str,
        bind_host: &str,
        bind_port: u16,
        target_host: &str,
        target_port: u16,
    ) -> AppResult<u16> {
        let session = self.get(session_id)?;
        let handle = session.handle.lock().await;
        let assigned = handle
            .tcpip_forward(bind_host, u32::from(bind_port))
            .await?;
        let actual = if bind_port == 0 {
            assigned as u16
        } else {
            bind_port
        };
        session.remote_routes.insert(
            (bind_host.to_owned(), u32::from(actual)),
            (target_host.to_owned(), target_port),
        );
        Ok(actual)
    }

    pub async fn stop_remote_forward(
        &self,
        session_id: &str,
        bind_host: &str,
        bind_port: u16,
    ) -> AppResult<()> {
        let session = self.get(session_id)?;
        session
            .handle
            .lock()
            .await
            .cancel_tcpip_forward(bind_host, u32::from(bind_port))
            .await?;
        session
            .remote_routes
            .remove(&(bind_host.to_owned(), u32::from(bind_port)));
        Ok(())
    }

    pub(crate) fn handle(&self, session_id: &str) -> AppResult<Arc<Mutex<Handle<ClientHandler>>>> {
        Ok(self.get(session_id)?.handle.clone())
    }

    fn get(&self, session_id: &str) -> AppResult<Arc<ManagedSession>> {
        self.sessions
            .get(session_id)
            .map(|entry| entry.value().clone())
            .ok_or_else(|| AppError::Message("SSH 会话不存在或已关闭".into()))
    }
}

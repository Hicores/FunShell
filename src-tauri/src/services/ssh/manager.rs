use std::sync::Arc;

use base64::{Engine, engine::general_purpose::STANDARD};
use dashmap::DashMap;
use russh::{ChannelMsg, Disconnect, client::Handle};
use tauri::{AppHandle, Emitter};
use tokio::{
    net::TcpStream,
    sync::{Mutex, mpsc},
};
use tokio_util::sync::CancellationToken;
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
        sudo::{
            SFTP_SERVER_DISCOVERY_SCRIPT, SFTP_SERVER_MISSING_MARKER, SUDO_PROMPT_MARKER,
            SUDO_SUCCESS_MARKER, SudoContext, SudoCredential, configured_sudo_password,
            password_probe_command, passwordless_probe_command,
        },
        transport::{client_config, connect_for_profile},
    },
};

const MAX_EXEC_OUTPUT_BYTES: usize = 32 * 1024 * 1024;

enum TerminalCommand {
    Data(Vec<u8>),
    Resize { columns: u32, rows: u32 },
    Close,
}

pub struct ManagedSession {
    pub profile: ConnectionProfile,
    terminal_handle: Arc<Mutex<Handle<ClientHandler>>>,
    monitor_handle: Arc<Mutex<Handle<ClientHandler>>>,
    file_handle: Arc<Mutex<Handle<ClientHandler>>>,
    sudo: Option<SudoContext>,
    terminal: mpsc::Sender<TerminalCommand>,
    remote_routes: Arc<DashMap<(String, u32), (String, u16)>>,
    lifecycle: CancellationToken,
}

pub struct SessionManager {
    sessions: Arc<DashMap<String, Arc<ManagedSession>>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
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
        let (forwarded_sender, mut forwarded_receiver) =
            mpsc::unbounded_channel::<ForwardedChannel>();
        let terminal_handle = Arc::new(Mutex::new(
            connect_authenticated_handle(&profile, &database, vault, forwarded_sender).await?,
        ));
        let mut channel = terminal_handle.lock().await.channel_open_session().await?;
        channel
            .request_pty(false, "xterm-256color", columns, rows, 0, 0, &[])
            .await?;
        channel.request_shell(true).await?;

        let mut handles = vec![terminal_handle.clone()];
        for _ in 0..auxiliary_connection_count(profile.multi_connection_mode) {
            match connect_auxiliary_handle(&profile, &database, vault).await {
                Ok(handle) => handles.push(handle),
                Err(error) => {
                    let _ = channel.close().await;
                    let _ =
                        disconnect_handles(&handles, "FunShell auxiliary connection failed").await;
                    return Err(error);
                }
            }
        }
        let monitor_handle = handles.get(1).unwrap_or(&terminal_handle).clone();
        let file_handle = handles.get(2).unwrap_or(&terminal_handle).clone();
        let sudo = if profile.use_sudo {
            match prepare_sudo_context(&profile, vault, &file_handle).await {
                Ok(context) => context,
                Err(error) => {
                    let _ = channel.close().await;
                    let _ =
                        disconnect_handles(&handles, "FunShell sudo initialization failed").await;
                    return Err(error);
                }
            }
        } else {
            None
        };
        if let Some(command) = profile.startup_command.as_deref() {
            if let Err(error) = channel.data(format!("{command}\n").as_bytes()).await {
                let _ = channel.close().await;
                let _ = disconnect_handles(&handles, "FunShell startup command failed").await;
                return Err(error.into());
            }
        }

        let lifecycle = CancellationToken::new();
        let remote_routes = Arc::new(DashMap::<(String, u32), (String, u16)>::new());
        let forwarded_routes = remote_routes.clone();
        let forwarded_lifecycle = lifecycle.clone();
        tokio::spawn(async move {
            loop {
                let forwarded = tokio::select! {
                    _ = forwarded_lifecycle.cancelled() => break,
                    forwarded = forwarded_receiver.recv() => match forwarded {
                        Some(forwarded) => forwarded,
                        None => break,
                    },
                };
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
                    let connection_lifecycle = forwarded_lifecycle.clone();
                    tokio::spawn(async move {
                        if let Ok(mut local) = TcpStream::connect((host.as_str(), port)).await {
                            let mut remote = forwarded.channel.into_stream();
                            tokio::select! {
                                _ = connection_lifecycle.cancelled() => {}
                                _ = tokio::io::copy_bidirectional(&mut local, &mut remote) => {}
                            }
                        }
                    });
                }
            }
        });
        let (sender, mut receiver) = mpsc::channel::<TerminalCommand>(256);
        let managed = Arc::new(ManagedSession {
            profile: profile.clone(),
            terminal_handle,
            monitor_handle,
            file_handle,
            sudo,
            terminal: sender,
            remote_routes,
            lifecycle: lifecycle.clone(),
        });
        self.sessions.insert(session_id.clone(), managed.clone());
        let event_session_id = session_id.clone();
        let event_app = app.clone();
        let terminal_lifecycle = lifecycle.clone();
        let terminal_session = managed;
        let sessions = self.sessions.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = terminal_lifecycle.cancelled() => {
                        let _ = channel.close().await;
                        break;
                    },
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
            terminal_lifecycle.cancel();
            let remove = sessions
                .get(&event_session_id)
                .is_some_and(|current| Arc::ptr_eq(current.value(), &terminal_session));
            if remove {
                sessions.remove(&event_session_id);
                let _ = disconnect_session_handles(
                    &terminal_session,
                    "FunShell terminal connection closed",
                )
                .await;
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
        session.lifecycle.cancel();
        let _ = session.terminal.send(TerminalCommand::Close).await;
        disconnect_session_handles(&session, "FunShell session closed").await
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
        execute_with_handle(&session.terminal_handle, command).await
    }

    pub async fn execute_monitor(&self, session_id: &str, command: &str) -> AppResult<ExecResult> {
        let session = self.get(session_id)?;
        execute_with_sudo(&session.monitor_handle, command, session.sudo.as_ref()).await
    }

    pub async fn execute_monitor_unprivileged(
        &self,
        session_id: &str,
        command: &str,
    ) -> AppResult<ExecResult> {
        let session = self.get(session_id)?;
        execute_with_handle(&session.monitor_handle, command).await
    }

    pub async fn execute_file(&self, session_id: &str, command: &str) -> AppResult<ExecResult> {
        let session = self.get(session_id)?;
        execute_with_sudo(&session.file_handle, command, session.sudo.as_ref()).await
    }

    pub async fn sftp(&self, session_id: &str) -> AppResult<russh_sftp::client::SftpSession> {
        let session = self.get(session_id)?;
        open_sftp(&session.file_handle, session.sudo.as_ref()).await
    }

    pub async fn download_reader(
        &self,
        session_id: &str,
        remote_path: String,
    ) -> AppResult<PipelinedSftpReader> {
        let session = self.get(session_id)?;
        open_pipelined_reader(&session.file_handle, remote_path, session.sudo.as_ref()).await
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
        let handle = session.terminal_handle.lock().await;
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
            .terminal_handle
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
        Ok(self.get(session_id)?.terminal_handle.clone())
    }

    pub(crate) fn lifecycle(&self, session_id: &str) -> AppResult<CancellationToken> {
        Ok(self.get(session_id)?.lifecycle.clone())
    }

    fn get(&self, session_id: &str) -> AppResult<Arc<ManagedSession>> {
        self.sessions
            .get(session_id)
            .map(|entry| entry.value().clone())
            .ok_or_else(|| AppError::Message("SSH 会话不存在或已关闭".into()))
    }
}

async fn execute_with_handle(
    handle: &Arc<Mutex<Handle<ClientHandler>>>,
    command: &str,
) -> AppResult<ExecResult> {
    execute_with_handle_input(handle, command, None).await
}

async fn execute_with_sudo(
    handle: &Arc<Mutex<Handle<ClientHandler>>>,
    command: &str,
    sudo: Option<&SudoContext>,
) -> AppResult<ExecResult> {
    let Some(sudo) = sudo else {
        return execute_with_handle(handle, command).await;
    };
    let elevated = sudo.command(command);
    let input = sudo.stdin_payload();
    execute_with_handle_input(
        handle,
        &elevated,
        input.as_ref().map(|value| value.as_slice()),
    )
    .await
}

async fn execute_with_handle_input(
    handle: &Arc<Mutex<Handle<ClientHandler>>>,
    command: &str,
    input: Option<&[u8]>,
) -> AppResult<ExecResult> {
    let handle = handle.lock().await;
    let mut channel = handle.channel_open_session().await?;
    channel.exec(true, command).await?;
    if let Some(input) = input {
        channel.data(input).await?;
        let _ = channel.eof().await;
    }
    drop(handle);
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut exit_status = None;
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => {
                if let Err(error) =
                    append_exec_output(&mut stdout, stderr.len(), &data, MAX_EXEC_OUTPUT_BYTES)
                {
                    let _ = channel.close().await;
                    return Err(error);
                }
            }
            ChannelMsg::ExtendedData { data, .. } => {
                if let Err(error) =
                    append_exec_output(&mut stderr, stdout.len(), &data, MAX_EXEC_OUTPUT_BYTES)
                {
                    let _ = channel.close().await;
                    return Err(error);
                }
            }
            ChannelMsg::ExitStatus {
                exit_status: status,
            } => exit_status = Some(status),
            ChannelMsg::Eof | ChannelMsg::Close => break,
            _ => {}
        }
    }
    Ok(ExecResult {
        stdout: decode_exec_output(stdout),
        stderr: decode_exec_output(stderr),
        exit_status,
    })
}

async fn prepare_sudo_context(
    profile: &ConnectionProfile,
    vault: &VaultService,
    handle: &Arc<Mutex<Handle<ClientHandler>>>,
) -> AppResult<Option<SudoContext>> {
    let identity = execute_with_handle(handle, "id -u").await?;
    if identity.stdout.trim() == "0" {
        return Ok(None);
    }

    let configured_password = configured_sudo_password(profile, vault)?;
    let passwordless = execute_with_handle(handle, &passwordless_probe_command()).await?;
    let credential = if sudo_result_succeeded(&passwordless) {
        SudoCredential::Passwordless
    } else if let Some(password) = configured_password {
        let credential = SudoCredential::Password(password);
        let input = credential.stdin_payload();
        let result = execute_with_handle_input(
            handle,
            &password_probe_command(),
            input.as_ref().map(|value| value.as_slice()),
        )
        .await?;
        if !sudo_result_succeeded(&result) {
            return Err(sudo_setup_error(&result, true));
        }
        credential
    } else {
        return Err(sudo_setup_error(&passwordless, false));
    };

    let discovery_command = credential.command(SFTP_SERVER_DISCOVERY_SCRIPT);
    let input = credential.stdin_payload();
    let discovery = execute_with_handle_input(
        handle,
        &discovery_command,
        input.as_ref().map(|value| value.as_slice()),
    )
    .await?;
    let sftp_server = discovery
        .stdout
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with('/') && !line.chars().any(char::is_whitespace))
        .map(str::to_owned);
    let Some(sftp_server) = sftp_server else {
        if discovery.stderr.contains(SFTP_SERVER_MISSING_MARKER) {
            return Err(AppError::Message(
                "服务器缺少可由 sudo 启动的 OpenSSH sftp-server".into(),
            ));
        }
        return Err(sudo_setup_error(
            &discovery,
            credential.stdin_payload().is_some(),
        ));
    };

    Ok(Some(SudoContext::new(credential, sftp_server)))
}

fn sudo_result_succeeded(result: &ExecResult) -> bool {
    result.stdout.contains(SUDO_SUCCESS_MARKER) || result.exit_status == Some(0)
}

fn sudo_setup_error(result: &ExecResult, password_attempted: bool) -> AppError {
    let output = format!("{}\n{}", result.stderr, result.stdout);
    let normalized = output.to_ascii_lowercase();
    let detail = if normalized.contains("sudo: not found")
        || normalized.contains("sudo: command not found")
        || normalized.contains("sudo: no such file")
    {
        "服务器未安装 sudo".into()
    } else if normalized.contains("must have a tty")
        || normalized.contains("no tty present")
        || normalized.contains("a terminal is required")
    {
        "服务器 sudo 策略要求 TTY，后台管理通道需要允许非交互 sudo".into()
    } else if normalized.contains("not in the sudoers")
        || normalized.contains("may not run sudo")
        || normalized.contains("is not allowed to run sudo")
    {
        "当前登录用户没有 sudo 权限".into()
    } else if password_attempted {
        "sudo 密码验证失败，请检查连接配置中的 sudo 密码".into()
    } else {
        "sudo 需要密码，请在连接配置中填写 sudo 密码，或为该用户配置 NOPASSWD".into()
    };
    let remote = output.replace(SUDO_PROMPT_MARKER, "").trim().to_owned();
    if remote.is_empty() {
        AppError::Message(detail)
    } else {
        AppError::Message(format!("{detail}: {remote}"))
    }
}

async fn connect_authenticated_handle(
    profile: &ConnectionProfile,
    database: &Database,
    vault: &VaultService,
    forwarded: mpsc::UnboundedSender<ForwardedChannel>,
) -> AppResult<Handle<ClientHandler>> {
    let stream = connect_for_profile(profile, database, vault).await?;
    let handler = ClientHandler::new(
        database.clone(),
        profile.host.clone(),
        profile.port,
        forwarded,
    );
    let mut handle =
        russh::client::connect_stream(Arc::new(client_config(profile)), stream, handler).await?;
    authenticate(&mut handle, profile, database, vault).await?;
    Ok(handle)
}

async fn connect_auxiliary_handle(
    profile: &ConnectionProfile,
    database: &Database,
    vault: &VaultService,
) -> AppResult<Arc<Mutex<Handle<ClientHandler>>>> {
    let (forwarded, _receiver) = mpsc::unbounded_channel();
    Ok(Arc::new(Mutex::new(
        connect_authenticated_handle(profile, database, vault, forwarded).await?,
    )))
}

async fn disconnect_session_handles(session: &ManagedSession, reason: &str) -> AppResult<()> {
    disconnect_handles(
        &[
            session.terminal_handle.clone(),
            session.monitor_handle.clone(),
            session.file_handle.clone(),
        ],
        reason,
    )
    .await
}

async fn disconnect_handles(
    candidates: &[Arc<Mutex<Handle<ClientHandler>>>],
    reason: &str,
) -> AppResult<()> {
    let handles = unique_arcs(candidates);
    let mut first_error = None;
    for handle in handles {
        if let Err(error) = handle
            .lock()
            .await
            .disconnect(Disconnect::ByApplication, reason, "zh-CN")
            .await
        {
            if first_error.is_none() {
                first_error = Some(error.into());
            }
        }
    }
    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

fn auxiliary_connection_count(multi_connection_mode: bool) -> usize {
    if multi_connection_mode { 2 } else { 0 }
}

fn unique_arcs<T>(candidates: &[Arc<T>]) -> Vec<Arc<T>> {
    let mut unique = Vec::new();
    for candidate in candidates {
        if !unique.iter().any(|current| Arc::ptr_eq(current, candidate)) {
            unique.push(candidate.clone());
        }
    }
    unique
}

fn append_exec_output(
    target: &mut Vec<u8>,
    other_len: usize,
    data: &[u8],
    limit: usize,
) -> AppResult<()> {
    if target
        .len()
        .saturating_add(other_len)
        .saturating_add(data.len())
        > limit
    {
        return Err(AppError::Message(format!(
            "SSH 命令输出超过 {} MiB 限制",
            limit / 1024 / 1024
        )));
    }
    target.extend_from_slice(data);
    Ok(())
}

fn decode_exec_output(output: Vec<u8>) -> String {
    String::from_utf8(output)
        .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::{append_exec_output, auxiliary_connection_count, unique_arcs};

    #[test]
    fn bounds_combined_exec_output_without_growing_the_buffer() {
        let mut stdout = b"1234".to_vec();
        assert!(append_exec_output(&mut stdout, 2, b"567", 8).is_err());
        assert_eq!(stdout, b"1234");
        assert!(append_exec_output(&mut stdout, 2, b"56", 8).is_ok());
        assert_eq!(stdout, b"123456");
    }

    #[test]
    fn plans_one_or_three_authenticated_connections() {
        assert_eq!(auxiliary_connection_count(false), 0);
        assert_eq!(auxiliary_connection_count(true), 2);
    }

    #[test]
    fn disconnects_shared_role_handles_only_once() {
        let shared = Arc::new(());
        assert_eq!(
            unique_arcs(&[shared.clone(), shared.clone(), shared]).len(),
            1
        );
        assert_eq!(
            unique_arcs(&[Arc::new(()), Arc::new(()), Arc::new(())]).len(),
            3
        );
    }
}

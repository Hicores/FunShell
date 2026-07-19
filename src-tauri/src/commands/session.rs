use base64::{Engine, engine::general_purpose::STANDARD};
use tauri::{AppHandle, State};

use crate::{
    domain::{ExecResult, KnownHostInfo, SessionDescriptor},
    error::{AppError, AppResult},
    state::AppState,
};

#[tauri::command]
pub fn trust_host_key(state: State<'_, AppState>, info: KnownHostInfo) -> AppResult<()> {
    state.database.trust_host(&info)
}

#[tauri::command]
pub async fn connect_session(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: String,
    columns: Option<u32>,
    rows: Option<u32>,
    requested_session_id: Option<String>,
) -> AppResult<SessionDescriptor> {
    let profile = state
        .database
        .connection_by_id(&connection_id)?
        .filter(|profile| !profile.deleted)
        .ok_or_else(|| AppError::Validation("连接不存在或已删除".into()))?;
    state
        .sessions
        .connect(
            app,
            requested_session_id,
            profile,
            state.database.clone(),
            &state.vault,
            (columns.unwrap_or(120), rows.unwrap_or(32)),
        )
        .await
}

#[tauri::command]
pub async fn disconnect_session(state: State<'_, AppState>, session_id: String) -> AppResult<()> {
    let tunnel_result = state
        .tunnels
        .stop_by_session(&session_id, &state.sessions)
        .await;
    let session_result = state.sessions.disconnect(&session_id).await;
    tunnel_result?;
    session_result
}

#[tauri::command]
pub async fn send_terminal_input(
    state: State<'_, AppState>,
    session_id: String,
    data_base64: String,
) -> AppResult<()> {
    let data = STANDARD
        .decode(data_base64)
        .map_err(|_| AppError::Validation("终端输入编码无效".into()))?;
    state.sessions.input(&session_id, data).await
}

#[tauri::command]
pub async fn resize_terminal(
    state: State<'_, AppState>,
    session_id: String,
    columns: u32,
    rows: u32,
) -> AppResult<()> {
    state.sessions.resize(&session_id, columns, rows).await
}

#[tauri::command]
pub async fn execute_command(
    state: State<'_, AppState>,
    session_id: String,
    command: String,
) -> AppResult<ExecResult> {
    if !command.trim().is_empty() {
        let profile = state.sessions.profile(&session_id)?;
        state.database.add_history(Some(&profile.id), &command)?;
    }
    state.sessions.execute(&session_id, &command).await
}

#[tauri::command]
pub async fn submit_terminal_command(
    state: State<'_, AppState>,
    session_id: String,
    command: String,
) -> AppResult<()> {
    if command.trim().is_empty() {
        return Ok(());
    }
    let profile = state.sessions.profile(&session_id)?;
    state.database.add_history(Some(&profile.id), &command)?;
    let mut bytes = command.into_bytes();
    bytes.push(b'\n');
    state.sessions.input(&session_id, bytes).await
}

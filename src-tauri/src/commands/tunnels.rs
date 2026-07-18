use tauri::State;

use crate::{
    domain::{TunnelKind, TunnelProfile, TunnelRuntime},
    error::{AppError, AppResult},
    state::AppState,
};

#[tauri::command]
pub fn list_tunnel_profiles(state: State<'_, AppState>) -> AppResult<Vec<TunnelProfile>> {
    state.database.list_tunnels()
}

#[tauri::command]
pub fn save_tunnel_profile(
    state: State<'_, AppState>,
    profile: TunnelProfile,
) -> AppResult<TunnelProfile> {
    validate_profile(&profile)?;
    state.database.save_tunnel(profile)
}

#[tauri::command]
pub async fn delete_tunnel_profile(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.tunnels.stop(&id, &state.sessions).await?;
    state.database.delete_tunnel(&id)
}

#[tauri::command]
pub async fn start_tunnel(
    state: State<'_, AppState>,
    profile_id: String,
    session_id: String,
) -> AppResult<TunnelRuntime> {
    let profile = state
        .database
        .list_tunnels()?
        .into_iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| AppError::Validation("隧道配置不存在".into()))?;
    state
        .tunnels
        .start(profile, session_id, &state.sessions)
        .await
}

#[tauri::command]
pub async fn stop_tunnel(state: State<'_, AppState>, profile_id: String) -> AppResult<()> {
    state.tunnels.stop(&profile_id, &state.sessions).await
}

#[tauri::command]
pub fn list_tunnel_statuses(state: State<'_, AppState>) -> Vec<TunnelRuntime> {
    state.tunnels.statuses()
}

fn validate_profile(profile: &TunnelProfile) -> AppResult<()> {
    if profile.name.trim().is_empty() || profile.connection_id.is_empty() {
        return Err(AppError::Validation("隧道名称和连接不能为空".into()));
    }
    if profile.bind_host.trim().is_empty() {
        return Err(AppError::Validation("监听地址不能为空".into()));
    }
    if profile.kind != TunnelKind::Dynamic
        && (profile
            .target_host
            .as_deref()
            .unwrap_or_default()
            .is_empty()
            || profile.target_port.unwrap_or_default() == 0)
    {
        return Err(AppError::Validation("转发目标主机和端口不能为空".into()));
    }
    Ok(())
}

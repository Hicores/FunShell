use tauri::State;

use crate::{
    domain::{
        ConnectionFolder, ConnectionProfile, ProxyProfile, RouteProfile, SaveConnectionInput,
        SaveProxyInput,
    },
    error::{AppError, AppResult},
    state::AppState,
};

#[tauri::command]
pub fn list_connections(
    state: State<'_, AppState>,
    include_deleted: Option<bool>,
) -> AppResult<Vec<ConnectionProfile>> {
    state
        .database
        .list_connections(include_deleted.unwrap_or(false))
}

#[tauri::command]
pub fn save_connection(
    state: State<'_, AppState>,
    input: SaveConnectionInput,
) -> AppResult<ConnectionProfile> {
    validate_connection(&input)?;
    let existing = input
        .id
        .as_deref()
        .map(|id| state.database.connection_by_id(id))
        .transpose()?
        .flatten();
    let secret_id = save_optional_password(
        &state,
        input.password.as_deref(),
        existing
            .as_ref()
            .and_then(|profile| profile.secret_id.as_deref()),
        "ssh_password",
    )?;
    let sudo_secret_id = save_optional_password(
        &state,
        input.sudo_password.as_deref(),
        existing
            .as_ref()
            .and_then(|profile| profile.sudo_secret_id.as_deref()),
        "sudo_password",
    )?;
    state
        .database
        .save_connection(&input, secret_id, sudo_secret_id)
}

fn save_optional_password(
    state: &State<'_, AppState>,
    password: Option<&str>,
    existing_id: Option<&str>,
    kind: &str,
) -> AppResult<Option<String>> {
    let Some(password) = password.filter(|password| !password.is_empty()) else {
        return Ok(None);
    };
    if let Some(id) = existing_id {
        state.vault.replace(id, kind, password.as_bytes())?;
        Ok(Some(id.to_owned()))
    } else {
        Ok(Some(state.vault.store(kind, password.as_bytes())?))
    }
}

#[tauri::command]
pub fn delete_connection(
    state: State<'_, AppState>,
    id: String,
    deleted: Option<bool>,
) -> AppResult<()> {
    state
        .database
        .set_connection_deleted(&id, deleted.unwrap_or(true))
}

#[tauri::command]
pub fn move_connection(
    state: State<'_, AppState>,
    id: String,
    folder_id: Option<String>,
) -> AppResult<()> {
    state.database.move_connection(&id, folder_id.as_deref())
}

#[tauri::command]
pub fn list_folders(
    state: State<'_, AppState>,
    include_deleted: Option<bool>,
) -> AppResult<Vec<ConnectionFolder>> {
    state
        .database
        .list_folders(include_deleted.unwrap_or(false))
}

#[tauri::command]
pub fn save_folder(
    state: State<'_, AppState>,
    folder: ConnectionFolder,
) -> AppResult<ConnectionFolder> {
    if folder.name.trim().is_empty() {
        return Err(AppError::Validation("目录名称不能为空".into()));
    }
    state.database.save_folder(folder)
}

#[tauri::command]
pub fn delete_folder(
    state: State<'_, AppState>,
    id: String,
    deleted: Option<bool>,
) -> AppResult<()> {
    state
        .database
        .set_folder_deleted(&id, deleted.unwrap_or(true))
}

#[tauri::command]
pub fn list_proxies(state: State<'_, AppState>) -> AppResult<Vec<ProxyProfile>> {
    state.database.list_proxies()
}

#[tauri::command]
pub fn save_proxy(state: State<'_, AppState>, input: SaveProxyInput) -> AppResult<ProxyProfile> {
    if input.name.trim().is_empty() || input.host.trim().is_empty() || input.port == 0 {
        return Err(AppError::Validation(
            "代理名称、主机和端口均为必填项".into(),
        ));
    }
    let secret_id = input
        .password
        .as_deref()
        .filter(|password| !password.is_empty())
        .map(|password| state.vault.store("proxy_password", password.as_bytes()))
        .transpose()?;
    state.database.save_proxy(&input, secret_id)
}

#[tauri::command]
pub fn list_routes(state: State<'_, AppState>) -> AppResult<Vec<RouteProfile>> {
    state.database.list_routes()
}

#[tauri::command]
pub fn save_route(state: State<'_, AppState>, route: RouteProfile) -> AppResult<RouteProfile> {
    if route.name.trim().is_empty() || route.candidates.is_empty() {
        return Err(AppError::Validation("路由名称和候选路线不能为空".into()));
    }
    state.database.save_route(route)
}

fn validate_connection(input: &SaveConnectionInput) -> AppResult<()> {
    if input.name.trim().is_empty() {
        return Err(AppError::Validation("连接名称不能为空".into()));
    }
    if input.host.trim().is_empty() || input.port == 0 {
        return Err(AppError::Validation("主机和端口不能为空".into()));
    }
    if input.username.trim().is_empty() {
        return Err(AppError::Validation("用户名不能为空".into()));
    }
    Ok(())
}

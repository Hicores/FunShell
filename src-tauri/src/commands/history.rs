use tauri::State;

use crate::{
    domain::{CommandHistoryEntry, CommandPreset},
    error::{AppError, AppResult},
    state::AppState,
};

#[tauri::command]
pub fn list_command_history(
    state: State<'_, AppState>,
    connection_id: Option<String>,
    search: Option<String>,
    limit: Option<u32>,
) -> AppResult<Vec<CommandHistoryEntry>> {
    state.database.list_history(
        connection_id.as_deref(),
        search.as_deref(),
        limit.unwrap_or(200).min(1000),
    )
}

#[tauri::command]
pub fn set_command_favorite(
    state: State<'_, AppState>,
    id: String,
    favorite: bool,
) -> AppResult<()> {
    state.database.set_history_favorite(&id, favorite)
}

#[tauri::command]
pub fn clear_command_history(
    state: State<'_, AppState>,
    connection_id: Option<String>,
) -> AppResult<()> {
    state.database.clear_history(connection_id.as_deref())
}

#[tauri::command]
pub fn list_command_presets(state: State<'_, AppState>) -> AppResult<Vec<CommandPreset>> {
    state.database.list_presets()
}

#[tauri::command]
pub fn save_command_preset(
    state: State<'_, AppState>,
    preset: CommandPreset,
) -> AppResult<CommandPreset> {
    if preset.name.trim().is_empty() || preset.command.trim().is_empty() {
        return Err(AppError::Validation("预设名称和命令不能为空".into()));
    }
    state.database.save_preset(preset)
}

#[tauri::command]
pub fn delete_command_preset(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.database.delete_preset(&id)
}

use tauri::State;

use crate::{error::AppResult, paths::AppPaths, state::AppState};

#[tauri::command]
pub fn get_runtime_paths(state: State<'_, AppState>) -> AppResult<AppPaths> {
    Ok(state.paths.clone())
}

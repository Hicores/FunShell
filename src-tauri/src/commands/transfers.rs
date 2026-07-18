use tauri::State;

use crate::{domain::TransferProgressEvent, error::AppResult, state::AppState};

#[tauri::command]
pub fn list_transfer_history(state: State<'_, AppState>) -> AppResult<Vec<TransferProgressEvent>> {
    state.database.list_transfers(500)
}

#[tauri::command]
pub fn mark_transfer_history_viewed(state: State<'_, AppState>) -> AppResult<()> {
    state.database.mark_transfers_viewed()
}

#[tauri::command]
pub fn clear_transfer_history(state: State<'_, AppState>) -> AppResult<()> {
    state.database.clear_completed_transfers()
}

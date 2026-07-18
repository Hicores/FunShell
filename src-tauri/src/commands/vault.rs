use tauri::State;

use crate::{
    domain::{VaultMode, VaultStatus},
    error::AppResult,
    state::AppState,
};

#[tauri::command]
pub fn vault_status(state: State<'_, AppState>) -> AppResult<VaultStatus> {
    state.vault.status()
}

#[tauri::command]
pub fn initialize_master_vault(state: State<'_, AppState>, password: String) -> AppResult<()> {
    state.vault.initialize_master(&password)
}

#[tauri::command]
pub fn unlock_master_vault(state: State<'_, AppState>, password: String) -> AppResult<()> {
    state.vault.unlock(&password)
}

#[tauri::command]
pub fn lock_master_vault(state: State<'_, AppState>) {
    state.vault.lock();
}

#[tauri::command]
pub fn change_vault_mode(
    state: State<'_, AppState>,
    mode: VaultMode,
    password: Option<String>,
) -> AppResult<()> {
    state.vault.change_mode(mode, password.as_deref())
}

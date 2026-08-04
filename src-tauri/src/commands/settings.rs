use tauri::State;

use crate::{
    domain::GeoIpInfo,
    error::AppResult,
    settings::{AppSettings, ProcessSortKey, SortDirection},
    state::AppState,
};

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    Ok(state.settings.get())
}

#[tauri::command]
pub fn save_settings(state: State<'_, AppState>, settings: AppSettings) -> AppResult<AppSettings> {
    state.settings.save(settings)
}

#[tauri::command]
pub fn save_quick_connection_collapsed_folders(
    state: State<'_, AppState>,
    folder_ids: Vec<String>,
) -> AppResult<AppSettings> {
    state
        .settings
        .save_quick_connection_collapsed_folders(folder_ids)
}

#[tauri::command]
pub fn save_process_sort(
    state: State<'_, AppState>,
    key: ProcessSortKey,
    direction: SortDirection,
) -> AppResult<AppSettings> {
    state.settings.save_process_sort(key, direction)
}

#[tauri::command]
pub fn lookup_geo_ip(state: State<'_, AppState>, ip: String) -> AppResult<GeoIpInfo> {
    state.geoip.lookup(&ip)
}

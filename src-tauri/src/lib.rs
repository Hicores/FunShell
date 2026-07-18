mod commands;
mod domain;
mod error;
mod paths;
mod persistence;
mod security;
mod state;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

use crate::{paths::AppPaths, state::AppState};

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .without_time()
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let paths = AppPaths::discover()?;
            let state = AppState::initialize(paths)?;
            app.manage(state);
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("FunShell")?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health,
            commands::paths::get_runtime_paths,
            commands::connections::list_connections,
            commands::connections::save_connection,
            commands::connections::delete_connection,
            commands::connections::list_folders,
            commands::connections::save_folder,
            commands::connections::delete_folder,
            commands::connections::list_proxies,
            commands::connections::save_proxy,
            commands::connections::list_routes,
            commands::connections::save_route,
            commands::vault::vault_status,
            commands::vault::initialize_master_vault,
            commands::vault::unlock_master_vault,
            commands::vault::lock_master_vault,
            commands::vault::change_vault_mode,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run FunShell");
}

mod commands;
mod domain;
mod error;
mod paths;
mod persistence;
mod security;
mod services;
mod settings;
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
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::lookup_geo_ip,
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
            commands::keys::list_keys,
            commands::keys::import_private_key,
            commands::keys::import_private_key_file,
            commands::keys::generate_private_key,
            commands::keys::delete_key,
            commands::session::trust_host_key,
            commands::session::connect_session,
            commands::session::disconnect_session,
            commands::session::send_terminal_input,
            commands::session::resize_terminal,
            commands::session::execute_command,
            commands::session::submit_terminal_command,
            commands::files::list_remote_files,
            commands::files::read_remote_text,
            commands::files::write_remote_text,
            commands::files::create_remote_directory,
            commands::files::rename_remote_path,
            commands::files::delete_remote_path,
            commands::files::chmod_remote_path,
            commands::files::upload_remote_file,
            commands::files::download_remote_file,
            commands::files::open_remote_file,
            commands::files::cancel_file_transfer,
            commands::monitor::collect_server_snapshot,
            commands::monitor::get_system_info,
            commands::monitor::list_processes,
            commands::monitor::get_process_details,
            commands::monitor::terminate_process,
            commands::monitor::list_sockets,
            commands::monitor::trace_route,
            commands::history::list_command_history,
            commands::history::set_command_favorite,
            commands::history::clear_command_history,
            commands::history::list_command_presets,
            commands::history::save_command_preset,
            commands::history::delete_command_preset,
            commands::tunnels::list_tunnel_profiles,
            commands::tunnels::save_tunnel_profile,
            commands::tunnels::delete_tunnel_profile,
            commands::tunnels::start_tunnel,
            commands::tunnels::stop_tunnel,
            commands::tunnels::list_tunnel_statuses,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run FunShell");
}

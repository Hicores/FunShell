mod commands;
mod error;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .without_time()
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("FunShell")?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::health])
        .run(tauri::generate_context!())
        .expect("failed to run FunShell");
}


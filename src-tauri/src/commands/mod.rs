use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    name: &'static str,
    version: &'static str,
}

#[tauri::command]
pub fn health() -> Health {
    Health {
        name: "FunShell",
        version: env!("CARGO_PKG_VERSION"),
    }
}


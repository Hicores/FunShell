use crate::{
    error::AppResult, paths::AppPaths, persistence::Database, security::VaultService,
    services::ssh::SessionManager, services::tunnel::TunnelManager,
};

pub struct AppState {
    pub paths: AppPaths,
    pub database: Database,
    pub vault: VaultService,
    pub sessions: SessionManager,
    pub tunnels: TunnelManager,
}

impl AppState {
    pub fn initialize(paths: AppPaths) -> AppResult<Self> {
        let database = Database::open(&paths.database)?;
        let vault = VaultService::new(database.clone())?;
        let sessions = SessionManager::new();
        let tunnels = TunnelManager::new();
        Ok(Self {
            paths,
            database,
            vault,
            sessions,
            tunnels,
        })
    }
}

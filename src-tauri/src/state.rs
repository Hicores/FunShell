use crate::{error::AppResult, paths::AppPaths, persistence::Database, security::VaultService};

pub struct AppState {
    pub paths: AppPaths,
    pub database: Database,
    pub vault: VaultService,
}

impl AppState {
    pub fn initialize(paths: AppPaths) -> AppResult<Self> {
        let database = Database::open(&paths.database)?;
        let vault = VaultService::new(database.clone())?;
        Ok(Self {
            paths,
            database,
            vault,
        })
    }
}

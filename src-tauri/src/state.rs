use crate::{
    error::AppResult,
    paths::AppPaths,
    persistence::Database,
    security::VaultService,
    services::{
        geoip::GeoIpService, ssh::SessionManager, transfer::TransferManager, tunnel::TunnelManager,
    },
    settings::SettingsService,
};

pub struct AppState {
    pub paths: AppPaths,
    pub database: Database,
    pub vault: VaultService,
    pub settings: SettingsService,
    pub geoip: GeoIpService,
    pub sessions: SessionManager,
    pub tunnels: TunnelManager,
    pub transfers: TransferManager,
}

impl AppState {
    pub fn initialize(paths: AppPaths) -> AppResult<Self> {
        let database = Database::open(&paths.database)?;
        let settings = SettingsService::load(paths.settings.clone())?;
        let vault = VaultService::new(database.clone())?;
        let geoip = GeoIpService::new(database.clone(), settings.clone())?;
        let sessions = SessionManager::new();
        let tunnels = TunnelManager::new();
        let transfers = TransferManager::new();
        Ok(Self {
            paths,
            database,
            vault,
            settings,
            geoip,
            sessions,
            tunnels,
            transfers,
        })
    }
}

use std::{fs, path::PathBuf, sync::Arc};

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub geoip_enabled: bool,
    pub geoip_provider_url: String,
    pub confirm_close_active_sessions: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            geoip_enabled: true,
            geoip_provider_url: "https://ipwho.is/{ip}".into(),
            confirm_close_active_sessions: true,
        }
    }
}

#[derive(Clone)]
pub struct SettingsService {
    path: PathBuf,
    value: Arc<RwLock<AppSettings>>,
}

impl SettingsService {
    pub fn load(path: PathBuf) -> AppResult<Self> {
        let value = if path.exists() {
            serde_json::from_slice(&fs::read(&path)?).map_err(|error| {
                AppError::Message(format!("设置文件格式错误 {}: {error}", path.display()))
            })?
        } else {
            AppSettings::default()
        };
        validate(&value)?;
        let service = Self {
            path,
            value: Arc::new(RwLock::new(value)),
        };
        if !service.path.exists() {
            service.save(service.get())?;
        }
        Ok(service)
    }

    pub fn get(&self) -> AppSettings {
        self.value.read().clone()
    }

    pub fn save(&self, value: AppSettings) -> AppResult<AppSettings> {
        validate(&value)?;
        let encoded = serde_json::to_vec_pretty(&value)?;
        fs::write(&self.path, encoded).map_err(|error| {
            AppError::Message(format!("设置文件不可写 {}: {error}", self.path.display()))
        })?;
        *self.value.write() = value.clone();
        Ok(value)
    }
}

fn validate(value: &AppSettings) -> AppResult<()> {
    if value.geoip_enabled
        && (!value.geoip_provider_url.starts_with("https://")
            || !value.geoip_provider_url.contains("{ip}"))
    {
        return Err(AppError::Validation(
            "GeoIP 提供方必须使用 HTTPS 并包含 {ip} 占位符".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::{AppSettings, SettingsService};

    #[test]
    fn persists_portable_settings() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("settings.json");
        let settings = SettingsService::load(path.clone()).expect("load");
        let mut value = settings.get();
        value.geoip_enabled = false;
        settings.save(value).expect("save");
        assert!(
            !SettingsService::load(path)
                .expect("reload")
                .get()
                .geoip_enabled
        );
    }

    #[test]
    fn rejects_insecure_geoip_provider() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("settings.json");
        let settings = SettingsService::load(path).expect("load");
        let value = AppSettings {
            geoip_provider_url: "http://example.test/{ip}".into(),
            ..AppSettings::default()
        };
        assert!(settings.save(value).is_err());
    }
}

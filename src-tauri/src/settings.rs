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
    pub terminal_font_family: String,
    pub terminal_font_size: u16,
    pub terminal_scrollback_lines: u32,
    pub quick_connection_collapsed_folder_ids: Vec<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            geoip_enabled: true,
            geoip_provider_url: "https://ipwho.is/{ip}".into(),
            confirm_close_active_sessions: true,
            terminal_font_family: "\"Cascadia Mono\", Consolas, \"Microsoft YaHei UI\", monospace"
                .into(),
            terminal_font_size: 13,
            terminal_scrollback_lines: 3_000,
            quick_connection_collapsed_folder_ids: Vec::new(),
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
        let mut current = self.value.write();
        self.write(&value)?;
        *current = value.clone();
        Ok(value)
    }

    pub fn save_quick_connection_collapsed_folders(
        &self,
        mut folder_ids: Vec<String>,
    ) -> AppResult<AppSettings> {
        folder_ids.sort_unstable();
        folder_ids.dedup();
        let mut current = self.value.write();
        let mut next = current.clone();
        next.quick_connection_collapsed_folder_ids = folder_ids;
        validate(&next)?;
        self.write(&next)?;
        *current = next.clone();
        Ok(next)
    }

    fn write(&self, value: &AppSettings) -> AppResult<()> {
        let encoded = serde_json::to_vec_pretty(value)?;
        fs::write(&self.path, encoded).map_err(|error| {
            AppError::Message(format!("设置文件不可写 {}: {error}", self.path.display()))
        })
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
    if value.terminal_font_family.trim().is_empty()
        || value.terminal_font_family.len() > 240
        || value
            .terminal_font_family
            .chars()
            .any(|character| character.is_control() || "{};".contains(character))
    {
        return Err(AppError::Validation("终端字体名称无效".into()));
    }
    if !(9..=32).contains(&value.terminal_font_size) {
        return Err(AppError::Validation(
            "终端字体大小必须在 9 到 32 之间".into(),
        ));
    }
    if !(500..=50_000).contains(&value.terminal_scrollback_lines) {
        return Err(AppError::Validation(
            "终端滚屏行数必须在 500 到 50000 之间".into(),
        ));
    }
    if value.quick_connection_collapsed_folder_ids.len() > 10_000
        || value
            .quick_connection_collapsed_folder_ids
            .iter()
            .any(|id| id.is_empty() || id.len() > 200 || id.chars().any(char::is_control))
    {
        return Err(AppError::Validation(
            "快速连接目录折叠状态包含无效目录标识".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

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
    fn persists_quick_connection_folder_state_without_overwriting_other_settings() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("settings.json");
        let settings = SettingsService::load(path.clone()).expect("load");
        let mut value = settings.get();
        value.geoip_enabled = false;
        settings.save(value).expect("save");

        let saved = settings
            .save_quick_connection_collapsed_folders(vec![
                "folder-b".into(),
                "folder-a".into(),
                "folder-b".into(),
            ])
            .expect("save folder state");

        assert!(!saved.geoip_enabled);
        assert_eq!(
            saved.quick_connection_collapsed_folder_ids,
            ["folder-a", "folder-b"]
        );
        let reloaded = SettingsService::load(path).expect("reload").get();
        assert_eq!(
            reloaded.quick_connection_collapsed_folder_ids,
            ["folder-a", "folder-b"]
        );
    }

    #[test]
    fn defaults_missing_quick_connection_folder_state_for_existing_settings() {
        let directory = tempdir().expect("tempdir");
        let path = directory.path().join("settings.json");
        fs::write(&path, "{}").expect("write legacy settings");

        let settings = SettingsService::load(path).expect("load");

        assert!(
            settings
                .get()
                .quick_connection_collapsed_folder_ids
                .is_empty()
        );
        assert_eq!(settings.get().terminal_scrollback_lines, 3_000);
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

    #[test]
    fn defaults_to_a_compact_terminal_font_size() {
        assert_eq!(AppSettings::default().terminal_font_size, 13);
        assert_eq!(AppSettings::default().terminal_scrollback_lines, 3_000);
        assert!(
            AppSettings::default()
                .terminal_font_family
                .contains("Cascadia Mono")
        );
    }

    #[test]
    fn rejects_terminal_font_sizes_outside_the_supported_range() {
        let directory = tempdir().expect("tempdir");
        let settings = SettingsService::load(directory.path().join("settings.json")).expect("load");
        let value = AppSettings {
            terminal_font_size: 8,
            ..AppSettings::default()
        };
        assert!(settings.save(value).is_err());
    }

    #[test]
    fn rejects_terminal_scrollback_outside_the_supported_range() {
        let directory = tempdir().expect("tempdir");
        let settings = SettingsService::load(directory.path().join("settings.json")).expect("load");
        let value = AppSettings {
            terminal_scrollback_lines: 50_001,
            ..AppSettings::default()
        };
        assert!(settings.save(value).is_err());
    }
}

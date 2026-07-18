use std::{fs, path::PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub root: PathBuf,
    pub config: PathBuf,
    pub database: PathBuf,
    pub settings: PathBuf,
    pub downloads: PathBuf,
    pub logs: PathBuf,
    pub temporary: PathBuf,
}

impl AppPaths {
    pub fn discover() -> AppResult<Self> {
        let root = if cfg!(debug_assertions) {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .ok_or_else(|| AppError::Message("无法确定开发数据目录".into()))?
                .join(".dev-data")
        } else {
            std::env::current_exe()?
                .parent()
                .ok_or_else(|| AppError::Message("无法确定程序目录".into()))?
                .to_path_buf()
        };

        let paths = Self {
            config: root.join("config"),
            database: root.join("config").join("funshell.db"),
            settings: root.join("config").join("settings.json"),
            downloads: root.join("downloads"),
            logs: root.join("logs"),
            temporary: root.join("temp"),
            root,
        };
        paths.ensure()?;
        Ok(paths)
    }

    fn ensure(&self) -> AppResult<()> {
        for path in [
            &self.root,
            &self.config,
            &self.downloads,
            &self.logs,
            &self.temporary,
        ] {
            fs::create_dir_all(path).map_err(|error| {
                AppError::Message(format!("数据目录不可写 {}: {error}", path.display()))
            })?;
        }
        Ok(())
    }
}

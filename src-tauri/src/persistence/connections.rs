use chrono::Utc;
use rusqlite::{OptionalExtension, params};
use uuid::Uuid;

use crate::{
    domain::{
        AuthMethod, ConnectionFolder, ConnectionProfile, ProxyKind, ProxyProfile, RouteProfile,
        SaveConnectionInput, SaveProxyInput,
    },
    error::{AppError, AppResult},
    persistence::Database,
};

impl Database {
    pub fn list_connections(&self, include_deleted: bool) -> AppResult<Vec<ConnectionProfile>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, folder_id, name, host, port, username, auth_method, secret_id, key_id,
                        route_id, startup_command, keepalive_seconds, connect_timeout_seconds,
                        compression, auto_reconnect, max_reconnect_attempts, multi_connection_mode, sort_order, deleted,
                        created_at, updated_at
                 FROM connections WHERE (?1 = 1 OR deleted = 0)
                 ORDER BY sort_order, name COLLATE NOCASE",
            )?;
            let rows = statement.query_map([include_deleted as i64], |row| {
                let auth: String = row.get(6)?;
                Ok(ConnectionProfile {
                    id: row.get(0)?,
                    folder_id: row.get(1)?,
                    name: row.get(2)?,
                    host: row.get(3)?,
                    port: row.get::<_, i64>(4)? as u16,
                    username: row.get(5)?,
                    auth_method: AuthMethod::try_from(auth.as_str()).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            6,
                            rusqlite::types::Type::Text,
                            error.into(),
                        )
                    })?,
                    secret_id: row.get(7)?,
                    key_id: row.get(8)?,
                    route_id: row.get(9)?,
                    startup_command: row.get(10)?,
                    keepalive_seconds: row.get::<_, i64>(11)? as u32,
                    connect_timeout_seconds: row.get::<_, i64>(12)? as u32,
                    compression: row.get::<_, i64>(13)? != 0,
                    auto_reconnect: row.get::<_, i64>(14)? != 0,
                    max_reconnect_attempts: row.get::<_, i64>(15)?.max(0) as u32,
                    multi_connection_mode: row.get::<_, i64>(16)? != 0,
                    sort_order: row.get(17)?,
                    deleted: row.get::<_, i64>(18)? != 0,
                    created_at: row.get(19)?,
                    updated_at: row.get(20)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn connection_by_id(&self, id: &str) -> AppResult<Option<ConnectionProfile>> {
        Ok(self
            .list_connections(true)?
            .into_iter()
            .find(|profile| profile.id == id))
    }

    pub fn save_connection(
        &self,
        input: &SaveConnectionInput,
        secret_id: Option<String>,
    ) -> AppResult<ConnectionProfile> {
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now().to_rfc3339();
        self.with_connection(|connection| {
            let existing_created: Option<String> = connection
                .query_row(
                    "SELECT created_at FROM connections WHERE id = ?1",
                    [&id],
                    |row| row.get(0),
                )
                .optional()?;
            let created_at = existing_created.unwrap_or_else(|| now.clone());
            connection.execute(
                r#"INSERT INTO connections (
                    id, folder_id, name, host, port, username, auth_method, secret_id, key_id,
                    route_id, startup_command, keepalive_seconds, connect_timeout_seconds,
                    compression, auto_reconnect, max_reconnect_attempts, multi_connection_mode, sort_order, deleted,
                    created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 0, ?19, ?20)
                ON CONFLICT(id) DO UPDATE SET
                    folder_id=excluded.folder_id, name=excluded.name, host=excluded.host,
                    port=excluded.port, username=excluded.username, auth_method=excluded.auth_method,
                    secret_id=COALESCE(excluded.secret_id, connections.secret_id),
                    key_id=excluded.key_id, route_id=excluded.route_id,
                    startup_command=excluded.startup_command,
                    keepalive_seconds=excluded.keepalive_seconds,
                    connect_timeout_seconds=excluded.connect_timeout_seconds,
                    compression=excluded.compression, auto_reconnect=excluded.auto_reconnect,
                    max_reconnect_attempts=excluded.max_reconnect_attempts,
                    multi_connection_mode=excluded.multi_connection_mode,
                    sort_order=excluded.sort_order, deleted=0, updated_at=excluded.updated_at"#,
                params![
                    id,
                    input.folder_id,
                    input.name.trim(),
                    input.host.trim(),
                    input.port,
                    input.username.trim(),
                    input.auth_method.as_str(),
                    secret_id,
                    input.key_id,
                    input.route_id,
                    input.startup_command,
                    input.keepalive_seconds.unwrap_or(30),
                    input.connect_timeout_seconds.unwrap_or(10),
                    input.compression as i64,
                    input.auto_reconnect as i64,
                    input.max_reconnect_attempts,
                    input.multi_connection_mode as i64,
                    input.sort_order.unwrap_or(0),
                    created_at,
                    now,
                ],
            )?;
            Ok(())
        })?;
        self.connection_by_id(&id)?
            .ok_or_else(|| AppError::Message("保存连接后读取失败".into()))
    }

    pub fn set_connection_deleted(&self, id: &str, deleted: bool) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute(
                "UPDATE connections SET deleted=?2, updated_at=?3 WHERE id=?1",
                params![id, deleted as i64, Utc::now().to_rfc3339()],
            )?;
            Ok(())
        })
    }

    pub fn move_connection(&self, id: &str, folder_id: Option<&str>) -> AppResult<()> {
        self.with_connection(|connection| {
            if let Some(folder_id) = folder_id {
                let folder_exists = connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM folders WHERE id=?1 AND deleted=0)",
                    [folder_id],
                    |row| row.get::<_, bool>(0),
                )?;
                if !folder_exists {
                    return Err(AppError::Validation("目标目录不存在或已删除".into()));
                }
            }
            let changed = connection.execute(
                "UPDATE connections SET folder_id=?2, updated_at=?3 WHERE id=?1 AND deleted=0",
                params![id, folder_id, Utc::now().to_rfc3339()],
            )?;
            if changed == 0 {
                return Err(AppError::Validation("连接不存在或已删除".into()));
            }
            Ok(())
        })
    }

    pub fn list_folders(&self, include_deleted: bool) -> AppResult<Vec<ConnectionFolder>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id, parent_id, name, sort_order, deleted FROM folders
                 WHERE (?1=1 OR deleted=0) ORDER BY sort_order, name COLLATE NOCASE",
            )?;
            let rows = statement.query_map([include_deleted as i64], |row| {
                Ok(ConnectionFolder {
                    id: row.get(0)?,
                    parent_id: row.get(1)?,
                    name: row.get(2)?,
                    sort_order: row.get(3)?,
                    deleted: row.get::<_, i64>(4)? != 0,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn save_folder(&self, mut folder: ConnectionFolder) -> AppResult<ConnectionFolder> {
        if folder.id.is_empty() {
            folder.id = Uuid::new_v4().to_string();
        }
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO folders(id,parent_id,name,sort_order,deleted) VALUES(?1,?2,?3,?4,?5)
                 ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,name=excluded.name,
                    sort_order=excluded.sort_order,deleted=excluded.deleted",
                params![
                    folder.id,
                    folder.parent_id,
                    folder.name.trim(),
                    folder.sort_order,
                    folder.deleted as i64
                ],
            )?;
            Ok(())
        })?;
        Ok(folder)
    }

    pub fn set_folder_deleted(&self, id: &str, deleted: bool) -> AppResult<()> {
        self.with_connection_mut(|connection| {
            let transaction = connection.transaction()?;
            transaction.execute(
                "UPDATE folders SET deleted=?2 WHERE id=?1",
                params![id, deleted as i64],
            )?;
            transaction.execute(
                "UPDATE connections SET deleted=?2 WHERE folder_id=?1",
                params![id, deleted as i64],
            )?;
            transaction.commit()?;
            Ok(())
        })
    }

    pub fn list_proxies(&self) -> AppResult<Vec<ProxyProfile>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id,name,kind,host,port,username,secret_id FROM proxy_profiles ORDER BY name",
            )?;
            let rows = statement.query_map([], |row| {
                let kind: String = row.get(2)?;
                Ok(ProxyProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    kind: ProxyKind::try_from(kind.as_str()).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            2,
                            rusqlite::types::Type::Text,
                            error.into(),
                        )
                    })?,
                    host: row.get(3)?,
                    port: row.get::<_, i64>(4)? as u16,
                    username: row.get(5)?,
                    secret_id: row.get(6)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn save_proxy(
        &self,
        input: &SaveProxyInput,
        secret_id: Option<String>,
    ) -> AppResult<ProxyProfile> {
        let id = input
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO proxy_profiles(id,name,kind,host,port,username,secret_id)
                 VALUES(?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,
                    host=excluded.host,port=excluded.port,username=excluded.username,
                    secret_id=COALESCE(excluded.secret_id,proxy_profiles.secret_id)",
                params![
                    id,
                    input.name.trim(),
                    input.kind.as_str(),
                    input.host.trim(),
                    input.port,
                    input.username,
                    secret_id
                ],
            )?;
            Ok(())
        })?;
        self.list_proxies()?
            .into_iter()
            .find(|proxy| proxy.id == id)
            .ok_or_else(|| AppError::Message("保存代理后读取失败".into()))
    }

    pub fn list_routes(&self) -> AppResult<Vec<RouteProfile>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id,name,auto_select,fixed_candidate_id,candidates_json FROM route_profiles ORDER BY name",
            )?;
            let rows = statement.query_map([], |row| {
                let candidates_json: String = row.get(4)?;
                Ok(RouteProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    auto_select: row.get::<_, i64>(2)? != 0,
                    fixed_candidate_id: row.get(3)?,
                    candidates: serde_json::from_str(&candidates_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            4,
                            rusqlite::types::Type::Text,
                            error.into(),
                        )
                    })?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn save_route(&self, mut route: RouteProfile) -> AppResult<RouteProfile> {
        if route.id.is_empty() {
            route.id = Uuid::new_v4().to_string();
        }
        let candidates_json = serde_json::to_string(&route.candidates)?;
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO route_profiles(id,name,auto_select,fixed_candidate_id,candidates_json)
                 VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name,auto_select=excluded.auto_select,
                    fixed_candidate_id=excluded.fixed_candidate_id,candidates_json=excluded.candidates_json",
                params![
                    route.id,
                    route.name.trim(),
                    route.auto_select as i64,
                    route.fixed_candidate_id,
                    candidates_json
                ],
            )?;
            Ok(())
        })?;
        Ok(route)
    }
}

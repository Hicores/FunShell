use std::{path::Path, sync::Arc};

use parking_lot::Mutex;
use rusqlite::Connection;

use crate::error::AppResult;

#[derive(Clone)]
pub struct Database {
    connection: Arc<Mutex<Connection>>,
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::{
        domain::{AuthMethod, SaveConnectionInput},
        persistence::Database,
    };

    #[test]
    fn migrates_and_round_trips_connection() {
        let directory = tempdir().expect("tempdir");
        let database = Database::open(&directory.path().join("test.db")).expect("database");
        let input = SaveConnectionInput {
            id: None,
            folder_id: None,
            name: "Test server".into(),
            host: "127.0.0.1".into(),
            port: 22,
            username: "root".into(),
            auth_method: AuthMethod::Password,
            password: None,
            key_id: None,
            route_id: None,
            startup_command: None,
            keepalive_seconds: Some(30),
            connect_timeout_seconds: Some(10),
            compression: false,
            auto_reconnect: true,
            sort_order: None,
        };

        let saved = database
            .save_connection(&input, Some("secret-1".into()))
            .expect("save");
        let listed = database.list_connections(false).expect("list");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, saved.id);
        assert_eq!(listed[0].secret_id.as_deref(), Some("secret-1"));
    }
}

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        let connection = Connection::open(path)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        let database = Self {
            connection: Arc::new(Mutex::new(connection)),
        };
        database.migrate()?;
        Ok(database)
    }

    pub(crate) fn with_connection<T>(
        &self,
        operation: impl FnOnce(&Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        operation(&self.connection.lock())
    }

    pub(crate) fn with_connection_mut<T>(
        &self,
        operation: impl FnOnce(&mut Connection) -> AppResult<T>,
    ) -> AppResult<T> {
        operation(&mut self.connection.lock())
    }

    fn migrate(&self) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS schema_version (
                    version INTEGER NOT NULL
                );
                INSERT INTO schema_version(version)
                    SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM schema_version);

                CREATE TABLE IF NOT EXISTS folders (
                    id TEXT PRIMARY KEY,
                    parent_id TEXT REFERENCES folders(id),
                    name TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    deleted INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS connections (
                    id TEXT PRIMARY KEY,
                    folder_id TEXT REFERENCES folders(id),
                    name TEXT NOT NULL,
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    auth_method TEXT NOT NULL,
                    secret_id TEXT,
                    key_id TEXT,
                    route_id TEXT,
                    startup_command TEXT,
                    keepalive_seconds INTEGER NOT NULL DEFAULT 30,
                    connect_timeout_seconds INTEGER NOT NULL DEFAULT 10,
                    compression INTEGER NOT NULL DEFAULT 0,
                    auto_reconnect INTEGER NOT NULL DEFAULT 1,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    deleted INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS proxy_profiles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    username TEXT,
                    secret_id TEXT
                );

                CREATE TABLE IF NOT EXISTS route_profiles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    auto_select INTEGER NOT NULL DEFAULT 1,
                    fixed_candidate_id TEXT,
                    candidates_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS key_profiles (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    algorithm TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    public_key TEXT NOT NULL,
                    secret_id TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS secrets (
                    id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    nonce BLOB,
                    ciphertext BLOB NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS vault_meta (
                    key TEXT PRIMARY KEY,
                    value BLOB NOT NULL
                );

                CREATE TABLE IF NOT EXISTS known_hosts (
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    algorithm TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    trusted_at TEXT NOT NULL,
                    PRIMARY KEY(host, port)
                );

                CREATE TABLE IF NOT EXISTS command_history (
                    id TEXT PRIMARY KEY,
                    connection_id TEXT,
                    command TEXT NOT NULL,
                    favorite INTEGER NOT NULL DEFAULT 0,
                    executed_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS command_presets (
                    id TEXT PRIMARY KEY,
                    scope TEXT NOT NULL,
                    scope_id TEXT,
                    name TEXT NOT NULL,
                    command TEXT NOT NULL,
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    sort_order INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS tunnel_profiles (
                    id TEXT PRIMARY KEY,
                    connection_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    bind_host TEXT NOT NULL,
                    bind_port INTEGER NOT NULL,
                    target_host TEXT,
                    target_port INTEGER,
                    auto_start INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS geoip_cache (
                    ip TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );
                "#,
            )?;
            Ok(())
        })
    }
}

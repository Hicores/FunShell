use std::{path::Path, sync::Arc};

use parking_lot::Mutex;
use rusqlite::Connection;

use crate::error::AppResult;

#[derive(Clone)]
pub struct Database {
    connection: Arc<Mutex<Connection>>,
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

                CREATE TABLE IF NOT EXISTS transfer_history (
                    task_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    source TEXT NOT NULL,
                    destination TEXT NOT NULL,
                    transferred INTEGER NOT NULL,
                    total INTEGER NOT NULL,
                    state TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    viewed INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_transfer_history_updated_at
                    ON transfer_history(updated_at DESC);
                "#,
            )?;
            connection.execute(
                "UPDATE transfer_history SET state='canceled', updated_at=?1 WHERE state='running'",
                [chrono::Utc::now().to_rfc3339()],
            )?;
            Ok(())
        })
    }
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

    #[test]
    fn moves_duplicate_commands_to_the_front_without_duplicate_rows() {
        let directory = tempdir().expect("tempdir");
        let database = Database::open(&directory.path().join("test.db")).expect("database");

        let first = database
            .add_history(Some("connection-1"), "systemctl status nginx")
            .expect("first history");
        database
            .add_history(Some("connection-1"), "uname -a")
            .expect("second command");
        let second = database
            .add_history(Some("connection-1"), "systemctl status nginx")
            .expect("duplicate history");

        assert_eq!(first.id, second.id);
        let history = database
            .list_history(Some("connection-1"), None, 100)
            .expect("list history");
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].command, "systemctl status nginx");
        assert_eq!(history[1].command, "uname -a");
    }

    #[test]
    fn lists_all_command_history_and_filters_by_connection() {
        let directory = tempdir().expect("tempdir");
        let database = Database::open(&directory.path().join("test.db")).expect("database");

        database
            .add_history(Some("connection-1"), "hostname")
            .expect("first server history");
        database
            .add_history(Some("connection-2"), "docker ps")
            .expect("second server history");

        let all = database.list_history(None, None, 100).expect("all history");
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|entry| {
            entry.connection_id.as_deref() == Some("connection-1") && entry.command == "hostname"
        }));
        assert!(all.iter().any(|entry| {
            entry.connection_id.as_deref() == Some("connection-2") && entry.command == "docker ps"
        }));

        let second = database
            .list_history(Some("connection-2"), None, 100)
            .expect("second server history");
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].command, "docker ps");
    }
}

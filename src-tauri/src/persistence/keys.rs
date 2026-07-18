use chrono::Utc;
use rusqlite::{OptionalExtension, params};
use uuid::Uuid;

use crate::{
    domain::{KeyProfile, KnownHostInfo},
    error::{AppError, AppResult},
    persistence::Database,
};

impl Database {
    pub fn list_keys(&self) -> AppResult<Vec<KeyProfile>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id,name,algorithm,fingerprint,public_key,created_at FROM key_profiles ORDER BY name",
            )?;
            let rows = statement.query_map([], |row| {
                Ok(KeyProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    algorithm: row.get(2)?,
                    fingerprint: row.get(3)?,
                    public_key: row.get(4)?,
                    created_at: row.get(5)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn save_key(
        &self,
        name: &str,
        algorithm: &str,
        fingerprint: &str,
        public_key: &str,
        secret_id: &str,
    ) -> AppResult<KeyProfile> {
        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now().to_rfc3339();
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO key_profiles(id,name,algorithm,fingerprint,public_key,secret_id,created_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?7)",
                params![id, name.trim(), algorithm, fingerprint, public_key, secret_id, created_at],
            )?;
            Ok(())
        })?;
        Ok(KeyProfile {
            id,
            name: name.trim().to_owned(),
            algorithm: algorithm.to_owned(),
            fingerprint: fingerprint.to_owned(),
            public_key: public_key.to_owned(),
            created_at,
        })
    }

    pub fn key_secret_id(&self, id: &str) -> AppResult<Option<String>> {
        self.with_connection(|connection| {
            Ok(connection
                .query_row(
                    "SELECT secret_id FROM key_profiles WHERE id=?1",
                    [id],
                    |row| row.get(0),
                )
                .optional()?)
        })
    }

    pub fn delete_key(&self, id: &str) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute("DELETE FROM key_profiles WHERE id=?1", [id])?;
            Ok(())
        })
    }

    pub fn known_host(&self, host: &str, port: u16) -> AppResult<Option<KnownHostInfo>> {
        self.with_connection(|connection| {
            Ok(connection
                .query_row(
                    "SELECT host,port,algorithm,fingerprint FROM known_hosts WHERE host=?1 AND port=?2",
                    params![host, port],
                    |row| {
                        Ok(KnownHostInfo {
                            host: row.get(0)?,
                            port: row.get::<_, i64>(1)? as u16,
                            algorithm: row.get(2)?,
                            fingerprint: row.get(3)?,
                        })
                    },
                )
                .optional()?)
        })
    }

    pub fn trust_host(&self, info: &KnownHostInfo) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO known_hosts(host,port,algorithm,fingerprint,trusted_at)
                 VALUES(?1,?2,?3,?4,?5) ON CONFLICT(host,port) DO UPDATE SET
                    algorithm=excluded.algorithm,fingerprint=excluded.fingerprint,
                    trusted_at=excluded.trusted_at",
                params![
                    info.host,
                    info.port,
                    info.algorithm,
                    info.fingerprint,
                    Utc::now().to_rfc3339()
                ],
            )?;
            Ok(())
        })
    }
}

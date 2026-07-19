use chrono::Utc;
use rusqlite::{OptionalExtension, params};

use crate::{
    domain::{SecretRecord, VaultMode},
    error::{AppError, AppResult},
    persistence::Database,
};

impl Database {
    pub fn upsert_secret(&self, record: &SecretRecord) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO secrets(id,kind,mode,nonce,ciphertext,created_at,updated_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(id) DO UPDATE SET
                    kind=excluded.kind,mode=excluded.mode,nonce=excluded.nonce,
                    ciphertext=excluded.ciphertext,updated_at=excluded.updated_at",
                params![
                    record.id,
                    record.kind,
                    record.mode.as_str(),
                    record.nonce,
                    record.ciphertext,
                    now
                ],
            )?;
            Ok(())
        })
    }

    pub fn secret_by_id(&self, id: &str) -> AppResult<Option<SecretRecord>> {
        self.with_connection(|connection| {
            let value = connection
                .query_row(
                    "SELECT id,kind,mode,nonce,ciphertext FROM secrets WHERE id=?1",
                    [id],
                    |row| {
                        let mode: String = row.get(2)?;
                        Ok(SecretRecord {
                            id: row.get(0)?,
                            kind: row.get(1)?,
                            mode: VaultMode::try_from(mode.as_str()).map_err(|error| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    2,
                                    rusqlite::types::Type::Text,
                                    error.into(),
                                )
                            })?,
                            nonce: row.get(3)?,
                            ciphertext: row.get(4)?,
                        })
                    },
                )
                .optional()?;
            Ok(value)
        })
    }

    pub fn all_secrets(&self) -> AppResult<Vec<SecretRecord>> {
        self.with_connection(|connection| {
            let mut statement =
                connection.prepare("SELECT id,kind,mode,nonce,ciphertext FROM secrets")?;
            let rows = statement.query_map([], |row| {
                let mode: String = row.get(2)?;
                Ok(SecretRecord {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    mode: VaultMode::try_from(mode.as_str()).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            2,
                            rusqlite::types::Type::Text,
                            error.into(),
                        )
                    })?,
                    nonce: row.get(3)?,
                    ciphertext: row.get(4)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn get_vault_meta(&self, key: &str) -> AppResult<Option<Vec<u8>>> {
        self.with_connection(|connection| {
            Ok(connection
                .query_row("SELECT value FROM vault_meta WHERE key=?1", [key], |row| {
                    row.get(0)
                })
                .optional()?)
        })
    }

    pub fn set_vault_meta(&self, key: &str, value: &[u8]) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO vault_meta(key,value) VALUES(?1,?2)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, value],
            )?;
            Ok(())
        })
    }

    pub fn set_vault_meta_batch(&self, values: &[(&str, &[u8])]) -> AppResult<()> {
        self.with_connection_mut(|connection| {
            let transaction = connection.transaction()?;
            for (key, value) in values {
                transaction.execute(
                    "INSERT INTO vault_meta(key,value) VALUES(?1,?2)
                     ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    params![key, value],
                )?;
            }
            transaction.commit()?;
            Ok(())
        })
    }
}

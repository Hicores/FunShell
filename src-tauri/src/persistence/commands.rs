use chrono::Utc;
use rusqlite::{OptionalExtension, params};
use uuid::Uuid;

use crate::{
    domain::{CommandHistoryEntry, CommandPreset, PresetScope},
    error::{AppError, AppResult},
    persistence::Database,
};

impl Database {
    pub fn add_history(
        &self,
        connection_id: Option<&str>,
        command: &str,
    ) -> AppResult<CommandHistoryEntry> {
        let entry = CommandHistoryEntry {
            id: Uuid::new_v4().to_string(),
            connection_id: connection_id.map(str::to_owned),
            command: command.trim_end().to_owned(),
            favorite: false,
            executed_at: Utc::now().to_rfc3339(),
        };
        let saved = self.with_connection_mut(|connection| {
            let transaction = connection.transaction()?;
            let existing: Option<(String, bool)> = transaction
                .query_row(
                    "SELECT id,favorite FROM command_history
                     WHERE connection_id IS ?1 AND command=?2
                     ORDER BY executed_at DESC,id DESC LIMIT 1",
                    params![connection_id, entry.command],
                    |row| Ok((row.get(0)?, row.get::<_, i64>(1)? != 0)),
                )
                .optional()?;
            if let Some((id, favorite)) = existing {
                transaction.execute(
                    "UPDATE command_history SET executed_at=?2 WHERE id=?1",
                    params![id, entry.executed_at],
                )?;
                transaction.execute(
                    "DELETE FROM command_history
                     WHERE connection_id IS ?1 AND command=?2 AND id<>?3",
                    params![connection_id, entry.command, id],
                )?;
                transaction.commit()?;
                return Ok(CommandHistoryEntry {
                    id,
                    connection_id: entry.connection_id,
                    command: entry.command,
                    favorite,
                    executed_at: entry.executed_at,
                });
            }
            transaction.execute(
                "INSERT INTO command_history(id,connection_id,command,favorite,executed_at)
                 VALUES(?1,?2,?3,0,?4)",
                params![
                    entry.id,
                    entry.connection_id,
                    entry.command,
                    entry.executed_at
                ],
            )?;
            transaction.execute(
                "DELETE FROM command_history WHERE favorite=0 AND id IN (
                    SELECT id FROM command_history WHERE connection_id IS ?1
                    ORDER BY executed_at DESC LIMIT -1 OFFSET 1000
                 )",
                [connection_id],
            )?;
            transaction.commit()?;
            Ok(entry.clone())
        })?;
        Ok(saved)
    }

    pub fn list_history(
        &self,
        connection_id: Option<&str>,
        search: Option<&str>,
        limit: u32,
    ) -> AppResult<Vec<CommandHistoryEntry>> {
        self.with_connection(|connection| {
            let pattern = format!("%{}%", search.unwrap_or_default());
            let mut statement = connection.prepare(
                "SELECT id,connection_id,command,favorite,executed_at FROM command_history
                 WHERE (?1 IS NULL OR connection_id=?1) AND command LIKE ?2
                   AND NOT EXISTS (
                       SELECT 1 FROM command_history AS newer
                       WHERE newer.connection_id IS command_history.connection_id
                         AND newer.command=command_history.command
                         AND (newer.executed_at > command_history.executed_at
                              OR (newer.executed_at = command_history.executed_at
                                  AND newer.id > command_history.id))
                   )
                 ORDER BY executed_at DESC LIMIT ?3",
            )?;
            let rows = statement.query_map(params![connection_id, pattern, limit], |row| {
                Ok(CommandHistoryEntry {
                    id: row.get(0)?,
                    connection_id: row.get(1)?,
                    command: row.get(2)?,
                    favorite: row.get::<_, i64>(3)? != 0,
                    executed_at: row.get(4)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn set_history_favorite(&self, id: &str, favorite: bool) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute(
                "UPDATE command_history SET favorite=?2 WHERE id=?1",
                params![id, favorite as i64],
            )?;
            Ok(())
        })
    }

    pub fn clear_history(&self, connection_id: Option<&str>) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute(
                "DELETE FROM command_history WHERE favorite=0 AND (?1 IS NULL OR connection_id=?1)",
                [connection_id],
            )?;
            Ok(())
        })
    }

    pub fn list_presets(&self) -> AppResult<Vec<CommandPreset>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id,scope,scope_id,name,command,tags_json,sort_order
                 FROM command_presets ORDER BY sort_order,name",
            )?;
            let rows = statement.query_map([], |row| {
                let scope: String = row.get(1)?;
                let tags: String = row.get(5)?;
                Ok(CommandPreset {
                    id: row.get(0)?,
                    scope: PresetScope::try_from(scope.as_str()).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            1,
                            rusqlite::types::Type::Text,
                            std::io::Error::new(std::io::ErrorKind::InvalidData, error).into(),
                        )
                    })?,
                    scope_id: row.get(2)?,
                    name: row.get(3)?,
                    command: row.get(4)?,
                    tags: serde_json::from_str(&tags).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            5,
                            rusqlite::types::Type::Text,
                            error.into(),
                        )
                    })?,
                    sort_order: row.get(6)?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn save_preset(&self, mut preset: CommandPreset) -> AppResult<CommandPreset> {
        if preset.id.is_empty() {
            preset.id = Uuid::new_v4().to_string();
        }
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO command_presets(id,scope,scope_id,name,command,tags_json,sort_order)
                 VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET
                    scope=excluded.scope,scope_id=excluded.scope_id,name=excluded.name,
                    command=excluded.command,tags_json=excluded.tags_json,sort_order=excluded.sort_order",
                params![
                    preset.id,
                    preset.scope.as_str(),
                    preset.scope_id,
                    preset.name.trim(),
                    preset.command,
                    serde_json::to_string(&preset.tags)?,
                    preset.sort_order
                ],
            )?;
            Ok(())
        })?;
        Ok(preset)
    }

    pub fn delete_preset(&self, id: &str) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute("DELETE FROM command_presets WHERE id=?1", [id])?;
            Ok(())
        })
    }
}

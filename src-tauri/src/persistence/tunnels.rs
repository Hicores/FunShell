use rusqlite::params;
use uuid::Uuid;

use crate::{
    domain::{TunnelKind, TunnelProfile},
    error::{AppError, AppResult},
    persistence::Database,
};

impl Database {
    pub fn list_tunnels(&self) -> AppResult<Vec<TunnelProfile>> {
        self.with_connection(|connection| {
            let mut statement = connection.prepare(
                "SELECT id,connection_id,name,kind,bind_host,bind_port,target_host,target_port,auto_start
                 FROM tunnel_profiles ORDER BY name",
            )?;
            let rows = statement.query_map([], |row| {
                let kind: String = row.get(3)?;
                Ok(TunnelProfile {
                    id: row.get(0)?,
                    connection_id: row.get(1)?,
                    name: row.get(2)?,
                    kind: TunnelKind::try_from(kind.as_str()).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(
                            3,
                            rusqlite::types::Type::Text,
                            std::io::Error::new(std::io::ErrorKind::InvalidData, error).into(),
                        )
                    })?,
                    bind_host: row.get(4)?,
                    bind_port: row.get::<_, i64>(5)? as u16,
                    target_host: row.get(6)?,
                    target_port: row.get::<_, Option<i64>>(7)?.map(|port| port as u16),
                    auto_start: row.get::<_, i64>(8)? != 0,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>().map_err(AppError::from)
        })
    }

    pub fn save_tunnel(&self, mut profile: TunnelProfile) -> AppResult<TunnelProfile> {
        if profile.id.is_empty() {
            profile.id = Uuid::new_v4().to_string();
        }
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO tunnel_profiles(id,connection_id,name,kind,bind_host,bind_port,target_host,target_port,auto_start)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(id) DO UPDATE SET
                    connection_id=excluded.connection_id,name=excluded.name,kind=excluded.kind,
                    bind_host=excluded.bind_host,bind_port=excluded.bind_port,
                    target_host=excluded.target_host,target_port=excluded.target_port,
                    auto_start=excluded.auto_start",
                params![
                    profile.id,
                    profile.connection_id,
                    profile.name.trim(),
                    profile.kind.as_str(),
                    profile.bind_host,
                    profile.bind_port,
                    profile.target_host,
                    profile.target_port,
                    profile.auto_start as i64
                ],
            )?;
            Ok(())
        })?;
        Ok(profile)
    }

    pub fn delete_tunnel(&self, id: &str) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute("DELETE FROM tunnel_profiles WHERE id=?1", [id])?;
            Ok(())
        })
    }
}

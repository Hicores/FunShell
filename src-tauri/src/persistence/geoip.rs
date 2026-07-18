use chrono::{Duration, Utc};
use rusqlite::{OptionalExtension, params};

use crate::{domain::GeoIpInfo, error::AppResult, persistence::Database};

impl Database {
    pub fn cached_geoip(&self, ip: &str) -> AppResult<Option<GeoIpInfo>> {
        self.with_connection(|connection| {
            let payload: Option<String> = connection
                .query_row(
                    "SELECT payload_json FROM geoip_cache WHERE ip=?1 AND expires_at>?2",
                    params![ip, Utc::now().to_rfc3339()],
                    |row| row.get(0),
                )
                .optional()?;
            payload
                .map(|payload| serde_json::from_str(&payload).map_err(Into::into))
                .transpose()
        })
    }

    pub fn cache_geoip(&self, info: &GeoIpInfo) -> AppResult<()> {
        self.with_connection(|connection| {
            connection.execute(
                "INSERT INTO geoip_cache(ip,payload_json,expires_at) VALUES(?1,?2,?3)
                 ON CONFLICT(ip) DO UPDATE SET payload_json=excluded.payload_json,
                    expires_at=excluded.expires_at",
                params![
                    info.ip,
                    serde_json::to_string(info)?,
                    (Utc::now() + Duration::days(7)).to_rfc3339(),
                ],
            )?;
            Ok(())
        })
    }
}

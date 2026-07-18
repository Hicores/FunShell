use std::{net::IpAddr, str::FromStr, time::Duration};

use chrono::Utc;
use serde_json::Value;

use crate::{
    domain::GeoIpInfo,
    error::{AppError, AppResult},
    persistence::Database,
    settings::SettingsService,
};

pub struct GeoIpService {
    database: Database,
    settings: SettingsService,
    client: reqwest::Client,
}

impl GeoIpService {
    pub fn new(database: Database, settings: SettingsService) -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .user_agent(concat!("FunShell/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| AppError::Message(format!("HTTP 客户端初始化失败: {error}")))?;
        Ok(Self {
            database,
            settings,
            client,
        })
    }

    pub async fn lookup(&self, value: &str) -> AppResult<GeoIpInfo> {
        let ip = IpAddr::from_str(value.trim())
            .map_err(|_| AppError::Validation("GeoIP 查询目标必须是 IP 地址".into()))?;
        if is_local_address(ip) {
            return Ok(GeoIpInfo {
                ip: ip.to_string(),
                private: true,
                country: None,
                region: None,
                city: None,
                isp: None,
                latitude: None,
                longitude: None,
                cached_at: Utc::now().to_rfc3339(),
            });
        }
        let settings = self.settings.get();
        if !settings.geoip_enabled {
            return Err(AppError::Message("IP 地理信息查询已在设置中关闭".into()));
        }
        let normalized = ip.to_string();
        if let Some(cached) = self.database.cached_geoip(&normalized)? {
            return Ok(cached);
        }
        let url = settings.geoip_provider_url.replace("{ip}", &normalized);
        let response = self
            .client
            .get(url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| AppError::Message(format!("GeoIP 查询失败: {error}")))?;
        let payload: Value = response
            .json()
            .await
            .map_err(|error| AppError::Message(format!("GeoIP 响应格式错误: {error}")))?;
        if payload.get("success").and_then(Value::as_bool) == Some(false) {
            let reason = payload
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("提供方返回失败");
            return Err(AppError::Message(format!("GeoIP 查询失败: {reason}")));
        }
        let info = GeoIpInfo {
            ip: normalized,
            private: false,
            country: text(&payload, "country"),
            region: text(&payload, "region").or_else(|| text(&payload, "regionName")),
            city: text(&payload, "city"),
            isp: payload
                .get("connection")
                .and_then(|value| value.get("isp"))
                .and_then(Value::as_str)
                .map(str::to_owned)
                .or_else(|| text(&payload, "isp"))
                .or_else(|| text(&payload, "org")),
            latitude: number(&payload, "latitude").or_else(|| number(&payload, "lat")),
            longitude: number(&payload, "longitude").or_else(|| number(&payload, "lon")),
            cached_at: Utc::now().to_rfc3339(),
        };
        self.database.cache_geoip(&info)?;
        Ok(info)
    }
}

fn text(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn number(payload: &Value, key: &str) -> Option<f64> {
    payload.get(key).and_then(Value::as_f64)
}

fn is_local_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            a == 0
                || a == 10
                || a == 127
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 100 && (64..=127).contains(&b))
                || (a == 192 && b == 0 && c == 2)
                || (a == 198 && (b == 18 || b == 19))
                || (a == 198 && b == 51 && c == 100)
                || (a == 203 && b == 0 && c == 113)
                || a >= 224
        }
        IpAddr::V6(ip) => {
            let segments = ip.segments();
            ip.is_unspecified()
                || ip.is_loopback()
                || ip.is_multicast()
                || (segments[0] & 0xfe00) == 0xfc00
                || (segments[0] & 0xffc0) == 0xfe80
                || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    use super::is_local_address;

    #[test]
    fn keeps_private_and_documentation_addresses_local() {
        assert!(is_local_address(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))));
        assert!(is_local_address(IpAddr::V4(Ipv4Addr::new(203, 0, 113, 8))));
        assert!(is_local_address(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(!is_local_address(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
    }
}

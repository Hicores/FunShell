mod xdb;

use std::{
    collections::HashMap,
    fs::{self, File},
    io::{self, Cursor, Write},
    net::IpAddr,
    path::{Path, PathBuf},
    str::FromStr,
};

use chrono::Utc;
use flate2::read::GzDecoder;
use serde_json::Value;

use crate::{
    domain::GeoIpInfo,
    error::{AppError, AppResult},
    settings::SettingsService,
};

use self::xdb::{IpVersion, XdbSearcher};

const DATA_VERSION: &str = "ip2region-v3.17.0";
const IPV4_DATABASE_SIZE: u64 = 11_114_380;
const IPV6_DATABASE_SIZE: u64 = 37_258_897;
const IPV4_DATABASE_GZIP: &[u8] = include_bytes!("../../assets/geoip/ip2region_v4.xdb.gz");
const IPV6_DATABASE_GZIP: &[u8] = include_bytes!("../../assets/geoip/ip2region_v6.xdb.gz");
const CHINESE_COUNTRY_NAMES: &str = include_str!("../../assets/geoip/countries_zh.json");

pub struct GeoIpService {
    settings: SettingsService,
    ipv4: XdbSearcher,
    ipv6: XdbSearcher,
    countries: HashMap<String, String>,
}

impl GeoIpService {
    pub fn new(config_directory: &Path, settings: SettingsService) -> AppResult<Self> {
        let (ipv4_path, ipv6_path) = install_databases(config_directory)?;
        Ok(Self {
            settings,
            ipv4: XdbSearcher::open(&ipv4_path, IpVersion::V4).map_err(database_error)?,
            ipv6: XdbSearcher::open(&ipv6_path, IpVersion::V6).map_err(database_error)?,
            countries: load_chinese_country_names()?,
        })
    }

    pub fn lookup(&self, value: &str) -> AppResult<GeoIpInfo> {
        let ip = IpAddr::from_str(value.trim())
            .map_err(|_| AppError::Validation("IP 位置查询目标必须是 IP 地址".into()))?;
        if is_local_address(ip) {
            return Ok(empty_info(ip, true));
        }
        if !self.settings.get().geoip_enabled {
            return Err(AppError::Message("本地 IP 地理信息已在设置中关闭".into()));
        }

        let result = match ip {
            IpAddr::V4(_) => self.ipv4.search(ip),
            IpAddr::V6(_) => self.ipv6.search(ip),
        }
        .map_err(database_error)?;
        let Some(record) = result.filter(|record| !record.is_empty()) else {
            return Ok(empty_info(ip, false));
        };
        Ok(parse_record(ip, &record, &self.countries))
    }
}

fn install_databases(config_directory: &Path) -> AppResult<(PathBuf, PathBuf)> {
    let directory = config_directory.join("geoip");
    fs::create_dir_all(&directory).map_err(|error| {
        AppError::Message(format!(
            "本地 IP 数据库目录不可写 {}: {error}",
            directory.display()
        ))
    })?;
    let marker = directory.join("version");
    let refresh_all = fs::read_to_string(&marker)
        .map(|value| value.trim() != DATA_VERSION)
        .unwrap_or(true);
    let ipv4 = directory.join("ip2region_v4.xdb");
    let ipv6 = directory.join("ip2region_v6.xdb");
    ensure_database(&ipv4, IPV4_DATABASE_GZIP, IPV4_DATABASE_SIZE, refresh_all)?;
    ensure_database(&ipv6, IPV6_DATABASE_GZIP, IPV6_DATABASE_SIZE, refresh_all)?;
    fs::write(&marker, DATA_VERSION).map_err(|error| {
        AppError::Message(format!(
            "本地 IP 数据库版本文件不可写 {}: {error}",
            marker.display()
        ))
    })?;
    Ok((ipv4, ipv6))
}

fn ensure_database(
    target: &Path,
    compressed: &[u8],
    expected_size: u64,
    force: bool,
) -> AppResult<()> {
    let current_size = fs::metadata(target).map(|metadata| metadata.len()).ok();
    if !force && current_size == Some(expected_size) {
        return Ok(());
    }

    let temporary = target.with_extension("xdb.tmp");
    let result = (|| -> io::Result<()> {
        let mut decoder = GzDecoder::new(Cursor::new(compressed));
        let mut output = File::create(&temporary)?;
        io::copy(&mut decoder, &mut output)?;
        output.flush()?;
        output.sync_all()?;
        if output.metadata()?.len() != expected_size {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "解压后的数据库大小不正确",
            ));
        }
        drop(output);
        if target.exists() {
            fs::remove_file(target)?;
        }
        fs::rename(&temporary, target)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(AppError::Message(format!(
            "本地 IP 数据库安装失败 {}: {error}",
            target.display()
        )));
    }
    Ok(())
}

fn load_chinese_country_names() -> AppResult<HashMap<String, String>> {
    let payload: Value = serde_json::from_str(CHINESE_COUNTRY_NAMES)?;
    let entries = payload
        .pointer("/main/zh-Hans/localeDisplayNames/territories")
        .and_then(Value::as_object)
        .ok_or_else(|| AppError::Message("内置中文国家名称数据格式错误".into()))?;
    Ok(entries
        .iter()
        .filter(|(code, value)| {
            code.len() == 2
                && code.bytes().all(|character| character.is_ascii_uppercase())
                && value.is_string()
        })
        .map(|(code, value)| {
            (
                code.clone(),
                value.as_str().expect("filtered country name").to_owned(),
            )
        })
        .collect())
}

fn parse_record(ip: IpAddr, record: &str, countries: &HashMap<String, String>) -> GeoIpInfo {
    let mut fields = record.split('|');
    let raw_country = normalized_field(fields.next());
    let raw_region = normalized_field(fields.next());
    let raw_city = normalized_field(fields.next());
    let isp = normalized_field(fields.next()).map(str::to_owned);
    let country_code = normalized_field(fields.next());

    let country = country_code
        .and_then(|code| countries.get(code).cloned())
        .or_else(|| localized_special_country(raw_country))
        .or_else(|| {
            raw_country
                .filter(|value| contains_han(value))
                .map(str::to_owned)
        });
    let region = raw_region
        .filter(|value| contains_han(value))
        .map(str::to_owned);
    let city = raw_city
        .filter(|value| contains_han(value))
        .map(str::to_owned);

    GeoIpInfo {
        ip: ip.to_string(),
        private: false,
        country,
        region,
        city,
        isp,
        latitude: None,
        longitude: None,
        cached_at: Utc::now().to_rfc3339(),
    }
}

fn normalized_field(value: Option<&str>) -> Option<&str> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "0")
}

fn localized_special_country(value: Option<&str>) -> Option<String> {
    match value? {
        "Reserved" => Some("保留地址".into()),
        "Localhost" => Some("本地地址".into()),
        _ => None,
    }
}

fn contains_han(value: &str) -> bool {
    value
        .chars()
        .any(|character| ('\u{3400}'..='\u{9fff}').contains(&character))
}

fn empty_info(ip: IpAddr, private: bool) -> GeoIpInfo {
    GeoIpInfo {
        ip: ip.to_string(),
        private,
        country: None,
        region: None,
        city: None,
        isp: None,
        latitude: None,
        longitude: None,
        cached_at: Utc::now().to_rfc3339(),
    }
}

fn database_error(error: io::Error) -> AppError {
    AppError::Message(format!("本地 IP 数据库查询失败: {error}"))
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

    use tempfile::tempdir;

    use super::{GeoIpService, is_local_address, load_chinese_country_names, parse_record};
    use crate::settings::SettingsService;

    #[test]
    fn keeps_private_and_documentation_addresses_local() {
        assert!(is_local_address(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))));
        assert!(is_local_address(IpAddr::V4(Ipv4Addr::new(203, 0, 113, 8))));
        assert!(is_local_address(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(!is_local_address(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
    }

    #[test]
    fn localizes_country_and_hides_untranslated_foreign_subdivisions() {
        let countries = load_chinese_country_names().expect("country names");
        let info = parse_record(
            "8.8.8.8".parse().expect("ip"),
            "United States|California|Mountain View|Google LLC|US",
            &countries,
        );
        assert_eq!(info.country.as_deref(), Some("美国"));
        assert_eq!(info.region, None);
        assert_eq!(info.city, None);
        assert_eq!(info.isp.as_deref(), Some("Google LLC"));
    }

    #[test]
    fn installs_and_queries_embedded_ipv4_and_ipv6_databases() {
        let directory = tempdir().expect("tempdir");
        let settings =
            SettingsService::load(directory.path().join("settings.json")).expect("settings");
        let service = GeoIpService::new(directory.path(), settings).expect("geoip service");

        let ipv4 = service.lookup("1.1.2.1").expect("IPv4 lookup");
        assert_eq!(ipv4.country.as_deref(), Some("中国"));
        assert_eq!(ipv4.region.as_deref(), Some("福建省"));
        let reported_ip = service
            .lookup("220.167.110.40")
            .expect("reported IPv4 lookup");
        assert_eq!(reported_ip.country.as_deref(), Some("中国"));
        assert!(reported_ip.region.is_some());
        let ipv6 = service
            .lookup("240e:3b7:3273:51d0:cd38:8ae1:e3c0:b708")
            .expect("IPv6 lookup");
        assert_eq!(ipv6.country.as_deref(), Some("中国"));
        assert_eq!(ipv6.city.as_deref(), Some("深圳市"));
    }
}

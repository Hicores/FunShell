use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ServerSnapshot {
    pub uptime_seconds: u64,
    pub load_average: [f64; 3],
    pub cpu_percent: f64,
    pub memory_total: u64,
    pub memory_used: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub interfaces: Vec<NetworkInterface>,
    pub filesystems: Vec<FilesystemInfo>,
    pub top_processes: Vec<ProcessInfo>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterface {
    pub name: String,
    pub received_bytes: u64,
    pub transmitted_bytes: u64,
    pub receive_bps: u64,
    pub transmit_bps: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FilesystemInfo {
    pub device: String,
    pub mount_point: String,
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub usage_percent: f64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub operating_system: String,
    pub kernel: String,
    pub kernel_version: String,
    pub architecture: String,
    pub hostname: String,
    pub cpu_model: String,
    pub cpu_cores: u32,
    pub cpu_frequency_mhz: Option<f64>,
    pub cache: Option<String>,
    pub snapshot: ServerSnapshot,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub user: String,
    pub memory_bytes: u64,
    pub cpu_percent: f64,
    pub name: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDetails {
    pub pid: u32,
    pub name: String,
    pub executable: String,
    pub working_directory: String,
    pub command: String,
    pub environment: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SocketInfo {
    pub protocol: String,
    pub address_family: String,
    pub interface_name: Option<String>,
    pub state: String,
    pub local_address: String,
    pub local_port: Option<u16>,
    pub remote_address: String,
    pub remote_port: Option<u16>,
    pub pid: Option<u32>,
    pub process: Option<String>,
    pub received_bytes: Option<u64>,
    pub sent_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SocketListenerSummary {
    pub protocol: String,
    pub address_family: String,
    pub local_address: String,
    pub local_port: u16,
    pub connection_count: u64,
    pub ip_count: u64,
    pub received_bytes: Option<u64>,
    pub sent_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SocketListenerSnapshot {
    pub listeners: Vec<SocketInfo>,
    pub summaries: Vec<SocketListenerSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteTraceResult {
    pub target: String,
    pub remote: bool,
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoIpInfo {
    pub ip: String,
    pub private: bool,
    pub country: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
    pub isp: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub cached_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresetScope {
    Global,
    Folder,
    Connection,
}

impl PresetScope {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Global => "global",
            Self::Folder => "folder",
            Self::Connection => "connection",
        }
    }
}

impl TryFrom<&str> for PresetScope {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "global" => Ok(Self::Global),
            "folder" => Ok(Self::Folder),
            "connection" => Ok(Self::Connection),
            other => Err(format!("unknown preset scope: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPreset {
    pub id: String,
    pub scope: PresetScope,
    pub scope_id: Option<String>,
    pub name: String,
    pub command: String,
    pub tags: Vec<String>,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandHistoryEntry {
    pub id: String,
    pub connection_id: Option<String>,
    pub command: String,
    pub favorite: bool,
    pub executed_at: String,
}

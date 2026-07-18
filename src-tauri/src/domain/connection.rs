use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFolder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub sort_order: i64,
    pub deleted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    Password,
    PublicKey,
}

impl AuthMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::PublicKey => "public_key",
        }
    }
}

impl TryFrom<&str> for AuthMethod {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "password" => Ok(Self::Password),
            "public_key" => Ok(Self::PublicKey),
            other => Err(format!("unknown auth method: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub folder_id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: AuthMethod,
    pub secret_id: Option<String>,
    pub key_id: Option<String>,
    pub route_id: Option<String>,
    pub startup_command: Option<String>,
    pub keepalive_seconds: u32,
    pub connect_timeout_seconds: u32,
    pub compression: bool,
    pub auto_reconnect: bool,
    pub sort_order: i64,
    pub deleted: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveConnectionInput {
    pub id: Option<String>,
    pub folder_id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: AuthMethod,
    pub password: Option<String>,
    pub key_id: Option<String>,
    pub route_id: Option<String>,
    pub startup_command: Option<String>,
    pub keepalive_seconds: Option<u32>,
    pub connect_timeout_seconds: Option<u32>,
    pub compression: bool,
    pub auto_reconnect: bool,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProxyKind {
    HttpConnect,
    Socks5,
}

impl ProxyKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::HttpConnect => "http_connect",
            Self::Socks5 => "socks5",
        }
    }
}

impl TryFrom<&str> for ProxyKind {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "http_connect" => Ok(Self::HttpConnect),
            "socks5" => Ok(Self::Socks5),
            other => Err(format!("unknown proxy kind: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyProfile {
    pub id: String,
    pub name: String,
    pub kind: ProxyKind,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub secret_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveProxyInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: ProxyKind,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RouteKind {
    Direct,
    Proxy,
    JumpHost,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteCandidate {
    pub id: String,
    pub kind: RouteKind,
    pub proxy_id: Option<String>,
    pub jump_connection_id: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteProfile {
    pub id: String,
    pub name: String,
    pub auto_select: bool,
    pub fixed_candidate_id: Option<String>,
    pub candidates: Vec<RouteCandidate>,
}

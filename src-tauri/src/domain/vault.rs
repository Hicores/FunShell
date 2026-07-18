use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VaultMode {
    Dpapi,
    MasterPassword,
}

impl VaultMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dpapi => "dpapi",
            Self::MasterPassword => "master_password",
        }
    }
}

impl TryFrom<&str> for VaultMode {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "dpapi" => Ok(Self::Dpapi),
            "master_password" => Ok(Self::MasterPassword),
            other => Err(format!("unknown vault mode: {other}")),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultStatus {
    pub mode: VaultMode,
    pub initialized: bool,
    pub unlocked: bool,
}

#[derive(Debug, Clone)]
pub struct SecretRecord {
    pub id: String,
    pub kind: String,
    pub mode: VaultMode,
    pub nonce: Option<Vec<u8>>,
    pub ciphertext: Vec<u8>,
}

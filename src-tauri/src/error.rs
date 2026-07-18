use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Database(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("凭据保险库已锁定")]
    VaultLocked,
    #[error("凭据解密失败")]
    Decryption,
    #[error("{0}")]
    Validation(String),
    #[error(transparent)]
    Ssh(#[from] russh::Error),
    #[error("SFTP 操作失败: {0}")]
    Sftp(String),
    #[error("HOST_KEY_REQUIRED|{host}|{port}|{algorithm}|{fingerprint}")]
    HostKeyRequired {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
    },
    #[error("HOST_KEY_CHANGED|{host}|{port}|{algorithm}|{fingerprint}|{expected}")]
    HostKeyChanged {
        host: String,
        port: u16,
        algorithm: String,
        fingerprint: String,
        expected: String,
    },
}

pub type AppResult<T> = Result<T, AppError>;

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

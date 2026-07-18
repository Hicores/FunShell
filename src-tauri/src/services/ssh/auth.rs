use std::sync::Arc;

use russh::{
    client::{Handle, KeyboardInteractiveAuthResponse},
    keys::{PrivateKeyWithHashAlg, decode_secret_key},
};

use crate::{
    domain::{AuthMethod, ConnectionProfile, StoredPrivateKey},
    error::{AppError, AppResult},
    persistence::Database,
    security::VaultService,
    services::ssh::client::ClientHandler,
};

pub async fn authenticate(
    handle: &mut Handle<ClientHandler>,
    profile: &ConnectionProfile,
    database: &Database,
    vault: &VaultService,
) -> AppResult<()> {
    match profile.auth_method {
        AuthMethod::Password => authenticate_password(handle, profile, vault).await,
        AuthMethod::PublicKey => authenticate_key(handle, profile, database, vault).await,
    }
}

async fn authenticate_password(
    handle: &mut Handle<ClientHandler>,
    profile: &ConnectionProfile,
    vault: &VaultService,
) -> AppResult<()> {
    let secret_id = profile
        .secret_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("连接没有保存密码".into()))?;
    let password_bytes = vault.reveal(secret_id)?;
    let password = String::from_utf8(password_bytes.to_vec())
        .map_err(|_| AppError::Validation("保存的密码不是有效 UTF-8".into()))?;
    if handle
        .authenticate_password(&profile.username, &password)
        .await?
        .success()
    {
        return Ok(());
    }

    let mut response = handle
        .authenticate_keyboard_interactive_start(&profile.username, None::<String>)
        .await?;
    loop {
        match response {
            KeyboardInteractiveAuthResponse::Success => return Ok(()),
            KeyboardInteractiveAuthResponse::Failure { .. } => {
                return Err(AppError::Message("SSH 密码认证失败".into()));
            }
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                response = handle
                    .authenticate_keyboard_interactive_respond(
                        prompts.iter().map(|_| password.clone()).collect(),
                    )
                    .await?;
            }
        }
    }
}

async fn authenticate_key(
    handle: &mut Handle<ClientHandler>,
    profile: &ConnectionProfile,
    database: &Database,
    vault: &VaultService,
) -> AppResult<()> {
    let key_id = profile
        .key_id
        .as_deref()
        .ok_or_else(|| AppError::Validation("连接没有选择私钥".into()))?;
    let secret_id = database
        .key_secret_id(key_id)?
        .ok_or_else(|| AppError::Validation("所选私钥不存在".into()))?;
    let encoded = vault.reveal(&secret_id)?;
    let stored: StoredPrivateKey = serde_json::from_slice(&encoded)?;
    let private_key = decode_secret_key(&stored.private_key, stored.passphrase.as_deref())
        .map_err(|error| AppError::Message(format!("私钥解析失败: {error}")))?;
    let hash = handle.best_supported_rsa_hash().await?.flatten();
    let result = handle
        .authenticate_publickey(
            &profile.username,
            PrivateKeyWithHashAlg::new(Arc::new(private_key), hash),
        )
        .await?;
    if result.success() {
        Ok(())
    } else {
        Err(AppError::Message("SSH 公钥认证失败".into()))
    }
}

use rand_chacha::ChaCha20Rng;
use rand_core::SeedableRng;
use russh::keys::{decode_secret_key, ssh_key};
use tauri::State;

use crate::{
    domain::{KeyProfile, StoredPrivateKey},
    error::{AppError, AppResult},
    state::AppState,
};

#[tauri::command]
pub fn list_keys(state: State<'_, AppState>) -> AppResult<Vec<KeyProfile>> {
    state.database.list_keys()
}

#[tauri::command]
pub fn import_private_key(
    state: State<'_, AppState>,
    name: String,
    private_key: String,
    passphrase: Option<String>,
) -> AppResult<KeyProfile> {
    if name.trim().is_empty() || private_key.trim().is_empty() {
        return Err(AppError::Validation("私钥名称和内容不能为空".into()));
    }
    let decoded = decode_secret_key(&private_key, passphrase.as_deref())
        .map_err(|error| AppError::Validation(format!("私钥格式或口令错误: {error}")))?;
    save_decoded_key(&state, &name, private_key, passphrase, &decoded)
}

#[tauri::command]
pub fn generate_private_key(
    state: State<'_, AppState>,
    name: String,
    algorithm: String,
) -> AppResult<KeyProfile> {
    if name.trim().is_empty() {
        return Err(AppError::Validation("私钥名称不能为空".into()));
    }
    let algorithm = match algorithm.as_str() {
        "ed25519" => ssh_key::Algorithm::Ed25519,
        "rsa" => ssh_key::Algorithm::Rsa { hash: None },
        _ => {
            return Err(AppError::Validation(
                "仅支持生成 Ed25519 或 RSA 私钥".into(),
            ));
        }
    };
    let mut seed = [0_u8; 32];
    getrandom::fill(&mut seed)
        .map_err(|error| AppError::Message(format!("系统随机数获取失败: {error}")))?;
    let mut rng = ChaCha20Rng::from_seed(seed);
    let decoded = ssh_key::PrivateKey::random(&mut rng, algorithm)
        .map_err(|error| AppError::Message(format!("私钥生成失败: {error}")))?;
    let private_key = decoded
        .to_openssh(ssh_key::LineEnding::LF)
        .map_err(|error| AppError::Message(format!("私钥编码失败: {error}")))?
        .to_string();
    save_decoded_key(&state, &name, private_key, None, &decoded)
}

#[tauri::command]
pub fn delete_key(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.database.delete_key(&id)
}

fn save_decoded_key(
    state: &State<'_, AppState>,
    name: &str,
    private_key: String,
    passphrase: Option<String>,
    decoded: &ssh_key::PrivateKey,
) -> AppResult<KeyProfile> {
    let public = decoded
        .public_key()
        .to_openssh()
        .map_err(|error| AppError::Message(format!("公钥编码失败: {error}")))?;
    let fingerprint = decoded
        .public_key()
        .fingerprint(ssh_key::HashAlg::Sha256)
        .to_string();
    let algorithm = decoded.algorithm().to_string();
    let stored = serde_json::to_vec(&StoredPrivateKey {
        private_key,
        passphrase,
    })?;
    let secret_id = state.vault.store("ssh_private_key", &stored)?;
    state
        .database
        .save_key(name, &algorithm, &fingerprint, &public, &secret_id)
}

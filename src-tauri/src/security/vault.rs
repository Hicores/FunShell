use parking_lot::RwLock;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    domain::{SecretRecord, VaultMode, VaultStatus},
    error::{AppError, AppResult},
    persistence::Database,
    security::crypto::{
        aes_decrypt, aes_encrypt, derive_key, dpapi_decrypt, dpapi_encrypt, random_bytes,
    },
};

const MODE_KEY: &str = "mode";
const MASTER_SALT_KEY: &str = "master_salt";
const MASTER_NONCE_KEY: &str = "master_nonce";
const MASTER_CHECK_KEY: &str = "master_check";
const MASTER_WRAPPED_KEY_NONCE_KEY: &str = "master_wrapped_key_nonce";
const MASTER_WRAPPED_KEY_KEY: &str = "master_wrapped_key";
const DPAPI_WRAPPED_KEY_KEY: &str = "dpapi_wrapped_key";
const CHECK_VALUE: &[u8] = b"funshell-vault-check-v1";
const VAULT_KEY_LENGTH: usize = 32;

pub struct VaultService {
    database: Database,
    mode: RwLock<VaultMode>,
    vault_key: RwLock<Option<Zeroizing<Vec<u8>>>>,
}

impl VaultService {
    pub fn new(database: Database) -> AppResult<Self> {
        let mode = database
            .get_vault_meta(MODE_KEY)?
            .and_then(|value| String::from_utf8(value).ok())
            .and_then(|value| VaultMode::try_from(value.as_str()).ok())
            .unwrap_or(VaultMode::Dpapi);
        if database.get_vault_meta(MODE_KEY)?.is_none() {
            database.set_vault_meta(MODE_KEY, mode.as_str().as_bytes())?;
        }
        let service = Self {
            database,
            mode: RwLock::new(mode),
            vault_key: RwLock::new(None),
        };
        if mode == VaultMode::MasterPassword {
            service.try_dpapi_auto_unlock()?;
        }
        Ok(service)
    }

    pub fn status(&self) -> AppResult<VaultStatus> {
        let mode = *self.mode.read();
        Ok(VaultStatus {
            mode,
            initialized: self.database.get_vault_meta(MASTER_SALT_KEY)?.is_some(),
            unlocked: mode == VaultMode::Dpapi || self.vault_key.read().is_some(),
        })
    }

    pub fn initialize_master(&self, password: &str) -> AppResult<()> {
        validate_master_password(password)?;
        if self.database.get_vault_meta(MASTER_SALT_KEY)?.is_some() {
            return Err(AppError::Validation("主密码保险库已经初始化".into()));
        }

        let salt = random_bytes::<16>();
        let password_key = Zeroizing::new(derive_key(password, &salt)?);
        let mut vault_key = random_bytes::<VAULT_KEY_LENGTH>();
        let (check_nonce, check) = aes_encrypt(password_key.as_ref(), CHECK_VALUE)?;
        let (wrapped_nonce, wrapped_key) = aes_encrypt(password_key.as_ref(), &vault_key)?;
        let dpapi_wrapped_key = dpapi_encrypt(&vault_key)?;

        self.database.set_vault_meta_batch(&[
            (MASTER_SALT_KEY, &salt),
            (MASTER_NONCE_KEY, &check_nonce),
            (MASTER_CHECK_KEY, &check),
            (MASTER_WRAPPED_KEY_NONCE_KEY, &wrapped_nonce),
            (MASTER_WRAPPED_KEY_KEY, &wrapped_key),
            (DPAPI_WRAPPED_KEY_KEY, &dpapi_wrapped_key),
        ])?;
        *self.vault_key.write() = Some(Zeroizing::new(vault_key.to_vec()));
        vault_key.zeroize();
        Ok(())
    }

    pub fn unlock(&self, password: &str) -> AppResult<()> {
        validate_master_password(password)?;
        let salt = self
            .database
            .get_vault_meta(MASTER_SALT_KEY)?
            .ok_or_else(|| AppError::Validation("主密码保险库尚未初始化".into()))?;
        let password_key = Zeroizing::new(derive_key(password, &salt)?);
        let mut vault_key = match (
            self.database.get_vault_meta(MASTER_WRAPPED_KEY_NONCE_KEY)?,
            self.database.get_vault_meta(MASTER_WRAPPED_KEY_KEY)?,
        ) {
            (Some(nonce), Some(wrapped_key)) => {
                aes_decrypt(password_key.as_ref(), &nonce, &wrapped_key)?
            }
            (None, None) => self.unlock_legacy_master_key(password_key.as_ref())?,
            _ => return Err(AppError::Decryption),
        };
        if vault_key.len() != VAULT_KEY_LENGTH {
            vault_key.zeroize();
            return Err(AppError::Decryption);
        }

        let dpapi_wrapped_key = dpapi_encrypt(&vault_key)?;
        if self
            .database
            .get_vault_meta(MASTER_WRAPPED_KEY_KEY)?
            .is_none()
        {
            let (wrapped_nonce, wrapped_key) = aes_encrypt(password_key.as_ref(), &vault_key)?;
            self.database.set_vault_meta_batch(&[
                (MASTER_WRAPPED_KEY_NONCE_KEY, &wrapped_nonce),
                (MASTER_WRAPPED_KEY_KEY, &wrapped_key),
                (DPAPI_WRAPPED_KEY_KEY, &dpapi_wrapped_key),
            ])?;
        } else {
            self.database
                .set_vault_meta(DPAPI_WRAPPED_KEY_KEY, &dpapi_wrapped_key)?;
        }

        *self.vault_key.write() = Some(Zeroizing::new(vault_key.clone()));
        vault_key.zeroize();
        Ok(())
    }

    pub fn lock(&self) {
        if let Some(mut key) = self.vault_key.write().take() {
            key.zeroize();
        }
    }

    pub fn store(&self, kind: &str, plaintext: &[u8]) -> AppResult<String> {
        let id = Uuid::new_v4().to_string();
        let record = self.encrypt_record(id.clone(), kind.to_owned(), plaintext)?;
        self.database.upsert_secret(&record)?;
        Ok(id)
    }

    pub fn replace(&self, id: &str, kind: &str, plaintext: &[u8]) -> AppResult<()> {
        let record = self.encrypt_record(id.to_owned(), kind.to_owned(), plaintext)?;
        self.database.upsert_secret(&record)
    }

    pub fn reveal(&self, id: &str) -> AppResult<Zeroizing<Vec<u8>>> {
        let record = self
            .database
            .secret_by_id(id)?
            .ok_or_else(|| AppError::Message("凭据不存在".into()))?;
        Ok(Zeroizing::new(self.decrypt_record(&record)?))
    }

    pub fn change_mode(&self, target: VaultMode, password: Option<&str>) -> AppResult<()> {
        let previous = *self.mode.read();
        if previous == target {
            return Ok(());
        }
        if target == VaultMode::MasterPassword {
            if self.database.get_vault_meta(MASTER_SALT_KEY)?.is_none() {
                self.initialize_master(password.ok_or_else(|| {
                    AppError::Validation("切换到主密码模式需要提供主密码".into())
                })?)?;
            } else if self.vault_key.read().is_none() {
                self.unlock(password.ok_or(AppError::VaultLocked)?)?;
            }
        }

        let existing = self.database.all_secrets()?;
        let plaintext = existing
            .iter()
            .map(|record| Ok((record, Zeroizing::new(self.decrypt_record(record)?))))
            .collect::<AppResult<Vec<_>>>()?;

        *self.mode.write() = target;
        let migration = plaintext.into_iter().try_for_each(|(record, value)| {
            let migrated = self.encrypt_record(record.id.clone(), record.kind.clone(), &value)?;
            self.database.upsert_secret(&migrated)
        });
        if let Err(error) = migration {
            *self.mode.write() = previous;
            return Err(error);
        }
        self.database
            .set_vault_meta(MODE_KEY, target.as_str().as_bytes())?;
        if target == VaultMode::Dpapi {
            self.lock();
        }
        Ok(())
    }

    fn try_dpapi_auto_unlock(&self) -> AppResult<bool> {
        let Some(wrapped_key) = self.database.get_vault_meta(DPAPI_WRAPPED_KEY_KEY)? else {
            return Ok(false);
        };
        let Ok(mut vault_key) = dpapi_decrypt(&wrapped_key) else {
            return Ok(false);
        };
        if vault_key.len() != VAULT_KEY_LENGTH {
            vault_key.zeroize();
            return Ok(false);
        }
        *self.vault_key.write() = Some(Zeroizing::new(vault_key.clone()));
        vault_key.zeroize();
        Ok(true)
    }

    fn unlock_legacy_master_key(&self, password_key: &[u8]) -> AppResult<Vec<u8>> {
        let nonce = self
            .database
            .get_vault_meta(MASTER_NONCE_KEY)?
            .ok_or(AppError::Decryption)?;
        let check = self
            .database
            .get_vault_meta(MASTER_CHECK_KEY)?
            .ok_or(AppError::Decryption)?;
        if aes_decrypt(password_key, &nonce, &check)? != CHECK_VALUE {
            return Err(AppError::Decryption);
        }
        Ok(password_key.to_vec())
    }

    fn encrypt_record(
        &self,
        id: String,
        kind: String,
        plaintext: &[u8],
    ) -> AppResult<SecretRecord> {
        let mode = *self.mode.read();
        let (nonce, ciphertext) = match mode {
            VaultMode::Dpapi => (None, dpapi_encrypt(plaintext)?),
            VaultMode::MasterPassword => {
                let guard = self.vault_key.read();
                let key = guard.as_ref().ok_or(AppError::VaultLocked)?;
                let (nonce, ciphertext) = aes_encrypt(key, plaintext)?;
                (Some(nonce), ciphertext)
            }
        };
        Ok(SecretRecord {
            id,
            kind,
            mode,
            nonce,
            ciphertext,
        })
    }

    fn decrypt_record(&self, record: &SecretRecord) -> AppResult<Vec<u8>> {
        match record.mode {
            VaultMode::Dpapi => dpapi_decrypt(&record.ciphertext),
            VaultMode::MasterPassword => {
                let guard = self.vault_key.read();
                let key = guard.as_ref().ok_or(AppError::VaultLocked)?;
                aes_decrypt(
                    key,
                    record.nonce.as_deref().ok_or(AppError::Decryption)?,
                    &record.ciphertext,
                )
            }
        }
    }
}

fn validate_master_password(password: &str) -> AppResult<()> {
    if password.chars().count() < 9 {
        return Err(AppError::Validation("主密码至少需要 9 个字符".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::{
        domain::{SecretRecord, VaultMode},
        persistence::Database,
        security::crypto::{aes_decrypt, aes_encrypt, derive_key, random_bytes},
    };

    use super::{
        CHECK_VALUE, DPAPI_WRAPPED_KEY_KEY, MASTER_CHECK_KEY, MASTER_NONCE_KEY, MASTER_SALT_KEY,
        MASTER_WRAPPED_KEY_KEY, MODE_KEY, VaultService, validate_master_password,
    };

    #[test]
    fn requires_at_least_nine_master_password_characters() {
        assert!(validate_master_password("123456789").is_ok());
        assert!(validate_master_password("12345678").is_err());
    }

    #[test]
    fn stores_dpapi_and_uses_dpapi_to_auto_unlock_the_master_key() {
        let directory = tempdir().expect("tempdir");
        let database = Database::open(&directory.path().join("vault.db")).expect("database");
        let vault = VaultService::new(database.clone()).expect("vault");
        let default_status = vault.status().expect("default status");
        assert_eq!(default_status.mode, VaultMode::Dpapi);
        assert!(!default_status.initialized);
        assert!(default_status.unlocked);
        let secret_id = vault.store("test", b"sensitive-value").expect("store");
        assert_eq!(
            &*vault.reveal(&secret_id).expect("reveal"),
            b"sensitive-value"
        );

        vault
            .change_mode(
                VaultMode::MasterPassword,
                Some("correct horse battery staple"),
            )
            .expect("migrate");
        let record = database
            .secret_by_id(&secret_id)
            .expect("secret")
            .expect("record");
        assert_eq!(record.mode, VaultMode::MasterPassword);
        let salt = database
            .get_vault_meta(MASTER_SALT_KEY)
            .expect("salt")
            .expect("master salt");
        let derived_key = derive_key("correct horse battery staple", &salt).expect("derive");
        assert!(
            aes_decrypt(
                &derived_key,
                record.nonce.as_deref().expect("secret nonce"),
                &record.ciphertext,
            )
            .is_err()
        );
        drop(vault);

        let reopened = VaultService::new(database.clone()).expect("reopen");
        assert!(reopened.status().expect("status").unlocked);
        assert_eq!(
            &*reopened.reveal(&secret_id).expect("auto reveal"),
            b"sensitive-value"
        );
    }

    #[test]
    fn asks_for_the_master_password_when_dpapi_binding_changes_and_repairs_it() {
        let directory = tempdir().expect("tempdir");
        let database = Database::open(&directory.path().join("vault.db")).expect("database");
        let vault = VaultService::new(database.clone()).expect("vault");
        let secret_id = vault.store("test", b"portable-value").expect("store");
        vault
            .change_mode(VaultMode::MasterPassword, Some("portable password"))
            .expect("migrate");
        drop(vault);

        database
            .set_vault_meta(DPAPI_WRAPPED_KEY_KEY, b"different Windows user")
            .expect("replace DPAPI binding");
        let moved = VaultService::new(database.clone()).expect("moved vault");
        assert!(!moved.status().expect("locked status").unlocked);
        assert!(moved.unlock("wrong password").is_err());
        moved.unlock("portable password").expect("master unlock");
        assert_eq!(
            &*moved.reveal(&secret_id).expect("reveal after unlock"),
            b"portable-value"
        );
        drop(moved);

        let rebound = VaultService::new(database).expect("rebound vault");
        assert!(rebound.status().expect("rebound status").unlocked);
        assert_eq!(
            &*rebound.reveal(&secret_id).expect("automatic reveal"),
            b"portable-value"
        );
    }

    #[test]
    fn upgrades_legacy_master_password_metadata_after_unlock() {
        let directory = tempdir().expect("tempdir");
        let database = Database::open(&directory.path().join("vault.db")).expect("database");
        let password = "legacy master password";
        let salt = random_bytes::<16>();
        let legacy_key = derive_key(password, &salt).expect("derive legacy key");
        let (check_nonce, check) = aes_encrypt(&legacy_key, CHECK_VALUE).expect("check");
        let (secret_nonce, ciphertext) =
            aes_encrypt(&legacy_key, b"legacy-value").expect("encrypt legacy value");
        database
            .set_vault_meta_batch(&[
                (MODE_KEY, VaultMode::MasterPassword.as_str().as_bytes()),
                (MASTER_SALT_KEY, &salt),
                (MASTER_NONCE_KEY, &check_nonce),
                (MASTER_CHECK_KEY, &check),
            ])
            .expect("legacy metadata");
        database
            .upsert_secret(&SecretRecord {
                id: "legacy-secret".into(),
                kind: "test".into(),
                mode: VaultMode::MasterPassword,
                nonce: Some(secret_nonce),
                ciphertext,
            })
            .expect("legacy secret");

        let vault = VaultService::new(database.clone()).expect("legacy vault");
        assert!(!vault.status().expect("legacy status").unlocked);
        vault.unlock(password).expect("legacy unlock");
        assert_eq!(
            &*vault.reveal("legacy-secret").expect("legacy reveal"),
            b"legacy-value"
        );
        assert!(
            database
                .get_vault_meta(MASTER_WRAPPED_KEY_KEY)
                .expect("wrapped key")
                .is_some()
        );
        drop(vault);
        assert!(
            VaultService::new(database)
                .expect("legacy auto unlock")
                .status()
                .expect("legacy auto status")
                .unlocked
        );
    }
}

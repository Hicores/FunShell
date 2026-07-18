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
const CHECK_VALUE: &[u8] = b"funshell-vault-check-v1";

pub struct VaultService {
    database: Database,
    mode: RwLock<VaultMode>,
    master_key: RwLock<Option<Zeroizing<Vec<u8>>>>,
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
        Ok(Self {
            database,
            mode: RwLock::new(mode),
            master_key: RwLock::new(None),
        })
    }

    pub fn status(&self) -> AppResult<VaultStatus> {
        let mode = *self.mode.read();
        Ok(VaultStatus {
            mode,
            initialized: self.database.get_vault_meta(MASTER_CHECK_KEY)?.is_some(),
            unlocked: mode == VaultMode::Dpapi || self.master_key.read().is_some(),
        })
    }

    pub fn initialize_master(&self, password: &str) -> AppResult<()> {
        validate_master_password(password)?;
        let salt = random_bytes::<16>();
        let key = derive_key(password, &salt)?;
        let (nonce, check) = aes_encrypt(&key, CHECK_VALUE)?;
        self.database.set_vault_meta(MASTER_SALT_KEY, &salt)?;
        self.database.set_vault_meta(MASTER_NONCE_KEY, &nonce)?;
        self.database.set_vault_meta(MASTER_CHECK_KEY, &check)?;
        *self.master_key.write() = Some(Zeroizing::new(key.to_vec()));
        Ok(())
    }

    pub fn unlock(&self, password: &str) -> AppResult<()> {
        let salt = self
            .database
            .get_vault_meta(MASTER_SALT_KEY)?
            .ok_or_else(|| AppError::Validation("主密码保险库尚未初始化".into()))?;
        let nonce = self
            .database
            .get_vault_meta(MASTER_NONCE_KEY)?
            .ok_or(AppError::Decryption)?;
        let check = self
            .database
            .get_vault_meta(MASTER_CHECK_KEY)?
            .ok_or(AppError::Decryption)?;
        let key = derive_key(password, &salt)?;
        if aes_decrypt(&key, &nonce, &check)? != CHECK_VALUE {
            return Err(AppError::Decryption);
        }
        *self.master_key.write() = Some(Zeroizing::new(key.to_vec()));
        Ok(())
    }

    pub fn lock(&self) {
        if let Some(mut key) = self.master_key.write().take() {
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
        if target == VaultMode::MasterPassword {
            if self.database.get_vault_meta(MASTER_CHECK_KEY)?.is_none() {
                self.initialize_master(password.ok_or_else(|| {
                    AppError::Validation("切换到主密码模式需要提供主密码".into())
                })?)?;
            } else if self.master_key.read().is_none() {
                self.unlock(password.ok_or(AppError::VaultLocked)?)?;
            }
        }

        let existing = self.database.all_secrets()?;
        let plaintext = existing
            .iter()
            .map(|record| Ok((record, Zeroizing::new(self.decrypt_record(record)?))))
            .collect::<AppResult<Vec<_>>>()?;

        let previous = *self.mode.read();
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
                let guard = self.master_key.read();
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
                let guard = self.master_key.read();
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
    if password.chars().count() < 10 {
        return Err(AppError::Validation("主密码至少需要 10 个字符".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::{domain::VaultMode, persistence::Database, security::VaultService};

    #[test]
    fn stores_dpapi_and_migrates_to_master_password() {
        let directory = tempdir().expect("tempdir");
        let database = Database::open(&directory.path().join("vault.db")).expect("database");
        let vault = VaultService::new(database).expect("vault");
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
        vault.lock();
        assert!(vault.reveal(&secret_id).is_err());
        vault
            .unlock("correct horse battery staple")
            .expect("unlock");
        assert_eq!(
            &*vault.reveal(&secret_id).expect("reveal"),
            b"sensitive-value"
        );
    }
}

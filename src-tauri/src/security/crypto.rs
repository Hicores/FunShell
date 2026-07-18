use std::ptr;

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use argon2::Argon2;
use rand::{RngCore, rngs::OsRng};
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::Cryptography::{
        CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN, CryptProtectData, CryptUnprotectData,
    },
};

use crate::error::{AppError, AppResult};

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0_u8; N];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

pub fn derive_key(password: &str, salt: &[u8]) -> AppResult<[u8; 32]> {
    let mut output = [0_u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut output)
        .map_err(|error| AppError::Message(format!("主密码派生失败: {error}")))?;
    Ok(output)
}

pub fn aes_encrypt(key: &[u8], plaintext: &[u8]) -> AppResult<(Vec<u8>, Vec<u8>)> {
    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|_| AppError::Message("保险库密钥长度错误".into()))?;
    let nonce_bytes = random_bytes::<12>();
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext)
        .map_err(|_| AppError::Message("凭据加密失败".into()))?;
    Ok((nonce_bytes.to_vec(), ciphertext))
}

pub fn aes_decrypt(key: &[u8], nonce: &[u8], ciphertext: &[u8]) -> AppResult<Vec<u8>> {
    if nonce.len() != 12 {
        return Err(AppError::Decryption);
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| AppError::Decryption)?;
    cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| AppError::Decryption)
}

pub fn dpapi_encrypt(plaintext: &[u8]) -> AppResult<Vec<u8>> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: plaintext.len() as u32,
        pbData: plaintext.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let result = unsafe {
        CryptProtectData(
            &input,
            ptr::null(),
            ptr::null(),
            ptr::null_mut(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if result == 0 {
        return Err(AppError::Message("Windows DPAPI 加密失败".into()));
    }
    let encrypted =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(encrypted)
}

pub fn dpapi_decrypt(ciphertext: &[u8]) -> AppResult<Vec<u8>> {
    let input = CRYPT_INTEGER_BLOB {
        cbData: ciphertext.len() as u32,
        pbData: ciphertext.as_ptr().cast_mut(),
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let result = unsafe {
        CryptUnprotectData(
            &input,
            ptr::null_mut(),
            ptr::null(),
            ptr::null_mut(),
            ptr::null(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };
    if result == 0 {
        return Err(AppError::Decryption);
    }
    let plaintext =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
    unsafe { LocalFree(output.pbData.cast()) };
    Ok(plaintext)
}

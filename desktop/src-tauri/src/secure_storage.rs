use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::{fs, io, path::PathBuf};
use tauri::{AppHandle, Manager};

const SERVICE: &str = "RoboSats Exp";
const MAX_SECRET_BYTES: usize = 16 * 1024;

#[derive(Serialize, Deserialize)]
struct EncryptedValue {
    version: u8,
    nonce: String,
    ciphertext: String,
}

pub fn get(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    validate_key(key)?;
    match keyring::Entry::new(SERVICE, key).and_then(|entry| entry.get_password()) {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => fallback_get(app, key),
        Err(_) => fallback_get(app, key),
    }
}

pub fn set(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    validate_key(key)?;
    if value.len() > MAX_SECRET_BYTES {
        return Err("Secret is too large".into());
    }
    match keyring::Entry::new(SERVICE, key).and_then(|entry| entry.set_password(value)) {
        Ok(()) => {
            let _ = fallback_delete(app, key);
            Ok(())
        }
        Err(_) => fallback_set(app, key, value),
    }
}

pub fn delete(app: &AppHandle, key: &str) -> Result<(), String> {
    validate_key(key)?;
    if let Ok(entry) = keyring::Entry::new(SERVICE, key) {
        let _ = entry.delete_credential();
    }
    fallback_delete(app, key)
}

fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty()
        || key.len() > 128
        || !key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "_.:-".contains(character))
    {
        return Err("Invalid secret key".into());
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn fallback_get(app: &AppHandle, key: &str) -> Result<Option<String>, String> {
    let path = fallback_value_path(app, key)?;
    let encoded = match fs::read_to_string(path) {
        Ok(value) => value,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let value: EncryptedValue =
        serde_json::from_str(&encoded).map_err(|error| error.to_string())?;
    if value.version != 1 {
        return Err("Unsupported secure-storage version".into());
    }
    let nonce = STANDARD
        .decode(value.nonce)
        .map_err(|error| error.to_string())?;
    let ciphertext = STANDARD
        .decode(value.ciphertext)
        .map_err(|error| error.to_string())?;
    if nonce.len() != 24 {
        return Err("Invalid secure-storage nonce".into());
    }
    let cipher = XChaCha20Poly1305::new_from_slice(&fallback_key(app)?)
        .map_err(|error| error.to_string())?;
    let plaintext = cipher
        .decrypt(XNonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| "Could not decrypt secure storage".to_owned())?;
    String::from_utf8(plaintext)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "linux"))]
fn fallback_get(_app: &AppHandle, _key: &str) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(target_os = "linux")]
fn fallback_set(app: &AppHandle, key: &str, value: &str) -> Result<(), String> {
    let cipher = XChaCha20Poly1305::new_from_slice(&fallback_key(app)?)
        .map_err(|error| error.to_string())?;
    let mut nonce = [0_u8; 24];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), value.as_bytes())
        .map_err(|_| "Could not encrypt secure storage".to_owned())?;
    let encoded = serde_json::to_vec(&EncryptedValue {
        version: 1,
        nonce: STANDARD.encode(nonce),
        ciphertext: STANDARD.encode(ciphertext),
    })
    .map_err(|error| error.to_string())?;
    write_private(fallback_value_path(app, key)?, &encoded).map_err(|error| error.to_string())
}

#[cfg(not(target_os = "linux"))]
fn fallback_set(_app: &AppHandle, _key: &str, _value: &str) -> Result<(), String> {
    Err("The operating-system credential store is unavailable".into())
}

#[cfg(target_os = "linux")]
fn fallback_delete(app: &AppHandle, key: &str) -> Result<(), String> {
    match fs::remove_file(fallback_value_path(app, key)?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(not(target_os = "linux"))]
fn fallback_delete(_app: &AppHandle, _key: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "linux")]
fn fallback_key(app: &AppHandle) -> Result<[u8; 32], String> {
    let directory = fallback_directory(app)?;
    let path = directory.join("device.key");
    match fs::read(&path) {
        Ok(bytes) if bytes.len() == 32 => {
            let mut key = [0_u8; 32];
            key.copy_from_slice(&bytes);
            Ok(key)
        }
        Ok(_) => Err("Invalid secure-storage key".into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let mut key = [0_u8; 32];
            OsRng.fill_bytes(&mut key);
            write_private(path, &key).map_err(|write_error| write_error.to_string())?;
            Ok(key)
        }
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(target_os = "linux")]
fn fallback_value_path(app: &AppHandle, key: &str) -> Result<PathBuf, String> {
    Ok(fallback_directory(app)?.join(format!("{key}.json")))
}

#[cfg(target_os = "linux")]
fn fallback_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("secure-store");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    set_private_permissions(&directory, true).map_err(|error| error.to_string())?;
    Ok(directory)
}

#[cfg(target_os = "linux")]
fn write_private(path: PathBuf, value: &[u8]) -> io::Result<()> {
    fs::write(&path, value)?;
    set_private_permissions(&path, false)
}

#[cfg(target_os = "linux")]
fn set_private_permissions(path: &std::path::Path, directory: bool) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(
        path,
        fs::Permissions::from_mode(if directory { 0o700 } else { 0o600 }),
    )
}

//! Archivio della sessione Supabase dell'utente.
//!
//! Il client Supabase del frontend salva qui la sessione (access e refresh
//! token) e il code verifier del login PKCE, al posto del localStorage in
//! chiaro della webview. Una sessione pesa qualche KB, troppo per il
//! Credential Manager di Windows (2560 byte a voce): nel portachiavi del
//! sistema va quindi solo una chiave casuale di 32 byte, e ogni valore sta in
//! un file cifrato con ChaCha20-Poly1305 nella cartella dati dell'app.
//!
//! - il nome della voce è anche dato autenticato: un file rinominato non si
//!   apre sotto un altro nome;
//! - un file che non si decifra (chiave cambiata, file rovinato) si cancella e
//!   vale come assente: l'utente rifà il login, niente di peggio;
//! - i nomi sono quelli di supabase-js (`sb-<ref>-auth-token`, ...): altro
//!   non passa, così il comando non diventa uno scrittore di file arbitrari.

use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng, Payload},
    ChaCha20Poly1305, Key, Nonce,
};
use serde::Serialize;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::Manager;
use zeroize::Zeroizing;

const KEYRING_SERVICE: &str = "ai.jobhunterteam.desktop";
const KEYRING_ACCOUNT: &str = "auth-store-key";
const STORE_DIR: &str = "auth";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const MAX_NAME_LEN: usize = 128;
const MAX_VALUE_BYTES: usize = 64 * 1024;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthStoreError {
    code: &'static str,
}

fn failure(code: &'static str) -> AuthStoreError {
    AuthStoreError { code }
}

#[tauri::command]
pub(crate) fn auth_store_get(
    app: tauri::AppHandle,
    name: String,
) -> Result<Option<String>, AuthStoreError> {
    validate_name(&name)?;
    let dir = store_dir(&app)?;
    let path = entry_path(&dir, &name);
    if !path.exists() {
        return Ok(None);
    }
    let Some(key) = keyring_key(false)? else {
        // Il file c'è ma la chiave no: illeggibile per sempre.
        let _ = fs::remove_file(&path);
        return Ok(None);
    };
    read_entry(&path, &name, &key)
}

#[tauri::command]
pub(crate) fn auth_store_set(
    app: tauri::AppHandle,
    name: String,
    value: String,
) -> Result<(), AuthStoreError> {
    validate_name(&name)?;
    if value.len() > MAX_VALUE_BYTES {
        return Err(failure("value_too_large"));
    }
    let dir = store_dir(&app)?;
    let key = keyring_key(true)?.ok_or_else(|| failure("keyring_failed"))?;
    write_entry(&dir, &name, &value, &key)
}

#[tauri::command]
pub(crate) fn auth_store_remove(app: tauri::AppHandle, name: String) -> Result<(), AuthStoreError> {
    validate_name(&name)?;
    let dir = store_dir(&app)?;
    remove_entry(&dir, &name)
}

fn validate_name(name: &str) -> Result<(), AuthStoreError> {
    let valid = !name.is_empty()
        && name.len() <= MAX_NAME_LEN
        && !name.starts_with('.')
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'));
    if valid {
        Ok(())
    } else {
        Err(failure("invalid_name"))
    }
}

fn store_dir(app: &tauri::AppHandle) -> Result<PathBuf, AuthStoreError> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join(STORE_DIR))
        .map_err(|_| failure("data_dir_missing"))
}

fn entry_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.bin"))
}

/// Chiave dal portachiavi del sistema; con `create` la genera se manca.
fn keyring_key(create: bool) -> Result<Option<Zeroizing<[u8; KEY_LEN]>>, AuthStoreError> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|_| failure("keyring_failed"))?;
    match entry.get_secret() {
        Ok(secret) => {
            let secret = Zeroizing::new(secret);
            if secret.len() == KEY_LEN {
                let mut key = Zeroizing::new([0u8; KEY_LEN]);
                key.copy_from_slice(&secret);
                return Ok(Some(key));
            }
            // Voce di forma sbagliata: la si rimpiazza, i file vecchi decadono.
            if !create {
                return Ok(None);
            }
        }
        Err(keyring::Error::NoEntry) if !create => return Ok(None),
        Err(keyring::Error::NoEntry) => {}
        Err(_) => return Err(failure("keyring_failed")),
    }
    let generated = ChaCha20Poly1305::generate_key(&mut OsRng);
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    key.copy_from_slice(generated.as_slice());
    entry
        .set_secret(key.as_slice())
        .map_err(|_| failure("keyring_failed"))?;
    Ok(Some(key))
}

fn cipher(key: &[u8; KEY_LEN]) -> ChaCha20Poly1305 {
    ChaCha20Poly1305::new(Key::from_slice(key))
}

fn read_entry(
    path: &Path,
    name: &str,
    key: &[u8; KEY_LEN],
) -> Result<Option<String>, AuthStoreError> {
    // symlink_metadata: un link non fa leggere un file fuori dall'archivio.
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return Ok(None),
    };
    if !metadata.file_type().is_file() || metadata.len() > (MAX_VALUE_BYTES + NONCE_LEN + 64) as u64
    {
        let _ = fs::remove_file(path);
        return Ok(None);
    }
    let raw = fs::read(path).map_err(|_| failure("read_failed"))?;
    if raw.len() < NONCE_LEN {
        let _ = fs::remove_file(path);
        return Ok(None);
    }
    let (nonce, ciphertext) = raw.split_at(NONCE_LEN);
    let plain = cipher(key).decrypt(
        Nonce::from_slice(nonce),
        Payload {
            msg: ciphertext,
            aad: name.as_bytes(),
        },
    );
    match plain.map(Zeroizing::new) {
        Ok(plain) => match std::str::from_utf8(&plain) {
            Ok(text) => Ok(Some(text.to_string())),
            Err(_) => {
                let _ = fs::remove_file(path);
                Ok(None)
            }
        },
        Err(_) => {
            let _ = fs::remove_file(path);
            Ok(None)
        }
    }
}

fn write_entry(
    dir: &Path,
    name: &str,
    value: &str,
    key: &[u8; KEY_LEN],
) -> Result<(), AuthStoreError> {
    create_private_dir(dir)?;
    let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher(key)
        .encrypt(
            &nonce,
            Payload {
                msg: value.as_bytes(),
                aad: name.as_bytes(),
            },
        )
        .map_err(|_| failure("encrypt_failed"))?;
    let path = entry_path(dir, name);
    let tmp = dir.join(format!(".{name}.tmp"));
    {
        let mut file = private_file(&tmp)?;
        file.write_all(nonce.as_slice())
            .and_then(|_| file.write_all(&ciphertext))
            .and_then(|_| file.sync_all())
            .map_err(|_| failure("write_failed"))?;
    }
    fs::rename(&tmp, &path).map_err(|_| {
        let _ = fs::remove_file(&tmp);
        failure("write_failed")
    })
}

fn remove_entry(dir: &Path, name: &str) -> Result<(), AuthStoreError> {
    match fs::remove_file(entry_path(dir, name)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(failure("remove_failed")),
    }
}

#[cfg(unix)]
fn create_private_dir(dir: &Path) -> Result<(), AuthStoreError> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
        .and_then(|_| fs::set_permissions(dir, fs::Permissions::from_mode(0o700)))
        .map_err(|_| failure("write_failed"))
}

#[cfg(not(unix))]
fn create_private_dir(dir: &Path) -> Result<(), AuthStoreError> {
    fs::create_dir_all(dir).map_err(|_| failure("write_failed"))
}

#[cfg(unix)]
fn private_file(path: &Path) -> Result<fs::File, AuthStoreError> {
    use std::os::unix::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| failure("write_failed"))
}

#[cfg(not(unix))]
fn private_file(path: &Path) -> Result<fs::File, AuthStoreError> {
    fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(path)
        .map_err(|_| failure("write_failed"))
}

#[cfg(test)]
mod tests {
    use super::{entry_path, read_entry, remove_entry, validate_name, write_entry, KEY_LEN};
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn scratch_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("jht-auth-store-{name}-{nanos}"))
    }

    const KEY: [u8; KEY_LEN] = [7u8; KEY_LEN];
    const NAME: &str = "sb-abc-auth-token";

    #[test]
    fn names_are_the_supabase_ones_only() {
        assert!(validate_name("sb-abcdef-auth-token").is_ok());
        assert!(validate_name("sb-abcdef-auth-token-code-verifier").is_ok());
        assert!(validate_name("").is_err());
        assert!(validate_name("../escape").is_err());
        assert!(validate_name("a/b").is_err());
        assert!(validate_name(".hidden").is_err());
        assert!(validate_name(&"a".repeat(129)).is_err());
    }

    #[test]
    fn a_value_round_trips_and_is_not_on_disk_in_clear() {
        let dir = scratch_dir("round-trip");
        write_entry(&dir, NAME, "{\"refresh_token\":\"secret-refresh\"}", &KEY).unwrap();
        let path = entry_path(&dir, NAME);
        let raw = fs::read(&path).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("secret-refresh"));
        assert_eq!(
            read_entry(&path, NAME, &KEY).unwrap().as_deref(),
            Some("{\"refresh_token\":\"secret-refresh\"}")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_wrong_key_or_a_renamed_file_reads_as_absent_and_is_dropped() {
        let dir = scratch_dir("wrong-key");
        write_entry(&dir, NAME, "value", &KEY).unwrap();
        let path = entry_path(&dir, NAME);
        assert_eq!(read_entry(&path, NAME, &[9u8; KEY_LEN]).unwrap(), None);
        assert!(!path.exists());

        write_entry(&dir, NAME, "value", &KEY).unwrap();
        let other = entry_path(&dir, "sb-abc-auth-token-code-verifier");
        fs::rename(&path, &other).unwrap();
        assert_eq!(
            read_entry(&other, "sb-abc-auth-token-code-verifier", &KEY).unwrap(),
            None
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn removing_a_missing_entry_is_not_an_error() {
        let dir = scratch_dir("remove");
        fs::create_dir_all(&dir).unwrap();
        assert!(remove_entry(&dir, NAME).is_ok());
        write_entry(&dir, NAME, "value", &KEY).unwrap();
        assert!(remove_entry(&dir, NAME).is_ok());
        assert!(!entry_path(&dir, NAME).exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_in_place_of_an_entry_is_not_followed() {
        let dir = scratch_dir("symlink");
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("elsewhere");
        fs::write(&target, "outside").unwrap();
        let path = entry_path(&dir, NAME);
        std::os::unix::fs::symlink(&target, &path).unwrap();
        assert_eq!(read_entry(&path, NAME, &KEY).unwrap(), None);
        assert!(target.exists());
        fs::remove_dir_all(dir).unwrap();
    }
}

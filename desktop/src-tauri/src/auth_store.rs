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
    sync::{Mutex, MutexGuard},
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
const KEYCHAIN_UNAVAILABLE: &str = "keychain_unavailable";

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthStoreError {
    code: &'static str,
}

fn failure(code: &'static str) -> AuthStoreError {
    AuthStoreError { code }
}

/// La chiave del portachiavi di questo processo (stato gestito da Tauri).
pub(crate) type SystemKeyCache = KeyCache<SystemKeychain>;

pub(crate) fn system_key_cache() -> SystemKeyCache {
    KeyCache::new(SystemKeychain)
}

#[tauri::command]
pub(crate) fn auth_store_get(
    app: tauri::AppHandle,
    keys: tauri::State<'_, SystemKeyCache>,
    name: String,
) -> Result<Option<String>, AuthStoreError> {
    get_value(&store_dir(&app)?, &keys, &name)
}

#[tauri::command]
pub(crate) fn auth_store_set(
    app: tauri::AppHandle,
    keys: tauri::State<'_, SystemKeyCache>,
    name: String,
    value: String,
) -> Result<(), AuthStoreError> {
    set_value(&store_dir(&app)?, &keys, &name, &value)
}

#[tauri::command]
pub(crate) fn auth_store_remove(app: tauri::AppHandle, name: String) -> Result<(), AuthStoreError> {
    validate_name(&name)?;
    remove_entry(&store_dir(&app)?, &name)
}

/// Prima di aprire il browser: la chiave c'è (o si crea) e il portachiavi la
/// dà. È il solo punto che riprova dopo un rifiuto, perché lo chiede l'utente
/// con un clic su «Accedi»: una domanda per clic, mai un giro da solo.
#[tauri::command]
pub(crate) fn auth_store_prepare(
    keys: tauri::State<'_, SystemKeyCache>,
) -> Result<(), AuthStoreError> {
    keys.prepare()
}

fn get_value<S: KeySource>(
    dir: &Path,
    keys: &KeyCache<S>,
    name: &str,
) -> Result<Option<String>, AuthStoreError> {
    validate_name(name)?;
    let path = entry_path(dir, name);
    if fs::symlink_metadata(&path).is_err() {
        return Ok(None);
    }
    let Some(key) = keys.existing()? else {
        // Il file c'è ma la chiave no: illeggibile per sempre.
        let _ = fs::remove_file(&path);
        return Ok(None);
    };
    read_entry(&path, name, &key)
}

fn set_value<S: KeySource>(
    dir: &Path,
    keys: &KeyCache<S>,
    name: &str,
    value: &str,
) -> Result<(), AuthStoreError> {
    validate_name(name)?;
    if value.len() > MAX_VALUE_BYTES {
        return Err(failure("value_too_large"));
    }
    let key = keys.existing_or_new()?;
    write_entry(dir, name, value, &key)
}

/// Dove sta la chiave: il portachiavi del sistema, o un finto nei test.
pub(crate) trait KeySource: Send + Sync + 'static {
    /// `Ok(None)` se la voce non c'è.
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, ()>;
    fn write(&self, key: &[u8]) -> Result<(), ()>;
}

pub(crate) struct SystemKeychain;

impl SystemKeychain {
    fn entry() -> Result<keyring::Entry, ()> {
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|_| ())
    }
}

impl KeySource for SystemKeychain {
    fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, ()> {
        match Self::entry()?.get_secret() {
            Ok(secret) => Ok(Some(Zeroizing::new(secret))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(()),
        }
    }

    fn write(&self, key: &[u8]) -> Result<(), ()> {
        Self::entry()?.set_secret(key).map_err(|_| ())
    }
}

enum KeyState {
    /// Il portachiavi non è ancora stato interrogato.
    Unknown,
    /// Interrogato: la voce non c'è (o ha una forma sbagliata e va rifatta).
    Missing,
    Loaded(Zeroizing<[u8; KEY_LEN]>),
    /// Rifiuto o errore: niente altre domande finché l'utente non riprova.
    Failed,
}

/// La chiave, letta dal portachiavi AL PIÙ UNA VOLTA per processo.
///
/// Su macOS ogni lettura di un'app non firmata, o ricompilata, può aprire la
/// finestra «vuole usare le informazioni riservate nel Portachiavi», e
/// supabase-js legge e scrive lo storage decine di volte (sessione, code
/// verifier, refresh): chiedere la chiave a ogni accesso era un popup a ogni
/// accesso. Il lucchetto copre anche la lettura: due chiamate insieme fanno
/// una domanda sola.
pub(crate) struct KeyCache<S: KeySource> {
    source: S,
    state: Mutex<KeyState>,
}

impl<S: KeySource> KeyCache<S> {
    pub(crate) fn new(source: S) -> Self {
        Self {
            source,
            state: Mutex::new(KeyState::Unknown),
        }
    }

    fn lock(&self) -> MutexGuard<'_, KeyState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn load(&self, state: &mut KeyState) {
        if !matches!(state, KeyState::Unknown) {
            return;
        }
        *state = match self.source.read() {
            Ok(Some(secret)) if secret.len() == KEY_LEN => {
                let mut key = Zeroizing::new([0u8; KEY_LEN]);
                key.copy_from_slice(&secret);
                KeyState::Loaded(key)
            }
            Ok(_) => KeyState::Missing,
            Err(()) => KeyState::Failed,
        };
    }

    /// Per leggere: `None` se il portachiavi non ha la chiave.
    fn existing(&self) -> Result<Option<Zeroizing<[u8; KEY_LEN]>>, AuthStoreError> {
        let mut state = self.lock();
        self.load(&mut state);
        match &*state {
            KeyState::Loaded(key) => Ok(Some(key.clone())),
            KeyState::Missing => Ok(None),
            KeyState::Unknown | KeyState::Failed => Err(failure(KEYCHAIN_UNAVAILABLE)),
        }
    }

    /// Per scrivere: se manca la crea, una volta.
    fn existing_or_new(&self) -> Result<Zeroizing<[u8; KEY_LEN]>, AuthStoreError> {
        let mut state = self.lock();
        self.load(&mut state);
        self.create_if_missing(&mut state)
    }

    fn prepare(&self) -> Result<(), AuthStoreError> {
        let mut state = self.lock();
        if matches!(*state, KeyState::Failed) {
            *state = KeyState::Unknown;
        }
        self.load(&mut state);
        self.create_if_missing(&mut state).map(|_| ())
    }

    fn create_if_missing(
        &self,
        state: &mut KeyState,
    ) -> Result<Zeroizing<[u8; KEY_LEN]>, AuthStoreError> {
        match state {
            KeyState::Loaded(key) => return Ok(key.clone()),
            KeyState::Unknown | KeyState::Failed => return Err(failure(KEYCHAIN_UNAVAILABLE)),
            KeyState::Missing => {}
        }
        let generated = ChaCha20Poly1305::generate_key(&mut OsRng);
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        key.copy_from_slice(generated.as_slice());
        if self.source.write(key.as_slice()).is_err() {
            *state = KeyState::Failed;
            return Err(failure(KEYCHAIN_UNAVAILABLE));
        }
        *state = KeyState::Loaded(key.clone());
        Ok(key)
    }
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
    use super::{
        entry_path, get_value, read_entry, remove_entry, set_value, validate_name, write_entry,
        KeyCache, KeySource, KEY_LEN,
    };
    use std::{
        fs,
        path::PathBuf,
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc, Mutex,
        },
        thread,
        time::{SystemTime, UNIX_EPOCH},
    };
    use zeroize::Zeroizing;

    /// Un portachiavi finto che conta le domande: ognuna, su macOS, può
    /// essere un popup.
    #[derive(Default)]
    struct CountingKeychain {
        stored: Mutex<Option<Vec<u8>>>,
        deny: AtomicBool,
        reads: AtomicUsize,
        writes: AtomicUsize,
    }

    impl CountingKeychain {
        fn with_key(key: [u8; KEY_LEN]) -> Self {
            Self {
                stored: Mutex::new(Some(key.to_vec())),
                ..Self::default()
            }
        }
        fn denying() -> Self {
            let keychain = Self::default();
            keychain.deny.store(true, Ordering::SeqCst);
            keychain
        }
        fn asked(&self) -> (usize, usize) {
            (
                self.reads.load(Ordering::SeqCst),
                self.writes.load(Ordering::SeqCst),
            )
        }
    }

    impl KeySource for Arc<CountingKeychain> {
        fn read(&self) -> Result<Option<Zeroizing<Vec<u8>>>, ()> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            if self.deny.load(Ordering::SeqCst) {
                return Err(());
            }
            Ok(self.stored.lock().unwrap().clone().map(Zeroizing::new))
        }
        fn write(&self, key: &[u8]) -> Result<(), ()> {
            self.writes.fetch_add(1, Ordering::SeqCst);
            if self.deny.load(Ordering::SeqCst) {
                return Err(());
            }
            *self.stored.lock().unwrap() = Some(key.to_vec());
            Ok(())
        }
    }

    #[test]
    fn many_gets_and_sets_ask_the_keychain_once() {
        let dir = scratch_dir("once");
        let keychain = Arc::new(CountingKeychain::with_key([3u8; KEY_LEN]));
        let keys = KeyCache::new(keychain.clone());
        for round in 0..25 {
            set_value(&dir, &keys, NAME, &format!("session-{round}")).unwrap();
            set_value(&dir, &keys, "sb-abc-auth-token-code-verifier", "verifier").unwrap();
            assert_eq!(
                get_value(&dir, &keys, NAME).unwrap().as_deref(),
                Some(format!("session-{round}").as_str())
            );
            keys.prepare().unwrap();
        }
        assert_eq!(keychain.asked(), (1, 0));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_missing_key_is_created_once_and_then_only_used() {
        let dir = scratch_dir("create");
        let keychain = Arc::new(CountingKeychain::default());
        let keys = KeyCache::new(keychain.clone());
        // Niente file: il portachiavi non si disturba neanche.
        assert_eq!(get_value(&dir, &keys, NAME).unwrap(), None);
        assert_eq!(keychain.asked(), (0, 0));
        for _ in 0..10 {
            set_value(&dir, &keys, NAME, "session").unwrap();
            assert_eq!(
                get_value(&dir, &keys, NAME).unwrap().as_deref(),
                Some("session")
            );
        }
        assert_eq!(keychain.asked(), (1, 1));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn concurrent_first_accesses_ask_once() {
        let dir = Arc::new(scratch_dir("concurrent"));
        let keychain = Arc::new(CountingKeychain::with_key([4u8; KEY_LEN]));
        let keys = Arc::new(KeyCache::new(keychain.clone()));
        let workers: Vec<_> = (0..8)
            .map(|index| {
                let (dir, keys) = (dir.clone(), keys.clone());
                thread::spawn(move || {
                    let name = format!("sb-abc-entry-{index}");
                    set_value(&dir, &keys, &name, "value").unwrap();
                })
            })
            .collect();
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(keychain.asked(), (1, 0));
        fs::remove_dir_all(&*dir).unwrap();
    }

    #[test]
    fn a_refusal_is_not_asked_again_until_the_user_retries() {
        let dir = scratch_dir("denied");
        fs::create_dir_all(&dir).unwrap();
        fs::write(entry_path(&dir, NAME), [0u8; 40]).unwrap();
        let keychain = Arc::new(CountingKeychain::denying());
        let keys = KeyCache::new(keychain.clone());
        for _ in 0..10 {
            assert_eq!(
                get_value(&dir, &keys, NAME).unwrap_err().code,
                "keychain_unavailable"
            );
            assert_eq!(
                set_value(&dir, &keys, NAME, "session").unwrap_err().code,
                "keychain_unavailable"
            );
        }
        assert_eq!(keychain.asked(), (1, 0));
        // Il file non si butta per un rifiuto: con la chiave tornerebbe leggibile.
        assert!(entry_path(&dir, NAME).exists());

        // «Accedi» di nuovo: una domanda in più, una sola.
        assert!(keys.prepare().is_err());
        assert_eq!(keychain.asked(), (2, 0));

        keychain.deny.store(false, Ordering::SeqCst);
        *keychain.stored.lock().unwrap() = Some([5u8; KEY_LEN].to_vec());
        keys.prepare().unwrap();
        set_value(&dir, &keys, NAME, "session").unwrap();
        assert_eq!(
            get_value(&dir, &keys, NAME).unwrap().as_deref(),
            Some("session")
        );
        assert_eq!(keychain.asked(), (3, 0));
        fs::remove_dir_all(dir).unwrap();
    }

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

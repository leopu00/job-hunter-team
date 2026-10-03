//! Native account boundary for every runtime and direct-chat IPC.
//!
//! The renderer never chooses a scope. `runtime_account_scope_set` derives it
//! from the encrypted Supabase session owned by `auth_store`; only a SHA-256
//! digest is retained or used in paths. A write lock makes reset/account
//! switch wait for in-flight scoped work, then tears every native handle down
//! before another account can enter.

use crate::{auth_store, direct_chat, onboarding};
use chacha20poly1305::{aead::OsRng, ChaCha20Poly1305, KeyInit};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, RwLock, RwLockReadGuard},
};
use tauri::{Manager, State};

const DIGEST_DOMAIN: &[u8] = b"jht-desktop-account-scope-v1\0";
const LOCAL_DIGEST_DOMAIN: &[u8] = b"jht-desktop-local-profile-scope-v1\0";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AccountScope {
    digest: String,
}

impl AccountScope {
    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }

    #[cfg(test)]
    pub(crate) fn synthetic(label: &[u8]) -> Self {
        derive_scope(label)
    }
}

#[derive(Clone, Default)]
pub(crate) struct AccountScopeState {
    inner: Arc<RwLock<Option<AccountScope>>>,
}

#[derive(Debug)]
pub(crate) struct ActiveScopeGuard<'a> {
    guard: RwLockReadGuard<'a, Option<AccountScope>>,
}

impl ActiveScopeGuard<'_> {
    pub(crate) fn scope(&self) -> &AccountScope {
        self.guard.as_ref().expect("active scope guard invariant")
    }
}

impl AccountScopeState {
    pub(crate) fn active(&self) -> Result<AccountScope, &'static str> {
        self.inner
            .read()
            .map_err(|_| "account_scope_state_failed")?
            .clone()
            .ok_or("account_scope_required")
    }

    pub(crate) fn lock_active(&self) -> Result<ActiveScopeGuard<'_>, &'static str> {
        let guard = self
            .inner
            .read()
            .map_err(|_| "account_scope_state_failed")?;
        if guard.is_none() {
            return Err("account_scope_required");
        }
        Ok(ActiveScopeGuard { guard })
    }

    pub(crate) fn lock_expected(
        &self,
        expected: &AccountScope,
    ) -> Result<ActiveScopeGuard<'_>, &'static str> {
        let guard = self
            .inner
            .read()
            .map_err(|_| "account_scope_state_failed")?;
        if guard.as_ref() != Some(expected) {
            return Err("account_scope_changed");
        }
        Ok(ActiveScopeGuard { guard })
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct AccountScopeError {
    code: &'static str,
}

fn failure(code: &'static str) -> AccountScopeError {
    AccountScopeError { code }
}

fn derive_scope(account_id: &[u8]) -> AccountScope {
    derive_scope_with_domain(DIGEST_DOMAIN, account_id)
}

fn derive_local_scope(secret: &[u8]) -> AccountScope {
    derive_scope_with_domain(LOCAL_DIGEST_DOMAIN, secret)
}

fn derive_scope_with_domain(domain: &[u8], authority: &[u8]) -> AccountScope {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(authority);
    AccountScope {
        digest: format!("{:x}", hasher.finalize()),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalProfileCreated {
    profile_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalProfileRecord {
    scope_digest: String,
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn local_profiles_dir(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    app.path()
        .app_local_data_dir()
        .map(|root| root.join("local-profiles"))
        .map_err(|_| "local_profile_storage_unavailable")
}

fn valid_profile_id(value: &str) -> bool {
    valid_digest(value)
}

fn create_local_profile_at(root: &Path) -> Result<LocalProfileCreated, &'static str> {
    create_private_account_dir(root)?;
    for _ in 0..16 {
        let profile_id = hex(&ChaCha20Poly1305::generate_key(&mut OsRng));
        let secret = ChaCha20Poly1305::generate_key(&mut OsRng);
        let scope = derive_local_scope(&secret);
        let record = serde_json::to_vec(&LocalProfileRecord {
            scope_digest: scope.digest,
        })
        .map_err(|_| "local_profile_storage_unavailable")?;
        let path = root.join(format!("{profile_id}.json"));
        match write_private_new(&path, &record) {
            Ok(()) => return Ok(LocalProfileCreated { profile_id }),
            Err("local_profile_exists") => continue,
            Err(error) => return Err(error),
        }
    }
    Err("local_profile_storage_unavailable")
}

fn load_local_scope_at(root: &Path, profile_id: &str) -> Result<AccountScope, &'static str> {
    if !valid_profile_id(profile_id) {
        return Err("local_profile_invalid");
    }
    let path = root.join(format!("{profile_id}.json"));
    let metadata = fs::symlink_metadata(&path).map_err(|_| "local_profile_not_found")?;
    if !metadata.file_type().is_file() || metadata.len() > 256 {
        return Err("local_profile_invalid");
    }
    let raw = fs::read(&path).map_err(|_| "local_profile_unavailable")?;
    let record: LocalProfileRecord =
        serde_json::from_slice(&raw).map_err(|_| "local_profile_invalid")?;
    if !valid_digest(&record.scope_digest) {
        return Err("local_profile_invalid");
    }
    Ok(AccountScope {
        digest: record.scope_digest,
    })
}

fn hex(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(ALPHABET[(byte >> 4) as usize] as char);
        output.push(ALPHABET[(byte & 15) as usize] as char);
    }
    output
}

fn create_private_account_dir(path: &Path) -> Result<(), &'static str> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)
            .and_then(|_| fs::set_permissions(path, fs::Permissions::from_mode(0o700)))
            .map_err(|_| "local_profile_storage_unavailable")
    }
    #[cfg(not(unix))]
    fs::create_dir_all(path).map_err(|_| "local_profile_storage_unavailable")
}

fn write_private_new(path: &Path, bytes: &[u8]) -> Result<(), &'static str> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            return Err("local_profile_exists")
        }
        Err(_) => return Err("local_profile_storage_unavailable"),
    };
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "local_profile_storage_unavailable")
}

pub(crate) fn validate_local_runtime(
    app: &tauri::AppHandle,
    scope: &AccountScope,
) -> Result<(), &'static str> {
    if !local_runtime_allowed(std::env::consts::OS) {
        return Err("local_runtime_unsupported");
    }
    #[cfg(target_os = "windows")]
    {
        let _ = (app, scope);
        unreachable!("Windows is denied before local runtime access")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let home = local_owner_marker_path(app)?
            .parent()
            .ok_or("local_account_owner_unavailable")?
            .to_path_buf();
        validate_or_claim_local_owner(&home, scope)
    }
}

fn local_runtime_allowed(target_os: &str) -> bool {
    target_os != "windows"
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn local_owner_marker_path(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    app.path()
        .home_dir()
        .map(|home| home.join(".jht").join(".desktop-account-scope"))
        .map_err(|_| "local_account_owner_unavailable")
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn verify_local_runtime_owner(
    marker: &Path,
    scope: &AccountScope,
) -> Result<(), &'static str> {
    verify_local_owner_marker(marker, scope)
}

#[cfg(not(target_os = "windows"))]
fn validate_or_claim_local_owner(home: &Path, scope: &AccountScope) -> Result<(), &'static str> {
    let marker = home.join(".desktop-account-scope");
    if marker.exists() {
        return verify_local_owner_marker(&marker, scope);
    }
    if home.exists() {
        let metadata = fs::symlink_metadata(home).map_err(|_| "local_account_owner_unavailable")?;
        if !metadata.file_type().is_dir() {
            return Err("local_account_owner_unavailable");
        }
        if fs::read_dir(home)
            .map_err(|_| "local_account_owner_unavailable")?
            .next()
            .is_some()
        {
            // Never adopt a pre-account-scope home implicitly.
            return Err("local_account_owner_missing");
        }
    } else {
        create_private_dir(home)?;
    }
    write_owner_marker(&marker, scope)?;
    verify_local_owner_marker(&marker, scope)
}

#[cfg(not(target_os = "windows"))]
fn verify_local_owner_marker(marker: &Path, scope: &AccountScope) -> Result<(), &'static str> {
    let metadata = fs::symlink_metadata(marker).map_err(|_| "local_account_owner_unavailable")?;
    if !metadata.file_type().is_file() || metadata.len() > 80 {
        return Err("local_account_owner_invalid");
    }
    let stored = fs::read_to_string(marker).map_err(|_| "local_account_owner_unavailable")?;
    if stored.trim() == scope.digest() {
        Ok(())
    } else {
        Err("local_account_owner_mismatch")
    }
}

#[cfg(not(target_os = "windows"))]
fn create_private_dir(path: &Path) -> Result<(), &'static str> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)
            .and_then(|_| fs::set_permissions(path, fs::Permissions::from_mode(0o700)))
            .map_err(|_| "local_account_owner_unavailable")
    }
    #[cfg(not(unix))]
    fs::create_dir_all(path).map_err(|_| "local_account_owner_unavailable")
}

#[cfg(not(target_os = "windows"))]
fn write_owner_marker(marker: &PathBuf, scope: &AccountScope) -> Result<(), &'static str> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(marker) {
        Ok(mut file) => file
            .write_all(scope.digest().as_bytes())
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.sync_all())
            .map_err(|_| "local_account_owner_unavailable"),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(_) => Err("local_account_owner_unavailable"),
    }
}

fn activate_scope(
    app: &tauri::AppHandle,
    scopes: &AccountScopeState,
    chat: &direct_chat::DirectChatState,
    onboarding: &onboarding::OnboardingNativeState,
    next: AccountScope,
) -> Result<(), AccountScopeError> {
    let mut active = scopes
        .inner
        .write()
        .map_err(|_| failure("account_scope_state_failed"))?;
    if active.as_ref() == Some(&next) {
        return Ok(());
    }
    // None is installed before cleanup: even a partial teardown cannot expose
    // the previous account to a new command.
    *active = None;
    direct_chat::teardown(chat);
    onboarding::teardown(onboarding);
    crate::live_screen::teardown(app);
    *active = Some(next);
    Ok(())
}

#[tauri::command]
pub(crate) fn runtime_local_profile_create(
    app: tauri::AppHandle,
) -> Result<LocalProfileCreated, AccountScopeError> {
    create_local_profile_at(&local_profiles_dir(&app).map_err(failure)?).map_err(failure)
}

#[tauri::command]
pub(crate) fn runtime_account_scope_set_local(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    chat: State<'_, direct_chat::DirectChatState>,
    onboarding: State<'_, onboarding::OnboardingNativeState>,
    profile_id: String,
) -> Result<(), AccountScopeError> {
    let next = load_local_scope_at(&local_profiles_dir(&app).map_err(failure)?, &profile_id)
        .map_err(failure)?;
    activate_scope(&app, &scopes, &chat, &onboarding, next)
}

#[tauri::command]
pub(crate) async fn runtime_account_scope_set(
    app: tauri::AppHandle,
    keys: State<'_, auth_store::SystemKeyCache>,
    scopes: State<'_, AccountScopeState>,
    chat: State<'_, direct_chat::DirectChatState>,
    onboarding: State<'_, onboarding::OnboardingNativeState>,
) -> Result<(), AccountScopeError> {
    let account_id = auth_store::authenticated_account_id(&app, &keys)
        .await
        .map_err(failure)?;
    let next = derive_scope(account_id.as_bytes());
    activate_scope(&app, &scopes, &chat, &onboarding, next)
}

#[tauri::command]
pub(crate) fn runtime_account_scope_reset(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    chat: State<'_, direct_chat::DirectChatState>,
    onboarding: State<'_, onboarding::OnboardingNativeState>,
) -> Result<(), AccountScopeError> {
    let mut active = scopes
        .inner
        .write()
        .map_err(|_| failure("account_scope_state_failed"))?;
    *active = None;
    direct_chat::teardown(&chat);
    onboarding::teardown(&onboarding);
    crate::live_screen::teardown(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    #[cfg(not(target_os = "windows"))]
    use super::validate_or_claim_local_owner;
    use super::{
        create_local_profile_at, derive_scope, load_local_scope_at, local_runtime_allowed,
        AccountScopeState,
    };

    #[test]
    fn digest_is_stable_opaque_and_account_separated() {
        let a = derive_scope(b"00000000-0000-4000-8000-000000000001");
        let again = derive_scope(b"00000000-0000-4000-8000-000000000001");
        let b = derive_scope(b"00000000-0000-4000-8000-000000000002");
        assert_eq!(a, again);
        assert_ne!(a, b);
        assert_eq!(a.digest().len(), 64);
        assert!(!a.digest().contains("00000000"));
    }

    #[test]
    fn inactive_and_mismatched_scopes_fail_closed() {
        let state = AccountScopeState::default();
        let a = derive_scope(b"00000000-0000-4000-8000-000000000001");
        let b = derive_scope(b"00000000-0000-4000-8000-000000000002");
        assert_eq!(state.active().unwrap_err(), "account_scope_required");
        *state.inner.write().unwrap() = Some(a.clone());
        assert!(state.lock_expected(&a).is_ok());
        assert_eq!(
            state.lock_expected(&b).unwrap_err(),
            "account_scope_changed"
        );
    }

    #[test]
    fn windows_local_runtime_is_unconditionally_denied() {
        assert!(!local_runtime_allowed("windows"));
        assert!(local_runtime_allowed("macos"));
        assert!(local_runtime_allowed("linux"));
    }

    #[test]
    fn account_switch_sequence_never_accepts_the_previous_scope() {
        let state = AccountScopeState::default();
        let a = derive_scope(b"00000000-0000-4000-8000-000000000001");
        let b = derive_scope(b"00000000-0000-4000-8000-000000000002");

        *state.inner.write().unwrap() = Some(a.clone());
        assert!(state.lock_expected(&a).is_ok());
        *state.inner.write().unwrap() = None;
        assert!(state.lock_expected(&a).is_err());
        *state.inner.write().unwrap() = Some(b.clone());
        assert!(state.lock_expected(&a).is_err());
        assert!(state.lock_expected(&b).is_ok());
        *state.inner.write().unwrap() = None;
        *state.inner.write().unwrap() = Some(a.clone());
        assert!(state.lock_expected(&b).is_err());
        assert!(state.lock_expected(&a).is_ok());
    }

    #[test]
    fn local_profiles_are_backend_generated_distinct_and_separate_from_google() {
        use std::{fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-local-profiles-{nonce}"));
        let local_a = create_local_profile_at(&root).unwrap();
        let local_b = create_local_profile_at(&root).unwrap();
        assert_ne!(local_a.profile_id, local_b.profile_id);
        let scope_a = load_local_scope_at(&root, &local_a.profile_id).unwrap();
        let scope_b = load_local_scope_at(&root, &local_b.profile_id).unwrap();
        let google = derive_scope(b"00000000-0000-4000-8000-000000000001");
        assert_ne!(scope_a, scope_b);
        assert_ne!(scope_a, google);
        let state = AccountScopeState::default();
        *state.inner.write().unwrap() = Some(scope_a.clone());
        assert!(state.lock_expected(&scope_a).is_ok());
        *state.inner.write().unwrap() = None;
        *state.inner.write().unwrap() = Some(google.clone());
        assert!(state.lock_expected(&scope_a).is_err());
        assert!(state.lock_expected(&google).is_ok());
        *state.inner.write().unwrap() = None;
        *state.inner.write().unwrap() = Some(scope_b.clone());
        assert!(state.lock_expected(&google).is_err());
        assert!(state.lock_expected(&scope_b).is_ok());
        assert_eq!(
            load_local_scope_at(&root, &"f".repeat(64)),
            Err("local_profile_not_found")
        );
        assert_eq!(
            load_local_scope_at(&root, "display name"),
            Err("local_profile_invalid")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn local_owner_is_a_to_logout_to_b_denied_to_a_restored() {
        use std::{fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let home = std::env::temp_dir().join(format!("jht-local-owner-{nonce}"));
        let a = derive_scope(b"00000000-0000-4000-8000-000000000001");
        let b = derive_scope(b"00000000-0000-4000-8000-000000000002");
        validate_or_claim_local_owner(&home, &a).unwrap();
        assert_eq!(
            validate_or_claim_local_owner(&home, &b),
            Err("local_account_owner_mismatch")
        );
        validate_or_claim_local_owner(&home, &a).unwrap();
        fs::remove_dir_all(home).unwrap();
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn populated_legacy_local_home_is_never_adopted() {
        use std::{fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let home = std::env::temp_dir().join(format!("jht-local-legacy-{nonce}"));
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join("jht.config.json"), "{}").unwrap();
        let a = derive_scope(b"00000000-0000-4000-8000-000000000001");
        assert_eq!(
            validate_or_claim_local_owner(&home, &a),
            Err("local_account_owner_missing")
        );
        assert!(!home.join(".desktop-account-scope").exists());
        fs::remove_dir_all(home).unwrap();
    }
}

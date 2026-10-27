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
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock, RwLockReadGuard},
    time::{Duration, Instant},
};
use tauri::{Manager, State};

const DIGEST_DOMAIN: &[u8] = b"jht-desktop-account-scope-v1\0";
const LOCAL_DIGEST_DOMAIN: &[u8] = b"jht-desktop-local-profile-scope-v1\0";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AccountScope {
    digest: String,
    authority: AccountScopeAuthority,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AccountScopeAuthority {
    Authenticated,
    LocalProfile,
}

impl AccountScope {
    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }

    pub(crate) fn is_local_profile(&self) -> bool {
        self.authority == AccountScopeAuthority::LocalProfile
    }

    pub(crate) fn local_from_digest(digest: String) -> Option<Self> {
        valid_digest(&digest).then_some(Self {
            digest,
            authority: AccountScopeAuthority::LocalProfile,
        })
    }

    #[cfg(test)]
    pub(crate) fn synthetic(label: &[u8]) -> Self {
        derive_scope(label)
    }

    #[cfg(test)]
    pub(crate) fn synthetic_local(label: &[u8]) -> Self {
        derive_local_scope(label)
    }
}

#[derive(Clone, Default)]
pub(crate) struct AccountScopeState {
    inner: Arc<RwLock<Option<AccountScope>>>,
    /// The one pending confirmation of a change of the runtime's owner (see `OwnerChangeGrant`).
    owner_change: Arc<Mutex<Option<OwnerChangeGrant>>>,
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
    derive_scope_with_domain(
        DIGEST_DOMAIN,
        account_id,
        AccountScopeAuthority::Authenticated,
    )
}

/// The scope of an account the backend itself authenticated (`auth_store::authenticated_account_id`),
/// for a command that must tie its work to the account whose session is open.
pub(crate) fn scope_of_authenticated(account_id: &[u8]) -> AccountScope {
    derive_scope(account_id)
}

fn derive_local_scope(secret: &[u8]) -> AccountScope {
    derive_scope_with_domain(
        LOCAL_DIGEST_DOMAIN,
        secret,
        AccountScopeAuthority::LocalProfile,
    )
}

fn derive_scope_with_domain(
    domain: &[u8],
    authority: &[u8],
    scope_authority: AccountScopeAuthority,
) -> AccountScope {
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(authority);
    AccountScope {
        digest: format!("{:x}", hasher.finalize()),
        authority: scope_authority,
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

/// Resolves the explicit local-profile context for the one-shot CLI companion.
/// It reads the same private record as the desktop command; it does not scan or
/// infer another account scope.
pub(crate) fn cli_local_scope(
    app: &tauri::AppHandle,
    profile_id: &str,
) -> Result<AccountScope, &'static str> {
    load_local_scope_at(&local_profiles_dir(app)?, profile_id)
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
        authority: AccountScopeAuthority::LocalProfile,
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
    let home = local_owner_marker_path(app)?
        .parent()
        .ok_or("local_account_owner_unavailable")?
        .to_path_buf();
    validate_or_claim_local_owner(&home, scope)
}

/// The team runs on this computer on macOS (Podman), Linux and Windows
/// (Podman inside WSL, through install.ps1 and jht-wrapper.ps1). Windows was
/// refused until 09/10/2026; the account's ownership of ~/.jht applies on
/// every system alike.
fn local_runtime_allowed(target_os: &str) -> bool {
    matches!(target_os, "macos" | "linux" | "windows")
}

pub(crate) fn local_owner_marker_path(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    app.path()
        .home_dir()
        .map(|home| home.join(".jht").join(".desktop-account-scope"))
        .map_err(|_| "local_account_owner_unavailable")
}

pub(crate) fn verify_local_runtime_owner(
    marker: &Path,
    scope: &AccountScope,
) -> Result<(), &'static str> {
    verify_local_owner_marker(marker, scope)
}

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
            // Electron used the same ~/.jht bind mount before account scopes
            // existed. A backend-generated local profile may claim that home
            // once, but authenticated accounts and unrelated directories must
            // remain fail-closed. After the marker is written, every access is
            // subject to the normal exact-digest ownership check.
            //
            // A home that holds only what a run leaves behind (see
            // `home_holds_only_leftovers`) holds the data of nobody: it is
            // claimed like a missing one, for any scope, and nothing in it is
            // touched or cleaned.
            if !home_holds_only_leftovers(home)?
                && (!scope.is_local_profile() || !recognized_legacy_local_home(home)?)
            {
                return Err("local_account_owner_missing");
            }
        }
    } else {
        create_private_dir(home)?;
    }
    write_owner_marker(&marker, scope)?;
    verify_local_owner_marker(&marker, scope)
}

/// Whether ~/.jht holds the data of a version before this app (the game, up
/// to v0.3.9) that no profile of this app has taken yet. The onboarding says
/// so before the setup: a local profile then takes that home as it is, on
/// purpose (configuration, profile, provider login, documents), never a copy
/// and never in silence.
#[tauri::command]
pub(crate) fn onboarding_previous_local_data(app: tauri::AppHandle) -> bool {
    local_owner_marker_path(&app)
        .ok()
        .and_then(|marker| marker.parent().map(Path::to_path_buf))
        .is_some_and(|home| previous_local_data_at(&home))
}

fn previous_local_data_at(home: &Path) -> bool {
    let unowned = matches!(
        fs::symlink_metadata(home.join(".desktop-account-scope")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound
    );
    unowned
        && fs::symlink_metadata(home).is_ok_and(|metadata| metadata.file_type().is_dir())
        && home_holds_only_leftovers(home) == Ok(false)
        && recognized_legacy_local_home(home) == Ok(true)
}

/// The closed list of what a home may hold and still count as empty: a home
/// of leftovers belongs to nobody, and the first profile takes it without a
/// question. Every other entry is data, however small.
///
///   - folders with nothing in them, at any depth;
///   - `logs/<name>.log` of zero bytes;
///   - `.team-halted.flag` at the root, of zero bytes or exactly what the
///     product writes (`halted_by=<word>` and an optional `at=<time>`).
///
/// Nothing is followed (lstat): a link, a socket, any other file or a file with
/// other content makes it data, and so does a home too big to look at or a
/// folder that cannot be read (never a guess).
fn home_holds_only_leftovers(home: &Path) -> Result<bool, &'static str> {
    const ENTRY_LIMIT: usize = 64;
    const DEPTH_LIMIT: usize = 4;
    let unavailable = |_| "local_account_owner_unavailable";
    let logs = home.join("logs");
    let mut pending = vec![(home.to_path_buf(), 0usize)];
    let mut seen = 0usize;
    while let Some((dir, depth)) = pending.pop() {
        if depth > DEPTH_LIMIT {
            return Ok(false);
        }
        for entry in fs::read_dir(&dir).map_err(unavailable)? {
            let path = entry.map_err(unavailable)?.path();
            seen += 1;
            if seen > ENTRY_LIMIT {
                return Ok(false);
            }
            let metadata = fs::symlink_metadata(&path).map_err(unavailable)?;
            let kind = metadata.file_type();
            if kind.is_symlink() {
                return Ok(false);
            }
            if kind.is_dir() {
                pending.push((path, depth + 1));
                continue;
            }
            if !kind.is_file() {
                return Ok(false);
            }
            let known = if path.parent() == Some(home) {
                path.file_name().is_some_and(|name| name == ".team-halted.flag")
                    && halt_flag_is_the_products(&path, metadata.len())?
            } else {
                path.parent() == Some(logs.as_path())
                    && metadata.len() == 0
                    && path.extension().is_some_and(|extension| extension == "log")
            };
            if !known {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

/// `halted_by=<lowercase word or hyphens>\n`, then optionally `at=<ISO time>\n`:
/// the two shapes the product writes. Anything longer or different is data.
fn halt_flag_is_the_products(path: &Path, length: u64) -> Result<bool, &'static str> {
    if length == 0 {
        return Ok(true);
    }
    if length > 96 {
        return Ok(false);
    }
    let Ok(text) = fs::read_to_string(path) else {
        return Ok(false);
    };
    let mut lines = text.split_inclusive('\n');
    let first_ok = lines.next().is_some_and(|line| {
        line.strip_prefix("halted_by=")
            .and_then(|rest| rest.strip_suffix('\n'))
            .is_some_and(|word| {
                (1..=40).contains(&word.len())
                    && word.bytes().all(|byte| byte.is_ascii_lowercase() || byte == b'-')
            })
    });
    let second_ok = lines.next().map_or(true, |line| {
        line.strip_prefix("at=")
            .and_then(|rest| rest.strip_suffix('\n'))
            .is_some_and(|time| {
                (1..=32).contains(&time.len())
                    && time.bytes().all(|byte| byte.is_ascii_digit() || b"-:.TZ".contains(&byte))
            })
    });
    Ok(first_ok && second_ok && lines.next().is_none())
}

/// «Use this data»: the person confirmed that the home no profile has taken
/// becomes the local profile's. Only a local profile can take it (an account
/// never takes data it did not make), only a real folder of this user, only
/// when nobody owns it yet: an existing marker, whoever's, is checked and
/// never replaced. The marker is written by the same function as always.
fn adopt_unassigned_local_home(home: &Path, scope: &AccountScope) -> Result<(), &'static str> {
    if !scope.is_local_profile() {
        return Err("local_account_owner_missing");
    }
    let marker = home.join(".desktop-account-scope");
    match fs::symlink_metadata(&marker) {
        Ok(_) => return verify_local_owner_marker(&marker, scope),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("local_account_owner_unavailable"),
    }
    match fs::symlink_metadata(home) {
        Ok(metadata) if metadata.file_type().is_dir() && is_ours(&metadata) => {}
        Ok(_) => return Err("local_account_owner_unavailable"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return validate_or_claim_local_owner(home, scope);
        }
        Err(_) => return Err("local_account_owner_unavailable"),
    }
    write_owner_marker(&marker, scope)?;
    verify_local_owner_marker(&marker, scope)
}

#[cfg(unix)]
fn is_ours(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    // SAFETY: geteuid has no arguments and cannot fail.
    metadata.uid() == unsafe { libc::geteuid() }
}

#[cfg(not(unix))]
fn is_ours(_metadata: &fs::Metadata) -> bool {
    true
}

/// «Set it aside and start again»: the home no profile has taken is MOVED, in
/// the same folder, to a name with the date. Nothing is copied, merged or
/// removed; an existing name is never overwritten; the data keep their
/// content. If the move fails nothing was touched. Returns the new name (not
/// the path) for the person to read.
fn set_aside_unassigned_local_home(home: &Path, now_secs: u64) -> Result<String, &'static str> {
    let marker = home.join(".desktop-account-scope");
    match fs::symlink_metadata(&marker) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        // Already someone's (or unreadable): not for this to move.
        _ => return Err("local_account_owner_unavailable"),
    }
    match fs::symlink_metadata(home) {
        Ok(metadata) if metadata.file_type().is_dir() && is_ours(&metadata) => {}
        _ => return Err("local_account_owner_unavailable"),
    }
    let parent = home.parent().ok_or("local_data_set_aside_failed")?;
    let stamp = civil_stamp(now_secs);
    for attempt in 0..100u32 {
        let name = if attempt == 0 {
            format!("jht-data-set-aside-{stamp}")
        } else {
            format!("jht-data-set-aside-{stamp}-{attempt}")
        };
        let target = parent.join(&name);
        // No overwrite: a name taken is skipped, never replaced.
        match fs::symlink_metadata(&target) {
            Ok(_) => continue,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("local_data_set_aside_failed"),
        }
        // rename(2) is atomic inside one filesystem and fails across two: no
        // copy and delete ever follows.
        fs::rename(home, &target).map_err(|_| "local_data_set_aside_failed")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&target, fs::Permissions::from_mode(0o700));
        }
        return Ok(name);
    }
    Err("local_data_set_aside_failed")
}

/// `YYYYMMDD-HHMMSS` (UTC) of a Unix time, without a date library.
fn civil_stamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rest = secs % 86_400;
    // Days since 1970-01-01 to a civil date (H. Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 { month_index + 3 } else { month_index - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}{month:02}{day:02}-{:02}{:02}{:02}",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}

/// The confirmation of «Use this data» (the person read that these data were
/// another profile's and that using them makes them theirs).
#[tauri::command]
pub(crate) fn onboarding_local_data_adopt(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<(), onboarding::OnboardingError> {
    let scope = scopes.lock_active().map_err(onboarding::failure)?;
    let marker = local_owner_marker_path(&app).map_err(onboarding::failure)?;
    let home = marker.parent().ok_or_else(|| onboarding::failure("local_account_owner_unavailable"))?;
    adopt_unassigned_local_home(home, scope.scope()).map_err(onboarding::failure)
}

/// The confirmation of «Set it aside and start again»: the name of the folder
/// the data were moved to, to tell the person where they are.
#[tauri::command]
pub(crate) fn onboarding_local_data_set_aside(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<String, onboarding::OnboardingError> {
    let _scope = scopes.lock_active().map_err(onboarding::failure)?;
    let marker = local_owner_marker_path(&app).map_err(onboarding::failure)?;
    let home = marker.parent().ok_or_else(|| onboarding::failure("local_account_owner_unavailable"))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    set_aside_unassigned_local_home(home, now).map_err(onboarding::failure)
}

// ── The runtime of another profile: back to its owner, or take it over ───────
//
// `~/.jht` holds the first profile's provider logins, profile, documents and
// the pairing of the device with the web. Its owner marker is the digest of
// that profile's scope; a profile with another digest is refused everywhere
// (`local_account_owner_mismatch`). Two ways out, each one after the person
// confirmed it, and only for a profile that is a LOCAL one of this app and
// whose owner is a LOCAL profile of this app that can be named without doubt:
//
//   - back to the owner: the app switches to the owner's scope through the
//     same exit as signing out (`activate_scope_from`);
//   - take it over: ONLY the marker is replaced. Nothing is moved, copied or
//     removed.
//
// An account never changes the owner, and an owner that no local record of
// this app names (a Google account, a profile whose record is gone: the digest
// does not say which) is never taken. The two kinds of scope digest have
// separate domains (`DIGEST_DOMAIN`, `LOCAL_DIGEST_DOMAIN`): a local record
// cannot match the digest of an account.

const OWNER_CHANGE_TTL: Duration = Duration::from_secs(120);
/// How many profile records are looked at; one more and the owner is not known.
const PROFILE_RECORD_LIMIT: usize = 256;
/// The only temporary name the take-over writes (and sweeps).
const TAKE_OVER_TEMP: &str = ".desktop-account-scope.tmp-take-over";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum OwnerChange {
    Return,
    TakeOver,
}

impl OwnerChange {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "return" => Some(Self::Return),
            "takeover" => Some(Self::TakeOver),
            _ => None,
        }
    }
}

/// What the person confirmed: one change, for the scope that was active and the
/// owner that was probed, valid once and for a short time.
#[derive(Debug)]
struct OwnerChangeGrant {
    token: String,
    change: OwnerChange,
    scope_digest: String,
    owner_digest: String,
    issued: Instant,
}

/// The digest in the owner marker, read without following a link: `None` when
/// there is no marker, an error code when it is not a marker of ours.
fn read_owner_digest(marker: &Path) -> Result<Option<String>, &'static str> {
    match fs::symlink_metadata(marker) {
        Ok(metadata) if metadata.file_type().is_file() && metadata.len() <= 80 => {}
        Ok(_) => return Err("local_account_owner_invalid"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("local_account_owner_unavailable"),
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let file = options
        .open(marker)
        .map_err(|_| "local_account_owner_unavailable")?;
    let mut text = String::new();
    file.take(81)
        .read_to_string(&mut text)
        .map_err(|_| "local_account_owner_unavailable")?;
    let digest = text.trim();
    if valid_digest(digest) {
        Ok(Some(digest.to_owned()))
    } else {
        Err("local_account_owner_invalid")
    }
}

/// The local profile that owns the runtime, when exactly one record of this
/// app names it: the profile id and its scope. `None` for everything else (no
/// marker, the marker is the current profile's own, no record, two records, a
/// record that cannot be read, more records than the limit). Entries that are
/// not named like a record are not records and are ignored.
fn known_local_owner_at(
    profiles_root: &Path,
    marker: &Path,
    current: &AccountScope,
) -> Option<(String, AccountScope)> {
    let owner = read_owner_digest(marker).ok().flatten()?;
    if owner == current.digest() {
        return None;
    }
    let mut found: Option<(String, AccountScope)> = None;
    let mut seen = 0usize;
    for entry in fs::read_dir(profiles_root).ok()? {
        let name = entry.ok()?.file_name();
        let Some(profile_id) = name
            .to_str()
            .and_then(|name| name.strip_suffix(".json"))
            .filter(|id| valid_profile_id(id))
        else {
            continue;
        };
        seen += 1;
        if seen > PROFILE_RECORD_LIMIT {
            return None;
        }
        let scope = load_local_scope_at(profiles_root, profile_id).ok()?;
        if scope.digest() == owner {
            if found.is_some() {
                return None;
            }
            found = Some((profile_id.to_owned(), scope));
        }
    }
    found
}

fn issue_owner_change(
    state: &AccountScopeState,
    change: OwnerChange,
    current: &AccountScope,
    owner_digest: &str,
) -> Result<String, &'static str> {
    let token = hex(&ChaCha20Poly1305::generate_key(&mut OsRng));
    let mut pending = state
        .owner_change
        .lock()
        .map_err(|_| "account_scope_state_failed")?;
    *pending = Some(OwnerChangeGrant {
        token: token.clone(),
        change,
        scope_digest: current.digest().to_owned(),
        owner_digest: owner_digest.to_owned(),
        issued: Instant::now(),
    });
    Ok(token)
}

/// Spends the confirmation: it is gone after this call whatever the answer, so
/// a second click (or a replay) finds nothing.
fn spend_owner_change(
    state: &AccountScopeState,
    token: &str,
    change: OwnerChange,
    current: &AccountScope,
) -> Result<OwnerChangeGrant, &'static str> {
    let grant = state
        .owner_change
        .lock()
        .map_err(|_| "account_scope_state_failed")?
        .take()
        .ok_or("local_owner_change_refused")?;
    if grant.token == token
        && grant.change == change
        && grant.scope_digest == current.digest()
        && grant.issued.elapsed() <= OWNER_CHANGE_TTL
    {
        Ok(grant)
    } else {
        Err("local_owner_change_refused")
    }
}

/// Replaces the owner marker with the current profile's digest, and nothing else.
/// One attempt: the marker is read again right before the rename and must still
/// hold the digest that was probed; the temporary file is private, new, in the
/// same folder, and a leftover is swept by its own name only.
fn take_over_marker_at(
    home: &Path,
    expected_owner: &str,
    scope: &AccountScope,
) -> Result<(), &'static str> {
    const FAILED: &str = "local_owner_change_failed";
    let marker = home.join(".desktop-account-scope");
    let temp = home.join(TAKE_OVER_TEMP);
    match fs::symlink_metadata(home) {
        Ok(metadata) if metadata.file_type().is_dir() && is_ours(&metadata) => {}
        _ => return Err(FAILED),
    }
    match fs::symlink_metadata(&temp) {
        Ok(metadata) if !metadata.file_type().is_dir() => {
            fs::remove_file(&temp).map_err(|_| FAILED)?;
        }
        Ok(_) => return Err(FAILED),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(FAILED),
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600).custom_flags(libc::O_NOFOLLOW);
    }
    let written = (|| -> Result<(), &'static str> {
        let mut file = options.open(&temp).map_err(|_| FAILED)?;
        file.write_all(scope.digest().as_bytes())
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.sync_all())
            .map_err(|_| FAILED)?;
        #[cfg(windows)]
        crate::private_acl::protect_file(&temp).map_err(|_| FAILED)?;
        Ok(())
    })();
    let outcome = written
        .and_then(|_| match read_owner_digest(&marker) {
            Ok(Some(digest)) if digest == expected_owner => Ok(()),
            _ => Err("local_owner_change_refused"),
        })
        .and_then(|_| fs::rename(&temp, &marker).map_err(|_| FAILED));
    if outcome.is_err() {
        let _ = fs::remove_file(&temp);
        return outcome;
    }
    // The rename is the change: from here the marker is the current profile's, and an answer of
    // «failed» would be untrue. Reading it back is a warning to itself, never the result.
    let _ = verify_local_owner_marker(&marker, scope);
    Ok(())
}

fn owner_change_context(
    app: &tauri::AppHandle,
) -> Result<(PathBuf, PathBuf), &'static str> {
    let marker = local_owner_marker_path(app)?;
    let profiles = local_profiles_dir(app).map_err(|_| "local_owner_change_refused")?;
    Ok((marker, profiles))
}

const REFUSED: &str = "local_owner_change_refused";

/// The confirmation of one of the two ways: the owner is probed again and a
/// single-use token for that owner is issued.
fn confirm_owner_change_at(
    state: &AccountScopeState,
    change: &str,
    scope: &AccountScope,
    marker: &Path,
    profiles: &Path,
) -> Result<String, &'static str> {
    let change = OwnerChange::parse(change).ok_or(REFUSED)?;
    if !scope.is_local_profile() {
        return Err(REFUSED);
    }
    let (_, owner) = known_local_owner_at(profiles, marker, scope).ok_or(REFUSED)?;
    issue_owner_change(state, change, scope, owner.digest())
}

/// Spends the token for `change` and checks the owner is still the one the
/// person confirmed: the owner's profile id and scope.
fn resolve_owner_change_at(
    state: &AccountScopeState,
    token: &str,
    change: OwnerChange,
    scope: &AccountScope,
    marker: &Path,
    profiles: &Path,
) -> Result<(String, AccountScope), &'static str> {
    let grant = spend_owner_change(state, token, change, scope)?;
    if !scope.is_local_profile() {
        return Err(REFUSED);
    }
    known_local_owner_at(profiles, marker, scope)
        .filter(|(_, owner)| owner.digest() == grant.owner_digest)
        .ok_or(REFUSED)
}

fn take_over_with_token_at(
    state: &AccountScopeState,
    token: &str,
    scope: &AccountScope,
    marker: &Path,
    profiles: &Path,
) -> Result<(), &'static str> {
    let (_, owner) =
        resolve_owner_change_at(state, token, OwnerChange::TakeOver, scope, marker, profiles)?;
    let home = marker.parent().ok_or("local_owner_change_failed")?;
    take_over_marker_at(home, owner.digest(), scope)
}

/// Whether the runtime of this computer belongs to another local profile that
/// can be named, and the current profile is a local one: what the screen needs
/// to offer the two ways. No digest, no id, no path leaves the app.
#[tauri::command]
pub(crate) fn onboarding_local_owner_probe(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> bool {
    if window.label() != "main" {
        return false;
    }
    let Ok(guard) = scopes.lock_active() else {
        return false;
    };
    let scope = guard.scope();
    if !scope.is_local_profile() {
        return false;
    }
    owner_change_context(&app)
        .is_ok_and(|(marker, profiles)| known_local_owner_at(&profiles, &marker, scope).is_some())
}

/// The person confirmed one of the two ways: a single-use token for it.
#[tauri::command]
pub(crate) fn onboarding_local_owner_confirm(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    change: String,
) -> Result<String, onboarding::OnboardingError> {
    if window.label() != "main" {
        return Err(onboarding::failure(REFUSED));
    }
    let guard = scopes.lock_active().map_err(onboarding::failure)?;
    let (marker, profiles) = owner_change_context(&app).map_err(onboarding::failure)?;
    confirm_owner_change_at(&scopes, &change, guard.scope(), &marker, &profiles)
        .map_err(onboarding::failure)
}

/// Back to the owner: the app leaves the current scope the way signing out
/// does and enters the owner's. The owner's profile id goes back to the
/// renderer, which keeps it as it keeps the id of a profile it creates.
#[tauri::command]
pub(crate) fn onboarding_local_owner_return(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    chat: State<'_, direct_chat::DirectChatState>,
    onboarding: State<'_, onboarding::OnboardingNativeState>,
    token: String,
) -> Result<LocalProfileCreated, onboarding::OnboardingError> {
    if window.label() != "main" {
        return Err(onboarding::failure(REFUSED));
    }
    let current = scopes.active().map_err(onboarding::failure)?;
    let (marker, profiles) = owner_change_context(&app).map_err(onboarding::failure)?;
    let (profile_id, owner) = resolve_owner_change_at(
        &scopes,
        &token,
        OwnerChange::Return,
        &current,
        &marker,
        &profiles,
    )
    .map_err(onboarding::failure)?;
    activate_scope_from(&app, &scopes, &chat, &onboarding, Some(&current), owner)
        .map_err(|error| onboarding::failure(error.code))?;
    Ok(LocalProfileCreated { profile_id })
}

/// Take the runtime over: only the owner marker changes.
#[tauri::command]
pub(crate) fn onboarding_local_owner_take_over(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    token: String,
) -> Result<(), onboarding::OnboardingError> {
    if window.label() != "main" {
        return Err(onboarding::failure(REFUSED));
    }
    // The scope stays this one while the marker is written.
    let guard = scopes.lock_active().map_err(onboarding::failure)?;
    let (marker, profiles) = owner_change_context(&app).map_err(onboarding::failure)?;
    take_over_with_token_at(&scopes, &token, guard.scope(), &marker, &profiles)
        .map_err(onboarding::failure)
}

fn recognized_legacy_local_home(home: &Path) -> Result<bool, &'static str> {
    // These are durable artifacts written by the Electron local flow or by
    // the authoritative installer it invoked. Merely finding an arbitrary
    // non-empty directory is deliberately insufficient for migration.
    const FILE_MARKERS: &[&str] = &[
        "jht.config.json",
        "host.env",
        ".local-token",
        "cloud.json",
        "jobs.db",
    ];
    const DIRECTORY_MARKERS: &[&str] = &[
        ".npm-global",
        ".claude",
        ".codex",
        ".kimi",
        "credentials",
        "profile",
        "runtime",
        "src",
    ];

    for name in FILE_MARKERS {
        match fs::symlink_metadata(home.join(name)) {
            Ok(metadata) if metadata.file_type().is_file() => return Ok(true),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("local_account_owner_unavailable"),
        }
    }
    for name in DIRECTORY_MARKERS {
        match fs::symlink_metadata(home.join(name)) {
            Ok(metadata) if metadata.file_type().is_dir() => return Ok(true),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("local_account_owner_unavailable"),
        }
    }
    Ok(false)
}

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
    #[cfg(windows)]
    {
        fs::create_dir_all(path).map_err(|_| "local_account_owner_unavailable")?;
        crate::private_acl::protect_dir(path).map_err(|_| "local_account_owner_unavailable")
    }
    #[cfg(not(any(unix, windows)))]
    fs::create_dir_all(path).map_err(|_| "local_account_owner_unavailable")
}

fn write_owner_marker(marker: &PathBuf, scope: &AccountScope) -> Result<(), &'static str> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(marker) {
        Ok(mut file) => {
            file.write_all(scope.digest().as_bytes())
                .and_then(|_| file.write_all(b"\n"))
                .and_then(|_| file.sync_all())
                .map_err(|_| "local_account_owner_unavailable")?;
            #[cfg(windows)]
            crate::private_acl::protect_file(marker)
                .map_err(|_| "local_account_owner_unavailable")?;
            Ok(())
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(_) => Err("local_account_owner_unavailable"),
    }
}

/// Leaving an account (signing out, or switching to another one) takes its permission to write away for
/// good: the record of the full connection goes with the session in memory, so coming back within the
/// 30 days it lasts is the read-only view until the person confirms again. Best effort: leaving must not
/// fail because a file could not be removed (a file that cannot be removed is overwritten first, see
/// `existing_team_runtime::forget_full_link_at`).
pub(crate) fn forget_write_access_at(root: &Path, scope: &AccountScope) {
    let _ = crate::existing_team_runtime::forget_full_link_at(root, scope);
}

fn forget_write_access_of(app: &tauri::AppHandle, scope: Option<&AccountScope>) {
    if let (Some(scope), Ok(root)) = (scope, crate::existing_team_runtime::root(app)) {
        forget_write_access_at(&root, scope);
    }
}

fn activate_scope(
    app: &tauri::AppHandle,
    scopes: &AccountScopeState,
    chat: &direct_chat::DirectChatState,
    onboarding: &onboarding::OnboardingNativeState,
    next: AccountScope,
) -> Result<(), AccountScopeError> {
    activate_scope_from(app, scopes, chat, onboarding, None, next)
}

/// The one way out of the active scope: with `expected` set, only if that scope is still the active
/// one when the write lock is held (the scope a confirmation was given for).
fn activate_scope_from(
    app: &tauri::AppHandle,
    scopes: &AccountScopeState,
    chat: &direct_chat::DirectChatState,
    onboarding: &onboarding::OnboardingNativeState,
    expected: Option<&AccountScope>,
    next: AccountScope,
) -> Result<(), AccountScopeError> {
    let mut active = scopes
        .inner
        .write()
        .map_err(|_| failure("account_scope_state_failed"))?;
    if expected.is_some_and(|expected| active.as_ref() != Some(expected)) {
        return Err(failure("account_scope_changed"));
    }
    if active.as_ref() == Some(&next) {
        return Ok(());
    }
    // None is installed before cleanup: even a partial teardown cannot expose
    // the previous account to a new command.
    let previous = active.take();
    direct_chat::teardown(chat);
    onboarding::teardown(onboarding);
    crate::live_screen::teardown(app);
    crate::broker_view::teardown(app);
    forget_write_access_of(app, previous.as_ref());
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

fn local_profile_migration_paths(
    app: &tauri::AppHandle,
    profile_id: &str,
) -> Result<crate::profile_migration::MigrationPaths, &'static str> {
    if !valid_profile_id(profile_id) {
        return Err("local_profile_invalid");
    }
    let app_data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "local_profile_storage_unavailable")?;
    // This resolver must compile on Windows even though both public commands
    // deny the local runtime before invoking it.
    let runtime_home = app
        .path()
        .home_dir()
        .map(|home| home.join(".jht"))
        .map_err(|_| "local_account_owner_unavailable")?;
    Ok(crate::profile_migration::MigrationPaths {
        source_capability: app_data
            .join("local-profiles")
            .join(format!("{profile_id}.json")),
        app_data,
        runtime_home,
    })
}

#[tauri::command]
pub(crate) async fn runtime_local_profile_migration_probe(
    app: tauri::AppHandle,
    keys: State<'_, auth_store::SystemKeyCache>,
    scopes: State<'_, AccountScopeState>,
    profile_id: String,
) -> Result<bool, AccountScopeError> {
    if !local_runtime_allowed(std::env::consts::OS) {
        return Err(failure("local_runtime_unsupported"));
    }
    let account_id = auth_store::authenticated_account_id(&app, &keys)
        .await
        .map_err(failure)?;
    let target = derive_scope(account_id.as_bytes());
    let profiles = local_profiles_dir(&app).map_err(failure)?;
    let paths = local_profile_migration_paths(&app, &profile_id).map_err(failure)?;
    let source = match load_local_scope_at(&profiles, &profile_id) {
        Ok(source) => source,
        Err("local_profile_not_found") => {
            crate::profile_migration::recoverable_source(&paths, &target)
                .map_err(failure)?
                .ok_or_else(|| failure("local_profile_not_found"))?
        }
        Err(error) => return Err(failure(error)),
    };
    let active = scopes
        .inner
        .read()
        .map_err(|_| failure("account_scope_state_failed"))?;
    if active
        .as_ref()
        .is_some_and(|scope| scope != &source && scope != &target)
    {
        return Err(failure("account_scope_changed"));
    }
    crate::profile_migration::probe(&paths, &source, &target, || {
        direct_chat::verify_migration_local_host_at(&paths.app_data, &source)
    })
    .map_err(failure)
}

#[tauri::command]
pub(crate) async fn runtime_local_profile_migrate_to_authenticated(
    app: tauri::AppHandle,
    keys: State<'_, auth_store::SystemKeyCache>,
    scopes: State<'_, AccountScopeState>,
    chat: State<'_, direct_chat::DirectChatState>,
    onboarding: State<'_, onboarding::OnboardingNativeState>,
    profile_id: String,
) -> Result<crate::profile_migration::MigrationCommitted, AccountScopeError> {
    if !local_runtime_allowed(std::env::consts::OS) {
        return Err(failure("local_runtime_unsupported"));
    }
    let account_id = auth_store::authenticated_account_id(&app, &keys)
        .await
        .map_err(failure)?;
    let target = derive_scope(account_id.as_bytes());
    let paths = local_profile_migration_paths(&app, &profile_id).map_err(failure)?;
    let profiles = local_profiles_dir(&app).map_err(failure)?;
    let source = match load_local_scope_at(&profiles, &profile_id) {
        Ok(source) => source,
        Err("local_profile_not_found") => {
            crate::profile_migration::recoverable_source(&paths, &target)
                .map_err(failure)?
                .ok_or_else(|| failure("local_profile_not_found"))?
        }
        Err(error) => return Err(failure(error)),
    };
    let mut active = scopes
        .inner
        .write()
        .map_err(|_| failure("account_scope_state_failed"))?;
    if active
        .as_ref()
        .is_some_and(|scope| scope != &source && scope != &target)
    {
        return Err(failure("account_scope_changed"));
    }
    let previous = active.clone();
    // The write lock excludes every scoped IPC. Native handles are closed
    // before ownership changes, and no target operation can start early.
    *active = None;
    direct_chat::teardown(&chat);
    onboarding::teardown(&onboarding);
    crate::live_screen::teardown(&app);
    crate::broker_view::teardown(&app);
    match crate::profile_migration::migrate(
        &paths,
        &source,
        &target,
        || direct_chat::verify_migration_local_host_at(&paths.app_data, &source),
        || Ok(()),
    ) {
        Ok(committed) => {
            *active = Some(target);
            Ok(committed)
        }
        Err(error) => {
            *active = if error == "local_migration_recovery_required" {
                None
            } else {
                previous
            };
            Err(failure(error))
        }
    }
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
    let previous = active.take();
    direct_chat::teardown(&chat);
    onboarding::teardown(&onboarding);
    crate::live_screen::teardown(&app);
    crate::broker_view::teardown(&app);
    // Signing out: the permission to write does not wait for the person at the next sign-in.
    forget_write_access_of(&app, previous.as_ref());
    Ok(())
}

fn playground_reset_enabled(debug_build: bool) -> Result<(), &'static str> {
    if debug_build {
        Ok(())
    } else {
        Err("playground_reset_unavailable")
    }
}

fn orphaned_local_scope_at(
    profiles_root: &Path,
    owner_marker: &Path,
) -> Result<AccountScope, &'static str> {
    let marker_metadata =
        fs::symlink_metadata(owner_marker).map_err(|_| "playground_reset_owner_not_found")?;
    if !marker_metadata.file_type().is_file() || marker_metadata.len() > 80 {
        return Err("playground_reset_owner_invalid");
    }
    let owner_digest =
        fs::read_to_string(owner_marker).map_err(|_| "playground_reset_owner_unavailable")?;
    let owner_digest = owner_digest.trim();
    if !valid_digest(owner_digest) {
        return Err("playground_reset_owner_invalid");
    }

    let profiles_metadata =
        fs::symlink_metadata(profiles_root).map_err(|_| "playground_reset_owner_unattested")?;
    if !profiles_metadata.file_type().is_dir() {
        return Err("playground_reset_owner_unattested");
    }
    let mut matched = None;
    let mut count = 0usize;
    for entry in fs::read_dir(profiles_root).map_err(|_| "playground_reset_owner_unattested")? {
        count += 1;
        if count > 1024 {
            return Err("playground_reset_owner_unattested");
        }
        let entry = entry.map_err(|_| "playground_reset_owner_unattested")?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "playground_reset_owner_unattested")?;
        let profile_id = name
            .strip_suffix(".json")
            .filter(|value| valid_profile_id(value))
            .ok_or("playground_reset_owner_unattested")?;
        let scope = load_local_scope_at(profiles_root, profile_id)
            .map_err(|_| "playground_reset_owner_unattested")?;
        if scope.digest() == owner_digest {
            if matched.is_some() {
                return Err("playground_reset_owner_unattested");
            }
            matched = Some(scope);
        }
    }
    matched.ok_or("playground_reset_owner_unattested")
}

fn recover_playground_orphan_at(
    debug_build: bool,
    profiles_root: &Path,
    accounts_root: &Path,
    owner_marker: &Path,
    scopes: &AccountScopeState,
    teardown: impl FnOnce(&Option<AccountScope>),
) -> Result<bool, &'static str> {
    playground_reset_enabled(debug_build)?;
    let active = scopes
        .inner
        .write()
        .map_err(|_| "account_scope_state_failed")?;
    if active.is_some() {
        return Err("playground_reset_scope_active");
    }
    match fs::symlink_metadata(owner_marker) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("playground_reset_owner_unavailable"),
    }
    let orphan = orphaned_local_scope_at(profiles_root, owner_marker)?;
    direct_chat::verify_optional_playground_local_host_at(accounts_root, &orphan)?;

    teardown(&active);
    fs::remove_file(owner_marker).map_err(|_| "local_account_owner_unavailable")?;
    Ok(true)
}

fn reset_playground_scope_at(
    profiles_root: &Path,
    owner_marker: &Path,
    scopes: &AccountScopeState,
    profile_id: &str,
    teardown: impl FnOnce(&Option<AccountScope>),
) -> Result<(), &'static str> {
    playground_reset_enabled(cfg!(debug_assertions))?;
    let expected = load_local_scope_at(profiles_root, profile_id)?;
    let mut active = scopes
        .inner
        .write()
        .map_err(|_| "account_scope_state_failed")?;
    if active.as_ref().is_some_and(|scope| scope != &expected) {
        return Err("account_scope_changed");
    }

    let owner_present = match fs::symlink_metadata(owner_marker) {
        Ok(_) => {
            verify_local_owner_marker(owner_marker, &expected)?;
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(_) => return Err("local_account_owner_unavailable"),
    };

    // The scope becomes unavailable before any native handle is torn down.
    // Existing profile/scoped data remains on disk and cannot be reached by
    // the next opaque local profile. Only the exact runtime ownership marker
    // is released; runtime data, containers and provider credentials are not
    // touched by this DEV/test-only boundary.
    *active = None;
    teardown(&active);
    if owner_present {
        fs::remove_file(owner_marker).map_err(|_| "local_account_owner_unavailable")?;
    }
    Ok(())
}

/// DEV/test-only reset used by the onboarding playground. Release builds keep
/// the command registered so an accidental call fails with a stable code,
/// before any profile, scope or runtime path is inspected.
#[tauri::command]
pub(crate) fn runtime_playground_local_reset(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    chat: State<'_, direct_chat::DirectChatState>,
    onboarding: State<'_, onboarding::OnboardingNativeState>,
    profile_id: String,
) -> Result<(), AccountScopeError> {
    playground_reset_enabled(cfg!(debug_assertions)).map_err(failure)?;
    {
        let profiles = local_profiles_dir(&app).map_err(failure)?;
        let marker = local_owner_marker_path(&app).map_err(failure)?;
        reset_playground_scope_at(&profiles, &marker, &scopes, &profile_id, |_| {
            direct_chat::teardown(&chat);
            onboarding::teardown(&onboarding);
            crate::live_screen::teardown(&app);
            crate::broker_view::teardown(&app);
        })
        .map_err(failure)
    }
}

/// Recovers the historical playground state where renderer identity was
/// cleared but an attested local runtime owner remained. No profile ID is
/// accepted or returned; release builds fail before resolving any path.
#[tauri::command]
pub(crate) fn runtime_playground_local_orphan_recover(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    chat: State<'_, direct_chat::DirectChatState>,
    onboarding: State<'_, onboarding::OnboardingNativeState>,
) -> Result<bool, AccountScopeError> {
    playground_reset_enabled(cfg!(debug_assertions)).map_err(failure)?;
    {
        let app_data = app
            .path()
            .app_local_data_dir()
            .map_err(|_| failure("local_profile_storage_unavailable"))?;
        let profiles = app_data.join("local-profiles");
        let marker = local_owner_marker_path(&app).map_err(failure)?;
        recover_playground_orphan_at(true, &profiles, &app_data, &marker, &scopes, |_| {
            direct_chat::teardown(&chat);
            onboarding::teardown(&onboarding);
            crate::live_screen::teardown(&app);
            crate::broker_view::teardown(&app);
        })
        .map_err(failure)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        create_local_profile_at, derive_local_scope, derive_scope, load_local_scope_at,
        local_runtime_allowed, playground_reset_enabled, AccountScopeState,
    };
    #[cfg(not(target_os = "windows"))]
    use super::{
        recover_playground_orphan_at, reset_playground_scope_at, validate_or_claim_local_owner,
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
    fn windows_runs_the_team_locally_like_macos_and_linux() {
        // Red if the Windows block of 03/10 (66e744298) comes back.
        assert!(local_runtime_allowed("windows"));
        assert!(local_runtime_allowed("macos"));
        assert!(local_runtime_allowed("linux"));
        assert!(!local_runtime_allowed("ios"));
        assert!(!local_runtime_allowed(""));
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
    fn local_account_owner_missing_legacy_home_is_claimed_by_local_profile_only() {
        use std::{fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let home = std::env::temp_dir().join(format!("jht-local-legacy-{nonce}"));
        fs::create_dir_all(&home).unwrap();
        let config = home.join("jht.config.json");
        fs::write(&config, "{\"active_provider\":\"claude\"}\n").unwrap();
        let google = derive_scope(b"00000000-0000-4000-8000-000000000001");
        let local_a = derive_local_scope(b"local-profile-a");
        let local_b = derive_local_scope(b"local-profile-b");

        assert_eq!(
            validate_or_claim_local_owner(&home, &google),
            Err("local_account_owner_missing")
        );
        assert!(!home.join(".desktop-account-scope").exists());

        validate_or_claim_local_owner(&home, &local_a).unwrap();
        assert_eq!(
            fs::read_to_string(&config).unwrap(),
            "{\"active_provider\":\"claude\"}\n"
        );
        assert_eq!(
            validate_or_claim_local_owner(&home, &local_b),
            Err("local_account_owner_mismatch")
        );
        validate_or_claim_local_owner(&home, &local_a).unwrap();
        fs::remove_dir_all(home).unwrap();
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn arbitrary_populated_home_is_not_claimed_as_legacy_jht_data() {
        use std::{fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let home = std::env::temp_dir().join(format!("jht-local-unrelated-{nonce}"));
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join("unrelated.txt"), "not a JHT home\n").unwrap();
        let local = derive_local_scope(b"local-profile-a");
        assert_eq!(
            validate_or_claim_local_owner(&home, &local),
            Err("local_account_owner_missing")
        );
        assert!(!home.join(".desktop-account-scope").exists());
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn playground_reset_is_unavailable_in_production() {
        assert_eq!(
            playground_reset_enabled(false),
            Err("playground_reset_unavailable")
        );
        assert!(playground_reset_enabled(true).is_ok());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn playground_a_reset_b_releases_only_exact_runtime_binding() {
        use std::{cell::Cell, fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-playground-reset-{nonce}"));
        let profiles = root.join("app-data/local-profiles");
        let accounts = root.join("app-data/accounts");
        let runtime = root.join("home/.jht");
        let owner = runtime.join(".desktop-account-scope");
        let credentials = runtime.join("credentials/provider-preserved");
        let a = create_local_profile_at(&profiles).unwrap();
        let b = create_local_profile_at(&profiles).unwrap();
        let scope_a = load_local_scope_at(&profiles, &a.profile_id).unwrap();
        let scope_b = load_local_scope_at(&profiles, &b.profile_id).unwrap();
        fs::create_dir_all(accounts.join(scope_a.digest())).unwrap();
        fs::write(
            accounts
                .join(scope_a.digest())
                .join("direct-chat-host.json"),
            b"synthetic-scoped-host\n",
        )
        .unwrap();
        fs::create_dir_all(credentials.parent().unwrap()).unwrap();
        fs::write(&credentials, b"synthetic-provider-state\n").unwrap();
        validate_or_claim_local_owner(&runtime, &scope_a).unwrap();

        let state = AccountScopeState::default();
        *state.inner.write().unwrap() = Some(scope_a.clone());
        let torn_down = Cell::new(false);
        reset_playground_scope_at(&profiles, &owner, &state, &a.profile_id, |active| {
            assert!(active.is_none());
            torn_down.set(true);
        })
        .unwrap();

        assert!(torn_down.get());
        assert!(state.active().is_err());
        assert!(!owner.exists());
        assert!(profiles.join(format!("{}.json", a.profile_id)).is_file());
        assert!(profiles.join(format!("{}.json", b.profile_id)).is_file());
        assert_eq!(
            fs::read(&credentials).unwrap(),
            b"synthetic-provider-state\n"
        );
        assert!(accounts
            .join(scope_a.digest())
            .join("direct-chat-host.json")
            .is_file());
        assert!(!accounts.join(scope_b.digest()).exists());

        validate_or_claim_local_owner(&runtime, &scope_b).unwrap();
        assert_eq!(
            validate_or_claim_local_owner(&runtime, &scope_a),
            Err("local_account_owner_mismatch")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn playground_reset_rejects_a_foreign_owner_without_teardown_or_mutation() {
        use std::{cell::Cell, fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-playground-deny-{nonce}"));
        let profiles = root.join("app-data/local-profiles");
        let runtime = root.join("home/.jht");
        let owner = runtime.join(".desktop-account-scope");
        let a = create_local_profile_at(&profiles).unwrap();
        let foreign = create_local_profile_at(&profiles).unwrap();
        let scope_a = load_local_scope_at(&profiles, &a.profile_id).unwrap();
        let scope_foreign = load_local_scope_at(&profiles, &foreign.profile_id).unwrap();
        validate_or_claim_local_owner(&runtime, &scope_foreign).unwrap();
        let before = fs::read(&owner).unwrap();
        let state = AccountScopeState::default();
        *state.inner.write().unwrap() = Some(scope_a.clone());
        let torn_down = Cell::new(false);

        assert_eq!(
            reset_playground_scope_at(&profiles, &owner, &state, &a.profile_id, |_| {
                torn_down.set(true);
            }),
            Err("local_account_owner_mismatch")
        );
        assert!(!torn_down.get());
        assert_eq!(state.active().unwrap(), scope_a);
        assert_eq!(fs::read(&owner).unwrap(), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn playground_orphan_recovery_allows_b_without_touching_a_or_runtime_data() {
        use std::{cell::Cell, fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-playground-orphan-{nonce}"));
        let app_data = root.join("app-data");
        let profiles = app_data.join("local-profiles");
        let runtime = root.join("home/.jht");
        let owner = runtime.join(".desktop-account-scope");
        let credentials = runtime.join("credentials/provider-preserved");
        let a = create_local_profile_at(&profiles).unwrap();
        let b = create_local_profile_at(&profiles).unwrap();
        let scope_a = load_local_scope_at(&profiles, &a.profile_id).unwrap();
        let scope_b = load_local_scope_at(&profiles, &b.profile_id).unwrap();
        let scoped_a = app_data.join("accounts").join(scope_a.digest());
        fs::create_dir_all(&scoped_a).unwrap();
        fs::write(
            scoped_a.join("direct-chat-host.json"),
            br#"{"kind":"local"}"#,
        )
        .unwrap();
        fs::write(scoped_a.join("onboarding-diagnostics.jsonl"), b"{}\n").unwrap();
        fs::create_dir_all(credentials.parent().unwrap()).unwrap();
        fs::write(&credentials, b"synthetic-provider-state\n").unwrap();
        validate_or_claim_local_owner(&runtime, &scope_a).unwrap();
        let state = AccountScopeState::default();
        let torn_down = Cell::new(false);

        assert!(recover_playground_orphan_at(
            true,
            &profiles,
            &app_data,
            &owner,
            &state,
            |active| {
                assert!(active.is_none());
                torn_down.set(true);
            },
        )
        .unwrap());

        assert!(torn_down.get());
        assert!(!owner.exists());
        assert!(profiles.join(format!("{}.json", a.profile_id)).is_file());
        assert!(profiles.join(format!("{}.json", b.profile_id)).is_file());
        assert!(scoped_a.join("direct-chat-host.json").is_file());
        assert!(scoped_a.join("onboarding-diagnostics.jsonl").is_file());
        assert_eq!(
            fs::read(&credentials).unwrap(),
            b"synthetic-provider-state\n"
        );
        assert!(!app_data.join("accounts").join(scope_b.digest()).exists());

        validate_or_claim_local_owner(&runtime, &scope_b).unwrap();
        assert_eq!(
            validate_or_claim_local_owner(&runtime, &scope_a),
            Err("local_account_owner_mismatch")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn playground_orphan_recovery_is_noop_when_no_owner_exists() {
        use std::{cell::Cell, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-playground-no-orphan-{nonce}"));
        let profiles = root.join("missing-local-profiles");
        let app_data = root.join("missing-app-data");
        let owner = root.join("missing-home/.jht/.desktop-account-scope");
        let torn_down = Cell::new(false);

        assert!(!recover_playground_orphan_at(
            true,
            &profiles,
            &app_data,
            &owner,
            &AccountScopeState::default(),
            |_| torn_down.set(true),
        )
        .unwrap());
        assert!(!torn_down.get());
        assert!(!root.exists());
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn playground_orphan_recovery_release_denies_before_paths() {
        use std::{cell::Cell, fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-playground-release-deny-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        let marker = root.join("owner-sentinel");
        fs::write(&marker, b"sentinel\n").unwrap();
        let before = fs::read(&marker).unwrap();
        let torn_down = Cell::new(false);

        assert_eq!(
            recover_playground_orphan_at(
                false,
                &root.join("missing-profiles"),
                &root.join("missing-app-data"),
                &marker,
                &AccountScopeState::default(),
                |_| torn_down.set(true),
            ),
            Err("playground_reset_unavailable")
        );
        assert!(!torn_down.get());
        assert_eq!(fs::read(&marker).unwrap(), before);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn playground_orphan_recovery_rejects_unattested_marker_without_mutation() {
        use std::{cell::Cell, fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-playground-owner-deny-{nonce}"));
        let app_data = root.join("app-data");
        let profiles = app_data.join("local-profiles");
        let runtime = root.join("home/.jht");
        let owner = runtime.join(".desktop-account-scope");
        let local = create_local_profile_at(&profiles).unwrap();
        let local_scope = load_local_scope_at(&profiles, &local.profile_id).unwrap();
        let google = derive_scope(b"synthetic-google-account");
        validate_or_claim_local_owner(&runtime, &google).unwrap();
        let before = fs::read(&owner).unwrap();
        let torn_down = Cell::new(false);

        assert_eq!(
            recover_playground_orphan_at(
                true,
                &profiles,
                &app_data,
                &owner,
                &AccountScopeState::default(),
                |_| torn_down.set(true),
            ),
            Err("playground_reset_owner_unattested")
        );
        assert!(!torn_down.get());
        assert_eq!(fs::read(&owner).unwrap(), before);
        assert!(profiles
            .join(format!("{}.json", local.profile_id))
            .is_file());
        assert_eq!(
            validate_or_claim_local_owner(&runtime, &local_scope),
            Err("local_account_owner_mismatch")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn playground_orphan_recovery_rejects_vps_host_without_mutation() {
        use std::{cell::Cell, fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-playground-host-deny-{nonce}"));
        let app_data = root.join("app-data");
        let profiles = app_data.join("local-profiles");
        let runtime = root.join("home/.jht");
        let owner = runtime.join(".desktop-account-scope");
        let a = create_local_profile_at(&profiles).unwrap();
        let scope_a = load_local_scope_at(&profiles, &a.profile_id).unwrap();
        let host_path = app_data
            .join("accounts")
            .join(scope_a.digest())
            .join("direct-chat-host.json");
        fs::create_dir_all(host_path.parent().unwrap()).unwrap();
        fs::write(
            &host_path,
            br#"{"kind":"vps","address":"example.invalid","user":"synthetic","port":22,"keyPath":"/synthetic/key"}"#,
        )
        .unwrap();
        validate_or_claim_local_owner(&runtime, &scope_a).unwrap();
        let marker_before = fs::read(&owner).unwrap();
        let host_before = fs::read(&host_path).unwrap();
        let torn_down = Cell::new(false);

        assert_eq!(
            recover_playground_orphan_at(
                true,
                &profiles,
                &app_data,
                &owner,
                &AccountScopeState::default(),
                |_| torn_down.set(true),
            ),
            Err("playground_reset_host_not_local")
        );
        assert!(!torn_down.get());
        assert_eq!(fs::read(&owner).unwrap(), marker_before);
        assert_eq!(fs::read(&host_path).unwrap(), host_before);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn previous_local_data_is_a_recognised_home_no_profile_has_taken() {
        let root = std::env::temp_dir().join(format!(
            "jht-previous-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let home = root.join(".jht");
        // Nothing there: a first install.
        assert!(!super::previous_local_data_at(&home));
        std::fs::create_dir_all(&home).unwrap();
        assert!(!super::previous_local_data_at(&home));
        // A folder the game never wrote is not its data.
        std::fs::write(home.join("notes.txt"), "x").unwrap();
        assert!(!super::previous_local_data_at(&home));
        // The game's config and Codex login.
        std::fs::write(home.join("jht.config.json"), "{}").unwrap();
        std::fs::create_dir_all(home.join(".codex")).unwrap();
        assert!(super::previous_local_data_at(&home));
        // Already taken by a profile of this app: nothing to say any more.
        std::fs::write(home.join(".desktop-account-scope"), "x").unwrap();
        assert!(!super::previous_local_data_at(&home));
        let _ = std::fs::remove_dir_all(&root);
    }

    /// The upgrade the end-to-end tester runs on Windows: the v0.3.9 game
    /// left ~/.jht full (configuration, profile, Codex login, the database,
    /// logs). The onboarding says it will reuse it; a local profile then
    /// takes it exactly as it is (only the owner marker is added, nothing is
    /// moved, rewritten or removed), an account takes nothing. Synthetic
    /// fixture, no real data. Runs on every system, Windows included.
    #[test]
    fn a_v039_home_is_announced_then_taken_as_it_is_by_a_local_profile_only() {
        use std::{collections::BTreeMap, fs, path::Path};

        fn snapshot(root: &Path) -> BTreeMap<String, Vec<u8>> {
            let mut files = BTreeMap::new();
            let mut pending = vec![root.to_path_buf()];
            while let Some(dir) = pending.pop() {
                for entry in fs::read_dir(&dir).unwrap() {
                    let path = entry.unwrap().path();
                    let name = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                    if path.is_dir() {
                        files.insert(format!("{name}/"), Vec::new());
                        pending.push(path);
                    } else {
                        files.insert(name, fs::read(&path).unwrap());
                    }
                }
            }
            files
        }

        let root = std::env::temp_dir().join(format!(
            "jht-v039-upgrade-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let home = root.join(".jht");
        for (file, content) in [
            ("jht.config.json", "{\"version\":\"0.3.9\",\"active_provider\":\"codex\"}\n"),
            ("profile/candidate_profile.yml", "name: Synthetic Candidate\nlocation: Example City\n"),
            (".codex/auth.json", "{\"auth_mode\":\"chatgpt\",\"tokens\":\"synthetic-fixture\"}\n"),
            (".codex/config.toml", "model = \"synthetic\"\n"),
            ("jobs.db", "SQLite format 3\u{0}synthetic"),
            ("logs/team.log", "synthetic log line\n"),
        ] {
            let path = home.join(file);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, content).unwrap();
        }
        let before = snapshot(&home);

        // The review step announces the reuse.
        assert!(super::previous_local_data_at(&home));

        // A signed-in account takes nothing and changes nothing.
        let google = derive_scope(b"00000000-0000-4000-8000-000000000001");
        assert_eq!(
            super::validate_or_claim_local_owner(&home, &google),
            Err("local_account_owner_missing")
        );
        assert_eq!(snapshot(&home), before);
        assert!(super::previous_local_data_at(&home));

        // A local profile takes the home as it is: every file of v0.3.9
        // byte for byte, and only the owner marker added.
        let local = derive_local_scope(b"local-profile-upgrade");
        super::validate_or_claim_local_owner(&home, &local).unwrap();
        let mut after = snapshot(&home);
        assert!(after.remove(".desktop-account-scope").is_some());
        assert_eq!(after, before);
        // Taken: nothing to announce on the next run, and it stays its own.
        assert!(!super::previous_local_data_at(&home));
        super::validate_or_claim_local_owner(&home, &local).unwrap();
        assert_eq!(
            super::validate_or_claim_local_owner(&home, &derive_local_scope(b"another-profile")),
            Err("local_account_owner_mismatch")
        );
        let _ = fs::remove_dir_all(&root);
    }

    // ── A home of leftovers, «use this data», «set it aside» ────────────────

    fn leftovers_root(label: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "jht-owner-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join(".jht")).unwrap();
        root
    }

    /// Every entry of a tree with its kind and bytes: what «nothing was touched» compares.
    fn tree(root: &std::path::Path) -> std::collections::BTreeMap<String, Vec<u8>> {
        let mut entries = std::collections::BTreeMap::new();
        let mut pending = vec![root.to_path_buf()];
        while let Some(dir) = pending.pop() {
            for entry in std::fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                let name = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                let kind = std::fs::symlink_metadata(&path).unwrap().file_type();
                if kind.is_symlink() {
                    entries.insert(format!("{name}@"), Vec::new());
                } else if kind.is_dir() {
                    entries.insert(format!("{name}/"), Vec::new());
                    pending.push(path);
                } else {
                    entries.insert(name, std::fs::read(&path).unwrap());
                }
            }
        }
        entries
    }

    fn leftovers_only(home: &std::path::Path) -> bool {
        super::home_holds_only_leftovers(home).unwrap()
    }

    #[test]
    fn a_home_of_leftovers_is_taken_by_any_scope_and_nothing_in_it_is_touched() {
        // What the Mac of the 2.A had: the flag a test wrote, an empty logs folder,
        // and empty folders besides.
        let root = leftovers_root("leftovers");
        let home = root.join(".jht");
        std::fs::create_dir_all(home.join("logs")).unwrap();
        std::fs::create_dir_all(home.join("a/b/c")).unwrap();
        std::fs::write(home.join("logs/runtime.log"), "").unwrap();
        std::fs::write(home.join(".team-halted.flag"), "halted_by=team-state-reconciler\nat=2026-10-26T10:00:00.000Z\n").unwrap();
        let before = tree(&home);
        assert!(leftovers_only(&home));
        // It is not announced as an earlier version's data: there are none.
        assert!(!super::previous_local_data_at(&home));

        let local = derive_local_scope(b"local-profile-leftovers");
        super::validate_or_claim_local_owner(&home, &local).unwrap();
        // Only the owner marker was added; the flag, the logs and the folders are as they were.
        let mut after = tree(&home);
        assert_eq!(after.remove(".desktop-account-scope").map(|digest| digest.len() > 0), Some(true));
        assert_eq!(after, before);
        assert_eq!(
            super::validate_or_claim_local_owner(&home, &derive_local_scope(b"another")),
            Err("local_account_owner_mismatch")
        );

        // An account takes it too: there are no one's data in it.
        let other = leftovers_root("leftovers-account");
        std::fs::create_dir_all(other.join(".jht/logs")).unwrap();
        let google = derive_scope(b"00000000-0000-4000-8000-000000000001");
        super::validate_or_claim_local_owner(&other.join(".jht"), &google).unwrap();
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&other);
    }

    #[test]
    fn the_list_of_leftovers_is_closed_one_entry_at_a_time() {
        use std::fs;
        let root = leftovers_root("closed");
        let home = root.join(".jht");
        let fresh = |sub: &str| {
            let dir = root.join(sub);
            fs::create_dir_all(dir.join("logs")).unwrap();
            dir
        };

        // In the list.
        let ok = fresh("ok");
        assert!(leftovers_only(&ok), "folders with nothing in them");
        fs::write(ok.join(".team-halted.flag"), "").unwrap();
        assert!(leftovers_only(&ok), "the flag, empty");
        for flag in ["halted_by=stop\n", "halted_by=desktop-open-without-team\n", "halted_by=team-state-reconciler\nat=2026-10-26T10:00:00.000Z\n"] {
            fs::write(ok.join(".team-halted.flag"), flag).unwrap();
            assert!(leftovers_only(&ok), "the flag as the product writes it: {flag:?}");
        }
        fs::write(ok.join("logs/runtime.log"), "").unwrap();
        assert!(leftovers_only(&ok), "a log of zero bytes in logs/");

        // Out of the list: each one makes the home data on its own.
        let data = |label: &str, setup: &dyn Fn(&std::path::Path)| {
            let dir = fresh(label);
            setup(&dir);
            assert!(!leftovers_only(&dir), "{label} is data");
        };
        data("a file with content", &|d| fs::write(d.join("notes.txt"), "x").unwrap());
        data("a file of zero bytes with another name", &|d| fs::write(d.join("empty.txt"), "").unwrap());
        data("the database, empty", &|d| fs::write(d.join("jobs.db"), "").unwrap());
        data("the configuration, empty", &|d| fs::write(d.join("jht.config.json"), "").unwrap());
        data("a log with content", &|d| fs::write(d.join("logs/runtime.log"), "a line\n").unwrap());
        data("a log outside logs/", &|d| fs::write(d.join("runtime.log"), "").unwrap());
        data("a file in logs/ that is not a log", &|d| fs::write(d.join("logs/notes.txt"), "").unwrap());
        data("a log in a folder inside logs/", &|d| {
            fs::create_dir_all(d.join("logs/old")).unwrap();
            fs::write(d.join("logs/old/runtime.log"), "").unwrap();
        });
        data("the flag in a folder", &|d| {
            fs::create_dir_all(d.join("sub")).unwrap();
            fs::write(d.join("sub/.team-halted.flag"), "").unwrap();
        });
        data("the flag with other content", &|d| fs::write(d.join(".team-halted.flag"), "do not start\n").unwrap());
        data("the flag with a third line", &|d| fs::write(d.join(".team-halted.flag"), "halted_by=stop\nat=2026-10-26\nmore\n").unwrap());
        data("the flag with a long name", &|d| fs::write(d.join(".team-halted.flag"), format!("halted_by={}\n", "a".repeat(60))).unwrap());
        data("the flag with a path in it", &|d| fs::write(d.join(".team-halted.flag"), "halted_by=/Users/someone\n").unwrap());
        data("the owner marker of another run", &|d| fs::write(d.join(".desktop-account-scope"), "").unwrap());
        data("a folder too deep", &|d| fs::create_dir_all(d.join("a/b/c/d/e/f")).unwrap());
        data("too many entries", &|d| {
            for index in 0..70 {
                fs::create_dir_all(d.join(format!("dir{index}"))).unwrap();
            }
        });
        let _ = home;
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_place_of_a_folder_is_data_and_is_never_followed() {
        use std::{fs, os::unix::fs::symlink};
        let root = leftovers_root("links");
        let home = root.join(".jht");
        let outside = root.join("outside");
        fs::create_dir_all(&outside).unwrap();
        // The link points to a folder with nothing in it: still data.
        symlink(&outside, home.join("profile")).unwrap();
        assert!(!leftovers_only(&home));
        let before = tree(&home);
        assert_eq!(
            super::validate_or_claim_local_owner(&home, &derive_scope(b"00000000-0000-4000-8000-000000000001")),
            Err("local_account_owner_missing")
        );
        assert_eq!(tree(&home), before);
        // A broken link too, and a link in place of the flag.
        fs::remove_file(home.join("profile")).unwrap();
        symlink(root.join("nowhere"), home.join(".team-halted.flag")).unwrap();
        assert!(!leftovers_only(&home));
        // And the home itself as a link is not a home to take.
        let linked = root.join("linked");
        symlink(&outside, &linked).unwrap();
        let local = derive_local_scope(b"local-profile-link");
        assert!(super::adopt_unassigned_local_home(&linked, &local).is_err());
        assert!(!outside.join(".desktop-account-scope").exists());
        assert!(super::set_aside_unassigned_local_home(&linked, 0).is_err());
        assert!(fs::symlink_metadata(&linked).unwrap().file_type().is_symlink());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_home_that_is_a_link_is_refused_before_anything_is_looked_at_or_written() {
        use std::{fs, os::unix::fs::symlink};
        let root = leftovers_root("home-link");
        // The link points to a folder of leftovers, which would be taken if it were the home.
        let target = root.join("target");
        fs::create_dir_all(target.join("logs")).unwrap();
        let linked = root.join("linked");
        symlink(&target, &linked).unwrap();
        for scope in [derive_local_scope(b"local-profile-link"), derive_scope(b"00000000-0000-4000-8000-000000000001")] {
            assert_eq!(super::validate_or_claim_local_owner(&linked, &scope), Err("local_account_owner_unavailable"));
        }
        assert!(!target.join(".desktop-account-scope").exists());
        assert!(fs::symlink_metadata(&linked).unwrap().file_type().is_symlink());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn real_data_not_assigned_waits_for_the_choice_and_leaving_changes_nothing() {
        let root = leftovers_root("choice");
        let home = root.join(".jht");
        std::fs::write(home.join("unrelated.txt"), "a note\n").unwrap();
        std::fs::create_dir_all(home.join("logs")).unwrap();
        let before = tree(&home);
        let local = derive_local_scope(b"local-profile-choice");
        // The setup stops, as before; no marker, nothing moved: leaving is free.
        for _ in 0..2 {
            assert_eq!(
                super::validate_or_claim_local_owner(&home, &local),
                Err("local_account_owner_missing")
            );
            assert_eq!(tree(&home), before);
        }
        assert!(!super::previous_local_data_at(&home));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn use_this_data_takes_the_home_as_it_is_for_a_local_profile_only() {
        let root = leftovers_root("adopt");
        let home = root.join(".jht");
        std::fs::write(home.join("unrelated.txt"), "a note\n").unwrap();
        let before = tree(&home);
        let google = derive_scope(b"00000000-0000-4000-8000-000000000001");
        let local = derive_local_scope(b"local-profile-adopt");

        // An account never takes data it did not make.
        assert_eq!(super::adopt_unassigned_local_home(&home, &google), Err("local_account_owner_missing"));
        assert_eq!(tree(&home), before);

        super::adopt_unassigned_local_home(&home, &local).unwrap();
        let mut after = tree(&home);
        assert!(after.remove(".desktop-account-scope").is_some());
        assert_eq!(after, before);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(home.join(".desktop-account-scope")).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        // Now it is the normal case: the same profile passes, another does not.
        super::validate_or_claim_local_owner(&home, &local).unwrap();
        let other = derive_local_scope(b"local-profile-other");
        assert_eq!(super::validate_or_claim_local_owner(&home, &other), Err("local_account_owner_mismatch"));
        // An owner that exists is checked and never replaced, «use» or not.
        let mark = std::fs::read(home.join(".desktop-account-scope")).unwrap();
        assert_eq!(super::adopt_unassigned_local_home(&home, &other), Err("local_account_owner_mismatch"));
        assert_eq!(std::fs::read(home.join(".desktop-account-scope")).unwrap(), mark);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_corrupt_owner_marker_is_not_repaired_by_use_this_data() {
        let root = leftovers_root("corrupt");
        let home = root.join(".jht");
        std::fs::write(home.join(".desktop-account-scope"), "x".repeat(200)).unwrap();
        let local = derive_local_scope(b"local-profile-corrupt");
        assert_eq!(super::adopt_unassigned_local_home(&home, &local), Err("local_account_owner_invalid"));
        assert_eq!(std::fs::read(home.join(".desktop-account-scope")).unwrap().len(), 200);
        assert!(super::set_aside_unassigned_local_home(&home, 0).is_err());
        assert!(home.join(".desktop-account-scope").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn set_it_aside_moves_the_home_under_a_dated_name_and_never_overwrites() {
        let root = leftovers_root("aside");
        let home = root.join(".jht");
        std::fs::write(home.join("unrelated.txt"), "a note\n").unwrap();
        std::fs::create_dir_all(home.join("logs")).unwrap();
        let before = tree(&home);
        // 2023-11-14 22:13:20 UTC.
        let name = super::set_aside_unassigned_local_home(&home, 1_700_000_000).unwrap();
        assert_eq!(name, "jht-data-set-aside-20231114-221320");
        assert!(!home.exists());
        // Moved, not copied: every file with its content under the new name.
        assert_eq!(tree(&root.join(&name)), before);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(root.join(&name)).unwrap().permissions().mode() & 0o777, 0o700);
        }
        // The next setup starts from nothing: a new home is created and taken.
        let local = derive_local_scope(b"local-profile-aside");
        super::validate_or_claim_local_owner(&home, &local).unwrap();

        // The same second again: the name is taken, so the next one is used and the first is untouched.
        std::fs::write(home.join("second.txt"), "two\n").unwrap();
        std::fs::remove_file(home.join(".desktop-account-scope")).unwrap();
        let second = super::set_aside_unassigned_local_home(&home, 1_700_000_000).unwrap();
        assert_eq!(second, "jht-data-set-aside-20231114-221320-1");
        assert_eq!(tree(&root.join(&name)), before);
        assert!(root.join(&second).join("second.txt").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn when_the_move_fails_nothing_was_touched() {
        use std::os::unix::fs::PermissionsExt;
        let root = leftovers_root("aside-fails");
        let home = root.join(".jht");
        std::fs::write(home.join("unrelated.txt"), "a note\n").unwrap();
        let before = tree(&home);
        // The folder the home lives in cannot be written: the rename fails.
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o500)).unwrap();
        let writable = std::fs::File::create(root.join("probe")).is_ok();
        let result = super::set_aside_unassigned_local_home(&home, 1_700_000_000);
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        if !writable {
            assert_eq!(result, Err("local_data_set_aside_failed"));
            assert_eq!(tree(&home), before);
            assert!(std::fs::read_dir(&root).unwrap().all(|entry| {
                !entry.unwrap().file_name().to_string_lossy().starts_with("jht-data-set-aside")
            }));
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn the_stamp_of_a_unix_time_is_the_utc_date() {
        assert_eq!(super::civil_stamp(0), "19700101-000000");
        assert_eq!(super::civil_stamp(1_700_000_000), "20231114-221320");
        // A leap day, and the end of a year.
        assert_eq!(super::civil_stamp(1_709_164_800 + 3_661), "20240229-010101");
        assert_eq!(super::civil_stamp(1_798_761_599), "20261231-235959");
    }
}

#[cfg(test)]
mod owner_change_tests {
    use super::*;
    use std::collections::BTreeMap;

    struct Fixture {
        root: PathBuf,
        profiles: PathBuf,
        home: PathBuf,
        marker: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "jht-owner-change-{label}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let profiles = root.join("local-profiles");
            let home = root.join(".jht");
            fs::create_dir_all(&home).unwrap();
            Self { marker: home.join(".desktop-account-scope"), root, profiles, home }
        }

        /// A real local profile: its record on disk and its scope.
        fn profile(&self) -> (String, AccountScope) {
            let created = create_local_profile_at(&self.profiles).unwrap();
            let scope = load_local_scope_at(&self.profiles, &created.profile_id).unwrap();
            (created.profile_id, scope)
        }

        fn own(&self, scope: &AccountScope) {
            fs::write(&self.marker, format!("{}\n", scope.digest())).unwrap();
        }

        fn marker_text(&self) -> String {
            fs::read_to_string(&self.marker).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
        let mut entries = BTreeMap::new();
        let mut pending = vec![root.to_path_buf()];
        while let Some(dir) = pending.pop() {
            for entry in fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                let name = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                if fs::symlink_metadata(&path).unwrap().file_type().is_dir() {
                    pending.push(path);
                } else {
                    entries.insert(name, fs::read(&path).unwrap());
                }
            }
        }
        entries
    }

    #[test]
    fn the_owner_is_known_only_when_exactly_one_local_record_names_it() {
        let f = Fixture::new("one");
        let (owner_id, owner) = f.profile();
        let (_, current) = f.profile();
        f.own(&owner);
        assert_eq!(known_local_owner_at(&f.profiles, &f.marker, &current), Some((owner_id.clone(), owner.clone())));
        // Things in the folder that are not named like a record are not records.
        fs::write(f.profiles.join(".DS_Store"), "x").unwrap();
        fs::write(f.profiles.join("notes.json"), "x").unwrap();
        assert!(known_local_owner_at(&f.profiles, &f.marker, &current).is_some());
        // The marker is the current profile's own: there is no other owner.
        f.own(&current);
        assert_eq!(known_local_owner_at(&f.profiles, &f.marker, &current), None);
        // No marker.
        fs::remove_file(&f.marker).unwrap();
        assert_eq!(known_local_owner_at(&f.profiles, &f.marker, &current), None);
    }

    #[test]
    fn two_equal_records_an_unreadable_record_or_too_many_records_make_the_owner_unknown() {
        let f = Fixture::new("doubt");
        let (owner_id, owner) = f.profile();
        let (_, current) = f.profile();
        f.own(&owner);
        assert!(known_local_owner_at(&f.profiles, &f.marker, &current).is_some());

        // The same record under a second name.
        let twin = format!("{}{}", "a".repeat(32), &owner_id[32..]);
        fs::copy(f.profiles.join(format!("{owner_id}.json")), f.profiles.join(format!("{twin}.json"))).unwrap();
        assert_eq!(known_local_owner_at(&f.profiles, &f.marker, &current), None);
        fs::remove_file(f.profiles.join(format!("{twin}.json"))).unwrap();
        assert!(known_local_owner_at(&f.profiles, &f.marker, &current).is_some());

        // A record named like one that cannot be read.
        let broken = f.profiles.join(format!("{}.json", "b".repeat(64)));
        fs::write(&broken, "not json").unwrap();
        assert_eq!(known_local_owner_at(&f.profiles, &f.marker, &current), None);
        fs::write(&broken, "x".repeat(4096)).unwrap();
        assert_eq!(known_local_owner_at(&f.profiles, &f.marker, &current), None);
        fs::remove_file(&broken).unwrap();
        assert!(known_local_owner_at(&f.profiles, &f.marker, &current).is_some());

        // More records than the limit.
        let extra = PROFILE_RECORD_LIMIT;
        for index in 0..extra {
            let id = format!("{index:064x}");
            fs::write(f.profiles.join(format!("{id}.json")), format!("{{\"scopeDigest\":\"{}\"}}", "c".repeat(64))).unwrap();
        }
        assert_eq!(known_local_owner_at(&f.profiles, &f.marker, &current), None);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_place_of_a_record_or_of_the_marker_is_never_followed() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new("links");
        let (owner_id, owner) = f.profile();
        let (_, current) = f.profile();
        f.own(&owner);
        assert!(known_local_owner_at(&f.profiles, &f.marker, &current).is_some());

        // The marker as a link to a file that holds the owner's digest.
        let outside = f.root.join("outside");
        fs::write(&outside, format!("{}\n", owner.digest())).unwrap();
        fs::remove_file(&f.marker).unwrap();
        symlink(&outside, &f.marker).unwrap();
        assert_eq!(known_local_owner_at(&f.profiles, &f.marker, &current), None);
        assert_eq!(read_owner_digest(&f.marker), Err("local_account_owner_invalid"));
        fs::remove_file(&f.marker).unwrap();
        f.own(&owner);

        // The owner's record as a link.
        let record = f.profiles.join(format!("{owner_id}.json"));
        let kept = f.root.join("kept.json");
        fs::rename(&record, &kept).unwrap();
        symlink(&kept, &record).unwrap();
        assert_eq!(known_local_owner_at(&f.profiles, &f.marker, &current), None);
    }

    #[test]
    fn an_account_digest_never_matches_a_local_record_and_the_other_way_round() {
        // The same bytes under the two domains give two digests.
        for seed in [&b"same"[..], b"00000000-0000-4000-8000-000000000001", &[7u8; 32][..]] {
            assert_ne!(derive_scope(seed).digest(), derive_local_scope(seed).digest());
            assert!(!derive_scope(seed).is_local_profile());
            assert!(derive_local_scope(seed).is_local_profile());
        }
        let f = Fixture::new("domains");
        let records: Vec<(String, AccountScope)> = (0..24).map(|_| f.profile()).collect();
        let (_, current) = f.profile();
        for (id, scope) in &records {
            // An account derived from the id, from the digest, from the record's own text.
            for material in [id.as_bytes(), scope.digest().as_bytes()] {
                let account = derive_scope(material);
                assert!(records.iter().all(|(_, record)| record.digest() != account.digest()));
                // An account owner is no known local owner.
                f.own(&account);
                assert_eq!(known_local_owner_at(&f.profiles, &f.marker, &current), None);
            }
            // And a local record's digest, as a marker, never equals an account's scope.
            f.own(scope);
            assert_ne!(read_owner_digest(&f.marker).unwrap().unwrap(), derive_scope(id.as_bytes()).digest());
        }
    }

    #[test]
    fn an_account_never_confirms_a_change_and_an_unknown_owner_is_never_taken() {
        let f = Fixture::new("who");
        let state = AccountScopeState::default();
        let account = derive_scope(b"00000000-0000-4000-8000-000000000001");
        let (_, owner) = f.profile();
        f.own(&owner);
        for change in ["return", "takeover"] {
            assert_eq!(confirm_owner_change_at(&state, change, &account, &f.marker, &f.profiles), Err(REFUSED));
        }
        // A local profile, but the owner is an account's: unknown.
        let (_, current) = f.profile();
        f.own(&derive_scope(b"00000000-0000-4000-8000-000000000002"));
        let before = tree(&f.home);
        for change in ["return", "takeover"] {
            assert_eq!(confirm_owner_change_at(&state, change, &current, &f.marker, &f.profiles), Err(REFUSED));
        }
        assert_eq!(confirm_owner_change_at(&state, "anything", &current, &f.marker, &f.profiles), Err(REFUSED));
        assert!(state.owner_change.lock().unwrap().is_none());
        assert_eq!(tree(&f.home), before);
    }

    #[test]
    fn the_confirmation_is_spent_once_for_one_change_one_scope_and_a_short_time() {
        let f = Fixture::new("token");
        let state = AccountScopeState::default();
        let (_, owner) = f.profile();
        let (_, current) = f.profile();
        let (_, other) = f.profile();
        f.own(&owner);

        let token = confirm_owner_change_at(&state, "takeover", &current, &f.marker, &f.profiles).unwrap();
        assert_eq!(token.len(), 64);
        // A wrong token spends the confirmation too: the right one finds nothing.
        assert_eq!(spend_owner_change(&state, "nope", OwnerChange::TakeOver, &current).err(), Some(REFUSED));
        assert_eq!(spend_owner_change(&state, &token, OwnerChange::TakeOver, &current).err(), Some(REFUSED));

        let token = confirm_owner_change_at(&state, "takeover", &current, &f.marker, &f.profiles).unwrap();
        assert!(spend_owner_change(&state, &token, OwnerChange::TakeOver, &current).is_ok());
        assert_eq!(spend_owner_change(&state, &token, OwnerChange::TakeOver, &current).err(), Some(REFUSED));

        // Another change, another scope.
        let token = confirm_owner_change_at(&state, "takeover", &current, &f.marker, &f.profiles).unwrap();
        assert_eq!(spend_owner_change(&state, &token, OwnerChange::Return, &current).err(), Some(REFUSED));
        let token = confirm_owner_change_at(&state, "takeover", &current, &f.marker, &f.profiles).unwrap();
        assert_eq!(spend_owner_change(&state, &token, OwnerChange::TakeOver, &other).err(), Some(REFUSED));

        // Too old.
        let token = confirm_owner_change_at(&state, "return", &current, &f.marker, &f.profiles).unwrap();
        state.owner_change.lock().unwrap().as_mut().unwrap().issued =
            Instant::now().checked_sub(OWNER_CHANGE_TTL + Duration::from_secs(1)).unwrap();
        assert_eq!(spend_owner_change(&state, &token, OwnerChange::Return, &current).err(), Some(REFUSED));
    }

    #[test]
    fn taking_over_changes_only_the_marker_and_a_second_click_writes_nothing() {
        let f = Fixture::new("take");
        let state = AccountScopeState::default();
        let (_, owner) = f.profile();
        let (_, current) = f.profile();
        f.own(&owner);
        fs::write(f.home.join("jht.config.json"), "{\"active_provider\":\"claude\"}\n").unwrap();
        fs::create_dir_all(f.home.join(".claude")).unwrap();
        fs::write(f.home.join(".claude/.credentials.json"), "secret\n").unwrap();
        let before = tree(&f.home);

        let token = confirm_owner_change_at(&state, "takeover", &current, &f.marker, &f.profiles).unwrap();
        take_over_with_token_at(&state, &token, &current, &f.marker, &f.profiles).unwrap();
        assert_eq!(f.marker_text(), format!("{}\n", current.digest()));
        let mut after = tree(&f.home);
        let new_marker = after.remove(".desktop-account-scope").unwrap();
        let mut old = before.clone();
        let old_marker = old.remove(".desktop-account-scope").unwrap();
        assert_eq!(after, old, "nothing but the marker changed, and no leftover");
        assert_ne!(new_marker, old_marker);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&f.marker).unwrap().permissions().mode() & 0o777, 0o600);
        }
        validate_or_claim_local_owner(&f.home, &current).unwrap();
        assert_eq!(validate_or_claim_local_owner(&f.home, &owner), Err("local_account_owner_mismatch"));

        // The same token again (a double click) writes nothing: the owner is the current profile now,
        // and the confirmation is gone anyway.
        let marker_after = tree(&f.home);
        assert_eq!(take_over_with_token_at(&state, &token, &current, &f.marker, &f.profiles), Err(REFUSED));
        assert_eq!(tree(&f.home), marker_after);
        // And a confirmation for the old owner is no more: the owner is not another profile.
        assert_eq!(confirm_owner_change_at(&state, "takeover", &current, &f.marker, &f.profiles), Err(REFUSED));
    }

    #[test]
    fn a_marker_that_changed_after_the_probe_is_left_as_it_is() {
        let f = Fixture::new("cas");
        let (_, owner) = f.profile();
        let (_, current) = f.profile();
        let (_, third) = f.profile();
        f.own(&third);
        let before = tree(&f.home);
        // The probe saw `owner`; the marker now says `third`.
        assert_eq!(take_over_marker_at(&f.home, owner.digest(), &current), Err(REFUSED));
        assert_eq!(tree(&f.home), before, "the marker is untouched and no temporary file is left");
        // A marker that vanished.
        fs::remove_file(&f.marker).unwrap();
        assert_eq!(take_over_marker_at(&f.home, owner.digest(), &current), Err(REFUSED));
        assert!(!f.marker.exists());
        assert!(!f.home.join(TAKE_OVER_TEMP).exists());
    }

    #[test]
    fn a_leftover_of_the_takeover_is_swept_by_its_own_name_only() {
        let f = Fixture::new("sweep");
        let (_, owner) = f.profile();
        let (_, current) = f.profile();
        f.own(&owner);
        fs::write(f.home.join(TAKE_OVER_TEMP), "old\n").unwrap();
        fs::write(f.home.join(".desktop-account-scope.tmp-other"), "not ours\n").unwrap();
        take_over_marker_at(&f.home, owner.digest(), &current).unwrap();
        assert!(!f.home.join(TAKE_OVER_TEMP).exists());
        assert_eq!(fs::read_to_string(f.home.join(".desktop-account-scope.tmp-other")).unwrap(), "not ours\n");
        assert_eq!(f.marker_text(), format!("{}\n", current.digest()));
        // A folder under the temporary name is not ours to remove.
        fs::remove_file(&f.marker).unwrap();
        f.own(&owner);
        fs::create_dir(f.home.join(TAKE_OVER_TEMP)).unwrap();
        assert_eq!(take_over_marker_at(&f.home, owner.digest(), &current), Err("local_owner_change_failed"));
        assert_eq!(f.marker_text(), format!("{}\n", owner.digest()));
    }

    #[cfg(unix)]
    #[test]
    fn a_home_that_is_a_link_is_not_written() {
        use std::os::unix::fs::symlink;
        let f = Fixture::new("home-link");
        let (_, owner) = f.profile();
        let (_, current) = f.profile();
        f.own(&owner);
        let linked = f.root.join("linked");
        symlink(&f.home, &linked).unwrap();
        let before = tree(&f.home);
        assert_eq!(take_over_marker_at(&linked, owner.digest(), &current), Err("local_owner_change_failed"));
        assert_eq!(tree(&f.home), before);
    }

    #[test]
    fn going_back_names_the_owner_the_person_confirmed() {
        let f = Fixture::new("return");
        let state = AccountScopeState::default();
        let (owner_id, owner) = f.profile();
        let (_, current) = f.profile();
        f.own(&owner);
        let token = confirm_owner_change_at(&state, "return", &current, &f.marker, &f.profiles).unwrap();
        // The owner changed after the confirmation: the token no longer fits.
        let (_, third) = f.profile();
        f.own(&third);
        assert_eq!(
            resolve_owner_change_at(&state, &token, OwnerChange::Return, &current, &f.marker, &f.profiles).err(),
            Some(REFUSED)
        );
        f.own(&owner);
        let token = confirm_owner_change_at(&state, "return", &current, &f.marker, &f.profiles).unwrap();
        let (id, scope) =
            resolve_owner_change_at(&state, &token, OwnerChange::Return, &current, &f.marker, &f.profiles).unwrap();
        assert_eq!((id, scope), (owner_id, owner));
    }
}

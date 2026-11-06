use super::*;

/// The full connection of an existing team ("Conferma e collega") in this run of the app: the
/// connection key of the one team the person confirmed. Only the native side of that command
/// sets it, and only when it succeeds. What writes to the team (the chat, the agent controls) is
/// allowed only to a team that holds it: the read-only view activates a target too, and never
/// holds it. It lives in memory: an app run starts without it, so after a restart it fails closed, and
/// the one way back without a new confirmation is `restore_full_link_at`, which the start-up reopening
/// calls after every check passed, from the record of the person's own confirmation (30 days at most,
/// this very candidate; see below). The commands that read it must refuse any window but `main` first.
pub(super) static FULL_LINK: Mutex<Option<String>> = Mutex::new(None);

pub(crate) fn grant_full_link(scope: &AccountScope, target: &ActivatedTarget) {
    if let Ok(mut slot) = FULL_LINK.lock() {
        *slot = Some(connection_key(scope, target));
    }
}

pub(crate) fn full_link_granted(scope: &AccountScope, target: &ActivatedTarget) -> bool {
    FULL_LINK
        .lock()
        .map(|slot| slot.as_deref() == Some(connection_key(scope, target).as_str()))
        .unwrap_or(false)
}

pub(crate) fn revoke_full_link() {
    if let Ok(mut slot) = FULL_LINK.lock() {
        *slot = None;
    }
}

// ---- the full connection kept across a restart

/// The record of a full connection the person confirmed, next to the candidate and the selection.
/// Exact keys: the connection key (account and the bytes of the saved candidate, so another candidate
/// is another key) and when it was given. Nothing else is in it, no host, no fingerprint, no secret.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct FullLinkMark {
    pub(super) schema: u8,
    pub(super) connection_key: String,
    pub(super) granted_at: u64,
}

pub(super) const FULL_LINK_FILE: &str = "existing-team-runtime-full-link.json";
/// A permission given longer ago than this is not kept: the person is asked again.
pub(crate) const FULL_LINK_MAX_AGE_S: u64 = 30 * 24 * 60 * 60;
pub(super) const FULL_LINK_MAX_BYTES: usize = 1024;

/// What the reopening at start-up did with the record: the closed words the log writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FullLinkRestore {
    Restored,
    NotRestored,
    Expired,
    Discarded,
}

impl FullLinkRestore {
    pub(crate) fn word(self) -> &'static str {
        match self {
            Self::Restored => "restored",
            Self::NotRestored => "not_restored",
            Self::Expired => "expired",
            Self::Discarded => "discarded",
        }
    }
}

/// What `forget_full_link_at` had to do. Both leave a record that can never bring the permission back.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FullLinkForgotten {
    Removed,
    /// The file could not be removed and was made unreadable as a record (overwritten or renamed).
    Neutralized,
}

pub(crate) fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs()).unwrap_or(0)
}

/// Temporary files of an interrupted write of the record (the process died between creating one and the
/// rename): harmless, swept at the next write and at every start-up reopening. Only names this module gives them.
pub(super) fn sweep_full_link_leftovers(root: &Path, scope: &AccountScope) {
    let Ok(entries) = fs::read_dir(account_dir(root, scope)) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if name.to_string_lossy().starts_with("existing-team-runtime-full-link.tmp-") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Writes the record of the full connection that was just granted: a private temporary file and a
/// rename, so a reader sees the whole record or none. Where mode 0600 means nothing (not Unix) there
/// is no record and the permission stays what it always was, for this run of the app only.
#[cfg(unix)]
pub(crate) fn remember_full_link_at(
    root: &Path,
    scope: &AccountScope,
    target: &ActivatedTarget,
    now: u64,
) -> Result<(), &'static str> {
    let unavailable = "existing_team_runtime_unavailable";
    let parent = account_dir(root, scope);
    let parent_meta = fs::symlink_metadata(&parent).map_err(|_| unavailable)?;
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if parent_meta.file_type().is_symlink()
            || !parent_meta.is_dir()
            || parent_meta.uid() != unsafe { libc::geteuid() }
            || parent_meta.permissions().mode() & 0o022 != 0
        {
            return Err(unavailable);
        }
    }
    // Only in a folder that passed the checks above: a link or a folder that is not ours is never swept.
    sweep_full_link_leftovers(root, scope);
    let payload = serde_json::to_vec(&FullLinkMark {
        schema: 1,
        connection_key: connection_key(scope, target),
        granted_at: now,
    })
    .map_err(|_| unavailable)?;
    let destination = path(root, scope, FULL_LINK_FILE);
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| unavailable)?.as_nanos();
    let temporary = destination.with_extension(format!("tmp-{}-{nonce}", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|_| unavailable)?;
    let written = (|| {
        set_private_permissions(&temporary).map_err(|_| unavailable)?;
        file.write_all(&payload).map_err(|_| unavailable)?;
        file.sync_all().map_err(|_| unavailable)?;
        drop(file);
        fs::rename(&temporary, &destination).map_err(|_| unavailable)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    written
}

#[cfg(not(unix))]
pub(crate) fn remember_full_link_at(
    _root: &Path,
    _scope: &AccountScope,
    _target: &ActivatedTarget,
    _now: u64,
) -> Result<(), &'static str> {
    Ok(())
}

/// Takes the record away. A file that cannot be removed is made unreadable as a record, so the next
/// start cannot give back a permission the person took away; only when neither works is it an error
/// (`existing_team_full_link_not_removed`), and the caller shows it.
pub(crate) fn forget_full_link_at(root: &Path, scope: &AccountScope) -> Result<FullLinkForgotten, &'static str> {
    let file = path(root, scope, FULL_LINK_FILE);
    match fs::remove_file(&file) {
        Ok(()) => return Ok(FullLinkForgotten::Removed),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(FullLinkForgotten::Removed),
        Err(_) => {}
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let overwritten = OpenOptions::new()
            .write(true)
            .truncate(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&file)
            .and_then(|mut handle| handle.write_all(b"x").and_then(|_| handle.sync_all()))
            .is_ok();
        if overwritten {
            return Ok(FullLinkForgotten::Neutralized);
        }
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_nanos()).unwrap_or(0);
        if fs::rename(&file, file.with_extension(format!("discarded-{nonce}"))).is_ok() {
            return Ok(FullLinkForgotten::Neutralized);
        }
    }
    Err("existing_team_full_link_not_removed")
}

/// A record that can be believed, read from the descriptor itself: not a link, a regular file, ours,
/// private (0600), one name, at most 1 KiB, and the exact keys. `Ok(None)` is no file at all.
#[cfg(unix)]
pub(super) fn read_full_link_mark(file: &Path) -> Result<Option<FullLinkMark>, ()> {
    use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
    let mut handle = match OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(file)
    {
        Ok(handle) => handle,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    let meta = handle.metadata().map_err(|_| ())?;
    if !meta.file_type().is_file()
        || meta.uid() != unsafe { libc::geteuid() }
        || meta.permissions().mode() & 0o777 != 0o600
        || meta.nlink() != 1
        || meta.len() == 0
        || meta.len() > FULL_LINK_MAX_BYTES as u64
    {
        return Err(());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut handle)
        .take((FULL_LINK_MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.len() > FULL_LINK_MAX_BYTES {
        return Err(());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| ())?;
    let mark: FullLinkMark = serde_json::from_value(value.clone()).map_err(|_| ())?;
    if value != serde_json::to_value(&mark).map_err(|_| ())? || mark.schema != 1 || !hex(&mark.connection_key, 64) {
        return Err(());
    }
    Ok(Some(mark))
}

/// At the end of a reopening that PASSED every check (the pin, the identity probe, the selection that
/// is the saved candidate), gives the full connection back, and only through `grant_full_link`, when
/// the record says this very connection (account and candidate bytes) and is not older than
/// `FULL_LINK_MAX_AGE_S`. A record that is too old, from the future (the clock went back), of another
/// candidate, or not believable is removed and the view stays read-only; no record is read-only too.
#[cfg(unix)]
pub(crate) fn restore_full_link_at(
    root: &Path,
    scope: &AccountScope,
    target: &ActivatedTarget,
    now: u64,
) -> FullLinkRestore {
    sweep_full_link_leftovers(root, scope);
    let file = path(root, scope, FULL_LINK_FILE);
    let mark = match read_full_link_mark(&file) {
        Ok(None) => return FullLinkRestore::NotRestored,
        Ok(Some(mark)) => mark,
        Err(()) => {
            let _ = forget_full_link_at(root, scope);
            return FullLinkRestore::Discarded;
        }
    };
    if mark.granted_at > now || now - mark.granted_at > FULL_LINK_MAX_AGE_S {
        let _ = forget_full_link_at(root, scope);
        return FullLinkRestore::Expired;
    }
    if mark.connection_key != connection_key(scope, target) {
        let _ = forget_full_link_at(root, scope);
        return FullLinkRestore::Discarded;
    }
    grant_full_link(scope, target);
    FullLinkRestore::Restored
}

#[cfg(not(unix))]
pub(crate) fn restore_full_link_at(
    _root: &Path,
    _scope: &AccountScope,
    _target: &ActivatedTarget,
    _now: u64,
) -> FullLinkRestore {
    FullLinkRestore::NotRestored
}

/// The tests that grant or revoke share the one static of the process: cargo runs tests in parallel.
#[cfg(test)]
pub(crate) static FULL_LINK_TEST_LOCK: Mutex<()> = Mutex::new(());

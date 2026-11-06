use super::*;

/// What the app's own provisioning of a VPS writes, privately, once the host is set up and its key
/// pinned: the account, the host (address and port) and the fingerprint of the host key it is
/// bound to. It is the positive mark of «a VPS of the person's own»; the absence of other files
/// is not (JHT-T30). Never returned by a command, never read from the renderer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct OwnVpsMarker {
    pub(super) schema: u8,
    pub(super) scope: String,
    pub(super) address: String,
    pub(super) port: u16,
    pub(super) host_key: String,
}

pub(super) fn own_vps_marker_valid(marker: &OwnVpsMarker) -> bool {
    let key = marker.host_key.as_bytes();
    marker.schema == 1
        && !marker.scope.is_empty()
        && marker.scope.len() <= 128
        && !marker.address.is_empty()
        && marker.address.len() <= 255
        && marker.address == marker.address.trim()
        && marker.port != 0
        && marker.host_key.starts_with("SHA256:")
        && key.len() <= 128
        && key.iter().all(|byte| byte.is_ascii_graphic())
}

/// The marker this scope has, if there is one and it is well formed: a private file of the account,
/// canonical, of this account, and nothing else.
pub(super) fn read_own_vps_marker_at(root: &Path, scope: &AccountScope) -> Option<OwnVpsMarker> {
    let bytes = read_bytes(
        &path(root, scope, OWN_VPS_FILE),
        "existing_team_runtime_own_vps_missing",
        "existing_team_runtime_own_vps_invalid",
    )
    .ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let marker: OwnVpsMarker = serde_json::from_value(value.clone()).ok()?;
    (serde_json::to_value(&marker).ok()? == value && own_vps_marker_valid(&marker) && marker.scope == scope.digest())
        .then_some(marker)
}

/// Writes the marker for the VPS the app has just set up and pinned. Only the provisioning calls it,
/// after the host's key is confirmed: `host_key` is the fingerprint of that pinned key. It replaces the
/// marker of an earlier host of the same account.
pub(crate) fn mark_own_vps_at(
    root: &Path,
    scope: &AccountScope,
    address: &str,
    port: u16,
    host_key: &str,
) -> Result<(), &'static str> {
    let marker = OwnVpsMarker {
        schema: 1,
        scope: scope.digest().to_owned(),
        address: address.trim().to_owned(),
        port,
        host_key: host_key.to_owned(),
    };
    if !own_vps_marker_valid(&marker) {
        return Err("existing_team_runtime_own_vps_invalid");
    }
    let bytes = serde_json::to_vec(&marker).map_err(|_| "existing_team_runtime_unavailable")?;
    let destination = path(root, scope, OWN_VPS_FILE);
    let parent = destination.parent().ok_or("existing_team_runtime_unavailable")?;
    fs::create_dir_all(parent).map_err(|_| "existing_team_runtime_unavailable")?;
    if fs::symlink_metadata(parent).map_err(|_| "existing_team_runtime_unavailable")?.file_type().is_symlink() {
        return Err("existing_team_runtime_unavailable");
    }
    set_private_dir_permissions(parent).map_err(|_| "existing_team_runtime_unavailable")?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "existing_team_runtime_unavailable")?
        .as_nanos();
    let temporary = destination.with_extension(format!("tmp-{}-{nonce}", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|_| "existing_team_runtime_unavailable")?;
    let written = (|| {
        set_private_permissions(&temporary).map_err(|_| "existing_team_runtime_unavailable")?;
        file.write_all(&bytes).map_err(|_| "existing_team_runtime_unavailable")?;
        file.sync_all().map_err(|_| "existing_team_runtime_unavailable")?;
        drop(file);
        fs::rename(&temporary, &destination).map_err(|_| "existing_team_runtime_unavailable")
    })();
    if written.is_err() {
        let _ = fs::remove_file(&temporary);
        return written;
    }
    if read_own_vps_marker_at(root, scope).as_ref() != Some(&marker) {
        return Err("existing_team_runtime_unavailable");
    }
    Ok(())
}

pub(crate) fn mark_own_vps(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    address: &str,
    port: u16,
    host_key: &str,
) -> Result<(), &'static str> {
    mark_own_vps_at(&root(app)?, scope, address, port, host_key)
}

/// Where a VPS of the person's own stands (JHT-T30). The reads and the writes do not ask the same:
///
/// - `Marked`: the app's own provisioning wrote the mark for this host, and the host key pinned NOW is
///   the marked one. The full connection: reads and writes.
/// - `Claimable`: no existing team in the account and no mark for this host: a VPS the app set up before
///   the mark existed (or the mark is of another host). Reads yes; writes only after the person claims it.
/// - `KeyChanged`: the mark is for this host and port, but the key pinned now is another: the VPS was
///   reinstalled or replaced. Reads yes; writes need a new claim, and the message says so.
/// - `NotOwn`: an existing team's candidate or selection in the account, this computer, or no pin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OwnVpsState {
    Marked,
    Claimable,
    KeyChanged,
    NotOwn,
}

impl OwnVpsState {
    /// The word the page reads.
    pub(crate) fn word(self) -> &'static str {
        match self {
            OwnVpsState::Marked => "marked",
            OwnVpsState::Claimable => "claimable",
            OwnVpsState::KeyChanged => "key_changed",
            OwnVpsState::NotOwn => "not_own",
        }
    }

    /// Why a write is refused here, or none when it may go: the codes the page turns into the
    /// invitation to claim the VPS. An existing team has its own rule (the full link), not this one.
    pub(crate) fn write_refusal(self) -> Option<&'static str> {
        match self {
            OwnVpsState::Marked => None,
            OwnVpsState::Claimable => Some("own_vps_claim_required"),
            OwnVpsState::KeyChanged => Some("own_vps_key_changed"),
            OwnVpsState::NotOwn => Some("own_vps_claim_refused"),
        }
    }
}

/// The state of the VPS `host` for this account, from the saved files and the key pinned now
/// (`pinned_key`, read from the local pin by the caller). Read from the files, never from what the
/// renderer says. An existing team's candidate or selection in the account always wins: it is that
/// team's rule, never an own VPS, mark or no mark.
pub(crate) fn own_vps_state_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    pinned_key: Option<&str>,
) -> OwnVpsState {
    let (ExecutionHost::Vps { address, port, .. }, Some(pinned_key)) = (host, pinned_key) else {
        return OwnVpsState::NotOwn;
    };
    if !matches!(saved_binding_at(root, scope), Ok((false, false))) {
        return OwnVpsState::NotOwn;
    }
    match read_own_vps_marker_at(root, scope) {
        Some(marker) if marker.address == address.trim() && marker.port == *port => {
            if marker.host_key == pinned_key {
                OwnVpsState::Marked
            } else {
                OwnVpsState::KeyChanged
            }
        }
        _ => OwnVpsState::Claimable,
    }
}

/// WRITES to a VPS of the person's own (the panel's actions, the chat's messages, the judgements):
/// only with the mark. «The scope has no candidate and no selection» is not a permission to write.
pub(crate) fn own_vps_for_writes_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    pinned_key: Option<&str>,
) -> bool {
    own_vps_state_at(root, scope, host, pinned_key) == OwnVpsState::Marked
}

/// READS of a VPS the app set up (positions, agents, the setup's snapshot): the mark, or what held
/// before the mark existed, a scope with no candidate and no selection (only the existing-team
/// commands write them). A VPS the app set up before the mark must not go back to being unreadable;
/// what it cannot do without the mark is write. A read exposes the person's own data to the person.
pub(crate) fn own_vps_for_reads_at(root: &Path, scope: &AccountScope) -> bool {
    matches!(saved_binding_at(root, scope), Ok((false, false)))
}

/// The person says that this VPS was set up by them with the app (JHT-T30). Writes the mark, and only
/// when all of it holds: the VPS is a host with a pinned key, the account has no existing team (a
/// read-only view or a connection to one always has its candidate or selection), the VPS answers as
/// the team of this account (`identity_matches`, from the identity probe), and the person confirmed. Atomic
/// (the mark is written once, after the checks); a refusal leaves no file.
pub(crate) fn claim_own_vps_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    pinned_key: Option<&str>,
    identity_matches: bool,
) -> Result<(), &'static str> {
    let ExecutionHost::Vps { address, port, .. } = host else {
        return Err("own_vps_claim_refused");
    };
    match own_vps_state_at(root, scope, host, pinned_key) {
        OwnVpsState::Marked => return Ok(()),
        OwnVpsState::Claimable | OwnVpsState::KeyChanged => {}
        OwnVpsState::NotOwn => return Err("own_vps_claim_refused"),
    }
    if !identity_matches {
        return Err("own_vps_claim_refused");
    }
    let key = pinned_key.ok_or("own_vps_claim_refused")?;
    mark_own_vps_at(root, scope, address, *port, key).map_err(|_| "own_vps_claim_refused")
}


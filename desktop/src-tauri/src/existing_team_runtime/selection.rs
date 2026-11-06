use super::*;

pub(super) fn selection_may_be_absent(
    host: &ExecutionHost,
    candidate_exists: bool,
) -> Result<(), &'static str> {
    if candidate_exists || matches!(host, ExecutionHost::Vps { .. }) {
        Err("existing_team_runtime_selection_required")
    } else {
        Ok(())
    }
}

pub(super) fn write_selection_at(
    root: &Path,
    scope: &AccountScope,
    candidate: &Candidate,
    hash: &str,
) -> Result<(), &'static str> {
    let parent = account_dir(root, scope);
    fs::create_dir_all(&parent).map_err(|_| "existing_team_runtime_unavailable")?;
    set_private_dir_permissions(&parent).map_err(|_| "existing_team_runtime_unavailable")?;
    let destination = path(root, scope, SELECTION_FILE);
    if fs::symlink_metadata(&destination).is_ok() {
        return Err("existing_team_runtime_already_selected");
    }
    let payload = serde_json::to_vec(&Selection {
        schema: 1,
        host: candidate.host.clone(),
        team_id: candidate.team_id.clone(),
        candidate_sha256: hash.to_owned(),
    })
    .map_err(|_| "existing_team_runtime_unavailable")?;
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
    let mut file = options
        .open(&temporary)
        .map_err(|_| "existing_team_runtime_unavailable")?;
    let result = (|| {
        set_private_permissions(&temporary).map_err(|_| "existing_team_runtime_unavailable")?;
        file.write_all(&payload)
            .map_err(|_| "existing_team_runtime_unavailable")?;
        file.sync_all()
            .map_err(|_| "existing_team_runtime_unavailable")?;
        drop(file);
        fs::rename(&temporary, &destination).map_err(|_| "existing_team_runtime_unavailable")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}
/// Called only after the exact host/team identity and both required sessions
/// have passed the read-only remote probe.
pub(crate) fn activate(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
    probed: &ActivatedTarget,
) -> Result<(), &'static str> {
    activate_at(&root(app)?, scope, host, probed)
}

pub(crate) fn activate_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    probed: &ActivatedTarget,
) -> Result<(), &'static str> {
    let (candidate, hash) = read_candidate_at(root, scope)?;
    if !candidate_matches_probed(&candidate, &hash, host, probed) {
        return Err("existing_team_runtime_candidate_mismatch");
    }
    write_selection_at(root, scope, &candidate, &hash)
}

/// The full connection («Confirm and connect») of a team this profile may have selected already:
/// opening the same team read only saves the selection first. The same target is kept as it is;
/// a selection of another one is `existing_team_runtime_target_changed`, never replaced.
pub(crate) fn activate_or_keep(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
    probed: &ActivatedTarget,
) -> Result<(), &'static str> {
    activate_or_keep_at(&root(app)?, scope, host, probed)
}

pub(crate) fn activate_or_keep_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    probed: &ActivatedTarget,
) -> Result<(), &'static str> {
    match activate_at(root, scope, host, probed) {
        Err("existing_team_runtime_already_selected") => match selected_at(root, scope, host)? {
            Some(selected) if selected == *probed => Ok(()),
            _ => Err("existing_team_runtime_target_changed"),
        },
        other => other,
    }
}

/// The one parser of a selection's bytes, for `selected_at` and the
/// registration gate alike: canonical JSON, schema 1, a valid team id and the
/// SHA-256 of a candidate.
pub(super) fn parse_selection_bytes(bytes: &[u8]) -> Result<SavedSelection, &'static str> {
    let invalid = "existing_team_runtime_selection_invalid";
    let value: serde_json::Value = serde_json::from_slice(bytes).map_err(|_| invalid)?;
    let selection: Selection = serde_json::from_value(value.clone()).map_err(|_| invalid)?;
    if value != serde_json::to_value(&selection).map_err(|_| invalid)?
        || selection.schema != 1
        || !team_id(&selection.team_id)
        || !hex(&selection.candidate_sha256, 64)
    {
        return Err(invalid);
    }
    Ok(SavedSelection {
        host: selection.host,
        team_id: selection.team_id,
        candidate_sha256: selection.candidate_sha256,
    })
}

pub(super) fn read_selection_at(root: &Path, scope: &AccountScope) -> Result<SavedSelection, &'static str> {
    let bytes = read_bytes(
        &path(root, scope, SELECTION_FILE),
        "existing_team_runtime_selection_invalid",
        "existing_team_runtime_selection_invalid",
    )?;
    parse_selection_bytes(&bytes)
}

/// A local connection without a selection preserves the existing local path.
/// Every VPS operation requires a selection; once present, it must see the
/// same candidate bytes, host and team or fail closed.
pub(crate) fn selected(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<Option<ActivatedTarget>, &'static str> {
    selected_at(&root(app)?, scope, host)
}

/// The pinned target of an existing team, or `None` for a VPS the person made with the app: it has
/// no existing-team selection to find (`selected` refuses a VPS without one), it is theirs and
/// connected, and it is reached through the host's wrapper. For READING it is theirs when the scope
/// has no candidate and no selection (`own_vps_for_reads_at`, read from the files, never from the
/// renderer): a half-saved existing team stays the refusal it is. WRITING needs more, the mark the
/// app's own setup writes (`own_vps_for_writes_at`), and the page offers to claim a VPS that has none. Every reader of a VPS team goes through here.
pub(crate) fn selected_or_own(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<Option<ActivatedTarget>, &'static str> {
    selected_or_own_at(&root(app)?, scope, host)
}

/// The fingerprint of the host key the person confirmed for this host, read from the local pin; none
/// when the host does not validate or has no pin (and then no write to an own VPS goes).
pub(crate) fn pinned_key_for(app: &tauri::AppHandle, scope: &AccountScope, host: &ExecutionHost) -> Option<String> {
    let validated = crate::runtime_host::validate_host_for_scope(app, host, scope).ok()?;
    crate::runtime_host::pinned_host_fingerprint(&validated).ok()
}

pub(crate) fn selected_or_own_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<Option<ActivatedTarget>, &'static str> {
    match selected_at(root, scope, host) {
        Err("existing_team_runtime_selection_required") if own_vps_for_reads_at(root, scope) => Ok(None),
        other => other,
    }
}

pub(crate) fn selected_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<Option<ActivatedTarget>, &'static str> {
    let selection_path = path(root, scope, SELECTION_FILE);
    if let Err(error) = fs::symlink_metadata(&selection_path) {
        return if error.kind() == std::io::ErrorKind::NotFound {
            let candidate_exists = match fs::symlink_metadata(path(root, scope, CANDIDATE_FILE)) {
                Ok(_) => true,
                Err(candidate_error) if candidate_error.kind() == std::io::ErrorKind::NotFound => {
                    false
                }
                Err(_) => return Err("existing_team_runtime_candidate_invalid"),
            };
            selection_may_be_absent(host, candidate_exists)?;
            Ok(None)
        } else {
            Err("existing_team_runtime_selection_invalid")
        };
    }
    let selection = read_selection_at(root, scope)?;
    let (candidate, hash) = read_candidate_at(root, scope)?;
    if selection.host != *host
        || candidate.host != *host
        || selection.team_id != candidate.team_id
        || selection.candidate_sha256 != hash
    {
        return Err("existing_team_runtime_target_changed");
    }
    Ok(Some(ActivatedTarget {
        team_id: candidate.team_id,
        runtime: candidate.runtime,
        candidate_sha256: hash,
    }))
}

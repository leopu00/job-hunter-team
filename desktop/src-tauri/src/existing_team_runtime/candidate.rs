use super::*;

/// Validates candidate bytes in memory: the same rules `read_candidate_at`
/// applies on every read, so a writer can check what it is about to publish.
pub(crate) fn parse_candidate_bytes(bytes: &[u8]) -> Result<Candidate, &'static str> {
    let value: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|_| "existing_team_runtime_candidate_invalid")?;
    let candidate: Candidate = serde_json::from_value(value.clone())
        .map_err(|_| "existing_team_runtime_candidate_invalid")?;
    if value
        != serde_json::to_value(&candidate)
            .map_err(|_| "existing_team_runtime_candidate_invalid")?
        || candidate.schema != 1
        || !team_id(&candidate.team_id)
        || !valid_target(&candidate.runtime)
    {
        return Err("existing_team_runtime_candidate_invalid");
    }
    Ok(candidate)
}

pub(super) fn read_candidate_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(Candidate, String), &'static str> {
    let bytes = read_bytes(
        &path(root, scope, CANDIDATE_FILE),
        "existing_team_runtime_candidate_required",
        "existing_team_runtime_candidate_invalid",
    )?;
    let candidate = parse_candidate_bytes(&bytes)?;
    Ok((candidate, sha256(&bytes)))
}

/// Reads the producer-delivered candidate and binds it to the explicit
/// existing-team request. It does not activate or persist anything.
pub(crate) fn candidate_for_request(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
    team: &str,
) -> Result<ActivatedTarget, &'static str> {
    candidate_for_request_at(&root(app)?, scope, host, team)
}

pub(crate) fn candidate_for_request_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    team: &str,
) -> Result<ActivatedTarget, &'static str> {
    let (candidate, candidate_sha256) = read_candidate_at(root, scope)?;
    if candidate.host != *host || candidate.team_id != team {
        return Err("existing_team_runtime_candidate_mismatch");
    }
    Ok(ActivatedTarget {
        team_id: candidate.team_id,
        runtime: candidate.runtime,
        candidate_sha256,
    })
}

/// Whether this scope has a candidate and whether it has a selection (a file of
/// any kind counts, even an invalid one or a dangling symlink). Local only.
pub(crate) fn saved_binding_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(bool, bool), &'static str> {
    let present = |name: &str| match fs::symlink_metadata(path(root, scope, name)) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("existing_team_runtime_unavailable"),
    };
    Ok((present(CANDIDATE_FILE)?, present(SELECTION_FILE)?))
}

/// The host and team of the candidate this scope has, for the backend's own use
/// (reopening a saved team). It never leaves the backend: no command returns it.
pub(crate) fn candidate_identity_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(ExecutionHost, String), &'static str> {
    let (candidate, _) = read_candidate_at(root, scope)?;
    Ok((candidate.host, candidate.team_id))
}

/// Gets the custodial host only after binding it to the explicit team id.
/// The CLI companion never accepts a host, target or pin from stdin.
pub(crate) fn candidate_host_for_team(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    team: &str,
) -> Result<(ExecutionHost, ActivatedTarget), &'static str> {
    let (candidate, candidate_sha256) = read_candidate_at(&root(app)?, scope)?;
    if candidate.team_id != team {
        return Err("existing_team_runtime_candidate_mismatch");
    }
    let target = ActivatedTarget {
        team_id: candidate.team_id,
        runtime: candidate.runtime,
        candidate_sha256,
    };
    Ok((candidate.host, target))
}

pub(super) fn candidate_matches_probed(
    candidate: &Candidate,
    candidate_sha256: &str,
    host: &ExecutionHost,
    probed: &ActivatedTarget,
) -> bool {
    candidate.host == *host
        && candidate.team_id == probed.team_id
        && candidate.runtime == probed.runtime
        && candidate_sha256 == probed.candidate_sha256
}


/// What the in-app registration may do in this scope. Decided locally, before a
/// single SSH call, by ONE predicate that discover and register both use.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RegistrationGate {
    /// Neither a candidate nor a selection: a new candidate may be published.
    Fresh,
    /// A valid selection and no candidate: only the candidate whose bytes the
    /// selection attests may be published back. The selection is never written.
    Restore(SavedSelection),
}

/// A candidate of ANY kind (invalid, a symlink, even a dangling one) means the
/// existing path owns this scope. So does a selection that is not a valid
/// private one: only a valid selection without its candidate can be restored.
pub(crate) fn registration_gate_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<RegistrationGate, &'static str> {
    match fs::symlink_metadata(path(root, scope, CANDIDATE_FILE)) {
        Ok(_) => return Err("existing_team_runtime_candidate_exists"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("existing_team_runtime_unavailable"),
    }
    match fs::symlink_metadata(path(root, scope, SELECTION_FILE)) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RegistrationGate::Fresh)
        }
        Err(_) => return Err("existing_team_runtime_unavailable"),
    }
    // One read, with the rules of `selected_at` (O_NOFOLLOW, private, canonical).
    read_selection_at(root, scope)
        .map(RegistrationGate::Restore)
        .map_err(|_| "existing_team_runtime_already_selected")
}

/// The exact bytes of a candidate for this host, team and verified runtime and
/// their SHA-256, validated in memory by the same rules every read applies.
pub(crate) fn candidate_bytes(
    host: &ExecutionHost,
    team: &str,
    runtime: &RuntimeTarget,
) -> Result<(Vec<u8>, String), &'static str> {
    let candidate = Candidate {
        schema: 1,
        host: host.clone(),
        team_id: team.to_owned(),
        runtime: runtime.clone(),
    };
    let bytes =
        serde_json::to_vec(&candidate).map_err(|_| "existing_team_runtime_candidate_invalid")?;
    // Every read refuses more than MAX_BYTES: never publish what could not be read back.
    if bytes.len() > MAX_BYTES || parse_candidate_bytes(&bytes)? != candidate {
        return Err("existing_team_runtime_candidate_invalid");
    }
    let hash = sha256(&bytes);
    Ok((bytes, hash))
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CandidateWrite {
    Written,
    /// The definitive file appeared first with exactly these bytes (a second
    /// registration that raced this one).
    Identical,
}

/// Publishes a candidate without ever replacing one. The bytes are validated in
/// memory and again on the private temporary file BEFORE `hard_link` makes them
/// definitive and immutable; the link fails if the definitive file exists, and
/// there is no fallback to `rename`, which would overwrite. It never creates
/// the account directory: the confirmed SSH pin already lives inside it.
pub(crate) fn write_candidate_at(
    root: &Path,
    scope: &AccountScope,
    bytes: &[u8],
) -> Result<CandidateWrite, &'static str> {
    write_candidate_hooked(root, scope, bytes, &mut || {})
}

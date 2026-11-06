use super::*;

/// «Forget the team» for an account: the existing-team candidate and selection, and the own-VPS mark.
/// After it nothing in the scope says a team is connected, and no VPS is the person's own until the
/// app provisions one again. Missing files are fine; any other failure is reported, and the rest are
/// still tried.
#[allow(dead_code)] // the command that forgets a team calls it; the guarantee is tested here
pub(crate) fn forget_team_at(root: &Path, scope: &AccountScope) -> Result<(), &'static str> {
    let mut outcome = Ok(());
    for name in [CANDIDATE_FILE, SELECTION_FILE, OWN_VPS_FILE] {
        match fs::remove_file(path(root, scope, name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => outcome = Err("existing_team_runtime_unavailable"),
        }
    }
    outcome
}

/// The saved pair that an updated team may replace: its runtime and the SHA-256 of the candidate's bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RebindBase {
    pub(crate) runtime: RuntimeTarget,
    pub(crate) candidate_sha256: String,
}

/// What a rebind starts from: a valid candidate for exactly this host (same user, port and key) and
/// this team, and a selection that is absent or attests exactly that candidate. Anything else, an
/// invalid file, another host or team, a selection of other bytes, is `None`: no rebind, and the
/// registration refuses as it always did.
pub(crate) fn rebind_base_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    team: &str,
) -> Option<RebindBase> {
    let (candidate, candidate_sha256) = read_candidate_at(root, scope).ok()?;
    if candidate.host != *host || candidate.team_id != team {
        return None;
    }
    match fs::symlink_metadata(path(root, scope, SELECTION_FILE)) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return None,
        Ok(_) => {
            let selection = read_selection_at(root, scope).ok()?;
            if selection.host != *host
                || selection.team_id != team
                || selection.candidate_sha256 != candidate_sha256
            {
                return None;
            }
        }
    }
    Some(RebindBase {
        runtime: candidate.runtime,
        candidate_sha256,
    })
}

/// The first half of a rebind: removes the selection and then the candidate, and only if the candidate
/// is still the very one the person was shown being replaced. The order matters: a stop in between
/// leaves a candidate without selection (rebindable again), never a selection without its candidate.
/// The new candidate is then written by the ordinary, never-replacing write.
pub(crate) fn clear_for_rebind_at(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    team: &str,
    expected_sha256: &str,
) -> Result<(), &'static str> {
    match rebind_base_at(root, scope, host, team) {
        Some(base) if base.candidate_sha256 == expected_sha256 => {}
        _ => return Err("existing_team_runtime_target_changed"),
    }
    // The permission to write goes first: a candidate that comes back byte for byte the same must not
    // find the old record still there.
    forget_full_link_at(root, scope)?;
    for name in [SELECTION_FILE, CANDIDATE_FILE] {
        match fs::remove_file(path(root, scope, name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("existing_team_runtime_unavailable"),
        }
    }
    Ok(())
}

/// Removes the account's persisted existing-team binding. The selection goes
/// first, so an interruption can only leave a candidate to be reconnected,
/// never a selection whose candidate has already gone away.
pub(crate) fn clear_link_at(root: &Path, scope: &AccountScope) -> Result<(), &'static str> {
    // The permission to write goes first (see `clear_for_rebind_at`); a record that cannot be taken away
    // is an error, and nothing else is removed.
    forget_full_link_at(root, scope)?;
    for name in [SELECTION_FILE, CANDIDATE_FILE] {
        match fs::remove_file(path(root, scope, name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("existing_team_runtime_unavailable"),
        }
    }
    Ok(())
}


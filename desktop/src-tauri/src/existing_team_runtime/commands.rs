use super::*;

/// Fixed read-only jobs-db bridge for the desktop adapter. The renderer sends
/// typed operation data only; it never supplies a host, container or SQL.
#[tauri::command]
pub(crate) async fn existing_team_positions_read(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    request: Value,
) -> Result<Value, String> {
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(positions_failure("account_scope_unavailable")),
    };
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(|_| "account_scope_changed")?;
        Ok(positions_read_for_scope(&app, &worker_expected, request))
    })
    .await
    .unwrap_or_else(|_| Err("positions_unavailable"));
    if scopes.lock_expected(&expected).is_err() {
        return Ok(positions_failure("account_scope_changed"));
    }
    Ok(result.unwrap_or_else(positions_failure))
}

/// Which team the desktop reads: the pinned revision and image digest of the
/// saved target, for the header. Local files only, no SSH; values valid_target
/// already checked (40 hex, `sha256:` + 64 hex).
pub(super) fn link_identity_for_scope(app: &tauri::AppHandle, scope: &AccountScope) -> Value {
    let host = match direct_chat::load_persisted_host(app, scope) {
        Ok(host) => host,
        Err(error) => return positions_failure(error),
    };
    match selected(app, scope, &host) {
        Ok(Some(target)) => json!({
            "ok": true,
            "revision": target.runtime.oci_revision,
            "digest": target.runtime.digest,
        }),
        Ok(None) => positions_failure("existing_team_runtime_required"),
        Err(error) => positions_failure(error),
    }
}

#[tauri::command]
pub(crate) async fn existing_team_link_identity(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<Value, String> {
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(positions_failure("account_scope_unavailable")),
    };
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(|_| "account_scope_changed")?;
        Ok(link_identity_for_scope(&app, &worker_expected))
    })
    .await
    .unwrap_or_else(|_| Err("existing_team_unavailable"));
    if scopes.lock_expected(&expected).is_err() {
        return Ok(positions_failure("account_scope_changed"));
    }
    Ok(result.unwrap_or_else(positions_failure))
}

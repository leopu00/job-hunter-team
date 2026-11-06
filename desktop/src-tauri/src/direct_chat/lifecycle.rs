use super::*;

pub(super) fn connect_impl(
    app: &tauri::AppHandle,
    scope: AccountScope,
    host: ExecutionHost,
) -> Result<Connection, DirectChatError> {
    let validated =
        crate::runtime_host::validate_host_for_scope(app, &host, &scope).map_err(failure)?;
    let runtime = if matches!(validated, ValidatedHost::Vps { .. }) {
        existing_team_runtime::selected_or_own(app, &scope, &host).map_err(failure)?
    } else {
        None
    };
    let link = vps_link_for(std::env::consts::OS);
    let (local_wrapper, local_runtime, local_owner_marker, control_path, tunnel) = match &validated
    {
        ValidatedHost::Local => (
            Some(crate::onboarding::verified_local_wrapper_path(app).map_err(failure)?),
            Some(local_runtime_dir(app)?),
            Some(crate::account_scope::local_owner_marker_path(app).map_err(failure)?),
            None,
            None,
        ),
        ValidatedHost::Vps { .. } => {
            let (path, child) = open_vps_link(&validated, link, |host| {
                run_ssh_command_without_pipes(host, VPS_LINK_CHECK, None, CONNECT_TIMEOUT)
            })?;
            (None, None, None, path, child)
        }
    };
    let mut connection = Connection {
        app: Some(app.clone()),
        scope: scope.clone(),
        host,
        validated,
        runtime,
        local_wrapper,
        local_runtime,
        local_owner_marker,
        control_path,
        tunnel,
        link,
    };
    let state = probe(&connection);
    if state.state != "ready" {
        close_connection(&mut connection);
        return Err(failure(state.code.unwrap_or("connect_failed")));
    }
    persist_host(app, &scope, &connection.host)?;
    Ok(connection)
}

/// What the app does right after connecting an existing team, for the CLI: open the direct chat
/// on the host the connection persisted (as direct_chat_reconnect does), then close it again.
/// Dropping the connection closes the tunnel and removes its socket.
pub(crate) fn cli_open_and_close(app: &tauri::AppHandle, scope: &AccountScope) -> Result<(), &'static str> {
    let host = load_host(app, scope).map_err(|error| error.code)?;
    let connection = connect_impl(app, scope.clone(), host).map_err(|error| error.code)?;
    drop(connection);
    Ok(())
}

pub(super) async fn connect_scoped(
    app: tauri::AppHandle,
    state: &DirectChatState,
    scopes: AccountScopeState,
    expected: AccountScope,
    host: ExecutionHost,
) -> Result<DirectChatStatus, DirectChatError> {
    let started = Instant::now();
    let app_for_log = app.clone();
    {
        let _scope = scopes.lock_expected(&expected).map_err(failure)?;
        state
            .inner
            .connection
            .lock()
            .map_err(|_| failure("state_failed"))?
            .take();
        forget_probe(&state.inner);
        emit(
            &state.inner,
            DirectChatEvent::Status {
                status: status("connecting", None),
            },
        );
    }
    let worker_scopes = scopes.clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = worker_scopes
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        connect_impl(&app, worker_expected, host)
    })
    .await
    .map_err(|_| failure("connect_failed"))?;
    match result {
        Ok(connection) => {
            log_chat_call(Some(&app_for_log), "connect", Ok(()), started.elapsed());
            let _scope = scopes.lock_expected(&expected).map_err(failure)?;
            let mut slot = state
                .inner
                .connection
                .lock()
                .map_err(|_| failure("state_failed"))?;
            let ready = ready_for(&connection);
            *slot = Some(connection);
            forget_probe(&state.inner);
            emit(
                &state.inner,
                DirectChatEvent::Status {
                    status: ready.clone(),
                },
            );
            Ok(ready)
        }
        Err(error) => {
            log_chat_call(Some(&app_for_log), "connect", Err(error.code), started.elapsed());
            let _scope = scopes.lock_expected(&expected).map_err(failure)?;
            let failed = status("error", Some(error.code));
            emit(
                &state.inner,
                DirectChatEvent::Status {
                    status: failed.clone(),
                },
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn direct_chat_connect(
    app: tauri::AppHandle,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    host: ExecutionHost,
) -> Result<DirectChatStatus, DirectChatError> {
    let expected = scopes.active().map_err(failure)?;
    connect_scoped(app, &state, scopes.inner().clone(), expected, host).await
}

// The commands below ask the connection, which can mean a process on the computer (the probe) and the connection's
// lock, held while another operation runs. A sync command runs on the main thread, the window's own: it
// would freeze the window for as long as that takes (seconds on a slow Windows computer). So they are async
// and the work is done on a thread of its own, as the other chat commands do.
#[tauri::command]
pub(crate) async fn direct_chat_subscribe(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    on_event: Channel<DirectChatEvent>,
) -> Result<DirectChatStatus, DirectChatError> {
    let inner = Arc::clone(&state.inner);
    let scope_state = scopes.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state.lock_active().map_err(failure)?;
        inner
            .subscribers
            .lock()
            .map_err(|_| failure("state_failed"))?
            .push(on_event);
        status_for_scope(&inner, scope.scope())
    })
    .await
    .map_err(|_| failure("state_failed"))?
}

pub(super) fn status_for_scope(
    inner: &DirectChatInner,
    scope: &AccountScope,
) -> Result<DirectChatStatus, DirectChatError> {
    let slot = inner
        .connection
        .lock()
        .map_err(|_| failure("state_failed"))?;
    match slot.as_ref() {
        // This computer's team: the lock is let go before the probe, so that a read of the chat or of the profile does not
        // wait for it (the container found for the probe is kept for them, one lookup at a time).
        Some(connection) if &connection.scope == scope && matches!(connection.validated, ValidatedHost::Local) => {
            let local = connection.detached_local().ok_or_else(|| failure("state_failed"))?;
            drop(slot);
            Ok(status_kept_or_probed(&inner.probe_memo, scope, std::time::Instant::now, || probe(&local)))
        }
        Some(connection) if &connection.scope == scope => Ok(status_kept_or_probed(
            &inner.probe_memo,
            scope,
            std::time::Instant::now,
            || probe(connection),
        )),
        Some(_) => Err(failure("account_scope_mismatch")),
        None => Ok(status("disconnected", None)),
    }
}

#[tauri::command]
pub(crate) async fn direct_chat_status(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<DirectChatStatus, DirectChatError> {
    let inner = Arc::clone(&state.inner);
    let scope_state = scopes.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state.lock_active().map_err(failure)?;
        status_for_scope(&inner, scope.scope())
    })
    .await
    .map_err(|_| failure("state_failed"))?
}

#[tauri::command]
pub(crate) async fn direct_chat_reconnect(
    app: tauri::AppHandle,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<DirectChatStatus, DirectChatError> {
    let expected = scopes.active().map_err(failure)?;
    let host = {
        let _scope = scopes.lock_expected(&expected).map_err(failure)?;
        load_host(&app, &expected)?
    };
    connect_scoped(app, &state, scopes.inner().clone(), expected, host).await
}
#[tauri::command]
pub(crate) async fn direct_chat_close(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<(), DirectChatError> {
    let inner = Arc::clone(&state.inner);
    let scope_state = scopes.inner().clone();
    // Closing a VPS link runs ssh (up to 5 s) and waits for the connection's lock: off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state.lock_active().map_err(failure)?;
        let mut slot = inner
            .connection
            .lock()
            .map_err(|_| failure("state_failed"))?;
        if slot
            .as_ref()
            .is_some_and(|connection| &connection.scope != scope.scope())
        {
            return Err(failure("account_scope_mismatch"));
        }
        if let Some(mut connection) = slot.take() {
            close_connection(&mut connection);
        }
        forget_probe(&inner);
        emit(
            &inner,
            DirectChatEvent::Status {
                status: status("disconnected", None),
            },
        );
        Ok(())
    })
    .await
    .map_err(|_| failure("state_failed"))?
}

pub(crate) fn teardown(state: &DirectChatState) {
    existing_team_runtime::revoke_full_link();
    if let Ok(mut slot) = state.inner.connection.lock() {
        if let Some(mut connection) = slot.take() {
            close_connection(&mut connection);
        }
    }
    forget_probe(&state.inner);
    if let Ok(mut subscribers) = state.inner.subscribers.lock() {
        subscribers.clear();
    }
}

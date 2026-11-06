use super::*;

/// How long the check «is the team's container up» may take, once a read failed.
pub(super) const LOCAL_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// The read of this computer's team. The reader and the request travel on stdin to the host wrapper's
/// `desktop-chat python`, the channel the chat and «Export my data» use: it finds the attested container, runs
/// the reader in it and never starts anything. Before it runs, this account must own the runtime's folder (a
/// check only: the read never claims it) and the wrapper must speak the chat's protocol.
pub(super) fn positions_read_local(app: &tauri::AppHandle, scope: &AccountScope, request: &PositionsRequest, request_bytes: &[u8]) -> Value {
    let started = Instant::now();
    let wrapper = match local_reader_wrapper(app, scope) {
        Ok(wrapper) => wrapper,
        Err(error) => return positions_failure(error),
    };
    let reply = positions_read_local_with(
        request,
        request_bytes,
        &crate::local_swipe::scope_tag(scope),
        local_machine_is_off,
        |input| crate::onboarding::run_verified_local_wrapper(&wrapper, &["desktop-chat", "python"], Some(input), READ_TIMEOUT),
        || {
            crate::onboarding::run_verified_local_wrapper(&wrapper, &["desktop-chat", "probe"], None, LOCAL_PROBE_TIMEOUT)
                .map(|probe| probe.success())
                .unwrap_or(false)
        },
        || positions_saved_reply(app, request),
    );
    if let Some(log) = crate::runtime_log::RuntimeLog::new(app) {
        log.record_positions_read(&crate::runtime_log::PositionsReadTiming {
            op: request.op(),
            shared: false,
            checks_skipped: false,
            ok: reply.get("ok") == Some(&Value::Bool(true)),
            total: started.elapsed(),
            ssh: Duration::ZERO,
            bytes_out: request_bytes.len(),
            bytes_in: 0,
        });
    }
    reply
}

/// The host wrapper a read of this computer's team goes through, once this account is the runtime's owner.
pub(crate) fn local_reader_wrapper(app: &tauri::AppHandle, scope: &AccountScope) -> Result<std::path::PathBuf, &'static str> {
    let mut found = None;
    let checked = (|| {
        let marker = crate::account_scope::local_owner_marker_path(app)?;
        crate::account_scope::verify_local_runtime_owner(&marker, scope)?;
        let wrapper = crate::onboarding::verified_local_wrapper_path(app)?;
        found = Some(wrapper.clone());
        if !crate::onboarding::wrapper_has_desktop_chat(&wrapper) {
            return Err("local_chat_wrapper_outdated");
        }
        Ok(wrapper)
    })();
    // Every refusal leaves a line: pages that read nothing were silent, and the code said only «outdated».
    if let Err(code) = checked {
        if let Some(log) = crate::runtime_log::RuntimeLog::new(app) {
            let wrapper = found.or_else(|| crate::onboarding::expected_wrapper_path(app));
            log.record_local_reader_refusal(code, wrapper.as_deref(), app.path().home_dir().ok().as_deref());
        }
    }
    checked
}

/// Whether the machine that runs this computer's team is stopped. Only Windows has a machine of its own (Podman's); on
/// the other systems the container is asked and the answer to a container that is off comes from the wrapper.
pub(crate) fn local_machine_is_off() -> bool {
    #[cfg(windows)]
    {
        // One question a few seconds apart, not one per read: a page asks several things in a row.
        static LAST: std::sync::Mutex<Option<(Instant, bool)>> = std::sync::Mutex::new(None);
        const FRESH: Duration = Duration::from_secs(3);
        let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((at, off)) = *last {
            if at.elapsed() < FRESH {
                return off;
            }
        }
        let off = crate::podman::jht_machine_is_off();
        *last = Some((Instant::now(), off));
        off
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// One run of the reader in this computer's container, then its reply. A run that fails is told apart by asking
/// whether the team is up (`team_is_up`, asked only then): a container that is off says so, in the chat's own
/// words; anything else is the reader's failure.
pub(super) fn positions_read_local_with(
    request: &PositionsRequest,
    request_bytes: &[u8],
    token_tag: &str,
    machine_is_off: impl FnOnce() -> bool,
    run: impl FnOnce(&[u8]) -> Result<ProcessResult, &'static str>,
    team_is_up: impl FnOnce() -> bool,
    saved: impl FnOnce() -> Option<Value>,
) -> Value {
    // The team's machine is stopped (asked by a read of its state, which starts nothing): the wrapper is not called at all,
    // because a call to the engine of a stopped machine is not known to leave it alone. The pages show what the team saved.
    if machine_is_off() {
        return saved().unwrap_or_else(|| positions_failure("local_team_not_running"));
    }
    let mut input = hex_encode(POSITIONS_READ_PY.as_bytes()).into_bytes();
    input.push(b'\n');
    input.extend_from_slice(request_bytes);
    input.push(b'\n');
    match run(&input) {
        Ok(output) if output.success() => positions_reply_from_output(request, output, Some(token_tag)),
        // The container is off: the pages show what the team saved, read here from a private copy of its jobs.db, and say so.
        _ if !team_is_up() => saved().unwrap_or_else(|| positions_failure("local_team_not_running")),
        _ => positions_answer_failure("positions_unavailable"),
    }
}

/// The saved data of this computer's team for a read, checked like the container's own reply: a well-formed answer of the shape
/// the request asked for (with the moment they were written beside it), or a failure of the saved data, or nothing.
pub(super) fn positions_saved_reply(app: &tauri::AppHandle, request: &PositionsRequest) -> Option<Value> {
    let home = crate::account_scope::local_runtime_home(app).ok()?;
    let work = app.path().app_local_data_dir().ok()?.join("host-db");
    let asked = serde_json::to_value(request).ok()?;
    let mut reply = crate::host_positions::read_saved(&home, &work, &asked)?;
    let saved = reply.as_object_mut().and_then(|object| object.remove("saved"));
    if reply.get("ok") == Some(&Value::Bool(true)) {
        if !valid_positions_reply(request, &reply) {
            return Some(positions_answer_failure("positions_unavailable"));
        }
        reply.as_object_mut()?.insert("saved".into(), saved?);
        return Some(reply);
    }
    match reply.get("error").and_then(Value::as_str) {
        Some("host_db_unsafe") => Some(positions_answer_failure("host_db_unsafe")),
        Some("host_db_busy") => Some(positions_answer_failure("host_db_busy")),
        Some("host_db_unreadable") => Some(positions_answer_failure("host_db_unreadable")),
        Some("host_db_invalid") => Some(positions_answer_failure("host_db_invalid")),
        Some("host_db_timeout") => Some(positions_answer_failure("host_db_timeout")),
        Some("positions_request_invalid") => Some(positions_answer_failure("positions_request_invalid")),
        _ => Some(positions_answer_failure("positions_unavailable")),
    }
}

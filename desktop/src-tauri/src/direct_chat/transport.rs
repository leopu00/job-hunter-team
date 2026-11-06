use super::*;

pub(super) const REMOTE_CONTAINER_PROBE: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat probe"#;
pub(crate) const REMOTE_PYTHON_STDIN: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat python"#;
pub(super) fn valid_agent(value: &str) -> bool {
    existing_team_runtime::chat_agent_ok(value)
}
pub(super) fn session_for(agent: &str) -> Option<String> {
    existing_team_runtime::chat_session(agent)
}
pub(super) fn run_connection(
    connection: &Connection,
    // the wrapper action that named the operation before the local runtime ran it natively: no local operation runs it now
    _local_args: &[&str],
    remote_operation: RemoteOperation<'_>,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, DirectChatError> {
    match &connection.validated {
        ValidatedHost::Local => {
            crate::account_scope::verify_local_runtime_owner(
                connection
                    .local_owner_marker
                    .as_deref()
                    .ok_or_else(|| failure("local_account_owner_unavailable"))?,
                &connection.scope,
            )
            .map_err(failure)?;
            match remote_operation {
                    RemoteOperation::Chat(operation) => {
                        let runtime = connection
                            .local_runtime
                            .as_deref()
                            .ok_or_else(|| failure("runtime_missing"))?;
                        let wrapper = connection
                            .local_wrapper
                            .as_deref()
                            .ok_or_else(|| failure("runtime_missing"))?;
                        // The hot read goes over the state stream when it is open (and only the read: a send, an
                        // answer or an Enter is exec by exec, and tells the stream to drop what it kept).
                        let stream = connection.app.as_ref().map(|app| crate::state_stream::LocalContext { app, scope: &connection.scope, wrapper, runtime });
                        if let (Some(stream), ChatOperation::Read { agent, cursor }) = (&stream, &operation) {
                            if let Some(done) = crate::state_stream::read_local(stream, &crate::state_stream::StreamRead::ChatRead { agent, cursor: *cursor }) {
                                return Ok(done);
                            }
                        }
                        let writes = !matches!(operation, ChatOperation::Read { .. });
                        let done = run_local_chat(wrapper, runtime, operation, input, timeout).map_err(failure);
                        if let (true, Some(stream)) = (writes, &stream) {
                            crate::state_stream::invalidate_local(stream);
                        }
                        done
                    }
                // The probe, the Python scripts and the delivery of a message: no wrapper (a PowerShell on Windows, seconds
                // each) in between. The runtime is attested in Rust and the container found as the chat finds it
                // (and kept for the chat's next calls); the program run in it is the one the wrapper ran.
                RemoteOperation::Probe | RemoteOperation::Python | RemoteOperation::Delivery(_) => {
                    let runtime = connection.local_runtime.as_deref().ok_or_else(|| failure("runtime_missing"))?;
                    let wrapper = connection.local_wrapper.as_deref().ok_or_else(|| failure("runtime_missing"))?;
                    run_local_native(wrapper, runtime, &remote_operation, input, timeout).map_err(failure)
                }
            }
        }
        ValidatedHost::Vps { .. } => {
            let selected = connection.app.as_ref().ok_or_else(|| failure("existing_team_runtime_target_changed"))
                .and_then(|app| existing_team_runtime::selected_or_own(app, &connection.scope, &connection.host).map_err(failure))?;
            if selected.as_ref().map(|target| (&target.team_id, &target.runtime)) != connection.runtime.as_ref().map(|target| (&target.team_id, &target.runtime)) {
                return Err(failure("existing_team_runtime_target_changed"));
            }
            let command = match (selected.as_ref(), remote_operation) {
                (Some(target), RemoteOperation::Probe) => existing_team_runtime::command(&target.runtime, "\"$JHT_ENGINE\" inspect --type container --format '{{.State.Running}}' \"$JHT_CID\"").map_err(failure)?,
                (Some(target), RemoteOperation::Python) => existing_team_runtime::python_command(&target.runtime).map_err(failure)?,
                (Some(target), RemoteOperation::Delivery(session)) => existing_team_runtime::delivery_command(&target.runtime, session).map_err(failure)?,
                (Some(target), RemoteOperation::Chat(operation)) => existing_team_runtime::chat_command(&target.runtime, &operation).map_err(failure)?,
                (None, RemoteOperation::Chat(operation)) => remote_wrapper_command(
                    &existing_team_runtime::chat_wrapper_arguments(&operation).map_err(failure)?,
                    operation.needs_answer_actions(),
                ),
                (None, RemoteOperation::Probe) => REMOTE_CONTAINER_PROBE.to_owned(),
                (None, RemoteOperation::Python) => REMOTE_PYTHON_STDIN.to_owned(),
                (None, RemoteOperation::Delivery(session)) => delivery_command(session).ok_or_else(|| failure("invalid_agent"))?,
            };
            match connection.link {
                VpsLink::Master => run_ssh_command(&connection.validated, &command, input, timeout, connection.control_path.as_deref()),
                VpsLink::PerCommand => run_ssh_command_without_pipes(&connection.validated, &command, input, timeout),
            }
            .map_err(failure)
        }
    }
}

/// The probe, timed: the answer that is not "ready", and a "ready" that took long, are written to the runtime log.
pub(super) fn probe(connection: &Connection) -> DirectChatStatus {
    let started = Instant::now();
    let answer = probe_unlogged(connection);
    let outcome = if answer.state == "ready" { Ok(()) } else { Err(answer.code.unwrap_or("container_unavailable")) };
    log_chat_call(connection.app.as_ref(), "probe", outcome, started.elapsed());
    answer
}

pub(super) fn probe_unlogged(connection: &Connection) -> DirectChatStatus {
    if let (ValidatedHost::Vps { .. }, Some(path)) =
        (&connection.validated, &connection.control_path)
    {
        if !check_tunnel(&connection.validated, path) {
            return status("error", Some("tunnel_unavailable"));
        }
    }
    let result = run_connection(
        connection,
        &["desktop-chat", "probe"],
        RemoteOperation::Probe,
        None,
        CONNECT_TIMEOUT,
    );
    match result {
        Ok(result) if result.success() && result.stdout_text().trim() == "true" => {
            ready_for(connection)
        }
        // The host answered and there is no container for the team: say which kind of «no container» it is.
        Ok(_) => status("error", Some(probe_no_container_code(&connection.validated))),
        // This computer's team, found natively: the code says what it is, not only that it is not there.
        Err(error) if matches!(connection.validated, ValidatedHost::Local) && matches!(error.code, "local_team_not_running" | "local_container_not_attested") => {
            status("error", Some(error.code))
        }
        // The host could not be asked at all (runtime missing, another account's, a timeout).
        Err(_) => status("error", Some("container_unavailable")),
    }
}

/// What a probe that found no container for the team says. On this computer the team is not running: the
/// chat's own code, which the pages answer with «Start the team». On a VPS the container is unavailable (the
/// machine may be off or the team not installed there): nothing the app starts from here.
pub(super) fn probe_no_container_code(host: &ValidatedHost) -> &'static str {
    match host {
        ValidatedHost::Local => "local_team_not_running",
        ValidatedHost::Vps { .. } => "container_unavailable",
    }
}
pub(super) fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 15) as usize] as char);
    }
    output
}

pub(super) fn python_input(script: &str, request: &Value) -> Result<Zeroizing<Vec<u8>>, DirectChatError> {
    let mut input = Zeroizing::new(hex_encode(script.as_bytes()).into_bytes());
    input.push(b'\n');
    input.extend(serde_json::to_vec(request).map_err(|_| failure("request_invalid"))?);
    input.push(b'\n');
    Ok(input)
}

pub(super) fn run_python(
    connection: &Connection,
    script: &str,
    request: &Value,
    timeout: Duration,
) -> Result<ProcessResult, DirectChatError> {
    // The profile bar's read, the team's first-start read and the statistics' read go over the state stream when it is open: the same script, as a file of the image.
    if let (ValidatedHost::Local, Some(app), Some(wrapper), Some(runtime)) = (&connection.validated, connection.app.as_ref(), connection.local_wrapper.as_deref(), connection.local_runtime.as_deref()) {
        let plain = request == &json!({"op": "read"});
        let hot = if plain && script == crate::profile_progress::PROFILE_PROGRESS_PY {
            Some(crate::state_stream::StreamRead::ProfileProgress)
        } else if plain && script == crate::team_start::TEAM_START_PY {
            Some(crate::state_stream::StreamRead::TeamStart)
        } else if request == &json!({"op": "read", "nights": 30}) && script == crate::work_stats::WORK_STATS_PY {
            Some(crate::state_stream::StreamRead::WorkStats)
        } else {
            None
        };
        if let Some(hot) = hot {
            let context = crate::state_stream::LocalContext { app, scope: &connection.scope, wrapper, runtime };
            if let Some(done) = crate::state_stream::read_local(&context, &hot) {
                return Ok(done);
            }
        }
    }
    let mut input = python_input(script, request)?;
    let result = run_connection(
        connection,
        &["desktop-chat", "python"],
        RemoteOperation::Python,
        Some(&input),
        timeout,
    );
    input.zeroize();
    // clearing the statistics changes what the stream kept of them: it is dropped now
    if script == crate::work_stats::WORK_STATS_PY && request == &json!({"op": "clear"}) {
        if let (ValidatedHost::Local, Some(app), Some(wrapper), Some(runtime)) = (&connection.validated, connection.app.as_ref(), connection.local_wrapper.as_deref(), connection.local_runtime.as_deref()) {
            crate::state_stream::invalidate_local(&crate::state_stream::LocalContext { app, scope: &connection.scope, wrapper, runtime });
        }
    }
    result
}

/// The host's wrapper, run on a VPS that was never pinned: the checks of `REMOTE_PYTHON_STDIN`
/// (the wrapper is there, executable, not a link, and speaks the chat protocol), then the wrapper
/// with the arguments given. Every one was checked by the chat's argument list, and is quoted.
pub(super) fn remote_wrapper_command(arguments: &[String], answer_actions: bool) -> String {
    let checks = REMOTE_PYTHON_STDIN.strip_suffix("desktop-chat python").unwrap_or(REMOTE_PYTHON_STDIN);
    let checks = checks.strip_suffix(r#"exec "$JHT_BIN" "#).unwrap_or(checks);
    let quoted: Vec<String> = arguments.iter().map(|argument| format!("'{argument}'")).collect();
    // A wrapper without the chat marker does not know the actions: 64 says exactly that, and only 64
    // sends the caller back to the older path. Any other exit (2 included, which python3 gives when the
    // image has no agent_chat.py) is the script's, and is told as such. Answer and Enter came later:
    // they need a marker of their own, and have no older path.
    let answer = if answer_actions {
        format!(r#"grep -Fqx 'JHT_DESKTOP_CHAT_ANSWER=1' "$JHT_BIN" || exit {UNKNOWN_ACTION}; "#)
    } else {
        String::new()
    };
    // An instance of a numbered role (`analista-2`) came later still: it needs its own marker. Without it the
    // caller takes the older path, which does not know instances and says «update the team».
    let instances = if arguments.iter().any(|argument| existing_team_runtime::chat_instance(argument).is_some()) {
        format!(r#"grep -Fqx 'JHT_DESKTOP_CHAT_INSTANCES=1' "$JHT_BIN" || exit {UNKNOWN_ACTION}; "#)
    } else {
        String::new()
    };
    format!(r#"{checks}grep -Fqx 'JHT_DESKTOP_CHAT_FIXED=1' "$JHT_BIN" || exit {UNKNOWN_ACTION}; {answer}{instances}exec "$JHT_BIN" {}"#, quoted.join(" "))
}

/// The exit that says «the host's wrapper does not have the chat actions».
pub(super) const UNKNOWN_ACTION: i32 = 64;

/// A pinned team's chat goes through the fixed script of the container. A local team reaches that
/// same script directly from Rust; only an unpinned VPS goes through its host wrapper.
pub(super) fn uses_pinned_chat(connection: &Connection) -> bool {
    matches!(connection.validated, ValidatedHost::Vps { .. }) && connection.runtime.is_some()
}

/// What the script (or the link under it) said, as a code of the error catalog. 2 is python3's
/// answer for a missing file: an image older than this chat. 70 is the pinned container no longer
/// being the one that was confirmed. 255 is ssh's own: the link is gone.
pub(super) fn chat_failure(code: i32, default: &'static str) -> &'static str {
    match code {
        2 => "chat_runtime_outdated",
        70 => "existing_team_runtime_target_changed",
        // The agent's terminal is not at its prompt (a menu, a sign-in, a permission question, text
        // already typed): nothing was written, and the text was never typed over it.
        119 => "agent_not_at_prompt",
        120 => "invalid_request",
        121 => "team_not_running",
        122 => "agent_not_running",
        123 => "agent_unavailable",
        124 => "agent_busy",
        125 => "agent_stuck",
        126 => "send_failed",
        127 => "read_failed",
        128 => "persist_failed",
        // The image has no fence for the user's words: older than the chat, the same «update the team».
        129 => "chat_runtime_outdated",
        // The agent is at an otherwise ready prompt, but has a draft. The transport left both
        // that draft and the user's message untouched.
        130 => "composer_has_text",
        // An answer the team did not take: the question is no longer open (answered, expired), an
        // option it does not have or words it does not take, a question it does not know, or a write
        // that failed. The page has a sentence for each.
        // The image has no questions to answer (no agent_questions, no database): update the team.
        114 => "chat_runtime_outdated",
        115 => "answer_failed",
        116 => "not_found",
        117 => "invalid_choice",
        118 => "question_closed",
        255 => "tunnel_unavailable",
        _ => default,
    }
}

/// Chat without a pinned container. For a local runtime `run_connection` executes the container
/// script directly; for an unpinned VPS it uses the host wrapper. `None` is only the VPS wrapper's
/// exit 64: it has no chat marker, so the caller keeps the older path while app and VPS update apart.
pub(super) fn run_wrapper_chat(
    connection: &Connection,
    operation: ChatOperation<'_>,
    input: Option<&[u8]>,
    timeout: Duration,
    default: &'static str,
) -> Result<Option<ProcessResult>, DirectChatError> {
    let arguments = existing_team_runtime::chat_wrapper_arguments(&operation).map_err(failure)?;
    let references: Vec<&str> = arguments.iter().map(String::as_str).collect();
    let result = run_connection(
        connection,
        &references,
        RemoteOperation::Chat(operation),
        input,
        timeout,
    )?;
    wrapper_outcome(
        result,
        default,
        matches!(&connection.validated, ValidatedHost::Local),
    )
}

/// What the wrapper's exit says: done, «this wrapper has no chat actions» (64, and only 64), or a
/// failure of the script behind it. On this computer the four actions bypass that wrapper; a 2 or
/// 64 therefore says the local runtime cannot provide this chat, never that the team is old.
pub(super) fn wrapper_outcome(
    result: ProcessResult,
    default: &'static str,
    local: bool,
) -> Result<Option<ProcessResult>, DirectChatError> {
    match result.code {
        0 => Ok(Some(result)),
        UNKNOWN_ACTION if !local => Ok(None),
        2 | UNKNOWN_ACTION if local => Err(failure("local_chat_wrapper_outdated")),
        code => Err(failure(chat_failure(code, default))),
    }
}

pub(super) fn run_chat(
    connection: &Connection,
    operation: ChatOperation<'_>,
    input: Option<&[u8]>,
    timeout: Duration,
    default: &'static str,
) -> Result<ProcessResult, DirectChatError> {
    let result = run_connection(connection, &[], RemoteOperation::Chat(operation), input, timeout)?;
    if result.success() {
        Ok(result)
    } else {
        Err(failure(chat_failure(result.code, default)))
    }
}

use super::*;

/// The wrapper's older `send` action for one session, on a host reached by ssh: the checks of
/// `REMOTE_PYTHON_STDIN`, then `desktop-chat send SESSION`. The session is a capital-letter name of the chat's
/// closed grammar (the eight fixed ones, or an instance of a numbered role), checked here again.
pub(super) fn delivery_command(session: &str) -> Option<String> {
    if !existing_team_runtime::chat_session_ok(session) {
        return None;
    }
    let checks = REMOTE_PYTHON_STDIN.strip_suffix("python")?;
    Some(format!("{checks}send {session}"))
}

pub(super) fn local_delivery_args(session: &str) -> [&str; 3] {
    ["desktop-chat", "send", session]
}
/// One command does what the two used to: the turn is written once for its client id and goes to
/// the agent's terminal in the user's envelope. A terminal that is busy (alive, taking a turn) is
/// asked again with the same id, which writes nothing twice. `None`: the host's wrapper is older
/// than the chat actions, and the caller keeps the older path.
pub(super) fn send_fixed(
    connection: &Connection,
    agent: &str,
    text: &str,
    client_id: &str,
) -> Result<Option<DirectChatReceipt>, DirectChatError> {
    if text.len() > MAX_CHAT_STDIN_BYTES {
        return Err(failure("invalid_request"));
    }
    let input = Zeroizing::new(text.as_bytes().to_vec());
    let pinned = uses_pinned_chat(connection);
    // One ask. A working agent is not retried here: the team queues the turn and answers `queued`.
    let operation = ChatOperation::Send { agent, client_message_id: client_id };
    let outcome = if pinned {
        run_chat(connection, operation, Some(&input), SEND_TIMEOUT, "send_failed").map(Some)
    } else {
        run_wrapper_chat(connection, operation, Some(&input), SEND_TIMEOUT, "send_failed")
    };
    match outcome {
        Ok(Some(result)) => parse_json(result, "send_verify_failed").map(Some),
        Ok(None) => Ok(None),
        Err(error) => Err(error),
    }
}

pub(super) fn send_impl(
    inner: &DirectChatInner,
    agent: String,
    text: String,
    client_id: String,
) -> Result<DirectChatReceipt, DirectChatError> {
    let _serial = inner
        .send_lock
        .lock()
        .map_err(|_| failure("state_failed"))?;
    let slot = inner
        .connection
        .lock()
        .map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    refuse_writing(connection)?;
    if let Some(receipt) = send_fixed(connection, &agent, &text, &client_id)? {
        return Ok(receipt);
    }
    // The host's wrapper is older than the chat actions (only a local team or an unpinned VPS gets
    // here): the older path, as it was.
    let check: Value = parse_json(
        run_python(
            connection,
            CHAT_PERSIST_PY,
            &json!({"mode":"check","agent":agent,"clientMessageId":client_id}),
            READ_TIMEOUT,
        )?,
        "send_verify_failed",
    )?;
    // The current Godot transport persists first, then delivers through the
    // verified tmux helper. A retry may find the persisted turn: it must still
    // retry delivery, never turn file presence into an optimistic success.
    let receipt: DirectChatReceipt = if check.get("exists").and_then(Value::as_bool) == Some(true) {
        serde_json::from_value(check).map_err(|_| failure("send_verify_failed"))?
    } else {
        parse_json(
            run_python(
                connection,
                CHAT_PERSIST_PY,
                &json!({"mode":"append","agent":agent,"text":text,"clientMessageId":client_id}),
                READ_TIMEOUT,
            )?,
            "persist_failed",
        )?
    };
    let session = session_for(&agent).ok_or_else(|| failure("invalid_agent"))?;
    let session = session.as_str();
    let mut envelope = Zeroizing::new(format!("[@utente -> @{agent}] [CHAT] {text}"));
    let mut delivered = run_connection(
        connection,
        &local_delivery_args(session),
        RemoteOperation::Delivery(session),
        Some(envelope.as_bytes()),
        SEND_TIMEOUT,
    )?;
    for _ in 1..3 {
        if delivered.code != 4 {
            break;
        }
        delivered = run_connection(
            connection,
            &local_delivery_args(session),
            RemoteOperation::Delivery(session),
            Some(envelope.as_bytes()),
            SEND_TIMEOUT,
        )?;
    }
    envelope.zeroize();
    if !delivered.success() {
        return Err(failure(match delivered.code {
            2 => "agent_not_running",
            3 => "agent_unavailable",
            4 => "agent_busy",
            5 => "agent_stuck",
            _ => "send_failed",
        }));
    }
    Ok(receipt)
}

#[tauri::command]
pub(crate) async fn direct_chat_send(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    text: String,
    client_message_id: String,
) -> Result<DirectChatReceipt, DirectChatError> {
    // Writing to an agent is a command: only the app's own window may ask for it (the capability
    // also reaches the windows that load other sites, the sign-in views).
    if !window_may_write(window.label()) {
        return Err(failure("invalid_request"));
    }
    let trimmed = text.trim();
    if !valid_agent(&agent_id)
        || trimmed.is_empty()
        || trimmed.len() > 4000
        || trimmed.contains('\0')
        || client_message_id.is_empty()
        || client_message_id.len() > 128
        || !client_message_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    {
        return Err(failure("invalid_request"));
    }
    let started = Instant::now();
    let expected = scopes.active().map_err(failure)?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let inner = Arc::clone(&state.inner);
    let agent = agent_id;
    let id = client_message_id;
    let mut sensitive = Zeroizing::new(trimmed.to_string());
    let owned = sensitive.to_string();
    sensitive.zeroize();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        {
            let slot = inner
                .connection
                .lock()
                .map_err(|_| failure("state_failed"))?;
            let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
            if &connection.scope != scope.scope() {
                return Err(failure("account_scope_mismatch"));
            }
        }
        send_impl(&inner, agent, owned, id)
    })
    .await
    .map_err(|_| failure("send_failed"))?;
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    match result {
        Ok(receipt) => {
            log_chat_call(Some(&app), "send", Ok(()), started.elapsed());
            emit(
                &state.inner,
                DirectChatEvent::Send {
                    receipt: receipt.clone(),
                },
            );
            Ok(receipt)
        }
        Err(error) => {
            log_chat_call(Some(&app), "send", Err(error.code), started.elapsed());
            emit(
                &state.inner,
                DirectChatEvent::Error {
                    operation: "send",
                    code: error.code,
                },
            );
            Err(error)
        }
    }
}

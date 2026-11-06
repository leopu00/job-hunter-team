use super::*;

pub(crate) fn window_may_write(label: &str) -> bool {
    label == "main"
}

/// Writing to an existing team's agent needs the full connection ("Collega e conferma") made in
/// this run of the app. The read-only view activates the same target and opens the same chat, so
/// it is decided here, in the native side, and not by the page: a chat opened read-only reads,
/// and a send is refused whatever the renderer asks.
///
/// A team with no pinned target is this computer's (always writable) or a VPS of the person's own,
/// which `own_may_write` answers: writing to it needs the mark the app's own setup writes, or the
/// person's claim of it (JHT-T30). Not having a candidate or a selection is no permission.
pub(super) fn link_allows_writing(runtime: Option<&ActivatedTarget>, own_may_write: bool, full_link: impl Fn(&ActivatedTarget) -> bool) -> bool {
    runtime.map_or(own_may_write, full_link)
}

/// Why a message may not go to the VPS of the person's own this connection is on, or none: this
/// computer and an existing team have their own rules. The codes are the page's invitation to claim
/// the VPS (`own_vps_claim_required`) or to claim it again after its key changed (`own_vps_key_changed`).
pub(super) fn own_vps_write_refusal(connection: &Connection) -> Option<&'static str> {
    if connection.runtime.is_some() || !matches!(connection.validated, ValidatedHost::Vps { .. }) {
        return None;
    }
    let Some(app) = connection.app.as_ref() else {
        return Some("own_vps_claim_refused");
    };
    let pinned = crate::runtime_host::pinned_host_fingerprint(&connection.validated).ok();
    match existing_team_runtime::root(app) {
        Ok(root) => existing_team_runtime::own_vps_state_at(&root, &connection.scope, &connection.host, pinned.as_deref()).write_refusal(),
        Err(_) => Some("own_vps_claim_refused"),
    }
}
/// The one gate of every write to an agent (a message, an answer, an Enter): an existing team needs
/// the full link made in this run of the app, a VPS of the person's own needs its mark. A refusal is
/// written to the runtime log, as the read-only view's own steps are.
pub(super) fn refuse_writing(connection: &Connection) -> Result<(), DirectChatError> {
    let own_refusal = own_vps_write_refusal(connection);
    if link_allows_writing(connection.runtime.as_ref(), own_refusal.is_none(), |target| {
        existing_team_runtime::full_link_granted(&connection.scope, target)
    }) {
        return Ok(());
    }
    let code = own_refusal.unwrap_or("read_only_link");
    if let Some(log) = connection.app.as_ref().and_then(crate::runtime_log::RuntimeLog::new) {
        log.record_chat_refusal(code);
    }
    Err(failure(code))
}

/// Answer and Enter, in the fixed local/pinned container or through a VPS host wrapper. They have
/// no older path: a VPS wrapper without them (64) is a team to update.
pub(super) fn run_answer_action(
    connection: &Connection,
    operation: ChatOperation<'_>,
    input: Option<&[u8]>,
    timeout: Duration,
    default: &'static str,
) -> Result<ProcessResult, DirectChatError> {
    if uses_pinned_chat(connection) {
        return run_chat(connection, operation, input, timeout, default);
    }
    run_wrapper_chat(connection, operation, input, timeout, default)?.ok_or_else(|| failure("chat_runtime_outdated"))
}

/// The options and the words of an answer, checked before they leave: at most 8 distinct option
/// ids of the closed alphabet, at least one of them or some words, the words at most 2000
/// characters and without NUL. The team checks them again against the question itself.
pub(super) fn answer_input(choices: &[String], text: Option<&str>) -> Result<Zeroizing<Vec<u8>>, DirectChatError> {
    let words = text.map(str::trim).filter(|t| !t.is_empty());
    let distinct = choices.iter().enumerate().all(|(i, c)| !choices[..i].contains(c));
    if choices.len() > MAX_OPTIONS
        || !distinct
        || !choices.iter().all(|c| option_id(c))
        || (choices.is_empty() && words.is_none())
        || words.is_some_and(|w| w.chars().count() > MAX_ANSWER_CHARS || w.contains('\0'))
    {
        return Err(failure("invalid_request"));
    }
    let line = serde_json::to_vec(&json!({"choices": choices, "text": words})).map_err(|_| failure("invalid_request"))?;
    Ok(Zeroizing::new(line))
}

pub(super) fn answer_impl(
    inner: &DirectChatInner,
    agent: &str,
    question_id: &str,
    input: &[u8],
) -> Result<DirectChatAnswerReceipt, DirectChatError> {
    let _serial = inner.send_lock.lock().map_err(|_| failure("state_failed"))?;
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    refuse_writing(connection)?;
    let result = run_answer_action(
        connection,
        ChatOperation::Answer { agent, question_id },
        Some(input),
        READ_TIMEOUT,
        "answer_failed",
    )?;
    let receipt: DirectChatAnswerReceipt = parse_json(result, "answer_failed")?;
    // A receipt for another question, or one that does not say it was taken, is no answer.
    if receipt.question_id != question_id || !receipt.accepted || !receipt.at.is_finite() {
        return Err(failure("answer_failed"));
    }
    Ok(receipt)
}

pub(super) fn enter_impl(inner: &DirectChatInner, agent: &str, message_id: &str) -> Result<DirectChatReceipt, DirectChatError> {
    let _serial = inner.send_lock.lock().map_err(|_| failure("state_failed"))?;
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    refuse_writing(connection)?;
    // The ids were checked here: a 120 from the script is an image without the operation.
    let result = run_answer_action(connection, ChatOperation::Enter { agent, message_id }, None, SEND_TIMEOUT, "send_failed")
        .map_err(|error| if error.code == "invalid_request" { failure("chat_runtime_outdated") } else { error })?;
    let receipt: DirectChatReceipt = parse_json(result, "send_verify_failed")?;
    // The receipt of another message, or one that says nothing of the composer, proves nothing.
    if receipt.message_id != message_id || !receipt.accepted || receipt.taken.is_none() {
        return Err(failure("send_verify_failed"));
    }
    Ok(receipt)
}
/// Runs a write of the chat on the worker, in the account scope the page asked it in.
pub(super) async fn chat_write<T: Send + 'static>(
    state: &State<'_, DirectChatState>,
    scopes: &State<'_, AccountScopeState>,
    work: impl FnOnce(&DirectChatInner) -> Result<T, DirectChatError> + Send + 'static,
    default: &'static str,
) -> Result<T, DirectChatError> {
    chat_scoped(
        state,
        scopes,
        move |inner, scope| {
            // a connection that is not there, or is another account's, is refused before the work
            let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
            let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
            if &connection.scope != scope {
                return Err(failure("account_scope_mismatch"));
            }
            drop(slot);
            work(inner)
        },
        default,
    )
    .await
}

/// The same job on a thread of its own, for the account that asked, which `work` is given: the account's lock is held
/// for the job, as for every chat call. `work` takes the connection's lock itself, for as little time as it needs
/// (`with_connection_read` lets it go before the exec on this computer).
pub(super) async fn chat_scoped<T: Send + 'static>(
    state: &State<'_, DirectChatState>,
    scopes: &State<'_, AccountScopeState>,
    work: impl FnOnce(&DirectChatInner, &AccountScope) -> Result<T, DirectChatError> + Send + 'static,
    default: &'static str,
) -> Result<T, DirectChatError> {
    let expected = scopes.active().map_err(failure)?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let inner = Arc::clone(&state.inner);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state.lock_expected(&worker_expected).map_err(failure)?;
        work(&inner, scope.scope())
    })
    .await
    .map_err(|_| failure(default))?;
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

/// What an answer may ask, checked before anything else: first the window (only the app's own may
/// write to an agent), then the agent, the question and the options and words.
pub(super) fn answer_request(
    window: &str,
    agent: &str,
    question_id: &str,
    choices: &[String],
    text: Option<&str>,
) -> Result<Zeroizing<Vec<u8>>, DirectChatError> {
    if !window_may_write(window) || !valid_agent(agent) || !existing_team_runtime::chat_question_id(question_id) {
        return Err(failure("invalid_request"));
    }
    answer_input(choices, text)
}

/// The same for an Enter: the window first, then the agent and the message's id.
pub(super) fn enter_request(window: &str, agent: &str, message_id: &str) -> Result<(), DirectChatError> {
    let well_formed = !message_id.is_empty()
        && message_id.len() <= 64
        && message_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    if !window_may_write(window) || !valid_agent(agent) || !well_formed {
        return Err(failure("invalid_request"));
    }
    Ok(())
}

/// The person's answer to one of the agent's questions: the ids of the options taken and, where the
/// question takes them, words. Only the app's own window may answer, as only it may send.
#[tauri::command]
pub(crate) async fn direct_chat_answer(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    question_id: String,
    choices: Vec<String>,
    text: Option<String>,
) -> Result<DirectChatAnswerReceipt, DirectChatError> {
    let input = answer_request(window.label(), &agent_id, &question_id, &choices, text.as_deref())?;
    let started = Instant::now();
    let result = chat_write(
        &state,
        &scopes,
        move |inner| answer_impl(inner, &agent_id, &question_id, &input),
        "answer_failed",
    )
    .await;
    log_chat_call(Some(&app), "answer", result.as_ref().map(|_| ()).map_err(|error| error.code), started.elapsed());
    if let Err(error) = &result {
        emit(&state.inner, DirectChatEvent::Error { operation: "answer", code: error.code });
    }
    result
}

/// Enter pressed once more on a message the agent's CLI did not take, never the text again: the
/// team presses only if that message is still in the composer, and says what it saw.
#[tauri::command]
pub(crate) async fn direct_chat_enter(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    message_id: String,
) -> Result<DirectChatReceipt, DirectChatError> {
    enter_request(window.label(), &agent_id, &message_id)?;
    let started = Instant::now();
    let result = chat_write(&state, &scopes, move |inner| enter_impl(inner, &agent_id, &message_id), "send_failed").await;
    log_chat_call(Some(&app), "enter", result.as_ref().map(|_| ()).map_err(|error| error.code), started.elapsed());
    match &result {
        Ok(receipt) => emit(&state.inner, DirectChatEvent::Send { receipt: receipt.clone() }),
        Err(error) => emit(&state.inner, DirectChatEvent::Error { operation: "enter", code: error.code }),
    }
    result
}

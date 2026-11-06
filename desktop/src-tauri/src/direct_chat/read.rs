use super::*;

pub(super) fn parse_json<T: for<'de> Deserialize<'de>>(
    result: ProcessResult,
    code: &'static str,
) -> Result<T, DirectChatError> {
    if !result.success() {
        return Err(failure(code));
    }
    serde_json::from_slice(&result.stdout).map_err(|_| failure(code))
}

#[tauri::command]
pub(crate) async fn direct_chat_read(
    app: tauri::AppHandle,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    cursor: Option<String>,
) -> Result<DirectChatPage, DirectChatError> {
    if !valid_agent(&agent_id)
        || cursor
            .as_ref()
            .is_some_and(|v| v.len() > 32 || !v.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(failure("invalid_request"));
    }
    let started = Instant::now();
    let expected = scopes.active().map_err(failure)?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let inner = Arc::clone(&state.inner);
    let agent_for_event = agent_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        with_connection_read(&inner, scope.scope(), |connection| {
            if connection.link == VpsLink::PerCommand && matches!(connection.validated, ValidatedHost::Vps { .. }) {
                return small_read(cursor.as_deref(), &mut |cursor| read_page(connection, &agent_id, cursor));
            }
            read_page(connection, &agent_id, cursor.as_deref())
        })
    })
    .await
    .map_err(|_| failure("read_failed"))?;
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    match result {
        Ok(page) => {
            log_chat_call(Some(&app), "read", Ok(()), started.elapsed());
            emit(
                &state.inner,
                DirectChatEvent::Messages {
                    agent_id: agent_for_event,
                    page: page.clone(),
                },
            );
            Ok(page)
        }
        Err(error) => {
            log_chat_call(Some(&app), "read", Err(error.code), started.elapsed());
            emit(
                &state.inner,
                DirectChatEvent::Error {
                    operation: "read",
                    code: error.code,
                },
            );
            Err(error)
        }
    }
}
/// One page of an agent's chat, from `cursor` (the server's tail of 128 KB without one), by the
/// fixed container script (local or pinned), the VPS host wrapper, or the older Python fallback.
pub(super) fn read_page(connection: &Connection, agent_id: &str, cursor: Option<&str>) -> Result<DirectChatPage, DirectChatError> {
    if uses_pinned_chat(connection) {
        let result = run_chat(connection, ChatOperation::Read { agent: agent_id, cursor }, None, READ_TIMEOUT, "read_failed")?;
        return parse_json::<DirectChatPage>(result, "read_failed");
    }
    if let Some(result) =
        run_wrapper_chat(connection, ChatOperation::Read { agent: agent_id, cursor }, None, READ_TIMEOUT, "read_failed")?
    {
        return parse_json::<DirectChatPage>(result, "read_failed");
    }
    // The host's wrapper is older than the chat actions: the older path.
    parse_json::<DirectChatPage>(
        run_python(connection, CHAT_READ_PY, &json!({"agent":agent_id,"cursor":cursor}), READ_TIMEOUT)?,
        "read_failed",
    )
}

/// The tail a first small read asks for: the last 32 KiB of the chat, not the server's 128 KiB.
pub(super) const SMALL_READ_TAIL: u64 = 32 * 1024;
/// How far before the cursor a later read starts: more than a whole line of the largest message
/// (4000 characters, 16 KB of UTF-8, plus its JSON).
pub(super) const SMALL_READ_OVERLAP: u64 = 20 * 1024;
/// A cursor past any chat (12 digits, the most the server takes): the server answers with no line
/// and its size as the cursor.
pub(super) const SMALL_READ_SIZE_PROBE: &str = "999999999999";

/// A read on the per-command link (Windows to a VPS), where every read is an ssh connection: what
/// passes stays small, about 50 KB at most, instead of the server's whole tail of 128 KiB at every
/// read. Nothing changes on the server, so the VPS already installed answer the same way.
/// - Without a cursor (the page's first read of an agent): the size, then the last 32 KiB.
/// - With the page's cursor: from 20 KiB before it. The server drops the line it lands inside, so
///   a cursor right at the start of a line would lose that line, and a line still being written at
///   the end would come back cut: the overlap reads them again whole, with the same ids (an absolute
///   offset or the message's own id), and the page merges them.
/// - A cursor the server answers with a smaller one (the chat got shorter): read again from the tail.
pub(super) fn small_read(
    cursor: Option<&str>,
    read: &mut dyn FnMut(Option<&str>) -> Result<DirectChatPage, DirectChatError>,
) -> Result<DirectChatPage, DirectChatError> {
    let at = |page: &DirectChatPage| page.cursor.as_deref().and_then(|cursor| cursor.parse::<u64>().ok());
    if let Some(kept) = cursor.and_then(|cursor| cursor.parse::<u64>().ok()) {
        let sent = kept.saturating_sub(SMALL_READ_OVERLAP);
        let page = read(Some(&sent.to_string()))?;
        if at(&page).is_some_and(|back| back >= sent) {
            return Ok(page);
        }
    }
    let size = at(&read(Some(SMALL_READ_SIZE_PROBE))?).ok_or_else(|| failure("read_failed"))?;
    read(Some(&size.saturating_sub(SMALL_READ_TAIL).to_string()))
}

use super::*;

/// The most a fixed script of the app may answer in one go: pages are about a megabyte, so this is far past one.
pub(super) const TEAM_SCRIPT_REPLY_MAX: usize = 4 * 1024 * 1024;

/// One read of the team through the chat's Python channel (this computer's team, an existing team's pinned
/// container, the VPS the app made): a fixed script of the app, one JSON request, one JSON reply. It is a
/// read, so it asks for no write gate and works in the read-only view; it needs the chat connected.
pub(crate) async fn team_script_read(
    state: &State<'_, DirectChatState>,
    scopes: &State<'_, AccountScopeState>,
    script: &'static str,
    request: Value,
    timeout: Duration,
) -> Result<Value, DirectChatError> {
    chat_scoped(
        state,
        scopes,
        move |inner, scope| {
            with_connection_read(inner, scope, |connection| {
                let result = run_python(connection, script, &request, timeout)?;
                if result.stdout.len() > TEAM_SCRIPT_REPLY_MAX {
                    return Err(failure("read_failed"));
                }
                let (exit, bytes) = (result.code, result.stdout.len());
                let parsed: Result<Value, DirectChatError> = parse_json(result, "read_failed");
                if parsed.is_err() {
                    // why the answer was no JSON (the wrapper's exit and how much it printed, never what), for the runtime log
                    if let Some(log) = connection.app.as_ref().and_then(crate::runtime_log::RuntimeLog::new) {
                        log.record_script_read_failure(exit, bytes);
                    }
                }
                parsed
            })
        },
        "read_failed",
    )
    .await
}

/// The same fixed-script channel for a change the person asked for (clearing their statistics): it is a write,
/// so the read-only view and a link that cannot write are refused here, in the native side, before anything runs.
pub(crate) async fn team_script_write(
    state: &State<'_, DirectChatState>,
    scopes: &State<'_, AccountScopeState>,
    script: &'static str,
    request: Value,
    timeout: Duration,
) -> Result<Value, DirectChatError> {
    chat_write(
        state,
        scopes,
        move |inner| {
            let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
            let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
            refuse_writing(connection)?;
            let result = run_python(connection, script, &request, timeout)?;
            if result.stdout.len() > TEAM_SCRIPT_REPLY_MAX {
                return Err(failure("read_failed"));
            }
            parse_json(result, "read_failed")
        },
        "read_failed",
    )
    .await
}
pub(super) const TEAM_LANGUAGES: [&str; 7] = ["en", "it", "hu", "es", "de", "fr", "pt"];

/// The language the team speaks (`locale`), what its file says (`stored`, none while the file is
/// missing or unreadable) and, after a `set`, whether it was written (`changed`).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct TeamLanguage {
    pub(super) locale: String,
    pub(super) stored: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) changed: Option<bool>,
}

/// A reply of the script is trusted only for what it is: one of the seven languages, in both fields.
pub(super) fn checked_team_language(reply: TeamLanguage) -> Option<TeamLanguage> {
    let known = |code: &str| TEAM_LANGUAGES.contains(&code);
    (known(&reply.locale) && reply.stored.as_deref().map_or(true, known)).then_some(reply)
}

pub(super) fn team_language_impl(
    inner: &DirectChatInner,
    request: Value,
    write: bool,
    default: &'static str,
) -> Result<TeamLanguage, DirectChatError> {
    let _serial = inner.send_lock.lock().map_err(|_| failure("state_failed"))?;
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    if write {
        refuse_writing(connection)?;
    }
    let reply: TeamLanguage = parse_json(run_python(connection, TEAM_LANGUAGE_PY, &request, READ_TIMEOUT)?, default)?;
    checked_team_language(reply).ok_or_else(|| failure(default))
}

/// The language of the team this chat is connected to. Read only: it works in the read-only view too.
#[tauri::command]
pub(crate) async fn direct_chat_team_language(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<TeamLanguage, DirectChatError> {
    chat_write(
        &state,
        &scopes,
        |inner| team_language_impl(inner, json!({"op": "read"}), false, "read_failed"),
        "read_failed",
    )
    .await
}

/// Sets the team's language through the same file the game's language setting writes. Without
/// `choose` (the app following the language said on its first screen) it writes only over the English
/// the team starts with: a language already chosen is never replaced (`changed: false`). With `choose`
/// it is the person's own answer, and it replaces the team's language. Only the app's own window may
/// ask, and a team the app may not write to (the read-only view, a VPS not yet claimed) refuses as every
/// other write does.
#[tauri::command]
pub(crate) async fn direct_chat_team_language_set(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    locale: String,
    choose: Option<bool>,
) -> Result<TeamLanguage, DirectChatError> {
    if !window_may_write(window.label()) || !TEAM_LANGUAGES.contains(&locale.as_str()) {
        return Err(failure("invalid_request"));
    }
    let op = if choose == Some(true) { "choose" } else { "set" };
    chat_write(
        &state,
        &scopes,
        move |inner| team_language_impl(inner, json!({"op": op, "locale": locale}), true, "persist_failed"),
        "persist_failed",
    )
    .await
}

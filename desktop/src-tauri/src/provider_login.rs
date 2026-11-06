//! Whether the provider's sign-in of the team still works, asked of the team itself, and never answered by «the file is there».
//!
//! The app sends a fixed script (`provider_login_state.py`) through the chat's Python channel. The script reads the provider's
//! credentials INSIDE the team's container and answers one word; nothing of what it read leaves the container: no token, no
//! date, no line of an agent's terminal. The word is closed again here before the page sees it. Reading works in the read-only
//! view; the sign-in itself is not this module's (it is the setup's own login command, which needs no setup around it).
use crate::{
    account_scope::AccountScopeState,
    direct_chat::{failure, team_script_read, DirectChatError, DirectChatState},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

const TIMEOUT: Duration = Duration::from_secs(20);

/// The fixed script. It sits in a file of its own so that its behaviour is tested by running it (tests/test_provider_login_state.py).
pub(crate) const PROVIDER_LOGIN_PY: &str = include_str!("provider_login_state.py");

/// What the script may say, and nothing else reaches the page:
/// `ready` the sign-in is there and nothing says it fails; `probably_expired` it is there but old enough that it is
/// worth signing in again (the team keeps working); `expired` an agent of the team was refused after the last sign-in;
/// `missing` there is no sign-in; `unreadable` there is a file and it is no sign-in; `not_applicable` the team uses no
/// subscription sign-in (an API key, or no provider yet).
const STATES: &[&str] = &["ready", "probably_expired", "expired", "missing", "unreadable", "not_applicable"];

/// The codes this reading may leave in the runtime log: its own, then the chat's (`log.record_read_failure`).
const LOGIN_CODES: &[&str] = &["provider_login_unreadable", "provider_login_reply_unexpected"];

/// What the page gets: `ok: true` and one state, or `ok: false` and a closed code.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderLoginReply {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<&'static str>,
    /// Which provider the team signs in to: `claude`, `codex`, `kimi`, or `none`.
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

impl ProviderLoginReply {
    fn failed(code: &'static str) -> Self {
        ProviderLoginReply { ok: false, state: None, provider: None, error: Some(code) }
    }
}

/// Which provider the sign-in is of.
const PROVIDERS: &[&str] = &["claude", "codex", "kimi", "none"];

/// The team's answer closed again: one of the listed words and one of the listed providers, or the whole answer is refused.
fn shape(reply: &Value) -> Result<(&'static str, &'static str), ()> {
    let object = reply.as_object().ok_or(())?;
    if object.len() != 3 || object.get("ok") != Some(&Value::Bool(true)) {
        return Err(());
    }
    let said = object.get("state").and_then(Value::as_str).ok_or(())?;
    let provider = object.get("provider").and_then(Value::as_str).ok_or(())?;
    let state = STATES.iter().copied().find(|state| *state == said).ok_or(())?;
    let provider = PROVIDERS.iter().copied().find(|name| *name == provider).ok_or(())?;
    Ok((state, provider))
}

fn code_of(reply: &Value) -> &'static str {
    let said = reply.get("error").and_then(Value::as_str);
    LOGIN_CODES.iter().copied().find(|code| Some(*code) == said).unwrap_or("provider_login_unreadable")
}

/// The state of the provider's sign-in. Only the main window asks. A read that does not give a state leaves its closed code
/// in the runtime log (never what the team said), and the page is told that same code.
#[tauri::command]
pub(crate) async fn provider_login_state(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<ProviderLoginReply, DirectChatError> {
    if window.label() != "main" {
        return Err(failure("invalid_request"));
    }
    let result = read_state(&state, &scopes).await;
    let said = match &result {
        Ok(reply) => reply.error,
        Err(error) => Some(error.code),
    };
    if let (Some(code), Some(log)) = (said, crate::runtime_log::RuntimeLog::new(&app)) {
        log.record_read_failure("login.read", LOGIN_CODES, code);
    }
    result
}

async fn read_state(state: &State<'_, DirectChatState>, scopes: &State<'_, AccountScopeState>) -> Result<ProviderLoginReply, DirectChatError> {
    let reply = team_script_read(state, scopes, PROVIDER_LOGIN_PY, json!({"op": "state"}), TIMEOUT).await?;
    if reply.get("ok") != Some(&Value::Bool(true)) {
        return Ok(ProviderLoginReply::failed(code_of(&reply)));
    }
    Ok(match shape(&reply) {
        Ok((word, provider)) => ProviderLoginReply { ok: true, state: Some(word), provider: Some(provider), error: None },
        Err(()) => ProviderLoginReply::failed("provider_login_reply_unexpected"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_listed_words_pass_and_nothing_else_comes_with_them() {
        for word in STATES {
            assert_eq!(shape(&json!({"ok": true, "state": word, "provider": "codex"})), Ok((*word, "codex")));
        }
        for name in PROVIDERS {
            assert_eq!(shape(&json!({"ok": true, "state": "ready", "provider": name})), Ok(("ready", *name)));
        }
        // an unknown word or provider, a missing one, a longer answer (a token, a line of a terminal), a wrong type: all refused
        assert_eq!(shape(&json!({"ok": true, "state": "rm -rf / or a sentence", "provider": "codex"})), Err(()));
        assert_eq!(shape(&json!({"ok": true, "state": "ready", "provider": "a sentence"})), Err(()));
        assert_eq!(shape(&json!({"ok": true, "state": "ready"})), Err(()));
        assert_eq!(shape(&json!({"ok": true, "provider": "codex"})), Err(()));
        assert_eq!(shape(&json!({"ok": true, "state": "ready", "provider": "codex", "token": "x"})), Err(()));
        assert_eq!(shape(&json!({"ok": true, "state": 1, "provider": "codex"})), Err(()));
        assert_eq!(shape(&json!(["ready"])), Err(()));
        assert_eq!(shape(&json!({"ok": false, "state": "ready", "provider": "codex"})), Err(()));
    }

    #[test]
    fn a_code_the_script_does_not_own_is_the_generic_one() {
        assert_eq!(code_of(&json!({"ok": false, "error": "provider_login_unreadable"})), "provider_login_unreadable");
        assert_eq!(code_of(&json!({"ok": false, "error": "rm -rf / or a sentence"})), "provider_login_unreadable");
        assert_eq!(code_of(&json!({"ok": false})), "provider_login_unreadable");
    }

    #[test]
    fn the_reply_to_the_page_is_camel_case_with_only_what_it_has() {
        let ok = serde_json::to_value(ProviderLoginReply { ok: true, state: Some("expired"), provider: Some("codex"), error: None }).unwrap();
        assert_eq!(ok, json!({"ok": true, "state": "expired", "provider": "codex"}));
        let bad = serde_json::to_value(ProviderLoginReply::failed("disconnected")).unwrap();
        assert_eq!(bad, json!({"ok": false, "error": "disconnected"}));
    }

    /// The script sent is the file, and it reads credentials without ever printing them: no line of it prints anything but
    /// the closed answer.
    #[test]
    fn the_script_answers_with_one_word_and_prints_nothing_else() {
        assert!(PROVIDER_LOGIN_PY.contains("def emit(state)") && PROVIDER_LOGIN_PY.contains("def fail(code)"));
        assert_eq!(PROVIDER_LOGIN_PY.matches("print(").count(), 2);
    }
}

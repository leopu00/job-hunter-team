//! The user's judgement on a position, written on an existing team's VPS.
//!
//! One typed command, one fixed script in the pinned container
//! (`shared/skills/position_judgement.py`), never the generic Python runner.
//! Before any network call the request is checked here:
//! - it comes from the `main` window only;
//! - its fields are closed (a numeric id, values from fixed sets, a reason code
//!   of lowercase letters, a note of at most NOTE_MAX_BYTES);
//! - an application needs `confirmed`;
//! - it names the connection the view was opened on (`connectionKey`): another
//!   one is `existing_team_runtime_target_changed`;
//! - the team must be connected IN FULL in this session of the app.
//!
//! Every argument of the remote command comes from a closed set; the note, the
//! only free text, goes on stdin as one JSON line and never in the command.

use crate::{
    account_scope::{AccountScope, AccountScopeState},
    direct_chat,
    existing_team_runtime::{command, connection_key, full_link_granted, selected, ActivatedTarget, RuntimeTarget},
    runtime_host::{run_ssh_command, ProcessResult},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

const SCRIPT: &str = "/app/shared/skills/position_judgement.py";
/// The script reads one line of stdin of at most 4 KiB; a longer note is refused here.
pub(crate) const NOTE_MAX_BYTES: usize = 4000;
const WRITE_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum FeedbackValue {
    Like,
    Dislike,
    Hide,
    Clear,
}

impl FeedbackValue {
    fn as_str(self) -> &'static str {
        match self {
            Self::Like => "like",
            Self::Dislike => "dislike",
            Self::Hide => "hide",
            Self::Clear => "clear",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum JudgementRequest {
    Feedback {
        id: String,
        value: FeedbackValue,
        reason: Option<String>,
        note: Option<String>,
        #[serde(rename = "connectionKey")]
        connection_key: String,
    },
    Exclude {
        id: String,
        reason: String,
        note: Option<String>,
        #[serde(rename = "connectionKey")]
        connection_key: String,
    },
    Restore {
        id: String,
        #[serde(rename = "connectionKey")]
        connection_key: String,
    },
    Note {
        id: String,
        text: String,
        #[serde(rename = "connectionKey")]
        connection_key: String,
    },
    WriteRequest {
        id: String,
        on: bool,
        #[serde(rename = "connectionKey")]
        connection_key: String,
    },
    ApplyRequest {
        id: String,
        on: bool,
        confirmed: bool,
        #[serde(rename = "connectionKey")]
        connection_key: String,
    },
    Recheck {
        id: String,
        on: bool,
        #[serde(rename = "connectionKey")]
        connection_key: String,
    },
}

fn valid_id(id: &str) -> bool {
    (1..=15).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit()) && !id.starts_with('0')
}

/// A code of the closed vocabulary has this shape; which codes exist the script decides.
fn valid_reason(reason: &str) -> bool {
    (1..=32).contains(&reason.len()) && reason.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
}

impl JudgementRequest {
    fn connection_key(&self) -> &str {
        match self {
            Self::Feedback { connection_key, .. }
            | Self::Exclude { connection_key, .. }
            | Self::Restore { connection_key, .. }
            | Self::Note { connection_key, .. }
            | Self::WriteRequest { connection_key, .. }
            | Self::ApplyRequest { connection_key, .. }
            | Self::Recheck { connection_key, .. } => connection_key,
        }
    }

    fn id(&self) -> &str {
        match self {
            Self::Feedback { id, .. }
            | Self::Exclude { id, .. }
            | Self::Restore { id, .. }
            | Self::Note { id, .. }
            | Self::WriteRequest { id, .. }
            | Self::ApplyRequest { id, .. }
            | Self::Recheck { id, .. } => id,
        }
    }

    fn note(&self) -> Option<&str> {
        match self {
            Self::Feedback { note, .. } | Self::Exclude { note, .. } => note.as_deref(),
            Self::Note { text, .. } => Some(text),
            _ => None,
        }
    }

    /// Everything that can be refused without the VPS.
    pub(crate) fn check(&self) -> Result<(), &'static str> {
        if !valid_id(self.id()) {
            return Err("position_write_request_invalid");
        }
        match self {
            Self::Feedback { reason: Some(reason), .. } | Self::Exclude { reason, .. } if !valid_reason(reason) => {
                return Err("reason_invalid")
            }
            Self::ApplyRequest { on: true, confirmed: false, .. } => return Err("position_write_not_confirmed"),
            _ => {}
        }
        if self.note().is_some_and(|note| note.len() > NOTE_MAX_BYTES) {
            return Err("note_too_long");
        }
        Ok(())
    }

    /// The script's arguments: every one from a closed set or already checked above.
    pub(crate) fn argv(&self) -> Vec<String> {
        let switch = |on: bool| if on { "--on" } else { "--off" }.to_owned();
        let mut argv = match self {
            Self::Feedback { id, value, reason, note, .. } => {
                let mut argv = vec!["feedback".into(), id.clone(), "--value".into(), value.as_str().into()];
                if let Some(reason) = reason {
                    argv.extend(["--reason".into(), reason.clone()]);
                }
                if note.is_some() {
                    argv.push("--note-on-stdin".into());
                }
                argv
            }
            Self::Exclude { id, reason, note, .. } => {
                let mut argv = vec!["exclude".into(), id.clone(), "--reason".into(), reason.clone()];
                if note.is_some() {
                    argv.push("--note-on-stdin".into());
                }
                argv
            }
            Self::Restore { id, .. } => vec!["restore".into(), id.clone()],
            Self::Note { id, .. } => vec!["note".into(), id.clone()],
            Self::WriteRequest { id, on, .. } => vec!["write-request".into(), id.clone(), switch(*on)],
            Self::ApplyRequest { id, on, .. } => vec!["apply-request".into(), id.clone(), switch(*on)],
            Self::Recheck { id, on, .. } => vec!["recheck".into(), id.clone(), switch(*on)],
        };
        argv.shrink_to_fit();
        argv
    }

    /// The note as the script reads it: one JSON line on stdin.
    pub(crate) fn stdin(&self) -> Option<Vec<u8>> {
        self.note().map(|note| {
            let mut line = serde_json::to_vec(&json!({ "note": note })).unwrap_or_default();
            line.push(b'\n');
            line
        })
    }
}

/// The remote command: the pinned container's checks (`command`), then the fixed script.
pub(crate) fn judgement_command(target: &RuntimeTarget, request: &JudgementRequest) -> Result<String, &'static str> {
    let args: Vec<String> = request.argv().into_iter().map(|arg| format!("'{arg}'")).collect();
    command(target, &format!("exec docker exec -i \"$JHT_CID\" python3 {SCRIPT} {}", args.join(" ")))
}

fn failure(code: &'static str) -> Value {
    json!({ "ok": false, "error": code })
}

fn closed_code(value: Option<&Value>) -> Option<String> {
    let code = value?.as_str()?;
    ((1..=64).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'))
        .then(|| code.to_owned())
}

/// What the script answered, as the renderer may read it.
pub(crate) fn reply(result: Result<ProcessResult, &'static str>) -> Value {
    let Ok(result) = result else {
        return failure("existing_team_unavailable");
    };
    if result.code == 70 {
        return failure("existing_team_runtime_changed");
    }
    if result.code == 255 {
        return failure("ssh_unavailable");
    }
    let line: Option<Value> = String::from_utf8_lossy(&result.stdout)
        .lines()
        .last()
        .and_then(|line| serde_json::from_str(line).ok());
    match (result.code, line) {
        (0, Some(Value::Object(mut out))) if out.get("ok") == Some(&Value::Bool(true)) => {
            out.retain(|key, _| key != "detail");
            Value::Object(out)
        }
        (1, Some(out)) => match closed_code(out.get("code")) {
            Some(code) => json!({ "ok": false, "error": code }),
            None => failure("existing_team_unavailable"),
        },
        (2, Some(out)) if out.get("code") == Some(&Value::from("request_invalid")) => {
            failure("position_write_request_invalid")
        }
        // No JSON at all: a container without the script (or older than it).
        _ => failure("existing_team_runtime_outdated"),
    }
}

/// THE one place this command asks whether the team on the VPS is connected in
/// full in this session of the app. The shared state of the full connection is
/// written only when «Connect and confirm» succeeds, bound to the account scope and
/// the candidate (the connection key), for this session only: the read-only view,
/// a reopen and a restart of the app never hold it, so they stay read-only.
fn full_connection(scope: &AccountScope, target: &ActivatedTarget) -> Result<(), &'static str> {
    if full_link_granted(scope, target) {
        Ok(())
    } else {
        Err("position_write_read_only")
    }
}

/// The whole decision, with the app-bound steps injected (the order the tests drive).
pub(crate) fn position_write_with(
    request: Value,
    window_is_main: bool,
    current_key: impl FnOnce() -> Result<String, &'static str>,
    full: impl FnOnce(&str) -> Result<(), &'static str>,
    run: impl FnOnce(&JudgementRequest) -> Result<ProcessResult, &'static str>,
) -> Value {
    if !window_is_main {
        return failure("position_write_window_refused");
    }
    let Ok(request) = serde_json::from_value::<JudgementRequest>(request) else {
        return failure("position_write_request_invalid");
    };
    if let Err(code) = request.check() {
        return failure(code);
    }
    let key = match current_key() {
        Ok(key) => key,
        Err(code) => return failure(code),
    };
    if request.connection_key() != key {
        return failure("existing_team_runtime_target_changed");
    }
    if let Err(code) = full(&key) {
        return failure(code);
    }
    reply(run(&request))
}

#[tauri::command]
pub(crate) async fn existing_team_position_write(
    app: tauri::AppHandle,
    window: tauri::Window,
    scopes: State<'_, AccountScopeState>,
    request: Value,
) -> Result<Value, String> {
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(failure("account_scope_unavailable")),
    };
    let window_is_main = window.label() == "main";
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state.lock_expected(&worker_expected).map_err(|_| "account_scope_changed")?;
        let scope = &worker_expected;
        let target: std::cell::RefCell<Option<ActivatedTarget>> = std::cell::RefCell::new(None);
        let validated = std::cell::RefCell::new(None);
        Ok(position_write_with(
            request,
            window_is_main,
            || {
                let host = direct_chat::load_persisted_host(&app, scope)?;
                let checked = crate::runtime_host::validate_host_for_scope(&app, &host, scope)?;
                let found = selected(&app, scope, &host)?.ok_or("existing_team_runtime_required")?;
                let key = connection_key(scope, &found);
                *target.borrow_mut() = Some(found);
                *validated.borrow_mut() = Some(checked);
                Ok(key)
            },
            |_key| match target.borrow().as_ref() {
                Some(found) => full_connection(scope, found),
                None => Err("existing_team_unavailable"),
            },
            |request| {
                let target = target.borrow();
                let validated = validated.borrow();
                let (Some(target), Some(validated)) = (target.as_ref(), validated.as_ref()) else {
                    return Err("existing_team_unavailable");
                };
                let remote = judgement_command(&target.runtime, request)?;
                run_ssh_command(validated, &remote, request.stdin().as_deref(), WRITE_TIMEOUT, None)
            },
        ))
    })
    .await
    .unwrap_or_else(|_| Err("existing_team_unavailable"));
    if scopes.lock_expected(&expected).is_err() {
        return Ok(failure("account_scope_changed"));
    }
    Ok(result.unwrap_or_else(failure))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const KEY: &str = "a1b2";
    const SENTINEL: &str = "SENTINELLA-nota-privata-7f3a";

    fn target() -> RuntimeTarget {
        serde_json::from_value(json!({
            "container_id": "a".repeat(64),
            "image_id": format!("sha256:{}", "b".repeat(64)),
            "platform_image_id": format!("sha256:{}", "c".repeat(64)),
            "oci_revision": "d".repeat(40),
            "digest": format!("sha256:{}", "e".repeat(64)),
            "os": "linux",
            "architecture": "amd64",
        }))
        .unwrap()
    }

    fn write(request: Value, full: Result<(), &'static str>, ran: &Cell<bool>) -> Value {
        position_write_with(request, true, || Ok(KEY.to_owned()), |_| full, |_| {
            ran.set(true);
            Ok(ProcessResult { code: 0, stdout: br#"{"ok":true,"op":"feedback","id":12}"#.to_vec() })
        })
    }

    fn feedback() -> Value {
        json!({"op":"feedback","id":"12","value":"dislike","reason":"too_senior","note":SENTINEL,"connectionKey":KEY})
    }

    #[test]
    fn a_full_connection_writes_and_returns_the_script_reply() {
        let ran = Cell::new(false);
        assert_eq!(write(feedback(), Ok(()), &ran)["ok"], true);
        assert!(ran.get());
    }

    #[test]
    fn without_a_full_connection_nothing_reaches_the_vps() {
        let ran = Cell::new(false);
        assert_eq!(write(feedback(), Err("position_write_read_only"), &ran)["error"], "position_write_read_only");
        assert!(!ran.get());
    }

    #[test]
    fn only_the_confirmed_team_of_this_run_may_write() {
        use crate::existing_team_runtime::{grant_full_link, revoke_full_link, FULL_LINK_TEST_LOCK};
        let _serial = FULL_LINK_TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let (scope, other) = (AccountScope::synthetic(b"scope-one"), AccountScope::synthetic(b"scope-two"));
        let found = ActivatedTarget::synthetic_for_tests();
        let attempt = |scope: &AccountScope| {
            let ran = Cell::new(false);
            let out = position_write_with(feedback(), true, || Ok(KEY.into()), |_| full_connection(scope, &found), |_| {
                ran.set(true);
                Ok(ProcessResult { code: 0, stdout: br#"{"ok":true,"op":"feedback","id":12}"#.to_vec() })
            });
            (out, ran.get())
        };
        // read-only view, reopen, restart: nothing granted, nothing reaches the VPS
        revoke_full_link();
        let (out, ran) = attempt(&scope);
        assert_eq!(out["error"], "position_write_read_only");
        assert!(!ran);
        // «Conferma e collega» succeeded for this account and this candidate
        grant_full_link(&scope, &found);
        let (out, ran) = attempt(&scope);
        assert_eq!(out["ok"], true);
        assert!(ran);
        // another account never writes with it
        let (out, ran) = attempt(&other);
        assert_eq!(out["error"], "position_write_read_only");
        assert!(!ran);
        revoke_full_link();
        assert_eq!(attempt(&scope).0["error"], "position_write_read_only");
    }

    #[test]
    fn another_window_or_another_connection_is_refused_before_anything_runs() {
        let ran = Cell::new(false);
        let out = position_write_with(feedback(), false, || Ok(KEY.into()), |_| Ok(()), |_| {
            ran.set(true);
            Err("x")
        });
        assert_eq!(out["error"], "position_write_window_refused");
        let out = position_write_with(feedback(), true, || Ok("another".into()), |_| Ok(()), |_| {
            ran.set(true);
            Err("x")
        });
        assert_eq!(out["error"], "existing_team_runtime_target_changed");
        assert!(!ran.get());
    }

    #[test]
    fn closed_fields_are_checked_without_the_vps() {
        for (request, code) in [
            (json!({"op":"feedback","id":"01","value":"like","connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"feedback","id":"1;rm","value":"like","connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"feedback","id":"1","value":"star","connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"feedback","id":"1","value":"like","host":"x","connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"run","id":"1","connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"exclude","id":"1","reason":"Too Senior","connectionKey":KEY}), "reason_invalid"),
            (json!({"op":"exclude","id":"1","reason":"other'; reboot","connectionKey":KEY}), "reason_invalid"),
            (json!({"op":"apply_request","id":"1","on":true,"confirmed":false,"connectionKey":KEY}), "position_write_not_confirmed"),
            (json!({"op":"note","id":"1","text":"x".repeat(NOTE_MAX_BYTES + 1),"connectionKey":KEY}), "note_too_long"),
        ] {
            let ran = Cell::new(false);
            assert_eq!(write(request.clone(), Ok(()), &ran)["error"], code, "{request}");
            assert!(!ran.get(), "{request}");
        }
        // withdrawing an application needs no confirmation
        let ran = Cell::new(false);
        let withdraw = json!({"op":"apply_request","id":"1","on":false,"confirmed":false,"connectionKey":KEY});
        assert_eq!(write(withdraw, Ok(()), &ran)["ok"], true);
    }

    #[test]
    fn the_note_travels_on_stdin_and_never_in_the_remote_command() {
        let request: JudgementRequest = serde_json::from_value(feedback()).unwrap();
        let remote = judgement_command(&target(), &request).unwrap();
        assert!(!remote.contains(SENTINEL));
        assert!(remote.ends_with(
            "exec docker exec -i \"$JHT_CID\" python3 /app/shared/skills/position_judgement.py 'feedback' '12' '--value' 'dislike' '--reason' 'too_senior' '--note-on-stdin'"
        ));
        assert!(remote.contains("|| exit 70"), "the pinned container's checks come first");
        let stdin = request.stdin().unwrap();
        assert_eq!(stdin.iter().filter(|b| **b == b'\n').count(), 1);
        assert_eq!(serde_json::from_slice::<Value>(&stdin).unwrap(), json!({"note": SENTINEL}));
        // the note box too; and an operation without a note sends nothing on stdin
        let note: JudgementRequest =
            serde_json::from_value(json!({"op":"note","id":"3","text":"a\nb","connectionKey":KEY})).unwrap();
        assert!(!judgement_command(&target(), &note).unwrap().contains("a\nb"));
        let restore: JudgementRequest =
            serde_json::from_value(json!({"op":"restore","id":"3","connectionKey":KEY})).unwrap();
        assert_eq!(restore.stdin(), None);
        assert!(!judgement_command(&target(), &restore).unwrap().contains("python_command"));
    }

    #[test]
    fn every_operation_has_its_closed_argv() {
        for (request, argv) in [
            (json!({"op":"exclude","id":"4","reason":"other","connectionKey":KEY}), vec!["exclude", "4", "--reason", "other"]),
            (json!({"op":"restore","id":"4","connectionKey":KEY}), vec!["restore", "4"]),
            (json!({"op":"write_request","id":"4","on":true,"connectionKey":KEY}), vec!["write-request", "4", "--on"]),
            (json!({"op":"apply_request","id":"4","on":true,"confirmed":true,"connectionKey":KEY}), vec!["apply-request", "4", "--on"]),
            (json!({"op":"recheck","id":"4","on":false,"connectionKey":KEY}), vec!["recheck", "4", "--off"]),
            (json!({"op":"feedback","id":"4","value":"clear","connectionKey":KEY}), vec!["feedback", "4", "--value", "clear"]),
        ] {
            let request: JudgementRequest = serde_json::from_value(request).unwrap();
            assert_eq!(request.argv(), argv);
        }
    }

    #[test]
    fn the_reply_is_read_as_a_closed_answer() {
        let run = |code: i32, stdout: &str| reply(Ok(ProcessResult { code, stdout: stdout.as_bytes().to_vec() }));
        assert_eq!(run(0, r#"{"ok":true,"op":"restore","id":4,"status":"scored"}"#)["status"], "scored");
        assert_eq!(run(1, r#"{"ok":false,"code":"consent_absent","detail":"x"}"#), json!({"ok":false,"error":"consent_absent"}));
        assert_eq!(run(1, r#"{"ok":false,"code":"<b>bad</b>"}"#)["error"], "existing_team_unavailable");
        assert_eq!(run(2, r#"{"ok":false,"code":"request_invalid"}"#)["error"], "position_write_request_invalid");
        assert_eq!(run(2, "python3: can't open file '/app/shared/skills/position_judgement.py'")["error"], "existing_team_runtime_outdated");
        assert_eq!(run(70, "")["error"], "existing_team_runtime_changed");
        assert_eq!(run(255, "")["error"], "ssh_unavailable");
        assert_eq!(reply(Err("process_timeout"))["error"], "existing_team_unavailable");
    }
}

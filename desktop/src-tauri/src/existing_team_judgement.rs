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
    Star,
    Clear,
}

impl FeedbackValue {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Like => "like",
            Self::Dislike => "dislike",
            Self::Hide => "hide",
            Self::Star => "star",
            Self::Clear => "clear",
        }
    }
}

/// The page's «more like this» / «less like this», as feedback_record takes it.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FeedbackDirection {
    MoreLikeThis,
    LessLikeThis,
}

impl FeedbackDirection {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::MoreLikeThis => "more_like_this",
            Self::LessLikeThis => "less_like_this",
        }
    }
}

/// What the Writer is asked for: the CV, or the cover letter (which needs an application).
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WriteKind {
    Cv,
    CoverLetter,
}

impl WriteKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Cv => "cv",
            Self::CoverLetter => "cover_letter",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum JudgementRequest {
    Feedback {
        id: String,
        value: FeedbackValue,
        /// The page's verdict as a score from 1 to 5, when it sends one.
        #[serde(default)]
        score: Option<u8>,
        #[serde(default)]
        direction: Option<FeedbackDirection>,
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
        #[serde(default)]
        kind: Option<WriteKind>,
        #[serde(rename = "connectionKey")]
        connection_key: String,
    },
    ApplyRequest {
        id: String,
        on: bool,
        confirmed: bool,
        /// The digest of the preview the person confirmed (`apply_preview`): an authorisation
        /// carries it back, and the script refuses it if the position changed in between.
        #[serde(default)]
        confirm: Option<String>,
        #[serde(rename = "connectionKey")]
        connection_key: String,
    },
    /// What the person confirms before authorising: «title @ company · host». Nothing is written.
    ApplyPreview {
        id: String,
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

/// A sha-256 in lowercase hex: the preview's digest.
fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// What the broker records for an authorisation the app wrote: the position, the instant of the
/// write (the box's fixed format) and the closed destination of the preview the person confirmed.
/// Every field is checked here again, because it goes on a command line; the broker checks it too.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BrokerRecord {
    id: String,
    instant: String,
    destination: String,
}

fn valid_instant(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 24
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            10 => *c == b'T',
            13 | 16 => *c == b':',
            19 => *c == b'.',
            23 => *c == b'Z',
            _ => c.is_ascii_digit(),
        })
}

fn valid_destination(value: &str) -> bool {
    let domain = |rest: &str| {
        (3..=253).contains(&rest.len())
            && rest.contains('.')
            && rest.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
            && !rest.starts_with(['.', '-'])
            && !rest.ends_with(['.', '-'])
    };
    match value.split_once(':') {
        Some(("web" | "email", rest)) => domain(rest),
        Some(("portal", name)) => (2..=20).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_lowercase()),
        _ => false,
    }
}

impl BrokerRecord {
    fn from_reply(id: &str, reply: &Value) -> Option<Self> {
        let instant = reply.get("instant")?.as_str()?;
        let destination = reply.get("destination")?.as_str()?;
        (valid_id(id) && valid_instant(instant) && valid_destination(destination)).then(|| Self {
            id: id.to_owned(),
            instant: instant.to_owned(),
            destination: destination.to_owned(),
        })
    }
}

/// The broker of the SAME team as the pinned container (its compose project), running the same
/// image as its own uid, and in it the host-only command that records the authorisation. Any
/// other shape stops with 71 before the exec.
const BROKER_RECORD: &str = r#"JHT_PROJECT="$("$JHT_ENGINE" inspect --type container --format '{{index .Config.Labels "com.docker.compose.project"}}' "$JHT_CID")" || exit 71
case "$JHT_PROJECT" in ''|*[!A-Za-z0-9_.-]*) exit 71 ;; esac
JHT_BROKER="$("$JHT_ENGINE" ps -q --no-trunc --filter "label=com.docker.compose.project=$JHT_PROJECT" --filter label=com.docker.compose.service=jht-broker)" || exit 71
case "$JHT_BROKER" in ''|*[!0-9a-f]*) exit 71 ;; esac
JHT_BROKER_SEEN="$("$JHT_ENGINE" inspect --type container --format '{{.State.Running}}|{{.Config.User}}|{{.Image}}' "$JHT_BROKER")" || exit 71
case "$JHT_BROKER_SEEN" in "true|1002:1002|$JHT_IMAGE"|"true|1002:1002|${JHT_IMAGE#sha256:}") ;; *) exit 71 ;; esac
exec "$JHT_ENGINE" exec "$JHT_BROKER" jht-broker-admin apply record "#;

pub(crate) fn broker_record_command(target: &RuntimeTarget, record: &BrokerRecord) -> Result<String, &'static str> {
    command(target, &format!("{BROKER_RECORD}'{}' '{}' '{}'", record.id, record.instant, record.destination))
}

/// What the broker answered to `apply record`: recorded, or the same record again.
fn broker_recorded(result: Result<ProcessResult, &'static str>) -> bool {
    let Ok(result) = result else { return false };
    let line: Option<Value> = String::from_utf8_lossy(&result.stdout).lines().last().and_then(|l| serde_json::from_str(l).ok());
    result.code == 0
        && line.as_ref().and_then(|l| l.get("status")).and_then(Value::as_str).is_some_and(|s| s == "recorded" || s == "already_recorded")
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
            | Self::ApplyPreview { connection_key, .. }
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
            | Self::ApplyPreview { id, .. }
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
            Self::ApplyRequest { on: true, confirm, .. } if !confirm.as_deref().is_some_and(valid_digest) => {
                return Err("position_write_not_confirmed")
            }
            Self::Feedback { score: Some(score), .. } if !(1..=5).contains(score) => {
                return Err("position_write_request_invalid")
            }
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
            Self::Feedback { id, value, score, direction, reason, note, .. } => {
                let mut argv = vec!["feedback".into(), id.clone(), "--value".into(), value.as_str().into()];
                if let Some(score) = score {
                    argv.extend(["--score".into(), score.to_string()]);
                }
                if let Some(direction) = direction {
                    argv.extend(["--direction".into(), direction.as_str().into()]);
                }
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
            Self::WriteRequest { id, on, kind, .. } => {
                let mut argv = vec!["write-request".into(), id.clone(), switch(*on)];
                if let Some(kind) = kind {
                    argv.extend(["--kind".into(), kind.as_str().into()]);
                }
                argv
            }
            Self::ApplyRequest { id, on: true, confirm, .. } => vec![
                "apply-request".into(),
                id.clone(),
                switch(true),
                "--expect".into(),
                confirm.clone().unwrap_or_default(),
            ],
            Self::ApplyRequest { id, on: false, .. } => vec!["apply-request".into(), id.clone(), switch(false)],
            Self::ApplyPreview { id, .. } => vec!["apply-preview".into(), id.clone()],
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
    command(target, &format!("exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 {SCRIPT} {}", args.join(" ")))
}

pub(crate) fn failure(code: &'static str) -> Value {
    json!({ "ok": false, "error": code })
}

fn closed_code(value: Option<&Value>) -> Option<String> {
    let code = value?.as_str()?;
    ((1..=64).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'))
        .then(|| code.to_owned())
}

/// What the script answered, as the renderer may read it.
pub(crate) fn reply(result: Result<ProcessResult, &'static str>) -> Value {
    if let Some(code) = crate::runtime_host::ssh_way_in_code(&result) {
        return failure(code);
    }
    let Ok(result) = result else {
        return failure("existing_team_unavailable");
    };
    if result.code == 70 {
        return failure("existing_team_runtime_changed");
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
pub(crate) fn full_connection(scope: &AccountScope, target: &ActivatedTarget) -> Result<(), &'static str> {
    if full_link_granted(scope, target) {
        Ok(())
    } else {
        Err("position_write_read_only")
    }
}

/// The whole decision, with the app-bound steps injected (the order the tests drive).
///
/// An authorisation to apply is written twice: the flag the pages show (the script in the team's
/// container) and the record in the team's broker, which is what the CLOSER checks before it
/// sends (`record`, from the host: the agents' container cannot record there). If the broker does
/// not record it, the flag is withdrawn again and the person is told: nothing would go out.
pub(crate) fn position_write_with(
    request: Value,
    window_is_main: bool,
    current_key: impl FnOnce() -> Result<String, &'static str>,
    full: impl FnOnce(&str) -> Result<(), &'static str>,
    mut run: impl FnMut(&JudgementRequest) -> Result<ProcessResult, &'static str>,
    record: impl FnOnce(&BrokerRecord) -> Result<ProcessResult, &'static str>,
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
    let mut out = reply(run(&request));
    if let JudgementRequest::ApplyRequest { id, on: true, connection_key, .. } = &request {
        if out.get("ok") == Some(&Value::Bool(true)) {
            let recorded = BrokerRecord::from_reply(id, &out).is_some_and(|r| broker_recorded(record(&r)));
            if !recorded {
                let withdraw = JudgementRequest::ApplyRequest {
                    id: id.clone(),
                    on: false,
                    confirmed: false,
                    confirm: None,
                    connection_key: connection_key.clone(),
                };
                let _ = run(&withdraw);
                return failure("apply_authorisation_unrecorded");
            }
            if let Value::Object(map) = &mut out {
                map.retain(|key, _| key != "instant" && key != "destination");
            }
        }
    }
    out
}

/// What the page asks before it sends a judgement: whether the team it shows may be judged from
/// here, and the key every write must carry. Local files only, no network. The page never decides
/// it: a write that comes anyway meets the same gate in `existing_team_position_write`.
pub(crate) fn position_write_target_with(
    window_is_main: bool,
    current_key: impl FnOnce() -> Result<String, &'static str>,
    full: impl FnOnce(&str) -> Result<(), &'static str>,
) -> Value {
    if !window_is_main {
        return failure("position_write_window_refused");
    }
    let key = match current_key() {
        Ok(key) => key,
        Err(code) => return failure(code),
    };
    match full(&key) {
        Ok(()) => json!({ "ok": true, "connectionKey": key }),
        Err(code) => failure(code),
    }
}

#[tauri::command]
pub(crate) async fn existing_team_position_write_target(
    app: tauri::AppHandle,
    window: tauri::Window,
    scopes: State<'_, AccountScopeState>,
) -> Result<Value, String> {
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(failure("account_scope_unavailable")),
    };
    let window_is_main = direct_chat::window_may_write(window.label());
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state.lock_expected(&worker_expected).map_err(|_| "account_scope_changed")?;
        let scope = &worker_expected;
        let target: std::cell::RefCell<Option<ActivatedTarget>> = std::cell::RefCell::new(None);
        Ok(position_write_target_with(
            window_is_main,
            || {
                let host = direct_chat::load_persisted_host(&app, scope)?;
                crate::runtime_host::validate_host_for_scope(&app, &host, scope)?;
                let found = selected(&app, scope, &host)?.ok_or("existing_team_runtime_required")?;
                let key = connection_key(scope, &found);
                *target.borrow_mut() = Some(found);
                Ok(key)
            },
            |_key| match target.borrow().as_ref() {
                Some(found) => full_connection(scope, found),
                None => Err("existing_team_unavailable"),
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
    let window_is_main = direct_chat::window_may_write(window.label());
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
            |record| {
                let target = target.borrow();
                let validated = validated.borrow();
                let (Some(target), Some(validated)) = (target.as_ref(), validated.as_ref()) else {
                    return Err("existing_team_unavailable");
                };
                let remote = broker_record_command(&target.runtime, record)?;
                run_ssh_command(validated, &remote, None, WRITE_TIMEOUT, None)
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
        }, |_| Err("no broker in this test"))
    }

    const DIGEST: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn authorise() -> Value {
        json!({"op":"apply_request","id":"4","on":true,"confirmed":true,"confirm":DIGEST,"connectionKey":KEY})
    }

    /// The script's answer to the authorisation, then what the broker answers; what ran, in order.
    fn authorise_with(script: &str, broker: Result<ProcessResult, &'static str>) -> (Value, Vec<Vec<String>>, Option<BrokerRecord>) {
        let ran = std::cell::RefCell::new(Vec::new());
        let recorded = std::cell::RefCell::new(None);
        let out = position_write_with(
            authorise(),
            true,
            || Ok(KEY.to_owned()),
            |_| Ok(()),
            |request| {
                ran.borrow_mut().push(request.argv());
                let stdout = if request.argv().contains(&"--on".to_owned()) { script } else { r#"{"ok":true,"op":"apply-request","id":4}"# };
                Ok(ProcessResult { code: 0, stdout: stdout.as_bytes().to_vec() })
            },
            |record| {
                *recorded.borrow_mut() = Some(record.clone());
                broker
            },
        );
        (out, ran.into_inner(), recorded.into_inner())
    }

    const WRITTEN: &str = r#"{"ok":true,"op":"apply-request","id":4,"apply_requested":true,"instant":"2026-10-23T18:04:05.123Z","destination":"portal:ashby"}"#;

    #[test]
    fn an_authorisation_is_recorded_in_the_broker_with_what_was_confirmed() {
        let broker = Ok(ProcessResult { code: 0, stdout: br#"{"ok":true,"status":"recorded"}"#.to_vec() });
        let (out, ran, recorded) = authorise_with(WRITTEN, broker);
        assert_eq!(out, json!({"ok":true,"op":"apply-request","id":4,"apply_requested":true}));
        assert_eq!(ran, vec![vec!["apply-request", "4", "--on", "--expect", DIGEST]]);
        assert_eq!(
            recorded,
            Some(BrokerRecord { id: "4".into(), instant: "2026-10-23T18:04:05.123Z".into(), destination: "portal:ashby".into() })
        );
    }

    #[test]
    fn an_authorisation_the_broker_does_not_record_is_withdrawn_and_said() {
        for broker in [
            Err("ssh_unavailable"),
            Ok(ProcessResult { code: 71, stdout: Vec::new() }),
            Ok(ProcessResult { code: 1, stdout: br#"{"ok":false,"reason":"instant_not_newer"}"#.to_vec() }),
            Ok(ProcessResult { code: 0, stdout: br#"{"ok":true,"status":"revoked"}"#.to_vec() }),
        ] {
            let (out, ran, _) = authorise_with(WRITTEN, broker);
            assert_eq!(out, json!({"ok":false,"error":"apply_authorisation_unrecorded"}));
            assert_eq!(ran.last().unwrap(), &vec!["apply-request", "4", "--off"]);
        }
        // a reply whose fields would not be closed on the command line never reaches the broker
        for script in [
            r#"{"ok":true,"instant":"2026-10-23T18:04:05.123Z","destination":"web:x'; reboot"}"#,
            r#"{"ok":true,"instant":"yesterday","destination":"web:example.com"}"#,
            r#"{"ok":true,"instant":"2026-10-23T18:04:05.123Z","destination":"portal:Ashby"}"#,
            r#"{"ok":true,"apply_requested":true}"#,
        ] {
            let ok = Ok(ProcessResult { code: 0, stdout: br#"{"ok":true,"status":"recorded"}"#.to_vec() });
            let (out, ran, recorded) = authorise_with(script, ok);
            assert_eq!(out["error"], "apply_authorisation_unrecorded", "{script}");
            assert_eq!(recorded, None, "{script}");
            assert_eq!(ran.last().unwrap(), &vec!["apply-request", "4", "--off"]);
        }
    }

    #[test]
    fn the_broker_is_found_as_the_pinned_teams_own_and_its_command_is_closed() {
        let record = BrokerRecord { id: "4".into(), instant: "2026-10-23T18:04:05.123Z".into(), destination: "web:example.com".into() };
        let remote = broker_record_command(&target(), &record).unwrap();
        assert!(remote.contains("|| exit 70"), "the pinned container's checks come first");
        assert!(remote.contains("label=com.docker.compose.service=jht-broker"));
        assert!(remote.contains("\"true|1002:1002|$JHT_IMAGE\""));
        assert!(remote.ends_with("jht-broker-admin apply record '4' '2026-10-23T18:04:05.123Z' 'web:example.com'"));
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
            }, |_| Err("x"));
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
        }, |_| Err("x"));
        assert_eq!(out["error"], "position_write_window_refused");
        let out = position_write_with(feedback(), true, || Ok("another".into()), |_| Ok(()), |_| {
            ran.set(true);
            Err("x")
        }, |_| Err("x"));
        assert_eq!(out["error"], "existing_team_runtime_target_changed");
        assert!(!ran.get());
    }

    #[test]
    fn closed_fields_are_checked_without_the_vps() {
        for (request, code) in [
            (json!({"op":"feedback","id":"01","value":"like","connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"feedback","id":"1;rm","value":"like","connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"feedback","id":"1","value":"superb","connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"feedback","id":"1","value":"star","score":6,"connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"feedback","id":"1","value":"like","direction":"sideways","connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"write_request","id":"1","on":true,"kind":"poem","connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"feedback","id":"1","value":"like","host":"x","connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"run","id":"1","connectionKey":KEY}), "position_write_request_invalid"),
            (json!({"op":"exclude","id":"1","reason":"Too Senior","connectionKey":KEY}), "reason_invalid"),
            (json!({"op":"exclude","id":"1","reason":"other'; reboot","connectionKey":KEY}), "reason_invalid"),
            (json!({"op":"apply_request","id":"1","on":true,"confirmed":false,"connectionKey":KEY}), "position_write_not_confirmed"),
            (json!({"op":"apply_request","id":"1","on":true,"confirmed":true,"connectionKey":KEY}), "position_write_not_confirmed"),
            (json!({"op":"apply_request","id":"1","on":true,"confirmed":true,"confirm":"0'; reboot","connectionKey":KEY}), "position_write_not_confirmed"),
            (json!({"op":"apply_request","id":"1","on":true,"confirmed":true,"confirm":DIGEST.to_uppercase(),"connectionKey":KEY}), "position_write_not_confirmed"),
            (json!({"op":"apply_preview","id":"1;rm","connectionKey":KEY}), "position_write_request_invalid"),
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
            "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 /app/shared/skills/position_judgement.py 'feedback' '12' '--value' 'dislike' '--reason' 'too_senior' '--note-on-stdin'"
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
            (json!({"op":"apply_request","id":"4","on":true,"confirmed":true,"confirm":DIGEST,"connectionKey":KEY}), vec!["apply-request", "4", "--on", "--expect", DIGEST]),
            (json!({"op":"apply_request","id":"4","on":false,"confirmed":false,"connectionKey":KEY}), vec!["apply-request", "4", "--off"]),
            (json!({"op":"apply_preview","id":"4","connectionKey":KEY}), vec!["apply-preview", "4"]),
            (json!({"op":"recheck","id":"4","on":false,"connectionKey":KEY}), vec!["recheck", "4", "--off"]),
            (json!({"op":"feedback","id":"4","value":"clear","connectionKey":KEY}), vec!["feedback", "4", "--value", "clear"]),
            (
                json!({"op":"feedback","id":"4","value":"star","score":5,"direction":"more_like_this","connectionKey":KEY}),
                vec!["feedback", "4", "--value", "star", "--score", "5", "--direction", "more_like_this"],
            ),
            (
                json!({"op":"write_request","id":"4","on":false,"kind":"cover_letter","connectionKey":KEY}),
                vec!["write-request", "4", "--off", "--kind", "cover_letter"],
            ),
        ] {
            let request: JudgementRequest = serde_json::from_value(request).unwrap();
            assert_eq!(request.argv(), argv);
        }
    }

    #[test]
    fn the_target_gives_the_key_only_for_the_team_confirmed_in_full() {
        assert_eq!(
            position_write_target_with(true, || Ok(KEY.into()), |_| Ok(())),
            json!({"ok": true, "connectionKey": KEY})
        );
        assert_eq!(
            position_write_target_with(true, || Ok(KEY.into()), |_| Err("position_write_read_only")),
            json!({"ok": false, "error": "position_write_read_only"})
        );
        // no existing team on this profile: the page writes as it always did
        assert_eq!(
            position_write_target_with(true, || Err("existing_team_runtime_required"), |_| Ok(())),
            json!({"ok": false, "error": "existing_team_runtime_required"})
        );
        let asked = Cell::new(false);
        let out = position_write_target_with(false, || {
            asked.set(true);
            Ok(KEY.into())
        }, |_| Ok(()));
        assert_eq!(out["error"], "position_write_window_refused");
        assert!(!asked.get(), "another window reads nothing");
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

    #[test]
    fn a_way_in_that_ssh_explained_keeps_its_code_and_is_not_the_teams_unavailability() {
        for code in ["ssh_auth_failed", "ssh_connection_refused", "ssh_host_unreachable", "host_key_changed", "ssh_rate_limited"] {
            assert_eq!(reply(Err(code))["error"], code);
        }
        assert_eq!(reply(Ok(ProcessResult { code: 255, stdout: Vec::new() }))["error"], "ssh_unavailable");
        assert_eq!(reply(Err("process_timeout"))["error"], "existing_team_unavailable");
    }
}

//! The agents' control panel: read the team's agents, start, stop or restart
//! one, pause or resume the team. Every rule lives in the container, in
//! shared/skills/agent_control.py; this module only decides WHERE the team is
//! and carries a closed request there.
//!
//! - The renderer never names a host, a container, a path or a command: it
//!   sends an operation, a session name from the closed grammar, and back the
//!   opaque `target` this module gave it with the list. If the team the page
//!   shows is no longer the one an action would reach (another VPS, a new
//!   connection, back to this computer), the action is refused:
//!   existing_team_runtime_target_changed.
//! - A VPS team is controlled only on the full link of that team («Conferma
//!   e collega» in this run of the app, see vps_mode). The read-only view
//!   reads, and every action is refused here, whatever the page sends:
//!   agent_control_read_only.
//! - Only the main window may call this command (agent_control_window): the
//!   other windows (the LinkedIn login view, the live screen) load content
//!   the app does not own.
//! - `confirmed` is the page's guard against a wrong click, not a boundary.
//! - The exclusions of the profile (JHT-T24-b) are the same panel's: the user's decision to exclude
//!   a kind of position, written straight in the team's jobs.db when the team has no cloud to carry
//!   it. It goes through the same destination, the same full link (or the mark of the person's own
//!   VPS) and the same prepared target as any other action; the code is one of the words that act on the score.
//!
//! Transports. A VPS: the pinned container through `command` (a changed
//! container is exit 70), with the reads run by the app's own copy of the
//! script on stdin, so they work on an older image too, and the actions by
//! the image's script, as argv. This computer: the attested `jht` wrapper's
//! `agent-control` branch, which never starts the container.

use crate::{
    account_scope::{AccountScope, AccountScopeState},
    direct_chat,
    existing_team_agents::{shape_reply, AgentsRequest},
    existing_team_runtime::{
        command, connection_key, full_link_granted, hex_encode, own_vps_for_reads_at, own_vps_state_at, python_command, root,
        selected, OwnVpsState,
        ActivatedTarget, RuntimeTarget,
    },
    runtime_host::{run_ssh_command, ExecutionHost, ProcessResult, ValidatedHost},
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, time::Duration};
use tauri::State;

/// The container side, as the app ships it: the reads run this copy on a VPS.
pub(crate) const AGENT_CONTROL_PY: &str = include_str!("../../../shared/skills/agent_control.py");
const IMAGE_SCRIPT: &str = "/app/shared/skills/agent_control.py";

const READ_TIMEOUT: Duration = Duration::from_secs(25);
/// A start waits for start-agent.sh (120 s in the script).
const ACTION_TIMEOUT: Duration = Duration::from_secs(200);
const MAX_REPLY: usize = 256 * 1024;

/// The script's codes (100-112), the CLI's (113-114) and the pinned target's.
const EXITS: &[(i32, &str)] = &[
    (2, "agent_control_unsupported"),
    (70, "existing_team_runtime_changed"),
    (100, "agent_control_invalid"),
    (101, "agent_control_refused"),
    (102, "agent_control_busy"),
    (103, "disk_low"),
    (104, "closer_not_consented"),
    (105, "agent_start_failed"),
    (106, "agent_stop_failed"),
    (107, "agent_not_running"),
    (108, "team_halted"),
    (109, "team_pause_failed"),
    (110, "team_resume_failed"),
    (111, "agent_contained"),
    (112, "team_paused"),
    (113, "agent_control_no_team"),
    (114, "agent_control_unanswered"),
    (115, "exclusion_no_evidence"),
    (116, "exclusion_failed"),
];

/// The codes of the exclusions that act on the score (`acting` of shared/feedback-reasons.json).
pub(crate) const EXCLUSION_CODES: &[&str] = &["company", "wrong_location", "salary_low", "wrong_stack", "too_senior", "too_junior"];

const RESULTS: &[&str] = &[
    "excluded", "exclusion_withdrawn",
    "started", "already_running", "stopped", "already_stopped", "restarted", "paused",
    "already_paused", "resumed", "not_paused",
];

// ── how the VPS was linked ──────────────────────────────────────────────────
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum VpsMode {
    ReadOnly,
    /// Granted by the full link only: see vps_mode.
    Full,
}

/// The one place that says whether the linked VPS may be controlled: only the
/// team the person confirmed with «Conferma e collega» in this run of the app
/// (the existing-team connection's full link, tied to its connection key). A
/// read-only opening, a reopening at launch or a restart leave it without:
/// read only.
pub(crate) fn vps_mode(scope: &AccountScope, target: &ActivatedTarget) -> VpsMode {
    if full_link_granted(scope, target) {
        VpsMode::Full
    } else {
        VpsMode::ReadOnly
    }
}

// ── the request ─────────────────────────────────────────────────────────────
#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum PauseExit {
    Hours { hours: u16 },
    /// An instant in UTC, `YYYY-MM-DDTHH:MM:SSZ`: the page computes «tomorrow
    /// at 8» in the user's own time zone and sends it in UTC.
    Until { until: String },
    WeeklyReset {},
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum ControlRequest {
    List {},
    Team {},
    Screen { session: String },
    Start { session: String, target: String, confirmed: bool },
    Stop { session: String, target: String, confirmed: bool },
    Restart { session: String, target: String, confirmed: bool },
    Pause { exit: PauseExit, target: String, confirmed: bool },
    Resume { target: String, confirmed: bool },
    Exclusions {},
    #[serde(rename = "exclusion_accept")]
    ExclusionAccept { code: String, target: String, confirmed: bool },
    #[serde(rename = "exclusion_withdraw")]
    ExclusionWithdraw { code: String, target: String, confirmed: bool },
}

fn failure(code: &str) -> Value {
    json!({"ok": false, "error": code})
}

/// A session of the closed grammar (the launcher's own names).
fn session_ok(session: &str) -> bool {
    crate::existing_team_agents::agent_session(session).is_some()
}

fn until_ok(until: &str) -> bool {
    let bytes = until.as_bytes();
    bytes.len() == 20
        && bytes.iter().enumerate().all(|(index, byte)| match index {
            4 | 7 => *byte == b'-',
            10 => *byte == b'T',
            13 | 16 => *byte == b':',
            19 => *byte == b'Z',
            _ => byte.is_ascii_digit(),
        })
}

impl ControlRequest {
    /// The argv of the container script for this request; None if not valid.
    pub(crate) fn argv(&self) -> Option<Vec<String>> {
        let with = |op: &str, session: &str| session_ok(session).then(|| vec![op.to_owned(), session.to_owned()]);
        match self {
            Self::List {} => Some(vec!["list".into()]),
            Self::Team {} => Some(vec!["team".into()]),
            Self::Screen { session } => with("screen", session),
            Self::Start { session, .. } => with("start", session),
            Self::Stop { session, .. } => with("stop", session),
            Self::Restart { session, .. } => with("restart", session),
            Self::Pause { exit, .. } => match exit {
                PauseExit::Hours { hours } if (1..=168).contains(hours) => {
                    Some(vec!["pause".into(), "--for-hours".into(), hours.to_string()])
                }
                PauseExit::Until { until } if until_ok(until) => {
                    Some(vec!["pause".into(), "--until".into(), until.clone()])
                }
                PauseExit::WeeklyReset {} => Some(vec!["pause".into(), "--wake-on-weekly".into()]),
                _ => None,
            },
            Self::Resume { .. } => Some(vec!["resume".into()]),
            Self::Exclusions {} => Some(vec!["exclusions".into()]),
            Self::ExclusionAccept { code, .. } => EXCLUSION_CODES.contains(&code.as_str()).then(|| vec!["exclusion-accept".to_owned(), code.clone()]),
            Self::ExclusionWithdraw { code, .. } => EXCLUSION_CODES.contains(&code.as_str()).then(|| vec!["exclusion-withdraw".to_owned(), code.clone()]),
        }
    }

    /// For an action: the target it was prepared on and whether it was confirmed.
    fn action(&self) -> Option<(&str, bool)> {
        match self {
            Self::Start { target, confirmed, .. }
            | Self::Stop { target, confirmed, .. }
            | Self::Restart { target, confirmed, .. }
            | Self::Pause { target, confirmed, .. }
            | Self::ExclusionAccept { target, confirmed, .. }
            | Self::ExclusionWithdraw { target, confirmed, .. }
            | Self::Resume { target, confirmed } => Some((target.as_str(), *confirmed)),
            _ => None,
        }
    }
}

// ── where the team is ───────────────────────────────────────────────────────
enum Destination {
    /// An existing team, linked: its pinned container.
    Vps { validated: ValidatedHost, runtime: RuntimeTarget, mode: VpsMode, label: String },
    /// The VPS the app set up itself (no existing team registered): its host's jht wrapper.
    OwnVps { validated: ValidatedHost, label: String, state: OwnVpsState },
    Local { wrapper: PathBuf },
}

/// The jht wrapper of the person's own VPS, as the setup installed it, and only when it carries
/// the protocol line of what is asked (2 otherwise: «update the team»).
fn own_vps_wrapper(protocol: &str, operation: &str) -> String {
    format!(
        r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 2; grep -Fqx '{protocol}' "$JHT_BIN" || exit 2; exec "$JHT_BIN" {operation}"#
    )
}

/// The reads on the person's own VPS: the app's own copy of the script on the wrapper's
/// python channel (the chat's), which the wrapper of today already has.
pub(crate) fn own_vps_read_command() -> String {
    own_vps_wrapper("JHT_DESKTOP_CHAT_PROTOCOL=1", "desktop-chat python")
}

/// An action on the person's own VPS: the wrapper's agent-control branch, which never starts
/// the container.
pub(crate) fn own_vps_action_command(argv: &[String]) -> Result<String, &'static str> {
    let words = argv.iter().map(|word| quoted(word)).collect::<Option<Vec<_>>>().ok_or("agent_control_invalid")?;
    Ok(own_vps_wrapper("JHT_AGENT_CONTROL_PROTOCOL=1", &format!("agent-control {} </dev/null", words.join(" "))))
}

fn fingerprint(parts: &[&str]) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0u8]);
    }
    format!("{:x}", hasher.finalize())[..32].to_owned()
}

fn destination(app: &tauri::AppHandle, scope: &AccountScope) -> Result<(Destination, String), &'static str> {
    // The team is where the app keeps it: a persisted VPS host, or this computer.
    if let Ok(host @ ExecutionHost::Vps { .. }) = direct_chat::load_persisted_host(app, scope) {
        // the host key is pinned, or nothing goes there
        let validated = crate::runtime_host::validate_host_for_scope(app, &host, scope)?;
        let (address, user, port) = match &host {
            ExecutionHost::Vps { address, user, port, .. } => (address.clone(), user.clone(), port.to_string()),
            ExecutionHost::Local => return Err("existing_team_vps_required"),
        };
        let pinned = crate::runtime_host::pinned_host_fingerprint(&validated).ok();
        let root = root(app)?;
        if own_vps_for_reads_at(&root, scope) {
            // The VPS the app set up: the person's own team. It is read as it always was; it is controlled
            // only with the mark the setup writes (or after the person claimed it): the state is in the print.
            let state = own_vps_state_at(&root, scope, &host, pinned.as_deref());
            let print = fingerprint(&["own-vps", scope.digest(), &address, &user, &port, state.word()]);
            return Ok((Destination::OwnVps { validated, label: address, state }, print));
        }
        let target = selected(app, scope, &host)?.ok_or("existing_team_runtime_required")?;
        let mode = vps_mode(scope, &target);
        let print = fingerprint(&["vps", &connection_key(scope, &target), &address, &user, &port, &target.team_id, &target.runtime.container_id]);
        return Ok((Destination::Vps { validated, runtime: target.runtime, mode, label: address }, print));
    }
    crate::account_scope::validate_local_runtime(app, scope).map_err(|_| "agent_control_no_team")?;
    let wrapper = crate::onboarding::verified_local_wrapper_path(app).map_err(|_| "agent_control_no_team")?;
    if !crate::onboarding::wrapper_has_agent_control(&wrapper) {
        return Err("agent_control_unsupported");
    }
    let print = fingerprint(&["local", &wrapper.to_string_lossy()]);
    Ok((Destination::Local { wrapper }, print))
}

/// A word of the closed argv, quoted for the VPS shell (the grammar already
/// keeps quotes and spaces out: this is the second lock).
fn quoted(word: &str) -> Option<String> {
    word.bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"-:_".contains(&byte))
        .then(|| format!("'{word}'"))
}

pub(crate) fn vps_action_command(runtime: &RuntimeTarget, argv: &[String]) -> Result<String, &'static str> {
    let words = argv.iter().map(|word| quoted(word)).collect::<Option<Vec<_>>>().ok_or("agent_control_invalid")?;
    command(
        runtime,
        &format!(
            "docker exec -e JHT_SPAWN_SRC=desktop-panel \"$JHT_CID\" python3 {IMAGE_SCRIPT} {} </dev/null",
            words.join(" ")
        ),
    )
}

/// The app's copy of the script and one read request, as the container's
/// python reads them on stdin: the script in hex, then the request.
pub(crate) fn read_input(request: &ControlRequest) -> Option<Vec<u8>> {
    let read = match request {
        ControlRequest::List {} => json!({"op": "list"}),
        ControlRequest::Team {} => json!({"op": "team"}),
        ControlRequest::Exclusions {} => json!({"op": "exclusions"}),
        ControlRequest::Screen { session } => json!({"op": "screen", "name": session}),
        _ => return None,
    };
    let mut input = hex_encode(AGENT_CONTROL_PY.as_bytes()).into_bytes();
    input.push(b'\n');
    input.extend_from_slice(read.to_string().as_bytes());
    input.push(b'\n');
    Some(input)
}

fn run(destination: &Destination, request: &ControlRequest, argv: &[String]) -> Result<ProcessResult, &'static str> {
    let read = request.action().is_none();
    let timeout = if read { READ_TIMEOUT } else { ACTION_TIMEOUT };
    match destination {
        Destination::Vps { validated, runtime, .. } => {
            if read {
                let input = read_input(request).ok_or("agent_control_invalid")?;
                run_ssh_command(validated, &python_command(runtime)?, Some(&input), timeout, None)
            } else {
                run_ssh_command(validated, &vps_action_command(runtime, argv)?, None, timeout, None)
            }
        }
        Destination::OwnVps { validated, .. } => {
            if read {
                let input = read_input(request).ok_or("agent_control_invalid")?;
                run_ssh_command(validated, &own_vps_read_command(), Some(&input), timeout, None)
            } else {
                run_ssh_command(validated, &own_vps_action_command(argv)?, None, timeout, None)
            }
        }
        Destination::Local { wrapper } => {
            let mut args = vec!["agent-control"];
            args.extend(argv.iter().map(String::as_str));
            crate::onboarding::run_verified_local_wrapper(wrapper, &args, None, timeout)
        }
    }
}

// ── the answers ─────────────────────────────────────────────────────────────
fn code_of(exit: i32) -> &'static str {
    EXITS.iter().find(|(code, _)| *code == exit).map(|(_, name)| *name).unwrap_or("agent_control_unanswered")
}

fn word(value: Option<&Value>, allowed: &[&str]) -> Value {
    match value.and_then(Value::as_str) {
        Some(text) if allowed.contains(&text) => json!(text),
        _ => Value::Null,
    }
}

/// A timestamp the container wrote, as long as it is only the characters of one.
fn stamp(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|text| text.len() <= 40 && text.bytes().all(|b| b.is_ascii_alphanumeric() || b"-:+.".contains(&b)))
}

/// A timestamp as the jobs.db writes it («2026-10-01 10:00:00.123») or as ISO: only the characters of one.
fn db_stamp(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|text| text.len() <= 40 && text.bytes().all(|b| b.is_ascii_alphanumeric() || b"-:+. ".contains(&b)))
}

/// A reason code: lowercase letters and underscores, never the user's words.
fn code_word(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|text| !text.is_empty() && text.len() <= 32 && text.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'))
}

const FEEDBACK_ACTIONS: &[&str] = &["like", "dislike", "hide", "star", "clear"];
const FEEDBACK_MAX: usize = 2000;

/// The exclusions and the judgements the proposals are made of, reduced to closed fields.
pub(crate) fn shape_exclusions(reply: &Value) -> Option<Value> {
    if reply.get("ok") != Some(&Value::Bool(true)) {
        return None;
    }
    let exclusions: Vec<Value> = reply
        .get("exclusions")?
        .as_array()?
        .iter()
        .filter_map(|row| {
            let code = code_word(row.get("code")).filter(|code| EXCLUSION_CODES.contains(code))?;
            let status = row.get("status").and_then(Value::as_str).filter(|status| ["active", "withdrawn"].contains(status))?;
            Some(json!({"code": code, "status": status, "decidedAt": db_stamp(row.get("decided_at"))}))
        })
        .collect();
    let feedback: Vec<Value> = reply
        .get("feedback")?
        .as_array()?
        .iter()
        .take(FEEDBACK_MAX)
        .filter_map(|row| {
            let id = row.get("id").and_then(Value::as_i64).filter(|id| *id >= 0)?;
            let legacy = row.get("legacy_id").and_then(Value::as_i64).filter(|id| *id > 0)?;
            let action = row.get("action").and_then(Value::as_str).filter(|action| FEEDBACK_ACTIONS.contains(action))?;
            Some(json!({"id": id, "legacyId": legacy, "action": action, "reason": code_word(row.get("reason")), "createdAt": db_stamp(row.get("created_at"))}))
        })
        .collect();
    Some(json!({"ok": true, "data": {"exclusions": exclusions, "feedback": feedback}}))
}

/// The team's own state, reduced to the closed fields the page shows.
pub(crate) fn shape_team(reply: &Value) -> Option<Value> {
    if reply.get("ok") != Some(&Value::Bool(true)) {
        return None;
    }
    let data = reply.get("data")?.as_object()?;
    let standby = data.get("standby")?.as_object()?;
    let until = stamp(standby.get("until"));
    // The user's full-throttle override: a closed state, when it ends, and the minutes left. An image
    // older than this field answers none of it, and the page says nothing about it.
    let burn = data.get("burn_intent").and_then(Value::as_object);
    let burn_intent = json!({
        "state": word(burn.and_then(|b| b.get("state")), &["off", "active", "expired", "unknown"]),
        "expiresAt": stamp(burn.and_then(|b| b.get("expires_at"))),
        "remainingMin": burn.and_then(|b| b.get("remaining_min")).and_then(Value::as_u64).filter(|minutes| *minutes <= 100_000),
    });
    let held = match data.get("held") {
        Some(Value::Array(items)) => Value::Array(
            items
                .iter()
                .filter_map(|item| {
                    let session = item.get("session")?.as_str()?;
                    session_ok(session).then(|| json!({"session": session, "byUser": item.get("by_user") == Some(&Value::Bool(true))}))
                })
                .take(200)
                .collect(),
        ),
        _ => Value::Null,
    };
    Some(json!({"ok": true, "data": {
        "halted": data.get("halted")?.as_bool()?,
        "standby": {
            "state": word(standby.get("state"), &["off", "active", "expired", "invalid", "unknown"]),
            "until": until,
            "weeklyReset": standby.get("weekly_reset") == Some(&Value::Bool(true)),
        },
        "held": held,
        "burnIntent": burn_intent,
    }}))
}

pub(crate) fn answer(request: &ControlRequest, output: &ProcessResult, target: &str, label: Option<&str>) -> Value {
    if output.stdout.len() > MAX_REPLY {
        return failure("agent_control_unanswered");
    }
    let reply = serde_json::from_slice::<Value>(output.stdout.trim_ascii()).ok();
    match request {
        ControlRequest::List {} | ControlRequest::Screen { .. } => {
            let read = match request {
                ControlRequest::List {} => AgentsRequest::List {},
                ControlRequest::Screen { session } => AgentsRequest::Screen { name: session.clone() },
                _ => unreachable!(),
            };
            if output.code != 0 {
                return failure(code_of(output.code));
            }
            let Some(reply) = reply else { return failure("agents_unavailable") };
            if let Some(mut shaped) = shape_reply(&read, &reply) {
                if let (ControlRequest::List {}, Some(data)) = (request, shaped.get_mut("data").and_then(Value::as_object_mut)) {
                    data.insert("target".into(), json!(target));
                    data.insert("where".into(), json!(if label.is_some() { "vps" } else { "local" }));
                    data.insert("label".into(), json!(label));
                }
                return shaped;
            }
            match reply.get("error").and_then(Value::as_str) {
                Some("agent_screen_unfiltered") => failure("agent_screen_unfiltered"),
                _ => failure("agents_unavailable"),
            }
        }
        ControlRequest::Team {} => {
            if output.code != 0 {
                return failure(code_of(output.code));
            }
            reply.as_ref().and_then(shape_team).unwrap_or_else(|| failure("agents_unavailable"))
        }
        ControlRequest::Exclusions {} => {
            if output.code != 0 {
                return failure(code_of(output.code));
            }
            let Some(reply) = reply else { return failure("exclusions_unavailable") };
            let Some(mut shaped) = shape_exclusions(&reply) else { return failure("exclusions_unavailable") };
            if let Some(data) = shaped.get_mut("data").and_then(Value::as_object_mut) {
                data.insert("target".into(), json!(target));
                data.insert("where".into(), json!(if label.is_some() { "vps" } else { "local" }));
                data.insert("label".into(), json!(label));
            }
            shaped
        }
        _ => {
            if output.code != 0 {
                return failure(code_of(output.code));
            }
            match reply.as_ref().filter(|reply| reply.get("ok") == Some(&Value::Bool(true))) {
                Some(reply) => match word(reply.get("result"), RESULTS) {
                    Value::Null => failure("agent_control_unanswered"),
                    result => json!({"ok": true, "data": {"result": result}}),
                },
                None => failure("agent_control_unanswered"),
            }
        }
    }
}

/// How a destination may be controlled: an existing team by its link, the person's own VPS
/// as a full link, this computer always (None).
fn destination_mode(destination: &Destination) -> Option<VpsMode> {
    match destination {
        Destination::Vps { mode, .. } => Some(*mode),
        Destination::OwnVps { state, .. } => Some(if *state == OwnVpsState::Marked { VpsMode::Full } else { VpsMode::ReadOnly }),
        Destination::Local { .. } => None,
    }
}

/// Why an action may not run on this destination: the read-only link refuses
/// every action, and an action prepared on another target is refused. Reads
/// pass.
pub(crate) fn action_refusal(request: &ControlRequest, vps_mode: Option<VpsMode>, print: &str) -> Option<&'static str> {
    let (target, confirmed) = request.action()?;
    if !confirmed {
        return Some("agent_control_not_confirmed");
    }
    if vps_mode == Some(VpsMode::ReadOnly) {
        return Some("agent_control_read_only");
    }
    (target != print).then_some("existing_team_runtime_target_changed")
}

/// Only the app's main window: the others load pages the app does not own.
pub(crate) fn window_refusal(label: &str) -> Option<&'static str> {
    (label != "main").then_some("agent_control_window")
}

pub(crate) fn control_for_scope(app: &tauri::AppHandle, scope: &AccountScope, request: Value) -> Value {
    let Ok(request) = serde_json::from_value::<ControlRequest>(request) else {
        return failure("agent_control_invalid");
    };
    let Some(argv) = request.argv() else {
        return failure("agent_control_invalid");
    };
    let (destination, print) = match destination(app, scope) {
        Ok(found) => found,
        Err(error) => return failure(error),
    };
    let mode = destination_mode(&destination);
    // An action on a VPS of the person's own with no mark: the page's invitation to claim it, not a
    // generic «read only».
    if let (Destination::OwnVps { state, .. }, true) = (&destination, request.action().is_some()) {
        if let Some(code) = state.write_refusal() {
            return failure(code);
        }
    }
    if let Some(error) = action_refusal(&request, mode, &print) {
        return failure(error);
    }
    let label = match &destination {
        Destination::Vps { label, .. } | Destination::OwnVps { label, .. } => Some(label.clone()),
        Destination::Local { .. } => None,
    };
    match run(&destination, &request, &argv) {
        Ok(output) => {
            let mut reply = answer(&request, &output, &print, label.as_deref());
            // Where the VPS of one's own stands, for the page to offer the claim (JHT-T30).
            if let (Destination::OwnVps { state, .. }, ControlRequest::List {} | ControlRequest::Exclusions {}) = (&destination, &request) {
                if let Some(data) = reply.get_mut("data").and_then(Value::as_object_mut) {
                    data.insert("ownVps".into(), json!(state.word()));
                }
            }
            reply
        }
        Err(error) => failure(error),
    }
}

/// The panel's one command. Only the main window may call it.
#[tauri::command]
pub(crate) async fn agent_control(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    request: Value,
) -> Result<Value, String> {
    if let Some(error) = window_refusal(window.label()) {
        return Ok(failure(error));
    }
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(failure("account_scope_unavailable")),
    };
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state.lock_expected(&worker_expected).map_err(|_| "account_scope_changed")?;
        Ok::<Value, &'static str>(control_for_scope(&app, &worker_expected, request))
    })
    .await
    .unwrap_or(Err("agent_control_unanswered"));
    if scopes.lock_expected(&expected).is_err() {
        return Ok(failure("account_scope_changed"));
    }
    Ok(result.unwrap_or_else(|error| failure(error)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(value: Value) -> Option<ControlRequest> {
        serde_json::from_value(value).ok()
    }

    #[test]
    fn a_request_is_closed() {
        for bad in [
            json!({"op":"stop","session":"SCOUT-1","target":"t","confirmed":true,"host":"x"}),
            json!({"op":"stop","session":"SCOUT-1","target":"t"}),
            json!({"op":"send","session":"SCOUT-1","text":"hi"}),
            json!({"op":"list","command":"rm"}),
            json!({"op":"pause","exit":{"kind":"hours","hours":4,"extra":1},"target":"t","confirmed":true}),
        ] {
            assert!(req(bad.clone()).is_none(), "{bad}");
        }
        for (value, argv) in [
            (json!({"op":"list"}), vec!["list"]),
            (json!({"op":"team"}), vec!["team"]),
            (json!({"op":"screen","session":"CRITICO-S3"}), vec!["screen", "CRITICO-S3"]),
            (json!({"op":"stop","session":"SCOUT-1","target":"t","confirmed":true}), vec!["stop", "SCOUT-1"]),
            (json!({"op":"restart","session":"CLOSER-1","target":"t","confirmed":true}), vec!["restart", "CLOSER-1"]),
            (json!({"op":"pause","exit":{"kind":"hours","hours":4},"target":"t","confirmed":true}), vec!["pause", "--for-hours", "4"]),
            (json!({"op":"pause","exit":{"kind":"until","until":"2026-10-20T06:00:00Z"},"target":"t","confirmed":true}), vec!["pause", "--until", "2026-10-20T06:00:00Z"]),
            (json!({"op":"pause","exit":{"kind":"weekly_reset"},"target":"t","confirmed":true}), vec!["pause", "--wake-on-weekly"]),
            (json!({"op":"resume","target":"t","confirmed":false}), vec!["resume"]),
        ] {
            assert_eq!(req(value).unwrap().argv().unwrap(), argv);
        }
        for bad in [
            json!({"op":"stop","session":"scout-1","target":"t","confirmed":true}),
            json!({"op":"stop","session":"SCOUT-1;rm","target":"t","confirmed":true}),
            json!({"op":"stop","session":"HQ-MASTER","target":"t","confirmed":true}),
            json!({"op":"screen","session":"SENTINELLA-WORKER"}),
            json!({"op":"pause","exit":{"kind":"hours","hours":0},"target":"t","confirmed":true}),
            json!({"op":"pause","exit":{"kind":"hours","hours":169},"target":"t","confirmed":true}),
            json!({"op":"pause","exit":{"kind":"until","until":"2026-10-20T06:00:00+02:00"},"target":"t","confirmed":true}),
            json!({"op":"pause","exit":{"kind":"until","until":"tomorrow"},"target":"t","confirmed":true}),
        ] {
            assert!(req(bad.clone()).and_then(|r| r.argv()).is_none(), "{bad}");
        }
    }

    #[test]
    fn the_vps_action_is_the_image_script_through_the_pinned_target() {
        let runtime = RuntimeTarget {
            container_id: "a".repeat(64),
            image_id: format!("sha256:{}", "b".repeat(64)),
            platform_image_id: format!("sha256:{}", "c".repeat(64)),
            oci_revision: "d".repeat(40),
            digest: format!("sha256:{}", "e".repeat(64)),
            os: "linux".into(),
            architecture: "amd64".into(),
        };
        let argv = req(json!({"op":"stop","session":"SCOUT-1","target":"t","confirmed":true})).unwrap().argv().unwrap();
        let command = vps_action_command(&runtime, &argv).unwrap();
        assert_eq!(command, crate::existing_team_runtime::command(&runtime, "docker exec -e JHT_SPAWN_SRC=desktop-panel \"$JHT_CID\" python3 /app/shared/skills/agent_control.py 'stop' 'SCOUT-1' </dev/null").unwrap());
        assert!(command.contains("|| exit 70"));
        // a word outside the grammar never reaches the shell
        assert!(vps_action_command(&runtime, &["stop".into(), "SCOUT-1'; rm -rf /'".into()]).is_err());
    }

    #[test]
    fn the_reads_carry_the_apps_own_script_and_never_an_action() {
        let input = read_input(&req(json!({"op":"screen","session":"SCOUT-1"})).unwrap()).unwrap();
        let text = String::from_utf8(input).unwrap();
        let (script, request) = text.trim_end().split_once('\n').unwrap();
        assert_eq!(script, hex_encode(AGENT_CONTROL_PY.as_bytes()));
        assert_eq!(serde_json::from_str::<Value>(request).unwrap(), json!({"op":"screen","name":"SCOUT-1"}));
        for action in [
            json!({"op":"stop","session":"SCOUT-1","target":"t","confirmed":true}),
            json!({"op":"resume","target":"t","confirmed":true}),
        ] {
            assert!(read_input(&req(action).unwrap()).is_none());
        }
        // the copy is the repo's file, byte for byte
        let file = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../shared/skills/agent_control.py")).unwrap();
        assert_eq!(file, AGENT_CONTROL_PY);
    }

    #[test]
    fn every_exit_has_its_code_and_an_unknown_one_is_unanswered() {
        let action = req(json!({"op":"stop","session":"SCOUT-1","target":"t","confirmed":true})).unwrap();
        let out = |code: i32, stdout: &str| ProcessResult { code, stdout: stdout.as_bytes().to_vec() };
        for (exit, code) in EXITS {
            assert_eq!(answer(&action, &out(*exit, ""), "t", None), failure(code));
        }
        assert_eq!(answer(&action, &out(1, ""), "t", None), failure("agent_control_unanswered"));
        assert_eq!(
            answer(&action, &out(0, "{\"ok\":true,\"op\":\"stop\",\"session\":\"SCOUT-1\",\"result\":\"stopped\"}\n"), "t", None),
            json!({"ok":true,"data":{"result":"stopped"}})
        );
        // never «done» without the script saying so
        assert_eq!(answer(&action, &out(0, ""), "t", None), failure("agent_control_unanswered"));
        assert_eq!(answer(&action, &out(0, "{\"ok\":true,\"result\":\"exploded\"}"), "t", None), failure("agent_control_unanswered"));
    }

    #[test]
    fn the_script_and_the_module_agree_on_the_codes() {
        let script = AGENT_CONTROL_PY;
        for (exit, code) in EXITS.iter().filter(|(exit, _)| (100..=112).contains(exit) || (115..=116).contains(exit)) {
            assert!(script.contains(&format!("\"{code}\": {exit},")), "{code} {exit}");
        }
    }

    #[test]
    fn the_list_tells_the_target_and_where() {
        let list = req(json!({"op":"list"})).unwrap();
        let reply = json!({"ok":true,"data":{"items":[{"name":"SCOUT-1","created":1,"activity":2,"state":"lavora","reason":null,"since":null,"until":null}],"states":true}});
        let out = ProcessResult { code: 0, stdout: reply.to_string().into_bytes() };
        let shaped = answer(&list, &out, "abc", Some("vps.example"));
        assert_eq!(shaped["data"]["target"], "abc");
        assert_eq!(shaped["data"]["where"], "vps");
        assert_eq!(shaped["data"]["label"], "vps.example");
        assert_eq!(shaped["data"]["agents"][0]["name"], "SCOUT-1");
        let local = answer(&list, &out, "abc", None);
        assert_eq!(local["data"]["where"], "local");
    }

    #[test]
    fn the_team_read_is_closed() {
        let team = req(json!({"op":"team"})).unwrap();
        let reply = json!({"ok":true,"data":{"halted":true,"standby":{"state":"active","until":"2026-10-20T06:00:00+00:00","weekly_reset":false},"held":[{"session":"SCOUT-1","by_user":true},{"session":"rm -rf","by_user":true}]}});
        let shaped = answer(&team, &ProcessResult { code: 0, stdout: reply.to_string().into_bytes() }, "t", None);
        assert_eq!(shaped, json!({"ok":true,"data":{"halted":true,"standby":{"state":"active","until":"2026-10-20T06:00:00+00:00","weeklyReset":false},"held":[{"session":"SCOUT-1","byUser":true}],"burnIntent":{"state":null,"expiresAt":null,"remainingMin":null}}}));
    }

    #[test]
    fn the_full_throttle_state_is_read_closed() {
        let team = req(json!({"op":"team"})).unwrap();
        let read = |burn: Value| {
            let reply = json!({"ok":true,"data":{"halted":false,"standby":{"state":"off","until":null,"weekly_reset":false},"held":[],"burn_intent":burn}});
            answer(&team, &ProcessResult { code: 0, stdout: reply.to_string().into_bytes() }, "t", None)["data"]["burnIntent"].clone()
        };
        assert_eq!(
            read(json!({"state":"active","expires_at":"2026-10-21T22:30:00+00:00","remaining_min":59})),
            json!({"state":"active","expiresAt":"2026-10-21T22:30:00+00:00","remainingMin":59})
        );
        assert_eq!(read(json!({"state":"expired","expires_at":"2026-10-21T22:30:00+00:00","remaining_min":0}))["state"], "expired");
        // Anything outside the closed words, a text that is not a timestamp, a negative or a huge count: nothing.
        assert_eq!(
            read(json!({"state":"on fire","expires_at":"x; rm -rf /","remaining_min":-3})),
            json!({"state":null,"expiresAt":null,"remainingMin":null})
        );
        assert_eq!(read(json!({"state":"active","expires_at":"2026-10-21T22:30:00+00:00","remaining_min":9_999_999}))["remainingMin"], Value::Null);
    }

    #[test]
    fn only_the_main_window_may_call_it() {
        assert_eq!(window_refusal("main"), None);
        for label in ["broker-login", "live-screen", "Main", "", "main "] {
            assert_eq!(window_refusal(label), Some("agent_control_window"), "{label}");
        }
    }

    #[test]
    fn the_gates_of_an_action() {
        let stop = |target: &str, confirmed: bool| req(json!({"op":"stop","session":"SCOUT-1","target":target,"confirmed":confirmed})).unwrap();
        // confirmed, prepared on this target, a full link or this computer: it runs
        assert_eq!(action_refusal(&stop("abc", true), Some(VpsMode::Full), "abc"), None);
        assert_eq!(action_refusal(&stop("abc", true), None, "abc"), None);
        // the read-only link refuses every action, whatever the page sends
        for request in [
            stop("abc", true),
            req(json!({"op":"resume","target":"abc","confirmed":true})).unwrap(),
            req(json!({"op":"pause","exit":{"kind":"weekly_reset"},"target":"abc","confirmed":true})).unwrap(),
        ] {
            assert_eq!(action_refusal(&request, Some(VpsMode::ReadOnly), "abc"), Some("agent_control_read_only"));
        }
        // the team on the screen is not the one the click would reach
        assert_eq!(action_refusal(&stop("abc", true), Some(VpsMode::Full), "def"), Some("existing_team_runtime_target_changed"));
        assert_eq!(action_refusal(&stop("abc", true), None, "def"), Some("existing_team_runtime_target_changed"));
        assert_eq!(action_refusal(&stop("abc", false), Some(VpsMode::Full), "abc"), Some("agent_control_not_confirmed"));
        // reads pass, in the read-only view too
        for read in [json!({"op":"list"}), json!({"op":"team"}), json!({"op":"screen","session":"SCOUT-1"})] {
            assert_eq!(action_refusal(&req(read).unwrap(), Some(VpsMode::ReadOnly), "x"), None);
        }
    }

    #[test]
    fn a_vps_is_controlled_only_on_the_full_link_of_that_team() {
        use crate::existing_team_runtime::{grant_full_link, revoke_full_link, FULL_LINK_TEST_LOCK};
        let _serial = FULL_LINK_TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let scope = AccountScope::synthetic(b"panel-scope");
        let team = ActivatedTarget::synthetic_for_tests();
        let stop = req(json!({"op":"stop","session":"SCOUT-1","target":"t","confirmed":true})).unwrap();
        // without the grant (the read-only view, a reopening, a restart): read only
        revoke_full_link();
        assert_eq!(vps_mode(&scope, &team), VpsMode::ReadOnly);
        assert_eq!(action_refusal(&stop, Some(vps_mode(&scope, &team)), "t"), Some("agent_control_read_only"));
        // «Conferma e collega» on this team: it may be controlled
        grant_full_link(&scope, &team);
        assert_eq!(vps_mode(&scope, &team), VpsMode::Full);
        assert_eq!(action_refusal(&stop, Some(vps_mode(&scope, &team)), "t"), None);
        // the grant is that team's and that account's only
        assert_eq!(vps_mode(&AccountScope::synthetic(b"other-scope"), &team), VpsMode::ReadOnly);
        revoke_full_link();
        assert_eq!(vps_mode(&scope, &team), VpsMode::ReadOnly);
    }

    fn validated_vps() -> ValidatedHost {
        ValidatedHost::Vps {
            address: "vps.example".into(),
            user: "jht".into(),
            port: 22,
            key_path: "/k".into(),
            known_hosts: "/kh".into(),
        }
    }

    #[test]
    fn the_own_vps_is_a_full_link_and_an_existing_team_follows_its_own() {
        use crate::existing_team_runtime::{revoke_full_link, FULL_LINK_TEST_LOCK};
        let _serial = FULL_LINK_TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        revoke_full_link();
        let stop = req(json!({"op":"stop","session":"SCOUT-1","target":"t","confirmed":true})).unwrap();
        // the VPS the app set up and marked: actions pass
        let own = Destination::OwnVps { validated: validated_vps(), label: "vps.example".into(), state: OwnVpsState::Marked };
        assert_eq!(action_refusal(&stop, destination_mode(&own), "t"), None);
        // the same VPS with no mark (an old one, or its key changed): reads pass, actions do not
        for state in [OwnVpsState::Claimable, OwnVpsState::KeyChanged] {
            let unmarked = Destination::OwnVps { validated: validated_vps(), label: "vps.example".into(), state };
            assert_eq!(action_refusal(&stop, destination_mode(&unmarked), "t"), Some("agent_control_read_only"), "{state:?}");
            assert!(state.write_refusal().is_some());
        }
        // an existing team opened read only (no full link): refused
        let scope = AccountScope::synthetic(b"panel-scope-2");
        let team = ActivatedTarget::synthetic_for_tests();
        let existing = Destination::Vps {
            validated: validated_vps(),
            runtime: team.runtime.clone(),
            mode: vps_mode(&scope, &team),
            label: "vps.example".into(),
        };
        assert_eq!(action_refusal(&stop, destination_mode(&existing), "t"), Some("agent_control_read_only"));
        // reads pass on both
        let list = req(json!({"op":"list"})).unwrap();
        assert_eq!(action_refusal(&list, destination_mode(&own), "x"), None);
        assert_eq!(action_refusal(&list, destination_mode(&existing), "x"), None);
    }

    #[test]
    fn the_own_vps_commands_go_through_its_wrapper_and_its_protocol_lines() {
        let read = own_vps_read_command();
        assert!(read.contains("grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' \"$JHT_BIN\" || exit 2"));
        assert!(read.ends_with("exec \"$JHT_BIN\" desktop-chat python"));
        let argv = req(json!({"op":"stop","session":"SCOUT-1","target":"t","confirmed":true})).unwrap().argv().unwrap();
        let action = own_vps_action_command(&argv).unwrap();
        assert!(action.contains("grep -Fqx 'JHT_AGENT_CONTROL_PROTOCOL=1' \"$JHT_BIN\" || exit 2"));
        assert!(action.ends_with("exec \"$JHT_BIN\" agent-control 'stop' 'SCOUT-1' </dev/null"));
        // an older wrapper is «update the team», never a start of the container
        assert_eq!(code_of(2), "agent_control_unsupported");
        assert!(own_vps_action_command(&["stop".into(), "SCOUT-1;id".into()]).is_err());
        for command in [read, action] {
            for word in ["ensure_up", "compose", " up", "start-container"] {
                assert!(!command.contains(word), "{word}");
            }
        }
    }

    #[test]
    fn a_target_names_the_connection_the_vps_and_the_container() {
        let a = fingerprint(&["vps", "key-1", "h", "u", "22", "team", "cid-1"]);
        assert_ne!(a, fingerprint(&["vps", "key-2", "h", "u", "22", "team", "cid-1"]));
        assert_ne!(a, fingerprint(&["vps", "key-1", "h", "u", "22", "team", "cid-2"]));
        assert_ne!(a, fingerprint(&["local", "/path/jht"]));
    }

    // ── JHT-T24-b: the exclusions of the profile ───────────────────────────────────────────────
    #[test]
    fn the_exclusion_requests_are_closed_to_the_codes_that_act() {
        for (value, argv) in [
            (json!({"op":"exclusions"}), vec!["exclusions"]),
            (json!({"op":"exclusion_accept","code":"company","target":"t","confirmed":true}), vec!["exclusion-accept", "company"]),
            (json!({"op":"exclusion_withdraw","code":"wrong_location","target":"t","confirmed":true}), vec!["exclusion-withdraw", "wrong_location"]),
            (json!({"op":"exclusion_accept","code":"too_senior","target":"t","confirmed":true}), vec!["exclusion-accept", "too_senior"]),
            (json!({"op":"exclusion_withdraw","code":"too_junior","target":"t","confirmed":true}), vec!["exclusion-withdraw", "too_junior"]),
        ] {
            let request = req(value.clone());
            assert_eq!(request.and_then(|r| r.argv()), Some(argv.into_iter().map(String::from).collect()), "{value}");
        }
        for bad in [
            json!({"op":"exclusion_accept","code":"other","target":"t","confirmed":true}),
            json!({"op":"exclusion_accept","code":"company;id","target":"t","confirmed":true}),
            json!({"op":"exclusion_accept","code":"Company","target":"t","confirmed":true}),
            json!({"op":"exclusion_withdraw","code":"","target":"t","confirmed":true}),
            json!({"op":"exclusion_accept","code":"company","target":"t","confirmed":true,"note":"free text"}),
            json!({"op":"exclusion_accept","code":"company","confirmed":true}),
            json!({"op":"exclusion_accept","code":"company","target":"t"}),
            json!({"op":"exclusions","code":"company"}),
        ] {
            assert!(req(bad.clone()).and_then(|r| r.argv()).is_none(), "{bad}");
        }
    }

    #[test]
    fn the_codes_of_the_exclusions_are_the_ones_the_vocabulary_says_act() {
        let file = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../shared/feedback-reasons.json")).unwrap();
        let vocabulary: Value = serde_json::from_str(&file).unwrap();
        let acting: Vec<&str> = vocabulary["acting"].as_array().unwrap().iter().map(|code| code.as_str().unwrap()).collect();
        assert_eq!(acting, EXCLUSION_CODES);
    }

    #[test]
    fn an_exclusion_is_an_action_with_the_gates_of_an_action() {
        let accept = |target: &str, confirmed: bool| req(json!({"op":"exclusion_accept","code":"company","target":target,"confirmed":confirmed})).unwrap();
        assert_eq!(action_refusal(&accept("abc", true), Some(VpsMode::Full), "abc"), None);
        assert_eq!(action_refusal(&accept("abc", true), None, "abc"), None);
        assert_eq!(action_refusal(&accept("abc", true), Some(VpsMode::ReadOnly), "abc"), Some("agent_control_read_only"));
        assert_eq!(action_refusal(&accept("abc", true), Some(VpsMode::Full), "def"), Some("existing_team_runtime_target_changed"));
        assert_eq!(action_refusal(&accept("abc", false), None, "abc"), Some("agent_control_not_confirmed"));
        let withdraw = req(json!({"op":"exclusion_withdraw","code":"company","target":"abc","confirmed":true})).unwrap();
        assert_eq!(action_refusal(&withdraw, Some(VpsMode::ReadOnly), "abc"), Some("agent_control_read_only"));
        // the read passes on every link
        let read = req(json!({"op":"exclusions"})).unwrap();
        assert_eq!(action_refusal(&read, Some(VpsMode::ReadOnly), "x"), None);
        // the read goes on the stdin channel, an action never does
        assert!(read_input(&read).is_some());
        assert!(read_input(&accept("abc", true)).is_none());
    }

    #[test]
    fn the_exclusion_commands_on_the_own_vps_and_the_existing_team_carry_only_closed_words() {
        let argv = req(json!({"op":"exclusion_accept","code":"salary_low","target":"t","confirmed":true})).unwrap().argv().unwrap();
        let own = own_vps_action_command(&argv).unwrap();
        assert!(own.contains("grep -Fqx 'JHT_AGENT_CONTROL_PROTOCOL=1' \"$JHT_BIN\" || exit 2"));
        assert!(own.ends_with("exec \"$JHT_BIN\" agent-control 'exclusion-accept' 'salary_low' </dev/null"));
        assert!(own_vps_action_command(&["exclusion-accept".into(), "company'; id #".into()]).is_err());
    }

    #[test]
    fn the_exclusions_read_is_closed_and_tells_the_target() {
        let read = req(json!({"op":"exclusions"})).unwrap();
        let reply = json!({"ok":true,
            "exclusions":[
                {"code":"company","status":"active","decided_at":"2026-10-01 10:00:00.123"},
                {"code":"other","status":"active","decided_at":null},
                {"code":"wrong_stack","status":"on fire","decided_at":null},
                {"code":"salary_low","status":"withdrawn","decided_at":"x; rm -rf /"}],
            "feedback":[
                {"id":9,"legacy_id":3,"action":"dislike","reason":"company","created_at":"2026-10-03T10:00:00Z"},
                {"id":8,"legacy_id":2,"action":"explode","reason":"company","created_at":null},
                {"id":7,"legacy_id":0,"action":"like","reason":null,"created_at":null},
                {"id":6,"legacy_id":1,"action":"hide","reason":"My own words; here","created_at":"Thu; rm"}]});
        let out = ProcessResult { code: 0, stdout: reply.to_string().into_bytes() };
        let shaped = answer(&read, &out, "abc", Some("vps.example"));
        assert_eq!(shaped["data"]["target"], "abc");
        assert_eq!(shaped["data"]["where"], "vps");
        assert_eq!(shaped["data"]["exclusions"], json!([
            {"code":"company","status":"active","decidedAt":"2026-10-01 10:00:00.123"},
            {"code":"salary_low","status":"withdrawn","decidedAt":null}]));
        assert_eq!(shaped["data"]["feedback"], json!([
            {"id":9,"legacyId":3,"action":"dislike","reason":"company","createdAt":"2026-10-03T10:00:00Z"},
            {"id":6,"legacyId":1,"action":"hide","reason":null,"createdAt":null}]));
        assert_eq!(answer(&read, &out, "abc", None)["data"]["where"], "local");
        // an image without the writer, an unreadable answer or a failed exit: closed errors
        let unavailable = ProcessResult { code: 0, stdout: br#"{"ok":false,"error":"exclusions_unavailable"}"#.to_vec() };
        assert_eq!(answer(&read, &unavailable, "abc", None), failure("exclusions_unavailable"));
        assert_eq!(answer(&read, &ProcessResult { code: 0, stdout: b"nope".to_vec() }, "abc", None), failure("exclusions_unavailable"));
        assert_eq!(answer(&read, &ProcessResult { code: 2, stdout: vec![] }, "abc", None), failure("agent_control_unsupported"));
    }

    #[test]
    fn an_exclusion_action_answers_with_a_closed_word_or_a_closed_error() {
        let accept = req(json!({"op":"exclusion_accept","code":"company","target":"t","confirmed":true})).unwrap();
        let done = ProcessResult { code: 0, stdout: br#"{"ok":true,"op":"exclusion-accept","session":null,"result":"excluded","code":"company"}"#.to_vec() };
        assert_eq!(answer(&accept, &done, "t", None), json!({"ok":true,"data":{"result":"excluded"}}));
        let bare = ProcessResult { code: 0, stdout: br#"{"ok":true,"result":"anything else"}"#.to_vec() };
        assert_eq!(answer(&accept, &bare, "t", None), failure("agent_control_unanswered"));
        for (exit, code) in [(115, "exclusion_no_evidence"), (116, "exclusion_failed"), (101, "agent_control_refused"), (100, "agent_control_invalid")] {
            assert_eq!(answer(&accept, &ProcessResult { code: exit, stdout: vec![] }, "t", None), failure(code));
        }
    }
}

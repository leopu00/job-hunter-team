//! The tools of the runtime arrive after the welcome: the install pulls the CORE image, the host pulls the FULL one in the
//! background and switches the team to it when the onboarding has closed (`jht tools`, scripts/jht-tools.{sh,ps1}).
//!
//! The app only keeps that moving, one round every ~20 s while the desktop is open (`tools_tier_tick`, no argument:
//! nothing the webview says decides anything). Each round asks the team's own CLI how it stands
//! (`jht tools status --json`, one JSON line, closed here) and, on this computer only:
//!   * core + `pending`  → `jht tools pull`   (detached and idempotent on the host: it returns at once);
//!   * core + `ready`    → `jht tools switch` (a no-op on the host until the onboarding has closed, and once on full).
//! Both print one `JHT_PHASE tools_pull` / `JHT_PHASE tools_ready` line when they do something; that line, and only
//! exactly that, becomes the phase the screen shows. The host reads the engine, not the files the team can write, to
//! decide; this module never reads a file and names no path. A VPS has no tiers: its round is `none`.
//!
//! The round asks the same question as every command that acts on the saved host (own window, readable host) and takes
//! a step only when no other operation of the onboarding holds the slot; with the slot taken it only reads.

use crate::account_scope::{AccountScope, AccountScopeState};
use crate::onboarding::{failure, run_host_jht, OnboardingError, OnboardingNativeState, SNAPSHOT_TIMEOUT};
use crate::runtime_host::{validate_host, ProcessResult, ValidatedHost};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::State;

/// `up` on the other image recreates the container (the layers are rewritten for the user mapping once): minutes, not seconds.
const SWITCH_TIMEOUT: Duration = Duration::from_secs(600);
const STATES: [&str; 5] = ["none", "pending", "pulling", "ready", "failed"];
const TIERS: [&str; 2] = ["core", "full"];
/// The phase lines `jht tools` prints, each with the key of the text the screen shows (onboarding-runtime.i18n.ts).
const PHASES: [(&str, &str); 2] = [("JHT_PHASE tools_pull", "ui_phase_tools_pull"), ("JHT_PHASE tools_ready", "ui_phase_tools_ready")];

/// The two things a round can do, as the words of `jht tools <step>`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Step {
    Pull,
    Switch,
}

impl Step {
    fn word(self) -> &'static str {
        ["pull", "switch"][self as usize]
    }
}

/// What the screen shows: where the tools stand, and the text key of the phase a step of this round announced, if any.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ToolsTier {
    state: &'static str,
    tier: &'static str,
    message: Option<&'static str>,
}

const NONE: ToolsTier = ToolsTier { state: "none", tier: "full", message: None };

#[derive(Deserialize)]
struct Reply {
    ok: bool,
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    tier: Option<String>,
}

fn closed<'a>(value: Option<&str>, allowed: &[&'a str]) -> Option<&'a str> {
    allowed.iter().copied().find(|name| Some(*name) == value)
}

/// The last JSON line of `jht tools status --json`, closed to the words the screen knows. Anything else is no answer.
fn parse_status(result: &ProcessResult) -> Result<ToolsTier, &'static str> {
    let stdout = String::from_utf8_lossy(&result.stdout);
    let line = stdout.lines().map(str::trim).filter(|line| line.starts_with('{')).last().ok_or("tools_unavailable")?;
    let reply: Reply = serde_json::from_str(line).map_err(|_| "tools_unavailable")?;
    if !reply.ok || !result.success() {
        return Err("tools_unavailable");
    }
    let state = closed(reply.state.as_deref(), &STATES).ok_or("tools_unavailable")?;
    let tier = closed(reply.tier.as_deref(), &TIERS).ok_or("tools_unavailable")?;
    Ok(ToolsTier { state, tier, message: None })
}

/// The text key of the phase a step announced: a line that is exactly one of PHASES. The last wins.
fn announced_message(stdout: &[u8]) -> Option<&'static str> {
    String::from_utf8_lossy(stdout)
        .lines()
        .filter_map(|line| PHASES.iter().find(|(known, _)| *known == line.trim_end_matches(['\r', '\n'])).map(|(_, message)| *message))
        .last()
}

/// The step this round takes, from how the tools stand: none when there is nothing to move.
fn next_step(seen: &ToolsTier) -> Option<Step> {
    match (seen.tier, seen.state) {
        ("core", "pending") => Some(Step::Pull),
        ("core", "ready") => Some(Step::Switch),
        _ => None,
    }
}

fn status(app: &tauri::AppHandle, scope: &AccountScope, host: &ValidatedHost) -> Result<ToolsTier, &'static str> {
    match run_host_jht(app, scope, host, &["tools", "status", "--json"], None, SNAPSHOT_TIMEOUT) {
        Ok(result) => parse_status(&result),
        Err("process_timeout") => Err("timeout"),
        Err(_) => Err("tools_unavailable"),
    }
}

/// One round on this computer: read, take the step the state asks for, read again. A step that fails is not an error of
/// the round: the next one looks again.
fn round(app: &tauri::AppHandle, scope: &AccountScope, host: &ValidatedHost, may_act: bool) -> Result<ToolsTier, &'static str> {
    if !matches!(host, ValidatedHost::Local) {
        return Ok(NONE);
    }
    let seen = status(app, scope, host)?;
    let Some(step) = next_step(&seen).filter(|_| may_act) else { return Ok(seen) };
    let timeout = if step == Step::Switch { SWITCH_TIMEOUT } else { SNAPSHOT_TIMEOUT };
    let message = match run_host_jht(app, scope, host, &["tools", step.word()], None, timeout) {
        Ok(result) if result.success() => announced_message(&result.stdout),
        _ => None,
    };
    Ok(ToolsTier { message, ..status(app, scope, host).unwrap_or(seen) })
}

/// Keeps the tools moving and says where they stand. Called by the desktop every ~20 s.
#[tauri::command]
pub(crate) async fn tools_tier_tick(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<ToolsTier, OnboardingError> {
    let expected = scopes.active().map_err(failure)?;
    // Only the app's own window, and a host that can be read (a VPS has no tiers: its round is `none` anyway).
    if let Some(code) = crate::agent_control::saved_host_action_refusal(&app, window.label(), &expected) {
        return Err(failure(code));
    }
    // One operation of the onboarding at a time: with the slot taken by another, this round only reads.
    let may_act = state.try_begin();
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state.lock_expected(&worker_expected)?;
        let host = crate::direct_chat::load_persisted_host(&app, &worker_expected)?;
        let host = validate_host(&app, &host)?;
        round(&app, &worker_expected, &host, may_act)
    })
    .await
    .unwrap_or(Err("tools_unavailable"));
    if may_act {
        state.finish();
    }
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result.map_err(failure)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(code: i32, stdout: &str) -> ProcessResult {
        ProcessResult { code, stdout: stdout.as_bytes().to_vec() }
    }

    #[test]
    fn the_status_line_is_closed_to_the_words_the_screen_knows() {
        let good = r#"{"ok":true,"state":"pulling","tier":"core","reason":""}"#;
        assert_eq!(parse_status(&out(0, good)), Ok(ToolsTier { state: "pulling", tier: "core", message: None }));
        assert!(parse_status(&out(0, &format!("warming up\n{good}\n"))).is_ok(), "the last JSON line counts");
        for state in STATES {
            for tier in TIERS {
                let line = format!(r#"{{"ok":true,"state":"{state}","tier":"{tier}"}}"#);
                assert_eq!(parse_status(&out(0, &line)).map(|seen| (seen.state, seen.tier)), Ok((state, tier)));
            }
        }
        for bad in [
            r#"{"ok":true,"state":"done","tier":"core"}"#,
            r#"{"ok":true,"state":"ready","tier":"../x"}"#,
            r#"{"ok":true,"state":"ready"}"#,
            r#"{"ok":false,"error":"engine_unreachable"}"#,
            "not json",
            "",
        ] {
            assert_eq!(parse_status(&out(0, bad)), Err("tools_unavailable"), "{bad}");
        }
        assert_eq!(parse_status(&out(1, r#"{"ok":true,"state":"ready","tier":"core"}"#)), Err("tools_unavailable"));
    }

    #[test]
    fn only_the_exact_phase_lines_of_jht_tools_count() {
        assert_eq!(announced_message(b"JHT_PHASE tools_pull\r\n"), Some("ui_phase_tools_pull"));
        assert_eq!(announced_message(b"noise\nJHT_PHASE tools_pull\nJHT_PHASE tools_ready\n"), Some("ui_phase_tools_ready"));
        for other in [
            "", "JHT_PHASE", "JHT_PHASE ", "JHT_PHASE image_pull", "JHT_PHASE tools_pull extra", " JHT_PHASE tools_pull",
            "jht_phase tools_pull", "JHT_PHASE tools_ready; rm",
        ] {
            assert_eq!(announced_message(other.as_bytes()), None, "{other:?}");
        }
    }

    #[test]
    fn a_round_moves_only_a_core_image_whose_tools_are_waiting() {
        let seen = |tier, state| ToolsTier { state, tier, message: None };
        assert_eq!(next_step(&seen("core", "pending")), Some(Step::Pull));
        assert_eq!(next_step(&seen("core", "ready")), Some(Step::Switch));
        assert_eq!((Step::Pull.word(), Step::Switch.word()), ("pull", "switch"));
        for (tier, state) in [("core", "none"), ("core", "pulling"), ("core", "failed"), ("full", "pending"), ("full", "ready"), ("full", "none")] {
            assert_eq!(next_step(&seen(tier, state)), None, "{tier} {state}");
        }
    }

    /// The command takes no argument that the webview could use to decide, reaches only `jht tools`, and its steps are
    /// the two names above.
    #[test]
    fn the_round_takes_nothing_from_the_webview_and_runs_only_jht_tools() {
        let source = include_str!("tools_tier.rs").replace("\r\n", "\n");
        let production = source.split("\n#[cfg(test)]\nmod tests").next().unwrap();
        let command = production.split("pub(crate) async fn tools_tier_tick(").nth(1).unwrap().split("\n) -> ").next().unwrap();
        assert_eq!(command.matches(": ").count(), 4, "window, app, state and scopes: nothing else is passed in");
        assert!(production.contains(r#"&["tools", step.word()]"#) && production.contains(r#"&["tools", "status", "--json"]"#));
        assert_eq!(production.matches("run_host_jht(").count(), 2);
        assert!(!production.contains("std::fs") && !production.contains("Command::new"));
        let tick = production.split("pub(crate) async fn tools_tier_tick(").nth(1).unwrap();
        assert!(tick.find("saved_host_action_refusal(").unwrap() < tick.find("try_begin()").unwrap());
        assert!(tick.find("try_begin()").unwrap() < tick.find("spawn_blocking").unwrap());
    }
}

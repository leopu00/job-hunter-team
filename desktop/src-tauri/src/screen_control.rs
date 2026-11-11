//! The live screen of the CLOSER, turned on and off from the app: `jht screen on|off|status --json`.
//!
//! The screen is a container of its own that starts only on request (docker-compose.yml, `jht-screen`); its stream is published
//! by that container on 127.0.0.1 of this computer and nowhere else, and the detached window (live_screen.rs) shows it. This module
//! is only the switch: it asks the attested wrapper of this computer, never a VPS (the window can only reach this computer's
//! loopback), and tells the page one of five closed words. No sentence of the command goes through: the page has its own.
//!
//! A change counts only after the wrapper is asked again and says the screen is (or is not) running.

use crate::account_scope::AccountScopeState;
use crate::onboarding::{run_local_operation, LocalCliOperation};
use crate::runtime_host::{ProcessResult, ValidatedHost};
use serde::{Deserialize, Serialize};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::State;

/// The state words of `jht integration status`, which `jht screen status --json` prints.
const STATES: [&str; 5] = ["not_installed", "downloading", "ready", "running", "error"];
/// Reading the state asks the engine and nothing else.
const STATUS_TIMEOUT: Duration = Duration::from_secs(40);
/// Turning it on pulls the image of the tools the first time: minutes.
const ON_TIMEOUT: Duration = Duration::from_secs(600);
const OFF_TIMEOUT: Duration = Duration::from_secs(90);
/// The wrapper's exit for «not available yet»: the image of the tools is not pinned in this installation.
const NOT_AVAILABLE_EXIT: i32 = 3;

#[derive(Debug, Serialize)]
pub(crate) struct ScreenControlError {
    code: &'static str,
}

fn failure(code: &'static str) -> ScreenControlError {
    ScreenControlError { code }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenState {
    state: &'static str,
}

#[derive(Default)]
pub(crate) struct ScreenControlState {
    busy: AtomicBool,
}

#[derive(Deserialize)]
struct StateLine {
    #[serde(default)]
    state: Option<String>,
}

/// The last non-empty line of the output: the wrapper may print something before the JSON.
fn json_line(stdout: &[u8]) -> Option<&str> {
    std::str::from_utf8(stdout)
        .ok()?
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .last()
}

/// The failure of a run, as a code of the app's catalog.
fn run_failure(error: &'static str) -> &'static str {
    match error {
        "process_timeout" => "timeout",
        "runtime_missing" => "runtime_missing",
        code if code.starts_with("account_") || code.starts_with("local_account_") => code,
        _ => "screen_failed",
    }
}

/// `jht screen status --json`: the state word, closed. Anything else is `screen_failed`; exit 3 is «not available yet».
fn parse_state(result: Result<ProcessResult, &'static str>) -> Result<&'static str, &'static str> {
    let output = result.map_err(run_failure)?;
    if output.code == NOT_AVAILABLE_EXIT {
        return Err("screen_unavailable");
    }
    if !output.success() {
        return Err("screen_failed");
    }
    let line: StateLine = json_line(&output.stdout)
        .and_then(|line| serde_json::from_str(line).ok())
        .ok_or("screen_failed")?;
    let word = line.state.as_deref().unwrap_or_default();
    STATES.iter().find(|known| **known == word).copied().ok_or("screen_failed")
}

/// What `on` or `off` itself answered: only whether it worked (a refusal says «not available yet» with exit 3).
fn parse_change(result: Result<ProcessResult, &'static str>) -> Result<(), &'static str> {
    let output = result.map_err(run_failure)?;
    match output.code {
        0 => Ok(()),
        NOT_AVAILABLE_EXIT => Err("screen_unavailable"),
        _ => Err("screen_failed"),
    }
}

/// The change is done when the state read afterwards says so: `on` leaves it running, `off` leaves it not running.
fn verified(wanted_on: bool, after: &'static str) -> Result<&'static str, &'static str> {
    if wanted_on == (after == "running") {
        Ok(after)
    } else {
        Err("screen_failed")
    }
}

fn host_is_local(app: &tauri::AppHandle, scope: &crate::account_scope::AccountScope) -> Result<(), &'static str> {
    match crate::broker_view::active_host(app, scope)? {
        ValidatedHost::Local => Ok(()),
        ValidatedHost::Vps { .. } => Err("screen_local_only"),
    }
}

#[tauri::command]
pub(crate) async fn screen_status(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<ScreenState, ScreenControlError> {
    let scope = scopes.active().map_err(failure)?;
    tauri::async_runtime::spawn_blocking(move || {
        host_is_local(&app, &scope)?;
        parse_state(run_local_operation(&app, &scope, LocalCliOperation::ScreenStatus, STATUS_TIMEOUT))
            .map(|state| ScreenState { state })
    })
    .await
    .unwrap_or(Err("screen_failed"))
    .map_err(failure)
}

/// Turns the screen on or off, one change at a time, and answers the state read afterwards.
#[tauri::command]
pub(crate) async fn screen_set(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, ScreenControlState>,
    scopes: State<'_, AccountScopeState>,
    on: bool,
) -> Result<ScreenState, ScreenControlError> {
    let scope = scopes.active().map_err(failure)?;
    if let Some(code) = crate::agent_control::saved_host_action_refusal(&app, window.label(), &scope) {
        return Err(failure(code));
    }
    if state
        .busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    let worker_scope = scope.clone();
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        host_is_local(&worker_app, &worker_scope)?;
        let (operation, timeout) = if on {
            (LocalCliOperation::ScreenOn, ON_TIMEOUT)
        } else {
            (LocalCliOperation::ScreenOff, OFF_TIMEOUT)
        };
        parse_change(run_local_operation(&worker_app, &worker_scope, operation, timeout))?;
        let after = parse_state(run_local_operation(
            &worker_app,
            &worker_scope,
            LocalCliOperation::ScreenStatus,
            STATUS_TIMEOUT,
        ))?;
        verified(on, after).map(|state| ScreenState { state })
    })
    .await
    .unwrap_or(Err("screen_failed"));
    state.busy.store(false, Ordering::Release);
    result.map_err(failure)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn output(code: i32, stdout: &str) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult {
            code,
            stdout: stdout.as_bytes().to_vec(),
        })
    }

    #[test]
    fn the_state_is_one_of_the_five_words_and_nothing_else() {
        for word in STATES {
            let line = format!(r#"{{"id":"screen","state":"{word}","reason":"a sentence of the wrapper"}}"#);
            assert_eq!(parse_state(output(0, &line)), Ok(word));
        }
        for line in [
            r#"{"id":"screen","state":"on fire","reason":"x"}"#,
            r#"{"id":"screen","reason":"x"}"#,
            "not json",
            "",
        ] {
            assert_eq!(parse_state(output(0, line)), Err("screen_failed"), "{line}");
        }
    }

    #[test]
    fn the_json_line_may_follow_lines_the_wrapper_printed() {
        let text = "pulling something\n{\"id\":\"screen\",\"state\":\"ready\",\"reason\":\"x\"}\n";
        assert_eq!(parse_state(output(0, text)), Ok("ready"));
    }

    #[test]
    fn a_failed_read_is_a_code_of_the_catalog_never_the_commands_sentence() {
        assert_eq!(parse_state(output(1, r#"{"state":"running"}"#)), Err("screen_failed"));
        assert_eq!(parse_state(output(NOT_AVAILABLE_EXIT, "")), Err("screen_unavailable"));
        assert_eq!(parse_state(Err("process_timeout")), Err("timeout"));
        assert_eq!(parse_state(Err("runtime_missing")), Err("runtime_missing"));
        assert_eq!(parse_state(Err("account_scope_changed")), Err("account_scope_changed"));
        assert_eq!(parse_state(Err("spawn failed with the key sk-123")), Err("screen_failed"));
    }

    #[test]
    fn a_change_is_what_the_exit_says_and_the_state_read_afterwards_confirms_it() {
        assert_eq!(parse_change(output(0, "{}")), Ok(()));
        assert_eq!(parse_change(output(1, "{}")), Err("screen_failed"));
        assert_eq!(parse_change(output(NOT_AVAILABLE_EXIT, "")), Err("screen_unavailable"));
        assert_eq!(parse_change(Err("process_timeout")), Err("timeout"));
        assert_eq!(verified(true, "running"), Ok("running"));
        assert_eq!(verified(true, "ready"), Err("screen_failed"));
        assert_eq!(verified(false, "ready"), Ok("ready"));
        assert_eq!(verified(false, "not_installed"), Ok("not_installed"));
        assert_eq!(verified(false, "running"), Err("screen_failed"));
    }

    #[test]
    fn the_wrapper_is_asked_with_the_words_of_the_cli() {
        assert_eq!(LocalCliOperation::ScreenStatus.argv(), ["screen", "status", "--json"]);
        assert_eq!(LocalCliOperation::ScreenOn.argv(), ["screen", "on", "--json"]);
        assert_eq!(LocalCliOperation::ScreenOff.argv(), ["screen", "off", "--json"]);
    }
}

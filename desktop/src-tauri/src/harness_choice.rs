//! The program that drives the team's agents (Codex or Pi), chosen from the app (Settings, «Provider»).
//!
//! The choice is the `harness` key of the team's config, written ONLY by the team's own CLI:
//! `jht providers harness [codex|pi] --json` (cli/src/commands/providers-harness-json.js), on this computer
//! through the attested wrapper and on a VPS through SSH (`run_host_jht`). The app writes no file and names
//! no path. The CLI answers one JSON line; here it is closed again: the harness is one of two names, the login
//! state one of four words, the provider a few lowercase letters. A write counts only after the CLI is asked
//! again and says the harness that was chosen.
//!
//! Both commands act on the account's saved host. The write asks the window and the link first (on an existing
//! team only the full link may change the team), and takes the one-operation-at-a-time slot of the onboarding.

use crate::account_scope::{AccountScope, AccountScopeState};
use crate::onboarding::{failure, run_host_jht, OnboardingError, OnboardingNativeState, SNAPSHOT_TIMEOUT};
use crate::runtime_host::{validate_host, ProcessResult, ValidatedHost};
use serde::{Deserialize, Serialize};
use tauri::State;

const HARNESSES: [&str; 2] = ["codex", "pi"];
/// The four words the CLI says for the login (one string: they are words of the CLI, not codes of the app).
const LOGINS: &str = "signed_in signed_out not_needed unknown";

/// What the Settings page shows: the program in charge, whether Pi may be chosen for this provider, and the
/// state of the login of the program in charge.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HarnessChoice {
    harness: &'static str,
    provider: String,
    pi_allowed: bool,
    login: &'static str,
    /// The entry names of Pi's sign-in file when it is there but is not the one for this provider (a file with only Anthropic's):
    /// lowercase words, at most eight, never a value. Empty in every other case.
    login_found: Vec<String>,
}

#[derive(Deserialize)]
struct Reply {
    ok: bool,
    #[serde(default)]
    harness: Option<String>,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    pi_allowed: Option<bool>,
    #[serde(default)]
    login: Option<String>,
    #[serde(default)]
    login_found: Option<Vec<String>>,
    #[serde(default)]
    error: Option<String>,
}

fn closed<'a>(value: Option<&str>, allowed: &[&'a str]) -> Option<&'a str> {
    allowed.iter().copied().find(|name| Some(*name) == value)
}

/// The last JSON line of `jht providers harness ... --json`, closed. `unavailable` is the code of anything that
/// is not an answer; the CLI's own refusals keep their code when the app has a sentence for it.
fn parse(result: &ProcessResult, unavailable: &'static str) -> Result<HarnessChoice, &'static str> {
    let stdout = String::from_utf8_lossy(&result.stdout);
    let line = stdout.lines().map(str::trim).filter(|line| line.starts_with('{')).last().ok_or(unavailable)?;
    let reply: Reply = serde_json::from_str(line).map_err(|_| unavailable)?;
    if !reply.ok || !result.success() {
        return Err(match reply.error.as_deref() {
            Some("harness_refused") => "harness_refused",
            Some("harness_no_provider") => "harness_no_provider",
            _ => unavailable,
        });
    }
    let harness = closed(reply.harness.as_deref(), &HARNESSES).ok_or(unavailable)?;
    let logins: Vec<&str> = LOGINS.split(' ').collect();
    let login = closed(reply.login.as_deref(), &logins).ok_or(unavailable)?;
    let provider = reply
        .provider
        .filter(|name| name.len() <= 16 && name.chars().all(|c| c.is_ascii_lowercase()))
        .ok_or(unavailable)?;
    let login_found = reply
        .login_found
        .unwrap_or_default()
        .into_iter()
        .filter(|name| (1..=40).contains(&name.len()) && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '_' | '-')))
        .take(8)
        .collect();
    Ok(HarnessChoice { harness, provider, pi_allowed: reply.pi_allowed.ok_or(unavailable)?, login, login_found })
}

/// `jht providers harness [name] --json` on the saved host, under the account scope the caller holds.
fn ask(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ValidatedHost,
    name: Option<&str>,
    unavailable: &'static str,
) -> Result<HarnessChoice, &'static str> {
    let mut args = vec!["providers", "harness"];
    args.extend(name);
    args.push("--json");
    match run_host_jht(app, scope, host, &args, None, SNAPSHOT_TIMEOUT) {
        Ok(result) => parse(&result, unavailable),
        Err("process_timeout") => Err("timeout"),
        Err(_) => Err(unavailable),
    }
}

fn saved_host(app: &tauri::AppHandle, scope: &AccountScope) -> Result<ValidatedHost, &'static str> {
    let host = crate::direct_chat::load_persisted_host(app, scope)?;
    validate_host(app, &host)
}

/// Which program drives the agents now, and the state of its login. A read.
#[tauri::command]
pub(crate) async fn harness_choice_read(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<HarnessChoice, OnboardingError> {
    let expected = scopes.active().map_err(failure)?;
    let scope_state = scopes.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state.lock_expected(&expected)?;
        let host = saved_host(&app, &expected)?;
        ask(&app, &expected, &host, None, "harness_unavailable")
    })
    .await
    .unwrap_or(Err("harness_unavailable"))
    .map_err(failure)
}

/// Changes the program that drives the agents: `codex` or `pi`, nothing else reaches the command line. The team
/// is not restarted here; the page says it must be.
#[tauri::command]
pub(crate) async fn harness_choice_set(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
    harness: String,
) -> Result<HarnessChoice, OnboardingError> {
    let asked = closed(Some(harness.as_str()), &HARNESSES).ok_or_else(|| failure("harness_set_failed"))?;
    let expected = scopes.active().map_err(failure)?;
    // It writes the team's config on its host: on an existing team, only on the full link.
    if let Some(code) = crate::agent_control::saved_host_action_refusal(&app, window.label(), &expected) {
        return Err(failure(code));
    }
    if !state.try_begin() {
        return Err(failure("operation_in_progress"));
    }
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state.lock_expected(&worker_expected)?;
        let host = saved_host(&app, &worker_expected)?;
        ask(&app, &worker_expected, &host, Some(asked), "harness_set_failed")?;
        // the choice counts only if the team's config says it when asked again
        let now = ask(&app, &worker_expected, &host, None, "harness_set_failed")?;
        if now.harness == asked { Ok(now) } else { Err("harness_set_failed") }
    })
    .await
    .unwrap_or(Err("harness_set_failed"));
    state.finish();
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result.map_err(failure)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn out(code: i32, stdout: &str) -> ProcessResult {
        ProcessResult { code, stdout: stdout.as_bytes().to_vec() }
    }

    const GOOD: &str = r#"{"ok":true,"harness":"pi","changed":true,"provider":"openai","pi_allowed":true,"login":"signed_out"}"#;

    #[test]
    fn the_cli_line_is_closed_to_the_shapes_the_page_knows() {
        let choice = parse(&out(0, GOOD), "harness_unavailable").unwrap();
        assert_eq!(choice, HarnessChoice { harness: "pi", provider: "openai".into(), pi_allowed: true, login: "signed_out", login_found: vec![] });
        // noise before the line is ignored: the last JSON line counts
        assert!(parse(&out(0, &format!("warming up\n{GOOD}\n")), "x").is_ok());
        for bad in [
            r#"{"ok":true,"harness":"opencode","provider":"openai","pi_allowed":true,"login":"signed_in"}"#,
            r#"{"ok":true,"harness":"pi","provider":"openai","pi_allowed":true,"login":"/etc/passwd"}"#,
            r#"{"ok":true,"harness":"pi","provider":"../x","pi_allowed":true,"login":"signed_in"}"#,
            r#"{"ok":true,"harness":"pi","provider":"openai","login":"signed_in"}"#,
            "not json",
            "",
        ] {
            assert_eq!(parse(&out(0, bad), "harness_unavailable"), Err("harness_unavailable"), "{bad}");
        }
    }

    #[test]
    fn the_names_in_a_sign_in_that_is_not_the_right_one_are_closed_to_plain_words() {
        let line = r#"{"ok":true,"harness":"pi","provider":"openai","pi_allowed":true,"login":"signed_out","login_found":["anthropic","Bad Name","x\ny","a_b-c.1","","zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"]}"#;
        let choice = parse(&out(0, line), "harness_unavailable").unwrap();
        assert_eq!(choice.login_found, vec!["anthropic".to_owned(), "a_b-c.1".to_owned()], "a name that is not a plain lowercase word is dropped");
        let nine = format!(r#"{{"ok":true,"harness":"pi","provider":"openai","pi_allowed":true,"login":"signed_out","login_found":[{}]}}"#,
            (0..9).map(|i| format!("\"n{i}\"")).collect::<Vec<_>>().join(","));
        assert_eq!(parse(&out(0, &nine), "x").unwrap().login_found.len(), 8, "at most eight");
        // not a list of words: nothing, and the answer still stands
        let odd = r#"{"ok":true,"harness":"pi","provider":"openai","pi_allowed":true,"login":"signed_out","login_found":"anthropic"}"#;
        assert_eq!(parse(&out(0, odd), "x"), Err("x"), "a field of the wrong type is not an answer");
    }

    #[test]
    fn a_failed_run_is_never_an_answer_and_a_refusal_keeps_its_code() {
        assert_eq!(parse(&out(1, GOOD), "harness_set_failed"), Err("harness_set_failed"));
        assert_eq!(parse(&out(1, r#"{"ok":false,"error":"harness_refused"}"#), "harness_set_failed"), Err("harness_refused"));
        assert_eq!(parse(&out(1, r#"{"ok":false,"error":"harness_no_provider"}"#), "harness_set_failed"), Err("harness_no_provider"));
        assert_eq!(parse(&out(1, r#"{"ok":false,"error":"harness_write_failed"}"#), "harness_set_failed"), Err("harness_set_failed"));
        assert_eq!(parse(&out(0, r#"{"ok":false,"error":"harness_refused"}"#), "x"), Err("harness_refused"));
    }

    #[test]
    fn only_the_two_names_reach_the_command_line_and_the_write_asks_before_anything() {
        assert_eq!(closed(Some("pi"), &HARNESSES), Some("pi"));
        assert_eq!(closed(Some("codex"), &HARNESSES), Some("codex"));
        for bad in ["", "Pi", "pi --json", "codex;rm", "opencode"] {
            assert_eq!(closed(Some(bad), &HARNESSES), None, "{bad}");
        }
        let source = include_str!("harness_choice.rs").replace("\r\n", "\n");
        let set = source.split("pub(crate) async fn harness_choice_set(").nth(1).unwrap().split("\n}\n").next().unwrap().to_owned();
        let asked = set.find("saved_host_action_refusal(").unwrap();
        assert!(asked < set.find("try_begin()").unwrap() && asked < set.find("spawn_blocking").unwrap());
        assert!(set.contains("window.label()") && set.contains("failure(code)"));
    }
}

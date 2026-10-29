//! The sign-in of the team's provider, seen and taken off from the app (Settings, «Provider»).
//!
//! The design is banda/piani/DISEGNO-logout-provider-20261029.md (approved with conditions):
//! - one command, a closed request: `{op:"status"}` or `{op:"logout", confirmed:true}` (`deny_unknown_fields`;
//!   a logout without `confirmed:true` is refused, a guard against a slip and not a boundary);
//! - the gates, in order, are the `team_settings` ones plus the owner of the folder: the `main` window, the
//!   request, the account scope held for the whole run (no await between the gates and the run), THIS
//!   computer's team (an existing team's VPS and the app's own VPS are not reached here), the account being
//!   the owner of the folder (`Mine`), the wrapper that knows `agent-control`, and the attested container
//!   (the wrapper never starts it);
//! - the app names NO provider and NO file: the box's door (`jht agent-control provider ...`, cli/src/lib/
//!   provider-logout.js) takes the team's active provider and removes its closed list of credential files,
//!   and says whether anything of it is left;
//! - the answer is closed again here: a provider of the three, a number of files 0..=8, a code of the four the
//!   box has. The text of the box never reaches the page, and neither does the name of a file.
use crate::{
    account_scope::{AccountScope, AccountScopeState},
    direct_chat,
    runtime_host::{ProcessResult, ValidatedHost},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    cell::RefCell,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::State;

const TIMEOUT: Duration = Duration::from_secs(30);
const REQUEST_MAX_BYTES: usize = 256;
const PROVIDERS: [&str; 3] = ["claude", "codex", "kimi"];
/// The most files the box lists for one provider.
const REMOVED_MAX: u64 = 8;
/// What the box says when a logout is not done, and that is the person's business to read.
const BOX_CODES: [&str; 4] = ["provider_unknown", "provider_not_subscription", "provider_logout_incomplete", "provider_logout_failed"];

fn failure(code: &str) -> Value {
    json!({ "ok": false, "error": code })
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Status {},
    Logout { confirmed: bool },
}

impl Request {
    fn verb(&self) -> &'static str {
        match self {
            Request::Status {} => "status",
            Request::Logout { .. } => "logout",
        }
    }
}

/// The request as the page may send it: closed shape, and a logout carries `confirmed:true`.
fn closed_request(request: Value) -> Result<Request, &'static str> {
    if serde_json::to_vec(&request).map_or(true, |bytes| bytes.len() > REQUEST_MAX_BYTES) {
        return Err("team_provider_request_invalid");
    }
    match serde_json::from_value::<Request>(request) {
        Ok(Request::Logout { confirmed: false }) | Err(_) => Err("team_provider_request_invalid"),
        Ok(request) => Ok(request),
    }
}

/// What the box answered, closed again: the page reads nothing the box wrote beyond these.
fn reply(request: &Request, result: Result<ProcessResult, &'static str>) -> Value {
    let Ok(result) = result else { return failure("team_provider_unavailable") };
    let line: Option<Value> =
        String::from_utf8_lossy(&result.stdout).lines().last().and_then(|line| serde_json::from_str(line).ok());
    let Some(Value::Object(out)) = line else {
        // no JSON at all: an image that does not know the verb, or no team to ask
        return failure(if result.code == 113 { "agent_control_no_team" } else { "existing_team_runtime_outdated" });
    };
    if result.code == 0 && out.get("ok") == Some(&Value::Bool(true)) {
        let provider = out.get("provider").and_then(Value::as_str).filter(|name| PROVIDERS.contains(name));
        let authenticated = out.get("authenticated").and_then(Value::as_bool);
        let (Some(provider), Some(authenticated)) = (provider, authenticated) else {
            return failure("team_provider_unavailable");
        };
        return match request {
            Request::Status {} => json!({ "ok": true, "provider": provider, "authenticated": authenticated }),
            Request::Logout { .. } => {
                // a sign-out that is not one is never told as done, whatever the box says
                let removed = out.get("removed").and_then(Value::as_u64).filter(|count| *count <= REMOVED_MAX);
                match (authenticated, removed) {
                    (false, Some(removed)) => json!({ "ok": true, "provider": provider, "authenticated": false, "removed": removed }),
                    (true, _) => failure("provider_logout_incomplete"),
                    _ => failure("team_provider_unavailable"),
                }
            }
        };
    }
    match out.get("error").and_then(Value::as_str) {
        Some(code) if BOX_CODES.contains(&code) => failure(code),
        // the door does not know the form: an image older than this command
        Some("agent_control_invalid") => failure("existing_team_runtime_outdated"),
        Some("agent_control_no_team") => failure("agent_control_no_team"),
        _ => failure("team_provider_unavailable"),
    }
}

/// The whole decision, with the wrapper and the run injected (the order the tests drive).
fn team_provider_with(
    request: Value,
    window_is_main: bool,
    wrapper: impl FnOnce() -> Result<(), &'static str>,
    run: impl FnOnce(&Request) -> Result<ProcessResult, &'static str>,
) -> Value {
    if !direct_chat::window_may_write(if window_is_main { "main" } else { "other" }) {
        return failure("team_provider_window_refused");
    }
    let request = match closed_request(request) {
        Ok(request) => request,
        Err(code) => return failure(code),
    };
    if let Err(code) = wrapper() {
        return failure(code);
    }
    reply(&request, run(&request))
}

/// This computer's team, once this account owns its folder, and the wrapper that has the panel's door. A
/// VPS (an existing team's, or the app's own) and a team of another profile, of nobody or not yet taken, are
/// the same refusal: no sign-in of those is shown or touched from here.
fn local_wrapper(app: &tauri::AppHandle, scope: &AccountScope) -> Result<PathBuf, &'static str> {
    let refused = "team_provider_read_only";
    let host = direct_chat::load_persisted_host(app, scope).map_err(|_| refused)?;
    let validated = crate::runtime_host::validate_host_for_scope(app, &host, scope).map_err(|_| refused)?;
    if !matches!(validated, ValidatedHost::Local) {
        return Err(refused);
    }
    let marker = crate::account_scope::local_owner_marker_path(app)?;
    crate::account_scope::verify_local_runtime_owner(&marker, scope).map_err(|code| {
        if code.starts_with("local_account_owner") {
            refused
        } else {
            code
        }
    })?;
    let wrapper = crate::onboarding::verified_local_wrapper_path(app)?;
    if !crate::onboarding::wrapper_has_agent_control(&wrapper) {
        return Err("agent_control_unsupported");
    }
    Ok(wrapper)
}

fn run_door(wrapper: &Path, request: &Request) -> Result<ProcessResult, &'static str> {
    crate::onboarding::run_verified_local_wrapper(wrapper, &["agent-control", "provider", request.verb()], None, TIMEOUT)
}

/// Whether this computer's team has its sign-in (`status`), or takes it off (`logout`).
#[tauri::command]
pub(crate) async fn team_provider(
    app: tauri::AppHandle,
    window: tauri::Window,
    scopes: State<'_, AccountScopeState>,
    request: Value,
) -> Result<Value, String> {
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(failure("account_scope_unavailable")),
    };
    let main = window.label() == "main";
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        // The scope is held for the whole run: the gates and the box's door happen under it, with no await between.
        let Ok(_scope) = scope_state.lock_expected(&worker_expected) else {
            return failure("account_scope_changed");
        };
        let found: RefCell<Option<PathBuf>> = RefCell::new(None);
        team_provider_with(
            request,
            main,
            || {
                *found.borrow_mut() = Some(local_wrapper(&app, &worker_expected)?);
                Ok(())
            },
            |request| run_door(found.borrow().as_ref().ok_or("runtime_missing")?, request),
        )
    })
    .await
    .unwrap_or_else(|_| failure("team_provider_unavailable"));
    if scopes.lock_expected(&expected).is_err() {
        return Ok(failure("account_scope_changed"));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn exited(code: i32, stdout: &str) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult { code, stdout: stdout.as_bytes().to_vec() })
    }

    fn logout() -> Value {
        json!({ "op": "logout", "confirmed": true })
    }

    /// One drive of `team_provider_with`: the reply, how often the wrapper gate and the run were reached, and the verb.
    fn drive(
        request: Value,
        main: bool,
        gate: Result<(), &'static str>,
        ran: Result<ProcessResult, &'static str>,
    ) -> (Value, u32, u32, Option<&'static str>) {
        let (gates, runs) = (Cell::new(0), Cell::new(0));
        let verb = Cell::new(None);
        let answer = team_provider_with(
            request,
            main,
            || {
                gates.set(gates.get() + 1);
                gate
            },
            |request| {
                runs.set(runs.get() + 1);
                verb.set(Some(request.verb()));
                ran
            },
        );
        (answer, gates.get(), runs.get(), verb.get())
    }

    #[test]
    fn only_the_main_window_asks_and_nothing_runs_for_another() {
        let (answer, gates, runs, _) = drive(logout(), false, Ok(()), exited(0, "{}"));
        assert_eq!(answer, failure("team_provider_window_refused"));
        assert_eq!((gates, runs), (0, 0));
    }

    #[test]
    fn a_request_that_is_not_closed_is_refused_before_the_wrapper_and_the_run() {
        let cases = [
            json!({ "op": "logout" }),
            json!({ "op": "logout", "confirmed": false }),
            json!({ "op": "logout", "confirmed": "true" }),
            json!({ "op": "logout", "confirmed": true, "provider": "claude" }),
            json!({ "op": "logout", "confirmed": true, "path": ".codex/auth.json" }),
            json!({ "op": "status", "confirmed": true }),
            json!({ "op": "status", "provider": "codex" }),
            json!({ "op": "reset" }),
            json!({ "op": "LOGOUT", "confirmed": true }),
            json!({}),
            json!("logout"),
            json!(null),
            json!({ "op": "logout", "confirmed": true, "pad": "x".repeat(400) }),
        ];
        for case in cases {
            let (answer, gates, runs, _) = drive(case.clone(), true, Ok(()), exited(0, "{}"));
            assert_eq!(answer, failure("team_provider_request_invalid"), "{case}");
            assert_eq!((gates, runs), (0, 0), "{case}");
        }
    }

    #[test]
    fn the_gate_of_the_team_decides_before_anything_runs_and_its_code_is_what_the_page_gets() {
        for code in ["team_provider_read_only", "agent_control_unsupported", "local_account_scope_missing", "runtime_missing"] {
            let (answer, gates, runs, _) = drive(logout(), true, Err(code), exited(0, "{}"));
            assert_eq!(answer, failure(code));
            assert_eq!((gates, runs), (1, 0), "{code}");
        }
    }

    #[test]
    fn each_request_asks_the_box_for_its_own_verb_and_nothing_else() {
        let status = r#"{"ok":true,"provider":"codex","authenticated":true}"#;
        let (answer, _, runs, verb) = drive(json!({ "op": "status" }), true, Ok(()), exited(0, status));
        assert_eq!(answer, json!({ "ok": true, "provider": "codex", "authenticated": true }));
        assert_eq!((runs, verb), (1, Some("status")));
        let done = r#"{"ok":true,"provider":"claude","authenticated":false,"removed":2}"#;
        let (answer, _, runs, verb) = drive(logout(), true, Ok(()), exited(0, done));
        assert_eq!(answer, json!({ "ok": true, "provider": "claude", "authenticated": false, "removed": 2 }));
        assert_eq!((runs, verb), (1, Some("logout")));
    }

    #[test]
    fn a_logout_the_box_does_not_finish_is_never_told_as_done() {
        // a box that says ok but still signed in
        let still = r#"{"ok":true,"provider":"codex","authenticated":true,"removed":1}"#;
        let (answer, ..) = drive(logout(), true, Ok(()), exited(0, still));
        assert_eq!(answer, failure("provider_logout_incomplete"));
        // a box that says ok and leaves out how many, or too many
        for body in [
            r#"{"ok":true,"provider":"codex","authenticated":false}"#,
            r#"{"ok":true,"provider":"codex","authenticated":false,"removed":9}"#,
            r#"{"ok":true,"provider":"codex","authenticated":false,"removed":-1}"#,
        ] {
            let (answer, ..) = drive(logout(), true, Ok(()), exited(0, body));
            assert_eq!(answer, failure("team_provider_unavailable"), "{body}");
        }
        // the four codes of the box pass; anything else is «unavailable»
        for code in BOX_CODES {
            let (answer, ..) = drive(logout(), true, Ok(()), exited(1, &format!(r#"{{"ok":false,"error":"{code}"}}"#)));
            assert_eq!(answer, failure(code));
        }
        let (answer, ..) = drive(logout(), true, Ok(()), exited(1, r#"{"ok":false,"error":"rm: /jht_home/.codex/auth.json: denied"}"#));
        assert_eq!(answer, failure("team_provider_unavailable"));
    }

    #[test]
    fn the_answer_is_closed_to_three_providers_and_the_text_of_the_box_does_not_come_out() {
        for body in [
            r#"{"ok":true,"provider":"../../etc","authenticated":true}"#,
            r#"{"ok":true,"provider":"openai","authenticated":true}"#,
            r#"{"ok":true,"authenticated":true}"#,
            r#"{"ok":true,"provider":"codex","authenticated":"yes"}"#,
        ] {
            let (answer, ..) = drive(json!({ "op": "status" }), true, Ok(()), exited(0, body));
            assert_eq!(answer, failure("team_provider_unavailable"), "{body}");
        }
        let noisy = r#"{"ok":true,"provider":"codex","authenticated":true,"note":"/jht_home/.codex/auth.json","token":"synthetic"}"#;
        let (answer, ..) = drive(json!({ "op": "status" }), true, Ok(()), exited(0, noisy));
        assert_eq!(answer, json!({ "ok": true, "provider": "codex", "authenticated": true }));
        assert!(!answer.to_string().contains("jht_home") && !answer.to_string().contains("synthetic"));
    }

    #[test]
    fn a_box_without_the_form_or_without_a_team_has_its_own_closed_codes() {
        let (answer, ..) = drive(logout(), true, Ok(()), exited(100, r#"{"ok":false,"error":"agent_control_invalid"}"#));
        assert_eq!(answer, failure("existing_team_runtime_outdated"));
        let (answer, ..) = drive(logout(), true, Ok(()), exited(127, "unknown command"));
        assert_eq!(answer, failure("existing_team_runtime_outdated"));
        let (answer, ..) = drive(logout(), true, Ok(()), exited(113, r#"{"ok":false,"error":"agent_control_no_team"}"#));
        assert_eq!(answer, failure("agent_control_no_team"));
        let (answer, ..) = drive(logout(), true, Err("runtime_missing"), exited(0, "{}"));
        assert_eq!(answer, failure("runtime_missing"));
        let (answer, ..) = drive(logout(), true, Ok(()), Err("runtime_unavailable"));
        assert_eq!(answer, failure("team_provider_unavailable"));
    }

    fn source() -> String {
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/team_provider.rs")).unwrap()
    }

    #[test]
    fn only_this_computers_team_of_this_account_is_reached_and_the_gates_come_in_order() {
        let source = source();
        let wrapper = source.split("fn local_wrapper(").nth(1).unwrap().split("fn run_door(").next().unwrap();
        // the host must be the local one before the owner is asked, the owner before the wrapper, the door last
        let at = |needle: &str| wrapper.find(needle).unwrap_or_else(|| panic!("{needle}"));
        assert!(at("ValidatedHost::Local") < at("verify_local_runtime_owner"));
        assert!(at("verify_local_runtime_owner") < at("verified_local_wrapper_path"));
        assert!(at("verified_local_wrapper_path") < at("wrapper_has_agent_control"));
        assert!(wrapper.contains("code.starts_with(\"local_account_owner\")"));
        // the work: the window, then the request, then the wrapper gate, then the run
        let with = source.split("fn team_provider_with(").nth(1).unwrap().split("/// This computer's team").next().unwrap();
        assert!(with.find("window_may_write").unwrap() < with.find("closed_request(").unwrap());
        assert!(with.find("closed_request(").unwrap() < with.find("wrapper()").unwrap());
        assert!(with.find("wrapper()").unwrap() < with.find("run(&request)").unwrap());
        // no ssh, no existing team's target, no claim of the folder, no command of the app's own
        for forbidden in ["run_ssh_command", "selected_or_own", "claim", "validate_local_runtime", "Command::new", "std::fs::remove"] {
            assert!(!source.split("#[cfg(test)]").next().unwrap().replace("`", "").contains(forbidden), "{forbidden}");
        }
        // the scope is held across the gates and the run, in one synchronous closure
        let command = source.split("pub(crate) async fn team_provider(").nth(1).unwrap().split("#[cfg(test)]").next().unwrap();
        assert!(command.contains("lock_expected(&worker_expected)") && command.contains("spawn_blocking"));
        assert!(command.find("lock_expected(&worker_expected)").unwrap() < command.find("team_provider_with(").unwrap());
        let inner = command.split("spawn_blocking(move || {").nth(1).unwrap().split(".await").next().unwrap();
        assert!(!inner.contains(".await"), "no await between the gates and the run");
    }

    #[test]
    fn the_door_is_asked_for_a_verb_the_app_chose_and_no_argument_comes_from_the_page() {
        let source = source();
        let door = source.split("fn run_door(").nth(1).unwrap().split("/// Whether this computer").next().unwrap();
        assert!(door.contains("&[\"agent-control\", \"provider\", request.verb()]"));
        assert!(door.contains("None, TIMEOUT"), "nothing on stdin");
        let verbs = source.split("fn verb(&self)").nth(1).unwrap().split("\n    }\n").next().unwrap();
        assert!(verbs.contains("\"status\"") && verbs.contains("\"logout\"") && !verbs.contains("provider_name"));
    }
}

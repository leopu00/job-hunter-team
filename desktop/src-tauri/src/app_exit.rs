//! Leaving the app: what happens to the team and the runtime when the person closes it.
//!
//! The agents do not live in the window: they live in the container (on a Mac inside the Podman machine, a virtual
//! machine that holds gigabytes of memory), and they went on working, and spending, with the window closed and nothing
//! saying so. Closing is therefore a decision, and there are three ways, as in the game's shutdown dialog:
//!
//! - `ordered`: the Capitano has every agent write down where it had got to, the agents stop, then the container and the
//!   machine are stopped. Tomorrow the work picks up instead of starting again.
//! - `forced`: the team, the container and the machine are stopped now, nobody is waited for.
//! - `detach`: only the window closes; the team goes on working.
//!
//! A team on a VPS is never touched from here: with it there is one way out, `detach`, and the commands that stop things
//! refuse it. The window's close button and ⌘Q do not leave by themselves: they ask the page (`app-exit-requested`), which
//! asks the person or applies the choice they asked to remember. If the page does not answer (`app_exit_ack`), a second
//! close within `RETRY_WINDOW` leaves anyway: a window that cannot be closed is worse than a team left running. Once the
//! page has answered, a second close only asks again: a double click on the close button must not leave.

use crate::account_scope::AccountScopeState;
use crate::agent_control::{destination, window_refusal, Destination};
use crate::runtime_host::ProcessResult;
use crate::team_control::TeamCommand;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};

/// The event the page listens for: the person asked to leave.
pub(crate) const EXIT_EVENT: &str = "app-exit-requested";
/// A second request to leave within this time, with the page silent, leaves.
pub(crate) const RETRY_WINDOW: Duration = Duration::from_secs(8);
/// The file the Capitano creates when the agents have written where they were and stopped (skill graceful-shutdown).
pub(crate) const READY_FLAG: &str = "/jht_home/.shutdown-ready.flag";
/// The order the Capitano executes by reading it. NOT TRANSLATED: the team's agents work in Italian, and rewriting it
/// would change their behaviour. tests/test_app_exit_order.py keeps it equal to the skill and to the game's.
pub(crate) const ORDER: &str = "[@utente -> @capitano] [SHUTDOWN] L'utente sta chiudendo l'applicazione. Usa la skill graceful-shutdown: fai annotare a ogni agente lo stato del lavoro in corso sulla propria agenda, poi fermali uno a uno e infine crea il flag /jht_home/.shutdown-ready.flag che chiude l'applicazione.";

const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);
const DOWN_TIMEOUT: Duration = Duration::from_secs(90);
const MACHINE_TIMEOUT: Duration = Duration::from_secs(90);
/// The look at the machine for the dialog's question: a machine that does not answer in this time has nothing to say.
const STATE_TIMEOUT: Duration = Duration::from_secs(4);

static EXIT_ALLOWED: AtomicBool = AtomicBool::new(false);
static LAST_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);
static PAGE_ANSWERED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ExitMode {
    Ordered,
    Forced,
    Detach,
}

/// Where the team is, as far as leaving is concerned.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum TeamHost {
    /// On this computer: the three ways are offered.
    Local,
    /// On a VPS: it is never touched, the window just closes.
    Vps,
    /// No team set up here: nothing to stop.
    None,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Step {
    /// `jht down` through the wrapper: the container stops.
    ContainerDown,
    /// `podman machine stop`: the virtual machine stops and gives its memory back.
    MachineStop,
}

/// What leaving does for a mode and a host: the steps, or why not. Nothing that stops anything for a team that is not on
/// this computer.
pub(crate) fn plan(mode: ExitMode, host: TeamHost) -> Result<Vec<Step>, &'static str> {
    match (mode, host) {
        (ExitMode::Detach, _) => Ok(Vec::new()),
        (_, TeamHost::None) => Ok(Vec::new()),
        (_, TeamHost::Vps) => Err("app_exit_vps_untouched"),
        (ExitMode::Ordered | ExitMode::Forced, TeamHost::Local) => {
            let mut steps = vec![Step::ContainerDown];
            // Linux has no machine: the container is the whole runtime
            if cfg!(any(target_os = "macos", windows)) {
                steps.push(Step::MachineStop);
            }
            Ok(steps)
        }
    }
}

/// Whether a request to leave goes through now: the exit was decided; or the page was asked, has NOT answered, and this is
/// a second request soon after.
pub(crate) fn leaves_now(allowed: bool, page_answered: bool, last: Option<Instant>, now: Instant) -> bool {
    allowed || (!page_answered && last.is_some_and(|before| now.saturating_duration_since(before) <= RETRY_WINDOW))
}

/// Called for every request to leave (the close button, ⌘Q, the menu): true when it must go through.
pub(crate) fn request_goes_through(now: Instant) -> bool {
    let mut last = LAST_REQUEST.lock().unwrap_or_else(|e| e.into_inner());
    let through = leaves_now(EXIT_ALLOWED.load(Ordering::SeqCst), PAGE_ANSWERED.load(Ordering::SeqCst), *last, now);
    if !through && last.is_none() {
        // the first request: the page has not answered yet
        PAGE_ANSWERED.store(false, Ordering::SeqCst);
    }
    if !through && !PAGE_ANSWERED.load(Ordering::SeqCst) {
        *last = Some(now);
    }
    through
}

pub(crate) fn ask_the_page(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(EXIT_EVENT, ());
    }
}

fn leave(app: &tauri::AppHandle) {
    EXIT_ALLOWED.store(true, Ordering::SeqCst);
    app.exit(0);
}

// ── the commands the page calls ──────────────────────────────────────────────

/// What the order to the Capitano and the poll run in the container, closed.
fn rm_flag() -> TeamCommand<'static> {
    TeamCommand { argv: vec!["rm", "-f", READY_FLAG], input: None }
}

fn send_order() -> TeamCommand<'static> {
    TeamCommand { argv: vec!["jht-tmux-send", "CAPITANO", ORDER], input: None }
}

fn flag_is_there() -> TeamCommand<'static> {
    TeamCommand { argv: vec!["test", "-f", READY_FLAG], input: None }
}

fn list_sessions() -> TeamCommand<'static> {
    TeamCommand { argv: vec!["tmux", "list-sessions", "-F", "#{session_name}"], input: None }
}

/// How many sessions a `tmux list-sessions` answer names.
pub(crate) fn count_sessions(stdout: &[u8]) -> usize {
    String::from_utf8_lossy(stdout).lines().filter(|line| !line.trim().is_empty()).count()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExitState {
    team: TeamHost,
    /// Containers that are not the team's running on the team's machine: leaving does not stop the machine for them.
    other_containers: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExitProgress {
    ready: bool,
    active: usize,
}

#[derive(Serialize)]
pub(crate) struct ExitError {
    code: &'static str,
}

fn local_destination(app: &tauri::AppHandle, scope: &crate::account_scope::AccountScope) -> Result<TeamHost, &'static str> {
    // No owner marker in this computer's JHT folder: no team lives here yet, so there is nothing to stop, and looking
    // must not claim the folder for whoever closes the app first (the destination's own check claims an unowned one).
    if crate::account_scope::local_owner_marker_path(app).is_ok_and(|marker| !marker.exists()) {
        return Ok(TeamHost::None);
    }
    match destination(app, scope) {
        Ok((Destination::Local { .. }, _)) => Ok(TeamHost::Local),
        Ok(_) => Ok(TeamHost::Vps),
        Err("agent_control_no_team") => Ok(TeamHost::None),
        Err(code) => Err(code),
    }
}

fn exec_local(
    app: &tauri::AppHandle,
    scope: &crate::account_scope::AccountScope,
    command: &TeamCommand<'_>,
) -> Result<ProcessResult, &'static str> {
    match destination(app, scope)? {
        (Destination::Local { wrapper, runtime }, _) => {
            crate::team_control::run_local(&wrapper, runtime.as_deref(), command, COMMAND_TIMEOUT, true, || {
                Err("app_exit_no_container")
            })
        }
        _ => Err("app_exit_vps_untouched"),
    }
}

async fn on_scope<T: Send + 'static>(
    window: &tauri::Window,
    scopes: &State<'_, AccountScopeState>,
    work: impl FnOnce(&crate::account_scope::AccountScope) -> Result<T, &'static str> + Send + 'static,
) -> Result<T, ExitError> {
    if let Some(code) = window_refusal(window.label()) {
        return Err(ExitError { code });
    }
    let expected = scopes.active().map_err(|code| ExitError { code })?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state.lock_expected(&worker_expected)?;
        work(&worker_expected)
    })
    .await
    .unwrap_or(Err("app_exit_unanswered"));
    scopes.lock_expected(&expected).map_err(|code| ExitError { code })?;
    result.map_err(|code| ExitError { code })
}

/// The page got the request and is showing it (or applying the choice it remembers): from now on a second close asks
/// again instead of leaving.
#[tauri::command]
pub(crate) fn app_exit_ack(window: tauri::Window) -> Result<(), ExitError> {
    if let Some(code) = window_refusal(window.label()) {
        return Err(ExitError { code });
    }
    PAGE_ANSWERED.store(true, Ordering::SeqCst);
    Ok(())
}

/// The person chose to stay: the next request to leave starts again from the page.
#[tauri::command]
pub(crate) fn app_exit_cancel(window: tauri::Window) -> Result<(), ExitError> {
    if let Some(code) = window_refusal(window.label()) {
        return Err(ExitError { code });
    }
    PAGE_ANSWERED.store(false, Ordering::SeqCst);
    *LAST_REQUEST.lock().unwrap_or_else(|e| e.into_inner()) = None;
    Ok(())
}

/// Where the team is: the page offers the three ways only for a team on this computer.
#[tauri::command]
pub(crate) async fn app_exit_state(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<ExitState, ExitError> {
    on_scope(&window, &scopes, move |scope| {
        let team = local_destination(&app, scope)?;
        // only a team on this computer has a machine to speak of, and only a Mac or a Windows has one (Linux runs the container itself)
        let other_containers = if team == TeamHost::Local && cfg!(any(target_os = "macos", windows)) {
            crate::podman::other_containers_on_jht_machine(STATE_TIMEOUT).unwrap_or(0)
        } else {
            0
        };
        Ok(ExitState { team, other_containers })
    })
    .await
}

/// «Stop them in order», first half: the order goes to the Capitano. Returns once the order is typed; the agents
/// take their time, and the page asks how it is going (`app_exit_poll`).
#[tauri::command]
pub(crate) async fn app_exit_order(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<(), ExitError> {
    on_scope(&window, &scopes, move |scope| {
        if local_destination(&app, scope)? != TeamHost::Local {
            return Err("app_exit_vps_untouched");
        }
        // an old flag left in place would end the wait before the agents had written anything
        if exec_local(&app, scope, &rm_flag())?.code != 0 {
            return Err("app_exit_order_not_sent");
        }
        let sent = exec_local(&app, scope, &send_order())?;
        if sent.code == 0 { Ok(()) } else { Err("app_exit_order_not_sent") }
    })
    .await
}

/// How the ordered stop stands: the Capitano's flag, and how many sessions are still open.
#[tauri::command]
pub(crate) async fn app_exit_poll(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<ExitProgress, ExitError> {
    on_scope(&window, &scopes, move |scope| {
        if local_destination(&app, scope)? != TeamHost::Local {
            return Err("app_exit_vps_untouched");
        }
        let ready = exec_local(&app, scope, &flag_is_there()).map(|done| done.code == 0).unwrap_or(false);
        let active = exec_local(&app, scope, &list_sessions()).map(|done| count_sessions(&done.stdout)).unwrap_or(0);
        Ok(ExitProgress { ready, active })
    })
    .await
}

/// Leave. `ordered` and `forced` stop the container and the machine first (the order of an ordered stop was given before
/// and has been waited for); `detach` only closes. A failure of a step is reported and the app does NOT leave, so the
/// person can try again or choose another way; the exception is `detach`, which cannot fail.
#[tauri::command]
pub(crate) async fn app_exit_finish(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    mode: ExitMode,
) -> Result<(), ExitError> {
    let handle = app.clone();
    on_scope(&window, &scopes, move |scope| {
        // a team the app cannot look at is not stopped, but the window can always close
        let host = match (mode, local_destination(&app, scope)) {
            (ExitMode::Detach, host) => host.unwrap_or(TeamHost::None),
            (_, host) => host?,
        };
        for step in plan(mode, host)? {
            match step {
                Step::ContainerDown => {
                    let (found, _) = destination(&app, scope)?;
                    let Destination::Local { wrapper, .. } = found else { return Err("app_exit_vps_untouched") };
                    let done = crate::onboarding::run_verified_local_wrapper(&wrapper, &["down"], None, DOWN_TIMEOUT)?;
                    if done.code != 0 {
                        return Err("app_exit_down_failed");
                    }
                }
                Step::MachineStop => match crate::podman::stop_jht_machine(MACHINE_TIMEOUT) {
                    // off, or on for the containers that are not the team's (the page said so before the choice)
                    crate::podman::MachineStop::Stopped | crate::podman::MachineStop::KeptForOthers(_) => {}
                    // a machine that did not stop is told, not hidden: the app stays open
                    crate::podman::MachineStop::NotStopped => return Err("app_exit_machine_not_stopped"),
                },
            }
        }
        Ok(())
    })
    .await?;
    leave(&handle);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_team_on_a_vps_is_never_stopped_from_here() {
        for mode in [ExitMode::Ordered, ExitMode::Forced] {
            assert_eq!(plan(mode, TeamHost::Vps), Err("app_exit_vps_untouched"), "{mode:?}");
        }
        assert_eq!(plan(ExitMode::Detach, TeamHost::Vps), Ok(vec![]), "the window just closes");
    }

    #[test]
    fn detaching_stops_nothing_whatever_the_host() {
        for host in [TeamHost::Local, TeamHost::Vps, TeamHost::None] {
            assert_eq!(plan(ExitMode::Detach, host), Ok(vec![]), "{host:?}");
        }
    }

    #[test]
    fn without_a_team_here_there_is_nothing_to_stop() {
        for mode in [ExitMode::Ordered, ExitMode::Forced] {
            assert_eq!(plan(mode, TeamHost::None), Ok(vec![]));
        }
    }

    #[test]
    fn on_this_computer_both_stops_bring_the_container_down_first() {
        for mode in [ExitMode::Ordered, ExitMode::Forced] {
            let steps = plan(mode, TeamHost::Local).unwrap();
            assert_eq!(steps[0], Step::ContainerDown, "the container before the machine");
            assert_eq!(steps.len(), if cfg!(any(target_os = "macos", windows)) { 2 } else { 1 });
            assert_eq!(steps.get(1).copied().unwrap_or(Step::MachineStop), Step::MachineStop);
        }
    }

    #[test]
    fn a_second_request_with_the_page_silent_leaves_but_the_first_only_asks() {
        let start = Instant::now();
        assert!(!leaves_now(false, false, None, start), "the first request asks the page");
        assert!(leaves_now(false, false, Some(start), start + Duration::from_secs(3)), "the second one, soon after, leaves");
        assert!(!leaves_now(false, false, Some(start), start + RETRY_WINDOW + Duration::from_secs(1)), "an old request is not a retry");
        assert!(leaves_now(true, false, None, start), "after the page chose, the exit goes through");
    }

    #[test]
    fn once_the_page_has_answered_a_double_click_does_not_leave() {
        let start = Instant::now();
        assert!(!leaves_now(false, true, Some(start), start + Duration::from_secs(1)));
        assert!(leaves_now(true, true, Some(start), start + Duration::from_secs(1)), "unless the exit was decided");
    }

    #[test]
    fn the_requests_in_a_row_follow_the_page() {
        // one sequence at a time: the statics are the process's
        let mut now = Instant::now();
        EXIT_ALLOWED.store(false, Ordering::SeqCst);
        PAGE_ANSWERED.store(false, Ordering::SeqCst);
        *LAST_REQUEST.lock().unwrap() = None;
        assert!(!request_goes_through(now), "first: asks");
        PAGE_ANSWERED.store(true, Ordering::SeqCst); // the page acknowledged
        now += Duration::from_secs(1);
        assert!(!request_goes_through(now), "double click: asks again");
        PAGE_ANSWERED.store(false, Ordering::SeqCst); // the page is not answering any more
        now += Duration::from_secs(1);
        assert!(request_goes_through(now), "silent page: the next one leaves");
        // the person cancelled: starting again
        *LAST_REQUEST.lock().unwrap() = None;
        PAGE_ANSWERED.store(false, Ordering::SeqCst);
        assert!(!request_goes_through(now + Duration::from_secs(2)));
        *LAST_REQUEST.lock().unwrap() = None;
    }

    #[test]
    fn the_commands_in_the_container_are_closed() {
        assert_eq!(rm_flag().argv, ["rm", "-f", READY_FLAG]);
        assert_eq!(flag_is_there().argv, ["test", "-f", READY_FLAG]);
        assert_eq!(send_order().argv, ["jht-tmux-send", "CAPITANO", ORDER]);
        assert!(ORDER.contains(READY_FLAG) && ORDER.contains("graceful-shutdown") && ORDER.starts_with("[@utente -> @capitano] [SHUTDOWN]"));
    }

    #[test]
    fn the_sessions_are_counted_by_their_lines() {
        assert_eq!(count_sessions(b"CAPITANO\nSCOUT-1\n\nASSISTENTE\n"), 3);
        assert_eq!(count_sessions(b""), 0);
        assert_eq!(count_sessions(b"  \n"), 0);
    }

    #[test]
    fn the_modes_the_page_may_name_are_three_words() {
        for (word, mode) in [("ordered", ExitMode::Ordered), ("forced", ExitMode::Forced), ("detach", ExitMode::Detach)] {
            assert_eq!(serde_json::from_str::<ExitMode>(&format!("\"{word}\"")).unwrap(), mode);
        }
        assert!(serde_json::from_str::<ExitMode>("\"stop\"").is_err());
        assert!(serde_json::from_str::<ExitMode>("\"Ordered\"").is_err());
    }

    #[test]
    fn the_page_is_told_where_the_team_is_in_three_words() {
        assert_eq!(serde_json::to_string(&TeamHost::Local).unwrap(), "\"local\"");
        assert_eq!(serde_json::to_string(&TeamHost::Vps).unwrap(), "\"vps\"");
        assert_eq!(serde_json::to_string(&TeamHost::None).unwrap(), "\"none\"");
    }

    #[test]
    fn the_state_says_how_many_containers_that_are_not_the_team_s_share_the_machine() {
        let state = ExitState { team: TeamHost::Local, other_containers: 2 };
        assert_eq!(serde_json::to_string(&state).unwrap(), r#"{"team":"local","otherContainers":2}"#);
    }

    #[test]
    fn a_machine_that_did_not_stop_is_an_error_and_the_machine_with_others_is_not() {
        let source = include_str!("app_exit.rs").split("#[cfg(test)]").next().unwrap().replace("\r\n", "\n");
        let finish = source.split("fn app_exit_finish(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(finish.contains("MachineStop::NotStopped => return Err(\"app_exit_machine_not_stopped\")"));
        assert!(finish.contains("MachineStop::Stopped | crate::podman::MachineStop::KeptForOthers(_) => {}"));
    }
}

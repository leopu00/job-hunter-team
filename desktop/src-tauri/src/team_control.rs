//! The host side of starting the local team and of controlling its agents,
//! without the host script (stage 3 of the plan to move the host scripts into
//! the app). Today `team start` and `agent-control` reach the Node CLI of the
//! container through jht-wrapper (Ensure-Up, then `docker exec`); here the app
//! asks the same CLI in the same container through the engine the chat already
//! attests (`direct_chat::AttestedLocalTeam`), so no shell sits between the two.
//!
//! What stays where it was: the logic. `jht team start` (provider checks, cloud
//! sync, the launcher that opens each agent) and the container's
//! `agent_control.py` (stop of one agent or of the whole team, pause, resume,
//! restart: the persistent halt gate first, then the exact session names) run
//! inside the container as always. A stop is NOT written again here.
//!
//! The wrapper is the way back only when the attested container could not be
//! found at all (the container is down, so the wrapper's own Ensure-Up brings it
//! up; or the runtime is not one the chat accepts): once the command has been
//! given to the container it is never given again.

use crate::runtime_host::ProcessResult;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The CLI the wrapper runs inside the container (`JHT_NODE_ENTRY` default).
const NODE_ENTRY: &str = "/app/cli/bin/jht.js";

/// How long the container may take to be found and attested.
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(20);

/// How long a container found for a read is reused by the next read. The page reads the
/// terminal of an agent several times a second; finding the container takes two engine
/// calls. A start or an action never reuses it: it finds the container again first.
const RESOLVED_FOR: Duration = Duration::from_secs(5);

/// The last value found, for one key, and when.
pub(crate) struct ResolveCache<T> {
    slot: Mutex<Option<(Instant, String, Arc<T>)>>,
}

impl<T> ResolveCache<T> {
    pub(crate) const fn new() -> Self {
        Self { slot: Mutex::new(None) }
    }

    /// The value for `key`: the kept one when `reuse` and it is younger than `keep`,
    /// otherwise a fresh one, which replaces it. A resolution that fails keeps nothing.
    /// One resolution at a time: a second caller waits for it instead of repeating it.
    pub(crate) fn get(
        &self,
        key: &str,
        now: Instant,
        keep: Duration,
        reuse: bool,
        resolve: impl FnOnce() -> Result<T, &'static str>,
    ) -> Result<Arc<T>, &'static str> {
        let mut slot = self.slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if reuse {
            if let Some((at, kept, value)) = slot.as_ref() {
                if kept == key && now.saturating_duration_since(*at) < keep {
                    return Ok(Arc::clone(value));
                }
            }
        }
        match resolve() {
            Ok(value) => {
                let value = Arc::new(value);
                *slot = Some((now, key.to_owned(), Arc::clone(&value)));
                Ok(value)
            }
            Err(error) => {
                *slot = None;
                Err(error)
            }
        }
    }
}

static LOCAL_TEAM: ResolveCache<crate::direct_chat::AttestedLocalTeam> = ResolveCache::new();

/// One command for the team's container: an argument vector with no shell and
/// the bytes for its standard input. `JHT_HOST_TYPE`, which the wrapper passes to
/// every exec, is read by the container's entry point and by the setup wizard,
/// never by `team start` or `agent-control`, so it is not passed here.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct TeamCommand<'a> {
    pub(crate) argv: Vec<&'a str>,
    pub(crate) input: Option<&'a [u8]>,
}

/// Runs a command in the team's container.
pub(crate) trait TeamEngine {
    fn exec(&self, command: &TeamCommand<'_>, timeout: Duration) -> Result<ProcessResult, &'static str>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StartKind {
    Team,
    Assistant,
}

/// What the wrapper ran for `jht team start [assistente]`: the Node CLI.
pub(crate) fn start_command(kind: StartKind) -> TeamCommand<'static> {
    let mut argv = vec!["node", NODE_ENTRY, "team", "start"];
    if kind == StartKind::Assistant {
        argv.push("assistente");
    }
    TeamCommand { argv, input: None }
}

/// The operations of `agent_control.py`, as `ControlRequest::argv` names them.
const AGENT_CONTROL_OPS: [&str; 14] = [
    "list", "team", "history", "screen", "start", "stop", "restart", "pause", "resume", "stop-team",
    "exclusions", "exclusion-accept", "exclusion-withdraw", "answer",
];
/// The only options a request carries (`pause`).
const AGENT_CONTROL_OPTIONS: [&str; 3] = ["--for-hours", "--until", "--wake-on-weekly"];

/// `jht agent-control <args>`: what Invoke-AgentControl ran. The arguments are
/// the closed forms `ControlRequest::argv` builds, checked again here: the first
/// word is one of the operations, an option is one of the three `pause` takes,
/// and any other word is made of the characters of an agent, question or option
/// id or a timestamp, never an option or a second command.
pub(crate) fn agent_control_command<'a>(
    args: &[&'a str],
    input: Option<&'a [u8]>,
) -> Result<TeamCommand<'a>, &'static str> {
    let plain = |word: &str| {
        !word.is_empty()
            && word.len() <= 96
            && word.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_')
            && word.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_:.".contains(&b))
    };
    let valid = args.first().is_some_and(|op| AGENT_CONTROL_OPS.contains(op))
        && args[1..].iter().all(|word| AGENT_CONTROL_OPTIONS.contains(word) || plain(word));
    if !valid {
        return Err("agent_control_invalid");
    }
    let mut argv = vec!["node", NODE_ENTRY, "agent-control"];
    argv.extend_from_slice(args);
    Ok(TeamCommand { argv, input })
}

/// The container's answer when it could be found; otherwise, and only then, the
/// wrapper's. An answer that is an error (a timeout, a failed exec) is returned
/// as it is: the command may have reached the container.
pub(crate) fn native_or_wrapper(
    engine: Result<&dyn TeamEngine, &'static str>,
    command: &TeamCommand<'_>,
    timeout: Duration,
    wrapper: impl FnOnce() -> Result<ProcessResult, &'static str>,
) -> Result<ProcessResult, &'static str> {
    match engine {
        Ok(engine) => engine.exec(command, timeout),
        Err(_) => wrapper(),
    }
}

/// The chat's attested container, as a team engine.
pub(crate) struct AttestedTeamEngine(Arc<crate::direct_chat::AttestedLocalTeam>);

impl AttestedTeamEngine {
    /// `fresh`: find the container again (a start, an action); otherwise one found a moment ago may do (a read).
    pub(crate) fn resolve(wrapper: &Path, runtime: Option<&Path>, fresh: bool) -> Result<Self, &'static str> {
        let runtime = runtime.ok_or("runtime_missing")?;
        let key = format!("{}\n{}", wrapper.display(), runtime.display());
        LOCAL_TEAM
            .get(&key, Instant::now(), RESOLVED_FOR, !fresh, || {
                crate::direct_chat::AttestedLocalTeam::resolve(wrapper, runtime, RESOLVE_TIMEOUT)
            })
            .map(Self)
    }
}

impl TeamEngine for AttestedTeamEngine {
    fn exec(&self, command: &TeamCommand<'_>, timeout: Duration) -> Result<ProcessResult, &'static str> {
        self.0.exec(&command.argv, command.input, timeout)
    }
}

/// `command` on this computer's team: in the attested container, or through
/// `wrapper` when the container could not be found. The caller has already
/// checked the account's runtime. `fresh`: a command that changes something finds
/// the container again; a read may use the one found a few seconds ago.
pub(crate) fn run_local(
    wrapper_path: &Path,
    runtime: Option<&Path>,
    command: &TeamCommand<'_>,
    timeout: Duration,
    fresh: bool,
    wrapper: impl FnOnce() -> Result<ProcessResult, &'static str>,
) -> Result<ProcessResult, &'static str> {
    let engine = AttestedTeamEngine::resolve(wrapper_path, runtime, fresh);
    native_or_wrapper(engine.as_ref().map(|engine| engine as &dyn TeamEngine).map_err(|error| *error), command, timeout, wrapper)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    struct Recording {
        seen: RefCell<Vec<(Vec<String>, Option<Vec<u8>>, Duration)>>,
        answer: fn() -> Result<ProcessResult, &'static str>,
    }

    impl TeamEngine for Recording {
        fn exec(&self, command: &TeamCommand<'_>, timeout: Duration) -> Result<ProcessResult, &'static str> {
            self.seen.borrow_mut().push((
                command.argv.iter().map(|part| (*part).to_owned()).collect(),
                command.input.map(<[u8]>::to_vec),
                timeout,
            ));
            (self.answer)()
        }
    }

    fn engine(answer: fn() -> Result<ProcessResult, &'static str>) -> Recording {
        Recording { seen: RefCell::new(Vec::new()), answer }
    }

    fn done(code: i32, stdout: &str) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult { code, stdout: stdout.as_bytes().to_vec() })
    }

    #[test]
    fn start_asks_the_container_cli_exactly_what_the_wrapper_asked() {
        let team = start_command(StartKind::Team);
        assert_eq!(team.argv, ["node", NODE_ENTRY, "team", "start"]);
        assert!(team.input.is_none());
        assert_eq!(start_command(StartKind::Assistant).argv, ["node", NODE_ENTRY, "team", "start", "assistente"]);
    }

    #[test]
    fn agent_control_takes_its_operations_and_options_and_the_input_unchanged() {
        let input = b"{\"op\":\"screen\"}\n".as_slice();
        let command = agent_control_command(&["screen", "SCOUT-1"], Some(input)).unwrap();
        assert_eq!(command.argv, ["node", NODE_ENTRY, "agent-control", "screen", "SCOUT-1"]);
        assert_eq!(command.input, Some(input));
        // Every form ControlRequest::argv builds.
        for ok in [
            vec!["list"], vec!["team"], vec!["history"], vec!["resume"], vec!["stop-team"], vec!["exclusions"],
            vec!["start", "SCOUT-1"], vec!["stop", "CRITICO-S2"], vec!["restart", "CAPITANO"],
            vec!["pause", "--for-hours", "24"], vec!["pause", "--until", "2026-10-24T10:00:00Z"], vec!["pause", "--wake-on-weekly"],
            vec!["exclusion-accept", "wrong_location"], vec!["exclusion-withdraw", "company"],
            vec!["answer", "aq:capitano:1792850852-ab12cd", "_rinvia"], vec!["answer", "aq:capitano:1792850852-ab12cd", "si"],
        ] {
            assert!(agent_control_command(&ok, None).is_ok(), "{ok:?}");
        }
        for bad in [
            vec![],
            vec![""],
            vec!["--help"],
            vec!["shell"],
            vec!["Stop", "SCOUT-1"],
            vec!["stop;rm"],
            vec!["stop", "SCOUT-1 "],
            vec!["stop", "$(id)"],
            vec!["stop", "a\nb"],
            vec!["stop", "é"],
            vec!["stop", "--evil"],
            vec!["stop", "-1"],
            vec!["pause", "--for-hours=1"],
            vec!["stop", "../x"],
        ] {
            assert_eq!(agent_control_command(&bad, None).err(), Some("agent_control_invalid"), "{bad:?}");
        }
        assert!(agent_control_command(&["stop", &"a".repeat(97)], None).is_err());
    }

    #[test]
    fn a_found_container_gets_the_command_once_and_the_wrapper_never_runs() {
        let fake = engine(|| done(7, "disk_low"));
        let wrapper_ran = Cell::new(false);
        let result = native_or_wrapper(Ok(&fake), &start_command(StartKind::Team), Duration::from_secs(9), || {
            wrapper_ran.set(true);
            done(0, "")
        })
        .unwrap();
        assert_eq!((result.code, result.stdout.as_slice()), (7, &b"disk_low"[..]), "the CLI's own answer, a refusal included");
        assert!(!wrapper_ran.get());
        let seen = fake.seen.borrow();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].2, Duration::from_secs(9));
    }

    #[test]
    fn a_failed_exec_is_returned_as_it_is_and_never_given_to_the_wrapper_too() {
        let fake = engine(|| Err("process_timeout"));
        let wrapper_ran = Cell::new(false);
        let result = native_or_wrapper(Ok(&fake), &start_command(StartKind::Team), Duration::from_secs(1), || {
            wrapper_ran.set(true);
            done(0, "")
        });
        assert_eq!(result.err(), Some("process_timeout"));
        assert!(!wrapper_ran.get(), "a command that may have reached the container is not run a second time");
    }

    #[test]
    fn a_container_found_for_a_read_is_reused_for_a_few_seconds_and_never_for_a_write() {
        let cache: ResolveCache<u32> = ResolveCache::new();
        let start = Instant::now();
        let keep = Duration::from_secs(5);
        let calls = Cell::new(0);
        let resolve = || {
            calls.set(calls.get() + 1);
            Ok(calls.get())
        };
        // A read finds it; the next reads, within the time, reuse it.
        assert_eq!(*cache.get("a", start, keep, true, resolve).unwrap(), 1);
        assert_eq!(*cache.get("a", start + Duration::from_secs(4), keep, true, resolve).unwrap(), 1);
        assert_eq!(calls.get(), 1);
        // After the time, another key, or a write (fresh): found again.
        assert_eq!(*cache.get("a", start + Duration::from_secs(5), keep, true, resolve).unwrap(), 2);
        assert_eq!(*cache.get("b", start + Duration::from_secs(5), keep, true, resolve).unwrap(), 3);
        assert_eq!(*cache.get("b", start + Duration::from_secs(5), keep, false, resolve).unwrap(), 4);
        // A write's fresh find is what the next read reuses.
        assert_eq!(*cache.get("b", start + Duration::from_secs(6), keep, true, resolve).unwrap(), 4);
        // A resolution that fails keeps nothing: the next read finds it again, not the old one.
        assert_eq!(cache.get("b", start + Duration::from_secs(7), keep, false, || Err("container_unavailable")).err(), Some("container_unavailable"));
        assert_eq!(*cache.get("b", start + Duration::from_secs(7), keep, true, resolve).unwrap(), 5);
    }

    #[test]
    fn a_container_that_cannot_be_found_leaves_the_wrapper_to_bring_it_up() {
        for reason in ["container_unavailable", "runtime_missing"] {
            let wrapper_ran = Cell::new(0);
            let result = native_or_wrapper(Err(reason), &start_command(StartKind::Team), Duration::from_secs(1), || {
                wrapper_ran.set(wrapper_ran.get() + 1);
                done(0, "started")
            })
            .unwrap();
            assert_eq!(result.stdout, b"started");
            assert_eq!(wrapper_ran.get(), 1, "{reason}");
        }
        // And no runtime directory at all is the same answer, before any engine is looked for.
        assert_eq!(
            AttestedTeamEngine::resolve(Path::new("/nonexistent/jht-wrapper"), None, true).err(),
            Some("runtime_missing")
        );
    }
}

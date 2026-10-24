//! The host side of starting the local team and of controlling its agents,
//! without the host script (stage 3 of the plan to move the host scripts into
//! the app). Today `team start` and `agent-control` reach the Node CLI of the
//! container through jht-wrapper (Ensure-Up, then `docker exec`); here the app
//! asks the same CLI in the same container through an engine that already is
//! the attested one (`TeamEngine`), so no shell sits between the two.
//!
//! What stays where it was: the logic. `jht team start` (provider checks, cloud
//! sync, the launcher that opens each agent) and the container's
//! `agent_control.py` (stop of one agent or of the whole team, pause, resume,
//! restart: the persistent halt gate first, then the exact session names) run
//! inside the container as always. A stop is NOT written again here.

use crate::runtime_host::ProcessResult;
use std::time::Duration;

/// The CLI the wrapper runs inside the container (`JHT_NODE_ENTRY` default).
const NODE_ENTRY: &str = "/app/cli/bin/jht.js";

/// A start opens up to a dozen agents and warms the provider: as long as the
/// onboarding step that used to run it through the wrapper.
pub(crate) const START_TIMEOUT: Duration = Duration::from_secs(300);

/// One command for the team's container: an argument vector with no shell, the
/// few variables the CLI reads, and the bytes for its standard input.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct TeamCommand<'a> {
    pub(crate) argv: Vec<&'a str>,
    pub(crate) env: Vec<(&'static str, &'a str)>,
    pub(crate) input: Option<&'a [u8]>,
}

/// Runs a command in the team's container. The real engine is the attested one
/// of the local runtime (container, image and compose labels checked before
/// the exec); the tests give a fake.
pub(crate) trait TeamEngine {
    fn exec(&self, command: &TeamCommand<'_>, timeout: Duration) -> Result<ProcessResult, &'static str>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StartKind {
    Team,
    Assistant,
}

/// What the wrapper ran for `jht team start [assistente]`: the Node CLI, with
/// the host type it passes to every exec.
pub(crate) fn start_command(kind: StartKind, host_type: &str) -> TeamCommand<'_> {
    let mut argv = vec!["node", NODE_ENTRY, "team", "start"];
    if kind == StartKind::Assistant {
        argv.push("assistente");
    }
    TeamCommand { argv, env: vec![("JHT_HOST_TYPE", host_type)], input: None }
}

/// `jht agent-control <args>`: what Invoke-AgentControl ran. The arguments are
/// the closed forms `ControlRequest::argv` builds; a word that is not one of
/// them is refused here too, so nothing the person typed can reach the exec as
/// an option or a second command.
pub(crate) fn agent_control_command<'a>(
    args: &[&'a str],
    host_type: &'a str,
    input: Option<&'a [u8]>,
) -> Result<TeamCommand<'a>, &'static str> {
    let closed = |word: &str| {
        !word.is_empty()
            && word.len() <= 64
            && word.starts_with(|c: char| c.is_ascii_alphanumeric())
            && word.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    };
    if args.is_empty() || !args.iter().all(|word| closed(word)) {
        return Err("agent_control_invalid");
    }
    let mut argv = vec!["node", NODE_ENTRY, "agent-control"];
    argv.extend_from_slice(args);
    Ok(TeamCommand { argv, env: vec![("JHT_HOST_TYPE", host_type)], input })
}

/// `jht team start [assistente]` in the team's container; the CLI's own exit
/// code and output reach the caller, which reads them as it read the wrapper's.
pub(crate) fn start_team(engine: &dyn TeamEngine, kind: StartKind, host_type: &str) -> Result<ProcessResult, &'static str> {
    engine.exec(&start_command(kind, host_type), START_TIMEOUT)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Recording {
        seen: RefCell<Vec<(Vec<String>, Vec<(String, String)>, Option<Vec<u8>>, Duration)>>,
        answer: fn() -> Result<ProcessResult, &'static str>,
    }

    impl TeamEngine for Recording {
        fn exec(&self, command: &TeamCommand<'_>, timeout: Duration) -> Result<ProcessResult, &'static str> {
            self.seen.borrow_mut().push((
                command.argv.iter().map(|part| (*part).to_owned()).collect(),
                command.env.iter().map(|(key, value)| ((*key).to_owned(), (*value).to_owned())).collect(),
                command.input.map(<[u8]>::to_vec),
                timeout,
            ));
            (self.answer)()
        }
    }

    fn engine(answer: fn() -> Result<ProcessResult, &'static str>) -> Recording {
        Recording { seen: RefCell::new(Vec::new()), answer }
    }

    #[test]
    fn start_asks_the_container_cli_exactly_what_the_wrapper_asked() {
        let team = start_command(StartKind::Team, "windows");
        assert_eq!(team.argv, ["node", NODE_ENTRY, "team", "start"]);
        assert_eq!(team.env, [("JHT_HOST_TYPE", "windows")]);
        assert!(team.input.is_none());
        assert_eq!(start_command(StartKind::Assistant, "mac").argv, ["node", NODE_ENTRY, "team", "start", "assistente"]);
    }

    #[test]
    fn a_start_runs_one_exec_with_the_start_timeout_and_returns_the_cli_answer() {
        let fake = engine(|| Ok(ProcessResult { code: 7, stdout: b"disk_low".to_vec() }));
        let result = start_team(&fake, StartKind::Team, "windows").unwrap();
        assert_eq!((result.code, result.stdout.as_slice()), (7, &b"disk_low"[..]));
        let seen = fake.seen.borrow();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].3, START_TIMEOUT);
        let refused = engine(|| Err("runtime_missing"));
        assert_eq!(start_team(&refused, StartKind::Assistant, "windows").err(), Some("runtime_missing"));
    }

    #[test]
    fn agent_control_takes_closed_words_and_the_input_unchanged() {
        let input = b"{\"op\":\"screen\"}\n".as_slice();
        let command = agent_control_command(&["screen", "SCOUT-1"], "windows", Some(input)).unwrap();
        assert_eq!(command.argv, ["node", NODE_ENTRY, "agent-control", "screen", "SCOUT-1"]);
        assert_eq!(command.input, Some(input));
        for bad in [
            vec![],
            vec![""],
            vec!["--help"],
            vec!["stop;rm"],
            vec!["stop", "SCOUT-1 "],
            vec!["stop", "$(id)"],
            vec!["stop", "a\nb"],
            vec!["stop", "é"],
        ] {
            assert_eq!(agent_control_command(&bad, "windows", None).err(), Some("agent_control_invalid"), "{bad:?}");
        }
        assert!(agent_control_command(&["x"], "windows", None).is_ok());
        assert!(agent_control_command(&[&"a".repeat(65)], "windows", None).is_err());
    }
}

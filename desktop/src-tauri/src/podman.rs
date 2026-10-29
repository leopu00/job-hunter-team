use crate::account_scope::AccountScopeState;
use serde::Serialize;
use std::{
    ffi::OsString,
    io::{self, BufRead, BufReader, Read, Write},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const VERSION_TIMEOUT: Duration = Duration::from_secs(4);
const INFO_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_CAPTURE_BYTES: usize = 1024 * 1024;
const MAX_STDERR_LINE_BYTES: usize = 16 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PodmanStatus {
    pub(crate) installed: bool,
    pub(crate) ready: bool,
    pub(crate) version: Option<String>,
    pub(crate) issue: Option<&'static str>,
}

#[derive(Debug)]
pub(crate) enum CommandFailure {
    NotFound,
    TimedOut,
    Failed,
}

pub(crate) struct CommandOutcome {
    pub(crate) success: bool,
    pub(crate) stdout: Vec<u8>,
}

pub(crate) fn command(
    args: &[OsString],
    timeout: Duration,
    stdin: Option<&[u8]>,
    capture_stdout: bool,
) -> Result<CommandOutcome, CommandFailure> {
    command_inner(args, timeout, stdin, capture_stdout, None)
}

/// The program that is the engine's CLI, and the PATH it runs with. An app opened from Finder has `/usr/bin:/bin:/usr/sbin:/sbin`
/// for a PATH, without Homebrew's: the bare name `podman` is then not found, and the stop of the machine at exit was
/// silently never run (the machine stayed on). On a Mac the trusted install's `podman` is used by its path, and it runs with a
/// fixed PATH, its own folder first (Podman finds its helpers, vfkit and gvproxy, through it). Elsewhere, the name.
fn engine_program() -> (OsString, Option<OsString>) {
    #[cfg(target_os = "macos")]
    if let Some(podman) = crate::direct_chat::trusted_podman() {
        let path = podman.parent().and_then(|dir| {
            // a fixed PATH: the trusted folder, then the system's; the one the app was opened with is not inherited
            std::env::join_paths(std::iter::once(dir).chain(["/usr/bin", "/bin", "/usr/sbin", "/sbin"].map(std::path::Path::new))).ok()
        });
        return (podman.into_os_string(), path);
    }
    (OsString::from("podman"), None)
}

type StderrLineCallback = Box<dyn Fn(&str) + Send + 'static>;

fn command_inner(
    args: &[OsString],
    timeout: Duration,
    stdin: Option<&[u8]>,
    capture_stdout: bool,
    on_stderr_line: Option<StderrLineCallback>,
) -> Result<CommandOutcome, CommandFailure> {
    let (program, search_path) = engine_program();
    let mut command = Command::new(program);
    if let Some(path) = search_path {
        command.env("PATH", path);
    }
    command.args(args).stderr(if on_stderr_line.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    command.stdout(if capture_stdout {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    command.stdin(if stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => CommandFailure::NotFound,
        _ => CommandFailure::Failed,
    })?;

    let stdout_reader = child
        .stdout
        .take()
        .map(|output| thread::spawn(move || read_bounded_output(output)));
    let stderr_reader = child
        .stderr
        .take()
        .zip(on_stderr_line)
        .map(|(output, callback)| thread::spawn(move || read_stderr_lines(output, callback)));

    if let Some(input) = stdin {
        let written = child
            .stdin
            .take()
            .ok_or(CommandFailure::Failed)
            .and_then(|mut pipe| pipe.write_all(input).map_err(|_| CommandFailure::Failed));
        if let Err(error) = written {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    }

    let started_at = Instant::now();
    let success = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if started_at.elapsed() < timeout => {
                thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                if let Some(reader) = stdout_reader {
                    let _ = reader.join();
                }
                if let Some(reader) = stderr_reader {
                    let _ = reader.join();
                }
                return Err(CommandFailure::TimedOut);
            }
            Err(_) => return Err(CommandFailure::Failed),
        }
    };

    let stdout = stdout_reader
        .map(|reader| reader.join().unwrap_or_default())
        .unwrap_or_default();
    if let Some(reader) = stderr_reader {
        let _ = reader.join();
    }
    Ok(CommandOutcome { success, stdout })
}

fn read_stderr_lines(output: impl Read, callback: StderrLineCallback) {
    let mut reader = BufReader::new(output);
    let mut line = Vec::with_capacity(1024);
    let mut overflowed = false;

    loop {
        let available = match reader.fill_buf() {
            Ok([]) | Err(_) => {
                if !line.is_empty() && !overflowed {
                    if let Ok(text) = std::str::from_utf8(&line) {
                        callback(text);
                    }
                }
                break;
            }
            Ok(available) => available,
        };
        let newline = available.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(available.len(), |index| index + 1);
        let content_end = newline.unwrap_or(available.len());
        let content = &available[..content_end];

        if !overflowed {
            if line.len().saturating_add(content.len()) > MAX_STDERR_LINE_BYTES {
                line.clear();
                overflowed = true;
            } else {
                line.extend_from_slice(content);
            }
        }
        reader.consume(consumed);

        if newline.is_some() {
            if !overflowed {
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                if let Ok(text) = std::str::from_utf8(&line) {
                    callback(text);
                }
            }
            line.clear();
            overflowed = false;
        }
    }
}

fn read_bounded_output(mut output: impl Read) -> Vec<u8> {
    let mut captured = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = match output.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        let remaining = MAX_CAPTURE_BYTES.saturating_sub(captured.len());
        captured.extend_from_slice(&chunk[..read.min(remaining)]);
    }
    captured
}

fn args(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

/// The Podman machine of JHT: install.sh and the Windows enabler create it
/// under this name (JHT_PODMAN_MACHINE overrides it in both, and here).
const JHT_PODMAN_MACHINE: &str = "jht-podman";

fn jht_machine() -> String {
    std::env::var("JHT_PODMAN_MACHINE")
        .ok()
        .filter(|name| valid_machine_name(name))
        .unwrap_or_else(|| JHT_PODMAN_MACHINE.to_owned())
}

/// The memory install.sh gives the JHT machine when it creates it (and
/// `jht podman-machine-recreate`): the team was measured at about 3.9 GB.
/// A test keeps it equal to install.sh's.
pub(crate) const MACHINE_MEMORY_MIB: u64 = 4096;

/// Whether a machine's configuration file (`machine/<provider>/<name>.json`)
/// says it has less memory than the team needs. A file that does not say, or
/// cannot be read, is not reported: only a number below the size counts.
pub(crate) fn machine_config_memory_is_low(config: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(config)
        .ok()
        .and_then(|value| value["Resources"]["Memory"].as_u64())
        .is_some_and(|memory| memory < MACHINE_MEMORY_MIB)
}

/// Where Podman keeps the configuration of its machines (`machine/<provider>/<name>.json`).
fn machine_config_root(home: &std::path::Path) -> std::path::PathBuf {
    std::env::var_os("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .filter(|path| path.is_absolute())
        .unwrap_or_else(|| home.join(".config"))
        .join("containers/podman/machine")
}

/// Whether the JHT Podman machine exists on this computer (its configuration file is there). Reads files only.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn jht_machine_exists(home: &std::path::Path) -> bool {
    let file = format!("{}.json", jht_machine());
    std::fs::read_dir(machine_config_root(home))
        .map(|providers| providers.flatten().any(|provider| provider.path().join(&file).is_file()))
        .unwrap_or(false)
}

/// Whether the machine the JHT team runs on already exists with less memory
/// than it needs (created by an earlier installer, or by hand). Reads the
/// configuration files only: nothing is started, nothing is changed.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn jht_machine_memory_is_low(home: &std::path::Path) -> bool {
    let root = machine_config_root(home);
    let file = format!("{}.json", jht_machine());
    let Ok(providers) = std::fs::read_dir(root) else { return false };
    providers
        .flatten()
        .filter_map(|provider| std::fs::read_to_string(provider.path().join(&file)).ok())
        .any(|config| machine_config_memory_is_low(&config))
}

/// What the stop of the JHT machine came to.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum MachineStop {
    /// `podman machine stop` ran and the machine is off (or was already).
    Stopped,
    /// Containers that are not Job Hunter Team's run on it: it stays on for them.
    KeptForOthers(usize),
    /// The stop did not run or did not finish: the machine may still be on.
    NotStopped,
}

/// The team's containers, by the names the compose file fixes (`container_name`): the container, the broker and the Telegram
/// bridge. A container of the person's own that happens to be called `jht-something` is not one of them.
const JHT_CONTAINERS: [&str; 3] = ["jht", "jht-broker", "jht-telegram"];

fn is_jht_container(name: &str) -> bool {
    JHT_CONTAINERS.contains(&name)
}

/// How many containers a `podman ps --format {{.Names}}` answer names that are not the team's.
pub(crate) fn count_other_containers(stdout: &[u8]) -> usize {
    String::from_utf8_lossy(stdout)
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty() && !is_jht_container(name))
        .count()
}

/// The look at the containers is short: a machine that is on answers at once.
const LISTING_TIMEOUT: Duration = Duration::from_secs(10);

/// The containers running on the JHT machine that are not the team's (the team's own are stopped before this is asked).
/// None when the machine cannot be asked: not running, not installed, no answer in time.
pub(crate) fn other_containers_on_jht_machine(timeout: Duration) -> Option<usize> {
    let ps = jht_engine_args(&jht_machine(), &["ps", "--format", "{{.Names}}"]);
    match command(&ps, timeout, None, true) {
        Ok(output) if output.success => Some(count_other_containers(&output.stdout)),
        _ => None,
    }
}

/// Whether the JHT machine is on.
#[derive(Debug, PartialEq, Eq)]
enum MachineState {
    Running,
    /// Stopped, or not there at all.
    Off,
    /// The question did not get an answer.
    Unknown,
}

/// What `podman machine inspect <name> --format {{.State}}` came to. A machine that is not there makes the call fail
/// (nothing to stop), and so does a Podman that is not installed.
fn machine_state_from(outcome: Result<CommandOutcome, CommandFailure>) -> MachineState {
    match outcome {
        Ok(output) if output.success => {
            let state = String::from_utf8_lossy(&output.stdout).trim().to_ascii_lowercase();
            if matches!(state.as_str(), "stopped" | "configured") { MachineState::Off } else { MachineState::Running }
        }
        Ok(_) | Err(CommandFailure::NotFound) => MachineState::Off,
        Err(CommandFailure::TimedOut) | Err(CommandFailure::Failed) => MachineState::Unknown,
    }
}

fn machine_state(timeout: Duration) -> MachineState {
    let inspect = args(&["machine", "inspect", &jht_machine(), "--format", "{{.State}}"]);
    machine_state_from(command(&inspect, timeout, None, true))
}

/// What to do with the machine, from what is known of it: the end, or to stop it. It falls on the safe side: a machine
/// that may be on with containers nobody could list is not stopped.
#[derive(Debug, PartialEq, Eq)]
enum MachinePlan {
    Done(MachineStop),
    Stop,
}

fn machine_plan(state: MachineState, others: Option<usize>) -> MachinePlan {
    match (state, others) {
        (MachineState::Off, _) => MachinePlan::Done(MachineStop::Stopped),
        (MachineState::Unknown, _) => MachinePlan::Done(MachineStop::NotStopped),
        (MachineState::Running, Some(0)) => MachinePlan::Stop,
        (MachineState::Running, Some(others)) => MachinePlan::Done(MachineStop::KeptForOthers(others)),
        (MachineState::Running, None) => MachinePlan::Done(MachineStop::NotStopped),
    }
}

/// Stops the JHT Podman machine, the virtual machine that holds the runtime's memory (`podman machine stop`), unless
/// containers that are not the team's run on it: then it stays on for them, and the caller says so. A machine that is
/// not there or already stopped is stopped. A machine that is on and cannot be asked what runs on it is not stopped.
/// Never touches another machine.
pub(crate) fn stop_jht_machine(timeout: Duration) -> MachineStop {
    let state = machine_state(LISTING_TIMEOUT);
    let others = (state == MachineState::Running).then(|| other_containers_on_jht_machine(LISTING_TIMEOUT)).flatten();
    match machine_plan(state, others) {
        MachinePlan::Done(done) => done,
        MachinePlan::Stop => {
            // the machine is named in the call itself (`machine stop <name>` takes it as its argument, not as a connection)
            let stop = args(&["machine", "stop", &jht_machine()]);
            match command(&stop, timeout, None, false) {
                Ok(output) if output.success => MachineStop::Stopped,
                _ => MachineStop::NotStopped,
            }
        }
    }
}

fn valid_machine_name(name: &str) -> bool {
    // A name that starts with '-' would be read as an option.
    name.len() <= 64
        && name
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric())
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

/// Every engine call names the JHT connection. Without it Podman answers for
/// the DEFAULT connection: on a Mac with another machine next to ours (another
/// product's, or `podman-machine-default`, which sees the whole of /Users) the
/// app would report on, and act on, the wrong machine.
fn jht_engine_args(machine: &str, values: &[&str]) -> Vec<OsString> {
    let mut out = args(&["--connection", machine]);
    out.extend(args(values));
    out
}

fn normalized_version(stdout: &[u8]) -> Option<String> {
    let version = String::from_utf8_lossy(stdout)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    (!version.is_empty()).then(|| version.chars().take(120).collect())
}

pub(crate) fn check_podman_sync() -> PodmanStatus {
    let version_output = match command(&args(&["--version"]), VERSION_TIMEOUT, None, true) {
        Ok(output) if output.success => output,
        Ok(_) => {
            return PodmanStatus {
                installed: true,
                ready: false,
                version: None,
                issue: Some("version_failed"),
            };
        }
        Err(CommandFailure::NotFound) => {
            return PodmanStatus {
                installed: false,
                ready: false,
                version: None,
                issue: Some("not_found"),
            };
        }
        Err(CommandFailure::TimedOut) => {
            return PodmanStatus {
                installed: true,
                ready: false,
                version: None,
                issue: Some("version_timeout"),
            };
        }
        Err(CommandFailure::Failed) => {
            return PodmanStatus {
                installed: false,
                ready: false,
                version: None,
                issue: Some("check_failed"),
            };
        }
    };

    let version = normalized_version(&version_output.stdout);
    let info = jht_engine_args(&jht_machine(), &["info", "--format=json"]);
    match command(&info, INFO_TIMEOUT, None, false) {
        Ok(output) if output.success => PodmanStatus {
            installed: true,
            ready: true,
            version,
            issue: None,
        },
        Err(CommandFailure::TimedOut) => PodmanStatus {
            installed: true,
            ready: false,
            version,
            issue: Some("engine_timeout"),
        },
        _ => PodmanStatus {
            installed: true,
            ready: false,
            version,
            issue: Some("engine_unavailable"),
        },
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct PodmanError {
    code: &'static str,
}

/// Oggi nessuna schermata la chiama (`checkPodman` in lib/podman.ts non ha
/// chiamanti): l'onboarding verifica Podman dentro `onboarding_prepare`.
/// Resta registrata di proposito (decisione del 08/10/2026); i suoi codici
/// hanno comunque una frase nel catalogo degli errori.
#[tauri::command]
pub(crate) async fn check_podman(
    app: tauri::AppHandle,
    scopes: tauri::State<'_, AccountScopeState>,
) -> Result<PodmanStatus, PodmanError> {
    let expected = scopes.active().map_err(|code| PodmanError { code })?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(|code| PodmanError { code })?;
        crate::account_scope::validate_local_runtime(&app, scope.scope())
            .map_err(|code| PodmanError { code })?;
        Ok(check_podman_sync())
    })
    .await
    .unwrap_or(Err(PodmanError {
        code: "check_failed",
    }));
    let _scope = scopes
        .lock_expected(&expected)
        .map_err(|code| PodmanError { code })?;
    result
}

#[cfg(test)]
mod tests {
    use super::{
        args, count_other_containers, jht_engine_args, jht_machine, normalized_version, read_bounded_output,
        read_stderr_lines, valid_machine_name, MAX_CAPTURE_BYTES, MAX_STDERR_LINE_BYTES,
    };
    use std::sync::{Arc, Mutex};

    #[test]
    fn the_engine_check_names_the_jht_connection() {
        let info = jht_engine_args("jht-podman", &["info", "--format=json"]);
        assert_eq!(info[..3], args(&["--connection", "jht-podman", "info"])[..]);
        assert_eq!(
            jht_machine(),
            std::env::var("JHT_PODMAN_MACHINE")
                .ok()
                .filter(|name| valid_machine_name(name))
                .unwrap_or_else(|| "jht-podman".to_owned())
        );
        assert!(!valid_machine_name("jht podman"));
        assert!(!valid_machine_name("--connection"));
    }

    /// Every call that reaches the engine goes through jht_engine_args: only
    /// `--version`, which never contacts a machine, may go without it.
    #[test]
    fn no_engine_call_uses_the_default_connection() {
        let source = include_str!("podman.rs");
        let production = &source[..source.find("#[cfg(test)]").unwrap()];
        let calls: Vec<String> = production
            .match_indices("command(&")
            .map(|(at, _)| production[at..].chars().take(40).collect())
            .collect();
        assert!(
            !calls.is_empty(),
            "no command call found: the search is broken"
        );
        for call in calls {
            assert!(
                call.starts_with("command(&args(&[\"--version\"])")
                    || call.starts_with("command(&info")
                    || call.starts_with("command(&stop")
                    || call.starts_with("command(&ps")
                    || call.starts_with("command(&inspect"),
                "engine call without the JHT connection: {call}"
            );
        }
        assert!(!production.contains("args(&[\"info\""));
        // the only `machine` commands are a stop and an inspect, each naming the JHT machine itself
        assert_eq!(production.matches("args(&[\"machine\"").count(), 2);
        assert!(production.contains("args(&[\"machine\", \"stop\", &jht_machine()])"));
        assert!(production.contains("args(&[\"machine\", \"inspect\", &jht_machine(), \"--format\", \"{{.State}}\"])"));
    }

    #[test]
    fn only_the_team_s_own_containers_are_not_others() {
        assert_eq!(count_other_containers(b"jht\njht-broker\njht-telegram\n"), 0);
        assert_eq!(count_other_containers(b""), 0);
        assert_eq!(count_other_containers(b"\n  \n"), 0);
        assert_eq!(count_other_containers(b"jht\npostgres\njht-broker\nredis-cache\n"), 2);
        // the compose file fixes three names: a name that only starts like them is the person's own
        assert_eq!(count_other_containers(b"jhtx\njhtml\njht-dev\njht-broker-2\njht-telegram-test\n"), 5);
        assert_eq!(count_other_containers(b"  postgres  \r\n"), 1);
    }

    fn outcome(success: bool, stdout: &str) -> Result<CommandOutcome, CommandFailure> {
        Ok(CommandOutcome { success, stdout: stdout.as_bytes().to_vec() })
    }

    #[test]
    fn the_state_of_the_machine_is_read_and_a_missing_one_is_off() {
        assert_eq!(machine_state_from(outcome(true, "running\n")), MachineState::Running);
        assert_eq!(machine_state_from(outcome(true, "Running")), MachineState::Running);
        assert_eq!(machine_state_from(outcome(true, "starting\n")), MachineState::Running, "anything that is not off may have containers");
        assert_eq!(machine_state_from(outcome(true, "")), MachineState::Running);
        assert_eq!(machine_state_from(outcome(true, "stopped\n")), MachineState::Off);
        assert_eq!(machine_state_from(outcome(true, "configured\n")), MachineState::Off);
        // not there: the call fails, and so does a Podman that is not installed
        assert_eq!(machine_state_from(outcome(false, "")), MachineState::Off);
        assert_eq!(machine_state_from(Err(CommandFailure::NotFound)), MachineState::Off);
        // no answer: not known
        assert_eq!(machine_state_from(Err(CommandFailure::TimedOut)), MachineState::Unknown);
        assert_eq!(machine_state_from(Err(CommandFailure::Failed)), MachineState::Unknown);
    }

    #[test]
    fn the_machine_is_stopped_only_when_it_is_known_that_nobody_else_is_on_it() {
        use MachinePlan::{Done, Stop};
        // off or not there: nothing to do, and that is stopped
        assert_eq!(machine_plan(MachineState::Off, None), Done(MachineStop::Stopped));
        assert_eq!(machine_plan(MachineState::Off, Some(3)), Done(MachineStop::Stopped));
        // on, and listed: alone it is stopped, with others it is kept
        assert_eq!(machine_plan(MachineState::Running, Some(0)), Stop);
        assert_eq!(machine_plan(MachineState::Running, Some(2)), Done(MachineStop::KeptForOthers(2)));
        // on and the listing did not answer: the safe side, it is not stopped under whoever may be on it
        assert_eq!(machine_plan(MachineState::Running, None), Done(MachineStop::NotStopped));
        // not known whether it is on: not stopped either
        assert_eq!(machine_plan(MachineState::Unknown, None), Done(MachineStop::NotStopped));
        assert_eq!(machine_plan(MachineState::Unknown, Some(0)), Done(MachineStop::NotStopped));
    }

    #[test]
    fn the_listing_of_the_machine_names_the_jht_connection() {
        let source = include_str!("podman.rs");
        let production = &source[..source.find("#[cfg(test)]").unwrap()];
        assert!(production.contains("jht_engine_args(&jht_machine(), &[\"ps\", \"--format\", \"{{.Names}}\"])"));
    }

    #[test]
    fn the_engine_is_run_by_the_path_of_the_install_when_the_path_of_the_app_has_no_homebrew() {
        // the cause of the machine that stayed on after «Exit»: the bare name is not found from an app opened from Finder
        let source = include_str!("podman.rs");
        let production = &source[..source.find("#[cfg(test)]").unwrap()];
        assert!(production.contains("Command::new(program)") && !production.contains("Command::new(\"podman\")"));
        assert!(production.contains("crate::direct_chat::trusted_podman()"));
        // the child runs with a fixed PATH, not the one the app was opened with
        assert!(production.contains("[\"/usr/bin\", \"/bin\", \"/usr/sbin\", \"/sbin\"]") && !production.contains("env::var_os(\"PATH\")"));
    }

    #[test]
    fn normalizes_podman_version_output() {
        assert_eq!(
            normalized_version(b"podman version 5.5.2\r\n"),
            Some("podman version 5.5.2".to_string())
        );
    }

    #[test]
    fn ignores_empty_version_output() {
        assert_eq!(normalized_version(b"  \n"), None);
    }

    #[test]
    fn drains_but_bounds_captured_process_output() {
        let oversized = vec![b'x'; MAX_CAPTURE_BYTES + 4096];
        assert_eq!(
            read_bounded_output(oversized.as_slice()).len(),
            MAX_CAPTURE_BYTES
        );
    }

    #[test]
    fn drops_oversized_stderr_lines_and_keeps_following_events() {
        let input = format!("{}\nvalid\r\n", "x".repeat(MAX_STDERR_LINE_BYTES + 1));
        let lines = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&lines);

        read_stderr_lines(
            input.as_bytes(),
            Box::new(move |line| captured.lock().expect("line lock").push(line.to_owned())),
        );

        assert_eq!(*lines.lock().expect("line lock"), vec!["valid"]);
    }

    #[test]
    fn a_machine_below_the_team_size_is_reported_and_one_at_it_is_not() {
        use super::{machine_config_memory_is_low, MACHINE_MEMORY_MIB};
        let config = |memory: &str| format!(r#"{{"Name":"jht-podman","Resources":{{"CPUs":5,"DiskSize":100,"Memory":{memory},"USBs":[]}}}}"#);
        assert!(machine_config_memory_is_low(&config("2048")));
        assert!(machine_config_memory_is_low(&config("3072")));
        assert!(!machine_config_memory_is_low(&config(&MACHINE_MEMORY_MIB.to_string())));
        assert!(!machine_config_memory_is_low(&config("8192")));
        // what does not say a number is not reported: nothing is claimed about it
        for unknown in ["{}", r#"{"Resources":{}}"#, r#"{"Resources":{"Memory":"2048"}}"#, "not json", ""] {
            assert!(!machine_config_memory_is_low(unknown), "{unknown}");
        }
    }

    #[test]
    fn the_size_the_app_expects_is_the_one_install_sh_gives() {
        let installer = include_str!("../../../scripts/install.sh");
        let line = installer
            .lines()
            .find_map(|line| line.strip_prefix("PODMAN_MACHINE_MEMORY_MIB="))
            .expect("install.sh sets the machine memory");
        assert_eq!(line.trim(), super::MACHINE_MEMORY_MIB.to_string());
    }

    #[test]
    fn the_machine_files_of_every_provider_are_read_and_nothing_is_written() {
        use super::jht_machine_memory_is_low;
        let home = std::env::temp_dir().join(format!("jht-machine-memory-{}", std::process::id()));
        let machine = home.join(".config/containers/podman/machine/applehv");
        std::fs::create_dir_all(&machine).unwrap();
        let file = machine.join("jht-podman.json");
        std::fs::write(&file, r#"{"Resources":{"Memory":2048}}"#).unwrap();
        let other = machine.join("other-podman.json");
        std::fs::write(&other, r#"{"Resources":{"Memory":1024}}"#).unwrap();
        // XDG_CONFIG_HOME is the process's: the test only reads the home it passes
        let saved = std::env::var_os("XDG_CONFIG_HOME");
        std::env::remove_var("XDG_CONFIG_HOME");
        let low = jht_machine_memory_is_low(&home);
        let exists = super::jht_machine_exists(&home);
        std::fs::write(&file, r#"{"Resources":{"Memory":4096}}"#).unwrap();
        let enough = jht_machine_memory_is_low(&home);
        std::fs::remove_file(&file).unwrap();
        let absent = jht_machine_memory_is_low(&home);
        let gone = !super::jht_machine_exists(&home);
        if let Some(value) = saved {
            std::env::set_var("XDG_CONFIG_HOME", value);
        }
        std::fs::remove_file(&other).unwrap();
        std::fs::remove_dir_all(&home).ok();
        assert!(low, "2048 MiB is below the team size");
        assert!(!enough, "4096 MiB is the team size");
        assert!(!absent, "no machine file, nothing to report (another machine's file does not count)");
        assert!(exists && gone, "the machine exists while its file is there, and another machine's file does not count");
    }
}

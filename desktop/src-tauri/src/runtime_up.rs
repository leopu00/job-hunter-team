//! What `jht up` does before it asks the engine for the team, now in the app (stage 4a of the plan to move the host scripts into
//! the app, first piece).
//!
//! On Windows the engine is a Podman machine inside WSL, and `jht up` starts with it: it wakes the machine if the engine does
//! not answer, then makes sure the two folders the container mounts are there. The wrapper still does the rest of `up` (the
//! services one after the other, the compose up, the broker's migration and web authorisations); it finds the machine
//! already awake and the folders already made, and does nothing of this twice.
//!
//! Which machine is the team's is said by the runtime's own `podman-machine` file (the attested bundle), never by an
//! environment variable. The exit codes and the words are the wrapper's (21 Podman cannot be run, 22 the machine does not
//! start, 1 a folder cannot be made), so the Container step reads them as it always did (`windows_runtime::exit_failure`).

#![cfg_attr(not(windows), allow(dead_code))]

use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::runtime_host::ProcessResult;

/// The exit codes `jht up` ends with when the machine cannot be got ready.
pub(crate) const EXIT_PODMAN_NOT_INSTALLABLE: i32 = 21;
pub(crate) const EXIT_MACHINE_UNAVAILABLE: i32 = 22;
const EXIT_USER_DIR_UNAVAILABLE: i32 = 1;

/// How long the engine may take to answer `info`, and the machine to start (WSL boots a VM).
const ENGINE_ANSWER_TIMEOUT: Duration = Duration::from_secs(25);
const MACHINE_START_TIMEOUT: Duration = Duration::from_secs(240);
const PODMAN_VERSION_TIMEOUT: Duration = Duration::from_secs(8);

/// The two folders of the person's profile the team's container mounts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MountDir {
    /// `.jht`
    Home,
    /// `Documents\Job Hunter Team`
    User,
}

/// What the machine and the folders need, as questions to the computer. The real one asks Podman; a test answers.
pub(crate) trait Prerequisites {
    /// The engine answers (`docker info` through the runtime's own shim, on the team's machine).
    fn engine_reachable(&self) -> bool;
    /// Podman can be run at all.
    fn podman_available(&self) -> bool;
    /// `podman machine start` of the team's machine ended well.
    fn start_machine(&self) -> bool;
    /// The folder is there, made now if it was not.
    fn make_dir(&self, dir: MountDir) -> bool;
}

/// Why the start cannot go on, with the exit code the wrapper's `up` has for it and its closed reason word.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Refusal {
    pub(crate) code: i32,
    pub(crate) reason: &'static str,
}

impl Refusal {
    pub(crate) fn into_result(self) -> ProcessResult {
        ProcessResult { code: self.code, stdout: Vec::new() }
    }
}

/// The machine awake (only the explicit `up` may wake it: status and snapshot only look), then the folders. Nothing is asked
/// of the machine when the engine already answers.
pub(crate) fn prepare(host: &dyn Prerequisites) -> Result<(), Refusal> {
    if !host.engine_reachable() {
        if !host.podman_available() {
            return Err(Refusal { code: EXIT_PODMAN_NOT_INSTALLABLE, reason: "podman_not_installable" });
        }
        if !host.start_machine() || !host.engine_reachable() {
            return Err(Refusal { code: EXIT_MACHINE_UNAVAILABLE, reason: "podman_machine_unavailable" });
        }
    }
    for dir in [MountDir::Home, MountDir::User] {
        if !host.make_dir(dir) {
            return Err(Refusal { code: EXIT_USER_DIR_UNAVAILABLE, reason: "user_dir_unavailable" });
        }
    }
    Ok(())
}

/// A name Podman accepts for a machine, the one the runtime's file may carry: letters, digits, `_`, `.`, `-`, not starting with
/// `-` (it would be read as an option), at most 64.
pub(crate) fn valid_machine_name(name: &str) -> bool {
    name.len() <= 64
        && name.bytes().next().is_some_and(|byte| byte.is_ascii_alphanumeric())
        && name.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

/// The machine the runtime's `podman-machine` file names; the default when the file is not there. A file that is there and
/// does not name a machine is `None`: nothing is started on its word.
pub(crate) fn machine_of_runtime(contents: Option<&str>) -> Option<String> {
    match contents {
        None => Some("jht-podman".to_owned()),
        Some(text) => Some(text.trim()).filter(|name| valid_machine_name(name)).map(str::to_owned),
    }
}

/// The folders a mount needs, under the profile `home`.
pub(crate) fn mount_path(home: &Path, dir: MountDir) -> PathBuf {
    match dir {
        MountDir::Home => home.join(".jht"),
        MountDir::User => home.join("Documents").join("Job Hunter Team"),
    }
}

/// Windows with the Podman engine: the start that `up` is about to ask for, prepared. `None` when there is nothing to refuse
/// (the engine is another one, or everything is ready); `Some(result)` is what `jht up` would have ended with.
#[cfg(windows)]
pub(crate) fn refusal_before_up(home: &Path, log: Option<&crate::runtime_log::RuntimeLog>) -> Option<ProcessResult> {
    let runtime = crate::windows_runtime::runtime_dir(std::env::var_os("LOCALAPPDATA"))?;
    let engine = std::fs::read_to_string(runtime.join("container-runtime")).ok()?;
    if engine.trim() != "podman" {
        return None;
    }
    let shim = runtime.join("bin").join("docker.exe");
    if !std::fs::symlink_metadata(&shim).is_ok_and(|metadata| metadata.file_type().is_file()) {
        return None;
    }
    let machine = machine_of_runtime(std::fs::read_to_string(runtime.join("podman-machine")).ok().as_deref())?;
    let host = windows::Machine { runtime, shim, machine, home: home.to_path_buf() };
    let started = std::time::Instant::now();
    let refusal = prepare(&host).err()?;
    if let Some(log) = log {
        log.record("up prepare", Ok(refusal.code), &[], refusal.reason.as_bytes(), started.elapsed());
    }
    Some(refusal.into_result())
}

#[cfg(windows)]
mod windows {
    use super::*;
    use std::ffi::OsString;

    /// The team's machine as Podman and the runtime's own shim see it.
    pub(super) struct Machine {
        pub(super) runtime: PathBuf,
        pub(super) shim: PathBuf,
        pub(super) machine: String,
        pub(super) home: PathBuf,
    }

    impl Prerequisites for Machine {
        fn engine_reachable(&self) -> bool {
            let Some(shim) = self.shim.to_str() else { return false };
            let (ended, _) = crate::runtime_host::run_program_keeping_stderr_with_environment(
                shim,
                ["info"],
                None,
                ENGINE_ANSWER_TIMEOUT,
                &self.runtime,
                &[],
                &[("CONTAINER_CONNECTION", self.machine.as_str())],
            );
            ended.is_ok_and(|result| result.success())
        }

        fn podman_available(&self) -> bool {
            crate::podman::command(&[OsString::from("--version")], PODMAN_VERSION_TIMEOUT, None, true).is_ok_and(|outcome| outcome.success)
        }

        fn start_machine(&self) -> bool {
            let start = [
                OsString::from("machine"),
                OsString::from("start"),
                OsString::from("--update-connection=false"),
                OsString::from(&self.machine),
            ];
            crate::podman::command(&start, MACHINE_START_TIMEOUT, None, false).is_ok_and(|outcome| outcome.success)
        }

        fn make_dir(&self, dir: MountDir) -> bool {
            let path = mount_path(&self.home, dir);
            std::fs::metadata(&path).is_ok_and(|metadata| metadata.is_dir()) || std::fs::create_dir_all(&path).is_ok()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// A computer that answers as it is told, and remembers what it was asked.
    struct Fake {
        /// Answers of `engine_reachable`, in order; the last one repeats.
        reachable: RefCell<Vec<bool>>,
        podman: bool,
        starts: bool,
        dirs_fail_at: Option<MountDir>,
        asked: RefCell<Vec<String>>,
    }

    impl Fake {
        fn new(reachable: &[bool], podman: bool, starts: bool) -> Self {
            Self {
                reachable: RefCell::new(reachable.iter().rev().copied().collect()),
                podman,
                starts,
                dirs_fail_at: None,
                asked: RefCell::new(Vec::new()),
            }
        }

        fn log(&self) -> Vec<String> {
            self.asked.borrow().clone()
        }
    }

    impl Prerequisites for Fake {
        fn engine_reachable(&self) -> bool {
            self.asked.borrow_mut().push("reachable".into());
            let mut left = self.reachable.borrow_mut();
            if left.len() > 1 {
                left.pop().unwrap()
            } else {
                *left.last().unwrap()
            }
        }

        fn podman_available(&self) -> bool {
            self.asked.borrow_mut().push("podman".into());
            self.podman
        }

        fn start_machine(&self) -> bool {
            self.asked.borrow_mut().push("start".into());
            self.starts
        }

        fn make_dir(&self, dir: MountDir) -> bool {
            self.asked.borrow_mut().push(format!("dir {dir:?}"));
            self.dirs_fail_at != Some(dir)
        }
    }

    #[test]
    fn a_machine_that_already_answers_is_not_started_again_and_the_folders_are_made() {
        let host = Fake::new(&[true], true, true);
        assert_eq!(prepare(&host), Ok(()));
        assert_eq!(host.log(), ["reachable", "dir Home", "dir User"]);
    }

    #[test]
    fn a_machine_that_does_not_answer_is_started_once_and_asked_again_before_the_folders() {
        let host = Fake::new(&[false, true], true, true);
        assert_eq!(prepare(&host), Ok(()));
        assert_eq!(host.log(), ["reachable", "podman", "start", "reachable", "dir Home", "dir User"]);
    }

    #[test]
    fn without_podman_nothing_is_started_and_the_code_is_the_wrappers_21() {
        let host = Fake::new(&[false], false, true);
        let refused = prepare(&host).unwrap_err();
        assert_eq!(refused, Refusal { code: 21, reason: "podman_not_installable" });
        assert_eq!(host.log(), ["reachable", "podman"], "no start, no folder");
    }

    #[test]
    fn a_machine_that_does_not_start_or_still_does_not_answer_is_the_wrappers_22() {
        let no_start = Fake::new(&[false], true, false);
        assert_eq!(prepare(&no_start).unwrap_err(), Refusal { code: 22, reason: "podman_machine_unavailable" });
        assert_eq!(no_start.log(), ["reachable", "podman", "start"], "no second question after a start that failed");
        let mute = Fake::new(&[false, false], true, true);
        assert_eq!(prepare(&mute).unwrap_err().code, 22);
        assert_eq!(mute.log(), ["reachable", "podman", "start", "reachable"], "no folder before the engine answers");
    }

    #[test]
    fn a_folder_that_cannot_be_made_stops_the_start_with_the_wrappers_code_1() {
        let mut host = Fake::new(&[true], true, true);
        host.dirs_fail_at = Some(MountDir::User);
        assert_eq!(prepare(&host).unwrap_err(), Refusal { code: 1, reason: "user_dir_unavailable" });
        assert_eq!(host.log(), ["reachable", "dir Home", "dir User"]);
    }

    #[test]
    fn the_refusal_ends_as_the_wrapper_would_and_the_codes_are_the_ones_the_container_step_reads() {
        let result = Refusal { code: 22, reason: "podman_machine_unavailable" }.into_result();
        assert_eq!((result.code, result.stdout.len()), (22, 0));
        assert_eq!(crate::windows_runtime::exit_failure(EXIT_PODMAN_NOT_INSTALLABLE), Some("podman_missing"));
        assert_eq!(crate::windows_runtime::exit_failure(EXIT_MACHINE_UNAVAILABLE), Some("podman_start_failed"));
    }

    #[test]
    fn the_machine_is_the_one_the_runtime_file_names_and_a_file_that_names_none_starts_nothing() {
        assert_eq!(machine_of_runtime(None).as_deref(), Some("jht-podman"));
        assert_eq!(machine_of_runtime(Some("team-machine\r\n")).as_deref(), Some("team-machine"));
        assert_eq!(machine_of_runtime(Some("  jht-podman ")).as_deref(), Some("jht-podman"));
        for contents in ["", "\n", "--connection", "two words", "a/b", "-x", &"a".repeat(65)] {
            assert_eq!(machine_of_runtime(Some(contents)), None, "{contents:?}");
        }
        assert!(valid_machine_name("a") && valid_machine_name("jht-podman-2") && valid_machine_name("m_1.x"));
    }

    #[test]
    fn the_folders_are_the_ones_the_compose_file_mounts() {
        let home = Path::new("profile");
        assert_eq!(mount_path(home, MountDir::Home), Path::new("profile").join(".jht"));
        assert_eq!(mount_path(home, MountDir::User), Path::new("profile").join("Documents").join("Job Hunter Team"));
    }

    #[test]
    fn the_real_questions_never_name_a_machine_by_the_environment() {
        let source = include_str!("runtime_up.rs").replace("\r\n", "\n");
        let production = source.split("\n#[cfg(test)]").next().unwrap();
        for forbidden in ["JHT_PODMAN_MACHINE", "env::var(\"CONTAINER_CONNECTION\")", "env::var(\"CONTAINER_HOST\")"] {
            let mentions: Vec<&str> = production.lines().filter(|line| line.contains(forbidden) && !line.trim_start().starts_with("//")).collect();
            assert!(mentions.is_empty(), "{forbidden}: {mentions:?}");
        }
    }
}

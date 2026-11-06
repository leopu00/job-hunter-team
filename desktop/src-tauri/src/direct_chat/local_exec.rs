use super::*;

pub(super) fn local_chat_exec_args(
    container: &str,
    operation: &ChatOperation<'_>,
) -> Result<Vec<OsString>, &'static str> {
    if !container_id(container) {
        return Err("container_unavailable");
    }
    let mut args = vec![
        OsString::from("exec"),
        OsString::from("-i"),
        OsString::from(container),
        OsString::from("python3"),
        OsString::from("-I"),
        OsString::from("/app/shared/skills/agent_chat.py"),
    ];
    args.extend(
        existing_team_runtime::chat_arguments(operation)?
            .into_iter()
            .map(OsString::from),
    );
    Ok(args)
}

/// What the wrapper's `python` action ran in the container: the first line of standard input is the hex of the
/// program, which is read and executed. No double quote in it (Windows PowerShell 5.1 dropped them in a native argument).
pub(super) const LOCAL_PYTHON_LAUNCH: &str = "import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())";

/// What the wrapper's `send` action ran: the message on standard input to the container's tmux helper, with the session as
/// `$1`. The empty IFS and `set -f` keep the message one word and its `*` and `?` from matching file names, as the quotes
/// did; there are none, so the line reaches the engine the same through every shell.
pub(super) const LOCAL_DELIVERY_SCRIPT: &str = "IFS=; set -f; msg=$(cat); exec jht-tmux-send $1 $msg";

/// The probe, the Python scripts and the delivery of a message on this computer's team, without the wrapper: the
/// same attested container the chat finds (kept for a few seconds, shared with the chat's reads) and the program
/// the wrapper ran in it. The probe is the finding: a container that is there answers «true».
pub(super) fn run_local_native(
    wrapper: &Path,
    runtime: &Path,
    operation: &RemoteOperation<'_>,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, &'static str> {
    if let RemoteOperation::Delivery(session) = operation {
        if !existing_team_runtime::chat_session_ok(session) {
            return Err("invalid_agent");
        }
    }
    let team = local_chat_team(wrapper, runtime, timeout)?;
    let result = match operation {
        RemoteOperation::Probe => return Ok(ProcessResult { code: 0, stdout: b"true\n".to_vec() }),
        RemoteOperation::Python => team.exec(&["python3", "-c", LOCAL_PYTHON_LAUNCH], input, timeout),
        RemoteOperation::Delivery(session) => team.exec(&["sh", "-c", LOCAL_DELIVERY_SCRIPT, "sh", *session], input, timeout),
        RemoteOperation::Chat(_) => return Err("invalid_request"),
    };
    // the engine could not run the exec, or says the container is gone (125): the next call finds it again. The delivery's
    // own codes (2 to 5) and a timeout are not a lost container.
    let lost = match &result {
        Err(code) => *code != "process_timeout",
        Ok(done) => done.code == 125,
    };
    if lost {
        forget_local_chat_team(wrapper, runtime);
    }
    result
}

/// The local implementation of read/send/answer/enter executes no wrapper action. Its protected
/// runtime, selected engine and single running container are verified in Rust before native exec.
pub(super) fn run_local_chat(
    wrapper: &Path,
    runtime: &Path,
    operation: ChatOperation<'_>,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, &'static str> {
    let team = local_chat_team(wrapper, runtime, timeout)?;
    let result = run_local_engine(
        &team.engine,
        local_chat_exec_args(&team.container, &operation)?,
        input,
        timeout,
    );
    if engine_lost_the_container(&result) {
        forget_local_chat_team(wrapper, runtime);
    }
    result
}

/// The engine could not run the exec (not a timeout), or answered that the container is gone (exit 125, Podman's
/// "no such container"; also an exit the chat script never uses): the container found a moment ago
/// is no longer the one, so the next call finds it again instead of failing for five more seconds.
pub(super) fn engine_lost_the_container(result: &Result<ProcessResult, &'static str>) -> bool {
    match result {
        // A slow engine is not a lost container: emptying the kept one at every timeout would make each call pay the lookup.
        Err(code) => *code != "process_timeout",
        Ok(done) => done.code != 0 && (done.code == 125 || chat_failure(done.code, "").is_empty()),
    }
}

/// How long the container found for one chat call serves the next ones.
pub(super) const LOCAL_CHAT_TEAM_KEPT: Duration = Duration::from_secs(5);

pub(super) static LOCAL_CHAT_TEAM: crate::team_control::ResolveCache<AttestedLocalTeam> = crate::team_control::ResolveCache::new();

/// The attested container of this computer's team for a chat call. The page reads an agent's chat
/// several times a second and sends from it: finding the container is the runtime check plus two
/// engine calls (5 to 10 s on Windows), so one found a moment ago is reused, and a lookup that
/// fails keeps nothing.
pub(super) fn local_chat_team(wrapper: &Path, runtime: &Path, timeout: Duration) -> Result<Arc<AttestedLocalTeam>, &'static str> {
    LOCAL_CHAT_TEAM.get(&local_chat_team_key(wrapper, runtime), Instant::now(), LOCAL_CHAT_TEAM_KEPT, true, || AttestedLocalTeam::resolve(wrapper, runtime, timeout))
}

pub(super) fn local_chat_team_key(wrapper: &Path, runtime: &Path) -> String {
    format!("{}\n{}", wrapper.display(), runtime.display())
}

/// Drops the kept container: a lookup that fails keeps nothing, so asking for a fresh one that fails
/// empties the slot.
pub(super) fn forget_local_chat_team(wrapper: &Path, runtime: &Path) {
    let _ = LOCAL_CHAT_TEAM.get(&local_chat_team_key(wrapper, runtime), Instant::now(), LOCAL_CHAT_TEAM_KEPT, false, || Err("container_unavailable"));
}

/// The attested local runtime directory, for the commands that run in the team's container without
/// the wrapper (team_control).
pub(crate) fn local_runtime_path(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    local_runtime_dir(app).map_err(|_| "runtime_missing")
}

/// The local team's container as the chat finds it: the runtime bundle attested, the private engine
/// selected, and the one running `jht` service whose labels match. Resolved once; every command
/// then runs in it as `exec <id> <argv>`, with no shell and no wrapper in between.
pub(crate) struct AttestedLocalTeam {
    pub(super) engine: LocalChatEngine,
    pub(super) container: String,
}

impl AttestedLocalTeam {
    pub(crate) fn resolve(wrapper: &Path, runtime: &Path, timeout: Duration) -> Result<Self, &'static str> {
        if !local_chat_runtime_valid(wrapper, runtime) {
            return Err("runtime_missing");
        }
        let engine = local_chat_engine(runtime)?;
        let container = local_chat_container(&engine, runtime, timeout)?;
        Ok(Self { engine, container })
    }

    /// The id of the container this team was attested as.
    pub(crate) fn container_id(&self) -> &str {
        &self.container
    }

    /// The container found again from the runtime and still this one (a second attestation, once, after a long exec was opened).
    pub(crate) fn is_still_the_container(&self, runtime: &Path, timeout: Duration) -> bool {
        local_chat_container(&self.engine, runtime, timeout).is_ok_and(|id| id == self.container)
    }

    /// `exec -i <container> <argv>` left running, with both pipes: for the long exec of the state stream. Its
    /// standard error goes nowhere; the caller closes it. Same engine, same environment as every other exec here.
    pub(crate) fn spawn_exec(&self, argv: &[&str]) -> Result<std::process::Child, &'static str> {
        let args = attested_exec_args(&self.container, argv, true)?;
        let program = self.engine.program.to_str().ok_or("runtime_missing")?;
        let mut command = std::process::Command::new(program);
        command.args(args).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::null());
        for name in local_engine_removed_environment(&self.engine) {
            command.env_remove(name);
        }
        crate::runtime_host::hide_console(&mut command);
        crate::runtime_host::spawn_retrying_busy(&mut command).map_err(|_| "process_start_failed")
    }

    /// `exec [-i] <container> <argv>`: `-i` only when there is stdin to give.
    pub(crate) fn exec(&self, argv: &[&str], input: Option<&[u8]>, timeout: Duration) -> Result<ProcessResult, &'static str> {
        run_local_engine(&self.engine, attested_exec_args(&self.container, argv, input.is_some())?, input, timeout)
    }
}

pub(super) fn attested_exec_args(container: &str, argv: &[&str], with_input: bool) -> Result<Vec<OsString>, &'static str> {
    if !container_id(container) || argv.is_empty() {
        return Err("container_unavailable");
    }
    let mut args = vec![OsString::from("exec")];
    if with_input {
        args.push(OsString::from("-i"));
    }
    args.push(OsString::from(container));
    args.extend(argv.iter().map(OsString::from));
    Ok(args)
}

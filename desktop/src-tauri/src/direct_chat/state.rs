use super::*;

pub(super) const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
pub(super) const READ_TIMEOUT: Duration = Duration::from_secs(20);
pub(super) const SEND_TIMEOUT: Duration = Duration::from_secs(105);
/// The most bytes of the user's text that go on the chat command's standard input (the script
/// refuses more again, after cleaning it).
pub(super) const MAX_CHAT_STDIN_BYTES: usize = 16 * 1024;
#[derive(Default)]
pub(crate) struct DirectChatState {
    pub(super) inner: Arc<DirectChatInner>,
}

#[derive(Default)]
pub(super) struct DirectChatInner {
    pub(super) connection: Mutex<Option<Connection>>,
    /// What the last probe said, for a little while: see `ProbeMemo`.
    pub(super) probe_memo: Mutex<ProbeMemo>,
    pub(super) subscribers: Mutex<Vec<Channel<DirectChatEvent>>>,
    pub(super) send_lock: Mutex<()>,
    /// An attachment is being chosen, copied or told: a second one waits for the person to finish.
    /// Its own `Arc`: the guard that holds it must not carry the whole state (and the connection's drop glue) with it.
    pub(super) attach_busy: Arc<std::sync::atomic::AtomicBool>,
}

/// How long a probe's answer is kept. A probe is a process on the computer (seconds on a slow one), and the
/// screens ask «is the chat there?» more often than that answer changes; the answer of a team that is up
/// is kept longer than a failure, which the person may be fixing.
pub(super) const PROBE_READY_KEPT: Duration = Duration::from_secs(15);
pub(super) const PROBE_FAILED_KEPT: Duration = Duration::from_secs(5);

/// The last probe's answer for an account, with the moment it was taken. Whoever finds it fresh uses it and
/// starts no process; it is dropped whenever the connection changes (connect, reconnect, close, sign-out).
#[derive(Default)]
pub(super) struct ProbeMemo {
    pub(super) kept: Option<(AccountScope, std::time::Instant, DirectChatStatus)>,
}

impl ProbeMemo {
    pub(super) fn fresh(&self, scope: &AccountScope, now: std::time::Instant) -> Option<DirectChatStatus> {
        let (kept_scope, at, answer) = self.kept.as_ref()?;
        let life = if answer.state == "ready" { PROBE_READY_KEPT } else { PROBE_FAILED_KEPT };
        (kept_scope == scope && now.saturating_duration_since(*at) < life).then(|| answer.clone())
    }

    pub(super) fn keep(&mut self, scope: &AccountScope, now: std::time::Instant, answer: &DirectChatStatus) {
        self.kept = Some((scope.clone(), now, answer.clone()));
    }

    pub(super) fn forget(&mut self) {
        self.kept = None;
    }
}

/// Drops the kept probe answer: the connection it described is gone or new.
pub(super) fn forget_probe(inner: &DirectChatInner) {
    if let Ok(mut memo) = inner.probe_memo.lock() {
        memo.forget();
    }
}

/// The kept answer when it is fresh, otherwise `probe`'s, kept in its turn. The caller holds the connection's
/// lock (on a VPS; on this computer the container's lookup is one at a time and kept), so a second ask that comes while a
/// probe runs finds its answer here, or the container already found: no second process for both.
pub(super) fn status_kept_or_probed(
    memo: &Mutex<ProbeMemo>,
    scope: &AccountScope,
    now: impl Fn() -> std::time::Instant,
    probe: impl FnOnce() -> DirectChatStatus,
) -> DirectChatStatus {
    if let Some(answer) = memo.lock().ok().and_then(|memo| memo.fresh(scope, now())) {
        return answer;
    }
    let answer = probe();
    if let Ok(mut memo) = memo.lock() {
        memo.keep(scope, now(), &answer);
    }
    answer
}

pub(super) struct Connection {
    pub(super) app: Option<tauri::AppHandle>,
    pub(super) scope: AccountScope,
    pub(super) host: ExecutionHost,
    pub(super) validated: ValidatedHost,
    pub(super) runtime: Option<ActivatedTarget>,
    pub(super) local_wrapper: Option<PathBuf>,
    pub(super) local_runtime: Option<PathBuf>,
    pub(super) local_owner_marker: Option<PathBuf>,
    pub(super) control_path: Option<PathBuf>,
    pub(super) tunnel: Option<Child>,
    pub(super) link: VpsLink,
}

/// How the app talks to a VPS. `Master`: one ssh master (ControlMaster) that every command reuses.
/// `PerCommand`: Windows' ssh (Win32-OpenSSH) has no ControlMaster (PowerShell/Win32-OpenSSH#405,
/// T69), so every command is its own connection, and ssh gets no pipe (its 9.5p1 hangs on one).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum VpsLink {
    Master,
    PerCommand,
}

pub(super) fn vps_link_for(os: &str) -> VpsLink {
    if os == "windows" {
        VpsLink::PerCommand
    } else {
        VpsLink::Master
    }
}

pub(super) enum RemoteOperation<'a> { Probe, Python, Delivery(&'a str), Chat(ChatOperation<'a>) }

impl Drop for Connection {
    fn drop(&mut self) {
        close_connection(self);
    }
}

impl Connection {
    /// This computer's team, as far as a call needs it: the paths of the attested runtime, the owner's marker, the
    /// account. It owns no tunnel and no ssh master, so it can be used without the connection's lock and dropped with no
    /// side effect. None for a VPS, whose master and tunnel belong to the connection itself.
    pub(super) fn detached_local(&self) -> Option<Connection> {
        if !matches!(self.validated, ValidatedHost::Local) {
            return None;
        }
        Some(Connection {
            app: self.app.clone(),
            scope: self.scope.clone(),
            host: self.host.clone(),
            validated: self.validated.clone(),
            runtime: None,
            local_wrapper: self.local_wrapper.clone(),
            local_runtime: self.local_runtime.clone(),
            local_owner_marker: self.local_owner_marker.clone(),
            control_path: None,
            tunnel: None,
            link: self.link,
        })
    }
}

/// A connection of the tests of `with_connection_read`, built here and not in the tests' text: a test that builds one runs on
/// Unix only (see `only_unix_tests_build_a_connection`).
#[cfg(all(test, unix))]
pub(super) fn synthetic_connection(validated: ValidatedHost, scope: &AccountScope) -> Connection {
    Connection {
        app: None,
        scope: scope.clone(),
        host: ExecutionHost::Local,
        validated,
        runtime: None,
        local_wrapper: Some(PathBuf::from("/synthetic/wrapper")),
        local_runtime: Some(PathBuf::from("/synthetic/runtime")),
        local_owner_marker: Some(PathBuf::from("/synthetic/marker")),
        control_path: None,
        tunnel: None,
        link: VpsLink::Master,
    }
}

/// Runs a READ of the connection of `scope`. On this computer the connection's lock is let go before the work (the
/// exec in the team's container, a second or more, and many more with the old wrapper), so that a read of the profile,
/// a read of the chat and a probe do not wait for each other; on a VPS the lock is kept, because the ssh master and the
/// tunnel are the connection's own. A connection that is not of `scope`, or none, is refused before anything runs.
pub(super) fn with_connection_read<T>(
    inner: &DirectChatInner,
    scope: &AccountScope,
    work: impl FnOnce(&Connection) -> Result<T, DirectChatError>,
) -> Result<T, DirectChatError> {
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    if &connection.scope != scope {
        return Err(failure("account_scope_mismatch"));
    }
    match connection.detached_local() {
        Some(local) => {
            drop(slot);
            work(&local)
        }
        None => work(connection),
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub(crate) struct DirectChatStatus {
    pub(super) state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) code: Option<&'static str>,
    /// `per-command` when every read costs a new ssh connection (Windows to a VPS): the page reads
    /// less often then.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) link: Option<&'static str>,
}

/// The codes a system line of the chat may carry. The page has a sentence for each, in every language.
#[derive(Debug, Serialize)]
pub(crate) struct DirectChatError {
    pub(crate) code: &'static str,
}
pub(crate) fn failure(code: &'static str) -> DirectChatError {
    DirectChatError { code }
}
pub(super) fn status(state: &'static str, code: Option<&'static str>) -> DirectChatStatus {
    DirectChatStatus { state, code, link: None }
}

/// A connection that answered, with the way its commands reach the VPS when that costs a connection each.
pub(super) fn ready_for(connection: &Connection) -> DirectChatStatus {
    ready_status(&connection.validated, connection.link)
}

pub(super) fn ready_status(validated: &ValidatedHost, link: VpsLink) -> DirectChatStatus {
    DirectChatStatus {
        link: (matches!(validated, ValidatedHost::Vps { .. }) && link == VpsLink::PerCommand).then_some("per-command"),
        ..status("ready", None)
    }
}

pub(super) fn emit(inner: &DirectChatInner, event: DirectChatEvent) {
    if let Ok(mut subscribers) = inner.subscribers.lock() {
        subscribers.retain(|channel| channel.send(event.clone()).is_ok());
    }
}

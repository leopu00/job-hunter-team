//! The one exec the app keeps open to this computer's team (`jht state-stream` in the container), and the
//! hot reads that go over it: the chat, the agents' panel and the profile bar.
//!
//! Every read used to be a new exec: look for the container, attest it, open the connection, start an
//! interpreter. Here the container is attested ONCE when the stream opens, and a read is a line written to the
//! stream and a line read back (a few milliseconds). The stream is an optimisation and never a dependency:
//! every read that cannot be answered by it (it is off, not open yet, fell, said an error of its own, answered
//! something this side does not accept) is made the way it was, in the same call.
//!
//! What does NOT change:
//!   - What the container runs for a read is the reader that already existed (`agent_chat.py read`,
//!     `agent_control.py list|team|screen`, the profile script); the answer comes back as its stdout and its exit
//!     code, and the caller closes it with the parsers it had. The stream adds no new shape for the page.
//!   - Nothing that changes something goes over the stream: the actions, the chat's send/answer/enter, the
//!     gates (owner, destination, `app_exit_*`) stay exec by exec, each with its own gate. After one of those
//!     the stream is told to drop what it kept.
//!   - The page's commands keep their contract. The page learns two new things: `state-stream://event` (a topic
//!     changed, read again; never content) and `state-stream://status` / `state_stream_status`.
//!
//! What this side trusts of the container: nothing. A line over the cap, too deep, not one of the closed shapes,
//! an id that was not asked, a second hello, a code of error that is not on the list: the stream is closed and
//! the reads go back to the old way. An event reaches the page only for a topic this side watches, named from
//! this side's table, at a rate this side limits.

use crate::account_scope::{AccountScope, AccountScopeState};
use crate::direct_chat::AttestedLocalTeam;
use crate::runtime_host::ProcessResult;
use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};

/// The only program the stream starts in the container, by absolute path: the container's PATH has folders the
/// agents can write ahead of /usr/bin. The memory cap is the old-space of the one process, sized for the whole
/// CLI loaded plus the kept answers (4 MiB) and a reader's output (1 MiB).
const NODE: &str = "/usr/local/bin/node";
const NODE_MEMORY: &str = "--max-old-space-size=96";
const ENTRY: &str = "/app/cli/bin/jht.js";

/// The longest line in either direction, ENCODED, in bytes; the deepest JSON.
const MAX_LINE: usize = 256 * 1024;
const MAX_DEPTH: usize = 8;
const HELLO_TIMEOUT: Duration = Duration::from_secs(5);
const RESOLVE_TIMEOUT: Duration = Duration::from_secs(20);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(12);
const PING_EVERY: Duration = Duration::from_secs(20);
const PING_TIMEOUT: Duration = Duration::from_secs(10);
/// Reads in flight at once from this side (the container allows 8).
const MAX_PENDING: usize = 6;
/// Several requests in a row that nobody answered: the stream is closed.
const MAX_TIMEOUTS: u32 = 3;
/// At most this many events a second reach the page, whatever the container sends.
const EVENTS_PER_SECOND: u32 = 8;
const RETRY_FIRST: Duration = Duration::from_millis(1500);
const RETRY_LAST: Duration = Duration::from_secs(60);
const PROTO: u64 = 1;

/// The errors the container has for a request it did not run; any other word is a violation.
const REQUEST_ERRORS: [&str; 6] = ["op_unknown", "args_invalid", "busy", "timeout", "too_big", "reader_failed"];

/// The agents of the chat, and so the topics of the stream: this side names them, the container only repeats.
const CHAT_TOPICS: [&str; 8] = [
    "chat:capitano", "chat:assistente", "chat:mentor", "chat:scout", "chat:analista", "chat:scorer", "chat:scrittore", "chat:critico",
];

fn watched_topics() -> Vec<&'static str> {
    let mut topics = vec!["agents", "profile", "settings", "positions"];
    topics.extend(CHAT_TOPICS);
    topics
}

// ── what the app asks ───────────────────────────────────────────────────────────────────────────────

/// A read of the hot path: a closed set, built here, never a string from the page.
pub(crate) enum StreamRead<'a> {
    ChatRead { agent: &'a str, cursor: Option<&'a str> },
    AgentsList,
    AgentsTeam,
    AgentsHistory,
    AgentsExclusions,
    TeamSettings,
    AgentsScreen { name: &'a str },
    ProfileProgress,
}

/// An agent session the panel can name; the container checks it again with the same grammar.
fn valid_session(name: &str) -> bool {
    let number = |digits: &str| (1..=4).contains(&digits.len()) && !digits.starts_with('0') && digits.bytes().all(|b| b.is_ascii_digit());
    if ["CAPITANO", "ASSISTENTE", "MENTOR", "SENTINELLA", "CRITICO", "DOTTORE", "MANTENITORE"].contains(&name) {
        return true;
    }
    if let Some(rest) = name.strip_prefix("CRITICO-S") {
        return number(rest);
    }
    ["SCOUT-", "ANALISTA-", "SCORER-", "SCRITTORE-", "CLOSER-"].iter().any(|prefix| name.strip_prefix(prefix).is_some_and(number))
}

impl StreamRead<'_> {
    fn op(&self) -> &'static str {
        match self {
            Self::ChatRead { .. } => "chat.read",
            Self::AgentsList => "agents.list",
            Self::AgentsTeam => "agents.team",
            Self::AgentsHistory => "agents.history",
            Self::AgentsExclusions => "agents.exclusions",
            Self::TeamSettings => "team.settings",
            Self::AgentsScreen { .. } => "agents.screen",
            Self::ProfileProgress => "profile.progress",
        }
    }

    /// The request as the line it becomes, or None when an argument is not in its closed list or alphabet.
    fn request(&self, id: u32) -> Option<String> {
        let mut request = Map::new();
        request.insert("id".into(), json!(id));
        request.insert("op".into(), json!(self.op()));
        match self {
            Self::ChatRead { agent, cursor } => {
                crate::existing_team_runtime::chat_arguments(&crate::existing_team_runtime::ChatOperation::Read { agent, cursor: *cursor }).ok()?;
                let mut args = Map::new();
                args.insert("agent".into(), json!(agent));
                if let Some(cursor) = cursor {
                    args.insert("cursor".into(), json!(cursor));
                }
                request.insert("args".into(), Value::Object(args));
            }
            Self::AgentsScreen { name } => {
                if !valid_session(name) {
                    return None;
                }
                request.insert("args".into(), json!({ "name": name }));
            }
            Self::AgentsList | Self::AgentsTeam | Self::AgentsHistory | Self::AgentsExclusions | Self::TeamSettings | Self::ProfileProgress => {}
        }
        serde_json::to_string(&Value::Object(request)).ok()
    }
}

// ── what the container may say ──────────────────────────────────────────────────────────────────────

#[derive(Debug, PartialEq)]
struct Hello {
    proto: u64,
    ops: Vec<String>,
    cid: Option<String>,
    profile_sha: Option<String>,
}

#[derive(Debug, PartialEq)]
enum Frame {
    Hello(Hello),
    /// `Ok(None)`: an acknowledgement (watch, invalidate, bye). `Ok(Some((exit, out)))`: a reader ran.
    Res(u32, Result<Option<(i32, Vec<u8>)>, String>),
    Pong(u32),
    Event(String),
}

/// Nesting of a line of JSON, counted before it is parsed (the same count the container makes).
fn depth_of(line: &str) -> usize {
    let (mut depth, mut max, mut in_string, mut escaped) = (0usize, 0usize, false, false);
    for byte in line.bytes() {
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
        } else if byte == b'"' {
            in_string = true;
        } else if byte == b'{' || byte == b'[' {
            depth += 1;
            max = max.max(depth);
        } else if byte == b'}' || byte == b']' {
            depth = depth.saturating_sub(1);
        }
    }
    max
}

fn only_keys(object: &Map<String, Value>, allowed: &[&str]) -> bool {
    object.keys().all(|key| allowed.contains(&key.as_str()))
}

fn request_id(value: Option<&Value>) -> Option<u32> {
    let id = value?.as_u64()?;
    (1..=i32::MAX as u64).contains(&id).then_some(id as u32)
}

fn lower_hex(value: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&value.len()) && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// One line from the container, or Err when it is not exactly one of the closed shapes.
fn parse_frame(line: &[u8]) -> Result<Frame, ()> {
    if line.len() > MAX_LINE {
        return Err(());
    }
    let text = std::str::from_utf8(line).map_err(|_| ())?;
    if depth_of(text) > MAX_DEPTH {
        return Err(());
    }
    let value: Value = serde_json::from_str(text).map_err(|_| ())?;
    let object = value.as_object().ok_or(())?;
    match object.get("t").and_then(Value::as_str).ok_or(())? {
        "hello" => {
            if !only_keys(object, &["t", "proto", "ops", "cid", "sha256"]) {
                return Err(());
            }
            let proto = object.get("proto").and_then(Value::as_u64).ok_or(())?;
            let ops = object.get("ops").and_then(Value::as_array).ok_or(())?;
            if ops.len() > 32 {
                return Err(());
            }
            let ops = ops
                .iter()
                .map(|op| op.as_str().filter(|op| op.len() <= 32).map(str::to_owned).ok_or(()))
                .collect::<Result<Vec<_>, _>>()?;
            let cid = match object.get("cid") {
                Some(Value::String(cid)) => Some(cid.clone()),
                Some(Value::Null) | None => None,
                _ => return Err(()),
            };
            let profile_sha = object
                .get("sha256")
                .and_then(Value::as_object)
                .and_then(|map| map.get("profile.progress"))
                .and_then(Value::as_str)
                .map(str::to_owned);
            Ok(Frame::Hello(Hello { proto, ops, cid, profile_sha }))
        }
        "res" => {
            if !only_keys(object, &["t", "id", "ok", "exit", "out", "age_ms", "cached", "err"]) {
                return Err(());
            }
            let id = request_id(object.get("id")).ok_or(())?;
            match object.get("ok").and_then(Value::as_bool).ok_or(())? {
                true => match (object.get("exit"), object.get("out")) {
                    (None, None) => Ok(Frame::Res(id, Ok(None))),
                    (Some(exit), Some(Value::String(out))) => {
                        let exit = i32::try_from(exit.as_i64().ok_or(())?).map_err(|_| ())?;
                        Ok(Frame::Res(id, Ok(Some((exit, out.clone().into_bytes())))))
                    }
                    _ => Err(()),
                },
                false => {
                    let err = object.get("err").and_then(Value::as_str).ok_or(())?;
                    if !REQUEST_ERRORS.contains(&err) {
                        return Err(());
                    }
                    Ok(Frame::Res(id, Err(err.to_owned())))
                }
            }
        }
        "pong" => {
            if !only_keys(object, &["t", "id"]) {
                return Err(());
            }
            Ok(Frame::Pong(request_id(object.get("id")).ok_or(())?))
        }
        "ev" => {
            if !only_keys(object, &["t", "topic", "rev"]) {
                return Err(());
            }
            let topic = object.get("topic").and_then(Value::as_str).ok_or(())?;
            (topic.len() <= 32).then(|| Frame::Event(topic.to_owned())).ok_or(())
        }
        _ => Err(()),
    }
}

/// The next line, at most MAX_LINE bytes long without its newline. Ok(None): the stream ended. Err: a line over the cap.
fn read_line_capped<R: BufRead>(reader: &mut R) -> Result<Option<Vec<u8>>, ()> {
    let mut line = Vec::new();
    let read = reader.by_ref().take(MAX_LINE as u64 + 2).read_until(b'\n', &mut line).map_err(|_| ())?;
    if read == 0 {
        return Ok(None);
    }
    if line.last() == Some(&b'\n') {
        line.pop();
        return if line.len() > MAX_LINE { Err(()) } else { Ok(Some(line)) };
    }
    // no newline: either over the cap, or the stream ended in the middle of a line (nothing to answer)
    if line.len() > MAX_LINE { Err(()) } else { Ok(None) }
}

// ── the open stream ─────────────────────────────────────────────────────────────────────────────────

/// What a read gets back from the reader thread.
enum Reply {
    Done(Option<(i32, Vec<u8>)>),
    Refused,
    Pong,
}

/// Why a read was not answered by the stream. `fatal`: the stream itself is not to be used any more.
#[derive(Debug, PartialEq)]
pub(crate) struct Unanswered {
    fatal: bool,
}

struct Writer {
    stdin: Option<ChildStdin>,
    next_id: u32,
}

/// What the page is told (never content).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct PageEvent {
    topic: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent: Option<&'static str>,
}

/// The names the page hears for a topic of the stream, from this side's table.
fn page_event(topic: &str) -> Option<PageEvent> {
    match topic {
        "agents" => Some(PageEvent { topic: "agents", agent: None }),
        "profile" => Some(PageEvent { topic: "profile", agent: None }),
        "settings" => Some(PageEvent { topic: "settings", agent: None }),
        "positions" => Some(PageEvent { topic: "positions", agent: None }),
        _ => {
            let index = CHAT_TOPICS.iter().position(|known| *known == topic)?;
            let agent = crate::existing_team_runtime::CHAT_AGENTS[index];
            Some(PageEvent { topic: "chat", agent: Some(agent) })
        }
    }
}

type Sink = Arc<dyn Fn(PageEvent) + Send + Sync>;

pub(crate) struct Session {
    scope: AccountScope,
    key: String,
    child: Mutex<Option<Child>>,
    writer: Mutex<Writer>,
    pending: Mutex<HashMap<u32, mpsc::Sender<Reply>>>,
    alive: AtomicBool,
    /// What the hello declared and this side accepts; empty until the hello is checked.
    ops: OnceLock<Vec<String>>,
    timeouts: Mutex<u32>,
}

impl Session {
    /// A session around a running exec: its pipes are taken (the child is killed if they are not there).
    fn new(scope: AccountScope, key: String, mut child: Child) -> Result<(Arc<Self>, ChildStdout), &'static str> {
        let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("process_pipe_failed");
        };
        let session = Arc::new(Self {
            scope,
            key,
            child: Mutex::new(Some(child)),
            writer: Mutex::new(Writer { stdin: Some(stdin), next_id: 1 }),
            pending: Mutex::new(HashMap::new()),
            alive: AtomicBool::new(true),
            ops: OnceLock::new(),
            timeouts: Mutex::new(0),
        });
        Ok((session, stdout))
    }

    fn usable(&self, op: &str) -> bool {
        self.alive.load(Ordering::SeqCst) && self.ops.get().is_some_and(|ops| ops.iter().any(|known| known == op))
    }

    /// Writes one request and registers who waits for it, in the order the ids grow. Err: not written.
    fn send(&self, make: impl FnOnce(u32) -> Option<String>) -> Result<mpsc::Receiver<Reply>, Unanswered> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err(Unanswered { fatal: true });
        }
        let mut writer = self.writer.lock().map_err(|_| Unanswered { fatal: true })?;
        let id = writer.next_id;
        let line = make(id).ok_or(Unanswered { fatal: false })?;
        if line.len() >= MAX_LINE {
            return Err(Unanswered { fatal: false });
        }
        let (sender, receiver) = mpsc::channel();
        {
            let mut pending = self.pending.lock().map_err(|_| Unanswered { fatal: true })?;
            if pending.len() >= MAX_PENDING {
                return Err(Unanswered { fatal: false });
            }
            pending.insert(id, sender);
        }
        let written = match writer.stdin.as_mut() {
            Some(stdin) => stdin.write_all(line.as_bytes()).and_then(|()| stdin.write_all(b"\n")).and_then(|()| stdin.flush()).is_ok(),
            None => false,
        };
        if !written {
            drop(writer);
            self.close();
            return Err(Unanswered { fatal: true });
        }
        writer.next_id = id + 1;
        Ok(receiver)
    }

    /// One read over the stream, as the exec would have answered it.
    pub(crate) fn read(&self, read: &StreamRead<'_>) -> Result<ProcessResult, Unanswered> {
        if !self.usable(read.op()) {
            return Err(Unanswered { fatal: !self.alive.load(Ordering::SeqCst) });
        }
        let receiver = self.send(|id| read.request(id))?;
        match receiver.recv_timeout(REQUEST_TIMEOUT) {
            Ok(Reply::Done(Some((code, stdout)))) => {
                *self.timeouts.lock().map_err(|_| Unanswered { fatal: true })? = 0;
                Ok(ProcessResult { code, stdout })
            }
            // an acknowledgement for a reader's request, or an error of the container's own: the old way answers
            Ok(Reply::Done(None)) | Ok(Reply::Pong) => {
                self.close();
                Err(Unanswered { fatal: true })
            }
            Ok(Reply::Refused) => Err(Unanswered { fatal: false }),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let mut strikes = self.timeouts.lock().map_err(|_| Unanswered { fatal: true })?;
                *strikes += 1;
                let fatal = *strikes >= MAX_TIMEOUTS;
                drop(strikes);
                if fatal {
                    self.close();
                }
                Err(Unanswered { fatal })
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(Unanswered { fatal: true }),
        }
    }

    /// Fire and forget: the answer, when it comes, is read and dropped by the reader thread.
    pub(crate) fn invalidate(&self) {
        let _ = self.send(|id| serde_json::to_string(&json!({ "id": id, "op": "invalidate" })).ok());
    }

    /// Is the stream alive? A ping that could not even be written because reads are waiting (not fatal) is skipped:
    /// those reads are the proof, and a busy stream is not a dead one.
    fn ping(&self) -> bool {
        match self.send(|id| serde_json::to_string(&json!({ "id": id, "op": "ping" })).ok()) {
            Ok(receiver) => matches!(receiver.recv_timeout(PING_TIMEOUT), Ok(Reply::Pong)),
            Err(unanswered) => !unanswered.fatal,
        }
    }

    /// Ends the stream: the exec is killed (the container's process ends on its own with its stdin), whoever waits is released.
    fn close(&self) {
        self.alive.store(false, Ordering::SeqCst);
        if let Ok(mut writer) = self.writer.lock() {
            writer.stdin = None;
        }
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut child) = child.take() {
                let _ = child.kill();
                thread::spawn(move || {
                    let _ = child.wait();
                });
            }
        }
        if let Ok(mut pending) = self.pending.lock() {
            pending.clear();
        }
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        self.close();
    }
}

/// The reader thread: every line the container writes, checked, until the stream ends. The first line is the hello and goes to `hello`.
fn reader_loop(session: &Arc<Session>, stdout: ChildStdout, hello: mpsc::Sender<Result<Hello, ()>>, sink: Sink, ended: impl FnOnce(&Arc<Session>)) {
    let mut reader = std::io::BufReader::new(stdout);
    let mut hello = Some(hello);
    let mut bucket = EventBucket::new(Instant::now());
    loop {
        let line = match read_line_capped(&mut reader) {
            Ok(Some(line)) => line,
            Ok(None) | Err(()) => break,
        };
        let Ok(frame) = parse_frame(&line) else { break };
        match (frame, hello.take()) {
            (Frame::Hello(frame), Some(waiting)) => {
                let _ = waiting.send(Ok(frame));
            }
            // a second hello, or anything before the first
            (Frame::Hello(_), None) => break,
            (_, Some(waiting)) => {
                let _ = waiting.send(Err(()));
                break;
            }
            (Frame::Res(id, body), None) => {
                let Some(sender) = session.pending.lock().ok().and_then(|mut pending| pending.remove(&id)) else { break };
                let _ = sender.send(match body {
                    Ok(done) => Reply::Done(done),
                    Err(_) => Reply::Refused,
                });
            }
            (Frame::Pong(id), None) => {
                let Some(sender) = session.pending.lock().ok().and_then(|mut pending| pending.remove(&id)) else { break };
                let _ = sender.send(Reply::Pong);
            }
            (Frame::Event(topic), None) => {
                if let Some(event) = page_event(&topic) {
                    if bucket.take(Instant::now()) {
                        sink(event);
                    }
                }
            }
        }
    }
    if let Some(waiting) = hello {
        let _ = waiting.send(Err(()));
    }
    session.close();
    ended(session);
}

/// A token bucket: a second's worth of events at most.
struct EventBucket {
    tokens: u32,
    since: Instant,
}

impl EventBucket {
    fn new(now: Instant) -> Self {
        Self { tokens: EVENTS_PER_SECOND, since: now }
    }

    fn take(&mut self, now: Instant) -> bool {
        if now.saturating_duration_since(self.since) >= Duration::from_secs(1) {
            self.tokens = EVENTS_PER_SECOND;
            self.since = now;
        }
        if self.tokens == 0 {
            return false;
        }
        self.tokens -= 1;
        true
    }
}

/// What the container's hello must say for the stream to be used; the profile read only with the script it declares.
fn hello_accepted(hello: &Hello, container: &str) -> Result<Vec<String>, &'static str> {
    if hello.proto < PROTO {
        return Err("state_stream_proto_unknown");
    }
    // the container's own id, seen from inside, must be the one attested (12 to 64 hex digits, a prefix of it)
    let cid = hello.cid.as_deref().ok_or("state_stream_cid_missing")?;
    if !lower_hex(cid, 12, 64) || !container.starts_with(cid) {
        return Err("state_stream_cid_mismatch");
    }
    let profile_ok = hello.profile_sha.as_deref() == Some(profile_script_sha().as_str());
    Ok(hello
        .ops
        .iter()
        .filter(|op| op.as_str() != "profile.progress" || profile_ok)
        .filter(|op| matches!(op.as_str(), "chat.read" | "agents.list" | "agents.team" | "agents.screen" | "profile.progress" | "watch" | "invalidate" | "ping" | "bye"))
        .cloned()
        .collect())
}

fn profile_script_sha() -> String {
    format!("{:x}", Sha256::digest(crate::profile_progress::PROFILE_PROGRESS_PY.as_bytes()))
}

// ── the state: one stream at most, opened in the background, closed with the account ───────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Status {
    Up,
    Fallback,
    Off,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct StatusReply {
    state: Status,
    since_ms: u64,
}

struct Inner {
    session: Option<Arc<Session>>,
    opening: bool,
    failures: u32,
    retry_at: Option<Instant>,
    status: Status,
    since: Instant,
}

pub(crate) struct StateStreamState {
    inner: Mutex<Inner>,
    /// Bumped when the account leaves: an opening that began before it never installs its stream.
    generation: AtomicU64,
}

impl Default for StateStreamState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner { session: None, opening: false, failures: 0, retry_at: None, status: Status::Fallback, since: Instant::now() }),
            generation: AtomicU64::new(0),
        }
    }
}

/// The window the page events go to: the app's own, like the other events of this kind.
const MAIN_WINDOW: &str = "main";
pub(crate) const STATUS_EVENT: &str = "state-stream://status";
pub(crate) const TOPIC_EVENT: &str = "state-stream://event";

/// Off on a switch of the person's (`JHT_STATE_STREAM=0`), and always off where the pipe of a long exec is not proven.
/// The switch only turns the stream off: it names no program and no image.
fn disabled() -> bool {
    cfg!(windows) || std::env::var_os("JHT_STATE_STREAM").is_some_and(|value| value == "0")
}

fn backoff(failures: u32) -> Duration {
    RETRY_FIRST.saturating_mul(1u32 << failures.min(6)).min(RETRY_LAST)
}

impl StateStreamState {
    fn set_status(&self, app: &tauri::AppHandle, next: Status) {
        let changed = match self.inner.lock() {
            Ok(mut inner) if inner.status != next => {
                inner.status = next;
                inner.since = Instant::now();
                true
            }
            _ => false,
        };
        if changed {
            let _ = app.emit_to(MAIN_WINDOW, STATUS_EVENT, StatusReply { state: next, since_ms: 0 });
        }
    }

    pub(crate) fn status(&self) -> StatusReply {
        match self.inner.lock() {
            Ok(inner) => StatusReply { state: inner.status, since_ms: inner.since.elapsed().as_millis() as u64 },
            Err(_) => StatusReply { state: Status::Off, since_ms: 0 },
        }
    }

    /// The open stream of this account's team on this runtime, if there is one.
    fn current(&self, scope: &AccountScope, key: &str) -> Option<Arc<Session>> {
        let inner = self.inner.lock().ok()?;
        inner.session.as_ref().filter(|session| session.alive.load(Ordering::SeqCst) && &session.scope == scope && session.key == key).cloned()
    }

    fn ended(&self, app: &tauri::AppHandle, session: &Arc<Session>) {
        let was_current = match self.inner.lock() {
            Ok(mut inner) => {
                let current = inner.session.as_ref().is_some_and(|open| Arc::ptr_eq(open, session));
                if current {
                    inner.session = None;
                    inner.failures += 1;
                    inner.retry_at = Some(Instant::now() + backoff(inner.failures));
                }
                current
            }
            Err(_) => false,
        };
        if was_current {
            self.set_status(app, Status::Fallback);
        }
    }

    /// The account leaves (or changes): the stream goes with it. Called where the other handles are closed.
    pub(crate) fn teardown(&self, app: &tauri::AppHandle) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        let session = match self.inner.lock() {
            Ok(mut inner) => {
                inner.failures = 0;
                inner.retry_at = None;
                inner.session.take()
            }
            Err(_) => None,
        };
        if let Some(session) = session {
            session.close();
        }
        self.set_status(app, Status::Off);
    }
}

pub(crate) fn teardown(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<StateStreamState>() {
        state.teardown(app);
    }
}

/// Everything the opening needs of the caller, who has already passed the gates of its own command (the main
/// window, the account's scope held, this computer as the destination).
pub(crate) struct LocalContext<'a> {
    pub(crate) app: &'a tauri::AppHandle,
    pub(crate) scope: &'a AccountScope,
    pub(crate) wrapper: &'a Path,
    pub(crate) runtime: &'a Path,
}

impl LocalContext<'_> {
    fn key(&self) -> String {
        format!("{}\n{}", self.wrapper.display(), self.runtime.display())
    }
}

/// The owner of this computer's team is this account (a file read), checked at every use of the stream.
fn owner_is_mine(app: &tauri::AppHandle, scope: &AccountScope) -> bool {
    crate::account_scope::local_owner_marker_path(app).is_ok_and(|marker| crate::account_scope::verify_local_runtime_owner(&marker, scope).is_ok())
}

/// A hot read of this computer's team over the stream. Some: the stream answered, with the stdout and exit code of
/// the reader. None: do it the old way, now. When there is no open stream this begins to open one, in the
/// background, and answers None for the calls until it is open.
pub(crate) fn read_local(context: &LocalContext<'_>, read: &StreamRead<'_>) -> Option<ProcessResult> {
    let state = context.app.try_state::<StateStreamState>()?;
    if disabled() {
        state.set_status(context.app, Status::Off);
        return None;
    }
    if !owner_is_mine(context.app, context.scope) {
        return None;
    }
    let key = context.key();
    if let Some(session) = state.current(context.scope, &key) {
        return match session.read(read) {
            Ok(done) => Some(done),
            Err(unanswered) => {
                if unanswered.fatal {
                    state.ended(context.app, &session);
                }
                None
            }
        };
    }
    begin_opening(context, &state);
    None
}

/// After something that changes the team went through the old way: what the stream kept is dropped now.
pub(crate) fn invalidate_local(context: &LocalContext<'_>) {
    if let Some(state) = context.app.try_state::<StateStreamState>() {
        if let Some(session) = state.current(context.scope, &context.key()) {
            session.invalidate();
        }
    }
}

fn begin_opening(context: &LocalContext<'_>, state: &State<'_, StateStreamState>) {
    let generation = state.generation.load(Ordering::SeqCst);
    {
        let Ok(mut inner) = state.inner.lock() else { return };
        if inner.opening || inner.session.is_some() || inner.retry_at.is_some_and(|at| Instant::now() < at) {
            return;
        }
        inner.opening = true;
    }
    let app = context.app.clone();
    let scope = context.scope.clone();
    let wrapper = context.wrapper.to_path_buf();
    let runtime = context.runtime.to_path_buf();
    thread::spawn(move || {
        let result = open_session(&app, &scope, &wrapper, &runtime, generation);
        let Some(state) = app.try_state::<StateStreamState>() else { return };
        let mut failed = false;
        if let Ok(mut inner) = state.inner.lock() {
            inner.opening = false;
            match result {
                Ok(()) => {
                    inner.failures = 0;
                    inner.retry_at = None;
                }
                Err(_) => {
                    inner.failures += 1;
                    inner.retry_at = Some(Instant::now() + backoff(inner.failures));
                    failed = true;
                }
            }
        }
        if failed {
            state.set_status(&app, Status::Fallback);
        }
    });
}

/// THE place that opens the stream. The gates, in this order:
///   the switch → the owner of the team is this account → the runtime bundle, the engine and the one running
///   container attested → the exec by id (never by the service's name) → the hello: protocol, and the container
///   id seen from inside is the attested one → the container attested AGAIN and still that one → the account's
///   scope still the active one, and no account left meanwhile → the topics watched.
fn open_session(app: &tauri::AppHandle, scope: &AccountScope, wrapper: &Path, runtime: &Path, generation: u64) -> Result<(), &'static str> {
    if disabled() {
        return Err("state_stream_off");
    }
    if !owner_is_mine(app, scope) {
        return Err("local_account_owner_unavailable");
    }
    let team = AttestedLocalTeam::resolve(wrapper, runtime, RESOLVE_TIMEOUT)?;
    let child = team.spawn_exec(&[NODE, NODE_MEMORY, ENTRY, "state-stream"])?;
    let key = format!("{}\n{}", wrapper.display(), runtime.display());
    let (session, stdout) = Session::new(scope.clone(), key, child)?;
    let (hello_sender, hello_receiver) = mpsc::channel();
    let events_app = app.clone();
    let sink: Sink = Arc::new(move |event| {
        let _ = events_app.emit_to(MAIN_WINDOW, TOPIC_EVENT, event);
    });
    let ended_app = app.clone();
    let reader_session = Arc::clone(&session);
    thread::spawn(move || {
        reader_loop(&reader_session, stdout, hello_sender, sink, |session| {
            if let Some(state) = ended_app.try_state::<StateStreamState>() {
                state.ended(&ended_app, session);
            }
        });
    });
    let hello = match hello_receiver.recv_timeout(HELLO_TIMEOUT) {
        Ok(Ok(hello)) => hello,
        _ => {
            session.close();
            return Err("state_stream_hello");
        }
    };
    let ops = match hello_accepted(&hello, team.container_id()) {
        Ok(ops) => ops,
        Err(code) => {
            session.close();
            return Err(code);
        }
    };
    if !team.is_still_the_container(runtime, RESOLVE_TIMEOUT) {
        session.close();
        return Err("container_unavailable");
    }
    let _ = session.ops.set(ops);
    let scopes: State<'_, AccountScopeState> = app.state();
    let _scope_held = scopes.lock_expected(scope).map_err(|_| "account_scope_changed")?;
    let state = app.try_state::<StateStreamState>().ok_or("state_failed")?;
    {
        let mut inner = state.inner.lock().map_err(|_| "state_failed")?;
        if state.generation.load(Ordering::SeqCst) != generation {
            drop(inner);
            session.close();
            return Err("account_scope_changed");
        }
        inner.session = Some(Arc::clone(&session));
    }
    state.set_status(app, Status::Up);
    let topics = json!({ "topics": watched_topics() });
    let _ = session.send(|id| serde_json::to_string(&json!({ "id": id, "op": "watch", "args": topics })).ok());
    let keepalive = Arc::clone(&session);
    thread::spawn(move || {
        while keepalive.alive.load(Ordering::SeqCst) {
            thread::sleep(PING_EVERY);
            if keepalive.alive.load(Ordering::SeqCst) && !keepalive.ping() {
                keepalive.close();
            }
        }
    });
    Ok(())
}

// ── what the page asks ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub(crate) struct StreamError {
    code: &'static str,
}

/// The state of the stream: `up` (the hot reads go over it), `fallback` (they are made the old way, and the stream
/// is being opened or reopened), `off` (no account, a switch, a VPS, or this computer cannot). Main window only.
#[tauri::command]
pub(crate) async fn state_stream_status(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    state: State<'_, StateStreamState>,
) -> Result<StatusReply, StreamError> {
    if window.label() != "main" {
        return Err(StreamError { code: "invalid_request" });
    }
    let off = StatusReply { state: Status::Off, since_ms: 0 };
    let Ok(scope) = scopes.active() else { return Ok(off) };
    if disabled() || matches!(crate::direct_chat::load_persisted_host(&app, &scope), Ok(crate::runtime_host::ExecutionHost::Vps { .. })) {
        return Ok(off);
    }
    Ok(state.status())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn line(value: &Value) -> Vec<u8> {
        serde_json::to_vec(value).unwrap()
    }

    // ── what the container may say: the closed shapes, and nothing else ─────────────────────────────

    #[test]
    fn the_shapes_the_container_has_are_read() {
        assert_eq!(
            parse_frame(&line(&json!({"t":"hello","proto":1,"ops":["chat.read","ping"],"cid":"3c33ab6a0d08","sha256":{"profile.progress":"ab"}}))),
            Ok(Frame::Hello(Hello { proto: 1, ops: vec!["chat.read".into(), "ping".into()], cid: Some("3c33ab6a0d08".into()), profile_sha: Some("ab".into()) }))
        );
        assert_eq!(
            parse_frame(&line(&json!({"t":"res","id":7,"ok":true,"exit":3,"out":"x\n","age_ms":4,"cached":true}))),
            Ok(Frame::Res(7, Ok(Some((3, b"x\n".to_vec())))))
        );
        assert_eq!(parse_frame(&line(&json!({"t":"res","id":8,"ok":true}))), Ok(Frame::Res(8, Ok(None))));
        assert_eq!(parse_frame(&line(&json!({"t":"res","id":9,"ok":false,"err":"busy"}))), Ok(Frame::Res(9, Err("busy".into()))));
        assert_eq!(parse_frame(&line(&json!({"t":"pong","id":2}))), Ok(Frame::Pong(2)));
        assert_eq!(parse_frame(&line(&json!({"t":"ev","topic":"chat:scout","rev":3}))), Ok(Frame::Event("chat:scout".into())));
    }

    #[test]
    fn anything_else_from_the_container_is_a_violation() {
        let nest = |n: usize| format!("{}{}", "[".repeat(n), "]".repeat(n));
        let hostile: Vec<Vec<u8>> = vec![
            b"".to_vec(),
            b"not json".to_vec(),
            b"[1]".to_vec(),
            b"7".to_vec(),
            b"null".to_vec(),
            line(&json!({"t":"nope"})),
            line(&json!({"id":1})),
            line(&json!({"t":"res","id":0,"ok":true})),
            line(&json!({"t":"res","id":-1,"ok":true})),
            line(&json!({"t":"res","id":2147483648u64,"ok":true})),
            line(&json!({"t":"res","id":1.5,"ok":true})),
            line(&json!({"t":"res","id":"1","ok":true})),
            line(&json!({"t":"res","id":1,"ok":"yes"})),
            line(&json!({"t":"res","id":1,"ok":true,"exit":0})),
            line(&json!({"t":"res","id":1,"ok":true,"out":"x"})),
            line(&json!({"t":"res","id":1,"ok":true,"exit":1.5,"out":"x"})),
            line(&json!({"t":"res","id":1,"ok":true,"exit":4294967296u64,"out":"x"})),
            line(&json!({"t":"res","id":1,"ok":true,"exit":0,"out":7})),
            line(&json!({"t":"res","id":1,"ok":true,"exit":0,"out":"x","path":"/etc/passwd"})),
            line(&json!({"t":"res","id":1,"ok":false})),
            line(&json!({"t":"res","id":1,"ok":false,"err":"my_own_word"})),
            line(&json!({"t":"res","id":1,"ok":false,"err":["busy"]})),
            line(&json!({"t":"pong","id":1,"extra":1})),
            line(&json!({"t":"ev","topic":"x".repeat(33),"rev":1})),
            line(&json!({"t":"ev","topic":"agents","rev":1,"data":"x"})),
            line(&json!({"t":"hello","proto":"1","ops":[],"cid":null})),
            line(&json!({"t":"hello","proto":1,"ops":"chat.read"})),
            line(&json!({"t":"hello","proto":1,"ops":[1]})),
            line(&json!({"t":"hello","proto":1,"ops":["x".repeat(33)]})),
            line(&json!({"t":"hello","proto":1,"ops":vec!["a"; 33]})),
            line(&json!({"t":"hello","proto":1,"ops":[],"cid":7})),
            line(&json!({"t":"hello","proto":1,"ops":[],"image":"x"})),
            vec![0xff, 0xfe],
            format!(r#"{{"t":"pong","id":1,"x":{}}}"#, nest(8)).into_bytes(),
            vec![b'a'; MAX_LINE + 1],
        ];
        for bad in hostile {
            assert_eq!(parse_frame(&bad), Err(()), "{}", String::from_utf8_lossy(&bad[..bad.len().min(120)]));
        }
        // the deepest nesting that is allowed counts the object itself
        assert_eq!(depth_of(r#"{"a":[[[[[[[1]]]]]]]}"#), 8);
        assert_eq!(depth_of(r#"{"a":"[[[[[[[[[[[[","b":"\"[[[["}"#), 1);
    }

    #[test]
    fn a_line_is_read_up_to_the_cap_and_no_further() {
        let mut stream = Cursor::new(b"one\ntwo\n".to_vec());
        assert_eq!(read_line_capped(&mut stream), Ok(Some(b"one".to_vec())));
        assert_eq!(read_line_capped(&mut stream), Ok(Some(b"two".to_vec())));
        assert_eq!(read_line_capped(&mut stream), Ok(None));
        let mut exact = vec![b'a'; MAX_LINE];
        exact.push(b'\n');
        assert_eq!(read_line_capped(&mut Cursor::new(exact)).map(|line| line.map(|l| l.len())), Ok(Some(MAX_LINE)));
        let mut over = vec![b'a'; MAX_LINE + 1];
        over.push(b'\n');
        assert_eq!(read_line_capped(&mut Cursor::new(over)), Err(()));
        // an endless line with no newline is cut at the cap, not read to the end
        assert_eq!(read_line_capped(&mut Cursor::new(vec![b'a'; MAX_LINE * 4])), Err(()));
        // the stream ended in the middle of a line: nothing to answer
        assert_eq!(read_line_capped(&mut Cursor::new(b"half a li".to_vec())), Ok(None));
    }

    // ── what the app asks: closed forms ─────────────────────────────────────────────────────────────

    #[test]
    fn a_request_is_built_from_the_closed_forms_and_a_wrong_argument_builds_nothing() {
        let value = |read: StreamRead<'_>| serde_json::from_str::<Value>(&read.request(5).unwrap()).unwrap();
        assert_eq!(value(StreamRead::ChatRead { agent: "capitano", cursor: Some("123") }), json!({"id":5,"op":"chat.read","args":{"agent":"capitano","cursor":"123"}}));
        assert_eq!(value(StreamRead::ChatRead { agent: "scout", cursor: None }), json!({"id":5,"op":"chat.read","args":{"agent":"scout"}}));
        assert_eq!(value(StreamRead::AgentsList), json!({"id":5,"op":"agents.list"}));
        assert_eq!(value(StreamRead::AgentsTeam), json!({"id":5,"op":"agents.team"}));
        assert_eq!(value(StreamRead::AgentsScreen { name: "SCOUT-12" }), json!({"id":5,"op":"agents.screen","args":{"name":"SCOUT-12"}}));
        assert_eq!(value(StreamRead::ProfileProgress), json!({"id":5,"op":"profile.progress"}));
        assert_eq!(value(StreamRead::AgentsHistory), json!({"id":5,"op":"agents.history"}));
        assert_eq!(value(StreamRead::AgentsExclusions), json!({"id":5,"op":"agents.exclusions"}));
        assert_eq!(value(StreamRead::TeamSettings), json!({"id":5,"op":"team.settings"}));
        for agent in ["-x", "--help", "a b", "capitano\n", "Capitano", "", "root", &"x".repeat(257)] {
            assert!(StreamRead::ChatRead { agent, cursor: None }.request(1).is_none(), "{agent:?}");
        }
        for cursor in ["-1", "--x", "1 2", "1\n", "", "1234567890123", "abc", "1e5"] {
            assert!(StreamRead::ChatRead { agent: "capitano", cursor: Some(cursor) }.request(1).is_none(), "{cursor:?}");
        }
        for name in ["-x", "--help", "scout-1", "SCOUT-0", "SCOUT-01", "SCOUT-", "SCOUT-12345", "SCOUT-1 ", "a\nb", "CAPITANO-1", "CRITICO-S", "", "../x"] {
            assert!(StreamRead::AgentsScreen { name }.request(1).is_none(), "{name:?}");
        }
        for name in ["CAPITANO", "ASSISTENTE", "MENTOR", "SENTINELLA", "CRITICO", "DOTTORE", "MANTENITORE", "ANALISTA-3", "SCORER-1", "SCRITTORE-9999", "CLOSER-2", "CRITICO-S4"] {
            assert!(StreamRead::AgentsScreen { name }.request(1).is_some(), "{name}");
        }
    }

    #[test]
    fn the_chat_agents_of_the_stream_are_the_apps_list_in_the_same_order() {
        for (topic, agent) in CHAT_TOPICS.iter().zip(crate::existing_team_runtime::CHAT_AGENTS) {
            assert_eq!(*topic, format!("chat:{agent}"));
        }
        assert_eq!(CHAT_TOPICS.len(), crate::existing_team_runtime::CHAT_AGENTS.len());
        assert_eq!(watched_topics().len(), 12);
    }

    // ── what reaches the page ───────────────────────────────────────────────────────────────────────

    #[test]
    fn the_page_hears_only_topics_from_this_sides_table_and_never_content() {
        assert_eq!(serde_json::to_value(page_event("agents").unwrap()).unwrap(), json!({"topic":"agents"}));
        assert_eq!(serde_json::to_value(page_event("profile").unwrap()).unwrap(), json!({"topic":"profile"}));
        assert_eq!(serde_json::to_value(page_event("settings").unwrap()).unwrap(), json!({"topic":"settings"}));
        assert_eq!(serde_json::to_value(page_event("positions").unwrap()).unwrap(), json!({"topic":"positions"}));
        assert_eq!(serde_json::to_value(page_event("chat:mentor").unwrap()).unwrap(), json!({"topic":"chat","agent":"mentor"}));
        for unknown in ["", "piles", "chat:", "chat:root", "chat:-x", "chat:MENTOR", "agents ", "profile\n", "../agents"] {
            assert!(page_event(unknown).is_none(), "{unknown:?}");
        }
    }

    #[test]
    fn at_most_eight_events_a_second_reach_the_page() {
        let start = Instant::now();
        let mut bucket = EventBucket::new(start);
        assert_eq!((0..20).filter(|_| bucket.take(start)).count(), 8);
        assert!(!bucket.take(start + Duration::from_millis(999)));
        assert!(bucket.take(start + Duration::from_millis(1000)));
    }

    #[test]
    fn the_wait_before_trying_again_grows_to_a_minute() {
        assert_eq!(backoff(0), Duration::from_millis(1500));
        assert_eq!(backoff(1), Duration::from_millis(3000));
        assert_eq!(backoff(3), Duration::from_secs(12));
        assert_eq!(backoff(6), Duration::from_secs(60));
        assert_eq!(backoff(40), Duration::from_secs(60));
    }

    // ── the hello: protocol, and the container this is ──────────────────────────────────────────────

    fn hello(proto: u64, cid: Option<&str>, profile_sha: Option<String>) -> Hello {
        Hello {
            proto,
            ops: ["chat.read", "agents.list", "profile.progress", "watch", "exec", "shell", "invalidate"].map(String::from).to_vec(),
            cid: cid.map(str::to_owned),
            profile_sha,
        }
    }

    #[test]
    fn the_container_must_say_it_is_the_one_that_was_attested() {
        let id = "3c33ab6a0d0891f06e3e4bdac9fef16c7fc5b7767a997bd774f6985e60de32f2";
        assert!(hello_accepted(&hello(1, Some("3c33ab6a0d08"), None), id).is_ok());
        assert!(hello_accepted(&hello(1, Some(id), None), id).is_ok());
        assert!(hello_accepted(&hello(2, Some("3c33ab6a0d08"), None), id).is_ok());
        // an older protocol, no id, another container, an id that is not lowercase hex or not long enough, longer than the attested one
        assert_eq!(hello_accepted(&hello(0, Some("3c33ab6a0d08"), None), id), Err("state_stream_proto_unknown"));
        assert_eq!(hello_accepted(&hello(1, None, None), id), Err("state_stream_cid_missing"));
        for cid in ["ffffffffffff", "3C33AB6A0D08", "3c33ab6a0d0", "3c33ab6a0d08 ", "", "3c33ab6a0d08-x", &format!("{id}0")] {
            assert_eq!(hello_accepted(&hello(1, Some(cid), None), id), Err("state_stream_cid_mismatch"), "{cid:?}");
        }
    }

    #[test]
    fn the_operations_are_those_declared_and_known_and_the_profile_one_only_with_the_script_this_app_has() {
        let id = "3c33ab6a0d0891f06e3e4bdac9fef16c7fc5b7767a997bd774f6985e60de32f2";
        let without = hello_accepted(&hello(1, Some("3c33ab6a0d08"), None), id).unwrap();
        assert_eq!(without, ["chat.read", "agents.list", "watch", "invalidate"]);
        let other = hello_accepted(&hello(1, Some("3c33ab6a0d08"), Some("00".repeat(32))), id).unwrap();
        assert!(!other.contains(&"profile.progress".to_owned()));
        let own = hello_accepted(&hello(1, Some("3c33ab6a0d08"), Some(profile_script_sha())), id).unwrap();
        assert!(own.contains(&"profile.progress".to_owned()));
        // an operation this side does not know is ignored, never used
        assert!(!own.contains(&"exec".to_owned()) && !own.contains(&"shell".to_owned()));
    }

    #[test]
    fn the_script_the_image_carries_is_the_one_this_app_has_byte_for_byte() {
        let file = include_str!("../../../shared/skills/profile_progress.py");
        assert_eq!(file, crate::profile_progress::PROFILE_PROGRESS_PY);
    }

    // ── a stream over a real pipe: a stand-in for the container ─────────────────────────────────────

    #[cfg(unix)]
    mod over_a_pipe {
        use super::*;
        use std::process::{Command, Stdio};

        /// A shell that says hello and answers each line: a ping with a pong, `agents.list` with a reader's output,
        /// anything else with an acknowledgement. `extra` runs right after the hello.
        fn peer(hello: &str, extra: &str) -> String {
            format!(
                r#"printf '%s\n' '{hello}'
{extra}
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
  case "$line" in
    *'"op":"ping"'*) printf '{{"t":"pong","id":%s}}\n' "$id";;
    *'"op":"agents.list"'*) printf '{{"t":"res","id":%s,"ok":true,"exit":0,"out":"{{\\"ok\\":true}}","age_ms":0,"cached":false}}\n' "$id";;
    *'"op":"agents.team"'*) printf '{{"t":"res","id":%s,"ok":true,"exit":101,"out":"{{\\"ok\\":false}}\\n","age_ms":0,"cached":false}}\n' "$id";;
    *'"op":"agents.screen"'*) printf '{{"t":"res","id":%s,"ok":false,"err":"args_invalid"}}\n' "$id";;
    *) printf '{{"t":"res","id":%s,"ok":true}}\n' "$id";;
  esac
done"#
            )
        }

        const HELLO: &str = r#"{"t":"hello","proto":1,"ops":["chat.read","agents.list","agents.team","agents.screen","watch","invalidate","ping"],"cid":"abcdef012345","sha256":{}}"#;

        struct Open {
            session: Arc<Session>,
            events: Arc<Mutex<Vec<PageEvent>>>,
            ended: Arc<AtomicBool>,
        }

        fn open(script: &str, declare: bool) -> Open {
            let child = Command::new("sh").arg("-c").arg(script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().unwrap();
            let (session, stdout) = Session::new(AccountScope::synthetic(b"state-stream-tests"), "w\nr".into(), child).unwrap();
            let events = Arc::new(Mutex::new(Vec::new()));
            let sink_events = Arc::clone(&events);
            let sink: Sink = Arc::new(move |event| sink_events.lock().unwrap().push(event));
            let ended = Arc::new(AtomicBool::new(false));
            let ended_flag = Arc::clone(&ended);
            let (sender, receiver) = mpsc::channel();
            let reader = Arc::clone(&session);
            thread::spawn(move || reader_loop(&reader, stdout, sender, sink, move |_| ended_flag.store(true, Ordering::SeqCst)));
            let got = receiver.recv_timeout(Duration::from_secs(5));
            assert!(matches!(got, Ok(Ok(_))), "the hello");
            if declare {
                let ops = ["chat.read", "agents.list", "agents.team", "agents.screen", "watch", "invalidate", "ping"].map(String::from).to_vec();
                session.ops.set(ops).unwrap();
            }
            Open { session, events, ended }
        }

        fn wait_for(what: &str, condition: impl Fn() -> bool) {
            for _ in 0..200 {
                if condition() {
                    return;
                }
                thread::sleep(Duration::from_millis(25));
            }
            panic!("{what}");
        }

        #[test]
        fn a_read_is_a_line_and_a_line_back_with_the_readers_exit_code() {
            let open = open(&peer(HELLO, ""), true);
            let done = open.session.read(&StreamRead::AgentsList).unwrap();
            assert_eq!((done.code, done.stdout.as_slice()), (0, &b"{\"ok\":true}"[..]));
            // a non-zero exit of the reader is an answer, with its output, as the exec would have given it
            let team = open.session.read(&StreamRead::AgentsTeam).unwrap();
            assert_eq!((team.code, team.stdout.as_slice()), (101, &b"{\"ok\":false}\n"[..]));
            assert!(open.session.ping());
            assert!(open.session.alive.load(Ordering::SeqCst));
        }

        #[test]
        fn a_refusal_of_the_container_is_not_an_answer_and_does_not_close_the_stream() {
            let open = open(&peer(HELLO, ""), true);
            let refused = open.session.read(&StreamRead::AgentsScreen { name: "CAPITANO" }).unwrap_err();
            assert_eq!(refused, Unanswered { fatal: false });
            assert!(open.session.alive.load(Ordering::SeqCst));
            assert!(open.session.read(&StreamRead::AgentsList).is_ok());
        }

        #[test]
        fn an_operation_the_hello_did_not_declare_is_never_written() {
            let open = open(&peer(HELLO, ""), true);
            // the hello above has no profile.progress: nothing is sent, and the stream stays up
            assert_eq!(open.session.read(&StreamRead::ProfileProgress).unwrap_err(), Unanswered { fatal: false });
            assert!(open.session.alive.load(Ordering::SeqCst));
        }

        #[test]
        fn an_answer_nobody_asked_for_closes_the_stream() {
            let script = peer(HELLO, "sleep 0.2; printf '%s\\n' '{\"t\":\"res\",\"id\":99,\"ok\":true,\"exit\":0,\"out\":\"x\"}'");
            let open = open(&script, true);
            wait_for("closed", || !open.session.alive.load(Ordering::SeqCst));
            wait_for("told", || open.ended.load(Ordering::SeqCst));
            assert_eq!(open.session.read(&StreamRead::AgentsList).unwrap_err(), Unanswered { fatal: true });
        }

        #[test]
        fn a_second_hello_a_word_off_the_list_and_a_line_over_the_cap_each_close_the_stream() {
            let cases = [
                format!("sleep 0.2; printf '%s\\n' '{HELLO}'"),
                "sleep 0.2; printf '%s\\n' '{\"t\":\"res\",\"id\":1,\"ok\":false,\"err\":\"disk_full\"}'".to_owned(),
                format!("sleep 0.2; head -c {} /dev/zero | tr '\\0' a; printf '\\n'", MAX_LINE + 10),
                format!("sleep 0.2; head -c {} /dev/zero | tr '\\0' a", MAX_LINE * 3),
                "sleep 0.2; printf '%s\\n' 'not json at all'".to_owned(),
                "sleep 0.2; printf '%s\\n' '{\"t\":\"pong\",\"id\":1,\"extra\":true}'".to_owned(),
            ];
            for extra in cases {
                let open = open(&peer(HELLO, &extra), true);
                wait_for(&extra[..extra.len().min(60)], || !open.session.alive.load(Ordering::SeqCst));
            }
        }

        #[test]
        fn events_reach_the_page_only_for_known_topics_and_at_a_limited_rate() {
            let burst: String = (0..40).map(|i| format!("printf '%s\\n' '{{\"t\":\"ev\",\"topic\":\"chat:scout\",\"rev\":{i}}}'; ")).collect();
            let script = peer(HELLO, &format!("sleep 0.2; printf '%s\\n' '{{\"t\":\"ev\",\"topic\":\"piles\",\"rev\":1}}'; printf '%s\\n' '{{\"t\":\"ev\",\"topic\":\"agents\",\"rev\":1}}'; {burst}"));
            let open = open(&script, true);
            wait_for("events", || open.events.lock().unwrap().len() >= 8);
            thread::sleep(Duration::from_millis(300));
            let events = open.events.lock().unwrap().clone();
            // "piles" is not a topic of this side: dropped. The rest are named from this side's table, 8 at most in the second
            assert_eq!(events[0], PageEvent { topic: "agents", agent: None });
            assert!(events.len() <= 8, "{}", events.len());
            assert!(events[1..].iter().all(|event| *event == PageEvent { topic: "chat", agent: Some("scout") }));
            assert!(open.session.alive.load(Ordering::SeqCst), "an event the page does not hear is not a violation");
        }

        #[test]
        fn the_end_of_the_stream_releases_whoever_waits_and_the_next_read_is_fatal() {
            let open = open(&peer(HELLO, ""), true);
            open.session.close();
            assert_eq!(open.session.read(&StreamRead::AgentsList).unwrap_err(), Unanswered { fatal: true });
            wait_for("told", || open.ended.load(Ordering::SeqCst));
        }

        #[test]
        fn a_ping_that_finds_the_stream_full_is_skipped_and_a_dead_stream_fails_it() {
            let silent = format!("printf '%s\\n' '{HELLO}'; cat >/dev/null");
            let open = open(&silent, true);
            let _waiting: Vec<_> = (0..MAX_PENDING).map(|_| open.session.send(|id| StreamRead::AgentsList.request(id)).unwrap()).collect();
            assert!(open.session.ping(), "six reads wait: the stream is busy, not dead");
            open.session.close();
            assert!(!open.session.ping());
        }

        #[test]
        fn closing_kills_the_exec_and_no_more_than_six_reads_wait_at_once() {
            // a peer that never answers: the sixth ask is written, the seventh is not
            let silent = format!("printf '%s\\n' '{HELLO}'; cat >/dev/null");
            let open = open(&silent, true);
            let waiting: Vec<_> = (0..MAX_PENDING).map(|_| open.session.send(|id| StreamRead::AgentsList.request(id)).unwrap()).collect();
            assert_eq!(waiting.len(), MAX_PENDING);
            assert_eq!(open.session.send(|id| StreamRead::AgentsList.request(id)).err(), Some(Unanswered { fatal: false }));
            open.session.close();
            assert!(open.session.child.lock().unwrap().is_none());
        }
    }

    /// By hand, against a running container of the runtime image that carries `jht state-stream`:
    /// `JHT_PROBE_CONTAINER=<name> cargo test --lib live_container -- --ignored --nocapture`.
    #[cfg(unix)]
    #[test]
    #[ignore]
    fn live_container_answers_the_hot_reads_over_one_exec() {
        use std::process::{Command, Stdio};
        let container = std::env::var("JHT_PROBE_CONTAINER").expect("JHT_PROBE_CONTAINER");
        let engine = std::env::var("JHT_PROBE_ENGINE").unwrap_or_else(|_| "podman".into());
        let started = Instant::now();
        let child = Command::new(engine)
            .args(["exec", "-i", &container, NODE, NODE_MEMORY, ENTRY, "state-stream"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let (session, stdout) = Session::new(AccountScope::synthetic(b"live-probe"), "w\nr".into(), child).unwrap();
        let (sender, receiver) = mpsc::channel();
        let sink: Sink = Arc::new(|_| {});
        let reader = Arc::clone(&session);
        thread::spawn(move || reader_loop(&reader, stdout, sender, sink, |_| {}));
        let hello = receiver.recv_timeout(HELLO_TIMEOUT).unwrap().unwrap();
        println!("hello after {} ms: proto {} cid {:?} ops {:?}", started.elapsed().as_millis(), hello.proto, hello.cid, hello.ops);
        let ops = hello_accepted(&hello, &format!("{}{}", hello.cid.clone().unwrap(), "0".repeat(64 - hello.cid.as_ref().unwrap().len()))).unwrap();
        println!("accepted: {ops:?}");
        session.ops.set(ops).unwrap();
        for read in [StreamRead::AgentsList, StreamRead::AgentsTeam, StreamRead::ChatRead { agent: "capitano", cursor: None }, StreamRead::AgentsScreen { name: "CAPITANO" }, StreamRead::ProfileProgress] {
            for round in 0..2 {
                let at = Instant::now();
                let done = session.read(&read).expect("answered");
                println!("{} #{round}: {} ms, exit {}, {}", read.op(), at.elapsed().as_millis(), done.code, String::from_utf8_lossy(&done.stdout).trim().chars().take(80).collect::<String>());
            }
        }
        assert!(session.ping());
        session.close();
    }

    // ── tests of the source: what the stream can and cannot do ─────────────────────────────────────

    /// The code of the module without its comments and its tests.
    fn production() -> String {
        let source = include_str!("state_stream.rs");
        let code = source.split("\n#[cfg(test)]\nmod tests {").next().unwrap();
        code.lines().filter(|line| !line.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn the_stream_is_opened_from_one_function_with_the_gates_in_order() {
        let code = production();
        let code = code.as_str();
        assert_eq!(code.matches("AttestedLocalTeam::resolve(").count(), 1);
        assert_eq!(code.matches(".spawn_exec(").count(), 1);
        assert_eq!(code.matches("open_session(").count(), 2, "its definition and its one call");
        let open = code.split("fn open_session(").nth(1).unwrap().split("\n}\n").next().unwrap();
        let order = [
            "disabled()",
            "owner_is_mine(",
            "AttestedLocalTeam::resolve(",
            ".spawn_exec(",
            "hello_receiver.recv_timeout(",
            "hello_accepted(",
            "is_still_the_container(",
            "lock_expected(",
            "generation.load(",
            "\"op\": \"watch\"",
        ];
        let at: Vec<usize> = order.iter().map(|gate| open.find(gate).unwrap_or_else(|| panic!("{gate}"))).collect();
        assert!(at.windows(2).all(|pair| pair[0] < pair[1]), "{at:?}");
        // by id, by absolute program, never by the service's name or through a shell
        assert!(code.contains("const NODE: &str = \"/usr/local/bin/node\""));
        for forbidden in ["\"sh\"", "\"bash\"", "compose", "run_verified_local_wrapper", "Command::new"] {
            assert!(!code.contains(forbidden), "{forbidden}");
        }
    }

    #[test]
    fn nothing_that_changes_something_goes_over_the_stream() {
        let code = production();
        let code = code.as_str();
        // the reads of the closed set, and nothing else, have an operation
        let ops = code.split("fn op(&self)").nth(1).unwrap().split("\n    }\n").next().unwrap();
        assert_eq!(ops.matches('"').count() / 2, 8);
        for forbidden in ["app_exit", "ChatOperation::Send", "ChatOperation::Answer", "ChatOperation::Enter", "\"start\"", "\"stop\"", "\"restart\"", "\"pause\"", "\"resume\"", "\"send\"", "\"answer\"", "write_access", "team_start"] {
            assert!(!code.contains(forbidden), "{forbidden}");
        }
        // the callers: the chat's Read only, the panel's three reads only, the profile read only
        let chat = include_str!("direct_chat.rs");
        let chat_arm = chat.split("// The hot read goes over the state stream").nth(1).unwrap().split("let writes =").next().unwrap();
        assert!(chat_arm.contains("ChatOperation::Read { agent, cursor }") && chat_arm.matches("read_local(").count() == 1);
        let control = include_str!("agent_control.rs");
        let hot = control.split("let hot = match request {").nth(1).unwrap().split("};").next().unwrap();
        assert_eq!(hot.matches("Some(crate::state_stream::StreamRead::").count(), 5);
        assert!(hot.contains("List {}") && hot.contains("Team {}") && hot.contains("Screen { session }") && hot.contains("History {}") && hot.contains("Exclusions {}"));
        // the settings: only the read goes over the stream, and a change made the old way drops what it kept
        let settings = include_str!("team_settings.rs");
        let local = settings.split("Destination::Local { wrapper, runtime } => {").nth(1).unwrap().split("\n        }\n").next().unwrap();
        assert_eq!(local.matches("read_local(").count(), 1);
        assert!(local.contains("matches!(request, Request::Read {})") && local.contains("StreamRead::TeamSettings") && local.contains("invalidate_local(stream)"));
        // a change made the old way tells the stream to drop what it kept
        assert!(chat.contains("crate::state_stream::invalidate_local(stream)") && control.contains("crate::state_stream::invalidate_local(stream)"));
    }

    #[test]
    fn the_switch_only_turns_the_stream_off_and_names_no_program() {
        let code = production();
        let code = code.as_str();
        let disabled = code.split("fn disabled() -> bool {").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(disabled.contains("\"JHT_STATE_STREAM\"") && disabled.contains("== \"0\"") && disabled.contains("cfg!(windows)"));
        assert_eq!(code.matches("JHT_STATE_STREAM").count(), 1, "the switch");
        assert!(!disabled.contains("PathBuf") && !disabled.contains("image") && !disabled.contains("NODE"));
    }

    #[test]
    fn the_stream_goes_with_the_account_before_its_write_access_is_forgotten() {
        let production = include_str!("account_scope.rs");
        for function in ["pub(crate) fn runtime_account_scope_reset(", "fn activate_scope_from("] {
            let body = production.split(function).nth(1).unwrap().split("\n}\n").next().unwrap();
            let at = |needle: &str| body.find(needle).unwrap_or_else(|| panic!("{needle}"));
            assert!(at("active.take()") < at("direct_chat::teardown"), "{function}");
            assert!(at("direct_chat::teardown") < at("state_stream::teardown("), "{function}");
            assert!(at("state_stream::teardown(") < at("forget_write_access_of("), "{function}");
        }
    }

    #[test]
    fn the_events_go_to_the_main_window_only() {
        let code = production();
        assert_eq!(code.matches("emit_to(MAIN_WINDOW,").count(), 2);
        assert!(!code.contains(".emit(") && code.contains("const MAIN_WINDOW: &str = \"main\";"));
    }

    #[test]
    fn the_page_commands_are_for_the_main_window_and_a_vps_is_off() {
        let code = production();
        let code = code.as_str();
        let status = code.split("pub(crate) async fn state_stream_status(").nth(1).unwrap();
        assert!(status.contains("window.label() != \"main\"") && status.contains("ExecutionHost::Vps"));
        let lib = include_str!("lib.rs");
        assert!(lib.contains("state_stream::state_stream_status,") && lib.contains("state_stream::StateStreamState::default()"));
    }
}

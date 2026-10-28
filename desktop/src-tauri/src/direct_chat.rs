use crate::account_scope::{AccountScope, AccountScopeState};
use crate::existing_team_runtime::{self, ActivatedTarget, ChatOperation};
use crate::runtime_host::{
    run_program, run_program_keeping_stderr_with_environment, run_program_without_env, run_ssh, run_ssh_command, run_ssh_command_without_pipes,
    set_private_dir_permissions, set_private_permissions, ssh_base_args, validate_host,
    ExecutionHost, ProcessResult, ValidatedHost,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(all(unix, not(target_os = "macos")))]
use sha2::{Digest, Sha256};
#[cfg(all(unix, not(target_os = "macos")))]
use std::collections::BTreeMap;
use std::{
    ffi::OsString,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, Manager, State};
use zeroize::{Zeroize, Zeroizing};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const READ_TIMEOUT: Duration = Duration::from_secs(20);
const SEND_TIMEOUT: Duration = Duration::from_secs(105);
/// The most bytes of the user's text that go on the chat command's standard input (the script
/// refuses more again, after cleaning it).
const MAX_CHAT_STDIN_BYTES: usize = 16 * 1024;
const REMOTE_CONTAINER_PROBE: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat probe"#;
pub(crate) const REMOTE_PYTHON_STDIN: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat python"#;

const CHAT_READ_PY: &str = r#"import hashlib,json,os,sys
req=json.loads(sys.stdin.readline())
agent=str(req.get('agent') or '')
allowed={'capitano','assistente','mentor','scout','analista','scorer','scrittore','critico'}
if agent not in allowed: raise SystemExit(2)
path=f'/jht_home/agents/{agent}/chat.jsonl'
if not os.path.isfile(path):
 print(json.dumps({'messages':[],'cursor':'0'})); raise SystemExit(0)
size=os.path.getsize(path); raw_cursor=req.get('cursor')
try: cursor=max(0,min(size,int(raw_cursor))) if raw_cursor not in (None,'') else max(0,size-131072)
except Exception: raise SystemExit(2)
messages=[]
with open(path,'rb') as f:
 f.seek(cursor)
 if cursor: f.readline()
 while len(messages)<120:
  start=f.tell(); raw=f.readline()
  if not raw: break
  if len(raw)>65536: continue
  try: row=json.loads(raw.decode('utf-8'))
  except Exception: continue
  text=str(row.get('text') or '').strip()
  if not text: continue
  role=str(row.get('role') or '').lower()
  role='user' if role=='user' else ('agent' if role in ('assistant','agent') else 'system')
  try: at=float(row.get('ts') or 0)
  except Exception: at=0
  mid=str(row.get('message_id') or hashlib.sha256((agent+':'+str(start)+':').encode()+raw).hexdigest())
  messages.append({'id':mid,'role':role,'text':text,'at':at})
 cursor=f.tell()
print(json.dumps({'messages':messages,'cursor':str(cursor)},ensure_ascii=False))"#;

const CHAT_PERSIST_PY: &str = r#"import hashlib,json,os,sys,time
req=json.loads(sys.stdin.readline()); agent=str(req.get('agent') or '')
allowed={'capitano','assistente','mentor','scout','analista','scorer','scrittore','critico'}
if agent not in allowed: raise SystemExit(2)
cid=str(req.get('clientMessageId') or ''); text=str(req.get('text') or '').strip(); mode=str(req.get('mode') or '')
if not cid or len(cid)>128 or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in cid): raise SystemExit(2)
path=f'/jht_home/agents/{agent}/chat.jsonl'
def existing():
 if not os.path.isfile(path): return None
 size=os.path.getsize(path)
 with open(path,'rb') as f:
  f.seek(max(0,size-1048576))
  if f.tell(): f.readline()
  for raw in f:
   try: row=json.loads(raw.decode('utf-8'))
   except Exception: continue
   if row.get('client_message_id')==cid: return row
found=existing()
if found:
 print(json.dumps({'exists':True,'clientMessageId':cid,'accepted':True,'messageId':found.get('message_id'),'at':found.get('ts')})); raise SystemExit(0)
if mode=='check': print(json.dumps({'exists':False})); raise SystemExit(0)
if mode!='append' or not text or len(text)>4000: raise SystemExit(2)
os.makedirs(os.path.dirname(path),exist_ok=True); at=time.time(); mid=hashlib.sha256((cid+':'+str(at)).encode()).hexdigest()
row={'role':'user','text':text,'ts':at,'done':True,'client_message_id':cid,'message_id':mid}
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
try:
 os.write(fd,(json.dumps(row,ensure_ascii=False,separators=(',',':'))+'\n').encode()); os.fsync(fd)
finally: os.close(fd)
found=existing()
if not found or found.get('message_id')!=mid: raise SystemExit(3)
print(json.dumps({'exists':False,'clientMessageId':cid,'accepted':True,'messageId':mid,'at':at}))"#;

/// The team's language, read and written at the one place every reader of it looks first
/// (`/jht_home/i18n-prefs.json`, the artefact of docs/internal/2026-08-12-language-source-contract.md),
/// with the same atomic replace as the game's `language_save.py`. `read` tells the language the team
/// speaks now (the file, then `$JHT_LANG`, then `host.env`, then English) and what the file itself says.
/// `set` writes only while that language is the English everything starts with: a language already
/// chosen is never replaced, and the reply says so (`changed: false`) instead of failing.
const TEAM_LANGUAGE_PY: &str = r#"import json,os,sys,tempfile
valid=('en','it','hu','es','de','fr','pt')
req=json.loads(sys.stdin.readline()); op=req.get('op')
home='/jht_home'; path=home+'/i18n-prefs.json'
def stored():
 try:
  with open(path,encoding='utf-8') as f: value=json.load(f).get('locale')
 except Exception: return None
 return value if value in valid else None
def bootstrap():
 value=(os.environ.get('JHT_LANG') or '').strip()
 if value in valid: return value
 try:
  with open(home+'/host.env',encoding='utf-8') as f:
   for line in f:
    key,_,value=line.strip().partition('=')
    value=value.strip().strip('"').strip("'")
    if key.strip()=='JHT_LANG' and value in valid: return value
 except Exception: pass
 return None
current=stored() or bootstrap() or 'en'
if op=='read': print(json.dumps({'locale':current,'stored':stored()})); raise SystemExit(0)
locale=req.get('locale')
if op!='set' or locale not in valid: raise SystemExit(2)
if current!='en': print(json.dumps({'locale':current,'stored':stored(),'changed':False})); raise SystemExit(0)
fd,temporary=tempfile.mkstemp(prefix='.i18n-prefs.',dir=home)
try:
 with os.fdopen(fd,'w',encoding='utf-8') as out:
  json.dump({'locale':locale},out,indent=2,ensure_ascii=False); out.write('\n'); out.flush(); os.fsync(out.fileno())
 os.chmod(temporary,0o644); os.replace(temporary,path)
except Exception:
 try: os.unlink(temporary)
 except OSError: pass
 raise
print(json.dumps({'locale':locale,'stored':locale,'changed':True}))"#;

#[derive(Default)]
pub(crate) struct DirectChatState {
    inner: Arc<DirectChatInner>,
}

#[derive(Default)]
struct DirectChatInner {
    connection: Mutex<Option<Connection>>,
    subscribers: Mutex<Vec<Channel<DirectChatEvent>>>,
    send_lock: Mutex<()>,
    /// An attachment is being chosen, copied or told: a second one waits for the person to finish.
    /// Its own `Arc`: the guard that holds it must not carry the whole state (and the connection's drop glue) with it.
    attach_busy: Arc<std::sync::atomic::AtomicBool>,
}

struct Connection {
    app: Option<tauri::AppHandle>,
    scope: AccountScope,
    host: ExecutionHost,
    validated: ValidatedHost,
    runtime: Option<ActivatedTarget>,
    local_wrapper: Option<PathBuf>,
    local_runtime: Option<PathBuf>,
    local_owner_marker: Option<PathBuf>,
    control_path: Option<PathBuf>,
    tunnel: Option<Child>,
    link: VpsLink,
}

/// How the app talks to a VPS. `Master`: one ssh master (ControlMaster) that every command reuses.
/// `PerCommand`: Windows' ssh (Win32-OpenSSH) has no ControlMaster (PowerShell/Win32-OpenSSH#405,
/// T69), so every command is its own connection, and ssh gets no pipe (its 9.5p1 hangs on one).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum VpsLink {
    Master,
    PerCommand,
}

fn vps_link_for(os: &str) -> VpsLink {
    if os == "windows" {
        VpsLink::PerCommand
    } else {
        VpsLink::Master
    }
}

enum RemoteOperation<'a> { Probe, Python, Delivery(&'a str), Chat(ChatOperation<'a>) }

impl Drop for Connection {
    fn drop(&mut self) {
        close_connection(self);
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub(crate) struct DirectChatStatus {
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
    /// `per-command` when every read costs a new ssh connection (Windows to a VPS): the page reads
    /// less often then.
    #[serde(skip_serializing_if = "Option::is_none")]
    link: Option<&'static str>,
}

/// The codes a system line of the chat may carry. The page has a sentence for each, in every language.
const CHAT_SYSTEM_CODES: [&str; 2] = ["mail_not_taken", "message_too_long"];

fn closed_code<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Anything that is not one of the closed codes (a number, a name every object has) is no code.
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(match raw {
        Some(Value::String(code)) if CHAT_SYSTEM_CODES.contains(&code.as_str()) => Some(code),
        _ => None,
    })
}

/// The kinds an agent may give a message. `question` belongs to the questions only.
const MESSAGE_KINDS: [&str; 4] = ["urgent", "blocked", "completed", "info"];
/// The kinds of a question: the kinds of a message, and `question`.
const QUESTION_KINDS: [&str; 5] = ["urgent", "blocked", "question", "completed", "info"];
const QUESTION_STATES: [&str; 3] = ["open", "answered", "expired"];
/// Who gave an answer: the person, the question's safe option when nobody answered in time, or the system
/// closing a question that has no object any more (the plan was declared another way).
/// Any other origin the team writes is `unknown`, and never said as the person's.
const ANSWER_ORIGINS: [&str; 3] = ["user", "expiry", "system"];
const MAX_SUBJECT_CHARS: usize = 200;
const MAX_QUESTION_CHARS: usize = 4000;
const MAX_LABEL_CHARS: usize = 200;
const MAX_ANSWER_CHARS: usize = 2000;
const MAX_OPTIONS: usize = 8;
const MAX_QUESTIONS: usize = 50;

fn string_in<'a>(value: Option<&'a Value>, list: &[&str]) -> Option<&'a str> {
    value.and_then(Value::as_str).filter(|v| list.contains(v))
}

/// A closed code of the team's: lower-case letters, digits, `_` and `-`, at most 64. The page says
/// only the codes its catalog has; this keeps anything else (a sentence, markup) from reaching it.
fn closed_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'-'))
}

/// The id of an option: the same alphabet as a closed code, at most 32.
fn option_id(value: &str) -> bool {
    closed_token(value) && value.len() <= 32
}

/// A time in seconds since the epoch, as the chat's read gives every time.
fn seconds(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|v| v.is_finite() && *v >= 0.0)
}

fn short_text(value: Option<&Value>, max: usize) -> Option<String> {
    value.and_then(Value::as_str).filter(|v| v.chars().count() <= max).map(str::to_owned)
}

fn message_kind<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Outside the list (an older image, a typo, `question`) the row has no kind: the page shows it as info.
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(string_in(raw.as_ref(), &MESSAGE_KINDS).map(str::to_owned))
}

const MAX_SUGGESTIONS: usize = 5;
const MAX_SUGGESTION_CHARS: usize = 240;

fn suggestions<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // The replies an agent suggests to its message: one line each, at most 5, and a list only from two
    // up (one is no choice). Anything out of that shape is left out.
    let raw = Option::<Value>::deserialize(deserializer)?;
    let Some(Value::Array(items)) = raw else { return Ok(None) };
    let labels: Vec<String> = items
        .iter()
        .take(MAX_SUGGESTIONS)
        .filter_map(Value::as_str)
        .filter(|l| !l.trim().is_empty() && l.chars().count() <= MAX_SUGGESTION_CHARS && !l.contains(['\n', '\r']))
        .map(str::to_owned)
        .collect();
    Ok((labels.len() >= 2).then_some(labels))
}

fn taken_flag<'de, D>(deserializer: D) -> Result<Option<Option<bool>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Present: true, false, or null for «not known». Anything else is «not known» too, never «taken».
    let raw = Value::deserialize(deserializer)?;
    Ok(Some(raw.as_bool()))
}

/// Why the team does not know whether the agent's CLI took a text: what it saw in the terminal.
/// `unconfirmed`: the text went, and nothing on the screen proved it was taken.
const TAKEN_REASONS: [&str; 8] = ["menu", "permission", "login", "busy", "not_ours", "empty_unseen", "unreadable", "unconfirmed"];

fn closed_reason<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(string_in(raw.as_ref(), &TAKEN_REASONS).map(str::to_owned))
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatMessage {
    id: String,
    role: String,
    text: String,
    at: f64,
    /// A closed code on a system line (`mail_not_taken`): the page says it in the person's language.
    /// Only a code of the closed list passes; anything else is dropped here, whatever the host wrote.
    #[serde(default, deserialize_with = "closed_code", skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    /// The kind the agent gave the message, on the agent's rows only; outside the list, none.
    #[serde(default, deserialize_with = "message_kind", skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    /// The replies the agent suggests, on its rows only: the page offers them as buttons.
    #[serde(default, deserialize_with = "suggestions", skip_serializing_if = "Option::is_none")]
    suggestions: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct DirectChatOption {
    id: String,
    label: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatAnswer {
    choices: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    at: f64,
    origin: &'static str,
    /// When the agent's tool took the answer; null until then.
    seen_at: Option<f64>,
}

/// One of the agent's questions, as the page shows it. Built field by field from what the host
/// wrote: a question with one field out of its shape is left out whole, never half shown.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatQuestion {
    id: String,
    at: f64,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    subject: Option<String>,
    text: String,
    options: Vec<DirectChatOption>,
    multiple: bool,
    free: bool,
    expires_at: Option<f64>,
    state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    answer: Option<DirectChatAnswer>,
}

fn closed_static(value: Option<&Value>, list: &[&'static str]) -> Option<&'static str> {
    let value = value.and_then(Value::as_str)?;
    list.iter().copied().find(|item| *item == value)
}

impl DirectChatQuestion {
    fn from_value(value: &Value) -> Option<Self> {
        let id = value.get("id").and_then(Value::as_str).filter(|v| existing_team_runtime::chat_question_id(v))?;
        let options = value.get("options").and_then(Value::as_array)?;
        if options.len() > MAX_OPTIONS {
            return None;
        }
        let mut seen = Vec::with_capacity(options.len());
        for option in options {
            let option_key = option.get("id").and_then(Value::as_str).filter(|v| option_id(v))?;
            let label = short_text(option.get("label"), MAX_LABEL_CHARS)?;
            if seen.iter().any(|o: &DirectChatOption| o.id == option_key) {
                return None;
            }
            seen.push(DirectChatOption { id: option_key.to_owned(), label });
        }
        let state = closed_static(value.get("state"), &QUESTION_STATES)?;
        let answer = match value.get("answer") {
            None | Some(Value::Null) => None,
            Some(answer) => Some(DirectChatAnswer::from_value(answer, &seen)?),
        };
        Some(DirectChatQuestion {
            id: id.to_owned(),
            at: seconds(value.get("at"))?,
            // A kind outside the list is a question that still waits for its answer: shown plain.
            kind: closed_static(value.get("kind"), &QUESTION_KINDS).unwrap_or("question"),
            subject: short_text(value.get("subject"), MAX_SUBJECT_CHARS),
            text: short_text(value.get("text"), MAX_QUESTION_CHARS)?,
            options: seen,
            multiple: value.get("multiple").and_then(Value::as_bool).unwrap_or(false),
            free: value.get("free").and_then(Value::as_bool).unwrap_or(false),
            expires_at: seconds(value.get("expiresAt")),
            state,
            answer,
        })
    }
}

impl DirectChatAnswer {
    fn from_value(value: &Value, options: &[DirectChatOption]) -> Option<Self> {
        let choices = value.get("choices").and_then(Value::as_array)?;
        let mut taken = Vec::with_capacity(choices.len());
        for choice in choices {
            let choice = choice.as_str().filter(|c| options.iter().any(|o| o.id == *c))?;
            taken.push(choice.to_owned());
        }
        Some(DirectChatAnswer {
            choices: taken,
            text: short_text(value.get("text"), MAX_ANSWER_CHARS),
            at: seconds(value.get("at"))?,
            origin: closed_static(value.get("origin"), &ANSWER_ORIGINS).unwrap_or("unknown"),
            seen_at: seconds(value.get("seenAt")),
        })
    }
}

/// How many queued message ids a page may carry, and how long one may be.
const MAX_QUEUED_IDS: usize = 64;
const MAX_QUEUED_ID_LEN: usize = 128;

fn queued_ids<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Absent (an older image, or a chat that never queued): none. A list: the ids of the turns still
    // held back, each a short plain word; anything else in it is left out.
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(match raw {
        Some(Value::Array(items)) => Some(
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|id| !id.is_empty() && id.len() <= MAX_QUEUED_ID_LEN && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:".contains(c)))
                .take(MAX_QUEUED_IDS)
                .map(str::to_owned)
                .collect(),
        ),
        _ => None,
    })
}

/// How a queued turn ended, as the team says it: typed and taken, typed and still in the composer,
/// typed with no proof, typed and given its Enter after the time (`late`), or never typed because it waited too long.
const QUEUE_ENDINGS: [&str; 5] = ["taken", "pending", "late", "unconfirmed", "expired"];

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct DirectChatQueueEnding {
    id: String,
    how: String,
}

fn queue_endings<'de, D>(deserializer: D) -> Result<Option<Vec<DirectChatQueueEnding>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Absent (an older image, or a chat that never queued): none. A list: the endings in their shape,
    // each id a short plain word and each `how` of the closed list; the others are left out.
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(match raw {
        Some(Value::Array(items)) => Some(
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id")?.as_str()?;
                    let how = string_in(item.get("how"), &QUEUE_ENDINGS)?;
                    let plain = !id.is_empty() && id.len() <= MAX_QUEUED_ID_LEN && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:".contains(c));
                    plain.then(|| DirectChatQueueEnding { id: id.to_owned(), how: how.to_owned() })
                })
                .take(MAX_QUEUED_IDS)
                .collect(),
        ),
        _ => None,
    })
}

fn closed_queue<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(string_in(raw.as_ref(), &["terminal"]).map(str::to_owned))
}

/// What the agent's terminal shows while the person waits for an answer: a running turn, or an empty
/// prompt. Any other word is left out: absent is «not known» and is never shown as idle.
fn closed_activity<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(string_in(raw.as_ref(), &["working", "idle"]).map(str::to_owned))
}

fn questions<'de, D>(deserializer: D) -> Result<Option<Vec<DirectChatQuestion>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Absent (an older image): none, and the page shows no buttons. A list: every question in its
    // shape, the others left out.
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(match raw {
        Some(Value::Array(items)) => Some(items.iter().take(MAX_QUESTIONS).filter_map(DirectChatQuestion::from_value).collect()),
        _ => None,
    })
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct DirectChatPage {
    messages: Vec<DirectChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<String>,
    /// The agent's open questions and its latest closed ones; absent from an older image.
    #[serde(default, deserialize_with = "questions", skip_serializing_if = "Option::is_none")]
    questions: Option<Vec<DirectChatQuestion>>,
    /// The ids of the turns the team holds back while its agent works, each typed when the agent is idle;
    /// absent from an older image or a chat that never queued. A sent turn that was queued is delivered
    /// once its id is no longer here.
    #[serde(default, deserialize_with = "queued_ids", skip_serializing_if = "Option::is_none")]
    queued: Option<Vec<String>>,
    /// How the turns that left the queue ended, for the last day: the page settles a queued turn only
    /// from here, never from its absence in `queued`.
    #[serde(default, deserialize_with = "queue_endings", skip_serializing_if = "Option::is_none")]
    settled: Option<Vec<DirectChatQueueEnding>>,
    /// `working` or `idle`, within half an hour of the person's last turn (the agent may answer first and go
    /// on working); absent when the team does not say (an older image, a screen it cannot read, an older
    /// turn): the page never reads absent as idle.
    #[serde(default, deserialize_with = "closed_activity", skip_serializing_if = "Option::is_none")]
    activity: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", from = "ReceiptAsWritten")]
pub(crate) struct DirectChatReceipt {
    client_message_id: String,
    accepted: bool,
    message_id: String,
    at: f64,
    /// `queued` when the agent's mailbox holds the turn and nobody has taken it yet; absent when the
    /// turn was typed into the agent's terminal, which is the only way a receipt says «delivered».
    #[serde(default, skip_serializing_if = "Option::is_none")]
    state: Option<String>,
    /// Whether the agent's CLI took the text, with proof: true, false (still in its composer: only
    /// Enter may be pressed again) or null (not known: nothing may be pressed). Absent from an older
    /// image. Anything but a boolean is null: a receipt never says «taken» by mistake.
    #[serde(skip_serializing_if = "Option::is_none")]
    taken: Option<Option<bool>>,
    /// With `taken: null`, why it is not known: one of TAKEN_REASONS, or none.
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    /// `terminal` with `state: queued`: the turn waits in the team for its agent to be idle, and the next
    /// pages say when it is gone; absent for a mailbox turn, which nothing watches.
    #[serde(skip_serializing_if = "Option::is_none")]
    queue: Option<String>,
}

/// A receipt as the team wrote it, before the one rule that ties two of its fields: a reason is said
/// only for a text whose fate is not known (`taken: null`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiptAsWritten {
    client_message_id: String,
    accepted: bool,
    message_id: String,
    at: f64,
    #[serde(default)]
    state: Option<String>,
    #[serde(default, deserialize_with = "taken_flag")]
    taken: Option<Option<bool>>,
    #[serde(default, deserialize_with = "closed_reason")]
    reason: Option<String>,
    #[serde(default, deserialize_with = "closed_queue")]
    queue: Option<String>,
}

impl From<ReceiptAsWritten> for DirectChatReceipt {
    fn from(raw: ReceiptAsWritten) -> Self {
        let reason = if raw.taken == Some(None) { raw.reason } else { None };
        let queue = if raw.state.as_deref() == Some("queued") { raw.queue } else { None };
        DirectChatReceipt {
            client_message_id: raw.client_message_id,
            accepted: raw.accepted,
            message_id: raw.message_id,
            at: raw.at,
            state: raw.state,
            taken: raw.taken,
            reason,
            queue,
        }
    }
}

/// The receipt of an answer: the question it answered, and when the team wrote it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatAnswerReceipt {
    question_id: String,
    accepted: bool,
    at: f64,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum DirectChatEvent {
    Status {
        status: DirectChatStatus,
    },
    Messages {
        #[serde(rename = "agentId")]
        agent_id: String,
        page: DirectChatPage,
    },
    Send {
        receipt: DirectChatReceipt,
    },
    Error {
        operation: &'static str,
        code: &'static str,
    },
}

#[derive(Debug, Serialize)]
pub(crate) struct DirectChatError {
    pub(crate) code: &'static str,
}
pub(crate) fn failure(code: &'static str) -> DirectChatError {
    DirectChatError { code }
}
fn status(state: &'static str, code: Option<&'static str>) -> DirectChatStatus {
    DirectChatStatus { state, code, link: None }
}

/// A connection that answered, with the way its commands reach the VPS when that costs a connection each.
fn ready_for(connection: &Connection) -> DirectChatStatus {
    ready_status(&connection.validated, connection.link)
}

fn ready_status(validated: &ValidatedHost, link: VpsLink) -> DirectChatStatus {
    DirectChatStatus {
        link: (matches!(validated, ValidatedHost::Vps { .. }) && link == VpsLink::PerCommand).then_some("per-command"),
        ..status("ready", None)
    }
}

fn valid_agent(value: &str) -> bool {
    matches!(
        value,
        "capitano"
            | "assistente"
            | "mentor"
            | "scout"
            | "analista"
            | "scorer"
            | "scrittore"
            | "critico"
    )
}
fn session_for(agent: &str) -> Option<&'static str> {
    Some(match agent {
        "capitano" => "CAPITANO",
        "assistente" => "ASSISTENTE",
        "mentor" => "MENTOR",
        "scout" => "SCOUT-1",
        "analista" => "ANALISTA-1",
        "scorer" => "SCORER-1",
        "scrittore" => "SCRITTORE-1",
        "critico" => "CRITICO",
        _ => return None,
    })
}

fn emit(inner: &DirectChatInner, event: DirectChatEvent) {
    if let Ok(mut subscribers) = inner.subscribers.lock() {
        subscribers.retain(|channel| channel.send(event.clone()).is_ok());
    }
}

fn connection_config_path(
    app: &tauri::AppHandle,
    scope: &AccountScope,
) -> Result<PathBuf, DirectChatError> {
    app.path()
        .app_local_data_dir()
        .map(|path| connection_config_path_at(&path, scope))
        .map_err(|_| failure("storage_unavailable"))
}

fn connection_config_path_at(root: &Path, scope: &AccountScope) -> PathBuf {
    root.join("accounts")
        .join(scope.digest())
        .join("direct-chat-host.json")
}

pub(crate) fn verify_optional_playground_local_host_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(), &'static str> {
    let path = connection_config_path_at(root, scope);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("playground_reset_host_unavailable"),
    };
    if !metadata.file_type().is_file() || metadata.len() > 4096 {
        return Err("playground_reset_host_invalid");
    }
    let raw = fs::read(path).map_err(|_| "playground_reset_host_unavailable")?;
    let value: Value = serde_json::from_slice(&raw).map_err(|_| "playground_reset_host_invalid")?;
    let object = value.as_object().ok_or("playground_reset_host_invalid")?;
    match object.get("kind").and_then(Value::as_str) {
        Some("local") if object.len() == 1 => Ok(()),
        Some("vps") => Err("playground_reset_host_not_local"),
        _ => Err("playground_reset_host_invalid"),
    }
}

pub(crate) fn verify_migration_local_host_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(), &'static str> {
    let path = connection_config_path_at(root, scope);
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(&path)
        .map_err(|_| "local_migration_host_missing")?;
    let metadata = file
        .metadata()
        .map_err(|_| "local_migration_host_invalid")?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > 4096 {
        return Err("local_migration_host_invalid");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let parent = path.parent().ok_or("local_migration_host_invalid")?;
        let parent_metadata = fs::metadata(parent).map_err(|_| "local_migration_host_invalid")?;
        if metadata.uid() != parent_metadata.uid()
            || metadata.permissions().mode() & 0o777 != 0o600
            || parent_metadata.permissions().mode() & 0o022 != 0
        {
            return Err("local_migration_host_invalid");
        }
    }
    let mut raw = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take(4097)
        .read_to_end(&mut raw)
        .map_err(|_| "local_migration_host_invalid")?;
    if raw.len() as u64 != metadata.len() {
        return Err("local_migration_host_invalid");
    }
    let value: Value = serde_json::from_slice(&raw).map_err(|_| "local_migration_host_invalid")?;
    let object = value.as_object().ok_or("local_migration_host_invalid")?;
    match object.get("kind").and_then(Value::as_str) {
        Some("local") if object.len() == 1 => Ok(()),
        Some("vps") => Err("local_migration_host_not_local"),
        _ => Err("local_migration_host_invalid"),
    }
}

// Every official connection writer shares this barrier. Registration may fill
// an absent host, but must never overwrite an already selected different host.
static HOST_PERSIST: Mutex<()> = Mutex::new(());

fn persist_host_at(path: &Path, host: &ExecutionHost) -> Result<(), DirectChatError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| failure("storage_unavailable"))?;
        if fs::symlink_metadata(parent)
            .map_err(|_| failure("storage_unavailable"))?
            .file_type()
            .is_symlink()
        {
            return Err(failure("storage_unavailable"));
        }
        set_private_dir_permissions(parent).map_err(failure)?;
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| failure("storage_unavailable"))?
        .as_nanos();
    let temporary = path.with_extension(format!("tmp-{}-{nonce}", std::process::id()));
    let bytes = serde_json::to_vec(host).map_err(|_| failure("storage_unavailable"))?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| failure("storage_unavailable"))?;
    let result = (|| {
        set_private_permissions(&temporary).map_err(failure)?;
        file.write_all(&bytes)
            .map_err(|_| failure("storage_unavailable"))?;
        file.sync_all()
            .map_err(|_| failure("storage_unavailable"))?;
        drop(file);
        fs::rename(&temporary, path).map_err(|_| failure("storage_unavailable"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn persist_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<(), DirectChatError> {
    let _write = HOST_PERSIST
        .lock()
        .map_err(|_| failure("storage_unavailable"))?;
    persist_host_at(&connection_config_path(app, scope)?, host)
}

fn read_assistance_host_at(path: &Path) -> Result<ExecutionHost, &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "host_config_invalid")?;
    if !metadata.file_type().is_file() || metadata.len() > 4096 {
        return Err("host_config_invalid");
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options.open(path).map_err(|_| "host_config_invalid")?;
    let opened = file.metadata().map_err(|_| "host_config_invalid")?;
    if !opened.is_file() || opened.len() > 4096 {
        return Err("host_config_invalid");
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| "host_config_invalid")?;
    if bytes.len() > 4096 {
        return Err("host_config_invalid");
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "host_config_invalid")?;
    let host: ExecutionHost =
        serde_json::from_value(value.clone()).map_err(|_| "host_config_invalid")?;
    if serde_json::to_value(&host).map_err(|_| "host_config_invalid")? != value {
        return Err("host_config_invalid");
    }
    Ok(host)
}

fn register_assistance_host_at(path: &Path, host: &ExecutionHost) -> Result<(), &'static str> {
    let _write = HOST_PERSIST.lock().map_err(|_| "storage_unavailable")?;
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            persist_host_at(path, host).map_err(|error| error.code)?;
        }
        Err(_) => return Err("storage_unavailable"),
        Ok(_) => {
            if read_assistance_host_at(path)? != *host {
                return Err("browser_connection_changed");
            }
            // Same host is idempotent: leave existing config bytes untouched.
        }
    }
    if read_assistance_host_at(path)? != *host {
        return Err("browser_connection_changed");
    }
    Ok(())
}

pub(crate) fn register_assistance_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<(), &'static str> {
    let path = connection_config_path(app, scope).map_err(|error| error.code)?;
    register_assistance_host_at(&path, host)
}

pub(crate) fn persist_onboarding_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<(), &'static str> {
    persist_host(app, scope, host).map_err(|error| error.code)
}

/// Removes only this account's persisted connection configuration. It is used
/// after the existing-team selection and candidate have been cleared.
pub(crate) fn clear_persisted_host_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(), &'static str> {
    match fs::remove_file(connection_config_path_at(root, scope)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("storage_unavailable"),
    }
}

fn load_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
) -> Result<ExecutionHost, DirectChatError> {
    let raw = fs::read(connection_config_path(app, scope)?)
        .map_err(|_| failure("host_not_configured"))?;
    serde_json::from_slice(&raw).map_err(|_| failure("host_config_invalid"))
}

pub(crate) fn load_persisted_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
) -> Result<ExecutionHost, &'static str> {
    load_host(app, scope).map_err(|error| error.code)
}

fn control_args(
    host: &ValidatedHost,
    control_path: &Path,
    operation: &str,
) -> Result<Vec<std::ffi::OsString>, DirectChatError> {
    let mut args = ssh_base_args(host).map_err(failure)?;
    let target = args.pop().ok_or_else(|| failure("invalid_host"))?;
    args.extend([
        "-S".into(),
        control_path.as_os_str().to_owned(),
        "-O".into(),
        operation.into(),
        target,
    ]);
    Ok(args)
}

fn check_tunnel(host: &ValidatedHost, control_path: &Path) -> bool {
    control_args(host, control_path, "check")
        .ok()
        .and_then(|args| run_program("ssh", &args, None, Duration::from_secs(5)).ok())
        .is_some_and(|result| result.success())
}

/// The longest path a Unix socket can have on macOS (its sun_path holds 104 bytes with the NUL;
/// Linux holds 108): the shorter limit is the one for every platform.
const SOCKET_PATH_MAX: usize = 103;
/// ssh creates the master's socket as `ControlPath` + "." + 16 random characters, then renames it
/// into place: the temporary name is the one that must fit.
const SSH_SOCKET_SUFFIX: usize = 17;
/// The folder of a tunnel's socket starts with this, so closing removes only a folder of ours.
const TUNNEL_DIR_PREFIX: &str = "jc";

/// Whether ssh can create the master socket at `path`, its temporary name included.
fn control_path_fits(path: &Path) -> bool {
    path.as_os_str().len() + SSH_SOCKET_SUFFIX <= SOCKET_PATH_MAX
}

/// The socket of a tunnel: `s`, alone in a folder made for it (0700 on Unix, a random name,
/// created exclusively, so nobody can have prepared it or reach the socket), in the first of
/// `bases` where it fits. The old name in TMPDIR was 95 characters on macOS (112 with ssh's
/// suffix): ssh could never open the tunnel there.
fn tunnel_socket_path(bases: &[PathBuf], mut name: impl FnMut() -> String) -> Result<PathBuf, &'static str> {
    for base in bases {
        for _ in 0..8 {
            let dir = base.join(format!("{TUNNEL_DIR_PREFIX}{}", name()));
            let socket = dir.join("s");
            if !control_path_fits(&socket) {
                break;
            }
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            match builder.create(&dir) {
                Ok(()) => return Ok(socket),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => break,
            }
        }
    }
    Err("tunnel_path_unavailable")
}

fn tunnel_dir_name() -> String {
    use std::hash::{BuildHasher, Hasher};
    // A fresh RandomState has random keys: with the pid and the time, a name nobody can guess.
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u32(std::process::id());
    hasher.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos());
    format!("{:010x}", hasher.finish() & 0xff_ffff_ffff)
}

/// On Unix /tmp first: the private folder keeps the socket ours there too, and the path stays
/// far from the limit (/tmp/jc<10>/s is 19 characters, 36 with ssh's suffix, where macOS's
/// TMPDIR alone is 49). The user's temporary folder is the fallback, and the only one elsewhere.
fn tunnel_socket_bases() -> Vec<PathBuf> {
    let mut bases = Vec::new();
    #[cfg(unix)]
    bases.push(PathBuf::from("/tmp"));
    bases.push(std::env::temp_dir());
    bases
}

/// Removes a tunnel's socket and the folder made for it.
fn remove_tunnel_socket(path: &Path) {
    let _ = fs::remove_file(path);
    if let Some(dir) = path.parent() {
        if dir.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with(TUNNEL_DIR_PREFIX)) {
            let _ = fs::remove_dir(dir);
        }
    }
}

fn open_tunnel(host: &ValidatedHost) -> Result<(PathBuf, Child), DirectChatError> {
    let mut args = ssh_base_args(host).map_err(failure)?;
    let target = args.pop().ok_or_else(|| failure("invalid_host"))?;
    let control_path = tunnel_socket_path(&tunnel_socket_bases(), tunnel_dir_name).map_err(failure)?;
    args.extend([
        "-M".into(),
        "-N".into(),
        "-o".into(),
        "ControlMaster=yes".into(),
        "-o".into(),
        "ControlPersist=no".into(),
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        "-S".into(),
        control_path.as_os_str().to_owned(),
        target,
    ]);
    let mut command = Command::new("ssh");
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::runtime_host::hide_console(&mut command);
    let child = command.spawn().map_err(|_| failure("tunnel_start_failed")).map_err(|error| {
        remove_tunnel_socket(&control_path);
        error
    })?;
    for _ in 0..40 {
        if check_tunnel(host, &control_path) {
            return Ok((control_path, child));
        }
        thread::sleep(Duration::from_millis(250));
    }
    let mut child = child;
    let _ = child.kill();
    let _ = child.wait();
    remove_tunnel_socket(&control_path);
    Err(failure("tunnel_verify_failed"))
}

/// The VPS link a connection starts with: the ssh master, or, where ssh has none (Windows), a check
/// that one connection answers, with the same errors as the master: `tunnel_verify_failed`, or
/// `ssh_rate_limited` when the server turns this computer away. `exit 0` means the same in every
/// shell, so the check assumes none.
fn open_vps_link(
    host: &ValidatedHost,
    link: VpsLink,
    check: impl FnOnce(&ValidatedHost) -> Result<ProcessResult, &'static str>,
) -> Result<(Option<PathBuf>, Option<Child>), DirectChatError> {
    match link {
        VpsLink::Master => open_tunnel(host).map(|(path, child)| (Some(path), Some(child))),
        VpsLink::PerCommand => match check(host) {
            Ok(result) if result.success() => Ok((None, None)),
            Err(code @ "ssh_rate_limited") => Err(failure(code)),
            _ => Err(failure("tunnel_verify_failed")),
        },
    }
}

const VPS_LINK_CHECK: &str = "exit 0";

/// The same VPS, field by field: address, user, port, the key the app uses and the file with the
/// host key it pinned for this account.
fn same_vps(a: &ValidatedHost, b: &ValidatedHost) -> bool {
    match (a, b) {
        (
            ValidatedHost::Vps { address, user, port, key_path, known_hosts },
            ValidatedHost::Vps { address: address_b, user: user_b, port: port_b, key_path: key_b, known_hosts: known_b },
        ) => address == address_b && user == user_b && port == port_b && key_path == key_b && known_hosts == known_b,
        _ => false,
    }
}

/// The chat's ssh master, if it may be lent to another read of the same team: the chat is
/// connected in this account, on the master link, to exactly this VPS and to the same team (the
/// pinned container, or none for the VPS the app set up). Its socket comes only from the chat's
/// own connection, never from what a page sends.
fn master_to_lend(
    connection: Option<&Connection>,
    scope: &AccountScope,
    host: &ValidatedHost,
    team: Option<(&str, &crate::existing_team_runtime::RuntimeTarget)>,
) -> Option<PathBuf> {
    let connection = connection?;
    if &connection.scope != scope || connection.link != VpsLink::Master || !same_vps(&connection.validated, host) {
        return None;
    }
    if connection.runtime.as_ref().map(|target| (target.team_id.as_str(), &target.runtime)) != team {
        return None;
    }
    connection.control_path.clone()
}

/// The folder of a master's socket, as the chat makes it: a real folder (not a link), of `uid`,
/// open to its owner only (0700), named with the chat's prefix. Once the chat closes its master the
/// name can be free again, and ssh does not look at who owns a socket: a folder that is not
/// still ours could hold another local user's socket.
#[cfg(unix)]
fn socket_folder_owned_by(socket: &Path, uid: u32) -> bool {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let Some(dir) = socket.parent() else { return false };
    if !dir.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with(TUNNEL_DIR_PREFIX)) {
        return false;
    }
    match fs::symlink_metadata(dir) {
        Ok(meta) => meta.file_type().is_dir() && meta.uid() == uid && meta.permissions().mode() & 0o777 == 0o700,
        Err(_) => false,
    }
}

/// Whether a lent socket's folder is still the chat's, checked right before each use of it.
#[cfg(unix)]
pub(crate) fn lent_socket_still_ours(socket: &Path) -> bool {
    // SAFETY: geteuid has no arguments or pointers.
    socket_folder_owned_by(socket, unsafe { libc::geteuid() })
}

/// No master on this platform: nothing is ever lent.
#[cfg(not(unix))]
pub(crate) fn lent_socket_still_ours(_socket: &Path) -> bool {
    false
}

/// The chat's master for a read of the agents' panel (the terminal of an agent), so that the read
/// opens no ssh connection of its own: the socket of `master_to_lend`, only while its folder is
/// still the chat's and the master answers. None means «open a connection as before».
pub(crate) fn shared_master(
    state: &DirectChatState,
    scope: &AccountScope,
    host: &ValidatedHost,
    team: Option<(&str, &crate::existing_team_runtime::RuntimeTarget)>,
) -> Option<PathBuf> {
    let path = {
        let slot = state.inner.connection.lock().ok()?;
        master_to_lend(slot.as_ref(), scope, host, team)?
    };
    (lent_socket_still_ours(&path) && check_tunnel(host, &path)).then_some(path)
}

fn close_connection(connection: &mut Connection) {
    if let (Some(path), ValidatedHost::Vps { .. }) =
        (&connection.control_path, &connection.validated)
    {
        if let Ok(args) = control_args(&connection.validated, path, "exit") {
            let _ = run_program("ssh", &args, None, Duration::from_secs(5));
        }
        remove_tunnel_socket(path);
    }
    if let Some(mut child) = connection.tunnel.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// The installed runtime directory, not a renderer value. The wrapper is still verified when the
/// connection opens; chat actions themselves intentionally do not invoke it.
fn local_runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, DirectChatError> {
    #[cfg(windows)]
    {
        crate::windows_runtime::runtime_dir(std::env::var_os("LOCALAPPDATA"))
            .ok_or_else(|| failure("runtime_missing"))
    }
    #[cfg(target_os = "macos")]
    {
        app.path()
            .home_dir()
            .map(|home| {
                home.join("Library")
                    .join("Application Support")
                    .join("Job Hunter Team")
                    .join("host-runtime")
            })
            .map_err(|_| failure("runtime_missing"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let data = std::env::var_os("XDG_DATA_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                app.path()
                    .home_dir()
                    .ok()
                    .map(|home| home.join(".local").join("share"))
            })
            .ok_or_else(|| failure("runtime_missing"))?;
        Ok(data.join("job-hunter-team").join("host-runtime"))
    }
}

struct LocalChatEngine {
    program: PathBuf,
    podman: bool,
}

/// Resolve Docker before starting it. The Finder-launched macOS app does not necessarily inherit
/// the user's shell PATH, while the wrapper deliberately adds these same locations.
fn local_docker_cli() -> Result<PathBuf, &'static str> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "macos")]
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/docker"),
        PathBuf::from("/usr/local/bin/docker"),
        PathBuf::from("/opt/podman/bin/docker"),
        PathBuf::from("/Applications/Docker.app/Contents/Resources/bin/docker"),
    ]);
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| {
            dir.join(if cfg!(windows) { "docker.exe" } else { "docker" })
        }));
    }
    candidates
        .into_iter()
        .find(|candidate| fs::metadata(candidate).is_ok_and(|metadata| metadata.is_file()))
        .ok_or("runtime_missing")
}

/// The JHT-private Podman shim is the only Podman engine selected from the runtime. Docker is
/// resolved once to an executable path, never assembled from page input or a shell string.
fn local_chat_engine(runtime: &Path) -> Result<LocalChatEngine, &'static str> {
    let selection =
        fs::read_to_string(runtime.join("container-runtime")).map_err(|_| "runtime_missing")?;
    match selection.trim() {
        "podman" => {
            let shim = runtime.join("bin").join(if cfg!(windows) {
                "docker.exe"
            } else {
                "docker"
            });
            let metadata = fs::symlink_metadata(&shim).map_err(|_| "runtime_missing")?;
            if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
                return Err("runtime_missing");
            }
            Ok(LocalChatEngine {
                program: shim,
                podman: true,
            })
        }
        "docker" => Ok(LocalChatEngine {
            program: local_docker_cli()?,
            podman: false,
        }),
        _ => Err("runtime_missing"),
    }
}

fn container_id(value: &str) -> bool {
    (12..=64).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn digest_file(path: &Path) -> Option<String> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() == 0 {
        return None;
    }
    Some(format!("{:x}", Sha256::digest(fs::read(path).ok()?)))
}

#[cfg(unix)]
fn unix_runtime_node_is_safe(path: &Path, directory: bool) -> bool {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let Ok(metadata) = fs::symlink_metadata(path) else { return false };
    (if directory { metadata.file_type().is_dir() } else { metadata.file_type().is_file() })
        && metadata.uid() == unsafe { libc::geteuid() }
        && metadata.permissions().mode() & 0o022 == 0
}

#[cfg(unix)]
fn unix_runtime_path_is_safe(runtime: &Path, wrapper: &Path) -> bool {
    let Ok(runtime_real) = fs::canonicalize(runtime) else { return false };
    let Ok(wrapper_real) = fs::canonicalize(wrapper) else { return false };
    if runtime_real != runtime || wrapper_real != wrapper {
        return false;
    }
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else { return false };
    let Ok(home) = fs::canonicalize(home) else { return false };
    // The declared HOME can itself be a link. Compare only physical paths so
    // a legacy bind below its real location cannot become a new trust root.
    let physical_child = |parts: &[&str]| {
        let candidate = parts.iter().fold(home.clone(), |path, part| path.join(part));
        fs::canonicalize(&candidate).unwrap_or(candidate)
    };
    let legacy = physical_child(&[".jht"]);
    let user_data = physical_child(&["Documents", "Job Hunter Team"]);
    !runtime_real.starts_with(&legacy)
        && !runtime_real.starts_with(&user_data)
        && !wrapper_real.starts_with(&legacy)
        && !wrapper_real.starts_with(&user_data)
}

/// Linux's protected host bundle, ported from jht-wrapper.sh. It has no engine side effect: a
/// malformed path, owner, manifest or selected engine is rejected before any native command.
#[cfg(all(unix, not(target_os = "macos")))]
fn unix_runtime_bundle_valid(wrapper: &Path, runtime: &Path) -> bool {
    if !unix_runtime_path_is_safe(runtime, wrapper) || !unix_runtime_node_is_safe(runtime, true) {
        return false;
    }
    let manifest = runtime.join(".runtime-integrity");
    let compose = runtime.join("docker-compose.yml");
    let setup = runtime.join("host-setup.sh");
    let bin = runtime.join("bin");
    if !unix_runtime_node_is_safe(&bin, true)
        || ![&manifest, &compose, &setup, wrapper]
        .into_iter()
        .all(|path| unix_runtime_node_is_safe(path, false))
    {
        return false;
    }
    if !fs::read_to_string(&compose).is_ok_and(|source| {
        source.lines().any(|line| {
            line.trim_start()
                .strip_prefix("- jht-runtime-mask:/jht_home/runtime")
                .is_some_and(|rest| rest.trim().is_empty())
        })
    })
        || !fs::read_to_string(&setup)
            .is_ok_and(|source| source.lines().any(|line| line == "JHT_HOST_SETUP_PROTOCOL=1"))
        || !fs::read_to_string(wrapper)
            .is_ok_and(|source| source.lines().any(|line| line == "JHT_HOST_RUNTIME_PROTOCOL=1"))
    {
        return false;
    }
    let Ok(source) = fs::read_to_string(&manifest) else { return false };
    let mut entries = BTreeMap::new();
    for line in source.lines() {
        let Some((key, value)) = line.split_once('=') else { return false };
        if (key == "version" && value != "1")
            || (key != "version"
                && (value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit())))
            || entries.insert(key, value).is_some()
        {
            return false;
        }
    }
    if entries.get("version").copied() != Some("1")
        || entries.get("docker-compose.yml").copied() != digest_file(&compose).as_deref()
        || entries.get("host-setup.sh").copied() != digest_file(&setup).as_deref()
        || entries.get("jht-wrapper.sh").copied() != digest_file(wrapper).as_deref()
    {
        return false;
    }
    let selection = runtime.join("container-runtime");
    let selected = match fs::symlink_metadata(&selection) {
        Ok(_) if unix_runtime_node_is_safe(&selection, false) => match fs::read_to_string(&selection) {
            Ok(value) if matches!(value.trim(), "docker" | "podman")
                && entries.get("container-runtime").copied() == digest_file(&selection).as_deref() => value.trim().to_owned(),
            _ => return false,
        },
        Err(_) if !entries.contains_key("container-runtime") => "docker".to_owned(),
        _ => return false,
    };
    let shim = runtime.join("bin").join("docker");
    if selected == "podman"
        && (!unix_runtime_node_is_safe(&shim, false)
            || fs::canonicalize(&shim).map_or(true, |real| real != shim)
            || entries.get("docker-shim").copied() != digest_file(&shim).as_deref()
            || !fs::read_to_string(&shim).is_ok_and(|source| source.lines().any(|line| line == "# JHT_PODMAN_DOCKER_SHIM=1")))
    {
        return false;
    }
    let image_pin = runtime.join("runtime-image");
    let mut expected_keys = vec!["version", "docker-compose.yml", "host-setup.sh", "jht-wrapper.sh"];
    if fs::symlink_metadata(&selection).is_ok() {
        expected_keys.push("container-runtime");
    }
    if selected == "podman" {
        expected_keys.push("docker-shim");
    }
    if fs::symlink_metadata(&image_pin).is_ok() {
        expected_keys.push("runtime-image");
    }
    expected_keys.sort_unstable();
    if entries.keys().copied().collect::<Vec<_>>() != expected_keys {
        return false;
    }
    match (entries.get("runtime-image"), fs::symlink_metadata(&image_pin)) {
        (None, Err(_)) => true,
        (Some(expected), Ok(_)) if unix_runtime_node_is_safe(&image_pin, false) => {
            digest_file(&image_pin).as_deref() == Some(*expected)
                && fs::read_to_string(&image_pin).is_ok_and(|pin| {
                    pin.strip_suffix('\n').is_some_and(|value| value.len() == 91
                        && value.starts_with("ghcr.io/leopu00/jht@sha256:")
                        && value[27..].bytes().all(|byte| byte.is_ascii_hexdigit()))
                })
        }
        _ => false,
    }
}

/// Native Linux Podman honors these inherited connection selectors. The
/// checked runtime shim is local-only, so inherit neither selector for any
/// of its discovery, inspect, or exec calls.
fn local_engine_removed_environment(_engine: &LocalChatEngine) -> &'static [&'static str] {
    #[cfg(all(unix, not(target_os = "macos")))]
    if _engine.podman {
        return &["CONTAINER_HOST", "CONTAINER_CONNECTION"];
    }
    &[]
}

fn run_local_engine<I, S>(
    engine: &LocalChatEngine,
    args: I,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, &'static str>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let program = engine.program.to_str().ok_or("runtime_missing")?;
    if !local_engine_removed_environment(engine).is_empty() {
        return run_program_without_env(
            program,
            args,
            input,
            timeout,
            local_engine_removed_environment(engine),
        );
    }
    run_program(program, args, input, timeout)
}

/// The desktop's local trust root. This is intentionally separate from process launch: all
/// platforms reject an untrusted runtime before discovering a container or starting `exec -i`.
fn local_chat_runtime_valid(wrapper: &Path, runtime: &Path) -> bool {
    #[cfg(windows)]
    {
        return crate::windows_runtime::wrapper_bundle_valid(wrapper, runtime);
    }
    #[cfg(target_os = "macos")]
    {
        return crate::onboarding::runtime_bundle_manifest_valid(runtime, wrapper)
            && unix_runtime_path_is_safe(runtime, wrapper)
            && unix_runtime_node_is_safe(runtime, true)
            && unix_runtime_node_is_safe(wrapper, false)
            && unix_runtime_node_is_safe(&runtime.join("bin/docker"), false)
            && fs::canonicalize(runtime.join("bin/docker")).is_ok_and(|real| real == runtime.join("bin/docker"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        unix_runtime_bundle_valid(wrapper, runtime)
    }
    #[cfg(not(any(unix, windows)))]
    {
        false
    }
}

fn local_compose_args(engine: &LocalChatEngine, runtime: &Path) -> Vec<OsString> {
    // The runtime's private shim is `podman --connection <attested machine>`.
    // `podman compose` may delegate to an arbitrary host provider, so it is not the runtime's
    // authenticated Compose path. Enumerate only the fixed JHT project and prove its labels below.
    // Docker retains the historical Compose lookup, whose project is path based. On Windows too:
    // compose would need the project name and the provider the wrapper sets in its own environment,
    // which the app does not have, so the container is listed by its labels there as well.
    if engine.podman {
        return vec![
            OsString::from("ps"),
            OsString::from("-q"),
            OsString::from("--filter"),
            OsString::from("label=com.docker.compose.project=jht"),
        ];
    }
    let mut args = vec![OsString::from("compose")];
    args.push(OsString::from("-f"));
    args.push(runtime.join("docker-compose.yml").into_os_string());
    if engine.podman {
        args.push(OsString::from("-f"));
        args.push(runtime.join("docker-compose.podman.yml").into_os_string());
    }
    args.push(OsString::from("--project-directory"));
    args.push(runtime.as_os_str().to_owned());
    args.push(OsString::from("ps"));
    args.push(OsString::from("-q"));
    args.push(OsString::from("jht"));
    args
}

fn label<'a>(labels: &'a Value, key: &str) -> Option<&'a str> {
    labels.get(key).and_then(Value::as_str)
}

fn podman_systemd_unit() -> String {
    ["podman-compose", "jht.service"].join("@")
}

/// The three values the wrapper puts in the environment of EVERY compose it runs (`scripts/jht-wrapper.sh`:
/// `jht_read_host_env_value`, then `${X:-default}`, then `export`), because the compose file resolves
/// `${JHT_HOST_TYPE}`, `${JHT_LANG}` and `${JHT_USER_TZ}` into the container's configuration and so into its
/// `io.podman.compose.config-hash`: a value from `host.env` that passes the wrapper's check wins over the
/// inherited environment (the last valid line of the file wins), then the inherited one, then `unknown` / `en` /
/// `UTC`. The container the app starts is made by the wrapper, so it carries THESE values; the hash computed here
/// has to be computed with the same ones, or a Mac whose `host.env` says `local` and its time zone (every Mac that
/// ran the host setup) gets another hash and its own container is «not the one Job Hunter Team installed» (found in the Mac collaudo of 27/10).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn wrapper_compose_environment(host_env: Option<&str>, inherited: &dyn Fn(&str) -> Option<String>) -> Vec<(&'static str, String)> {
    fn valid(key: &str, value: &str) -> bool {
        match key {
            "JHT_HOST_TYPE" => matches!(value, "local" | "vps"),
            "JHT_LANG" => matches!(value, "en" | "it" | "hu" | "es" | "de" | "fr" | "pt"),
            _ => !value.is_empty() && value.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'+' | b'.' | b'/' | b'-')),
        }
    }
    let from_file = |key: &str| -> Option<String> {
        let mut found = None;
        for line in host_env?.lines() {
            let line = line.strip_suffix('\r').unwrap_or(line).trim_start();
            let Some(value) = line.strip_prefix(key).and_then(|rest| rest.strip_prefix('=')) else { continue };
            let mut value = value;
            if value.starts_with('"') && value.ends_with('"') || value.starts_with('\'') && value.ends_with('\'') {
                let quote = if value.starts_with('"') { '"' } else { '\'' };
                value = value.strip_prefix(quote).unwrap_or(value);
                value = value.strip_suffix(quote).unwrap_or(value);
            }
            if valid(key, value) {
                found = Some(value.to_owned());
            }
        }
        found
    };
    [("JHT_HOST_TYPE", "unknown"), ("JHT_LANG", "en"), ("JHT_USER_TZ", "UTC")]
        .into_iter()
        .map(|(key, default)| (key, from_file(key).or_else(|| inherited(key).filter(|value| !value.is_empty())).unwrap_or_else(|| default.to_owned())))
        .collect()
}

/// `host.env` where the wrapper reads it: `$JHT_HOST_ENV_FILE`, else `~/.jht/host.env`; a regular file, small.
#[cfg(target_os = "macos")]
fn read_host_env() -> Option<String> {
    let path = std::env::var_os("JHT_HOST_ENV_FILE").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".jht").join("host.env")))?;
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() > 65_536 {
        return None;
    }
    fs::read_to_string(path).ok()
}

/// Where Homebrew (Apple silicon, Intel) and the Podman installer keep their tools.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const TOOL_ROOTS: [&str; 3] = ["/opt/homebrew", "/usr/local", "/opt/podman"];

/// The macOS group of the administrators (`admin`, gid 80). Homebrew leaves `Cellar` writable by it (`drwxrwxr-x
/// user:admin`), and whoever is in the group can act as root on the machine anyway, so a folder on the way to a tool
/// is not refused for that. It is the one exception: only on macOS, only this group, only for folders (never for the
/// tool itself), and it replaces neither the owner (the user or root) nor the rule that others never write.
#[cfg(unix)]
const ADMIN_GROUP: Option<u32> = if cfg!(target_os = "macos") { Some(80) } else { None };

/// A folder on the way to a tool is safe when the user or root owns it, nobody else can write in it, and the group
/// cannot either, unless it is the administrators' (see `ADMIN_GROUP`): whoever can write in it can rename the tool
/// and put another program in its place.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn tool_folder_is_safe(owner: u32, group: u32, mode: u32, user: u32, admin_group: Option<u32>) -> bool {
    (owner == user || owner == 0) && mode & 0o002 == 0 && (mode & 0o020 == 0 || admin_group == Some(group))
}

/// The tool itself is safe when the user or root owns it and neither the group (the administrators' included) nor
/// others can write it.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn tool_file_is_safe(owner: u32, mode: u32, user: u32) -> bool {
    (owner == user || owner == 0) && mode & 0o022 == 0
}

/// `podman` and `podman-compose` are SYMLINKS on a Mac that has them from Homebrew (`/opt/homebrew/bin/podman` ->
/// `../Cellar/podman/<version>/bin/podman-remote`), so the path is always resolved to the file it finally names. That
/// file is trusted when it is a regular file inside one of the install `roots` that `tool_file_is_safe`, and every
/// folder from its own up to the root is safe too (`tool_folder_is_safe`), as is the folder the path was asked in
/// (the `bin` that holds the link: whoever writes there changes where it points). A regular file planted in a folder
/// anyone can write, or in a path whose folders anyone can rename, is no more a tool of the install than a planted link.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn tool_is_trusted(path: &Path, roots: &[&Path]) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Ok(real) = fs::canonicalize(path) else { return false };
    let Some(root) = roots.iter().filter_map(|root| fs::canonicalize(root).ok()).find(|root| real.starts_with(root)) else { return false };
    let user = unsafe { libc::geteuid() };
    let Ok(file) = fs::metadata(&real) else { return false };
    if !file.file_type().is_file() || !tool_file_is_safe(file.uid(), file.mode(), user) {
        return false;
    }
    let folders_to_the_root_are_safe = |start: &Path| {
        let mut folder = Some(start);
        while let Some(dir) = folder {
            let Ok(metadata) = fs::metadata(dir) else { return false };
            if !metadata.file_type().is_dir() || !tool_folder_is_safe(metadata.uid(), metadata.gid(), metadata.mode(), user, ADMIN_GROUP) {
                return false;
            }
            if dir == root {
                return true;
            }
            folder = dir.parent();
        }
        false
    };
    real.parent().is_some_and(folders_to_the_root_are_safe)
        && path.parent().and_then(|dir| fs::canonicalize(dir).ok()).is_some_and(|dir| folders_to_the_root_are_safe(&dir))
}

/// The trusted `name` in the `bin` folder of an install root, and only there: the PATH the app was opened with is not
/// searched (an entry of it that is empty or relative would be the folder it is run from).
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn find_trusted_tool(name: &str, roots: &[&Path]) -> Option<PathBuf> {
    roots.iter().map(|root| root.join("bin").join(name)).find(|path| tool_is_trusted(path, roots))
}

/// The hash the running container has to carry, or why it could not be worked out: a reason in the fixed
/// words of `runtime_log::ATTEST_REASONS`. A reason that waiting may cure (a probe that did not run, a
/// plan that did not come) is told apart from one that waiting will not (another version, a missing file),
/// see `attest_reason_may_pass`.
#[cfg(target_os = "macos")]
fn mac_config_hash(runtime: &Path, timeout: Duration) -> Result<String, &'static str> {
    mac_config_hash_in(runtime, timeout, read_host_env().as_deref(), &|key| std::env::var(key).ok())
}

/// Whether the reason a check could not be made may pass by itself: the probe or the plan did not run or
/// did not answer, which is not the same as the container being another one.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn attest_reason_may_pass(reason: &str) -> bool {
    reason.ends_with("_unreadable") || matches!(reason, "hash_dry_run_exit" | "hash_dry_run_timeout" | "hash_dry_run_not_started" | "hash_plan_without_create")
}

/// `host_env` is the text of `host.env` and `inherited` the process environment, so that a test can say both.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn mac_config_hash_in(runtime: &Path, timeout: Duration, host_env: Option<&str>, inherited: &dyn Fn(&str) -> Option<String>) -> Result<String, &'static str> {
    let search = |name: &str| {
        #[cfg(test)]
        {
            let fixture = runtime.join("bin").join(name);
            if fs::symlink_metadata(&fixture).is_ok_and(|metadata| metadata.file_type().is_file()) {
                return Some(fixture);
            }
        }
        find_trusted_tool(name, &TOOL_ROOTS.map(Path::new))
    };
    let podman = search("podman").ok_or("hash_tool_missing")?;
    let compose = search("podman-compose").ok_or("hash_tool_missing")?;
    // podman-compose runs `podman` by name, and an app opened from Finder has `/usr/bin:/bin:/usr/sbin:/sbin`
    // for a PATH, without Homebrew's: its own version probe then said «No such file or directory: podman» and
    // the container looked like another one. The children get the directory of the podman that was found
    // and trusted in front of the PATH they have (the wrapper runs them with Homebrew in it).
    let path_with_podman = podman
        .parent()
        .and_then(|dir| std::env::join_paths(std::iter::once(dir.to_path_buf()).chain(std::env::var_os("PATH").iter().flat_map(std::env::split_paths))).ok())
        .and_then(|joined| joined.into_string().ok())
        .ok_or("hash_tool_missing")?;
    // A version that could not be read is not a version that differs.
    let podman_said = podman.to_str().and_then(|program| run_program(program, ["--version"], None, timeout).ok()).filter(|result| result.success()).and_then(|result| String::from_utf8(result.stdout).ok());
    match podman_said {
        None => return Err("hash_podman_version_unreadable"),
        Some(said) if said.trim() != "podman version 6.1.3" => return Err("hash_podman_version_differs"),
        Some(_) => {}
    }
    let machine = fs::read_to_string(runtime.join("podman-machine")).map_err(|_| "hash_machine_file")?;
    let machine = machine.strip_suffix('\n').ok_or("hash_machine_file")?;
    if machine.is_empty() || !machine.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')) { return Err("hash_machine_file"); }
    let compose_said = compose.to_str().and_then(|program| {
        let (result, stderr) = run_program_keeping_stderr_with_environment(program, ["--version"], None, timeout, runtime, &["CONTAINER_HOST", "CONTAINER_CONNECTION"], &[("CONTAINER_CONNECTION", machine), ("PATH", path_with_podman.as_str())]);
        let mut output = result.ok().filter(ProcessResult::success)?.stdout;
        output.extend_from_slice(&stderr);
        String::from_utf8(output).ok()
    });
    match compose_said {
        None => return Err("hash_compose_version_unreadable"),
        Some(said) if !said.lines().any(|line| line == "podman-compose version 1.6.0") => return Err("hash_compose_version_differs"),
        Some(_) => {}
    }
    let image = match fs::symlink_metadata(runtime.join("runtime-image")) {
        Ok(_) => {
            let image = fs::read_to_string(runtime.join("runtime-image")).map_err(|_| "hash_image_pin")?;
            let image = image.strip_suffix('\n').ok_or("hash_image_pin")?.to_owned();
            let digest = image.strip_prefix("ghcr.io/leopu00/jht@sha256:").ok_or("hash_image_pin")?;
            if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) { return Err("hash_image_pin"); }
            Some(image)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err("hash_image_pin"),
    };
    let args = vec![OsString::from("--verbose"), OsString::from("--dry-run"), OsString::from("--project-name"), OsString::from("jht"), OsString::from("--podman-path"), podman.into_os_string(), OsString::from("-f"), runtime.join("docker-compose.yml").into_os_string(), OsString::from("up"), OsString::from("-d"), OsString::from("--force-recreate"), OsString::from("jht")];
    let mut environment = vec![("CONTAINER_CONNECTION", machine), ("PODMAN_COMPOSE_WARNING_LOGS", "false"), ("PATH", path_with_podman.as_str())];
    if let Some(image) = image.as_deref() { environment.push(("JHT_IMAGE", image)); }
    // The same environment the wrapper runs the compose in: see `wrapper_compose_environment`.
    let host_environment = wrapper_compose_environment(host_env, inherited);
    for (name, value) in &host_environment { environment.push((*name, value.as_str())); }
    let (result, stderr) = run_program_keeping_stderr_with_environment(compose.to_str().ok_or("hash_tool_missing")?, args, None, timeout, runtime, &["CONTAINER_HOST", "CONTAINER_CONNECTION", "JHT_IMAGE"], &environment);
    let planned = match result {
        Ok(done) if done.success() => done,
        Ok(_) => return Err("hash_dry_run_exit"),
        Err("process_timeout") => return Err("hash_dry_run_timeout"),
        Err(_) => return Err("hash_dry_run_not_started"),
    };
    let mut output = planned.stdout;
    output.extend_from_slice(&stderr);
    let output = std::str::from_utf8(&output).map_err(|_| "hash_plan_without_create")?;
    let mut hash = None;
    // podman-compose 1.6.0 hashes each service on its own: the plan of `jht` prints the create of its dependency first (with another hash); only the create of `jht` carries the hash its container is labelled with.
    for line in output.lines().filter(|line| line.contains(" create --name=jht ")) { for (at, _) in line.match_indices("io.podman.compose.config-hash=") { let value = &line[at + "io.podman.compose.config-hash=".len()..]; let value: String = value.chars().take_while(|b| b.is_ascii_hexdigit()).collect(); if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) { return Err("hash_plan_ambiguous"); } match hash.as_deref() { None => hash = Some(value), Some(old) if old == value => {}, Some(_) => return Err("hash_plan_ambiguous") } } }
    hash.ok_or("hash_plan_without_create")
}

/// A Windows path as the compose labels spell it, to compare with another: forward slashes as
/// backslashes, no `\\?\` prefix, no trailing separator, and case ignored (the file system does).
fn windows_path_key(path: &str) -> String {
    let path = path.replace('/', "\\");
    let path = path.strip_prefix("\\\\?\\").unwrap_or(&path);
    // Unicode lower case, not ASCII: a profile name with accents is the same name in capitals.
    path.trim_end_matches('\\').to_lowercase()
}

/// The Windows team's container. Its Compose provider is the runtime's own `docker-compose.exe`
/// (Compose v2 over the Podman socket), which writes the `com.docker.compose.*` labels and none of
/// `io.podman.compose.*`: the container is the one the runtime's two files started in the runtime
/// directory. Asking for podman-compose's labels rejected every Windows container (G7).
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_container_labels_are_attested(labels: &Value, runtime: &Path) -> bool {
    if label(labels, "com.docker.compose.project") != Some("jht")
        || label(labels, "com.docker.compose.service") != Some("jht")
        || label(labels, "com.docker.compose.container-number") != Some("1")
    {
        return false;
    }
    let working_dir = label(labels, "com.docker.compose.project.working_dir").map(windows_path_key);
    let listed: Vec<String> = label(labels, "com.docker.compose.project.config_files")
        .map(|value| value.split(',').map(windows_path_key).collect())
        .unwrap_or_default();
    // The directory as the app names it, or as the system resolves it (a short 8.3 name or a link
    // in the app's path against the long one in the labels): either way, one directory.
    std::iter::once(runtime.to_path_buf()).chain(fs::canonicalize(runtime).ok()).any(|root| {
        let files = [root.join("docker-compose.yml"), root.join("docker-compose.podman.yml")]
            .map(|file| windows_path_key(&file.to_string_lossy()));
        working_dir.as_deref() == Some(windows_path_key(&root.to_string_lossy()).as_str()) && listed == files
    })
}

/// 64 lower-case hex digits after `ghcr.io/leopu00/jht@sha256:`: the only reference the runtime pins.
fn is_pinned_image_reference(value: &str) -> bool {
    value
        .strip_prefix("ghcr.io/leopu00/jht@sha256:")
        .is_some_and(|digest| digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
}

/// The image the container was made from is the runtime's pinned one: the digest in its
/// `runtime-image`, which the manifest already attests. Without a pin file the runtime's default is
/// a digest of the same repository.
#[cfg_attr(not(windows), allow(dead_code))]
fn windows_container_image_is_the_runtimes(image: &str, runtime: &Path) -> bool {
    match fs::read_to_string(runtime.join("runtime-image")) {
        Ok(pin) => pin.strip_suffix('\n').is_some_and(|pin| is_pinned_image_reference(pin) && pin == image),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => is_pinned_image_reference(image),
        Err(_) => false,
    }
}

/// `running|labels` as the engine's inspect prints it, plus `|image` where the image is asked for.
#[cfg_attr(not(windows), allow(dead_code))]
fn split_inspected(line: &str, with_image: bool) -> Option<(&str, &str, Option<&str>)> {
    let (running, rest) = line.split_once('|')?;
    if !with_image {
        return Some((running, rest, None));
    }
    // the image is the last field: a label's text may hold a `|`, an image reference never does
    let (labels, image) = rest.rsplit_once('|')?;
    Some((running, labels, Some(image.trim())))
}

/// The first rule of the attestation the container's labels do not meet, in the fixed words of
/// `runtime_log::ATTEST_REASONS`; `None` when they meet all of them.
fn podman_container_label_refusal(labels: &Value, runtime: &Path, expected_config_hash: Option<&str>) -> Option<&'static str> {
    #[cfg(windows)]
    {
        let _ = expected_config_hash;
        return (!windows_container_labels_are_attested(labels, runtime)).then_some("label_windows");
    }
    #[cfg(not(windows))]
    podman_compose_label_refusal(labels, runtime, expected_config_hash)
}

#[cfg(not(windows))]
fn podman_compose_label_refusal(labels: &Value, runtime: &Path, expected_config_hash: Option<&str>) -> Option<&'static str> {
    let runtime_text = runtime.to_string_lossy();
    let systemd_unit = podman_systemd_unit();
    if label(labels, "com.docker.compose.project") != Some("jht") || label(labels, "io.podman.compose.project") != Some("jht") {
        return Some("label_project");
    }
    if label(labels, "com.docker.compose.service") != Some("jht") || label(labels, "io.podman.compose.service") != Some("jht") {
        return Some("label_service");
    }
    if label(labels, "com.docker.compose.container-number") != Some("1") {
        return Some("label_container_number");
    }
    if label(labels, "com.docker.compose.project.working_dir") != Some(runtime_text.as_ref()) {
        return Some("label_working_dir");
    }
    if !label(labels, "io.podman.compose.config-hash").is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())) {
        return Some("label_hash_form");
    }
    #[cfg(target_os = "macos")]
    {
        if label(labels, "com.docker.compose.project.config_files") != Some(runtime.join("docker-compose.yml").to_string_lossy().as_ref()) {
            return Some("label_config_files");
        }
        if label(labels, "io.podman.compose.version") != Some("1.6.0") {
            return Some("label_compose_version");
        }
        if label(labels, "PODMAN_SYSTEMD_UNIT") != Some(systemd_unit.as_str()) {
            return Some("label_systemd_unit");
        }
        return (expected_config_hash != label(labels, "io.podman.compose.config-hash")).then_some("label_config_hash_differs");
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let expected_files = format!("{}/docker-compose.yml,{}/docker-compose.podman-linux.yml", runtime_text, runtime_text);
        if label(labels, "com.docker.compose.project.config_files") != Some(expected_files.as_str()) {
            return Some("label_config_files");
        }
        if !label(labels, "io.podman.compose.version").is_some_and(|version| {
            let mut parts = version.split('.');
            matches!((parts.next(), parts.next()), (Some(major), Some(minor))
                if major.parse::<u16>().is_ok_and(|major| major > 1)
                || (major == "1" && minor.parse::<u16>().is_ok_and(|minor| minor >= 1)))
        }) {
            return Some("label_compose_version");
        }
        return (label(labels, "PODMAN_SYSTEMD_UNIT") != Some(systemd_unit.as_str())).then_some("label_systemd_unit");
    }
    #[cfg(not(unix))]
    {
        Some("label_windows")
    }
}

/// The first thing that keeps a running `jht` container from being taken: the hash it has to carry could
/// not be worked out (`expected` is the reason), or a label (or the image, on Windows) is not what the
/// runtime writes. `None` when it is the one.
fn attestation_refusal(expected: Option<&Result<String, &'static str>>, labels: &Value, runtime: &Path, image_is_the_runtimes: bool) -> Option<&'static str> {
    match expected {
        Some(Err(reason)) => Some(*reason),
        _ => podman_container_label_refusal(labels, runtime, expected.and_then(|hash| hash.as_deref().ok())),
    }
    .or_else(|| (!image_is_the_runtimes).then_some("label_image"))
}

/// What is said when no container was taken: another one is up (it is not used), the check could not be
/// made now (the page asks again, and waits as it does for a team that is starting), or none is up.
fn container_not_found_code(refused: Option<&'static str>, unchecked: Option<&'static str>) -> &'static str {
    match (refused, unchecked) {
        (Some(_), _) => "local_container_not_attested",
        (None, Some(_)) => "container_unavailable",
        (None, None) => "local_team_not_running",
    }
}

/// One and only one currently-running Compose service named `jht` is the chat target. The compose
/// invocation is rooted in the attested runtime directory; `inspect` checks the service label again
/// before its id is accepted for exec.
fn local_chat_container(
    engine: &LocalChatEngine,
    runtime: &Path,
    timeout: Duration,
) -> Result<String, &'static str> {
    #[cfg(target_os = "macos")]
    let expected_config_hash = engine.podman.then(|| mac_config_hash(runtime, timeout));
    #[cfg(not(target_os = "macos"))]
    let expected_config_hash: Option<Result<String, &'static str>> = None;
    let listed = run_local_engine(engine, local_compose_args(engine, runtime), None, timeout)?;
    let ids: Vec<&str> = std::str::from_utf8(&listed.stdout)
        .map_err(|_| "container_unavailable")?
        .lines()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .collect();
    if ids.len() > 16 || ids.iter().any(|id| !container_id(id)) {
        return Err("container_unavailable");
    }
    let mut found = None;
    // Why a container that is running as `jht` was not taken: it is not the one installed, or the check could
    // not be made (the hash it has to carry was not worked out) which is not the same thing.
    let mut refused: Option<&'static str> = None;
    let mut unchecked: Option<&'static str> = None;
    for id in ids {
        let inspected = run_local_engine(
            engine,
            [
                "inspect",
                "--type",
                "container",
                id,
                "--format",
                // On Windows the image too: the labels alone are not an identity there.
                if cfg!(windows) { "{{.State.Running}}|{{json .Config.Labels}}|{{.Config.Image}}" } else { "{{.State.Running}}|{{json .Config.Labels}}" },
            ],
            None,
            timeout,
        )?;
        if !inspected.success() {
            continue;
        }
        let Ok(line) = std::str::from_utf8(&inspected.stdout).map(str::trim) else {
            continue;
        };
        let Some((running, labels, image)) = split_inspected(line, cfg!(windows)) else {
            continue;
        };
        let Ok(labels) = serde_json::from_str::<Value>(labels) else {
            continue;
        };
        let service = label(&labels, "com.docker.compose.service");
        if running != "true" || service != Some("jht") {
            continue;
        }
        let image_is_the_runtimes = !cfg!(windows) || image.is_some_and(|image| windows_container_image_is_the_runtimes(image, runtime));
        if engine.podman {
            if let Some(reason) = attestation_refusal(expected_config_hash.as_ref(), &labels, runtime, image_is_the_runtimes) {
                if attest_reason_may_pass(reason) {
                    unchecked = Some(reason);
                } else {
                    refused = Some(reason);
                }
                continue;
            }
        }
        if found.replace(id).is_some() {
            return Err("container_unavailable");
        }
    }
    // Why there is none, said apart: the team is not up, what is up is not the one the app's runtime
    // started (it is never used for the chat), or it could not be checked now (the page tries again).
    if let Some(id) = found {
        return Ok(id.to_owned());
    }
    if let Some(reason) = refused.or(unchecked) {
        note_attest_reason(reason);
    }
    Err(container_not_found_code(refused, unchecked))
}

fn local_chat_exec_args(
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

/// The local implementation of read/send/answer/enter executes no wrapper action. Its protected
/// runtime, selected engine and single running container are verified in Rust before native exec.
fn run_local_chat(
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
fn engine_lost_the_container(result: &Result<ProcessResult, &'static str>) -> bool {
    match result {
        // A slow engine is not a lost container: emptying the kept one at every timeout would make each call pay the lookup.
        Err(code) => *code != "process_timeout",
        Ok(done) => done.code != 0 && (done.code == 125 || chat_failure(done.code, "").is_empty()),
    }
}

/// How long the container found for one chat call serves the next ones.
const LOCAL_CHAT_TEAM_KEPT: Duration = Duration::from_secs(5);

static LOCAL_CHAT_TEAM: crate::team_control::ResolveCache<AttestedLocalTeam> = crate::team_control::ResolveCache::new();

/// The attested container of this computer's team for a chat call. The page reads an agent's chat
/// several times a second and sends from it: finding the container is the runtime check plus two
/// engine calls (5 to 10 s on Windows), so one found a moment ago is reused, and a lookup that
/// fails keeps nothing.
fn local_chat_team(wrapper: &Path, runtime: &Path, timeout: Duration) -> Result<Arc<AttestedLocalTeam>, &'static str> {
    LOCAL_CHAT_TEAM.get(&local_chat_team_key(wrapper, runtime), Instant::now(), LOCAL_CHAT_TEAM_KEPT, true, || AttestedLocalTeam::resolve(wrapper, runtime, timeout))
}

fn local_chat_team_key(wrapper: &Path, runtime: &Path) -> String {
    format!("{}\n{}", wrapper.display(), runtime.display())
}

/// Drops the kept container: a lookup that fails keeps nothing, so asking for a fresh one that fails
/// empties the slot.
fn forget_local_chat_team(wrapper: &Path, runtime: &Path) {
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
    engine: LocalChatEngine,
    container: String,
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

    /// `exec [-i] <container> <argv>`: `-i` only when there is stdin to give.
    pub(crate) fn exec(&self, argv: &[&str], input: Option<&[u8]>, timeout: Duration) -> Result<ProcessResult, &'static str> {
        run_local_engine(&self.engine, attested_exec_args(&self.container, argv, input.is_some())?, input, timeout)
    }
}

fn attested_exec_args(container: &str, argv: &[&str], with_input: bool) -> Result<Vec<OsString>, &'static str> {
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

fn run_connection(
    connection: &Connection,
    local_args: &[&str],
    remote_operation: RemoteOperation<'_>,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, DirectChatError> {
    match &connection.validated {
        ValidatedHost::Local => {
            crate::account_scope::verify_local_runtime_owner(
                connection
                    .local_owner_marker
                    .as_deref()
                    .ok_or_else(|| failure("local_account_owner_unavailable"))?,
                &connection.scope,
            )
            .map_err(failure)?;
            match remote_operation {
                    RemoteOperation::Chat(operation) => {
                        let runtime = connection
                            .local_runtime
                            .as_deref()
                            .ok_or_else(|| failure("runtime_missing"))?;
                        run_local_chat(
                            connection
                                .local_wrapper
                                .as_deref()
                                .ok_or_else(|| failure("runtime_missing"))?,
                            runtime,
                            operation,
                            input,
                            timeout,
                        )
                        .map_err(failure)
                    }
                _ => crate::onboarding::run_verified_local_wrapper(
                    connection
                        .local_wrapper
                        .as_deref()
                        .ok_or_else(|| failure("runtime_missing"))?,
                    local_args,
                    input,
                    timeout,
                )
                .map_err(failure)
            }
        }
        ValidatedHost::Vps { .. } => {
            let selected = connection.app.as_ref().ok_or_else(|| failure("existing_team_runtime_target_changed"))
                .and_then(|app| existing_team_runtime::selected_or_own(app, &connection.scope, &connection.host).map_err(failure))?;
            if selected.as_ref().map(|target| (&target.team_id, &target.runtime)) != connection.runtime.as_ref().map(|target| (&target.team_id, &target.runtime)) {
                return Err(failure("existing_team_runtime_target_changed"));
            }
            let command = match (selected.as_ref(), remote_operation) {
                (Some(target), RemoteOperation::Probe) => existing_team_runtime::command(&target.runtime, "\"$JHT_ENGINE\" inspect --type container --format '{{.State.Running}}' \"$JHT_CID\"").map_err(failure)?,
                (Some(target), RemoteOperation::Python) => existing_team_runtime::python_command(&target.runtime).map_err(failure)?,
                (Some(target), RemoteOperation::Delivery(session)) => existing_team_runtime::delivery_command(&target.runtime, session).map_err(failure)?,
                (Some(target), RemoteOperation::Chat(operation)) => existing_team_runtime::chat_command(&target.runtime, &operation).map_err(failure)?,
                (None, RemoteOperation::Chat(operation)) => remote_wrapper_command(
                    &existing_team_runtime::chat_wrapper_arguments(&operation).map_err(failure)?,
                    operation.needs_answer_actions(),
                ),
                (None, RemoteOperation::Probe) => REMOTE_CONTAINER_PROBE.to_owned(),
                (None, RemoteOperation::Python) => REMOTE_PYTHON_STDIN.to_owned(),
                (None, RemoteOperation::Delivery(session)) => delivery_command(session).ok_or_else(|| failure("invalid_agent"))?.to_owned(),
            };
            match connection.link {
                VpsLink::Master => run_ssh_command(&connection.validated, &command, input, timeout, connection.control_path.as_deref()),
                VpsLink::PerCommand => run_ssh_command_without_pipes(&connection.validated, &command, input, timeout),
            }
            .map_err(failure)
        }
    }
}

fn probe(connection: &Connection) -> DirectChatStatus {
    if let (ValidatedHost::Vps { .. }, Some(path)) =
        (&connection.validated, &connection.control_path)
    {
        if !check_tunnel(&connection.validated, path) {
            return status("error", Some("tunnel_unavailable"));
        }
    }
    let result = run_connection(
        connection,
        &["desktop-chat", "probe"],
        RemoteOperation::Probe,
        None,
        CONNECT_TIMEOUT,
    );
    match result {
        Ok(result) if result.success() && result.stdout_text().trim() == "true" => {
            ready_for(connection)
        }
        // The host answered and there is no container for the team: say which kind of «no container» it is.
        Ok(_) => status("error", Some(probe_no_container_code(&connection.validated))),
        // The host could not be asked at all (runtime missing, another account's, a timeout).
        Err(_) => status("error", Some("container_unavailable")),
    }
}

/// What a probe that found no container for the team says. On this computer the team is not running: the
/// chat's own code, which the pages answer with «Start the team». On a VPS the container is unavailable (the
/// machine may be off or the team not installed there): nothing the app starts from here.
fn probe_no_container_code(host: &ValidatedHost) -> &'static str {
    match host {
        ValidatedHost::Local => "local_team_not_running",
        ValidatedHost::Vps { .. } => "container_unavailable",
    }
}

fn connect_impl(
    app: &tauri::AppHandle,
    scope: AccountScope,
    host: ExecutionHost,
) -> Result<Connection, DirectChatError> {
    let validated =
        crate::runtime_host::validate_host_for_scope(app, &host, &scope).map_err(failure)?;
    let runtime = if matches!(validated, ValidatedHost::Vps { .. }) {
        existing_team_runtime::selected_or_own(app, &scope, &host).map_err(failure)?
    } else {
        None
    };
    let link = vps_link_for(std::env::consts::OS);
    let (local_wrapper, local_runtime, local_owner_marker, control_path, tunnel) = match &validated
    {
        ValidatedHost::Local => (
            Some(crate::onboarding::verified_local_wrapper_path(app).map_err(failure)?),
            Some(local_runtime_dir(app)?),
            Some(crate::account_scope::local_owner_marker_path(app).map_err(failure)?),
            None,
            None,
        ),
        ValidatedHost::Vps { .. } => {
            let (path, child) = open_vps_link(&validated, link, |host| {
                run_ssh_command_without_pipes(host, VPS_LINK_CHECK, None, CONNECT_TIMEOUT)
            })?;
            (None, None, None, path, child)
        }
    };
    let mut connection = Connection {
        app: Some(app.clone()),
        scope: scope.clone(),
        host,
        validated,
        runtime,
        local_wrapper,
        local_runtime,
        local_owner_marker,
        control_path,
        tunnel,
        link,
    };
    let state = probe(&connection);
    if state.state != "ready" {
        close_connection(&mut connection);
        return Err(failure(state.code.unwrap_or("connect_failed")));
    }
    persist_host(app, &scope, &connection.host)?;
    Ok(connection)
}

/// What the app does right after connecting an existing team, for the CLI: open the direct chat
/// on the host the connection persisted (as direct_chat_reconnect does), then close it again.
/// Dropping the connection closes the tunnel and removes its socket.
pub(crate) fn cli_open_and_close(app: &tauri::AppHandle, scope: &AccountScope) -> Result<(), &'static str> {
    let host = load_host(app, scope).map_err(|error| error.code)?;
    let connection = connect_impl(app, scope.clone(), host).map_err(|error| error.code)?;
    drop(connection);
    Ok(())
}

async fn connect_scoped(
    app: tauri::AppHandle,
    state: &DirectChatState,
    scopes: AccountScopeState,
    expected: AccountScope,
    host: ExecutionHost,
) -> Result<DirectChatStatus, DirectChatError> {
    {
        let _scope = scopes.lock_expected(&expected).map_err(failure)?;
        state
            .inner
            .connection
            .lock()
            .map_err(|_| failure("state_failed"))?
            .take();
        emit(
            &state.inner,
            DirectChatEvent::Status {
                status: status("connecting", None),
            },
        );
    }
    let worker_scopes = scopes.clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = worker_scopes
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        connect_impl(&app, worker_expected, host)
    })
    .await
    .map_err(|_| failure("connect_failed"))?;
    match result {
        Ok(connection) => {
            let _scope = scopes.lock_expected(&expected).map_err(failure)?;
            let mut slot = state
                .inner
                .connection
                .lock()
                .map_err(|_| failure("state_failed"))?;
            let ready = ready_for(&connection);
            *slot = Some(connection);
            emit(
                &state.inner,
                DirectChatEvent::Status {
                    status: ready.clone(),
                },
            );
            Ok(ready)
        }
        Err(error) => {
            let _scope = scopes.lock_expected(&expected).map_err(failure)?;
            let failed = status("error", Some(error.code));
            emit(
                &state.inner,
                DirectChatEvent::Status {
                    status: failed.clone(),
                },
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn direct_chat_connect(
    app: tauri::AppHandle,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    host: ExecutionHost,
) -> Result<DirectChatStatus, DirectChatError> {
    let expected = scopes.active().map_err(failure)?;
    connect_scoped(app, &state, scopes.inner().clone(), expected, host).await
}

#[tauri::command]
pub(crate) fn direct_chat_subscribe(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    on_event: Channel<DirectChatEvent>,
) -> Result<DirectChatStatus, DirectChatError> {
    let scope = scopes.lock_active().map_err(failure)?;
    state
        .inner
        .subscribers
        .lock()
        .map_err(|_| failure("state_failed"))?
        .push(on_event);
    status_for_scope(&state.inner, scope.scope())
}

fn status_for_scope(
    inner: &DirectChatInner,
    scope: &AccountScope,
) -> Result<DirectChatStatus, DirectChatError> {
    let slot = inner
        .connection
        .lock()
        .map_err(|_| failure("state_failed"))?;
    match slot.as_ref() {
        Some(connection) if &connection.scope == scope => Ok(probe(connection)),
        Some(_) => Err(failure("account_scope_mismatch")),
        None => Ok(status("disconnected", None)),
    }
}

#[tauri::command]
pub(crate) fn direct_chat_status(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<DirectChatStatus, DirectChatError> {
    let scope = scopes.lock_active().map_err(failure)?;
    status_for_scope(&state.inner, scope.scope())
}

#[tauri::command]
pub(crate) async fn direct_chat_reconnect(
    app: tauri::AppHandle,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<DirectChatStatus, DirectChatError> {
    let expected = scopes.active().map_err(failure)?;
    let host = {
        let _scope = scopes.lock_expected(&expected).map_err(failure)?;
        load_host(&app, &expected)?
    };
    connect_scoped(app, &state, scopes.inner().clone(), expected, host).await
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 15) as usize] as char);
    }
    output
}

fn python_input(script: &str, request: &Value) -> Result<Zeroizing<Vec<u8>>, DirectChatError> {
    let mut input = Zeroizing::new(hex_encode(script.as_bytes()).into_bytes());
    input.push(b'\n');
    input.extend(serde_json::to_vec(request).map_err(|_| failure("request_invalid"))?);
    input.push(b'\n');
    Ok(input)
}

fn run_python(
    connection: &Connection,
    script: &str,
    request: &Value,
    timeout: Duration,
) -> Result<ProcessResult, DirectChatError> {
    let mut input = python_input(script, request)?;
    let result = run_connection(
        connection,
        &["desktop-chat", "python"],
        RemoteOperation::Python,
        Some(&input),
        timeout,
    );
    input.zeroize();
    result
}

/// The host's wrapper, run on a VPS that was never pinned: the checks of `REMOTE_PYTHON_STDIN`
/// (the wrapper is there, executable, not a link, and speaks the chat protocol), then the wrapper
/// with the arguments given. Every one was checked by the chat's argument list, and is quoted.
fn remote_wrapper_command(arguments: &[String], answer_actions: bool) -> String {
    let checks = REMOTE_PYTHON_STDIN.strip_suffix("desktop-chat python").unwrap_or(REMOTE_PYTHON_STDIN);
    let checks = checks.strip_suffix(r#"exec "$JHT_BIN" "#).unwrap_or(checks);
    let quoted: Vec<String> = arguments.iter().map(|argument| format!("'{argument}'")).collect();
    // A wrapper without the chat marker does not know the actions: 64 says exactly that, and only 64
    // sends the caller back to the older path. Any other exit (2 included, which python3 gives when the
    // image has no agent_chat.py) is the script's, and is told as such. Answer and Enter came later:
    // they need a marker of their own, and have no older path.
    let answer = if answer_actions {
        format!(r#"grep -Fqx 'JHT_DESKTOP_CHAT_ANSWER=1' "$JHT_BIN" || exit {UNKNOWN_ACTION}; "#)
    } else {
        String::new()
    };
    format!(r#"{checks}grep -Fqx 'JHT_DESKTOP_CHAT_FIXED=1' "$JHT_BIN" || exit {UNKNOWN_ACTION}; {answer}exec "$JHT_BIN" {}"#, quoted.join(" "))
}

/// The exit that says «the host's wrapper does not have the chat actions».
const UNKNOWN_ACTION: i32 = 64;

/// A pinned team's chat goes through the fixed script of the container. A local team reaches that
/// same script directly from Rust; only an unpinned VPS goes through its host wrapper.
fn uses_pinned_chat(connection: &Connection) -> bool {
    matches!(connection.validated, ValidatedHost::Vps { .. }) && connection.runtime.is_some()
}

/// What the script (or the link under it) said, as a code of the error catalog. 2 is python3's
/// answer for a missing file: an image older than this chat. 70 is the pinned container no longer
/// being the one that was confirmed. 255 is ssh's own: the link is gone.
fn chat_failure(code: i32, default: &'static str) -> &'static str {
    match code {
        2 => "chat_runtime_outdated",
        70 => "existing_team_runtime_target_changed",
        // The agent's terminal is not at its prompt (a menu, a sign-in, a permission question, text
        // already typed): nothing was written, and the text was never typed over it.
        119 => "agent_not_at_prompt",
        120 => "invalid_request",
        121 => "team_not_running",
        122 => "agent_not_running",
        123 => "agent_unavailable",
        124 => "agent_busy",
        125 => "agent_stuck",
        126 => "send_failed",
        127 => "read_failed",
        128 => "persist_failed",
        // The image has no fence for the user's words: older than the chat, the same «update the team».
        129 => "chat_runtime_outdated",
        // The agent is at an otherwise ready prompt, but has a draft. The transport left both
        // that draft and the user's message untouched.
        130 => "composer_has_text",
        // An answer the team did not take: the question is no longer open (answered, expired), an
        // option it does not have or words it does not take, a question it does not know, or a write
        // that failed. The page has a sentence for each.
        // The image has no questions to answer (no agent_questions, no database): update the team.
        114 => "chat_runtime_outdated",
        115 => "answer_failed",
        116 => "not_found",
        117 => "invalid_choice",
        118 => "question_closed",
        255 => "tunnel_unavailable",
        _ => default,
    }
}

/// Chat without a pinned container. For a local runtime `run_connection` executes the container
/// script directly; for an unpinned VPS it uses the host wrapper. `None` is only the VPS wrapper's
/// exit 64: it has no chat marker, so the caller keeps the older path while app and VPS update apart.
fn run_wrapper_chat(
    connection: &Connection,
    operation: ChatOperation<'_>,
    input: Option<&[u8]>,
    timeout: Duration,
    default: &'static str,
) -> Result<Option<ProcessResult>, DirectChatError> {
    let arguments = existing_team_runtime::chat_wrapper_arguments(&operation).map_err(failure)?;
    let references: Vec<&str> = arguments.iter().map(String::as_str).collect();
    let result = run_connection(
        connection,
        &references,
        RemoteOperation::Chat(operation),
        input,
        timeout,
    )?;
    wrapper_outcome(
        result,
        default,
        matches!(&connection.validated, ValidatedHost::Local),
    )
}

/// What the wrapper's exit says: done, «this wrapper has no chat actions» (64, and only 64), or a
/// failure of the script behind it. On this computer the four actions bypass that wrapper; a 2 or
/// 64 therefore says the local runtime cannot provide this chat, never that the team is old.
fn wrapper_outcome(
    result: ProcessResult,
    default: &'static str,
    local: bool,
) -> Result<Option<ProcessResult>, DirectChatError> {
    match result.code {
        0 => Ok(Some(result)),
        UNKNOWN_ACTION if !local => Ok(None),
        2 | UNKNOWN_ACTION if local => Err(failure("local_chat_wrapper_outdated")),
        code => Err(failure(chat_failure(code, default))),
    }
}

fn run_chat(
    connection: &Connection,
    operation: ChatOperation<'_>,
    input: Option<&[u8]>,
    timeout: Duration,
    default: &'static str,
) -> Result<ProcessResult, DirectChatError> {
    let result = run_connection(connection, &[], RemoteOperation::Chat(operation), input, timeout)?;
    if result.success() {
        Ok(result)
    } else {
        Err(failure(chat_failure(result.code, default)))
    }
}

pub(crate) fn window_may_write(label: &str) -> bool {
    label == "main"
}

/// Writing to an existing team's agent needs the full connection ("Collega e conferma") made in
/// this run of the app. The read-only view activates the same target and opens the same chat, so
/// it is decided here, in the native side, and not by the page: a chat opened read-only reads,
/// and a send is refused whatever the renderer asks.
///
/// A team with no pinned target is this computer's (always writable) or a VPS of the person's own,
/// which `own_may_write` answers: writing to it needs the mark the app's own setup writes, or the
/// person's claim of it (JHT-T30). Not having a candidate or a selection is no permission.
fn link_allows_writing(runtime: Option<&ActivatedTarget>, own_may_write: bool, full_link: impl Fn(&ActivatedTarget) -> bool) -> bool {
    runtime.map_or(own_may_write, full_link)
}

/// Why a message may not go to the VPS of the person's own this connection is on, or none: this
/// computer and an existing team have their own rules. The codes are the page's invitation to claim
/// the VPS (`own_vps_claim_required`) or to claim it again after its key changed (`own_vps_key_changed`).
fn own_vps_write_refusal(connection: &Connection) -> Option<&'static str> {
    if connection.runtime.is_some() || !matches!(connection.validated, ValidatedHost::Vps { .. }) {
        return None;
    }
    let Some(app) = connection.app.as_ref() else {
        return Some("own_vps_claim_refused");
    };
    let pinned = crate::runtime_host::pinned_host_fingerprint(&connection.validated).ok();
    match existing_team_runtime::root(app) {
        Ok(root) => existing_team_runtime::own_vps_state_at(&root, &connection.scope, &connection.host, pinned.as_deref()).write_refusal(),
        Err(_) => Some("own_vps_claim_refused"),
    }
}

fn parse_json<T: for<'de> Deserialize<'de>>(
    result: ProcessResult,
    code: &'static str,
) -> Result<T, DirectChatError> {
    if !result.success() {
        return Err(failure(code));
    }
    serde_json::from_slice(&result.stdout).map_err(|_| failure(code))
}

#[tauri::command]
pub(crate) async fn direct_chat_read(
    app: tauri::AppHandle,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    cursor: Option<String>,
) -> Result<DirectChatPage, DirectChatError> {
    if !valid_agent(&agent_id)
        || cursor
            .as_ref()
            .is_some_and(|v| v.len() > 32 || !v.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(failure("invalid_request"));
    }
    let expected = scopes.active().map_err(failure)?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let inner = Arc::clone(&state.inner);
    let agent_for_event = agent_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        let slot = inner
            .connection
            .lock()
            .map_err(|_| failure("state_failed"))?;
        let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
        if &connection.scope != scope.scope() {
            return Err(failure("account_scope_mismatch"));
        }
        if connection.link == VpsLink::PerCommand && matches!(connection.validated, ValidatedHost::Vps { .. }) {
            return small_read(cursor.as_deref(), &mut |cursor| read_page(connection, &agent_id, cursor));
        }
        read_page(connection, &agent_id, cursor.as_deref())
    })
    .await
    .map_err(|_| failure("read_failed"))?;
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    match result {
        Ok(page) => {
            emit(
                &state.inner,
                DirectChatEvent::Messages {
                    agent_id: agent_for_event,
                    page: page.clone(),
                },
            );
            Ok(page)
        }
        Err(error) => {
            log_chat_failure(&app, "read", error.code);
            emit(
                &state.inner,
                DirectChatEvent::Error {
                    operation: "read",
                    code: error.code,
                },
            );
            Err(error)
        }
    }
}

fn delivery_command(agent: &str) -> Option<&'static str> {
    Some(match agent {
        "capitano" => {
            r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat send CAPITANO"#
        }
        "assistente" => {
            r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat send ASSISTENTE"#
        }
        "mentor" => {
            r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat send MENTOR"#
        }
        "scout" => {
            r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat send SCOUT-1"#
        }
        "analista" => {
            r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat send ANALISTA-1"#
        }
        "scorer" => {
            r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat send SCORER-1"#
        }
        "scrittore" => {
            r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat send SCRITTORE-1"#
        }
        "critico" => {
            r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat send CRITICO"#
        }
        _ => return None,
    })
}

fn local_delivery_args(session: &str) -> [&str; 3] {
    ["desktop-chat", "send", session]
}

/// One page of an agent's chat, from `cursor` (the server's tail of 128 KB without one), by the
/// fixed container script (local or pinned), the VPS host wrapper, or the older Python fallback.
fn read_page(connection: &Connection, agent_id: &str, cursor: Option<&str>) -> Result<DirectChatPage, DirectChatError> {
    if uses_pinned_chat(connection) {
        let result = run_chat(connection, ChatOperation::Read { agent: agent_id, cursor }, None, READ_TIMEOUT, "read_failed")?;
        return parse_json::<DirectChatPage>(result, "read_failed");
    }
    if let Some(result) =
        run_wrapper_chat(connection, ChatOperation::Read { agent: agent_id, cursor }, None, READ_TIMEOUT, "read_failed")?
    {
        return parse_json::<DirectChatPage>(result, "read_failed");
    }
    // The host's wrapper is older than the chat actions: the older path.
    parse_json::<DirectChatPage>(
        run_python(connection, CHAT_READ_PY, &json!({"agent":agent_id,"cursor":cursor}), READ_TIMEOUT)?,
        "read_failed",
    )
}

/// The tail a first small read asks for: the last 32 KiB of the chat, not the server's 128 KiB.
const SMALL_READ_TAIL: u64 = 32 * 1024;
/// How far before the cursor a later read starts: more than a whole line of the largest message
/// (4000 characters, 16 KB of UTF-8, plus its JSON).
const SMALL_READ_OVERLAP: u64 = 20 * 1024;
/// A cursor past any chat (12 digits, the most the server takes): the server answers with no line
/// and its size as the cursor.
const SMALL_READ_SIZE_PROBE: &str = "999999999999";

/// A read on the per-command link (Windows to a VPS), where every read is an ssh connection: what
/// passes stays small, about 50 KB at most, instead of the server's whole tail of 128 KiB at every
/// read. Nothing changes on the server, so the VPS already installed answer the same way.
/// - Without a cursor (the page's first read of an agent): the size, then the last 32 KiB.
/// - With the page's cursor: from 20 KiB before it. The server drops the line it lands inside, so
///   a cursor right at the start of a line would lose that line, and a line still being written at
///   the end would come back cut: the overlap reads them again whole, with the same ids (an absolute
///   offset or the message's own id), and the page merges them.
/// - A cursor the server answers with a smaller one (the chat got shorter): read again from the tail.
fn small_read(
    cursor: Option<&str>,
    read: &mut dyn FnMut(Option<&str>) -> Result<DirectChatPage, DirectChatError>,
) -> Result<DirectChatPage, DirectChatError> {
    let at = |page: &DirectChatPage| page.cursor.as_deref().and_then(|cursor| cursor.parse::<u64>().ok());
    if let Some(kept) = cursor.and_then(|cursor| cursor.parse::<u64>().ok()) {
        let sent = kept.saturating_sub(SMALL_READ_OVERLAP);
        let page = read(Some(&sent.to_string()))?;
        if at(&page).is_some_and(|back| back >= sent) {
            return Ok(page);
        }
    }
    let size = at(&read(Some(SMALL_READ_SIZE_PROBE))?).ok_or_else(|| failure("read_failed"))?;
    read(Some(&size.saturating_sub(SMALL_READ_TAIL).to_string()))
}

/// One command does what the two used to: the turn is written once for its client id and goes to
/// the agent's terminal in the user's envelope. A terminal that is busy (alive, taking a turn) is
/// asked again with the same id, which writes nothing twice. `None`: the host's wrapper is older
/// than the chat actions, and the caller keeps the older path.
fn send_fixed(
    connection: &Connection,
    agent: &str,
    text: &str,
    client_id: &str,
) -> Result<Option<DirectChatReceipt>, DirectChatError> {
    if text.len() > MAX_CHAT_STDIN_BYTES {
        return Err(failure("invalid_request"));
    }
    let input = Zeroizing::new(text.as_bytes().to_vec());
    let pinned = uses_pinned_chat(connection);
    // One ask. A working agent is not retried here: the team queues the turn and answers `queued`.
    let operation = ChatOperation::Send { agent, client_message_id: client_id };
    let outcome = if pinned {
        run_chat(connection, operation, Some(&input), SEND_TIMEOUT, "send_failed").map(Some)
    } else {
        run_wrapper_chat(connection, operation, Some(&input), SEND_TIMEOUT, "send_failed")
    };
    match outcome {
        Ok(Some(result)) => parse_json(result, "send_verify_failed").map(Some),
        Ok(None) => Ok(None),
        Err(error) => Err(error),
    }
}

fn send_impl(
    inner: &DirectChatInner,
    agent: String,
    text: String,
    client_id: String,
) -> Result<DirectChatReceipt, DirectChatError> {
    let _serial = inner
        .send_lock
        .lock()
        .map_err(|_| failure("state_failed"))?;
    let slot = inner
        .connection
        .lock()
        .map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    refuse_writing(connection)?;
    if let Some(receipt) = send_fixed(connection, &agent, &text, &client_id)? {
        return Ok(receipt);
    }
    // The host's wrapper is older than the chat actions (only a local team or an unpinned VPS gets
    // here): the older path, as it was.
    let check: Value = parse_json(
        run_python(
            connection,
            CHAT_PERSIST_PY,
            &json!({"mode":"check","agent":agent,"clientMessageId":client_id}),
            READ_TIMEOUT,
        )?,
        "send_verify_failed",
    )?;
    // The current Godot transport persists first, then delivers through the
    // verified tmux helper. A retry may find the persisted turn: it must still
    // retry delivery, never turn file presence into an optimistic success.
    let receipt: DirectChatReceipt = if check.get("exists").and_then(Value::as_bool) == Some(true) {
        serde_json::from_value(check).map_err(|_| failure("send_verify_failed"))?
    } else {
        parse_json(
            run_python(
                connection,
                CHAT_PERSIST_PY,
                &json!({"mode":"append","agent":agent,"text":text,"clientMessageId":client_id}),
                READ_TIMEOUT,
            )?,
            "persist_failed",
        )?
    };
    let session = session_for(&agent).ok_or_else(|| failure("invalid_agent"))?;
    let mut envelope = Zeroizing::new(format!("[@utente -> @{agent}] [CHAT] {text}"));
    let mut delivered = run_connection(
        connection,
        &local_delivery_args(session),
        RemoteOperation::Delivery(session),
        Some(envelope.as_bytes()),
        SEND_TIMEOUT,
    )?;
    for _ in 1..3 {
        if delivered.code != 4 {
            break;
        }
        delivered = run_connection(
            connection,
            &local_delivery_args(session),
            RemoteOperation::Delivery(session),
            Some(envelope.as_bytes()),
            SEND_TIMEOUT,
        )?;
    }
    envelope.zeroize();
    if !delivered.success() {
        return Err(failure(match delivered.code {
            2 => "agent_not_running",
            3 => "agent_unavailable",
            4 => "agent_busy",
            5 => "agent_stuck",
            _ => "send_failed",
        }));
    }
    Ok(receipt)
}

#[tauri::command]
pub(crate) async fn direct_chat_send(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    text: String,
    client_message_id: String,
) -> Result<DirectChatReceipt, DirectChatError> {
    // Writing to an agent is a command: only the app's own window may ask for it (the capability
    // also reaches the windows that load other sites, the sign-in views).
    if !window_may_write(window.label()) {
        return Err(failure("invalid_request"));
    }
    let trimmed = text.trim();
    if !valid_agent(&agent_id)
        || trimmed.is_empty()
        || trimmed.len() > 4000
        || trimmed.contains('\0')
        || client_message_id.is_empty()
        || client_message_id.len() > 128
        || !client_message_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    {
        return Err(failure("invalid_request"));
    }
    let expected = scopes.active().map_err(failure)?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let inner = Arc::clone(&state.inner);
    let agent = agent_id;
    let id = client_message_id;
    let mut sensitive = Zeroizing::new(trimmed.to_string());
    let owned = sensitive.to_string();
    sensitive.zeroize();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        {
            let slot = inner
                .connection
                .lock()
                .map_err(|_| failure("state_failed"))?;
            let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
            if &connection.scope != scope.scope() {
                return Err(failure("account_scope_mismatch"));
            }
        }
        send_impl(&inner, agent, owned, id)
    })
    .await
    .map_err(|_| failure("send_failed"))?;
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    match result {
        Ok(receipt) => {
            emit(
                &state.inner,
                DirectChatEvent::Send {
                    receipt: receipt.clone(),
                },
            );
            Ok(receipt)
        }
        Err(error) => {
            log_chat_failure(&app, "send", error.code);
            emit(
                &state.inner,
                DirectChatEvent::Error {
                    operation: "send",
                    code: error.code,
                },
            );
            Err(error)
        }
    }
}

/// Whether an attachment can go now, and if not the closed reason the page says. The files are
/// copied on this computer for this computer's team only: a VPS has its own disk, a read-only view
/// writes nothing, and there is no copy without a connected team.
fn attach_refusal(connection: &Connection) -> Option<&'static str> {
    if !cfg!(any(target_os = "macos", target_os = "linux")) {
        return Some("attach_platform");
    }
    if !matches!(&connection.validated, ValidatedHost::Local) {
        return Some("attach_vps");
    }
    let own_refusal = own_vps_write_refusal(connection);
    if !link_allows_writing(connection.runtime.as_ref(), own_refusal.is_none(), |target| {
        existing_team_runtime::full_link_granted(&connection.scope, target)
    }) {
        return Some("attach_read_only");
    }
    if connection.local_wrapper.is_none() || connection.local_runtime.is_none() {
        return Some("attach_not_connected");
    }
    None
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatAttachState {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
}

/// What the 📎 button says: on, or off with the reason. Reads the connection only: nothing is probed.
#[tauri::command]
pub(crate) fn direct_chat_attach_state(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<DirectChatAttachState, DirectChatError> {
    let scope = scopes.lock_active().map_err(failure)?;
    let slot = state.inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let code = match slot.as_ref() {
        Some(connection) if &connection.scope == scope.scope() => attach_refusal(connection),
        Some(_) => return Err(failure("account_scope_mismatch")),
        None => Some("attach_not_connected"),
    };
    Ok(DirectChatAttachState { available: code.is_none(), code })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatAttachment {
    /// `sent`, `saved_not_sent` (the file is in the folder, the Assistant was not told: `code` says
    /// why) or `cancelled` (the person closed the window: not an error).
    outcome: &'static str,
    /// The person's own file name, for their screen only.
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    receipt: Option<DirectChatReceipt>,
}

/// Held while an attachment is in hand: a second click is refused, not queued.
struct AttachGuard(Arc<std::sync::atomic::AtomicBool>);

impl AttachGuard {
    fn take(busy: &Arc<std::sync::atomic::AtomicBool>) -> Option<Self> {
        use std::sync::atomic::Ordering;
        busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(Arc::clone(busy)))
    }
}

impl Drop for AttachGuard {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}

/// The message of an attachment. The person reads one short sentence in their language; behind it,
/// on the same line, the Assistant gets the path of OUR copy in its container (the page hides that
/// bracket: `withoutAttachmentPath` in DirectChatScreen.tsx reads exactly this shape). Nothing of the
/// person's file name or content is in it. An unknown language gets English.
/// «My CV» only for the kinds of file a CV comes in (a document); a picture or a plain text is not
/// known to be one, and gets «a file».
fn attachment_message(locale: &str, file: &str) -> String {
    let document = file
        .rsplit_once('.')
        .is_some_and(|(_, extension)| crate::chat_attachment::DOCUMENT_EXTENSIONS.contains(&extension));
    let said = match (locale, document) {
        ("it", true) => "Ho allegato il mio CV.",
        ("it", false) => "Ho allegato un file.",
        ("de", true) => "Ich habe meinen Lebenslauf angehängt.",
        ("de", false) => "Ich habe eine Datei angehängt.",
        ("es", true) => "He adjuntado mi CV.",
        ("es", false) => "He adjuntado un archivo.",
        ("fr", true) => "J'ai joint mon CV.",
        ("fr", false) => "J'ai joint un fichier.",
        ("hu", true) => "Csatoltam az önéletrajzomat.",
        ("hu", false) => "Csatoltam egy fájlt.",
        ("pt", true) => "Anexei o meu CV.",
        ("pt", false) => "Anexei um ficheiro.",
        (_, true) => "I attached my CV.",
        (_, false) => "I attached a file.",
    };
    format!("{said} [attachment for my profile: /jht_user/{}/{file}]", crate::chat_attachment::FOLDER)
}

/// Where the system's window opens: the Downloads folder of the person, where a CV usually is, and
/// not Documents, which holds their personal files. Without that folder the system chooses.
fn downloads_of(home: &Path) -> Option<PathBuf> {
    let downloads = home.join("Downloads");
    downloads.is_dir().then_some(downloads)
}

struct AttachTarget {
    wrapper: PathBuf,
    runtime: PathBuf,
    user_dir: PathBuf,
    start_dir: Option<PathBuf>,
}

/// The same gate as a message, then the places the copy needs. Runs off the main thread.
fn attach_target(
    inner: &DirectChatInner,
    scopes: &AccountScopeState,
    expected: &AccountScope,
) -> Result<AttachTarget, DirectChatError> {
    let scope = scopes.lock_expected(expected).map_err(failure)?;
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    if &connection.scope != scope.scope() {
        return Err(failure("account_scope_mismatch"));
    }
    refuse_writing(connection)?;
    if let Some(code) = attach_refusal(connection) {
        return Err(failure(code));
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| failure("attach_platform"))?;
    Ok(AttachTarget {
        wrapper: connection.local_wrapper.clone().ok_or_else(|| failure("runtime_missing"))?,
        runtime: connection.local_runtime.clone().ok_or_else(|| failure("runtime_missing"))?,
        start_dir: downloads_of(&home),
        user_dir: home.join("Documents").join("Job Hunter Team"),
    })
}

/// The copy is in the folder on this computer; the team must see the same file there. A mount that
/// does not show it (another folder, an engine that shares less) takes the copy back: nothing is
/// told to the Assistant about a file it cannot open.
fn team_sees_the_copy(target: &AttachTarget, saved: &crate::chat_attachment::Saved) -> bool {
    let path = format!("/jht_user/{}/{}", crate::chat_attachment::FOLDER, saved.file);
    let Ok(team) = local_chat_team(&target.wrapper, &target.runtime, READ_TIMEOUT) else { return false };
    matches!(
        team.exec(&["stat", "-c", "%s", path.as_str()], None, READ_TIMEOUT),
        Ok(done) if done.success() && String::from_utf8_lossy(&done.stdout).trim() == saved.size.to_string()
    )
}

/// «Attach» in the Assistant's chat: the person chooses a file in the system's window (the page
/// never names a path), it is checked and copied into the team's `allegati` folder, the team is
/// asked to see it, and only then the Assistant gets a short message naming our copy.
#[tauri::command]
pub(crate) async fn direct_chat_attach(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    client_message_id: String,
    locale: String,
) -> Result<DirectChatAttachment, DirectChatError> {
    use tauri_plugin_dialog::DialogExt;
    if !window_may_write(&window.label())
        || agent_id != "assistente"
        || client_message_id.is_empty()
        || client_message_id.len() > 128
        || !client_message_id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    {
        return Err(failure("invalid_request"));
    }
    let expected = scopes.active().map_err(failure)?;
    let app_for_log = app.clone();
    let _busy = AttachGuard::take(&state.inner.attach_busy).ok_or_else(|| failure("attach_busy"))?;
    let scope_state = scopes.inner().clone();
    let target = {
        let inner = Arc::clone(&state.inner);
        let (scope_state, expected) = (scope_state.clone(), expected.clone());
        tauri::async_runtime::spawn_blocking(move || attach_target(&inner, &scope_state, &expected))
            .await
            .map_err(|_| failure("attach_failed"))??
    };
    // The system's window is modal and waits for the person: never on the main thread.
    let picker = window.clone();
    let start_dir = target.start_dir.clone();
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_parent(&picker)
            .add_filter("Documents", &crate::chat_attachment::ALLOWED_EXTENSIONS);
        if let Some(dir) = start_dir {
            dialog = dialog.set_directory(dir);
        }
        dialog.blocking_pick_file()
    })
    .await
    .map_err(|_| failure("attach_failed"))?;
    let Some(chosen) = chosen else {
        return Ok(DirectChatAttachment { outcome: "cancelled", display_name: None, code: None, receipt: None });
    };
    let source = chosen.into_path().map_err(|_| failure("attachment_unreadable"))?;
    let saved = {
        let user_dir = target.user_dir.clone();
        // the name of the copy reads the clock of this computer, not UTC
        let now = crate::chat_attachment::local_wall_clock(
            SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        );
        tauri::async_runtime::spawn_blocking(move || crate::chat_attachment::store(&user_dir, &source, now, &mut |_| {}))
            .await
            .map_err(|_| failure("attach_failed"))?
            .map_err(failure)?
    };
    let target = Arc::new(target);
    let seen = {
        let (target, saved_view) = (Arc::clone(&target), saved.clone());
        tauri::async_runtime::spawn_blocking(move || team_sees_the_copy(&target, &saved_view))
            .await
            .unwrap_or(false)
    };
    if !seen {
        let (user_dir, file) = (target.user_dir.clone(), saved.file.clone());
        let _ = tauri::async_runtime::spawn_blocking(move || crate::chat_attachment::remove(&user_dir, &file)).await;
        return Err(failure("attachment_not_shared"));
    }
    let text = attachment_message(&locale, &saved.file);
    let display_name = Some(saved.display.clone());
    let inner = Arc::clone(&state.inner);
    let worker_expected = expected.clone();
    let worker_scopes = scope_state.clone();
    let id = client_message_id;
    let sent = tauri::async_runtime::spawn_blocking(move || {
        let scope = worker_scopes.lock_expected(&worker_expected).map_err(failure)?;
        {
            let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
            let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
            if &connection.scope != scope.scope() {
                return Err(failure("account_scope_mismatch"));
            }
        }
        send_impl(&inner, "assistente".to_string(), text, id)
    })
    .await
    .map_err(|_| failure("send_failed"))?;
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    match sent {
        Ok(receipt) => {
            emit(&state.inner, DirectChatEvent::Send { receipt: receipt.clone() });
            Ok(DirectChatAttachment { outcome: "sent", display_name, code: None, receipt: Some(receipt) })
        }
        Err(error) => {
            log_chat_failure(&app_for_log, "send", error.code);
            Ok(DirectChatAttachment { outcome: "saved_not_sent", display_name, code: Some(error.code), receipt: None })
        }
    }
}

/// The last failure of each operation written to the runtime log: a read that fails every two
/// seconds writes one line, and a new one only when its code changes.
static LOGGED_CHAT_FAILURE: Mutex<[Option<(&'static str, Option<&'static str>)>; 2]> = Mutex::new([None, None]);

/// The rule the last container check stopped at, in the fixed words of `runtime_log::ATTEST_REASONS`; it
/// goes to the runtime log with the failure it explains, and nowhere else.
static ATTEST_REASON: Mutex<Option<&'static str>> = Mutex::new(None);

fn note_attest_reason(reason: &'static str) {
    if let Ok(mut said) = ATTEST_REASON.lock() {
        *said = Some(reason);
    }
}

fn log_chat_failure(app: &tauri::AppHandle, operation: &'static str, code: &'static str) {
    let slot = usize::from(operation == "send");
    let reason = if matches!(code, "local_container_not_attested" | "container_unavailable") {
        ATTEST_REASON.lock().ok().and_then(|mut said| said.take())
    } else {
        None
    };
    if let Ok(mut last) = LOGGED_CHAT_FAILURE.lock() {
        if last[slot] == Some((code, reason)) {
            return;
        }
        last[slot] = Some((code, reason));
    }
    if let Some(log) = crate::runtime_log::RuntimeLog::new(app) {
        log.record_chat_failure_because(operation, code, reason);
    }
}

/// The one gate of every write to an agent (a message, an answer, an Enter): an existing team needs
/// the full link made in this run of the app, a VPS of the person's own needs its mark. A refusal is
/// written to the runtime log, as the read-only view's own steps are.
fn refuse_writing(connection: &Connection) -> Result<(), DirectChatError> {
    let own_refusal = own_vps_write_refusal(connection);
    if link_allows_writing(connection.runtime.as_ref(), own_refusal.is_none(), |target| {
        existing_team_runtime::full_link_granted(&connection.scope, target)
    }) {
        return Ok(());
    }
    let code = own_refusal.unwrap_or("read_only_link");
    if let Some(log) = connection.app.as_ref().and_then(crate::runtime_log::RuntimeLog::new) {
        log.record_chat_refusal(code);
    }
    Err(failure(code))
}

/// Answer and Enter, in the fixed local/pinned container or through a VPS host wrapper. They have
/// no older path: a VPS wrapper without them (64) is a team to update.
fn run_answer_action(
    connection: &Connection,
    operation: ChatOperation<'_>,
    input: Option<&[u8]>,
    timeout: Duration,
    default: &'static str,
) -> Result<ProcessResult, DirectChatError> {
    if uses_pinned_chat(connection) {
        return run_chat(connection, operation, input, timeout, default);
    }
    run_wrapper_chat(connection, operation, input, timeout, default)?.ok_or_else(|| failure("chat_runtime_outdated"))
}

/// The options and the words of an answer, checked before they leave: at most 8 distinct option
/// ids of the closed alphabet, at least one of them or some words, the words at most 2000
/// characters and without NUL. The team checks them again against the question itself.
fn answer_input(choices: &[String], text: Option<&str>) -> Result<Zeroizing<Vec<u8>>, DirectChatError> {
    let words = text.map(str::trim).filter(|t| !t.is_empty());
    let distinct = choices.iter().enumerate().all(|(i, c)| !choices[..i].contains(c));
    if choices.len() > MAX_OPTIONS
        || !distinct
        || !choices.iter().all(|c| option_id(c))
        || (choices.is_empty() && words.is_none())
        || words.is_some_and(|w| w.chars().count() > MAX_ANSWER_CHARS || w.contains('\0'))
    {
        return Err(failure("invalid_request"));
    }
    let line = serde_json::to_vec(&json!({"choices": choices, "text": words})).map_err(|_| failure("invalid_request"))?;
    Ok(Zeroizing::new(line))
}

fn answer_impl(
    inner: &DirectChatInner,
    agent: &str,
    question_id: &str,
    input: &[u8],
) -> Result<DirectChatAnswerReceipt, DirectChatError> {
    let _serial = inner.send_lock.lock().map_err(|_| failure("state_failed"))?;
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    refuse_writing(connection)?;
    let result = run_answer_action(
        connection,
        ChatOperation::Answer { agent, question_id },
        Some(input),
        READ_TIMEOUT,
        "answer_failed",
    )?;
    let receipt: DirectChatAnswerReceipt = parse_json(result, "answer_failed")?;
    // A receipt for another question, or one that does not say it was taken, is no answer.
    if receipt.question_id != question_id || !receipt.accepted || !receipt.at.is_finite() {
        return Err(failure("answer_failed"));
    }
    Ok(receipt)
}

fn enter_impl(inner: &DirectChatInner, agent: &str, message_id: &str) -> Result<DirectChatReceipt, DirectChatError> {
    let _serial = inner.send_lock.lock().map_err(|_| failure("state_failed"))?;
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    refuse_writing(connection)?;
    // The ids were checked here: a 120 from the script is an image without the operation.
    let result = run_answer_action(connection, ChatOperation::Enter { agent, message_id }, None, SEND_TIMEOUT, "send_failed")
        .map_err(|error| if error.code == "invalid_request" { failure("chat_runtime_outdated") } else { error })?;
    let receipt: DirectChatReceipt = parse_json(result, "send_verify_failed")?;
    // The receipt of another message, or one that says nothing of the composer, proves nothing.
    if receipt.message_id != message_id || !receipt.accepted || receipt.taken.is_none() {
        return Err(failure("send_verify_failed"));
    }
    Ok(receipt)
}

/// The most a fixed script of the app may answer in one go: pages are about a megabyte, so this is far past one.
const TEAM_SCRIPT_REPLY_MAX: usize = 4 * 1024 * 1024;

/// One read of the team through the chat's Python channel (this computer's team, an existing team's pinned
/// container, the VPS the app made): a fixed script of the app, one JSON request, one JSON reply. It is a
/// read, so it asks for no write gate and works in the read-only view; it needs the chat connected.
pub(crate) async fn team_script_read(
    state: &State<'_, DirectChatState>,
    scopes: &State<'_, AccountScopeState>,
    script: &'static str,
    request: Value,
    timeout: Duration,
) -> Result<Value, DirectChatError> {
    chat_write(
        state,
        scopes,
        move |inner| {
            let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
            let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
            let result = run_python(connection, script, &request, timeout)?;
            if result.stdout.len() > TEAM_SCRIPT_REPLY_MAX {
                return Err(failure("read_failed"));
            }
            parse_json(result, "read_failed")
        },
        "read_failed",
    )
    .await
}

/// The same fixed-script channel for a change the person asked for (clearing their statistics): it is a write,
/// so the read-only view and a link that cannot write are refused here, in the native side, before anything runs.
pub(crate) async fn team_script_write(
    state: &State<'_, DirectChatState>,
    scopes: &State<'_, AccountScopeState>,
    script: &'static str,
    request: Value,
    timeout: Duration,
) -> Result<Value, DirectChatError> {
    chat_write(
        state,
        scopes,
        move |inner| {
            let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
            let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
            refuse_writing(connection)?;
            let result = run_python(connection, script, &request, timeout)?;
            if result.stdout.len() > TEAM_SCRIPT_REPLY_MAX {
                return Err(failure("read_failed"));
            }
            parse_json(result, "read_failed")
        },
        "read_failed",
    )
    .await
}

/// Runs a write of the chat on the worker, in the account scope the page asked it in.
async fn chat_write<T: Send + 'static>(
    state: &State<'_, DirectChatState>,
    scopes: &State<'_, AccountScopeState>,
    work: impl FnOnce(&DirectChatInner) -> Result<T, DirectChatError> + Send + 'static,
    default: &'static str,
) -> Result<T, DirectChatError> {
    let expected = scopes.active().map_err(failure)?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let inner = Arc::clone(&state.inner);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state.lock_expected(&worker_expected).map_err(failure)?;
        {
            let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
            let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
            if &connection.scope != scope.scope() {
                return Err(failure("account_scope_mismatch"));
            }
        }
        work(&inner)
    })
    .await
    .map_err(|_| failure(default))?;
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

/// What an answer may ask, checked before anything else: first the window (only the app's own may
/// write to an agent), then the agent, the question and the options and words.
fn answer_request(
    window: &str,
    agent: &str,
    question_id: &str,
    choices: &[String],
    text: Option<&str>,
) -> Result<Zeroizing<Vec<u8>>, DirectChatError> {
    if !window_may_write(window) || !valid_agent(agent) || !existing_team_runtime::chat_question_id(question_id) {
        return Err(failure("invalid_request"));
    }
    answer_input(choices, text)
}

/// The same for an Enter: the window first, then the agent and the message's id.
fn enter_request(window: &str, agent: &str, message_id: &str) -> Result<(), DirectChatError> {
    let well_formed = !message_id.is_empty()
        && message_id.len() <= 64
        && message_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    if !window_may_write(window) || !valid_agent(agent) || !well_formed {
        return Err(failure("invalid_request"));
    }
    Ok(())
}

/// The person's answer to one of the agent's questions: the ids of the options taken and, where the
/// question takes them, words. Only the app's own window may answer, as only it may send.
#[tauri::command]
pub(crate) async fn direct_chat_answer(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    question_id: String,
    choices: Vec<String>,
    text: Option<String>,
) -> Result<DirectChatAnswerReceipt, DirectChatError> {
    let input = answer_request(window.label(), &agent_id, &question_id, &choices, text.as_deref())?;
    let result = chat_write(
        &state,
        &scopes,
        move |inner| answer_impl(inner, &agent_id, &question_id, &input),
        "answer_failed",
    )
    .await;
    if let Err(error) = &result {
        emit(&state.inner, DirectChatEvent::Error { operation: "answer", code: error.code });
    }
    result
}

/// Enter pressed once more on a message the agent's CLI did not take, never the text again: the
/// team presses only if that message is still in the composer, and says what it saw.
#[tauri::command]
pub(crate) async fn direct_chat_enter(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    message_id: String,
) -> Result<DirectChatReceipt, DirectChatError> {
    enter_request(window.label(), &agent_id, &message_id)?;
    let result = chat_write(&state, &scopes, move |inner| enter_impl(inner, &agent_id, &message_id), "send_failed").await;
    match &result {
        Ok(receipt) => emit(&state.inner, DirectChatEvent::Send { receipt: receipt.clone() }),
        Err(error) => emit(&state.inner, DirectChatEvent::Error { operation: "enter", code: error.code }),
    }
    result
}

const TEAM_LANGUAGES: [&str; 7] = ["en", "it", "hu", "es", "de", "fr", "pt"];

/// The language the team speaks (`locale`), what its file says (`stored`, none while the file is
/// missing or unreadable) and, after a `set`, whether it was written (`changed`).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct TeamLanguage {
    locale: String,
    stored: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    changed: Option<bool>,
}

/// A reply of the script is trusted only for what it is: one of the seven languages, in both fields.
fn checked_team_language(reply: TeamLanguage) -> Option<TeamLanguage> {
    let known = |code: &str| TEAM_LANGUAGES.contains(&code);
    (known(&reply.locale) && reply.stored.as_deref().map_or(true, known)).then_some(reply)
}

fn team_language_impl(
    inner: &DirectChatInner,
    request: Value,
    write: bool,
    default: &'static str,
) -> Result<TeamLanguage, DirectChatError> {
    let _serial = inner.send_lock.lock().map_err(|_| failure("state_failed"))?;
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    if write {
        refuse_writing(connection)?;
    }
    let reply: TeamLanguage = parse_json(run_python(connection, TEAM_LANGUAGE_PY, &request, READ_TIMEOUT)?, default)?;
    checked_team_language(reply).ok_or_else(|| failure(default))
}

/// The language of the team this chat is connected to. Read only: it works in the read-only view too.
#[tauri::command]
pub(crate) async fn direct_chat_team_language(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<TeamLanguage, DirectChatError> {
    chat_write(
        &state,
        &scopes,
        |inner| team_language_impl(inner, json!({"op": "read"}), false, "read_failed"),
        "read_failed",
    )
    .await
}

/// Sets the team's language, once, while it is still the English it starts with: through the same
/// file the game's language setting writes. A language the person already chose is never replaced
/// (`changed: false`). Only the app's own window may ask, and a team the app may not write to
/// (the read-only view, a VPS not yet claimed) refuses as every other write does.
#[tauri::command]
pub(crate) async fn direct_chat_team_language_set(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    locale: String,
) -> Result<TeamLanguage, DirectChatError> {
    if !window_may_write(window.label()) || !TEAM_LANGUAGES.contains(&locale.as_str()) {
        return Err(failure("invalid_request"));
    }
    chat_write(
        &state,
        &scopes,
        move |inner| team_language_impl(inner, json!({"op": "set", "locale": locale}), true, "persist_failed"),
        "persist_failed",
    )
    .await
}

#[tauri::command]
pub(crate) fn direct_chat_close(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<(), DirectChatError> {
    let scope = scopes.lock_active().map_err(failure)?;
    let mut slot = state
        .inner
        .connection
        .lock()
        .map_err(|_| failure("state_failed"))?;
    if slot
        .as_ref()
        .is_some_and(|connection| &connection.scope != scope.scope())
    {
        return Err(failure("account_scope_mismatch"));
    }
    if let Some(mut connection) = slot.take() {
        close_connection(&mut connection);
    }
    emit(
        &state.inner,
        DirectChatEvent::Status {
            status: status("disconnected", None),
        },
    );
    Ok(())
}

pub(crate) fn teardown(state: &DirectChatState) {
    existing_team_runtime::revoke_full_link();
    if let Ok(mut slot) = state.inner.connection.lock() {
        if let Some(mut connection) = slot.take() {
            close_connection(&mut connection);
        }
    }
    if let Ok(mut subscribers) = state.inner.subscribers.lock() {
        subscribers.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        answer_input, answer_request, enter_request, chat_failure, connection_config_path_at, remote_wrapper_command, wrapper_outcome, delivery_command, hex_encode, link_allows_writing,
        parse_json, probe, session_for, status, valid_agent, verify_migration_local_host_at, window_may_write,
        Connection, DirectChatPage, DirectChatReceipt, ProcessResult, REMOTE_CONTAINER_PROBE, REMOTE_PYTHON_STDIN, UNKNOWN_ACTION,
        control_path_fits, remove_tunnel_socket, tunnel_dir_name, tunnel_socket_bases, tunnel_socket_path,
        SOCKET_PATH_MAX, SSH_SOCKET_SUFFIX,
        open_vps_link, ready_status, small_read, vps_link_for, VpsLink, VPS_LINK_CHECK, SMALL_READ_OVERLAP,
        SMALL_READ_SIZE_PROBE, SMALL_READ_TAIL, DirectChatError, local_chat_exec_args,
        local_compose_args, local_engine_removed_environment, LocalChatEngine, podman_systemd_unit, windows_container_labels_are_attested, engine_lost_the_container, windows_container_image_is_the_runtimes, split_inspected, windows_path_key,
        run_connection, run_local_chat, RemoteOperation,
        master_to_lend,
    };
    #[cfg(unix)]
    use super::{attested_exec_args, AttestedLocalTeam};
    #[cfg(unix)]
    use super::{attest_reason_may_pass, attestation_refusal, container_not_found_code, mac_config_hash_in};
    #[cfg(all(unix, not(target_os = "macos")))]
    use super::local_chat_runtime_valid;
    use crate::existing_team_runtime::ActivatedTarget;
    use crate::runtime_host::{ExecutionHost, ValidatedHost};
    use std::{fs, path::{Path, PathBuf}, process::Command, time::Duration};

    #[cfg(unix)]
    fn write_valid_local_podman_manifest(runtime: &Path, wrapper: &Path) {
        fs::write(runtime.join("host-setup.sh"), "#!/bin/sh\nJHT_HOST_SETUP_PROTOCOL=1\nexit 0\n").unwrap();
        write_local_podman_manifest(runtime, wrapper);
    }

    #[cfg(unix)]
    fn write_local_podman_manifest(runtime: &Path, wrapper: &Path) {
        use sha2::{Digest, Sha256};

        let digest = |path: &Path| format!("{:x}", Sha256::digest(fs::read(path).unwrap()));
        let mut lines = vec![
            "version=1".to_owned(),
            format!("docker-compose.yml={}", digest(&runtime.join("docker-compose.yml"))),
            format!("host-setup.sh={}", digest(&runtime.join("host-setup.sh"))),
            format!("jht-wrapper.sh={}", digest(wrapper)),
            format!("container-runtime={}", digest(&runtime.join("container-runtime"))),
            format!("docker-shim={}", digest(&runtime.join("bin/docker"))),
        ];
        #[cfg(target_os = "macos")]
        {
            fs::write(runtime.join("podman-machine"), "jht-podman\n").unwrap();
            lines.push(format!("podman-machine={}", digest(&runtime.join("podman-machine"))));
        }
        fs::write(runtime.join(".runtime-integrity"), format!("{}\n", lines.join("\n"))).unwrap();
    }

    /// The shape and length of macOS's per-user temporary folder (getconf DARWIN_USER_TEMP_DIR):
    /// /var/folders/<2>/<30>/T/, 49 characters. Placeholders, not a real one.
    const MACOS_TMPDIR: &str = "/var/folders/xx/xxxxxxxxxxxxxxxxxxxxxxxx0000gn/T/";

    #[test]
    fn the_tunnel_socket_fits_with_sshs_temporary_name_even_in_macos_long_tmpdir() {
        assert_eq!(MACOS_TMPDIR.len(), 49);
        // the old name, in a macOS TMPDIR: 95 characters, 112 with ssh's suffix
        let old = std::path::Path::new(MACOS_TMPDIR).join("jht-direct-chat-12345-1792703033508090000.sock");
        assert!(!control_path_fits(&old), "the old socket path must be the one that does not fit");
        // the new one, made of the same pieces open_tunnel uses
        let new = std::path::Path::new(MACOS_TMPDIR).join(format!("jc{}", tunnel_dir_name())).join("s");
        assert!(control_path_fits(&new), "{} characters", new.as_os_str().len());
        assert!(new.as_os_str().len() + SSH_SOCKET_SUFFIX <= SOCKET_PATH_MAX);
        assert_eq!(SOCKET_PATH_MAX, 103, "macOS: sun_path is 104 bytes with its NUL");
    }

    #[test]
    fn on_unix_the_tunnel_socket_stays_under_half_the_limit_in_tmp_before_the_tmpdir() {
        let bases = tunnel_socket_bases();
        #[cfg(unix)]
        {
            assert_eq!(bases[0], std::path::Path::new("/tmp"));
            let socket = bases[0].join(format!("jc{}", tunnel_dir_name())).join("s");
            assert!(socket.as_os_str().len() + SSH_SOCKET_SUFFIX <= SOCKET_PATH_MAX / 2, "{}", socket.display());
        }
        assert_eq!(bases.last().unwrap(), &std::env::temp_dir(), "the user's temporary folder is the fallback");
    }

    #[test]
    fn the_tunnel_socket_is_alone_in_a_private_folder_of_its_own_and_goes_with_it() {
        let base = std::env::temp_dir().join(format!("jht-tunnel-test-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let socket = tunnel_socket_path(std::slice::from_ref(&base), tunnel_dir_name).expect("a socket path");
        let dir = socket.parent().unwrap().to_owned();
        assert_eq!(dir.parent().unwrap(), base);
        assert!(socket.ends_with("s") && control_path_fits(&socket));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        }
        // a folder someone prepared with the same name is never used: another name is tried
        let mut names = vec!["taken000".to_owned(), "free0000".to_owned()].into_iter();
        fs::create_dir(base.join("jctaken000")).unwrap();
        let other = tunnel_socket_path(std::slice::from_ref(&base), || names.next().unwrap()).unwrap();
        assert_eq!(other, base.join("jcfree0000").join("s"));
        // closing removes the socket and its folder, never a folder that is not ours
        fs::write(&socket, b"").unwrap();
        remove_tunnel_socket(&socket);
        assert!(!dir.exists());
        let foreign = base.join("other").join("s");
        fs::create_dir_all(foreign.parent().unwrap()).unwrap();
        remove_tunnel_socket(&foreign);
        assert!(foreign.parent().unwrap().exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_base_too_long_for_a_socket_is_skipped_for_the_next_one() {
        let long = std::path::PathBuf::from(format!("/{}", "x".repeat(100)));
        let base = std::env::temp_dir().join(format!("jht-tunnel-next-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let socket = tunnel_socket_path(&[long.clone(), base.clone()], tunnel_dir_name).unwrap();
        assert!(socket.starts_with(&base));
        assert_eq!(tunnel_socket_path(&[long], tunnel_dir_name), Err("tunnel_path_unavailable"));
        let _ = fs::remove_dir_all(&base);
    }

    fn synthetic_vps() -> ValidatedHost {
        ValidatedHost::Vps {
            address: "test-host".into(),
            user: "test".into(),
            port: 22,
            key_path: "/private/synthetic-key".into(),
            known_hosts: "/private/synthetic-known-hosts".into(),
        }
    }

    fn exited(code: i32) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult { code, stdout: Vec::new() })
    }

    /// Win32-OpenSSH has no ControlMaster (T69): on Windows a VPS is reached one connection per command.
    #[test]
    fn only_windows_reaches_a_vps_one_connection_per_command() {
        assert_eq!(vps_link_for("windows"), VpsLink::PerCommand);
        for os in ["macos", "linux", "freebsd"] {
            assert_eq!(vps_link_for(os), VpsLink::Master, "{os}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn this_windows_build_never_opens_an_ssh_master() {
        assert_eq!(vps_link_for(std::env::consts::OS), VpsLink::PerCommand);
    }

    /// Without a master the link is one ssh that answers, with the master's own errors; there is no
    /// socket and no process to keep or to close.
    #[test]
    fn a_per_command_link_is_one_ssh_that_answers_with_the_masters_errors() {
        let host = synthetic_vps();
        let mut asked = Vec::new();
        let opened = open_vps_link(&host, VpsLink::PerCommand, |checked| {
            asked.push(matches!(checked, ValidatedHost::Vps { .. }));
            exited(0)
        })
        .expect("an ssh that answers is a link");
        assert!(opened.0.is_none() && opened.1.is_none());
        assert_eq!(asked, [true]);
        for (outcome, code) in [
            (exited(255), "tunnel_verify_failed"),
            (exited(1), "tunnel_verify_failed"),
            (Err("process_timeout"), "tunnel_verify_failed"),
            (Err("ssh_client_missing"), "tunnel_verify_failed"),
            (Err("ssh_rate_limited"), "ssh_rate_limited"),
        ] {
            let error = open_vps_link(&host, VpsLink::PerCommand, |_| outcome).unwrap_err();
            assert_eq!(error.code, code);
        }
        // the check is a command every remote shell runs the same way
        assert_eq!(VPS_LINK_CHECK, "exit 0");
    }

    /// A lent socket is used only while its folder is still the chat's: a real folder of this user,
    /// 0700, with the chat's prefix. Another owner, a folder open to others, a link or another name:
    /// a connection of its own.
    #[cfg(unix)]
    #[test]
    fn a_lent_socket_must_sit_in_a_folder_still_the_chats() {
        use super::{lent_socket_still_ours, socket_folder_owned_by};
        use std::os::unix::fs::PermissionsExt;
        let base = std::env::temp_dir().join(format!("jht-lend-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        // SAFETY: geteuid has no arguments or pointers.
        let me = unsafe { libc::geteuid() };
        let ours = base.join("jcabcdef0123");
        fs::create_dir(&ours).unwrap();
        fs::set_permissions(&ours, fs::Permissions::from_mode(0o700)).unwrap();
        let socket = ours.join("s");
        assert!(socket_folder_owned_by(&socket, me));
        assert!(lent_socket_still_ours(&socket));
        assert!(!socket_folder_owned_by(&socket, me.wrapping_add(1)), "another owner");

        fs::set_permissions(&ours, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(!lent_socket_still_ours(&socket), "a folder others can read");
        fs::set_permissions(&ours, fs::Permissions::from_mode(0o700)).unwrap();

        let link = base.join("jclinkxyz");
        std::os::unix::fs::symlink(&ours, &link).unwrap();
        assert!(!lent_socket_still_ours(&link.join("s")), "a link to a folder of ours");

        let named = base.join("other0123");
        fs::create_dir(&named).unwrap();
        fs::set_permissions(&named, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(!lent_socket_still_ours(&named.join("s")), "not the chat's name");

        assert!(!lent_socket_still_ours(&base.join("jcgone").join("s")), "a folder that is gone");
        assert!(!lent_socket_still_ours(Path::new("s")), "no folder");
        fs::remove_dir_all(&base).unwrap();
    }

    /// The terminal of the agents' panel reads through the chat's master only when the chat is
    /// connected in the same account, on the master link, to the very same VPS and team. Unix only:
    /// a test that builds a Connection does (see only_unix_tests_build_a_connection), and the chat
    /// has no master to lend on Windows.
    #[cfg(unix)]
    #[test]
    fn the_chats_master_is_lent_only_to_the_same_account_vps_and_team() {
        let scope = crate::account_scope::AccountScope::synthetic(b"synthetic-account-lend");
        let other_scope = crate::account_scope::AccountScope::synthetic(b"synthetic-account-other");
        let socket = PathBuf::from("/nonexistent-jht-test/master.sock");
        let team = ActivatedTarget::synthetic_for_tests();
        let chat = |runtime: Option<ActivatedTarget>, link: VpsLink, validated: ValidatedHost| {
            Connection {
                app: None,
                scope: scope.clone(),
                host: ExecutionHost::Local,
                validated,
                runtime,
                local_wrapper: None,
                local_runtime: None,
                local_owner_marker: None,
                control_path: Some(socket.clone()),
                tunnel: None,
                link,
            }
        };
        let same_team = Some((team.team_id.as_str(), &team.runtime));
        let mut connections = Vec::new();

        // the VPS the app set up: no pinned team on either side
        let own = chat(None, VpsLink::Master, synthetic_vps());
        assert_eq!(
            master_to_lend(Some(&own), &scope, &synthetic_vps(), None),
            Some(socket.clone())
        );
        assert_eq!(
            master_to_lend(Some(&own), &other_scope, &synthetic_vps(), None),
            None,
            "another account"
        );
        assert_eq!(
            master_to_lend(Some(&own), &scope, &synthetic_vps(), same_team),
            None,
            "the chat is not on that team"
        );
        assert_eq!(
            master_to_lend(None, &scope, &synthetic_vps(), None),
            None,
            "no chat"
        );
        assert_eq!(
            master_to_lend(Some(&own), &scope, &ValidatedHost::Local, None),
            None,
            "this computer"
        );
        let changed =
            |edit: &dyn Fn(&mut String, &mut String, &mut u16, &mut PathBuf, &mut PathBuf)| {
                let ValidatedHost::Vps {
                    mut address,
                    mut user,
                    mut port,
                    mut key_path,
                    mut known_hosts,
                } = synthetic_vps()
                else {
                    unreachable!()
                };
                edit(
                    &mut address,
                    &mut user,
                    &mut port,
                    &mut key_path,
                    &mut known_hosts,
                );
                ValidatedHost::Vps {
                    address,
                    user,
                    port,
                    key_path,
                    known_hosts,
                }
            };
        for (what, host) in [
            (
                "address",
                changed(&|a, _, _, _, _| *a = "other-host".into()),
            ),
            ("user", changed(&|_, u, _, _, _| *u = "root".into())),
            ("port", changed(&|_, _, p, _, _| *p = 2222)),
            (
                "key",
                changed(&|_, _, _, k, _| *k = "/private/other-key".into()),
            ),
            (
                "pinned host key",
                changed(&|_, _, _, _, h| *h = "/private/other-known-hosts".into()),
            ),
        ] {
            assert_eq!(
                master_to_lend(Some(&own), &scope, &host, None),
                None,
                "another {what}"
            );
        }
        connections.push(own);

        // an existing team: the same pinned container, or nothing
        let existing = chat(Some(team.clone()), VpsLink::Master, synthetic_vps());
        assert_eq!(
            master_to_lend(Some(&existing), &scope, &synthetic_vps(), same_team),
            Some(socket.clone())
        );
        assert_eq!(
            master_to_lend(Some(&existing), &scope, &synthetic_vps(), None),
            None
        );
        let other_id = "u".repeat(16);
        assert_eq!(
            master_to_lend(
                Some(&existing),
                &scope,
                &synthetic_vps(),
                Some((other_id.as_str(), &team.runtime))
            ),
            None
        );
        let mut other_runtime = team.runtime.clone();
        other_runtime.container_id = "9".repeat(64);
        assert_eq!(
            master_to_lend(
                Some(&existing),
                &scope,
                &synthetic_vps(),
                Some((team.team_id.as_str(), &other_runtime))
            ),
            None
        );
        connections.push(existing);

        // Windows: no master to lend
        let per_command = chat(None, VpsLink::PerCommand, synthetic_vps());
        assert_eq!(
            master_to_lend(Some(&per_command), &scope, &synthetic_vps(), None),
            None
        );
        connections.push(per_command);
        // a chat without its socket lends nothing
        let mut no_socket = chat(None, VpsLink::Master, synthetic_vps());
        no_socket.control_path = None;
        assert_eq!(
            master_to_lend(Some(&no_socket), &scope, &synthetic_vps(), None),
            None
        );
        connections.push(no_socket);

        // nothing to close: these masters never existed
        for mut connection in connections {
            connection.control_path = None;
        }
    }

    /// The page reads every 5 s instead of 1.5 only when each read is a new ssh connection.
    #[test]
    fn only_a_vps_reached_per_command_is_ready_with_a_slow_link() {
        assert_eq!(
            serde_json::to_value(ready_status(&synthetic_vps(), VpsLink::PerCommand)).unwrap(),
            serde_json::json!({"state": "ready", "link": "per-command"})
        );
        assert_eq!(serde_json::to_value(ready_status(&synthetic_vps(), VpsLink::Master)).unwrap(), serde_json::json!({"state": "ready"}));
        assert_eq!(
            serde_json::to_value(ready_status(&ValidatedHost::Local, VpsLink::PerCommand)).unwrap(),
            serde_json::json!({"state": "ready"})
        );
        // the status of a ready connection is this one
        let source = include_str!("direct_chat.rs").split("mod tests {").next().unwrap();
        assert!(source.contains("fn ready_for(connection: &Connection) -> DirectChatStatus {\n    ready_status(&connection.validated, connection.link)\n}"));
    }

    /// What a small read asks the server, and in what order.
    fn small_reads(cursor: Option<&str>, answers: &[Option<&str>]) -> (Result<Option<String>, &'static str>, Vec<String>) {
        let mut asked = Vec::new();
        let mut answers = answers.iter();
        let result = small_read(cursor, &mut |sent: Option<&str>| -> Result<DirectChatPage, DirectChatError> {
            asked.push(sent.unwrap_or("none").to_owned());
            Ok(DirectChatPage { messages: Vec::new(), cursor: answers.next().expect("one answer per read").map(str::to_owned), questions: None, queued: None, settled: None, activity: None })
        });
        (result.map(|page| page.cursor).map_err(|error| error.code), asked)
    }

    #[test]
    fn a_first_small_read_asks_the_size_then_the_last_32_kib() {
        assert_eq!((SMALL_READ_TAIL, SMALL_READ_OVERLAP, SMALL_READ_SIZE_PROBE), (32_768, 20_480, "999999999999"));
        assert_eq!(small_reads(None, &[Some("500000"), Some("500000")]), (Ok(Some("500000".into())), vec!["999999999999".into(), "467232".into()]));
        // a chat shorter than the tail is read whole, from 0
        assert_eq!(small_reads(None, &[Some("1200"), Some("1200")]).1, ["999999999999", "0"]);
        // a size the server does not give is a failed read, not a read from 0
        assert_eq!(small_reads(None, &[None]).0, Err("read_failed"));
    }

    #[test]
    fn a_later_small_read_starts_20_kib_before_the_cursor_and_a_shorter_chat_starts_again() {
        assert_eq!(small_reads(Some("500000"), &[Some("501000")]), (Ok(Some("501000".into())), vec!["479520".into()]));
        assert_eq!(small_reads(Some("9000"), &[Some("9000")]).1, ["0"], "never below 0");
        // the chat got shorter than where the read started: the size, then the tail
        assert_eq!(
            small_reads(Some("500000"), &[Some("4000"), Some("4000"), Some("4000")]).1,
            ["479520", "999999999999", "0"]
        );
        // a cursor that is not a number is a first read
        assert_eq!(small_reads(Some("x"), &[Some("10"), Some("10")]).1, ["999999999999", "0"]);
    }

    #[test]
    fn only_the_per_command_link_to_a_vps_reads_small() {
        let source = include_str!("direct_chat.rs").split("mod tests {").next().unwrap();
        let read = source.split("pub(crate) async fn direct_chat_read(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(read.contains("if connection.link == VpsLink::PerCommand && matches!(connection.validated, ValidatedHost::Vps { .. }) {\n            return small_read(cursor.as_deref(), &mut |cursor| read_page(connection, &agent_id, cursor));"));
        assert!(read.contains("read_page(connection, &agent_id, cursor.as_deref())"), "every other link reads as before");
    }

    /// A test that builds a `Connection` drops it, and with it its `Option<AppHandle>`: that drop glue
    /// links Tauri's window runtime into the test binary, whose comctl32 v6 imports a test binary
    /// (no application manifest) cannot resolve on Windows. The binary died at start with
    /// STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) and no test ran. So a test that builds one runs on Unix only.
    #[test]
    fn only_unix_tests_build_a_connection() {
        let tests = include_str!("direct_chat.rs").split_once("mod tests {").unwrap().1;
        let mut built = 0;
        // the needles in two pieces, so this very test is not one of the places it finds; the chat's state
        // holds a Connection, so building it drops one just the same
        for needle in [concat!("Connection", " {"), concat!("DirectChatInner", "::default()"), concat!("DirectChatState", "::default()")] {
            for (at, _) in tests.match_indices(needle) {
                built += 1;
                let test_start = tests[..at].rfind("#[test]").expect("inside a test");
                let attributes = &tests[..test_start];
                let attributes = &attributes[attributes.rfind('\n').map_or(0, |line| attributes[..line].rfind('\n').unwrap_or(0))..];
                assert!(attributes.contains("#[cfg(unix)]"), "{needle} built outside a Unix-only test, before byte {at}");
            }
        }
        assert!(built >= 1, "the Unix probe test builds one");
    }

    #[test]
    fn every_exit_of_the_chat_script_is_a_code_of_the_catalog_and_the_link_losing_is_its_own() {
        for (code, expected) in [
            (2, "chat_runtime_outdated"),
            (70, "existing_team_runtime_target_changed"),
            (119, "agent_not_at_prompt"),
            (120, "invalid_request"),
            (121, "team_not_running"),
            (122, "agent_not_running"),
            (123, "agent_unavailable"),
            (124, "agent_busy"),
            (125, "agent_stuck"),
            (126, "send_failed"),
            (127, "read_failed"),
            (128, "persist_failed"),
            (129, "chat_runtime_outdated"),
            (130, "composer_has_text"),
            (114, "chat_runtime_outdated"),
            (115, "answer_failed"),
            (116, "not_found"),
            (117, "invalid_choice"),
            (118, "question_closed"),
            (130, "composer_has_text"),
            (255, "tunnel_unavailable"),
            (1, "the_default"),
            (137, "the_default"),
        ] {
            assert_eq!(chat_failure(code, "the_default"), expected, "exit {code}");
        }
    }

    #[test]
    fn an_older_wrapper_that_does_not_know_the_chat_actions_keeps_the_older_path() {
        let answered = |code: i32| ProcessResult {
            code,
            stdout: b"{}".to_vec(),
        };
        assert!(
            matches!(
                wrapper_outcome(answered(0), "read_failed", false),
                Ok(Some(_))
            ),
            "the script ran"
        );
        assert!(
            matches!(
                wrapper_outcome(answered(64), "read_failed", false),
                Ok(None)
            ),
            "64: no chat actions, keep the older path"
        );
        for (code, expected) in [
            (2, "chat_runtime_outdated"),
            (124, "agent_busy"),
            (122, "agent_not_running"),
            (119, "agent_not_at_prompt"),
            (129, "chat_runtime_outdated"),
            (130, "composer_has_text"),
            (1, "read_failed"),
            (255, "tunnel_unavailable"),
        ] {
            assert_eq!(
                wrapper_outcome(answered(code), "read_failed", false)
                    .err()
                    .map(|error| error.code),
                Some(expected),
                "exit {code}"
            );
        }
        for code in [2, 64] {
            assert_eq!(
                wrapper_outcome(answered(code), "read_failed", true)
                    .err()
                    .map(|error| error.code),
                Some("local_chat_wrapper_outdated"),
                "local exit {code}"
            );
        }
    }

    #[test]
    fn local_chat_builds_all_four_checked_python_commands_without_a_wrapper() {
        use crate::existing_team_runtime::ChatOperation;

        let container = "a".repeat(64);
        let command = |operation| {
            local_chat_exec_args(&container, &operation)
                .unwrap()
                .into_iter()
                .map(|part| part.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            command(ChatOperation::Read {
                agent: "capitano",
                cursor: Some("12")
            }),
            [
                "exec",
                "-i",
                container.as_str(),
                "python3",
                "-I",
                "/app/shared/skills/agent_chat.py",
                "read",
                "capitano",
                "12"
            ]
        );
        assert_eq!(
            command(ChatOperation::Send {
                agent: "assistente",
                client_message_id: "id-1"
            })[6..],
            ["send", "assistente", "id-1"]
        );
        assert_eq!(
            command(ChatOperation::Answer {
                agent: "mentor",
                question_id: "aq:mentor:1-a"
            })[6..],
            ["answer", "mentor", "aq:mentor:1-a"]
        );
        assert_eq!(
            command(ChatOperation::Enter {
                agent: "critico",
                message_id: "message-1"
            })[6..],
            ["enter", "critico", "message-1"]
        );
        assert!(local_chat_exec_args(
            &container,
            &ChatOperation::Send {
                agent: "root",
                client_message_id: "id"
            }
        )
        .is_err());
        assert!(local_chat_exec_args(
            &container,
            &ChatOperation::Read {
                agent: "capitano",
                cursor: Some("12x")
            }
        )
        .is_err());
    }

    /// The labels of the Windows team's container as Compose v2 over the Podman socket writes them
    /// (a real container of the test machine, user name replaced): no `io.podman.compose.*` at all.
    fn windows_labels(dir: &str) -> serde_json::Value {
        serde_json::json!({
            "com.docker.compose.config-hash": "0e323430cfa29d71530d1c29a09cd8e167306d7a4e019eb2bd2f1c06b88db07f",
            "com.docker.compose.container-number": "1",
            "com.docker.compose.oneoff": "False",
            "com.docker.compose.project": "jht",
            "com.docker.compose.project.config_files": format!("{dir}\\docker-compose.yml,{dir}\\docker-compose.podman.yml"),
            "com.docker.compose.project.working_dir": dir,
            "com.docker.compose.service": "jht",
            "com.docker.compose.version": "5.1.2",
        })
    }

    #[test]
    fn the_windows_container_is_attested_by_the_compose_labels_it_really_has() {
        let dir = r"C:\Users\someone\AppData\Local\Job Hunter Team\host-runtime";
        let runtime = PathBuf::from(dir);
        assert!(windows_container_labels_are_attested(&windows_labels(dir), &runtime));
        // the spelling of the path does not matter: case, slashes, a `\\?\` prefix, a trailing separator
        let spelled = r"c:/users/SOMEONE/appdata/local/job hunter team/host-runtime";
        let mut trailing = windows_labels(spelled);
        trailing["com.docker.compose.project.working_dir"] = format!("{spelled}/").into();
        assert!(windows_container_labels_are_attested(&trailing, &runtime));
        assert!(windows_container_labels_are_attested(&windows_labels(spelled), &runtime));
        assert!(windows_container_labels_are_attested(&windows_labels(&format!(r"\\?\{dir}")), &runtime));
    }

    #[test]
    fn a_windows_profile_name_with_accents_is_the_same_in_capitals() {
        let dir = r"C:\Users\Élodie Müller\AppData\Local\Job Hunter Team\host-runtime";
        let runtime = PathBuf::from(dir);
        assert_eq!(windows_path_key(dir), windows_path_key(&dir.to_uppercase()));
        assert!(windows_container_labels_are_attested(&windows_labels(&dir.to_uppercase()), &runtime));
        assert!(windows_container_labels_are_attested(&windows_labels(&dir.to_lowercase()), &runtime));
    }

    #[cfg(unix)]
    #[test]
    fn a_runtime_reached_by_another_name_is_the_same_directory_for_the_labels() {
        // On Windows a short 8.3 name and the long one; here a link: the labels hold the resolved one.
        let base = std::env::temp_dir().canonicalize().unwrap().join(format!("jht-runtime-alias-{}", std::process::id()));
        let real = base.join("long-name");
        fs::create_dir_all(&real).unwrap();
        let alias = base.join("SHORT~1");
        std::os::unix::fs::symlink(&real, &alias).unwrap();
        let labels = windows_labels(&real.to_string_lossy());
        // the labels' separators are backslashes in the helper: build them with the real path's own
        let mut labels = labels;
        labels["com.docker.compose.project.config_files"] =
            format!("{}/docker-compose.yml,{}/docker-compose.podman.yml", real.display(), real.display()).into();
        assert!(windows_container_labels_are_attested(&labels, &alias));
        assert!(!windows_container_labels_are_attested(&labels, &base.join("elsewhere")));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn the_windows_container_must_come_from_the_image_the_runtime_pins() {
        let pin = format!("ghcr.io/leopu00/jht@sha256:{}", "a".repeat(64));
        let other = format!("ghcr.io/leopu00/jht@sha256:{}", "b".repeat(64));
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!("jht-image-pin-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        // no pin file: any digest of the repository, nothing else
        assert!(windows_container_image_is_the_runtimes(&pin, &root));
        for image in ["ghcr.io/leopu00/jht:dev-1", "docker.io/library/alpine@sha256:aaaa", "sha256:aaaa", "", &format!("ghcr.io/leopu00/jht@sha256:{}", "A".repeat(64))] {
            assert!(!windows_container_image_is_the_runtimes(image, &root), "{image}");
        }
        // a pin file: exactly its reference
        fs::write(root.join("runtime-image"), format!("{pin}\n")).unwrap();
        assert!(windows_container_image_is_the_runtimes(&pin, &root));
        assert!(!windows_container_image_is_the_runtimes(&other, &root));
        // a pin that is not a reference, or without its line end, is not a pin: nothing matches it
        fs::write(root.join("runtime-image"), "ghcr.io/leopu00/jht:dev-1\n").unwrap();
        assert!(!windows_container_image_is_the_runtimes("ghcr.io/leopu00/jht:dev-1", &root));
        fs::write(root.join("runtime-image"), &pin).unwrap();
        assert!(!windows_container_image_is_the_runtimes(&pin, &root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_inspect_line_is_split_with_the_image_only_where_it_is_asked_for() {
        assert_eq!(split_inspected("true|{\"a\":\"b\"}", false), Some(("true", "{\"a\":\"b\"}", None)));
        assert_eq!(split_inspected("true|{\"a\":\"x|y\"}|ghcr.io/leopu00/jht@sha256:00", true), Some(("true", "{\"a\":\"x|y\"}", Some("ghcr.io/leopu00/jht@sha256:00"))));
        // asked for the image and not given one: not a line to trust
        assert_eq!(split_inspected("true|{}", true), None);
        assert_eq!(split_inspected("no separator", false), None);
    }

    #[test]
    fn a_windows_container_that_the_runtime_did_not_start_is_not_attested() {
        let dir = r"C:\Users\someone\AppData\Local\Job Hunter Team\host-runtime";
        let runtime = PathBuf::from(dir);
        let other = r"C:\Users\someone\Documents\host-runtime";
        let with = |key: &str, value: serde_json::Value| {
            let mut labels = windows_labels(dir);
            labels[key] = value;
            labels
        };
        for (what, labels) in [
            ("another project", with("com.docker.compose.project", "other".into())),
            ("another service", with("com.docker.compose.service", "jht-broker".into())),
            ("a second replica", with("com.docker.compose.container-number", "2".into())),
            ("another working directory", with("com.docker.compose.project.working_dir", other.into())),
            ("other compose files", windows_labels(other)),
            (
                "one more compose file",
                with(
                    "com.docker.compose.project.config_files",
                    format!("{dir}\\docker-compose.yml,{dir}\\docker-compose.podman.yml,{other}\\x.yml").into(),
                ),
            ),
            ("only the first compose file", with("com.docker.compose.project.config_files", format!("{dir}\\docker-compose.yml").into())),
            ("no working directory", {
                let mut labels = windows_labels(dir);
                labels.as_object_mut().unwrap().remove("com.docker.compose.project.working_dir");
                labels
            }),
        ] {
            assert!(!windows_container_labels_are_attested(&labels, &runtime), "{what}");
        }
    }

    #[test]
    fn only_native_linux_podman_drops_remote_connection_selectors() {
        let podman = LocalChatEngine { program: PathBuf::from("private-engine"), podman: true };
        let docker = LocalChatEngine { program: PathBuf::from("private-engine"), podman: false };
        #[cfg(all(unix, not(target_os = "macos")))]
        assert_eq!(
            local_engine_removed_environment(&podman),
            ["CONTAINER_HOST", "CONTAINER_CONNECTION"]
        );
        #[cfg(not(all(unix, not(target_os = "macos"))))]
        assert!(local_engine_removed_environment(&podman).is_empty());
        assert!(local_engine_removed_environment(&docker).is_empty());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn local_chat_refuses_rehashed_compose_or_host_setup_without_starting_an_engine() {
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-protocol-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        fs::create_dir_all(runtime.join("bin")).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(
            runtime.join("docker-compose.yml"),
            "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n",
        )
        .unwrap();
        fs::write(runtime.join("bin/docker"), "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\nexit 91\n").unwrap();
        fs::set_permissions(runtime.join("bin/docker"), fs::Permissions::from_mode(0o700)).unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(&wrapper, "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\n").unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        write_valid_local_podman_manifest(&runtime, &wrapper);
        assert!(local_chat_runtime_valid(&wrapper, &runtime));

        fs::write(runtime.join("docker-compose.yml"), "services: {}\n").unwrap();
        write_local_podman_manifest(&runtime, &wrapper);
        assert!(!local_chat_runtime_valid(&wrapper, &runtime));

        fs::write(
            runtime.join("docker-compose.yml"),
            "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n",
        )
        .unwrap();
        fs::write(runtime.join("host-setup.sh"), "#!/bin/sh\nexit 0\n").unwrap();
        write_local_podman_manifest(&runtime, &wrapper);
        assert!(!local_chat_runtime_valid(&wrapper, &runtime));

        fs::remove_dir_all(root).unwrap();
    }

    // -- the environment the wrapper runs the compose in (the chat said «the running container is not the one Job Hunter Team installed») --

    use super::wrapper_compose_environment;

    fn host_environment(file: Option<&str>, inherited: &[(&str, &str)]) -> Vec<(&'static str, String)> {
        let inherited: Vec<(String, String)> = inherited.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
        wrapper_compose_environment(file, &|key| inherited.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone()))
    }

    fn pairs(values: &[(&'static str, &str)]) -> Vec<(&'static str, String)> {
        values.iter().map(|(k, v)| (*k, (*v).to_owned())).collect()
    }

    #[test]
    fn the_compose_environment_is_host_env_then_the_inherited_one_then_the_defaults() {
        let defaults = pairs(&[("JHT_HOST_TYPE", "unknown"), ("JHT_LANG", "en"), ("JHT_USER_TZ", "UTC")]);
        assert_eq!(host_environment(None, &[]), defaults);
        assert_eq!(host_environment(Some(""), &[]), defaults);
        // what the host setup writes on a Mac
        let file = "JHT_LANG=en\nJHT_HOST_TYPE=local\nJHT_USER_TZ=Europe/Rome\n";
        assert_eq!(host_environment(Some(file), &[]), pairs(&[("JHT_HOST_TYPE", "local"), ("JHT_LANG", "en"), ("JHT_USER_TZ", "Europe/Rome")]));
        // the file wins over the inherited environment; a key the file lacks (or has invalid) takes the inherited one
        let partial = "JHT_HOST_TYPE=vps\nJHT_LANG=xx\n";
        assert_eq!(
            host_environment(Some(partial), &[("JHT_HOST_TYPE", "local"), ("JHT_LANG", "it"), ("JHT_USER_TZ", "Asia/Tokyo")]),
            pairs(&[("JHT_HOST_TYPE", "vps"), ("JHT_LANG", "it"), ("JHT_USER_TZ", "Asia/Tokyo")]),
        );
        // an empty inherited value is the default, as `${X:-default}` has it
        assert_eq!(host_environment(None, &[("JHT_LANG", "")]), defaults);
    }

    #[test]
    fn the_compose_environment_reads_host_env_as_the_wrapper_does() {
        let value = |file: &str, key: &str| host_environment(Some(file), &[]).into_iter().find(|(k, _)| *k == key).unwrap().1;
        // the last valid line wins; an invalid one never replaces a valid one
        assert_eq!(value("JHT_LANG=fr\nJHT_LANG=de\nJHT_LANG=xx\n", "JHT_LANG"), "de");
        // quotes around the whole value, spaces before the key, a carriage return at the end
        assert_eq!(value("  JHT_LANG=\"it\"\r\n", "JHT_LANG"), "it");
        assert_eq!(value("JHT_LANG='pt'\n", "JHT_LANG"), "pt");
        // a key that only starts like ours, a comment and another variable change nothing
        assert_eq!(value("JHT_LANGUAGE=it\n# JHT_LANG=it\nFOO=JHT_LANG=it\n", "JHT_LANG"), "en");
        // host type: only local or vps; time zone: only portable characters
        assert_eq!(value("JHT_HOST_TYPE=cloud\n", "JHT_HOST_TYPE"), "unknown");
        assert_eq!(value("JHT_USER_TZ=Europe/Rome; rm -rf\n", "JHT_USER_TZ"), "UTC");
        assert_eq!(value("JHT_USER_TZ=\n", "JHT_USER_TZ"), "UTC");
        assert_eq!(value("JHT_USER_TZ=Etc/GMT+1\n", "JHT_USER_TZ"), "Etc/GMT+1");
    }

    /// The layout of a Homebrew prefix under a folder of the test: `bin` with links into `Cellar/<name>/<version>/bin`,
    /// and a folder outside it. All folders 0755, as the install leaves them. (root, prefix, elsewhere)
    #[cfg(unix)]
    fn tool_layout(label: &str) -> (PathBuf, PathBuf, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!("jht-tool-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (prefix, elsewhere) = (root.join("prefix"), root.join("elsewhere"));
        for dir in [prefix.join("bin"), prefix.join("Cellar/podman/6.1.3/bin"), elsewhere.clone()] {
            fs::create_dir_all(dir).unwrap();
        }
        for dir in [&root, &prefix, &elsewhere, &prefix.join("bin"), &prefix.join("Cellar"), &prefix.join("Cellar/podman"), &prefix.join("Cellar/podman/6.1.3"), &prefix.join("Cellar/podman/6.1.3/bin")] {
            fs::set_permissions(dir, fs::Permissions::from_mode(0o755)).unwrap();
        }
        (root, prefix, elsewhere)
    }

    #[cfg(unix)]
    fn tool_program(path: &Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        fs::write(path, "#!/bin/sh\n").unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_homebrew_style_install_is_trusted_and_nothing_outside_its_roots_or_that_anyone_can_rewrite_is() {
        use super::tool_is_trusted;
        use std::os::unix::fs::symlink;
        let (root, prefix, elsewhere) = tool_layout("trust");
        let roots = [prefix.as_path()];
        // `bin/podman` -> `../Cellar/podman/6.1.3/bin/podman-remote`, as Homebrew lays it out
        tool_program(&prefix.join("Cellar/podman/6.1.3/bin/podman-remote"), 0o755);
        symlink("../Cellar/podman/6.1.3/bin/podman-remote", prefix.join("bin/podman")).unwrap();
        assert!(tool_is_trusted(&prefix.join("bin/podman"), &roots), "the link Homebrew makes");
        // a regular file in the install's own `bin` (the Podman installer's layout)
        tool_program(&prefix.join("bin/podman-compose"), 0o755);
        assert!(tool_is_trusted(&prefix.join("bin/podman-compose"), &roots));
        // a regular file, or a link to one, outside the roots is not: it is no more trusted for being a file
        tool_program(&elsewhere.join("podman"), 0o755);
        assert!(!tool_is_trusted(&elsewhere.join("podman"), &roots), "a regular file outside the roots");
        symlink(elsewhere.join("podman"), prefix.join("bin/planted")).unwrap();
        assert!(!tool_is_trusted(&prefix.join("bin/planted"), &roots), "a link out of the roots");
        // inside the roots, but a program anyone in the group or on the machine can rewrite, as a file or as a link
        tool_program(&prefix.join("bin/open-to-all"), 0o757);
        tool_program(&prefix.join("bin/open-to-group"), 0o775);
        tool_program(&prefix.join("Cellar/podman/6.1.3/bin/open-to-all"), 0o757);
        symlink("../Cellar/podman/6.1.3/bin/open-to-all", prefix.join("bin/open")).unwrap();
        for name in ["open-to-all", "open-to-group", "open"] {
            assert!(!tool_is_trusted(&prefix.join("bin").join(name), &roots), "{name}");
        }
        // a link to nothing, to a directory, a missing name, a relative name
        symlink("../Cellar/gone", prefix.join("bin/dangling")).unwrap();
        symlink("../Cellar", prefix.join("bin/directory")).unwrap();
        for name in ["dangling", "directory", "missing"] {
            assert!(!tool_is_trusted(&prefix.join("bin").join(name), &roots), "{name}");
        }
        assert!(!tool_is_trusted(Path::new("podman"), &roots));
        // the same link with another root list is no longer trusted
        assert!(!tool_is_trusted(&prefix.join("bin/podman"), &[elsewhere.as_path()]));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_anyone_can_write_in_on_the_way_to_the_tool_takes_the_trust_away() {
        use super::tool_is_trusted;
        use std::os::unix::fs::{symlink, PermissionsExt};
        let (root, prefix, _elsewhere) = tool_layout("folders");
        let roots = [prefix.as_path()];
        tool_program(&prefix.join("Cellar/podman/6.1.3/bin/podman-remote"), 0o755);
        symlink("../Cellar/podman/6.1.3/bin/podman-remote", prefix.join("bin/podman")).unwrap();
        tool_program(&prefix.join("bin/podman-compose"), 0o755);
        let podman = prefix.join("bin/podman");
        let compose = prefix.join("bin/podman-compose");
        assert!(tool_is_trusted(&podman, &roots) && tool_is_trusted(&compose, &roots));
        // each folder between the file and the root, one at a time: written by others, or by the group (outside macOS's admins)
        for (folder, tool) in [
            (prefix.join("Cellar/podman/6.1.3/bin"), &podman),
            (prefix.join("Cellar/podman/6.1.3"), &podman),
            (prefix.join("Cellar/podman"), &podman),
            (prefix.join("Cellar"), &podman),
            (prefix.join("bin"), &podman),
            (prefix.join("bin"), &compose),
            (prefix.clone(), &compose),
        ] {
            for mode in [0o757, 0o777, 0o775] {
                fs::set_permissions(&folder, fs::Permissions::from_mode(mode)).unwrap();
                let group_only = mode == 0o775;
                // a group that is not the administrators' (the test's folders are the user's own group, never gid 80 off macOS)
                let expected = group_only && super::ADMIN_GROUP == Some(std::os::unix::fs::MetadataExt::gid(&fs::metadata(&folder).unwrap()));
                assert_eq!(tool_is_trusted(tool, &roots), expected, "{} {mode:o}", folder.display());
            }
            fs::set_permissions(&folder, fs::Permissions::from_mode(0o755)).unwrap();
            assert!(tool_is_trusted(tool, &roots), "{} restored", folder.display());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_is_safe_to_the_user_and_to_root_and_to_the_administrators_group_only_where_there_is_one() {
        use super::tool_folder_is_safe;
        // (owner, group, mode, user, admin group)
        assert!(tool_folder_is_safe(501, 20, 0o755, 501, Some(80)), "the user's own, 0755");
        assert!(tool_folder_is_safe(0, 0, 0o755, 501, Some(80)), "root's");
        assert!(!tool_folder_is_safe(502, 20, 0o755, 501, Some(80)), "another user's");
        assert!(!tool_folder_is_safe(501, 20, 0o757, 501, Some(80)), "writable by others");
        assert!(!tool_folder_is_safe(501, 20, 0o777, 501, Some(80)));
        assert!(!tool_folder_is_safe(501, 20, 0o775, 501, Some(80)), "writable by a group that is not the administrators'");
        assert!(tool_folder_is_safe(501, 80, 0o775, 501, Some(80)), "Homebrew's Cellar: the administrators' group may write");
        assert!(!tool_folder_is_safe(501, 80, 0o777, 501, Some(80)), "never by others, administrators' group or not");
        assert!(!tool_folder_is_safe(501, 80, 0o775, 501, None), "no administrators' group on this system");
        // the administrators' group never stands for the owner: another account's Homebrew is refused
        assert!(!tool_folder_is_safe(502, 80, 0o775, 501, Some(80)));
        assert!(!tool_folder_is_safe(502, 80, 0o755, 501, Some(80)));
        assert!(tool_folder_is_safe(501, 80, 0o755, 501, Some(80)), "the administrators' group without writing");
    }

    #[cfg(unix)]
    #[test]
    fn the_tool_itself_is_never_writable_by_a_group_not_even_the_administrators() {
        use super::tool_file_is_safe;
        // (owner, mode, user)
        assert!(tool_file_is_safe(501, 0o755, 501) && tool_file_is_safe(501, 0o555, 501) && tool_file_is_safe(0, 0o755, 501));
        assert!(!tool_file_is_safe(501, 0o775, 501), "user:admin 0775");
        assert!(!tool_file_is_safe(501, 0o757, 501));
        assert!(!tool_file_is_safe(501, 0o777, 501));
        assert!(!tool_file_is_safe(502, 0o755, 501), "another account's");
    }

    #[cfg(unix)]
    #[test]
    fn the_tool_is_looked_for_in_the_bin_folder_of_the_roots_and_nowhere_else() {
        use super::find_trusted_tool;
        use std::os::unix::fs::symlink;
        let (root, prefix, elsewhere) = tool_layout("search");
        let second = root.join("second");
        fs::create_dir_all(second.join("bin")).unwrap();
        tool_program(&prefix.join("Cellar/podman/6.1.3/bin/podman-remote"), 0o755);
        symlink("../Cellar/podman/6.1.3/bin/podman-remote", prefix.join("bin/podman")).unwrap();
        let roots = [prefix.as_path(), second.as_path()];
        assert_eq!(find_trusted_tool("podman", &roots), Some(prefix.join("bin/podman")));
        // the same name in a folder that is not a root's `bin`, even a regular and well-kept file, is not found
        tool_program(&elsewhere.join("podman-compose"), 0o755);
        tool_program(&prefix.join("podman-compose"), 0o755);
        assert_eq!(find_trusted_tool("podman-compose", &roots), None);
        // the second root is looked in when the first has none
        tool_program(&second.join("bin/podman-compose"), 0o755);
        assert_eq!(find_trusted_tool("podman-compose", &roots), Some(second.join("bin/podman-compose")));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_expected_config_hash_is_computed_in_the_environment_the_wrapper_starts_the_container_in() {
        use super::mac_config_hash_in;
        use sha2::{Digest, Sha256};
        let (root, runtime, _wrapper, _id) = attested_local_fixture();
        // a provider whose hash depends on what the compose resolves from the environment, as the real one does
        fs::write(
            runtime.join("bin").join("podman-compose"),
            "#!/bin/sh\n[ \"${1:-}\" = --version ] && { echo 'podman-compose version 1.6.0'; exit 0; }\nh=$(printf '%s|%s|%s' \"$JHT_HOST_TYPE\" \"$JHT_LANG\" \"$JHT_USER_TZ\" | shasum -a 256 | cut -d' ' -f1)\nprintf 'podman create --name=jht --label io.podman.compose.config-hash=%s x\\n' \"$h\" >&2\n",
        )
        .unwrap();
        let sha = |text: &str| format!("{:x}", Sha256::digest(text.as_bytes()));
        let none = |_: &str| -> Option<String> { None };
        // the Mac as the host setup leaves it: the container was made with these three
        let host_env = "JHT_LANG=en\nJHT_HOST_TYPE=local\nJHT_USER_TZ=Europe/Rome\n";
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, Some(host_env), &none), Ok(sha("local|en|Europe/Rome")));
        // without host.env: the wrapper's defaults, not empty values
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Ok(sha("unknown|en|UTC")));
        fs::remove_dir_all(root).unwrap();
    }

    /// A runtime with a fake `podman` and `podman-compose` in its `bin` (the tools the hash search finds first in a
    /// test) and a machine file: (root, runtime). The caller removes `root`. `podman_says` is what `podman
    /// --version` prints, `compose` the whole script of the provider.
    #[cfg(unix)]
    fn hash_runtime(podman_script: &str, compose_script: &str) -> (PathBuf, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-hash-runtime-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        fs::create_dir_all(runtime.join("bin")).unwrap();
        fs::write(runtime.join("podman-machine"), "jht-podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services: {}\n").unwrap();
        for (name, script) in [("podman", podman_script), ("podman-compose", compose_script)] {
            let tool = runtime.join("bin").join(name);
            fs::write(&tool, script).unwrap();
            fs::set_permissions(&tool, fs::Permissions::from_mode(0o700)).unwrap();
        }
        (root, runtime)
    }

    #[cfg(unix)]
    const PODMAN_6_1_3: &str = "#!/bin/sh\n[ \"${1:-}\" = --version ] && { echo 'podman version 6.1.3'; exit 0; }\nexit 91\n";
    /// The provider's plan as the real one prints it: a create of the dependency with another hash, then the create
    /// of `jht` whose hash is `$1`.
    #[cfg(unix)]
    fn compose_plan(hash_script: &str) -> String {
        format!("#!/bin/sh\n[ \"${{1:-}}\" = --version ] && {{ echo 'podman-compose version 1.6.0'; exit 0; }}\nh=$({hash_script})\nprintf 'podman create --name=jht-telegram --label io.podman.compose.config-hash=%s x\\n' \"{}\" >&2\nprintf 'podman create --name=jht --label io.podman.compose.config-hash=%s x\\n' \"$h\" >&2\n", "b".repeat(64))
    }
    #[cfg(unix)]
    fn digest_of(text: &str) -> String {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(text.as_bytes()))
    }
    #[cfg(unix)]
    fn listed(reason: &str) -> &str {
        assert!(crate::runtime_log::ATTEST_REASONS.contains(&reason), "{reason} is not a reason the log can say");
        reason
    }
    #[cfg(unix)]
    // in pieces: the repository scan of the release forbids any whole reference to the image that is not the manifest's
    const PIN: &str = concat!("ghcr.io/leopu00/", "jht@sha256:", "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");

    #[cfg(unix)]
    #[test]
    fn the_expected_hash_follows_the_image_pin_of_the_runtime_and_a_runtime_without_a_pin_has_none_in_it() {
        // the provider's hash depends on the JHT_IMAGE it is given, as the real one does through the compose file
        let hash = "printf '%s' \"${JHT_IMAGE:-the default of the compose file}\" | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1";
        let none = |_: &str| -> Option<String> { None };
        let (root, runtime) = hash_runtime(PODMAN_6_1_3, &compose_plan(hash));
        // a test channel: runtime-image holds the pin, the container was made with it
        fs::write(runtime.join("runtime-image"), format!("{PIN}\n")).unwrap();
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Ok(digest_of(PIN)));
        // a production runtime: no pin file, the compose file's own default, and the hash is another one
        fs::remove_file(runtime.join("runtime-image")).unwrap();
        assert_eq!(
            mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none),
            Ok(digest_of("the default of the compose file"))
        );
        // a pin that is not a digest of the product's image stops the check instead of being passed on
        for bad in [&PIN[..PIN.len() - 1], "ghcr.io/leopu00/jht:latest", ""] {
            fs::write(runtime.join("runtime-image"), format!("{bad}\n")).unwrap();
            assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Err("hash_image_pin"), "{bad:?}");
        }
        fs::write(runtime.join("runtime-image"), PIN).unwrap();
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Err("hash_image_pin"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_provider_is_given_the_directory_of_the_podman_it_trusts_in_its_path_as_an_app_opened_from_finder_has_none() {
        let none = |_: &str| -> Option<String> { None };
        let (root, runtime) = hash_runtime(PODMAN_6_1_3, "");
        // podman-compose looks `podman` up by name: it says so and stops when the name does not lead to this runtime's one
        let find = format!(
            "[ \"$(command -v podman)\" = \"{}\" ] || {{ echo 'failed to check if podman is installed: No such file or directory: podman' >&2; exit 1; }}\n",
            runtime.join("bin").join("podman").display()
        );
        let script = compose_plan("printf '%s' fixed | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1");
        let script = script.replacen("[ \"${1:-}\" = --version ]", &format!("{find}[ \"${{1:-}}\" = --version ]"), 1);
        fs::write(runtime.join("bin").join("podman-compose"), script).unwrap();
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Ok(digest_of("fixed")));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_check_that_could_not_be_made_is_told_apart_from_a_container_that_is_another() {
        let none = |_: &str| -> Option<String> { None };
        let hash = "printf x | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1";
        let ask = |podman: &str, compose: &str, machine: Option<&str>| {
            let (root, runtime) = hash_runtime(podman, compose);
            match machine {
                Some(machine) => fs::write(runtime.join("podman-machine"), machine).unwrap(),
                None => fs::remove_file(runtime.join("podman-machine")).unwrap(),
            }
            let said = mac_config_hash_in(&runtime, Duration::from_secs(20), None, &none);
            fs::remove_dir_all(root).unwrap();
            said
        };
        let good = compose_plan(hash);
        let machine = Some("jht-podman\n");
        // the versions: read and other, or not readable
        assert_eq!(ask("#!/bin/sh\necho 'podman version 6.0.0'\n", &good, machine), Err("hash_podman_version_differs"));
        assert_eq!(ask("#!/bin/sh\nexit 3\n", &good, machine), Err("hash_podman_version_unreadable"));
        assert_eq!(ask(PODMAN_6_1_3, &good.replace("1.6.0", "1.5.0"), machine), Err("hash_compose_version_differs"));
        assert_eq!(ask(PODMAN_6_1_3, "#!/bin/sh\nexit 1\n", machine), Err("hash_compose_version_unreadable"));
        // the machine file
        assert_eq!(ask(PODMAN_6_1_3, &good, None), Err("hash_machine_file"));
        assert_eq!(ask(PODMAN_6_1_3, &good, Some("jht-podman")), Err("hash_machine_file"));
        assert_eq!(ask(PODMAN_6_1_3, &good, Some("a b\n")), Err("hash_machine_file"));
        // the plan: does not run, runs and says nothing of jht, says two things
        let plan = |body: &str| format!("#!/bin/sh\n[ \"${{1:-}}\" = --version ] && {{ echo 'podman-compose version 1.6.0'; exit 0; }}\n{body}\n");
        assert_eq!(ask(PODMAN_6_1_3, &plan("exit 7"), machine), Err("hash_dry_run_exit"));
        assert_eq!(ask(PODMAN_6_1_3, &plan("exit 0"), machine), Err("hash_plan_without_create"));
        assert_eq!(ask(PODMAN_6_1_3, &plan("echo 'podman create --name=jht --label io.podman.compose.config-hash=short x'"), machine), Err("hash_plan_ambiguous"));
        let two = format!(
            "echo 'podman create --name=jht --label io.podman.compose.config-hash={} x'; echo 'podman create --name=jht --label io.podman.compose.config-hash={} x'",
            "a".repeat(64),
            "c".repeat(64)
        );
        assert_eq!(ask(PODMAN_6_1_3, &plan(&two), machine), Err("hash_plan_ambiguous"));
        // the plan that takes longer than the time it is given
        let (root, runtime) = hash_runtime(PODMAN_6_1_3, &plan("sleep 5"));
        assert_eq!(mac_config_hash_in(&runtime, Duration::from_millis(500), None, &none), Err("hash_dry_run_timeout"));
        fs::remove_dir_all(root).unwrap();
        // which of these waiting may cure, and the words the log can say
        for reason in ["hash_podman_version_unreadable", "hash_compose_version_unreadable", "hash_dry_run_exit", "hash_dry_run_timeout", "hash_dry_run_not_started", "hash_plan_without_create"] {
            assert!(attest_reason_may_pass(listed(reason)), "{reason}");
        }
        for reason in ["hash_tool_missing", "hash_podman_version_differs", "hash_compose_version_differs", "hash_machine_file", "hash_image_pin", "hash_plan_ambiguous", "label_config_hash_differs", "label_project", "label_image"] {
            assert!(!attest_reason_may_pass(listed(reason)), "{reason}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_hash_that_could_not_be_worked_out_is_not_said_to_be_another_container_and_a_label_that_differs_is() {
        let runtime = PathBuf::from("/runtime");
        let labels = serde_json::json!({});
        let wrong = Ok("0".repeat(64));
        // the hash could not be worked out: the reason is the hash's, whatever the labels are
        assert_eq!(attestation_refusal(Some(&Err("hash_dry_run_timeout")), &labels, &runtime, true), Some("hash_dry_run_timeout"));
        // the hash is there: the labels are looked at, rule by rule
        let mut labels = serde_json::json!({
            "com.docker.compose.project": "other", "io.podman.compose.project": "jht",
            "com.docker.compose.service": "jht", "io.podman.compose.service": "jht",
            "com.docker.compose.container-number": "1",
            "com.docker.compose.project.working_dir": "/runtime", "io.podman.compose.config-hash": "a".repeat(64),
        });
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_project"));
        labels["com.docker.compose.project"] = "jht".into();
        labels["io.podman.compose.service"] = "x".into();
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_service"));
        labels["io.podman.compose.service"] = "jht".into();
        labels["com.docker.compose.container-number"] = "2".into();
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_container_number"));
        labels["com.docker.compose.container-number"] = "1".into();
        labels["com.docker.compose.project.working_dir"] = "/elsewhere".into();
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_working_dir"));
        labels["com.docker.compose.project.working_dir"] = "/runtime".into();
        labels["io.podman.compose.config-hash"] = "not a hash".into();
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_hash_form"));
        // what to say when none is taken: the other one wins over the one that could not be checked
        assert_eq!(container_not_found_code(Some("label_project"), Some("hash_dry_run_exit")), "local_container_not_attested");
        assert_eq!(container_not_found_code(None, Some("hash_dry_run_exit")), "container_unavailable");
        assert_eq!(container_not_found_code(None, None), "local_team_not_running");
        for reason in ["label_project", "label_service", "label_container_number", "label_working_dir", "label_hash_form", "label_image", "label_config_files", "label_compose_version", "label_systemd_unit", "label_windows"] {
            listed(reason);
        }
    }

    /// What the local chat steps (container lookup, exec) may take in a test:
    /// the fake engine is a few `sh` runs, and a loaded CI runner or the turn's
    /// parallel builds stretch them past two seconds. A refusal under test
    /// never waits this long: it fails before any engine runs.
    #[cfg(unix)]
    const LOCAL_TEST_TIMEOUT: Duration = Duration::from_secs(30);

    /// A runtime the attestation accepts, with a fake private Podman shim whose `exec` echoes its
    /// arguments and stdin: (root, runtime dir, wrapper, container id). The caller removes `root`.
    #[cfg(unix)]
    fn attested_local_fixture() -> (PathBuf, PathBuf, PathBuf, String) {
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        let bin = runtime.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n").unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(
            &wrapper,
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\n[ \"$1:$2\" = desktop-chat:probe ] || exit 9\nprintf 'true\\n'\n",
        )
        .unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        let engine = bin.join("docker");
        let id = "a".repeat(64);
        let mut labels = serde_json::json!({
            "com.docker.compose.project": "jht",
            "io.podman.compose.project": "jht",
            "com.docker.compose.service": "jht",
            "io.podman.compose.service": "jht",
            "com.docker.compose.container-number": "1",
            "com.docker.compose.project.working_dir": runtime.to_string_lossy(),
            "io.podman.compose.config-hash": "a".repeat(64),
        });
        #[cfg(target_os = "macos")]
        labels.as_object_mut().unwrap().extend([
            ("com.docker.compose.project.config_files".to_owned(), serde_json::json!(runtime.join("docker-compose.yml"))),
            ("io.podman.compose.version".to_owned(), serde_json::json!("1.6.0")),
            ("PODMAN_SYSTEMD_UNIT".to_owned(), serde_json::json!(podman_systemd_unit())),
        ]);
        #[cfg(all(unix, not(target_os = "macos")))]
        labels.as_object_mut().unwrap().extend([
            ("com.docker.compose.project.config_files".to_owned(), serde_json::json!(format!("{}/docker-compose.yml,{}/docker-compose.podman-linux.yml", runtime.display(), runtime.display()))),
            ("io.podman.compose.version".to_owned(), serde_json::json!("1.6.0")),
            ("PODMAN_SYSTEMD_UNIT".to_owned(), serde_json::json!(podman_systemd_unit())),
        ]);
        fs::write(
            &engine,
            format!(
                "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\ncase \"$1\" in\n  ps) printf '{id}\\n' ;;\n  inspect) printf 'true|{}\\n' ;;\n  exec) printf '%s\\n' \"$*\"; cat ;;\n  *) exit 9 ;;\nesac\n",
                labels
            ),
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        #[cfg(target_os = "macos")]
        {
            fs::write(bin.join("podman"), "#!/bin/sh\n[ \"${1:-}\" = --version ] && { echo 'podman version 6.1.3'; exit 0; }\nexit 91\n").unwrap();
            fs::write(bin.join("podman-compose"), format!("#!/bin/sh\n[ \"${{1:-}}\" = --version ] && {{ echo 'provider banner'; echo 'podman-compose version 1.6.0'; exit 0; }}\n[ -z \"${{JHT_IMAGE+x}}\" ] || exit 92\nprintf 'podman create --name=jht-telegram --label io.podman.compose.config-hash={} x\\n' >&2\nprintf 'podman create --name=jht --label io.podman.compose.config-hash={} x\\n' >&2\n", "7".repeat(64), "a".repeat(64))).unwrap();
            for helper in [bin.join("podman"), bin.join("podman-compose")] { fs::set_permissions(helper, fs::Permissions::from_mode(0o700)).unwrap(); }
        }
        write_valid_local_podman_manifest(&runtime, &wrapper);
        (root, runtime, wrapper, id)
    }

    // The direct local path is a normal native process on both systems where this test runs. The
    // fake private Podman shim proves the container discovery, exact exec argv, and non-ASCII stdin
    // all survive without asking a shell or a PowerShell wrapper to reconstruct the text.
    #[cfg(unix)]
    #[test]
    fn local_chat_executes_the_attested_engines_python_with_raw_unicode_stdin() {
        use crate::existing_team_runtime::ChatOperation;

        let (root, runtime, wrapper, id) = attested_local_fixture();

        let words = "àèé € 🧭";
        let result = run_local_chat(
            &wrapper,
            &runtime,
            ChatOperation::Send {
                agent: "assistente",
                client_message_id: "id-1",
            },
            Some(words.as_bytes()),
            LOCAL_TEST_TIMEOUT,
        )
        .unwrap();
        assert_eq!(
            String::from_utf8(result.stdout).unwrap(),
            format!("exec -i {id} python3 -I /app/shared/skills/agent_chat.py send assistente id-1\n{words}")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_container_the_engine_lost_is_found_again_by_the_next_chat_call() {
        use crate::existing_team_runtime::ChatOperation;
        use std::os::unix::fs::PermissionsExt;

        let (root, runtime, wrapper, _id) = attested_local_fixture();
        let read = || {
            run_local_chat(&wrapper, &runtime, ChatOperation::Read { agent: "capitano", cursor: None }, None, LOCAL_TEST_TIMEOUT)
        };
        assert_eq!(read().unwrap().code, 0);
        // The container is gone: the engine answers 125 to the exec. The kept container is dropped.
        let engine = runtime.join("bin").join("docker");
        fs::write(&engine, "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\nexit 125\n").unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        // This call uses the kept container (or, if another test took the one slot, finds it again and
        // is refused: the engine is no longer the attested one).
        match read() {
            Ok(done) => assert_eq!(done.code, 125),
            Err(code) => assert_eq!(code, "runtime_missing"),
        }
        // The next call looks again (and is refused) instead of failing on the old id for five seconds.
        assert!(read().is_err(), "the lost container was not forgotten");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_an_engine_failure_or_a_vanished_container_empties_the_kept_one() {
        let done = |code| Ok(ProcessResult { code, stdout: Vec::new() });
        assert!(!engine_lost_the_container(&done(0)));
        // the chat script's own answers: the container is there
        for code in [2, 70, 119, 124, 126, 127, 130, 255] {
            assert!(!engine_lost_the_container(&done(code)), "{code}");
        }
        for code in [1, 3, 125] {
            assert!(engine_lost_the_container(&done(code)), "{code}");
        }
        // a slow engine is not a lost container; one that did not start is
        assert!(!engine_lost_the_container(&Err("process_timeout")));
        assert!(engine_lost_the_container(&Err("process_start_failed")));
    }

    #[test]
    fn a_podman_runtime_is_listed_by_label_on_every_system_and_never_through_compose() {
        let words = |podman| {
            local_compose_args(&LocalChatEngine { program: PathBuf::from("docker"), podman }, Path::new("/rt"))
                .into_iter()
                .map(|word| word.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        };
        assert_eq!(words(true), ["ps", "-q", "--filter", "label=com.docker.compose.project=jht"]);
        let docker = words(false);
        assert_eq!(docker[0], "compose");
        assert!(docker.iter().any(|word| word == "--project-directory"));
    }

    #[cfg(unix)]
    #[test]
    fn the_attested_team_runs_commands_in_the_one_container_without_a_wrapper() {
        let (root, runtime, wrapper, id) = attested_local_fixture();
        let team = AttestedLocalTeam::resolve(&wrapper, &runtime, LOCAL_TEST_TIMEOUT).unwrap();
        // The fake engine echoes `exec`'s arguments, then its stdin: no -i without input.
        let started = team.exec(&["node", "/app/cli/bin/jht.js", "team", "start"], None, LOCAL_TEST_TIMEOUT).unwrap();
        assert_eq!(String::from_utf8(started.stdout).unwrap(), format!("exec {id} node /app/cli/bin/jht.js team start\n"));
        let fed = team.exec(&["cat"], Some("àè".as_bytes()), LOCAL_TEST_TIMEOUT).unwrap();
        assert_eq!(String::from_utf8(fed.stdout).unwrap(), format!("exec -i {id} cat\nàè"));
        assert_eq!(attested_exec_args("not-an-id", &["x"], false).unwrap_err(), "container_unavailable");
        assert_eq!(attested_exec_args(&id, &[], false).unwrap_err(), "container_unavailable");

        // The same refusals as the chat: a bundle changed after the manifest never reaches the engine.
        fs::write(&wrapper, "changed after the manifest\n").unwrap();
        assert_eq!(AttestedLocalTeam::resolve(&wrapper, &runtime, LOCAL_TEST_TIMEOUT).err(), Some("runtime_missing"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_chat_never_runs_the_engine_when_the_runtime_bundle_is_untrusted() {
        use crate::existing_team_runtime::ChatOperation;
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-attestation-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        let bin = runtime.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n").unwrap();
        let started = root.join("engine-was-called");
        let engine = bin.join("docker");
        fs::write(&engine, format!("#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\ntouch '{}'\n", started.display())).unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(
            &wrapper,
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\nexit 1\n",
        )
        .unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        write_valid_local_podman_manifest(&runtime, &wrapper);
        fs::write(&wrapper, "changed after the manifest\n").unwrap();

        assert_eq!(
            run_local_chat(
                &wrapper,
                &runtime,
                ChatOperation::Read { agent: "capitano", cursor: None },
                None,
                LOCAL_TEST_TIMEOUT,
            )
            .unwrap_err(),
            "runtime_missing"
        );
        assert!(!started.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_chat_never_execs_when_the_discovered_container_is_not_attested() {
        use crate::existing_team_runtime::ChatOperation;
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-container-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        let bin = runtime.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n").unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(&wrapper, "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\n").unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        let executed = root.join("exec-was-called");
        let engine = bin.join("docker");
        fs::write(
            &engine,
            format!(
                "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\ncase \"$1\" in\n  ps) printf '{}\\n' ;;\n  inspect) printf 'true|{{}}\\n' ;;\n  exec) touch '{}' ;;\n  *) exit 9 ;;\nesac\n",
                "a".repeat(64),
                executed.display(),
            ),
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        write_valid_local_podman_manifest(&runtime, &wrapper);

        assert_eq!(
            run_local_chat(
                &wrapper,
                &runtime,
                ChatOperation::Read { agent: "capitano", cursor: None },
                None,
                LOCAL_TEST_TIMEOUT,
            )
            .unwrap_err(),
            "local_team_not_running"
        );
        assert!(!executed.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_chat_names_a_running_container_the_runtime_did_not_start_as_not_attested() {
        use crate::existing_team_runtime::ChatOperation;
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-unattested-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        let bin = runtime.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n").unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(&wrapper, "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\n").unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        let executed = root.join("exec-was-called");
        let engine = bin.join("docker");
        fs::write(
            &engine,
            format!(
                "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\ncase \"$1\" in\n  ps) printf '{}\\n' ;;\n  inspect) printf 'true|{{\"com.docker.compose.service\":\"jht\"}}\\n' ;;\n  exec) touch '{}' ;;\n  *) exit 9 ;;\nesac\n",
                "a".repeat(64),
                executed.display(),
            ),
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        // The tools the Mac works the container's hash out with, as fakes: a real Homebrew on the machine that runs the test
        // would be run against this stub runtime and not give a hash at all (which is another answer).
        for (name, script) in [("podman", PODMAN_6_1_3.to_owned()), ("podman-compose", compose_plan("printf x | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1"))] {
            fs::write(bin.join(name), script).unwrap();
            fs::set_permissions(bin.join(name), fs::Permissions::from_mode(0o700)).unwrap();
        }
        fs::write(runtime.join("podman-machine"), "jht-podman\n").unwrap();
        write_valid_local_podman_manifest(&runtime, &wrapper);

        assert_eq!(
            run_local_chat(
                &wrapper,
                &runtime,
                ChatOperation::Read { agent: "capitano", cursor: None },
                None,
                LOCAL_TEST_TIMEOUT,
            )
            .unwrap_err(),
            "local_container_not_attested"
        );
        assert!(!executed.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_chat_rejects_another_accounts_runtime_before_any_engine_lookup() {
        use crate::existing_team_runtime::ChatOperation;

        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-owner-{}",
            std::process::id(),
        ));
        fs::create_dir_all(&root).unwrap();
        let owner = root.join(".desktop-account-scope");
        fs::write(&owner, "different-account\n").unwrap();
        let scope = crate::account_scope::AccountScope::synthetic(b"local-chat-owner");
        let connection = Connection {
            app: None,
            scope,
            host: ExecutionHost::Local,
            validated: ValidatedHost::Local,
            runtime: None,
            local_wrapper: None,
            local_runtime: None,
            local_owner_marker: Some(owner),
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        };
        assert_eq!(
            run_connection(
                &connection,
                &[],
                RemoteOperation::Chat(ChatOperation::Read { agent: "capitano", cursor: None }),
                None,
                Duration::from_secs(2),
            )
            .unwrap_err()
            .code,
            "local_account_owner_mismatch"
        );
        fs::remove_dir_all(root).unwrap();
    }

    // The preamble runs on the VPS (a POSIX shell) and the test drives it with `sh` and a mode bit.
    #[cfg(unix)]
    #[test]
    fn the_remote_preamble_tells_a_wrapper_without_the_chat_marker_by_name_and_never_by_the_scripts_exit(
    ) {
        use std::os::unix::fs::PermissionsExt;
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "jht-chat-preamble-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        let command = remote_wrapper_command(&["desktop-chat".to_owned(), "read".to_owned(), "capitano".to_owned()], false);
        let answer_command = remote_wrapper_command(
            &["desktop-chat".to_owned(), "chat-answer".to_owned(), "capitano".to_owned(), "q1".to_owned()],
            true,
        );
        let run_command_with = |command: &str, wrapper: &str| {
            let binary = dir.join("jht");
            let _ = fs::remove_file(&binary);
            fs::write(&binary, wrapper).unwrap();
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
            let done = Command::new("sh")
                .arg("-c")
                .arg(command)
                .env("PATH", format!("{}:/usr/bin:/bin", dir.display()))
                .env("HOME", &dir)
                .output()
                .unwrap();
            (done.status.code(), String::from_utf8_lossy(&done.stdout).into_owned())
        };
        let run_with = |wrapper: &str| run_command_with(&command, wrapper);
        let protocol = "JHT_DESKTOP_CHAT_PROTOCOL=1\n";
        let marker = "JHT_DESKTOP_CHAT_FIXED=1\n";
        let answer_marker = "JHT_DESKTOP_CHAT_ANSWER=1\n";
        // answer and enter need their own marker too: a wrapper with only the first chat actions is 64
        assert_eq!(
            run_command_with(&answer_command, &format!("#!/bin/sh\n{protocol}{marker}printf 'ran'\n")),
            (Some(UNKNOWN_ACTION), String::new())
        );
        assert_eq!(
            run_command_with(&answer_command, &format!("#!/bin/sh\n{protocol}{marker}{answer_marker}printf 'ran:%s' \"$*\"\n")),
            (Some(0), "ran:desktop-chat chat-answer capitano q1".to_owned())
        );
        // a wrapper with the chat actions runs, with exactly the arguments given
        assert_eq!(
            run_with(&format!("#!/bin/sh\n{protocol}{marker}printf 'ran:%s' \"$*\"\n")),
            (Some(0), "ran:desktop-chat read capitano".to_owned())
        );
        // one that does not have them is told apart by its missing marker: 64, and nothing ran
        assert_eq!(run_with(&format!("#!/bin/sh\n{protocol}printf 'ran'\n")), (Some(UNKNOWN_ACTION), String::new()));
        // the script's own 2 (python3: no such file, an image older than the chat) is not «no chat actions»
        assert_eq!(run_with(&format!("#!/bin/sh\n{protocol}{marker}exit 2\n")), (Some(2), String::new()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_answer_and_an_enter_from_another_window_are_refused_before_anything_else() {
        let yes = ["yes".to_owned()];
        assert!(answer_request("main", "capitano", "aq:capitano:1-a1", &yes, None).is_ok());
        assert!(enter_request("main", "capitano", "0b1c2d3e").is_ok());
        for label in ["live-screen", "broker-login", "", "main2", "Main"] {
            assert_eq!(answer_request(label, "capitano", "aq:capitano:1-a1", &yes, None).unwrap_err().code, "invalid_request", "{label:?}");
            assert_eq!(enter_request(label, "capitano", "0b1c2d3e").unwrap_err().code, "invalid_request", "{label:?}");
        }
    }

    // Unix only, like every test that builds a Connection (only_unix_tests_build_a_connection).
    #[cfg(unix)]
    #[test]
    fn an_answer_and_an_enter_never_go_through_the_read_only_link() {
        use super::{answer_impl, enter_impl, DirectChatInner};
        // An existing team opened in the read-only view: a pinned target, and no full link made for it.
        let inner = DirectChatInner::default();
        *inner.connection.lock().unwrap() = Some(Connection {
            app: None,
            scope: crate::account_scope::AccountScope::synthetic(b"synthetic-account-read-only"),
            host: ExecutionHost::Local,
            validated: ValidatedHost::Local,
            runtime: Some(crate::existing_team_runtime::ActivatedTarget::synthetic_for_tests()),
            local_wrapper: None,
            local_runtime: None,
            local_owner_marker: None,
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        });
        // the gate answers before any command: a command would have failed with its own code
        assert_eq!(
            answer_impl(
                &inner,
                "capitano",
                "aq:capitano:1-a1",
                br#"{"choices":["yes"],"text":null}"#
            )
            .unwrap_err()
            .code,
            "read_only_link"
        );
        assert_eq!(
            enter_impl(&inner, "capitano", "0b1c2d3e").unwrap_err().code,
            "read_only_link"
        );
        // the same connection with no pinned target is this computer's own team: the gate lets it by,
        // and what stops it is the next step (here, no wrapper of the person's own)
        inner.connection.lock().unwrap().as_mut().unwrap().runtime = None;
        assert_ne!(
            answer_impl(
                &inner,
                "capitano",
                "aq:capitano:1-a1",
                br#"{"choices":["yes"],"text":null}"#
            )
            .unwrap_err()
            .code,
            "read_only_link"
        );
        assert_ne!(
            enter_impl(&inner, "capitano", "0b1c2d3e").unwrap_err().code,
            "read_only_link"
        );
    }

    #[test]
    fn only_the_apps_own_window_may_write_to_an_agent() {
        assert!(window_may_write("main"));
        for label in ["live-screen", "broker-login", "", "main2", "Main"] {
            assert!(!window_may_write(label), "{label:?}");
        }
    }

    #[test]
    fn an_existing_team_is_written_to_only_with_the_full_connection() {
        let team = crate::existing_team_runtime::ActivatedTarget::synthetic_for_tests();
        assert!(!link_allows_writing(Some(&team), true, |_| false), "the read-only view reads, it never writes");
        assert!(link_allows_writing(Some(&team), false, |_| true), "the confirmed team is written to");
        assert!(link_allows_writing(None, true, |_| false), "a local team, or a marked VPS of one's own, has no read-only view of this kind");
        assert!(!link_allows_writing(None, false, |_| true), "a VPS of one's own with no mark is not written to");
    }

    #[test]
    fn connect_and_status_never_report_ready_without_a_clean_probe() {
        assert_eq!(status("connecting", None).state, "connecting");
        assert_eq!(
            status("error", Some("tunnel_unavailable")).code,
            Some("tunnel_unavailable")
        );
    }

    #[test]
    fn read_contract_parses_only_the_typed_page() {
        let raw = br#"{"messages":[{"id":"m1","role":"agent","text":"ok","at":1.0}],"cursor":"9"}"#
            .to_vec();
        let page: DirectChatPage = parse_json(
            ProcessResult {
                code: 0,
                stdout: raw,
            },
            "read_failed",
        )
        .unwrap();
        assert_eq!(page.messages[0].id, "m1");
        assert_eq!(page.cursor.as_deref(), Some("9"));
    }

    #[test]
    fn a_system_line_keeps_its_closed_code_and_a_receipt_keeps_its_state() {
        use super::DirectChatReceipt;
        let page: DirectChatPage = serde_json::from_str(
            r#"{"messages":[{"id":"s1","role":"system","text":"x","at":1.0,"code":"mail_not_taken"},{"id":"a1","role":"agent","text":"ok","at":2.0}],"cursor":"3"}"#,
        )
        .unwrap();
        assert_eq!(page.messages[0].code.as_deref(), Some("mail_not_taken"));
        assert_eq!(page.messages[1].code, None);
        let forged: DirectChatPage = serde_json::from_str(
            r#"{"messages":[{"id":"1","role":"system","text":"a","at":1.0,"code":"__proto__"},{"id":"2","role":"system","text":"b","at":2.0,"code":"constructor"},{"id":"3","role":"system","text":"c","at":3.0,"code":7},{"id":"4","role":"system","text":"d","at":4.0,"code":"unknown_code"}]}"#,
        )
        .unwrap();
        assert!(forged.messages.iter().all(|message| message.code.is_none()));
        let shown = serde_json::to_value(&page).unwrap();
        assert_eq!(shown["messages"][0]["code"], "mail_not_taken");
        assert!(shown["messages"][1].get("code").is_none());

        let queued: DirectChatReceipt = serde_json::from_str(
            r#"{"clientMessageId":"c","accepted":true,"messageId":"m","at":2.0,"state":"queued"}"#,
        )
        .unwrap();
        assert_eq!(serde_json::to_value(&queued).unwrap()["state"], "queued");
        let typed: DirectChatReceipt = serde_json::from_str(
            r#"{"clientMessageId":"c","accepted":true,"messageId":"m","at":2.0}"#,
        )
        .unwrap();
        assert!(serde_json::to_value(&typed).unwrap().get("state").is_none());
    }

    #[test]
    fn the_activity_of_the_agent_is_working_or_idle_and_anything_else_is_not_known() {
        let shown = |raw: &str| serde_json::to_value(serde_json::from_str::<DirectChatPage>(raw).unwrap()).unwrap();
        assert_eq!(shown(r#"{"messages":[],"activity":"working"}"#)["activity"], "working");
        assert_eq!(shown(r#"{"messages":[],"activity":"idle"}"#)["activity"], "idle");
        for odd in [r#""busy""#, r#""<b>x</b>""#, r#""WORKING""#, "7", "true", "null", r#"["working"]"#, r#""""#] {
            let page = shown(&format!(r#"{{"messages":[],"activity":{odd}}}"#));
            assert!(page.get("activity").is_none(), "{odd} is not known, never idle");
        }
        assert!(shown(r#"{"messages":[]}"#).get("activity").is_none(), "an older image says nothing");
    }

    #[test]
    fn a_queued_turn_is_watched_only_when_the_team_says_terminal_and_the_page_keeps_plain_ids() {
        let queued: DirectChatReceipt = serde_json::from_str(
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"state":"queued","queue":"terminal"}"#,
        )
        .unwrap();
        assert_eq!(serde_json::to_value(&queued).unwrap()["queue"], "terminal");
        // a mailbox turn has no queue to watch; a word outside the list, or a queue on a typed turn, is dropped
        for written in [
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"state":"queued"}"#,
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"state":"queued","queue":"mailbox"}"#,
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"taken":true,"queue":"terminal"}"#,
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"state":"queued","queue":7}"#,
        ] {
            let receipt: DirectChatReceipt = serde_json::from_str(written).unwrap();
            assert!(serde_json::to_value(&receipt).unwrap().get("queue").is_none(), "{written}");
        }
        let page: DirectChatPage = serde_json::from_str(
            r#"{"messages":[],"queued":["m1","a b",7,"","<b>x</b>","m2"]}"#,
        )
        .unwrap();
        assert_eq!(page.queued.as_deref(), Some(&["m1".to_owned(), "m2".to_owned()][..]));
        let ended: DirectChatPage = serde_json::from_str(
            r#"{"messages":[],"queued":[],"settled":[{"id":"m1","how":"taken"},{"id":"m2","how":"pending"},{"id":"m3","how":"unconfirmed"},{"id":"m4","how":"expired"},{"id":"m5","how":"sent"},{"id":"a b","how":"taken"},{"id":"m6"},7,{"id":"m7","how":7},{"id":"m8","how":"late"}]}"#,
        )
        .unwrap();
        let shown = serde_json::to_value(&ended).unwrap();
        assert_eq!(
            shown["settled"],
            serde_json::json!([{"id":"m1","how":"taken"},{"id":"m2","how":"pending"},{"id":"m3","how":"unconfirmed"},{"id":"m4","how":"expired"},{"id":"m8","how":"late"}])
        );
        let none: DirectChatPage = serde_json::from_str(r#"{"messages":[],"queued":[],"settled":"taken"}"#).unwrap();
        assert!(serde_json::to_value(&none).unwrap().get("settled").is_none());
        let empty: DirectChatPage = serde_json::from_str(r#"{"messages":[],"queued":[]}"#).unwrap();
        assert_eq!(serde_json::to_value(&empty).unwrap()["queued"], serde_json::json!([]));
        let older: DirectChatPage = serde_json::from_str(r#"{"messages":[]}"#).unwrap();
        assert!(serde_json::to_value(&older).unwrap().get("queued").is_none(), "an older image says nothing");
        let not_a_list: DirectChatPage = serde_json::from_str(r#"{"messages":[],"queued":"m1"}"#).unwrap();
        assert!(serde_json::to_value(&not_a_list).unwrap().get("queued").is_none());
    }

    #[test]
    fn a_message_keeps_only_a_kind_of_its_list_and_a_page_from_an_older_image_has_no_questions() {
        let page: DirectChatPage = serde_json::from_str(
            r#"{"messages":[{"id":"a1","role":"agent","text":"x","at":1.0,"kind":"urgent"},{"id":"a2","role":"agent","text":"y","at":2.0,"kind":"question"},{"id":"a3","role":"agent","text":"z","at":3.0,"kind":"URGENT"},{"id":"a4","role":"agent","text":"w","at":4.0,"kind":7},{"id":"a5","role":"agent","text":"v","at":5.0}]}"#,
        )
        .unwrap();
        let suggested: DirectChatPage = serde_json::from_str(
            r#"{"messages":[{"id":"a1","role":"agent","text":"x","at":1.0,"suggestions":["Sì","No",7,"","a\nb","Dopo","Mai","Forse","Oltre"]},{"id":"a2","role":"agent","text":"y","at":2.0,"suggestions":["Solo una"]},{"id":"s1","role":"system","text":"z","at":3.0,"code":"message_too_long"}]}"#,
        )
        .unwrap();
        // the first five, of which the out-of-shape ones are left out; a single one is no choice
        assert_eq!(suggested.messages[0].suggestions.as_deref(), Some(&["Sì".to_owned(), "No".to_owned()][..]));
        assert_eq!(suggested.messages[1].suggestions, None);
        assert_eq!(suggested.messages[2].code.as_deref(), Some("message_too_long"));
        let kinds: Vec<Option<&str>> = page.messages.iter().map(|m| m.kind.as_deref()).collect();
        assert_eq!(kinds, [Some("urgent"), None, None, None, None]);
        let shown = serde_json::to_value(&page).unwrap();
        assert_eq!(shown["messages"][0]["kind"], "urgent");
        assert!(shown["messages"][1].get("kind").is_none());
        // no `questions` in what the host wrote: none in what the page gets, so it offers no answer
        assert!(shown.get("questions").is_none());
        let empty: DirectChatPage = serde_json::from_str(r#"{"messages":[],"questions":[]}"#).unwrap();
        assert_eq!(serde_json::to_value(&empty).unwrap()["questions"], serde_json::json!([]));
        let not_a_list: DirectChatPage = serde_json::from_str(r#"{"messages":[],"questions":{"id":"q"}}"#).unwrap();
        assert!(serde_json::to_value(&not_a_list).unwrap().get("questions").is_none());
    }

    #[test]
    fn a_question_reaches_the_page_in_its_shape_or_not_at_all() {
        let good = serde_json::json!({
            "id": "aq:capitano:1792700000-a1b2c3", "at": 1792700000.5, "kind": "blocked", "subject": "Il CV",
            "text": "Mando il CV a Acme?", "options": [{"id": "yes", "label": "Sì"}, {"id": "later", "label": "Dopo"}],
            "multiple": false, "free": true, "expiresAt": 1792703600.0, "state": "answered",
            "answer": {"choices": ["yes"], "text": "va bene", "at": 1792700100.0, "origin": "user", "seenAt": null}
        });
        let page = |question: serde_json::Value| -> serde_json::Value {
            let page: DirectChatPage = serde_json::from_value(serde_json::json!({"messages": [], "questions": [question]})).unwrap();
            serde_json::to_value(&page).unwrap()["questions"].clone()
        };
        let shown = page(good.clone());
        assert_eq!(shown[0], good, "a question in its shape passes as it is");
        // asked in plain words: an empty list of options, no buttons, and it still reaches the page
        let mut plain = good.clone();
        plain["id"] = serde_json::json!("pm:11");
        plain["options"] = serde_json::json!([]);
        plain["free"] = serde_json::json!(false);
        plain["state"] = serde_json::json!("open");
        plain.as_object_mut().unwrap().remove("answer");
        assert_eq!(page(plain.clone()), serde_json::json!([plain]), "a question with no options passes as it is");
        // one field out of its shape: the question is left out whole
        for (field, value) in [
            ("id", serde_json::json!("aq capitano")),
            ("id", serde_json::json!(7)),
            ("state", serde_json::json!("closed")),
            ("text", serde_json::json!("x".repeat(4001))),
            ("at", serde_json::json!(-1)),
            ("options", serde_json::json!([{"id": "Yes!", "label": "Sì"}])),
            ("options", serde_json::json!([{"id": "a", "label": "A"}, {"id": "a", "label": "B"}])),
            ("options", serde_json::json!((0..9).map(|i| serde_json::json!({"id": format!("o{i}"), "label": "x"})).collect::<Vec<_>>())),
            ("answer", serde_json::json!({"choices": ["maybe"], "at": 1.0, "origin": "user", "seenAt": null})),
        ] {
            let mut bad = good.clone();
            bad[field] = value;
            assert_eq!(page(bad), serde_json::json!([]), "{field}");
        }
        // a kind or an origin outside its list is the plain one, never another person's answer
        let mut odd = good.clone();
        odd["kind"] = serde_json::json!("urgentissimo");
        odd["answer"]["origin"] = serde_json::json!("scadenza");
        let shown = page(odd);
        assert_eq!(shown[0]["kind"], "question");
        assert_eq!(shown[0]["answer"]["origin"], "unknown");
        // the system's own closing is said as the system's
        let mut closed = good.clone();
        closed["answer"]["origin"] = serde_json::json!("system");
        assert_eq!(page(closed)[0]["answer"]["origin"], "system");
        // a subject too long is no subject; the question stays
        let mut long = good;
        long["subject"] = serde_json::json!("s".repeat(201));
        assert!(page(long)[0].get("subject").is_none());
    }

    #[test]
    fn a_receipt_says_taken_only_with_a_boolean_and_a_reason_only_when_it_is_not_known() {
        use super::DirectChatReceipt;
        let receipt = |extra: &str| -> serde_json::Value {
            let parsed: DirectChatReceipt =
                serde_json::from_str(&format!(r#"{{"clientMessageId":"c","accepted":true,"messageId":"m","at":2.0{extra}}}"#)).unwrap();
            serde_json::to_value(&parsed).unwrap()
        };
        assert!(receipt("").get("taken").is_none(), "an older image says nothing of the composer");
        assert_eq!(receipt(r#","taken":true"#)["taken"], true);
        assert_eq!(receipt(r#","taken":false"#)["taken"], false);
        let unknown = receipt(r#","taken":null,"reason":"menu""#);
        assert!(unknown["taken"].is_null() && unknown.get("taken").is_some());
        assert_eq!(unknown["reason"], "menu");
        assert_eq!(receipt(r#","taken":null,"reason":"unconfirmed""#)["reason"], "unconfirmed");
        // anything but a boolean is «not known», never «taken»
        for odd in [r#","taken":"yes""#, r#","taken":1"#, r#","taken":{}"#] {
            let shown = receipt(odd);
            assert!(shown.get("taken").is_some() && shown["taken"].is_null(), "{odd}");
        }
        // a reason outside the list, or with a known outcome, is not said
        assert!(receipt(r#","taken":null,"reason":"<b>menu</b>""#).get("reason").is_none());
        assert!(receipt(r#","taken":null,"reason":"agent_busy""#).get("reason").is_none());
        assert!(receipt(r#","taken":false,"reason":"menu""#).get("reason").is_none());
        assert!(receipt(r#","reason":"menu""#).get("reason").is_none());
    }

    #[test]
    fn an_answer_leaves_with_checked_options_and_words_on_standard_input_only() {
        let line = |choices: &[&str], text: Option<&str>| {
            let owned: Vec<String> = choices.iter().map(|c| (*c).to_owned()).collect();
            answer_input(&owned, text).map(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).unwrap())
        };
        assert_eq!(line(&["yes"], None).unwrap(), serde_json::json!({"choices": ["yes"], "text": null}));
        assert_eq!(line(&[], Some("  ci penso io  ")).unwrap(), serde_json::json!({"choices": [], "text": "ci penso io"}));
        assert_eq!(line(&["a", "b"], Some("e anche")).unwrap()["choices"], serde_json::json!(["a", "b"]));
        let long = "w".repeat(2001);
        let nine: Vec<String> = (0..9).map(|i| format!("o{i}")).collect();
        let nine: Vec<&str> = nine.iter().map(String::as_str).collect();
        for (choices, text) in [
            (&[][..], None),
            (&[][..], Some("   ")),
            (&["Yes"][..], None),
            (&["a b"][..], None),
            (&["a", "a"][..], None),
            (&nine[..], None),
            (&["yes"][..], Some(long.as_str())),
            (&["yes"][..], Some("a\0b")),
        ] {
            assert_eq!(line(choices, text).unwrap_err().code, "invalid_request", "{choices:?} {text:?}");
        }
    }

    #[test]
    fn send_allowlist_maps_to_fixed_sessions() {
        assert!(valid_agent("assistente"));
        assert_eq!(session_for("assistente"), Some("ASSISTENTE"));
        for bad in ["", "CAPITANO;touch", "dottore", "../capitano"] {
            assert!(!valid_agent(bad));
        }
    }

    #[test]
    fn every_vps_chat_command_uses_the_attested_wrapper() {
        let mut commands = vec![REMOTE_CONTAINER_PROBE, REMOTE_PYTHON_STDIN];
        commands.extend(
            [
                "capitano",
                "assistente",
                "mentor",
                "scout",
                "analista",
                "scorer",
                "scrittore",
                "critico",
            ]
            .into_iter()
            .map(|agent| delivery_command(agent).unwrap()),
        );

        assert_eq!(commands.len(), 10);
        for command in commands {
            assert!(command.contains("JHT_DESKTOP_CHAT_PROTOCOL=1"));
            assert!(command.contains("exec \"$JHT_BIN\" desktop-chat"));
            assert!(!command.contains("docker "));
        }
    }

    #[test]
    fn cleanup_status_is_explicitly_disconnected() {
        assert_eq!(status("disconnected", None).state, "disconnected");
    }

    #[test]
    fn python_payload_is_framed_as_data_not_shell_text() {
        assert_eq!(hex_encode(b"a'b"), "612762");
    }

    #[test]
    fn vps_host_store_is_a_to_logout_to_b_empty_to_a_restored_without_legacy_fallback() {
        use std::path::Path;

        let root = Path::new("/synthetic/app-data");
        let a =
            crate::account_scope::AccountScope::synthetic(b"00000000-0000-4000-8000-000000000001");
        let b =
            crate::account_scope::AccountScope::synthetic(b"00000000-0000-4000-8000-000000000002");
        let a_path = connection_config_path_at(root, &a);
        let b_path = connection_config_path_at(root, &b);
        assert_ne!(a_path, b_path);
        assert_eq!(
            a_path,
            root.join("accounts")
                .join(a.digest())
                .join("direct-chat-host.json")
        );
        assert_eq!(connection_config_path_at(root, &a), a_path);
        assert_ne!(a_path, root.join("direct-chat-host.json"));
        assert!(!b_path.starts_with(root.join(a.digest())));
    }

    #[test]
    fn migration_host_gate_accepts_only_the_exact_local_record() {
        use std::{fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-migration-host-{nonce}"));
        let scope = crate::account_scope::AccountScope::synthetic_local(b"synthetic-local");
        let path = connection_config_path_at(&root, &scope);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"kind":"local"}"#).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        }
        assert!(verify_migration_local_host_at(&root, &scope).is_ok());

        fs::write(&path, br#"{"kind":"vps","address":"synthetic.invalid"}"#).unwrap();
        assert_eq!(
            verify_migration_local_host_at(&root, &scope).unwrap_err(),
            "local_migration_host_not_local"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn migration_host_gate_never_follows_a_symlink() {
        use std::{fs, os::unix::fs::symlink, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-migration-host-link-{nonce}"));
        let scope = crate::account_scope::AccountScope::synthetic_local(b"synthetic-local");
        let path = connection_config_path_at(&root, &scope);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let target = root.join("synthetic-host.json");
        fs::write(&target, br#"{"kind":"local"}"#).unwrap();
        symlink(&target, &path).unwrap();

        assert_eq!(
            verify_migration_local_host_at(&root, &scope).unwrap_err(),
            "local_migration_host_missing"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_probe_uses_verified_wrapper_and_redacts_runtime_failure() {
        use std::{
            fs,
            os::unix::fs::PermissionsExt,
            time::{SystemTime, UNIX_EPOCH},
        };

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("jht-chat-wrapper-{nonce}"));
        fs::create_dir_all(&dir).unwrap();
        let wrapper = dir.join("jht");
        fs::write(
            &wrapper,
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\n[ \"$1:$2\" = desktop-chat:probe ] || exit 9\nprintf 'true\\n'\n",
        )
        .unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        let scope = crate::account_scope::AccountScope::synthetic(b"synthetic-account-a");
        let owner = dir.join(".desktop-account-scope");
        fs::write(&owner, format!("{}\n", scope.digest())).unwrap();
        let connection = Connection {
            app: None,
            scope,
            host: ExecutionHost::Local,
            validated: ValidatedHost::Local,
            runtime: None,
            local_wrapper: Some(wrapper.clone()),
            local_runtime: None,
            local_owner_marker: Some(owner),
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        };
        assert_eq!(probe(&connection).state, "ready");
        // a local chat never pays an ssh connection per read, even where ssh has no master
        assert_eq!(serde_json::to_value(probe(&connection)).unwrap(), serde_json::json!({"state": "ready"}));

        fs::write(
            &wrapper,
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\nprintf 'private runtime detail' >&2\nexit 1\n",
        )
        .unwrap();
        let failed = probe(&connection);
        assert_eq!(failed.state, "error");
        // this computer's team with no container is «not running», the code the Messages page answers with «Start the team»
        assert_eq!(failed.code, Some("local_team_not_running"));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_probe_that_finds_no_container_says_not_running_on_this_computer_and_unavailable_on_a_vps() {
        assert_eq!(crate::direct_chat::probe_no_container_code(&ValidatedHost::Local), "local_team_not_running");
        let vps = ValidatedHost::Vps {
            address: "203.0.113.7".into(),
            user: "jht".into(),
            port: 22,
            key_path: PathBuf::from("/nonexistent/key"),
            known_hosts: PathBuf::from("/nonexistent/known_hosts"),
        };
        assert_eq!(crate::direct_chat::probe_no_container_code(&vps), "container_unavailable");
        // a host that could not be asked at all stays «unavailable», whichever it is
        let source = include_str!("direct_chat.rs");
        let body = source.split("fn probe(connection: &Connection)").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(body.contains("Err(_) => status(\"error\", Some(\"container_unavailable\"))"));
        assert!(body.contains("tunnel_unavailable"));
    }
}

#[cfg(test)]
mod assistance_registration_tests {
    use super::*;
    struct Temporary(PathBuf);
    impl Temporary {
        fn new() -> Self {
            // Two tests starting in the same clock tick must not share a name: a counter breaks the tie.
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "jht-assistance-register-{}-{nonce}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn path(&self) -> PathBuf {
            self.0.join("account/direct-chat-host.json")
        }
    }
    impl Drop for Temporary {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn host(label: &str) -> ExecutionHost {
        ExecutionHost::Vps {
            address: format!("{label}.invalid"),
            user: "fixture".into(),
            port: 22,
            key_path: "/fixture/key".into(),
        }
    }
    #[test]
    fn absent_host_is_private_and_same_host_keeps_exact_bytes() {
        let temp = Temporary::new();
        let path = temp.path();
        register_assistance_host_at(&path, &host("one")).unwrap();
        assert_eq!(
            serde_json::from_slice::<ExecutionHost>(&fs::read(&path).unwrap()).unwrap(),
            host("one")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        // Exact existing bytes, including harmless whitespace, are preserved.
        let mut bytes = fs::read(&path).unwrap();
        bytes.push(b'\n');
        fs::write(&path, &bytes).unwrap();
        register_assistance_host_at(&path, &host("one")).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }
    #[test]
    fn different_existing_host_is_never_overwritten() {
        let temp = Temporary::new();
        let path = temp.path();
        register_assistance_host_at(&path, &host("one")).unwrap();
        let before = fs::read(&path).unwrap();
        assert_eq!(
            register_assistance_host_at(&path, &host("two")),
            Err("browser_connection_changed")
        );
        assert_eq!(fs::read(&path).unwrap(), before);
    }
    #[test]
    fn malformed_oversize_extra_fields_and_nonfile_deny_without_repair() {
        let temp = Temporary::new();
        let path = temp.path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut extra = serde_json::to_value(host("one")).unwrap();
        extra["container_id"] = json!("spoof");
        for bytes in [
            b"{".to_vec(),
            vec![b' '; 4097],
            serde_json::to_vec(&extra).unwrap(),
        ] {
            fs::write(&path, &bytes).unwrap();
            assert_eq!(
                register_assistance_host_at(&path, &host("one")),
                Err("host_config_invalid")
            );
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert_eq!(
            register_assistance_host_at(&path, &host("one")),
            Err("host_config_invalid")
        );
        assert!(path.is_dir());
    }
    #[test]
    fn host_alias_cannot_replace_other_account_config() {
        let temp = Temporary::new();
        let path = temp.path();
        let scope = AccountScope::synthetic(b"assistance-a");
        let other = AccountScope::synthetic(b"assistance-b");
        assert_ne!(
            connection_config_path_at(&temp.0, &scope),
            connection_config_path_at(&temp.0, &other)
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let target = temp.0.join("other-host.json");
            let bytes = serde_json::to_vec(&host("two")).unwrap();
            fs::write(&target, &bytes).unwrap();
            symlink(&target, &path).unwrap();
            assert_eq!(
                register_assistance_host_at(&path, &host("one")),
                Err("host_config_invalid")
            );
            assert_eq!(fs::read(&target).unwrap(), bytes);
            assert!(fs::symlink_metadata(&path)
                .unwrap()
                .file_type()
                .is_symlink());
        }
    }
    #[test]
    fn two_registrations_serialize_and_only_one_host_wins() {
        let temp = Temporary::new();
        let path = temp.path();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let children: Vec<_> = ["one", "two"]
            .into_iter()
            .map(|label| {
                let path = path.clone();
                let barrier = barrier.clone();
                thread::spawn(move || {
                    barrier.wait();
                    (
                        host(label),
                        register_assistance_host_at(&path, &host(label)),
                    )
                })
            })
            .collect();
        let results: Vec<_> = children
            .into_iter()
            .map(|child| child.join().unwrap())
            .collect();
        assert_eq!(
            results.iter().filter(|(_, result)| result.is_ok()).count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|(_, result)| *result == Err("browser_connection_changed"))
                .count(),
            1
        );
        let persisted: ExecutionHost = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            &persisted,
            &results.iter().find(|(_, result)| result.is_ok()).unwrap().0
        );
    }

    /// The team-language script as the container runs it, with a folder standing in for `/jht_home`.
    /// Returns the exit code and what the script printed.
    #[cfg(unix)]
    fn run_team_language(home: &Path, bootstrap: Option<&str>, request: serde_json::Value) -> (i32, serde_json::Value) {
        use std::io::Write;
        assert_eq!(super::TEAM_LANGUAGE_PY.matches("home='/jht_home'").count(), 1, "the script's home changed: update this test");
        let script = super::TEAM_LANGUAGE_PY.replace("home='/jht_home'", &format!("home='{}'", home.display()));
        let input = super::python_input(&script, &request).unwrap();
        let mut command = Command::new("python3");
        command
            .args(["-c", "import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())"])
            .env_remove("JHT_LANG")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped());
        if let Some(lang) = bootstrap {
            command.env("JHT_LANG", lang);
        }
        let mut child = command.spawn().unwrap();
        child.stdin.take().unwrap().write_all(&input).unwrap();
        let output = child.wait_with_output().unwrap();
        let reply = serde_json::from_slice(&output.stdout).unwrap_or(serde_json::Value::Null);
        (output.status.code().unwrap_or(-1), reply)
    }

    #[cfg(unix)]
    fn team_language_home(label: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("jht-team-language-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        home
    }

    #[cfg(unix)]
    #[test]
    fn a_team_with_no_language_chosen_speaks_english_and_takes_the_one_set_once() {
        let home = team_language_home("fresh");
        let (code, read) = run_team_language(&home, None, json!({"op": "read"}));
        assert_eq!((code, &read), (0, &json!({"locale": "en", "stored": null})));
        let (code, set) = run_team_language(&home, None, json!({"op": "set", "locale": "it"}));
        assert_eq!((code, &set), (0, &json!({"locale": "it", "stored": "it", "changed": true})));
        // the same artefact the game's language setting writes, replaced whole
        let file: serde_json::Value = serde_json::from_slice(&fs::read(home.join("i18n-prefs.json")).unwrap()).unwrap();
        assert_eq!(file, json!({"locale": "it"}));
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(home.join("i18n-prefs.json")).unwrap().permissions().mode() & 0o777, 0o644);
        assert_eq!(fs::read_dir(&home).unwrap().count(), 1, "no temporary file left behind");
        let (_, read) = run_team_language(&home, None, json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "it", "stored": "it"}));
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn the_default_english_written_by_the_installer_is_replaced_but_a_chosen_language_never_is() {
        let home = team_language_home("chosen");
        // what the host setup leaves: English, in the file and in host.env
        fs::write(home.join("i18n-prefs.json"), "{\n  \"locale\": \"en\"\n}\n").unwrap();
        fs::write(home.join("host.env"), "JHT_LANG=en\n").unwrap();
        let (_, set) = run_team_language(&home, None, json!({"op": "set", "locale": "it"}));
        assert_eq!(set, json!({"locale": "it", "stored": "it", "changed": true}));
        // now it is chosen: another set changes nothing, whatever it asks
        for locale in ["de", "en"] {
            let (code, set) = run_team_language(&home, None, json!({"op": "set", "locale": locale}));
            assert_eq!((code, &set), (0, &json!({"locale": "it", "stored": "it", "changed": false})));
        }
        assert_eq!(fs::read_to_string(home.join("i18n-prefs.json")).unwrap().trim(), "{\n  \"locale\": \"it\"\n}");
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn a_language_given_by_the_environment_or_host_env_counts_as_chosen_and_is_not_overwritten() {
        let home = team_language_home("bootstrap");
        let (_, read) = run_team_language(&home, Some("hu"), json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "hu", "stored": null}));
        let (_, set) = run_team_language(&home, Some("hu"), json!({"op": "set", "locale": "it"}));
        assert_eq!(set, json!({"locale": "hu", "stored": null, "changed": false}));
        assert!(!home.join("i18n-prefs.json").exists(), "nothing was written");
        fs::write(home.join("host.env"), "FOO=1\nJHT_LANG=\"fr\"\n").unwrap();
        let (_, read) = run_team_language(&home, None, json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "fr", "stored": null}));
        // an unknown value anywhere is skipped, as every reader of the language skips it
        fs::write(home.join("host.env"), "JHT_LANG=xx\n").unwrap();
        fs::write(home.join("i18n-prefs.json"), "{\"locale\": \"klingon\"}").unwrap();
        let (_, read) = run_team_language(&home, Some("zz"), json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "en", "stored": null}));
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn the_team_language_script_refuses_a_language_it_does_not_have_and_writes_nothing() {
        let home = team_language_home("refused");
        for request in [json!({"op": "set", "locale": "xx"}), json!({"op": "set"}), json!({"op": "wipe"})] {
            let (code, _) = run_team_language(&home, None, request);
            assert_eq!(code, 2);
        }
        assert_eq!(fs::read_dir(&home).unwrap().count(), 0);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn a_team_language_reply_outside_the_seven_languages_is_not_believed() {
        let reply = |locale: &str, stored: Option<&str>| super::TeamLanguage {
            locale: locale.to_owned(),
            stored: stored.map(str::to_owned),
            changed: None,
        };
        assert!(super::checked_team_language(reply("it", None)).is_some());
        assert!(super::checked_team_language(reply("pt", Some("en"))).is_some());
        assert!(super::checked_team_language(reply("xx", None)).is_none());
        assert!(super::checked_team_language(reply("it", Some("xx"))).is_none());
    }

    #[test]
    fn the_team_language_commands_are_the_app_windows_and_the_write_goes_through_the_one_gate() {
        let source = include_str!("direct_chat.rs");
        let set = source.split("pub(crate) async fn direct_chat_team_language_set(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(set.contains("!window_may_write(window.label())"), "only the app's own window may write the language");
        assert!(set.contains("team_language_impl(inner, json!({\"op\": \"set\""));
        let implementation = source.split("fn team_language_impl(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(implementation.contains("if write {\n        refuse_writing(connection)?;"), "a write goes through the gate of every write to the team");
        let read = source.split("pub(crate) async fn direct_chat_team_language(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(read.contains("\"op\": \"read\"") && read.contains(", false, "), "the read never asks to write");
    }
}

#[cfg(test)]
mod attachment_command_tests {
    use super::*;
    use std::fs;

    // Unix only, like every test that builds a Connection (only_unix_tests_build_a_connection).
    #[cfg(unix)]
    #[test]
    fn the_paperclip_is_on_only_for_this_computers_team_and_says_why_it_is_off() {
        let connection = |validated: ValidatedHost, with_runtime: bool| Connection {
            app: None,
            scope: crate::account_scope::AccountScope::synthetic(b"attach-tests"),
            host: ExecutionHost::Local,
            validated,
            runtime: None,
            local_wrapper: with_runtime.then(|| PathBuf::from("/nonexistent/jht")),
            local_runtime: with_runtime.then(|| PathBuf::from("/nonexistent/runtime")),
            local_owner_marker: None,
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        };
        assert_eq!(attach_refusal(&connection(ValidatedHost::Local, false)), Some("attach_not_connected"));
        let vps = ValidatedHost::Vps {
            address: "203.0.113.7".into(),
            user: "jht".into(),
            port: 22,
            key_path: PathBuf::from("/nonexistent/key"),
            known_hosts: PathBuf::from("/nonexistent/known_hosts"),
        };
        assert_eq!(attach_refusal(&connection(vps, true)), Some("attach_vps"));
        let local = attach_refusal(&connection(ValidatedHost::Local, true));
        if cfg!(any(target_os = "macos", target_os = "linux")) {
            assert_eq!(local, None);
        } else {
            assert_eq!(local, Some("attach_platform"));
        }
    }

    #[test]
    fn the_person_reads_one_sentence_in_their_language_and_the_assistant_gets_the_path_behind_it() {
        // a document says «my CV»; a picture or a plain text, which is not known to be one, says «a file»
        for (file, cv) in [
            ("cv-20261028-153045.pdf", true),
            ("cv-20261028-153045.docx", true),
            ("cv-20261028-153045.odt", true),
            ("cv-20261028-153045.rtf", true),
            ("cv-20261028-153045.txt", false),
            ("cv-20261028-153045.md", false),
            ("cv-20261028-153045.png", false),
            ("cv-20261028-153045.jpg", false),
            ("cv-20261028-153045-2.jpg", false),
        ] {
            let path = format!("/jht_user/allegati/{file}");
            let mut said = std::collections::HashSet::new();
            for locale in ["it", "en", "de", "es", "fr", "hu", "pt", "xx", ""] {
                let text = attachment_message(locale, file);
                // the Assistant gets the path of our copy, on one line, and what it is for
                assert!(text.ends_with(&format!(" [attachment for my profile: {path}]")), "{locale} {file}");
                assert!(!text.contains('\n') && !text.contains('{') && text.len() < 200, "{locale} {file}");
                // the person gets a sentence: no path, no folder, no name of a file, no brackets
                let (visible, _) = text.split_once(" [attachment").unwrap();
                assert!(!visible.contains("jht_user") && !visible.contains(file) && !visible.contains('/') && !visible.contains('['), "{locale} {file}");
                assert!(visible.ends_with('.') && visible.len() > 10, "{locale} {file}");
                said.insert(visible.to_owned());
            }
            // seven languages, seven sentences (an unknown one and the empty one are English)
            assert_eq!(said.len(), 7, "{file}");
            let it = attachment_message("it", file);
            assert_eq!(it.starts_with("Ho allegato il mio CV. ["), cv, "{file}");
            assert_eq!(it.starts_with("Ho allegato un file. ["), !cv, "{file}");
        }
        // the Portuguese of Portugal, as the rest of the product
        assert!(attachment_message("pt", "cv-1.pdf").starts_with("Anexei o meu CV. ["));
        assert!(attachment_message("pt", "cv-1.png").starts_with("Anexei um ficheiro. ["));
        assert!(attachment_message("xx", "cv-1.pdf").starts_with("I attached my CV. ["));
        assert!(attachment_message("xx", "cv-1.png").starts_with("I attached a file. ["));
    }

    #[test]
    fn the_window_opens_on_downloads_when_the_person_has_that_folder_and_never_on_documents() {
        let home = std::env::temp_dir().join(format!("jht-downloads-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(home.join("Documents")).unwrap();
        assert_eq!(downloads_of(&home), None);
        fs::write(home.join("Downloads"), b"a file, not a folder").unwrap();
        assert_eq!(downloads_of(&home), None);
        fs::remove_file(home.join("Downloads")).unwrap();
        fs::create_dir_all(home.join("Downloads")).unwrap();
        assert_eq!(downloads_of(&home), Some(home.join("Downloads")));
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_second_attachment_is_refused_while_one_is_in_hand_and_allowed_after() {
        // the flag alone, never the chat's state: that holds a Connection, and a test that drops one
        // does not start on Windows (see only_unix_tests_build_a_connection)
        let busy = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let first = AttachGuard::take(&busy).expect("the first is taken");
        assert!(AttachGuard::take(&busy).is_none());
        drop(first);
        assert!(AttachGuard::take(&busy).is_some());
    }

    #[test]
    fn the_command_checks_before_it_opens_the_window_and_tells_the_assistant_only_what_the_team_sees() {
        let source = include_str!("direct_chat.rs");
        let command = source
            .split("pub(crate) async fn direct_chat_attach(")
            .nth(1)
            .unwrap()
            .split("\n}\n")
            .next()
            .unwrap();
        let at = |needle: &str| command.find(needle).unwrap_or_else(|| panic!("missing {needle}"));
        // only the app's own window, only the Assistant, one at a time
        assert!(at("window_may_write(") < at("AttachGuard::take"));
        assert!(command.contains("agent_id != \"assistente\""));
        // the same gate as a message, then the window, then the copy, then the proof, then the message
        assert!(at("attach_target(") < at("blocking_pick_file()"));
        assert!(at("blocking_pick_file()") < at("chat_attachment::store("));
        assert!(at("chat_attachment::store(") < at("team_sees_the_copy("));
        assert!(at("team_sees_the_copy(") < at("send_impl("));
        // a copy the team does not see is taken back, and nothing is told
        assert!(at("chat_attachment::remove(") < at("send_impl("));
        // the text is ours: built from the name of our copy, never from the page or the person's file
        assert!(command.contains("attachment_message(&locale, &saved.file)"));
        // the window opens where the person keeps downloads, and the copy is named by the local clock
        assert!(command.contains("set_directory(") && command.contains("target.start_dir"));
        assert!(command.contains("local_wall_clock("));
        // the person's own name goes back to their screen, never into the message or a log
        assert!(!command.contains("attachment_message(&locale, &saved.display)"));
    }
}

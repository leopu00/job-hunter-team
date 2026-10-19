use crate::account_scope::{AccountScope, AccountScopeState};
use crate::existing_team_runtime::{self, ActivatedTarget, ChatOperation};
use crate::runtime_host::{
    run_program, run_ssh, run_ssh_command, set_private_dir_permissions, set_private_permissions, ssh_base_args,
    validate_host, ExecutionHost, ProcessResult, ValidatedHost,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
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
const REMOTE_PYTHON_STDIN: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70; grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' "$JHT_BIN" || exit 70; exec "$JHT_BIN" desktop-chat python"#;

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

#[derive(Default)]
pub(crate) struct DirectChatState {
    inner: Arc<DirectChatInner>,
}

#[derive(Default)]
struct DirectChatInner {
    connection: Mutex<Option<Connection>>,
    subscribers: Mutex<Vec<Channel<DirectChatEvent>>>,
    send_lock: Mutex<()>,
}

struct Connection {
    app: Option<tauri::AppHandle>,
    scope: AccountScope,
    host: ExecutionHost,
    validated: ValidatedHost,
    runtime: Option<ActivatedTarget>,
    local_wrapper: Option<PathBuf>,
    local_owner_marker: Option<PathBuf>,
    control_path: Option<PathBuf>,
    tunnel: Option<Child>,
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
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatMessage {
    id: String,
    role: String,
    text: String,
    at: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct DirectChatPage {
    messages: Vec<DirectChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cursor: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatReceipt {
    client_message_id: String,
    accepted: bool,
    message_id: String,
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
    code: &'static str,
}
fn failure(code: &'static str) -> DirectChatError {
    DirectChatError { code }
}
fn status(state: &'static str, code: Option<&'static str>) -> DirectChatStatus {
    DirectChatStatus { state, code }
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

fn open_tunnel(host: &ValidatedHost) -> Result<(PathBuf, Child), DirectChatError> {
    let mut args = ssh_base_args(host).map_err(failure)?;
    let target = args.pop().ok_or_else(|| failure("invalid_host"))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let control_path = std::env::temp_dir().join(format!(
        "jht-direct-chat-{}-{stamp}.sock",
        std::process::id()
    ));
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
    let child = Command::new("ssh")
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| failure("tunnel_start_failed"))?;
    for _ in 0..40 {
        if check_tunnel(host, &control_path) {
            return Ok((control_path, child));
        }
        thread::sleep(Duration::from_millis(250));
    }
    let mut child = child;
    let _ = child.kill();
    let _ = child.wait();
    let _ = fs::remove_file(&control_path);
    Err(failure("tunnel_verify_failed"))
}

fn close_connection(connection: &mut Connection) {
    if let (Some(path), ValidatedHost::Vps { .. }) =
        (&connection.control_path, &connection.validated)
    {
        if let Ok(args) = control_args(&connection.validated, path, "exit") {
            let _ = run_program("ssh", &args, None, Duration::from_secs(5));
        }
        let _ = fs::remove_file(path);
    }
    if let Some(mut child) = connection.tunnel.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
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
            {
                crate::account_scope::verify_local_runtime_owner(
                    connection
                        .local_owner_marker
                        .as_deref()
                        .ok_or_else(|| failure("local_account_owner_unavailable"))?,
                    &connection.scope,
                )
                .map_err(failure)?;
                crate::onboarding::run_verified_local_wrapper(
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
                .and_then(|app| selected_or_own(app, &connection.scope, &connection.host).map_err(failure))?;
            if selected.as_ref().map(|target| (&target.team_id, &target.runtime)) != connection.runtime.as_ref().map(|target| (&target.team_id, &target.runtime)) {
                return Err(failure("existing_team_runtime_target_changed"));
            }
            let command = match (selected.as_ref(), remote_operation) {
                (Some(target), RemoteOperation::Probe) => existing_team_runtime::command(&target.runtime, "docker inspect --type container --format '{{.State.Running}}' \"$JHT_CID\"").map_err(failure)?,
                (Some(target), RemoteOperation::Python) => existing_team_runtime::python_command(&target.runtime).map_err(failure)?,
                (Some(target), RemoteOperation::Delivery(session)) => existing_team_runtime::delivery_command(&target.runtime, session).map_err(failure)?,
                (Some(target), RemoteOperation::Chat(operation)) => existing_team_runtime::chat_command(&target.runtime, &operation).map_err(failure)?,
                (None, RemoteOperation::Chat(_)) => return Err(failure("existing_team_runtime_target_changed")),
                (None, RemoteOperation::Probe) => REMOTE_CONTAINER_PROBE.to_owned(),
                (None, RemoteOperation::Python) => REMOTE_PYTHON_STDIN.to_owned(),
                (None, RemoteOperation::Delivery(session)) => delivery_command(session).ok_or_else(|| failure("invalid_agent"))?.to_owned(),
            };
            run_ssh_command(&connection.validated, &command, input, timeout, connection.control_path.as_deref()).map_err(failure)
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
            status("ready", None)
        }
        _ => status("error", Some("container_unavailable")),
    }
}

fn connect_impl(
    app: &tauri::AppHandle,
    scope: AccountScope,
    host: ExecutionHost,
) -> Result<Connection, DirectChatError> {
    let validated = crate::runtime_host::validate_host_for_scope(app, &host, &scope).map_err(failure)?;
    let runtime = if matches!(validated, ValidatedHost::Vps { .. }) {
        selected_or_own(app, &scope, &host).map_err(failure)?
    } else { None };
    let (local_wrapper, local_owner_marker, control_path, tunnel) = match &validated {
        ValidatedHost::Local => (
                Some(crate::onboarding::verified_local_wrapper_path(app).map_err(failure)?),
                Some(crate::account_scope::local_owner_marker_path(app).map_err(failure)?),
                None,
                None,
            ),
        ValidatedHost::Vps { .. } => {
            let (path, child) = open_tunnel(&validated)?;
            (None, None, Some(path), Some(child))
        }
    };
    let mut connection = Connection {
        app: Some(app.clone()),
        scope: scope.clone(),
        host,
        validated,
        runtime,
        local_wrapper,
        local_owner_marker,
        control_path,
        tunnel,
    };
    let state = probe(&connection);
    if state.state != "ready" {
        close_connection(&mut connection);
        return Err(failure(state.code.unwrap_or("connect_failed")));
    }
    persist_host(app, &scope, &connection.host)?;
    Ok(connection)
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
            *slot = Some(connection);
            let ready = status("ready", None);
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

/// The pinned target of an existing team, or `None` for a VPS the person made with the app: it has
/// no existing-team selection to find (`selected` refuses a VPS without one), it is theirs and
/// connected in full, and its chat goes through the host's wrapper. Only a scope with no candidate
/// and no selection is theirs: a half-saved existing team stays the refusal it is.
fn selected_or_own(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<Option<ActivatedTarget>, &'static str> {
    match existing_team_runtime::selected(app, scope, host) {
        Err("existing_team_runtime_selection_required")
            if existing_team_runtime::root(app).is_ok_and(|root| existing_team_runtime::own_vps_at(&root, scope)) =>
        {
            Ok(None)
        }
        other => other,
    }
}

/// A pinned team's chat goes through the fixed script of the container; a local team and a VPS
/// that was never pinned keep the path they had.
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
        255 => "tunnel_unavailable",
        _ => default,
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

fn window_may_write(label: &str) -> bool {
    label == "main"
}

/// Writing to an existing team's agent needs the full connection ("Collega e conferma") made in
/// this run of the app. The read-only view activates the same target and opens the same chat, so
/// it is decided here, in the native side, and not by the page: a chat opened read-only reads,
/// and a send is refused whatever the renderer asks.
fn link_allows_writing(runtime: Option<&ActivatedTarget>, full_link: impl Fn(&ActivatedTarget) -> bool) -> bool {
    runtime.map_or(true, full_link)
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
        if uses_pinned_chat(connection) {
            let result = run_chat(
                connection,
                ChatOperation::Read { agent: &agent_id, cursor: cursor.as_deref() },
                None,
                READ_TIMEOUT,
                "read_failed",
            )?;
            return parse_json::<DirectChatPage>(result, "read_failed");
        }
        parse_json::<DirectChatPage>(
            run_python(
                connection,
                CHAT_READ_PY,
                &json!({"agent":agent_id,"cursor":cursor}),
                READ_TIMEOUT,
            )?,
            "read_failed",
        )
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

/// One command does what the two used to: the turn is written once for its client id and goes to
/// the agent's terminal in the user's envelope. A terminal that is busy (alive, taking a turn) is
/// asked again with the same id, which writes nothing twice.
fn send_pinned(
    connection: &Connection,
    agent: &str,
    text: &str,
    client_id: &str,
) -> Result<DirectChatReceipt, DirectChatError> {
    if text.len() > MAX_CHAT_STDIN_BYTES {
        return Err(failure("invalid_request"));
    }
    let input = Zeroizing::new(text.as_bytes().to_vec());
    let mut attempt = 0;
    loop {
        attempt += 1;
        match run_chat(
            connection,
            ChatOperation::Send { agent, client_message_id: client_id },
            Some(&input),
            SEND_TIMEOUT,
            "send_failed",
        ) {
            Ok(result) => return parse_json(result, "send_verify_failed"),
            Err(error) if error.code == "agent_busy" && attempt < 3 => continue,
            Err(error) => return Err(error),
        }
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
    if !link_allows_writing(connection.runtime.as_ref(), |target| {
        existing_team_runtime::full_link_granted(&connection.scope, target)
    }) {
        return Err(failure("read_only_link"));
    }
    if uses_pinned_chat(connection) {
        return send_pinned(connection, &agent, &text, &client_id);
    }
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
        chat_failure, connection_config_path_at, delivery_command, hex_encode, link_allows_writing,
        parse_json, probe, session_for, status, valid_agent, verify_migration_local_host_at, window_may_write,
        Connection, DirectChatPage, ProcessResult, REMOTE_CONTAINER_PROBE, REMOTE_PYTHON_STDIN,
    };
    use crate::runtime_host::{ExecutionHost, ValidatedHost};

    #[test]
    fn every_exit_of_the_chat_script_is_a_code_of_the_catalog_and_the_link_losing_is_its_own() {
        for (code, expected) in [
            (2, "chat_runtime_outdated"),
            (70, "existing_team_runtime_target_changed"),
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
            (255, "tunnel_unavailable"),
            (1, "the_default"),
            (137, "the_default"),
        ] {
            assert_eq!(chat_failure(code, "the_default"), expected, "exit {code}");
        }
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
        assert!(!link_allows_writing(Some(&team), |_| false), "the read-only view reads, it never writes");
        assert!(link_allows_writing(Some(&team), |_| true), "the confirmed team is written to");
        assert!(link_allows_writing(None, |_| false), "a local team has no read-only view of this kind");
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
            local_owner_marker: Some(owner),
            control_path: None,
            tunnel: None,
        };
        assert_eq!(probe(&connection).state, "ready");

        fs::write(
            &wrapper,
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\nprintf 'private runtime detail' >&2\nexit 1\n",
        )
        .unwrap();
        let failed = probe(&connection);
        assert_eq!(failed.state, "error");
        assert_eq!(failed.code, Some("container_unavailable"));
        fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod assistance_registration_tests {
    use super::*;
    struct Temporary(PathBuf);
    impl Temporary {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "jht-assistance-register-{}-{nonce}",
                std::process::id()
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
}

use crate::account_scope::{AccountScope, AccountScopeState};
use crate::runtime_host::{
    run_program, run_ssh, set_private_dir_permissions, set_private_permissions, ssh_base_args,
    validate_host, ExecutionHost, ProcessResult, ValidatedHost,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
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
const REMOTE_CONTAINER_PROBE: &str = "docker inspect jht --format '{{.State.Running}}'";
const REMOTE_PYTHON_STDIN: &str = "docker exec -i jht python3 -c 'import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())'";

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
    scope: AccountScope,
    host: ExecutionHost,
    validated: ValidatedHost,
    local_wrapper: Option<PathBuf>,
    local_owner_marker: Option<PathBuf>,
    control_path: Option<PathBuf>,
    tunnel: Option<Child>,
}

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

fn persist_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<(), DirectChatError> {
    let path = connection_config_path(app, scope)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| failure("storage_unavailable"))?;
        set_private_dir_permissions(parent).map_err(failure)?;
    }
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    let bytes = serde_json::to_vec(host).map_err(|_| failure("storage_unavailable"))?;
    fs::write(&temporary, bytes).map_err(|_| failure("storage_unavailable"))?;
    set_private_permissions(&temporary).map_err(failure)?;
    fs::rename(&temporary, path).map_err(|_| failure("storage_unavailable"))
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
    remote_command: &'static str,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, DirectChatError> {
    match &connection.validated {
        ValidatedHost::Local => {
            #[cfg(target_os = "windows")]
            return Err(failure("local_runtime_unsupported"));
            #[cfg(not(target_os = "windows"))]
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
        ValidatedHost::Vps { .. } => run_ssh(
            &connection.validated,
            remote_command,
            input,
            timeout,
            connection.control_path.as_deref(),
        )
        .map_err(failure),
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
        REMOTE_CONTAINER_PROBE,
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
    let validated = validate_host(app, &host).map_err(failure)?;
    let (local_wrapper, local_owner_marker, control_path, tunnel) = match &validated {
        ValidatedHost::Local => {
            #[cfg(target_os = "windows")]
            return Err(failure("local_runtime_unsupported"));
            #[cfg(not(target_os = "windows"))]
            (
                Some(crate::onboarding::verified_local_wrapper_path(app).map_err(failure)?),
                Some(crate::account_scope::local_owner_marker_path(app).map_err(failure)?),
                None,
                None,
            )
        }
        ValidatedHost::Vps { .. } => {
            let (path, child) = open_tunnel(&validated)?;
            (None, None, Some(path), Some(child))
        }
    };
    let mut connection = Connection {
        scope: scope.clone(),
        host,
        validated,
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
        REMOTE_PYTHON_STDIN,
        Some(&input),
        timeout,
    );
    input.zeroize();
    result
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
        "capitano" => "docker exec -i jht sh -c 'msg=$(cat); exec jht-tmux-send CAPITANO \"$msg\"'",
        "assistente" => {
            "docker exec -i jht sh -c 'msg=$(cat); exec jht-tmux-send ASSISTENTE \"$msg\"'"
        }
        "mentor" => "docker exec -i jht sh -c 'msg=$(cat); exec jht-tmux-send MENTOR \"$msg\"'",
        "scout" => "docker exec -i jht sh -c 'msg=$(cat); exec jht-tmux-send SCOUT-1 \"$msg\"'",
        "analista" => {
            "docker exec -i jht sh -c 'msg=$(cat); exec jht-tmux-send ANALISTA-1 \"$msg\"'"
        }
        "scorer" => "docker exec -i jht sh -c 'msg=$(cat); exec jht-tmux-send SCORER-1 \"$msg\"'",
        "scrittore" => {
            "docker exec -i jht sh -c 'msg=$(cat); exec jht-tmux-send SCRITTORE-1 \"$msg\"'"
        }
        "critico" => "docker exec -i jht sh -c 'msg=$(cat); exec jht-tmux-send CRITICO \"$msg\"'",
        _ => return None,
    })
}

fn local_delivery_args(session: &str) -> [&str; 3] {
    ["desktop-chat", "send", session]
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
        delivery_command(&agent).ok_or_else(|| failure("invalid_agent"))?,
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
            delivery_command(&agent).ok_or_else(|| failure("invalid_agent"))?,
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
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    text: String,
    client_message_id: String,
) -> Result<DirectChatReceipt, DirectChatError> {
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
        connection_config_path_at, hex_encode, parse_json, probe, session_for, status, valid_agent,
        Connection, DirectChatPage, ProcessResult,
    };
    use crate::runtime_host::{ExecutionHost, ValidatedHost};

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
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\n[ \"$1:$2\" = desktop-chat:probe ] || exit 9\nprintf 'true\\n'\n",
        )
        .unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        let scope = crate::account_scope::AccountScope::synthetic(b"synthetic-account-a");
        let owner = dir.join(".desktop-account-scope");
        fs::write(&owner, format!("{}\n", scope.digest())).unwrap();
        let connection = Connection {
            scope,
            host: ExecutionHost::Local,
            validated: ValidatedHost::Local,
            local_wrapper: Some(wrapper.clone()),
            local_owner_marker: Some(owner),
            control_path: None,
            tunnel: None,
        };
        assert_eq!(probe(&connection).state, "ready");

        fs::write(
            &wrapper,
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nprintf 'private runtime detail' >&2\nexit 1\n",
        )
        .unwrap();
        let failed = probe(&connection);
        assert_eq!(failed.state, "error");
        assert_eq!(failed.code, Some("container_unavailable"));
        fs::remove_dir_all(dir).unwrap();
    }
}

//! Account-scoped #281 bridge. No renderer-selected transport or runtime pins.
//!
//! Invoke `closer_desktop_request({request})`: flat a093 request/reply, stable
//! `{ok:false,error:code}` on failure. The private producer supplies only
//! accounts/<existing-scope-digest>/closer-desktop-binding.json (600, <=8KiB):
//! {schema:1,host:<exact persisted ExecutionHost>,browser_runtime:
//!   {container_id,oci_revision,image_id,digest}}. No renderer setter exists.
//! Scope is locked in flight; current host and the private pin file are reread
//! before/after transport. No cached connection or fallback container exists.
//! The host bridge inspects the running exact CID, actual Image, OCI labels,
//! default/explicit linux-amd64 image and RepoDigest before each fixed exec1001.
//! Errors discard partial stdout and all stderr. 12MiB applies only here;
//! PNG remains <=8MiB. The outer SSH budget is15s, bridge budget12s plus cleanup.
//! queued is an acknowledgement, never a submission outcome. A timeout can
//! leave an already accepted remote action uncertain: there is no retry.
//! These pins and scope are technical transport authority, not #279 chat auth.
//! No SSH, account, final image, Windows transport or UI integration is proved
//! by the inert tests alone; those remain candidate review/collation gates.
use crate::{
    account_scope::AccountScopeState,
    direct_chat,
    runtime_host::{self, ExecutionHost, ValidatedHost},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File},
    io::Read,
    path::Path,
    sync::Mutex,
    time::Duration,
};
use tauri::Manager;

#[path = "closer_desktop_transport.rs"]
mod transport;
const BRIDGE: &str = include_str!("closer_desktop_bridge.py");
const REVISION: &str = "a0936ded520cc7c21cc3c1e136ca95b1080274f5";
const DIGEST: &str = "sha256:003557e92e857b3219471d210d582a02d4bdb7cbe65cc34b94cf966986f6a8a4";
const PNG_LIMIT: usize = 8 * 1024 * 1024;
const SAFE_INTEGER: u64 = (1 << 53) - 1;
static IN_FLIGHT: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct RuntimePin {
    container_id: String,
    oci_revision: String,
    image_id: String,
    digest: String,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Binding {
    schema: u8,
    host: ExecutionHost,
    browser_runtime: RuntimePin,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum Operation {
    Descriptor,
    Snapshot,
    DeleteSnapshot,
    Confirm,
    Handoff,
    Observe,
    Finish,
    Abandon,
    Frame,
    Input,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Request {
    op: Operation,
    #[serde(skip_serializing_if = "Option::is_none")]
    mission_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    position_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    review_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame_sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    x: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    y: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    button: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pressed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    key: Option<String>,
}
fn hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn id(value: Option<&String>) -> bool {
    value.is_some_and(|v| hex(v, 32))
}
fn valid_key(key: &str) -> bool {
    matches!(
        key,
        "BackSpace"
            | "Tab"
            | "Return"
            | "Escape"
            | "Delete"
            | "Home"
            | "End"
            | "Page_Up"
            | "Page_Down"
            | "Left"
            | "Right"
            | "Up"
            | "Down"
            | "Shift_L"
            | "Control_L"
            | "Alt_L"
    ) || (key.chars().count() == 1 && key.chars().all(|c| !c.is_control()))
}
fn parse_request(value: Value) -> Result<Request, &'static str> {
    if serde_json::to_vec(&value)
        .map_err(|_| "browser_request_invalid")?
        .len()
        > 4096
    {
        return Err("browser_request_invalid");
    }
    let object = value.as_object().ok_or("browser_request_invalid")?;
    if object.values().any(Value::is_null) {
        return Err("browser_request_invalid");
    }
    let request: Request =
        serde_json::from_value(value.clone()).map_err(|_| "browser_request_invalid")?;
    let mut keys = vec!["op"];
    if request.op != Operation::Descriptor {
        keys.extend(["mission_id", "position_id", "owner_id", "generation"]);
        if !id(request.mission_id.as_ref())
            || !id(request.owner_id.as_ref())
            || !request
                .position_id
                .is_some_and(|p| p > 0 && p <= SAFE_INTEGER)
            || request.generation != Some(1)
        {
            return Err("browser_request_invalid");
        }
    }
    match request.op {
        Operation::Confirm | Operation::Handoff => {
            keys.push("review_id");
            if !id(request.review_id.as_ref()) {
                return Err("browser_request_invalid");
            }
        }
        Operation::Snapshot | Operation::DeleteSnapshot => {
            keys.push("event_id");
            if !id(request.event_id.as_ref()) {
                return Err("browser_request_invalid");
            }
        }
        Operation::Frame | Operation::Input => {
            keys.extend(["display_id", "frame_sequence"]);
            if !id(request.display_id.as_ref())
                || !request.frame_sequence.is_some_and(|n| n <= SAFE_INTEGER)
            {
                return Err("browser_request_invalid");
            }
            if request.op == Operation::Input {
                keys.extend(["kind", "pressed"]);
                if request.pressed.is_none() {
                    return Err("browser_request_invalid");
                }
                match request.kind.as_deref() {
                    Some("pointer") => {
                        keys.extend(["x", "y", "button"]);
                        if !request.x.is_some_and(|n| n < 1440)
                            || !request.y.is_some_and(|n| n < 1000)
                            || !request.button.is_some_and(|n| n <= 5)
                        {
                            return Err("browser_request_invalid");
                        }
                    }
                    Some("key") => {
                        keys.push("key");
                        if !request.key.as_deref().is_some_and(valid_key) {
                            return Err("browser_request_invalid");
                        }
                    }
                    _ => return Err("browser_request_invalid"),
                }
            }
        }
        _ => {}
    }
    if object.len() != keys.len() || keys.iter().any(|k| !object.contains_key(*k)) {
        return Err("browser_request_invalid");
    }
    Ok(request)
}

impl Binding {
    fn validate(&self, host: &ExecutionHost) -> Result<(), &'static str> {
        let p = &self.browser_runtime;
        if self.schema != 1 || !matches!(host, ExecutionHost::Vps { .. }) || self.host != *host {
            return Err("browser_runtime_binding_required");
        }
        if !hex(&p.container_id, 64)
            || p.oci_revision != REVISION
            || p.digest != DIGEST
            || !p
                .image_id
                .strip_prefix("sha256:")
                .is_some_and(|v| hex(v, 64))
        {
            return Err("browser_binding_invalid");
        }
        Ok(())
    }
}

fn private_metadata(path: &Path, directory: bool) -> Result<(), &'static str> {
    let meta = fs::symlink_metadata(path).map_err(|_| "browser_runtime_binding_required")?;
    if meta.file_type().is_symlink()
        || (directory && !meta.is_dir())
        || (!directory && !meta.is_file())
    {
        return Err("browser_binding_invalid");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        // SAFETY: geteuid has no arguments or pointers.
        if meta.uid() != unsafe { libc::geteuid() }
            || meta.mode() & 0o022 != 0
            || (!directory && meta.mode() & 0o777 != 0o600)
        {
            return Err("browser_binding_invalid");
        }
    }
    #[cfg(windows)]
    {
        let acl = crate::private_acl::read_acl(path).map_err(|_| "browser_binding_invalid")?;
        let user = crate::private_acl::current_user_sid().map_err(|_| "browser_binding_invalid")?;
        if !crate::private_acl::grants_only_owner(&acl, &user) {
            return Err("browser_binding_invalid");
        }
    }
    Ok(())
}
fn read_binding(path: &Path, host: &ExecutionHost) -> Result<Binding, &'static str> {
    private_metadata(path.parent().ok_or("browser_binding_invalid")?, true)?;
    private_metadata(path, false)?;
    let mut options = File::options();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(|_| "browser_binding_invalid")?;
    let mut raw = Vec::new();
    Read::by_ref(&mut file)
        .take(8193)
        .read_to_end(&mut raw)
        .map_err(|_| "browser_binding_invalid")?;
    if raw.len() > 8192 {
        return Err("browser_binding_invalid");
    }
    let value: Value = serde_json::from_slice(&raw).map_err(|_| "browser_binding_invalid")?;
    let binding: Binding =
        serde_json::from_value(value.clone()).map_err(|_| "browser_binding_invalid")?;
    // ExecutionHost predates this adapter and tolerates unknown fields. This file does not.
    if value != serde_json::to_value(&binding).map_err(|_| "browser_binding_invalid")? {
        return Err("browser_binding_invalid");
    }
    binding.validate(host)?;
    Ok(binding)
}

#[derive(Debug, Deserialize, Serialize)]
struct Block {
    event_id: String,
    reason: String,
    action: String,
    screenshot_available: bool,
}
#[derive(Debug, Deserialize, Serialize)]
struct Reply {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    queued: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    deleted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mission_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    position_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    owner_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    review_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    phase: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input_ready: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    can_confirm: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    block: Option<Block>,
    #[serde(skip_serializing_if = "Option::is_none")]
    event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    png_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame_sequence: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    allowed_actions: Option<Vec<Operation>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stream_available: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gate_reason: Option<String>,
}
fn failure(code: &'static str) -> Value {
    json!({"ok":false,"error":code})
}
fn reason(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}
fn public_reply(raw: &[u8], request: &Request) -> Result<Value, &'static str> {
    if raw.len() > transport::OUTPUT_LIMIT {
        return Err("browser_response_too_large");
    }
    let reply: Reply = serde_json::from_slice(raw).map_err(|_| "browser_response_invalid")?;
    if !reply.ok {
        return Ok(
            json!({"ok":false,"error":reply.error.as_deref().filter(|v| reason(v)).unwrap_or("browser_response_invalid")}),
        );
    }
    if reply.error.is_some()
        || reply.mission_id.as_ref().is_some_and(|v| !hex(v, 32))
        || reply.owner_id.as_ref().is_some_and(|v| !hex(v, 32))
        || reply.review_id.as_ref().is_some_and(|v| !hex(v, 32))
        || reply.display_id.as_ref().is_some_and(|v| !hex(v, 32))
        || reply.event_id.as_ref().is_some_and(|v| !hex(v, 32))
        || reply.generation.is_some_and(|v| v != 1)
        || reply
            .position_id
            .is_some_and(|v| v == 0 || v > SAFE_INTEGER)
        || reply.frame_sequence.is_some_and(|v| v > SAFE_INTEGER)
        || reply.phase.as_deref().is_some_and(|v| !reason(v))
        || reply
            .gate_reason
            .as_deref()
            .is_some_and(|v| !v.is_empty() && !reason(v))
    {
        return Err("browser_response_invalid");
    }
    if let Some(block) = &reply.block {
        if !hex(&block.event_id, 32) || block.reason.len() > 512 || block.action.len() > 512 {
            return Err("browser_response_invalid");
        }
    }
    if request.op != Operation::Descriptor
        && request.op != Operation::DeleteSnapshot
        && (reply.mission_id != request.mission_id
            || reply.position_id != request.position_id
            || reply.owner_id != request.owner_id
            || reply.generation != request.generation)
    {
        return Err("browser_response_binding_mismatch");
    }
    if matches!(request.op, Operation::Frame | Operation::Input)
        && (reply.display_id != request.display_id
            || !reply
                .frame_sequence
                .is_some_and(|n| n >= request.frame_sequence.unwrap_or(0)))
    {
        return Err("browser_response_binding_mismatch");
    }
    if let Some(png) = &reply.png_base64 {
        if !matches!(request.op, Operation::Frame | Operation::Snapshot)
            || png.len() > PNG_LIMIT.div_ceil(3) * 4
            || png.len() % 4 != 0
        {
            return Err("browser_response_invalid");
        }
        let decoded = runtime_host::decode_base64(png).ok_or("browser_response_invalid")?;
        if decoded.len() > PNG_LIMIT || !decoded.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("browser_response_invalid");
        }
        if request.op == Operation::Frame
            && (reply.width != Some(1440) || reply.height != Some(1000))
        {
            return Err("browser_response_invalid");
        }
        if request.op == Operation::Snapshot && reply.event_id != request.event_id {
            return Err("browser_response_binding_mismatch");
        }
    } else if matches!(request.op, Operation::Frame | Operation::Snapshot) {
        return Err("browser_response_invalid");
    }
    serde_json::to_value(reply).map_err(|_| "browser_response_invalid")
}

fn ssh_args(host: &ValidatedHost) -> Result<Vec<std::ffi::OsString>, &'static str> {
    let mut args = runtime_host::ssh_base_args(host)?;
    args.splice(
        0..0,
        [
            "-T".into(),
            "-o".into(),
            "RequestTTY=no".into(),
            "-o".into(),
            "ControlMaster=no".into(),
            "-o".into(),
            "ControlPath=none".into(),
        ],
    );
    // Only code compiled into the app enters argv; request and pins are stdin JSON.
    let encoded: String = BRIDGE
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    args.push(format!("python3 -I -c 'exec(bytes.fromhex(\"{encoded}\"))'").into());
    Ok(args)
}
fn execute(
    app: &tauri::AppHandle,
    scopes: &AccountScopeState,
    expected: &crate::account_scope::AccountScope,
    request: Request,
) -> Result<Value, &'static str> {
    let _scope = scopes.lock_expected(expected)?;
    let _flight = IN_FLIGHT.try_lock().map_err(|_| "browser_busy")?;
    let host = direct_chat::load_persisted_host(app, expected)?;
    let validated = runtime_host::validate_host(app, &host)?;
    if !matches!(validated, ValidatedHost::Vps { .. }) {
        return Err("browser_runtime_binding_required");
    }
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "storage_unavailable")?;
    let accounts = root.join("accounts");
    private_metadata(&accounts, true)?;
    let path = accounts
        .join(expected.digest())
        .join("closer-desktop-binding.json");
    let binding = read_binding(&path, &host)?;
    let input = serde_json::to_vec(&json!({"runtime":binding.browser_runtime,"request":request}))
        .map_err(|_| "browser_request_invalid")?;
    if direct_chat::load_persisted_host(app, expected)? != host {
        return Err("browser_connection_changed");
    }
    runtime_host::validate_host(app, &host)?;
    let output = transport::run_bounded(
        "ssh",
        &ssh_args(&validated)?,
        &input,
        Duration::from_secs(15),
    )?;
    if direct_chat::load_persisted_host(app, expected)? != host {
        return Err("browser_connection_changed");
    }
    runtime_host::validate_host(app, &host)?;
    if read_binding(&path, &host)?.browser_runtime != binding.browser_runtime {
        return Err("browser_connection_changed");
    }
    public_reply(&output, &request)
}

#[tauri::command]
pub(crate) async fn closer_desktop_request(
    app: tauri::AppHandle,
    scopes: tauri::State<'_, AccountScopeState>,
    request: Value,
) -> Value {
    let request = match parse_request(request) {
        Ok(value) => value,
        Err(code) => return failure(code),
    };
    let expected = match scopes.active() {
        Ok(value) => value,
        Err(code) => return failure(code),
    };
    let scopes = scopes.inner().clone();
    match tauri::async_runtime::spawn_blocking(move || execute(&app, &scopes, &expected, request))
        .await
    {
        Ok(Ok(reply)) => reply,
        Ok(Err(code)) => failure(code),
        Err(_) => failure("browser_transport_unavailable"),
    }
}

#[cfg(test)]
#[path = "closer_desktop_tests.rs"]
mod tests;

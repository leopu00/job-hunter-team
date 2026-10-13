//! Account-scoped, producer-delivered target for an already existing team.
//!
//! The candidate is written outside the renderer from a custodial receipt.
//! The app only activates it after the existing-team identity probe succeeds.
//! A legacy container name is never a fallback once activation exists.

use crate::{
    account_scope::{AccountScope, AccountScopeState},
    direct_chat,
    runtime_host::{run_ssh, set_private_dir_permissions, set_private_permissions, ExecutionHost},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};

const CANDIDATE_FILE: &str = "existing-team-runtime-candidate.json";
const SELECTION_FILE: &str = "existing-team-runtime-selection.json";
const MAX_BYTES: usize = 8192;
const READ_TIMEOUT: Duration = Duration::from_secs(15);

const POSITIONS_READ_PY: &str = r#"import json,sqlite3,sys
def fail(code): print(json.dumps({'ok':False,'error':code},separators=(',',':'))); raise SystemExit(0)
try: req=json.loads(sys.stdin.readline())
except Exception: fail('positions_request_invalid')
if not isinstance(req,dict) or set(req)-{'op','filters','id'}: fail('positions_request_invalid')
op=req.get('op')
if op not in ('list','detail','facets'): fail('positions_request_invalid')
if op=='detail' and (set(req)!={'op','id'} or not isinstance(req['id'],str) or not req['id'].isdigit() or len(req['id'])>20): fail('positions_request_invalid')
if op=='facets' and set(req)!={'op'}: fail('positions_request_invalid')
if op=='list' and (set(req)-{'op','filters'} or (req.get('filters') is not None and not isinstance(req.get('filters'),dict))): fail('positions_request_invalid')
try:
 db=sqlite3.connect('file:/jht_home/jobs.db?mode=ro',uri=True); db.row_factory=sqlite3.Row; db.execute('PRAGMA query_only=ON')
 cols={r[1] for r in db.execute('PRAGMA table_info(positions)')}
except Exception: fail('positions_unavailable')
fields=[c for c in ('id','legacy_id','title','company','location','remote_type','url','source','found_at','status','role_family','loc_country','loc_city','write_requested') if c in cols]
if not fields: fail('positions_unavailable')
def rowdict(rows): return [dict(zip(fields,row)) for row in rows]
if op=='detail':
 try: rows=db.execute('SELECT '+','.join(fields)+' FROM positions WHERE id=? LIMIT 1',(int(req['id']),)).fetchall()
 except Exception: fail('positions_unavailable')
 position=rowdict(rows)[0] if rows else None
 if position is None: print(json.dumps({'ok':True,'data':None},separators=(',',':'))); raise SystemExit(0)
 pid=position.get('id'); score=None; highlights=[]; company=None; application=None; tickets=[]
 try: score=dict(db.execute('SELECT * FROM scores WHERE position_id=? AND (deleted_at IS NULL OR 1=1) LIMIT 1',(pid,)).fetchone() or [])
 except Exception: score=None
 try: highlights=[dict(r) for r in db.execute('SELECT * FROM position_highlights WHERE position_id=? ORDER BY type',(pid,)).fetchall()]
 except Exception: highlights=[]
 try: application=dict(db.execute('SELECT * FROM applications WHERE position_id=? LIMIT 1',(pid,)).fetchone() or [])
 except Exception: application=None
 try:
  cid=position.get('company_id'); company=dict(db.execute('SELECT * FROM companies WHERE id=? LIMIT 1',(cid,)).fetchone() or []) if cid is not None else None
 except Exception: company=None
 try:
  legacy=position.get('legacy_id'); tickets=[dict(r) for r in db.execute('SELECT id,position_legacy_id,request_text,kind,status,assigned_agent,response_text,created_at,resolved_at FROM position_tickets WHERE position_legacy_id=? ORDER BY created_at DESC,id DESC',(legacy,))] if legacy is not None else []
 except Exception: tickets=[]
 print(json.dumps({'ok':True,'data':{'position':position,'score':score,'highlights':highlights,'company':company,'application':application,'tickets':tickets,'userNote':None,'exclusionEventAt':None}},separators=(',',':'))); raise SystemExit(0)
if op=='facets':
 try:
  rows=db.execute('SELECT p.id,p.status,p.title,p.company,p.role_family,p.loc_country,p.loc_city,(SELECT total_score FROM scores s WHERE s.position_id=p.id LIMIT 1),(SELECT critic_score FROM applications a WHERE a.position_id=p.id LIMIT 1) FROM positions p ORDER BY p.id LIMIT 600').fetchall()
 except Exception: fail('positions_unavailable')
 items=[{'id':str(r[0]),'status':r[1],'title':r[2],'company':r[3],'role_family':r[4],'loc_country':r[5],'loc_city':r[6],'score':r[7],'critic_score':r[8]} for r in rows]
 print(json.dumps({'ok':True,'data':{'items':items}},separators=(',',':'))); raise SystemExit(0)
f=req.get('filters') or {}; allowed={'statuses','remoteTypes','sources','q','limit','offset'}
if set(f)-allowed: fail('positions_request_invalid')
where=[]; args=[]
for key,column in (('statuses','status'),('remoteTypes','remote_type'),('sources','source')):
 values=f.get(key)
 if values is not None:
  if column not in cols or not isinstance(values,list) or not values or len(values)>32 or any(not isinstance(v,str) or len(v)>80 for v in values): fail('positions_request_invalid')
  where.append(column+' IN ('+','.join('?' for _ in values)+')'); args.extend(values)
q=f.get('q')
if q is not None:
 if not isinstance(q,str) or len(q)>60: fail('positions_request_invalid')
 searchable=[c for c in ('title','company','loc_city','loc_country','role_family','source') if c in cols]
 if q and searchable:
  where.append('('+' OR '.join('LOWER('+c+') LIKE ? ESCAPE "\\"' for c in searchable)+')'); args.extend(['%'+q.lower().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%']*len(searchable))
limit=f.get('limit',100); offset=f.get('offset',0)
if not isinstance(limit,int) or not 1<=limit<=600 or not isinstance(offset,int) or not 0<=offset<=100000: fail('positions_request_invalid')
try:
 sql='SELECT '+','.join(fields)+' FROM positions'+((' WHERE '+' AND '.join(where)) if where else '')+' ORDER BY found_at DESC, id ASC LIMIT ? OFFSET ?'
 rows=db.execute(sql,args+[limit,offset]).fetchall()
except Exception: fail('positions_unavailable')
items=[]
for row in rowdict(rows):
 try: row['score']=db.execute('SELECT total_score FROM scores WHERE position_id=? LIMIT 1',(row.get('id'),)).fetchone()[0]
 except Exception: row['score']=None
 try:
  a=db.execute('SELECT critic_score,critic_verdict,written_at,applied_at FROM applications WHERE position_id=? LIMIT 1',(row.get('id'),)).fetchone()
  row['critic_score']=a[0] if a else None; row['critic_verdict']=a[1] if a else None; row['written_at']=a[2] if a else None; row['applied_at']=a[3] if a else None
 except Exception: row['critic_score']=row['critic_verdict']=row['written_at']=row['applied_at']=None
 items.append(row)
print(json.dumps({'ok':True,'data':{'items':items}},separators=(',',':')))
"#;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeTarget {
    pub(crate) container_id: String,
    pub(crate) image_id: String,
    pub(crate) platform_image_id: String,
    pub(crate) oci_revision: String,
    pub(crate) digest: String,
    pub(crate) os: String,
    pub(crate) architecture: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Candidate {
    schema: u8,
    host: ExecutionHost,
    team_id: String,
    runtime: RuntimeTarget,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Selection {
    schema: u8,
    host: ExecutionHost,
    team_id: String,
    candidate_sha256: String,
}

#[derive(Clone)]
pub(crate) struct ActivatedTarget {
    pub(crate) team_id: String,
    pub(crate) runtime: RuntimeTarget,
}

fn hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn team_id(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

fn valid_target(target: &RuntimeTarget) -> bool {
    hex(&target.container_id, 64)
        && target
            .image_id
            .strip_prefix("sha256:")
            .is_some_and(|value| hex(value, 64))
        && target
            .platform_image_id
            .strip_prefix("sha256:")
            .is_some_and(|value| hex(value, 64))
        && target.platform_image_id != target.image_id
        && hex(&target.oci_revision, 40)
        && target
            .digest
            .strip_prefix("sha256:")
            .is_some_and(|value| hex(value, 64))
        && target.os == "linux"
        && matches!(target.architecture.as_str(), "amd64" | "arm64")
}

fn account_dir(root: &Path, scope: &AccountScope) -> PathBuf {
    root.join("accounts").join(scope.digest())
}

fn path(root: &Path, scope: &AccountScope, name: &str) -> PathBuf {
    account_dir(root, scope).join(name)
}

fn private_file(
    path: &Path,
    missing: &'static str,
    invalid: &'static str,
) -> Result<(), &'static str> {
    let meta = fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            missing
        } else {
            invalid
        }
    })?;
    let parent = path.parent().ok_or(invalid)?;
    let parent_meta = fs::symlink_metadata(parent).map_err(|_| invalid)?;
    if meta.file_type().is_symlink()
        || !meta.file_type().is_file()
        || meta.len() == 0
        || meta.len() > MAX_BYTES as u64
        || parent_meta.file_type().is_symlink()
        || !parent_meta.is_dir()
    {
        return Err(invalid);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if meta.uid() != unsafe { libc::geteuid() }
            || meta.uid() != parent_meta.uid()
            || meta.permissions().mode() & 0o777 != 0o600
            || parent_meta.permissions().mode() & 0o022 != 0
        {
            return Err(invalid);
        }
    }
    Ok(())
}

fn read_bytes(
    path: &Path,
    missing: &'static str,
    invalid: &'static str,
) -> Result<Vec<u8>, &'static str> {
    private_file(path, missing, invalid)?;
    let mut options = File::options();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options.open(path).map_err(|_| invalid)?;
    let mut bytes = Vec::new();
    file.by_ref()
        .take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid)?;
    if bytes.len() > MAX_BYTES {
        return Err(invalid);
    }
    Ok(bytes)
}

fn root(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| "existing_team_runtime_unavailable")
}

fn read_candidate_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(Candidate, String), &'static str> {
    let bytes = read_bytes(
        &path(root, scope, CANDIDATE_FILE),
        "existing_team_runtime_candidate_required",
        "existing_team_runtime_candidate_invalid",
    )?;
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "existing_team_runtime_candidate_invalid")?;
    let candidate: Candidate = serde_json::from_value(value.clone())
        .map_err(|_| "existing_team_runtime_candidate_invalid")?;
    if value
        != serde_json::to_value(&candidate)
            .map_err(|_| "existing_team_runtime_candidate_invalid")?
        || candidate.schema != 1
        || !team_id(&candidate.team_id)
        || !valid_target(&candidate.runtime)
    {
        return Err("existing_team_runtime_candidate_invalid");
    }
    Ok((candidate, sha256(&bytes)))
}

/// Reads the producer-delivered candidate and binds it to the explicit
/// existing-team request. It does not activate or persist anything.
pub(crate) fn candidate_for_request(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
    team: &str,
) -> Result<ActivatedTarget, &'static str> {
    let (candidate, _) = read_candidate_at(&root(app)?, scope)?;
    if candidate.host != *host || candidate.team_id != team {
        return Err("existing_team_runtime_candidate_mismatch");
    }
    Ok(ActivatedTarget {
        team_id: candidate.team_id,
        runtime: candidate.runtime,
    })
}

fn write_selection_at(
    root: &Path,
    scope: &AccountScope,
    candidate: &Candidate,
    hash: &str,
) -> Result<(), &'static str> {
    let parent = account_dir(root, scope);
    fs::create_dir_all(&parent).map_err(|_| "existing_team_runtime_unavailable")?;
    set_private_dir_permissions(&parent).map_err(|_| "existing_team_runtime_unavailable")?;
    let destination = path(root, scope, SELECTION_FILE);
    if fs::symlink_metadata(&destination).is_ok() {
        return Err("existing_team_runtime_already_selected");
    }
    let payload = serde_json::to_vec(&Selection {
        schema: 1,
        host: candidate.host.clone(),
        team_id: candidate.team_id.clone(),
        candidate_sha256: hash.to_owned(),
    })
    .map_err(|_| "existing_team_runtime_unavailable")?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "existing_team_runtime_unavailable")?
        .as_nanos();
    let temporary = destination.with_extension(format!("tmp-{}-{nonce}", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "existing_team_runtime_unavailable")?;
    let result = (|| {
        set_private_permissions(&temporary).map_err(|_| "existing_team_runtime_unavailable")?;
        file.write_all(&payload)
            .map_err(|_| "existing_team_runtime_unavailable")?;
        file.sync_all()
            .map_err(|_| "existing_team_runtime_unavailable")?;
        drop(file);
        fs::rename(&temporary, &destination).map_err(|_| "existing_team_runtime_unavailable")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

/// Called only after the exact host/team identity and both required sessions
/// have passed the read-only remote probe.
pub(crate) fn activate(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
    team: &str,
) -> Result<(), &'static str> {
    let root = root(app)?;
    let (candidate, hash) = read_candidate_at(&root, scope)?;
    if candidate.host != *host || candidate.team_id != team {
        return Err("existing_team_runtime_candidate_mismatch");
    }
    write_selection_at(&root, scope, &candidate, &hash)
}

/// Returns none for an ordinary connection. Once a selection exists, every
/// operation must see the same candidate bytes, host and team or fail closed.
pub(crate) fn selected(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<Option<ActivatedTarget>, &'static str> {
    let root = root(app)?;
    let selection_path = path(&root, scope, SELECTION_FILE);
    if let Err(error) = fs::symlink_metadata(&selection_path) {
        return if error.kind() == std::io::ErrorKind::NotFound {
            Ok(None)
        } else {
            Err("existing_team_runtime_selection_invalid")
        };
    }
    let bytes = read_bytes(
        &selection_path,
        "existing_team_runtime_selection_invalid",
        "existing_team_runtime_selection_invalid",
    )?;
    let value: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| "existing_team_runtime_selection_invalid")?;
    let selection: Selection = serde_json::from_value(value.clone())
        .map_err(|_| "existing_team_runtime_selection_invalid")?;
    if value
        != serde_json::to_value(&selection)
            .map_err(|_| "existing_team_runtime_selection_invalid")?
        || selection.schema != 1
        || !team_id(&selection.team_id)
        || !hex(&selection.candidate_sha256, 64)
    {
        return Err("existing_team_runtime_selection_invalid");
    }
    let (candidate, hash) = read_candidate_at(&root, scope)?;
    if selection.host != *host
        || candidate.host != *host
        || selection.team_id != candidate.team_id
        || selection.candidate_sha256 != hash
    {
        return Err("existing_team_runtime_target_changed");
    }
    Ok(Some(ActivatedTarget {
        team_id: candidate.team_id,
        runtime: candidate.runtime,
    }))
}

/// Prefixes a source-owned operation with a fresh CID/index/manifest check.
/// The descriptor is intentionally distinct from the container image index.
pub(crate) fn command(target: &RuntimeTarget, operation: &str) -> Result<String, &'static str> {
    if !valid_target(target) {
        return Err("existing_team_runtime_candidate_invalid");
    }
    Ok(format!(
        r#"set -eu
JHT_CID='{cid}'; JHT_IMAGE='{image}'; JHT_PLATFORM_IMAGE='{platform}'; JHT_REVISION='{revision}'; JHT_DIGEST='{digest}'; JHT_PLATFORM='{os}/{architecture}'
JHT_CONTAINER="$(docker inspect --type container --format '{{{{.Id}}}}|{{{{.Image}}}}|{{{{.State.Running}}}}|{{{{index .Config.Labels \"org.opencontainers.image.revision\"}}}}|{{{{.ImageManifestDescriptor.Digest}}}}' "$JHT_CID")" || exit 70
[ "$JHT_CONTAINER" = "$JHT_CID|$JHT_IMAGE|true|$JHT_REVISION|$JHT_PLATFORM_IMAGE" ] || exit 70
JHT_DEFAULT="$(docker image inspect --format '{{{{.Id}}}}|{{{{.Os}}}}|{{{{.Architecture}}}}|{{{{index .Config.Labels \"org.opencontainers.image.revision\"}}}}|{{{{range .RepoDigests}}}}{{{{.}}}},{{{{end}}}}' "$JHT_IMAGE")" || exit 70
case "$JHT_DEFAULT" in "$JHT_IMAGE|"$JHT_PLATFORM"|$JHT_REVISION|"*"@$JHT_DIGEST"*) ;; *) exit 70 ;; esac
JHT_EXPLICIT="$(docker image inspect --platform "$JHT_PLATFORM" --format '{{{{.Id}}}}|{{{{.Os}}}}|{{{{.Architecture}}}}|{{{{index .Config.Labels \"org.opencontainers.image.revision\"}}}}|{{{{range .RepoDigests}}}}{{{{.}}}},{{{{end}}}}' "$JHT_IMAGE")" || exit 70
case "$JHT_EXPLICIT" in "$JHT_PLATFORM_IMAGE|"$JHT_PLATFORM"|$JHT_REVISION|"*"@$JHT_DIGEST"*) ;; *) exit 70 ;; esac
{operation}"#,
        cid = target.container_id,
        image = target.image_id,
        platform = target.platform_image_id,
        revision = target.oci_revision,
        digest = target.digest,
        os = target.os,
        architecture = target.architecture
    ))
}

pub(crate) fn team_probe_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(
        target,
        r#"IFS= read -r JHT_EXPECTED_TEAM
[ "${#JHT_EXPECTED_TEAM}" -ge 16 ] && [ "${#JHT_EXPECTED_TEAM}" -le 128 ] || exit 64
case "$JHT_EXPECTED_TEAM" in *[!A-Za-z0-9_-]*) exit 64 ;; esac
docker exec -i "$JHT_CID" node -e '
const fs=require("fs"), expected=process.argv[1];
let cloud; try { cloud=JSON.parse(fs.readFileSync("/jht_home/cloud.json","utf8")); } catch { process.exit(72); }
if (typeof cloud.user_id!=="string" || cloud.user_id!==expected) process.exit(72);
let cfg={}; try { cfg=JSON.parse(fs.readFileSync("/jht_home/jht.config.json","utf8")); } catch {}
const provider=String(cfg.active_provider||"").toLowerCase();
const configured=["claude","anthropic","codex","openai","kimi","moonshot"].includes(provider);
const marker={claude:"/jht_home/.claude/.credentials.json",anthropic:"/jht_home/.claude/.credentials.json",codex:"/jht_home/.codex/auth.json",openai:"/jht_home/.codex/auth.json",kimi:"/jht_home/.kimi/credentials/kimi-code.json",moonshot:"/jht_home/.kimi/credentials/kimi-code.json"}[provider];
console.log("runtimeInstalled=1"); console.log("containerRunning=1"); console.log("providerConfigured="+(configured?"1":"0")); console.log("providerAuthenticated="+(marker&&fs.existsSync(marker)?"1":"0")); console.log("profileReady="+(fs.existsSync("/jht_home/profile/ready.flag")?"1":"0")); console.log("assistantWelcomed="+(fs.existsSync("/jht_home/profile/welcomed.flag")?"1":"0"));
' "$JHT_EXPECTED_TEAM" || exit $?
docker exec "$JHT_CID" tmux has-session -t CAPITANO 2>/dev/null || exit 73
docker exec "$JHT_CID" tmux has-session -t ASSISTENTE 2>/dev/null || exit 73
printf 'captainRunning=1\nassistantRunning=1\n'"#,
    )
}

pub(crate) fn python_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(target, "exec docker exec -i \"$JHT_CID\" python3 -c 'import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())'")
}

pub(crate) fn delivery_command(
    target: &RuntimeTarget,
    session: &str,
) -> Result<String, &'static str> {
    let session = match session {
        "CAPITANO" | "ASSISTENTE" | "MENTOR" | "SCOUT-1" | "ANALISTA-1" | "SCORER-1"
        | "SCRITTORE-1" | "CRITICO" => session,
        _ => return Err("invalid_agent"),
    };
    command(
        target,
        &format!(
            "docker exec -i \"$JHT_CID\" sh -c 'msg=$(cat); exec jht-tmux-send {session} \"$msg\"'"
        ),
    )
}

pub(crate) fn snapshot_command(target: &RuntimeTarget) -> Result<String, &'static str> {
    command(target, "docker exec \"$JHT_CID\" node -e 'const fs=require(\"fs\"); let c={}; try{c=JSON.parse(fs.readFileSync(\"/jht_home/jht.config.json\",\"utf8\"))}catch{}; const p=String(c.active_provider||\"\").toLowerCase(); const marker={claude:\"/jht_home/.claude/.credentials.json\",anthropic:\"/jht_home/.claude/.credentials.json\",codex:\"/jht_home/.codex/auth.json\",openai:\"/jht_home/.codex/auth.json\",kimi:\"/jht_home/.kimi/credentials/kimi-code.json\",moonshot:\"/jht_home/.kimi/credentials/kimi-code.json\"}[p]; const ok=[\"claude\",\"anthropic\",\"codex\",\"openai\",\"kimi\",\"moonshot\"].includes(p); console.log(\"runtimeInstalled=1\\ncontainerRunning=1\\nproviderConfigured=\"+(ok?\"1\":\"0\")+\"\\nproviderAuthenticated=\"+(marker&&fs.existsSync(marker)?\"1\":\"0\")+\"\\nprofileReady=\"+(fs.existsSync(\"/jht_home/profile/ready.flag\")?\"1\":\"0\")+\"\\nassistantWelcomed=\"+(fs.existsSync(\"/jht_home/profile/welcomed.flag\")?\"1\":\"0\"));'")
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

fn positions_failure(code: &'static str) -> Value {
    json!({"ok":false,"error":code})
}

/// Fixed read-only jobs-db bridge for the desktop adapter. The renderer sends
/// typed operation data only; it never supplies a host, container or SQL.
#[tauri::command]
pub(crate) async fn existing_team_positions_read(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    request: Value,
) -> Value {
    let request_bytes = match serde_json::to_vec(&request) {
        Ok(bytes) if bytes.len() <= 8192 => bytes,
        _ => return positions_failure("positions_request_invalid"),
    };
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return positions_failure("account_scope_unavailable"),
    };
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(|_| "account_scope_changed")?;
        let host = direct_chat::load_persisted_host(&app, &worker_expected)?;
        let validated =
            crate::runtime_host::validate_host_for_scope(&app, &host, &worker_expected)?;
        let target =
            selected(&app, &worker_expected, &host)?.ok_or("existing_team_runtime_required")?;
        let command = python_command(&target.runtime)?;
        let mut input = hex_encode(POSITIONS_READ_PY.as_bytes()).into_bytes();
        input.push(b'\n');
        input.extend_from_slice(&request_bytes);
        input.push(b'\n');
        let output = run_ssh(&validated, &command, Some(&input), READ_TIMEOUT, None)
            .map_err(|_| "positions_unavailable")?;
        if !output.success() || output.stdout.len() > 2 * 1024 * 1024 {
            return Err("positions_unavailable");
        }
        let reply: Value =
            serde_json::from_slice(&output.stdout).map_err(|_| "positions_unavailable")?;
        let object = reply.as_object().ok_or("positions_unavailable")?;
        if object.get("ok").and_then(Value::as_bool) == Some(true)
            && object.len() == 2
            && object.contains_key("data")
        {
            return Ok(reply);
        }
        let error = object
            .get("error")
            .and_then(Value::as_str)
            .filter(|v| matches!(*v, "positions_request_invalid" | "positions_unavailable"))
            .ok_or("positions_unavailable")?;
        Ok(positions_failure(error))
    })
    .await
    .unwrap_or_else(|_| Err("positions_unavailable"));
    if scopes.lock_expected(&expected).is_err() {
        return positions_failure("account_scope_changed");
    }
    result.unwrap_or_else(positions_failure)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target() -> RuntimeTarget {
        RuntimeTarget {
            container_id: "a".repeat(64),
            image_id: format!("sha256:{}", "b".repeat(64)),
            platform_image_id: format!("sha256:{}", "c".repeat(64)),
            oci_revision: "d".repeat(40),
            digest: format!("sha256:{}", "e".repeat(64)),
            os: "linux".into(),
            architecture: "amd64".into(),
        }
    }

    #[test]
    fn target_command_keeps_container_index_and_platform_descriptor_distinct() {
        let command = command(&target(), "true").unwrap();
        assert!(command.contains("JHT_IMAGE='sha256:"));
        assert!(command.contains("JHT_PLATFORM_IMAGE='sha256:"));
        assert!(command.contains("ImageManifestDescriptor.Digest"));
        assert!(command.contains("--platform \"$JHT_PLATFORM\""));
        assert!(!command.contains("docker exec jht"));
        assert!(!command.contains("docker inspect jht"));
    }

    #[test]
    fn target_rejects_equal_index_and_platform_descriptor() {
        let mut invalid = target();
        invalid.platform_image_id = invalid.image_id.clone();
        assert_eq!(
            command(&invalid, "true"),
            Err("existing_team_runtime_candidate_invalid")
        );
    }
}

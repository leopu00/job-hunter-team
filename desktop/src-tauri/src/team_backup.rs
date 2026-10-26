//! A backup of what the person owns in the team, saved on this computer.
//!
//! The contract is banda/piani/CONTRATTO-backup-20261024.md (approved). In short:
//! - What goes in (a closed list): a consistent snapshot of `jobs.db` (sqlite's own backup API, never a copy
//!   of the open file), `profile/`, `i18n-prefs.json`, `stats/work-hours.jsonl` (the counts of what the team did
//!   while it worked, numbers only), `jht.config.json` with every secret key emptied, the
//!   agents' `chat.jsonl` and the documents the applications point to when they sit in the team's home. Never:
//!   `cloud.json`, `.pairing-token`, `credentials/`, the providers' sign-ins (`.claude`, `.codex`, `.kimi`),
//!   `host.env`, `runtime/`, `logs/`, `secrets/`, caches and packages. A document an application points to goes in
//!   only as a document (pdf, docx, doc, odt, txt, md, tex, rtf): the path is written by agents that read other
//!   people's ads, so it is never trusted to name just anything under the home.
//! - It goes where the person says, on THIS computer (the «Save as» window of the system; never inside the
//!   team: the same disk is no safety net). It is one `.tar.gz` with a `manifest.json` that lists every file with its
//!   size and sha256 and what was left out.
//! - How: the chat's Python channel (this computer's team, an existing team's pinned container, the VPS the
//!   app made). The script builds the archive in a private temporary folder of the container and says its size
//!   and sha256; the app reads it in blocks, writes `.name.pid.part`, checks the sha256 of what it wrote and
//!   only then renames it. The temporary folder is removed whatever happens. A backup that was not checked is
//!   not called saved.
//! - Creating one is a read of the team's data: it works in the read-only view too. It needs the chat connected.
//! - `backup_inspect` opens a backup the person picks and checks it against its own manifest, in Rust, without
//!   touching the team and without extracting anything.
//! - Restoring is NOT here: it overwrites live data and has a contract of its own.

use crate::{
    account_scope::AccountScopeState,
    direct_chat::{failure, team_script_read, DirectChatError, DirectChatState},
    team_export::{ask_where, iso_day, part_path, window_may_export},
};
use base64::Engine;
use flate2::read::GzDecoder;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, SystemTime},
};
use tauri::{Emitter, State};
use tauri_plugin_dialog::DialogExt;

/// The most the app asks the script to send in one call.
const BLOCK: u64 = 512 * 1024;
/// The most a backup is: the script refuses more, and so does the app.
const MAX_ARCHIVE: u64 = 2 * 1024 * 1024 * 1024;
const PLAN_TIMEOUT: Duration = Duration::from_secs(120);
/// A snapshot of a big database, compressed, can take a few minutes over a slow disk.
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const BLOCK_TIMEOUT: Duration = Duration::from_secs(60);
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(60);
/// What a backup being inspected may hold before it is not believed to be one.
const INSPECT_MAX_ENTRIES: usize = 50_000;
const INSPECT_MAX_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const MANIFEST_MAX_BYTES: u64 = 8 * 1024 * 1024;
/// What may follow the last member of the tar: its padding to a whole record.
const DRAIN_MAX_BYTES: u64 = 1024 * 1024;

static RUNNING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

/// `plan`: what the backup would hold, and whether it can be made (a database, a size, free space), touching
/// nothing. `snapshot`: builds the archive in a private temporary folder and answers a token for it.
/// `read`: a block of that archive. `cleanup`: removes the folder. The only path a request can name is that
/// folder, by a token of 32 hex digits the script made itself.
const TEAM_BACKUP_PY: &str = r#"import base64,hashlib,io,json,os,re,shutil,sqlite3,stat,sys,tarfile,tempfile,time
HOME='/jht_home'
MAX_RAW=4*1024**3
MAX_FILE=64*1024*1024
MAX_ARCHIVE=2*1024**3
DOC_EXT=('pdf','docx','doc','odt','txt','md','tex','rtf')
BLOCK=524288
SLACK=64*1024*1024
DENY=('cloud.json','credentials','secrets','runtime','logs','host.env','suid','.claude','.codex','.kimi','.npm-global','.local','.cache','.config','.pairing-token','jobs.db')
SECRET=re.compile(r'(api[_-]?key|token|secret|passw|credential|authorization|bearer|private[_-]?key)',re.I)
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
STATS_HOUR=re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$')
def stats_int(v,lo,hi): return isinstance(v,int) and not isinstance(v,bool) and lo<=v<=hi
def stats_ok(r):
 if not isinstance(r,dict) or set(r)!={'hour','activeMinutes','scoreThreshold','weeklyDeltaPct'}: return False
 h=r['hour']
 if not isinstance(h,str) or not STATS_HOUR.match(h): return False
 try: time.strptime(h,'%Y-%m-%dT%H:%M:%SZ')
 except ValueError: return False
 d=r['weeklyDeltaPct']
 return stats_int(r['activeMinutes'],0,60) and stats_int(r['scoreThreshold'],0,100) and (d is None or stats_int(d,0,100))
def stats_clean(data):
 out=[]
 for line in data.split(b'\n')[:5000]:
  if not line.strip() or len(line)>512: continue
  try: r=json.loads(line.decode('utf-8'))
  except Exception: continue
  if stats_ok(r): out.append(json.dumps({k:r[k] for k in ('hour','activeMinutes','scoreThreshold','weeklyDeltaPct')},separators=(',',':')).encode('ascii')+b'\n')
 return b''.join(out)
def fail(code): emit({'ok':False,'error':code})
try: req=json.loads(sys.stdin.readline())
except Exception: fail('invalid_request')
if not isinstance(req,dict) or set(req)-{'op','token','offset'}: fail('invalid_request')
op=req.get('op')
if op not in ('plan','snapshot','read','cleanup'): fail('invalid_request')
def tokenpath(token):
 if not isinstance(token,str) or not re.match(r'^[0-9a-f]{32}$',token): fail('invalid_request')
 return os.path.join(tempfile.gettempdir(),'jht-backup-'+token)
def isdir(path):
 try: return stat.S_ISDIR(os.lstat(path).st_mode)
 except OSError: return False
if op=='read':
 folder=tokenpath(req.get('token')); offset=req.get('offset')
 if not isinstance(offset,int) or isinstance(offset,bool) or offset<0: fail('invalid_request')
 if not isdir(folder): fail('backup_snapshot_failed')
 try:
  with open(os.path.join(folder,'backup.tgz'),'rb') as f:
   f.seek(offset); data=f.read(BLOCK)
 except OSError: fail('backup_snapshot_failed')
 emit({'ok':True,'data':base64.b64encode(data).decode('ascii')})
if op=='cleanup':
 folder=tokenpath(req.get('token'))
 if isdir(folder): shutil.rmtree(folder,ignore_errors=True)
 emit({'ok':True})
if set(req)-{'op'}: fail('invalid_request')
home=os.path.realpath(HOME)
if not os.path.isfile(HOME+'/jobs.db'): fail('backup_no_database' if os.path.isdir(HOME) else 'read_failed')
excluded=[]
def regular(path):
 try: return stat.S_ISREG(os.lstat(path).st_mode)
 except OSError: return False
def candidates():
 found=[]; seen={'jobs.db'}
 def add(arc,path):
  if arc in seen: return
  seen.add(arc)
  try: size=os.lstat(path).st_size
  except OSError: excluded.append({'path':arc,'reason':'unreadable'}); return
  if size>MAX_FILE: excluded.append({'path':arc,'reason':'too_large'}); return
  found.append((arc,path,size))
 if regular(HOME+'/i18n-prefs.json'): add('i18n-prefs.json',HOME+'/i18n-prefs.json')
 if regular(HOME+'/stats/work-hours.jsonl'): add('stats/work-hours.jsonl',HOME+'/stats/work-hours.jsonl')
 base=HOME+'/profile'
 for root,dirs,files in os.walk(base,followlinks=False):
  dirs[:]=sorted(d for d in dirs if isdir(os.path.join(root,d)))
  for name in sorted(files):
   path=os.path.join(root,name)
   if regular(path): add('profile/'+os.path.relpath(path,base).replace(os.sep,'/'),path)
 agents=HOME+'/agents'
 try: names=sorted(os.listdir(agents))
 except OSError: names=[]
 for name in names:
  if re.match(r'^[a-z0-9][a-z0-9_-]*$',name) and isdir(os.path.join(agents,name)) and regular(os.path.join(agents,name,'chat.jsonl')):
   add('agents/'+name+'/chat.jsonl',os.path.join(agents,name,'chat.jsonl'))
 return found
def config_bytes():
 path=HOME+'/jht.config.json'
 if not regular(path): return None
 try:
  with open(path,'rb') as f: raw=f.read(MAX_FILE+1)
  if len(raw)>MAX_FILE: raise ValueError('big')
  value=json.loads(raw.decode('utf-8'))
 except Exception: excluded.append({'path':'jht.config.json','reason':'unreadable'}); return None
 def clean(item):
  if isinstance(item,dict): return {k:(None if SECRET.search(k) else clean(v)) for k,v in item.items()}
  if isinstance(item,list): return [clean(v) for v in item]
  return item
 return json.dumps(clean(value),indent=2,ensure_ascii=False).encode('utf-8')
def documents(db,found):
 try: have=[row[1] for row in db.execute('PRAGMA table_info(applications)')]
 except sqlite3.Error: return found
 columns=[c for c in ('cv_path','cl_path','cv_pdf_path','cl_pdf_path') if c in have]
 if not columns: return found
 known={arc for arc,_,_ in found}
 try: rows=db.execute('SELECT '+','.join(columns)+' FROM applications LIMIT 20000').fetchall()
 except sqlite3.Error: return found
 for row in rows:
  for value in row:
   if not isinstance(value,str) or not value or len(value)>1000 or '\x00' in value: continue
   absolute=os.path.abspath(value)
   if not absolute.startswith(HOME+'/'): excluded.append({'path':value[:200],'reason':'outside_home'}); continue
   rel=os.path.relpath(absolute,HOME).replace(os.sep,'/')
   parts=rel.split('/')
   if rel in known or any(p.startswith('.') for p in parts) or parts[0] in DENY:
    if rel not in known: excluded.append({'path':rel[:200],'reason':'not_allowed'})
    continue
   if '.' not in parts[-1] or parts[-1].rsplit('.',1)[-1].lower() not in DOC_EXT: excluded.append({'path':rel[:200],'reason':'not_a_document'}); continue
   if os.path.islink(absolute) or os.path.realpath(absolute)!=os.path.join(home,rel) or not regular(absolute): excluded.append({'path':rel[:200],'reason':'not_a_plain_file'}); continue
   try: size=os.lstat(absolute).st_size
   except OSError: continue
   if size>MAX_FILE: excluded.append({'path':rel[:200],'reason':'too_large'}); continue
   known.add(rel); found.append((rel,absolute,size))
 return found
def free(path):
 stats=os.statvfs(path); return stats.f_bavail*stats.f_frsize
def totals(found,config):
 raw=os.lstat(HOME+'/jobs.db').st_size+sum(s for _,_,s in found)+(len(config) if config else 0)
 return raw
def plan():
 db=sqlite3.connect('file:'+HOME+'/jobs.db?mode=ro',uri=True)
 try:
  found=documents(db,candidates()); config=config_bytes()
 finally: db.close()
 raw=totals(found,config)
 if raw>MAX_RAW: fail('backup_too_large')
 if free(tempfile.gettempdir())<raw+os.lstat(HOME+'/jobs.db').st_size+SLACK: fail('backup_no_space')
 return found,config,raw
if op=='plan':
 try: found,config,raw=plan()
 except SystemExit: raise
 except Exception: fail('backup_snapshot_failed')
 emit({'ok':True,'bytes':raw,'files':len(found)+1+(1 if config else 0),'excluded':len(excluded)})
try:
 found,config,raw=plan()
except SystemExit: raise
except Exception: fail('backup_snapshot_failed')
token=os.urandom(16).hex()
folder=tokenpath(token)
try:
 for entry in os.listdir(tempfile.gettempdir()):
  old=os.path.join(tempfile.gettempdir(),entry)
  if entry.startswith('jht-backup-') and isdir(old) and time.time()-os.lstat(old).st_mtime>6*3600: shutil.rmtree(old,ignore_errors=True)
except OSError: pass
try:
 os.mkdir(folder,0o700)
 snapshot=os.path.join(folder,'jobs.db')
 source=sqlite3.connect('file:'+HOME+'/jobs.db?mode=ro',uri=True); target=sqlite3.connect(snapshot)
 try:
  source.backup(target)
  if target.execute('PRAGMA quick_check').fetchone()[0]!='ok': raise ValueError('snapshot is not sound')
 finally: target.close(); source.close()
 listed=[]
 class Hashing(object):
  def __init__(self,handle): self.handle=handle; self.digest=hashlib.sha256()
  def read(self,size=-1):
   data=self.handle.read(size); self.digest.update(data); return data
 archive=os.path.join(folder,'backup.tgz')
 with tarfile.open(archive,'w:gz',format=tarfile.USTAR_FORMAT,compresslevel=6) as tar:
  def put(arc,reader,size,mtime):
   info=tarfile.TarInfo(arc); info.size=size; info.mtime=int(mtime); info.mode=0o600; info.uid=info.gid=0; info.uname=info.gname=''
   tar.addfile(info,reader)
  with open(snapshot,'rb') as handle:
   reader=Hashing(handle); put('jobs.db',reader,os.lstat(snapshot).st_size,time.time()); listed.append({'path':'jobs.db','bytes':os.lstat(snapshot).st_size,'sha256':reader.digest.hexdigest()})
  os.unlink(snapshot)
  if config is not None:
   put('jht.config.json',io.BytesIO(config),len(config),time.time()); listed.append({'path':'jht.config.json','bytes':len(config),'sha256':hashlib.sha256(config).hexdigest()})
  for arc,path,size in found:
   try:
    with open(path,'rb') as handle: data=handle.read(MAX_FILE+1)
   except OSError: excluded.append({'path':arc,'reason':'unreadable'}); continue
   if len(data)>MAX_FILE: excluded.append({'path':arc,'reason':'too_large'}); continue
   if arc=='stats/work-hours.jsonl': data=stats_clean(data)
   try: put(arc,io.BytesIO(data),len(data),os.lstat(path).st_mtime)
   except ValueError: excluded.append({'path':arc[:200],'reason':'name_too_long'}); continue
   listed.append({'path':arc,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
  manifest=json.dumps({'format':1,'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'files':listed,'excluded':excluded,'alwaysExcluded':sorted(d for d in DENY if d!='jobs.db')},indent=2,ensure_ascii=False).encode('utf-8')
  put('manifest.json',io.BytesIO(manifest),len(manifest),time.time())
 size=os.lstat(archive).st_size
 if size>MAX_ARCHIVE:
  shutil.rmtree(folder,ignore_errors=True); fail('backup_too_large')
 digest=hashlib.sha256()
 with open(archive,'rb') as handle:
  for chunk in iter(lambda: handle.read(1048576),b''): digest.update(chunk)
except SystemExit: raise
except Exception:
 shutil.rmtree(folder,ignore_errors=True); fail('backup_snapshot_failed')
emit({'ok':True,'token':token,'bytes':size,'sha256':digest.hexdigest(),'files':len(listed),'excluded':len(excluded)})"#;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct BackupOutcome {
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    files: Option<u64>,
}

/// One backup at a time: a second one is `backup_busy`.
struct RunGuard;

impl RunGuard {
    fn acquire() -> Result<Self, DirectChatError> {
        RUNNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).map_err(|_| failure("backup_busy"))?;
        CANCEL.store(false, Ordering::SeqCst);
        Ok(Self)
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, PartialEq, Eq)]
struct Plan {
    bytes: u64,
}

#[derive(Debug, PartialEq, Eq)]
struct Snapshot {
    token: String,
    bytes: u64,
    sha256: String,
    files: u64,
}

fn script_failure(reply: &Value, fallback: &'static str) -> DirectChatError {
    failure(match reply.get("error").and_then(Value::as_str) {
        Some("backup_no_database") => "backup_no_database",
        Some("backup_too_large") => "backup_too_large",
        Some("backup_no_space") => "backup_no_space",
        Some("backup_snapshot_failed") => "backup_snapshot_failed",
        Some("invalid_request") => "invalid_request",
        _ => fallback,
    })
}

fn hex64(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn parse_plan(reply: &Value) -> Result<Plan, DirectChatError> {
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(script_failure(reply, "read_failed"));
    }
    let bytes = reply.get("bytes").and_then(Value::as_u64).ok_or_else(|| failure("read_failed"))?;
    Ok(Plan { bytes })
}

fn parse_snapshot(reply: &Value) -> Result<Snapshot, DirectChatError> {
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(script_failure(reply, "backup_snapshot_failed"));
    }
    let bad = || failure("backup_snapshot_failed");
    let token = reply.get("token").and_then(Value::as_str).filter(|t| t.len() == 32 && t.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))).ok_or_else(bad)?;
    let bytes = reply.get("bytes").and_then(Value::as_u64).filter(|bytes| *bytes > 0).ok_or_else(bad)?;
    if bytes > MAX_ARCHIVE {
        return Err(failure("backup_too_large"));
    }
    let sha256 = reply.get("sha256").and_then(Value::as_str).filter(|s| hex64(s)).ok_or_else(bad)?;
    let files = reply.get("files").and_then(Value::as_u64).ok_or_else(bad)?;
    Ok(Snapshot { token: token.to_owned(), bytes, sha256: sha256.to_owned(), files })
}

/// A block of the archive, decoded: never more than asked, never past the end.
fn parse_block(reply: &Value, offset: u64, total: u64) -> Result<Vec<u8>, DirectChatError> {
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(script_failure(reply, "backup_snapshot_failed"));
    }
    let text = reply.get("data").and_then(Value::as_str).ok_or_else(|| failure("read_failed"))?;
    let data = base64::engine::general_purpose::STANDARD.decode(text).map_err(|_| failure("read_failed"))?;
    if data.len() as u64 > BLOCK || offset + data.len() as u64 > total {
        return Err(failure("read_failed"));
    }
    Ok(data)
}

/// How a transfer ended: whole, or stopped by the person.
#[derive(Debug, PartialEq, Eq)]
enum Pulled {
    Whole,
    Cancelled,
}

fn sha256_of(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            return Ok(hex(&digest.finalize()));
        }
        digest.update(&buffer[..read]);
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Reads the archive block by block into `part` (which must not be there), checks that what is on the disk is
/// the archive the script described, and leaves `part` only when it is. Anything else takes `part` away.
async fn pull<F, Fut>(part: &Path, snapshot: &Snapshot, mut next: F, progress: &(dyn Fn(&'static str, u64, u64) + Sync), cancelled: &(dyn Fn() -> bool + Sync)) -> Result<Pulled, DirectChatError>
where
    F: FnMut(u64) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<u8>, DirectChatError>>,
{
    let saving = |_: io::Error| failure("backup_save_failed");
    let mut file = OpenOptions::new().write(true).create_new(true).open(part).map_err(saving)?;
    let outcome = async {
        let mut offset = 0u64;
        let mut blocks = 0u64;
        while offset < snapshot.bytes {
            if cancelled() {
                return Ok(Pulled::Cancelled);
            }
            blocks += 1;
            // a team that sends a few bytes at a time would take for ever: on average a block is a sixty-fourth of the asked one
            if blocks > snapshot.bytes / (BLOCK / 64) + 64 {
                return Err(failure("read_failed"));
            }
            let data = next(offset).await?;
            if data.is_empty() {
                return Err(failure("read_failed"));
            }
            file.write_all(&data).map_err(saving)?;
            offset += data.len() as u64;
            progress("copy", offset, snapshot.bytes);
        }
        file.flush().and_then(|()| file.sync_all()).map_err(saving)?;
        progress("verify", 0, snapshot.bytes);
        // what is on the disk, not what went through the pipe
        let on_disk = fs::metadata(part).map_err(saving)?.len();
        let sum = sha256_of(part).map_err(saving)?;
        if on_disk != snapshot.bytes || sum != snapshot.sha256 {
            return Err(failure("backup_verify_failed"));
        }
        Ok(Pulled::Whole)
    }
    .await;
    drop(file);
    if !matches!(outcome, Ok(Pulled::Whole)) {
        let _ = fs::remove_file(part);
    }
    outcome
}

fn emit_progress(app: &tauri::AppHandle, phase: &'static str, done: u64, total: u64) {
    let _ = app.emit("backup-progress", json!({"phase": phase, "done": done, "total": total}));
}

async fn script(state: &State<'_, DirectChatState>, scopes: &State<'_, AccountScopeState>, request: Value, timeout: Duration) -> Result<Value, DirectChatError> {
    team_script_read(state, scopes, TEAM_BACKUP_PY, request, timeout).await
}

/// Makes a backup of the team's data in the file the person picks.
#[tauri::command]
pub(crate) async fn backup_create(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<BackupOutcome, DirectChatError> {
    if !window_may_export(window.label()) {
        return Err(failure("invalid_request"));
    }
    let _running = RunGuard::acquire()?;
    emit_progress(&app, "plan", 0, 0);
    // What can be told without the person choosing anything (no database, too big, no room) is told first.
    let plan = parse_plan(&script(&state, &scopes, json!({"op": "plan"}), PLAN_TIMEOUT).await?)?;
    let name = format!("jht-backup-{}.tar.gz", iso_day(SystemTime::now()));
    let Some(target) = ask_where(app.clone(), window, name, "tar.gz", "gz").await? else {
        return Ok(BackupOutcome { outcome: "cancelled", bytes: None, files: None });
    };
    emit_progress(&app, "snapshot", 0, plan.bytes);
    let snapshot = parse_snapshot(&script(&state, &scopes, json!({"op": "snapshot"}), SNAPSHOT_TIMEOUT).await?)?;
    let part = part_path(&target);
    let progress = |phase: &'static str, done: u64, total: u64| emit_progress(&app, phase, done, total);
    let cancelled = || CANCEL.load(Ordering::SeqCst);
    let pulled = {
        let (state, scopes, token, total) = (&state, &scopes, snapshot.token.clone(), snapshot.bytes);
        pull(
            &part,
            &snapshot,
            |offset| {
                let token = token.clone();
                async move {
                    let reply = script(state, scopes, json!({"op": "read", "token": token, "offset": offset}), BLOCK_TIMEOUT).await?;
                    parse_block(&reply, offset, total)
                }
            },
            &progress,
            &cancelled,
        )
        .await
    };
    // The folder in the team goes whatever happened above; a failure to remove it is not the backup's.
    let _ = script(&state, &scopes, json!({"op": "cleanup", "token": snapshot.token}), CLEANUP_TIMEOUT).await;
    match pulled? {
        Pulled::Cancelled => Ok(BackupOutcome { outcome: "cancelled", bytes: None, files: None }),
        Pulled::Whole => match fs::rename(&part, &target) {
            Ok(()) => Ok(BackupOutcome { outcome: "saved", bytes: Some(snapshot.bytes), files: Some(snapshot.files) }),
            Err(_) => {
                let _ = fs::remove_file(&part);
                Err(failure("backup_save_failed"))
            }
        },
    }
}

/// Stops the backup that is running, between two blocks; it takes its partial file and its folder away.
#[tauri::command]
pub(crate) fn backup_cancel(window: tauri::Window) -> Result<(), DirectChatError> {
    if !window_may_export(window.label()) {
        return Err(failure("invalid_request"));
    }
    if RUNNING.load(Ordering::SeqCst) {
        CANCEL.store(true, Ordering::SeqCst);
    }
    Ok(())
}

/// What a backup says it holds, as the page may show it: paths and sizes, never the contents.
#[derive(Debug, Serialize, PartialEq)]
pub(crate) struct Inspection {
    outcome: &'static str,
    manifest: Value,
    verified: bool,
    problems: Vec<String>,
}

struct Member {
    bytes: u64,
    sha256: String,
}

fn octal(field: &[u8]) -> Option<u64> {
    if field.first().is_some_and(|byte| byte & 0x80 != 0) {
        return None;
    }
    let text: String = field.iter().take_while(|byte| **byte != 0).map(|byte| *byte as char).collect();
    u64::from_str_radix(text.trim(), 8).ok()
}

fn cstring(field: &[u8]) -> String {
    String::from_utf8_lossy(&field[..field.iter().position(|byte| *byte == 0).unwrap_or(field.len())]).into_owned()
}

fn skip(reader: &mut impl Read, mut count: u64) -> io::Result<()> {
    let mut buffer = [0u8; 8192];
    while count > 0 {
        let take = count.min(buffer.len() as u64) as usize;
        reader.read_exact(&mut buffer[..take])?;
        count -= take as u64;
    }
    Ok(())
}

/// Reads a `.tar.gz` the way the script writes one (plain ustar, regular files) and checks it against its own
/// manifest. Nothing is extracted; anything that is not such a file is `backup_not_a_backup`.
fn inspect_archive(source: impl Read) -> Result<Inspection, DirectChatError> {
    let not = || failure("backup_not_a_backup");
    let mut reader = GzDecoder::new(source);
    let mut members: HashMap<String, Member> = HashMap::new();
    let mut manifest_bytes: Option<Vec<u8>> = None;
    let mut total = 0u64;
    let mut problems: Vec<String> = Vec::new();
    for index in 0.. {
        if index >= INSPECT_MAX_ENTRIES {
            return Err(not());
        }
        let mut header = [0u8; 512];
        reader.read_exact(&mut header).map_err(|_| not())?;
        if header.iter().all(|byte| *byte == 0) {
            break;
        }
        if &header[257..262] != b"ustar" {
            return Err(not());
        }
        let declared = octal(&header[148..156]).ok_or_else(not)?;
        let sum: u64 = header.iter().enumerate().map(|(at, byte)| if (148..156).contains(&at) { 32 } else { *byte as u64 }).sum();
        if sum != declared {
            return Err(not());
        }
        let size = octal(&header[124..136]).ok_or_else(not)?;
        let prefix = cstring(&header[345..500]);
        let name = if prefix.is_empty() { cstring(&header[0..100]) } else { format!("{prefix}/{}", cstring(&header[0..100])) };
        let padding = (512 - size % 512) % 512;
        match header[156] {
            b'5' => continue,
            b'0' | 0 => {}
            _ => return Err(not()),
        }
        total = total.saturating_add(size);
        if total > INSPECT_MAX_BYTES || (name == "manifest.json" && size > MANIFEST_MAX_BYTES) {
            return Err(not());
        }
        let mut digest = Sha256::new();
        let mut kept = (name == "manifest.json").then(Vec::new);
        let mut left = size;
        let mut buffer = vec![0u8; 64 * 1024];
        while left > 0 {
            let take = left.min(buffer.len() as u64) as usize;
            reader.read_exact(&mut buffer[..take]).map_err(|_| not())?;
            digest.update(&buffer[..take]);
            if let Some(kept) = kept.as_mut() {
                kept.extend_from_slice(&buffer[..take]);
            }
            left -= take as u64;
        }
        skip(&mut reader, padding).map_err(|_| not())?;
        if let Some(kept) = kept {
            manifest_bytes = Some(kept);
        } else if members.insert(name.clone(), Member { bytes: size, sha256: hex(&digest.finalize()) }).is_some() {
            problems.push(format!("duplicate:{name}"));
        }
    }
    // the rest of the stream, so that the gzip trailer (its CRC and its length) is checked too
    // (a tar ends in a few blocks of zeros; much more behind it is not one)
    io::copy(&mut (&mut reader).take(DRAIN_MAX_BYTES), &mut io::sink()).map_err(|_| not())?;
    if reader.read(&mut [0u8; 1]).map_err(|_| not())? != 0 {
        return Err(not());
    }
    let manifest: Value = serde_json::from_slice(&manifest_bytes.ok_or_else(not)?).map_err(|_| not())?;
    if manifest.get("format").and_then(Value::as_u64) != Some(1) {
        return Err(not());
    }
    let listed = manifest.get("files").and_then(Value::as_array).ok_or_else(not)?;
    let mut files = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for entry in listed {
        let path = entry.get("path").and_then(Value::as_str).ok_or_else(not)?;
        let bytes = entry.get("bytes").and_then(Value::as_u64).ok_or_else(not)?;
        let sha256 = entry.get("sha256").and_then(Value::as_str).filter(|s| hex64(s)).ok_or_else(not)?;
        seen.insert(path);
        match members.get(path) {
            None => problems.push(format!("missing:{path}")),
            Some(member) if member.bytes != bytes || member.sha256 != sha256 => problems.push(format!("changed:{path}")),
            Some(_) => {}
        }
        files.push(json!({"path": path, "bytes": bytes}));
    }
    let mut unlisted: Vec<&String> = members.keys().filter(|name| !seen.contains(name.as_str())).collect();
    unlisted.sort();
    problems.extend(unlisted.into_iter().map(|name| format!("unlisted:{name}")));
    problems.truncate(20);
    let text = |value: Option<&Value>| value.and_then(Value::as_str).map(|text| text.chars().take(200).collect::<String>());
    let excluded: Vec<Value> = manifest
        .get("excluded")
        .and_then(Value::as_array)
        .map(|items| items.iter().take(2000).map(|item| json!({"path": text(item.get("path")), "reason": text(item.get("reason"))})).collect())
        .unwrap_or_default();
    let always: Vec<Value> = manifest.get("alwaysExcluded").and_then(Value::as_array).map(|items| items.iter().take(50).filter_map(|item| text(Some(item))).map(Value::from).collect()).unwrap_or_default();
    Ok(Inspection {
        outcome: "opened",
        manifest: json!({"format": 1, "createdAt": text(manifest.get("createdAt")), "files": files, "excluded": excluded, "alwaysExcluded": always}),
        verified: problems.is_empty(),
        problems,
    })
}

/// Opens a backup the person picks and checks it against its own manifest. It does not touch the team.
#[tauri::command]
pub(crate) async fn backup_inspect(app: tauri::AppHandle, window: tauri::Window) -> Result<Value, DirectChatError> {
    if !window_may_export(window.label()) {
        return Err(failure("invalid_request"));
    }
    // The system's window is modal and waits for the person: never on the main thread.
    let chosen = tauri::async_runtime::spawn_blocking(move || app.dialog().file().set_parent(&window).add_filter("Backup", &["gz"]).blocking_pick_file())
        .await
        .map_err(|_| failure("backup_not_a_backup"))?;
    let Some(chosen) = chosen else {
        return Ok(json!({"outcome": "cancelled"}));
    };
    let path = chosen.into_path().map_err(|_| failure("backup_not_a_backup"))?;
    let inspection = tauri::async_runtime::spawn_blocking(move || File::open(&path).map_err(|_| failure("backup_not_a_backup")).and_then(inspect_archive))
        .await
        .map_err(|_| failure("backup_not_a_backup"))??;
    serde_json::to_value(inspection).map_err(|_| failure("backup_not_a_backup"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        process::{Command, Stdio},
    };

    fn code(error: DirectChatError) -> String {
        serde_json::to_value(error).unwrap()["code"].as_str().unwrap().to_owned()
    }

    // ── the pieces that need no team ───────────────────────────────────────────────────────────────────

    #[test]
    fn a_reply_of_the_script_is_believed_only_when_it_is_whole() {
        let ok = json!({"ok": true, "token": "0123456789abcdef0123456789abcdef", "bytes": 10, "sha256": "a".repeat(64), "files": 3, "excluded": 0});
        assert_eq!(parse_snapshot(&ok).unwrap().files, 3);
        for (patch, expected) in [
            (json!({"token": "../etc"}), "backup_snapshot_failed"),
            (json!({"token": "0123456789ABCDEF0123456789ABCDEF"}), "backup_snapshot_failed"),
            (json!({"bytes": 0}), "backup_snapshot_failed"),
            (json!({"bytes": -1}), "backup_snapshot_failed"),
            (json!({"bytes": MAX_ARCHIVE + 1}), "backup_too_large"),
            (json!({"sha256": "xyz"}), "backup_snapshot_failed"),
            (json!({"sha256": "A".repeat(64)}), "backup_snapshot_failed"),
            (json!({"files": "3"}), "backup_snapshot_failed"),
            (json!({"ok": false, "error": "backup_no_space"}), "backup_no_space"),
            (json!({"ok": false, "error": "backup_too_large"}), "backup_too_large"),
            (json!({"ok": false, "error": "something else"}), "backup_snapshot_failed"),
        ] {
            let mut reply = ok.clone();
            for (key, value) in patch.as_object().unwrap() {
                reply[key] = value.clone();
            }
            assert_eq!(code(parse_snapshot(&reply).unwrap_err()), expected, "{patch}");
        }
        assert_eq!(parse_plan(&json!({"ok": true, "bytes": 5})).unwrap(), Plan { bytes: 5 });
        assert_eq!(code(parse_plan(&json!({"ok": false, "error": "backup_no_database"})).unwrap_err()), "backup_no_database");
        assert_eq!(code(parse_plan(&json!({"ok": true})).unwrap_err()), "read_failed");
    }

    #[test]
    fn a_block_is_decoded_and_never_longer_than_asked_nor_past_the_end() {
        let block = |text: &str, offset: u64, total: u64| parse_block(&json!({"ok": true, "data": text}), offset, total).map_err(code);
        assert_eq!(block("aGVsbG8=", 0, 5).unwrap(), b"hello");
        assert_eq!(block("", 0, 5).unwrap(), Vec::<u8>::new());
        assert_eq!(block("aGVsbG8=", 1, 5).unwrap_err(), "read_failed", "past the end");
        assert_eq!(block("not base64!", 0, 5).unwrap_err(), "read_failed");
        let long = base64::engine::general_purpose::STANDARD.encode(vec![0u8; BLOCK as usize + 1]);
        assert_eq!(block(&long, 0, u64::MAX / 2).unwrap_err(), "read_failed", "more than a block");
        assert_eq!(code(parse_block(&json!({"ok": false, "error": "backup_snapshot_failed"}), 0, 5).unwrap_err()), "backup_snapshot_failed");
    }

    fn scratch(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("jht-team-backup-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn snapshot_of(bytes: &[u8]) -> Snapshot {
        Snapshot { token: "0".repeat(32), bytes: bytes.len() as u64, sha256: hex(&Sha256::digest(bytes)), files: 1 }
    }

    fn serve(bytes: Vec<u8>) -> impl FnMut(u64) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u8>, DirectChatError>> + Send>> {
        move |offset| {
            let end = (offset + 7).min(bytes.len() as u64);
            let chunk = bytes[offset as usize..end as usize].to_vec();
            Box::pin(async move { Ok(chunk) })
        }
    }

    #[test]
    fn the_archive_is_pulled_block_by_block_and_kept_only_when_it_is_the_one_described() {
        let dir = scratch("pull");
        let bytes: Vec<u8> = (0..100u8).collect();
        let part = dir.join("a.part");
        let seen = std::sync::Mutex::new(Vec::new());
        let progress = |phase: &'static str, done: u64, _total: u64| seen.lock().unwrap().push((phase, done));
        let pulled = block_on(pull(&part, &snapshot_of(&bytes), serve(bytes.clone()), &progress, &|| false)).unwrap();
        assert_eq!(pulled, Pulled::Whole);
        assert_eq!(fs::read(&part).unwrap(), bytes);
        let seen = seen.into_inner().unwrap();
        assert_eq!(seen.first(), Some(&("copy", 7)));
        assert_eq!(seen.last(), Some(&("verify", 0)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn what_does_not_match_the_description_is_taken_away_and_never_called_a_backup() {
        let dir = scratch("bad");
        let bytes: Vec<u8> = (0..100u8).collect();
        let run = |name: &str, snapshot: Snapshot, served: Vec<u8>, cancel: bool| {
            let part = dir.join(name);
            let result = block_on(pull(&part, &snapshot, serve(served), &|_, _, _| {}, &move || cancel)).map_err(code);
            (result, part.exists())
        };
        // another byte on the way: the sha256 says so
        let mut flipped = bytes.clone();
        flipped[50] ^= 1;
        assert_eq!(run("flip.part", snapshot_of(&bytes), flipped, false), (Err("backup_verify_failed".to_owned()), false));
        // told one size, sent another that still adds up to the same count
        let mut wrong = snapshot_of(&bytes);
        wrong.sha256 = "0".repeat(64);
        assert_eq!(run("sha.part", wrong, bytes.clone(), false), (Err("backup_verify_failed".to_owned()), false));
        // the person stops it
        assert_eq!(run("cancel.part", snapshot_of(&bytes), bytes.clone(), true), (Ok(Pulled::Cancelled), false));
        // the team stops answering with the archive half sent
        assert_eq!(run("short.part", snapshot_of(&bytes), bytes[..30].to_vec(), false), (Err("read_failed".to_owned()), false));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_part_that_is_already_there_is_never_written_through() {
        let dir = scratch("exists");
        let bytes: Vec<u8> = (0..20u8).collect();
        let victim = dir.join("precious.txt");
        fs::write(&victim, "precious").unwrap();
        let part = dir.join("a.part");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&victim, &part).unwrap();
        #[cfg(not(unix))]
        fs::write(&part, "precious").unwrap();
        let error = block_on(pull(&part, &snapshot_of(&bytes), serve(bytes.clone()), &|_, _, _| {}, &|| false)).unwrap_err();
        assert_eq!(code(error), "backup_save_failed");
        assert_eq!(fs::read_to_string(&victim).unwrap(), "precious");
        assert!(part.symlink_metadata().is_ok(), "what was there is left there");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn one_backup_at_a_time() {
        let first = RunGuard::acquire().unwrap();
        assert_eq!(code(RunGuard::acquire().err().unwrap()), "backup_busy");
        drop(first);
        let again = RunGuard::acquire();
        assert!(again.is_ok());
        drop(again);
        assert!(!RUNNING.load(Ordering::SeqCst));
    }

    // ── the script, run for real on a folder that stands in for the team's home ─────────────────────────

    fn python(args: &[&str], stdin: &[u8], tmp: Option<&Path>) -> (i32, Vec<u8>) {
        let mut command = Command::new("python3");
        command.args(args).stdin(Stdio::piped()).stdout(Stdio::piped());
        if let Some(tmp) = tmp {
            command.env("TMPDIR", tmp);
        }
        let mut child = command.spawn().unwrap();
        child.stdin.take().unwrap().write_all(stdin).unwrap();
        let output = child.wait_with_output().unwrap();
        (output.status.code().unwrap_or(-1), output.stdout)
    }

    /// The script with `/jht_home` moved to `home`, and the limits changed to what the test needs.
    fn script_for(home: &Path, patches: &[(&str, String)]) -> String {
        let mut text = TEAM_BACKUP_PY.replace("/jht_home", &home.display().to_string());
        for (from, to) in patches {
            assert_eq!(text.matches(from).count(), 1, "the script changed: {from}");
            text = text.replace(from, to);
        }
        text
    }

    fn run(script: &str, tmp: &Path, request: Value) -> Value {
        let mut input = hex(script.as_bytes()).into_bytes();
        input.push(b'\n');
        input.extend(serde_json::to_vec(&request).unwrap());
        input.push(b'\n');
        let (code, out) = python(&["-c", "import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())"], &input, Some(tmp));
        assert_eq!(code, 0, "{}", String::from_utf8_lossy(&out));
        serde_json::from_slice(&out).unwrap_or_else(|_| panic!("not JSON: {}", String::from_utf8_lossy(&out)))
    }

    /// A team's home with data, secrets and things that must not go.
    fn make_home(home: &Path) {
        let program = r#"
import os,sqlite3,sys
home=sys.argv[1]
def put(rel,text,mode='w'):
    path=os.path.join(home,rel); os.makedirs(os.path.dirname(path),exist_ok=True)
    open(path,mode).write(text)
put('profile/candidate_profile.yml','name: Ada\n')
put('profile/cv/cv.md','# Ada CV\n')
put('i18n-prefs.json','{"locale":"it"}')
put('stats/other.txt','NOT-ON-THE-LIST')
put('stats/work-hours.jsonl','{"hour":"2026-10-26T10:00:00Z","activeMinutes":60,"scoreThreshold":75,"weeklyDeltaPct":1}\nTEXT-LINE-OF-AN-AD at Acme\n{"hour":"2026-10-26T11:00:00Z","activeMinutes":60,"scoreThreshold":75,"weeklyDeltaPct":null,"title":"EXTRA-FIELD"}\n{"hour":"2026-10-26T12:00:00Z","activeMinutes":99,"scoreThreshold":75,"weeklyDeltaPct":null}\n')
put('jht.config.json','{"active_provider":"claude","providers":{"claude":{"api_key":"SECRET-KEY-1","model":"m","nested":{"refresh_token":"SECRET-TOKEN-2"}}},"list":[{"password":"SECRET-PASS-3","ok":1}]}')
put('cloud.json','{"user_id":"u","token":"SECRET-CLOUD"}')
put('.pairing-token','SECRET-PAIR')
put('credentials/key.json','SECRET-CRED')
put('.claude/.credentials.json','SECRET-CLAUDE')
put('.codex/auth.json','SECRET-CODEX')
put('host.env','JHT_LANG=it\n')
put('logs/team.log','a log line with a private word\n')
put('runtime/x','x')
put('agents/capitano/chat.jsonl','{"role":"user","text":"hello"}\n')
put('agents/scout-1/chat.jsonl','{"role":"agent","text":"hi"}\n')
put('agents/_team/scout_workspace.json','{}')
put('agents/capitano/diary.md','not in the backup')
put('documents/cv-1.md','CV for position 1')
put('documents/cl-1.md','CL for position 1')
put('documents/.hidden.md','HIDDEN-CONTENT')
put('secrets/x.json','SECRET-DRIVE')
put('documents/data.json','JSON-DOC')
put('documents/noext','NOEXT-DOC')
put('credentials/doc.md','must not go')
os.symlink(os.path.join(home,'cloud.json'),os.path.join(home,'documents/link.md'))
db=sqlite3.connect(os.path.join(home,'jobs.db'))
db.executescript("""
CREATE TABLE positions(id INTEGER PRIMARY KEY, title TEXT);
CREATE TABLE applications(id INTEGER PRIMARY KEY, position_id INTEGER, cv_path TEXT, cl_path TEXT, cv_pdf_path TEXT, cl_pdf_path TEXT);
INSERT INTO positions(title) VALUES ('Dev'),('Ops');
""")
for row in [(1,home+'/documents/cv-1.md',home+'/documents/cl-1.md',None,None),
            (2,'/etc/passwd',home+'/documents/.hidden.md',home+'/credentials/doc.md',home+'/documents/link.md'),
            (3,home+'/profile/cv/cv.md',home+'/documents/missing.md',home+'/documents/../cloud.json',None),
            (4,home+'/secrets/x.json',home+'/documents/data.json',home+'/documents/noext',None)]:
    db.execute('INSERT INTO applications(position_id,cv_path,cl_path,cv_pdf_path,cl_pdf_path) VALUES(?,?,?,?,?)',row)
db.commit()
"#;
        let (code, _) = python(&["-c", program, &home.display().to_string()], b"", None);
        assert_eq!(code, 0, "the test home could not be made");
    }

    /// Runs the whole transfer through the script: plan, snapshot, blocks, cleanup. Returns the archive and the
    /// snapshot's reply.
    fn backup_through_script(script: &str, tmp: &Path) -> (Vec<u8>, Value) {
        assert_eq!(run(script, tmp, json!({"op": "plan"}))["ok"], true);
        let snapshot = run(script, tmp, json!({"op": "snapshot"}));
        assert_eq!(snapshot["ok"], true, "{snapshot}");
        let token = snapshot["token"].as_str().unwrap().to_owned();
        let total = snapshot["bytes"].as_u64().unwrap();
        let mut archive = Vec::new();
        while (archive.len() as u64) < total {
            let reply = run(script, tmp, json!({"op": "read", "token": token, "offset": archive.len()}));
            archive.extend(parse_block(&reply, archive.len() as u64, total).unwrap());
        }
        assert_eq!(hex(&Sha256::digest(&archive)), snapshot["sha256"].as_str().unwrap());
        assert_eq!(run(script, tmp, json!({"op": "cleanup", "token": token}))["ok"], true);
        assert!(!tmp.join(format!("jht-backup-{token}")).exists(), "the folder is gone");
        (archive, snapshot)
    }

    fn member_names(archive: &[u8]) -> Vec<String> {
        let program = "import sys,tarfile,io\nt=tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()),mode='r:gz')\nprint('\\n'.join(sorted(t.getnames())))";
        String::from_utf8(python(&["-c", program], archive, None).1).unwrap().lines().map(str::to_owned).collect()
    }

    #[cfg(unix)]
    #[test]
    fn a_backup_holds_what_the_person_owns_and_none_of_the_secrets_and_reads_back_whole() {
        let (home, tmp) = (scratch("home"), scratch("tmp"));
        make_home(&home);
        let script = script_for(&home, &[("BLOCK=524288", "BLOCK=300".to_owned())]);
        let (archive, snapshot) = backup_through_script(&script, &tmp);
        assert!(archive.len() > 300 * 3, "several blocks went through");
        let names = member_names(&archive);
        assert_eq!(
            names,
            [
                "agents/capitano/chat.jsonl",
                "agents/scout-1/chat.jsonl",
                "documents/cl-1.md",
                "documents/cv-1.md",
                "i18n-prefs.json",
                "jht.config.json",
                "jobs.db",
                "manifest.json",
                "profile/candidate_profile.yml",
                "profile/cv/cv.md",
                "stats/work-hours.jsonl",
            ]
        );
        // no secret anywhere in the archive, nor a file that was never on the list
        let everything = String::from_utf8_lossy(&python(&["-c", "import sys,tarfile,io\nt=tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()),mode='r:gz')\nfor m in t.getmembers():\n  sys.stdout.write(t.extractfile(m).read().decode('utf-8','replace'))"], &archive, None).1).into_owned();
        for secret in ["TEXT-LINE-OF-AN-AD", "EXTRA-FIELD", "NOT-ON-THE-LIST", "SECRET-KEY-1", "SECRET-TOKEN-2", "SECRET-PASS-3", "SECRET-CLOUD", "SECRET-PAIR", "SECRET-CRED", "SECRET-CLAUDE", "SECRET-CODEX", "SECRET-DRIVE", "JSON-DOC", "NOEXT-DOC", "a log line", "must not go", "not in the backup", "HIDDEN-CONTENT"] {
            assert!(!everything.contains(secret), "{secret} is in the backup");
        }
        assert!(everything.contains("\"model\": \"m\"") && everything.contains("\"api_key\": null") && everything.contains("\"refresh_token\": null") && everything.contains("\"password\": null"), "the config keeps its shape, with the secrets emptied");
        // the database in it is a sound copy with the rows
        let check = "import sys,tarfile,io,sqlite3,tempfile,os\nt=tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()),mode='r:gz')\nd=tempfile.mkdtemp(); open(d+'/x.db','wb').write(t.extractfile('jobs.db').read())\nprint(sqlite3.connect(d+'/x.db').execute('select count(*) from positions').fetchone()[0])";
        assert_eq!(String::from_utf8(python(&["-c", check], &archive, None).1).unwrap().trim(), "2");
        // the statistics in it are the rows that pass the team's own check, and nothing of the lines that do not
        let stats = "import sys,tarfile,io\nt=tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read()),mode='r:gz')\nsys.stdout.write(t.extractfile('stats/work-hours.jsonl').read().decode())";
        assert_eq!(
            String::from_utf8(python(&["-c", stats], &archive, None).1).unwrap(),
            "{\"hour\":\"2026-10-26T10:00:00Z\",\"activeMinutes\":60,\"scoreThreshold\":75,\"weeklyDeltaPct\":1}\n",
            "a text line, a row with an extra field and a row out of range are not backed up"
        );
        // read back by the app: the manifest holds, and says what was left out
        let inspection = inspect_archive(&archive[..]).unwrap();
        assert!(inspection.verified, "{:?}", inspection.problems);
        assert_eq!(inspection.manifest["format"], 1);
        assert_eq!(inspection.manifest["files"].as_array().unwrap().len() as u64, snapshot["files"].as_u64().unwrap());
        let excluded: Vec<String> = inspection.manifest["excluded"].as_array().unwrap().iter().map(|item| format!("{}:{}", item["path"].as_str().unwrap(), item["reason"].as_str().unwrap())).collect();
        for expected in ["/etc/passwd:outside_home", "documents/.hidden.md:not_allowed", "credentials/doc.md:not_allowed", "documents/link.md:not_a_plain_file", "secrets/x.json:not_allowed", "documents/data.json:not_a_document", "documents/noext:not_a_document"] {
            assert!(excluded.contains(&expected.to_owned()), "{expected} not in {excluded:?}");
        }
        assert!(inspection.manifest["alwaysExcluded"].as_array().unwrap().iter().any(|name| name == "cloud.json"));
        assert!(inspection.manifest["alwaysExcluded"].as_array().unwrap().iter().any(|name| name == "secrets"));
        // the team's home was only read
        assert_eq!(fs::read_to_string(home.join("i18n-prefs.json")).unwrap(), "{\"locale\":\"it\"}");
        let _ = fs::remove_dir_all(&home);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[cfg(unix)]
    #[test]
    fn the_plan_tells_what_cannot_be_done_before_anything_is_made() {
        let (home, tmp) = (scratch("plan-home"), scratch("plan-tmp"));
        // no database: told, and nothing in the temporary folder
        let reply = run(&script_for(&home, &[]), &tmp, json!({"op": "snapshot"}));
        assert_eq!((reply["ok"].clone(), reply["error"].clone()), (json!(false), json!("backup_no_database")));
        assert_eq!(fs::read_dir(&tmp).unwrap().count(), 0);
        make_home(&home);
        // too much to back up
        let big = script_for(&home, &[("MAX_RAW=4*1024**3", "MAX_RAW=10".to_owned())]);
        assert_eq!(run(&big, &tmp, json!({"op": "plan"}))["error"], "backup_too_large");
        // no room for the copy
        let tight = script_for(&home, &[("SLACK=64*1024*1024", "SLACK=1024**5".to_owned())]);
        assert_eq!(run(&tight, &tmp, json!({"op": "plan"}))["error"], "backup_no_space");
        assert_eq!(run(&tight, &tmp, json!({"op": "snapshot"}))["error"], "backup_no_space");
        // an archive past the cap is not handed over, and its folder goes
        let capped = script_for(&home, &[("MAX_ARCHIVE=2*1024**3", "MAX_ARCHIVE=100".to_owned())]);
        assert_eq!(run(&capped, &tmp, json!({"op": "snapshot"}))["error"], "backup_too_large");
        assert_eq!(fs::read_dir(&tmp).unwrap().count(), 0, "nothing left behind");
        let _ = fs::remove_dir_all(&home);
        let _ = fs::remove_dir_all(&tmp);
    }

    #[cfg(unix)]
    #[test]
    fn a_request_can_only_name_the_folder_the_script_made() {
        let (home, tmp) = (scratch("tok-home"), scratch("tok-tmp"));
        make_home(&home);
        let script = script_for(&home, &[]);
        let victim = tmp.join("victim");
        fs::create_dir_all(&victim).unwrap();
        fs::write(victim.join("keep"), "keep").unwrap();
        for token in ["../victim", "victim", "", "0123456789ABCDEF0123456789ABCDEF", "0123456789abcdef0123456789abcde", "0123456789abcdef0123456789abcdef0", "/etc"] {
            for op in ["read", "cleanup"] {
                let reply = run(&script, &tmp, json!({"op": op, "token": token, "offset": 0}));
                assert_eq!(reply["ok"], false, "{op} {token:?}");
            }
        }
        // a well-formed token of a folder that is not there
        let reply = run(&script, &tmp, json!({"op": "read", "token": "0".repeat(32), "offset": 0}));
        assert_eq!(reply["error"], "backup_snapshot_failed");
        assert_eq!(fs::read_to_string(victim.join("keep")).unwrap(), "keep");
        for bad in [json!({"op": "read", "token": "0".repeat(32), "offset": -1}), json!({"op": "read", "token": "0".repeat(32), "offset": "1"}), json!({"op": "wipe"}), json!({"op": "plan", "token": "x"}), json!({"op": "plan", "path": "/"}), json!({})] {
            assert_eq!(run(&script, &tmp, bad.clone())["error"], "invalid_request", "{bad}");
        }
        let _ = fs::remove_dir_all(&home);
        let _ = fs::remove_dir_all(&tmp);
    }

    // ── reading a backup ───────────────────────────────────────────────────────────────────────────────

    /// A backup made by hand: `files` are what the archive holds, `manifest` what it says it holds.
    fn tar_gz(files: &[(&str, &[u8])], manifest: Option<Value>) -> Vec<u8> {
        let program = r#"
import io,json,sys,tarfile
spec=json.load(sys.stdin)
out=io.BytesIO()
with tarfile.open(fileobj=out,mode='w:gz',format=tarfile.USTAR_FORMAT) as t:
    for name,text in spec['files']:
        data=text.encode()
        info=tarfile.TarInfo(name); info.size=len(data); t.addfile(info,io.BytesIO(data))
    if spec['manifest'] is not None:
        data=json.dumps(spec['manifest']).encode()
        info=tarfile.TarInfo('manifest.json'); info.size=len(data); t.addfile(info,io.BytesIO(data))
sys.stdout.buffer.write(out.getvalue())
"#;
        let spec = json!({"files": files.iter().map(|(name, data)| json!([name, String::from_utf8_lossy(data)])).collect::<Vec<_>>(), "manifest": manifest});
        python(&["-c", program], spec.to_string().as_bytes(), None).1
    }

    fn manifest_for(files: &[(&str, &[u8])]) -> Value {
        json!({"format": 1, "createdAt": "2026-10-24T10:00:00Z", "files": files.iter().map(|(name, data)| json!({"path": name, "bytes": data.len(), "sha256": hex(&Sha256::digest(data))})).collect::<Vec<_>>(), "excluded": [{"path": "x", "reason": "too_large"}], "alwaysExcluded": ["cloud.json"]})
    }

    #[cfg(unix)]
    #[test]
    fn a_backup_that_matches_its_manifest_is_verified_and_one_that_does_not_says_where() {
        let files: &[(&str, &[u8])] = &[("jobs.db", b"database bytes"), ("profile/cv.md", b"# cv")];
        let good = inspect_archive(&tar_gz(files, Some(manifest_for(files)))[..]).unwrap();
        assert!(good.verified && good.problems.is_empty());
        assert_eq!(good.manifest["createdAt"], "2026-10-24T10:00:00Z");
        assert_eq!(good.manifest["files"], json!([{"path": "jobs.db", "bytes": 14}, {"path": "profile/cv.md", "bytes": 4}]));
        // a file changed after the manifest was written, one removed, one added
        let mut manifest = manifest_for(files);
        manifest["files"][0]["sha256"] = json!("0".repeat(64));
        manifest["files"][1]["path"] = json!("profile/other.md");
        let bad = inspect_archive(&tar_gz(files, Some(manifest))[..]).unwrap();
        assert!(!bad.verified);
        assert_eq!(bad.problems, ["changed:jobs.db", "missing:profile/other.md", "unlisted:profile/cv.md"]);
        // a size that lies
        let mut manifest = manifest_for(files);
        manifest["files"][1]["bytes"] = json!(99);
        assert_eq!(inspect_archive(&tar_gz(files, Some(manifest))[..]).unwrap().problems, ["changed:profile/cv.md"]);
    }

    #[cfg(unix)]
    #[test]
    fn what_is_not_a_backup_is_told_so_and_never_read_further_than_it_must() {
        let files: &[(&str, &[u8])] = &[("jobs.db", b"x")];
        let good = tar_gz(files, Some(manifest_for(files)));
        let nope = |bytes: &[u8]| code(inspect_archive(bytes).unwrap_err());
        assert_eq!(nope(b""), "backup_not_a_backup");
        assert_eq!(nope(b"just some text, not even gzip"), "backup_not_a_backup");
        assert_eq!(nope(&good[..good.len() / 2]), "backup_not_a_backup", "cut short");
        let mut broken = good.clone();
        let middle = broken.len() / 2;
        broken[middle] ^= 0xff;
        assert_eq!(nope(&broken), "backup_not_a_backup", "a byte changed in the stream");
        // a gzip that is not a tar, a tar with no manifest, a manifest that is not one, another format
        assert_eq!(nope(&python(&["-c", "import gzip,sys;sys.stdout.buffer.write(gzip.compress(b'x'*2000))"], b"", None).1), "backup_not_a_backup");
        assert_eq!(nope(&tar_gz(files, None)), "backup_not_a_backup");
        assert_eq!(nope(&tar_gz(files, Some(json!({"format": 2, "files": []})))), "backup_not_a_backup");
        assert_eq!(nope(&tar_gz(files, Some(json!({"format": 1})))), "backup_not_a_backup");
        assert_eq!(nope(&tar_gz(files, Some(json!({"format": 1, "files": [{"path": "a", "bytes": 1, "sha256": "zz"}]})))), "backup_not_a_backup");
        // a backup with a megabyte and more behind its last member is not one (and is not read to the end)
        let mut padded = Vec::new();
        {
            let program = "import gzip,io,json,sys,tarfile\nout=io.BytesIO()\nt=tarfile.open(fileobj=out,mode='w:gz',format=tarfile.USTAR_FORMAT)\nfor n,d in (('jobs.db',b'x'),):\n  i=tarfile.TarInfo(n);i.size=len(d);t.addfile(i,io.BytesIO(d))\nm=json.dumps({'format':1,'files':[],'excluded':[],'alwaysExcluded':[]}).encode()\ni=tarfile.TarInfo('manifest.json');i.size=len(m);t.addfile(i,io.BytesIO(m));t.close()\nraw=gzip.decompress(out.getvalue())+b'\\0'*(3*1024*1024)\nsys.stdout.buffer.write(gzip.compress(raw))";
            padded.extend(python(&["-c", program], b"", None).1);
        }
        assert_eq!(nope(&padded), "backup_not_a_backup");
        // a GNU tar with long names (not what this app writes) is refused, not half read
        let gnu = python(&["-c", "import gzip,io,sys,tarfile\nout=io.BytesIO()\nt=tarfile.open(fileobj=out,mode='w:gz',format=tarfile.PAX_FORMAT)\ni=tarfile.TarInfo('a'*150);i.size=1;t.addfile(i,io.BytesIO(b'x'));t.close();sys.stdout.buffer.write(out.getvalue())"], b"", None).1;
        assert_eq!(nope(&gnu), "backup_not_a_backup");
    }

    #[test]
    fn the_commands_are_the_app_windows_and_the_order_of_a_backup_is_fixed() {
        let source = include_str!("team_backup.rs");
        let code = source.split("#[cfg(test)]").next().unwrap();
        for command in ["pub(crate) async fn backup_create(", "pub(crate) fn backup_cancel(", "pub(crate) async fn backup_inspect("] {
            let body = code.split(command).nth(1).unwrap().split("\n}\n").next().unwrap();
            assert!(body.contains("!window_may_export(window.label())"), "{command}");
        }
        let create = code.split("pub(crate) async fn backup_create(").nth(1).unwrap().split("\n}\n").next().unwrap();
        let at = |needle: &str| create.find(needle).unwrap_or_else(|| panic!("{needle}"));
        // one at a time, then what cannot be done is told, then the person chooses, then the copy is made
        assert!(at("RunGuard::acquire()") < at("\"op\": \"plan\"") && at("\"op\": \"plan\"") < at("ask_where(") && at("ask_where(") < at("\"op\": \"snapshot\"") && at("\"op\": \"snapshot\"") < at("pull("));
        // the folder in the team is removed after the transfer, whatever it said, and before its outcome is looked at
        assert!(at("\"op\": \"cleanup\"") > at("pull(") && at("\"op\": \"cleanup\"") < at("match pulled?"));
        // a read of the team: never the write gate
        assert!(!code.contains("refuse_writing"));
        // it never extracts: no write of an archive's member to the disk
        let inspect = code.split("fn inspect_archive(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(!inspect.contains("File::create") && !inspect.contains("fs::write") && !inspect.contains("create_dir"));
    }
}

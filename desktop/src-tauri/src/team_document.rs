//! A CV or a cover letter the team wrote, saved on this computer from the position page.
//!
//! The PDFs live on the box that runs the team, not in the cloud; the website fetches them through a
//! bridge that mints a signed URL with a key the app does not have (and must not). The app reads the
//! file the way it reads the rest of the team: the chat's Python channel (this computer's team, an
//! existing team's pinned container, the VPS the app made), with a fixed script and one JSON request.
//!
//! The boundary:
//! - WHICH FILE: the renderer names a file by its plain name, nothing else, and the native side checks it
//!   again. The name is a basename (`[A-Za-z0-9._ -]`, 1 to 120 characters, no space, dot or `-` at the start,
//!   ends in `.pdf`, no `..`), it travels in the script's STDIN as JSON (never in argv, never in a shell
//!   string) and the script checks it once more. It looks for it in ONE folder, `/jht_user/cv`, where the
//!   team writes the CVs and the letters. Never another folder, never the team's home (credentials, config,
//!   the database), never a listing.
//! - HOW IT IS OPENED: by descriptor, not by path: the folder and the file are opened with `O_NOFOLLOW`
//!   (`openat`), the file is checked on the descriptor (a regular file, one link only so that a hardlink an
//!   agent made towards another file is refused, at most 10 MiB, begins with `%PDF-`) and read from that same
//!   descriptor. The agents write in that folder: a check of the path followed by a second open would race.
//! - HOW MUCH, AND WHOLE: at most 10 MiB a file, in blocks of at most 512 KiB. The first call says the size and
//!   the sha256 of the whole file; every block says the file's inode, size and mtime, and if they change the
//!   copy stops and the partial file is removed (`document_changed`). The sha256 of what is on the disk is
//!   compared with the first call's.
//! - WHAT IT WRITES: `create_new` on a hidden `.part` beside the final place, made private (owner only) before
//!   the first byte, the closing work off the async thread, renamed only when whole; on cancel or error the
//!   `.part` is removed. A CV is personal data.
//! - WHEN: only after a click, only from the main window, one at a time, and the system's «Save as» window
//!   opens BEFORE anything is read: closing it reads nothing.
//! - NAME IN NO LOG: the file's name is personal data (`CV_<name>_<company>.pdf`). It goes to the script and to
//!   the «Save as» window and nowhere else: no log, event or error carries it, only the closed codes of the
//!   error catalogue.
//! - NEVER INTERPRETED: the app never opens or interprets a PDF. The team's container draws the pages (`pdftoppm`,
//!   see `TEAM_DOCUMENT_PAGES_PY`) and the app re-checks what comes back (a PNG: signature, IHDR, sides, weight, IEND;
//!   or UTF-8 text of a markdown document) before the page shows it, as pictures and as text nodes. There is no PDF or
//!   markdown library in this crate or in the pages. The content was written by an agent that read other people's text.
//! - PREVIEW: `team_document_text` (a `.md`, at most 1 MiB), `team_document_pages` (how many sheets, at most 6, and the
//!   sha256 of the file) and `team_document_page` (one sheet as a PNG, of the file `pages` described or `document_changed`)
//!   take the same gates as the save: the main window, a plain name of the right kind, one at a time, a read of the
//!   active account's team only (`chat_write` refuses a connection of another scope).
//! - Reading is a read of the team's data: it works in the read-only view too. It needs the chat connected.

use crate::{
    account_scope::AccountScopeState,
    direct_chat::{failure, team_script_read, DirectChatError, DirectChatState},
    private_copy::{self, CopyKind},
    team_export::{ask_where, part_path, window_may_export},
};
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::State;

/// The most the app asks the script to send in one call.
const BLOCK: u64 = 512 * 1024;
/// The most a document is: the script refuses more, and so does the app.
const MAX_DOCUMENT: u64 = 10 * 1024 * 1024;
const NAME_MAX_CHARS: usize = 120;
const STAT_TIMEOUT: Duration = Duration::from_secs(60);
const BLOCK_TIMEOUT: Duration = Duration::from_secs(60);

static RUNNING: AtomicBool = AtomicBool::new(false);

/// Both `stat` (what the file is: its size, sha256 and stamp) and `read` (one block at an offset, with the stamp)
/// open the file by descriptor in the one folder. Nothing is written, nothing is kept.
const TEAM_DOCUMENT_PY: &str = r#"import base64,hashlib,json,os,re,stat,sys
ROOT='/jht_user/cv'
MAX_BYTES=10*1024*1024
TEXT_BYTES=1024*1024
BLOCK=512*1024
NAME=re.compile(r'^[A-Za-z0-9._ -]{1,120}$')
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
def fail(code): emit({'ok':False,'error':code})
try: req=json.loads(sys.stdin.readline())
except Exception: fail('invalid_request')
if not isinstance(req,dict) or set(req)-{'op','name','offset'}: fail('invalid_request')
op=req.get('op'); name=req.get('name')
if op not in ('stat','read','text') or not isinstance(name,str): fail('invalid_request')
if not NAME.fullmatch(name) or not name.endswith('.md' if op=='text' else '.pdf') or name[0] in '. -' or '..' in name: fail('invalid_request')
offset=req.get('offset',0)
if not isinstance(offset,int) or isinstance(offset,bool) or offset<0: fail('invalid_request')
try:
 base=os.O_RDONLY|os.O_NOFOLLOW|getattr(os,'O_CLOEXEC',0)
 dirfd=os.open(ROOT,base|getattr(os,'O_DIRECTORY',0))
 try: fd=os.open(name,base|getattr(os,'O_NONBLOCK',0),dir_fd=dirfd)
 finally: os.close(dirfd)
except SystemExit: raise
except FileNotFoundError: fail('document_not_found')
except OSError: fail('document_not_found')
except Exception: fail('read_failed')
try:
 info=os.fstat(fd)
 if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1: fail('document_not_found')
 if info.st_size>(TEXT_BYTES if op=='text' else MAX_BYTES): fail('document_too_large')
 if op!='text' and info.st_size<5: fail('document_not_pdf')
 stamp=[info.st_ino,info.st_size,info.st_mtime_ns]
 with os.fdopen(fd,'rb',closefd=True) as f:
  if op=='text':
   raw=f.read(TEXT_BYTES+1)
   if len(raw)>TEXT_BYTES: fail('document_too_large')
   try: raw.decode('utf-8')
   except Exception: fail('document_unreadable')
   emit({'ok':True,'data':base64.b64encode(raw).decode('ascii'),'sha256':hashlib.sha256(raw).hexdigest()})
  if f.read(5)!=b'%PDF-': fail('document_not_pdf')
  f.seek(0)
  if op=='stat':
   digest=hashlib.sha256(); size=0
   while True:
    chunk=f.read(1024*1024)
    if not chunk: break
    size+=len(chunk); digest.update(chunk)
    if size>MAX_BYTES: fail('document_too_large')
   emit({'ok':True,'bytes':size,'sha256':digest.hexdigest(),'stamp':stamp})
  f.seek(offset)
  emit({'ok':True,'data':base64.b64encode(f.read(BLOCK)).decode('ascii'),'stamp':stamp})
except SystemExit: raise
except Exception: fail('read_failed')"#;

/// Names the renderer may ask for: the same rule as the script, checked before anything goes to the team.
pub(crate) fn valid_document_name(name: &str) -> bool {
    valid_name_ending(name, ".pdf")
}

fn valid_name_ending(name: &str, ending: &str) -> bool {
    let chars = name.chars().count();
    (1..=NAME_MAX_CHARS).contains(&chars)
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ' ' | '-'))
        && name.ends_with(ending)
        && !name.starts_with(['.', ' ', '-'])
        && !name.contains("..")
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct DocumentOutcome {
    outcome: &'static str,
    bytes: Option<u64>,
}

struct RunGuard;

impl RunGuard {
    fn acquire() -> Result<Self, DirectChatError> {
        RUNNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).map_err(|_| failure("operation_in_progress"))?;
        Ok(Self)
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        RUNNING.store(false, Ordering::SeqCst);
    }
}

fn script_failure(reply: &Value, fallback: &'static str) -> DirectChatError {
    failure(match reply.get("error").and_then(Value::as_str) {
        Some("document_not_found") => "document_not_found",
        Some("document_too_large") => "document_too_large",
        Some("document_not_pdf") => "document_not_pdf",
        Some("invalid_request") => "invalid_request",
        _ => fallback,
    })
}

fn hex64(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// What the first call said the file is: its size, its sha256 and its stamp (inode, size, mtime).
#[derive(Debug, PartialEq, Eq)]
struct Described {
    bytes: u64,
    sha256: String,
    stamp: [u64; 3],
}

fn parse_stamp(reply: &Value) -> Result<[u64; 3], DirectChatError> {
    let list = reply.get("stamp").and_then(Value::as_array).filter(|list| list.len() == 3).ok_or_else(|| failure("read_failed"))?;
    let mut stamp = [0u64; 3];
    for (slot, value) in stamp.iter_mut().zip(list) {
        *slot = value.as_u64().ok_or_else(|| failure("read_failed"))?;
    }
    Ok(stamp)
}

fn parse_described(reply: &Value) -> Result<Described, DirectChatError> {
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(script_failure(reply, "read_failed"));
    }
    let bytes = reply.get("bytes").and_then(Value::as_u64).filter(|bytes| *bytes > 0).ok_or_else(|| failure("read_failed"))?;
    if bytes > MAX_DOCUMENT {
        return Err(failure("document_too_large"));
    }
    let sha256 = reply.get("sha256").and_then(Value::as_str).filter(|s| hex64(s)).ok_or_else(|| failure("read_failed"))?;
    let stamp = parse_stamp(reply)?;
    if stamp[1] != bytes {
        return Err(failure("read_failed"));
    }
    Ok(Described { bytes, sha256: sha256.to_owned(), stamp })
}

/// A block, decoded: never more than asked, never past the end, and of the very file the first call described.
fn parse_block(reply: &Value, offset: u64, described: &Described) -> Result<Vec<u8>, DirectChatError> {
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(script_failure(reply, "read_failed"));
    }
    if parse_stamp(reply)? != described.stamp {
        return Err(failure("document_changed"));
    }
    let text = reply.get("data").and_then(Value::as_str).ok_or_else(|| failure("read_failed"))?;
    let data = base64::engine::general_purpose::STANDARD.decode(text).map_err(|_| failure("read_failed"))?;
    if data.is_empty() || data.len() as u64 > BLOCK || offset + data.len() as u64 > described.bytes {
        return Err(failure("read_failed"));
    }
    Ok(data)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sha256_of(path: &Path) -> std::io::Result<String> {
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

/// Reads the document block by block into `part` (which must not be there) and leaves `part` only when what is
/// on the disk is the file the first call described. Anything else takes `part` away.
async fn pull<F, Fut>(part: &Path, described: &Described, mut next: F) -> Result<(), DirectChatError>
where
    F: FnMut(u64) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<u8>, DirectChatError>>,
{
    let saving = |_: std::io::Error| failure("document_save_failed");
    let mut file = OpenOptions::new().write(true).create_new(true).open(part).map_err(saving)?;
    // owner only, before the first byte: a CV is personal data
    if crate::runtime_host::set_private_permissions(part).is_err() {
        drop(file);
        let _ = fs::remove_file(part);
        return Err(failure("document_save_failed"));
    }
    let outcome = async {
        let mut offset = 0u64;
        // a team that sends a few bytes at a time is not believed
        let mut calls = 0u64;
        while offset < described.bytes {
            calls += 1;
            if calls > described.bytes / (BLOCK / 64) + 64 {
                return Err(failure("read_failed"));
            }
            let data = next(offset).await?;
            file.write_all(&data).map_err(saving)?;
            offset += data.len() as u64;
        }
        Ok(())
    }
    .await;
    let outcome = match outcome {
        Ok(()) => finish(file, part.to_owned(), described.bytes, described.sha256.clone()).await,
        Err(error) => {
            drop(file);
            Err(error)
        }
    };
    if outcome.is_err() {
        let _ = fs::remove_file(part);
    }
    outcome
}

/// The closing work, off the async thread: flush to the disk, then compare what is there (its size and its
/// sha256) with what the first call said, not with what went through the pipe.
async fn finish(mut file: File, part: PathBuf, bytes: u64, sha256: String) -> Result<(), DirectChatError> {
    tauri::async_runtime::spawn_blocking(move || {
        let saving = |_: std::io::Error| failure("document_save_failed");
        file.flush().and_then(|()| file.sync_all()).map_err(saving)?;
        drop(file);
        let on_disk = fs::metadata(&part).map_err(saving)?.len();
        if on_disk != bytes || sha256_of(&part).map_err(saving)? != sha256 {
            return Err(failure("document_changed"));
        }
        Ok(())
    })
    .await
    .map_err(|_| failure("document_save_failed"))?
}

async fn script(state: &State<'_, DirectChatState>, scopes: &State<'_, AccountScopeState>, request: Value, timeout: Duration) -> Result<Value, DirectChatError> {
    team_script_read(state, scopes, TEAM_DOCUMENT_PY, request, timeout).await
}

/// Saves one of the team's CVs or letters in the file the person picks.
#[tauri::command]
pub(crate) async fn team_document_save(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    name: String,
) -> Result<DocumentOutcome, DirectChatError> {
    if !window_may_export(window.label()) || !valid_document_name(&name) {
        return Err(failure("invalid_request"));
    }
    let _running = RunGuard::acquire()?;
    // The system's window first: closing it reads nothing from the team.
    let Some(target) = ask_where(app, window, name.clone(), "PDF", "pdf").await? else {
        return Ok(DocumentOutcome { outcome: "cancelled", bytes: None });
    };
    let described = parse_described(&script(&state, &scopes, json!({"op": "stat", "name": name}), STAT_TIMEOUT).await?)?;
    let part = part_path(&target);
    {
        let (state, scopes, name, described) = (&state, &scopes, name.clone(), &described);
        pull(&part, described, |offset| {
            let name = name.clone();
            async move {
                let reply = script(state, scopes, json!({"op": "read", "name": name, "offset": offset}), BLOCK_TIMEOUT).await?;
                parse_block(&reply, offset, described)
            }
        })
        .await?;
    }
    match fs::rename(&part, &target) {
        Ok(()) => Ok(DocumentOutcome { outcome: "saved", bytes: Some(described.bytes) }),
        Err(_) => {
            let _ = fs::remove_file(&part);
            Err(failure("document_save_failed"))
        }
    }
}

/// The pages of a PDF, drawn in the team's container and sent as PNG: the app never parses a PDF.
///
/// A second script because it is the one that starts a process (`pdfinfo`, `pdftoppm`, both of the image's poppler),
/// and the first one starts none. It opens the file the same way (by descriptor, `O_NOFOLLOW`, one link, at most
/// 10 MiB, `%PDF-`), hashes the bytes it read, copies THOSE bytes to an unlinked temporary file and hands that
/// file's descriptor to the tools: what is drawn is what was hashed, whatever an agent does to the file meanwhile.
/// `pages` says how many pages there are (at most 6) and the sha256; `page N` must name that sha256 or it is
/// `document_changed`. The tools run with a fixed argv, a clean environment, no stdin, a new process group that is
/// killed whole at the deadline, 1 GiB of address space, 20 s of CPU and 20 s of wall clock for the whole call,
/// and the output is read to a cap. `-scale-to` fixes the longest side of the page: a MediaBox of 14400 points
/// cannot make a picture of gigabytes. The picture is written by `pdftoppm` into a private folder of the call (removed at the end) under a limit of
/// 2 MiB per file, and read from there.
const TEAM_DOCUMENT_PAGES_PY: &str = r#"import base64,hashlib,json,os,re,select,shutil,signal,stat,struct,subprocess,sys,tempfile,time
ROOT='/jht_user/cv'
MAX_BYTES=10*1024*1024
MAX_PAGES=6
MAX_PNG=2*1024*1024
SIDE=1400
LIMIT=20
NAME=re.compile(r'^[A-Za-z0-9._ -]{1,120}$')
HEX=re.compile(r'^[0-9a-f]{64}$')
TOOLS=('/usr/bin','/usr/local/bin','/bin')
# in the container (Linux) a tool never runs without its limits: if one cannot be set, nothing is started and the preview is refused
STRICT=sys.platform.startswith('linux')
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
def fail(code): emit({'ok':False,'error':code})
try: req=json.loads(sys.stdin.readline())
except Exception: fail('invalid_request')
if not isinstance(req,dict) or set(req)-{'op','name','page','sha256'}: fail('invalid_request')
op=req.get('op'); name=req.get('name'); page=req.get('page'); want=req.get('sha256')
if op not in ('pages','page') or not isinstance(name,str): fail('invalid_request')
if not NAME.fullmatch(name) or not name.endswith('.pdf') or name[0] in '. -' or '..' in name: fail('invalid_request')
if op=='page':
 if not isinstance(page,int) or isinstance(page,bool) or not 1<=page<=MAX_PAGES: fail('invalid_request')
 if not isinstance(want,str) or not HEX.fullmatch(want): fail('invalid_request')
elif page is not None or want is not None: fail('invalid_request')
deadline=time.monotonic()+LIMIT
try:
 base=os.O_RDONLY|os.O_NOFOLLOW|getattr(os,'O_CLOEXEC',0)
 dirfd=os.open(ROOT,base|getattr(os,'O_DIRECTORY',0))
 try: fd=os.open(name,base|getattr(os,'O_NONBLOCK',0),dir_fd=dirfd)
 finally: os.close(dirfd)
except SystemExit: raise
except OSError: fail('document_not_found')
except Exception: fail('read_failed')
try:
 info=os.fstat(fd)
 if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1: fail('document_not_found')
 if info.st_size>MAX_BYTES: fail('document_too_large')
 if info.st_size<5: fail('document_not_pdf')
 with os.fdopen(fd,'rb',closefd=True) as f: raw=f.read(MAX_BYTES+1)
except SystemExit: raise
except Exception: fail('read_failed')
if len(raw)>MAX_BYTES: fail('document_too_large')
if raw[:5]!=b'%PDF-': fail('document_not_pdf')
digest=hashlib.sha256(raw).hexdigest()
if op=='page' and digest!=want: fail('document_changed')
def tool(tool_name):
 for folder in TOOLS:
  path=os.path.join(folder,tool_name)
  if os.access(path,os.X_OK): return path
 fail('document_preview_unavailable')
def limits(fsize):
 try:
  import resource
  resource.setrlimit(resource.RLIMIT_AS,(1<<30,1<<30))
  resource.setrlimit(resource.RLIMIT_CPU,(LIMIT,LIMIT))
  resource.setrlimit(resource.RLIMIT_CORE,(0,0))
  resource.setrlimit(resource.RLIMIT_FSIZE,(fsize,fsize))
 except Exception:
  if STRICT: raise
def reap(proc):
 try: os.killpg(proc.pid,signal.SIGKILL)
 except Exception: pass
 try: proc.stdout.close()
 except Exception: pass
 try: proc.wait(timeout=5)
 except Exception: pass
def run(argv,fd,cap,cwd=None,fsize=MAX_PNG+1):
 proc=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,pass_fds=(fd,),env={'PATH':'/usr/bin:/bin','LC_ALL':'C'},cwd=cwd,start_new_session=True,preexec_fn=lambda: limits(fsize),close_fds=True)
 out=b''
 try:
  while True:
   left=deadline-time.monotonic()
   if left<=0: fail('document_preview_timeout')
   ready,_,_=select.select([proc.stdout],[],[],min(left,1.0))
   if not ready: continue
   chunk=os.read(proc.stdout.fileno(),65536)
   if not chunk: break
   out+=chunk
   if len(out)>cap: fail('document_unreadable')
  try: code=proc.wait(timeout=max(0.1,deadline-time.monotonic()))
  except subprocess.TimeoutExpired: fail('document_preview_timeout')
 finally: reap(proc)
 if code!=0: fail('document_unreadable')
 return out
def draw(pdftoppm,where,fd,number):
 folder=tempfile.mkdtemp(prefix='jht-page-')
 try:
  run([pdftoppm,'-png','-f',str(number),'-l',str(number),'-scale-to',str(SIDE),'-singlefile',where,os.path.join(folder,'p')],fd,4096,cwd=folder)
  try:
   picture=os.open(os.path.join(folder,'p.png'),os.O_RDONLY|os.O_NOFOLLOW|getattr(os,'O_CLOEXEC',0))
   with os.fdopen(picture,'rb',closefd=True) as handle: data=handle.read(MAX_PNG+1)
  except OSError: fail('document_unreadable')
  if len(data)>MAX_PNG: fail('document_unreadable')
  return data
 finally: shutil.rmtree(folder,ignore_errors=True)
try:
 pdfinfo=tool('pdfinfo'); pdftoppm=tool('pdftoppm')
 with tempfile.TemporaryFile() as copy:
  copy.write(raw); copy.flush()
  fd=copy.fileno()
  where=('/proc/self/fd' if os.path.isdir('/proc/self/fd') else '/dev/fd')+'/'+str(fd)
  info=run([pdfinfo,where],fd,65536).decode('utf-8','replace')
  # the metadata of a PDF (its title, its author) is printed BEFORE the counts and may hold a line that looks like one: the last line is the tool's own
  encrypted=re.findall(r'^Encrypted:\s+(\w+)',info,re.M)
  if encrypted and encrypted[-1]=='yes': fail('document_unreadable')
  found=re.findall(r'^Pages:\s+(\d+)\s*$',info,re.M)
  if not found or int(found[-1])<1: fail('document_unreadable')
  total=int(found[-1]); shown=min(total,MAX_PAGES)
  if op=='pages': emit({'ok':True,'pages':shown,'truncated':total>MAX_PAGES,'sha256':digest})
  if page>shown: fail('invalid_request')
  png=draw(pdftoppm,where,fd,page)
except SystemExit: raise
except OSError: fail('document_preview_unavailable')
except Exception: fail('document_unreadable')
if len(png)<33 or png[:8]!=b'\x89PNG\r\n\x1a\n' or png[12:16]!=b'IHDR': fail('document_unreadable')
width,height=struct.unpack('>II',png[16:24])
if not 1<=width<=2000 or not 1<=height<=2000: fail('document_unreadable')
emit({'ok':True,'page':page,'png':base64.b64encode(png).decode('ascii'),'sha256':digest})"#;

/// The most text of a markdown document, and the most pages and the biggest picture the app believes.
const TEXT_MAX: usize = 1024 * 1024;
const PAGES_MAX: u64 = 6;
const PNG_MAX: usize = 2 * 1024 * 1024;
const PNG_SIDE_MAX: u32 = 2000;
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(45);

static PREVIEWING: AtomicBool = AtomicBool::new(false);

struct PreviewGuard;

impl PreviewGuard {
    fn acquire() -> Result<Self, DirectChatError> {
        PREVIEWING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).map_err(|_| failure("operation_in_progress"))?;
        Ok(Self)
    }
}

impl Drop for PreviewGuard {
    fn drop(&mut self) {
        PREVIEWING.store(false, Ordering::SeqCst);
    }
}

/// A markdown name: the same plain basename, ending in `.md`.
pub(crate) fn valid_markdown_name(name: &str) -> bool {
    valid_name_ending(name, ".md")
}

/// What a failed preview says. Not the save's sentences ("no file was saved"): nothing is being saved here.
fn preview_failure(reply: &Value) -> DirectChatError {
    failure(match reply.get("error").and_then(Value::as_str) {
        Some("document_not_found") => "document_preview_not_found",
        Some("document_too_large") => "document_preview_too_large",
        Some("document_changed") => "document_preview_changed",
        Some("document_preview_unavailable") => "document_preview_unavailable",
        Some("document_preview_timeout") => "document_preview_timeout",
        Some("document_unreadable" | "document_not_pdf") => "document_unreadable",
        Some("invalid_request") => "invalid_request",
        _ => "read_failed",
    })
}

/// The text of a markdown document: whole, at most 1 MiB, valid UTF-8. What the page draws of it is the page's work.
fn parse_text(reply: &Value) -> Result<String, DirectChatError> {
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(preview_failure(reply));
    }
    let data = reply.get("data").and_then(Value::as_str).ok_or_else(|| failure("read_failed"))?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| failure("read_failed"))?;
    if bytes.len() > TEXT_MAX {
        return Err(failure("document_preview_too_large"));
    }
    String::from_utf8(bytes).map_err(|_| failure("document_unreadable"))
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct DocumentPages {
    pages: u64,
    truncated: bool,
    sha256: String,
}

fn parse_pages(reply: &Value) -> Result<DocumentPages, DirectChatError> {
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(preview_failure(reply));
    }
    let pages = reply.get("pages").and_then(Value::as_u64).filter(|pages| (1..=PAGES_MAX).contains(pages)).ok_or_else(|| failure("read_failed"))?;
    let truncated = reply.get("truncated").and_then(Value::as_bool).ok_or_else(|| failure("read_failed"))?;
    let sha256 = reply.get("sha256").and_then(Value::as_str).filter(|s| hex64(s)).ok_or_else(|| failure("read_failed"))?;
    Ok(DocumentPages { pages, truncated, sha256: sha256.to_owned() })
}

/// A picture the app is willing to show: a PNG (signature, an IHDR of 13 bytes, a closing IEND), not bigger than
/// the cap and with sides inside the cap. Nothing else is ever put in an `<img>`.
fn png_is_acceptable(bytes: &[u8]) -> bool {
    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
    const IEND: &[u8] = b"\x00\x00\x00\x00IEND\xaeB`\x82";
    if bytes.len() < 33 || bytes.len() > PNG_MAX || !bytes.starts_with(SIGNATURE) || !bytes.ends_with(IEND) {
        return false;
    }
    if bytes[8..12] != 13u32.to_be_bytes() || &bytes[12..16] != b"IHDR" {
        return false;
    }
    let side = |from: usize| u32::from_be_bytes([bytes[from], bytes[from + 1], bytes[from + 2], bytes[from + 3]]);
    (1..=PNG_SIDE_MAX).contains(&side(16)) && (1..=PNG_SIDE_MAX).contains(&side(20))
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct DocumentPage {
    page: u64,
    png: String,
}

/// One page, believed only when it is the page asked for, of the very file `pages` described, and a picture
/// the app accepts. `png` stays the base64 the script sent (the page makes a `blob:` of it).
fn parse_page(reply: &Value, page: u64, sha256: &str) -> Result<DocumentPage, DirectChatError> {
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(preview_failure(reply));
    }
    if reply.get("page").and_then(Value::as_u64) != Some(page) || reply.get("sha256").and_then(Value::as_str) != Some(sha256) {
        return Err(failure("document_preview_changed"));
    }
    let png = reply.get("png").and_then(Value::as_str).ok_or_else(|| failure("read_failed"))?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(png).map_err(|_| failure("read_failed"))?;
    if !png_is_acceptable(&bytes) {
        return Err(failure("document_unreadable"));
    }
    Ok(DocumentPage { page, png: png.to_owned() })
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct DocumentText {
    text: String,
}

async fn pages_script(state: &State<'_, DirectChatState>, scopes: &State<'_, AccountScopeState>, request: Value) -> Result<Value, DirectChatError> {
    team_script_read(state, scopes, TEAM_DOCUMENT_PAGES_PY, request, PREVIEW_TIMEOUT).await
}

/// The text of one of the team's markdown documents, to be shown as text. Only after a click, only from the main
/// window, one document at a time; the name is a plain basename and never reaches a log.
#[tauri::command]
pub(crate) async fn team_document_text(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    name: String,
) -> Result<DocumentText, DirectChatError> {
    if !window_may_export(window.label()) || !valid_markdown_name(&name) {
        return Err(failure("invalid_request"));
    }
    let _running = PreviewGuard::acquire()?;
    let reply = script(&state, &scopes, json!({"op": "text", "name": name}), STAT_TIMEOUT).await?;
    Ok(DocumentText { text: parse_text(&reply)? })
}

/// How many pages one of the team's PDFs has (at most 6) and the sha256 of the file they will be drawn from.
#[tauri::command]
pub(crate) async fn team_document_pages(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    name: String,
) -> Result<DocumentPages, DirectChatError> {
    if !window_may_export(window.label()) || !valid_document_name(&name) {
        return Err(failure("invalid_request"));
    }
    let _running = PreviewGuard::acquire()?;
    parse_pages(&pages_script(&state, &scopes, json!({"op": "pages", "name": name})).await?)
}

/// One page of one of the team's PDFs, as a PNG, of the file `pages` described (`sha256`) or not at all.
#[tauri::command]
pub(crate) async fn team_document_page(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    name: String,
    page: u64,
    sha256: String,
) -> Result<DocumentPage, DirectChatError> {
    if !window_may_export(window.label()) || !valid_document_name(&name) || !(1..=PAGES_MAX).contains(&page) || !hex64(&sha256) {
        return Err(failure("invalid_request"));
    }
    let _running = PreviewGuard::acquire()?;
    let reply = pages_script(&state, &scopes, json!({"op": "page", "name": name, "page": page, "sha256": sha256})).await?;
    parse_page(&reply, page, &sha256)
}

/// The whole of a document in memory, checked as the save checks it: never more than the first call said, and the
/// sha256 of what arrived is the one the first call gave. It is what the system's reader is handed: nothing is read
/// a second time.
async fn pull_bytes<F, Fut>(described: &Described, mut next: F) -> Result<Vec<u8>, DirectChatError>
where
    F: FnMut(u64) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<u8>, DirectChatError>>,
{
    let mut bytes = Vec::with_capacity(described.bytes as usize);
    let mut offset = 0u64;
    // a team that sends a few bytes at a time is not believed
    let mut calls = 0u64;
    while offset < described.bytes {
        calls += 1;
        if calls > described.bytes / (BLOCK / 64) + 64 {
            return Err(failure("read_failed"));
        }
        let data = next(offset).await?;
        bytes.extend_from_slice(&data);
        offset += data.len() as u64;
    }
    if bytes.len() as u64 != described.bytes || hex(&Sha256::digest(&bytes)) != described.sha256 {
        return Err(failure("document_changed"));
    }
    Ok(bytes)
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct DocumentOpened {
    outcome: &'static str,
}

/// Opens one of the team's PDFs with the system's reader, from a private copy that `private_copy` makes of the bytes
/// this command has just checked (the sizes, the sha256 of the first call, the `%PDF-` at the start). Only after a
/// click, only from the main window, one at a time; the copy has a name of random bits, never the document's.
#[tauri::command]
pub(crate) async fn team_document_open(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    name: String,
) -> Result<DocumentOpened, DirectChatError> {
    if !window_may_export(window.label()) || !valid_document_name(&name) {
        return Err(failure("invalid_request"));
    }
    let _running = RunGuard::acquire()?;
    let described = parse_described(&script(&state, &scopes, json!({"op": "stat", "name": name}), STAT_TIMEOUT).await?)?;
    let bytes = {
        let (state, scopes, name, described) = (&state, &scopes, name.clone(), &described);
        pull_bytes(described, |offset| {
            let name = name.clone();
            async move {
                let reply = script(state, scopes, json!({"op": "read", "name": name, "offset": offset}), BLOCK_TIMEOUT).await?;
                parse_block(&reply, offset, described)
            }
        })
        .await?
    };
    if !bytes.starts_with(b"%PDF-") {
        return Err(failure("document_unreadable"));
    }
    tauri::async_runtime::spawn_blocking(move || private_copy::open_private_copy(CopyKind::Pdf, &bytes))
        .await
        .map_err(|_| failure("document_open_failed"))?
        .map_err(failure)?;
    Ok(DocumentOpened { outcome: "opened" })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::process::{Command, Stdio};
    use std::{
        sync::Mutex,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn scratch(name: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("jht-document-{name}-{}-{nanos}", std::process::id()))
    }

    fn described(bytes: u64, sha256: &str) -> Described {
        Described { bytes, sha256: sha256.to_owned(), stamp: [7, bytes, 1_700_000_000_000_000_000] }
    }

    #[test]
    fn the_name_is_a_plain_pdf_name_and_nothing_else() {
        for good in ["CV_Acme_123.pdf", "a.pdf", "CV.v2.final.pdf", "cover letter-7.pdf"] {
            assert!(valid_document_name(good), "{good}");
        }
        for bad in [
            "", ".pdf", "cv.txt", "cv", "cv.PDF", "../../x.pdf", "../cv.pdf", "a/b.pdf", "a\\b.pdf", "..pdf", ".hidden.pdf", " cv.pdf", "-cv.pdf",
            "a..b.pdf", "cv.pdf\n", "cv\n.pdf", "cv\u{0}.pdf", "cv\u{202e}fdp.pdf", "CV (1).pdf", "cv;rm.pdf", "cv$.pdf", "/etc/passwd", "cv.pdf ",
            "à.pdf",
        ] {
            assert!(!valid_document_name(bad), "{bad:?}");
        }
        assert!(!valid_document_name(&format!("{}.pdf", "x".repeat(NAME_MAX_CHARS - 3))), "121 characters");
        assert!(valid_document_name(&format!("{}.pdf", "x".repeat(NAME_MAX_CHARS - 4))), "120 characters");
    }

    #[test]
    fn only_the_main_window_may_ask() {
        assert!(window_may_export("main"));
        for other in ["", "login", "broker-login", "main2", "Main"] {
            assert!(!window_may_export(other), "{other}");
        }
    }

    /// The order the command takes is the contract: the system's window opens before the team is asked
    /// anything (closing it reads nothing), and the command asks for no write gate (a read: it works in the
    /// read-only view).
    #[test]
    fn the_window_comes_before_any_read_and_no_write_gate_is_asked() {
        let source = include_str!("team_document.rs");
        let command = &source[source.find("pub(crate) async fn team_document_save").unwrap()..source.find("#[cfg(test)]").unwrap()];
        let ask = command.find("ask_where(").unwrap();
        let first_read = command.find("script(&state").unwrap();
        assert!(ask < first_read, "the «Save as» window must open before the first read");
        assert!(command.contains("\"cancelled\""), "closing the window is a cancel, not an error");
        for gate in ["write_gate", "require_write", "chat_write(", "is_read_only"] {
            assert!(!command.contains(gate), "{gate}");
        }
        assert!(command.contains("window_may_export(window.label())") && command.contains("valid_document_name(&name)"));
        // the name reaches the script in its JSON on stdin and the window, never a log
        for logging in ["println!", "eprintln!", "tracing::", "log::", "record_", "emit("] {
            assert!(!command.contains(logging), "{logging}");
        }
    }

    #[test]
    fn replies_are_believed_only_when_they_are_whole_within_the_caps_and_of_the_same_file() {
        let sum = "a".repeat(64);
        let stamp = json!([7, 1234, 1_700_000_000_000_000_000u64]);
        assert_eq!(
            parse_described(&json!({"ok": true, "bytes": 1234, "sha256": sum, "stamp": stamp})).unwrap(),
            described(1234, &sum)
        );
        for (reply, code) in [
            (json!({"ok": false, "error": "document_not_found"}), "document_not_found"),
            (json!({"ok": false, "error": "document_too_large"}), "document_too_large"),
            (json!({"ok": false, "error": "document_not_pdf"}), "document_not_pdf"),
            (json!({"ok": false, "error": "something else"}), "read_failed"),
            (json!({"ok": true, "bytes": MAX_DOCUMENT + 1, "sha256": sum, "stamp": [7, MAX_DOCUMENT + 1, 1]}), "document_too_large"),
            (json!({"ok": true, "bytes": 0, "sha256": sum, "stamp": [7, 0, 1]}), "read_failed"),
            (json!({"ok": true, "bytes": 10, "sha256": "ABC", "stamp": [7, 10, 1]}), "read_failed"),
            (json!({"ok": true, "bytes": 10, "sha256": sum}), "read_failed"),
            (json!({"ok": true, "bytes": 10, "sha256": sum, "stamp": [7, 11, 1]}), "read_failed"),
            (json!({"ok": true, "bytes": 10, "sha256": sum, "stamp": [7, "10", 1]}), "read_failed"),
        ] {
            assert_eq!(parse_described(&reply).unwrap_err().code, code, "{reply}");
        }
        let base = described(12, &sum);
        let data = base64::engine::general_purpose::STANDARD.encode(b"%PDF-1.4 abc");
        let stamp = json!(base.stamp);
        assert_eq!(parse_block(&json!({"ok": true, "data": data, "stamp": stamp}), 0, &base).unwrap(), b"%PDF-1.4 abc");
        for (reply, offset) in [
            (json!({"ok": true, "data": data, "stamp": stamp}), 5),
            (json!({"ok": true, "data": "", "stamp": stamp}), 0),
            (json!({"ok": true, "data": "***", "stamp": stamp}), 0),
            (json!({"ok": true, "stamp": stamp}), 0),
            (json!({"ok": true, "data": data}), 0),
        ] {
            assert_eq!(parse_block(&reply, offset, &base).unwrap_err().code, "read_failed", "{reply}");
        }
        let big = described(BLOCK * 2, &sum);
        let too_big = base64::engine::general_purpose::STANDARD.encode(vec![0u8; BLOCK as usize + 1]);
        assert_eq!(parse_block(&json!({"ok": true, "data": too_big, "stamp": big.stamp}), 0, &big).unwrap_err().code, "read_failed");
    }

    /// The file changed between two pages: any of the three parts of the stamp stops the copy.
    #[test]
    fn a_page_of_another_version_of_the_file_is_the_file_changed() {
        let base = described(12, &"a".repeat(64));
        let data = base64::engine::general_purpose::STANDARD.encode(b"%PDF-1.4 abc");
        for changed in [[8, 12, 1_700_000_000_000_000_000u64], [7, 13, 1_700_000_000_000_000_000], [7, 12, 1_700_000_000_000_000_001]] {
            let error = parse_block(&json!({"ok": true, "data": data, "stamp": changed}), 0, &base).unwrap_err();
            assert_eq!(error.code, "document_changed", "{changed:?}");
        }
    }

    fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    #[test]
    fn a_whole_file_is_kept_private_and_a_wrong_or_short_one_takes_its_part_away() {
        let dir = scratch("pull");
        fs::create_dir_all(&dir).unwrap();
        let content = vec![b'x'; 1_300_000];
        let described = described(content.len() as u64, &hex(&Sha256::digest(&content)));
        let serve = |content: Vec<u8>| {
            move |offset: u64| {
                let content = content.clone();
                async move {
                    let end = (offset as usize + BLOCK as usize).min(content.len());
                    Ok::<_, DirectChatError>(content[offset as usize..end].to_vec())
                }
            }
        };
        let part = dir.join(".a.pdf.part");
        block_on(pull(&part, &described, serve(content.clone()))).unwrap();
        assert_eq!(fs::read(&part).unwrap(), content);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&part).unwrap().permissions().mode() & 0o777, 0o600, "owner only");
        }
        fs::remove_file(&part).unwrap();

        // what arrives is not what the first call described: nothing is left on the disk
        let mut altered = content.clone();
        altered[777] = b'y';
        let error = block_on(pull(&part, &described, serve(altered))).unwrap_err();
        assert_eq!(error.code, "document_changed");
        assert!(!part.exists());

        // a team that goes quiet halfway, and a file that changes between two pages
        let calls = Mutex::new(0u32);
        let error = block_on(pull(&part, &described, |offset| {
            *calls.lock().unwrap() += 1;
            let content = content.clone();
            async move {
                if offset > 0 {
                    return Err(failure("document_changed"));
                }
                Ok(content[..BLOCK as usize].to_vec())
            }
        }))
        .unwrap_err();
        assert_eq!(error.code, "document_changed");
        assert!(!part.exists(), "the partial file goes when the file changes");
        assert_eq!(*calls.lock().unwrap(), 2);

        // a part left by a stuck earlier run is never overwritten
        fs::write(&part, "stale").unwrap();
        assert_eq!(block_on(pull(&part, &described, serve(content))).unwrap_err().code, "document_save_failed");
        assert_eq!(fs::read_to_string(&part).unwrap(), "stale");
        fs::remove_dir_all(dir).unwrap();
    }

    /// The script, run for real against a folder that stands in for /jht_user/cv.
    /// Only on Unix: the script runs in the Linux container (O_NOFOLLOW, hard
    /// links, FIFOs), and a Windows host cannot stand in for it.
    #[cfg(unix)]
    fn ask(root: &Path, request: Value) -> Value {
        // Forward slashes: on Windows the folder's backslashes would be escapes
        // inside the script's Python string literal.
        let source = TEAM_DOCUMENT_PY.replace("/jht_user/cv", &root.to_string_lossy().replace('\\', "/"));
        let mut child = Command::new("python3")
            .arg("-I")
            .arg("-c")
            .arg(source)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("python3");
        writeln!(child.stdin.take().unwrap(), "{request}").unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        serde_json::from_slice(&output.stdout).unwrap_or_else(|_| panic!("not JSON: {}", String::from_utf8_lossy(&output.stdout)))
    }

    #[cfg(unix)]
    fn error_of(reply: &Value) -> &str {
        assert_eq!(reply["ok"], false, "{reply}");
        reply["error"].as_str().unwrap()
    }

    #[cfg(unix)]
    fn stat_error(root: &Path, name: &str) -> String {
        error_of(&ask(root, json!({"op": "stat", "name": name}))).to_owned()
    }

    #[test]
    #[cfg(unix)]
    fn the_script_reads_one_folder_one_kind_of_file_and_nothing_else() {
        let base = scratch("script");
        let root = base.join("cv");
        fs::create_dir_all(&root).unwrap();
        let pdf = [b"%PDF-1.7\n".as_slice(), &vec![b'z'; 600_000]].concat();
        fs::write(root.join("CV_1.pdf"), &pdf).unwrap();
        fs::write(root.join("notes.pdf"), b"just text, not a pdf at all").unwrap();
        fs::write(root.join("tiny.pdf"), b"%PD").unwrap();
        fs::write(root.join("exact.pdf"), [b"%PDF-".as_slice(), &vec![0u8; MAX_DOCUMENT as usize - 5]].concat()).unwrap();
        fs::write(root.join("big.pdf"), [b"%PDF-".as_slice(), &vec![0u8; MAX_DOCUMENT as usize - 4]].concat()).unwrap();
        // things outside the folder, and ways to reach them (the stand-in for /jht_home)
        let home = base.join("jht_home");
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join("secret.pdf"), b"%PDF-1.7 SECRET").unwrap();
        // a file with ONE name, so that only the link (not the link count) can keep it out
        fs::write(home.join("alone.pdf"), b"%PDF-1.7 ALONE").unwrap();
        fs::create_dir_all(root.join("sub.pdf")).unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(home.join("alone.pdf"), root.join("link.pdf")).unwrap();
            std::os::unix::fs::symlink(&home, root.join("homelink.pdf")).unwrap();
            // an agent made a hardlink to a file it should not be able to hand over
            fs::hard_link(home.join("secret.pdf"), root.join("hard.pdf")).unwrap();
            assert!(Command::new("mkfifo").arg(root.join("fifo.pdf")).status().unwrap().success());
        }

        let stat = ask(&root, json!({"op": "stat", "name": "CV_1.pdf"}));
        assert_eq!(stat["ok"], true, "{stat}");
        assert_eq!(stat["bytes"], pdf.len());
        assert_eq!(stat["sha256"], hex(&Sha256::digest(&pdf)));
        assert_eq!(stat["stamp"][1], pdf.len());
        // the blocks add up to the file, in order, and every one says the same stamp
        let mut got = Vec::new();
        let mut offset = 0usize;
        while offset < pdf.len() {
            let block = ask(&root, json!({"op": "read", "name": "CV_1.pdf", "offset": offset}));
            assert_eq!(block["stamp"], stat["stamp"]);
            let data = base64::engine::general_purpose::STANDARD.decode(block["data"].as_str().unwrap()).unwrap();
            assert!(!data.is_empty() && data.len() as u64 <= BLOCK);
            offset += data.len();
            got.extend(data);
        }
        assert_eq!(got, pdf);
        // the cap is the file of exactly 10 MiB, and one byte more is too large
        assert_eq!(ask(&root, json!({"op": "stat", "name": "exact.pdf"}))["ok"], true);
        assert_eq!(stat_error(&root, "big.pdf"), "document_too_large");

        assert_eq!(stat_error(&root, "missing.pdf"), "document_not_found");
        assert_eq!(stat_error(&root, "notes.pdf"), "document_not_pdf", "no %PDF- at the start");
        assert_eq!(stat_error(&root, "tiny.pdf"), "document_not_pdf");
        assert_eq!(stat_error(&root, "sub.pdf"), "document_not_found", "a folder");
        #[cfg(unix)]
        {
            assert_eq!(stat_error(&root, "link.pdf"), "document_not_found", "a link that leaves the folder");
            assert_eq!(stat_error(&root, "homelink.pdf"), "document_not_found", "a link to the team's home");
            assert_eq!(stat_error(&root, "hard.pdf"), "document_not_found", "a second name for another file");
            assert_eq!(stat_error(&root, "fifo.pdf"), "document_not_found", "a FIFO does not hang the read");
        }
        for hostile in [
            "../secret.pdf", "../../x.pdf", "a/b.pdf", "/etc/passwd", "a/../../secret.pdf", "..pdf", ".pdf", ".hidden.pdf", " x.pdf", "-x.pdf", "x.txt",
            "CV_1.pdf\n", "CV\n_1.pdf", "secret.pdf\u{0}.pdf", "",
        ] {
            assert_eq!(stat_error(&root, hostile), "invalid_request", "{hostile:?}");
        }
        assert_eq!(stat_error(&root, &format!("{}.pdf", "x".repeat(118))), "invalid_request", "121 characters");
        for bad in [
            json!({"op": "list", "name": "CV_1.pdf"}),
            json!({"op": "read", "name": "CV_1.pdf", "offset": -1}),
            json!({"op": "read", "name": "CV_1.pdf", "offset": "0"}),
            json!({"op": "read", "name": "CV_1.pdf", "offset": true}),
            json!({"op": "read", "name": "CV_1.pdf", "path": "/etc/passwd"}),
            json!({"op": "read", "name": ["CV_1.pdf"]}),
            json!({"op": "read"}),
        ] {
            assert_eq!(error_of(&ask(&root, bad.clone())), "invalid_request", "{bad}");
        }
        fs::remove_dir_all(base).unwrap();
    }

    /// A file rewritten between two pages is not the file the first call described: the stamp says so.
    #[test]
    #[cfg(unix)]
    fn a_rewritten_file_has_another_stamp() {
        let base = scratch("stamp");
        fs::create_dir_all(&base).unwrap();
        fs::write(base.join("a.pdf"), b"%PDF-1.7 first version").unwrap();
        let first = ask(&base, json!({"op": "stat", "name": "a.pdf"}));
        // same size, other content, a later mtime
        std::thread::sleep(Duration::from_millis(20));
        fs::write(base.join("a.pdf"), b"%PDF-1.7 other version").unwrap();
        let page = ask(&base, json!({"op": "read", "name": "a.pdf", "offset": 0}));
        assert_ne!(page["stamp"], first["stamp"]);
        let described = parse_described(&first).unwrap();
        assert_eq!(parse_block(&page, 0, &described).unwrap_err().code, "document_changed");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn the_script_that_ships_names_the_one_folder_opens_by_descriptor_and_enforces_the_caps() {
        assert!(TEAM_DOCUMENT_PY.contains("ROOT='/jht_user/cv'"));
        assert!(TEAM_DOCUMENT_PY.contains(&format!("MAX_BYTES={}*1024*1024", MAX_DOCUMENT / 1024 / 1024)));
        assert!(TEAM_DOCUMENT_PY.contains(&format!("BLOCK={}*1024", BLOCK / 1024)));
        assert_eq!(TEAM_DOCUMENT_PY.matches("/jht_").count(), 1, "one folder, and no other path in the script");
        for forbidden in ["listdir", "scandir", "glob", "realpath", "islink", "os.stat(", "os.lstat(", "subprocess", "system(", "argv"] {
            assert!(!TEAM_DOCUMENT_PY.contains(forbidden), "{forbidden}: a path check followed by a second open, a listing or a process");
        }
        for needed in ["O_NOFOLLOW", "dir_fd=dirfd", "os.fstat(fd)", "S_ISREG", "st_nlink!=1", "b'%PDF-'", "sys.stdin.readline()"] {
            assert!(TEAM_DOCUMENT_PY.contains(needed), "{needed}");
        }
    }

    // ── the preview: text, pages, pictures ─────────────────────────────────────────────────────────────────────

    #[test]
    fn the_preview_names_are_plain_basenames_of_the_right_kind() {
        for good in ["CV_Acme_123.md", "a.md", "cover letter-7.md"] {
            assert!(valid_markdown_name(good), "{good}");
            assert!(!valid_document_name(good), "{good} is not a PDF name");
        }
        for bad in ["", ".md", "cv.txt", "cv.MD", "../x.md", "a/b.md", "..md", ".hidden.md", " cv.md", "-cv.md", "a..b.md", "cv.md\n", "cv\u{0}.md", "cv\u{202e}dm.md", "cv.pdf", "à.md"] {
            assert!(!valid_markdown_name(bad), "{bad:?}");
        }
        assert!(!valid_markdown_name(&format!("{}.md", "x".repeat(NAME_MAX_CHARS - 2))), "121 characters");
        assert!(valid_markdown_name(&format!("{}.md", "x".repeat(NAME_MAX_CHARS - 3))), "120 characters");
        assert!(!valid_markdown_name("cv.pdf") && !valid_document_name("cv.md"));
    }

    #[test]
    fn a_failed_preview_is_told_in_the_previews_words_never_the_saves() {
        for (script, code) in [
            ("document_not_found", "document_preview_not_found"),
            ("document_too_large", "document_preview_too_large"),
            ("document_changed", "document_preview_changed"),
            ("document_preview_unavailable", "document_preview_unavailable"),
            ("document_preview_timeout", "document_preview_timeout"),
            ("document_unreadable", "document_unreadable"),
            ("document_not_pdf", "document_unreadable"),
            ("invalid_request", "invalid_request"),
            ("anything else", "read_failed"),
        ] {
            assert_eq!(preview_failure(&json!({"ok": false, "error": script})).code, code, "{script}");
        }
        assert_eq!(preview_failure(&json!({"ok": false})).code, "read_failed");
    }

    #[test]
    fn a_text_is_believed_only_when_whole_valid_utf8_and_within_one_mebibyte() {
        let text = |bytes: &[u8]| json!({"ok": true, "data": base64::engine::general_purpose::STANDARD.encode(bytes)});
        assert_eq!(parse_text(&text("# CV\n\nè ü ✓".as_bytes())).unwrap(), "# CV\n\nè ü ✓");
        assert_eq!(parse_text(&text(&vec![b'a'; TEXT_MAX])).unwrap().len(), TEXT_MAX);
        assert_eq!(parse_text(&text(&vec![b'a'; TEXT_MAX + 1])).unwrap_err().code, "document_preview_too_large");
        assert_eq!(parse_text(&text(&[0xff, 0xfe, b'a'])).unwrap_err().code, "document_unreadable");
        assert_eq!(parse_text(&json!({"ok": true, "data": "***"})).unwrap_err().code, "read_failed");
        assert_eq!(parse_text(&json!({"ok": true})).unwrap_err().code, "read_failed");
        assert_eq!(parse_text(&json!({"ok": false, "error": "document_not_found"})).unwrap_err().code, "document_preview_not_found");
    }

    #[test]
    fn the_pages_are_believed_only_within_the_cap_and_with_a_sha256() {
        let sum = "b".repeat(64);
        assert_eq!(
            parse_pages(&json!({"ok": true, "pages": 2, "truncated": false, "sha256": sum})).unwrap(),
            DocumentPages { pages: 2, truncated: false, sha256: sum.clone() }
        );
        assert!(parse_pages(&json!({"ok": true, "pages": 6, "truncated": true, "sha256": sum})).is_ok());
        for reply in [
            json!({"ok": true, "pages": 0, "truncated": false, "sha256": sum}),
            json!({"ok": true, "pages": 7, "truncated": true, "sha256": sum}),
            json!({"ok": true, "pages": 10000, "truncated": true, "sha256": sum}),
            json!({"ok": true, "pages": "2", "truncated": false, "sha256": sum}),
            json!({"ok": true, "pages": 2, "sha256": sum}),
            json!({"ok": true, "pages": 2, "truncated": false, "sha256": "ABC"}),
            json!({"ok": true, "pages": 2, "truncated": false}),
        ] {
            assert_eq!(parse_pages(&reply).unwrap_err().code, "read_failed", "{reply}");
        }
        assert_eq!(parse_pages(&json!({"ok": false, "error": "document_unreadable"})).unwrap_err().code, "document_unreadable");
    }

    /// A 1×1 PNG: signature, IHDR of 13 bytes, one IDAT, IEND.
    const TINY_PNG: &[u8] = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\x0dIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\x0d\x0a-\xb4\x00\x00\x00\x00IEND\xaeB`\x82";

    fn png_with_sides(width: u32, height: u32) -> Vec<u8> {
        let mut png = TINY_PNG.to_vec();
        png[16..20].copy_from_slice(&width.to_be_bytes());
        png[20..24].copy_from_slice(&height.to_be_bytes());
        png
    }

    #[test]
    fn only_a_png_of_sane_size_is_ever_shown() {
        assert!(png_is_acceptable(TINY_PNG));
        assert!(png_is_acceptable(&png_with_sides(1400, 1400)));
        assert!(png_is_acceptable(&png_with_sides(PNG_SIDE_MAX, 1)));
        for (label, png) in [
            ("a side of 0", png_with_sides(0, 10)),
            ("a side over the cap", png_with_sides(PNG_SIDE_MAX + 1, 10)),
            ("22000 pixels", png_with_sides(22000, 22000)),
            ("a JPEG", b"\xff\xd8\xff\xe0 not a png at all, but long enough to pass the length".to_vec()),
            ("an SVG", b"<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>".to_vec()),
            ("empty", Vec::new()),
            ("the signature alone", TINY_PNG[..8].to_vec()),
            ("no IEND", TINY_PNG[..TINY_PNG.len() - 12].to_vec()),
            ("too big", [TINY_PNG[..TINY_PNG.len() - 12].to_vec(), vec![0u8; PNG_MAX], TINY_PNG[TINY_PNG.len() - 12..].to_vec()].concat()),
        ] {
            assert!(!png_is_acceptable(&png), "{label}");
        }
        let mut wrong_chunk = TINY_PNG.to_vec();
        wrong_chunk[12..16].copy_from_slice(b"IDAT");
        assert!(!png_is_acceptable(&wrong_chunk), "the first chunk is not IHDR");
        let mut wrong_length = TINY_PNG.to_vec();
        wrong_length[8..12].copy_from_slice(&14u32.to_be_bytes());
        assert!(!png_is_acceptable(&wrong_length), "an IHDR that is not 13 bytes");
    }

    #[test]
    fn a_page_is_believed_only_when_asked_for_of_the_same_file_and_a_picture_the_app_accepts() {
        let sum = "c".repeat(64);
        let png = base64::engine::general_purpose::STANDARD.encode(TINY_PNG);
        let good = json!({"ok": true, "page": 2, "png": png, "sha256": sum});
        assert_eq!(parse_page(&good, 2, &sum).unwrap(), DocumentPage { page: 2, png: png.clone() });
        assert_eq!(parse_page(&good, 1, &sum).unwrap_err().code, "document_preview_changed", "another page than asked");
        assert_eq!(parse_page(&good, 2, &"d".repeat(64)).unwrap_err().code, "document_preview_changed", "another version of the file");
        let not_png = base64::engine::general_purpose::STANDARD.encode(b"<html><script>alert(1)</script></html> padding to be long enough....");
        assert_eq!(
            parse_page(&json!({"ok": true, "page": 2, "png": not_png, "sha256": sum}), 2, &sum).unwrap_err().code,
            "document_unreadable"
        );
        assert_eq!(parse_page(&json!({"ok": true, "page": 2, "png": "***", "sha256": sum}), 2, &sum).unwrap_err().code, "read_failed");
        assert_eq!(parse_page(&json!({"ok": true, "page": 2, "sha256": sum}), 2, &sum).unwrap_err().code, "read_failed");
        assert_eq!(parse_page(&json!({"ok": false, "error": "document_preview_timeout"}), 2, &sum).unwrap_err().code, "document_preview_timeout");
    }

    /// The commands of the preview take the same gates as the save, in the same order: the main window and a plain name
    /// of the right kind before the team is asked anything, no write gate (a read), no name in any log.
    #[test]
    fn the_preview_commands_check_window_and_name_first_and_log_nothing() {
        let source = include_str!("team_document.rs");
        let start = source.find("pub(crate) async fn team_document_text").unwrap();
        let commands = &source[start..source.find("#[cfg(test)]").unwrap()];
        for (name, check) in [
            ("team_document_text", "valid_markdown_name(&name)"),
            ("team_document_pages", "valid_document_name(&name)"),
            ("team_document_page", "valid_document_name(&name) || !(1..=PAGES_MAX).contains(&page) || !hex64(&sha256)"),
        ] {
            let at = commands.find(&format!("pub(crate) async fn {name}(")).unwrap();
            let body = &commands[at..];
            let body = &body[..body.find("\n}\n").unwrap()];
            assert!(body.contains("window_may_export(window.label())") && body.contains(check), "{name}");
            let gate = body.find("window_may_export").unwrap();
            let guard = body.find("PreviewGuard::acquire").unwrap();
            let ask = body.find("script(&state").or_else(|| body.find("pages_script(&state")).unwrap();
            assert!(gate < guard && guard < ask, "{name}: gates first, then the one-at-a-time guard, then the team");
        }
        for gate in ["write_gate", "require_write", "chat_write(", "is_read_only"] {
            assert!(!commands.contains(gate), "{gate}");
        }
        for logging in ["println!", "eprintln!", "tracing::", "log::", "record_", "emit("] {
            assert!(!commands.contains(logging), "{logging}");
        }
    }

    #[test]
    fn the_app_has_no_pdf_or_markdown_library_and_never_opens_a_pdf_in_the_window() {
        let manifest = include_str!("../Cargo.toml").to_lowercase();
        for library in ["pdf", "poppler", "mupdf", "lopdf", "markdown", "pulldown", "comrak", "html2", "ammonia"] {
            assert!(!manifest.contains(library), "{library} in Cargo.toml");
        }
    }

    #[test]
    fn the_script_that_draws_pages_starts_only_the_two_tools_with_a_fixed_argv_and_limits() {
        let script = TEAM_DOCUMENT_PAGES_PY;
        assert!(script.contains("ROOT='/jht_user/cv'"));
        assert_eq!(script.matches("/jht_").count(), 1, "one folder, and no other path in the script");
        assert!(script.contains("MAX_BYTES=10*1024*1024") && script.contains("MAX_PAGES=6") && script.contains("MAX_PNG=2*1024*1024"));
        for forbidden in ["shell=True", "os.system", "os.popen", "listdir", "scandir", "glob", "realpath", "islink", "os.stat(", "os.lstat(", "argv=sys", "sys.argv", "eval(", "exec(", "input("] {
            assert!(!script.contains(forbidden), "{forbidden}");
        }
        for needed in [
            "O_NOFOLLOW", "dir_fd=dirfd", "os.fstat(fd)", "S_ISREG", "st_nlink!=1", "b'%PDF-'", "sys.stdin.readline()", "hashlib.sha256(raw)",
            "pass_fds=(fd,)", "start_new_session=True", "os.killpg", "RLIMIT_AS", "RLIMIT_CPU", "RLIMIT_FSIZE", "stdin=subprocess.DEVNULL",
            "env={'PATH':'/usr/bin:/bin','LC_ALL':'C'}", "'-scale-to',str(SIDE)", "'-singlefile'", "document_changed", "document_preview_timeout",
            "document_preview_unavailable", "b'\\x89PNG\\r\\n\\x1a\\n'", "b'IHDR'", "STRICT=sys.platform.startswith('linux')", "if STRICT: raise",
        ] {
            assert!(script.contains(needed), "{needed}");
        }
        // the size of the picture comes from -scale-to, never from a resolution a MediaBox can blow up
        assert!(!script.contains("'-r'") && !script.contains("'-rx'") && !script.contains("-r "), "no -r resolution");
        // two tools, by name, and nothing else is started
        assert_eq!(script.matches("subprocess.Popen(").count(), 1);
        assert_eq!(script.matches("tool('").count(), 2, "pdfinfo and pdftoppm");
    }

    #[cfg(unix)]
    fn pages_script_in(root: &Path, tools: &Path, limit: u32) -> String {
        let tuple = format!("('{}',)", tools.to_string_lossy().replace('\\', "/"));
        TEAM_DOCUMENT_PAGES_PY
            .replace("/jht_user/cv", &root.to_string_lossy().replace('\\', "/"))
            .replace("TOOLS=('/usr/bin','/usr/local/bin','/bin')", &format!("TOOLS={tuple}"))
            .replace("LIMIT=20", &format!("LIMIT={limit}"))
    }

    #[cfg(unix)]
    fn ask_pages(root: &Path, tools: &Path, limit: u32, request: Value) -> Value {
        let mut child = Command::new("python3")
            .arg("-I")
            .arg("-c")
            .arg(pages_script_in(root, tools, limit))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("python3");
        use std::io::Write as _;
        child.stdin.take().unwrap().write_all(format!("{request}\n").as_bytes()).unwrap();
        let output = child.wait_with_output().unwrap();
        serde_json::from_slice(&output.stdout).unwrap_or_else(|_| panic!("not JSON: {} {}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr)))
    }

    /// Stand-ins for poppler's two tools: shell scripts that do what the test needs.
    #[cfg(unix)]
    fn fake_tools(base: &Path, pdfinfo: &str, pdftoppm: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let dir = base.join("tools");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("ok.png"), TINY_PNG).unwrap();
        for (name, body) in [("pdfinfo", pdfinfo), ("pdftoppm", pdftoppm)] {
            fs::write(dir.join(name), format!("#!/bin/sh\n{body}\n")).unwrap();
            fs::set_permissions(dir.join(name), fs::Permissions::from_mode(0o755)).unwrap();
        }
        dir
    }

    #[cfg(unix)]
    const LAST_ARG: &str = "for a; do last=\"$a\"; done";

    #[test]
    #[cfg(unix)]
    fn the_pages_script_draws_one_page_of_the_file_it_hashed_and_nothing_else() {
        let base = scratch("pages");
        let root = base.join("cv");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.pdf"), b"%PDF-1.4 a file the fake tools do not read").unwrap();
        let tools = fake_tools(&base, "echo 'Pages:          3'", &format!("{LAST_ARG}\ncp \"$(dirname \"$0\")/ok.png\" \"$last.png\""));
        let pages = ask_pages(&root, &tools, 20, json!({"op": "pages", "name": "a.pdf"}));
        assert_eq!(pages["ok"], true, "{pages}");
        assert_eq!((pages["pages"].as_u64(), pages["truncated"].as_bool()), (Some(3), Some(false)));
        let sum = pages["sha256"].as_str().unwrap().to_owned();
        assert_eq!(parse_pages(&pages).unwrap().pages, 3);
        let page = ask_pages(&root, &tools, 20, json!({"op": "page", "name": "a.pdf", "page": 2, "sha256": sum}));
        assert_eq!(page["ok"], true, "{page}");
        assert_eq!(parse_page(&page, 2, &sum).unwrap().png, base64::engine::general_purpose::STANDARD.encode(TINY_PNG));
        // a page past the count, and a file that is not the one `pages` described
        assert_eq!(error_of(&ask_pages(&root, &tools, 20, json!({"op": "page", "name": "a.pdf", "page": 4, "sha256": sum}))), "invalid_request");
        assert_eq!(error_of(&ask_pages(&root, &tools, 20, json!({"op": "page", "name": "a.pdf", "page": 1, "sha256": "0".repeat(64)}))), "document_changed");
        // ten thousand pages are six
        let many = fake_tools(&base.join("many"), "echo 'Pages:          10000'", "exit 1");
        let truncated = ask_pages(&root, &many, 20, json!({"op": "pages", "name": "a.pdf"}));
        assert_eq!((truncated["pages"].as_u64(), truncated["truncated"].as_bool()), (Some(6), Some(true)), "{truncated}");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn the_pages_script_turns_every_way_the_tools_go_wrong_into_a_closed_code() {
        let base = scratch("pages-bad");
        let root = base.join("cv");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.pdf"), b"%PDF-1.4 a file the fake tools do not read").unwrap();
        let page = |tools: &Path, limit: u32| {
            let sum = ask_pages(&root, tools, limit, json!({"op": "pages", "name": "a.pdf"}))["sha256"].as_str().map(str::to_owned);
            ask_pages(&root, tools, limit, json!({"op": "page", "name": "a.pdf", "page": 1, "sha256": sum.unwrap_or_else(|| "0".repeat(64))}))
        };
        let info = "echo 'Pages:          1'";
        // a tool that sleeps is stopped at the deadline, and so is what it started
        let slow = fake_tools(&base.join("slow"), info, "sleep 29.3");
        let started = std::time::Instant::now();
        assert_eq!(error_of(&page(slow.as_path(), 2)), "document_preview_timeout");
        assert!(started.elapsed() < Duration::from_secs(15), "the deadline holds");
        std::thread::sleep(Duration::from_millis(300));
        let survivors = Command::new("sh").arg("-c").arg("ps -axo command | grep -c '^sleep 29.3'").output().unwrap();
        assert_eq!(String::from_utf8_lossy(&survivors.stdout).trim(), "0", "the process group is killed whole");
        // a picture bigger than the cap, a file that is not a picture, a tool that fails
        let big = fake_tools(&base.join("big"), info, &format!("{LAST_ARG}\nhead -c 5000000 /dev/zero > \"$last.png\""));
        assert_eq!(error_of(&page(big.as_path(), 20)), "document_unreadable");
        let text = fake_tools(&base.join("text"), info, &format!("{LAST_ARG}\necho '<html><script>alert(1)</script></html> and some padding' > \"$last.png\""));
        assert_eq!(error_of(&page(text.as_path(), 20)), "document_unreadable");
        let failing = fake_tools(&base.join("failing"), info, "exit 1");
        assert_eq!(error_of(&page(failing.as_path(), 20)), "document_unreadable");
        let nothing = fake_tools(&base.join("nothing"), info, "exit 0");
        assert_eq!(error_of(&page(nothing.as_path(), 20)), "document_unreadable", "a tool that draws nothing");
        // a PDF that is encrypted, or that pdfinfo cannot read
        let encrypted = fake_tools(&base.join("encrypted"), "printf 'Pages:  1\\nEncrypted:      yes (print:yes copy:no)\\n'", "exit 0");
        assert_eq!(error_of(&ask_pages(&root, &encrypted, 20, json!({"op": "pages", "name": "a.pdf"}))), "document_unreadable");
        let damaged = fake_tools(&base.join("damaged"), "exit 1", "exit 0");
        assert_eq!(error_of(&ask_pages(&root, &damaged, 20, json!({"op": "pages", "name": "a.pdf"}))), "document_unreadable");
        // no tools in this image
        let missing = base.join("nowhere");
        assert_eq!(error_of(&ask_pages(&root, &missing, 20, json!({"op": "pages", "name": "a.pdf"}))), "document_preview_unavailable");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn the_pages_script_opens_one_folder_one_kind_of_file_and_takes_only_plain_requests() {
        let base = scratch("pages-open");
        let root = base.join("cv");
        fs::create_dir_all(&root).unwrap();
        let tools = fake_tools(&base, "echo 'Pages:          1'", "exit 1");
        fs::write(root.join("notes.pdf"), b"just text, not a pdf at all").unwrap();
        fs::write(root.join("tiny.pdf"), b"%PD").unwrap();
        fs::write(root.join("big.pdf"), [b"%PDF-".as_slice(), &vec![0u8; MAX_DOCUMENT as usize - 4]].concat()).unwrap();
        let home = base.join("jht_home");
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join("secret.pdf"), b"%PDF-1.7 SECRET").unwrap();
        std::os::unix::fs::symlink(home.join("secret.pdf"), root.join("link.pdf")).unwrap();
        fs::hard_link(home.join("secret.pdf"), root.join("hard.pdf")).unwrap();
        fs::create_dir_all(root.join("sub.pdf")).unwrap();
        let pages = |name: &str| error_of(&ask_pages(&root, &tools, 20, json!({"op": "pages", "name": name}))).to_owned();
        assert_eq!(pages("missing.pdf"), "document_not_found");
        assert_eq!(pages("notes.pdf"), "document_not_pdf");
        assert_eq!(pages("tiny.pdf"), "document_not_pdf");
        assert_eq!(pages("big.pdf"), "document_too_large");
        assert_eq!(pages("link.pdf"), "document_not_found", "a link that leaves the folder");
        assert_eq!(pages("hard.pdf"), "document_not_found", "a second name for another file");
        assert_eq!(pages("sub.pdf"), "document_not_found", "a folder");
        for hostile in ["../secret.pdf", "a/b.pdf", "/etc/passwd", "..pdf", ".h.pdf", " x.pdf", "-x.pdf", "x.txt", "x.md", "a\n.pdf", ""] {
            assert_eq!(pages(hostile), "invalid_request", "{hostile:?}");
        }
        let sum = "a".repeat(64);
        for bad in [
            json!({"op": "page", "name": "a.pdf", "page": 0, "sha256": sum}),
            json!({"op": "page", "name": "a.pdf", "page": 7, "sha256": sum}),
            json!({"op": "page", "name": "a.pdf", "page": "1", "sha256": sum}),
            json!({"op": "page", "name": "a.pdf", "page": true, "sha256": sum}),
            json!({"op": "page", "name": "a.pdf", "page": 1}),
            json!({"op": "page", "name": "a.pdf", "page": 1, "sha256": "XYZ"}),
            json!({"op": "pages", "name": "a.pdf", "page": 1}),
            json!({"op": "pages", "name": "a.pdf", "sha256": sum}),
            json!({"op": "list", "name": "a.pdf"}),
            json!({"op": "pages", "name": "a.pdf", "path": "/etc/passwd"}),
            json!({"op": "pages"}),
        ] {
            assert_eq!(error_of(&ask_pages(&root, &tools, 20, bad.clone())), "invalid_request", "{bad}");
        }
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn the_text_op_reads_markdown_whole_and_only_markdown() {
        let base = scratch("text");
        let root = base.join("cv");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("cv.md"), "# CV\n\nè ü ✓\n").unwrap();
        fs::write(root.join("bin.md"), b"\xff\xfe\x00bad").unwrap();
        fs::write(root.join("two.md"), vec![b'a'; 2 * 1024 * 1024]).unwrap();
        fs::write(root.join("exact.md"), vec![b'a'; TEXT_MAX]).unwrap();
        fs::write(root.join("cv.pdf"), b"%PDF-1.4 x").unwrap();
        let home = base.join("jht_home");
        fs::create_dir_all(&home).unwrap();
        fs::write(home.join("secret.md"), "SECRET").unwrap();
        std::os::unix::fs::symlink(home.join("secret.md"), root.join("link.md")).unwrap();
        fs::hard_link(home.join("secret.md"), root.join("hard.md")).unwrap();
        let text = ask(&root, json!({"op": "text", "name": "cv.md"}));
        assert_eq!(parse_text(&text).unwrap(), "# CV\n\nè ü ✓\n");
        assert_eq!(ask(&root, json!({"op": "text", "name": "exact.md"}))["ok"], true, "exactly 1 MiB");
        let code = |name: &str| error_of(&ask(&root, json!({"op": "text", "name": name}))).to_owned();
        assert_eq!(code("bin.md"), "document_unreadable");
        assert_eq!(code("two.md"), "document_too_large");
        assert_eq!(code("missing.md"), "document_not_found");
        assert_eq!(code("link.md"), "document_not_found");
        assert_eq!(code("hard.md"), "document_not_found");
        for hostile in ["cv.pdf", "../secret.md", "a/b.md", "..md", ".h.md", "x.txt", "cv.md\n", ""] {
            assert_eq!(code(hostile), "invalid_request", "{hostile:?}");
        }
        // a `.md` name never goes through the PDF operations and a `.pdf` name never through `text`
        assert_eq!(stat_error(&root, "cv.md"), "invalid_request");
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn a_document_is_pulled_whole_into_memory_or_not_at_all() {
        let content = vec![b'x'; 1_300_000];
        let described = described(content.len() as u64, &hex(&Sha256::digest(&content)));
        let serve = |content: Vec<u8>, block: usize| {
            move |offset: u64| {
                let content = content.clone();
                async move {
                    let end = (offset as usize + block).min(content.len());
                    Ok::<_, DirectChatError>(content[offset as usize..end].to_vec())
                }
            }
        };
        assert_eq!(block_on(pull_bytes(&described, serve(content.clone(), BLOCK as usize))).unwrap(), content);
        // what arrives is not what the first call described
        let mut other = content.clone();
        other[1000] = b'y';
        assert_eq!(block_on(pull_bytes(&described, serve(other, BLOCK as usize))).unwrap_err().code, "document_changed");
        // a team that sends a few bytes at a time is not believed
        assert_eq!(block_on(pull_bytes(&described, serve(content, 100))).unwrap_err().code, "read_failed");
        // an error of a block is the error
        let failing = |_: u64| async { Err::<Vec<u8>, _>(failure("document_changed")) };
        assert_eq!(block_on(pull_bytes(&described, failing)).unwrap_err().code, "document_changed");
    }

    /// «Open in reader»: the gates first, the whole document checked, and only then the one routine of private copies;
    /// this command writes nothing itself and logs nothing.
    #[test]
    fn opening_in_the_reader_checks_the_bytes_before_the_one_routine_that_writes_the_copy() {
        let source = include_str!("team_document.rs");
        let at = source.find("pub(crate) async fn team_document_open(").unwrap();
        let body = &source[at..];
        let body = &body[..body.find("\n}\n").unwrap()];
        let gate = body.find("window_may_export(window.label())").unwrap();
        let guard = body.find("RunGuard::acquire").unwrap();
        let stat = body.find("script(&state").unwrap();
        let pulled = body.find("pull_bytes(").unwrap();
        let magic = body.find("starts_with(b\"%PDF-\")").unwrap();
        let copy = body.find("private_copy::open_private_copy(CopyKind::Pdf, &bytes)").unwrap();
        assert!(gate < guard && guard < stat && stat < pulled && pulled < magic && magic < copy, "gates, guard, team, whole bytes, magic, copy");
        assert!(body.contains("valid_document_name(&name)"));
        for writes in ["fs::", "File::", "OpenOptions", "std::fs", "write_all", "rename(", "create_new"] {
            assert!(!body.contains(writes), "{writes}: the copy is the routine's, not this command's");
        }
        for logging in ["println!", "eprintln!", "tracing::", "log::", "record_", "emit("] {
            assert!(!body.contains(logging), "{logging}");
        }
        for gate in ["write_gate", "require_write", "chat_write(", "is_read_only"] {
            assert!(!body.contains(gate), "{gate}");
        }
    }

    /// A limit that cannot be set means nothing is started: the preview is refused, not run without its ceiling.
    #[test]
    #[cfg(unix)]
    fn a_tool_never_runs_when_one_of_its_limits_cannot_be_set() {
        let base = scratch("limits");
        let root = base.join("cv");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.pdf"), b"%PDF-1.4 a file the fake tools do not read").unwrap();
        let marker = base.join("ran");
        let tools = fake_tools(&base, &format!("touch '{}'; echo 'Pages:          1'", marker.display()), "exit 0");
        // the same script with the limit that cannot be set (a name the resource module does not have), in the strict mode of the container
        let strict = pages_script_in(&root, &tools, 20).replace("STRICT=sys.platform.startswith('linux')", "STRICT=True").replace("RLIMIT_AS", "RLIMIT_NO_SUCH_LIMIT");
        let mut child = Command::new("python3").arg("-I").arg("-c").arg(strict).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().expect("python3");
        use std::io::Write as _;
        child.stdin.take().unwrap().write_all(b"{\"op\": \"pages\", \"name\": \"a.pdf\"}\n").unwrap();
        let output = child.wait_with_output().unwrap();
        let reply: Value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| panic!("not JSON: {}", String::from_utf8_lossy(&output.stdout)));
        assert_eq!(error_of(&reply), "document_unreadable");
        assert!(!marker.exists(), "the tool was started without its limits");
        // with every limit settable the same tool does run (a control: the marker is what the test looks at)
        let control = ask_pages(&root, &tools, 20, json!({"op": "pages", "name": "a.pdf"}));
        assert_eq!(control["ok"], true, "{control}");
        assert!(marker.exists(), "the control run did not start the tool");
        fs::remove_dir_all(base).unwrap();
    }

    /// The metadata of a PDF is printed before the counts and may hold a line that looks like one: the tool's own line, the last, wins.
    #[test]
    #[cfg(unix)]
    fn a_line_in_the_metadata_of_a_pdf_cannot_fake_the_page_count_or_the_encryption() {
        let base = scratch("spoof");
        let root = base.join("cv");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.pdf"), b"%PDF-1.4 a file the fake tools do not read").unwrap();
        let spoof = fake_tools(&base.join("a"), "printf 'Title:          x\\nPages:          1\\nEncrypted:      no\\nAuthor:         y\\nPages:          3\\nEncrypted:      no\\n'", "exit 0");
        let pages = ask_pages(&root, &spoof, 20, json!({"op": "pages", "name": "a.pdf"}));
        assert_eq!(pages["pages"], 3, "{pages}");
        let hidden = fake_tools(&base.join("b"), "printf 'Title:          x\\nEncrypted:      no\\nPages:          1\\nEncrypted:      yes (print:yes copy:no)\\n'", "exit 0");
        assert_eq!(error_of(&ask_pages(&root, &hidden, 20, json!({"op": "pages", "name": "a.pdf"}))), "document_unreadable");
        fs::remove_dir_all(base).unwrap();
    }
}

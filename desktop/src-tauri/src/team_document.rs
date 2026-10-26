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
//! - NOT OPENED: the app does not open the PDF or preview it: it saves it. The content was written by an agent
//!   that read other people's text.
//! - Reading is a read of the team's data: it works in the read-only view too. It needs the chat connected.

use crate::{
    account_scope::AccountScopeState,
    direct_chat::{failure, team_script_read, DirectChatError, DirectChatState},
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
BLOCK=512*1024
NAME=re.compile(r'^[A-Za-z0-9._ -]{1,120}$')
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
def fail(code): emit({'ok':False,'error':code})
try: req=json.loads(sys.stdin.readline())
except Exception: fail('invalid_request')
if not isinstance(req,dict) or set(req)-{'op','name','offset'}: fail('invalid_request')
op=req.get('op'); name=req.get('name')
if op not in ('stat','read') or not isinstance(name,str): fail('invalid_request')
if not NAME.fullmatch(name) or not name.endswith('.pdf') or name[0] in '. -' or '..' in name: fail('invalid_request')
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
 if info.st_size>MAX_BYTES: fail('document_too_large')
 if info.st_size<5: fail('document_not_pdf')
 stamp=[info.st_ino,info.st_size,info.st_mtime_ns]
 with os.fdopen(fd,'rb',closefd=True) as f:
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
    let chars = name.chars().count();
    (1..=NAME_MAX_CHARS).contains(&chars)
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ' ' | '-'))
        && name.ends_with(".pdf")
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
}

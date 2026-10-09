//! The local runtime's own log: how each step that prepares the team on this
//! computer ended, and what it printed on stdout and stderr, so the person and
//! support can read why a setup stopped. Text is redacted before it is written
//! (onboarding::redact: tokens, keys, passwords, terminal sequences); the file
//! is private to the user and rotated (runtime.log, .1, .2).

use crate::runtime_host::{set_private_dir_permissions, set_private_permissions, ProcessResult};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

/// Past this size the log moves to runtime.log.1 before the next entry.
const LOG_MAX_BYTES: u64 = 256 * 1024;
/// Older files kept besides the current one.
const LOG_KEPT: u32 = 2;
/// What is kept of each stream of a step: its end, where the error is.
const STREAM_TAIL_BYTES: usize = 16 * 1024;

#[derive(Clone)]
pub(crate) struct RuntimeLog {
    path: PathBuf,
}

impl RuntimeLog {
    pub(crate) fn new(app: &tauri::AppHandle) -> Option<Self> {
        app.path().app_local_data_dir().ok().map(|root| Self::in_dir(&root.join("logs")))
    }

    pub(crate) fn in_dir(dir: &Path) -> Self {
        Self { path: dir.join("runtime.log") }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// One step: its name, how it ended, its output. A log that cannot be
    /// written never stops the step it describes.
    pub(crate) fn record(&self, step: &str, ended: Result<i32, &str>, stdout: &[u8], stderr: &[u8], elapsed: Duration) {
        let entry = entry(step, ended, stdout, stderr, elapsed, SystemTime::now());
        let _ = append(&self.path, &entry, LOG_MAX_BYTES);
    }

    pub(crate) fn record_result(&self, step: &str, result: &Result<ProcessResult, &'static str>, stderr: &[u8], elapsed: Duration) {
        match result {
            Ok(value) => self.record(step, Ok(value.code), &value.stdout, stderr, elapsed),
            Err(error) => self.record(step, Err(error), &[], stderr, elapsed),
        }
    }
}

fn entry(step: &str, ended: Result<i32, &str>, stdout: &[u8], stderr: &[u8], elapsed: Duration, at: SystemTime) -> String {
    let ended = match ended {
        Ok(code) => format!("exit {code}"),
        Err(error) => error.to_owned(),
    };
    format!(
        "=== {} {}: {} after {:.1} s\n--- stdout\n{}--- stderr\n{}\n",
        utc(at),
        crate::onboarding::redact(step.to_owned()),
        ended,
        elapsed.as_secs_f64(),
        stream(stdout),
        stream(stderr),
    )
}

/// The end of a stream, redacted, one line per line.
fn stream(bytes: &[u8]) -> String {
    let cut = bytes.len() > STREAM_TAIL_BYTES;
    let tail = &bytes[bytes.len().saturating_sub(STREAM_TAIL_BYTES)..];
    let text = crate::onboarding::redact(String::from_utf8_lossy(tail).replace("\r\n", "\n"));
    let text = text.trim_end_matches('\n');
    match (cut, text.is_empty()) {
        (_, true) => "(empty)\n".to_owned(),
        (true, false) => format!("[… earlier output cut]\n{text}\n"),
        (false, false) => format!("{text}\n"),
    }
}

fn append(path: &Path, entry: &str, max_bytes: u64) -> Result<(), &'static str> {
    let dir = path.parent().ok_or("runtime_log_invalid")?;
    fs::create_dir_all(dir).map_err(|_| "runtime_log_failed")?;
    if !fs::symlink_metadata(dir).is_ok_and(|metadata| metadata.file_type().is_dir()) {
        return Err("runtime_log_invalid");
    }
    set_private_dir_permissions(dir)?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.file_type().is_file() => return Err("runtime_log_invalid"),
        Ok(metadata) if metadata.len() + entry.len() as u64 > max_bytes => rotate(path)?,
        _ => {}
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|_| "runtime_log_failed")?;
    set_private_permissions(path)?;
    file.write_all(entry.as_bytes()).map_err(|_| "runtime_log_failed")
}

/// runtime.log → .1 → .2; the oldest goes.
fn rotate(path: &Path) -> Result<(), &'static str> {
    let numbered = |n: u32| PathBuf::from(format!("{}.{n}", path.display()));
    let _ = fs::remove_file(numbered(LOG_KEPT));
    for n in (1..LOG_KEPT).rev() {
        if numbered(n).is_file() {
            fs::rename(numbered(n), numbered(n + 1)).map_err(|_| "runtime_log_failed")?;
        }
    }
    fs::rename(path, numbered(1)).map_err(|_| "runtime_log_failed")
}

/// `2026-10-09T06:55:01Z`.
fn utc(at: SystemTime) -> String {
    let seconds = at.duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs()).unwrap_or(0);
    let (days, rest) = ((seconds / 86_400) as i64, seconds % 86_400);
    // Days to a civil date (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rest / 3_600,
        rest % 3_600 / 60,
        rest % 60
    )
}

/// Where the runtime log is, once a step wrote it.
#[tauri::command]
pub(crate) fn onboarding_runtime_log(app: tauri::AppHandle) -> Option<String> {
    let log = RuntimeLog::new(&app)?;
    log.path().is_file().then(|| log.path().display().to_string())
}

/// Shows the runtime log in the system's file manager, selected. `false` when
/// there is no log yet or the file manager did not start.
#[tauri::command]
pub(crate) fn onboarding_runtime_log_open(app: tauri::AppHandle) -> bool {
    let Some(log) = RuntimeLog::new(&app) else {
        return false;
    };
    if !log.path().is_file() {
        return false;
    }
    reveal(log.path()).is_ok()
}

#[cfg(windows)]
fn reveal(path: &Path) -> std::io::Result<()> {
    let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let mut select = std::ffi::OsString::from("/select,");
    select.push(path.as_os_str());
    std::process::Command::new(root.join("explorer.exe")).arg(select).spawn().map(|_| ())
}

#[cfg(target_os = "macos")]
fn reveal(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("/usr/bin/open").arg("-R").arg(path).spawn().map(|_| ())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn reveal(path: &Path) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(path);
    std::process::Command::new("xdg-open").arg(dir).spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::{append, entry, utc, RuntimeLog};
    use std::{
        fs,
        time::{Duration, UNIX_EPOCH},
    };

    fn dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("jht-runtime-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_step_keeps_how_it_ended_and_both_streams_without_secrets() {
        let root = dir("entry");
        let log = RuntimeLog::in_dir(&root.join("logs"));
        log.record(
            "install.ps1",
            Ok(1),
            b"JHT_PHASE wsl_check\r\n  x Podman setup failed\r\n",
            b"install.ps1 : Access denied\r\napi_key=sk-abc123 token\r\n",
            Duration::from_millis(2_940),
        );
        log.record("jht up", Err("process_timeout"), b"", b"", Duration::from_secs(900));
        let text = fs::read_to_string(log.path()).unwrap();
        assert!(text.contains(" install.ps1: exit 1 after 2.9 s\n--- stdout\nJHT_PHASE wsl_check\n  x Podman setup failed\n--- stderr\ninstall.ps1 : Access denied\n"), "{text}");
        assert!(!text.contains("sk-abc123"), "{text}");
        assert!(text.contains("api_key=[REDACTED]"), "{text}");
        assert!(text.contains(" jht up: process_timeout after 900.0 s\n--- stdout\n(empty)\n--- stderr\n(empty)\n"), "{text}");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(log.path()).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(root.join("logs")).unwrap().permissions().mode() & 0o777, 0o700);
        }
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_long_stream_keeps_its_end_and_says_it_was_cut() {
        let mut output = "early line\n".repeat(4_000).into_bytes();
        output.extend_from_slice(b"the error at the end\n");
        let text = entry("install.sh", Ok(1), &output, b"", Duration::ZERO, UNIX_EPOCH);
        assert!(text.contains("[… earlier output cut]\n"));
        assert!(text.contains("the error at the end\n--- stderr"));
        assert!(text.len() < 20 * 1024);
    }

    #[test]
    fn the_log_rotates_and_keeps_two_older_files() {
        let root = dir("rotate");
        let path = root.join("runtime.log");
        for n in 0..5 {
            append(&path, &format!("entry {n}\n{}\n", "x".repeat(60)), 100).unwrap();
        }
        assert_eq!(fs::read_to_string(&path).unwrap().lines().next(), Some("entry 4"));
        assert_eq!(fs::read_to_string(root.join("runtime.log.1")).unwrap().lines().next(), Some("entry 3"));
        assert_eq!(fs::read_to_string(root.join("runtime.log.2")).unwrap().lines().next(), Some("entry 2"));
        assert!(!root.join("runtime.log.3").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn a_log_path_that_is_a_link_is_not_followed() {
        let root = dir("link");
        fs::create_dir_all(&root).unwrap();
        let target = root.join("elsewhere");
        fs::write(&target, b"keep").unwrap();
        std::os::unix::fs::symlink(&target, root.join("runtime.log")).unwrap();
        assert_eq!(append(&root.join("runtime.log"), "entry\n", 1024), Err("runtime_log_invalid"));
        assert_eq!(fs::read(&target).unwrap(), b"keep");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn times_are_utc() {
        assert_eq!(utc(UNIX_EPOCH), "1970-01-01T00:00:00Z");
        assert_eq!(utc(UNIX_EPOCH + Duration::from_secs(1_791_528_901)), "2026-10-09T06:55:01Z");
        assert_eq!(utc(UNIX_EPOCH + Duration::from_secs(951_782_400)), "2000-02-29T00:00:00Z");
    }
}

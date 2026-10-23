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
    /// The cause read from the last step, when it failed (failure_cause).
    cause: std::sync::Arc<std::sync::Mutex<Option<String>>>,
}

#[derive(Clone, Copy)]
pub(crate) enum ExistingTeamPhase {
    Scope,
    ValidateHost,
    Candidate,
    Ssh,
    Activation,
    Final,
    /// The read-only opening of the saved team at start-up (no permission to write).
    ReadOnlyOpen,
}

impl RuntimeLog {
    pub(crate) fn new(app: &tauri::AppHandle) -> Option<Self> {
        app.path().app_local_data_dir().ok().map(|root| Self::in_dir(&root.join("logs")))
    }

    pub(crate) fn in_dir(dir: &Path) -> Self {
        Self {
            path: dir.join("runtime.log"),
            cause: Default::default(),
        }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// Status only: no command, stream, connection, or account value is accepted.
    pub(crate) fn record_existing_team_status(&self, phase: ExistingTeamPhase, result: Result<i32, &str>) {
        let phase = match phase {
            ExistingTeamPhase::Scope => "scope",
            ExistingTeamPhase::ValidateHost => "validate_host",
            ExistingTeamPhase::Candidate => "candidate",
            ExistingTeamPhase::Ssh => "ssh",
            ExistingTeamPhase::Activation => "activation",
            ExistingTeamPhase::Final => "final",
            ExistingTeamPhase::ReadOnlyOpen => "read_only_open",
        };
        let ended = match result {
            Ok(code) => format!("exit {code}"),
            Err(code) => match code {
                "account_scope_unavailable" | "account_scope_changed" | "account_team_mismatch"
                | "operation_in_progress" | "existing_team_vps_required" | "invalid_team_id"
                | "existing_team_runtime_candidate_required" | "existing_team_runtime_candidate_invalid"
                | "existing_team_runtime_candidate_mismatch" | "existing_team_runtime_target_changed"
                | "existing_team_runtime_unavailable" | "existing_team_runtime_already_selected"
                | "existing_team_runtime_selection_required" | "existing_team_runtime_selection_invalid"
                | "existing_team_unavailable" | "existing_team_identity_mismatch" | "existing_team_not_active"
                | "invalid_host" | "invalid_user" | "invalid_port" | "invalid_key_path"
                | "invalid_key" | "key_unavailable" | "not_vps" | "permissions_failed"
                | "host_key_unavailable" | "host_key_missing" | "host_key_changed" | "host_key_mismatch"
                | "host_key_confirmation_invalid" | "host_key_unwritable"
                | "ssh_unavailable" | "ssh_client_missing" | "ssh_rate_limited" | "ssh_auth_failed" | "process_start_failed" | "process_timeout"
                | "process_write_failed" | "process_wait_failed" | "process_output_unavailable"
                | "process_input_failed" | "process_pipe_failed"
                | "window_not_allowed" | "existing_team_reconfirm_setup"
                // The opening of the saved team and the discovery: why it did not open, by name.
                | "existing_team_saved_incomplete" | "existing_team_saved_selection_mismatch"
                | "existing_team_runtime_required" | "existing_team_runtime_changed" | "existing_team_runtime_outdated"
                | "existing_team_runtime_candidate_exists" | "existing_team_runtime_candidate_conflict"
                | "existing_team_target_changed" | "existing_team_image_unattested" | "existing_team_too_many_containers"
                | "existing_team_ambiguous" | "existing_team_not_found" | "existing_team_container_not_found"
                | "existing_team_choice_gone" | "invalid_container_choice"
                | "existing_team_discovery_timeout" | "existing_team_receipt_required"
                | "existing_team_register_not_confirmed" => code,
                _ => "io_error_other",
            }.to_owned(),
        };
        let entry = format!("=== {} existing_team.{phase}: {ended}\n", utc(SystemTime::now()));
        let _ = append(&self.path, &entry, LOG_MAX_BYTES);
    }

    /// A message the chat refused to send, by its closed code only: no agent, text, host or account.
    pub(crate) fn record_chat_refusal(&self, code: &str) {
        let code = match code {
            "read_only_link" | "own_vps_claim_required" | "own_vps_key_changed" | "own_vps_claim_refused" => code,
            _ => "io_error_other",
        };
        let entry = format!("=== {} direct_chat.send: {code}\n", utc(SystemTime::now()));
        let _ = append(&self.path, &entry, LOG_MAX_BYTES);
    }

    /// A read or a send of the chat that failed, by its closed code only: no agent, text, host or
    /// account. The page clears its own error at the next «connected»: this is what stays.
    pub(crate) fn record_chat_failure(&self, operation: &str, code: &str) {
        let operation = if operation == "send" { "send" } else { "read" };
        let entry = format!("=== {} direct_chat.{operation}: {}\n", utc(SystemTime::now()), chat_failure_code(code));
        let _ = append(&self.path, &entry, LOG_MAX_BYTES);
    }

    /// One step: its name, how it ended, its output. A log that cannot be
    /// written never stops the step it describes.
    pub(crate) fn record(&self, step: &str, ended: Result<i32, &str>, stdout: &[u8], stderr: &[u8], elapsed: Duration) {
        let cause = (ended != Ok(0)).then(|| failure_cause(stdout, stderr)).flatten();
        if let Ok(mut last) = self.cause.lock() {
            *last = cause;
        }
        let entry = entry(step, ended, stdout, stderr, elapsed, SystemTime::now());
        let _ = append(&self.path, &entry, LOG_MAX_BYTES);
    }

    /// The cause of the last step, if it failed and said why; read once.
    pub(crate) fn take_cause(&self) -> Option<String> {
        self.cause.lock().ok().and_then(|mut last| last.take())
    }

    pub(crate) fn record_result(&self, step: &str, result: &Result<ProcessResult, &'static str>, stderr: &[u8], elapsed: Duration) {
        match result {
            Ok(value) => self.record(step, Ok(value.code), &value.stdout, stderr, elapsed),
            Err(error) => self.record(step, Err(error), &[], stderr, elapsed),
        }
    }
}

/// Longest cause shown on the error screen; the log has the rest.
const CAUSE_MAX_CHARS: usize = 240;

/// Why a step failed, in one line: the last useful line of its stderr, or
/// else the last failure line of its stdout (install.ps1's Write-Fail prints
/// «  x <message>» there). PowerShell's error decoration («At line:…»,
/// «+ CategoryInfo…»), the script's own path and the phase lines are not a
/// cause. Redacted like the log.
pub(crate) fn failure_cause(stdout: &[u8], stderr: &[u8]) -> Option<String> {
    let text = |bytes: &[u8]| crate::onboarding::redact(String::from_utf8_lossy(bytes).replace("\r\n", "\n"));
    stderr_cause(&text(stderr))
        .or_else(|| {
            text(stdout).lines().rev().find_map(|line| {
                let line = line.trim_start();
                ["x ", "✗ ", "ERROR: ", "Error: "]
                    .iter()
                    .find_map(|marker| line.strip_prefix(marker))
                    .and_then(cause_line)
            })
        })
}

/// The message of the last error in a stderr. PowerShell prints an error as its message, then the
/// «where» line, the «+ …» excerpt, «CategoryInfo» and «FullyQualifiedErrorId»; from the first of
/// those to the next empty line it is all decoration, whatever way the console wrapped it. So the
/// stderr is read forward, and the cause is the last message line that came before a decoration.
fn stderr_cause(text: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().map(str::trim).collect();
    let mut causes: Vec<(usize, String)> = Vec::new();
    let mut decoration = false;
    for (index, line) in lines.iter().enumerate() {
        if line.is_empty() {
            decoration = false;
            continue;
        }
        if decoration {
            continue;
        }
        if is_decoration(line) {
            decoration = true;
            // A «where» line the console wrapped: its second half carries the numbers, the first
            // half («In C:\…\Job Hunter ») is not a message and neither is what lies between.
            if is_position_line(line) && !starts_position(line) {
                if let Some(start) = (index.saturating_sub(3)..index).rev().find(|&before| starts_position(lines[before])) {
                    causes.retain(|(at, _)| *at < start);
                }
            }
            continue;
        }
        if let Some(cause) = cause_line(line) {
            causes.push((index, cause));
        }
    }
    causes.pop().map(|(_, cause)| cause)
}

/// What PowerShell adds around an error's message.
fn is_decoration(line: &str) -> bool {
    line.starts_with('+')
        || line.starts_with('~')
        || line.starts_with("At line:")
        || (line.starts_with("At ") && line.contains(" char:"))
        || is_position_line(line)
        || line.starts_with("CategoryInfo")
        || line.starts_with("FullyQualifiedErrorId")
}

/// The end of PowerShell's «where» line, which comes in the language of the system: «At
/// C:\x.ps1:473 char:60», «In C:\x.ps1:473 car:60», «In Zeile:473 Zeichen:60», «At line:1 char:1».
/// Always two numbers, the last one behind a word and a colon.
fn is_position_line(line: &str) -> bool {
    let numbered = |token: &str, labelled: bool| match token.rsplit_once(':') {
        Some((head, digits)) => {
            !digits.is_empty()
                && digits.chars().all(|character| character.is_ascii_digit())
                && (!labelled || (!head.is_empty() && head.chars().all(char::is_alphabetic)))
        }
        None => false,
    };
    let mut tokens = line.split_whitespace().rev();
    matches!((tokens.next(), tokens.next()), (Some(last), Some(before)) if numbered(last, true) && numbered(before, false))
}

/// The start of PowerShell's «where» line: up to two words («At», «In», «Au caractère»), then a
/// path («C:\…», «\\server\…», «/…») or «Zeile:473». A line wrapped in the middle of the path has
/// its numbers on the second line and this on the first.
fn starts_position(line: &str) -> bool {
    let words = |token: &str| !token.is_empty() && token.chars().all(char::is_alphabetic);
    let mut tokens = line.split_whitespace();
    let Some(mut token) = tokens.next() else {
        return false;
    };
    for _ in 0..2 {
        if !words(token) {
            break;
        }
        match tokens.next() {
            Some(next) => token = next,
            None => return false,
        }
    }
    let mut start = token.chars();
    let drive = matches!((start.next(), start.next(), start.next()), (Some(letter), Some(':'), Some('\\')) if letter.is_ascii_alphabetic());
    let labelled = match token.rsplit_once(':') {
        Some((word, digits)) => words(word) && !digits.is_empty() && digits.chars().all(|character| character.is_ascii_digit()),
        None => false,
    };
    drive || token.starts_with("\\\\") || token.starts_with('/') || labelled
}

fn cause_line(line: &str) -> Option<String> {
    let line = line.trim();
    if line.is_empty() || is_decoration(line) || line.starts_with("JHT_PHASE ") || line.starts_with("JHT_LEFT ") {
        return None;
    }
    // «C:\…\install.ps1 : message» and «Set-Acl : message» → «message».
    let line = match line.split_once(" : ") {
        Some((source, message)) if source.ends_with(".ps1") || !source.contains(char::is_whitespace) => message,
        _ => line,
    };
    let line = line.trim_start_matches(|character: char| matches!(character, '✗' | '!' | '*') || character.is_whitespace());
    let line = line.split_whitespace().collect::<Vec<_>>().join(" ");
    if !line.chars().any(char::is_alphanumeric) {
        return None;
    }
    Some(if line.chars().count() > CAUSE_MAX_CHARS {
        format!("{}…", line.chars().take(CAUSE_MAX_CHARS).collect::<String>())
    } else {
        line
    })
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
/// The codes a failed chat read or send may leave in the log; any other is `io_error_other`.
fn chat_failure_code(code: &str) -> &str {
    match code {
        "read_failed" | "send_failed" | "persist_failed" | "disconnected" | "state_failed"
        | "account_scope_mismatch" | "invalid_request" | "read_only_link" | "own_vps_claim_required"
        | "own_vps_key_changed" | "own_vps_claim_refused" | "chat_runtime_outdated"
        | "existing_team_runtime_target_changed" | "agent_not_at_prompt" | "team_not_running"
        | "agent_not_running" | "agent_unavailable" | "agent_busy" | "agent_stuck" | "tunnel_unavailable"
        | "tunnel_start_failed" | "tunnel_verify_failed" | "ssh_unavailable" | "ssh_auth_failed"
        | "ssh_rate_limited" | "process_timeout" | "host_key_changed" | "host_key_mismatch" => code,
        _ => "io_error_other",
    }
}

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
pub(crate) fn reveal(path: &Path) -> std::io::Result<()> {
    let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let mut select = std::ffi::OsString::from("/select,");
    select.push(path.as_os_str());
    std::process::Command::new(root.join("explorer.exe")).arg(select).spawn().map(|_| ())
}

#[cfg(target_os = "macos")]
pub(crate) fn reveal(path: &Path) -> std::io::Result<()> {
    std::process::Command::new("/usr/bin/open").arg("-R").arg(path).spawn().map(|_| ())
}

#[cfg(not(any(windows, target_os = "macos")))]
pub(crate) fn reveal(path: &Path) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(path);
    std::process::Command::new("xdg-open").arg(dir).spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::{append, entry, failure_cause, utc, RuntimeLog};
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
    fn existing_team_status_is_private_allowlisted_and_best_effort() {
        let root = dir("existing-team-status");
        let log = RuntimeLog::in_dir(&root.join("logs"));
        log.record_existing_team_status(super::ExistingTeamPhase::Ssh, Ok(73));
        log.record_existing_team_status(super::ExistingTeamPhase::Final, Err("existing_team_not_active"));
        log.record_existing_team_status(super::ExistingTeamPhase::Candidate, Err("synthetic-private-account-key-token"));
        // What run_ssh_command returns when the probe's stdin or pipes fail: named, not io_error_other.
        log.record_existing_team_status(super::ExistingTeamPhase::Ssh, Err("process_input_failed"));
        log.record_existing_team_status(super::ExistingTeamPhase::Ssh, Err("process_pipe_failed"));
        let text = fs::read_to_string(log.path()).unwrap();
        assert_eq!(text.lines().count(), 5);
        assert!(text.contains(" existing_team.ssh: process_input_failed\n"));
        assert!(text.contains(" existing_team.ssh: process_pipe_failed\n"));
        assert_eq!(text.matches("io_error_other").count(), 1);
        assert!(text.contains(" existing_team.ssh: exit 73\n"));
        assert!(text.contains(" existing_team.final: existing_team_not_active\n"));
        assert!(text.contains(" existing_team.candidate: io_error_other\n"));
        assert!(!text.contains("synthetic-private") && !text.contains("stdout") && !text.contains("stderr"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(log.path()).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(root.join("logs")).unwrap().permissions().mode() & 0o777, 0o700);
        }
        fs::write(root.join("not-a-directory"), b"preserve").unwrap();
        let blocked = RuntimeLog::in_dir(&root.join("not-a-directory"));
        blocked.record_existing_team_status(super::ExistingTeamPhase::Final, Ok(0));
        assert_eq!(fs::read(root.join("not-a-directory")).unwrap(), b"preserve");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn the_read_only_opening_and_the_chats_refusal_are_written_by_code_only() {
        let root = dir("read-only");
        let log = RuntimeLog::in_dir(&root.join("logs"));
        log.record_existing_team_status(super::ExistingTeamPhase::ReadOnlyOpen, Ok(0));
        log.record_existing_team_status(super::ExistingTeamPhase::Candidate, Err("existing_team_reconfirm_setup"));
        log.record_existing_team_status(super::ExistingTeamPhase::Scope, Err("window_not_allowed"));
        log.record_chat_refusal("read_only_link");
        log.record_chat_refusal("own_vps_key_changed");
        log.record_chat_refusal("capitano says hello from 203.0.113.7");
        log.record_chat_failure("read", "read_failed");
        log.record_chat_failure("send", "agent_not_at_prompt");
        log.record_chat_failure("read", "mentor at 203.0.113.7 said no");
        log.record_chat_failure("delete everything", "send_failed");
        // why the saved team did not open at start-up: its own code, never io_error_other
        for code in [
            "existing_team_saved_incomplete", "existing_team_saved_selection_mismatch", "existing_team_runtime_required",
            "existing_team_target_changed", "existing_team_image_unattested", "existing_team_too_many_containers",
            "existing_team_ambiguous", "existing_team_not_found", "existing_team_runtime_changed",
        ] {
            log.record_existing_team_status(super::ExistingTeamPhase::ReadOnlyOpen, Err(code));
        }
        let text = fs::read_to_string(log.path()).unwrap();
        for code in ["existing_team_saved_incomplete", "existing_team_saved_selection_mismatch", "existing_team_not_found"] {
            assert!(text.contains(&format!(" existing_team.read_only_open: {code}\n")), "{code}");
        }
        assert!(!text.contains(" existing_team.read_only_open: io_error_other\n"));
        assert!(text.contains(" existing_team.read_only_open: exit 0\n"));
        // a failed read or send of the chat: its closed code, never what the host or the agent said
        assert!(text.contains(" direct_chat.read: read_failed\n"));
        assert!(text.contains(" direct_chat.send: agent_not_at_prompt\n"));
        assert!(text.contains(" direct_chat.read: io_error_other\n"));
        assert!(text.contains(" direct_chat.read: send_failed\n"), "an unknown operation is a read");
        assert!(!text.contains("mentor") && !text.contains("delete"));
        assert!(text.contains(" existing_team.candidate: existing_team_reconfirm_setup\n"));
        assert!(text.contains(" existing_team.scope: window_not_allowed\n"));
        assert!(text.contains(" direct_chat.send: read_only_link\n"));
        assert!(text.contains(" direct_chat.send: own_vps_key_changed\n"));
        assert!(text.contains(" direct_chat.send: io_error_other\n"));
        assert!(!text.contains("203.0.113.7") && !text.contains("capitano"));
        let _ = fs::remove_dir_all(root);
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
    fn the_cause_is_the_last_useful_line_of_stderr_without_powershell_decoration() {
        let powershell = b"C:\\Users\\prova\\AppData\\Local\\Temp\\jht-install-1\\install.ps1 : Access to the path 'C:\\Users\\prova\\.jht\\.codex' is denied.\r\nAt line:1 char:1\r\n+ & 'C:\\Users\\prova\\install.ps1'\r\n+ ~~~~~~~~~~~~~~\r\n    + CategoryInfo          : NotSpecified: (:) [Write-Error], WriteErrorException\r\n    + FullyQualifiedErrorId : Microsoft.PowerShell.Commands.WriteErrorException,install.ps1\r\n";
        assert_eq!(
            failure_cause(b"JHT_PHASE wsl_check\n", powershell).as_deref(),
            Some("Access to the path 'C:\\Users\\prova\\.jht\\.codex' is denied.")
        );
        // install.ps1's Write-Fail prints on stdout.
        assert_eq!(
            failure_cause(b"JHT_PHASE podman_install\n  x winget could not install Podman.CLI (0x8a15000f)\n", b"").as_deref(),
            Some("winget could not install Podman.CLI (0x8a15000f)")
        );
        assert_eq!(failure_cause(b"  \xe2\x9c\x97 Podman machine non avviabile\n", b"\n").as_deref(), Some("Podman machine non avviabile"));
        // A secret never reaches the screen; nothing useful is no cause.
        assert_eq!(failure_cause(b"", b"login failed: api_key=sk-abc123\n").as_deref(), Some("login failed: api_key=[REDACTED]"));
        assert_eq!(failure_cause(b"JHT_PHASE image_pull\nall good\n", b"+ ~~~\n\n"), None);
        let long = format!("{}\n", "y".repeat(400));
        assert_eq!(failure_cause(b"", long.as_bytes()).unwrap().chars().count(), 241);
    }

    /// The stderr of a failed step as PowerShell 5.1 prints it, one line each.
    fn stderr(lines: &[&str]) -> Vec<u8> {
        lines.iter().map(|line| format!("{line}\r\n")).collect::<String>().into_bytes()
    }

    #[test]
    fn the_cause_is_the_exception_text_whatever_language_powershell_prints_its_position_in() {
        // The real stderr of a non-elevated install.ps1 on an Italian Windows (profile replaced).
        let italian = stderr(&[
            "Set-Acl : Il processo non dispone del privilegio 'SeSecurityPrivilege' richiesto per questa operazione.",
            "In C:\\Users\\<profilo>\\AppData\\Local\\Temp\\jht-install-1\\install.ps1:97 car:5",
            "+     Set-Acl -LiteralPath $node.FullName -AclObject $acl",
            "+     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
            "    + CategoryInfo          : PermissionDenied: (C:\\Users\\<profilo>\\.jht:String) [Set-Acl], PrivilegeNotHeldException",
            "    + FullyQualifiedErrorId : System.Security.AccessControl.PrivilegeNotHeldException,Microsoft.PowerShell.Commands.SetAclCommand",
        ]);
        assert_eq!(
            failure_cause(b"", &italian).as_deref(),
            Some("Il processo non dispone del privilegio 'SeSecurityPrivilege' richiesto per questa operazione.")
        );
        // The same error on an English Windows.
        let english = stderr(&[
            "Set-Acl : The process does not possess the 'SeSecurityPrivilege' privilege which is required for this operation.",
            "At C:\\Users\\<profile>\\AppData\\Local\\Temp\\jht-install-1\\install.ps1:97 char:5",
            "+     Set-Acl -LiteralPath $node.FullName -AclObject $acl",
            "+     ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
            "    + CategoryInfo          : PermissionDenied: (C:\\Users\\<profile>\\.jht:String) [Set-Acl], PrivilegeNotHeldException",
            "    + FullyQualifiedErrorId : System.Security.AccessControl.PrivilegeNotHeldException,Microsoft.PowerShell.Commands.SetAclCommand",
        ]);
        assert_eq!(
            failure_cause(b"", &english).as_deref(),
            Some("The process does not possess the 'SeSecurityPrivilege' privilege which is required for this operation.")
        );
        // A `throw` in the enabler: the message has no command before it, and the position line
        // («…ps1:473 car:60») was what the screen used to show.
        let message = "podman_other_user: winget reports Podman CLI as installed on this computer, but this Windows user reaches no podman.exe";
        for (position, category) in [
            ("In C:\\Users\\<profilo>\\Temp\\enable-podman-windows-runtime.ps1:473 car:60", "OperationStopped: (:) [], RuntimeException"),
            ("At C:\\Users\\<profile>\\Temp\\enable-podman-windows-runtime.ps1:473 char:60", "OperationStopped: (:) [], RuntimeException"),
            ("In Zeile:473 Zeichen:60", "OperationStopped: (:) [], RuntimeException"),
        ] {
            let thrown = stderr(&[
                message,
                position,
                "+     throw \"$code: $detail\"",
                "+     ~~~~~~~~~~~~~~~~~~~~~~~",
                &format!("    + CategoryInfo          : {category}"),
                &format!("    + FullyQualifiedErrorId : {message}"),
            ]);
            assert_eq!(failure_cause(b"", &thrown).as_deref(), Some(message), "{position}");
        }
    }

    #[test]
    fn the_cause_survives_a_where_line_the_console_wrapped_in_the_middle_of_the_path() {
        // The real stderr of the setup's image check on an Italian Windows 10 (PowerShell 5.1, stderr
        // redirected): the path of the script wraps after a space, so its numbers are on the second line.
        let message = "Error: template: inspect:1: function \"com\" not defined";
        let italian = stderr(&[
            "Copying config sha256:9336f89d7ba855343b13e1415fc6f8b5fe2fa19a70bf9f18d0f85177bb6f66f2",
            "Writing manifest to image destination",
            "podman.exe : Error: template: inspect:1: function \"com\" not defined",
            "In C:\\Users\\<utente>\\AppData\\Local\\Job Hunter ",
            "Team\\host-runtime\\.install-stage-<id>\\scripts\\enable-podman-windows-runtime.ps1:634 car:29",
            "+ ... gProject = (& $Podman --connection $MachineName inspect jht --format  ...",
            "+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
            "    + CategoryInfo          : NotSpecified: (Error: template...om\" not defined:String) [], RemoteException",
            "    + FullyQualifiedErrorId : NativeCommandError",
            " ",
            "",
        ]);
        assert_eq!(failure_cause(b"JHT_PHASE image_pull\n", &italian).as_deref(), Some(message));
        // The same on an English Windows, and with the path on three lines.
        for where_line in [
            vec![
                "At C:\\Users\\<utente>\\AppData\\Local\\Job Hunter ",
                "Team\\host-runtime\\.install-stage-<id>\\scripts\\enable-podman-windows-runtime.ps1:634 char:29",
            ],
            vec![
                "At C:\\Users\\<utente>\\AppData\\Local\\Job ",
                "Hunter Team\\host-runtime\\.install-stage-<id>\\scripts\\",
                "enable-podman-windows-runtime.ps1:634 char:29",
            ],
        ] {
            let mut lines = vec!["Writing manifest to image destination", "podman.exe : Error: template: inspect:1: function \"com\" not defined"];
            lines.extend(where_line.iter().copied());
            lines.extend([
                "+ ... gProject = (& $Podman --connection $MachineName inspect jht --format  ...",
                "+                 ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~",
                "    + CategoryInfo          : NotSpecified: (Error: template...om\" not defined:String) [], RemoteException",
                "    + FullyQualifiedErrorId : NativeCommandError",
                " ",
            ]);
            assert_eq!(failure_cause(b"", &stderr(&lines)).as_deref(), Some(message), "{where_line:?}");
        }
        // A wrapped excerpt or category line is decoration too: nothing after the first «+» is a cause.
        let wrapped_excerpt = stderr(&[
            "boom",
            "In C:\\x.ps1:1 car:1",
            "+ & $Podman --connection $MachineName inspect jht --format '{{ com }}' --a-very-long-argument",
            "that the console wrapped",
            "    + CategoryInfo          : NotSpecified: (:) [], RemoteException",
        ]);
        assert_eq!(failure_cause(b"", &wrapped_excerpt).as_deref(), Some("boom"));
        // Two errors separated by an empty line: the last one is the cause.
        let two = stderr(&["first : one", "In C:\\x.ps1:1 car:1", "+ ~~~", "", "second : two", "In C:\\x.ps1:2 car:1", "+ ~~~"]);
        assert_eq!(failure_cause(b"", &two).as_deref(), Some("two"));
    }

    #[test]
    fn the_cause_is_plain_text_and_a_message_ending_in_numbers_is_still_a_message() {
        // PowerShell 7 colours its errors; the redaction already drops the sequences.
        let coloured = b"\x1b[31;1mSet-Acl: access denied\x1b[0m\x07\r\n\x1b[31;1mAt /tmp/x.ps1:1 char:1\x1b[0m\r\n\x1b[31;1m+ ~~~\x1b[0m\r\n";
        assert_eq!(failure_cause(b"", coloured).as_deref(), Some("Set-Acl: access denied"));
        assert_eq!(failure_cause(b"", b"cannot reach 10 hosts, ports 80:81\n").as_deref(), Some("cannot reach 10 hosts, ports 80:81"));
    }

    #[test]
    fn the_log_keeps_the_cause_of_a_failed_step_only_until_it_is_read() {
        let root = dir("cause");
        let log = RuntimeLog::in_dir(&root.join("logs"));
        log.record("install.ps1", Ok(1), b"", b"install.ps1 : boom\n", Duration::ZERO);
        assert_eq!(log.take_cause().as_deref(), Some("boom"));
        assert_eq!(log.take_cause(), None);
        log.record("install.ps1", Ok(1), b"", b"install.ps1 : boom\n", Duration::ZERO);
        log.record("jht status", Ok(0), b"", b"warning\n", Duration::ZERO);
        assert_eq!(log.take_cause(), None, "a later step that worked clears it");
        log.record("jht up", Err("process_timeout"), b"", b"still pulling the image\n", Duration::ZERO);
        assert_eq!(log.take_cause().as_deref(), Some("still pulling the image"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn times_are_utc() {
        assert_eq!(utc(UNIX_EPOCH), "1970-01-01T00:00:00Z");
        assert_eq!(utc(UNIX_EPOCH + Duration::from_secs(1_791_528_901)), "2026-10-09T06:55:01Z");
        assert_eq!(utc(UNIX_EPOCH + Duration::from_secs(951_782_400)), "2000-02-29T00:00:00Z");
    }
}

//! The action log of a profile with no cloud account: one line for each thing the app did to the team on this
//! computer for the person (start, stop, restart, a setting changed, a position excluded or put back), in the
//! vocabulary of the site's own `web_action_log` and read by the same list, so the Agents panel shows the same words.
//!
//! What a line holds, and nothing else: the action's code (from a closed table), its level, a target (`all` or an
//! agent's name of the closed grammar), the number of a position, the names of the settings changed, a fixed machine
//! phrase, the state (`done`: only an act that worked is written) and the time. Never a free text of the person (a
//! note, a reason, a directive), a key, a path, an address or an answer of the team.
//!
//! Where: one file for each account scope, named by a hash of it (the account is not in the name), in the app's own
//! data folder, private to the user (0600 / owner-only ACL, the folder 0700). A write is best effort and never fails
//! the act it records. The file is capped (the newest `MAX_ROWS` lines are kept; past `REWRITE_AT` it is rewritten
//! through a temporary file and a rename) and every line is capped in size. Reading closes every line again, so a file
//! changed from outside shows nothing the table does not know.
use crate::{
    account_scope::{AccountScope, AccountScopeState},
    direct_chat,
    local_swipe::{failure, scope_tag},
    runtime_host::{set_private_dir_permissions, set_private_permissions},
};
use serde_json::{json, Map, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};

/// Lines kept, lines at which the file is rewritten down to them, lines a read brings, bytes of one line.
const MAX_ROWS: usize = 500;
const REWRITE_AT: usize = 600;
const READ_ROWS: usize = 100;
const LINE_MAX: usize = 1024;
/// A file past this size (only a change from outside makes one) is not read as the log: it is replaced.
const FILE_MAX: u64 = 2 * 1024 * 1024;
const FOLDER: &str = "action-log";

static WRITING: Mutex<()> = Mutex::new(());
static SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// The actions this log names: code, level, and the fixed machine phrase (the page never shows it for these).
const ACTIONS: &[(&str, &str, &str)] = &[
    ("team.start", "L2", "start"),
    ("team.stop", "L2", "stop"),
    ("team.restart", "L2", "restart"),
    ("settings.update", "L2", "settings"),
    ("exclusion.decide", "L1", "exclusion decided"),
    ("exclusion.withdraw", "L1", "exclusion withdrawn"),
];

/// The settings the site may change (`WEB_ACTION_SETTINGS`), in the order they are named.
const SETTINGS: &[&str] = &["working_hours", "role_models"];

fn level_of(action: &str) -> Option<&'static str> {
    ACTIONS.iter().find(|(code, _, _)| *code == action).map(|(_, level, _)| *level)
}

fn summary_of(action: &str) -> Option<&'static str> {
    ACTIONS.iter().find(|(code, _, _)| *code == action).map(|(_, _, summary)| *summary)
}

/// What an act is about, as the log writes it.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Subject {
    /// `all`, or one agent by its session name.
    Target(String),
    /// A position of the team's database, by its number.
    Position(u64),
    /// The settings changed, from `SETTINGS`.
    Settings(Vec<&'static str>),
    Nothing,
}

/// A target is `all` or the closed grammar of a session name: letters, digits, `-` and `_`, up to 32.
fn target_ok(target: &str) -> bool {
    (1..=32).contains(&target.len()) && target.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// One line of the log, closed: None when the action is not in the table or the subject does not fit it.
fn line(action: &str, subject: &Subject, id: &str, at: &str) -> Option<String> {
    let level = level_of(action)?;
    let summary = summary_of(action)?;
    let mut params = Map::new();
    match (action, subject) {
        (code, Subject::Target(target)) if code.starts_with("team.") && target_ok(target) => {
            params.insert("target".into(), json!(target));
        }
        (code, Subject::Position(number)) if code.starts_with("exclusion.") && (1..=1_000_000_000_000).contains(number) => {
            params.insert("legacy_id".into(), json!(number));
        }
        (code, Subject::Settings(keys)) if code.starts_with("settings.") && !keys.is_empty() && keys.iter().all(|key| SETTINGS.contains(key)) => {
            for key in keys {
                params.insert((*key).into(), Value::Bool(true));
            }
        }
        (code, Subject::Nothing) if code.starts_with("exclusion.") => {}
        _ => return None,
    }
    let row = json!({
        "id": id, "action": action, "level": level, "params": Value::Object(params),
        "summary": summary, "status": "done", "created_at": at,
    });
    let text = serde_json::to_string(&row).ok()?;
    (text.len() <= LINE_MAX).then_some(text)
}

fn file_of(app: &tauri::AppHandle, scope: &AccountScope) -> Option<PathBuf> {
    let root = app.path().app_local_data_dir().ok()?;
    Some(root.join(FOLDER).join(format!("{}.jsonl", scope_tag(scope))))
}

/// A file opened without following a link (on unix the open itself refuses one: no gap between a check and the open).
fn no_follow(options: &mut fs::OpenOptions) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    // Windows: the open takes the link or junction itself and not what it points to, so the check on the open file
    // (`is_file`) refuses it; the path is checked too, for the gap that remains there
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    #[cfg(not(any(unix, windows)))]
    let _ = options;
}

enum Content {
    Lines(Vec<String>),
    /// More than `FILE_MAX` bytes: not the log the app wrote.
    TooBig,
    /// A link, a folder, a device or a file that cannot be opened: neither read nor written through.
    Refused,
}

/// What the file holds, read through the one handle that was checked (`fstat` of the open file, not of the path).
fn content_of(path: &Path) -> Content {
    #[cfg(windows)]
    if fs::symlink_metadata(path).is_ok_and(|metadata| !metadata.file_type().is_file()) {
        return Content::Refused;
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    no_follow(&mut options);
    let file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Content::Lines(Vec::new()),
        Err(_) => return Content::Refused,
    };
    let Ok(metadata) = file.metadata() else { return Content::Refused };
    if !metadata.is_file() {
        return Content::Refused;
    }
    if metadata.len() > FILE_MAX {
        return Content::TooBig;
    }
    use std::io::Read;
    let mut text = String::new();
    match file.take(FILE_MAX).read_to_string(&mut text) {
        Ok(_) => Content::Lines(text.lines().map(str::to_owned).collect()),
        Err(_) => Content::Refused,
    }
}

fn lines_of(path: &Path) -> Vec<String> {
    match content_of(path) {
        Content::Lines(lines) => lines,
        _ => Vec::new(),
    }
}

/// Appends one closed line to the file, and keeps it down to the cap. Errors are the caller's to ignore.
fn append(path: &Path, text: &str) -> Result<(), &'static str> {
    let dir = path.parent().ok_or("action_log_invalid")?;
    fs::create_dir_all(dir).map_err(|_| "action_log_failed")?;
    if !fs::symlink_metadata(dir).is_ok_and(|metadata| metadata.file_type().is_dir()) {
        return Err("action_log_invalid");
    }
    set_private_dir_permissions(dir)?;
    let _guard = WRITING.lock().map_err(|_| "action_log_failed")?;
    // a file that is too big is replaced by the new line; a link, a folder or what cannot be opened is refused
    let (existing, replace) = match content_of(path) {
        Content::Lines(lines) => (lines, false),
        Content::TooBig => (Vec::new(), true),
        Content::Refused => return Err("action_log_invalid"),
    };
    if replace || existing.len() + 1 >= REWRITE_AT {
        let keep = MAX_ROWS - 1;
        let mut kept: Vec<&str> = existing.iter().skip(existing.len().saturating_sub(keep)).map(String::as_str).collect();
        kept.push(text);
        let temporary = path.with_extension("jsonl.tmp");
        // whatever stands at the temporary name (a leftover, a link someone put there) is removed, not followed,
        // and the file is created new: it is this call's own or the call fails
        let _ = fs::remove_file(&temporary);
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        no_follow(&mut options);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(|_| "action_log_failed")?;
        set_private_permissions(&temporary)?;
        file.write_all((kept.join("\n") + "\n").as_bytes()).map_err(|_| "action_log_failed")?;
        file.sync_all().map_err(|_| "action_log_failed")?;
        return fs::rename(&temporary, path).map_err(|_| "action_log_failed");
    }
    let mut options = fs::OpenOptions::new();
    options.create(true).append(true);
    no_follow(&mut options);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|_| "action_log_failed")?;
    set_private_permissions(path)?;
    file.write_all(format!("{text}\n").as_bytes()).map_err(|_| "action_log_failed")
}

/// A new id, unique for this file: the time in microseconds and a counter of this run.
fn new_id() -> String {
    let micros = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_micros()).unwrap_or(0);
    format!("{micros}-{}", SEQUENCE.fetch_add(1, Ordering::Relaxed))
}

/// Writes down that the app did `action` for the person on the team of this computer. Best effort: whatever goes
/// wrong here is not the act's problem.
pub(crate) fn record(app: &tauri::AppHandle, scope: &AccountScope, action: &str, subject: &Subject) {
    let Some(path) = file_of(app, scope) else { return };
    let at = crate::runtime_log::utc(SystemTime::now());
    if let Some(text) = line(action, subject, &new_id(), &at) {
        let _ = append(&path, &text);
    }
}

/// The agent a session name stands for (`scout-1`), or `all` when the act is about the whole team.
pub(crate) fn target_of(session: Option<&str>) -> Subject {
    match session {
        Some(name) if crate::existing_team_agents::agent_session(name).is_some() && target_ok(name) => Subject::Target(name.to_ascii_lowercase()),
        _ => Subject::Target("all".into()),
    }
}

/// What the panel's act on the team of this computer is, in the log's words; None for a read or an act the log
/// does not name (an answer to an agent's question). «Pause» and «stop the team» are the team stopped.
pub(crate) fn control_event(request: &crate::agent_control::ControlRequest) -> Option<(&'static str, Subject)> {
    use crate::agent_control::ControlRequest as Request;
    Some(match request {
        Request::Start { session, .. } => ("team.start", target_of(Some(session))),
        Request::Stop { session, .. } => ("team.stop", target_of(Some(session))),
        Request::Restart { session, .. } => ("team.restart", target_of(Some(session))),
        Request::Pause { .. } | Request::StopTeam { .. } => ("team.stop", target_of(None)),
        Request::Resume { .. } => ("team.start", target_of(None)),
        Request::ExclusionAccept { .. } => ("exclusion.decide", Subject::Nothing),
        Request::ExclusionWithdraw { .. } => ("exclusion.withdraw", Subject::Nothing),
        _ => return None,
    })
}

/// The settings a settings write names, from the closed list, in its order.
pub(crate) fn settings_of(settings: &Value) -> Subject {
    let keys: Vec<&'static str> = SETTINGS.iter().copied().filter(|key| settings.get(*key).is_some()).collect();
    if keys.is_empty() {
        Subject::Nothing
    } else {
        Subject::Settings(keys)
    }
}

/// A line of the file, closed again; None when it is not one the table writes.
fn close_row(raw: &str) -> Option<Value> {
    if raw.len() > LINE_MAX {
        return None;
    }
    let row: Value = serde_json::from_str(raw).ok()?;
    let row = row.as_object()?;
    let action = row.get("action")?.as_str()?;
    let level = level_of(action)?;
    let id = row.get("id")?.as_str().filter(|id| (1..=48).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_digit() || b == b'-'))?;
    let at = row.get("created_at")?.as_str().filter(|at| at.len() == 20 && at.ends_with('Z') && at.bytes().all(|b| b.is_ascii_digit() || b"-:TZ".contains(&b)))?;
    let params = row.get("params")?.as_object()?;
    // the same shapes `line` writes, and no other
    let mut closed = Map::new();
    if action.starts_with("team.") {
        let target = params.get("target")?.as_str().filter(|target| target_ok(target))?;
        closed.insert("target".into(), json!(target));
    } else if action.starts_with("exclusion.") {
        if let Some(number) = params.get("legacy_id") {
            closed.insert("legacy_id".into(), json!(number.as_u64().filter(|n| (1..=1_000_000_000_000).contains(n))?));
        }
    } else {
        for key in SETTINGS {
            if params.get(*key) == Some(&Value::Bool(true)) {
                closed.insert((*key).into(), Value::Bool(true));
            }
        }
    }
    Some(json!({
        "id": id, "action": action, "level": level, "params": Value::Object(closed),
        "summary": summary_of(action)?, "status": "done", "created_at": at,
    }))
}

/// The newest `READ_ROWS` closed lines of the file, newest first.
fn rows_of(path: &Path) -> Vec<Value> {
    let mut rows: Vec<Value> = lines_of(path).iter().filter_map(|raw| close_row(raw)).collect();
    rows.sort_by(|a, b| b["created_at"].as_str().cmp(&a["created_at"].as_str()).then_with(|| b["id"].as_str().cmp(&a["id"].as_str())));
    rows.truncate(READ_ROWS);
    rows
}

/// The log of the profile that is open, for the Agents panel's list. Only the main window.
#[tauri::command]
pub(crate) async fn local_action_log_read(
    app: tauri::AppHandle,
    window: tauri::Window,
    scopes: State<'_, AccountScopeState>,
) -> Result<Value, String> {
    if !direct_chat::window_may_write(window.label()) {
        return Ok(failure("action_log_window_refused"));
    }
    let scope = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(failure("account_scope_unavailable")),
    };
    let Some(path) = file_of(&app, &scope) else { return Ok(failure("action_log_unavailable")) };
    let rows = tauri::async_runtime::spawn_blocking(move || rows_of(&path)).await.map_err(|_| "action_log_unavailable".to_owned())?;
    if scopes.lock_expected(&scope).is_err() {
        return Ok(failure("account_scope_changed"));
    }
    Ok(json!({ "ok": true, "rows": rows }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const AT: &str = "2026-11-03T09:30:00Z";

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("jht-action-log-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir.join("a.jsonl")
    }

    #[test]
    fn a_line_holds_only_what_the_table_names_and_no_text_of_the_person() {
        let text = line("team.restart", &Subject::Target("scout-1".into()), "1-1", AT).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&text).unwrap(),
            json!({"id": "1-1", "action": "team.restart", "level": "L2", "params": {"target": "scout-1"}, "summary": "restart", "status": "done", "created_at": AT})
        );
        let text = line("exclusion.decide", &Subject::Position(12), "1-2", AT).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&text).unwrap()["params"], json!({"legacy_id": 12}));
        let text = line("settings.update", &Subject::Settings(vec!["working_hours"]), "1-3", AT).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&text).unwrap()["params"], json!({"working_hours": true}));
        // an action the table does not know, a subject that does not fit it, a target that is not a name: no line
        assert!(line("team.emergency_stop", &Subject::Target("all".into()), "1", AT).is_none());
        assert!(line("directive.create", &Subject::Nothing, "1", AT).is_none());
        assert!(line("team.start", &Subject::Position(3), "1", AT).is_none());
        assert!(line("team.start", &Subject::Nothing, "1", AT).is_none());
        for target in ["", "a b", "scout/1", "../x", "é", &"a".repeat(33)] {
            assert!(line("team.stop", &Subject::Target(target.into()), "1", AT).is_none(), "{target:?}");
        }
        assert!(line("exclusion.decide", &Subject::Position(0), "1", AT).is_none());
        assert!(line("settings.update", &Subject::Settings(vec!["role_models", "api_key"]), "1", AT).is_none());
    }

    #[test]
    fn the_subject_of_an_act_is_taken_from_closed_lists_only() {
        assert_eq!(target_of(Some("SCOUT-1")), Subject::Target("scout-1".into()));
        assert_eq!(target_of(Some("CAPITANO")), Subject::Target("capitano".into()));
        assert_eq!(target_of(Some("not a session")), Subject::Target("all".into()));
        assert_eq!(target_of(None), Subject::Target("all".into()));
        assert_eq!(settings_of(&json!({"role_models": {"scout": {"model": "SECRET"}}, "api_key": "k"})), Subject::Settings(vec!["role_models"]));
        assert_eq!(settings_of(&json!({"working_hours": {}, "role_models": {}})), Subject::Settings(vec!["working_hours", "role_models"]));
        assert_eq!(settings_of(&json!({"api_key": "k"})), Subject::Nothing);
    }

    #[test]
    fn the_file_is_private_capped_and_never_holds_more_than_the_newest_lines() {
        let path = temp("cap");
        for n in 0..(REWRITE_AT + 40) {
            let text = line("team.start", &Subject::Target("all".into()), &format!("{n}-{n}"), AT).unwrap();
            append(&path, &text).unwrap();
        }
        let lines = lines_of(&path);
        assert!(lines.len() <= REWRITE_AT && lines.len() >= MAX_ROWS - 1, "{}", lines.len());
        // the newest line is the last written, the oldest ones went
        assert!(lines.last().unwrap().contains(&format!("\"{}-{}\"", REWRITE_AT + 39, REWRITE_AT + 39)));
        assert!(!lines.iter().any(|l| l.contains("\"0-0\"")));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(path.parent().unwrap()).unwrap().permissions().mode() & 0o777, 0o700);
        }
        assert!(!path.with_extension("jsonl.tmp").exists(), "the temporary file is gone after the rename");
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_link_or_a_folder_in_place_of_the_file_is_refused_and_nothing_is_followed() {
        let path = temp("link");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(append(&path, "{}").is_err());
        assert!(lines_of(&path).is_empty());
        #[cfg(unix)]
        {
            let _ = fs::remove_dir(&path);
            let outside = path.parent().unwrap().join("outside.txt");
            fs::write(&outside, "{\"action\":\"team.start\"}\n").unwrap();
            std::os::unix::fs::symlink(&outside, &path).unwrap();
            assert!(append(&path, "{}").is_err());
            assert!(lines_of(&path).is_empty(), "a link is not read");
            assert_eq!(fs::read_to_string(&outside).unwrap(), "{\"action\":\"team.start\"}\n", "nothing was written through it");
        }
        // Windows: a symbolic link needs a privilege (or the developer mode), so the check runs only where one can be made
        #[cfg(windows)]
        {
            let _ = fs::remove_dir(&path);
            let outside = path.parent().unwrap().join("outside.txt");
            fs::write(&outside, "keep me").unwrap();
            if std::os::windows::fs::symlink_file(&outside, &path).is_ok() {
                assert!(append(&path, "{}").is_err(), "a link at the file's name is refused");
                assert!(lines_of(&path).is_empty(), "a link is not read");
                assert_eq!(fs::read_to_string(&outside).unwrap(), "keep me", "nothing was written through it");
                fs::remove_file(&path).unwrap();
            }
            let temporary = path.with_extension("jsonl.tmp");
            if std::os::windows::fs::symlink_file(&outside, &temporary).is_ok() {
                for n in 0..(REWRITE_AT + 2) {
                    append(&path, &line("team.stop", &Subject::Target("all".into()), &format!("{n}-3"), AT).unwrap()).unwrap();
                }
                assert_eq!(fs::read_to_string(&outside).unwrap(), "keep me", "the rotation did not write through the link");
            }
        }
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_file_that_is_too_big_is_replaced_not_read_as_empty_and_a_link_at_the_temporary_name_is_not_followed() {
        let path = temp("big");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, vec![b'x'; (FILE_MAX + 1) as usize]).unwrap();
        assert!(matches!(content_of(&path), Content::TooBig));
        assert!(rows_of(&path).is_empty());
        let one = line("team.start", &Subject::Target("all".into()), "1-1", AT).unwrap();
        append(&path, &one).unwrap();
        assert_eq!(lines_of(&path), vec![one.clone()], "the old content is gone, the new line is the log");
        #[cfg(unix)]
        {
            // a link planted at the temporary name: the rotation removes it and writes its own file
            let outside = path.parent().unwrap().join("outside.txt");
            fs::write(&outside, "keep me").unwrap();
            for n in 0..(REWRITE_AT + 2) {
                if n == REWRITE_AT - 3 {
                    let _ = fs::remove_file(path.with_extension("jsonl.tmp"));
                    std::os::unix::fs::symlink(&outside, path.with_extension("jsonl.tmp")).unwrap();
                }
                append(&path, &line("team.stop", &Subject::Target("all".into()), &format!("{n}-2"), AT).unwrap()).unwrap();
            }
            assert_eq!(fs::read_to_string(&outside).unwrap(), "keep me", "nothing was written through the link");
            assert!(lines_of(&path).len() >= MAX_ROWS - 1);
            assert!(!path.with_extension("jsonl.tmp").exists());
        }
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_read_closes_every_line_again_newest_first_and_drops_what_the_table_does_not_write() {
        let path = temp("read");
        let good = |n: u32, action: &str, subject: Subject| line(action, &subject, &format!("{n}-1"), &format!("2026-11-03T09:{n:02}:00Z")).unwrap();
        let mut file = String::new();
        file += &(good(1, "team.start", Subject::Target("all".into())) + "\n");
        file += &(good(3, "exclusion.withdraw", Subject::Position(7)) + "\n");
        file += &(good(2, "settings.update", Subject::Settings(vec!["working_hours"])) + "\n");
        // lines a person or a program could have put in the file
        file += "not json\n";
        file += "{\"id\":\"9-9\",\"action\":\"directive.create\",\"params\":{},\"created_at\":\"2026-11-03T09:59:00Z\"}\n";
        file += "{\"id\":\"9-9\",\"action\":\"team.stop\",\"params\":{\"target\":\"../etc\"},\"created_at\":\"2026-11-03T09:59:00Z\"}\n";
        file += "{\"id\":\"9-8\",\"action\":\"team.stop\",\"params\":{\"target\":\"all\",\"note\":\"my private text\",\"path\":\"/etc\"},\"summary\":\"a secret\",\"created_at\":\"2026-11-03T09:58:00Z\"}\n";
        file += "{\"id\":\"x y\",\"action\":\"team.stop\",\"params\":{\"target\":\"all\"},\"created_at\":\"2026-11-03T09:57:00Z\"}\n";
        file += "{\"id\":\"9-7\",\"action\":\"team.stop\",\"params\":{\"target\":\"all\"},\"created_at\":\"yesterday\"}\n";
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, file).unwrap();
        let rows = rows_of(&path);
        let order: Vec<&str> = rows.iter().map(|r| r["action"].as_str().unwrap()).collect();
        assert_eq!(order, ["team.stop", "exclusion.withdraw", "settings.update", "team.start"]);
        // the stray fields of a changed line are gone, and the summary is the table's, not the file's
        assert_eq!(rows[0], json!({"id": "9-8", "action": "team.stop", "level": "L2", "params": {"target": "all"}, "summary": "stop", "status": "done", "created_at": "2026-11-03T09:58:00Z"}));
        assert_eq!(rows[1]["params"], json!({"legacy_id": 7}));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn a_read_brings_at_most_the_newest_hundred_lines() {
        let path = temp("most");
        for n in 0..(READ_ROWS + 30) {
            let at = format!("2026-11-03T{:02}:{:02}:{:02}Z", n / 3600, (n / 60) % 60, n % 60);
            append(&path, &line("team.start", &Subject::Target("all".into()), &format!("{n}-1"), &at).unwrap()).unwrap();
        }
        let rows = rows_of(&path);
        assert_eq!(rows.len(), READ_ROWS);
        assert_eq!(rows[0]["id"], format!("{}-1", READ_ROWS + 29));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    /// The source of the module above its tests.
    fn source() -> &'static str {
        include_str!("local_action_log.rs").split("#[cfg(test)]").next().unwrap()
    }

    #[test]
    fn the_module_writes_only_its_own_folder_and_never_reaches_the_network_a_process_or_the_team() {
        let source = source();
        for forbidden in ["Command::new", "std::process", "TcpStream", "reqwest", "run_script", "run_ssh_command", "invoke"] {
            assert!(!source.contains(forbidden), "{forbidden}");
        }
        // the reader answers to the main window only and holds nothing of the team
        let reader = source.split("pub(crate) async fn local_action_log_read(").nth(1).unwrap();
        assert!(reader.contains("window_may_write(window.label())") && reader.contains("scopes.active()"));
        assert!(!reader.contains("local_wrapper") && !reader.contains("ValidatedHost"));
    }
}

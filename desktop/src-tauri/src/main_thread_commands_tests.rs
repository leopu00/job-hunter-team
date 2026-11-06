//! A command that is not `async` runs on the main thread, the window's own. If it starts a process, or waits for a
//! lock another operation keeps while one runs, the window stops answering for as long as that takes (seconds on a slow
//! Windows computer; Windows then marks the program «not responding»). These tests read the commands' sources.

use std::fs;
use std::path::PathBuf;

struct Command {
    file: String,
    name: String,
    is_async: bool,
    body: String,
}

/// Every Tauri command of the sources: file, name, whether it is async and its body.
fn commands() -> Vec<Command> {
    // The marker is built here so that this file does not hold it as a literal.
    let marker = concat!("#[tauri", "::command");
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files: Vec<_> = fs::read_dir(&dir)
        .expect("src is readable")
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|extension| extension == "rs"))
        .collect();
    files.sort();
    let mut found = Vec::new();
    for path in files {
        let source = fs::read_to_string(&path).unwrap().replace("\r\n", "\n");
        let file = path.file_name().unwrap().to_string_lossy().into_owned();
        let mut rest = source.as_str();
        while let Some(at) = rest.find(marker) {
            let at_line_start = at == 0 || rest[..at].ends_with('\n');
            rest = &rest[at + marker.len()..];
            let Some(fn_at) = rest.find("fn ") else { break };
            let head = &rest[..fn_at];
            // a marker in a string or a comment is not at the start of a line, and what follows a real one is only
            // the rest of the attribute and the function's keywords
            if !at_line_start || head.contains(['{', ';', '"']) {
                continue;
            }
            let after = &rest[fn_at + 3..];
            let name: String = after.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
            // the body, without the function's own name (a command called `…_probe` is not a probe)
            let body = after[name.len()..].split("\n}\n").next().unwrap_or("").to_owned();
            found.push(Command { file: file.clone(), name, is_async: head.contains("async"), body });
        }
    }
    found
}

/// What puts a process or a long wait in a function: an engine or a wrapper run, a child process waited for, and (read
/// with the white space taken out, so a chain over several lines is seen too) a lock that another operation keeps while it
/// runs a process: the connection's, the login's session, the sends', the account's write lock, and the teardown of all of them.
const WAITS: [&str; 22] = [
    "run_scoped_local(",
    "run_ssh(",
    "stop_provider_login_in_container(",
    "configured_subscription_provider(",
    "run_connection(",
    "run_verified_local_wrapper(",
    "run_ssh_command",
    "run_program(",
    "status_for_scope(",
    "probe(",
    ".output()",
    ".wait()",
    "wait_with_output",
    "Command::new(",
    ".connection.lock()",
    ".interactive.lock()",
    ".send_lock.lock()",
    ".write()",
    "teardown(",
    "activate_scope(",
    "activate_scope_from(",
    "run_python(",
];

/// Sync commands that may touch those, each with the reason it can: they are rare, or have nothing in the way.
const ALLOWED_SYNC: [(&str, &str); 3] = [
    ("onboarding_local_owner_take_over", "reads and rewrites two small files under the account's read lock; no connection, no process"),
    ("runtime_playground_local_reset", "a debug build only (playground_reset_enabled); the person's own testing, never a release"),
    ("runtime_playground_local_orphan_recover", "a debug build only (playground_reset_enabled); the person's own testing, never a release"),
];

fn squashed(text: &str) -> String {
    text.chars().filter(|c| !c.is_whitespace()).collect()
}

#[test]
fn the_commands_of_the_chat_are_all_async_so_the_window_never_waits_for_them() {
    let chat: Vec<_> = commands().into_iter().filter(|command| command.file == "direct_chat.rs").collect();
    assert!(chat.len() >= 12, "the scan found only {} commands of the chat", chat.len());
    let sync: Vec<_> = chat.iter().filter(|command| !command.is_async).map(|command| command.name.as_str()).collect();
    assert!(sync.is_empty(), "sync commands of the chat run on the main thread: {sync:?}");
    // the ones that ask the connection do it on a thread of their own
    for name in ["direct_chat_status", "direct_chat_subscribe", "direct_chat_attach_state", "direct_chat_close"] {
        let command = chat.iter().find(|command| command.name == name).unwrap_or_else(|| panic!("{name} is not a command any more"));
        assert!(command.body.contains("spawn_blocking("), "{name} does its work on the main thread's executor");
    }
}

#[test]
fn no_sync_command_starts_a_process_or_waits_for_the_connection_or_the_login() {
    let all = commands();
    assert!(all.len() > 100, "the scan found only {} commands", all.len());
    let mut offenders = Vec::new();
    let mut seen_allowed = Vec::new();
    for command in all.iter().filter(|command| !command.is_async) {
        let body = squashed(&command.body);
        let Some(hit) = WAITS.iter().find(|wait| body.contains(&squashed(wait))) else { continue };
        if ALLOWED_SYNC.iter().any(|(name, _)| *name == command.name) {
            seen_allowed.push(command.name.clone());
        } else {
            offenders.push(format!("{}::{} ({hit})", command.file, command.name));
        }
    }
    assert!(offenders.is_empty(), "sync commands that start a process or wait for a lock: {offenders:?}");
    // an allowed command that no longer touches any of it (or is gone, or is async) is taken off the list
    for (name, reason) in ALLOWED_SYNC {
        assert!(seen_allowed.iter().any(|seen| seen == name), "{name} is listed as allowed ({reason}) but no longer needs it");
    }
}

#[test]
fn the_commands_that_change_the_account_or_take_the_login_input_are_async() {
    let all = commands();
    for name in [
        "runtime_account_scope_reset",
        "runtime_account_scope_set_local",
        "onboarding_local_owner_return",
        "onboarding_provider_login_input",
        "onboarding_provider_login",
        "onboarding_provider_login_close",
    ] {
        let command = all.iter().find(|command| command.name == name).unwrap_or_else(|| panic!("{name} is not a command any more"));
        assert!(command.is_async, "{name} runs on the main thread and waits for the connection or the login");
    }
}

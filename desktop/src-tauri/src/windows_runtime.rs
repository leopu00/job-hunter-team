//! The team on this computer on Windows: Podman inside WSL, with the runtime
//! that install.ps1 publishes and the PowerShell wrapper jht.ps1 (the same ones
//! the game uses). Nothing to install by hand besides WSL itself. The app:
//! - checks that WSL answers (`wsl.exe --status`) and says what to do when it
//!   does not (wsl_not_ready), before downloading anything;
//! - downloads install.ps1, checks it against the digest compiled from
//!   installer-windows.sha256, and runs it with `-SkipOnboard`; a test build
//!   takes install.ps1 of its commit instead, with that commit's digest and
//!   coordinates (release_channel.rs). install.ps1 installs Podman when it is
//!   missing and creates the JHT Podman machine in WSL; choosing «this
//!   computer» in the onboarding is the user's consent to that. Its stdout
//!   names the phase it is in (`JHT_PHASE <id>`), shown with the elapsed time;
//!   its exit code names what failed (20 WSL, 21 Podman, 22 the machine);
//! - calls `%USERPROFILE%\.local\bin\jht.ps1` only when the wrapper carries
//!   the protocol markers and matches the `.runtime-integrity` that
//!   install.ps1 wrote under `%LOCALAPPDATA%\Job Hunter Team\host-runtime`.
//! Every script runs through Windows PowerShell by its absolute path,
//! non-interactive, without profile and without a console window.
//!
//! The pure parts (argv, markers, manifest, phases, exit codes) build on every
//! system, so they are tested on every system; the parts that run programs are
//! Windows-only.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

pub(crate) const INSTALL_PS1_SHA256: &str = include_str!("../installer-windows.sha256");

/// The lines a desktop-capable jht.ps1 carries, like the sh wrapper's
/// JHT_HOST_RUNTIME_PROTOCOL=1 & co.
pub(crate) const WRAPPER_PROTOCOLS: [&str; 3] = [
    "$JHT_HOST_RUNTIME_PROTOCOL = 1",
    "$JHT_DESKTOP_CHAT_PROTOCOL = 1",
    "$JHT_ONBOARDING_SNAPSHOT_PROTOCOL = 1",
];

const POWERSHELL_FLAGS: [&str; 6] = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
];

pub(crate) const AUTOSTART_TASK_LABEL: &str = "Job Hunter Team - Start runtime";

/// A per-user name keeps a desktop task away from legacy/global JHT tasks
/// (including P23). The SID is also the identity the registration attests.
pub(crate) fn autostart_task_name(sid: &str) -> String {
    format!("{AUTOSTART_TASK_LABEL} [{sid}]")
}

fn current_user_sid(output: &[u8]) -> Option<String> {
    String::from_utf8_lossy(output)
        .split(|value: char| !(value.is_ascii_alphanumeric() || value == '-'))
        .find(|value| value.strip_prefix("S-1-").is_some_and(|parts| {
            let mut segments = parts.split('-');
            segments.clone().nth(1).is_some()
                && segments.all(|part| !part.is_empty() && part.chars().all(|digit| digit.is_ascii_digit()))
        }))
        .map(str::to_owned)
}

fn xml_section<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}");
    let close = format!("</{name}>");
    let openings: Vec<usize> = xml.match_indices(&open)
        .filter_map(|(at, _)| matches!(xml.as_bytes().get(at + open.len()), Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\r') | Some(b'\n')).then_some(at))
        .collect();
    if openings.len() != 1 || xml.matches(&close).count() != 1 { return None; }
    let open_end = xml[openings[0]..].find('>')? + openings[0];
    let start = open_end + 1;
    let end = xml[start..].find(&close)? + start;
    Some(&xml[start..end])
}

fn xml_text<'a>(xml: &'a str, name: &str) -> Option<&'a str> {
    xml_section(xml, name).filter(|value| !value.contains('<'))
}

fn autostart_action(shell: &Path, wrapper: &Path) -> String {
    format!(
        "\"{}\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{}\" up",
        shell.display(), wrapper.display(),
    )
}

/// The task is created by the non-elevated desktop process, explicitly bound
/// to its current interactive user. `/IT` refuses a password-backed task.
pub(crate) fn autostart_create_args(wrapper: &Path, system_root: Option<OsString>, user: &str, sid: &str) -> Vec<OsString> {
    let shell = powershell_path(system_root);
    let action = autostart_action(&shell, wrapper);
    let task = autostart_task_name(sid);
    ["/Create", "/TN", &task, "/SC", "ONLOGON", "/TR", &action, "/RL", "LIMITED", "/RU", user, "/IT", "/F"]
        .into_iter().map(OsString::from).collect()
}

fn autostart_query_args(sid: &str) -> Vec<OsString> {
    let task = autostart_task_name(sid);
    ["/Query", "/TN", &task, "/XML"].into_iter().map(OsString::from).collect()
}

fn autostart_contract(xml: &str, user: &str, shell: &Path, wrapper: &Path) -> bool {
    let no_other_triggers = ["BootTrigger", "CalendarTrigger", "EventTrigger", "IdleTrigger", "RegistrationTrigger", "SessionStateChangeTrigger", "TimeTrigger"]
        .iter().all(|tag| !xml.contains(&format!("<{tag}")));
    let no_other_actions = ["ComHandler", "SendEmail", "ShowMessage"]
        .iter().all(|tag| !xml.contains(&format!("<{tag}")));
    let expected_arguments = autostart_action(shell, wrapper)
        .split_once(' ').map(|(_, args)| args.replace('"', "&quot;"));
    no_other_triggers && no_other_actions
        && xml_section(xml, "LogonTrigger").is_some()
        && xml_section(xml, "Exec").is_some()
        && xml_section(xml, "LogonTrigger").and_then(|part| xml_text(part, "UserId")) == Some(user)
        && xml_section(xml, "Principal").and_then(|part| xml_text(part, "UserId")) == Some(user)
        && xml_section(xml, "Principal").and_then(|part| xml_text(part, "LogonType")) == Some("InteractiveToken")
        && xml_section(xml, "Principal").and_then(|part| xml_text(part, "RunLevel")) == Some("LeastPrivilege")
        && xml_section(xml, "Settings").and_then(|part| xml_text(part, "Enabled")) == Some("true")
        && xml_section(xml, "Exec").and_then(|part| xml_text(part, "Command")) == shell.to_str()
        && xml_section(xml, "Exec").and_then(|part| xml_text(part, "Arguments")) == expected_arguments.as_deref()
}

#[cfg(windows)]
pub(crate) fn register_autostart(wrapper: &Path) -> bool {
    let root = std::env::var_os("SystemRoot").unwrap_or_else(|| OsString::from(r"C:\Windows"));
    let schtasks = PathBuf::from(root.clone()).join("System32").join("schtasks.exe");
    let whoami = PathBuf::from(&root).join("System32").join("whoami.exe");
    let user = match crate::runtime_host::run_program(whoami.to_string_lossy().as_ref(), std::iter::empty::<&str>(), None, std::time::Duration::from_secs(10)) {
        Ok(result) if result.success() => String::from_utf8_lossy(&result.stdout).trim().to_owned(),
        _ => return false,
    };
    if user.is_empty() { return false; }
    let sid = match crate::runtime_host::run_program(whoami.to_string_lossy().as_ref(), ["/user", "/fo", "csv", "/nh"], None, std::time::Duration::from_secs(10)) {
        Ok(result) if result.success() => current_user_sid(&result.stdout),
        _ => None,
    };
    let Some(sid) = sid else { return false; };
    let create = autostart_create_args(wrapper, Some(root.clone()), &user, &sid);
    let created = crate::runtime_host::run_program(
        schtasks.to_string_lossy().as_ref(), create, None, std::time::Duration::from_secs(15),
    );
    if !created.is_ok_and(|result| result.success()) { return false; }
    let queried = crate::runtime_host::run_program(
        schtasks.to_string_lossy().as_ref(), autostart_query_args(&sid), None, std::time::Duration::from_secs(15),
    );
    let Ok(result) = queried else { return false; };
    result.success() && autostart_contract(
        &String::from_utf8_lossy(&result.stdout), &user, &powershell_path(Some(root)), wrapper,
    )
}

/// Windows PowerShell 5.1, which every Windows 10/11 has, by absolute path:
/// never whatever `powershell` the PATH resolves first.
pub(crate) fn powershell_path(system_root: Option<OsString>) -> PathBuf {
    PathBuf::from(system_root.unwrap_or_else(|| OsString::from(r"C:\Windows")))
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe")
}

/// `-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script> <args>`.
pub(crate) fn script_invocation(script: &Path, args: &[&str]) -> Vec<OsString> {
    POWERSHELL_FLAGS
        .iter()
        .map(OsString::from)
        .chain(std::iter::once(script.as_os_str().to_owned()))
        .chain(args.iter().map(OsString::from))
        .collect()
}

/// install.ps1 with `-SkipOnboard`, then the release channel's arguments
/// (none in production; `-SourceSha … -Image … -ExpectedImageDigest …` in a
/// test build).
pub(crate) fn installer_invocation(script: &Path, channel_args: &[String]) -> Vec<OsString> {
    let args: Vec<&str> = std::iter::once("-SkipOnboard")
        .chain(channel_args.iter().map(String::as_str))
        .collect();
    script_invocation(script, &args)
}

/// `%LOCALAPPDATA%\Job Hunter Team\host-runtime`, where install.ps1 puts the
/// compose file and the integrity manifest. Only an absolute LOCALAPPDATA.
pub(crate) fn runtime_dir(local_app_data: Option<OsString>) -> Option<PathBuf> {
    let base = PathBuf::from(local_app_data?);
    base.is_absolute()
        .then(|| base.join("Job Hunter Team").join("host-runtime"))
}

pub(crate) fn wrapper_has_protocols(source: &str) -> bool {
    WRAPPER_PROTOCOLS.iter().all(|protocol| {
        source
            .lines()
            .map(|line| line.trim_end_matches('\r').trim())
            .any(|line| line == *protocol)
    })
}

/// The files install.ps1 records in `.runtime-integrity`, besides `version`,
/// and where each one lives: next to the compose file (Runtime) or next to
/// the wrapper (Bin).
#[derive(Clone, Copy)]
enum Place {
    Runtime,
    Bin,
}
const MANIFEST_FILES: [(&str, Place, &str); 8] = [
    ("docker-compose.yml", Place::Runtime, "docker-compose.yml"),
    ("docker-compose.podman.yml", Place::Runtime, "docker-compose.podman.yml"),
    ("container-runtime", Place::Runtime, "container-runtime"),
    ("podman-machine", Place::Runtime, "podman-machine"),
    ("jht-container.service", Place::Runtime, "jht-container.service"),
    ("jht-wrapper.ps1", Place::Bin, "jht.ps1"),
    ("windows-private-acl.ps1", Place::Bin, "windows-private-acl.ps1"),
    ("docker.exe", Place::Runtime, "bin/docker.exe"),
];
/// A test-channel install also pins its image: the file and its manifest
/// line come together, or neither does.
const IMAGE_PIN: &str = "runtime-image";

/// install.ps1's manifest, exactly: version=1, then the sha256 of every
/// required file, each matching the file; `optional` is a key that must be
/// there when its file is (Some digest) and absent when it is not (None).
pub(crate) fn manifest_matches(
    manifest: &str,
    required: &[(&str, Option<String>)],
    optional: (&str, Option<String>),
) -> bool {
    let mut entries = std::collections::BTreeMap::new();
    for line in manifest.lines().map(|line| line.trim_end_matches('\r')) {
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            return false;
        };
        if value.is_empty() || entries.insert(key, value).is_some() {
            return false;
        }
    }
    let present: Vec<&(&str, Option<String>)> = required
        .iter()
        .chain(optional.1.is_some().then_some(&optional))
        .collect();
    let mut wanted: Vec<&str> = std::iter::once("version")
        .chain(present.iter().map(|(name, _)| *name))
        .collect();
    let mut keys: Vec<&str> = entries.keys().copied().collect();
    keys.sort_unstable();
    wanted.sort_unstable();
    keys == wanted
        && entries["version"] == "1"
        && present.iter().all(|(name, digest)| {
            digest
                .as_deref()
                .is_some_and(|digest| entries[name].eq_ignore_ascii_case(digest))
        })
}

#[cfg_attr(not(windows), allow(dead_code))]
fn file_digest(path: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() == 0 {
        return None;
    }
    Some(format!("{:x}", Sha256::digest(std::fs::read(path).ok()?)))
}

/// The wrapper with everything install.ps1 published next to it, as
/// install.ps1 recorded it, on the Podman runtime.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn wrapper_bundle_valid(wrapper: &Path, runtime_dir: &Path) -> bool {
    #[cfg(windows)]
    if !runtime_paths_are_attested(wrapper, runtime_dir) {
        return false;
    }
    let Some(bin) = wrapper.parent() else {
        return false;
    };
    let Ok(manifest) = std::fs::read_to_string(runtime_dir.join(".runtime-integrity")) else {
        return false;
    };
    let selected = std::fs::read_to_string(runtime_dir.join("container-runtime"));
    if selected.ok().is_none_or(|value| value.trim() != "podman") {
        return false;
    }
    let required: Vec<(&str, Option<String>)> = MANIFEST_FILES
        .iter()
        .map(|(key, place, file)| {
            let path = match place {
                Place::Runtime => runtime_dir.join(file),
                Place::Bin if *key == "jht-wrapper.ps1" => wrapper.to_path_buf(),
                Place::Bin => bin.join(file),
            };
            (*key, file_digest(&path))
        })
        .collect();
    let pin = runtime_dir.join(IMAGE_PIN);
    // A pin that is there but unreadable must not count as "no pin".
    if std::fs::symlink_metadata(&pin).is_ok() && file_digest(&pin).is_none() {
        return false;
    }
    manifest_matches(&manifest, &required, (IMAGE_PIN, file_digest(&pin)))
}

/// The byte manifest is not an authority when an untrusted account can replace
/// its directory or lead us through a reparse point. This mirrors the checked
/// Windows wrapper before the Rust chat path selects its private engine.
#[cfg(windows)]
fn runtime_paths_are_attested(wrapper: &Path, runtime_dir: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
    let protected_node = |path: &Path, directory: bool| {
        let Ok(metadata) = std::fs::symlink_metadata(path) else { return false };
        let kind = metadata.file_type();
        let expected_kind = if directory { kind.is_dir() } else { kind.is_file() };
        expected_kind
            && !kind.is_symlink()
            && metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0
            && crate::private_acl::owned_by_current_user(path)
            && crate::private_acl::current_user_sid().ok().is_some_and(|user| {
                crate::private_acl::read_acl(path)
                    .is_ok_and(|acl| crate::private_acl::is_runtime_owner_only(&acl, &user))
            })
    };
    let ancestors_are_plain = |path: &Path| {
        let mut current = Some(path);
        while let Some(node) = current {
            let Ok(metadata) = std::fs::symlink_metadata(node) else { return false };
            if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return false;
            }
            current = node.parent();
        }
        true
    };
    let Some(bin) = wrapper.parent() else { return false };
    let manifest = runtime_dir.join(".runtime-integrity");
    let all_manifest_nodes_are_protected = MANIFEST_FILES.iter().all(|(key, place, file)| {
        let path = match place {
            Place::Runtime => runtime_dir.join(file),
            Place::Bin if *key == "jht-wrapper.ps1" => wrapper.to_path_buf(),
            Place::Bin => bin.join(file),
        };
        protected_node(&path, false)
    });
    let pin = runtime_dir.join(IMAGE_PIN);
    ancestors_are_plain(runtime_dir)
        && ancestors_are_plain(wrapper)
        && protected_node(runtime_dir, true)
        && protected_node(&manifest, false)
        && all_manifest_nodes_are_protected
        && (!std::fs::symlink_metadata(&pin).is_ok() || protected_node(&pin, false))
}

/// `%SystemRoot%\System32\wsl.exe`, by absolute path like PowerShell.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn wsl_path(system_root: Option<OsString>) -> PathBuf {
    PathBuf::from(system_root.unwrap_or_else(|| OsString::from(r"C:\Windows")))
        .join("System32")
        .join("wsl.exe")
}

/// `wsl.exe --status`: WSL is ready only when it answers in time with
/// success. Missing, not enabled, waiting for a restart or an update: all
/// wsl_not_ready, whose action the catalog tells without a terminal.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn wsl_state(
    result: Result<crate::runtime_host::ProcessResult, &'static str>,
) -> Result<(), &'static str> {
    match result {
        Ok(result) if result.success() => Ok(()),
        _ => Err("wsl_not_ready"),
    }
}

/// What a failed install.ps1 or `jht.ps1 up` says with its exit code (the
/// contract with the PowerShell side): 20 WSL not usable, 21 Podman or
/// Compose not installable, 22 the Podman machine missing, not creatable or
/// not starting, 23 the machine's egress proxies not ready (which one and
/// what it answered is on stderr), 24 another version of Podman installed
/// than the one JHT pins, 25 Podman registered for the computer by winget
/// while this Windows user reaches no podman.exe (it sits in another user's
/// profile) and installing it for this user did not succeed. Any other
/// failure is the caller's generic code.
pub(crate) fn exit_failure(code: i32) -> Option<&'static str> {
    match code {
        20 => Some("wsl_not_ready"),
        21 => Some("podman_missing"),
        22 => Some("podman_start_failed"),
        23 => Some("podman_network_unready"),
        24 => Some("podman_version_mismatch"),
        25 => Some("podman_other_user"),
        _ => None,
    }
}

/// install.ps1's end, from run_program_lines: its exit code, or the timeout.
pub(crate) fn installer_outcome(result: Result<i32, &'static str>) -> Result<(), &'static str> {
    match result {
        Ok(0) => Ok(()),
        Ok(code) => Err(exit_failure(code).unwrap_or("runtime_install_failed")),
        Err("process_timeout") => Err("timeout"),
        Err(_) => Err("runtime_install_failed"),
    }
}

/// install.ps1's phases, in the order they run, with the key of what the
/// onboarding shows while each one lasts (desktop/src/lib/onboarding-progress.i18n.ts,
/// 7 languages).
pub(crate) const INSTALL_PHASES: [(&str, &str); 7] = [
    ("wsl_check", "ui_phase_wsl_check"),
    ("podman_install", "ui_phase_podman_install"),
    ("podman_machine_init", "ui_phase_podman_machine_init"),
    ("podman_machine_start", "ui_phase_podman_machine_start"),
    ("runtime_download", "ui_phase_runtime_download"),
    ("image_pull", "ui_phase_image_pull"),
    // A team that ran on another image restarts on the one just pulled (enable-podman-windows-runtime.ps1).
    ("team_restart", "ui_phase_team_restart"),
];

/// The key of a `JHT_PHASE <id>` line of install.ps1's stdout, exactly, with a
/// known id. Anything else on stdout is not shown.
pub(crate) fn phase_message(line: &str) -> Option<&'static str> {
    let id = line.trim_end_matches(['\r', '\n']).strip_prefix("JHT_PHASE ")?;
    INSTALL_PHASES
        .iter()
        .find(|(known, _)| *known == id)
        .map(|(_, message)| *message)
}

/// install.ps1's notices (`JHT_NOTICE <id>`), with the key of what the
/// onboarding keeps on screen for the rest of the setup. A notice is not a
/// failure: the install goes on.
pub(crate) const INSTALL_NOTICES: [(&str, &str); 2] = [
    ("windows10_unsupported", "ui_notice_windows10_unsupported"),
    ("autostart_inactive", "ui_notice_autostart_inactive"),
];

/// The key of a `JHT_NOTICE <id>` line of install.ps1's stdout, exactly, with
/// a known id.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn notice_message(line: &str) -> Option<&'static str> {
    let id = line.trim_end_matches(['\r', '\n']).strip_prefix("JHT_NOTICE ")?;
    INSTALL_NOTICES
        .iter()
        .find(|(known, _)| *known == id)
        .map(|(_, message)| *message)
}

/// Whether a key the setup reports is one of install.ps1's notices.
pub(crate) fn is_install_notice(message: &str) -> bool {
    INSTALL_NOTICES.iter().any(|(_, known)| *known == message)
}

/// The line a jht.ps1 that can remove JHT from this computer carries
/// (`jht.ps1 uninstall --confirm`, the contract with the PowerShell side).
pub(crate) const UNINSTALL_PROTOCOL: &str = "$JHT_UNINSTALL_PROTOCOL = 1";

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn wrapper_supports_uninstall(source: &str) -> bool {
    source
        .lines()
        .map(|line| line.trim_end_matches('\r').trim())
        .any(|line| line == UNINSTALL_PROTOCOL)
}

/// The removal's phases, with the key of what the screen shows while each
/// one lasts (desktop/src/lib/onboarding-runtime.i18n.ts).
#[cfg_attr(not(windows), allow(dead_code))]
const UNINSTALL_PHASES: [(&str, &str); 3] = [
    ("uninstall_machine", "ui_uninstall_machine"),
    ("uninstall_runtime", "ui_uninstall_runtime"),
    ("uninstall_commands", "ui_uninstall_commands"),
];
/// What a removal can leave behind, as `JHT_LEFT <id>` names it.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) const UNINSTALL_ITEMS: [&str; 3] = ["machine", "runtime", "commands"];

#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum UninstallLine {
    Phase(&'static str),
    Left(&'static str),
}

/// A `JHT_PHASE <id>` or `JHT_LEFT <id>` line of `jht.ps1 uninstall`, exactly,
/// with a known id. Anything else on stdout is not shown.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn uninstall_line(line: &str) -> Option<UninstallLine> {
    let line = line.trim_end_matches(['\r', '\n']);
    if let Some(id) = line.strip_prefix("JHT_PHASE ") {
        return UNINSTALL_PHASES
            .iter()
            .find(|(known, _)| *known == id)
            .map(|(_, key)| UninstallLine::Phase(*key));
    }
    let id = line.strip_prefix("JHT_LEFT ")?;
    UNINSTALL_ITEMS
        .iter()
        .find(|known| **known == id)
        .map(|known| UninstallLine::Left(*known))
}

/// The end of `jht.ps1 uninstall --confirm`: 0 removed (or nothing was
/// there), 24 incomplete with what is left, anything else a failure. An
/// incomplete removal that names nothing left is told as all of it left: the
/// app must not claim a removal it cannot see.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn uninstall_outcome(
    result: Result<i32, &'static str>,
    mut left: Vec<&'static str>,
) -> Result<(bool, Vec<&'static str>), &'static str> {
    match result {
        Ok(0) => Ok((true, Vec::new())),
        Ok(24) => {
            if left.is_empty() {
                left = UNINSTALL_ITEMS.to_vec();
            }
            left.sort_unstable_by_key(|id| UNINSTALL_ITEMS.iter().position(|known| known == id));
            left.dedup();
            Ok((false, left))
        }
        Err("process_timeout") => Err("timeout"),
        _ => Err("uninstall_failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_host::ProcessResult;

    #[test]
    fn autostart_task_is_a_limited_current_user_logon_task() {
        let args: Vec<String> = autostart_create_args(
            Path::new(r"C:\Users\someone\.local\bin\jht.ps1"),
            Some(OsString::from(r"D:\Win")),
            r"JHTPC\someone",
            "S-1-5-21-1111-2222-3333-1001",
        ).into_iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert!(args.windows(2).any(|pair| pair == ["/TN", "Job Hunter Team - Start runtime [S-1-5-21-1111-2222-3333-1001]"]));
        assert!(args.windows(2).any(|pair| pair == ["/SC", "ONLOGON"]));
        assert!(args.windows(2).any(|pair| pair == ["/RL", "LIMITED"]));
        assert!(args.windows(2).any(|pair| pair == ["/RU", r"JHTPC\someone"]));
        assert!(args.iter().any(|arg| arg.eq_ignore_ascii_case("/IT")));
        assert!(!args.iter().any(|arg| arg.eq_ignore_ascii_case("HIGHEST")));
        assert!(args.iter().any(|arg| arg.contains("jht.ps1") && arg.ends_with(" up")));
        assert_eq!(current_user_sid(b"\"JHTPC\\someone\",\"S-1-5-21-1111-2222-3333-1001\"\r\n"), Some("S-1-5-21-1111-2222-3333-1001".into()));
        assert_eq!(current_user_sid(b"S-1-"), None);
        assert_eq!(current_user_sid(b"S-1-5"), None);
        assert_eq!(current_user_sid(b"S-1-5--1001"), None);
        assert_eq!(current_user_sid(b"no SID"), None);
    }

    #[test]
    fn autostart_read_back_requires_the_current_interactive_user_and_exact_action() {
        let shell = Path::new(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe");
        let wrapper = Path::new(r"C:\Users\someone\.local\bin\jht.ps1");
        let xml = r#"<LogonTrigger><Enabled>true</Enabled><UserId>JHTPC\someone</UserId></LogonTrigger><Principal><UserId>JHTPC\someone</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal><Settings><Enabled>true</Enabled></Settings><Exec><Command>C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe</Command><Arguments>-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File &quot;C:\Users\someone\.local\bin\jht.ps1&quot; up</Arguments></Exec>"#;
        assert!(autostart_contract(xml, r"JHTPC\someone", shell, wrapper));
        assert!(!autostart_contract(xml, r"JHTPC\other", shell, wrapper));
        assert!(!autostart_contract(&xml.replace("InteractiveToken", "Password"), r"JHTPC\someone", shell, wrapper));
        assert!(!autostart_contract(&format!("{xml}<Exec></Exec>"), r"JHTPC\someone", shell, wrapper));
    }

    #[test]
    fn powershell_runs_by_absolute_path_non_interactive_without_profile() {
        let shell = powershell_path(Some(OsString::from(r"D:\Win")));
        assert!(shell.ends_with("WindowsPowerShell/v1.0/powershell.exe") || shell.to_string_lossy().ends_with(r"WindowsPowerShell\v1.0\powershell.exe"));
        assert!(shell.starts_with(r"D:\Win"));
        assert!(powershell_path(None).starts_with(r"C:\Windows"));

        let wrapper = Path::new(r"C:\Users\someone\.local\bin\jht.ps1");
        let args: Vec<String> = script_invocation(wrapper, &["providers", "use", "claude"])
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                r"C:\Users\someone\.local\bin\jht.ps1",
                "providers",
                "use",
                "claude"
            ]
        );
        let install: Vec<String> = installer_invocation(Path::new(r"C:\Temp\i.ps1"), &[])
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(install.last().map(String::as_str), Some("-SkipOnboard"));
        assert_eq!(install[install.len() - 2], r"C:\Temp\i.ps1");
        // A test build: the channel's coordinates follow -SkipOnboard, as
        // separate arguments, never through the environment.
        let channel = [
            "-SourceSha",
            "0123456789abcdef0123456789abcdef01234567",
            "-Image",
            "ghcr.io/leopu00/jht:master-arthur",
            "-ExpectedImageDigest",
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ]
        .map(str::to_owned);
        let test: Vec<String> = installer_invocation(Path::new(r"C:\Temp\i.ps1"), &channel)
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(test[..install.len()], install[..]);
        assert_eq!(test[install.len()..], channel[..]);
    }

    #[test]
    fn the_runtime_dir_needs_an_absolute_local_app_data() {
        let absolute = std::env::temp_dir();
        assert_eq!(
            runtime_dir(Some(absolute.clone().into_os_string())),
            Some(absolute.join("Job Hunter Team").join("host-runtime"))
        );
        assert_eq!(runtime_dir(Some(OsString::from("relative"))), None);
        assert_eq!(runtime_dir(None), None);
    }

    #[test]
    fn a_wrapper_counts_only_with_all_three_protocol_lines() {
        let full = "param()\r\n$JHT_HOST_RUNTIME_PROTOCOL = 1\r\n$JHT_DESKTOP_CHAT_PROTOCOL = 1\r\n  $JHT_ONBOARDING_SNAPSHOT_PROTOCOL = 1\r\n";
        assert!(wrapper_has_protocols(full));
        // The game's wrapper of today: host protocol only.
        assert!(!wrapper_has_protocols("$JHT_HOST_RUNTIME_PROTOCOL = 1\n"));
        // A comment that mentions the marker is not the marker.
        assert!(!wrapper_has_protocols(
            "# $JHT_HOST_RUNTIME_PROTOCOL = 1 $JHT_DESKTOP_CHAT_PROTOCOL = 1 $JHT_ONBOARDING_SNAPSHOT_PROTOCOL = 1\n"
        ));
    }

    /// The wrapper this commit publishes is one the app accepts.
    #[test]
    fn the_published_wrapper_carries_the_three_protocols() {
        assert!(wrapper_has_protocols(include_str!("../../../scripts/jht-wrapper.ps1")));
    }

    #[test]
    fn the_manifest_must_be_install_ps1s_exactly() {
        let digests = |wrapper: &str| {
            [
                ("docker-compose.yml", Some("aa".to_owned())),
                ("jht-wrapper.ps1", Some(wrapper.to_owned())),
                ("windows-private-acl.ps1", Some("cc".to_owned())),
            ]
        };
        let no_pin = ("runtime-image", None);
        let manifest = "version=1\r\ndocker-compose.yml=aa\r\njht-wrapper.ps1=BB\r\nwindows-private-acl.ps1=cc\r\n";
        assert!(manifest_matches(manifest, &digests("bb"), no_pin.clone()));
        // A wrapper changed after the install.
        assert!(!manifest_matches(manifest, &digests("dd"), no_pin.clone()));
        // A missing file.
        let mut missing = digests("bb");
        missing[2].1 = None;
        assert!(!manifest_matches(manifest, &missing, no_pin.clone()));
        for bad in [
            "version=2\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\n",
            "version=1\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\n",
            "version=1\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\nextra=1\n",
            "version=1\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\n",
            "version=1\ndocker-compose.yml\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\n",
            // A pin line without the pin file.
            "version=1\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\nruntime-image=ee\n",
            "",
        ] {
            assert!(!manifest_matches(bad, &digests("bb"), no_pin.clone()), "{bad:?}");
        }
        // The test channel's pin: its line and its file together.
        let pinned = format!("{manifest}runtime-image=ee\r\n");
        let pin = ("runtime-image", Some("ee".to_owned()));
        assert!(manifest_matches(&pinned, &digests("bb"), pin.clone()));
        assert!(!manifest_matches(manifest, &digests("bb"), pin));
        assert!(!manifest_matches(&pinned, &digests("bb"), ("runtime-image", Some("ff".to_owned()))));
    }

    /// The layout install.ps1 writes on the Podman runtime, on disk: the
    /// compose files and the Podman selection under host-runtime, the wrapper
    /// with its helper in .local\bin; docker.exe stays under host-runtime so
    /// other programs never resolve the JHT shim from the user's PATH.
    #[test]
    fn the_podman_bundle_is_checked_file_by_file() {
        use sha2::{Digest, Sha256};
        use std::fs;
        let root = std::env::temp_dir().join(format!(
            "jht-win-bundle-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = root.join("host-runtime");
        let bin = root.join("bin");
        fs::create_dir_all(runtime.join("bin")).unwrap();
        fs::create_dir_all(&bin).unwrap();
        let wrapper = bin.join("jht.ps1");
        let files = [
            ("docker-compose.yml", runtime.join("docker-compose.yml"), "services: {}\n"),
            ("docker-compose.podman.yml", runtime.join("docker-compose.podman.yml"), "services: {}\n#podman\n"),
            ("container-runtime", runtime.join("container-runtime"), "podman\n"),
            ("podman-machine", runtime.join("podman-machine"), "jht-podman\n"),
            ("jht-container.service", runtime.join("jht-container.service"), "[Unit]\n"),
            ("jht-wrapper.ps1", wrapper.clone(), "$JHT_HOST_RUNTIME_PROTOCOL = 1\n"),
            ("windows-private-acl.ps1", bin.join("windows-private-acl.ps1"), "param()\n"),
            ("docker.exe", runtime.join("bin").join("docker.exe"), "MZ shim"),
        ];
        let digest = |path: &Path| format!("{:x}", Sha256::digest(fs::read(path).unwrap()));
        let mut manifest = String::from("version=1\n");
        for (key, path, content) in &files {
            fs::write(path, content).unwrap();
            manifest.push_str(&format!("{key}={}\n", digest(path)));
        }
        let manifest_path = runtime.join(".runtime-integrity");
        fs::write(&manifest_path, &manifest).unwrap();
        assert!(wrapper_bundle_valid(&wrapper, &runtime));

        // Each file changed after the install is refused.
        for (key, path, content) in &files {
            fs::write(path, format!("{content}changed")).unwrap();
            assert!(!wrapper_bundle_valid(&wrapper, &runtime), "{key}");
            fs::write(path, content).unwrap();
        }
        assert!(wrapper_bundle_valid(&wrapper, &runtime));

        // The test channel's image pin counts only with its manifest line.
        let pin = runtime.join("runtime-image");
        fs::write(&pin, "ghcr.io/leopu00/jht@sha256:aa\n").unwrap();
        assert!(!wrapper_bundle_valid(&wrapper, &runtime));
        fs::write(&manifest_path, format!("{manifest}runtime-image={}\n", digest(&pin))).unwrap();
        assert!(wrapper_bundle_valid(&wrapper, &runtime));
        fs::remove_file(&pin).unwrap();
        assert!(!wrapper_bundle_valid(&wrapper, &runtime));
        fs::write(&manifest_path, &manifest).unwrap();

        // A bundle that selects another engine is not this bundle, even with
        // its manifest line rewritten to match.
        let selection = runtime.join("container-runtime");
        let podman_line = format!("container-runtime={}", digest(&selection));
        fs::write(&selection, "docker\n").unwrap();
        fs::write(
            &manifest_path,
            manifest.replace(&podman_line, &format!("container-runtime={}", digest(&selection))),
        )
        .unwrap();
        assert!(!wrapper_bundle_valid(&wrapper, &runtime));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn wsl_is_ready_only_when_it_answers_with_success() {
        let answer = |code| {
            Ok(ProcessResult {
                code,
                stdout: Vec::new(),
            })
        };
        assert_eq!(wsl_state(answer(0)), Ok(()));
        for failed in [
            Err("process_start_failed"),
            Err("process_timeout"),
            answer(1),
            answer(-1),
        ] {
            assert_eq!(wsl_state(failed), Err("wsl_not_ready"));
        }
        let wsl = wsl_path(Some(OsString::from(r"D:\Win")));
        assert!(wsl.starts_with(r"D:\Win"));
        assert!(wsl.to_string_lossy().ends_with("wsl.exe"));
    }

    #[test]
    fn the_powershell_exit_codes_name_what_failed() {
        assert_eq!(exit_failure(20), Some("wsl_not_ready"));
        assert_eq!(exit_failure(21), Some("podman_missing"));
        assert_eq!(exit_failure(22), Some("podman_start_failed"));
        assert_eq!(exit_failure(23), Some("podman_network_unready"));
        assert_eq!(exit_failure(24), Some("podman_version_mismatch"));
        assert_eq!(exit_failure(25), Some("podman_other_user"));
        for generic in [0, 1, 2, 19, 26, 78, -1] {
            assert_eq!(exit_failure(generic), None, "{generic}");
        }
    }

    #[test]
    fn install_ps1s_end_is_told_by_its_exit_code() {
        assert_eq!(installer_outcome(Ok(0)), Ok(()));
        assert_eq!(installer_outcome(Ok(20)), Err("wsl_not_ready"));
        assert_eq!(installer_outcome(Ok(21)), Err("podman_missing"));
        assert_eq!(installer_outcome(Ok(22)), Err("podman_start_failed"));
        // the network script's own code, and a Podman of another version: never «check your internet»
        assert_eq!(installer_outcome(Ok(23)), Err("podman_network_unready"));
        assert_eq!(installer_outcome(Ok(24)), Err("podman_version_mismatch"));
        // Podman in another Windows user's profile: its own code, never «check your internet»
        assert_eq!(installer_outcome(Ok(25)), Err("podman_other_user"));
        assert_eq!(installer_outcome(Ok(26)), Err("runtime_install_failed"));
        assert_eq!(installer_outcome(Ok(1)), Err("runtime_install_failed"));
        assert_eq!(installer_outcome(Err("process_timeout")), Err("timeout"));
        assert_eq!(installer_outcome(Err("process_start_failed")), Err("runtime_install_failed"));
    }

    #[test]
    fn only_install_ps1s_own_phase_lines_are_shown() {
        let ids: Vec<&str> = INSTALL_PHASES.iter().map(|(id, _)| *id).collect();
        assert_eq!(
            ids,
            [
                "wsl_check",
                "podman_install",
                "podman_machine_init",
                "podman_machine_start",
                "runtime_download",
                "image_pull",
                "team_restart"
            ]
        );
        assert_eq!(phase_message("JHT_PHASE wsl_check"), Some("ui_phase_wsl_check"));
        assert_eq!(phase_message("JHT_PHASE image_pull\r\n"), Some("ui_phase_image_pull"));
        assert_eq!(phase_message("JHT_PHASE team_restart\r\n"), INSTALL_PHASES.last().map(|(_, m)| *m));
        for other in [
            "",
            "JHT_PHASE",
            "JHT_PHASE ",
            "JHT_PHASE unknown",
            "JHT_PHASE wsl_check extra",
            " JHT_PHASE wsl_check",
            "jht_phase wsl_check",
            "Installing Podman...",
        ] {
            assert_eq!(phase_message(other), None, "{other:?}");
        }
    }

    /// The ids the PowerShell side prints, one by one: a phase renamed on
    /// one side only would never show, and one the app does not know would
    /// be dropped.
    #[test]
    fn the_phase_ids_are_the_ones_the_powershell_side_prints() {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripts");
        let printed: std::collections::BTreeSet<String> = ["install.ps1", "enable-podman-windows-runtime.ps1"]
            .iter()
            .map(|name| std::fs::read_to_string(format!("{root}/{name}")).unwrap())
            .flat_map(|source| {
                source
                    .lines()
                    .filter_map(|line| line.trim().strip_prefix("Write-JhtPhase "))
                    .map(|id| id.trim().to_owned())
                    .collect::<Vec<_>>()
            })
            .collect();
        let known: std::collections::BTreeSet<String> =
            INSTALL_PHASES.iter().map(|(id, _)| (*id).to_owned()).collect();
        assert_eq!(printed, known);
    }

    #[test]
    fn only_install_ps1s_own_notice_lines_are_kept() {
        assert_eq!(
            notice_message("JHT_NOTICE windows10_unsupported\r\n"),
            Some("ui_notice_windows10_unsupported")
        );
        assert!(is_install_notice("ui_notice_windows10_unsupported"));
        assert!(!is_install_notice("ui_phase_wsl_check"));
        for other in [
            "",
            "JHT_NOTICE",
            "JHT_NOTICE unknown",
            "JHT_NOTICE windows10_unsupported extra",
            " JHT_NOTICE windows10_unsupported",
            "JHT_PHASE windows10_unsupported",
            "  ! Podman no longer supports Windows 10",
        ] {
            assert_eq!(notice_message(other), None, "{other:?}");
        }
        // A notice is never a phase, and a phase never a notice.
        for (_, phase) in INSTALL_PHASES {
            assert!(!is_install_notice(phase), "{phase}");
        }
    }

    /// The notice ids install.ps1 prints are exactly the ones the app keeps.
    #[test]
    fn the_notice_ids_are_the_ones_install_ps1_prints() {
        let source = include_str!("../../../scripts/install.ps1");
        let printed: std::collections::BTreeSet<String> = source
            .lines()
            .filter_map(|line| line.trim().strip_prefix("Write-JhtNotice "))
            .map(|id| id.trim().to_owned())
            .collect();
        assert_eq!(printed, ["windows10_unsupported"].into_iter().map(str::to_owned).collect());
    }

    #[test]
    fn the_compiled_install_ps1_digest_is_the_release_source() {
        use sha2::{Digest, Sha256};
        let source = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripts/install.ps1")).unwrap();
        assert_eq!(INSTALL_PS1_SHA256.trim(), format!("{:x}", Sha256::digest(&source)));
        let public = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../web/public/install.ps1")).unwrap();
        assert_eq!(public, source, "web/public/install.ps1 is what jobhunterteam.ai serves");
    }

    #[test]
    fn a_wrapper_can_remove_jht_only_with_its_protocol_line() {
        assert!(wrapper_supports_uninstall("param()\r\n$JHT_UNINSTALL_PROTOCOL = 1\r\n"));
        assert!(!wrapper_supports_uninstall("# $JHT_UNINSTALL_PROTOCOL = 1\n"));
        assert!(!wrapper_supports_uninstall("$JHT_HOST_RUNTIME_PROTOCOL = 1\n"));
    }

    /// The wrapper this commit publishes removes JHT with the app's protocol,
    /// and prints exactly the phases and leftovers the app knows: a phase
    /// renamed on one side only would never show, and an unknown leftover
    /// would turn into "everything is left".
    #[test]
    fn the_published_wrapper_prints_the_removal_s_phases_and_leftovers() {
        let source = include_str!("../../../scripts/jht-wrapper.ps1");
        assert!(wrapper_supports_uninstall(source));
        let ids = |call: &str| -> std::collections::BTreeSet<String> {
            let mut ids = std::collections::BTreeSet::new();
            for (at, _) in source.match_indices(call) {
                let rest = source[at + call.len()..].trim_start_matches(' ');
                if rest.starts_with('{') {
                    continue; // the function's own definition
                }
                let id: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_').collect();
                assert!(!id.is_empty(), "{call} with an id the test cannot read: {:?}", &rest[..rest.len().min(30)]);
                ids.insert(id);
            }
            ids
        };
        let phases: std::collections::BTreeSet<String> =
            UNINSTALL_PHASES.iter().map(|(id, _)| (*id).to_owned()).collect();
        let items: std::collections::BTreeSet<String> = UNINSTALL_ITEMS.iter().map(|id| (*id).to_owned()).collect();
        assert_eq!(ids("Write-JhtUninstallPhase "), phases);
        assert_eq!(ids("Write-JhtUninstallLeft "), items);
    }

    #[test]
    fn only_the_removal_s_own_lines_are_read() {
        assert_eq!(uninstall_line("JHT_PHASE uninstall_machine\r\n"), Some(UninstallLine::Phase("ui_uninstall_machine")));
        assert_eq!(uninstall_line("JHT_PHASE uninstall_commands"), Some(UninstallLine::Phase("ui_uninstall_commands")));
        assert_eq!(uninstall_line("JHT_LEFT runtime"), Some(UninstallLine::Left("runtime")));
        for other in ["", "JHT_PHASE image_pull", "JHT_LEFT data", "JHT_LEFT", " JHT_LEFT machine", "Removing..."] {
            assert_eq!(uninstall_line(other), None, "{other:?}");
        }
    }

    #[test]
    fn the_removal_s_end_is_told_by_its_exit_code() {
        assert_eq!(uninstall_outcome(Ok(0), vec!["machine"]), Ok((true, vec![])));
        assert_eq!(
            uninstall_outcome(Ok(24), vec!["commands", "machine", "machine"]),
            Ok((false, vec!["machine", "commands"]))
        );
        // Incomplete, and it does not say what is left: all of it, never "done".
        assert_eq!(uninstall_outcome(Ok(24), vec![]), Ok((false, UNINSTALL_ITEMS.to_vec())));
        assert_eq!(uninstall_outcome(Ok(2), vec![]), Err("uninstall_failed"));
        assert_eq!(uninstall_outcome(Ok(1), vec![]), Err("uninstall_failed"));
        assert_eq!(uninstall_outcome(Err("process_timeout"), vec![]), Err("timeout"));
        assert_eq!(uninstall_outcome(Err("process_start_failed"), vec![]), Err("uninstall_failed"));
    }
}

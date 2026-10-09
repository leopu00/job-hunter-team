//! The mailbox of the team, from the desktop: its state, and saving a new app
//! password without a terminal.
//!
//! The broker keeps the password; the agents never read it. The app speaks to
//! it through the host's `jht` (the attested wrapper here, SSH on a VPS):
//! - `jht mail status`: two JSON lines, `secrets status` then `mailbox show`.
//!   While a rotation is pending (the old password was readable by the
//!   agents), `mailbox show` lists it in `rotation_pending`. Sending keeps
//!   working; the app shows a warning until a new password is saved.
//! - `jht mail setup --password-stdin --user U --dedicated|--not-dedicated`:
//!   the password is the first line of stdin, and ONLY stdin. It never goes
//!   in argv (here or in the SSH command line), a file, a log or an error.
//!   The answer is one JSON line.

use crate::account_scope::{AccountScope, AccountScopeState};
use crate::onboarding::run_host_jht;
use crate::runtime_host::{validate_host, ProcessResult, ValidatedHost};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::State;
use zeroize::{Zeroize, Zeroizing};

const STATUS_TIMEOUT: Duration = Duration::from_secs(25);
const SETUP_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_ADDRESS_LEN: usize = 254;
const MAX_HOST_LEN: usize = 253;
const MAX_PASSWORD_LEN: usize = 1024;

#[derive(Debug, Serialize)]
pub(crate) struct MailError {
    code: &'static str,
}

fn failure(code: &'static str) -> MailError {
    MailError { code }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailStatus {
    /// A password is saved in the broker.
    configured: bool,
    /// Only when the broker says it, and only if it looks like an address.
    address: Option<String>,
    /// "allowlist" (only allowed senders) or "whole_mailbox" (a dedicated box).
    admission: Option<&'static str>,
    /// The saved password was readable by the agents: a new one is due.
    rotation_pending: bool,
}

#[derive(Deserialize)]
struct StatusLine {
    ok: bool,
    #[serde(default)]
    secrets: Option<std::collections::BTreeMap<String, String>>,
    #[serde(default)]
    admission: Option<String>,
    #[serde(default)]
    rotation_pending: Option<Vec<String>>,
    #[serde(default)]
    address: Option<String>,
}

fn valid_address(address: &str) -> bool {
    let Some((local, domain)) = address.split_once('@') else {
        return false;
    };
    address.len() <= MAX_ADDRESS_LEN
        && !local.is_empty()
        && !domain.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && local
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._%+-'".contains(&byte))
        && domain
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
}

fn valid_host_name(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= MAX_HOST_LEN
        && !host.starts_with(['.', '-'])
        && host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-')
}

/// `jht mail status`: the two lines, in any order. Anything missing or not
/// `ok` is `mail_unavailable`: no broker, an old broker, a broker that is down.
fn parse_status(result: Result<ProcessResult, &'static str>) -> Result<MailStatus, &'static str> {
    let output = match result {
        Ok(output) if output.success() => output,
        Err("process_timeout") => return Err("timeout"),
        _ => return Err("mail_unavailable"),
    };
    let text = std::str::from_utf8(&output.stdout).map_err(|_| "mail_unavailable")?;
    let mut configured = None;
    let mut mailbox = None;
    for line in text
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with('{'))
    {
        let Ok(parsed) = serde_json::from_str::<StatusLine>(line) else {
            continue;
        };
        if !parsed.ok {
            return Err("mail_unavailable");
        }
        if let Some(secrets) = &parsed.secrets {
            configured = Some(secrets.get("email_monitor").map(String::as_str) == Some("present"));
        } else if parsed.admission.is_some() || parsed.rotation_pending.is_some() {
            mailbox = Some(parsed);
        }
    }
    let configured = configured.ok_or("mail_unavailable")?;
    let mailbox = mailbox.ok_or("mail_unavailable")?;
    Ok(MailStatus {
        configured,
        address: mailbox.address.filter(|address| valid_address(address)),
        admission: match mailbox.admission.as_deref() {
            Some("allowlist") => Some("allowlist"),
            Some("whole_mailbox") => Some("whole_mailbox"),
            _ => None,
        },
        rotation_pending: mailbox
            .rotation_pending
            .is_some_and(|pending| !pending.is_empty()),
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct MailPasswordRequest {
    address: String,
    /// The answer to «is this mailbox dedicated to forwarded job alerts?»:
    /// yes reads the whole box, no only the allowed senders. Required.
    dedicated: bool,
    #[serde(default)]
    imap_host: Option<String>,
    #[serde(default)]
    smtp_host: Option<String>,
    password: String,
}

impl Drop for MailPasswordRequest {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}

/// The command and its stdin. The password is only in `stdin`.
struct SetupInvocation {
    args: Vec<String>,
    stdin: Zeroizing<Vec<u8>>,
}

fn setup_invocation(request: &MailPasswordRequest) -> Result<SetupInvocation, &'static str> {
    let address = request.address.trim();
    if !valid_address(address) {
        return Err("mail_address_invalid");
    }
    let password = request.password.as_str();
    if password.is_empty() {
        return Err("mail_password_missing");
    }
    // The command reads one line: a password with a line break would be
    // saved cut short, so it is refused instead.
    if password.len() > MAX_PASSWORD_LEN || password.contains(['\n', '\r', '\0']) {
        return Err("mail_password_invalid");
    }
    let mut args = vec![
        "mail".to_owned(),
        "setup".to_owned(),
        "--password-stdin".to_owned(),
        "--user".to_owned(),
        address.to_owned(),
        if request.dedicated {
            "--dedicated"
        } else {
            "--not-dedicated"
        }
        .to_owned(),
    ];
    for (flag, host) in [
        ("--imap-host", &request.imap_host),
        ("--smtp-host", &request.smtp_host),
    ] {
        if let Some(host) = host
            .as_deref()
            .map(str::trim)
            .filter(|host| !host.is_empty())
        {
            if !valid_host_name(host) {
                return Err("mail_host_invalid");
            }
            args.extend([flag.to_owned(), host.to_owned()]);
        }
    }
    let mut stdin = Zeroizing::new(Vec::with_capacity(password.len() + 1));
    stdin.extend_from_slice(password.as_bytes());
    stdin.push(b'\n');
    Ok(SetupInvocation { args, stdin })
}

#[derive(Deserialize)]
struct SetupLine {
    ok: bool,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MailSaved {
    saved: bool,
}

/// The broker's answer to the setup. Its reasons become the catalog's codes;
/// no output at all means the broker could not be reached.
fn parse_setup(result: Result<ProcessResult, &'static str>) -> Result<MailSaved, &'static str> {
    let output = match result {
        Ok(output) => output,
        Err("process_timeout") => return Err("timeout"),
        Err(_) => return Err("mail_unavailable"),
    };
    let line = std::str::from_utf8(&output.stdout)
        .ok()
        .and_then(|text| {
            text.lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .last()
        })
        .and_then(|line| serde_json::from_str::<SetupLine>(line).ok());
    match line {
        None => Err("mail_unavailable"),
        Some(line) if line.ok && output.success() => Ok(MailSaved { saved: true }),
        Some(line) => Err(match line.reason.as_deref() {
            Some("password_not_rotated") => "password_not_rotated",
            Some("secret_user_missing") => "mail_address_invalid",
            Some("secret_password_missing") => "mail_password_missing",
            Some("password_not_utf8") => "mail_password_invalid",
            _ => "mail_save_failed",
        }),
    }
}

fn active_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
) -> Result<ValidatedHost, &'static str> {
    let host = crate::direct_chat::load_persisted_host(app, scope)?;
    validate_host(app, &host)
}

#[tauri::command]
pub(crate) async fn mail_status(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<MailStatus, MailError> {
    let scope = scopes.active().map_err(failure)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = active_host(&app, &scope)?;
        parse_status(run_host_jht(
            &app,
            &scope,
            &host,
            &["mail", "status"],
            None,
            STATUS_TIMEOUT,
        ))
    })
    .await
    .unwrap_or(Err("mail_unavailable"))
    .map_err(failure)
}

#[tauri::command]
pub(crate) async fn mail_save_password(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    request: MailPasswordRequest,
) -> Result<MailSaved, MailError> {
    let scope = scopes.active().map_err(failure)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut request = request;
        let invocation = setup_invocation(&request);
        request.password.zeroize();
        let invocation = invocation?;
        let host = active_host(&app, &scope)?;
        let args: Vec<&str> = invocation.args.iter().map(String::as_str).collect();
        parse_setup(run_host_jht(
            &app,
            &scope,
            &host,
            &args,
            Some(&invocation.stdin),
            SETUP_TIMEOUT,
        ))
    })
    .await
    .unwrap_or(Err("mail_save_failed"))
    .map_err(failure)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onboarding::remote_jht_command;

    const PASSWORD: &str = "abcd efgh ijkl mnop";

    fn output(code: i32, stdout: &str) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult {
            code,
            stdout: stdout.as_bytes().to_vec(),
        })
    }

    fn request(json: &str) -> MailPasswordRequest {
        serde_json::from_str(json).unwrap()
    }

    fn valid_request() -> MailPasswordRequest {
        request(&format!(
            r#"{{"address": "jobs.alerts@example.com", "dedicated": true, "imapHost": "imap.example.com", "password": "{PASSWORD}"}}"#
        ))
    }

    #[test]
    fn the_password_goes_only_on_stdin_never_in_the_command() {
        let invocation = setup_invocation(&valid_request()).unwrap();
        assert_eq!(
            invocation.args,
            [
                "mail",
                "setup",
                "--password-stdin",
                "--user",
                "jobs.alerts@example.com",
                "--dedicated",
                "--imap-host",
                "imap.example.com"
            ]
        );
        assert_eq!(
            invocation.stdin.as_slice(),
            format!("{PASSWORD}\n").as_bytes()
        );
        for arg in &invocation.args {
            assert!(!arg.contains(PASSWORD), "{arg}");
            assert!(!arg.contains("abcd"), "{arg}");
        }
        // On a VPS the same arguments become the SSH command line.
        let args: Vec<&str> = invocation.args.iter().map(String::as_str).collect();
        let remote = remote_jht_command(&args);
        assert!(!remote.contains("abcd"), "{remote}");
        assert!(remote.ends_with(
            "'mail' 'setup' '--password-stdin' '--user' 'jobs.alerts@example.com' '--dedicated' '--imap-host' 'imap.example.com'"
        ));
    }

    /// The real process boundary: a program that records its argv and its
    /// stdin. The test turns red if the password is ever passed as an argument.
    #[cfg(unix)]
    #[test]
    fn a_real_process_gets_the_password_on_stdin_and_not_in_argv() {
        let dir = std::env::temp_dir().join(format!(
            "jht-mail-stdin-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let argv_file = dir.join("argv");
        let stdin_file = dir.join("stdin");
        let invocation = setup_invocation(&valid_request()).unwrap();
        let mut args = vec![
            "-c".to_owned(),
            format!(
                r#"printf '%s\n' "$@" > '{}'; cat > '{}'; printf '%s\n' '{{"ok": true, "secret": "email_monitor", "state": "present"}}'"#,
                argv_file.display(),
                stdin_file.display()
            ),
            "fake-jht".to_owned(),
        ];
        args.extend(invocation.args.iter().cloned());
        let result = crate::runtime_host::run_program(
            "sh",
            &args,
            Some(&invocation.stdin),
            Duration::from_secs(10),
        );
        assert_eq!(parse_setup(result), Ok(MailSaved { saved: true }));
        let argv = std::fs::read_to_string(&argv_file).unwrap();
        assert!(argv.contains("--password-stdin"));
        assert!(!argv.contains("abcd"), "the password reached argv: {argv}");
        assert_eq!(
            std::fs::read_to_string(&stdin_file).unwrap(),
            format!("{PASSWORD}\n")
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    /// The VPS path: the SSH command line runs in the remote shell. Here the
    /// same line runs in `sh` with a fake `jht` (isolated PATH and HOME, so no
    /// real jht of this computer can run): the arguments arrive intact and
    /// quoted, the password only on stdin.
    #[cfg(unix)]
    #[test]
    fn the_remote_command_line_quotes_the_arguments_and_leaves_the_password_on_stdin() {
        use std::{io::Write, os::unix::fs::PermissionsExt, process::Stdio};
        let home = std::env::temp_dir().join(format!(
            "jht-mail-remote-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let bin = home.join(".local/bin");
        std::fs::create_dir_all(&bin).unwrap();
        let fake = bin.join("jht");
        std::fs::write(
            &fake,
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOME/argv\"\ncat > \"$HOME/stdin\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o700)).unwrap();

        // An apostrophe is a valid address character: it must survive the quoting.
        let mut request = valid_request();
        request.address = "o'brien@example.com".to_owned();
        let invocation = setup_invocation(&request).unwrap();
        let args: Vec<&str> = invocation.args.iter().map(String::as_str).collect();
        let remote = remote_jht_command(&args);
        assert!(!remote.contains("abcd"), "{remote}");
        let mut child = std::process::Command::new("/bin/sh")
            .arg("-c")
            .arg(&remote)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("HOME", &home)
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&invocation.stdin)
            .unwrap();
        assert!(child.wait().unwrap().success());
        let argv = std::fs::read_to_string(home.join("argv")).unwrap();
        assert_eq!(
            argv.lines().collect::<Vec<_>>(),
            [
                "mail",
                "setup",
                "--password-stdin",
                "--user",
                "o'brien@example.com",
                "--dedicated",
                "--imap-host",
                "imap.example.com"
            ]
        );
        assert_eq!(
            std::fs::read_to_string(home.join("stdin")).unwrap(),
            format!("{PASSWORD}\n")
        );
        std::fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn the_form_is_checked_before_anything_runs() {
        let check = |json: &str| setup_invocation(&request(json)).err();
        assert_eq!(
            check(r#"{"address": "no-at-sign", "dedicated": false, "password": "x"}"#),
            Some("mail_address_invalid")
        );
        assert_eq!(
            check(r#"{"address": "a@example.com'; rm -rf ~", "dedicated": false, "password": "x"}"#),
            Some("mail_address_invalid")
        );
        assert_eq!(
            check(r#"{"address": "a@example.com", "dedicated": false, "password": ""}"#),
            Some("mail_password_missing")
        );
        assert_eq!(
            check(r#"{"address": "a@example.com", "dedicated": false, "password": "two\nlines"}"#),
            Some("mail_password_invalid")
        );
        assert_eq!(
            check(
                r#"{"address": "a@example.com", "dedicated": false, "smtpHost": "smtp.example.com; id", "password": "x"}"#
            ),
            Some("mail_host_invalid")
        );
        // The dedicated choice has no hidden default: a request without it
        // does not even reach the command.
        assert!(serde_json::from_str::<MailPasswordRequest>(
            r#"{"address": "a@example.com", "password": "x"}"#
        )
        .is_err());
        let not_dedicated = setup_invocation(&request(
            r#"{"address": "a@example.com", "dedicated": false, "imapHost": " ", "password": "x"}"#,
        ))
        .unwrap();
        assert_eq!(
            not_dedicated.args,
            [
                "mail",
                "setup",
                "--password-stdin",
                "--user",
                "a@example.com",
                "--not-dedicated"
            ]
        );
    }

    #[test]
    fn the_brokers_answers_become_the_catalogs_codes() {
        let saved = r#"{"ok": true, "secret": "email_monitor", "state": "present", "address": "a@example.com", "admission": "allowlist"}"#;
        assert_eq!(parse_setup(output(0, saved)), Ok(MailSaved { saved: true }));
        for (reason, code) in [
            ("password_not_rotated", "password_not_rotated"),
            ("secret_user_missing", "mail_address_invalid"),
            ("secret_password_missing", "mail_password_missing"),
            ("password_not_utf8", "mail_password_invalid"),
            ("setup_argument_missing", "mail_save_failed"),
            ("something_new", "mail_save_failed"),
        ] {
            let line = format!(r#"{{"ok": false, "reason": "{reason}"}}"#);
            assert_eq!(parse_setup(output(1, &line)), Err(code), "{reason}");
        }
        // No broker, or a broker that is down: nothing on stdout.
        assert_eq!(parse_setup(output(1, "")), Err("mail_unavailable"));
        assert_eq!(parse_setup(Err("ssh_unavailable")), Err("mail_unavailable"));
        assert_eq!(parse_setup(Err("process_timeout")), Err("timeout"));
        // An "ok" line with a failing exit is not a success.
        assert_eq!(parse_setup(output(1, saved)), Err("mail_save_failed"));
    }

    #[test]
    fn the_status_says_whether_a_rotation_is_pending() {
        let secrets = r#"{"ok": true, "secrets": {"email_monitor": "present", "telegram_bot": "absent"}, "warning": "english text"}"#;
        let pending = r#"{"ok": true, "admission": "allowlist", "allow_addresses": [], "allow_domains": [], "imported_to_confirm": [], "rotation_pending": ["email_monitor"], "warning": "english text"}"#;
        let status = parse_status(output(0, &format!("{secrets}\n{pending}\n"))).unwrap();
        assert_eq!(
            status,
            MailStatus {
                configured: true,
                address: None,
                admission: Some("allowlist"),
                rotation_pending: true,
            }
        );
        let rotated = pending
            .replace(r#"["email_monitor"]"#, "[]")
            .replace(r#""allowlist""#, r#""whole_mailbox""#);
        let with_address = rotated.replace(
            r#""ok": true,"#,
            r#""ok": true, "address": "a@example.com","#,
        );
        let status = parse_status(output(0, &format!("{secrets}\n{with_address}"))).unwrap();
        assert_eq!(status.rotation_pending, false);
        assert_eq!(status.admission, Some("whole_mailbox"));
        assert_eq!(status.address.as_deref(), Some("a@example.com"));

        let absent = secrets.replace(
            r#""email_monitor": "present""#,
            r#""email_monitor": "absent""#,
        );
        assert!(
            !parse_status(output(0, &format!("{absent}\n{rotated}")))
                .unwrap()
                .configured
        );

        // An old broker without rotation_pending: no rotation, not an error.
        let old = r#"{"ok": true, "admission": "allowlist"}"#;
        assert!(
            !parse_status(output(0, &format!("{secrets}\n{old}")))
                .unwrap()
                .rotation_pending
        );

        // Missing data is "unavailable", never a guessed state.
        for bad in [
            "",
            secrets,
            pending,
            "not json",
            r#"{"ok": false, "reason": "broker_unavailable"}"#,
        ] {
            assert_eq!(
                parse_status(output(0, bad)),
                Err("mail_unavailable"),
                "{bad}"
            );
        }
        assert_eq!(
            parse_status(output(1, &format!("{secrets}\n{pending}"))),
            Err("mail_unavailable")
        );
        assert_eq!(parse_status(Err("process_timeout")), Err("timeout"));
        let weird_address = with_address.replace("a@example.com", "not an address");
        assert_eq!(
            parse_status(output(0, &format!("{secrets}\n{weird_address}")))
                .unwrap()
                .address,
            None
        );
    }
}

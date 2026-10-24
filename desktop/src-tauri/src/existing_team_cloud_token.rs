//! The website sync token of an existing team's box, looked at and renewed from the app.
//!
//! A sync token with an expiry, once expired, cuts the box off the website in silence (16 days on
//! 23/10). The app says so and renews it, so the user never opens a terminal on the box.
//!
//! One typed command, one fixed script in the pinned container (`shared/skills/cloud_token.py`),
//! never the generic Python runner. Before any network call the request is checked here:
//! - it comes from the `main` window only;
//! - `check` (how long the current token lasts) carries nothing and writes nothing;
//! - `apply` carries the new token and the connection the page was opened on (`connectionKey`:
//!   another one is `existing_team_runtime_target_changed`), and needs the team connected IN FULL
//!   in this session of the app (`cloud_token_read_only` otherwise);
//! - the token has the shape of a sync token, nothing else.
//!
//! The token is a secret: it goes on stdin as one JSON line, never in the remote command, in no
//! process list and in no SSH command line; the request has no `Debug`, so no log can print it.
//! The script verifies it with the website, keeps it only if it belongs to the account the box is
//! paired with, and never prints it.

use crate::{
    account_scope::AccountScopeState,
    direct_chat,
    existing_team_judgement::{failure, full_connection, reply},
    existing_team_runtime::{command, connection_key, selected, ActivatedTarget, RuntimeTarget},
    runtime_host::{run_ssh_command, ProcessResult},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

const SCRIPT: &str = "/app/shared/skills/cloud_token.py";
/// The script pings the website for at most 8 s; the rest is the SSH round trip.
const RUN_TIMEOUT: Duration = Duration::from_secs(30);

/// The page where the user mints a new sync token: fixed, the renderer never names a URL.
const SETTINGS_URL: &str = "https://jobhunterteam.ai/settings/cloud-sync";

/// `jht_sync_` and 16 to 128 characters of the base64url alphabet, as the website mints them.
fn valid_token(token: &str) -> bool {
    token.strip_prefix("jht_sync_").is_some_and(|rest| {
        (16..=128).contains(&rest.len()) && rest.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}

// No `Debug`: the token must not be printable by a log or a panic message.
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum CloudTokenRequest {
    Check {},
    Apply {
        token: String,
        #[serde(rename = "connectionKey")]
        connection_key: String,
    },
}

impl CloudTokenRequest {
    /// Everything that can be refused without the VPS.
    fn check(&self) -> Result<(), &'static str> {
        match self {
            Self::Apply { token, .. } if !valid_token(token) => Err("token_malformed"),
            _ => Ok(()),
        }
    }

    fn argv(&self) -> &'static str {
        match self {
            Self::Check {} => "'check'",
            Self::Apply { .. } => "'apply'",
        }
    }

    /// The token as the script reads it: one JSON line on stdin.
    fn stdin(&self) -> Option<Vec<u8>> {
        match self {
            Self::Check {} => None,
            Self::Apply { token, .. } => {
                let mut line = serde_json::to_vec(&json!({ "token": token })).unwrap_or_default();
                line.push(b'\n');
                Some(line)
            }
        }
    }
}

/// The remote command: the pinned container's checks (`command`), then the fixed script.
fn cloud_token_command(target: &RuntimeTarget, request: &CloudTokenRequest) -> Result<String, &'static str> {
    command(target, &format!("exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 {SCRIPT} {}", request.argv()))
}

/// The whole decision, with the app-bound steps injected (the order the tests drive).
fn cloud_token_with(
    request: Value,
    window_is_main: bool,
    current_key: impl FnOnce() -> Result<String, &'static str>,
    full: impl FnOnce() -> Result<(), &'static str>,
    run: impl FnOnce(&CloudTokenRequest) -> Result<ProcessResult, &'static str>,
) -> Value {
    if !window_is_main {
        return failure("cloud_token_window_refused");
    }
    let Ok(request) = serde_json::from_value::<CloudTokenRequest>(request) else {
        return failure("cloud_token_request_invalid");
    };
    if let Err(code) = request.check() {
        return failure(code);
    }
    let key = match current_key() {
        Ok(key) => key,
        Err(code) => return failure(code),
    };
    if let CloudTokenRequest::Apply { connection_key, .. } = &request {
        if *connection_key != key {
            return failure("existing_team_runtime_target_changed");
        }
        if full().is_err() {
            return failure("cloud_token_read_only");
        }
    }
    reply(run(&request))
}

#[tauri::command]
pub(crate) async fn existing_team_cloud_token(
    app: tauri::AppHandle,
    window: tauri::Window,
    scopes: State<'_, AccountScopeState>,
    request: Value,
) -> Result<Value, String> {
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(failure("account_scope_unavailable")),
    };
    let window_is_main = window.label() == "main";
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state.lock_expected(&worker_expected).map_err(|_| "account_scope_changed")?;
        let scope = &worker_expected;
        let target: std::cell::RefCell<Option<ActivatedTarget>> = std::cell::RefCell::new(None);
        let validated = std::cell::RefCell::new(None);
        Ok(cloud_token_with(
            request,
            window_is_main,
            || {
                let host = direct_chat::load_persisted_host(&app, scope)?;
                let checked = crate::runtime_host::validate_host_for_scope(&app, &host, scope)?;
                let found = selected(&app, scope, &host)?.ok_or("existing_team_runtime_required")?;
                let key = connection_key(scope, &found);
                *target.borrow_mut() = Some(found);
                *validated.borrow_mut() = Some(checked);
                Ok(key)
            },
            || match target.borrow().as_ref() {
                Some(found) => full_connection(scope, found),
                None => Err("existing_team_unavailable"),
            },
            |request| {
                let target = target.borrow();
                let validated = validated.borrow();
                let (Some(target), Some(validated)) = (target.as_ref(), validated.as_ref()) else {
                    return Err("existing_team_unavailable");
                };
                let remote = cloud_token_command(&target.runtime, request)?;
                run_ssh_command(validated, &remote, request.stdin().as_deref(), RUN_TIMEOUT, None)
            },
        ))
    })
    .await
    .unwrap_or_else(|_| Err("existing_team_unavailable"));
    if scopes.lock_expected(&expected).is_err() {
        return Ok(failure("account_scope_changed"));
    }
    Ok(result.unwrap_or_else(failure))
}

/// Opens the website's token page in the user's default browser. Only the main window may ask,
/// and the address is the constant above: the call carries nothing.
fn open_settings_with(window_is_main: bool, open: impl FnOnce(&str) -> std::io::Result<()>) -> Value {
    if !window_is_main {
        return failure("cloud_token_window_refused");
    }
    match open(SETTINGS_URL) {
        Ok(()) => json!({ "ok": true }),
        Err(_) => failure("browser_failed"),
    }
}

#[tauri::command]
pub(crate) fn existing_team_cloud_token_open_site(window: tauri::Window) -> Value {
    open_settings_with(window.label() == "main", |url| open::that_detached(url))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const KEY: &str = "a1b2";
    const TOKEN: &str = "jht_sync_SENTINELLA-token-privato_7f3a9c";

    fn target() -> RuntimeTarget {
        serde_json::from_value(json!({
            "container_id": "a".repeat(64),
            "image_id": format!("sha256:{}", "b".repeat(64)),
            "platform_image_id": format!("sha256:{}", "c".repeat(64)),
            "oci_revision": "d".repeat(40),
            "digest": format!("sha256:{}", "e".repeat(64)),
            "os": "linux",
            "architecture": "amd64",
        }))
        .unwrap()
    }

    fn apply() -> Value {
        json!({"op": "apply", "token": TOKEN, "connectionKey": KEY})
    }

    fn done(stdout: &str) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult { code: 0, stdout: stdout.as_bytes().to_vec() })
    }

    fn drive(request: Value, window: bool, full: Result<(), &'static str>, ran: &Cell<u32>) -> Value {
        cloud_token_with(request, window, || Ok(KEY.to_owned()), || full, |_| {
            ran.set(ran.get() + 1);
            done(r#"{"ok":true,"op":"apply","expires_at":null,"days_left":null}"#)
        })
    }

    #[test]
    fn a_full_connection_renews_and_returns_the_script_reply() {
        let ran = Cell::new(0);
        let out = drive(apply(), true, Ok(()), &ran);
        assert_eq!(out, json!({"ok": true, "op": "apply", "expires_at": null, "days_left": null}));
        assert_eq!(ran.get(), 1);
    }

    #[test]
    fn without_a_full_connection_the_token_never_reaches_the_vps() {
        let ran = Cell::new(0);
        let out = drive(apply(), true, Err("position_write_read_only"), &ran);
        assert_eq!(out, json!({"ok": false, "error": "cloud_token_read_only"}));
        assert_eq!(ran.get(), 0);
    }

    #[test]
    fn looking_at_the_current_token_needs_no_full_connection_and_no_key() {
        let ran = Cell::new(0);
        let out = cloud_token_with(json!({"op": "check"}), true, || Ok(KEY.to_owned()), || Err("position_write_read_only"), |request| {
            ran.set(ran.get() + 1);
            assert!(request.stdin().is_none());
            done(r#"{"ok":true,"op":"check","state":"expiring","expires_at":"2026-11-01T00:00:00.000Z","days_left":8}"#)
        });
        assert_eq!(out["state"], "expiring");
        assert_eq!(out["days_left"], 8);
        assert_eq!(ran.get(), 1);
    }

    #[test]
    fn another_window_or_another_connection_is_refused_before_anything_runs() {
        let ran = Cell::new(0);
        assert_eq!(drive(apply(), false, Ok(()), &ran)["error"], "cloud_token_window_refused");
        let out = cloud_token_with(apply(), true, || Ok("another".into()), || Ok(()), |_| {
            ran.set(ran.get() + 1);
            Err("x")
        });
        assert_eq!(out["error"], "existing_team_runtime_target_changed");
        let out = cloud_token_with(apply(), true, || Err("existing_team_runtime_required"), || Ok(()), |_| {
            ran.set(ran.get() + 1);
            Err("x")
        });
        assert_eq!(out["error"], "existing_team_runtime_required");
        assert_eq!(ran.get(), 0);
    }

    #[test]
    fn only_the_confirmed_team_of_this_run_may_renew() {
        use crate::account_scope::AccountScope;
        use crate::existing_team_runtime::{grant_full_link, revoke_full_link, FULL_LINK_TEST_LOCK};
        let _serial = FULL_LINK_TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let (scope, other) = (AccountScope::synthetic(b"scope-one"), AccountScope::synthetic(b"scope-two"));
        let found = ActivatedTarget::synthetic_for_tests();
        let attempt = |scope: &AccountScope| {
            let ran = Cell::new(0);
            let out = cloud_token_with(apply(), true, || Ok(KEY.into()), || full_connection(scope, &found), |_| {
                ran.set(ran.get() + 1);
                done(r#"{"ok":true,"op":"apply","expires_at":null,"days_left":null}"#)
            });
            (out, ran.get())
        };
        revoke_full_link();
        assert_eq!(attempt(&scope), (json!({"ok": false, "error": "cloud_token_read_only"}), 0));
        grant_full_link(&scope, &found);
        assert_eq!(attempt(&scope).0["ok"], true);
        assert_eq!(attempt(&other), (json!({"ok": false, "error": "cloud_token_read_only"}), 0));
        revoke_full_link();
        assert_eq!(attempt(&scope).0["error"], "cloud_token_read_only");
    }

    #[test]
    fn what_is_not_a_sync_token_is_refused_without_the_vps() {
        for token in [
            "",
            "jht_sync_",
            "jht_sync_short",
            "other_AbCdEfGhIjKlMnOpQrStUv",
            "jht_sync_AbCdEfGhIjKlMnOpQr; reboot",
            "jht_sync_AbCdEfGhIjKlMnOpQr'x",
            "jht_sync_AbCdEfGhIjKlMnOpQr\nx",
            &format!("jht_sync_{}", "a".repeat(129)),
        ] {
            let ran = Cell::new(0);
            let out = drive(json!({"op": "apply", "token": token, "connectionKey": KEY}), true, Ok(()), &ran);
            assert_eq!(out["error"], "token_malformed", "{token:?}");
            assert_eq!(ran.get(), 0, "{token:?}");
        }
        for request in [
            json!({"op": "apply", "connectionKey": KEY}),
            json!({"op": "apply", "token": TOKEN}),
            json!({"op": "apply", "token": TOKEN, "connectionKey": KEY, "host": "x"}),
            json!({"op": "check", "token": TOKEN}),
            json!({"op": "run"}),
        ] {
            let ran = Cell::new(0);
            assert_eq!(drive(request.clone(), true, Ok(()), &ran)["error"], "cloud_token_request_invalid", "{request}");
            assert_eq!(ran.get(), 0);
        }
    }

    #[test]
    fn the_token_travels_on_stdin_and_never_in_the_remote_command() {
        let request: CloudTokenRequest = serde_json::from_value(apply()).unwrap();
        let remote = cloud_token_command(&target(), &request).unwrap();
        assert!(!remote.contains(TOKEN) && !remote.contains("SENTINELLA"));
        assert!(remote.ends_with(
            "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 /app/shared/skills/cloud_token.py 'apply'"
        ));
        assert!(remote.contains("|| exit 70"), "the pinned container's checks come first");
        let stdin = request.stdin().unwrap();
        assert_eq!(stdin.iter().filter(|b| **b == b'\n').count(), 1);
        assert_eq!(serde_json::from_slice::<Value>(&stdin).unwrap(), json!({"token": TOKEN}));
        let check: CloudTokenRequest = serde_json::from_value(json!({"op": "check"})).unwrap();
        assert!(cloud_token_command(&target(), &check).unwrap().ends_with("cloud_token.py 'check'"));
        assert_eq!(check.stdin(), None);
    }

    #[test]
    fn the_script_refusals_come_back_as_closed_codes_and_never_the_token() {
        let run = |code: i32, stdout: &str| {
            cloud_token_with(apply(), true, || Ok(KEY.into()), || Ok(()), |_| Ok(ProcessResult { code, stdout: stdout.as_bytes().to_vec() }))
        };
        for code in ["token_rejected", "token_other_account", "cloud_unreachable", "cloud_not_configured", "cloud_write_failed"] {
            let out = run(1, &format!(r#"{{"ok":false,"op":"apply","code":"{code}"}}"#));
            assert_eq!(out, json!({"ok": false, "error": code}));
            assert!(!out.to_string().contains("SENTINELLA"));
        }
        // a box whose image has no script yet: no JSON at all
        assert_eq!(run(2, "python3: can't open file '/app/shared/skills/cloud_token.py'")["error"], "existing_team_runtime_outdated");
        assert_eq!(run(70, "")["error"], "existing_team_runtime_changed");
    }

    #[test]
    fn the_site_opens_only_for_the_main_window_and_only_at_the_fixed_page() {
        let asked = std::cell::RefCell::new(Vec::new());
        let open = |url: &str| {
            asked.borrow_mut().push(url.to_owned());
            Ok(())
        };
        assert_eq!(open_settings_with(false, open)["error"], "cloud_token_window_refused");
        assert!(asked.borrow().is_empty());
        assert_eq!(open_settings_with(true, open), json!({"ok": true}));
        assert_eq!(*asked.borrow(), vec!["https://jobhunterteam.ai/settings/cloud-sync".to_owned()]);
        let broken = |_: &str| Err(std::io::Error::other("no browser"));
        assert_eq!(open_settings_with(true, broken), json!({"ok": false, "error": "browser_failed"}));
    }
}

//! The API key of glm or kimi, given to the team from the app the way `jht setup --api-key-stdin` takes it.
//!
//! Those two providers run on Pi with an API key and have no sign-in. The CLI's own way to give or change the key is
//! `jht setup --non-interactive --provider <glm|kimi> --harness pi --api-key-stdin`: the setup keeps the key in the key store
//! of the team's container (a folder of its own volume, mode 0700, one file of mode 0600 per provider), and the config holds only
//! the path. The app does exactly that and nothing else:
//!
//! - the key travels from the page to this command, and from here to the setup's standard input, in memory that is wiped
//!   (`Zeroizing`) as soon as it has been written; it is never in an argument, in an environment variable, in a file of this
//!   computer, in a log, in an error or in a diagnostic, and the page empties its field at once;
//! - it goes to the team's host: the attested wrapper on this computer, `jht` over SSH on a VPS (`run_host_jht`: «secrets go only
//!   on `input`»); on an existing team only the full link may change anything (`saved_host_action_refusal`);
//! - the provider is one of two closed words and the key one line of 16 to 512 printable characters without spaces, the same shape
//!   the setup demands, checked here before anything is run;
//! - afterwards `jht providers check-key` asks the provider whether it accepts the key (exit 3 only when it refuses): the page
//!   says «saved» or «saved, but the provider refused it».
//!
//! Nothing the commands print reaches the page: the answer is one of two words or a code of the app's catalog.

use crate::account_scope::AccountScopeState;
use crate::onboarding::run_host_jht;
use crate::runtime_host::ProcessResult;
use serde::{Deserialize, Serialize};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::State;
use zeroize::{Zeroize, Zeroizing};

const PROVIDERS: [&str; 2] = ["glm", "kimi"];
const MIN_KEY_LEN: usize = 16;
const MAX_KEY_LEN: usize = 512;
/// The setup may have to start the team's container first.
const SETUP_TIMEOUT: Duration = Duration::from_secs(180);
const CHECK_TIMEOUT: Duration = Duration::from_secs(60);
/// What `jht providers check-key` exits with when the provider refuses the key (and only then).
const KEY_REFUSED_EXIT: i32 = 3;

#[derive(Debug, Serialize)]
pub(crate) struct ProviderKeyError {
    code: &'static str,
}

fn failure(code: &'static str) -> ProviderKeyError {
    ProviderKeyError { code }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProviderKeyRequest {
    provider: String,
    key: String,
}

impl Drop for ProviderKeyRequest {
    fn drop(&mut self) {
        self.key.zeroize();
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderKeySaved {
    /// `saved`: kept, and not refused by the provider (or the provider could not be asked); `refused`: kept, and refused.
    state: &'static str,
}

#[derive(Default)]
pub(crate) struct ProviderKeyState {
    busy: AtomicBool,
}

/// The command and its standard input. The key is only in `stdin`.
struct SetupInvocation {
    args: [&'static str; 7],
    stdin: Zeroizing<Vec<u8>>,
}

fn setup_invocation(request: &ProviderKeyRequest) -> Result<SetupInvocation, &'static str> {
    let provider = PROVIDERS
        .iter()
        .find(|known| **known == request.provider)
        .copied()
        .ok_or("provider_key_provider_invalid")?;
    // A pasted key often comes with a line break or a space at the end.
    let key = request.key.trim();
    let printable = key.bytes().all(|byte| (b'!'..=b'~').contains(&byte));
    if !(MIN_KEY_LEN..=MAX_KEY_LEN).contains(&key.len()) || !printable {
        return Err("provider_key_invalid");
    }
    let mut stdin = Zeroizing::new(Vec::with_capacity(key.len() + 1));
    stdin.extend_from_slice(key.as_bytes());
    stdin.push(b'\n');
    Ok(SetupInvocation {
        args: ["setup", "--non-interactive", "--provider", provider, "--harness", "pi", "--api-key-stdin"],
        stdin,
    })
}

/// What a command that did not answer says, as a code of the catalog. Never the command's own text.
fn run_failure(error: &'static str) -> &'static str {
    match error {
        "process_timeout" => "timeout",
        "runtime_missing" => "runtime_missing",
        code if code.starts_with("account_") || code.starts_with("local_account_") => code,
        _ => "provider_key_failed",
    }
}

/// The setup counts only by its exit: 0 is saved.
fn parse_setup(result: Result<ProcessResult, &'static str>) -> Result<(), &'static str> {
    let output = result.map_err(run_failure)?;
    if output.success() {
        Ok(())
    } else {
        Err("provider_key_failed")
    }
}

/// The check can only refuse (exit 3): anything else, including a check that could not be made, leaves the key as saved.
fn parse_check(result: Result<ProcessResult, &'static str>) -> &'static str {
    match result {
        Ok(output) if output.code == KEY_REFUSED_EXIT => "refused",
        _ => "saved",
    }
}

#[tauri::command]
pub(crate) async fn provider_key_save(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, ProviderKeyState>,
    scopes: State<'_, AccountScopeState>,
    request: ProviderKeyRequest,
) -> Result<ProviderKeySaved, ProviderKeyError> {
    let mut request = request;
    let scope = scopes.active().map_err(failure)?;
    // The key goes to the team's host: on an existing team that is the full link, not the page's say-so.
    if let Some(code) = crate::agent_control::saved_host_action_refusal(&app, window.label(), &scope) {
        return Err(failure(code));
    }
    if state
        .busy
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let invocation = setup_invocation(&request);
        request.key.zeroize();
        let invocation = invocation?;
        let host = crate::broker_view::active_host(&app, &scope)?;
        parse_setup(run_host_jht(
            &app,
            &scope,
            &host,
            &invocation.args,
            Some(&invocation.stdin),
            SETUP_TIMEOUT,
        ))?;
        let checked = parse_check(run_host_jht(
            &app,
            &scope,
            &host,
            &["providers", "check-key"],
            None,
            CHECK_TIMEOUT,
        ));
        Ok(ProviderKeySaved { state: checked })
    })
    .await
    .unwrap_or(Err("provider_key_failed"));
    state.busy.store(false, Ordering::Release);
    result.map_err(failure)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onboarding::remote_jht_command;

    const KEY: &str = "sk-synthetic-key-for-the-test-0000";

    fn request(provider: &str, key: &str) -> ProviderKeyRequest {
        serde_json::from_str(&format!(r#"{{"provider": "{provider}", "key": "{key}"}}"#)).unwrap()
    }

    fn output(code: i32) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult {
            code,
            stdout: format!("the key {KEY} was seen").into_bytes(),
        })
    }

    #[test]
    fn the_key_is_only_on_the_standard_input_never_in_an_argument() {
        for provider in PROVIDERS {
            let invocation = setup_invocation(&request(provider, KEY)).unwrap();
            assert_eq!(
                invocation.args,
                ["setup", "--non-interactive", "--provider", provider, "--harness", "pi", "--api-key-stdin"]
            );
            assert_eq!(invocation.stdin.as_slice(), format!("{KEY}\n").as_bytes());
            assert!(invocation.args.iter().all(|arg| !arg.contains(KEY)));
            // and not in the command line that goes over SSH either
            let remote = remote_jht_command(&invocation.args);
            assert!(!remote.contains(KEY), "{remote}");
            assert!(remote.contains("'--api-key-stdin'"));
        }
    }

    #[test]
    fn the_provider_is_one_of_the_two_words() {
        for provider in ["openai", "claude", "kimi; rm -rf", "GLM", "", "glm "] {
            assert_eq!(setup_invocation(&request(provider, KEY)).err(), Some("provider_key_provider_invalid"), "{provider:?}");
        }
    }

    #[test]
    fn the_key_is_one_line_of_printable_characters_of_the_length_the_setup_wants() {
        // a pasted key with a line break or spaces around it is trimmed
        let padded = setup_invocation(&request("glm", &format!("  {KEY}\\n"))).unwrap();
        assert_eq!(padded.stdin.as_slice(), format!("{KEY}\n").as_bytes());
        let too_short = "k".repeat(MIN_KEY_LEN - 1);
        let too_long = "k".repeat(MAX_KEY_LEN + 1);
        for bad in [
            "",
            too_short.as_str(),
            too_long.as_str(),
            "two words in one key 0000",
            "line one 0000000000000\\nline two 0000000000000",
            "chiave-con-accento-è-0000",
            "tab\\tinside-the-key-0000",
        ] {
            assert_eq!(setup_invocation(&request("glm", bad)).err(), Some("provider_key_invalid"), "{bad:?}");
        }
        let edge = "k".repeat(MIN_KEY_LEN);
        assert!(setup_invocation(&request("kimi", &edge)).is_ok());
        let edge = "k".repeat(MAX_KEY_LEN);
        assert!(setup_invocation(&request("kimi", &edge)).is_ok());
    }

    #[test]
    fn what_the_commands_print_never_reaches_the_page() {
        assert_eq!(parse_setup(output(0)), Ok(()));
        assert_eq!(parse_setup(output(1)), Err("provider_key_failed"));
        assert_eq!(parse_setup(Err("process_timeout")), Err("timeout"));
        assert_eq!(parse_setup(Err("runtime_missing")), Err("runtime_missing"));
        assert_eq!(parse_setup(Err("account_scope_changed")), Err("account_scope_changed"));
        let said = parse_setup(Err("spawn failed for sk-synthetic-key-for-the-test-0000")).unwrap_err();
        assert_eq!(said, "provider_key_failed");
        assert!(!said.contains(KEY));
    }

    #[test]
    fn only_an_exit_of_three_is_a_refused_key() {
        assert_eq!(parse_check(output(KEY_REFUSED_EXIT)), "refused");
        assert_eq!(parse_check(output(0)), "saved");
        assert_eq!(parse_check(output(1)), "saved");
        assert_eq!(parse_check(Err("process_timeout")), "saved");
    }

    #[test]
    fn the_request_refuses_a_field_it_does_not_know() {
        assert!(serde_json::from_str::<ProviderKeyRequest>(&format!(r#"{{"provider": "glm", "key": "{KEY}", "path": "/tmp/k"}}"#)).is_err());
    }
}

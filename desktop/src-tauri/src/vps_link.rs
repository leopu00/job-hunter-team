//! How a read of a team on a VPS failed, in closed kinds the app can act on.
//!
//! The network (SSH that does not connect, a timeout) is retried by the app
//! with a bounded backoff; the team answering with an error is not; a team that
//! is no longer the pinned one is a version mismatch; and an SSH key that
//! changed since the person confirmed it blocks the connection until they look
//! at it again, never retried. `ssh` exits 255 both for a network failure and
//! for a changed host key (its stderr never reaches this layer), so only then
//! a fresh `ssh-keyscan` is compared with the confirmed key.

use crate::runtime_host::ProcessResult;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

/// The `ssh` client itself could not connect or was refused.
pub(crate) const SSH_EXIT: i32 = 255;
/// The pinned container, image, revision or digest is not the one running
/// (existing_team_runtime::command), or the container is stopped.
pub(crate) const PIN_EXIT: i32 = 70;
/// The team on the VPS belongs to another account (team_probe_command).
pub(crate) const IDENTITY_EXIT: i32 = 72;
/// The team's sessions are not running.
pub(crate) const NOT_ACTIVE_EXIT: i32 = 73;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LinkKind {
    /// Retried by the app with a bounded backoff.
    Network,
    /// The VPS answered, the team did not: no automatic retry.
    Application,
    /// The team on the VPS is not the pinned one: no automatic retry.
    Version,
    /// The VPS SSH key changed: never retried, the person confirms it again.
    Blocked,
}

impl LinkKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Network => "network",
            Self::Application => "application",
            Self::Version => "version",
            Self::Blocked => "blocked",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct LinkOutcome {
    pub(crate) kind: LinkKind,
    /// A catalog code.
    pub(crate) code: &'static str,
}

const fn outcome(kind: LinkKind, code: &'static str) -> LinkOutcome {
    LinkOutcome { kind, code }
}

/// A run that did not end with exit 0. `key_matches_pin` is asked only for an
/// exit 255: Some(false) = the VPS now presents another key; None = it could
/// not be read (the network, most likely). `otherwise` is the caller's code
/// for any other exit of its own command.
pub(crate) fn classify_failure(
    result: &Result<ProcessResult, &'static str>,
    key_matches_pin: impl FnOnce() -> Option<bool>,
    otherwise: &'static str,
) -> LinkOutcome {
    match result {
        Err("process_timeout") => outcome(LinkKind::Network, "timeout"),
        // The local `ssh` did not start or its pipes failed: nothing reached the VPS.
        Err(code) => outcome(LinkKind::Application, code),
        Ok(value) => match value.code {
            0 => outcome(LinkKind::Application, otherwise),
            SSH_EXIT => match key_matches_pin() {
                Some(false) => outcome(LinkKind::Blocked, "host_key_changed"),
                _ => outcome(LinkKind::Network, "ssh_unavailable"),
            },
            PIN_EXIT => outcome(LinkKind::Version, "existing_team_runtime_changed"),
            IDENTITY_EXIT => outcome(LinkKind::Application, "existing_team_identity_mismatch"),
            NOT_ACTIVE_EXIT => outcome(LinkKind::Application, "existing_team_not_active"),
            _ => outcome(LinkKind::Application, otherwise),
        },
    }
}

/// A failure found before anything ran (the saved host, its pin, the target):
/// a pin that no longer reads blocks like a changed one.
pub(crate) fn classify_setup_failure(code: &'static str) -> LinkOutcome {
    match code {
        "host_key_mismatch" | "host_key_changed" => outcome(LinkKind::Blocked, code),
        _ => outcome(LinkKind::Application, code),
    }
}

/// The VPS key found changed, remembered per account scope and VPS until the person confirms it again.
/// The block used to live only in the app's view: reopening it started over, and every read repeated an
/// `ssh` that is refused and a `ssh-keyscan` towards a host already known to have changed. The value is the
/// fingerprint of the PIN the block was found against: a new pin (the person looked at the key again and
/// confirmed it) is a different value, and the memory lets go of it.
fn blocked_keys() -> &'static Mutex<HashMap<String, String>> {
    static BLOCKED: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    BLOCKED.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn block_key(scope_digest: &str, address: &str, port: u16) -> String {
    format!("{scope_digest}|{address}:{port}")
}

pub(crate) fn remember_block(key: &str, pinned_fingerprint: &str) {
    blocked_keys()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(key.to_string(), pinned_fingerprint.to_string());
}

/// Whether a read towards this VPS must not go out: the key is remembered as changed and the pin is still
/// the one it was found against. A different (or unreadable) pin forgets the block: the person has been
/// through the confirmation again, and the next read finds out by itself.
pub(crate) fn remembered_block(key: &str, pinned_now: Option<&str>) -> bool {
    let mut blocked = blocked_keys().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    match (blocked.get(key), pinned_now) {
        (Some(found), Some(now)) if found == now => true,
        (Some(_), _) => {
            blocked.remove(key);
            false
        }
        (None, _) => false,
    }
}

/// The reply of a read that was not even tried: the key is already known to have changed.
pub(crate) fn blocked_reply() -> Value {
    failure_reply(outcome(LinkKind::Blocked, "host_key_changed"))
}

/// Whether a reply of a read says the VPS key changed.
pub(crate) fn is_key_changed(reply: &Value) -> bool {
    reply.get("kind").and_then(Value::as_str) == Some(LinkKind::Blocked.as_str())
        && reply.get("error").and_then(Value::as_str) == Some("host_key_changed")
}

/// The reply of a failed read: its code and its kind.
pub(crate) fn failure_reply(outcome: LinkOutcome) -> Value {
    json!({"ok": false, "error": outcome.code, "kind": outcome.kind.as_str()})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn exited(code: i32) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult { code, stdout: Vec::new() })
    }

    fn no_rescan() -> Option<bool> {
        panic!("only an exit 255 rescans the host key")
    }

    #[test]
    fn a_ssh_timeout_is_the_network_and_never_rescans() {
        let timed_out = classify_failure(&Err("process_timeout"), no_rescan, "positions_unavailable");
        assert_eq!(timed_out, outcome(LinkKind::Network, "timeout"));
    }

    #[test]
    fn an_exit_72_is_the_application_and_never_rescans() {
        let other = classify_failure(&exited(IDENTITY_EXIT), no_rescan, "positions_unavailable");
        assert_eq!(other, outcome(LinkKind::Application, "existing_team_identity_mismatch"));
        assert_eq!(
            classify_failure(&exited(NOT_ACTIVE_EXIT), no_rescan, "positions_unavailable"),
            outcome(LinkKind::Application, "existing_team_not_active")
        );
        assert_eq!(
            classify_failure(&exited(1), no_rescan, "positions_unavailable"),
            outcome(LinkKind::Application, "positions_unavailable")
        );
        assert_eq!(
            classify_failure(&Err("process_start_failed"), no_rescan, "positions_unavailable"),
            outcome(LinkKind::Application, "process_start_failed")
        );
    }

    #[test]
    fn a_changed_host_key_blocks_and_is_rescanned_once() {
        let scans = Cell::new(0);
        let changed = classify_failure(
            &exited(SSH_EXIT),
            || {
                scans.set(scans.get() + 1);
                Some(false)
            },
            "positions_unavailable",
        );
        assert_eq!(changed, outcome(LinkKind::Blocked, "host_key_changed"));
        assert_eq!(scans.get(), 1);
    }

    #[test]
    fn an_exit_255_with_the_same_or_an_unreadable_key_is_the_network() {
        for key in [Some(true), None] {
            assert_eq!(
                classify_failure(&exited(SSH_EXIT), || key, "positions_unavailable"),
                outcome(LinkKind::Network, "ssh_unavailable"),
                "{key:?}"
            );
        }
    }

    #[test]
    fn an_exit_70_is_a_team_that_is_not_the_pinned_one() {
        assert_eq!(
            classify_failure(&exited(PIN_EXIT), no_rescan, "positions_unavailable"),
            outcome(LinkKind::Version, "existing_team_runtime_changed")
        );
    }

    #[test]
    fn a_changed_key_is_remembered_for_its_scope_and_vps_until_the_pin_changes() {
        let key = block_key("scope-memory-test-a", "vps.example", 22);
        let other_scope = block_key("scope-memory-test-b", "vps.example", 22);
        let other_vps = block_key("scope-memory-test-a", "other.example", 22);
        remember_block(&key, "SHA256:old");
        assert!(remembered_block(&key, Some("SHA256:old")));
        assert!(remembered_block(&key, Some("SHA256:old")), "asking does not spend it");
        assert!(!remembered_block(&other_scope, Some("SHA256:old")));
        assert!(!remembered_block(&other_vps, Some("SHA256:old")));
        // the person confirmed the new key: another pin, and the memory lets go
        assert!(!remembered_block(&key, Some("SHA256:new")));
        assert!(!remembered_block(&key, Some("SHA256:old")), "and it does not come back");
        // an unreadable pin is not a block we can stand on
        remember_block(&key, "SHA256:old");
        assert!(!remembered_block(&key, None));
        assert!(blocked_reply().get("error").is_some());
        assert!(is_key_changed(&blocked_reply()));
        assert!(!is_key_changed(&failure_reply(outcome(LinkKind::Blocked, "host_key_mismatch"))));
        assert!(!is_key_changed(&failure_reply(outcome(LinkKind::Network, "ssh_unavailable"))));
    }

    #[test]
    fn a_pin_that_no_longer_reads_blocks_and_other_setup_failures_are_the_application() {
        assert_eq!(classify_setup_failure("host_key_mismatch").kind, LinkKind::Blocked);
        assert_eq!(classify_setup_failure("host_not_configured").kind, LinkKind::Application);
        assert_eq!(
            failure_reply(outcome(LinkKind::Network, "timeout")),
            json!({"ok": false, "error": "timeout", "kind": "network"})
        );
    }
}

use super::*;

/// How long the checks of a pinned container are not repeated for reads of the positions.
pub(super) const CHECKS_KEPT_MS: u64 = 45_000;
/// The targets whose checks passed, at most this many, in memory only.
pub(super) const CHECKS_KEPT_TARGETS: usize = 8;

/// The targets whose checks (container, image, revision, digest) passed on a complete read, and
/// when. Only in this process's memory, never on disk; the key is a hash of the whole identity of the
/// connection (account, host, port, user, key, team and every value of the pinned target).
pub(crate) struct VerifiedTargets {
    pub(super) entries: Mutex<Vec<(String, u64)>>,
}

impl VerifiedTargets {
    pub(crate) const fn new() -> Self {
        Self { entries: Mutex::new(Vec::new()) }
    }

    pub(super) fn fresh(&self, key: &str, now_ms: u64) -> bool {
        self.entries.lock().is_ok_and(|entries| {
            entries.iter().any(|(kept, at)| kept == key && now_ms.saturating_sub(*at) < CHECKS_KEPT_MS && now_ms >= *at)
        })
    }

    pub(super) fn remember(&self, key: &str, now_ms: u64) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|(kept, at)| kept != key && now_ms.saturating_sub(*at) < CHECKS_KEPT_MS);
            entries.push((key.to_owned(), now_ms));
            while entries.len() > CHECKS_KEPT_TARGETS {
                entries.remove(0);
            }
        }
    }

    pub(super) fn forget(&self, key: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|(kept, _)| kept != key);
        }
    }
}

pub(super) static VERIFIED_TARGETS: VerifiedTargets = VerifiedTargets::new();

pub(super) fn clock_ms() -> u64 {
    static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

/// The key of a pinned target's verified state; none for anything but a VPS with a whole pinned target.
pub(super) fn checks_key(scope: &AccountScope, host: &crate::runtime_host::ValidatedHost, team_id: &str, runtime: &RuntimeTarget) -> Option<String> {
    let crate::runtime_host::ValidatedHost::Vps { address, user, port, key_path, known_hosts } = host else {
        return None;
    };
    if !valid_target(runtime) {
        return None;
    }
    Some(sha256(
        format!(
            "{}\n{address}\n{user}\n{port}\n{}\n{}\n{team_id}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
            scope.digest(),
            key_path.display(),
            known_hosts.display(),
            runtime.container_id,
            runtime.image_id,
            runtime.platform_image_id,
            runtime.oci_revision,
            runtime.digest,
            runtime.os,
            runtime.architecture,
        )
        .as_bytes(),
    ))
}

/// One read of the positions, with the checks of the pinned container done on the first and then only
/// every 45 s: `run(true)` is the complete command with its checks, `run(false)` the shortcut.
/// - the entry is made only by a complete read that succeeded, and a shortcut that worked neither
///   makes nor renews it: the checks come back at the latest 45 s after the last complete read;
/// - any reply that is not a success (a refusal such as exit 70, a timeout, a reply that is not
///   valid) deletes the entry, and a failed shortcut is followed at once by ONE complete read;
/// - with no key (not a VPS with a pinned target) every read is complete.
/// Returns the reply and whether the checks were skipped.
pub(super) fn read_amortising_checks(
    memory: &VerifiedTargets,
    key: Option<&str>,
    now_ms: impl Fn() -> u64,
    mut run: impl FnMut(bool) -> Value,
) -> (Value, bool) {
    let succeeded = |reply: &Value| reply.get("ok") == Some(&Value::Bool(true));
    let Some(key) = key else {
        return (run(true), false);
    };
    if memory.fresh(key, now_ms()) {
        let reply = run(false);
        if succeeded(&reply) {
            return (reply, true);
        }
        memory.forget(key);
    }
    let reply = run(true);
    if succeeded(&reply) {
        memory.remember(key, now_ms());
    } else {
        memory.forget(key);
    }
    (reply, false)
}

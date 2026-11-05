//! The team's update from the app (JHT-T173): what `jht upgrade --json` said, closed again, and which way a
//! build may update the team it finds.
//!
//! Two ways, never mixed:
//! - a production build asks the host's wrapper for `jht upgrade --json` (`--check` to only ask whether a newer
//!   image is there);
//! - a test build (pinned to one commit) runs the installer of the onboarding again, with the digest checked
//!   before it runs, because `jht upgrade` refuses a test install on purpose (it would download the compose of
//!   production over the test commit's). That way is decided by the build's channel and by the image pin the
//!   install left in the runtime folder, nothing else: a production build never touches a test install, and a
//!   test build never touches a production one.
//!
//! This file holds only what needs no process, no window and no network, so it is tested as it is.
use crate::release_channel_rules::TestChannel;
use crate::runtime_host::ProcessResult;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// The line of the wrapper that says it speaks `upgrade --json` (jht-wrapper.ps1: `$JHT_UPGRADE_PROTOCOL = 1`).
pub(crate) const UPGRADE_PROTOCOL: &str = "JHT_UPGRADE_PROTOCOL=1";

/// The phases `jht upgrade --json` names. Anything else is told as `unknown`.
const PHASES: [&str; 9] = [
    "preflight",
    "recovery",
    "pull",
    "candidate_metadata",
    "activate",
    "commit",
    "verify",
    "check",
    "complete",
];

/// The wrapper's own sentences that the page tells in its words, by their beginning. The rest is shown as the phase
/// alone: free text from a host is never passed on.
const REASONS: [(&str, &str); 7] = [
    ("Installazione del canale di test", "test_channel"),
    ("disk_low", "disk_low"),
    ("Un aggiornamento e gia in corso", "in_progress"),
    ("Download immagine non riuscito", "download_failed"),
    ("Docker non e disponibile", "engine_unavailable"),
    ("Runtime remoto non valido o non raggiungibile", "release_unreachable"),
    ("La macchina Podman vede", "podman_machine_mounts"),
];

/// How a version or an image name reaches the page: the characters the wrapper itself keeps, and no more than this.
const FIELD_MAX: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    /// `jht upgrade --json` of the host's wrapper.
    Upgrade,
    /// The installer of the test channel again.
    Reinstall,
}

impl Mode {
    pub(crate) fn word(self) -> &'static str {
        match self {
            Mode::Upgrade => "upgrade",
            Mode::Reinstall => "reinstall",
        }
    }
}

/// What the page gets: the closed fields of the wrapper's answer.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamUpdateOutcome {
    pub(crate) ok: bool,
    /// A check: a newer image is there. An update: the image changed.
    pub(crate) changed: bool,
    pub(crate) phase: &'static str,
    pub(crate) reason: Option<&'static str>,
    /// The failed update was undone: the version that worked is back.
    pub(crate) rolled_back: bool,
    pub(crate) restart_required: bool,
    pub(crate) previous_version: String,
    pub(crate) current_version: String,
    pub(crate) mode: &'static str,
}

#[derive(Deserialize)]
struct UpgradeSide {
    version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpgradeReply {
    ok: bool,
    changed: bool,
    phase: String,
    previous: UpgradeSide,
    current: UpgradeSide,
    restart_required: bool,
    message: String,
    rolled_back: bool,
}

fn field(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || ".,:_+@/-".contains(*c))
        .take(FIELD_MAX)
        .collect()
}

fn reason_of(message: &str) -> Option<&'static str> {
    REASONS.iter().find(|(start, _)| message.starts_with(start)).map(|(_, code)| *code)
}

/// The one JSON line of `jht upgrade [--check] --json` (the last one that starts with `{`; whatever was printed
/// before it is ignored), closed again. An `ok: true` counts only with exit 0. With no JSON line at all, the exit
/// says why: 255 is ssh's (the link is gone), 2 and 64 are a wrapper that does not know `upgrade --json`.
pub(crate) fn parse_upgrade(result: &ProcessResult, mode: Mode) -> Result<TeamUpdateOutcome, &'static str> {
    let stdout = String::from_utf8_lossy(&result.stdout);
    let line = stdout.lines().map(str::trim).filter(|line| line.starts_with('{')).last();
    let Some(line) = line else {
        return Err(match result.code {
            255 => "tunnel_unavailable",
            2 | 64 => "team_update_wrapper_outdated",
            _ => "team_update_failed",
        });
    };
    let reply: UpgradeReply = serde_json::from_str(line).map_err(|_| "team_update_failed")?;
    let ok = reply.ok && result.success();
    let phase = PHASES.iter().find(|known| **known == reply.phase).copied().unwrap_or("unknown");
    Ok(TeamUpdateOutcome {
        ok,
        changed: reply.changed,
        phase,
        reason: if ok { None } else { reason_of(&reply.message) },
        rolled_back: reply.rolled_back,
        restart_required: reply.restart_required,
        previous_version: field(&reply.previous.version),
        current_version: field(&reply.current.version),
        mode: mode.word(),
    })
}

/// What the install left in the runtime folder for the image: nothing, one line, or something that is not that.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Pin {
    Absent,
    Present(String),
    Invalid,
}

/// The pin file of a test install (`runtime-image`: the canonical by-digest reference of the image). A link, a
/// folder, a big file or more than one line is not the pin: `Invalid`, and nothing is updated on it.
pub(crate) fn read_pin(runtime_dir: &Path) -> Pin {
    let path = runtime_dir.join(crate::release_channel::IMAGE_PIN);
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Pin::Absent,
        Err(_) => return Pin::Invalid,
    };
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > 512 {
        return Pin::Invalid;
    }
    match std::fs::read_to_string(&path) {
        Ok(text) if text.trim().lines().count() == 1 && !text.trim().is_empty() => Pin::Present(text.trim().to_owned()),
        _ => Pin::Invalid,
    }
}

/// Which way this build may update the team it finds on this computer, or why it may not.
pub(crate) fn plan(channel: Option<&TestChannel>, pin: &Pin) -> Result<Mode, &'static str> {
    match (channel, pin) {
        (_, Pin::Invalid) => Err("team_update_runtime_invalid"),
        (None, Pin::Absent) => Ok(Mode::Upgrade),
        (Some(_), Pin::Present(_)) => Ok(Mode::Reinstall),
        // production over a test install, or a test build over a production one: the channels are not mixed
        _ => Err("team_update_channel_mismatch"),
    }
}

/// Whether the pinned image is the one this test build was made for: the digest behind the pin is the build's.
/// It is the only thing the pin tells. Two commits that share one image (a moving tag) look the same here, so
/// a test build warns only when the image is different, and an explicit update still runs the installer.
pub(crate) fn pin_is_build_image(pin: &str, channel: &TestChannel) -> bool {
    pin.trim().ends_with(&format!("@{}", channel.image_digest))
}

/// The answer of a check on a test install: nothing was run, the pin was compared.
pub(crate) fn reinstall_check(pin: &str, channel: &TestChannel) -> TeamUpdateOutcome {
    TeamUpdateOutcome {
        ok: true,
        changed: !pin_is_build_image(pin, channel),
        phase: "check",
        reason: None,
        rolled_back: false,
        restart_required: false,
        previous_version: String::new(),
        current_version: String::new(),
        mode: Mode::Reinstall.word(),
    }
}

/// The answer of a test install that was installed again and started.
#[cfg_attr(not(unix), allow(dead_code))]
pub(crate) fn reinstalled() -> TeamUpdateOutcome {
    TeamUpdateOutcome {
        ok: true,
        changed: true,
        phase: "complete",
        reason: None,
        rolled_back: false,
        restart_required: false,
        previous_version: String::new(),
        current_version: String::new(),
        mode: Mode::Reinstall.word(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::release_channel_rules::resolve;

    const SHA: &str = "0123456789abcdef0123456789abcdef01234567";
    const DIGEST: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const OTHER: &str = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const INSTALL: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const INSTALL_PS1: &str = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

    fn test_channel() -> TestChannel {
        let image = format!("ghcr.io/leopu00/jht@{DIGEST}");
        resolve(
            Some("test"),
            Some(SHA),
            Some(image.as_str()),
            Some(DIGEST),
            Some(INSTALL),
            Some(INSTALL_PS1),
        )
        .unwrap()
        .unwrap()
    }

    fn said(code: i32, text: &str) -> ProcessResult {
        ProcessResult { code, stdout: text.as_bytes().to_vec() }
    }

    fn reply(ok: bool, changed: bool, phase: &str, message: &str, rolled_back: bool) -> String {
        format!(
            r#"{{"ok":{ok},"changed":{changed},"phase":"{phase}","previous":{{"version":"0.4.0","image":"ghcr.io/leopu00/jht@sha256:old"}},"current":{{"version":"0.4.1","image":"ghcr.io/leopu00/jht@sha256:new"}},"restartRequired":false,"message":"{message}","rolledBack":{rolled_back}}}"#
        )
    }

    #[test]
    fn a_finished_update_is_told_with_its_versions_and_no_reason() {
        let done = parse_upgrade(&said(0, &reply(true, true, "complete", "Nuova versione attiva e verificata", false)), Mode::Upgrade).unwrap();
        assert_eq!(
            done,
            TeamUpdateOutcome {
                ok: true,
                changed: true,
                phase: "complete",
                reason: None,
                rolled_back: false,
                restart_required: false,
                previous_version: "0.4.0".into(),
                current_version: "0.4.1".into(),
                mode: "upgrade",
            }
        );
    }

    #[test]
    fn a_failed_update_keeps_its_phase_its_rollback_and_the_reason_the_page_knows() {
        let line = reply(false, false, "verify", "Download immagine non riuscito", true);
        let failed = parse_upgrade(&said(1, &line), Mode::Upgrade).unwrap();
        assert!(!failed.ok);
        assert_eq!((failed.phase, failed.reason, failed.rolled_back), ("verify", Some("download_failed"), true));
        // a sentence the page does not know is not passed on
        let strange = parse_upgrade(&said(1, &reply(false, false, "pull", "qualcosa di nuovo", false)), Mode::Upgrade).unwrap();
        assert_eq!(strange.reason, None);
        // the refusal of a test install is told as such
        let refused = parse_upgrade(
            &said(1, &reply(false, false, "preflight", "Installazione del canale di test: si aggiorna reinstallando dalla build di test", false)),
            Mode::Upgrade,
        )
        .unwrap();
        assert_eq!(refused.reason, Some("test_channel"));
    }

    #[test]
    fn ok_counts_only_with_exit_zero_and_a_phase_outside_the_list_is_unknown() {
        let lying = parse_upgrade(&said(1, &reply(true, true, "complete", "x", false)), Mode::Upgrade).unwrap();
        assert!(!lying.ok);
        let odd = parse_upgrade(&said(0, &reply(true, false, "teleport", "x", false)), Mode::Upgrade).unwrap();
        assert_eq!(odd.phase, "unknown");
    }

    #[test]
    fn the_last_json_line_counts_and_what_comes_before_it_is_ignored() {
        let text = format!("log di avvio\n{{\"ok\":false}}\n{}\n", reply(true, false, "check", "Controllo completato", false));
        let checked = parse_upgrade(&said(0, &text), Mode::Upgrade).unwrap();
        assert_eq!((checked.ok, checked.changed, checked.phase), (true, false, "check"));
    }

    #[test]
    fn no_json_line_is_told_by_the_exit() {
        assert_eq!(parse_upgrade(&said(255, ""), Mode::Upgrade), Err("tunnel_unavailable"));
        assert_eq!(parse_upgrade(&said(2, ""), Mode::Upgrade), Err("team_update_wrapper_outdated"));
        assert_eq!(parse_upgrade(&said(64, ""), Mode::Upgrade), Err("team_update_wrapper_outdated"));
        assert_eq!(parse_upgrade(&said(1, "boom"), Mode::Upgrade), Err("team_update_failed"));
        assert_eq!(parse_upgrade(&said(0, "{non json"), Mode::Upgrade), Err("team_update_failed"));
    }

    #[test]
    fn versions_keep_only_the_characters_the_wrapper_keeps() {
        let line = reply(true, true, "complete", "x", false).replace("0.4.1", "0.4.1<script>\\\"x");
        let done = parse_upgrade(&said(0, &line), Mode::Upgrade).unwrap();
        assert_eq!(done.current_version, "0.4.1scriptx");
        let long = reply(true, true, "complete", "x", false).replace("0.4.0", &"9".repeat(200));
        assert_eq!(parse_upgrade(&said(0, &long), Mode::Upgrade).unwrap().previous_version.len(), FIELD_MAX);
    }

    #[test]
    fn the_channels_are_never_mixed() {
        let test = test_channel();
        let pinned = Pin::Present(format!("ghcr.io/leopu00/jht@{DIGEST}"));
        assert_eq!(plan(None, &Pin::Absent), Ok(Mode::Upgrade));
        assert_eq!(plan(Some(&test), &pinned), Ok(Mode::Reinstall));
        // production over a test install, test build over a production install
        assert_eq!(plan(None, &pinned), Err("team_update_channel_mismatch"));
        assert_eq!(plan(Some(&test), &Pin::Absent), Err("team_update_channel_mismatch"));
        // a pin that is not a plain file is nobody's
        assert_eq!(plan(None, &Pin::Invalid), Err("team_update_runtime_invalid"));
        assert_eq!(plan(Some(&test), &Pin::Invalid), Err("team_update_runtime_invalid"));
    }

    #[test]
    fn a_test_build_warns_only_when_the_pinned_image_is_another_one() {
        let test = test_channel();
        assert!(!reinstall_check(&format!("ghcr.io/leopu00/jht@{DIGEST}\n"), &test).changed);
        let older = reinstall_check(&format!("ghcr.io/leopu00/jht@{OTHER}"), &test);
        assert!(older.changed && older.ok);
        assert_eq!((older.phase, older.mode), ("check", "reinstall"));
    }

    #[test]
    fn the_pin_is_read_only_when_it_is_one_plain_line() {
        let dir = std::env::temp_dir().join(format!("jht-team-update-pin-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pin = dir.join(crate::release_channel::IMAGE_PIN);
        let _ = std::fs::remove_file(&pin);
        assert_eq!(read_pin(&dir), Pin::Absent);
        std::fs::write(&pin, "ghcr.io/leopu00/jht@sha256:abc\n").unwrap();
        assert_eq!(read_pin(&dir), Pin::Present("ghcr.io/leopu00/jht@sha256:abc".into()));
        std::fs::write(&pin, "one\ntwo\n").unwrap();
        assert_eq!(read_pin(&dir), Pin::Invalid);
        std::fs::write(&pin, "").unwrap();
        assert_eq!(read_pin(&dir), Pin::Invalid);
        std::fs::write(&pin, "x".repeat(600)).unwrap();
        assert_eq!(read_pin(&dir), Pin::Invalid);
        let _ = std::fs::remove_file(&pin);
        let _ = std::fs::remove_dir(&dir);
    }
}

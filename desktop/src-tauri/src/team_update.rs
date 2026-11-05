//! The team's update from the app (JHT-T173): what `jht upgrade --json` said, closed again, and which way a
//! build may update the team it finds.
//!
//! Two ways, never mixed:
//! - a production build asks the host's wrapper for `jht upgrade --json`;
//! - a test build (pinned to one commit) runs the installer of the onboarding again, with the digest checked
//!   before it runs, because `jht upgrade` refuses a test install on purpose (it would download the compose of
//!   production over the test commit's). That way is decided by the build's channel and by the image pin the
//!   install left in the runtime folder, nothing else: a production build never touches a test install, and a
//!   test build never touches a production one.
//!
//! The notice that the team is older than the app never downloads anything and starts no process: it compares two
//! digests it can read as small files (see `production_check` and `reinstall_check`). Only the button updates.
//!
//! This file holds only what needs no process, no window and no network, so it is tested as it is.
use crate::release_channel_rules::TestChannel;
use crate::runtime_host::ProcessResult;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::Path;

/// The image this build was made for: the release pin (`release/runtime-image.v1.json`) as it was when the build was made.
const RELEASE_PIN: &str = include_str!("../../../release/runtime-image.v1.json");

/// The biggest file the notice reads: the compose file of the host runtime, or the image pin.
const SMALL_FILE_MAX: u64 = 256 * 1024;

/// How the compose file and the image pin name the team's image: always by digest.
const IMAGE_BY_DIGEST: &str = "ghcr.io/leopu00/jht@sha256:";

/// The line of the wrapper that says it speaks `upgrade --json` (jht-wrapper.ps1: `$JHT_UPGRADE_PROTOCOL = 1`).
pub(crate) const UPGRADE_PROTOCOL: &str = "JHT_UPGRADE_PROTOCOL=1";

/// The command run on a VPS: the checks of its wrapper (a file, executable, not a link, carrying the protocol line), then
/// `upgrade --json`. A constant, because ssh takes only a `'static` command and nothing of the page may enter it; a test keeps
/// it equal to what `agent_control::own_vps_wrapper` builds for the same line.
pub(crate) const REMOTE_UPGRADE: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; [ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 2; grep -Fqx 'JHT_UPGRADE_PROTOCOL=1' "$JHT_BIN" || exit 2; exec "$JHT_BIN" upgrade --json </dev/null"#;

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
    /// A check: the two images compared (`<installed>:<this build's>`, 12 hex each), so the page can tell «already
    /// compared and told» from a new difference. Empty for everything else.
    pub(crate) image_id: String,
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
        image_id: String::new(),
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

/// A small regular file, read once: not a link, opened a single time, checked (a file, not empty, not bigger than `max`)
/// and read through that descriptor, and on unix the file opened is the one the path named a moment before. `None` is
/// no file; `Err` is something there that is not a plain small file.
fn read_small(path: &Path, max: u64) -> Result<Option<String>, ()> {
    let before = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(()),
    };
    if !before.file_type().is_file() {
        return Err(());
    }
    let file = std::fs::File::open(path).map_err(|_| ())?;
    let opened = file.metadata().map_err(|_| ())?;
    if !opened.is_file() || opened.len() == 0 || opened.len() > max {
        return Err(());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != opened.dev() || before.ino() != opened.ino() {
            return Err(());
        }
    }
    let mut text = String::new();
    file.take(max + 1).read_to_string(&mut text).map_err(|_| ())?;
    if text.len() as u64 > max {
        return Err(());
    }
    Ok(Some(text))
}

/// The pin file of a test install (`runtime-image`: the canonical by-digest reference of the image). A link, a
/// folder, a big file or more than one line is not the pin: `Invalid`, and nothing is updated on it.
pub(crate) fn read_pin(runtime_dir: &Path) -> Pin {
    match read_small(&runtime_dir.join(crate::release_channel::IMAGE_PIN), 512) {
        Ok(None) => Pin::Absent,
        Ok(Some(text)) if !text.trim().is_empty() && text.trim().lines().count() == 1 => Pin::Present(text.trim().to_owned()),
        _ => Pin::Invalid,
    }
}

fn valid_digest(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hex| hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
}

/// The digest named after `ghcr.io/leopu00/jht@` in a text (the compose file's `image:` line, the image pin), if it is one.
fn digest_in(text: &str) -> Option<String> {
    let at = text.find(IMAGE_BY_DIGEST)? + IMAGE_BY_DIGEST.len();
    let candidate = format!("sha256:{}", text.get(at..at + 64)?);
    valid_digest(&candidate).then_some(candidate)
}

/// The digest of the release pin text: `{"digest": "sha256:..."}`.
fn release_digest_of(text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    let digest = value.get("digest")?.as_str()?;
    valid_digest(digest).then(|| digest.to_owned())
}

fn short(digest: &str) -> String {
    digest.trim_start_matches("sha256:").chars().take(12).collect()
}

fn check_outcome(mode: Mode, installed: &str, build: &str) -> TeamUpdateOutcome {
    TeamUpdateOutcome {
        ok: true,
        changed: installed != build,
        phase: "check",
        reason: None,
        rolled_back: false,
        restart_required: false,
        previous_version: String::new(),
        current_version: String::new(),
        image_id: format!("{}:{}", short(installed), short(build)),
        mode: mode.word(),
    }
}

/// The notice on a production install, with no process and no download: the image the host's compose file names
/// (a small file the installer and `jht upgrade` write) against the one this build was made for (its release pin).
/// Different means the team is not on the image of this build; the page tells it once for each pair it has compared.
pub(crate) fn production_check(runtime_dir: &Path) -> Result<TeamUpdateOutcome, &'static str> {
    let build = release_digest_of(RELEASE_PIN).ok_or("team_update_runtime_invalid")?;
    let compose = read_small(&runtime_dir.join("docker-compose.yml"), SMALL_FILE_MAX)
        .ok()
        .flatten()
        .ok_or("team_update_runtime_invalid")?;
    let installed = digest_in(&compose).ok_or("team_update_runtime_invalid")?;
    Ok(check_outcome(Mode::Upgrade, &installed, &build))
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

/// The notice on a test install: the digest behind the pin against the build's own. It is the only thing the pin tells.
/// Two commits that share one image (a moving tag) look the same here, so a test build warns only when the image is
/// different, and an explicit update still runs the installer.
pub(crate) fn reinstall_check(pin: &str, channel: &TestChannel) -> TeamUpdateOutcome {
    check_outcome(Mode::Reinstall, &digest_in(pin).unwrap_or_default(), &channel.image_digest)
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
        image_id: String::new(),
        mode: Mode::Reinstall.word(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::release_channel_rules::resolve;

    const SHA: &str = "0123456789abcdef0123456789abcdef01234567";
    const DIGEST: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    fn other() -> String {
        format!("sha256:{}", "b".repeat(64))
    }
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
                image_id: String::new(),
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
        let older = reinstall_check(&format!("ghcr.io/leopu00/jht@{}", other()), &test);
        assert!(older.changed && older.ok);
        assert_eq!((older.phase, older.mode), ("check", "reinstall"));
        assert_eq!(older.image_id, "bbbbbbbbbbbb:aaaaaaaaaaaa");
        // a pin that names no digest is a difference, never a silent «same»
        assert!(reinstall_check("something else", &test).changed);
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

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("jht-team-update-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn compose_with(digest: &str) -> String {
        format!("services:\n  jht:\n    image: &jht-image ${{JHT_IMAGE:-ghcr.io/leopu00/jht@{digest}}}\n  other:\n    image: *jht-image\n")
    }

    #[test]
    fn the_release_pin_of_the_build_is_a_digest() {
        let pin = release_digest_of(RELEASE_PIN).expect("release/runtime-image.v1.json carries a sha256 digest");
        assert!(valid_digest(&pin));
        assert!(release_digest_of("not json").is_none());
        assert!(release_digest_of(r#"{"digest":"sha256:abc"}"#).is_none());
        assert!(release_digest_of(r#"{"other":1}"#).is_none());
    }

    #[test]
    fn the_notice_compares_the_composes_digest_with_the_builds_and_reads_no_process_and_no_network() {
        let dir = temp_dir("production");
        let build = release_digest_of(RELEASE_PIN).unwrap();
        std::fs::write(dir.join("docker-compose.yml"), compose_with(&build)).unwrap();
        let same = production_check(&dir).unwrap();
        assert!(same.ok && !same.changed);
        assert_eq!((same.phase, same.mode, same.reason), ("check", "upgrade", None));
        assert_eq!(same.image_id, format!("{0}:{0}", short(&build)));
        std::fs::write(dir.join("docker-compose.yml"), compose_with(&other())).unwrap();
        let older = production_check(&dir).unwrap();
        assert!(older.changed);
        assert_eq!(older.image_id, format!("bbbbbbbbbbbb:{}", short(&build)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_compose_that_is_missing_empty_big_or_names_no_digest_is_no_answer() {
        let dir = temp_dir("production-bad");
        let compose = dir.join("docker-compose.yml");
        assert_eq!(production_check(&dir).unwrap_err(), "team_update_runtime_invalid");
        std::fs::write(&compose, "").unwrap();
        assert!(production_check(&dir).is_err());
        std::fs::write(&compose, "image: ghcr.io/leopu00/jht:latest\n").unwrap();
        assert!(production_check(&dir).is_err());
        std::fs::write(&compose, "x".repeat(SMALL_FILE_MAX as usize + 1)).unwrap();
        assert!(production_check(&dir).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_never_read_as_the_compose_or_the_pin() {
        let dir = temp_dir("links");
        let real = dir.join("real");
        std::fs::write(&real, compose_with(&other())).unwrap();
        std::os::unix::fs::symlink(&real, dir.join("docker-compose.yml")).unwrap();
        assert!(production_check(&dir).is_err());
        std::os::unix::fs::symlink(&real, dir.join(crate::release_channel::IMAGE_PIN)).unwrap();
        assert_eq!(read_pin(&dir), Pin::Invalid);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_digest_is_taken_only_when_it_is_a_whole_one() {
        assert_eq!(digest_in(&format!("x ghcr.io/leopu00/jht@{}", other())), Some(other()));
        assert_eq!(digest_in("ghcr.io/leopu00/jht@sha256:abc"), None);
        assert_eq!(digest_in(&format!("ghcr.io/leopu00/jht@sha256:{}", "G".repeat(64))), None);
        assert_eq!(digest_in("ghcr.io/leopu00/other@sha256:aaaa"), None);
    }

    #[test]
    fn the_command_for_a_vps_is_the_one_every_other_action_on_it_uses_for_this_line() {
        assert_eq!(REMOTE_UPGRADE, crate::agent_control::own_vps_wrapper(UPGRADE_PROTOCOL, "upgrade --json </dev/null"));
        assert!(!REMOTE_UPGRADE.contains("--check"));
    }
}

//! Official in-app registration of the verified target of an already existing
//! team, for a profile that has none yet.
//!
//! Two native commands, both bound to the active account scope:
//! `onboarding_existing_team_discover` reads the VPS (docker inspection plus the
//! existing team probe) and writes nothing; `onboarding_existing_team_register`
//! re-discovers and writes ONLY the candidate, never replacing one. The
//! existing read-only connection then probes and selects as it always did.
//!
//! What it trusts: the container the VPS reports for the team id, on a host whose
//! SSH key the person has ALREADY pinned. It never scans, pins or accepts a host
//! key. `RepoDigests` is metadata local to the VPS: it guards against picking the
//! wrong container, not against a compromised host.
//!
//! Known limits, by design:
//! - the candidate is immutable and there is no way out in the app: after the VPS
//!   updates the JHT image every use ends in exit 70 for good and `register`
//!   refuses (a candidate exists). Replacing it would be an explicit, confirmed
//!   step that removes candidate and selection together, never a silent overwrite;
//! - the team probe also runs inside the JHT containers of OTHER teams on the
//!   same VPS (a fixed script, only its exit code is read). An exit 70 on any of
//!   them (a replaced container, a Docker too old for `docker image inspect
//!   --platform`, which `command()` uses) stops the whole discovery;
//! - the profile's own scope is the only one touched; Windows (hard links on
//!   NTFS, ssh) is not verified.

use crate::{
    account_scope::{AccountScope, AccountScopeState},
    existing_team_runtime::{self as runtime, CandidateWrite, RuntimeTarget},
    onboarding::{
        existing_team_readonly_probe_with, failure, valid_team_id, OnboardingError,
        OnboardingNativeState,
    },
    runtime_host::{
        pinned_host_fingerprint, run_ssh_command, validate_host_for_scope, ExecutionHost,
        ProcessResult, ValidatedHost,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::State;

/// The only repository a team container may come from. An entry of `RepoDigests`
/// counts only if it is exactly this prefix and 64 lowercase hex characters.
const REPOSITORY_PREFIX: &str = "ghcr.io/leopu00/jht@sha256:";
const MAX_CONTAINERS: usize = 32;
const MAX_TARGETS: usize = 4;
const MAX_LINES: usize = 100;
const MAX_LINE_BYTES: usize = 2048;
const MAX_REPLY_BYTES: usize = 65536;
const MAX_PROBE_BYTES: usize = 4096;
const MAX_DIGEST_FIELD_BYTES: usize = 1024;
const MAX_DIGEST_ENTRIES: usize = 16;
const DISCOVER_BUDGET: Duration = Duration::from_secs(40);
const REGISTER_BUDGET: Duration = Duration::from_secs(60);
const DISCOVERY_CALL: Duration = Duration::from_secs(20);
const PROBE_CALL: Duration = Duration::from_secs(12);
/// No SSH call is started with less time than this left.
const MIN_RESIDUAL: Duration = Duration::from_secs(2);
const RECEIPT_TTL: Duration = Duration::from_secs(10 * 60);
const UNAVAILABLE: &str = "existing_team_unavailable";

/// ONE constant, with no variable part: the team id is not in it. It lists the
/// running containers (at most 32, decided before any loop), then one record
/// per container, one per distinct image and, only for the containers whose
/// image carries a `ghcr.io/leopu00/jht@sha256:` RepoDigest, the manifest
/// descriptor; `END` with the counts is printed last and only if everything
/// before it was printed. Any failure that would leave the list of containers
/// incomplete exits 71 without `END`. The local parse, not this script, is the
/// authority: every field is validated again there.
pub(crate) const DISCOVERY_SCRIPT: &str = r#"set -u
set -f
IDS="$(docker ps --no-trunc --quiet)" || exit 71
N=0
for JHT_ID in $IDS; do
  case "$JHT_ID" in ""|*[!0-9a-f]*) exit 71 ;; esac
  [ "${#JHT_ID}" -eq 64 ] || exit 71
  N=$((N + 1))
  if [ "$N" -gt 32 ]; then printf 'OVERFLOW|%s\n' "$N"; exit 0; fi
done
NP=0; NI=0; ND=0; PAIRS=""; IMAGES=" "; GHCR=" "
for JHT_ID in $IDS; do
  JHT_ROW="$(docker inspect --type container --format '{{.Image}}|{{.State.Running}}' "$JHT_ID")" || exit 71
  JHT_IMAGE="${JHT_ROW%%|*}"
  JHT_RUNNING="${JHT_ROW#*|}"
  JHT_HASH="${JHT_IMAGE#sha256:}"
  case "$JHT_IMAGE" in sha256:*) ;; *) exit 71 ;; esac
  case "$JHT_HASH" in ""|*[!0-9a-f]*) exit 71 ;; esac
  [ "${#JHT_HASH}" -eq 64 ] || exit 71
  case "$JHT_RUNNING" in true|false) ;; *) exit 71 ;; esac
  printf 'P|%s|%s|%s\n' "$JHT_ID" "$JHT_IMAGE" "$JHT_RUNNING"
  NP=$((NP + 1))
  PAIRS="$PAIRS $JHT_ID=$JHT_IMAGE"
  case "$IMAGES" in *" $JHT_IMAGE "*) ;; *) IMAGES="$IMAGES$JHT_IMAGE " ;; esac
done
for JHT_IMAGE in $IMAGES; do
  JHT_INFO="$(docker image inspect --format '{{.Id}}|{{.Os}}/{{.Architecture}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{range .RepoDigests}}{{.}},{{end}}' "$JHT_IMAGE" 2>/dev/null)" || JHT_INFO=""
  JHT_GOOD=1
  JHT_F1="${JHT_INFO%%|*}"; JHT_REST="${JHT_INFO#*|}"
  JHT_OSARCH="${JHT_REST%%|*}"; JHT_REST="${JHT_REST#*|}"
  JHT_REV="${JHT_REST%%|*}"; JHT_DIGESTS="${JHT_REST#*|}"
  [ "$JHT_F1" = "$JHT_IMAGE" ] || JHT_GOOD=0
  case "$JHT_OSARCH" in ""|*[!A-Za-z0-9./_-]*) JHT_GOOD=0 ;; esac
  [ "${#JHT_OSARCH}" -le 32 ] || JHT_GOOD=0
  case "$JHT_REV" in ""|*[!0-9a-f]*) JHT_REV=- ;; *) [ "${#JHT_REV}" -eq 40 ] || JHT_REV=- ;; esac
  [ -n "$JHT_DIGESTS" ] || JHT_DIGESTS=-
  case "$JHT_DIGESTS" in *[!A-Za-z0-9.:/@_,-]*) JHT_GOOD=0 ;; esac
  [ "${#JHT_DIGESTS}" -le 1024 ] || JHT_GOOD=0
  if [ "$JHT_GOOD" -eq 1 ]; then
    printf 'I|%s|%s|%s|%s\n' "$JHT_IMAGE" "$JHT_OSARCH" "$JHT_REV" "$JHT_DIGESTS"
    case ",$JHT_DIGESTS" in *,ghcr.io/leopu00/jht@sha256:*) GHCR="$GHCR$JHT_IMAGE " ;; esac
  else
    printf 'I|%s|-|-|-\n' "$JHT_IMAGE"
  fi
  NI=$((NI + 1))
done
for JHT_PAIR in $PAIRS; do
  JHT_ID="${JHT_PAIR%%=*}"
  JHT_IMAGE="${JHT_PAIR#*=}"
  case "$GHCR" in *" $JHT_IMAGE "*) ;; *) continue ;; esac
  JHT_DESC="$(docker inspect --type container --format '{{index .ImageManifestDescriptor "digest"}}' "$JHT_ID" 2>/dev/null)" || JHT_DESC=-
  JHT_DH="${JHT_DESC#sha256:}"
  case "$JHT_DESC" in sha256:*) ;; *) JHT_DESC=- ;; esac
  case "$JHT_DH" in ""|*[!0-9a-f]*) JHT_DESC=- ;; esac
  [ "${#JHT_DH}" -eq 64 ] || JHT_DESC=-
  printf 'D|%s|%s\n' "$JHT_ID" "$JHT_DESC"
  ND=$((ND + 1))
done
printf 'END|%s|%s|%s\n' "$NP" "$NI" "$ND"
"#;

type Runner<'a> =
    dyn FnMut(&ValidatedHost, &str, Option<&[u8]>, Duration) -> Result<ProcessResult, &'static str>
        + 'a;

/// A total deadline for one operation. `elapsed` is injected so the tests can
/// drive a slow server without waiting.
pub(crate) struct Budget<'a> {
    pub(crate) total: Duration,
    pub(crate) elapsed: &'a dyn Fn() -> Duration,
}

impl Budget<'_> {
    fn remaining(&self) -> Duration {
        self.total.saturating_sub((self.elapsed)())
    }

    /// The timeout for the next call, or the end of the operation.
    fn call(&self, per_call: Duration) -> Result<Duration, &'static str> {
        let remaining = self.remaining();
        if remaining < MIN_RESIDUAL {
            return Err("existing_team_discovery_timeout");
        }
        Ok(per_call.min(remaining))
    }

    /// Nothing is written once the time is spent.
    fn check(&self) -> Result<(), &'static str> {
        if self.remaining().is_zero() {
            Err("existing_team_discovery_timeout")
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Container {
    id: String,
    image: String,
    running: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ImageRecord {
    Unreadable,
    Readable {
        os_arch: String,
        revision: Option<String>,
        repo_digests: Vec<String>,
    },
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Discovery {
    containers: Vec<Container>,
    images: BTreeMap<String, ImageRecord>,
    /// `None`: the descriptor could not be read.
    descriptors: BTreeMap<String, Option<String>>,
}

fn image_id(value: &str) -> bool {
    value
        .strip_prefix("sha256:")
        .is_some_and(|hash| runtime::hex(hash, 64))
}

fn digits(value: &str) -> Option<usize> {
    (!value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| value.parse().ok())
        .flatten()
}

fn os_arch_field(value: &str) -> bool {
    (1..=32).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'/' | b'_' | b'-'))
}

fn digest_entries(value: &str) -> Option<Vec<String>> {
    if value == "-" {
        return Some(Vec::new());
    }
    if value.len() > MAX_DIGEST_FIELD_BYTES {
        return None;
    }
    let list = value.strip_suffix(',')?;
    let entries: Vec<String> = list.split(',').map(str::to_owned).collect();
    let valid = (1..=MAX_DIGEST_ENTRIES).contains(&entries.len())
        && entries.iter().all(|entry| {
            (1..=256).contains(&entry.len())
                && entry.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b':' | b'/' | b'@' | b'_' | b'-')
                })
        });
    valid.then_some(entries)
}

#[derive(PartialEq, PartialOrd, Clone, Copy)]
enum Stage {
    Containers,
    Images,
    Descriptors,
    End,
}

/// Reads the whole reply or refuses all of it. A partial list is never read as
/// complete: it needs exit 0, the closing `END` as the last line with counts
/// that match, one record for every container and every distinct image, and a
/// descriptor record for exactly the containers that should have one.
pub(crate) fn parse_discovery(reply: &ProcessResult) -> Result<Discovery, &'static str> {
    if !reply.success() || reply.stdout.len() > MAX_REPLY_BYTES {
        return Err(UNAVAILABLE);
    }
    let text = std::str::from_utf8(&reply.stdout).map_err(|_| UNAVAILABLE)?;
    let body = text.strip_suffix('\n').ok_or(UNAVAILABLE)?;
    let lines: Vec<&str> = body.split('\n').collect();
    if lines.len() > MAX_LINES
        || lines
            .iter()
            .any(|line| line.is_empty() || line.len() > MAX_LINE_BYTES)
    {
        return Err(UNAVAILABLE);
    }
    if let Some(count) = lines[0].strip_prefix("OVERFLOW|") {
        return match digits(count) {
            Some(count) if lines.len() == 1 && count > MAX_CONTAINERS => {
                Err("existing_team_too_many_containers")
            }
            _ => Err(UNAVAILABLE),
        };
    }
    let mut stage = Stage::Containers;
    let mut containers: Vec<Container> = Vec::new();
    let mut images: BTreeMap<String, ImageRecord> = BTreeMap::new();
    let mut descriptors: BTreeMap<String, Option<String>> = BTreeMap::new();
    let mut counts: Option<(usize, usize, usize)> = None;
    for line in &lines {
        if stage == Stage::End {
            return Err(UNAVAILABLE);
        }
        let fields: Vec<&str> = line.split('|').collect();
        match fields[0] {
            "P" => {
                if stage != Stage::Containers || fields.len() != 4 {
                    return Err(UNAVAILABLE);
                }
                let (id, image, running) = (fields[1], fields[2], fields[3]);
                let running = match running {
                    "true" => true,
                    "false" => false,
                    _ => return Err(UNAVAILABLE),
                };
                if !runtime::hex(id, 64)
                    || !image_id(image)
                    || containers.iter().any(|known| known.id == id)
                    || containers.len() >= MAX_CONTAINERS
                {
                    return Err(UNAVAILABLE);
                }
                containers.push(Container {
                    id: id.to_owned(),
                    image: image.to_owned(),
                    running,
                });
            }
            "I" => {
                if stage > Stage::Images || fields.len() != 5 {
                    return Err(UNAVAILABLE);
                }
                stage = Stage::Images;
                let image = fields[1];
                if !image_id(image) || images.contains_key(image) {
                    return Err(UNAVAILABLE);
                }
                let record = if fields[2..5] == ["-", "-", "-"] {
                    ImageRecord::Unreadable
                } else {
                    let revision = match fields[3] {
                        "-" => None,
                        value if runtime::hex(value, 40) => Some(value.to_owned()),
                        _ => return Err(UNAVAILABLE),
                    };
                    if !os_arch_field(fields[2]) {
                        return Err(UNAVAILABLE);
                    }
                    ImageRecord::Readable {
                        os_arch: fields[2].to_owned(),
                        revision,
                        repo_digests: digest_entries(fields[4]).ok_or(UNAVAILABLE)?,
                    }
                };
                images.insert(image.to_owned(), record);
            }
            "D" => {
                if stage > Stage::Descriptors || fields.len() != 3 {
                    return Err(UNAVAILABLE);
                }
                stage = Stage::Descriptors;
                let (id, descriptor) = (fields[1], fields[2]);
                if !containers.iter().any(|known| known.id == id)
                    || descriptors.contains_key(id)
                {
                    return Err(UNAVAILABLE);
                }
                let descriptor = match descriptor {
                    "-" => None,
                    value if image_id(value) => Some(value.to_owned()),
                    _ => return Err(UNAVAILABLE),
                };
                descriptors.insert(id.to_owned(), descriptor);
            }
            "END" => {
                if fields.len() != 4 {
                    return Err(UNAVAILABLE);
                }
                stage = Stage::End;
                counts = Some((
                    digits(fields[1]).ok_or(UNAVAILABLE)?,
                    digits(fields[2]).ok_or(UNAVAILABLE)?,
                    digits(fields[3]).ok_or(UNAVAILABLE)?,
                ));
            }
            _ => return Err(UNAVAILABLE),
        }
    }
    let (declared_containers, declared_images, declared_descriptors) =
        counts.ok_or(UNAVAILABLE)?;
    if declared_containers != containers.len()
        || declared_images != images.len()
        || declared_descriptors != descriptors.len()
    {
        return Err(UNAVAILABLE);
    }
    // One image record for every distinct image of the containers, no other.
    let used: BTreeSet<&str> = containers.iter().map(|c| c.image.as_str()).collect();
    let recorded: BTreeSet<&str> = images.keys().map(String::as_str).collect();
    if used != recorded {
        return Err(UNAVAILABLE);
    }
    // A descriptor for exactly the containers whose image carries a ghcr entry.
    let expected: BTreeSet<&str> = containers
        .iter()
        .filter(|container| {
            matches!(
                images.get(&container.image),
                Some(ImageRecord::Readable { repo_digests, .. })
                    if repo_digests.iter().any(|entry| entry.starts_with(REPOSITORY_PREFIX))
            )
        })
        .map(|container| container.id.as_str())
        .collect();
    let described: BTreeSet<&str> = descriptors.keys().map(String::as_str).collect();
    if expected != described {
        return Err(UNAVAILABLE);
    }
    Ok(Discovery {
        containers,
        images,
        descriptors,
    })
}

fn ghcr_digest(entry: &str) -> Option<String> {
    let hash = entry.strip_prefix(REPOSITORY_PREFIX)?;
    runtime::hex(hash, 64).then(|| format!("sha256:{hash}"))
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Classified {
    pub(crate) targets: Vec<RuntimeTarget>,
    /// Containers that could be the team's but cannot be pinned (an unreadable
    /// image or descriptor, a ghcr-looking entry that is not valid): unusable
    /// by `command()` anyway, so ignored, but never the reason for "not found".
    pub(crate) unusable: usize,
}

/// Picks the containers a team may live in. A container is a candidate only if
/// every field `command()` will check is readable and valid; the repository is
/// the fixed one and the image has exactly one valid digest of it.
pub(crate) fn classify(discovery: &Discovery) -> Result<Classified, &'static str> {
    let mut targets = Vec::new();
    let mut unusable = 0;
    for container in &discovery.containers {
        if !container.running {
            continue;
        }
        let Some(record) = discovery.images.get(&container.image) else {
            return Err(UNAVAILABLE);
        };
        let ImageRecord::Readable {
            os_arch,
            revision,
            repo_digests,
        } = record
        else {
            unusable += 1;
            continue;
        };
        if !repo_digests
            .iter()
            .any(|entry| entry.starts_with(REPOSITORY_PREFIX))
        {
            continue;
        }
        let valid: BTreeSet<String> = repo_digests
            .iter()
            .filter_map(|entry| ghcr_digest(entry))
            .collect();
        let digest = match valid.len() {
            0 => {
                unusable += 1;
                continue;
            }
            1 => valid.into_iter().next().expect("one digest"),
            _ => return Err("existing_team_image_unattested"),
        };
        let Some(Some(descriptor)) = discovery.descriptors.get(&container.id) else {
            unusable += 1;
            continue;
        };
        let (Some(revision), Some(architecture)) = (revision, os_arch.strip_prefix("linux/"))
        else {
            unusable += 1;
            continue;
        };
        let target = RuntimeTarget {
            container_id: container.id.clone(),
            image_id: container.image.clone(),
            platform_image_id: descriptor.clone(),
            oci_revision: revision.clone(),
            digest,
            os: "linux".to_owned(),
            architecture: architecture.to_owned(),
        };
        if runtime::valid_target(&target) {
            targets.push(target);
        } else {
            unusable += 1;
        }
    }
    if targets.len() > MAX_TARGETS {
        return Err("existing_team_ambiguous");
    }
    Ok(Classified { targets, unusable })
}

/// What a successful discovery hands to the person and to `register`.
#[derive(Debug)]
pub(crate) struct Found {
    pub(crate) runtime: RuntimeTarget,
    /// Whether the ASSISTENTE session is up. Informative: not part of any comparison.
    pub(crate) readiness: bool,
    pub(crate) candidate: Vec<u8>,
    pub(crate) candidate_sha256: String,
    pub(crate) fingerprint: Option<String>,
}

fn run_call(
    run: &mut Runner<'_>,
    host: &ValidatedHost,
    command: &str,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, &'static str> {
    run(host, command, input, timeout).map_err(|error| match error {
        "process_timeout" => "existing_team_discovery_timeout",
        _ => UNAVAILABLE,
    })
}

/// Read-only discovery of the container of `team_id` on `host`. Local checks
/// that need no network come first and write nothing; then one SSH call lists
/// the containers and at most four calls run the existing team probe on the
/// validated JHT targets. Exactly one target may answer for the team.
pub(crate) fn discover_with(
    root: &Path,
    scope: &AccountScope,
    host: &ExecutionHost,
    team_id: &str,
    validate_host: &mut dyn FnMut() -> Result<ValidatedHost, &'static str>,
    run: &mut Runner<'_>,
    budget: &Budget<'_>,
) -> Result<Found, &'static str> {
    if !matches!(host, ExecutionHost::Vps { .. }) {
        return Err("existing_team_vps_required");
    }
    if !valid_team_id(team_id) {
        return Err("invalid_team_id");
    }
    runtime::registration_gate_at(root, scope)?;
    let validated = validate_host()?;
    let timeout = budget.call(DISCOVERY_CALL)?;
    let reply = run_call(run, &validated, DISCOVERY_SCRIPT, None, timeout)?;
    let discovery = parse_discovery(&reply)?;
    let classified = classify(&discovery)?;
    if classified.targets.is_empty() {
        return Err(if classified.unusable > 0 {
            UNAVAILABLE
        } else {
            "existing_team_container_not_found"
        });
    }
    // Identity first, captain second: two containers of the same team are
    // ambiguous even if only one has the captain up.
    let mut matches: Vec<(RuntimeTarget, Option<bool>)> = Vec::new();
    for target in &classified.targets {
        let command = runtime::team_probe_command(target)?;
        let timeout = budget.call(PROBE_CALL)?;
        let outcome = existing_team_readonly_probe_with(team_id, |input| {
            let result = run(&validated, &command, Some(input), timeout)?;
            if result.stdout.len() > MAX_PROBE_BYTES {
                return Err("process_output_unavailable");
            }
            Ok(result)
        });
        match outcome {
            Ok(readiness) => matches.push((target.clone(), Some(readiness.readiness))),
            Err(error) => match error.code {
                "existing_team_identity_mismatch" => {}
                "existing_team_not_active" => matches.push((target.clone(), None)),
                _ => return Err(UNAVAILABLE),
            },
        }
    }
    if matches.len() > 1 {
        return Err("existing_team_ambiguous");
    }
    let Some((target, readiness)) = matches.pop() else {
        return Err("existing_team_not_found");
    };
    let Some(readiness) = readiness else {
        return Err("existing_team_not_active");
    };
    let (candidate, candidate_sha256) = runtime::candidate_bytes(host, team_id, &target)?;
    budget.check()?;
    Ok(Found {
        runtime: target,
        readiness,
        candidate,
        candidate_sha256,
        fingerprint: pinned_host_fingerprint(&validated).ok(),
    })
}

/// Re-discovers and compares with what the person confirmed, then publishes the
/// candidate without ever replacing one.
pub(crate) fn register_with(
    root: &Path,
    scope: &AccountScope,
    receipt: &Receipt,
    validate_host: &mut dyn FnMut() -> Result<ValidatedHost, &'static str>,
    run: &mut Runner<'_>,
    budget: &Budget<'_>,
) -> Result<CandidateWrite, &'static str> {
    let found = discover_with(
        root,
        scope,
        &receipt.host,
        &receipt.team_id,
        validate_host,
        run,
        budget,
    )?;
    if found.candidate_sha256 != receipt.candidate_sha256 {
        return Err("existing_team_target_changed");
    }
    runtime::write_candidate_at(root, scope, &found.candidate)
}

/// What the last successful discovery left in memory. It is the authority for
/// `register`: the renderer sends only the hash it was shown.
#[derive(Clone, Debug)]
pub(crate) struct Receipt {
    pub(crate) scope_digest: String,
    pub(crate) host: ExecutionHost,
    pub(crate) team_id: String,
    pub(crate) candidate_sha256: String,
    pub(crate) at: Instant,
}

pub(crate) fn receipt_store(slot: &Mutex<Option<Receipt>>, receipt: Receipt) {
    if let Ok(mut current) = slot.lock() {
        *current = Some(receipt);
    }
}

pub(crate) fn receipt_clear(slot: &Mutex<Option<Receipt>>) {
    if let Ok(mut current) = slot.lock() {
        *current = None;
    }
}

pub(crate) fn receipt_for(
    slot: &Mutex<Option<Receipt>>,
    scope: &AccountScope,
    candidate_sha256: &str,
    now: Instant,
) -> Result<Receipt, &'static str> {
    let mut current = slot.lock().map_err(|_| "existing_team_receipt_required")?;
    let Some(receipt) = current.clone() else {
        return Err("existing_team_receipt_required");
    };
    if now.saturating_duration_since(receipt.at) > RECEIPT_TTL {
        *current = None;
        return Err("existing_team_receipt_required");
    }
    if receipt.scope_digest != scope.digest() {
        return Err("account_scope_changed");
    }
    if receipt.candidate_sha256 != candidate_sha256 {
        return Err("existing_team_receipt_required");
    }
    Ok(receipt)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExistingTeamDiscoverRequest {
    team_id: String,
    host: ExecutionHost,
}

/// Only what `register` is allowed to take from the renderer: the hash it was
/// shown and the person's confirmation. Host and team come from memory.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExistingTeamRegisterRequest {
    candidate_sha256: String,
    confirmed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExistingTeamReceipt {
    team_id: String,
    host_address: String,
    host_port: u16,
    ssh_fingerprint: Option<String>,
    container_id: String,
    image_id: String,
    platform_image_id: String,
    oci_revision: String,
    digest: String,
    candidate_sha256: String,
    readiness: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExistingTeamRegisterReply {
    outcome: &'static str,
}

fn receipt_view(request: &ExistingTeamDiscoverRequest, found: &Found) -> ExistingTeamReceipt {
    let (host_address, host_port) = match &request.host {
        ExecutionHost::Vps { address, port, .. } => (address.clone(), *port),
        ExecutionHost::Local => (String::new(), 0),
    };
    ExistingTeamReceipt {
        team_id: request.team_id.clone(),
        host_address,
        host_port,
        ssh_fingerprint: found.fingerprint.clone(),
        container_id: found.runtime.container_id.clone(),
        image_id: found.runtime.image_id.clone(),
        platform_image_id: found.runtime.platform_image_id.clone(),
        oci_revision: found.runtime.oci_revision.clone(),
        digest: found.runtime.digest.clone(),
        candidate_sha256: found.candidate_sha256.clone(),
        readiness: found.readiness,
    }
}

/// Read-only: finds the container of the team on a VPS whose SSH key is
/// already pinned, and shows what the server says about it. Writes nothing
/// except an in-memory receipt.
#[tauri::command]
pub(crate) async fn onboarding_existing_team_discover(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
    request: ExistingTeamDiscoverRequest,
) -> Result<ExistingTeamReceipt, OnboardingError> {
    let expected = scopes.active().map_err(failure)?;
    if !matches!(&request.host, ExecutionHost::Vps { .. }) {
        return Err(failure("existing_team_vps_required"));
    }
    if !valid_team_id(&request.team_id) {
        return Err(failure("invalid_team_id"));
    }
    if !state.try_begin() {
        return Err(failure("operation_in_progress"));
    }
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let worker_host = request.host.clone();
    let worker_team = request.team_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(|code| code)?;
        let root = runtime::root(&app)?;
        let started = Instant::now();
        let elapsed = || started.elapsed();
        let budget = Budget {
            total: DISCOVER_BUDGET,
            elapsed: &elapsed,
        };
        discover_with(
            &root,
            &worker_expected,
            &worker_host,
            &worker_team,
            &mut || validate_host_for_scope(&app, &worker_host, &worker_expected),
            &mut |host, command, input, timeout| run_ssh_command(host, command, input, timeout, None),
            &budget,
        )
    })
    .await
    .unwrap_or(Err(UNAVAILABLE));
    state.finish();
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    let found = result.map_err(failure)?;
    receipt_store(
        &state.receipt,
        Receipt {
            scope_digest: expected.digest().to_owned(),
            host: request.host.clone(),
            team_id: request.team_id.clone(),
            candidate_sha256: found.candidate_sha256.clone(),
            at: Instant::now(),
        },
    );
    Ok(receipt_view(&request, &found))
}

/// Writes ONLY the candidate, and only if the scope has neither a candidate nor
/// a selection. The request carries the hash the person saw and the person's
/// confirmation; host and team come from the receipt kept in memory. This is a
/// renderer-confirmed authority, at the level of `onboarding_ssh_host_key_confirm`
/// and the `confirmed` flag of the assistant start: the confirmation is a UI
/// control, not a defence against a hostile renderer.
#[tauri::command]
pub(crate) async fn onboarding_existing_team_register(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
    request: ExistingTeamRegisterRequest,
) -> Result<ExistingTeamRegisterReply, OnboardingError> {
    let expected = scopes.active().map_err(failure)?;
    if !request.confirmed {
        return Err(failure("existing_team_register_not_confirmed"));
    }
    let root = runtime::root(&app).map_err(failure)?;
    runtime::registration_gate_at(&root, &expected).map_err(failure)?;
    let receipt = receipt_for(&state.receipt, &expected, &request.candidate_sha256, Instant::now())
        .map_err(failure)?;
    if !state.try_begin() {
        return Err(failure("operation_in_progress"));
    }
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let worker_receipt = receipt.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(|code| code)?;
        let started = Instant::now();
        let elapsed = || started.elapsed();
        let budget = Budget {
            total: REGISTER_BUDGET,
            elapsed: &elapsed,
        };
        register_with(
            &root,
            &worker_expected,
            &worker_receipt,
            &mut || validate_host_for_scope(&app, &worker_receipt.host, &worker_expected),
            &mut |host, command, input, timeout| run_ssh_command(host, command, input, timeout, None),
            &budget,
        )
    })
    .await
    .unwrap_or(Err(UNAVAILABLE));
    state.finish();
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    match result {
        Ok(written) => {
            receipt_clear(&state.receipt);
            Ok(ExistingTeamRegisterReply {
                outcome: match written {
                    CandidateWrite::Written => "registered",
                    CandidateWrite::Identical => "already_registered",
                },
            })
        }
        Err("existing_team_target_changed") => {
            receipt_clear(&state.receipt);
            Err(failure("existing_team_target_changed"))
        }
        Err(code) => Err(failure(code)),
    }
}

/// What the app needs to connect read-only with the target this profile already
/// has: the host (its key path included, because the read-only connection compares
/// the whole host with the candidate's) and the team. Nothing else of the candidate.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExistingTeamCandidateSummary {
    host: ExecutionHost,
    team_id: String,
}

pub(crate) fn candidate_summary_for(
    root: &Path,
    scope: &AccountScope,
) -> Result<Option<ExistingTeamCandidateSummary>, &'static str> {
    Ok(runtime::candidate_summary_at(root, scope)?
        .map(|(host, team_id)| ExistingTeamCandidateSummary { host, team_id }))
}

/// Read-only and local: no SSH, no write. `null` when the profile has no candidate.
#[tauri::command]
pub(crate) fn existing_team_candidate_summary(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<Option<ExistingTeamCandidateSummary>, OnboardingError> {
    let guard = scopes.lock_active().map_err(failure)?;
    let root = runtime::root(&app).map_err(failure)?;
    candidate_summary_for(&root, guard.scope()).map_err(failure)
}

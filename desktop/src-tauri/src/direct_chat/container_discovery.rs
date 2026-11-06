use super::*;

/// One and only one currently-running Compose service named `jht` is the chat target. On Podman the engine
/// is asked ONCE for the containers of the fixed JHT project and service, with their state, labels and image as
/// JSON (T191: the listing of ids and an `inspect` for each of the project's three containers took 4 to 5 s on a
/// Windows computer; the one listing takes one engine call). On Docker the compose listing is read and each id
/// inspected. Either way every candidate meets the same rules: `judge_candidate`.
pub(super) fn local_chat_container(
    engine: &LocalChatEngine,
    runtime: &Path,
    timeout: Duration,
) -> Result<String, &'static str> {
    #[cfg(target_os = "macos")]
    let expected_config_hash = engine.podman.then(|| mac_config_hash(runtime, timeout));
    #[cfg(not(target_os = "macos"))]
    let expected_config_hash: Option<Result<String, &'static str>> = None;
    let candidates = if engine.podman {
        listed_candidates(engine, timeout)?
    } else {
        inspected_candidates(engine, runtime, timeout)?
    };
    let mut found: Option<String> = None;
    // Why a container that is running as `jht` was not taken: it is not the one installed, or the check could
    // not be made (the hash it has to carry was not worked out) which is not the same thing.
    let mut refused: Option<&'static str> = None;
    let mut unchecked: Option<&'static str> = None;
    for candidate in candidates {
        // On Windows the image is part of the identity, and `inspect` is where it was always read from: a listing that
        // did not carry it, or carried one that is not the runtime's, is settled by one inspect of this container (a
        // listing that agrees costs nothing more).
        let image = if needs_image_inspect(cfg!(windows), engine.podman, &candidate, runtime) {
            inspected_image(engine, &candidate.id, timeout).or_else(|| candidate.image.clone())
        } else {
            candidate.image.clone()
        };
        match judge_candidate(engine, runtime, expected_config_hash.as_ref(), &candidate, image.as_deref()) {
            Verdict::Skip => {}
            Verdict::Unchecked(reason) => unchecked = Some(reason),
            Verdict::Refused(reason) => refused = Some(reason),
            Verdict::Take => {
                if found.replace(candidate.id).is_some() {
                    return Err("container_unavailable");
                }
            }
        }
    }
    // Why there is none, said apart: the team is not up, what is up is not the one the app's runtime
    // started (it is never used for the chat), or it could not be checked now (the page tries again).
    if let Some(id) = found {
        return Ok(id);
    }
    if let Some(reason) = refused.or(unchecked) {
        note_attest_reason(reason);
    }
    Err(container_not_found_code(refused, unchecked))
}

/// A container the engine listed for the project: what the rules judge.
pub(super) struct Candidate {
    pub(super) id: String,
    pub(super) running: bool,
    pub(super) labels: Value,
    /// Where the listing carries it (Podman's JSON does; the Docker path asks `inspect` for it on Windows only).
    pub(super) image: Option<String>,
}

impl Candidate {
    pub(super) fn service_is_jht(&self) -> bool {
        label(&self.labels, "com.docker.compose.service") == Some("jht")
    }
}

pub(super) enum Verdict {
    /// Not the chat's target (stopped, or another service).
    Skip,
    /// The chat's target.
    Take,
    /// Running as `jht` but not the installed one.
    Refused(&'static str),
    /// Running as `jht` but the check could not be made now.
    Unchecked(&'static str),
}

/// Whether the image a container reports is accepted: only Windows asks, where the labels alone are not an identity.
pub(super) fn image_is_accepted(windows: bool, image: Option<&str>, runtime: &Path) -> bool {
    !windows || image.is_some_and(|image| windows_container_image_is_the_runtimes(image, runtime))
}

/// Whether the listing's image is to be settled by an `inspect`: on Windows, for a Podman container that is running as
/// `jht`, when the listing carried no image or one that is not the runtime's (the inspect is where it was always read from).
pub(super) fn needs_image_inspect(windows: bool, podman: bool, candidate: &Candidate, runtime: &Path) -> bool {
    windows && podman && candidate.running && candidate.service_is_jht() && !image_is_accepted(windows, candidate.image.as_deref(), runtime)
}

/// The rules a container meets to be the chat's target, for the Podman listing and the Docker inspect alike:
/// running, the `jht` service, and (on Podman) the labels and, on Windows, the image of the installed runtime.
pub(super) fn judge_candidate(
    engine: &LocalChatEngine,
    runtime: &Path,
    expected_config_hash: Option<&Result<String, &'static str>>,
    candidate: &Candidate,
    image: Option<&str>,
) -> Verdict {
    if !candidate.running || !candidate.service_is_jht() {
        return Verdict::Skip;
    }
    let image_is_the_runtimes = image_is_accepted(cfg!(windows), image, runtime);
    if engine.podman {
        if let Some(reason) = attestation_refusal(expected_config_hash, &candidate.labels, runtime, image_is_the_runtimes) {
            return if attest_reason_may_pass(reason) { Verdict::Unchecked(reason) } else { Verdict::Refused(reason) };
        }
    }
    Verdict::Take
}

/// The Podman listing of the project's `jht` service: one engine call. A listing the engine could not give (the
/// machine is off, the connection is refused) is no container, as the listing of ids always was.
pub(super) fn listed_candidates(engine: &LocalChatEngine, timeout: Duration) -> Result<Vec<Candidate>, &'static str> {
    let listed = run_local_engine(engine, local_listing_args(), None, timeout)?;
    if !listed.success() {
        return Ok(Vec::new());
    }
    parse_listing(&listed.stdout)
}

/// The arguments of the one listing: every container (stopped ones too, so a stopped `jht` is told from none) that
/// carries the project's and the service's labels, whole ids, as JSON. No quote, no space in an argument.
pub(super) fn local_listing_args() -> Vec<OsString> {
    [
        "ps",
        "-a",
        "--no-trunc",
        "--filter",
        "label=com.docker.compose.project=jht",
        "--filter",
        "label=com.docker.compose.service=jht",
        "--format",
        "json",
    ]
    .map(OsString::from)
    .to_vec()
}

/// Podman's `ps --format json`: an array of objects with `Id`, `State`, `Labels` and `Image`. Anything else is an
/// engine the app does not know how to read: no container is taken from it.
pub(super) fn parse_listing(stdout: &[u8]) -> Result<Vec<Candidate>, &'static str> {
    let text = std::str::from_utf8(stdout).map_err(|_| "container_unavailable")?.trim();
    if text.is_empty() {
        return Ok(Vec::new());
    }
    let Ok(Value::Array(rows)) = serde_json::from_str::<Value>(text) else {
        return Err("container_unavailable");
    };
    if rows.len() > 16 {
        return Err("container_unavailable");
    }
    let mut candidates = Vec::with_capacity(rows.len());
    for row in rows {
        let Some(id) = row.get("Id").and_then(Value::as_str).filter(|id| container_id(id)) else {
            return Err("container_unavailable");
        };
        candidates.push(Candidate {
            id: id.to_owned(),
            running: row.get("State").and_then(Value::as_str).is_some_and(|state| state == "running"),
            labels: row.get("Labels").filter(|labels| labels.is_object()).cloned().unwrap_or(Value::Null),
            image: row.get("Image").and_then(Value::as_str).map(str::trim).filter(|image| !image.is_empty()).map(str::to_owned),
        });
    }
    Ok(candidates)
}

/// The Docker way: the compose listing of ids, then an `inspect` of each for its state, labels and, on Windows, image.
pub(super) fn inspected_candidates(engine: &LocalChatEngine, runtime: &Path, timeout: Duration) -> Result<Vec<Candidate>, &'static str> {
    let listed = run_local_engine(engine, local_compose_args(engine, runtime), None, timeout)?;
    let ids: Vec<&str> = std::str::from_utf8(&listed.stdout)
        .map_err(|_| "container_unavailable")?
        .lines()
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .collect();
    if ids.len() > 16 || ids.iter().any(|id| !container_id(id)) {
        return Err("container_unavailable");
    }
    let mut candidates = Vec::new();
    for id in ids {
        let inspected = run_local_engine(
            engine,
            [
                "inspect",
                "--type",
                "container",
                id,
                "--format",
                // On Windows the image too: the labels alone are not an identity there.
                if cfg!(windows) { "{{.State.Running}}|{{json .Config.Labels}}|{{.Config.Image}}" } else { "{{.State.Running}}|{{json .Config.Labels}}" },
            ],
            None,
            timeout,
        )?;
        if !inspected.success() {
            continue;
        }
        let Ok(line) = std::str::from_utf8(&inspected.stdout).map(str::trim) else {
            continue;
        };
        let Some((running, labels, image)) = split_inspected(line, cfg!(windows)) else {
            continue;
        };
        let Ok(labels) = serde_json::from_str::<Value>(labels) else {
            continue;
        };
        candidates.push(Candidate { id: id.to_owned(), running: running == "true", labels, image: image.filter(|image| !image.is_empty()).map(str::to_owned) });
    }
    Ok(candidates)
}

/// The image of a container, from one `inspect`: for a listing that did not carry it, on Windows.
pub(super) fn inspected_image(engine: &LocalChatEngine, id: &str, timeout: Duration) -> Option<String> {
    let inspected = run_local_engine(engine, ["inspect", "--type", "container", id, "--format", "{{.Config.Image}}"], None, timeout).ok()?;
    if !inspected.success() {
        return None;
    }
    let image = std::str::from_utf8(&inspected.stdout).ok()?.trim();
    (!image.is_empty()).then(|| image.to_owned())
}

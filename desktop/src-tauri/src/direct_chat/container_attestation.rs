use super::*;

/// The text the hash is worked out from, as the wrapper's `jht_load_host_values` takes its values: the file of the runtime folder when
/// it is trusted, else `host.env`; and a host type that does not come from that file (from `host.env`, or from the environment
/// because the file does not say it) goes through the rule of the Mac, a `vps` is a `local`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn text_the_wrapper_hashes(values: Option<String>, host_env: &dyn Fn() -> Option<String>, inherited: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let (text, type_from_values) = match values {
        Some(values) => {
            let says_type = wrapper_compose_environment(Some(&values), &|_| None).iter().any(|(key, value)| *key == "JHT_HOST_TYPE" && value != "unknown");
            (Some(values), says_type)
        }
        None => (host_env(), false),
    };
    if type_from_values {
        return text;
    }
    host_env_as_the_wrapper_records_it(text.as_deref(), inherited).or(text)
}

/// What the wrapper makes of a Mac whose host type in use is `vps` and does not come from its values file (from `host.env` or from the
/// environment): `local` (it tells it on the terminal and in `host-values.log`). The text of `host.env` followed by a
/// last valid line `JHT_HOST_TYPE=local`, which wins, or `None` when nothing changes.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn host_env_as_the_wrapper_records_it(host_env: Option<&str>, inherited: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    let vps = wrapper_compose_environment(host_env, inherited).iter().any(|(key, value)| *key == "JHT_HOST_TYPE" && value == "vps");
    vps.then(|| format!("{}\nJHT_HOST_TYPE=local\n", host_env.unwrap_or("")))
}

/// Whether the reason a check could not be made may pass by itself: the probe or the plan did not run or
/// did not answer, which is not the same as the container being another one.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn attest_reason_may_pass(reason: &str) -> bool {
    reason.ends_with("_unreadable") || matches!(reason, "hash_dry_run_exit" | "hash_dry_run_timeout" | "hash_dry_run_not_started" | "hash_plan_without_create")
}

/// `host_env` is the text of `host.env` and `inherited` the process environment, so that a test can say both.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn mac_config_hash_in(runtime: &Path, timeout: Duration, host_env: Option<&str>, inherited: &dyn Fn(&str) -> Option<String>) -> Result<String, &'static str> {
    let search = |name: &str| {
        #[cfg(test)]
        {
            let fixture = runtime.join("bin").join(name);
            if fs::symlink_metadata(&fixture).is_ok_and(|metadata| metadata.file_type().is_file()) {
                return Some(fixture);
            }
        }
        find_trusted_tool(name, &TOOL_ROOTS.map(Path::new))
    };
    let podman = search("podman").ok_or("hash_tool_missing")?;
    let compose = search("podman-compose").ok_or("hash_tool_missing")?;
    // podman-compose runs `podman` by name, and an app opened from Finder has `/usr/bin:/bin:/usr/sbin:/sbin`
    // for a PATH, without Homebrew's: its own version probe then said «No such file or directory: podman» and
    // the container looked like another one. The children get the directory of the podman that was found
    // and trusted in front of the PATH they have (the wrapper runs them with Homebrew in it).
    let path_with_podman = podman
        .parent()
        .and_then(|dir| std::env::join_paths(std::iter::once(dir.to_path_buf()).chain(std::env::var_os("PATH").iter().flat_map(std::env::split_paths))).ok())
        .and_then(|joined| joined.into_string().ok())
        .ok_or("hash_tool_missing")?;
    // A version that could not be read is not a version that differs.
    let podman_said = podman.to_str().and_then(|program| run_program(program, ["--version"], None, timeout).ok()).filter(|result| result.success()).and_then(|result| String::from_utf8(result.stdout).ok());
    match podman_said {
        None => return Err("hash_podman_version_unreadable"),
        Some(said) if said.trim() != "podman version 6.1.3" => return Err("hash_podman_version_differs"),
        Some(_) => {}
    }
    let machine = fs::read_to_string(runtime.join("podman-machine")).map_err(|_| "hash_machine_file")?;
    let machine = machine.strip_suffix('\n').ok_or("hash_machine_file")?;
    if machine.is_empty() || !machine.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')) { return Err("hash_machine_file"); }
    let compose_said = compose.to_str().and_then(|program| {
        let (result, stderr) = run_program_keeping_stderr_with_environment(program, ["--version"], None, timeout, runtime, &["CONTAINER_HOST", "CONTAINER_CONNECTION"], &[("CONTAINER_CONNECTION", machine), ("PATH", path_with_podman.as_str())]);
        let mut output = result.ok().filter(ProcessResult::success)?.stdout;
        output.extend_from_slice(&stderr);
        String::from_utf8(output).ok()
    });
    match compose_said {
        None => return Err("hash_compose_version_unreadable"),
        Some(said) if !said.lines().any(|line| line == "podman-compose version 1.6.0") => return Err("hash_compose_version_differs"),
        Some(_) => {}
    }
    let image = match fs::symlink_metadata(runtime.join("runtime-image")) {
        Ok(_) => {
            let image = fs::read_to_string(runtime.join("runtime-image")).map_err(|_| "hash_image_pin")?;
            let image = image.strip_suffix('\n').ok_or("hash_image_pin")?.to_owned();
            let digest = image.strip_prefix("ghcr.io/leopu00/jht@sha256:").ok_or("hash_image_pin")?;
            if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) { return Err("hash_image_pin"); }
            Some(image)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err("hash_image_pin"),
    };
    let args = vec![OsString::from("--verbose"), OsString::from("--dry-run"), OsString::from("--project-name"), OsString::from("jht"), OsString::from("--podman-path"), podman.into_os_string(), OsString::from("-f"), runtime.join("docker-compose.yml").into_os_string(), OsString::from("up"), OsString::from("-d"), OsString::from("--force-recreate"), OsString::from("jht")];
    let mut environment = vec![("CONTAINER_CONNECTION", machine), ("PODMAN_COMPOSE_WARNING_LOGS", "false"), ("PATH", path_with_podman.as_str())];
    if let Some(image) = image.as_deref() { environment.push(("JHT_IMAGE", image)); }
    // The same environment the wrapper runs the compose in: see `wrapper_compose_environment`.
    let host_environment = wrapper_compose_environment(host_env, inherited);
    for (name, value) in &host_environment { environment.push((*name, value.as_str())); }
    let (result, stderr) = run_program_keeping_stderr_with_environment(compose.to_str().ok_or("hash_tool_missing")?, args, None, timeout, runtime, &["CONTAINER_HOST", "CONTAINER_CONNECTION", "JHT_IMAGE"], &environment);
    let planned = match result {
        Ok(done) if done.success() => done,
        Ok(_) => return Err("hash_dry_run_exit"),
        Err("process_timeout") => return Err("hash_dry_run_timeout"),
        Err(_) => return Err("hash_dry_run_not_started"),
    };
    let mut output = planned.stdout;
    output.extend_from_slice(&stderr);
    let output = std::str::from_utf8(&output).map_err(|_| "hash_plan_without_create")?;
    let mut hash = None;
    // podman-compose 1.6.0 hashes each service on its own: the plan of `jht` prints the create of its dependency first (with another hash); only the create of `jht` carries the hash its container is labelled with.
    for line in output.lines().filter(|line| line.contains(" create --name=jht ")) { for (at, _) in line.match_indices("io.podman.compose.config-hash=") { let value = &line[at + "io.podman.compose.config-hash=".len()..]; let value: String = value.chars().take_while(|b| b.is_ascii_hexdigit()).collect(); if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()) { return Err("hash_plan_ambiguous"); } match hash.as_deref() { None => hash = Some(value), Some(old) if old == value => {}, Some(_) => return Err("hash_plan_ambiguous") } } }
    hash.ok_or("hash_plan_without_create")
}

/// A Windows path as the compose labels spell it, to compare with another: forward slashes as
/// backslashes, no `\\?\` prefix, no trailing separator, and case ignored (the file system does).
pub(super) fn windows_path_key(path: &str) -> String {
    let path = path.replace('/', "\\");
    let path = path.strip_prefix("\\\\?\\").unwrap_or(&path);
    // Unicode lower case, not ASCII: a profile name with accents is the same name in capitals.
    path.trim_end_matches('\\').to_lowercase()
}

/// The Windows team's container. Its Compose provider is the runtime's own `docker-compose.exe`
/// (Compose v2 over the Podman socket), which writes the `com.docker.compose.*` labels and none of
/// `io.podman.compose.*`: the container is the one the runtime's two files started in the runtime
/// directory. Asking for podman-compose's labels rejected every Windows container (G7).
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn windows_container_labels_are_attested(labels: &Value, runtime: &Path) -> bool {
    if label(labels, "com.docker.compose.project") != Some("jht")
        || label(labels, "com.docker.compose.service") != Some("jht")
        || label(labels, "com.docker.compose.container-number") != Some("1")
    {
        return false;
    }
    let working_dir = label(labels, "com.docker.compose.project.working_dir").map(windows_path_key);
    let listed: Vec<String> = label(labels, "com.docker.compose.project.config_files")
        .map(|value| value.split(',').map(windows_path_key).collect())
        .unwrap_or_default();
    // The directory as the app names it, or as the system resolves it (a short 8.3 name or a link
    // in the app's path against the long one in the labels): either way, one directory.
    std::iter::once(runtime.to_path_buf()).chain(fs::canonicalize(runtime).ok()).any(|root| {
        let files = [root.join("docker-compose.yml"), root.join("docker-compose.podman.yml")]
            .map(|file| windows_path_key(&file.to_string_lossy()));
        working_dir.as_deref() == Some(windows_path_key(&root.to_string_lossy()).as_str()) && listed == files
    })
}

/// 64 lower-case hex digits after `ghcr.io/leopu00/jht@sha256:`: the only reference the runtime pins.
pub(super) fn is_pinned_image_reference(value: &str) -> bool {
    value
        .strip_prefix("ghcr.io/leopu00/jht@sha256:")
        .is_some_and(|digest| digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)))
}

/// The image the container was made from is the runtime's pinned one: the digest in its
/// `runtime-image`, which the manifest already attests. Without a pin file the runtime's default is
/// a digest of the same repository.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn windows_container_image_is_the_runtimes(image: &str, runtime: &Path) -> bool {
    match fs::read_to_string(runtime.join("runtime-image")) {
        Ok(pin) => pin.strip_suffix('\n').is_some_and(|pin| is_pinned_image_reference(pin) && pin == image),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => is_pinned_image_reference(image),
        Err(_) => false,
    }
}

/// `running|labels` as the engine's inspect prints it, plus `|image` where the image is asked for.
#[cfg_attr(not(windows), allow(dead_code))]
pub(super) fn split_inspected(line: &str, with_image: bool) -> Option<(&str, &str, Option<&str>)> {
    let (running, rest) = line.split_once('|')?;
    if !with_image {
        return Some((running, rest, None));
    }
    // the image is the last field: a label's text may hold a `|`, an image reference never does
    let (labels, image) = rest.rsplit_once('|')?;
    Some((running, labels, Some(image.trim())))
}

/// The first rule of the attestation the container's labels do not meet, in the fixed words of
/// `runtime_log::ATTEST_REASONS`; `None` when they meet all of them.
pub(super) fn podman_container_label_refusal(labels: &Value, runtime: &Path, expected_config_hash: Option<&str>, hash_known: bool) -> Option<&'static str> {
    #[cfg(windows)]
    {
        let _ = (expected_config_hash, hash_known);
        return (!windows_container_labels_are_attested(labels, runtime)).then_some("label_windows");
    }
    #[cfg(not(windows))]
    podman_compose_label_refusal(labels, runtime, expected_config_hash, hash_known)
}

#[cfg(not(windows))]
pub(super) fn podman_compose_label_refusal(labels: &Value, runtime: &Path, expected_config_hash: Option<&str>, hash_known: bool) -> Option<&'static str> {
    let runtime_text = runtime.to_string_lossy();
    let systemd_unit = podman_systemd_unit();
    if label(labels, "com.docker.compose.project") != Some("jht") || label(labels, "io.podman.compose.project") != Some("jht") {
        return Some("label_project");
    }
    if label(labels, "com.docker.compose.service") != Some("jht") || label(labels, "io.podman.compose.service") != Some("jht") {
        return Some("label_service");
    }
    if label(labels, "com.docker.compose.container-number") != Some("1") {
        return Some("label_container_number");
    }
    if label(labels, "com.docker.compose.project.working_dir") != Some(runtime_text.as_ref()) {
        return Some("label_working_dir");
    }
    if !label(labels, "io.podman.compose.config-hash").is_some_and(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())) {
        return Some("label_hash_form");
    }
    #[cfg(target_os = "macos")]
    {
        if label(labels, "com.docker.compose.project.config_files") != Some(runtime.join("docker-compose.yml").to_string_lossy().as_ref()) {
            return Some("label_config_files");
        }
        if label(labels, "io.podman.compose.version") != Some("1.6.0") {
            return Some("label_compose_version");
        }
        if label(labels, "PODMAN_SYSTEMD_UNIT") != Some(systemd_unit.as_str()) {
            return Some("label_systemd_unit");
        }
        // With the hash not worked out (`hash_known` false) the other labels are still judged: a container that is
        // visibly another one is said so, and only one that looks like the installed one waits for the hash.
        return (hash_known && expected_config_hash != label(labels, "io.podman.compose.config-hash")).then_some("label_config_hash_differs");
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = (expected_config_hash, hash_known);
        let expected_files = format!("{}/docker-compose.yml,{}/docker-compose.podman-linux.yml", runtime_text, runtime_text);
        if label(labels, "com.docker.compose.project.config_files") != Some(expected_files.as_str()) {
            return Some("label_config_files");
        }
        if !label(labels, "io.podman.compose.version").is_some_and(|version| {
            let mut parts = version.split('.');
            matches!((parts.next(), parts.next()), (Some(major), Some(minor))
                if major.parse::<u16>().is_ok_and(|major| major > 1)
                || (major == "1" && minor.parse::<u16>().is_ok_and(|minor| minor >= 1)))
        }) {
            return Some("label_compose_version");
        }
        return (label(labels, "PODMAN_SYSTEMD_UNIT") != Some(systemd_unit.as_str())).then_some("label_systemd_unit");
    }
    #[cfg(not(unix))]
    {
        Some("label_windows")
    }
}

/// The first thing that keeps a running `jht` container from being taken: the hash it has to carry could
/// not be worked out (`expected` is the reason), or a label (or the image, on Windows) is not what the
/// runtime writes. `None` when it is the one.
pub(super) fn attestation_refusal(expected: Option<&Result<String, &'static str>>, labels: &Value, runtime: &Path, image_is_the_runtimes: bool) -> Option<&'static str> {
    match expected {
        // The hash could not be worked out: the labels that need none are judged first, so a container that is visibly
        // another one is said to be, and only one that looks like the installed one is left to the hash's reason.
        Some(Err(reason)) => podman_container_label_refusal(labels, runtime, None, false).or(Some(*reason)),
        _ => podman_container_label_refusal(labels, runtime, expected.and_then(|hash| hash.as_deref().ok()), true),
    }
    .or_else(|| (!image_is_the_runtimes).then_some("label_image"))
}

/// What is said when no container was taken: another one is up (it is not used), the check could not be
/// made now (the page asks again, and waits as it does for a team that is starting), or none is up.
pub(super) fn container_not_found_code(refused: Option<&'static str>, unchecked: Option<&'static str>) -> &'static str {
    match (refused, unchecked) {
        (Some(_), _) => "local_container_not_attested",
        (None, Some(_)) => "container_unavailable",
        (None, None) => "local_team_not_running",
    }
}

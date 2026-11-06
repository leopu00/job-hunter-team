use super::*;

/// The installed runtime directory, not a renderer value. The wrapper is still verified when the
/// connection opens; chat actions themselves intentionally do not invoke it.
pub(super) fn local_runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, DirectChatError> {
    #[cfg(windows)]
    {
        crate::windows_runtime::runtime_dir(std::env::var_os("LOCALAPPDATA"))
            .ok_or_else(|| failure("runtime_missing"))
    }
    #[cfg(target_os = "macos")]
    {
        app.path()
            .home_dir()
            .map(|home| {
                home.join("Library")
                    .join("Application Support")
                    .join("Job Hunter Team")
                    .join("host-runtime")
            })
            .map_err(|_| failure("runtime_missing"))
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let data = std::env::var_os("XDG_DATA_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                app.path()
                    .home_dir()
                    .ok()
                    .map(|home| home.join(".local").join("share"))
            })
            .ok_or_else(|| failure("runtime_missing"))?;
        Ok(data.join("job-hunter-team").join("host-runtime"))
    }
}

pub(super) struct LocalChatEngine {
    pub(super) program: PathBuf,
    pub(super) podman: bool,
}

/// Resolve Docker before starting it. The Finder-launched macOS app does not necessarily inherit
/// the user's shell PATH, while the wrapper deliberately adds these same locations.
pub(super) fn local_docker_cli() -> Result<PathBuf, &'static str> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "macos")]
    candidates.extend([
        PathBuf::from("/opt/homebrew/bin/docker"),
        PathBuf::from("/usr/local/bin/docker"),
        PathBuf::from("/opt/podman/bin/docker"),
        PathBuf::from("/Applications/Docker.app/Contents/Resources/bin/docker"),
    ]);
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| {
            dir.join(if cfg!(windows) { "docker.exe" } else { "docker" })
        }));
    }
    candidates
        .into_iter()
        .find(|candidate| fs::metadata(candidate).is_ok_and(|metadata| metadata.is_file()))
        .ok_or("container_engine_missing")
}

/// The JHT-private Podman shim is the only Podman engine selected from the runtime. Docker is
/// resolved once to an executable path, never assembled from page input or a shell string.
/// A runtime without a `container-runtime` file is a Docker one (Linux with Docker never writes it;
/// the wrapper and the integrity check read it the same way): only a file that is there and cannot
/// be read, or says something else, is refused.
pub(super) fn local_chat_engine(runtime: &Path) -> Result<LocalChatEngine, &'static str> {
    let selection = match fs::read_to_string(runtime.join("container-runtime")) {
        Ok(value) => value,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => "docker".to_owned(),
        Err(_) => return Err("runtime_missing"),
    };
    match selection.trim() {
        "podman" => {
            let shim = runtime.join("bin").join(if cfg!(windows) {
                "docker.exe"
            } else {
                "docker"
            });
            let metadata = fs::symlink_metadata(&shim).map_err(|_| "runtime_missing")?;
            if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
                return Err("runtime_missing");
            }
            Ok(LocalChatEngine {
                program: shim,
                podman: true,
            })
        }
        "docker" => Ok(LocalChatEngine {
            program: local_docker_cli()?,
            podman: false,
        }),
        _ => Err("runtime_missing"),
    }
}

pub(super) fn container_id(value: &str) -> bool {
    (12..=64).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
/// Native Linux Podman honors these inherited connection selectors. The
/// checked runtime shim is local-only, so inherit neither selector for any
/// of its discovery, inspect, or exec calls.
pub(super) fn local_engine_removed_environment(_engine: &LocalChatEngine) -> &'static [&'static str] {
    #[cfg(all(unix, not(target_os = "macos")))]
    if _engine.podman {
        return &["CONTAINER_HOST", "CONTAINER_CONNECTION"];
    }
    &[]
}

pub(super) fn run_local_engine<I, S>(
    engine: &LocalChatEngine,
    args: I,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, &'static str>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let program = engine.program.to_str().ok_or("runtime_missing")?;
    if !local_engine_removed_environment(engine).is_empty() {
        return run_program_without_env(
            program,
            args,
            input,
            timeout,
            local_engine_removed_environment(engine),
        );
    }
    run_program(program, args, input, timeout)
}
/// Docker's compose listing of the `jht` service, rooted in the attested runtime directory. Podman is not listed this
/// way: the runtime's private shim is `podman --connection <attested machine>`, and `podman compose` may delegate to an
/// arbitrary host provider, so it is not the runtime's authenticated Compose path. The fixed JHT project is listed by its
/// labels (`local_listing_args`) and the labels are proved by `judge_candidate`.
pub(super) fn local_compose_args(engine: &LocalChatEngine, runtime: &Path) -> Vec<OsString> {
    let mut args = vec![OsString::from("compose")];
    args.push(OsString::from("-f"));
    args.push(runtime.join("docker-compose.yml").into_os_string());
    if engine.podman {
        args.push(OsString::from("-f"));
        args.push(runtime.join("docker-compose.podman.yml").into_os_string());
    }
    args.push(OsString::from("--project-directory"));
    args.push(runtime.as_os_str().to_owned());
    args.push(OsString::from("ps"));
    args.push(OsString::from("-q"));
    args.push(OsString::from("jht"));
    args
}

pub(super) fn label<'a>(labels: &'a Value, key: &str) -> Option<&'a str> {
    labels.get(key).and_then(Value::as_str)
}

pub(super) fn podman_systemd_unit() -> String {
    ["podman-compose", "jht.service"].join("@")
}

/// The three values the wrapper puts in the environment of EVERY compose it runs (`scripts/jht-wrapper.sh`:
/// `jht_read_host_env_value`, then `${X:-default}`, then `export`), because the compose file resolves
/// `${JHT_HOST_TYPE}`, `${JHT_LANG}` and `${JHT_USER_TZ}` into the container's configuration and so into its
/// `io.podman.compose.config-hash`: a value from `host.env` that passes the wrapper's check wins over the
/// inherited environment (the last valid line of the file wins), then the inherited one, then `unknown` / `en` /
/// `UTC`. The container the app starts is made by the wrapper, so it carries THESE values; the hash computed here
/// has to be computed with the same ones, or a Mac whose `host.env` says `local` and its time zone (every Mac that
/// ran the host setup) gets another hash and its own container is «not the one Job Hunter Team installed» (found in the Mac collaudo of 27/10).
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn wrapper_compose_environment(host_env: Option<&str>, inherited: &dyn Fn(&str) -> Option<String>) -> Vec<(&'static str, String)> {
    fn valid(key: &str, value: &str) -> bool {
        match key {
            "JHT_HOST_TYPE" => matches!(value, "local" | "vps"),
            "JHT_LANG" => matches!(value, "en" | "it" | "hu" | "es" | "de" | "fr" | "pt"),
            _ => !value.is_empty() && value.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'+' | b'.' | b'/' | b'-')),
        }
    }
    let from_file = |key: &str| -> Option<String> {
        let mut found = None;
        for line in host_env?.lines() {
            let line = line.strip_suffix('\r').unwrap_or(line).trim_start();
            let Some(value) = line.strip_prefix(key).and_then(|rest| rest.strip_prefix('=')) else { continue };
            let mut value = value;
            if value.starts_with('"') && value.ends_with('"') || value.starts_with('\'') && value.ends_with('\'') {
                let quote = if value.starts_with('"') { '"' } else { '\'' };
                value = value.strip_prefix(quote).unwrap_or(value);
                value = value.strip_suffix(quote).unwrap_or(value);
            }
            if valid(key, value) {
                found = Some(value.to_owned());
            }
        }
        found
    };
    [("JHT_HOST_TYPE", "unknown"), ("JHT_LANG", "en"), ("JHT_USER_TZ", "UTC")]
        .into_iter()
        .map(|(key, default)| (key, from_file(key).or_else(|| inherited(key).filter(|value| !value.is_empty())).unwrap_or_else(|| default.to_owned())))
        .collect()
}

/// The file the wrapper takes the host type, the language and the time zone from (`jht_load_host_values`): in the runtime
/// folder, which the container does not mount, so an agent cannot write it. A plain file of the user, not writable by
/// others, small; anything else is not read (and then `host.env` is, as the wrapper does).
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn read_host_values(path: &Path) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    let metadata = fs::symlink_metadata(path).ok()?;
    // SAFETY: geteuid has no arguments and cannot fail.
    if !metadata.file_type().is_file() || metadata.len() > 65_536 || metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o022 != 0 {
        return None;
    }
    fs::read_to_string(path).ok()
}

/// `host.env` where the wrapper reads it: `$JHT_HOST_ENV_FILE`, else `~/.jht/host.env`; a regular file, small.
#[cfg(target_os = "macos")]
pub(super) fn read_host_env() -> Option<String> {
    let path = std::env::var_os("JHT_HOST_ENV_FILE").map(PathBuf::from).or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".jht").join("host.env")))?;
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() > 65_536 {
        return None;
    }
    fs::read_to_string(path).ok()
}

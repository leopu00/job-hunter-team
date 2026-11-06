use super::*;

#[cfg(all(unix, not(target_os = "macos")))]
pub(super) fn digest_file(path: &Path) -> Option<String> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() == 0 {
        return None;
    }
    Some(format!("{:x}", Sha256::digest(fs::read(path).ok()?)))
}

#[cfg(unix)]
pub(super) fn unix_runtime_node_is_safe(path: &Path, directory: bool) -> bool {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let Ok(metadata) = fs::symlink_metadata(path) else { return false };
    (if directory { metadata.file_type().is_dir() } else { metadata.file_type().is_file() })
        && metadata.uid() == unsafe { libc::geteuid() }
        && metadata.permissions().mode() & 0o022 == 0
}

#[cfg(unix)]
pub(super) fn unix_runtime_path_is_safe(runtime: &Path, wrapper: &Path) -> bool {
    let Ok(runtime_real) = fs::canonicalize(runtime) else { return false };
    let Ok(wrapper_real) = fs::canonicalize(wrapper) else { return false };
    if runtime_real != runtime || wrapper_real != wrapper {
        return false;
    }
    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else { return false };
    let Ok(home) = fs::canonicalize(home) else { return false };
    // The declared HOME can itself be a link. Compare only physical paths so
    // a legacy bind below its real location cannot become a new trust root.
    let physical_child = |parts: &[&str]| {
        let candidate = parts.iter().fold(home.clone(), |path, part| path.join(part));
        fs::canonicalize(&candidate).unwrap_or(candidate)
    };
    let legacy = physical_child(&[".jht"]);
    let user_data = physical_child(&["Documents", "Job Hunter Team"]);
    !runtime_real.starts_with(&legacy)
        && !runtime_real.starts_with(&user_data)
        && !wrapper_real.starts_with(&legacy)
        && !wrapper_real.starts_with(&user_data)
}
/// The desktop's local trust root. This is intentionally separate from process launch: all
/// platforms reject an untrusted runtime before discovering a container or starting `exec -i`.
pub(super) fn local_chat_runtime_valid(wrapper: &Path, runtime: &Path) -> bool {
    #[cfg(windows)]
    {
        return crate::windows_runtime::wrapper_bundle_valid(wrapper, runtime);
    }
    #[cfg(target_os = "macos")]
    {
        return crate::onboarding::runtime_bundle_manifest_valid(runtime, wrapper)
            && unix_runtime_path_is_safe(runtime, wrapper)
            && unix_runtime_node_is_safe(runtime, true)
            && unix_runtime_node_is_safe(wrapper, false)
            && unix_runtime_node_is_safe(&runtime.join("bin/docker"), false)
            && fs::canonicalize(runtime.join("bin/docker")).is_ok_and(|real| real == runtime.join("bin/docker"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        unix_runtime_bundle_valid(wrapper, runtime)
    }
    #[cfg(not(any(unix, windows)))]
    {
        false
    }
}
/// Where Homebrew (Apple silicon, Intel) and the Podman installer keep their tools.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) const TOOL_ROOTS: [&str; 3] = ["/opt/homebrew", "/usr/local", "/opt/podman"];

/// The macOS group of the administrators (`admin`, gid 80). Homebrew leaves `Cellar` writable by it (`drwxrwxr-x
/// user:admin`), and whoever is in the group can act as root on the machine anyway, so a folder on the way to a tool
/// is not refused for that. It is the one exception: only on macOS, only this group, only for folders (never for the
/// tool itself), and it replaces neither the owner (the user or root) nor the rule that others never write.
#[cfg(unix)]
pub(super) const ADMIN_GROUP: Option<u32> = if cfg!(target_os = "macos") { Some(80) } else { None };

/// A folder on the way to a tool is safe when the user or root owns it, nobody else can write in it, and the group
/// cannot either, unless it is the administrators' (see `ADMIN_GROUP`): whoever can write in it can rename the tool
/// and put another program in its place.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn tool_folder_is_safe(owner: u32, group: u32, mode: u32, user: u32, admin_group: Option<u32>) -> bool {
    (owner == user || owner == 0) && mode & 0o002 == 0 && (mode & 0o020 == 0 || admin_group == Some(group))
}

/// The tool itself is safe when the user or root owns it and neither the group (the administrators' included) nor
/// others can write it.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn tool_file_is_safe(owner: u32, mode: u32, user: u32) -> bool {
    (owner == user || owner == 0) && mode & 0o022 == 0
}

/// `podman` and `podman-compose` are SYMLINKS on a Mac that has them from Homebrew (`/opt/homebrew/bin/podman` ->
/// `../Cellar/podman/<version>/bin/podman-remote`), so the path is always resolved to the file it finally names. That
/// file is trusted when it is a regular file inside one of the install `roots` that `tool_file_is_safe`, and every
/// folder from its own up to the root is safe too (`tool_folder_is_safe`), as is the folder the path was asked in
/// (the `bin` that holds the link: whoever writes there changes where it points). A regular file planted in a folder
/// anyone can write, or in a path whose folders anyone can rename, is no more a tool of the install than a planted link.
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn tool_is_trusted(path: &Path, roots: &[&Path]) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Ok(real) = fs::canonicalize(path) else { return false };
    let Some(root) = roots.iter().filter_map(|root| fs::canonicalize(root).ok()).find(|root| real.starts_with(root)) else { return false };
    let user = unsafe { libc::geteuid() };
    let Ok(file) = fs::metadata(&real) else { return false };
    if !file.file_type().is_file() || !tool_file_is_safe(file.uid(), file.mode(), user) {
        return false;
    }
    let folders_to_the_root_are_safe = |start: &Path| {
        let mut folder = Some(start);
        while let Some(dir) = folder {
            let Ok(metadata) = fs::metadata(dir) else { return false };
            if !metadata.file_type().is_dir() || !tool_folder_is_safe(metadata.uid(), metadata.gid(), metadata.mode(), user, ADMIN_GROUP) {
                return false;
            }
            if dir == root {
                return true;
            }
            folder = dir.parent();
        }
        false
    };
    real.parent().is_some_and(folders_to_the_root_are_safe)
        && path.parent().and_then(|dir| fs::canonicalize(dir).ok()).is_some_and(|dir| folders_to_the_root_are_safe(&dir))
}

/// The trusted `name` in the `bin` folder of an install root, and only there: the PATH the app was opened with is not
/// searched (an entry of it that is empty or relative would be the folder it is run from).
#[cfg(unix)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn find_trusted_tool(name: &str, roots: &[&Path]) -> Option<PathBuf> {
    roots.iter().map(|root| root.join("bin").join(name)).find(|path| tool_is_trusted(path, roots))
}

/// The `podman` of this Mac's install (Homebrew's, or the Podman installer's), trusted as the engine calls need, or None. An
/// app opened from Finder has `/usr/bin:/bin:/usr/sbin:/sbin` for a PATH: the bare name `podman` is not found there.
#[cfg(target_os = "macos")]
pub(crate) fn trusted_podman() -> Option<PathBuf> {
    find_trusted_tool("podman", &TOOL_ROOTS.map(Path::new))
}

/// The hash the running container has to carry, or why it could not be worked out: a reason in the fixed
/// words of `runtime_log::ATTEST_REASONS`. A reason that waiting may cure (a probe that did not run, a
/// plan that did not come) is told apart from one that waiting will not (another version, a missing file),
/// see `attest_reason_may_pass`.
#[cfg(target_os = "macos")]
pub(super) fn mac_config_hash(runtime: &Path, timeout: Duration) -> Result<String, &'static str> {
    // The same source as the wrapper: the host values file of the runtime folder, and only if there is none, `host.env`.
    let inherited = |key: &str| std::env::var(key).ok();
    let text = text_the_wrapper_hashes(read_host_values(&runtime.join("host-values")), &read_host_env, &inherited);
    mac_config_hash_in(runtime, timeout, text.as_deref(), &inherited)
}

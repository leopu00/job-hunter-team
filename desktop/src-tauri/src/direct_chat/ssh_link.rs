use super::*;

pub(super) fn control_args(
    host: &ValidatedHost,
    control_path: &Path,
    operation: &str,
) -> Result<Vec<std::ffi::OsString>, DirectChatError> {
    let mut args = ssh_base_args(host).map_err(failure)?;
    let target = args.pop().ok_or_else(|| failure("invalid_host"))?;
    args.extend([
        "-S".into(),
        control_path.as_os_str().to_owned(),
        "-O".into(),
        operation.into(),
        target,
    ]);
    Ok(args)
}

pub(super) fn check_tunnel(host: &ValidatedHost, control_path: &Path) -> bool {
    control_args(host, control_path, "check")
        .ok()
        .and_then(|args| run_program("ssh", &args, None, Duration::from_secs(5)).ok())
        .is_some_and(|result| result.success())
}

/// The longest path a Unix socket can have on macOS (its sun_path holds 104 bytes with the NUL;
/// Linux holds 108): the shorter limit is the one for every platform.
pub(super) const SOCKET_PATH_MAX: usize = 103;
/// ssh creates the master's socket as `ControlPath` + "." + 16 random characters, then renames it
/// into place: the temporary name is the one that must fit.
pub(super) const SSH_SOCKET_SUFFIX: usize = 17;
/// The folder of a tunnel's socket starts with this, so closing removes only a folder of ours.
pub(super) const TUNNEL_DIR_PREFIX: &str = "jc";

/// Whether ssh can create the master socket at `path`, its temporary name included.
pub(super) fn control_path_fits(path: &Path) -> bool {
    path.as_os_str().len() + SSH_SOCKET_SUFFIX <= SOCKET_PATH_MAX
}

/// The socket of a tunnel: `s`, alone in a folder made for it (0700 on Unix, a random name,
/// created exclusively, so nobody can have prepared it or reach the socket), in the first of
/// `bases` where it fits. The old name in TMPDIR was 95 characters on macOS (112 with ssh's
/// suffix): ssh could never open the tunnel there.
pub(super) fn tunnel_socket_path(bases: &[PathBuf], mut name: impl FnMut() -> String) -> Result<PathBuf, &'static str> {
    for base in bases {
        for _ in 0..8 {
            let dir = base.join(format!("{TUNNEL_DIR_PREFIX}{}", name()));
            let socket = dir.join("s");
            if !control_path_fits(&socket) {
                break;
            }
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            match builder.create(&dir) {
                Ok(()) => return Ok(socket),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => break,
            }
        }
    }
    Err("tunnel_path_unavailable")
}

pub(super) fn tunnel_dir_name() -> String {
    use std::hash::{BuildHasher, Hasher};
    // A fresh RandomState has random keys: with the pid and the time, a name nobody can guess.
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u32(std::process::id());
    hasher.write_u128(SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos());
    format!("{:010x}", hasher.finish() & 0xff_ffff_ffff)
}

/// On Unix /tmp first: the private folder keeps the socket ours there too, and the path stays
/// far from the limit (/tmp/jc<10>/s is 19 characters, 36 with ssh's suffix, where macOS's
/// TMPDIR alone is 49). The user's temporary folder is the fallback, and the only one elsewhere.
pub(super) fn tunnel_socket_bases() -> Vec<PathBuf> {
    let mut bases = Vec::new();
    #[cfg(unix)]
    bases.push(PathBuf::from("/tmp"));
    bases.push(std::env::temp_dir());
    bases
}

/// Removes a tunnel's socket and the folder made for it.
pub(super) fn remove_tunnel_socket(path: &Path) {
    let _ = fs::remove_file(path);
    if let Some(dir) = path.parent() {
        if dir.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with(TUNNEL_DIR_PREFIX)) {
            let _ = fs::remove_dir(dir);
        }
    }
}

pub(super) fn open_tunnel(host: &ValidatedHost) -> Result<(PathBuf, Child), DirectChatError> {
    let mut args = ssh_base_args(host).map_err(failure)?;
    let target = args.pop().ok_or_else(|| failure("invalid_host"))?;
    let control_path = tunnel_socket_path(&tunnel_socket_bases(), tunnel_dir_name).map_err(failure)?;
    args.extend([
        "-M".into(),
        "-N".into(),
        "-o".into(),
        "ControlMaster=yes".into(),
        "-o".into(),
        "ControlPersist=no".into(),
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        "-S".into(),
        control_path.as_os_str().to_owned(),
        target,
    ]);
    let mut command = Command::new("ssh");
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::runtime_host::hide_console(&mut command);
    let child = crate::runtime_host::spawn_retrying_busy(&mut command).map_err(|_| failure("tunnel_start_failed")).map_err(|error| {
        remove_tunnel_socket(&control_path);
        error
    })?;
    for _ in 0..40 {
        if check_tunnel(host, &control_path) {
            return Ok((control_path, child));
        }
        thread::sleep(Duration::from_millis(250));
    }
    let mut child = child;
    let _ = child.kill();
    let _ = child.wait();
    remove_tunnel_socket(&control_path);
    Err(failure("tunnel_verify_failed"))
}

/// The VPS link a connection starts with: the ssh master, or, where ssh has none (Windows), a check
/// that one connection answers, with the same errors as the master: `tunnel_verify_failed`, or the
/// code of the way in when ssh says why it failed (`ssh_rate_limited` when the server turns this
/// computer away, a refused key, a refused connection, a host that cannot be reached). `exit 0` means the same in every
/// shell, so the check assumes none.
pub(super) fn open_vps_link(
    host: &ValidatedHost,
    link: VpsLink,
    check: impl FnOnce(&ValidatedHost) -> Result<ProcessResult, &'static str>,
) -> Result<(Option<PathBuf>, Option<Child>), DirectChatError> {
    match link {
        VpsLink::Master => open_tunnel(host).map(|(path, child)| (Some(path), Some(child))),
        VpsLink::PerCommand => match check(host) {
            Ok(result) if result.success() => Ok((None, None)),
            Err(code) if crate::runtime_host::SSH_WAY_IN_CODES.contains(&code) => Err(failure(code)),
            _ => Err(failure("tunnel_verify_failed")),
        },
    }
}

pub(super) const VPS_LINK_CHECK: &str = "exit 0";

/// The same VPS, field by field: address, user, port, the key the app uses and the file with the
/// host key it pinned for this account.
pub(super) fn same_vps(a: &ValidatedHost, b: &ValidatedHost) -> bool {
    match (a, b) {
        (
            ValidatedHost::Vps { address, user, port, key_path, known_hosts },
            ValidatedHost::Vps { address: address_b, user: user_b, port: port_b, key_path: key_b, known_hosts: known_b },
        ) => address == address_b && user == user_b && port == port_b && key_path == key_b && known_hosts == known_b,
        _ => false,
    }
}

/// The chat's ssh master, if it may be lent to another read of the same team: the chat is
/// connected in this account, on the master link, to exactly this VPS and to the same team (the
/// pinned container, or none for the VPS the app set up). Its socket comes only from the chat's
/// own connection, never from what a page sends.
pub(super) fn master_to_lend(
    connection: Option<&Connection>,
    scope: &AccountScope,
    host: &ValidatedHost,
    team: Option<(&str, &crate::existing_team_runtime::RuntimeTarget)>,
) -> Option<PathBuf> {
    let connection = connection?;
    if &connection.scope != scope || connection.link != VpsLink::Master || !same_vps(&connection.validated, host) {
        return None;
    }
    if connection.runtime.as_ref().map(|target| (target.team_id.as_str(), &target.runtime)) != team {
        return None;
    }
    connection.control_path.clone()
}

/// The folder of a master's socket, as the chat makes it: a real folder (not a link), of `uid`,
/// open to its owner only (0700), named with the chat's prefix. Once the chat closes its master the
/// name can be free again, and ssh does not look at who owns a socket: a folder that is not
/// still ours could hold another local user's socket.
#[cfg(unix)]
pub(super) fn socket_folder_owned_by(socket: &Path, uid: u32) -> bool {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let Some(dir) = socket.parent() else { return false };
    if !dir.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with(TUNNEL_DIR_PREFIX)) {
        return false;
    }
    match fs::symlink_metadata(dir) {
        Ok(meta) => meta.file_type().is_dir() && meta.uid() == uid && meta.permissions().mode() & 0o777 == 0o700,
        Err(_) => false,
    }
}

/// Whether a lent socket's folder is still the chat's, checked right before each use of it.
#[cfg(unix)]
pub(crate) fn lent_socket_still_ours(socket: &Path) -> bool {
    // SAFETY: geteuid has no arguments or pointers.
    socket_folder_owned_by(socket, unsafe { libc::geteuid() })
}

/// No master on this platform: nothing is ever lent.
#[cfg(not(unix))]
pub(crate) fn lent_socket_still_ours(_socket: &Path) -> bool {
    false
}

/// The chat's master for a read of the agents' panel (the terminal of an agent), so that the read
/// opens no ssh connection of its own: the socket of `master_to_lend`, only while its folder is
/// still the chat's and the master answers. None means «open a connection as before».
pub(crate) fn shared_master(
    state: &DirectChatState,
    scope: &AccountScope,
    host: &ValidatedHost,
    team: Option<(&str, &crate::existing_team_runtime::RuntimeTarget)>,
) -> Option<PathBuf> {
    let path = {
        let slot = state.inner.connection.lock().ok()?;
        master_to_lend(slot.as_ref(), scope, host, team)?
    };
    (lent_socket_still_ours(&path) && check_tunnel(host, &path)).then_some(path)
}

pub(super) fn close_connection(connection: &mut Connection) {
    if let (Some(path), ValidatedHost::Vps { .. }) =
        (&connection.control_path, &connection.validated)
    {
        if let Ok(args) = control_args(&connection.validated, path, "exit") {
            let _ = run_program("ssh", &args, None, Duration::from_secs(5));
        }
        remove_tunnel_socket(path);
    }
    if let Some(mut child) = connection.tunnel.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

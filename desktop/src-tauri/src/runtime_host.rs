use crate::account_scope::{self, AccountScope, AccountScopeState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::hash_map::DefaultHasher,
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    hash::{Hash, Hasher},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum ExecutionHost {
    Local,
    Vps {
        address: String,
        user: String,
        port: u16,
        #[serde(rename = "keyPath")]
        key_path: String,
    },
}

#[derive(Clone, Debug)]
pub(crate) enum ValidatedHost {
    Local,
    Vps {
        address: String,
        user: String,
        port: u16,
        key_path: PathBuf,
        known_hosts: PathBuf,
    },
}

#[derive(Debug)]
pub(crate) struct ProcessResult {
    pub(crate) code: i32,
    pub(crate) stdout: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SshHostKeyProbe {
    status: &'static str,
    algorithm: &'static str,
    fingerprint: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct ScannedHostKey {
    algorithm: &'static str,
    encoded_key: String,
    fingerprint: String,
}

impl ProcessResult {
    pub(crate) fn success(&self) -> bool {
        self.code == 0
    }
    pub(crate) fn stdout_text(&self) -> String {
        String::from_utf8_lossy(&self.stdout).into_owned()
    }
}

fn valid_address(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 253
        && !value.starts_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
        && !value.contains("..")
}

fn valid_user(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(
        bytes.next(),
        Some(b'a'..=b'z') | Some(b'A'..=b'Z') | Some(b'_')
    ) && value.len() <= 32
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn host_hash(address: &str, port: u16) -> String {
    let mut hasher = DefaultHasher::new();
    address.hash(&mut hasher);
    port.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub(crate) fn validate_host(
    app: &tauri::AppHandle,
    host: &ExecutionHost,
) -> Result<ValidatedHost, &'static str> {
    let scopes = app
        .try_state::<AccountScopeState>()
        .ok_or("account_scope_required")?;
    let scope = scopes.active()?;
    validate_host_for_scope(app, host, &scope)
}

pub(crate) fn validate_host_for_scope(
    app: &tauri::AppHandle,
    host: &ExecutionHost,
    scope: &AccountScope,
) -> Result<ValidatedHost, &'static str> {
    match host {
        ExecutionHost::Local => {
            account_scope::validate_local_runtime(app, scope)?;
            Ok(ValidatedHost::Local)
        }
        ExecutionHost::Vps {
            address,
            user,
            port,
            key_path,
        } => {
            if !valid_address(address) {
                return Err("invalid_host");
            }
            if !valid_user(user) {
                return Err("invalid_user");
            }
            if *port == 0 {
                return Err("invalid_port");
            }
            let raw_key = PathBuf::from(key_path);
            if !raw_key.is_absolute() {
                return Err("invalid_key_path");
            }
            let key = fs::canonicalize(&raw_key).map_err(|_| "key_unavailable")?;
            let meta = fs::metadata(&key).map_err(|_| "key_unavailable")?;
            if !meta.is_file() || meta.len() == 0 || meta.len() > 64 * 1024 {
                return Err("invalid_key");
            }
            let known_hosts = known_hosts_path(app, scope, address, *port)?;
            if !known_hosts.is_file() {
                return Err("host_key_missing");
            }
            if read_pinned_host_key(&known_hosts).is_err() {
                return Err("host_key_mismatch");
            }
            Ok(ValidatedHost::Vps {
                address: address.trim().to_string(),
                user: user.to_string(),
                port: *port,
                key_path: key,
                known_hosts,
            })
        }
    }
}

fn known_hosts_path(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    address: &str,
    port: u16,
) -> Result<PathBuf, &'static str> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "storage_unavailable")?;
    Ok(root
        .join("accounts")
        .join(scope.digest())
        .join("ssh")
        .join("known_hosts")
        .join(host_hash(address, port)))
}

/// The key the VPS offers, to show to the person before anything is pinned.
/// Windows ships an OpenSSH whose `ssh-keyscan` offers a key exchange it does
/// not implement (sntrup761x25519): a current sshd picks it, the handshake dies
/// and nothing is printed. There the key is taken with `ssh` itself, whose
/// proposal the app sets (see `kex_args`); elsewhere `ssh-keyscan` is enough.
fn scan_host_key(address: &str, port: u16) -> Result<ScannedHostKey, &'static str> {
    if cfg!(windows) {
        scan_host_key_with_ssh("ssh", address, port)
    } else {
        scan_host_key_with_keyscan(address, port)
    }
}

/// The part of the key exchange the Windows OpenSSH client gets wrong: the
/// hybrid post-quantum method it proposes but cannot run is taken out of its
/// proposal, the rest of the default list stays. Other platforms are untouched.
// The method's name has an "@" in it; written in pieces so that it is not read as an address.
const WINDOWS_KEX_OPTION: &str = concat!(
    "KexAlgorithms=-sntrup761x25519-sha512",
    "@",
    "openssh.com",
    ",sntrup761x25519-sha512"
);

fn kex_args(on_windows: bool) -> Vec<OsString> {
    if on_windows {
        vec!["-o".into(), WINDOWS_KEX_OPTION.into()]
    } else {
        Vec::new()
    }
}

/// An sshd with `PerSourcePenalties` (OpenSSH 9.8 and later) refuses, for up to
/// ten minutes, an address that closed connections before authenticating. What
/// the client then prints is the only sign; it is read here and never kept.
fn ssh_rejects_for_a_while(stderr: &[u8]) -> bool {
    let text = String::from_utf8_lossy(stderr);
    text.contains("kex_exchange_identification") || text.contains("Connection reset")
}

/// A known_hosts file that exists only for one probe, owner-only, and is gone
/// when the probe ends. The key `ssh` writes there is not trusted by that: it
/// is read, shown, and pinned only after the person confirms it.
struct ProbeKnownHosts {
    path: PathBuf,
}

impl ProbeKnownHosts {
    fn create() -> Result<Self, &'static str> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("jht-hostkey-{}-{nanos}", std::process::id()));
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "storage_unavailable")?;
        let probe = Self { path };
        set_private_permissions(&probe.path)?;
        Ok(probe)
    }
}

impl Drop for ProbeKnownHosts {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// `ssh` with no authentication, asked only to write the key it was offered.
/// It never logs in: the server refuses and the connection ends.
fn host_key_probe_args(known_hosts: &Path, address: &str, port: u16, on_windows: bool) -> Vec<OsString> {
    let known_hosts_option = known_hosts.display().to_string()
        .replace('\\', "\\\\").replace('"', "\\\"");
    let mut args: Vec<OsString> = vec!["-a".into(), "-x".into(), "-T".into()];
    for option in [
        "BatchMode=yes".to_owned(),
        "ConnectTimeout=12".to_owned(),
        // Only into the throwaway file below: nothing is trusted by this.
        "StrictHostKeyChecking=accept-new".to_owned(),
        format!("UserKnownHostsFile=\"{known_hosts_option}\""),
        "GlobalKnownHostsFile=/dev/null".to_owned(),
        "HashKnownHosts=no".to_owned(),
        // A connection the user's own ssh config keeps open would be reused: no
        // key exchange, and the throwaway file would stay empty.
        "ControlMaster=no".to_owned(),
        "ControlPath=none".to_owned(),
        "HostKeyAlgorithms=ssh-ed25519".to_owned(),
        "PreferredAuthentications=none".to_owned(),
        "PubkeyAuthentication=no".to_owned(),
        "PasswordAuthentication=no".to_owned(),
        "KbdInteractiveAuthentication=no".to_owned(),
    ] {
        args.push("-o".into());
        args.push(option.into());
    }
    args.extend(kex_args(on_windows));
    args.push("-p".into());
    args.push(port.to_string().into());
    args.push(format!("jht-hostkey@{address}").into());
    args
}

fn scan_host_key_with_ssh(program: &str, address: &str, port: u16) -> Result<ScannedHostKey, &'static str> {
    let known_hosts = ProbeKnownHosts::create()?;
    let args = host_key_probe_args(&known_hosts.path, address, port, cfg!(windows));
    let (result, stderr) = run_program_keeping_stderr(program, &args, None, Duration::from_secs(20));
    let written = fs::read(&known_hosts.path).unwrap_or_default();
    if !written.is_empty() && written.len() <= 64 * 1024 {
        if let Some(key) = parse_keyscan_output(&written) {
            return Ok(key);
        }
    }
    if ssh_rejects_for_a_while(&stderr) {
        return Err("ssh_rate_limited");
    }
    result?;
    Err("host_key_unavailable")
}

fn scan_host_key_with_keyscan(address: &str, port: u16) -> Result<ScannedHostKey, &'static str> {
    let args = vec![
        OsString::from("-T"),
        OsString::from("8"),
        OsString::from("-p"),
        OsString::from(port.to_string()),
        OsString::from("-t"),
        OsString::from("ed25519"),
        OsString::from(address),
    ];
    let result = run_program("ssh-keyscan", &args, None, Duration::from_secs(12))?;
    // The exit status is not the test: what counts is a key line that parses.
    // Some builds (Win32-OpenSSH) exit non-zero after printing the key.
    if result.stdout.is_empty() || result.stdout.len() > 64 * 1024 {
        return Err("host_key_unavailable");
    }
    parse_keyscan_output(&result.stdout).ok_or("host_key_unavailable")
}

/// The key `ssh-keyscan` printed. The output is read the way a person would:
/// a BOM, CRLF line ends, `# host:port banner` comment lines, lines of other
/// algorithms and trailing comment fields are not the key and do not hide it.
/// What is left must still be one ed25519 key, the same on every line, and goes
/// through the strict parser the pin file is read with.
fn parse_keyscan_output(bytes: &[u8]) -> Option<ScannedHostKey> {
    let text = std::str::from_utf8(bytes).ok()?.trim_start_matches('\u{feff}');
    let key_lines: Vec<String> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let (host, algorithm, key) = (fields.next()?, fields.next()?, fields.next()?);
            (algorithm == "ssh-ed25519").then(|| format!("{host} {algorithm} {key}"))
        })
        .collect();
    parse_scanned_host_key(key_lines.join("\n").as_bytes())
}

fn parse_scanned_host_key(bytes: &[u8]) -> Option<ScannedHostKey> {
    let text = std::str::from_utf8(bytes).ok()?;
    let mut found: Option<ScannedHostKey> = None;
    for line in text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
    {
        let mut fields = line.split_whitespace();
        let _host = fields.next()?;
        let algorithm = fields.next()?;
        let encoded_key = fields.next()?;
        if fields.next().is_some() || algorithm != "ssh-ed25519" {
            return None;
        }
        let decoded = decode_base64(encoded_key)?;
        if decoded.is_empty() {
            return None;
        }
        let fingerprint = format!("SHA256:{}", encode_base64(&Sha256::digest(decoded)));
        let candidate = ScannedHostKey {
            algorithm: "ssh-ed25519",
            encoded_key: encoded_key.to_string(),
            fingerprint,
        };
        if let Some(previous) = &found {
            if previous != &candidate {
                return None;
            }
        } else {
            found = Some(candidate);
        }
    }
    found
}

fn read_pinned_host_key(path: &Path) -> Result<ScannedHostKey, &'static str> {
    let bytes = fs::read(path).map_err(|_| "host_key_mismatch")?;
    parse_scanned_host_key(&bytes).ok_or("host_key_mismatch")
}

/// The SHA-256 fingerprint of the key the person already confirmed for this
/// host, read from the local pin file. Read-only: it never scans or pins.
pub(crate) fn pinned_host_fingerprint(host: &ValidatedHost) -> Result<String, &'static str> {
    match host {
        ValidatedHost::Vps { known_hosts, .. } => {
            read_pinned_host_key(known_hosts).map(|key| key.fingerprint)
        }
        ValidatedHost::Local => Err("not_vps"),
    }
}

/// Whether the key the VPS presents now is the one the person confirmed: a
/// fresh `ssh-keyscan` against the local pin, read-only (it never pins).
/// None when either cannot be read.
pub(crate) fn host_key_matches_pin(host: &ValidatedHost) -> Option<bool> {
    let ValidatedHost::Vps { address, port, .. } = host else {
        return None;
    };
    let pinned = pinned_host_fingerprint(host).ok()?;
    let scanned = scan_host_key(address, *port).ok()?;
    Some(scanned.fingerprint == pinned)
}

fn probe_status(
    destination: &Path,
    scanned: &ScannedHostKey,
) -> Result<&'static str, &'static str> {
    if !destination.is_file() {
        return Ok("confirmation_required");
    }
    if read_pinned_host_key(destination)? == *scanned {
        Ok("pinned")
    } else {
        Err("host_key_mismatch")
    }
}

fn known_hosts_record(address: &str, port: u16, key: &ScannedHostKey) -> Vec<u8> {
    let host = if port == 22 {
        address.to_string()
    } else {
        format!("[{address}]:{port}")
    };
    format!("{host} {} {}\n", key.algorithm, key.encoded_key).into_bytes()
}

fn write_pinned_host_key(
    destination: &Path,
    address: &str,
    port: u16,
    key: &ScannedHostKey,
) -> Result<(), &'static str> {
    let dir = destination.parent().ok_or("storage_unavailable")?;
    fs::create_dir_all(dir).map_err(|_| "storage_unavailable")?;
    set_private_dir_permissions(dir)?;
    let bytes = known_hosts_record(address, port, key);
    for attempt in 0..16 {
        let temporary = destination.with_extension(format!("tmp-{}-{attempt}", std::process::id()));
        let mut file = match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("host_key_unwritable"),
        };
        let result = (|| {
            set_private_permissions(&temporary)?;
            file.write_all(&bytes).map_err(|_| "host_key_unwritable")?;
            file.sync_all().map_err(|_| "host_key_unwritable")?;
            fs::hard_link(&temporary, destination).map_err(|_| "host_key_unwritable")?;
            Ok(())
        })();
        let _ = fs::remove_file(&temporary);
        if result.is_ok() {
            return Ok(());
        }
        if destination.is_file() {
            return if read_pinned_host_key(destination)? == *key {
                Ok(())
            } else {
                Err("host_key_mismatch")
            };
        }
        return result;
    }
    Err("host_key_unwritable")
}

/// Error of the two SSH host-key commands, shaped like every other command's
/// error (`{ "code": "..." }`). They used to return a bare string, which the
/// UI read as "no code": `host_key_changed` and `host_key_mismatch` then fell
/// into the generic copy and their own sentence never showed.
#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct HostKeyError {
    pub(crate) code: &'static str,
}

impl From<&'static str> for HostKeyError {
    fn from(code: &'static str) -> Self {
        Self { code }
    }
}

// Both commands run `ssh-keyscan`, which can take its whole timeout. A plain
// `fn` command runs on the main thread, and the window stops answering for
// that long: the work goes to a blocking worker, like `onboarding_prepare`.

#[tauri::command]
pub(crate) async fn onboarding_ssh_host_key_probe(
    app: tauri::AppHandle,
    scopes: tauri::State<'_, AccountScopeState>,
    host: ExecutionHost,
) -> Result<SshHostKeyProbe, HostKeyError> {
    let scopes = scopes.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host_key_probe(&app, &scopes, &host))
        .await
        .unwrap_or_else(|_| Err("process_wait_failed".into()))
}

fn host_key_probe(
    app: &tauri::AppHandle,
    scopes: &AccountScopeState,
    host: &ExecutionHost,
) -> Result<SshHostKeyProbe, HostKeyError> {
    let scope = scopes.lock_active()?;
    let ExecutionHost::Vps { address, port, .. } = host else {
        return Err("not_vps".into());
    };
    // Validate every host field, including the local private-key path, without
    // creating known_hosts or starting an SSH session.
    match validate_host_for_scope(app, host, scope.scope()) {
        Ok(_) | Err("host_key_missing") | Err("host_key_mismatch") => {}
        Err(error) => return Err(error.into()),
    }
    let destination = known_hosts_path(app, scope.scope(), address, *port)?;
    let scanned = scan_host_key(address, *port)?;
    let status = probe_status(&destination, &scanned)?;
    Ok(SshHostKeyProbe {
        status,
        algorithm: scanned.algorithm,
        fingerprint: scanned.fingerprint,
    })
}

#[tauri::command]
pub(crate) async fn onboarding_ssh_host_key_confirm(
    app: tauri::AppHandle,
    scopes: tauri::State<'_, AccountScopeState>,
    host: ExecutionHost,
    algorithm: String,
    fingerprint: String,
) -> Result<(), HostKeyError> {
    let scopes = scopes.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        host_key_confirm(&app, &scopes, &host, &algorithm, &fingerprint)
    })
    .await
    .unwrap_or_else(|_| Err("process_wait_failed".into()))
}

fn host_key_confirm(
    app: &tauri::AppHandle,
    scopes: &AccountScopeState,
    host: &ExecutionHost,
    algorithm: &str,
    fingerprint: &str,
) -> Result<(), HostKeyError> {
    let scope = scopes.lock_active()?;
    if algorithm != "ssh-ed25519" || !fingerprint.starts_with("SHA256:") {
        return Err("host_key_confirmation_invalid".into());
    }
    let ExecutionHost::Vps { address, port, .. } = host else {
        return Err("not_vps".into());
    };
    match validate_host_for_scope(app, host, scope.scope()) {
        Ok(_) | Err("host_key_missing") | Err("host_key_mismatch") => {}
        Err(error) => return Err(error.into()),
    }
    let destination = known_hosts_path(app, scope.scope(), address, *port)?;
    let scanned = scan_host_key(address, *port)?;
    if scanned.algorithm != algorithm || scanned.fingerprint != fingerprint {
        return Err("host_key_changed".into());
    }
    if destination.is_file() {
        return if read_pinned_host_key(&destination)? == scanned {
            Ok(())
        } else {
            Err("host_key_mismatch".into())
        };
    }
    Ok(write_pinned_host_key(
        &destination,
        address,
        *port,
        &scanned,
    )?)
}

pub(crate) fn decode_base64(value: &str) -> Option<Vec<u8>> {
    let unpadded = value.trim_end_matches('=');
    if value.len() - unpadded.len() > 2 || unpadded.contains('=') || unpadded.len() % 4 == 1 {
        return None;
    }
    let mut output = Vec::with_capacity(unpadded.len() * 3 / 4);
    let mut accumulator = 0u32;
    let mut bits = 0u8;
    for byte in unpadded.bytes() {
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32;
        accumulator = (accumulator << 6) | digit;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((accumulator >> bits) as u8);
            accumulator &= (1 << bits) - 1;
        }
    }
    if accumulator != 0 {
        return None;
    }
    Some(output)
}

fn encode_base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity((bytes.len() * 4 + 2) / 3);
    let mut accumulator = 0u32;
    let mut bits = 0u8;
    for byte in bytes {
        accumulator = (accumulator << 8) | u32::from(*byte);
        bits += 8;
        while bits >= 6 {
            bits -= 6;
            output.push(ALPHABET[((accumulator >> bits) & 0x3f) as usize] as char);
            accumulator &= (1 << bits) - 1;
        }
    }
    if bits > 0 {
        output.push(ALPHABET[((accumulator << (6 - bits)) & 0x3f) as usize] as char);
    }
    output
}

#[cfg(unix)]
pub(crate) fn set_private_permissions(path: &Path) -> Result<(), &'static str> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|_| "permissions_failed")
}

// Windows has no mode bits: the equivalent is a protected owner-only ACL,
// read back after it is written. A failure stops the caller (fail-closed).
#[cfg(windows)]
pub(crate) fn set_private_permissions(path: &Path) -> Result<(), &'static str> {
    crate::private_acl::protect_file(path).map_err(|_| "permissions_failed")
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn set_private_permissions(_path: &Path) -> Result<(), &'static str> {
    Ok(())
}

#[cfg(unix)]
pub(crate) fn set_private_dir_permissions(path: &Path) -> Result<(), &'static str> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| "permissions_failed")
}

#[cfg(windows)]
pub(crate) fn set_private_dir_permissions(path: &Path) -> Result<(), &'static str> {
    crate::private_acl::protect_dir(path).map_err(|_| "permissions_failed")
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn set_private_dir_permissions(_path: &Path) -> Result<(), &'static str> {
    Ok(())
}

/// Why a program did not start. The OpenSSH client is an optional feature of
/// Windows: when `ssh` or `ssh-keyscan` is simply not there the person gets a
/// code of its own (install it), not the generic "a program did not start".
fn spawn_failure(program: &str, error: &std::io::Error) -> &'static str {
    if error.kind() == std::io::ErrorKind::NotFound && matches!(program, "ssh" | "ssh-keyscan") {
        "ssh_client_missing"
    } else {
        "process_start_failed"
    }
}

pub(crate) fn ssh_base_args(host: &ValidatedHost) -> Result<Vec<OsString>, &'static str> {
    let ValidatedHost::Vps {
        address,
        user,
        port,
        key_path,
        known_hosts,
    } = host
    else {
        return Err("not_vps");
    };
    // `-o` values still use ssh_config tokenization: keep this path one entry
    // even when the app-data directory contains spaces, quotes or backslashes.
    let known_hosts_option = known_hosts.display().to_string()
        .replace('\\', "\\\\").replace('"', "\\\"");
    let mut args: Vec<OsString> = vec![
        "-a".into(),
        "-x".into(),
        "-T".into(),
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=12".into(),
        // A long step (the image pull of `jht up` prints nothing for minutes) must
        // not be cut by a router that drops quiet connections: ssh sends a
        // keepalive every 30 s and gives up after four unanswered ones.
        "-o".into(),
        "ServerAliveInterval=30".into(),
        "-o".into(),
        "ServerAliveCountMax=4".into(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        "-o".into(),
        format!("UserKnownHostsFile=\"{known_hosts_option}\"").into(),
        "-o".into(),
        "GlobalKnownHostsFile=/dev/null".into(),
    ];
    args.extend(kex_args(cfg!(windows)));
    args.extend([
        "-i".into(),
        key_path.as_os_str().to_owned(),
        "-p".into(),
        port.to_string().into(),
        format!("{user}@{address}").into(),
    ]);
    Ok(args)
}

pub(crate) fn run_ssh(
    host: &ValidatedHost,
    remote_command: &'static str,
    input: Option<&[u8]>,
    timeout: Duration,
    control_path: Option<&Path>,
) -> Result<ProcessResult, &'static str> {
    run_ssh_command(host, remote_command, input, timeout, control_path)
}

/// Like `run_ssh`, for a command built at run time. The caller quotes every
/// value it puts in it; a secret never goes there, only on `input`.
pub(crate) fn run_ssh_command(
    host: &ValidatedHost,
    remote_command: &str,
    input: Option<&[u8]>,
    timeout: Duration,
    control_path: Option<&Path>,
) -> Result<ProcessResult, &'static str> {
    let mut args = ssh_base_args(host)?;
    if let Some(path) = control_path {
        args.insert(0, format!("ControlPath={}", path.display()).into());
        args.insert(0, "-o".into());
    }
    args.push(remote_command.into());
    let (result, stderr) = run_program_keeping_stderr("ssh", &args, input, timeout);
    // The stderr of ssh is looked at for one thing and dropped: a server that is
    // refusing this address for a while (see `ssh_rejects_for_a_while`).
    if matches!(&result, Ok(value) if value.code == 255) && ssh_rejects_for_a_while(&stderr) {
        return Err("ssh_rate_limited");
    }
    result
}

/// A file that stands in for one of ssh's streams: ssh's own messages (`-E`),
/// its stdout, its stdin. Private (created exclusively, owner-only before
/// anything is written in it), used once, removed with this value.
struct PrivateTempFile {
    path: PathBuf,
}

impl PrivateTempFile {
    fn create(kind: &str) -> Result<Self, &'static str> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!("jht-ssh-{kind}-{}-{nanos}.tmp", std::process::id()));
        debug_assert!(PIPE_FREE_FILE_KINDS.contains(&kind));
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| "storage_unavailable")?;
        let file = Self { path };
        set_private_permissions(&file.path)?;
        Ok(file)
    }

    /// The file with `bytes` in it, written only once it is private.
    fn with(kind: &str, bytes: &[u8]) -> Result<Self, &'static str> {
        let file = Self::create(kind)?;
        fs::OpenOptions::new()
            .write(true)
            .open(&file.path)
            .and_then(|mut handle| handle.write_all(bytes))
            .map_err(|_| "storage_unavailable")?;
        Ok(file)
    }

    fn stdio_for_writing(&self) -> Result<Stdio, &'static str> {
        fs::OpenOptions::new().write(true).open(&self.path).map(Stdio::from).map_err(|_| "storage_unavailable")
    }

    fn stdio_for_reading(&self) -> Result<Stdio, &'static str> {
        fs::File::open(&self.path).map(Stdio::from).map_err(|_| "storage_unavailable")
    }

    fn read(&self) -> Vec<u8> {
        fs::File::open(&self.path).map(read_capped).unwrap_or_default()
    }
}

impl Drop for PrivateTempFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// The streams a pipe-free call keeps in files: `jht-ssh-<kind>-<pid>-<nanos>.tmp`.
const PIPE_FREE_FILE_KINDS: [&str; 3] = ["in", "out", "messages"];
/// Well past the longest pipe-free call (the chat's send, 105 s): a file this old belongs to no call.
#[cfg_attr(not(windows), allow(dead_code))]
const PIPE_FREE_FILE_STALE_AFTER: Duration = Duration::from_secs(600);

/// Whether `name` is exactly the name of a file of a pipe-free call.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_pipe_free_file_name(name: &str) -> bool {
    let Some(rest) = name.strip_prefix("jht-ssh-").and_then(|rest| rest.strip_suffix(".tmp")) else {
        return false;
    };
    let parts: Vec<&str> = rest.split('-').collect();
    let number = |part: &str| !part.is_empty() && part.len() <= 40 && part.bytes().all(|byte| byte.is_ascii_digit());
    parts.len() == 3 && PIPE_FREE_FILE_KINDS.contains(&parts[0]) && number(parts[1]) && number(parts[2])
}

/// Removes, in `dir`, the files of pipe-free calls older than `stale_after`: what a crash of the app
/// left in the middle of a call (the input of a chat command among them). Only regular files with
/// exactly that name: never a link, a reparse point or a folder.
#[cfg_attr(not(windows), allow(dead_code))]
fn remove_stale_pipe_free_files_in(dir: &Path, stale_after: Duration, now: std::time::SystemTime) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        if !entry.file_name().to_str().is_some_and(is_pipe_free_file_name) {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.file_type().is_file() || is_reparse_point(&metadata) {
            continue;
        }
        let old = metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > stale_after);
        if old && fs::remove_file(&path).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
#[allow(dead_code)]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

/// At start, on Windows only (the one place the pipe-free calls run), in the user's own temporary
/// folder: never in a /tmp shared with other users.
pub(crate) fn remove_stale_pipe_free_files() {
    #[cfg(windows)]
    {
        let _ = remove_stale_pipe_free_files_in(&std::env::temp_dir(), PIPE_FREE_FILE_STALE_AFTER, std::time::SystemTime::now());
    }
}

/// A program with no pipe at all: stdin from a private file (or the null
/// device), stdout into a private file read once it has exited, stderr on the
/// null device. Windows' ssh.exe (9.5p1) stays hung when data passes on any of
/// its pipes, stdin, stdout or stderr alike, and exits with files (T69).
fn run_program_without_pipes<I, S>(
    program: &str,
    args: I,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, &'static str>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let stdout = PrivateTempFile::create("out")?;
    let stdin = input.map(|bytes| PrivateTempFile::with("in", bytes)).transpose()?;
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(match &stdin {
            Some(file) => file.stdio_for_reading()?,
            None => Stdio::null(),
        })
        .stdout(stdout.stdio_for_writing()?)
        .stderr(Stdio::null());
    hide_console(&mut command);
    let mut child = command.spawn().map_err(|error| spawn_failure(program, &error))?;
    // the command holds this process's copies of the files: closed now, so only the child has them
    drop(command);
    let status = wait_until(&mut child, Instant::now(), timeout, Duration::from_millis(50))?;
    Ok(ProcessResult {
        code: status.code().unwrap_or(-1),
        stdout: stdout.read(),
    })
}

/// The remote command with its stderr left on the server: the VPS runs it in
/// a POSIX shell, and nothing it prints on stderr travels back to ssh.
fn without_remote_stderr(remote_command: &str) -> String {
    format!("exec 2>/dev/null; {remote_command}")
}

/// ssh's arguments when it gets no pipe: its own messages go to `messages`
/// (`-E`), the remote command's stderr stays on the server.
fn pipe_free_ssh_args(
    host: &ValidatedHost,
    messages: &Path,
    remote_command: &str,
) -> Result<Vec<OsString>, &'static str> {
    let mut args: Vec<OsString> = vec!["-E".into(), messages.as_os_str().to_owned()];
    args.extend(ssh_base_args(host)?);
    args.push(without_remote_stderr(remote_command).into());
    Ok(args)
}

/// `run_ssh_command` for Windows' ssh (Win32-OpenSSH 9.5p1), which stays hung
/// when data passes on any of its pipes (T69, measured live: a command that
/// prints anything never returns). So ssh gets no pipe: its input comes from a
/// private file, its output goes to one read after it ends, its own messages to
/// a third (`-E`, read for `ssh_rate_limited`), its stderr is the null device,
/// and the remote command's stderr stays on the server. The files are removed
/// when the call ends. No ControlMaster either: every call is its own connection.
///
/// NEVER give it credentials as `input` (a provider key, a token, a password): the input is on disk
/// for the length of the call. Its callers send the chat's probe, script, delivery and messages:
/// personal data, not secrets. A new caller with a secret needs another way in.
pub(crate) fn run_ssh_command_without_pipes(
    host: &ValidatedHost,
    remote_command: &str,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, &'static str> {
    run_ssh_command_without_pipes_with("ssh", host, remote_command, input, timeout)
}

fn run_ssh_command_without_pipes_with(
    program: &str,
    host: &ValidatedHost,
    remote_command: &str,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, &'static str> {
    let messages = PrivateTempFile::create("messages")?;
    let args = pipe_free_ssh_args(host, &messages.path, remote_command)?;
    let result = run_program_without_pipes(program, &args, input, timeout);
    if matches!(&result, Ok(value) if value.code == 255) && ssh_rejects_for_a_while(&messages.read()) {
        return Err("ssh_rate_limited");
    }
    result
}

fn read_capped(mut reader: impl Read) -> Vec<u8> {
    let mut output = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => {
                let remaining = MAX_OUTPUT_BYTES.saturating_sub(output.len());
                if remaining > 0 {
                    output.extend_from_slice(&buffer[..count.min(remaining)]);
                }
            }
        }
    }
    output
}

/// On Windows a console program started by the app (PowerShell, wsl.exe,
/// curl.exe, ssh.exe) would open its own console window: the user must never
/// see a terminal. The app itself has none either (main.rs), so every program
/// it starts goes through here.
#[cfg(windows)]
pub(crate) fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}
#[cfg(not(windows))]
pub(crate) fn hide_console(_command: &mut Command) {}

/// The longest stdout line run_program_lines hands over whole; a longer one
/// arrives in pieces.
const MAX_LINE_BYTES: u64 = 4096;
/// After the program exits, how long its last lines may take to arrive. A
/// process it left running in the background can hold its stdout open for
/// ever (a Podman machine started by an installer): the app does not wait
/// for that one.
const LINES_DRAIN_GRACE: Duration = Duration::from_secs(2);

/// run_program for a long installer that says what it is doing: stdin
/// closed, each stdout line handed to `on_line` while the program runs, the
/// exit code returned. stdout is not kept and stderr is drained unread, as
/// in run_program.
pub(crate) fn run_program_lines<I, S>(
    program: &str,
    args: I,
    timeout: Duration,
    on_line: impl FnMut(&str),
) -> Result<i32, &'static str>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_program_lines_keeping_stderr(program, args, timeout, on_line).0
}

/// run_program_lines that also returns what the program printed on stderr
/// (capped), for the local runtime's own log only: see run_program_keeping_stderr.
pub(crate) fn run_program_lines_keeping_stderr<I, S>(
    program: &str,
    args: I,
    timeout: Duration,
    mut on_line: impl FnMut(&str),
) -> (Result<i32, &'static str>, Vec<u8>)
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    use std::io::BufRead;
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return (Err(spawn_failure(program, &error)), Vec::new()),
    };
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return (Err("process_pipe_failed"), Vec::new());
    };
    let (lines, received) = std::sync::mpsc::channel::<String>();
    // Neither reader is joined: see LINES_DRAIN_GRACE.
    thread::spawn(move || {
        let mut reader = std::io::BufReader::new(stdout);
        let mut line = Vec::new();
        loop {
            line.clear();
            match (&mut reader).take(MAX_LINE_BYTES).read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if lines.send(String::from_utf8_lossy(&line).into_owned()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    // stderr is read as it comes, so what arrived is there even when the
    // program is killed or leaves a process holding the pipe.
    let kept = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let (stderr_closed, stderr_done) = std::sync::mpsc::channel::<()>();
    {
        let kept = kept.clone();
        thread::spawn(move || {
            let mut stderr = stderr;
            let mut buffer = [0u8; 8192];
            loop {
                match stderr.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        if let Ok(mut kept) = kept.lock() {
                            let room = MAX_OUTPUT_BYTES.saturating_sub(kept.len());
                            kept.extend_from_slice(&buffer[..count.min(room)]);
                        }
                    }
                }
            }
            let _ = stderr_closed.send(());
        });
    }
    let taken = |kept: &std::sync::Mutex<Vec<u8>>| kept.lock().map(|mut kept| std::mem::take(&mut *kept)).unwrap_or_default();
    let started = Instant::now();
    let tick = Duration::from_millis(50);
    let code = loop {
        match received.recv_timeout(tick) {
            Ok(line) => on_line(&line),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            // stdout closed: recv_timeout no longer waits, so this does.
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => thread::sleep(tick),
        }
        match child.try_wait() {
            Ok(Some(status)) => break status.code().unwrap_or(-1),
            Ok(None) => {}
            Err(_) => return (Err("process_wait_failed"), taken(&kept)),
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return (Err("process_timeout"), taken(&kept));
        }
    };
    let exited = Instant::now();
    while let Some(left) = LINES_DRAIN_GRACE.checked_sub(exited.elapsed()) {
        match received.recv_timeout(left) {
            Ok(line) => on_line(&line),
            Err(_) => break,
        }
    }
    if let Some(left) = LINES_DRAIN_GRACE.checked_sub(exited.elapsed()) {
        let _ = stderr_done.recv_timeout(left);
    }
    (Ok(code), taken(&kept))
}

/// What `wait_until` needs from a process: say whether it has ended, and stop it.
trait Waited {
    fn poll(&mut self) -> std::io::Result<Option<std::process::ExitStatus>>;
    /// Kill it and reap it.
    fn stop(&mut self);
}

impl Waited for std::process::Child {
    fn poll(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        self.try_wait()
    }
    fn stop(&mut self) {
        let _ = self.kill();
        let _ = self.wait();
    }
}

/// Waits for a process to end, up to `timeout` from `started`. A deadline that
/// passes and a wait that fails both stop the process: one left running holds
/// the pipe the input's writer is blocked on, and the writer is joined next.
fn wait_until<W: Waited>(
    child: &mut W,
    started: Instant,
    timeout: Duration,
    poll: Duration,
) -> Result<std::process::ExitStatus, &'static str> {
    loop {
        match child.poll() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {}
            Err(_) => {
                child.stop();
                return Err("process_wait_failed");
            }
        }
        if started.elapsed() >= timeout {
            child.stop();
            return Err("process_timeout");
        }
        thread::sleep(poll);
    }
}

pub(crate) fn run_program<I, S>(
    program: &str,
    args: I,
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, &'static str>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_program_keeping_stderr_with_removed_env(program, args, input, timeout, &[]).0
}

/// Starts a native helper with named inherited environment variables removed.
/// The local Podman shim must not be redirected by a user's remote connection
/// settings: its runtime bundle identifies the only engine it may address.
pub(crate) fn run_program_without_env<I, S>(
    program: &str,
    args: I,
    input: Option<&[u8]>,
    timeout: Duration,
    removed_env: &[&str],
) -> Result<ProcessResult, &'static str>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_program_keeping_stderr_with_removed_env(program, args, input, timeout, removed_env).0
}

/// run_program that also returns what the program printed on stderr. Only
/// for the steps that prepare the local runtime, which keep it in their own
/// log (runtime_log.rs, redacted there): never for SSH or provider commands,
/// whose stderr can carry credentials or host data.
pub(crate) fn run_program_keeping_stderr<I, S>(
    program: &str,
    args: I,
    input: Option<&[u8]>,
    timeout: Duration,
) -> (Result<ProcessResult, &'static str>, Vec<u8>)
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_program_keeping_stderr_with_removed_env(program, args, input, timeout, &[])
}

pub(crate) fn run_program_keeping_stderr_with_environment<I, S>(program: &str, args: I, input: Option<&[u8]>, timeout: Duration, current_dir: &Path, removed_env: &[&str], environment: &[(&str, &str)]) -> (Result<ProcessResult, &'static str>, Vec<u8>)
where I: IntoIterator<Item = S>, S: AsRef<OsStr>,
{
    run_program_keeping_stderr_with_options(program, args, input, timeout, Some(current_dir), removed_env, environment)
}

fn run_program_keeping_stderr_with_removed_env<I, S>(
    program: &str,
    args: I,
    input: Option<&[u8]>,
    timeout: Duration,
    removed_env: &[&str],
) -> (Result<ProcessResult, &'static str>, Vec<u8>)
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    run_program_keeping_stderr_with_options(program, args, input, timeout, None, removed_env, &[])
}

fn run_program_keeping_stderr_with_options<I, S>(program: &str, args: I, input: Option<&[u8]>, timeout: Duration, current_dir: Option<&Path>, removed_env: &[&str], environment: &[(&str, &str)]) -> (Result<ProcessResult, &'static str>, Vec<u8>)
where I: IntoIterator<Item = S>, S: AsRef<OsStr>,
{
    let mut command = Command::new(program);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for name in removed_env {
        command.env_remove(name);
    }
    for (name, value) in environment { command.env(name, value); }
    if let Some(current_dir) = current_dir { command.current_dir(current_dir); }
    hide_console(&mut command);
    if input.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return (Err(spawn_failure(program, &error)), Vec::new()),
    };
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return (Err("process_pipe_failed"), Vec::new());
    };
    let stdin = if input.is_some() {
        match child.stdin.take() {
            Some(stdin) => Some(stdin),
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return (Err("process_pipe_failed"), Vec::new());
            }
        }
    } else {
        None
    };
    let stdout_reader = thread::spawn(move || read_capped(stdout));
    let stderr_reader = thread::spawn(move || read_capped(stderr));
    let started = Instant::now();
    // The input goes in on its own thread, and the clock starts before it: a
    // process that never reads (a server that accepts the connection and then
    // stalls) would otherwise block `write_all` for good, with the timeout not
    // yet armed. Killing the child closes the pipe and frees the writer.
    let outcome = thread::scope(|scope| {
        let writer = match (stdin, input) {
            (Some(mut stdin), Some(bytes)) => {
                Some(scope.spawn(move || stdin.write_all(bytes)))
            }
            _ => None,
        };
        let status = wait_until(&mut child, started, timeout, Duration::from_millis(50));
        let input_written = match writer {
            Some(handle) => handle.join().map(|result| result.is_ok()).unwrap_or(false),
            None => true,
        };
        status.map(|status| (status, input_written))
    });
    let stdout = stdout_reader.join().unwrap_or_default();
    // stderr is never returned to UI-facing callers: SSH/provider output can
    // contain credentials or host data, and stable error codes are the public
    // contract. run_program drops it; only the local runtime's own log keeps
    // it, redacted.
    let stderr = stderr_reader.join().unwrap_or_default();
    let (status, input_written) = match outcome {
        Ok(done) => done,
        Err(code) => return (Err(code), stderr),
    };
    // A process that ended in failure without reading everything (ssh that
    // could not connect) is told by its exit code; only a process that said
    // "success" while its input was cut short is an input failure.
    if !input_written && status.success() {
        return (Err("process_input_failed"), stderr);
    }
    (
        Ok(ProcessResult {
            code: status.code().unwrap_or(-1),
            stdout,
        }),
        stderr,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        decode_base64, encode_base64, parse_scanned_host_key, probe_status, ssh_base_args,
        valid_address,
        valid_user, write_pinned_host_key, ExecutionHost, HostKeyError, ScannedHostKey,
        SshHostKeyProbe,
    };
    use crate::account_scope::AccountScopeState;
    use std::path::{Path, PathBuf};
    use std::{fs, time::SystemTime};

    #[test]
    fn host_key_commands_fail_with_a_structured_code_like_every_other_command() {
        // Compile-time pin: going back to a bare `&str` error breaks the build
        // of the tests, not just a runtime assertion. The commands themselves
        // are async (they must not run on the main thread: `ssh-keyscan` can
        // take its whole timeout) and return what these two functions return.
        let _: fn(
            &tauri::AppHandle,
            &AccountScopeState,
            &ExecutionHost,
        ) -> Result<SshHostKeyProbe, HostKeyError> = super::host_key_probe;
        let _: fn(
            &tauri::AppHandle,
            &AccountScopeState,
            &ExecutionHost,
            &str,
            &str,
        ) -> Result<(), HostKeyError> = super::host_key_confirm;

        for code in ["host_key_changed", "host_key_mismatch", "not_vps"] {
            assert_eq!(
                serde_json::to_value(HostKeyError::from(code)).unwrap(),
                serde_json::json!({ "code": code })
            );
        }
    }

    #[test]
    fn validates_only_shell_inert_host_parts() {
        assert!(valid_address("vps.example.invalid"));
        assert!(valid_address("203.0.113.8"));
        for bad in [
            "",
            "-oProxyCommand=x",
            "host;touch",
            "host name",
            "host/part",
            "a..b",
        ] {
            assert!(!valid_address(bad), "{bad}");
        }
        assert!(valid_user("deploy_user"));
        for bad in ["", "-root", "root@host", "user name", "a/b"] {
            assert!(!valid_user(bad), "{bad}");
        }
    }

    /// A process that is not a process: it answers what the test says and
    /// counts how often it was stopped.
    struct Scripted {
        answers: std::collections::VecDeque<std::io::Result<Option<std::process::ExitStatus>>>,
        stopped: usize,
    }

    impl super::Waited for Scripted {
        fn poll(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
            self.answers.pop_front().unwrap_or(Ok(None))
        }
        fn stop(&mut self) {
            self.stopped += 1;
        }
    }

    fn scripted(
        answers: Vec<std::io::Result<Option<std::process::ExitStatus>>>,
    ) -> Scripted {
        Scripted { answers: answers.into(), stopped: 0 }
    }

    #[test]
    fn a_wait_that_fails_stops_the_process_before_giving_up() {
        let mut child = scripted(vec![Ok(None), Err(std::io::Error::other("wait failed"))]);
        let result = super::wait_until(
            &mut child,
            std::time::Instant::now(),
            std::time::Duration::from_secs(60),
            std::time::Duration::from_millis(1),
        );
        assert_eq!(result.unwrap_err(), "process_wait_failed");
        assert_eq!(child.stopped, 1, "a process left running holds the pipe the writer is blocked on");
    }

    #[test]
    fn a_deadline_that_passes_stops_the_process_once() {
        let mut child = scripted(vec![]);
        let result = super::wait_until(
            &mut child,
            std::time::Instant::now(),
            std::time::Duration::ZERO,
            std::time::Duration::from_millis(1),
        );
        assert_eq!(result.unwrap_err(), "process_timeout");
        assert_eq!(child.stopped, 1);
    }

    #[cfg(unix)]
    #[test]
    fn a_process_that_ended_is_not_stopped() {
        use std::os::unix::process::ExitStatusExt;
        let mut child = scripted(vec![Ok(None), Ok(Some(std::process::ExitStatus::from_raw(0)))]);
        let result = super::wait_until(
            &mut child,
            std::time::Instant::now(),
            std::time::Duration::from_secs(60),
            std::time::Duration::from_millis(1),
        );
        assert!(result.unwrap().success());
        assert_eq!(child.stopped, 0);
    }

    #[cfg(unix)]
    fn run_with_deadline(
        program: &'static str,
        args: &'static [&'static str],
        input: Vec<u8>,
        timeout: std::time::Duration,
    ) -> Result<Result<super::ProcessResult, &'static str>, std::sync::mpsc::RecvTimeoutError> {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(super::run_program(program, args, Some(&input), timeout));
        });
        rx.recv_timeout(std::time::Duration::from_secs(20))
    }

    #[cfg(unix)]
    #[test]
    fn a_process_that_never_reads_its_input_times_out_instead_of_blocking_the_write() {
        // 4 MiB is far more than a pipe holds: `sleep` never reads it.
        let started = std::time::Instant::now();
        let result = run_with_deadline(
            "sleep",
            &["30"],
            vec![b'x'; 4 * 1024 * 1024],
            std::time::Duration::from_millis(500),
        )
        .expect("run_program must come back by itself, not hang on the write");
        assert_eq!(result.unwrap_err(), "process_timeout");
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
    }

    #[cfg(unix)]
    #[test]
    fn a_process_that_fails_before_reading_all_its_input_reports_its_exit_code() {
        let result = run_with_deadline(
            "sh",
            &["-c", "exit 255"],
            vec![b'x'; 4 * 1024 * 1024],
            std::time::Duration::from_secs(10),
        )
        .expect("run_program must come back")
        .expect("a failed process still has an exit code");
        assert_eq!(result.code, 255);
    }

    #[cfg(unix)]
    #[test]
    fn a_process_that_reads_all_its_input_and_answers_gets_everything_back() {
        let input: Vec<u8> = (0..1024 * 1024).map(|n| (n % 251) as u8).collect();
        let result = run_with_deadline(
            "cat",
            &[],
            input.clone(),
            std::time::Duration::from_secs(10),
        )
        .expect("run_program must come back")
        .expect("cat succeeds");
        assert_eq!(result.code, 0);
        assert_eq!(result.stdout, input);
    }

    #[test]
    fn ssh_base_keeps_a_long_silent_step_alive() {
        let host = super::ValidatedHost::Vps {
            address: "test-host".into(),
            user: "test".into(),
            port: 22,
            key_path: "/private/synthetic-key".into(),
            known_hosts: "/private/synthetic-known-hosts".into(),
        };
        let args = ssh_base_args(&host).unwrap();
        let values: Vec<_> = args.iter().map(|value| value.to_string_lossy().into_owned()).collect();
        for option in ["ServerAliveInterval=30", "ServerAliveCountMax=4"] {
            let at = values.iter().position(|value| value == option).expect(option);
            assert_eq!(values[at - 1], "-o", "{option} must be an -o value");
        }
    }

    #[test]
    fn a_missing_ssh_client_has_its_own_code_and_other_programs_do_not() {
        let missing = std::io::Error::from(std::io::ErrorKind::NotFound);
        let denied = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert_eq!(super::spawn_failure("ssh", &missing), "ssh_client_missing");
        assert_eq!(super::spawn_failure("ssh-keyscan", &missing), "ssh_client_missing");
        assert_eq!(super::spawn_failure("podman", &missing), "process_start_failed");
        assert_eq!(super::spawn_failure("ssh", &denied), "process_start_failed");
        // The real thing: a program that is not on the path.
        let (result, _) = super::run_program_keeping_stderr(
            "ssh-keyscan-that-does-not-exist",
            ["-V"],
            None,
            std::time::Duration::from_secs(2),
        );
        assert_eq!(result.err(), Some("process_start_failed"));
    }

    const SNTRUP: &str = concat!("sntrup761x25519-sha512", "@", "openssh.com");
    const OFFERED_KEY: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIserverkeyserverkeyserverkeyserver00";
    const OTHER_OFFERED_KEY: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIattackerkeyattackerkeyattackerkey00";

    #[test]
    fn the_key_is_found_in_what_windows_prints() {
        // BOM, CRLF, a banner comment, a key of another algorithm, a trailing comment.
        let windows = format!(
            "\u{feff}# 192.0.2.10:22 SSH-2.0-OpenSSH_10.2\r\n\
             192.0.2.10 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQ\r\n\
             192.0.2.10 ssh-ed25519 {OFFERED_KEY} offered by the server\r\n"
        );
        let key = super::parse_keyscan_output(windows.as_bytes()).expect("key");
        assert_eq!(key.algorithm, "ssh-ed25519");
        assert_eq!(key.encoded_key, OFFERED_KEY);
        // The same key under two names is one key; two keys are no key at all.
        let twice = format!("a ssh-ed25519 {OFFERED_KEY}\nb ssh-ed25519 {OFFERED_KEY}\n");
        assert!(super::parse_keyscan_output(twice.as_bytes()).is_some());
        let clash = format!("a ssh-ed25519 {OFFERED_KEY}\nb ssh-ed25519 {OTHER_OFFERED_KEY}\n");
        assert!(super::parse_keyscan_output(clash.as_bytes()).is_none());
    }

    #[test]
    fn what_windows_printed_when_it_failed_is_no_key() {
        // The real case: exit 1 after 8 s, stdout empty, the reason on stderr.
        assert!(super::parse_keyscan_output(b"").is_none());
        assert!(super::parse_keyscan_output(b"\r\n").is_none());
        assert!(super::parse_keyscan_output(b"# 192.0.2.10:22 SSH-2.0-OpenSSH_10.2\r\n").is_none());
        let kex_error = format!("choose_kex: unsupported KEX method {SNTRUP}\r\n");
        assert!(super::parse_keyscan_output(kex_error.as_bytes()).is_none());
        assert!(super::parse_keyscan_output(b"192.0.2.10 ssh-ed25519 not*base64\r\n").is_none());
    }

    #[test]
    fn the_windows_client_proposes_no_key_exchange_it_cannot_run_and_other_systems_are_untouched() {
        let on = super::kex_args(true);
        assert_eq!(on.len(), 2);
        assert_eq!(on[0].to_string_lossy(), "-o");
        let option = on[1].to_string_lossy();
        assert!(option.starts_with("KexAlgorithms=-"), "{option}");
        assert!(option.contains(SNTRUP), "{option}");
        assert!(super::kex_args(false).is_empty());

        let host = super::ValidatedHost::Vps {
            address: "test-host".into(),
            user: "test".into(),
            port: 22,
            key_path: "/private/synthetic-key".into(),
            known_hosts: "/private/synthetic-known-hosts".into(),
        };
        let args = ssh_base_args(&host).unwrap();
        let has = args.iter().any(|a| a.to_string_lossy().starts_with("KexAlgorithms="));
        assert_eq!(has, cfg!(windows));
    }

    #[test]
    fn the_host_key_probe_never_logs_in_and_trusts_only_a_file_it_throws_away() {
        let args = super::host_key_probe_args(Path::new("/tmp/jht-probe"), "192.0.2.10", 2222, true);
        let values: Vec<_> = args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
        for needed in [
            "BatchMode=yes",
            "PreferredAuthentications=none",
            "PubkeyAuthentication=no",
            "PasswordAuthentication=no",
            "GlobalKnownHostsFile=/dev/null",
            "HostKeyAlgorithms=ssh-ed25519",
            "ControlMaster=no",
            "ControlPath=none",
        ] {
            assert!(values.iter().any(|v| v == needed), "{needed}");
        }
        assert!(!values.iter().any(|v| v == "-i"), "no identity is offered");
        assert!(values.iter().any(|v| v == "UserKnownHostsFile=\"/tmp/jht-probe\""));
        assert!(values.iter().any(|v| v.starts_with("KexAlgorithms=-")));
        assert_eq!(values.last().map(String::as_str), Some("jht-hostkey@192.0.2.10"));
        assert!(!super::host_key_probe_args(Path::new("/tmp/x"), "h", 22, false)
            .iter()
            .any(|a| a.to_string_lossy().starts_with("KexAlgorithms=")));
    }

    #[test]
    fn a_server_that_is_refusing_this_address_for_a_while_is_told_from_one_that_failed() {
        assert!(super::ssh_rejects_for_a_while(
            b"kex_exchange_identification: read: Connection reset by 192.0.2.10 port 22\r\n"
        ));
        assert!(super::ssh_rejects_for_a_while(b"Connection reset by 192.0.2.10 port 22"));
        assert!(!super::ssh_rejects_for_a_while(b"Permission denied (publickey).\r\n"));
        let kex_error = format!("choose_kex: unsupported KEX method {SNTRUP}\r\n");
        assert!(!super::ssh_rejects_for_a_while(kex_error.as_bytes()));
        assert!(!super::ssh_rejects_for_a_while(b""));
    }

    /// A stand-in for `ssh` that behaves as `script` says, in its own folder.
    #[cfg(unix)]
    fn fake_ssh(script: &str) -> (PathBuf, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        // one folder per stand-in: two scripts of the same length, in tests running at once, would share it
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("jht-fake-ssh-{}-{}-{n}", std::process::id(), script.len()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("ssh");
        fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        (dir, path)
    }

    #[cfg(unix)]
    #[test]
    fn the_key_ssh_writes_in_the_throwaway_file_is_read_and_the_file_is_gone() {
        let (dir, program) = fake_ssh(&format!(
            "for a in \"$@\"; do case \"$a\" in UserKnownHostsFile=*) f=\"${{a#UserKnownHostsFile=}}\"; f=\"${{f#\\\"}}\"; f=\"${{f%\\\"}}\";; esac; done\n\
             printf '[192.0.2.10]:2222 ssh-ed25519 {OFFERED_KEY}\\r\\n' >> \"$f\"\n\
             printf '%s' \"$f\" > \"$(dirname \"$0\")/known-hosts-used\"\n\
             echo 'Permission denied (none).' >&2\nexit 255"
        ));
        let key = super::scan_host_key_with_ssh(program.to_str().unwrap(), "192.0.2.10", 2222).expect("key");
        assert_eq!(key.encoded_key, OFFERED_KEY);
        // The file the fake was told to write into is the one that must be gone
        // (other tests probe in parallel, so the temp folder is not searched).
        let used = PathBuf::from(fs::read_to_string(dir.join("known-hosts-used")).expect("path"));
        assert!(used.starts_with(std::env::temp_dir()), "{used:?}");
        assert!(!used.exists(), "the throwaway known_hosts must be removed");
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn nothing_written_is_host_key_unavailable_and_a_reset_is_its_own_code() {
        let (dir, program) = fake_ssh(&format!(
            "echo 'choose_kex: unsupported KEX method {SNTRUP}' >&2\nexit 1"
        ));
        assert_eq!(
            super::scan_host_key_with_ssh(program.to_str().unwrap(), "192.0.2.10", 22).err(),
            Some("host_key_unavailable")
        );
        let _ = fs::remove_dir_all(dir);
        let (dir, program) = fake_ssh(
            "echo 'kex_exchange_identification: read: Connection reset by 192.0.2.10 port 22' >&2\nexit 255",
        );
        assert_eq!(
            super::scan_host_key_with_ssh(program.to_str().unwrap(), "192.0.2.10", 22).err(),
            Some("ssh_rate_limited")
        );
        let _ = fs::remove_dir_all(dir);
    }

    /// Windows' ssh (T69): no master, its own messages in `-E <file>`, the remote stderr left on the
    /// server.
    #[test]
    fn pipe_free_ssh_never_opens_a_master_and_keeps_the_remote_stderr_on_the_server() {
        let host = super::ValidatedHost::Vps {
            address: "test-host".into(),
            user: "test".into(),
            port: 22,
            key_path: "/private/synthetic-key".into(),
            known_hosts: "/private/synthetic-known-hosts".into(),
        };
        let args = super::pipe_free_ssh_args(&host, Path::new("/private/synthetic.log"), "jht desktop-chat probe").unwrap();
        let values: Vec<_> = args.iter().map(|value| value.to_string_lossy().into_owned()).collect();
        assert_eq!(&values[..2], ["-E", "/private/synthetic.log"]);
        assert_eq!(values.last().unwrap(), "exec 2>/dev/null; jht desktop-chat probe");
        for forbidden in ["-M", "-S", "-O"] {
            assert!(!values.iter().any(|value| value == forbidden), "{forbidden} in {values:?}");
        }
        assert!(!values.iter().any(|value| value.starts_with("ControlMaster=yes") || value.starts_with("ControlPath=/")), "{values:?}");
        // everything else is the same ssh every other call uses
        let base: Vec<_> = ssh_base_args(&host).unwrap().iter().map(|value| value.to_string_lossy().into_owned()).collect();
        assert_eq!(&values[2..values.len() - 1], &base[..]);
    }

    /// What a crash left, and only that: old files with exactly the name of a pipe-free call go;
    /// young ones, other names, links and folders stay.
    #[test]
    fn at_start_only_old_files_of_pipe_free_calls_are_removed() {
        use std::time::{Duration, SystemTime};
        let dir = std::env::temp_dir().join(format!("jht-stale-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let now = SystemTime::now();
        let aged = |name: &str, age: u64| {
            let path = dir.join(name);
            fs::write(&path, b"synthetic").unwrap();
            fs::File::options().write(true).open(&path).unwrap().set_modified(now - Duration::from_secs(age)).unwrap();
            path
        };
        let gone = [aged("jht-ssh-in-123-456.tmp", 3600), aged("jht-ssh-out-1-2.tmp", 601), aged("jht-ssh-messages-9-9.tmp", 86400)];
        let kept = [
            aged("jht-ssh-in-123-457.tmp", 30),
            aged("jht-ssh-in-123-456.log", 3600),
            aged("jht-ssh-other-1-2.tmp", 3600),
            aged("jht-ssh-in-1-2-3.tmp", 3600),
            aged("jht-ssh-in-x-2.tmp", 3600),
            aged("jht-ssh-in--2.tmp", 3600),
            aged("xjht-ssh-in-1-2.tmp", 3600),
        ];
        fs::create_dir(dir.join("jht-ssh-out-5-5.tmp")).unwrap();
        #[cfg(unix)]
        {
            let outside = aged("outside-target", 3600);
            std::os::unix::fs::symlink(&outside, dir.join("jht-ssh-in-7-7.tmp")).unwrap();
        }
        assert_eq!(super::remove_stale_pipe_free_files_in(&dir, Duration::from_secs(600), now), gone.len());
        for path in gone {
            assert!(!path.exists(), "{path:?}");
        }
        for path in kept {
            assert!(path.exists(), "{path:?}");
        }
        assert!(dir.join("jht-ssh-out-5-5.tmp").is_dir());
        // a link with the name, however old (the link itself, not what it points to): never removed
        #[cfg(unix)]
        {
            let link = dir.join("jht-ssh-in-7-7.tmp");
            super::remove_stale_pipe_free_files_in(&dir, Duration::ZERO, now + Duration::from_secs(86_400));
            assert!(fs::symlink_metadata(&link).is_ok_and(|meta| meta.file_type().is_symlink()), "the link stays");
            assert!(dir.join("outside-target").exists());
        }
        assert_eq!(super::PIPE_FREE_FILE_STALE_AFTER, Duration::from_secs(600));
        // and the app runs it at start, off the start's path
        assert!(include_str!("lib.rs").split("generate_handler").next().unwrap().contains("std::thread::spawn(runtime_host::remove_stale_pipe_free_files);"));
        let _ = fs::remove_dir_all(&dir);
    }

    /// The files of this process's pipe-free ssh calls still on disk.
    #[cfg(unix)]
    fn pipe_free_files_left() -> Vec<PathBuf> {
        let prefix = format!("-{}-", std::process::id());
        fs::read_dir(std::env::temp_dir())
            .unwrap()
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| {
                let name = path.file_name().unwrap().to_string_lossy().into_owned();
                name.starts_with("jht-ssh-") && name.contains(&prefix) && name.ends_with(".tmp")
            })
            .collect()
    }

    /// The real process (T69: Windows' ssh stays hung when data passes on any of its pipes): a
    /// stand-in for ssh finds none of its fds 0, 1, 2 a pipe, gets its input whole from the file,
    /// has its output read back, and its messages in the `-E` file still tell a server that refuses
    /// this computer. Every file is gone after, the input's too, also after a failure and a timeout.
    #[cfg(unix)]
    #[test]
    fn pipe_free_ssh_gets_no_pipe_at_all_and_leaves_no_file_even_on_failure_or_timeout() {
        let host = super::ValidatedHost::Vps {
            address: "test-host".into(),
            user: "test".into(),
            port: 22,
            key_path: "/private/synthetic-key".into(),
            known_hosts: "/private/synthetic-known-hosts".into(),
        };
        let (dir, program) = fake_ssh(
            "for fd in 0 1 2; do if [ -p /dev/fd/$fd ]; then printf 'pipe%s ' $fd; fi; done\n\
             echo 'remote noise' >&2\n\
             case \"$*\" in\n\
             *refuse*) echo 'kex_exchange_identification: read: Connection reset by 192.0.2.10 port 22' >> \"$2\"; exit 255;;\n\
             *echo-input*) printf 'no-pipe:'; cat; exit 0;;\n\
             *fail*) exit 3;;\n\
             *hang*) exec sleep 30;;\n\
             esac\n\
             echo no-pipe",
        );
        let program = program.to_str().unwrap();
        let run = |command: &str, input: Option<&[u8]>, seconds: u64| {
            super::run_ssh_command_without_pipes_with(program, &host, command, input, std::time::Duration::from_secs(seconds))
        };
        let done = run("exit 0", None, 20).unwrap();
        assert_eq!((done.code, done.stdout_text().trim()), (0, "no-pipe"));
        let secret = b"synthetic message for the agent\nsecond line";
        let echoed = run("echo-input", Some(secret), 20).unwrap();
        assert_eq!(echoed.stdout, [b"no-pipe:".as_slice(), secret].concat());
        assert_eq!(run("refuse", Some(secret), 20).err(), Some("ssh_rate_limited"));
        assert_eq!(run("fail", Some(secret), 20).unwrap().code, 3);
        assert_eq!(run("hang", Some(secret), 1).err(), Some("process_timeout"));
        assert_eq!(pipe_free_files_left(), Vec::<PathBuf>::new(), "every file goes, on every path");
        // the same stand-in with the usual runner does see its pipes: the probe tells them apart
        let (piped, _) = super::run_program_keeping_stderr(program, ["-E", "/dev/null", "x"], Some(b"x".as_slice()), std::time::Duration::from_secs(20));
        assert_eq!(piped.unwrap().stdout_text().trim(), "pipe0 pipe1 pipe2 no-pipe");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn ssh_base_disables_forwarding_and_tty_but_an_explicit_oauth_tty_stays_last() {
        let host = super::ValidatedHost::Vps {
            address: "test-host".into(),
            user: "test".into(),
            port: 22,
            key_path: "/private/synthetic-key".into(),
            known_hosts: "/private/synthetic-known-hosts".into(),
        };
        let mut args = ssh_base_args(&host).unwrap();
        let values: Vec<_> = args.iter().map(|value| value.to_string_lossy()).collect();
        for required in [
            "-a",
            "-x",
            "-T",
            "BatchMode=yes",
            "ConnectTimeout=12",
            "StrictHostKeyChecking=yes",
        ] {
            assert!(values.iter().any(|value| value == required), "{required}");
        }
        let base_tty = values.iter().position(|value| value == "-T").unwrap();

        // The OAuth caller pops the destination and adds `-tt` before it, so
        // its explicit interactive request remains later than the base `-T`.
        let destination = args.pop().unwrap();
        args.push("-tt".into());
        args.push(destination);
        assert!(base_tty < args.len() - 2);
        assert_eq!(args[args.len() - 2].to_string_lossy(), "-tt");
        assert_eq!(
            args.last().unwrap().to_string_lossy(),
            "test@test-host"
        );
    }

    #[cfg(unix)]
    #[test]
    fn ssh_known_hosts_option_preserves_spaces_quotes_and_backslashes() {
        let path = r#"/tmp/Application Support/synthetic"quoted\known_hosts"#;
        let host = super::ValidatedHost::Vps {
            address: "synthetic.invalid".into(),
            user: "synthetic".into(),
            port: 22,
            key_path: "/tmp/synthetic-unused-key".into(),
            known_hosts: path.into(),
        };
        let args = ssh_base_args(&host).unwrap();
        let option = args.iter().find(|arg| {
            arg.to_string_lossy().starts_with("UserKnownHostsFile=")
        }).unwrap();
        // Parse only: no configuration, credentials or network connection.
        let parsed = std::process::Command::new("ssh")
            .args(["-G", "-F", "/dev/null", "-o", "CanonicalizeHostname=no",
                   "-o", "IdentityFile=none", "-o", "IdentityAgent=none", "-o"])
            .arg(option).arg("synthetic.invalid").output()
            .expect("OpenSSH is required to verify the Unix client's argument contract");
        assert!(parsed.status.success(), "OpenSSH rejected the generated option");
        let output = String::from_utf8(parsed.stdout).unwrap();
        let parsed_path = output.lines().find(|line| line.starts_with("userknownhostsfile ")).unwrap();
        assert_eq!(parsed_path, format!("userknownhostsfile {path}"));
    }

    #[test]
    fn parses_ed25519_key_and_returns_standard_sha256_fingerprint() {
        // RFC 4648 vector used as a synthetic key blob; no host or account data.
        let parsed = parse_scanned_host_key(b"example.invalid ssh-ed25519 Zm9vYmFy\n").unwrap();
        assert_eq!(parsed.algorithm, "ssh-ed25519");
        assert_eq!(parsed.encoded_key, "Zm9vYmFy");
        assert_eq!(
            parsed.fingerprint,
            "SHA256:w6uP8Tcg6K2QR905Rms8iXTlksL6OD1KOWBxTK7wxPI"
        );
    }

    #[test]
    fn rejects_ambiguous_or_unexpected_keyscan_output() {
        assert!(parse_scanned_host_key(b"host ssh-rsa Zm9vYmFy\n").is_none());
        assert!(
            parse_scanned_host_key(b"host ssh-ed25519 Zm9v\nhost ssh-ed25519 YmFy\n").is_none()
        );
        assert!(parse_scanned_host_key(b"host ssh-ed25519 not*base64\n").is_none());
    }

    #[test]
    fn base64_codec_is_unpadded_and_strict() {
        for bytes in [b"".as_slice(), b"f", b"fo", b"foo", b"foobar"] {
            let encoded = encode_base64(bytes);
            assert!(!encoded.contains('='));
            assert_eq!(decode_base64(&encoded).as_deref(), Some(bytes));
        }
        assert!(decode_base64("a").is_none());
        assert!(decode_base64("Zm=9v").is_none());
    }

    fn synthetic_key(encoded_key: &str) -> ScannedHostKey {
        parse_scanned_host_key(format!("example.invalid ssh-ed25519 {encoded_key}\n").as_bytes())
            .unwrap()
    }

    fn temporary_known_host() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("jht-host-key-test-{}-{nonce}", std::process::id()))
            .join("known_hosts")
    }

    #[test]
    fn first_seen_probe_does_not_persist_trust() {
        let destination = temporary_known_host();
        let key = synthetic_key("Zm9vYmFy");
        assert_eq!(
            probe_status(&destination, &key),
            Ok("confirmation_required")
        );
        assert!(!destination.exists());
        assert!(!destination.parent().unwrap().exists());
    }

    #[test]
    fn explicit_confirmation_is_idempotent_and_never_overwrites_a_mismatch() {
        let destination = temporary_known_host();
        let first = synthetic_key("Zm9vYmFy");
        let attacker = synthetic_key("YmF6cXV4");

        write_pinned_host_key(&destination, "example.invalid", 22, &first).unwrap();
        assert_eq!(probe_status(&destination, &first), Ok("pinned"));
        assert_eq!(
            write_pinned_host_key(&destination, "example.invalid", 22, &attacker),
            Err("host_key_mismatch")
        );
        assert_eq!(probe_status(&destination, &first), Ok("pinned"));
        assert_eq!(
            probe_status(&destination, &attacker),
            Err("host_key_mismatch")
        );

        fs::remove_dir_all(destination.parent().unwrap()).unwrap();
    }

    #[cfg(unix)]
    fn lines_of(script: &str, timeout: std::time::Duration) -> (Result<i32, &'static str>, Vec<String>) {
        let mut seen = Vec::new();
        let result = super::run_program_lines("/bin/sh", ["-c", script], timeout, |line| {
            seen.push(line.to_owned())
        });
        (result, seen)
    }

    #[cfg(unix)]
    #[test]
    fn an_installer_s_lines_arrive_in_order_with_its_exit_code() {
        let (result, seen) = lines_of(
            "echo 'JHT_PHASE wsl_check'; echo noise >&2; printf 'JHT_PHASE podman_install\\r\\n'; printf 'last'; exit 21",
            std::time::Duration::from_secs(20),
        );
        assert_eq!(result, Ok(21));
        assert_eq!(seen, ["JHT_PHASE wsl_check\n", "JHT_PHASE podman_install\r\n", "last"]);
    }

    /// Each line reaches the caller while the program still runs, not at the
    /// end: the onboarding shows the phase as it starts.
    #[cfg(unix)]
    #[test]
    fn a_line_arrives_before_the_program_ends() {
        let started = std::time::Instant::now();
        let mut first_at = None;
        let result = super::run_program_lines(
            "/bin/sh",
            ["-c", "echo first; sleep 2; echo second"],
            std::time::Duration::from_secs(20),
            |_| {
                first_at.get_or_insert_with(|| started.elapsed());
            },
        );
        assert_eq!(result, Ok(0));
        assert!(first_at.unwrap() < std::time::Duration::from_millis(1500), "{first_at:?}");
    }

    /// A background process the installer leaves running keeps stdout open:
    /// the app returns anyway, shortly after the installer exits.
    #[cfg(unix)]
    #[test]
    fn a_process_left_running_does_not_hold_the_app() {
        let started = std::time::Instant::now();
        let (result, seen) = lines_of(
            "echo 'JHT_PHASE podman_machine_start'; sleep 30 & exit 0",
            std::time::Duration::from_secs(60),
        );
        assert_eq!(result, Ok(0));
        assert_eq!(seen, ["JHT_PHASE podman_machine_start\n"]);
        assert!(started.elapsed() < std::time::Duration::from_secs(10), "{:?}", started.elapsed());
    }

    /// The local runtime's steps keep what the program said on stderr, for
    /// their log: when it fails, when it is killed, and next to its stdout.
    #[cfg(unix)]
    #[test]
    fn a_runtime_step_keeps_its_stderr_and_run_program_still_drops_it() {
        let (result, stderr) = super::run_program_keeping_stderr(
            "/bin/sh",
            ["-c", "echo out; echo 'install.ps1 : Access denied' >&2; exit 3"],
            None,
            std::time::Duration::from_secs(20),
        );
        let result = result.unwrap();
        assert_eq!((result.code, result.stdout.as_slice()), (3, &b"out\n"[..]));
        assert_eq!(stderr, b"install.ps1 : Access denied\n");

        let (timed_out, stderr) = super::run_program_keeping_stderr(
            "/bin/sh",
            ["-c", "echo 'stuck at the machine' >&2; exec sleep 30"],
            None,
            std::time::Duration::from_millis(500),
        );
        assert_eq!(timed_out.unwrap_err(), "process_timeout");
        assert_eq!(stderr, b"stuck at the machine\n");

        let mut seen = Vec::new();
        let (ended, stderr) = super::run_program_lines_keeping_stderr(
            "/bin/sh",
            ["-c", "echo 'JHT_PHASE podman_install'; echo 'winget: 0x8a15000f' >&2; exit 1"],
            std::time::Duration::from_secs(20),
            |line| seen.push(line.to_owned()),
        );
        assert_eq!(ended, Ok(1));
        assert_eq!(seen, ["JHT_PHASE podman_install\n"]);
        assert_eq!(stderr, b"winget: 0x8a15000f\n");

        let (timed_out, stderr) = super::run_program_lines_keeping_stderr(
            "/bin/sh",
            ["-c", "echo 'still pulling' >&2; exec sleep 30"],
            std::time::Duration::from_millis(500),
            |_| {},
        );
        assert_eq!(timed_out, Err("process_timeout"));
        assert_eq!(stderr, b"still pulling\n");
    }

    #[cfg(unix)]
    #[test]
    fn a_silent_installer_times_out_and_a_missing_one_does_not_start() {
        let started = std::time::Instant::now();
        let (result, _) = lines_of("exec sleep 30", std::time::Duration::from_millis(300));
        assert_eq!(result, Err("process_timeout"));
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
        let missing =
            super::run_program_lines("/nonexistent/jht-installer", ["x"], std::time::Duration::from_secs(1), |_| {});
        assert_eq!(missing, Err("process_start_failed"));
    }
}

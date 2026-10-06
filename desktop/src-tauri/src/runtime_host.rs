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

fn validate_host_for_scope(
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

fn scan_host_key(address: &str, port: u16) -> Result<ScannedHostKey, &'static str> {
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
    if !result.success() || result.stdout.is_empty() || result.stdout.len() > 64 * 1024 {
        return Err("host_key_unavailable");
    }
    parse_scanned_host_key(&result.stdout).ok_or("host_key_unavailable")
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

#[tauri::command]
pub(crate) fn onboarding_ssh_host_key_probe(
    app: tauri::AppHandle,
    scopes: tauri::State<'_, AccountScopeState>,
    host: ExecutionHost,
) -> Result<SshHostKeyProbe, &'static str> {
    let scope = scopes.lock_active()?;
    let ExecutionHost::Vps { address, port, .. } = &host else {
        return Err("not_vps");
    };
    // Validate every host field, including the local private-key path, without
    // creating known_hosts or starting an SSH session.
    match validate_host_for_scope(&app, &host, scope.scope()) {
        Ok(_) | Err("host_key_missing") | Err("host_key_mismatch") => {}
        Err(error) => return Err(error),
    }
    let destination = known_hosts_path(&app, scope.scope(), address, *port)?;
    let scanned = scan_host_key(address, *port)?;
    let status = probe_status(&destination, &scanned)?;
    Ok(SshHostKeyProbe {
        status,
        algorithm: scanned.algorithm,
        fingerprint: scanned.fingerprint,
    })
}

#[tauri::command]
pub(crate) fn onboarding_ssh_host_key_confirm(
    app: tauri::AppHandle,
    scopes: tauri::State<'_, AccountScopeState>,
    host: ExecutionHost,
    algorithm: String,
    fingerprint: String,
) -> Result<(), &'static str> {
    let scope = scopes.lock_active()?;
    if algorithm != "ssh-ed25519" || !fingerprint.starts_with("SHA256:") {
        return Err("host_key_confirmation_invalid");
    }
    let ExecutionHost::Vps { address, port, .. } = &host else {
        return Err("not_vps");
    };
    match validate_host_for_scope(&app, &host, scope.scope()) {
        Ok(_) | Err("host_key_missing") | Err("host_key_mismatch") => {}
        Err(error) => return Err(error),
    }
    let destination = known_hosts_path(&app, scope.scope(), address, *port)?;
    let scanned = scan_host_key(address, *port)?;
    if scanned.algorithm != algorithm || scanned.fingerprint != fingerprint {
        return Err("host_key_changed");
    }
    if destination.is_file() {
        return if read_pinned_host_key(&destination)? == scanned {
            Ok(())
        } else {
            Err("host_key_mismatch")
        };
    }
    write_pinned_host_key(&destination, address, *port, &scanned)
}

fn decode_base64(value: &str) -> Option<Vec<u8>> {
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
    Ok(vec![
        "-o".into(),
        "BatchMode=yes".into(),
        "-o".into(),
        "ConnectTimeout=12".into(),
        "-o".into(),
        "StrictHostKeyChecking=yes".into(),
        "-o".into(),
        format!("UserKnownHostsFile={}", known_hosts.display()).into(),
        "-o".into(),
        "GlobalKnownHostsFile=/dev/null".into(),
        "-i".into(),
        key_path.as_os_str().to_owned(),
        "-p".into(),
        port.to_string().into(),
        format!("{user}@{address}").into(),
    ])
}

pub(crate) fn run_ssh(
    host: &ValidatedHost,
    remote_command: &'static str,
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
    run_program("ssh", &args, input, timeout)
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
    let mut command = Command::new(program);
    command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if input.is_some() {
        command.stdin(Stdio::piped());
    } else {
        command.stdin(Stdio::null());
    }
    let mut child = command.spawn().map_err(|_| "process_start_failed")?;
    let stdout = child.stdout.take().ok_or("process_pipe_failed")?;
    let stderr = child.stderr.take().ok_or("process_pipe_failed")?;
    let stdout_reader = thread::spawn(move || read_capped(stdout));
    let stderr_reader = thread::spawn(move || read_capped(stderr));
    if let Some(bytes) = input {
        let mut stdin = child.stdin.take().ok_or("process_pipe_failed")?;
        stdin.write_all(bytes).map_err(|_| "process_input_failed")?;
    }
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| "process_wait_failed")? {
            break status;
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err("process_timeout");
        }
        thread::sleep(Duration::from_millis(50));
    };
    let stdout = stdout_reader.join().unwrap_or_default();
    // stderr is deliberately drained but never returned to UI-facing callers:
    // SSH/provider output can contain credentials or host data. Stable error
    // codes are the public contract.
    let _ = stderr_reader.join();
    Ok(ProcessResult {
        code: status.code().unwrap_or(-1),
        stdout,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        decode_base64, encode_base64, parse_scanned_host_key, probe_status, valid_address,
        valid_user, write_pinned_host_key, ScannedHostKey,
    };
    use std::{fs, time::SystemTime};

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
}

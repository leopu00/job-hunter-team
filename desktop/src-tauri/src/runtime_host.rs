use serde::{Deserialize, Serialize};
use std::{
    collections::hash_map::DefaultHasher,
    ffi::{OsStr, OsString},
    fs,
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
    pin_if_missing: bool,
) -> Result<ValidatedHost, &'static str> {
    match host {
        ExecutionHost::Local => Ok(ValidatedHost::Local),
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
            let root = app
                .path()
                .app_local_data_dir()
                .map_err(|_| "storage_unavailable")?;
            let dir = root.join("ssh").join("known_hosts");
            fs::create_dir_all(&dir).map_err(|_| "storage_unavailable")?;
            let known_hosts = dir.join(host_hash(address, *port));
            if !known_hosts.is_file() {
                if !pin_if_missing {
                    return Err("host_key_missing");
                }
                pin_host_key(address, *port, &known_hosts)?;
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

fn pin_host_key(address: &str, port: u16, destination: &Path) -> Result<(), &'static str> {
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
    let temporary = destination.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temporary, &result.stdout).map_err(|_| "host_key_unwritable")?;
    set_private_permissions(&temporary)?;
    fs::rename(&temporary, destination).map_err(|_| "host_key_unwritable")?;
    Ok(())
}

#[cfg(unix)]
pub(crate) fn set_private_permissions(path: &Path) -> Result<(), &'static str> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|_| "permissions_failed")
}

#[cfg(not(unix))]
pub(crate) fn set_private_permissions(_path: &Path) -> Result<(), &'static str> {
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
    use super::{valid_address, valid_user};

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
}

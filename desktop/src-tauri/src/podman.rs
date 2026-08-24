use serde::Serialize;
use std::{
    ffi::OsString,
    io::{self, BufRead, BufReader, Read, Write},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const VERSION_TIMEOUT: Duration = Duration::from_secs(4);
const INFO_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_CAPTURE_BYTES: usize = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PodmanStatus {
    pub(crate) installed: bool,
    pub(crate) ready: bool,
    pub(crate) version: Option<String>,
    pub(crate) issue: Option<&'static str>,
}

#[derive(Debug)]
pub(crate) enum CommandFailure {
    NotFound,
    TimedOut,
    Failed,
}

pub(crate) struct CommandOutcome {
    pub(crate) success: bool,
    pub(crate) stdout: Vec<u8>,
}

pub(crate) fn command(
    args: &[OsString],
    timeout: Duration,
    stdin: Option<&[u8]>,
    capture_stdout: bool,
) -> Result<CommandOutcome, CommandFailure> {
    command_inner(args, timeout, stdin, capture_stdout, None)
}

pub(crate) fn command_with_stderr_lines<F>(
    args: &[OsString],
    timeout: Duration,
    on_stderr_line: F,
) -> Result<CommandOutcome, CommandFailure>
where
    F: Fn(&str) + Send + 'static,
{
    command_inner(args, timeout, None, true, Some(Box::new(on_stderr_line)))
}

type StderrLineCallback = Box<dyn Fn(&str) + Send + 'static>;

fn command_inner(
    args: &[OsString],
    timeout: Duration,
    stdin: Option<&[u8]>,
    capture_stdout: bool,
    on_stderr_line: Option<StderrLineCallback>,
) -> Result<CommandOutcome, CommandFailure> {
    let mut command = Command::new("podman");
    command.args(args).stderr(if on_stderr_line.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    command.stdout(if capture_stdout {
        Stdio::piped()
    } else {
        Stdio::null()
    });
    command.stdin(if stdin.is_some() {
        Stdio::piped()
    } else {
        Stdio::null()
    });

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command.spawn().map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => CommandFailure::NotFound,
        _ => CommandFailure::Failed,
    })?;

    let stdout_reader = child
        .stdout
        .take()
        .map(|output| thread::spawn(move || read_bounded_output(output)));
    let stderr_reader = child
        .stderr
        .take()
        .zip(on_stderr_line)
        .map(|(output, callback)| thread::spawn(move || read_stderr_lines(output, callback)));

    if let Some(input) = stdin {
        let written = child
            .stdin
            .take()
            .ok_or(CommandFailure::Failed)
            .and_then(|mut pipe| pipe.write_all(input).map_err(|_| CommandFailure::Failed));
        if let Err(error) = written {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    }

    let started_at = Instant::now();
    let success = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.success(),
            Ok(None) if started_at.elapsed() < timeout => {
                thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                if let Some(reader) = stdout_reader {
                    let _ = reader.join();
                }
                if let Some(reader) = stderr_reader {
                    let _ = reader.join();
                }
                return Err(CommandFailure::TimedOut);
            }
            Err(_) => return Err(CommandFailure::Failed),
        }
    };

    let stdout = stdout_reader
        .map(|reader| reader.join().unwrap_or_default())
        .unwrap_or_default();
    if let Some(reader) = stderr_reader {
        let _ = reader.join();
    }
    Ok(CommandOutcome { success, stdout })
}

fn read_stderr_lines(output: impl Read, callback: StderrLineCallback) {
    for line in BufReader::new(output).lines().map_while(Result::ok) {
        callback(&line);
    }
}

fn read_bounded_output(mut output: impl Read) -> Vec<u8> {
    let mut captured = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = match output.read(&mut chunk) {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        let remaining = MAX_CAPTURE_BYTES.saturating_sub(captured.len());
        captured.extend_from_slice(&chunk[..read.min(remaining)]);
    }
    captured
}

fn args(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

fn normalized_version(stdout: &[u8]) -> Option<String> {
    let version = String::from_utf8_lossy(stdout)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    (!version.is_empty()).then(|| version.chars().take(120).collect())
}

pub(crate) fn check_podman_sync() -> PodmanStatus {
    let version_output = match command(&args(&["--version"]), VERSION_TIMEOUT, None, true) {
        Ok(output) if output.success => output,
        Ok(_) => {
            return PodmanStatus {
                installed: true,
                ready: false,
                version: None,
                issue: Some("version_failed"),
            };
        }
        Err(CommandFailure::NotFound) => {
            return PodmanStatus {
                installed: false,
                ready: false,
                version: None,
                issue: Some("not_found"),
            };
        }
        Err(CommandFailure::TimedOut) => {
            return PodmanStatus {
                installed: true,
                ready: false,
                version: None,
                issue: Some("version_timeout"),
            };
        }
        Err(CommandFailure::Failed) => {
            return PodmanStatus {
                installed: false,
                ready: false,
                version: None,
                issue: Some("check_failed"),
            };
        }
    };

    let version = normalized_version(&version_output.stdout);
    match command(&args(&["info", "--format=json"]), INFO_TIMEOUT, None, false) {
        Ok(output) if output.success => PodmanStatus {
            installed: true,
            ready: true,
            version,
            issue: None,
        },
        Err(CommandFailure::TimedOut) => PodmanStatus {
            installed: true,
            ready: false,
            version,
            issue: Some("engine_timeout"),
        },
        _ => PodmanStatus {
            installed: true,
            ready: false,
            version,
            issue: Some("engine_unavailable"),
        },
    }
}

#[tauri::command]
pub(crate) async fn check_podman() -> PodmanStatus {
    tauri::async_runtime::spawn_blocking(check_podman_sync)
        .await
        .unwrap_or(PodmanStatus {
            installed: false,
            ready: false,
            version: None,
            issue: Some("check_failed"),
        })
}

#[cfg(test)]
mod tests {
    use super::{normalized_version, read_bounded_output, MAX_CAPTURE_BYTES};

    #[test]
    fn normalizes_podman_version_output() {
        assert_eq!(
            normalized_version(b"podman version 5.5.2\r\n"),
            Some("podman version 5.5.2".to_string())
        );
    }

    #[test]
    fn ignores_empty_version_output() {
        assert_eq!(normalized_version(b"  \n"), None);
    }

    #[test]
    fn drains_but_bounds_captured_process_output() {
        let oversized = vec![b'x'; MAX_CAPTURE_BYTES + 4096];
        assert_eq!(
            read_bounded_output(oversized.as_slice()).len(),
            MAX_CAPTURE_BYTES
        );
    }
}

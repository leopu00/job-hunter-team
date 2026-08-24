use serde::Serialize;
use std::{
    io,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const VERSION_TIMEOUT: Duration = Duration::from_secs(4);
const INFO_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PodmanStatus {
    installed: bool,
    ready: bool,
    version: Option<String>,
    issue: Option<&'static str>,
}

enum CommandFailure {
    NotFound,
    TimedOut,
    Failed,
}

struct CommandOutcome {
    success: bool,
    stdout: Vec<u8>,
}

fn podman_command(
    args: &[&str],
    timeout: Duration,
    capture_stdout: bool,
) -> Result<CommandOutcome, CommandFailure> {
    let mut command = Command::new("podman");
    command.args(args).stderr(Stdio::null());
    command.stdout(if capture_stdout {
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
    let started_at = Instant::now();

    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let output = child
                    .wait_with_output()
                    .map_err(|_| CommandFailure::Failed)?;
                return Ok(CommandOutcome {
                    success: output.status.success(),
                    stdout: output.stdout,
                });
            }
            Ok(None) if started_at.elapsed() < timeout => {
                thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(CommandFailure::TimedOut);
            }
            Err(_) => return Err(CommandFailure::Failed),
        }
    }
}

fn normalized_version(stdout: &[u8]) -> Option<String> {
    let version = String::from_utf8_lossy(stdout)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    (!version.is_empty()).then(|| version.chars().take(120).collect())
}

fn check_podman_sync() -> PodmanStatus {
    let version_output = match podman_command(&["--version"], VERSION_TIMEOUT, true) {
        Ok(output) if output.success => output,
        Ok(_) => {
            return PodmanStatus {
                installed: true,
                ready: false,
                version: None,
                issue: Some("version_failed"),
            }
        }
        Err(CommandFailure::NotFound) => {
            return PodmanStatus {
                installed: false,
                ready: false,
                version: None,
                issue: Some("not_found"),
            }
        }
        Err(CommandFailure::TimedOut) => {
            return PodmanStatus {
                installed: true,
                ready: false,
                version: None,
                issue: Some("version_timeout"),
            }
        }
        Err(CommandFailure::Failed) => {
            return PodmanStatus {
                installed: false,
                ready: false,
                version: None,
                issue: Some("check_failed"),
            }
        }
    };

    let version = normalized_version(&version_output.stdout);
    match podman_command(&["info", "--format=json"], INFO_TIMEOUT, false) {
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
async fn check_podman() -> PodmanStatus {
    tauri::async_runtime::spawn_blocking(check_podman_sync)
        .await
        .unwrap_or(PodmanStatus {
            installed: false,
            ready: false,
            version: None,
            issue: Some("check_failed"),
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![check_podman])
        .run(tauri::generate_context!())
        .expect("error while running JHT Desktop");
}

#[cfg(test)]
mod tests {
    use super::normalized_version;

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
}

use crate::podman::{check_podman_sync, command, CommandFailure};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, path::BaseDirectory, Manager, State};
use zeroize::Zeroizing;

const IMAGE_NAME: &str = "localhost/jht-api-team:desktop";
const BUILD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MACHINE_TIMEOUT: Duration = Duration::from_secs(2 * 60);
const TEAM_TIMEOUT: Duration = Duration::from_secs(35 * 60);

#[derive(Default)]
pub(crate) struct TeamRuntimeState {
    running: AtomicBool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamProgress {
    stage: &'static str,
    message: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamStartError {
    code: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamStartResult {
    run_id: String,
    scored: u32,
    reviewed: u32,
    spent_usd: f64,
    agent_count: usize,
    positions: Vec<TeamPosition>,
    workspace_path: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamPosition {
    title: String,
    company: String,
    score: u32,
    state: String,
    critic_score: Option<f64>,
    critic_verdict: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliTeamResult {
    ok: bool,
    run_id: String,
    summary: CliTeamSummary,
    agents: Vec<serde_json::Value>,
    positions: Vec<TeamPosition>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliTeamSummary {
    status: String,
    scored: u32,
    reviewed: u32,
    spent_usd: f64,
}

#[tauri::command]
pub(crate) async fn start_api_team(
    app: tauri::AppHandle,
    state: State<'_, TeamRuntimeState>,
    api_key: String,
    on_progress: Channel<TeamProgress>,
) -> Result<TeamStartResult, TeamStartError> {
    let api_key = Zeroizing::new(api_key);
    if !valid_api_key(&api_key) {
        return Err(failure("invalid_api_key"));
    }
    if state
        .running
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("team_already_running"));
    }

    let runtime_dir = app
        .path()
        .resolve("runtime/api-worker/Dockerfile", BaseDirectory::Resource)
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    let workspace_dir = app
        .path()
        .app_local_data_dir()
        .ok()
        .map(|path| path.join("api-team"));

    let result = match (runtime_dir, workspace_dir) {
        (Some(runtime_dir), Some(workspace_dir)) => {
            tauri::async_runtime::spawn_blocking(move || {
                run_team(runtime_dir, workspace_dir, api_key, on_progress)
            })
            .await
            .unwrap_or_else(|_| Err(failure("runtime_failed")))
        }
        _ => Err(failure("runtime_missing")),
    };

    state.running.store(false, Ordering::Release);
    result
}

fn run_team(
    runtime_dir: PathBuf,
    workspace_dir: PathBuf,
    api_key: Zeroizing<String>,
    progress: Channel<TeamProgress>,
) -> Result<TeamStartResult, TeamStartError> {
    notify(&progress, "podman", "Avvio e verifica del motore Podman");
    ensure_podman_ready()?;
    fs::create_dir_all(&workspace_dir).map_err(|_| failure("storage_failed"))?;
    if !runtime_dir.join("Dockerfile").is_file() {
        return Err(failure("runtime_missing"));
    }

    notify(
        &progress,
        "credentials",
        "Creo una credenziale temporanea per il container",
    );
    let secret_name = unique_name("jht-openai");
    create_secret(&secret_name, api_key.as_bytes())?;
    drop(api_key);

    let result = (|| {
        notify(
            &progress,
            "image",
            "Preparo l’immagine degli agenti headless",
        );
        build_image(&runtime_dir)?;
        notify(
            &progress,
            "team",
            "Il team è partito e sta lavorando sui dati sintetici",
        );
        run_container(&workspace_dir, &secret_name)
    })();

    remove_secret(&secret_name);
    result
}

fn ensure_podman_ready() -> Result<(), TeamStartError> {
    let status = check_podman_sync();
    if !status.installed {
        return Err(failure("podman_not_found"));
    }
    if status.ready {
        return Ok(());
    }

    #[cfg(any(windows, target_os = "macos"))]
    {
        let start = command(
            &string_args(&["machine", "start"]),
            MACHINE_TIMEOUT,
            None,
            false,
        );
        if !matches!(start, Ok(output) if output.success) {
            let initialized = command(
                &string_args(&["machine", "init"]),
                MACHINE_TIMEOUT,
                None,
                false,
            );
            if !matches!(initialized, Ok(output) if output.success) {
                return Err(failure("podman_machine_failed"));
            }
            let restarted = command(
                &string_args(&["machine", "start"]),
                MACHINE_TIMEOUT,
                None,
                false,
            );
            if !matches!(restarted, Ok(output) if output.success) {
                return Err(failure("podman_machine_failed"));
            }
        }
    }

    if check_podman_sync().ready {
        Ok(())
    } else {
        Err(failure("podman_engine_unavailable"))
    }
}

fn create_secret(name: &str, api_key: &[u8]) -> Result<(), TeamStartError> {
    let result = command(
        &string_args(&["secret", "create", name, "-"]),
        Duration::from_secs(15),
        Some(api_key),
        false,
    );
    if matches!(result, Ok(output) if output.success) {
        Ok(())
    } else {
        Err(failure("credential_injection_failed"))
    }
}

fn remove_secret(name: &str) {
    let _ = command(
        &string_args(&["secret", "rm", name]),
        Duration::from_secs(10),
        None,
        false,
    );
}

fn build_image(runtime_dir: &Path) -> Result<(), TeamStartError> {
    let dockerfile = runtime_dir.join("Dockerfile");
    let args = vec![
        "build".into(),
        "--http-proxy=false".into(),
        "--cpu-period=100000".into(),
        "--cpu-quota=200000".into(),
        "--memory=1g".into(),
        "--tag".into(),
        IMAGE_NAME.into(),
        "--file".into(),
        dockerfile.into_os_string(),
        runtime_dir.as_os_str().to_owned(),
    ];
    match command(&args, BUILD_TIMEOUT, None, false) {
        Ok(output) if output.success => Ok(()),
        Err(CommandFailure::TimedOut) => Err(failure("image_build_timeout")),
        _ => Err(failure("image_build_failed")),
    }
}

fn run_container(
    workspace_dir: &Path,
    secret_name: &str,
) -> Result<TeamStartResult, TeamStartError> {
    let container_name = unique_name("jht-api-team");
    let mount = format!("{}:/workspace", workspace_dir.display());
    let secret = format!("{secret_name},type=env,target=OPENAI_API_KEY");
    let args = string_args(&[
        "run",
        "--http-proxy=false",
        "--rm",
        "--read-only",
        "--cap-drop=all",
        "--security-opt=no-new-privileges",
        "--pids-limit=256",
        "--cpus=2",
        "--memory=1g",
        "--name",
        &container_name,
        "--secret",
        &secret,
        "--volume",
        &mount,
        IMAGE_NAME,
        "--live",
        "--candidate-profile",
        "/app/fixtures/candidate-profile-2026.synthetic.json",
        "--model-profile",
        "/app/fixtures/openai-gpt-5.6-luna.profile.json",
        "--workspace",
        "/workspace",
        "--max-cost-usd",
        "0.10",
        "--max-agent-cost-usd",
        "0.02",
    ]);

    let output = command(&args, TEAM_TIMEOUT, None, true);
    let outcome = match output {
        Ok(output) if output.success => parse_result(&output.stdout, workspace_dir),
        Err(CommandFailure::TimedOut) => Err(failure("team_timeout")),
        _ => Err(failure("team_run_failed")),
    };
    if outcome.is_err() {
        let _ = command(
            &string_args(&["rm", "--force", &container_name]),
            Duration::from_secs(15),
            None,
            false,
        );
    }
    outcome
}

fn parse_result(stdout: &[u8], workspace_dir: &Path) -> Result<TeamStartResult, TeamStartError> {
    let parsed: CliTeamResult =
        serde_json::from_slice(stdout).map_err(|_| failure("team_result_invalid"))?;
    if !parsed.ok || parsed.summary.status != "completed" {
        return Err(failure("team_run_failed"));
    }
    Ok(TeamStartResult {
        run_id: parsed.run_id,
        scored: parsed.summary.scored,
        reviewed: parsed.summary.reviewed,
        spent_usd: parsed.summary.spent_usd,
        agent_count: parsed.agents.len(),
        positions: parsed.positions,
        workspace_path: workspace_dir.display().to_string(),
    })
}

fn valid_api_key(value: &str) -> bool {
    let length = value.chars().count();
    (20..=500).contains(&length) && !value.chars().any(char::is_whitespace)
}

fn unique_name(prefix: &str) -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{prefix}-{}-{millis}", std::process::id())
}

fn string_args(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
}

fn notify(channel: &Channel<TeamProgress>, stage: &'static str, message: &'static str) {
    let _ = channel.send(TeamProgress { stage, message });
}

fn failure(code: &'static str) -> TeamStartError {
    TeamStartError { code }
}

#[cfg(test)]
mod tests {
    use super::{parse_result, valid_api_key};
    use std::path::Path;

    #[test]
    fn accepts_provider_keys_without_persisting_a_prefix_contract() {
        assert!(valid_api_key("project-key-with-enough-characters"));
        assert!(!valid_api_key("short"));
        assert!(!valid_api_key("project key with whitespace"));
    }

    #[test]
    fn parses_a_completed_team_summary() {
        let result = parse_result(
            br#"{"ok":true,"runId":"run-1","summary":{"status":"completed","scored":5,"reviewed":2,"spentUsd":0.024},"agents":[{},{}],"positions":[{"title":"Engineer","company":"Example","score":88,"state":"reviewed","criticScore":9,"criticVerdict":"pass"}]}"#,
            Path::new("workspace"),
        )
        .expect("valid result");
        assert_eq!(result.scored, 5);
        assert_eq!(result.reviewed, 2);
        assert_eq!(result.agent_count, 2);
        assert_eq!(result.positions.len(), 1);
    }

    #[test]
    fn rejects_an_incomplete_team_summary() {
        let result = parse_result(
            br#"{"ok":true,"runId":"run-1","summary":{"status":"running","scored":1,"reviewed":0,"spentUsd":0},"agents":[],"positions":[]}"#,
            Path::new("workspace"),
        );
        assert_eq!(result.expect_err("must reject").code, "team_run_failed");
    }
}

use crate::podman::{check_podman_sync, command, command_with_stderr_lines, CommandFailure};
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
const TEAM_PROGRESS_PREFIX: &str = "JHT_TEAM_PROGRESS:";

#[derive(Default)]
pub(crate) struct TeamRuntimeState {
    running: AtomicBool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamProgress {
    stage: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    position_title: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliAgentProgress {
    role: String,
    agent_id: String,
    status: String,
    position_title: Option<String>,
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
    agents: Vec<TeamAgent>,
    timeline: Vec<TeamTimelineEvent>,
    workspace_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamPosition {
    source_id: String,
    title: String,
    company: String,
    score: u32,
    state: String,
    critic_score: Option<f64>,
    critic_verdict: Option<String>,
    cv_markdown: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliTeamPosition {
    source_id: String,
    title: String,
    company: String,
    score: u32,
    state: String,
    critic_score: Option<f64>,
    critic_verdict: Option<String>,
    cv_path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamAgent {
    agent_id: String,
    role: String,
    cost_usd: f64,
    input_tokens: u64,
    output_tokens: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamTimelineEvent {
    sequence: u64,
    source_id: Option<String>,
    actor: String,
    event: String,
    from: Option<String>,
    to: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliTeamResult {
    ok: bool,
    run_id: String,
    summary: CliTeamSummary,
    agents: Vec<TeamAgent>,
    positions: Vec<CliTeamPosition>,
    timeline: Vec<TeamTimelineEvent>,
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
        run_container(&workspace_dir, &secret_name, &progress)
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
    progress: &Channel<TeamProgress>,
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

    let progress_channel = progress.clone();
    let output = command_with_stderr_lines(&args, TEAM_TIMEOUT, move |line| {
        if let Some(event) = parse_agent_progress(line) {
            notify_agent(&progress_channel, event);
        }
    });
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
    let positions = parsed
        .positions
        .into_iter()
        .map(|position| {
            let cv_markdown = position
                .cv_path
                .as_ref()
                .and_then(|_| read_cv_markdown(workspace_dir, &parsed.run_id, &position.source_id));
            TeamPosition {
                source_id: position.source_id,
                title: position.title,
                company: position.company,
                score: position.score,
                state: position.state,
                critic_score: position.critic_score,
                critic_verdict: position.critic_verdict,
                cv_markdown,
            }
        })
        .collect();
    Ok(TeamStartResult {
        run_id: parsed.run_id,
        scored: parsed.summary.scored,
        reviewed: parsed.summary.reviewed,
        spent_usd: parsed.summary.spent_usd,
        agent_count: parsed.agents.len(),
        positions,
        agents: parsed.agents,
        timeline: parsed.timeline,
        workspace_path: workspace_dir.display().to_string(),
    })
}

fn read_cv_markdown(workspace_dir: &Path, run_id: &str, source_id: &str) -> Option<String> {
    if !safe_path_component(run_id) || !safe_path_component(source_id) {
        return None;
    }
    let artifact = workspace_dir
        .join("runs")
        .join(run_id)
        .join("artifacts")
        .join(format!("{source_id}.cv.md"));
    let metadata = fs::symlink_metadata(&artifact).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return None;
    }
    let workspace = workspace_dir.canonicalize().ok()?;
    let artifact = artifact.canonicalize().ok()?;
    if !artifact.starts_with(&workspace) {
        return None;
    }
    let contents = fs::read(artifact).ok()?;
    if contents.len() > 300_000 {
        return None;
    }
    String::from_utf8(contents).ok()
}

fn safe_path_component(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 120
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        && value != "."
        && value != ".."
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

fn notify(channel: &Channel<TeamProgress>, stage: &str, message: &str) {
    let _ = channel.send(TeamProgress {
        stage: stage.to_owned(),
        message: message.to_owned(),
        role: None,
        agent_id: None,
        status: None,
        position_title: None,
    });
}

fn parse_agent_progress(line: &str) -> Option<CliAgentProgress> {
    let event: CliAgentProgress =
        serde_json::from_str(line.strip_prefix(TEAM_PROGRESS_PREFIX)?).ok()?;
    if !matches!(
        event.role.as_str(),
        "captain" | "scout" | "analyst" | "scorer" | "writer" | "critic" | "sentinel"
    ) || !matches!(event.status.as_str(), "working" | "completed")
        || event.agent_id.len() > 40
        || event
            .position_title
            .as_ref()
            .is_some_and(|title| title.len() > 240)
    {
        return None;
    }
    Some(event)
}

fn notify_agent(channel: &Channel<TeamProgress>, event: CliAgentProgress) {
    let message = match (
        &event.role[..],
        &event.status[..],
        event.position_title.as_deref(),
    ) {
        ("captain", "working", _) => "Il Capitano sta assegnando il lavoro".to_owned(),
        ("scout", "working", _) => "Scout sta cercando le posizioni".to_owned(),
        ("sentinel", "working", _) => "Sentinella sta verificando budget e sicurezza".to_owned(),
        (role, "working", Some(title)) => format!("{role} lavora su {title}"),
        (role, "working", None) => format!("{role} è al lavoro"),
        (role, _, Some(title)) => format!("{role} ha completato {title}"),
        (role, _, None) => format!("{role} ha completato il proprio incarico"),
    };
    let _ = channel.send(TeamProgress {
        stage: "team".to_owned(),
        message,
        role: Some(event.role),
        agent_id: Some(event.agent_id),
        status: Some(event.status),
        position_title: event.position_title,
    });
}

fn failure(code: &'static str) -> TeamStartError {
    TeamStartError { code }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_agent_progress, parse_result, read_cv_markdown, safe_path_component, valid_api_key,
    };
    use std::{
        fs,
        path::Path,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn accepts_provider_keys_without_persisting_a_prefix_contract() {
        assert!(valid_api_key("project-key-with-enough-characters"));
        assert!(!valid_api_key("short"));
        assert!(!valid_api_key("project key with whitespace"));
    }

    #[test]
    fn parses_a_completed_team_summary() {
        let result = parse_result(
            br#"{"ok":true,"runId":"run-1","summary":{"status":"completed","scored":5,"reviewed":2,"spentUsd":0.024},"agents":[{"agentId":"captain-1","role":"captain","costUsd":0.001,"inputTokens":10,"outputTokens":20}],"positions":[{"sourceId":"job-1","title":"Engineer","company":"Example","score":88,"state":"reviewed","criticScore":9,"criticVerdict":"pass","cvPath":"/workspace/runs/run-1/artifacts/job-1.cv.md"}],"timeline":[{"sequence":1,"sourceId":"job-1","actor":"scout-1","event":"handoff_queued","from":"scout","to":"analyst"}]}"#,
            Path::new("workspace"),
        )
        .expect("valid result");
        assert_eq!(result.scored, 5);
        assert_eq!(result.reviewed, 2);
        assert_eq!(result.agent_count, 1);
        assert_eq!(result.positions.len(), 1);
        assert_eq!(result.positions[0].source_id, "job-1");
        assert!(result.positions[0].cv_markdown.is_none());
        assert_eq!(result.timeline.len(), 1);
    }

    #[test]
    fn rejects_an_incomplete_team_summary() {
        let result = parse_result(
            br#"{"ok":true,"runId":"run-1","summary":{"status":"running","scored":1,"reviewed":0,"spentUsd":0},"agents":[],"positions":[],"timeline":[]}"#,
            Path::new("workspace"),
        );
        assert_eq!(result.expect_err("must reject").code, "team_run_failed");
    }

    #[test]
    fn rejects_artifact_path_traversal_components() {
        assert!(safe_path_component("9b4473d1-f746-45bb-981d-55ecad3b8fda"));
        assert!(safe_path_component("job-001"));
        assert!(!safe_path_component("../secret"));
        assert!(!safe_path_component(".."));
        assert!(!safe_path_component("nested/path"));
    }

    #[test]
    fn reads_only_regular_cv_artifacts_inside_the_workspace() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "jht-desktop-artifact-{}-{nonce}",
            std::process::id()
        ));
        let artifacts = root.join("runs/run-1/artifacts");
        fs::create_dir_all(&artifacts).expect("artifact directory");
        fs::write(artifacts.join("job-1.cv.md"), "# Safe CV").expect("artifact write");

        assert_eq!(
            read_cv_markdown(&root, "run-1", "job-1").as_deref(),
            Some("# Safe CV")
        );
        assert!(read_cv_markdown(&root, "../outside", "job-1").is_none());
        fs::remove_dir_all(root).expect("artifact cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_cv_artifact_symlinks_that_escape_the_workspace() {
        use std::os::unix::fs::symlink;

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "jht-desktop-symlink-{}-{nonce}",
            std::process::id()
        ));
        let workspace = root.join("workspace");
        let artifacts = workspace.join("runs/run-1/artifacts");
        fs::create_dir_all(&artifacts).expect("artifact directory");
        let outside = root.join("outside.md");
        fs::write(&outside, "private host data").expect("outside write");
        symlink(&outside, artifacts.join("job-1.cv.md")).expect("artifact symlink");

        assert!(read_cv_markdown(&workspace, "run-1", "job-1").is_none());
        fs::remove_dir_all(root).expect("artifact cleanup");
    }

    #[test]
    fn accepts_only_allowlisted_live_agent_progress() {
        let event = parse_agent_progress(
            r#"JHT_TEAM_PROGRESS:{"role":"analyst","agentId":"analyst-1","status":"working","positionTitle":"Agentic AI Engineer"}"#,
        )
        .expect("valid agent progress");
        assert_eq!(event.agent_id, "analyst-1");
        assert_eq!(event.position_title.as_deref(), Some("Agentic AI Engineer"));
        assert!(parse_agent_progress("npm warning: ignored").is_none());
        assert!(parse_agent_progress(
            r#"JHT_TEAM_PROGRESS:{"role":"attacker","agentId":"x","status":"working"}"#
        )
        .is_none());
    }
}

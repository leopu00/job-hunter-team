use crate::runtime_host::{
    run_program, run_ssh, set_private_permissions, ssh_base_args, validate_host, ExecutionHost,
    ProcessResult, ValidatedHost,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, Manager, State};
use zeroize::{Zeroize, Zeroizing};

const INSTALL_URL: &str = "https://jobhunterteam.ai/install.sh";
const PREPARE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(8 * 60);
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(25);
static SESSION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub(crate) struct OnboardingNativeState {
    preparing: AtomicBool,
    interactive: Mutex<Option<InteractiveSession>>,
}

impl Drop for OnboardingNativeState {
    fn drop(&mut self) {
        if let Ok(slot) = self.interactive.get_mut() {
            if let Some(session) = slot.take() {
                if let Ok(mut process) = session.child.lock() {
                    let _ = process.kill();
                    let _ = process.wait();
                }
            }
        }
    }
}

struct InteractiveSession {
    id: String,
    child: Arc<Mutex<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OnboardingProfileDraft {
    full_name: String,
    target_role: String,
    location: String,
    experience_years: i64,
    skills: Vec<String>,
    languages: Vec<String>,
    work_mode: String,
    notes: String,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SubscriptionProvider {
    Claude,
    Codex,
    Kimi,
}

#[derive(Clone, Deserialize)]
pub(crate) struct OnboardingSubmission {
    profile: OnboardingProfileDraft,
    host: ExecutionHost,
    provider: SubscriptionProvider,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OnboardingProgress {
    stage: &'static str,
    message: &'static str,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OnboardingSnapshot {
    runtime_installed: bool,
    container_running: bool,
    provider_configured: bool,
    provider_authenticated: bool,
    assistant_running: bool,
    captain_running: bool,
    profile_ready: bool,
    assistant_welcomed: bool,
    direct_chat_ready: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct OnboardingError {
    code: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InteractiveStart {
    session_id: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum InteractiveEvent {
    Output { text: String },
    Exit { code: Option<i32> },
}

fn failure(code: &'static str) -> OnboardingError {
    OnboardingError { code }
}
fn progress(channel: &Channel<OnboardingProgress>, stage: &'static str, message: &'static str) {
    let _ = channel.send(OnboardingProgress { stage, message });
}

fn clean(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}
fn clean_list(values: &[String]) -> Vec<String> {
    let mut result = Vec::new();
    for value in values {
        let value = clean(value);
        if !value.is_empty() && !result.contains(&value) {
            result.push(value);
        }
    }
    result
}
fn valid_profile(profile: &OnboardingProfileDraft, email: &str) -> bool {
    !clean(&profile.full_name).is_empty()
        && !clean(&profile.target_role).is_empty()
        && !clean(&profile.location).is_empty()
        && profile.experience_years >= 0
        && profile.experience_years <= 80
        && clean_list(&profile.skills).len() >= 2
        && clean_list(&profile.languages).len() >= 1
        && matches!(
            profile.work_mode.as_str(),
            "remote" | "hybrid" | "onsite" | "flexible"
        )
        && email.contains('@')
        && email.len() <= 320
}

fn valid_pairing_token(token: &str) -> bool {
    (16..=8192).contains(&token.len())
        && token.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=' | b'-' | b'_')
        })
}
fn seniority(years: i64) -> &'static str {
    if years < 2 {
        "entry"
    } else if years < 5 {
        "mid"
    } else if years < 10 {
        "senior"
    } else {
        "lead"
    }
}

fn wrapper_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let home = app.path().home_dir().ok()?;
    [
        home.join(".local/bin/jht"),
        PathBuf::from("/usr/local/bin/jht"),
        PathBuf::from("/opt/homebrew/bin/jht"),
    ]
    .into_iter()
    .find(|path| path.is_file())
}

fn install_local(app: &tauri::AppHandle) -> Result<PathBuf, OnboardingError> {
    if let Some(path) = wrapper_path(app) {
        return Ok(path);
    }
    #[cfg(not(unix))]
    return Err(failure("runtime_install_unsupported"));
    #[cfg(unix)]
    {
        let target = std::env::temp_dir().join(format!(
            "jht-install-{}-{}.sh",
            std::process::id(),
            SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let curl_args = [
            "-fsSL",
            INSTALL_URL,
            "-o",
            target.to_str().ok_or_else(|| failure("storage_failed"))?,
        ];
        let downloaded =
            run_program("curl", curl_args, None, Duration::from_secs(90)).map_err(failure)?;
        if !downloaded.success() {
            let _ = fs::remove_file(&target);
            return Err(failure("runtime_download_failed"));
        }
        let args = [
            "JHT_SKIP_ONBOARD=1",
            "/bin/bash",
            target.to_str().ok_or_else(|| failure("storage_failed"))?,
        ];
        let result = run_program("/usr/bin/env", args, None, PREPARE_TIMEOUT);
        let _ = fs::remove_file(&target);
        if !matches!(result, Ok(status) if status.success()) {
            return Err(failure("runtime_install_failed"));
        }
        wrapper_path(app).ok_or_else(|| failure("runtime_missing"))
    }
}

const REMOTE_INSTALL: &str = r#"set -eu
umask 077
IFS= read -r JHT_PAIRING_TOKEN
export JHT_SKIP_ONBOARD=1
jht_installer="$(mktemp)"
trap 'rm -f "$jht_installer"' EXIT HUP INT TERM
curl -fsSL https://jobhunterteam.ai/install.sh -o "$jht_installer"
/bin/bash "$jht_installer" --pairing-token "$JHT_PAIRING_TOKEN""#;
const REMOTE_JHT_UP: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" up"#;
const REMOTE_USE_CLAUDE: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers use claude"#;
const REMOTE_USE_CODEX: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers use codex"#;
const REMOTE_USE_KIMI: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers use kimi"#;
const REMOTE_UPDATE_CLAUDE: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers update claude"#;
const REMOTE_UPDATE_CODEX: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers update codex"#;
const REMOTE_UPDATE_KIMI: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers update kimi"#;
const REMOTE_TEAM_START: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" team start"#;
const REMOTE_ASSISTANT_START: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" team start assistente"#;
const REMOTE_OAUTH_LOGIN: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" oauth-login"#;

fn ensure_success(
    result: Result<ProcessResult, &'static str>,
    code: &'static str,
) -> Result<(), OnboardingError> {
    match result {
        Ok(value) if value.success() => Ok(()),
        Err("process_timeout") => Err(failure("command_timeout")),
        _ => Err(failure(code)),
    }
}

fn run_local(
    wrapper: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<ProcessResult, &'static str> {
    run_program(
        wrapper.to_str().ok_or("runtime_missing")?,
        args,
        None,
        timeout,
    )
}

fn write_local_profile(
    app: &tauri::AppHandle,
    profile: &OnboardingProfileDraft,
    email: &str,
) -> Result<(), OnboardingError> {
    if !valid_profile(profile, email) {
        return Err(failure("invalid_profile"));
    }
    let home = app
        .path()
        .home_dir()
        .map_err(|_| failure("storage_failed"))?
        .join(".jht/profile");
    fs::create_dir_all(&home).map_err(|_| failure("storage_failed"))?;
    let skills = clean_list(&profile.skills);
    let languages: Vec<Value> = clean_list(&profile.languages)
        .into_iter()
        .map(|language| json!({"language": language, "level": "not_specified"}))
        .collect();
    let value = json!({
        "name": clean(&profile.full_name), "email": clean(email),
        "target_role": clean(&profile.target_role), "location": clean(&profile.location),
        "experience_years": profile.experience_years, "seniority_target": seniority(profile.experience_years),
        "skills": {"primary": skills}, "languages": languages, "work_mode": profile.work_mode,
        "positioning": {"seniority_target": seniority(profile.experience_years),
            "preferences": {"work_mode": profile.work_mode}, "free_notes": profile.notes.trim()}
    });
    let bytes = serde_json::to_vec_pretty(&value).map_err(|_| failure("profile_write_failed"))?;
    let target = home.join("candidate_profile.yml");
    let temporary = home.join(format!("candidate_profile.tmp-{}", std::process::id()));
    fs::write(&temporary, bytes).map_err(|_| failure("profile_write_failed"))?;
    set_private_permissions(&temporary).map_err(failure)?;
    fs::rename(&temporary, &target).map_err(|_| failure("profile_write_failed"))?;
    let reread: Value =
        serde_json::from_slice(&fs::read(&target).map_err(|_| failure("profile_verify_failed"))?)
            .map_err(|_| failure("profile_verify_failed"))?;
    if reread.get("email").and_then(Value::as_str) != Some(clean(email).as_str())
        || reread.get("target_role").and_then(Value::as_str)
            != Some(clean(&profile.target_role).as_str())
    {
        return Err(failure("profile_verify_failed"));
    }
    Ok(())
}

fn prepare_impl(
    app: tauri::AppHandle,
    submission: OnboardingSubmission,
    pairing_token: Option<String>,
    account_email: String,
    channel: Channel<OnboardingProgress>,
) -> Result<OnboardingSnapshot, OnboardingError> {
    if !valid_profile(&submission.profile, &account_email) {
        return Err(failure("invalid_profile"));
    }
    let mut pairing = pairing_token.map(Zeroizing::new);
    let validated = validate_host(&app, &submission.host, true).map_err(failure)?;
    progress(&channel, "runtime", "Preparo il runtime production");
    match &validated {
        ValidatedHost::Local => {
            let wrapper = install_local(&app)?;
            ensure_success(
                run_local(&wrapper, &["up"], PREPARE_TIMEOUT),
                "container_start_failed",
            )?;
            progress(&channel, "runtime", "Configuro il provider in abbonamento");
            let use_id = match submission.provider {
                SubscriptionProvider::Claude => "claude",
                SubscriptionProvider::Codex => "codex",
                SubscriptionProvider::Kimi => "kimi",
            };
            ensure_success(
                run_local(&wrapper, &["providers", "use", use_id], COMMAND_TIMEOUT),
                "provider_config_failed",
            )?;
            ensure_success(
                run_local(&wrapper, &["providers", "update", use_id], PREPARE_TIMEOUT),
                "provider_install_failed",
            )?;
            write_local_profile(&app, &submission.profile, &account_email)?;
        }
        ValidatedHost::Vps { .. } => {
            let token = pairing
                .as_ref()
                .ok_or_else(|| failure("pairing_token_missing"))?;
            if !valid_pairing_token(token) {
                return Err(failure("pairing_token_invalid"));
            }
            let mut input = Zeroizing::new(token.as_bytes().to_vec());
            input.push(b'\n');
            ensure_success(
                run_ssh(
                    &validated,
                    REMOTE_INSTALL,
                    Some(&input),
                    PREPARE_TIMEOUT,
                    None,
                ),
                "runtime_install_failed",
            )?;
            input.zeroize();
            ensure_success(
                run_ssh(&validated, REMOTE_JHT_UP, None, PREPARE_TIMEOUT, None),
                "container_start_failed",
            )?;
            progress(&channel, "runtime", "Configuro il provider in abbonamento");
            let (use_command, update_command) = match submission.provider {
                SubscriptionProvider::Claude => (REMOTE_USE_CLAUDE, REMOTE_UPDATE_CLAUDE),
                SubscriptionProvider::Codex => (REMOTE_USE_CODEX, REMOTE_UPDATE_CODEX),
                SubscriptionProvider::Kimi => (REMOTE_USE_KIMI, REMOTE_UPDATE_KIMI),
            };
            ensure_success(
                run_ssh(&validated, use_command, None, COMMAND_TIMEOUT, None),
                "provider_config_failed",
            )?;
            ensure_success(
                run_ssh(&validated, update_command, None, PREPARE_TIMEOUT, None),
                "provider_install_failed",
            )?;
        }
    }
    if let Some(value) = pairing.as_mut() {
        value.zeroize();
    }
    snapshot_impl(&app, &validated)
}

#[tauri::command]
pub(crate) async fn onboarding_prepare(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    submission: OnboardingSubmission,
    pairing_token: Option<String>,
    account_email: String,
    on_progress: Channel<OnboardingProgress>,
) -> Result<OnboardingSnapshot, OnboardingError> {
    if state
        .preparing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        prepare_impl(app, submission, pairing_token, account_email, on_progress)
    })
    .await
    .unwrap_or_else(|_| Err(failure("runtime_failed")));
    state.preparing.store(false, Ordering::Release);
    result
}

const REMOTE_SNAPSHOT: &str = r#"set -u
JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"
[ -x "$JHT_BIN" ] && echo runtimeInstalled=1 || echo runtimeInstalled=0
if "$JHT_BIN" status >/dev/null 2>&1; then echo containerRunning=1; else echo containerRunning=0; fi
python3 - <<'PY'
import json, os
home=os.path.expanduser('~/.jht'); p=os.path.join(home,'jht.config.json')
try: c=json.load(open(p)); provider=str(c.get('active_provider') or '').lower(); cfg=(c.get('providers') or {}).get(provider) or {}
except Exception: provider=''; cfg={}
configured=provider in ('claude','anthropic','codex','openai','kimi','moonshot') and cfg.get('auth_method','subscription')=='subscription'
markers={'claude':'.claude/.credentials.json','anthropic':'.claude/.credentials.json','codex':'.codex/auth.json','openai':'.codex/auth.json','kimi':'.kimi/credentials/kimi-code.json','moonshot':'.kimi/credentials/kimi-code.json'}
print('providerConfigured='+('1' if configured else '0'))
print('providerAuthenticated='+('1' if provider in markers and os.path.isfile(os.path.join(home,markers[provider])) else '0'))
print('assistantWelcomed='+('1' if os.path.isfile(os.path.join(home,'profile/welcomed.flag')) else '0'))
PY
if "$JHT_BIN" team status 2>/dev/null | grep -q 'ASSISTENTE'; then echo assistantRunning=1; else echo assistantRunning=0; fi
if "$JHT_BIN" team status 2>/dev/null | grep -q 'CAPITANO'; then echo captainRunning=1; else echo captainRunning=0; fi
if [ -f "$HOME/.jht/profile/ready.flag" ] || "$JHT_BIN" profile validate --strict --json >/dev/null 2>&1; then echo profileReady=1; else echo profileReady=0; fi"#;

fn parse_snapshot(text: &str) -> OnboardingSnapshot {
    let has = |key: &str| text.lines().any(|line| line.trim() == format!("{key}=1"));
    OnboardingSnapshot {
        runtime_installed: has("runtimeInstalled"),
        container_running: has("containerRunning"),
        provider_configured: has("providerConfigured"),
        provider_authenticated: has("providerAuthenticated"),
        assistant_running: has("assistantRunning"),
        captain_running: has("captainRunning"),
        profile_ready: has("profileReady"),
        assistant_welcomed: has("assistantWelcomed"),
        direct_chat_ready: false,
    }
}

fn local_profile_ready(home: &Path) -> bool {
    if home.join("profile/ready.flag").is_file() {
        return true;
    }
    let Ok(raw) = fs::read(home.join("profile/candidate_profile.yml")) else {
        return false;
    };
    let Ok(value) = serde_json::from_slice::<Value>(&raw) else {
        return false;
    };
    let nonempty = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .is_some_and(|v| !v.trim().is_empty())
    };
    let skills = value
        .get("skills")
        .and_then(|v| v.get("primary"))
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    let languages = value
        .get("languages")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    nonempty("name")
        && nonempty("email")
        && nonempty("target_role")
        && nonempty("location")
        && value
            .get("experience_years")
            .and_then(Value::as_i64)
            .is_some_and(|v| v >= 0)
        && nonempty("seniority_target")
        && skills >= 2
        && languages >= 1
}

fn snapshot_impl(
    app: &tauri::AppHandle,
    host: &ValidatedHost,
) -> Result<OnboardingSnapshot, OnboardingError> {
    match host {
        ValidatedHost::Vps { .. } => {
            let result =
                run_ssh(host, REMOTE_SNAPSHOT, None, SNAPSHOT_TIMEOUT, None).map_err(failure)?;
            if !result.success() {
                return Err(failure("snapshot_failed"));
            }
            Ok(parse_snapshot(&result.stdout_text()))
        }
        ValidatedHost::Local => {
            let Some(wrapper) = wrapper_path(app) else {
                return Ok(OnboardingSnapshot::default());
            };
            let container =
                run_local(&wrapper, &["status"], SNAPSHOT_TIMEOUT).is_ok_and(|r| r.success());
            let team = if container {
                run_local(&wrapper, &["team", "status"], SNAPSHOT_TIMEOUT)
                    .ok()
                    .map(|r| r.stdout_text())
                    .unwrap_or_default()
            } else {
                String::new()
            };
            let home = app
                .path()
                .home_dir()
                .map_err(|_| failure("storage_failed"))?
                .join(".jht");
            let config: Value = fs::read(home.join("jht.config.json"))
                .ok()
                .and_then(|raw| serde_json::from_slice(&raw).ok())
                .unwrap_or(Value::Null);
            let provider = config
                .get("active_provider")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_lowercase();
            let configured = matches!(
                provider.as_str(),
                "claude" | "anthropic" | "codex" | "openai" | "kimi" | "moonshot"
            );
            let credential = match provider.as_str() {
                "claude" | "anthropic" => home.join(".claude/.credentials.json"),
                "codex" | "openai" => home.join(".codex/auth.json"),
                "kimi" | "moonshot" => home.join(".kimi/credentials/kimi-code.json"),
                _ => home.join(".no-provider"),
            };
            Ok(OnboardingSnapshot {
                runtime_installed: true,
                container_running: container,
                provider_configured: configured,
                provider_authenticated: credential.is_file(),
                assistant_running: team.contains("ASSISTENTE"),
                captain_running: team.contains("CAPITANO"),
                profile_ready: local_profile_ready(&home),
                assistant_welcomed: home.join("profile/welcomed.flag").is_file(),
                direct_chat_ready: false,
            })
        }
    }
}

#[tauri::command]
pub(crate) async fn onboarding_snapshot(
    app: tauri::AppHandle,
    host: ExecutionHost,
) -> Result<OnboardingSnapshot, OnboardingError> {
    tauri::async_runtime::spawn_blocking(move || {
        let validated = validate_host(&app, &host, false).map_err(failure)?;
        snapshot_impl(&app, &validated)
    })
    .await
    .unwrap_or_else(|_| Err(failure("snapshot_failed")))
}

#[derive(Clone, Copy)]
enum SecretMarkerKind {
    Prefix,
    KeyValue,
}

const SECRET_MARKERS: [(&str, SecretMarkerKind); 7] = [
    ("jht_sync_", SecretMarkerKind::Prefix),
    ("sk-", SecretMarkerKind::Prefix),
    ("access_token", SecretMarkerKind::KeyValue),
    ("refresh_token", SecretMarkerKind::KeyValue),
    ("id_token", SecretMarkerKind::KeyValue),
    ("code_verifier", SecretMarkerKind::KeyValue),
    ("bearer", SecretMarkerKind::KeyValue),
];

#[derive(Default)]
enum RedactionState {
    #[default]
    Scanning,
    AwaitingValue,
    Redacting,
}

#[derive(Default)]
struct StreamRedactor {
    pending: String,
    state: RedactionState,
}

impl StreamRedactor {
    fn push(&mut self, text: &str) -> String {
        self.pending.push_str(text);
        let mut output = String::new();

        loop {
            match self.state {
                RedactionState::Scanning => {
                    let lowercase = self.pending.to_ascii_lowercase();
                    let marker = SECRET_MARKERS
                        .iter()
                        .filter_map(|(marker, kind)| {
                            lowercase.find(marker).map(|start| (start, *marker, *kind))
                        })
                        .min_by_key(|(start, _, _)| *start);
                    if let Some((start, marker, kind)) = marker {
                        output.push_str(&self.pending[..start]);
                        self.pending.drain(..start + marker.len());
                        match kind {
                            SecretMarkerKind::Prefix => {
                                output.push_str("[REDACTED]");
                                self.state = RedactionState::Redacting;
                            }
                            SecretMarkerKind::KeyValue => {
                                output.push_str(marker);
                                output.push_str("=[REDACTED]");
                                self.state = RedactionState::AwaitingValue;
                            }
                        }
                        continue;
                    }

                    let lowercase = self.pending.to_ascii_lowercase();
                    let keep = SECRET_MARKERS
                        .iter()
                        .map(|(marker, _)| {
                            (1..marker.len())
                                .rev()
                                .find(|length| lowercase.ends_with(&marker[..*length]))
                                .unwrap_or(0)
                        })
                        .max()
                        .unwrap_or(0);
                    let emit = self.pending.len() - keep;
                    output.push_str(&self.pending[..emit]);
                    self.pending.drain(..emit);
                    break;
                }
                RedactionState::AwaitingValue => {
                    let value_start = self.pending.find(|character: char| {
                        !character.is_whitespace() && !matches!(character, '"' | '\'' | ':' | '=')
                    });
                    let Some(value_start) = value_start else {
                        self.pending.clear();
                        break;
                    };
                    self.pending.drain(..value_start);
                    if self.pending.starts_with(secret_terminator) {
                        let delimiter = self.pending.remove(0);
                        output.push(delimiter);
                        self.state = RedactionState::Scanning;
                    } else {
                        self.state = RedactionState::Redacting;
                    }
                }
                RedactionState::Redacting => {
                    let terminator = self.pending.find(secret_terminator);
                    let Some(terminator) = terminator else {
                        self.pending.clear();
                        break;
                    };
                    self.pending.drain(..terminator);
                    let delimiter = self.pending.remove(0);
                    output.push(delimiter);
                    self.state = RedactionState::Scanning;
                }
            }
        }

        output
    }

    fn finish(&mut self) -> String {
        match self.state {
            RedactionState::Scanning => std::mem::take(&mut self.pending),
            RedactionState::AwaitingValue | RedactionState::Redacting => {
                self.pending.clear();
                String::new()
            }
        }
    }
}

fn secret_terminator(character: char) -> bool {
    character.is_whitespace() || matches!(character, '"' | '\'' | ',' | ';' | '}' | ']' | '\u{1b}')
}

#[cfg(test)]
fn redact(text: String) -> String {
    let mut redactor = StreamRedactor::default();
    let mut output = redactor.push(&text);
    output.push_str(&redactor.finish());
    output
}

fn stream_reader(mut reader: impl Read + Send + 'static, channel: Channel<InteractiveEvent>) {
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        let mut redactor = StreamRedactor::default();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => {
                    let text = redactor.finish();
                    if !text.is_empty() {
                        let _ = channel.send(InteractiveEvent::Output { text });
                    }
                    break;
                }
                Ok(count) => {
                    let text = redactor.push(&String::from_utf8_lossy(&buffer[..count]));
                    if !text.is_empty() {
                        let _ = channel.send(InteractiveEvent::Output { text });
                    }
                }
            }
        }
    });
}

#[tauri::command]
pub(crate) fn onboarding_provider_login(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    host: ExecutionHost,
    on_event: Channel<InteractiveEvent>,
) -> Result<InteractiveStart, OnboardingError> {
    let mut slot = state
        .interactive
        .lock()
        .map_err(|_| failure("state_failed"))?;
    if let Some(session) = slot.as_ref() {
        let running = session
            .child
            .lock()
            .map_err(|_| failure("state_failed"))?
            .try_wait()
            .map_err(|_| failure("state_failed"))?
            .is_none();
        if running {
            return Err(failure("operation_in_progress"));
        }
    }
    *slot = None;
    let validated = validate_host(&app, &host, false).map_err(failure)?;
    let mut command = match &validated {
        ValidatedHost::Local => {
            let wrapper = wrapper_path(&app).ok_or_else(|| failure("runtime_missing"))?;
            #[cfg(target_os = "macos")]
            {
                let mut cmd = Command::new("/usr/bin/script");
                cmd.arg("-q")
                    .arg("/dev/null")
                    .arg(wrapper)
                    .arg("oauth-login");
                cmd
            }
            #[cfg(not(target_os = "macos"))]
            {
                let mut cmd = Command::new(wrapper);
                cmd.arg("oauth-login");
                cmd
            }
        }
        ValidatedHost::Vps { .. } => {
            let mut args = ssh_base_args(&validated).map_err(failure)?;
            let destination = args.pop().ok_or_else(|| failure("invalid_host"))?;
            let mut cmd = Command::new("ssh");
            cmd.args(args)
                .arg("-tt")
                .arg(destination)
                .arg(REMOTE_OAUTH_LOGIN);
            cmd
        }
    };
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|_| failure("provider_login_start_failed"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| failure("provider_login_pipe_failed"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| failure("provider_login_pipe_failed"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| failure("provider_login_pipe_failed"))?;
    let id = format!(
        "login-{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let child = Arc::new(Mutex::new(child));
    stream_reader(stdout, on_event.clone());
    stream_reader(stderr, on_event.clone());
    let waiter = Arc::clone(&child);
    let exit_channel = on_event.clone();
    thread::spawn(move || loop {
        let result = waiter
            .lock()
            .ok()
            .and_then(|mut process| process.try_wait().ok())
            .flatten();
        if let Some(status) = result {
            let _ = exit_channel.send(InteractiveEvent::Exit {
                code: status.code(),
            });
            break;
        }
        thread::sleep(Duration::from_millis(100));
    });
    *slot = Some(InteractiveSession {
        id: id.clone(),
        child,
        stdin: Mutex::new(Some(stdin)),
    });
    Ok(InteractiveStart { session_id: id })
}

#[tauri::command]
pub(crate) fn onboarding_provider_login_input(
    state: State<'_, OnboardingNativeState>,
    session_id: String,
    input: String,
) -> Result<(), OnboardingError> {
    if input.len() > 4096 || input.contains('\0') {
        return Err(failure("invalid_input"));
    }
    let mut input = Zeroizing::new(input);
    let slot = state
        .interactive
        .lock()
        .map_err(|_| failure("state_failed"))?;
    let session = slot
        .as_ref()
        .filter(|value| value.id == session_id)
        .ok_or_else(|| failure("session_not_found"))?;
    let mut stdin = session.stdin.lock().map_err(|_| failure("state_failed"))?;
    let writer = stdin.as_mut().ok_or_else(|| failure("session_closed"))?;
    writer
        .write_all(input.as_bytes())
        .and_then(|_| writer.write_all(b"\n"))
        .and_then(|_| writer.flush())
        .map_err(|_| failure("provider_input_failed"))?;
    input.zeroize();
    Ok(())
}

#[tauri::command]
pub(crate) fn onboarding_provider_login_close(
    state: State<'_, OnboardingNativeState>,
    session_id: String,
) -> Result<(), OnboardingError> {
    let mut slot = state
        .interactive
        .lock()
        .map_err(|_| failure("state_failed"))?;
    if !slot.as_ref().is_some_and(|value| value.id == session_id) {
        return Err(failure("session_not_found"));
    }
    let session = slot.take().ok_or_else(|| failure("session_not_found"))?;
    if let Ok(mut process) = session.child.lock() {
        let _ = process.kill();
        let _ = process.wait();
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn onboarding_team_start(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    host: ExecutionHost,
    on_progress: Channel<OnboardingProgress>,
) -> Result<OnboardingSnapshot, OnboardingError> {
    if state
        .preparing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let validated = validate_host(&app, &host, false).map_err(failure)?;
        progress(&on_progress, "team-start", "Avvio container e agenti");
        match &validated {
            ValidatedHost::Local => {
                let wrapper = wrapper_path(&app).ok_or_else(|| failure("runtime_missing"))?;
                ensure_success(
                    run_local(&wrapper, &["team", "start"], PREPARE_TIMEOUT),
                    "team_start_failed",
                )?;
            }
            ValidatedHost::Vps { .. } => ensure_success(
                run_ssh(&validated, REMOTE_TEAM_START, None, PREPARE_TIMEOUT, None),
                "team_start_failed",
            )?,
        }
        let snapshot = snapshot_impl(&app, &validated)?;
        if !snapshot.assistant_running || !snapshot.captain_running {
            return Err(failure("team_verify_failed"));
        }
        Ok(snapshot)
    })
    .await
    .unwrap_or_else(|_| Err(failure("team_start_failed")));
    state.preparing.store(false, Ordering::Release);
    result
}

#[tauri::command]
pub(crate) async fn onboarding_assistant_open(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    host: ExecutionHost,
) -> Result<OnboardingSnapshot, OnboardingError> {
    if state
        .preparing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let validated = validate_host(&app, &host, false).map_err(failure)?;
        match &validated {
            ValidatedHost::Local => {
                let wrapper = wrapper_path(&app).ok_or_else(|| failure("runtime_missing"))?;
                ensure_success(
                    run_local(&wrapper, &["team", "start", "assistente"], COMMAND_TIMEOUT),
                    "assistant_start_failed",
                )?;
            }
            ValidatedHost::Vps { .. } => ensure_success(
                run_ssh(
                    &validated,
                    REMOTE_ASSISTANT_START,
                    None,
                    COMMAND_TIMEOUT,
                    None,
                ),
                "assistant_start_failed",
            )?,
        }
        for _ in 0..40 {
            let snapshot = snapshot_impl(&app, &validated)?;
            if snapshot.assistant_running && snapshot.profile_ready && snapshot.assistant_welcomed {
                return Ok(snapshot);
            }
            thread::sleep(Duration::from_secs(3));
        }
        Err(failure("assistant_verify_timeout"))
    })
    .await
    .unwrap_or_else(|_| Err(failure("assistant_start_failed")));
    state.preparing.store(false, Ordering::Release);
    result
}

#[cfg(test)]
mod tests {
    use super::{
        parse_snapshot, redact, valid_pairing_token, valid_profile, OnboardingProfileDraft,
        StreamRedactor,
    };

    #[test]
    fn snapshot_needs_each_explicit_fact() {
        let snapshot =
            parse_snapshot("runtimeInstalled=1\ncontainerRunning=1\nproviderConfigured=1\n");
        assert!(
            snapshot.runtime_installed
                && snapshot.container_running
                && snapshot.provider_configured
        );
        assert!(!snapshot.provider_authenticated && !snapshot.captain_running);
        assert!(!snapshot.direct_chat_ready);
    }

    #[test]
    fn profile_minimum_matches_the_frontend_gate() {
        let profile = OnboardingProfileDraft {
            full_name: "Synthetic Person".into(),
            target_role: "Engineer".into(),
            location: "Example City".into(),
            experience_years: 3,
            skills: vec!["Rust".into(), "Testing".into()],
            languages: vec!["Italian".into()],
            work_mode: "hybrid".into(),
            notes: String::new(),
        };
        assert!(valid_profile(&profile, "person@example.invalid"));
        let mut incomplete = profile;
        incomplete.skills.pop();
        assert!(!valid_profile(&incomplete, "person@example.invalid"));
    }

    #[test]
    fn sensitive_output_is_redacted() {
        let text = redact(
            r#"{"access_token":"access-secret","refresh_token":"refresh-secret","id_token":"header.payload.signature","code_verifier":"verifier-secret"} Authorization: Bearer bearer-secret jht_sync_transport sk-provider"#.into(),
        );
        for secret in [
            "access-secret",
            "refresh-secret",
            "header.payload.signature",
            "verifier-secret",
            "bearer-secret",
            "jht_sync_transport",
            "sk-provider",
        ] {
            assert!(!text.contains(secret));
        }
        assert!(text.matches("[REDACTED]").count() >= 7);
    }

    #[test]
    fn sensitive_output_is_redacted_across_chunks() {
        let mut redactor = StreamRedactor::default();
        let mut output = redactor.push("status access_to");
        output.push_str(&redactor.push("ken=split-secret next code_ver"));
        output.push_str(&redactor.push("ifier: another-secret done"));
        output.push_str(&redactor.finish());

        assert!(output.contains("status "));
        assert!(output.contains("next "));
        assert!(!output.contains("split-secret"));
        assert!(!output.contains("another-secret"));
    }

    #[test]
    fn device_authorization_url_and_code_remain_visible() {
        let text = redact("Open https://auth.example.invalid/device and enter ABCD-EFGH\n".into());
        assert!(text.contains("https://auth.example.invalid/device"));
        assert!(text.contains("ABCD-EFGH"));
    }

    #[test]
    fn pairing_token_accepts_only_bounded_base64_transport() {
        assert!(valid_pairing_token("YWJjZGVmZ2hpamtsbW5vcA=="));
        assert!(!valid_pairing_token("too-short"));
        assert!(!valid_pairing_token("YWJjZGVmZ2hpamts;rm"));
    }
}

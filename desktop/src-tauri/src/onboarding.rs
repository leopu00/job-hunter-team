use crate::account_scope::{AccountScope, AccountScopeState};
use crate::runtime_host::{
    run_program, run_ssh, set_private_dir_permissions, set_private_permissions, ssh_base_args,
    validate_host, ExecutionHost, ProcessResult, ValidatedHost,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, Manager, State};
use zeroize::{Zeroize, Zeroizing};

const INSTALL_URL: &str = "https://jobhunterteam.ai/install.sh";
const INSTALL_SHA256: &str = include_str!("../installer.sha256");
const MAX_INSTALLER_BYTES: usize = 2 * 1024 * 1024;
const MAX_WRAPPER_BYTES: u64 = 2 * 1024 * 1024;
const PREPARE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(8 * 60);
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(25);
const LOCAL_CONTAINER_VERIFY_TIMEOUT: Duration = Duration::from_secs(10);
const LOCAL_CONTAINER_VERIFY_ATTEMPTS: usize = 6;
const LOCAL_CONTAINER_VERIFY_INTERVAL: Duration = Duration::from_secs(2);
const PROGRESS_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(2);
const DIAGNOSTIC_SCHEMA_VERSION: u8 = 1;
const DIAGNOSTIC_MAX_RECORDS: usize = 128;
const DIAGNOSTIC_MAX_BYTES: usize = 64 * 1024;
/// The wrapper's exit status when the JHT Podman machine mounts more of the
/// Mac than ~/.jht and the JHT documents (`PODMAN_MOUNTS_EXIT` in
/// scripts/jht-wrapper.sh). `run_local` turns it into this error code.
const PODMAN_MACHINE_MOUNTS_EXIT: i32 = 78;
const PODMAN_MACHINE_MOUNTS_HOME: &str = "podman_machine_mounts_home";
#[cfg(target_os = "macos")]
const BUNDLED_LOCAL_WRAPPER: &[u8] = include_bytes!("../../../scripts/jht-wrapper.sh");
#[cfg(target_os = "macos")]
const LOCAL_PODMAN_INSTALL_ARGS: [&str; 6] = [
    "JHT_SKIP_ONBOARD=1",
    "/bin/bash",
    "-s",
    "--",
    "--runtime",
    "podman",
];
static SESSION_SEQUENCE: AtomicU64 = AtomicU64::new(1);
static DIAGNOSTIC_SEQUENCE: AtomicU64 = AtomicU64::new(1);

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

pub(crate) fn teardown(state: &OnboardingNativeState) {
    if let Ok(mut slot) = state.interactive.lock() {
        if let Some(session) = slot.take() {
            if let Ok(mut process) = session.child.lock() {
                let _ = process.kill();
                let _ = process.wait();
            }
        }
    }
    state.preparing.store(false, Ordering::Release);
}

struct InteractiveSession {
    scope: AccountScope,
    id: String,
    child: Arc<Mutex<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    detector: Arc<Mutex<InteractiveStateDetector>>,
    pending_input: Arc<Mutex<Option<String>>>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SubscriptionProvider {
    Claude,
    Codex,
    Kimi,
}

impl SubscriptionProvider {
    fn cli_id(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Codex => "codex",
            Self::Kimi => "kimi",
        }
    }

    fn from_cli_id(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "claude" | "anthropic" => Some(Self::Claude),
            "codex" | "openai" => Some(Self::Codex),
            "kimi" | "moonshot" => Some(Self::Kimi),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LocalCliOperation {
    Up,
    Status,
    ProviderUse(SubscriptionProvider),
    ProviderUpdate(SubscriptionProvider),
    ProviderCurrent,
    OauthLogin,
    TeamStart,
    Snapshot,
    AssistantStart,
    ProviderLimits,
    PodmanMachineRecreate,
    LinkedinLogin,
    LinkedinLoginStop,
    LinkedinStatus,
}

impl LocalCliOperation {
    fn argv(self) -> Vec<&'static str> {
        match self {
            Self::Up => vec!["up"],
            Self::Status => vec!["status"],
            Self::ProviderUse(provider) => vec!["providers", "use", provider.cli_id()],
            Self::ProviderUpdate(provider) => vec!["providers", "update", provider.cli_id()],
            Self::ProviderCurrent => vec!["providers", "current"],
            Self::OauthLogin => vec!["oauth-login"],
            Self::TeamStart => vec!["team", "start"],
            Self::Snapshot => vec!["onboarding-snapshot"],
            Self::AssistantStart => vec!["team", "start", "assistente"],
            Self::ProviderLimits => vec!["providers", "limits", "--json"],
            Self::PodmanMachineRecreate => vec!["podman-machine-recreate", "--confirm"],
            Self::LinkedinLogin => vec!["linkedin", "login"],
            Self::LinkedinLoginStop => vec!["linkedin", "login", "--stop"],
            Self::LinkedinStatus => vec!["linkedin", "status", "--json"],
        }
    }

    fn diagnostic_id(self) -> &'static str {
        match self {
            Self::Up => "up",
            Self::Status => "status",
            Self::ProviderUse(_) => "provider-use",
            Self::ProviderUpdate(_) => "provider-update",
            Self::ProviderCurrent => "provider-current",
            Self::OauthLogin => "oauth-login",
            Self::TeamStart => "team-start",
            Self::Snapshot => "snapshot",
            Self::AssistantStart => "assistant-start",
            Self::ProviderLimits => "provider-limits",
            Self::PodmanMachineRecreate => "podman-machine-recreate",
            Self::LinkedinLogin => "linkedin-login",
            Self::LinkedinLoginStop => "linkedin-login-stop",
            Self::LinkedinStatus => "linkedin-status",
        }
    }
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct OnboardingSubmission {
    host: ExecutionHost,
    provider: SubscriptionProvider,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExistingTeamConnectRequest {
    team_id: String,
    host: ExecutionHost,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OnboardingProgress {
    stage: OnboardingProgressStage,
    status: OnboardingProgressStatus,
    message: &'static str,
    sequence: u64,
    elapsed_ms: u64,
    code: Option<&'static str>,
    retryable: Option<bool>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum OnboardingProgressStage {
    Engine,
    Runtime,
    Container,
    Provider,
    Login,
    Team,
    Assistant,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum OnboardingProgressStatus {
    Start,
    Progress,
    Done,
    Error,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum OnboardingDiagnosticHostKind {
    Local,
    Vps,
}

impl OnboardingDiagnosticHostKind {
    fn from_host(host: &ExecutionHost) -> Self {
        match host {
            ExecutionHost::Local => Self::Local,
            ExecutionHost::Vps { .. } => Self::Vps,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
enum OnboardingDiagnosticExitCategory {
    NotApplicable,
    Success,
    Nonzero,
    Timeout,
    Unavailable,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OnboardingDiagnosticSnapshot {
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

impl From<&OnboardingSnapshot> for OnboardingDiagnosticSnapshot {
    fn from(snapshot: &OnboardingSnapshot) -> Self {
        Self {
            runtime_installed: snapshot.runtime_installed,
            container_running: snapshot.container_running,
            provider_configured: snapshot.provider_configured,
            provider_authenticated: snapshot.provider_authenticated,
            assistant_running: snapshot.assistant_running,
            captain_running: snapshot.captain_running,
            profile_ready: snapshot.profile_ready,
            assistant_welcomed: snapshot.assistant_welcomed,
            direct_chat_ready: snapshot.direct_chat_ready,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OnboardingDiagnosticRecord {
    schema_version: u8,
    operation_id: String,
    request_id: String,
    host_kind: OnboardingDiagnosticHostKind,
    stage: OnboardingProgressStage,
    status: OnboardingProgressStatus,
    code: Option<String>,
    retryable: Option<bool>,
    elapsed_ms: u64,
    exit_category: OnboardingDiagnosticExitCategory,
    snapshot: Option<OnboardingDiagnosticSnapshot>,
}

#[derive(Clone)]
struct OnboardingDiagnosticSink {
    path: PathBuf,
    operation_id: String,
    host_kind: OnboardingDiagnosticHostKind,
    write_lock: Arc<Mutex<()>>,
}

impl OnboardingDiagnosticSink {
    fn new(
        app: &tauri::AppHandle,
        scope: &AccountScope,
        host_kind: OnboardingDiagnosticHostKind,
    ) -> Option<Self> {
        let root = app.path().app_local_data_dir().ok()?;
        Some(Self::at_root(&root, scope, host_kind))
    }

    fn at_root(root: &Path, scope: &AccountScope, host_kind: OnboardingDiagnosticHostKind) -> Self {
        Self {
            path: root
                .join("accounts")
                .join(scope.digest())
                .join("onboarding-diagnostics.jsonl"),
            operation_id: format!(
                "prepare-{}",
                DIAGNOSTIC_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ),
            host_kind,
            write_lock: Arc::new(Mutex::new(())),
        }
    }

    fn record_progress(&self, progress: &OnboardingProgress) {
        self.record(OnboardingDiagnosticRecord {
            schema_version: DIAGNOSTIC_SCHEMA_VERSION,
            operation_id: self.operation_id.clone(),
            request_id: format!("progress-{}", progress.sequence),
            host_kind: self.host_kind,
            stage: progress.stage,
            status: progress.status,
            code: progress.code.map(str::to_owned),
            retryable: progress.retryable,
            elapsed_ms: progress.elapsed_ms,
            exit_category: OnboardingDiagnosticExitCategory::NotApplicable,
            snapshot: None,
        });
    }

    fn record_process(
        &self,
        request_id: String,
        stage: OnboardingProgressStage,
        started: Instant,
        result: &Result<ProcessResult, &'static str>,
        failure_code: &'static str,
        accept_inactive: bool,
    ) {
        let (status, code, retryable, exit_category) = match result {
            Ok(value) if value.success() || (accept_inactive && value.code == 1) => (
                OnboardingProgressStatus::Done,
                None,
                None,
                OnboardingDiagnosticExitCategory::Success,
            ),
            Ok(_) => (
                OnboardingProgressStatus::Error,
                Some(failure_code.to_owned()),
                Some(failure(failure_code).retryable),
                OnboardingDiagnosticExitCategory::Nonzero,
            ),
            Err("process_timeout") => (
                OnboardingProgressStatus::Error,
                Some("container_timeout".to_owned()),
                Some(failure("container_timeout").retryable),
                OnboardingDiagnosticExitCategory::Timeout,
            ),
            Err(PODMAN_MACHINE_MOUNTS_HOME) => (
                OnboardingProgressStatus::Error,
                Some(PODMAN_MACHINE_MOUNTS_HOME.to_owned()),
                Some(false),
                OnboardingDiagnosticExitCategory::Nonzero,
            ),
            Err(_) => (
                OnboardingProgressStatus::Error,
                Some(failure_code.to_owned()),
                Some(failure(failure_code).retryable),
                OnboardingDiagnosticExitCategory::Unavailable,
            ),
        };
        self.record(OnboardingDiagnosticRecord {
            schema_version: DIAGNOSTIC_SCHEMA_VERSION,
            operation_id: self.operation_id.clone(),
            request_id,
            host_kind: self.host_kind,
            stage,
            status,
            code,
            retryable,
            elapsed_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            exit_category,
            snapshot: None,
        });
    }

    fn record_snapshot(
        &self,
        request_id: &'static str,
        started: Instant,
        result: &Result<OnboardingSnapshot, OnboardingError>,
    ) {
        let (status, code, retryable, exit_category, snapshot) = match result {
            Ok(snapshot) => (
                OnboardingProgressStatus::Done,
                None,
                None,
                OnboardingDiagnosticExitCategory::Success,
                Some(OnboardingDiagnosticSnapshot::from(snapshot)),
            ),
            Err(error) => (
                OnboardingProgressStatus::Error,
                Some(error.code.to_owned()),
                Some(error.retryable),
                if error.code.contains("timeout") {
                    OnboardingDiagnosticExitCategory::Timeout
                } else {
                    OnboardingDiagnosticExitCategory::Unavailable
                },
                None,
            ),
        };
        self.record(OnboardingDiagnosticRecord {
            schema_version: DIAGNOSTIC_SCHEMA_VERSION,
            operation_id: self.operation_id.clone(),
            request_id: request_id.to_owned(),
            host_kind: self.host_kind,
            stage: OnboardingProgressStage::Container,
            status,
            code,
            retryable,
            elapsed_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            exit_category,
            snapshot,
        });
    }

    fn record_boundary(
        &self,
        request_id: &'static str,
        stage: OnboardingProgressStage,
        started: Instant,
        result: &Result<(), OnboardingError>,
    ) {
        let (status, code, retryable, exit_category) = match result {
            Ok(()) => (
                OnboardingProgressStatus::Done,
                None,
                None,
                OnboardingDiagnosticExitCategory::Success,
            ),
            Err(error) => (
                OnboardingProgressStatus::Error,
                Some(error.code.to_owned()),
                Some(error.retryable),
                OnboardingDiagnosticExitCategory::Unavailable,
            ),
        };
        self.record(OnboardingDiagnosticRecord {
            schema_version: DIAGNOSTIC_SCHEMA_VERSION,
            operation_id: self.operation_id.clone(),
            request_id: request_id.to_owned(),
            host_kind: self.host_kind,
            stage,
            status,
            code,
            retryable,
            elapsed_ms: started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            exit_category,
            snapshot: None,
        });
    }

    fn record(&self, record: OnboardingDiagnosticRecord) {
        let Ok(_guard) = self.write_lock.lock() else {
            return;
        };
        let _ = write_onboarding_diagnostic(&self.path, record);
    }
}

fn diagnostic_identifier_valid(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn diagnostic_code_valid(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn diagnostic_record_valid(record: &OnboardingDiagnosticRecord) -> bool {
    record.schema_version == DIAGNOSTIC_SCHEMA_VERSION
        && diagnostic_identifier_valid(&record.operation_id)
        && diagnostic_identifier_valid(&record.request_id)
        && record.code.as_deref().is_none_or(diagnostic_code_valid)
}

fn diagnostic_payload(records: &[OnboardingDiagnosticRecord]) -> Result<Vec<u8>, &'static str> {
    let mut payload = Vec::new();
    for record in records {
        serde_json::to_writer(&mut payload, record).map_err(|_| "diagnostic_encode_failed")?;
        payload.push(b'\n');
    }
    Ok(payload)
}

fn write_onboarding_diagnostic(
    path: &Path,
    record: OnboardingDiagnosticRecord,
) -> Result<(), &'static str> {
    if !diagnostic_record_valid(&record) {
        return Err("diagnostic_record_invalid");
    }
    let parent = path.parent().ok_or("diagnostic_path_invalid")?;
    let accounts = parent.parent().ok_or("diagnostic_path_invalid")?;
    match fs::symlink_metadata(accounts) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) => return Err("diagnostic_storage_invalid"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(accounts).map_err(|_| "diagnostic_storage_failed")?;
        }
        Err(_) => return Err("diagnostic_storage_failed"),
    }
    if !fs::symlink_metadata(accounts).is_ok_and(|metadata| metadata.file_type().is_dir()) {
        return Err("diagnostic_storage_invalid");
    }
    match fs::symlink_metadata(parent) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) => return Err("diagnostic_storage_invalid"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(parent).map_err(|_| "diagnostic_storage_failed")?;
        }
        Err(_) => return Err("diagnostic_storage_failed"),
    }
    set_private_dir_permissions(parent)?;

    let mut records = Vec::new();
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.file_type().is_file() || metadata.len() > DIAGNOSTIC_MAX_BYTES as u64 {
                return Err("diagnostic_storage_invalid");
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::{MetadataExt, PermissionsExt};
                let parent_metadata =
                    fs::metadata(parent).map_err(|_| "diagnostic_storage_failed")?;
                if metadata.uid() != parent_metadata.uid()
                    || metadata.permissions().mode() & 0o077 != 0
                {
                    return Err("diagnostic_storage_invalid");
                }
            }
            let previous = fs::read_to_string(path).map_err(|_| "diagnostic_storage_failed")?;
            for line in previous.lines() {
                let previous: OnboardingDiagnosticRecord =
                    serde_json::from_str(line).map_err(|_| "diagnostic_storage_invalid")?;
                if !diagnostic_record_valid(&previous) {
                    return Err("diagnostic_storage_invalid");
                }
                records.push(previous);
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("diagnostic_storage_failed"),
    }
    records.push(record);
    while records.len() > DIAGNOSTIC_MAX_RECORDS {
        records.remove(0);
    }
    let payload = loop {
        let payload = diagnostic_payload(&records)?;
        if payload.len() <= DIAGNOSTIC_MAX_BYTES {
            break payload;
        }
        if records.len() <= 1 {
            return Err("diagnostic_record_invalid");
        }
        records.remove(0);
    };

    let temporary = parent.join(format!(
        ".onboarding-diagnostics-{}-{}",
        std::process::id(),
        DIAGNOSTIC_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&temporary)
            .map_err(|_| "diagnostic_storage_failed")?;
        file.write_all(&payload)
            .and_then(|_| file.sync_all())
            .map_err(|_| "diagnostic_storage_failed")?;
        set_private_permissions(&temporary)?;
        fs::rename(&temporary, path).map_err(|_| "diagnostic_storage_failed")?;
        set_private_permissions(path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
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
    /// Set only by the team start: false when the provider limits could not
    /// be read before starting, so the app says the start was unverified.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    limits_verified: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OnboardingError {
    pub(crate) code: &'static str,
    message: &'static str,
    retryable: bool,
    /// Unix seconds at which a provider limit frees again, only for
    /// `provider_limits_exhausted`.
    #[serde(skip_serializing_if = "Option::is_none")]
    resets_at: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InteractiveStart {
    session_id: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum InteractiveEvent {
    Output {
        text: String,
    },
    State {
        status: InteractiveStateStatus,
        action: InteractiveAction,
    },
    Exit {
        code: Option<i32>,
    },
    Failure {
        code: &'static str,
    },
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum InteractiveStateStatus {
    NeedsUserAction,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum InteractiveAction {
    Device {
        instruction: &'static str,
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "safeUrl")]
        safe_url: String,
        #[serde(rename = "userCode")]
        user_code: String,
    },
    Url {
        instruction: &'static str,
        #[serde(rename = "safeUrl")]
        safe_url: String,
    },
    Code {
        instruction: &'static str,
        #[serde(rename = "userCode")]
        user_code: String,
    },
    Input {
        instruction: &'static str,
        #[serde(rename = "inputRequest")]
        input_request: InteractiveInputRequest,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InteractiveInputRequest {
    id: String,
    label: &'static str,
    description: &'static str,
    submit_label: &'static str,
    secret: bool,
    input_mode: InteractiveInputMode,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum InteractiveInputMode {
    Text,
}

fn failure(code: &'static str) -> OnboardingError {
    let (message, retryable) = match code {
        "podman_missing" => (
            "Podman non è stato installato. Verifica Homebrew e riprova.",
            true,
        ),
        "podman_start_failed" => (
            "La macchina Podman di JHT non si è avviata. Avviala e riprova.",
            true,
        ),
        "podman_not_ready" => (
            "Podman è installato ma non risponde. Verifica la macchina JHT e riprova.",
            true,
        ),
        // Retrying cannot help: the machine has to be recreated, and only after
        // the person confirms it (onboarding_podman_machine_recreate).
        PODMAN_MACHINE_MOUNTS_HOME => (
            "La macchina Podman di JHT vede più cartelle del Mac di quelle che servono. Ricreala per continuare.",
            false,
        ),
        "podman_machine_recreate_failed" => (
            "La macchina Podman di JHT non è stata ricreata. Riprova.",
            true,
        ),
        "runtime_download_failed" => (
            "Non riesco a scaricare il runtime verificato. Controlla la connessione e riprova.",
            true,
        ),
        "runtime_install_failed" => (
            "Il runtime locale non è stato installato correttamente. Riprova.",
            true,
        ),
        "runtime_missing" => (
            "Il runtime locale verificato non è disponibile. Configuralo di nuovo.",
            true,
        ),
        "runtime_wrapper_install_failed" => (
            "Il comando locale verificato non è stato aggiornato. Premi Riprova per completare la preparazione.",
            true,
        ),
        "runtime_wrapper_publish_failed" => (
            "Il comando locale verificato non è stato pubblicato correttamente. Premi Riprova.",
            true,
        ),
        "runtime_wrapper_probe_failed" => (
            "Il comando locale installato non supera la verifica di sola lettura. Premi Riprova.",
            true,
        ),
        "runtime_install_unsupported" => (
            "Il runtime locale non è supportato su questo sistema.",
            false,
        ),
        "local_account_owner_missing" => (
            "La cartella runtime locale contiene dati che non risultano creati da Job Hunter Team. Seleziona il profilo locale originale e riprova.",
            false,
        ),
        "local_account_owner_mismatch" => (
            "Il runtime locale appartiene a un altro profilo. Torna al profilo che lo ha configurato.",
            false,
        ),
        "local_account_owner_invalid" => (
            "La verifica del proprietario del runtime locale è danneggiata. Non è stato usato alcun dato locale.",
            false,
        ),
        "local_account_owner_unavailable" => (
            "Non riesco a verificare o registrare il proprietario del runtime locale. Controlla i permessi e riprova.",
            true,
        ),
        "installer_digest_missing"
        | "installer_digest_invalid"
        | "installer_digest_mismatch"
        | "installer_payload_invalid" => (
            "Il pacchetto runtime non supera la verifica di integrità.",
            false,
        ),
        "container_start_failed" => (
            "Il container JHT non si è avviato. Controlla il runtime e riprova.",
            true,
        ),
        "container_not_ready" => (
            "Il container JHT è stato avviato ma non risponde ancora. Riprova.",
            true,
        ),
        "timeout" | "command_timeout" => (
            "L’operazione ha superato il tempo massimo. Controlla il runtime e riprova.",
            true,
        ),
        "container_timeout" => (
            "La verifica del container ha superato il tempo massimo. Riprova.",
            true,
        ),
        "resume_runtime_not_ready" => (
            "Il runtime salvato non risulta più disponibile. Riparti dal primo passaggio.",
            false,
        ),
        "resume_container_not_ready" => (
            "Il container salvato non risulta più attivo. Riparti dal passaggio container.",
            false,
        ),
        "resume_provider_not_configured" => (
            "Il provider salvato non risulta più configurato. Riparti dal passaggio provider.",
            false,
        ),
        "resume_provider_not_authenticated" => (
            "L’accesso al provider non risulta più disponibile. Accedi di nuovo al provider.",
            false,
        ),
        "host_not_configured" | "host_config_invalid" => (
            "La destinazione salvata non è più disponibile. Seleziona di nuovo l’ambiente.",
            false,
        ),
        "team_start_failed" => (
            "La sequenza di avvio della squadra non è riuscita. Riprova.",
            true,
        ),
        "team_verify_failed" => (
            "Assistente e Capitano non risultano entrambi attivi. Riprova.",
            true,
        ),
        "provider_timeout" => (
            "La configurazione del provider ha superato il tempo massimo. Riprova.",
            true,
        ),
        "provider_config_failed" | "provider_install_failed" => (
            "La configurazione del provider non è riuscita. Riprova.",
            true,
        ),
        "provider_login_start_failed" | "provider_login_pipe_failed" => (
            "Non riesco ad avviare l’accesso al provider. Riprova.",
            true,
        ),
        "provider_login_failed" => (
            "L’accesso al provider non è stato completato. Riprova.",
            true,
        ),
        "provider_input_not_requested" => (
            "Il provider non sta attendendo questa risposta.",
            false,
        ),
        "assistant_start_failed" => ("L’assistente non si è avviato. Riprova.", true),
        "assistant_verify_timeout" => (
            "L’assistente è stato avviato ma non risulta ancora pronto. Riprova.",
            true,
        ),
        "existing_team_vps_required" => (
            "Seleziona una configurazione VPS valida per collegare il team esistente.",
            false,
        ),
        "existing_team_identity_mismatch" => {
            ("La VPS appartiene a un altro team o account.", false)
        }
        "existing_team_not_active" => (
            "Il team sulla VPS non risulta attivo. Verificalo e riprova.",
            true,
        ),
        "existing_team_unavailable" => (
            "La VPS o il runtime JHT non sono raggiungibili. Verifica la connessione e riprova.",
            true,
        ),
        "operation_in_progress" => ("Un’altra operazione è già in corso.", true),
        "provider_limits_exhausted" => (
            "I limiti del provider sono esauriti: la squadra partirà quando si liberano.",
            true,
        ),
        code if code.starts_with("invalid_") => ("I dati ricevuti non sono validi.", false),
        _ => ("L’operazione non è riuscita. Riprova.", true),
    };
    OnboardingError {
        code,
        message,
        retryable,
        resets_at: None,
    }
}

#[cfg(debug_assertions)]
fn trace_local_runtime(stage: &'static str, event: &'static str) {
    eprintln!("[onboarding-runtime] stage={stage} event={event}");
}

#[cfg(not(debug_assertions))]
fn trace_local_runtime(_stage: &'static str, _event: &'static str) {}
#[derive(Clone)]
struct ProgressReporter {
    emit: Arc<dyn Fn(OnboardingProgress) + Send + Sync>,
    sequence: Arc<AtomicU64>,
}

impl ProgressReporter {
    fn new(channel: Channel<OnboardingProgress>) -> Self {
        Self::with_emitter(move |event| {
            let _ = channel.send(event);
        })
    }

    fn with_emitter(emit: impl Fn(OnboardingProgress) + Send + Sync + 'static) -> Self {
        Self {
            emit: Arc::new(emit),
            sequence: Arc::new(AtomicU64::new(1)),
        }
    }

    fn send(
        &self,
        stage: OnboardingProgressStage,
        status: OnboardingProgressStatus,
        message: &'static str,
        started: Instant,
        error: Option<&OnboardingError>,
    ) {
        let elapsed_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        (self.emit)(OnboardingProgress {
            stage,
            status,
            message,
            sequence: self.sequence.fetch_add(1, Ordering::Relaxed),
            elapsed_ms,
            code: error.map(|value| value.code),
            retryable: error.map(|value| value.retryable),
        });
    }

    fn run<T>(
        &self,
        stage: OnboardingProgressStage,
        start_message: &'static str,
        heartbeat_message: &'static str,
        done_message: &'static str,
        operation: impl FnOnce() -> Result<T, OnboardingError>,
    ) -> Result<T, OnboardingError> {
        self.run_with_interval(
            stage,
            start_message,
            heartbeat_message,
            done_message,
            PROGRESS_HEARTBEAT_INTERVAL,
            operation,
        )
    }

    fn run_with_interval<T>(
        &self,
        stage: OnboardingProgressStage,
        start_message: &'static str,
        heartbeat_message: &'static str,
        done_message: &'static str,
        interval: Duration,
        operation: impl FnOnce() -> Result<T, OnboardingError>,
    ) -> Result<T, OnboardingError> {
        let started = Instant::now();
        self.send(
            stage,
            OnboardingProgressStatus::Start,
            start_message,
            started,
            None,
        );
        let stopped = Arc::new(AtomicBool::new(false));
        let heartbeat_stopped = Arc::clone(&stopped);
        let heartbeat_reporter = self.clone();
        let heartbeat = thread::spawn(move || loop {
            thread::park_timeout(interval);
            if heartbeat_stopped.load(Ordering::Acquire) {
                break;
            }
            heartbeat_reporter.send(
                stage,
                OnboardingProgressStatus::Progress,
                heartbeat_message,
                started,
                None,
            );
        });

        let result = operation();
        stopped.store(true, Ordering::Release);
        heartbeat.thread().unpark();
        let _ = heartbeat.join();
        match &result {
            Ok(_) => self.send(
                stage,
                OnboardingProgressStatus::Done,
                done_message,
                started,
                None,
            ),
            Err(error) => self.send(
                stage,
                OnboardingProgressStatus::Error,
                error.message,
                started,
                Some(error),
            ),
        }
        result
    }
}

fn valid_pairing_token(token: &str) -> bool {
    (16..=8192).contains(&token.len())
        && token.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'=' | b'-' | b'_')
        })
}

fn valid_team_id(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}
fn wrapper_candidates(home: &Path) -> [PathBuf; 3] {
    [
        home.join(".local/bin/jht"),
        PathBuf::from("/usr/local/bin/jht"),
        PathBuf::from("/opt/homebrew/bin/jht"),
    ]
}

fn wrapper_path_from_home(home: &Path) -> Option<PathBuf> {
    wrapper_candidates(home)
        .into_iter()
        .find(|path| valid_wrapper_file(path))
}

fn wrapper_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    wrapper_path_from_home(&app.path().home_dir().ok()?)
}

pub(crate) fn verified_local_wrapper_path(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    wrapper_path(app).ok_or("runtime_missing")
}

fn wrapper_source(path: &Path) -> Option<String> {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return None;
    };
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > MAX_WRAPPER_BYTES
    {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return None;
        }
    }
    fs::read_to_string(path).ok()
}

fn wrapper_has_protocol(source: &str, protocol: &str) -> bool {
    source
        .lines()
        .map(|line| line.trim_end_matches('\r'))
        .any(|line| line == protocol)
}

fn valid_host_wrapper_file(path: &Path) -> bool {
    wrapper_source(path)
        .is_some_and(|source| wrapper_has_protocol(&source, "JHT_HOST_RUNTIME_PROTOCOL=1"))
}

fn valid_wrapper_file(path: &Path) -> bool {
    wrapper_source(path).is_some_and(|source| {
        wrapper_has_protocol(&source, "JHT_HOST_RUNTIME_PROTOCOL=1")
            && wrapper_has_protocol(&source, "JHT_DESKTOP_CHAT_PROTOCOL=1")
            && wrapper_has_protocol(&source, "JHT_ONBOARDING_SNAPSHOT_PROTOCOL=1")
    })
}

#[cfg(target_os = "macos")]
fn host_wrapper_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let home = app.path().home_dir().ok()?;
    wrapper_candidates(&home)
        .into_iter()
        .find(|path| valid_host_wrapper_file(path))
}

#[cfg(target_os = "macos")]
struct RuntimePublishLock {
    path: PathBuf,
}

#[cfg(target_os = "macos")]
impl RuntimePublishLock {
    fn acquire(runtime_dir: &Path) -> Result<Self, OnboardingError> {
        use std::os::unix::{fs::OpenOptionsExt, fs::PermissionsExt};

        let path = runtime_dir.join(".upgrade.lock");
        fs::create_dir(&path).map_err(|_| failure("runtime_wrapper_publish_failed"))?;
        let result = (|| {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
                .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
            let mut pid = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(path.join("pid"))
                .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
            writeln!(pid, "{}", std::process::id())
                .and_then(|_| pid.sync_all())
                .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
            Ok(Self { path: path.clone() })
        })();
        if result.is_err() {
            let _ = fs::remove_file(path.join("pid"));
            let _ = fs::remove_dir(&path);
        }
        result
    }
}

#[cfg(target_os = "macos")]
impl Drop for RuntimePublishLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(self.path.join("pid"));
        let _ = fs::remove_dir(&self.path);
    }
}

#[cfg(target_os = "macos")]
fn publish_bundled_wrapper(home: &Path, runtime_dir: &Path) -> Result<PathBuf, OnboardingError> {
    publish_bundled_wrapper_with_failpoint(home, runtime_dir, |_| false)
}

#[cfg(target_os = "macos")]
fn publish_bundled_wrapper_with_failpoint(
    home: &Path,
    runtime_dir: &Path,
    failpoint: impl Fn(&str) -> bool,
) -> Result<PathBuf, OnboardingError> {
    use std::os::unix::{fs::OpenOptionsExt, fs::PermissionsExt};

    let source = std::str::from_utf8(BUNDLED_LOCAL_WRAPPER)
        .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
    if !wrapper_has_protocol(source, "JHT_HOST_RUNTIME_PROTOCOL=1")
        || !wrapper_has_protocol(source, "JHT_DESKTOP_CHAT_PROTOCOL=1")
        || !wrapper_has_protocol(source, "JHT_ONBOARDING_SNAPSHOT_PROTOCOL=1")
    {
        return Err(failure("runtime_wrapper_publish_failed"));
    }

    let local_dir = home.join(".local");
    let bin_dir = local_dir.join("bin");
    for directory in [&local_dir, &bin_dir] {
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.file_type().is_dir() => {}
            Ok(_) => return Err(failure("runtime_wrapper_publish_failed")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(directory).map_err(|_| failure("runtime_wrapper_publish_failed"))?;
            }
            Err(_) => return Err(failure("runtime_wrapper_publish_failed")),
        }
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
    }

    let target = bin_dir.join("jht");
    if fs::symlink_metadata(&target).is_ok_and(|metadata| !metadata.file_type().is_file()) {
        return Err(failure("runtime_wrapper_publish_failed"));
    }
    if !fs::symlink_metadata(runtime_dir).is_ok_and(|metadata| metadata.file_type().is_dir()) {
        return Err(failure("runtime_wrapper_publish_failed"));
    }
    let _lock = RuntimePublishLock::acquire(runtime_dir)?;
    let manifest = runtime_dir.join(".runtime-integrity");
    let manifest_metadata =
        fs::symlink_metadata(&manifest).map_err(|_| failure("runtime_wrapper_publish_failed"))?;
    if !manifest_metadata.file_type().is_file() || manifest_metadata.len() > 64 * 1024 {
        return Err(failure("runtime_wrapper_publish_failed"));
    }
    if !runtime_bundle_manifest_valid(runtime_dir, &target) {
        return Err(failure("runtime_wrapper_publish_failed"));
    }
    let current_manifest =
        fs::read_to_string(&manifest).map_err(|_| failure("runtime_wrapper_publish_failed"))?;
    let wrapper_digest = format!("{:x}", Sha256::digest(BUNDLED_LOCAL_WRAPPER));
    let mut wrapper_entry_count = 0;
    let updated_manifest = current_manifest
        .lines()
        .map(|line| {
            if line.starts_with("jht-wrapper.sh=") {
                wrapper_entry_count += 1;
                format!("jht-wrapper.sh={wrapper_digest}")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    if wrapper_entry_count != 1 {
        return Err(failure("runtime_wrapper_publish_failed"));
    }

    let nonce = SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = bin_dir.join(format!(".jht-desktop-{}-{}", std::process::id(), nonce));
    let manifest_temporary = runtime_dir.join(format!(
        ".integrity-desktop-{}-{}",
        std::process::id(),
        nonce
    ));
    let wrapper_backup = bin_dir.join(format!(".jht-desktop-backup-{nonce}"));
    let manifest_backup = runtime_dir.join(format!(".integrity-desktop-backup-{nonce}"));
    let mut wrapper_backed_up = false;
    let mut manifest_backed_up = false;
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o700)
            .open(&temporary)
            .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
        file.write_all(BUNDLED_LOCAL_WRAPPER)
            .and_then(|_| file.sync_all())
            .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o700))
            .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
        let mut manifest_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&manifest_temporary)
            .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
        manifest_file
            .write_all(updated_manifest.as_bytes())
            .and_then(|_| manifest_file.sync_all())
            .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
        fs::set_permissions(&manifest_temporary, fs::Permissions::from_mode(0o600))
            .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
        fs::rename(&manifest, &manifest_backup)
            .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
        manifest_backed_up = true;
        fs::rename(&target, &wrapper_backup)
            .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
        wrapper_backed_up = true;
        fs::rename(&manifest_temporary, &manifest)
            .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
        if failpoint("after-manifest") {
            return Err(failure("runtime_wrapper_publish_failed"));
        }
        fs::rename(&temporary, &target).map_err(|_| failure("runtime_wrapper_publish_failed"))?;
        if !bundled_wrapper_published(runtime_dir, &target) {
            return Err(failure("runtime_wrapper_publish_failed"));
        }
        Ok(target.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
        let _ = fs::remove_file(&manifest_temporary);
        if manifest_backed_up {
            let _ = fs::remove_file(&manifest);
            let _ = fs::rename(&manifest_backup, &manifest);
        }
        if wrapper_backed_up {
            let _ = fs::remove_file(&target);
            let _ = fs::rename(&wrapper_backup, &target);
        }
    } else {
        let _ = fs::remove_file(&manifest_backup);
        let _ = fs::remove_file(&wrapper_backup);
    }
    result
}

#[cfg(target_os = "macos")]
fn file_digest(path: &Path) -> Option<String> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() == 0 {
        return None;
    }
    Some(format!("{:x}", Sha256::digest(fs::read(path).ok()?)))
}

#[cfg(target_os = "macos")]
fn runtime_bundle_manifest_valid(runtime_dir: &Path, wrapper: &Path) -> bool {
    use std::collections::BTreeMap;

    let manifest = runtime_dir.join(".runtime-integrity");
    let Ok(source) = fs::read_to_string(manifest) else {
        return false;
    };
    let mut entries = BTreeMap::new();
    for line in source.lines() {
        let Some((key, value)) = line.split_once('=') else {
            return false;
        };
        if value.is_empty() || entries.insert(key, value).is_some() {
            return false;
        }
    }
    let expected_keys = [
        "container-runtime",
        "docker-compose.yml",
        "docker-shim",
        "host-setup.sh",
        "jht-wrapper.sh",
        "podman-machine",
        "version",
    ];
    if entries.keys().copied().collect::<Vec<_>>() != expected_keys || entries["version"] != "1" {
        return false;
    }
    let artifacts = [
        ("docker-compose.yml", runtime_dir.join("docker-compose.yml")),
        ("host-setup.sh", runtime_dir.join("host-setup.sh")),
        ("jht-wrapper.sh", wrapper.to_path_buf()),
        ("container-runtime", runtime_dir.join("container-runtime")),
        ("podman-machine", runtime_dir.join("podman-machine")),
        ("docker-shim", runtime_dir.join("bin/docker")),
    ];
    if fs::read_to_string(runtime_dir.join("container-runtime"))
        .ok()
        .is_none_or(|value| value.trim() != "podman")
    {
        return false;
    }
    artifacts
        .into_iter()
        .all(|(key, path)| file_digest(&path).is_some_and(|digest| digest == entries[key]))
}

#[cfg(target_os = "macos")]
fn bundled_wrapper_published(runtime_dir: &Path, wrapper: &Path) -> bool {
    valid_wrapper_file(wrapper)
        && fs::read(wrapper).is_ok_and(|bytes| bytes == BUNDLED_LOCAL_WRAPPER)
        && runtime_bundle_manifest_valid(runtime_dir, wrapper)
}

#[cfg(target_os = "macos")]
fn local_runtime_dir(app: &tauri::AppHandle) -> Result<PathBuf, OnboardingError> {
    app.path()
        .home_dir()
        .map(|home| {
            home.join("Library")
                .join("Application Support")
                .join("Job Hunter Team")
                .join("host-runtime")
        })
        .map_err(|_| failure("storage_failed"))
}

#[cfg(target_os = "macos")]
fn podman_runtime_selected(app: &tauri::AppHandle) -> bool {
    local_runtime_dir(app)
        .ok()
        .and_then(|dir| fs::read_to_string(dir.join("container-runtime")).ok())
        .is_some_and(|value| value.trim() == "podman")
}

#[cfg(target_os = "macos")]
fn local_podman_install_required(
    wrapper_present: bool,
    marker_selected: bool,
    podman_present: bool,
) -> bool {
    !(wrapper_present && marker_selected && podman_present)
}

#[cfg(target_os = "macos")]
fn podman_path() -> Option<PathBuf> {
    let from_path: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|value| {
            std::env::split_paths(&value)
                .map(|dir| dir.join("podman"))
                .collect()
        })
        .unwrap_or_default();
    from_path
        .into_iter()
        .chain([
            PathBuf::from("/opt/homebrew/bin/podman"),
            PathBuf::from("/usr/local/bin/podman"),
            PathBuf::from("/opt/podman/bin/podman"),
        ])
        .find(|path| path.is_file())
}

pub(crate) struct VerifiedInstaller {
    bytes: Vec<u8>,
    digest: String,
}

impl VerifiedInstaller {
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }
}

fn expected_installer_digest(value: &str) -> Result<&str, OnboardingError> {
    let digest = value.trim();
    if digest.is_empty() {
        return Err(failure("installer_digest_missing"));
    }
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(failure("installer_digest_invalid"));
    }
    Ok(digest)
}

pub(crate) fn attest_then<T>(
    bytes: Vec<u8>,
    expected_digest: &str,
    execute: impl FnOnce(&VerifiedInstaller) -> Result<T, OnboardingError>,
) -> Result<T, OnboardingError> {
    let expected = expected_installer_digest(expected_digest)?;
    if bytes.is_empty() || bytes.len() > MAX_INSTALLER_BYTES {
        return Err(failure("installer_payload_invalid"));
    }
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != expected {
        return Err(failure("installer_digest_mismatch"));
    }
    execute(&VerifiedInstaller {
        bytes,
        digest: actual,
    })
}

fn download_installer_bytes(expected_digest: &str) -> Result<Vec<u8>, OnboardingError> {
    // Refuse a release without a compiled-in digest before touching the network.
    expected_installer_digest(expected_digest)?;
    let target = std::env::temp_dir().join(format!(
        "jht-download-{}-{}.sh",
        std::process::id(),
        SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let curl_args = [
            "-fsSL",
            INSTALL_URL,
            "-o",
            target.to_str().ok_or_else(|| failure("storage_failed"))?,
        ];
        let downloaded =
            run_program("curl", curl_args, None, Duration::from_secs(90)).map_err(failure)?;
        if !downloaded.success() {
            return Err(failure("runtime_download_failed"));
        }
        set_private_permissions(&target).map_err(failure)?;
        let metadata = fs::metadata(&target).map_err(|_| failure("runtime_download_failed"))?;
        if metadata.len() == 0 || metadata.len() > MAX_INSTALLER_BYTES as u64 {
            return Err(failure("installer_payload_invalid"));
        }
        fs::read(&target).map_err(|_| failure("runtime_download_failed"))
    })();
    let _ = fs::remove_file(&target);
    result
}

fn with_downloaded_installer<T>(
    execute: impl FnOnce(&VerifiedInstaller) -> Result<T, OnboardingError>,
) -> Result<T, OnboardingError> {
    let expected = expected_installer_digest(INSTALL_SHA256)?;
    let bytes = download_installer_bytes(expected)?;
    attest_then(bytes, expected, execute)
}

fn install_local(
    app: &tauri::AppHandle,
    diagnostics: Option<&OnboardingDiagnosticSink>,
) -> Result<PathBuf, OnboardingError> {
    #[cfg(not(unix))]
    return Err(failure("runtime_install_unsupported"));
    #[cfg(unix)]
    {
        #[cfg(target_os = "macos")]
        {
            let install_required = local_podman_install_required(
                host_wrapper_path(app).is_some(),
                podman_runtime_selected(app),
                podman_path().is_some(),
            );
            if install_required {
                trace_local_runtime("runtime", "install_required");
                let installed = with_downloaded_installer(|installer| {
                    ensure_success(
                        run_program(
                            "/usr/bin/env",
                            LOCAL_PODMAN_INSTALL_ARGS,
                            Some(installer.bytes()),
                            PREPARE_TIMEOUT,
                        ),
                        "runtime_install_failed",
                    )
                });
                if let Err(error) = installed {
                    trace_local_runtime("runtime", "install_failed");
                    return Err(error);
                }
            } else {
                trace_local_runtime("runtime", "install_reused");
            }
            if podman_path().is_none() {
                return Err(failure("podman_missing"));
            }
            if !podman_runtime_selected(app) {
                return Err(failure("podman_not_ready"));
            }
            let home = app
                .path()
                .home_dir()
                .map_err(|_| failure("runtime_wrapper_publish_failed"))?;
            let runtime_dir = local_runtime_dir(app)?;
            let installed_wrapper = home.join(".local/bin/jht");
            if !bundled_wrapper_published(&runtime_dir, &installed_wrapper) {
                let started = Instant::now();
                let published = publish_bundled_wrapper(&home, &runtime_dir).map(|_| ());
                if let Some(diagnostics) = diagnostics {
                    diagnostics.record_boundary(
                        "wrapper-publish",
                        OnboardingProgressStage::Runtime,
                        started,
                        &published,
                    );
                }
                published?;
            }
            if !bundled_wrapper_published(&runtime_dir, &installed_wrapper) {
                return Err(failure("runtime_wrapper_publish_failed"));
            }
            let mut probe_sequence = 0u8;
            let snapshot = probe_installed_wrapper_with(|operation, timeout| {
                probe_sequence = probe_sequence.saturating_add(1);
                let started = Instant::now();
                let result = run_local(&installed_wrapper, &operation.argv(), timeout);
                if let Some(diagnostics) = diagnostics {
                    diagnostics.record_process(
                        format!("wrapper-{}-{probe_sequence}", operation.diagnostic_id()),
                        OnboardingProgressStage::Runtime,
                        started,
                        &result,
                        "runtime_wrapper_probe_failed",
                        operation == LocalCliOperation::Status,
                    );
                }
                result
            })?;
            if !snapshot.runtime_installed {
                return Err(failure("runtime_wrapper_probe_failed"));
            }
            return Ok(installed_wrapper);
        }
        #[cfg(not(target_os = "macos"))]
        {
            if wrapper_path(app).is_none() {
                with_downloaded_installer(|installer| {
                    let args = ["JHT_SKIP_ONBOARD=1", "/bin/bash", "-s"];
                    ensure_success(
                        run_program(
                            "/usr/bin/env",
                            args,
                            Some(installer.bytes()),
                            PREPARE_TIMEOUT,
                        ),
                        "runtime_install_failed",
                    )
                })?;
            }
            wrapper_path(app).ok_or_else(|| failure("runtime_missing"))
        }
    }
}

const REMOTE_INSTALL: &str = r#"set -eu
umask 077
IFS= read -r JHT_INSTALL_SHA256
IFS= read -r JHT_PAIRING_TOKEN
export JHT_SKIP_ONBOARD=1
jht_installer="$(mktemp)"
trap 'rm -f "$jht_installer"' EXIT HUP INT TERM
cat > "$jht_installer"
if command -v sha256sum >/dev/null 2>&1; then
  jht_actual_sha256="$(sha256sum "$jht_installer" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  jht_actual_sha256="$(shasum -a 256 "$jht_installer" | awk '{print $1}')"
else
  exit 86
fi
[ "$jht_actual_sha256" = "$JHT_INSTALL_SHA256" ] || exit 87
/bin/bash "$jht_installer" --pairing-token "$JHT_PAIRING_TOKEN""#;

pub(crate) fn remote_install_input(
    installer: &VerifiedInstaller,
    pairing_token: &str,
) -> Result<Zeroizing<Vec<u8>>, OnboardingError> {
    if !valid_pairing_token(pairing_token) {
        return Err(failure("pairing_token_invalid"));
    }
    let mut input = Zeroizing::new(Vec::with_capacity(
        installer.digest().len() + pairing_token.len() + installer.bytes().len() + 2,
    ));
    input.extend_from_slice(installer.digest().as_bytes());
    input.push(b'\n');
    input.extend_from_slice(pairing_token.as_bytes());
    input.push(b'\n');
    input.extend_from_slice(installer.bytes());
    Ok(input)
}
const REMOTE_JHT_UP: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" up"#;
const REMOTE_EXISTING_TEAM_PROBE: &str = r#"set -eu
IFS= read -r JHT_EXPECTED_TEAM
[ "${#JHT_EXPECTED_TEAM}" -ge 16 ] && [ "${#JHT_EXPECTED_TEAM}" -le 128 ] || exit 64
case "$JHT_EXPECTED_TEAM" in *[!A-Za-z0-9_-]*) exit 64 ;; esac
JHT_BIN="$(command -v jht 2>/dev/null || true)"
[ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"
[ -f "$JHT_BIN" ] && [ -x "$JHT_BIN" ] && [ ! -L "$JHT_BIN" ] || exit 70
grep -Fqx 'JHT_HOST_RUNTIME_PROTOCOL=1' "$JHT_BIN" || exit 70
"$JHT_BIN" status >/dev/null 2>&1 || exit 71
docker exec jht node -e '
const fs=require("fs"); const path="/jht_home/cloud.json"; const expected=process.argv[1];
let cloud; try { cloud=JSON.parse(fs.readFileSync(path,"utf8")); } catch { process.exit(72); }
if (typeof cloud.user_id!=="string" || cloud.user_id!==expected) process.exit(72);
let cfg={}; try { cfg=JSON.parse(fs.readFileSync("/jht_home/jht.config.json","utf8")); } catch {}
const provider=String(cfg.active_provider||"").toLowerCase();
const configured=["claude","anthropic","codex","openai","kimi","moonshot"].includes(provider);
const marker={claude:"/jht_home/.claude/.credentials.json",anthropic:"/jht_home/.claude/.credentials.json",codex:"/jht_home/.codex/auth.json",openai:"/jht_home/.codex/auth.json",kimi:"/jht_home/.kimi/credentials/kimi-code.json",moonshot:"/jht_home/.kimi/credentials/kimi-code.json"}[provider];
console.log("runtimeInstalled=1"); console.log("containerRunning=1");
console.log("providerConfigured="+(configured?"1":"0"));
console.log("providerAuthenticated="+(marker&&fs.existsSync(marker)?"1":"0"));
console.log("profileReady="+(fs.existsSync("/jht_home/profile/ready.flag")?"1":"0"));
console.log("assistantWelcomed="+(fs.existsSync("/jht_home/profile/welcomed.flag")?"1":"0"));
' "$JHT_EXPECTED_TEAM" || exit $?
docker exec jht tmux has-session -t CAPITANO 2>/dev/null || exit 73
docker exec jht tmux has-session -t ASSISTENTE 2>/dev/null || exit 73
printf 'captainRunning=1\nassistantRunning=1\n'"#;
const REMOTE_USE_CLAUDE: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers use claude"#;
const REMOTE_USE_CODEX: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers use codex"#;
const REMOTE_USE_KIMI: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers use kimi"#;
const REMOTE_UPDATE_CLAUDE: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers update claude"#;
const REMOTE_UPDATE_CODEX: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers update codex"#;
const REMOTE_UPDATE_KIMI: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers update kimi"#;
const REMOTE_PROVIDER_CURRENT: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers current"#;
const REMOTE_PROVIDER_LIMITS: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" providers limits --json"#;
const REMOTE_TEAM_START: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" team start"#;
const REMOTE_ASSISTANT_START: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" team start assistente"#;
pub(crate) const REMOTE_LINKEDIN_LOGIN: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" linkedin login"#;
pub(crate) const REMOTE_LINKEDIN_LOGIN_STOP: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" linkedin login --stop"#;
pub(crate) const REMOTE_LINKEDIN_STATUS: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" linkedin status --json"#;
const REMOTE_OAUTH_LOGIN: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" oauth-login"#;

fn ensure_success(
    result: Result<ProcessResult, &'static str>,
    code: &'static str,
) -> Result<(), OnboardingError> {
    match result {
        Ok(value) if value.success() => Ok(()),
        Err("process_timeout") => Err(failure("timeout")),
        Err(PODMAN_MACHINE_MOUNTS_HOME) => Err(failure(PODMAN_MACHINE_MOUNTS_HOME)),
        _ => Err(failure(code)),
    }
}

fn ensure_success_with_timeout(
    result: Result<ProcessResult, &'static str>,
    code: &'static str,
    timeout_code: &'static str,
) -> Result<(), OnboardingError> {
    match result {
        Ok(value) if value.success() => Ok(()),
        Err("process_timeout") => Err(failure(timeout_code)),
        Err(PODMAN_MACHINE_MOUNTS_HOME) => Err(failure(PODMAN_MACHINE_MOUNTS_HOME)),
        _ => Err(failure(code)),
    }
}

#[cfg(target_os = "macos")]
fn local_wrapper_command(
    wrapper: &Path,
    args: &[&str],
    inherited_path: Option<OsString>,
) -> Result<(PathBuf, Vec<OsString>), &'static str> {
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/podman/bin"),
    ];
    if let Some(value) = inherited_path {
        for path in std::env::split_paths(&value) {
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    let path = std::env::join_paths(paths).map_err(|_| "runtime_missing")?;
    let mut invocation = Vec::with_capacity(args.len() + 2);
    let mut path_assignment = OsString::from("PATH=");
    path_assignment.push(path);
    invocation.push(path_assignment);
    invocation.push(wrapper.as_os_str().to_owned());
    invocation.extend(args.iter().map(OsString::from));
    Ok((PathBuf::from("/usr/bin/env"), invocation))
}

fn run_local(
    wrapper: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<ProcessResult, &'static str> {
    refuse_broad_podman_machine(run_verified_local_wrapper(wrapper, args, None, timeout))
}

/// The broker's LinkedIn login view commands (`jht linkedin ...`), on this
/// computer through the attested wrapper, on a VPS through SSH. Used by
/// broker_view.rs; the answer is the command's own JSON line.
pub(crate) fn run_linkedin_command(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ValidatedHost,
    operation: LocalCliOperation,
    timeout: Duration,
) -> Result<ProcessResult, &'static str> {
    let remote = match operation {
        LocalCliOperation::LinkedinLogin => REMOTE_LINKEDIN_LOGIN,
        LocalCliOperation::LinkedinLoginStop => REMOTE_LINKEDIN_LOGIN_STOP,
        LocalCliOperation::LinkedinStatus => REMOTE_LINKEDIN_STATUS,
        _ => return Err("invalid_request"),
    };
    match host {
        ValidatedHost::Local => {
            let wrapper = wrapper_path(app).ok_or("runtime_missing")?;
            run_scoped_local(app, scope, &wrapper, operation, timeout)
        }
        ValidatedHost::Vps { .. } => run_ssh(host, remote, None, timeout, None),
    }
}

/// A wrapper that refused a Podman machine mounting more of the Mac answers
/// with its own error, never with the failure of the step that ran it.
fn refuse_broad_podman_machine(
    result: Result<ProcessResult, &'static str>,
) -> Result<ProcessResult, &'static str> {
    match result {
        Ok(value) if value.code == PODMAN_MACHINE_MOUNTS_EXIT => Err(PODMAN_MACHINE_MOUNTS_HOME),
        other => other,
    }
}

/// The error for a failed local step: the broad Podman machine keeps its own.
fn local_failure(error: &'static str, code: &'static str) -> OnboardingError {
    failure(if error == PODMAN_MACHINE_MOUNTS_HOME {
        PODMAN_MACHINE_MOUNTS_HOME
    } else {
        code
    })
}

fn run_scoped_local(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    wrapper: &Path,
    operation: LocalCliOperation,
    timeout: Duration,
) -> Result<ProcessResult, &'static str> {
    crate::account_scope::validate_local_runtime(app, scope)?;
    let args = operation.argv();
    run_local(wrapper, &args, timeout)
}

pub(crate) fn run_verified_local_wrapper(
    wrapper: &Path,
    args: &[&str],
    input: Option<&[u8]>,
    timeout: Duration,
) -> Result<ProcessResult, &'static str> {
    if !valid_wrapper_file(wrapper) {
        return Err("runtime_missing");
    }
    #[cfg(target_os = "macos")]
    {
        let (program, invocation) = local_wrapper_command(wrapper, args, std::env::var_os("PATH"))?;
        return run_program(
            program.to_str().ok_or("runtime_missing")?,
            invocation,
            input,
            timeout,
        );
    }
    #[cfg(not(target_os = "macos"))]
    run_program(
        wrapper.to_str().ok_or("runtime_missing")?,
        args,
        input,
        timeout,
    )
}

#[cfg(test)]
fn start_and_verify_local_container(wrapper: &Path) -> Result<(), OnboardingError> {
    start_and_verify_local_container_with(
        |operation, timeout| {
            let args = operation.argv();
            run_local(wrapper, &args, timeout)
        },
        thread::sleep,
        LOCAL_CONTAINER_VERIFY_ATTEMPTS,
    )
}

fn start_and_verify_local_container_with(
    mut run: impl FnMut(LocalCliOperation, Duration) -> Result<ProcessResult, &'static str>,
    mut pause: impl FnMut(Duration),
    attempts: usize,
) -> Result<(), OnboardingError> {
    let requested = match run(LocalCliOperation::Up, PREPARE_TIMEOUT) {
        Ok(result) if result.success() => Ok(()),
        Err("process_timeout") => Err("container_timeout"),
        Err(PODMAN_MACHINE_MOUNTS_HOME) => return Err(failure(PODMAN_MACHINE_MOUNTS_HOME)),
        _ => Err("container_start_failed"),
    };

    for attempt in 0..attempts.max(1) {
        match run(LocalCliOperation::Status, LOCAL_CONTAINER_VERIFY_TIMEOUT) {
            Ok(result) if result.success() => {
                trace_local_runtime("container", "ready");
                return Ok(());
            }
            Err("process_timeout") => return Err(failure("container_timeout")),
            Err(PODMAN_MACHINE_MOUNTS_HOME) => return Err(failure(PODMAN_MACHINE_MOUNTS_HOME)),
            _ => {}
        }
        if attempt + 1 < attempts {
            pause(LOCAL_CONTAINER_VERIFY_INTERVAL);
        }
    }
    match requested {
        Err(code) => {
            trace_local_runtime("container", "start_failed");
            Err(failure(code))
        }
        Ok(()) => {
            trace_local_runtime("container", "not_ready");
            Err(failure("container_not_ready"))
        }
    }
}

fn prepare_impl(
    app: tauri::AppHandle,
    scope: AccountScope,
    submission: OnboardingSubmission,
    pairing_token: Option<String>,
    channel: Channel<OnboardingProgress>,
) -> Result<OnboardingSnapshot, OnboardingError> {
    let diagnostics = OnboardingDiagnosticSink::new(
        &app,
        &scope,
        OnboardingDiagnosticHostKind::from_host(&submission.host),
    );
    let progress_diagnostics = diagnostics.clone();
    let reporter = ProgressReporter::with_emitter(move |event| {
        let _ = channel.send(event.clone());
        if let Some(diagnostics) = progress_diagnostics.as_ref() {
            diagnostics.record_progress(&event);
        }
    });
    let mut pairing = pairing_token.map(Zeroizing::new);
    let (validated, wrapper) = reporter.run(
        OnboardingProgressStage::Engine,
        "Verifico il motore container",
        "Preparazione del motore container in corso",
        "Motore container verificato",
        || {
            let validated = validate_host(&app, &submission.host).map_err(failure)?;
            let wrapper = match &validated {
                ValidatedHost::Local => Some(install_local(&app, diagnostics.as_ref())?),
                ValidatedHost::Vps { .. } => {
                    let token = pairing
                        .as_ref()
                        .ok_or_else(|| failure("pairing_token_missing"))?;
                    if !valid_pairing_token(token) {
                        return Err(failure("pairing_token_invalid"));
                    }
                    with_downloaded_installer(|installer| {
                        let mut input = remote_install_input(installer, token)?;
                        let result = ensure_success(
                            run_ssh(
                                &validated,
                                REMOTE_INSTALL,
                                Some(&input),
                                PREPARE_TIMEOUT,
                                None,
                            ),
                            "runtime_install_failed",
                        );
                        input.zeroize();
                        result
                    })?;
                    None
                }
            };
            Ok((validated, wrapper))
        },
    )?;

    reporter.run(
        OnboardingProgressStage::Runtime,
        "Avvio il runtime Job Hunter Team",
        "Avvio del runtime in corso",
        "Runtime Job Hunter Team avviato",
        || match &validated {
            ValidatedHost::Local => {
                let wrapper = wrapper.as_ref().ok_or_else(|| failure("runtime_missing"))?;
                let mut request_sequence = 0u64;
                start_and_verify_local_container_with(
                    |operation, timeout| {
                        request_sequence = request_sequence.saturating_add(1);
                        let started = Instant::now();
                        let result = run_scoped_local(&app, &scope, wrapper, operation, timeout);
                        if let Some(diagnostics) = diagnostics.as_ref() {
                            diagnostics.record_process(
                                format!(
                                    "container-{}-{request_sequence}",
                                    operation.diagnostic_id()
                                ),
                                OnboardingProgressStage::Container,
                                started,
                                &result,
                                match operation {
                                    LocalCliOperation::Up => "container_start_failed",
                                    _ => "container_not_ready",
                                },
                                false,
                            );
                        }
                        result
                    },
                    thread::sleep,
                    LOCAL_CONTAINER_VERIFY_ATTEMPTS,
                )
            }
            ValidatedHost::Vps { .. } => ensure_success(
                run_ssh(&validated, REMOTE_JHT_UP, None, PREPARE_TIMEOUT, None),
                "container_start_failed",
            ),
        },
    )?;

    reporter.run(
        OnboardingProgressStage::Container,
        "Verifico il container Job Hunter Team",
        "Verifica del container in corso",
        "Container Job Hunter Team verificato",
        || {
            let started = Instant::now();
            let snapshot_result = snapshot_impl(&app, &scope, &validated);
            if let Some(diagnostics) = diagnostics.as_ref() {
                diagnostics.record_snapshot("container-snapshot", started, &snapshot_result);
            }
            let snapshot = snapshot_result?;
            if !snapshot.container_running {
                trace_local_runtime("container", "snapshot_not_ready");
                return Err(failure("container_not_ready"));
            }
            Ok(())
        },
    )?;

    let snapshot = reporter.run(
        OnboardingProgressStage::Provider,
        "Configuro il provider in abbonamento",
        "Configurazione del provider in corso",
        "Provider configurato",
        || {
            match &validated {
                ValidatedHost::Local => {
                    let wrapper = wrapper.as_ref().ok_or_else(|| failure("runtime_missing"))?;
                    ensure_success_with_timeout(
                        run_scoped_local(
                            &app,
                            &scope,
                            wrapper,
                            LocalCliOperation::ProviderUse(submission.provider),
                            COMMAND_TIMEOUT,
                        ),
                        "provider_config_failed",
                        "provider_timeout",
                    )?;
                    ensure_success_with_timeout(
                        run_scoped_local(
                            &app,
                            &scope,
                            wrapper,
                            LocalCliOperation::ProviderUpdate(submission.provider),
                            PREPARE_TIMEOUT,
                        ),
                        "provider_install_failed",
                        "provider_timeout",
                    )?;
                }
                ValidatedHost::Vps { .. } => {
                    let (use_command, update_command) = match submission.provider {
                        SubscriptionProvider::Claude => (REMOTE_USE_CLAUDE, REMOTE_UPDATE_CLAUDE),
                        SubscriptionProvider::Codex => (REMOTE_USE_CODEX, REMOTE_UPDATE_CODEX),
                        SubscriptionProvider::Kimi => (REMOTE_USE_KIMI, REMOTE_UPDATE_KIMI),
                    };
                    ensure_success_with_timeout(
                        run_ssh(&validated, use_command, None, COMMAND_TIMEOUT, None),
                        "provider_config_failed",
                        "provider_timeout",
                    )?;
                    ensure_success_with_timeout(
                        run_ssh(&validated, update_command, None, PREPARE_TIMEOUT, None),
                        "provider_install_failed",
                        "provider_timeout",
                    )?;
                }
            }
            let snapshot = snapshot_impl(&app, &scope, &validated)?;
            crate::direct_chat::persist_onboarding_host(&app, &scope, &submission.host)
                .map_err(failure)?;
            Ok(snapshot)
        },
    )?;

    if let Some(value) = pairing.as_mut() {
        value.zeroize();
    }
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn onboarding_prepare(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
    submission: OnboardingSubmission,
    pairing_token: Option<String>,
    on_progress: Channel<OnboardingProgress>,
) -> Result<OnboardingSnapshot, OnboardingError> {
    let expected = scopes.active().map_err(failure)?;
    if state
        .preparing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        prepare_impl(app, worker_expected, submission, pairing_token, on_progress)
    })
    .await
    .unwrap_or_else(|_| Err(failure("runtime_failed")));
    state.preparing.store(false, Ordering::Release);
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

const REMOTE_SNAPSHOT: &str = r#"set -u
JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"
if [ ! -x "$JHT_BIN" ] || ! grep -Fqx 'JHT_ONBOARDING_SNAPSHOT_PROTOCOL=1' "$JHT_BIN" 2>/dev/null; then
  printf '%s\n' runtimeInstalled=0 containerRunning=0 providerConfigured=0 providerAuthenticated=0 assistantWelcomed=0 assistantRunning=0 captainRunning=0 profileReady=0
  exit 0
fi
exec "$JHT_BIN" onboarding-snapshot"#;

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
        limits_verified: None,
    }
}

fn parse_verified_snapshot(text: &str) -> Option<OnboardingSnapshot> {
    let mut values = std::collections::BTreeMap::new();
    for line in text.lines() {
        let (key, value) = line.split_once('=')?;
        if !matches!(value, "0" | "1") || values.insert(key, value == "1").is_some() {
            return None;
        }
    }
    let expected = [
        "assistantRunning",
        "assistantWelcomed",
        "captainRunning",
        "containerRunning",
        "profileReady",
        "providerAuthenticated",
        "providerConfigured",
        "runtimeInstalled",
    ];
    if values.keys().copied().collect::<Vec<_>>() != expected {
        return None;
    }
    Some(OnboardingSnapshot {
        runtime_installed: values["runtimeInstalled"],
        container_running: values["containerRunning"],
        provider_configured: values["providerConfigured"],
        provider_authenticated: values["providerAuthenticated"],
        assistant_running: values["assistantRunning"],
        captain_running: values["captainRunning"],
        profile_ready: values["profileReady"],
        assistant_welcomed: values["assistantWelcomed"],
        direct_chat_ready: false,
        limits_verified: None,
    })
}

#[cfg(target_os = "macos")]
fn probe_installed_wrapper_with(
    mut run: impl FnMut(LocalCliOperation, Duration) -> Result<ProcessResult, &'static str>,
) -> Result<OnboardingSnapshot, OnboardingError> {
    let status = run(LocalCliOperation::Status, LOCAL_CONTAINER_VERIFY_TIMEOUT)
        .map_err(|error| local_failure(error, "runtime_wrapper_probe_failed"))?;
    if !matches!(status.code, 0 | 1) {
        return Err(failure("runtime_wrapper_probe_failed"));
    }
    let snapshot = run(LocalCliOperation::Snapshot, SNAPSHOT_TIMEOUT)
        .map_err(|_| failure("runtime_wrapper_probe_failed"))?;
    if !snapshot.success() {
        return Err(failure("runtime_wrapper_probe_failed"));
    }
    parse_verified_snapshot(&snapshot.stdout_text())
        .ok_or_else(|| failure("runtime_wrapper_probe_failed"))
}

fn snapshot_impl(
    app: &tauri::AppHandle,
    scope: &AccountScope,
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
            let result = run_scoped_local(
                app,
                scope,
                &wrapper,
                LocalCliOperation::Snapshot,
                SNAPSHOT_TIMEOUT,
            )
            .map_err(failure)?;
            if !result.success() {
                return Err(failure("snapshot_failed"));
            }
            Ok(parse_snapshot(&result.stdout_text()))
        }
    }
}

#[tauri::command]
pub(crate) async fn onboarding_snapshot(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    host: ExecutionHost,
) -> Result<OnboardingSnapshot, OnboardingError> {
    let expected = scopes.active().map_err(failure)?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        let validated = validate_host(&app, &host).map_err(failure)?;
        snapshot_impl(&app, &worker_expected, &validated)
    })
    .await
    .unwrap_or_else(|_| Err(failure("snapshot_failed")));
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

#[tauri::command]
pub(crate) async fn onboarding_resume_snapshot(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<OnboardingSnapshot, OnboardingError> {
    let expected = scopes.active().map_err(failure)?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        let host =
            crate::direct_chat::load_persisted_host(&app, &worker_expected).map_err(failure)?;
        let validated = validate_host(&app, &host).map_err(failure)?;
        snapshot_impl(&app, &worker_expected, &validated)
    })
    .await
    .unwrap_or_else(|_| Err(failure("snapshot_failed")));
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

fn existing_team_probe_with(
    team_id: &str,
    run: impl FnOnce(&[u8]) -> Result<ProcessResult, &'static str>,
) -> Result<OnboardingSnapshot, OnboardingError> {
    if !valid_team_id(team_id) {
        return Err(failure("invalid_team_id"));
    }
    let mut input = Zeroizing::new(Vec::with_capacity(team_id.len() + 1));
    input.extend_from_slice(team_id.as_bytes());
    input.push(b'\n');
    let result = run(&input).map_err(|_| failure("existing_team_unavailable"));
    input.zeroize();
    let result = result?;
    if !result.success() {
        return Err(failure(match result.code {
            64 => "invalid_team_id",
            72 => "existing_team_identity_mismatch",
            73 => "existing_team_not_active",
            _ => "existing_team_unavailable",
        }));
    }
    let snapshot = parse_snapshot(&result.stdout_text());
    if !snapshot.runtime_installed || !snapshot.container_running {
        return Err(failure("existing_team_unavailable"));
    }
    if !snapshot.captain_running || !snapshot.assistant_running {
        return Err(failure("existing_team_not_active"));
    }
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn onboarding_existing_team_connect(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
    request: ExistingTeamConnectRequest,
    on_progress: Channel<OnboardingProgress>,
) -> Result<OnboardingSnapshot, OnboardingError> {
    let expected = scopes.active().map_err(failure)?;
    if !matches!(&request.host, ExecutionHost::Vps { .. }) {
        return Err(failure("existing_team_vps_required"));
    }
    if !valid_team_id(&request.team_id) {
        return Err(failure("invalid_team_id"));
    }
    if state
        .preparing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        let reporter = ProgressReporter::new(on_progress);
        let validated = reporter.run(
            OnboardingProgressStage::Runtime,
            "Verifico il runtime già configurato",
            "Verifica del runtime in corso",
            "Runtime già configurato verificato",
            || validate_host(&app, &request.host).map_err(failure),
        )?;
        let snapshot = reporter.run(
            OnboardingProgressStage::Container,
            "Verifico il container esistente",
            "Verifica del container esistente in corso",
            "Container esistente verificato",
            || {
                existing_team_probe_with(&request.team_id, |input| {
                    run_ssh(
                        &validated,
                        REMOTE_EXISTING_TEAM_PROBE,
                        Some(input),
                        SNAPSHOT_TIMEOUT,
                        None,
                    )
                })
            },
        )?;
        reporter.run(
            OnboardingProgressStage::Team,
            "Confermo il team esistente",
            "Conferma del team esistente in corso",
            "Team esistente attivo e verificato",
            || {
                crate::direct_chat::persist_onboarding_host(&app, &worker_expected, &request.host)
                    .map_err(failure)?;
                Ok(snapshot)
            },
        )
    })
    .await
    .unwrap_or_else(|_| Err(failure("existing_team_unavailable")));
    state.preparing.store(false, Ordering::Release);
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

#[derive(Clone, Copy)]
enum SecretMarkerKind {
    Prefix,
    KeyValue,
}

const SECRET_MARKERS: [(&str, SecretMarkerKind); 11] = [
    ("jht_sync_", SecretMarkerKind::Prefix),
    ("sk-", SecretMarkerKind::Prefix),
    ("access_token", SecretMarkerKind::KeyValue),
    ("refresh_token", SecretMarkerKind::KeyValue),
    ("id_token", SecretMarkerKind::KeyValue),
    ("code_verifier", SecretMarkerKind::KeyValue),
    ("api_key", SecretMarkerKind::KeyValue),
    ("client_secret", SecretMarkerKind::KeyValue),
    ("password", SecretMarkerKind::KeyValue),
    ("session_token", SecretMarkerKind::KeyValue),
    ("bearer", SecretMarkerKind::KeyValue),
];

#[derive(Default)]
enum RedactionState {
    #[default]
    Scanning,
    AwaitingValue,
    Redacting,
}

#[derive(Clone, Copy, Default)]
enum TerminalSequenceState {
    #[default]
    Text,
    Escape,
    EscapeIntermediate,
    Csi,
    Osc,
    OscEscape,
    OpenBracket,
    OrphanCsi,
}

#[derive(Default)]
struct TerminalTextNormalizer {
    state: TerminalSequenceState,
    orphan: String,
}

impl TerminalTextNormalizer {
    fn push_ground(&mut self, character: char, output: &mut String) {
        match character {
            '\u{1b}' => self.state = TerminalSequenceState::Escape,
            '\u{009b}' => self.state = TerminalSequenceState::Csi,
            '\u{009d}' => self.state = TerminalSequenceState::Osc,
            '[' => {
                self.orphan.clear();
                self.orphan.push('[');
                self.state = TerminalSequenceState::OpenBracket;
            }
            '\n' | '\t' => output.push(character),
            value if value.is_control() => {}
            value => output.push(value),
        }
    }

    fn flush_orphan(&mut self, character: char, output: &mut String) {
        output.push_str(&std::mem::take(&mut self.orphan));
        self.state = TerminalSequenceState::Text;
        self.push_ground(character, output);
    }

    fn push(&mut self, text: &str) -> String {
        let mut output = String::with_capacity(text.len());
        for character in text.chars() {
            match self.state {
                TerminalSequenceState::Text => self.push_ground(character, &mut output),
                TerminalSequenceState::Escape => match character {
                    '[' => self.state = TerminalSequenceState::Csi,
                    ']' | 'P' | 'X' | '^' | '_' => self.state = TerminalSequenceState::Osc,
                    '\u{20}'..='\u{2f}' => self.state = TerminalSequenceState::EscapeIntermediate,
                    '\u{1b}' => {}
                    _ => self.state = TerminalSequenceState::Text,
                },
                TerminalSequenceState::EscapeIntermediate => match character {
                    '\u{30}'..='\u{7e}' => self.state = TerminalSequenceState::Text,
                    '\u{1b}' => self.state = TerminalSequenceState::Escape,
                    _ => {}
                },
                TerminalSequenceState::Csi => match character {
                    '\u{40}'..='\u{7e}' => self.state = TerminalSequenceState::Text,
                    '\u{1b}' => self.state = TerminalSequenceState::Escape,
                    _ => {}
                },
                TerminalSequenceState::Osc => match character {
                    '\u{7}' | '\u{009c}' => self.state = TerminalSequenceState::Text,
                    '\u{1b}' => self.state = TerminalSequenceState::OscEscape,
                    _ => {}
                },
                TerminalSequenceState::OscEscape => match character {
                    '\\' | '\u{009c}' => self.state = TerminalSequenceState::Text,
                    '\u{1b}' => {}
                    _ => self.state = TerminalSequenceState::Osc,
                },
                TerminalSequenceState::OpenBracket => {
                    if character.is_ascii_digit() || matches!(character, ';' | ':' | '?' | '>') {
                        self.orphan.push(character);
                        self.state = TerminalSequenceState::OrphanCsi;
                    } else if character == 'm' {
                        self.orphan.clear();
                        self.state = TerminalSequenceState::Text;
                    } else {
                        self.flush_orphan(character, &mut output);
                    }
                }
                TerminalSequenceState::OrphanCsi => {
                    if ('\u{20}'..='\u{3f}').contains(&character) {
                        self.orphan.push(character);
                    } else if character.is_ascii_alphabetic() || character == '~' {
                        self.orphan.clear();
                        self.state = TerminalSequenceState::Text;
                    } else {
                        self.flush_orphan(character, &mut output);
                    }
                }
            }
        }
        output
    }

    fn finish(&mut self) {
        self.orphan.clear();
        self.state = TerminalSequenceState::Text;
    }
}

#[derive(Default)]
struct StreamRedactor {
    pending: String,
    state: RedactionState,
    terminal: TerminalTextNormalizer,
}

impl StreamRedactor {
    fn push(&mut self, text: &str) -> String {
        self.pending.push_str(&self.terminal.push(text));
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

        sanitize_interactive_text(output)
    }

    fn finish(&mut self) -> String {
        self.terminal.finish();
        match self.state {
            RedactionState::Scanning => {
                sanitize_interactive_text(std::mem::take(&mut self.pending))
            }
            RedactionState::AwaitingValue | RedactionState::Redacting => {
                self.pending.clear();
                String::new()
            }
        }
    }
}

fn sanitize_interactive_text(text: String) -> String {
    text.chars()
        .filter(|character| matches!(character, '\n' | '\t') || !character.is_control())
        .collect()
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

struct InteractiveStateDetector {
    provider: SubscriptionProvider,
    pending: String,
    last_url: Option<String>,
    last_code: Option<String>,
    input_pending: bool,
    invalid_emitted: bool,
    request_sequence: u64,
}

impl InteractiveStateDetector {
    fn new(provider: SubscriptionProvider) -> Self {
        Self {
            provider,
            pending: String::new(),
            last_url: None,
            last_code: None,
            input_pending: false,
            invalid_emitted: false,
            request_sequence: 0,
        }
    }

    fn push(&mut self, text: &str) -> Vec<InteractiveEvent> {
        self.pending.push_str(text);
        if self.pending.len() > 16 * 1024 {
            self.pending = self
                .pending
                .chars()
                .rev()
                .take(8 * 1024)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
        }
        let safe_url = extract_provider_url(self.provider, &self.pending);
        let user_code = extract_provider_user_code(self.provider, &self.pending);
        let needs_input =
            self.provider != SubscriptionProvider::Codex && provider_input_prompt(&self.pending);
        let mut events = Vec::new();
        if self.provider == SubscriptionProvider::Codex {
            if let (Some(safe_url), Some(user_code)) = (safe_url, user_code) {
                if self.last_url.as_ref() != Some(&safe_url)
                    || self.last_code.as_ref() != Some(&user_code)
                {
                    self.last_url = Some(safe_url.clone());
                    self.last_code = Some(user_code.clone());
                    self.request_sequence += 1;
                    events.push(InteractiveEvent::State {
                        status: InteractiveStateStatus::NeedsUserAction,
                        action: InteractiveAction::Device {
                            instruction: "Apri l’indirizzo e inserisci il codice temporaneo.",
                            request_id: format!("codex-device-{}", self.request_sequence),
                            safe_url,
                            user_code,
                        },
                    });
                }
            } else if !self.invalid_emitted && codex_device_attempt_complete(&self.pending) {
                self.invalid_emitted = true;
                events.push(InteractiveEvent::Failure {
                    code: "provider_action_invalid",
                });
            }
            return events;
        }
        if let Some(safe_url) = safe_url {
            if self.last_url.as_ref() != Some(&safe_url) {
                self.last_url = Some(safe_url.clone());
                events.push(InteractiveEvent::State {
                    status: InteractiveStateStatus::NeedsUserAction,
                    action: InteractiveAction::Url {
                        instruction: "Completa l’accesso nel browser.",
                        safe_url,
                    },
                });
            }
        }
        if let Some(user_code) = user_code {
            if self.last_code.as_ref() != Some(&user_code) {
                self.last_code = Some(user_code.clone());
                events.push(InteractiveEvent::State {
                    status: InteractiveStateStatus::NeedsUserAction,
                    action: InteractiveAction::Code {
                        instruction: "Inserisci nel browser il codice mostrato.",
                        user_code,
                    },
                });
            }
        }
        if needs_input && !self.input_pending {
            self.input_pending = true;
            self.request_sequence += 1;
            events.push(InteractiveEvent::State {
                status: InteractiveStateStatus::NeedsUserAction,
                action: InteractiveAction::Input {
                    instruction:
                        "Completa l’accesso nel browser e inserisci la risposta richiesta.",
                    input_request: InteractiveInputRequest {
                        id: format!(
                            "{}-response-{}",
                            self.provider.cli_id(),
                            self.request_sequence
                        ),
                        label: "Risposta richiesta dal provider",
                        description: "Inserisci la risposta mostrata dal provider nel browser.",
                        submit_label: "Invia risposta",
                        secret: false,
                        input_mode: InteractiveInputMode::Text,
                    },
                },
            });
        }
        events
    }

    fn request_consumed(&mut self) {
        self.pending.clear();
        self.input_pending = false;
    }
}

fn extract_provider_url(provider: SubscriptionProvider, text: &str) -> Option<String> {
    text.split_whitespace().find_map(|token| {
        let start = token.find("https://")?;
        let candidate = token[start..].trim_end_matches(|character: char| {
            matches!(
                character,
                '.' | ',' | ';' | ':' | ')' | ']' | '}' | '"' | '\''
            )
        });
        if candidate.is_empty()
            || candidate.len() > 2048
            || !candidate.is_ascii()
            || candidate.chars().any(char::is_control)
            || candidate
                .bytes()
                .any(|byte| matches!(byte, b'[' | b']' | b'\\' | b'{' | b'}'))
        {
            return None;
        }
        let remainder = candidate.strip_prefix("https://")?;
        let authority = remainder.split(['/', '?', '#']).next()?;
        if authority.is_empty()
            || authority.contains('@')
            || authority.contains(':')
            || !authority
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
        {
            return None;
        }
        let host = authority.to_ascii_lowercase();
        let suffix = &remainder[authority.len()..];
        if suffix.contains('#') {
            return None;
        }
        let path = suffix.split('?').next().unwrap_or("");
        let allowed = match provider {
            SubscriptionProvider::Claude => {
                matches!(host.as_str(), "console.anthropic.com" | "claude.ai")
                    && matches!(path, "/oauth" | "/oauth/" | "/oauth/authorize")
            }
            SubscriptionProvider::Codex => {
                host == "auth.openai.com" && matches!(path, "/codex/device" | "/codex/device/")
            }
            SubscriptionProvider::Kimi => {
                host == "auth.kimi.com" && matches!(path, "/device" | "/device/")
            }
        };
        if !allowed {
            return None;
        }
        let lowercase = candidate.to_ascii_lowercase();
        for forbidden in [
            "access_token=",
            "refresh_token=",
            "id_token=",
            "client_secret=",
            "device_code=",
            "authorization_code=",
            "session_token=",
            "password=",
            "%00",
            "%0a",
            "%0d",
            "%1b",
            "%9b",
            "%9d",
        ] {
            if lowercase.contains(forbidden) {
                return None;
            }
        }
        Some(format!("https://{host}{suffix}"))
    })
}

fn extract_provider_user_code(provider: SubscriptionProvider, text: &str) -> Option<String> {
    if !text.to_ascii_lowercase().contains("code") {
        return None;
    }
    text.split_whitespace().find_map(|token| {
        let candidate = token.trim_matches(|character: char| {
            matches!(
                character,
                '.' | ',' | ';' | ':' | '(' | ')' | '[' | ']' | '{' | '}'
            )
        });
        let valid = (4..=128).contains(&candidate.len())
            && candidate
                .bytes()
                .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || byte == b'-')
            && candidate
                .bytes()
                .any(|byte| byte.is_ascii_digit() || byte == b'-');
        let provider_valid = match provider {
            SubscriptionProvider::Codex => {
                candidate.len() == 10
                    && candidate.as_bytes()[4] == b'-'
                    && candidate[..4]
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric())
                    && candidate[5..]
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric())
            }
            SubscriptionProvider::Claude | SubscriptionProvider::Kimi => true,
        };
        (valid && provider_valid).then(|| candidate.to_owned())
    })
}

fn provider_input_prompt(text: &str) -> bool {
    let lowercase = text.to_ascii_lowercase();
    (lowercase.contains("paste") || lowercase.contains("incolla"))
        && (lowercase.contains("code")
            || lowercase.contains("codice")
            || lowercase.contains("callback"))
        || lowercase.contains("enter authorization code")
        || lowercase.contains("enter the code from your browser")
}

fn codex_device_attempt_complete(text: &str) -> bool {
    let lowercase = text.to_ascii_lowercase();
    text.contains('\n')
        && lowercase.contains("https://")
        && (lowercase.contains("code") || lowercase.contains("codice"))
}

fn stream_reader(
    mut reader: impl Read + Send + 'static,
    channel: Channel<InteractiveEvent>,
    detector: Arc<Mutex<InteractiveStateDetector>>,
    pending_input: Arc<Mutex<Option<String>>>,
) {
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        let mut redactor = StreamRedactor::default();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => {
                    let text = redactor.finish();
                    if !text.is_empty() {
                        emit_interactive_states(&channel, &detector, &pending_input, &text);
                        let _ = channel.send(InteractiveEvent::Output { text });
                    }
                    break;
                }
                Ok(count) => {
                    let text = redactor.push(&String::from_utf8_lossy(&buffer[..count]));
                    if !text.is_empty() {
                        emit_interactive_states(&channel, &detector, &pending_input, &text);
                        let _ = channel.send(InteractiveEvent::Output { text });
                    }
                }
            }
        }
    });
}

fn emit_interactive_states(
    channel: &Channel<InteractiveEvent>,
    detector: &Mutex<InteractiveStateDetector>,
    pending_input: &Mutex<Option<String>>,
    text: &str,
) {
    let events = detector
        .lock()
        .map(|mut detector| detector.push(text))
        .unwrap_or_default();
    for event in events {
        let request_id = match &event {
            InteractiveEvent::State {
                action: InteractiveAction::Input { input_request, .. },
                ..
            } => Some(input_request.id.clone()),
            InteractiveEvent::State { .. } => None,
            InteractiveEvent::Failure { .. } => None,
            InteractiveEvent::Output { .. } | InteractiveEvent::Exit { .. } => continue,
        };
        if let Ok(mut pending) = pending_input.lock() {
            *pending = request_id;
        } else {
            continue;
        }
        let _ = channel.send(event);
    }
}

fn configured_subscription_provider(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ValidatedHost,
) -> Result<SubscriptionProvider, OnboardingError> {
    let result = match host {
        ValidatedHost::Local => {
            let wrapper = wrapper_path(app).ok_or_else(|| failure("runtime_missing"))?;
            run_scoped_local(
                app,
                scope,
                &wrapper,
                LocalCliOperation::ProviderCurrent,
                SNAPSHOT_TIMEOUT,
            )
            .map_err(|error| local_failure(error, "provider_login_start_failed"))?
        }
        ValidatedHost::Vps { .. } => {
            run_ssh(host, REMOTE_PROVIDER_CURRENT, None, SNAPSHOT_TIMEOUT, None)
                .map_err(|_| failure("provider_login_start_failed"))?
        }
    };
    if !result.success() {
        return Err(failure("provider_login_start_failed"));
    }
    SubscriptionProvider::from_cli_id(&result.stdout_text())
        .ok_or_else(|| failure("provider_login_start_failed"))
}

fn provider_bootstrap_input(provider: SubscriptionProvider) -> Option<&'static [u8]> {
    match provider {
        SubscriptionProvider::Claude | SubscriptionProvider::Kimi => Some(b"/login\n"),
        SubscriptionProvider::Codex => None,
    }
}

#[tauri::command]
pub(crate) fn onboarding_provider_login(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
    host: ExecutionHost,
    on_event: Channel<InteractiveEvent>,
    on_progress: Channel<OnboardingProgress>,
) -> Result<InteractiveStart, OnboardingError> {
    let scope = scopes.lock_active().map_err(failure)?;
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
    let reporter = ProgressReporter::new(on_progress);
    let login_started = Instant::now();
    reporter.send(
        OnboardingProgressStage::Login,
        OnboardingProgressStatus::Start,
        "Avvio l’accesso al provider",
        login_started,
        None,
    );
    let setup = (|| {
        let validated = validate_host(&app, &host).map_err(failure)?;
        let provider = configured_subscription_provider(&app, scope.scope(), &validated)?;
        let mut command = match &validated {
            ValidatedHost::Local => {
                let wrapper = wrapper_path(&app).ok_or_else(|| failure("runtime_missing"))?;
                #[cfg(target_os = "macos")]
                {
                    let oauth_args = LocalCliOperation::OauthLogin.argv();
                    let (program, invocation) =
                        local_wrapper_command(&wrapper, &oauth_args, std::env::var_os("PATH"))
                            .map_err(failure)?;
                    let mut cmd = Command::new("/usr/bin/script");
                    cmd.arg("-q").arg("/dev/null").arg(program).args(invocation);
                    cmd
                }
                #[cfg(not(target_os = "macos"))]
                {
                    let mut cmd = Command::new(wrapper);
                    cmd.args(LocalCliOperation::OauthLogin.argv());
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
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| failure("provider_login_pipe_failed"))?;
        if let Some(bootstrap) = provider_bootstrap_input(provider) {
            stdin
                .write_all(bootstrap)
                .and_then(|_| stdin.flush())
                .map_err(|_| failure("provider_login_pipe_failed"))?;
        }
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
        Ok::<_, OnboardingError>((child, stdin, stdout, stderr, id, provider))
    })();
    let (child, stdin, stdout, stderr, id, provider) = match setup {
        Ok(value) => value,
        Err(error) => {
            reporter.send(
                OnboardingProgressStage::Login,
                OnboardingProgressStatus::Error,
                error.message,
                login_started,
                Some(&error),
            );
            return Err(error);
        }
    };
    let child = Arc::new(Mutex::new(child));
    let detector = Arc::new(Mutex::new(InteractiveStateDetector::new(provider)));
    let pending_input = Arc::new(Mutex::new(None));
    stream_reader(
        stdout,
        on_event.clone(),
        Arc::clone(&detector),
        Arc::clone(&pending_input),
    );
    stream_reader(
        stderr,
        on_event.clone(),
        Arc::clone(&detector),
        Arc::clone(&pending_input),
    );
    let waiter = Arc::clone(&child);
    let exit_channel = on_event.clone();
    let exit_pending_input = Arc::clone(&pending_input);
    thread::spawn(move || {
        let mut next_heartbeat = PROGRESS_HEARTBEAT_INTERVAL;
        loop {
            let result =
                waiter
                    .lock()
                    .map_err(|_| failure("state_failed"))
                    .and_then(|mut process| {
                        process
                            .try_wait()
                            .map_err(|_| failure("provider_login_failed"))
                    });
            match result {
                Ok(Some(status)) => {
                    if let Ok(mut pending) = exit_pending_input.lock() {
                        *pending = None;
                    }
                    let _ = exit_channel.send(InteractiveEvent::Exit {
                        code: status.code(),
                    });
                    if status.success() {
                        reporter.send(
                            OnboardingProgressStage::Login,
                            OnboardingProgressStatus::Done,
                            "Accesso al provider completato",
                            login_started,
                            None,
                        );
                    } else {
                        let error = failure("provider_login_failed");
                        reporter.send(
                            OnboardingProgressStage::Login,
                            OnboardingProgressStatus::Error,
                            error.message,
                            login_started,
                            Some(&error),
                        );
                    }
                    break;
                }
                Err(error) => {
                    if let Ok(mut pending) = exit_pending_input.lock() {
                        *pending = None;
                    }
                    let _ = exit_channel.send(InteractiveEvent::Exit { code: None });
                    reporter.send(
                        OnboardingProgressStage::Login,
                        OnboardingProgressStatus::Error,
                        error.message,
                        login_started,
                        Some(&error),
                    );
                    break;
                }
                Ok(None) => {}
            }
            if login_started.elapsed() >= next_heartbeat {
                reporter.send(
                    OnboardingProgressStage::Login,
                    OnboardingProgressStatus::Progress,
                    "Accesso al provider in corso",
                    login_started,
                    None,
                );
                next_heartbeat += PROGRESS_HEARTBEAT_INTERVAL;
            }
            thread::sleep(Duration::from_millis(100));
        }
    });
    *slot = Some(InteractiveSession {
        scope: scope.scope().clone(),
        id: id.clone(),
        child,
        stdin: Mutex::new(Some(stdin)),
        detector,
        pending_input,
    });
    Ok(InteractiveStart { session_id: id })
}

#[tauri::command]
pub(crate) fn onboarding_provider_login_input(
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
    session_id: String,
    request_id: String,
    input: String,
) -> Result<(), OnboardingError> {
    let scope = scopes.lock_active().map_err(failure)?;
    let mut input = Zeroizing::new(input);
    let slot = state
        .interactive
        .lock()
        .map_err(|_| failure("state_failed"))?;
    let session = slot
        .as_ref()
        .filter(|value| value.id == session_id && &value.scope == scope.scope())
        .ok_or_else(|| failure("session_not_found"))?;
    let mut stdin = session.stdin.lock().map_err(|_| failure("state_failed"))?;
    let writer = stdin.as_mut().ok_or_else(|| failure("session_closed"))?;
    write_provider_input(&session.pending_input, writer, &request_id, input.as_str())?;
    session
        .detector
        .lock()
        .map_err(|_| failure("state_failed"))?
        .request_consumed();
    input.zeroize();
    Ok(())
}

fn write_provider_input(
    pending_input: &Mutex<Option<String>>,
    writer: &mut impl Write,
    request_id: &str,
    input: &str,
) -> Result<(), OnboardingError> {
    if !valid_interactive_request_id(request_id) || !valid_provider_login_input(input) {
        return Err(failure("invalid_input"));
    }
    let mut pending = pending_input.lock().map_err(|_| failure("state_failed"))?;
    if pending.as_deref() != Some(request_id) {
        return Err(failure("provider_input_not_requested"));
    }
    pending.take();
    writer
        .write_all(input.as_bytes())
        .and_then(|_| writer.write_all(b"\n"))
        .and_then(|_| writer.flush())
        .map_err(|_| failure("provider_input_failed"))
}

fn valid_interactive_request_id(request_id: &str) -> bool {
    (1..=128).contains(&request_id.len())
        && request_id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
        })
}

fn valid_provider_login_input(input: &str) -> bool {
    input.len() <= 4096
        && input.chars().all(|character| {
            !character.is_control() && !matches!(character, '\u{2028}' | '\u{2029}')
        })
}

#[tauri::command]
pub(crate) fn onboarding_provider_login_close(
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
    session_id: String,
) -> Result<(), OnboardingError> {
    let scope = scopes.lock_active().map_err(failure)?;
    let mut slot = state
        .interactive
        .lock()
        .map_err(|_| failure("state_failed"))?;
    if !slot
        .as_ref()
        .is_some_and(|value| value.id == session_id && &value.scope == scope.scope())
    {
        return Err(failure("session_not_found"));
    }
    let session = slot.take().ok_or_else(|| failure("session_not_found"))?;
    if let Ok(mut process) = session.child.lock() {
        let _ = process.kill();
        let _ = process.wait();
    }
    Ok(())
}

fn resume_team_prerequisite(snapshot: &OnboardingSnapshot) -> Result<(), OnboardingError> {
    let missing = if !snapshot.runtime_installed {
        Some("resume_runtime_not_ready")
    } else if !snapshot.container_running {
        Some("resume_container_not_ready")
    } else if !snapshot.provider_configured {
        Some("resume_provider_not_configured")
    } else if !snapshot.provider_authenticated {
        Some("resume_provider_not_authenticated")
    } else {
        None
    };
    missing.map_or(Ok(()), |code| Err(failure(code)))
}

fn start_team_impl(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    validated: &ValidatedHost,
) -> Result<(), OnboardingError> {
    match validated {
        ValidatedHost::Local => {
            let wrapper = wrapper_path(app).ok_or_else(|| failure("runtime_missing"))?;
            ensure_success(
                run_scoped_local(
                    app,
                    scope,
                    &wrapper,
                    LocalCliOperation::TeamStart,
                    PREPARE_TIMEOUT,
                ),
                "team_start_failed",
            )
        }
        ValidatedHost::Vps { .. } => ensure_success(
            run_ssh(validated, REMOTE_TEAM_START, None, PREPARE_TIMEOUT, None),
            "team_start_failed",
        ),
    }
}

/// What the provider says about its 5h and weekly windows before the team is
/// started. Read once through `jht providers limits --json` (the same data
/// the usage bridge reads once the team runs).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StartLimits {
    Sufficient,
    /// A window is exhausted; it frees again at `resets_at` (unix seconds).
    Exhausted {
        resets_at: i64,
    },
    /// No usable answer: the team starts anyway and the user is told the
    /// limits were not verified. Never a silent block.
    Unverified,
}

#[derive(Deserialize)]
struct LimitsVerdict {
    status: String,
    resets_at: Option<i64>,
}

fn parse_start_limits(stdout: &str, now: i64) -> StartLimits {
    let Ok(verdict) = serde_json::from_str::<LimitsVerdict>(stdout.trim()) else {
        return StartLimits::Unverified;
    };
    match (verdict.status.as_str(), verdict.resets_at) {
        ("ok", _) => StartLimits::Sufficient,
        // A reset already in the past means the window has turned over since
        // the reading: unknown, not blocked.
        ("exhausted", Some(resets_at)) if resets_at > now => StartLimits::Exhausted { resets_at },
        _ => StartLimits::Unverified,
    }
}

fn read_start_limits(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    validated: &ValidatedHost,
) -> StartLimits {
    let result = match validated {
        ValidatedHost::Local => match wrapper_path(app) {
            Some(wrapper) => run_scoped_local(
                app,
                scope,
                &wrapper,
                LocalCliOperation::ProviderLimits,
                SNAPSHOT_TIMEOUT,
            ),
            None => return StartLimits::Unverified,
        },
        ValidatedHost::Vps { .. } => run_ssh(
            validated,
            REMOTE_PROVIDER_LIMITS,
            None,
            SNAPSHOT_TIMEOUT,
            None,
        ),
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() as i64)
        .unwrap_or(0);
    match result {
        Ok(output) if output.success() => parse_start_limits(&output.stdout_text(), now),
        _ => StartLimits::Unverified,
    }
}

/// Exhausted limits stop the start before anything runs, with the time they
/// free again; any other answer lets the start go on.
fn start_limits_gate(limits: StartLimits) -> Result<StartLimits, OnboardingError> {
    match limits {
        StartLimits::Exhausted { resets_at } => Err(OnboardingError {
            resets_at: Some(resets_at),
            ..failure("provider_limits_exhausted")
        }),
        other => Ok(other),
    }
}

fn with_start_limits(mut snapshot: OnboardingSnapshot, limits: StartLimits) -> OnboardingSnapshot {
    snapshot.limits_verified = Some(limits == StartLimits::Sufficient);
    snapshot
}

fn verified_team_snapshot(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    validated: &ValidatedHost,
) -> Result<OnboardingSnapshot, OnboardingError> {
    let snapshot = snapshot_impl(app, scope, validated)?;
    if !snapshot.assistant_running || !snapshot.captain_running {
        return Err(failure("team_verify_failed"));
    }
    Ok(snapshot)
}

#[tauri::command]
pub(crate) async fn onboarding_team_start(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
    host: ExecutionHost,
    on_progress: Channel<OnboardingProgress>,
) -> Result<OnboardingSnapshot, OnboardingError> {
    let expected = scopes.active().map_err(failure)?;
    if state
        .preparing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        let reporter = ProgressReporter::new(on_progress);
        reporter.run(
            OnboardingProgressStage::Team,
            "Avvio la squadra",
            "Avvio della squadra in corso",
            "Squadra avviata e verificata",
            || {
                let validated = validate_host(&app, &host).map_err(failure)?;
                let limits =
                    start_limits_gate(read_start_limits(&app, &worker_expected, &validated))?;
                start_team_impl(&app, &worker_expected, &validated)?;
                let snapshot = verified_team_snapshot(&app, &worker_expected, &validated)?;
                Ok(with_start_limits(snapshot, limits))
            },
        )
    })
    .await
    .unwrap_or_else(|_| Err(failure("team_start_failed")));
    state.preparing.store(false, Ordering::Release);
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

/// Recreates the JHT Podman machine with only ~/.jht and the JHT documents
/// mounted. It deletes the machine (its images and internal volumes are pulled
/// again; the person's data lives in the two folders and stays), so the app
/// calls it only after the person confirmed it on the
/// `podman_machine_mounts_home` error.
fn recreate_podman_machine_with(
    run: impl FnOnce(LocalCliOperation, Duration) -> Result<ProcessResult, &'static str>,
) -> Result<(), OnboardingError> {
    match run(LocalCliOperation::PodmanMachineRecreate, PREPARE_TIMEOUT) {
        Ok(result) if result.success() => Ok(()),
        Err("process_timeout") => Err(failure("timeout")),
        Err(error) => Err(local_failure(error, "podman_machine_recreate_failed")),
        Ok(_) => Err(failure("podman_machine_recreate_failed")),
    }
}

#[tauri::command]
pub(crate) async fn onboarding_podman_machine_recreate(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<(), OnboardingError> {
    let expected = scopes.active().map_err(failure)?;
    if state
        .preparing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        let wrapper = wrapper_path(&app).ok_or_else(|| failure("runtime_missing"))?;
        recreate_podman_machine_with(|operation, timeout| {
            run_scoped_local(&app, &worker_expected, &wrapper, operation, timeout)
        })
    })
    .await
    .unwrap_or_else(|_| Err(failure("podman_machine_recreate_failed")));
    state.preparing.store(false, Ordering::Release);
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

#[tauri::command]
pub(crate) async fn onboarding_resume_team_start(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
    on_progress: Channel<OnboardingProgress>,
) -> Result<OnboardingSnapshot, OnboardingError> {
    let expected = scopes.active().map_err(failure)?;
    if state
        .preparing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        let reporter = ProgressReporter::new(on_progress);
        reporter.run(
            OnboardingProgressStage::Team,
            "Riprendo l’avvio della squadra",
            "Ripristino della squadra in corso",
            "Squadra ripristinata e verificata",
            || {
                let host = crate::direct_chat::load_persisted_host(&app, &worker_expected)
                    .map_err(failure)?;
                let validated = validate_host(&app, &host).map_err(failure)?;
                let before = snapshot_impl(&app, &worker_expected, &validated)?;
                resume_team_prerequisite(&before)?;
                let limits =
                    start_limits_gate(read_start_limits(&app, &worker_expected, &validated))?;
                start_team_impl(&app, &worker_expected, &validated)?;
                let snapshot = verified_team_snapshot(&app, &worker_expected, &validated)?;
                Ok(with_start_limits(snapshot, limits))
            },
        )
    })
    .await
    .unwrap_or_else(|_| Err(failure("team_start_failed")));
    state.preparing.store(false, Ordering::Release);
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

#[tauri::command]
pub(crate) async fn onboarding_assistant_open(
    app: tauri::AppHandle,
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
    host: ExecutionHost,
    on_progress: Channel<OnboardingProgress>,
) -> Result<OnboardingSnapshot, OnboardingError> {
    let expected = scopes.active().map_err(failure)?;
    if state
        .preparing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        let reporter = ProgressReporter::new(on_progress);
        reporter.run(
            OnboardingProgressStage::Assistant,
            "Avvio l’assistente",
            "Avvio dell’assistente in corso",
            "Assistente avviato e verificato",
            || {
                let validated = validate_host(&app, &host).map_err(failure)?;
                match &validated {
                    ValidatedHost::Local => {
                        let wrapper =
                            wrapper_path(&app).ok_or_else(|| failure("runtime_missing"))?;
                        ensure_success(
                            run_scoped_local(
                                &app,
                                &worker_expected,
                                &wrapper,
                                LocalCliOperation::AssistantStart,
                                COMMAND_TIMEOUT,
                            ),
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
                    let snapshot = snapshot_impl(&app, &worker_expected, &validated)?;
                    if assistant_reached(&snapshot) {
                        return Ok(snapshot);
                    }
                    thread::sleep(Duration::from_secs(3));
                }
                Err(failure("assistant_verify_timeout"))
            },
        )
    })
    .await
    .unwrap_or_else(|_| Err(failure("assistant_start_failed")));
    state.preparing.store(false, Ordering::Release);
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

fn assistant_reached(snapshot: &OnboardingSnapshot) -> bool {
    snapshot.assistant_running
}

#[cfg(test)]
mod tests {
    use super::{
        assistant_reached, existing_team_probe_with, expected_installer_digest, failure,
        parse_snapshot, parse_start_limits, parse_verified_snapshot, provider_bootstrap_input,
        redact, resume_team_prerequisite, start_and_verify_local_container_with, start_limits_gate,
        valid_interactive_request_id, valid_pairing_token, valid_provider_login_input,
        valid_wrapper_file, with_start_limits, write_provider_input, ExistingTeamConnectRequest,
        InteractiveStateDetector, LocalCliOperation, OnboardingDiagnosticHostKind,
        OnboardingDiagnosticSink, OnboardingProgress, OnboardingProgressStage,
        OnboardingProgressStatus, OnboardingSubmission, ProgressReporter, StartLimits,
        StreamRedactor, SubscriptionProvider, DIAGNOSTIC_MAX_BYTES, DIAGNOSTIC_MAX_RECORDS,
        INSTALL_SHA256, REMOTE_EXISTING_TEAM_PROBE, REMOTE_INSTALL, REMOTE_SNAPSHOT,
    };
    use super::{
        ensure_success, ensure_success_with_timeout, recreate_podman_machine_with,
        refuse_broad_podman_machine, PODMAN_MACHINE_MOUNTS_EXIT, PODMAN_MACHINE_MOUNTS_HOME,
        PREPARE_TIMEOUT,
    };
    #[cfg(target_os = "macos")]
    use super::{
        local_podman_install_required, local_wrapper_command, probe_installed_wrapper_with,
        LOCAL_PODMAN_INSTALL_ARGS,
    };
    use crate::account_scope::AccountScope;
    use crate::runtime_host::ProcessResult;
    use sha2::{Digest, Sha256};
    use std::{
        collections::VecDeque,
        sync::{Arc, Mutex},
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn embedded_installer_digest_matches_the_release_source() {
        let expected = expected_installer_digest(INSTALL_SHA256).expect("embedded digest");
        let actual = format!(
            "{:x}",
            Sha256::digest(include_bytes!("../../../scripts/install.sh"))
        );
        assert_eq!(actual, expected);
        assert!(!REMOTE_INSTALL.contains("curl"));
        assert!(
            REMOTE_INSTALL.find("jht_actual_sha256").unwrap()
                < REMOTE_INSTALL.find("/bin/bash").unwrap()
        );
    }

    fn outcome(success: bool) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult {
            code: if success { 0 } else { 1 },
            stdout: Vec::new(),
        })
    }

    #[test]
    fn local_runtime_prepare_errors_preserve_sanitized_contract() {
        for code in [
            "podman_missing",
            "podman_start_failed",
            "podman_not_ready",
            "runtime_download_failed",
            "runtime_install_failed",
            "runtime_missing",
            "runtime_wrapper_install_failed",
            "runtime_wrapper_publish_failed",
            "runtime_wrapper_probe_failed",
            "local_account_owner_unavailable",
            "podman_machine_recreate_failed",
            "container_start_failed",
            "container_not_ready",
            "container_timeout",
        ] {
            let error = failure(code);
            let serialized = serde_json::to_value(&error).unwrap();
            assert_eq!(error.code, code);
            assert_eq!(serialized["code"], code);
            assert_eq!(serialized["retryable"], true);
            assert!(serialized["message"].as_str().is_some_and(|value| {
                !value.is_empty() && value != "L’operazione non è riuscita. Riprova."
            }));
            let serialized = serialized.to_string();
            assert!(!serialized.contains("stderr"));
            assert!(!serialized.contains("path"));
        }

        for code in [
            PODMAN_MACHINE_MOUNTS_HOME,
            "runtime_install_unsupported",
            "local_account_owner_missing",
            "local_account_owner_mismatch",
            "local_account_owner_invalid",
            "installer_digest_missing",
            "installer_digest_invalid",
            "installer_digest_mismatch",
            "installer_payload_invalid",
        ] {
            let serialized = serde_json::to_value(failure(code)).unwrap();
            assert_eq!(serialized["code"], code);
            assert_eq!(serialized["retryable"], false);
        }
    }

    #[test]
    fn progress_stages_match_the_frontend_contract() {
        let stages = [
            OnboardingProgressStage::Engine,
            OnboardingProgressStage::Runtime,
            OnboardingProgressStage::Container,
            OnboardingProgressStage::Provider,
            OnboardingProgressStage::Login,
            OnboardingProgressStage::Team,
            OnboardingProgressStage::Assistant,
        ];
        let serialized = stages
            .into_iter()
            .map(|stage| serde_json::to_value(stage).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            serialized,
            [
                "engine",
                "runtime",
                "container",
                "provider",
                "login",
                "team",
                "assistant"
            ]
        );
        let statuses = [
            OnboardingProgressStatus::Start,
            OnboardingProgressStatus::Progress,
            OnboardingProgressStatus::Done,
            OnboardingProgressStatus::Error,
        ]
        .into_iter()
        .map(|status| serde_json::to_value(status).unwrap())
        .collect::<Vec<_>>();
        assert_eq!(statuses, ["start", "progress", "done", "error"]);
    }

    #[test]
    fn progress_sequence_heartbeats_and_errors_are_terminal_and_sanitized() {
        let events = Arc::new(Mutex::new(Vec::<OnboardingProgress>::new()));
        let captured = Arc::clone(&events);
        let reporter = ProgressReporter::with_emitter(move |event| {
            captured.lock().unwrap().push(event);
        });
        // The operation lasts until the first heartbeat is out, not a fixed
        // sleep: Windows rounds park_timeout up to its ~15.6 ms timer tick,
        // so an 8 ms operation finished before any heartbeat could fire.
        let observed = Arc::clone(&events);
        reporter
            .run_with_interval(
                OnboardingProgressStage::Runtime,
                "Avvio il runtime Job Hunter Team",
                "Avvio del runtime in corso",
                "Runtime Job Hunter Team avviato",
                Duration::from_millis(2),
                move || {
                    let deadline = Instant::now() + Duration::from_secs(5);
                    while Instant::now() < deadline
                        && !observed
                            .lock()
                            .unwrap()
                            .iter()
                            .any(|event| event.status == OnboardingProgressStatus::Progress)
                    {
                        thread::sleep(Duration::from_millis(1));
                    }
                    Ok::<_, super::OnboardingError>(())
                },
            )
            .unwrap();

        let events = events.lock().unwrap();
        assert_eq!(
            events.first().unwrap().status,
            OnboardingProgressStatus::Start
        );
        assert_eq!(
            events.last().unwrap().status,
            OnboardingProgressStatus::Done
        );
        assert!(events
            .iter()
            .any(|event| event.status == OnboardingProgressStatus::Progress));
        assert!(events.windows(2).all(|pair| {
            pair[1].sequence == pair[0].sequence + 1 && pair[1].elapsed_ms >= pair[0].elapsed_ms
        }));
        assert!(events.iter().all(|event| {
            event.code.is_none()
                && event.retryable.is_none()
                && event.stage == OnboardingProgressStage::Runtime
        }));
        drop(events);

        let failures = Arc::new(Mutex::new(Vec::<OnboardingProgress>::new()));
        let captured = Arc::clone(&failures);
        let reporter = ProgressReporter::with_emitter(move |event| {
            captured.lock().unwrap().push(event);
        });
        let error = reporter
            .run_with_interval(
                OnboardingProgressStage::Engine,
                "Verifico il motore container",
                "Preparazione del motore container in corso",
                "Motore container verificato",
                Duration::from_secs(1),
                || Err::<(), _>(failure("local_account_owner_mismatch")),
            )
            .unwrap_err();
        assert_eq!(error.code, "local_account_owner_mismatch");
        let failures = failures.lock().unwrap();
        assert_eq!(failures.len(), 2);
        assert_eq!(failures[0].status, OnboardingProgressStatus::Start);
        assert_eq!(failures[1].status, OnboardingProgressStatus::Error);
        assert_eq!(failures[1].code, Some("local_account_owner_mismatch"));
        assert_eq!(failures[1].retryable, Some(false));
        let value = serde_json::to_value(&failures[1]).unwrap();
        let mut keys = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "code",
                "elapsedMs",
                "message",
                "retryable",
                "sequence",
                "stage",
                "status"
            ]
        );
        let serialized = serde_json::to_string(&*failures).unwrap();
        for forbidden in [
            "raw stdout",
            "raw stderr",
            "203.0.113.10",
            "/private/key.pem",
            "secret-token",
            "account-user-id",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn diagnostics_are_scoped_bounded_private_and_schema_only() {
        use std::{
            fs,
            time::{SystemTime, UNIX_EPOCH},
        };

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-diagnostics-{nonce}"));
        let scope = AccountScope::synthetic(b"diagnostic-scope");
        let sink =
            OnboardingDiagnosticSink::at_root(&root, &scope, OnboardingDiagnosticHostKind::Local);
        for sequence in 0..(DIAGNOSTIC_MAX_RECORDS as u64 + 17) {
            sink.record_progress(&OnboardingProgress {
                stage: OnboardingProgressStage::Container,
                status: OnboardingProgressStatus::Progress,
                message: "raw stdout 203.0.113.10 /private/key.pem secret-token account-user-id",
                sequence,
                elapsed_ms: sequence,
                code: None,
                retryable: None,
            });
        }
        let failed_process = outcome(false);
        sink.record_process(
            "container-status-final".to_owned(),
            OnboardingProgressStage::Container,
            std::time::Instant::now(),
            &failed_process,
            "container_not_ready",
            false,
        );
        let snapshot = super::OnboardingSnapshot {
            runtime_installed: true,
            container_running: false,
            ..Default::default()
        };
        sink.record_snapshot(
            "container-snapshot",
            std::time::Instant::now(),
            &Ok(snapshot),
        );
        let bytes = fs::read(&sink.path).unwrap();
        assert!(bytes.len() <= DIAGNOSTIC_MAX_BYTES);
        let source = String::from_utf8(bytes).unwrap();
        assert_eq!(source.lines().count(), DIAGNOSTIC_MAX_RECORDS);
        assert!(sink
            .path
            .starts_with(root.join("accounts").join(scope.digest())));
        for forbidden in [
            "raw stdout",
            "203.0.113.10",
            "/private/key.pem",
            "secret-token",
            "account-user-id",
            "message",
            "stdout",
            "stderr",
            "hostname",
            "fingerprint",
        ] {
            assert!(!source.contains(forbidden));
        }
        assert!(source.contains("\"code\":\"container_not_ready\""));
        assert!(source.contains("\"exitCategory\":\"nonzero\""));
        assert!(
            source.contains("\"snapshot\":{\"runtimeInstalled\":true,\"containerRunning\":false")
        );
        for line in source.lines() {
            let value: serde_json::Value = serde_json::from_str(line).unwrap();
            let mut keys = value
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>();
            keys.sort_unstable();
            assert_eq!(
                keys,
                [
                    "code",
                    "elapsedMs",
                    "exitCategory",
                    "hostKind",
                    "operationId",
                    "requestId",
                    "retryable",
                    "schemaVersion",
                    "snapshot",
                    "stage",
                    "status",
                ]
            );
            assert_eq!(value["hostKind"], "local");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(sink.path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(&sink.path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let vps_sink = OnboardingDiagnosticSink::at_root(
            &root.join("vps"),
            &scope,
            OnboardingDiagnosticHostKind::Vps,
        );
        vps_sink.record_progress(&OnboardingProgress {
            stage: OnboardingProgressStage::Engine,
            status: OnboardingProgressStatus::Start,
            message: "ignored",
            sequence: 1,
            elapsed_ms: 0,
            code: None,
            retryable: None,
        });
        assert!(fs::read_to_string(&vps_sink.path)
            .unwrap()
            .contains("\"hostKind\":\"vps\""));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn diagnostic_storage_failure_is_best_effort_and_never_follows_symlinks() {
        use std::{
            fs,
            os::unix::fs::symlink,
            time::{SystemTime, UNIX_EPOCH},
        };

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-diagnostics-symlink-{nonce}"));
        let scope = AccountScope::synthetic(b"diagnostic-symlink-scope");
        let sink =
            OnboardingDiagnosticSink::at_root(&root, &scope, OnboardingDiagnosticHostKind::Vps);
        fs::create_dir_all(sink.path.parent().unwrap()).unwrap();
        let sentinel = root.join("sentinel");
        fs::write(&sentinel, b"unchanged").unwrap();
        symlink(&sentinel, &sink.path).unwrap();
        sink.record_progress(&OnboardingProgress {
            stage: OnboardingProgressStage::Runtime,
            status: OnboardingProgressStatus::Error,
            message: "must not persist",
            sequence: 1,
            elapsed_ms: 1,
            code: Some("container_not_ready"),
            retryable: Some(true),
        });
        assert_eq!(fs::read(&sentinel).unwrap(), b"unchanged");
        assert!(fs::symlink_metadata(&sink.path)
            .unwrap()
            .file_type()
            .is_symlink());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn strict_snapshot_rejects_partial_duplicate_and_unknown_facts() {
        let complete = "runtimeInstalled=1\ncontainerRunning=0\nproviderConfigured=0\nproviderAuthenticated=0\nassistantWelcomed=0\nassistantRunning=0\ncaptainRunning=0\nprofileReady=0\n";
        assert!(parse_verified_snapshot(complete).is_some());
        assert!(parse_verified_snapshot("runtimeInstalled=1\n").is_none());
        assert!(parse_verified_snapshot(&format!("{complete}runtimeInstalled=1\n")).is_none());
        assert!(parse_verified_snapshot(&format!("{complete}privatePath=1\n")).is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn installed_wrapper_probe_is_read_only_ordered_and_fail_closed() {
        let snapshot = b"runtimeInstalled=1\ncontainerRunning=0\nproviderConfigured=0\nproviderAuthenticated=0\nassistantWelcomed=0\nassistantRunning=0\ncaptainRunning=0\nprofileReady=0\n";
        let mut calls = Vec::new();
        let verified = probe_installed_wrapper_with(|operation, _| {
            calls.push(operation.diagnostic_id());
            Ok(ProcessResult {
                code: if operation == LocalCliOperation::Status {
                    1
                } else {
                    0
                },
                stdout: if operation == LocalCliOperation::Snapshot {
                    snapshot.to_vec()
                } else {
                    Vec::new()
                },
            })
        })
        .unwrap();
        assert_eq!(calls, ["status", "snapshot"]);
        assert!(verified.runtime_installed);
        assert!(!verified.container_running);

        let mut calls = 0;
        let error = probe_installed_wrapper_with(|_, _| {
            calls += 1;
            Ok(ProcessResult {
                code: 126,
                stdout: Vec::new(),
            })
        })
        .unwrap_err();
        assert_eq!(calls, 1);
        assert_eq!(error.code, "runtime_wrapper_probe_failed");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn local_installer_explicitly_selects_the_attested_podman_path() {
        assert_eq!(
            LOCAL_PODMAN_INSTALL_ARGS,
            [
                "JHT_SKIP_ONBOARD=1",
                "/bin/bash",
                "-s",
                "--",
                "--runtime",
                "podman",
            ]
        );
        assert!(local_podman_install_required(false, false, false));
        assert!(local_podman_install_required(false, true, true));
        assert!(local_podman_install_required(true, false, true));
        assert!(local_podman_install_required(true, true, false));
        assert!(!local_podman_install_required(true, true, true));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn legacy_host_wrapper_is_upgraded_byte_for_byte_without_runtime_reinstall() {
        use std::{
            fs,
            os::unix::fs::PermissionsExt,
            process::Command,
            time::{SystemTime, UNIX_EPOCH},
        };

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let home_alias = std::env::temp_dir().join(format!("jht-wrapper-upgrade-{nonce}"));
        fs::create_dir_all(&home_alias).unwrap();
        let home = fs::canonicalize(&home_alias).unwrap();
        let bin = home.join(".local/bin");
        let runtime = home.join("runtime");
        let runtime_bin = runtime.join("bin");
        let fake_bin = home.join("fake-bin");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&runtime_bin).unwrap();
        fs::create_dir_all(&fake_bin).unwrap();
        for directory in [
            &home,
            &home.join(".local"),
            &bin,
            &runtime,
            &runtime_bin,
            &fake_bin,
        ] {
            fs::set_permissions(directory, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let wrapper = bin.join("jht");
        let old_wrapper = b"#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nexit 0\n";
        let artifacts = [
            (wrapper.clone(), old_wrapper.as_slice(), 0o700),
            (
                runtime.join("docker-compose.yml"),
                b"services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n".as_slice(),
                0o600,
            ),
            (
                runtime.join("host-setup.sh"),
                b"#!/bin/sh\nJHT_HOST_SETUP_PROTOCOL=1\n".as_slice(),
                0o700,
            ),
            (runtime.join("container-runtime"), b"podman\n".as_slice(), 0o600),
            (runtime.join("podman-machine"), b"jht-podman\n".as_slice(), 0o600),
            (
                runtime_bin.join("docker"),
                b"#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\n[ \"${1:-}\" = info ] && exit 0\nexit 1\n".as_slice(),
                0o700,
            ),
            (
                fake_bin.join("podman"),
                b"#!/bin/sh\n[ \"${1:-}\" = --version ] && { echo 'podman version 6.1.3'; exit 0; }\n[ \"${1:-}\" = --connection ] && [ \"${3:-}\" = info ] && exit 0\nexit 1\n".as_slice(),
                0o700,
            ),
            (
                fake_bin.join("podman-compose"),
                b"#!/bin/sh\n[ \"${1:-}\" = --version ] && { echo 'podman-compose version 1.6.0'; exit 0; }\nexit 0\n".as_slice(),
                0o700,
            ),
        ];
        for (path, bytes, mode) in artifacts {
            fs::write(&path, bytes).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();
        }
        let digest =
            |path: &std::path::Path| format!("{:x}", Sha256::digest(fs::read(path).unwrap()));
        let old_manifest = format!(
            "version=1\ndocker-compose.yml={}\nhost-setup.sh={}\njht-wrapper.sh={}\ncontainer-runtime={}\npodman-machine={}\ndocker-shim={}\n",
            digest(&runtime.join("docker-compose.yml")),
            digest(&runtime.join("host-setup.sh")),
            digest(&wrapper),
            digest(&runtime.join("container-runtime")),
            digest(&runtime.join("podman-machine")),
            digest(&runtime_bin.join("docker")),
        );
        let manifest_path = runtime.join(".runtime-integrity");
        fs::write(&manifest_path, &old_manifest).unwrap();
        fs::set_permissions(&manifest_path, fs::Permissions::from_mode(0o600)).unwrap();

        assert!(super::valid_host_wrapper_file(&wrapper));
        assert!(!valid_wrapper_file(&wrapper));
        assert!(!local_podman_install_required(true, true, true));
        assert!(super::runtime_bundle_manifest_valid(&runtime, &wrapper));

        fs::create_dir(runtime.join(".upgrade.lock")).unwrap();
        let locked = super::publish_bundled_wrapper(&home, &runtime).unwrap_err();
        assert_eq!(locked.code, "runtime_wrapper_publish_failed");
        assert_eq!(fs::read(&wrapper).unwrap(), old_wrapper);
        assert_eq!(fs::read_to_string(&manifest_path).unwrap(), old_manifest);
        fs::remove_dir(runtime.join(".upgrade.lock")).unwrap();

        let mixed_manifest = old_manifest.replace(
            &digest(&runtime.join("docker-compose.yml")),
            &"0".repeat(64),
        );
        fs::write(&manifest_path, &mixed_manifest).unwrap();
        let mixed = super::publish_bundled_wrapper(&home, &runtime).unwrap_err();
        assert_eq!(mixed.code, "runtime_wrapper_publish_failed");
        assert_eq!(fs::read(&wrapper).unwrap(), old_wrapper);
        assert_eq!(fs::read_to_string(&manifest_path).unwrap(), mixed_manifest);
        fs::write(&manifest_path, &old_manifest).unwrap();

        let interrupted = super::publish_bundled_wrapper_with_failpoint(&home, &runtime, |step| {
            step == "after-manifest"
        })
        .unwrap_err();
        assert_eq!(interrupted.code, "runtime_wrapper_publish_failed");
        assert_eq!(fs::read(&wrapper).unwrap(), old_wrapper);
        assert_eq!(fs::read_to_string(&manifest_path).unwrap(), old_manifest);
        assert!(fs::read_dir(&bin).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".jht-desktop")
        }));
        assert!(fs::read_dir(&runtime).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".integrity-desktop")
        }));

        let published = super::publish_bundled_wrapper(&home, &runtime).unwrap();
        assert_eq!(published, wrapper);
        assert_eq!(fs::read(&published).unwrap(), super::BUNDLED_LOCAL_WRAPPER);
        assert!(valid_wrapper_file(&published));
        let manifest = fs::read_to_string(runtime.join(".runtime-integrity")).unwrap();
        let wrapper_digest = format!("{:x}", Sha256::digest(super::BUNDLED_LOCAL_WRAPPER));
        assert!(manifest.contains(&format!("jht-wrapper.sh={wrapper_digest}\n")));
        assert!(manifest.contains(&format!(
            "docker-compose.yml={}\n",
            digest(&runtime.join("docker-compose.yml"))
        )));
        assert_eq!(
            fs::metadata(&published).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert!(super::bundled_wrapper_published(&runtime, &published));

        let inherited_path = format!("{}:/usr/bin:/bin", fake_bin.display());
        // The machine's own config, as `podman machine init` writes it: the
        // wrapper reads its mounts before using the machine.
        let config_home = home.join(".config");
        let machine_config = config_home.join("containers/podman/machine/applehv/jht-podman.json");
        fs::create_dir_all(machine_config.parent().unwrap()).unwrap();
        let write_machine_config = |sources: &[String]| {
            let mounts = sources
                .iter()
                .map(|source| format!(r#"{{"Source":"{source}","Target":"{source}","Type":"virtiofs"}}"#))
                .collect::<Vec<_>>()
                .join(",");
            fs::write(&machine_config, format!(r#"{{"Mounts":[{mounts}],"Name":"jht-podman"}}"#))
                .unwrap();
        };
        let jht_sources = [
            home.join(".jht").display().to_string(),
            home.join("Documents/Job Hunter Team").display().to_string(),
        ];
        write_machine_config(&jht_sources);
        let wrapper_command = |argument: &str| {
            Command::new(&published)
                .arg(argument)
                .env("HOME", &home)
                .env("PATH", &inherited_path)
                .env("XDG_CONFIG_HOME", &config_home)
                .env("JHT_RUNTIME_DIR", &runtime)
                .env("JHT_WRAPPER_PATH", &published)
                .env_remove("JHT_PODMAN_MACHINE")
                .env_remove("CONTAINER_CONNECTION")
                .output()
                .unwrap()
        };
        let status = wrapper_command("status");
        assert_eq!(status.status.code(), Some(1));
        let snapshot = wrapper_command("onboarding-snapshot");
        assert!(snapshot.status.success());
        let snapshot = super::parse_verified_snapshot(&String::from_utf8(snapshot.stdout).unwrap())
            .expect("installed wrapper must emit the strict snapshot contract");
        assert!(snapshot.runtime_installed);
        assert!(!snapshot.container_running);

        // The default mounts of `podman machine init` on macOS: the wrapper
        // refuses the machine with the exit status the app turns into
        // podman_machine_mounts_home.
        write_machine_config(&[
            "/Users".to_owned(),
            "/private".to_owned(),
            "/var/folders".to_owned(),
        ]);
        let refused = wrapper_command("status");
        assert_eq!(refused.status.code(), Some(PODMAN_MACHINE_MOUNTS_EXIT));
        assert_eq!(
            refuse_broad_podman_machine(Ok(ProcessResult {
                code: refused.status.code().unwrap(),
                stdout: refused.stdout,
            }))
            .unwrap_err(),
            PODMAN_MACHINE_MOUNTS_HOME
        );

        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn local_runtime_prepare_container_success_failure_and_retry() {
        let mut results = VecDeque::from([true, false, true]);
        let mut calls = Vec::new();
        let mut pauses = 0;
        start_and_verify_local_container_with(
            |operation, _| {
                calls.push(operation.argv().join(" "));
                outcome(results.pop_front().unwrap())
            },
            |_| pauses += 1,
            3,
        )
        .unwrap();
        assert_eq!(calls, vec!["up", "status", "status"]);
        assert_eq!(pauses, 1);

        let mut active_calls = Vec::new();
        start_and_verify_local_container_with(
            |operation, _| {
                active_calls.push(operation.argv().join(" "));
                outcome(true)
            },
            |_| panic!("an active container must not wait"),
            3,
        )
        .unwrap();
        assert_eq!(active_calls, vec!["up", "status"]);

        let mut raced_start = VecDeque::from([Err("process_timeout"), outcome(true)]);
        start_and_verify_local_container_with(
            |_, _| raced_start.pop_front().unwrap(),
            |_| panic!("verified effect after a timed-out request must not wait"),
            2,
        )
        .unwrap();

        let timed_out =
            start_and_verify_local_container_with(|_, _| Err("process_timeout"), |_| {}, 1)
                .unwrap_err();
        assert_eq!(timed_out.code, "container_timeout");

        let mut results = VecDeque::from([true, false]);
        let not_ready = start_and_verify_local_container_with(
            |_, _| outcome(results.pop_front().unwrap()),
            |_| {},
            1,
        )
        .unwrap_err();
        assert_eq!(not_ready.code, "container_not_ready");

        let start_failed =
            start_and_verify_local_container_with(|_, _| outcome(false), |_| {}, 1).unwrap_err();
        assert_eq!(start_failed.code, "container_start_failed");
    }

    #[test]
    fn a_podman_machine_that_sees_more_of_the_mac_keeps_its_own_error() {
        let broad = || {
            refuse_broad_podman_machine(Ok(ProcessResult {
                code: PODMAN_MACHINE_MOUNTS_EXIT,
                stdout: Vec::new(),
            }))
        };
        assert_eq!(broad().unwrap_err(), PODMAN_MACHINE_MOUNTS_HOME);
        assert_eq!(refuse_broad_podman_machine(outcome(false)).unwrap().code, 1);
        assert!(refuse_broad_podman_machine(outcome(true)).unwrap().success());

        // `up` refused: no status polling, no retry offered.
        let mut calls = Vec::new();
        let error = start_and_verify_local_container_with(
            |operation, _| {
                calls.push(operation.diagnostic_id());
                broad()
            },
            |_| panic!("a refused machine must not wait"),
            3,
        )
        .unwrap_err();
        assert_eq!(calls, ["up"]);
        assert_eq!(error.code, PODMAN_MACHINE_MOUNTS_HOME);
        assert!(!error.retryable);

        // `up` answered before the check (an older wrapper), `status` refuses.
        let mut results = VecDeque::from([outcome(true), broad()]);
        let error = start_and_verify_local_container_with(
            |_, _| results.pop_front().unwrap(),
            |_| panic!("a refused machine must not wait"),
            3,
        )
        .unwrap_err();
        assert_eq!(error.code, PODMAN_MACHINE_MOUNTS_HOME);

        for error in [
            ensure_success(broad(), "team_start_failed").unwrap_err(),
            ensure_success_with_timeout(broad(), "provider_config_failed", "provider_timeout")
                .unwrap_err(),
        ] {
            assert_eq!(error.code, PODMAN_MACHINE_MOUNTS_HOME);
        }
        #[cfg(target_os = "macos")]
        assert_eq!(
            probe_installed_wrapper_with(|_, _| broad()).unwrap_err().code,
            PODMAN_MACHINE_MOUNTS_HOME
        );
        assert_eq!(
            ensure_success(Err("ssh_unavailable"), "team_start_failed")
                .unwrap_err()
                .code,
            "team_start_failed"
        );
    }

    #[test]
    fn recreating_the_podman_machine_runs_the_confirmed_wrapper_command_once() {
        let mut calls = Vec::new();
        recreate_podman_machine_with(|operation, timeout| {
            calls.push((operation.argv(), timeout));
            outcome(true)
        })
        .unwrap();
        assert_eq!(
            calls,
            [(vec!["podman-machine-recreate", "--confirm"], PREPARE_TIMEOUT)]
        );

        let failed = recreate_podman_machine_with(|_, _| outcome(false)).unwrap_err();
        assert_eq!(failed.code, "podman_machine_recreate_failed");
        assert!(failed.retryable);
        let timed_out = recreate_podman_machine_with(|_, _| Err("process_timeout")).unwrap_err();
        assert_eq!(timed_out.code, "timeout");
        let missing = recreate_podman_machine_with(|_, _| Err("runtime_missing")).unwrap_err();
        assert_eq!(missing.code, "podman_machine_recreate_failed");
        // Recreated but still broad (the wrapper checks it again at the end).
        let still_broad = recreate_podman_machine_with(|_, _| Err(PODMAN_MACHINE_MOUNTS_HOME))
            .unwrap_err();
        assert_eq!(still_broad.code, PODMAN_MACHINE_MOUNTS_HOME);
    }

    #[test]
    fn local_onboarding_uses_the_authoritative_cli_dispatcher_contract() {
        let operations = [
            (LocalCliOperation::Up, vec!["up"]),
            (LocalCliOperation::Status, vec!["status"]),
            (
                LocalCliOperation::ProviderUse(SubscriptionProvider::Codex),
                vec!["providers", "use", "codex"],
            ),
            (
                LocalCliOperation::ProviderUpdate(SubscriptionProvider::Claude),
                vec!["providers", "update", "claude"],
            ),
            (
                LocalCliOperation::ProviderCurrent,
                vec!["providers", "current"],
            ),
            (LocalCliOperation::OauthLogin, vec!["oauth-login"]),
            (LocalCliOperation::TeamStart, vec!["team", "start"]),
            (LocalCliOperation::Snapshot, vec!["onboarding-snapshot"]),
            (
                LocalCliOperation::AssistantStart,
                vec!["team", "start", "assistente"],
            ),
            (
                LocalCliOperation::ProviderLimits,
                vec!["providers", "limits", "--json"],
            ),
            (
                LocalCliOperation::PodmanMachineRecreate,
                vec!["podman-machine-recreate", "--confirm"],
            ),
        ];
        for (operation, expected) in operations {
            assert_eq!(operation.argv(), expected);
        }
    }

    #[test]
    fn start_limits_read_the_provider_verdict_and_never_block_on_doubt() {
        let now = 1_900_000_000;
        assert_eq!(
            parse_start_limits(
                r#"{"status":"ok","resets_at":null,"five_hour":{"used_pct":40,"resets_at":1900003600},"weekly":null}"#,
                now,
            ),
            StartLimits::Sufficient
        );
        assert_eq!(
            parse_start_limits(
                &format!(
                    r#"{{"status":"exhausted","resets_at":{},"five_hour":null,"weekly":null}}"#,
                    now + 1800
                ),
                now,
            ),
            StartLimits::Exhausted {
                resets_at: now + 1800
            }
        );
        for doubtful in [
            r#"{"status":"unknown","resets_at":null,"five_hour":null,"weekly":null}"#.to_string(),
            // Exhausted without a time, or with a time already gone.
            r#"{"status":"exhausted","resets_at":null}"#.to_string(),
            format!(r#"{{"status":"exhausted","resets_at":{}}}"#, now - 1),
            r#"{"status":"maybe","resets_at":null}"#.to_string(),
            "not json".to_string(),
            String::new(),
        ] {
            assert_eq!(
                parse_start_limits(&doubtful, now),
                StartLimits::Unverified,
                "{doubtful}"
            );
        }
    }

    #[test]
    fn exhausted_limits_stop_the_start_with_the_time_they_free() {
        let blocked = start_limits_gate(StartLimits::Exhausted {
            resets_at: 1_900_001_800,
        })
        .unwrap_err();
        assert_eq!(blocked.code, "provider_limits_exhausted");
        assert!(blocked.retryable);
        let json = serde_json::to_value(&blocked).unwrap();
        assert_eq!(json["resetsAt"], 1_900_001_800);

        assert_eq!(
            start_limits_gate(StartLimits::Sufficient).unwrap(),
            StartLimits::Sufficient
        );
        assert_eq!(
            start_limits_gate(StartLimits::Unverified).unwrap(),
            StartLimits::Unverified
        );
        // Any other error keeps its old shape: no resetsAt key at all.
        let other = serde_json::to_value(failure("team_start_failed")).unwrap();
        assert!(other.get("resetsAt").is_none());
    }

    #[test]
    fn a_started_team_says_whether_its_limits_were_verified() {
        let verified = with_start_limits(
            super::OnboardingSnapshot::default(),
            StartLimits::Sufficient,
        );
        assert_eq!(
            serde_json::to_value(&verified).unwrap()["limitsVerified"],
            true
        );
        let unverified = with_start_limits(
            super::OnboardingSnapshot::default(),
            StartLimits::Unverified,
        );
        assert_eq!(
            serde_json::to_value(&unverified).unwrap()["limitsVerified"],
            false
        );
        // Every other snapshot keeps its old shape.
        let plain = serde_json::to_value(super::OnboardingSnapshot::default()).unwrap();
        assert!(plain.get("limitsVerified").is_none());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finder_path_is_augmented_without_shell_concatenation() {
        use std::{ffi::OsString, path::Path};

        let (program, args) = local_wrapper_command(
            Path::new("/private/example/jht"),
            &["providers", "use", "codex"],
            Some(OsString::from("/usr/bin:/bin:/opt/homebrew/bin")),
        )
        .unwrap();
        assert_eq!(program, Path::new("/usr/bin/env"));
        let path = args[0].to_string_lossy();
        assert!(
            path.starts_with("PATH=/opt/homebrew/bin:/usr/local/bin:/opt/podman/bin:/usr/bin:/bin")
        );
        assert_eq!(path.matches("/opt/homebrew/bin").count(), 1);
        assert_eq!(args[1], OsString::from("/private/example/jht"));
        assert_eq!(args[2..], ["providers", "use", "codex"].map(OsString::from));
    }

    #[cfg(unix)]
    #[test]
    fn wrapper_must_be_regular_executable_and_have_runtime_protocol() {
        use std::{
            fs,
            os::unix::fs::{symlink, PermissionsExt},
            time::{SystemTime, UNIX_EPOCH},
        };

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("jht-wrapper-validation-{nonce}"));
        fs::create_dir_all(&dir).unwrap();
        let wrapper = dir.join("jht");
        fs::write(
            &wrapper,
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\n",
        )
        .unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(valid_wrapper_file(&wrapper));

        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(!valid_wrapper_file(&wrapper));
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        fs::write(&wrapper, "#!/bin/sh\n").unwrap();
        assert!(!valid_wrapper_file(&wrapper));

        fs::write(
            &wrapper,
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\n",
        )
        .unwrap();
        let link = dir.join("jht-link");
        symlink(&wrapper, &link).unwrap();
        assert!(!valid_wrapper_file(&link));
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn frontend_prepare_payload_has_no_profile_or_account_email() {
        let submission: OnboardingSubmission = serde_json::from_value(serde_json::json!({
            "host": {"kind": "local"},
            "provider": "codex"
        }))
        .unwrap();
        assert!(matches!(
            submission.provider,
            super::SubscriptionProvider::Codex
        ));

        let rejected = serde_json::from_value::<OnboardingSubmission>(serde_json::json!({
            "profile": {"fullName": "not accepted"},
            "host": {"kind": "local"},
            "provider": "codex"
        }));
        assert!(rejected.is_err());
    }

    #[test]
    fn existing_team_request_is_opaque_vps_only_data() {
        let request: ExistingTeamConnectRequest = serde_json::from_value(serde_json::json!({
            "teamId": "00000000-0000-4000-8000-000000000001",
            "host": {
                "kind": "vps",
                "address": "vps.example.invalid",
                "user": "deploy",
                "port": 22,
                "keyPath": "/tmp/synthetic-key"
            }
        }))
        .unwrap();
        assert_eq!(request.team_id, "00000000-0000-4000-8000-000000000001");
        assert!(matches!(
            request.host,
            crate::runtime_host::ExecutionHost::Vps { .. }
        ));
    }

    #[test]
    fn existing_team_probe_is_read_only_and_requires_identity_and_live_sessions() {
        for forbidden in [
            "jht up",
            "team start",
            "docker start",
            "docker restart",
            "docker compose",
            "install",
            "update",
            "oauth-login",
            "pairing",
            "curl ",
        ] {
            assert!(
                !REMOTE_EXISTING_TEAM_PROBE.contains(forbidden),
                "mutating command in attach probe: {forbidden}"
            );
        }
        assert!(REMOTE_EXISTING_TEAM_PROBE.contains("\"$JHT_BIN\" status"));
        assert!(REMOTE_EXISTING_TEAM_PROBE.contains("docker exec jht node"));
        assert!(REMOTE_EXISTING_TEAM_PROBE.contains("tmux has-session -t CAPITANO"));
        assert!(REMOTE_EXISTING_TEAM_PROBE.contains("tmux has-session -t ASSISTENTE"));

        let team_id = "00000000-0000-4000-8000-000000000001";
        let active = existing_team_probe_with(team_id, |input| {
            assert_eq!(input, format!("{team_id}\n").as_bytes());
            Ok(ProcessResult {
                code: 0,
                stdout: b"runtimeInstalled=1\ncontainerRunning=1\nproviderConfigured=1\nproviderAuthenticated=1\ncaptainRunning=1\nassistantRunning=1\nprofileReady=0\nassistantWelcomed=0\n".to_vec(),
            })
        })
        .unwrap();
        assert!(active.container_running && active.captain_running && active.assistant_running);
        assert!(!active.profile_ready && !active.assistant_welcomed);

        let mismatch = existing_team_probe_with(team_id, |_| {
            outcome(false).map(|mut result| {
                result.code = 72;
                result
            })
        })
        .unwrap_err();
        assert_eq!(mismatch.code, "existing_team_identity_mismatch");

        let inactive = existing_team_probe_with(team_id, |_| {
            outcome(false).map(|mut result| {
                result.code = 73;
                result
            })
        })
        .unwrap_err();
        assert_eq!(inactive.code, "existing_team_not_active");

        let offline =
            existing_team_probe_with(team_id, |_| Err("process_start_failed")).unwrap_err();
        assert_eq!(offline.code, "existing_team_unavailable");
        assert!(serde_json::to_string(&offline)
            .unwrap()
            .contains("\"retryable\":true"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn fake_wrapper_integration_has_no_real_runtime_side_effects() {
        use std::{
            fs,
            os::unix::fs::PermissionsExt,
            time::{SystemTime, UNIX_EPOCH},
        };

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("jht-local-runtime-test-{nonce}"));
        fs::create_dir_all(&dir).unwrap();
        let wrapper = dir.join("jht");
        fs::write(
            &wrapper,
            r#"#!/bin/sh
JHT_HOST_RUNTIME_PROTOCOL=1
JHT_DESKTOP_CHAT_PROTOCOL=1
JHT_ONBOARDING_SNAPSHOT_PROTOCOL=1
state="$(dirname "$0")/container-ready"
case "$1" in
  up) : > "$state" ;;
  status) [ -f "$state" ] ;;
  *) exit 9 ;;
esac
"#,
        )
        .unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        super::start_and_verify_local_container(&wrapper).unwrap();
        assert!(dir.join("container-ready").is_file());
        fs::remove_dir_all(dir).unwrap();
    }

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

    #[cfg(unix)]
    #[test]
    fn remote_snapshot_uses_only_the_capability_gated_read_only_command() {
        use std::{
            fs,
            os::unix::fs::PermissionsExt,
            process::Command,
            time::{SystemTime, UNIX_EPOCH},
        };

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-snapshot-probe-{nonce}"));
        let bin = root.join("bin");
        let home = root.join("home");
        let marker = root.join("mutated");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&home).unwrap();
        let jht = bin.join("jht");
        fs::write(
            &jht,
            r#"#!/bin/sh
JHT_ONBOARDING_SNAPSHOT_PROTOCOL=1
if [ "$1" = onboarding-snapshot ]; then
  printf '%s\n' runtimeInstalled=1 containerRunning=0 providerConfigured=0 providerAuthenticated=0 assistantWelcomed=0 assistantRunning=0 captainRunning=0 profileReady=0
  exit 0
fi
: > "$JHT_MUTATION_MARKER"
exit 0
"#,
        )
        .unwrap();
        fs::set_permissions(&jht, fs::Permissions::from_mode(0o700)).unwrap();

        let result = Command::new("/bin/sh")
            .arg("-c")
            .arg(REMOTE_SNAPSHOT)
            .env("HOME", &home)
            .env("PATH", format!("{}:/usr/bin:/bin", bin.display()))
            .env("JHT_MUTATION_MARKER", &marker)
            .output()
            .unwrap();

        assert!(result.status.success());
        assert!(!marker.exists());
        let snapshot = parse_snapshot(&String::from_utf8(result.stdout).unwrap());
        assert!(snapshot.runtime_installed);
        assert!(!snapshot.container_running);
        assert!(!snapshot.provider_configured);
        assert!(!snapshot.provider_authenticated);
        assert!(!snapshot.assistant_running);
        assert!(!snapshot.captain_running);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resume_team_start_requires_the_first_real_prerequisite_only() {
        let mut snapshot = super::OnboardingSnapshot {
            runtime_installed: true,
            container_running: true,
            provider_configured: true,
            provider_authenticated: true,
            assistant_running: false,
            captain_running: false,
            profile_ready: false,
            assistant_welcomed: false,
            direct_chat_ready: false,
            limits_verified: None,
        };
        assert!(resume_team_prerequisite(&snapshot).is_ok());

        snapshot.runtime_installed = false;
        assert_eq!(
            resume_team_prerequisite(&snapshot).unwrap_err().code,
            "resume_runtime_not_ready"
        );
        snapshot.runtime_installed = true;
        snapshot.container_running = false;
        assert_eq!(
            resume_team_prerequisite(&snapshot).unwrap_err().code,
            "resume_container_not_ready"
        );
        snapshot.container_running = true;
        snapshot.provider_configured = false;
        assert_eq!(
            resume_team_prerequisite(&snapshot).unwrap_err().code,
            "resume_provider_not_configured"
        );
        snapshot.provider_configured = true;
        snapshot.provider_authenticated = false;
        assert_eq!(
            resume_team_prerequisite(&snapshot).unwrap_err().code,
            "resume_provider_not_authenticated"
        );

        for code in [
            "resume_runtime_not_ready",
            "resume_container_not_ready",
            "resume_provider_not_configured",
            "resume_provider_not_authenticated",
            "host_not_configured",
            "host_config_invalid",
        ] {
            let error = failure(code);
            assert!(!error.retryable);
            assert_ne!(error.message, "L’operazione non è riuscita. Riprova.");
        }
        assert!(failure("team_start_failed").retryable);
        assert!(failure("team_verify_failed").retryable);
    }

    #[test]
    fn assistant_open_does_not_wait_for_the_conversational_profile() {
        let snapshot = super::OnboardingSnapshot {
            assistant_running: true,
            profile_ready: false,
            assistant_welcomed: false,
            ..Default::default()
        };
        assert!(assistant_reached(&snapshot));
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
    fn provider_credentials_and_terminal_controls_are_removed_across_chunks() {
        let mut redactor = StreamRedactor::default();
        let mut output = redactor.push("api_ke");
        output.push_str(&redactor.push("y=synthetic-kimi-secret client_sec"));
        output.push_str(&redactor.push("ret=synthetic-client password=synthetic-pass session_to"));
        output.push_str(
            &redactor.push("ken=synthetic-session\nvisible\ttext\r\u{8}\u{1b}[31m\u{85}"),
        );
        output.push_str(&redactor.finish());

        for secret in [
            "synthetic-kimi-secret",
            "synthetic-client",
            "synthetic-pass",
            "synthetic-session",
        ] {
            assert!(!output.contains(secret));
        }
        assert!(output.contains("visible\ttext"));
        assert!(!output
            .chars()
            .any(|character| { character.is_control() && !matches!(character, '\n' | '\t') }));
    }

    #[test]
    fn provider_login_input_accepts_one_printable_line_only() {
        assert!(valid_provider_login_input("ABCD-EFGH"));
        assert!(valid_provider_login_input("yes please"));
        assert!(valid_provider_login_input(""));
        for invalid in [
            "ok\n/second",
            "ok\r/second",
            "ok\tsecond",
            "ok\u{1b}[31m",
            "ok\u{8}second",
            "ok\u{85}second",
            "ok\u{2028}second",
        ] {
            assert!(!valid_provider_login_input(invalid), "accepted {invalid:?}");
        }
        assert!(!valid_provider_login_input(&"x".repeat(4097)));
    }

    #[test]
    fn provider_takeover_states_are_discriminated_and_provider_scoped() {
        let cases = [
            (
                SubscriptionProvider::Claude,
                "Open https://console.anthropic.com/oauth and paste code ABCD-1234",
                vec!["url", "code", "input"],
            ),
            (
                SubscriptionProvider::Codex,
                "Open https://auth.openai.com/codex/device and enter code WXYZ-98765",
                vec!["device"],
            ),
            (
                SubscriptionProvider::Kimi,
                "Open https://auth.kimi.com/device and paste authorization code",
                vec!["url", "input"],
            ),
        ];

        for (provider, text, expected_kinds) in cases {
            let events = InteractiveStateDetector::new(provider).push(text);
            let values = events
                .iter()
                .map(|event| serde_json::to_value(event).unwrap())
                .collect::<Vec<_>>();
            assert_eq!(
                values
                    .iter()
                    .map(|value| value["action"]["kind"].as_str().unwrap())
                    .collect::<Vec<_>>(),
                expected_kinds
            );
            for value in values {
                assert_eq!(value["kind"], "state");
                assert_eq!(value["status"], "needs_user_action");
                match value["action"]["kind"].as_str().unwrap() {
                    "device" => {
                        assert_eq!(
                            value["action"]["safeUrl"],
                            "https://auth.openai.com/codex/device"
                        );
                        assert_eq!(value["action"]["userCode"], "WXYZ-98765");
                        assert_eq!(value["action"]["requestId"], "codex-device-1");
                        assert!(value["action"].get("inputRequest").is_none());
                    }
                    "url" => {
                        assert!(value["action"]["safeUrl"]
                            .as_str()
                            .unwrap()
                            .starts_with("https://"));
                        assert!(value["action"].get("userCode").is_none());
                        assert!(value["action"].get("inputRequest").is_none());
                    }
                    "code" => {
                        assert!(value["action"]["userCode"].is_string());
                        assert!(value["action"].get("safeUrl").is_none());
                        assert!(value["action"].get("inputRequest").is_none());
                    }
                    "input" => {
                        assert!(value["action"]["inputRequest"]["id"].is_string());
                        assert!(value["action"].get("safeUrl").is_none());
                        assert!(value["action"].get("userCode").is_none());
                    }
                    kind => panic!("unexpected action kind {kind}"),
                }
            }
        }
    }

    #[test]
    fn provider_takeover_rejects_untrusted_urls_and_secret_bearing_state() {
        for provider in [
            SubscriptionProvider::Claude,
            SubscriptionProvider::Codex,
            SubscriptionProvider::Kimi,
        ] {
            for text in [
                "Open http://auth.openai.com/device",
                "Open https://evil.invalid/device",
                "Open https://auth.openai.com/device?access_token=synthetic-secret",
                "Open https://console.anthropic.com/device?client_secret=synthetic-secret",
                "Open https://auth.kimi.com/device?session_token=synthetic-secret",
            ] {
                assert!(
                    InteractiveStateDetector::new(provider)
                        .push(text)
                        .is_empty(),
                    "provider {provider:?} accepted {text:?}"
                );
            }
        }
    }

    #[test]
    fn codex_device_state_strips_chunked_csi_osc_and_keeps_url_and_code_together() {
        let chunks = [
            "\u{1b}]8;;https://evil.invalid/device",
            "\u{1b}",
            "\\Open \u{1b}[",
            "36mhttps://AUTH.OPENAI.COM/codex/device\u{1b}[0",
            "m and enter\r code \u{8}\u{1b}[1mQ7KM",
            "-2P9RX\u{1b}",
            "[0m\n",
        ];
        let mut redactor = StreamRedactor::default();
        let mut detector = InteractiveStateDetector::new(SubscriptionProvider::Codex);
        let mut visible = String::new();
        let mut events = Vec::new();
        for chunk in chunks {
            let text = redactor.push(chunk);
            visible.push_str(&text);
            events.extend(detector.push(&text));
        }
        let tail = redactor.finish();
        visible.push_str(&tail);
        events.extend(detector.push(&tail));

        assert_eq!(events.len(), 1);
        let value = serde_json::to_value(&events[0]).unwrap();
        assert_eq!(value["kind"], "state");
        assert_eq!(value["status"], "needs_user_action");
        assert_eq!(value["action"]["kind"], "device");
        assert_eq!(value["action"]["requestId"], "codex-device-1");
        assert_eq!(
            value["action"]["safeUrl"],
            "https://auth.openai.com/codex/device"
        );
        assert_eq!(value["action"]["userCode"], "Q7KM-2P9RX");
        assert!(!visible.contains('\u{1b}'));
        assert!(!visible.contains("[0m"));
        assert!(!visible.contains("evil.invalid"));

        let mut literal_redactor = StreamRedactor::default();
        let mut literal_detector = InteractiveStateDetector::new(SubscriptionProvider::Codex);
        let mut literal_visible = String::new();
        let mut literal_events = Vec::new();
        for chunk in [
            "Open https://auth.openai.com/codex/device[",
            "0m and enter code Q7KM",
            "-2P9RX[0",
            "m\n",
        ] {
            let text = literal_redactor.push(chunk);
            literal_visible.push_str(&text);
            literal_events.extend(literal_detector.push(&text));
        }
        let tail = literal_redactor.finish();
        literal_visible.push_str(&tail);
        literal_events.extend(literal_detector.push(&tail));
        assert_eq!(literal_events.len(), 1);
        let literal = serde_json::to_value(&literal_events[0]).unwrap();
        assert_eq!(
            literal["action"]["safeUrl"],
            "https://auth.openai.com/codex/device"
        );
        assert_eq!(literal["action"]["userCode"], "Q7KM-2P9RX");
        assert!(!literal_visible.contains("[0m"));

        let rejected = InteractiveStateDetector::new(SubscriptionProvider::Codex)
            .push("Open https://auth.openai.com/codex/device/other and enter code Q7KM-2P9RX\n");
        assert_eq!(rejected.len(), 1);
        assert_eq!(
            serde_json::to_value(&rejected[0]).unwrap(),
            serde_json::json!({
                "kind": "failure",
                "code": "provider_action_invalid"
            })
        );
    }

    #[test]
    fn provider_input_requires_one_matching_pending_request_and_consumes_it() {
        let pending = Mutex::new(None);
        let mut written = Vec::new();
        assert_eq!(
            write_provider_input(&pending, &mut written, "claude-response-1", "answer")
                .unwrap_err()
                .code,
            "provider_input_not_requested"
        );
        assert!(written.is_empty());

        *pending.lock().unwrap() = Some("claude-response-1".into());
        assert_eq!(
            write_provider_input(&pending, &mut written, "stale-response-1", "answer")
                .unwrap_err()
                .code,
            "provider_input_not_requested"
        );
        assert!(written.is_empty());
        assert_eq!(
            pending.lock().unwrap().as_deref(),
            Some("claude-response-1")
        );

        write_provider_input(&pending, &mut written, "claude-response-1", "answer").unwrap();
        assert_eq!(written, b"answer\n");
        assert!(pending.lock().unwrap().is_none());

        assert_eq!(
            write_provider_input(&pending, &mut written, "claude-response-1", "second")
                .unwrap_err()
                .code,
            "provider_input_not_requested"
        );
        assert_eq!(written, b"answer\n");
    }

    #[test]
    fn provider_input_rejects_invalid_request_or_control_text_without_writing() {
        for (request_id, input) in [
            ("", "answer"),
            ("bad/request", "answer"),
            ("kimi-response-1", "first\nsecond"),
            ("kimi-response-1", "escape\u{1b}"),
        ] {
            let pending = Mutex::new(Some("kimi-response-1".into()));
            let mut written = Vec::new();
            assert_eq!(
                write_provider_input(&pending, &mut written, request_id, input)
                    .unwrap_err()
                    .code,
                "invalid_input"
            );
            assert!(written.is_empty());
            assert_eq!(pending.lock().unwrap().as_deref(), Some("kimi-response-1"));
        }
        assert!(valid_interactive_request_id("codex-response_1.next"));
        assert!(!valid_interactive_request_id("-leading"));
    }

    #[test]
    fn provider_login_bootstrap_is_backend_owned() {
        assert_eq!(
            provider_bootstrap_input(SubscriptionProvider::Claude),
            Some(b"/login\n".as_slice())
        );
        assert_eq!(
            provider_bootstrap_input(SubscriptionProvider::Kimi),
            Some(b"/login\n".as_slice())
        );
        assert_eq!(provider_bootstrap_input(SubscriptionProvider::Codex), None);
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

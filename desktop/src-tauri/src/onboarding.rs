use crate::account_scope::{AccountScope, AccountScopeState};
use crate::runtime_host::{
    run_program, run_ssh, set_private_permissions, ssh_base_args, validate_host, ExecutionHost,
    ProcessResult, ValidatedHost,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs,
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

#[cfg(target_os = "macos")]
use std::fs::OpenOptions;

const INSTALL_URL: &str = "https://jobhunterteam.ai/install.sh";
const INSTALL_SHA256: &str = include_str!("../installer.sha256");
const MAX_INSTALLER_BYTES: usize = 2 * 1024 * 1024;
const MAX_WRAPPER_BYTES: u64 = 2 * 1024 * 1024;
const PREPARE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(8 * 60);
const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(25);
const LOCAL_RUNTIME_TIMEOUT: Duration = Duration::from_secs(2 * 60);
const LOCAL_RUNTIME_VERIFY_ATTEMPTS: usize = 8;
const LOCAL_RUNTIME_VERIFY_INTERVAL: Duration = Duration::from_secs(2);
const LOCAL_CONTAINER_VERIFY_TIMEOUT: Duration = Duration::from_secs(10);
const LOCAL_CONTAINER_VERIFY_ATTEMPTS: usize = 6;
const LOCAL_CONTAINER_VERIFY_INTERVAL: Duration = Duration::from_secs(2);
const PROGRESS_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(2);
const PODMAN_MACHINE_NAME: &str = "jht-podman";
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
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SubscriptionProvider {
    Claude,
    Codex,
    Kimi,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum OnboardingProgressStatus {
    Start,
    Progress,
    Done,
    Error,
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
#[serde(rename_all = "camelCase")]
pub(crate) struct OnboardingError {
    pub(crate) code: &'static str,
    message: &'static str,
    retryable: bool,
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
        code if code.starts_with("invalid_") => ("I dati ricevuti non sono validi.", false),
        _ => ("L’operazione non è riuscita. Riprova.", true),
    };
    OnboardingError {
        code,
        message,
        retryable,
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
fn publish_bundled_wrapper(home: &Path, runtime_dir: &Path) -> Result<PathBuf, OnboardingError> {
    use std::os::unix::{fs::OpenOptionsExt, fs::PermissionsExt};

    let source = std::str::from_utf8(BUNDLED_LOCAL_WRAPPER)
        .map_err(|_| failure("runtime_wrapper_install_failed"))?;
    if !wrapper_has_protocol(source, "JHT_HOST_RUNTIME_PROTOCOL=1")
        || !wrapper_has_protocol(source, "JHT_DESKTOP_CHAT_PROTOCOL=1")
    {
        return Err(failure("runtime_wrapper_install_failed"));
    }

    let local_dir = home.join(".local");
    let bin_dir = local_dir.join("bin");
    for directory in [&local_dir, &bin_dir] {
        match fs::symlink_metadata(directory) {
            Ok(metadata) if metadata.file_type().is_dir() => {}
            Ok(_) => return Err(failure("runtime_wrapper_install_failed")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(directory).map_err(|_| failure("runtime_wrapper_install_failed"))?;
            }
            Err(_) => return Err(failure("runtime_wrapper_install_failed")),
        }
    }

    let target = bin_dir.join("jht");
    if fs::symlink_metadata(&target).is_ok_and(|metadata| !metadata.file_type().is_file()) {
        return Err(failure("runtime_wrapper_install_failed"));
    }
    if !fs::symlink_metadata(runtime_dir).is_ok_and(|metadata| metadata.file_type().is_dir()) {
        return Err(failure("runtime_wrapper_install_failed"));
    }
    let manifest = runtime_dir.join(".runtime-integrity");
    let manifest_metadata =
        fs::symlink_metadata(&manifest).map_err(|_| failure("runtime_wrapper_install_failed"))?;
    if !manifest_metadata.file_type().is_file() || manifest_metadata.len() > 64 * 1024 {
        return Err(failure("runtime_wrapper_install_failed"));
    }
    let current_manifest =
        fs::read_to_string(&manifest).map_err(|_| failure("runtime_wrapper_install_failed"))?;
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
        return Err(failure("runtime_wrapper_install_failed"));
    }

    let nonce = SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = bin_dir.join(format!(".jht-desktop-{}-{}", std::process::id(), nonce));
    let manifest_temporary = runtime_dir.join(format!(
        ".integrity-desktop-{}-{}",
        std::process::id(),
        nonce
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o700)
            .open(&temporary)
            .map_err(|_| failure("runtime_wrapper_install_failed"))?;
        file.write_all(BUNDLED_LOCAL_WRAPPER)
            .and_then(|_| file.sync_all())
            .map_err(|_| failure("runtime_wrapper_install_failed"))?;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o700))
            .map_err(|_| failure("runtime_wrapper_install_failed"))?;
        let mut manifest_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&manifest_temporary)
            .map_err(|_| failure("runtime_wrapper_install_failed"))?;
        manifest_file
            .write_all(updated_manifest.as_bytes())
            .and_then(|_| manifest_file.sync_all())
            .map_err(|_| failure("runtime_wrapper_install_failed"))?;
        fs::set_permissions(&manifest_temporary, fs::Permissions::from_mode(0o600))
            .map_err(|_| failure("runtime_wrapper_install_failed"))?;
        fs::rename(&manifest_temporary, &manifest)
            .map_err(|_| failure("runtime_wrapper_install_failed"))?;
        fs::rename(&temporary, &target).map_err(|_| failure("runtime_wrapper_install_failed"))?;
        if !valid_wrapper_file(&target) {
            return Err(failure("runtime_wrapper_install_failed"));
        }
        Ok(target.clone())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
        let _ = fs::remove_file(&manifest_temporary);
    }
    result
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

fn install_local(app: &tauri::AppHandle) -> Result<PathBuf, OnboardingError> {
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
            let podman = podman_path().ok_or_else(|| failure("podman_missing"))?;
            ensure_local_podman(&podman)?;
            if !podman_runtime_selected(app) {
                return Err(failure("podman_not_ready"));
            }
            if wrapper_path(app).is_none() {
                let home = app
                    .path()
                    .home_dir()
                    .map_err(|_| failure("runtime_wrapper_install_failed"))?;
                let runtime_dir = local_runtime_dir(app)?;
                publish_bundled_wrapper(&home, &runtime_dir)?;
            }
        }
        #[cfg(not(target_os = "macos"))]
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

#[cfg(target_os = "macos")]
fn ensure_local_podman(podman: &Path) -> Result<(), OnboardingError> {
    let program = podman.to_str().ok_or_else(|| failure("podman_missing"))?;
    ensure_local_podman_with(|args, timeout| run_program(program, args, None, timeout))
}

#[cfg(target_os = "macos")]
fn ensure_local_podman_with(
    run: impl FnMut(&[&str], Duration) -> Result<ProcessResult, &'static str>,
) -> Result<(), OnboardingError> {
    ensure_local_podman_with_retry(run, thread::sleep, LOCAL_RUNTIME_VERIFY_ATTEMPTS)
}

#[cfg(target_os = "macos")]
fn ensure_local_podman_with_retry(
    mut run: impl FnMut(&[&str], Duration) -> Result<ProcessResult, &'static str>,
    mut pause: impl FnMut(Duration),
    attempts: usize,
) -> Result<(), OnboardingError> {
    let info = ["--connection", PODMAN_MACHINE_NAME, "info"];
    match run(&info, LOCAL_RUNTIME_TIMEOUT) {
        Ok(result) if result.success() => {
            trace_local_runtime("runtime", "podman_ready");
            return Ok(());
        }
        Err("process_timeout") => return Err(failure("timeout")),
        _ => {}
    }

    let inspect = ["machine", "inspect", PODMAN_MACHINE_NAME];
    let exists = match run(&inspect, LOCAL_RUNTIME_TIMEOUT) {
        Ok(result) => result.success(),
        Err("process_timeout") => return Err(failure("timeout")),
        Err(_) => false,
    };
    let action = if exists {
        vec![
            "machine",
            "start",
            "--update-connection=false",
            PODMAN_MACHINE_NAME,
        ]
    } else {
        vec![
            "machine",
            "init",
            "--now",
            "--update-connection=false",
            PODMAN_MACHINE_NAME,
        ]
    };
    match run(&action, LOCAL_RUNTIME_TIMEOUT) {
        Ok(result) if result.success() => {}
        Err("process_timeout") => return Err(failure("timeout")),
        _ => {
            // `machine start` can race another starter and report failure even
            // though the requested effect is already true. Verify once before
            // returning the sanitized start error.
            return match run(&info, LOCAL_RUNTIME_TIMEOUT) {
                Ok(result) if result.success() => Ok(()),
                Err("process_timeout") => Err(failure("timeout")),
                _ => {
                    trace_local_runtime("runtime", "podman_start_failed");
                    Err(failure("podman_start_failed"))
                }
            };
        }
    }
    for attempt in 0..attempts.max(1) {
        match run(&info, LOCAL_RUNTIME_TIMEOUT) {
            Ok(result) if result.success() => {
                trace_local_runtime("runtime", "podman_ready");
                return Ok(());
            }
            Err("process_timeout") => return Err(failure("timeout")),
            _ => {}
        }
        if attempt + 1 < attempts.max(1) {
            pause(LOCAL_RUNTIME_VERIFY_INTERVAL);
        }
    }
    trace_local_runtime("runtime", "podman_not_ready");
    Err(failure("podman_not_ready"))
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
const REMOTE_TEAM_START: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" team start"#;
const REMOTE_ASSISTANT_START: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" team start assistente"#;
const REMOTE_OAUTH_LOGIN: &str = r#"set -eu; JHT_BIN="$(command -v jht 2>/dev/null || true)"; [ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"; exec "$JHT_BIN" oauth-login"#;

fn ensure_success(
    result: Result<ProcessResult, &'static str>,
    code: &'static str,
) -> Result<(), OnboardingError> {
    match result {
        Ok(value) if value.success() => Ok(()),
        Err("process_timeout") => Err(failure("timeout")),
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
    run_verified_local_wrapper(wrapper, args, None, timeout)
}

fn run_scoped_local(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    wrapper: &Path,
    args: &[&str],
    timeout: Duration,
) -> Result<ProcessResult, &'static str> {
    crate::account_scope::validate_local_runtime(app, scope)?;
    run_local(wrapper, args, timeout)
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
        |args, timeout| run_local(wrapper, args, timeout),
        thread::sleep,
        LOCAL_CONTAINER_VERIFY_ATTEMPTS,
    )
}

fn start_and_verify_local_container_with(
    mut run: impl FnMut(&[&str], Duration) -> Result<ProcessResult, &'static str>,
    mut pause: impl FnMut(Duration),
    attempts: usize,
) -> Result<(), OnboardingError> {
    let requested = match run(&["up"], PREPARE_TIMEOUT) {
        Ok(result) if result.success() => Ok(()),
        Err("process_timeout") => Err("container_timeout"),
        _ => Err("container_start_failed"),
    };

    for attempt in 0..attempts.max(1) {
        match run(&["status"], LOCAL_CONTAINER_VERIFY_TIMEOUT) {
            Ok(result) if result.success() => {
                trace_local_runtime("container", "ready");
                return Ok(());
            }
            Err("process_timeout") => return Err(failure("container_timeout")),
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
    let reporter = ProgressReporter::new(channel);
    let mut pairing = pairing_token.map(Zeroizing::new);
    let (validated, wrapper) = reporter.run(
        OnboardingProgressStage::Engine,
        "Verifico il motore container",
        "Preparazione del motore container in corso",
        "Motore container verificato",
        || {
            let validated = validate_host(&app, &submission.host).map_err(failure)?;
            let wrapper = match &validated {
                ValidatedHost::Local => Some(install_local(&app)?),
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
                start_and_verify_local_container_with(
                    |args, timeout| run_scoped_local(&app, &scope, wrapper, args, timeout),
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
            let snapshot = snapshot_impl(&app, &scope, &validated)?;
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
                    let use_id = match submission.provider {
                        SubscriptionProvider::Claude => "claude",
                        SubscriptionProvider::Codex => "codex",
                        SubscriptionProvider::Kimi => "kimi",
                    };
                    ensure_success_with_timeout(
                        run_scoped_local(
                            &app,
                            &scope,
                            wrapper,
                            &["providers", "use", use_id],
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
                            &["providers", "update", use_id],
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
            crate::account_scope::validate_local_runtime(app, scope).map_err(failure)?;
            let Some(wrapper) = wrapper_path(app) else {
                return Ok(OnboardingSnapshot::default());
            };
            let container = run_scoped_local(app, scope, &wrapper, &["status"], SNAPSHOT_TIMEOUT)
                .is_ok_and(|r| r.success());
            let team = if container {
                run_scoped_local(app, scope, &wrapper, &["team", "status"], SNAPSHOT_TIMEOUT)
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
        Ok::<_, OnboardingError>((child, stdin, stdout, stderr, id))
    })();
    let (child, stdin, stdout, stderr, id) = match setup {
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
    stream_reader(stdout, on_event.clone());
    stream_reader(stderr, on_event.clone());
    let waiter = Arc::clone(&child);
    let exit_channel = on_event.clone();
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
    });
    Ok(InteractiveStart { session_id: id })
}

#[tauri::command]
pub(crate) fn onboarding_provider_login_input(
    state: State<'_, OnboardingNativeState>,
    scopes: State<'_, AccountScopeState>,
    session_id: String,
    input: String,
) -> Result<(), OnboardingError> {
    let scope = scopes.lock_active().map_err(failure)?;
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
        .filter(|value| value.id == session_id && &value.scope == scope.scope())
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
                run_scoped_local(app, scope, &wrapper, &["team", "start"], PREPARE_TIMEOUT),
                "team_start_failed",
            )
        }
        ValidatedHost::Vps { .. } => ensure_success(
            run_ssh(validated, REMOTE_TEAM_START, None, PREPARE_TIMEOUT, None),
            "team_start_failed",
        ),
    }
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
                start_team_impl(&app, &worker_expected, &validated)?;
                verified_team_snapshot(&app, &worker_expected, &validated)
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
                start_team_impl(&app, &worker_expected, &validated)?;
                verified_team_snapshot(&app, &worker_expected, &validated)
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
                                &["team", "start", "assistente"],
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
        parse_snapshot, redact, resume_team_prerequisite, start_and_verify_local_container_with,
        valid_pairing_token, valid_wrapper_file, ExistingTeamConnectRequest, OnboardingProgress,
        OnboardingProgressStage, OnboardingProgressStatus, OnboardingSubmission, ProgressReporter,
        StreamRedactor, INSTALL_SHA256, REMOTE_EXISTING_TEAM_PROBE, REMOTE_INSTALL,
    };
    #[cfg(target_os = "macos")]
    use super::{
        ensure_local_podman, ensure_local_podman_with_retry, local_podman_install_required,
        local_wrapper_command, LOCAL_PODMAN_INSTALL_ARGS, PODMAN_MACHINE_NAME,
    };
    use crate::runtime_host::ProcessResult;
    use sha2::{Digest, Sha256};
    use std::{
        collections::VecDeque,
        sync::{Arc, Mutex},
        thread,
        time::Duration,
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
            "local_account_owner_unavailable",
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
        reporter
            .run_with_interval(
                OnboardingProgressStage::Runtime,
                "Avvio il runtime Job Hunter Team",
                "Avvio del runtime in corso",
                "Runtime Job Hunter Team avviato",
                Duration::from_millis(2),
                || {
                    thread::sleep(Duration::from_millis(8));
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
            time::{SystemTime, UNIX_EPOCH},
        };

        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let home = std::env::temp_dir().join(format!("jht-wrapper-upgrade-{nonce}"));
        let bin = home.join(".local/bin");
        let runtime = home.join("runtime");
        fs::create_dir_all(&bin).unwrap();
        fs::create_dir_all(&runtime).unwrap();
        let wrapper = bin.join("jht");
        fs::write(
            &wrapper,
            b"#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nexit 0\n",
        )
        .unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        fs::write(
            runtime.join(".runtime-integrity"),
            b"version=1\ndocker-compose.yml=compose\nhost-setup.sh=host\njht-wrapper.sh=legacy\ncontainer-runtime=runtime\n",
        )
        .unwrap();

        assert!(super::valid_host_wrapper_file(&wrapper));
        assert!(!valid_wrapper_file(&wrapper));
        assert!(!local_podman_install_required(true, true, true));

        let published = super::publish_bundled_wrapper(&home, &runtime).unwrap();
        assert_eq!(published, wrapper);
        assert_eq!(fs::read(&published).unwrap(), super::BUNDLED_LOCAL_WRAPPER);
        assert!(valid_wrapper_file(&published));
        let manifest = fs::read_to_string(runtime.join(".runtime-integrity")).unwrap();
        let digest = format!("{:x}", Sha256::digest(super::BUNDLED_LOCAL_WRAPPER));
        assert!(manifest.contains(&format!("jht-wrapper.sh={digest}\n")));
        assert!(manifest.contains("docker-compose.yml=compose\n"));
        assert_eq!(
            fs::metadata(&published).unwrap().permissions().mode() & 0o777,
            0o700
        );

        fs::remove_dir_all(home).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn local_runtime_prepare_podman_success_failure_and_retry() {
        let mut ready_calls = Vec::new();
        ensure_local_podman_with_retry(
            |args, _| {
                ready_calls.push(args.join(" "));
                outcome(true)
            },
            |_| panic!("an already ready machine must not wait"),
            3,
        )
        .unwrap();
        assert_eq!(
            ready_calls,
            vec![format!("--connection {PODMAN_MACHINE_NAME} info")]
        );

        let mut stopped_results = VecDeque::from([false, true, true, false, true]);
        let mut stopped_calls = Vec::new();
        let mut stopped_pauses = 0;
        ensure_local_podman_with_retry(
            |args, _| {
                stopped_calls.push(args.join(" "));
                outcome(stopped_results.pop_front().unwrap())
            },
            |_| stopped_pauses += 1,
            3,
        )
        .unwrap();
        assert_eq!(
            stopped_calls[1],
            format!("machine inspect {PODMAN_MACHINE_NAME}")
        );
        assert_eq!(
            stopped_calls[2],
            format!("machine start --update-connection=false {PODMAN_MACHINE_NAME}")
        );
        assert_eq!(stopped_pauses, 1);

        let mut absent_results = VecDeque::from([false, false, true, true]);
        let mut absent_calls = Vec::new();
        ensure_local_podman_with_retry(
            |args, _| {
                absent_calls.push(args.join(" "));
                outcome(absent_results.pop_front().unwrap())
            },
            |_| panic!("a machine ready after init must not wait"),
            3,
        )
        .unwrap();
        assert_eq!(
            absent_calls[2],
            format!("machine init --now --update-connection=false {PODMAN_MACHINE_NAME}")
        );

        let mut raced_start = VecDeque::from([false, true, false, true]);
        ensure_local_podman_with_retry(
            |_, _| outcome(raced_start.pop_front().unwrap()),
            |_| panic!("effect verification after a raced start must not wait"),
            3,
        )
        .unwrap();

        let mut start_failed = VecDeque::from([false, true, false, false]);
        let error = ensure_local_podman_with_retry(
            |_, _| outcome(start_failed.pop_front().unwrap()),
            |_| {},
            3,
        )
        .unwrap_err();
        assert_eq!(error.code, "podman_start_failed");

        let mut not_ready = VecDeque::from([false, false, true, false, false]);
        let mut not_ready_pauses = 0;
        let error = ensure_local_podman_with_retry(
            |_, _| outcome(not_ready.pop_front().unwrap()),
            |_| not_ready_pauses += 1,
            2,
        )
        .unwrap_err();
        assert_eq!(error.code, "podman_not_ready");
        assert_eq!(not_ready_pauses, 1);
    }

    #[test]
    fn local_runtime_prepare_container_success_failure_and_retry() {
        let mut results = VecDeque::from([true, false, true]);
        let mut calls = Vec::new();
        let mut pauses = 0;
        start_and_verify_local_container_with(
            |args, _| {
                calls.push(args.join(" "));
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
            |args, _| {
                active_calls.push(args.join(" "));
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
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\n",
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
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\n",
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
    fn fake_podman_and_wrapper_integration_has_no_real_runtime_side_effects() {
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
        let podman = dir.join("podman");
        fs::write(
            &podman,
            r#"#!/bin/sh
state="$(dirname "$0")/podman-ready"
case "$1:$2" in
  --connection:jht-podman) [ -f "$state" ] ;;
  machine:inspect) exit 0 ;;
  machine:start) : > "$state" ;;
  *) exit 9 ;;
esac
"#,
        )
        .unwrap();
        fs::set_permissions(&podman, fs::Permissions::from_mode(0o700)).unwrap();
        ensure_local_podman(&podman).unwrap();

        let wrapper = dir.join("jht");
        fs::write(
            &wrapper,
            r#"#!/bin/sh
JHT_HOST_RUNTIME_PROTOCOL=1
JHT_DESKTOP_CHAT_PROTOCOL=1
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
        assert!(dir.join("podman-ready").is_file());
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

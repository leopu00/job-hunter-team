use crate::account_scope::{AccountScope, AccountScopeState};
use crate::existing_team_runtime::{self, ActivatedTarget, ChatOperation};
use crate::runtime_host::{
    run_program, run_program_keeping_stderr_with_environment, run_program_without_env, run_ssh, run_ssh_command, run_ssh_command_without_pipes,
    set_private_dir_permissions, set_private_permissions, ssh_base_args, validate_host,
    ExecutionHost, ProcessResult, ValidatedHost,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(all(unix, not(target_os = "macos")))]
use sha2::{Digest, Sha256};
#[cfg(all(unix, not(target_os = "macos")))]
use std::collections::BTreeMap;
use std::{
    ffi::OsString,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{ipc::Channel, Manager, State};
use zeroize::{Zeroize, Zeroizing};

mod scripts;
use scripts::CHAT_READ_PY;
use scripts::CHAT_PERSIST_PY;
use scripts::TEAM_LANGUAGE_PY;
mod state;
use state::CONNECT_TIMEOUT;
use state::READ_TIMEOUT;
use state::SEND_TIMEOUT;
use state::MAX_CHAT_STDIN_BYTES;
pub(crate) use state::DirectChatState;
use state::DirectChatInner;
use state::PROBE_READY_KEPT;
use state::PROBE_FAILED_KEPT;
use state::ProbeMemo;
use state::forget_probe;
use state::status_kept_or_probed;
use state::Connection;
use state::VpsLink;
use state::vps_link_for;
use state::RemoteOperation;
#[cfg(all(test, unix))]
use state::synthetic_connection;
use state::with_connection_read;
pub(crate) use state::DirectChatStatus;
pub(crate) use state::DirectChatError;
pub(crate) use state::failure;
use state::status;
use state::ready_for;
use state::ready_status;
use state::emit;
mod wire;
use wire::CHAT_SYSTEM_CODES;
use wire::closed_code;
use wire::MESSAGE_KINDS;
use wire::QUESTION_KINDS;
use wire::QUESTION_STATES;
use wire::ANSWER_ORIGINS;
use wire::MAX_SUBJECT_CHARS;
use wire::MAX_QUESTION_CHARS;
use wire::MAX_LABEL_CHARS;
use wire::MAX_ANSWER_CHARS;
use wire::MAX_OPTIONS;
use wire::MAX_QUESTIONS;
use wire::string_in;
use wire::closed_token;
use wire::option_id;
use wire::seconds;
use wire::short_text;
use wire::message_kind;
use wire::MAX_SUGGESTIONS;
use wire::MAX_SUGGESTION_CHARS;
use wire::suggestions;
use wire::taken_flag;
use wire::TAKEN_REASONS;
use wire::closed_reason;
pub(crate) use wire::DirectChatMessage;
pub(crate) use wire::DirectChatOption;
pub(crate) use wire::DirectChatAnswer;
pub(crate) use wire::DirectChatQuestion;
use wire::closed_static;
use wire::MAX_QUEUED_IDS;
use wire::MAX_QUEUED_ID_LEN;
use wire::queued_ids;
use wire::QUEUE_ENDINGS;
pub(crate) use wire::DirectChatQueueEnding;
use wire::queue_endings;
use wire::closed_queue;
use wire::closed_activity;
use wire::questions;
pub(crate) use wire::DirectChatPage;
pub(crate) use wire::DirectChatReceipt;
use wire::ReceiptAsWritten;
pub(crate) use wire::DirectChatAnswerReceipt;
pub(crate) use wire::DirectChatEvent;
mod host_store;
use host_store::connection_config_path;
use host_store::connection_config_path_at;
pub(crate) use host_store::verify_optional_playground_local_host_at;
pub(crate) use host_store::verify_migration_local_host_at;
use host_store::HOST_PERSIST;
use host_store::persist_host_at;
use host_store::persist_host;
use host_store::read_assistance_host_at;
use host_store::register_assistance_host_at;
pub(crate) use host_store::register_assistance_host;
pub(crate) use host_store::persist_onboarding_host;
pub(crate) use host_store::clear_persisted_host_at;
use host_store::load_host;
pub(crate) use host_store::load_persisted_host;
mod ssh_link;
use ssh_link::control_args;
use ssh_link::check_tunnel;
use ssh_link::SOCKET_PATH_MAX;
use ssh_link::SSH_SOCKET_SUFFIX;
use ssh_link::TUNNEL_DIR_PREFIX;
use ssh_link::control_path_fits;
use ssh_link::tunnel_socket_path;
use ssh_link::tunnel_dir_name;
use ssh_link::tunnel_socket_bases;
use ssh_link::remove_tunnel_socket;
use ssh_link::open_tunnel;
use ssh_link::open_vps_link;
use ssh_link::VPS_LINK_CHECK;
use ssh_link::same_vps;
use ssh_link::master_to_lend;
#[cfg(unix)]
use ssh_link::socket_folder_owned_by;
#[cfg(unix)]
pub(crate) use ssh_link::lent_socket_still_ours;
#[cfg(not(unix))]
pub(crate) use ssh_link::lent_socket_still_ours;
pub(crate) use ssh_link::shared_master;
use ssh_link::close_connection;
mod local_engine;
use local_engine::local_runtime_dir;
use local_engine::LocalChatEngine;
use local_engine::local_docker_cli;
use local_engine::local_chat_engine;
use local_engine::container_id;
use local_engine::local_engine_removed_environment;
use local_engine::run_local_engine;
use local_engine::local_compose_args;
use local_engine::label;
use local_engine::podman_systemd_unit;
use local_engine::wrapper_compose_environment;
#[cfg(unix)]
use local_engine::read_host_values;
#[cfg(target_os = "macos")]
use local_engine::read_host_env;
mod runtime_integrity;
#[cfg(all(unix, not(target_os = "macos")))]
use runtime_integrity::digest_file;
#[cfg(unix)]
use runtime_integrity::unix_runtime_node_is_safe;
#[cfg(unix)]
use runtime_integrity::unix_runtime_path_is_safe;
use runtime_integrity::local_chat_runtime_valid;
#[cfg(unix)]
use runtime_integrity::TOOL_ROOTS;
#[cfg(unix)]
use runtime_integrity::ADMIN_GROUP;
#[cfg(unix)]
use runtime_integrity::tool_folder_is_safe;
#[cfg(unix)]
use runtime_integrity::tool_file_is_safe;
#[cfg(unix)]
use runtime_integrity::tool_is_trusted;
#[cfg(unix)]
use runtime_integrity::find_trusted_tool;
#[cfg(target_os = "macos")]
pub(crate) use runtime_integrity::trusted_podman;
#[cfg(target_os = "macos")]
use runtime_integrity::mac_config_hash;
mod container_attestation;
use container_attestation::text_the_wrapper_hashes;
use container_attestation::host_env_as_the_wrapper_records_it;
use container_attestation::attest_reason_may_pass;
#[cfg(unix)]
use container_attestation::mac_config_hash_in;
use container_attestation::windows_path_key;
use container_attestation::windows_container_labels_are_attested;
use container_attestation::is_pinned_image_reference;
use container_attestation::windows_container_image_is_the_runtimes;
use container_attestation::split_inspected;
use container_attestation::podman_container_label_refusal;
#[cfg(not(windows))]
use container_attestation::podman_compose_label_refusal;
use container_attestation::attestation_refusal;
use container_attestation::container_not_found_code;
mod container_discovery;
use container_discovery::local_chat_container;
use container_discovery::Candidate;
use container_discovery::Verdict;
use container_discovery::image_is_accepted;
use container_discovery::needs_image_inspect;
use container_discovery::judge_candidate;
use container_discovery::listed_candidates;
use container_discovery::local_listing_args;
use container_discovery::parse_listing;
use container_discovery::inspected_candidates;
use container_discovery::inspected_image;
mod local_exec;
use local_exec::local_chat_exec_args;
use local_exec::LOCAL_PYTHON_LAUNCH;
use local_exec::LOCAL_DELIVERY_SCRIPT;
use local_exec::run_local_native;
use local_exec::run_local_chat;
use local_exec::engine_lost_the_container;
use local_exec::LOCAL_CHAT_TEAM_KEPT;
use local_exec::LOCAL_CHAT_TEAM;
use local_exec::local_chat_team;
use local_exec::local_chat_team_key;
use local_exec::forget_local_chat_team;
pub(crate) use local_exec::local_runtime_path;
pub(crate) use local_exec::AttestedLocalTeam;
use local_exec::attested_exec_args;
mod transport;
use transport::REMOTE_CONTAINER_PROBE;
pub(crate) use transport::REMOTE_PYTHON_STDIN;
use transport::valid_agent;
use transport::session_for;
use transport::run_connection;
use transport::probe;
use transport::probe_unlogged;
use transport::probe_no_container_code;
use transport::hex_encode;
use transport::python_input;
use transport::run_python;
use transport::remote_wrapper_command;
use transport::UNKNOWN_ACTION;
use transport::uses_pinned_chat;
use transport::chat_failure;
use transport::run_wrapper_chat;
use transport::wrapper_outcome;
use transport::run_chat;










/// Linux's protected host bundle, ported from jht-wrapper.sh. It has no engine side effect: a
/// malformed path, owner, manifest or selected engine is rejected before any native command.
#[cfg(all(unix, not(target_os = "macos")))]
fn unix_runtime_bundle_valid(wrapper: &Path, runtime: &Path) -> bool {
    if !unix_runtime_path_is_safe(runtime, wrapper) || !unix_runtime_node_is_safe(runtime, true) {
        return false;
    }
    let manifest = runtime.join(".runtime-integrity");
    let compose = runtime.join("docker-compose.yml");
    let setup = runtime.join("host-setup.sh");
    let bin = runtime.join("bin");
    if !unix_runtime_node_is_safe(&bin, true)
        || ![&manifest, &compose, &setup, wrapper]
        .into_iter()
        .all(|path| unix_runtime_node_is_safe(path, false))
    {
        return false;
    }
    if !fs::read_to_string(&compose).is_ok_and(|source| {
        source.lines().any(|line| {
            line.trim_start()
                .strip_prefix("- jht-runtime-mask:/jht_home/runtime")
                .is_some_and(|rest| rest.trim().is_empty())
        })
    })
        || !fs::read_to_string(&setup)
            .is_ok_and(|source| source.lines().any(|line| line == "JHT_HOST_SETUP_PROTOCOL=1"))
        || !fs::read_to_string(wrapper)
            .is_ok_and(|source| source.lines().any(|line| line == "JHT_HOST_RUNTIME_PROTOCOL=1"))
    {
        return false;
    }
    let Ok(source) = fs::read_to_string(&manifest) else { return false };
    let mut entries = BTreeMap::new();
    for line in source.lines() {
        let Some((key, value)) = line.split_once('=') else { return false };
        if (key == "version" && value != "1")
            || (key != "version"
                && (value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit())))
            || entries.insert(key, value).is_some()
        {
            return false;
        }
    }
    if entries.get("version").copied() != Some("1")
        || entries.get("docker-compose.yml").copied() != digest_file(&compose).as_deref()
        || entries.get("host-setup.sh").copied() != digest_file(&setup).as_deref()
        || entries.get("jht-wrapper.sh").copied() != digest_file(wrapper).as_deref()
    {
        return false;
    }
    let selection = runtime.join("container-runtime");
    let selected = match fs::symlink_metadata(&selection) {
        Ok(_) if unix_runtime_node_is_safe(&selection, false) => match fs::read_to_string(&selection) {
            Ok(value) if matches!(value.trim(), "docker" | "podman")
                && entries.get("container-runtime").copied() == digest_file(&selection).as_deref() => value.trim().to_owned(),
            _ => return false,
        },
        Err(_) if !entries.contains_key("container-runtime") => "docker".to_owned(),
        _ => return false,
    };
    let shim = runtime.join("bin").join("docker");
    if selected == "podman"
        && (!unix_runtime_node_is_safe(&shim, false)
            || fs::canonicalize(&shim).map_or(true, |real| real != shim)
            || entries.get("docker-shim").copied() != digest_file(&shim).as_deref()
            || !fs::read_to_string(&shim).is_ok_and(|source| source.lines().any(|line| line == "# JHT_PODMAN_DOCKER_SHIM=1")))
    {
        return false;
    }
    let image_pin = runtime.join("runtime-image");
    let mut expected_keys = vec!["version", "docker-compose.yml", "host-setup.sh", "jht-wrapper.sh"];
    if fs::symlink_metadata(&selection).is_ok() {
        expected_keys.push("container-runtime");
    }
    if selected == "podman" {
        expected_keys.push("docker-shim");
    }
    if fs::symlink_metadata(&image_pin).is_ok() {
        expected_keys.push("runtime-image");
    }
    expected_keys.sort_unstable();
    if entries.keys().copied().collect::<Vec<_>>() != expected_keys {
        return false;
    }
    match (entries.get("runtime-image"), fs::symlink_metadata(&image_pin)) {
        (None, Err(_)) => true,
        (Some(expected), Ok(_)) if unix_runtime_node_is_safe(&image_pin, false) => {
            digest_file(&image_pin).as_deref() == Some(*expected)
                && fs::read_to_string(&image_pin).is_ok_and(|pin| {
                    pin.strip_suffix('\n').is_some_and(|value| value.len() == 91
                        && value.starts_with("ghcr.io/leopu00/jht@sha256:")
                        && value[27..].bytes().all(|byte| byte.is_ascii_hexdigit()))
                })
        }
        _ => false,
    }
}









fn connect_impl(
    app: &tauri::AppHandle,
    scope: AccountScope,
    host: ExecutionHost,
) -> Result<Connection, DirectChatError> {
    let validated =
        crate::runtime_host::validate_host_for_scope(app, &host, &scope).map_err(failure)?;
    let runtime = if matches!(validated, ValidatedHost::Vps { .. }) {
        existing_team_runtime::selected_or_own(app, &scope, &host).map_err(failure)?
    } else {
        None
    };
    let link = vps_link_for(std::env::consts::OS);
    let (local_wrapper, local_runtime, local_owner_marker, control_path, tunnel) = match &validated
    {
        ValidatedHost::Local => (
            Some(crate::onboarding::verified_local_wrapper_path(app).map_err(failure)?),
            Some(local_runtime_dir(app)?),
            Some(crate::account_scope::local_owner_marker_path(app).map_err(failure)?),
            None,
            None,
        ),
        ValidatedHost::Vps { .. } => {
            let (path, child) = open_vps_link(&validated, link, |host| {
                run_ssh_command_without_pipes(host, VPS_LINK_CHECK, None, CONNECT_TIMEOUT)
            })?;
            (None, None, None, path, child)
        }
    };
    let mut connection = Connection {
        app: Some(app.clone()),
        scope: scope.clone(),
        host,
        validated,
        runtime,
        local_wrapper,
        local_runtime,
        local_owner_marker,
        control_path,
        tunnel,
        link,
    };
    let state = probe(&connection);
    if state.state != "ready" {
        close_connection(&mut connection);
        return Err(failure(state.code.unwrap_or("connect_failed")));
    }
    persist_host(app, &scope, &connection.host)?;
    Ok(connection)
}

/// What the app does right after connecting an existing team, for the CLI: open the direct chat
/// on the host the connection persisted (as direct_chat_reconnect does), then close it again.
/// Dropping the connection closes the tunnel and removes its socket.
pub(crate) fn cli_open_and_close(app: &tauri::AppHandle, scope: &AccountScope) -> Result<(), &'static str> {
    let host = load_host(app, scope).map_err(|error| error.code)?;
    let connection = connect_impl(app, scope.clone(), host).map_err(|error| error.code)?;
    drop(connection);
    Ok(())
}

async fn connect_scoped(
    app: tauri::AppHandle,
    state: &DirectChatState,
    scopes: AccountScopeState,
    expected: AccountScope,
    host: ExecutionHost,
) -> Result<DirectChatStatus, DirectChatError> {
    let started = Instant::now();
    let app_for_log = app.clone();
    {
        let _scope = scopes.lock_expected(&expected).map_err(failure)?;
        state
            .inner
            .connection
            .lock()
            .map_err(|_| failure("state_failed"))?
            .take();
        forget_probe(&state.inner);
        emit(
            &state.inner,
            DirectChatEvent::Status {
                status: status("connecting", None),
            },
        );
    }
    let worker_scopes = scopes.clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = worker_scopes
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        connect_impl(&app, worker_expected, host)
    })
    .await
    .map_err(|_| failure("connect_failed"))?;
    match result {
        Ok(connection) => {
            log_chat_call(Some(&app_for_log), "connect", Ok(()), started.elapsed());
            let _scope = scopes.lock_expected(&expected).map_err(failure)?;
            let mut slot = state
                .inner
                .connection
                .lock()
                .map_err(|_| failure("state_failed"))?;
            let ready = ready_for(&connection);
            *slot = Some(connection);
            forget_probe(&state.inner);
            emit(
                &state.inner,
                DirectChatEvent::Status {
                    status: ready.clone(),
                },
            );
            Ok(ready)
        }
        Err(error) => {
            log_chat_call(Some(&app_for_log), "connect", Err(error.code), started.elapsed());
            let _scope = scopes.lock_expected(&expected).map_err(failure)?;
            let failed = status("error", Some(error.code));
            emit(
                &state.inner,
                DirectChatEvent::Status {
                    status: failed.clone(),
                },
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn direct_chat_connect(
    app: tauri::AppHandle,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    host: ExecutionHost,
) -> Result<DirectChatStatus, DirectChatError> {
    let expected = scopes.active().map_err(failure)?;
    connect_scoped(app, &state, scopes.inner().clone(), expected, host).await
}

// The commands below ask the connection, which can mean a process on the computer (the probe) and the connection's
// lock, held while another operation runs. A sync command runs on the main thread, the window's own: it
// would freeze the window for as long as that takes (seconds on a slow Windows computer). So they are async
// and the work is done on a thread of its own, as the other chat commands do.
#[tauri::command]
pub(crate) async fn direct_chat_subscribe(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    on_event: Channel<DirectChatEvent>,
) -> Result<DirectChatStatus, DirectChatError> {
    let inner = Arc::clone(&state.inner);
    let scope_state = scopes.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state.lock_active().map_err(failure)?;
        inner
            .subscribers
            .lock()
            .map_err(|_| failure("state_failed"))?
            .push(on_event);
        status_for_scope(&inner, scope.scope())
    })
    .await
    .map_err(|_| failure("state_failed"))?
}

fn status_for_scope(
    inner: &DirectChatInner,
    scope: &AccountScope,
) -> Result<DirectChatStatus, DirectChatError> {
    let slot = inner
        .connection
        .lock()
        .map_err(|_| failure("state_failed"))?;
    match slot.as_ref() {
        // This computer's team: the lock is let go before the probe, so that a read of the chat or of the profile does not
        // wait for it (the container found for the probe is kept for them, one lookup at a time).
        Some(connection) if &connection.scope == scope && matches!(connection.validated, ValidatedHost::Local) => {
            let local = connection.detached_local().ok_or_else(|| failure("state_failed"))?;
            drop(slot);
            Ok(status_kept_or_probed(&inner.probe_memo, scope, std::time::Instant::now, || probe(&local)))
        }
        Some(connection) if &connection.scope == scope => Ok(status_kept_or_probed(
            &inner.probe_memo,
            scope,
            std::time::Instant::now,
            || probe(connection),
        )),
        Some(_) => Err(failure("account_scope_mismatch")),
        None => Ok(status("disconnected", None)),
    }
}

#[tauri::command]
pub(crate) async fn direct_chat_status(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<DirectChatStatus, DirectChatError> {
    let inner = Arc::clone(&state.inner);
    let scope_state = scopes.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state.lock_active().map_err(failure)?;
        status_for_scope(&inner, scope.scope())
    })
    .await
    .map_err(|_| failure("state_failed"))?
}

#[tauri::command]
pub(crate) async fn direct_chat_reconnect(
    app: tauri::AppHandle,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<DirectChatStatus, DirectChatError> {
    let expected = scopes.active().map_err(failure)?;
    let host = {
        let _scope = scopes.lock_expected(&expected).map_err(failure)?;
        load_host(&app, &expected)?
    };
    connect_scoped(app, &state, scopes.inner().clone(), expected, host).await
}


pub(crate) fn window_may_write(label: &str) -> bool {
    label == "main"
}

/// Writing to an existing team's agent needs the full connection ("Collega e conferma") made in
/// this run of the app. The read-only view activates the same target and opens the same chat, so
/// it is decided here, in the native side, and not by the page: a chat opened read-only reads,
/// and a send is refused whatever the renderer asks.
///
/// A team with no pinned target is this computer's (always writable) or a VPS of the person's own,
/// which `own_may_write` answers: writing to it needs the mark the app's own setup writes, or the
/// person's claim of it (JHT-T30). Not having a candidate or a selection is no permission.
fn link_allows_writing(runtime: Option<&ActivatedTarget>, own_may_write: bool, full_link: impl Fn(&ActivatedTarget) -> bool) -> bool {
    runtime.map_or(own_may_write, full_link)
}

/// Why a message may not go to the VPS of the person's own this connection is on, or none: this
/// computer and an existing team have their own rules. The codes are the page's invitation to claim
/// the VPS (`own_vps_claim_required`) or to claim it again after its key changed (`own_vps_key_changed`).
fn own_vps_write_refusal(connection: &Connection) -> Option<&'static str> {
    if connection.runtime.is_some() || !matches!(connection.validated, ValidatedHost::Vps { .. }) {
        return None;
    }
    let Some(app) = connection.app.as_ref() else {
        return Some("own_vps_claim_refused");
    };
    let pinned = crate::runtime_host::pinned_host_fingerprint(&connection.validated).ok();
    match existing_team_runtime::root(app) {
        Ok(root) => existing_team_runtime::own_vps_state_at(&root, &connection.scope, &connection.host, pinned.as_deref()).write_refusal(),
        Err(_) => Some("own_vps_claim_refused"),
    }
}

fn parse_json<T: for<'de> Deserialize<'de>>(
    result: ProcessResult,
    code: &'static str,
) -> Result<T, DirectChatError> {
    if !result.success() {
        return Err(failure(code));
    }
    serde_json::from_slice(&result.stdout).map_err(|_| failure(code))
}

#[tauri::command]
pub(crate) async fn direct_chat_read(
    app: tauri::AppHandle,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    cursor: Option<String>,
) -> Result<DirectChatPage, DirectChatError> {
    if !valid_agent(&agent_id)
        || cursor
            .as_ref()
            .is_some_and(|v| v.len() > 32 || !v.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(failure("invalid_request"));
    }
    let started = Instant::now();
    let expected = scopes.active().map_err(failure)?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let inner = Arc::clone(&state.inner);
    let agent_for_event = agent_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        with_connection_read(&inner, scope.scope(), |connection| {
            if connection.link == VpsLink::PerCommand && matches!(connection.validated, ValidatedHost::Vps { .. }) {
                return small_read(cursor.as_deref(), &mut |cursor| read_page(connection, &agent_id, cursor));
            }
            read_page(connection, &agent_id, cursor.as_deref())
        })
    })
    .await
    .map_err(|_| failure("read_failed"))?;
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    match result {
        Ok(page) => {
            log_chat_call(Some(&app), "read", Ok(()), started.elapsed());
            emit(
                &state.inner,
                DirectChatEvent::Messages {
                    agent_id: agent_for_event,
                    page: page.clone(),
                },
            );
            Ok(page)
        }
        Err(error) => {
            log_chat_call(Some(&app), "read", Err(error.code), started.elapsed());
            emit(
                &state.inner,
                DirectChatEvent::Error {
                    operation: "read",
                    code: error.code,
                },
            );
            Err(error)
        }
    }
}

/// The wrapper's older `send` action for one session, on a host reached by ssh: the checks of
/// `REMOTE_PYTHON_STDIN`, then `desktop-chat send SESSION`. The session is a capital-letter name of the chat's
/// closed grammar (the eight fixed ones, or an instance of a numbered role), checked here again.
fn delivery_command(session: &str) -> Option<String> {
    if !existing_team_runtime::chat_session_ok(session) {
        return None;
    }
    let checks = REMOTE_PYTHON_STDIN.strip_suffix("python")?;
    Some(format!("{checks}send {session}"))
}

fn local_delivery_args(session: &str) -> [&str; 3] {
    ["desktop-chat", "send", session]
}

/// One page of an agent's chat, from `cursor` (the server's tail of 128 KB without one), by the
/// fixed container script (local or pinned), the VPS host wrapper, or the older Python fallback.
fn read_page(connection: &Connection, agent_id: &str, cursor: Option<&str>) -> Result<DirectChatPage, DirectChatError> {
    if uses_pinned_chat(connection) {
        let result = run_chat(connection, ChatOperation::Read { agent: agent_id, cursor }, None, READ_TIMEOUT, "read_failed")?;
        return parse_json::<DirectChatPage>(result, "read_failed");
    }
    if let Some(result) =
        run_wrapper_chat(connection, ChatOperation::Read { agent: agent_id, cursor }, None, READ_TIMEOUT, "read_failed")?
    {
        return parse_json::<DirectChatPage>(result, "read_failed");
    }
    // The host's wrapper is older than the chat actions: the older path.
    parse_json::<DirectChatPage>(
        run_python(connection, CHAT_READ_PY, &json!({"agent":agent_id,"cursor":cursor}), READ_TIMEOUT)?,
        "read_failed",
    )
}

/// The tail a first small read asks for: the last 32 KiB of the chat, not the server's 128 KiB.
const SMALL_READ_TAIL: u64 = 32 * 1024;
/// How far before the cursor a later read starts: more than a whole line of the largest message
/// (4000 characters, 16 KB of UTF-8, plus its JSON).
const SMALL_READ_OVERLAP: u64 = 20 * 1024;
/// A cursor past any chat (12 digits, the most the server takes): the server answers with no line
/// and its size as the cursor.
const SMALL_READ_SIZE_PROBE: &str = "999999999999";

/// A read on the per-command link (Windows to a VPS), where every read is an ssh connection: what
/// passes stays small, about 50 KB at most, instead of the server's whole tail of 128 KiB at every
/// read. Nothing changes on the server, so the VPS already installed answer the same way.
/// - Without a cursor (the page's first read of an agent): the size, then the last 32 KiB.
/// - With the page's cursor: from 20 KiB before it. The server drops the line it lands inside, so
///   a cursor right at the start of a line would lose that line, and a line still being written at
///   the end would come back cut: the overlap reads them again whole, with the same ids (an absolute
///   offset or the message's own id), and the page merges them.
/// - A cursor the server answers with a smaller one (the chat got shorter): read again from the tail.
fn small_read(
    cursor: Option<&str>,
    read: &mut dyn FnMut(Option<&str>) -> Result<DirectChatPage, DirectChatError>,
) -> Result<DirectChatPage, DirectChatError> {
    let at = |page: &DirectChatPage| page.cursor.as_deref().and_then(|cursor| cursor.parse::<u64>().ok());
    if let Some(kept) = cursor.and_then(|cursor| cursor.parse::<u64>().ok()) {
        let sent = kept.saturating_sub(SMALL_READ_OVERLAP);
        let page = read(Some(&sent.to_string()))?;
        if at(&page).is_some_and(|back| back >= sent) {
            return Ok(page);
        }
    }
    let size = at(&read(Some(SMALL_READ_SIZE_PROBE))?).ok_or_else(|| failure("read_failed"))?;
    read(Some(&size.saturating_sub(SMALL_READ_TAIL).to_string()))
}

/// One command does what the two used to: the turn is written once for its client id and goes to
/// the agent's terminal in the user's envelope. A terminal that is busy (alive, taking a turn) is
/// asked again with the same id, which writes nothing twice. `None`: the host's wrapper is older
/// than the chat actions, and the caller keeps the older path.
fn send_fixed(
    connection: &Connection,
    agent: &str,
    text: &str,
    client_id: &str,
) -> Result<Option<DirectChatReceipt>, DirectChatError> {
    if text.len() > MAX_CHAT_STDIN_BYTES {
        return Err(failure("invalid_request"));
    }
    let input = Zeroizing::new(text.as_bytes().to_vec());
    let pinned = uses_pinned_chat(connection);
    // One ask. A working agent is not retried here: the team queues the turn and answers `queued`.
    let operation = ChatOperation::Send { agent, client_message_id: client_id };
    let outcome = if pinned {
        run_chat(connection, operation, Some(&input), SEND_TIMEOUT, "send_failed").map(Some)
    } else {
        run_wrapper_chat(connection, operation, Some(&input), SEND_TIMEOUT, "send_failed")
    };
    match outcome {
        Ok(Some(result)) => parse_json(result, "send_verify_failed").map(Some),
        Ok(None) => Ok(None),
        Err(error) => Err(error),
    }
}

fn send_impl(
    inner: &DirectChatInner,
    agent: String,
    text: String,
    client_id: String,
) -> Result<DirectChatReceipt, DirectChatError> {
    let _serial = inner
        .send_lock
        .lock()
        .map_err(|_| failure("state_failed"))?;
    let slot = inner
        .connection
        .lock()
        .map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    refuse_writing(connection)?;
    if let Some(receipt) = send_fixed(connection, &agent, &text, &client_id)? {
        return Ok(receipt);
    }
    // The host's wrapper is older than the chat actions (only a local team or an unpinned VPS gets
    // here): the older path, as it was.
    let check: Value = parse_json(
        run_python(
            connection,
            CHAT_PERSIST_PY,
            &json!({"mode":"check","agent":agent,"clientMessageId":client_id}),
            READ_TIMEOUT,
        )?,
        "send_verify_failed",
    )?;
    // The current Godot transport persists first, then delivers through the
    // verified tmux helper. A retry may find the persisted turn: it must still
    // retry delivery, never turn file presence into an optimistic success.
    let receipt: DirectChatReceipt = if check.get("exists").and_then(Value::as_bool) == Some(true) {
        serde_json::from_value(check).map_err(|_| failure("send_verify_failed"))?
    } else {
        parse_json(
            run_python(
                connection,
                CHAT_PERSIST_PY,
                &json!({"mode":"append","agent":agent,"text":text,"clientMessageId":client_id}),
                READ_TIMEOUT,
            )?,
            "persist_failed",
        )?
    };
    let session = session_for(&agent).ok_or_else(|| failure("invalid_agent"))?;
    let session = session.as_str();
    let mut envelope = Zeroizing::new(format!("[@utente -> @{agent}] [CHAT] {text}"));
    let mut delivered = run_connection(
        connection,
        &local_delivery_args(session),
        RemoteOperation::Delivery(session),
        Some(envelope.as_bytes()),
        SEND_TIMEOUT,
    )?;
    for _ in 1..3 {
        if delivered.code != 4 {
            break;
        }
        delivered = run_connection(
            connection,
            &local_delivery_args(session),
            RemoteOperation::Delivery(session),
            Some(envelope.as_bytes()),
            SEND_TIMEOUT,
        )?;
    }
    envelope.zeroize();
    if !delivered.success() {
        return Err(failure(match delivered.code {
            2 => "agent_not_running",
            3 => "agent_unavailable",
            4 => "agent_busy",
            5 => "agent_stuck",
            _ => "send_failed",
        }));
    }
    Ok(receipt)
}

#[tauri::command]
pub(crate) async fn direct_chat_send(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    text: String,
    client_message_id: String,
) -> Result<DirectChatReceipt, DirectChatError> {
    // Writing to an agent is a command: only the app's own window may ask for it (the capability
    // also reaches the windows that load other sites, the sign-in views).
    if !window_may_write(window.label()) {
        return Err(failure("invalid_request"));
    }
    let trimmed = text.trim();
    if !valid_agent(&agent_id)
        || trimmed.is_empty()
        || trimmed.len() > 4000
        || trimmed.contains('\0')
        || client_message_id.is_empty()
        || client_message_id.len() > 128
        || !client_message_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    {
        return Err(failure("invalid_request"));
    }
    let started = Instant::now();
    let expected = scopes.active().map_err(failure)?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let inner = Arc::clone(&state.inner);
    let agent = agent_id;
    let id = client_message_id;
    let mut sensitive = Zeroizing::new(trimmed.to_string());
    let owned = sensitive.to_string();
    sensitive.zeroize();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        {
            let slot = inner
                .connection
                .lock()
                .map_err(|_| failure("state_failed"))?;
            let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
            if &connection.scope != scope.scope() {
                return Err(failure("account_scope_mismatch"));
            }
        }
        send_impl(&inner, agent, owned, id)
    })
    .await
    .map_err(|_| failure("send_failed"))?;
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    match result {
        Ok(receipt) => {
            log_chat_call(Some(&app), "send", Ok(()), started.elapsed());
            emit(
                &state.inner,
                DirectChatEvent::Send {
                    receipt: receipt.clone(),
                },
            );
            Ok(receipt)
        }
        Err(error) => {
            log_chat_call(Some(&app), "send", Err(error.code), started.elapsed());
            emit(
                &state.inner,
                DirectChatEvent::Error {
                    operation: "send",
                    code: error.code,
                },
            );
            Err(error)
        }
    }
}

/// Whether an attachment can go now, and if not the closed reason the page says. The files are
/// copied on this computer for this computer's team only: a VPS has its own disk, a read-only view
/// writes nothing, and there is no copy without a connected team.
fn attach_refusal(connection: &Connection) -> Option<&'static str> {
    if !cfg!(any(target_os = "macos", target_os = "linux")) {
        return Some("attach_platform");
    }
    if !matches!(&connection.validated, ValidatedHost::Local) {
        return Some("attach_vps");
    }
    let own_refusal = own_vps_write_refusal(connection);
    if !link_allows_writing(connection.runtime.as_ref(), own_refusal.is_none(), |target| {
        existing_team_runtime::full_link_granted(&connection.scope, target)
    }) {
        return Some("attach_read_only");
    }
    if connection.local_wrapper.is_none() || connection.local_runtime.is_none() {
        return Some("attach_not_connected");
    }
    None
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatAttachState {
    available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
}

/// What the 📎 button says: on, or off with the reason. Reads the connection only: nothing is probed.
#[tauri::command]
pub(crate) async fn direct_chat_attach_state(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<DirectChatAttachState, DirectChatError> {
    let inner = Arc::clone(&state.inner);
    let scope_state = scopes.inner().clone();
    // It only reads the connection, but the connection's lock may be held by a probe or a read: it waits off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state.lock_active().map_err(failure)?;
        let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
        let code = match slot.as_ref() {
            Some(connection) if &connection.scope == scope.scope() => attach_refusal(connection),
            Some(_) => return Err(failure("account_scope_mismatch")),
            None => Some("attach_not_connected"),
        };
        Ok(DirectChatAttachState { available: code.is_none(), code })
    })
    .await
    .map_err(|_| failure("state_failed"))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatAttachment {
    /// `sent`, `saved_not_sent` (the file is in the folder, the Assistant was not told: `code` says
    /// why) or `cancelled` (the person closed the window: not an error).
    outcome: &'static str,
    /// The person's own file name, for their screen only.
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    receipt: Option<DirectChatReceipt>,
}

/// Held while an attachment is in hand: a second click is refused, not queued.
struct AttachGuard(Arc<std::sync::atomic::AtomicBool>);

impl AttachGuard {
    fn take(busy: &Arc<std::sync::atomic::AtomicBool>) -> Option<Self> {
        use std::sync::atomic::Ordering;
        busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(Arc::clone(busy)))
    }
}

impl Drop for AttachGuard {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}

/// The message of an attachment. The person reads one short sentence in their language; behind it,
/// on the same line, the Assistant gets the path of OUR copy in its container (the page hides that
/// bracket: `withoutAttachmentPath` in DirectChatScreen.tsx reads exactly this shape). Nothing of the
/// person's file name or content is in it. An unknown language gets English.
/// «My CV» only for the kinds of file a CV comes in (a document); a picture or a plain text is not
/// known to be one, and gets «a file».
fn attachment_message(locale: &str, file: &str) -> String {
    let document = file
        .rsplit_once('.')
        .is_some_and(|(_, extension)| crate::chat_attachment::DOCUMENT_EXTENSIONS.contains(&extension));
    let said = match (locale, document) {
        ("it", true) => "Ho allegato il mio CV.",
        ("it", false) => "Ho allegato un file.",
        ("de", true) => "Ich habe meinen Lebenslauf angehängt.",
        ("de", false) => "Ich habe eine Datei angehängt.",
        ("es", true) => "He adjuntado mi CV.",
        ("es", false) => "He adjuntado un archivo.",
        ("fr", true) => "J'ai joint mon CV.",
        ("fr", false) => "J'ai joint un fichier.",
        ("hu", true) => "Csatoltam az önéletrajzomat.",
        ("hu", false) => "Csatoltam egy fájlt.",
        ("pt", true) => "Anexei o meu CV.",
        ("pt", false) => "Anexei um ficheiro.",
        (_, true) => "I attached my CV.",
        (_, false) => "I attached a file.",
    };
    format!("{said} [attachment for my profile: /jht_user/{}/{file}]", crate::chat_attachment::FOLDER)
}

/// Where the system's window opens: the Downloads folder of the person, where a CV usually is, and
/// not Documents, which holds their personal files. Without that folder the system chooses.
fn downloads_of(home: &Path) -> Option<PathBuf> {
    let downloads = home.join("Downloads");
    downloads.is_dir().then_some(downloads)
}

struct AttachTarget {
    wrapper: PathBuf,
    runtime: PathBuf,
    user_dir: PathBuf,
    start_dir: Option<PathBuf>,
}

/// The same gate as a message, then the places the copy needs. Runs off the main thread.
fn attach_target(
    inner: &DirectChatInner,
    scopes: &AccountScopeState,
    expected: &AccountScope,
) -> Result<AttachTarget, DirectChatError> {
    let scope = scopes.lock_expected(expected).map_err(failure)?;
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    if &connection.scope != scope.scope() {
        return Err(failure("account_scope_mismatch"));
    }
    refuse_writing(connection)?;
    if let Some(code) = attach_refusal(connection) {
        return Err(failure(code));
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| failure("attach_platform"))?;
    Ok(AttachTarget {
        wrapper: connection.local_wrapper.clone().ok_or_else(|| failure("runtime_missing"))?,
        runtime: connection.local_runtime.clone().ok_or_else(|| failure("runtime_missing"))?,
        start_dir: downloads_of(&home),
        user_dir: home.join("Documents").join("Job Hunter Team"),
    })
}

/// The copy is in the folder on this computer; the team must see the same file there. A mount that
/// does not show it (another folder, an engine that shares less) takes the copy back: nothing is
/// told to the Assistant about a file it cannot open.
fn team_sees_the_copy(target: &AttachTarget, saved: &crate::chat_attachment::Saved) -> bool {
    let path = format!("/jht_user/{}/{}", crate::chat_attachment::FOLDER, saved.file);
    let Ok(team) = local_chat_team(&target.wrapper, &target.runtime, READ_TIMEOUT) else { return false };
    matches!(
        team.exec(&["stat", "-c", "%s", path.as_str()], None, READ_TIMEOUT),
        Ok(done) if done.success() && String::from_utf8_lossy(&done.stdout).trim() == saved.size.to_string()
    )
}

/// «Attach» in the Assistant's chat: the person chooses a file in the system's window (the page
/// never names a path), it is checked and copied into the team's `allegati` folder, the team is
/// asked to see it, and only then the Assistant gets a short message naming our copy.
#[tauri::command]
pub(crate) async fn direct_chat_attach(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    client_message_id: String,
    locale: String,
) -> Result<DirectChatAttachment, DirectChatError> {
    use tauri_plugin_dialog::DialogExt;
    if !window_may_write(&window.label())
        || agent_id != "assistente"
        || client_message_id.is_empty()
        || client_message_id.len() > 128
        || !client_message_id.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
    {
        return Err(failure("invalid_request"));
    }
    let expected = scopes.active().map_err(failure)?;
    let app_for_log = app.clone();
    let _busy = AttachGuard::take(&state.inner.attach_busy).ok_or_else(|| failure("attach_busy"))?;
    let scope_state = scopes.inner().clone();
    let target = {
        let inner = Arc::clone(&state.inner);
        let (scope_state, expected) = (scope_state.clone(), expected.clone());
        tauri::async_runtime::spawn_blocking(move || attach_target(&inner, &scope_state, &expected))
            .await
            .map_err(|_| failure("attach_failed"))??
    };
    // The system's window is modal and waits for the person: never on the main thread.
    let picker = window.clone();
    let start_dir = target.start_dir.clone();
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app
            .dialog()
            .file()
            .set_parent(&picker)
            .add_filter("Documents", &crate::chat_attachment::ALLOWED_EXTENSIONS);
        if let Some(dir) = start_dir {
            dialog = dialog.set_directory(dir);
        }
        dialog.blocking_pick_file()
    })
    .await
    .map_err(|_| failure("attach_failed"))?;
    let Some(chosen) = chosen else {
        return Ok(DirectChatAttachment { outcome: "cancelled", display_name: None, code: None, receipt: None });
    };
    let source = chosen.into_path().map_err(|_| failure("attachment_unreadable"))?;
    let saved = {
        let user_dir = target.user_dir.clone();
        // the name of the copy reads the clock of this computer, not UTC
        let now = crate::chat_attachment::local_wall_clock(
            SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        );
        tauri::async_runtime::spawn_blocking(move || crate::chat_attachment::store(&user_dir, &source, now, &mut |_| {}))
            .await
            .map_err(|_| failure("attach_failed"))?
            .map_err(failure)?
    };
    let target = Arc::new(target);
    let seen = {
        let (target, saved_view) = (Arc::clone(&target), saved.clone());
        tauri::async_runtime::spawn_blocking(move || team_sees_the_copy(&target, &saved_view))
            .await
            .unwrap_or(false)
    };
    if !seen {
        let (user_dir, file) = (target.user_dir.clone(), saved.file.clone());
        let _ = tauri::async_runtime::spawn_blocking(move || crate::chat_attachment::remove(&user_dir, &file)).await;
        return Err(failure("attachment_not_shared"));
    }
    let text = attachment_message(&locale, &saved.file);
    let display_name = Some(saved.display.clone());
    let inner = Arc::clone(&state.inner);
    let worker_expected = expected.clone();
    let worker_scopes = scope_state.clone();
    let id = client_message_id;
    let sent_from = Instant::now();
    let sent = tauri::async_runtime::spawn_blocking(move || {
        let scope = worker_scopes.lock_expected(&worker_expected).map_err(failure)?;
        {
            let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
            let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
            if &connection.scope != scope.scope() {
                return Err(failure("account_scope_mismatch"));
            }
        }
        send_impl(&inner, "assistente".to_string(), text, id)
    })
    .await
    .map_err(|_| failure("send_failed"))?;
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    match sent {
        Ok(receipt) => {
            log_chat_call(Some(&app_for_log), "send", Ok(()), sent_from.elapsed());
            emit(&state.inner, DirectChatEvent::Send { receipt: receipt.clone() });
            Ok(DirectChatAttachment { outcome: "sent", display_name, code: None, receipt: Some(receipt) })
        }
        Err(error) => {
            log_chat_call(Some(&app_for_log), "send", Err(error.code), sent_from.elapsed());
            Ok(DirectChatAttachment { outcome: "saved_not_sent", display_name, code: Some(error.code), receipt: None })
        }
    }
}

/// How long a call of the chat may take before it is written to the runtime log although it worked: a window that
/// "does not answer" is a call that is slow, and the log must say which one and for how long.
const SLOW_CHAT_CALL: Duration = Duration::from_secs(5);
/// A slow call of the same kind is written again after this long, not at every slow call.
const SLOW_CHAT_CALL_AGAIN: Duration = Duration::from_secs(30);

/// What was last written to the runtime log for one kind of call: its failure (a read that fails every two seconds
/// writes one line, and a new one only when its code changes; a call that works ends the failure) and when a slow one was.
#[derive(Clone, Copy)]
struct LoggedCall {
    failure: Option<(&'static str, Option<&'static str>)>,
    slow_at: Option<Instant>,
}

impl LoggedCall {
    const NONE: Self = Self { failure: None, slow_at: None };
}

static LOGGED_CHAT_CALL: Mutex<[LoggedCall; 6]> = Mutex::new([LoggedCall::NONE; 6]);

/// What a call of the chat leaves in the log, by the rules above: `None` when nothing new is to be said. A failure
/// is written when it is not the one just written; a call that worked is written only when it was slow, and not
/// again before `SLOW_CHAT_CALL_AGAIN`.
fn chat_call_line(
    last: &mut LoggedCall,
    outcome: Result<(), (&'static str, Option<&'static str>)>,
    took: Duration,
    now: Instant,
) -> Option<(&'static str, Option<&'static str>)> {
    match outcome {
        Err(failure) => {
            if last.failure == Some(failure) {
                return None;
            }
            last.failure = Some(failure);
            Some(failure)
        }
        Ok(()) => {
            last.failure = None;
            if took < SLOW_CHAT_CALL || last.slow_at.is_some_and(|at| now.saturating_duration_since(at) < SLOW_CHAT_CALL_AGAIN) {
                return None;
            }
            last.slow_at = Some(now);
            Some(("ok_slow", None))
        }
    }
}

/// The rule the last container check stopped at, in the fixed words of `runtime_log::ATTEST_REASONS`; it
/// goes to the runtime log with the failure it explains, and nowhere else.
static ATTEST_REASON: Mutex<Option<&'static str>> = Mutex::new(None);

fn note_attest_reason(reason: &'static str) {
    if let Ok(mut said) = ATTEST_REASON.lock() {
        *said = Some(reason);
    }
}

/// A call of the chat (`runtime_log::CHAT_CALLS`) has ended: its failure, or its slowness, goes to the runtime log with the
/// closed code, the operation and how long it took (T191: a chat that "did not answer" left nothing, and nobody could say
/// which call was waiting for what). A log that cannot be written never stops the call.
fn log_chat_call(app: Option<&tauri::AppHandle>, operation: &'static str, outcome: Result<(), &'static str>, took: Duration) {
    log_chat_call_in(&LOGGED_CHAT_CALL, app.and_then(crate::runtime_log::RuntimeLog::new).as_ref(), operation, outcome, took);
}

fn log_chat_call_in(
    memory: &Mutex<[LoggedCall; 6]>,
    log: Option<&crate::runtime_log::RuntimeLog>,
    operation: &'static str,
    outcome: Result<(), &'static str>,
    took: Duration,
) {
    let Some(slot) = crate::runtime_log::CHAT_CALLS.iter().position(|call| *call == operation) else {
        return;
    };
    let outcome = outcome.map_err(|code| {
        let reason = if matches!(code, "local_container_not_attested" | "container_unavailable") {
            ATTEST_REASON.lock().ok().and_then(|mut said| said.take())
        } else {
            None
        };
        (code, reason)
    });
    let line = match memory.lock() {
        Ok(mut last) => chat_call_line(&mut last[slot], outcome, took, Instant::now()),
        Err(_) => None,
    };
    if let (Some((code, reason)), Some(log)) = (line, log) {
        log.record_chat_call(operation, code, reason, took);
    }
}

/// The one gate of every write to an agent (a message, an answer, an Enter): an existing team needs
/// the full link made in this run of the app, a VPS of the person's own needs its mark. A refusal is
/// written to the runtime log, as the read-only view's own steps are.
fn refuse_writing(connection: &Connection) -> Result<(), DirectChatError> {
    let own_refusal = own_vps_write_refusal(connection);
    if link_allows_writing(connection.runtime.as_ref(), own_refusal.is_none(), |target| {
        existing_team_runtime::full_link_granted(&connection.scope, target)
    }) {
        return Ok(());
    }
    let code = own_refusal.unwrap_or("read_only_link");
    if let Some(log) = connection.app.as_ref().and_then(crate::runtime_log::RuntimeLog::new) {
        log.record_chat_refusal(code);
    }
    Err(failure(code))
}

/// Answer and Enter, in the fixed local/pinned container or through a VPS host wrapper. They have
/// no older path: a VPS wrapper without them (64) is a team to update.
fn run_answer_action(
    connection: &Connection,
    operation: ChatOperation<'_>,
    input: Option<&[u8]>,
    timeout: Duration,
    default: &'static str,
) -> Result<ProcessResult, DirectChatError> {
    if uses_pinned_chat(connection) {
        return run_chat(connection, operation, input, timeout, default);
    }
    run_wrapper_chat(connection, operation, input, timeout, default)?.ok_or_else(|| failure("chat_runtime_outdated"))
}

/// The options and the words of an answer, checked before they leave: at most 8 distinct option
/// ids of the closed alphabet, at least one of them or some words, the words at most 2000
/// characters and without NUL. The team checks them again against the question itself.
fn answer_input(choices: &[String], text: Option<&str>) -> Result<Zeroizing<Vec<u8>>, DirectChatError> {
    let words = text.map(str::trim).filter(|t| !t.is_empty());
    let distinct = choices.iter().enumerate().all(|(i, c)| !choices[..i].contains(c));
    if choices.len() > MAX_OPTIONS
        || !distinct
        || !choices.iter().all(|c| option_id(c))
        || (choices.is_empty() && words.is_none())
        || words.is_some_and(|w| w.chars().count() > MAX_ANSWER_CHARS || w.contains('\0'))
    {
        return Err(failure("invalid_request"));
    }
    let line = serde_json::to_vec(&json!({"choices": choices, "text": words})).map_err(|_| failure("invalid_request"))?;
    Ok(Zeroizing::new(line))
}

fn answer_impl(
    inner: &DirectChatInner,
    agent: &str,
    question_id: &str,
    input: &[u8],
) -> Result<DirectChatAnswerReceipt, DirectChatError> {
    let _serial = inner.send_lock.lock().map_err(|_| failure("state_failed"))?;
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    refuse_writing(connection)?;
    let result = run_answer_action(
        connection,
        ChatOperation::Answer { agent, question_id },
        Some(input),
        READ_TIMEOUT,
        "answer_failed",
    )?;
    let receipt: DirectChatAnswerReceipt = parse_json(result, "answer_failed")?;
    // A receipt for another question, or one that does not say it was taken, is no answer.
    if receipt.question_id != question_id || !receipt.accepted || !receipt.at.is_finite() {
        return Err(failure("answer_failed"));
    }
    Ok(receipt)
}

fn enter_impl(inner: &DirectChatInner, agent: &str, message_id: &str) -> Result<DirectChatReceipt, DirectChatError> {
    let _serial = inner.send_lock.lock().map_err(|_| failure("state_failed"))?;
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    refuse_writing(connection)?;
    // The ids were checked here: a 120 from the script is an image without the operation.
    let result = run_answer_action(connection, ChatOperation::Enter { agent, message_id }, None, SEND_TIMEOUT, "send_failed")
        .map_err(|error| if error.code == "invalid_request" { failure("chat_runtime_outdated") } else { error })?;
    let receipt: DirectChatReceipt = parse_json(result, "send_verify_failed")?;
    // The receipt of another message, or one that says nothing of the composer, proves nothing.
    if receipt.message_id != message_id || !receipt.accepted || receipt.taken.is_none() {
        return Err(failure("send_verify_failed"));
    }
    Ok(receipt)
}

/// The most a fixed script of the app may answer in one go: pages are about a megabyte, so this is far past one.
const TEAM_SCRIPT_REPLY_MAX: usize = 4 * 1024 * 1024;

/// One read of the team through the chat's Python channel (this computer's team, an existing team's pinned
/// container, the VPS the app made): a fixed script of the app, one JSON request, one JSON reply. It is a
/// read, so it asks for no write gate and works in the read-only view; it needs the chat connected.
pub(crate) async fn team_script_read(
    state: &State<'_, DirectChatState>,
    scopes: &State<'_, AccountScopeState>,
    script: &'static str,
    request: Value,
    timeout: Duration,
) -> Result<Value, DirectChatError> {
    chat_scoped(
        state,
        scopes,
        move |inner, scope| {
            with_connection_read(inner, scope, |connection| {
                let result = run_python(connection, script, &request, timeout)?;
                if result.stdout.len() > TEAM_SCRIPT_REPLY_MAX {
                    return Err(failure("read_failed"));
                }
                let (exit, bytes) = (result.code, result.stdout.len());
                let parsed: Result<Value, DirectChatError> = parse_json(result, "read_failed");
                if parsed.is_err() {
                    // why the answer was no JSON (the wrapper's exit and how much it printed, never what), for the runtime log
                    if let Some(log) = connection.app.as_ref().and_then(crate::runtime_log::RuntimeLog::new) {
                        log.record_script_read_failure(exit, bytes);
                    }
                }
                parsed
            })
        },
        "read_failed",
    )
    .await
}

/// The same fixed-script channel for a change the person asked for (clearing their statistics): it is a write,
/// so the read-only view and a link that cannot write are refused here, in the native side, before anything runs.
pub(crate) async fn team_script_write(
    state: &State<'_, DirectChatState>,
    scopes: &State<'_, AccountScopeState>,
    script: &'static str,
    request: Value,
    timeout: Duration,
) -> Result<Value, DirectChatError> {
    chat_write(
        state,
        scopes,
        move |inner| {
            let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
            let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
            refuse_writing(connection)?;
            let result = run_python(connection, script, &request, timeout)?;
            if result.stdout.len() > TEAM_SCRIPT_REPLY_MAX {
                return Err(failure("read_failed"));
            }
            parse_json(result, "read_failed")
        },
        "read_failed",
    )
    .await
}

/// Runs a write of the chat on the worker, in the account scope the page asked it in.
async fn chat_write<T: Send + 'static>(
    state: &State<'_, DirectChatState>,
    scopes: &State<'_, AccountScopeState>,
    work: impl FnOnce(&DirectChatInner) -> Result<T, DirectChatError> + Send + 'static,
    default: &'static str,
) -> Result<T, DirectChatError> {
    chat_scoped(
        state,
        scopes,
        move |inner, scope| {
            // a connection that is not there, or is another account's, is refused before the work
            let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
            let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
            if &connection.scope != scope {
                return Err(failure("account_scope_mismatch"));
            }
            drop(slot);
            work(inner)
        },
        default,
    )
    .await
}

/// The same job on a thread of its own, for the account that asked, which `work` is given: the account's lock is held
/// for the job, as for every chat call. `work` takes the connection's lock itself, for as little time as it needs
/// (`with_connection_read` lets it go before the exec on this computer).
async fn chat_scoped<T: Send + 'static>(
    state: &State<'_, DirectChatState>,
    scopes: &State<'_, AccountScopeState>,
    work: impl FnOnce(&DirectChatInner, &AccountScope) -> Result<T, DirectChatError> + Send + 'static,
    default: &'static str,
) -> Result<T, DirectChatError> {
    let expected = scopes.active().map_err(failure)?;
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let inner = Arc::clone(&state.inner);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state.lock_expected(&worker_expected).map_err(failure)?;
        work(&inner, scope.scope())
    })
    .await
    .map_err(|_| failure(default))?;
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

/// What an answer may ask, checked before anything else: first the window (only the app's own may
/// write to an agent), then the agent, the question and the options and words.
fn answer_request(
    window: &str,
    agent: &str,
    question_id: &str,
    choices: &[String],
    text: Option<&str>,
) -> Result<Zeroizing<Vec<u8>>, DirectChatError> {
    if !window_may_write(window) || !valid_agent(agent) || !existing_team_runtime::chat_question_id(question_id) {
        return Err(failure("invalid_request"));
    }
    answer_input(choices, text)
}

/// The same for an Enter: the window first, then the agent and the message's id.
fn enter_request(window: &str, agent: &str, message_id: &str) -> Result<(), DirectChatError> {
    let well_formed = !message_id.is_empty()
        && message_id.len() <= 64
        && message_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    if !window_may_write(window) || !valid_agent(agent) || !well_formed {
        return Err(failure("invalid_request"));
    }
    Ok(())
}

/// The person's answer to one of the agent's questions: the ids of the options taken and, where the
/// question takes them, words. Only the app's own window may answer, as only it may send.
#[tauri::command]
pub(crate) async fn direct_chat_answer(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    question_id: String,
    choices: Vec<String>,
    text: Option<String>,
) -> Result<DirectChatAnswerReceipt, DirectChatError> {
    let input = answer_request(window.label(), &agent_id, &question_id, &choices, text.as_deref())?;
    let started = Instant::now();
    let result = chat_write(
        &state,
        &scopes,
        move |inner| answer_impl(inner, &agent_id, &question_id, &input),
        "answer_failed",
    )
    .await;
    log_chat_call(Some(&app), "answer", result.as_ref().map(|_| ()).map_err(|error| error.code), started.elapsed());
    if let Err(error) = &result {
        emit(&state.inner, DirectChatEvent::Error { operation: "answer", code: error.code });
    }
    result
}

/// Enter pressed once more on a message the agent's CLI did not take, never the text again: the
/// team presses only if that message is still in the composer, and says what it saw.
#[tauri::command]
pub(crate) async fn direct_chat_enter(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    agent_id: String,
    message_id: String,
) -> Result<DirectChatReceipt, DirectChatError> {
    enter_request(window.label(), &agent_id, &message_id)?;
    let started = Instant::now();
    let result = chat_write(&state, &scopes, move |inner| enter_impl(inner, &agent_id, &message_id), "send_failed").await;
    log_chat_call(Some(&app), "enter", result.as_ref().map(|_| ()).map_err(|error| error.code), started.elapsed());
    match &result {
        Ok(receipt) => emit(&state.inner, DirectChatEvent::Send { receipt: receipt.clone() }),
        Err(error) => emit(&state.inner, DirectChatEvent::Error { operation: "enter", code: error.code }),
    }
    result
}

const TEAM_LANGUAGES: [&str; 7] = ["en", "it", "hu", "es", "de", "fr", "pt"];

/// The language the team speaks (`locale`), what its file says (`stored`, none while the file is
/// missing or unreadable) and, after a `set`, whether it was written (`changed`).
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct TeamLanguage {
    locale: String,
    stored: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    changed: Option<bool>,
}

/// A reply of the script is trusted only for what it is: one of the seven languages, in both fields.
fn checked_team_language(reply: TeamLanguage) -> Option<TeamLanguage> {
    let known = |code: &str| TEAM_LANGUAGES.contains(&code);
    (known(&reply.locale) && reply.stored.as_deref().map_or(true, known)).then_some(reply)
}

fn team_language_impl(
    inner: &DirectChatInner,
    request: Value,
    write: bool,
    default: &'static str,
) -> Result<TeamLanguage, DirectChatError> {
    let _serial = inner.send_lock.lock().map_err(|_| failure("state_failed"))?;
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    if write {
        refuse_writing(connection)?;
    }
    let reply: TeamLanguage = parse_json(run_python(connection, TEAM_LANGUAGE_PY, &request, READ_TIMEOUT)?, default)?;
    checked_team_language(reply).ok_or_else(|| failure(default))
}

/// The language of the team this chat is connected to. Read only: it works in the read-only view too.
#[tauri::command]
pub(crate) async fn direct_chat_team_language(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<TeamLanguage, DirectChatError> {
    chat_write(
        &state,
        &scopes,
        |inner| team_language_impl(inner, json!({"op": "read"}), false, "read_failed"),
        "read_failed",
    )
    .await
}

/// Sets the team's language through the same file the game's language setting writes. Without
/// `choose` (the app following the language said on its first screen) it writes only over the English
/// the team starts with: a language already chosen is never replaced (`changed: false`). With `choose`
/// it is the person's own answer, and it replaces the team's language. Only the app's own window may
/// ask, and a team the app may not write to (the read-only view, a VPS not yet claimed) refuses as every
/// other write does.
#[tauri::command]
pub(crate) async fn direct_chat_team_language_set(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    locale: String,
    choose: Option<bool>,
) -> Result<TeamLanguage, DirectChatError> {
    if !window_may_write(window.label()) || !TEAM_LANGUAGES.contains(&locale.as_str()) {
        return Err(failure("invalid_request"));
    }
    let op = if choose == Some(true) { "choose" } else { "set" };
    chat_write(
        &state,
        &scopes,
        move |inner| team_language_impl(inner, json!({"op": op, "locale": locale}), true, "persist_failed"),
        "persist_failed",
    )
    .await
}

#[tauri::command]
pub(crate) async fn direct_chat_close(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<(), DirectChatError> {
    let inner = Arc::clone(&state.inner);
    let scope_state = scopes.inner().clone();
    // Closing a VPS link runs ssh (up to 5 s) and waits for the connection's lock: off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state.lock_active().map_err(failure)?;
        let mut slot = inner
            .connection
            .lock()
            .map_err(|_| failure("state_failed"))?;
        if slot
            .as_ref()
            .is_some_and(|connection| &connection.scope != scope.scope())
        {
            return Err(failure("account_scope_mismatch"));
        }
        if let Some(mut connection) = slot.take() {
            close_connection(&mut connection);
        }
        forget_probe(&inner);
        emit(
            &inner,
            DirectChatEvent::Status {
                status: status("disconnected", None),
            },
        );
        Ok(())
    })
    .await
    .map_err(|_| failure("state_failed"))?
}

pub(crate) fn teardown(state: &DirectChatState) {
    existing_team_runtime::revoke_full_link();
    if let Ok(mut slot) = state.inner.connection.lock() {
        if let Some(mut connection) = slot.take() {
            close_connection(&mut connection);
        }
    }
    forget_probe(&state.inner);
    if let Ok(mut subscribers) = state.inner.subscribers.lock() {
        subscribers.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        answer_input, answer_request, enter_request, chat_failure, connection_config_path_at, remote_wrapper_command, wrapper_outcome, delivery_command, hex_encode, link_allows_writing,
        parse_json, probe, session_for, status, valid_agent, verify_migration_local_host_at, window_may_write,
        Connection, DirectChatPage, DirectChatReceipt, ProcessResult, REMOTE_CONTAINER_PROBE, REMOTE_PYTHON_STDIN, UNKNOWN_ACTION,
        control_path_fits, remove_tunnel_socket, tunnel_dir_name, tunnel_socket_bases, tunnel_socket_path,
        SOCKET_PATH_MAX, SSH_SOCKET_SUFFIX,
        open_vps_link, ready_status, small_read, vps_link_for, VpsLink, VPS_LINK_CHECK, SMALL_READ_OVERLAP,
        SMALL_READ_SIZE_PROBE, SMALL_READ_TAIL, DirectChatError, local_chat_exec_args,
        local_compose_args, local_engine_removed_environment, LocalChatEngine, podman_systemd_unit, windows_container_labels_are_attested, engine_lost_the_container, windows_container_image_is_the_runtimes, split_inspected, windows_path_key,
        run_connection, run_local_chat, RemoteOperation,
        master_to_lend,
    };
    #[cfg(unix)]
    use super::{attested_exec_args, AttestedLocalTeam};
    #[cfg(unix)]
    use super::{attest_reason_may_pass, attestation_refusal, container_not_found_code, mac_config_hash_in};
    #[cfg(all(unix, not(target_os = "macos")))]
    use super::local_chat_runtime_valid;
    use crate::existing_team_runtime::ActivatedTarget;
    use crate::runtime_host::{ExecutionHost, ValidatedHost};
    use std::{fs, path::{Path, PathBuf}, process::Command, time::Duration};

    #[cfg(unix)]
    fn write_valid_local_podman_manifest(runtime: &Path, wrapper: &Path) {
        fs::write(runtime.join("host-setup.sh"), "#!/bin/sh\nJHT_HOST_SETUP_PROTOCOL=1\nexit 0\n").unwrap();
        write_local_podman_manifest(runtime, wrapper);
    }

    #[cfg(unix)]
    fn write_local_podman_manifest(runtime: &Path, wrapper: &Path) {
        use sha2::{Digest, Sha256};

        let digest = |path: &Path| format!("{:x}", Sha256::digest(fs::read(path).unwrap()));
        let mut lines = vec![
            "version=1".to_owned(),
            format!("docker-compose.yml={}", digest(&runtime.join("docker-compose.yml"))),
            format!("host-setup.sh={}", digest(&runtime.join("host-setup.sh"))),
            format!("jht-wrapper.sh={}", digest(wrapper)),
            format!("container-runtime={}", digest(&runtime.join("container-runtime"))),
            format!("docker-shim={}", digest(&runtime.join("bin/docker"))),
        ];
        #[cfg(target_os = "macos")]
        {
            fs::write(runtime.join("podman-machine"), "jht-podman\n").unwrap();
            lines.push(format!("podman-machine={}", digest(&runtime.join("podman-machine"))));
        }
        fs::write(runtime.join(".runtime-integrity"), format!("{}\n", lines.join("\n"))).unwrap();
    }

    /// The shape and length of macOS's per-user temporary folder (getconf DARWIN_USER_TEMP_DIR):
    /// /var/folders/<2>/<30>/T/, 49 characters. Placeholders, not a real one.
    const MACOS_TMPDIR: &str = "/var/folders/xx/xxxxxxxxxxxxxxxxxxxxxxxx0000gn/T/";

    #[test]
    fn the_tunnel_socket_fits_with_sshs_temporary_name_even_in_macos_long_tmpdir() {
        assert_eq!(MACOS_TMPDIR.len(), 49);
        // the old name, in a macOS TMPDIR: 95 characters, 112 with ssh's suffix
        let old = std::path::Path::new(MACOS_TMPDIR).join("jht-direct-chat-12345-1792703033508090000.sock");
        assert!(!control_path_fits(&old), "the old socket path must be the one that does not fit");
        // the new one, made of the same pieces open_tunnel uses
        let new = std::path::Path::new(MACOS_TMPDIR).join(format!("jc{}", tunnel_dir_name())).join("s");
        assert!(control_path_fits(&new), "{} characters", new.as_os_str().len());
        assert!(new.as_os_str().len() + SSH_SOCKET_SUFFIX <= SOCKET_PATH_MAX);
        assert_eq!(SOCKET_PATH_MAX, 103, "macOS: sun_path is 104 bytes with its NUL");
    }

    #[test]
    fn on_unix_the_tunnel_socket_stays_under_half_the_limit_in_tmp_before_the_tmpdir() {
        let bases = tunnel_socket_bases();
        #[cfg(unix)]
        {
            assert_eq!(bases[0], std::path::Path::new("/tmp"));
            let socket = bases[0].join(format!("jc{}", tunnel_dir_name())).join("s");
            assert!(socket.as_os_str().len() + SSH_SOCKET_SUFFIX <= SOCKET_PATH_MAX / 2, "{}", socket.display());
        }
        assert_eq!(bases.last().unwrap(), &std::env::temp_dir(), "the user's temporary folder is the fallback");
    }

    #[test]
    fn the_tunnel_socket_is_alone_in_a_private_folder_of_its_own_and_goes_with_it() {
        let base = std::env::temp_dir().join(format!("jht-tunnel-test-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let socket = tunnel_socket_path(std::slice::from_ref(&base), tunnel_dir_name).expect("a socket path");
        let dir = socket.parent().unwrap().to_owned();
        assert_eq!(dir.parent().unwrap(), base);
        assert!(socket.ends_with("s") && control_path_fits(&socket));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        }
        // a folder someone prepared with the same name is never used: another name is tried
        let mut names = vec!["taken000".to_owned(), "free0000".to_owned()].into_iter();
        fs::create_dir(base.join("jctaken000")).unwrap();
        let other = tunnel_socket_path(std::slice::from_ref(&base), || names.next().unwrap()).unwrap();
        assert_eq!(other, base.join("jcfree0000").join("s"));
        // closing removes the socket and its folder, never a folder that is not ours
        fs::write(&socket, b"").unwrap();
        remove_tunnel_socket(&socket);
        assert!(!dir.exists());
        let foreign = base.join("other").join("s");
        fs::create_dir_all(foreign.parent().unwrap()).unwrap();
        remove_tunnel_socket(&foreign);
        assert!(foreign.parent().unwrap().exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_base_too_long_for_a_socket_is_skipped_for_the_next_one() {
        let long = std::path::PathBuf::from(format!("/{}", "x".repeat(100)));
        let base = std::env::temp_dir().join(format!("jht-tunnel-next-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let socket = tunnel_socket_path(&[long.clone(), base.clone()], tunnel_dir_name).unwrap();
        assert!(socket.starts_with(&base));
        assert_eq!(tunnel_socket_path(&[long], tunnel_dir_name), Err("tunnel_path_unavailable"));
        let _ = fs::remove_dir_all(&base);
    }

    fn synthetic_vps() -> ValidatedHost {
        ValidatedHost::Vps {
            address: "test-host".into(),
            user: "test".into(),
            port: 22,
            key_path: "/private/synthetic-key".into(),
            known_hosts: "/private/synthetic-known-hosts".into(),
        }
    }

    fn exited(code: i32) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult { code, stdout: Vec::new() })
    }

    /// Win32-OpenSSH has no ControlMaster (T69): on Windows a VPS is reached one connection per command.
    #[test]
    fn only_windows_reaches_a_vps_one_connection_per_command() {
        assert_eq!(vps_link_for("windows"), VpsLink::PerCommand);
        for os in ["macos", "linux", "freebsd"] {
            assert_eq!(vps_link_for(os), VpsLink::Master, "{os}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn this_windows_build_never_opens_an_ssh_master() {
        assert_eq!(vps_link_for(std::env::consts::OS), VpsLink::PerCommand);
    }

    /// Without a master the link is one ssh that answers, with the master's own errors; there is no
    /// socket and no process to keep or to close.
    #[test]
    fn a_per_command_link_is_one_ssh_that_answers_with_the_masters_errors() {
        let host = synthetic_vps();
        let mut asked = Vec::new();
        let opened = open_vps_link(&host, VpsLink::PerCommand, |checked| {
            asked.push(matches!(checked, ValidatedHost::Vps { .. }));
            exited(0)
        })
        .expect("an ssh that answers is a link");
        assert!(opened.0.is_none() && opened.1.is_none());
        assert_eq!(asked, [true]);
        for (outcome, code) in [
            (exited(255), "tunnel_verify_failed"),
            (exited(1), "tunnel_verify_failed"),
            (Err("process_timeout"), "tunnel_verify_failed"),
            // a way in that has a sentence of its own is passed on, not folded into the generic one
            (Err("ssh_client_missing"), "ssh_client_missing"),
            (Err("ssh_auth_failed"), "ssh_auth_failed"),
            (Err("ssh_rate_limited"), "ssh_rate_limited"),
        ] {
            let error = open_vps_link(&host, VpsLink::PerCommand, |_| outcome).unwrap_err();
            assert_eq!(error.code, code);
        }
        // the check is a command every remote shell runs the same way
        assert_eq!(VPS_LINK_CHECK, "exit 0");
    }

    /// A lent socket is used only while its folder is still the chat's: a real folder of this user,
    /// 0700, with the chat's prefix. Another owner, a folder open to others, a link or another name:
    /// a connection of its own.
    #[cfg(unix)]
    #[test]
    fn a_lent_socket_must_sit_in_a_folder_still_the_chats() {
        use super::{lent_socket_still_ours, socket_folder_owned_by};
        use std::os::unix::fs::PermissionsExt;
        let base = std::env::temp_dir().join(format!("jht-lend-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        // SAFETY: geteuid has no arguments or pointers.
        let me = unsafe { libc::geteuid() };
        let ours = base.join("jcabcdef0123");
        fs::create_dir(&ours).unwrap();
        fs::set_permissions(&ours, fs::Permissions::from_mode(0o700)).unwrap();
        let socket = ours.join("s");
        assert!(socket_folder_owned_by(&socket, me));
        assert!(lent_socket_still_ours(&socket));
        assert!(!socket_folder_owned_by(&socket, me.wrapping_add(1)), "another owner");

        fs::set_permissions(&ours, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(!lent_socket_still_ours(&socket), "a folder others can read");
        fs::set_permissions(&ours, fs::Permissions::from_mode(0o700)).unwrap();

        let link = base.join("jclinkxyz");
        std::os::unix::fs::symlink(&ours, &link).unwrap();
        assert!(!lent_socket_still_ours(&link.join("s")), "a link to a folder of ours");

        let named = base.join("other0123");
        fs::create_dir(&named).unwrap();
        fs::set_permissions(&named, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(!lent_socket_still_ours(&named.join("s")), "not the chat's name");

        assert!(!lent_socket_still_ours(&base.join("jcgone").join("s")), "a folder that is gone");
        assert!(!lent_socket_still_ours(Path::new("s")), "no folder");
        fs::remove_dir_all(&base).unwrap();
    }

    /// The terminal of the agents' panel reads through the chat's master only when the chat is
    /// connected in the same account, on the master link, to the very same VPS and team. Unix only:
    /// a test that builds a Connection does (see only_unix_tests_build_a_connection), and the chat
    /// has no master to lend on Windows.
    #[cfg(unix)]
    #[test]
    fn the_chats_master_is_lent_only_to_the_same_account_vps_and_team() {
        let scope = crate::account_scope::AccountScope::synthetic(b"synthetic-account-lend");
        let other_scope = crate::account_scope::AccountScope::synthetic(b"synthetic-account-other");
        let socket = PathBuf::from("/nonexistent-jht-test/master.sock");
        let team = ActivatedTarget::synthetic_for_tests();
        let chat = |runtime: Option<ActivatedTarget>, link: VpsLink, validated: ValidatedHost| {
            Connection {
                app: None,
                scope: scope.clone(),
                host: ExecutionHost::Local,
                validated,
                runtime,
                local_wrapper: None,
                local_runtime: None,
                local_owner_marker: None,
                control_path: Some(socket.clone()),
                tunnel: None,
                link,
            }
        };
        let same_team = Some((team.team_id.as_str(), &team.runtime));
        let mut connections = Vec::new();

        // the VPS the app set up: no pinned team on either side
        let own = chat(None, VpsLink::Master, synthetic_vps());
        assert_eq!(
            master_to_lend(Some(&own), &scope, &synthetic_vps(), None),
            Some(socket.clone())
        );
        assert_eq!(
            master_to_lend(Some(&own), &other_scope, &synthetic_vps(), None),
            None,
            "another account"
        );
        assert_eq!(
            master_to_lend(Some(&own), &scope, &synthetic_vps(), same_team),
            None,
            "the chat is not on that team"
        );
        assert_eq!(
            master_to_lend(None, &scope, &synthetic_vps(), None),
            None,
            "no chat"
        );
        assert_eq!(
            master_to_lend(Some(&own), &scope, &ValidatedHost::Local, None),
            None,
            "this computer"
        );
        let changed =
            |edit: &dyn Fn(&mut String, &mut String, &mut u16, &mut PathBuf, &mut PathBuf)| {
                let ValidatedHost::Vps {
                    mut address,
                    mut user,
                    mut port,
                    mut key_path,
                    mut known_hosts,
                } = synthetic_vps()
                else {
                    unreachable!()
                };
                edit(
                    &mut address,
                    &mut user,
                    &mut port,
                    &mut key_path,
                    &mut known_hosts,
                );
                ValidatedHost::Vps {
                    address,
                    user,
                    port,
                    key_path,
                    known_hosts,
                }
            };
        for (what, host) in [
            (
                "address",
                changed(&|a, _, _, _, _| *a = "other-host".into()),
            ),
            ("user", changed(&|_, u, _, _, _| *u = "root".into())),
            ("port", changed(&|_, _, p, _, _| *p = 2222)),
            (
                "key",
                changed(&|_, _, _, k, _| *k = "/private/other-key".into()),
            ),
            (
                "pinned host key",
                changed(&|_, _, _, _, h| *h = "/private/other-known-hosts".into()),
            ),
        ] {
            assert_eq!(
                master_to_lend(Some(&own), &scope, &host, None),
                None,
                "another {what}"
            );
        }
        connections.push(own);

        // an existing team: the same pinned container, or nothing
        let existing = chat(Some(team.clone()), VpsLink::Master, synthetic_vps());
        assert_eq!(
            master_to_lend(Some(&existing), &scope, &synthetic_vps(), same_team),
            Some(socket.clone())
        );
        assert_eq!(
            master_to_lend(Some(&existing), &scope, &synthetic_vps(), None),
            None
        );
        let other_id = "u".repeat(16);
        assert_eq!(
            master_to_lend(
                Some(&existing),
                &scope,
                &synthetic_vps(),
                Some((other_id.as_str(), &team.runtime))
            ),
            None
        );
        let mut other_runtime = team.runtime.clone();
        other_runtime.container_id = "9".repeat(64);
        assert_eq!(
            master_to_lend(
                Some(&existing),
                &scope,
                &synthetic_vps(),
                Some((team.team_id.as_str(), &other_runtime))
            ),
            None
        );
        connections.push(existing);

        // Windows: no master to lend
        let per_command = chat(None, VpsLink::PerCommand, synthetic_vps());
        assert_eq!(
            master_to_lend(Some(&per_command), &scope, &synthetic_vps(), None),
            None
        );
        connections.push(per_command);
        // a chat without its socket lends nothing
        let mut no_socket = chat(None, VpsLink::Master, synthetic_vps());
        no_socket.control_path = None;
        assert_eq!(
            master_to_lend(Some(&no_socket), &scope, &synthetic_vps(), None),
            None
        );
        connections.push(no_socket);

        // nothing to close: these masters never existed
        for mut connection in connections {
            connection.control_path = None;
        }
    }

    /// The page reads every 5 s instead of 1.5 only when each read is a new ssh connection.
    #[test]
    fn only_a_vps_reached_per_command_is_ready_with_a_slow_link() {
        assert_eq!(
            serde_json::to_value(ready_status(&synthetic_vps(), VpsLink::PerCommand)).unwrap(),
            serde_json::json!({"state": "ready", "link": "per-command"})
        );
        assert_eq!(serde_json::to_value(ready_status(&synthetic_vps(), VpsLink::Master)).unwrap(), serde_json::json!({"state": "ready"}));
        assert_eq!(
            serde_json::to_value(ready_status(&ValidatedHost::Local, VpsLink::PerCommand)).unwrap(),
            serde_json::json!({"state": "ready"})
        );
        // the status of a ready connection is this one
        let source = concat!(include_str!("direct_chat/scripts.rs"), include_str!("direct_chat/state.rs"), include_str!("direct_chat/wire.rs"), include_str!("direct_chat/host_store.rs"), include_str!("direct_chat/ssh_link.rs"), include_str!("direct_chat/local_engine.rs"), include_str!("direct_chat/runtime_integrity.rs"), include_str!("direct_chat/container_attestation.rs"), include_str!("direct_chat/container_discovery.rs"), include_str!("direct_chat/local_exec.rs"), include_str!("direct_chat/transport.rs"), include_str!("direct_chat.rs")).split("mod tests {").next().unwrap();
        assert!(source.contains("fn ready_for(connection: &Connection) -> DirectChatStatus {\n    ready_status(&connection.validated, connection.link)\n}"));
    }

    /// What a small read asks the server, and in what order.
    fn small_reads(cursor: Option<&str>, answers: &[Option<&str>]) -> (Result<Option<String>, &'static str>, Vec<String>) {
        let mut asked = Vec::new();
        let mut answers = answers.iter();
        let result = small_read(cursor, &mut |sent: Option<&str>| -> Result<DirectChatPage, DirectChatError> {
            asked.push(sent.unwrap_or("none").to_owned());
            Ok(DirectChatPage { messages: Vec::new(), cursor: answers.next().expect("one answer per read").map(str::to_owned), questions: None, queued: None, settled: None, activity: None })
        });
        (result.map(|page| page.cursor).map_err(|error| error.code), asked)
    }

    #[test]
    fn a_first_small_read_asks_the_size_then_the_last_32_kib() {
        assert_eq!((SMALL_READ_TAIL, SMALL_READ_OVERLAP, SMALL_READ_SIZE_PROBE), (32_768, 20_480, "999999999999"));
        assert_eq!(small_reads(None, &[Some("500000"), Some("500000")]), (Ok(Some("500000".into())), vec!["999999999999".into(), "467232".into()]));
        // a chat shorter than the tail is read whole, from 0
        assert_eq!(small_reads(None, &[Some("1200"), Some("1200")]).1, ["999999999999", "0"]);
        // a size the server does not give is a failed read, not a read from 0
        assert_eq!(small_reads(None, &[None]).0, Err("read_failed"));
    }

    #[test]
    fn a_later_small_read_starts_20_kib_before_the_cursor_and_a_shorter_chat_starts_again() {
        assert_eq!(small_reads(Some("500000"), &[Some("501000")]), (Ok(Some("501000".into())), vec!["479520".into()]));
        assert_eq!(small_reads(Some("9000"), &[Some("9000")]).1, ["0"], "never below 0");
        // the chat got shorter than where the read started: the size, then the tail
        assert_eq!(
            small_reads(Some("500000"), &[Some("4000"), Some("4000"), Some("4000")]).1,
            ["479520", "999999999999", "0"]
        );
        // a cursor that is not a number is a first read
        assert_eq!(small_reads(Some("x"), &[Some("10"), Some("10")]).1, ["999999999999", "0"]);
    }

    #[test]
    fn only_the_per_command_link_to_a_vps_reads_small() {
        let source = concat!(include_str!("direct_chat/scripts.rs"), include_str!("direct_chat/state.rs"), include_str!("direct_chat/wire.rs"), include_str!("direct_chat/host_store.rs"), include_str!("direct_chat/ssh_link.rs"), include_str!("direct_chat/local_engine.rs"), include_str!("direct_chat/runtime_integrity.rs"), include_str!("direct_chat/container_attestation.rs"), include_str!("direct_chat/container_discovery.rs"), include_str!("direct_chat/local_exec.rs"), include_str!("direct_chat/transport.rs"), include_str!("direct_chat.rs")).split("mod tests {").next().unwrap();
        let read = source.split("pub(crate) async fn direct_chat_read(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(read.contains("if connection.link == VpsLink::PerCommand && matches!(connection.validated, ValidatedHost::Vps { .. }) {\n                return small_read(cursor.as_deref(), &mut |cursor| read_page(connection, &agent_id, cursor));"));
        assert!(read.contains("read_page(connection, &agent_id, cursor.as_deref())"), "every other link reads as before");
    }

    /// A test that builds a `Connection` drops it, and with it its `Option<AppHandle>`: that drop glue
    /// links Tauri's window runtime into the test binary, whose comctl32 v6 imports a test binary
    /// (no application manifest) cannot resolve on Windows. The binary died at start with
    /// STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) and no test ran. So a test that builds one runs on Unix only.
    #[test]
    fn only_unix_tests_build_a_connection() {
        let tests = include_str!("direct_chat.rs").split_once("mod tests {").unwrap().1;
        let mut built = 0;
        // the needles in two pieces, so this very test is not one of the places it finds; the chat's state
        // holds a Connection, so building it drops one just the same
        for needle in [concat!("Connection", " {"), concat!("DirectChatInner", "::default()"), concat!("DirectChatState", "::default()")] {
            for (at, _) in tests.match_indices(needle) {
                built += 1;
                let test_start = tests[..at].rfind("#[test]").expect("inside a test");
                let attributes = &tests[..test_start];
                let attributes = &attributes[attributes.rfind('\n').map_or(0, |line| attributes[..line].rfind('\n').unwrap_or(0))..];
                assert!(attributes.contains("#[cfg(unix)]"), "{needle} built outside a Unix-only test, before byte {at}");
            }
        }
        assert!(built >= 1, "the Unix probe test builds one");
    }

    #[test]
    fn every_exit_of_the_chat_script_is_a_code_of_the_catalog_and_the_link_losing_is_its_own() {
        for (code, expected) in [
            (2, "chat_runtime_outdated"),
            (70, "existing_team_runtime_target_changed"),
            (119, "agent_not_at_prompt"),
            (120, "invalid_request"),
            (121, "team_not_running"),
            (122, "agent_not_running"),
            (123, "agent_unavailable"),
            (124, "agent_busy"),
            (125, "agent_stuck"),
            (126, "send_failed"),
            (127, "read_failed"),
            (128, "persist_failed"),
            (129, "chat_runtime_outdated"),
            (130, "composer_has_text"),
            (114, "chat_runtime_outdated"),
            (115, "answer_failed"),
            (116, "not_found"),
            (117, "invalid_choice"),
            (118, "question_closed"),
            (130, "composer_has_text"),
            (255, "tunnel_unavailable"),
            (1, "the_default"),
            (137, "the_default"),
        ] {
            assert_eq!(chat_failure(code, "the_default"), expected, "exit {code}");
        }
    }

    #[test]
    fn an_older_wrapper_that_does_not_know_the_chat_actions_keeps_the_older_path() {
        let answered = |code: i32| ProcessResult {
            code,
            stdout: b"{}".to_vec(),
        };
        assert!(
            matches!(
                wrapper_outcome(answered(0), "read_failed", false),
                Ok(Some(_))
            ),
            "the script ran"
        );
        assert!(
            matches!(
                wrapper_outcome(answered(64), "read_failed", false),
                Ok(None)
            ),
            "64: no chat actions, keep the older path"
        );
        for (code, expected) in [
            (2, "chat_runtime_outdated"),
            (124, "agent_busy"),
            (122, "agent_not_running"),
            (119, "agent_not_at_prompt"),
            (129, "chat_runtime_outdated"),
            (130, "composer_has_text"),
            (1, "read_failed"),
            (255, "tunnel_unavailable"),
        ] {
            assert_eq!(
                wrapper_outcome(answered(code), "read_failed", false)
                    .err()
                    .map(|error| error.code),
                Some(expected),
                "exit {code}"
            );
        }
        for code in [2, 64] {
            assert_eq!(
                wrapper_outcome(answered(code), "read_failed", true)
                    .err()
                    .map(|error| error.code),
                Some("local_chat_wrapper_outdated"),
                "local exit {code}"
            );
        }
    }

    #[test]
    fn local_chat_builds_all_four_checked_python_commands_without_a_wrapper() {
        use crate::existing_team_runtime::ChatOperation;

        let container = "a".repeat(64);
        let command = |operation| {
            local_chat_exec_args(&container, &operation)
                .unwrap()
                .into_iter()
                .map(|part| part.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        };
        assert_eq!(
            command(ChatOperation::Read {
                agent: "capitano",
                cursor: Some("12")
            }),
            [
                "exec",
                "-i",
                container.as_str(),
                "python3",
                "-I",
                "/app/shared/skills/agent_chat.py",
                "read",
                "capitano",
                "12"
            ]
        );
        assert_eq!(
            command(ChatOperation::Send {
                agent: "assistente",
                client_message_id: "id-1"
            })[6..],
            ["send", "assistente", "id-1"]
        );
        assert_eq!(
            command(ChatOperation::Answer {
                agent: "mentor",
                question_id: "aq:mentor:1-a"
            })[6..],
            ["answer", "mentor", "aq:mentor:1-a"]
        );
        assert_eq!(
            command(ChatOperation::Enter {
                agent: "critico",
                message_id: "message-1"
            })[6..],
            ["enter", "critico", "message-1"]
        );
        assert!(local_chat_exec_args(
            &container,
            &ChatOperation::Send {
                agent: "root",
                client_message_id: "id"
            }
        )
        .is_err());
        assert!(local_chat_exec_args(
            &container,
            &ChatOperation::Read {
                agent: "capitano",
                cursor: Some("12x")
            }
        )
        .is_err());
    }

    /// The labels of the Windows team's container as Compose v2 over the Podman socket writes them
    /// (a real container of the test machine, user name replaced): no `io.podman.compose.*` at all.
    fn windows_labels(dir: &str) -> serde_json::Value {
        serde_json::json!({
            "com.docker.compose.config-hash": "0e323430cfa29d71530d1c29a09cd8e167306d7a4e019eb2bd2f1c06b88db07f",
            "com.docker.compose.container-number": "1",
            "com.docker.compose.oneoff": "False",
            "com.docker.compose.project": "jht",
            "com.docker.compose.project.config_files": format!("{dir}\\docker-compose.yml,{dir}\\docker-compose.podman.yml"),
            "com.docker.compose.project.working_dir": dir,
            "com.docker.compose.service": "jht",
            "com.docker.compose.version": "5.1.2",
        })
    }

    #[test]
    fn the_windows_container_is_attested_by_the_compose_labels_it_really_has() {
        let dir = r"C:\Users\someone\AppData\Local\Job Hunter Team\host-runtime";
        let runtime = PathBuf::from(dir);
        assert!(windows_container_labels_are_attested(&windows_labels(dir), &runtime));
        // the spelling of the path does not matter: case, slashes, a `\\?\` prefix, a trailing separator
        let spelled = r"c:/users/SOMEONE/appdata/local/job hunter team/host-runtime";
        let mut trailing = windows_labels(spelled);
        trailing["com.docker.compose.project.working_dir"] = format!("{spelled}/").into();
        assert!(windows_container_labels_are_attested(&trailing, &runtime));
        assert!(windows_container_labels_are_attested(&windows_labels(spelled), &runtime));
        assert!(windows_container_labels_are_attested(&windows_labels(&format!(r"\\?\{dir}")), &runtime));
    }

    #[test]
    fn a_windows_profile_name_with_accents_is_the_same_in_capitals() {
        let dir = r"C:\Users\Élodie Müller\AppData\Local\Job Hunter Team\host-runtime";
        let runtime = PathBuf::from(dir);
        assert_eq!(windows_path_key(dir), windows_path_key(&dir.to_uppercase()));
        assert!(windows_container_labels_are_attested(&windows_labels(&dir.to_uppercase()), &runtime));
        assert!(windows_container_labels_are_attested(&windows_labels(&dir.to_lowercase()), &runtime));
    }

    #[cfg(unix)]
    #[test]
    fn a_runtime_reached_by_another_name_is_the_same_directory_for_the_labels() {
        // On Windows a short 8.3 name and the long one; here a link: the labels hold the resolved one.
        let base = std::env::temp_dir().canonicalize().unwrap().join(format!("jht-runtime-alias-{}", std::process::id()));
        let real = base.join("long-name");
        fs::create_dir_all(&real).unwrap();
        let alias = base.join("SHORT~1");
        std::os::unix::fs::symlink(&real, &alias).unwrap();
        let labels = windows_labels(&real.to_string_lossy());
        // the labels' separators are backslashes in the helper: build them with the real path's own
        let mut labels = labels;
        labels["com.docker.compose.project.config_files"] =
            format!("{}/docker-compose.yml,{}/docker-compose.podman.yml", real.display(), real.display()).into();
        assert!(windows_container_labels_are_attested(&labels, &alias));
        assert!(!windows_container_labels_are_attested(&labels, &base.join("elsewhere")));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn the_windows_container_must_come_from_the_image_the_runtime_pins() {
        let pin = format!("ghcr.io/leopu00/jht@sha256:{}", "a".repeat(64));
        let other = format!("ghcr.io/leopu00/jht@sha256:{}", "b".repeat(64));
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!("jht-image-pin-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        // no pin file: any digest of the repository, nothing else
        assert!(windows_container_image_is_the_runtimes(&pin, &root));
        for image in ["ghcr.io/leopu00/jht:dev-1", "docker.io/library/alpine@sha256:aaaa", "sha256:aaaa", "", &format!("ghcr.io/leopu00/jht@sha256:{}", "A".repeat(64))] {
            assert!(!windows_container_image_is_the_runtimes(image, &root), "{image}");
        }
        // a pin file: exactly its reference
        fs::write(root.join("runtime-image"), format!("{pin}\n")).unwrap();
        assert!(windows_container_image_is_the_runtimes(&pin, &root));
        assert!(!windows_container_image_is_the_runtimes(&other, &root));
        // a pin that is not a reference, or without its line end, is not a pin: nothing matches it
        fs::write(root.join("runtime-image"), "ghcr.io/leopu00/jht:dev-1\n").unwrap();
        assert!(!windows_container_image_is_the_runtimes("ghcr.io/leopu00/jht:dev-1", &root));
        fs::write(root.join("runtime-image"), &pin).unwrap();
        assert!(!windows_container_image_is_the_runtimes(&pin, &root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_inspect_line_is_split_with_the_image_only_where_it_is_asked_for() {
        assert_eq!(split_inspected("true|{\"a\":\"b\"}", false), Some(("true", "{\"a\":\"b\"}", None)));
        assert_eq!(split_inspected("true|{\"a\":\"x|y\"}|ghcr.io/leopu00/jht@sha256:00", true), Some(("true", "{\"a\":\"x|y\"}", Some("ghcr.io/leopu00/jht@sha256:00"))));
        // asked for the image and not given one: not a line to trust
        assert_eq!(split_inspected("true|{}", true), None);
        assert_eq!(split_inspected("no separator", false), None);
    }

    #[test]
    fn a_windows_container_that_the_runtime_did_not_start_is_not_attested() {
        let dir = r"C:\Users\someone\AppData\Local\Job Hunter Team\host-runtime";
        let runtime = PathBuf::from(dir);
        let other = r"C:\Users\someone\Documents\host-runtime";
        let with = |key: &str, value: serde_json::Value| {
            let mut labels = windows_labels(dir);
            labels[key] = value;
            labels
        };
        for (what, labels) in [
            ("another project", with("com.docker.compose.project", "other".into())),
            ("another service", with("com.docker.compose.service", "jht-broker".into())),
            ("a second replica", with("com.docker.compose.container-number", "2".into())),
            ("another working directory", with("com.docker.compose.project.working_dir", other.into())),
            ("other compose files", windows_labels(other)),
            (
                "one more compose file",
                with(
                    "com.docker.compose.project.config_files",
                    format!("{dir}\\docker-compose.yml,{dir}\\docker-compose.podman.yml,{other}\\x.yml").into(),
                ),
            ),
            ("only the first compose file", with("com.docker.compose.project.config_files", format!("{dir}\\docker-compose.yml").into())),
            ("no working directory", {
                let mut labels = windows_labels(dir);
                labels.as_object_mut().unwrap().remove("com.docker.compose.project.working_dir");
                labels
            }),
        ] {
            assert!(!windows_container_labels_are_attested(&labels, &runtime), "{what}");
        }
    }

    #[test]
    fn only_native_linux_podman_drops_remote_connection_selectors() {
        let podman = LocalChatEngine { program: PathBuf::from("private-engine"), podman: true };
        let docker = LocalChatEngine { program: PathBuf::from("private-engine"), podman: false };
        #[cfg(all(unix, not(target_os = "macos")))]
        assert_eq!(
            local_engine_removed_environment(&podman),
            ["CONTAINER_HOST", "CONTAINER_CONNECTION"]
        );
        #[cfg(not(all(unix, not(target_os = "macos"))))]
        assert!(local_engine_removed_environment(&podman).is_empty());
        assert!(local_engine_removed_environment(&docker).is_empty());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn local_chat_refuses_rehashed_compose_or_host_setup_without_starting_an_engine() {
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-protocol-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        fs::create_dir_all(runtime.join("bin")).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(
            runtime.join("docker-compose.yml"),
            "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n",
        )
        .unwrap();
        fs::write(runtime.join("bin/docker"), "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\nexit 91\n").unwrap();
        fs::set_permissions(runtime.join("bin/docker"), fs::Permissions::from_mode(0o700)).unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(&wrapper, "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\n").unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        write_valid_local_podman_manifest(&runtime, &wrapper);
        assert!(local_chat_runtime_valid(&wrapper, &runtime));

        fs::write(runtime.join("docker-compose.yml"), "services: {}\n").unwrap();
        write_local_podman_manifest(&runtime, &wrapper);
        assert!(!local_chat_runtime_valid(&wrapper, &runtime));

        fs::write(
            runtime.join("docker-compose.yml"),
            "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n",
        )
        .unwrap();
        fs::write(runtime.join("host-setup.sh"), "#!/bin/sh\nexit 0\n").unwrap();
        write_local_podman_manifest(&runtime, &wrapper);
        assert!(!local_chat_runtime_valid(&wrapper, &runtime));

        fs::remove_dir_all(root).unwrap();
    }

    // -- the environment the wrapper runs the compose in (the chat said «the running container is not the one Job Hunter Team installed») --

    use super::wrapper_compose_environment;

    fn host_environment(file: Option<&str>, inherited: &[(&str, &str)]) -> Vec<(&'static str, String)> {
        let inherited: Vec<(String, String)> = inherited.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
        wrapper_compose_environment(file, &|key| inherited.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone()))
    }

    fn pairs(values: &[(&'static str, &str)]) -> Vec<(&'static str, String)> {
        values.iter().map(|(k, v)| (*k, (*v).to_owned())).collect()
    }

    #[test]
    fn the_compose_environment_is_host_env_then_the_inherited_one_then_the_defaults() {
        let defaults = pairs(&[("JHT_HOST_TYPE", "unknown"), ("JHT_LANG", "en"), ("JHT_USER_TZ", "UTC")]);
        assert_eq!(host_environment(None, &[]), defaults);
        assert_eq!(host_environment(Some(""), &[]), defaults);
        // what the host setup writes on a Mac
        let file = "JHT_LANG=en\nJHT_HOST_TYPE=local\nJHT_USER_TZ=Europe/Rome\n";
        assert_eq!(host_environment(Some(file), &[]), pairs(&[("JHT_HOST_TYPE", "local"), ("JHT_LANG", "en"), ("JHT_USER_TZ", "Europe/Rome")]));
        // the file wins over the inherited environment; a key the file lacks (or has invalid) takes the inherited one
        let partial = "JHT_HOST_TYPE=vps\nJHT_LANG=xx\n";
        assert_eq!(
            host_environment(Some(partial), &[("JHT_HOST_TYPE", "local"), ("JHT_LANG", "it"), ("JHT_USER_TZ", "Asia/Tokyo")]),
            pairs(&[("JHT_HOST_TYPE", "vps"), ("JHT_LANG", "it"), ("JHT_USER_TZ", "Asia/Tokyo")]),
        );
        // an empty inherited value is the default, as `${X:-default}` has it
        assert_eq!(host_environment(None, &[("JHT_LANG", "")]), defaults);
    }

    #[test]
    fn a_mac_that_says_vps_is_recorded_as_local_like_the_wrapper_does() {
        use super::host_env_as_the_wrapper_records_it;
        let none = |_: &str| None;
        // from host.env, with the last valid line winning, quoted or not
        for text in ["JHT_HOST_TYPE=vps\n", "JHT_HOST_TYPE=local\nJHT_HOST_TYPE=vps\n", "JHT_HOST_TYPE=\"vps\"\n"] {
            let recorded = host_env_as_the_wrapper_records_it(Some(text), &none).expect(text);
            assert_eq!(host_environment(Some(&recorded), &[]).iter().find(|(key, _)| *key == "JHT_HOST_TYPE").unwrap().1, "local", "{text}");
        }
        // from the environment of the process, with no host.env
        let inherited = |key: &str| (key == "JHT_HOST_TYPE").then(|| "vps".to_owned());
        let recorded = host_env_as_the_wrapper_records_it(None, &inherited).unwrap();
        assert_eq!(host_environment(Some(&recorded), &[("JHT_HOST_TYPE", "vps")]).iter().find(|(key, _)| *key == "JHT_HOST_TYPE").unwrap().1, "local");
        // the language and the time zone are not touched
        let recorded = host_env_as_the_wrapper_records_it(Some("JHT_HOST_TYPE=vps\nJHT_LANG=it\nJHT_USER_TZ=Europe/Rome\n"), &none).unwrap();
        let environment = host_environment(Some(&recorded), &[]);
        assert_eq!(environment, vec![("JHT_HOST_TYPE", "local".to_owned()), ("JHT_LANG", "it".to_owned()), ("JHT_USER_TZ", "Europe/Rome".to_owned())]);
        // nothing to change: local, unknown, nothing at all, a value out of its domain
        for text in [Some("JHT_HOST_TYPE=local\n"), Some("JHT_LANG=it\n"), None, Some("JHT_HOST_TYPE=server\n")] {
            assert_eq!(host_env_as_the_wrapper_records_it(text, &none), None, "{text:?}");
        }
    }

    #[test]
    fn the_text_the_hash_comes_from_applies_the_rule_of_the_mac_to_every_host_type_that_is_not_the_files() {
        use super::text_the_wrapper_hashes;
        let none = |_: &str| None;
        let vps_env = |key: &str| (key == "JHT_HOST_TYPE").then(|| "vps".to_owned());
        let host_type = |text: Option<String>, inherited: &dyn Fn(&str) -> Option<String>| -> String {
            wrapper_compose_environment(text.as_deref(), inherited).into_iter().find(|(key, _)| *key == "JHT_HOST_TYPE").unwrap().1
        };
        let agent = || Some("JHT_HOST_TYPE=vps\nJHT_LANG=pt\n".to_owned());
        // no values file (or one that is not trusted: it reads as None): host.env says vps -> local
        assert_eq!(host_type(text_the_wrapper_hashes(None, &agent, &none), &none), "local");
        // a values file that is trusted and says the type: its own word, a vps stays a vps (host-setup chose it)
        assert_eq!(host_type(text_the_wrapper_hashes(Some("JHT_HOST_TYPE=vps\nJHT_LANG=en\n".to_owned()), &agent, &none), &none), "vps");
        // a trusted values file that does not say the type, and the environment says vps -> local
        assert_eq!(host_type(text_the_wrapper_hashes(Some("JHT_LANG=en\n".to_owned()), &agent, &vps_env), &vps_env), "local");
        // nothing to change: the host.env of a computer, nothing at all
        let local = || Some("JHT_HOST_TYPE=local\n".to_owned());
        assert_eq!(text_the_wrapper_hashes(None, &local, &none).as_deref(), Some("JHT_HOST_TYPE=local\n"));
        assert_eq!(text_the_wrapper_hashes(None, &|| None, &none), None);
    }

    #[cfg(unix)]
    #[test]
    fn the_host_values_of_the_runtime_folder_are_read_only_as_the_wrapper_reads_them() {
        use super::read_host_values;
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = std::env::temp_dir().join(format!("jht-host-values-{}-{}", std::process::id(), line!()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("host-values");
        let write = |mode: u32, text: &str| {
            let _ = fs::remove_file(&file);
            fs::write(&file, text).unwrap();
            fs::set_permissions(&file, fs::Permissions::from_mode(mode)).unwrap();
        };
        // a plain file of the user, private: read
        write(0o600, "JHT_HOST_TYPE=local\nJHT_LANG=it\n");
        assert_eq!(read_host_values(&file).as_deref(), Some("JHT_HOST_TYPE=local\nJHT_LANG=it\n"));
        // writable by the group or by others: not read
        for mode in [0o660, 0o606, 0o666, 0o620, 0o602, 0o662, 0o664, 0o622] {
            write(mode, "JHT_HOST_TYPE=vps\n");
            assert_eq!(read_host_values(&file), None, "{mode:o}");
        }
        // too big
        write(0o600, &"JHT_LANG=it\n".repeat(6000));
        assert_eq!(read_host_values(&file), None);
        // a link, to a good file or not
        let target = dir.join("target");
        fs::write(&target, "JHT_HOST_TYPE=vps\n").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        let _ = fs::remove_file(&file);
        symlink(&target, &file).unwrap();
        assert_eq!(read_host_values(&file), None);
        // nothing there
        let _ = fs::remove_file(&file);
        assert_eq!(read_host_values(&file), None);
        // and the environment of the compose takes the values of this file, not of host.env, when it is there
        let agent = "JHT_HOST_TYPE=vps\nJHT_LANG=pt\nJHT_USER_TZ=UTC\n";
        let mine = "JHT_HOST_TYPE=local\nJHT_LANG=it\nJHT_USER_TZ=Europe/Rome\n";
        let chosen = Some(mine).or(Some(agent));
        assert_eq!(host_environment(chosen, &[]), vec![("JHT_HOST_TYPE", "local".to_owned()), ("JHT_LANG", "it".to_owned()), ("JHT_USER_TZ", "Europe/Rome".to_owned())]);
        // the source in the hash is the wrapper's: the file of the runtime folder first, host.env second
        let source = fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/direct_chat/runtime_integrity.rs")).unwrap();
        let hash = source.split("fn mac_config_hash(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(hash.contains("read_host_values(&runtime.join(\"host-values\"))") && hash.contains("&read_host_env") && hash.contains("text_the_wrapper_hashes("));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_compose_environment_reads_host_env_as_the_wrapper_does() {
        let value = |file: &str, key: &str| host_environment(Some(file), &[]).into_iter().find(|(k, _)| *k == key).unwrap().1;
        // the last valid line wins; an invalid one never replaces a valid one
        assert_eq!(value("JHT_LANG=fr\nJHT_LANG=de\nJHT_LANG=xx\n", "JHT_LANG"), "de");
        // quotes around the whole value, spaces before the key, a carriage return at the end
        assert_eq!(value("  JHT_LANG=\"it\"\r\n", "JHT_LANG"), "it");
        assert_eq!(value("JHT_LANG='pt'\n", "JHT_LANG"), "pt");
        // a key that only starts like ours, a comment and another variable change nothing
        assert_eq!(value("JHT_LANGUAGE=it\n# JHT_LANG=it\nFOO=JHT_LANG=it\n", "JHT_LANG"), "en");
        // host type: only local or vps; time zone: only portable characters
        assert_eq!(value("JHT_HOST_TYPE=cloud\n", "JHT_HOST_TYPE"), "unknown");
        assert_eq!(value("JHT_USER_TZ=Europe/Rome; rm -rf\n", "JHT_USER_TZ"), "UTC");
        assert_eq!(value("JHT_USER_TZ=\n", "JHT_USER_TZ"), "UTC");
        assert_eq!(value("JHT_USER_TZ=Etc/GMT+1\n", "JHT_USER_TZ"), "Etc/GMT+1");
    }

    /// The layout of a Homebrew prefix under a folder of the test: `bin` with links into `Cellar/<name>/<version>/bin`,
    /// and a folder outside it. All folders 0755, as the install leaves them. (root, prefix, elsewhere)
    #[cfg(unix)]
    fn tool_layout(label: &str) -> (PathBuf, PathBuf, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!("jht-tool-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (prefix, elsewhere) = (root.join("prefix"), root.join("elsewhere"));
        for dir in [prefix.join("bin"), prefix.join("Cellar/podman/6.1.3/bin"), elsewhere.clone()] {
            fs::create_dir_all(dir).unwrap();
        }
        for dir in [&root, &prefix, &elsewhere, &prefix.join("bin"), &prefix.join("Cellar"), &prefix.join("Cellar/podman"), &prefix.join("Cellar/podman/6.1.3"), &prefix.join("Cellar/podman/6.1.3/bin")] {
            fs::set_permissions(dir, fs::Permissions::from_mode(0o755)).unwrap();
        }
        (root, prefix, elsewhere)
    }

    #[cfg(unix)]
    fn tool_program(path: &Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        fs::write(path, "#!/bin/sh\n").unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_homebrew_style_install_is_trusted_and_nothing_outside_its_roots_or_that_anyone_can_rewrite_is() {
        use super::tool_is_trusted;
        use std::os::unix::fs::symlink;
        let (root, prefix, elsewhere) = tool_layout("trust");
        let roots = [prefix.as_path()];
        // `bin/podman` -> `../Cellar/podman/6.1.3/bin/podman-remote`, as Homebrew lays it out
        tool_program(&prefix.join("Cellar/podman/6.1.3/bin/podman-remote"), 0o755);
        symlink("../Cellar/podman/6.1.3/bin/podman-remote", prefix.join("bin/podman")).unwrap();
        assert!(tool_is_trusted(&prefix.join("bin/podman"), &roots), "the link Homebrew makes");
        // a regular file in the install's own `bin` (the Podman installer's layout)
        tool_program(&prefix.join("bin/podman-compose"), 0o755);
        assert!(tool_is_trusted(&prefix.join("bin/podman-compose"), &roots));
        // a regular file, or a link to one, outside the roots is not: it is no more trusted for being a file
        tool_program(&elsewhere.join("podman"), 0o755);
        assert!(!tool_is_trusted(&elsewhere.join("podman"), &roots), "a regular file outside the roots");
        symlink(elsewhere.join("podman"), prefix.join("bin/planted")).unwrap();
        assert!(!tool_is_trusted(&prefix.join("bin/planted"), &roots), "a link out of the roots");
        // inside the roots, but a program anyone in the group or on the machine can rewrite, as a file or as a link
        tool_program(&prefix.join("bin/open-to-all"), 0o757);
        tool_program(&prefix.join("bin/open-to-group"), 0o775);
        tool_program(&prefix.join("Cellar/podman/6.1.3/bin/open-to-all"), 0o757);
        symlink("../Cellar/podman/6.1.3/bin/open-to-all", prefix.join("bin/open")).unwrap();
        for name in ["open-to-all", "open-to-group", "open"] {
            assert!(!tool_is_trusted(&prefix.join("bin").join(name), &roots), "{name}");
        }
        // a link to nothing, to a directory, a missing name, a relative name
        symlink("../Cellar/gone", prefix.join("bin/dangling")).unwrap();
        symlink("../Cellar", prefix.join("bin/directory")).unwrap();
        for name in ["dangling", "directory", "missing"] {
            assert!(!tool_is_trusted(&prefix.join("bin").join(name), &roots), "{name}");
        }
        assert!(!tool_is_trusted(Path::new("podman"), &roots));
        // the same link with another root list is no longer trusted
        assert!(!tool_is_trusted(&prefix.join("bin/podman"), &[elsewhere.as_path()]));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_anyone_can_write_in_on_the_way_to_the_tool_takes_the_trust_away() {
        use super::tool_is_trusted;
        use std::os::unix::fs::{symlink, PermissionsExt};
        let (root, prefix, _elsewhere) = tool_layout("folders");
        let roots = [prefix.as_path()];
        tool_program(&prefix.join("Cellar/podman/6.1.3/bin/podman-remote"), 0o755);
        symlink("../Cellar/podman/6.1.3/bin/podman-remote", prefix.join("bin/podman")).unwrap();
        tool_program(&prefix.join("bin/podman-compose"), 0o755);
        let podman = prefix.join("bin/podman");
        let compose = prefix.join("bin/podman-compose");
        assert!(tool_is_trusted(&podman, &roots) && tool_is_trusted(&compose, &roots));
        // each folder between the file and the root, one at a time: written by others, or by the group (outside macOS's admins)
        for (folder, tool) in [
            (prefix.join("Cellar/podman/6.1.3/bin"), &podman),
            (prefix.join("Cellar/podman/6.1.3"), &podman),
            (prefix.join("Cellar/podman"), &podman),
            (prefix.join("Cellar"), &podman),
            (prefix.join("bin"), &podman),
            (prefix.join("bin"), &compose),
            (prefix.clone(), &compose),
        ] {
            for mode in [0o757, 0o777, 0o775] {
                fs::set_permissions(&folder, fs::Permissions::from_mode(mode)).unwrap();
                let group_only = mode == 0o775;
                // a group that is not the administrators' (the test's folders are the user's own group, never gid 80 off macOS)
                let expected = group_only && super::ADMIN_GROUP == Some(std::os::unix::fs::MetadataExt::gid(&fs::metadata(&folder).unwrap()));
                assert_eq!(tool_is_trusted(tool, &roots), expected, "{} {mode:o}", folder.display());
            }
            fs::set_permissions(&folder, fs::Permissions::from_mode(0o755)).unwrap();
            assert!(tool_is_trusted(tool, &roots), "{} restored", folder.display());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_is_safe_to_the_user_and_to_root_and_to_the_administrators_group_only_where_there_is_one() {
        use super::tool_folder_is_safe;
        // (owner, group, mode, user, admin group)
        assert!(tool_folder_is_safe(501, 20, 0o755, 501, Some(80)), "the user's own, 0755");
        assert!(tool_folder_is_safe(0, 0, 0o755, 501, Some(80)), "root's");
        assert!(!tool_folder_is_safe(502, 20, 0o755, 501, Some(80)), "another user's");
        assert!(!tool_folder_is_safe(501, 20, 0o757, 501, Some(80)), "writable by others");
        assert!(!tool_folder_is_safe(501, 20, 0o777, 501, Some(80)));
        assert!(!tool_folder_is_safe(501, 20, 0o775, 501, Some(80)), "writable by a group that is not the administrators'");
        assert!(tool_folder_is_safe(501, 80, 0o775, 501, Some(80)), "Homebrew's Cellar: the administrators' group may write");
        assert!(!tool_folder_is_safe(501, 80, 0o777, 501, Some(80)), "never by others, administrators' group or not");
        assert!(!tool_folder_is_safe(501, 80, 0o775, 501, None), "no administrators' group on this system");
        // the administrators' group never stands for the owner: another account's Homebrew is refused
        assert!(!tool_folder_is_safe(502, 80, 0o775, 501, Some(80)));
        assert!(!tool_folder_is_safe(502, 80, 0o755, 501, Some(80)));
        assert!(tool_folder_is_safe(501, 80, 0o755, 501, Some(80)), "the administrators' group without writing");
    }

    #[cfg(unix)]
    #[test]
    fn the_tool_itself_is_never_writable_by_a_group_not_even_the_administrators() {
        use super::tool_file_is_safe;
        // (owner, mode, user)
        assert!(tool_file_is_safe(501, 0o755, 501) && tool_file_is_safe(501, 0o555, 501) && tool_file_is_safe(0, 0o755, 501));
        assert!(!tool_file_is_safe(501, 0o775, 501), "user:admin 0775");
        assert!(!tool_file_is_safe(501, 0o757, 501));
        assert!(!tool_file_is_safe(501, 0o777, 501));
        assert!(!tool_file_is_safe(502, 0o755, 501), "another account's");
    }

    #[cfg(unix)]
    #[test]
    fn the_tool_is_looked_for_in_the_bin_folder_of_the_roots_and_nowhere_else() {
        use super::find_trusted_tool;
        use std::os::unix::fs::symlink;
        let (root, prefix, elsewhere) = tool_layout("search");
        let second = root.join("second");
        fs::create_dir_all(second.join("bin")).unwrap();
        tool_program(&prefix.join("Cellar/podman/6.1.3/bin/podman-remote"), 0o755);
        symlink("../Cellar/podman/6.1.3/bin/podman-remote", prefix.join("bin/podman")).unwrap();
        let roots = [prefix.as_path(), second.as_path()];
        assert_eq!(find_trusted_tool("podman", &roots), Some(prefix.join("bin/podman")));
        // the same name in a folder that is not a root's `bin`, even a regular and well-kept file, is not found
        tool_program(&elsewhere.join("podman-compose"), 0o755);
        tool_program(&prefix.join("podman-compose"), 0o755);
        assert_eq!(find_trusted_tool("podman-compose", &roots), None);
        // the second root is looked in when the first has none
        tool_program(&second.join("bin/podman-compose"), 0o755);
        assert_eq!(find_trusted_tool("podman-compose", &roots), Some(second.join("bin/podman-compose")));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_expected_config_hash_is_computed_in_the_environment_the_wrapper_starts_the_container_in() {
        use super::mac_config_hash_in;
        use sha2::{Digest, Sha256};
        let (root, runtime, _wrapper, _id) = attested_local_fixture();
        // a provider whose hash depends on what the compose resolves from the environment, as the real one does
        fs::write(
            runtime.join("bin").join("podman-compose"),
            "#!/bin/sh\n[ \"${1:-}\" = --version ] && { echo 'podman-compose version 1.6.0'; exit 0; }\nh=$(printf '%s|%s|%s' \"$JHT_HOST_TYPE\" \"$JHT_LANG\" \"$JHT_USER_TZ\" | shasum -a 256 | cut -d' ' -f1)\nprintf 'podman create --name=jht --label io.podman.compose.config-hash=%s x\\n' \"$h\" >&2\n",
        )
        .unwrap();
        let sha = |text: &str| format!("{:x}", Sha256::digest(text.as_bytes()));
        let none = |_: &str| -> Option<String> { None };
        // the Mac as the host setup leaves it: the container was made with these three
        let host_env = "JHT_LANG=en\nJHT_HOST_TYPE=local\nJHT_USER_TZ=Europe/Rome\n";
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, Some(host_env), &none), Ok(sha("local|en|Europe/Rome")));
        // without host.env: the wrapper's defaults, not empty values
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Ok(sha("unknown|en|UTC")));
        fs::remove_dir_all(root).unwrap();
    }

    /// A runtime with a fake `podman` and `podman-compose` in its `bin` (the tools the hash search finds first in a
    /// test) and a machine file: (root, runtime). The caller removes `root`. `podman_says` is what `podman
    /// --version` prints, `compose` the whole script of the provider.
    #[cfg(unix)]
    fn hash_runtime(podman_script: &str, compose_script: &str) -> (PathBuf, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-hash-runtime-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        fs::create_dir_all(runtime.join("bin")).unwrap();
        fs::write(runtime.join("podman-machine"), "jht-podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services: {}\n").unwrap();
        for (name, script) in [("podman", podman_script), ("podman-compose", compose_script)] {
            let tool = runtime.join("bin").join(name);
            fs::write(&tool, script).unwrap();
            fs::set_permissions(&tool, fs::Permissions::from_mode(0o700)).unwrap();
        }
        (root, runtime)
    }

    #[cfg(unix)]
    const PODMAN_6_1_3: &str = "#!/bin/sh\n[ \"${1:-}\" = --version ] && { echo 'podman version 6.1.3'; exit 0; }\nexit 91\n";
    /// The provider's plan as the real one prints it: a create of the dependency with another hash, then the create
    /// of `jht` whose hash is `$1`.
    #[cfg(unix)]
    fn compose_plan(hash_script: &str) -> String {
        format!("#!/bin/sh\n[ \"${{1:-}}\" = --version ] && {{ echo 'podman-compose version 1.6.0'; exit 0; }}\nh=$({hash_script})\nprintf 'podman create --name=jht-telegram --label io.podman.compose.config-hash=%s x\\n' \"{}\" >&2\nprintf 'podman create --name=jht --label io.podman.compose.config-hash=%s x\\n' \"$h\" >&2\n", "b".repeat(64))
    }
    #[cfg(unix)]
    fn digest_of(text: &str) -> String {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(text.as_bytes()))
    }
    #[cfg(unix)]
    fn listed(reason: &str) -> &str {
        assert!(crate::runtime_log::ATTEST_REASONS.contains(&reason), "{reason} is not a reason the log can say");
        reason
    }
    #[cfg(unix)]
    // in pieces: the repository scan of the release forbids any whole reference to the image that is not the manifest's
    const PIN: &str = concat!("ghcr.io/leopu00/", "jht@sha256:", "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");

    #[cfg(unix)]
    #[test]
    fn the_expected_hash_follows_the_image_pin_of_the_runtime_and_a_runtime_without_a_pin_has_none_in_it() {
        // the provider's hash depends on the JHT_IMAGE it is given, as the real one does through the compose file
        let hash = "printf '%s' \"${JHT_IMAGE:-the default of the compose file}\" | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1";
        let none = |_: &str| -> Option<String> { None };
        let (root, runtime) = hash_runtime(PODMAN_6_1_3, &compose_plan(hash));
        // a test channel: runtime-image holds the pin, the container was made with it
        fs::write(runtime.join("runtime-image"), format!("{PIN}\n")).unwrap();
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Ok(digest_of(PIN)));
        // a production runtime: no pin file, the compose file's own default, and the hash is another one
        fs::remove_file(runtime.join("runtime-image")).unwrap();
        assert_eq!(
            mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none),
            Ok(digest_of("the default of the compose file"))
        );
        // a pin that is not a digest of the product's image stops the check instead of being passed on
        for bad in [&PIN[..PIN.len() - 1], "ghcr.io/leopu00/jht:latest", ""] {
            fs::write(runtime.join("runtime-image"), format!("{bad}\n")).unwrap();
            assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Err("hash_image_pin"), "{bad:?}");
        }
        fs::write(runtime.join("runtime-image"), PIN).unwrap();
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Err("hash_image_pin"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_provider_is_given_the_directory_of_the_podman_it_trusts_in_its_path_as_an_app_opened_from_finder_has_none() {
        let none = |_: &str| -> Option<String> { None };
        let (root, runtime) = hash_runtime(PODMAN_6_1_3, "");
        // podman-compose looks `podman` up by name: it says so and stops when the name does not lead to this runtime's one
        let find = format!(
            "[ \"$(command -v podman)\" = \"{}\" ] || {{ echo 'failed to check if podman is installed: No such file or directory: podman' >&2; exit 1; }}\n",
            runtime.join("bin").join("podman").display()
        );
        let script = compose_plan("printf '%s' fixed | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1");
        let script = script.replacen("[ \"${1:-}\" = --version ]", &format!("{find}[ \"${{1:-}}\" = --version ]"), 1);
        fs::write(runtime.join("bin").join("podman-compose"), script).unwrap();
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Ok(digest_of("fixed")));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_check_that_could_not_be_made_is_told_apart_from_a_container_that_is_another() {
        let none = |_: &str| -> Option<String> { None };
        let hash = "printf x | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1";
        let ask = |podman: &str, compose: &str, machine: Option<&str>| {
            let (root, runtime) = hash_runtime(podman, compose);
            match machine {
                Some(machine) => fs::write(runtime.join("podman-machine"), machine).unwrap(),
                None => fs::remove_file(runtime.join("podman-machine")).unwrap(),
            }
            let said = mac_config_hash_in(&runtime, Duration::from_secs(20), None, &none);
            fs::remove_dir_all(root).unwrap();
            said
        };
        let good = compose_plan(hash);
        let machine = Some("jht-podman\n");
        // the versions: read and other, or not readable
        assert_eq!(ask("#!/bin/sh\necho 'podman version 6.0.0'\n", &good, machine), Err("hash_podman_version_differs"));
        assert_eq!(ask("#!/bin/sh\nexit 3\n", &good, machine), Err("hash_podman_version_unreadable"));
        assert_eq!(ask(PODMAN_6_1_3, &good.replace("1.6.0", "1.5.0"), machine), Err("hash_compose_version_differs"));
        assert_eq!(ask(PODMAN_6_1_3, "#!/bin/sh\nexit 1\n", machine), Err("hash_compose_version_unreadable"));
        // the machine file
        assert_eq!(ask(PODMAN_6_1_3, &good, None), Err("hash_machine_file"));
        assert_eq!(ask(PODMAN_6_1_3, &good, Some("jht-podman")), Err("hash_machine_file"));
        assert_eq!(ask(PODMAN_6_1_3, &good, Some("a b\n")), Err("hash_machine_file"));
        // the plan: does not run, runs and says nothing of jht, says two things
        let plan = |body: &str| format!("#!/bin/sh\n[ \"${{1:-}}\" = --version ] && {{ echo 'podman-compose version 1.6.0'; exit 0; }}\n{body}\n");
        assert_eq!(ask(PODMAN_6_1_3, &plan("exit 7"), machine), Err("hash_dry_run_exit"));
        assert_eq!(ask(PODMAN_6_1_3, &plan("exit 0"), machine), Err("hash_plan_without_create"));
        assert_eq!(ask(PODMAN_6_1_3, &plan("echo 'podman create --name=jht --label io.podman.compose.config-hash=short x'"), machine), Err("hash_plan_ambiguous"));
        let two = format!(
            "echo 'podman create --name=jht --label io.podman.compose.config-hash={} x'; echo 'podman create --name=jht --label io.podman.compose.config-hash={} x'",
            "a".repeat(64),
            "c".repeat(64)
        );
        assert_eq!(ask(PODMAN_6_1_3, &plan(&two), machine), Err("hash_plan_ambiguous"));
        // the plan that takes longer than the time it is given
        let (root, runtime) = hash_runtime(PODMAN_6_1_3, &plan("sleep 5"));
        assert_eq!(mac_config_hash_in(&runtime, Duration::from_millis(500), None, &none), Err("hash_dry_run_timeout"));
        fs::remove_dir_all(root).unwrap();
        // which of these waiting may cure, and the words the log can say
        for reason in ["hash_podman_version_unreadable", "hash_compose_version_unreadable", "hash_dry_run_exit", "hash_dry_run_timeout", "hash_dry_run_not_started", "hash_plan_without_create"] {
            assert!(attest_reason_may_pass(listed(reason)), "{reason}");
        }
        for reason in ["hash_tool_missing", "hash_podman_version_differs", "hash_compose_version_differs", "hash_machine_file", "hash_image_pin", "hash_plan_ambiguous", "label_config_hash_differs", "label_project", "label_image"] {
            assert!(!attest_reason_may_pass(listed(reason)), "{reason}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_hash_that_could_not_be_worked_out_is_not_said_to_be_another_container_and_a_label_that_differs_is() {
        let runtime = PathBuf::from("/runtime");
        let labels = serde_json::json!({});
        let wrong = Ok("0".repeat(64));
        // the hash could not be worked out: a container whose labels are visibly another's is said to be, and only
        // one that looks like the installed one is left to the hash's reason
        assert_eq!(attestation_refusal(Some(&Err("hash_dry_run_timeout")), &labels, &runtime, true), Some("label_project"));
        let mut good = serde_json::json!({
            "com.docker.compose.project": "jht", "io.podman.compose.project": "jht",
            "com.docker.compose.service": "jht", "io.podman.compose.service": "jht",
            "com.docker.compose.container-number": "1",
            "com.docker.compose.project.working_dir": "/runtime", "io.podman.compose.config-hash": "a".repeat(64),
            "io.podman.compose.version": "1.6.0", "PODMAN_SYSTEMD_UNIT": podman_systemd_unit(),
        });
        good["com.docker.compose.project.config_files"] = if cfg!(target_os = "macos") {
            "/runtime/docker-compose.yml".into()
        } else {
            "/runtime/docker-compose.yml,/runtime/docker-compose.podman-linux.yml".into()
        };
        assert_eq!(attestation_refusal(Some(&Err("hash_dry_run_timeout")), &good, &runtime, true), Some("hash_dry_run_timeout"));
        assert_eq!(attestation_refusal(Some(&Err("hash_tool_missing")), &good, &runtime, true), Some("hash_tool_missing"));
        let other_unit = podman_systemd_unit().replace("jht", "other");
        for (name, wrong) in [
            ("com.docker.compose.service", "other"),
            ("com.docker.compose.project.working_dir", "/elsewhere"),
            ("com.docker.compose.project.config_files", "/elsewhere/docker-compose.yml"),
            ("io.podman.compose.version", "0.9.0"),
            ("PODMAN_SYSTEMD_UNIT", other_unit.as_str()),
        ] {
            let mut other = good.clone();
            other[name] = wrong.into();
            let refusal = attestation_refusal(Some(&Err("hash_dry_run_timeout")), &other, &runtime, true);
            assert!(refusal.is_some_and(|reason| reason.starts_with("label_")), "{name}: {refusal:?}");
        }
        // with the hash known and the labels good, the container is taken on the platforms that compare no hash; on macOS
        // the hash is compared (a hash that differs is another container)
        #[cfg(target_os = "macos")]
        {
            assert_eq!(attestation_refusal(Some(&Ok("b".repeat(64))), &good, &runtime, true), Some("label_config_hash_differs"));
            assert_eq!(attestation_refusal(Some(&Ok("a".repeat(64))), &good, &runtime, true), None);
        }
        // the hash is there: the labels are looked at, rule by rule
        let mut labels = serde_json::json!({
            "com.docker.compose.project": "other", "io.podman.compose.project": "jht",
            "com.docker.compose.service": "jht", "io.podman.compose.service": "jht",
            "com.docker.compose.container-number": "1",
            "com.docker.compose.project.working_dir": "/runtime", "io.podman.compose.config-hash": "a".repeat(64),
        });
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_project"));
        labels["com.docker.compose.project"] = "jht".into();
        labels["io.podman.compose.service"] = "x".into();
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_service"));
        labels["io.podman.compose.service"] = "jht".into();
        labels["com.docker.compose.container-number"] = "2".into();
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_container_number"));
        labels["com.docker.compose.container-number"] = "1".into();
        labels["com.docker.compose.project.working_dir"] = "/elsewhere".into();
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_working_dir"));
        labels["com.docker.compose.project.working_dir"] = "/runtime".into();
        labels["io.podman.compose.config-hash"] = "not a hash".into();
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_hash_form"));
        // what to say when none is taken: the other one wins over the one that could not be checked
        assert_eq!(container_not_found_code(Some("label_project"), Some("hash_dry_run_exit")), "local_container_not_attested");
        assert_eq!(container_not_found_code(None, Some("hash_dry_run_exit")), "container_unavailable");
        assert_eq!(container_not_found_code(None, None), "local_team_not_running");
        for reason in ["label_project", "label_service", "label_container_number", "label_working_dir", "label_hash_form", "label_image", "label_config_files", "label_compose_version", "label_systemd_unit", "label_windows"] {
            listed(reason);
        }
    }

    /// What the local chat steps (container lookup, exec) may take in a test:
    /// the fake engine is a few `sh` runs, and a loaded CI runner or the turn's
    /// parallel builds stretch them past two seconds. A refusal under test
    /// never waits this long: it fails before any engine runs.
    #[cfg(unix)]
    const LOCAL_TEST_TIMEOUT: Duration = Duration::from_secs(30);

    /// A runtime the attestation accepts, with a fake private Podman shim whose `exec` echoes its
    /// arguments and stdin: (root, runtime dir, wrapper, container id). The caller removes `root`.
    #[cfg(unix)]
    fn attested_local_fixture() -> (PathBuf, PathBuf, PathBuf, String) {
        attested_local_fixture_with(None)
    }

    /// The fixture with the engine's answer to `ps` said by the test (a shell command made from the one container as Podman
    /// lists it, with the labels of the installed runtime), or that one container.
    /// Every call of the engine is written, one first word per line, in `engine-calls.log` next to the runtime.
    #[cfg(unix)]
    fn attested_local_fixture_with(ps_arm: Option<&dyn Fn(&serde_json::Value) -> String>) -> (PathBuf, PathBuf, PathBuf, String) {
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        let bin = runtime.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n").unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(
            &wrapper,
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\ntouch \"$(dirname \"$0\")/wrapper-was-run\"\n[ \"$1:$2\" = desktop-chat:probe ] || exit 9\nprintf 'true\\n'\n",
        )
        .unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        let engine = bin.join("docker");
        let id = "a".repeat(64);
        let mut labels = serde_json::json!({
            "com.docker.compose.project": "jht",
            "io.podman.compose.project": "jht",
            "com.docker.compose.service": "jht",
            "io.podman.compose.service": "jht",
            "com.docker.compose.container-number": "1",
            "com.docker.compose.project.working_dir": runtime.to_string_lossy(),
            "io.podman.compose.config-hash": "a".repeat(64),
        });
        #[cfg(target_os = "macos")]
        labels.as_object_mut().unwrap().extend([
            ("com.docker.compose.project.config_files".to_owned(), serde_json::json!(runtime.join("docker-compose.yml"))),
            ("io.podman.compose.version".to_owned(), serde_json::json!("1.6.0")),
            ("PODMAN_SYSTEMD_UNIT".to_owned(), serde_json::json!(podman_systemd_unit())),
        ]);
        #[cfg(all(unix, not(target_os = "macos")))]
        labels.as_object_mut().unwrap().extend([
            ("com.docker.compose.project.config_files".to_owned(), serde_json::json!(format!("{}/docker-compose.yml,{}/docker-compose.podman-linux.yml", runtime.display(), runtime.display()))),
            ("io.podman.compose.version".to_owned(), serde_json::json!("1.6.0")),
            ("PODMAN_SYSTEMD_UNIT".to_owned(), serde_json::json!(podman_systemd_unit())),
        ]);
        let row = serde_json::json!({"Id": id, "State": "running", "Labels": labels, "Image": "example.invalid/jht:test"});
        let ps_arm = match ps_arm {
            Some(said) => said(&row),
            None => format!("printf '%s\\n' '{}'", serde_json::json!([row])),
        };
        let calls = root.join("engine-calls.log");
        fs::write(
            &engine,
            format!(
                "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\necho \"$1\" >> '{}'\ncase \"$1\" in\n  ps) {ps_arm} ;;\n  inspect) printf 'true|{}\\n' ;;\n  exec) printf '%s\\n' \"$*\"; cat ;;\n  *) exit 9 ;;\nesac\n",
                calls.display(),
                labels
            ),
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        #[cfg(target_os = "macos")]
        {
            fs::write(bin.join("podman"), "#!/bin/sh\n[ \"${1:-}\" = --version ] && { echo 'podman version 6.1.3'; exit 0; }\nexit 91\n").unwrap();
            fs::write(bin.join("podman-compose"), format!("#!/bin/sh\n[ \"${{1:-}}\" = --version ] && {{ echo 'provider banner'; echo 'podman-compose version 1.6.0'; exit 0; }}\n[ -z \"${{JHT_IMAGE+x}}\" ] || exit 92\nprintf 'podman create --name=jht-telegram --label io.podman.compose.config-hash={} x\\n' >&2\nprintf 'podman create --name=jht --label io.podman.compose.config-hash={} x\\n' >&2\n", "7".repeat(64), "a".repeat(64))).unwrap();
            for helper in [bin.join("podman"), bin.join("podman-compose")] { fs::set_permissions(helper, fs::Permissions::from_mode(0o700)).unwrap(); }
        }
        write_valid_local_podman_manifest(&runtime, &wrapper);
        (root, runtime, wrapper, id)
    }

    // The direct local path is a normal native process on both systems where this test runs. The
    // fake private Podman shim proves the container discovery, exact exec argv, and non-ASCII stdin
    // all survive without asking a shell or a PowerShell wrapper to reconstruct the text.
    #[cfg(unix)]
    #[test]
    fn local_chat_executes_the_attested_engines_python_with_raw_unicode_stdin() {
        use crate::existing_team_runtime::ChatOperation;

        let (root, runtime, wrapper, id) = attested_local_fixture();

        let words = "àèé € 🧭";
        let result = run_local_chat(
            &wrapper,
            &runtime,
            ChatOperation::Send {
                agent: "assistente",
                client_message_id: "id-1",
            },
            Some(words.as_bytes()),
            LOCAL_TEST_TIMEOUT,
        )
        .unwrap();
        assert_eq!(
            String::from_utf8(result.stdout).unwrap(),
            format!("exec -i {id} python3 -I /app/shared/skills/agent_chat.py send assistente id-1\n{words}")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_container_the_engine_lost_is_found_again_by_the_next_chat_call() {
        use crate::existing_team_runtime::ChatOperation;
        use std::os::unix::fs::PermissionsExt;

        let (root, runtime, wrapper, _id) = attested_local_fixture();
        let read = || {
            run_local_chat(&wrapper, &runtime, ChatOperation::Read { agent: "capitano", cursor: None }, None, LOCAL_TEST_TIMEOUT)
        };
        assert_eq!(read().unwrap().code, 0);
        // The container is gone: the engine answers 125 to the exec. The kept container is dropped.
        let engine = runtime.join("bin").join("docker");
        fs::write(&engine, "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\nexit 125\n").unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        // This call uses the kept container (or, if another test took the one slot, finds it again and
        // is refused: the engine is no longer the attested one).
        match read() {
            Ok(done) => assert_eq!(done.code, 125),
            Err(code) => assert_eq!(code, "runtime_missing"),
        }
        // The next call looks again (and is refused) instead of failing on the old id for five seconds.
        assert!(read().is_err(), "the lost container was not forgotten");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_an_engine_failure_or_a_vanished_container_empties_the_kept_one() {
        let done = |code| Ok(ProcessResult { code, stdout: Vec::new() });
        assert!(!engine_lost_the_container(&done(0)));
        // the chat script's own answers: the container is there
        for code in [2, 70, 119, 124, 126, 127, 130, 255] {
            assert!(!engine_lost_the_container(&done(code)), "{code}");
        }
        for code in [1, 3, 125] {
            assert!(engine_lost_the_container(&done(code)), "{code}");
        }
        // a slow engine is not a lost container; one that did not start is
        assert!(!engine_lost_the_container(&Err("process_timeout")));
        assert!(engine_lost_the_container(&Err("process_start_failed")));
    }

    #[test]
    fn a_podman_runtime_is_listed_once_by_the_project_and_service_labels_and_never_through_compose() {
        let podman: Vec<String> = super::local_listing_args().into_iter().map(|word| word.to_string_lossy().into_owned()).collect();
        assert_eq!(
            podman,
            ["ps", "-a", "--no-trunc", "--filter", "label=com.docker.compose.project=jht", "--filter", "label=com.docker.compose.service=jht", "--format", "json"]
        );
        // no word the Windows PowerShell of before had to be careful with: no quote, no space, no pipe
        assert!(podman.iter().all(|word| !word.contains(['"', ' ', '|'])));
        let docker: Vec<String> = local_compose_args(&LocalChatEngine { program: PathBuf::from("docker"), podman: false }, Path::new("/rt"))
            .into_iter()
            .map(|word| word.to_string_lossy().into_owned())
            .collect();
        assert_eq!(docker[0], "compose");
        assert!(docker.iter().any(|word| word == "--project-directory"));
    }

    fn listing_of(rows: &str) -> Result<Vec<super::Candidate>, &'static str> {
        super::parse_listing(rows.as_bytes())
    }

    #[test]
    fn the_podman_listing_is_read_as_podman_prints_it() {
        // the shape of `podman ps -a --format json`, with made-up values: an array, `Id`, `State`, `Labels` (an object), `Image`
        let one = r#"[{"AutoRemove":false,"Id":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","Image":"example.invalid/jht:test","ImageID":"0000","Labels":{"com.docker.compose.project":"jht","com.docker.compose.service":"jht"},"Names":["jht"],"State":"running","Status":"Up"}]"#;
        let candidates = listing_of(one).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].id, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
        assert!(candidates[0].running && candidates[0].service_is_jht());
        assert_eq!(candidates[0].image.as_deref(), Some("example.invalid/jht:test"));
        // a stopped one is listed, and is not running
        let stopped = listing_of(&one.replace("\"running\"", "\"exited\"")).unwrap();
        assert!(!stopped[0].running);
        // none listed, in the ways an engine says it
        assert!(listing_of("[]").unwrap().is_empty());
        assert!(listing_of("  \n").unwrap().is_empty());
        // labels that are not an object are no labels; no image is no image
        let bare = listing_of(r#"[{"Id":"aaaaaaaaaaaa","State":"running","Labels":null}]"#).unwrap();
        assert!(!bare[0].service_is_jht() && bare[0].image.is_none());
    }

    #[test]
    fn a_listing_that_is_not_podmans_takes_no_container() {
        for broken in ["{}", "null", "true", "[1]", "not json", r#"[{"State":"running"}]"#, r#"[{"Id":"zz","State":"running"}]"#, r#"[{"Id":"abc","State":"running"}]"#] {
            assert_eq!(listing_of(broken).err(), Some("container_unavailable"), "{broken}");
        }
        let many = format!("[{}]", vec![r#"{"Id":"aaaaaaaaaaaa","State":"running"}"#; 17].join(","));
        assert_eq!(listing_of(&many).err(), Some("container_unavailable"));
        assert_eq!(super::parse_listing(&[0xff, 0xfe]).err(), Some("container_unavailable"));
    }

    #[test]
    fn only_windows_asks_for_the_image_and_settles_a_disagreeing_listing_with_one_inspect() {
        let runtime = Path::new("/nonexistent-runtime");
        let candidate = |running: bool, service: &str, image: Option<&str>| super::Candidate {
            id: "a".repeat(64),
            running,
            labels: serde_json::json!({"com.docker.compose.service": service}),
            image: image.map(str::to_owned),
        };
        let pinned = format!("ghcr.io/leopu00/jht@sha256:{}", "b".repeat(64));
        // elsewhere the image is not asked, whatever the listing says
        assert!(super::image_is_accepted(false, None, runtime));
        assert!(!super::needs_image_inspect(false, true, &candidate(true, "jht", None), runtime));
        // on Windows: no image, or one that is not the runtime's, for a running jht of Podman -> one inspect
        assert!(!super::image_is_accepted(true, None, runtime));
        assert!(super::needs_image_inspect(true, true, &candidate(true, "jht", None), runtime));
        assert!(super::needs_image_inspect(true, true, &candidate(true, "jht", Some("example.invalid/other:latest")), runtime));
        // ...but not for what is not a candidate (stopped, another service) and not for Docker
        assert!(!super::needs_image_inspect(true, true, &candidate(false, "jht", None), runtime));
        assert!(!super::needs_image_inspect(true, true, &candidate(true, "jht-broker", None), runtime));
        assert!(!super::needs_image_inspect(true, false, &candidate(true, "jht", None), runtime));
        // the runtime's own pinned image is accepted from the listing, with no inspect
        let dir = std::env::temp_dir().join(format!("jht-image-pin-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("runtime-image"), format!("{pinned}\n")).unwrap();
        assert!(super::image_is_accepted(true, Some(&pinned), &dir));
        assert!(!super::needs_image_inspect(true, true, &candidate(true, "jht", Some(&pinned)), &dir));
        assert!(!super::image_is_accepted(true, Some("example.invalid/other:latest"), &dir));
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_container_is_found_with_one_engine_call() {
        let (root, runtime, wrapper, id) = attested_local_fixture();
        let team = AttestedLocalTeam::resolve(&wrapper, &runtime, LOCAL_TEST_TIMEOUT).unwrap();
        assert_eq!(team.container_id(), id);
        // before: a listing of ids and an inspect for each of the project's containers; now the listing is all
        let calls = fs::read_to_string(root.join("engine-calls.log")).unwrap();
        assert_eq!(calls.lines().collect::<Vec<_>>(), ["ps"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_container_rules_hold_on_the_listing() {
        fn listing(rows: Vec<serde_json::Value>) -> String {
            format!("printf '%s\\n' '{}'", serde_json::Value::Array(rows))
        }
        fn with(row: &serde_json::Value, state: &str, service: &str, id: &str) -> serde_json::Value {
            let mut changed = row.clone();
            changed["State"] = state.into();
            changed["Labels"]["com.docker.compose.service"] = service.into();
            changed["Id"] = id.into();
            changed
        }
        let aaa = "a".repeat(64);
        let bbb = "b".repeat(64);
        // each case: what the engine lists (made from the one container of the installed runtime) -> what the chat finds
        type Said = Box<dyn Fn(&serde_json::Value) -> String>;
        let cases: Vec<(&str, Said, Option<&'static str>)> = vec![
            ("the installed jht", Box::new(|row| listing(vec![row.clone()])), None),
            ("the installed jht and another service", Box::new({ let (a, b) = (aaa.clone(), bbb.clone()); move |row| listing(vec![with(row, "running", "jht", &a), with(row, "running", "jht-broker", &b)]) }), None),
            ("nothing listed", Box::new(|_| "printf '[]\\n'".to_owned()), Some("local_team_not_running")),
            ("a stopped jht", Box::new({ let a = aaa.clone(); move |row| listing(vec![with(row, "exited", "jht", &a)]) }), Some("local_team_not_running")),
            ("only the broker", Box::new({ let a = aaa.clone(); move |row| listing(vec![with(row, "running", "jht-broker", &a)]) }), Some("local_team_not_running")),
            ("a jht the runtime did not start", Box::new(|row| { let mut other = row.clone(); other["Labels"] = serde_json::json!({"com.docker.compose.service": "jht"}); listing(vec![other]) }), Some("local_container_not_attested")),
            ("the engine cannot be asked (machine off)", Box::new(|_| "echo 'cannot connect' >&2; exit 125".to_owned()), Some("local_team_not_running")),
            ("not Podman's listing", Box::new(|_| "printf 'not json\\n'".to_owned()), Some("container_unavailable")),
            ("two running jht", Box::new({ let (a, b) = (aaa.clone(), bbb.clone()); move |row| listing(vec![with(row, "running", "jht", &a), with(row, "running", "jht", &b)]) }), Some("container_unavailable")),
        ];
        for (name, said, expected) in cases {
            let (root, runtime, wrapper, id) = attested_local_fixture_with(Some(&*said));
            let found = AttestedLocalTeam::resolve(&wrapper, &runtime, LOCAL_TEST_TIMEOUT).map(|team| team.container_id().to_owned());
            match expected {
                None => assert_eq!(found, Ok(id), "{name}"),
                Some(code) => assert_eq!(found.clone().err(), Some(code), "{name}: {found:?}"),
            }
            let calls = fs::read_to_string(root.join("engine-calls.log")).unwrap();
            assert_eq!(calls.lines().collect::<Vec<_>>(), ["ps"], "{name}: one call, never an inspect or an exec");
            fs::remove_dir_all(root).unwrap();
        }
    }

    #[cfg(unix)]
    #[test]
    fn the_probe_the_python_and_the_delivery_run_in_the_attested_container_with_the_wrappers_programs() {
        use crate::existing_team_runtime::ChatOperation;
        let (launch, delivery) = (super::LOCAL_PYTHON_LAUNCH, super::LOCAL_DELIVERY_SCRIPT);
        let (root, runtime, wrapper, id) = attested_local_fixture();
        let said = |result: Result<ProcessResult, &'static str>| String::from_utf8(result.unwrap().stdout).unwrap();
        let operation = |operation: RemoteOperation<'_>, input: Option<&[u8]>| super::run_local_native(&wrapper, &runtime, &operation, input, LOCAL_TEST_TIMEOUT);
        // the probe: the container is there, nothing is run in it
        assert_eq!(said(operation(super::RemoteOperation::Probe, None)), "true\n");
        // the Python: the launcher the wrapper ran, the program on stdin
        assert_eq!(
            said(operation(super::RemoteOperation::Python, Some(b"0a"))),
            format!("exec -i {id} python3 -c {launch}\n0a")
        );
        // the delivery: the helper's line, the session as $1, the message on stdin
        assert_eq!(
            said(operation(super::RemoteOperation::Delivery("CAPITANO"), Some(b"[@utente -> @capitano] [CHAT] ciao"))),
            format!("exec -i {id} sh -c {delivery} sh CAPITANO\n[@utente -> @capitano] [CHAT] ciao")
        );
        // a session outside the chat's grammar is refused before any engine call
        for bad in ["capitano", "SCOUT-0", "SCOUT-12345", "CAPITANO; id", ""] {
            assert_eq!(operation(super::RemoteOperation::Delivery(bad), Some(b"x")).err(), Some("invalid_agent"), "{bad:?}");
        }
        assert_eq!(operation(super::RemoteOperation::Chat(ChatOperation::Read { agent: "capitano", cursor: None }), None).err(), Some("invalid_request"));
        // all of it only listed the engine and ran in the container: no inspect (the kept slot is one for the whole process, so a
        // test running at the same time may have taken it and made the container be found again)
        let calls = fs::read_to_string(root.join("engine-calls.log")).unwrap();
        assert!(calls.lines().all(|call| call == "ps" || call == "exec") && calls.lines().filter(|call| *call == "ps").count() <= 4, "{calls}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_programs_the_container_runs_carry_no_quote_and_keep_the_wrappers_meaning() {
        // no double quote in an argument: Windows PowerShell 5.1 dropped them (T71), and the engine gets these as they are
        assert!(!super::LOCAL_PYTHON_LAUNCH.contains('"') && !super::LOCAL_DELIVERY_SCRIPT.contains('"'));
        // the Python launcher is the wrapper's: read the hex of the program on the first line and run it
        assert_eq!(super::LOCAL_PYTHON_LAUNCH, "import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())");
        // the delivery keeps the message one word and its * and ? from matching files, without quotes
        assert!(super::LOCAL_DELIVERY_SCRIPT.starts_with("IFS=; set -f; msg=$(cat); exec jht-tmux-send"));
        let wrapper = include_str!("../../../scripts/jht-wrapper.ps1");
        assert!(wrapper.contains(&format!("'{}'", super::LOCAL_PYTHON_LAUNCH)), "the wrapper's launcher changed: the native one must follow");
        assert!(wrapper.contains(&format!("sh -c '{}'", super::LOCAL_DELIVERY_SCRIPT)), "the wrapper's delivery changed: the native one must follow");
    }

    #[test]
    fn the_local_operations_that_ask_the_container_no_longer_run_the_wrapper() {
        let source = concat!(include_str!("direct_chat/scripts.rs"), include_str!("direct_chat/state.rs"), include_str!("direct_chat/wire.rs"), include_str!("direct_chat/host_store.rs"), include_str!("direct_chat/ssh_link.rs"), include_str!("direct_chat/local_engine.rs"), include_str!("direct_chat/runtime_integrity.rs"), include_str!("direct_chat/container_attestation.rs"), include_str!("direct_chat/container_discovery.rs"), include_str!("direct_chat/local_exec.rs"), include_str!("direct_chat/transport.rs"), include_str!("direct_chat.rs"));
        let local = source.split("ValidatedHost::Local => {\n            crate::account_scope::verify_local_runtime_owner(").nth(1).unwrap().split("ValidatedHost::Vps { .. } => {").next().unwrap();
        assert!(!local.contains("run_verified_local_wrapper"), "the local branch of run_connection starts the wrapper again");
        assert!(local.contains("run_local_native("));
    }

    #[cfg(unix)]
    #[test]
    fn a_runtime_without_a_container_runtime_file_is_a_docker_one() {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-no-selection-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        fs::create_dir_all(&runtime).unwrap();
        // Linux with Docker never writes the file: the engine is Docker, never «the runtime is missing».
        // Whether this machine has a docker program is the machine's; the cause is told truly either way.
        match super::local_chat_engine(&runtime) {
            Ok(engine) => assert!(!engine.podman),
            Err(code) => assert_eq!(code, "container_engine_missing"),
        }
        // A file that says something else is still refused as a runtime that is not the installed one.
        fs::write(runtime.join("container-runtime"), "lxc\n").unwrap();
        assert_eq!(super::local_chat_engine(&runtime).err(), Some("runtime_missing"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_attested_team_runs_commands_in_the_one_container_without_a_wrapper() {
        let (root, runtime, wrapper, id) = attested_local_fixture();
        let team = AttestedLocalTeam::resolve(&wrapper, &runtime, LOCAL_TEST_TIMEOUT).unwrap();
        // The fake engine echoes `exec`'s arguments, then its stdin: no -i without input.
        let started = team.exec(&["node", "/app/cli/bin/jht.js", "team", "start"], None, LOCAL_TEST_TIMEOUT).unwrap();
        assert_eq!(String::from_utf8(started.stdout).unwrap(), format!("exec {id} node /app/cli/bin/jht.js team start\n"));
        let fed = team.exec(&["cat"], Some("àè".as_bytes()), LOCAL_TEST_TIMEOUT).unwrap();
        assert_eq!(String::from_utf8(fed.stdout).unwrap(), format!("exec -i {id} cat\nàè"));
        assert_eq!(attested_exec_args("not-an-id", &["x"], false).unwrap_err(), "container_unavailable");
        assert_eq!(attested_exec_args(&id, &[], false).unwrap_err(), "container_unavailable");

        // The same refusals as the chat: a bundle changed after the manifest never reaches the engine.
        fs::write(&wrapper, "changed after the manifest\n").unwrap();
        assert_eq!(AttestedLocalTeam::resolve(&wrapper, &runtime, LOCAL_TEST_TIMEOUT).err(), Some("runtime_missing"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_chat_never_runs_the_engine_when_the_runtime_bundle_is_untrusted() {
        use crate::existing_team_runtime::ChatOperation;
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-attestation-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        let bin = runtime.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n").unwrap();
        let started = root.join("engine-was-called");
        let engine = bin.join("docker");
        fs::write(&engine, format!("#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\ntouch '{}'\n", started.display())).unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(
            &wrapper,
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\nexit 1\n",
        )
        .unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        write_valid_local_podman_manifest(&runtime, &wrapper);
        fs::write(&wrapper, "changed after the manifest\n").unwrap();

        assert_eq!(
            run_local_chat(
                &wrapper,
                &runtime,
                ChatOperation::Read { agent: "capitano", cursor: None },
                None,
                LOCAL_TEST_TIMEOUT,
            )
            .unwrap_err(),
            "runtime_missing"
        );
        assert!(!started.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_chat_never_execs_when_the_discovered_container_is_not_attested() {
        use crate::existing_team_runtime::ChatOperation;
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-container-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        let bin = runtime.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n").unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(&wrapper, "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\n").unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        let executed = root.join("exec-was-called");
        let engine = bin.join("docker");
        fs::write(
            &engine,
            format!(
                "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\ncase \"$1\" in\n  ps) printf '%s\\n' '[{{\"Id\":\"{}\",\"State\":\"running\",\"Labels\":{{}}}}]' ;;\n  exec) touch '{}' ;;\n  *) exit 9 ;;\nesac\n",
                "a".repeat(64),
                executed.display(),
            ),
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        write_valid_local_podman_manifest(&runtime, &wrapper);

        assert_eq!(
            run_local_chat(
                &wrapper,
                &runtime,
                ChatOperation::Read { agent: "capitano", cursor: None },
                None,
                LOCAL_TEST_TIMEOUT,
            )
            .unwrap_err(),
            "local_team_not_running"
        );
        assert!(!executed.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_chat_names_a_running_container_the_runtime_did_not_start_as_not_attested() {
        use crate::existing_team_runtime::ChatOperation;
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-unattested-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        let bin = runtime.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n").unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(&wrapper, "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\n").unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        let executed = root.join("exec-was-called");
        let engine = bin.join("docker");
        fs::write(
            &engine,
            format!(
                "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\ncase \"$1\" in\n  ps) printf '%s\\n' '[{{\"Id\":\"{}\",\"State\":\"running\",\"Labels\":{{\"com.docker.compose.service\":\"jht\"}}}}]' ;;\n  exec) touch '{}' ;;\n  *) exit 9 ;;\nesac\n",
                "a".repeat(64),
                executed.display(),
            ),
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        // The tools the Mac works the container's hash out with, as fakes: a real Homebrew on the machine that runs the test
        // would be run against this stub runtime and not give a hash at all (which is another answer).
        for (name, script) in [("podman", PODMAN_6_1_3.to_owned()), ("podman-compose", compose_plan("printf x | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1"))] {
            fs::write(bin.join(name), script).unwrap();
            fs::set_permissions(bin.join(name), fs::Permissions::from_mode(0o700)).unwrap();
        }
        fs::write(runtime.join("podman-machine"), "jht-podman\n").unwrap();
        write_valid_local_podman_manifest(&runtime, &wrapper);

        assert_eq!(
            run_local_chat(
                &wrapper,
                &runtime,
                ChatOperation::Read { agent: "capitano", cursor: None },
                None,
                LOCAL_TEST_TIMEOUT,
            )
            .unwrap_err(),
            "local_container_not_attested"
        );
        assert!(!executed.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_chat_rejects_another_accounts_runtime_before_any_engine_lookup() {
        use crate::existing_team_runtime::ChatOperation;

        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-owner-{}",
            std::process::id(),
        ));
        fs::create_dir_all(&root).unwrap();
        let owner = root.join(".desktop-account-scope");
        fs::write(&owner, "different-account\n").unwrap();
        let scope = crate::account_scope::AccountScope::synthetic(b"local-chat-owner");
        let connection = Connection {
            app: None,
            scope,
            host: ExecutionHost::Local,
            validated: ValidatedHost::Local,
            runtime: None,
            local_wrapper: None,
            local_runtime: None,
            local_owner_marker: Some(owner),
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        };
        assert_eq!(
            run_connection(
                &connection,
                &[],
                RemoteOperation::Chat(ChatOperation::Read { agent: "capitano", cursor: None }),
                None,
                Duration::from_secs(2),
            )
            .unwrap_err()
            .code,
            "local_account_owner_mismatch"
        );
        fs::remove_dir_all(root).unwrap();
    }

    // The preamble runs on the VPS (a POSIX shell) and the test drives it with `sh` and a mode bit.
    #[cfg(unix)]
    #[test]
    fn the_remote_preamble_tells_a_wrapper_without_the_chat_marker_by_name_and_never_by_the_scripts_exit(
    ) {
        use std::os::unix::fs::PermissionsExt;
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "jht-chat-preamble-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        let command = remote_wrapper_command(&["desktop-chat".to_owned(), "read".to_owned(), "capitano".to_owned()], false);
        let answer_command = remote_wrapper_command(
            &["desktop-chat".to_owned(), "chat-answer".to_owned(), "capitano".to_owned(), "q1".to_owned()],
            true,
        );
        let run_command_with = |command: &str, wrapper: &str| {
            let binary = dir.join("jht");
            let _ = fs::remove_file(&binary);
            fs::write(&binary, wrapper).unwrap();
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
            let done = Command::new("sh")
                .arg("-c")
                .arg(command)
                .env("PATH", format!("{}:/usr/bin:/bin", dir.display()))
                .env("HOME", &dir)
                .output()
                .unwrap();
            (done.status.code(), String::from_utf8_lossy(&done.stdout).into_owned())
        };
        let run_with = |wrapper: &str| run_command_with(&command, wrapper);
        let protocol = "JHT_DESKTOP_CHAT_PROTOCOL=1\n";
        let marker = "JHT_DESKTOP_CHAT_FIXED=1\n";
        let answer_marker = "JHT_DESKTOP_CHAT_ANSWER=1\n";
        // answer and enter need their own marker too: a wrapper with only the first chat actions is 64
        assert_eq!(
            run_command_with(&answer_command, &format!("#!/bin/sh\n{protocol}{marker}printf 'ran'\n")),
            (Some(UNKNOWN_ACTION), String::new())
        );
        assert_eq!(
            run_command_with(&answer_command, &format!("#!/bin/sh\n{protocol}{marker}{answer_marker}printf 'ran:%s' \"$*\"\n")),
            (Some(0), "ran:desktop-chat chat-answer capitano q1".to_owned())
        );
        // a wrapper with the chat actions runs, with exactly the arguments given
        assert_eq!(
            run_with(&format!("#!/bin/sh\n{protocol}{marker}printf 'ran:%s' \"$*\"\n")),
            (Some(0), "ran:desktop-chat read capitano".to_owned())
        );
        // one that does not have them is told apart by its missing marker: 64, and nothing ran
        assert_eq!(run_with(&format!("#!/bin/sh\n{protocol}printf 'ran'\n")), (Some(UNKNOWN_ACTION), String::new()));
        // the script's own 2 (python3: no such file, an image older than the chat) is not «no chat actions»
        assert_eq!(run_with(&format!("#!/bin/sh\n{protocol}{marker}exit 2\n")), (Some(2), String::new()));
        // an instance of a numbered role needs the marker of the instances: without it 64, with it the arguments given
        let instance_command = remote_wrapper_command(&["desktop-chat".to_owned(), "read".to_owned(), "analista-2".to_owned()], false);
        let instances_marker = "JHT_DESKTOP_CHAT_INSTANCES=1\n";
        assert_eq!(
            run_command_with(&instance_command, &format!("#!/bin/sh\n{protocol}{marker}printf 'ran'\n")),
            (Some(UNKNOWN_ACTION), String::new())
        );
        assert_eq!(
            run_command_with(&instance_command, &format!("#!/bin/sh\n{protocol}{marker}{instances_marker}printf 'ran:%s' \"$*\"\n")),
            (Some(0), "ran:desktop-chat read analista-2".to_owned())
        );
        // the fixed ids do not ask for it: an older wrapper keeps serving them
        assert_eq!(run_with(&format!("#!/bin/sh\n{protocol}{marker}printf 'ran'\n")), (Some(0), "ran".to_owned()));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_answer_and_an_enter_from_another_window_are_refused_before_anything_else() {
        let yes = ["yes".to_owned()];
        assert!(answer_request("main", "capitano", "aq:capitano:1-a1", &yes, None).is_ok());
        assert!(enter_request("main", "capitano", "0b1c2d3e").is_ok());
        for label in ["live-screen", "broker-login", "", "main2", "Main"] {
            assert_eq!(answer_request(label, "capitano", "aq:capitano:1-a1", &yes, None).unwrap_err().code, "invalid_request", "{label:?}");
            assert_eq!(enter_request(label, "capitano", "0b1c2d3e").unwrap_err().code, "invalid_request", "{label:?}");
        }
    }

    // Unix only, like every test that builds a Connection (only_unix_tests_build_a_connection).
    #[cfg(unix)]
    #[test]
    fn an_answer_and_an_enter_never_go_through_the_read_only_link() {
        use super::{answer_impl, enter_impl, DirectChatInner};
        // An existing team opened in the read-only view: a pinned target, and no full link made for it.
        let inner = DirectChatInner::default();
        *inner.connection.lock().unwrap() = Some(Connection {
            app: None,
            scope: crate::account_scope::AccountScope::synthetic(b"synthetic-account-read-only"),
            host: ExecutionHost::Local,
            validated: ValidatedHost::Local,
            runtime: Some(crate::existing_team_runtime::ActivatedTarget::synthetic_for_tests()),
            local_wrapper: None,
            local_runtime: None,
            local_owner_marker: None,
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        });
        // the gate answers before any command: a command would have failed with its own code
        assert_eq!(
            answer_impl(
                &inner,
                "capitano",
                "aq:capitano:1-a1",
                br#"{"choices":["yes"],"text":null}"#
            )
            .unwrap_err()
            .code,
            "read_only_link"
        );
        assert_eq!(
            enter_impl(&inner, "capitano", "0b1c2d3e").unwrap_err().code,
            "read_only_link"
        );
        // the same connection with no pinned target is this computer's own team: the gate lets it by,
        // and what stops it is the next step (here, no wrapper of the person's own)
        inner.connection.lock().unwrap().as_mut().unwrap().runtime = None;
        assert_ne!(
            answer_impl(
                &inner,
                "capitano",
                "aq:capitano:1-a1",
                br#"{"choices":["yes"],"text":null}"#
            )
            .unwrap_err()
            .code,
            "read_only_link"
        );
        assert_ne!(
            enter_impl(&inner, "capitano", "0b1c2d3e").unwrap_err().code,
            "read_only_link"
        );
    }

    #[test]
    fn only_the_apps_own_window_may_write_to_an_agent() {
        assert!(window_may_write("main"));
        for label in ["live-screen", "broker-login", "", "main2", "Main"] {
            assert!(!window_may_write(label), "{label:?}");
        }
    }

    #[test]
    fn an_existing_team_is_written_to_only_with_the_full_connection() {
        let team = crate::existing_team_runtime::ActivatedTarget::synthetic_for_tests();
        assert!(!link_allows_writing(Some(&team), true, |_| false), "the read-only view reads, it never writes");
        assert!(link_allows_writing(Some(&team), false, |_| true), "the confirmed team is written to");
        assert!(link_allows_writing(None, true, |_| false), "a local team, or a marked VPS of one's own, has no read-only view of this kind");
        assert!(!link_allows_writing(None, false, |_| true), "a VPS of one's own with no mark is not written to");
    }

    #[test]
    fn connect_and_status_never_report_ready_without_a_clean_probe() {
        assert_eq!(status("connecting", None).state, "connecting");
        assert_eq!(
            status("error", Some("tunnel_unavailable")).code,
            Some("tunnel_unavailable")
        );
    }

    #[test]
    fn read_contract_parses_only_the_typed_page() {
        let raw = br#"{"messages":[{"id":"m1","role":"agent","text":"ok","at":1.0}],"cursor":"9"}"#
            .to_vec();
        let page: DirectChatPage = parse_json(
            ProcessResult {
                code: 0,
                stdout: raw,
            },
            "read_failed",
        )
        .unwrap();
        assert_eq!(page.messages[0].id, "m1");
        assert_eq!(page.cursor.as_deref(), Some("9"));
    }

    #[test]
    fn a_system_line_keeps_its_closed_code_and_a_receipt_keeps_its_state() {
        use super::DirectChatReceipt;
        let page: DirectChatPage = serde_json::from_str(
            r#"{"messages":[{"id":"s1","role":"system","text":"x","at":1.0,"code":"mail_not_taken"},{"id":"a1","role":"agent","text":"ok","at":2.0}],"cursor":"3"}"#,
        )
        .unwrap();
        assert_eq!(page.messages[0].code.as_deref(), Some("mail_not_taken"));
        assert_eq!(page.messages[1].code, None);
        let forged: DirectChatPage = serde_json::from_str(
            r#"{"messages":[{"id":"1","role":"system","text":"a","at":1.0,"code":"__proto__"},{"id":"2","role":"system","text":"b","at":2.0,"code":"constructor"},{"id":"3","role":"system","text":"c","at":3.0,"code":7},{"id":"4","role":"system","text":"d","at":4.0,"code":"unknown_code"}]}"#,
        )
        .unwrap();
        assert!(forged.messages.iter().all(|message| message.code.is_none()));
        let shown = serde_json::to_value(&page).unwrap();
        assert_eq!(shown["messages"][0]["code"], "mail_not_taken");
        assert!(shown["messages"][1].get("code").is_none());

        let queued: DirectChatReceipt = serde_json::from_str(
            r#"{"clientMessageId":"c","accepted":true,"messageId":"m","at":2.0,"state":"queued"}"#,
        )
        .unwrap();
        assert_eq!(serde_json::to_value(&queued).unwrap()["state"], "queued");
        let typed: DirectChatReceipt = serde_json::from_str(
            r#"{"clientMessageId":"c","accepted":true,"messageId":"m","at":2.0}"#,
        )
        .unwrap();
        assert!(serde_json::to_value(&typed).unwrap().get("state").is_none());
    }

    #[test]
    fn the_activity_of_the_agent_is_working_or_idle_and_anything_else_is_not_known() {
        let shown = |raw: &str| serde_json::to_value(serde_json::from_str::<DirectChatPage>(raw).unwrap()).unwrap();
        assert_eq!(shown(r#"{"messages":[],"activity":"working"}"#)["activity"], "working");
        assert_eq!(shown(r#"{"messages":[],"activity":"idle"}"#)["activity"], "idle");
        for odd in [r#""busy""#, r#""<b>x</b>""#, r#""WORKING""#, "7", "true", "null", r#"["working"]"#, r#""""#] {
            let page = shown(&format!(r#"{{"messages":[],"activity":{odd}}}"#));
            assert!(page.get("activity").is_none(), "{odd} is not known, never idle");
        }
        assert!(shown(r#"{"messages":[]}"#).get("activity").is_none(), "an older image says nothing");
    }

    #[test]
    fn a_queued_turn_is_watched_only_when_the_team_says_terminal_and_the_page_keeps_plain_ids() {
        let queued: DirectChatReceipt = serde_json::from_str(
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"state":"queued","queue":"terminal"}"#,
        )
        .unwrap();
        assert_eq!(serde_json::to_value(&queued).unwrap()["queue"], "terminal");
        // a mailbox turn has no queue to watch; a word outside the list, or a queue on a typed turn, is dropped
        for written in [
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"state":"queued"}"#,
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"state":"queued","queue":"mailbox"}"#,
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"taken":true,"queue":"terminal"}"#,
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"state":"queued","queue":7}"#,
        ] {
            let receipt: DirectChatReceipt = serde_json::from_str(written).unwrap();
            assert!(serde_json::to_value(&receipt).unwrap().get("queue").is_none(), "{written}");
        }
        let page: DirectChatPage = serde_json::from_str(
            r#"{"messages":[],"queued":["m1","a b",7,"","<b>x</b>","m2"]}"#,
        )
        .unwrap();
        assert_eq!(page.queued.as_deref(), Some(&["m1".to_owned(), "m2".to_owned()][..]));
        let ended: DirectChatPage = serde_json::from_str(
            r#"{"messages":[],"queued":[],"settled":[{"id":"m1","how":"taken"},{"id":"m2","how":"pending"},{"id":"m3","how":"unconfirmed"},{"id":"m4","how":"expired"},{"id":"m5","how":"sent"},{"id":"a b","how":"taken"},{"id":"m6"},7,{"id":"m7","how":7},{"id":"m8","how":"late"}]}"#,
        )
        .unwrap();
        let shown = serde_json::to_value(&ended).unwrap();
        assert_eq!(
            shown["settled"],
            serde_json::json!([{"id":"m1","how":"taken"},{"id":"m2","how":"pending"},{"id":"m3","how":"unconfirmed"},{"id":"m4","how":"expired"},{"id":"m8","how":"late"}])
        );
        let none: DirectChatPage = serde_json::from_str(r#"{"messages":[],"queued":[],"settled":"taken"}"#).unwrap();
        assert!(serde_json::to_value(&none).unwrap().get("settled").is_none());
        let empty: DirectChatPage = serde_json::from_str(r#"{"messages":[],"queued":[]}"#).unwrap();
        assert_eq!(serde_json::to_value(&empty).unwrap()["queued"], serde_json::json!([]));
        let older: DirectChatPage = serde_json::from_str(r#"{"messages":[]}"#).unwrap();
        assert!(serde_json::to_value(&older).unwrap().get("queued").is_none(), "an older image says nothing");
        let not_a_list: DirectChatPage = serde_json::from_str(r#"{"messages":[],"queued":"m1"}"#).unwrap();
        assert!(serde_json::to_value(&not_a_list).unwrap().get("queued").is_none());
    }

    #[test]
    fn a_message_keeps_only_a_kind_of_its_list_and_a_page_from_an_older_image_has_no_questions() {
        let page: DirectChatPage = serde_json::from_str(
            r#"{"messages":[{"id":"a1","role":"agent","text":"x","at":1.0,"kind":"urgent"},{"id":"a2","role":"agent","text":"y","at":2.0,"kind":"question"},{"id":"a3","role":"agent","text":"z","at":3.0,"kind":"URGENT"},{"id":"a4","role":"agent","text":"w","at":4.0,"kind":7},{"id":"a5","role":"agent","text":"v","at":5.0}]}"#,
        )
        .unwrap();
        let suggested: DirectChatPage = serde_json::from_str(
            r#"{"messages":[{"id":"a1","role":"agent","text":"x","at":1.0,"suggestions":["Sì","No",7,"","a\nb","Dopo","Mai","Forse","Oltre"]},{"id":"a2","role":"agent","text":"y","at":2.0,"suggestions":["Solo una"]},{"id":"s1","role":"system","text":"z","at":3.0,"code":"message_too_long"}]}"#,
        )
        .unwrap();
        // the first five, of which the out-of-shape ones are left out; a single one is no choice
        assert_eq!(suggested.messages[0].suggestions.as_deref(), Some(&["Sì".to_owned(), "No".to_owned()][..]));
        assert_eq!(suggested.messages[1].suggestions, None);
        assert_eq!(suggested.messages[2].code.as_deref(), Some("message_too_long"));
        let kinds: Vec<Option<&str>> = page.messages.iter().map(|m| m.kind.as_deref()).collect();
        assert_eq!(kinds, [Some("urgent"), None, None, None, None]);
        let shown = serde_json::to_value(&page).unwrap();
        assert_eq!(shown["messages"][0]["kind"], "urgent");
        assert!(shown["messages"][1].get("kind").is_none());
        // no `questions` in what the host wrote: none in what the page gets, so it offers no answer
        assert!(shown.get("questions").is_none());
        let empty: DirectChatPage = serde_json::from_str(r#"{"messages":[],"questions":[]}"#).unwrap();
        assert_eq!(serde_json::to_value(&empty).unwrap()["questions"], serde_json::json!([]));
        let not_a_list: DirectChatPage = serde_json::from_str(r#"{"messages":[],"questions":{"id":"q"}}"#).unwrap();
        assert!(serde_json::to_value(&not_a_list).unwrap().get("questions").is_none());
    }

    #[test]
    fn a_question_reaches_the_page_in_its_shape_or_not_at_all() {
        let good = serde_json::json!({
            "id": "aq:capitano:1792700000-a1b2c3", "at": 1792700000.5, "kind": "blocked", "subject": "Il CV",
            "text": "Mando il CV a Acme?", "options": [{"id": "yes", "label": "Sì"}, {"id": "later", "label": "Dopo"}],
            "multiple": false, "free": true, "expiresAt": 1792703600.0, "state": "answered",
            "answer": {"choices": ["yes"], "text": "va bene", "at": 1792700100.0, "origin": "user", "seenAt": null}
        });
        let page = |question: serde_json::Value| -> serde_json::Value {
            let page: DirectChatPage = serde_json::from_value(serde_json::json!({"messages": [], "questions": [question]})).unwrap();
            serde_json::to_value(&page).unwrap()["questions"].clone()
        };
        let shown = page(good.clone());
        assert_eq!(shown[0], good, "a question in its shape passes as it is");
        // asked in plain words: an empty list of options, no buttons, and it still reaches the page
        let mut plain = good.clone();
        plain["id"] = serde_json::json!("pm:11");
        plain["options"] = serde_json::json!([]);
        plain["free"] = serde_json::json!(false);
        plain["state"] = serde_json::json!("open");
        plain.as_object_mut().unwrap().remove("answer");
        assert_eq!(page(plain.clone()), serde_json::json!([plain]), "a question with no options passes as it is");
        // one field out of its shape: the question is left out whole
        for (field, value) in [
            ("id", serde_json::json!("aq capitano")),
            ("id", serde_json::json!(7)),
            ("state", serde_json::json!("closed")),
            ("text", serde_json::json!("x".repeat(4001))),
            ("at", serde_json::json!(-1)),
            ("options", serde_json::json!([{"id": "Yes!", "label": "Sì"}])),
            ("options", serde_json::json!([{"id": "a", "label": "A"}, {"id": "a", "label": "B"}])),
            ("options", serde_json::json!((0..9).map(|i| serde_json::json!({"id": format!("o{i}"), "label": "x"})).collect::<Vec<_>>())),
            ("answer", serde_json::json!({"choices": ["maybe"], "at": 1.0, "origin": "user", "seenAt": null})),
        ] {
            let mut bad = good.clone();
            bad[field] = value;
            assert_eq!(page(bad), serde_json::json!([]), "{field}");
        }
        // a kind or an origin outside its list is the plain one, never another person's answer
        let mut odd = good.clone();
        odd["kind"] = serde_json::json!("urgentissimo");
        odd["answer"]["origin"] = serde_json::json!("scadenza");
        let shown = page(odd);
        assert_eq!(shown[0]["kind"], "question");
        assert_eq!(shown[0]["answer"]["origin"], "unknown");
        // the system's own closing is said as the system's
        let mut closed = good.clone();
        closed["answer"]["origin"] = serde_json::json!("system");
        assert_eq!(page(closed)[0]["answer"]["origin"], "system");
        // a subject too long is no subject; the question stays
        let mut long = good;
        long["subject"] = serde_json::json!("s".repeat(201));
        assert!(page(long)[0].get("subject").is_none());
    }

    #[test]
    fn a_receipt_says_taken_only_with_a_boolean_and_a_reason_only_when_it_is_not_known() {
        use super::DirectChatReceipt;
        let receipt = |extra: &str| -> serde_json::Value {
            let parsed: DirectChatReceipt =
                serde_json::from_str(&format!(r#"{{"clientMessageId":"c","accepted":true,"messageId":"m","at":2.0{extra}}}"#)).unwrap();
            serde_json::to_value(&parsed).unwrap()
        };
        assert!(receipt("").get("taken").is_none(), "an older image says nothing of the composer");
        assert_eq!(receipt(r#","taken":true"#)["taken"], true);
        assert_eq!(receipt(r#","taken":false"#)["taken"], false);
        let unknown = receipt(r#","taken":null,"reason":"menu""#);
        assert!(unknown["taken"].is_null() && unknown.get("taken").is_some());
        assert_eq!(unknown["reason"], "menu");
        assert_eq!(receipt(r#","taken":null,"reason":"unconfirmed""#)["reason"], "unconfirmed");
        // anything but a boolean is «not known», never «taken»
        for odd in [r#","taken":"yes""#, r#","taken":1"#, r#","taken":{}"#] {
            let shown = receipt(odd);
            assert!(shown.get("taken").is_some() && shown["taken"].is_null(), "{odd}");
        }
        // a reason outside the list, or with a known outcome, is not said
        assert!(receipt(r#","taken":null,"reason":"<b>menu</b>""#).get("reason").is_none());
        assert!(receipt(r#","taken":null,"reason":"agent_busy""#).get("reason").is_none());
        assert!(receipt(r#","taken":false,"reason":"menu""#).get("reason").is_none());
        assert!(receipt(r#","reason":"menu""#).get("reason").is_none());
    }

    #[test]
    fn an_answer_leaves_with_checked_options_and_words_on_standard_input_only() {
        let line = |choices: &[&str], text: Option<&str>| {
            let owned: Vec<String> = choices.iter().map(|c| (*c).to_owned()).collect();
            answer_input(&owned, text).map(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).unwrap())
        };
        assert_eq!(line(&["yes"], None).unwrap(), serde_json::json!({"choices": ["yes"], "text": null}));
        assert_eq!(line(&[], Some("  ci penso io  ")).unwrap(), serde_json::json!({"choices": [], "text": "ci penso io"}));
        assert_eq!(line(&["a", "b"], Some("e anche")).unwrap()["choices"], serde_json::json!(["a", "b"]));
        let long = "w".repeat(2001);
        let nine: Vec<String> = (0..9).map(|i| format!("o{i}")).collect();
        let nine: Vec<&str> = nine.iter().map(String::as_str).collect();
        for (choices, text) in [
            (&[][..], None),
            (&[][..], Some("   ")),
            (&["Yes"][..], None),
            (&["a b"][..], None),
            (&["a", "a"][..], None),
            (&nine[..], None),
            (&["yes"][..], Some(long.as_str())),
            (&["yes"][..], Some("a\0b")),
        ] {
            assert_eq!(line(choices, text).unwrap_err().code, "invalid_request", "{choices:?} {text:?}");
        }
    }

    #[test]
    fn send_allowlist_maps_to_fixed_sessions() {
        assert!(valid_agent("assistente"));
        assert_eq!(session_for("assistente").as_deref(), Some("ASSISTENTE"));
        assert_eq!(session_for("scout").as_deref(), Some("SCOUT-1"));
        for bad in ["", "CAPITANO;touch", "dottore", "../capitano"] {
            assert!(!valid_agent(bad));
        }
    }

    #[test]
    fn an_instance_of_a_numbered_role_is_an_id_of_the_chat_and_nothing_near_it_is() {
        for (id, session) in [("scout-2", "SCOUT-2"), ("analista-12", "ANALISTA-12"), ("scorer-4", "SCORER-4"), ("scrittore-9999", "SCRITTORE-9999"), ("scout-1", "SCOUT-1")] {
            assert!(valid_agent(id), "{id}");
            assert_eq!(session_for(id).as_deref(), Some(session), "{id}");
        }
        for bad in [
            "scout-0", "scout-01", "scout-10000", "scout-", "scout-x", "scout--1", "scout-1-2", "Scout-2", "SCOUT-2", "critico-2",
            "capitano-2", "mentor-1", "closer-1", "scout_2", " scout-2", "scout-2 ", "scout-2\n", "../scout-2", "scout-2/..", "scout-2;ls", "scout-٢",
        ] {
            assert!(!valid_agent(bad), "{bad:?}");
            assert_eq!(session_for(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn every_vps_chat_command_uses_the_attested_wrapper() {
        let mut commands = vec![REMOTE_CONTAINER_PROBE.to_owned(), REMOTE_PYTHON_STDIN.to_owned()];
        commands.extend(
            [
                "CAPITANO",
                "ASSISTENTE",
                "MENTOR",
                "SCOUT-1",
                "ANALISTA-1",
                "SCORER-1",
                "SCRITTORE-1",
                "CRITICO",
                "SCOUT-2",
                "ANALISTA-12",
            ]
            .into_iter()
            .map(|session| delivery_command(session).unwrap()),
        );

        assert_eq!(commands.len(), 12);
        for command in &commands {
            assert!(command.contains("JHT_DESKTOP_CHAT_PROTOCOL=1"));
            assert!(command.contains("exec \"$JHT_BIN\" desktop-chat"));
            assert!(!command.contains("docker "));
        }
        assert!(commands[10].ends_with("desktop-chat send SCOUT-2"));
        // the id of the chat is not a session, and nothing but the closed grammar becomes one
        for bad in ["scout", "scout-2", "SCOUT-0", "SCOUT-01", "SCOUT-2;ls", "SCOUT-2 ", "CRITICO-2", "CLOSER-1", ""] {
            assert!(delivery_command(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn cleanup_status_is_explicitly_disconnected() {
        assert_eq!(status("disconnected", None).state, "disconnected");
    }

    #[test]
    fn python_payload_is_framed_as_data_not_shell_text() {
        assert_eq!(hex_encode(b"a'b"), "612762");
    }

    #[test]
    fn vps_host_store_is_a_to_logout_to_b_empty_to_a_restored_without_legacy_fallback() {
        use std::path::Path;

        let root = Path::new("/synthetic/app-data");
        let a =
            crate::account_scope::AccountScope::synthetic(b"00000000-0000-4000-8000-000000000001");
        let b =
            crate::account_scope::AccountScope::synthetic(b"00000000-0000-4000-8000-000000000002");
        let a_path = connection_config_path_at(root, &a);
        let b_path = connection_config_path_at(root, &b);
        assert_ne!(a_path, b_path);
        assert_eq!(
            a_path,
            root.join("accounts")
                .join(a.digest())
                .join("direct-chat-host.json")
        );
        assert_eq!(connection_config_path_at(root, &a), a_path);
        assert_ne!(a_path, root.join("direct-chat-host.json"));
        assert!(!b_path.starts_with(root.join(a.digest())));
    }

    #[test]
    fn migration_host_gate_accepts_only_the_exact_local_record() {
        use std::{fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-migration-host-{nonce}"));
        let scope = crate::account_scope::AccountScope::synthetic_local(b"synthetic-local");
        let path = connection_config_path_at(&root, &scope);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"kind":"local"}"#).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        }
        assert!(verify_migration_local_host_at(&root, &scope).is_ok());

        fs::write(&path, br#"{"kind":"vps","address":"synthetic.invalid"}"#).unwrap();
        assert_eq!(
            verify_migration_local_host_at(&root, &scope).unwrap_err(),
            "local_migration_host_not_local"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn migration_host_gate_never_follows_a_symlink() {
        use std::{fs, os::unix::fs::symlink, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-migration-host-link-{nonce}"));
        let scope = crate::account_scope::AccountScope::synthetic_local(b"synthetic-local");
        let path = connection_config_path_at(&root, &scope);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let target = root.join("synthetic-host.json");
        fs::write(&target, br#"{"kind":"local"}"#).unwrap();
        symlink(&target, &path).unwrap();

        assert_eq!(
            verify_migration_local_host_at(&root, &scope).unwrap_err(),
            "local_migration_host_missing"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_probe_finds_the_container_natively_and_never_runs_the_wrapper() {
        // the fixture's wrapper leaves a flag next to itself if it is ever run
        let (root, runtime, wrapper, _id) = attested_local_fixture();
        let flag = root.join("wrapper-was-run");
        let scope = crate::account_scope::AccountScope::synthetic(b"synthetic-account-a");
        let owner = root.join(".desktop-account-scope");
        fs::write(&owner, format!("{}\n", scope.digest())).unwrap();
        let connection = Connection {
            app: None,
            scope,
            host: ExecutionHost::Local,
            validated: ValidatedHost::Local,
            runtime: None,
            local_wrapper: Some(wrapper.clone()),
            local_runtime: Some(runtime.clone()),
            local_owner_marker: Some(owner),
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        };
        assert_eq!(probe(&connection).state, "ready");
        // a local chat never pays an ssh connection per read, even where ssh has no master
        assert_eq!(serde_json::to_value(probe(&connection)).unwrap(), serde_json::json!({"state": "ready"}));
        // the engine was only listed, never inspected or run in: the first probe asked once, the second used the kept container
        // (the kept slot is one for the whole process, so a test running at the same time may have taken it: at most one more)
        let calls = fs::read_to_string(root.join("engine-calls.log")).unwrap();
        assert!((1..=2).contains(&calls.lines().count()) && calls.lines().all(|call| call == "ps"), "{calls}");
        assert!(!flag.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_probe_says_why_there_is_no_container() {
        // no container listed: this computer's team is not running, the code the Messages page answers with «Start the team»
        let (root, runtime, wrapper, _id) = attested_local_fixture_with(Some(&|_| "printf '[]\\n'".to_owned()));
        let scope = crate::account_scope::AccountScope::synthetic(b"synthetic-account-a");
        let owner = root.join(".desktop-account-scope");
        fs::write(&owner, format!("{}\n", scope.digest())).unwrap();
        let connection = Connection {
            app: None,
            scope,
            host: ExecutionHost::Local,
            validated: ValidatedHost::Local,
            runtime: None,
            local_wrapper: Some(wrapper),
            local_runtime: Some(runtime),
            local_owner_marker: Some(owner),
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        };
        let failed = probe(&connection);
        assert_eq!(failed.state, "error");
        assert_eq!(failed.code, Some("local_team_not_running"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_probe_that_finds_no_container_says_not_running_on_this_computer_and_unavailable_on_a_vps() {
        assert_eq!(crate::direct_chat::probe_no_container_code(&ValidatedHost::Local), "local_team_not_running");
        let vps = ValidatedHost::Vps {
            address: "203.0.113.7".into(),
            user: "jht".into(),
            port: 22,
            key_path: PathBuf::from("/nonexistent/key"),
            known_hosts: PathBuf::from("/nonexistent/known_hosts"),
        };
        assert_eq!(crate::direct_chat::probe_no_container_code(&vps), "container_unavailable");
        // a host that could not be asked at all stays «unavailable», whichever it is
        let source = concat!(include_str!("direct_chat/scripts.rs"), include_str!("direct_chat/state.rs"), include_str!("direct_chat/wire.rs"), include_str!("direct_chat/host_store.rs"), include_str!("direct_chat/ssh_link.rs"), include_str!("direct_chat/local_engine.rs"), include_str!("direct_chat/runtime_integrity.rs"), include_str!("direct_chat/container_attestation.rs"), include_str!("direct_chat/container_discovery.rs"), include_str!("direct_chat/local_exec.rs"), include_str!("direct_chat/transport.rs"), include_str!("direct_chat.rs"));
        let body = source.split("fn probe_unlogged(connection: &Connection)").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(body.contains("Err(_) => status(\"error\", Some(\"container_unavailable\"))"));
        assert!(body.contains("tunnel_unavailable"));
    }
}

#[cfg(test)]
mod assistance_registration_tests {
    use super::*;
    struct Temporary(PathBuf);
    impl Temporary {
        fn new() -> Self {
            // Two tests starting in the same clock tick must not share a name: a counter breaks the tie.
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "jht-assistance-register-{}-{nonce}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn path(&self) -> PathBuf {
            self.0.join("account/direct-chat-host.json")
        }
    }
    impl Drop for Temporary {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn host(label: &str) -> ExecutionHost {
        ExecutionHost::Vps {
            address: format!("{label}.invalid"),
            user: "fixture".into(),
            port: 22,
            key_path: "/fixture/key".into(),
        }
    }
    #[test]
    fn absent_host_is_private_and_same_host_keeps_exact_bytes() {
        let temp = Temporary::new();
        let path = temp.path();
        register_assistance_host_at(&path, &host("one")).unwrap();
        assert_eq!(
            serde_json::from_slice::<ExecutionHost>(&fs::read(&path).unwrap()).unwrap(),
            host("one")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        // Exact existing bytes, including harmless whitespace, are preserved.
        let mut bytes = fs::read(&path).unwrap();
        bytes.push(b'\n');
        fs::write(&path, &bytes).unwrap();
        register_assistance_host_at(&path, &host("one")).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }
    #[test]
    fn different_existing_host_is_never_overwritten() {
        let temp = Temporary::new();
        let path = temp.path();
        register_assistance_host_at(&path, &host("one")).unwrap();
        let before = fs::read(&path).unwrap();
        assert_eq!(
            register_assistance_host_at(&path, &host("two")),
            Err("browser_connection_changed")
        );
        assert_eq!(fs::read(&path).unwrap(), before);
    }
    #[test]
    fn malformed_oversize_extra_fields_and_nonfile_deny_without_repair() {
        let temp = Temporary::new();
        let path = temp.path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut extra = serde_json::to_value(host("one")).unwrap();
        extra["container_id"] = json!("spoof");
        for bytes in [
            b"{".to_vec(),
            vec![b' '; 4097],
            serde_json::to_vec(&extra).unwrap(),
        ] {
            fs::write(&path, &bytes).unwrap();
            assert_eq!(
                register_assistance_host_at(&path, &host("one")),
                Err("host_config_invalid")
            );
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert_eq!(
            register_assistance_host_at(&path, &host("one")),
            Err("host_config_invalid")
        );
        assert!(path.is_dir());
    }
    #[test]
    fn host_alias_cannot_replace_other_account_config() {
        let temp = Temporary::new();
        let path = temp.path();
        let scope = AccountScope::synthetic(b"assistance-a");
        let other = AccountScope::synthetic(b"assistance-b");
        assert_ne!(
            connection_config_path_at(&temp.0, &scope),
            connection_config_path_at(&temp.0, &other)
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let target = temp.0.join("other-host.json");
            let bytes = serde_json::to_vec(&host("two")).unwrap();
            fs::write(&target, &bytes).unwrap();
            symlink(&target, &path).unwrap();
            assert_eq!(
                register_assistance_host_at(&path, &host("one")),
                Err("host_config_invalid")
            );
            assert_eq!(fs::read(&target).unwrap(), bytes);
            assert!(fs::symlink_metadata(&path)
                .unwrap()
                .file_type()
                .is_symlink());
        }
    }
    #[test]
    fn two_registrations_serialize_and_only_one_host_wins() {
        let temp = Temporary::new();
        let path = temp.path();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let children: Vec<_> = ["one", "two"]
            .into_iter()
            .map(|label| {
                let path = path.clone();
                let barrier = barrier.clone();
                thread::spawn(move || {
                    barrier.wait();
                    (
                        host(label),
                        register_assistance_host_at(&path, &host(label)),
                    )
                })
            })
            .collect();
        let results: Vec<_> = children
            .into_iter()
            .map(|child| child.join().unwrap())
            .collect();
        assert_eq!(
            results.iter().filter(|(_, result)| result.is_ok()).count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|(_, result)| *result == Err("browser_connection_changed"))
                .count(),
            1
        );
        let persisted: ExecutionHost = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            &persisted,
            &results.iter().find(|(_, result)| result.is_ok()).unwrap().0
        );
    }

    /// The team-language script as the container runs it, with a folder standing in for `/jht_home`.
    /// Returns the exit code and what the script printed.
    #[cfg(unix)]
    fn run_team_language(home: &Path, bootstrap: Option<&str>, request: serde_json::Value) -> (i32, serde_json::Value) {
        use std::io::Write;
        assert_eq!(super::TEAM_LANGUAGE_PY.matches("home='/jht_home'").count(), 1, "the script's home changed: update this test");
        let script = super::TEAM_LANGUAGE_PY.replace("home='/jht_home'", &format!("home='{}'", home.display()));
        let input = super::python_input(&script, &request).unwrap();
        let mut command = Command::new("python3");
        command
            .args(["-c", "import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())"])
            .env_remove("JHT_LANG")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped());
        if let Some(lang) = bootstrap {
            command.env("JHT_LANG", lang);
        }
        let mut child = command.spawn().unwrap();
        child.stdin.take().unwrap().write_all(&input).unwrap();
        let output = child.wait_with_output().unwrap();
        let reply = serde_json::from_slice(&output.stdout).unwrap_or(serde_json::Value::Null);
        (output.status.code().unwrap_or(-1), reply)
    }

    #[cfg(unix)]
    fn team_language_home(label: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("jht-team-language-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        home
    }

    #[cfg(unix)]
    #[test]
    fn a_team_with_no_language_chosen_speaks_english_and_takes_the_one_set_once() {
        let home = team_language_home("fresh");
        let (code, read) = run_team_language(&home, None, json!({"op": "read"}));
        assert_eq!((code, &read), (0, &json!({"locale": "en", "stored": null})));
        let (code, set) = run_team_language(&home, None, json!({"op": "set", "locale": "it"}));
        assert_eq!((code, &set), (0, &json!({"locale": "it", "stored": "it", "changed": true})));
        // the same artefact the game's language setting writes, replaced whole
        let file: serde_json::Value = serde_json::from_slice(&fs::read(home.join("i18n-prefs.json")).unwrap()).unwrap();
        assert_eq!(file, json!({"locale": "it"}));
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(home.join("i18n-prefs.json")).unwrap().permissions().mode() & 0o777, 0o644);
        assert_eq!(fs::read_dir(&home).unwrap().count(), 1, "no temporary file left behind");
        let (_, read) = run_team_language(&home, None, json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "it", "stored": "it"}));
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn the_default_english_written_by_the_installer_is_replaced_but_a_chosen_language_never_is() {
        let home = team_language_home("chosen");
        // what the host setup leaves: English, in the file and in host.env
        fs::write(home.join("i18n-prefs.json"), "{\n  \"locale\": \"en\"\n}\n").unwrap();
        fs::write(home.join("host.env"), "JHT_LANG=en\n").unwrap();
        let (_, set) = run_team_language(&home, None, json!({"op": "set", "locale": "it"}));
        assert_eq!(set, json!({"locale": "it", "stored": "it", "changed": true}));
        // now it is chosen: another set changes nothing, whatever it asks
        for locale in ["de", "en"] {
            let (code, set) = run_team_language(&home, None, json!({"op": "set", "locale": locale}));
            assert_eq!((code, &set), (0, &json!({"locale": "it", "stored": "it", "changed": false})));
        }
        assert_eq!(fs::read_to_string(home.join("i18n-prefs.json")).unwrap().trim(), "{\n  \"locale\": \"it\"\n}");
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn a_language_given_by_the_environment_or_host_env_counts_as_chosen_and_is_not_overwritten() {
        let home = team_language_home("bootstrap");
        let (_, read) = run_team_language(&home, Some("hu"), json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "hu", "stored": null}));
        let (_, set) = run_team_language(&home, Some("hu"), json!({"op": "set", "locale": "it"}));
        assert_eq!(set, json!({"locale": "hu", "stored": null, "changed": false}));
        assert!(!home.join("i18n-prefs.json").exists(), "nothing was written");
        fs::write(home.join("host.env"), "FOO=1\nJHT_LANG=\"fr\"\n").unwrap();
        let (_, read) = run_team_language(&home, None, json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "fr", "stored": null}));
        // an unknown value anywhere is skipped, as every reader of the language skips it
        fs::write(home.join("host.env"), "JHT_LANG=xx\n").unwrap();
        fs::write(home.join("i18n-prefs.json"), "{\"locale\": \"klingon\"}").unwrap();
        let (_, read) = run_team_language(&home, Some("zz"), json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "en", "stored": null}));
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn the_person_s_own_choice_replaces_the_team_s_language_and_the_same_one_writes_nothing() {
        let home = team_language_home("choose");
        // a team the app aligned to the first screen's language, then a person who picks another one
        let (_, set) = run_team_language(&home, None, json!({"op": "set", "locale": "fr"}));
        assert_eq!(set, json!({"locale": "fr", "stored": "fr", "changed": true}));
        let (code, chose) = run_team_language(&home, None, json!({"op": "choose", "locale": "de"}));
        assert_eq!((code, &chose), (0, &json!({"locale": "de", "stored": "de", "changed": true})));
        // back to English is a choice too: the file says it, the environment no longer decides
        let (_, chose) = run_team_language(&home, Some("pt"), json!({"op": "choose", "locale": "en"}));
        assert_eq!(chose, json!({"locale": "en", "stored": "en", "changed": true}));
        let (_, read) = run_team_language(&home, Some("pt"), json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "en", "stored": "en"}));
        // the language the file already says: nothing written
        let before = fs::metadata(home.join("i18n-prefs.json")).unwrap().modified().unwrap();
        let (_, same) = run_team_language(&home, None, json!({"op": "choose", "locale": "en"}));
        assert_eq!(same, json!({"locale": "en", "stored": "en", "changed": false}));
        assert_eq!(fs::metadata(home.join("i18n-prefs.json")).unwrap().modified().unwrap(), before);
        // a language given only by host.env is replaced by a choice, which the file then keeps
        let other = team_language_home("choose-host-env");
        fs::write(other.join("host.env"), "JHT_LANG=en\n").unwrap();
        let (_, chose) = run_team_language(&other, None, json!({"op": "choose", "locale": "es"}));
        assert_eq!(chose, json!({"locale": "es", "stored": "es", "changed": true}));
        assert_eq!(fs::read_to_string(other.join("host.env")).unwrap(), "JHT_LANG=en\n", "host.env is the install's, not touched");
        let (code, _) = run_team_language(&other, None, json!({"op": "choose", "locale": "xx"}));
        assert_eq!(code, 2);
        let _ = fs::remove_dir_all(&home);
        let _ = fs::remove_dir_all(&other);
    }

    #[cfg(unix)]
    #[test]
    fn the_team_language_script_refuses_a_language_it_does_not_have_and_writes_nothing() {
        let home = team_language_home("refused");
        for request in [json!({"op": "set", "locale": "xx"}), json!({"op": "set"}), json!({"op": "wipe"})] {
            let (code, _) = run_team_language(&home, None, request);
            assert_eq!(code, 2);
        }
        assert_eq!(fs::read_dir(&home).unwrap().count(), 0);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn a_team_language_reply_outside_the_seven_languages_is_not_believed() {
        let reply = |locale: &str, stored: Option<&str>| super::TeamLanguage {
            locale: locale.to_owned(),
            stored: stored.map(str::to_owned),
            changed: None,
        };
        assert!(super::checked_team_language(reply("it", None)).is_some());
        assert!(super::checked_team_language(reply("pt", Some("en"))).is_some());
        assert!(super::checked_team_language(reply("xx", None)).is_none());
        assert!(super::checked_team_language(reply("it", Some("xx"))).is_none());
    }

    #[test]
    fn the_team_language_commands_are_the_app_windows_and_the_write_goes_through_the_one_gate() {
        let source = concat!(include_str!("direct_chat/scripts.rs"), include_str!("direct_chat/state.rs"), include_str!("direct_chat/wire.rs"), include_str!("direct_chat/host_store.rs"), include_str!("direct_chat/ssh_link.rs"), include_str!("direct_chat/local_engine.rs"), include_str!("direct_chat/runtime_integrity.rs"), include_str!("direct_chat/container_attestation.rs"), include_str!("direct_chat/container_discovery.rs"), include_str!("direct_chat/local_exec.rs"), include_str!("direct_chat/transport.rs"), include_str!("direct_chat.rs"));
        let set = source.split("pub(crate) async fn direct_chat_team_language_set(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(set.contains("!window_may_write(window.label())"), "only the app's own window may write the language");
        // the two ways of writing (over the English only, or the person's own choice), and nothing else
        assert!(set.contains("let op = if choose == Some(true) { \"choose\" } else { \"set\" };"));
        assert!(set.contains("team_language_impl(inner, json!({\"op\": op, \"locale\": locale}), true, \"persist_failed\")"), "both write as a write");
        let implementation = source.split("fn team_language_impl(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(implementation.contains("if write {\n        refuse_writing(connection)?;"), "a write goes through the gate of every write to the team");
        let read = source.split("pub(crate) async fn direct_chat_team_language(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(read.contains("\"op\": \"read\"") && read.contains(", false, "), "the read never asks to write");
    }
}

#[cfg(test)]
mod attachment_command_tests {
    use super::*;
    use std::fs;

    // Unix only, like every test that builds a Connection (only_unix_tests_build_a_connection).
    #[cfg(unix)]
    #[test]
    fn the_paperclip_is_on_only_for_this_computers_team_and_says_why_it_is_off() {
        let connection = |validated: ValidatedHost, with_runtime: bool| Connection {
            app: None,
            scope: crate::account_scope::AccountScope::synthetic(b"attach-tests"),
            host: ExecutionHost::Local,
            validated,
            runtime: None,
            local_wrapper: with_runtime.then(|| PathBuf::from("/nonexistent/jht")),
            local_runtime: with_runtime.then(|| PathBuf::from("/nonexistent/runtime")),
            local_owner_marker: None,
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        };
        assert_eq!(attach_refusal(&connection(ValidatedHost::Local, false)), Some("attach_not_connected"));
        let vps = ValidatedHost::Vps {
            address: "203.0.113.7".into(),
            user: "jht".into(),
            port: 22,
            key_path: PathBuf::from("/nonexistent/key"),
            known_hosts: PathBuf::from("/nonexistent/known_hosts"),
        };
        assert_eq!(attach_refusal(&connection(vps, true)), Some("attach_vps"));
        let local = attach_refusal(&connection(ValidatedHost::Local, true));
        if cfg!(any(target_os = "macos", target_os = "linux")) {
            assert_eq!(local, None);
        } else {
            assert_eq!(local, Some("attach_platform"));
        }
    }

    #[test]
    fn the_person_reads_one_sentence_in_their_language_and_the_assistant_gets_the_path_behind_it() {
        // a document says «my CV»; a picture or a plain text, which is not known to be one, says «a file»
        for (file, cv) in [
            ("cv-20261028-153045.pdf", true),
            ("cv-20261028-153045.docx", true),
            ("cv-20261028-153045.odt", true),
            ("cv-20261028-153045.rtf", true),
            ("cv-20261028-153045.txt", false),
            ("cv-20261028-153045.md", false),
            ("cv-20261028-153045.png", false),
            ("cv-20261028-153045.jpg", false),
            ("cv-20261028-153045-2.jpg", false),
        ] {
            let path = format!("/jht_user/allegati/{file}");
            let mut said = std::collections::HashSet::new();
            for locale in ["it", "en", "de", "es", "fr", "hu", "pt", "xx", ""] {
                let text = attachment_message(locale, file);
                // the Assistant gets the path of our copy, on one line, and what it is for
                assert!(text.ends_with(&format!(" [attachment for my profile: {path}]")), "{locale} {file}");
                assert!(!text.contains('\n') && !text.contains('{') && text.len() < 200, "{locale} {file}");
                // the person gets a sentence: no path, no folder, no name of a file, no brackets
                let (visible, _) = text.split_once(" [attachment").unwrap();
                assert!(!visible.contains("jht_user") && !visible.contains(file) && !visible.contains('/') && !visible.contains('['), "{locale} {file}");
                assert!(visible.ends_with('.') && visible.len() > 10, "{locale} {file}");
                said.insert(visible.to_owned());
            }
            // seven languages, seven sentences (an unknown one and the empty one are English)
            assert_eq!(said.len(), 7, "{file}");
            let it = attachment_message("it", file);
            assert_eq!(it.starts_with("Ho allegato il mio CV. ["), cv, "{file}");
            assert_eq!(it.starts_with("Ho allegato un file. ["), !cv, "{file}");
        }
        // the Portuguese of Portugal, as the rest of the product
        assert!(attachment_message("pt", "cv-1.pdf").starts_with("Anexei o meu CV. ["));
        assert!(attachment_message("pt", "cv-1.png").starts_with("Anexei um ficheiro. ["));
        assert!(attachment_message("xx", "cv-1.pdf").starts_with("I attached my CV. ["));
        assert!(attachment_message("xx", "cv-1.png").starts_with("I attached a file. ["));
    }

    #[test]
    fn the_window_opens_on_downloads_when_the_person_has_that_folder_and_never_on_documents() {
        let home = std::env::temp_dir().join(format!("jht-downloads-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(home.join("Documents")).unwrap();
        assert_eq!(downloads_of(&home), None);
        fs::write(home.join("Downloads"), b"a file, not a folder").unwrap();
        assert_eq!(downloads_of(&home), None);
        fs::remove_file(home.join("Downloads")).unwrap();
        fs::create_dir_all(home.join("Downloads")).unwrap();
        assert_eq!(downloads_of(&home), Some(home.join("Downloads")));
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_second_attachment_is_refused_while_one_is_in_hand_and_allowed_after() {
        // the flag alone, never the chat's state: that holds a Connection, and a test that drops one
        // does not start on Windows (see only_unix_tests_build_a_connection)
        let busy = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let first = AttachGuard::take(&busy).expect("the first is taken");
        assert!(AttachGuard::take(&busy).is_none());
        drop(first);
        assert!(AttachGuard::take(&busy).is_some());
    }

    #[test]
    fn the_command_checks_before_it_opens_the_window_and_tells_the_assistant_only_what_the_team_sees() {
        let source = concat!(include_str!("direct_chat/scripts.rs"), include_str!("direct_chat/state.rs"), include_str!("direct_chat/wire.rs"), include_str!("direct_chat/host_store.rs"), include_str!("direct_chat/ssh_link.rs"), include_str!("direct_chat/local_engine.rs"), include_str!("direct_chat/runtime_integrity.rs"), include_str!("direct_chat/container_attestation.rs"), include_str!("direct_chat/container_discovery.rs"), include_str!("direct_chat/local_exec.rs"), include_str!("direct_chat/transport.rs"), include_str!("direct_chat.rs"));
        let command = source
            .split("pub(crate) async fn direct_chat_attach(")
            .nth(1)
            .unwrap()
            .split("\n}\n")
            .next()
            .unwrap();
        let at = |needle: &str| command.find(needle).unwrap_or_else(|| panic!("missing {needle}"));
        // only the app's own window, only the Assistant, one at a time
        assert!(at("window_may_write(") < at("AttachGuard::take"));
        assert!(command.contains("agent_id != \"assistente\""));
        // the same gate as a message, then the window, then the copy, then the proof, then the message
        assert!(at("attach_target(") < at("blocking_pick_file()"));
        assert!(at("blocking_pick_file()") < at("chat_attachment::store("));
        assert!(at("chat_attachment::store(") < at("team_sees_the_copy("));
        assert!(at("team_sees_the_copy(") < at("send_impl("));
        // a copy the team does not see is taken back, and nothing is told
        assert!(at("chat_attachment::remove(") < at("send_impl("));
        // the text is ours: built from the name of our copy, never from the page or the person's file
        assert!(command.contains("attachment_message(&locale, &saved.file)"));
        // the window opens where the person keeps downloads, and the copy is named by the local clock
        assert!(command.contains("set_directory(") && command.contains("target.start_dir"));
        assert!(command.contains("local_wall_clock("));
        // the person's own name goes back to their screen, never into the message or a log
        assert!(!command.contains("attachment_message(&locale, &saved.display)"));
    }
}

#[cfg(test)]
mod chat_call_log_tests {
    use super::*;

    fn at(seconds: u64, origin: Instant) -> Instant {
        origin + Duration::from_secs(seconds)
    }

    #[test]
    fn a_failure_is_written_once_until_its_code_changes_or_a_call_works() {
        let origin = Instant::now();
        let mut last = LoggedCall::NONE;
        let failed = |code| Err((code, None));
        let took = Duration::from_millis(200);
        assert_eq!(chat_call_line(&mut last, failed("read_failed"), took, at(0, origin)), Some(("read_failed", None)));
        // every two seconds, the same failure: nothing new
        assert_eq!(chat_call_line(&mut last, failed("read_failed"), took, at(2, origin)), None);
        assert_eq!(chat_call_line(&mut last, failed("read_failed"), took, at(4, origin)), None);
        // another code, or the same code for another reason of the container check, is new
        assert_eq!(chat_call_line(&mut last, failed("process_timeout"), took, at(6, origin)), Some(("process_timeout", None)));
        assert_eq!(
            chat_call_line(&mut last, Err(("local_container_not_attested", Some("label_config_hash_differs"))), took, at(8, origin)),
            Some(("local_container_not_attested", Some("label_config_hash_differs")))
        );
        // a call that works ends the failure: the same failure after it is a new one
        assert_eq!(chat_call_line(&mut last, Ok(()), took, at(10, origin)), None);
        assert_eq!(chat_call_line(&mut last, failed("process_timeout"), took, at(12, origin)), Some(("process_timeout", None)));
    }

    #[test]
    fn a_call_that_worked_is_written_only_when_slow_and_not_again_for_a_while() {
        let origin = Instant::now();
        let mut last = LoggedCall::NONE;
        assert_eq!(chat_call_line(&mut last, Ok(()), SLOW_CHAT_CALL - Duration::from_millis(1), at(0, origin)), None);
        assert_eq!(chat_call_line(&mut last, Ok(()), SLOW_CHAT_CALL, at(1, origin)), Some(("ok_slow", None)));
        // the next slow ones within the pause are not written, the one after it is
        assert_eq!(chat_call_line(&mut last, Ok(()), Duration::from_secs(9), at(10, origin)), None);
        assert_eq!(chat_call_line(&mut last, Ok(()), Duration::from_secs(9), at(1 + 30, origin)), Some(("ok_slow", None)));
        // a fast call is never written
        assert_eq!(chat_call_line(&mut last, Ok(()), Duration::from_millis(900), at(100, origin)), None);
    }

    #[test]
    fn each_kind_of_call_has_its_own_memory_and_the_log_says_operation_code_and_time() {
        let dir = std::env::temp_dir().join(format!("jht-chat-call-log-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let log = crate::runtime_log::RuntimeLog::in_dir(&dir);
        let memory = Mutex::new([LoggedCall::NONE; 6]);
        // a probe that failed after 8.7 s, a read that failed fast, a send that worked slowly
        log_chat_call_in(&memory, Some(&log), "probe", Err("container_unavailable"), Duration::from_millis(8_700));
        log_chat_call_in(&memory, Some(&log), "read", Err("read_failed"), Duration::from_millis(120));
        log_chat_call_in(&memory, Some(&log), "send", Ok(()), Duration::from_secs(7));
        // the same probe failure again, and a fast probe: nothing more
        log_chat_call_in(&memory, Some(&log), "probe", Err("container_unavailable"), Duration::from_millis(9_000));
        log_chat_call_in(&memory, Some(&log), "connect", Ok(()), Duration::from_millis(300));
        // an operation outside the list leaves nothing
        log_chat_call_in(&memory, Some(&log), "format_disk", Err("read_failed"), Duration::from_secs(1));
        let text = fs::read_to_string(log.path()).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 3, "{text}");
        assert!(lines[0].contains(" direct_chat.probe: container_unavailable took_ms=8700"), "{text}");
        assert!(lines[1].contains(" direct_chat.read: read_failed took_ms=120"), "{text}");
        assert!(lines[2].contains(" direct_chat.send: ok_slow took_ms=7000"), "{text}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn every_call_of_the_chat_ends_in_the_log() {
        let source = concat!(include_str!("direct_chat/scripts.rs"), include_str!("direct_chat/state.rs"), include_str!("direct_chat/wire.rs"), include_str!("direct_chat/host_store.rs"), include_str!("direct_chat/ssh_link.rs"), include_str!("direct_chat/local_engine.rs"), include_str!("direct_chat/runtime_integrity.rs"), include_str!("direct_chat/container_attestation.rs"), include_str!("direct_chat/container_discovery.rs"), include_str!("direct_chat/local_exec.rs"), include_str!("direct_chat/transport.rs"), include_str!("direct_chat.rs"));
        for (name, call) in [
            ("pub(crate) async fn direct_chat_read(", "\"read\""),
            ("pub(crate) async fn direct_chat_send(", "\"send\""),
            ("pub(crate) async fn direct_chat_answer(", "\"answer\""),
            ("pub(crate) async fn direct_chat_enter(", "\"enter\""),
            ("async fn connect_scoped(", "\"connect\""),
            ("fn probe(connection: &Connection)", "\"probe\""),
        ] {
            let body = source.split(name).nth(1).unwrap_or_else(|| panic!("{name}")).split("\n}\n").next().unwrap();
            assert!(body.contains("log_chat_call(") && body.contains(call), "{name} ends without a line in the runtime log");
            assert!(body.contains("Instant::now()"), "{name} does not time itself");
        }
    }
}

#[cfg(test)]
mod probe_memo_tests {
    use super::*;
    use std::cell::Cell;
    use std::time::Instant;

    fn ready() -> DirectChatStatus {
        status("ready", None)
    }
    fn failed() -> DirectChatStatus {
        status("error", Some("container_unavailable"))
    }
    fn scope(label: &[u8]) -> AccountScope {
        AccountScope::synthetic(label)
    }

    #[test]
    fn a_ready_answer_is_kept_for_a_while_and_a_failure_for_less() {
        let a = scope(b"synthetic-memo-a");
        let t0 = Instant::now();
        let mut memo = ProbeMemo::default();
        assert_eq!(memo.fresh(&a, t0), None);
        memo.keep(&a, t0, &ready());
        assert_eq!(memo.fresh(&a, t0 + PROBE_READY_KEPT - Duration::from_millis(1)), Some(ready()));
        assert_eq!(memo.fresh(&a, t0 + PROBE_READY_KEPT), None);
        memo.keep(&a, t0, &failed());
        assert_eq!(memo.fresh(&a, t0 + PROBE_FAILED_KEPT - Duration::from_millis(1)), Some(failed()));
        assert_eq!(memo.fresh(&a, t0 + PROBE_FAILED_KEPT), None);
        assert!(PROBE_FAILED_KEPT < PROBE_READY_KEPT);
    }

    #[test]
    fn an_answer_is_of_one_account_and_is_dropped_when_the_connection_changes() {
        let (a, b) = (scope(b"synthetic-memo-a"), scope(b"synthetic-memo-b"));
        let t0 = Instant::now();
        let mut memo = ProbeMemo::default();
        memo.keep(&a, t0, &ready());
        assert_eq!(memo.fresh(&b, t0), None);
        memo.forget();
        assert_eq!(memo.fresh(&a, t0), None);
    }

    #[test]
    fn two_asks_in_a_row_start_one_probe_and_a_stale_or_forgotten_answer_starts_another() {
        let a = scope(b"synthetic-memo-a");
        let memo = Mutex::new(ProbeMemo::default());
        let origin = Instant::now();
        let clock = Cell::new(origin);
        let probes = Cell::new(0);
        let ask = |answer: DirectChatStatus| {
            status_kept_or_probed(&memo, &a, || clock.get(), || {
                probes.set(probes.get() + 1);
                answer
            })
        };
        assert_eq!(ask(ready()), ready());
        // the second finds the first's answer: its own probe never runs
        assert_eq!(ask(failed()), ready());
        assert_eq!(probes.get(), 1);
        clock.set(origin + PROBE_READY_KEPT + Duration::from_secs(1));
        assert_eq!(ask(failed()), failed());
        assert_eq!(probes.get(), 2);
        memo.lock().unwrap().forget();
        assert_eq!(ask(ready()), ready());
        assert_eq!(probes.get(), 3);
    }

    #[test]
    fn the_status_of_a_connection_goes_through_the_memo_and_every_change_of_the_connection_drops_it() {
        let source = concat!(include_str!("direct_chat/scripts.rs"), include_str!("direct_chat/state.rs"), include_str!("direct_chat/wire.rs"), include_str!("direct_chat/host_store.rs"), include_str!("direct_chat/ssh_link.rs"), include_str!("direct_chat/local_engine.rs"), include_str!("direct_chat/runtime_integrity.rs"), include_str!("direct_chat/container_attestation.rs"), include_str!("direct_chat/container_discovery.rs"), include_str!("direct_chat/local_exec.rs"), include_str!("direct_chat/transport.rs"), include_str!("direct_chat.rs"));
        let body = source.split("fn status_for_scope(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(body.contains("status_kept_or_probed("), "{body}");
        assert!(!body.contains("Ok(probe(connection))"));
        // connect and reconnect, close and sign-out
        for place in ["fn connect_scoped(", "pub(crate) async fn direct_chat_close(", "pub(crate) fn teardown("] {
            let rest = source.split(place).nth(1).unwrap_or_else(|| panic!("{place}"));
            let body = rest.split("\n}\n").next().unwrap();
            assert!(body.contains("forget_probe("), "{place} keeps a probe answer of a connection that is gone");
        }
    }
}

#[cfg(test)]
mod connection_read_tests {
    use super::*;

    #[cfg(unix)]
    fn vps() -> ValidatedHost {
        ValidatedHost::Vps {
            address: "203.0.113.7".into(),
            user: "jht".into(),
            port: 22,
            key_path: PathBuf::from("/nonexistent/key"),
            known_hosts: PathBuf::from("/nonexistent/known_hosts"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_read_on_this_computer_lets_go_of_the_connection_before_it_works_and_a_vps_read_keeps_it() {
        let scope = AccountScope::synthetic(b"synthetic-read-a");
        let inner = DirectChatInner::default();
        *inner.connection.lock().unwrap() = Some(synthetic_connection(ValidatedHost::Local, &scope));
        let free_inside = with_connection_read(&inner, &scope, |_| Ok(inner.connection.try_lock().is_ok())).unwrap();
        assert!(free_inside, "the lock was still held while the read worked on this computer");
        // the read got the paths of the runtime of the connection, not its tunnel or master
        let paths = with_connection_read(&inner, &scope, |connection| {
            Ok((connection.local_wrapper.clone(), connection.local_runtime.clone(), connection.control_path.is_none() && connection.tunnel.is_none()))
        })
        .unwrap();
        assert_eq!(paths, (Some(PathBuf::from("/synthetic/wrapper")), Some(PathBuf::from("/synthetic/runtime")), true));
        // a VPS: the master and the tunnel are the connection's own, so its lock stays
        *inner.connection.lock().unwrap() = Some(synthetic_connection(vps(), &scope));
        let held_inside = with_connection_read(&inner, &scope, |_| Ok(inner.connection.try_lock().is_err())).unwrap();
        assert!(held_inside, "a VPS read let go of the connection it works on");
    }

    #[cfg(unix)]
    #[test]
    fn a_read_of_another_account_or_of_no_connection_is_refused_before_it_works() {
        let (mine, other) = (AccountScope::synthetic(b"synthetic-read-a"), AccountScope::synthetic(b"synthetic-read-b"));
        let inner = DirectChatInner::default();
        let ran = std::cell::Cell::new(false);
        let work = |_: &Connection| {
            ran.set(true);
            Ok(())
        };
        assert_eq!(with_connection_read(&inner, &mine, work).err().map(|error| error.code), Some("disconnected"));
        *inner.connection.lock().unwrap() = Some(synthetic_connection(ValidatedHost::Local, &other));
        assert_eq!(with_connection_read(&inner, &mine, work).err().map(|error| error.code), Some("account_scope_mismatch"));
        assert!(!ran.get());
    }

    #[cfg(unix)]
    #[test]
    fn a_detached_connection_owns_nothing_to_close() {
        let scope = AccountScope::synthetic(b"synthetic-read-a");
        assert!(synthetic_connection(vps(), &scope).detached_local().is_none());
        let local = synthetic_connection(ValidatedHost::Local, &scope);
        let detached = local.detached_local().unwrap();
        assert!(detached.control_path.is_none() && detached.tunnel.is_none() && detached.runtime.is_none());
        // dropping it closes nothing: close_connection only acts on a VPS master or a tunnel
        drop(detached);
    }

    #[cfg(unix)]
    #[test]
    fn the_reads_that_ran_a_process_under_the_lock_no_longer_do() {
        let source = concat!(include_str!("direct_chat/scripts.rs"), include_str!("direct_chat/state.rs"), include_str!("direct_chat/wire.rs"), include_str!("direct_chat/host_store.rs"), include_str!("direct_chat/ssh_link.rs"), include_str!("direct_chat/local_engine.rs"), include_str!("direct_chat/runtime_integrity.rs"), include_str!("direct_chat/container_attestation.rs"), include_str!("direct_chat/container_discovery.rs"), include_str!("direct_chat/local_exec.rs"), include_str!("direct_chat/transport.rs"), include_str!("direct_chat.rs"));
        // the read of a page, the scripts' read and the probe go through the release; the sends keep their serial lock
        for (place, needle) in [
            ("pub(crate) async fn direct_chat_read(", "with_connection_read("),
            ("pub(crate) async fn team_script_read(", "with_connection_read("),
            ("fn status_for_scope(", "detached_local()"),
        ] {
            let body = source.split(place).nth(1).unwrap_or_else(|| panic!("{place}")).split("\n}\n").next().unwrap();
            assert!(body.contains(needle), "{place} holds the connection's lock for its process again");
        }
        let write = source.split("fn send_impl(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(write.contains("send_lock"), "a send is serial");
    }
}

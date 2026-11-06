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
mod lifecycle;
use lifecycle::connect_impl;
pub(crate) use lifecycle::cli_open_and_close;
use lifecycle::connect_scoped;
pub(crate) use lifecycle::direct_chat_connect;
pub(crate) use lifecycle::{__cmd__direct_chat_connect, __tauri_command_name_direct_chat_connect};
pub(crate) use lifecycle::direct_chat_subscribe;
pub(crate) use lifecycle::{__cmd__direct_chat_subscribe, __tauri_command_name_direct_chat_subscribe};
use lifecycle::status_for_scope;
pub(crate) use lifecycle::direct_chat_status;
pub(crate) use lifecycle::{__cmd__direct_chat_status, __tauri_command_name_direct_chat_status};
pub(crate) use lifecycle::direct_chat_reconnect;
pub(crate) use lifecycle::{__cmd__direct_chat_reconnect, __tauri_command_name_direct_chat_reconnect};
pub(crate) use lifecycle::direct_chat_close;
pub(crate) use lifecycle::{__cmd__direct_chat_close, __tauri_command_name_direct_chat_close};
pub(crate) use lifecycle::teardown;
mod read;
use read::parse_json;
pub(crate) use read::direct_chat_read;
pub(crate) use read::{__cmd__direct_chat_read, __tauri_command_name_direct_chat_read};
use read::read_page;
use read::SMALL_READ_TAIL;
use read::SMALL_READ_OVERLAP;
use read::SMALL_READ_SIZE_PROBE;
use read::small_read;
mod send;
use send::delivery_command;
use send::local_delivery_args;
use send::send_fixed;
use send::send_impl;
pub(crate) use send::direct_chat_send;
pub(crate) use send::{__cmd__direct_chat_send, __tauri_command_name_direct_chat_send};
mod attachments;
use attachments::attach_refusal;
pub(crate) use attachments::DirectChatAttachState;
pub(crate) use attachments::direct_chat_attach_state;
pub(crate) use attachments::{__cmd__direct_chat_attach_state, __tauri_command_name_direct_chat_attach_state};
pub(crate) use attachments::DirectChatAttachment;
use attachments::AttachGuard;
use attachments::attachment_message;
use attachments::downloads_of;
use attachments::AttachTarget;
use attachments::attach_target;
use attachments::team_sees_the_copy;
mod logging;
use logging::SLOW_CHAT_CALL;
use logging::SLOW_CHAT_CALL_AGAIN;
use logging::LoggedCall;
use logging::LOGGED_CHAT_CALL;
use logging::chat_call_line;
use logging::ATTEST_REASON;
use logging::note_attest_reason;
use logging::log_chat_call;
use logging::log_chat_call_in;
mod write_actions;
pub(crate) use write_actions::window_may_write;
use write_actions::link_allows_writing;
use write_actions::own_vps_write_refusal;
use write_actions::refuse_writing;
use write_actions::run_answer_action;
use write_actions::answer_input;
use write_actions::answer_impl;
use write_actions::enter_impl;
use write_actions::chat_write;
use write_actions::chat_scoped;
use write_actions::answer_request;
use write_actions::enter_request;
pub(crate) use write_actions::direct_chat_answer;
pub(crate) use write_actions::{__cmd__direct_chat_answer, __tauri_command_name_direct_chat_answer};
pub(crate) use write_actions::direct_chat_enter;
pub(crate) use write_actions::{__cmd__direct_chat_enter, __tauri_command_name_direct_chat_enter};
mod team_api;
use team_api::TEAM_SCRIPT_REPLY_MAX;
pub(crate) use team_api::team_script_read;
pub(crate) use team_api::team_script_write;
use team_api::TEAM_LANGUAGES;
pub(crate) use team_api::TeamLanguage;
use team_api::checked_team_language;
use team_api::team_language_impl;
pub(crate) use team_api::direct_chat_team_language;
pub(crate) use team_api::{__cmd__direct_chat_team_language, __tauri_command_name_direct_chat_team_language};
pub(crate) use team_api::direct_chat_team_language_set;
pub(crate) use team_api::{__cmd__direct_chat_team_language_set, __tauri_command_name_direct_chat_team_language_set};

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

#[cfg(test)]
#[path = "direct_chat/tests/mod.rs"]
mod tests;
#[cfg(test)]
#[path = "direct_chat/tests/assistance_registration.rs"]
mod assistance_registration_tests;
#[cfg(test)]
#[path = "direct_chat/tests/team_language.rs"]
mod team_language_tests;
#[cfg(test)]
#[path = "direct_chat/tests/attachment_command.rs"]
mod attachment_command_tests;
#[cfg(test)]
#[path = "direct_chat/tests/chat_call_log.rs"]
mod chat_call_log_tests;
#[cfg(test)]
#[path = "direct_chat/tests/probe_memo.rs"]
mod probe_memo_tests;
#[cfg(test)]
#[path = "direct_chat/tests/connection_read.rs"]
mod connection_read_tests;

#[cfg(test)]
mod oversized_ssh_tests {
    use super::*;
    pub(super) fn synthetic_vps() -> ValidatedHost {
        ValidatedHost::Vps {
            address: "test-host".into(),
            user: "test".into(),
            port: 22,
            key_path: "/private/synthetic-key".into(),
            known_hosts: "/private/synthetic-known-hosts".into(),
        }
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
}

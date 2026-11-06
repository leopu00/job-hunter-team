use super::*;
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

mod fixtures;
use fixtures::*;
use super::oversized_ssh_tests::synthetic_vps;
mod ssh_socket;
mod ssh_link;
mod small_read;
mod transport;
mod container_windows;
mod runtime_integrity;
mod compose_environment;
mod trusted_tools;
mod config_attestation;
mod native_exec;
mod container_listing;
mod local_runtime;
mod remote_preamble;
mod write_gate;
mod wire;
mod sessions;
mod host_store;
mod probe;

// The security guards read every production piece, including the long functions kept in the facade.
pub(super) const DIRECT_CHAT_SOURCE: &str = concat!(
    include_str!("../scripts.rs"),
    include_str!("../state.rs"),
    include_str!("../wire.rs"),
    include_str!("../host_store.rs"),
    include_str!("../ssh_link.rs"),
    include_str!("../local_engine.rs"),
    include_str!("../runtime_integrity.rs"),
    include_str!("../container_attestation.rs"),
    include_str!("../container_discovery.rs"),
    include_str!("../local_exec.rs"),
    include_str!("../transport.rs"),
    include_str!("../lifecycle.rs"),
    include_str!("../read.rs"),
    include_str!("../send.rs"),
    include_str!("../attachments.rs"),
    include_str!("../logging.rs"),
    include_str!("../write_actions.rs"),
    include_str!("../team_api.rs"),
    include_str!("../../direct_chat.rs"),
);

// All the test bodies remain under the Unix-only construction guard after their move.
pub(super) const DIRECT_CHAT_TEST_SOURCE: &str = concat!(
    include_str!("../../direct_chat.rs"),
    include_str!("assistance_registration.rs"),
    include_str!("attachment_command.rs"),
    include_str!("chat_call_log.rs"),
    include_str!("compose_environment.rs"),
    include_str!("config_attestation.rs"),
    include_str!("connection_read.rs"),
    include_str!("container_listing.rs"),
    include_str!("container_windows.rs"),
    include_str!("fixtures.rs"),
    include_str!("host_store.rs"),
    include_str!("local_runtime.rs"),
    include_str!("mod.rs"),
    include_str!("native_exec.rs"),
    include_str!("probe.rs"),
    include_str!("probe_memo.rs"),
    include_str!("remote_preamble.rs"),
    include_str!("runtime_integrity.rs"),
    include_str!("sessions.rs"),
    include_str!("small_read.rs"),
    include_str!("ssh_link.rs"),
    include_str!("ssh_socket.rs"),
    include_str!("team_language.rs"),
    include_str!("transport.rs"),
    include_str!("trusted_tools.rs"),
    include_str!("wire.rs"),
    include_str!("write_gate.rs"),
);

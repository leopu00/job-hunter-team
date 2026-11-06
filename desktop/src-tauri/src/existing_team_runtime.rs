//! Account-scoped, producer-delivered target for an already existing team.
//!
//! The candidate is written outside the renderer from a custodial receipt.
//! The app only activates it after the existing-team identity probe succeeds.
//! A legacy container name is never a fallback for a selected VPS target.

use crate::{
    account_scope::{AccountScope, AccountScopeState},
    direct_chat,
    runtime_host::{
        run_ssh_command, set_private_dir_permissions, set_private_permissions, ExecutionHost,
        ProcessResult,
    },
    vps_link,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    cell::Cell,
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};

/// `before_link` runs once the bytes are staged and validated, right before
/// the definitive file is created: the window a concurrent writer can use.
pub(crate) fn write_candidate_hooked(
    root: &Path,
    scope: &AccountScope,
    bytes: &[u8],
    before_link: &mut dyn FnMut(),
) -> Result<CandidateWrite, &'static str> {
    parse_candidate_bytes(bytes)?;
    let parent = account_dir(root, scope);
    let parent_meta =
        fs::symlink_metadata(&parent).map_err(|_| "existing_team_runtime_unavailable")?;
    if parent_meta.file_type().is_symlink() || !parent_meta.is_dir() {
        return Err("existing_team_runtime_unavailable");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if parent_meta.uid() != unsafe { libc::geteuid() }
            || parent_meta.permissions().mode() & 0o022 != 0
        {
            return Err("existing_team_runtime_unavailable");
        }
    }
    let destination = path(root, scope, CANDIDATE_FILE);
    match fs::symlink_metadata(&destination) {
        Ok(_) => return Err("existing_team_runtime_candidate_exists"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("existing_team_runtime_unavailable"),
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "existing_team_runtime_unavailable")?
        .as_nanos();
    let temporary = destination.with_extension(format!("tmp-{}-{nonce}", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "existing_team_runtime_unavailable")?;
    let staged = (|| {
        set_private_permissions(&temporary).map_err(|_| "existing_team_runtime_unavailable")?;
        file.write_all(bytes)
            .map_err(|_| "existing_team_runtime_unavailable")?;
        file.sync_all()
            .map_err(|_| "existing_team_runtime_unavailable")?;
        drop(file);
        let staged = read_bytes(
            &temporary,
            "existing_team_runtime_unavailable",
            "existing_team_runtime_unavailable",
        )?;
        if staged != bytes {
            return Err("existing_team_runtime_unavailable");
        }
        parse_candidate_bytes(&staged)?;
        Ok(())
    })();
    if let Err(error) = staged {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    before_link();
    let linked = fs::hard_link(&temporary, &destination);
    let _ = fs::remove_file(&temporary);
    match linked {
        Ok(()) => {
            let published = read_bytes(
                &destination,
                "existing_team_runtime_unavailable",
                "existing_team_runtime_unavailable",
            )?;
            if published == bytes {
                Ok(CandidateWrite::Written)
            } else {
                Err("existing_team_runtime_unavailable")
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            match read_bytes(
                &destination,
                "existing_team_runtime_candidate_conflict",
                "existing_team_runtime_candidate_conflict",
            ) {
                Ok(existing) if existing == bytes => Ok(CandidateWrite::Identical),
                _ => Err("existing_team_runtime_candidate_conflict"),
            }
        }
        Err(_) => Err("existing_team_runtime_unavailable"),
    }
}


mod candidate;
pub(crate) use candidate::{parse_candidate_bytes, candidate_for_request, candidate_for_request_at, saved_binding_at, candidate_identity_at, candidate_host_for_team, RegistrationGate, registration_gate_at, candidate_bytes, CandidateWrite, write_candidate_at, };
use candidate::{read_candidate_at, candidate_matches_probed, };
mod full_link;
pub(crate) use full_link::{grant_full_link, full_link_granted, revoke_full_link, FULL_LINK_MAX_AGE_S, FullLinkRestore, FullLinkForgotten, unix_now, remember_full_link_at, forget_full_link_at, restore_full_link_at, };
mod identity;
pub(crate) use identity::{RuntimeTarget, Candidate, SavedSelection, ActivatedTarget, connection_key, hex, sha256, team_id, valid_target, };
use identity::{Selection, };
mod own_vps;
pub(crate) use own_vps::{mark_own_vps_at, mark_own_vps, OwnVpsState, own_vps_state_at, own_vps_for_writes_at, own_vps_for_reads_at, claim_own_vps_at, };
mod own_vps_claim;
pub(crate) use own_vps_claim::{own_vps_identity_input, own_vps_identity_matches, OwnVpsClaimRequest, own_vps_claim, };
use own_vps_claim::OWN_VPS_IDENTITY_PY;
mod rebind;
pub(crate) use rebind::{forget_team_at, RebindBase, rebind_base_at, clear_for_rebind_at, clear_link_at, };
mod selection;
pub(crate) use selection::{activate, activate_at, activate_or_keep, activate_or_keep_at, selected, selected_or_own, selected_or_own_at, selected_at, };
#[allow(unused_imports)] // The crate's existing API is kept by the facade.
pub(crate) use selection::pinned_key_for;
use selection::{selection_may_be_absent, read_selection_at, };
mod storage;
pub(crate) use storage::{root, };
use storage::{CANDIDATE_FILE, SELECTION_FILE, OWN_VPS_FILE, MAX_BYTES, account_dir, path, read_bytes, };
#[cfg(test)]
pub(crate) use full_link::FULL_LINK_TEST_LOCK;
pub(crate) use own_vps_claim::__cmd__own_vps_claim;
pub(crate) use own_vps_claim::__tauri_command_name_own_vps_claim;

mod positions_reader;
pub(crate) use positions_reader::{POSITIONS_READ_PY, };
mod positions_request;
use positions_request::{PositionsRequest, object_or_null, array};
mod runtime_commands;
pub(crate) use runtime_commands::{read_command_for, read_command, engine_selection, command, team_probe_command, assistant_start_command, python_command, python_command_unchecked, delivery_command, snapshot_command, hex_encode, };
#[cfg(test)]
use runtime_commands::PYTHON_STDIN_EXEC;
mod read_checks;
pub(crate) use read_checks::{VerifiedTargets, };
use read_checks::{VERIFIED_TARGETS, clock_ms, checks_key, read_amortising_checks};
#[cfg(test)]
use read_checks::CHECKS_KEPT_TARGETS;
mod chat_commands;
pub(crate) use chat_commands::{CHAT_AGENTS, chat_instance, chat_agent_ok, chat_session, chat_session_ok, ChatOperation, chat_question_id, chat_arguments, chat_command, chat_wrapper_arguments, };
mod profile;
use profile::{positions_failure, positions_answer_failure, shape_profile};
#[cfg(test)]
use profile::profile_fields;
mod positions_read;
use positions_read::{parse_positions_request, read_unless_blocked};
mod positions_local;
pub(crate) use positions_local::{local_reader_wrapper, local_machine_is_off, };
use positions_local::positions_read_local;
#[cfg(test)]
use positions_local::positions_read_local_with;
mod positions_output;
use positions_output::{positions_read_with, positions_reply_from_output, };
mod commands;
pub(crate) use commands::{existing_team_positions_read, existing_team_link_identity, };
pub(crate) use commands::{__cmd__existing_team_positions_read, __tauri_command_name_existing_team_positions_read, __cmd__existing_team_link_identity, __tauri_command_name_existing_team_link_identity};

const READ_TIMEOUT: Duration = Duration::from_secs(15);

fn valid_positions_reply(request: &PositionsRequest, reply: &Value) -> bool {
    let Some(object) = reply.as_object() else {
        return false;
    };
    if object.get("ok").and_then(Value::as_bool) != Some(true) || object.len() != 2 {
        return false;
    }
    let Some(data) = object.get("data") else {
        return false;
    };
    match request {
        PositionsRequest::List { .. } | PositionsRequest::Facets | PositionsRequest::Directives | PositionsRequest::TeamActivityLog => data
            .as_object()
            .and_then(|data| data.get("items"))
            .is_some_and(|items| {
                items
                    .as_array()
                    .is_some_and(|items| items.iter().all(|item| item.is_object()))
            }),
        PositionsRequest::Map { .. } => data.as_object().is_some_and(|data| {
            data.len() == 3
                && array(data.get("items"))
                && data["items"].as_array().is_some_and(|items| items.iter().all(Value::is_object))
                && data.get("total").is_some_and(Value::is_u64)
                && data.get("next").is_some_and(|next| next.is_null() || next.is_u64())
        }),
        PositionsRequest::Piles => data.as_object().is_some_and(|data| {
            data.len() == 5 && ["scout", "analisti", "scorer", "scrittori", "critici"].iter().all(|key| data.get(*key).is_some_and(Value::is_u64))
        }),
        PositionsRequest::Stats => data.as_object().is_some_and(|data| {
            data.len() == 7
                && ["stats", "distribution"]
                    .iter()
                    .all(|key| data.get(*key).is_some_and(Value::is_object))
                && ["sources", "types", "recent"]
                    .iter()
                    .all(|key| array(data.get(*key)))
                && ["points", "events"].iter().all(|key| {
                    data.get(*key).and_then(Value::as_object).is_some_and(|part| {
                        array(part.get("rows"))
                            && part.get("included").is_some_and(Value::is_u64)
                            && part.get("of").is_some_and(Value::is_u64)
                    })
                })
        }),
        PositionsRequest::TeamActivity { .. } => data.as_object().is_some_and(|data| {
            data.len() == 4
                && ["daily", "newest", "seen"]
                    .iter()
                    .all(|key| data.get(*key).and_then(Value::as_array).is_some_and(|items| items.iter().all(Value::is_object)))
                && data.get("meta").is_some_and(Value::is_object)
        }),
        PositionsRequest::CloudSync => data.as_object().is_some_and(|data| {
            let text_or_null = |key: &str| data.get(key).is_some_and(|value| value.is_null() || value.is_string());
            match data.get("state").and_then(Value::as_str) {
                Some("absent" | "unreadable") => data.len() == 1,
                Some("ok") => {
                    data.len() == 5
                        && data.get("status").and_then(Value::as_str).is_some_and(|status| {
                            matches!(
                                status,
                                "completed" | "idle" | "partial" | "timeout" | "auth_failed" | "failed"
                                    | "signature_unavailable" | "other"
                            )
                        })
                        && text_or_null("last_success_at")
                        && text_or_null("last_attempt_at")
                        && data.get("consecutive_failures").is_some_and(Value::is_u64)
                }
                _ => false,
            }
        }),
        PositionsRequest::Profile => data.as_object().is_some_and(|data| {
            data.len() == 2
                && data
                    .get("profile")
                    .and_then(Value::as_object)
                    .is_some_and(|profile| profile.get("state").is_some_and(Value::is_string))
                && data.get("summaries").and_then(Value::as_object).is_some_and(|summaries| {
                    summaries.get("state").is_some_and(Value::is_string)
                        && array(summaries.get("items"))
                        && summaries.get("included").is_some_and(Value::is_u64)
                        && summaries.get("of").is_some_and(Value::is_u64)
                })
        }),
        PositionsRequest::Detail { .. } => {
            data.is_null()
                || data.as_object().is_some_and(|data| {
                    data.len() == 8
                        && data.get("position").is_some_and(Value::is_object)
                        && object_or_null(data.get("score"))
                        && array(data.get("highlights"))
                        && object_or_null(data.get("company"))
                        && object_or_null(data.get("application"))
                        && array(data.get("tickets"))
                        && object_or_null(data.get("userNote"))
                        && data
                            .get("exclusionEventAt")
                            .is_some_and(|value| value.is_null() || value.is_string())
                })
        }
    }
}

/// Fixed read-only jobs-db bridge shared by the Tauri command and the
/// one-shot CLI companion. Callers provide only an account scope and typed
/// request; host, target and SQL remain source-owned.
pub(crate) fn positions_read_for_scope(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    request: Value,
) -> Value {
    let request = match parse_positions_request(request) {
        Ok(request) => request,
        Err(()) => return positions_failure("positions_request_invalid"),
    };
    let request_bytes = match serde_json::to_vec(&request) {
        Ok(bytes) if bytes.len() <= 8192 => bytes,
        _ => return positions_failure("positions_request_invalid"),
    };
    let host = match direct_chat::load_persisted_host(app, scope) {
        Ok(host) => host,
        Err(error) => return positions_failure(error),
    };
    let validated = match crate::runtime_host::validate_host_for_scope(app, &host, scope) {
        Ok(validated) => validated,
        Err(error) => return positions_failure(error),
    };
    // This computer's team: no SSH, no pinned target; the same reader runs in its container.
    if matches!(validated, crate::runtime_host::ValidatedHost::Local) {
        return positions_read_local(app, scope, &request, &request_bytes);
    }
    let selected = match selected_or_own(app, scope, &host) {
        Ok(selected) => selected,
        Err(error) => return positions_failure(error),
    };
    let team = selected.as_ref().map(|target| (target.team_id.clone(), target.runtime.clone()));
    let command = match read_command_for(selected, &host) {
        Ok(command) => command,
        Err(error) => return positions_failure(error),
    };
    // The chat's ssh connection, lent to this read when the chat is connected to the same VPS and team:
    // a read of its own pays a new handshake (and the key exchange) every time.
    let shared = app.try_state::<direct_chat::DirectChatState>().and_then(|chat| {
        direct_chat::shared_master(chat.inner(), scope, &validated, team.as_ref().map(|(id, runtime)| (id.as_str(), runtime)))
    });
    // A key found changed stays blocked for this scope and VPS until the person confirms it again: no `ssh`
    // that is refused and no `ssh-keyscan` per read (the memory is vps_link's).
    let (block_key, pinned) = match &validated {
        crate::runtime_host::ValidatedHost::Vps { address, port, .. } => (
            Some(vps_link::block_key(scope.digest(), address, *port)),
            crate::runtime_host::pinned_host_fingerprint(&validated).ok(),
        ),
        crate::runtime_host::ValidatedHost::Local => (None, None),
    };
    let started = Instant::now();
    // ssh time, bytes out, bytes in and whether the chat's connection was lent, over every run of this read
    let timing = Cell::new((Duration::ZERO, 0usize, 0usize, false));
    let fast_command = team.as_ref().and_then(|(_, runtime)| python_command_unchecked(runtime).ok());
    let key = team.as_ref().and_then(|(team_id, runtime)| checks_key(scope, &validated, team_id, runtime));
    let key = key.filter(|_| fast_command.is_some());
    let mut skipped = false;
    let reply = read_unless_blocked(block_key, pinned, || {
        let (reply, skipped_checks) = read_amortising_checks(&VERIFIED_TARGETS, key.as_deref(), clock_ms, |complete| {
            let chosen = match (&fast_command, complete) {
                (Some(fast), false) => fast,
                _ => &command,
            };
            positions_read_with(
                &request,
                &request_bytes,
                |input| {
                    let ssh_started = Instant::now();
                    let lent = shared.as_deref().filter(|socket| direct_chat::lent_socket_still_ours(socket));
                    let mut result = None;
                    if let Some(socket) = lent {
                        // The master went away between the check and the read (255): one try on a connection of its own.
                        match run_ssh_command(&validated, chosen, Some(input), READ_TIMEOUT, Some(socket)) {
                            Ok(output) if output.code != 255 => result = Some(Ok(output)),
                            _ => {}
                        }
                    }
                    let used_lent = result.is_some();
                    let result = result.unwrap_or_else(|| run_ssh_command(&validated, chosen, Some(input), READ_TIMEOUT, None));
                    let received = result.as_ref().map_or(0, |output| output.stdout.len());
                    let (ssh, out, _, was_lent) = timing.get();
                    timing.set((ssh + ssh_started.elapsed(), out + input.len(), received, was_lent || used_lent));
                    result
                },
                || crate::runtime_host::host_key_matches_pin(&validated),
            )
        });
        skipped = skipped_checks;
        reply
    });
    let (ssh, bytes_out, bytes_in, used_lent) = timing.get();
    if let Some(log) = crate::runtime_log::RuntimeLog::new(app) {
        log.record_positions_read(&crate::runtime_log::PositionsReadTiming {
            op: request.op(),
            shared: used_lent,
            checks_skipped: skipped,
            ok: reply.get("ok") == Some(&Value::Bool(true)),
            total: started.elapsed(),
            ssh,
            bytes_out,
            bytes_in,
        });
    }
    reply
}

#[cfg(test)]
mod tests;

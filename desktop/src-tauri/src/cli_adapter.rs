//! One-shot stdio bridge for the official CLI.
//!
//! This is deliberately a process, not a daemon: it consumes one bounded JSON
//! request, delegates all scope/host/target work to the desktop core, prints
//! one JSON result, and exits. The Node CLI never receives a host, a CID, or
//! a remote command.

use crate::{account_scope, existing_team_runtime, onboarding};
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::{self, Read};
use tauri::Manager;

const MAX_REQUEST_BYTES: usize = 8192;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdapterRequest {
    profile_id: String,
    #[serde(flatten)]
    operation: AdapterOperation,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
enum AdapterOperation {
    Connect { team_id: String },
    List { #[serde(default)] filters: Option<Value> },
    Detail { id: String },
    Facets,
}

fn code_for(error: &str) -> i32 {
    match error {
        "invalid_team_id" | "local_profile_invalid" | "positions_request_invalid" => 64,
        "existing_team_identity_mismatch" => 72,
        "existing_team_not_active" => 73,
        error if error.starts_with("existing_team_runtime_")
            || matches!(error, "host_key_missing" | "host_key_mismatch" | "invalid_host" | "invalid_user" | "invalid_port" | "invalid_key_path" | "invalid_key") => 70,
        _ => 69,
    }
}

fn fail(phase: &'static str, error: &str) -> (i32, Value) {
    (code_for(error), json!({"ok":false,"phase":phase,"code":code_for(error),"error":error}))
}

fn execute(app: &tauri::AppHandle, request: AdapterRequest) -> (i32, Value) {
    let scope = match account_scope::cli_local_scope(app, &request.profile_id) {
        Ok(scope) => scope,
        Err(error) => return fail("scope", error),
    };
    match request.operation {
        AdapterOperation::Connect { team_id } => match onboarding::cli_existing_team_connect(app, &scope, &team_id) {
            Ok(result) => (0, json!({"ok":true,"phase":"connect","code":0,"readiness":result.readiness,"snapshot":result.snapshot})),
            Err(error) => fail("connect", error),
        },
        AdapterOperation::List { filters } => {
            let request = match filters {
                Some(filters) => json!({"op":"list","filters":filters}),
                None => json!({"op":"list"}),
            };
            (0, existing_team_runtime::positions_read_for_scope(app, &scope, request))
        }
        AdapterOperation::Detail { id } => (0, existing_team_runtime::positions_read_for_scope(app, &scope, json!({"op":"detail","id":id}))),
        AdapterOperation::Facets => (0, existing_team_runtime::positions_read_for_scope(app, &scope, json!({"op":"facets"}))),
    }
}

/// Runs only with `--stdio-json`; unknown argv and malformed input fail before
/// a Tauri app or any SSH-capable core path is created.
pub fn run() -> i32 {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.len() != 1 || args[0] != "--stdio-json" {
        let _ = serde_json::to_writer(io::stdout(), &json!({"ok":false,"phase":"input","code":64,"error":"adapter_usage_invalid"}));
        return 64;
    }
    let mut raw = Vec::new();
    if io::stdin().take((MAX_REQUEST_BYTES + 1) as u64).read_to_end(&mut raw).is_err() || raw.len() > MAX_REQUEST_BYTES {
        let _ = serde_json::to_writer(io::stdout(), &json!({"ok":false,"phase":"input","code":64,"error":"adapter_request_invalid"}));
        return 64;
    }
    let request: AdapterRequest = match serde_json::from_slice(&raw) {
        Ok(request) => request,
        Err(_) => {
            let _ = serde_json::to_writer(io::stdout(), &json!({"ok":false,"phase":"input","code":64,"error":"adapter_request_invalid"}));
            return 64;
        }
    };
    let outcome = std::sync::Arc::new(std::sync::Mutex::new(None));
    let reply = outcome.clone();
    let run = tauri::Builder::default()
        .setup(move |app| {
            let result = execute(app.handle(), request);
            *reply.lock().expect("adapter reply lock") = Some(result);
            app.exit(0);
            Ok(())
        })
        .run(tauri::generate_context!());
    let (code, value) = outcome.lock().ok().and_then(|mut reply| reply.take()).unwrap_or_else(|| {
        let detail = if run.is_err() { "adapter_unavailable" } else { "adapter_failed" };
        fail("adapter", detail)
    });
    let _ = serde_json::to_writer(io::stdout(), &value);
    code
}

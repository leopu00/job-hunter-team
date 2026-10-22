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

const MAX_REQUEST_BYTES: usize = 8192;

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
enum AdapterRequest {
    Connect {
        #[serde(rename = "profileId")] profile_id: String,
        #[serde(rename = "teamId")] team_id: String,
    },
    List {
        #[serde(rename = "profileId")] profile_id: String,
        #[serde(default)] filters: Option<Value>,
    },
    Detail {
        #[serde(rename = "profileId")] profile_id: String,
        id: String,
    },
    Facets {
        #[serde(rename = "profileId")] profile_id: String,
    },
    Stats {
        #[serde(rename = "profileId")] profile_id: String,
    },
    Profile {
        #[serde(rename = "profileId")] profile_id: String,
    },
}

impl AdapterRequest {
    fn profile_id(&self) -> &str {
        match self {
            Self::Connect { profile_id, .. }
            | Self::List { profile_id, .. }
            | Self::Detail { profile_id, .. }
            | Self::Facets { profile_id }
            | Self::Stats { profile_id }
            | Self::Profile { profile_id } => profile_id,
        }
    }
}

fn code_for(error: &str) -> i32 {
    match error {
        "invalid_team_id" | "local_profile_invalid" | "positions_request_invalid" => 64,
        "existing_team_identity_mismatch" => 72,
        "existing_team_not_active" => 73,
        error if error.starts_with("existing_team_runtime_")
            || matches!(error, "host_key_missing" | "host_key_mismatch" | "host_key_changed" | "invalid_host" | "invalid_user" | "invalid_port" | "invalid_key_path" | "invalid_key") => 70,
        _ => 69,
    }
}

fn fail(phase: &'static str, error: &str) -> (i32, Value) {
    (code_for(error), json!({"ok":false,"phase":phase,"code":code_for(error),"error":error}))
}

fn envelope_core(phase: &'static str, result: Value) -> (i32, Value) {
    match result.get("ok").and_then(Value::as_bool) {
        Some(true) => (0, json!({
            "ok": true,
            "phase": phase,
            "code": 0,
            "data": result.get("data").cloned().unwrap_or(Value::Null),
        })),
        Some(false) => {
            let error = result.get("error").and_then(Value::as_str).unwrap_or("positions_unavailable");
            fail(phase, error)
        }
        None => fail(phase, "positions_unavailable"),
    }
}

fn execute(app: &tauri::AppHandle, request: AdapterRequest) -> (i32, Value) {
    let scope = match account_scope::cli_local_scope(app, request.profile_id()) {
        Ok(scope) => scope,
        Err(error) => return fail("scope", error),
    };
    match request {
        // As the app: the team is connected, then its direct chat must open (the step that failed on
        // macOS while the connection itself said ready). The chat is closed again before the answer.
        AdapterRequest::Connect { team_id, .. } => match onboarding::cli_existing_team_connect(app, &scope, &team_id) {
            Ok(result) => match crate::direct_chat::cli_open_and_close(app, &scope) {
                Ok(()) => (0, json!({"ok":true,"phase":"connect","code":0,"readiness":result.readiness,"directChat":"ready","snapshot":result.snapshot})),
                Err(error) => fail("chat", error),
            },
            Err(error) => fail("connect", error),
        },
        AdapterRequest::List { filters, .. } => {
            let request = match filters {
                Some(filters) => json!({"op":"list","filters":filters}),
                None => json!({"op":"list"}),
            };
            envelope_core("read", existing_team_runtime::positions_read_for_scope(app, &scope, request))
        }
        AdapterRequest::Detail { id, .. } => envelope_core("read", existing_team_runtime::positions_read_for_scope(app, &scope, json!({"op":"detail","id":id}))),
        AdapterRequest::Facets { .. } => envelope_core("read", existing_team_runtime::positions_read_for_scope(app, &scope, json!({"op":"facets"}))),
        AdapterRequest::Stats { .. } => envelope_core("read", existing_team_runtime::positions_read_for_scope(app, &scope, json!({"op":"stats"}))),
        AdapterRequest::Profile { .. } => envelope_core("read", existing_team_runtime::positions_read_for_scope(app, &scope, json!({"op":"profile"}))),
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
    let mut context = crate::application_context();
    context.config_mut().app.windows.clear();
    let outcome = std::sync::Arc::new(std::sync::Mutex::new(None));
    let reply = outcome.clone();
    let run = tauri::Builder::default()
        .setup(move |app| {
            let result = execute(app.handle(), request);
            *reply.lock().expect("adapter reply lock") = Some(result);
            app.handle().exit(0);
            Ok(())
        })
        .build(context)
        .map(|app| app.run_return(|_, _| {}));
    let (code, value) = outcome.lock().ok().and_then(|mut reply| reply.take()).unwrap_or_else(|| {
        let detail = if run.is_err() { "adapter_unavailable" } else { "adapter_failed" };
        fail("adapter", detail)
    });
    let _ = serde_json::to_writer(io::stdout(), &value);
    code
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connect_opens_and_closes_the_direct_chat_after_the_team_as_the_app_does() {
        // The app connects the team, then opens its direct chat: on macOS the second step failed
        // (the tunnel's socket path too long) while the first said ready, and the CLI never saw it.
        let source = include_str!("cli_adapter.rs").split("#[cfg(test)]").next().unwrap();
        let connect = source.split("AdapterRequest::Connect { team_id, .. } =>").nth(1).unwrap();
        let connect = connect.split("AdapterRequest::List").next().unwrap();
        let team = connect.find("onboarding::cli_existing_team_connect(").expect("the team first");
        let chat = connect.find("direct_chat::cli_open_and_close(").expect("then the chat");
        assert!(team < chat);
        assert!(connect.contains(r#"fail("chat", error)"#), "a chat that does not open fails the connect");
    }

    fn decoded(input: &str) -> AdapterRequest {
        serde_json::from_str(input).expect("exact Node request must decode")
    }

    #[test]
    fn decodes_exact_node_requests_with_strict_fields() {
        let connect = decoded(r#"{"profileId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","op":"connect","teamId":"existing_team_0001"}"#);
        assert!(matches!(connect, AdapterRequest::Connect { ref team_id, .. } if team_id == "existing_team_0001"));
        let list = decoded(r#"{"profileId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","op":"list","filters":{"q":"engineer","limit":10}}"#);
        assert!(matches!(list, AdapterRequest::List { filters: Some(_), .. }));
        let detail = decoded(r#"{"profileId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","op":"detail","id":"42"}"#);
        assert!(matches!(detail, AdapterRequest::Detail { ref id, .. } if id == "42"));
        let facets = decoded(r#"{"profileId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","op":"facets"}"#);
        assert!(matches!(facets, AdapterRequest::Facets { .. }));
        let stats = decoded(r#"{"profileId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","op":"stats"}"#);
        assert!(matches!(stats, AdapterRequest::Stats { .. }));
        assert!(serde_json::from_str::<AdapterRequest>(r#"{"profileId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","op":"stats","filters":{}}"#).is_err());
        let profile = decoded(r#"{"profileId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","op":"profile"}"#);
        assert!(matches!(profile, AdapterRequest::Profile { .. }));
        assert!(serde_json::from_str::<AdapterRequest>(r#"{"profileId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","op":"profile","path":"/jht_home/x"}"#).is_err());
        assert!(serde_json::from_str::<AdapterRequest>(r#"{"profileId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","op":"facets","unexpected":true}"#).is_err());
    }

    #[test]
    fn query_core_results_use_one_cli_envelope() {
        for data in [json!({"items": []}), Value::Null, json!({"items": [{"id": "42"}]})] {
            let (code, value) = envelope_core("read", json!({"ok": true, "data": data.clone()}));
            assert_eq!(code, 0);
            assert_eq!(value, json!({"ok": true, "phase": "read", "code": 0, "data": data}));
        }
        let (code, value) = envelope_core("read", json!({"ok": false, "error": "positions_unavailable"}));
        assert_ne!(code, 0);
        assert_eq!(value, json!({"ok": false, "phase": "read", "code": code, "error": "positions_unavailable"}));
    }
}

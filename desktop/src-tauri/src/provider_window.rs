//! The work window of the AI provider, as the team already records it: how much of it is used and when it renews.
//!
//! The team's bridge writes `logs/sentinel-bridge-state.json` at every check (`last_usage`: percent of the
//! provider's 5-hour window, `last_reset_at_unix`: when it renews, `last_provider`, `updated_at`). The app only
//! asks for those four values, through the chat's Python channel with a fixed script of its own, and closes the
//! answer again here: numbers in their ranges and a short provider name, nothing else reaches the page. It is a
//! read: it works in the read-only view, and says «unavailable» wherever the chat is not connected or the team
//! has no such file (a bridge that never ran, an older image).
use crate::{
    account_scope::AccountScopeState,
    direct_chat::{failure, team_script_read, DirectChatError, DirectChatState},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

const TIMEOUT: Duration = Duration::from_secs(20);

/// The fixed script: reads the bridge's state file and answers one JSON.
const PROVIDER_WINDOW_PY: &str = r#"import json,math,os,sys
from datetime import datetime,timezone
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
gone={'ok':False,'error':'window_unavailable'}
try: req=json.loads(sys.stdin.readline())
except Exception: emit(gone)
if req!={'op':'read'}: emit(gone)
path=os.path.join(os.environ.get('JHT_HOME','/jht_home'),'logs','sentinel-bridge-state.json')
try:
 with open(path,encoding='utf-8') as handle: state=json.load(handle)
except Exception: emit(gone)
if not isinstance(state,dict): emit(gone)
def number(value):
 if isinstance(value,bool) or not isinstance(value,(int,float)): return None
 try: out=float(value)
 except OverflowError: return None
 return out if math.isfinite(out) else None
try:
 stamp=datetime.fromisoformat(str(state.get('updated_at')))
 if stamp.tzinfo is None: stamp=stamp.replace(tzinfo=timezone.utc)
 updated=stamp.timestamp()
except Exception: emit(gone)
provider=state.get('last_provider')
emit({'ok':True,'provider':provider if isinstance(provider,str) else None,'usedPct':number(state.get('last_usage')),'resetAtUnix':number(state.get('last_reset_at_unix')),'updatedAtUnix':updated})
"#;

/// What the page gets: `ok: true` and the closed fields, or `ok: false` and a closed code.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WindowReply {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    used_pct: Option<Option<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reset_at_unix: Option<Option<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    updated_at_unix: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

impl WindowReply {
    fn unavailable() -> Self {
        WindowReply { ok: false, provider: None, used_pct: None, reset_at_unix: None, updated_at_unix: None, error: Some("window_unavailable") }
    }
}

/// Unix seconds between 2001 and 2100: anything else is not a time the bridge wrote.
fn instant(value: &Value) -> Option<f64> {
    value.as_f64().filter(|t| t.is_finite() && (1.0e9..4.1e9).contains(t))
}

fn provider_name(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?;
    (!text.is_empty() && text.len() <= 32 && text.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')).then(|| text.to_owned())
}

/// The team's answer closed again: the four fields in their ranges, or the whole answer is refused (the page then
/// shows no notice, and never a number it was not given).
fn shape(reply: &Value) -> Result<WindowReply, ()> {
    let object = reply.as_object().ok_or(())?;
    let used = match object.get("usedPct") {
        None | Some(Value::Null) => None,
        Some(v) => Some(v.as_f64().filter(|p| p.is_finite() && (0.0..=1000.0).contains(p)).ok_or(())?),
    };
    let reset = match object.get("resetAtUnix") {
        None | Some(Value::Null) => None,
        Some(v) => Some(instant(v).ok_or(())?),
    };
    let updated = instant(object.get("updatedAtUnix").ok_or(())?).ok_or(())?;
    Ok(WindowReply {
        ok: true,
        provider: Some(provider_name(object.get("provider"))),
        used_pct: Some(used),
        reset_at_unix: Some(reset),
        updated_at_unix: Some(updated),
        error: None,
    })
}

/// How much of the provider's work window the team has used and when it renews. Reads: it works in the read-only view.
#[tauri::command]
pub(crate) async fn provider_window_read(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<WindowReply, DirectChatError> {
    if window.label() != "main" {
        return Err(failure("invalid_request"));
    }
    let reply = team_script_read(&state, &scopes, PROVIDER_WINDOW_PY, json!({"op": "read"}), TIMEOUT).await?;
    if reply.get("ok") != Some(&Value::Bool(true)) {
        return Ok(WindowReply::unavailable());
    }
    Ok(shape(&reply).unwrap_or_else(|()| WindowReply::unavailable()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn team() -> Value {
        json!({"ok": true, "provider": "codex", "usedPct": 93.4, "resetAtUnix": 1793300000.0, "updatedAtUnix": 1793299000.5})
    }

    /// The contract with the page: `provider_window_response.json` holds the answers as the page receives them (the
    /// page's own test reads the same file with pickProviderWindow); `provider_window_team_response.json` holds, under
    /// the same names, what the team answers. Serialising the second must give the first, field for field.
    #[test]
    fn the_answer_handed_to_the_page_is_the_fixture_the_page_accepts() {
        let page: Value = serde_json::from_str(include_str!("../tests/fixtures/provider_window_response.json")).unwrap();
        let team: Value = serde_json::from_str(include_str!("../tests/fixtures/provider_window_team_response.json")).unwrap();
        let mut names: Vec<_> = page.as_object().unwrap().keys().cloned().collect();
        names.sort();
        assert_eq!(names, ["no_numbers", "unavailable", "used_with_reset"]);
        for name in &names {
            let served = match shape(&team[name]) {
                Ok(reply) => serde_json::to_value(reply).unwrap(),
                Err(()) => serde_json::to_value(WindowReply::unavailable()).unwrap(),
            };
            assert_eq!(served, page[name], "{name}: what the app serves is not what the page's test reads");
        }
    }

    #[test]
    fn a_field_outside_the_closed_list_is_left_out_and_never_reaches_the_page() {
        let mut reply = team();
        reply["last_status"] = json!("on_pace");
        reply["detail"] = json!("posizione-1");
        let text = serde_json::to_string(&shape(&reply).unwrap()).unwrap();
        assert!(!text.contains("on_pace") && !text.contains("posizione"));
        let shown = serde_json::to_value(shape(&reply).unwrap()).unwrap();
        let mut keys: Vec<_> = shown.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["ok", "provider", "resetAtUnix", "updatedAtUnix", "usedPct"]);
        assert_eq!(shown["usedPct"], 93.4);
    }

    #[test]
    fn a_missing_number_is_null_but_a_number_out_of_range_refuses_the_whole_answer() {
        let mut reply = team();
        reply["usedPct"] = Value::Null;
        reply["resetAtUnix"] = Value::Null;
        let shown = serde_json::to_value(shape(&reply).unwrap()).unwrap();
        assert!(shown["usedPct"].is_null() && shown["resetAtUnix"].is_null());
        for (field, value) in [
            ("usedPct", json!(-1)),
            ("usedPct", json!(1e6)),
            ("usedPct", json!("93")),
            ("resetAtUnix", json!(12)),
            ("resetAtUnix", json!(9e12)),
            ("updatedAtUnix", json!(null)),
            ("updatedAtUnix", json!("now")),
        ] {
            let mut bad = team();
            bad[field] = value.clone();
            assert!(shape(&bad).is_err(), "{field} = {value} should be refused");
        }
    }

    #[test]
    fn the_provider_is_a_short_lowercase_name_or_nothing() {
        for (given, shown) in [(json!("codex"), json!("codex")), (json!("kimi-k2"), json!("kimi-k2")), (json!("Codex"), Value::Null), (json!("a b"), Value::Null), (json!("x".repeat(33)), Value::Null), (json!(7), Value::Null)] {
            let mut reply = team();
            reply["provider"] = given.clone();
            assert_eq!(serde_json::to_value(shape(&reply).unwrap()).unwrap()["provider"], shown, "{given}");
        }
    }
}

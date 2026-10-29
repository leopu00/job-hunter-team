//! Where the team's first start stands, as the team's own state says: the phase of `first-run.json`, how many
//! workers its burst opened, and whether the subscription plan is declared.
//!
//! A read and nothing else: the team's state file is read as a file (the team's `first_run.status()` creates it on
//! first access, so it is not called), and the plan is asked of `plan_registry.active_plan()`, which only reads the
//! configuration. The app asks through the chat's Python channel with a fixed script of its own and closes the
//! answer again here. Silence is not «started»: a file that is not there, cannot be read or says another phase gives
//! `phase: null`. Only the main window asks. It is a read, so it works in the read-only view.
use crate::{
    account_scope::AccountScopeState,
    direct_chat::{failure, team_script_read, DirectChatError, DirectChatState},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

const TIMEOUT: Duration = Duration::from_secs(40);
const PHASES: [&str; 3] = ["awaiting_profile", "burst", "steady"];
/// More workers than any plan opens: a bigger number is not the team's.
const WORKERS_MAX: u64 = 1_000;

/// The fixed script. `JHT_HOME` and `JHT_APP` are the image's own (`/jht_home`, `/app`); a test points them elsewhere.
const TEAM_START_PY: &str = r#"import importlib.util,json,os,sys
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
try: req=json.loads(sys.stdin.readline())
except Exception: emit({'ok':False,'error':'team_start_unavailable'})
if req!={'op':'read'}: emit({'ok':False,'error':'team_start_unavailable'})
home=os.environ.get('JHT_HOME') or '/jht_home'
skills=(os.environ.get('JHT_APP') or '/app')+'/shared/skills'
phase=None
workers=0
try:
 with open(home+'/state/first-run.json',encoding='utf-8') as handle: state=json.load(handle)
 if isinstance(state,dict):
  if state.get('phase') in ('awaiting_profile','burst','steady'): phase=state['phase']
  roster=state.get('roster')
  if phase is not None and isinstance(roster,dict):
   workers=sum(count for count in roster.values() if isinstance(count,int) and not isinstance(count,bool) and 0<=count<=1000)
except Exception: phase=None
declared=False
try:
 path=skills+'/plan_registry.py'
 if os.path.isfile(path):
  sys.path.append(skills)
  spec=importlib.util.spec_from_file_location('plan_registry',path); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
  declared=mod.active_plan() is not None
except Exception: declared=False
emit({'ok':True,'phase':phase,'workers':workers,'planDeclared':declared})
"#;

/// What the page gets: `ok: true` and the closed fields, or `ok: false` and a closed code.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamStartReply {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    phase: Option<Option<&'static str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    workers: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    plan_declared: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

impl TeamStartReply {
    fn failed() -> Self {
        TeamStartReply { ok: false, phase: None, workers: None, plan_declared: None, error: Some("team_start_unavailable") }
    }
}

/// The team's answer closed again: a phase of the list or null, a count in range, a boolean; or the whole answer is
/// refused.
fn shape(reply: &Value) -> Result<TeamStartReply, ()> {
    let phase = match reply.get("phase") {
        Some(Value::Null) => None,
        Some(Value::String(word)) => Some(*PHASES.iter().find(|phase| **phase == word.as_str()).ok_or(())?),
        _ => return Err(()),
    };
    let workers = reply.get("workers").and_then(Value::as_u64).filter(|n| *n <= WORKERS_MAX).ok_or(())?;
    let declared = reply.get("planDeclared").and_then(Value::as_bool).ok_or(())?;
    // workers without a phase is not a thing the team said: silence stays silence
    Ok(TeamStartReply { ok: true, phase: Some(phase), workers: Some(if phase.is_some() { workers } else { 0 }), plan_declared: Some(declared), error: None })
}

/// Where the team's first start stands. Reads: it works in the read-only view.
#[tauri::command]
pub(crate) async fn team_start_read(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<TeamStartReply, DirectChatError> {
    if window.label() != "main" {
        return Err(failure("invalid_request"));
    }
    let reply = team_script_read(&state, &scopes, TEAM_START_PY, json!({"op": "read"}), TIMEOUT).await?;
    if reply.get("ok") != Some(&Value::Bool(true)) {
        return Ok(TeamStartReply::failed());
    }
    Ok(shape(&reply).unwrap_or_else(|()| TeamStartReply::failed()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn said(phase: Value, workers: Value, declared: Value) -> Value {
        json!({"ok": true, "phase": phase, "workers": workers, "planDeclared": declared})
    }

    #[test]
    fn the_answer_is_a_phase_of_the_list_or_null_a_count_and_a_boolean() {
        for phase in PHASES {
            let shown = serde_json::to_value(shape(&said(json!(phase), json!(4), json!(true))).unwrap()).unwrap();
            assert_eq!(shown, json!({"ok": true, "phase": phase, "workers": 4, "planDeclared": true}));
        }
        let silent = serde_json::to_value(shape(&said(Value::Null, json!(0), json!(false))).unwrap()).unwrap();
        assert_eq!(silent, json!({"ok": true, "phase": null, "workers": 0, "planDeclared": false}));
    }

    #[test]
    fn silence_is_never_started_workers_without_a_phase_count_as_none() {
        let shown = serde_json::to_value(shape(&said(Value::Null, json!(5), json!(true))).unwrap()).unwrap();
        assert_eq!(shown["phase"], Value::Null);
        assert_eq!(shown["workers"], 0);
    }

    #[test]
    fn anything_outside_the_closed_shape_is_refused_whole() {
        for (phase, workers, declared) in [
            (json!("running"), json!(1), json!(true)),
            (json!("BURST"), json!(1), json!(true)),
            (json!(1), json!(1), json!(true)),
            (json!("burst"), json!(-1), json!(true)),
            (json!("burst"), json!(1.5), json!(true)),
            (json!("burst"), json!("4"), json!(true)),
            (json!("burst"), json!(WORKERS_MAX + 1), json!(true)),
            (json!("burst"), json!(1), json!("yes")),
            (json!("burst"), json!(1), Value::Null),
        ] {
            assert!(shape(&said(phase.clone(), workers.clone(), declared.clone())).is_err(), "{phase} {workers} {declared}");
        }
        assert!(shape(&json!({"ok": true})).is_err() && shape(&json!("burst")).is_err());
        assert_eq!(serde_json::to_value(TeamStartReply::failed()).unwrap(), json!({"ok": false, "error": "team_start_unavailable"}));
    }

    #[test]
    fn the_command_takes_nothing_from_the_page_and_only_the_main_window_asks() {
        let code = include_str!("team_start.rs");
        let command = code.split("pub(crate) async fn team_start_read(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(command.contains("team_script_read(") && !command.contains("team_script_write("), "a read");
        let signature = command.split(") -> Result").next().unwrap();
        assert!(!signature.contains("String") && !signature.contains("Value") && !signature.contains("u32"), "no argument from the page");
        assert!(command.contains("window.label() != \"main\""));
        let lib = include_str!("lib.rs");
        assert!(lib.contains("mod team_start;") && lib.contains("team_start::team_start_read,"));
    }

    #[test]
    fn the_script_reads_a_file_and_the_plan_and_writes_nothing_it_does_not_call_the_creating_status() {
        assert!(TEAM_START_PY.contains("req!={'op':'read'}") && TEAM_START_PY.contains("/state/first-run.json"));
        assert!(TEAM_START_PY.contains("active_plan()"));
        assert!(TEAM_START_PY.contains("sys.path.append(skills)") && !TEAM_START_PY.contains("sys.path.insert(0"), "the system's modules first");
        for forbidden in ["status()", "begin_burst", "_write", "subprocess", "os.system", "eval(", "exec(", "open(home+'/state/first-run.json','w"] {
            assert!(!TEAM_START_PY.contains(forbidden), "{forbidden}");
        }
    }
}

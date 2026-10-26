//! What the team did while it worked, as counts kept on the team's computer, and the person's way to clear them.
//!
//! The contract is banda/piani/CONTRATTO-orari-proiezioni-20261026.md (approved). The numbers are kept by the
//! team (`shared/skills/work_stats.py`, in the image); the app only asks for them, through the chat's Python
//! channel with a fixed script of its own, and closes the answer again here: a closed list of fields, numbers
//! only, nothing else reaches the page. Only the main window asks. Reading works in the read-only view;
//! clearing is a write and is refused there.
use crate::{
    account_scope::AccountScopeState,
    direct_chat::{failure, team_script_read, team_script_write, window_may_write, DirectChatError, DirectChatState},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

const TIMEOUT: Duration = Duration::from_secs(40);
/// How many nights a page may carry, and how many the team keeps (90 days).
const MAX_NIGHTS: usize = 90;

/// The fixed script: loads the team's own `work_stats.py` and answers one JSON. An image older than the
/// feature has no such file: `stats_unavailable`.
const WORK_STATS_PY: &str = r#"import importlib.util,json,os,sys
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
try: req=json.loads(sys.stdin.readline())
except Exception: emit({'ok':False,'error':'stats_unavailable'})
if not isinstance(req,dict) or set(req)-{'op','nights'}: emit({'ok':False,'error':'stats_unavailable'})
op=req.get('op')
if op not in ('read','clear'): emit({'ok':False,'error':'stats_unavailable'})
nights=req.get('nights',30)
if not isinstance(nights,int) or isinstance(nights,bool) or nights<1 or nights>90: emit({'ok':False,'error':'stats_unavailable'})
os.environ.setdefault('JHT_HOME','/jht_home')
path='/app/shared/skills/work_stats.py'
if not os.path.isfile(path): emit({'ok':False,'error':'stats_unavailable'})
try:
 spec=importlib.util.spec_from_file_location('work_stats',path); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
except Exception: emit({'ok':False,'error':'stats_unavailable'})
try:
 out=mod.read(nights) if op=='read' else mod.clear()
except Exception as error:
 code=getattr(error,'code',None)
 emit({'ok':False,'error':code if code in ('stats_unreadable','stats_clear_failed') else ('stats_unreadable' if op=='read' else 'stats_clear_failed')})
out['ok']=True
emit(out)
"#;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Night {
    date: String,
    hours_active: f64,
    found: Option<u64>,
    above_threshold: Option<u64>,
    score_threshold: Option<u64>,
    consumption_pct: Option<u64>,
    turn_median_sec: Option<f64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Statistics {
    nights: Vec<Night>,
    from: Option<String>,
    to: Option<String>,
    last_observation: Option<String>,
    retention_days: u64,
    threshold: u64,
    schedule_state: String,
}

/// What the page gets: `ok: true` and the closed fields, or `ok: false` and a closed code.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StatsReply {
    ok: bool,
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    statistics: Option<Statistics>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

impl StatsReply {
    fn failed(code: &'static str) -> Self {
        StatsReply { ok: false, statistics: None, error: Some(code) }
    }
}

fn date_ok(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() == 10 && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

fn hour_ok(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() == 20 && date_ok(&text[..10]) && b[10] == b'T' && text.ends_with(":00:00Z") && b[11..13].iter().all(u8::is_ascii_digit)
}

fn count(value: Option<&Value>, max: u64) -> Result<Option<u64>, ()> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_u64() {
            Some(n) if n <= max => Ok(Some(n)),
            _ => Err(()),
        },
    }
}

fn text_or_null(value: Option<&Value>, ok: fn(&str) -> bool) -> Result<Option<String>, ()> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if ok(s) => Ok(Some(s.clone())),
        _ => Err(()),
    }
}

/// The team's answer closed again: every field of the closed list, in its range, or the whole answer is
/// refused (the page then says the statistics are unavailable, and never shows a number it was not given).
fn shape(reply: &Value) -> Result<Statistics, ()> {
    let object = reply.as_object().ok_or(())?;
    let nights = object.get("nights").and_then(Value::as_array).ok_or(())?;
    if nights.len() > MAX_NIGHTS {
        return Err(());
    }
    let mut listed = Vec::with_capacity(nights.len());
    for night in nights {
        let n = night.as_object().ok_or(())?;
        let date = n.get("date").and_then(Value::as_str).filter(|d| date_ok(d)).ok_or(())?.to_owned();
        let hours = n.get("hoursActive").and_then(Value::as_f64).filter(|h| h.is_finite() && (0.0..=200.0).contains(h)).ok_or(())?;
        let turn = match n.get("turnMedianSec") {
            None | Some(Value::Null) => None,
            Some(v) => Some(v.as_f64().filter(|s| s.is_finite() && (0.0..=86_400.0).contains(s)).ok_or(())?),
        };
        listed.push(Night {
            date,
            hours_active: hours,
            found: count(n.get("found"), 10_000_000)?,
            above_threshold: count(n.get("aboveThreshold"), 10_000_000)?,
            score_threshold: count(n.get("scoreThreshold"), 100)?,
            consumption_pct: count(n.get("consumptionPct"), 10_000)?,
            turn_median_sec: turn,
        });
    }
    let state = object.get("scheduleState").and_then(Value::as_str).filter(|s| ["undeclared", "valid", "unreadable"].contains(s)).ok_or(())?;
    Ok(Statistics {
        nights: listed,
        from: text_or_null(object.get("from"), date_ok)?,
        to: text_or_null(object.get("to"), date_ok)?,
        last_observation: text_or_null(object.get("lastObservation"), hour_ok)?,
        retention_days: count(object.get("retentionDays"), 366)?.ok_or(())?,
        threshold: count(object.get("threshold"), 100)?.ok_or(())?,
        schedule_state: state.to_owned(),
    })
}

fn code_of(reply: &Value, allowed: &[&'static str], fallback: &'static str) -> &'static str {
    let said = reply.get("error").and_then(Value::as_str);
    allowed.iter().copied().find(|code| Some(*code) == said).unwrap_or(fallback)
}

/// The statistics of the team's work, as the team keeps them. Reads: it works in the read-only view.
#[tauri::command]
pub(crate) async fn work_stats_read(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<StatsReply, DirectChatError> {
    if window.label() != "main" {
        return Err(failure("invalid_request"));
    }
    let reply = team_script_read(&state, &scopes, WORK_STATS_PY, json!({"op": "read", "nights": 30}), TIMEOUT).await?;
    if reply.get("ok") != Some(&Value::Bool(true)) {
        return Ok(StatsReply::failed(code_of(&reply, &["stats_unreadable"], "stats_unavailable")));
    }
    Ok(match shape(&reply) {
        Ok(statistics) => StatsReply { ok: true, statistics: Some(statistics), error: None },
        Err(()) => StatsReply::failed("stats_unavailable"),
    })
}

/// Clears the statistics the team kept. A write: refused in the read-only view. The team goes on counting
/// from the next check (the page says so).
#[tauri::command]
pub(crate) async fn work_stats_clear(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<StatsReply, DirectChatError> {
    if !window_may_write(window.label()) {
        return Err(failure("invalid_request"));
    }
    let reply = team_script_write(&state, &scopes, WORK_STATS_PY, json!({"op": "clear"}), TIMEOUT).await?;
    if reply.get("ok") == Some(&Value::Bool(true)) && reply.get("cleared") == Some(&Value::Bool(true)) {
        return Ok(StatsReply { ok: true, statistics: None, error: None });
    }
    Ok(StatsReply::failed(code_of(&reply, &["stats_clear_failed"], "stats_unavailable")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good() -> Value {
        json!({"ok": true, "nights": [{"date": "2026-10-26", "hoursActive": 10.0, "found": 4, "aboveThreshold": 1,
               "scoreThreshold": 75, "consumptionPct": 5, "turnMedianSec": null}],
               "from": "2026-10-26", "to": "2026-10-26", "lastObservation": "2026-10-26T10:00:00Z",
               "retentionDays": 90, "threshold": 75, "scheduleState": "valid"})
    }

    #[test]
    fn the_team_answer_is_closed_to_the_list_and_serialised_in_camel_case() {
        let shown = serde_json::to_value(StatsReply { ok: true, statistics: Some(shape(&good()).unwrap()), error: None }).unwrap();
        assert_eq!(shown["ok"], true);
        assert_eq!(shown["nights"][0]["hoursActive"], 10.0);
        assert_eq!(shown["nights"][0]["aboveThreshold"], 1);
        assert_eq!(shown["nights"][0]["turnMedianSec"], Value::Null);
        assert_eq!(shown["lastObservation"], "2026-10-26T10:00:00Z");
        assert_eq!(shown["scheduleState"], "valid");
        let mut keys: Vec<_> = shown.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(keys, ["from", "lastObservation", "nights", "ok", "retentionDays", "scheduleState", "threshold", "to"]);
        let mut night: Vec<_> = shown["nights"][0].as_object().unwrap().keys().cloned().collect();
        night.sort();
        assert_eq!(night, ["aboveThreshold", "consumptionPct", "date", "found", "hoursActive", "scoreThreshold", "turnMedianSec"]);
    }

    /// The contract with the page: `work_stats_response.json` holds the answers as the page receives them (the
    /// page's own test reads the same file with pickWorkStats); `work_stats_team_response.json` holds, under the
    /// same names, what the team answers. Serialising the second must give the first, field for field.
    #[test]
    fn the_answer_handed_to_the_page_is_the_fixture_the_page_accepts() {
        let page: Value = serde_json::from_str(include_str!("../tests/fixtures/work_stats_response.json")).unwrap();
        let team: Value = serde_json::from_str(include_str!("../tests/fixtures/work_stats_team_response.json")).unwrap();
        let mut names: Vec<_> = page.as_object().unwrap().keys().cloned().collect();
        names.sort();
        assert_eq!(names, ["found_null", "no_data", "with_numbers"], "one with numbers, one with found null, one empty");
        for name in &names {
            let statistics = shape(&team[name]).unwrap_or_else(|_| panic!("{name}: the team's answer is refused"));
            let served = serde_json::to_value(StatsReply { ok: true, statistics: Some(statistics), error: None }).unwrap();
            assert_eq!(served, page[name], "{name}: what the app serves is not what the page's test reads");
        }
        assert!(page["found_null"]["nights"][0]["found"].is_null() && page["with_numbers"]["nights"][0]["found"].is_u64());
    }

    #[test]
    fn a_field_outside_the_closed_list_is_left_out_and_never_reaches_the_page() {
        let mut reply = good();
        reply["title"] = json!("posizione-1");
        reply["nights"][0]["company"] = json!("azienda-1");
        let text = serde_json::to_string(&shape(&reply).unwrap()).unwrap();
        assert!(!text.contains("posizione") && !text.contains("azienda"));
    }

    #[test]
    fn an_answer_with_a_value_out_of_its_range_is_refused_whole() {
        for (path, value) in [
            ("hoursActive", json!(1e9)),
            ("hoursActive", json!("ten")),
            ("found", json!(-1)),
            ("found", json!(1.5)),
            ("found", json!("4")),
            ("scoreThreshold", json!(101)),
            ("consumptionPct", json!(10_001)),
            ("date", json!("26/10/2026")),
            ("date", json!("<img src=x>")),
            ("turnMedianSec", json!(-3)),
        ] {
            let mut reply = good();
            reply["nights"][0][path] = value.clone();
            assert!(shape(&reply).is_err(), "{path} = {value} must be refused");
        }
        for (key, value) in [("scheduleState", json!("stopped")), ("retentionDays", json!(1e6)), ("threshold", json!(500)),
                             ("lastObservation", json!("2026-10-26T10:30:00Z")), ("from", json!("x"))] {
            let mut reply = good();
            reply[key] = value.clone();
            assert!(shape(&reply).is_err(), "{key} = {value} must be refused");
        }
        let mut crowded = good();
        crowded["nights"] = json!(vec![good()["nights"][0].clone(); MAX_NIGHTS + 1]);
        assert!(shape(&crowded).is_err());
        assert!(shape(&json!("a string")).is_err() && shape(&json!({"ok": true})).is_err());
    }

    #[test]
    fn nothing_known_is_null_and_never_a_made_up_zero() {
        let mut reply = good();
        reply["nights"][0]["found"] = Value::Null;
        reply["nights"][0]["aboveThreshold"] = Value::Null;
        reply["nights"][0]["consumptionPct"] = Value::Null;
        reply["lastObservation"] = Value::Null;
        let shown = serde_json::to_value(shape(&reply).unwrap()).unwrap();
        assert_eq!(shown["nights"][0]["found"], Value::Null);
        assert_eq!(shown["nights"][0]["aboveThreshold"], Value::Null);
        assert_eq!(shown["lastObservation"], Value::Null);
        let empty = json!({"nights": [], "from": null, "to": null, "lastObservation": null, "retentionDays": 90, "threshold": 75, "scheduleState": "undeclared"});
        assert_eq!(shape(&empty).unwrap().nights.len(), 0);
    }

    #[test]
    fn a_failure_is_one_of_the_closed_codes_and_nothing_else() {
        let said = |code: &str| json!({"ok": false, "error": code});
        assert_eq!(code_of(&said("stats_unreadable"), &["stats_unreadable"], "stats_unavailable"), "stats_unreadable");
        assert_eq!(code_of(&said("rm -rf / or a sentence"), &["stats_unreadable"], "stats_unavailable"), "stats_unavailable");
        assert_eq!(code_of(&json!({"ok": false}), &["stats_clear_failed"], "stats_unavailable"), "stats_unavailable");
        let failed = serde_json::to_value(StatsReply::failed("stats_unavailable")).unwrap();
        assert_eq!(failed, json!({"ok": false, "error": "stats_unavailable"}));
    }

    #[test]
    fn the_commands_take_no_argument_from_the_page_and_clearing_is_a_write() {
        let code = include_str!("work_stats.rs");
        let read = code.split("pub(crate) async fn work_stats_read(").nth(1).unwrap().split("\n}\n").next().unwrap();
        let clear = code.split("pub(crate) async fn work_stats_clear(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(read.contains("team_script_read(") && !read.contains("team_script_write("), "reading is a read");
        assert!(clear.contains("team_script_write(") && !clear.contains("team_script_read("), "clearing is a write");
        for command in [read, clear] {
            let signature = command.split(") -> Result").next().unwrap();
            assert!(!signature.contains("String") && !signature.contains("Value") && !signature.contains("u32"), "no argument from the page");
        }
        assert!(clear.contains("window_may_write(") && read.contains("window.label() != \"main\""));
    }

    #[test]
    fn the_script_asks_the_team_for_two_things_only_and_runs_nothing_the_page_names() {
        assert!(WORK_STATS_PY.contains("'/app/shared/skills/work_stats.py'"));
        assert!(WORK_STATS_PY.contains("op not in ('read','clear')"));
        assert!(!WORK_STATS_PY.contains("subprocess") && !WORK_STATS_PY.contains("os.system") && !WORK_STATS_PY.contains("eval("));
    }
}

//! How the team's weekly budget is going, for the Budget page: numbers and closed codes the team computes, closed again here.
//!
//! The team computes (`shared/skills/budget_view.py`, in the image: the same rate, the same active-hours line and the
//! same verdict the Sentinella and the pace guard use); the app only asks, through the chat's Python channel with a
//! fixed script of its own, and closes the answer: a closed list of fields, numbers, timestamps and codes from a closed
//! list, nothing else reaches the page (never a sentence the team wrote: the page puts each code in words). Read only:
//! it works in the read-only view. Only the main window asks.
use crate::{
    account_scope::AccountScopeState,
    direct_chat::{failure, team_script_read, DirectChatError, DirectChatState},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

const TIMEOUT: Duration = Duration::from_secs(40);
const MAX_ROLES: usize = 20;
const MAX_BRAKES: usize = 8;

/// The fixed script: loads the team's own `budget_view.py` and answers one JSON. An image older than the feature has
/// no such file: `budget_unavailable`.
const BUDGET_PY: &str = r#"import importlib.util,json,os,sys
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
try: req=json.loads(sys.stdin.readline())
except Exception: emit({'ok':False,'error':'budget_unavailable'})
if not isinstance(req,dict) or req.get('op')!='read' or set(req)-{'op'}: emit({'ok':False,'error':'budget_unavailable'})
os.environ.setdefault('JHT_HOME','/jht_home')
path='/app/shared/skills/budget_view.py'
if not os.path.isfile(path): emit({'ok':False,'error':'budget_unavailable'})
sys.path.insert(0,'/app/shared/skills')
try:
 spec=importlib.util.spec_from_file_location('budget_view',path); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
 out=mod.read()
except Exception: emit({'ok':False,'error':'budget_unreadable'})
emit(out)
"#;

const LINES: [&str; 3] = ["ahead", "on", "behind"];
const VERDICTS: [&str; 5] = ["ahead", "lockout_risk", "on_pace", "behind", "no_data"];
const BRAKES: [&str; 5] = ["pace_ahead", "lockout_risk", "daily_cap_stop", "recovering_after_freeze", "pause_between_jobs"];
const BURN_STATES: [&str; 4] = ["off", "active", "expired", "unknown"];
const ROLE_NAMES: [&str; 13] = [
    "capitano", "sentinella", "assistente", "mentor", "dottore", "mantenitore", "scout", "analista", "scorer", "scrittore",
    "critico", "tesoriere", "closer",
];
const WINDOWS: [&str; 2] = ["week", "5h"];

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Week {
    used_pct: Option<f64>,
    remaining_pct: Option<f64>,
    reset_at_unix: Option<u64>,
    active_hours_to_reset: Option<f64>,
    ideal_used_pct: Option<f64>,
    deviation_pts: Option<f64>,
    line: Option<&'static str>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Rate {
    lo_pct_h: Option<f64>,
    hi_pct_h: Option<f64>,
    now_pct_h: Option<f64>,
    sustainable_pct_h: Option<f64>,
    projected_final_pct: Option<f64>,
    wasted_pct: Option<f64>,
    lockout_early_active_h: Option<f64>,
    margin_active_h: Option<f64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Verdict {
    code: &'static str,
    brake: bool,
    steps: i64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Burn {
    state: &'static str,
    granted_at: Option<String>,
    expires_at: Option<String>,
    remaining_min: Option<u64>,
    spent_pts: Option<f64>,
    pace_before_pct_h: Option<f64>,
    pace_now_pct_h: Option<f64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RoleShare {
    role: &'static str,
    share_pct: f64,
    kt: f64,
    agents: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Roles {
    window: &'static str,
    roles: Vec<RoleShare>,
    unattributed_pct: Option<f64>,
    total_kt: Option<f64>,
    age_min: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BudgetView {
    generated_at: Option<String>,
    sample_at: Option<String>,
    sample_age_min: Option<u64>,
    week: Option<Week>,
    rate: Option<Rate>,
    verdict: Verdict,
    brakes: Vec<&'static str>,
    pause_sec: Option<u64>,
    burn: Burn,
    roles: Option<Roles>,
}

/// What the page gets: `ok: true` and the closed fields, or `ok: false` and a closed code.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BudgetReply {
    ok: bool,
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    budget: Option<BudgetView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

impl BudgetReply {
    fn failed(code: &'static str) -> Self {
        BudgetReply { ok: false, budget: None, error: Some(code) }
    }
}

type Shaped<T> = Result<T, ()>;

/// A number in its range, `null`/absent as `None`; a wrong type, NaN, Infinity or a value out of range refuses the whole answer.
fn num(value: Option<&Value>, low: f64, high: f64) -> Shaped<Option<f64>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_f64() {
            Some(n) if n.is_finite() && n >= low && n <= high && !v.is_boolean() => Ok(Some(n)),
            _ => Err(()),
        },
    }
}

fn int(value: Option<&Value>, high: u64) -> Shaped<Option<u64>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_u64() {
            Some(n) if n <= high => Ok(Some(n)),
            _ => Err(()),
        },
    }
}

/// `YYYY-MM-DDTHH:MM:SS` with an optional `+00:00` or `Z`: the only timestamps the team writes.
fn stamp_ok(text: &str) -> bool {
    let b = text.as_bytes();
    if b.len() < 19 || b.len() > 32 {
        return false;
    }
    let head = b[..19].iter().enumerate().all(|(i, c)| match i {
        4 | 7 => *c == b'-',
        10 => *c == b'T',
        13 | 16 => *c == b':',
        _ => c.is_ascii_digit(),
    });
    head && b[19..].iter().all(|c| c.is_ascii_digit() || matches!(c, b'+' | b'-' | b':' | b'Z' | b'.'))
}

fn stamp(value: Option<&Value>) -> Shaped<Option<String>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if stamp_ok(s) => Ok(Some(s.clone())),
        _ => Err(()),
    }
}

/// A code from a closed list, as the list's own text (so what is served is never the team's string).
fn code(value: Option<&Value>, list: &[&'static str]) -> Shaped<&'static str> {
    let said = value.and_then(Value::as_str).ok_or(())?;
    list.iter().copied().find(|c| *c == said).ok_or(())
}

fn code_or_null(value: Option<&Value>, list: &[&'static str]) -> Shaped<Option<&'static str>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        some => code(some, list).map(Some),
    }
}

fn section(value: Option<&Value>) -> Shaped<Option<&serde_json::Map<String, Value>>> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v.as_object().map(Some).ok_or(()),
    }
}

fn shape_week(o: &serde_json::Map<String, Value>) -> Shaped<Week> {
    Ok(Week {
        used_pct: num(o.get("usedPct"), 0.0, 10_000.0)?,
        remaining_pct: num(o.get("remainingPct"), 0.0, 10_000.0)?,
        reset_at_unix: int(o.get("resetAtUnix"), 99_999_999_999)?,
        active_hours_to_reset: num(o.get("activeHoursToReset"), 0.0, 1_000.0)?,
        ideal_used_pct: num(o.get("idealUsedPct"), 0.0, 10_000.0)?,
        deviation_pts: num(o.get("deviationPts"), -10_000.0, 10_000.0)?,
        line: code_or_null(o.get("line"), &LINES)?,
    })
}

fn shape_rate(o: &serde_json::Map<String, Value>) -> Shaped<Rate> {
    Ok(Rate {
        lo_pct_h: num(o.get("loPctH"), 0.0, 10_000.0)?,
        hi_pct_h: num(o.get("hiPctH"), 0.0, 10_000.0)?,
        now_pct_h: num(o.get("nowPctH"), 0.0, 10_000.0)?,
        sustainable_pct_h: num(o.get("sustainablePctH"), 0.0, 10_000.0)?,
        projected_final_pct: num(o.get("projectedFinalPct"), 0.0, 10_000.0)?,
        wasted_pct: num(o.get("wastedPct"), 0.0, 100.0)?,
        lockout_early_active_h: num(o.get("lockoutEarlyActiveH"), 0.0, 1_000.0)?,
        margin_active_h: num(o.get("marginActiveH"), 0.0, 100.0)?,
    })
}

fn shape_burn(o: &serde_json::Map<String, Value>) -> Shaped<Burn> {
    Ok(Burn {
        state: code(o.get("state"), &BURN_STATES)?,
        granted_at: stamp(o.get("grantedAt"))?,
        expires_at: stamp(o.get("expiresAt"))?,
        remaining_min: int(o.get("remainingMin"), 24 * 60)?,
        spent_pts: num(o.get("spentPts"), 0.0, 10_000.0)?,
        pace_before_pct_h: num(o.get("paceBeforePctH"), 0.0, 10_000.0)?,
        pace_now_pct_h: num(o.get("paceNowPctH"), 0.0, 10_000.0)?,
    })
}

fn shape_roles(o: &serde_json::Map<String, Value>) -> Shaped<Roles> {
    let listed = o.get("roles").and_then(Value::as_array).ok_or(())?;
    if listed.len() > MAX_ROLES {
        return Err(());
    }
    let mut roles = Vec::with_capacity(listed.len());
    for item in listed {
        let r = item.as_object().ok_or(())?;
        roles.push(RoleShare {
            role: code(r.get("role"), &ROLE_NAMES)?,
            share_pct: num(r.get("sharePct"), 0.0, 100.0)?.ok_or(())?,
            kt: num(r.get("kt"), 0.0, 1e9)?.ok_or(())?,
            agents: int(r.get("agents"), 200)?,
        });
    }
    Ok(Roles {
        window: code(o.get("window"), &WINDOWS)?,
        roles,
        unattributed_pct: num(o.get("unattributedPct"), 0.0, 100.0)?,
        total_kt: num(o.get("totalKt"), 0.0, 1e9)?,
        age_min: int(o.get("ageMin"), 10_000_000)?,
    })
}

/// The team's answer closed again: every field of the closed list, in its range, or the whole answer is refused (the
/// page then says the budget is unavailable, and never shows a number it was not given or a word the team chose).
fn shape(reply: &Value) -> Shaped<BudgetView> {
    let o = reply.as_object().ok_or(())?;
    let v = o.get("verdict").and_then(Value::as_object).ok_or(())?;
    let steps = v.get("steps").and_then(Value::as_i64).filter(|s| (-6..=6).contains(s)).ok_or(())?;
    let brake = v.get("brake").and_then(Value::as_bool).ok_or(())?;
    let listed = o.get("brakes").and_then(Value::as_array).ok_or(())?;
    if listed.len() > MAX_BRAKES {
        return Err(());
    }
    let mut brakes = Vec::with_capacity(listed.len());
    for b in listed {
        brakes.push(code(Some(b), &BRAKES)?);
    }
    let burn = section(o.get("burn"))?.ok_or(())?;
    Ok(BudgetView {
        generated_at: stamp(o.get("generatedAt"))?,
        sample_at: stamp(o.get("sampleAt"))?,
        sample_age_min: int(o.get("sampleAgeMin"), 10_000_000)?,
        week: section(o.get("week"))?.map(shape_week).transpose()?,
        rate: section(o.get("rate"))?.map(shape_rate).transpose()?,
        verdict: Verdict { code: code(v.get("code"), &VERDICTS)?, brake, steps },
        brakes,
        pause_sec: int(o.get("pauseSec"), 3600)?,
        burn: shape_burn(burn)?,
        roles: section(o.get("roles"))?.map(shape_roles).transpose()?,
    })
}

fn code_of(reply: &Value, allowed: &[&'static str], fallback: &'static str) -> &'static str {
    let said = reply.get("error").and_then(Value::as_str);
    allowed.iter().copied().find(|code| Some(*code) == said).unwrap_or(fallback)
}

/// The team's weekly budget, as the team computes it. Reads: it works in the read-only view. A read that does not give the
/// numbers leaves its closed code in the runtime log (never a number), and the page is told that same code.
#[tauri::command]
pub(crate) async fn team_budget_read(
    window: tauri::Window,
    app: tauri::AppHandle,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<BudgetReply, DirectChatError> {
    if window.label() != "main" {
        return Err(failure("invalid_request"));
    }
    let started = std::time::Instant::now();
    let result = read_budget(&state, &scopes).await;
    let worked = matches!(&result, Ok(reply) if reply.ok);
    crate::load_times::note_native_read(&app, "team.budget", crate::load_times::ReadVia::Chat, worked, started);
    let said = match &result {
        Ok(reply) => reply.error,
        Err(error) => Some(error.code),
    };
    if let (Some(code), Some(log)) = (said, crate::runtime_log::RuntimeLog::new(&app)) {
        log.record_budget_failure(code);
    }
    result
}

/// One read through the chat's Python channel, closed again. Each way of not getting the numbers has its own code: the file
/// missing in an old image is `budget_unavailable` and nothing else is; a chat that is not connected, a read that failed or ran
/// out of time is the chat's own error, passed on; an answer the app does not recognise is `budget_reply_unexpected`.
async fn read_budget(state: &State<'_, DirectChatState>, scopes: &State<'_, AccountScopeState>) -> Result<BudgetReply, DirectChatError> {
    let reply = team_script_read(state, scopes, BUDGET_PY, json!({"op": "read"}), TIMEOUT).await?;
    if reply.get("ok") != Some(&Value::Bool(true)) {
        return Ok(BudgetReply::failed(code_of(&reply, &["budget_unreadable", "budget_unavailable"], "budget_unreadable")));
    }
    Ok(match shape(&reply) {
        Ok(budget) => BudgetReply { ok: true, budget: Some(budget), error: None },
        Err(()) => BudgetReply::failed("budget_reply_unexpected"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn team() -> Value {
        serde_json::from_str(include_str!("../tests/fixtures/budget_team_response.json")).unwrap()
    }

    #[test]
    fn the_answer_handed_to_the_page_is_the_fixture_the_page_accepts() {
        let page: Value = serde_json::from_str(include_str!("../tests/fixtures/budget_response.json")).unwrap();
        let team: Value = serde_json::from_str(include_str!("../tests/fixtures/budget_team_response.json")).unwrap();
        let mut names: Vec<_> = page.as_object().unwrap().keys().cloned().collect();
        names.sort();
        assert_eq!(names, ["ahead_without_override", "no_data", "override_lockout_risk"]);
        for name in &names {
            let budget = shape(&team[name]).unwrap_or_else(|_| panic!("{name}: the team's answer is refused"));
            let served = serde_json::to_value(BudgetReply { ok: true, budget: Some(budget), error: None }).unwrap();
            assert_eq!(served, page[name], "{name}: what the app serves is not what the page's test reads");
        }
    }

    #[test]
    fn a_field_outside_the_closed_list_is_left_out_and_never_reaches_the_page() {
        let mut reply = team()["ahead_without_override"].clone();
        reply["note"] = json!("a sentence the team wrote");
        reply["week"]["comment"] = json!("another");
        reply["roles"]["roles"][0]["title"] = json!("posizione-1");
        let text = serde_json::to_string(&shape(&reply).unwrap()).unwrap();
        assert!(!text.contains("sentence") && !text.contains("another") && !text.contains("posizione"));
    }

    #[test]
    fn a_code_outside_its_closed_list_refuses_the_whole_answer_and_a_served_code_is_ours() {
        for (path, value) in [
            ("verdict.code", json!("<img src=x>")),
            ("verdict.code", json!("AVANTI")),
            ("week.line", json!("a lot")),
            ("burn.state", json!("on")),
            ("roles.window", json!("month")),
            ("roles.roles.0.role", json!("<script>")),
            ("brakes.0", json!("go slower, said the team")),
        ] {
            let mut reply = team()["ahead_without_override"].clone();
            set(&mut reply, path, value.clone());
            assert!(shape(&reply).is_err(), "{path} = {value} must be refused");
        }
    }

    #[test]
    fn a_number_out_of_its_range_or_of_the_wrong_kind_refuses_the_whole_answer() {
        for (path, value) in [
            ("week.usedPct", json!(1e9)),
            ("week.usedPct", json!(-1.0)),
            ("week.usedPct", json!("46")),
            ("week.usedPct", json!(true)),
            ("week.resetAtUnix", json!(1.5)),
            ("week.resetAtUnix", json!(-3)),
            ("week.activeHoursToReset", json!(1e6)),
            ("rate.wastedPct", json!(101.0)),
            ("rate.loPctH", json!("NaN")),
            ("verdict.steps", json!(7)),
            ("verdict.steps", json!(1.5)),
            ("verdict.brake", json!("yes")),
            ("pauseSec", json!(99_999)),
            ("sampleAgeMin", json!(-1)),
            ("sampleAt", json!("yesterday")),
            ("sampleAt", json!("2026-11-02T22:00:00<script>")),
            ("burn.remainingMin", json!(100_000)),
            ("burn.spentPts", json!(-1.0)),
            ("roles.roles.0.sharePct", json!(500.0)),
            ("roles.roles.0.kt", json!(null)),
            ("roles.roles.0.agents", json!(1000)),
            ("roles.totalKt", json!("x")),
        ] {
            let mut reply = team()["ahead_without_override"].clone();
            set(&mut reply, path, value.clone());
            assert!(shape(&reply).is_err(), "{path} = {value} must be refused");
        }
        let mut crowded = team()["ahead_without_override"].clone();
        crowded["roles"]["roles"] = json!(vec![crowded["roles"]["roles"][0].clone(); MAX_ROLES + 1]);
        assert!(shape(&crowded).is_err());
        let mut braked = team()["ahead_without_override"].clone();
        braked["brakes"] = json!(vec!["pace_ahead"; MAX_BRAKES + 1]);
        assert!(shape(&braked).is_err());
        assert!(shape(&json!("a string")).is_err() && shape(&json!({"ok": true})).is_err());
    }

    #[test]
    fn nothing_known_is_null_and_never_a_made_up_zero() {
        let shown = serde_json::to_value(shape(&team()["no_data"]).unwrap()).unwrap();
        assert_eq!(shown["week"], Value::Null);
        assert_eq!(shown["rate"], Value::Null);
        assert_eq!(shown["roles"], Value::Null);
        assert_eq!(shown["sampleAt"], Value::Null);
        assert_eq!(shown["burn"]["spentPts"], Value::Null);
        assert_eq!(shown["verdict"]["code"], "no_data");
    }

    #[test]
    fn a_failure_is_one_of_the_closed_codes_and_nothing_else() {
        let said = |code: &str| json!({"ok": false, "error": code});
        let allowed = ["budget_unreadable", "budget_unavailable"];
        assert_eq!(code_of(&said("budget_unreadable"), &allowed, "budget_unreadable"), "budget_unreadable");
        // the file missing in the image is the one answer that says «the team does not offer it»
        assert_eq!(code_of(&said("budget_unavailable"), &allowed, "budget_unreadable"), "budget_unavailable");
        assert_eq!(code_of(&said("rm -rf / or a sentence"), &allowed, "budget_unreadable"), "budget_unreadable");
        assert_eq!(code_of(&json!({"ok": false}), &allowed, "budget_unreadable"), "budget_unreadable");
        let failed = serde_json::to_value(BudgetReply::failed("budget_unavailable")).unwrap();
        assert_eq!(failed, json!({"ok": false, "error": "budget_unavailable"}));
    }

    #[test]
    fn the_command_takes_no_argument_from_the_page_and_is_a_read() {
        let code = include_str!("team_budget.rs");
        let command = code.split("pub(crate) async fn team_budget_read(").nth(1).unwrap().split("\n}\n").next().unwrap();
        let read = code.split("async fn read_budget(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(read.contains("team_script_read(") && !read.contains("team_script_write("), "reading is a read");
        assert!(command.contains("read_budget(") && !command.contains("team_script_write("));
        let signature = command.split(") -> Result").next().unwrap();
        assert!(!signature.contains("String") && !signature.contains("Value") && !signature.contains("u32"), "no argument from the page");
        assert!(command.contains("window.label() != \"main\""));
        // a failed read is logged by its code, and the answer the app does not recognise is not «the team does not offer it»
        assert!(command.contains("record_budget_failure(code)"));
        assert!(read.contains("budget_reply_unexpected") && !read.contains("failed(\"budget_unavailable\")"));
    }

    #[test]
    fn the_answer_of_a_team_with_a_week_and_no_rate_yet_is_taken_whole() {
        let given: Value = serde_json::from_str(include_str!("../tests/fixtures/budget_team_week_no_rate.json")).unwrap();
        let shown = serde_json::to_value(BudgetReply { ok: true, budget: Some(shape(&given).expect("this answer is refused")), error: None }).unwrap();
        assert_eq!(shown["ok"], true);
        assert_eq!(shown["verdict"]["code"], "no_data");
        assert_eq!(shown["week"]["usedPct"], 37.0);
        assert_eq!(shown["week"]["line"], Value::Null);
        assert_eq!(shown["rate"], Value::Null);
        assert_eq!(shown["roles"]["roles"].as_array().unwrap().len(), 8);
    }

    #[test]
    fn the_script_asks_the_team_for_one_thing_only_and_runs_nothing_the_page_names() {
        assert!(BUDGET_PY.contains("'/app/shared/skills/budget_view.py'"));
        assert!(BUDGET_PY.contains("req.get('op')!='read'"));
        assert!(!BUDGET_PY.contains("subprocess") && !BUDGET_PY.contains("os.system") && !BUDGET_PY.contains("eval("));
    }

    /// Sets `a.b.0.c` on a JSON value (a digit is an array index).
    fn set(value: &mut Value, path: &str, new: Value) {
        let mut at = value;
        let parts: Vec<_> = path.split('.').collect();
        for (i, part) in parts.iter().enumerate() {
            let last = i + 1 == parts.len();
            let next = match part.parse::<usize>() {
                Ok(index) => &mut at[index],
                Err(_) => &mut at[*part],
            };
            if last {
                *next = new;
                return;
            }
            at = next;
        }
    }
}

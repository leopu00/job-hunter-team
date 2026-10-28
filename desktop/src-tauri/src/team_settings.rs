//! The team's working hours and the model and effort of each role, read and written from the app.
//!
//! The site changes them (`/settings/team`); the app had no way to. One typed command, the same
//! destinations as the agents' panel (agent_control.rs: the linked VPS by its pinned container, the
//! app's own VPS and this computer by the attested wrapper's `agent-control` door, which never
//! starts anything), and the same rules as the site and `jht wh` on the box side (`jht
//! team-settings`, cli/src/lib/team-settings.js), which are authoritative. What is checked here is
//! the closed shape and the closed lists, before anything is sent: a value out of them refuses the
//! whole request, and nothing is half written.
//!
//! - only the `main` window;
//! - `read` always works, and answers with the key a write must carry (`connectionKey`);
//! - `write` on a VPS needs the team connected IN FULL (or the app's own VPS, marked) and that key:
//!   a read-only link, or a team the page no longer shows, is refused;
//! - the box answers with what it holds after the write, read again: the page shows that, not what it sent;
//! - a config that cannot be read, or an image without the command, is an error, never a made-up default.
//!
//! The model is a CLASS (`sol`, `terra`, `luna`), never the name of a model: which model a class
//! means is the team's provider's business.

use crate::{
    account_scope::AccountScopeState,
    agent_control::{destination, destination_mode, own_vps_wrapper, window_refusal, Destination, VpsMode},
    existing_team_runtime::{command, RuntimeTarget},
    runtime_host::{run_ssh_command, ProcessResult},
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::time::Duration;
use tauri::State;

const RUN_TIMEOUT: Duration = Duration::from_secs(30);
const REQUEST_MAX_BYTES: usize = 65536;
const ROLES: [&str; 10] = [
    "capitano", "scout", "analista", "scorer", "scrittore", "critico", "sentinella", "assistente", "mentor", "closer",
];
const MODELS: [&str; 3] = ["sol", "terra", "luna"];
const EFFORTS: [&str; 3] = ["low", "medium", "high"];
const WEEKDAYS: [&str; 7] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const LIST_KEYS: [&str; 5] = ["roles", "models", "efforts", "weekdays", "min_window_hours"];

fn failure(code: &str) -> Value {
    json!({ "ok": false, "error": code })
}

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum Request {
    Read {},
    Write {
        settings: Value,
        #[serde(rename = "connectionKey")]
        connection_key: String,
    },
}

fn time_of_day(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.len() == 5
        && bytes[2] == b':'
        && bytes.iter().enumerate().all(|(i, b)| i == 2 || b.is_ascii_digit())
        && text[..2].parse::<u8>().is_ok_and(|hour| hour < 24)
        && text[3..].parse::<u8>().is_ok_and(|minute| minute < 60)
}

fn only_keys(map: &Map<String, Value>, allowed: &[&str]) -> bool {
    map.keys().all(|key| allowed.contains(&key.as_str()))
}

fn valid_working_hours(value: &Value) -> bool {
    if value.is_null() {
        return true;
    }
    let Some(object) = value.as_object() else { return false };
    if !only_keys(object, &["timezone", "windows"]) {
        return false;
    }
    let zone_ok = object.get("timezone").and_then(Value::as_str).is_some_and(|zone| {
        (1..=64).contains(&zone.len()) && zone.bytes().all(|b| b.is_ascii_alphanumeric() || b"_+-/".contains(&b))
    });
    let Some(windows) = object.get("windows").and_then(Value::as_array) else { return false };
    if !zone_ok || windows.len() > WEEKDAYS.len() {
        return false;
    }
    let mut seen: Vec<&str> = Vec::new();
    windows.iter().all(|window| {
        let Some(window) = window.as_object() else { return false };
        if !only_keys(window, &["days", "start", "end"]) {
            return false;
        }
        let days_ok = window.get("days").and_then(Value::as_array).is_some_and(|days| {
            !days.is_empty()
                && days.iter().all(|day| {
                    day.as_str().is_some_and(|day| {
                        let fresh = WEEKDAYS.contains(&day) && !seen.contains(&day);
                        if fresh {
                            seen.push(day);
                        }
                        fresh
                    })
                })
        });
        let start = window.get("start").and_then(Value::as_str);
        let end = window.get("end").and_then(Value::as_str);
        days_ok && matches!((start, end), (Some(s), Some(e)) if time_of_day(s) && time_of_day(e) && s != e)
    })
}

fn valid_role_models(value: &Value) -> bool {
    let Some(roles) = value.as_object() else { return false };
    only_keys(roles, &ROLES)
        && roles.values().all(|entry| {
            entry.as_object().is_some_and(|entry| {
                only_keys(entry, &["model", "effort"])
                    && entry.get("model").map_or(true, |model| model.as_str().is_some_and(|m| MODELS.contains(&m)))
                    && entry.get("effort").map_or(true, |effort| effort.as_str().is_some_and(|e| EFFORTS.contains(&e)))
            })
        })
}

/// The closed shape and lists; the box checks the rest (block length, the zone) again.
fn valid_settings(settings: &Value) -> bool {
    let Some(object) = settings.as_object() else { return false };
    !object.is_empty()
        && only_keys(object, &["working_hours", "role_models"])
        && object.get("working_hours").map_or(true, valid_working_hours)
        && object.get("role_models").map_or(true, valid_role_models)
        && serde_json::to_vec(settings).is_ok_and(|bytes| bytes.len() <= REQUEST_MAX_BYTES - 64)
}

fn stdin_of(request: &Request) -> Option<Vec<u8>> {
    match request {
        Request::Read {} => None,
        Request::Write { settings, .. } => {
            let mut line = serde_json::to_vec(&json!({ "settings": settings })).ok()?;
            line.push(b'\n');
            Some(line)
        }
    }
}

fn verb(request: &Request) -> &'static str {
    match request {
        Request::Read {} => "get",
        Request::Write { .. } => "apply",
    }
}

/// A linked VPS: the pinned container's checks, then the box's command. Nothing of the settings in it.
fn vps_command(runtime: &RuntimeTarget, verb: &str) -> Result<String, &'static str> {
    command(runtime, &format!("exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" node /app/cli/bin/jht.js team-settings {verb}"))
}

/// The box's command line on each destination. The settings travel on stdin, never in a command.
fn run(destination: &Destination, request: &Request) -> Result<ProcessResult, &'static str> {
    let input = stdin_of(request);
    let verb = verb(request);
    match destination {
        Destination::Vps { validated, runtime, .. } => {
            let remote = vps_command(runtime, verb)?;
            run_ssh_command(validated, &remote, input.as_deref(), RUN_TIMEOUT, None)
        }
        Destination::OwnVps { validated, .. } => {
            let remote = own_vps_wrapper("JHT_AGENT_CONTROL_PROTOCOL=1", &format!("agent-control settings {verb}"));
            run_ssh_command(validated, &remote, input.as_deref(), RUN_TIMEOUT, None)
        }
        Destination::Local { wrapper, .. } => {
            crate::onboarding::run_verified_local_wrapper(wrapper, &["agent-control", "settings", verb], input.as_deref(), RUN_TIMEOUT)
        }
    }
}

/// What the box holds, in the closed shape: hours null or an object, roles an object, the lists the
/// box's own. Anything else is not a reading.
fn settings_of(out: &Map<String, Value>) -> Option<Value> {
    let hours = out.get("working_hours")?;
    let roles = out.get("role_models")?;
    if !valid_working_hours(hours) || !valid_role_models(roles) {
        return None;
    }
    let lists = out.get("lists")?.as_object()?;
    if lists.len() != LIST_KEYS.len() || !LIST_KEYS.iter().all(|key| lists.contains_key(*key)) {
        return None;
    }
    let names = |key: &str| -> Option<Vec<&str>> {
        lists.get(key)?.as_array()?.iter().map(Value::as_str).collect()
    };
    if names("roles")? != ROLES || names("models")? != MODELS || names("efforts")? != EFFORTS || names("weekdays")? != WEEKDAYS {
        return None;
    }
    if lists.get("min_window_hours")?.as_u64()? != 4 {
        return None;
    }
    let mut settings = json!({ "working_hours": hours, "role_models": roles, "lists": lists });
    // The model each role is really started with is optional: a box older than this field does not
    // send it, and one that sends it out of shape is read as if it had not. Never a default made up.
    if let Some((provider, class_applies, effective)) = effective_of(out) {
        settings["provider"] = provider;
        settings["classApplies"] = class_applies;
        settings["effective"] = effective;
    }
    Some(settings)
}

fn name_ok(text: &str) -> bool {
    (1..=40).contains(&text.len()) && text.bytes().all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
}

/// provider, classApplies and effective, only if all three are whole: the provider one of the three,
/// and every role of the lists with its four closed fields.
fn effective_of(out: &Map<String, Value>) -> Option<(Value, Value, Value)> {
    let provider = out.get("provider")?;
    let class_applies = out.get("classApplies")?;
    let effective = out.get("effective")?.as_object()?;
    if !provider.as_str().is_some_and(|p| ["codex", "claude", "kimi"].contains(&p)) || !class_applies.is_boolean() {
        return None;
    }
    if effective.len() != ROLES.len() || !ROLES.iter().all(|role| effective.contains_key(*role)) {
        return None;
    }
    let whole = effective.values().all(|entry| {
        entry.as_object().is_some_and(|entry| {
            let text = |key: &str| entry.get(key).and_then(Value::as_str);
            entry.len() == 4
                && text("model").is_some_and(|m| MODELS.contains(&m))
                && text("modelName").is_some_and(name_ok)
                && text("effort").is_some_and(|e| EFFORTS.contains(&e))
                && text("from").is_some_and(|f| f == "config" || f == "default")
        })
    });
    whole.then(|| (provider.clone(), class_applies.clone(), Value::Object(effective.clone())))
}

fn closed(code: &str) -> Option<&str> {
    ((1..=48).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')).then_some(code)
}

/// What the box answered, as the page may read it.
fn reply(result: Result<ProcessResult, &'static str>, target: &str, key: &str) -> Value {
    if let Some(code) = crate::runtime_host::ssh_way_in_code(&result) {
        return failure(code);
    }
    let Ok(result) = result else { return failure("team_settings_unavailable") };
    if result.code == 70 {
        return failure("existing_team_runtime_changed");
    }
    let line: Option<Value> =
        String::from_utf8_lossy(&result.stdout).lines().last().and_then(|line| serde_json::from_str(line).ok());
    let Some(Value::Object(out)) = line else {
        // No JSON at all: an image without the command (an older team).
        return failure("existing_team_runtime_outdated");
    };
    if result.code == 0 && out.get("ok") == Some(&Value::Bool(true)) {
        return match settings_of(&out) {
            Some(Value::Object(mut settings)) => {
                settings.insert("ok".into(), Value::Bool(true));
                settings.insert("target".into(), json!(target));
                settings.insert("connectionKey".into(), json!(key));
                Value::Object(settings)
            }
            _ => failure("team_settings_unavailable"),
        };
    }
    let code = out.get("error").or_else(|| out.get("code")).and_then(Value::as_str).and_then(closed);
    match code {
        Some("value_invalid") => failure("team_settings_value_invalid"),
        // the door does not know the verb: an image older than this command
        Some("agent_control_invalid") | Some("request_invalid") => failure("existing_team_runtime_outdated"),
        _ => failure("team_settings_unavailable"),
    }
}

/// The whole decision, with the box and the destination injected (the order the tests drive).
fn team_settings_with(
    request: Value,
    window_is_main: bool,
    destination: impl FnOnce() -> Result<(Option<VpsMode>, Option<&'static str>, String, &'static str), &'static str>,
    run: impl FnOnce(&Request) -> Result<ProcessResult, &'static str>,
) -> Value {
    if let Some(error) = window_refusal(if window_is_main { "main" } else { "other" }) {
        return failure(error);
    }
    if serde_json::to_vec(&request).map_or(true, |bytes| bytes.len() > REQUEST_MAX_BYTES) {
        return failure("team_settings_request_invalid");
    }
    let Ok(request) = serde_json::from_value::<Request>(request) else {
        return failure("team_settings_request_invalid");
    };
    if let Request::Write { settings, .. } = &request {
        if !valid_settings(settings) {
            return failure("team_settings_value_invalid");
        }
    }
    let (mode, claim, key, target) = match destination() {
        Ok(found) => found,
        Err(error) => return failure(error),
    };
    if let Request::Write { connection_key, .. } = &request {
        // the app's own VPS with no mark: the page's invitation to claim it, not a generic «read only»
        if let Some(code) = claim {
            return failure(code);
        }
        if mode == Some(VpsMode::ReadOnly) {
            return failure("team_settings_read_only");
        }
        if *connection_key != key {
            return failure("existing_team_runtime_target_changed");
        }
    }
    reply(run(&request), target, &key)
}

#[tauri::command]
pub(crate) async fn team_settings(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    request: Value,
) -> Result<Value, String> {
    let window_is_main = window.label() == "main";
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(failure("account_scope_unavailable")),
    };
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state.lock_expected(&worker_expected).map_err(|_| "account_scope_changed")?;
        let found = std::cell::RefCell::new(None);
        Ok::<Value, &'static str>(team_settings_with(
            request,
            window_is_main,
            || {
                let (found_destination, print) = destination(&app, &worker_expected)?;
                let mode = destination_mode(&found_destination);
                let claim = match &found_destination {
                    Destination::OwnVps { state, .. } => state.write_refusal(),
                    _ => None,
                };
                let target = if matches!(found_destination, Destination::Local { .. }) { "local" } else { "vps" };
                *found.borrow_mut() = Some(found_destination);
                Ok((mode, claim, print, target))
            },
            |request| match found.borrow().as_ref() {
                Some(found_destination) => run(found_destination, request),
                None => Err("team_settings_unavailable"),
            },
        ))
    })
    .await
    .unwrap_or(Err("team_settings_unavailable"));
    if scopes.lock_expected(&expected).is_err() {
        return Ok(failure("account_scope_changed"));
    }
    Ok(result.unwrap_or_else(|error| failure(error)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const KEY: &str = "print-1";

    fn lists() -> Value {
        json!({"roles": ROLES, "models": MODELS, "efforts": EFFORTS, "weekdays": WEEKDAYS, "min_window_hours": 4})
    }

    fn held(hours: Value, roles: Value) -> String {
        json!({"ok": true, "working_hours": hours, "role_models": roles, "lists": lists()}).to_string()
    }

    fn done(stdout: &str) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult { code: 0, stdout: stdout.as_bytes().to_vec() })
    }

    fn at(mode: Option<VpsMode>) -> Result<(Option<VpsMode>, Option<&'static str>, String, &'static str), &'static str> {
        Ok((mode, None, KEY.to_owned(), if mode.is_some() { "vps" } else { "local" }))
    }

    fn write(settings: Value) -> Value {
        json!({"op": "write", "settings": settings, "connectionKey": KEY})
    }

    fn hours() -> Value {
        json!({"timezone": "Europe/Rome", "windows": [{"days": ["mon", "tue"], "start": "09:00", "end": "18:00"}]})
    }

    fn drive(request: Value, mode: Option<VpsMode>, reply: Result<ProcessResult, &'static str>, ran: &Cell<u32>) -> Value {
        team_settings_with(request, true, || at(mode), |_| {
            ran.set(ran.get() + 1);
            reply
        })
    }

    #[test]
    fn a_read_always_works_and_hands_out_the_key_a_write_must_carry() {
        let ran = Cell::new(0);
        let body = held(hours(), json!({"scout": {"model": "luna"}}));
        for mode in [None, Some(VpsMode::Full), Some(VpsMode::ReadOnly)] {
            let out = drive(json!({"op": "read"}), mode, done(&body), &ran);
            assert_eq!(out["ok"], true);
            assert_eq!(out["connectionKey"], KEY);
            assert_eq!(out["target"], if mode.is_some() { "vps" } else { "local" });
            assert_eq!(out["working_hours"], hours());
            assert_eq!(out["role_models"], json!({"scout": {"model": "luna"}}));
            assert_eq!(out["lists"], lists());
        }
        assert_eq!(ran.get(), 3);
    }

    fn effective_roles() -> Value {
        let mut roles = Map::new();
        for role in ROLES {
            roles.insert(role.to_string(), json!({"model": "terra", "modelName": "gpt-5.6-terra", "effort": "high", "from": "default"}));
        }
        Value::Object(roles)
    }

    fn held_with(extra: Value) -> String {
        let mut body: Value = serde_json::from_str(&held(Value::Null, json!({}))).unwrap();
        for (key, value) in extra.as_object().unwrap() {
            body[key] = value.clone();
        }
        body.to_string()
    }

    #[test]
    fn the_model_each_role_is_started_with_passes_through_whole_or_not_at_all() {
        let ran = Cell::new(0);
        let read = |body: String| drive(json!({"op": "read"}), None, done(&body), &ran);
        let whole = json!({"provider": "codex", "classApplies": true, "effective": effective_roles()});
        let out = read(held_with(whole.clone()));
        assert_eq!(out["ok"], true);
        assert_eq!(out["provider"], "codex");
        assert_eq!(out["classApplies"], true);
        assert_eq!(out["effective"], effective_roles());
        // a box older than the field, or a provider with nothing to show: still a reading, without it
        for body in [held(Value::Null, json!({})), held_with(json!({"provider": "kimi", "classApplies": false}))] {
            let out = read(body);
            assert_eq!(out["ok"], true);
            assert!(out.get("effective").is_none() && out.get("provider").is_none() && out.get("classApplies").is_none());
        }
        // out of shape: the reading stays, the field is dropped, nothing is made up
        let mut one_role_short = effective_roles();
        one_role_short.as_object_mut().unwrap().remove("closer");
        let mut extra_key = effective_roles();
        extra_key["scout"]["secret"] = json!("x");
        let mut bad_name = effective_roles();
        bad_name["scout"]["modelName"] = json!("gpt 5; rm");
        let mut bad_class = effective_roles();
        bad_class["scout"]["model"] = json!("gpt");
        let mut bad_from = effective_roles();
        bad_from["scout"]["from"] = json!("cache");
        for broken in [
            json!({"provider": "codex", "classApplies": true, "effective": one_role_short}),
            json!({"provider": "codex", "classApplies": true, "effective": extra_key}),
            json!({"provider": "codex", "classApplies": true, "effective": bad_name}),
            json!({"provider": "codex", "classApplies": true, "effective": bad_class}),
            json!({"provider": "codex", "classApplies": true, "effective": bad_from}),
            json!({"provider": "gemini", "classApplies": true, "effective": effective_roles()}),
            json!({"provider": "codex", "classApplies": "yes", "effective": effective_roles()}),
            json!({"provider": "codex", "effective": effective_roles()}),
        ] {
            let out = read(held_with(broken.clone()));
            assert_eq!(out["ok"], true, "{broken}");
            assert!(out.get("effective").is_none() && out.get("provider").is_none(), "{broken}");
        }
    }

    #[test]
    fn a_write_answers_with_what_the_box_reads_back_not_with_what_was_sent() {
        let ran = Cell::new(0);
        let sent = json!({"role_models": {"scout": {"model": "sol"}}});
        let held_now = held(Value::Null, json!({"scout": {"model": "terra"}}));
        let out = team_settings_with(write(sent.clone()), true, || at(None), |request| {
            ran.set(ran.get() + 1);
            // the settings go on stdin as one JSON line, nothing else
            let stdin = stdin_of(request).unwrap();
            assert_eq!(stdin.iter().filter(|b| **b == b'\n').count(), 1);
            assert_eq!(serde_json::from_slice::<Value>(&stdin).unwrap(), json!({"settings": sent}));
            assert_eq!(verb(request), "apply");
            done(&held_now)
        });
        assert_eq!(out["role_models"], json!({"scout": {"model": "terra"}}));
        assert_eq!(out["working_hours"], Value::Null);
        assert_eq!(ran.get(), 1);
    }

    #[test]
    fn another_window_is_refused_and_a_request_that_is_not_one_never_reaches_the_box() {
        let ran = Cell::new(0);
        let out = team_settings_with(json!({"op": "read"}), false, || at(None), |_| {
            ran.set(ran.get() + 1);
            done("{}")
        });
        assert_eq!(out["error"], "agent_control_window");
        for request in [
            json!({"op": "wipe"}),
            json!({"op": "read", "settings": {}}),
            json!({"op": "read", "host": "x"}),
            json!({"op": "write", "settings": {"role_models": {}}}),
            json!({"op": "write", "connectionKey": KEY}),
            json!({"op": "write", "settings": {"role_models": {}}, "connectionKey": KEY, "force": true}),
            json!("read"),
            json!(null),
        ] {
            assert_eq!(drive(request.clone(), None, done("{}"), &ran)["error"], "team_settings_request_invalid", "{request}");
        }
        assert_eq!(ran.get(), 0);
    }

    #[test]
    fn one_value_out_of_the_lists_refuses_the_whole_write_before_the_box_is_even_asked() {
        let asked = Cell::new(false);
        for settings in [
            json!({}),
            json!(null),
            json!([]),
            json!({"other": 1}),
            json!({"role_models": {"cuoco": {"model": "luna"}}}),
            json!({"role_models": {"scout": {"model": "gpt-5"}}}),
            json!({"role_models": {"scout": {"effort": "max"}}}),
            json!({"role_models": {"scout": {"model": "luna", "temperature": 1}}}),
            json!({"role_models": {"scout": "luna"}}),
            json!({"role_models": [], "working_hours": null}),
            json!({"working_hours": {"timezone": "UTC"}}),
            json!({"working_hours": {"timezone": "UTC", "windows": [], "extra": 1}}),
            json!({"working_hours": {"timezone": "x y", "windows": []}}),
            json!({"working_hours": {"timezone": "UTC", "windows": [{"days": [], "start": "09:00", "end": "18:00"}]}}),
            json!({"working_hours": {"timezone": "UTC", "windows": [{"days": ["mon", "mon"], "start": "09:00", "end": "18:00"}]}}),
            json!({"working_hours": {"timezone": "UTC", "windows": [{"days": ["funday"], "start": "09:00", "end": "18:00"}]}}),
            json!({"working_hours": {"timezone": "UTC", "windows": [{"days": ["mon"], "start": "9:00", "end": "18:00"}]}}),
            json!({"working_hours": {"timezone": "UTC", "windows": [{"days": ["mon"], "start": "09:00", "end": "24:00"}]}}),
            json!({"working_hours": {"timezone": "UTC", "windows": [{"days": ["mon"], "start": "09:00", "end": "09:00"}]}}),
            json!({"working_hours": {"timezone": "UTC", "windows": [{"days": ["mon"], "start": "09:00", "end": "18:00", "tz": 1}]}}),
            json!({"working_hours": {"timezone": "UTC", "windows": [
                {"days": ["mon"], "start": "09:00", "end": "18:00"}, {"days": ["mon"], "start": "19:00", "end": "23:30"}]}}),
            json!({"working_hours": hours(), "role_models": {"scout": {"model": "gpt-5"}}}),
        ] {
            let out = team_settings_with(write(settings.clone()), true, || {
                asked.set(true);
                at(None)
            }, |_| {
                asked.set(true);
                done("{}")
            });
            assert_eq!(out["error"], "team_settings_value_invalid", "{settings}");
        }
        assert!(!asked.get(), "nothing was asked of the destination or of the box");
        // the valid shapes go through, the empty entry and the null hours included
        let ran = Cell::new(0);
        for settings in [
            json!({"working_hours": hours()}),
            json!({"working_hours": null}),
            json!({"role_models": {}}),
            json!({"role_models": {"scout": {}, "closer": {"model": "luna", "effort": "low"}}}),
            json!({"working_hours": {"timezone": "UTC", "windows": []}, "role_models": {"mentor": {"effort": "high"}}}),
        ] {
            assert_eq!(drive(write(settings.clone()), None, done(&held(Value::Null, json!({}))), &ran)["ok"], true, "{settings}");
        }
        assert_eq!(ran.get(), 5);
    }

    #[test]
    fn a_write_on_a_read_only_link_or_for_another_team_never_reaches_the_box() {
        let ran = Cell::new(0);
        let body = held(Value::Null, json!({}));
        let settings = json!({"role_models": {"scout": {"model": "luna"}}});
        assert_eq!(drive(write(settings.clone()), Some(VpsMode::ReadOnly), done(&body), &ran)["error"], "team_settings_read_only");
        let out = team_settings_with(json!({"op": "write", "settings": settings, "connectionKey": "another"}), true, || at(Some(VpsMode::Full)), |_| {
            ran.set(ran.get() + 1);
            done(&body)
        });
        assert_eq!(out["error"], "existing_team_runtime_target_changed");
        // the app's own VPS with no mark: the page's invitation to claim it
        let out = team_settings_with(write(json!({"role_models": {}})), true, || Ok((Some(VpsMode::ReadOnly), Some("own_vps_claim_required"), KEY.into(), "vps")), |_| {
            ran.set(ran.get() + 1);
            done(&body)
        });
        assert_eq!(out["error"], "own_vps_claim_required");
        assert_eq!(ran.get(), 0);
        // a team in full, and this computer, write
        assert_eq!(drive(write(json!({"role_models": {}})), Some(VpsMode::Full), done(&body), &ran)["ok"], true);
        assert_eq!(drive(write(json!({"role_models": {}})), None, done(&body), &ran)["ok"], true);
        assert_eq!(ran.get(), 2);
    }

    #[test]
    fn what_the_box_says_is_read_as_a_closed_answer_and_a_doubtful_reading_is_an_error() {
        let ran = Cell::new(0);
        let run = |code: i32, stdout: &str| {
            drive(json!({"op": "read"}), None, Ok(ProcessResult { code, stdout: stdout.as_bytes().to_vec() }), &ran)
        };
        assert_eq!(run(1, r#"{"ok":false,"error":"value_invalid"}"#)["error"], "team_settings_value_invalid");
        assert_eq!(run(1, r#"{"ok":false,"code":"value_invalid"}"#)["error"], "team_settings_value_invalid");
        for code in ["config_missing", "config_unreadable", "config_invalid", "write_failed", "agent_control_no_team", "<b>x</b>"] {
            assert_eq!(run(1, &format!(r#"{{"ok":false,"error":"{code}"}}"#))["error"], "team_settings_unavailable", "{code}");
        }
        // an image older than the command: the door or the CLI does not know it, or no JSON at all
        assert_eq!(run(100, r#"{"ok":false,"error":"agent_control_invalid"}"#)["error"], "existing_team_runtime_outdated");
        assert_eq!(run(1, "error: unknown command 'team-settings'")["error"], "existing_team_runtime_outdated");
        assert_eq!(run(70, "")["error"], "existing_team_runtime_changed");
        assert_eq!(run(255, "")["error"], "ssh_unavailable");
        // a reading that is not in the closed shape is not a reading
        for body in [
            r#"{"ok":true}"#,
            r#"{"ok":true,"working_hours":5,"role_models":{},"lists":{}}"#.to_owned().as_str(),
            &held(Value::Null, json!({"scout": {"model": "gpt"}})),
            &json!({"ok": true, "working_hours": null, "role_models": {}, "lists": {"roles": ["x"], "models": MODELS, "efforts": EFFORTS, "weekdays": WEEKDAYS, "min_window_hours": 4}}).to_string(),
            &json!({"ok": true, "working_hours": null, "role_models": {}, "lists": {"roles": ROLES, "models": MODELS, "efforts": EFFORTS, "weekdays": WEEKDAYS, "min_window_hours": 1}}).to_string(),
        ] {
            assert_eq!(run(0, body)["error"], "team_settings_unavailable", "{body}");
        }
        assert_eq!(drive(json!({"op": "read"}), None, Err("process_timeout"), &ran)["error"], "team_settings_unavailable");
    }

    #[test]
    fn on_a_linked_vps_the_command_is_fixed_and_the_settings_are_not_in_it() {
        let target: RuntimeTarget = serde_json::from_value(json!({
            "container_id": "a".repeat(64),
            "image_id": format!("sha256:{}", "b".repeat(64)),
            "platform_image_id": format!("sha256:{}", "c".repeat(64)),
            "oci_revision": "d".repeat(40),
            "digest": format!("sha256:{}", "e".repeat(64)),
            "os": "linux",
            "architecture": "amd64",
        }))
        .unwrap();
        let request = Request::Write { settings: json!({"role_models": {"scout": {"model": "SENTINELLA"}}}), connection_key: KEY.into() };
        let remote = vps_command(&target, verb(&request)).unwrap();
        assert!(remote.ends_with("node /app/cli/bin/jht.js team-settings apply"));
        assert!(remote.contains("|| exit 70") && !remote.contains("SENTINELLA"));
        assert_eq!(verb(&Request::Read {}), "get");
        assert_eq!(stdin_of(&Request::Read {}), None);
    }

    #[test]
    fn a_way_in_that_ssh_explained_keeps_its_code_and_is_not_the_boxs_unavailability() {
        for code in ["ssh_auth_failed", "ssh_connection_refused", "ssh_host_unreachable", "host_key_changed", "ssh_rate_limited"] {
            assert_eq!(reply(Err(code), "t", "k")["error"], code);
        }
        assert_eq!(reply(Ok(ProcessResult { code: 255, stdout: Vec::new() }), "t", "k")["error"], "ssh_unavailable");
        // a failure of the step itself is still the box's own
        assert_eq!(reply(Err("process_timeout"), "t", "k")["error"], "team_settings_unavailable");
    }
}

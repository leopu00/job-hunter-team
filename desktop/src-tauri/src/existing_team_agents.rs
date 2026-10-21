//! The agents of an existing team, read over its VPS: which sessions are up,
//! since when, their last activity, the state the team computes for them
//! (shared/skills/agent_state.py, when the container has it) and, only when
//! the user opens one, the last lines of its terminal.
//!
//! A terminal can hold what a CLI printed: a login code, a key. Its text is
//! shown only after the container's own filters: the single list of
//! invisible characters (shared/skills/external_content.py,
//! INVISIBLE_COMMANDS) and the secrets redactor the Telegram channel uses
//! (shared/redact-cli.mjs --secrets). When either is missing or fails, the
//! terminal is not shown: agent_screen_unfiltered, never the raw text.
//!
//! Read only. The script below travels with the app and runs in the pinned
//! container through the same fixed command as the positions read: it lists
//! and captures, it never sends keys or messages. The container needs no
//! update for it.

use crate::{
    account_scope::{AccountScope, AccountScopeState},
    direct_chat,
    existing_team_runtime::hex_encode,
    runtime_host::run_ssh_command,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::time::Duration;
use tauri::State;

/// The whole read over SSH. Each step of the script has its own limit, and the
/// steps of one operation fit in it (see the test of the longest path).
const READ_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_REPLY: usize = 256 * 1024;
const MAX_SESSIONS: usize = 200;
/// The terminal of one agent: its last lines, at most this many bytes.
const SCREEN_MAX_BYTES: usize = 16 * 1024;
const SCREEN_LINES: usize = 60;

/// The tmux sessions the product creates for its agents, as the launcher
/// names them: `get_agent_info` and `jht_spawn_session_name` in
/// .launcher/start-agent.sh and spawn-lib.sh, SESSION in spawn-doctor.sh and
/// spawn-maintainer.sh. Singletons have no suffix, the other roles a
/// positive number (`SCOUT-1`), and a Writer's own Critic is `CRITICO-S<n>`.
/// DOCTOR-WATCHDOG and SENTINELLA-WORKER are loops, not agents: left out, as
/// any other session.
const SINGLETONS: &[&str] = &[
    "CAPITANO",
    "CRITICO",
    "SENTINELLA",
    "ASSISTENTE",
    "MENTOR",
    "DOTTORE",
    "MANTENITORE",
];
const NUMBERED: &[&str] = &["SCOUT", "ANALISTA", "SCORER", "SCRITTORE", "CLOSER"];
/// The display order of the roles: the launcher's own, then the two
/// maintenance agents.
const ROLE_ORDER: &[&str] = &[
    "CAPITANO",
    "SCOUT",
    "ANALISTA",
    "SCORER",
    "SCRITTORE",
    "CRITICO",
    "SENTINELLA",
    "ASSISTENTE",
    "MENTOR",
    "CLOSER",
    "DOTTORE",
    "MANTENITORE",
];

const AGENTS_READ_PY: &str = r#"import json,sys,re,subprocess
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
def fail(code): emit({'ok':False,'error':code})
try: req=json.loads(sys.stdin.readline())
except Exception: fail('agents_unavailable')
NAME=re.compile(r'^[A-Z][A-Z0-9-]{0,39}$')
SKILLS='/app/shared/skills'
REDACTOR='/app/shared/redact-cli.mjs'
def sessions():
 try: done=subprocess.run(['tmux','list-sessions','-F','#{session_name}\t#{session_created}\t#{session_activity}'],capture_output=True,text=True,timeout=8)
 except Exception: fail('agents_unavailable')
 if done.returncode!=0:
  if 'no server running' in done.stderr or 'error connecting to' in done.stderr: return {}
  fail('agents_unavailable')
 out={}
 for line in done.stdout.splitlines():
  parts=line.split('\t')
  if len(parts)!=3 or not NAME.match(parts[0]): continue
  try: out[parts[0]]=(int(parts[1]),int(parts[2]))
  except ValueError: continue
 return out
def number(value): return value if isinstance(value,(int,float)) and not isinstance(value,bool) else None
def text(value): return value if isinstance(value,str) and len(value)<=40 else None
IDENTITY_MODEL=re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,39}\Z')
def identity(cli,model,effort):
 out={'cli':cli if cli in ('claude','codex','kimi','pi','local') else None,'model':model if IDENTITY_MODEL.match(model) else None,'effort':effort if effort in ('low','medium','high') else None}
 return out if out['cli'] is not None else None
def identities(names):
 try: done=subprocess.run(['tmux','list-sessions','-F','#{session_name}\t#{@jht-cli}\t#{@jht-model}\t#{@jht-effort}'],capture_output=True,text=True,timeout=2)
 except Exception: return {}
 if done.returncode!=0: return {}
 seen={}
 for line in done.stdout.splitlines():
  parts=line.split('\t')
  if parts[0] not in names: continue
  seen[parts[0]]=None if parts[0] in seen or len(parts)!=4 else identity(*parts[1:])
 return seen
def hour_usage():
 try:
  import os,time,datetime
  data=json.load(open(os.environ.get('JHT_HOME','/jht_home')+'/logs/role-usage.json',encoding='utf-8'))
  at=datetime.datetime.fromisoformat(str(data['generated_at'])).timestamp()
  agents=data.get('agents_1h')
  if isinstance(agents,dict) and -60<=time.time()-at<=900: return agents,at
 except Exception: pass
 return None
def usage(name,known,hour):
 context=known.get('context') if isinstance(known.get('context'),dict) else {}
 return {'context_pct':number(context.get('pct')),'context_tokens':number(context.get('tokens')),'context_window':number(context.get('window')),'context_at':number(context.get('at')),'tokens_1h':number(hour[0].get(name.lower())) if hour else None,'tokens_at':hour[1] if hour else None}
if req.get('op')=='list':
 live=sessions()
 states=None
 try:
  done=subprocess.run([sys.executable,'/app/shared/skills/agent_state.py'],capture_output=True,text=True,timeout=10)
  if done.returncode==0:
   value=json.loads(done.stdout)
   if isinstance(value,dict): states=value
 except Exception: states=None
 ids=identities(set(live))
 hour=hour_usage()
 items=[]
 for name in sorted(live)[:200]:
  created,activity=live[name]
  known=states.get(name.lower()) if states is not None else None
  known=known if isinstance(known,dict) else {}
  items.append({'name':name,'created':created,'activity':activity,'state':text(known.get('state')),'reason':text(known.get('reason')),'since':number(known.get('since')),'until':number(known.get('until')),'identity':ids.get(name),'usage':usage(name,known,hour)})
 emit({'ok':True,'data':{'items':items,'states':states is not None}})
if req.get('op')=='screen':
 name=req.get('name')
 if not isinstance(name,str) or not NAME.match(name): fail('agents_unavailable')
 if name not in sessions(): emit({'ok':True,'data':{'name':name,'up':False,'text':None}})
 try: done=subprocess.run(['tmux','capture-pane','-p','-J','-t','='+name+':','-S','-60'],capture_output=True,timeout=8)
 except Exception: fail('agents_unavailable')
 if done.returncode!=0: fail('agents_unavailable')
 raw=done.stdout.decode('utf-8','replace')
 raw=re.sub(r'\x1b(\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(\x07|\x1b\\)?|[@-Z\\-_])','',raw)
 raw=''.join(ch for ch in raw if ch in '\n\t' or (ord(ch)>=32 and not 127<=ord(ch)<160))
 try:
  sys.path.insert(0,SKILLS); from external_content import INVISIBLE_COMMANDS
 except Exception: fail('agent_screen_unfiltered')
 raw=''.join(ch for ch in raw if ch not in INVISIBLE_COMMANDS)
 try: done=subprocess.run(['node',REDACTOR,'--secrets'],input=raw.encode('utf-8'),capture_output=True,timeout=4)
 except Exception: fail('agent_screen_unfiltered')
 if done.returncode!=0: fail('agent_screen_unfiltered')
 raw=done.stdout.decode('utf-8','replace')
 raw='\n'.join(raw.rstrip('\n').split('\n')[-60:])
 data=raw.encode('utf-8')
 if len(data)>16384: raw=data[-16384:].decode('utf-8','ignore')
 emit({'ok':True,'data':{'name':name,'up':True,'text':raw}})
fail('agents_unavailable')
"#;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum AgentsRequest {
    /// A struct variant, so that a field the request should not have is refused.
    List {},
    Screen { name: String },
}

/// The role and instance of a session the product creates for an agent;
/// None for any other session.
pub(crate) fn agent_session(name: &str) -> Option<(String, Option<String>)> {
    if SINGLETONS.contains(&name) {
        return Some((name.to_ascii_lowercase(), None));
    }
    let (prefix, suffix) = name.split_once('-')?;
    let number = |value: &str| {
        !value.is_empty()
            && value.len() <= 4
            && !value.starts_with('0')
            && value.bytes().all(|byte| byte.is_ascii_digit())
    };
    if NUMBERED.contains(&prefix) && number(suffix) {
        return Some((prefix.to_ascii_lowercase(), Some(suffix.to_owned())));
    }
    if prefix == "CRITICO" {
        if let Some(writer) = suffix.strip_prefix('S') {
            if number(writer) {
                return Some((prefix.to_ascii_lowercase(), Some(suffix.to_owned())));
            }
        }
    }
    None
}

fn failure(code: &'static str) -> Value {
    json!({"ok":false,"error":code})
}

fn epoch(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_i64)
        .filter(|value| (0..=4_102_444_800).contains(value))
}

fn epoch_number(value: Option<&Value>) -> Value {
    match value.and_then(Value::as_f64) {
        Some(value) if value.is_finite() && (0.0..=4_102_444_800.0).contains(&value) => json!(value),
        _ => Value::Null,
    }
}

/// Who an agent is (cli, model, effort), as start-agent.sh wrote it on the
/// agent's own session: only to be shown, never decided on. The agent can
/// rewrite its session's options, so the same closed sets and model shape as
/// the scripts (agent_control.py, AGENTS_READ_PY) are checked again here.
fn shape_identity(value: Option<&Value>) -> Value {
    let Some(object) = value.and_then(Value::as_object) else {
        return Value::Null;
    };
    let pick = |key: &str, ok: &dyn Fn(&str) -> bool| match object.get(key).and_then(Value::as_str) {
        Some(text) if ok(text) => json!(text),
        _ => Value::Null,
    };
    let cli = pick("cli", &|text| matches!(text, "claude" | "codex" | "kimi" | "pi" | "local"));
    if cli.is_null() {
        return Value::Null;
    }
    let model = pick("model", &|text| {
        let mut bytes = text.bytes();
        text.len() <= 40
            && bytes.next().is_some_and(|first| first.is_ascii_alphanumeric())
            && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'-'))
    });
    let effort = pick("effort", &|text| matches!(text, "low" | "medium" | "high"));
    json!({"cli": cli, "model": model, "effort": effort})
}

/// A state or reason code as agent_state.py writes them; which ones the page
/// shows is the catalog's choice (web/lib/agent-state.ts).
fn code(value: Option<&Value>) -> Value {
    match value.and_then(Value::as_str) {
        Some(value)
            if !value.is_empty()
                && value.len() <= 40
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_') =>
        {
            json!(value)
        }
        _ => Value::Null,
    }
}

/// The terminal's text, once more without escape sequences or control
/// characters (the script already removes them), and within its size.
pub(crate) fn plain_text(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            match chars.next() {
                Some('[') => {
                    while let Some(next) = chars.next() {
                        if ('@'..='~').contains(&next) {
                            break;
                        }
                    }
                }
                Some(']') => {
                    while let Some(next) = chars.next() {
                        if next == '\u{7}' {
                            break;
                        }
                        if next == '\u{1b}' {
                            chars.next_if_eq(&'\\');
                            break;
                        }
                    }
                }
                _ => {}
            }
            continue;
        }
        if ch == '\n' || ch == '\t' || !ch.is_control() {
            out.push(ch);
        }
    }
    let lines: Vec<&str> = out.trim_end_matches('\n').split('\n').collect();
    let mut text = lines[lines.len().saturating_sub(SCREEN_LINES)..].join("\n");
    if text.len() > SCREEN_MAX_BYTES {
        let mut start = text.len() - SCREEN_MAX_BYTES;
        while !text.is_char_boundary(start) {
            start += 1;
        }
        text = text[start..].to_owned();
    }
    text
}

/// A count of tokens, within what any model's window or hour could hold.
fn token_count(value: Option<&Value>) -> Value {
    match value.and_then(Value::as_f64) {
        Some(value) if value.is_finite() && (0.0..=1e10).contains(&value) => json!(value.round() as u64),
        _ => Value::Null,
    }
}

/// How full the agent's context is (agent_state.py) and its tokens of the last
/// hour (the sentinel bridge's role-usage.json). The same closed fields for
/// every agent, each null when the team does not say it: an image older than
/// this read says none of them, and null is never shown as 0.
fn shape_usage(value: Option<&Value>) -> Value {
    let usage = value.and_then(Value::as_object);
    let field = |key: &str| usage.and_then(|usage| usage.get(key));
    let pct = match field("context_pct").and_then(Value::as_f64) {
        Some(pct) if pct.is_finite() && (0.0..=100.0).contains(&pct) => json!(pct),
        _ => Value::Null,
    };
    json!({
        "contextPct": pct,
        "contextTokens": token_count(field("context_tokens")),
        "contextWindow": token_count(field("context_window")),
        "contextAt": epoch_number(field("context_at")),
        "tokensHour": token_count(field("tokens_1h")),
        "tokensAt": epoch_number(field("tokens_at")),
    })
}

/// The reply of the container, reduced to what the page shows: only the
/// agents' sessions, only the closed list of fields.
pub(crate) fn shape_reply(request: &AgentsRequest, reply: &Value) -> Option<Value> {
    if reply.get("ok") != Some(&Value::Bool(true)) {
        return None;
    }
    let data = reply.get("data")?.as_object()?;
    match request {
        AgentsRequest::List {} => {
            let states = data.get("states")?.as_bool()?;
            let items = data.get("items")?.as_array()?;
            if items.len() > MAX_SESSIONS {
                return None;
            }
            let mut agents = Vec::new();
            for item in items {
                let item = item.as_object()?;
                let name = item.get("name")?.as_str()?;
                let Some((role, instance)) = agent_session(name) else {
                    continue;
                };
                let mut agent = Map::new();
                agent.insert("name".into(), json!(name));
                agent.insert("role".into(), json!(role));
                agent.insert("instance".into(), json!(instance));
                agent.insert("up".into(), json!(true));
                agent.insert("created".into(), json!(epoch(item.get("created"))));
                agent.insert("activity".into(), json!(epoch(item.get("activity"))));
                agent.insert("identity".into(), shape_identity(item.get("identity")));
                let known = |key: &str| if states { code(item.get(key)) } else { Value::Null };
                agent.insert("state".into(), known("state"));
                agent.insert("reason".into(), known("reason"));
                agent.insert("since".into(), if states { epoch_number(item.get("since")) } else { Value::Null });
                agent.insert("until".into(), if states { epoch_number(item.get("until")) } else { Value::Null });
                agent.insert("usage".into(), shape_usage(item.get("usage")));
                agents.push(Value::Object(agent));
            }
            let roles: Vec<Value> = ROLE_ORDER
                .iter()
                .map(|role| json!({"role": role.to_ascii_lowercase(), "multi": NUMBERED.contains(role) || *role == "CRITICO"}))
                .collect();
            Some(json!({"ok":true,"data":{"agents":agents,"roles":roles,"states":states}}))
        }
        AgentsRequest::Screen { name } => {
            if data.get("name")?.as_str()? != name {
                return None;
            }
            let up = data.get("up")?.as_bool()?;
            let text = match data.get("text")? {
                Value::Null if !up => Value::Null,
                Value::String(raw) if up => json!(plain_text(raw)),
                _ => return None,
            };
            Some(json!({"ok":true,"data":{"name":name,"up":up,"text":text}}))
        }
    }
}

fn parse_request(request: Value) -> Option<AgentsRequest> {
    let request = serde_json::from_value::<AgentsRequest>(request).ok()?;
    match &request {
        AgentsRequest::Screen { name } if agent_session(name).is_none() => None,
        _ => Some(request),
    }
}

/// The fixed script and the request, as the container's python reads them:
/// the script in hex on the first line, the request on the second.
pub(crate) fn script_input(request: &AgentsRequest) -> Option<Vec<u8>> {
    script_input_for(AGENTS_READ_PY, request)
}

fn script_input_for(script: &str, request: &AgentsRequest) -> Option<Vec<u8>> {
    let mut input = hex_encode(script.as_bytes()).into_bytes();
    input.push(b'\n');
    input.extend_from_slice(&serde_json::to_vec(request).ok()?);
    input.push(b'\n');
    Some(input)
}

pub(crate) fn agents_read_for_scope(app: &tauri::AppHandle, scope: &AccountScope, request: Value) -> Value {
    let Some(request) = parse_request(request) else {
        return failure("agents_unavailable");
    };
    let host = match direct_chat::load_persisted_host(app, scope) {
        Ok(host) => host,
        Err(error) => return failure(error),
    };
    let validated = match crate::runtime_host::validate_host_for_scope(app, &host, scope) {
        Ok(validated) => validated,
        Err(error) => return failure(error),
    };
    let command = match crate::existing_team_runtime::read_command(app, scope, &host) {
        Ok(command) => command,
        Err(error) => return failure(error),
    };
    let Some(input) = script_input(&request) else {
        return failure("agents_unavailable");
    };
    let output = match run_ssh_command(&validated, &command, Some(&input), READ_TIMEOUT, None) {
        Ok(output) if output.success() && output.stdout.len() <= MAX_REPLY => output,
        _ => return failure("agents_unavailable"),
    };
    let Ok(reply) = serde_json::from_slice::<Value>(&output.stdout) else {
        return failure("agents_unavailable");
    };
    if let Some(shaped) = shape_reply(&request, &reply) {
        return shaped;
    }
    match reply.get("error").and_then(Value::as_str) {
        // the terminal was read but could not be cleaned: it is not shown at all
        Some("agent_screen_unfiltered") if matches!(request, AgentsRequest::Screen { .. }) => {
            failure("agent_screen_unfiltered")
        }
        _ => failure("agents_unavailable"),
    }
}

/// The agents' page of the existing team's view. The renderer sends only the
/// operation and, for a terminal, an agent's session name from the list.
#[tauri::command]
pub(crate) async fn existing_team_agents_read(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    request: Value,
) -> Result<Value, String> {
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(failure("account_scope_unavailable")),
    };
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(|_| "account_scope_changed")?;
        Ok(agents_read_for_scope(&app, &worker_expected, request))
    })
    .await
    .unwrap_or_else(|_| Err("agents_unavailable"));
    if scopes.lock_expected(&expected).is_err() {
        return Ok(failure("account_scope_changed"));
    }
    Ok(result.unwrap_or_else(failure))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list_reply(names: &[&str]) -> Value {
        let items: Vec<Value> = names
            .iter()
            .map(|name| json!({"name":name,"created":1_760_000_000,"activity":1_760_000_100,"state":"lavora","reason":null,"since":1_760_000_050.5,"until":null}))
            .collect();
        json!({"ok":true,"data":{"items":items,"states":true}})
    }

    fn names(shaped: &Value) -> Vec<String> {
        shaped["data"]["agents"]
            .as_array()
            .unwrap()
            .iter()
            .map(|agent| agent["name"].as_str().unwrap().to_owned())
            .collect()
    }

    #[test]
    fn every_session_the_product_creates_is_an_agent_and_nothing_else_is() {
        let shaped = shape_reply(
            &AgentsRequest::List {},
            &list_reply(&[
                "CAPITANO", "SCOUT-1", "SCOUT-12", "ANALISTA-1", "SCORER-2", "SCRITTORE-1",
                "CRITICO", "CRITICO-S3", "SENTINELLA", "ASSISTENTE", "MENTOR", "CLOSER-1",
                "DOTTORE", "MANTENITORE",
                // not agents, or not names the launcher gives
                "DOCTOR-WATCHDOG", "SENTINELLA-WORKER", "SCOUT", "SCOUT-0", "SCOUT-01",
                "CRITICO-S0", "CRITICO-1", "CAPITANO-1", "JHT-CAPITANO", "MAIN", "SCOUT-1X",
            ]),
        )
        .unwrap();
        assert_eq!(
            names(&shaped),
            [
                "CAPITANO", "SCOUT-1", "SCOUT-12", "ANALISTA-1", "SCORER-2", "SCRITTORE-1",
                "CRITICO", "CRITICO-S3", "SENTINELLA", "ASSISTENTE", "MENTOR", "CLOSER-1",
                "DOTTORE", "MANTENITORE",
            ]
        );
        let critic = &shaped["data"]["agents"][7];
        assert_eq!(critic["role"], "critico");
        assert_eq!(critic["instance"], "S3");
        assert_eq!(shaped["data"]["agents"][0]["instance"], Value::Null);
        assert_eq!(shaped["data"]["roles"].as_array().unwrap().len(), ROLE_ORDER.len());
    }

    /// The closed list is the launcher's: each role it can start, and the
    /// two maintenance sessions, are here, and nothing the launcher does not
    /// start.
    #[test]
    fn the_closed_list_is_the_one_of_the_launcher() {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../.launcher/");
        let start = std::fs::read_to_string(format!("{root}start-agent.sh")).unwrap();
        let body = &start[start.find("get_agent_info() {").unwrap()..];
        let body = &body[..body.find("\n}\n").unwrap()];
        let mut prefixes: Vec<String> = body
            .lines()
            .filter_map(|line| line.split_once("echo \"").map(|(_, rest)| rest))
            .filter_map(|rest| rest.split('"').next())
            .filter_map(|quoted| quoted.split('|').next())
            .filter(|prefix| !prefix.is_empty())
            .map(str::to_owned)
            .collect();
        for file in ["spawn-doctor.sh", "spawn-maintainer.sh"] {
            let source = std::fs::read_to_string(format!("{root}{file}")).unwrap();
            let line = source.lines().find(|line| line.starts_with("SESSION=\"")).unwrap();
            prefixes.push(line.trim_start_matches("SESSION=\"").trim_end_matches('"').to_owned());
        }
        prefixes.sort();
        let mut ours: Vec<String> = SINGLETONS.iter().chain(NUMBERED).map(|name| (*name).to_owned()).collect();
        ours.sort();
        assert_eq!(ours, prefixes);
        let mut order: Vec<&str> = ROLE_ORDER.to_vec();
        order.sort();
        let mut sorted: Vec<&str> = ours.iter().map(String::as_str).collect();
        sorted.sort();
        assert_eq!(order, sorted);
        // the singletons are the ones jht_spawn_session_name leaves without a number
        let lib = std::fs::read_to_string(format!("{root}spawn-lib.sh")).unwrap();
        assert!(lib.contains("    capitano|critico|sentinella|assistente|mentor)\n"));
        assert!(lib.contains("printf '%s' \"${prefix}-S${instance}\""));
    }

    #[test]
    fn without_the_teams_own_state_no_agent_is_said_to_work() {
        let mut reply = list_reply(&["CAPITANO", "SCOUT-1"]);
        reply["data"]["states"] = json!(false);
        let shaped = shape_reply(&AgentsRequest::List {}, &reply).unwrap();
        for agent in shaped["data"]["agents"].as_array().unwrap() {
            assert_eq!(agent["state"], Value::Null);
            assert_eq!(agent["since"], Value::Null);
            assert_eq!(agent["up"], true);
        }
        assert_eq!(shaped["data"]["states"], false);
        // a state that is not a code is dropped, never passed on as text
        let mut odd = list_reply(&["CAPITANO"]);
        odd["data"]["items"][0]["state"] = json!("<b>lavora</b>");
        let shaped = shape_reply(&AgentsRequest::List {}, &odd).unwrap();
        assert_eq!(shaped["data"]["agents"][0]["state"], Value::Null);
    }

    #[test]
    fn the_health_of_an_agent_is_closed_and_what_is_not_known_is_null_never_zero() {
        let mut reply = list_reply(&["CAPITANO", "SCOUT-1", "SCOUT-2", "SCORER-1"]);
        reply["data"]["items"][0]["usage"] = json!({"context_pct": 42.5, "context_tokens": 109_820, "context_window": 258_400,
            "context_at": 1_760_000_090.25, "tokens_1h": 12_345, "tokens_at": 1_760_000_000.0, "extra": "dropped"});
        // a real zero stays zero
        reply["data"]["items"][1]["usage"] = json!({"context_pct": 0, "context_tokens": 0, "context_window": null,
            "context_at": 1_760_000_090, "tokens_1h": 0, "tokens_at": 1_760_000_000});
        // what is not a count is not passed on
        reply["data"]["items"][2]["usage"] = json!({"context_pct": 140, "context_tokens": -3, "context_window": "258k",
            "context_at": true, "tokens_1h": "<b>9</b>", "tokens_at": -1});
        // SCORER-1: an image older than this read sends no usage at all
        let shaped = shape_reply(&AgentsRequest::List {}, &reply).unwrap();
        let usage = |n: usize| shaped["data"]["agents"][n]["usage"].clone();
        assert_eq!(
            usage(0),
            json!({"contextPct": 42.5, "contextTokens": 109_820, "contextWindow": 258_400, "contextAt": 1_760_000_090.25,
                "tokensHour": 12_345, "tokensAt": 1_760_000_000.0})
        );
        assert_eq!(usage(1)["contextPct"], 0.0);
        assert_eq!(usage(1)["tokensHour"], 0);
        assert_eq!(usage(1)["contextWindow"], Value::Null);
        let unknown = json!({"contextPct": null, "contextTokens": null, "contextWindow": null, "contextAt": null,
            "tokensHour": null, "tokensAt": null});
        assert_eq!(usage(2), unknown);
        assert_eq!(usage(3), unknown);
    }

    #[test]
    fn only_a_complete_reply_is_shown() {
        assert!(shape_reply(&AgentsRequest::List {}, &json!({"ok":false,"error":"agents_unavailable"})).is_none());
        assert!(shape_reply(&AgentsRequest::List {}, &json!({"ok":true,"data":{"items":[]}})).is_none());
        let too_many: Vec<&str> = vec!["CAPITANO"; MAX_SESSIONS + 1];
        assert!(shape_reply(&AgentsRequest::List {}, &list_reply(&too_many)).is_none());
        let screen = AgentsRequest::Screen { name: "SCOUT-1".into() };
        assert!(shape_reply(&screen, &json!({"ok":true,"data":{"name":"SCOUT-2","up":true,"text":"x"}})).is_none());
        assert!(shape_reply(&screen, &json!({"ok":true,"data":{"name":"SCOUT-1","up":true,"text":null}})).is_none());
        assert_eq!(
            shape_reply(&screen, &json!({"ok":true,"data":{"name":"SCOUT-1","up":false,"text":null}})).unwrap()["data"]["up"],
            false
        );
    }

    #[test]
    fn who_an_agent_is_passes_only_in_its_closed_shape() {
        let list = |identity: Value| {
            let reply = json!({"ok":true,"data":{"states":false,"items":[{"name":"SCOUT-1","created":1,"activity":2,"identity":identity}]}});
            shape_reply(&AgentsRequest::List {}, &reply).unwrap()["data"]["agents"][0]["identity"].clone()
        };
        assert_eq!(
            list(json!({"cli":"codex","model":"gpt-5.6-terra","effort":"high"})),
            json!({"cli":"codex","model":"gpt-5.6-terra","effort":"high"})
        );
        // kimi gets neither a model nor an effort: what is not there stays null
        assert_eq!(list(json!({"cli":"kimi","model":null,"effort":null})), json!({"cli":"kimi","model":null,"effort":null}));
        // a part out of shape is null; an unknown cli, or none, is no identity at all
        assert_eq!(
            list(json!({"cli":"claude","model":"opus; rm -rf /","effort":"extreme"})),
            json!({"cli":"claude","model":null,"effort":null})
        );
        for model in ["-opus", "", "<b>x</b>", "a\nFAKE-1", "m".repeat(41).as_str()] {
            assert_eq!(list(json!({"cli":"pi","model":model,"effort":"low"}))["model"], Value::Null, "{model}");
        }
        for bad in [json!({"cli":"gpt","model":"x","effort":"low"}), json!({"model":"x"}), json!("codex"), Value::Null] {
            assert_eq!(list(bad.clone()), Value::Null, "{bad}");
        }
    }

    #[test]
    fn a_terminal_is_asked_only_for_an_agent_and_only_by_name() {
        assert_eq!(parse_request(json!({"op":"list"})), Some(AgentsRequest::List {}));
        assert!(parse_request(json!({"op":"screen","name":"SCOUT-1"})).is_some());
        for bad in [
            json!({"op":"screen","name":"DOCTOR-WATCHDOG"}),
            json!({"op":"screen","name":"SCOUT-1; tmux kill-server"}),
            json!({"op":"screen","name":"=SCOUT-1"}),
            json!({"op":"screen"}),
            json!({"op":"send","name":"SCOUT-1","keys":"y"}),
            json!({"op":"list","host":"elsewhere"}),
        ] {
            assert!(parse_request(bad.clone()).is_none(), "{bad}");
        }
    }

    /// The time limit of the script's step that runs `marker`, in seconds.
    fn step_limit(marker: &str) -> u64 {
        let line = AGENTS_READ_PY.lines().find(|line| line.contains(marker)).unwrap();
        let limit = line.split("timeout=").nth(1).unwrap();
        limit[..limit.find(')').unwrap()].parse().unwrap()
    }

    /// The longest path of each operation ends within the SSH read, so a slow
    /// step says what it is instead of the read being cut first.
    #[test]
    fn the_longest_path_of_each_operation_fits_in_the_read() {
        let list = step_limit("'list-sessions'");
        // who each agent is: a second, short list-sessions (never folded into the first)
        let identity = step_limit("@jht-cli");
        let state = step_limit("agent_state.py");
        let capture = step_limit("'capture-pane'");
        let redactor = step_limit("'node',REDACTOR");
        assert_eq!(redactor, 4);
        let read = READ_TIMEOUT.as_secs();
        assert!(list + identity + state <= read, "list: {list} + {identity} + {state} > {read}");
        assert!(list + capture + redactor <= read, "terminal: {list} + {capture} + {redactor} > {read}");
    }

    #[test]
    fn the_terminal_is_text_without_escape_sequences() {
        let raw = "\u{1b}[31mred\u{1b}[0m line\n\u{1b}]0;title\u{7}next\u{1b}]8;;http://x\u{1b}\\link\u{0}\u{8}\n<script>x</script>\t\n";
        assert_eq!(plain_text(raw), "red line\nnextlink\n<script>x</script>\t");
        let long: String = (0..100).map(|n| format!("line {n}\n")).collect();
        let text = plain_text(&long);
        assert_eq!(text.lines().count(), SCREEN_LINES);
        assert!(text.ends_with("line 99"));
        let wide = "è".repeat(SCREEN_MAX_BYTES);
        assert!(plain_text(&wide).len() <= SCREEN_MAX_BYTES);
    }

    /// The script, run for real against a fake tmux: the list, the terminal
    /// of one agent, and the read of agent_state.py when it is missing.
    #[cfg(unix)]
    #[test]
    fn the_script_lists_and_captures_without_writing() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("jht-agents-read-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let tmux = dir.join("tmux");
        std::fs::write(
            &tmux,
            "#!/bin/sh\necho \"$@\" >> \"$(dirname \"$0\")/calls\"\ncase \"$1\" in\n list-sessions) case \"$3\" in *@jht-cli*) printf 'CAPITANO\\tcodex\\tgpt-5.6-terra\\thigh\\nCRITICO-S3\\tclaude\\tx\\nFAKE-1\\t0\\t0\\n' ;; *) printf 'CAPITANO\\t1760000000\\t1760000100\\nDOCTOR-WATCHDOG\\t1\\t2\\nCRITICO-S3\\t1760000000\\t1760000200\\nbad name\\t1\\t2\\n' ;; esac ;;\n capture-pane) printf '\\033[1mworking\\033[0m on it\\nkey sk-%s\\n\\342\\200\\256desrever\\n' 'FAKEfake0123456789abcd' ;;\n *) exit 1 ;;\nesac\n",
        )
        .unwrap();
        std::fs::set_permissions(&tmux, std::fs::Permissions::from_mode(0o755)).unwrap();
        // The container's own filters, from this checkout: the single list of
        // invisibles and the secrets redactor.
        let repo = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
        // agent_state.py stays out: it is in this checkout, and here it would read this machine's tmux.
        let script = AGENTS_READ_PY
            .replace("/app/shared/skills/agent_state.py", "/nonexistent/agent_state.py")
            .replace("/app/shared/skills", &format!("{repo}/shared/skills"))
            .replace("/app/shared/redact-cli.mjs", &format!("{repo}/shared/redact-cli.mjs"));
        let run_script = |script: &str, request: &AgentsRequest| {
            let input = script_input_for(script, request).unwrap();
            let mut child = std::process::Command::new("python3")
                .args(["-c", "import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())"])
                .env("PATH", format!("{}:{}", dir.display(), std::env::var("PATH").unwrap_or_default()))
                .env("JHT_HOME", &dir)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            {
                use std::io::Write;
                child.stdin.take().unwrap().write_all(&input).unwrap();
            }
            let output = child.wait_with_output().unwrap();
            serde_json::from_slice::<Value>(&output.stdout).unwrap()
        };
        let run = |request: &AgentsRequest| run_script(&script, request);
        let list = run(&AgentsRequest::List {});
        assert_eq!(list["data"]["states"], false, "no agent_state.py outside the container");
        assert_eq!(list["data"]["items"][0]["usage"]["tokens_1h"], Value::Null, "no role-usage.json: not known");
        // the bridge's count of the last hour, written a moment ago: CAPITANO counted 0, CRITICO-S3 not counted
        let now = std::process::Command::new("python3")
            .args(["-c", "import datetime;print(datetime.datetime.now(datetime.timezone.utc).isoformat())"])
            .output()
            .unwrap();
        let now = String::from_utf8(now.stdout).unwrap();
        std::fs::create_dir_all(dir.join("logs")).unwrap();
        let role_usage = |at: &str| {
            std::fs::write(dir.join("logs/role-usage.json"), json!({"generated_at": at.trim(), "agents_1h": {"capitano": 0, "scout-1": 900}}).to_string())
                .unwrap()
        };
        role_usage(&now);
        let counted = shape_reply(&AgentsRequest::List {}, &run(&AgentsRequest::List {})).unwrap();
        assert_eq!(counted["data"]["agents"][0]["usage"]["tokensHour"], 0);
        assert!(counted["data"]["agents"][0]["usage"]["tokensAt"].is_f64());
        assert_eq!(counted["data"]["agents"][1]["usage"]["tokensHour"], Value::Null);
        // a count older than the bridge's own 15 minutes is not the last hour any more
        role_usage("2026-01-01T00:00:00+00:00");
        let stale = shape_reply(&AgentsRequest::List {}, &run(&AgentsRequest::List {})).unwrap();
        assert_eq!(stale["data"]["agents"][0]["usage"]["tokensHour"], Value::Null);
        assert_eq!(stale["data"]["agents"][0]["usage"]["tokensAt"], Value::Null);
        // with agent_state.py there (a stand-in that answers as the real one does), its states come through
        let state = dir.join("agent_state.py");
        std::fs::write(&state, "import json\nprint(json.dumps({'capitano':{'state':'lavora','since':1760000050,'context':{'at':1760000090,'tokens':109820,'window':258400,'pct':42.5}},'critico-s3':{'state':'bloccato','reason':'limite_5h','until':1760003600}}))\n").unwrap();
        let with_state = script.replace("/nonexistent/agent_state.py", &state.display().to_string());
        let stated = shape_reply(&AgentsRequest::List {}, &run_script(&with_state, &AgentsRequest::List {})).unwrap();
        assert_eq!(stated["data"]["states"], true);
        assert_eq!(stated["data"]["agents"][0]["state"], "lavora");
        assert_eq!(stated["data"]["agents"][0]["since"], 1_760_000_050.0);
        assert_eq!(stated["data"]["agents"][1]["state"], "bloccato");
        assert_eq!(stated["data"]["agents"][1]["reason"], "limite_5h");
        assert_eq!(stated["data"]["agents"][0]["usage"]["contextPct"], 42.5);
        assert_eq!(stated["data"]["agents"][0]["usage"]["contextWindow"], 258_400);
        assert_eq!(stated["data"]["agents"][1]["usage"]["contextPct"], Value::Null);
        let shaped = shape_reply(&AgentsRequest::List {}, &list).unwrap();
        assert_eq!(names(&shaped), ["CAPITANO", "CRITICO-S3"]);
        assert_eq!(shaped["data"]["agents"][1]["activity"], 1_760_000_200);
        // who each agent is: read apart, so a model written as «x», a newline and
        // «FAKE-1\t0\t0» on CRITICO-S3's own session makes up nothing and moves no time
        assert_eq!(shaped["data"]["agents"][0]["identity"], json!({"cli":"codex","model":"gpt-5.6-terra","effort":"high"}));
        assert_eq!(shaped["data"]["agents"][1]["identity"], Value::Null);
        assert_eq!(shaped["data"]["agents"][0]["created"], 1_760_000_000);
        let screen = AgentsRequest::Screen { name: "CRITICO-S3".into() };
        let shaped = shape_reply(&screen, &run(&screen)).unwrap();
        let text = shaped["data"]["text"].as_str().unwrap();
        assert!(text.starts_with("working on it\nkey "), "{text}");
        // the key the CLI printed is gone, and nothing turns the line around
        assert!(!text.contains("FAKEfake0123456789abcd"), "{text}");
        assert!(text.contains("[provider-key]"), "{text}");
        assert!(!text.contains('\u{202e}') && text.ends_with("desrever"), "{text}");
        // without the redactor, or without the list, the terminal is not shown at all
        let no_redactor = script.replace(&format!("{repo}/shared/redact-cli.mjs"), "/nonexistent/redact-cli.mjs");
        let no_list = script.replace(&format!("{repo}/shared/skills"), "/nonexistent/skills");
        for broken in [no_redactor, no_list] {
            let reply = run_script(&broken, &screen);
            assert_eq!(reply, json!({"ok":false,"error":"agent_screen_unfiltered"}));
            assert!(shape_reply(&screen, &reply).is_none());
        }
        let gone = AgentsRequest::Screen { name: "SCOUT-1".into() };
        assert_eq!(shape_reply(&gone, &run(&gone)).unwrap()["data"]["up"], false);
        let calls = std::fs::read_to_string(dir.join("calls")).unwrap();
        for call in calls.lines() {
            assert!(
                call.starts_with("list-sessions ") || call.starts_with("capture-pane -p -J -t =CRITICO-S3: "),
                "only reads: {call}"
            );
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

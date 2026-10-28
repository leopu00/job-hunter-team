//! The Swipe of a local profile: the deck of positions to judge, read from the jobs.db of the team on this
//! computer, and the person's verdict on one of them, written back through the team's own script.
//!
//! The design is banda/piani/DISEGNO-profilo-swipe-locali-20261029.md (approved with conditions D1-D6):
//! - both commands come from the `main` window only;
//! - both run only on the team of THIS computer and only when this account owns its folder (the owner
//!   marker equals the active scope): a team of another profile, of nobody, or an existing team's VPS is
//!   `position_write_read_only` for the write and its own code for the read, and no row of it is ever shown;
//! - the verdict names a position by its number in THAT database, so the deck carries an opaque token (the
//!   scope and the identity of the database file) and the write sends it back: a deck read before the
//!   profile or the team changed is `deck_outdated`, never a verdict on another position;
//! - the request is closed to three operations (a verdict, an exclusion, putting it back), every field is
//!   checked here again, and the one free text, the note, travels on stdin and never in a command;
//! - the check of the gates and the run happen in one synchronous closure that holds the account scope,
//!   with no await between them (a scope changed in between cannot run anything);
//! - the script is the team's `position_judgement.py`, unchanged, run by a fixed script of the app that
//!   turns the cloud off for the call (a local profile has no cloud) and answers one JSON; the app closes the
//!   answer again, so no text of the script reaches the page.
use crate::{
    account_scope::{AccountScope, AccountScopeState},
    direct_chat,
    existing_team_judgement::{FeedbackDirection, FeedbackValue, NOTE_MAX_BYTES},
    existing_team_runtime::{hex_encode, local_reader_wrapper},
    runtime_host::{ProcessResult, ValidatedHost},
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{cell::RefCell, path::{Path, PathBuf}, time::Duration};
use tauri::State;

const TIMEOUT: Duration = Duration::from_secs(40);
const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
/// A deck read carries at most this many positions of each deck (the web's own limit) and these many bytes.
const DECK_LIMIT: usize = 1000;
const REPLY_MAX: usize = 4 * 1024 * 1024;

/// The fixed script that reads the two decks. It opens the database read only and answers one JSON; a
/// missing database is two empty decks. The identity of the file (`ino`, `dev`) goes into the token.
const DECK_PY: &str = r#"import json,os,sqlite3,stat,sys
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
def fail(code): emit({'ok':False,'error':code})
try: req=json.loads(sys.stdin.readline())
except Exception: fail('swipe_request_invalid')
if req!={'op':'deck'}: fail('swipe_request_invalid')
LIMIT=1000; BUDGET=3000000
PATH='/jht_home/jobs.db'
TEXT=(('title',200),('company',120),('location',160),('remote_type',40),('salary_declared_currency',8),('salary_estimated_currency',8),('url',600),('source',60),('found_at',40),('status',20),('role_family',80),('loc_country',80),('loc_city',80))
NUMBERS=('salary_declared_min','salary_declared_max','salary_estimated_min','salary_estimated_max')
try: info=os.lstat(PATH)
except FileNotFoundError: emit({'ok':True,'ino':0,'dev':0,'pending':[],'reviewed':[]})
except OSError: fail('positions_unavailable')
if not stat.S_ISREG(info.st_mode): fail('positions_unavailable')
def trunc(value,limit): return value[:limit] if isinstance(value,str) else None
try:
 db=sqlite3.connect('file:'+PATH+'?mode=ro',uri=True); db.row_factory=sqlite3.Row; db.execute('PRAGMA query_only=ON')
 def columns(table): return {row[1] for row in db.execute('PRAGMA table_info('+table+')')}
 have=columns('positions'); scored='total_score' in columns('scores') and 'position_id' in columns('scores')
 if 'id' not in have or 'status' not in have: emit({'ok':True,'ino':info.st_ino,'dev':info.st_dev,'pending':[],'reviewed':[]})
 wanted=[name for name in ('id','status')+tuple(n for n,_ in TEXT if n!='status')+NUMBERS if name in have]
 sql='SELECT '+','.join('p.'+name for name in wanted)+(',s.total_score AS total_score' if scored else '')+' FROM positions p'+(' LEFT JOIN scores s ON s.position_id=p.id' if scored else '')+" WHERE p.status IN ('scored','ready','excluded') ORDER BY "+('p.found_at ASC,' if 'found_at' in have else '')+'p.id ASC'
 judged={}; cleared=set()
 fb=columns('position_feedback')
 if {'position_id','action'} <= fb:
  for row in db.execute('SELECT position_id,action,'+('score' if 'score' in fb else 'NULL')+' FROM position_feedback ORDER BY id DESC'):
   if row[0] in judged or row[0] in cleared: continue
   if row[1]=='clear': cleared.add(row[0])
   else: judged[row[0]]={'action':row[1],'fb_score':row[2]}
 pending=[]; reviewed=[]; used=0
 for raw in db.execute(sql):
  row=dict(raw); item={'id':row['id'],'status':row['status'],'score':row.get('total_score')}
  for name,limit in TEXT:
   if name!='status': item[name]=trunc(row.get(name),limit)
  for name in NUMBERS: item[name]=row.get(name)
  used+=len(json.dumps(item))
  if used>BUDGET: break
  fb_row=judged.get(row['id'])
  if fb_row is not None:
   if len(reviewed)<LIMIT: reviewed.append({'row':item,'action':fb_row['action'],'fb_score':fb_row['fb_score']})
  elif row['status'] in ('scored','ready') and len(pending)<LIMIT: pending.append(item)
  if len(pending)>=LIMIT and len(reviewed)>=LIMIT: break
except sqlite3.Error: fail('positions_unavailable')
emit({'ok':True,'ino':info.st_ino,'dev':info.st_dev,'pending':pending,'reviewed':reviewed})
"#;

/// The fixed script that writes one verdict. It checks the identity of the database against the deck the
/// person judged on, turns the cloud off for this call, and runs the team's `position_judgement.py` with
/// arguments built here from closed fields; the note reaches it as its one line of stdin.
const JUDGE_PY: &str = r#"import contextlib,importlib.util,io,json,os,sys
def emit(value): print(json.dumps(value,separators=(',',':'),ensure_ascii=False)); raise SystemExit(0)
def fail(code): emit({'ok':False,'code':code})
try: req=json.loads(sys.stdin.readline())
except Exception: fail('request_invalid')
FIELDS={'feedback':{'op','id','value','score','direction','reason','note','expect'},'exclude':{'op','id','reason','note','expect'},'restore':{'op','id','expect'}}
if not isinstance(req,dict) or req.get('op') not in FIELDS or set(req)-FIELDS[req['op']]: fail('request_invalid')
op=req['op']; pid=req.get('id'); expect=req.get('expect')
if not isinstance(pid,str) or not pid.isdigit() or pid.startswith('0') or len(pid)>18: fail('request_invalid')
if not isinstance(expect,dict) or set(expect)!={'ino','dev'} or any(type(expect[key]) is not int for key in expect): fail('request_invalid')
HOME='/jht_home'
os.environ['JHT_HOME']=HOME
try: info=os.lstat(HOME+'/jobs.db')
except OSError: fail('deck_outdated')
if info.st_ino!=expect['ino'] or info.st_dev!=expect['dev']: fail('deck_outdated')
for key in ('value','direction','reason','note'):
 if key in req and not isinstance(req[key],str): fail('request_invalid')
if 'score' in req and (type(req['score']) is not int or not 1<=req['score']<=5): fail('request_invalid')
argv=[op,pid]
if op=='feedback':
 argv+=['--value',req.get('value','')]
 if 'score' in req: argv+=['--score',str(req['score'])]
 if 'direction' in req: argv+=['--direction',req['direction']]
 if 'reason' in req: argv+=['--reason',req['reason']]
elif op=='exclude': argv+=['--reason',req.get('reason','')]
if op!='restore' and 'note' in req:
 argv.append('--note-on-stdin')
 sys.stdin=io.TextIOWrapper(io.BytesIO((json.dumps({'note':req['note']})+'\n').encode('utf-8')),encoding='utf-8')
PATH='/app/shared/skills/position_judgement.py'
if not os.path.isfile(PATH): fail('runtime_outdated')
try:
 spec=importlib.util.spec_from_file_location('position_judgement',PATH); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
 import feedback_record
 # a local profile has no cloud: the verdict is kept in the team's database and goes nowhere else
 feedback_record.api_request=lambda *args,**kwargs:(False,'cloud-disabled')
except Exception: fail('runtime_outdated')
out=io.StringIO()
try:
 with contextlib.redirect_stdout(out): mod.main(argv)
except Exception: fail('request_invalid')
lines=out.getvalue().strip().splitlines()
try: answer=json.loads(lines[-1])
except Exception: fail('request_invalid')
emit(answer)
"#;

fn failure(code: &str) -> Value {
    json!({ "ok": false, "error": code })
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub(crate) enum JudgeRequest {
    Feedback {
        id: String,
        value: FeedbackValue,
        #[serde(default)]
        score: Option<u8>,
        #[serde(default)]
        direction: Option<FeedbackDirection>,
        #[serde(default)]
        reason: Option<String>,
        #[serde(default)]
        note: Option<String>,
        token: String,
    },
    Exclude {
        id: String,
        reason: String,
        #[serde(default)]
        note: Option<String>,
        token: String,
    },
    Restore {
        id: String,
        token: String,
    },
}

/// The position's number in the team's database: digits only, 1 to 18 of them, no zero and no leading zero.
fn valid_id(id: &str) -> bool {
    (1..=18).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_digit()) && !id.starts_with('0')
}

/// A code of the closed vocabulary has this shape; which codes exist the script decides.
fn valid_reason(reason: &str) -> bool {
    (1..=32).contains(&reason.len()) && reason.bytes().all(|byte| byte.is_ascii_lowercase() || byte == b'_')
}

impl JudgeRequest {
    fn id(&self) -> &str {
        match self {
            Self::Feedback { id, .. } | Self::Exclude { id, .. } | Self::Restore { id, .. } => id,
        }
    }

    fn token(&self) -> &str {
        match self {
            Self::Feedback { token, .. } | Self::Exclude { token, .. } | Self::Restore { token, .. } => token,
        }
    }

    fn note(&self) -> Option<&str> {
        match self {
            Self::Feedback { note, .. } | Self::Exclude { note, .. } => note.as_deref(),
            Self::Restore { .. } => None,
        }
    }

    fn check(&self) -> Result<(), &'static str> {
        if !valid_id(self.id()) {
            return Err("position_write_request_invalid");
        }
        match self {
            Self::Feedback { reason: Some(reason), .. } | Self::Exclude { reason, .. } if !valid_reason(reason) => {
                return Err("reason_invalid")
            }
            Self::Feedback { score: Some(score), .. } if !(1..=5).contains(score) => {
                return Err("position_write_request_invalid")
            }
            _ => {}
        }
        if self.note().is_some_and(|note| note.len() > NOTE_MAX_BYTES) {
            return Err("note_too_long");
        }
        Ok(())
    }

    /// The one request line the script reads: the closed fields, and where the database must be the one
    /// the deck was read from.
    fn line(&self, ino: u64, dev: u64) -> Value {
        // the script reads the identity as integers: it never holds a number above what a JSON integer keeps
        let expect = json!({ "ino": ino, "dev": dev });
        match self {
            Self::Feedback { id, value, score, direction, reason, note, .. } => {
                let mut line = json!({ "op": "feedback", "id": id, "value": value.as_str(), "expect": expect });
                let map = line.as_object_mut().expect("an object");
                if let Some(score) = score {
                    map.insert("score".into(), json!(score));
                }
                if let Some(direction) = direction {
                    map.insert("direction".into(), json!(direction.as_str()));
                }
                if let Some(reason) = reason {
                    map.insert("reason".into(), json!(reason));
                }
                if let Some(note) = note {
                    map.insert("note".into(), json!(note));
                }
                line
            }
            Self::Exclude { id, reason, note, .. } => {
                let mut line = json!({ "op": "exclude", "id": id, "reason": reason, "expect": expect });
                if let Some(note) = note {
                    line.as_object_mut().expect("an object").insert("note".into(), json!(note));
                }
                line
            }
            Self::Restore { id, .. } => json!({ "op": "restore", "id": id, "expect": expect }),
        }
    }
}

/// What identifies the scope in a token, without being the scope: 16 hex characters of a hash.
fn scope_tag(scope: &AccountScope) -> String {
    let mut hash = Sha256::new();
    hash.update(b"jht-swipe-deck/1:");
    hash.update(scope.digest().as_bytes());
    hash.finalize().iter().take(8).map(|byte| format!("{byte:02x}")).collect()
}

fn make_token(tag: &str, ino: u64, dev: u64) -> String {
    format!("{tag}.{ino}.{dev}")
}

/// The identity of the database in a token, when the token is of this scope. Anything else is no token.
fn parse_token(token: &str, tag: &str) -> Option<(u64, u64)> {
    let mut parts = token.split('.');
    let (found, ino, dev) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || found != tag || tag.len() != 16 {
        return None;
    }
    let number = |text: &str| (!text.is_empty() && text.len() <= 20 && text.bytes().all(|b| b.is_ascii_digit())).then(|| text.parse::<u64>().ok()).flatten();
    Some((number(ino)?, number(dev)?))
}

fn script_input(script: &str, line: &Value) -> Vec<u8> {
    let mut input = hex_encode(script.as_bytes()).into_bytes();
    input.push(b'\n');
    input.extend(serde_json::to_vec(line).unwrap_or_default());
    input.push(b'\n');
    input
}

/// The codes the script may refuse a verdict with, as the page tells them.
const REFUSALS: &[&str] = &[
    "request_invalid",
    "reason_invalid",
    "note_too_long",
    "note_invalid",
    "position_not_found",
    "feedback_refused",
    "exclude_refused",
    "deck_outdated",
];

fn short_text(value: Option<&Value>, max: usize) -> Option<String> {
    value.and_then(Value::as_str).map(|text| text.chars().take(max).collect())
}

/// The script's answer, closed again: a fixed set of fields, a code only of the list.
fn close_verdict(output: &ProcessResult) -> Option<Value> {
    if output.stdout.len() > 16 * 1024 {
        return None;
    }
    let line = String::from_utf8_lossy(&output.stdout).lines().last().map(str::to_owned)?;
    let answer: Value = serde_json::from_str(&line).ok()?;
    let answer = answer.as_object()?;
    if answer.get("ok") == Some(&Value::Bool(true)) {
        let mut out = Map::new();
        out.insert("ok".into(), Value::Bool(true));
        for key in ["op", "value", "reason", "direction", "status", "previous_status"] {
            if let Some(text) = short_text(answer.get(key), 40) {
                out.insert(key.into(), Value::String(text));
            }
        }
        if let Some(score) = answer.get("score").and_then(Value::as_u64).filter(|score| (1..=5).contains(score)) {
            out.insert("score".into(), json!(score));
        }
        if let Some(synced) = answer.get("cloud_synced").and_then(Value::as_bool) {
            out.insert("cloud_synced".into(), Value::Bool(synced));
        }
        return Some(Value::Object(out));
    }
    let code = answer.get("code").and_then(Value::as_str)?;
    let code = REFUSALS.iter().copied().find(|known| *known == code)?;
    Some(failure(match code {
        "request_invalid" => "position_write_request_invalid",
        other => other,
    }))
}

/// The whole decision of a verdict, with the app-bound steps injected (the order the tests drive).
/// `gate` is the host, the owner and the wrapper; nothing runs unless every step before it said yes.
pub(crate) fn judge_with(
    request: Value,
    window_is_main: bool,
    tag: &str,
    gate: impl FnOnce() -> Result<(), &'static str>,
    run: impl FnOnce(&[u8]) -> Result<ProcessResult, &'static str>,
    team_is_up: impl FnOnce() -> bool,
) -> Value {
    if !window_is_main {
        return failure("position_write_window_refused");
    }
    let Ok(request) = serde_json::from_value::<JudgeRequest>(request) else {
        return failure("position_write_request_invalid");
    };
    if let Err(code) = request.check() {
        return failure(code);
    }
    if let Err(code) = gate() {
        return failure(code);
    }
    let Some((ino, dev)) = parse_token(request.token(), tag) else {
        return failure("deck_outdated");
    };
    let input = script_input(JUDGE_PY, &request.line(ino, dev));
    let ran = run(&input);
    if let Ok(output) = &ran {
        if let Some(answer) = close_verdict(output) {
            return answer;
        }
    }
    // No answer the app can read: a team that is off says so, anything else is a runtime older than this.
    if ran.as_ref().map_or(true, |output| !output.success()) && !team_is_up() {
        failure("local_team_not_running")
    } else {
        failure("existing_team_runtime_outdated")
    }
}

const ROW_TEXT: &[(&str, usize)] = &[
    ("title", 200),
    ("company", 120),
    ("location", 160),
    ("remote_type", 40),
    ("salary_declared_currency", 8),
    ("salary_estimated_currency", 8),
    ("source", 60),
    ("found_at", 40),
    ("role_family", 80),
    ("loc_country", 80),
    ("loc_city", 80),
];
const ROW_NUMBERS: &[&str] = &["salary_declared_min", "salary_declared_max", "salary_estimated_min", "salary_estimated_max", "score"];

/// A link the card may open: http or https, no spaces or control characters, a bounded length.
fn safe_url(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://"))
        && text.len() <= 600
        && !text.chars().any(|c| c.is_whitespace() || c.is_control())
}

/// One position of a deck, closed to the fields the card draws: text bounded, numbers whole, the link only
/// when it is a web address. What does not fit is null; a row with no number or no state is dropped.
fn close_row(raw: &Value) -> Option<Value> {
    let row = raw.as_object()?;
    let id = row.get("id")?.as_i64().filter(|id| *id > 0)?;
    let status = row.get("status")?.as_str().filter(|s| matches!(*s, "scored" | "ready" | "excluded"))?;
    let mut out = Map::new();
    out.insert("id".into(), json!(id));
    out.insert("status".into(), json!(status));
    for (name, max) in ROW_TEXT {
        out.insert((*name).into(), short_text(row.get(*name), *max).map_or(Value::Null, Value::String));
    }
    let url = row.get("url").and_then(Value::as_str).filter(|text| safe_url(text));
    out.insert("url".into(), url.map_or(Value::Null, |text| Value::String(text.to_owned())));
    for name in ROW_NUMBERS {
        let number = row.get(*name).and_then(Value::as_i64).filter(|n| n.abs() <= 1_000_000_000_000);
        out.insert((*name).into(), number.map_or(Value::Null, |n| json!(n)));
    }
    Some(Value::Object(out))
}

/// The two decks of the script's answer, closed again, with the token the page sends back with a verdict.
fn close_decks(output: &ProcessResult, tag: &str) -> Option<Value> {
    if output.stdout.len() > REPLY_MAX {
        return None;
    }
    let reply: Value = serde_json::from_slice(&output.stdout).ok()?;
    let reply = reply.as_object()?;
    if reply.get("ok") != Some(&Value::Bool(true)) {
        return match reply.get("error").and_then(Value::as_str) {
            Some("positions_unavailable") => Some(failure("positions_unavailable")),
            _ => None,
        };
    }
    let number = |key: &str| reply.get(key).and_then(Value::as_u64);
    let token = make_token(tag, number("ino")?, number("dev")?);
    let pending: Vec<Value> = reply.get("pending")?.as_array()?.iter().filter_map(close_row).take(DECK_LIMIT).collect();
    let reviewed: Vec<Value> = reply
        .get("reviewed")?
        .as_array()?
        .iter()
        .filter_map(|item| {
            let item = item.as_object()?;
            let action = item.get("action")?.as_str().filter(|a| matches!(*a, "like" | "dislike" | "hide" | "star"))?;
            let fb_score = item.get("fb_score").and_then(Value::as_u64).filter(|s| (1..=5).contains(s));
            Some(json!({ "row": close_row(item.get("row")?)?, "action": action, "fbScore": fb_score }))
        })
        .take(DECK_LIMIT)
        .collect();
    Some(json!({ "ok": true, "token": token, "pending": pending, "reviewed": reviewed }))
}

/// The decks of the team on this computer, read through the same gates as a verdict is written.
pub(crate) fn deck_with(
    window_is_main: bool,
    tag: &str,
    gate: impl FnOnce() -> Result<(), &'static str>,
    run: impl FnOnce(&[u8]) -> Result<ProcessResult, &'static str>,
    team_is_up: impl FnOnce() -> bool,
) -> Value {
    if !window_is_main {
        return failure("position_write_window_refused");
    }
    if let Err(code) = gate() {
        return failure(code);
    }
    let input = script_input(DECK_PY, &json!({ "op": "deck" }));
    match run(&input) {
        Ok(output) if output.success() => close_decks(&output, tag).unwrap_or_else(|| failure("positions_unavailable")),
        _ if team_is_up() => failure("positions_unavailable"),
        _ => failure("local_team_not_running"),
    }
}

/// This computer's team, for a verdict or for the deck: the host is the local one (an existing team's VPS
/// is read only here) and this account owns the folder. Returns the wrapper the script goes through.
fn local_wrapper(app: &tauri::AppHandle, scope: &AccountScope, writing: bool) -> Result<PathBuf, &'static str> {
    let refused = if writing { "position_write_read_only" } else { "existing_team_runtime_required" };
    let host = direct_chat::load_persisted_host(app, scope).map_err(|_| refused)?;
    let validated = crate::runtime_host::validate_host_for_scope(app, &host, scope).map_err(|_| refused)?;
    if !matches!(validated, ValidatedHost::Local) {
        return Err(refused);
    }
    local_reader_wrapper(app, scope).map_err(|code| {
        // the team of another profile, of nobody or one not yet taken: no data of it, and no write to it
        if writing && code.starts_with("local_account_owner") {
            "position_write_read_only"
        } else {
            code
        }
    })
}

fn run_script(wrapper: &Path, input: &[u8]) -> Result<ProcessResult, &'static str> {
    crate::onboarding::run_verified_local_wrapper(wrapper, &["desktop-chat", "python"], Some(input), TIMEOUT)
}

fn team_is_up(wrapper: &Path) -> bool {
    crate::onboarding::run_verified_local_wrapper(wrapper, &["desktop-chat", "probe"], None, PROBE_TIMEOUT)
        .map(|probe| probe.success())
        .unwrap_or(false)
}

async fn on_worker(
    scopes: &AccountScopeState,
    expected: AccountScope,
    work: impl FnOnce(&AccountScope) -> Value + Send + 'static,
) -> Value {
    let scope_state = scopes.clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        // The scope is held for the whole run: the gates and the script happen under it, with no await between.
        let Ok(_scope) = scope_state.lock_expected(&worker_expected) else {
            return failure("account_scope_changed");
        };
        work(&worker_expected)
    })
    .await
    .unwrap_or_else(|_| failure("existing_team_unavailable"));
    if scopes.lock_expected(&expected).is_err() {
        return failure("account_scope_changed");
    }
    result
}

/// The two decks of the Swipe, read from the team on this computer.
#[tauri::command]
pub(crate) async fn local_swipe_deck_read(
    app: tauri::AppHandle,
    window: tauri::Window,
    scopes: State<'_, AccountScopeState>,
) -> Result<Value, String> {
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(failure("account_scope_unavailable")),
    };
    let main = direct_chat::window_may_write(window.label());
    Ok(on_worker(scopes.inner(), expected, move |scope| {
        let wrapper: RefCell<Option<PathBuf>> = RefCell::new(None);
        deck_with(
            main,
            &scope_tag(scope),
            || {
                *wrapper.borrow_mut() = Some(local_wrapper(&app, scope, false)?);
                Ok(())
            },
            |input| run_script(wrapper.borrow().as_ref().ok_or("runtime_missing")?, input),
            || wrapper.borrow().as_ref().is_some_and(team_is_up),
        )
    })
    .await)
}

/// The person's verdict on a position of the deck, written in the database of the team on this computer.
#[tauri::command]
pub(crate) async fn local_team_position_judge(
    app: tauri::AppHandle,
    window: tauri::Window,
    scopes: State<'_, AccountScopeState>,
    request: Value,
) -> Result<Value, String> {
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(failure("account_scope_unavailable")),
    };
    let main = direct_chat::window_may_write(window.label());
    Ok(on_worker(scopes.inner(), expected, move |scope| {
        let wrapper: RefCell<Option<PathBuf>> = RefCell::new(None);
        judge_with(
            request,
            main,
            &scope_tag(scope),
            || {
                *wrapper.borrow_mut() = Some(local_wrapper(&app, scope, true)?);
                Ok(())
            },
            |input| run_script(wrapper.borrow().as_ref().ok_or("runtime_missing")?, input),
            || wrapper.borrow().as_ref().is_some_and(team_is_up),
        )
    })
    .await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const TAG: &str = "0123456789abcdef";

    fn exited(code: i32, stdout: &str) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult { code, stdout: stdout.as_bytes().to_vec() })
    }

    fn verdict() -> Value {
        json!({"op": "feedback", "id": "12", "value": "like", "token": format!("{TAG}.77.5")})
    }

    /// One drive of `judge_with`: how often the gate and the run were reached, and what the script was given.
    fn drive(
        request: Value,
        main: bool,
        gate: Result<(), &'static str>,
        ran: Result<ProcessResult, &'static str>,
        up: bool,
    ) -> (Value, u32, u32, Vec<u8>) {
        let (gates, runs) = (Cell::new(0), Cell::new(0));
        let given = RefCell::new(Vec::new());
        let reply = judge_with(
            request,
            main,
            TAG,
            || {
                gates.set(gates.get() + 1);
                gate
            },
            |input| {
                runs.set(runs.get() + 1);
                *given.borrow_mut() = input.to_vec();
                ran
            },
            || up,
        );
        (reply, gates.get(), runs.get(), given.into_inner())
    }

    fn refused(request: Value) -> (Value, u32, u32) {
        let (reply, gates, runs, _) = drive(request, true, Ok(()), exited(0, "{}"), true);
        (reply, gates, runs)
    }

    #[test]
    fn only_the_main_window_judges_and_nothing_runs_for_another() {
        let (reply, gates, runs, _) = drive(verdict(), false, Ok(()), exited(0, "{}"), true);
        assert_eq!(reply, failure("position_write_window_refused"));
        assert_eq!((gates, runs), (0, 0));
    }

    #[test]
    fn a_request_that_is_not_closed_is_refused_before_any_gate_or_run() {
        let mut cases: Vec<(Value, &str)> = vec![
            (json!({"op": "note", "id": "12", "token": "x"}), "position_write_request_invalid"),
            (json!({"op": "write_request", "id": "12", "on": true, "token": "x"}), "position_write_request_invalid"),
            (json!({"op": "feedback", "id": "12", "value": "love", "token": "x"}), "position_write_request_invalid"),
            (json!({"op": "feedback", "id": "12", "value": "like", "token": "x", "path": "/etc"}), "position_write_request_invalid"),
            (json!({"op": "feedback", "id": "12", "value": "like"}), "position_write_request_invalid"),
            (json!({"op": "restore", "id": "12", "token": "x", "note": "n"}), "position_write_request_invalid"),
            (json!({"op": "exclude", "id": "12", "token": "x"}), "position_write_request_invalid"),
            (json!({"op": "feedback", "id": 12, "value": "like", "token": "x"}), "position_write_request_invalid"),
        ];
        for id in ["", "0", "012", "-1", "1 2", "12;", "１２", "1234567890123456789"] {
            cases.push((json!({"op": "restore", "id": id, "token": "x"}), "position_write_request_invalid"));
        }
        cases.push((json!({"op": "feedback", "id": "12", "value": "like", "score": 9, "token": "x"}), "position_write_request_invalid"));
        cases.push((json!({"op": "feedback", "id": "12", "value": "like", "score": 0, "token": "x"}), "position_write_request_invalid"));
        cases.push((json!({"op": "feedback", "id": "12", "value": "like", "direction": "sideways", "token": "x"}), "position_write_request_invalid"));
        cases.push((json!({"op": "exclude", "id": "12", "reason": "Not Interesting", "token": "x"}), "reason_invalid"));
        cases.push((json!({"op": "exclude", "id": "12", "reason": "a".repeat(33), "token": "x"}), "reason_invalid"));
        cases.push((json!({"op": "feedback", "id": "12", "value": "like", "reason": "no way", "token": "x"}), "reason_invalid"));
        cases.push((json!({"op": "feedback", "id": "12", "value": "like", "note": "n".repeat(NOTE_MAX_BYTES + 1), "token": "x"}), "note_too_long"));
        for (request, code) in cases {
            let (reply, gates, runs) = refused(request.clone());
            assert_eq!(reply, failure(code), "{request}");
            assert_eq!((gates, runs), (0, 0), "{request}");
        }
        // the largest id is 18 digits, and a note of exactly the limit is not too long
        for request in [
            json!({"op": "restore", "id": "123456789012345678", "token": format!("{TAG}.1.1")}),
            json!({"op": "feedback", "id": "12", "value": "like", "note": "n".repeat(NOTE_MAX_BYTES), "token": format!("{TAG}.1.1")}),
        ] {
            let (_, gates, runs, _) = drive(request, true, Ok(()), exited(0, "{}"), true);
            assert_eq!((gates, runs), (1, 1));
        }
    }

    #[test]
    fn a_team_that_is_not_this_accounts_never_runs_and_the_token_is_not_even_looked_at() {
        for gate in ["position_write_read_only", "runtime_missing", "local_chat_wrapper_outdated"] {
            let (reply, gates, runs, _) = drive(verdict(), true, Err(gate), exited(0, "{}"), true);
            assert_eq!(reply, failure(gate));
            assert_eq!((gates, runs), (1, 0), "{gate}");
        }
        // a token of another scope would say «old deck»; the gate answers first, so the other team learns nothing
        let other = json!({"op": "feedback", "id": "12", "value": "like", "token": "ffffffffffffffff.77.5"});
        let (reply, _, runs, _) = drive(other, true, Err("position_write_read_only"), exited(0, "{}"), true);
        assert_eq!(reply, failure("position_write_read_only"));
        assert_eq!(runs, 0);
    }

    #[test]
    fn a_deck_read_for_another_scope_or_with_a_garbled_token_is_an_old_deck_and_nothing_runs() {
        for token in [
            "ffffffffffffffff.77.5",
            "0123456789abcdef.77",
            "0123456789abcdef.77.5.1",
            "0123456789abcdef.x.5",
            "0123456789abcdef..5",
            "0123456789abcdef.7 .5",
            "0123456789abcdef.-7.5",
            "",
            "0123456789abcdef.99999999999999999999999.5",
        ] {
            let request = json!({"op": "feedback", "id": "12", "value": "like", "token": token});
            let (reply, _, runs, _) = drive(request, true, Ok(()), exited(0, "{}"), true);
            assert_eq!(reply, failure("deck_outdated"), "{token:?}");
            assert_eq!(runs, 0, "{token:?}");
        }
    }

    #[test]
    fn the_identity_of_the_database_in_the_token_is_what_the_script_is_told_to_expect() {
        // two teams, the same position number: the token of the first deck says which database it was read from
        let first = drive(verdict(), true, Ok(()), exited(0, r#"{"ok":true,"op":"feedback","id":"12"}"#), true).3;
        let text = String::from_utf8(first).unwrap();
        let line = text.lines().nth(1).unwrap();
        assert_eq!(serde_json::from_str::<Value>(line).unwrap()["expect"], json!({"ino": 77, "dev": 5}));
        let second = json!({"op": "feedback", "id": "12", "value": "like", "token": format!("{TAG}.99.5")});
        let text = String::from_utf8(drive(second, true, Ok(()), exited(0, "{}"), true).3).unwrap();
        assert_eq!(serde_json::from_str::<Value>(text.lines().nth(1).unwrap()).unwrap()["expect"], json!({"ino": 99, "dev": 5}));
        // and the script refusing it is told as an old deck
        let (reply, _, _, _) = drive(verdict(), true, Ok(()), exited(1, r#"{"ok":false,"code":"deck_outdated"}"#), true);
        assert_eq!(reply, failure("deck_outdated"));
    }

    #[test]
    fn the_scope_and_the_database_make_the_token_and_only_that_scope_reads_it_back() {
        let token = make_token(TAG, 77, 5);
        assert_eq!(parse_token(&token, TAG), Some((77, 5)));
        assert_eq!(parse_token(&token, "aaaaaaaaaaaaaaaa"), None);
        assert_eq!(parse_token(&token, "short"), None);
    }

    #[test]
    fn the_request_line_carries_the_closed_fields_and_the_note_only_on_stdin() {
        let request = json!({"op": "feedback", "id": "12", "value": "dislike", "score": 2, "direction": "less_like_this",
            "reason": "too_senior", "note": "il mio commento", "token": format!("{TAG}.77.5")});
        let (_, _, _, input) = drive(request, true, Ok(()), exited(0, "{}"), true);
        let text = String::from_utf8(input).unwrap();
        let mut lines = text.lines();
        let script = lines.next().unwrap();
        assert!(script.bytes().all(|b| b.is_ascii_hexdigit()), "the script travels as hex, the note never in it");
        let line: Value = serde_json::from_str(lines.next().unwrap()).unwrap();
        assert_eq!(
            line,
            json!({"op": "feedback", "id": "12", "value": "dislike", "score": 2, "direction": "less_like_this",
                   "reason": "too_senior", "note": "il mio commento", "expect": {"ino": 77, "dev": 5}})
        );
        assert!(lines.next().is_none());
        // an exclusion and putting it back
        let exclude = json!({"op": "exclude", "id": "9", "reason": "wrong_stack", "token": format!("{TAG}.1.1")});
        let text = String::from_utf8(drive(exclude, true, Ok(()), exited(0, "{}"), true).3).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(text.lines().nth(1).unwrap()).unwrap(),
            json!({"op": "exclude", "id": "9", "reason": "wrong_stack", "expect": {"ino": 1, "dev": 1}})
        );
        let restore = json!({"op": "restore", "id": "9", "token": format!("{TAG}.1.1")});
        let text = String::from_utf8(drive(restore, true, Ok(()), exited(0, "{}"), true).3).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(text.lines().nth(1).unwrap()).unwrap(),
            json!({"op": "restore", "id": "9", "expect": {"ino": 1, "dev": 1}})
        );
    }

    #[test]
    fn the_scripts_answer_is_closed_again_and_no_text_of_it_reaches_the_page() {
        let said = r#"{"ok":true,"op":"feedback","id":"12","value":"like","score":4,"cloud_synced":false,"cloud_error":"secret","detail":"/etc/passwd","extra":1}"#;
        let (reply, _, _, _) = drive(verdict(), true, Ok(()), exited(0, said), true);
        assert_eq!(reply, json!({"ok": true, "op": "feedback", "value": "like", "score": 4, "cloud_synced": false}));
        for code in ["position_not_found", "feedback_refused", "exclude_refused", "reason_invalid", "note_too_long", "note_invalid", "deck_outdated"] {
            let said = format!(r#"{{"ok":false,"op":"feedback","id":"12","code":"{code}","detail":"/secret/path"}}"#);
            let (reply, _, _, _) = drive(verdict(), true, Ok(()), exited(1, &said), true);
            assert_eq!(reply, failure(code));
        }
        let (reply, _, _, _) = drive(verdict(), true, Ok(()), exited(1, r#"{"ok":false,"code":"request_invalid"}"#), true);
        assert_eq!(reply, failure("position_write_request_invalid"));
        // a code the list does not have, no JSON, too much of it: a runtime older than this one
        for said in [r#"{"ok":false,"code":"/etc/passwd"}"#.to_owned(), "Traceback (most recent call last)".to_owned(), "x".repeat(20_000)] {
            let (reply, _, _, _) = drive(verdict(), true, Ok(()), exited(1, &said), true);
            assert_eq!(reply, failure("existing_team_runtime_outdated"));
        }
    }

    #[test]
    fn a_team_that_is_off_says_so_and_a_failed_run_of_a_team_that_is_up_does_not() {
        let (reply, _, _, _) = drive(verdict(), true, Ok(()), Err("timeout"), false);
        assert_eq!(reply, failure("local_team_not_running"));
        let (reply, _, _, _) = drive(verdict(), true, Ok(()), exited(125, ""), false);
        assert_eq!(reply, failure("local_team_not_running"));
        let (reply, _, _, _) = drive(verdict(), true, Ok(()), Err("timeout"), true);
        assert_eq!(reply, failure("existing_team_runtime_outdated"));
    }

    fn deck_run(said: &str, main: bool, gate: Result<(), &'static str>, up: bool) -> (Value, u32) {
        let runs = Cell::new(0);
        let reply = deck_with(main, TAG, || gate, |_| {
            runs.set(runs.get() + 1);
            exited(0, said)
        }, || up);
        (reply, runs.get())
    }

    fn row(id: i64, status: &str) -> Value {
        json!({"id": id, "status": status, "title": "Backend", "company": "Acme", "url": "https://jobs.example.com/1", "score": 80,
               "salary_declared_min": 40000, "salary_declared_max": 50000, "salary_declared_currency": "EUR"})
    }

    #[test]
    fn the_deck_is_closed_row_by_row_and_carries_the_token_to_send_back() {
        let said = json!({"ok": true, "ino": 77, "dev": 5,
            "pending": [row(1, "scored"), row(2, "ready"), row(3, "new"), row(0, "scored"), {"id": "4", "status": "scored"}],
            "reviewed": [{"row": row(5, "scored"), "action": "like", "fb_score": 4}, {"row": row(6, "excluded"), "action": "clear", "fb_score": null},
                         {"row": row(7, "excluded"), "action": "dislike", "fb_score": 99}]});
        let (reply, runs) = deck_run(&said.to_string(), true, Ok(()), true);
        assert_eq!(runs, 1);
        assert_eq!(reply["ok"], true);
        assert_eq!(reply["token"], format!("{TAG}.77.5"));
        let ids: Vec<i64> = reply["pending"].as_array().unwrap().iter().map(|r| r["id"].as_i64().unwrap()).collect();
        assert_eq!(ids, [1, 2], "a state the deck does not hold, no number, a number that is text: dropped");
        let reviewed = reply["reviewed"].as_array().unwrap();
        assert_eq!(reviewed.len(), 2, "a cleared verdict is no review");
        assert_eq!(reviewed[0]["fbScore"], 4);
        assert_eq!(reviewed[1]["fbScore"], Value::Null, "a score off the scale is none");
    }

    #[test]
    fn a_row_keeps_its_text_bounded_its_numbers_whole_and_a_link_only_if_it_is_a_web_address() {
        let long = "x".repeat(5000);
        let mut hostile = row(1, "scored");
        hostile["title"] = json!(long);
        hostile["url"] = json!("javascript:alert(1)");
        hostile["salary_declared_min"] = json!(1.5);
        hostile["salary_declared_max"] = json!("50000");
        hostile["score"] = json!(10_000_000_000_000_i64);
        hostile["company"] = json!(["not", "text"]);
        let closed = close_row(&hostile).unwrap();
        assert_eq!(closed["title"].as_str().unwrap().chars().count(), 200);
        assert_eq!(closed["url"], Value::Null);
        assert_eq!(closed["salary_declared_min"], Value::Null);
        assert_eq!(closed["salary_declared_max"], Value::Null);
        assert_eq!(closed["score"], Value::Null);
        assert_eq!(closed["company"], Value::Null);
        for url in ["https://example.invalid/a", "HTTP://example.invalid/a"] {
            assert!(safe_url(url), "{url}");
        }
        for url in ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "https://a b", "https://a\u{7}b", "//example.invalid"] {
            assert!(!safe_url(url), "{url}");
        }
        assert!(!safe_url(&format!("https://example.invalid/{}", "a".repeat(600))));
        // only the fields of the card leave: a column the script added by mistake does not
        let mut extra = row(1, "scored");
        extra["jd_text"] = json!("the whole description");
        assert!(close_row(&extra).unwrap().get("jd_text").is_none());
    }

    #[test]
    fn the_deck_goes_through_the_same_gates_as_a_verdict_and_nothing_of_another_team_is_read() {
        let said = json!({"ok": true, "ino": 1, "dev": 1, "pending": [row(1, "scored")], "reviewed": []}).to_string();
        let (reply, runs) = deck_run(&said, false, Ok(()), true);
        assert_eq!((reply, runs), (failure("position_write_window_refused"), 0));
        for gate in ["local_account_owner_mismatch", "local_account_owner_unavailable", "existing_team_runtime_required", "runtime_missing"] {
            let (reply, runs) = deck_run(&said, true, Err(gate), true);
            assert_eq!((reply, runs), (failure(gate), 0), "{gate}");
        }
    }

    #[test]
    fn a_deck_that_cannot_be_read_is_told_and_a_team_that_is_off_is_told_apart() {
        assert_eq!(deck_run("not json", true, Ok(()), true).0, failure("positions_unavailable"));
        assert_eq!(deck_run(r#"{"ok":false,"error":"positions_unavailable"}"#, true, Ok(()), true).0, failure("positions_unavailable"));
        assert_eq!(deck_run(r#"{"ok":false,"error":"/etc/passwd"}"#, true, Ok(()), true).0, failure("positions_unavailable"));
        let reply = deck_with(true, TAG, || Ok(()), |_| exited(125, ""), || false);
        assert_eq!(reply, failure("local_team_not_running"));
        let empty = json!({"ok": true, "ino": 0, "dev": 0, "pending": [], "reviewed": []}).to_string();
        let (reply, _) = deck_run(&empty, true, Ok(()), true);
        assert_eq!(reply["pending"], json!([]));
        assert_eq!(reply["reviewed"], json!([]));
    }

    /// The source of the module above its tests.
    fn source() -> &'static str {
        include_str!("local_swipe.rs").split("#[cfg(test)]").next().unwrap()
    }

    #[test]
    fn the_gates_and_the_run_happen_under_the_scope_with_no_await_between_them() {
        let source = source();
        // the decision is synchronous: nothing in it waits, so a scope cannot change between the check and the run
        let decision = source.split("pub(crate) fn judge_with(").nth(1).unwrap().split("const ROW_TEXT").next().unwrap();
        assert!(!decision.contains(".await") && !decision.contains("async"));
        let deck = source.split("pub(crate) fn deck_with(").nth(1).unwrap().split("/// This computer's team").next().unwrap();
        assert!(!deck.contains(".await") && !deck.contains("async"));
        // the worker takes the lock of the expected scope first and only then runs the decision
        let worker = source.split("async fn on_worker(").nth(1).unwrap().split("/// The two decks of the Swipe").next().unwrap();
        assert!(worker.find("lock_expected(&worker_expected)").unwrap() < worker.find("work(&worker_expected)").unwrap());
        // both commands go through it, and neither checks anything outside it
        for command in ["pub(crate) async fn local_swipe_deck_read(", "pub(crate) async fn local_team_position_judge("] {
            let body = source.split(command).nth(1).unwrap();
            let body = body.split("#[tauri::command]").next().unwrap();
            assert!(body.contains("on_worker(scopes.inner(), expected,"), "{command}");
            assert!(body.contains("window_may_write(window.label())"), "{command}");
        }
    }

    #[test]
    fn only_this_computers_team_of_this_account_is_reached_and_an_existing_teams_view_is_read_only() {
        let source = source();
        let wrapper = source.split("fn local_wrapper(").nth(1).unwrap().split("fn run_script(").next().unwrap();
        // the host must be the local one before the owner is asked, and the owner before the wrapper is returned
        assert!(wrapper.find("ValidatedHost::Local").unwrap() < wrapper.find("local_reader_wrapper(").unwrap());
        assert!(wrapper.contains("\"position_write_read_only\""));
        assert!(wrapper.contains("code.starts_with(\"local_account_owner\")"));
        // no ssh, no existing team's target, no claim of a folder
        for forbidden in ["run_ssh_command", "selected_or_own", "claim", "validate_local_runtime"] {
            assert!(!source.replace("`", "").contains(&format!("{forbidden}(")), "{forbidden}");
        }
    }

    #[test]
    fn the_scripts_open_the_deck_read_only_turn_the_cloud_off_and_run_nothing_but_the_teams_judgement() {
        assert!(DECK_PY.contains("mode=ro") && DECK_PY.contains("PRAGMA query_only=ON"));
        assert!(!DECK_PY.contains("INSERT") && !DECK_PY.contains("UPDATE") && !DECK_PY.contains("DELETE"));
        assert!(JUDGE_PY.contains("feedback_record.api_request=lambda *args,**kwargs:(False,'cloud-disabled')"));
        assert!(JUDGE_PY.contains("PATH='/app/shared/skills/position_judgement.py'"));
        for script in [DECK_PY, JUDGE_PY] {
            for forbidden in ["subprocess", "os.system", "eval(", "socket", "urllib", "requests"] {
                assert!(!script.contains(forbidden), "{forbidden}");
            }
        }
        // the script of a verdict knows three operations, and none of the others the team's script has
        assert!(JUDGE_PY.contains("FIELDS={'feedback':"));
        for other in ["write-request", "apply-request", "recheck", "'note':{"] {
            assert!(!JUDGE_PY.contains(other), "{other}");
        }
    }
}

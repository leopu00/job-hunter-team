//! What the person does on the page of a position, when the profile shows the team of this computer (no cloud
//! account): one closed command, `local_team_position_act`, with a request `{ op, id, token, ...closed fields }`.
//!
//! It runs under the same rules as the verdict of the Swipe (local_swipe.rs, design D1-D6): the `main` window
//! only; only the team of THIS computer and only when this account owns its folder; the position is named by its
//! number in one database, so the request carries the token of the read it was made on (the Swipe's deck, or a
//! detail read of the position: `data.token`) and a database that is no longer that one is `deck_outdated`;
//! every field is checked here again; the one free text travels on stdin and never in a command; the gates and
//! the run are one synchronous closure that holds the account scope; the script is the team's own
//! `position_judgement.py`, unchanged in what it writes, run by a fixed script of the app that turns the cloud
//! off for the call (a local profile has no cloud) and answers one JSON; the app closes the answer again, so no
//! text of the team's script reaches the page.
//!
//! The operations: feedback, exclude, restore (the Swipe's three), recheck, geocode, write_request (the CV or
//! the cover letter) and user_note. The request for the CV and the letter, and the flags, are the ones the
//! agents read (`positions.write_requested`, `geocode_requested`, `recheck_requested`).
//!
//! After a write that worked the app drops what the state stream kept and tells the page that the positions
//! changed (`state-stream://event`, topic `positions`), so it reads the detail again.
use crate::{
    account_scope::AccountScopeState,
    direct_chat,
    existing_team_judgement::NOTE_MAX_BYTES,
    local_swipe::{failure, local_wrapper, on_worker, parse_token, run_script, scope_tag, script_input, short_text, team_is_up, valid_id, JudgeRequest},
    runtime_host::ProcessResult,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::{cell::RefCell, path::PathBuf};
use tauri::State;

/// The fixed script of every act. It checks the identity of the database against the read the person acted on,
/// turns the cloud off for this call, and runs the team's `position_judgement.py` with arguments built here from
/// closed fields; the one free text reaches it as the one line of its stdin.
const ACT_PY: &str = r#"import contextlib,importlib.util,io,json,os,sys
def emit(value): print(json.dumps(value,separators=(',',':'),ensure_ascii=False)); raise SystemExit(0)
def fail(code): emit({'ok':False,'code':code})
try: req=json.loads(sys.stdin.readline())
except Exception: fail('request_invalid')
COMMON={'op','id','expect'}
FIELDS={'feedback':COMMON|{'value','score','direction','reason','note'},'exclude':COMMON|{'reason','note'},'restore':COMMON,'recheck':COMMON|{'on'},'geocode':COMMON|{'on'},'write_request':COMMON|{'on','kind'},'user_note':COMMON|{'note'}}
if not isinstance(req,dict) or req.get('op') not in FIELDS or set(req)-FIELDS[req['op']]: fail('request_invalid')
op=req['op']; pid=req.get('id'); expect=req.get('expect')
if not isinstance(pid,str) or not pid.isdigit() or pid.startswith('0') or len(pid)>18: fail('request_invalid')
if not isinstance(expect,dict) or set(expect)!={'ino','dev'} or any(type(expect[key]) is not int for key in expect): fail('request_invalid')
HOME='/jht_home'
os.environ['JHT_HOME']=HOME
try: info=os.lstat(HOME+'/jobs.db')
except OSError: fail('deck_outdated')
if info.st_ino!=expect['ino'] or info.st_dev!=expect['dev']: fail('deck_outdated')
for key in ('value','direction','reason','note','kind'):
 if key in req and not isinstance(req[key],str): fail('request_invalid')
if 'score' in req and (type(req['score']) is not int or not 1<=req['score']<=5): fail('request_invalid')
if 'on' in FIELDS[op] and type(req.get('on')) is not bool: fail('request_invalid')
if req.get('kind','cv') not in ('cv','cover_letter'): fail('request_invalid')
switch='--on' if req.get('on') else '--off'
note_op=op in ('feedback','exclude') and 'note' in req
if op=='feedback':
 argv=['feedback',pid,'--value',req.get('value','')]
 if 'score' in req: argv+=['--score',str(req['score'])]
 if 'direction' in req: argv+=['--direction',req['direction']]
 if 'reason' in req: argv+=['--reason',req['reason']]
elif op=='exclude': argv=['exclude',pid,'--reason',req.get('reason','')]
elif op=='restore': argv=['restore',pid]
elif op in ('recheck','geocode'): argv=[op,pid,switch]
elif op=='write_request': argv=['write-request',pid,switch,'--kind',req.get('kind','cv')]
else: argv=['note',pid]
if note_op: argv.append('--note-on-stdin')
if note_op or op=='user_note':
 sys.stdin=io.TextIOWrapper(io.BytesIO((json.dumps({'note':req.get('note')},ensure_ascii=False)+'\n').encode('utf-8')),encoding='utf-8')
PATH='/app/shared/skills/position_judgement.py'
if not os.path.isfile(PATH): fail('runtime_outdated')
try:
 spec=importlib.util.spec_from_file_location('position_judgement',PATH); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
 import feedback_record
 # a local profile has no cloud: what the person does is kept in the team's database and goes nowhere else
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

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum WriteKind {
    Cv,
    CoverLetter,
}

impl WriteKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Cv => "cv",
            Self::CoverLetter => "cover_letter",
        }
    }
}

/// The operations beyond the three of the Swipe's verdict.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
enum MoreRequest {
    Recheck { id: String, on: bool, token: String },
    Geocode { id: String, on: bool, token: String },
    WriteRequest { id: String, kind: WriteKind, on: bool, token: String },
    UserNote { id: String, #[serde(default)] body: Option<String>, token: String },
}

enum Act {
    Judge(JudgeRequest),
    More(MoreRequest),
}

impl Act {
    fn parse(request: Value) -> Result<Self, &'static str> {
        let op = request.get("op").and_then(Value::as_str).ok_or("position_write_request_invalid")?.to_owned();
        let invalid = |_| "position_write_request_invalid";
        match op.as_str() {
            "feedback" | "exclude" | "restore" => serde_json::from_value(request).map(Act::Judge).map_err(invalid),
            _ => serde_json::from_value(request).map(Act::More).map_err(invalid),
        }
    }

    fn id(&self) -> &str {
        match self {
            Self::Judge(request) => request.id(),
            Self::More(MoreRequest::Recheck { id, .. } | MoreRequest::Geocode { id, .. } | MoreRequest::WriteRequest { id, .. } | MoreRequest::UserNote { id, .. }) => id,
        }
    }

    fn token(&self) -> &str {
        match self {
            Self::Judge(request) => request.token(),
            Self::More(MoreRequest::Recheck { token, .. } | MoreRequest::Geocode { token, .. } | MoreRequest::WriteRequest { token, .. } | MoreRequest::UserNote { token, .. }) => token,
        }
    }

    fn check(&self) -> Result<(), &'static str> {
        match self {
            Self::Judge(request) => request.check(),
            Self::More(more) => {
                if !valid_id(self.id()) {
                    return Err("position_write_request_invalid");
                }
                match more {
                    MoreRequest::UserNote { body: Some(body), .. } if body.len() > NOTE_MAX_BYTES => Err("note_too_long"),
                    _ => Ok(()),
                }
            }
        }
    }

    /// The one request line the script reads: the closed fields, and where the database must be the one the
    /// request was made on.
    fn line(&self, ino: u64, dev: u64) -> Value {
        let expect = json!({ "ino": ino, "dev": dev });
        match self {
            Self::Judge(request) => request.line(ino, dev),
            Self::More(MoreRequest::Recheck { id, on, .. }) => json!({ "op": "recheck", "id": id, "on": on, "expect": expect }),
            Self::More(MoreRequest::Geocode { id, on, .. }) => json!({ "op": "geocode", "id": id, "on": on, "expect": expect }),
            Self::More(MoreRequest::WriteRequest { id, kind, on, .. }) => {
                json!({ "op": "write_request", "id": id, "kind": kind.as_str(), "on": on, "expect": expect })
            }
            Self::More(MoreRequest::UserNote { id, body, .. }) => {
                let mut line = json!({ "op": "user_note", "id": id, "expect": expect });
                if let Some(body) = body {
                    line.as_object_mut().expect("an object").insert("note".into(), json!(body));
                }
                line
            }
        }
    }
}

/// The codes the script may refuse an act with, as the page tells them.
const REFUSALS: &[&str] = &[
    "request_invalid",
    "reason_invalid",
    "note_too_long",
    "note_invalid",
    "position_not_found",
    "feedback_refused",
    "exclude_refused",
    "deck_outdated",
    "bad_status",
    "already_applied",
    "cover_letter_requires_application",
    "write_request_refused",
    "geocode_refused",
];

/// The flags and the states the script's answer may carry, by the kind of value.
const TEXT_FIELDS: &[&str] = &["op", "value", "reason", "direction", "status", "previous_status", "write_request_kind"];
const FLAG_FIELDS: &[&str] = &["cloud_synced", "recheck_requested", "geocode_requested", "write_requested", "saved"];

/// The script's answer, closed again: a fixed set of fields, a code only of the list.
fn close_answer(output: &ProcessResult) -> Option<Value> {
    if output.stdout.len() > 16 * 1024 {
        return None;
    }
    let line = String::from_utf8_lossy(&output.stdout).lines().last().map(str::to_owned)?;
    let answer: Value = serde_json::from_str(&line).ok()?;
    let answer = answer.as_object()?;
    if answer.get("ok") == Some(&Value::Bool(true)) {
        let mut out = Map::new();
        out.insert("ok".into(), Value::Bool(true));
        for key in TEXT_FIELDS {
            if let Some(text) = short_text(answer.get(*key), 40) {
                out.insert((*key).into(), Value::String(text));
            }
        }
        for key in FLAG_FIELDS {
            if let Some(flag) = answer.get(*key).and_then(Value::as_bool) {
                out.insert((*key).into(), Value::Bool(flag));
            }
        }
        if let Some(score) = answer.get("score").and_then(Value::as_u64).filter(|score| (1..=5).contains(score)) {
            out.insert("score".into(), json!(score));
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

/// The whole decision of one act, with the app-bound steps injected (the order the tests drive). `gate` is the
/// host, the owner and the wrapper; nothing runs unless every step before it said yes. `after_write` runs only
/// when the team wrote what was asked.
pub(crate) fn act_with(
    request: Value,
    window_is_main: bool,
    tag: &str,
    gate: impl FnOnce() -> Result<(), &'static str>,
    run: impl FnOnce(&[u8]) -> Result<ProcessResult, &'static str>,
    team_is_up: impl FnOnce() -> bool,
    after_write: impl FnOnce(),
) -> Value {
    if !window_is_main {
        return failure("position_write_window_refused");
    }
    let act = match Act::parse(request) {
        Ok(act) => act,
        Err(code) => return failure(code),
    };
    if let Err(code) = act.check() {
        return failure(code);
    }
    if let Err(code) = gate() {
        return failure(code);
    }
    let Some((ino, dev)) = parse_token(act.token(), tag) else {
        return failure("deck_outdated");
    };
    let input = script_input(ACT_PY, &act.line(ino, dev));
    let ran = run(&input);
    if let Ok(output) = &ran {
        if let Some(answer) = close_answer(output) {
            if answer.get("ok") == Some(&Value::Bool(true)) {
                after_write();
            }
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

/// The person's act on a position of the team on this computer, written in its database.
#[tauri::command]
pub(crate) async fn local_team_position_act(
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
        act_with(
            request,
            main,
            &scope_tag(scope),
            || {
                *wrapper.borrow_mut() = Some(local_wrapper(&app, scope, true)?);
                Ok(())
            },
            |input| run_script(wrapper.borrow().as_ref().ok_or("runtime_missing")?, input),
            || wrapper.borrow().as_ref().is_some_and(|path| team_is_up(path)),
            || {
                let (Some(wrapper), Ok(runtime)) = (wrapper.borrow().clone(), direct_chat::local_runtime_path(&app)) else { return };
                crate::state_stream::positions_written(&crate::state_stream::LocalContext { app: &app, scope, wrapper: &wrapper, runtime: &runtime });
            },
        )
    })
    .await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const TAG: &str = "0123456789abcdef";

    fn token() -> String {
        format!("{TAG}.77.5")
    }

    fn said(code: i32, text: &str) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult { code, stdout: text.as_bytes().to_vec() })
    }

    /// One drive of `act_with`: what it answered, how often the gate and the run were reached, how often the page was
    /// told, and what the script was given.
    fn drive(
        request: Value,
        main: bool,
        gate: Result<(), &'static str>,
        ran: Result<ProcessResult, &'static str>,
        up: bool,
    ) -> (Value, u32, u32, u32, Vec<u8>) {
        let (gates, runs, told) = (Cell::new(0), Cell::new(0), Cell::new(0));
        let given = RefCell::new(Vec::new());
        let reply = act_with(
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
            || told.set(told.get() + 1),
        );
        (reply, gates.get(), runs.get(), told.get(), given.into_inner())
    }

    fn refused(request: Value) -> (Value, u32, u32) {
        let (reply, gates, runs, told, _) = drive(request, true, Ok(()), said(0, "{}"), true);
        assert_eq!(told, 0);
        (reply, gates, runs)
    }

    fn line_of(input: Vec<u8>) -> Value {
        let text = String::from_utf8(input).unwrap();
        let mut lines = text.lines();
        assert!(lines.next().unwrap().bytes().all(|b| b.is_ascii_hexdigit()), "the script travels as hex");
        let line = serde_json::from_str(lines.next().unwrap()).unwrap();
        assert!(lines.next().is_none());
        line
    }

    #[test]
    fn the_page_is_told_only_when_the_team_wrote_what_was_asked() {
        let request = json!({"op": "restore", "id": "12", "token": token()});
        let ok = r#"{"ok":true,"op":"restore","id":"12","status":"scored","previous_status":"excluded"}"#;
        let (reply, _, runs, told, _) = drive(request.clone(), true, Ok(()), said(0, ok), true);
        assert_eq!(reply, json!({"ok": true, "op": "restore", "status": "scored", "previous_status": "excluded"}));
        assert_eq!((runs, told), (1, 1));
        // a refusal of the script, a request that is not closed, another window, another team, an old token: nobody is told
        let refusal = r#"{"ok":false,"op":"restore","id":"12","code":"position_not_found"}"#;
        let (reply, _, runs, told, _) = drive(request.clone(), true, Ok(()), said(1, refusal), true);
        assert_eq!((reply, runs, told), (failure("position_not_found"), 1, 0));
        let (reply, _, runs, told, _) = drive(request.clone(), false, Ok(()), said(0, ok), true);
        assert_eq!((reply, runs, told), (failure("position_write_window_refused"), 0, 0));
        let (reply, gates, runs, told, _) = drive(request.clone(), true, Err("position_write_read_only"), said(0, ok), true);
        assert_eq!((reply, gates, runs, told), (failure("position_write_read_only"), 1, 0, 0));
        let old = json!({"op": "restore", "id": "12", "token": "ffffffffffffffff.77.5"});
        let (reply, _, runs, told, _) = drive(old, true, Ok(()), said(0, ok), true);
        assert_eq!((reply, runs, told), (failure("deck_outdated"), 0, 0));
    }

    #[test]
    fn a_request_that_is_not_closed_is_refused_before_any_gate_or_run() {
        let t = token();
        let mut cases: Vec<(Value, &str)> = vec![
            (json!({"op": "note", "id": "12", "token": t}), "position_write_request_invalid"),
            (json!({"op": "mark_applied", "id": "12", "on": true, "token": t}), "position_write_request_invalid"),
            (json!({"op": "recheck", "id": "12", "token": t}), "position_write_request_invalid"),
            (json!({"op": "recheck", "id": "12", "on": "yes", "token": t}), "position_write_request_invalid"),
            (json!({"op": "recheck", "id": "12", "on": true}), "position_write_request_invalid"),
            (json!({"op": "recheck", "id": "12", "on": true, "token": t, "path": "/etc"}), "position_write_request_invalid"),
            (json!({"op": "geocode", "id": 12, "on": true, "token": t}), "position_write_request_invalid"),
            (json!({"op": "write_request", "id": "12", "on": true, "token": t}), "position_write_request_invalid"),
            (json!({"op": "write_request", "id": "12", "kind": "poem", "on": true, "token": t}), "position_write_request_invalid"),
            (json!({"op": "user_note", "id": "12", "body": 5, "token": t}), "position_write_request_invalid"),
            (json!({"op": "user_note", "id": "12", "text": "x", "token": t}), "position_write_request_invalid"),
            (json!({"op": "user_note", "id": "12", "body": "n".repeat(NOTE_MAX_BYTES + 1), "token": t}), "note_too_long"),
            (json!({"id": "12", "token": t}), "position_write_request_invalid"),
            (json!({"op": 7, "id": "12", "token": t}), "position_write_request_invalid"),
        ];
        for id in ["", "0", "012", "-1", "1 2", "12;", "１２", "1234567890123456789"] {
            cases.push((json!({"op": "geocode", "id": id, "on": true, "token": t}), "position_write_request_invalid"));
        }
        for (request, code) in cases {
            let (reply, gates, runs) = refused(request.clone());
            assert_eq!(reply, failure(code), "{request}");
            assert_eq!((gates, runs), (0, 0), "{request}");
        }
        // the largest note is not too long, and the Swipe's three operations are still closed as they were
        let (_, gates, runs) = refused(json!({"op": "user_note", "id": "12", "body": "n".repeat(NOTE_MAX_BYTES), "token": t}));
        assert_eq!((gates, runs), (1, 1));
        let (reply, gates, _) = refused(json!({"op": "feedback", "id": "12", "value": "love", "token": t}));
        assert_eq!((reply, gates), (failure("position_write_request_invalid"), 0));
        let (reply, gates, _) = refused(json!({"op": "exclude", "id": "12", "reason": "No Way", "token": t}));
        assert_eq!((reply, gates), (failure("reason_invalid"), 0));
    }

    #[test]
    fn a_team_that_is_not_this_accounts_never_runs_and_the_token_is_not_even_looked_at() {
        for gate in ["position_write_read_only", "runtime_missing", "local_chat_wrapper_outdated"] {
            let request = json!({"op": "recheck", "id": "12", "on": true, "token": "ffffffffffffffff.1.1"});
            let (reply, gates, runs, told, _) = drive(request, true, Err(gate), said(0, "{}"), true);
            assert_eq!((reply, gates, runs, told), (failure(gate), 1, 0, 0), "{gate}");
        }
    }

    #[test]
    fn a_token_of_another_scope_or_garbled_is_an_old_read_and_nothing_runs() {
        for bad in ["ffffffffffffffff.77.5", "0123456789abcdef.77", "0123456789abcdef.77.5.1", "0123456789abcdef.x.5", "", "0123456789abcdef.-7.5"] {
            let request = json!({"op": "geocode", "id": "12", "on": true, "token": bad});
            let (reply, _, runs, told, _) = drive(request, true, Ok(()), said(0, "{}"), true);
            assert_eq!((reply, runs, told), (failure("deck_outdated"), 0, 0), "{bad:?}");
        }
    }

    #[test]
    fn the_request_line_carries_the_closed_fields_the_identity_of_the_database_and_the_note_only_in_it() {
        let t = token();
        let expect = json!({"ino": 77, "dev": 5});
        let cases = [
            (json!({"op": "recheck", "id": "12", "on": true, "token": t}), json!({"op": "recheck", "id": "12", "on": true, "expect": expect})),
            (json!({"op": "geocode", "id": "12", "on": false, "token": t}), json!({"op": "geocode", "id": "12", "on": false, "expect": expect})),
            (
                json!({"op": "write_request", "id": "12", "kind": "cover_letter", "on": true, "token": t}),
                json!({"op": "write_request", "id": "12", "kind": "cover_letter", "on": true, "expect": expect}),
            ),
            (json!({"op": "user_note", "id": "12", "body": "il mio appunto", "token": t}), json!({"op": "user_note", "id": "12", "note": "il mio appunto", "expect": expect})),
            (json!({"op": "user_note", "id": "12", "body": null, "token": t}), json!({"op": "user_note", "id": "12", "expect": expect})),
            (json!({"op": "user_note", "id": "12", "token": t}), json!({"op": "user_note", "id": "12", "expect": expect})),
            (
                json!({"op": "feedback", "id": "12", "value": "dislike", "score": 2, "reason": "too_senior", "note": "n", "token": t}),
                json!({"op": "feedback", "id": "12", "value": "dislike", "score": 2, "reason": "too_senior", "note": "n", "expect": expect}),
            ),
            (json!({"op": "restore", "id": "12", "token": t}), json!({"op": "restore", "id": "12", "expect": expect})),
        ];
        for (request, line) in cases {
            let (_, _, runs, _, input) = drive(request.clone(), true, Ok(()), said(0, "{}"), true);
            assert_eq!(runs, 1, "{request}");
            assert_eq!(line_of(input), line, "{request}");
        }
    }

    #[test]
    fn the_scripts_answer_is_closed_again_and_no_text_of_it_reaches_the_page() {
        let t = token();
        let ask = |op: &str| json!({"op": op, "id": "12", "on": true, "token": t});
        let said_ok = r#"{"ok":true,"op":"recheck","id":"12","recheck_requested":true,"detail":"/etc/passwd","extra":1}"#;
        let (reply, ..) = drive(ask("recheck"), true, Ok(()), said(0, said_ok), true);
        assert_eq!(reply, json!({"ok": true, "op": "recheck", "recheck_requested": true}));
        let said_ok = r#"{"ok":true,"op":"geocode","id":"12","geocode_requested":false}"#;
        assert_eq!(drive(ask("geocode"), true, Ok(()), said(0, said_ok), true).0, json!({"ok": true, "op": "geocode", "geocode_requested": false}));
        let request = json!({"op": "write_request", "id": "12", "kind": "cv", "on": true, "token": t});
        let said_ok = r#"{"ok":true,"op":"write-request","id":"12","write_requested":true,"write_request_kind":"cv"}"#;
        assert_eq!(
            drive(request.clone(), true, Ok(()), said(0, said_ok), true).0,
            json!({"ok": true, "op": "write-request", "write_requested": true, "write_request_kind": "cv"})
        );
        let said_ok = r#"{"ok":true,"op":"note","id":"12","saved":true}"#;
        let note = json!({"op": "user_note", "id": "12", "body": "x", "token": t});
        assert_eq!(drive(note, true, Ok(()), said(0, said_ok), true).0, json!({"ok": true, "op": "note", "saved": true}));
        for code in ["position_not_found", "bad_status", "already_applied", "cover_letter_requires_application", "write_request_refused", "geocode_refused", "note_too_long", "note_invalid", "deck_outdated"] {
            let text = format!(r#"{{"ok":false,"op":"x","id":"12","code":"{code}","detail":"/secret/path"}}"#);
            assert_eq!(drive(request.clone(), true, Ok(()), said(1, &text), true).0, failure(code), "{code}");
        }
        assert_eq!(
            drive(request.clone(), true, Ok(()), said(2, r#"{"ok":false,"code":"request_invalid"}"#), true).0,
            failure("position_write_request_invalid")
        );
        // a code the list does not have, no JSON, too much of it: a runtime older than this one
        for text in [r#"{"ok":false,"code":"/etc/passwd"}"#.to_owned(), "Traceback (most recent call last)".to_owned(), "x".repeat(20_000)] {
            let (reply, _, _, told, _) = drive(request.clone(), true, Ok(()), said(1, &text), true);
            assert_eq!((reply, told), (failure("existing_team_runtime_outdated"), 0));
        }
    }

    #[test]
    fn a_team_that_is_off_says_so_and_a_failed_run_of_a_team_that_is_up_does_not() {
        let request = json!({"op": "geocode", "id": "12", "on": true, "token": token()});
        assert_eq!(drive(request.clone(), true, Ok(()), Err("timeout"), false).0, failure("local_team_not_running"));
        assert_eq!(drive(request.clone(), true, Ok(()), said(125, ""), false).0, failure("local_team_not_running"));
        assert_eq!(drive(request, true, Ok(()), Err("timeout"), true).0, failure("existing_team_runtime_outdated"));
    }

    /// The source of the module above its tests.
    fn source() -> &'static str {
        include_str!("local_position_act.rs").split("#[cfg(test)]").next().unwrap()
    }

    #[test]
    fn the_gates_and_the_run_happen_under_the_scope_with_no_await_between_them() {
        let source = source();
        let decision = source.split("pub(crate) fn act_with(").nth(1).unwrap().split("/// The person's act on a position").next().unwrap();
        assert!(!decision.contains(".await") && !decision.contains("async"));
        let command = source.split("pub(crate) async fn local_team_position_act(").nth(1).unwrap();
        assert!(command.contains("on_worker(scopes.inner(), expected,"));
        assert!(command.contains("window_may_write(window.label())"));
        // the write is announced to the page from inside the worker, under the scope
        assert!(command.find("on_worker(").unwrap() < command.find("positions_written(").unwrap());
    }

    #[test]
    fn the_script_turns_the_cloud_off_runs_nothing_but_the_teams_judgement_and_knows_only_these_operations() {
        assert!(ACT_PY.contains("feedback_record.api_request=lambda *args,**kwargs:(False,'cloud-disabled')"));
        assert!(ACT_PY.contains("PATH='/app/shared/skills/position_judgement.py'"));
        for forbidden in ["subprocess", "os.system", "eval(", "socket", "urllib", "requests"] {
            assert!(!ACT_PY.contains(forbidden), "{forbidden}");
        }
        let fields = ACT_PY.split("FIELDS={").nth(1).unwrap().split('\n').next().unwrap();
        for op in ["feedback", "exclude", "restore", "recheck", "geocode", "write_request", "user_note"] {
            assert!(fields.contains(&format!("'{op}':")), "{op}");
        }
        // the authorisation to apply is not here: it is written in the broker too, and is its own piece
        for other in ["apply", "mark_applied", "outcome", "ticket"] {
            assert!(!fields.contains(other), "{other}");
        }
    }
}

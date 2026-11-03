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
    existing_team_judgement::{valid_destination, valid_digest, BrokerRecord, NOTE_MAX_BYTES},
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
FIELDS={'feedback':COMMON|{'value','score','direction','reason','note'},'exclude':COMMON|{'reason','note'},'restore':COMMON,'recheck':COMMON|{'on'},'geocode':COMMON|{'on'},'write_request':COMMON|{'on','kind'},'user_note':COMMON|{'note'},'ticket':COMMON|{'kind','text'},'mark_applied':COMMON|{'on','note'},'outcome':COMMON|{'value','rejection_reason','rejection_note'},'outcome_undo':COMMON,'apply_preview':COMMON,'apply_request':COMMON|{'on','confirm'}}
KINDS={'write_request':('cv','cover_letter'),'ticket':('rescore','free')}
if not isinstance(req,dict) or req.get('op') not in FIELDS or set(req)-FIELDS[req['op']]: fail('request_invalid')
op=req['op']; pid=req.get('id'); expect=req.get('expect')
if not isinstance(pid,str) or not pid.isdigit() or pid.startswith('0') or len(pid)>18: fail('request_invalid')
if not isinstance(expect,dict) or set(expect)!={'ino','dev'} or any(type(expect[key]) is not int for key in expect): fail('request_invalid')
HOME='/jht_home'
os.environ['JHT_HOME']=HOME
try: info=os.lstat(HOME+'/jobs.db')
except OSError: fail('deck_outdated')
if info.st_ino!=expect['ino'] or info.st_dev!=expect['dev']: fail('deck_outdated')
for key in ('value','direction','reason','note','kind','text','rejection_reason','rejection_note','confirm'):
 if key in req and not isinstance(req[key],str): fail('request_invalid')
if 'score' in req and (type(req['score']) is not int or not 1<=req['score']<=5): fail('request_invalid')
if 'on' in FIELDS[op] and type(req.get('on')) is not bool: fail('request_invalid')
if 'kind' in req and req['kind'] not in KINDS.get(op,()): fail('request_invalid')
if op=='ticket' and ('kind' not in req or not isinstance(req.get('text'),str)): fail('request_invalid')
if op=='outcome' and req.get('value') not in ('interview','rejected'): fail('request_invalid')
if 'confirm' in req and (len(req['confirm'])!=64 or any(c not in '0123456789abcdef' for c in req['confirm'])): fail('request_invalid')
switch='--on' if req.get('on') else '--off'
note_op=(op in ('feedback','exclude','mark_applied') and 'note' in req) or (op=='outcome' and 'rejection_note' in req)
if op=='feedback':
 argv=['feedback',pid,'--value',req.get('value','')]
 if 'score' in req: argv+=['--score',str(req['score'])]
 if 'direction' in req: argv+=['--direction',req['direction']]
 if 'reason' in req: argv+=['--reason',req['reason']]
elif op=='exclude': argv=['exclude',pid,'--reason',req.get('reason','')]
elif op=='restore': argv=['restore',pid]
elif op in ('recheck','geocode'): argv=[op,pid,switch]
elif op=='write_request': argv=['write-request',pid,switch,'--kind',req.get('kind','cv')]
elif op=='ticket': argv=['ticket',pid,'--kind','rescore' if req['kind']=='rescore' else 'custom','--text-on-stdin']
elif op=='mark_applied': argv=['mark-applied',pid,switch]
elif op=='outcome':
 argv=['outcome',pid,'--value',req['value']]
 if 'rejection_reason' in req: argv+=['--reason',req['rejection_reason']]
elif op=='outcome_undo': argv=['outcome-undo',pid]
elif op=='apply_preview': argv=['apply-preview',pid]
elif op=='apply_request':
 argv=['apply-request',pid,switch]
 if req['on'] and 'confirm' in req: argv+=['--expect',req['confirm']]
else: argv=['note',pid]
if note_op: argv.append('--note-on-stdin')
feed=None
if op=='ticket': feed={'text':req['text']}
elif note_op or op=='user_note': feed={'note':req.get('rejection_note') if op=='outcome' else req.get('note')}
if feed is not None:
 sys.stdin=io.TextIOWrapper(io.BytesIO((json.dumps(feed,ensure_ascii=False)+'\n').encode('utf-8')),encoding='utf-8')
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
    Ticket { id: String, kind: TicketKind, text: String, token: String },
    MarkApplied { id: String, on: bool, #[serde(default)] note: Option<String>, token: String },
    Outcome {
        id: String,
        value: OutcomeValue,
        #[serde(default)]
        rejection_reason: Option<String>,
        #[serde(default)]
        rejection_note: Option<String>,
        token: String,
    },
    OutcomeUndo { id: String, token: String },
    /// What the person confirms before authorising an application: «title @ company · host» and the digest of it.
    ApplyPreview { id: String, token: String },
    /// Authorising (`on`, with the digest of the preview the person saw and an explicit `confirmed`) or withdrawing.
    ApplyRequest {
        id: String,
        on: bool,
        #[serde(default)]
        confirmed: bool,
        #[serde(default)]
        confirm: Option<String>,
        token: String,
    },
}

/// A request to the team about one position: the rescore (asked once while one waits) or a free request.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TicketKind {
    Rescore,
    Free,
}

impl TicketKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Rescore => "rescore",
            Self::Free => "free",
        }
    }
}

/// What the person may declare of a company's answer; the silence is derived by the team, never declared.
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum OutcomeValue {
    Interview,
    Rejected,
}

impl OutcomeValue {
    fn as_str(self) -> &'static str {
        match self {
            Self::Interview => "interview",
            Self::Rejected => "rejected",
        }
    }
}

/// The reasons of a rejection the person may choose, and the longest text of a note and of an application.
const REJECTION_REASONS: &[&str] = &["location", "salary", "experience", "language"];
const SHORT_NOTE_CHARS: usize = 500;
const TICKET_TEXT_CHARS: usize = 2000;

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
            Self::More(
                MoreRequest::Recheck { id, .. }
                | MoreRequest::Geocode { id, .. }
                | MoreRequest::WriteRequest { id, .. }
                | MoreRequest::UserNote { id, .. }
                | MoreRequest::Ticket { id, .. }
                | MoreRequest::MarkApplied { id, .. }
                | MoreRequest::Outcome { id, .. }
                | MoreRequest::OutcomeUndo { id, .. }
                | MoreRequest::ApplyPreview { id, .. }
                | MoreRequest::ApplyRequest { id, .. },
            ) => id,
        }
    }

    fn token(&self) -> &str {
        match self {
            Self::Judge(request) => request.token(),
            Self::More(
                MoreRequest::Recheck { token, .. }
                | MoreRequest::Geocode { token, .. }
                | MoreRequest::WriteRequest { token, .. }
                | MoreRequest::UserNote { token, .. }
                | MoreRequest::Ticket { token, .. }
                | MoreRequest::MarkApplied { token, .. }
                | MoreRequest::Outcome { token, .. }
                | MoreRequest::OutcomeUndo { token, .. }
                | MoreRequest::ApplyPreview { token, .. }
                | MoreRequest::ApplyRequest { token, .. },
            ) => token,
        }
    }

    fn check(&self) -> Result<(), &'static str> {
        match self {
            Self::Judge(request) => request.check(),
            Self::More(more) => {
                if !valid_id(self.id()) {
                    return Err("position_write_request_invalid");
                }
                let chars = |text: &str| text.trim().chars().count();
                match more {
                    MoreRequest::UserNote { body: Some(body), .. } if body.len() > NOTE_MAX_BYTES => Err("note_too_long"),
                    MoreRequest::Ticket { text, .. } if chars(text) == 0 => Err("request_empty"),
                    MoreRequest::Ticket { text, .. } if chars(text) > TICKET_TEXT_CHARS => Err("request_too_long"),
                    MoreRequest::MarkApplied { note: Some(note), .. } if chars(note) > SHORT_NOTE_CHARS => Err("note_too_long"),
                    MoreRequest::Outcome { rejection_reason: Some(reason), .. } if !reason.is_empty() && !REJECTION_REASONS.contains(&reason.as_str()) => {
                        Err("invalid_reason")
                    }
                    MoreRequest::Outcome { rejection_note: Some(note), .. } if chars(note) > SHORT_NOTE_CHARS => Err("invalid_note"),
                    // Authorising an application is asked for in two steps: the preview, then this, with an explicit
                    // «confirmed» and the digest of the preview the person saw. Withdrawing is asked for as it is.
                    MoreRequest::ApplyRequest { on: true, confirmed, confirm, .. }
                        if !*confirmed || !confirm.as_deref().is_some_and(valid_digest) =>
                    {
                        Err("position_write_not_confirmed")
                    }
                    MoreRequest::ApplyRequest { on: false, confirm: Some(_), .. } => Err("position_write_request_invalid"),
                    MoreRequest::Outcome { value: OutcomeValue::Interview, rejection_reason, rejection_note, .. }
                        if rejection_reason.as_deref().is_some_and(|r| !r.is_empty()) || rejection_note.as_deref().is_some_and(|n| !n.trim().is_empty()) =>
                    {
                        Err("reason_only_on_rejection")
                    }
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
            Self::More(MoreRequest::Ticket { id, kind, text, .. }) => {
                json!({ "op": "ticket", "id": id, "kind": kind.as_str(), "text": text, "expect": expect })
            }
            Self::More(MoreRequest::MarkApplied { id, on, note, .. }) => {
                let mut line = json!({ "op": "mark_applied", "id": id, "on": on, "expect": expect });
                // a note belongs to the mark, never to taking it back
                if let (true, Some(note)) = (*on, note.as_deref().filter(|note| !note.trim().is_empty())) {
                    line.as_object_mut().expect("an object").insert("note".into(), json!(note));
                }
                line
            }
            Self::More(MoreRequest::Outcome { id, value, rejection_reason, rejection_note, .. }) => {
                let mut line = json!({ "op": "outcome", "id": id, "value": value.as_str(), "expect": expect });
                let map = line.as_object_mut().expect("an object");
                if let Some(reason) = rejection_reason.as_deref().filter(|reason| !reason.is_empty()) {
                    map.insert("rejection_reason".into(), json!(reason));
                }
                if let Some(note) = rejection_note.as_deref().filter(|note| !note.trim().is_empty()) {
                    map.insert("rejection_note".into(), json!(note));
                }
                line
            }
            Self::More(MoreRequest::OutcomeUndo { id, .. }) => json!({ "op": "outcome_undo", "id": id, "expect": expect }),
            Self::More(MoreRequest::ApplyPreview { id, .. }) => json!({ "op": "apply_preview", "id": id, "expect": expect }),
            Self::More(MoreRequest::ApplyRequest { id, on, confirm, .. }) => {
                let mut line = json!({ "op": "apply_request", "id": id, "on": on, "expect": expect });
                if let (true, Some(confirm)) = (*on, confirm) {
                    line.as_object_mut().expect("an object").insert("confirm".into(), json!(confirm));
                }
                line
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
    "request_empty",
    "request_too_long",
    "not_applied",
    "applied_by_team",
    "no_outcome",
    "invalid_reason",
    "invalid_note",
    "reason_only_on_rejection",
];

/// What the authorisation to apply may be refused with (the consent, the rule, the position, the preview): the codes of
/// `apply_gate.py` and `apply_request.py`. A code the list does not have is a runtime older than this app.
const APPLY_REFUSALS: &[&str] = &[
    "config_missing",
    "config_unreadable",
    "config_malformed",
    "consent_absent",
    "consent_disabled",
    "consent_mode_unknown",
    "consent_cap_invalid",
    "rule_unavailable",
    "authorisation_unreadable",
    "position_id_invalid",
    "position_not_found",
    "already_submitted",
    "position_not_ready",
    "destination_invalid",
    "confirmation_required",
    "position_changed",
    "write_not_observed",
    "apply_request_refused",
    "agent_caller",
];

/// The flags and the states the script's answer may carry, by the kind of value.
const TEXT_FIELDS: &[&str] = &[
    "result",
    "op",
    "value",
    "reason",
    "direction",
    "status",
    "previous_status",
    "write_request_kind",
    "applied_at",
    "applied_via",
    "response",
    "response_at",
    "ticket_status",
];
const FLAG_FIELDS: &[&str] = &["cloud_synced", "recheck_requested", "geocode_requested", "write_requested", "saved", "deduplicated", "apply_requested"];
/// Whole numbers the answer may carry: the round of an interview, the number of a ticket.
const NUMBER_FIELDS: &[(&str, u64)] = &[("interview_round", 1000), ("ticket_id", 1_000_000_000_000)];

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
        // the preview of an authorisation: the sentence the person confirms (cut and without control characters), the
        // digest it must carry back, and where it would go
        if let Some(summary) = answer.get("summary").and_then(Value::as_str) {
            let text: String = summary.chars().filter(|c| !c.is_control() && !matches!(*c, '\u{2028}' | '\u{2029}')).take(300).collect();
            if !text.is_empty() {
                out.insert("summary".into(), Value::String(text));
            }
        }
        if let Some(confirm) = answer.get("confirm").and_then(Value::as_str).filter(|c| valid_digest(c)) {
            out.insert("confirm".into(), json!(confirm));
        }
        if answer.get("op").and_then(Value::as_str) == Some("apply-preview") {
            if let Some(destination) = answer.get("destination").and_then(Value::as_str).filter(|d| valid_destination(d)) {
                out.insert("destination".into(), json!(destination));
            }
        }
        for (key, most) in NUMBER_FIELDS {
            if let Some(number) = answer.get(*key).and_then(Value::as_u64).filter(|number| number <= most) {
                out.insert((*key).into(), json!(number));
            }
        }
        if let Some(score) = answer.get("score").and_then(Value::as_u64).filter(|score| (1..=5).contains(score)) {
            out.insert("score".into(), json!(score));
        }
        return Some(Value::Object(out));
    }
    let code = answer.get("code").and_then(Value::as_str)?;
    let code = REFUSALS.iter().chain(APPLY_REFUSALS).copied().find(|known| *known == code)?;
    Some(failure(match code {
        "request_invalid" => "position_write_request_invalid",
        other => other,
    }))
}

impl Act {
    /// Whether this act only reads (the preview an authorisation is confirmed from).
    fn reads(&self) -> bool {
        matches!(self, Self::More(MoreRequest::ApplyPreview { .. }))
    }

    /// Whether this act authorises an application: the one that needs the broker's record as well.
    fn authorises(&self) -> bool {
        matches!(self, Self::More(MoreRequest::ApplyRequest { on: true, .. }))
    }
}

/// The script's last line as it printed it, for the two fields (`instant`, `destination`) the answer closes away: they
/// go to the broker from the host and never to the page.
fn raw_answer(output: &ProcessResult) -> Option<Value> {
    String::from_utf8_lossy(&output.stdout).lines().last().and_then(|line| serde_json::from_str(line).ok())
}

/// What the host's wrapper answered to `desktop-apply record`: its one closed line says the broker recorded it.
fn broker_recorded(result: Result<ProcessResult, &'static str>) -> bool {
    let Ok(result) = result else { return false };
    let line: Option<Value> = String::from_utf8_lossy(&result.stdout).lines().last().and_then(|line| serde_json::from_str(line).ok());
    result.code == 0 && line.is_some_and(|line| line == json!({ "ok": true }))
}

/// The whole decision of one act, with the app-bound steps injected (the order the tests drive). `gate` is the
/// host, the owner and the wrapper; nothing runs unless every step before it said yes. `after_write` runs only
/// when the team wrote what was asked.
///
/// An authorisation to apply is written twice: the flag the pages show (the script in the team's container) and the
/// record in the team's broker, which is what the CLOSER checks before it sends, made from the host (`record`: the
/// agents' container cannot record there). If the broker does not record it, the flag is withdrawn again and the person
/// is told: nothing would go out. Only then is the page told it worked.
#[allow(clippy::too_many_arguments)]
pub(crate) fn act_with(
    request: Value,
    window_is_main: bool,
    tag: &str,
    gate: impl FnOnce() -> Result<(), &'static str>,
    mut run: impl FnMut(&[u8]) -> Result<ProcessResult, &'static str>,
    team_is_up: impl FnOnce() -> bool,
    record: impl FnOnce(&BrokerRecord) -> Result<ProcessResult, &'static str>,
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
            let worked = answer.get("ok") == Some(&Value::Bool(true));
            if worked && act.authorises() {
                let recorded = raw_answer(output)
                    .and_then(|raw| BrokerRecord::from_reply(act.id(), &raw))
                    .is_some_and(|broker| broker_recorded(record(&broker)));
                if !recorded {
                    // withdrawn again, with the same closed line the page would have sent
                    let withdraw = Act::More(MoreRequest::ApplyRequest { id: act.id().to_owned(), on: false, confirmed: false, confirm: None, token: act.token().to_owned() });
                    let _ = run(&script_input(ACT_PY, &withdraw.line(ino, dev)));
                    return failure("apply_authorisation_unrecorded");
                }
            }
            // a preview is a read: the positions did not change, nobody is told
            if worked && !act.reads() {
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

/// What the action log writes down of an act: `exclude` and `restore` of a position, with its number. The request is
/// read only for these two words and a whole number; the rest of it is the act's own business.
fn log_event(request: &Value) -> Option<(&'static str, u64)> {
    let action = match (request.get("op").and_then(Value::as_str)?, request.get("on").and_then(Value::as_bool)) {
        ("exclude", _) => "exclusion.decide",
        ("restore", _) => "exclusion.withdraw",
        ("apply_request", Some(true)) => "position.apply_authorize",
        ("apply_request", Some(false)) => "position.apply_revoke",
        _ => return None,
    };
    let id = request.get("id").and_then(Value::as_str).filter(|id| valid_id(id))?;
    Some((action, id.parse().ok()?))
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
    // the one act the action log names: a position excluded or put back, by its number
    let logged = log_event(&request);
    // an authorisation needs the host's wrapper to record it in the broker: checked before anything is written
    let authorising = request.get("op").and_then(Value::as_str) == Some("apply_request") && request.get("on") == Some(&Value::Bool(true));
    Ok(on_worker(scopes.inner(), expected, move |scope| {
        let wrapper: RefCell<Option<PathBuf>> = RefCell::new(None);
        act_with(
            request,
            main,
            &scope_tag(scope),
            || {
                let found = local_wrapper(&app, scope, true)?;
                if authorising && !crate::onboarding::wrapper_has_desktop_apply(&found) {
                    return Err("existing_team_runtime_outdated");
                }
                *wrapper.borrow_mut() = Some(found);
                Ok(())
            },
            |input| run_script(wrapper.borrow().as_ref().ok_or("runtime_missing")?, input),
            || wrapper.borrow().as_ref().is_some_and(|path| team_is_up(path)),
            |broker| {
                let (id, instant, destination) = broker.fields();
                let found = wrapper.borrow().clone().ok_or("runtime_missing")?;
                crate::onboarding::run_verified_local_wrapper(&found, &["desktop-apply", "record", id, instant, destination], None, std::time::Duration::from_secs(40))
            },
            || {
                if let Some((action, number)) = logged {
                    crate::local_action_log::record(&app, scope, action, &crate::local_action_log::Subject::Position(number));
                }
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
        let mut ran = Some(ran);
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
                ran.take().unwrap_or_else(|| said(0, "{}"))
            },
            || up,
            |_| said(0, r#"{"ok":true}"#),
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
            (json!({"op": "apply_cancel", "id": "12", "on": true, "token": t}), "position_write_request_invalid"),
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
            (json!({"op": "ticket", "id": "12", "kind": "rescore", "token": t}), "position_write_request_invalid"),
            (json!({"op": "ticket", "id": "12", "kind": "custom", "text": "x", "token": t}), "position_write_request_invalid"),
            (json!({"op": "ticket", "id": "12", "kind": "free", "text": "   ", "token": t}), "request_empty"),
            (json!({"op": "ticket", "id": "12", "kind": "free", "text": "x".repeat(2001), "token": t}), "request_too_long"),
            (json!({"op": "mark_applied", "id": "12", "token": t}), "position_write_request_invalid"),
            (json!({"op": "mark_applied", "id": "12", "on": true, "note": "n".repeat(501), "token": t}), "note_too_long"),
            (json!({"op": "outcome", "id": "12", "value": "ghosted", "token": t}), "position_write_request_invalid"),
            (json!({"op": "outcome", "id": "12", "token": t}), "position_write_request_invalid"),
            (json!({"op": "outcome", "id": "12", "value": "rejected", "rejection_reason": "weather", "token": t}), "invalid_reason"),
            (json!({"op": "outcome", "id": "12", "value": "rejected", "rejection_note": "n".repeat(501), "token": t}), "invalid_note"),
            (json!({"op": "outcome", "id": "12", "value": "interview", "rejection_reason": "salary", "token": t}), "reason_only_on_rejection"),
            (json!({"op": "outcome", "id": "12", "value": "interview", "rejection_note": "x", "token": t}), "reason_only_on_rejection"),
            (json!({"op": "outcome_undo", "id": "12", "token": t, "value": "rejected"}), "position_write_request_invalid"),
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
            (
                json!({"op": "ticket", "id": "12", "kind": "rescore", "text": "Rivaluta", "token": t}),
                json!({"op": "ticket", "id": "12", "kind": "rescore", "text": "Rivaluta", "expect": expect}),
            ),
            (json!({"op": "mark_applied", "id": "12", "on": true, "note": "dal sito", "token": t}), json!({"op": "mark_applied", "id": "12", "on": true, "note": "dal sito", "expect": expect})),
            (json!({"op": "mark_applied", "id": "12", "on": false, "note": "ignorata", "token": t}), json!({"op": "mark_applied", "id": "12", "on": false, "expect": expect})),
            (json!({"op": "mark_applied", "id": "12", "on": true, "note": "  ", "token": t}), json!({"op": "mark_applied", "id": "12", "on": true, "expect": expect})),
            (
                json!({"op": "outcome", "id": "12", "value": "rejected", "rejection_reason": "salary", "rejection_note": "troppo basso", "token": t}),
                json!({"op": "outcome", "id": "12", "value": "rejected", "rejection_reason": "salary", "rejection_note": "troppo basso", "expect": expect}),
            ),
            (json!({"op": "outcome", "id": "12", "value": "interview", "rejection_reason": "", "token": t}), json!({"op": "outcome", "id": "12", "value": "interview", "expect": expect})),
            (json!({"op": "outcome_undo", "id": "12", "token": t}), json!({"op": "outcome_undo", "id": "12", "expect": expect})),
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
        let said_ok = r#"{"ok":true,"op":"ticket","id":"12","ticket_id":7,"ticket_status":"assigned","deduplicated":true,"request_text":"private"}"#;
        let ticket = json!({"op": "ticket", "id": "12", "kind": "rescore", "text": "x", "token": t});
        assert_eq!(
            drive(ticket, true, Ok(()), said(0, said_ok), true).0,
            json!({"ok": true, "op": "ticket", "ticket_status": "assigned", "deduplicated": true, "ticket_id": 7})
        );
        let said_ok = r#"{"ok":true,"op":"outcome","id":"12","status":"response","response":"rejected","response_at":"2026-11-03T08:00:00.000Z","interview_round":null,"rejection_note":"private"}"#;
        let outcome = json!({"op": "outcome", "id": "12", "value": "rejected", "token": t});
        assert_eq!(
            drive(outcome.clone(), true, Ok(()), said(0, said_ok), true).0,
            json!({"ok": true, "op": "outcome", "status": "response", "response": "rejected", "response_at": "2026-11-03T08:00:00.000Z"})
        );
        let said_ok = r#"{"ok":true,"op":"mark-applied","id":"12","status":"applied","applied_at":"2026-11-03T08:00:00.000Z","applied_via":"user_manual"}"#;
        let marked = json!({"op": "mark_applied", "id": "12", "on": true, "token": t});
        assert_eq!(
            drive(marked, true, Ok(()), said(0, said_ok), true).0,
            json!({"ok": true, "op": "mark-applied", "status": "applied", "applied_at": "2026-11-03T08:00:00.000Z", "applied_via": "user_manual"})
        );
        // a number the page would not expect is not passed on
        let said_big = r#"{"ok":true,"op":"outcome","interview_round":99999999,"ticket_id":-1}"#;
        assert_eq!(drive(outcome, true, Ok(()), said(0, said_big), true).0, json!({"ok": true, "op": "outcome"}));
        let said_ok = r#"{"ok":true,"op":"note","id":"12","saved":true}"#;
        let note = json!({"op": "user_note", "id": "12", "body": "x", "token": t});
        assert_eq!(drive(note, true, Ok(()), said(0, said_ok), true).0, json!({"ok": true, "op": "note", "saved": true}));
        for code in [
            "position_not_found", "bad_status", "already_applied", "cover_letter_requires_application", "write_request_refused", "geocode_refused",
            "note_too_long", "note_invalid", "deck_outdated", "request_empty", "request_too_long", "not_applied", "applied_by_team", "no_outcome",
            "invalid_reason", "invalid_note", "reason_only_on_rejection",
        ] {
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

    const DIGEST: &str = "ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12ab12";
    const INSTANT: &str = "2026-11-03T09:30:00.123Z";

    /// An authorisation, driven with the answers of the script (in order) and of the host's record; what ran, in order.
    fn authorise(answers: &[&str], broker: Result<ProcessResult, &'static str>) -> (Value, Vec<Value>, Option<BrokerRecord>, u32) {
        let (told, recorded) = (Cell::new(0), RefCell::new(None));
        let (lines, next) = (RefCell::new(Vec::new()), Cell::new(0));
        let request = json!({"op": "apply_request", "id": "4", "on": true, "confirmed": true, "confirm": DIGEST, "token": token()});
        let reply = act_with(
            request,
            true,
            TAG,
            || Ok(()),
            |input| {
                let text = String::from_utf8(input.to_vec()).unwrap();
                lines.borrow_mut().push(serde_json::from_str::<Value>(text.lines().nth(1).unwrap()).unwrap());
                let n = next.get();
                next.set(n + 1);
                said(0, answers.get(n).copied().unwrap_or(r#"{"ok":true,"op":"apply-request","id":4}"#))
            },
            || true,
            |record| {
                *recorded.borrow_mut() = Some(record.clone());
                broker
            },
            || told.set(told.get() + 1),
        );
        (reply, lines.into_inner(), recorded.into_inner(), told.get())
    }

    const WRITTEN: &str = r#"{"ok":true,"op":"apply-request","id":4,"apply_requested":true,"result":"authorised","instant":"2026-11-03T09:30:00.123Z","destination":"portal:ashby","detail":"x"}"#;

    #[test]
    fn an_authorisation_is_recorded_in_the_broker_from_the_host_and_only_then_the_page_hears_it_worked() {
        let (reply, lines, recorded, told) = authorise(&[WRITTEN], said(0, r#"{"ok":true}"#));
        // the page learns the flag and nothing of the instant or the destination, which went to the broker
        assert_eq!(reply, json!({"ok": true, "op": "apply-request", "apply_requested": true, "result": "authorised"}));
        assert_eq!(told, 1);
        assert_eq!(lines.len(), 1, "no withdrawal when the broker recorded it");
        assert_eq!(lines[0], json!({"op": "apply_request", "id": "4", "on": true, "confirm": DIGEST, "expect": {"ino": 77, "dev": 5}}));
        assert_eq!(recorded.unwrap().fields(), ("4", INSTANT, "portal:ashby"));
    }

    #[test]
    fn an_authorisation_the_broker_does_not_record_is_withdrawn_and_said_and_the_page_is_not_told_it_worked() {
        for broker in [
            said(0, r#"{"ok":false,"error":"apply_record_refused"}"#),
            said(1, r#"{"ok":true}"#),
            said(0, ""),
            said(0, "recorded"),
            Err("timeout"),
        ] {
            let (reply, lines, recorded, told) = authorise(&[WRITTEN], broker);
            assert_eq!(reply, failure("apply_authorisation_unrecorded"));
            assert_eq!(told, 0);
            assert!(recorded.is_some());
            assert_eq!(lines.len(), 2);
            assert_eq!(lines[1], json!({"op": "apply_request", "id": "4", "on": false, "expect": {"ino": 77, "dev": 5}}), "withdrawn with the closed line");
        }
        // what the script printed does not fit a command line: nothing reaches the broker, and it is withdrawn too
        for bad in [
            r#"{"ok":true,"apply_requested":true}"#,
            r#"{"ok":true,"apply_requested":true,"instant":"2026-11-03 09:30","destination":"portal:ashby"}"#,
            r#"{"ok":true,"apply_requested":true,"instant":"2026-11-03T09:30:00.123Z","destination":"portal:ash'by; reboot"}"#,
            r#"{"ok":true,"apply_requested":true,"instant":"2026-11-03T09:30:00.123Z","destination":"ftp:example.com"}"#,
        ] {
            let (reply, lines, recorded, told) = authorise(&[bad], said(0, r#"{"ok":true}"#));
            assert_eq!((reply, recorded, told, lines.len()), (failure("apply_authorisation_unrecorded"), None, 0, 2), "{bad}");
        }
    }

    #[test]
    fn an_authorisation_needs_a_click_and_the_digest_of_the_preview_and_a_withdrawal_needs_neither() {
        let t = token();
        for (request, code) in [
            (json!({"op": "apply_request", "id": "4", "on": true, "token": t}), "position_write_not_confirmed"),
            (json!({"op": "apply_request", "id": "4", "on": true, "confirmed": false, "confirm": DIGEST, "token": t}), "position_write_not_confirmed"),
            (json!({"op": "apply_request", "id": "4", "on": true, "confirmed": true, "token": t}), "position_write_not_confirmed"),
            (json!({"op": "apply_request", "id": "4", "on": true, "confirmed": true, "confirm": DIGEST.to_uppercase(), "token": t}), "position_write_not_confirmed"),
            (json!({"op": "apply_request", "id": "4", "on": true, "confirmed": true, "confirm": "0'; reboot", "token": t}), "position_write_not_confirmed"),
            (json!({"op": "apply_request", "id": "4", "on": false, "confirm": DIGEST, "token": t}), "position_write_request_invalid"),
            (json!({"op": "apply_request", "id": "4", "confirmed": true, "confirm": DIGEST, "token": t}), "position_write_request_invalid"),
            (json!({"op": "apply_preview", "id": "4", "confirm": DIGEST, "token": t}), "position_write_request_invalid"),
            (json!({"op": "apply_preview", "id": "0", "token": t}), "position_write_request_invalid"),
        ] {
            let (reply, gates, runs) = refused(request.clone());
            assert_eq!((reply, gates, runs), (failure(code), 0, 0), "{request}");
        }
        // a withdrawal asks nothing of the broker and writes the one closed line
        let request = json!({"op": "apply_request", "id": "4", "on": false, "token": t});
        let broker_calls = Cell::new(0);
        let reply = act_with(request, true, TAG, || Ok(()), |_| said(0, r#"{"ok":true,"op":"apply-request","id":4,"apply_requested":false,"result":"withdrawn"}"#), || true, |_| {
            broker_calls.set(broker_calls.get() + 1);
            said(0, "{}")
        }, || {});
        assert_eq!(reply, json!({"ok": true, "op": "apply-request", "apply_requested": false, "result": "withdrawn"}));
        assert_eq!(broker_calls.get(), 0);
    }

    #[test]
    fn the_preview_is_closed_to_a_sentence_a_digest_and_a_destination_and_writes_nothing() {
        let said_ok = format!(r#"{{"ok":true,"op":"apply-preview","id":4,"summary":"Synthetic role @ Synthetic\u0007 Co \u00b7 jobs.example.com","confirm":"{DIGEST}","destination":"web:jobs.example.com","extra":1}}"#);
        let request = json!({"op": "apply_preview", "id": "4", "token": token()});
        let (reply, _, runs, told, input) = drive(request.clone(), true, Ok(()), said(0, &said_ok), true);
        assert_eq!(
            reply,
            json!({"ok": true, "op": "apply-preview", "summary": "Synthetic role @ Synthetic Co \u{b7} jobs.example.com", "confirm": DIGEST, "destination": "web:jobs.example.com"})
        );
        assert_eq!((runs, told), (1, 0), "a preview is not a write: nobody is told that the positions changed");
        assert_eq!(line_of(input), json!({"op": "apply_preview", "id": "4", "expect": {"ino": 77, "dev": 5}}));
        // a digest or a destination that does not fit is not passed on
        let hostile = r#"{"ok":true,"op":"apply-preview","summary":"s","confirm":"ZZ","destination":"web:a b; reboot"}"#;
        assert_eq!(drive(request, true, Ok(()), said(0, hostile), true).0, json!({"ok": true, "op": "apply-preview", "summary": "s"}));
    }

    #[test]
    fn the_refusals_of_the_consent_and_of_the_position_come_back_as_codes_and_nothing_is_recorded() {
        let t = token();
        for code in ["consent_absent", "consent_disabled", "config_missing", "position_not_ready", "already_submitted", "destination_invalid", "confirmation_required", "position_changed", "agent_caller"] {
            let text = format!(r#"{{"ok":false,"op":"apply-request","id":4,"code":"{code}","detail":"/secret"}}"#);
            let request = json!({"op": "apply_request", "id": "4", "on": true, "confirmed": true, "confirm": DIGEST, "token": t});
            let recorded = Cell::new(0);
            let reply = act_with(request, true, TAG, || Ok(()), |_| said(1, &text), || true, |_| {
                recorded.set(recorded.get() + 1);
                said(0, r#"{"ok":true}"#)
            }, || {});
            assert_eq!((reply, recorded.get()), (failure(code), 0), "{code}");
        }
    }

    #[test]
    fn the_action_log_names_an_authorisation_and_its_withdrawal_by_the_position_number_only() {
        assert_eq!(log_event(&json!({"op": "apply_request", "id": "4", "on": true, "confirmed": true, "confirm": "x"})), Some(("position.apply_authorize", 4)));
        assert_eq!(log_event(&json!({"op": "apply_request", "id": "4", "on": false})), Some(("position.apply_revoke", 4)));
        assert_eq!(log_event(&json!({"op": "apply_preview", "id": "4"})), None);
        assert_eq!(log_event(&json!({"op": "apply_request", "id": "4"})), None);
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
    fn only_an_exclusion_or_putting_it_back_is_named_in_the_action_log_and_by_a_whole_number() {
        assert_eq!(log_event(&json!({"op": "exclude", "id": "12", "reason": "other", "note": "private", "token": "t"})), Some(("exclusion.decide", 12)));
        assert_eq!(log_event(&json!({"op": "restore", "id": "7", "token": "t"})), Some(("exclusion.withdraw", 7)));
        for request in [
            json!({"op": "feedback", "id": "12", "value": "like"}),
            json!({"op": "user_note", "id": "12", "body": "private"}),
            json!({"op": "ticket", "id": "12", "kind": "free", "text": "private"}),
            json!({"op": "exclude", "id": "012"}),
            json!({"op": "exclude", "id": 12}),
            json!({"op": "exclude"}),
            json!({"id": "12"}),
        ] {
            assert_eq!(log_event(&request), None, "{request}");
        }
    }

    #[test]
    fn the_script_turns_the_cloud_off_runs_nothing_but_the_teams_judgement_and_knows_only_these_operations() {
        assert!(ACT_PY.contains("feedback_record.api_request=lambda *args,**kwargs:(False,'cloud-disabled')"));
        assert!(ACT_PY.contains("PATH='/app/shared/skills/position_judgement.py'"));
        for forbidden in ["subprocess", "os.system", "eval(", "socket", "urllib", "requests"] {
            assert!(!ACT_PY.contains(forbidden), "{forbidden}");
        }
        let fields = ACT_PY.split("FIELDS={").nth(1).unwrap().split('\n').next().unwrap();
        for op in ["feedback", "exclude", "restore", "recheck", "geocode", "write_request", "user_note", "ticket", "mark_applied", "outcome", "outcome_undo", "apply_preview", "apply_request"] {
            assert!(fields.contains(&format!("'{op}':")), "{op}");
        }
        // the authorisation to apply is here, with the preview it needs; the host records it in the broker too
        assert!(fields.contains("'apply_preview':") && fields.contains("'apply_request':"));
    }
}

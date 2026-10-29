//! How far the candidate profile is from what the team needs to start: the eight required fields and whether each is
//! there, read from the team's own `candidate_profile.yml`.
//!
//! The rule is not the app's: the team answers with `shared/skills/validate_profile.py::team_minimum_missing`, the
//! function the Assistant's skill, the web and the game's wizard already agree with (the list is
//! `shared/config/profile-minimum.json`). The app asks through the chat's Python channel with a fixed script of its
//! own and closes the answer again here: the eight keys in the order of the badge, an `ok` for each, a short preview
//! for the five that are not contacts, a count for skills and languages. The email is never previewed. Only the main
//! window asks. It is a read, so it works in the read-only view.
use crate::{
    account_scope::AccountScopeState,
    direct_chat::{failure, team_script_read, DirectChatError, DirectChatState},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

const TIMEOUT: Duration = Duration::from_secs(40);
/// The required fields, in the order of the badge (`shared/config/profile-minimum.json`).
const KEYS: [&str; 8] = ["name", "email", "target_role", "location", "experience_years", "seniority_target", "skills", "languages"];
/// The ones whose value may be shown in the card. The email is a contact and never leaves.
const PREVIEW_KEYS: [&str; 5] = ["name", "target_role", "location", "seniority_target", "experience_years"];
const COUNT_KEYS: [&str; 2] = ["skills", "languages"];
const PREVIEW_MAX: usize = 60;
const COUNT_MAX: u64 = 10_000;

/// The fixed script: loads the team's own `validate_profile.py` and answers one JSON. An image older than the
/// feature has no such function, or no profile yet: `profile_unavailable`; a file that is not YAML: `profile_unreadable`.
/// `JHT_HOME` and `JHT_APP` are the image's own (`/jht_home`, `/app`); a test points them elsewhere.
const PROFILE_PROGRESS_PY: &str = r#"import importlib.util,json,os,sys
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
def unavailable(): emit({'ok':False,'error':'profile_unavailable'})
try: req=json.loads(sys.stdin.readline())
except Exception: unavailable()
if req!={'op':'read'}: unavailable()
home=os.environ.get('JHT_HOME') or '/jht_home'
skills=(os.environ.get('JHT_APP') or '/app')+'/shared/skills'
checker=skills+'/validate_profile.py'
profile=home+'/profile/candidate_profile.yml'
if not os.path.isfile(checker) or not os.path.isfile(profile): unavailable()
try:
 import yaml
 sys.path.append(skills)
 spec=importlib.util.spec_from_file_location('validate_profile',checker); mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
 if not hasattr(mod,'team_minimum_missing'): unavailable()
except SystemExit: raise
except Exception: unavailable()
try:
 if os.path.getsize(profile)>1048576: emit({'ok':False,'error':'profile_unreadable'})
 with open(profile,encoding='utf-8') as handle: data=yaml.safe_load(handle)
except SystemExit: raise
except Exception: emit({'ok':False,'error':'profile_unreadable'})
if data is None or data=={}: unavailable()
if not isinstance(data,dict): emit({'ok':False,'error':'profile_unreadable'})
try: missing=mod.team_minimum_missing(data)
except Exception: emit({'ok':False,'error':'profile_unreadable'})
def mapping(value): return value if isinstance(value,dict) else {}
cand=mapping(data.get('candidate')); pers=mapping(data.get('personal')); pos=mapping(data.get('positioning'))
def first(*values):
 for value in values:
  if isinstance(value,str) and value.strip(): return value.strip()
roles=data.get('target_roles')
years=data.get('experience_years')
shown={'name':first(cand.get('name'),pers.get('name'),data.get('name')),
 'target_role':first(cand.get('target_role'),data.get('target_role'),roles[0] if isinstance(roles,list) and roles else None),
 'location':first(data.get('location'),pers.get('location')),
 'seniority_target':first(data.get('seniority_target'),pos.get('seniority_target')),
 'experience_years':str(years) if isinstance(years,(int,float)) and not isinstance(years,bool) else None}
def counted(name):
 try:
  if name=='skills': return int(mod._skill_count(cand.get('skills') if cand.get('skills') is not None else data.get('skills')))
  return int(mod._items(cand.get('languages'),data.get('languages')))
 except Exception: return 0
rows=[]
for key in ('name','email','target_role','location','experience_years','seniority_target','skills','languages'):
 row={'key':key,'ok':key not in missing}
 if key in shown and shown[key]: row['preview']=''.join(c for c in shown[key] if c.isprintable())[:60]
 if key in ('skills','languages'): row['count']=counted(key)
 rows.append(row)
emit({'ok':True,'fields':rows})
"#;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileField {
    key: &'static str,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    count: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileProgress {
    required: usize,
    done: usize,
    ready: bool,
    fields: Vec<ProfileField>,
}

/// What the page gets: `ok: true` and the closed fields, or `ok: false` and a closed code.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProgressReply {
    ok: bool,
    #[serde(flatten, skip_serializing_if = "Option::is_none")]
    progress: Option<ProfileProgress>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'static str>,
}

impl ProgressReply {
    fn failed(code: &'static str) -> Self {
        ProgressReply { ok: false, progress: None, error: Some(code) }
    }
}

/// A preview the card may show: short, one line, printable, not empty. Anything else is left out (the row stays,
/// without the preview).
fn preview_of(value: Option<&Value>) -> Option<String> {
    let text = value?.as_str()?;
    (!text.is_empty() && text.chars().count() <= PREVIEW_MAX && !text.chars().any(|c| c.is_control() || is_format_char(c))).then(|| text.to_owned())
}

/// The invisible characters of category Cf that change how a line reads (zero-width, direction marks and overrides,
/// the word joiner, the byte order mark, the soft hyphen): a value of the team's own file that carries one is not shown.
fn is_format_char(c: char) -> bool {
    matches!(c, '\u{00AD}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{206F}' | '\u{FEFF}')
}

/// The team's answer closed again: the eight keys in order, an `ok` for each, previews only for the five that may
/// have one, counts only for skills and languages, or the whole answer is refused.
fn shape(reply: &Value) -> Result<ProfileProgress, ()> {
    let rows = reply.get("fields").and_then(Value::as_array).ok_or(())?;
    if rows.len() != KEYS.len() {
        return Err(());
    }
    let mut fields = Vec::with_capacity(KEYS.len());
    for (key, row) in KEYS.iter().zip(rows) {
        let row = row.as_object().ok_or(())?;
        if row.get("key").and_then(Value::as_str) != Some(*key) {
            return Err(());
        }
        let ok = row.get("ok").and_then(Value::as_bool).ok_or(())?;
        let count = if COUNT_KEYS.contains(key) {
            Some(row.get("count").and_then(Value::as_u64).filter(|n| *n <= COUNT_MAX).ok_or(())?)
        } else {
            None
        };
        let preview = if PREVIEW_KEYS.contains(key) { preview_of(row.get("preview")) } else { None };
        fields.push(ProfileField { key, ok, preview, count });
    }
    let done = fields.iter().filter(|field| field.ok).count();
    Ok(ProfileProgress { required: KEYS.len(), done, ready: done == KEYS.len(), fields })
}

/// A failure of the team's script is one of two words; anything else is «unavailable».
fn code_of(reply: &Value) -> &'static str {
    match reply.get("error").and_then(Value::as_str) {
        Some("profile_unreadable") => "profile_unreadable",
        _ => "profile_unavailable",
    }
}

/// How far the candidate profile is from what the team needs to start. Reads: it works in the read-only view.
#[tauri::command]
pub(crate) async fn profile_progress_read(
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<ProgressReply, DirectChatError> {
    if window.label() != "main" {
        return Err(failure("invalid_request"));
    }
    let reply = team_script_read(&state, &scopes, PROFILE_PROGRESS_PY, json!({"op": "read"}), TIMEOUT).await?;
    if reply.get("ok") != Some(&Value::Bool(true)) {
        return Ok(ProgressReply::failed(code_of(&reply)));
    }
    Ok(match shape(&reply) {
        Ok(progress) => ProgressReply { ok: true, progress: Some(progress), error: None },
        Err(()) => ProgressReply::failed("profile_unavailable"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(ok_from: usize) -> Value {
        let fields: Vec<Value> = KEYS
            .iter()
            .enumerate()
            .map(|(i, key)| {
                let mut row = json!({"key": key, "ok": i < ok_from});
                if PREVIEW_KEYS.contains(key) && i < ok_from {
                    row["preview"] = json!(format!("valore {key}"));
                }
                if COUNT_KEYS.contains(key) {
                    row["count"] = json!(if i < ok_from { 3 } else { 0 });
                }
                row
            })
            .collect();
        json!({"ok": true, "fields": fields})
    }

    #[test]
    fn the_answer_is_the_eight_keys_in_order_with_what_is_done_counted_here() {
        let shown = serde_json::to_value(ProgressReply { ok: true, progress: Some(shape(&rows(5)).unwrap()), error: None }).unwrap();
        assert_eq!(shown["ok"], true);
        assert_eq!((shown["required"].as_u64(), shown["done"].as_u64(), shown["ready"].as_bool()), (Some(8), Some(5), Some(false)));
        let keys: Vec<_> = shown["fields"].as_array().unwrap().iter().map(|row| row["key"].as_str().unwrap().to_owned()).collect();
        assert_eq!(keys, KEYS);
        let full = shape(&rows(8)).unwrap();
        assert!(full.ready && full.done == 8);
        assert!(!shape(&rows(0)).unwrap().ready);
        // the card does not recalculate the rule, and the done count is not taken from the team
        let mut lying = rows(3);
        lying["done"] = json!(8);
        lying["ready"] = json!(true);
        let honest = shape(&lying).unwrap();
        assert_eq!((honest.done, honest.ready), (3, false));
    }

    #[test]
    fn a_preview_is_only_for_the_five_and_the_email_is_never_shown() {
        let mut reply = rows(8);
        reply["fields"][1]["preview"] = json!("persona@example.invalid");
        reply["fields"][6]["preview"] = json!("Python, SQL");
        reply["fields"][7]["preview"] = json!("Italiano");
        let shown = serde_json::to_string(&shape(&reply).unwrap()).unwrap();
        assert!(!shown.contains("example.invalid") && !shown.contains("Python") && !shown.contains("Italiano"), "{shown}");
        let parsed = shape(&reply).unwrap();
        assert!(parsed.fields[0].preview.is_some() && parsed.fields[1].preview.is_none());
        assert!(parsed.fields[6].preview.is_none() && parsed.fields[6].count == Some(3));
    }

    #[test]
    fn a_preview_that_cannot_be_shown_is_left_out_and_the_row_stays() {
        for bad in [json!(""), json!("a\nb"), json!("Maria\u{202E}gnirts"), json!("zero\u{200B}width"), json!("\u{FEFF}bom"), json!("iso\u{2066}lated"), json!("x".repeat(PREVIEW_MAX + 1)), json!(7), json!(null), json!("tab\there")] {
            let mut reply = rows(8);
            reply["fields"][0]["preview"] = bad.clone();
            let parsed = shape(&reply).unwrap();
            assert!(parsed.fields[0].preview.is_none() && parsed.fields[0].ok, "{bad}");
        }
        let mut longest = rows(8);
        longest["fields"][0]["preview"] = json!("x".repeat(PREVIEW_MAX));
        assert_eq!(shape(&longest).unwrap().fields[0].preview.as_deref().map(str::len), Some(PREVIEW_MAX));
    }

    #[test]
    fn an_answer_that_is_not_the_eight_rows_in_order_is_refused_whole() {
        let mut few = rows(8);
        few["fields"].as_array_mut().unwrap().pop();
        let mut many = rows(8);
        many["fields"].as_array_mut().unwrap().push(json!({"key": "name", "ok": true}));
        let mut shuffled = rows(8);
        shuffled["fields"].as_array_mut().unwrap().swap(0, 1);
        let mut renamed = rows(8);
        renamed["fields"][2]["key"] = json!("target");
        let mut not_bool = rows(8);
        not_bool["fields"][3]["ok"] = json!("yes");
        let mut no_count = rows(8);
        no_count["fields"][6].as_object_mut().unwrap().remove("count");
        let mut huge = rows(8);
        huge["fields"][7]["count"] = json!(COUNT_MAX + 1);
        let mut negative = rows(8);
        negative["fields"][7]["count"] = json!(-1);
        for (name, reply) in [("few", few), ("many", many), ("shuffled", shuffled), ("renamed", renamed), ("not_bool", not_bool), ("no_count", no_count), ("huge", huge), ("negative", negative)] {
            assert!(shape(&reply).is_err(), "{name}");
        }
        assert!(shape(&json!({"ok": true})).is_err() && shape(&json!("fields")).is_err() && shape(&json!({"fields": "x"})).is_err());
    }

    #[test]
    fn a_failure_is_one_of_two_words_and_nothing_else() {
        assert_eq!(code_of(&json!({"ok": false, "error": "profile_unreadable"})), "profile_unreadable");
        assert_eq!(code_of(&json!({"ok": false, "error": "profile_unavailable"})), "profile_unavailable");
        assert_eq!(code_of(&json!({"ok": false, "error": "rm -rf / or a sentence"})), "profile_unavailable");
        assert_eq!(code_of(&json!({"ok": false})), "profile_unavailable");
        assert_eq!(serde_json::to_value(ProgressReply::failed("profile_unreadable")).unwrap(), json!({"ok": false, "error": "profile_unreadable"}));
    }

    #[test]
    fn the_command_takes_nothing_from_the_page_and_only_the_main_window_asks() {
        let code = include_str!("profile_progress.rs");
        let command = code.split("pub(crate) async fn profile_progress_read(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(command.contains("team_script_read(") && !command.contains("team_script_write("), "a read");
        let signature = command.split(") -> Result").next().unwrap();
        assert!(!signature.contains("String") && !signature.contains("Value") && !signature.contains("u32"), "no argument from the page");
        assert!(command.contains("window.label() != \"main\""));
        let lib = include_str!("lib.rs");
        assert!(lib.contains("mod profile_progress;") && lib.contains("profile_progress::profile_progress_read,"));
    }

    #[test]
    fn the_script_asks_for_one_thing_runs_nothing_the_page_names_and_the_keys_are_the_shared_ones() {
        assert!(PROFILE_PROGRESS_PY.contains("req!={'op':'read'}"));
        assert!(PROFILE_PROGRESS_PY.contains("team_minimum_missing"));
        for forbidden in ["subprocess", "os.system", "eval(", "exec(", "open(profile,'w"] {
            assert!(!PROFILE_PROGRESS_PY.contains(forbidden), "{forbidden}");
        }
        // the eight keys of the script are the list of this file, which is the shared one
        let shared: Value = serde_json::from_str(include_str!("../../../shared/config/profile-minimum.json")).unwrap();
        let required: Vec<&str> = shared["required"].as_array().unwrap().iter().map(|key| key.as_str().unwrap()).collect();
        assert_eq!(required, KEYS);
        let listed = KEYS.iter().map(|key| format!("'{key}'")).collect::<Vec<_>>().join(",");
        assert!(PROFILE_PROGRESS_PY.contains(&listed), "{listed}");
    }
}

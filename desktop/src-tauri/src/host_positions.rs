//! The reads of the positions that the app makes by itself, from the saved data of a team that is off.
//!
//! The same closed answers the script of `existing_team_runtime.rs` gives for a running team (`facets`, `piles`,
//! `stats`, then `list` and `detail`), made here from the private copy of `jobs.db` that `host_db` takes. Nothing
//! is invented: every answer has the shape the script gives, and `tests` run the script itself, with python3,
//! on the same database and compare the two answers value by value.
//!
//! What differs, on purpose, because the file is hostile and not the team's own:
//! - every query has a `LIMIT` (the script's `facets` and `events` had none; the answers are the same up to it);
//! - a text that is not UTF-8 is read with replacement characters, where the script fails;
//! - a stamp that is not text is not a stamp (the script would raise on comparing it).
#![allow(dead_code)] // the plumbing of the next piece is the caller

use crate::host_db::{self, HostDb};
use rusqlite::{types::ValueRef, Connection, ToSql};
use serde_json::{json, Map, Number, Value};
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

type Dict = Map<String, Value>;

/// The most rows `facets` reads: past it the answer is the first rows by id.
const FACET_ROWS: usize = 100_000;
/// The rows the bulk read of scores and applications may take (the script reads them all).
const BULK_ROWS: usize = 500_000;
const POINTS: usize = 2000;
const EVENTS: usize = 3000;
/// The reply is cut to this many bytes once serialized as the script does (non-ASCII as `\uXXXX`).
const BUDGET: usize = 1_363_148;
const LIVE: &str = "(p.status IS NULL OR p.status!='excluded')";
const DASH_COLUMNS: [&str; 20] = [
    "id",
    "legacy_id",
    "title",
    "company",
    "location",
    "remote_type",
    "status",
    "role_family",
    "loc_country",
    "loc_city",
    "source",
    "found_at",
    "found_by",
    "last_checked",
    "salary_declared_min",
    "salary_declared_max",
    "salary_declared_currency",
    "salary_estimated_min",
    "salary_estimated_max",
    "salary_estimated_currency",
];

const SCORE_COLUMNS: [&str; 12] = [
    "id", "position_id", "total_score", "stack_match", "remote_fit", "salary_fit", "experience_fit", "strategic_fit", "breakdown", "notes", "scored_by", "scored_at",
];
const APPLICATION_COLUMNS: [&str; 22] = [
    "id", "position_id", "cv_path", "cl_path", "cv_pdf_path", "cl_pdf_path", "cv_drive_id", "cl_drive_id", "critic_verdict", "critic_score", "critic_notes", "status",
    "written_at", "applied_at", "applied_via", "response", "response_at", "written_by", "reviewed_by", "applied", "interview_round", "critic_reviewed_at",
];
const COMPANY_COLUMNS: [&str; 14] =
    ["id", "name", "website", "hq_country", "sector", "size", "glassdoor_rating", "red_flags", "culture_notes", "analyzed_by", "analyzed_at", "verdict", "logo", "about"];
const TICKET_COLUMNS: [&str; 9] = ["id", "position_id", "request_text", "kind", "status", "assigned_agent", "response_text", "created_at", "resolved_at"];
const HIGHLIGHT_COLUMNS: [&str; 4] = ["id", "position_id", "type", "text"];
const POSITION_COLUMNS: [&str; 44] = [
    "id", "legacy_id", "title", "company", "company_id", "location", "remote_type", "salary_declared_min", "salary_declared_max", "salary_declared_currency",
    "salary_estimated_min", "salary_estimated_max", "salary_estimated_currency", "salary_estimated_source", "url", "source", "jd_text", "jd_summary", "scam_signals",
    "requirements", "found_by", "found_at", "deadline", "status", "notes", "last_checked", "role_family", "loc_country", "loc_city", "write_requested",
    "write_requested_at", "write_request_kind", "geocode_requested", "geocode_requested_at", "office_geocoded", "user_excluded_reason", "user_excluded_note",
    "user_excluded_at", "user_excluded_prev_status", "recheck_requested", "recheck_requested_at", "apply_requested", "apply_requested_at", "apply_requested_by",
];

/// The columns of `names` that `table` has, as a SELECT list: never `*`, never a name that comes from the file.
fn select_list(c: &Connection, table: &str, names: &[&str]) -> rusqlite::Result<String> {
    let present = columns(c, table)?;
    let list: Vec<&str> = names.iter().copied().filter(|n| present.contains(*n)).collect();
    Ok(if list.is_empty() { "NULL AS none".to_string() } else { list.join(", ") })
}

fn cell(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    }
}

/// The rows of `sql` as dictionaries by column name (the last of two columns with one name wins, as `dict(row)`).
fn dicts(c: &Connection, sql: &str, params: &[&dyn ToSql]) -> rusqlite::Result<Vec<Dict>> {
    let mut statement = c.prepare(sql)?;
    let names: Vec<String> = statement.column_names().map(|n| n.to_string()).collect();
    let mut rows = statement.query(params)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut dict = Dict::new();
        for (i, name) in names.iter().enumerate() {
            dict.insert(name.clone(), cell(row.get_ref(i)?));
        }
        out.push(dict);
    }
    Ok(out)
}

fn columns(c: &Connection, table: &str) -> rusqlite::Result<HashSet<String>> {
    // `table` is one of the three fixed names of this module, never a text from the file or the page
    debug_assert!(matches!(
        table,
        "positions" | "scores" | "applications" | "companies" | "position_highlights" | "position_tickets" | "position_user_notes" | "position_state_transitions"
    ));
    let mut statement = c.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = statement.query_map([], |row| row.get::<_, String>(1))?.collect::<rusqlite::Result<HashSet<_>>>()?;
    Ok(names)
}

/// Python's `str(value)` for what the script turns into an id.
fn sid(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => match n.as_i64() {
            Some(i) => i.to_string(),
            None => {
                let f = n.as_f64().unwrap_or(0.0);
                if f.fract() == 0.0 && f.abs() < 1e16 {
                    format!("{f:.1}")
                } else {
                    f.to_string()
                }
            }
        },
        Some(other) => other.to_string(),
    }
}

fn nullable(row: &Dict, key: &str) -> Value {
    row.get(key).cloned().unwrap_or(Value::Null)
}

fn number(value: &Value) -> Value {
    if value.is_number() {
        value.clone()
    } else {
        Value::Null
    }
}

fn trunc(value: &Value, size: usize) -> Value {
    match value {
        Value::String(s) => Value::String(s.chars().take(size).collect()),
        other => other.clone(),
    }
}

fn is_null(value: &Value) -> bool {
    value.is_null()
}

/// Python's truthiness for what `x or default` is applied to here.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64().map(|f| f != 0.0).unwrap_or(true),
        Value::Bool(b) => *b,
        _ => true,
    }
}

/// The salary of a position: the declared one when any of its two ends is, else the estimated one.
fn salary(row: &Dict) -> (Value, Value, Value) {
    let declared = !is_null(&nullable(row, "salary_declared_min")) || !is_null(&nullable(row, "salary_declared_max"));
    if declared {
        (nullable(row, "salary_declared_min"), nullable(row, "salary_declared_max"), nullable(row, "salary_declared_currency"))
    } else {
        (nullable(row, "salary_estimated_min"), nullable(row, "salary_estimated_max"), nullable(row, "salary_estimated_currency"))
    }
}

/// A row of the dashboard: the position with its first score and its first application, and the last thing done to it.
fn dash_row(raw: &Dict, score: Option<&Dict>, application: Option<&Dict>) -> Value {
    let sal = salary(raw);
    let scored_at = score.map(|s| nullable(s, "scored_at")).unwrap_or(Value::Null);
    let written_by = application.map(|a| nullable(a, "written_by")).unwrap_or(Value::Null);
    let by_score = score.map(|s| nullable(s, "scored_by")).unwrap_or(Value::Null);
    let app = |key: &str| application.map(|a| nullable(a, key)).unwrap_or(Value::Null);
    let candidates: [(Value, &str, Value); 7] = [
        (nullable(raw, "found_at"), "scout", nullable(raw, "found_by")),
        (nullable(raw, "last_checked"), "analista", Value::String("analista".into())),
        (scored_at.clone(), "scorer", by_score),
        (app("written_at"), "scrittore", written_by.clone()),
        (app("critic_reviewed_at"), "scrittore", written_by),
        (app("applied_at"), "user", Value::String("user".into())),
        (app("response_at"), "user", Value::String("user".into())),
    ];
    let mut best: Option<(String, &str, Value)> = None;
    for (stamp, by, actor) in candidates {
        if let Value::String(text) = &stamp {
            if !text.is_empty() && best.as_ref().map(|b| text.as_str() > b.0.as_str()).unwrap_or(true) {
                let actor = if truthy(&actor) { actor } else { Value::String(by.into()) };
                best = Some((text.clone(), by, actor));
            }
        }
    }
    let (at, by, actor) = match best {
        Some((at, by, actor)) => (Value::String(at), by, actor),
        None => (Value::String(String::new()), "scout", Value::String("scout".into())),
    };
    let last_action_at = if truthy(&at) {
        at
    } else if truthy(&nullable(raw, "found_at")) {
        nullable(raw, "found_at")
    } else {
        Value::String(String::new())
    };
    json!({
        "id": sid(raw.get("id")),
        "legacy_id": nullable(raw, "legacy_id"),
        "title": trunc(&nullable(raw, "title"), 120),
        "company": trunc(&nullable(raw, "company"), 80),
        "location": trunc(&nullable(raw, "location"), 80),
        "remote_type": nullable(raw, "remote_type"),
        "status": nullable(raw, "status"),
        "score": score.map(|s| number(&nullable(s, "total_score"))).unwrap_or(Value::Null),
        "role_family": trunc(&nullable(raw, "role_family"), 60),
        "loc_country": trunc(&nullable(raw, "loc_country"), 40),
        "loc_city": trunc(&nullable(raw, "loc_city"), 60),
        "source": trunc(&nullable(raw, "source"), 60),
        "salary_min": number(&sal.0),
        "salary_max": number(&sal.1),
        "salary_currency": if truthy(&sal.2) { sal.2 } else { Value::String("EUR".into()) },
        "found_at": nullable(raw, "found_at"),
        "scored_at": scored_at,
        "last_action_at": last_action_at,
        "last_action_by": by,
        "last_action_actor": actor,
        "critic_score": application.map(|a| number(&nullable(a, "critic_score"))).unwrap_or(Value::Null),
        "critic_verdict": application.map(|a| nullable(a, "critic_verdict")).unwrap_or(Value::Null),
    })
}

/// The first row (by rowid) of `table` for each position, with only the named columns that the table has.
fn first_by_position(c: &Connection, table: &str, names: &[&str]) -> rusqlite::Result<HashMap<String, Dict>> {
    let present = columns(c, table)?;
    let mut select = vec!["position_id".to_string()];
    select.extend(names.iter().filter(|n| present.contains(**n)).map(|n| n.to_string()));
    let sql = format!("SELECT {} FROM {table} ORDER BY rowid LIMIT {BULK_ROWS}", select.join(", "));
    let mut found: HashMap<String, Dict> = HashMap::new();
    for row in dicts(c, &sql, &[])? {
        found.entry(sid(row.get("position_id"))).or_insert(row);
    }
    Ok(found)
}

/// The script's `one` and `many` swallow the errors of a table or a column that is not there; a limit, an interrupt
/// or a damaged file are still errors here.
fn soft<T: Default>(result: rusqlite::Result<T>) -> rusqlite::Result<T> {
    match result {
        Err(rusqlite::Error::SqliteFailure(failure, _)) if failure.code == rusqlite::ErrorCode::Unknown => Ok(T::default()),
        other => other,
    }
}

fn one(c: &Connection, table: &str, id: &Value) -> rusqlite::Result<Option<Dict>> {
    debug_assert!(matches!(table, "scores" | "applications"));
    let names: &[&str] = if table == "scores" { &SCORE_COLUMNS } else { &APPLICATION_COLUMNS };
    let sql = format!("SELECT {} FROM {table} WHERE position_id=?1 ORDER BY rowid LIMIT 1", select_list(c, table, names)?);
    Ok(by_key(c, &sql, id)?.into_iter().next())
}

/// The rows of `sql` (one parameter, `?1`) for a key that is a number or a text, as the script passes it.
fn by_key(c: &Connection, sql: &str, key: &Value) -> rusqlite::Result<Vec<Dict>> {
    soft(match key {
        Value::Number(n) if n.is_i64() => dicts(c, sql, &[&n.as_i64().unwrap_or(0)]),
        Value::Number(n) => dicts(c, sql, &[&n.as_f64().unwrap_or(0.0)]),
        Value::String(s) => dicts(c, sql, &[s]),
        _ => Ok(Vec::new()),
    })
}

fn dash_rows(c: &Connection, sql: &str) -> rusqlite::Result<Vec<Value>> {
    let raws = dicts(c, sql, &[])?;
    let bulk = raws.len() > 50;
    let scores = if bulk { Some(first_by_position(c, "scores", &["total_score", "scored_at", "scored_by"])?) } else { None };
    let applications = if bulk {
        Some(first_by_position(
            c,
            "applications",
            &["critic_score", "critic_verdict", "written_at", "written_by", "critic_reviewed_at", "applied_at", "response_at"],
        )?)
    } else {
        None
    };
    let mut out = Vec::with_capacity(raws.len());
    for raw in &raws {
        let id = raw.get("id").cloned().unwrap_or(Value::Null);
        let key = sid(raw.get("id"));
        let (score, application) = match (&scores, &applications) {
            (Some(s), Some(a)) => (s.get(&key).cloned(), a.get(&key).cloned()),
            _ => (one(c, "scores", &id)?, one(c, "applications", &id)?),
        };
        out.push(dash_row(raw, score.as_ref(), application.as_ref()));
    }
    Ok(out)
}

/// The byte size of a value once serialized as the script does it: compact, every non-ASCII character as `\uXXXX`.
fn ascii_json_len(value: &Value) -> usize {
    let text = serde_json::to_string(value).unwrap_or_default();
    text.chars().map(|ch| if ch.is_ascii() { 1 } else if (ch as u32) < 0x10000 { 6 } else { 12 }).sum()
}

/// Something the readers can ask: the copy of a team's jobs.db, or the empty team of one that never ran.
pub(crate) trait Reads {
    fn read<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, &'static str>;
}

impl Reads for HostDb {
    fn read<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, &'static str> {
        HostDb::read(self, f)
    }
}

/// What the script reads when a team has never run (no jobs.db yet): three empty tables, so the answers are zeros and empty lists.
const EMPTY_SCHEMA: &str = "CREATE TABLE positions(id INTEGER PRIMARY KEY,status TEXT,title TEXT,company TEXT,role_family TEXT,loc_country TEXT,loc_city TEXT,source TEXT,found_at TEXT);CREATE TABLE scores(position_id INTEGER,total_score INTEGER);CREATE TABLE applications(position_id INTEGER,critic_score INTEGER);PRAGMA query_only=ON;";

pub(crate) struct EmptyDb(Connection);

impl EmptyDb {
    pub(crate) fn new() -> Option<EmptyDb> {
        let conn = Connection::open_in_memory().ok()?;
        conn.execute_batch(EMPTY_SCHEMA).ok()?;
        Some(EmptyDb(conn))
    }
}

impl Reads for EmptyDb {
    fn read<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, &'static str> {
        f(&self.0).map_err(|_| "host_db_invalid")
    }
}

fn ok(data: Value) -> Value {
    json!({"ok": true, "data": data})
}

/// `facets`: one light row per position, for the filters of the list.
pub(crate) fn facets(db: &impl Reads) -> Result<Value, &'static str> {
    db.read(|c| {
        let sql = format!(
            "SELECT p.id,p.status,p.title,p.company,p.role_family,p.loc_country,p.loc_city,s.total_score,a.critic_score,p.source \
             FROM positions p LEFT JOIN scores s ON s.position_id=p.id LEFT JOIN applications a ON a.position_id=p.id ORDER BY p.id LIMIT {FACET_ROWS}"
        );
        let mut statement = c.prepare(&sql)?;
        let mut rows = statement.query([])?;
        let mut items = Vec::new();
        while let Some(row) = rows.next()? {
            let at = |i: usize| -> rusqlite::Result<Value> { Ok(cell(row.get_ref(i)?)) };
            items.push(json!({
                "id": sid(Some(&at(0)?)), "status": at(1)?, "title": at(2)?, "company": at(3)?, "role_family": at(4)?,
                "loc_country": at(5)?, "loc_city": at(6)?, "score": at(7)?, "critic_score": at(8)?, "source": at(9)?,
            }));
        }
        Ok(ok(json!({"items": items})))
    })
}

/// `piles`: five counts of the phases the office draws as piles.
pub(crate) fn piles(db: &impl Reads) -> Result<Value, &'static str> {
    db.read(|c| {
        let positions = columns(c, "positions")?;
        let applications = columns(c, "applications")?;
        let requested = if positions.contains("write_requested") { "COALESCE(p.write_requested,0)" } else { "0" };
        let joined = if applications.contains("critic_verdict") && applications.contains("position_id") {
            "LEFT JOIN (SELECT position_id,critic_verdict FROM applications WHERE rowid IN (SELECT MIN(rowid) FROM applications GROUP BY position_id)) a ON a.position_id=p.id"
        } else {
            ""
        };
        let passed = if joined.is_empty() { "0" } else { "COALESCE(lower(a.critic_verdict)='pass',0)" };
        let sql = format!(
            "SELECT SUM(p.status='new'),SUM(p.status='checked'),SUM(p.status='scored' AND NOT {requested}),SUM(p.status='review' OR (p.status='ready' AND NOT {passed})),SUM(p.status='ready' AND {passed}) FROM positions p {joined}"
        );
        let counts: Vec<i64> = c.query_row(&sql, [], |row| {
            (0..5).map(|i| Ok(row.get::<_, Option<i64>>(i)?.unwrap_or(0))).collect::<rusqlite::Result<Vec<i64>>>()
        })?;
        Ok(ok(json!({"scout": counts[0], "analisti": counts[1], "scorer": counts[2], "scrittori": counts[3], "critici": counts[4]})))
    })
}

fn count_of(map: &HashMap<Option<String>, i64>, key: &str) -> i64 {
    map.get(&Some(key.to_string())).copied().unwrap_or(0)
}

/// `stats`: the numbers of the dashboard and the rows it draws, cut to a byte budget as the script does.
pub(crate) fn stats(db: &impl Reads) -> Result<Value, &'static str> {
    db.read(|c| {
        let positions = columns(c, "positions")?;
        let mut counts: HashMap<Option<String>, i64> = HashMap::new();
        {
            let mut statement = c.prepare("SELECT status,COUNT(*) FROM positions GROUP BY status")?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                let status = match cell(row.get_ref(0)?) {
                    Value::String(s) => Some(s),
                    Value::Null => None,
                    other => Some(other.to_string()),
                };
                *counts.entry(status).or_insert(0) += row.get::<_, i64>(1)?;
            }
        }
        let total: i64 = counts.values().sum();
        let excluded = count_of(&counts, "excluded");
        let active = total - excluded;
        let (mut requested, mut requested_scored) = (0i64, 0i64);
        if positions.contains("write_requested") {
            requested = c.query_row("SELECT COUNT(*) FROM positions WHERE write_requested AND status IN ('scored','writing','review')", [], |r| r.get(0))?;
            requested_scored = c.query_row("SELECT COUNT(*) FROM positions WHERE write_requested AND status='scored'", [], |r| r.get(0))?;
        }
        let stats = json!({
            "total": total, "new": count_of(&counts, "new"), "checked": count_of(&counts, "checked"), "scored": count_of(&counts, "scored"),
            "writing": count_of(&counts, "writing"), "review": count_of(&counts, "review"), "ready": count_of(&counts, "ready"),
            "applied": count_of(&counts, "applied"), "excluded": excluded, "response": count_of(&counts, "response"),
            "scored_open": count_of(&counts, "scored") - requested_scored, "to_write": requested,
        });
        let scores = columns(c, "scores")?;
        // the scores above zero of the positions that are not excluded: whole numbers, or decimals, in the order the file gives them
        let mut scored: Vec<f64> = Vec::new();
        let mut all_integers = true;
        let mut integer_sum: i128 = 0;
        if scores.contains("total_score") {
            let sql = format!("SELECT s.total_score FROM positions p JOIN scores s ON s.position_id=p.id WHERE {LIVE} AND s.total_score>0 LIMIT {BULK_ROWS}");
            let mut statement = c.prepare(&sql)?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                match row.get_ref(0)? {
                    ValueRef::Integer(i) => {
                        integer_sum += i as i128;
                        scored.push(i as f64);
                    }
                    ValueRef::Real(f) => {
                        all_integers = false;
                        scored.push(f);
                    }
                    _ => return Err(rusqlite::Error::InvalidQuery), // the script cannot add a text to a number either
                }
            }
        }
        let average = if scored.is_empty() {
            Value::Null
        } else {
            let sum = if all_integers { integer_sum as f64 } else { scored.iter().fold(0.0, |a, b| a + b) };
            json!((sum / scored.len() as f64 + 0.5) as i64)
        };
        let buckets: Vec<Value> = [(76, 100), (61, 75), (41, 60), (0, 40)]
            .iter()
            .map(|(lo, hi)| json!({"min": lo, "max": hi, "count": scored.iter().filter(|v| (*lo as f64) <= **v && **v <= (*hi as f64)).count()}))
            .collect();
        let distribution = json!({"active": active, "withScore": scored.len(), "avgScore": average, "buckets": buckets});
        let mut sources = Vec::new();
        {
            let sql = format!("SELECT source,COUNT(*) AS n FROM positions p WHERE {LIVE} GROUP BY source ORDER BY n DESC LIMIT 8");
            let mut statement = c.prepare(&sql)?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                let source = match cell(row.get_ref(0)?) {
                    Value::Null => Value::String("sconosciuta".into()),
                    other => other,
                };
                sources.push(json!({"source": source, "count": row.get::<_, i64>(1)?}));
            }
        }
        let mut types = Vec::new();
        {
            let sql = format!("SELECT role_family,COUNT(*) AS n FROM positions p WHERE {LIVE} GROUP BY role_family ORDER BY n DESC LIMIT 40");
            let mut statement = c.prepare(&sql)?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                types.push(json!({"role_family": trunc(&cell(row.get_ref(0)?), 60), "count": row.get::<_, i64>(1)?}));
            }
        }
        let pick: Vec<String> = DASH_COLUMNS.iter().filter(|n| positions.contains(**n)).map(|n| format!("p.{n}")).collect();
        let rows = dash_rows(c, &format!("SELECT {} FROM positions p WHERE {LIVE} ORDER BY p.found_at DESC,p.id ASC LIMIT {POINTS}", pick.join(", ")))?;
        let recent = if scores.contains("scored_at") {
            dash_rows(
                c,
                &format!("SELECT {} FROM positions p JOIN scores s ON s.position_id=p.id WHERE {LIVE} AND s.total_score IS NOT NULL AND s.scored_at IS NOT NULL ORDER BY s.scored_at DESC,p.id ASC LIMIT 8", pick.join(", ")),
            )?
        } else {
            Vec::new()
        };
        let acols = columns(c, "applications")?;
        let (mut events, mut events_of) = (Vec::new(), 0usize);
        if acols.contains("applied_at") {
            events_of = c.query_row("SELECT COUNT(*) FROM applications WHERE applied_at IS NOT NULL", [], |r| r.get::<_, i64>(0))? as usize;
            let pick = ["applied_at", "response", "response_at"].iter().filter(|n| acols.contains(**n)).cloned().collect::<Vec<_>>().join(", ");
            // the last EVENTS by (applied_at, id), in ascending order, as the script keeps them
            let sql = format!("SELECT {pick} FROM applications WHERE applied_at IS NOT NULL ORDER BY applied_at DESC,id DESC LIMIT {EVENTS}");
            let mut newest = dicts(c, &sql, &[])?;
            newest.reverse();
            events = newest
                .into_iter()
                .map(|row| json!({"appliedAt": nullable(&row, "applied_at"), "response": nullable(&row, "response"), "responseAt": nullable(&row, "response_at")}))
                .collect();
        }
        let mut data = json!({
            "stats": stats, "distribution": distribution, "sources": sources, "types": types, "recent": recent,
            "points": {"rows": rows, "included": 0, "of": active},
            "events": {"rows": events, "included": 0, "of": events_of},
        });
        let included = |data: &Value, part: &str| data[part]["rows"].as_array().map(|a| a.len()).unwrap_or(0);
        data["points"]["included"] = json!(included(&data, "points"));
        data["events"]["included"] = json!(included(&data, "events").min(EVENTS));
        // over the budget: cut the heavier of the two lists by a tenth until it fits; the totals stay exact
        while ascii_json_len(&ok(data.clone())) > BUDGET {
            let weight = |part: &str| ascii_json_len(&data[part]["rows"]);
            let part = if weight("points") >= weight("events") { "points" } else { "events" };
            let rows_ = data[part]["rows"].as_array().cloned().unwrap_or_default();
            if rows_.is_empty() {
                break;
            }
            let kept = (rows_.len() as f64 * 0.9) as usize;
            let cut: Vec<Value> = if part == "events" && kept > 0 { rows_[rows_.len() - kept..].to_vec() } else { rows_[..kept].to_vec() };
            data[part]["rows"] = Value::Array(cut);
            data[part]["included"] = json!(kept);
        }
        Ok(ok(data))
    })
}

// ── list ────────────────────────────────────────────────────────────────────────────────────────────

fn invalid() -> Value {
    json!({"ok": false, "error": "positions_request_invalid"})
}

fn coord(value: &Value, limit: f64) -> Value {
    match value.as_f64() {
        Some(f) if value.is_number() && f.is_finite() && -limit <= f && f <= limit => value.clone(),
        _ => Value::Null,
    }
}

fn text_of(value: &Value, size: usize) -> Value {
    match value {
        Value::String(s) => Value::String(s.chars().take(size).collect()),
        _ => Value::Null,
    }
}

const SCAM_FAMILY: [(&str, &str); 4] =
    [("same_text_many_places", "text"), ("advance_payment", "text"), ("company_unverifiable", "company"), ("private_chat_only", "contact")];

fn scam(value: &Value) -> Value {
    let Value::String(raw) = value else { return Value::Null };
    let Ok(found) = serde_json::from_str::<Value>(raw) else { return Value::Null };
    let Some(codes) = found.get("codes").and_then(|c| c.as_array()) else { return Value::Null };
    let kept: Vec<(&str, &str)> = SCAM_FAMILY.iter().filter(|(code, _)| codes.iter().any(|c| c.as_str() == Some(code))).cloned().collect();
    if kept.is_empty() {
        return Value::Null;
    }
    let families: HashSet<&str> = kept.iter().map(|(_, family)| *family).collect();
    json!({"codes": kept.iter().map(|(code, _)| *code).collect::<Vec<_>>(), "bucket": if families.len() > 1 { "section" } else { "badge" }})
}

fn state(status: &Value) -> Value {
    match status.as_str().unwrap_or("") {
        "writing" | "review" => json!("preparing"),
        "new" | "checked" | "scored" | "ready" | "applied" | "response" | "excluded" => status.clone(),
        _ => json!("needs_attention"),
    }
}

fn is_true(row: &Dict, key: &str) -> bool {
    row.get(key).map(truthy).unwrap_or(false)
}

/// Python's `type(x) in (int, float)`: a number, never a bool.
fn is_num(value: &Value) -> bool {
    value.is_number()
}

fn strings(value: &Value) -> Option<Vec<String>> {
    let list = value.as_array()?;
    if list.is_empty() || list.len() > 32 {
        return None;
    }
    list.iter()
        .map(|item| item.as_str().filter(|s| !s.is_empty() && s.chars().count() <= 80).map(|s| s.to_string()))
        .collect()
}

fn bands(value: &Value) -> Option<Vec<(f64, f64)>> {
    let list = value.as_array()?;
    if list.len() > 32 {
        return None;
    }
    list.iter()
        .map(|item| {
            let band = item.as_object()?;
            if band.len() != 2 {
                return None;
            }
            let (lo, hi) = (band.get("lo")?, band.get("hi")?);
            if !is_num(lo) || !is_num(hi) {
                return None;
            }
            let (lo, hi) = (lo.as_f64()?, hi.as_f64()?);
            if lo <= hi {
                Some((lo, hi))
            } else {
                None
            }
        })
        .collect()
}

/// The filters of a list request, checked as the script checks them. `None` is `positions_request_invalid`.
struct Filters {
    lists: HashMap<&'static str, Vec<String>>,
    score_bands: Vec<(f64, f64)>,
    critic_bands: Vec<(f64, f64)>,
    scam: Option<String>,
    flags: HashMap<&'static str, bool>,
    query: Option<Value>,
    sort: Option<String>,
    desc: bool,
    limit: Option<usize>,
    offset: usize,
}

const FILTER_KEYS: [&str; 20] = [
    "statuses", "remoteTypes", "sources", "verdicts", "families", "countries", "cities", "scoreBands", "unscored", "criticBands", "criticUnscored",
    "writeRequested", "scoredOnly", "hideExcluded", "scam", "q", "limit", "offset", "sort", "dir",
];
const SORT_KEYS: [&str; 19] = [
    "id", "score", "salary", "monthly", "last_action_by", "critic", "found_at", "last_action_at", "status", "written_at", "applied_at", "title", "company",
    "role_family", "source", "location", "remote", "loc_country", "loc_city",
];

fn parse_filters(request: &Value) -> Option<Filters> {
    let empty = Map::new();
    let filters = match request {
        Value::Null => &empty,
        Value::Object(map) => map,
        _ => return None,
    };
    if filters.keys().any(|k| !FILTER_KEYS.contains(&k.as_str())) || filters.values().any(|v| v.is_null()) {
        return None;
    }
    let mut lists = HashMap::new();
    for key in ["statuses", "remoteTypes", "sources", "verdicts", "families", "countries", "cities"] {
        if let Some(value) = filters.get(key) {
            lists.insert(key, strings(value)?);
        }
    }
    let score_bands = filters.get("scoreBands").map(bands).map(|b| b).unwrap_or(Some(Vec::new()))?;
    let critic_bands = filters.get("criticBands").map(bands).map(|b| b).unwrap_or(Some(Vec::new()))?;
    let scam = match filters.get("scam") {
        None => None,
        Some(Value::String(s)) if s == "hide" || s == "only" => Some(s.clone()),
        Some(_) => return None,
    };
    let mut flags = HashMap::new();
    for key in ["unscored", "criticUnscored", "writeRequested", "scoredOnly", "hideExcluded"] {
        if let Some(value) = filters.get(key) {
            flags.insert(key, value.as_bool()?);
        }
    }
    let sort = match filters.get("sort") {
        None => None,
        Some(Value::String(s)) if SORT_KEYS.contains(&s.as_str()) => Some(s.clone()),
        Some(_) => return None,
    };
    let desc = match filters.get("dir") {
        None => true,
        Some(Value::String(s)) if s == "desc" => true,
        Some(Value::String(s)) if s == "asc" => false,
        Some(_) => return None,
    };
    let int = |key: &str| -> Option<Option<i64>> {
        match filters.get(key) {
            None => Some(None),
            Some(Value::Number(n)) if n.is_i64() || n.is_u64() => Some(Some(n.as_i64().unwrap_or(i64::MAX))),
            Some(_) => None,
        }
    };
    let limit = match int("limit")? {
        Some(l) if (1..=600).contains(&l) => Some(l as usize),
        Some(_) => return None,
        None => None,
    };
    let offset = match int("offset")? {
        Some(o) if (0..=100_000).contains(&o) => o as usize,
        Some(_) => return None,
        None => 0,
    };
    Some(Filters { lists, score_bands, critic_bands, scam, flags, query: filters.get("q").cloned(), sort, desc, limit, offset })
}

fn trimmed(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(v) if truthy(v) => sid(Some(v)).trim().to_string(),
        _ => String::new(),
    }
}

fn city_key(item: &Dict) -> String {
    let country = trimmed(item.get("loc_country"));
    let city = trimmed(item.get("loc_city"));
    format!("{}|{}", if country.is_empty() { "(unknown)" } else { &country }, if city.is_empty() { "(country-only)" } else { &city })
}

fn search_id(q: &str) -> Option<i64> {
    static SEARCH: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = SEARCH.get_or_init(|| regex::Regex::new(r"(?i)^(?:jht[\s\-_#]*|#\s*)?0*(\d{1,9})$").unwrap());
    let found: i64 = re.captures(q)?.get(1)?.as_str().parse().ok()?;
    if found > 0 {
        Some(found)
    } else {
        None
    }
}

/// `Ok(false)` leaves the item out; `Err(())` is `positions_request_invalid` found while matching (a text `q` too long).
fn matches(item: &Dict, f: &Filters) -> Result<bool, ()> {
    let flag = |key: &str| f.flags.get(key).copied();
    let get = |key: &str| item.get(key).cloned().unwrap_or(Value::Null);
    if flag("scoredOnly") == Some(true) && get("score").is_null() {
        return Ok(false);
    }
    if flag("hideExcluded") == Some(true) && get("status") == json!("excluded") {
        return Ok(false);
    }
    let member = |key: &str, value: &Value| -> bool { f.lists.get(key).map(|list| value.as_str().map(|s| list.iter().any(|x| x == s)).unwrap_or(false)).unwrap_or(true) };
    if !member("statuses", &get("status")) || !member("remoteTypes", &get("remote_type")) || !member("sources", &get("source")) || !member("verdicts", &get("critic_verdict")) {
        return Ok(false);
    }
    if let Some(list) = f.lists.get("families") {
        let family = trimmed(item.get("role_family"));
        let family = if family.is_empty() { "Da categorizzare".to_string() } else { family };
        if !list.contains(&family) {
            return Ok(false);
        }
    }
    if let Some(list) = f.lists.get("countries") {
        let country = trimmed(item.get("loc_country"));
        let country = if country.is_empty() { "(unknown)".to_string() } else { country };
        if !list.contains(&country) {
            return Ok(false);
        }
    }
    if let Some(list) = f.lists.get("cities") {
        if !list.contains(&city_key(item)) {
            return Ok(false);
        }
    }
    let score = get("score");
    if !f.score_bands.is_empty() || flag("unscored").is_some() {
        if score.is_null() || score.as_f64() == Some(0.0) {
            if !flag("unscored").unwrap_or(false) {
                return Ok(false);
            }
        } else {
            let value = score.as_f64().ok_or(())?;
            if !f.score_bands.iter().any(|(lo, hi)| *lo <= value && value <= *hi) {
                return Ok(false);
            }
        }
    }
    let critic = get("critic_score");
    if !f.critic_bands.is_empty() || flag("criticUnscored").is_some() {
        if critic.is_null() {
            if !flag("criticUnscored").unwrap_or(false) {
                return Ok(false);
            }
        } else {
            let value = critic.as_f64().ok_or(())?;
            if !f.critic_bands.iter().any(|(lo, hi)| *lo <= value && value <= *hi) {
                return Ok(false);
            }
        }
    }
    if let Some(want) = flag("writeRequested") {
        if is_true(item, "write_requested") != want {
            return Ok(false);
        }
    }
    if let Some(query) = &f.query {
        let Value::String(query) = query else { return Err(()) };
        if query.chars().count() > 120 {
            return Err(());
        }
        let q = query.trim().to_lowercase();
        let legacy = search_id(&q);
        let hay = ["title", "company", "loc_city", "loc_country", "role_family", "source"]
            .iter()
            .map(|key| match item.get(*key) {
                Some(v) if truthy(v) => sid(Some(v)),
                _ => String::new(),
            })
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase();
        let candidate = match item.get("legacy_id") {
            Some(v) if !v.is_null() => sid(Some(v)),
            _ => sid(item.get("id")),
        };
        if !q.is_empty() && !hay.contains(&q) && !legacy.map(|l| candidate == l.to_string()).unwrap_or(false) {
            return Ok(false);
        }
    }
    Ok(true)
}

fn casefold(s: &str) -> String {
    s.to_lowercase().replace('ß', "ss")
}

/// The value a row is sorted by, or `None` when it has none (those rows go last, in the order they came).
fn sort_value(item: &Dict, key: &str) -> Option<Value> {
    let found = match key {
        "id" => match item.get("legacy_id") {
            Some(v) if !v.is_null() => v.clone(),
            _ => {
                let id = sid(item.get("id"));
                if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
                    id.parse::<i64>().map(|n| json!(n)).unwrap_or(Value::Null)
                } else {
                    Value::Null
                }
            }
        },
        "salary" | "monthly" => item.get("salary_min").cloned().unwrap_or(Value::Null),
        "remote" => item.get("remote_type").cloned().unwrap_or(Value::Null),
        "critic" => item.get("critic_score").cloned().unwrap_or(Value::Null),
        "last_action_by" => item.get("last_action_actor").cloned().unwrap_or(Value::Null),
        other => item.get(other).cloned().unwrap_or(Value::Null),
    };
    match found {
        Value::Null => None,
        Value::String(s) => Some(Value::String(casefold(&s))),
        other => Some(other),
    }
}

fn compare_values(a: &Value, b: &Value) -> Result<std::cmp::Ordering, ()> {
    match (a, b) {
        (Value::String(x), Value::String(y)) => Ok(x.cmp(y)),
        (Value::Number(x), Value::Number(y)) => x.as_f64().partial_cmp(&y.as_f64()).ok_or(()),
        _ => Err(()), // the script cannot order a text against a number either
    }
}

const LIST_KEYS: [&str; 28] = [
    "id", "legacy_id", "title", "company", "location", "remote_type", "source", "found_at", "status", "role_family", "loc_country", "loc_city", "score",
    "critic_score", "critic_verdict", "written_at", "applied_at", "salary_min", "salary_max", "salary_currency", "has_open_ticket", "ticket_indicator",
    "public_state", "write_requested", "scam_signals", "office_lat", "office_lon", "office_address",
];

const LIST_ROWS: usize = 200_000;

/// `list`: the positions that pass the filters, in the order asked, a window of them with their total.
pub(crate) fn list(db: &impl Reads, filters_request: &Value) -> Result<Value, &'static str> {
    let Some(filters) = parse_filters(filters_request) else { return Ok(invalid()) };
    db.read(|c| {
        let wanted = [
            "id", "legacy_id", "title", "company", "location", "remote_type", "source", "found_at", "status", "role_family", "loc_country", "loc_city",
            "write_requested", "scam_signals", "salary_declared_min", "salary_declared_max", "salary_declared_currency", "salary_estimated_min",
            "salary_estimated_max", "salary_estimated_currency", "office_lat", "office_lon", "office_address",
        ];
        let have = columns(c, "positions")?;
        let pick = wanted.iter().filter(|n| have.contains(**n)).map(|n| format!("p.{n}")).collect::<Vec<_>>().join(", ");
        let scores = first_by_position(c, "scores", &["total_score"])?;
        let applications = first_by_position(c, "applications", &["critic_score", "critic_verdict", "applied_at", "written_at"])?;
        let mut open: HashSet<String> = HashSet::new();
        for row in soft(dicts(c, "SELECT DISTINCT position_id FROM position_tickets WHERE status IN ('open','assigned') LIMIT 200000", &[]))? {
            open.insert(sid(row.get("position_id")));
        }
        let mut rows: Vec<Dict> = Vec::new();
        let mut section_total = 0usize;
        for position in dicts(c, &format!("SELECT {pick} FROM positions p ORDER BY p.found_at DESC,p.id ASC LIMIT {LIST_ROWS}"), &[])? {
            let key = sid(position.get("id"));
            let (score, application) = (scores.get(&key), applications.get(&key));
            let g = |key: &str| nullable(&position, key);
            let mut item = Dict::new();
            item.insert("id".into(), json!(key));
            for name in ["legacy_id", "title", "company", "location", "remote_type", "source", "status", "role_family", "loc_country", "loc_city"] {
                item.insert(name.into(), g(name));
            }
            item.insert("found_at".into(), if truthy(&g("found_at")) { g("found_at") } else { json!("") });
            item.insert("scam_signals".into(), scam(&position.get("scam_signals").cloned().unwrap_or(Value::Null)));
            item.insert("write_requested".into(), json!(is_true(&position, "write_requested")));
            item.insert("score".into(), score.map(|s| nullable(s, "total_score")).unwrap_or(Value::Null));
            item.insert("critic_score".into(), application.map(|a| nullable(a, "critic_score")).unwrap_or(Value::Null));
            item.insert("critic_verdict".into(), application.map(|a| nullable(a, "critic_verdict")).unwrap_or(Value::Null));
            let declared = salary(&position);
            let pending = open.contains(&key);
            item.insert("salary_min".into(), declared.0);
            item.insert("salary_max".into(), declared.1);
            item.insert("salary_currency".into(), if truthy(&declared.2) { declared.2 } else { json!("EUR") });
            item.insert("applied_at".into(), application.map(|a| nullable(a, "applied_at")).unwrap_or(Value::Null));
            item.insert("written_at".into(), application.map(|a| nullable(a, "written_at")).unwrap_or(Value::Null));
            item.insert("has_open_ticket".into(), json!(pending));
            item.insert("ticket_indicator".into(), json!(if pending { "pending" } else { "none" }));
            item.insert("public_state".into(), state(&g("status")));
            item.insert("office_lat".into(), coord(&g("office_lat"), 90.0));
            item.insert("office_lon".into(), coord(&g("office_lon"), 180.0));
            item.insert("office_address".into(), text_of(&g("office_address"), 160));
            match matches(&item, &filters) {
                Err(()) => return Ok(invalid()),
                Ok(false) => continue,
                Ok(true) => {}
            }
            let section = item.get("scam_signals").and_then(|s| s.get("bucket")) == Some(&json!("section"));
            if section {
                section_total += 1;
            }
            if let Some(mode) = &filters.scam {
                if section != (mode == "only") {
                    continue;
                }
            }
            rows.push(item);
        }
        if let Some(key) = &filters.sort {
            let (mut present, missing): (Vec<(Value, Dict)>, Vec<(Value, Dict)>) =
                rows.into_iter().map(|row| (sort_value(&row, key).unwrap_or(Value::Null), row)).partition(|(value, _)| !value.is_null());
            let mut failed = false;
            present.sort_by(|a, b| {
                let ordering = compare_values(&a.0, &b.0).unwrap_or_else(|_| {
                    failed = true;
                    std::cmp::Ordering::Equal
                });
                if filters.desc {
                    ordering.reverse()
                } else {
                    ordering
                }
            });
            if failed {
                return Err(rusqlite::Error::InvalidQuery);
            }
            rows = present.into_iter().chain(missing).map(|(_, row)| row).collect();
        }
        let total = rows.len();
        let window: Vec<Value> = rows
            .iter()
            .skip(filters.offset)
            .take(filters.limit.unwrap_or(usize::MAX))
            .map(|item| Value::Object(LIST_KEYS.iter().map(|k| (k.to_string(), item.get(*k).cloned().unwrap_or(Value::Null))).collect()))
            .collect();
        Ok(ok(json!({"items": window, "total": total, "scamSection": section_total})))
    })
}

// ── detail ──────────────────────────────────────────────────────────────────────────────────────────

fn pick_keys(row: &Dict, keys: &[&str]) -> Dict {
    keys.iter().map(|k| (k.to_string(), nullable(row, k))).collect()
}

fn with(mut map: Dict, extra: Vec<(&str, Value)>) -> Value {
    for (k, v) in extra {
        map.insert(k.to_string(), v);
    }
    Value::Object(map)
}

fn map_score(row: &Dict) -> Value {
    with(
        pick_keys(row, &["total_score", "stack_match", "remote_fit", "salary_fit", "experience_fit", "strategic_fit", "breakdown", "notes", "scored_by"]),
        vec![
            ("id", json!(sid(row.get("id")))),
            ("position_id", json!(sid(row.get("position_id")))),
            ("scored_at", if truthy(&nullable(row, "scored_at")) { nullable(row, "scored_at") } else { json!("") }),
        ],
    )
}

fn map_company(row: &Dict) -> Value {
    with(
        pick_keys(row, &["name", "website", "sector", "size", "glassdoor_rating", "red_flags", "culture_notes", "analyzed_by", "analyzed_at", "verdict", "logo", "about"]),
        vec![("id", json!(sid(row.get("id")))), ("hq", nullable(row, "hq_country"))],
    )
}

fn map_application(row: &Dict) -> Value {
    with(
        pick_keys(
            row,
            &[
                "cv_path", "cl_path", "cv_pdf_path", "cl_pdf_path", "cv_drive_id", "cl_drive_id", "critic_verdict", "critic_score", "critic_notes", "status", "written_at",
                "applied_at", "applied_via", "response", "response_at", "written_by", "reviewed_by", "interview_round",
            ],
        ),
        vec![("id", json!(sid(row.get("id")))), ("position_id", json!(sid(row.get("position_id")))), ("applied", json!(is_true(row, "applied")))],
    )
}

fn map_ticket(row: &Dict) -> Value {
    with(
        pick_keys(row, &["request_text", "status", "assigned_agent", "response_text", "created_at", "resolved_at"]),
        vec![
            ("id", json!(sid(row.get("id")))),
            ("position_id", json!(sid(row.get("position_id")))),
            ("kind", if truthy(&nullable(row, "kind")) { nullable(row, "kind") } else { json!("custom") }),
        ],
    )
}

fn map_position_full(row: &Dict) -> Value {
    let flag = |k: &str| json!(is_true(row, k));
    let mut out = pick_keys(
        row,
        &[
            "legacy_id", "title", "company", "location", "remote_type", "salary_declared_min", "salary_declared_max", "salary_declared_currency",
            "salary_estimated_min", "salary_estimated_max", "salary_estimated_currency", "salary_estimated_source", "url", "source", "jd_text", "jd_summary",
            "requirements", "found_by", "deadline", "status", "notes", "last_checked", "role_family", "loc_country", "loc_city", "write_requested_at",
            "write_request_kind", "geocode_requested_at", "user_excluded_reason", "user_excluded_note", "user_excluded_at", "user_excluded_prev_status",
            "recheck_requested_at", "apply_requested_at", "apply_requested_by", "last_open_check",
        ],
    );
    out.insert("id".into(), json!(sid(row.get("id"))));
    out.insert("company_id".into(), if row.get("company_id").map(truthy).unwrap_or(false) { json!(sid(row.get("company_id"))) } else { Value::Null });
    out.insert("scam_signals".into(), scam(&row.get("scam_signals").cloned().unwrap_or(Value::Null)));
    out.insert("found_at".into(), if truthy(&nullable(row, "found_at")) { nullable(row, "found_at") } else { json!("") });
    for key in ["write_requested", "geocode_requested", "office_geocoded", "recheck_requested", "apply_requested"] {
        out.insert(key.into(), flag(key));
    }
    Value::Object(out)
}

/// `detail`: one position with its score, highlights, company, application, tickets, the person's note and when it was excluded.
pub(crate) fn detail(db: &impl Reads, id: &str) -> Result<Value, &'static str> {
    if id.is_empty() || id.len() > 20 || !id.chars().all(|c| c.is_ascii_digit()) {
        return Ok(invalid());
    }
    let Ok(pid) = id.parse::<i64>() else { return Ok(invalid()) };
    let pid = json!(pid);
    db.read(|c| {
        let sql = format!("SELECT {} FROM positions WHERE id=?1 LIMIT 1", select_list(c, "positions", &POSITION_COLUMNS)?);
        let Some(raw) = soft(by_key(c, &sql, &pid))?.into_iter().next() else { return Ok(ok(Value::Null)) };
        let score = one(c, "scores", &pid)?;
        let application = one(c, "applications", &pid)?;
        let highlights: Vec<Value> = by_key(c, &format!("SELECT {} FROM position_highlights WHERE position_id=?1 ORDER BY type LIMIT 1000", select_list(c, "position_highlights", &HIGHLIGHT_COLUMNS)?), &pid)?
            .iter()
            .map(|row| json!({"id": sid(row.get("id")), "position_id": sid(row.get("position_id")), "type": nullable(row, "type"), "text": nullable(row, "text")}))
            .collect();
        let company = match raw.get("company_id") {
            Some(v) if truthy(v) => by_key(c, &format!("SELECT {} FROM companies WHERE id=?1 LIMIT 1", select_list(c, "companies", &COMPANY_COLUMNS)?), v)?.into_iter().next(),
            _ => None,
        };
        let tickets: Vec<Value> =
            by_key(c, &format!("SELECT {} FROM position_tickets WHERE position_id=?1 ORDER BY created_at DESC,id DESC LIMIT 1000", select_list(c, "position_tickets", &TICKET_COLUMNS)?), &pid)?
                .iter()
                .map(map_ticket)
                .collect();
        let note_sql = if columns(c, "position_user_notes")?.contains("origin") {
            "SELECT body,updated_at FROM position_user_notes WHERE position_id=?1 AND origin='box' LIMIT 1"
        } else {
            "SELECT body,updated_at FROM position_user_notes WHERE position_id=?1 LIMIT 1"
        };
        let note = by_key(c, note_sql, &pid)?.into_iter().next();
        let excluded = by_key(c, "SELECT ts FROM position_state_transitions WHERE position_id=?1 AND to_state='excluded' ORDER BY ts DESC,id DESC LIMIT 1", &pid)?.into_iter().next();
        Ok(ok(json!({
            "position": map_position_full(&raw),
            "score": score.as_ref().map(map_score),
            "highlights": highlights,
            "company": company.as_ref().map(map_company),
            "application": application.as_ref().map(map_application),
            "tickets": tickets,
            "userNote": note.map(Value::Object),
            "exclusionEventAt": excluded.map(|row| nullable(&row, "ts")),
        })))
    })
}

// ── map ─────────────────────────────────────────────────────────────────────────────────────────────

const MAP_BUDGET: usize = 1_363_148;

/// `map`: what the globe needs of every position that is not excluded, as many as fit in the byte budget from `offset`.
pub(crate) fn map(db: &impl Reads, offset: i64) -> Result<Value, &'static str> {
    if !(0..=1_000_000).contains(&offset) {
        return Ok(invalid());
    }
    db.read(|c| {
        let have = columns(c, "positions")?;
        let names = ["id", "title", "company", "status", "role_family", "location", "remote_type", "loc_country", "loc_city", "found_at", "office_lat", "office_lon", "office_address"];
        let pick = names.iter().filter(|n| have.contains(**n)).map(|n| format!("p.{n}")).collect::<Vec<_>>().join(", ");
        let scores = first_by_position(c, "scores", &["total_score"])?;
        let mut everyone: Vec<Value> = Vec::new();
        for row in dicts(c, &format!("SELECT {pick} FROM positions p WHERE {LIVE} ORDER BY p.found_at DESC,p.id ASC LIMIT {LIST_ROWS}"), &[])? {
            let g = |k: &str| nullable(&row, k);
            let score = scores.get(&sid(row.get("id")));
            everyone.push(json!({
                "id": sid(row.get("id")), "title": g("title"), "company": g("company"), "status": g("status"), "role_family": g("role_family"),
                "location": g("location"), "remote_type": g("remote_type"), "loc_country": g("loc_country"), "loc_city": g("loc_city"),
                "score": score.map(|s| nullable(s, "total_score")).unwrap_or(Value::Null),
                "found_at": if truthy(&g("found_at")) { g("found_at") } else { json!("") },
                "office_lat": coord(&g("office_lat"), 90.0), "office_lon": coord(&g("office_lon"), 180.0), "office_address": text_of(&g("office_address"), 160),
            }));
        }
        let start = offset as usize;
        let (mut items, mut used) = (Vec::new(), 0usize);
        for item in everyone.iter().skip(start) {
            used += ascii_json_len(item) + 1;
            if !items.is_empty() && used > MAP_BUDGET {
                break;
            }
            items.push(item.clone());
        }
        let reached = start + items.len();
        Ok(ok(json!({"items": items, "total": everyone.len(), "next": if reached < everyone.len() { json!(reached) } else { Value::Null }})))
    })
}

// ── what the app does with it ───────────────────────────────────────────────────────────────────────

const REQUIRED: [&str; 3] = ["positions", "scores", "applications"];

fn dispatch(db: &impl Reads, op: &str, request: &Value) -> Result<Value, &'static str> {
    match op {
        "list" => list(db, request.get("filters").unwrap_or(&Value::Null)),
        "detail" => detail(db, request.get("id").and_then(Value::as_str).unwrap_or("")),
        "facets" => facets(db),
        "stats" => stats(db),
        "piles" => piles(db),
        "map" => map(db, request.get("offset").and_then(Value::as_i64).unwrap_or(0)),
        _ => Err("host_db_unavailable"),
    }
}

/// The caps for the pages: lower than the module's own (512 and 256 MiB), because the copy is made while a person waits.
const PAGE_LIMITS: host_db::Limits = host_db::Limits { max_db_bytes: 192 << 20, max_wal_bytes: 96 << 20, read_ms: 4_000, attempts: 3 };
/// How long a copy is reused for the reads that follow it, if the original has not changed.
const REUSE: std::time::Duration = std::time::Duration::from_secs(10);

#[cfg(unix)]
mod reuse {
    use super::*;
    use std::{
        os::unix::fs::MetadataExt,
        path::PathBuf,
        sync::Mutex,
        time::{Duration, Instant},
    };

    type Stamp = Option<(u64, u64, u64, i64, i64, i64)>;

    /// What identifies the original now: the file and its wal (device, inode, size, change and modification time).
    fn stamps(home: &Path) -> [Stamp; 2] {
        let of = |name: &str| {
            std::fs::symlink_metadata(home.join(name)).ok().map(|m| (m.dev(), m.ino(), m.len(), m.ctime(), m.ctime_nsec(), m.mtime() * 1_000_000_000 + m.mtime_nsec()))
        };
        [of("jobs.db"), of("jobs.db-wal")]
    }

    struct Copy {
        home: PathBuf,
        work: PathBuf,
        stamps: [Stamp; 2],
        taken: Instant,
        db: HostDb,
    }

    /// The copies in use. A page that asks five things in a row makes one copy, not five; a copy is dropped (its files
    /// removed) as soon as the original changes, after `REUSE`, or when another team's is made.
    static COPIES: Mutex<Vec<Copy>> = Mutex::new(Vec::new());

    pub(super) fn with_copy<T>(
        home: &Path,
        work: &Path,
        reuse: Duration,
        f: impl FnOnce(Result<&HostDb, &'static str>) -> T,
    ) -> T {
        let mut copies = COPIES.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let current = stamps(home);
        copies.retain(|c| now.duration_since(c.taken) < REUSE.max(reuse));
        let hit = copies.iter().position(|c| c.home == home && c.work == work && c.stamps == current && now.duration_since(c.taken) < reuse && current[0].is_some());
        if let Some(i) = hit {
            return f(Ok(&copies[i].db));
        }
        copies.retain(|c| !(c.home == home && c.work == work));
        match host_db::open_snapshot_with(home, work, &REQUIRED, PAGE_LIMITS, |_| {}) {
            Ok(db) => {
                // kept only if the original stood still while the copy was made
                if stamps(home) == current && reuse > Duration::ZERO {
                    if copies.len() >= 4 {
                        copies.remove(0);
                    }
                    copies.push(Copy { home: home.to_path_buf(), work: work.to_path_buf(), stamps: current, taken: now, db });
                    let last = copies.len() - 1;
                    f(Ok(&copies[last].db))
                } else {
                    f(Ok(&db))
                }
            }
            Err(code) => f(Err(code)),
        }
    }
}

/// The answer to a positions read of this computer's team while its container is off, from the saved data: the script's own
/// shape plus `saved: {at}` (seconds since the epoch the data were last written; null for a team that never ran). `None`
/// when this read has no saved answer (an operation that needs the team, or a system without the host reader), and the
/// caller then says «the team is not running» as before. A failure of the saved data is an `ok: false` answer with its code.
pub(crate) fn read_saved(home: &Path, work: &Path, request: &Value) -> Option<Value> {
    read_saved_with(home, work, request, REUSE)
}

#[cfg(not(unix))]
fn read_saved_with(_home: &Path, _work: &Path, _request: &Value, _reuse: std::time::Duration) -> Option<Value> {
    None
}

#[cfg(unix)]
fn read_saved_with(home: &Path, work: &Path, request: &Value, reuse: std::time::Duration) -> Option<Value> {
    let op = request.get("op")?.as_str()?;
    if !matches!(op, "list" | "detail" | "facets" | "stats" | "piles" | "map") {
        return None;
    }
    host_db::sweep_snapshots(work, 3600);
    let (answer, at) = reuse::with_copy(home, work, reuse, |opened| match opened {
        Ok(db) => Some((dispatch(db, op, request), Some(db.data_time()))),
        Err("host_db_missing") => EmptyDb::new().map(|empty| (dispatch(&empty, op, request), None)),
        Err("host_db_unavailable") => None,
        Err(code) => Some((Err(code), None)),
    })?;
    Some(match answer {
        Ok(mut reply) => {
            if let Some(object) = reply.as_object_mut() {
                if object.get("ok") == Some(&Value::Bool(true)) {
                    object.insert("saved".into(), json!({"at": at}));
                }
            }
            reply
        }
        Err("host_db_unavailable") => return None,
        Err(code) => json!({"ok": false, "error": code}),
    })
}

#[cfg(test)]
mod tests {
    #![cfg(unix)]
    use super::*;
    use crate::host_db::open_snapshot;
    use std::{
        path::{Path, PathBuf},
        process::{Command, Stdio},
        time::{SystemTime, UNIX_EPOCH},
    };

    const REQUIRED: [&str; 3] = ["positions", "scores", "applications"];

    struct World {
        base: PathBuf,
        home: PathBuf,
        work: PathBuf,
    }

    impl World {
        fn new(tag: &str) -> World {
            let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let base = std::env::temp_dir().join(format!("jht-host-pos-{tag}-{}-{nanos}", std::process::id()));
            let home = base.join("home");
            std::fs::create_dir_all(&home).unwrap();
            World { work: base.join("work"), home, base }
        }
    }

    impl Drop for World {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    /// The script of the running team's reader, run with python3 on the same database. `None` when there is no python3.
    fn script_answer(home: &Path, request: &str) -> Option<Value> {
        let script = crate::existing_team_runtime::POSITIONS_READ_PY.replace("/jht_home", home.to_str().unwrap());
        let mut child = Command::new("python3").args(["-I", "-c", &script]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().ok()?;
        use std::io::Write;
        child.stdin.take().unwrap().write_all(format!("{request}\n").as_bytes()).unwrap();
        let out = child.wait_with_output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        Some(serde_json::from_slice(&out.stdout).unwrap_or_else(|e| panic!("{e}: {}", String::from_utf8_lossy(&out.stdout))))
    }

    fn schema(c: &Connection) {
        c.execute_batch(
            "CREATE TABLE positions(id INTEGER PRIMARY KEY, legacy_id TEXT, title TEXT, company TEXT, location TEXT, remote_type TEXT, status TEXT,
                 role_family TEXT, loc_country TEXT, loc_city TEXT, source TEXT, found_at TEXT, found_by TEXT, last_checked TEXT, write_requested INTEGER,
                 salary_declared_min REAL, salary_declared_max REAL, salary_declared_currency TEXT,
                 salary_estimated_min REAL, salary_estimated_max REAL, salary_estimated_currency TEXT,
                 company_id INTEGER, scam_signals TEXT, office_lat REAL, office_lon REAL, office_address TEXT, jd_text TEXT, url TEXT, notes TEXT,
                 requirements TEXT, deadline TEXT, jd_summary TEXT, write_requested_at TEXT, user_excluded_reason TEXT, last_open_check TEXT);
             CREATE TABLE companies(id INTEGER PRIMARY KEY, name TEXT, website TEXT, hq_country TEXT, sector TEXT, size TEXT, glassdoor_rating REAL, red_flags TEXT, verdict TEXT);
             CREATE TABLE position_tickets(id INTEGER PRIMARY KEY, position_id INTEGER, request_text TEXT, kind TEXT, status TEXT, assigned_agent TEXT, response_text TEXT, created_at TEXT, resolved_at TEXT);
             CREATE TABLE position_highlights(id INTEGER PRIMARY KEY, position_id INTEGER, type TEXT, text TEXT);
             CREATE TABLE position_user_notes(id INTEGER PRIMARY KEY, position_id INTEGER, body TEXT, updated_at TEXT, origin TEXT);
             CREATE TABLE position_state_transitions(id INTEGER PRIMARY KEY, position_id INTEGER, to_state TEXT, ts TEXT);
             CREATE TABLE scores(id INTEGER PRIMARY KEY, position_id INTEGER, total_score REAL, stack_match INTEGER, scored_at TEXT, scored_by TEXT);
             CREATE TABLE applications(id INTEGER PRIMARY KEY, position_id INTEGER, critic_score REAL, critic_verdict TEXT, written_at TEXT, written_by TEXT,
                 critic_reviewed_at TEXT, applied_at TEXT, response TEXT, response_at TEXT);",
        )
        .unwrap();
    }

    const STATUSES: [&str; 10] = ["new", "checked", "scored", "writing", "review", "ready", "applied", "excluded", "response", ""];

    /// `n` positions of every kind the readers meet: all the statuses (and none), plain and wide text, all the sources
    /// with counts that differ, scores whole and with decimals, a second application, applied and answered ones.
    fn fixture(world: &World, n: usize, wide: bool) {
        let c = Connection::open(world.home.join("jobs.db")).unwrap();
        schema(&c);
        c.execute_batch("BEGIN").unwrap();
        let long = "Ingénieur données 数据工程师 😀 ".repeat(12);
        for i in 0..n {
            let status = STATUSES[i % STATUSES.len()];
            // a third of them have no source (the biggest group); the others fall in sources whose counts grow (1, 3, 5, 7...)
            let source: Option<String> = if i % 3 == 2 { None } else { Some(format!("src{}", ((i / 3 % 36) as f64).sqrt() as usize)) };
            // some positions have no family, or only blanks: «Da categorizzare»
            let family = match i % 13 {
                5 => String::new(),
                9 => "   ".to_string(),
                _ => format!("family-{}", i % 6 * (i % 6 + 1) % 7 + i % 6),
            };
            let title = if wide { format!("{i} {long}") } else if i % 7 == 0 { format!("{i} {}", "x".repeat(150)) } else { format!("Data Engineer {i} — Zürich") };
            c.execute(
                "INSERT INTO positions(id,legacy_id,title,company,location,remote_type,status,role_family,loc_country,loc_city,source,found_at,found_by,last_checked,write_requested,
                    salary_declared_min,salary_declared_max,salary_declared_currency,salary_estimated_min,salary_estimated_max,salary_estimated_currency)
                 VALUES(?1,?2,?3,?4,?5,'remote',?6,?7,'IT',?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
                rusqlite::params![
                    (i + 1) as i64,
                    format!("L{i}"),
                    title,
                    format!("Company {}", if wide { long.clone() } else { (i % 9).to_string() }),
                    format!("Milano {}", if wide { long.clone() } else { String::new() }),
                    if status.is_empty() { None } else { Some(status) },
                    family,
                    format!("city{}", i % 5),
                    source,
                    format!("2026-11-{:02}T{:02}:{:02}:00Z", i % 28 + 1, i % 24, i % 60),
                    if i % 3 == 0 { Some("scout-a") } else { None },
                    if i % 4 == 0 { Some(format!("2026-11-{:02}T10:00:00Z", i % 28 + 1)) } else { None },
                    if i % 5 == 0 { Some(1) } else { Some(0) },
                    if i % 6 == 0 { Some(30000.0 + i as f64) } else { None },
                    if i % 6 == 0 { Some(40000.0) } else { None },
                    if i % 12 == 0 { Some("USD") } else { None },
                    if i % 6 != 0 { Some(25000.5) } else { None },
                    if i % 6 != 0 { Some(35000.0) } else { None },
                    if i % 2 == 0 { Some("GBP") } else { Some("") },
                ],
            )
            .unwrap();
            if i % 9 != 8 {
                let score = if i % 4 == 0 { 55.0 + (i % 40) as f64 } else { 55.5 + (i % 40) as f64 };
                c.execute(
                    "INSERT INTO scores(position_id,total_score,stack_match,scored_at,scored_by) VALUES(?1,?2,?3,?4,?5)",
                    rusqlite::params![(i + 1) as i64, if i % 11 == 10 { None } else { Some(score) }, 3, format!("2026-11-{:02}T12:{:02}:00Z", i % 28 + 1, i % 60), "scorer-x"],
                )
                .unwrap();
            }
            if i % 3 == 1 {
                c.execute(
                    "INSERT INTO applications(position_id,critic_score,critic_verdict,written_at,written_by,critic_reviewed_at,applied_at,response,response_at)
                     VALUES(?1,?2,?3,?4,'writer-y',?5,?6,?7,?8)",
                    rusqlite::params![
                        (i + 1) as i64,
                        7.5,
                        match i % 12 {
                            1 => "FAIL",
                            4 => "pass",
                            7 => "Pass",
                            _ => "fail",
                        },
                        format!("2026-11-{:02}T09:00:00Z", i % 28 + 1),
                        format!("2026-11-{:02}T13:00:00Z", i % 28 + 1),
                        if i % 2 == 0 { Some(format!("2026-11-{:02}T14:{:02}:00Z", i % 28 + 1, i % 60)) } else { None },
                        if i % 4 == 0 { Some("interview") } else { None },
                        if i % 4 == 0 { Some("2026-11-27T10:00:00Z") } else { None },
                    ],
                )
                .unwrap();
            }
        }
        for i in 0..n {
            let id = (i + 1) as i64;
            c.execute(
                "UPDATE positions SET company_id=?2, scam_signals=?3, office_lat=?4, office_lon=?5, office_address=?6, jd_text=?7, url=?8 WHERE id=?1",
                rusqlite::params![
                    id,
                    (i % 4) as i64,
                    match i % 15 { 0 => Some("not json".to_string()), k if k % 10 == 0 => Some("{\"codes\":[\"advance_payment\",\"private_chat_only\"]}".to_string()), k if k % 5 == 0 => Some("{\"codes\":[\"advance_payment\",\"other\"]}".to_string()), _ => None },
                    if i % 3 == 0 { Some(45.0 + (i % 10) as f64) } else if i % 7 == 0 { Some(999.0) } else { None },
                    if i % 3 == 0 { Some(9.1) } else { None },
                    if i % 3 == 0 { Some(format!("Via Roma {i}, Milano")) } else { None },
                    format!("Job description {i}"),
                    format!("https://example.test/{i}"),
                ],
            )
            .unwrap();
            if i % 4 == 0 {
                c.execute(
                    "INSERT INTO position_tickets(position_id,request_text,kind,status,assigned_agent,created_at) VALUES(?1,'redo the letter',?2,?3,'writer-y',?4)",
                    rusqlite::params![id, if i % 8 == 0 { Some("custom") } else { None }, ["open", "assigned", "closed"][i / 4 % 3], format!("2026-11-{:02}T08:00:00Z", i % 28 + 1)],
                )
                .unwrap();
            }
            if i % 5 == 0 {
                c.execute("INSERT INTO position_highlights(position_id,type,text) VALUES(?1,'pro','Remote friendly'),(?1,'con','Long commute')", [id]).unwrap();
                c.execute("INSERT INTO position_user_notes(position_id,body,updated_at,origin) VALUES(?1,'other','2026-11-02T10:00:00Z','web'),(?1,'my note','2026-11-02T10:00:00Z','box')", [id]).unwrap();
            }
            if i % 8 == 7 {
                c.execute("INSERT INTO position_state_transitions(position_id,to_state,ts) VALUES(?1,'excluded','2026-11-03T10:00:00Z'),(?1,'excluded','2026-11-04T10:00:00Z')", [id]).unwrap();
            }
        }
        for company in 1..4 {
            c.execute("INSERT INTO companies(id,name,website,hq_country,sector,glassdoor_rating) VALUES(?1,?2,'https://c.test','IT','tech',3.5)", rusqlite::params![company, format!("Company {company}")]).unwrap();
        }
        // a second application for one position: the first one by rowid is the one that counts
        c.execute("INSERT INTO applications(position_id,critic_score,critic_verdict,applied_at) VALUES(2,1.0,'fail','2026-12-01T00:00:00Z')", []).unwrap();
        c.execute_batch("COMMIT").unwrap();
    }

    fn sorted_items(mut answer: Value) -> Value {
        if let Some(items) = answer["data"]["items"].as_array_mut() {
            items.sort_by_key(|item| (item["id"].as_str().unwrap_or("").parse::<i64>().unwrap_or(0), item["critic_score"].to_string()));
        }
        answer
    }

    fn compare(world: &World, op: &str, rust: impl Fn(&HostDb) -> Result<Value, &'static str>) {
        let Some(script) = script_answer(&world.home, &format!("{{\"op\":\"{op}\"}}")) else {
            eprintln!("no python3 here: {op} not compared");
            return;
        };
        let db = open_snapshot(&world.home, &world.work, &REQUIRED).unwrap();
        let mine = rust(&db).unwrap();
        assert_eq!(sorted_items(mine), sorted_items(script), "{op} differs from the script");
    }

    #[test]
    fn facets_are_the_ones_the_script_gives() {
        for (tag, n) in [("f1", 20usize), ("f2", 130)] {
            let world = World::new(tag);
            fixture(&world, n, false);
            compare(&world, "facets", facets);
        }
    }

    #[test]
    fn piles_are_the_ones_the_script_gives() {
        for (tag, n) in [("p1", 20usize), ("p2", 130)] {
            let world = World::new(tag);
            fixture(&world, n, false);
            compare(&world, "piles", piles);
        }
    }

    #[test]
    fn stats_are_the_ones_the_script_gives_with_few_rows_and_with_the_bulk_read() {
        for (tag, n) in [("s0", 3usize), ("s1", 20), ("s2", 61), ("s3", 130)] {
            let world = World::new(tag);
            fixture(&world, n, false);
            compare(&world, "stats", stats);
        }
    }

    #[test]
    fn stats_over_the_budget_are_cut_as_the_script_cuts_them() {
        let world = World::new("big");
        fixture(&world, 2600, true);
        let Some(script) = script_answer(&world.home, "{\"op\":\"stats\"}") else { return };
        let db = open_snapshot(&world.home, &world.work, &REQUIRED).unwrap();
        let mine = stats(&db).unwrap();
        let included = mine["data"]["points"]["included"].as_u64().unwrap();
        assert!(included < 2000, "the fixture must be over the budget: {included}");
        assert!(ascii_json_len(&mine) <= BUDGET);
        assert_eq!(mine, script);
    }

    /// A request in the script's own wording against the same call here; the script's `ident` (the file's identity) is not an answer.
    fn compare_request(world: &World, request: &Value, rust: impl Fn(&HostDb) -> Result<Value, &'static str>) {
        let Some(mut script) = script_answer(&world.home, &request.to_string()) else {
            eprintln!("no python3 here: {request} not compared");
            return;
        };
        if let Some(map) = script.as_object_mut() {
            map.remove("ident");
        }
        let db = open_snapshot(&world.home, &world.work, &REQUIRED).unwrap();
        assert_eq!(rust(&db).unwrap(), script, "{request} differs from the script");
    }

    fn list_request(world: &World, filters: Value) {
        let request = if filters.is_null() { json!({"op": "list"}) } else { json!({"op": "list", "filters": filters.clone()}) };
        compare_request(world, &request, |db| list(db, &filters));
    }

    #[test]
    fn list_gives_what_the_script_gives_for_the_filters_the_page_sends() {
        let world = World::new("list");
        fixture(&world, 130, false);
        for filters in [
            Value::Null,
            json!({}),
            json!({"statuses": ["new", "scored"]}),
            json!({"remoteTypes": ["remote"], "sources": ["src1", "src4"]}),
            json!({"verdicts": ["pass", "Pass"]}),
            json!({"families": ["family-3", "Da categorizzare"]}),
            json!({"countries": ["IT"], "cities": ["IT|city1", "IT|city3"]}),
            json!({"scoreBands": [{"lo": 60, "hi": 70}], "unscored": true}),
            json!({"scoreBands": [{"lo": 55.5, "hi": 55.5}]}),
            json!({"scoreBands": [{"lo": 55, "hi": 56}]}),
            json!({"families": ["Da categorizzare"]}),
            json!({"unscored": false}),
            json!({"criticBands": [{"lo": 7, "hi": 8}], "criticUnscored": true}),
            json!({"criticUnscored": true}),
            json!({"writeRequested": true}),
            json!({"writeRequested": false, "hideExcluded": true}),
            json!({"scoredOnly": true, "sort": "score", "dir": "asc"}),
            json!({"sort": "score"}),
            json!({"sort": "title", "dir": "asc"}),
            json!({"sort": "company"}),
            json!({"sort": "id", "dir": "asc"}),
            json!({"sort": "salary"}),
            json!({"sort": "critic", "dir": "asc"}),
            json!({"sort": "found_at"}),
            json!({"sort": "last_action_at"}),
            json!({"sort": "remote", "limit": 7, "offset": 3}),
            json!({"q": "zürich"}),
            json!({"q": "  Family-4 "}),
            json!({"q": "\tfamily-3\n"}),
            json!({"q": "jht-5"}),
            json!({"q": "#L12"}),
            json!({"q": "12"}),
            json!({"q": ""}),
            json!({"scam": "only"}),
            json!({"scam": "hide", "sort": "found_at", "dir": "asc"}),
            json!({"limit": 10, "offset": 5}),
            json!({"limit": 600}),
            json!({"offset": 100000}),
        ] {
            list_request(&world, filters);
        }
    }

    #[test]
    fn list_refuses_what_the_script_refuses() {
        let world = World::new("listbad");
        fixture(&world, 30, false);
        for filters in [
            json!({"nope": 1}),
            json!({"statuses": []}),
            json!({"statuses": "new"}),
            json!({"statuses": [""]}),
            json!({"statuses": [1]}),
            json!({"scoreBands": [{"lo": 5}]}),
            json!({"scoreBands": [{"lo": 9, "hi": 1}]}),
            json!({"scoreBands": [{"lo": true, "hi": 1}]}),
            json!({"unscored": "yes"}),
            json!({"scam": "maybe"}),
            json!({"sort": "nope"}),
            json!({"sort": 3}),
            json!({"dir": "up"}),
            json!({"limit": 0}),
            json!({"limit": 601}),
            json!({"limit": 5.5}),
            json!({"limit": true}),
            json!({"offset": -1}),
            json!({"offset": 100001}),
            json!({"q": 5}),
            json!({"q": "x".repeat(121)}),
            json!({"limit": null}),
            json!([1]),
            json!("x"),
        ] {
            list_request(&world, filters);
        }
    }

    #[test]
    fn detail_gives_what_the_script_gives() {
        let world = World::new("detail");
        fixture(&world, 40, false);
        for id in ["1", "2", "5", "9", "16", "21", "40", "99999", "0"] {
            let request = json!({"op": "detail", "id": id});
            compare_request(&world, &request, |db| detail(db, id));
        }
        let db = open_snapshot(&world.home, &world.work, &REQUIRED).unwrap();
        for bad in ["", "abc", "-1", "1.5", "123456789012345678901"] {
            assert_eq!(detail(&db, bad).unwrap(), invalid(), "{bad:?}");
        }
    }

    #[test]
    fn map_gives_what_the_script_gives_and_pages_by_the_budget() {
        let world = World::new("map");
        fixture(&world, 60, false);
        for offset in [0i64, 7, 59, 500] {
            let request = json!({"op": "map", "offset": offset});
            compare_request(&world, &request, |db| map(db, offset));
        }
        compare_request(&world, &json!({"op": "map"}), |db| map(db, 0));
        let big = World::new("mapbig");
        fixture(&big, 6000, true);
        let request = json!({"op": "map", "offset": 0});
        compare_request(&big, &request, |db| map(db, 0));
        let db = open_snapshot(&big.home, &big.work, &REQUIRED).unwrap();
        let first = map(&db, 0).unwrap();
        assert!(first["data"]["next"].is_number(), "the fixture must need a second page");
        let db2 = open_snapshot(&big.home, &big.work, &REQUIRED).unwrap();
        assert_eq!(map(&db2, 1_000_001).unwrap(), invalid());
    }

    #[test]
    fn the_saved_answer_is_the_scripts_with_the_moment_the_data_were_written() {
        let world = World::new("saved");
        fixture(&world, 20, false);
        let asked = json!({"op": "piles"});
        let answer = read_saved(&world.home, &world.work, &asked).unwrap();
        let at = answer["saved"]["at"].as_i64().unwrap();
        assert!((at - SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64).abs() < 120);
        let mut plain = answer.clone();
        plain.as_object_mut().unwrap().remove("saved");
        if let Some(script) = script_answer(&world.home, &asked.to_string()) {
            assert_eq!(plain, script);
        }
        for request in [json!({"op": "list", "filters": {"limit": 3}}), json!({"op": "detail", "id": "2"}), json!({"op": "facets"}), json!({"op": "stats"}), json!({"op": "map", "offset": 0})] {
            let reply = read_saved(&world.home, &world.work, &request).unwrap();
            assert_eq!(reply["ok"], json!(true), "{request}");
            assert!(reply["saved"]["at"].is_number(), "{request}");
        }
        // what needs the team is not answered from here
        for request in [json!({"op": "profile"}), json!({"op": "directives"}), json!({"op": "team_activity_log"}), json!({"op": "cloud_sync"}), json!({"nothing": 1})] {
            assert!(read_saved(&world.home, &world.work, &request).is_none(), "{request}");
        }
        // an invalid request is the script's answer, not a read
        assert_eq!(read_saved(&world.home, &world.work, &json!({"op": "list", "filters": {"limit": 0}})).unwrap()["error"], json!("positions_request_invalid"));
    }

    fn copies_in(world: &World) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(&world.work).map(|d| d.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
        names.sort();
        names
    }

    #[test]
    fn five_reads_in_a_row_make_one_copy_and_a_changed_original_makes_another() {
        let world = World::new("reuse");
        fixture(&world, 20, false);
        let minute = std::time::Duration::from_secs(60);
        let ask = |op: Value| read_saved_with(&world.home, &world.work, &op, minute).unwrap();
        let first = ask(json!({"op": "piles"}));
        let copies = copies_in(&world);
        assert_eq!(copies.len(), 1);
        for request in [json!({"op": "facets"}), json!({"op": "stats"}), json!({"op": "list"}), json!({"op": "map", "offset": 0})] {
            assert_eq!(ask(request)["ok"], json!(true));
        }
        assert_eq!(copies_in(&world), copies, "the same copy served all five");
        assert_eq!(ask(json!({"op": "piles"})), first);
        // the original changes (a team that ran for a moment): the next read is of a new copy and sees it
        {
            let c = Connection::open(world.home.join("jobs.db")).unwrap();
            c.execute("INSERT INTO positions(id,status,title) VALUES(9999,'new','late')", []).unwrap();
        }
        let after = ask(json!({"op": "piles"}));
        assert_eq!(after["data"]["scout"].as_i64().unwrap(), first["data"]["scout"].as_i64().unwrap() + 1);
        let now = copies_in(&world);
        assert_eq!(now.len(), 1);
        assert_ne!(now, copies, "a new copy, and the old one is gone");
        // no reuse at all: the read has its own copy and nothing of it is left, the kept one is gone too
        let zero = std::time::Duration::ZERO;
        read_saved_with(&world.home, &world.work, &json!({"op": "piles"}), zero).unwrap();
        assert!(copies_in(&world).is_empty());
        read_saved_with(&world.home, &world.work, &json!({"op": "piles"}), zero).unwrap();
        assert!(copies_in(&world).is_empty());
    }

    #[test]
    fn a_database_over_the_cap_of_the_pages_is_refused_before_it_is_copied() {
        let world = World::new("pagecap");
        fixture(&world, 3, false);
        std::fs::OpenOptions::new().write(true).open(world.home.join("jobs.db")).unwrap().set_len(200 << 20).unwrap(); // a sparse file: costs nothing
        let answer = read_saved_with(&world.home, &world.work, &json!({"op": "piles"}), std::time::Duration::ZERO).unwrap();
        assert_eq!(answer, json!({"ok": false, "error": "host_db_unsafe"}));
        assert!(copies_in(&world).is_empty(), "not a byte was copied");
    }

    #[test]
    fn a_team_that_never_ran_answers_empty_with_no_moment_and_a_hostile_file_answers_its_code() {
        let world = World::new("never");
        let answer = read_saved(&world.home, &world.work, &json!({"op": "stats"})).unwrap();
        assert_eq!(answer["ok"], json!(true));
        assert_eq!(answer["saved"], json!({"at": null}));
        assert_eq!(answer["data"]["stats"]["total"], json!(0));
        assert_eq!(read_saved(&world.home, &world.work, &json!({"op": "piles"})).unwrap()["data"]["scout"], json!(0));
        std::fs::write(world.home.join("jobs.db"), b"this is not sqlite").unwrap();
        assert_eq!(read_saved(&world.home, &world.work, &json!({"op": "facets"})).unwrap(), json!({"ok": false, "error": "host_db_invalid"}));
        std::fs::remove_file(world.home.join("jobs.db")).unwrap();
        std::os::unix::fs::symlink("/etc/hosts", world.home.join("jobs.db")).unwrap();
        assert_eq!(read_saved(&world.home, &world.work, &json!({"op": "facets"})).unwrap(), json!({"ok": false, "error": "host_db_unsafe"}));
    }

    #[test]
    fn a_team_with_nothing_in_it_answers_zeros_and_empty_lists() {
        let world = World::new("empty");
        fixture(&world, 0, false);
        let db = open_snapshot(&world.home, &world.work, &REQUIRED).unwrap();
        assert_eq!(piles(&db).unwrap()["data"], json!({"scout": 0, "analisti": 0, "scorer": 0, "scrittori": 0, "critici": 0}));
        assert_eq!(facets(&db).unwrap()["data"]["items"], json!([]));
        let s = stats(&db).unwrap();
        assert_eq!(s["data"]["stats"]["total"], json!(0));
        assert_eq!(s["data"]["distribution"]["avgScore"], Value::Null);
        compare(&world, "stats", stats);
    }

    #[test]
    fn a_hostile_row_is_an_error_or_text_and_never_a_crash() {
        let world = World::new("hostile");
        fixture(&world, 5, false);
        {
            let c = Connection::open(world.home.join("jobs.db")).unwrap();
            // a text score (the script cannot add it either), a blob where a title goes
            c.execute("UPDATE scores SET total_score='high' WHERE position_id=1", []).unwrap();
            c.execute("UPDATE positions SET title=x'ff00fe' WHERE id=2", []).unwrap();
        }
        let db = open_snapshot(&world.home, &world.work, &REQUIRED).unwrap();
        assert_eq!(stats(&db).err(), Some("host_db_invalid"));
        assert!(facets(&db).unwrap()["data"]["items"].as_array().unwrap().iter().any(|i| i["id"] == json!("2") && i["title"] == Value::Null));
    }

    #[test]
    fn the_module_has_no_sql_from_outside_and_every_query_is_bounded() {
        let source = include_str!("host_positions.rs");
        let code = source.split("\n#[cfg(test)]\nmod tests {").next().unwrap().replace(EMPTY_SCHEMA, "");
        assert!(!code.contains("tauri::command") && !code.contains("Command::new"));
        for write in ["INSERT", "UPDATE ", "DELETE", "DROP ", "CREATE ", "ATTACH", "PRAGMA writable"] {
            assert!(!code.contains(write), "{write}");
        }
        // columns by name, from the fixed lists of this module, never a star
        assert!(!code.contains("SELECT *") && !code.contains(".*"), "no SELECT * and no p.*");
        // the queries of the module that can return many rows carry their LIMIT
        for bounded in ["LIMIT {FACET_ROWS}", "LIMIT {BULK_ROWS}", "LIMIT {POINTS}", "LIMIT {EVENTS}", "LIMIT 8", "LIMIT 40", "LIMIT 1\""] {
            assert!(code.contains(bounded), "{bounded}");
        }
    }
}

//! «Export my data»: the team's data and the account's data, saved where the person says.
//!
//! The contract is banda/piani/CONTRATTO-export-dati-20261024.md (approved). In short:
//! - Team data: six closed sources read from the team's live `jobs.db` (not the eight files of the web's
//!   `/export`, which nobody writes any more), as JSON or CSV, with an optional day range. The read goes
//!   through the chat's Python channel (this computer's team, the existing team's pinned container, the
//!   VPS the app made): one fixed script, read-only (`mode=ro`, `query_only`), whose columns are an
//!   EXPLICIT list per source (never `SELECT *`): internal paths, drive ids, coordinates and every other
//!   file of the team's home (keys, tokens, configuration) never leave it.
//! - The page never names a path. The system's «Save as» window opens first, only for the app's own window;
//!   closing it is `cancelled`, not an error. The file is written beside its final name and renamed when it
//!   is whole, so a failed export never leaves half a file, nor takes away the one the person agreed to replace.
//! - A read: allowed in the read-only view too, as it writes nothing to the team. It needs the chat connected.
//! - Account data: the page reads the cloud rows with the person's own session; here only the text is saved.

use crate::{
    account_scope::AccountScopeState,
    direct_chat::{failure, team_script_read, DirectChatError, DirectChatState},
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, BufWriter, Write},
    path::{Component, Path, PathBuf},
    sync::OnceLock,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

/// The most a team export writes: past it the export stops and says so.
const MAX_TEAM_BYTES: u64 = 200 * 1024 * 1024;
/// The most the page may hand over as the account's data.
const MAX_ACCOUNT_BYTES: usize = 64 * 1024 * 1024;
/// The page reads at most this many pages of the team: with the script's budget, far beyond MAX_TEAM_BYTES.
const MAX_PAGES: u32 = 4000;
const PAGE_TIMEOUT: Duration = Duration::from_secs(60);

/// The sources, as the script knows them. The column lists live in the script, the one place that reads.
const SOURCES: [&str; 6] = ["positions", "scores", "applications", "companies", "feedback", "notes"];

/// One page of a source: at most PAGE_BUDGET bytes of rows (and 200 rows), in the order of the table's own
/// row id, after the last one seen. A column missing from an older database is left out, not an error; a
/// table that is not there yet is no rows; a database that is not there is `export_no_database`. The columns of each source are the closed list below:
/// what a person owns about a position, an application or a company, and nothing that points inside the team.
const TEAM_EXPORT_PY: &str = r#"import json,math,os,re,sqlite3,sys
PAGE_BUDGET=900000
SOURCES={
'positions':('positions','found_at',('id','title','company','company_id','location','remote_type','salary_declared_min','salary_declared_max','salary_declared_currency','salary_estimated_min','salary_estimated_max','salary_estimated_currency','salary_estimated_source','url','source','jd_text','requirements','jd_summary','found_by','found_at','deadline','status','notes','last_checked','role_family','loc_city','loc_region','loc_country','loc_country_code','work_mode','work_country','work_country_code','is_multi_location','location_notes','office_address','expires_at','is_open','salary_precise','created_at','updated_at')),
'scores':('scores','scored_at',('id','position_id','total_score','stack_match','remote_fit','salary_fit','experience_fit','strategic_fit','breakdown','notes','scored_by','scored_at','created_at')),
'applications':('applications','created_at',('id','position_id','critic_verdict','critic_score','critic_notes','critic_round','status','written_at','applied_at','applied_via','response','response_at','rejection_reason','rejection_note','written_by','reviewed_by','critic_reviewed_at','applied','interview_round','created_at','updated_at')),
'companies':('companies','created_at',('id','name','website','hq_country','sector','size','glassdoor_rating','red_flags','culture_notes','analyzed_by','analyzed_at','verdict','created_at','updated_at')),
'feedback':('position_feedback','created_at',('id','position_id','action','reason','comment','note','score','direction','created_at')),
'notes':('position_user_notes','updated_at',('position_id','origin','body','created_at','updated_at')),
}
def emit(value): print(json.dumps(value,separators=(',',':'))); raise SystemExit(0)
def fail(code): emit({'ok':False,'error':code})
try: req=json.loads(sys.stdin.readline())
except Exception: fail('invalid_request')
if not isinstance(req,dict) or set(req)-{'source','after','from','to'}: fail('invalid_request')
spec=SOURCES.get(req.get('source')) if isinstance(req.get('source'),str) else None
if spec is None: fail('export_source_invalid')
table,date_column,allowed=spec
after=req.get('after',0)
if not isinstance(after,int) or isinstance(after,bool) or after<0: fail('invalid_request')
def day(value):
 if value is None: return None
 if not isinstance(value,str) or not re.match(r'^\d{4}-\d{2}-\d{2}$',value): fail('export_range_invalid')
 return value
since=day(req.get('from')); until=day(req.get('to'))
if since and until and since>until: fail('export_range_invalid')
def page(columns,rows,last,done): emit({'ok':True,'columns':list(columns),'rows':rows,'last':last,'done':done})
try:
 try: os.lstat('/jht_home/jobs.db'); absent=False
 except FileNotFoundError: absent=os.path.isdir('/jht_home')
 # No jobs.db where the app reads it (a team that never ran, or one that keeps it elsewhere): saying so, never an
 # empty file that looks like a team with no data.
 if absent: fail('export_no_database')
 db=sqlite3.connect('file:/jht_home/jobs.db?mode=ro',uri=True); db.execute('PRAGMA query_only=ON')
 db.text_factory=lambda raw: raw.decode('utf-8','replace')
 have=[row[1] for row in db.execute('PRAGMA table_info('+table+')')]
except SystemExit: raise
except Exception: fail('read_failed')
columns=[name for name in allowed if name in have]
if not have: page(allowed,[],None,True)
where='rowid>?'; args=[after]
if since or until:
 if date_column not in have: page(columns,[],None,True)
 if since: where+=' AND substr('+date_column+',1,10)>=?'; args.append(since)
 if until: where+=' AND substr('+date_column+',1,10)<=?'; args.append(until)
def clean(value):
 if isinstance(value,float) and not math.isfinite(value): return None
 if isinstance(value,bytes): return None
 return value
try:
 cursor=db.execute('SELECT rowid,'+(','.join(columns) if columns else '1')+' FROM '+table+' WHERE '+where+' ORDER BY rowid LIMIT 200',args)
 rows=[]; size=0; last=None; seen=0; more=False
 for row in cursor:
  seen+=1
  values=[clean(value) for value in row[1:]] if columns else []
  length=len(json.dumps(values,separators=(',',':')))
  if rows and size+length>PAGE_BUDGET: more=True; break
  rows.append(values); size+=length; last=row[0]
except Exception: fail('read_failed')
page(columns,rows,last,(not more) and seen<200)"#;

fn today_parts(at: SystemTime) -> (i64, u32, u32, u32, u32, u32, u32) {
    let since = at.duration_since(UNIX_EPOCH).unwrap_or_default();
    let seconds = since.as_secs() as i64;
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400) as u32;
    // Howard Hinnant's civil-from-days, proleptic Gregorian.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = if month <= 2 { year + 1 } else { year };
    (year, month, day, rest / 3600, rest % 3600 / 60, rest % 60, since.subsec_millis())
}

/// `2026-10-24`
pub(crate) fn iso_day(at: SystemTime) -> String {
    let (year, month, day, ..) = today_parts(at);
    format!("{year:04}-{month:02}-{day:02}")
}

/// `2026-10-24T10:11:12.345Z`, as `Date.toISOString()` says it.
fn iso_instant(at: SystemTime) -> String {
    let (year, month, day, hour, minute, second, millis) = today_parts(at);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// A real calendar day written `YYYY-MM-DD`.
fn valid_day(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let digits = |range: std::ops::Range<usize>| value.get(range).filter(|part| part.bytes().all(|b| b.is_ascii_digit())).and_then(|part| part.parse::<u32>().ok());
    let (Some(year), Some(month), Some(day)) = (digits(0..4), digits(5..7), digits(8..10)) else {
        return false;
    };
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let longest = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=longest).contains(&day)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Format {
    Json,
    Csv,
}

impl Format {
    fn extension(self) -> &'static str {
        if self == Self::Json {
            "json"
        } else {
            "csv"
        }
    }
}

/// What the page asked, checked and closed: the source one of SOURCES, the format `json` or `csv`, the days
/// real and in order.
#[derive(Debug, PartialEq, Eq)]
struct Checked {
    source: &'static str,
    format: Format,
    from: Option<String>,
    to: Option<String>,
}

fn check_request(request: &ExportRequest) -> Result<Checked, DirectChatError> {
    let source = SOURCES
        .iter()
        .copied()
        .find(|known| *known == request.source)
        .ok_or_else(|| failure("export_source_invalid"))?;
    let format = match request.format.as_str() {
        "json" => Format::Json,
        "csv" => Format::Csv,
        _ => return Err(failure("invalid_request")),
    };
    for day in [&request.from, &request.to].into_iter().flatten() {
        if !valid_day(day) {
            return Err(failure("export_range_invalid"));
        }
    }
    // `YYYY-MM-DD` sorts as the days do
    if let (Some(from), Some(to)) = (&request.from, &request.to) {
        if from > to {
            return Err(failure("export_range_invalid"));
        }
    }
    Ok(Checked { source, format, from: request.from.clone(), to: request.to.clone() })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExportRequest {
    source: String,
    format: String,
    from: Option<String>,
    to: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct ExportOutcome {
    outcome: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    count: Option<u64>,
}

fn quoted(value: &str) -> bool {
    value.chars().any(|c| matches!(c, '"' | ',' | '\n' | '\r' | '\t'))
}

fn plain_number(value: &str) -> bool {
    static PLAIN: OnceLock<Regex> = OnceLock::new();
    PLAIN
        .get_or_init(|| Regex::new(r"^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$").expect("a fixed pattern"))
        .is_match(value)
}

/// The cell as `shared/export/csv.js` makes it: first inert for a spreadsheet (a text that opens with
/// `=`, `+`, `-`, `@`, TAB or CR gets a leading `'`, unless it is a number written whole), then quoted as
/// RFC 4180 says. The order matters: quoting alone does not defend.
fn csv_cell(value: &Value) -> String {
    let raw = match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        other => other.to_string(),
    };
    let text = if raw.starts_with(['=', '+', '-', '@', '\t', '\r']) && !plain_number(&raw) {
        format!("'{raw}")
    } else {
        raw
    };
    if quoted(&text) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text
    }
}

/// The file as it is written: the head, the rows as they come, the close. It counts what it writes.
struct Sink<W: Write> {
    out: W,
    format: Format,
    columns: Vec<String>,
    rows: u64,
    bytes: u64,
}

impl<W: Write> Sink<W> {
    fn new(out: W, format: Format, columns: Vec<String>) -> Self {
        Self { out, format, columns, rows: 0, bytes: 0 }
    }

    fn put(&mut self, text: &str) -> io::Result<()> {
        self.bytes += text.len() as u64;
        self.out.write_all(text.as_bytes())
    }

    /// The JSON file is the web's `{source, exportedAt, data, count}`, with the count last: it is only
    /// known when the last page has been read.
    fn begin(&mut self, source: &str, exported_at: &str) -> io::Result<()> {
        match self.format {
            Format::Json => {
                let head = format!("{{\n  \"source\": {},\n  \"exportedAt\": {},\n  \"data\": [", json!(source), json!(exported_at));
                self.put(&head)
            }
            Format::Csv => {
                let header = self.columns.iter().map(|name| csv_cell(&Value::String(name.clone()))).collect::<Vec<_>>().join(",");
                self.put(&header)
            }
        }
    }

    fn row(&mut self, values: &[Value]) -> io::Result<()> {
        let text = match self.format {
            Format::Json => {
                let comma = if self.rows == 0 { "" } else { "," };
                let fields: Vec<String> = self
                    .columns
                    .iter()
                    .zip(values)
                    .map(|(name, value)| format!("      {}: {}", json!(name), value))
                    .collect();
                if fields.is_empty() {
                    format!("{comma}\n    {{}}")
                } else {
                    format!("{comma}\n    {{\n{}\n    }}", fields.join(",\n"))
                }
            }
            Format::Csv => format!("\n{}", values.iter().map(csv_cell).collect::<Vec<_>>().join(",")),
        };
        self.rows += 1;
        self.put(&text)
    }

    fn finish(mut self) -> io::Result<u64> {
        if self.format == Format::Json {
            // `[]` on one line when there are no rows; otherwise the last row's own line comes first
            let close = if self.rows == 0 { format!("],\n  \"count\": 0\n}}\n") } else { format!("\n  ],\n  \"count\": {}\n}}\n", self.rows) };
            self.put(&close)?;
        }
        self.out.flush()?;
        Ok(self.rows)
    }
}

/// A page of the script's reply, trusted only for what it is.
#[derive(Debug, PartialEq)]
struct Page {
    columns: Vec<String>,
    rows: Vec<Vec<Value>>,
    last: Option<u64>,
    done: bool,
}

fn parse_page(reply: &Value) -> Result<Page, DirectChatError> {
    if reply.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(failure(match reply.get("error").and_then(Value::as_str) {
            Some("export_source_invalid") => "export_source_invalid",
            Some("export_range_invalid") => "export_range_invalid",
            Some("export_no_database") => "export_no_database",
            Some("invalid_request") => "invalid_request",
            _ => "read_failed",
        }));
    }
    let bad = || failure("read_failed");
    let columns: Vec<String> = reply
        .get("columns")
        .and_then(Value::as_array)
        .ok_or_else(bad)?
        .iter()
        .map(|name| name.as_str().map(str::to_owned).ok_or_else(bad))
        .collect::<Result<_, _>>()?;
    let rows: Vec<Vec<Value>> = reply
        .get("rows")
        .and_then(Value::as_array)
        .ok_or_else(bad)?
        .iter()
        .map(|row| {
            let row = row.as_array().ok_or_else(bad)?;
            // a value is a scalar; a row has one value for each column
            (row.len() == columns.len() && row.iter().all(|value| !value.is_array() && !value.is_object())).then(|| row.clone()).ok_or_else(bad)
        })
        .collect::<Result<_, _>>()?;
    let done = reply.get("done").and_then(Value::as_bool).ok_or_else(bad)?;
    let last = match reply.get("last") {
        Some(Value::Null) | None => None,
        Some(value) => Some(value.as_u64().ok_or_else(bad)?),
    };
    if !done && (rows.is_empty() || last.is_none()) {
        return Err(bad());
    }
    Ok(Page { columns, rows, last, done })
}

fn save_name(source: &str, format: Format, at: SystemTime) -> String {
    format!("jht-{source}-{}.{}", iso_day(at), format.extension())
}

/// Where the file is written until it is whole: beside its final place, hidden, never the final name.
pub(crate) fn part_path(target: &Path) -> PathBuf {
    let name = target.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    target.with_file_name(format!(".{name}.{}.part", std::process::id()))
}

/// Creates `path` (which must not be there) for the owner alone, before the first byte goes in: a backup or an
/// export holds the person's data. A file that cannot be made private is not left behind.
pub(crate) fn create_private(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path)?;
    if crate::runtime_host::set_private_permissions(path).is_err() {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(io::Error::new(io::ErrorKind::PermissionDenied, "private permissions failed"));
    }
    Ok(file)
}

/// The folder the «Save as» window opens in: the first of `candidates` that is a folder and is not hidden
/// (no part of its path starts with a dot). The system would otherwise open where the app last asked for a file,
/// which may be a folder of keys.
pub(crate) fn start_folder(candidates: impl IntoIterator<Item = Option<PathBuf>>) -> Option<PathBuf> {
    let hidden = |dir: &Path| dir.components().any(|part| matches!(part, Component::Normal(name) if name.to_string_lossy().starts_with('.')));
    candidates.into_iter().flatten().find(|dir| dir.is_dir() && !hidden(dir))
}

/// Opens the system's «Save as» window, in Documents (else Downloads), and says the place the person chose; `None` when they closed it.
pub(crate) async fn ask_where(app: tauri::AppHandle, window: tauri::Window, name: String, label: &'static str, extension: &'static str) -> Result<Option<PathBuf>, DirectChatError> {
    let start = start_folder([app.path().document_dir().ok(), app.path().download_dir().ok()]);
    // The system's window is modal and waits for the person: never on the main thread.
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file().set_parent(&window).add_filter(label, &[extension]).set_file_name(name);
        match start {
            Some(dir) => dialog.set_directory(dir),
            None => dialog,
        }
        .blocking_save_file()
    })
    .await
    .map_err(|_| failure("export_save_failed"))?;
    match chosen {
        None => Ok(None),
        Some(chosen) => chosen.into_path().map(Some).map_err(|_| failure("export_save_failed")),
    }
}

pub(crate) fn window_may_export(label: &str) -> bool {
    label == "main"
}

/// Exports one source of the team's data to a file the person picks.
#[tauri::command]
pub(crate) async fn export_team_data(
    app: tauri::AppHandle,
    window: tauri::Window,
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
    request: ExportRequest,
) -> Result<ExportOutcome, DirectChatError> {
    if !window_may_export(window.label()) {
        return Err(failure("invalid_request"));
    }
    let checked = check_request(&request)?;
    let ask = |after: u64| {
        let mut body = json!({"source": checked.source, "after": after});
        if let Some(from) = &checked.from {
            body["from"] = json!(from);
        }
        if let Some(to) = &checked.to {
            body["to"] = json!(to);
        }
        body
    };
    // The first page before the window: a team that cannot be read is told before the person picks a place.
    let mut page = parse_page(&team_script_read(&state, &scopes, TEAM_EXPORT_PY, ask(0), PAGE_TIMEOUT).await?)?;
    let now = SystemTime::now();
    let Some(target) = ask_where(app, window, save_name(checked.source, checked.format, now), checked.format.extension(), checked.format.extension()).await? else {
        return Ok(ExportOutcome { outcome: "cancelled", count: None });
    };
    let part = part_path(&target);
    let written = write_pages(&part, &checked, &page.columns.clone(), now, &mut page, |after| {
        let state = &state;
        let scopes = &scopes;
        let body = ask(after);
        async move { parse_page(&team_script_read(state, scopes, TEAM_EXPORT_PY, body, PAGE_TIMEOUT).await?) }
    })
    .await;
    match written {
        Ok(count) => match fs::rename(&part, &target) {
            Ok(()) => Ok(ExportOutcome { outcome: "saved", count: Some(count) }),
            Err(_) => {
                let _ = fs::remove_file(&part);
                Err(failure("export_save_failed"))
            }
        },
        Err(error) => {
            let _ = fs::remove_file(&part);
            Err(error)
        }
    }
}

/// Writes the first page and the ones after it into `part`, until the script says it is done.
async fn write_pages<F, Fut>(part: &Path, checked: &Checked, columns: &[String], now: SystemTime, first: &mut Page, mut next: F) -> Result<u64, DirectChatError>
where
    F: FnMut(u64) -> Fut,
    Fut: std::future::Future<Output = Result<Page, DirectChatError>>,
{
    let file = create_private(part).map_err(|_| failure("export_save_failed"))?;
    let mut sink = Sink::new(BufWriter::new(file), checked.format, columns.to_vec());
    let saving = |_: io::Error| failure("export_save_failed");
    sink.begin(checked.source, &iso_instant(now)).map_err(saving)?;
    let mut pages = 1u32;
    loop {
        for row in &first.rows {
            sink.row(row).map_err(saving)?;
        }
        if sink.bytes > MAX_TEAM_BYTES {
            return Err(failure("export_too_large"));
        }
        if first.done {
            break;
        }
        let after = first.last.ok_or_else(|| failure("read_failed"))?;
        pages += 1;
        if pages > MAX_PAGES {
            return Err(failure("export_too_large"));
        }
        let following = next(after).await?;
        // the same columns on every page, and a page that goes forward
        if following.columns != *columns || (!following.done && following.last.is_some_and(|last| last <= after)) {
            return Err(failure("read_failed"));
        }
        *first = following;
    }
    sink.finish().map_err(saving)
}

/// Writes `bytes` to `part` (which must not be there: `create_new` neither follows a link nor truncates a file
/// that someone put at that name) and renames it to `target` when whole. A failure takes the part away.
fn write_whole(part: &Path, target: &Path, bytes: &[u8]) -> io::Result<()> {
    let written = create_private(part)
        .and_then(|mut file| file.write_all(bytes).and_then(|()| file.flush()))
        .and_then(|()| fs::rename(part, target));
    if written.is_err() && !matches!(&written, Err(error) if error.kind() == io::ErrorKind::AlreadyExists) {
        let _ = fs::remove_file(part);
    }
    written
}

/// Saves the account's data the page read from the cloud, in the place the person picks. The page gives
/// the text; this checks it is one JSON object of a size an account can have, and writes nothing else.
#[tauri::command]
pub(crate) async fn export_account_save(app: tauri::AppHandle, window: tauri::Window, text: String) -> Result<ExportOutcome, DirectChatError> {
    if !window_may_export(window.label()) {
        return Err(failure("invalid_request"));
    }
    if text.len() > MAX_ACCOUNT_BYTES {
        return Err(failure("export_too_large"));
    }
    if !matches!(serde_json::from_str::<Value>(&text), Ok(Value::Object(_))) {
        return Err(failure("invalid_request"));
    }
    let Some(target) = ask_where(app, window, "jht-account-export.json".to_owned(), "json", "json").await? else {
        return Ok(ExportOutcome { outcome: "cancelled", count: None });
    };
    let part = part_path(&target);
    match write_whole(&part, &target, text.as_bytes()) {
        Ok(()) => Ok(ExportOutcome { outcome: "saved", count: None }),
        Err(_) => Err(failure("export_save_failed")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};

    fn request(source: &str, format: &str, from: Option<&str>, to: Option<&str>) -> ExportRequest {
        ExportRequest { source: source.into(), format: format.into(), from: from.map(Into::into), to: to.map(Into::into) }
    }

    fn code(result: Result<Checked, DirectChatError>) -> &'static str {
        serde_json::to_value(result.unwrap_err()).unwrap()["code"].as_str().map(|text| SOURCES.iter().chain(["export_source_invalid", "export_range_invalid", "invalid_request"].iter()).copied().find(|known| *known == text).unwrap()).unwrap()
    }

    #[test]
    fn the_request_is_closed_before_anything_is_read() {
        assert!(check_request(&request("positions", "csv", Some("2026-01-31"), Some("2026-12-31"))).is_ok());
        assert!(check_request(&request("notes", "json", None, None)).is_ok());
        for retired in ["sessions", "tasks", "analytics", "jobs", "contacts", "interviews", "", "Positions", "positions;", "../positions"] {
            assert_eq!(code(check_request(&request(retired, "json", None, None))), "export_source_invalid", "{retired:?}");
        }
        for format in ["", "xml", "JSON", "csv "] {
            assert_eq!(code(check_request(&request("positions", format, None, None))), "invalid_request", "{format:?}");
        }
        for bad in ["2026-02-30", "2026-13-01", "2026-00-10", "26-01-01", "2026/01/01", "2026-1-1", "", "2026-01-01T00:00:00", "٢٠٢٦-٠١-٠١", "2026-01-011"] {
            assert_eq!(code(check_request(&request("positions", "json", Some(bad), None))), "export_range_invalid", "from {bad:?}");
            assert_eq!(code(check_request(&request("positions", "json", None, Some(bad)))), "export_range_invalid", "to {bad:?}");
        }
        assert_eq!(code(check_request(&request("positions", "json", Some("2026-03-02"), Some("2026-03-01")))), "export_range_invalid");
        assert!(check_request(&request("positions", "json", Some("2026-03-01"), Some("2026-03-01"))).is_ok(), "one day is a range");
        assert!(valid_day("2024-02-29") && !valid_day("2023-02-29") && !valid_day("1900-02-29") && valid_day("2000-02-29"));
    }

    #[test]
    fn the_date_is_the_utc_one_as_the_web_writes_it() {
        let at = |seconds: u64, millis: u64| UNIX_EPOCH + Duration::from_secs(seconds) + Duration::from_millis(millis);
        assert_eq!(iso_instant(at(0, 0)), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_instant(at(1_700_000_000, 123)), "2023-11-14T22:13:20.123Z");
        assert_eq!(iso_day(at(1_782_000_000, 0)), "2026-06-21");
        assert_eq!(iso_day(at(951_782_400, 0)), "2000-02-29");
        assert_eq!(save_name("positions", Format::Csv, at(1_700_000_000, 0)), "jht-positions-2023-11-14.csv");
    }

    #[test]
    fn a_cell_is_inert_for_a_spreadsheet_and_quoted_as_rfc_4180_says() {
        let cell = |text: &str| csv_cell(&json!(text));
        for leader in ["=1+1", "+1+1", "-1+1", "@SUM(A1)", "\t=HYPERLINK(\"x\")", "\r=1+1"] {
            let made = cell(leader);
            assert!(made.trim_start_matches('"').starts_with('\''), "{leader:?} -> {made:?}");
        }
        for plain in ["Senior Developer", "Acme S.p.A.", "-5", "+3.14", "1e9", ""] {
            assert_eq!(cell(plain), plain);
        }
        assert_eq!(cell("=cmd|\"/c calc\"!A0, subito"), "\"'=cmd|\"\"/c calc\"\"!A0, subito\"");
        assert_eq!(cell("Senior \"Full Stack\" Developer, remote"), "\"Senior \"\"Full Stack\"\" Developer, remote\"");
        assert_eq!(cell("Junior\nDeveloper"), "\"Junior\nDeveloper\"");
        assert_eq!(cell("Backend Engineer\r=1+1"), "\"Backend Engineer\r=1+1\"");
        assert_eq!(cell("a\t=1"), "\"a\t=1\"");
        // a number from the database is a number; a negative one is not a formula
        assert_eq!(csv_cell(&json!(-5)), "-5");
        assert_eq!(csv_cell(&json!(4.5)), "4.5");
        assert_eq!(csv_cell(&Value::Null), "");
        assert_eq!(csv_cell(&json!(true)), "true");
    }

    fn page_sink(format: Format, columns: &[&str], rows: &[Vec<Value>]) -> String {
        let mut out = Vec::new();
        let mut sink = Sink::new(&mut out, format, columns.iter().map(|name| name.to_string()).collect());
        sink.begin("positions", "2026-10-24T10:00:00.000Z").unwrap();
        for row in rows {
            sink.row(row).unwrap();
        }
        sink.finish().unwrap();
        String::from_utf8(out).unwrap()
    }

    #[test]
    fn the_json_file_is_the_webs_shape_in_the_order_of_the_columns() {
        let rows = vec![vec![json!(1), json!("Dev, \"remote\""), Value::Null], vec![json!(2), json!("Ops"), json!(4.5)]];
        let text = page_sink(Format::Json, &["id", "title", "score"], &rows);
        let parsed: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed["source"], "positions");
        assert_eq!(parsed["exportedAt"], "2026-10-24T10:00:00.000Z");
        assert_eq!(parsed["count"], 2);
        assert_eq!(parsed["data"], json!([{"id": 1, "title": "Dev, \"remote\"", "score": null}, {"id": 2, "title": "Ops", "score": 4.5}]));
        // the columns keep the script's order, which a parsed object does not show
        assert!(text.find("\"id\"").unwrap() < text.find("\"title\"").unwrap() && text.find("\"title\"").unwrap() < text.find("\"score\"").unwrap());
        // no rows: still a whole file, with a count of 0
        let empty: Value = serde_json::from_str(&page_sink(Format::Json, &["id"], &[])).unwrap();
        assert_eq!((empty["count"].as_u64(), empty["data"].as_array().map(Vec::len)), (Some(0), Some(0)));
    }

    #[test]
    fn the_csv_file_has_its_header_even_with_no_rows_and_a_hostile_title_is_inert() {
        let text = page_sink(Format::Csv, &["id", "title"], &[vec![json!(1), json!("=cmd|'/c calc'!A0")], vec![json!(2), json!("Ops, EU")]]);
        assert_eq!(text, "id,title\n1,'=cmd|'/c calc'!A0\n2,\"Ops, EU\"");
        assert_eq!(page_sink(Format::Csv, &["id", "title"], &[]), "id,title");
        // a column name that opens a formula is inert too
        assert!(page_sink(Format::Csv, &["=1+1"], &[]).starts_with("'="));
    }

    #[test]
    fn a_page_of_the_script_is_believed_only_when_it_is_whole() {
        let ok = |reply: Value| parse_page(&reply).map_err(|error| serde_json::to_value(error).unwrap()["code"].as_str().unwrap().to_owned());
        let page = ok(json!({"ok": true, "columns": ["id", "title"], "rows": [[1, "a"], [2, "b"]], "last": 2, "done": false})).unwrap();
        assert_eq!((page.rows.len(), page.last, page.done), (2, Some(2), false));
        assert!(ok(json!({"ok": true, "columns": ["id"], "rows": [], "last": null, "done": true})).is_ok());
        assert_eq!(ok(json!({"ok": false, "error": "export_source_invalid"})).unwrap_err(), "export_source_invalid");
        assert_eq!(ok(json!({"ok": false, "error": "export_range_invalid"})).unwrap_err(), "export_range_invalid");
        assert_eq!(ok(json!({"ok": false, "error": "anything else"})).unwrap_err(), "read_failed");
        for bad in [
            json!({"ok": true, "columns": ["id"], "rows": [[1, 2]], "last": 1, "done": true}),
            json!({"ok": true, "columns": ["id"], "rows": [[[1]]], "last": 1, "done": true}),
            json!({"ok": true, "columns": ["id"], "rows": [[{"a": 1}]], "last": 1, "done": true}),
            json!({"ok": true, "columns": [1], "rows": [], "last": null, "done": true}),
            json!({"ok": true, "columns": ["id"], "rows": [], "last": null, "done": false}),
            json!({"ok": true, "columns": ["id"], "rows": [[1]], "last": null, "done": false}),
            json!({"ok": true, "columns": ["id"], "rows": [[1]], "last": -1, "done": true}),
            json!({"ok": true, "columns": ["id"], "rows": [[1]], "last": 1}),
            json!({"ok": true, "rows": [], "last": null, "done": true}),
        ] {
            assert_eq!(ok(bad.clone()).unwrap_err(), "read_failed", "{bad}");
        }
    }

    // ── the script, run for real against a database that stands in for the team's ──────────────────────

    const FULL_SCHEMA: &str = "
        CREATE TABLE companies(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, website TEXT, hq_country TEXT, sector TEXT, size TEXT, glassdoor_rating REAL, red_flags TEXT, culture_notes TEXT, analyzed_by TEXT, analyzed_at TEXT, verdict TEXT, logo TEXT, logo_source TEXT, logo_fetched INTEGER, created_at TEXT, updated_at TEXT);
        CREATE TABLE positions(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, company TEXT, company_id INTEGER, location TEXT, url TEXT, jd_text TEXT, found_at TEXT, status TEXT, last_actor TEXT, office_lat REAL, office_lon REAL, geocode_requested INTEGER, write_requested INTEGER, created_at TEXT, updated_at TEXT);
        CREATE TABLE scores(id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER, total_score INTEGER, notes TEXT, scored_by TEXT, scored_at TEXT, created_at TEXT);
        CREATE TABLE applications(id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER, cv_path TEXT, cl_path TEXT, cv_pdf_path TEXT, cl_pdf_path TEXT, cv_drive_id TEXT, cl_drive_id TEXT, status TEXT, applied_at TEXT, created_at TEXT, updated_at TEXT);
        CREATE TABLE position_feedback(id INTEGER PRIMARY KEY AUTOINCREMENT, position_id INTEGER, action TEXT, reason TEXT, note TEXT, cloud_id INTEGER, created_at TEXT);
        CREATE TABLE position_user_notes(position_id INTEGER NOT NULL, origin TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT, updated_at TEXT, PRIMARY KEY(position_id, origin));
        CREATE TABLE pending_user_messages(id INTEGER PRIMARY KEY, body TEXT);
        INSERT INTO pending_user_messages(body) VALUES ('a private chat line');
    ";

    fn team_home(label: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("jht-team-export-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        home
    }

    fn python(args: &[&str], stdin: &[u8]) -> (i32, Vec<u8>) {
        use std::io::Write as _;
        let mut child = Command::new("python3").args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        child.stdin.take().unwrap().write_all(stdin).unwrap();
        let output = child.wait_with_output().unwrap();
        (output.status.code().unwrap_or(-1), output.stdout)
    }

    /// A database in `home` made by `sql` (a Python statement list), so the test needs no SQLite of its own.
    fn make_db(home: &Path, sql: &str, rows: &str) {
        let program = format!("import sqlite3\ndb=sqlite3.connect({path:?})\ndb.executescript({sql:?})\n{rows}\ndb.commit()\n", path = home.join("jobs.db").display().to_string(), sql = sql);
        let (code, _) = python(&["-c", &program], b"");
        assert_eq!(code, 0, "the test database could not be made");
    }

    /// The script with `/jht_home` moved to the test folder, and a page budget small enough to need several pages.
    fn ask(home: &Path, budget: Option<u32>, request: Value) -> Value {
        assert_eq!(TEAM_EXPORT_PY.matches("PAGE_BUDGET=900000").count(), 1, "the budget changed: update this test");
        let mut script = TEAM_EXPORT_PY.replace("/jht_home", &home.display().to_string());
        if let Some(budget) = budget {
            script = script.replace("PAGE_BUDGET=900000", &format!("PAGE_BUDGET={budget}"));
        }
        let mut input = hex(&script).into_bytes();
        input.push(b'\n');
        input.extend(serde_json::to_vec(&request).unwrap());
        input.push(b'\n');
        let (code, out) = python(&["-c", "import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())"], &input);
        assert_eq!(code, 0);
        serde_json::from_slice(&out).unwrap_or_else(|_| panic!("not JSON: {}", String::from_utf8_lossy(&out)))
    }

    fn hex(text: &str) -> String {
        text.bytes().map(|byte| format!("{byte:02x}")).collect()
    }

    fn columns_of(reply: &Value) -> Vec<String> {
        reply["columns"].as_array().unwrap().iter().map(|name| name.as_str().unwrap().to_owned()).collect()
    }

    #[cfg(unix)]
    #[test]
    fn no_source_exports_a_path_a_drive_id_a_coordinate_or_a_table_that_is_not_its_own() {
        let home = team_home("columns");
        make_db(
            &home,
            FULL_SCHEMA,
            "db.execute(\"INSERT INTO companies(name,logo,created_at) VALUES('Acme','secret-logo','2026-01-01')\")\n\
             db.execute(\"INSERT INTO positions(title,company,last_actor,office_lat,jd_text,found_at) VALUES('Dev','Acme','scout-1',45.1,'text','2026-01-02')\")\n\
             db.execute(\"INSERT INTO applications(position_id,cv_path,cv_drive_id,status,created_at) VALUES(1,'/jht_home/cv.pdf','drive-1','draft','2026-01-03')\")\n\
             db.execute(\"INSERT INTO position_feedback(position_id,action,cloud_id,created_at) VALUES(1,'like',77,'2026-01-04')\")",
        );
        for (source, absent, present) in [
            ("companies", vec!["logo", "logo_source", "logo_fetched"], vec!["name", "verdict"]),
            ("positions", vec!["last_actor", "office_lat", "office_lon", "geocode_requested", "write_requested"], vec!["title", "jd_text", "found_at"]),
            ("applications", vec!["cv_path", "cl_path", "cv_pdf_path", "cl_pdf_path", "cv_drive_id", "cl_drive_id"], vec!["status", "applied_at"]),
            ("feedback", vec!["cloud_id"], vec!["action", "reason"]),
            ("scores", vec![], vec!["total_score"]),
            ("notes", vec![], vec!["body", "origin"]),
        ] {
            let reply = ask(&home, None, json!({"source": source}));
            assert_eq!(reply["ok"], true, "{source}");
            let columns = columns_of(&reply);
            for name in &absent {
                assert!(!columns.contains(&name.to_string()), "{source} exports {name}");
            }
            for name in &present {
                assert!(columns.contains(&name.to_string()), "{source} lacks {name}");
            }
            let text = reply.to_string();
            for secret in ["secret-logo", "/jht_home/cv.pdf", "drive-1", "scout-1", "private chat"] {
                assert!(!text.contains(secret), "{source} leaks {secret}");
            }
        }
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn the_script_pages_by_budget_in_row_order_and_reaches_every_row_once() {
        let home = team_home("pages");
        make_db(
            &home,
            FULL_SCHEMA,
            "for n in range(1,8): db.execute('INSERT INTO positions(title,company,jd_text,found_at) VALUES(?,?,?,?)',('T%d'%n,'Acme','x'*400,'2026-02-%02d'%n))",
        );
        let mut after = 0;
        let mut ids = Vec::new();
        let mut pages = 0;
        loop {
            let reply = ask(&home, Some(900), json!({"source": "positions", "after": after}));
            let page = parse_page(&reply).unwrap();
            pages += 1;
            ids.extend(page.rows.iter().map(|row| row[0].as_u64().unwrap()));
            if page.done {
                break;
            }
            assert!(page.last.unwrap() > after && !page.rows.is_empty());
            after = page.last.unwrap();
            assert!(pages < 20);
        }
        assert_eq!(ids, vec![1, 2, 3, 4, 5, 6, 7], "in order, none twice, none lost");
        assert!(pages >= 3, "the budget made it several pages: {pages}");
        // a single row bigger than the budget still goes, alone
        let reply = ask(&home, Some(10), json!({"source": "positions"}));
        assert_eq!(parse_page(&reply).unwrap().rows.len(), 1);
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn the_day_range_includes_both_ends_and_leaves_out_what_has_no_day() {
        let home = team_home("range");
        make_db(
            &home,
            FULL_SCHEMA,
            "rows=[('A','2026-03-01 00:00:00'),('B','2026-03-15T23:59:59'),('C','2026-03-31 12:00:00'),('D','2026-04-01 00:00:00'),('E',None)]\n\
             for title,day in rows: db.execute('INSERT INTO positions(title,company,found_at) VALUES(?,?,?)',(title,'x',day))",
        );
        let titles = |request: Value| {
            let page = parse_page(&ask(&home, None, request)).unwrap();
            let at = page.columns.iter().position(|name| name == "title").unwrap();
            page.rows.iter().map(|row| row[at].as_str().unwrap().to_owned()).collect::<Vec<_>>()
        };
        assert_eq!(titles(json!({"source": "positions"})), ["A", "B", "C", "D", "E"], "no range: every row, dated or not");
        assert_eq!(titles(json!({"source": "positions", "from": "2026-03-01", "to": "2026-03-31"})), ["A", "B", "C"]);
        assert_eq!(titles(json!({"source": "positions", "from": "2026-03-15", "to": "2026-03-15"})), ["B"]);
        assert_eq!(titles(json!({"source": "positions", "from": "2026-03-31"})), ["C", "D"]);
        assert_eq!(titles(json!({"source": "positions", "to": "2026-03-01"})), ["A"]);
        // the script refuses what the native side would have: nothing reaches the SQL
        for bad in [
            json!({"source": "positions", "from": "2026-3-1"}),
            json!({"source": "positions", "from": "2026-03-02", "to": "2026-03-01"}),
            json!({"source": "positions", "to": "x'; DROP TABLE positions;--"}),
        ] {
            assert_eq!(ask(&home, None, bad.clone())["error"], "export_range_invalid", "{bad}");
        }
        assert_eq!(ask(&home, None, json!({"source": "positions"}))["rows"].as_array().unwrap().len(), 5, "the table is intact");
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn the_script_refuses_what_is_not_a_closed_request() {
        let home = team_home("refused");
        make_db(&home, FULL_SCHEMA, "");
        for (request, error) in [
            (json!({"source": "sessions"}), "export_source_invalid"),
            (json!({"source": "pending_user_messages"}), "export_source_invalid"),
            (json!({"source": ["positions"]}), "export_source_invalid"),
            (json!({}), "export_source_invalid"),
            (json!({"source": "positions", "after": -1}), "invalid_request"),
            (json!({"source": "positions", "after": "1"}), "invalid_request"),
            (json!({"source": "positions", "after": true}), "invalid_request"),
            (json!({"source": "positions", "columns": ["id"]}), "invalid_request"),
            (json!({"source": "positions", "table": "scores"}), "invalid_request"),
        ] {
            assert_eq!(ask(&home, None, request.clone())["error"], error, "{request}");
        }
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn a_team_with_no_database_or_an_older_one_exports_what_it_has_and_does_not_fail() {
        let home = team_home("older");
        // no jobs.db where the app reads it: told, never an empty file that looks like a team with no data
        for source in SOURCES {
            let reply = ask(&home, None, json!({"source": source}));
            assert_eq!((reply["ok"].clone(), reply["error"].clone()), (json!(false), json!("export_no_database")), "{source}");
        }
        assert_eq!(serde_json::to_value(parse_page(&json!({"ok": false, "error": "export_no_database"})).unwrap_err()).unwrap()["code"], "export_no_database");
        // a database from before some columns and some tables
        make_db(&home, "CREATE TABLE applications(id INTEGER PRIMARY KEY, position_id INTEGER, status TEXT, cv_path TEXT); INSERT INTO applications(position_id,status,cv_path) VALUES(1,'draft','/x');", "");
        let reply = ask(&home, None, json!({"source": "applications"}));
        assert_eq!(columns_of(&reply), ["id", "position_id", "status"]);
        assert_eq!(reply["rows"], json!([[1, 1, "draft"]]));
        let reply = ask(&home, None, json!({"source": "companies"}));
        assert_eq!((reply["ok"].clone(), reply["rows"].clone()), (json!(true), json!([])));
        // a range over a column the old database does not have: nothing matches
        let reply = ask(&home, None, json!({"source": "applications", "from": "2026-01-01"}));
        assert_eq!(reply["rows"], json!([]));
        // a file that is not a database is a failure to read, never an empty export
        fs::write(home.join("jobs.db"), b"this is not sqlite").unwrap();
        assert_eq!(ask(&home, None, json!({"source": "positions"}))["error"], "read_failed");
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn the_script_writes_nothing_to_the_team() {
        let home = team_home("readonly");
        make_db(&home, FULL_SCHEMA, "db.execute(\"INSERT INTO positions(title,company) VALUES('A','x')\")");
        let before = fs::read(home.join("jobs.db")).unwrap();
        for source in SOURCES {
            ask(&home, None, json!({"source": source}));
        }
        assert_eq!(fs::read(home.join("jobs.db")).unwrap(), before);
        let names: Vec<_> = fs::read_dir(&home).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert_eq!(names, ["jobs.db"], "no journal, no temporary file");
        for forbidden in ["INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "ATTACH", "PRAGMA writable_schema", "execute('PRAGMA journal_mode"] {
            assert!(!TEAM_EXPORT_PY.contains(forbidden), "the script says {forbidden}");
        }
        assert!(TEAM_EXPORT_PY.contains("mode=ro") && TEAM_EXPORT_PY.contains("PRAGMA query_only=ON"));
        let _ = fs::remove_dir_all(&home);
    }

    // ── the file ───────────────────────────────────────────────────────────────────────────────────────

    fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
        tauri::async_runtime::block_on(future)
    }

    fn pages(sets: Vec<Page>) -> impl FnMut(u64) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Page, DirectChatError>> + Send>> {
        let mut sets = sets.into_iter();
        move |_after| {
            let next = sets.next().ok_or_else(|| failure("read_failed"));
            Box::pin(async move { next })
        }
    }

    fn cols() -> Vec<String> {
        vec!["id".into(), "title".into()]
    }

    fn page_of(ids: std::ops::RangeInclusive<u64>, done: bool) -> Page {
        Page { columns: cols(), rows: ids.clone().map(|id| vec![json!(id), json!(format!("T{id}"))]).collect(), last: Some(*ids.end()), done }
    }

    fn checked(format: Format) -> Checked {
        Checked { source: "positions", format, from: None, to: None }
    }

    #[test]
    fn the_file_is_written_page_after_page_and_counts_what_it_wrote() {
        let home = team_home("write");
        let part = home.join("part");
        let mut first = page_of(1..=2, false);
        let count = block_on(write_pages(&part, &checked(Format::Csv), &cols(), UNIX_EPOCH, &mut first, pages(vec![page_of(3..=4, false), page_of(5..=5, true)]))).unwrap();
        assert_eq!(count, 5);
        assert_eq!(fs::read_to_string(&part).unwrap(), "id,title\n1,T1\n2,T2\n3,T3\n4,T4\n5,T5");
        let json_part = home.join("part-json");
        let mut first = page_of(1..=1, true);
        assert_eq!(block_on(write_pages(&json_part, &checked(Format::Json), &cols(), UNIX_EPOCH, &mut first, pages(vec![]))).unwrap(), 1);
        let parsed: Value = serde_json::from_str(&fs::read_to_string(&json_part).unwrap()).unwrap();
        assert_eq!((parsed["count"].clone(), parsed["exportedAt"].clone()), (json!(1), json!("1970-01-01T00:00:00.000Z")));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn a_page_that_breaks_the_export_is_an_error_and_never_a_shorter_file_called_whole() {
        let home = team_home("broken");
        let attempt = std::cell::Cell::new(0);
        let run = |first: Page, rest: Vec<Page>| {
            let mut first = first;
            attempt.set(attempt.get() + 1);
            let result = block_on(write_pages(&home.join(format!("p{}", attempt.get())), &checked(Format::Csv), &cols(), UNIX_EPOCH, &mut first, pages(rest)));
            result.map_err(|error| serde_json::to_value(error).unwrap()["code"].as_str().unwrap().to_owned())
        };
        // the team stops answering halfway
        assert_eq!(run(page_of(1..=2, false), vec![]), Err("read_failed".to_owned()));
        // the columns change between pages
        let mut other = page_of(3..=3, true);
        other.columns = vec!["id".into()];
        assert_eq!(run(page_of(1..=2, false), vec![other]), Err("read_failed".to_owned()));
        // a page that does not go forward would loop for ever
        assert_eq!(run(page_of(5..=6, false), vec![page_of(1..=6, false)]), Err("read_failed".to_owned()));
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn a_part_file_is_never_the_final_name_and_never_overwrites_a_file_that_is_there() {
        let home = team_home("part");
        let target = home.join("jht-positions-2026-10-24.csv");
        let part = part_path(&target);
        assert_ne!(part, target);
        assert_eq!(part.parent(), target.parent());
        assert!(part.file_name().unwrap().to_string_lossy().starts_with('.'));
        fs::write(&part, "someone else's").unwrap();
        let mut first = page_of(1..=1, true);
        let error = block_on(write_pages(&part, &checked(Format::Csv), &cols(), UNIX_EPOCH, &mut first, pages(vec![]))).unwrap_err();
        assert_eq!(serde_json::to_value(error).unwrap()["code"], "export_save_failed");
        assert_eq!(fs::read_to_string(&part).unwrap(), "someone else's", "create_new: nothing is replaced");
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn the_accounts_file_is_written_whole_and_never_over_a_name_someone_else_put_there() {
        let home = team_home("account");
        let (part, target) = (home.join(".a.json.1.part"), home.join("a.json"));
        fs::write(&target, "the file the person agreed to replace").unwrap();
        write_whole(&part, &target, b"{\"data\":{}}").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"data\":{}}");
        assert!(!part.exists(), "renamed, not copied");
        // a name already there at the part's place (a file, or a link to the person's own file) is not written through
        let victim = home.join("victim.txt");
        fs::write(&victim, "precious").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&victim, &part).unwrap();
        #[cfg(not(unix))]
        fs::write(&part, "precious").unwrap();
        let error = write_whole(&part, &target, b"x").unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(&victim).unwrap(), "precious");
        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"data\":{}}", "the final file was not touched");
        assert!(part.symlink_metadata().is_ok(), "what was there is left there");
        // a target that cannot be written leaves no part behind
        let missing = home.join("no-such-folder").join("b.json");
        let part_b = home.join(".b.json.1.part");
        assert!(write_whole(&part_b, &missing, b"x").is_err());
        assert!(!part_b.exists());
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    fn mode_of(path: &Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[cfg(unix)]
    #[test]
    fn every_file_the_export_makes_is_for_the_owner_alone_from_its_first_byte() {
        let home = team_home("private");
        // empty: nothing has been written yet, and it is already private
        let empty = home.join("empty");
        drop(create_private(&empty).unwrap());
        assert_eq!(mode_of(&empty), 0o600);
        // a team export, through the part and the rename to the person's name
        let target = home.join("jht-positions.csv");
        let part = part_path(&target);
        let mut first = page_of(1..=2, true);
        block_on(write_pages(&part, &checked(Format::Csv), &cols(), UNIX_EPOCH, &mut first, pages(vec![]))).unwrap();
        assert_eq!(mode_of(&part), 0o600);
        fs::rename(&part, &target).unwrap();
        assert_eq!(mode_of(&target), 0o600);
        // the account's data
        let account = home.join("jht-account-export.json");
        write_whole(&part_path(&account), &account, b"{}").unwrap();
        assert_eq!(mode_of(&account), 0o600);
        // a file that is there is not made private, nor written through
        assert!(create_private(&account).is_err());
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn the_save_window_starts_in_a_visible_folder_and_never_in_a_hidden_one() {
        let home = team_home("start");
        let documents = home.join("Documents");
        let downloads = home.join("Downloads");
        let keys = home.join(".ssh");
        let nested = home.join(".config").join("Documents");
        for dir in [&documents, &downloads, &keys, &nested] {
            fs::create_dir_all(dir).unwrap();
        }
        assert_eq!(start_folder([Some(documents.clone()), Some(downloads.clone())]), Some(documents.clone()));
        // Documents missing: Downloads
        assert_eq!(start_folder([Some(home.join("nowhere")), Some(downloads.clone())]), Some(downloads.clone()));
        assert_eq!(start_folder([None, Some(downloads.clone())]), Some(downloads.clone()));
        // a hidden folder, or one inside a hidden folder, is skipped
        assert_eq!(start_folder([Some(keys.clone()), Some(downloads.clone())]), Some(downloads.clone()));
        assert_eq!(start_folder([Some(nested), Some(downloads.clone())]), Some(downloads));
        // nothing that will do: the system's own choice, which the export cannot do better
        assert_eq!(start_folder([Some(keys), Some(home.join("file-not-folder"))]), None);
        assert_eq!(start_folder([]), None);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn the_save_window_is_told_where_to_start_and_every_file_is_made_private() {
        let source = include_str!("team_export.rs");
        let code = source.split("#[cfg(test)]").next().unwrap();
        let ask = code.split("pub(crate) async fn ask_where(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(ask.contains("document_dir()") && ask.contains("download_dir()") && ask.contains(".set_directory("));
        // the writers of this module open their file only through create_private
        assert_eq!(code.matches("OpenOptions::new()").count(), 1, "only create_private opens a file");
        for writer in ["async fn write_pages<", "fn write_whole("] {
            let body = code.split(writer).nth(1).unwrap().split("\n}\n").next().unwrap();
            assert!(body.contains("create_private(part)"), "{writer}");
        }
    }

    #[test]
    fn the_commands_are_the_app_windows_and_the_save_window_opens_before_any_file() {
        let source = include_str!("team_export.rs");
        let code = source.split("#[cfg(test)]").next().unwrap();
        for command in ["pub(crate) async fn export_team_data(", "pub(crate) async fn export_account_save("] {
            let body = code.split(command).nth(1).unwrap().split("\n}\n").next().unwrap();
            assert!(body.contains("!window_may_export(window.label())"), "{command}");
        }
        assert!(window_may_export("main") && !window_may_export("") && !window_may_export("live-screen") && !window_may_export("Main"));
        // a read: the team's script goes through the read helper, and the module never asks for the write gate
        assert!(code.contains("team_script_read(") && !code.contains("refuse_writing"));
        let team = code.split("pub(crate) async fn export_team_data(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(team.find("team_script_read").unwrap() < team.find("ask_where").unwrap(), "an unreadable team is told before the window");
        assert!(team.find("ask_where").unwrap() < team.find("write_pages").unwrap(), "no file before the person has chosen");
    }
}

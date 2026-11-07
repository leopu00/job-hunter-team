//! The load-times log (`load-times.log`, beside the runtime log): how long the team's reads and the app's pages take, in
//! closed fields only. Moved here from runtime_log.rs as it was; the readers still name it through `runtime_log`.
use crate::runtime_log::{append, utc, RuntimeLog};
use std::time::{Duration, Instant, SystemTime};

/// The page-load timings file is smaller: a line a read, rotated as the runtime log is.
const LOAD_LOG_MAX_BYTES: u64 = 128 * 1024;

/// The kinds of read the load-times log names, in the order of the core's operations.
pub(crate) const POSITIONS_READ_KINDS: [&str; 11] = ["list", "detail", "facets", "stats", "map", "profile", "cloud_sync", "team_activity", "directives", "piles", "team_activity_log"];
const POSITIONS_READ_OTHER: &str = "other";

/// The pages whose load time is written down, as the load-times log names them.
pub(crate) const LOAD_PAGES: [&str; 21] = [
    "dashboard", "map", "positions", "position", "swipe", "team", "team_log", "team_scout", "team_analista", "team_scorer",
    "team_scrittore", "team_critico", "messages", "profile", "agents", "agent", "office", "mail", "budget", "settings", "help",
];
/// Where the first data a page showed came from.
pub(crate) const LOAD_SOURCES: [&str; 4] = ["memory", "stream", "native", "cloud"];
/// The most calls to the cloud one page load lists.
const LOAD_CLOUD_MAX: usize = 24;

/// One request to the cloud a page made while it loaded: what it asked (a table's name, or `rates`)
/// and how long it took.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct LoadCloudCall {
    label: String,
    ms: u64,
}

/// How a page loaded, as the page measured it (the shell's page-timing): see `page_load_metric`.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PageLoadMetric {
    page: String,
    /// None when the page showed nothing (it is never filled in with the end of a read).
    first_data_ms: Option<u64>,
    #[serde(default)]
    first_data_source: Option<String>,
    complete_ms: u64,
    native_reads: u32,
    native_ms: u64,
    cloud: Vec<LoadCloudCall>,
}

/// What one read of the team's positions cost; see `RuntimeLog::record_positions_read`.
pub(crate) struct PositionsReadTiming {
    pub(crate) op: &'static str,
    pub(crate) shared: bool,
    /// The checks of the pinned container were not repeated for this read (see existing_team_runtime).
    pub(crate) checks_skipped: bool,
    pub(crate) ok: bool,
    pub(crate) total: Duration,
    pub(crate) ssh: Duration,
    pub(crate) bytes_out: usize,
    pub(crate) bytes_in: usize,
}

impl RuntimeLog {
    /// How long one read of the team's positions took, for the page-load inventory. Local only, in a
    /// file of its own (`load-times.log`, so it never pushes a failure out of the runtime log): the
    /// kind of read, whether the chat's ssh connection was lent to it, the time it took end to end and
    /// in ssh, and the bytes that crossed. No host, account, position, filter or row.
    pub(crate) fn record_positions_read(&self, read: &PositionsReadTiming) {
        let op = if POSITIONS_READ_KINDS.contains(&read.op) { read.op } else { POSITIONS_READ_OTHER };
        let entry = format!(
            "=== {} positions.read op={op} link={} inspects={} ok={} total_ms={} ssh_ms={} bytes_out={} bytes_in={}\n",
            utc(SystemTime::now()),
            if read.shared { "shared" } else { "own" },
            if read.checks_skipped { "skipped" } else { "run" },
            read.ok,
            read.total.as_millis(),
            read.ssh.as_millis(),
            read.bytes_out,
            read.bytes_in,
        );
        let _ = append(&self.path().with_file_name("load-times.log"), &entry, LOAD_LOG_MAX_BYTES);
    }

    /// How long a page took to show its data, from the click to the first data and to the last, with
    /// the reads of the team and the calls to the cloud it made. Closed fields only: the page from a
    /// closed list, numbers (capped), where the first data came from, and the cloud calls as a table's name or `rates`.
    pub(crate) fn record_page_load(&self, metric: &PageLoadMetric) {
        let Some(page) = LOAD_PAGES.iter().find(|page| **page == metric.page) else {
            return;
        };
        let cap = |value: u64| value.min(600_000);
        let calls: Vec<String> = metric
            .cloud
            .iter()
            .take(LOAD_CLOUD_MAX)
            .map(|call| {
                let label = &call.label;
                let name = if (1..=32).contains(&label.len()) && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_') {
                    label.as_str()
                } else {
                    POSITIONS_READ_OTHER
                };
                format!("{name}:{}", cap(call.ms))
            })
            .collect();
        let first = metric.first_data_ms.map_or_else(|| "-".to_owned(), |ms| cap(ms).to_string());
        let source = match metric.first_data_source.as_deref() {
            None => "-",
            Some(said) => LOAD_SOURCES.iter().find(|known| **known == said).copied().unwrap_or(POSITIONS_READ_OTHER),
        };
        let entry = format!(
            "=== {} page.load page={page} first_data_ms={first} first_data_source={source} complete_ms={} native_reads={} native_ms={} cloud_calls={} cloud={}\n",
            utc(SystemTime::now()),
            cap(metric.complete_ms),
            metric.native_reads.min(10_000),
            cap(metric.native_ms),
            metric.cloud.len().min(10_000),
            if calls.is_empty() { "-".to_owned() } else { calls.join(",") },
        );
        let _ = append(&self.path().with_file_name("load-times.log"), &entry, LOAD_LOG_MAX_BYTES);
    }
}

/// The shell tells how a page loaded (see `RuntimeLog::record_page_load`). Local only: it is a line
/// in the load-times log, and nothing leaves the computer.
#[tauri::command]
pub(crate) fn page_load_metric(app: tauri::AppHandle, metric: PageLoadMetric) {
    if let Some(log) = RuntimeLog::new(&app) {
        log.record_page_load(&metric);
    }
}

/// The native reads of the pages whose time is written, as the load-times log names them. A name that is not here is «other».
pub(crate) const NATIVE_READS: [&str; 8] =
    ["team.budget", "work.stats", "profile.progress", "team.start", "team.settings", "team.provider", "mail.status", "swipe.deck"];

/// The way a native read went: the chat's channel into the container (served by the state stream where it is open), the
/// host's wrapper on this computer, or ssh to a server.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum ReadVia {
    Chat,
    Wrapper,
    Ssh,
}

impl ReadVia {
    fn name(self) -> &'static str {
        match self {
            ReadVia::Chat => "chat",
            ReadVia::Wrapper => "wrapper",
            ReadVia::Ssh => "ssh",
        }
    }
}

impl RuntimeLog {
    /// How long one native read of a page took, end to end: its name from a closed list, the way it went, whether it gave its
    /// answer, the milliseconds. Nothing of the answer, the host or the account.
    pub(crate) fn record_native_read(&self, op: &str, via: ReadVia, ok: bool, took: Duration) {
        let op = NATIVE_READS.iter().find(|known| **known == op).copied().unwrap_or(POSITIONS_READ_OTHER);
        let entry = format!(
            "=== {} native.read op={op} via={} ok={ok} ms={}\n",
            utc(SystemTime::now()),
            via.name(),
            took.as_millis().min(600_000),
        );
        let _ = append(&self.path().with_file_name("load-times.log"), &entry, LOAD_LOG_MAX_BYTES);
    }
}

/// Writes the time of a native read that started at `started` (best effort: without a log folder, no line).
pub(crate) fn note_native_read(app: &tauri::AppHandle, op: &'static str, via: ReadVia, ok: bool, started: Instant) {
    if let Some(log) = RuntimeLog::new(app) {
        log.record_native_read(op, via, ok, started.elapsed());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("jht-load-times-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_positions_read_leaves_only_its_kind_and_numbers_in_a_file_of_its_own() {
        let root = dir("positions-read");
        let log = RuntimeLog::in_dir(&root.join("logs"));
        let timing = |op| PositionsReadTiming {
            op,
            shared: true,
            checks_skipped: false,
            ok: true,
            total: Duration::from_millis(812),
            ssh: Duration::from_millis(790),
            bytes_out: 57_000,
            bytes_in: 384_000,
        };
        log.record_positions_read(&timing("list"));
        // anything that is not one of the kinds (a name, a path, a user's word) is just «other»
        log.record_positions_read(&timing("SELECT secret FROM positions"));
        let text = fs::read_to_string(root.join("logs").join("load-times.log")).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("positions.read op=list link=shared inspects=run ok=true total_ms=812 ssh_ms=790 bytes_out=57000 bytes_in=384000"), "{}", lines[0]);
        assert!(lines[1].contains("op=other") && !text.contains("secret"));
        // the runtime log (the failures of the steps) is not touched by it
        assert!(!root.join("logs").join("runtime.log").exists());
        // and its file stays small: it rotates like the runtime log
        for _ in 0..(LOAD_LOG_MAX_BYTES / 100) {
            log.record_positions_read(&timing("list"));
        }
        assert!(fs::metadata(root.join("logs").join("load-times.log")).unwrap().len() <= LOAD_LOG_MAX_BYTES);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_page_load_leaves_closed_fields_and_nothing_a_page_could_put_there() {
        let root = dir("page-load");
        let log = RuntimeLog::in_dir(&root.join("logs"));
        let metric = |page: &str, labels: &[&str]| -> PageLoadMetric {
            serde_json::from_value(serde_json::json!({
                "page": page, "firstDataMs": 1200, "completeMs": 9_999_999, "nativeReads": 4, "nativeMs": 5100,
                "cloud": labels.iter().map(|label| serde_json::json!({"label": label, "ms": 310})).collect::<Vec<_>>(),
            }))
            .unwrap()
        };
        log.record_page_load(&metric("map", &["position_views", "rates"]));
        log.record_page_load(&metric("positions", &[]));
        // a page that is not one of the list, and a label that is a path or a word of someone's: nothing / «other»
        log.record_page_load(&metric("/positions/secret-id", &[]));
        log.record_page_load(&metric("position", &["Bearer abc.def", "https://host.invalid/x", "a".repeat(33).as_str()]));
        let text = fs::read_to_string(root.join("logs").join("load-times.log")).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 3, "{text}");
        assert!(lines[0].ends_with("page.load page=map first_data_ms=1200 first_data_source=- complete_ms=600000 native_reads=4 native_ms=5100 cloud_calls=2 cloud=position_views:310,rates:310"), "{}", lines[0]);
        assert!(lines[1].ends_with("cloud_calls=0 cloud=-"));
        assert!(lines[2].contains("page=position ") && lines[2].ends_with("cloud=other:310,other:310,other:310"), "{}", lines[2]);
        assert!(!text.contains("secret") && !text.contains("Bearer") && !text.contains("host.invalid"));
        // a request with a field that is not in the form is no request at all
        // a page that showed nothing says so, and a source off the list is «other»
        let shown = |first: serde_json::Value, source: serde_json::Value| -> PageLoadMetric {
            serde_json::from_value(serde_json::json!({
                "page": "budget", "firstDataMs": first, "firstDataSource": source, "completeMs": 40, "nativeReads": 0, "nativeMs": 0, "cloud": [],
            }))
            .unwrap()
        };
        log.record_page_load(&shown(serde_json::json!(12), serde_json::json!("memory")));
        log.record_page_load(&shown(serde_json::Value::Null, serde_json::Value::Null));
        log.record_page_load(&shown(serde_json::json!(5), serde_json::json!("C:/Users/someone")));
        let text = fs::read_to_string(root.join("logs").join("load-times.log")).unwrap();
        let lines: Vec<&str> = text.lines().skip(3).collect();
        assert!(lines[0].contains("page=budget first_data_ms=12 first_data_source=memory complete_ms=40"), "{}", lines[0]);
        assert!(lines[1].contains("first_data_ms=- first_data_source=- complete_ms=40"), "{}", lines[1]);
        assert!(lines[2].contains("first_data_source=other ") && !text.contains("someone"));
        assert!(serde_json::from_value::<PageLoadMetric>(serde_json::json!({
            "page": "map", "firstDataMs": 1, "completeMs": 2, "nativeReads": 0, "nativeMs": 0, "cloud": [], "url": "x"
        })).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_native_read_leaves_its_closed_name_its_way_and_its_time_only() {
        let root = dir("native-read");
        let log = RuntimeLog::in_dir(&root.join("logs"));
        log.record_native_read("team.budget", ReadVia::Chat, true, Duration::from_millis(14_250));
        log.record_native_read("mail.status", ReadVia::Wrapper, false, Duration::from_millis(31));
        log.record_native_read("team.settings", ReadVia::Ssh, true, Duration::from_secs(4_000));
        // a name that is not one of the reads (a word of someone's, a path) is just «other»
        log.record_native_read("/home/someone/secret", ReadVia::Chat, true, Duration::from_millis(5));
        let text = fs::read_to_string(root.join("logs").join("load-times.log")).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 4, "{text}");
        assert!(lines[0].ends_with("native.read op=team.budget via=chat ok=true ms=14250"), "{}", lines[0]);
        assert!(lines[1].ends_with("native.read op=mail.status via=wrapper ok=false ms=31"), "{}", lines[1]);
        assert!(lines[2].ends_with("op=team.settings via=ssh ok=true ms=600000"), "{}", lines[2]);
        assert!(lines[3].contains("op=other ") && !text.contains("secret"));
        assert!(!root.join("logs").join("runtime.log").exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// Guard that reads a source (declared): the pages the log names are the keys of the shell's one list of routes, in the same
    /// order, so a page added to the app is measured and a key the page sends is never «not one of the list».
    #[test]
    fn the_pages_of_the_log_are_the_keys_of_the_shells_routes() {
        let source = include_str!("../../src/shell/route-paths.ts").replace("\r\n", "\n");
        let block = source.split("export const ROUTE_PATHS = {").nth(1).unwrap().split("} as const;").next().unwrap();
        let keys: Vec<&str> = block.lines().filter_map(|line| line.trim().split_once(':').map(|(key, _)| key)).filter(|key| !key.is_empty()).collect();
        assert_eq!(keys, LOAD_PAGES.to_vec());
    }
}

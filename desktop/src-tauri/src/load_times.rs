//! The load-times log (`load-times.log`, beside the runtime log): how long the team's reads and the app's pages take, in
//! closed fields only. Moved here from runtime_log.rs as it was; the readers still name it through `runtime_log`.
use crate::runtime_log::{append, utc, RuntimeLog};
use std::time::{Duration, SystemTime};

/// The page-load timings file is smaller: a line a read, rotated as the runtime log is.
const LOAD_LOG_MAX_BYTES: u64 = 128 * 1024;

/// The kinds of read the load-times log names, in the order of the core's operations.
pub(crate) const POSITIONS_READ_KINDS: [&str; 11] = ["list", "detail", "facets", "stats", "map", "profile", "cloud_sync", "team_activity", "directives", "piles", "team_activity_log"];
const POSITIONS_READ_OTHER: &str = "other";

/// The pages whose load time is written down, as the load-times log names them.
pub(crate) const LOAD_PAGES: [&str; 3] = ["map", "positions", "position"];
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
    first_data_ms: u64,
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
    /// list of three, numbers (capped), and the cloud calls as a table's name or `rates`.
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
        let entry = format!(
            "=== {} page.load page={page} first_data_ms={} complete_ms={} native_reads={} native_ms={} cloud_calls={} cloud={}\n",
            utc(SystemTime::now()),
            cap(metric.first_data_ms),
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
        // a page that is not one of the three, and a label that is a path or a word of someone's: nothing / «other»
        log.record_page_load(&metric("/positions/secret-id", &[]));
        log.record_page_load(&metric("position", &["Bearer abc.def", "https://host.invalid/x", "a".repeat(33).as_str()]));
        let text = fs::read_to_string(root.join("logs").join("load-times.log")).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 3, "{text}");
        assert!(lines[0].ends_with("page.load page=map first_data_ms=1200 complete_ms=600000 native_reads=4 native_ms=5100 cloud_calls=2 cloud=position_views:310,rates:310"), "{}", lines[0]);
        assert!(lines[1].ends_with("cloud_calls=0 cloud=-"));
        assert!(lines[2].contains("page=position ") && lines[2].ends_with("cloud=other:310,other:310,other:310"), "{}", lines[2]);
        assert!(!text.contains("secret") && !text.contains("Bearer") && !text.contains("host.invalid"));
        // a request with a field that is not in the form is no request at all
        assert!(serde_json::from_value::<PageLoadMetric>(serde_json::json!({
            "page": "map", "firstDataMs": 1, "completeMs": 2, "nativeReads": 0, "nativeMs": 0, "cloud": [], "url": "x"
        })).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}

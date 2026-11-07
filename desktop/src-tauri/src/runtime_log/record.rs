//! The shared record path also exposes whether the append actually succeeded.
use super::{append, entry, failure_cause, RuntimeLog, LOG_MAX_BYTES};
use std::time::{Duration, SystemTime};

pub(super) fn checked(log: &RuntimeLog, step: &str, ended: Result<i32, &str>, stdout: &[u8], stderr: &[u8], elapsed: Duration) -> bool {
    let cause = (ended != Ok(0)).then(|| failure_cause(stdout, stderr)).flatten();
    if let Ok(mut last) = log.cause.lock() {
        *last = cause;
    }
    let entry = entry(step, ended, stdout, stderr, elapsed, SystemTime::now());
    append(&log.path, &entry, LOG_MAX_BYTES).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory() -> std::path::PathBuf {
        static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let nonce = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("jht-record-{}-{nonce}-{sequence}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        dir
    }

    #[test]
    fn a_directory_at_the_log_path_cannot_be_reported_as_a_successful_append() {
        let dir = directory();
        let log = RuntimeLog::in_dir(&dir);
        std::fs::create_dir(&log.path).unwrap();
        assert!(!checked(&log, "page.data", Err("page_data_refresh_failed"), &[], b"Fixed diagnostic", Duration::ZERO));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_successful_append_keeps_the_fixed_diagnostic_and_cause() {
        let dir = directory();
        let log = RuntimeLog::in_dir(&dir);
        assert!(checked(&log, "page.data", Err("page_data_refresh_failed"), &[], b"Fixed diagnostic", Duration::ZERO));
        let text = std::fs::read_to_string(&log.path).unwrap();
        assert!(text.contains("page_data_refresh_failed"));
        assert!(text.contains("Fixed diagnostic"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}

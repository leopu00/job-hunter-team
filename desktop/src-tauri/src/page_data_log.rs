//! Closed frontend data diagnostics: no captured content or identifiers cross IPC.
use serde::Deserialize;
use std::time::Duration;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DataFailure {
    Refresh,
    DiskRead,
    DiskWrite,
    DiskInvalid,
}

impl DataFailure {
    fn diagnostic(self) -> (&'static str, &'static str) {
        match self {
            Self::Refresh => ("page_data_refresh_failed", "The latest data could not be read; the previous copy is marked as old."),
            Self::DiskRead => ("page_data_disk_read_failed", "The saved data could not be read; a live read is still required."),
            Self::DiskWrite => ("page_data_disk_write_failed", "The data could not be saved for the next start."),
            Self::DiskInvalid => ("page_data_disk_invalid", "The saved data is invalid and was not shown."),
        }
    }
}

#[tauri::command]
pub(crate) async fn page_data_failure(app: tauri::AppHandle, kind: DataFailure) -> bool {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(log) = crate::runtime_log::RuntimeLog::new(&app) else { return false };
        let (code, phrase) = kind.diagnostic();
        log.record_checked("page.data", Err(code), &[], phrase.as_bytes(), Duration::ZERO)
    }).await.unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostics_are_fixed_and_unknown_input_is_refused() {
        assert!(serde_json::from_str::<DataFailure>("\"arbitrary text\"").is_err());
        for (raw, code) in [("refresh", "page_data_refresh_failed"), ("disk_read", "page_data_disk_read_failed"),
                            ("disk_write", "page_data_disk_write_failed"), ("disk_invalid", "page_data_disk_invalid")] {
            let kind: DataFailure = serde_json::from_value(serde_json::json!(raw)).unwrap();
            assert_eq!(kind.diagnostic().0, code);
            assert!(!kind.diagnostic().1.is_empty());
        }
    }
}

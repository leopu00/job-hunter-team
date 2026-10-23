//! «Save as» for a small text the page made (a personal theme): the person picks the place in the
//! system's own window, and only that place is written. The page never names a path; it gives a
//! suggested file name, cleaned here, and the text, at most MAX_TEXT_BYTES.
//!
//! Answers: `saved`, `cancelled` (the person closed the window: not an error), or a closed code.
//! Overwriting an existing file is asked by the system's window itself, as for any «Save as».

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

pub(crate) const MAX_TEXT_BYTES: usize = 4096;
const NAME_MAX_CHARS: usize = 60;
const EXTENSION: &str = ".json";

#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct SaveTextOutcome {
    outcome: &'static str,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct SaveTextError {
    code: &'static str,
}

fn failure(code: &'static str) -> SaveTextError {
    SaveTextError { code }
}

/// The suggested name as the window shows it: only `[A-Za-z0-9._ -]`, no leading dot (a hidden
/// file), ending in `.json`, 1 to 60 characters in all; None when nothing is left of it.
pub(crate) fn clean_name(suggested: &str) -> Option<String> {
    let kept: String = suggested
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ' ' | '-'))
        .collect();
    let trimmed = kept.trim();
    let base = if trimmed.to_ascii_lowercase().ends_with(EXTENSION) {
        &trimmed[..trimmed.len() - EXTENSION.len()]
    } else {
        trimmed
    };
    let base: String = base
        .trim()
        .trim_start_matches('.')
        .chars()
        .take(NAME_MAX_CHARS - EXTENSION.len())
        .collect();
    let base = base.trim_end_matches(['.', ' ']);
    (!base.is_empty()).then(|| format!("{base}{EXTENSION}"))
}

/// Everything checked before the window opens: the app's own window, the size, the name.
pub(crate) fn prepare(window_label: &str, suggested_name: &str, contents: &str) -> Result<String, SaveTextError> {
    if window_label != "main" {
        return Err(failure("window_not_allowed"));
    }
    if contents.len() > MAX_TEXT_BYTES {
        return Err(failure("save_text_too_large"));
    }
    clean_name(suggested_name).ok_or_else(|| failure("save_text_invalid"))
}

#[tauri::command]
pub(crate) async fn save_text_file(
    app: tauri::AppHandle,
    window: tauri::Window,
    suggested_name: String,
    contents: String,
) -> Result<SaveTextOutcome, SaveTextError> {
    let name = prepare(window.label(), &suggested_name, &contents)?;
    // The system's window is modal and waits for the person: never on the main thread.
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_parent(&window)
            .add_filter("JSON", &["json"])
            .set_file_name(name)
            .blocking_save_file()
    })
    .await
    .map_err(|_| failure("save_text_failed"))?;
    let Some(chosen) = chosen else {
        return Ok(SaveTextOutcome { outcome: "cancelled" });
    };
    let path = chosen.into_path().map_err(|_| failure("save_text_failed"))?;
    std::fs::write(&path, contents.as_bytes()).map_err(|_| failure("save_text_failed"))?;
    Ok(SaveTextOutcome { outcome: "saved" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_name_is_cleaned_to_a_plain_json_file_name() {
        assert_eq!(clean_name("My theme").as_deref(), Some("My theme.json"));
        assert_eq!(clean_name("tema-scuro_2.JSON").as_deref(), Some("tema-scuro_2.json"));
        assert_eq!(clean_name("../../etc/passwd").as_deref(), Some("etcpasswd.json"));
        assert_eq!(clean_name("..hidden").as_deref(), Some("hidden.json"));
        assert_eq!(clean_name("a/b\\c:d*e?f\"g<h>i|j").as_deref(), Some("abcdefghij.json"));
        assert_eq!(clean_name("tema\u{202e}nosj.exe").as_deref(), Some("temanosj.exe.json"));
        assert_eq!(clean_name("  spaced  .json  ").as_deref(), Some("spaced.json"));
        for empty in ["", "   ", ".json", "...", "///", "\u{202e}\u{200b}"] {
            assert_eq!(clean_name(empty), None, "{empty:?}");
        }
        let long = clean_name(&"x".repeat(500)).unwrap();
        assert_eq!(long.chars().count(), NAME_MAX_CHARS);
        assert!(long.ends_with(".json"));
    }

    #[test]
    fn only_the_apps_window_a_small_text_and_a_name_reach_the_dialog() {
        assert_eq!(prepare("main", "tema", "{}"), Ok("tema.json".into()));
        assert_eq!(prepare("live-screen", "tema", "{}"), Err(failure("window_not_allowed")));
        assert_eq!(prepare("main", "tema", &"x".repeat(MAX_TEXT_BYTES)), Ok("tema.json".into()));
        assert_eq!(prepare("main", "tema", &"x".repeat(MAX_TEXT_BYTES + 1)), Err(failure("save_text_too_large")));
        // the limit counts bytes, not characters
        assert_eq!(prepare("main", "tema", &"è".repeat(MAX_TEXT_BYTES / 2 + 1)), Err(failure("save_text_too_large")));
        assert_eq!(prepare("main", "///", "{}"), Err(failure("save_text_invalid")));
    }

    #[test]
    fn the_answers_are_the_closed_ones() {
        assert_eq!(serde_json::to_value(SaveTextOutcome { outcome: "saved" }).unwrap(), serde_json::json!({"outcome": "saved"}));
        assert_eq!(serde_json::to_value(failure("save_text_failed")).unwrap(), serde_json::json!({"code": "save_text_failed"}));
    }
}

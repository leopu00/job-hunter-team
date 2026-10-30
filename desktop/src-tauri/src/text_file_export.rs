//! «Save as» for a small text the page made (a personal theme): the person picks the place in the
//! system's own window, and only that place is written. The page never names a path; it gives a
//! suggested file name, cleaned here, and the text, at most MAX_TEXT_BYTES.
//!
//! Answers: `saved`, `cancelled` (the person closed the window: not an error), or a closed code.
//! Overwriting an existing file is asked by the system's window itself, as for any «Save as».
//!
//! The text is written to a new file next to the chosen one, then renamed onto it: the chosen name is replaced, never
//! opened. If a link is there (an agent can leave one in a folder the container mounts) the link is what goes, and
//! the file it pointed to is neither truncated nor written.

use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::Path,
};
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
    write_whole(&path, contents.as_bytes()).map_err(|_| failure("save_text_failed"))?;
    Ok(SaveTextOutcome { outcome: "saved" })
}

/// A new file in the folder of `target`, with a name that nobody can foresee and that does not follow a link, written
/// whole and renamed onto `target`. A failure takes the new file away and leaves `target` as it was.
fn write_whole(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let folder = target.parent().ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let name = target.file_name().ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_nanos());
    for attempt in 0..16u32 {
        let part = folder.join(format!(".{}.part-{}-{}", name.to_string_lossy(), std::process::id(), nonce.wrapping_add(u128::from(attempt))));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.custom_flags(libc::O_NOFOLLOW);
        }
        let mut file = match options.open(&part) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        };
        let written = file.write_all(bytes).and_then(|()| file.sync_all());
        drop(file);
        let done = written.and_then(|()| fs::rename(&part, target));
        if done.is_err() {
            let _ = fs::remove_file(&part);
        }
        return done;
    }
    Err(io::Error::from(io::ErrorKind::AlreadyExists))
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

    fn scratch(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "jht-save-text-{label}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut found: Vec<String> = fs::read_dir(dir).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect();
        found.sort();
        found
    }

    #[test]
    fn the_text_is_written_whole_next_to_the_chosen_name_and_nothing_else_is_left() {
        let dir = scratch("whole");
        let target = dir.join("tema.json");
        write_whole(&target, b"{\"a\":1}").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"{\"a\":1}");
        // an existing file is replaced as a whole, a shorter text leaves nothing of the longer one
        write_whole(&target, b"{}").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"{}");
        assert_eq!(names(&dir), vec!["tema.json".to_owned()]);
        let _ = fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn a_link_at_the_chosen_name_is_replaced_and_the_file_it_pointed_to_is_not_written() {
        let dir = scratch("link");
        let outside = dir.join("a-file-of-the-user");
        fs::write(&outside, "precious\n").unwrap();
        let target = dir.join("tema.json");
        std::os::unix::fs::symlink(&outside, &target).unwrap();
        write_whole(&target, b"{}").unwrap();
        assert_eq!(fs::read_to_string(&outside).unwrap(), "precious\n");
        assert!(fs::symlink_metadata(&target).unwrap().file_type().is_file());
        assert_eq!(fs::read(&target).unwrap(), b"{}");
        // a link that points nowhere: just as well
        let dangling = dir.join("dangling.json");
        std::os::unix::fs::symlink(dir.join("not-there"), &dangling).unwrap();
        write_whole(&dangling, b"{}").unwrap();
        assert!(!dir.join("not-there").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_name_that_cannot_be_replaced_fails_and_leaves_the_folder_as_it_was() {
        let dir = scratch("folder");
        let target = dir.join("tema.json");
        fs::create_dir(&target).unwrap();
        fs::write(target.join("inside"), "x").unwrap();
        assert!(write_whole(&target, b"{}").is_err());
        assert_eq!(names(&dir), vec!["tema.json".to_owned()]);
        assert_eq!(fs::read_to_string(target.join("inside")).unwrap(), "x");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_command_does_not_open_the_chosen_path_to_write_it() {
        let source = include_str!("text_file_export.rs");
        let code = source.split("#[cfg(test)]").next().unwrap();
        assert!(!code.contains("fs::write(") && code.contains("write_whole(&path"));
        assert_eq!(code.matches("OpenOptions::new()").count(), 1, "only the new file is opened");
        assert!(code.contains("create_new(true)"));
    }

    #[test]
    fn the_answers_are_the_closed_ones() {
        assert_eq!(serde_json::to_value(SaveTextOutcome { outcome: "saved" }).unwrap(), serde_json::json!({"outcome": "saved"}));
        assert_eq!(serde_json::to_value(failure("save_text_failed")).unwrap(), serde_json::json!({"code": "save_text_failed"}));
    }
}

use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// A CSV of the positions the person is looking at: a few hundred KB. Anything
/// bigger is not that.
const MAX_BYTES: usize = 20 * 1024 * 1024;
const MAX_NAME: usize = 80;

/// The name must be only a name: letters, digits, `-`, `_` and `.`, ending in
/// `.csv`, not starting with a dot. No folder can come in through it.
pub(crate) fn safe_csv_name(name: &str) -> Option<String> {
    let stem = name.strip_suffix(".csv")?;
    let ok = !stem.is_empty()
        && name.len() <= MAX_NAME
        && !stem.starts_with('.')
        && !stem.contains("..")
        && stem
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    ok.then(|| name.to_string())
}

/// `name.csv`, then `name (1).csv`, `name (2).csv`…: a file already there is
/// never overwritten.
pub(crate) fn write_new_csv(dir: &Path, name: &str, content: &str) -> std::io::Result<PathBuf> {
    let stem = name.strip_suffix(".csv").unwrap_or(name);
    for attempt in 0..100u32 {
        let file = if attempt == 0 {
            name.to_string()
        } else {
            format!("{stem} ({attempt}).csv")
        };
        let path = dir.join(file);
        match crate::team_export::create_private(&path) {
            Ok(mut handle) => {
                handle.write_all(content.as_bytes())?;
                return Ok(path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "no free name",
    ))
}

/// Only the app's main window: the others load pages the app does not own.
fn window_may_export(label: &str) -> bool {
    label == "main"
}

/// Saves a CSV the page built in the person's Downloads folder, shows it in the
/// file manager, and says where it went. The page chooses the content (what its
/// table shows); the file's name and place are chosen here.
#[tauri::command]
pub(crate) fn export_csv_save(
    app: tauri::AppHandle,
    window: tauri::Window,
    name: String,
    content: String,
) -> Result<String, String> {
    if !window_may_export(window.label()) {
        return Err("export_window".into());
    }
    let name = safe_csv_name(&name).ok_or("export_name_invalid")?;
    if content.len() > MAX_BYTES {
        return Err("export_too_large".into());
    }
    let dir = app
        .path()
        .download_dir()
        .map_err(|_| "export_dir_unavailable".to_string())?;
    if !dir.is_dir() {
        return Err("export_dir_unavailable".into());
    }
    let path = write_new_csv(&dir, &name, &content).map_err(|error| crate::team_export::save_code(&error, "export_write_failed").to_string())?;
    let _ = crate::runtime_log::reveal(&path);
    Ok(path.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::{safe_csv_name, window_may_export, write_new_csv};

    #[test]
    fn accepts_a_plain_csv_name() {
        assert_eq!(safe_csv_name("jht-posizioni-2026-10-20.csv").as_deref(), Some("jht-posizioni-2026-10-20.csv"));
    }

    #[test]
    fn refuses_anything_that_is_not_only_a_name() {
        for name in ["", ".csv", "a.txt", "../a.csv", "a/b.csv", "a\\b.csv", ".hidden.csv", "a..b.csv", "a b.csv", "é.csv"] {
            assert_eq!(safe_csv_name(name), None, "{name}");
        }
        assert_eq!(safe_csv_name(&format!("{}.csv", "a".repeat(80))), None);
    }

    #[test]
    fn only_the_apps_own_window_may_export() {
        assert!(window_may_export("main"));
        for label in ["", "live-screen", "Main", "main ", "other"] {
            assert!(!window_may_export(label), "{label:?}");
        }
    }

    #[test]
    fn the_command_asks_the_window_before_anything_else() {
        let source = include_str!("export_file.rs");
        let command = &source[source.find("pub(crate) fn export_csv_save").unwrap()..];
        let check = command.find("window_may_export(window.label())").unwrap();
        let first_work = command.find("safe_csv_name(&name)").unwrap();
        assert!(check < first_work);
    }

    #[cfg(unix)]
    #[test]
    fn the_csv_is_for_the_owner_alone() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("jht-export-private-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = write_new_csv(&dir, "p.csv", "one").unwrap();
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn never_overwrites_a_file_already_there() {
        let dir = std::env::temp_dir().join(format!("jht-export-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = write_new_csv(&dir, "p.csv", "one").unwrap();
        let second = write_new_csv(&dir, "p.csv", "two").unwrap();
        assert_eq!(first.file_name().unwrap(), "p.csv");
        assert_eq!(second.file_name().unwrap(), "p (1).csv");
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "one");
        assert_eq!(std::fs::read_to_string(&second).unwrap(), "two");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

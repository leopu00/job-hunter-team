//! The index of the files the person attached in the chat: what the page needs to show a bubble that the
//! agent never receives, the name the person gave the file.
//!
//! It lives OUTSIDE the `allegati` folder (the team reads that one), in the folder of the account the chat belongs
//! to (`accounts/<scope>/chat-attachments.json` of the app's data), so it goes with that account's data and one
//! profile never shows the names of another. The file is 0600 in a folder 0700, written whole to a temporary file
//! and renamed over the old one. The last 500 entries are kept; an entry whose file is gone stays (the bubble says
//! so). The path the file came from is never stored, and neither the name nor the path is ever written to a log.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub(crate) const MAX_ENTRIES: usize = 500;
/// A file bigger than this is not an index of ours: it is read as empty.
const MAX_INDEX_BYTES: u64 = 4 * 1024 * 1024;

static WRITING: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Entry {
    /// The name of OUR copy (`allegato-…`), the key.
    pub(crate) file: String,
    pub(crate) kind: String,
    pub(crate) bytes: u64,
    pub(crate) display_name: Option<String>,
    pub(crate) at: u64,
}

pub(crate) fn path_at(root: &Path, scope: &crate::account_scope::AccountScope) -> PathBuf {
    root.join("accounts").join(scope.digest()).join("chat-attachments.json")
}

fn read(path: &Path) -> Vec<Entry> {
    let Ok(meta) = std::fs::symlink_metadata(path) else { return Vec::new() };
    if !meta.file_type().is_file() || meta.len() > MAX_INDEX_BYTES {
        return Vec::new();
    }
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<Entry>>(&bytes).ok())
        .unwrap_or_default()
}

/// What the index holds for these names, in the order given; `None` for a name it does not know.
pub(crate) fn lookup(path: &Path, files: &[String]) -> Vec<Option<Entry>> {
    let entries = read(path);
    files.iter().map(|file| entries.iter().rev().find(|e| &e.file == file).cloned()).collect()
}

/// Adds entries (a name already there is replaced) and keeps the last 500.
#[cfg(unix)]
pub(crate) fn record(path: &Path, new: &[Entry]) -> Result<(), &'static str> {
    use std::io::Write;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    let _only = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let folder = path.parent().ok_or("storage_failed")?;
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(folder).map_err(|_| "storage_failed")?;
    let mut entries = read(path);
    entries.retain(|old| !new.iter().any(|n| n.file == old.file));
    entries.extend(new.iter().cloned());
    if entries.len() > MAX_ENTRIES {
        entries.drain(..entries.len() - MAX_ENTRIES);
    }
    let body = serde_json::to_vec(&entries).map_err(|_| "storage_failed")?;
    let temporary = folder.join(format!(".chat-attachments-{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&temporary);
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&temporary)?;
        file.write_all(&body)?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
        return Err("storage_failed");
    }
    Ok(())
}

#[cfg(not(unix))]
pub(crate) fn record(_path: &Path, _new: &[Entry]) -> Result<(), &'static str> {
    Err("attach_platform")
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("jht-index-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn entry(n: u64) -> Entry {
        Entry { file: format!("allegato-20261029-10{n:04}.pdf"), kind: "pdf".into(), bytes: n, display_name: Some(format!("name {n}")), at: n }
    }

    #[test]
    fn the_index_is_private_atomic_and_remembers_the_name_the_person_gave() {
        let path = dir("basic").join("accounts").join("abc").join("chat-attachments.json");
        record(&path, &[entry(1), entry(2)]).unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(std::fs::metadata(path.parent().unwrap()).unwrap().permissions().mode() & 0o777, 0o700);
        let found = lookup(&path, &[entry(2).file, "allegato-20261029-999999.pdf".into()]);
        assert_eq!(found[0].as_ref().unwrap().display_name.as_deref(), Some("name 2"));
        assert!(found[1].is_none());
        // no temporary file stays
        assert!(std::fs::read_dir(path.parent().unwrap()).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".tmp")));
    }

    #[test]
    fn only_the_last_five_hundred_stay_and_a_name_added_again_is_replaced() {
        let path = dir("cap").join("accounts").join("abc").join("chat-attachments.json");
        let all: Vec<Entry> = (1..=(MAX_ENTRIES as u64 + 20)).map(entry).collect();
        for chunk in all.chunks(50) {
            record(&path, chunk).unwrap();
        }
        assert_eq!(read(&path).len(), MAX_ENTRIES);
        assert!(lookup(&path, &[entry(1).file])[0].is_none(), "the oldest went");
        assert!(lookup(&path, &[entry(MAX_ENTRIES as u64 + 20).file])[0].is_some());
        let mut again = entry(MAX_ENTRIES as u64 + 20);
        again.display_name = Some("renamed".into());
        record(&path, &[again]).unwrap();
        assert_eq!(read(&path).len(), MAX_ENTRIES);
        assert_eq!(lookup(&path, &[entry(MAX_ENTRIES as u64 + 20).file])[0].as_ref().unwrap().display_name.as_deref(), Some("renamed"));
    }

    #[test]
    fn an_index_that_is_not_one_is_read_as_empty_and_overwritten_whole() {
        let path = dir("bad").join("accounts").join("abc").join("chat-attachments.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"not json at all").unwrap();
        assert!(lookup(&path, &[entry(1).file])[0].is_none());
        record(&path, &[entry(1)]).unwrap();
        assert!(lookup(&path, &[entry(1).file])[0].is_some());
    }

    #[test]
    fn the_index_holds_no_path_and_its_keys_are_the_ones_the_page_reads() {
        let path = dir("keys").join("accounts").join("abc").join("chat-attachments.json");
        record(&path, &[entry(3)]).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.contains("\"displayName\"") && text.contains("\"file\"") && text.contains("\"bytes\""));
        assert!(!text.contains('/') || !text.contains("Downloads"), "no path of the original is kept");
    }
}

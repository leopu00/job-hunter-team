//! Who owns the team of this computer, read from the marker `~/.jht/.desktop-account-scope`.
//!
//! A read and nothing else: no marker is written, claimed, repaired or removed, no scope is activated,
//! no file besides the marker and the local profile records is opened. The answer is the opaque digest
//! the marker holds, whether it belongs to a local profile this app knows (then the profile's id) or to
//! an account that signed in, or «nobody» when the computer has no marker yet.

use crate::account_scope::{
    load_local_scope_at, local_owner_marker_path, local_profiles_dir, valid_digest,
    valid_profile_id,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

const MARKER_MAX_BYTES: u64 = 80;
const PROFILES_MAX: usize = 1024;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum OwnerKind {
    Local,
    Google,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TeamOwner {
    owner_scope_digest: String,
    kind: OwnerKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    profile_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct TeamOwnerError {
    code: &'static str,
}

fn failure(code: &'static str) -> TeamOwnerError {
    TeamOwnerError { code }
}

fn window_may_read(label: &str) -> bool {
    label == "main"
}

/// The digest the marker holds: `None` when there is no marker, a closed code when there is one that is
/// not the product's (a link, a directory, too long, not a digest) or cannot be read.
fn marker_digest(marker: &Path) -> Result<Option<String>, &'static str> {
    let metadata = match fs::symlink_metadata(marker) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("local_account_owner_unavailable"),
    };
    if !metadata.file_type().is_file() || metadata.len() > MARKER_MAX_BYTES {
        return Err("local_account_owner_invalid");
    }
    let stored = fs::read_to_string(marker).map_err(|_| "local_account_owner_unavailable")?;
    let digest = stored.trim();
    if !valid_digest(digest) {
        return Err("local_account_owner_invalid");
    }
    Ok(Some(digest.to_string()))
}

/// The local profile whose record holds `digest`. A record that is not readable or not the product's does
/// not stop the answer (it is not the owner); two profiles with one digest do, because then no id is the
/// owner's.
fn profile_of(profiles_root: &Path, digest: &str) -> Result<Option<String>, &'static str> {
    let entries = match fs::read_dir(profiles_root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("local_profile_storage_unavailable"),
    };
    let mut found = None;
    for (seen, entry) in entries.enumerate() {
        if seen >= PROFILES_MAX {
            return Err("local_profile_storage_unavailable");
        }
        let Ok(name) = entry.map(|entry| entry.file_name()) else {
            continue;
        };
        let Some(profile_id) = name
            .to_str()
            .and_then(|name| name.strip_suffix(".json"))
            .filter(|id| valid_profile_id(id))
        else {
            continue;
        };
        match load_local_scope_at(profiles_root, profile_id) {
            Ok(scope) if scope.digest() == digest => {
                if found.is_some() {
                    return Err("local_profile_invalid");
                }
                found = Some(profile_id.to_string());
            }
            _ => {}
        }
    }
    Ok(found)
}

fn owner_at(marker: &Path, profiles_root: &Path) -> Result<Option<TeamOwner>, &'static str> {
    let Some(digest) = marker_digest(marker)? else {
        return Ok(None);
    };
    Ok(Some(match profile_of(profiles_root, &digest)? {
        Some(profile_id) => TeamOwner {
            owner_scope_digest: digest,
            kind: OwnerKind::Local,
            profile_id: Some(profile_id),
        },
        None => TeamOwner {
            owner_scope_digest: digest,
            kind: OwnerKind::Google,
            profile_id: None,
        },
    }))
}

fn paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), &'static str> {
    Ok((local_owner_marker_path(app)?, local_profiles_dir(app)?))
}

/// Who owns the team of this computer, or `null` when nobody does yet. Reads only, so it answers in every
/// view; the main window alone may ask.
#[tauri::command]
pub(crate) fn team_owner_read(
    window: tauri::Window,
    app: tauri::AppHandle,
) -> Result<Option<TeamOwner>, TeamOwnerError> {
    if !window_may_read(window.label()) {
        return Err(failure("invalid_request"));
    }
    let (marker, profiles) = paths(&app).map_err(failure)?;
    owner_at(&marker, &profiles).map_err(failure)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::account_scope::AccountScope;
    use std::time::SystemTime;

    fn scratch(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-team-owner-{label}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn profile(root: &Path, id: &str, digest: &str) {
        fs::create_dir_all(root).unwrap();
        fs::write(
            root.join(format!("{id}.json")),
            format!("{{\"scopeDigest\":\"{digest}\"}}"),
        )
        .unwrap();
    }

    fn id(n: char) -> String {
        n.to_string().repeat(64)
    }

    fn mark(path: &Path, digest: &str) {
        fs::write(path, format!("{digest}\n")).unwrap();
    }

    #[test]
    fn nobody_when_there_is_no_marker() {
        let root = scratch("none");
        assert_eq!(
            owner_at(&root.join("marker"), &root.join("profiles")),
            Ok(None)
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_marker_that_matches_a_known_profile_is_that_local_profile() {
        let root = scratch("local");
        let mine = AccountScope::synthetic_local(b"mine");
        let other = AccountScope::synthetic_local(b"other");
        profile(&root.join("profiles"), &id('a'), other.digest());
        profile(&root.join("profiles"), &id('b'), mine.digest());
        mark(&root.join("marker"), mine.digest());
        assert_eq!(
            owner_at(&root.join("marker"), &root.join("profiles")),
            Ok(Some(TeamOwner {
                owner_scope_digest: mine.digest().to_string(),
                kind: OwnerKind::Local,
                profile_id: Some(id('b')),
            }))
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_marker_no_local_profile_holds_is_an_account_that_signed_in() {
        let root = scratch("google");
        let account = AccountScope::synthetic(b"00000000-0000-4000-8000-000000000001");
        profile(
            &root.join("profiles"),
            &id('a'),
            AccountScope::synthetic_local(b"x").digest(),
        );
        mark(&root.join("marker"), account.digest());
        assert_eq!(
            owner_at(&root.join("marker"), &root.join("profiles")),
            Ok(Some(TeamOwner {
                owner_scope_digest: account.digest().to_string(),
                kind: OwnerKind::Google,
                profile_id: None,
            }))
        );
        // No profiles folder at all (a computer that never made a local profile) is the same answer.
        assert!(matches!(
            owner_at(&root.join("marker"), &root.join("missing")),
            Ok(Some(TeamOwner {
                kind: OwnerKind::Google,
                ..
            }))
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn what_the_profiles_folder_holds_besides_records_does_not_change_the_answer() {
        let root = scratch("noise");
        let mine = AccountScope::synthetic_local(b"mine");
        let profiles = root.join("profiles");
        profile(&profiles, &id('c'), mine.digest());
        fs::write(profiles.join("notes.txt"), "x").unwrap();
        fs::write(profiles.join(format!("{}.json", id('d'))), "not json").unwrap();
        fs::write(profiles.join("short.json"), "{}").unwrap();
        fs::create_dir_all(profiles.join(format!("{}.json", id('e')))).unwrap();
        mark(&root.join("marker"), mine.digest());
        assert!(matches!(
            owner_at(&root.join("marker"), &profiles),
            Ok(Some(TeamOwner { kind: OwnerKind::Local, profile_id: Some(found), .. })) if found == id('c')
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn two_profiles_with_one_digest_name_no_owner() {
        let root = scratch("twice");
        let mine = AccountScope::synthetic_local(b"mine");
        let profiles = root.join("profiles");
        profile(&profiles, &id('a'), mine.digest());
        profile(&profiles, &id('b'), mine.digest());
        mark(&root.join("marker"), mine.digest());
        assert_eq!(
            owner_at(&root.join("marker"), &profiles),
            Err("local_profile_invalid")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_marker_that_is_not_the_products_is_refused_with_a_closed_code() {
        let root = scratch("invalid");
        let marker = root.join("marker");
        let profiles = root.join("profiles");
        for content in [
            "",
            "not a digest\n",
            &"A".repeat(64),
            &"a".repeat(63),
            &"a".repeat(200),
        ] {
            fs::write(&marker, content).unwrap();
            assert_eq!(
                owner_at(&marker, &profiles),
                Err("local_account_owner_invalid"),
                "{content:?}"
            );
        }
        fs::remove_file(&marker).unwrap();
        fs::create_dir(&marker).unwrap();
        assert_eq!(
            owner_at(&marker, &profiles),
            Err("local_account_owner_invalid")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_place_of_the_marker_is_not_followed() {
        let root = scratch("link");
        let real = root.join("elsewhere");
        mark(&real, AccountScope::synthetic(b"someone").digest());
        std::os::unix::fs::symlink(&real, root.join("marker")).unwrap();
        assert_eq!(
            owner_at(&root.join("marker"), &root.join("profiles")),
            Err("local_account_owner_invalid")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_marker_says_unavailable_and_nothing_is_written() {
        use std::os::unix::fs::PermissionsExt;
        let root = scratch("unreadable");
        let marker = root.join("marker");
        mark(&marker, AccountScope::synthetic(b"someone").digest());
        fs::set_permissions(&marker, fs::Permissions::from_mode(0o000)).unwrap();
        // A process allowed to read anything (root) reads it anyway: the check is for the ordinary user.
        if fs::read_to_string(&marker).is_err() {
            assert_eq!(
                owner_at(&marker, &root.join("profiles")),
                Err("local_account_owner_unavailable")
            );
        }
        fs::set_permissions(&marker, fs::Permissions::from_mode(0o600)).unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reading_changes_nothing_on_disk() {
        let root = scratch("readonly");
        let mine = AccountScope::synthetic_local(b"mine");
        let profiles = root.join("profiles");
        profile(&profiles, &id('a'), mine.digest());
        mark(&root.join("marker"), mine.digest());
        let listing = |dir: &Path| {
            let mut names: Vec<_> = fs::read_dir(dir)
                .unwrap()
                .map(|entry| {
                    let entry = entry.unwrap();
                    (
                        entry.file_name(),
                        fs::read(entry.path()).unwrap_or_default(),
                    )
                })
                .collect();
            names.sort();
            names
        };
        let before = (listing(&root), listing(&profiles));
        owner_at(&root.join("marker"), &profiles).unwrap();
        owner_at(&root.join("nothing"), &profiles).unwrap();
        assert_eq!(before, (listing(&root), listing(&profiles)));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_answer_carries_the_names_the_page_reads_and_nothing_more() {
        let local = serde_json::to_value(TeamOwner {
            owner_scope_digest: id('a'),
            kind: OwnerKind::Local,
            profile_id: Some(id('b')),
        })
        .unwrap();
        assert_eq!(
            local,
            serde_json::json!({"ownerScopeDigest": id('a'), "kind": "local", "profileId": id('b')})
        );
        let google = serde_json::to_value(TeamOwner {
            owner_scope_digest: id('a'),
            kind: OwnerKind::Google,
            profile_id: None,
        })
        .unwrap();
        assert_eq!(
            google,
            serde_json::json!({"ownerScopeDigest": id('a'), "kind": "google"})
        );
        assert_eq!(
            serde_json::to_value(failure("invalid_request")).unwrap(),
            serde_json::json!({"code": "invalid_request"})
        );
    }

    #[test]
    fn only_the_main_window_may_ask_and_the_command_is_registered_and_writes_nothing() {
        assert!(window_may_read("main"));
        for other in [
            "",
            "Main",
            "main2",
            "ssh-key-dialog",
            "new-position-notification",
        ] {
            assert!(!window_may_read(other), "{other:?}");
        }
        let source = include_str!("team_owner.rs");
        let command = source
            .split("pub(crate) fn team_owner_read")
            .nth(1)
            .and_then(|rest| rest.split("#[cfg(test)]").next())
            .unwrap();
        assert!(command.contains("!window_may_read(window.label())"));
        for write in [
            "fs::write",
            "fs::remove",
            "fs::create",
            "fs::rename",
            "OpenOptions",
            "set_permissions",
        ] {
            let body = source.split("#[cfg(test)]").next().unwrap();
            assert!(!body.contains(write), "{write}");
        }
        let lib = include_str!("lib.rs");
        assert!(lib.contains("mod team_owner;") && lib.contains("team_owner::team_owner_read,"));
    }
}

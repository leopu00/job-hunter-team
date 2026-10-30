//! Who owns the team of this computer, read from the owner marker the app keeps in its own data (`account_scope::local_owner_marker_path`):
//! `runtime_local_team_owner_identity` says whose it is (a local profile, with its id, or an account that
//! signed in; the digest the marker holds does not leave) and `runtime_local_team_owner` says whether it is the active profile's.
//!
//! A read and nothing else: no marker is written, claimed, repaired or removed, no scope is activated,
//! no file besides the marker and the local profile records is opened. The answer is whether the marker's
//! digest belongs to a local profile this app knows (then the profile's id) or to an account that signed
//! in, or «nobody» when the computer has no marker yet.

use crate::account_scope::{
    load_local_scope_at, local_owner_marker_path, local_profiles_dir, local_runtime_home, unowned_home_may_be_claimed,
    valid_digest, valid_profile_id, AccountScope, AccountScopeState,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::State;

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
    kind: OwnerKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    profile_id: Option<String>,
}

/// How the marker stands to the active profile: it names it, it names another, it is not there and the
/// active profile may claim the home (the first one in does), or it is not there and the home holds
/// someone's data that this profile may not claim (nobody owns them, and this profile cannot take them).
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Ownership {
    #[serde(rename = "self")]
    Mine,
    Other,
    None,
    Nobody,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub(crate) struct TeamOwnership {
    owner: Ownership,
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
            kind: OwnerKind::Local,
            profile_id: Some(profile_id),
        },
        None => TeamOwner {
            kind: OwnerKind::Google,
            profile_id: None,
        },
    }))
}

/// The marker of `home` against the active scope. «None» only when the home is the active scope's to claim
/// (the rule of `validate_or_claim_local_owner`); a home with someone's data and no marker that this scope
/// may not claim is «nobody», never «other» by guess. A marker or home that cannot be read stays a code.
fn ownership_with(home: &Path, marker: &Path, active: &AccountScope) -> Result<Ownership, &'static str> {
    match marker_digest(marker)? {
        Some(digest) if digest == active.digest() => Ok(Ownership::Mine),
        Some(_) => Ok(Ownership::Other),
        None => match unowned_home_may_be_claimed(home, active) {
            Ok(()) => Ok(Ownership::None),
            Err("local_account_owner_missing") => Ok(Ownership::Nobody),
            Err(code) => Err(code),
        },
    }
}

/// The tests keep the marker inside the home they build.
#[cfg(test)]
fn ownership_at(home: &Path, active: &AccountScope) -> Result<Ownership, &'static str> {
    ownership_with(home, &home.join(".desktop-account-scope"), active)
}

fn paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), &'static str> {
    Ok((local_owner_marker_path(app)?, local_profiles_dir(app)?))
}

/// Who owns the team of this computer, or `null` when nobody does yet. Reads only, so it answers in every
/// view; the main window alone may ask.
#[tauri::command]
pub(crate) fn runtime_local_team_owner_identity(
    window: tauri::Window,
    app: tauri::AppHandle,
) -> Result<Option<TeamOwner>, TeamOwnerError> {
    if !window_may_read(window.label()) {
        return Err(failure("invalid_request"));
    }
    let (marker, profiles) = paths(&app).map_err(failure)?;
    owner_at(&marker, &profiles).map_err(failure)
}

/// Whether the team of this computer is the active profile's: «self», «other», «none» when the home has no
/// owner yet and the active profile would claim it, or «nobody» when it holds data with no owner that this
/// profile may not claim. Reads only; no digest or id leaves. Without an
/// active profile, or with a marker that cannot be read, a closed code instead of a guess.
#[tauri::command]
pub(crate) fn runtime_local_team_owner(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<TeamOwnership, TeamOwnerError> {
    if !window_may_read(window.label()) {
        return Err(failure("invalid_request"));
    }
    let active = scopes.active().map_err(failure)?;
    let marker = local_owner_marker_path(&app).map_err(failure)?;
    let home = local_runtime_home(&app).map_err(failure)?;
    ownership_with(&home, &marker, &active)
        .map(|owner| TeamOwnership { owner })
        .map_err(failure)
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
            kind: OwnerKind::Local,
            profile_id: Some(id('b')),
        })
        .unwrap();
        assert_eq!(
            local,
            serde_json::json!({"kind": "local", "profileId": id('b')})
        );
        let google = serde_json::to_value(TeamOwner {
            kind: OwnerKind::Google,
            profile_id: None,
        })
        .unwrap();
        assert_eq!(google, serde_json::json!({"kind": "google"}));
        assert_eq!(
            serde_json::to_value(failure("invalid_request")).unwrap(),
            serde_json::json!({"code": "invalid_request"})
        );
    }

    const MARKER: &str = ".desktop-account-scope";

    #[test]
    fn the_marker_of_the_active_profile_is_self_another_profiles_is_other() {
        let home = scratch("ownership");
        let mine = AccountScope::synthetic(b"00000000-0000-4000-8000-000000000001");
        let other = AccountScope::synthetic(b"00000000-0000-4000-8000-000000000002");
        let local = AccountScope::synthetic_local(b"mine");
        mark(&home.join(MARKER), mine.digest());
        assert_eq!(ownership_at(&home, &mine), Ok(Ownership::Mine));
        assert_eq!(ownership_at(&home, &other), Ok(Ownership::Other));
        // The same secret as a local profile is another scope: the domain keeps them apart.
        assert_eq!(ownership_at(&home, &local), Ok(Ownership::Other));
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn a_home_nobody_holds_is_none_whatever_the_active_profile() {
        let root = scratch("unowned");
        let account = AccountScope::synthetic(b"someone");
        let local = AccountScope::synthetic_local(b"mine");
        assert_eq!(
            ownership_at(&root.join("missing"), &account),
            Ok(Ownership::None)
        );
        assert_eq!(ownership_at(&root, &account), Ok(Ownership::None));
        assert_eq!(ownership_at(&root, &local), Ok(Ownership::None));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn leftovers_only_is_none_and_data_the_profile_may_not_claim_is_nobody() {
        let home = scratch("leftovers");
        let account = AccountScope::synthetic(b"someone");
        let local = AccountScope::synthetic_local(b"mine");
        fs::create_dir_all(home.join("logs")).unwrap();
        fs::write(home.join("logs").join("run.log"), "").unwrap();
        assert_eq!(ownership_at(&home, &account), Ok(Ownership::None));
        // Data of a version before this app, no marker: a local profile may take it, an account may not (nobody
        // owns it and it cannot), and neither is told «other» for it.
        fs::write(home.join("jht.config.json"), "{}").unwrap();
        assert_eq!(ownership_at(&home, &local), Ok(Ownership::None));
        assert_eq!(ownership_at(&home, &account), Ok(Ownership::Nobody));
        fs::remove_file(home.join("jht.config.json")).unwrap();
        fs::write(home.join("notes.txt"), "x").unwrap();
        assert_eq!(ownership_at(&home, &local), Ok(Ownership::Nobody));
        // the profile that may claim it is not the one nobody-ness depends on: with the marker written, it is self
        mark(&home.join(MARKER), local.digest());
        assert_eq!(ownership_at(&home, &local), Ok(Ownership::Mine));
        assert_eq!(ownership_at(&home, &account), Ok(Ownership::Other));
        fs::remove_dir_all(home).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_home_that_cannot_be_read_is_a_code_not_nobody() {
        let root = scratch("home-is-a-file");
        let account = AccountScope::synthetic(b"someone");
        let file = root.join("home");
        fs::write(&file, "x").unwrap();
        assert_eq!(
            ownership_at(&file, &account),
            Err("local_account_owner_unavailable")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_marker_that_cannot_be_trusted_is_a_code_never_other() {
        let home = scratch("distrust");
        let account = AccountScope::synthetic(b"someone");
        fs::write(home.join(MARKER), "not a digest").unwrap();
        assert_eq!(
            ownership_at(&home, &account),
            Err("local_account_owner_invalid")
        );
        fs::write(home.join(MARKER), "a".repeat(200)).unwrap();
        assert_eq!(
            ownership_at(&home, &account),
            Err("local_account_owner_invalid")
        );
        fs::remove_file(home.join(MARKER)).unwrap();
        fs::create_dir(home.join(MARKER)).unwrap();
        assert_eq!(
            ownership_at(&home, &account),
            Err("local_account_owner_invalid")
        );
        fs::remove_dir_all(home).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_in_place_of_the_owner_marker_is_a_code_not_an_answer() {
        let home = scratch("ownership-link");
        let account = AccountScope::synthetic(b"someone");
        mark(&home.join("elsewhere"), account.digest());
        std::os::unix::fs::symlink(home.join("elsewhere"), home.join(MARKER)).unwrap();
        assert_eq!(
            ownership_at(&home, &account),
            Err("local_account_owner_invalid")
        );
        fs::remove_dir_all(home).unwrap();
    }

    #[test]
    fn asking_who_owns_the_team_writes_nothing_and_says_no_digest() {
        let home = scratch("ownership-readonly");
        let account = AccountScope::synthetic(b"someone");
        let before = fs::read_dir(&home).unwrap().count();
        assert_eq!(ownership_at(&home, &account), Ok(Ownership::None));
        assert_eq!(fs::read_dir(&home).unwrap().count(), before);
        assert!(!home.join(MARKER).exists());
        for (owner, word) in [
            (Ownership::Mine, "self"),
            (Ownership::Other, "other"),
            (Ownership::None, "none"),
            (Ownership::Nobody, "nobody"),
        ] {
            let said = serde_json::to_value(TeamOwnership { owner }).unwrap();
            assert_eq!(said, serde_json::json!({ "owner": word }));
        }
        fs::remove_dir_all(home).unwrap();
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
        for name in [
            "pub(crate) fn runtime_local_team_owner_identity",
            "pub(crate) fn runtime_local_team_owner(",
        ] {
            let command = source
                .split(name)
                .nth(1)
                .and_then(|rest| rest.split("#[cfg(test)]").next())
                .unwrap();
            assert!(
                command.contains("!window_may_read(window.label())"),
                "{name}"
            );
        }
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
        assert!(lib.contains("mod team_owner;"));
        for command in [
            "runtime_local_team_owner_identity,",
            "runtime_local_team_owner,",
        ] {
            assert!(lib.contains(&format!("team_owner::{command}")), "{command}");
        }
    }
}

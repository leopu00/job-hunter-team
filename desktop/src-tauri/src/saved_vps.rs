//! Account-scoped saved VPS declarations.  They are connection *pointers*,
//! never key material: the native side stores a key path only and does no SSH.

use crate::{
    account_scope::{AccountScope, AccountScopeState},
    direct_chat::window_may_write,
    runtime_host::{set_private_dir_permissions, set_private_permissions},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, State};

const MAX_BYTES: usize = 64 * 1024;
const MAX_SAVED: usize = 64;
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Serialize)]
pub(crate) struct SavedVpsError {
    code: &'static str,
}
fn failure(code: &'static str) -> SavedVpsError {
    SavedVpsError { code }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SavedVps {
    id: String,
    name: String,
    address: String,
    user: String,
    port: u16,
    key_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    team_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    container: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SavedVpsAdd {
    name: String,
    address: String,
    user: String,
    port: u16,
    key_path: String,
    fingerprint: Option<String>,
    team_id: Option<String>,
    container: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SavedVpsRename {
    id: String,
    name: String,
}

fn clean(value: &str, limit: usize) -> Option<String> {
    let cleaned = value.trim();
    (!cleaned.is_empty() && cleaned.len() <= limit && !cleaned.chars().any(char::is_control))
        .then(|| cleaned.to_owned())
}
fn optional(value: Option<String>, limit: usize) -> Option<Option<String>> {
    match value {
        None => Some(None),
        Some(value) => clean(&value, limit).map(Some),
    }
}
fn valid_id(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
fn valid(vps: &SavedVps) -> bool {
    valid_id(&vps.id)
        && clean(&vps.name, 80).as_deref() == Some(vps.name.as_str())
        && clean(&vps.address, 255).as_deref() == Some(vps.address.as_str())
        && clean(&vps.user, 128).as_deref() == Some(vps.user.as_str())
        && vps.port > 0
        && clean(&vps.key_path, 1024).as_deref() == Some(vps.key_path.as_str())
        && vps
            .fingerprint
            .as_ref()
            .map_or(true, |v| clean(v, 256).as_deref() == Some(v.as_str()))
        && vps
            .team_id
            .as_ref()
            .map_or(true, |v| clean(v, 128).as_deref() == Some(v.as_str()))
        && vps
            .container
            .as_ref()
            .map_or(true, |v| clean(v, 128).as_deref() == Some(v.as_str()))
}

fn path_at(root: &Path, scope: &AccountScope) -> PathBuf {
    root.join("accounts")
        .join(scope.digest())
        .join("saved-vps.json")
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| "saved_vps_storage_unavailable")
}
fn read_at(path: &Path) -> Result<Vec<SavedVps>, &'static str> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err("saved_vps_storage_unavailable"),
    };
    if !metadata.file_type().is_file() || metadata.len() as usize > MAX_BYTES {
        return Err("saved_vps_storage_unavailable");
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options
        .open(path)
        .map_err(|_| "saved_vps_storage_unavailable")?;
    let opened = file
        .metadata()
        .map_err(|_| "saved_vps_storage_unavailable")?;
    if !opened.is_file() || opened.len() as usize > MAX_BYTES {
        return Err("saved_vps_storage_unavailable");
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "saved_vps_storage_unavailable")?;
    if bytes.len() > MAX_BYTES {
        return Err("saved_vps_storage_unavailable");
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "saved_vps_storage_unavailable")?;
    let rows: Vec<SavedVps> =
        serde_json::from_value(value.clone()).map_err(|_| "saved_vps_storage_unavailable")?;
    if rows.len() > MAX_SAVED
        || rows.iter().any(|row| !valid(row))
        || serde_json::to_value(&rows).ok().as_ref() != Some(&value)
    {
        return Err("saved_vps_storage_unavailable");
    }
    Ok(rows)
}
fn write_at(path: &Path, rows: &[SavedVps]) -> Result<(), &'static str> {
    let parent = path.parent().ok_or("saved_vps_storage_unavailable")?;
    fs::create_dir_all(parent).map_err(|_| "saved_vps_storage_unavailable")?;
    if fs::symlink_metadata(parent)
        .map_err(|_| "saved_vps_storage_unavailable")?
        .file_type()
        .is_symlink()
    {
        return Err("saved_vps_storage_unavailable");
    }
    set_private_dir_permissions(parent).map_err(|_| "saved_vps_storage_unavailable")?;
    let bytes = serde_json::to_vec(rows).map_err(|_| "saved_vps_storage_unavailable")?;
    if bytes.len() > MAX_BYTES {
        return Err("saved_vps_storage_unavailable");
    }
    let nonce = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(".saved-vps-{}-{nonce}.tmp", std::process::id()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "saved_vps_storage_unavailable")?;
    let result = (|| {
        set_private_permissions(&temporary).map_err(|_| "saved_vps_storage_unavailable")?;
        file.write_all(&bytes)
            .map_err(|_| "saved_vps_storage_unavailable")?;
        file.sync_all()
            .map_err(|_| "saved_vps_storage_unavailable")?;
        drop(file);
        fs::rename(&temporary, path).map_err(|_| "saved_vps_storage_unavailable")?;
        Ok(())
    })();
    let _ = fs::remove_file(temporary);
    result
}
fn next_id() -> Result<String, &'static str> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "saved_vps_storage_unavailable")?
        .as_nanos();
    Ok(format!(
        "{:016x}{:016x}",
        now as u64,
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    ))
}
fn add_at(path: &Path, input: SavedVpsAdd) -> Result<SavedVps, &'static str> {
    if input.port == 0 {
        return Err("saved_vps_invalid");
    }
    let row = SavedVps {
        id: next_id()?,
        name: clean(&input.name, 80).ok_or("saved_vps_invalid")?,
        address: clean(&input.address, 255).ok_or("saved_vps_invalid")?,
        user: clean(&input.user, 128).ok_or("saved_vps_invalid")?,
        port: input.port,
        key_path: clean(&input.key_path, 1024).ok_or("saved_vps_invalid")?,
        fingerprint: optional(input.fingerprint, 256).ok_or("saved_vps_invalid")?,
        team_id: optional(input.team_id, 128).ok_or("saved_vps_invalid")?,
        container: optional(input.container, 128).ok_or("saved_vps_invalid")?,
    };
    let mut rows = read_at(path)?;
    if rows.len() >= MAX_SAVED
        || rows
            .iter()
            .any(|saved| saved.name.eq_ignore_ascii_case(&row.name))
    {
        return Err("saved_vps_duplicate");
    }
    rows.push(row.clone());
    write_at(path, &rows)?;
    Ok(row)
}

async fn with_scope<T: Send + 'static>(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    operation: impl FnOnce(PathBuf) -> Result<T, &'static str> + Send + 'static,
) -> Result<T, SavedVpsError> {
    if !window_may_write(window.label()) {
        return Err(failure("window_not_allowed"));
    }
    let expected = scopes.active().map_err(failure)?;
    let state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _lock = state.lock_expected(&worker_expected).map_err(failure)?;
        operation(path_at(&root(&app).map_err(failure)?, &worker_expected)).map_err(failure)
    })
    .await
    .unwrap_or_else(|_| Err(failure("saved_vps_storage_unavailable")));
    let _lock = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

#[tauri::command]
pub(crate) async fn saved_vps_list(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<Vec<SavedVps>, SavedVpsError> {
    with_scope(window, app, scopes, |path| read_at(&path)).await
}
#[tauri::command]
pub(crate) async fn saved_vps_add(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    input: SavedVpsAdd,
) -> Result<SavedVps, SavedVpsError> {
    with_scope(window, app, scopes, move |path| add_at(&path, input)).await
}
#[tauri::command]
pub(crate) async fn saved_vps_rename(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    input: SavedVpsRename,
) -> Result<SavedVps, SavedVpsError> {
    with_scope(window, app, scopes, move |path| {
        let mut rows = read_at(&path)?;
        let name = clean(&input.name, 80).ok_or("saved_vps_invalid")?;
        if rows
            .iter()
            .any(|row| row.id != input.id && row.name.eq_ignore_ascii_case(&name))
        {
            return Err("saved_vps_duplicate");
        }
        let row = rows
            .iter_mut()
            .find(|row| row.id == input.id)
            .ok_or("saved_vps_not_found")?;
        row.name = name;
        let result = row.clone();
        write_at(&path, &rows)?;
        Ok(result)
    })
    .await
}
#[tauri::command]
pub(crate) async fn saved_vps_remove(
    window: tauri::Window,
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
    id: String,
) -> Result<(), SavedVpsError> {
    with_scope(window, app, scopes, move |path| {
        if !valid_id(&id) {
            return Err("saved_vps_invalid");
        }
        let mut rows = read_at(&path)?;
        let before = rows.len();
        rows.retain(|row| row.id != id);
        if rows.len() == before {
            return Err("saved_vps_not_found");
        }
        write_at(&path, &rows)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_vps_is_private_canonical_and_never_contains_key_bytes() {
        let root = std::env::temp_dir().join(format!("jht-saved-vps-{}", std::process::id()));
        let scope = AccountScope::synthetic(b"saved-vps");
        let path = path_at(&root, &scope);
        let added = add_at(
            &path,
            SavedVpsAdd {
                name: "Work VPS".into(),
                address: "vps.example.test".into(),
                user: "deploy".into(),
                port: 22,
                key_path: "/keys/id_ed25519".into(),
                fingerprint: None,
                team_id: Some("team_1".into()),
                container: Some("jht".into()),
            },
        )
        .unwrap();
        assert!(valid_id(&added.id));
        assert_eq!(read_at(&path).unwrap(), vec![added]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn saved_vps_commands_are_registered_on_the_desktop_bridge() {
        let bridge = include_str!("lib.rs");
        for command in [
            "saved_vps_list",
            "saved_vps_add",
            "saved_vps_rename",
            "saved_vps_remove",
        ] {
            assert!(
                bridge.contains(&format!("saved_vps::{command}")),
                "{command}"
            );
        }
    }
}

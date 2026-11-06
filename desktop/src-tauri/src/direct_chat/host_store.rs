use super::*;

pub(super) fn connection_config_path(
    app: &tauri::AppHandle,
    scope: &AccountScope,
) -> Result<PathBuf, DirectChatError> {
    app.path()
        .app_local_data_dir()
        .map(|path| connection_config_path_at(&path, scope))
        .map_err(|_| failure("storage_unavailable"))
}

pub(super) fn connection_config_path_at(root: &Path, scope: &AccountScope) -> PathBuf {
    root.join("accounts")
        .join(scope.digest())
        .join("direct-chat-host.json")
}

pub(crate) fn verify_optional_playground_local_host_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(), &'static str> {
    let path = connection_config_path_at(root, scope);
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err("playground_reset_host_unavailable"),
    };
    if !metadata.file_type().is_file() || metadata.len() > 4096 {
        return Err("playground_reset_host_invalid");
    }
    let raw = fs::read(path).map_err(|_| "playground_reset_host_unavailable")?;
    let value: Value = serde_json::from_slice(&raw).map_err(|_| "playground_reset_host_invalid")?;
    let object = value.as_object().ok_or("playground_reset_host_invalid")?;
    match object.get("kind").and_then(Value::as_str) {
        Some("local") if object.len() == 1 => Ok(()),
        Some("vps") => Err("playground_reset_host_not_local"),
        _ => Err("playground_reset_host_invalid"),
    }
}

pub(crate) fn verify_migration_local_host_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(), &'static str> {
    let path = connection_config_path_at(root, scope);
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options
        .open(&path)
        .map_err(|_| "local_migration_host_missing")?;
    let metadata = file
        .metadata()
        .map_err(|_| "local_migration_host_invalid")?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > 4096 {
        return Err("local_migration_host_invalid");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let parent = path.parent().ok_or("local_migration_host_invalid")?;
        let parent_metadata = fs::metadata(parent).map_err(|_| "local_migration_host_invalid")?;
        if metadata.uid() != parent_metadata.uid()
            || metadata.permissions().mode() & 0o777 != 0o600
            || parent_metadata.permissions().mode() & 0o022 != 0
        {
            return Err("local_migration_host_invalid");
        }
    }
    let mut raw = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take(4097)
        .read_to_end(&mut raw)
        .map_err(|_| "local_migration_host_invalid")?;
    if raw.len() as u64 != metadata.len() {
        return Err("local_migration_host_invalid");
    }
    let value: Value = serde_json::from_slice(&raw).map_err(|_| "local_migration_host_invalid")?;
    let object = value.as_object().ok_or("local_migration_host_invalid")?;
    match object.get("kind").and_then(Value::as_str) {
        Some("local") if object.len() == 1 => Ok(()),
        Some("vps") => Err("local_migration_host_not_local"),
        _ => Err("local_migration_host_invalid"),
    }
}

// Every official connection writer shares this barrier. Registration may fill
// an absent host, but must never overwrite an already selected different host.
pub(super) static HOST_PERSIST: Mutex<()> = Mutex::new(());

pub(super) fn persist_host_at(path: &Path, host: &ExecutionHost) -> Result<(), DirectChatError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| failure("storage_unavailable"))?;
        if fs::symlink_metadata(parent)
            .map_err(|_| failure("storage_unavailable"))?
            .file_type()
            .is_symlink()
        {
            return Err(failure("storage_unavailable"));
        }
        set_private_dir_permissions(parent).map_err(failure)?;
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| failure("storage_unavailable"))?
        .as_nanos();
    let temporary = path.with_extension(format!("tmp-{}-{nonce}", std::process::id()));
    let bytes = serde_json::to_vec(host).map_err(|_| failure("storage_unavailable"))?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| failure("storage_unavailable"))?;
    let result = (|| {
        set_private_permissions(&temporary).map_err(failure)?;
        file.write_all(&bytes)
            .map_err(|_| failure("storage_unavailable"))?;
        file.sync_all()
            .map_err(|_| failure("storage_unavailable"))?;
        drop(file);
        fs::rename(&temporary, path).map_err(|_| failure("storage_unavailable"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(super) fn persist_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<(), DirectChatError> {
    let _write = HOST_PERSIST
        .lock()
        .map_err(|_| failure("storage_unavailable"))?;
    persist_host_at(&connection_config_path(app, scope)?, host)
}

pub(super) fn read_assistance_host_at(path: &Path) -> Result<ExecutionHost, &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "host_config_invalid")?;
    if !metadata.file_type().is_file() || metadata.len() > 4096 {
        return Err("host_config_invalid");
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options.open(path).map_err(|_| "host_config_invalid")?;
    let opened = file.metadata().map_err(|_| "host_config_invalid")?;
    if !opened.is_file() || opened.len() > 4096 {
        return Err("host_config_invalid");
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| "host_config_invalid")?;
    if bytes.len() > 4096 {
        return Err("host_config_invalid");
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "host_config_invalid")?;
    let host: ExecutionHost =
        serde_json::from_value(value.clone()).map_err(|_| "host_config_invalid")?;
    if serde_json::to_value(&host).map_err(|_| "host_config_invalid")? != value {
        return Err("host_config_invalid");
    }
    Ok(host)
}

pub(super) fn register_assistance_host_at(path: &Path, host: &ExecutionHost) -> Result<(), &'static str> {
    let _write = HOST_PERSIST.lock().map_err(|_| "storage_unavailable")?;
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            persist_host_at(path, host).map_err(|error| error.code)?;
        }
        Err(_) => return Err("storage_unavailable"),
        Ok(_) => {
            if read_assistance_host_at(path)? != *host {
                return Err("browser_connection_changed");
            }
            // Same host is idempotent: leave existing config bytes untouched.
        }
    }
    if read_assistance_host_at(path)? != *host {
        return Err("browser_connection_changed");
    }
    Ok(())
}

pub(crate) fn register_assistance_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<(), &'static str> {
    let path = connection_config_path(app, scope).map_err(|error| error.code)?;
    register_assistance_host_at(&path, host)
}

pub(crate) fn persist_onboarding_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: &ExecutionHost,
) -> Result<(), &'static str> {
    persist_host(app, scope, host).map_err(|error| error.code)
}

/// Removes only this account's persisted connection configuration. It is used
/// after the existing-team selection and candidate have been cleared.
pub(crate) fn clear_persisted_host_at(
    root: &Path,
    scope: &AccountScope,
) -> Result<(), &'static str> {
    match fs::remove_file(connection_config_path_at(root, scope)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("storage_unavailable"),
    }
}

pub(super) fn load_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
) -> Result<ExecutionHost, DirectChatError> {
    let raw = fs::read(connection_config_path(app, scope)?)
        .map_err(|_| failure("host_not_configured"))?;
    serde_json::from_slice(&raw).map_err(|_| failure("host_config_invalid"))
}

pub(crate) fn load_persisted_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
) -> Result<ExecutionHost, &'static str> {
    load_host(app, scope).map_err(|error| error.code)
}

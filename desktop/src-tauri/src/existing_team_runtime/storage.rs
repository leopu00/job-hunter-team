use super::*;

pub(super) const CANDIDATE_FILE: &str = "existing-team-runtime-candidate.json";
pub(super) const SELECTION_FILE: &str = "existing-team-runtime-selection.json";
pub(super) const OWN_VPS_FILE: &str = "own-vps-marker.json";
pub(super) const MAX_BYTES: usize = 8192;
pub(super) fn account_dir(root: &Path, scope: &AccountScope) -> PathBuf {
    root.join("accounts").join(scope.digest())
}

pub(super) fn path(root: &Path, scope: &AccountScope, name: &str) -> PathBuf {
    account_dir(root, scope).join(name)
}

pub(super) fn private_file(
    path: &Path,
    missing: &'static str,
    invalid: &'static str,
) -> Result<(), &'static str> {
    let meta = fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            missing
        } else {
            invalid
        }
    })?;
    let parent = path.parent().ok_or(invalid)?;
    let parent_meta = fs::symlink_metadata(parent).map_err(|_| invalid)?;
    if meta.file_type().is_symlink()
        || !meta.file_type().is_file()
        || meta.len() == 0
        || meta.len() > MAX_BYTES as u64
        || parent_meta.file_type().is_symlink()
        || !parent_meta.is_dir()
    {
        return Err(invalid);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if meta.uid() != unsafe { libc::geteuid() }
            || meta.uid() != parent_meta.uid()
            || meta.permissions().mode() & 0o777 != 0o600
            || parent_meta.permissions().mode() & 0o022 != 0
        {
            return Err(invalid);
        }
    }
    Ok(())
}

pub(super) fn read_bytes(
    path: &Path,
    missing: &'static str,
    invalid: &'static str,
) -> Result<Vec<u8>, &'static str> {
    private_file(path, missing, invalid)?;
    let mut options = File::options();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let mut file = options.open(path).map_err(|_| invalid)?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid)?;
    if bytes.len() > MAX_BYTES {
        return Err(invalid);
    }
    Ok(bytes)
}

pub(crate) fn root(app: &tauri::AppHandle) -> Result<PathBuf, &'static str> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| "existing_team_runtime_unavailable")
}

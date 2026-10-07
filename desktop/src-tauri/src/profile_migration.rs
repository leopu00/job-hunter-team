//! Transactional ownership transfer from a backend-issued local profile to
//! the currently authenticated account. Profile bytes remain in place: only
//! their manifest is attested and the local runtime owner marker changes.

use crate::account_scope::AccountScope;
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

const RECEIPT_SCHEMA: u8 = 1;
const PROFILE_MAX_BYTES: u64 = 64 * 1024;
const SUMMARY_MAX_BYTES: u64 = 32 * 1024;
const RECEIPT_MAX_BYTES: u64 = 4096;
const SUMMARY_NAMES: &[&str] = &["about", "goals", "preferences", "strengths"];
const BLOCK_KINDS: &[&str] = &[
    "distribution",
    "key_points",
    "key_value",
    "narrative",
    "tag_list",
    "timeline",
];

#[derive(Clone, Debug)]
pub(crate) struct MigrationPaths {
    pub(crate) app_data: PathBuf,
    pub(crate) runtime_home: PathBuf,
    pub(crate) source_capability: PathBuf,
}

impl MigrationPaths {
    fn owner(&self) -> PathBuf {
        self.runtime_home.join(".desktop-account-scope")
    }

    fn profile(&self) -> PathBuf {
        self.runtime_home.join("profile")
    }

    fn migrations(&self) -> PathBuf {
        self.app_data.join("account-migrations")
    }

    fn retired(&self) -> PathBuf {
        self.app_data.join("local-profiles-retired")
    }

    fn target_account(&self, target: &AccountScope) -> PathBuf {
        self.app_data.join("accounts").join(target.digest())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MigrationArtifact {
    id: String,
    sha256: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum MigrationState {
    Prepared,
    Committed,
    RolledBack,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MigrationReceipt {
    schema_version: u8,
    migration_id: String,
    kind: String,
    state: MigrationState,
    source_scope_digest: String,
    target_scope_digest: String,
    artifacts: Vec<MigrationArtifact>,
    manifest_sha256: String,
    owner_before_sha256: String,
    owner_after_sha256: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LocalCapabilityRecord {
    scope_digest: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MigrationCommitted {
    pub(crate) receipt_hash: String,
}

fn sha256(domain: &[u8], parts: &[&[u8]]) -> String {
    let mut digest = Sha256::new();
    digest.update(domain);
    for part in parts {
        digest.update(part);
    }
    format!("{:x}", digest.finalize())
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.bytes()
        .zip(right.bytes())
        .fold(0u8, |difference, (a, b)| difference | (a ^ b))
        == 0
}

fn valid_hex(value: &str, size: usize) -> bool {
    value.len() == size
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn private_dir(path: &Path, code: &'static str) -> Result<(), &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| code)?;
    if !metadata.file_type().is_dir() {
        return Err(code);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let parent = path.parent().ok_or(code)?;
        let parent_metadata = fs::metadata(parent).map_err(|_| code)?;
        if metadata.uid() != parent_metadata.uid() || metadata.permissions().mode() & 0o777 != 0o700
        {
            return Err(code);
        }
    }
    // Windows has no mode to compare: an existing directory gets the same
    // owner-only ACL as a new one, read back, or the operation stops.
    #[cfg(not(unix))]
    crate::runtime_host::set_private_dir_permissions(path).map_err(|_| code)?;
    Ok(())
}

fn owned_nonwritable_dir(path: &Path, code: &'static str) -> Result<(), &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| code)?;
    if !metadata.file_type().is_dir() {
        return Err(code);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let parent = path.parent().ok_or(code)?;
        let parent_metadata = fs::metadata(parent).map_err(|_| code)?;
        if metadata.uid() != parent_metadata.uid() || metadata.permissions().mode() & 0o022 != 0 {
            return Err(code);
        }
    }
    Ok(())
}

fn create_private_dir(path: &Path, code: &'static str) -> Result<(), &'static str> {
    match fs::symlink_metadata(path) {
        Ok(_) => return private_dir(path, code),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(code),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .mode(0o700)
            .create(path)
            .map_err(|_| code)?;
    }
    #[cfg(not(unix))]
    fs::create_dir(path).map_err(|_| code)?;
    private_dir(path, code)
}

fn read_regular_bounded(
    path: &Path,
    maximum: u64,
    code: &'static str,
) -> Result<Vec<u8>, &'static str> {
    read_regular_bounded_with_metadata(path, maximum, code).map(|(bytes, _)| bytes)
}

fn read_regular_bounded_with_metadata(
    path: &Path,
    maximum: u64,
    code: &'static str,
) -> Result<(Vec<u8>, fs::Metadata), &'static str> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(|_| code)?;
    let metadata = file.metadata().map_err(|_| code)?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > maximum {
        return Err(code);
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| code)?;
    if bytes.len() as u64 != metadata.len() || bytes.len() as u64 > maximum {
        return Err(code);
    }
    Ok((bytes, metadata))
}

fn read_private_capability(path: &Path) -> Result<LocalCapabilityRecord, &'static str> {
    private_dir(
        path.parent().ok_or("local_migration_source_invalid")?,
        "local_migration_source_invalid",
    )?;
    let (bytes, metadata) =
        read_regular_bounded_with_metadata(path, 256, "local_migration_source_invalid")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let parent = path.parent().ok_or("local_migration_source_invalid")?;
        let parent_metadata = fs::metadata(parent).map_err(|_| "local_migration_source_invalid")?;
        if metadata.uid() != parent_metadata.uid() || metadata.permissions().mode() & 0o777 != 0o600
        {
            return Err("local_migration_source_invalid");
        }
    }
    let record: LocalCapabilityRecord =
        serde_json::from_slice(&bytes).map_err(|_| "local_migration_source_invalid")?;
    if !valid_hex(&record.scope_digest, 64) {
        return Err("local_migration_source_invalid");
    }
    Ok(record)
}

fn validate_source_capability(path: &Path, source: &AccountScope) -> Result<(), &'static str> {
    let record = read_private_capability(path)?;
    if constant_time_eq(&record.scope_digest, source.digest()) {
        Ok(())
    } else {
        Err("local_migration_source_mismatch")
    }
}

fn write_private_new(path: &Path, bytes: &[u8], code: &'static str) -> Result<(), &'static str> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|_| code)?;
    file.write_all(bytes).map_err(|_| code)?;
    file.sync_all().map_err(|_| code)
}

#[cfg(unix)]
fn sync_dir(path: &Path, code: &'static str) -> Result<(), &'static str> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| code)
}

// Windows cannot fsync a directory: File::open on one is refused, and
// FlushFileBuffers needs a writable handle that a directory does not give.
// NTFS journals the rename itself, so there is nothing to flush.
#[cfg(not(unix))]
fn sync_dir(path: &Path, code: &'static str) -> Result<(), &'static str> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => Ok(()),
        _ => Err(code),
    }
}

fn marker_bytes(scope: &AccountScope) -> Vec<u8> {
    format!("{}\n", scope.digest()).into_bytes()
}

fn marker_hash(bytes: &[u8]) -> String {
    sha256(b"jht-owner-marker-v1\0", &[bytes])
}

fn read_owner(path: &Path) -> Result<Vec<u8>, &'static str> {
    owned_nonwritable_dir(
        path.parent().ok_or("local_migration_owner_invalid")?,
        "local_migration_owner_invalid",
    )?;
    let (bytes, metadata) =
        read_regular_bounded_with_metadata(path, 80, "local_migration_owner_invalid")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let parent = path.parent().ok_or("local_migration_owner_invalid")?;
        let parent_metadata = fs::metadata(parent).map_err(|_| "local_migration_owner_invalid")?;
        if metadata.uid() != parent_metadata.uid() || metadata.permissions().mode() & 0o777 != 0o600
        {
            return Err("local_migration_owner_invalid");
        }
    }
    Ok(bytes)
}

fn validate_owner(path: &Path, expected: &[u8]) -> Result<Vec<u8>, &'static str> {
    let actual = read_owner(path)?;
    if actual != expected {
        return Err("local_migration_owner_mismatch");
    }
    Ok(actual)
}

fn mapping_string<'a>(mapping: &'a Mapping, key: &str) -> Option<&'a str> {
    mapping
        .get(Value::String(key.to_owned()))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
}

fn contains_string(value: Option<&Value>) -> bool {
    value.is_some_and(|value| {
        value.as_sequence().is_some_and(|items| {
            items
                .iter()
                .any(|item| item.as_str().is_some_and(|text| !text.trim().is_empty()))
        })
    })
}

fn string_sequence(value: Option<&Value>) -> bool {
    value.is_some_and(|value| {
        value.as_sequence().is_some_and(|items| {
            items
                .iter()
                .all(|item| item.as_str().is_some_and(|text| !text.trim().is_empty()))
        })
    })
}

fn validate_blocks(value: Option<&Value>) -> bool {
    let Some(value) = value else { return true };
    let Some(blocks) = value.as_sequence() else {
        return false;
    };
    let mut keys = std::collections::BTreeSet::new();
    for block in blocks {
        let Some(block) = block.as_mapping() else {
            return false;
        };
        let Some(key) = mapping_string(block, "key") else {
            return false;
        };
        if !keys.insert(key.to_owned()) || mapping_string(block, "title").is_none() {
            return false;
        }
        let Some(kind) = mapping_string(block, "kind") else {
            return false;
        };
        if !BLOCK_KINDS.contains(&kind) {
            return false;
        }
        let content = block.get(Value::String("content".to_owned()));
        let valid = match kind {
            "narrative" => content
                .and_then(Value::as_str)
                .is_some_and(|text| !text.trim().is_empty()),
            "tag_list" => string_sequence(content),
            "key_value" => content.and_then(Value::as_sequence).is_some_and(|rows| {
                rows.iter().all(|row| {
                    row.as_mapping()
                        .and_then(|row| mapping_string(row, "label"))
                        .is_some()
                })
            }),
            "distribution" => content.and_then(Value::as_sequence).is_some_and(|rows| {
                rows.iter().all(|row| {
                    row.as_mapping().is_some_and(|row| {
                        mapping_string(row, "label").is_some()
                            && row
                                .get(Value::String("value".to_owned()))
                                .is_some_and(|value| value.is_i64() || value.is_f64())
                    })
                })
            }),
            "key_points" => content.and_then(Value::as_sequence).is_some_and(|rows| {
                rows.iter().all(|row| {
                    row.as_mapping()
                        .and_then(|row| mapping_string(row, "heading"))
                        .is_some()
                })
            }),
            "timeline" => content.and_then(Value::as_sequence).is_some_and(|rows| {
                rows.iter().all(|row| {
                    row.as_mapping()
                        .and_then(|row| mapping_string(row, "title"))
                        .is_some()
                })
            }),
            _ => false,
        };
        if !valid {
            return false;
        }
    }
    true
}

fn strict_profile_valid(bytes: &[u8]) -> bool {
    let Ok(profile) = serde_yaml::from_slice::<Value>(bytes) else {
        return false;
    };
    let Some(profile) = profile.as_mapping() else {
        return false;
    };
    if ["name", "target_role", "location", "seniority_target"]
        .iter()
        .any(|key| mapping_string(profile, key).is_none())
    {
        return false;
    }
    if !profile
        .get(Value::String("experience_years".to_owned()))
        .and_then(Value::as_i64)
        .is_some_and(|years| years >= 0)
        || profile
            .get(Value::String("has_degree".to_owned()))
            .and_then(Value::as_bool)
            .is_none()
    {
        return false;
    }
    let Some(skills) = profile
        .get(Value::String("skills".to_owned()))
        .and_then(Value::as_mapping)
    else {
        return false;
    };
    if !contains_string(skills.get(Value::String("primary".to_owned()))) {
        return false;
    }
    let Some(languages) = profile
        .get(Value::String("languages".to_owned()))
        .and_then(Value::as_sequence)
    else {
        return false;
    };
    if languages.is_empty()
        || languages.iter().any(|language| {
            language.as_mapping().is_none_or(|language| {
                mapping_string(language, "language").is_none()
                    || mapping_string(language, "level").is_none()
            })
        })
    {
        return false;
    }
    if !validate_blocks(profile.get(Value::String("blocks".to_owned()))) {
        return false;
    }
    let category = profile.get(Value::String("target_role_category_id".to_owned()));
    let specialty = profile.get(Value::String("target_specialty".to_owned()));
    match category {
        None | Some(Value::Null) => matches!(specialty, None | Some(Value::Null)),
        Some(Value::String(category)) => {
            let allowed: &[&str] = match category.as_str() {
                "software" => &[
                    "backend",
                    "frontend",
                    "fullstack",
                    "platform",
                    "embedded",
                    "open",
                ],
                "data" => &[
                    "data_science",
                    "ml",
                    "genai",
                    "data_engineering",
                    "research",
                    "open",
                ],
                "product" => &["product", "project", "technical_pm", "delivery", "founder"],
                "design" | "business" | "security" | "other" => &[
                    "specialist",
                    "generalist",
                    "leadership",
                    "individual",
                    "explore",
                ],
                _ => return false,
            };
            match specialty {
                None | Some(Value::Null) => true,
                Some(Value::String(value)) => allowed.contains(&value.as_str()),
                _ => false,
            }
        }
        _ => false,
    }
}

fn artifact(id: &str, bytes: &[u8]) -> MigrationArtifact {
    MigrationArtifact {
        id: id.to_owned(),
        sha256: sha256(b"jht-profile-artifact-v1\0", &[id.as_bytes(), b"\0", bytes]),
    }
}

fn profile_manifest(profile_dir: &Path) -> Result<Vec<MigrationArtifact>, &'static str> {
    owned_nonwritable_dir(profile_dir, "local_migration_profile_invalid")?;
    match fs::symlink_metadata(profile_dir.join("pending-profile-review.json")) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        _ => return Err("local_migration_review_pending"),
    }
    let candidate = read_regular_bounded(
        &profile_dir.join("candidate_profile.yml"),
        PROFILE_MAX_BYTES,
        "local_migration_profile_invalid",
    )?;
    if !strict_profile_valid(&candidate) {
        return Err("local_migration_profile_invalid");
    }
    let mut artifacts = vec![artifact("candidate_profile", &candidate)];
    let summaries = profile_dir.join("summaries");
    match fs::symlink_metadata(&summaries) {
        Ok(_) => owned_nonwritable_dir(&summaries, "local_migration_profile_invalid")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("local_migration_profile_invalid"),
    }
    for name in SUMMARY_NAMES {
        let path = summaries.join(format!("{name}.md"));
        match fs::symlink_metadata(&path) {
            Ok(_) => {
                let bytes = read_regular_bounded(
                    &path,
                    SUMMARY_MAX_BYTES,
                    "local_migration_profile_invalid",
                )?;
                artifacts.push(artifact(&format!("summary:{name}"), &bytes));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("local_migration_profile_invalid"),
        }
    }
    artifacts.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(artifacts)
}

fn manifest_hash(artifacts: &[MigrationArtifact]) -> Result<String, &'static str> {
    let canonical = serde_json::to_vec(artifacts).map_err(|_| "local_migration_storage_failed")?;
    Ok(sha256(b"jht-profile-manifest-v1\0", &[&canonical]))
}

fn migration_id(source: &AccountScope, target: &AccountScope) -> String {
    sha256(
        b"jht-profile-migration-id-v1\0",
        &[
            source.digest().as_bytes(),
            b"\0",
            target.digest().as_bytes(),
        ],
    )[..32]
        .to_owned()
}

fn receipt_path(paths: &MigrationPaths, migration_id: &str) -> PathBuf {
    paths.migrations().join(format!("{migration_id}.json"))
}

fn receipt_valid(receipt: &MigrationReceipt) -> bool {
    receipt.schema_version == RECEIPT_SCHEMA
        && valid_hex(&receipt.migration_id, 32)
        && receipt.kind == "local-profile-to-google"
        && valid_hex(&receipt.source_scope_digest, 64)
        && valid_hex(&receipt.target_scope_digest, 64)
        && valid_hex(&receipt.manifest_sha256, 64)
        && valid_hex(&receipt.owner_before_sha256, 64)
        && valid_hex(&receipt.owner_after_sha256, 64)
        && !receipt.artifacts.is_empty()
        && receipt
            .artifacts
            .windows(2)
            .all(|pair| pair[0].id < pair[1].id)
        && receipt.artifacts.iter().all(|artifact| {
            matches!(
                artifact.id.as_str(),
                "candidate_profile"
                    | "summary:about"
                    | "summary:goals"
                    | "summary:preferences"
                    | "summary:strengths"
            ) && valid_hex(&artifact.sha256, 64)
        })
}

fn read_receipt(path: &Path) -> Result<(MigrationReceipt, Vec<u8>), &'static str> {
    private_dir(
        path.parent().ok_or("local_migration_receipt_invalid")?,
        "local_migration_receipt_invalid",
    )?;
    let (bytes, metadata) = read_regular_bounded_with_metadata(
        path,
        RECEIPT_MAX_BYTES,
        "local_migration_receipt_invalid",
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        let parent = path.parent().ok_or("local_migration_receipt_invalid")?;
        let parent_metadata =
            fs::metadata(parent).map_err(|_| "local_migration_receipt_invalid")?;
        if metadata.uid() != parent_metadata.uid() || metadata.permissions().mode() & 0o777 != 0o600
        {
            return Err("local_migration_receipt_invalid");
        }
    }
    let receipt: MigrationReceipt =
        serde_json::from_slice(&bytes).map_err(|_| "local_migration_receipt_invalid")?;
    if !receipt_valid(&receipt) {
        return Err("local_migration_receipt_invalid");
    }
    Ok((receipt, bytes))
}

fn write_receipt(path: &Path, receipt: &MigrationReceipt) -> Result<Vec<u8>, &'static str> {
    let parent = path.parent().ok_or("local_migration_storage_failed")?;
    create_private_dir(parent, "local_migration_storage_failed")?;
    let bytes = serde_json::to_vec(receipt).map_err(|_| "local_migration_storage_failed")?;
    let temporary = parent.join(format!(".{}.{:?}.tmp", receipt.migration_id, receipt.state));
    match fs::symlink_metadata(&temporary) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            write_private_new(&temporary, &bytes, "local_migration_storage_failed")?;
        }
        Ok(_) => {
            let (previous, previous_bytes) =
                read_receipt(&temporary).map_err(|_| "local_migration_recovery_required")?;
            if previous != *receipt || previous_bytes != bytes {
                return Err("local_migration_recovery_required");
            }
        }
        Err(_) => return Err("local_migration_storage_failed"),
    }
    fs::rename(&temporary, path).map_err(|_| "local_migration_storage_failed")?;
    sync_dir(parent, "local_migration_storage_failed")?;
    let (reread, reread_bytes) = read_receipt(path)?;
    if reread != *receipt || reread_bytes != bytes {
        return Err("local_migration_receipt_invalid");
    }
    Ok(bytes)
}

fn replace_owner(
    path: &Path,
    expected_current: &[u8],
    replacement: &[u8],
) -> Result<(), &'static str> {
    validate_owner(path, expected_current)?;
    let parent = path.parent().ok_or("local_migration_owner_invalid")?;
    owned_nonwritable_dir(parent, "local_migration_owner_invalid")?;
    let temporary = parent.join(".desktop-account-scope.migration");
    match fs::symlink_metadata(&temporary) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            write_private_new(&temporary, replacement, "local_migration_owner_unavailable")?;
        }
        Ok(_) => {
            if read_owner(&temporary)? != replacement {
                return Err("local_migration_recovery_required");
            }
        }
        Err(_) => return Err("local_migration_owner_unavailable"),
    }
    if read_owner(&temporary)? != replacement {
        return Err("local_migration_owner_invalid");
    }
    validate_owner(path, expected_current)?;
    fs::rename(&temporary, path).map_err(|_| "local_migration_owner_unavailable")?;
    sync_dir(parent, "local_migration_owner_unavailable")?;
    validate_owner(path, replacement)?;
    Ok(())
}

fn receipt_matches(
    receipt: &MigrationReceipt,
    source: &AccountScope,
    target: &AccountScope,
    artifacts: &[MigrationArtifact],
    manifest: &str,
) -> bool {
    receipt_identity_matches(receipt, source, target)
        && receipt.artifacts == artifacts
        && constant_time_eq(&receipt.manifest_sha256, manifest)
}

fn receipt_identity_matches(
    receipt: &MigrationReceipt,
    source: &AccountScope,
    target: &AccountScope,
) -> bool {
    let before = marker_bytes(source);
    let after = marker_bytes(target);
    receipt.migration_id == migration_id(source, target)
        && receipt.source_scope_digest == source.digest()
        && receipt.target_scope_digest == target.digest()
        && constant_time_eq(&receipt.owner_before_sha256, &marker_hash(&before))
        && constant_time_eq(&receipt.owner_after_sha256, &marker_hash(&after))
}

fn validate_available_capability(
    paths: &MigrationPaths,
    source: &AccountScope,
    target: &AccountScope,
) -> Result<(), &'static str> {
    match fs::symlink_metadata(&paths.source_capability) {
        Ok(_) => validate_source_capability(&paths.source_capability, source),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let id = migration_id(source, target);
            let (receipt, _) = read_receipt(&receipt_path(paths, &id))?;
            if receipt.migration_id != id
                || receipt.source_scope_digest != source.digest()
                || receipt.target_scope_digest != target.digest()
                || !matches!(
                    receipt.state,
                    MigrationState::Prepared | MigrationState::Committed
                )
            {
                return Err("local_migration_recovery_required");
            }
            validate_source_capability(&paths.retired().join(format!("{id}.json")), source)
                .map_err(|_| "local_migration_recovery_required")
        }
        Err(_) => Err("local_migration_source_invalid"),
    }
}

pub(crate) fn probe(
    paths: &MigrationPaths,
    source: &AccountScope,
    target: &AccountScope,
    verify_local_host: impl FnOnce() -> Result<(), &'static str>,
) -> Result<bool, &'static str> {
    if !source.is_local_profile() || target.is_local_profile() || source == target {
        return Err("local_migration_scope_invalid");
    }
    validate_available_capability(paths, source, target)?;
    let owner = paths.owner();
    match fs::symlink_metadata(&owner) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("local_migration_owner_invalid"),
        Ok(_) => {}
    }
    let owner_bytes = read_owner(&owner)?;
    let source_owner = marker_bytes(source);
    let target_owner = marker_bytes(target);
    verify_local_host()?;
    let target_account = paths.target_account(target);
    match fs::symlink_metadata(target_account) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        _ => return Err("local_migration_target_exists"),
    }
    let receipt = receipt_path(paths, &migration_id(source, target));
    match fs::symlink_metadata(&receipt) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if owner_bytes == source_owner {
                Ok(true)
            } else {
                Err("local_migration_owner_mismatch")
            }
        }
        Err(_) => Err("local_migration_receipt_invalid"),
        Ok(_) => {
            let (receipt, _) = read_receipt(&receipt)?;
            if !receipt_identity_matches(&receipt, source, target) {
                Err("local_migration_recovery_required")
            } else if receipt.state == MigrationState::Committed && owner_bytes == target_owner {
                Ok(true)
            } else {
                let artifacts = profile_manifest(&paths.profile())?;
                let manifest = manifest_hash(&artifacts)?;
                if !receipt_matches(&receipt, source, target, &artifacts, &manifest) {
                    Err("local_migration_recovery_required")
                } else if receipt.state == MigrationState::Prepared && owner_bytes == target_owner {
                    Ok(true)
                } else if matches!(
                    receipt.state,
                    MigrationState::Prepared | MigrationState::RolledBack
                ) && owner_bytes == source_owner
                {
                    Ok(true)
                } else {
                    Err("local_migration_recovery_required")
                }
            }
        }
    }
}

pub(crate) fn recoverable_source(
    paths: &MigrationPaths,
    target: &AccountScope,
) -> Result<Option<AccountScope>, &'static str> {
    let migrations = paths.migrations();
    let metadata = match fs::symlink_metadata(&migrations) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("local_migration_recovery_required"),
    };
    if !metadata.file_type().is_dir() {
        return Err("local_migration_recovery_required");
    }
    let mut found: Option<AccountScope> = None;
    let mut count = 0usize;
    for entry in fs::read_dir(&migrations).map_err(|_| "local_migration_recovery_required")? {
        count += 1;
        if count > 1024 {
            return Err("local_migration_recovery_required");
        }
        let entry = entry.map_err(|_| "local_migration_recovery_required")?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "local_migration_recovery_required")?;
        if !name.ends_with(".json") {
            let valid_temporary =
                ["Prepared", "Committed", "RolledBack"]
                    .iter()
                    .find_map(|state| {
                        name.strip_prefix('.')
                            .and_then(|name| name.strip_suffix(&format!(".{state}.tmp")))
                            .filter(|id| valid_hex(id, 32))
                    });
            if valid_temporary.is_some() {
                let (temporary, _) = read_receipt(&entry.path())?;
                let expected_state = if name.ends_with(".Prepared.tmp") {
                    MigrationState::Prepared
                } else if name.ends_with(".Committed.tmp") {
                    MigrationState::Committed
                } else {
                    MigrationState::RolledBack
                };
                if temporary.state == expected_state
                    && name.starts_with(&format!(".{}.", temporary.migration_id))
                {
                    continue;
                }
            }
            return Err("local_migration_recovery_required");
        }
        let (receipt, _) = read_receipt(&entry.path())?;
        if receipt.target_scope_digest != target.digest()
            || !matches!(
                receipt.state,
                MigrationState::Prepared | MigrationState::Committed
            )
        {
            continue;
        }
        let retired = paths
            .retired()
            .join(format!("{}.json", receipt.migration_id));
        let capability = match read_private_capability(&retired) {
            Ok(capability) => capability,
            Err(_) if receipt.state == MigrationState::Prepared => continue,
            Err(_) => return Err("local_migration_recovery_required"),
        };
        if capability.scope_digest != receipt.source_scope_digest {
            return Err("local_migration_recovery_required");
        }
        let scope = AccountScope::local_from_digest(capability.scope_digest)
            .ok_or("local_migration_recovery_required")?;
        if found.as_ref().is_some_and(|existing| existing != &scope) {
            return Err("local_migration_recovery_required");
        }
        found = Some(scope);
    }
    Ok(found)
}

fn retire_capability(paths: &MigrationPaths, migration_id: &str) -> Result<PathBuf, &'static str> {
    let retired_dir = paths.retired();
    create_private_dir(&retired_dir, "local_migration_storage_failed")?;
    let retired = retired_dir.join(format!("{migration_id}.json"));
    match fs::symlink_metadata(&retired) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        _ => return Err("local_migration_recovery_required"),
    }
    fs::rename(&paths.source_capability, &retired).map_err(|_| "local_migration_storage_failed")?;
    sync_dir(&retired_dir, "local_migration_storage_failed")?;
    Ok(retired)
}

fn rollback(
    paths: &MigrationPaths,
    receipt_path: &Path,
    receipt: &mut MigrationReceipt,
    before: &[u8],
    after: &[u8],
    retired: Option<&Path>,
) -> Result<(), &'static str> {
    let owner = paths.owner();
    let (stored_receipt, _) =
        read_receipt(receipt_path).map_err(|_| "local_migration_recovery_required")?;
    if stored_receipt != *receipt || stored_receipt.state != MigrationState::Prepared {
        return Err("local_migration_recovery_required");
    }
    let artifacts =
        profile_manifest(&paths.profile()).map_err(|_| "local_migration_recovery_required")?;
    let manifest = manifest_hash(&artifacts).map_err(|_| "local_migration_recovery_required")?;
    let current = read_owner(&owner).map_err(|_| "local_migration_recovery_required")?;
    if !constant_time_eq(&marker_hash(&current), &receipt.owner_after_sha256)
        || !constant_time_eq(&manifest, &receipt.manifest_sha256)
        || current != after
    {
        return Err("local_migration_recovery_required");
    }
    if let Some(retired) = retired {
        match fs::symlink_metadata(&paths.source_capability) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err("local_migration_recovery_required"),
        }
        fs::rename(retired, &paths.source_capability)
            .map_err(|_| "local_migration_recovery_required")?;
    }
    replace_owner(&owner, after, before).map_err(|_| "local_migration_recovery_required")?;
    receipt.state = MigrationState::RolledBack;
    write_receipt(receipt_path, receipt).map_err(|_| "local_migration_recovery_required")?;
    Ok(())
}

pub(crate) fn migrate(
    paths: &MigrationPaths,
    source: &AccountScope,
    target: &AccountScope,
    verify_local_host: impl FnOnce() -> Result<(), &'static str>,
    after_owner_commit: impl FnOnce() -> Result<(), &'static str>,
) -> Result<MigrationCommitted, &'static str> {
    if !source.is_local_profile() || target.is_local_profile() || source == target {
        return Err("local_migration_scope_invalid");
    }
    validate_available_capability(paths, source, target)?;
    let before = marker_bytes(source);
    let after = marker_bytes(target);
    let owner = paths.owner();
    match fs::symlink_metadata(&owner) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err("local_migration_owner_missing")
        }
        Err(_) => return Err("local_migration_owner_invalid"),
    }
    verify_local_host()?;
    match fs::symlink_metadata(paths.target_account(target)) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        _ => return Err("local_migration_target_exists"),
    }
    let migration_id = migration_id(source, target);
    let receipt_path = receipt_path(paths, &migration_id);

    let existing_receipt = match fs::symlink_metadata(&receipt_path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Ok(_) => Some(read_receipt(&receipt_path)?),
        Err(_) => return Err("local_migration_receipt_invalid"),
    };
    if let Some((existing, bytes)) = &existing_receipt {
        if !receipt_identity_matches(existing, source, target) {
            return Err("local_migration_recovery_required");
        }
        if existing.state == MigrationState::Committed {
            if read_owner(&owner)? == after
                && !paths.source_capability.exists()
                && paths
                    .retired()
                    .join(format!("{migration_id}.json"))
                    .is_file()
            {
                return Ok(MigrationCommitted {
                    receipt_hash: sha256(b"jht-profile-migration-receipt-v1\0", &[bytes]),
                });
            }
            return Err("local_migration_recovery_required");
        }
    }

    let artifacts = profile_manifest(&paths.profile())?;
    let manifest = manifest_hash(&artifacts)?;
    if let Some((existing, _)) = existing_receipt {
        if !receipt_matches(&existing, source, target, &artifacts, &manifest) {
            return Err("local_migration_recovery_required");
        }
        let current_owner = read_owner(&owner)?;
        if existing.state == MigrationState::Prepared && current_owner == after {
            let retired = paths.retired().join(format!("{migration_id}.json"));
            match (
                fs::symlink_metadata(&paths.source_capability),
                fs::symlink_metadata(&retired),
            ) {
                (Ok(_), Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                    retire_capability(paths, &migration_id)?;
                }
                (Err(source_error), Ok(_))
                    if source_error.kind() == std::io::ErrorKind::NotFound =>
                {
                    validate_source_capability(&retired, source)?;
                }
                _ => return Err("local_migration_recovery_required"),
            }
            let mut committed = existing;
            committed.state = MigrationState::Committed;
            let committed_bytes = write_receipt(&receipt_path, &committed)?;
            return Ok(MigrationCommitted {
                receipt_hash: sha256(b"jht-profile-migration-receipt-v1\0", &[&committed_bytes]),
            });
        }
        if !matches!(
            existing.state,
            MigrationState::Prepared | MigrationState::RolledBack
        ) || current_owner != before
        {
            return Err("local_migration_recovery_required");
        }
    }

    // All source and recovery gates precede the first durable prepared write.
    validate_owner(&owner, &before)?;

    let mut receipt = MigrationReceipt {
        schema_version: RECEIPT_SCHEMA,
        migration_id: migration_id.clone(),
        kind: "local-profile-to-google".to_owned(),
        state: MigrationState::Prepared,
        source_scope_digest: source.digest().to_owned(),
        target_scope_digest: target.digest().to_owned(),
        artifacts,
        manifest_sha256: manifest,
        owner_before_sha256: marker_hash(&before),
        owner_after_sha256: marker_hash(&after),
    };
    write_receipt(&receipt_path, &receipt)?;

    validate_owner(&owner, &before)?;
    let reread_manifest = manifest_hash(&profile_manifest(&paths.profile())?)?;
    if !constant_time_eq(&reread_manifest, &receipt.manifest_sha256) {
        return Err("local_migration_profile_changed");
    }
    replace_owner(&owner, &before, &after)?;

    if let Err(error) = after_owner_commit() {
        rollback(paths, &receipt_path, &mut receipt, &before, &after, None)?;
        return Err(error);
    }
    let reread_manifest = manifest_hash(&profile_manifest(&paths.profile())?)?;
    if read_owner(&owner)? != after || !constant_time_eq(&reread_manifest, &receipt.manifest_sha256)
    {
        rollback(paths, &receipt_path, &mut receipt, &before, &after, None)?;
        return Err("local_migration_profile_changed");
    }
    let retired = match retire_capability(paths, &migration_id) {
        Ok(retired) => retired,
        Err(error) => {
            rollback(paths, &receipt_path, &mut receipt, &before, &after, None)?;
            return Err(error);
        }
    };
    receipt.state = MigrationState::Committed;
    let bytes = match write_receipt(&receipt_path, &receipt) {
        Ok(bytes) => bytes,
        Err(error) => {
            rollback(
                paths,
                &receipt_path,
                &mut receipt,
                &before,
                &after,
                Some(&retired),
            )?;
            return Err(error);
        }
    };
    let (reread, reread_bytes) = read_receipt(&receipt_path)?;
    if reread.state != MigrationState::Committed || reread_bytes != bytes {
        return Err("local_migration_recovery_required");
    }
    Ok(MigrationCommitted {
        receipt_hash: sha256(b"jht-profile-migration-receipt-v1\0", &[&bytes]),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        migrate, probe, read_receipt, recoverable_source, strict_profile_valid, write_receipt,
        MigrationPaths, MigrationState,
    };
    use crate::account_scope::AccountScope;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::SystemTime,
    };

    static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    struct Fixture {
        root: PathBuf,
        paths: MigrationPaths,
        source: AccountScope,
        target: AccountScope,
        profile_before: Vec<u8>,
    }

    impl Fixture {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let sequence = FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "jht-profile-migration-{}-{nonce}-{sequence}",
                std::process::id()
            ));
            let app_data = root.join("app-data");
            let runtime_home = root.join("runtime-home");
            let source = AccountScope::synthetic_local(b"synthetic-local-source");
            let target = AccountScope::synthetic(b"synthetic-google-target");
            let source_capability = app_data
                .join("local-profiles")
                .join(format!("{}.json", "a".repeat(64)));
            private_dir(source_capability.parent().unwrap());
            private_dir(&runtime_home);
            private_dir(&runtime_home.join("profile"));
            write_private(
                &source_capability,
                format!(r#"{{"scopeDigest":"{}"}}"#, source.digest()).as_bytes(),
            );
            write_private(
                &runtime_home.join(".desktop-account-scope"),
                format!("{}\n", source.digest()).as_bytes(),
            );
            let profile_before = br#"name: Synthetic Candidate
target_role: Synthetic Engineer
location: Synthetic Place
experience_years: 4
has_degree: true
seniority_target: senior
skills:
  primary: [Rust]
languages:
  - language: Synthetic
    level: fluent
"#
            .to_vec();
            write_regular(
                &runtime_home.join("profile/candidate_profile.yml"),
                &profile_before,
            );
            private_dir(&runtime_home.join("profile/summaries"));
            write_regular(
                &runtime_home.join("profile/summaries/about.md"),
                b"Synthetic summary only.",
            );
            Self {
                root,
                paths: MigrationPaths {
                    app_data,
                    runtime_home,
                    source_capability,
                },
                source,
                target,
                profile_before,
            }
        }

        fn owner(&self) -> Vec<u8> {
            fs::read(self.paths.runtime_home.join(".desktop-account-scope")).unwrap()
        }

        fn receipt_path(&self) -> PathBuf {
            let entries = fs::read_dir(self.paths.app_data.join("account-migrations"))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            assert_eq!(entries.len(), 1);
            entries[0].path()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[cfg(unix)]
    fn private_dir(path: &std::path::Path) {
        use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(path)
            .unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[cfg(not(unix))]
    fn private_dir(path: &std::path::Path) {
        fs::create_dir_all(path).unwrap();
    }

    #[cfg(unix)]
    fn write_private(path: &std::path::Path, bytes: &[u8]) {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path)
            .unwrap();
        std::io::Write::write_all(&mut file, bytes).unwrap();
    }

    #[cfg(not(unix))]
    fn write_private(path: &std::path::Path, bytes: &[u8]) {
        fs::write(path, bytes).unwrap();
    }

    fn write_regular(path: &std::path::Path, bytes: &[u8]) {
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn commits_owner_only_after_profile_and_receipt_reread() {
        let fixture = Fixture::new();
        assert!(probe(&fixture.paths, &fixture.source, &fixture.target, || Ok(())).unwrap());

        let committed = migrate(
            &fixture.paths,
            &fixture.source,
            &fixture.target,
            || Ok(()),
            || Ok(()),
        )
        .unwrap();

        assert_eq!(
            fixture.owner(),
            format!("{}\n", fixture.target.digest()).as_bytes()
        );
        assert_eq!(
            fs::read(
                fixture
                    .paths
                    .runtime_home
                    .join("profile/candidate_profile.yml")
            )
            .unwrap(),
            fixture.profile_before,
        );
        assert!(!fixture.paths.source_capability.exists());
        let (receipt, bytes) = read_receipt(&fixture.receipt_path()).unwrap();
        assert_eq!(receipt.state, MigrationState::Committed);
        assert_eq!(committed.receipt_hash.len(), 64);
        assert!(!bytes
            .windows("Synthetic Candidate".len())
            .any(|window| { window == "Synthetic Candidate".as_bytes() }));
        assert!(!fixture.paths.target_account(&fixture.target).exists());
    }

    #[test]
    fn committed_receipt_is_idempotent_with_retired_capability() {
        let fixture = Fixture::new();
        let first = migrate(
            &fixture.paths,
            &fixture.source,
            &fixture.target,
            || Ok(()),
            || Ok(()),
        )
        .unwrap();

        let second = migrate(
            &fixture.paths,
            &fixture.source,
            &fixture.target,
            || Ok(()),
            || panic!("idempotent retry must not cross the commit hook"),
        )
        .unwrap();

        assert_eq!(second.receipt_hash, first.receipt_hash);
        assert_eq!(
            fixture.owner(),
            format!("{}\n", fixture.target.digest()).as_bytes()
        );
        assert!(!fixture.paths.source_capability.exists());
    }

    #[test]
    fn committed_receipt_remains_idempotent_after_a_later_profile_update() {
        let fixture = Fixture::new();
        let first = migrate(
            &fixture.paths,
            &fixture.source,
            &fixture.target,
            || Ok(()),
            || Ok(()),
        )
        .unwrap();
        fs::write(
            fixture
                .paths
                .runtime_home
                .join("profile/candidate_profile.yml"),
            b"later account-owned profile bytes\n",
        )
        .unwrap();

        let second = migrate(
            &fixture.paths,
            &fixture.source,
            &fixture.target,
            || Ok(()),
            || panic!("a committed retry must not cross the commit hook"),
        )
        .unwrap();

        assert_eq!(second.receipt_hash, first.receipt_hash);
        assert_eq!(
            fixture.owner(),
            format!("{}\n", fixture.target.digest()).as_bytes()
        );
    }

    #[test]
    fn committed_receipt_temp_is_recovered_after_capability_retirement() {
        let fixture = Fixture::new();
        migrate(
            &fixture.paths,
            &fixture.source,
            &fixture.target,
            || Ok(()),
            || Ok(()),
        )
        .unwrap();
        let receipt_path = fixture.receipt_path();
        let (committed, committed_bytes) = read_receipt(&receipt_path).unwrap();
        let mut prepared = committed.clone();
        prepared.state = MigrationState::Prepared;
        write_receipt(&receipt_path, &prepared).unwrap();
        let temporary = receipt_path
            .parent()
            .unwrap()
            .join(format!(".{}.Committed.tmp", committed.migration_id));
        write_private(&temporary, &committed_bytes);

        assert_eq!(
            recoverable_source(&fixture.paths, &fixture.target).unwrap(),
            Some(fixture.source.clone())
        );
        migrate(
            &fixture.paths,
            &fixture.source,
            &fixture.target,
            || Ok(()),
            || Ok(()),
        )
        .unwrap();
        assert!(!temporary.exists());
        assert_eq!(
            read_receipt(&receipt_path).unwrap().0.state,
            MigrationState::Committed
        );
    }

    #[test]
    fn strict_profile_validation_matches_canonical_warning_free_rules() {
        let profile = br#"name: Synthetic Candidate
target_role: Synthetic Engineer
location: Synthetic Place
experience_years: 4
has_degree: true
seniority_target: senior
skills:
  primary: [Rust, null]
languages:
  - language: Synthetic
    level: fluent
blocks:
  - key: tags
    title: Tags
    kind: tag_list
    content: []
"#;
        assert!(strict_profile_valid(profile));

        let non_string_specialty = [
            profile.as_slice(),
            b"target_role_category_id: software\ntarget_specialty: 7\n",
        ]
        .concat();
        assert!(!strict_profile_valid(&non_string_specialty));
    }

    #[test]
    fn target_account_or_pending_review_blocks_without_mutation() {
        let fixture = Fixture::new();
        private_dir(&fixture.paths.target_account(&fixture.target));
        assert_eq!(
            probe(&fixture.paths, &fixture.source, &fixture.target, || Ok(())).unwrap_err(),
            "local_migration_target_exists"
        );
        assert_eq!(
            fixture.owner(),
            format!("{}\n", fixture.source.digest()).as_bytes()
        );
        fs::remove_dir(fixture.paths.target_account(&fixture.target)).unwrap();
        write_regular(
            &fixture
                .paths
                .runtime_home
                .join("profile/pending-profile-review.json"),
            b"{}",
        );
        assert_eq!(
            migrate(
                &fixture.paths,
                &fixture.source,
                &fixture.target,
                || Ok(()),
                || Ok(()),
            )
            .unwrap_err(),
            "local_migration_review_pending"
        );
        assert_eq!(
            fixture.owner(),
            format!("{}\n", fixture.source.digest()).as_bytes()
        );
        assert!(!fixture.paths.migrations().exists());
    }

    #[test]
    fn rolls_back_only_owned_marker_and_capability_after_post_commit_failure() {
        let fixture = Fixture::new();
        assert_eq!(
            migrate(
                &fixture.paths,
                &fixture.source,
                &fixture.target,
                || Ok(()),
                || Err("synthetic_post_commit_failure"),
            )
            .unwrap_err(),
            "synthetic_post_commit_failure"
        );
        assert_eq!(
            fixture.owner(),
            format!("{}\n", fixture.source.digest()).as_bytes()
        );
        assert!(fixture.paths.source_capability.is_file());
        let (receipt, _) = read_receipt(&fixture.receipt_path()).unwrap();
        assert_eq!(receipt.state, MigrationState::RolledBack);
        assert_eq!(
            fs::read(
                fixture
                    .paths
                    .runtime_home
                    .join("profile/candidate_profile.yml")
            )
            .unwrap(),
            fixture.profile_before,
        );
    }

    #[test]
    fn refuses_rollback_if_profile_changed_after_commit_point() {
        let fixture = Fixture::new();
        let profile = fixture
            .paths
            .runtime_home
            .join("profile/candidate_profile.yml");
        assert_eq!(
            migrate(
                &fixture.paths,
                &fixture.source,
                &fixture.target,
                || Ok(()),
                || {
                    fs::write(&profile, b"changed: true\n").unwrap();
                    Err("synthetic_post_commit_failure")
                },
            )
            .unwrap_err(),
            "local_migration_recovery_required"
        );
        assert_eq!(
            fixture.owner(),
            format!("{}\n", fixture.target.digest()).as_bytes()
        );
        assert!(fixture.paths.source_capability.is_file());
    }

    #[test]
    fn refuses_rollback_if_prepared_receipt_changed_after_commit_point() {
        let fixture = Fixture::new();
        let migrations = fixture.paths.migrations();
        assert_eq!(
            migrate(
                &fixture.paths,
                &fixture.source,
                &fixture.target,
                || Ok(()),
                || {
                    let receipt = fs::read_dir(&migrations)
                        .unwrap()
                        .next()
                        .unwrap()
                        .unwrap()
                        .path();
                    fs::write(receipt, b"{}").unwrap();
                    Err("synthetic_post_commit_failure")
                },
            )
            .unwrap_err(),
            "local_migration_recovery_required"
        );
        assert_eq!(
            fixture.owner(),
            format!("{}\n", fixture.target.digest()).as_bytes()
        );
        assert!(fixture.paths.source_capability.is_file());
    }

    #[test]
    fn rejects_non_local_host_before_creating_receipt() {
        let fixture = Fixture::new();
        assert_eq!(
            migrate(
                &fixture.paths,
                &fixture.source,
                &fixture.target,
                || Err("local_migration_host_not_local"),
                || Ok(()),
            )
            .unwrap_err(),
            "local_migration_host_not_local"
        );
        assert_eq!(
            fixture.owner(),
            format!("{}\n", fixture.source.digest()).as_bytes()
        );
        assert!(!fixture.paths.migrations().exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_non_private_source_nodes_before_preparing() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = Fixture::new();
        fs::set_permissions(
            &fixture.paths.source_capability,
            fs::Permissions::from_mode(0o644),
        )
        .unwrap();
        assert_eq!(
            migrate(
                &fixture.paths,
                &fixture.source,
                &fixture.target,
                || Ok(()),
                || Ok(()),
            )
            .unwrap_err(),
            "local_migration_source_invalid"
        );
        assert_eq!(
            fixture.owner(),
            format!("{}\n", fixture.source.digest()).as_bytes()
        );
        assert!(!fixture.paths.migrations().exists());
    }

    #[test]
    fn rejects_legacy_or_incomplete_profile_before_preparing() {
        let fixture = Fixture::new();
        fs::write(
            fixture
                .paths
                .runtime_home
                .join("profile/candidate_profile.yml"),
            b"name: Synthetic\nskills: [Rust]\n",
        )
        .unwrap();
        assert_eq!(
            migrate(
                &fixture.paths,
                &fixture.source,
                &fixture.target,
                || Ok(()),
                || Ok(()),
            )
            .unwrap_err(),
            "local_migration_profile_invalid"
        );
        assert_eq!(
            fixture.owner(),
            format!("{}\n", fixture.source.digest()).as_bytes()
        );
        assert!(!fixture.paths.migrations().exists());
    }

    #[cfg(windows)]
    #[test]
    fn an_existing_private_dir_gets_the_owner_only_acl_on_windows() {
        use crate::private_acl::{
            assert_owner_only, current_user_sid, grants_only_owner, open_to_everyone_and_users,
            read_acl,
        };
        let user = current_user_sid().unwrap();
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "jht-profile-migration-acl-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&root).unwrap();
        open_to_everyone_and_users(&root, false);
        // Directories that already exist, open, as an older build or another
        // program may have left them; one holds a file with explicit entries.
        let migrations = root.join("account-migrations");
        let retired = root.join("local-profiles-retired");
        fs::create_dir(&migrations).unwrap();
        fs::create_dir(&retired).unwrap();
        let receipt = migrations.join("receipt.json");
        fs::write(&receipt, b"{}").unwrap();
        open_to_everyone_and_users(&receipt, false);
        for node in [&migrations, &retired, &receipt] {
            assert!(
                !grants_only_owner(&read_acl(node).unwrap(), &user),
                "{node:?}"
            );
        }

        assert_eq!(super::private_dir(&migrations, "code"), Ok(()));
        assert_eq!(super::create_private_dir(&retired, "code"), Ok(()));

        assert_owner_only(&migrations);
        assert_owner_only(&retired);
        let receipt = read_acl(&receipt).unwrap();
        assert!(grants_only_owner(&receipt, &user), "{receipt:?}");
        fs::remove_dir_all(&root).unwrap();
    }
}

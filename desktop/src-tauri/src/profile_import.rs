use crate::{
    account_scope::{self, AccountScope, AccountScopeState},
    runtime_host::{run_ssh, validate_host, ExecutionHost, ValidatedHost},
};
use chacha20poly1305::{aead::OsRng, ChaCha20Poly1305, KeyInit};
use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
use tauri::{Manager, State};
use zeroize::{Zeroize, Zeroizing};

const MAX_PROFILE_BYTES: usize = 64 * 1024;
const MAX_RECEIPT_BYTES: u64 = 4096;
const IMPORT_TIMEOUT: Duration = Duration::from_secs(45);
const RECEIPT_SCHEMA_VERSION: u8 = 1;
const PROFILE_HASH_DOMAIN: &[u8] = b"jht-vps-profile-import-v1\0";
const RECEIPT_HASH_DOMAIN: &[u8] = b"jht-vps-profile-import-receipt-v1\0";
const RECEIPT_NAME: &str = "vps-profile-import-receipt.json";

const REMOTE_PROFILE_EXPORT: &str = r#"set -eu
JHT_BIN="$(command -v jht 2>/dev/null || true)"
[ -n "$JHT_BIN" ] || JHT_BIN="$HOME/.local/bin/jht"
[ -x "$JHT_BIN" ] || exit 40
exec "$JHT_BIN" desktop-chat python"#;

// This program runs inside the already-running, attested JHT container. It
// emits one bounded envelope on success and no profile value on failure.
const REMOTE_PROFILE_PROGRAM: &str = r#"import hashlib,json,os,stat,subprocess,sys
sys.path.insert(0,"/app/shared/skills")
import profile_review
P="/jht_home/profile/candidate_profile.yml"
M=65536
def read_profile():
    flags=os.O_RDONLY | getattr(os,"O_NOFOLLOW",0)
    try: fd=os.open(P,flags)
    except FileNotFoundError: sys.exit(41)
    except OSError: sys.exit(42)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size<1 or info.st_size>M: sys.exit(42)
        raw=b""
        while len(raw)<=M:
            chunk=os.read(fd,min(8192,M+1-len(raw)))
            if not chunk: break
            raw+=chunk
        if not raw or len(raw)>M: sys.exit(42)
        return raw
    finally: os.close(fd)
def review_clear():
    try: return profile_review.status() is None
    except Exception: sys.exit(44)
if not review_clear(): sys.exit(43)
raw=read_profile()
check=subprocess.run(["node","/app/cli/bin/jht.js","profile","validate","--strict","--json"],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
if check.returncode!=0: sys.exit(45)
if not review_clear(): sys.exit(43)
again=read_profile()
if not hashlib.sha256(raw).digest()==hashlib.sha256(again).digest(): sys.exit(46)
print(json.dumps({"schemaVersion":1,"profileHex":raw.hex(),"profileSha256":hashlib.sha256(raw).hexdigest(),"strictValid":True,"reviewClear":True,"sourceStable":True},separators=(",",":")))"#;

#[derive(Default)]
pub(crate) struct ProfileImportState {
    active: AtomicBool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileImportSnapshot {
    source_valid: bool,
    review_clear: bool,
    source_stable: bool,
    target_was_absent: bool,
    target_valid: bool,
    receipt_verified: bool,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProfileImportError {
    code: &'static str,
    message: &'static str,
    retryable: bool,
}

fn failure(code: &'static str) -> ProfileImportError {
    let (message, retryable) = match code {
        "local_profile_required" => (
            "L’importazione è disponibile solo per un profilo locale.",
            false,
        ),
        "target_profile_exists" => (
            "Questo runtime locale contiene già un profilo. Non è stato sovrascritto.",
            false,
        ),
        "source_profile_missing" => ("La VPS non contiene un profilo da importare.", false),
        "source_profile_invalid" => (
            "Il profilo sulla VPS non supera la validazione richiesta.",
            false,
        ),
        "source_review_pending" => (
            "Sulla VPS c’è una revisione del profilo ancora da confermare.",
            false,
        ),
        "profile_import_recovery_required" => (
            "L’importazione precedente richiede un controllo prima di riprovare.",
            false,
        ),
        "operation_in_progress" => ("Un’importazione è già in corso.", true),
        "host_key_missing" | "host_key_mismatch" => {
            ("Verifica prima l’identità SSH della VPS.", false)
        }
        _ => ("Non è stato possibile importare il profilo. Riprova.", true),
    };
    ProfileImportError {
        code,
        message,
        retryable,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceEnvelope {
    schema_version: u8,
    profile_hex: String,
    profile_sha256: String,
    strict_valid: bool,
    review_clear: bool,
    source_stable: bool,
}

impl Drop for SourceEnvelope {
    fn drop(&mut self) {
        self.profile_hex.zeroize();
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum ReceiptStatus {
    Prepared,
    Committed,
    RolledBack,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportReceipt {
    schema_version: u8,
    operation_id: String,
    status: ReceiptStatus,
    profile_sha256: String,
    receipt_sha256: String,
}

fn hex(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(ALPHABET[(byte >> 4) as usize] as char);
        output.push(ALPHABET[(byte & 15) as usize] as char);
    }
    output
}

fn decode_hex(value: &str, maximum: usize) -> Result<Zeroizing<Vec<u8>>, &'static str> {
    if value.is_empty() || value.len() > maximum.saturating_mul(2) || value.len() % 2 != 0 {
        return Err("source_profile_invalid");
    }
    fn nibble(byte: u8) -> Option<u8> {
        match byte {
            b'0'..=b'9' => Some(byte - b'0'),
            b'a'..=b'f' => Some(byte - b'a' + 10),
            _ => None,
        }
    }
    let mut output = Zeroizing::new(Vec::with_capacity(value.len() / 2));
    for pair in value.as_bytes().chunks_exact(2) {
        output.push(
            nibble(pair[0])
                .zip(nibble(pair[1]))
                .map(|(left, right)| left << 4 | right)
                .ok_or("source_profile_invalid")?,
        );
    }
    Ok(output)
}

fn profile_hash(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(PROFILE_HASH_DOMAIN);
    digest.update(bytes);
    hex(&digest.finalize())
}

fn source_hash(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn receipt_hash(receipt: &ImportReceipt) -> String {
    let mut digest = Sha256::new();
    digest.update(RECEIPT_HASH_DOMAIN);
    digest.update([receipt.schema_version]);
    digest.update(receipt.operation_id.as_bytes());
    digest.update([0]);
    digest.update(match receipt.status {
        ReceiptStatus::Prepared => b"prepared".as_slice(),
        ReceiptStatus::Committed => b"committed".as_slice(),
        ReceiptStatus::RolledBack => b"rolled-back".as_slice(),
    });
    digest.update([0]);
    digest.update(receipt.profile_sha256.as_bytes());
    hex(&digest.finalize())
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn valid_operation_id(value: &str) -> bool {
    valid_hash(value)
}

fn parse_source_envelope(raw: &[u8]) -> Result<Zeroizing<Vec<u8>>, &'static str> {
    if raw.is_empty() || raw.len() > MAX_PROFILE_BYTES * 3 {
        return Err("source_profile_invalid");
    }
    let envelope: SourceEnvelope =
        serde_json::from_slice(raw).map_err(|_| "source_profile_invalid")?;
    if envelope.schema_version != 1
        || !envelope.strict_valid
        || !envelope.review_clear
        || !envelope.source_stable
        || !valid_hash(&envelope.profile_sha256)
    {
        return Err("source_profile_invalid");
    }
    let profile = decode_hex(&envelope.profile_hex, MAX_PROFILE_BYTES)?;
    if source_hash(&profile) != envelope.profile_sha256 {
        return Err("source_profile_invalid");
    }
    validate_profile_strict(&profile)?;
    Ok(profile)
}

fn key<'a>(mapping: &'a Mapping, name: &str) -> Option<&'a Value> {
    mapping.get(&Value::String(name.to_string()))
}

fn only_keys(mapping: &Mapping, allowed: &[&str]) -> bool {
    mapping
        .keys()
        .all(|item| matches!(item, Value::String(name) if allowed.contains(&name.as_str())))
}

fn nonempty_string(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::String(text)) if !text.trim().is_empty())
}

fn string_sequence(value: Option<&Value>, minimum: usize) -> bool {
    matches!(value, Some(Value::Sequence(items)) if items.len() >= minimum && items.iter().all(|item| matches!(item, Value::String(text) if !text.trim().is_empty())))
}

fn optional_string_sequence(value: Option<&Value>, require_nonempty_items: bool) -> bool {
    match value {
        None => true,
        Some(Value::Sequence(items)) => items.iter().all(|item| {
            matches!(item, Value::String(text) if !require_nonempty_items || !text.trim().is_empty())
        }),
        _ => false,
    }
}

fn optional_integer(value: Option<&Value>, minimum: Option<i64>) -> bool {
    match value {
        None => true,
        Some(Value::Number(number)) => number
            .as_i64()
            .is_some_and(|number| minimum.map_or(true, |minimum| number >= minimum)),
        _ => false,
    }
}

fn optional_string(value: Option<&Value>, require_nonempty: bool) -> bool {
    match value {
        None => true,
        Some(Value::String(text)) => !require_nonempty || !text.trim().is_empty(),
        _ => false,
    }
}

fn string_field(mapping: &Mapping, name: &str) -> bool {
    nonempty_string(key(mapping, name))
}

fn validate_languages(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Sequence(items)) if !items.is_empty() && items.iter().all(|item| {
        let Value::Mapping(row) = item else { return false; };
        only_keys(row, &["language", "level"])
            && string_field(row, "language")
            && string_field(row, "level")
    }))
}

fn validate_optional_rows(value: Option<&Value>, allowed: &[&str], required: &[&str]) -> bool {
    matches!(value, None | Some(Value::Sequence(_)))
        && match value {
            None => true,
            Some(Value::Sequence(items)) => items.iter().all(|item| {
                let Value::Mapping(row) = item else {
                    return false;
                };
                only_keys(row, allowed)
                    && required.iter().all(|name| string_field(row, name))
                    && row.values().all(|value| matches!(value, Value::String(_)))
            }),
            _ => false,
        }
}

fn validate_contacts(value: Option<&Value>) -> bool {
    let Some(value) = value else {
        return true;
    };
    let Value::Mapping(row) = value else {
        return false;
    };
    only_keys(
        row,
        &["email", "phone", "linkedin", "github", "website", "address"],
    ) && row.values().all(|value| matches!(value, Value::String(_)))
}

fn validate_block_content(kind: &str, content: Option<&Value>) -> bool {
    match kind {
        "narrative" => nonempty_string(content),
        "tag_list" => string_sequence(content, 0),
        "key_value" => {
            matches!(content, Some(Value::Sequence(items)) if items.iter().all(|item| matches!(item, Value::Mapping(row) if only_keys(row, &["label", "value"]) && string_field(row, "label") && matches!(key(row, "value"), Some(Value::String(_))))))
        }
        "key_points" => {
            matches!(content, Some(Value::Sequence(items)) if items.iter().all(|item| matches!(item, Value::Mapping(row) if only_keys(row, &["heading", "text"]) && string_field(row, "heading") && matches!(key(row, "text"), Some(Value::String(_))))))
        }
        "timeline" => {
            matches!(content, Some(Value::Sequence(items)) if items.iter().all(|item| matches!(item, Value::Mapping(row) if only_keys(row, &["title", "subtitle", "period", "start", "end", "detail"]) && string_field(row, "title") && row.values().all(|value| matches!(value, Value::String(_))))))
        }
        "distribution" => {
            matches!(content, Some(Value::Sequence(items)) if items.iter().all(|item| matches!(item, Value::Mapping(row) if only_keys(row, &["label", "value"]) && string_field(row, "label") && matches!(key(row, "value"), Some(Value::Number(value)) if value.as_f64().is_some_and(|number| number >= 0.0)))))
        }
        _ => false,
    }
}

fn validate_blocks(value: Option<&Value>) -> bool {
    let Some(value) = value else {
        return true;
    };
    let Value::Sequence(items) = value else {
        return false;
    };
    let mut seen = std::collections::BTreeSet::new();
    items.iter().all(|item| {
        let Value::Mapping(row) = item else {
            return false;
        };
        let (Some(Value::String(block_key)), Some(Value::String(kind))) =
            (key(row, "key"), key(row, "kind"))
        else {
            return false;
        };
        only_keys(row, &["key", "kind", "title", "content", "ord", "source"])
            && !block_key.trim().is_empty()
            && seen.insert(block_key.clone())
            && string_field(row, "title")
            && optional_integer(key(row, "ord"), None)
            && match key(row, "source") {
                None => true,
                Some(Value::String(value)) => {
                    ["assistant", "web", "import"].contains(&value.as_str())
                }
                _ => false,
            }
            && validate_block_content(kind, key(row, "content"))
    })
}

fn validate_target_role_choice(profile: &Mapping) -> bool {
    const CATEGORIES: &[&str] = &[
        "software", "data", "product", "design", "business", "security", "other",
    ];
    let category = match key(profile, "target_role_category_id") {
        None => return key(profile, "target_specialty").is_none(),
        Some(Value::String(value)) if CATEGORIES.contains(&value.as_str()) => value.as_str(),
        _ => return false,
    };
    let Some(specialty) = key(profile, "target_specialty") else {
        return true;
    };
    let Value::String(specialty) = specialty else {
        return false;
    };
    let allowed: &[&str] = match category {
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
        _ => &[
            "specialist",
            "generalist",
            "leadership",
            "individual",
            "explore",
        ],
    };
    allowed.contains(&specialty.as_str())
}

fn validate_profile_strict(raw: &[u8]) -> Result<(), &'static str> {
    if raw.is_empty() || raw.len() > MAX_PROFILE_BYTES || raw.contains(&0) {
        return Err("source_profile_invalid");
    }
    let value: Value = serde_yaml::from_slice(raw).map_err(|_| "source_profile_invalid")?;
    let Value::Mapping(profile) = value else {
        return Err("source_profile_invalid");
    };
    if !only_keys(
        &profile,
        &[
            "schema_version",
            "name",
            "target_role",
            "location",
            "experience_years",
            "has_degree",
            "seniority_target",
            "email",
            "timezone",
            "nationality",
            "birth_year",
            "experience_months",
            "industry",
            "target_role_category_id",
            "target_specialty",
            "skills",
            "languages",
            "experience",
            "education",
            "work_authorization",
            "location_preferences",
            "contacts",
            "blocks",
            "sources",
        ],
    ) || match key(&profile, "schema_version") {
        None => false,
        Some(Value::Number(value)) => value.as_i64() != Some(1),
        _ => true,
    } || !["name", "target_role", "location", "seniority_target"]
        .iter()
        .all(|name| string_field(&profile, name))
        || !matches!(key(&profile, "experience_years"), Some(Value::Number(value)) if value.as_i64().is_some_and(|years| years >= 0))
        || !matches!(key(&profile, "has_degree"), Some(Value::Bool(_)))
        || !["email", "timezone", "nationality", "industry"]
            .iter()
            .all(|name| optional_string(key(&profile, name), false))
        || !optional_string(key(&profile, "target_specialty"), true)
        || !optional_integer(key(&profile, "birth_year"), None)
        || !optional_integer(key(&profile, "experience_months"), Some(0))
    {
        return Err("source_profile_invalid");
    }
    let Some(Value::Mapping(skills)) = key(&profile, "skills") else {
        return Err("source_profile_invalid");
    };
    if !only_keys(skills, &["primary", "secondary"])
        || !string_sequence(key(skills, "primary"), 1)
        || !optional_string_sequence(key(skills, "secondary"), true)
        || !validate_languages(key(&profile, "languages"))
        || !validate_optional_rows(
            key(&profile, "experience"),
            &[
                "company", "role", "period", "start", "end", "location", "summary",
            ],
            &["company", "role"],
        )
        || !validate_optional_rows(
            key(&profile, "education"),
            &[
                "institution",
                "degree",
                "year",
                "period",
                "location",
                "details",
            ],
            &["institution"],
        )
        || !validate_optional_rows(
            key(&profile, "work_authorization"),
            &["region", "status"],
            &["region", "status"],
        )
        || !optional_string_sequence(key(&profile, "location_preferences"), true)
        || !optional_string_sequence(key(&profile, "sources"), false)
        || !validate_contacts(key(&profile, "contacts"))
        || !validate_blocks(key(&profile, "blocks"))
        || !validate_target_role_choice(&profile)
    {
        return Err("source_profile_invalid");
    }
    Ok(())
}

fn new_operation_id() -> String {
    hex(&ChaCha20Poly1305::generate_key(&mut OsRng))
}

fn private_dir(path: &Path) -> Result<(), &'static str> {
    fs::create_dir_all(path).map_err(|_| "profile_import_storage_failed")?;
    crate::runtime_host::set_private_dir_permissions(path)
        .map_err(|_| "profile_import_storage_failed")
}

#[cfg(unix)]
fn sync_dir(path: &Path) -> Result<(), &'static str> {
    fs::File::open(path)
        .and_then(|dir| dir.sync_all())
        .map_err(|_| "profile_import_storage_failed")
}

// Windows cannot fsync a directory: File::open on one is refused, and
// FlushFileBuffers needs a writable handle that a directory does not give.
// NTFS journals the rename itself, so there is nothing to flush.
#[cfg(not(unix))]
fn sync_dir(path: &Path) -> Result<(), &'static str> {
    match fs::metadata(path) {
        Ok(metadata) if metadata.is_dir() => Ok(()),
        _ => Err("profile_import_storage_failed"),
    }
}

fn atomic_private_write(path: &Path, bytes: &[u8]) -> Result<(), &'static str> {
    let parent = path.parent().ok_or("profile_import_storage_failed")?;
    private_dir(parent)?;
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if !metadata.file_type().is_file() || metadata.len() > MAX_RECEIPT_BYTES {
            return Err("profile_import_recovery_required");
        }
    }
    for attempt in 0..16 {
        let temporary = parent.join(format!(
            ".{}.{}.{attempt}.tmp",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("receipt"),
            std::process::id()
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = match options.open(&temporary) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("profile_import_storage_failed"),
        };
        let result = file
            .write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "profile_import_storage_failed")
            .and_then(|_| fs::rename(&temporary, path).map_err(|_| "profile_import_storage_failed"))
            .and_then(|_| sync_dir(parent));
        let _ = fs::remove_file(&temporary);
        return result;
    }
    Err("profile_import_storage_failed")
}

fn signed_receipt(
    operation_id: String,
    status: ReceiptStatus,
    profile_sha256: String,
) -> ImportReceipt {
    let mut receipt = ImportReceipt {
        schema_version: RECEIPT_SCHEMA_VERSION,
        operation_id,
        status,
        profile_sha256,
        receipt_sha256: String::new(),
    };
    receipt.receipt_sha256 = receipt_hash(&receipt);
    receipt
}

fn write_receipt(path: &Path, receipt: &ImportReceipt) -> Result<(), &'static str> {
    let bytes = serde_json::to_vec(receipt).map_err(|_| "profile_import_storage_failed")?;
    if bytes.len() as u64 > MAX_RECEIPT_BYTES {
        return Err("profile_import_storage_failed");
    }
    atomic_private_write(path, &bytes)?;
    let persisted = read_receipt(path)?;
    if &persisted != receipt {
        return Err("profile_import_storage_failed");
    }
    Ok(())
}

fn read_receipt(path: &Path) -> Result<ImportReceipt, &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "profile_import_recovery_required")?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > MAX_RECEIPT_BYTES
    {
        return Err("profile_import_recovery_required");
    }
    let receipt: ImportReceipt =
        serde_json::from_slice(&fs::read(path).map_err(|_| "profile_import_recovery_required")?)
            .map_err(|_| "profile_import_recovery_required")?;
    if receipt.schema_version != RECEIPT_SCHEMA_VERSION
        || !valid_operation_id(&receipt.operation_id)
        || !valid_hash(&receipt.profile_sha256)
        || receipt.receipt_sha256 != receipt_hash(&receipt)
    {
        return Err("profile_import_recovery_required");
    }
    Ok(receipt)
}

fn target_hash(path: &Path) -> Result<String, &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "profile_import_recovery_required")?;
    if !metadata.file_type().is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_PROFILE_BYTES as u64
    {
        return Err("profile_import_recovery_required");
    }
    let bytes = Zeroizing::new(fs::read(path).map_err(|_| "profile_import_recovery_required")?);
    validate_profile_strict(&bytes).map_err(|_| "profile_import_recovery_required")?;
    Ok(profile_hash(&bytes))
}

fn recover_receipt(
    target: &Path,
    receipt_path: &Path,
) -> Result<Option<ProfileImportSnapshot>, &'static str> {
    let receipt = match fs::symlink_metadata(receipt_path) {
        Ok(_) => read_receipt(receipt_path)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("profile_import_recovery_required"),
    };
    let target_present = fs::symlink_metadata(target).is_ok();
    match receipt.status {
        ReceiptStatus::Committed => {
            if !target_present || target_hash(target)? != receipt.profile_sha256 {
                return Err("profile_import_recovery_required");
            }
            Ok(Some(ProfileImportSnapshot {
                source_valid: true,
                review_clear: true,
                source_stable: true,
                target_was_absent: false,
                target_valid: true,
                receipt_verified: true,
            }))
        }
        ReceiptStatus::Prepared if target_present => {
            if target_hash(target)? != receipt.profile_sha256 {
                return Err("profile_import_recovery_required");
            }
            let committed = signed_receipt(
                receipt.operation_id,
                ReceiptStatus::Committed,
                receipt.profile_sha256,
            );
            write_receipt(receipt_path, &committed)?;
            Ok(Some(ProfileImportSnapshot {
                source_valid: true,
                review_clear: true,
                source_stable: true,
                target_was_absent: true,
                target_valid: true,
                receipt_verified: true,
            }))
        }
        ReceiptStatus::Prepared | ReceiptStatus::RolledBack if !target_present => {
            if receipt.status == ReceiptStatus::Prepared {
                write_receipt(
                    receipt_path,
                    &signed_receipt(
                        receipt.operation_id,
                        ReceiptStatus::RolledBack,
                        receipt.profile_sha256,
                    ),
                )?;
            }
            Ok(None)
        }
        ReceiptStatus::Prepared => Err("profile_import_recovery_required"),
        ReceiptStatus::RolledBack => Err("profile_import_recovery_required"),
    }
}

fn rollback_published_target(
    target: &Path,
    receipt_path: &Path,
    prepared: &ImportReceipt,
) -> Result<(), &'static str> {
    let persisted = read_receipt(receipt_path)?;
    if persisted != *prepared || target_hash(target)? != prepared.profile_sha256 {
        return Err("profile_import_recovery_required");
    }
    fs::remove_file(target).map_err(|_| "profile_import_recovery_required")?;
    sync_dir(target.parent().ok_or("profile_import_recovery_required")?)?;
    write_receipt(
        receipt_path,
        &signed_receipt(
            prepared.operation_id.clone(),
            ReceiptStatus::RolledBack,
            prepared.profile_sha256.clone(),
        ),
    )
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn atomic_publish(stage: &Path, target: &Path) -> Result<(), &'static str> {
    use rustix::fs::{renameat_with, RenameFlags, CWD};
    renameat_with(CWD, stage, CWD, target, RenameFlags::NOREPLACE).map_err(|error| {
        if error == rustix::io::Errno::EXIST {
            "target_profile_exists"
        } else {
            "profile_import_storage_failed"
        }
    })
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn atomic_publish(_stage: &Path, _target: &Path) -> Result<(), &'static str> {
    Err("profile_import_unsupported")
}

fn preflight_import(
    profile_dir: &Path,
    receipt_path: &Path,
) -> Result<Option<ProfileImportSnapshot>, &'static str> {
    let target = profile_dir.join("candidate_profile.yml");
    let pending_review = profile_dir.join("pending-profile-review.json");
    match fs::symlink_metadata(&pending_review) {
        Ok(_) => return Err("target_profile_exists"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("profile_import_storage_failed"),
    }
    if let Some(recovered) = recover_receipt(&target, receipt_path)? {
        return Ok(Some(recovered));
    }
    match fs::symlink_metadata(&target) {
        Ok(_) => Err("target_profile_exists"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("profile_import_storage_failed"),
    }
}

fn persist_import(
    profile_dir: &Path,
    receipt_path: &Path,
    profile: &[u8],
    fail_after_publish: bool,
) -> Result<ProfileImportSnapshot, &'static str> {
    private_dir(profile_dir)?;
    let target = profile_dir.join("candidate_profile.yml");
    if let Some(recovered) = preflight_import(profile_dir, receipt_path)? {
        return Ok(recovered);
    }

    validate_profile_strict(profile)?;
    let operation_id = new_operation_id();
    let digest = profile_hash(profile);
    let stage = profile_dir.join(format!(".candidate_profile.{operation_id}.stage"));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut stage_file = options
        .open(&stage)
        .map_err(|_| "profile_import_storage_failed")?;
    let stage_result = (|| {
        stage_file
            .write_all(profile)
            .and_then(|_| stage_file.sync_all())
            .map_err(|_| "profile_import_storage_failed")?;
        if target_hash(&stage)? != digest {
            return Err("profile_import_storage_failed");
        }
        let prepared = signed_receipt(operation_id, ReceiptStatus::Prepared, digest.clone());
        write_receipt(receipt_path, &prepared)?;
        // One no-replace rename publishes the verified staging inode. A target
        // created by another process between preflight and commit wins.
        atomic_publish(&stage, &target)?;
        sync_dir(profile_dir)?;
        if fail_after_publish {
            rollback_published_target(&target, receipt_path, &prepared)?;
            return Err("profile_import_storage_failed");
        }
        if target_hash(&target)? != digest {
            rollback_published_target(&target, receipt_path, &prepared)?;
            return Err("profile_import_storage_failed");
        }
        let committed = signed_receipt(
            prepared.operation_id.clone(),
            ReceiptStatus::Committed,
            prepared.profile_sha256.clone(),
        );
        if let Err(error) = write_receipt(receipt_path, &committed) {
            rollback_published_target(&target, receipt_path, &prepared)?;
            return Err(error);
        }
        if read_receipt(receipt_path)? != committed {
            return Err("profile_import_recovery_required");
        }
        Ok(ProfileImportSnapshot {
            source_valid: true,
            review_clear: true,
            source_stable: true,
            target_was_absent: true,
            target_valid: true,
            receipt_verified: true,
        })
    })();
    let _ = fs::remove_file(&stage);
    stage_result
}

fn remote_input() -> Zeroizing<Vec<u8>> {
    let mut input = Zeroizing::new(hex(REMOTE_PROFILE_PROGRAM.as_bytes()).into_bytes());
    input.push(b'\n');
    input
}

fn fetch_remote_profile(host: &ValidatedHost) -> Result<Zeroizing<Vec<u8>>, &'static str> {
    let mut input = remote_input();
    let mut result = run_ssh(
        host,
        REMOTE_PROFILE_EXPORT,
        Some(&input),
        IMPORT_TIMEOUT,
        None,
    );
    input.zeroize();
    let result = result.as_mut().map_err(|error| match *error {
        "process_timeout" => "profile_import_timeout",
        _ => "source_unavailable",
    })?;
    if !result.success() {
        return Err(match result.code {
            41 => "source_profile_missing",
            42 | 45 | 46 => "source_profile_invalid",
            43 => "source_review_pending",
            44 => "source_review_unavailable",
            _ => "source_unavailable",
        });
    }
    let output = Zeroizing::new(std::mem::take(&mut result.stdout));
    parse_source_envelope(&output)
}

fn import_impl(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    host: ExecutionHost,
) -> Result<ProfileImportSnapshot, ProfileImportError> {
    if !scope.is_local_profile() {
        return Err(failure("local_profile_required"));
    }
    account_scope::validate_local_runtime(app, scope).map_err(failure)?;
    let home = app
        .path()
        .home_dir()
        .map_err(|_| failure("profile_import_storage_failed"))?;
    let app_data = app
        .path()
        .app_local_data_dir()
        .map_err(|_| failure("profile_import_storage_failed"))?;
    let profile_dir = home.join(".jht").join("profile");
    let receipt = app_data
        .join("accounts")
        .join(scope.digest())
        .join(RECEIPT_NAME);
    if let Some(recovered) = preflight_import(&profile_dir, &receipt).map_err(failure)? {
        return Ok(recovered);
    }
    let validated = validate_host(app, &host).map_err(failure)?;
    if !matches!(validated, ValidatedHost::Vps { .. }) {
        return Err(failure("invalid_host"));
    }
    let profile = fetch_remote_profile(&validated).map_err(failure)?;
    persist_import(&profile_dir, &receipt, &profile, false).map_err(failure)
}

#[tauri::command]
pub(crate) async fn profile_import_vps_to_local(
    app: tauri::AppHandle,
    state: State<'_, ProfileImportState>,
    scopes: State<'_, AccountScopeState>,
    host: ExecutionHost,
) -> Result<ProfileImportSnapshot, ProfileImportError> {
    let expected = scopes.active().map_err(failure)?;
    if state
        .active
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state
            .lock_expected(&worker_expected)
            .map_err(failure)?;
        import_impl(&app, &worker_expected, host)
    })
    .await
    .unwrap_or_else(|_| Err(failure("profile_import_failed")));
    state.active.store(false, Ordering::Release);
    let _scope = scopes.lock_expected(&expected).map_err(failure)?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    const VALID_PROFILE: &[u8] = br#"schema_version: 1
name: Synthetic Person
target_role: Synthetic Engineer
location: Test City
experience_years: 4
has_degree: true
seniority_target: mid
skills:
  primary: [Rust, Testing]
  secondary: []
languages:
  - language: English
    level: C1
blocks: []
"#;

    fn temp_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-profile-import-{label}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn envelope(profile: &[u8]) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "schemaVersion": 1,
            "profileHex": hex(profile),
            "profileSha256": source_hash(profile),
            "strictValid": true,
            "reviewClear": true,
            "sourceStable": true,
        }))
        .unwrap()
    }

    #[test]
    fn source_envelope_is_allowlisted_hashed_and_strict() {
        assert_eq!(
            &*parse_source_envelope(&envelope(VALID_PROFILE)).unwrap(),
            VALID_PROFILE
        );
        let mut extra: serde_json::Value =
            serde_json::from_slice(&envelope(VALID_PROFILE)).unwrap();
        extra["privateValue"] = serde_json::json!("must-not-cross");
        assert_eq!(
            parse_source_envelope(&serde_json::to_vec(&extra).unwrap()).unwrap_err(),
            "source_profile_invalid"
        );
        let legacy = VALID_PROFILE
            .windows(b"skills:".len())
            .next()
            .map(|_| b"name: Test\ntarget_role: Test\nlocation: Test\nexperience_years: 1\nhas_degree: false\nseniority_target: mid\nskills: [Rust]\nlanguages:\n  - name: English\n    level: C1\n".as_slice())
            .unwrap();
        assert_eq!(
            validate_profile_strict(legacy),
            Err("source_profile_invalid")
        );

        let mut profile_with_unknown_key = VALID_PROFILE.to_vec();
        profile_with_unknown_key.extend_from_slice(b"private_unknown: forbidden\n");
        assert_eq!(
            validate_profile_strict(&profile_with_unknown_key),
            Err("source_profile_invalid")
        );
    }

    #[test]
    fn remote_export_is_read_only_and_uses_the_canonical_strict_gate() {
        assert!(REMOTE_PROFILE_PROGRAM.contains("os.O_RDONLY"));
        assert!(REMOTE_PROFILE_PROGRAM.contains("profile\",\"validate\",\"--strict\",\"--json"));
        assert!(REMOTE_PROFILE_PROGRAM.contains("profile_review.status() is None"));
        assert!(!REMOTE_PROFILE_PROGRAM.contains("O_WRONLY"));
        assert!(!REMOTE_PROFILE_PROGRAM.contains("O_CREAT"));
        assert!(!REMOTE_PROFILE_PROGRAM.contains("requests."));
        assert!(!REMOTE_PROFILE_PROGRAM.contains("urllib"));
    }

    #[test]
    fn import_is_no_clobber_private_and_receipted() {
        let root = temp_root("success");
        let profile_dir = root.join("home/profile");
        let receipt = root.join("app/accounts/opaque").join(RECEIPT_NAME);
        let snapshot = persist_import(&profile_dir, &receipt, VALID_PROFILE, false).unwrap();
        assert!(snapshot.source_valid && snapshot.review_clear && snapshot.source_stable);
        assert!(snapshot.target_was_absent && snapshot.target_valid && snapshot.receipt_verified);
        assert_eq!(
            fs::read(profile_dir.join("candidate_profile.yml")).unwrap(),
            VALID_PROFILE
        );
        let saved = read_receipt(&receipt).unwrap();
        assert_eq!(saved.status, ReceiptStatus::Committed);
        assert_eq!(saved.profile_sha256, profile_hash(VALID_PROFILE));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&receipt).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(&profile_dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(profile_dir.join("candidate_profile.yml"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_target_is_never_overwritten() {
        let root = temp_root("existing");
        let profile_dir = root.join("home/profile");
        fs::create_dir_all(&profile_dir).unwrap();
        let target = profile_dir.join("candidate_profile.yml");
        fs::write(&target, b"existing-private-profile\n").unwrap();
        let receipt = root.join("app/accounts/opaque").join(RECEIPT_NAME);
        assert_eq!(
            persist_import(&profile_dir, &receipt, VALID_PROFILE, false),
            Err("target_profile_exists")
        );
        assert_eq!(fs::read(&target).unwrap(), b"existing-private-profile\n");
        assert!(!receipt.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn preflight_blocks_existing_target_before_any_source_operation() {
        let root = temp_root("preflight-existing");
        let profile_dir = root.join("home/profile");
        fs::create_dir_all(&profile_dir).unwrap();
        let target = profile_dir.join("candidate_profile.yml");
        fs::write(&target, b"existing-private-profile\n").unwrap();
        let receipt = root.join("app/accounts/opaque").join(RECEIPT_NAME);

        assert_eq!(
            preflight_import(&profile_dir, &receipt),
            Err("target_profile_exists")
        );
        assert_eq!(fs::read(target).unwrap(), b"existing-private-profile\n");
        assert!(!receipt.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failure_after_publish_rolls_back_only_receipt_bound_target() {
        let root = temp_root("rollback");
        let profile_dir = root.join("home/profile");
        let receipt = root.join("app/accounts/opaque").join(RECEIPT_NAME);
        assert_eq!(
            persist_import(&profile_dir, &receipt, VALID_PROFILE, true),
            Err("profile_import_storage_failed")
        );
        assert!(!profile_dir.join("candidate_profile.yml").exists());
        assert_eq!(
            read_receipt(&receipt).unwrap().status,
            ReceiptStatus::RolledBack
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn prepared_receipt_recovers_idempotently_and_mismatch_fails_closed() {
        let root = temp_root("recovery");
        let profile_dir = root.join("home/profile");
        private_dir(&profile_dir).unwrap();
        let target = profile_dir.join("candidate_profile.yml");
        fs::write(&target, VALID_PROFILE).unwrap();
        let receipt = root.join("app/accounts/opaque").join(RECEIPT_NAME);
        let prepared = signed_receipt(
            "a".repeat(64),
            ReceiptStatus::Prepared,
            profile_hash(VALID_PROFILE),
        );
        write_receipt(&receipt, &prepared).unwrap();
        let recovered = recover_receipt(&target, &receipt).unwrap().unwrap();
        assert!(recovered.receipt_verified && recovered.target_valid);
        assert_eq!(
            read_receipt(&receipt).unwrap().status,
            ReceiptStatus::Committed
        );
        fs::write(&target, b"changed-outside-transaction\n").unwrap();
        assert_eq!(
            recover_receipt(&target, &receipt),
            Err("profile_import_recovery_required")
        );
        assert_eq!(fs::read(&target).unwrap(), b"changed-outside-transaction\n");
        fs::remove_dir_all(root).unwrap();
    }
}

use super::*;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeTarget {
    pub(crate) container_id: String,
    pub(crate) image_id: String,
    pub(crate) platform_image_id: String,
    pub(crate) oci_revision: String,
    pub(crate) digest: String,
    pub(crate) os: String,
    pub(crate) architecture: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Candidate {
    pub(super) schema: u8,
    pub(super) host: ExecutionHost,
    pub(super) team_id: String,
    pub(super) runtime: RuntimeTarget,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Selection {
    pub(super) schema: u8,
    pub(super) host: ExecutionHost,
    pub(super) team_id: String,
    pub(super) candidate_sha256: String,
}

/// A valid saved selection, read by the rules of every read of one: the host,
/// the team and the SHA-256 of every byte of the candidate it was made from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SavedSelection {
    pub(crate) host: ExecutionHost,
    pub(crate) team_id: String,
    pub(crate) candidate_sha256: String,
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ActivatedTarget {
    pub(crate) team_id: String,
    pub(crate) runtime: RuntimeTarget,
    pub(super) candidate_sha256: String,
}

impl ActivatedTarget {
    #[cfg(test)]
    pub(crate) fn synthetic_for_tests() -> Self {
        Self {
            team_id: "t".repeat(16),
            runtime: RuntimeTarget {
                container_id: "a".repeat(64),
                image_id: format!("sha256:{}", "b".repeat(64)),
                platform_image_id: format!("sha256:{}", "c".repeat(64)),
                oci_revision: "d".repeat(40),
                digest: format!("sha256:{}", "e".repeat(64)),
                os: "linux".into(),
                architecture: "amd64".into(),
            },
            candidate_sha256: "f".repeat(64),
        }
    }

    pub(crate) fn candidate_sha256(&self) -> &str {
        &self.candidate_sha256
    }
}

/// The identity of a read-only connection, as one opaque value the renderer may hold: the account
/// scope and the candidate's SHA-256 (the candidate's bytes carry the host, the team and the
/// container). Two connections that differ in any of them never share a key.
pub(crate) fn connection_key(scope: &AccountScope, target: &ActivatedTarget) -> String {
    sha256(format!("{}\n{}", scope.digest(), target.candidate_sha256).as_bytes())
}

pub(crate) fn hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(crate) fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(crate) fn team_id(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

pub(crate) fn valid_target(target: &RuntimeTarget) -> bool {
    hex(&target.container_id, 64)
        && target
            .image_id
            .strip_prefix("sha256:")
            .is_some_and(|value| hex(value, 64))
        && target
            .platform_image_id
            .strip_prefix("sha256:")
            .is_some_and(|value| hex(value, 64))
        && target.platform_image_id != target.image_id
        && hex(&target.oci_revision, 40)
        && target
            .digest
            .strip_prefix("sha256:")
            .is_some_and(|value| hex(value, 64))
        && target.os == "linux"
        && matches!(target.architecture.as_str(), "amd64" | "arm64")
}

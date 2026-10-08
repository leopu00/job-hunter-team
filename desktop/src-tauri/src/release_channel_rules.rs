//! The rules of the release channel, shared by build.rs (which refuses a bad
//! build) and the app (which checks again at run time). No dependencies: the
//! build script includes this file with `#[path]`.
//!
//! A build is on the production channel unless JHT_CHANNEL=test. A test build
//! (made from the CI for the end-to-end tester) installs the runtime of ONE
//! commit: its install.sh, compose and wrapper, and its image.

pub const TEST_CHANNEL: &str = "test";
pub const IMAGE_REPOSITORY: &str = "ghcr.io/leopu00/jht";

/// The test channel's values, all public: nothing here is a secret.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TestChannel {
    /// The commit (40 lowercase hex) whose install.sh, compose and wrapper run.
    pub source_sha: String,
    /// `ghcr.io/leopu00/jht@sha256:<64 hex>` or `ghcr.io/leopu00/jht:<tag>`.
    pub runtime_image: String,
    /// `sha256:<64 hex>`: the image the installer must find behind
    /// `runtime_image` (a tag can move). Equal to the digest of a digest ref.
    pub image_digest: String,
    /// sha256 of scripts/install.sh at `source_sha`, computed by the CI.
    pub install_sha256: String,
}

fn lower_hex(value: &str, len: usize) -> bool {
    value.len() == len
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn valid_source_sha(value: &str) -> bool {
    lower_hex(value, 40)
}

pub fn valid_sha256(value: &str) -> bool {
    lower_hex(value, 64)
}

pub fn valid_runtime_image(value: &str) -> bool {
    let Some(rest) = value.strip_prefix(IMAGE_REPOSITORY) else {
        return false;
    };
    if let Some(digest) = rest.strip_prefix("@sha256:") {
        return valid_sha256(digest);
    }
    let Some(tag) = rest.strip_prefix(':') else {
        return false;
    };
    !tag.is_empty()
        && tag.len() <= 128
        && tag
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        && tag
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
}

pub fn valid_image_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(valid_sha256)
}

/// A variable counts as given only when it is not blank.
fn given(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

/// What the build environment asks for. `Ok(None)` is production, unchanged.
/// Any value given without JHT_CHANNEL=test, or a test channel with a value
/// missing or malformed, is an error: a half-configured build is refused.
pub fn resolve(
    channel: Option<&str>,
    source_sha: Option<&str>,
    runtime_image: Option<&str>,
    image_digest: Option<&str>,
    install_sha256: Option<&str>,
) -> Result<Option<TestChannel>, String> {
    let (channel, source_sha, runtime_image, image_digest, install_sha256) = (
        given(channel),
        given(source_sha),
        given(runtime_image),
        given(image_digest),
        given(install_sha256),
    );
    match channel {
        None | Some("production") => {
            if source_sha.is_some()
                || runtime_image.is_some()
                || image_digest.is_some()
                || install_sha256.is_some()
            {
                return Err("JHT_SOURCE_SHA, JHT_RUNTIME_IMAGE, JHT_RUNTIME_IMAGE_DIGEST and JHT_INSTALL_SHA256 are only for JHT_CHANNEL=test".to_owned());
            }
            Ok(None)
        }
        Some(TEST_CHANNEL) => {
            let source_sha = source_sha
                .filter(|value| valid_source_sha(value))
                .ok_or("JHT_CHANNEL=test needs JHT_SOURCE_SHA: 40 lowercase hex")?;
            let runtime_image = runtime_image.filter(|value| valid_runtime_image(value)).ok_or(
                "JHT_CHANNEL=test needs JHT_RUNTIME_IMAGE: ghcr.io/leopu00/jht@sha256:<64 hex> or ghcr.io/leopu00/jht:<tag>",
            )?;
            let image_digest = image_digest
                .filter(|value| valid_image_digest(value))
                .ok_or(
                    "JHT_CHANNEL=test needs JHT_RUNTIME_IMAGE_DIGEST: sha256:<64 lowercase hex>",
                )?;
            if let Some((_, pinned)) = runtime_image.split_once('@') {
                if pinned != image_digest {
                    return Err("JHT_RUNTIME_IMAGE is pinned to another digest than JHT_RUNTIME_IMAGE_DIGEST".to_owned());
                }
            }
            let install_sha256 = install_sha256
                .filter(|value| valid_sha256(value))
                .ok_or("JHT_CHANNEL=test needs JHT_INSTALL_SHA256: 64 lowercase hex")?;
            Ok(Some(TestChannel {
                source_sha: source_sha.to_owned(),
                runtime_image: runtime_image.to_owned(),
                image_digest: image_digest.to_owned(),
                install_sha256: install_sha256.to_owned(),
            }))
        }
        Some(other) => Err(format!(
            "JHT_CHANNEL={other}: only \"test\" (or nothing, for production)"
        )),
    }
}

//! The release channel the app was built for (build.rs, from the CI's
//! JHT_CHANNEL & co.; rules in release_channel_rules.rs).
//!
//! Production (the default): install.sh (install.ps1 on Windows) from
//! jobhunterteam.ai, checked against the digest compiled from installer.sha256
//! (installer-windows.sha256), run as it is.
//! Test (only builds made for the end-to-end tester): install.sh or install.ps1
//! of ONE commit from raw.githubusercontent.com, checked against the digest the
//! CI computed from that commit, and run with that commit's coordinates
//! (`--source-sha`, `--image`, `--expected-image-digest`; for install.ps1
//! `-SourceSha`, `-Image`, `-ExpectedImageDigest`): the installer
//! fetches compose and wrapper of the same commit and pins the image, so the
//! later fixed `jht up`, `jht team start`... use it without any variable.
//! The coordinates are public and travel as installer arguments; stdin keeps
//! its own contract (digest, pairing token, installer bytes).

use crate::release_channel_rules::{resolve, TestChannel};

const PRODUCTION_INSTALL_URL: &str = "https://jobhunterteam.ai/install.sh";
#[cfg_attr(not(windows), allow(dead_code))]
const PRODUCTION_INSTALL_PS1_URL: &str = "https://jobhunterteam.ai/install.ps1";
const SOURCE_REPOSITORY: &str = "leopu00/job-hunter-team";

/// The channel compiled into this build. build.rs already refused a bad
/// test build; a value that does not pass the rules again is an error here,
/// never a fallback to production.
pub(crate) fn current() -> Result<Option<TestChannel>, &'static str> {
    from_build(
        env!("JHT_BUILD_CHANNEL"),
        env!("JHT_BUILD_SOURCE_SHA"),
        env!("JHT_BUILD_RUNTIME_IMAGE"),
        env!("JHT_BUILD_RUNTIME_IMAGE_DIGEST"),
        env!("JHT_BUILD_INSTALL_SHA256"),
        env!("JHT_BUILD_INSTALL_PS1_SHA256"),
    )
}

fn from_build(
    channel: &str,
    source_sha: &str,
    runtime_image: &str,
    image_digest: &str,
    install_sha256: &str,
    install_ps1_sha256: &str,
) -> Result<Option<TestChannel>, &'static str> {
    resolve(
        Some(channel),
        Some(source_sha),
        Some(runtime_image),
        Some(image_digest),
        Some(install_sha256),
        Some(install_ps1_sha256),
    )
    .map_err(|_| "installer_digest_invalid")
}

pub(crate) fn install_url(channel: Option<&TestChannel>) -> String {
    match channel {
        None => PRODUCTION_INSTALL_URL.to_owned(),
        Some(test) => format!(
            "https://raw.githubusercontent.com/{SOURCE_REPOSITORY}/{}/scripts/install.sh",
            test.source_sha
        ),
    }
}

/// The digest install.sh must have: the compiled production one, or the
/// test commit's.
pub(crate) fn install_digest<'a>(channel: Option<&'a TestChannel>, production: &'a str) -> &'a str {
    channel.map_or(production, |test| test.install_sha256.as_str())
}

/// The installer's extra arguments: none in production.
pub(crate) fn installer_args(channel: Option<&TestChannel>) -> Vec<String> {
    channel.map_or_else(Vec::new, |test| {
        vec![
            "--source-sha".to_owned(),
            test.source_sha.clone(),
            "--image".to_owned(),
            test.runtime_image.clone(),
            "--expected-image-digest".to_owned(),
            test.image_digest.clone(),
        ]
    })
}

/// Windows: where install.ps1 comes from.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn install_ps1_url(channel: Option<&TestChannel>) -> String {
    match channel {
        None => PRODUCTION_INSTALL_PS1_URL.to_owned(),
        Some(test) => format!(
            "https://raw.githubusercontent.com/{SOURCE_REPOSITORY}/{}/scripts/install.ps1",
            test.source_sha
        ),
    }
}

/// Windows: the digest install.ps1 must have, the compiled production one
/// (installer-windows.sha256) or the test commit's.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn install_ps1_digest<'a>(
    channel: Option<&'a TestChannel>,
    production: &'a str,
) -> &'a str {
    channel.map_or(production, |test| test.install_ps1_sha256.as_str())
}

/// Windows: install.ps1's extra arguments, after `-File <script>`; none in
/// production.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn install_ps1_args(channel: Option<&TestChannel>) -> Vec<String> {
    channel.map_or_else(Vec::new, |test| {
        vec![
            "-SourceSha".to_owned(),
            test.source_sha.clone(),
            "-Image".to_owned(),
            test.runtime_image.clone(),
            "-ExpectedImageDigest".to_owned(),
            test.image_digest.clone(),
        ]
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::release_channel_rules::{valid_image_digest, valid_runtime_image, valid_source_sha};

    const SHA: &str = "0123456789abcdef0123456789abcdef01234567";
    const DIGEST: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const INSTALL: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const INSTALL_PS1: &str = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

    fn test_channel(image: &str) -> TestChannel {
        resolve(
            Some("test"),
            Some(SHA),
            Some(image),
            Some(DIGEST),
            Some(INSTALL),
            Some(INSTALL_PS1),
        )
        .unwrap()
        .unwrap()
    }

    #[test]
    fn production_is_unchanged_without_any_variable() {
        assert_eq!(resolve(None, None, None, None, None, None), Ok(None));
        assert_eq!(from_build("production", "", "", "", "", ""), Ok(None));
        assert_eq!(install_url(None), "https://jobhunterteam.ai/install.sh");
        assert_eq!(install_digest(None, "compiled"), "compiled");
        assert!(installer_args(None).is_empty());
        assert_eq!(
            install_ps1_url(None),
            "https://jobhunterteam.ai/install.ps1"
        );
        assert_eq!(install_ps1_digest(None, "compiled"), "compiled");
        assert!(install_ps1_args(None).is_empty());
        // This very build (cargo test, no CI variables) is production.
        assert_eq!(current(), Ok(None));
    }

    #[test]
    fn a_test_build_installs_one_commit_with_its_image() {
        let test = test_channel("ghcr.io/leopu00/jht:master-arthur");
        assert_eq!(
            install_url(Some(&test)),
            format!("https://raw.githubusercontent.com/leopu00/job-hunter-team/{SHA}/scripts/install.sh")
        );
        assert_eq!(install_digest(Some(&test), "compiled"), INSTALL);
        assert_eq!(
            installer_args(Some(&test)),
            [
                "--source-sha",
                SHA,
                "--image",
                "ghcr.io/leopu00/jht:master-arthur",
                "--expected-image-digest",
                DIGEST
            ]
        );
        assert_eq!(
            install_ps1_url(Some(&test)),
            format!("https://raw.githubusercontent.com/leopu00/job-hunter-team/{SHA}/scripts/install.ps1")
        );
        assert_eq!(install_ps1_digest(Some(&test), "compiled"), INSTALL_PS1);
        assert_eq!(
            install_ps1_args(Some(&test)),
            [
                "-SourceSha",
                SHA,
                "-Image",
                "ghcr.io/leopu00/jht:master-arthur",
                "-ExpectedImageDigest",
                DIGEST
            ]
        );
        let pinned = test_channel(&format!("ghcr.io/leopu00/jht@{DIGEST}"));
        assert_eq!(pinned.image_digest, DIGEST);
    }

    #[test]
    fn a_half_configured_or_malformed_build_is_refused() {
        let image = "ghcr.io/leopu00/jht:master-arthur";
        let refused = |channel, sha, image, digest, install| {
            resolve(channel, sha, image, digest, install, Some(INSTALL_PS1)).is_err()
        };
        // install.ps1's digest: required by a test build, refused without one,
        // and only 64 lowercase hex.
        let full = |install_ps1| {
            resolve(
                Some("test"),
                Some(SHA),
                Some(image),
                Some(DIGEST),
                Some(INSTALL),
                install_ps1,
            )
        };
        assert!(full(Some(INSTALL_PS1)).is_ok());
        assert!(full(None).is_err());
        assert!(full(Some("  ")).is_err());
        let upper = INSTALL_PS1.to_uppercase();
        assert!(full(Some(&upper)).is_err());
        assert!(full(Some(&INSTALL_PS1[1..])).is_err());
        assert!(resolve(None, None, None, None, None, Some(INSTALL_PS1)).is_err());
        // Values without the test channel: never a half production.
        assert!(refused(None, Some(SHA), None, None, None));
        assert!(refused(Some("production"), None, None, None, Some(INSTALL)));
        assert!(refused(Some("staging"), None, None, None, None));
        // The test channel with a value missing.
        assert!(refused(
            Some("test"),
            None,
            Some(image),
            Some(DIGEST),
            Some(INSTALL)
        ));
        assert!(refused(
            Some("test"),
            Some(SHA),
            None,
            Some(DIGEST),
            Some(INSTALL)
        ));
        assert!(refused(
            Some("test"),
            Some(SHA),
            Some(image),
            None,
            Some(INSTALL)
        ));
        assert!(refused(
            Some("test"),
            Some(SHA),
            Some(image),
            Some(DIGEST),
            None
        ));
        // A pinned image that disagrees with the expected digest.
        let other = format!("ghcr.io/leopu00/jht@sha256:{}", "c".repeat(64));
        assert!(refused(
            Some("test"),
            Some(SHA),
            Some(&other),
            Some(DIGEST),
            Some(INSTALL)
        ));
        // The runtime check is the same: a bad compiled value is an error.
        assert_eq!(
            from_build("test", "", image, DIGEST, INSTALL, INSTALL_PS1),
            Err("installer_digest_invalid")
        );

        for bad in [
            "0123",
            &SHA.to_uppercase(),
            &format!("{SHA}0"),
            "g123456789abcdef0123456789abcdef01234567",
        ] {
            assert!(!valid_source_sha(bad), "{bad}");
        }
        for bad in [
            "docker.io/library/jht:latest",
            "ghcr.io/leopu00/jhtx:tag",
            "ghcr.io/leopu00/jht",
            "ghcr.io/leopu00/jht:",
            "ghcr.io/leopu00/jht:-tag",
            "ghcr.io/leopu00/jht:tag;rm",
            "ghcr.io/leopu00/jht:tag x",
            "ghcr.io/leopu00/jht@sha256:abc",
        ] {
            assert!(!valid_runtime_image(bad), "{bad}");
        }
        assert!(valid_runtime_image(
            "ghcr.io/leopu00/jht:sha-0123456789abcdef"
        ));
        for bad in ["aaaa", &DIGEST[7..], "sha512:aa", &DIGEST.to_uppercase()] {
            assert!(!valid_image_digest(bad), "{bad}");
        }
    }
}

//! Installer attestation and bounded downloads used by the onboarding entry points.

use super::{failure, OnboardingError, INSTALL_SHA256, MAX_INSTALLER_BYTES, SESSION_SEQUENCE};
use crate::release_channel;
use crate::runtime_host::{run_program_keeping_stderr, set_private_permissions, ProcessResult};
#[cfg(windows)]
use crate::runtime_host::run_program;
use crate::runtime_log::RuntimeLog;
use sha2::{Digest, Sha256};
use std::{fs, sync::atomic::Ordering, time::{Duration, Instant}};

pub(crate) struct VerifiedInstaller {
    bytes: Vec<u8>,
    digest: String,
}

impl VerifiedInstaller {
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) fn digest(&self) -> &str {
        &self.digest
    }
}

pub(super) fn expected_installer_digest(value: &str) -> Result<&str, OnboardingError> {
    let digest = value.trim();
    if digest.is_empty() {
        return Err(failure("installer_digest_missing"));
    }
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        return Err(failure("installer_digest_invalid"));
    }
    Ok(digest)
}

pub(crate) fn attest_then<T>(
    bytes: Vec<u8>,
    expected_digest: &str,
    execute: impl FnOnce(&VerifiedInstaller) -> Result<T, OnboardingError>,
) -> Result<T, OnboardingError> {
    let expected = expected_installer_digest(expected_digest)?;
    if bytes.is_empty() || bytes.len() > MAX_INSTALLER_BYTES {
        return Err(failure("installer_payload_invalid"));
    }
    let actual = format!("{:x}", Sha256::digest(&bytes));
    if actual != expected {
        return Err(failure("installer_digest_mismatch"));
    }
    execute(&VerifiedInstaller {
        bytes,
        digest: actual,
    })
}

/// What the download of the installer failed on, from how `curl` ended, so that the person is told the real reason and not always
/// «check your internet connection»: the network (the generic code, whose sentence says so), the server answering with an error
/// (404, 403, 5xx: curl exits 22 because of `-f`), or the program itself not running on this computer (not found, exit 126/127,
/// or the dynamic loader complaining: the system curl loading libraries that do not fit it).
pub(crate) fn download_failure_code(result: &Result<ProcessResult, &'static str>, stderr: &[u8]) -> &'static str {
    const LOADER_MESSAGES: [&str; 5] = [
        "symbol lookup error",
        "error while loading shared libraries",
        "undefined symbol",
        "version `GLIBC",
        "cannot open shared object file",
    ];
    let said = String::from_utf8_lossy(stderr);
    match result {
        // too slow is the network
        Err("process_timeout") => "runtime_download_failed",
        // curl did not start, or its pipes did not open
        Err(_) => "runtime_download_tool_failed",
        Ok(done) if matches!(done.code, 126 | 127) || LOADER_MESSAGES.iter().any(|marker| said.contains(marker)) => {
            "runtime_download_tool_failed"
        }
        Ok(done) if done.code == 22 => "runtime_download_refused",
        Ok(_) => "runtime_download_failed",
    }
}

fn download_installer_bytes(
    url: &str,
    expected_digest: &str,
    log: Option<&RuntimeLog>,
) -> Result<Vec<u8>, OnboardingError> {
    // Refuse a release without a compiled-in digest before touching the network.
    expected_installer_digest(expected_digest)?;
    let target = std::env::temp_dir().join(format!(
        "jht-download-{}-{}.sh",
        std::process::id(),
        SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let curl_args = [
            "-fsSL",
            url,
            "-o",
            target.to_str().ok_or_else(|| failure("storage_failed"))?,
        ];
        let started = Instant::now();
        let (downloaded, stderr) =
            run_program_keeping_stderr("curl", curl_args, None, Duration::from_secs(90));
        // The log of the steps names this one and what curl said (redacted there), as for the installer that runs after it: the
        // reason for a failure used to be only in onboarding-diagnostics.jsonl.
        if let Some(log) = log {
            log.record_result("download install.sh", &downloaded, &stderr, started.elapsed());
        }
        if !matches!(&downloaded, Ok(done) if done.success()) {
            return Err(failure(download_failure_code(&downloaded, &stderr)));
        }
        set_private_permissions(&target).map_err(failure)?;
        let metadata = fs::metadata(&target).map_err(|_| failure("runtime_download_failed"))?;
        if metadata.len() == 0 || metadata.len() > MAX_INSTALLER_BYTES as u64 {
            return Err(failure("installer_payload_invalid"));
        }
        fs::read(&target).map_err(|_| failure("runtime_download_failed"))
    })();
    let _ = fs::remove_file(&target);
    result
}

/// Downloads install.sh of the channel this app was built for, checks it
/// against that channel's digest and hands it over with the channel's
/// installer arguments (none in production).
pub(super) fn with_downloaded_installer<T>(
    log: Option<&RuntimeLog>,
    execute: impl FnOnce(&VerifiedInstaller, &[String]) -> Result<T, OnboardingError>,
) -> Result<T, OnboardingError> {
    let channel = release_channel::current().map_err(failure)?;
    let expected = expected_installer_digest(release_channel::install_digest(
        channel.as_ref(),
        INSTALL_SHA256,
    ))?;
    let args = release_channel::installer_args(channel.as_ref());
    download_then_attest(
        &release_channel::install_url(channel.as_ref()),
        expected,
        log,
        |installer| execute(installer, &args),
    )
}

/// Downloads the installer from `url` and runs `execute` only on bytes with
/// `expected_digest`: a commit that does not exist, a network that is down or
/// different bytes stop here, before anything runs.
pub(super) fn download_then_attest<T>(
    url: &str,
    expected_digest: &str,
    log: Option<&RuntimeLog>,
    execute: impl FnOnce(&VerifiedInstaller) -> Result<T, OnboardingError>,
) -> Result<T, OnboardingError> {
    let bytes = download_installer_bytes(url, expected_digest, log)?;
    attest_then(bytes, expected_digest, execute)
}

/// A file from `url`, at most MAX_INSTALLER_BYTES, refused before the network
/// when no digest was compiled in.
#[cfg(windows)]
pub(super) fn download_verified_bytes(url: &str, expected_digest: &str) -> Result<Vec<u8>, OnboardingError> {
    expected_installer_digest(expected_digest)?;
    let target = std::env::temp_dir().join(format!(
        "jht-download-{}-{}.ps1",
        std::process::id(),
        SESSION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let target_text = target.to_str().ok_or_else(|| failure("storage_failed"))?;
        let downloaded = run_program(
            "curl.exe",
            ["-fsSL", url, "-o", target_text],
            None,
            Duration::from_secs(90),
        )
        .map_err(failure)?;
        if !downloaded.success() {
            return Err(failure("runtime_download_failed"));
        }
        let metadata = fs::metadata(&target).map_err(|_| failure("runtime_download_failed"))?;
        if metadata.len() == 0 || metadata.len() > MAX_INSTALLER_BYTES as u64 {
            return Err(failure("installer_payload_invalid"));
        }
        fs::read(&target).map_err(|_| failure("runtime_download_failed"))
    })();
    let _ = fs::remove_file(&target);
    result
}

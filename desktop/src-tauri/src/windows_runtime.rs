//! The team on this computer on Windows: Docker Desktop, with the runtime that
//! install.ps1 publishes and the PowerShell wrapper jht.ps1 (the same ones the
//! game uses). The app:
//! - checks that Docker Desktop is installed and running, and says what to do
//!   when it is not (docker_desktop_missing / docker_desktop_not_running);
//! - downloads install.ps1, checks it against the digest compiled from
//!   installer-windows.sha256, and runs it with `-SkipOnboard`;
//! - calls `%USERPROFILE%\.local\bin\jht.ps1` only when the wrapper carries
//!   the protocol markers and matches the `.runtime-integrity` that
//!   install.ps1 wrote under `%LOCALAPPDATA%\Job Hunter Team\host-runtime`.
//! Every script runs through Windows PowerShell by its absolute path,
//! non-interactive, without profile.
//!
//! The pure parts (argv, markers, manifest) build on every system, so they are
//! tested on every system; the parts that run programs are Windows-only.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) const INSTALL_PS1_URL: &str = "https://jobhunterteam.ai/install.ps1";
pub(crate) const INSTALL_PS1_SHA256: &str = include_str!("../installer-windows.sha256");

/// The lines a desktop-capable jht.ps1 carries, like the sh wrapper's
/// JHT_HOST_RUNTIME_PROTOCOL=1 & co.
pub(crate) const WRAPPER_PROTOCOLS: [&str; 3] = [
    "$JHT_HOST_RUNTIME_PROTOCOL = 1",
    "$JHT_DESKTOP_CHAT_PROTOCOL = 1",
    "$JHT_ONBOARDING_SNAPSHOT_PROTOCOL = 1",
];

const POWERSHELL_FLAGS: [&str; 6] = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
];

/// Windows PowerShell 5.1, which every Windows 10/11 has, by absolute path:
/// never whatever `powershell` the PATH resolves first.
pub(crate) fn powershell_path(system_root: Option<OsString>) -> PathBuf {
    PathBuf::from(system_root.unwrap_or_else(|| OsString::from(r"C:\Windows")))
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe")
}

/// `-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script> <args>`.
pub(crate) fn script_invocation(script: &Path, args: &[&str]) -> Vec<OsString> {
    POWERSHELL_FLAGS
        .iter()
        .map(OsString::from)
        .chain(std::iter::once(script.as_os_str().to_owned()))
        .chain(args.iter().map(OsString::from))
        .collect()
}

pub(crate) fn installer_invocation(script: &Path) -> Vec<OsString> {
    script_invocation(script, &["-SkipOnboard"])
}

/// `%LOCALAPPDATA%\Job Hunter Team\host-runtime`, where install.ps1 puts the
/// compose file and the integrity manifest. Only an absolute LOCALAPPDATA.
pub(crate) fn runtime_dir(local_app_data: Option<OsString>) -> Option<PathBuf> {
    let base = PathBuf::from(local_app_data?);
    base.is_absolute()
        .then(|| base.join("Job Hunter Team").join("host-runtime"))
}

pub(crate) fn wrapper_has_protocols(source: &str) -> bool {
    WRAPPER_PROTOCOLS.iter().all(|protocol| {
        source
            .lines()
            .map(|line| line.trim_end_matches('\r').trim())
            .any(|line| line == *protocol)
    })
}

/// install.ps1's manifest, exactly: version=1, then the sha256 of the
/// compose file, the wrapper and the ACL helper, each matching the file.
pub(crate) fn manifest_matches(manifest: &str, digests: &[(&str, Option<String>); 3]) -> bool {
    let mut entries = std::collections::BTreeMap::new();
    for line in manifest.lines().map(|line| line.trim_end_matches('\r')) {
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            return false;
        };
        if value.is_empty() || entries.insert(key, value).is_some() {
            return false;
        }
    }
    let expected: Vec<&str> = std::iter::once("version")
        .chain(digests.iter().map(|(name, _)| *name))
        .collect();
    let mut keys: Vec<&str> = entries.keys().copied().collect();
    let mut wanted = expected.clone();
    keys.sort_unstable();
    wanted.sort_unstable();
    keys == wanted
        && entries["version"] == "1"
        && digests.iter().all(|(name, digest)| {
            digest
                .as_deref()
                .is_some_and(|digest| entries[name].eq_ignore_ascii_case(digest))
        })
}

#[cfg_attr(not(windows), allow(dead_code))]
fn file_digest(path: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() == 0 {
        return None;
    }
    Some(format!("{:x}", Sha256::digest(std::fs::read(path).ok()?)))
}

/// The wrapper next to its ACL helper, both as install.ps1 recorded them.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn wrapper_bundle_valid(wrapper: &Path, runtime_dir: &Path) -> bool {
    let Some(bin) = wrapper.parent() else {
        return false;
    };
    let Ok(manifest) = std::fs::read_to_string(runtime_dir.join(".runtime-integrity")) else {
        return false;
    };
    manifest_matches(
        &manifest,
        &[
            ("docker-compose.yml", file_digest(&runtime_dir.join("docker-compose.yml"))),
            ("jht-wrapper.ps1", file_digest(wrapper)),
            ("windows-private-acl.ps1", file_digest(&bin.join("windows-private-acl.ps1"))),
        ],
    )
}

/// `docker info`: not found means Docker Desktop is not installed; any other
/// failure (it answers with an error, or not in time) means it is not running.
pub(crate) fn docker_state(
    result: Result<crate::runtime_host::ProcessResult, &'static str>,
) -> Result<(), &'static str> {
    match result {
        Ok(result) if result.success() => Ok(()),
        Err("process_start_failed") => Err("docker_desktop_missing"),
        _ => Err("docker_desktop_not_running"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_host::ProcessResult;

    #[test]
    fn powershell_runs_by_absolute_path_non_interactive_without_profile() {
        let shell = powershell_path(Some(OsString::from(r"D:\Win")));
        assert!(shell.ends_with("WindowsPowerShell/v1.0/powershell.exe") || shell.to_string_lossy().ends_with(r"WindowsPowerShell\v1.0\powershell.exe"));
        assert!(shell.starts_with(r"D:\Win"));
        assert!(powershell_path(None).starts_with(r"C:\Windows"));

        let wrapper = Path::new(r"C:\Users\someone\.local\bin\jht.ps1");
        let args: Vec<String> = script_invocation(wrapper, &["providers", "use", "claude"])
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(
            args,
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                r"C:\Users\someone\.local\bin\jht.ps1",
                "providers",
                "use",
                "claude"
            ]
        );
        let install: Vec<String> = installer_invocation(Path::new(r"C:\Temp\i.ps1"))
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(install.last().map(String::as_str), Some("-SkipOnboard"));
        assert_eq!(install[install.len() - 2], r"C:\Temp\i.ps1");
    }

    #[test]
    fn the_runtime_dir_needs_an_absolute_local_app_data() {
        let absolute = std::env::temp_dir();
        assert_eq!(
            runtime_dir(Some(absolute.clone().into_os_string())),
            Some(absolute.join("Job Hunter Team").join("host-runtime"))
        );
        assert_eq!(runtime_dir(Some(OsString::from("relative"))), None);
        assert_eq!(runtime_dir(None), None);
    }

    #[test]
    fn a_wrapper_counts_only_with_all_three_protocol_lines() {
        let full = "param()\r\n$JHT_HOST_RUNTIME_PROTOCOL = 1\r\n$JHT_DESKTOP_CHAT_PROTOCOL = 1\r\n  $JHT_ONBOARDING_SNAPSHOT_PROTOCOL = 1\r\n";
        assert!(wrapper_has_protocols(full));
        // The game's wrapper of today: host protocol only.
        assert!(!wrapper_has_protocols("$JHT_HOST_RUNTIME_PROTOCOL = 1\n"));
        // A comment that mentions the marker is not the marker.
        assert!(!wrapper_has_protocols(
            "# $JHT_HOST_RUNTIME_PROTOCOL = 1 $JHT_DESKTOP_CHAT_PROTOCOL = 1 $JHT_ONBOARDING_SNAPSHOT_PROTOCOL = 1\n"
        ));
    }

    #[test]
    fn the_manifest_must_be_install_ps1s_exactly() {
        let digests = |wrapper: &str| {
            [
                ("docker-compose.yml", Some("aa".to_owned())),
                ("jht-wrapper.ps1", Some(wrapper.to_owned())),
                ("windows-private-acl.ps1", Some("cc".to_owned())),
            ]
        };
        let manifest = "version=1\r\ndocker-compose.yml=aa\r\njht-wrapper.ps1=BB\r\nwindows-private-acl.ps1=cc\r\n";
        assert!(manifest_matches(manifest, &digests("bb")));
        // A wrapper changed after the install.
        assert!(!manifest_matches(manifest, &digests("dd")));
        // A missing file.
        let mut missing = digests("bb");
        missing[2].1 = None;
        assert!(!manifest_matches(manifest, &missing));
        for bad in [
            "version=2\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\n",
            "version=1\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\n",
            "version=1\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\nextra=1\n",
            "version=1\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\n",
            "version=1\ndocker-compose.yml\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\n",
            "",
        ] {
            assert!(!manifest_matches(bad, &digests("bb")), "{bad:?}");
        }
    }

    #[test]
    fn docker_desktop_missing_and_not_running_are_told_apart() {
        let answer = |code| {
            Ok(ProcessResult {
                code,
                stdout: Vec::new(),
            })
        };
        assert_eq!(docker_state(answer(0)), Ok(()));
        assert_eq!(docker_state(Err("process_start_failed")), Err("docker_desktop_missing"));
        assert_eq!(docker_state(answer(1)), Err("docker_desktop_not_running"));
        assert_eq!(docker_state(Err("process_timeout")), Err("docker_desktop_not_running"));
    }

    #[test]
    fn the_compiled_install_ps1_digest_is_the_release_source() {
        use sha2::{Digest, Sha256};
        let source = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripts/install.ps1")).unwrap();
        assert_eq!(INSTALL_PS1_SHA256.trim(), format!("{:x}", Sha256::digest(&source)));
        let public = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../web/public/install.ps1")).unwrap();
        assert_eq!(public, source, "web/public/install.ps1 is what jobhunterteam.ai serves");
    }
}

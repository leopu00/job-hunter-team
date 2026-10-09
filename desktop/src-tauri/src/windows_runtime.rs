//! The team on this computer on Windows: Podman inside WSL, with the runtime
//! that install.ps1 publishes and the PowerShell wrapper jht.ps1 (the same ones
//! the game uses). Nothing to install by hand besides WSL itself. The app:
//! - checks that WSL answers (`wsl.exe --status`) and says what to do when it
//!   does not (wsl_not_ready), before downloading anything;
//! - downloads install.ps1, checks it against the digest compiled from
//!   installer-windows.sha256, and runs it with `-SkipOnboard`; a test build
//!   takes install.ps1 of its commit instead, with that commit's digest and
//!   coordinates (release_channel.rs). install.ps1 installs Podman when it is
//!   missing and creates the JHT Podman machine in WSL; choosing «this
//!   computer» in the onboarding is the user's consent to that. Its stdout
//!   names the phase it is in (`JHT_PHASE <id>`), shown with the elapsed time;
//!   its exit code names what failed (20 WSL, 21 Podman, 22 the machine);
//! - calls `%USERPROFILE%\.local\bin\jht.ps1` only when the wrapper carries
//!   the protocol markers and matches the `.runtime-integrity` that
//!   install.ps1 wrote under `%LOCALAPPDATA%\Job Hunter Team\host-runtime`.
//! Every script runs through Windows PowerShell by its absolute path,
//! non-interactive, without profile and without a console window.
//!
//! The pure parts (argv, markers, manifest, phases, exit codes) build on every
//! system, so they are tested on every system; the parts that run programs are
//! Windows-only.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

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

/// install.ps1 with `-SkipOnboard`, then the release channel's arguments
/// (none in production; `-SourceSha … -Image … -ExpectedImageDigest …` in a
/// test build).
pub(crate) fn installer_invocation(script: &Path, channel_args: &[String]) -> Vec<OsString> {
    let args: Vec<&str> = std::iter::once("-SkipOnboard")
        .chain(channel_args.iter().map(String::as_str))
        .collect();
    script_invocation(script, &args)
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

/// The files install.ps1 records in `.runtime-integrity`, besides `version`,
/// and where each one lives: next to the compose file (Runtime) or next to
/// the wrapper (Bin).
#[derive(Clone, Copy)]
enum Place {
    Runtime,
    Bin,
}
const MANIFEST_FILES: [(&str, Place, &str); 8] = [
    ("docker-compose.yml", Place::Runtime, "docker-compose.yml"),
    ("docker-compose.podman.yml", Place::Runtime, "docker-compose.podman.yml"),
    ("container-runtime", Place::Runtime, "container-runtime"),
    ("podman-machine", Place::Runtime, "podman-machine"),
    ("jht-container.service", Place::Runtime, "jht-container.service"),
    ("jht-wrapper.ps1", Place::Bin, "jht.ps1"),
    ("windows-private-acl.ps1", Place::Bin, "windows-private-acl.ps1"),
    ("docker.exe", Place::Bin, "docker.exe"),
];
/// A test-channel install also pins its image: the file and its manifest
/// line come together, or neither does.
const IMAGE_PIN: &str = "runtime-image";

/// install.ps1's manifest, exactly: version=1, then the sha256 of every
/// required file, each matching the file; `optional` is a key that must be
/// there when its file is (Some digest) and absent when it is not (None).
pub(crate) fn manifest_matches(
    manifest: &str,
    required: &[(&str, Option<String>)],
    optional: (&str, Option<String>),
) -> bool {
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
    let present: Vec<&(&str, Option<String>)> = required
        .iter()
        .chain(optional.1.is_some().then_some(&optional))
        .collect();
    let mut wanted: Vec<&str> = std::iter::once("version")
        .chain(present.iter().map(|(name, _)| *name))
        .collect();
    let mut keys: Vec<&str> = entries.keys().copied().collect();
    keys.sort_unstable();
    wanted.sort_unstable();
    keys == wanted
        && entries["version"] == "1"
        && present.iter().all(|(name, digest)| {
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

/// The wrapper with everything install.ps1 published next to it, as
/// install.ps1 recorded it, on the Podman runtime.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn wrapper_bundle_valid(wrapper: &Path, runtime_dir: &Path) -> bool {
    let Some(bin) = wrapper.parent() else {
        return false;
    };
    let Ok(manifest) = std::fs::read_to_string(runtime_dir.join(".runtime-integrity")) else {
        return false;
    };
    let selected = std::fs::read_to_string(runtime_dir.join("container-runtime"));
    if selected.ok().is_none_or(|value| value.trim() != "podman") {
        return false;
    }
    let required: Vec<(&str, Option<String>)> = MANIFEST_FILES
        .iter()
        .map(|(key, place, file)| {
            let path = match place {
                Place::Runtime => runtime_dir.join(file),
                Place::Bin if *key == "jht-wrapper.ps1" => wrapper.to_path_buf(),
                Place::Bin => bin.join(file),
            };
            (*key, file_digest(&path))
        })
        .collect();
    let pin = runtime_dir.join(IMAGE_PIN);
    // A pin that is there but unreadable must not count as "no pin".
    if std::fs::symlink_metadata(&pin).is_ok() && file_digest(&pin).is_none() {
        return false;
    }
    manifest_matches(&manifest, &required, (IMAGE_PIN, file_digest(&pin)))
}

/// `%SystemRoot%\System32\wsl.exe`, by absolute path like PowerShell.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn wsl_path(system_root: Option<OsString>) -> PathBuf {
    PathBuf::from(system_root.unwrap_or_else(|| OsString::from(r"C:\Windows")))
        .join("System32")
        .join("wsl.exe")
}

/// `wsl.exe --status`: WSL is ready only when it answers in time with
/// success. Missing, not enabled, waiting for a restart or an update: all
/// wsl_not_ready, whose action the catalog tells without a terminal.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn wsl_state(
    result: Result<crate::runtime_host::ProcessResult, &'static str>,
) -> Result<(), &'static str> {
    match result {
        Ok(result) if result.success() => Ok(()),
        _ => Err("wsl_not_ready"),
    }
}

/// What a failed install.ps1 or `jht.ps1 up` says with its exit code (the
/// contract with the PowerShell side): 20 WSL not usable, 21 Podman or
/// Compose not installable, 22 the Podman machine missing, not creatable or
/// not starting. Any other failure is the caller's generic code.
pub(crate) fn exit_failure(code: i32) -> Option<&'static str> {
    match code {
        20 => Some("wsl_not_ready"),
        21 => Some("podman_missing"),
        22 => Some("podman_start_failed"),
        _ => None,
    }
}

/// install.ps1's end, from run_program_lines: its exit code, or the timeout.
pub(crate) fn installer_outcome(result: Result<i32, &'static str>) -> Result<(), &'static str> {
    match result {
        Ok(0) => Ok(()),
        Ok(code) => Err(exit_failure(code).unwrap_or("runtime_install_failed")),
        Err("process_timeout") => Err("timeout"),
        Err(_) => Err("runtime_install_failed"),
    }
}

/// install.ps1's phases, in the order they run, with what the onboarding
/// shows while each one lasts.
pub(crate) const INSTALL_PHASES: [(&str, &str); 6] = [
    ("wsl_check", "Controllo WSL"),
    ("podman_install", "Installo Podman"),
    ("podman_machine_init", "Creo la macchina Podman di Job Hunter Team in WSL"),
    ("podman_machine_start", "Avvio la macchina Podman"),
    ("runtime_download", "Scarico il runtime Job Hunter Team"),
    ("image_pull", "Scarico l’immagine del team: è la parte più lunga"),
];

/// A `JHT_PHASE <id>` line of install.ps1's stdout, exactly, with a known id.
/// Anything else on stdout is not shown.
pub(crate) fn phase_message(line: &str) -> Option<&'static str> {
    let id = line.trim_end_matches(['\r', '\n']).strip_prefix("JHT_PHASE ")?;
    INSTALL_PHASES
        .iter()
        .find(|(known, _)| *known == id)
        .map(|(_, message)| *message)
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
        let install: Vec<String> = installer_invocation(Path::new(r"C:\Temp\i.ps1"), &[])
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(install.last().map(String::as_str), Some("-SkipOnboard"));
        assert_eq!(install[install.len() - 2], r"C:\Temp\i.ps1");
        // A test build: the channel's coordinates follow -SkipOnboard, as
        // separate arguments, never through the environment.
        let channel = [
            "-SourceSha",
            "0123456789abcdef0123456789abcdef01234567",
            "-Image",
            "ghcr.io/leopu00/jht:master-arthur",
            "-ExpectedImageDigest",
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ]
        .map(str::to_owned);
        let test: Vec<String> = installer_invocation(Path::new(r"C:\Temp\i.ps1"), &channel)
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert_eq!(test[..install.len()], install[..]);
        assert_eq!(test[install.len()..], channel[..]);
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

    /// The wrapper this commit publishes is one the app accepts.
    #[test]
    fn the_published_wrapper_carries_the_three_protocols() {
        assert!(wrapper_has_protocols(include_str!("../../../scripts/jht-wrapper.ps1")));
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
        let no_pin = ("runtime-image", None);
        let manifest = "version=1\r\ndocker-compose.yml=aa\r\njht-wrapper.ps1=BB\r\nwindows-private-acl.ps1=cc\r\n";
        assert!(manifest_matches(manifest, &digests("bb"), no_pin.clone()));
        // A wrapper changed after the install.
        assert!(!manifest_matches(manifest, &digests("dd"), no_pin.clone()));
        // A missing file.
        let mut missing = digests("bb");
        missing[2].1 = None;
        assert!(!manifest_matches(manifest, &missing, no_pin.clone()));
        for bad in [
            "version=2\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\n",
            "version=1\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\n",
            "version=1\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\nextra=1\n",
            "version=1\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\n",
            "version=1\ndocker-compose.yml\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\n",
            // A pin line without the pin file.
            "version=1\ndocker-compose.yml=aa\njht-wrapper.ps1=bb\nwindows-private-acl.ps1=cc\nruntime-image=ee\n",
            "",
        ] {
            assert!(!manifest_matches(bad, &digests("bb"), no_pin.clone()), "{bad:?}");
        }
        // The test channel's pin: its line and its file together.
        let pinned = format!("{manifest}runtime-image=ee\r\n");
        let pin = ("runtime-image", Some("ee".to_owned()));
        assert!(manifest_matches(&pinned, &digests("bb"), pin.clone()));
        assert!(!manifest_matches(manifest, &digests("bb"), pin));
        assert!(!manifest_matches(&pinned, &digests("bb"), ("runtime-image", Some("ff".to_owned()))));
    }

    /// The layout install.ps1 writes on the Podman runtime, on disk: the
    /// compose files and the Podman selection under host-runtime, the wrapper
    /// with its helper and docker.exe shim in .local\bin.
    #[test]
    fn the_podman_bundle_is_checked_file_by_file() {
        use sha2::{Digest, Sha256};
        use std::fs;
        let root = std::env::temp_dir().join(format!(
            "jht-win-bundle-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let runtime = root.join("host-runtime");
        let bin = root.join("bin");
        fs::create_dir_all(&runtime).unwrap();
        fs::create_dir_all(&bin).unwrap();
        let wrapper = bin.join("jht.ps1");
        let files = [
            ("docker-compose.yml", runtime.join("docker-compose.yml"), "services: {}\n"),
            ("docker-compose.podman.yml", runtime.join("docker-compose.podman.yml"), "services: {}\n#podman\n"),
            ("container-runtime", runtime.join("container-runtime"), "podman\n"),
            ("podman-machine", runtime.join("podman-machine"), "jht-podman\n"),
            ("jht-container.service", runtime.join("jht-container.service"), "[Unit]\n"),
            ("jht-wrapper.ps1", wrapper.clone(), "$JHT_HOST_RUNTIME_PROTOCOL = 1\n"),
            ("windows-private-acl.ps1", bin.join("windows-private-acl.ps1"), "param()\n"),
            ("docker.exe", bin.join("docker.exe"), "MZ shim"),
        ];
        let digest = |path: &Path| format!("{:x}", Sha256::digest(fs::read(path).unwrap()));
        let mut manifest = String::from("version=1\n");
        for (key, path, content) in &files {
            fs::write(path, content).unwrap();
            manifest.push_str(&format!("{key}={}\n", digest(path)));
        }
        let manifest_path = runtime.join(".runtime-integrity");
        fs::write(&manifest_path, &manifest).unwrap();
        assert!(wrapper_bundle_valid(&wrapper, &runtime));

        // Each file changed after the install is refused.
        for (key, path, content) in &files {
            fs::write(path, format!("{content}changed")).unwrap();
            assert!(!wrapper_bundle_valid(&wrapper, &runtime), "{key}");
            fs::write(path, content).unwrap();
        }
        assert!(wrapper_bundle_valid(&wrapper, &runtime));

        // The test channel's image pin counts only with its manifest line.
        let pin = runtime.join("runtime-image");
        fs::write(&pin, "ghcr.io/leopu00/jht@sha256:aa\n").unwrap();
        assert!(!wrapper_bundle_valid(&wrapper, &runtime));
        fs::write(&manifest_path, format!("{manifest}runtime-image={}\n", digest(&pin))).unwrap();
        assert!(wrapper_bundle_valid(&wrapper, &runtime));
        fs::remove_file(&pin).unwrap();
        assert!(!wrapper_bundle_valid(&wrapper, &runtime));
        fs::write(&manifest_path, &manifest).unwrap();

        // A bundle that selects another engine is not this bundle, even with
        // its manifest line rewritten to match.
        let selection = runtime.join("container-runtime");
        let podman_line = format!("container-runtime={}", digest(&selection));
        fs::write(&selection, "docker\n").unwrap();
        fs::write(
            &manifest_path,
            manifest.replace(&podman_line, &format!("container-runtime={}", digest(&selection))),
        )
        .unwrap();
        assert!(!wrapper_bundle_valid(&wrapper, &runtime));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn wsl_is_ready_only_when_it_answers_with_success() {
        let answer = |code| {
            Ok(ProcessResult {
                code,
                stdout: Vec::new(),
            })
        };
        assert_eq!(wsl_state(answer(0)), Ok(()));
        for failed in [
            Err("process_start_failed"),
            Err("process_timeout"),
            answer(1),
            answer(-1),
        ] {
            assert_eq!(wsl_state(failed), Err("wsl_not_ready"));
        }
        let wsl = wsl_path(Some(OsString::from(r"D:\Win")));
        assert!(wsl.starts_with(r"D:\Win"));
        assert!(wsl.to_string_lossy().ends_with("wsl.exe"));
    }

    #[test]
    fn the_powershell_exit_codes_name_what_failed() {
        assert_eq!(exit_failure(20), Some("wsl_not_ready"));
        assert_eq!(exit_failure(21), Some("podman_missing"));
        assert_eq!(exit_failure(22), Some("podman_start_failed"));
        for generic in [0, 1, 2, 19, 23, 78, -1] {
            assert_eq!(exit_failure(generic), None, "{generic}");
        }
    }

    #[test]
    fn install_ps1s_end_is_told_by_its_exit_code() {
        assert_eq!(installer_outcome(Ok(0)), Ok(()));
        assert_eq!(installer_outcome(Ok(20)), Err("wsl_not_ready"));
        assert_eq!(installer_outcome(Ok(21)), Err("podman_missing"));
        assert_eq!(installer_outcome(Ok(22)), Err("podman_start_failed"));
        assert_eq!(installer_outcome(Ok(1)), Err("runtime_install_failed"));
        assert_eq!(installer_outcome(Err("process_timeout")), Err("timeout"));
        assert_eq!(installer_outcome(Err("process_start_failed")), Err("runtime_install_failed"));
    }

    #[test]
    fn only_install_ps1s_own_phase_lines_are_shown() {
        let ids: Vec<&str> = INSTALL_PHASES.iter().map(|(id, _)| *id).collect();
        assert_eq!(
            ids,
            [
                "wsl_check",
                "podman_install",
                "podman_machine_init",
                "podman_machine_start",
                "runtime_download",
                "image_pull"
            ]
        );
        assert_eq!(phase_message("JHT_PHASE wsl_check"), Some("Controllo WSL"));
        assert_eq!(phase_message("JHT_PHASE image_pull\r\n"), INSTALL_PHASES.last().map(|(_, m)| *m));
        for other in [
            "",
            "JHT_PHASE",
            "JHT_PHASE ",
            "JHT_PHASE unknown",
            "JHT_PHASE wsl_check extra",
            " JHT_PHASE wsl_check",
            "jht_phase wsl_check",
            "Installing Podman...",
        ] {
            assert_eq!(phase_message(other), None, "{other:?}");
        }
    }

    /// The ids the PowerShell side prints, one by one: a phase renamed on
    /// one side only would never show, and one the app does not know would
    /// be dropped.
    #[test]
    fn the_phase_ids_are_the_ones_the_powershell_side_prints() {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripts");
        let printed: std::collections::BTreeSet<String> = ["install.ps1", "enable-podman-windows-runtime.ps1"]
            .iter()
            .map(|name| std::fs::read_to_string(format!("{root}/{name}")).unwrap())
            .flat_map(|source| {
                source
                    .lines()
                    .filter_map(|line| line.trim().strip_prefix("Write-JhtPhase "))
                    .map(|id| id.trim().to_owned())
                    .collect::<Vec<_>>()
            })
            .collect();
        let known: std::collections::BTreeSet<String> =
            INSTALL_PHASES.iter().map(|(id, _)| (*id).to_owned()).collect();
        assert_eq!(printed, known);
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

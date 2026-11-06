use super::*;

    #[cfg(unix)]
    pub(super) fn write_valid_local_podman_manifest(runtime: &Path, wrapper: &Path) {
        fs::write(runtime.join("host-setup.sh"), "#!/bin/sh\nJHT_HOST_SETUP_PROTOCOL=1\nexit 0\n").unwrap();
        write_local_podman_manifest(runtime, wrapper);
    }

    #[cfg(unix)]
    pub(super) fn write_local_podman_manifest(runtime: &Path, wrapper: &Path) {
        use sha2::{Digest, Sha256};

        let digest = |path: &Path| format!("{:x}", Sha256::digest(fs::read(path).unwrap()));
        let mut lines = vec![
            "version=1".to_owned(),
            format!("docker-compose.yml={}", digest(&runtime.join("docker-compose.yml"))),
            format!("host-setup.sh={}", digest(&runtime.join("host-setup.sh"))),
            format!("jht-wrapper.sh={}", digest(wrapper)),
            format!("container-runtime={}", digest(&runtime.join("container-runtime"))),
            format!("docker-shim={}", digest(&runtime.join("bin/docker"))),
        ];
        #[cfg(target_os = "macos")]
        {
            fs::write(runtime.join("podman-machine"), "jht-podman\n").unwrap();
            lines.push(format!("podman-machine={}", digest(&runtime.join("podman-machine"))));
        }
        fs::write(runtime.join(".runtime-integrity"), format!("{}\n", lines.join("\n"))).unwrap();
    }

    /// The shape and length of macOS's per-user temporary folder (getconf DARWIN_USER_TEMP_DIR):
    /// /var/folders/<2>/<30>/T/, 49 characters. Placeholders, not a real one.
    pub(super) const MACOS_TMPDIR: &str = "/var/folders/xx/xxxxxxxxxxxxxxxxxxxxxxxx0000gn/T/";
    pub(super) fn exited(code: i32) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult { code, stdout: Vec::new() })
    }

    /// What a small read asks the server, and in what order.
    pub(super) fn small_reads(cursor: Option<&str>, answers: &[Option<&str>]) -> (Result<Option<String>, &'static str>, Vec<String>) {
        let mut asked = Vec::new();
        let mut answers = answers.iter();
        let result = small_read(cursor, &mut |sent: Option<&str>| -> Result<DirectChatPage, DirectChatError> {
            asked.push(sent.unwrap_or("none").to_owned());
            Ok(DirectChatPage { messages: Vec::new(), cursor: answers.next().expect("one answer per read").map(str::to_owned), questions: None, queued: None, settled: None, activity: None })
        });
        (result.map(|page| page.cursor).map_err(|error| error.code), asked)
    }
    /// The labels of the Windows team's container as Compose v2 over the Podman socket writes them
    /// (a real container of the test machine, user name replaced): no `io.podman.compose.*` at all.
    pub(super) fn windows_labels(dir: &str) -> serde_json::Value {
        serde_json::json!({
            "com.docker.compose.config-hash": "0e323430cfa29d71530d1c29a09cd8e167306d7a4e019eb2bd2f1c06b88db07f",
            "com.docker.compose.container-number": "1",
            "com.docker.compose.oneoff": "False",
            "com.docker.compose.project": "jht",
            "com.docker.compose.project.config_files": format!("{dir}\\docker-compose.yml,{dir}\\docker-compose.podman.yml"),
            "com.docker.compose.project.working_dir": dir,
            "com.docker.compose.service": "jht",
            "com.docker.compose.version": "5.1.2",
        })
    }
    // -- the environment the wrapper runs the compose in (the chat said «the running container is not the one Job Hunter Team installed») --

    use super::wrapper_compose_environment;

    pub(super) fn host_environment(file: Option<&str>, inherited: &[(&str, &str)]) -> Vec<(&'static str, String)> {
        let inherited: Vec<(String, String)> = inherited.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
        wrapper_compose_environment(file, &|key| inherited.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone()))
    }

    pub(super) fn pairs(values: &[(&'static str, &str)]) -> Vec<(&'static str, String)> {
        values.iter().map(|(k, v)| (*k, (*v).to_owned())).collect()
    }
    /// The layout of a Homebrew prefix under a folder of the test: `bin` with links into `Cellar/<name>/<version>/bin`,
    /// and a folder outside it. All folders 0755, as the install leaves them. (root, prefix, elsewhere)
    #[cfg(unix)]
    pub(super) fn tool_layout(label: &str) -> (PathBuf, PathBuf, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!("jht-tool-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (prefix, elsewhere) = (root.join("prefix"), root.join("elsewhere"));
        for dir in [prefix.join("bin"), prefix.join("Cellar/podman/6.1.3/bin"), elsewhere.clone()] {
            fs::create_dir_all(dir).unwrap();
        }
        for dir in [&root, &prefix, &elsewhere, &prefix.join("bin"), &prefix.join("Cellar"), &prefix.join("Cellar/podman"), &prefix.join("Cellar/podman/6.1.3"), &prefix.join("Cellar/podman/6.1.3/bin")] {
            fs::set_permissions(dir, fs::Permissions::from_mode(0o755)).unwrap();
        }
        (root, prefix, elsewhere)
    }

    #[cfg(unix)]
    pub(super) fn tool_program(path: &Path, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        fs::write(path, "#!/bin/sh\n").unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }
    /// A runtime with a fake `podman` and `podman-compose` in its `bin` (the tools the hash search finds first in a
    /// test) and a machine file: (root, runtime). The caller removes `root`. `podman_says` is what `podman
    /// --version` prints, `compose` the whole script of the provider.
    #[cfg(unix)]
    pub(super) fn hash_runtime(podman_script: &str, compose_script: &str) -> (PathBuf, PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-hash-runtime-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        fs::create_dir_all(runtime.join("bin")).unwrap();
        fs::write(runtime.join("podman-machine"), "jht-podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services: {}\n").unwrap();
        for (name, script) in [("podman", podman_script), ("podman-compose", compose_script)] {
            let tool = runtime.join("bin").join(name);
            fs::write(&tool, script).unwrap();
            fs::set_permissions(&tool, fs::Permissions::from_mode(0o700)).unwrap();
        }
        (root, runtime)
    }

    #[cfg(unix)]
    pub(super) const PODMAN_6_1_3: &str = "#!/bin/sh\n[ \"${1:-}\" = --version ] && { echo 'podman version 6.1.3'; exit 0; }\nexit 91\n";
    /// The provider's plan as the real one prints it: a create of the dependency with another hash, then the create
    /// of `jht` whose hash is `$1`.
    #[cfg(unix)]
    pub(super) fn compose_plan(hash_script: &str) -> String {
        format!("#!/bin/sh\n[ \"${{1:-}}\" = --version ] && {{ echo 'podman-compose version 1.6.0'; exit 0; }}\nh=$({hash_script})\nprintf 'podman create --name=jht-telegram --label io.podman.compose.config-hash=%s x\\n' \"{}\" >&2\nprintf 'podman create --name=jht --label io.podman.compose.config-hash=%s x\\n' \"$h\" >&2\n", "b".repeat(64))
    }
    #[cfg(unix)]
    pub(super) fn digest_of(text: &str) -> String {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(text.as_bytes()))
    }
    #[cfg(unix)]
    pub(super) fn listed(reason: &str) -> &str {
        assert!(crate::runtime_log::ATTEST_REASONS.contains(&reason), "{reason} is not a reason the log can say");
        reason
    }
    #[cfg(unix)]
    // in pieces: the repository scan of the release forbids any whole reference to the image that is not the manifest's
    pub(super) const PIN: &str = concat!("ghcr.io/leopu00/", "jht@sha256:", "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc");
    /// What the local chat steps (container lookup, exec) may take in a test:
    /// the fake engine is a few `sh` runs, and a loaded CI runner or the turn's
    /// parallel builds stretch them past two seconds. A refusal under test
    /// never waits this long: it fails before any engine runs.
    #[cfg(unix)]
    pub(super) const LOCAL_TEST_TIMEOUT: Duration = Duration::from_secs(30);

    /// A runtime the attestation accepts, with a fake private Podman shim whose `exec` echoes its
    /// arguments and stdin: (root, runtime dir, wrapper, container id). The caller removes `root`.
    #[cfg(unix)]
    pub(super) fn attested_local_fixture() -> (PathBuf, PathBuf, PathBuf, String) {
        attested_local_fixture_with(None)
    }

    /// The fixture with the engine's answer to `ps` said by the test (a shell command made from the one container as Podman
    /// lists it, with the labels of the installed runtime), or that one container.
    /// Every call of the engine is written, one first word per line, in `engine-calls.log` next to the runtime.
    #[cfg(unix)]
    pub(super) fn attested_local_fixture_with(ps_arm: Option<&dyn Fn(&serde_json::Value) -> String>) -> (PathBuf, PathBuf, PathBuf, String) {
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        let bin = runtime.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n").unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(
            &wrapper,
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\ntouch \"$(dirname \"$0\")/wrapper-was-run\"\n[ \"$1:$2\" = desktop-chat:probe ] || exit 9\nprintf 'true\\n'\n",
        )
        .unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        let engine = bin.join("docker");
        let id = "a".repeat(64);
        let mut labels = serde_json::json!({
            "com.docker.compose.project": "jht",
            "io.podman.compose.project": "jht",
            "com.docker.compose.service": "jht",
            "io.podman.compose.service": "jht",
            "com.docker.compose.container-number": "1",
            "com.docker.compose.project.working_dir": runtime.to_string_lossy(),
            "io.podman.compose.config-hash": "a".repeat(64),
        });
        #[cfg(target_os = "macos")]
        labels.as_object_mut().unwrap().extend([
            ("com.docker.compose.project.config_files".to_owned(), serde_json::json!(runtime.join("docker-compose.yml"))),
            ("io.podman.compose.version".to_owned(), serde_json::json!("1.6.0")),
            ("PODMAN_SYSTEMD_UNIT".to_owned(), serde_json::json!(podman_systemd_unit())),
        ]);
        #[cfg(all(unix, not(target_os = "macos")))]
        labels.as_object_mut().unwrap().extend([
            ("com.docker.compose.project.config_files".to_owned(), serde_json::json!(format!("{}/docker-compose.yml,{}/docker-compose.podman-linux.yml", runtime.display(), runtime.display()))),
            ("io.podman.compose.version".to_owned(), serde_json::json!("1.6.0")),
            ("PODMAN_SYSTEMD_UNIT".to_owned(), serde_json::json!(podman_systemd_unit())),
        ]);
        let row = serde_json::json!({"Id": id, "State": "running", "Labels": labels, "Image": "example.invalid/jht:test"});
        let ps_arm = match ps_arm {
            Some(said) => said(&row),
            None => format!("printf '%s\\n' '{}'", serde_json::json!([row])),
        };
        let calls = root.join("engine-calls.log");
        fs::write(
            &engine,
            format!(
                "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\necho \"$1\" >> '{}'\ncase \"$1\" in\n  ps) {ps_arm} ;;\n  inspect) printf 'true|{}\\n' ;;\n  exec) printf '%s\\n' \"$*\"; cat ;;\n  *) exit 9 ;;\nesac\n",
                calls.display(),
                labels
            ),
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        #[cfg(target_os = "macos")]
        {
            fs::write(bin.join("podman"), "#!/bin/sh\n[ \"${1:-}\" = --version ] && { echo 'podman version 6.1.3'; exit 0; }\nexit 91\n").unwrap();
            fs::write(bin.join("podman-compose"), format!("#!/bin/sh\n[ \"${{1:-}}\" = --version ] && {{ echo 'provider banner'; echo 'podman-compose version 1.6.0'; exit 0; }}\n[ -z \"${{JHT_IMAGE+x}}\" ] || exit 92\nprintf 'podman create --name=jht-telegram --label io.podman.compose.config-hash={} x\\n' >&2\nprintf 'podman create --name=jht --label io.podman.compose.config-hash={} x\\n' >&2\n", "7".repeat(64), "a".repeat(64))).unwrap();
            for helper in [bin.join("podman"), bin.join("podman-compose")] { fs::set_permissions(helper, fs::Permissions::from_mode(0o700)).unwrap(); }
        }
        write_valid_local_podman_manifest(&runtime, &wrapper);
        (root, runtime, wrapper, id)
    }

    pub(super) fn listing_of(rows: &str) -> Result<Vec<super::Candidate>, &'static str> {
        super::parse_listing(rows.as_bytes())
    }

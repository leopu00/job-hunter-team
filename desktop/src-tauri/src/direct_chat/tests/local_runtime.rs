use super::*;

    #[cfg(unix)]
    #[test]
    fn the_probe_the_python_and_the_delivery_run_in_the_attested_container_with_the_wrappers_programs() {
        use crate::existing_team_runtime::ChatOperation;
        let (launch, delivery) = (super::LOCAL_PYTHON_LAUNCH, super::LOCAL_DELIVERY_SCRIPT);
        let (root, runtime, wrapper, id) = attested_local_fixture();
        let said = |result: Result<ProcessResult, &'static str>| String::from_utf8(result.unwrap().stdout).unwrap();
        let operation = |operation: RemoteOperation<'_>, input: Option<&[u8]>| super::run_local_native(&wrapper, &runtime, &operation, input, LOCAL_TEST_TIMEOUT);
        // the probe: the container is there, nothing is run in it
        assert_eq!(said(operation(super::RemoteOperation::Probe, None)), "true\n");
        // the Python: the launcher the wrapper ran, the program on stdin
        assert_eq!(
            said(operation(super::RemoteOperation::Python, Some(b"0a"))),
            format!("exec -i {id} python3 -c {launch}\n0a")
        );
        // the delivery: the helper's line, the session as $1, the message on stdin
        assert_eq!(
            said(operation(super::RemoteOperation::Delivery("CAPITANO"), Some(b"[@utente -> @capitano] [CHAT] ciao"))),
            format!("exec -i {id} sh -c {delivery} sh CAPITANO\n[@utente -> @capitano] [CHAT] ciao")
        );
        // a session outside the chat's grammar is refused before any engine call
        for bad in ["capitano", "SCOUT-0", "SCOUT-12345", "CAPITANO; id", ""] {
            assert_eq!(operation(super::RemoteOperation::Delivery(bad), Some(b"x")).err(), Some("invalid_agent"), "{bad:?}");
        }
        assert_eq!(operation(super::RemoteOperation::Chat(ChatOperation::Read { agent: "capitano", cursor: None }), None).err(), Some("invalid_request"));
        // all of it only listed the engine and ran in the container: no inspect (the kept slot is one for the whole process, so a
        // test running at the same time may have taken it and made the container be found again)
        let calls = fs::read_to_string(root.join("engine-calls.log")).unwrap();
        assert!(calls.lines().all(|call| call == "ps" || call == "exec") && calls.lines().filter(|call| *call == "ps").count() <= 4, "{calls}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_programs_the_container_runs_carry_no_quote_and_keep_the_wrappers_meaning() {
        // no double quote in an argument: Windows PowerShell 5.1 dropped them (T71), and the engine gets these as they are
        assert!(!super::LOCAL_PYTHON_LAUNCH.contains('"') && !super::LOCAL_DELIVERY_SCRIPT.contains('"'));
        // the Python launcher is the wrapper's: read the hex of the program on the first line and run it
        assert_eq!(super::LOCAL_PYTHON_LAUNCH, "import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())");
        // the delivery keeps the message one word and its * and ? from matching files, without quotes
        assert!(super::LOCAL_DELIVERY_SCRIPT.starts_with("IFS=; set -f; msg=$(cat); exec jht-tmux-send"));
        let wrapper = include_str!("../../../../../scripts/jht-wrapper.ps1");
        assert!(wrapper.contains(&format!("'{}'", super::LOCAL_PYTHON_LAUNCH)), "the wrapper's launcher changed: the native one must follow");
        assert!(wrapper.contains(&format!("sh -c '{}'", super::LOCAL_DELIVERY_SCRIPT)), "the wrapper's delivery changed: the native one must follow");
    }

    #[test]
    fn the_local_operations_that_ask_the_container_no_longer_run_the_wrapper() {
        let source = DIRECT_CHAT_SOURCE;
        let local = source.split("ValidatedHost::Local => {\n            crate::account_scope::verify_local_runtime_owner(").nth(1).unwrap().split("ValidatedHost::Vps { .. } => {").next().unwrap();
        assert!(!local.contains("run_verified_local_wrapper"), "the local branch of run_connection starts the wrapper again");
        assert!(local.contains("run_local_native("));
    }

    #[cfg(unix)]
    #[test]
    fn a_runtime_without_a_container_runtime_file_is_a_docker_one() {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-no-selection-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        fs::create_dir_all(&runtime).unwrap();
        // Linux with Docker never writes the file: the engine is Docker, never «the runtime is missing».
        // Whether this machine has a docker program is the machine's; the cause is told truly either way.
        match super::local_chat_engine(&runtime) {
            Ok(engine) => assert!(!engine.podman),
            Err(code) => assert_eq!(code, "container_engine_missing"),
        }
        // A file that says something else is still refused as a runtime that is not the installed one.
        fs::write(runtime.join("container-runtime"), "lxc\n").unwrap();
        assert_eq!(super::local_chat_engine(&runtime).err(), Some("runtime_missing"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_attested_team_runs_commands_in_the_one_container_without_a_wrapper() {
        let (root, runtime, wrapper, id) = attested_local_fixture();
        let team = AttestedLocalTeam::resolve(&wrapper, &runtime, LOCAL_TEST_TIMEOUT).unwrap();
        // The fake engine echoes `exec`'s arguments, then its stdin: no -i without input.
        let started = team.exec(&["node", "/app/cli/bin/jht.js", "team", "start"], None, LOCAL_TEST_TIMEOUT).unwrap();
        assert_eq!(String::from_utf8(started.stdout).unwrap(), format!("exec {id} node /app/cli/bin/jht.js team start\n"));
        let fed = team.exec(&["cat"], Some("àè".as_bytes()), LOCAL_TEST_TIMEOUT).unwrap();
        assert_eq!(String::from_utf8(fed.stdout).unwrap(), format!("exec -i {id} cat\nàè"));
        assert_eq!(attested_exec_args("not-an-id", &["x"], false).unwrap_err(), "container_unavailable");
        assert_eq!(attested_exec_args(&id, &[], false).unwrap_err(), "container_unavailable");

        // The same refusals as the chat: a bundle changed after the manifest never reaches the engine.
        fs::write(&wrapper, "changed after the manifest\n").unwrap();
        assert_eq!(AttestedLocalTeam::resolve(&wrapper, &runtime, LOCAL_TEST_TIMEOUT).err(), Some("runtime_missing"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_chat_never_runs_the_engine_when_the_runtime_bundle_is_untrusted() {
        use crate::existing_team_runtime::ChatOperation;
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-attestation-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        let bin = runtime.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n").unwrap();
        let started = root.join("engine-was-called");
        let engine = bin.join("docker");
        fs::write(&engine, format!("#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\ntouch '{}'\n", started.display())).unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(
            &wrapper,
            "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\nexit 1\n",
        )
        .unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        write_valid_local_podman_manifest(&runtime, &wrapper);
        fs::write(&wrapper, "changed after the manifest\n").unwrap();

        assert_eq!(
            run_local_chat(
                &wrapper,
                &runtime,
                ChatOperation::Read { agent: "capitano", cursor: None },
                None,
                LOCAL_TEST_TIMEOUT,
            )
            .unwrap_err(),
            "runtime_missing"
        );
        assert!(!started.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_chat_never_execs_when_the_discovered_container_is_not_attested() {
        use crate::existing_team_runtime::ChatOperation;
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-container-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        let bin = runtime.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n").unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(&wrapper, "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\n").unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        let executed = root.join("exec-was-called");
        let engine = bin.join("docker");
        fs::write(
            &engine,
            format!(
                "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\ncase \"$1\" in\n  ps) printf '%s\\n' '[{{\"Id\":\"{}\",\"State\":\"running\",\"Labels\":{{}}}}]' ;;\n  exec) touch '{}' ;;\n  *) exit 9 ;;\nesac\n",
                "a".repeat(64),
                executed.display(),
            ),
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        write_valid_local_podman_manifest(&runtime, &wrapper);

        assert_eq!(
            run_local_chat(
                &wrapper,
                &runtime,
                ChatOperation::Read { agent: "capitano", cursor: None },
                None,
                LOCAL_TEST_TIMEOUT,
            )
            .unwrap_err(),
            "local_team_not_running"
        );
        assert!(!executed.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_chat_names_a_running_container_the_runtime_did_not_start_as_not_attested() {
        use crate::existing_team_runtime::ChatOperation;
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-unattested-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        let bin = runtime.join("bin");
        fs::create_dir_all(&bin).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(runtime.join("docker-compose.yml"), "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n").unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(&wrapper, "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\nJHT_DESKTOP_CHAT_PROTOCOL=1\nJHT_ONBOARDING_SNAPSHOT_PROTOCOL=1\n").unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        let executed = root.join("exec-was-called");
        let engine = bin.join("docker");
        fs::write(
            &engine,
            format!(
                "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\ncase \"$1\" in\n  ps) printf '%s\\n' '[{{\"Id\":\"{}\",\"State\":\"running\",\"Labels\":{{\"com.docker.compose.service\":\"jht\"}}}}]' ;;\n  exec) touch '{}' ;;\n  *) exit 9 ;;\nesac\n",
                "a".repeat(64),
                executed.display(),
            ),
        )
        .unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        // The tools the Mac works the container's hash out with, as fakes: a real Homebrew on the machine that runs the test
        // would be run against this stub runtime and not give a hash at all (which is another answer).
        for (name, script) in [("podman", PODMAN_6_1_3.to_owned()), ("podman-compose", compose_plan("printf x | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1"))] {
            fs::write(bin.join(name), script).unwrap();
            fs::set_permissions(bin.join(name), fs::Permissions::from_mode(0o700)).unwrap();
        }
        fs::write(runtime.join("podman-machine"), "jht-podman\n").unwrap();
        write_valid_local_podman_manifest(&runtime, &wrapper);

        assert_eq!(
            run_local_chat(
                &wrapper,
                &runtime,
                ChatOperation::Read { agent: "capitano", cursor: None },
                None,
                LOCAL_TEST_TIMEOUT,
            )
            .unwrap_err(),
            "local_container_not_attested"
        );
        assert!(!executed.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_chat_rejects_another_accounts_runtime_before_any_engine_lookup() {
        use crate::existing_team_runtime::ChatOperation;

        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-owner-{}",
            std::process::id(),
        ));
        fs::create_dir_all(&root).unwrap();
        let owner = root.join(".desktop-account-scope");
        fs::write(&owner, "different-account\n").unwrap();
        let scope = crate::account_scope::AccountScope::synthetic(b"local-chat-owner");
        let connection = Connection {
            app: None,
            scope,
            host: ExecutionHost::Local,
            validated: ValidatedHost::Local,
            runtime: None,
            local_wrapper: None,
            local_runtime: None,
            local_owner_marker: Some(owner),
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        };
        assert_eq!(
            run_connection(
                &connection,
                &[],
                RemoteOperation::Chat(ChatOperation::Read { agent: "capitano", cursor: None }),
                None,
                Duration::from_secs(2),
            )
            .unwrap_err()
            .code,
            "local_account_owner_mismatch"
        );
        fs::remove_dir_all(root).unwrap();
    }

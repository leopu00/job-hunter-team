use super::*;

    // The direct local path is a normal native process on both systems where this test runs. The
    // fake private Podman shim proves the container discovery, exact exec argv, and non-ASCII stdin
    // all survive without asking a shell or a PowerShell wrapper to reconstruct the text.
    #[cfg(unix)]
    #[test]
    fn local_chat_executes_the_attested_engines_python_with_raw_unicode_stdin() {
        use crate::existing_team_runtime::ChatOperation;

        let (root, runtime, wrapper, id) = attested_local_fixture();

        let words = "àèé € 🧭";
        let result = run_local_chat(
            &wrapper,
            &runtime,
            ChatOperation::Send {
                agent: "assistente",
                client_message_id: "id-1",
            },
            Some(words.as_bytes()),
            LOCAL_TEST_TIMEOUT,
        )
        .unwrap();
        assert_eq!(
            String::from_utf8(result.stdout).unwrap(),
            format!("exec -i {id} python3 -I /app/shared/skills/agent_chat.py send assistente id-1\n{words}")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_container_the_engine_lost_is_found_again_by_the_next_chat_call() {
        use crate::existing_team_runtime::ChatOperation;
        use std::os::unix::fs::PermissionsExt;

        let (root, runtime, wrapper, _id) = attested_local_fixture();
        let read = || {
            run_local_chat(&wrapper, &runtime, ChatOperation::Read { agent: "capitano", cursor: None }, None, LOCAL_TEST_TIMEOUT)
        };
        assert_eq!(read().unwrap().code, 0);
        // The container is gone: the engine answers 125 to the exec. The kept container is dropped.
        let engine = runtime.join("bin").join("docker");
        fs::write(&engine, "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\nexit 125\n").unwrap();
        fs::set_permissions(&engine, fs::Permissions::from_mode(0o700)).unwrap();
        // This call uses the kept container (or, if another test took the one slot, finds it again and
        // is refused: the engine is no longer the attested one).
        match read() {
            Ok(done) => assert_eq!(done.code, 125),
            Err(code) => assert_eq!(code, "runtime_missing"),
        }
        // The next call looks again (and is refused) instead of failing on the old id for five seconds.
        assert!(read().is_err(), "the lost container was not forgotten");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_an_engine_failure_or_a_vanished_container_empties_the_kept_one() {
        let done = |code| Ok(ProcessResult { code, stdout: Vec::new() });
        assert!(!engine_lost_the_container(&done(0)));
        // the chat script's own answers: the container is there
        for code in [2, 70, 119, 124, 126, 127, 130, 255] {
            assert!(!engine_lost_the_container(&done(code)), "{code}");
        }
        for code in [1, 3, 125] {
            assert!(engine_lost_the_container(&done(code)), "{code}");
        }
        // a slow engine is not a lost container; one that did not start is
        assert!(!engine_lost_the_container(&Err("process_timeout")));
        assert!(engine_lost_the_container(&Err("process_start_failed")));
    }

    #[test]
    fn a_podman_runtime_is_listed_once_by_the_project_and_service_labels_and_never_through_compose() {
        let podman: Vec<String> = super::local_listing_args().into_iter().map(|word| word.to_string_lossy().into_owned()).collect();
        assert_eq!(
            podman,
            ["ps", "-a", "--no-trunc", "--filter", "label=com.docker.compose.project=jht", "--filter", "label=com.docker.compose.service=jht", "--format", "json"]
        );
        // no word the Windows PowerShell of before had to be careful with: no quote, no space, no pipe
        assert!(podman.iter().all(|word| !word.contains(['"', ' ', '|'])));
        let docker: Vec<String> = local_compose_args(&LocalChatEngine { program: PathBuf::from("docker"), podman: false }, Path::new("/rt"))
            .into_iter()
            .map(|word| word.to_string_lossy().into_owned())
            .collect();
        assert_eq!(docker[0], "compose");
        assert!(docker.iter().any(|word| word == "--project-directory"));
    }

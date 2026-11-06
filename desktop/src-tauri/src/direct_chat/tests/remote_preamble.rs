use super::*;

    // The preamble runs on the VPS (a POSIX shell) and the test drives it with `sh` and a mode bit.
    #[cfg(unix)]
    #[test]
    fn the_remote_preamble_tells_a_wrapper_without_the_chat_marker_by_name_and_never_by_the_scripts_exit(
    ) {
        use std::os::unix::fs::PermissionsExt;
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "jht-chat-preamble-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        let command = remote_wrapper_command(&["desktop-chat".to_owned(), "read".to_owned(), "capitano".to_owned()], false);
        let answer_command = remote_wrapper_command(
            &["desktop-chat".to_owned(), "chat-answer".to_owned(), "capitano".to_owned(), "q1".to_owned()],
            true,
        );
        let run_command_with = |command: &str, wrapper: &str| {
            let binary = dir.join("jht");
            let _ = fs::remove_file(&binary);
            fs::write(&binary, wrapper).unwrap();
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o700)).unwrap();
            let done = Command::new("sh")
                .arg("-c")
                .arg(command)
                .env("PATH", format!("{}:/usr/bin:/bin", dir.display()))
                .env("HOME", &dir)
                .output()
                .unwrap();
            (done.status.code(), String::from_utf8_lossy(&done.stdout).into_owned())
        };
        let run_with = |wrapper: &str| run_command_with(&command, wrapper);
        let protocol = "JHT_DESKTOP_CHAT_PROTOCOL=1\n";
        let marker = "JHT_DESKTOP_CHAT_FIXED=1\n";
        let answer_marker = "JHT_DESKTOP_CHAT_ANSWER=1\n";
        // answer and enter need their own marker too: a wrapper with only the first chat actions is 64
        assert_eq!(
            run_command_with(&answer_command, &format!("#!/bin/sh\n{protocol}{marker}printf 'ran'\n")),
            (Some(UNKNOWN_ACTION), String::new())
        );
        assert_eq!(
            run_command_with(&answer_command, &format!("#!/bin/sh\n{protocol}{marker}{answer_marker}printf 'ran:%s' \"$*\"\n")),
            (Some(0), "ran:desktop-chat chat-answer capitano q1".to_owned())
        );
        // a wrapper with the chat actions runs, with exactly the arguments given
        assert_eq!(
            run_with(&format!("#!/bin/sh\n{protocol}{marker}printf 'ran:%s' \"$*\"\n")),
            (Some(0), "ran:desktop-chat read capitano".to_owned())
        );
        // one that does not have them is told apart by its missing marker: 64, and nothing ran
        assert_eq!(run_with(&format!("#!/bin/sh\n{protocol}printf 'ran'\n")), (Some(UNKNOWN_ACTION), String::new()));
        // the script's own 2 (python3: no such file, an image older than the chat) is not «no chat actions»
        assert_eq!(run_with(&format!("#!/bin/sh\n{protocol}{marker}exit 2\n")), (Some(2), String::new()));
        // an instance of a numbered role needs the marker of the instances: without it 64, with it the arguments given
        let instance_command = remote_wrapper_command(&["desktop-chat".to_owned(), "read".to_owned(), "analista-2".to_owned()], false);
        let instances_marker = "JHT_DESKTOP_CHAT_INSTANCES=1\n";
        assert_eq!(
            run_command_with(&instance_command, &format!("#!/bin/sh\n{protocol}{marker}printf 'ran'\n")),
            (Some(UNKNOWN_ACTION), String::new())
        );
        assert_eq!(
            run_command_with(&instance_command, &format!("#!/bin/sh\n{protocol}{marker}{instances_marker}printf 'ran:%s' \"$*\"\n")),
            (Some(0), "ran:desktop-chat read analista-2".to_owned())
        );
        // the fixed ids do not ask for it: an older wrapper keeps serving them
        assert_eq!(run_with(&format!("#!/bin/sh\n{protocol}{marker}printf 'ran'\n")), (Some(0), "ran".to_owned()));
        let _ = fs::remove_dir_all(&dir);
    }

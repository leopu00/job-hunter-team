    use super::*;
    use std::fs;

    // Unix only, like every test that builds a Connection (only_unix_tests_build_a_connection).
    #[cfg(unix)]
    #[test]
    fn the_paperclip_is_on_only_for_this_computers_team_and_says_why_it_is_off() {
        let connection = |validated: ValidatedHost, with_runtime: bool| Connection {
            app: None,
            scope: crate::account_scope::AccountScope::synthetic(b"attach-tests"),
            host: ExecutionHost::Local,
            validated,
            runtime: None,
            local_wrapper: with_runtime.then(|| PathBuf::from("/nonexistent/jht")),
            local_runtime: with_runtime.then(|| PathBuf::from("/nonexistent/runtime")),
            local_owner_marker: None,
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        };
        assert_eq!(attach_refusal(&connection(ValidatedHost::Local, false)), Some("attach_not_connected"));
        let vps = ValidatedHost::Vps {
            address: "203.0.113.7".into(),
            user: "jht".into(),
            port: 22,
            key_path: PathBuf::from("/nonexistent/key"),
            known_hosts: PathBuf::from("/nonexistent/known_hosts"),
        };
        assert_eq!(attach_refusal(&connection(vps, true)), Some("attach_vps"));
        let local = attach_refusal(&connection(ValidatedHost::Local, true));
        if cfg!(any(target_os = "macos", target_os = "linux")) {
            assert_eq!(local, None);
        } else {
            assert_eq!(local, Some("attach_platform"));
        }
    }

    #[test]
    fn the_person_reads_one_sentence_in_their_language_and_the_assistant_gets_the_path_behind_it() {
        // a document says «my CV»; a picture or a plain text, which is not known to be one, says «a file»
        for (file, cv) in [
            ("cv-20261028-153045.pdf", true),
            ("cv-20261028-153045.docx", true),
            ("cv-20261028-153045.odt", true),
            ("cv-20261028-153045.rtf", true),
            ("cv-20261028-153045.txt", false),
            ("cv-20261028-153045.md", false),
            ("cv-20261028-153045.png", false),
            ("cv-20261028-153045.jpg", false),
            ("cv-20261028-153045-2.jpg", false),
        ] {
            let path = format!("/jht_user/allegati/{file}");
            let mut said = std::collections::HashSet::new();
            for locale in ["it", "en", "de", "es", "fr", "hu", "pt", "xx", ""] {
                let text = attachment_message(locale, file);
                // the Assistant gets the path of our copy, on one line, and what it is for
                assert!(text.ends_with(&format!(" [attachment for my profile: {path}]")), "{locale} {file}");
                assert!(!text.contains('\n') && !text.contains('{') && text.len() < 200, "{locale} {file}");
                // the person gets a sentence: no path, no folder, no name of a file, no brackets
                let (visible, _) = text.split_once(" [attachment").unwrap();
                assert!(!visible.contains("jht_user") && !visible.contains(file) && !visible.contains('/') && !visible.contains('['), "{locale} {file}");
                assert!(visible.ends_with('.') && visible.len() > 10, "{locale} {file}");
                said.insert(visible.to_owned());
            }
            // seven languages, seven sentences (an unknown one and the empty one are English)
            assert_eq!(said.len(), 7, "{file}");
            let it = attachment_message("it", file);
            assert_eq!(it.starts_with("Ho allegato il mio CV. ["), cv, "{file}");
            assert_eq!(it.starts_with("Ho allegato un file. ["), !cv, "{file}");
        }
        // the Portuguese of Portugal, as the rest of the product
        assert!(attachment_message("pt", "cv-1.pdf").starts_with("Anexei o meu CV. ["));
        assert!(attachment_message("pt", "cv-1.png").starts_with("Anexei um ficheiro. ["));
        assert!(attachment_message("xx", "cv-1.pdf").starts_with("I attached my CV. ["));
        assert!(attachment_message("xx", "cv-1.png").starts_with("I attached a file. ["));
    }

    #[test]
    fn the_window_opens_on_downloads_when_the_person_has_that_folder_and_never_on_documents() {
        let home = std::env::temp_dir().join(format!("jht-downloads-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(home.join("Documents")).unwrap();
        assert_eq!(downloads_of(&home), None);
        fs::write(home.join("Downloads"), b"a file, not a folder").unwrap();
        assert_eq!(downloads_of(&home), None);
        fs::remove_file(home.join("Downloads")).unwrap();
        fs::create_dir_all(home.join("Downloads")).unwrap();
        assert_eq!(downloads_of(&home), Some(home.join("Downloads")));
        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn a_second_attachment_is_refused_while_one_is_in_hand_and_allowed_after() {
        // the flag alone, never the chat's state: that holds a Connection, and a test that drops one
        // does not start on Windows (see only_unix_tests_build_a_connection)
        let busy = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let first = AttachGuard::take(&busy).expect("the first is taken");
        assert!(AttachGuard::take(&busy).is_none());
        drop(first);
        assert!(AttachGuard::take(&busy).is_some());
    }

    #[test]
    fn the_command_checks_before_it_opens_the_window_and_tells_the_assistant_only_what_the_team_sees() {
        let source = crate::direct_chat::tests::DIRECT_CHAT_SOURCE;
        let command = source
            .split("pub(crate) async fn direct_chat_attach(")
            .nth(1)
            .unwrap()
            .split("\n}\n")
            .next()
            .unwrap();
        let at = |needle: &str| command.find(needle).unwrap_or_else(|| panic!("missing {needle}"));
        // only the app's own window, only the Assistant, one at a time
        assert!(at("window_may_write(") < at("AttachGuard::take"));
        assert!(command.contains("agent_id != \"assistente\""));
        // the same gate as a message, then the window, then the copy, then the proof, then the message
        assert!(at("attach_target(") < at("blocking_pick_file()"));
        assert!(at("blocking_pick_file()") < at("chat_attachment::store("));
        assert!(at("chat_attachment::store(") < at("team_sees_the_copy("));
        assert!(at("team_sees_the_copy(") < at("send_impl("));
        // a copy the team does not see is taken back, and nothing is told
        assert!(at("chat_attachment::remove(") < at("send_impl("));
        // the text is ours: built from the name of our copy, never from the page or the person's file
        assert!(command.contains("attachment_message(&locale, &saved.file)"));
        // the window opens where the person keeps downloads, and the copy is named by the local clock
        assert!(command.contains("set_directory(") && command.contains("target.start_dir"));
        assert!(command.contains("local_wall_clock("));
        // the person's own name goes back to their screen, never into the message or a log
        assert!(!command.contains("attachment_message(&locale, &saved.display)"));
    }

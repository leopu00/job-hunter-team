use super::*;

    #[test]
    fn send_allowlist_maps_to_fixed_sessions() {
        assert!(valid_agent("assistente"));
        assert_eq!(session_for("assistente").as_deref(), Some("ASSISTENTE"));
        assert_eq!(session_for("scout").as_deref(), Some("SCOUT-1"));
        for bad in ["", "CAPITANO;touch", "dottore", "../capitano"] {
            assert!(!valid_agent(bad));
        }
    }

    #[test]
    fn an_instance_of_a_numbered_role_is_an_id_of_the_chat_and_nothing_near_it_is() {
        for (id, session) in [("scout-2", "SCOUT-2"), ("analista-12", "ANALISTA-12"), ("scorer-4", "SCORER-4"), ("scrittore-9999", "SCRITTORE-9999"), ("scout-1", "SCOUT-1")] {
            assert!(valid_agent(id), "{id}");
            assert_eq!(session_for(id).as_deref(), Some(session), "{id}");
        }
        for bad in [
            "scout-0", "scout-01", "scout-10000", "scout-", "scout-x", "scout--1", "scout-1-2", "Scout-2", "SCOUT-2", "critico-2",
            "capitano-2", "mentor-1", "closer-1", "scout_2", " scout-2", "scout-2 ", "scout-2\n", "../scout-2", "scout-2/..", "scout-2;ls", "scout-٢",
        ] {
            assert!(!valid_agent(bad), "{bad:?}");
            assert_eq!(session_for(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn every_vps_chat_command_uses_the_attested_wrapper() {
        let mut commands = vec![REMOTE_CONTAINER_PROBE.to_owned(), REMOTE_PYTHON_STDIN.to_owned()];
        commands.extend(
            [
                "CAPITANO",
                "ASSISTENTE",
                "MENTOR",
                "SCOUT-1",
                "ANALISTA-1",
                "SCORER-1",
                "SCRITTORE-1",
                "CRITICO",
                "SCOUT-2",
                "ANALISTA-12",
            ]
            .into_iter()
            .map(|session| delivery_command(session).unwrap()),
        );

        assert_eq!(commands.len(), 12);
        for command in &commands {
            assert!(command.contains("JHT_DESKTOP_CHAT_PROTOCOL=1"));
            assert!(command.contains("exec \"$JHT_BIN\" desktop-chat"));
            assert!(!command.contains("docker "));
        }
        assert!(commands[10].ends_with("desktop-chat send SCOUT-2"));
        // the id of the chat is not a session, and nothing but the closed grammar becomes one
        for bad in ["scout", "scout-2", "SCOUT-0", "SCOUT-01", "SCOUT-2;ls", "SCOUT-2 ", "CRITICO-2", "CLOSER-1", ""] {
            assert!(delivery_command(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn cleanup_status_is_explicitly_disconnected() {
        assert_eq!(status("disconnected", None).state, "disconnected");
    }

    #[test]
    fn python_payload_is_framed_as_data_not_shell_text() {
        assert_eq!(hex_encode(b"a'b"), "612762");
    }

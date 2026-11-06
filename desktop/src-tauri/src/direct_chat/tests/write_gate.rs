use super::*;

    #[test]
    fn an_answer_and_an_enter_from_another_window_are_refused_before_anything_else() {
        let yes = ["yes".to_owned()];
        assert!(answer_request("main", "capitano", "aq:capitano:1-a1", &yes, None).is_ok());
        assert!(enter_request("main", "capitano", "0b1c2d3e").is_ok());
        for label in ["live-screen", "broker-login", "", "main2", "Main"] {
            assert_eq!(answer_request(label, "capitano", "aq:capitano:1-a1", &yes, None).unwrap_err().code, "invalid_request", "{label:?}");
            assert_eq!(enter_request(label, "capitano", "0b1c2d3e").unwrap_err().code, "invalid_request", "{label:?}");
        }
    }

    // Unix only, like every test that builds a Connection (only_unix_tests_build_a_connection).
    #[cfg(unix)]
    #[test]
    fn an_answer_and_an_enter_never_go_through_the_read_only_link() {
        use super::{answer_impl, enter_impl, DirectChatInner};
        // An existing team opened in the read-only view: a pinned target, and no full link made for it.
        let inner = DirectChatInner::default();
        *inner.connection.lock().unwrap() = Some(Connection {
            app: None,
            scope: crate::account_scope::AccountScope::synthetic(b"synthetic-account-read-only"),
            host: ExecutionHost::Local,
            validated: ValidatedHost::Local,
            runtime: Some(crate::existing_team_runtime::ActivatedTarget::synthetic_for_tests()),
            local_wrapper: None,
            local_runtime: None,
            local_owner_marker: None,
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        });
        // the gate answers before any command: a command would have failed with its own code
        assert_eq!(
            answer_impl(
                &inner,
                "capitano",
                "aq:capitano:1-a1",
                br#"{"choices":["yes"],"text":null}"#
            )
            .unwrap_err()
            .code,
            "read_only_link"
        );
        assert_eq!(
            enter_impl(&inner, "capitano", "0b1c2d3e").unwrap_err().code,
            "read_only_link"
        );
        // the same connection with no pinned target is this computer's own team: the gate lets it by,
        // and what stops it is the next step (here, no wrapper of the person's own)
        inner.connection.lock().unwrap().as_mut().unwrap().runtime = None;
        assert_ne!(
            answer_impl(
                &inner,
                "capitano",
                "aq:capitano:1-a1",
                br#"{"choices":["yes"],"text":null}"#
            )
            .unwrap_err()
            .code,
            "read_only_link"
        );
        assert_ne!(
            enter_impl(&inner, "capitano", "0b1c2d3e").unwrap_err().code,
            "read_only_link"
        );
    }

    #[test]
    fn only_the_apps_own_window_may_write_to_an_agent() {
        assert!(window_may_write("main"));
        for label in ["live-screen", "broker-login", "", "main2", "Main"] {
            assert!(!window_may_write(label), "{label:?}");
        }
    }

    #[test]
    fn an_existing_team_is_written_to_only_with_the_full_connection() {
        let team = crate::existing_team_runtime::ActivatedTarget::synthetic_for_tests();
        assert!(!link_allows_writing(Some(&team), true, |_| false), "the read-only view reads, it never writes");
        assert!(link_allows_writing(Some(&team), false, |_| true), "the confirmed team is written to");
        assert!(link_allows_writing(None, true, |_| false), "a local team, or a marked VPS of one's own, has no read-only view of this kind");
        assert!(!link_allows_writing(None, false, |_| true), "a VPS of one's own with no mark is not written to");
    }

    use super::*;

    fn at(seconds: u64, origin: Instant) -> Instant {
        origin + Duration::from_secs(seconds)
    }

    #[test]
    fn a_failure_is_written_once_until_its_code_changes_or_a_call_works() {
        let origin = Instant::now();
        let mut last = LoggedCall::NONE;
        let failed = |code| Err((code, None));
        let took = Duration::from_millis(200);
        assert_eq!(chat_call_line(&mut last, failed("read_failed"), took, at(0, origin)), Some(("read_failed", None)));
        // every two seconds, the same failure: nothing new
        assert_eq!(chat_call_line(&mut last, failed("read_failed"), took, at(2, origin)), None);
        assert_eq!(chat_call_line(&mut last, failed("read_failed"), took, at(4, origin)), None);
        // another code, or the same code for another reason of the container check, is new
        assert_eq!(chat_call_line(&mut last, failed("process_timeout"), took, at(6, origin)), Some(("process_timeout", None)));
        assert_eq!(
            chat_call_line(&mut last, Err(("local_container_not_attested", Some("label_config_hash_differs"))), took, at(8, origin)),
            Some(("local_container_not_attested", Some("label_config_hash_differs")))
        );
        // a call that works ends the failure: the same failure after it is a new one
        assert_eq!(chat_call_line(&mut last, Ok(()), took, at(10, origin)), None);
        assert_eq!(chat_call_line(&mut last, failed("process_timeout"), took, at(12, origin)), Some(("process_timeout", None)));
    }

    #[test]
    fn a_call_that_worked_is_written_only_when_slow_and_not_again_for_a_while() {
        let origin = Instant::now();
        let mut last = LoggedCall::NONE;
        assert_eq!(chat_call_line(&mut last, Ok(()), SLOW_CHAT_CALL - Duration::from_millis(1), at(0, origin)), None);
        assert_eq!(chat_call_line(&mut last, Ok(()), SLOW_CHAT_CALL, at(1, origin)), Some(("ok_slow", None)));
        // the next slow ones within the pause are not written, the one after it is
        assert_eq!(chat_call_line(&mut last, Ok(()), Duration::from_secs(9), at(10, origin)), None);
        assert_eq!(chat_call_line(&mut last, Ok(()), Duration::from_secs(9), at(1 + 30, origin)), Some(("ok_slow", None)));
        // a fast call is never written
        assert_eq!(chat_call_line(&mut last, Ok(()), Duration::from_millis(900), at(100, origin)), None);
    }

    #[test]
    fn each_kind_of_call_has_its_own_memory_and_the_log_says_operation_code_and_time() {
        let dir = std::env::temp_dir().join(format!("jht-chat-call-log-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let log = crate::runtime_log::RuntimeLog::in_dir(&dir);
        let memory = Mutex::new([LoggedCall::NONE; 6]);
        // a probe that failed after 8.7 s, a read that failed fast, a send that worked slowly
        log_chat_call_in(&memory, Some(&log), "probe", Err("container_unavailable"), Duration::from_millis(8_700));
        log_chat_call_in(&memory, Some(&log), "read", Err("read_failed"), Duration::from_millis(120));
        log_chat_call_in(&memory, Some(&log), "send", Ok(()), Duration::from_secs(7));
        // the same probe failure again, and a fast probe: nothing more
        log_chat_call_in(&memory, Some(&log), "probe", Err("container_unavailable"), Duration::from_millis(9_000));
        log_chat_call_in(&memory, Some(&log), "connect", Ok(()), Duration::from_millis(300));
        // an operation outside the list leaves nothing
        log_chat_call_in(&memory, Some(&log), "format_disk", Err("read_failed"), Duration::from_secs(1));
        let text = fs::read_to_string(log.path()).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 3, "{text}");
        assert!(lines[0].contains(" direct_chat.probe: container_unavailable took_ms=8700"), "{text}");
        assert!(lines[1].contains(" direct_chat.read: read_failed took_ms=120"), "{text}");
        assert!(lines[2].contains(" direct_chat.send: ok_slow took_ms=7000"), "{text}");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn every_call_of_the_chat_ends_in_the_log() {
        let source = crate::direct_chat::tests::DIRECT_CHAT_SOURCE;
        for (name, call) in [
            ("pub(crate) async fn direct_chat_read(", "\"read\""),
            ("pub(crate) async fn direct_chat_send(", "\"send\""),
            ("pub(crate) async fn direct_chat_answer(", "\"answer\""),
            ("pub(crate) async fn direct_chat_enter(", "\"enter\""),
            ("async fn connect_scoped(", "\"connect\""),
            ("fn probe(connection: &Connection)", "\"probe\""),
        ] {
            let body = source.split(name).nth(1).unwrap_or_else(|| panic!("{name}")).split("\n}\n").next().unwrap();
            assert!(body.contains("log_chat_call(") && body.contains(call), "{name} ends without a line in the runtime log");
            assert!(body.contains("Instant::now()"), "{name} does not time itself");
        }
    }

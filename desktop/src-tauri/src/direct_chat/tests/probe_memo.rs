    use super::*;
    use std::cell::Cell;
    use std::time::Instant;

    fn ready() -> DirectChatStatus {
        status("ready", None)
    }
    fn failed() -> DirectChatStatus {
        status("error", Some("container_unavailable"))
    }
    fn scope(label: &[u8]) -> AccountScope {
        AccountScope::synthetic(label)
    }

    #[test]
    fn a_ready_answer_is_kept_for_a_while_and_a_failure_for_less() {
        let a = scope(b"synthetic-memo-a");
        let t0 = Instant::now();
        let mut memo = ProbeMemo::default();
        assert_eq!(memo.fresh(&a, t0), None);
        memo.keep(&a, t0, &ready());
        assert_eq!(memo.fresh(&a, t0 + PROBE_READY_KEPT - Duration::from_millis(1)), Some(ready()));
        assert_eq!(memo.fresh(&a, t0 + PROBE_READY_KEPT), None);
        memo.keep(&a, t0, &failed());
        assert_eq!(memo.fresh(&a, t0 + PROBE_FAILED_KEPT - Duration::from_millis(1)), Some(failed()));
        assert_eq!(memo.fresh(&a, t0 + PROBE_FAILED_KEPT), None);
        assert!(PROBE_FAILED_KEPT < PROBE_READY_KEPT);
    }

    #[test]
    fn an_answer_is_of_one_account_and_is_dropped_when_the_connection_changes() {
        let (a, b) = (scope(b"synthetic-memo-a"), scope(b"synthetic-memo-b"));
        let t0 = Instant::now();
        let mut memo = ProbeMemo::default();
        memo.keep(&a, t0, &ready());
        assert_eq!(memo.fresh(&b, t0), None);
        memo.forget();
        assert_eq!(memo.fresh(&a, t0), None);
    }

    #[test]
    fn two_asks_in_a_row_start_one_probe_and_a_stale_or_forgotten_answer_starts_another() {
        let a = scope(b"synthetic-memo-a");
        let memo = Mutex::new(ProbeMemo::default());
        let origin = Instant::now();
        let clock = Cell::new(origin);
        let probes = Cell::new(0);
        let ask = |answer: DirectChatStatus| {
            status_kept_or_probed(&memo, &a, || clock.get(), || {
                probes.set(probes.get() + 1);
                answer
            })
        };
        assert_eq!(ask(ready()), ready());
        // the second finds the first's answer: its own probe never runs
        assert_eq!(ask(failed()), ready());
        assert_eq!(probes.get(), 1);
        clock.set(origin + PROBE_READY_KEPT + Duration::from_secs(1));
        assert_eq!(ask(failed()), failed());
        assert_eq!(probes.get(), 2);
        memo.lock().unwrap().forget();
        assert_eq!(ask(ready()), ready());
        assert_eq!(probes.get(), 3);
    }

    #[test]
    fn the_status_of_a_connection_goes_through_the_memo_and_every_change_of_the_connection_drops_it() {
        let source = crate::direct_chat::tests::DIRECT_CHAT_SOURCE;
        let body = source.split("fn status_for_scope(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(body.contains("status_kept_or_probed("), "{body}");
        assert!(!body.contains("Ok(probe(connection))"));
        // connect and reconnect, close and sign-out
        for place in ["fn connect_scoped(", "pub(crate) async fn direct_chat_close(", "pub(crate) fn teardown("] {
            let rest = source.split(place).nth(1).unwrap_or_else(|| panic!("{place}"));
            let body = rest.split("\n}\n").next().unwrap();
            assert!(body.contains("forget_probe("), "{place} keeps a probe answer of a connection that is gone");
        }
    }

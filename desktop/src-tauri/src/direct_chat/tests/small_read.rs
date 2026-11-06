use super::*;

    #[test]
    fn a_first_small_read_asks_the_size_then_the_last_32_kib() {
        assert_eq!((SMALL_READ_TAIL, SMALL_READ_OVERLAP, SMALL_READ_SIZE_PROBE), (32_768, 20_480, "999999999999"));
        assert_eq!(small_reads(None, &[Some("500000"), Some("500000")]), (Ok(Some("500000".into())), vec!["999999999999".into(), "467232".into()]));
        // a chat shorter than the tail is read whole, from 0
        assert_eq!(small_reads(None, &[Some("1200"), Some("1200")]).1, ["999999999999", "0"]);
        // a size the server does not give is a failed read, not a read from 0
        assert_eq!(small_reads(None, &[None]).0, Err("read_failed"));
    }

    #[test]
    fn a_later_small_read_starts_20_kib_before_the_cursor_and_a_shorter_chat_starts_again() {
        assert_eq!(small_reads(Some("500000"), &[Some("501000")]), (Ok(Some("501000".into())), vec!["479520".into()]));
        assert_eq!(small_reads(Some("9000"), &[Some("9000")]).1, ["0"], "never below 0");
        // the chat got shorter than where the read started: the size, then the tail
        assert_eq!(
            small_reads(Some("500000"), &[Some("4000"), Some("4000"), Some("4000")]).1,
            ["479520", "999999999999", "0"]
        );
        // a cursor that is not a number is a first read
        assert_eq!(small_reads(Some("x"), &[Some("10"), Some("10")]).1, ["999999999999", "0"]);
    }

    #[test]
    fn only_the_per_command_link_to_a_vps_reads_small() {
        let source = DIRECT_CHAT_SOURCE.split("mod tests {").next().unwrap();
        let read = source.split("pub(crate) async fn direct_chat_read(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(read.contains("if connection.link == VpsLink::PerCommand && matches!(connection.validated, ValidatedHost::Vps { .. }) {\n                return small_read(cursor.as_deref(), &mut |cursor| read_page(connection, &agent_id, cursor));"));
        assert!(read.contains("read_page(connection, &agent_id, cursor.as_deref())"), "every other link reads as before");
    }

    /// A test that builds a `Connection` drops it, and with it its `Option<AppHandle>`: that drop glue
    /// links Tauri's window runtime into the test binary, whose comctl32 v6 imports a test binary
    /// (no application manifest) cannot resolve on Windows. The binary died at start with
    /// STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139) and no test ran. So a test that builds one runs on Unix only.
    #[test]
    fn only_unix_tests_build_a_connection() {
        let tests = DIRECT_CHAT_TEST_SOURCE;
        let mut built = 0;
        // the needles in two pieces, so this very test is not one of the places it finds; the chat's state
        // holds a Connection, so building it drops one just the same
        for needle in [concat!("Connection", " {"), concat!("DirectChatInner", "::default()"), concat!("DirectChatState", "::default()")] {
            for (at, _) in tests.match_indices(needle) {
                built += 1;
                let test_start = tests[..at].rfind("#[test]").expect("inside a test");
                let attributes = &tests[..test_start];
                let attributes = &attributes[attributes.rfind('\n').map_or(0, |line| attributes[..line].rfind('\n').unwrap_or(0))..];
                assert!(attributes.contains("#[cfg(unix)]"), "{needle} built outside a Unix-only test, before byte {at}");
            }
        }
        assert!(built >= 1, "the Unix probe test builds one");
    }

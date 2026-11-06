    use super::*;

    #[cfg(unix)]
    fn vps() -> ValidatedHost {
        ValidatedHost::Vps {
            address: "203.0.113.7".into(),
            user: "jht".into(),
            port: 22,
            key_path: PathBuf::from("/nonexistent/key"),
            known_hosts: PathBuf::from("/nonexistent/known_hosts"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_read_on_this_computer_lets_go_of_the_connection_before_it_works_and_a_vps_read_keeps_it() {
        let scope = AccountScope::synthetic(b"synthetic-read-a");
        let inner = DirectChatInner::default();
        *inner.connection.lock().unwrap() = Some(synthetic_connection(ValidatedHost::Local, &scope));
        let free_inside = with_connection_read(&inner, &scope, |_| Ok(inner.connection.try_lock().is_ok())).unwrap();
        assert!(free_inside, "the lock was still held while the read worked on this computer");
        // the read got the paths of the runtime of the connection, not its tunnel or master
        let paths = with_connection_read(&inner, &scope, |connection| {
            Ok((connection.local_wrapper.clone(), connection.local_runtime.clone(), connection.control_path.is_none() && connection.tunnel.is_none()))
        })
        .unwrap();
        assert_eq!(paths, (Some(PathBuf::from("/synthetic/wrapper")), Some(PathBuf::from("/synthetic/runtime")), true));
        // a VPS: the master and the tunnel are the connection's own, so its lock stays
        *inner.connection.lock().unwrap() = Some(synthetic_connection(vps(), &scope));
        let held_inside = with_connection_read(&inner, &scope, |_| Ok(inner.connection.try_lock().is_err())).unwrap();
        assert!(held_inside, "a VPS read let go of the connection it works on");
    }

    #[cfg(unix)]
    #[test]
    fn a_read_of_another_account_or_of_no_connection_is_refused_before_it_works() {
        let (mine, other) = (AccountScope::synthetic(b"synthetic-read-a"), AccountScope::synthetic(b"synthetic-read-b"));
        let inner = DirectChatInner::default();
        let ran = std::cell::Cell::new(false);
        let work = |_: &Connection| {
            ran.set(true);
            Ok(())
        };
        assert_eq!(with_connection_read(&inner, &mine, work).err().map(|error| error.code), Some("disconnected"));
        *inner.connection.lock().unwrap() = Some(synthetic_connection(ValidatedHost::Local, &other));
        assert_eq!(with_connection_read(&inner, &mine, work).err().map(|error| error.code), Some("account_scope_mismatch"));
        assert!(!ran.get());
    }

    #[cfg(unix)]
    #[test]
    fn a_detached_connection_owns_nothing_to_close() {
        let scope = AccountScope::synthetic(b"synthetic-read-a");
        assert!(synthetic_connection(vps(), &scope).detached_local().is_none());
        let local = synthetic_connection(ValidatedHost::Local, &scope);
        let detached = local.detached_local().unwrap();
        assert!(detached.control_path.is_none() && detached.tunnel.is_none() && detached.runtime.is_none());
        // dropping it closes nothing: close_connection only acts on a VPS master or a tunnel
        drop(detached);
    }

    #[cfg(unix)]
    #[test]
    fn the_reads_that_ran_a_process_under_the_lock_no_longer_do() {
        let source = crate::direct_chat::tests::DIRECT_CHAT_SOURCE;
        // the read of a page, the scripts' read and the probe go through the release; the sends keep their serial lock
        for (place, needle) in [
            ("pub(crate) async fn direct_chat_read(", "with_connection_read("),
            ("pub(crate) async fn team_script_read(", "with_connection_read("),
            ("fn status_for_scope(", "detached_local()"),
        ] {
            let body = source.split(place).nth(1).unwrap_or_else(|| panic!("{place}")).split("\n}\n").next().unwrap();
            assert!(body.contains(needle), "{place} holds the connection's lock for its process again");
        }
        let write = source.split("fn send_impl(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(write.contains("send_lock"), "a send is serial");
    }

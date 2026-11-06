use super::*;

    /// Win32-OpenSSH has no ControlMaster (T69): on Windows a VPS is reached one connection per command.
    #[test]
    fn only_windows_reaches_a_vps_one_connection_per_command() {
        assert_eq!(vps_link_for("windows"), VpsLink::PerCommand);
        for os in ["macos", "linux", "freebsd"] {
            assert_eq!(vps_link_for(os), VpsLink::Master, "{os}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn this_windows_build_never_opens_an_ssh_master() {
        assert_eq!(vps_link_for(std::env::consts::OS), VpsLink::PerCommand);
    }

    /// Without a master the link is one ssh that answers, with the master's own errors; there is no
    /// socket and no process to keep or to close.
    #[test]
    fn a_per_command_link_is_one_ssh_that_answers_with_the_masters_errors() {
        let host = synthetic_vps();
        let mut asked = Vec::new();
        let opened = open_vps_link(&host, VpsLink::PerCommand, |checked| {
            asked.push(matches!(checked, ValidatedHost::Vps { .. }));
            exited(0)
        })
        .expect("an ssh that answers is a link");
        assert!(opened.0.is_none() && opened.1.is_none());
        assert_eq!(asked, [true]);
        for (outcome, code) in [
            (exited(255), "tunnel_verify_failed"),
            (exited(1), "tunnel_verify_failed"),
            (Err("process_timeout"), "tunnel_verify_failed"),
            // a way in that has a sentence of its own is passed on, not folded into the generic one
            (Err("ssh_client_missing"), "ssh_client_missing"),
            (Err("ssh_auth_failed"), "ssh_auth_failed"),
            (Err("ssh_rate_limited"), "ssh_rate_limited"),
        ] {
            let error = open_vps_link(&host, VpsLink::PerCommand, |_| outcome).unwrap_err();
            assert_eq!(error.code, code);
        }
        // the check is a command every remote shell runs the same way
        assert_eq!(VPS_LINK_CHECK, "exit 0");
    }

    /// A lent socket is used only while its folder is still the chat's: a real folder of this user,
    /// 0700, with the chat's prefix. Another owner, a folder open to others, a link or another name:
    /// a connection of its own.
    #[cfg(unix)]
    #[test]
    fn a_lent_socket_must_sit_in_a_folder_still_the_chats() {
        use super::{lent_socket_still_ours, socket_folder_owned_by};
        use std::os::unix::fs::PermissionsExt;
        let base = std::env::temp_dir().join(format!("jht-lend-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        // SAFETY: geteuid has no arguments or pointers.
        let me = unsafe { libc::geteuid() };
        let ours = base.join("jcabcdef0123");
        fs::create_dir(&ours).unwrap();
        fs::set_permissions(&ours, fs::Permissions::from_mode(0o700)).unwrap();
        let socket = ours.join("s");
        assert!(socket_folder_owned_by(&socket, me));
        assert!(lent_socket_still_ours(&socket));
        assert!(!socket_folder_owned_by(&socket, me.wrapping_add(1)), "another owner");

        fs::set_permissions(&ours, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(!lent_socket_still_ours(&socket), "a folder others can read");
        fs::set_permissions(&ours, fs::Permissions::from_mode(0o700)).unwrap();

        let link = base.join("jclinkxyz");
        std::os::unix::fs::symlink(&ours, &link).unwrap();
        assert!(!lent_socket_still_ours(&link.join("s")), "a link to a folder of ours");

        let named = base.join("other0123");
        fs::create_dir(&named).unwrap();
        fs::set_permissions(&named, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(!lent_socket_still_ours(&named.join("s")), "not the chat's name");

        assert!(!lent_socket_still_ours(&base.join("jcgone").join("s")), "a folder that is gone");
        assert!(!lent_socket_still_ours(Path::new("s")), "no folder");
        fs::remove_dir_all(&base).unwrap();
    }

    /// The page reads every 5 s instead of 1.5 only when each read is a new ssh connection.
    #[test]
    fn only_a_vps_reached_per_command_is_ready_with_a_slow_link() {
        assert_eq!(
            serde_json::to_value(ready_status(&synthetic_vps(), VpsLink::PerCommand)).unwrap(),
            serde_json::json!({"state": "ready", "link": "per-command"})
        );
        assert_eq!(serde_json::to_value(ready_status(&synthetic_vps(), VpsLink::Master)).unwrap(), serde_json::json!({"state": "ready"}));
        assert_eq!(
            serde_json::to_value(ready_status(&ValidatedHost::Local, VpsLink::PerCommand)).unwrap(),
            serde_json::json!({"state": "ready"})
        );
        // the status of a ready connection is this one
        let source = DIRECT_CHAT_SOURCE.split("mod tests {").next().unwrap();
        assert!(source.contains("fn ready_for(connection: &Connection) -> DirectChatStatus {\n    ready_status(&connection.validated, connection.link)\n}"));
    }

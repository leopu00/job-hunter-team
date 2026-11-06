use super::*;

    #[test]
    fn the_tunnel_socket_fits_with_sshs_temporary_name_even_in_macos_long_tmpdir() {
        assert_eq!(MACOS_TMPDIR.len(), 49);
        // the old name, in a macOS TMPDIR: 95 characters, 112 with ssh's suffix
        let old = std::path::Path::new(MACOS_TMPDIR).join("jht-direct-chat-12345-1792703033508090000.sock");
        assert!(!control_path_fits(&old), "the old socket path must be the one that does not fit");
        // the new one, made of the same pieces open_tunnel uses
        let new = std::path::Path::new(MACOS_TMPDIR).join(format!("jc{}", tunnel_dir_name())).join("s");
        assert!(control_path_fits(&new), "{} characters", new.as_os_str().len());
        assert!(new.as_os_str().len() + SSH_SOCKET_SUFFIX <= SOCKET_PATH_MAX);
        assert_eq!(SOCKET_PATH_MAX, 103, "macOS: sun_path is 104 bytes with its NUL");
    }

    #[test]
    fn on_unix_the_tunnel_socket_stays_under_half_the_limit_in_tmp_before_the_tmpdir() {
        let bases = tunnel_socket_bases();
        #[cfg(unix)]
        {
            assert_eq!(bases[0], std::path::Path::new("/tmp"));
            let socket = bases[0].join(format!("jc{}", tunnel_dir_name())).join("s");
            assert!(socket.as_os_str().len() + SSH_SOCKET_SUFFIX <= SOCKET_PATH_MAX / 2, "{}", socket.display());
        }
        assert_eq!(bases.last().unwrap(), &std::env::temp_dir(), "the user's temporary folder is the fallback");
    }

    #[test]
    fn the_tunnel_socket_is_alone_in_a_private_folder_of_its_own_and_goes_with_it() {
        let base = std::env::temp_dir().join(format!("jht-tunnel-test-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let socket = tunnel_socket_path(std::slice::from_ref(&base), tunnel_dir_name).expect("a socket path");
        let dir = socket.parent().unwrap().to_owned();
        assert_eq!(dir.parent().unwrap(), base);
        assert!(socket.ends_with("s") && control_path_fits(&socket));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(&dir).unwrap().permissions().mode() & 0o777, 0o700);
        }
        // a folder someone prepared with the same name is never used: another name is tried
        let mut names = vec!["taken000".to_owned(), "free0000".to_owned()].into_iter();
        fs::create_dir(base.join("jctaken000")).unwrap();
        let other = tunnel_socket_path(std::slice::from_ref(&base), || names.next().unwrap()).unwrap();
        assert_eq!(other, base.join("jcfree0000").join("s"));
        // closing removes the socket and its folder, never a folder that is not ours
        fs::write(&socket, b"").unwrap();
        remove_tunnel_socket(&socket);
        assert!(!dir.exists());
        let foreign = base.join("other").join("s");
        fs::create_dir_all(foreign.parent().unwrap()).unwrap();
        remove_tunnel_socket(&foreign);
        assert!(foreign.parent().unwrap().exists());
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_base_too_long_for_a_socket_is_skipped_for_the_next_one() {
        let long = std::path::PathBuf::from(format!("/{}", "x".repeat(100)));
        let base = std::env::temp_dir().join(format!("jht-tunnel-next-{}", std::process::id()));
        fs::create_dir_all(&base).unwrap();
        let socket = tunnel_socket_path(&[long.clone(), base.clone()], tunnel_dir_name).unwrap();
        assert!(socket.starts_with(&base));
        assert_eq!(tunnel_socket_path(&[long], tunnel_dir_name), Err("tunnel_path_unavailable"));
        let _ = fs::remove_dir_all(&base);
    }

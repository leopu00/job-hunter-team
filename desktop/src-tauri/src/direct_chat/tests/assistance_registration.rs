    use super::*;
    struct Temporary(PathBuf);
    impl Temporary {
        fn new() -> Self {
            // Two tests starting in the same clock tick must not share a name: a counter breaks the tie.
            static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "jht-assistance-register-{}-{nonce}-{}",
                std::process::id(),
                NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            ));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
        fn path(&self) -> PathBuf {
            self.0.join("account/direct-chat-host.json")
        }
    }
    impl Drop for Temporary {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    fn host(label: &str) -> ExecutionHost {
        ExecutionHost::Vps {
            address: format!("{label}.invalid"),
            user: "fixture".into(),
            port: 22,
            key_path: "/fixture/key".into(),
        }
    }
    #[test]
    fn absent_host_is_private_and_same_host_keeps_exact_bytes() {
        let temp = Temporary::new();
        let path = temp.path();
        register_assistance_host_at(&path, &host("one")).unwrap();
        assert_eq!(
            serde_json::from_slice::<ExecutionHost>(&fs::read(&path).unwrap()).unwrap(),
            host("one")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
            assert_eq!(
                fs::metadata(path.parent().unwrap())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o700
            );
        }
        // Exact existing bytes, including harmless whitespace, are preserved.
        let mut bytes = fs::read(&path).unwrap();
        bytes.push(b'\n');
        fs::write(&path, &bytes).unwrap();
        register_assistance_host_at(&path, &host("one")).unwrap();
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
    }
    #[test]
    fn different_existing_host_is_never_overwritten() {
        let temp = Temporary::new();
        let path = temp.path();
        register_assistance_host_at(&path, &host("one")).unwrap();
        let before = fs::read(&path).unwrap();
        assert_eq!(
            register_assistance_host_at(&path, &host("two")),
            Err("browser_connection_changed")
        );
        assert_eq!(fs::read(&path).unwrap(), before);
    }
    #[test]
    fn malformed_oversize_extra_fields_and_nonfile_deny_without_repair() {
        let temp = Temporary::new();
        let path = temp.path();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut extra = serde_json::to_value(host("one")).unwrap();
        extra["container_id"] = json!("spoof");
        for bytes in [
            b"{".to_vec(),
            vec![b' '; 4097],
            serde_json::to_vec(&extra).unwrap(),
        ] {
            fs::write(&path, &bytes).unwrap();
            assert_eq!(
                register_assistance_host_at(&path, &host("one")),
                Err("host_config_invalid")
            );
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert_eq!(
            register_assistance_host_at(&path, &host("one")),
            Err("host_config_invalid")
        );
        assert!(path.is_dir());
    }
    #[test]
    fn host_alias_cannot_replace_other_account_config() {
        let temp = Temporary::new();
        let path = temp.path();
        let scope = AccountScope::synthetic(b"assistance-a");
        let other = AccountScope::synthetic(b"assistance-b");
        assert_ne!(
            connection_config_path_at(&temp.0, &scope),
            connection_config_path_at(&temp.0, &other)
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let target = temp.0.join("other-host.json");
            let bytes = serde_json::to_vec(&host("two")).unwrap();
            fs::write(&target, &bytes).unwrap();
            symlink(&target, &path).unwrap();
            assert_eq!(
                register_assistance_host_at(&path, &host("one")),
                Err("host_config_invalid")
            );
            assert_eq!(fs::read(&target).unwrap(), bytes);
            assert!(fs::symlink_metadata(&path)
                .unwrap()
                .file_type()
                .is_symlink());
        }
    }
    #[test]
    fn two_registrations_serialize_and_only_one_host_wins() {
        let temp = Temporary::new();
        let path = temp.path();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let children: Vec<_> = ["one", "two"]
            .into_iter()
            .map(|label| {
                let path = path.clone();
                let barrier = barrier.clone();
                thread::spawn(move || {
                    barrier.wait();
                    (
                        host(label),
                        register_assistance_host_at(&path, &host(label)),
                    )
                })
            })
            .collect();
        let results: Vec<_> = children
            .into_iter()
            .map(|child| child.join().unwrap())
            .collect();
        assert_eq!(
            results.iter().filter(|(_, result)| result.is_ok()).count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|(_, result)| *result == Err("browser_connection_changed"))
                .count(),
            1
        );
        let persisted: ExecutionHost = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            &persisted,
            &results.iter().find(|(_, result)| result.is_ok()).unwrap().0
        );
    }

use super::*;

    #[test]
    fn vps_host_store_is_a_to_logout_to_b_empty_to_a_restored_without_legacy_fallback() {
        use std::path::Path;

        let root = Path::new("/synthetic/app-data");
        let a =
            crate::account_scope::AccountScope::synthetic(b"00000000-0000-4000-8000-000000000001");
        let b =
            crate::account_scope::AccountScope::synthetic(b"00000000-0000-4000-8000-000000000002");
        let a_path = connection_config_path_at(root, &a);
        let b_path = connection_config_path_at(root, &b);
        assert_ne!(a_path, b_path);
        assert_eq!(
            a_path,
            root.join("accounts")
                .join(a.digest())
                .join("direct-chat-host.json")
        );
        assert_eq!(connection_config_path_at(root, &a), a_path);
        assert_ne!(a_path, root.join("direct-chat-host.json"));
        assert!(!b_path.starts_with(root.join(a.digest())));
    }

    #[test]
    fn migration_host_gate_accepts_only_the_exact_local_record() {
        use std::{fs, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-migration-host-{nonce}"));
        let scope = crate::account_scope::AccountScope::synthetic_local(b"synthetic-local");
        let path = connection_config_path_at(&root, &scope);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, br#"{"kind":"local"}"#).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        }
        assert!(verify_migration_local_host_at(&root, &scope).is_ok());

        fs::write(&path, br#"{"kind":"vps","address":"synthetic.invalid"}"#).unwrap();
        assert_eq!(
            verify_migration_local_host_at(&root, &scope).unwrap_err(),
            "local_migration_host_not_local"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn migration_host_gate_never_follows_a_symlink() {
        use std::{fs, os::unix::fs::symlink, time::SystemTime};

        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("jht-migration-host-link-{nonce}"));
        let scope = crate::account_scope::AccountScope::synthetic_local(b"synthetic-local");
        let path = connection_config_path_at(&root, &scope);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let target = root.join("synthetic-host.json");
        fs::write(&target, br#"{"kind":"local"}"#).unwrap();
        symlink(&target, &path).unwrap();

        assert_eq!(
            verify_migration_local_host_at(&root, &scope).unwrap_err(),
            "local_migration_host_missing"
        );
        fs::remove_dir_all(root).unwrap();
    }

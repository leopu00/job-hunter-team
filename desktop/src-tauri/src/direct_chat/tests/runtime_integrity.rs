use super::*;

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn local_chat_refuses_rehashed_compose_or_host_setup_without_starting_an_engine() {
        use std::os::unix::fs::PermissionsExt;

        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "jht-local-chat-protocol-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let runtime = root.join("host-runtime");
        fs::create_dir_all(runtime.join("bin")).unwrap();
        fs::write(runtime.join("container-runtime"), "podman\n").unwrap();
        fs::write(
            runtime.join("docker-compose.yml"),
            "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n",
        )
        .unwrap();
        fs::write(runtime.join("bin/docker"), "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\nexit 91\n").unwrap();
        fs::set_permissions(runtime.join("bin/docker"), fs::Permissions::from_mode(0o700)).unwrap();
        let wrapper = root.join("jht-wrapper.sh");
        fs::write(&wrapper, "#!/bin/sh\nJHT_HOST_RUNTIME_PROTOCOL=1\n").unwrap();
        fs::set_permissions(&wrapper, fs::Permissions::from_mode(0o700)).unwrap();
        write_valid_local_podman_manifest(&runtime, &wrapper);
        assert!(local_chat_runtime_valid(&wrapper, &runtime));

        fs::write(runtime.join("docker-compose.yml"), "services: {}\n").unwrap();
        write_local_podman_manifest(&runtime, &wrapper);
        assert!(!local_chat_runtime_valid(&wrapper, &runtime));

        fs::write(
            runtime.join("docker-compose.yml"),
            "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n",
        )
        .unwrap();
        fs::write(runtime.join("host-setup.sh"), "#!/bin/sh\nexit 0\n").unwrap();
        write_local_podman_manifest(&runtime, &wrapper);
        assert!(!local_chat_runtime_valid(&wrapper, &runtime));

        fs::remove_dir_all(root).unwrap();
    }

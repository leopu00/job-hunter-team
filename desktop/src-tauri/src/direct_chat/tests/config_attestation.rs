use super::*;

    #[cfg(unix)]
    #[test]
    fn the_expected_hash_follows_the_image_pin_of_the_runtime_and_a_runtime_without_a_pin_has_none_in_it() {
        // the provider's hash depends on the JHT_IMAGE it is given, as the real one does through the compose file
        let hash = "printf '%s' \"${JHT_IMAGE:-the default of the compose file}\" | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1";
        let none = |_: &str| -> Option<String> { None };
        let (root, runtime) = hash_runtime(PODMAN_6_1_3, &compose_plan(hash));
        // a test channel: runtime-image holds the pin, the container was made with it
        fs::write(runtime.join("runtime-image"), format!("{PIN}\n")).unwrap();
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Ok(digest_of(PIN)));
        // a production runtime: no pin file, the compose file's own default, and the hash is another one
        fs::remove_file(runtime.join("runtime-image")).unwrap();
        assert_eq!(
            mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none),
            Ok(digest_of("the default of the compose file"))
        );
        // a pin that is not a digest of the product's image stops the check instead of being passed on
        for bad in [&PIN[..PIN.len() - 1], "ghcr.io/leopu00/jht:latest", ""] {
            fs::write(runtime.join("runtime-image"), format!("{bad}\n")).unwrap();
            assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Err("hash_image_pin"), "{bad:?}");
        }
        fs::write(runtime.join("runtime-image"), PIN).unwrap();
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Err("hash_image_pin"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_provider_is_given_the_directory_of_the_podman_it_trusts_in_its_path_as_an_app_opened_from_finder_has_none() {
        let none = |_: &str| -> Option<String> { None };
        let (root, runtime) = hash_runtime(PODMAN_6_1_3, "");
        // podman-compose looks `podman` up by name: it says so and stops when the name does not lead to this runtime's one
        let find = format!(
            "[ \"$(command -v podman)\" = \"{}\" ] || {{ echo 'failed to check if podman is installed: No such file or directory: podman' >&2; exit 1; }}\n",
            runtime.join("bin").join("podman").display()
        );
        let script = compose_plan("printf '%s' fixed | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1");
        let script = script.replacen("[ \"${1:-}\" = --version ]", &format!("{find}[ \"${{1:-}}\" = --version ]"), 1);
        fs::write(runtime.join("bin").join("podman-compose"), script).unwrap();
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Ok(digest_of("fixed")));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_check_that_could_not_be_made_is_told_apart_from_a_container_that_is_another() {
        let none = |_: &str| -> Option<String> { None };
        let hash = "printf x | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1";
        let ask = |podman: &str, compose: &str, machine: Option<&str>| {
            let (root, runtime) = hash_runtime(podman, compose);
            match machine {
                Some(machine) => fs::write(runtime.join("podman-machine"), machine).unwrap(),
                None => fs::remove_file(runtime.join("podman-machine")).unwrap(),
            }
            let said = mac_config_hash_in(&runtime, Duration::from_secs(20), None, &none);
            fs::remove_dir_all(root).unwrap();
            said
        };
        let good = compose_plan(hash);
        let machine = Some("jht-podman\n");
        // the versions: read and other, or not readable
        assert_eq!(ask("#!/bin/sh\necho 'podman version 6.0.0'\n", &good, machine), Err("hash_podman_version_differs"));
        assert_eq!(ask("#!/bin/sh\nexit 3\n", &good, machine), Err("hash_podman_version_unreadable"));
        assert_eq!(ask(PODMAN_6_1_3, &good.replace("1.6.0", "1.5.0"), machine), Err("hash_compose_version_differs"));
        assert_eq!(ask(PODMAN_6_1_3, "#!/bin/sh\nexit 1\n", machine), Err("hash_compose_version_unreadable"));
        // the machine file
        assert_eq!(ask(PODMAN_6_1_3, &good, None), Err("hash_machine_file"));
        assert_eq!(ask(PODMAN_6_1_3, &good, Some("jht-podman")), Err("hash_machine_file"));
        assert_eq!(ask(PODMAN_6_1_3, &good, Some("a b\n")), Err("hash_machine_file"));
        // the plan: does not run, runs and says nothing of jht, says two things
        let plan = |body: &str| format!("#!/bin/sh\n[ \"${{1:-}}\" = --version ] && {{ echo 'podman-compose version 1.6.0'; exit 0; }}\n{body}\n");
        assert_eq!(ask(PODMAN_6_1_3, &plan("exit 7"), machine), Err("hash_dry_run_exit"));
        assert_eq!(ask(PODMAN_6_1_3, &plan("exit 0"), machine), Err("hash_plan_without_create"));
        assert_eq!(ask(PODMAN_6_1_3, &plan("echo 'podman create --name=jht --label io.podman.compose.config-hash=short x'"), machine), Err("hash_plan_ambiguous"));
        let two = format!(
            "echo 'podman create --name=jht --label io.podman.compose.config-hash={} x'; echo 'podman create --name=jht --label io.podman.compose.config-hash={} x'",
            "a".repeat(64),
            "c".repeat(64)
        );
        assert_eq!(ask(PODMAN_6_1_3, &plan(&two), machine), Err("hash_plan_ambiguous"));
        // the plan that takes longer than the time it is given
        let (root, runtime) = hash_runtime(PODMAN_6_1_3, &plan("sleep 5"));
        assert_eq!(mac_config_hash_in(&runtime, Duration::from_millis(500), None, &none), Err("hash_dry_run_timeout"));
        fs::remove_dir_all(root).unwrap();
        // which of these waiting may cure, and the words the log can say
        for reason in ["hash_podman_version_unreadable", "hash_compose_version_unreadable", "hash_dry_run_exit", "hash_dry_run_timeout", "hash_dry_run_not_started", "hash_plan_without_create"] {
            assert!(attest_reason_may_pass(listed(reason)), "{reason}");
        }
        for reason in ["hash_tool_missing", "hash_podman_version_differs", "hash_compose_version_differs", "hash_machine_file", "hash_image_pin", "hash_plan_ambiguous", "label_config_hash_differs", "label_project", "label_image"] {
            assert!(!attest_reason_may_pass(listed(reason)), "{reason}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_hash_that_could_not_be_worked_out_is_not_said_to_be_another_container_and_a_label_that_differs_is() {
        let runtime = PathBuf::from("/runtime");
        let labels = serde_json::json!({});
        let wrong = Ok("0".repeat(64));
        // the hash could not be worked out: a container whose labels are visibly another's is said to be, and only
        // one that looks like the installed one is left to the hash's reason
        assert_eq!(attestation_refusal(Some(&Err("hash_dry_run_timeout")), &labels, &runtime, true), Some("label_project"));
        let mut good = serde_json::json!({
            "com.docker.compose.project": "jht", "io.podman.compose.project": "jht",
            "com.docker.compose.service": "jht", "io.podman.compose.service": "jht",
            "com.docker.compose.container-number": "1",
            "com.docker.compose.project.working_dir": "/runtime", "io.podman.compose.config-hash": "a".repeat(64),
            "io.podman.compose.version": "1.6.0", "PODMAN_SYSTEMD_UNIT": podman_systemd_unit(),
        });
        good["com.docker.compose.project.config_files"] = if cfg!(target_os = "macos") {
            "/runtime/docker-compose.yml".into()
        } else {
            "/runtime/docker-compose.yml,/runtime/docker-compose.podman-linux.yml".into()
        };
        assert_eq!(attestation_refusal(Some(&Err("hash_dry_run_timeout")), &good, &runtime, true), Some("hash_dry_run_timeout"));
        assert_eq!(attestation_refusal(Some(&Err("hash_tool_missing")), &good, &runtime, true), Some("hash_tool_missing"));
        let other_unit = podman_systemd_unit().replace("jht", "other");
        for (name, wrong) in [
            ("com.docker.compose.service", "other"),
            ("com.docker.compose.project.working_dir", "/elsewhere"),
            ("com.docker.compose.project.config_files", "/elsewhere/docker-compose.yml"),
            ("io.podman.compose.version", "0.9.0"),
            ("PODMAN_SYSTEMD_UNIT", other_unit.as_str()),
        ] {
            let mut other = good.clone();
            other[name] = wrong.into();
            let refusal = attestation_refusal(Some(&Err("hash_dry_run_timeout")), &other, &runtime, true);
            assert!(refusal.is_some_and(|reason| reason.starts_with("label_")), "{name}: {refusal:?}");
        }
        // with the hash known and the labels good, the container is taken on the platforms that compare no hash; on macOS
        // the hash is compared (a hash that differs is another container)
        #[cfg(target_os = "macos")]
        {
            assert_eq!(attestation_refusal(Some(&Ok("b".repeat(64))), &good, &runtime, true), Some("label_config_hash_differs"));
            assert_eq!(attestation_refusal(Some(&Ok("a".repeat(64))), &good, &runtime, true), None);
        }
        // the hash is there: the labels are looked at, rule by rule
        let mut labels = serde_json::json!({
            "com.docker.compose.project": "other", "io.podman.compose.project": "jht",
            "com.docker.compose.service": "jht", "io.podman.compose.service": "jht",
            "com.docker.compose.container-number": "1",
            "com.docker.compose.project.working_dir": "/runtime", "io.podman.compose.config-hash": "a".repeat(64),
        });
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_project"));
        labels["com.docker.compose.project"] = "jht".into();
        labels["io.podman.compose.service"] = "x".into();
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_service"));
        labels["io.podman.compose.service"] = "jht".into();
        labels["com.docker.compose.container-number"] = "2".into();
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_container_number"));
        labels["com.docker.compose.container-number"] = "1".into();
        labels["com.docker.compose.project.working_dir"] = "/elsewhere".into();
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_working_dir"));
        labels["com.docker.compose.project.working_dir"] = "/runtime".into();
        labels["io.podman.compose.config-hash"] = "not a hash".into();
        assert_eq!(attestation_refusal(Some(&wrong), &labels, &runtime, true), Some("label_hash_form"));
        // what to say when none is taken: the other one wins over the one that could not be checked
        assert_eq!(container_not_found_code(Some("label_project"), Some("hash_dry_run_exit")), "local_container_not_attested");
        assert_eq!(container_not_found_code(None, Some("hash_dry_run_exit")), "container_unavailable");
        assert_eq!(container_not_found_code(None, None), "local_team_not_running");
        for reason in ["label_project", "label_service", "label_container_number", "label_working_dir", "label_hash_form", "label_image", "label_config_files", "label_compose_version", "label_systemd_unit", "label_windows"] {
            listed(reason);
        }
    }

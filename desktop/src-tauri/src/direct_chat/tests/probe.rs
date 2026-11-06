use super::*;

    #[cfg(unix)]
    #[test]
    fn local_probe_finds_the_container_natively_and_never_runs_the_wrapper() {
        // the fixture's wrapper leaves a flag next to itself if it is ever run
        let (root, runtime, wrapper, _id) = attested_local_fixture();
        let flag = root.join("wrapper-was-run");
        let scope = crate::account_scope::AccountScope::synthetic(b"synthetic-account-a");
        let owner = root.join(".desktop-account-scope");
        fs::write(&owner, format!("{}\n", scope.digest())).unwrap();
        let connection = Connection {
            app: None,
            scope,
            host: ExecutionHost::Local,
            validated: ValidatedHost::Local,
            runtime: None,
            local_wrapper: Some(wrapper.clone()),
            local_runtime: Some(runtime.clone()),
            local_owner_marker: Some(owner),
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        };
        assert_eq!(probe(&connection).state, "ready");
        // a local chat never pays an ssh connection per read, even where ssh has no master
        assert_eq!(serde_json::to_value(probe(&connection)).unwrap(), serde_json::json!({"state": "ready"}));
        // the engine was only listed, never inspected or run in: the first probe asked once, the second used the kept container
        // (the kept slot is one for the whole process, so a test running at the same time may have taken it: at most one more)
        let calls = fs::read_to_string(root.join("engine-calls.log")).unwrap();
        assert!((1..=2).contains(&calls.lines().count()) && calls.lines().all(|call| call == "ps"), "{calls}");
        assert!(!flag.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn local_probe_says_why_there_is_no_container() {
        // no container listed: this computer's team is not running, the code the Messages page answers with «Start the team»
        let (root, runtime, wrapper, _id) = attested_local_fixture_with(Some(&|_| "printf '[]\\n'".to_owned()));
        let scope = crate::account_scope::AccountScope::synthetic(b"synthetic-account-a");
        let owner = root.join(".desktop-account-scope");
        fs::write(&owner, format!("{}\n", scope.digest())).unwrap();
        let connection = Connection {
            app: None,
            scope,
            host: ExecutionHost::Local,
            validated: ValidatedHost::Local,
            runtime: None,
            local_wrapper: Some(wrapper),
            local_runtime: Some(runtime),
            local_owner_marker: Some(owner),
            control_path: None,
            tunnel: None,
            link: VpsLink::PerCommand,
        };
        let failed = probe(&connection);
        assert_eq!(failed.state, "error");
        assert_eq!(failed.code, Some("local_team_not_running"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_probe_that_finds_no_container_says_not_running_on_this_computer_and_unavailable_on_a_vps() {
        assert_eq!(crate::direct_chat::probe_no_container_code(&ValidatedHost::Local), "local_team_not_running");
        let vps = ValidatedHost::Vps {
            address: "203.0.113.7".into(),
            user: "jht".into(),
            port: 22,
            key_path: PathBuf::from("/nonexistent/key"),
            known_hosts: PathBuf::from("/nonexistent/known_hosts"),
        };
        assert_eq!(crate::direct_chat::probe_no_container_code(&vps), "container_unavailable");
        // a host that could not be asked at all stays «unavailable», whichever it is
        let source = DIRECT_CHAT_SOURCE;
        let body = source.split("fn probe_unlogged(connection: &Connection)").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(body.contains("Err(_) => status(\"error\", Some(\"container_unavailable\"))"));
        assert!(body.contains("tunnel_unavailable"));
    }

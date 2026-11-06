use super::*;

    #[test]
    fn the_podman_listing_is_read_as_podman_prints_it() {
        // the shape of `podman ps -a --format json`, with made-up values: an array, `Id`, `State`, `Labels` (an object), `Image`
        let one = r#"[{"AutoRemove":false,"Id":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","Image":"example.invalid/jht:test","ImageID":"0000","Labels":{"com.docker.compose.project":"jht","com.docker.compose.service":"jht"},"Names":["jht"],"State":"running","Status":"Up"}]"#;
        let candidates = listing_of(one).unwrap();
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].id, "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
        assert!(candidates[0].running && candidates[0].service_is_jht());
        assert_eq!(candidates[0].image.as_deref(), Some("example.invalid/jht:test"));
        // a stopped one is listed, and is not running
        let stopped = listing_of(&one.replace("\"running\"", "\"exited\"")).unwrap();
        assert!(!stopped[0].running);
        // none listed, in the ways an engine says it
        assert!(listing_of("[]").unwrap().is_empty());
        assert!(listing_of("  \n").unwrap().is_empty());
        // labels that are not an object are no labels; no image is no image
        let bare = listing_of(r#"[{"Id":"aaaaaaaaaaaa","State":"running","Labels":null}]"#).unwrap();
        assert!(!bare[0].service_is_jht() && bare[0].image.is_none());
    }

    #[test]
    fn a_listing_that_is_not_podmans_takes_no_container() {
        for broken in ["{}", "null", "true", "[1]", "not json", r#"[{"State":"running"}]"#, r#"[{"Id":"zz","State":"running"}]"#, r#"[{"Id":"abc","State":"running"}]"#] {
            assert_eq!(listing_of(broken).err(), Some("container_unavailable"), "{broken}");
        }
        let many = format!("[{}]", vec![r#"{"Id":"aaaaaaaaaaaa","State":"running"}"#; 17].join(","));
        assert_eq!(listing_of(&many).err(), Some("container_unavailable"));
        assert_eq!(super::parse_listing(&[0xff, 0xfe]).err(), Some("container_unavailable"));
    }

    #[test]
    fn only_windows_asks_for_the_image_and_settles_a_disagreeing_listing_with_one_inspect() {
        let runtime = Path::new("/nonexistent-runtime");
        let candidate = |running: bool, service: &str, image: Option<&str>| super::Candidate {
            id: "a".repeat(64),
            running,
            labels: serde_json::json!({"com.docker.compose.service": service}),
            image: image.map(str::to_owned),
        };
        let pinned = format!("ghcr.io/leopu00/jht@sha256:{}", "b".repeat(64));
        // elsewhere the image is not asked, whatever the listing says
        assert!(super::image_is_accepted(false, None, runtime));
        assert!(!super::needs_image_inspect(false, true, &candidate(true, "jht", None), runtime));
        // on Windows: no image, or one that is not the runtime's, for a running jht of Podman -> one inspect
        assert!(!super::image_is_accepted(true, None, runtime));
        assert!(super::needs_image_inspect(true, true, &candidate(true, "jht", None), runtime));
        assert!(super::needs_image_inspect(true, true, &candidate(true, "jht", Some("example.invalid/other:latest")), runtime));
        // ...but not for what is not a candidate (stopped, another service) and not for Docker
        assert!(!super::needs_image_inspect(true, true, &candidate(false, "jht", None), runtime));
        assert!(!super::needs_image_inspect(true, true, &candidate(true, "jht-broker", None), runtime));
        assert!(!super::needs_image_inspect(true, false, &candidate(true, "jht", None), runtime));
        // the runtime's own pinned image is accepted from the listing, with no inspect
        let dir = std::env::temp_dir().join(format!("jht-image-pin-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("runtime-image"), format!("{pinned}\n")).unwrap();
        assert!(super::image_is_accepted(true, Some(&pinned), &dir));
        assert!(!super::needs_image_inspect(true, true, &candidate(true, "jht", Some(&pinned)), &dir));
        assert!(!super::image_is_accepted(true, Some("example.invalid/other:latest"), &dir));
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_container_is_found_with_one_engine_call() {
        let (root, runtime, wrapper, id) = attested_local_fixture();
        let team = AttestedLocalTeam::resolve(&wrapper, &runtime, LOCAL_TEST_TIMEOUT).unwrap();
        assert_eq!(team.container_id(), id);
        // before: a listing of ids and an inspect for each of the project's containers; now the listing is all
        let calls = fs::read_to_string(root.join("engine-calls.log")).unwrap();
        assert_eq!(calls.lines().collect::<Vec<_>>(), ["ps"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn the_container_rules_hold_on_the_listing() {
        fn listing(rows: Vec<serde_json::Value>) -> String {
            format!("printf '%s\\n' '{}'", serde_json::Value::Array(rows))
        }
        fn with(row: &serde_json::Value, state: &str, service: &str, id: &str) -> serde_json::Value {
            let mut changed = row.clone();
            changed["State"] = state.into();
            changed["Labels"]["com.docker.compose.service"] = service.into();
            changed["Id"] = id.into();
            changed
        }
        let aaa = "a".repeat(64);
        let bbb = "b".repeat(64);
        // each case: what the engine lists (made from the one container of the installed runtime) -> what the chat finds
        type Said = Box<dyn Fn(&serde_json::Value) -> String>;
        let cases: Vec<(&str, Said, Option<&'static str>)> = vec![
            ("the installed jht", Box::new(|row| listing(vec![row.clone()])), None),
            ("the installed jht and another service", Box::new({ let (a, b) = (aaa.clone(), bbb.clone()); move |row| listing(vec![with(row, "running", "jht", &a), with(row, "running", "jht-broker", &b)]) }), None),
            ("nothing listed", Box::new(|_| "printf '[]\\n'".to_owned()), Some("local_team_not_running")),
            ("a stopped jht", Box::new({ let a = aaa.clone(); move |row| listing(vec![with(row, "exited", "jht", &a)]) }), Some("local_team_not_running")),
            ("only the broker", Box::new({ let a = aaa.clone(); move |row| listing(vec![with(row, "running", "jht-broker", &a)]) }), Some("local_team_not_running")),
            ("a jht the runtime did not start", Box::new(|row| { let mut other = row.clone(); other["Labels"] = serde_json::json!({"com.docker.compose.service": "jht"}); listing(vec![other]) }), Some("local_container_not_attested")),
            ("the engine cannot be asked (machine off)", Box::new(|_| "echo 'cannot connect' >&2; exit 125".to_owned()), Some("local_team_not_running")),
            ("not Podman's listing", Box::new(|_| "printf 'not json\\n'".to_owned()), Some("container_unavailable")),
            ("two running jht", Box::new({ let (a, b) = (aaa.clone(), bbb.clone()); move |row| listing(vec![with(row, "running", "jht", &a), with(row, "running", "jht", &b)]) }), Some("container_unavailable")),
        ];
        for (name, said, expected) in cases {
            let (root, runtime, wrapper, id) = attested_local_fixture_with(Some(&*said));
            let found = AttestedLocalTeam::resolve(&wrapper, &runtime, LOCAL_TEST_TIMEOUT).map(|team| team.container_id().to_owned());
            match expected {
                None => assert_eq!(found, Ok(id), "{name}"),
                Some(code) => assert_eq!(found.clone().err(), Some(code), "{name}: {found:?}"),
            }
            let calls = fs::read_to_string(root.join("engine-calls.log")).unwrap();
            assert_eq!(calls.lines().collect::<Vec<_>>(), ["ps"], "{name}: one call, never an inspect or an exec");
            fs::remove_dir_all(root).unwrap();
        }
    }

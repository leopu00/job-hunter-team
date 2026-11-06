use super::*;
    /// The team-language script as the container runs it, with a folder standing in for `/jht_home`.
    /// Returns the exit code and what the script printed.
    #[cfg(unix)]
    fn run_team_language(home: &Path, bootstrap: Option<&str>, request: serde_json::Value) -> (i32, serde_json::Value) {
        use std::io::Write;
        assert_eq!(super::TEAM_LANGUAGE_PY.matches("home='/jht_home'").count(), 1, "the script's home changed: update this test");
        let script = super::TEAM_LANGUAGE_PY.replace("home='/jht_home'", &format!("home='{}'", home.display()));
        let input = super::python_input(&script, &request).unwrap();
        let mut command = Command::new("python3");
        command
            .args(["-c", "import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())"])
            .env_remove("JHT_LANG")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped());
        if let Some(lang) = bootstrap {
            command.env("JHT_LANG", lang);
        }
        let mut child = command.spawn().unwrap();
        child.stdin.take().unwrap().write_all(&input).unwrap();
        let output = child.wait_with_output().unwrap();
        let reply = serde_json::from_slice(&output.stdout).unwrap_or(serde_json::Value::Null);
        (output.status.code().unwrap_or(-1), reply)
    }

    #[cfg(unix)]
    fn team_language_home(label: &str) -> PathBuf {
        let home = std::env::temp_dir().join(format!("jht-team-language-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&home);
        fs::create_dir_all(&home).unwrap();
        home
    }

    #[cfg(unix)]
    #[test]
    fn a_team_with_no_language_chosen_speaks_english_and_takes_the_one_set_once() {
        let home = team_language_home("fresh");
        let (code, read) = run_team_language(&home, None, json!({"op": "read"}));
        assert_eq!((code, &read), (0, &json!({"locale": "en", "stored": null})));
        let (code, set) = run_team_language(&home, None, json!({"op": "set", "locale": "it"}));
        assert_eq!((code, &set), (0, &json!({"locale": "it", "stored": "it", "changed": true})));
        // the same artefact the game's language setting writes, replaced whole
        let file: serde_json::Value = serde_json::from_slice(&fs::read(home.join("i18n-prefs.json")).unwrap()).unwrap();
        assert_eq!(file, json!({"locale": "it"}));
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(home.join("i18n-prefs.json")).unwrap().permissions().mode() & 0o777, 0o644);
        assert_eq!(fs::read_dir(&home).unwrap().count(), 1, "no temporary file left behind");
        let (_, read) = run_team_language(&home, None, json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "it", "stored": "it"}));
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn the_default_english_written_by_the_installer_is_replaced_but_a_chosen_language_never_is() {
        let home = team_language_home("chosen");
        // what the host setup leaves: English, in the file and in host.env
        fs::write(home.join("i18n-prefs.json"), "{\n  \"locale\": \"en\"\n}\n").unwrap();
        fs::write(home.join("host.env"), "JHT_LANG=en\n").unwrap();
        let (_, set) = run_team_language(&home, None, json!({"op": "set", "locale": "it"}));
        assert_eq!(set, json!({"locale": "it", "stored": "it", "changed": true}));
        // now it is chosen: another set changes nothing, whatever it asks
        for locale in ["de", "en"] {
            let (code, set) = run_team_language(&home, None, json!({"op": "set", "locale": locale}));
            assert_eq!((code, &set), (0, &json!({"locale": "it", "stored": "it", "changed": false})));
        }
        assert_eq!(fs::read_to_string(home.join("i18n-prefs.json")).unwrap().trim(), "{\n  \"locale\": \"it\"\n}");
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn a_language_given_by_the_environment_or_host_env_counts_as_chosen_and_is_not_overwritten() {
        let home = team_language_home("bootstrap");
        let (_, read) = run_team_language(&home, Some("hu"), json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "hu", "stored": null}));
        let (_, set) = run_team_language(&home, Some("hu"), json!({"op": "set", "locale": "it"}));
        assert_eq!(set, json!({"locale": "hu", "stored": null, "changed": false}));
        assert!(!home.join("i18n-prefs.json").exists(), "nothing was written");
        fs::write(home.join("host.env"), "FOO=1\nJHT_LANG=\"fr\"\n").unwrap();
        let (_, read) = run_team_language(&home, None, json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "fr", "stored": null}));
        // an unknown value anywhere is skipped, as every reader of the language skips it
        fs::write(home.join("host.env"), "JHT_LANG=xx\n").unwrap();
        fs::write(home.join("i18n-prefs.json"), "{\"locale\": \"klingon\"}").unwrap();
        let (_, read) = run_team_language(&home, Some("zz"), json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "en", "stored": null}));
        let _ = fs::remove_dir_all(&home);
    }

    #[cfg(unix)]
    #[test]
    fn the_person_s_own_choice_replaces_the_team_s_language_and_the_same_one_writes_nothing() {
        let home = team_language_home("choose");
        // a team the app aligned to the first screen's language, then a person who picks another one
        let (_, set) = run_team_language(&home, None, json!({"op": "set", "locale": "fr"}));
        assert_eq!(set, json!({"locale": "fr", "stored": "fr", "changed": true}));
        let (code, chose) = run_team_language(&home, None, json!({"op": "choose", "locale": "de"}));
        assert_eq!((code, &chose), (0, &json!({"locale": "de", "stored": "de", "changed": true})));
        // back to English is a choice too: the file says it, the environment no longer decides
        let (_, chose) = run_team_language(&home, Some("pt"), json!({"op": "choose", "locale": "en"}));
        assert_eq!(chose, json!({"locale": "en", "stored": "en", "changed": true}));
        let (_, read) = run_team_language(&home, Some("pt"), json!({"op": "read"}));
        assert_eq!(read, json!({"locale": "en", "stored": "en"}));
        // the language the file already says: nothing written
        let before = fs::metadata(home.join("i18n-prefs.json")).unwrap().modified().unwrap();
        let (_, same) = run_team_language(&home, None, json!({"op": "choose", "locale": "en"}));
        assert_eq!(same, json!({"locale": "en", "stored": "en", "changed": false}));
        assert_eq!(fs::metadata(home.join("i18n-prefs.json")).unwrap().modified().unwrap(), before);
        // a language given only by host.env is replaced by a choice, which the file then keeps
        let other = team_language_home("choose-host-env");
        fs::write(other.join("host.env"), "JHT_LANG=en\n").unwrap();
        let (_, chose) = run_team_language(&other, None, json!({"op": "choose", "locale": "es"}));
        assert_eq!(chose, json!({"locale": "es", "stored": "es", "changed": true}));
        assert_eq!(fs::read_to_string(other.join("host.env")).unwrap(), "JHT_LANG=en\n", "host.env is the install's, not touched");
        let (code, _) = run_team_language(&other, None, json!({"op": "choose", "locale": "xx"}));
        assert_eq!(code, 2);
        let _ = fs::remove_dir_all(&home);
        let _ = fs::remove_dir_all(&other);
    }

    #[cfg(unix)]
    #[test]
    fn the_team_language_script_refuses_a_language_it_does_not_have_and_writes_nothing() {
        let home = team_language_home("refused");
        for request in [json!({"op": "set", "locale": "xx"}), json!({"op": "set"}), json!({"op": "wipe"})] {
            let (code, _) = run_team_language(&home, None, request);
            assert_eq!(code, 2);
        }
        assert_eq!(fs::read_dir(&home).unwrap().count(), 0);
        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn a_team_language_reply_outside_the_seven_languages_is_not_believed() {
        let reply = |locale: &str, stored: Option<&str>| super::TeamLanguage {
            locale: locale.to_owned(),
            stored: stored.map(str::to_owned),
            changed: None,
        };
        assert!(super::checked_team_language(reply("it", None)).is_some());
        assert!(super::checked_team_language(reply("pt", Some("en"))).is_some());
        assert!(super::checked_team_language(reply("xx", None)).is_none());
        assert!(super::checked_team_language(reply("it", Some("xx"))).is_none());
    }

    #[test]
    fn the_team_language_commands_are_the_app_windows_and_the_write_goes_through_the_one_gate() {
        let source = crate::direct_chat::tests::DIRECT_CHAT_SOURCE;
        let set = source.split("pub(crate) async fn direct_chat_team_language_set(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(set.contains("!window_may_write(window.label())"), "only the app's own window may write the language");
        // the two ways of writing (over the English only, or the person's own choice), and nothing else
        assert!(set.contains("let op = if choose == Some(true) { \"choose\" } else { \"set\" };"));
        assert!(set.contains("team_language_impl(inner, json!({\"op\": op, \"locale\": locale}), true, \"persist_failed\")"), "both write as a write");
        let implementation = source.split("fn team_language_impl(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(implementation.contains("if write {\n        refuse_writing(connection)?;"), "a write goes through the gate of every write to the team");
        let read = source.split("pub(crate) async fn direct_chat_team_language(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(read.contains("\"op\": \"read\"") && read.contains(", false, "), "the read never asks to write");
    }

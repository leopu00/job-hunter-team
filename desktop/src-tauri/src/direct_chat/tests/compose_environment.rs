use super::*;

    #[test]
    fn the_compose_environment_is_host_env_then_the_inherited_one_then_the_defaults() {
        let defaults = pairs(&[("JHT_HOST_TYPE", "unknown"), ("JHT_LANG", "en"), ("JHT_USER_TZ", "UTC")]);
        assert_eq!(host_environment(None, &[]), defaults);
        assert_eq!(host_environment(Some(""), &[]), defaults);
        // what the host setup writes on a Mac
        let file = "JHT_LANG=en\nJHT_HOST_TYPE=local\nJHT_USER_TZ=Europe/Rome\n";
        assert_eq!(host_environment(Some(file), &[]), pairs(&[("JHT_HOST_TYPE", "local"), ("JHT_LANG", "en"), ("JHT_USER_TZ", "Europe/Rome")]));
        // the file wins over the inherited environment; a key the file lacks (or has invalid) takes the inherited one
        let partial = "JHT_HOST_TYPE=vps\nJHT_LANG=xx\n";
        assert_eq!(
            host_environment(Some(partial), &[("JHT_HOST_TYPE", "local"), ("JHT_LANG", "it"), ("JHT_USER_TZ", "Asia/Tokyo")]),
            pairs(&[("JHT_HOST_TYPE", "vps"), ("JHT_LANG", "it"), ("JHT_USER_TZ", "Asia/Tokyo")]),
        );
        // an empty inherited value is the default, as `${X:-default}` has it
        assert_eq!(host_environment(None, &[("JHT_LANG", "")]), defaults);
    }

    #[test]
    fn a_mac_that_says_vps_is_recorded_as_local_like_the_wrapper_does() {
        use super::host_env_as_the_wrapper_records_it;
        let none = |_: &str| None;
        // from host.env, with the last valid line winning, quoted or not
        for text in ["JHT_HOST_TYPE=vps\n", "JHT_HOST_TYPE=local\nJHT_HOST_TYPE=vps\n", "JHT_HOST_TYPE=\"vps\"\n"] {
            let recorded = host_env_as_the_wrapper_records_it(Some(text), &none).expect(text);
            assert_eq!(host_environment(Some(&recorded), &[]).iter().find(|(key, _)| *key == "JHT_HOST_TYPE").unwrap().1, "local", "{text}");
        }
        // from the environment of the process, with no host.env
        let inherited = |key: &str| (key == "JHT_HOST_TYPE").then(|| "vps".to_owned());
        let recorded = host_env_as_the_wrapper_records_it(None, &inherited).unwrap();
        assert_eq!(host_environment(Some(&recorded), &[("JHT_HOST_TYPE", "vps")]).iter().find(|(key, _)| *key == "JHT_HOST_TYPE").unwrap().1, "local");
        // the language and the time zone are not touched
        let recorded = host_env_as_the_wrapper_records_it(Some("JHT_HOST_TYPE=vps\nJHT_LANG=it\nJHT_USER_TZ=Europe/Rome\n"), &none).unwrap();
        let environment = host_environment(Some(&recorded), &[]);
        assert_eq!(environment, vec![("JHT_HOST_TYPE", "local".to_owned()), ("JHT_LANG", "it".to_owned()), ("JHT_USER_TZ", "Europe/Rome".to_owned())]);
        // nothing to change: local, unknown, nothing at all, a value out of its domain
        for text in [Some("JHT_HOST_TYPE=local\n"), Some("JHT_LANG=it\n"), None, Some("JHT_HOST_TYPE=server\n")] {
            assert_eq!(host_env_as_the_wrapper_records_it(text, &none), None, "{text:?}");
        }
    }

    #[test]
    fn the_text_the_hash_comes_from_applies_the_rule_of_the_mac_to_every_host_type_that_is_not_the_files() {
        use super::text_the_wrapper_hashes;
        let none = |_: &str| None;
        let vps_env = |key: &str| (key == "JHT_HOST_TYPE").then(|| "vps".to_owned());
        let host_type = |text: Option<String>, inherited: &dyn Fn(&str) -> Option<String>| -> String {
            wrapper_compose_environment(text.as_deref(), inherited).into_iter().find(|(key, _)| *key == "JHT_HOST_TYPE").unwrap().1
        };
        let agent = || Some("JHT_HOST_TYPE=vps\nJHT_LANG=pt\n".to_owned());
        // no values file (or one that is not trusted: it reads as None): host.env says vps -> local
        assert_eq!(host_type(text_the_wrapper_hashes(None, &agent, &none), &none), "local");
        // a values file that is trusted and says the type: its own word, a vps stays a vps (host-setup chose it)
        assert_eq!(host_type(text_the_wrapper_hashes(Some("JHT_HOST_TYPE=vps\nJHT_LANG=en\n".to_owned()), &agent, &none), &none), "vps");
        // a trusted values file that does not say the type, and the environment says vps -> local
        assert_eq!(host_type(text_the_wrapper_hashes(Some("JHT_LANG=en\n".to_owned()), &agent, &vps_env), &vps_env), "local");
        // nothing to change: the host.env of a computer, nothing at all
        let local = || Some("JHT_HOST_TYPE=local\n".to_owned());
        assert_eq!(text_the_wrapper_hashes(None, &local, &none).as_deref(), Some("JHT_HOST_TYPE=local\n"));
        assert_eq!(text_the_wrapper_hashes(None, &|| None, &none), None);
    }

    #[cfg(unix)]
    #[test]
    fn the_host_values_of_the_runtime_folder_are_read_only_as_the_wrapper_reads_them() {
        use super::read_host_values;
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = std::env::temp_dir().join(format!("jht-host-values-{}-{}", std::process::id(), line!()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("host-values");
        let write = |mode: u32, text: &str| {
            let _ = fs::remove_file(&file);
            fs::write(&file, text).unwrap();
            fs::set_permissions(&file, fs::Permissions::from_mode(mode)).unwrap();
        };
        // a plain file of the user, private: read
        write(0o600, "JHT_HOST_TYPE=local\nJHT_LANG=it\n");
        assert_eq!(read_host_values(&file).as_deref(), Some("JHT_HOST_TYPE=local\nJHT_LANG=it\n"));
        // writable by the group or by others: not read
        for mode in [0o660, 0o606, 0o666, 0o620, 0o602, 0o662, 0o664, 0o622] {
            write(mode, "JHT_HOST_TYPE=vps\n");
            assert_eq!(read_host_values(&file), None, "{mode:o}");
        }
        // too big
        write(0o600, &"JHT_LANG=it\n".repeat(6000));
        assert_eq!(read_host_values(&file), None);
        // a link, to a good file or not
        let target = dir.join("target");
        fs::write(&target, "JHT_HOST_TYPE=vps\n").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o600)).unwrap();
        let _ = fs::remove_file(&file);
        symlink(&target, &file).unwrap();
        assert_eq!(read_host_values(&file), None);
        // nothing there
        let _ = fs::remove_file(&file);
        assert_eq!(read_host_values(&file), None);
        // and the environment of the compose takes the values of this file, not of host.env, when it is there
        let agent = "JHT_HOST_TYPE=vps\nJHT_LANG=pt\nJHT_USER_TZ=UTC\n";
        let mine = "JHT_HOST_TYPE=local\nJHT_LANG=it\nJHT_USER_TZ=Europe/Rome\n";
        let chosen = Some(mine).or(Some(agent));
        assert_eq!(host_environment(chosen, &[]), vec![("JHT_HOST_TYPE", "local".to_owned()), ("JHT_LANG", "it".to_owned()), ("JHT_USER_TZ", "Europe/Rome".to_owned())]);
        // the source in the hash is the wrapper's: the file of the runtime folder first, host.env second
        let source = DIRECT_CHAT_SOURCE;
        let hash = source.split("fn mac_config_hash(").nth(1).unwrap().split("\n}\n").next().unwrap();
        assert!(hash.contains("read_host_values(&runtime.join(\"host-values\"))") && hash.contains("&read_host_env") && hash.contains("text_the_wrapper_hashes("));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_compose_environment_reads_host_env_as_the_wrapper_does() {
        let value = |file: &str, key: &str| host_environment(Some(file), &[]).into_iter().find(|(k, _)| *k == key).unwrap().1;
        // the last valid line wins; an invalid one never replaces a valid one
        assert_eq!(value("JHT_LANG=fr\nJHT_LANG=de\nJHT_LANG=xx\n", "JHT_LANG"), "de");
        // quotes around the whole value, spaces before the key, a carriage return at the end
        assert_eq!(value("  JHT_LANG=\"it\"\r\n", "JHT_LANG"), "it");
        assert_eq!(value("JHT_LANG='pt'\n", "JHT_LANG"), "pt");
        // a key that only starts like ours, a comment and another variable change nothing
        assert_eq!(value("JHT_LANGUAGE=it\n# JHT_LANG=it\nFOO=JHT_LANG=it\n", "JHT_LANG"), "en");
        // host type: only local or vps; time zone: only portable characters
        assert_eq!(value("JHT_HOST_TYPE=cloud\n", "JHT_HOST_TYPE"), "unknown");
        assert_eq!(value("JHT_USER_TZ=Europe/Rome; rm -rf\n", "JHT_USER_TZ"), "UTC");
        assert_eq!(value("JHT_USER_TZ=\n", "JHT_USER_TZ"), "UTC");
        assert_eq!(value("JHT_USER_TZ=Etc/GMT+1\n", "JHT_USER_TZ"), "Etc/GMT+1");
    }

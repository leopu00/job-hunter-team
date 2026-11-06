use super::*;

    #[cfg(unix)]
    #[test]
    fn a_homebrew_style_install_is_trusted_and_nothing_outside_its_roots_or_that_anyone_can_rewrite_is() {
        use super::tool_is_trusted;
        use std::os::unix::fs::symlink;
        let (root, prefix, elsewhere) = tool_layout("trust");
        let roots = [prefix.as_path()];
        // `bin/podman` -> `../Cellar/podman/6.1.3/bin/podman-remote`, as Homebrew lays it out
        tool_program(&prefix.join("Cellar/podman/6.1.3/bin/podman-remote"), 0o755);
        symlink("../Cellar/podman/6.1.3/bin/podman-remote", prefix.join("bin/podman")).unwrap();
        assert!(tool_is_trusted(&prefix.join("bin/podman"), &roots), "the link Homebrew makes");
        // a regular file in the install's own `bin` (the Podman installer's layout)
        tool_program(&prefix.join("bin/podman-compose"), 0o755);
        assert!(tool_is_trusted(&prefix.join("bin/podman-compose"), &roots));
        // a regular file, or a link to one, outside the roots is not: it is no more trusted for being a file
        tool_program(&elsewhere.join("podman"), 0o755);
        assert!(!tool_is_trusted(&elsewhere.join("podman"), &roots), "a regular file outside the roots");
        symlink(elsewhere.join("podman"), prefix.join("bin/planted")).unwrap();
        assert!(!tool_is_trusted(&prefix.join("bin/planted"), &roots), "a link out of the roots");
        // inside the roots, but a program anyone in the group or on the machine can rewrite, as a file or as a link
        tool_program(&prefix.join("bin/open-to-all"), 0o757);
        tool_program(&prefix.join("bin/open-to-group"), 0o775);
        tool_program(&prefix.join("Cellar/podman/6.1.3/bin/open-to-all"), 0o757);
        symlink("../Cellar/podman/6.1.3/bin/open-to-all", prefix.join("bin/open")).unwrap();
        for name in ["open-to-all", "open-to-group", "open"] {
            assert!(!tool_is_trusted(&prefix.join("bin").join(name), &roots), "{name}");
        }
        // a link to nothing, to a directory, a missing name, a relative name
        symlink("../Cellar/gone", prefix.join("bin/dangling")).unwrap();
        symlink("../Cellar", prefix.join("bin/directory")).unwrap();
        for name in ["dangling", "directory", "missing"] {
            assert!(!tool_is_trusted(&prefix.join("bin").join(name), &roots), "{name}");
        }
        assert!(!tool_is_trusted(Path::new("podman"), &roots));
        // the same link with another root list is no longer trusted
        assert!(!tool_is_trusted(&prefix.join("bin/podman"), &[elsewhere.as_path()]));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_anyone_can_write_in_on_the_way_to_the_tool_takes_the_trust_away() {
        use super::tool_is_trusted;
        use std::os::unix::fs::{symlink, PermissionsExt};
        let (root, prefix, _elsewhere) = tool_layout("folders");
        let roots = [prefix.as_path()];
        tool_program(&prefix.join("Cellar/podman/6.1.3/bin/podman-remote"), 0o755);
        symlink("../Cellar/podman/6.1.3/bin/podman-remote", prefix.join("bin/podman")).unwrap();
        tool_program(&prefix.join("bin/podman-compose"), 0o755);
        let podman = prefix.join("bin/podman");
        let compose = prefix.join("bin/podman-compose");
        assert!(tool_is_trusted(&podman, &roots) && tool_is_trusted(&compose, &roots));
        // each folder between the file and the root, one at a time: written by others, or by the group (outside macOS's admins)
        for (folder, tool) in [
            (prefix.join("Cellar/podman/6.1.3/bin"), &podman),
            (prefix.join("Cellar/podman/6.1.3"), &podman),
            (prefix.join("Cellar/podman"), &podman),
            (prefix.join("Cellar"), &podman),
            (prefix.join("bin"), &podman),
            (prefix.join("bin"), &compose),
            (prefix.clone(), &compose),
        ] {
            for mode in [0o757, 0o777, 0o775] {
                fs::set_permissions(&folder, fs::Permissions::from_mode(mode)).unwrap();
                let group_only = mode == 0o775;
                // a group that is not the administrators' (the test's folders are the user's own group, never gid 80 off macOS)
                let expected = group_only && super::ADMIN_GROUP == Some(std::os::unix::fs::MetadataExt::gid(&fs::metadata(&folder).unwrap()));
                assert_eq!(tool_is_trusted(tool, &roots), expected, "{} {mode:o}", folder.display());
            }
            fs::set_permissions(&folder, fs::Permissions::from_mode(0o755)).unwrap();
            assert!(tool_is_trusted(tool, &roots), "{} restored", folder.display());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_is_safe_to_the_user_and_to_root_and_to_the_administrators_group_only_where_there_is_one() {
        use super::tool_folder_is_safe;
        // (owner, group, mode, user, admin group)
        assert!(tool_folder_is_safe(501, 20, 0o755, 501, Some(80)), "the user's own, 0755");
        assert!(tool_folder_is_safe(0, 0, 0o755, 501, Some(80)), "root's");
        assert!(!tool_folder_is_safe(502, 20, 0o755, 501, Some(80)), "another user's");
        assert!(!tool_folder_is_safe(501, 20, 0o757, 501, Some(80)), "writable by others");
        assert!(!tool_folder_is_safe(501, 20, 0o777, 501, Some(80)));
        assert!(!tool_folder_is_safe(501, 20, 0o775, 501, Some(80)), "writable by a group that is not the administrators'");
        assert!(tool_folder_is_safe(501, 80, 0o775, 501, Some(80)), "Homebrew's Cellar: the administrators' group may write");
        assert!(!tool_folder_is_safe(501, 80, 0o777, 501, Some(80)), "never by others, administrators' group or not");
        assert!(!tool_folder_is_safe(501, 80, 0o775, 501, None), "no administrators' group on this system");
        // the administrators' group never stands for the owner: another account's Homebrew is refused
        assert!(!tool_folder_is_safe(502, 80, 0o775, 501, Some(80)));
        assert!(!tool_folder_is_safe(502, 80, 0o755, 501, Some(80)));
        assert!(tool_folder_is_safe(501, 80, 0o755, 501, Some(80)), "the administrators' group without writing");
    }

    #[cfg(unix)]
    #[test]
    fn the_tool_itself_is_never_writable_by_a_group_not_even_the_administrators() {
        use super::tool_file_is_safe;
        // (owner, mode, user)
        assert!(tool_file_is_safe(501, 0o755, 501) && tool_file_is_safe(501, 0o555, 501) && tool_file_is_safe(0, 0o755, 501));
        assert!(!tool_file_is_safe(501, 0o775, 501), "user:admin 0775");
        assert!(!tool_file_is_safe(501, 0o757, 501));
        assert!(!tool_file_is_safe(501, 0o777, 501));
        assert!(!tool_file_is_safe(502, 0o755, 501), "another account's");
    }

    #[cfg(unix)]
    #[test]
    fn the_tool_is_looked_for_in_the_bin_folder_of_the_roots_and_nowhere_else() {
        use super::find_trusted_tool;
        use std::os::unix::fs::symlink;
        let (root, prefix, elsewhere) = tool_layout("search");
        let second = root.join("second");
        fs::create_dir_all(second.join("bin")).unwrap();
        tool_program(&prefix.join("Cellar/podman/6.1.3/bin/podman-remote"), 0o755);
        symlink("../Cellar/podman/6.1.3/bin/podman-remote", prefix.join("bin/podman")).unwrap();
        let roots = [prefix.as_path(), second.as_path()];
        assert_eq!(find_trusted_tool("podman", &roots), Some(prefix.join("bin/podman")));
        // the same name in a folder that is not a root's `bin`, even a regular and well-kept file, is not found
        tool_program(&elsewhere.join("podman-compose"), 0o755);
        tool_program(&prefix.join("podman-compose"), 0o755);
        assert_eq!(find_trusted_tool("podman-compose", &roots), None);
        // the second root is looked in when the first has none
        tool_program(&second.join("bin/podman-compose"), 0o755);
        assert_eq!(find_trusted_tool("podman-compose", &roots), Some(second.join("bin/podman-compose")));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_expected_config_hash_is_computed_in_the_environment_the_wrapper_starts_the_container_in() {
        use super::mac_config_hash_in;
        use sha2::{Digest, Sha256};
        let (root, runtime, _wrapper, _id) = attested_local_fixture();
        // a provider whose hash depends on what the compose resolves from the environment, as the real one does
        fs::write(
            runtime.join("bin").join("podman-compose"),
            "#!/bin/sh\n[ \"${1:-}\" = --version ] && { echo 'podman-compose version 1.6.0'; exit 0; }\nh=$(printf '%s|%s|%s' \"$JHT_HOST_TYPE\" \"$JHT_LANG\" \"$JHT_USER_TZ\" | shasum -a 256 | cut -d' ' -f1)\nprintf 'podman create --name=jht --label io.podman.compose.config-hash=%s x\\n' \"$h\" >&2\n",
        )
        .unwrap();
        let sha = |text: &str| format!("{:x}", Sha256::digest(text.as_bytes()));
        let none = |_: &str| -> Option<String> { None };
        // the Mac as the host setup leaves it: the container was made with these three
        let host_env = "JHT_LANG=en\nJHT_HOST_TYPE=local\nJHT_USER_TZ=Europe/Rome\n";
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, Some(host_env), &none), Ok(sha("local|en|Europe/Rome")));
        // without host.env: the wrapper's defaults, not empty values
        assert_eq!(mac_config_hash_in(&runtime, LOCAL_TEST_TIMEOUT, None, &none), Ok(sha("unknown|en|UTC")));
        fs::remove_dir_all(root).unwrap();
    }

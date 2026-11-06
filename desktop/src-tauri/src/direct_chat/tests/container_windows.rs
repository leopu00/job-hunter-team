use super::*;

    #[test]
    fn the_windows_container_is_attested_by_the_compose_labels_it_really_has() {
        let dir = r"C:\Users\someone\AppData\Local\Job Hunter Team\host-runtime";
        let runtime = PathBuf::from(dir);
        assert!(windows_container_labels_are_attested(&windows_labels(dir), &runtime));
        // the spelling of the path does not matter: case, slashes, a `\\?\` prefix, a trailing separator
        let spelled = r"c:/users/SOMEONE/appdata/local/job hunter team/host-runtime";
        let mut trailing = windows_labels(spelled);
        trailing["com.docker.compose.project.working_dir"] = format!("{spelled}/").into();
        assert!(windows_container_labels_are_attested(&trailing, &runtime));
        assert!(windows_container_labels_are_attested(&windows_labels(spelled), &runtime));
        assert!(windows_container_labels_are_attested(&windows_labels(&format!(r"\\?\{dir}")), &runtime));
    }

    #[test]
    fn a_windows_profile_name_with_accents_is_the_same_in_capitals() {
        let dir = r"C:\Users\Élodie Müller\AppData\Local\Job Hunter Team\host-runtime";
        let runtime = PathBuf::from(dir);
        assert_eq!(windows_path_key(dir), windows_path_key(&dir.to_uppercase()));
        assert!(windows_container_labels_are_attested(&windows_labels(&dir.to_uppercase()), &runtime));
        assert!(windows_container_labels_are_attested(&windows_labels(&dir.to_lowercase()), &runtime));
    }

    #[cfg(unix)]
    #[test]
    fn a_runtime_reached_by_another_name_is_the_same_directory_for_the_labels() {
        // On Windows a short 8.3 name and the long one; here a link: the labels hold the resolved one.
        let base = std::env::temp_dir().canonicalize().unwrap().join(format!("jht-runtime-alias-{}", std::process::id()));
        let real = base.join("long-name");
        fs::create_dir_all(&real).unwrap();
        let alias = base.join("SHORT~1");
        std::os::unix::fs::symlink(&real, &alias).unwrap();
        let labels = windows_labels(&real.to_string_lossy());
        // the labels' separators are backslashes in the helper: build them with the real path's own
        let mut labels = labels;
        labels["com.docker.compose.project.config_files"] =
            format!("{}/docker-compose.yml,{}/docker-compose.podman.yml", real.display(), real.display()).into();
        assert!(windows_container_labels_are_attested(&labels, &alias));
        assert!(!windows_container_labels_are_attested(&labels, &base.join("elsewhere")));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn the_windows_container_must_come_from_the_image_the_runtime_pins() {
        let pin = format!("ghcr.io/leopu00/jht@sha256:{}", "a".repeat(64));
        let other = format!("ghcr.io/leopu00/jht@sha256:{}", "b".repeat(64));
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!("jht-image-pin-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        // no pin file: any digest of the repository, nothing else
        assert!(windows_container_image_is_the_runtimes(&pin, &root));
        for image in ["ghcr.io/leopu00/jht:dev-1", "docker.io/library/alpine@sha256:aaaa", "sha256:aaaa", "", &format!("ghcr.io/leopu00/jht@sha256:{}", "A".repeat(64))] {
            assert!(!windows_container_image_is_the_runtimes(image, &root), "{image}");
        }
        // a pin file: exactly its reference
        fs::write(root.join("runtime-image"), format!("{pin}\n")).unwrap();
        assert!(windows_container_image_is_the_runtimes(&pin, &root));
        assert!(!windows_container_image_is_the_runtimes(&other, &root));
        // a pin that is not a reference, or without its line end, is not a pin: nothing matches it
        fs::write(root.join("runtime-image"), "ghcr.io/leopu00/jht:dev-1\n").unwrap();
        assert!(!windows_container_image_is_the_runtimes("ghcr.io/leopu00/jht:dev-1", &root));
        fs::write(root.join("runtime-image"), &pin).unwrap();
        assert!(!windows_container_image_is_the_runtimes(&pin, &root));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn the_inspect_line_is_split_with_the_image_only_where_it_is_asked_for() {
        assert_eq!(split_inspected("true|{\"a\":\"b\"}", false), Some(("true", "{\"a\":\"b\"}", None)));
        assert_eq!(split_inspected("true|{\"a\":\"x|y\"}|ghcr.io/leopu00/jht@sha256:00", true), Some(("true", "{\"a\":\"x|y\"}", Some("ghcr.io/leopu00/jht@sha256:00"))));
        // asked for the image and not given one: not a line to trust
        assert_eq!(split_inspected("true|{}", true), None);
        assert_eq!(split_inspected("no separator", false), None);
    }

    #[test]
    fn a_windows_container_that_the_runtime_did_not_start_is_not_attested() {
        let dir = r"C:\Users\someone\AppData\Local\Job Hunter Team\host-runtime";
        let runtime = PathBuf::from(dir);
        let other = r"C:\Users\someone\Documents\host-runtime";
        let with = |key: &str, value: serde_json::Value| {
            let mut labels = windows_labels(dir);
            labels[key] = value;
            labels
        };
        for (what, labels) in [
            ("another project", with("com.docker.compose.project", "other".into())),
            ("another service", with("com.docker.compose.service", "jht-broker".into())),
            ("a second replica", with("com.docker.compose.container-number", "2".into())),
            ("another working directory", with("com.docker.compose.project.working_dir", other.into())),
            ("other compose files", windows_labels(other)),
            (
                "one more compose file",
                with(
                    "com.docker.compose.project.config_files",
                    format!("{dir}\\docker-compose.yml,{dir}\\docker-compose.podman.yml,{other}\\x.yml").into(),
                ),
            ),
            ("only the first compose file", with("com.docker.compose.project.config_files", format!("{dir}\\docker-compose.yml").into())),
            ("no working directory", {
                let mut labels = windows_labels(dir);
                labels.as_object_mut().unwrap().remove("com.docker.compose.project.working_dir");
                labels
            }),
        ] {
            assert!(!windows_container_labels_are_attested(&labels, &runtime), "{what}");
        }
    }

    #[test]
    fn only_native_linux_podman_drops_remote_connection_selectors() {
        let podman = LocalChatEngine { program: PathBuf::from("private-engine"), podman: true };
        let docker = LocalChatEngine { program: PathBuf::from("private-engine"), podman: false };
        #[cfg(all(unix, not(target_os = "macos")))]
        assert_eq!(
            local_engine_removed_environment(&podman),
            ["CONTAINER_HOST", "CONTAINER_CONNECTION"]
        );
        #[cfg(not(all(unix, not(target_os = "macos"))))]
        assert!(local_engine_removed_environment(&podman).is_empty());
        assert!(local_engine_removed_environment(&docker).is_empty());
    }

use super::*;

pub(super) fn own_vps_root(tag: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("jht-own-vps-{}-{}-{tag}", std::process::id(), line!()));
    let _ = fs::remove_dir_all(&root);
    root
}

pub(super) fn own_host(address: &str, port: u16) -> ExecutionHost {
    ExecutionHost::Vps { address: address.into(), user: "jht".into(), port, key_path: "/keys/id_ed25519".into() }
}

/// The state with the key pinned now being `PINNED_KEY`.
pub(super) fn state_of(root: &Path, scope: &AccountScope, host: &ExecutionHost) -> OwnVpsState {
    own_vps_state_at(root, scope, host, Some(PINNED_KEY))
}

pub(super) fn may_write(root: &Path, scope: &AccountScope, host: &ExecutionHost, key: Option<&str>) -> bool {
    own_vps_for_writes_at(root, scope, host, key)
}

#[test]
pub(super) fn a_vps_of_the_persons_own_is_written_to_only_with_the_mark_the_provisioning_writes() {
    let root = own_vps_root("mark");
    let scope = AccountScope::synthetic(b"scope-own");
    let vps = own_host("203.0.113.7", 22);
    // an old VPS, set up before the mark: reads yes, writes no (until the person claims it)
    assert!(own_vps_for_reads_at(&root, &scope), "no candidate, no selection: read as before");
    assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "no mark: no write");
    assert_eq!(state_of(&root, &scope, &vps), OwnVpsState::Claimable);
    assert_eq!(state_of(&root, &scope, &vps).write_refusal(), Some("own_vps_claim_required"));
    mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
    assert!(may_write(&root, &scope, &vps, Some(PINNED_KEY)), "the mark, this host, this key: writes too");
    assert_eq!(state_of(&root, &scope, &vps).write_refusal(), None);
    // the mark is private, and says nothing but the account, the host and the key
    let file = path(&root, &scope, OWN_VPS_FILE);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let written: serde_json::Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    assert_eq!(written.as_object().unwrap().len(), 5);
    // it is the account's: another account has no mark
    assert!(!may_write(&root, &AccountScope::synthetic(b"another-scope"), &vps, Some(PINNED_KEY)));
    let _ = fs::remove_dir_all(&root);
}

#[test]
pub(super) fn another_host_another_port_or_another_key_is_not_the_marked_one() {
    let root = own_vps_root("other");
    let scope = AccountScope::synthetic(b"scope-own");
    mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
    assert!(may_write(&root, &scope, &own_host("203.0.113.7", 22), Some(PINNED_KEY)));
    // the mark of another host or port: this one is a VPS to claim, not a marked one
    assert_eq!(state_of(&root, &scope, &own_host("203.0.113.8", 22)), OwnVpsState::Claimable, "another host");
    assert_eq!(state_of(&root, &scope, &own_host("203.0.113.7", 2222)), OwnVpsState::Claimable, "another port");
    assert!(!may_write(&root, &scope, &own_host("203.0.113.8", 22), Some(PINNED_KEY)));
    assert!(!may_write(&root, &scope, &own_host("203.0.113.7", 2222), Some(PINNED_KEY)));
    // the same host with another key: reinstalled or replaced. Reads stay, writes ask for a new claim, with their own word
    let other = Some("SHA256:another-key-than-the-marked-one");
    assert_eq!(own_vps_state_at(&root, &scope, &own_host("203.0.113.7", 22), other), OwnVpsState::KeyChanged);
    assert_eq!(OwnVpsState::KeyChanged.write_refusal(), Some("own_vps_key_changed"));
    assert!(!may_write(&root, &scope, &own_host("203.0.113.7", 22), other), "another key");
    assert!(own_vps_for_reads_at(&root, &scope), "reads do not depend on the key");
    // no pin to compare, or this computer: never a VPS of one's own
    assert!(!may_write(&root, &scope, &own_host("203.0.113.7", 22), None), "no pin to compare");
    assert_eq!(own_vps_state_at(&root, &scope, &own_host("203.0.113.7", 22), None), OwnVpsState::NotOwn);
    assert_eq!(own_vps_state_at(&root, &scope, &ExecutionHost::Local, Some(PINNED_KEY)), OwnVpsState::NotOwn);
    let _ = fs::remove_dir_all(&root);
}

#[test]
pub(super) fn an_existing_teams_files_win_over_any_mark_for_reads_and_writes() {
    let root = own_vps_root("files");
    let scope = AccountScope::synthetic(b"scope-own");
    let vps = own_host("203.0.113.7", 22);
    mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
    let dir = account_dir(&root, &scope);
    // the person's own VPS, and then a selection appears (an existing team gets connected to): the
    // existing team's rule is back, and the full connection must be confirmed again
    fs::write(dir.join(SELECTION_FILE), b"{}").unwrap();
    assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "a selection that appears later: no longer the person's own");
    assert!(!own_vps_for_reads_at(&root, &scope), "nor read as one");
    fs::remove_file(dir.join(SELECTION_FILE)).unwrap();
    assert!(may_write(&root, &scope, &vps, Some(PINNED_KEY)), "and without it, theirs again");
    fs::write(dir.join(CANDIDATE_FILE), b"{}").unwrap();
    assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "a candidate: an existing team");
    assert!(!own_vps_for_reads_at(&root, &scope));
    fs::remove_file(dir.join(CANDIDATE_FILE)).unwrap();
    fs::write(dir.join(SELECTION_FILE), b"{}").unwrap();
    assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "a selection alone: an existing team too, and never mistaken");
    assert_eq!(state_of(&root, &scope, &vps), OwnVpsState::NotOwn);
    let _ = fs::remove_dir_all(&root);
}

#[test]
pub(super) fn a_mark_that_is_not_exactly_what_the_provisioning_writes_is_no_mark() {
    let root = own_vps_root("forged");
    let scope = AccountScope::synthetic(b"scope-own");
    let vps = own_host("203.0.113.7", 22);
    mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
    let file = path(&root, &scope, OWN_VPS_FILE);
    let good = fs::read(&file).unwrap();
    let value: serde_json::Value = serde_json::from_slice(&good).unwrap();
    let rewrite = |value: &serde_json::Value| {
        fs::write(&file, serde_json::to_vec(value).unwrap()).unwrap();
        set_private_permissions(&file).unwrap();
    };
    for (name, mutate) in [
        ("an extra field", Box::new(|v: &mut serde_json::Value| { v["extra"] = json!(1); }) as Box<dyn Fn(&mut serde_json::Value)>),
        ("another schema", Box::new(|v: &mut serde_json::Value| { v["schema"] = json!(2); })),
        ("another account", Box::new(|v: &mut serde_json::Value| { v["scope"] = json!("0".repeat(32)); })),
        ("a key that is no fingerprint", Box::new(|v: &mut serde_json::Value| { v["host_key"] = json!("not-a-fingerprint"); })),
        ("no port", Box::new(|v: &mut serde_json::Value| { v["port"] = json!(0); })),
        ("a padded address", Box::new(|v: &mut serde_json::Value| { v["address"] = json!(" 203.0.113.7"); })),
    ] {
        let mut forged = value.clone();
        mutate(&mut forged);
        rewrite(&forged);
        assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "{name}");
        assert_eq!(state_of(&root, &scope, &vps), OwnVpsState::Claimable, "{name}: a VPS to claim, not a marked one");
    }
    // not JSON, not an object, too long: no mark
    for bytes in [b"not json".to_vec(), b"[]".to_vec(), vec![b'{'; MAX_BYTES + 1]] {
        fs::write(&file, &bytes).unwrap();
        set_private_permissions(&file).unwrap();
        assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)));
    }
    // the right bytes, but readable by others or a link to somewhere else: no mark
    fs::write(&file, &good).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "not private");
        set_private_permissions(&file).unwrap();
        assert!(may_write(&root, &scope, &vps, Some(PINNED_KEY)), "private again");
        let elsewhere = root.join("elsewhere.json");
        fs::write(&elsewhere, &good).unwrap();
        set_private_permissions(&elsewhere).unwrap();
        fs::remove_file(&file).unwrap();
        std::os::unix::fs::symlink(&elsewhere, &file).unwrap();
        assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "a link");
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
pub(super) fn the_account_mark_of_another_account_does_not_open_this_one() {
    let root = own_vps_root("copy");
    let (one, two) = (AccountScope::synthetic(b"scope-one"), AccountScope::synthetic(b"scope-two"));
    let vps = own_host("203.0.113.7", 22);
    mark_own_vps_at(&root, &one, "203.0.113.7", 22, PINNED_KEY).unwrap();
    fs::create_dir_all(account_dir(&root, &two)).unwrap();
    fs::copy(path(&root, &one, OWN_VPS_FILE), path(&root, &two, OWN_VPS_FILE)).unwrap();
    set_private_permissions(&path(&root, &two, OWN_VPS_FILE)).unwrap();
    assert!(may_write(&root, &one, &vps, Some(PINNED_KEY)));
    assert!(!may_write(&root, &two, &vps, Some(PINNED_KEY)), "the copy says it is account one's");
    let _ = fs::remove_dir_all(&root);
}

#[test]
pub(super) fn forgetting_the_team_takes_the_mark_away_with_the_rest() {
    let root = own_vps_root("forget");
    let scope = AccountScope::synthetic(b"scope-own");
    let vps = own_host("203.0.113.7", 22);
    mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
    assert!(may_write(&root, &scope, &vps, Some(PINNED_KEY)));
    let dir = account_dir(&root, &scope);
    fs::write(dir.join(CANDIDATE_FILE), b"{}").unwrap();
    fs::write(dir.join(SELECTION_FILE), b"{}").unwrap();
    forget_team_at(&root, &scope).unwrap();
    assert!(!path(&root, &scope, OWN_VPS_FILE).exists() && !dir.join(CANDIDATE_FILE).exists() && !dir.join(SELECTION_FILE).exists());
    // the mark is gone: a VPS to claim again, and nothing is written to it until then
    assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)), "no mark: no write any more");
    assert_eq!(state_of(&root, &scope, &vps), OwnVpsState::Claimable);
    // nothing there is fine; the same again is fine
    forget_team_at(&root, &scope).unwrap();
    forget_team_at(&root, &AccountScope::synthetic(b"never-seen")).unwrap();
    let _ = fs::remove_dir_all(&root);
}

#[test]
pub(super) fn the_mark_is_replaced_for_a_new_host_and_refuses_what_is_not_a_host_and_a_key() {
    let root = own_vps_root("replace");
    let scope = AccountScope::synthetic(b"scope-own");
    mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
    mark_own_vps_at(&root, &scope, " 203.0.113.9 ", 22, PINNED_KEY).unwrap();
    assert!(may_write(&root, &scope, &own_host("203.0.113.9", 22), Some(PINNED_KEY)));
    assert!(!may_write(&root, &scope, &own_host("203.0.113.7", 22), Some(PINNED_KEY)), "the old host is no longer marked");
    for (address, port, key) in [("", 22, PINNED_KEY), ("203.0.113.7", 0, PINNED_KEY), ("203.0.113.7", 22, ""), ("203.0.113.7", 22, "no-sha256-prefix"), ("203.0.113.7", 22, "SHA256:with space")] {
        assert_eq!(mark_own_vps_at(&root, &scope, address, port, key), Err("existing_team_runtime_own_vps_invalid"), "{address}:{port} {key}");
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
pub(super) fn claiming_an_old_vps_writes_the_mark_only_when_the_person_confirmed_and_it_answers_as_theirs() {
    let root = own_vps_root("claim");
    let scope = AccountScope::synthetic(b"scope-own");
    let vps = own_host("203.0.113.7", 22);
    // old VPS without the mark: writes no, and then, after the claim, yes
    assert!(!may_write(&root, &scope, &vps, Some(PINNED_KEY)));
    // it does not answer as the team of this account: refused, and no file is left
    assert_eq!(claim_own_vps_at(&root, &scope, &vps, Some(PINNED_KEY), false), Err("own_vps_claim_refused"));
    assert!(!path(&root, &scope, OWN_VPS_FILE).exists(), "a refused claim leaves nothing");
    // no pin, or this computer: refused
    assert_eq!(claim_own_vps_at(&root, &scope, &vps, None, true), Err("own_vps_claim_refused"));
    assert_eq!(claim_own_vps_at(&root, &scope, &ExecutionHost::Local, Some(PINNED_KEY), true), Err("own_vps_claim_refused"));
    assert!(!path(&root, &scope, OWN_VPS_FILE).exists());
    // it answers as theirs: marked, and writes go
    claim_own_vps_at(&root, &scope, &vps, Some(PINNED_KEY), true).unwrap();
    assert!(may_write(&root, &scope, &vps, Some(PINNED_KEY)), "after the claim, writes go");
    // claiming again is a no-op
    claim_own_vps_at(&root, &scope, &vps, Some(PINNED_KEY), false).unwrap();
    // the key changed: claimed again with the new key, the mark follows it
    let other = "SHA256:Zz9PqE2cPNwUj8mP6X7Zr6l9kKq3b8m1sT4n2uYfA0c";
    assert_eq!(own_vps_state_at(&root, &scope, &vps, Some(other)), OwnVpsState::KeyChanged);
    assert_eq!(claim_own_vps_at(&root, &scope, &vps, Some(other), false), Err("own_vps_claim_refused"), "the new key needs the probe too");
    claim_own_vps_at(&root, &scope, &vps, Some(other), true).unwrap();
    assert_eq!(own_vps_state_at(&root, &scope, &vps, Some(other)), OwnVpsState::Marked);
    assert_eq!(own_vps_state_at(&root, &scope, &vps, Some(PINNED_KEY)), OwnVpsState::KeyChanged, "the old key is the changed one now");
    let _ = fs::remove_dir_all(&root);
}

#[test]
pub(super) fn an_existing_team_is_never_claimed_as_the_persons_own() {
    let root = own_vps_root("claim-existing");
    let scope = AccountScope::synthetic(b"scope-own");
    let vps = own_host("203.0.113.7", 22);
    let dir = account_dir(&root, &scope);
    fs::create_dir_all(&dir).unwrap();
    for file in [CANDIDATE_FILE, SELECTION_FILE] {
        fs::write(dir.join(file), b"{}").unwrap();
        assert_eq!(claim_own_vps_at(&root, &scope, &vps, Some(PINNED_KEY), true), Err("own_vps_claim_refused"), "{file}");
        assert!(!path(&root, &scope, OWN_VPS_FILE).exists(), "{file}: no mark written");
        fs::remove_file(dir.join(file)).unwrap();
    }
    let _ = fs::remove_dir_all(&root);
}

#[test]
pub(super) fn the_claim_request_carries_the_confirmation_and_nothing_the_page_could_say_about_the_account() {
    let ok: OwnVpsClaimRequest = serde_json::from_value(json!({"confirmed": true})).unwrap();
    assert!(ok.confirmed);
    // an id sent by the page is refused, whichever name it comes with
    for field in ["userId", "user_id", "accountId", "scope", "host"] {
        let mut body = json!({"confirmed": true});
        body[field] = json!("a".repeat(32));
        assert!(serde_json::from_value::<OwnVpsClaimRequest>(body).is_err(), "{field}");
    }
    assert!(serde_json::from_value::<OwnVpsClaimRequest>(json!({})).is_err(), "no confirmation: no request");
}

#[test]
pub(super) fn the_claim_asks_the_backend_for_the_account_and_ties_it_to_the_active_scope() {
    let source = include_str!("../own_vps_claim.rs");
    let command = &source[source.find("pub(crate) async fn own_vps_claim(").unwrap()..];
    let command = &command[..command.find("
}
").unwrap()];
    assert!(command.contains("authenticated_account_id(&app, &keys)"), "the account comes from the verified session");
    assert!(command.contains("scope_of_authenticated(account_id.as_bytes()) != expected"), "and is the active scope's");
    assert!(command.contains("claim_own_vps_impl(&app, &worker_expected, &account_id, &request)"));
}

#[test]
pub(super) fn the_identity_probe_sends_the_id_on_input_and_trusts_only_one_true_answer() {
    let id = "a".repeat(32);
    let input = String::from_utf8(own_vps_identity_input(&id).unwrap()).unwrap();
    let mut lines = input.lines();
    assert_eq!(lines.next().unwrap(), hex_encode(OWN_VPS_IDENTITY_PY.as_bytes()), "the script, in hex");
    assert_eq!(serde_json::from_str::<Value>(lines.next().unwrap()).unwrap(), json!({"user_id": id}));
    assert!(lines.next().is_none() && input.ends_with('\n'));
    assert!(!OWN_VPS_IDENTITY_PY.contains(&id), "the id is never in the script");
    assert!(own_vps_identity_input("short").is_none() && own_vps_identity_input("a;b").is_none());
    assert!(own_vps_identity_matches(br#"{"match": true}"#));
    for bad in [&br#"{"match": false}"#[..], br#"{"match": true, "x": 1}"#, br#"{"match": "true"}"#, br#"[true]"#, b"", b"match", br#"{"error":"x"}"#] {
        assert!(!own_vps_identity_matches(bad), "{}", String::from_utf8_lossy(bad));
    }
}

#[test]
pub(super) fn the_full_link_belongs_to_the_confirmed_team_in_this_run_only() {
    let _serial = FULL_LINK_TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let (one, two) = (AccountScope::synthetic(b"scope-one"), AccountScope::synthetic(b"scope-two"));
    let activated = |hash: &str| ActivatedTarget { team_id: "t".repeat(16), runtime: target(), candidate_sha256: hash.to_owned() };
    revoke_full_link();
    assert!(!full_link_granted(&one, &activated("h1")), "an app run that has not confirmed starts without it");
    grant_full_link(&one, &activated("h1"));
    assert!(full_link_granted(&one, &activated("h1")));
    assert!(!full_link_granted(&two, &activated("h1")), "another account never has it");
    assert!(!full_link_granted(&one, &activated("h2")), "nor another candidate of the same account");
    revoke_full_link();
    assert!(!full_link_granted(&one, &activated("h1")));
}

#[test]
pub(super) fn connection_key_differs_for_another_scope_or_another_candidate_and_only_then() {
    let activated = |hash: &str| ActivatedTarget { team_id: "t".repeat(16), runtime: target(), candidate_sha256: hash.to_owned() };
    let (one, two) = (AccountScope::synthetic(b"scope-one"), AccountScope::synthetic(b"scope-two"));
    let key = connection_key(&one, &activated(&"1".repeat(64)));
    assert!(hex(&key, 64));
    assert_eq!(key, connection_key(&one, &activated(&"1".repeat(64))));
    assert_ne!(key, connection_key(&two, &activated(&"1".repeat(64))));
    assert_ne!(key, connection_key(&one, &activated(&"2".repeat(64))));
}

#[test]
pub(super) fn target_command_keeps_container_index_and_platform_descriptor_distinct() {
    let command = command(&target(), "true").unwrap();
    assert!(command.contains("JHT_IMAGE='sha256:"));
    assert!(command.contains("JHT_PLATFORM_IMAGE='sha256:"));
    assert!(command.contains(r#"index .ImageManifestDescriptor "digest""#));
    assert!(command.contains("--platform \"$JHT_PLATFORM\""));
    assert!(!command.contains("docker exec jht"));
    assert!(!command.contains("docker inspect jht"));
}

#[test]
pub(super) fn target_rejects_equal_index_and_platform_descriptor() {
    let mut invalid = target();
    invalid.platform_image_id = invalid.image_id.clone();
    assert_eq!(
        command(&invalid, "true"),
        Err("existing_team_runtime_candidate_invalid")
    );
}

#[test]
pub(super) fn activation_requires_the_candidate_bytes_and_runtime_that_were_probed() {
    let host = ExecutionHost::Local;
    let candidate = Candidate {
        schema: 1,
        host: host.clone(),
        team_id: "team_existing_0123".into(),
        runtime: target(),
    };
    let probed = ActivatedTarget {
        team_id: candidate.team_id.clone(),
        runtime: candidate.runtime.clone(),
        candidate_sha256: "f".repeat(64),
    };
    assert!(candidate_matches_probed(
        &candidate,
        &"f".repeat(64),
        &host,
        &probed
    ));

    let mut changed = candidate.clone();
    changed.runtime.oci_revision = "a".repeat(40);
    assert!(!candidate_matches_probed(
        &changed,
        &"f".repeat(64),
        &host,
        &probed
    ));
    assert!(!candidate_matches_probed(
        &candidate,
        &"e".repeat(64),
        &host,
        &probed
    ));
}

#[test]
pub(super) fn vps_selection_is_required_while_local_connections_remain_separate() {
    assert_eq!(
        selection_may_be_absent(&ExecutionHost::Local, false),
        Ok(())
    );
    assert_eq!(
        selection_may_be_absent(&ExecutionHost::Local, true),
        Err("existing_team_runtime_selection_required")
    );
    assert_eq!(
        selection_may_be_absent(
            &ExecutionHost::Vps {
                address: "example.invalid".into(),
                user: "worker".into(),
                port: 22,
                key_path: "/private/key".into(),
            },
            false,
        ),
        Err("existing_team_runtime_selection_required")
    );
}

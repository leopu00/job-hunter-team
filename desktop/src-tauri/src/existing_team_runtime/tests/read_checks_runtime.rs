use super::*;

pub(super) fn synthetic_runtime() -> RuntimeTarget {
    ActivatedTarget::synthetic_for_tests().runtime
}

pub(super) fn vps(key: &str) -> crate::runtime_host::ValidatedHost {
    crate::runtime_host::ValidatedHost::Vps {
        address: "synthetic.example.invalid".into(),
        user: "synthetic".into(),
        port: 22,
        key_path: PathBuf::from(key),
        known_hosts: PathBuf::from("/synthetic/known_hosts"),
    }
}

pub(super) fn ok_reply() -> Value {
    json!({"ok": true, "data": {"items": []}})
}

pub(super) fn refusal() -> Value {
    json!({"ok": false, "error": "existing_team_runtime_changed"})
}

/// Runs `reads` reads one after the other at the given times, with a fake executor that answers
/// from `script` (true = ok), and says for each read whether it was the complete command.
pub(super) fn drive_reads(memory: &VerifiedTargets, key: &str, clock: &std::cell::Cell<u64>, steps: &[(u64, &[bool])]) -> Vec<(Vec<bool>, bool, bool)> {
    steps
        .iter()
        .map(|(at, answers)| {
            clock.set(*at);
            let mut asked = Vec::new();
            let mut next = answers.iter();
            let (reply, skipped) = read_amortising_checks(memory, Some(key), || clock.get(), |complete| {
                asked.push(complete);
                if *next.next().expect("a reply for every run") { ok_reply() } else { refusal() }
            });
            (asked, skipped, reply["ok"] == true)
        })
        .collect()
}

#[test]
pub(super) fn the_checks_are_made_on_the_first_read_and_not_repeated_for_45_seconds() {
    let memory = VerifiedTargets::new();
    let clock = std::cell::Cell::new(0);
    let seen = drive_reads(&memory, "target", &clock, &[(0, &[true]), (10_000, &[true]), (44_000, &[true]), (46_000, &[true]), (50_000, &[true])]);
    // complete, shortcut, shortcut, and at 46 s (45 s after the last COMPLETE read, not after the
    // last shortcut) complete again, then the shortcut
    assert_eq!(seen[0], (vec![true], false, true));
    assert_eq!(seen[1], (vec![false], true, true));
    assert_eq!(seen[2], (vec![false], true, true));
    assert_eq!(seen[3], (vec![true], false, true), "a shortcut that worked does not renew the entry");
    assert_eq!(seen[4], (vec![false], true, true));
}

#[test]
pub(super) fn a_container_that_was_replaced_is_never_read_on_the_shortcut_and_is_refused() {
    let memory = VerifiedTargets::new();
    let clock = std::cell::Cell::new(0);
    // the shortcut fails (`exec` on the old id), the complete read answers exit 70's refusal: once each
    let seen = drive_reads(&memory, "target", &clock, &[(0, &[true]), (5_000, &[false, false]), (6_000, &[true]), (7_000, &[true])]);
    assert_eq!(seen[1], (vec![false, true], false, false), "one shortcut, then ONE complete read, then the refusal");
    // the refusal deleted the entry: the next read is complete, and so makes it again
    assert_eq!(seen[2], (vec![true], false, true));
    assert_eq!(seen[3], (vec![false], true, true));
}

#[test]
pub(super) fn a_failed_shortcut_falls_back_at_once_and_only_once() {
    let memory = VerifiedTargets::new();
    let clock = std::cell::Cell::new(0);
    // the shortcut fails, the complete read works (a stopped and restarted container): the entry is made again
    let seen = drive_reads(&memory, "target", &clock, &[(0, &[true]), (1_000, &[false, true]), (2_000, &[true])]);
    assert_eq!(seen[1], (vec![false, true], false, true));
    assert_eq!(seen[2], (vec![false], true, true));
    // never a third run in one read
    let memory = VerifiedTargets::new();
    let runs = std::cell::Cell::new(0);
    read_amortising_checks(&memory, Some("target"), || 0, |_| { runs.set(runs.get() + 1); ok_reply() });
    read_amortising_checks(&memory, Some("target"), || 1, |_| { runs.set(runs.get() + 1); refusal() });
    assert_eq!(runs.get(), 3, "one complete read, then a failed shortcut and ONE complete read");
}

#[test]
pub(super) fn another_account_host_key_team_or_target_gets_no_shortcut() {
    let scope = AccountScope::synthetic(b"scope-one");
    let runtime = synthetic_runtime();
    let key = checks_key(&scope, &vps("/k/one"), "team-one", &runtime).expect("a pinned target on a VPS");
    let mut other_runtime = |edit: fn(&mut RuntimeTarget)| {
        let mut changed = runtime.clone();
        edit(&mut changed);
        checks_key(&scope, &vps("/k/one"), "team-one", &changed).expect("still whole")
    };
    let keys = [
        checks_key(&AccountScope::synthetic(b"scope-two"), &vps("/k/one"), "team-one", &runtime).unwrap(),
        checks_key(&scope, &vps("/k/two"), "team-one", &runtime).unwrap(),
        checks_key(&scope, &vps("/k/one"), "team-two", &runtime).unwrap(),
        other_runtime(|target| target.container_id = "9".repeat(64)),
        other_runtime(|target| target.image_id = format!("sha256:{}", "9".repeat(64))),
        other_runtime(|target| target.platform_image_id = format!("sha256:{}", "9".repeat(64))),
        other_runtime(|target| target.oci_revision = "9".repeat(40)),
        other_runtime(|target| target.digest = format!("sha256:{}", "9".repeat(64))),
    ];
    for other in &keys {
        assert_ne!(other, &key);
    }
    // and it holds in the memory: a read of the first target does not open a shortcut for the others
    let memory = VerifiedTargets::new();
    read_amortising_checks(&memory, Some(&key), || 0, |_| ok_reply());
    for other in &keys {
        let (_, skipped) = read_amortising_checks(&memory, Some(other), || 1_000, |_| ok_reply());
        assert!(!skipped, "{other}");
    }
    // a target that is not whole, or not on a VPS, has no key and is read complete every time
    let mut broken = runtime.clone();
    broken.container_id = "abc".into();
    assert!(checks_key(&scope, &vps("/k/one"), "team-one", &broken).is_none());
    assert!(checks_key(&scope, &crate::runtime_host::ValidatedHost::Local, "team-one", &runtime).is_none());
    let runs = std::cell::Cell::new(0);
    for _ in 0..3 {
        let (_, skipped) = read_amortising_checks(&memory, None, || 0, |complete| { assert!(complete); runs.set(runs.get() + 1); ok_reply() });
        assert!(!skipped);
    }
    assert_eq!(runs.get(), 3);
}

#[test]
pub(super) fn the_shortcut_has_no_checks_and_runs_only_on_a_whole_container_id() {
    let runtime = synthetic_runtime();
    let fast = python_command_unchecked(&runtime).unwrap();
    let full = python_command(&runtime).unwrap();
    assert_eq!(fast.matches("inspect").count(), 0);
    assert!(full.contains("inspect"));
    assert!(fast.contains(&format!("JHT_CID='{}'", runtime.container_id)));
    assert!(fast.ends_with(PYTHON_STDIN_EXEC));
    // the engine is still chosen, and the id is the only thing the command is made of
    assert!(fast.contains("JHT_ENGINE=docker") && fast.contains("JHT_ENGINE=podman"));
    for bad in ["", "abc", &"A".repeat(64), &format!("{}'; id #", "a".repeat(40)), &"g".repeat(64), &"a".repeat(65)] {
        let mut target = runtime.clone();
        target.container_id = bad.to_string();
        assert_eq!(python_command_unchecked(&target), Err("existing_team_runtime_candidate_invalid"), "{bad:?}");
    }
}

#[test]
pub(super) fn the_checks_memory_forgets_after_the_time_and_stays_small() {
    let memory = VerifiedTargets::new();
    memory.remember("a", 0);
    assert!(memory.fresh("a", 44_999) && !memory.fresh("a", 45_000));
    // a clock that went back is no proof
    memory.remember("b", 10_000);
    assert!(!memory.fresh("b", 5_000));
    for n in 0..20 {
        memory.remember(&format!("t{n}"), 100_000 + n);
    }
    assert!(memory.entries.lock().unwrap().len() <= CHECKS_KEPT_TARGETS);
    memory.forget("t19");
    assert!(!memory.fresh("t19", 100_050));
}

/// The read of the team's positions says why it failed, in the kinds the header acts on.
pub(super) fn read_stats(
    run: Result<ProcessResult, &'static str>,
    key_matches_pin: Option<bool>,
) -> (Value, usize) {
    let mut scans = 0;
    let reply = positions_read_with(
        &PositionsRequest::Stats,
        br#"{"op":"stats"}"#,
        |input| {
            // the fixed reader and the request travel on stdin, never in the command
            assert!(input.ends_with(b"{\"op\":\"stats\"}\n"));
            run
        },
        || {
            scans += 1;
            key_matches_pin
        },
    );
    (reply, scans)
}

pub(super) fn exited(code: i32, stdout: &str) -> Result<ProcessResult, &'static str> {
    Ok(ProcessResult { code, stdout: stdout.as_bytes().to_vec() })
}

#[test]
pub(super) fn a_failed_positions_read_says_network_application_version_or_blocked() {
    let failure = |code: &str, kind: &str| json!({"ok": false, "error": code, "kind": kind});
    assert_eq!(read_stats(Err("process_timeout"), None), (failure("timeout", "network"), 0));
    assert_eq!(read_stats(exited(255, ""), None), (failure("ssh_unavailable", "network"), 1));
    assert_eq!(read_stats(exited(255, ""), Some(true)), (failure("ssh_unavailable", "network"), 1));
    assert_eq!(read_stats(exited(255, ""), Some(false)), (failure("host_key_changed", "blocked"), 1));
    assert_eq!(
        read_stats(exited(72, ""), Some(false)),
        (failure("existing_team_identity_mismatch", "application"), 0)
    );
    assert_eq!(
        read_stats(exited(70, ""), None),
        (failure("existing_team_runtime_changed", "version"), 0)
    );
    assert_eq!(read_stats(exited(0, "not json"), None), (failure("positions_unavailable", "application"), 0));
    assert_eq!(
        read_stats(exited(0, r#"{"ok":false,"error":"positions_request_invalid"}"#), None),
        (failure("positions_request_invalid", "application"), 0)
    );
    // a pin file that no longer reads blocks before anything runs
    assert_eq!(positions_failure("host_key_mismatch"), failure("host_key_mismatch", "blocked"));
    assert_eq!(positions_failure("host_not_configured"), failure("host_not_configured", "application"));
}

#[test]
pub(super) fn a_team_that_is_off_answers_from_its_saved_data_and_one_that_is_up_does_not_ask_for_them() {
    let failed = || Err("spawn_failed");
    let saved = json!({"ok": true, "data": {"items": []}, "saved": {"at": 1793879580}});
    let off = positions_read_local_with(&PositionsRequest::Facets, br#"{"op":"facets"}"#, "0123456789abcdef", || false, |_| failed(), || false, || Some(saved.clone()));
    assert_eq!(off, saved);
    // nothing saved to answer with: the sentence it always was
    let none = positions_read_local_with(&PositionsRequest::Facets, br#"{"op":"facets"}"#, "0123456789abcdef", || false, |_| failed(), || false, || None);
    assert_eq!(none, positions_failure("local_team_not_running"));
    // the team is up and the reader failed: the saved data are not a stand-in for a failure of a team that is running
    let up = positions_read_local_with(&PositionsRequest::Facets, br#"{"op":"facets"}"#, "0123456789abcdef", || false, |_| failed(), || true, || panic!("not asked"));
    assert_eq!(up, positions_answer_failure("positions_unavailable"));
}

#[test]
pub(super) fn a_stopped_machine_is_never_asked_for_anything_and_the_pages_show_what_the_team_saved() {
    let saved = json!({"ok": true, "data": {"items": []}, "saved": {"at": 1793879580}});
    let shown = positions_read_local_with(
        &PositionsRequest::Facets,
        br#"{"op":"facets"}"#,
        "0123456789abcdef",
        || true,
        |_| panic!("the wrapper must not be called for a stopped machine"),
        || panic!("nor the question whether the team is up"),
        || Some(saved.clone()),
    );
    assert_eq!(shown, saved);
    // nothing saved to show: the sentence it always was, and still nothing asked of the machine
    let empty = positions_read_local_with(
        &PositionsRequest::Facets,
        br#"{"op":"facets"}"#,
        "0123456789abcdef",
        || true,
        |_| panic!("the wrapper must not be called for a stopped machine"),
        || panic!("nor the question whether the team is up"),
        || None,
    );
    assert_eq!(empty, positions_failure("local_team_not_running"));
}

/// The read of this computer's team, with the fixed reader on stdin and the team's state asked only after a failure.
pub(super) fn read_local(run: Result<ProcessResult, &'static str>, team_is_up: bool) -> (Value, usize) {
    let mut asked = 0;
    let reply = positions_read_local_with(
        &PositionsRequest::Facets,
        br#"{"op":"facets"}"#,
        "0123456789abcdef",
        || false,
        |input| {
            // the same reader and request as the VPS gets, on stdin: the reader in hex, then the request
            let text = String::from_utf8(input.to_vec()).unwrap();
            let (script, request) = text.split_once('\n').unwrap();
            assert_eq!(script, hex_encode(POSITIONS_READ_PY.as_bytes()));
            assert_eq!(request, "{\"op\":\"facets\"}\n");
            run
        },
        || {
            asked += 1;
            team_is_up
        },
        || None,
    );
    (reply, asked)
}

#[test]
pub(super) fn the_read_of_this_computers_team_returns_the_readers_answer_without_asking_whether_the_team_is_up() {
    let answer = r#"{"ok":true,"data":{"items":[]}}"#;
    assert_eq!(read_local(exited(0, answer), true), (json!({"ok": true, "data": {"items": []}}), 0));
    // the same checks as the VPS: a reply that is not the shape asked for is not an answer
    let failure = |code: &str| json!({"ok": false, "error": code, "kind": "application"});
    assert_eq!(read_local(exited(0, "not json"), true), (failure("positions_unavailable"), 0));
    assert_eq!(read_local(exited(0, r#"{"ok":true,"data":{"rows":[]}}"#), true), (failure("positions_unavailable"), 0));
    assert_eq!(
        read_local(exited(0, r#"{"ok":false,"error":"positions_request_invalid"}"#), true),
        (failure("positions_request_invalid"), 0)
    );
}

#[test]
pub(super) fn a_failed_read_of_this_computers_team_says_the_team_is_not_running_only_when_it_is_not() {
    let failure = |code: &str| json!({"ok": false, "error": code, "kind": "application"});
    // the container is off (the wrapper found none): the chat's own code, which the pages turn into «Start the team»
    assert_eq!(read_local(exited(1, ""), false), (failure("local_team_not_running"), 1));
    assert_eq!(read_local(Err("process_timeout"), false), (failure("local_team_not_running"), 1));
    assert_eq!(read_local(Err("runtime_missing"), false), (failure("local_team_not_running"), 1));
    // the team is up and the reader failed: not «start the team», and no host-key or network kind
    assert_eq!(read_local(exited(1, ""), true), (failure("positions_unavailable"), 1));
    assert_eq!(read_local(exited(255, ""), true), (failure("positions_unavailable"), 1));
    assert_eq!(read_local(Err("process_timeout"), true), (failure("positions_unavailable"), 1));
}

#[test]
pub(super) fn this_computers_team_is_read_before_any_pinned_target_or_ssh_and_the_vps_path_is_the_one_it_was() {
    let source = include_str!("../../existing_team_runtime.rs");
    let local_source = include_str!("../positions_local.rs");
    let body = source.split("pub(crate) fn positions_read_for_scope(").nth(1).unwrap().split("\n}\n").next().unwrap();
    let local = body.find("positions_read_local(app, scope, &request, &request_bytes)").unwrap();
    // the branch is taken on the validated host, ahead of everything that belongs to a VPS
    for vps_only in ["selected_or_own(", "read_command_for(", "shared_master(", "run_ssh_command(", "read_unless_blocked("] {
        assert!(local < body.find(vps_only).unwrap(), "{vps_only}");
    }
    assert!(body[..local].contains("ValidatedHost::Local"));
    // the VPS still reads through positions_read_with, and the local read never reaches an ssh function
    assert!(body.contains("positions_read_with("));
    let local_fn = local_source.split("fn positions_read_local(").nth(1).unwrap().split("\n}\n").next().unwrap();
    for forbidden in ["run_ssh_command", "ssh", "selected_or_own", "claim"] {
        assert!(!local_fn.replace("ssh: Duration::ZERO", "").contains(forbidden), "{forbidden}");
    }
    // it checks the owner without claiming the folder, and the wrapper's chat protocol, before anything runs
    let wrapper_fn = local_source.split("fn local_reader_wrapper(").nth(1).unwrap().split("\n}\n").next().unwrap();
    assert!(wrapper_fn.contains("verify_local_runtime_owner") && !wrapper_fn.contains("validate_local_runtime"));
    assert!(wrapper_fn.contains("wrapper_has_desktop_chat"));
    // every way out with an error leaves a line in the runtime log, with the wrapper it looked at
    assert!(wrapper_fn.contains("record_local_reader_refusal") && wrapper_fn.contains("if let Err(code) = checked"));
    assert!(wrapper_fn.find("wrapper_has_desktop_chat").unwrap() < wrapper_fn.find("record_local_reader_refusal").unwrap());
    // read only: the reader opens the database that way and the wrapper's channel starts nothing
    assert!(POSITIONS_READ_PY.contains("mode=ro") && POSITIONS_READ_PY.contains("PRAGMA query_only=ON"));
}

#[test]
pub(super) fn once_the_key_is_found_changed_the_next_reads_do_not_go_out_until_the_pin_changes() {
    use std::cell::Cell;
    let key = Some(vps_link::block_key("scope-read-test", "vps.example", 22));
    let pin = Some("SHA256:confirmed".to_string());
    let goes_out = Cell::new(0);
    let blocked_read = || {
        goes_out.set(goes_out.get() + 1);
        vps_link::blocked_reply()
    };
    // The first read goes out (ssh, then one keyscan) and finds the key changed.
    let first = read_unless_blocked(key.clone(), pin.clone(), blocked_read);
    assert!(vps_link::is_key_changed(&first));
    assert_eq!(goes_out.get(), 1);
    // The next ones answer at once: no ssh, no keyscan.
    for _ in 0..3 {
        let reply = read_unless_blocked(key.clone(), pin.clone(), blocked_read);
        assert!(vps_link::is_key_changed(&reply));
    }
    assert_eq!(goes_out.get(), 1, "a read that is blocked is not run");
    // The person confirmed the new key: the pin is another one and the read goes out again.
    let reopened = read_unless_blocked(key.clone(), Some("SHA256:reconfirmed".to_string()), || {
        goes_out.set(goes_out.get() + 1);
        json!({"ok": true})
    });
    assert_eq!(reopened, json!({"ok": true}));
    assert_eq!(goes_out.get(), 2);
    // A network failure is never remembered as a block.
    let net = read_unless_blocked(key.clone(), Some("SHA256:reconfirmed".to_string()), || {
        vps_link::failure_reply(vps_link::LinkOutcome { kind: vps_link::LinkKind::Network, code: "timeout" })
    });
    assert_eq!(net["kind"], "network");
    let after_net = read_unless_blocked(key, Some("SHA256:reconfirmed".to_string()), || json!({"ok": true}));
    assert_eq!(after_net, json!({"ok": true}));
}

#[test]
pub(super) fn a_working_positions_read_is_passed_on_unchanged() {
    let part = json!({"rows": [], "included": 0, "of": 0});
    let good = json!({"ok": true, "data": {
        "stats": {}, "distribution": {}, "sources": [], "types": [], "recent": [],
        "points": part, "events": part
    }});
    assert_eq!(read_stats(exited(0, &good.to_string()), None), (good, 0));
}

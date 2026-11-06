use super::*;

#[test]
pub(super) fn assistant_start_runs_the_launcher_script_in_the_pinned_container_after_its_checks() {
    let runtime = RuntimeTarget {
        container_id: "a".repeat(64),
        image_id: format!("sha256:{}", "b".repeat(64)),
        platform_image_id: format!("sha256:{}", "c".repeat(64)),
        oci_revision: "d".repeat(40),
        digest: format!("sha256:{}", "e".repeat(64)),
        os: "linux".into(),
        architecture: "amd64".into(),
    };
    let command = assistant_start_command(&runtime).expect("a valid target");
    let checks = command.find("exit 70").expect("the pin is checked");
    let script = command.find("bash /app/.launcher/start-agent.sh assistente").expect("the one script");
    assert!(checks < script, "the container is verified before anything runs in it");
    assert!(command.contains("\"$JHT_ENGINE\" exec -e JHT_SPAWN_SRC=desktop-existing-team \"$JHT_CID\" bash"));
    assert!(command.contains(&format!("JHT_CID='{}'", runtime.container_id)));
    assert!(!command.contains("docker exec jht"));
    assert_eq!(command.matches("start-agent.sh").count(), 1);
    // a target that is not a whole, pinned one builds nothing
    let mut broken = runtime.clone();
    broken.platform_image_id = broken.image_id.clone();
    assert_eq!(assistant_start_command(&broken), Err("existing_team_runtime_candidate_invalid"));
}

#[test]
pub(super) fn the_cloud_sync_read_is_a_closed_request_and_a_closed_reply() {
    assert!(matches!(parse_positions_request(json!({"op": "cloud_sync"})), Ok(PositionsRequest::CloudSync)));
    assert!(POSITIONS_READ_PY.contains("if op=='cloud_sync':"));
    // the token lives in cloud.json: the reader never names it
    let reader = POSITIONS_READ_PY.split("if op=='cloud_sync':").nth(1).unwrap().split("if op=='profile':").next().unwrap();
    assert!(!reader.contains("cloud.json") && !reader.contains("token"));
    let ok = |data: Value| json!({"ok": true, "data": data});
    for good in [
        json!({"state": "absent"}),
        json!({"state": "unreadable"}),
        json!({"state": "ok", "status": "auth_failed", "last_success_at": "2026-10-07T12:12:46.425Z", "last_attempt_at": null, "consecutive_failures": 45000}),
        json!({"state": "ok", "status": "other", "last_success_at": null, "last_attempt_at": null, "consecutive_failures": 0}),
    ] {
        assert!(valid_positions_reply(&PositionsRequest::CloudSync, &ok(good.clone())), "{good}");
    }
    for broken in [
        json!({"state": "absent", "status": "idle"}),
        json!({"state": "ok", "status": "auth_failed", "last_success_at": null, "last_attempt_at": null}),
        json!({"state": "ok", "status": "exploded", "last_success_at": null, "last_attempt_at": null, "consecutive_failures": 0}),
        json!({"state": "ok", "status": "idle", "last_success_at": 1, "last_attempt_at": null, "consecutive_failures": 0}),
        json!({"state": "ok", "status": "idle", "last_success_at": null, "last_attempt_at": null, "consecutive_failures": -1}),
        json!({"state": "ok", "status": "idle", "last_success_at": null, "last_attempt_at": null, "consecutive_failures": 0, "token": "x"}),
        json!({"state": "other"}),
        json!(null),
    ] {
        assert!(!valid_positions_reply(&PositionsRequest::CloudSync, &ok(broken.clone())), "{broken}");
    }
}

#[test]
pub(super) fn profile_request_is_closed_and_the_reader_opens_only_the_two_profile_paths() {
    assert!(matches!(parse_positions_request(json!({"op": "profile"})), Ok(PositionsRequest::Profile)));
    // whatever a caller adds (a path, a file name, a field list) is gone before the reader:
    // the core forwards the parsed request, never the received one
    for extra in [json!({"op": "profile", "path": "/jht_home/x"}), json!({"op": "profile", "filters": {}}), json!({"op": "profile", "id": "1"})] {
        let forwarded = parse_positions_request(extra.clone())
            .map(|request| serde_json::to_value(request).expect("request serializes"));
        assert_eq!(forwarded, Ok(json!({"op": "profile"})), "{extra}");
    }
    assert!(POSITIONS_READ_PY.contains("if op=='profile':"));
    assert!(POSITIONS_READ_PY.contains("PROFILE_DIR+'/candidate_profile.yml'"));
    assert!(POSITIONS_READ_PY.contains("PROFILE_DIR+'/summaries/'"));
    assert!(POSITIONS_READ_PY.contains("os.O_NOFOLLOW"));
    // the neighbours of the profile in the same folder are never named: the provider's
    // configuration, the candidate's original documents, the flags
    let reader = POSITIONS_READ_PY.split("if op=='profile':").nth(1).unwrap().split("db=sqlite3.connect").next().unwrap();
    for forbidden in ["jht.config", "sources", "credentials", "cloud.json", ".claude", ".codex", ".kimi", "ready.flag", "welcomed.flag", "req.get"] {
        assert!(!reader.contains(forbidden), "the profile reader names {forbidden}");
    }
}

#[test]
pub(super) fn profile_reply_must_have_both_parts_whole() {
    let good = json!({"ok": true, "data": {
        "profile": {"state": "absent"},
        "summaries": {"state": "absent", "items": [], "included": 0, "of": 0}
    }});
    assert!(valid_positions_reply(&PositionsRequest::Profile, &good));
    for broken in [
        json!({"ok": true, "data": {"profile": {"state": "absent"}}}),
        json!({"ok": true, "data": {"profile": {"state": 1}, "summaries": {"state": "ok", "items": [], "included": 0, "of": 0}}}),
        json!({"ok": true, "data": {"profile": {"state": "ok"}, "summaries": {"state": "ok", "items": {}, "included": 0, "of": 0}}}),
        json!({"ok": true, "data": {"profile": {"state": "ok"}, "summaries": {"state": "ok", "items": [], "included": -1, "of": 0}}}),
        json!({"ok": true, "data": {"profile": {"state": "ok"}, "summaries": {"state": "ok", "items": [], "included": 0, "of": 0}, "extra": 1}}),
    ] {
        assert!(!valid_positions_reply(&PositionsRequest::Profile, &broken), "{broken}");
    }
}

#[test]
pub(super) fn profile_file_is_read_as_whitelisted_fields_and_the_rest_is_counted_and_dropped() {
    let text = "name: Synthetic Person\ntarget_role: Synthetic Role\nskills:\n  primary: [Alpha, Beta]\nprovider_token: synthetic-secret-value\ninternal_note: synthetic\ncandidate:\n  contacts:\n    phone: '000'\n";
    let (parse, fields, kept, dropped) = profile_fields(text);
    assert_eq!((parse, kept, dropped), ("ok", 4, 2));
    let fields = fields.as_object().unwrap();
    assert_eq!(fields.keys().map(String::as_str).collect::<Vec<_>>(), ["candidate", "name", "skills", "target_role"]);
    assert!(!serde_json::to_string(fields).unwrap().contains("synthetic-secret-value"));
}

#[test]
pub(super) fn profile_file_that_cannot_be_read_says_why_and_gives_no_field() {
    assert_eq!(profile_fields("name: [unclosed").0, "invalid_yaml");
    // a repeated key is not an error to the file's own writer (the last one wins), nor here
    let repeated = profile_fields("name: a\nname: b\n");
    assert_eq!((repeated.0, repeated.1["name"].as_str()), ("ok", Some("b")));
    assert_eq!(profile_fields("- just\n- a list\n").0, "not_a_mapping");
    assert_eq!(profile_fields("").0, "not_a_mapping");
    assert_eq!(profile_fields("12").0, "not_a_mapping");
    let bomb = "a: &a [x, x, x]\nb: &b [*a, *a, *a]\nc: &c [*b, *b, *b]\nd: [*c, *c, *c]\n";
    let (parse, fields, kept, dropped) = profile_fields(bomb);
    assert_eq!((parse, kept, dropped), ("aliases_unsupported", 0, 0));
    assert!(fields.is_null());
    // prose with an asterisk or an ampersand is not an alias
    let prose = "name: Q&A *emphasis* and R&D\nnotes: |\n  * a bullet\n  & more\n";
    assert_eq!(profile_fields(prose).0, "ok");
}

#[test]
pub(super) fn profile_reply_drops_the_raw_text_and_declares_what_it_did() {
    let reply = json!({"ok": true, "data": {
        "profile": {"state": "ok", "bytes": 20, "sha256": "a".repeat(64), "text": "name: Synthetic\nextra_key: x\n"},
        "summaries": {"state": "ok", "items": [{"name": "about", "state": "ok", "bytes": 3, "sha256": "b".repeat(64), "text": "hi"}], "included": 1, "of": 1}
    }});
    let shaped = shape_profile(reply);
    let profile = &shaped["data"]["profile"];
    assert!(profile.get("text").is_none());
    assert_eq!((profile["parse"].as_str(), profile["kept"].as_u64(), profile["dropped"].as_u64()), (Some("ok"), Some(1), Some(1)));
    assert_eq!(profile["fields"], json!({"name": "Synthetic"}));
    assert!(!shaped.to_string().contains("extra_key"));
    assert_eq!(shaped["data"]["summaries"]["items"][0]["text"], "hi");

    let absent = shape_profile(json!({"ok": true, "data": {"profile": {"state": "absent"}, "summaries": {"state": "absent", "items": [], "included": 0, "of": 0}}}));
    assert_eq!(absent["data"]["profile"]["parse"], "none");
    assert!(absent["data"]["profile"]["fields"].is_null());
}

pub(super) fn target() -> RuntimeTarget {
    RuntimeTarget {
        container_id: "a".repeat(64),
        image_id: format!("sha256:{}", "b".repeat(64)),
        platform_image_id: format!("sha256:{}", "c".repeat(64)),
        oci_revision: "d".repeat(40),
        digest: format!("sha256:{}", "e".repeat(64)),
        os: "linux".into(),
        architecture: "amd64".into(),
    }
}

#[test]
pub(super) fn the_chat_command_is_the_fixed_script_in_the_verified_container_with_only_checked_tokens() {
    let read = chat_command(&target(), &ChatOperation::Read { agent: "capitano", cursor: Some("123") }).expect("a read");
    assert!(read.contains("exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -I /app/shared/skills/agent_chat.py read 'capitano' '123'"));
    assert!(read.contains("|| exit 70") && read.starts_with("set -eu\nJHT_CID='"), "the pinned container is verified first");
    let first = chat_command(&target(), &ChatOperation::Read { agent: "mentor", cursor: None }).expect("a first page");
    assert!(first.ends_with("agent_chat.py read 'mentor'"));
    let send = chat_command(&target(), &ChatOperation::Send { agent: "assistente", client_message_id: "id-1-A" }).expect("a send");
    assert!(send.ends_with("agent_chat.py send 'assistente' 'id-1-A'"));
    assert!(!send.contains("python3 -c") && !send.contains("exec(bytes.fromhex"), "no interpreter that runs what it is sent");
}

#[test]
pub(super) fn the_wrapper_arguments_are_the_same_checked_tokens_behind_the_wrappers_two_actions() {
    let read = chat_wrapper_arguments(&ChatOperation::Read { agent: "capitano", cursor: Some("4096") }).unwrap();
    assert_eq!(read, ["desktop-chat", "read", "capitano", "4096"]);
    let first = chat_wrapper_arguments(&ChatOperation::Read { agent: "mentor", cursor: None }).unwrap();
    assert_eq!(first, ["desktop-chat", "read", "mentor"]);
    let send = chat_wrapper_arguments(&ChatOperation::Send { agent: "assistente", client_message_id: "id-1" }).unwrap();
    assert_eq!(send, ["desktop-chat", "chat-send", "assistente", "id-1"]);
    assert_eq!(
        chat_wrapper_arguments(&ChatOperation::Send { agent: "capitano", client_message_id: "a b" }),
        Err("invalid_request")
    );
    assert_eq!(
        chat_wrapper_arguments(&ChatOperation::Read { agent: "root", cursor: None }),
        Err("invalid_agent")
    );
}

#[test]
pub(super) fn an_answer_and_an_enter_carry_only_their_checked_ids_and_never_the_persons_words() {
    let answer = ChatOperation::Answer { agent: "capitano", question_id: "aq:capitano:1792700000-a1b2c3" };
    assert!(answer.needs_answer_actions());
    assert!(chat_command(&target(), &answer).unwrap().ends_with("agent_chat.py answer 'capitano' 'aq:capitano:1792700000-a1b2c3'"));
    assert_eq!(
        chat_wrapper_arguments(&answer).unwrap(),
        ["desktop-chat", "chat-answer", "capitano", "aq:capitano:1792700000-a1b2c3"]
    );
    let enter = ChatOperation::Enter { agent: "mentor", message_id: "0b1c2d3e-4f50" };
    assert!(enter.needs_answer_actions());
    assert!(chat_command(&target(), &enter).unwrap().ends_with("agent_chat.py enter 'mentor' '0b1c2d3e-4f50'"));
    assert_eq!(chat_wrapper_arguments(&enter).unwrap(), ["desktop-chat", "chat-enter", "mentor", "0b1c2d3e-4f50"]);
    assert!(!ChatOperation::Read { agent: "capitano", cursor: None }.needs_answer_actions());
    assert!(!ChatOperation::Send { agent: "capitano", client_message_id: "id" }.needs_answer_actions());
    // anything a shell could read as more than one word, or longer than the ids are, never enters
    let long_question = "q".repeat(97);
    for id in ["", "a b", "a'b", "a;b", "$(x)", "a\nb", "\u{e9}", long_question.as_str()] {
        assert_eq!(
            chat_wrapper_arguments(&ChatOperation::Answer { agent: "capitano", question_id: id }),
            Err("invalid_request"),
            "{id:?}"
        );
    }
    let long_message = "m".repeat(65);
    for id in ["", "a:b", "a_b", "a b", long_message.as_str()] {
        assert_eq!(
            chat_wrapper_arguments(&ChatOperation::Enter { agent: "capitano", message_id: id }),
            Err("invalid_request"),
            "{id:?}"
        );
    }
    assert_eq!(chat_wrapper_arguments(&ChatOperation::Answer { agent: "root", question_id: "q1" }), Err("invalid_agent"));
    assert_eq!(chat_wrapper_arguments(&ChatOperation::Enter { agent: "root", message_id: "m1" }), Err("invalid_agent"));
}

#[test]
pub(super) fn golden_the_operation_line_of_each_chat_command_is_exactly_this() {
    let last = |command: String| command.lines().last().expect("a last line").to_owned();
    assert_eq!(
        last(chat_command(&target(), &ChatOperation::Read { agent: "capitano", cursor: Some("4096") }).unwrap()),
        "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -I /app/shared/skills/agent_chat.py read 'capitano' '4096'"
    );
    assert_eq!(
        last(chat_command(&target(), &ChatOperation::Read { agent: "mentor", cursor: None }).unwrap()),
        "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -I /app/shared/skills/agent_chat.py read 'mentor'"
    );
    assert_eq!(
        last(chat_command(&target(), &ChatOperation::Send { agent: "assistente", client_message_id: "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0" }).unwrap()),
        "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -I /app/shared/skills/agent_chat.py send 'assistente' '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'"
    );
}

#[test]
pub(super) fn an_instance_of_a_numbered_role_is_a_closed_form_of_the_chat_command() {
    let last = |command: String| command.lines().last().expect("a last line").to_owned();
    assert_eq!(
        last(chat_command(&target(), &ChatOperation::Read { agent: "analista-2", cursor: None }).unwrap()),
        "exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -I /app/shared/skills/agent_chat.py read 'analista-2'"
    );
    assert_eq!(
        chat_wrapper_arguments(&ChatOperation::Send { agent: "scout-12", client_message_id: "id-1" }).unwrap(),
        ["desktop-chat", "chat-send", "scout-12", "id-1"]
    );
    assert_eq!(chat_session("scout-12").as_deref(), Some("SCOUT-12"));
    assert_eq!(chat_session("scout").as_deref(), Some("SCOUT-1"));
    assert!(chat_session_ok("SCRITTORE-9999") && chat_session_ok("CRITICO"));
    for bad in ["scout", "SCOUT", "SCOUT-0", "SCOUT-01", "scout-2", "SCOUT-2 ", "CRITICO-2", "CAPITANO-1", ""] {
        assert!(!chat_session_ok(bad), "{bad:?}");
    }
}

#[test]
pub(super) fn nothing_outside_the_closed_forms_enters_the_chat_command() {
    for agent in [
        "", "CAPITANO", "capitano ", "capitano'; id #", "scout-0", "scout-01", "scout-10000", "scout-1-2", "SCOUT-1", "scout-2\n",
        "scout-2'; id #", "critico-2", "../mentor", "capitano\n", "agente",
    ] {
        assert_eq!(chat_command(&target(), &ChatOperation::Read { agent, cursor: None }), Err("invalid_agent"), "{agent:?}");
        assert_eq!(chat_command(&target(), &ChatOperation::Send { agent, client_message_id: "id" }), Err("invalid_agent"), "{agent:?}");
    }
    let long_cursor = "9".repeat(13);
    for cursor in ["", "-1", "1.5", "12x", "1 2", "1;id", "'", long_cursor.as_str()] {
        assert_eq!(chat_command(&target(), &ChatOperation::Read { agent: "capitano", cursor: Some(cursor) }), Err("invalid_request"), "{cursor:?}");
    }
    let long_id = "x".repeat(65);
    for id in ["", "a b", "a'b", "a;b", "a$(id)", "a`id`", "a\nb", "è", "with_underscore", long_id.as_str()] {
        assert_eq!(chat_command(&target(), &ChatOperation::Send { agent: "capitano", client_message_id: id }), Err("invalid_request"), "{id:?}");
    }
    let mut broken = target();
    broken.container_id = "x".into();
    assert_eq!(
        chat_command(&broken, &ChatOperation::Read { agent: "capitano", cursor: None }),
        Err("existing_team_runtime_candidate_invalid")
    );
}

#[test]
pub(super) fn every_reader_of_the_vps_the_app_set_up_goes_through_its_wrapper_and_an_existing_team_through_its_pin() {
    let root = std::env::temp_dir().join(format!("jht-own-vps-read-{}-{}", std::process::id(), line!()));
    let _ = fs::remove_dir_all(&root);
    let scope = AccountScope::synthetic(b"scope-own-read");
    let vps = ExecutionHost::Vps {
        address: "203.0.113.7".into(),
        user: "jht".into(),
        port: 22,
        key_path: "/keys/id_ed25519".into(),
    };
    // a VPS the app set up before the mark existed: nothing saved for the scope, its READS go to the host's wrapper
    assert!(matches!(selected_or_own_at(&root, &scope, &vps), Ok(None)), "no candidate, no selection: read as before");
    mark_own_vps_at(&root, &scope, "203.0.113.7", 22, PINNED_KEY).unwrap();
    assert!(matches!(selected_or_own_at(&root, &scope, &vps), Ok(None)));
    let own = read_command_for(None, &vps).unwrap();
    assert_eq!(own, crate::direct_chat::REMOTE_PYTHON_STDIN);
    assert!(own.contains("grep -Fqx 'JHT_DESKTOP_CHAT_PROTOCOL=1' \"$JHT_BIN\""));
    assert!(own.ends_with("exec \"$JHT_BIN\" desktop-chat python"));
    // an existing team keeps today's command, the pinned container
    let pinned = ActivatedTarget::synthetic_for_tests();
    assert_eq!(read_command_for(Some(pinned.clone()), &vps).unwrap(), python_command(&pinned.runtime).unwrap());
    // a half-saved existing team (a candidate without its selection) stays refused, mark or no mark
    let dir = account_dir(&root, &scope);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(CANDIDATE_FILE), b"{}").unwrap();
    assert_eq!(selected_or_own_at(&root, &scope, &vps).err(), Some("existing_team_runtime_selection_required"));
    // this computer is never «a VPS of one's own»: no wrapper command for it
    assert_eq!(read_command_for(None, &ExecutionHost::Local), Err("existing_team_runtime_required"));
    let _ = fs::remove_dir_all(&root);
}

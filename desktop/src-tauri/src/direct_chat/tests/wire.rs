use super::*;

    #[test]
    fn connect_and_status_never_report_ready_without_a_clean_probe() {
        assert_eq!(status("connecting", None).state, "connecting");
        assert_eq!(
            status("error", Some("tunnel_unavailable")).code,
            Some("tunnel_unavailable")
        );
    }

    #[test]
    fn read_contract_parses_only_the_typed_page() {
        let raw = br#"{"messages":[{"id":"m1","role":"agent","text":"ok","at":1.0}],"cursor":"9"}"#
            .to_vec();
        let page: DirectChatPage = parse_json(
            ProcessResult {
                code: 0,
                stdout: raw,
            },
            "read_failed",
        )
        .unwrap();
        assert_eq!(page.messages[0].id, "m1");
        assert_eq!(page.cursor.as_deref(), Some("9"));
    }

    #[test]
    fn a_system_line_keeps_its_closed_code_and_a_receipt_keeps_its_state() {
        use super::DirectChatReceipt;
        let page: DirectChatPage = serde_json::from_str(
            r#"{"messages":[{"id":"s1","role":"system","text":"x","at":1.0,"code":"mail_not_taken"},{"id":"a1","role":"agent","text":"ok","at":2.0}],"cursor":"3"}"#,
        )
        .unwrap();
        assert_eq!(page.messages[0].code.as_deref(), Some("mail_not_taken"));
        assert_eq!(page.messages[1].code, None);
        let forged: DirectChatPage = serde_json::from_str(
            r#"{"messages":[{"id":"1","role":"system","text":"a","at":1.0,"code":"__proto__"},{"id":"2","role":"system","text":"b","at":2.0,"code":"constructor"},{"id":"3","role":"system","text":"c","at":3.0,"code":7},{"id":"4","role":"system","text":"d","at":4.0,"code":"unknown_code"}]}"#,
        )
        .unwrap();
        assert!(forged.messages.iter().all(|message| message.code.is_none()));
        let shown = serde_json::to_value(&page).unwrap();
        assert_eq!(shown["messages"][0]["code"], "mail_not_taken");
        assert!(shown["messages"][1].get("code").is_none());

        let queued: DirectChatReceipt = serde_json::from_str(
            r#"{"clientMessageId":"c","accepted":true,"messageId":"m","at":2.0,"state":"queued"}"#,
        )
        .unwrap();
        assert_eq!(serde_json::to_value(&queued).unwrap()["state"], "queued");
        let typed: DirectChatReceipt = serde_json::from_str(
            r#"{"clientMessageId":"c","accepted":true,"messageId":"m","at":2.0}"#,
        )
        .unwrap();
        assert!(serde_json::to_value(&typed).unwrap().get("state").is_none());
    }

    #[test]
    fn the_activity_of_the_agent_is_working_or_idle_and_anything_else_is_not_known() {
        let shown = |raw: &str| serde_json::to_value(serde_json::from_str::<DirectChatPage>(raw).unwrap()).unwrap();
        assert_eq!(shown(r#"{"messages":[],"activity":"working"}"#)["activity"], "working");
        assert_eq!(shown(r#"{"messages":[],"activity":"idle"}"#)["activity"], "idle");
        for odd in [r#""busy""#, r#""<b>x</b>""#, r#""WORKING""#, "7", "true", "null", r#"["working"]"#, r#""""#] {
            let page = shown(&format!(r#"{{"messages":[],"activity":{odd}}}"#));
            assert!(page.get("activity").is_none(), "{odd} is not known, never idle");
        }
        assert!(shown(r#"{"messages":[]}"#).get("activity").is_none(), "an older image says nothing");
    }

    #[test]
    fn a_queued_turn_is_watched_only_when_the_team_says_terminal_and_the_page_keeps_plain_ids() {
        let queued: DirectChatReceipt = serde_json::from_str(
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"state":"queued","queue":"terminal"}"#,
        )
        .unwrap();
        assert_eq!(serde_json::to_value(&queued).unwrap()["queue"], "terminal");
        // a mailbox turn has no queue to watch; a word outside the list, or a queue on a typed turn, is dropped
        for written in [
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"state":"queued"}"#,
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"state":"queued","queue":"mailbox"}"#,
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"taken":true,"queue":"terminal"}"#,
            r#"{"accepted":true,"clientMessageId":"c1","messageId":"m1","at":1.0,"state":"queued","queue":7}"#,
        ] {
            let receipt: DirectChatReceipt = serde_json::from_str(written).unwrap();
            assert!(serde_json::to_value(&receipt).unwrap().get("queue").is_none(), "{written}");
        }
        let page: DirectChatPage = serde_json::from_str(
            r#"{"messages":[],"queued":["m1","a b",7,"","<b>x</b>","m2"]}"#,
        )
        .unwrap();
        assert_eq!(page.queued.as_deref(), Some(&["m1".to_owned(), "m2".to_owned()][..]));
        let ended: DirectChatPage = serde_json::from_str(
            r#"{"messages":[],"queued":[],"settled":[{"id":"m1","how":"taken"},{"id":"m2","how":"pending"},{"id":"m3","how":"unconfirmed"},{"id":"m4","how":"expired"},{"id":"m5","how":"sent"},{"id":"a b","how":"taken"},{"id":"m6"},7,{"id":"m7","how":7},{"id":"m8","how":"late"}]}"#,
        )
        .unwrap();
        let shown = serde_json::to_value(&ended).unwrap();
        assert_eq!(
            shown["settled"],
            serde_json::json!([{"id":"m1","how":"taken"},{"id":"m2","how":"pending"},{"id":"m3","how":"unconfirmed"},{"id":"m4","how":"expired"},{"id":"m8","how":"late"}])
        );
        let none: DirectChatPage = serde_json::from_str(r#"{"messages":[],"queued":[],"settled":"taken"}"#).unwrap();
        assert!(serde_json::to_value(&none).unwrap().get("settled").is_none());
        let empty: DirectChatPage = serde_json::from_str(r#"{"messages":[],"queued":[]}"#).unwrap();
        assert_eq!(serde_json::to_value(&empty).unwrap()["queued"], serde_json::json!([]));
        let older: DirectChatPage = serde_json::from_str(r#"{"messages":[]}"#).unwrap();
        assert!(serde_json::to_value(&older).unwrap().get("queued").is_none(), "an older image says nothing");
        let not_a_list: DirectChatPage = serde_json::from_str(r#"{"messages":[],"queued":"m1"}"#).unwrap();
        assert!(serde_json::to_value(&not_a_list).unwrap().get("queued").is_none());
    }

    #[test]
    fn a_message_keeps_only_a_kind_of_its_list_and_a_page_from_an_older_image_has_no_questions() {
        let page: DirectChatPage = serde_json::from_str(
            r#"{"messages":[{"id":"a1","role":"agent","text":"x","at":1.0,"kind":"urgent"},{"id":"a2","role":"agent","text":"y","at":2.0,"kind":"question"},{"id":"a3","role":"agent","text":"z","at":3.0,"kind":"URGENT"},{"id":"a4","role":"agent","text":"w","at":4.0,"kind":7},{"id":"a5","role":"agent","text":"v","at":5.0}]}"#,
        )
        .unwrap();
        let suggested: DirectChatPage = serde_json::from_str(
            r#"{"messages":[{"id":"a1","role":"agent","text":"x","at":1.0,"suggestions":["Sì","No",7,"","a\nb","Dopo","Mai","Forse","Oltre"]},{"id":"a2","role":"agent","text":"y","at":2.0,"suggestions":["Solo una"]},{"id":"s1","role":"system","text":"z","at":3.0,"code":"message_too_long"}]}"#,
        )
        .unwrap();
        // the first five, of which the out-of-shape ones are left out; a single one is no choice
        assert_eq!(suggested.messages[0].suggestions.as_deref(), Some(&["Sì".to_owned(), "No".to_owned()][..]));
        assert_eq!(suggested.messages[1].suggestions, None);
        assert_eq!(suggested.messages[2].code.as_deref(), Some("message_too_long"));
        let kinds: Vec<Option<&str>> = page.messages.iter().map(|m| m.kind.as_deref()).collect();
        assert_eq!(kinds, [Some("urgent"), None, None, None, None]);
        let shown = serde_json::to_value(&page).unwrap();
        assert_eq!(shown["messages"][0]["kind"], "urgent");
        assert!(shown["messages"][1].get("kind").is_none());
        // no `questions` in what the host wrote: none in what the page gets, so it offers no answer
        assert!(shown.get("questions").is_none());
        let empty: DirectChatPage = serde_json::from_str(r#"{"messages":[],"questions":[]}"#).unwrap();
        assert_eq!(serde_json::to_value(&empty).unwrap()["questions"], serde_json::json!([]));
        let not_a_list: DirectChatPage = serde_json::from_str(r#"{"messages":[],"questions":{"id":"q"}}"#).unwrap();
        assert!(serde_json::to_value(&not_a_list).unwrap().get("questions").is_none());
    }

    #[test]
    fn a_question_reaches_the_page_in_its_shape_or_not_at_all() {
        let good = serde_json::json!({
            "id": "aq:capitano:1792700000-a1b2c3", "at": 1792700000.5, "kind": "blocked", "subject": "Il CV",
            "text": "Mando il CV a Acme?", "options": [{"id": "yes", "label": "Sì"}, {"id": "later", "label": "Dopo"}],
            "multiple": false, "free": true, "expiresAt": 1792703600.0, "state": "answered",
            "answer": {"choices": ["yes"], "text": "va bene", "at": 1792700100.0, "origin": "user", "seenAt": null}
        });
        let page = |question: serde_json::Value| -> serde_json::Value {
            let page: DirectChatPage = serde_json::from_value(serde_json::json!({"messages": [], "questions": [question]})).unwrap();
            serde_json::to_value(&page).unwrap()["questions"].clone()
        };
        let shown = page(good.clone());
        assert_eq!(shown[0], good, "a question in its shape passes as it is");
        // asked in plain words: an empty list of options, no buttons, and it still reaches the page
        let mut plain = good.clone();
        plain["id"] = serde_json::json!("pm:11");
        plain["options"] = serde_json::json!([]);
        plain["free"] = serde_json::json!(false);
        plain["state"] = serde_json::json!("open");
        plain.as_object_mut().unwrap().remove("answer");
        assert_eq!(page(plain.clone()), serde_json::json!([plain]), "a question with no options passes as it is");
        // one field out of its shape: the question is left out whole
        for (field, value) in [
            ("id", serde_json::json!("aq capitano")),
            ("id", serde_json::json!(7)),
            ("state", serde_json::json!("closed")),
            ("text", serde_json::json!("x".repeat(4001))),
            ("at", serde_json::json!(-1)),
            ("options", serde_json::json!([{"id": "Yes!", "label": "Sì"}])),
            ("options", serde_json::json!([{"id": "a", "label": "A"}, {"id": "a", "label": "B"}])),
            ("options", serde_json::json!((0..9).map(|i| serde_json::json!({"id": format!("o{i}"), "label": "x"})).collect::<Vec<_>>())),
            ("answer", serde_json::json!({"choices": ["maybe"], "at": 1.0, "origin": "user", "seenAt": null})),
        ] {
            let mut bad = good.clone();
            bad[field] = value;
            assert_eq!(page(bad), serde_json::json!([]), "{field}");
        }
        // a kind or an origin outside its list is the plain one, never another person's answer
        let mut odd = good.clone();
        odd["kind"] = serde_json::json!("urgentissimo");
        odd["answer"]["origin"] = serde_json::json!("scadenza");
        let shown = page(odd);
        assert_eq!(shown[0]["kind"], "question");
        assert_eq!(shown[0]["answer"]["origin"], "unknown");
        // the system's own closing is said as the system's
        let mut closed = good.clone();
        closed["answer"]["origin"] = serde_json::json!("system");
        assert_eq!(page(closed)[0]["answer"]["origin"], "system");
        // a subject too long is no subject; the question stays
        let mut long = good;
        long["subject"] = serde_json::json!("s".repeat(201));
        assert!(page(long)[0].get("subject").is_none());
    }

    #[test]
    fn a_receipt_says_taken_only_with_a_boolean_and_a_reason_only_when_it_is_not_known() {
        use super::DirectChatReceipt;
        let receipt = |extra: &str| -> serde_json::Value {
            let parsed: DirectChatReceipt =
                serde_json::from_str(&format!(r#"{{"clientMessageId":"c","accepted":true,"messageId":"m","at":2.0{extra}}}"#)).unwrap();
            serde_json::to_value(&parsed).unwrap()
        };
        assert!(receipt("").get("taken").is_none(), "an older image says nothing of the composer");
        assert_eq!(receipt(r#","taken":true"#)["taken"], true);
        assert_eq!(receipt(r#","taken":false"#)["taken"], false);
        let unknown = receipt(r#","taken":null,"reason":"menu""#);
        assert!(unknown["taken"].is_null() && unknown.get("taken").is_some());
        assert_eq!(unknown["reason"], "menu");
        assert_eq!(receipt(r#","taken":null,"reason":"unconfirmed""#)["reason"], "unconfirmed");
        // anything but a boolean is «not known», never «taken»
        for odd in [r#","taken":"yes""#, r#","taken":1"#, r#","taken":{}"#] {
            let shown = receipt(odd);
            assert!(shown.get("taken").is_some() && shown["taken"].is_null(), "{odd}");
        }
        // a reason outside the list, or with a known outcome, is not said
        assert!(receipt(r#","taken":null,"reason":"<b>menu</b>""#).get("reason").is_none());
        assert!(receipt(r#","taken":null,"reason":"agent_busy""#).get("reason").is_none());
        assert!(receipt(r#","taken":false,"reason":"menu""#).get("reason").is_none());
        assert!(receipt(r#","reason":"menu""#).get("reason").is_none());
    }

    #[test]
    fn an_answer_leaves_with_checked_options_and_words_on_standard_input_only() {
        let line = |choices: &[&str], text: Option<&str>| {
            let owned: Vec<String> = choices.iter().map(|c| (*c).to_owned()).collect();
            answer_input(&owned, text).map(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).unwrap())
        };
        assert_eq!(line(&["yes"], None).unwrap(), serde_json::json!({"choices": ["yes"], "text": null}));
        assert_eq!(line(&[], Some("  ci penso io  ")).unwrap(), serde_json::json!({"choices": [], "text": "ci penso io"}));
        assert_eq!(line(&["a", "b"], Some("e anche")).unwrap()["choices"], serde_json::json!(["a", "b"]));
        let long = "w".repeat(2001);
        let nine: Vec<String> = (0..9).map(|i| format!("o{i}")).collect();
        let nine: Vec<&str> = nine.iter().map(String::as_str).collect();
        for (choices, text) in [
            (&[][..], None),
            (&[][..], Some("   ")),
            (&["Yes"][..], None),
            (&["a b"][..], None),
            (&["a", "a"][..], None),
            (&nine[..], None),
            (&["yes"][..], Some(long.as_str())),
            (&["yes"][..], Some("a\0b")),
        ] {
            assert_eq!(line(choices, text).unwrap_err().code, "invalid_request", "{choices:?} {text:?}");
        }
    }

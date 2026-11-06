use super::*;

#[test]
pub(super) fn positions_request_is_closed_and_supports_complete_filter_shape() {
    let request: PositionsRequest = serde_json::from_value(json!({
        "op": "list",
        "filters": {
            "statuses": ["scored"],
            "remoteTypes": ["full_remote"],
            "verdicts": ["PASS"],
            "families": ["Data"],
            "countries": ["IT"],
            "cities": ["IT|Rome"],
            "scoreBands": [{"lo": 80, "hi": 100}],
            "unscored": false,
            "criticBands": [{"lo": 7, "hi": 10}],
            "criticUnscored": false,
            "writeRequested": true,
            "q": "JHT-42",
            "limit": 50,
            "offset": 0,
            "sort": "score",
            "dir": "desc"
        }
    }))
    .expect("complete filter request parses");
    assert!(request.valid());

    let unknown = serde_json::from_value::<PositionsRequest>(json!({
        "op": "list", "filters": null, "sql": "SELECT 1"
    }));
    assert!(unknown.is_err());
    let malformed = serde_json::from_value::<PositionsRequest>(json!({
        "op": "detail", "id": 42
    }));
    assert!(malformed.is_err());
}

#[test]
pub(super) fn positions_requests_the_desktop_pages_send_are_accepted_by_the_strict_decoder() {
    // The exact payloads the Positions and Position pages put on the wire
    // (desktop/src/pages/positions/existing-team-readonly.test.tsx records
    // the first one): a refusal here would be a request nobody can read.
    for payload in [
        // the Positions page, default view, first and later page (desktop test pins the same)
        json!({"op": "list", "filters": {"limit": 50, "offset": 0, "sort": "found_at", "dir": "desc", "scoredOnly": true, "hideExcluded": true, "scam": "hide"}}),
        json!({"op": "list", "filters": {"limit": 25, "offset": 25, "sort": "found_at", "dir": "desc", "scoredOnly": true, "hideExcluded": true, "scam": "only"}}),
        json!({"op": "list", "filters": {"limit": 600, "offset": 600, "sort": "found_at", "dir": "desc"}}),
        json!({"op": "list", "filters": {"q": "row 07", "sort": "score", "dir": "asc", "limit": 100, "offset": 0}}),
        json!({"op": "list", "filters": {
            "statuses": ["scored", "ready"], "remoteTypes": ["full_remote"], "sources": ["board-a"],
            "verdicts": ["PASS"], "families": ["Data"], "countries": ["IT"], "cities": ["IT|Rome"],
            "scoreBands": [{"lo": 80.5, "hi": 99.5}], "unscored": true,
            "criticBands": [{"lo": 7.5, "hi": 9.5}], "criticUnscored": true,
            "writeRequested": false, "scoredOnly": true, "hideExcluded": false,
            "q": "x", "limit": 600, "offset": 0, "sort": "found_at", "dir": "desc"
        }}),
        json!({"op": "detail", "id": "101"}),
        json!({"op": "facets"}),
        json!({"op": "stats"}),
    ] {
        let request = parse_positions_request(payload.clone())
            .unwrap_or_else(|()| panic!("the decoder refused {payload}"));
        let wire = serde_json::to_vec(&request).expect("request serializes");
        assert!(wire.len() <= 8192);
        // what the native side forwards is what the page asked, nothing added or dropped
        assert_eq!(serde_json::from_slice::<Value>(&wire).expect("wire is json"), payload);
    }
}

#[test]
pub(super) fn piles_is_a_closed_read_only_op_that_answers_five_counts_and_nothing_else() {
    assert!(matches!(parse_positions_request(json!({"op": "piles"})), Ok(PositionsRequest::Piles)));
    // like stats: whatever else a caller adds is gone before the reader, which refuses it anyway
    let forwarded = parse_positions_request(json!({"op": "piles", "filters": {}, "id": "1"}))
        .map(|request| serde_json::to_value(request).expect("request serializes"));
    assert_eq!(forwarded, Ok(json!({"op": "piles"})));
    assert!(PositionsRequest::Piles.valid());
    let good = json!({"ok": true, "data": {"scout": 3, "analisti": 1, "scorer": 2, "scrittori": 7, "critici": 0}});
    assert!(valid_positions_reply(&PositionsRequest::Piles, &good));
    for broken in [
        json!({"ok": true, "data": {"scout": 3, "analisti": 1, "scorer": 2, "scrittori": 7}}),
        json!({"ok": true, "data": {"scout": 3, "analisti": 1, "scorer": 2, "scrittori": 7, "critici": 0, "rows": []}}),
        json!({"ok": true, "data": {"scout": -1, "analisti": 1, "scorer": 2, "scrittori": 7, "critici": 0}}),
        json!({"ok": true, "data": {"scout": 1.5, "analisti": 1, "scorer": 2, "scrittori": 7, "critici": 0}}),
        json!({"ok": true, "data": {"scout": "3", "analisti": 1, "scorer": 2, "scrittori": 7, "critici": 0}}),
        json!({"ok": true, "data": {"scout": 3, "analisti": 1, "scorer": 2, "scrittori": 7, "critici": null}}),
        json!({"ok": true, "data": {"scout": 3, "analisti": 1, "scorer": 2, "scrittori": 7, "other": 0}}),
        json!({"ok": true, "data": [3, 1, 2, 7, 0]}),
        json!({"ok": true, "data": null}),
        json!({"ok": true, "data": {"scout": 0, "analisti": 0, "scorer": 0, "scrittori": 0, "critici": 0}, "extra": 1}),
    ] {
        assert!(!valid_positions_reply(&PositionsRequest::Piles, &broken), "{broken}");
    }
    // the reader knows the op, takes no field but `op`, and every kind of read has its name in the load-times log
    assert!(POSITIONS_READ_PY.contains("if op=='piles':"));
    assert!(POSITIONS_READ_PY.contains("('facets','stats','piles','profile','cloud_sync','directives','team_activity_log') and set(req)!={'op'}"));
    assert_eq!(crate::runtime_log::POSITIONS_READ_KINDS[9], "piles");
    assert_eq!(PositionsRequest::Piles.op(), "piles");
}

#[test]
pub(super) fn stats_is_a_closed_read_only_op_with_a_composite_reply() {
    assert!(matches!(parse_positions_request(json!({"op": "stats"})), Ok(PositionsRequest::Stats)));
    // serde keeps a unit variant open to extra keys (as it does for `facets`),
    // but the core forwards the parsed request, never the received one: whatever
    // a caller adds is gone before it reaches the reader, which refuses it anyway
    let forwarded = parse_positions_request(json!({"op": "stats", "filters": {}, "id": "1"}))
        .map(|request| serde_json::to_value(request).expect("request serializes"));
    assert_eq!(forwarded, Ok(json!({"op": "stats"})));

    let part = json!({"rows": [], "included": 0, "of": 0});
    let good = json!({"ok": true, "data": {
        "stats": {}, "distribution": {}, "sources": [], "types": [], "recent": [],
        "points": part, "events": part
    }});
    assert!(valid_positions_reply(&PositionsRequest::Stats, &good));
    for broken in [
        json!({"ok": true, "data": {"items": []}}),
        json!({"ok": true, "data": {"stats": {}, "distribution": {}, "sources": [], "types": [], "recent": [], "points": part}}),
        json!({"ok": true, "data": {"stats": [], "distribution": {}, "sources": [], "types": [], "recent": [], "points": part, "events": part}}),
        json!({"ok": true, "data": {"stats": {}, "distribution": {}, "sources": [], "types": [], "recent": [],
            "points": {"rows": [], "included": -1, "of": 0}, "events": part}}),
    ] {
        assert!(!valid_positions_reply(&PositionsRequest::Stats, &broken), "{broken}");
    }
    // the Python reader serves this op and nothing else under it
    assert!(POSITIONS_READ_PY.contains("if op=='stats':"));
    assert!(POSITIONS_READ_PY.contains("mode=ro"));
}

// ---- the checks of the pinned container, not repeated for a few seconds ----

#[test]
pub(super) fn the_globes_read_is_a_closed_read_only_op_with_a_closed_reply() {
    assert!(matches!(parse_positions_request(json!({"op": "map"})), Ok(PositionsRequest::Map { offset: 0 })));
    let forwarded = parse_positions_request(json!({"op": "map", "offset": 5000}))
        .map(|request| serde_json::to_value(request).expect("request serializes"));
    assert_eq!(forwarded, Ok(json!({"op": "map", "offset": 5000})));
    // what is not an offset, or comes with something else, never reaches the reader
    for bad in [
        json!({"op": "map", "offset": -1}),
        json!({"op": "map", "offset": "0"}),
        json!({"op": "map", "offset": 1_000_001}),
        json!({"op": "map", "filters": {}}),
        json!({"op": "map", "id": "1"}),
        json!({"op": "list", "offset": 0}),
    ] {
        assert!(parse_positions_request(bad.clone()).is_err(), "{bad}");
    }
    let request = PositionsRequest::Map { offset: 0 };
    let good = json!({"ok": true, "data": {"items": [{"id": "1"}], "total": 1, "next": null}});
    assert!(valid_positions_reply(&request, &good));
    assert!(valid_positions_reply(&request, &json!({"ok": true, "data": {"items": [], "total": 9, "next": 4}})));
    for broken in [
        json!({"ok": true, "data": {"items": [{"id": "1"}], "total": 1}}),
        json!({"ok": true, "data": {"items": ["x"], "total": 1, "next": null}}),
        json!({"ok": true, "data": {"items": [], "total": -1, "next": null}}),
        json!({"ok": true, "data": {"items": [], "total": 1, "next": "2"}}),
        json!({"ok": true, "data": {"items": [], "total": 1, "next": null, "extra": 1}}),
        json!({"ok": true, "data": [] }),
    ] {
        assert!(!valid_positions_reply(&request, &broken), "{broken}");
    }
    assert!(POSITIONS_READ_PY.contains("if op=='map':"));
    // it reads the positions' light columns, never the description
    let reader = POSITIONS_READ_PY.split("if op=='map':").nth(1).unwrap().split("filters=req.get").next().unwrap();
    assert!(!reader.contains("jd_text") && !reader.contains("p.*"));
}

#[test]
pub(super) fn the_team_activity_read_takes_only_a_closed_range_of_days_and_answers_the_shape_the_page_expects() {
    let good = json!({"op": "team_activity", "from": "2026-10-05", "to": "2026-10-15"});
    let parsed = parse_positions_request(good.clone()).unwrap();
    assert_eq!(parsed.op(), "team_activity");
    assert_eq!(serde_json::to_value(&parsed).unwrap(), good);
    for bad in [
        json!({"op": "team_activity"}),
        json!({"op": "team_activity", "from": "2026-10-05"}),
        json!({"op": "team_activity", "from": "2026-10-15", "to": "2026-10-05"}),
        json!({"op": "team_activity", "from": "2026-10-5", "to": "2026-10-15"}),
        json!({"op": "team_activity", "from": "2026-10-05", "to": "2026-10-15", "limit": 3}),
        json!({"op": "team_activity", "from": "2026-10-05\n", "to": "2026-10-15"}),
        json!({"op": "team_activity", "from": "x026-10-05", "to": "2026-10-15"}),
    ] {
        assert!(parse_positions_request(bad.clone()).is_err(), "{bad}");
    }
    let request = parsed;
    let ok = json!({"ok": true, "data": {"daily": [], "newest": [{"role": "scout"}], "seen": [], "meta": {}}});
    assert!(valid_positions_reply(&request, &ok));
    for broken in [
        json!({"ok": true, "data": {"daily": [], "newest": [], "seen": []}}),
        json!({"ok": true, "data": {"daily": [], "newest": [], "seen": [], "meta": [], "extra": 1}}),
        json!({"ok": true, "data": {"daily": [1], "newest": [], "seen": [], "meta": {}}}),
        json!({"ok": true, "data": {"daily": {}, "newest": [], "seen": [], "meta": {}}}),
        json!({"ok": false, "error": "positions_unavailable"}),
    ] {
        assert!(!valid_positions_reply(&request, &broken), "{broken}");
    }
    // the reader that runs on the host takes the range as a parameter, reads read-only and never `SELECT *`
    let reader = POSITIONS_READ_PY.split("if op=='team_activity':").nth(1).unwrap().split("if op=='map':").next().unwrap();
    assert!(!reader.contains("SELECT *") && !reader.contains("p.*"));
    assert!(reader.contains("(first,last)"));
}

#[test]
pub(super) fn the_board_read_takes_no_argument_and_answers_a_list_of_rows() {
    let parsed = parse_positions_request(json!({"op": "directives"})).unwrap();
    assert_eq!(parsed.op(), "directives");
    assert_eq!(serde_json::to_value(&parsed).unwrap(), json!({"op": "directives"}));
    // a key it does not take is never sent on: what goes to the reader is the request alone
    for extra in [
        json!({"op": "directives", "id": "3"}),
        json!({"op": "directives", "filters": {}}),
        json!({"op": "directives", "from": "2026-10-01", "to": "2026-10-02"}),
    ] {
        if let Ok(kept) = parse_positions_request(extra.clone()) {
            assert_eq!(serde_json::to_value(&kept).unwrap(), json!({"op": "directives"}), "{extra}");
        }
    }
    assert!(valid_positions_reply(&parsed, &json!({"ok": true, "data": {"items": [{"id": 1, "body": "x"}]}})));
    for broken in [
        json!({"ok": true, "data": {"items": [1]}}),
        json!({"ok": true, "data": {"rows": []}}),
        json!({"ok": true, "data": []}),
    ] {
        assert!(!valid_positions_reply(&parsed, &broken), "{broken}");
    }
    let reader = POSITIONS_READ_PY.split("if op=='directives':").nth(1).unwrap().split("if op=='team_activity':").next().unwrap();
    assert!(!reader.contains("SELECT *") && reader.contains("LIMIT"));
    // every kind of read has its name in the load-times log
    assert_eq!(crate::runtime_log::POSITIONS_READ_KINDS[8], "directives");
}

#[test]
pub(super) fn the_activity_log_read_takes_no_argument_and_answers_a_list_of_rows() {
    let parsed = parse_positions_request(json!({"op": "team_activity_log"})).unwrap();
    assert_eq!(parsed.op(), "team_activity_log");
    assert_eq!(crate::runtime_log::POSITIONS_READ_KINDS[10], "team_activity_log");
    // like piles: whatever else a caller adds is gone before the reader, which refuses it anyway
    for extra in [
        json!({"op": "team_activity_log", "from": "2026-10-01", "to": "2026-10-02"}),
        json!({"op": "team_activity_log", "limit": 3}),
        json!({"op": "team_activity_log", "id": "1"}),
    ] {
        let forwarded = parse_positions_request(extra.clone()).map(|request| serde_json::to_value(request).expect("request serializes"));
        assert_eq!(forwarded, Ok(json!({"op": "team_activity_log"})), "{extra}");
    }
    assert!(POSITIONS_READ_PY.contains("'directives','team_activity_log') and set(req)!={'op'}"));
    assert!(valid_positions_reply(&parsed, &json!({"ok": true, "data": {"items": [{"role": "scout", "ts": "2026-10-01"}]}})));
    for broken in [json!({"ok": true, "data": {"rows": []}}), json!({"ok": true, "data": []}), json!({"ok": true, "data": {"items": [1]}})] {
        assert!(!valid_positions_reply(&parsed, &broken), "{broken}");
    }
    // it reads the five sources' time columns and the position's title, company and number, never a whole row
    let reader = POSITIONS_READ_PY.split("if op=='team_activity_log':").nth(1).unwrap().split("if op=='team_activity':").next().unwrap();
    assert!(!reader.contains("SELECT *") && !reader.contains("jd_text") && reader.contains("LIMIT") && reader.contains("BUDGET"));
}

#[test]
pub(super) fn the_positions_list_carries_the_office_coordinates_only_when_they_are_on_the_globe() {
    let keys = POSITIONS_READ_PY.split("LIST_KEYS=(").nth(1).unwrap().split(')').next().unwrap();
    for key in ["'office_lat'", "'office_lon'", "'office_address'"] {
        assert!(keys.contains(key), "{key} in LIST_KEYS");
    }
    // checked, not passed through: a value off the globe, garbled or absent is None
    assert!(POSITIONS_READ_PY.contains("'office_lat':coord(position.get('office_lat'),90)"));
    assert!(POSITIONS_READ_PY.contains("'office_lon':coord(position.get('office_lon'),180)"));
    assert!(POSITIONS_READ_PY.contains("'office_address':text(position.get('office_address'),160)"));
    assert!(POSITIONS_READ_PY.contains("value==value and -limit<=value<=limit"));
}

#[test]
pub(super) fn the_positions_list_carries_the_scam_signals_checked_and_filters_on_them() {
    let keys = POSITIONS_READ_PY.split("LIST_KEYS=(").nth(1).unwrap().split(')').next().unwrap();
    assert!(keys.contains("'scam_signals'"));
    // checked, not passed through: only the known codes survive, and the bucket is recomputed
    assert!(POSITIONS_READ_PY.contains("'scam_signals':scam(row.get('scam_signals'))"));
    assert!(POSITIONS_READ_PY.contains("SCAM_FAMILY={'same_text_many_places':'text'"));
    assert!(POSITIONS_READ_PY.contains("if filters.get('scam') not in (None,'hide','only'): return None"));
    // the count of the section is over everything the other filters match, whichever view is asked
    assert!(POSITIONS_READ_PY.contains("if section: section_total+=1"));
    for value in ["hide", "only"] {
        let request = parse_positions_request(json!({"op": "list", "filters": {"scam": value}}))
            .expect("a scam filter parses");
        assert_eq!(
            serde_json::to_value(request).unwrap(),
            json!({"op": "list", "filters": {"scam": value}})
        );
    }
    assert!(parse_positions_request(json!({"op": "list", "filters": {"scam": "all"}})).is_err());
}

#[test]
pub(super) fn positions_request_omits_absent_filter_options() {
    let request = parse_positions_request(json!({
        "op": "list", "filters": {"q": "engineer"}
    }))
    .expect("query-only request parses");
    let cloned = request.clone();
    assert_eq!(
        serde_json::to_value(cloned).expect("request serializes"),
        json!({"op": "list", "filters": {"q": "engineer"}})
    );
}

#[test]
pub(super) fn positions_request_rejects_explicit_null_before_serde_normalizes_it() {
    let absent =
        parse_positions_request(json!({"op": "list"})).expect("absent filters remain allowed");
    assert_eq!(
        serde_json::to_value(absent).expect("absent filters serialize"),
        json!({"op": "list"})
    );
    assert!(parse_positions_request(json!({"op": "list", "filters": {"q": null}})).is_err());
    assert!(parse_positions_request(json!({"op": "list", "filters": null})).is_err());
}

#[test]
pub(super) fn embedded_reader_has_fixed_composite_position_projections() {
    for field in [
        "'position':map_position(raw,full=True)",
        "'score':map_score(score) if score else None",
        "'highlights':highlights",
        "'company':map_company(company) if company else None",
        "'application':map_application(application) if application else None",
        "'tickets':tickets",
        "'userNote':note",
        "'exclusionEventAt':excluded.get('ts') if excluded else None",
        "'data':{'items':rows}",
        // the ID column sorts by what the table shows: a row without a legacy id by its own id
        "return legacy if legacy is not None else (int(item['id'])",
        // `stats` is cut to a byte budget, whatever the text of the rows weighs once serialized
        "BUDGET=1363148",
        // the list is a light projection with the matching total, so a page of it
        // stays far under the 2 MiB the core accepts back
        "'data':{'items':[light(item) for item in window],'total':len(rows),'scamSection':section_total}",
        // the sidebar's source list is counted from the facets, one light reply
        "'critic_score':row[8],'source':row[9]}",
    ] {
        assert!(POSITIONS_READ_PY.contains(field), "missing {field}");
    }
    assert!(POSITIONS_READ_PY.contains("mode=ro"));
    assert!(POSITIONS_READ_PY.contains("PRAGMA query_only=ON"));
    assert!(!POSITIONS_READ_PY.contains("req.get('sql')"));
}

#[test]
pub(super) fn a_detail_read_of_this_computers_team_carries_the_token_to_write_with_and_no_other_read_or_team_does() {
    let detail = PositionsRequest::Detail { id: "42".into() };
    let body = json!({"position":{},"score":null,"highlights":[],"company":null,"application":null,"tickets":[],"userNote":null,"exclusionEventAt":null});
    let said = json!({"ok": true, "data": body, "ident": [77, 5]}).to_string();
    let with_token = positions_reply_from_output(&detail, exited(0, &said).unwrap(), Some("0123456789abcdef"));
    assert_eq!(with_token["data"]["token"], "0123456789abcdef.77.5");
    assert!(with_token.get("ident").is_none(), "the identity is not passed on as it is");
    // a team on a VPS: the same reader, the same reply, no token
    let vps = positions_reply_from_output(&detail, exited(0, &said).unwrap(), None);
    assert_eq!(vps, json!({"ok": true, "data": body}));
    // a position that is not there has nothing to write to; a database that is not there (0) gives no token
    let none = json!({"ok": true, "data": null, "ident": [77, 5]}).to_string();
    assert_eq!(positions_reply_from_output(&detail, exited(0, &none).unwrap(), Some("0123456789abcdef")), json!({"ok": true, "data": null}));
    let absent = json!({"ok": true, "data": body, "ident": [0, 0]}).to_string();
    assert!(positions_reply_from_output(&detail, exited(0, &absent).unwrap(), Some("0123456789abcdef"))["data"].get("token").is_none());
    // a garbled identity gives no token and does not break the read
    for ident in [json!([1]), json!("1.2"), json!([-1, 5]), json!([1.5, 5]), json!(null)] {
        let garbled = json!({"ok": true, "data": body, "ident": ident}).to_string();
        let reply = positions_reply_from_output(&detail, exited(0, &garbled).unwrap(), Some("0123456789abcdef"));
        assert_eq!(reply, json!({"ok": true, "data": body}), "{ident}");
    }
    // only a detail read is given one: a list that carries an identity is the list, closed as before
    let list = PositionsRequest::List { filters: None };
    let listed = json!({"ok": true, "data": {"items": []}, "ident": [77, 5]}).to_string();
    assert_eq!(positions_reply_from_output(&list, exited(0, &listed).unwrap(), Some("0123456789abcdef")), json!({"ok": true, "data": {"items": []}}));
    // and the reader answers the identity of the file only for a detail
    assert!(POSITIONS_READ_PY.contains("if op=='detail': emit({'ok':True,'data':position_detail(int(req['id']))} if absent else {'ok':True,'data':position_detail(int(req['id'])),'ident':ident})"));
}

#[test]
pub(super) fn positions_reply_requires_composite_data_envelope() {
    let detail = PositionsRequest::Detail { id: "42".into() };
    assert!(valid_positions_reply(
        &detail,
        &json!({"ok":true,"data":{"position":{},"score":null,"highlights":[],"company":null,"application":null,"tickets":[],"userNote":null,"exclusionEventAt":null}})
    ));
    assert!(!valid_positions_reply(
        &detail,
        &json!({"ok":true,"data":{"position":{}}})
    ));

    let list = PositionsRequest::List { filters: None };
    assert!(valid_positions_reply(
        &list,
        &json!({"ok":true,"data":{"items":[{}]}})
    ));
    assert!(!valid_positions_reply(&list, &json!({"ok":true,"data":[]})));
}

use super::*;
use std::{
    ffi::OsString,
    time::{SystemTime, UNIX_EPOCH},
};
fn base(op: &str) -> Value {
    json!({"op":op,"mission_id":"a".repeat(32),"position_id":41,"owner_id":"b".repeat(32),"generation":1})
}
fn host() -> ExecutionHost {
    ExecutionHost::Vps {
        address: "example.invalid".into(),
        user: "synthetic".into(),
        port: 22,
        key_path: "/synthetic/key".into(),
    }
}
fn pin() -> RuntimePin {
    RuntimePin {
        container_id: "c".repeat(64),
        oci_revision: REVISION.into(),
        image_id: format!("sha256:{}", "d".repeat(64)),
        digest: DIGEST.into(),
    }
}
#[test]
fn strict_requests_have_no_transport_selectors_or_implicit_fields() {
    assert!(parse_request(json!({"op":"descriptor"})).is_ok());
    for key in [
        "host",
        "path",
        "port",
        "argv",
        "runtime",
        "container_id",
        "body",
        "mission_id",
    ] {
        let mut v = json!({"op":"descriptor"});
        v[key] = json!("spoof");
        assert!(parse_request(v).is_err(), "{key}");
    }
    for v in [
        json!(null),
        json!([]),
        json!({"op":"admit"}),
        json!({"op":"descriptor","owner_id":null}),
        base("confirm"),
        base("input"),
    ] {
        assert!(parse_request(v).is_err());
    }
    for op in ["confirm", "handoff"] {
        let mut v = base(op);
        v["review_id"] = Value::Null;
        assert_eq!(parse_request(v.clone()).unwrap().wire_value().unwrap(), v);
        v["review_id"] = json!("c".repeat(32));
        assert_eq!(parse_request(v.clone()).unwrap().wire_value().unwrap(), v);
        v["review_id"] = json!(false);
        assert!(parse_request(v).is_err());
    }
    for op in ["observe", "finish", "abandon"] {
        assert!(parse_request(base(op)).is_ok());
    }
    for (key, values) in [
        ("generation", vec![json!(true), json!(0), json!(2)]),
        (
            "position_id",
            vec![json!(false), json!(-1), json!(0), json!(1.1)],
        ),
        (
            "mission_id",
            vec![
                json!("A".repeat(32)),
                json!("../file"),
                json!("a".repeat(33)),
            ],
        ),
    ] {
        for value in values {
            let mut v = base("observe");
            v[key] = value;
            assert!(parse_request(v).is_err());
        }
    }
}
#[test]
fn typed_input_preserves_observed_binding_and_bounds() {
    let mut v = base("input");
    v["display_id"] = json!("e".repeat(32));
    v["frame_sequence"] = json!(12);
    v["kind"] = json!("key");
    v["key"] = json!("z");
    v["pressed"] = json!(true);
    assert_eq!(
        serde_json::to_value(parse_request(v.clone()).unwrap()).unwrap(),
        v
    );
    for key in ["F12", "XF86Launch1", "\n", "two"] {
        let mut bad = v.clone();
        bad["key"] = json!(key);
        assert!(parse_request(bad).is_err());
    }
    let mut pointer = v.clone();
    pointer.as_object_mut().unwrap().remove("key");
    pointer["kind"] = json!("pointer");
    pointer["x"] = json!(1439);
    pointer["y"] = json!(999);
    pointer["button"] = json!(1);
    assert!(parse_request(pointer.clone()).is_ok());
    for (k, n) in [("x", 1440), ("y", 1000), ("button", 6)] {
        let mut bad = pointer.clone();
        bad[k] = json!(n);
        assert!(parse_request(bad).is_err());
    }
}
#[test]
fn pin_uses_actual_image_and_exact_current_host_never_registry_config() {
    let mut b = Binding {
        schema: 1,
        host: host(),
        browser_runtime: pin(),
    };
    assert!(b.validate(&host()).is_ok());
    assert!(b.validate(&ExecutionHost::Local).is_err());
    let mut other = host();
    if let ExecutionHost::Vps { port, .. } = &mut other {
        *port = 23;
    }
    assert!(b.validate(&other).is_err());
    b.browser_runtime.container_id = "jht".into();
    assert!(b.validate(&host()).is_err());
    b.browser_runtime = pin();
    b.browser_runtime.oci_revision = "0".repeat(40);
    assert!(b.validate(&host()).is_err());
}
#[test]
fn reply_is_flat_whitelisted_and_binding_checked() {
    let r = parse_request(base("observe")).unwrap();
    let mut v = base("observe");
    v.as_object_mut().unwrap().remove("op");
    v["ok"] = json!(true);
    v["queued"] = json!(true);
    v["password"] = json!("must-not-return");
    v["route"] = json!({"path":"private"});
    v["gate_reason"] = json!("");
    let output = public_reply(&serde_json::to_vec(&v).unwrap(), &r).unwrap();
    assert_eq!(output["queued"], true);
    assert!(output.get("password").is_none());
    assert!(output.get("route").is_none());
    v["owner_id"] = json!("f".repeat(32));
    assert!(public_reply(&serde_json::to_vec(&v).unwrap(), &r).is_err());
    assert_eq!(
        public_reply(
            br#"{"ok":false,"error":"raw host /secret","password":"secret"}"#,
            &r
        )
        .unwrap(),
        failure("browser_response_invalid")
    );
    assert!(public_reply(br#"{"ok":true}"#, &r).is_err());
    assert!(public_reply(br#"{"ok":true}partial"#, &r).is_err());
}
#[test]
fn ssh_is_noninteractive_and_only_embedded_code_is_command() {
    let h = ValidatedHost::Vps {
        address: "example.invalid".into(),
        user: "synthetic".into(),
        port: 22,
        key_path: "/synthetic/key".into(),
        known_hosts: "/synthetic/known-hosts".into(),
    };
    let a = ssh_args(&h).unwrap();
    let strings: Vec<_> = a.iter().map(|x| x.to_string_lossy()).collect();
    for value in [
        "-T",
        "RequestTTY=no",
        "BatchMode=yes",
        "StrictHostKeyChecking=yes",
        "ControlPath=none",
    ] {
        assert!(strings.iter().any(|s| s == value));
    }
    assert_eq!(strings[strings.len() - 2], "synthetic@example.invalid");
    assert!(strings
        .last()
        .unwrap()
        .starts_with("python3 -I -c 'exec(bytes.fromhex("));
    assert!(BRIDGE.len() <= 5120);
}
#[cfg(unix)]
#[test]
fn config_file_is_private_bounded_exact_host_and_not_a_symlink() {
    use std::os::unix::fs::PermissionsExt;
    let root = std::env::temp_dir().join(format!(
        "jht281-config-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&root).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    let p = root.join("closer-desktop-binding.json");
    let b = Binding {
        schema: 1,
        host: host(),
        browser_runtime: pin(),
    };
    fs::write(&p, serde_json::to_vec(&b).unwrap()).unwrap();
    fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).unwrap();
    assert!(read_binding(&p, &host()).is_ok());
    fs::set_permissions(&p, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(read_binding(&p, &host()).is_err());
    fs::set_permissions(&p, fs::Permissions::from_mode(0o600)).unwrap();
    let link = root.join("alias");
    std::os::unix::fs::symlink(&p, &link).unwrap();
    assert!(read_binding(&link, &host()).is_err());
    fs::write(&p, vec![b' '; 8193]).unwrap();
    assert!(read_binding(&p, &host()).is_err());
    fs::remove_dir_all(root).unwrap();
}
#[cfg(unix)]
#[test]
fn process_reply_overflow_and_deadline_never_return_partial_json() {
    fn run(script: &str, t: Duration) -> Result<Vec<u8>, &'static str> {
        transport::run_bounded(
            "/bin/sh",
            &[OsString::from("-c"), OsString::from(script)],
            b"{}",
            t,
        )
    }
    assert_eq!(
        run("printf '{\"ok\":true}'", Duration::from_secs(2)).unwrap(),
        br#"{"ok":true}"#
    );
    assert_eq!(
        run(
            "printf '{\"ok\":true}'; exec sleep 1",
            Duration::from_millis(30)
        ),
        Err("browser_transport_timeout")
    );
    assert_eq!(
        run("printf secret >&2; exit 1", Duration::from_secs(2)),
        Err("browser_transport_unavailable")
    );
    assert_eq!(
        run("head -c 3145728 /dev/zero", Duration::from_secs(2))
            .unwrap()
            .len(),
        3145728
    );
    assert_eq!(
        run("head -c 12582913 /dev/zero", Duration::from_secs(3)),
        Err("browser_response_too_large")
    );
}

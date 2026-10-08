"""The portal-secrets broker, phase 1a: store, protocol, mailbox, admin.

Canaries stand in for every password; the IMAP and SMTP servers are fakes.
The socket's SO_PEERCRED check needs Linux and runs in the live test
(`test_broker_socket_live`); here the request path is exercised through
`server.handle`, which is what the socket calls.

Run with: pytest tests/test_broker_core.py -v
"""

import email.message
import io
import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))
sys.path.insert(0, str(ROOT / "shared" / "skills"))

CANARY = "CANARY-broker-mailbox-7d21"
# The rotated app password of the fixtures: a canary like the one above.
ROTATED = "CANARY-rotated-0b9e"


@pytest.fixture
def broker(tmp_path, monkeypatch):
    secrets_dir = tmp_path / "secrets"
    state_dir = tmp_path / "state"
    for d in (secrets_dir, state_dir):
        d.mkdir(mode=0o700)
    monkeypatch.setenv("JHT_BROKER_SECRETS", str(secrets_dir))
    monkeypatch.setenv("JHT_BROKER_STATE", str(state_dir))
    from broker import admin, mailops, server, store

    return type("B", (), {"admin": admin, "mailops": mailops, "server": server, "store": store,
                          "secrets": secrets_dir, "state": state_dir})


def admin_run(broker, argv, stdin=b"", monkeypatch=None):
    out = io.StringIO()
    real_stdout, real_stdin = sys.stdout, sys.stdin
    sys.stdout = out
    sys.stdin = io.TextIOWrapper(io.BytesIO(stdin))
    try:
        code = broker.admin.main(argv)
    finally:
        sys.stdout, sys.stdin = real_stdout, real_stdin
    return code, json.loads(out.getvalue())


def request(broker, op, args=None, role="scout"):
    raw = json.dumps({"op": op, "args": args or {}, "role": role}).encode()
    return broker.server.handle(raw)


def mailbox_json(password=CANARY, **extra):
    return json.dumps({"imap_host": "imap.example.test", "imap_port": 993, "user": "me@example.com",
                       "password": password, "folder": "INBOX", **extra}).encode()


class FakeImap:
    messages: list[bytes] = []

    def select(self, folder, readonly=True):
        return "OK", [b""]

    def search(self, *args):
        return "OK", [b" ".join(str(i + 1).encode() for i in range(len(self.messages)))]

    def fetch(self, uid, what):
        raw = self.messages[int(uid) - 1]
        if "HEADER" in what:
            msg = email.message_from_bytes(raw)
            raw = f"From: {msg['From']}\r\nMessage-ID: {msg['Message-ID']}\r\n\r\n".encode()
        return "OK", [(b"1", raw)]

    def logout(self):
        pass


def make_mail(mid, sender, subject, body, **headers):
    msg = email.message.EmailMessage()
    msg["From"], msg["Subject"], msg["Message-ID"] = sender, subject, mid
    msg["Date"] = "Wed, 08 Oct 2026 10:00:00 +0000"
    for k, v in headers.items():
        msg[k.replace("_", "-")] = v
    msg.set_content(body)
    return msg.as_bytes()


def _core_module():
    """The email_monitor the broker calls: another test file may drop the
    module from sys.modules, and a fresh import would be a different object
    from the one `broker.mailops` already holds."""
    from broker import mailops

    return mailops.email_monitor


@pytest.fixture
def imap(monkeypatch):
    email_monitor = _core_module()

    FakeImap.messages = []
    logins = []

    def connect(creds):
        logins.append(creds["password"])
        return FakeImap()

    monkeypatch.setattr(email_monitor, "_imap_connect", connect)
    return FakeImap, logins


class FakeSmtp:
    sent: list = []

    def __init__(self, host, port, context=None, timeout=None):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def login(self, user, password):
        self.password = password

    def send_message(self, msg):
        FakeSmtp.sent.append(msg)


@pytest.fixture
def smtp(monkeypatch):
    email_monitor = _core_module()

    FakeSmtp.sent = []
    monkeypatch.setattr(email_monitor.smtplib, "SMTP_SSL", FakeSmtp)
    return FakeSmtp


# ── store ────────────────────────────────────────────────────────────────


def test_secrets_are_written_0600_and_never_echoed(broker):
    code, out = admin_run(broker, ["secrets", "set", "email_monitor"], mailbox_json())
    assert code == 0 and out == {"ok": True, "secret": "email_monitor", "state": "present"}
    path = broker.secrets / "email_monitor.json"
    assert oct(path.stat().st_mode & 0o777) == "0o600"
    code, out = admin_run(broker, ["secrets", "status"])
    assert out == {"ok": True, "secrets": {"email_monitor": "present", "email_transport": "absent"}}
    assert CANARY not in json.dumps(out)


def test_the_store_refuses_a_symlink(broker, tmp_path):
    target = tmp_path / "elsewhere.json"
    target.write_text("{}")
    (broker.secrets / "email_monitor.json").symlink_to(target)
    with pytest.raises(broker.store.StoreError) as err:
        broker.store.read_secret("email_monitor")
    assert err.value.code == "store_symlink"


def test_unknown_secret_names_and_fields_are_refused(broker):
    code, out = admin_run(broker, ["secrets", "set", "email_monitor"], mailbox_json(token="x"))
    assert out["reason"] == "secret_unexpected_field"
    assert not (broker.secrets / "email_monitor.json").exists()


# ── protocol ─────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "req,reason",
    [
        ({"op": "secrets.status"}, "unknown_operation"),
        ({"op": "mail.code"}, "unknown_operation"),
        ({"op": "mail.approve", "args": {"draft_id": "x"}}, "unknown_operation"),
        ({"op": "mailbox.allow", "args": {"entry": "@evil.example"}}, "unknown_operation"),
        ({"op": "mail.poll", "args": {"script": "x"}, "role": "scout"}, "unexpected_field"),
        ({"op": "mail.poll", "args": {}, "role": "scout", "url": "https://x"}, "unexpected_field"),
        ({"op": "mail.poll", "args": {"since_days": 99}, "role": "scout"}, "since_days_out_of_range"),
        ({"op": "mail.poll", "args": {}, "role": "scrittore"}, "role_not_allowed"),
        ({"op": "mail.send", "args": {"kind": "application", "subject": "s", "body": "b", "position_id": 1,
                                       "to": ["a@example.com"], "url": "https://x"}, "role": "closer"}, "unexpected_field"),
        ({"op": "mail.send", "args": {"kind": "application", "subject": "s", "body": "b", "position_id": 1,
                                       "to": ["a@example.com", "c@example.org"]}, "role": "closer"},
         "one_recipient_per_application"),
        ({"op": "mail.send", "args": {"kind": "chat", "subject": "s", "body": "b", "to": ["a@example.com"]},
          "role": "closer"}, "role_not_allowed"),
    ],
)
def test_the_socket_refuses_what_is_not_in_the_closed_set(broker, req, reason):
    assert broker.server.handle(json.dumps(req).encode()) == {"ok": False, "reason": reason}


def test_a_role_with_an_instance_suffix_is_its_role():
    from broker.protocol import role_of

    assert role_of("scout-2") == "scout" and role_of("CAPITANO") == "capitano" and role_of("") == ""


# ── mailbox ──────────────────────────────────────────────────────────────


def test_poll_without_a_mailbox_says_so(broker):
    assert request(broker, "mail.poll") == {"ok": False, "reason": "not_configured"}


def test_poll_returns_filtered_reduced_jobs_and_remembers_what_it_saw(broker, imap):
    fake, logins = imap
    admin_run(broker, ["secrets", "set", "email_monitor"], mailbox_json())
    admin_run(broker, ["mailbox", "admission", "whole_mailbox"])
    fake.messages = [
        make_mail("<1@x>", "Indeed <alert@indeed.invalid>", "New jobs 2026",
                  "https://www.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b&tk=abcdef#x"),
        make_mail("<2@x>", "GitHub <noreply@github.invalid>", "Reset your password",
                  "https://github.example/password_reset/abc"),
        make_mail("<3@x>", "Svc <no-reply@svc.invalid>", "Il tuo codice è 482913", "Usalo entro 10 minuti."),
    ]
    out = request(broker, "mail.poll")
    assert out["ok"] and out["withheld"] == 2
    assert [j["url"] for j in out["jobs"]] == ["https://www.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b"]
    assert out["jobs"][0]["subject"] == "New jobs [codice]"
    blob = json.dumps(out)
    assert "password_reset" not in blob and "482913" not in blob and CANARY not in blob
    assert logins == [CANARY]
    again = request(broker, "mail.poll")
    assert again == {"ok": True, "jobs": [], "withheld": 0}


def test_poll_with_an_allowlist_withholds_everyone_else(broker, imap):
    fake, _ = imap
    admin_run(broker, ["secrets", "set", "email_monitor"], mailbox_json())
    admin_run(broker, ["mailbox", "admission", "allowlist"])
    admin_run(broker, ["mailbox", "allow", "add", "alert@indeed.invalid"])
    fake.messages = [
        make_mail("<1@x>", "alert@indeed.invalid", "Jobs", "https://www.indeed.com/viewjob?jk=0a1b2c3d4e5f6a7b"),
        make_mail("<2@x>", "board@niche.invalid", "Jobs", "https://niche.example/jobs/123"),
    ]
    out = request(broker, "mail.poll")
    assert out["withheld"] == 1 and len(out["jobs"]) == 1


def test_status_never_carries_the_password(broker):
    admin_run(broker, ["secrets", "set", "email_monitor"], mailbox_json())
    out = request(broker, "mail.status", role="assistente")
    assert out["ok"] and out["configured"] and out["address"] == "me@example.com"
    assert CANARY not in json.dumps(out)


# ── chat mail: drafts, the own-mailbox exception, the journal ────────────


def chat(broker, to, role="assistente"):
    return request(broker, "mail.send", {"kind": "chat", "to": to, "subject": "Hello", "body": "Body"}, role=role)


def test_chat_mail_becomes_a_draft_and_leaves_only_on_host_approval(broker, smtp):
    admin_run(broker, ["secrets", "set", "email_monitor"], mailbox_json())
    out = chat(broker, ["recruiter@example.com"])
    assert out["ok"] and out["status"] == "pending_user_approval"
    assert smtp.sent == []
    code, drafts = admin_run(broker, ["mail", "drafts"])
    assert [d["id"] for d in drafts["drafts"]] == [out["draft_id"]]
    code, sent = admin_run(broker, ["mail", "approve", out["draft_id"]])
    assert code == 0 and sent["status"] == "sent"
    assert len(smtp.sent) == 1 and smtp.sent[0]["To"] == "recruiter@example.com"
    code, journal = admin_run(broker, ["mail", "journal"])
    assert journal["journal"][-1]["to"] == ["recruiter@example.com"]
    assert admin_run(broker, ["mail", "drafts"])[1]["drafts"] == []


def test_a_draft_can_be_discarded(broker, smtp):
    admin_run(broker, ["secrets", "set", "email_monitor"], mailbox_json())
    draft = chat(broker, ["x@example.net"])["draft_id"]
    assert admin_run(broker, ["mail", "discard", draft])[1]["status"] == "discarded"
    assert admin_run(broker, ["mail", "approve", draft])[1]["reason"] == "draft_not_found"
    assert smtp.sent == []


def test_mail_to_the_saved_account_goes_out_at_once(broker, smtp):
    admin_run(broker, ["secrets", "set", "email_monitor"], mailbox_json())
    out = chat(broker, ["ME@example.com"])
    assert out["status"] == "sent" and len(smtp.sent) == 1


def test_an_address_written_in_jht_home_is_not_the_users(broker, smtp, tmp_path, monkeypatch):
    admin_run(broker, ["secrets", "set", "email_monitor"], mailbox_json())
    home = tmp_path / "jht_home"
    home.mkdir()
    (home / "jht.config.json").write_text(json.dumps({"user": {"email": "attacker@evil.invalid"}}))
    monkeypatch.setenv("JHT_HOME", str(home))
    assert chat(broker, ["attacker@evil.invalid"])["status"] == "pending_user_approval"
    assert smtp.sent == []


def test_application_mail_waits_for_phase_1b(broker):
    admin_run(broker, ["secrets", "set", "email_monitor"], mailbox_json())
    out = request(broker, "mail.send", {"kind": "application", "to": ["hr@example.org"], "subject": "s",
                                        "body": "b", "position_id": 7}, role="closer")
    assert out == {"ok": False, "reason": "application_channel_not_ready"}


# ── migration and rotation (B2) ──────────────────────────────────────────


def envelope(raw, digest=None):
    import base64
    import hashlib

    return json.dumps({"sha256": digest or hashlib.sha256(raw).hexdigest(),
                       "b64": base64.b64encode(raw).decode()}).encode()


def test_import_checks_the_digest_marks_rotation_and_keeps_the_old_policy(broker, smtp):
    raw = mailbox_json(from_filters=[], savedAt="2026-09-01")
    code, out = admin_run(broker, ["secrets", "import-legacy", "email_monitor"], envelope(raw, "0" * 64))
    assert out["reason"] == "digest_mismatch" and not (broker.secrets / "email_monitor.json").exists()
    code, out = admin_run(broker, ["secrets", "import-legacy", "email_monitor"], envelope(raw))
    assert out == {"ok": True, "secret": "email_monitor", "state": "imported", "rotation_pending": True}
    assert admin_run(broker, ["mailbox", "show"])[1]["admission"] == "whole_mailbox"
    assert chat(broker, ["me@example.com"]) == {"ok": False, "reason": "mail_rotation_pending"}
    code, out = admin_run(broker, ["secrets", "set", "email_monitor"], mailbox_json())
    assert out["reason"] == "password_not_rotated"
    code, out = admin_run(broker, ["secrets", "set", "email_monitor"], mailbox_json(password=ROTATED))
    assert out["ok"]
    assert chat(broker, ["me@example.com"])["status"] == "sent"
    state_blob = "".join(p.read_text() for p in broker.state.glob("*.json"))
    assert CANARY not in state_blob and ROTATED not in state_blob


def test_a_legacy_file_is_imported_once_never_again(broker):
    """The agents can write /jht_home/credentials: a file planted there after
    the migration must not replace the user's account."""
    raw = mailbox_json()
    assert admin_run(broker, ["secrets", "import-legacy", "email_monitor"], envelope(raw))[1]["state"] == "imported"
    planted = json.dumps({"user": "attacker@evil.invalid", "password": "x" * 12}).encode()
    out = admin_run(broker, ["secrets", "import-legacy", "email_monitor"], envelope(planted))[1]
    assert out == {"ok": True, "secret": "email_monitor", "state": "already_migrated"}
    assert broker.store.read_secret("email_monitor")["user"] == "me@example.com"


def test_a_legacy_file_after_a_host_setup_is_not_imported(broker):
    code, out = admin_run(broker, ["mailbox", "setup", "--user", "name.jht@gmail.com", "--admission", "allowlist"],
                          (ROTATED + "\n").encode())
    assert out["ok"] and out["admission"] == "allowlist"
    assert broker.store.read_secret("email_monitor")["imap_host"] == "imap.gmail.com"
    planted = json.dumps({"user": "attacker@evil.invalid", "password": "x" * 12}).encode()
    assert admin_run(broker, ["secrets", "import-legacy", "email_monitor"], envelope(planted))[1]["state"] == "already_migrated"
    assert broker.store.read_secret("email_monitor")["user"] == "name.jht@gmail.com"


def test_import_of_a_filtered_mailbox_becomes_an_allowlist(broker):
    raw = mailbox_json(from_filters=["Alert@indeed.invalid"])
    admin_run(broker, ["secrets", "import-legacy", "email_monitor"], envelope(raw))
    show = admin_run(broker, ["mailbox", "show"])[1]
    assert show["admission"] == "allowlist" and show["allow_addresses"] == ["alert@indeed.invalid"]


def test_the_legacy_reader_refuses_a_symlink_and_prints_no_clear_text(tmp_path, monkeypatch, capsys):
    from broker import legacy

    creds = tmp_path / "credentials"
    creds.mkdir()
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    (creds / "email_monitor.json").write_bytes(mailbox_json())
    assert legacy.main(["read", "email_monitor"]) == 0
    printed = capsys.readouterr().out
    assert CANARY not in printed and json.loads(printed)["ok"]
    (creds / "email_monitor.json").unlink()
    (creds / "email_monitor.json").symlink_to(tmp_path / "elsewhere")
    assert legacy.main(["read", "email_monitor"]) == 1
    assert legacy.main(["remove", "email_monitor"]) == 0
    assert not os.path.lexists(creds / "email_monitor.json")


def test_admission_has_only_two_values(broker):
    assert admin_run(broker, ["mailbox", "admission", "off"])[1]["reason"] == "admission_policy_unknown"

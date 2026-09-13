"""
The email application channel of the CLOSER. [JHT-CLOSER-EMAIL]

Found on the operator's VPS: a vacancy whose "Apply" control is a `mailto:`
link, which the CLOSER took first for a form and then for a newsletter field.
Nothing was sent. These tests pin the channel that replaces that guess: the
link is parsed without letting a header in, the user's flag is checked twice,
nothing personal is invented, and one authorisation produces at most one
letter — even when the server never answers.

Synthetic only: stub transport, stub notifier, stub page fetcher, a temporary
JHT_HOME. No real mail server, no real address, no real person.

Run with: pytest tests/test_email_application.py -v
"""

import json
import os
import socket
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS = REPO_ROOT / "shared" / "skills"
RULE = REPO_ROOT / "shared" / "cloud" / "apply-request-rule.json"
sys.path.insert(0, str(SKILLS))

import _db  # noqa: E402
import apply_gate  # noqa: E402
import email_application as ea  # noqa: E402

SECRET = "synthetic-smtp-secret-0000"
HREF = (
    "mailto:jobs@example.com?cc=Team%40Example.COM&subject=Application%20REF-42%20C%2B%2B"
    "&body=Hello%2C%0Aplease%20apply"
)
JD = "We build high availability systems in Python and Go."


class FakeTransport:
    instances = []

    def __init__(self, settings, password):
        self.settings = settings
        self.password = password
        self.opened = False
        self.sent = []
        self.on_open = None
        self.send_error = None
        self.open_error = None
        self.refused = {}
        FakeTransport.instances.append(self)

    def open(self):
        if self.open_error:
            raise self.open_error
        self.opened = True
        if FakeTransport.hook:
            FakeTransport.hook()

    def send(self, message, envelope_from, recipients):
        FakeTransport.sends.append((message, envelope_from, list(recipients)))
        if FakeTransport.send_error:
            raise FakeTransport.send_error
        return dict(FakeTransport.refused)

    def close(self):
        self.opened = False


def _reset_fake():
    FakeTransport.instances = []
    FakeTransport.sends = []
    FakeTransport.hook = None
    FakeTransport.send_error = None
    FakeTransport.refused = {}


@pytest.fixture()
def box(tmp_path, monkeypatch):
    _reset_fake()
    home = tmp_path
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("JHT_DB", str(home / "jobs.db"))
    config = {
        "applications": {
            "auto_apply": {"enabled": True, "max_per_day": 3, "mode": "authorised"},
            "email_transport": {
                "kind": "smtp",
                "host": "smtp.example.com",
                "port": 465,
                "security": "ssl",
                "username": "sender@example.com",
                "from_address": "sender@example.com",
            },
        }
    }
    (home / "jht.config.json").write_text(json.dumps(config))
    creds = home / "credentials"
    creds.mkdir()
    secret = creds / "email_transport.json"
    secret.write_text(json.dumps({"password": SECRET}))
    secret.chmod(0o600)
    (home / "profile").mkdir()
    (home / "profile" / "candidate_profile.yml").write_text(
        "name: Synthetic Candidate\n"
        "target_role: Backend Engineer\n"
        "experience_years: 6\n"
        "contacts:\n  email: candidate@example.com\n  phone: '+00 000 000'\n"
        "skills:\n  primary: [Python, Go, Rust]\n"
    )
    cv = home / "cv.pdf"
    cv.write_bytes(b"%PDF-1.4 synthetic cv")
    conn = sqlite3.connect(home / "jobs.db")
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.executemany(
        "INSERT INTO positions (id, title, company, url, status, jd_text, "
        "apply_requested, apply_requested_at, apply_requested_by) VALUES (?,?,?,?,?,?,?,?,?)",
        [
            (1, "Synthetic Backend Engineer", "Example Widgets", "https://example.com/jobs/1", "ready", JD, 1, "2026-09-13T08:00:00.000Z", "user_web"),
            (2, "Other role", "Example Widgets", "https://example.com/jobs/2", "ready", JD, 0, None, None),
        ],
    )
    conn.execute("INSERT INTO applications (position_id, cv_pdf_path) VALUES (1, ?)", (str(cv),))
    conn.execute("INSERT INTO applications (position_id, cv_pdf_path) VALUES (2, ?)", (str(cv),))
    conn.commit()
    conn.close()
    write_checkpoint(home, HREF)
    return home


def write_checkpoint(home, href, url="https://example.com/jobs/1"):
    path = apply_gate.checkpoint_path(1, home)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"channel": "email", "mailto_href": href, "url": url, "state": "email_channel"}))


def flow(home, **kwargs):
    notes = kwargs.pop("notes", [])
    return ea.EmailApplication(
        1,
        jht_home=home,
        db_path=home / "jobs.db",
        transports={"smtp": FakeTransport},
        notifier=lambda **kw: notes.append(kw) or "1",
        fetcher=kwargs.pop("fetcher", lambda url: (_ for _ in ()).throw(AssertionError("no fetch expected"))),
        **kwargs,
    )


def sql(home, query, params=()):
    conn = sqlite3.connect(home / "jobs.db")
    try:
        rows = conn.execute(query, params).fetchall()
        conn.commit()
        return rows
    finally:
        conn.close()


def set_jd(home, text):
    sql(home, "UPDATE positions SET jd_text = ? WHERE id = 1", (text,))


# ── The mailto link ──────────────────────────────────────────────────────────


def test_mailto_decodes_to_cc_subject_body():
    m = ea.parse_mailto(HREF)
    assert m.to == "jobs@example.com"
    assert m.cc == ("Team@example.com",)
    assert m.subject == "Application REF-42 C++"
    assert m.body == "Hello,\nplease apply"


def test_mailto_plus_is_literal_and_to_query_counts():
    assert ea.parse_mailto("MAILTO:a+tag%40Example.COM").to == "a+tag@example.com"
    with pytest.raises(ea.MailtoError) as err:
        ea.parse_mailto("mailto:a@example.com?to=b@example.com")
    assert err.value.reason == "recipient_ambiguous"


@pytest.mark.parametrize(
    "href,reason",
    [
        ("https://example.com/apply", "mailto_invalid"),
        ("mailto:", "recipient_ambiguous"),
        ("mailto:a@example.com,b@example.com", "recipient_ambiguous"),
        ("mailto:Jane%20Doe%20%3Ca@example.com%3E", "recipient_ambiguous"),
        ("mailto:a@example.com?bcc=spy@example.com", "mailto_invalid"),
        ("mailto:a@example.com?from=boss@example.com", "mailto_invalid"),
        ("mailto:a@example.com?reply-to=x@example.com", "mailto_invalid"),
        ("mailto:a@example.com?subject=a&subject=b", "mailto_invalid"),
        ("mailto:a@example.com?subject=Hi%0ABcc:%20spy@example.com", "mailto_invalid"),
        ("mailto:a@example.com%0D%0ABcc:spy@example.com", "mailto_invalid"),
        ("mailto:a@example.com?cc=b@example.com%0Abcc:c@example.com", "mailto_invalid"),
        ("mailto:a@example.com\nBcc: spy@example.com", "mailto_invalid"),
        ("mailto:a@example.com?subject=100%", "mailto_invalid"),
        ("mailto:a@example.com#frag", "mailto_invalid"),
        ("mailto:a@example.com?cc=" + ",".join(f"c{i}@example.com" for i in range(6)), "recipient_ambiguous"),
    ],
)
def test_mailto_refuses_ambiguity_and_header_injection(href, reason):
    with pytest.raises(ea.MailtoError) as err:
        ea.parse_mailto(href)
    assert err.value.reason == reason


# ── inspect / preflight / draft ──────────────────────────────────────────────


def test_inspect_reads_the_raw_link_from_the_browser_checkpoint(box):
    out = flow(box).inspect()
    assert (out.state, out.data["source"], out.data["to"]) == ("inspected", "checkpoint", "jobs@example.com")


def test_inspect_falls_back_to_the_public_page_read_only(box):
    apply_gate.checkpoint_path(1, box).unlink()
    page = b'<a href="mailto:jobs@example.com?subject=Apply&amp;cc=hr@example.com">Apply</a>'
    out = flow(box, fetcher=lambda url: page).inspect()
    assert out.state == "inspected" and out.data["cc"] == ["hr@example.com"]
    two = page + b'<a href="mailto:other@example.com">x</a>'
    out = flow(box, fetcher=lambda url: two).inspect()
    assert (out.state, out.reason) == ("blocked_human", "recipient_ambiguous")


def test_inspect_refuses_a_checkpoint_from_another_vacancy(box):
    write_checkpoint(box, HREF, url="https://example.com/jobs/other")
    assert flow(box).inspect().reason == "checkpoint_mismatch"


def test_preflight_passes_on_the_synthetic_fixture(box):
    out = flow(box).preflight()
    assert (out.state, out.reason) == ("inspected", "preflight_passed")
    assert [a["role"] for a in out.data["attachments"]] == ["cv"]
    assert out.data["transport"] == "configured"


def test_draft_is_deterministic_and_invents_nothing(box):
    first = flow(box).draft()
    second = flow(box).draft()
    assert first.state == "draft_ready"
    assert first.data["body"] == second.data["body"]
    assert first.data["idempotency_key"] == second.data["idempotency_key"]
    body = first.data["body"]
    assert "Synthetic Backend Engineer" in body and "Synthetic Candidate" in body
    assert "Python, Go" in body and "Availability" not in body
    assert first.data["subject"] == "Application REF-42 C++"
    assert sql(box, "SELECT COUNT(*), state FROM email_application_attempts") == [(1, "draft_ready")]


def test_missing_required_fact_stops_with_zero_send(box):
    set_jd(box, JD + " Please state your notice period in the email.")
    notes = []
    out = flow(box, notes=notes).send()
    assert (out.state, out.reason, out.data["fact"]) == ("blocked_human", "required_fact_missing", "availability")
    assert FakeTransport.instances == [] and FakeTransport.sends == []
    assert len(notes) == 1
    flow(box, notes=notes).send()
    assert len(notes) == 1, "the same stop is notified once"


def test_a_stated_fact_is_used_verbatim(box):
    set_jd(box, JD + " Tell us your earliest start date.")
    profile = box / "profile" / "candidate_profile.yml"
    profile.write_text(profile.read_text() + "application_answers:\n  start date: 1 November 2026\n")
    out = flow(box).draft()
    assert "Availability: 1 November 2026" in out.data["body"]


@pytest.mark.parametrize("mutate,reason", [
    (lambda home: sql(home, "UPDATE applications SET cv_pdf_path = NULL WHERE position_id = 1"), "cv_missing"),
    (lambda home: (home / "cv.pdf").write_bytes(b"not a pdf"), "cv_missing"),
    (lambda home: (home / "credentials" / "email_transport.json").unlink(), "transport_missing"),
    (lambda home: (home / "credentials" / "email_transport.json").chmod(0o644), "transport_missing"),
    (lambda home: _edit_transport(home, from_address="other-sender@example.com"), "sender_unverified"),
    (lambda home: _edit_transport(home, security="plain"), "transport_missing"),
])
def test_preflight_blocks_before_anything_is_sent(box, mutate, reason):
    mutate(box)
    out = flow(box).send()
    assert (out.state, out.reason) == ("blocked_human", reason)
    assert FakeTransport.sends == []


def _edit_transport(home, **changes):
    cfg = json.loads((home / "jht.config.json").read_text())
    cfg["applications"]["email_transport"].update(changes)
    (home / "jht.config.json").write_text(json.dumps(cfg))


def test_cover_letter_is_attached_only_when_asked(box):
    cl = box / "cl.pdf"
    cl.write_bytes(b"%PDF-1.4 synthetic cover letter")
    sql(box, "UPDATE applications SET cl_pdf_path = ? WHERE position_id = 1", (str(cl),))
    assert [a["role"] for a in flow(box).draft().data["attachments"]] == ["cv"]
    set_jd(box, JD + " Please send your CV and a cover letter.")
    assert [a["role"] for a in flow(box).draft().data["attachments"]] == ["cv", "cover_letter"]


def test_a_requested_cover_letter_that_is_missing_goes_to_the_writer(box):
    set_jd(box, JD + " A motivation letter is required.")
    out = flow(box).send()
    assert (out.state, out.reason) == ("blocked_human", "cover_letter_required")
    assert out.data["writer_request"]["ok"] is True
    assert sql(box, "SELECT write_requested, write_request_kind FROM positions WHERE id = 1") == [(1, "cover_letter")]
    assert FakeTransport.sends == []


# ── send ─────────────────────────────────────────────────────────────────────


def test_send_records_receipt_and_application_once(box):
    out = flow(box).send()
    assert (out.state, out.reason) == ("sent", "sent")
    assert len(FakeTransport.sends) == 1
    message, envelope_from, recipients = FakeTransport.sends[0]
    assert envelope_from == "sender@example.com"
    assert recipients == ["jobs@example.com", "Team@example.com"]
    assert message["To"] == "jobs@example.com" and message["Cc"] == "Team@example.com"
    assert message["Bcc"] is None and message["Message-ID"] == out.data["message_id"]
    assert [p.get_filename() for p in message.iter_attachments()] == ["cv.pdf"]
    assert sql(box, "SELECT applied, applied_via FROM applications WHERE position_id = 1") == [(1, "agent_closer_email")]
    assert sql(box, "SELECT status FROM positions WHERE id = 1") == [("applied",)]
    (state, receipt), = sql(box, "SELECT state, receipt_json FROM email_application_attempts")
    receipt = json.loads(receipt)
    assert state == "sent" and receipt["message_id"] == out.data["message_id"]
    assert receipt["attachments"][0]["sha256"]
    files = list((box / "application-receipts").glob("email-1-*.json"))
    assert len(files) == 1 and files[0].stat().st_mode & 0o077 == 0

    again = flow(box).send()
    assert again.state in {"sent", "denied"} and again.reason == "duplicate_attempt"
    assert len(FakeTransport.sends) == 1


def test_the_secret_never_leaves_the_credential_file(box, capsys):
    out = flow(box).send()
    assert out.state == "sent"
    dumped = json.dumps(out.to_dict(1))
    assert SECRET not in dumped
    for path in box.rglob("*"):
        if path.is_file() and path.name != "email_transport.json":
            assert SECRET.encode() not in path.read_bytes(), path


def test_flag_revoked_between_draft_and_send_sends_nothing(box):
    FakeTransport.hook = lambda: sql(box, "UPDATE positions SET apply_requested = 0 WHERE id = 1")
    out = flow(box).send()
    assert (out.state, out.reason) == ("denied", "flag_revoked")
    assert FakeTransport.sends == []
    assert sql(box, "SELECT state FROM email_application_attempts") == [("draft_ready",)]


def test_cap_reached_between_draft_and_send_sends_nothing(box):
    _edit_cap(box, 1)
    FakeTransport.hook = lambda: sql(
        box,
        "UPDATE applications SET applied = 1, applied_via = 'agent_closer', "
        "applied_at = datetime('now', 'localtime') WHERE position_id = 2",
    )
    out = flow(box).send()
    assert (out.state, out.reason) == ("denied", "daily_cap_reached")
    assert FakeTransport.sends == []


def _edit_cap(home, cap):
    cfg = json.loads((home / "jht.config.json").read_text())
    cfg["applications"]["auto_apply"]["max_per_day"] = cap
    (home / "jht.config.json").write_text(json.dumps(cfg))


def test_timeout_after_send_started_is_unknown_and_never_retried(box):
    FakeTransport.send_error = socket.timeout("synthetic timeout")
    out = flow(box).send()
    assert (out.state, out.reason) == ("send_outcome_unknown", "send_outcome_unknown")
    FakeTransport.send_error = None
    again = flow(box).send()
    assert again.state == "send_outcome_unknown"
    assert len(FakeTransport.sends) == 1 and len(FakeTransport.instances) == 1
    assert sql(box, "SELECT applied FROM applications WHERE position_id = 1") == [(0,)]
    q = apply_gate.application_queue(config_path=box / "jht.config.json", db_path=str(box / "jobs.db"), jht_home=box)
    assert {"position_id": 1, "reason": "email_send_outcome_unknown"} in q["held"]
    assert q["sent_today"] == 1


def test_a_run_killed_after_send_started_is_unknown(box):
    out = flow(box).draft()
    sql(
        box,
        "UPDATE email_application_attempts SET state = 'send_started', send_started_at = ? WHERE idempotency_key = ?",
        (ea._utc_now(), out.data["idempotency_key"]),
    )
    again = flow(box).send()
    assert (again.state, again.reason) == ("send_outcome_unknown", "send_outcome_unknown")
    assert FakeTransport.instances == []
    assert sql(box, "SELECT state, error_class FROM email_application_attempts") == [("send_outcome_unknown", "interrupted")]


def test_recorder_failure_is_receipt_incomplete_then_reconciled_without_sending(box):
    def broken(pid):
        raise RuntimeError("synthetic db failure")

    out = flow(box, recorder=broken).send()
    assert (out.state, out.reason) == ("receipt_incomplete", "receipt_incomplete")
    assert sql(box, "SELECT applied FROM applications WHERE position_id = 1") == [(0,)]
    again = flow(box).send()
    assert (again.state, again.reason) == ("sent", "sent")
    assert len(FakeTransport.sends) == 1
    assert sql(box, "SELECT applied_via FROM applications WHERE position_id = 1") == [("agent_closer_email",)]


def test_partial_refusal_is_receipt_incomplete(box):
    FakeTransport.refused = {"Team@example.com": (550, b"no")}
    out = flow(box).send()
    assert out.state == "receipt_incomplete" and out.data["refused"] == ["Team@example.com"]
    assert sql(box, "SELECT applied FROM applications WHERE position_id = 1") == [(0,)]


def test_auth_failure_blocks_before_send_started(box):
    def factory(settings, password):
        t = FakeTransport(settings, password)
        t.open_error = ea.TransportAuthError("refused")
        return t

    out = ea.EmailApplication(1, jht_home=box, db_path=box / "jobs.db", transports={"smtp": factory}, notifier=lambda **kw: "1").send()
    assert (out.state, out.reason) == ("blocked_human", "auth_failed")
    assert sql(box, "SELECT state FROM email_application_attempts") == [("draft_ready",)]


def test_recipients_refused_before_data_is_not_unknown(box):
    FakeTransport.send_error = ea.RecipientsRefused("SMTPRecipientsRefused")
    out = flow(box).send()
    assert (out.state, out.reason) == ("blocked_human", "recipient_refused")
    assert sql(box, "SELECT state FROM email_application_attempts") == [("error",)]


def test_header_injection_in_the_link_sends_nothing(box):
    write_checkpoint(box, "mailto:jobs@example.com?subject=Hi%0D%0ABcc:%20spy@example.com")
    out = flow(box).send()
    assert (out.state, out.reason) == ("blocked_human", "mailto_invalid")
    assert FakeTransport.instances == []


@pytest.mark.parametrize("how", ["flag", "consent"])
def test_dry_run_touches_neither_transport_nor_application(box, how):
    if how == "consent":
        cfg = json.loads((box / "jht.config.json").read_text())
        cfg["applications"]["auto_apply"]["mode"] = "dry_run"
        (box / "jht.config.json").write_text(json.dumps(cfg))
        out = flow(box).send()
    else:
        out = flow(box).send(dry_run=True)
    assert (out.state, out.reason, out.data["dry_run"]) == ("draft_ready", "dry_run", True)
    assert FakeTransport.instances == []
    assert sql(box, "SELECT applied, applied_at, applied_via FROM applications WHERE position_id = 1") == [(0, None, None)]
    assert sql(box, "SELECT status FROM positions WHERE id = 1") == [("ready",)]


def test_status_reports_the_latest_attempt(box):
    flow(box).send()
    out = flow(box).status()
    assert out.state == "sent" and out.data["attempt"]["message_id"].startswith("<jht-1-")


def test_cli_status_exit_code(box):
    env = {**os.environ, "JHT_HOME": str(box), "JHT_DB": str(box / "jobs.db")}
    r = subprocess.run(
        [sys.executable, str(SKILLS / "email_application.py"), "inspect", "--position-id", "1", "--json"],
        capture_output=True, text=True, env=env,
    )
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)["state"] == "inspected"


# ── One cap, one rule ────────────────────────────────────────────────────────


def test_the_rule_lists_both_automated_channels():
    rule = json.loads(RULE.read_text())
    assert list(apply_gate.AUTOMATED_APPLIED_VIA) == rule["automated_applied_via"]
    assert ea.APPLIED_VIA in rule["automated_applied_via"]


def test_email_sends_consume_the_same_daily_cap(box):
    sql(
        box,
        "UPDATE applications SET applied = 1, applied_via = 'agent_closer_email', "
        "applied_at = datetime('now', 'localtime') WHERE position_id = 2",
    )
    verdict = apply_gate.daily_cap_verdict(config_path=box / "jht.config.json", db_path=str(box / "jobs.db"))
    assert verdict.context["sent_today"] == 1


def test_an_unreadable_channel_list_closes_the_cap(box, monkeypatch):
    monkeypatch.setattr(apply_gate, "AUTOMATED_RULE_ERROR", "synthetic")
    verdict = apply_gate.daily_cap_verdict(config_path=box / "jht.config.json", db_path=str(box / "jobs.db"))
    assert (verdict.allowed, verdict.reason) == (False, "rule_unavailable")


def test_the_attempt_register_is_idempotent_and_unique(box):
    conn = sqlite3.connect(box / "jobs.db")
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO email_application_attempts (position_id, idempotency_key, state, message_id, "
        "recipients_json, body_sha256, attachments_json) VALUES (1, 'k', 'draft_ready', 'm', '[]', 'h', '[]')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO email_application_attempts (position_id, idempotency_key, state, message_id, "
            "recipients_json, body_sha256, attachments_json) VALUES (1, 'k', 'draft_ready', 'm', '[]', 'h', '[]')"
        )
    conn.close()

"""Greenhouse's one-time code after Submit (1967, patch 25).

The code screen is the last step of the same application: the code comes
from the user's mailbox or from Telegram, is typed, and confirmed once. The
code never reaches the checkpoint, the receipt or a stop. Synthetic pages, a
fake mailbox and a fake Telegram bridge only.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "tests"))

import _db  # noqa: E402
import application_answers  # noqa: E402
import verification_code  # noqa: E402
from apply_flow import FlowCheckpoint  # noqa: E402
from test_greenhouse_apply_flow import GREENHOUSE_URLS, build_flow, greenhouse_form, profile  # noqa: E402

CODE = "Ab3dEf9h"

CODE_SCREEN = """
  <div id="security" hidden>
    <p>A verification code was sent to candidate@example.invalid. To submit your application,
       enter the 8-character code to confirm you're human.</p>
    <div id="boxes"></div>
    <p id="code-error" role="alert" hidden>Incorrect security code</p>
  </div>
  <script>
    (() => {
      const boxes = document.querySelector('#boxes');
      for (let i = 0; i < 8; i++) {
        const box = document.createElement('input');
        box.id = 'security-input-' + i; box.maxLength = 1; box.setAttribute('aria-label', 'Security code');
        boxes.appendChild(box);
      }
      const form = document.querySelector('#application-form');
      form.addEventListener('submit', event => {
        event.preventDefault();
        const screen = document.querySelector('#security');
        if (screen.hidden) { screen.hidden = false; return; }
        const typed = Array.from(boxes.querySelectorAll('input')).map(b => b.value).join('');
        if (typed === '__CODE__') {
          document.body.innerHTML = '<main class="application--confirmation">Thank you for applying.</main>';
        } else {
          document.querySelector('#code-error').hidden = false;
        }
      }, true);
    })();
  </script>
""".replace("__CODE__", CODE)


def code_page(box_name: str = "") -> str:
    # The recipe's own submit handler is replaced by the code step.
    html = greenhouse_form(confirmation=False)
    screen = CODE_SCREEN.replace("box.maxLength = 1;", f"box.maxLength = 1; box.name = {box_name!r};") if box_name else CODE_SCREEN
    return html.replace('<button class="btn btn--pill"', screen + '<button class="btn btn--pill"')


@pytest.fixture
def page():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        yield browser.new_page()
        browser.close()


@pytest.fixture
def cv_path(tmp_path: Path) -> Path:
    path = tmp_path / "test-profile.pdf"
    path.write_bytes(b"%PDF-1.4\n% test fixture only\n")
    return path


@pytest.fixture
def db(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    path = tmp_path / "jobs.db"
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions (id, title, company, url, status) VALUES (52, 'Synthetic role', 'Synthetic company', ?, 'ready')",
        (GREENHOUSE_URLS[0],),
    )
    conn.commit()
    conn.close()
    monkeypatch.setattr(verification_code, "mailbox_configured", lambda: False)
    # Greenhouse's own sender domains, stood in for by a documentation domain.
    import apply_flow

    monkeypatch.setattr(apply_flow.GreenhouseRecipe, "SECURITY_CODE_SENDERS", ("example.com",))
    return path


def mailbox(messages):
    def reader(_since):
        return messages() if callable(messages) else messages
    return reader


def fresh_mail(code: str = CODE, sender: str = "Greenhouse <no-reply@example.com>", minutes: float = 0):
    return lambda: [(sender, datetime.now(timezone.utc) + timedelta(minutes=minutes),
                     f"<p>Your security code is</p><p><b>{code}</b></p><p>It expires in 10 minutes.</p>")]


def flow_for(tmp_path, cv_path, db, *, reader=None, notifier=None, recorded=None, timeout=5.0):
    flow = build_flow(tmp_path, cv_path, candidate=profile(), recorded=recorded)
    flow.db_path = db
    flow.jht_home = tmp_path
    flow.mailbox_reader = reader
    flow.mailbox_poll_s = 0.2
    flow.code_notifier = notifier
    flow.VERIFICATION_CODE_TIMEOUT_S = timeout
    return flow


def telegram(home: Path, db: Path, code: str = CODE):
    """What jht-notify-user and the bridge do: the row, then the 0600 code file and [received]."""

    def notifier(*, position_id, message, source_id, payload):
        assert payload["code_format"] == "alnum8" and payload["service"] == "greenhouse"
        conn = sqlite3.connect(db)
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, related_position_id, source_id, source_action, "
            "source_payload, delivered_via) VALUES ('closer', ?, 'alert', ?, ?, 'closer_login_code', ?, 'telegram')",
            (message, position_id, source_id, json.dumps(payload)),
        )
        path = application_answers.login_code_path(source_id, home)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"source_id": source_id, "code": code, "received_at": "now"}))
        os.chmod(path, 0o600)
        conn.execute("UPDATE pending_user_messages SET user_reply = '[received]' WHERE source_id = ?", (source_id,))
        conn.commit()
        conn.close()
        return "telegram"

    return notifier


def saved_text(tmp_path: Path) -> str:
    return (tmp_path / "checkpoint.json").read_text()


@pytest.mark.parametrize("box_name", ("", "security_code"))
def test_the_code_from_the_mailbox_finishes_the_same_application(page, tmp_path, cv_path, db, box_name):
    # Boxes named like the pre-submit security-code captcha are still the code step.
    page.set_content(code_page(box_name))
    recorded: list = []
    flow = flow_for(tmp_path, cv_path, db, reader=mailbox(fresh_mail()), recorded=recorded)
    flow.confirmation_timeout_ms = 20_000  # the code screen is taken at once, not after this wait
    started = __import__("time").monotonic()

    result = flow.run(page=page, navigate=False)

    assert __import__("time").monotonic() - started < 15

    assert result.status == "applied", result
    assert page.evaluate("window.submitCount") == 2  # Submit, then the code confirmed once
    saved = json.loads(saved_text(tmp_path))
    assert saved["verification"] == "code_entered" and saved["submit_started"] is True
    assert CODE not in saved_text(tmp_path)
    assert CODE not in json.dumps(recorded[0]["receipt"].to_dict())


def test_the_code_from_telegram_when_no_mailbox_is_configured(page, tmp_path, cv_path, db):
    page.set_content(code_page())

    result = flow_for(tmp_path, cv_path, db, notifier=telegram(tmp_path, db)).run(page=page, navigate=False)

    assert result.status == "applied", result
    conn = sqlite3.connect(db)
    try:
        assert [r[0] for r in conn.execute("SELECT user_reply FROM pending_user_messages")] == ["[used]"]
    finally:
        conn.close()
    assert not list((tmp_path / ".cache" / "apply-flow" / "login-code").glob("*.json"))
    assert CODE not in saved_text(tmp_path)


@pytest.mark.parametrize("box_name", ("", "security_code"))
def test_a_wrong_code_stops_without_another_submit_and_leaves_no_code_on_the_page(page, tmp_path, cv_path, db, box_name):
    page.set_content(code_page(box_name))
    recorded: list = []

    result = flow_for(tmp_path, cv_path, db, reader=mailbox(fresh_mail("Zz9zZz9z")), recorded=recorded).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "greenhouse_verification_failed")
    assert page.evaluate("window.submitCount") == 2
    assert page.evaluate("Array.from(document.querySelectorAll('#boxes input')).map(b => b.value).join('')") == ""
    assert "Zz9zZz9z" not in saved_text(tmp_path)
    assert recorded == []


@pytest.mark.parametrize(
    "messages",
    (
        [],
        fresh_mail(minutes=-10),  # sent before this submit: another try's code
        fresh_mail(sender="Jobs <alerts@jobs.invalid>"),
    ),
)
def test_no_usable_email_in_time_stops_after_the_one_submit(page, tmp_path, cv_path, db, messages):
    page.set_content(code_page())

    result = flow_for(tmp_path, cv_path, db, reader=mailbox(messages), timeout=1.0).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "greenhouse_verification_failed")
    assert page.evaluate("window.submitCount") == 1


def _stopped_on_the_code_screen(tmp_path: Path) -> None:
    checkpoint = FlowCheckpoint.new(52, GREENHOUSE_URLS[0])
    checkpoint.platform = "greenhouse"
    checkpoint.state = "submit"
    checkpoint.completed_steps = ["detect", "fill", "upload_cv", "screening", "review"]
    checkpoint.submit_started = True
    checkpoint.submit_started_at = (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()
    checkpoint.verification = "code_required"
    checkpoint.save(tmp_path / "checkpoint.json")


def test_a_resume_on_the_open_code_screen_confirms_once_without_submitting_again(page, tmp_path, cv_path, db):
    _stopped_on_the_code_screen(tmp_path)
    page.set_content(code_page())
    # The page as the first run left it: fields filled, code screen open after one Submit.
    page.evaluate(
        "document.querySelectorAll('[required]').forEach(field => field.required = false);"
        " document.querySelector('#security').hidden = false; window.submitCount = 1;"
    )
    recorded: list = []

    result = flow_for(tmp_path, cv_path, db, reader=mailbox(fresh_mail()), recorded=recorded).run(page=page, navigate=False)

    assert result.status == "applied", result
    assert page.evaluate("window.submitCount") == 2
    assert len(recorded) == 1


def test_a_resume_whose_code_screen_is_gone_never_submits_again(page, tmp_path, cv_path, db):
    _stopped_on_the_code_screen(tmp_path)
    page.set_content(code_page())  # a fresh page: the form again, no code screen
    recorded: list = []

    result = flow_for(tmp_path, cv_path, db, reader=mailbox(fresh_mail()), recorded=recorded).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "greenhouse_verification_lost")
    assert page.evaluate("window.submitCount || 0") == 0
    assert recorded == []


def test_a_resume_in_a_new_browser_is_lost_without_opening_the_vacancy(tmp_path, cv_path, db, monkeypatch):
    _stopped_on_the_code_screen(tmp_path)
    flow = flow_for(tmp_path, cv_path, db, reader=mailbox(fresh_mail()))
    opened: list = []
    monkeypatch.setattr(type(flow), "_navigate", lambda self, p: opened.append(p))

    class Page:
        url = "about:blank"

        def is_closed(self):
            return True

    result = flow.run(page=Page(), navigate=True)

    assert (result.status, result.reason) == ("blocked_human", "greenhouse_verification_lost")
    assert opened == []


@pytest.mark.parametrize(
    ("text", "code"),
    (
        ("Your security code is: <b>Ab3dEf9h</b>.", "Ab3dEf9h"),
        ("Copy this code into the application: XK4MT8QZ", "XK4MT8QZ"),
        ("Your verification code was received. Security team", None),
        ("Paste the code received earlier", None),
        ("code Ab3dEf9h, and a second code Zz9zZz9z", None),
    ),
)
def test_the_code_is_read_only_when_the_email_names_exactly_one(text, code):
    assert verification_code.code_in_text(text) == code


def test_the_real_bridge_hands_an_eight_character_code_to_the_flow(page, tmp_path, cv_path, db):
    """HQ-BACKEND's resolve_login_code (alnum8): the user replies to the request with the code."""
    page.set_content(code_page())

    def notifier(*, position_id, message, source_id, payload):
        conn = sqlite3.connect(db)
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, related_position_id, source_id, source_action, "
            "source_payload, delivered_via) VALUES ('closer', ?, 'alert', ?, ?, 'closer_login_code', ?, 'telegram')",
            (message, position_id, source_id, json.dumps(payload)),
        )
        conn.commit()
        outcome = application_answers.resolve_login_code(
            conn, text=f"{CODE[:4]} {CODE[4:]}", reply_to_text=message, direct=False, jht_home=tmp_path
        )
        conn.commit()
        conn.close()
        assert outcome.status == "received", outcome
        return "telegram"

    result = flow_for(tmp_path, cv_path, db, notifier=notifier).run(page=page, navigate=False)

    assert result.status == "applied", result
    assert CODE not in saved_text(tmp_path)

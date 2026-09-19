"""A saved form question never outlives the field it described (1967, 14/09).

Live: run 1 stopped on "Country" as a text field with no options and the
question was asked; the page later showed a select. On resume the flow kept
the old request, so the CLOSER could never work out the country. Synthetic
Lever pages and a synthetic jobs.db only.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "tests"))

import _db  # noqa: E402
import application_answers  # noqa: E402
from apply_flow import ApplicationFlow, FlowCheckpoint  # noqa: E402
from test_lever_apply_flow import APPLY, lever_form  # noqa: E402


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool = True
    reason: str = "apply_allowed"
    context: dict = field(default_factory=lambda: {"mode": "authorised", "at": "2026-09-14T08:00:00+00:00"})

    def log_line(self) -> str:
        return "[apply-gate] ALLOW"


TEXT_COUNTRY = (
    '<li class="application-question custom-question"><div class="application-label">'
    '<div class="text">Country<span class="required">✱</span></div></div>'
    '<div class="application-field"><input type="text" name="cards[c][field0]" required></div></li>'
)


def select_country(*options: str) -> str:
    rendered = "".join(f'<option value="{n}">{o}</option>' for n, o in enumerate(options, 1))
    return (
        '<li class="application-question custom-question"><div class="application-label">'
        '<div class="text">Country<span class="required">✱</span></div></div>'
        '<div class="application-field"><select name="cards[c][field0]" required>'
        f'<option value="">Select...</option>{rendered}</select></div></li>'
    )


def country_page(question: str) -> str:
    return lever_form().replace("</ul>\n        </div>", f"{question}</ul>\n        </div>", 1)


@pytest.fixture
def page():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        yield browser.new_page()
        browser.close()


@pytest.fixture
def box(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    db = tmp_path / "jobs.db"
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute("INSERT INTO positions (id, title, company, url, status) VALUES (61, 'Synthetic role', 'Synthetic company', ?, 'ready')", (APPLY,))
    conn.commit()
    conn.close()
    cv = tmp_path / "cv.pdf"
    cv.write_bytes(b"%PDF-1.4 synthetic")
    return tmp_path, db, cv


def flow(box, *, at: str = "2026-09-14T08:00:00+00:00", recorded: list | None = None) -> ApplicationFlow:
    home, db, cv = box
    recorded = recorded if recorded is not None else []
    return ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
        cv_checker=lambda _path: {"ok": True, "reasons": []},
        position_id=61,
        url=APPLY,
        profile={"name": "Test Candidate", "contacts": {"email": "candidate@example.invalid"}},
        cv_path=cv,
        checkpoint_path=home / "checkpoint.json",
        receipt_dir=home / "receipts",
        db_path=db,
        gate_checker=lambda **_kwargs: GateVerdict(context={"mode": "authorised", "at": at}),
        notifier=lambda **_kwargs: "notification-1",
        applied_recorder=lambda **kwargs: recorded.append(kwargs),
        confirmation_timeout_ms=1500,
    )


def rows(db: Path) -> list[tuple]:
    conn = sqlite3.connect(db)
    try:
        return conn.execute(
            "SELECT source_id, source_action, user_reply FROM pending_user_messages WHERE agent = 'closer' ORDER BY id"
        ).fetchall()
    finally:
        conn.close()


def ask(box) -> None:
    home, db, _cv = box
    run = flow(box)
    assert run.ask_pending(FlowCheckpoint.load(home / "checkpoint.json", 61, APPLY))["status"] == "asked"


def later() -> str:
    return (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()


def test_a_new_authorisation_reads_the_field_again_and_the_new_shape_is_applied(page, box):
    home, db, _cv = box
    page.set_content(country_page(TEXT_COUNTRY))
    first = flow(box).run(page=page, navigate=False)
    assert first.pending_question["field_type"] == "text" and first.pending_question["options"] == []
    ask(box)
    old_source = rows(db)[0][0]

    # Without a new authorisation the asked question still waits, page unread.
    page.set_content(country_page(select_country("Italy", "Spain")))
    waiting = flow(box).run(page=page, navigate=False)
    assert waiting.pending_question["field_type"] == "text"

    # The user authorises again: the select is read as it is now.
    second = flow(box, at=later()).run(page=page, navigate=False)
    assert second.reason == "required_answer_missing"
    assert (second.pending_question["field_type"], second.pending_question["options"]) == ("select", ["Italy", "Spain"])
    assert second.pending_question["asked"] is False
    assert rows(db) == [(old_source, "closer_application_answer_superseded", None)]

    conn = sqlite3.connect(db)
    application_answers.save_inferred(
        conn, key="country", value="Italy", field_type="select", options=["Italy", "Spain"], basis="profile", position_id=61
    )
    conn.close()
    recorded: list = []
    third = flow(box, recorded=recorded).run(page=page, navigate=False)
    assert third.status == "applied", third
    assert len(recorded) == 1


def test_a_field_that_changed_shape_is_a_new_request_even_without_a_new_authorisation(page, box):
    home, db, _cv = box
    page.set_content(country_page(TEXT_COUNTRY))
    flow(box).run(page=page, navigate=False)
    ask(box)
    old_source = rows(db)[0][0]
    conn = sqlite3.connect(db)
    # The CLOSER works out a text answer for the text question it was shown.
    application_answers.save_inferred(conn, key="country", value="Italy", field_type="text", basis="profile", position_id=61)
    conn.close()

    page.set_content(country_page(select_country("Spain", "France")))
    result = flow(box).run(page=page, navigate=False)

    assert result.reason in {"required_answer_missing", "answer_not_accepted"}
    assert (result.pending_question["field_type"], result.pending_question["options"]) == ("select", ["Spain", "France"])
    saved = json.loads((home / "checkpoint.json").read_text())["answer_request"]
    assert saved["source_id"] != old_source and saved["asked"] is False
    assert rows(db)[0] == (old_source, "closer_application_answer_superseded", None)


def test_a_new_authorisation_never_reopens_a_started_submit(page, box):
    home, db, _cv = box
    checkpoint = FlowCheckpoint.new(61, APPLY)
    checkpoint.platform = "lever"
    checkpoint.state = "submit"
    checkpoint.submit_started = True
    checkpoint.answer_request = {"source_id": "closer-answer:61:old", "message_id": "", "asked": True,
                                 "notification_attempted": False,
                                 "payload": {"version": 1, "position_id": 61, "key": "country", "label": "Country",
                                             "field_type": "text", "options": []}}
    checkpoint.save(home / "checkpoint.json")
    page.set_content(country_page(select_country("Italy")))
    recorded: list = []

    result = flow(box, at=later(), recorded=recorded).run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert page.locator("select").input_value() == ""
    assert json.loads((home / "checkpoint.json").read_text())["answer_request"]["source_id"] == "closer-answer:61:old"
    assert recorded == []


def test_the_same_shape_keeps_the_asked_request(page, box):
    home, db, _cv = box
    page.set_content(country_page(select_country("Italy", "Spain")))
    flow(box).run(page=page, navigate=False)
    ask(box)
    before = json.loads((home / "checkpoint.json").read_text())["answer_request"]

    again = flow(box, at=later()).run(page=page, navigate=False)

    after = json.loads((home / "checkpoint.json").read_text())["answer_request"]
    assert again.reason == "required_answer_missing"
    # Same field, same options: a new authorisation reads it again but it is the same request row.
    assert after["source_id"] == before["source_id"] and after["asked"] is True
    assert rows(db) == [(before["source_id"], "closer_application_answer", None)]
    assert again.pending_question["asked"] is True
    conn = sqlite3.connect(db)
    try:
        # Brought back as it was: still waiting, not marked seen by the supersede.
        assert conn.execute("SELECT acknowledged_at FROM pending_user_messages").fetchone()[0] is None
    finally:
        conn.close()

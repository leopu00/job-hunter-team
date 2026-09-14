"""1967 after patch 19: the resume ran, and the same field came back as a text question.

Built on the checkpoint HQ-VPS copied from the box (profile values masked):
country, text, no options, asked; the user authorised again at
2026-09-14T15:18:36.164Z. Synthetic Greenhouse page whose Country options
load a moment after the click, as React boards fetch them. No real site.
"""

from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "tests"))

import _db  # noqa: E402
import apply_gate  # noqa: E402
from test_greenhouse_apply_flow import GateVerdict, _country_field, build_flow, greenhouse_form, profile  # noqa: E402

AUTHORISED_AT = "2026-09-14T15:18:36.164Z"
URL = "https://job-boards.greenhouse.io/shopfully/jobs/8027218"

# The box checkpoint before the 15:19 run (masked copy, stop instant of the asked question).
BOX_CHECKPOINT = {
    "answer_refusals": {},
    "answer_request": {
        "asked": True,
        "message_id": "1221",
        "notification_attempted": True,
        "payload": {"field_type": "text", "key": "country", "label": "Country", "options": [], "position_id": 1967, "version": 1},
        "source_id": "closer-answer:1967:ba4ecf17727f999d51e4e4c7",
    },
    "answer_sources": {},
    "blocked_detail": "Required Greenhouse field needs a fact the profile does not state: Country*",
    "blocked_reason": "required_answer_missing",
    "channel": "",
    "completed_steps": ["detect"],
    "cv_preview": "",
    "final_url": "",
    "handoff_url": "",
    "http_status": 200,
    "mailto_href": "",
    "modal_step": 0,
    "platform": "greenhouse",
    "position_id": 1967,
    "pre_submit_screenshot": "",
    "receipt": None,
    "resume_state": "fill",
    "retry_after": "",
    "state": "blocked_human",
    "stop_screenshot": "",
    "submit_started": False,
    "submit_started_at": "",
    "transient_failures": [],
    "updated_at": "2026-09-14T14:43:54+00:00",
    "url": URL,
    "version": 1,
}


def async_country() -> str:
    # Options rendered 700 ms after the click, not synchronously.
    return _country_field("combobox").replace(
        "country.addEventListener('click', () => document.querySelector('#country-options').hidden = false);",
        "country.addEventListener('click', () => setTimeout(() => document.querySelector('#country-options').hidden = false, 700));",
    )


@pytest.fixture
def page():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        yield browser.new_page()
        browser.close()


@pytest.fixture
def cv_path(tmp_path: Path) -> Path:
    path = tmp_path / "cv.pdf"
    path.write_bytes(b"%PDF-1.4 synthetic")
    return path


def test_the_box_checkpoint_after_the_new_authorisation_asks_country_with_the_page_options(page, tmp_path, cv_path):
    db = tmp_path / "jobs.db"
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions (id, title, company, url, status, apply_requested, apply_requested_at, apply_requested_by) "
        "VALUES (1967, 'Synthetic role', 'Synthetic company', ?, 'ready', 1, ?, 'user_local')",
        (URL, AUTHORISED_AT),
    )
    conn.execute(
        "INSERT INTO pending_user_messages (id, agent, body, kind, related_position_id, source_id, source_action, source_payload, delivered_via) "
        "VALUES (1221, 'closer', 'masked', 'question', 1967, ?, 'closer_application_answer', ?, 'telegram')",
        (BOX_CHECKPOINT["answer_request"]["source_id"], json.dumps(BOX_CHECKPOINT["answer_request"]["payload"], sort_keys=True)),
    )
    conn.commit()
    conn.close()
    (tmp_path / "checkpoint.json").write_text(json.dumps(BOX_CHECKPOINT))
    html = greenhouse_form().replace(
        '<div class="field-wrapper">\n            <label for="resume">',
        async_country() + '\n          <div class="field-wrapper">\n            <label for="resume">',
    )
    page.set_content(html)
    flow = build_flow(tmp_path, cv_path, candidate=profile(first_name="Test", last_name="Candidate"),
                      verdicts=[GateVerdict(context={"mode": "authorised", "at": AUTHORISED_AT})])
    flow.position_id = 1967
    flow.url = URL
    flow.db_path = db

    result = flow.run(page=page, navigate=False)

    assert result.reason == "required_answer_missing", result
    assert (result.pending_question["field_type"], result.pending_question["options"]) == ("select", ["Germany", "Italy", "Spain"])
    assert result.pending_question["asked"] is False


def test_the_queue_releases_the_box_checkpoint_for_the_newer_authorisation(tmp_path):
    path = apply_gate.checkpoint_path(1967, tmp_path)
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(BOX_CHECKPOINT))

    assert apply_gate._checkpoint_hold(1967, AUTHORISED_AT, tmp_path) == ""
    assert apply_gate._checkpoint_hold(1967, "2026-09-14 15:18:36.164", tmp_path) == ""
    assert apply_gate._checkpoint_hold(1967, "2026-09-14T14:00:00.000Z", tmp_path) == "checkpoint_blocked_human"

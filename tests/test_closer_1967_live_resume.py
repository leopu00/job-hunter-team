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


def _box(tmp_path: Path, *, acknowledged: bool) -> Path:
    db = tmp_path / "jobs.db"
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions (id, title, company, url, status, apply_requested, apply_requested_at, apply_requested_by) "
        "VALUES (1967, 'Synthetic role', 'Synthetic company', ?, 'ready', 1, ?, 'user_local')",
        (URL, "2026-09-14T16:05:46.000Z"),
    )
    conn.execute(
        "INSERT INTO pending_user_messages (id, agent, body, kind, related_position_id, source_id, source_action, "
        "source_payload, delivered_via, acknowledged_at) VALUES (1221, 'closer', 'masked', 'question', 1967, ?, "
        "'closer_application_answer', ?, 'telegram', ?)",
        (
            BOX_CHECKPOINT["answer_request"]["source_id"],
            json.dumps(BOX_CHECKPOINT["answer_request"]["payload"], sort_keys=True),
            "2026-09-14 14:43:54" if acknowledged else None,
        ),
    )
    conn.commit()
    conn.close()
    saved = dict(BOX_CHECKPOINT, updated_at="2026-09-14T15:19:07+00:00")
    (tmp_path / "checkpoint.json").write_text(json.dumps(saved))
    return db


TEXT_COUNTRY = """
      <div class="field-wrapper">
        <label for="country">Country<span aria-hidden="true">*</span></label>
        <input id="country" aria-required="true" required>
      </div>"""


@pytest.mark.parametrize("acknowledged", (True, False))
def test_patch_20_a_closed_question_of_the_same_shape_is_never_brought_back_as_asked(page, tmp_path, cv_path, acknowledged):
    # Patch 20: the page still gave Country as text with no options; the old
    # request came back "asked" though its row was closed, and nobody could answer.
    db = _box(tmp_path, acknowledged=acknowledged)
    html = greenhouse_form().replace(
        '<div class="field-wrapper">\n            <label for="resume">',
        TEXT_COUNTRY + '\n          <div class="field-wrapper">\n            <label for="resume">',
    )
    page.set_content(html)
    flow = build_flow(tmp_path, cv_path, candidate=profile(first_name="Test", last_name="Candidate"),
                      verdicts=[GateVerdict(context={"mode": "authorised", "at": "2026-09-14T16:05:46.000Z"})])
    flow.position_id = 1967
    flow.url = URL
    flow.db_path = db

    result = flow.run(page=page, navigate=False)

    assert result.reason == "required_answer_missing", result
    # A closed row: a new question the CLOSER works out. An open one: the same, still asked.
    assert result.pending_question["asked"] is (not acknowledged)


# ── patch 20: "Country*" is the phone's dialling code (DOM read on the box) ──

PHONE_FIELDSET = """
      <fieldset class="phone-input">
        <legend>Phone</legend>
        <ul class="iti__country-list" role="listbox" hidden>
          <li class="iti__country" role="option">Italy (Italia) +39</li>
          <li class="iti__country" role="option">Canada +1</li>
        </ul>
        <div class="select"><div class="select__container">
          <label id="country-label" for="country" class="label select__label">Country<span aria-hidden="true">*</span></label>
          <div class="select-shell"><div class="select__control"><div class="select__value-container">
            <input id="country" class="select__input" type="text" role="combobox" aria-autocomplete="list"
                   aria-haspopup="true" aria-required="true" aria-expanded="false">
            <input required aria-hidden="true" tabindex="-1" class="requiredInput" value="">
          </div></div></div>
        </div></div>
        <div class="field-wrapper">
          <label for="phone">Phone<span aria-hidden="true">*</span></label>
          <input id="phone" type="tel" aria-required="true" required>
        </div>
      </fieldset>
      <script>
      (() => {
        const input = document.querySelector('#country');
        const names = ["United States +1", "Canada +1", "Puerto Rico +1 787", "Italy +39", "San Marino +378", "Spain +34"];
        input.addEventListener('click', () => setTimeout(() => {
          if (document.querySelector('#react-select-country-listbox')) return;
          const menu = document.createElement('div');
          menu.className = 'select__menu';
          menu.innerHTML = '<div class="select__menu-list" role="listbox" id="react-select-country-listbox">'
            + names.map((n, i) => `<div role="option" class="select__option" id="react-select-country-option-${i}"><div class="iti__flag"></div>${n}</div>`).join('')
            + '</div>';
          input.closest('.select__container').appendChild(menu);
          input.setAttribute('aria-controls', 'react-select-country-listbox');
          input.setAttribute('aria-expanded', 'true');
          menu.querySelectorAll('[role=option]').forEach(option => option.addEventListener('click', () => {
            // As on the box: the chosen value is a flag and the code only, rendered a moment later.
            const code = option.textContent.slice(option.textContent.lastIndexOf('+'));
            menu.remove();
            setTimeout(() => {
              const value = document.createElement('div');
              value.className = 'select__single-value';
              value.innerHTML = '<div class="iti__flag"></div>' + code;
              input.parentElement.prepend(value);
              document.querySelector('.requiredInput').value = option.textContent;
            }, 400);
          }));
        }, 600));
      })();
      </script>"""


def phone_page() -> str:
    return greenhouse_form().replace(
        '<div class="field-wrapper">\n            <label for="resume">',
        PHONE_FIELDSET + '\n          <div class="field-wrapper">\n            <label for="resume">',
    )


def phone_flow(tmp_path, cv_path, contacts: dict, *, extra: dict | None = None, recorded: list | None = None):
    candidate = profile(first_name="Test", last_name="Candidate", contacts={"email": "candidate@example.invalid", **contacts}, **(extra or {}))
    return build_flow(tmp_path, cv_path, candidate=candidate, recorded=recorded)


@pytest.mark.parametrize(
    ("phone", "extra", "expected"),
    (
        ("+39 333 0000000", {}, "Italy +39"),
        ("0039 333 0000000", {}, "Italy +39"),
        ("+378 0549 000000", {}, "San Marino +378"),
        ("+1 555 0100", {"location": "Toronto, Canada"}, "Canada +1"),
        ("+1 787 555 0100", {}, "Puerto Rico +1 787"),
    ),
)
def test_the_phone_country_is_chosen_from_the_profiles_dialling_code(page, tmp_path, cv_path, phone, extra, expected):
    page.set_content(phone_page())
    recorded: list = []

    result = phone_flow(tmp_path, cv_path, {"phone": phone}, extra=extra, recorded=recorded).run(page=page, navigate=False)

    assert result.status == "applied", result
    assert recorded and recorded[0]["receipt"].answer_sources.get("phone country") == "profile"


def test_a_shared_dialling_code_the_profile_cannot_place_is_a_question_with_those_options(page, tmp_path, cv_path):
    page.set_content(phone_page())

    result = phone_flow(tmp_path, cv_path, {"phone": "+1 555 0100"}).run(page=page, navigate=False)

    assert result.reason == "required_answer_missing", result
    assert result.pending_question["key"] == "phone country"
    assert (result.pending_question["field_type"], result.pending_question["options"]) == ("select", ["United States +1", "Canada +1"])
    assert result.pending_question["asked"] is False
    assert page.evaluate("window.submitCount") == 0


def test_a_saved_phone_country_option_fills_the_field(page, tmp_path, cv_path):
    page.set_content(phone_page())
    candidate_answers = {"phone country": "United States +1"}
    flow = phone_flow(tmp_path, cv_path, {"phone": "+1 555 0100"}, extra={"application_answers": candidate_answers})

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied", result


def test_the_box_1967_after_patch_20_applies_with_the_dialling_code(page, tmp_path, cv_path):
    db = _box(tmp_path, acknowledged=True)
    page.set_content(phone_page())
    recorded: list = []
    flow = phone_flow(tmp_path, cv_path, {"phone": "+39 333 0000000"}, recorded=recorded)
    flow.gate_checker = lambda **_kwargs: GateVerdict(context={"mode": "authorised", "at": "2026-09-14T16:05:46.000Z"})
    flow.position_id = 1967
    flow.url = URL
    flow.db_path = db

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied", result
    conn = sqlite3.connect(db)
    try:
        assert conn.execute("SELECT source_action FROM pending_user_messages WHERE id = 1221").fetchone()[0] == "closer_application_answer_superseded"
    finally:
        conn.close()


def test_the_phone_country_goes_on_to_phone_and_the_cv(page, tmp_path, cv_path):
    page.set_content(phone_page())
    flow = phone_flow(tmp_path, cv_path, {"phone": "+39 333 0000000"})
    flow.gate_checker = lambda **_kwargs: GateVerdict(context={"mode": "dry_run"})

    result = flow.run(page=page, navigate=False)

    assert result.status == "dry_run", result
    assert page.locator(".select__single-value").inner_text().strip() == "+39"
    assert page.locator("#phone").input_value() == "+39 333 0000000"
    assert page.locator("#resume").evaluate("e => e.files.length") == 1


def test_a_phone_country_the_menu_did_not_keep_stops_before_the_click(page, tmp_path, cv_path):
    wrong = phone_page().replace("value.innerHTML = '<div class=\"iti__flag\"></div>' + code;", "value.innerHTML = '<div class=\"iti__flag\"></div>+1';")
    assert wrong != phone_page()
    page.set_content(wrong)

    result = phone_flow(tmp_path, cv_path, {"phone": "+39 333 0000000"}).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "answer_not_accepted")
    assert page.evaluate("window.submitCount") == 0

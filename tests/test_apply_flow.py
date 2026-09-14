"""Safety and recovery contracts for the first CLOSER recipe (Ashby)."""

from __future__ import annotations

import contextlib
import json
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import apply_flow as apply_flow_module  # noqa: E402
from apply_flow import (  # noqa: E402
    ApplicationFlow,
    BlockedHuman,
    FlowCheckpoint,
    FlowError,
    Receipt,
    _default_applied_recorder,
    _resolve_headless,
    _load_profile,
)


ASHBY_URL = "https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001/application"


def test_live_display_selects_headed_browser(tmp_path: Path, monkeypatch):
    socket_root = tmp_path / ".X11-unix"
    checked = []
    monkeypatch.setattr(
        Path,
        "is_socket",
        lambda candidate: checked.append(candidate) or True,
    )
    assert not _resolve_headless(
        None,
        env={"DISPLAY": ":99"},
        socket_root=socket_root,
    )
    assert checked == [socket_root / "X99"]


def test_missing_display_socket_stays_headless(tmp_path: Path):
    assert _resolve_headless(
        None,
        env={"DISPLAY": ":99"},
        socket_root=tmp_path / ".X11-unix",
    )


def test_browser_visibility_overrides_are_explicit(tmp_path: Path):
    assert not _resolve_headless(False, env={}, socket_root=tmp_path)
    assert _resolve_headless(
        True,
        env={"DISPLAY": ":99"},
        socket_root=tmp_path,
    )
    assert _resolve_headless(
        None,
        env={"DISPLAY": ":99", "JHT_LIVE_SCREEN": "0"},
        socket_root=tmp_path,
    )


@pytest.mark.parametrize(
    ("flag", "expected"), [("--headful", False), ("--headless", True)]
)
def test_cli_browser_visibility_override(flag, expected, tmp_path: Path, monkeypatch):
    profile_path = tmp_path / "profile.yml"
    profile_path.write_text("name: Fixture\n", encoding="utf-8")
    cv_path = tmp_path / "cv.pdf"
    cv_path.write_bytes(b"fixture")
    observed = {}

    class FakeFlow:
        def __init__(self, **kwargs):
            observed.update(kwargs)

        def run(self):
            return type(
                "Result",
                (),
                {"status": "dry_run", "to_dict": lambda self: {"status": self.status}},
            )()

    monkeypatch.setattr(apply_flow_module, "ApplicationFlow", FakeFlow)
    assert (
        apply_flow_module.main(
            [
                "--position-id",
                "41",
                "--url",
                ASHBY_URL,
                "--profile",
                str(profile_path),
                "--cv",
                str(cv_path),
                flag,
            ]
        )
        == 0
    )
    assert observed["headless"] is expected


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool
    reason: str = "apply_allowed"
    context: dict = field(
        default_factory=lambda: {"mode": "authorised", "max_per_day": 3}
    )

    def log_line(self) -> str:
        return f"[apply-gate] {'ALLOW' if self.allowed else 'DENY'} {self.reason}"


def ashby_form(*, question: str | None = None, captcha: bool = False) -> str:
    custom = ""
    if question:
        custom = f"""
        <div class="ashby-application-form-field-entry" data-field-path="question-1">
          <label class="required-marker ashby-application-form-question-title"
                 for="question-1">{question}</label>
          <textarea id="question-1" name="question-1" required></textarea>
        </div>
        """
    challenge = '<iframe title="reCAPTCHA challenge"></iframe>' if captcha else ""
    return f"""
    <html><body>
      <form class="ashby-application-form-form">
        <div class="ashby-application-form-field-entry" data-field-path="_systemfield_name">
          <label class="required-marker ashby-application-form-question-title"
                 for="_systemfield_name">Name</label>
          <input id="_systemfield_name" name="_systemfield_name" required>
        </div>
        <div class="ashby-application-form-field-entry" data-field-path="_systemfield_email">
          <label class="required-marker ashby-application-form-question-title"
                 for="_systemfield_email">Email</label>
          <input id="_systemfield_email" name="_systemfield_email" type="email" required>
        </div>
        <div class="ashby-application-form-field-entry" data-field-path="_systemfield_resume">
          <label class="required-marker ashby-application-form-question-title"
                 for="_systemfield_resume">Resume</label>
          <input id="_systemfield_resume" type="file" required>
        </div>
        {custom}
        {challenge}
        <button class="ashby-application-form-submit-button" type="submit">
          Submit Application
        </button>
      </form>
      <script>
        window.submitCount = 0;
        document.querySelector('form').addEventListener('submit', event => {{
          event.preventDefault();
          window.submitCount += 1;
          document.body.innerHTML = '<main class="ashby-application-form-success-container">Thank you for applying.</main>';
        }});
      </script>
    </body></html>
    """


@pytest.fixture
def page():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        current = browser.new_page()
        yield current
        browser.close()


@pytest.fixture
def cv_path(tmp_path: Path) -> Path:
    path = tmp_path / "test-profile.pdf"
    path.write_bytes(b"%PDF-1.4\n% test fixture only\n")
    return path


def profile(**extra) -> dict:
    value = {
        "name": "Test Candidate",
        "contacts": {"email": "candidate@example.invalid"},
    }
    value.update(extra)
    return value


def build_flow(
    tmp_path: Path,
    cv_path: Path,
    *,
    candidate: dict | None = None,
    verdicts: list[GateVerdict] | None = None,
    notifications: list | None = None,
    recorded: list | None = None,
) -> ApplicationFlow:
    gate_results = list(verdicts or [GateVerdict(True), GateVerdict(True)])
    notifications = notifications if notifications is not None else []
    recorded = recorded if recorded is not None else []

    def gate(**_kwargs):
        return gate_results.pop(0) if len(gate_results) > 1 else gate_results[0]

    return ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
        position_id=41,
        url=ASHBY_URL,
        profile=candidate or profile(),
        cv_path=cv_path,
        checkpoint_path=tmp_path / "checkpoint.json",
        receipt_dir=tmp_path / "receipts",
        gate_checker=gate,
        notifier=lambda **kwargs: notifications.append(kwargs) or "notification-1",
        applied_recorder=lambda **kwargs: recorded.append(kwargs),
        confirmation_timeout_ms=500,
    )


def test_authorised_ashby_submission_requires_receipt_before_applied(
    page, tmp_path: Path, cv_path: Path
):
    page.set_content(ashby_form())
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied"
    assert page.locator("text=Thank you for applying.").is_visible()
    assert len(recorded) == 1
    receipt = recorded[0]["receipt"]
    assert receipt.confirmation_text == "Thank you for applying."
    assert receipt.screenshot_path.is_file()
    assert receipt.screenshot_path.stat().st_size > 0
    checkpoint = json.loads((tmp_path / "checkpoint.json").read_text())
    assert checkpoint["state"] == "complete"
    assert checkpoint["receipt"]["confirmation_text"] == "Thank you for applying."


def test_dry_run_stops_at_review_and_never_clicks_submit(
    page, tmp_path: Path, cv_path: Path
):
    page.set_content(ashby_form())
    recorded: list[dict] = []
    flow = build_flow(
        tmp_path,
        cv_path,
        verdicts=[GateVerdict(True, context={"mode": "dry_run", "max_per_day": 3})],
        recorded=recorded,
    )

    result = flow.run(page=page, navigate=False)

    assert result.status == "dry_run"
    assert page.evaluate("window.submitCount") == 0
    assert recorded == []


def test_missing_required_answer_blocks_silently_with_the_question_for_the_closer(
    page, tmp_path: Path, cv_path: Path
):
    question = "Why are you interested in working here?"
    page.set_content(ashby_form(question=question))
    notifications: list[dict] = []
    recorded: list[dict] = []
    flow = build_flow(
        tmp_path,
        cv_path,
        notifications=notifications,
        recorded=recorded,
    )

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "required_answer_missing"
    assert page.locator("#question-1").input_value() == ""
    assert page.evaluate("window.submitCount") == 0
    assert recorded == []
    # No basis check happens here: the CLOSER works the answer out, or asks.
    assert notifications == []
    assert result.to_dict()["pending_question"] == {
        "key": "why are you interested in working here",
        "label": question,
        "field_type": "textarea",
        "options": [],
        "scope": "company",
        "asked": False,
    }
    checkpoint_text = (tmp_path / "checkpoint.json").read_text()
    assert "Test Candidate" not in checkpoint_text
    assert "candidate@example.invalid" not in checkpoint_text
    assert json.loads(checkpoint_text)["completed_steps"] == [
        "detect",
        "fill",
        "upload_cv",
    ]


def test_exact_profile_answer_is_used_for_a_required_screening_question(
    page, tmp_path: Path, cv_path: Path
):
    question = "How did you hear about this opportunity?"
    page.set_content(ashby_form(question=question))
    flow = build_flow(
        tmp_path,
        cv_path,
        candidate=profile(application_answers={question: "Test job board"}),
    )

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied"


def test_visible_captcha_is_blocked_without_a_submit_attempt(
    page, tmp_path: Path, cv_path: Path
):
    page.set_content(ashby_form(captcha=True))
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "captcha"
    assert page.evaluate("window.submitCount") == 0
    assert recorded == []


def test_production_recovery_navigates_before_judging_submit_outcome(
    page, tmp_path: Path, cv_path: Path, monkeypatch
):
    checkpoint_path = tmp_path / "checkpoint.json"
    checkpoint = FlowCheckpoint.new(41, ASHBY_URL)
    checkpoint.state = "submit"
    checkpoint.submit_started = True
    checkpoint.save(checkpoint_path)
    flow = build_flow(tmp_path, cv_path)
    navigated: list[str] = []

    monkeypatch.setattr(flow, "_managed_page", lambda: contextlib.nullcontext(page))

    def navigate(active_page):
        navigated.append(active_page.url)
        active_page.set_content(ashby_form())

    monkeypatch.setattr(flow, "_navigate", navigate)

    # page=None exercises the production manager branch.  Before _navigate,
    # the yielded page is about:blank and contains no form.
    result = flow.run(page=None)

    assert result.status == "blocked_human"
    assert result.reason == "submit_outcome_unknown"
    assert navigated == ["about:blank"]
    assert page.evaluate("window.submitCount") == 0


def test_blank_browser_page_is_never_confirmation(page):
    assert page.url == "about:blank"
    assert ApplicationFlow._confirmation(page, ASHBY_URL) is None


def test_recovery_navigation_exception_becomes_notified_human_block(
    page, tmp_path: Path, cv_path: Path, monkeypatch
):
    checkpoint = FlowCheckpoint.new(41, ASHBY_URL)
    checkpoint.state = "submit"
    checkpoint.submit_started = True
    checkpoint.save(tmp_path / "checkpoint.json")
    notifications: list[dict] = []
    flow = build_flow(tmp_path, cv_path, notifications=notifications)
    monkeypatch.setattr(flow, "_managed_page", lambda: contextlib.nullcontext(page))

    def fail_navigation(_page):
        raise RuntimeError("Timeout 30000ms exceeded")

    monkeypatch.setattr(flow, "_navigate", fail_navigation)

    result = flow.run(page=None)

    assert result.status == "blocked_human"
    assert result.reason == "submit_outcome_unknown"
    assert len(notifications) == 1
    assert notifications[0]["position_id"] == 41


def test_gate_is_checked_again_immediately_before_submit(
    page, tmp_path: Path, cv_path: Path
):
    page.set_content(ashby_form())
    flow = build_flow(
        tmp_path,
        cv_path,
        verdicts=[GateVerdict(True), GateVerdict(False, "position_not_authorised")],
    )

    result = flow.run(page=page, navigate=False)

    assert result.status == "denied"
    assert result.reason == "position_not_authorised"
    assert page.evaluate("window.submitCount") == 0


def test_confirmation_text_visible_before_submit_is_ambiguous(
    page, tmp_path: Path, cv_path: Path
):
    page.set_content(
        ashby_form().replace(
            "<form class=\"ashby-application-form-form\">",
            '<p>Thank you for applying to our company values.</p><form class="ashby-application-form-form">',
        )
    )
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "confirmation_ambiguous"
    assert page.evaluate("window.submitCount") == 0
    assert recorded == []


def test_no_confirmation_means_no_applied_write(page, tmp_path: Path, cv_path: Path):
    page.set_content(ashby_form().replace(
        "document.body.innerHTML = '<main class=\"ashby-application-form-success-container\">Thank you for applying.</main>';",
        "void 0;",
    ))
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "receipt_missing"
    assert page.evaluate("window.submitCount") == 1
    assert recorded == []


def test_boolean_screening_answer_uses_ashby_yes_no_control(
    page, tmp_path: Path, cv_path: Path
):
    field = """
      <div class="ashby-application-form-field-entry" data-field-path="sponsorship-field">
        <label class="required-marker ashby-application-form-question-title">
          Will you require sponsorship?
        </label>
        <button class="ashby-application-form-input-yesno-option"
                aria-pressed="false" data-option="yes" type="button"
                onclick="this.setAttribute('aria-pressed', 'true')">Yes</button>
        <button class="ashby-application-form-input-yesno-option"
                aria-pressed="false" data-option="no" type="button"
                onclick="this.setAttribute('aria-pressed', 'true')">No</button>
        <input name="sponsorship-field" type="checkbox" tabindex="-1">
      </div>
    """
    page.set_content(ashby_form().replace("<button class=\"ashby-application-form-submit-button\"", field + "<button class=\"ashby-application-form-submit-button\""))
    flow = build_flow(
        tmp_path,
        cv_path,
        candidate=profile(application_answers={"sponsorship": False}),
        verdicts=[GateVerdict(True, context={"mode": "dry_run", "max_per_day": 3})],
    )

    result = flow.run(page=page, navigate=False)

    assert result.status == "dry_run"
    assert page.locator("button[data-option=no]").get_attribute("aria-pressed") == "true"
    assert page.evaluate("window.submitCount") == 0


def test_upload_error_blocks_before_screening(page, tmp_path: Path, cv_path: Path):
    html = ashby_form().replace(
        "window.submitCount = 0;",
        """
        document.querySelector('#_systemfield_resume').addEventListener('change', event => {
          const error = document.createElement('div');
          error.setAttribute('role', 'alert');
          error.textContent = 'Upload rejected';
          event.target.parentElement.appendChild(error);
        });
        window.submitCount = 0;
        """,
    )
    page.set_content(html)
    flow = build_flow(tmp_path, cv_path)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "upload_rejected"
    assert page.evaluate("window.submitCount") == 0


def test_default_recorder_writes_and_observes_both_applied_sides(
    tmp_path: Path, monkeypatch
):
    db_path = tmp_path / "jobs.db"
    screenshot = tmp_path / "receipt.png"
    screenshot.write_bytes(b"fixture screenshot")
    monkeypatch.setenv("JHT_DB", str(db_path))
    sys.path.insert(0, str(SKILLS))
    import _db

    conn = _db.get_db()
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions(title, company, url, status) VALUES (?, ?, ?, 'ready')",
        ("Fixture Role", "Fixture Company", ASHBY_URL),
    )
    position_id = conn.execute(
        "SELECT id FROM positions WHERE title = 'Fixture Role'"
    ).fetchone()[0]
    conn.commit()
    conn.close()

    _default_applied_recorder(
        position_id=position_id,
        receipt=Receipt(screenshot, confirmation_text="Application submitted"),
        db_path=db_path,
    )

    with sqlite3.connect(db_path) as observed:
        row = observed.execute(
            "SELECT p.status, a.status, a.applied, a.applied_at, a.applied_via "
            "FROM positions p JOIN applications a ON a.position_id = p.id "
            "WHERE p.id = ?",
            (position_id,),
        ).fetchone()
    assert row[0:3] == ("applied", "applied", 1)
    assert row[3]
    assert row[4] == "agent_closer"


def test_default_recorder_rejects_an_incomplete_receipt(tmp_path: Path):
    with pytest.raises(FlowError, match="complete receipt"):
        _default_applied_recorder(
            position_id=41,
            receipt=Receipt(tmp_path / "missing.png"),
            db_path=tmp_path / "jobs.db",
        )


def test_required_answer_round_trip_resumes_from_dashboard_reply(
    page, tmp_path: Path, cv_path: Path, monkeypatch
):
    """The durable web reply is consumed once; silence can never submit."""
    question = "Which work model can you accept?"
    field = f"""
      <div class="ashby-application-form-field-entry" data-field-path="question-work-model">
        <label class="required-marker ashby-application-form-question-title">{question}</label>
        <input id="remote" name="question-work-model" type="radio" required>
        <label for="remote">Remote</label>
        <input id="hybrid" name="question-work-model" type="radio" required>
        <label for="hybrid">Hybrid</label>
      </div>
    """
    html = ashby_form().replace(
        '<button class="ashby-application-form-submit-button"',
        field + '<button class="ashby-application-form-submit-button"',
    )

    db_path = tmp_path / "jobs.db"
    monkeypatch.setenv("JHT_DB", str(db_path))
    monkeypatch.setenv("JHT_APPLY_FLOW_NO_EXTERNAL_NOTIFY", "1")
    import _db

    conn = _db.get_db()
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions(id, title, company, url, status, apply_requested, "
        "apply_requested_at, apply_requested_by) "
        "VALUES (41, 'Fixture Role', 'Fixture Company', ?, 'ready', 1, "
        "CURRENT_TIMESTAMP, 'user_web')",
        (ASHBY_URL,),
    )
    conn.commit()
    conn.close()

    profile_path = tmp_path / "candidate_profile.yml"
    profile_path.write_text(
        "name: Test Candidate\ncontacts:\n  email: candidate@example.invalid\n",
        encoding="utf-8",
    )
    checkpoint_path = tmp_path / "checkpoint.json"
    recorded: list[dict] = []

    def new_flow() -> ApplicationFlow:
        return ApplicationFlow(
            essentials_checker=lambda **_kwargs: [],
            cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
            position_id=41,
            url=ASHBY_URL,
            profile=_load_profile(profile_path),
            profile_path=profile_path,
            cv_path=cv_path,
            checkpoint_path=checkpoint_path,
            receipt_dir=tmp_path / "receipts",
            db_path=db_path,
            gate_checker=lambda **_kwargs: GateVerdict(True),
            applied_recorder=lambda **kwargs: recorded.append(kwargs),
            confirmation_timeout_ms=500,
        )

    page.set_content(html)
    first = new_flow().run(page=page, navigate=False)

    assert first.status == "blocked_human"
    assert first.reason == "required_answer_missing"
    assert page.evaluate("window.submitCount") == 0
    with sqlite3.connect(db_path) as observed:
        assert observed.execute(
            "SELECT COUNT(*) FROM pending_user_messages WHERE related_position_id = 41"
        ).fetchone()[0] == 0
    # The CLOSER found no basis and asks explicitly.
    asked = apply_flow_module.ask_pending_question(41, db_path=db_path, checkpoint_path=checkpoint_path)
    assert asked["status"] == "asked"
    assert apply_flow_module.ask_pending_question(
        41, db_path=db_path, checkpoint_path=checkpoint_path
    )["status"] == "already_asked"
    with sqlite3.connect(db_path) as observed:
        request = observed.execute(
            "SELECT id, body, source_id, source_action, source_payload, user_reply "
            "FROM pending_user_messages WHERE related_position_id = 41"
        ).fetchone()
    assert request is not None
    assert f"Question: {question}" in request[1]
    assert "Field type: radio" in request[1]
    assert "Remote" in request[1] and "Hybrid" in request[1]
    assert request[2].startswith("closer-answer:41:")
    assert request[3] == "closer_application_answer"
    payload = json.loads(request[4])
    assert payload == {
        "field_type": "radio",
        "key": "which work model can you accept",
        "label": question,
        "options": ["Remote", "Hybrid"],
        "position_id": 41,
        "version": 1,
    }
    assert request[5] is None

    # Reverse case: a restart without a web reply must not reopen the browser,
    # create another request, submit, or mark the application applied.
    waiting_flow = new_flow()
    monkeypatch.setattr(
        waiting_flow,
        "_managed_page",
        lambda: pytest.fail("browser opened while the dashboard answer is absent"),
    )
    second = waiting_flow.run(page=None)
    assert second.status == "blocked_human"
    assert second.reason == "required_answer_missing"
    assert page.evaluate("window.submitCount") == 0
    assert recorded == []
    with sqlite3.connect(db_path) as observed:
        assert observed.execute(
            "SELECT COUNT(*) FROM pending_user_messages WHERE related_position_id = 41"
        ).fetchone()[0] == 1

        # Same columns written by POST /api/pending-messages/[id]/reply after
        # the authenticated dashboard accepts the user's exact option.
        blocked_at = json.loads(checkpoint_path.read_text(encoding="utf-8"))[
            "updated_at"
        ]
        reply_instant = max(
            datetime.now(timezone.utc),
            datetime.fromisoformat(blocked_at) + timedelta(milliseconds=1),
        )
        reply_at = reply_instant.isoformat(timespec="milliseconds")
        assert datetime.fromisoformat(reply_at) > datetime.fromisoformat(blocked_at)
        observed.execute(
            "UPDATE pending_user_messages SET user_reply = ?, "
            "user_reply_at = ?, acknowledged_at = ? "
            "WHERE id = ?",
            ("Remote", reply_at, reply_at, request[0]),
        )
        # The authenticated reply route renews the same per-position permit;
        # this newer user action is what releases apply_gate.application_queue.
        observed.execute(
            "UPDATE positions SET apply_requested = 1, apply_requested_at = ?, "
            "apply_requested_by = 'user_web' WHERE id = 41",
            (reply_at,),
        )
        observed.commit()

    page.set_content(html)
    resumed = new_flow().run(page=page, navigate=False)

    assert resumed.status == "applied"
    assert page.evaluate("window.submitCount") == 1
    assert len(recorded) == 1
    # The answer lives in jobs.db now, where the email channel and a new
    # session read it; the YAML profile is left as the user wrote it.
    with sqlite3.connect(db_path) as observed:
        assert observed.execute(
            "SELECT key, answer_json, channel, source_message_id FROM application_answers"
        ).fetchall() == [("which work model can you accept", '"Remote"', "reply", request[0])]
    assert "application_answers" not in _load_profile(profile_path)
    with sqlite3.connect(db_path) as observed:
        seen = observed.execute(
            "SELECT agent_seen_reply_at FROM pending_user_messages WHERE id = ?",
            (request[0],),
        ).fetchone()[0]
        authorisation = observed.execute(
            "SELECT apply_requested, apply_requested_at, apply_requested_by "
            "FROM positions WHERE id = 41"
        ).fetchone()
    assert seen
    assert authorisation == (1, reply_at, "user_web")
    checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
    assert checkpoint["state"] == "complete"
    assert checkpoint["answer_request"] is None


def test_dashboard_choice_must_match_an_offered_option_exactly():
    request = {
        "payload": {
            "field_type": "radio",
            "options": ["Remote", "Hybrid"],
        }
    }

    assert ApplicationFlow._decode_answer_reply(request, "Remote") == "Remote"
    with pytest.raises(FlowError, match="exact offered option"):
        ApplicationFlow._decode_answer_reply(request, "remote")
    with pytest.raises(FlowError, match="exact offered option"):
        ApplicationFlow._decode_answer_reply(request, "Mostly remote")


def test_an_explicit_ask_keeps_the_durable_request_when_the_notifier_fails(
    page, tmp_path: Path, cv_path: Path
):
    db_path = tmp_path / "jobs.db"
    import _db

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions(id, title, company, url, status) "
        "VALUES (41, 'Fixture Role', 'Fixture Company', ?, 'ready')",
        (ASHBY_URL,),
    )
    conn.commit()
    conn.close()

    def failed_notifier(**_kwargs):
        raise RuntimeError("fixture notifier unavailable")

    page.set_content(ashby_form(question="Fixture question?"))
    flow = build_flow(tmp_path, cv_path)
    flow.db_path = db_path
    assert flow.run(page=page, navigate=False).reason == "required_answer_missing"

    asked = apply_flow_module.ask_pending_question(
        41, "Fixture question?", db_path=db_path, checkpoint_path=tmp_path / "checkpoint.json",
        notifier=failed_notifier,
    )

    assert asked["status"] == "asked"
    with sqlite3.connect(db_path) as observed:
        row = observed.execute(
            "SELECT body, source_action FROM pending_user_messages "
            "WHERE related_position_id = 41"
        ).fetchone()
    assert row is not None
    assert "Question: Fixture question?" in row[0]
    assert row[1] == "closer_application_answer"
    assert apply_flow_module.ask_pending_question(
        41, "another question", db_path=db_path, checkpoint_path=tmp_path / "checkpoint.json"
    )["status"] == "not_pending"


def _answers_db(tmp_path: Path) -> Path:
    import _db

    db_path = tmp_path / "jobs.db"
    with contextlib.closing(sqlite3.connect(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        _db.ensure_schema(conn)
        conn.execute(
            "INSERT INTO positions(id, title, company, url, status) "
            "VALUES (41, 'Fixture Role', 'Fixture Company', ?, 'ready')",
            (ASHBY_URL,),
        )
        conn.commit()
    return db_path


def test_a_form_question_never_goes_to_the_user_by_itself_in_any_mode(
    page, tmp_path: Path, cv_path: Path
):
    db_path = _answers_db(tmp_path)
    notifications: list[dict] = []

    def requests() -> list:
        with contextlib.closing(sqlite3.connect(db_path)) as conn:
            return conn.execute(
                "SELECT source_action FROM pending_user_messages WHERE related_position_id = 41"
            ).fetchall()

    for mode in ("dry_run", "authorised"):
        page.set_content(ashby_form(question="Why do you want to join us?"))
        flow = build_flow(
            tmp_path,
            cv_path,
            verdicts=[GateVerdict(True, context={"mode": mode, "max_per_day": 3})],
            notifications=notifications,
        )
        flow.db_path = db_path
        result = flow.run(page=page, navigate=False)

        assert (result.status, result.reason) == ("blocked_human", "required_answer_missing")
        assert result.pending_question["key"] == "why do you want to join us"
        request = _read_checkpoint(tmp_path)["answer_request"]
        assert (request["asked"], request["message_id"]) == (False, "")
        assert notifications == []
        assert requests() == []
        assert page.evaluate("window.submitCount") == 0


def test_an_answer_the_closer_saves_completes_the_flow_without_asking(
    page, tmp_path: Path, cv_path: Path, monkeypatch
):
    import application_answers

    db_path = _answers_db(tmp_path)
    notifications: list[dict] = []
    question = "Why do you want to join us?"

    def flow() -> ApplicationFlow:
        built = build_flow(tmp_path, cv_path, notifications=notifications)
        built.db_path = db_path
        return built

    page.set_content(ashby_form(question=question))
    assert flow().run(page=page, navigate=False).reason == "required_answer_missing"

    # What `application_answers.py save --basis vacancy --position-id 41` writes.
    with contextlib.closing(sqlite3.connect(db_path)) as conn:
        application_answers.save_answer(
            conn,
            key="why do you want to join us",
            label=question,
            answer="Synthetic motivation written from the vacancy.",
            field_type="textarea",
            channel="agent_inferred",
            scope=application_answers.answer_scope(conn, "textarea", 41),
        )
        conn.commit()

    page.set_content(ashby_form(question=question))
    resumed = flow().run(page=page, navigate=False)

    assert resumed.status == "applied"
    assert page.evaluate("window.submitCount") == 1
    assert notifications == []
    checkpoint = _read_checkpoint(tmp_path)
    assert checkpoint["answer_request"] is None
    assert checkpoint["answer_sources"] == {
        "name": "profile",
        "email": "profile",
        "why do you want to join us": "agent_inferred",
    }
    assert resumed.receipt.answer_sources == checkpoint["answer_sources"]
    assert "Synthetic motivation" not in json.dumps(checkpoint)


def test_the_explicit_ask_sends_the_question_once(page, tmp_path: Path, cv_path: Path):
    db_path = _answers_db(tmp_path)
    notifications: list[dict] = []
    page.set_content(ashby_form(question="Do you hold a synthetic licence?"))
    flow = build_flow(tmp_path, cv_path, notifications=notifications)
    flow.db_path = db_path
    assert flow.run(page=page, navigate=False).reason == "required_answer_missing"

    asked = apply_flow_module.ask_pending_question(
        41, db_path=db_path, checkpoint_path=tmp_path / "checkpoint.json",
        notifier=lambda **kwargs: notifications.append(kwargs) or "1",
    )
    again = apply_flow_module.ask_pending_question(
        41, db_path=db_path, checkpoint_path=tmp_path / "checkpoint.json",
        notifier=lambda **kwargs: notifications.append(kwargs) or "1",
    )

    assert (asked["status"], again["status"]) == ("asked", "already_asked")
    assert len(notifications) == 1
    assert "Question: Do you hold a synthetic licence?" in notifications[0]["message"]
    assert _read_checkpoint(tmp_path)["answer_request"]["asked"] is True


def test_the_ask_command_without_a_pending_question_asks_nothing(tmp_path: Path, cv_path: Path, capsys):
    code = apply_flow_module.main([
        "--position-id", "41", "--url", ASHBY_URL, "--profile", str(tmp_path / "none.yml"),
        "--cv", str(cv_path), "--checkpoint", str(tmp_path / "checkpoint.json"), "--ask",
    ])

    assert code == 3
    assert json.loads(capsys.readouterr().out) == {"source_id": "", "status": "not_pending"}


# ── A vacancy that is no longer open ────────────────────────────────────────
#
# Seen live on two positions: the page said the vacancy was closed, or its URL
# redirected to the company's job list / "Book a demo", and the flow went on.
# A closed vacancy stops in detect as `vacancy_closed`, touches no field, and a
# rerun does not reopen the browser.


CLOSED_NOTICES = [
    ("en", "This job is no longer available."),
    ("en", "We are no longer accepting applications for this role."),
    ("en", "The job you are looking for is no longer open."),
    ("en", "This posting has expired."),
    ("it", "Questa posizione non è più disponibile."),
    ("it", "L'annuncio è scaduto."),
    ("de", "Diese Stelle ist leider nicht mehr verfügbar."),
    ("fr", "Cette offre n’est plus disponible."),
    ("es", "Esta oferta ya no está disponible."),
    ("pt", "Esta vaga não está mais disponível."),
    ("hu", "Ez az állás már nem elérhető."),
]


@pytest.mark.parametrize(("language", "notice"), CLOSED_NOTICES)
def test_closed_vacancy_notice_is_recognised_in_several_languages(language: str, notice: str):
    page_text = f"Careers\nBook a demo\n{notice}\nSee all open roles"
    assert apply_flow_module.vacancy_closed_evidence(page_text) == language


@pytest.mark.parametrize(
    "text",
    [
        "We no longer use legacy tooling, and the role is open to remote candidates.",
        "Applications are reviewed on a rolling basis.",
        "Posizione aperta: la selezione è in corso, inviaci la tua candidatura.",
        "Die Stelle ist ab sofort verfügbar.",
        # Seen in review: open job descriptions that name filling or closing.
        "This position will remain open until it has been filled.",
        "We will contact shortlisted candidates once the role has been filled.",
        "Applications are closed on 30 September 2026, apply soon.",
        "Job not found? Search all openings.",
        "Bitte senden Sie keine Bewerbungen mehr per Post, nur online.",
        "Il ruolo prevede che l'offerta non è più valida oltre 30 giorni dalla firma.",
        "We are no longer accepting applications from recruitment agencies.",
        "Please note we are no longer accepting applications by email, apply below.",
        "",
    ],
)
def test_job_description_wording_is_not_a_closed_notice(text: str):
    assert apply_flow_module.vacancy_closed_evidence(text) is None


@pytest.mark.parametrize(
    ("requested", "final", "away"),
    [
        (ASHBY_URL, "https://jobs.ashbyhq.com/example", True),
        (ASHBY_URL, ASHBY_URL.removesuffix("/application"), False),
        (ASHBY_URL, ASHBY_URL + "?utm_source=board", False),
        (
            "https://boards.greenhouse.io/example/jobs/1001",
            "https://job-boards.greenhouse.io/example/jobs/1001?gh_jid=1001",
            False,
        ),
        (
            "https://job-boards.greenhouse.io/example/jobs/1001",
            "https://job-boards.greenhouse.io/example?error=true",
            True,
        ),
        ("https://careers.example.invalid/jobs/senior-engineer", "https://careers.example.invalid/jobs/senior-engineer/", False),
        ("https://careers.example.invalid/jobs/senior-engineer", "https://careers.example.invalid/", True),
        ("https://careers.example.invalid/jobs/senior-engineer", "https://careers.example.invalid/jobs", True),
        ("https://careers.example.invalid/jobs/senior-engineer", "https://www.example.invalid/", True),
        # No identifier and not a shorter prefix: no conclusion.
        ("https://careers.example.invalid/jobs/senior-engineer", "https://www.example.invalid/book-a-demo", False),
        ("https://example.invalid/careers/senior-engineer", "https://example.invalid/en/careers/senior-engineer", False),
        ("https://example.invalid/careers/senior-engineer", "https://careers.example.invalid/senior-engineer", False),
        ("https://example.invalid/careers/senior-engineer/apply", "https://example.invalid/careers/senior-engineer", False),
        ("https://example.invalid/careers/senior-engineer/apply", "https://example.invalid/careers", True),
        (ASHBY_URL, "chrome-error://chromewebdata/", True),
    ],
)
def test_redirect_away_from_the_vacancy_is_told_apart_from_a_harmless_one(
    requested: str, final: str, away: bool
):
    assert apply_flow_module.vacancy_redirected_away(requested, final) is away


def _read_checkpoint(tmp_path: Path) -> dict:
    return json.loads((tmp_path / "checkpoint.json").read_text(encoding="utf-8"))


def test_closed_notice_stops_before_any_field_is_touched(page, tmp_path: Path, cv_path: Path):
    page.set_content(
        "<html><body><h1>Senior Engineer</h1><p>This job is no longer available.</p>"
        "<form><input id='_systemfield_name'></form></body></html>"
    )
    notifications: list[dict] = []
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, notifications=notifications, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "vacancy_closed")
    assert page.eval_on_selector("#_systemfield_name", "element => element.value") == ""
    assert recorded == []
    checkpoint = _read_checkpoint(tmp_path)
    assert checkpoint["completed_steps"] == []
    assert checkpoint["submit_started"] is False
    assert checkpoint["blocked_reason"] == "vacancy_closed"
    assert len(notifications) == 1
    # Employer text stays out of the checkpoint and the notification.
    assert "no longer available" not in json.dumps(checkpoint)
    assert "no longer available" not in json.dumps(notifications)


def _serve(page, body: str) -> None:
    page.route(
        "https://jobs.ashbyhq.com/**",
        lambda route: route.fulfill(status=200, content_type="text/html", body=body),
    )


def test_redirect_to_the_job_list_is_a_closed_vacancy_even_with_a_form_there(
    page, tmp_path: Path, cv_path: Path, monkeypatch
):
    # The landing page carries a form: only the redirect says it is not the vacancy.
    _serve(page, ashby_form())
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)
    monkeypatch.setattr(flow, "_managed_page", lambda: contextlib.nullcontext(page))
    monkeypatch.setattr(flow, "_navigate", lambda active: active.goto("https://jobs.ashbyhq.com/example"))

    result = flow.run(page=None)

    assert (result.status, result.reason) == ("blocked_human", "vacancy_closed")
    assert "redirected" in _read_checkpoint(tmp_path)["blocked_detail"]
    assert page.evaluate("window.submitCount") == 0
    assert recorded == []


def test_a_redirect_that_keeps_the_vacancy_still_applies(
    page, tmp_path: Path, cv_path: Path, monkeypatch
):
    _serve(page, ashby_form())
    flow = build_flow(tmp_path, cv_path)
    monkeypatch.setattr(flow, "_managed_page", lambda: contextlib.nullcontext(page))
    monkeypatch.setattr(flow, "_navigate", lambda active: active.goto(ASHBY_URL + "?utm_source=board"))

    assert flow.run(page=None).status == "applied"


def test_no_form_and_no_apply_control_without_a_notice_is_not_called_closed(
    page, tmp_path: Path, cv_path: Path
):
    # A localised board or a slow render: honest, not final.
    page.set_content("<html><body><h1>Senior Engineer</h1><button>Bewerben</button></body></html>")

    result = build_flow(tmp_path, cv_path).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "ashby_form_missing")


def test_a_closed_notice_next_to_a_form_is_not_evidence(page, tmp_path: Path, cv_path: Path):
    page.set_content(
        ashby_form().replace("<html><body>", "<html><body><p>This job is no longer available.</p>")
    )

    assert build_flow(tmp_path, cv_path).run(page=page, navigate=False).status == "applied"


def test_a_closed_notice_next_to_an_apply_control_is_not_evidence(page, tmp_path: Path, cv_path: Path):
    page.set_content(
        "<html><body><p>This job is no longer available.</p><a href='#'>Apply for this Job</a></body></html>"
    )

    result = build_flow(tmp_path, cv_path).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "ashby_form_missing")


def test_a_closed_notice_on_an_unsupported_page_without_email_is_closed(page, tmp_path: Path, cv_path: Path):
    page.set_content("<html><body><h1>Senior Engineer</h1><p>Esta oferta ya no está disponible.</p></body></html>")
    flow = build_flow(tmp_path, cv_path)
    flow.url = "https://careers.example.invalid/jobs/senior-engineer"
    flow.checkpoint_path = tmp_path / "checkpoint.json"

    result = flow.run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "vacancy_closed")


@pytest.mark.parametrize(
    "control",
    ["<form action='/submit'><input name='q'></form>", "<a href='/jobs/senior-engineer/apply'>Apply now</a>"],
)
def test_a_closed_notice_on_an_unsupported_page_with_a_form_or_apply_is_not_evidence(
    page, tmp_path: Path, cv_path: Path, control: str
):
    page.set_content(f"<html><body><p>Esta oferta ya no está disponible.</p>{control}</body></html>")
    flow = build_flow(tmp_path, cv_path)
    flow.url = "https://careers.example.invalid/jobs/senior-engineer"

    result = flow.run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "ats_unsupported")


def test_a_failed_checkpoint_save_leaves_no_orphan_screenshot(
    page, tmp_path: Path, cv_path: Path, monkeypatch
):
    page.set_content(ashby_form(captcha=True))
    flow = build_flow(tmp_path, cv_path)
    real_save = FlowCheckpoint.save

    def failing_save(self, path):
        if self.state == "blocked_human":
            raise OSError("synthetic disk full")
        return real_save(self, path)

    monkeypatch.setattr(FlowCheckpoint, "save", failing_save)

    with pytest.raises(OSError):
        flow.run(page=page, navigate=False)

    assert list(tmp_path.glob("checkpoint.stop-*")) == []


def test_an_apply_control_that_opens_nothing_is_not_called_closed(page, tmp_path: Path, cv_path: Path):
    page.set_content("<html><body><h1>Senior Engineer</h1><a href='#'>Apply for this Job</a></body></html>")

    result = build_flow(tmp_path, cv_path).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "ashby_form_missing")


def test_a_closed_vacancy_is_not_retried_blindly(page, tmp_path: Path, cv_path: Path, monkeypatch):
    page.set_content("<html><body><p>Applications are closed.</p></body></html>")
    notifications: list[dict] = []
    assert build_flow(tmp_path, cv_path, notifications=notifications).run(
        page=page, navigate=False
    ).reason == "vacancy_closed"

    rerun = build_flow(tmp_path, cv_path, notifications=notifications)
    opened: list[str] = []
    monkeypatch.setattr(rerun, "_managed_page", lambda: opened.append("browser") or contextlib.nullcontext(page))
    result = rerun.run(page=None)

    assert (result.status, result.reason) == ("blocked_human", "vacancy_closed")
    assert opened == []
    assert len(notifications) == 1


@pytest.mark.parametrize(("minutes", "reopened"), [(-5, False), (5, True)])
def test_only_a_new_user_authorisation_looks_at_a_closed_vacancy_again(
    page, tmp_path: Path, cv_path: Path, monkeypatch, minutes: int, reopened: bool
):
    page.set_content("<html><body><p>Applications are closed.</p></body></html>")
    build_flow(tmp_path, cv_path).run(page=page, navigate=False)
    stopped = datetime.fromisoformat(_read_checkpoint(tmp_path)["updated_at"])
    at = (stopped + timedelta(minutes=minutes)).isoformat().replace("+00:00", "Z")
    verdict = GateVerdict(True, context={"mode": "authorised", "max_per_day": 3, "at": at})

    page.set_content(ashby_form())
    result = build_flow(tmp_path, cv_path, verdicts=[verdict, verdict]).run(page=page, navigate=False)

    assert (result.status == "applied") is reopened
    assert (page.evaluate("window.submitCount") == 1) is reopened


# ── A screenshot at every stop ───────────────────────────────────────────────


STOP_SCREENSHOT_NAME = r"^checkpoint\.stop-\d{8}T\d{12}Z-{reason}\.png$"


def _assert_stop_screenshot(tmp_path: Path, reason: str) -> Path:
    import re
    import stat

    recorded = _read_checkpoint(tmp_path)["stop_screenshot"]
    shot = Path(recorded)
    assert shot.parent == tmp_path
    assert re.match(STOP_SCREENSHOT_NAME.replace("{reason}", reason), shot.name), shot.name
    for private in ("test candidate", "candidate@example", "test-profile"):
        assert private not in shot.name.casefold()
    assert shot.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert stat.S_IMODE(shot.stat().st_mode) == 0o600
    return shot


def test_a_blocked_stop_saves_a_screenshot_next_to_the_checkpoint(page, tmp_path: Path, cv_path: Path):
    page.set_content(ashby_form(captcha=True))

    result = build_flow(tmp_path, cv_path).run(page=page, navigate=False)

    assert result.reason == "captcha"
    _assert_stop_screenshot(tmp_path, "captcha")


def test_a_denied_stop_before_submit_saves_a_screenshot(page, tmp_path: Path, cv_path: Path):
    page.set_content(ashby_form())
    flow = build_flow(
        tmp_path, cv_path, verdicts=[GateVerdict(True), GateVerdict(False, "apply_not_requested")]
    )

    result = flow.run(page=page, navigate=False)

    assert (result.status, result.reason) == ("denied", "apply_not_requested")
    _assert_stop_screenshot(tmp_path, "apply_not_requested")


def test_a_browser_error_stop_saves_a_screenshot(page, tmp_path: Path, cv_path: Path, monkeypatch):
    page.set_content(ashby_form())

    def broken(self, _page):
        raise RuntimeError("synthetic browser failure")

    monkeypatch.setattr(apply_flow_module.AshbyRecipe, "fill_core", broken)

    result = build_flow(tmp_path, cv_path).run(page=page, navigate=False)

    assert result.reason == "browser_uncertainty"
    _assert_stop_screenshot(tmp_path, "browser_uncertainty")


def test_a_new_stop_replaces_the_previous_screenshot(page, tmp_path: Path, cv_path: Path):
    page.set_content(ashby_form(captcha=True))
    build_flow(tmp_path, cv_path).run(page=page, navigate=False)
    first = _assert_stop_screenshot(tmp_path, "captcha")

    page.set_content(ashby_form(captcha=True))
    build_flow(tmp_path, cv_path).run(page=page, navigate=False)
    second = _assert_stop_screenshot(tmp_path, "captcha")

    assert second != first
    assert not first.exists()
    assert sorted(p.name for p in tmp_path.glob("checkpoint.stop-*")) == [second.name]


def test_a_failed_screenshot_never_breaks_the_stop(page, tmp_path: Path, cv_path: Path):
    class NoScreenshot:
        def __init__(self, inner):
            self._inner = inner

        def screenshot(self, **_kwargs):
            raise RuntimeError("synthetic screenshot failure")

        def __getattr__(self, name):
            return getattr(self._inner, name)

    page.set_content(ashby_form(captcha=True))
    notifications: list[dict] = []

    result = build_flow(tmp_path, cv_path, notifications=notifications).run(
        page=NoScreenshot(page), navigate=False
    )

    assert (result.status, result.reason) == ("blocked_human", "captcha")
    assert _read_checkpoint(tmp_path)["stop_screenshot"] == ""
    assert len(notifications) == 1
    assert [p.name for p in tmp_path.iterdir() if ".stop-" in p.name] == []


def test_a_denial_before_any_page_opens_has_no_screenshot(tmp_path: Path, cv_path: Path):
    flow = build_flow(tmp_path, cv_path, verdicts=[GateVerdict(False, "apply_not_requested")])

    result = flow.run(page=None)

    assert result.status == "denied"
    assert _read_checkpoint(tmp_path)["stop_screenshot"] == ""


def test_a_checkpoint_with_a_non_text_screenshot_is_refused(tmp_path: Path):
    checkpoint = FlowCheckpoint.new(41, ASHBY_URL)
    checkpoint.save(tmp_path / "checkpoint.json")
    raw = _read_checkpoint(tmp_path)
    raw["stop_screenshot"] = ["../elsewhere.png"]
    (tmp_path / "checkpoint.json").write_text(json.dumps(raw), encoding="utf-8")

    with pytest.raises(FlowError):
        FlowCheckpoint.load(tmp_path / "checkpoint.json", 41, ASHBY_URL)


@pytest.mark.parametrize("victim", ["elsewhere/checkpoint.stop-keep.png", "keep-me.png"])
def test_a_tampered_screenshot_path_is_never_deleted(page, tmp_path: Path, cv_path: Path, victim: str):
    target = tmp_path / victim
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"not ours")
    checkpoint = FlowCheckpoint.new(41, ASHBY_URL)
    checkpoint.stop_screenshot = str(target)
    checkpoint.save(tmp_path / "checkpoint.json")
    page.set_content(ashby_form(captcha=True))

    build_flow(tmp_path, cv_path).run(page=page, navigate=False)

    _assert_stop_screenshot(tmp_path, "captcha")
    assert target.read_bytes() == b"not ours"


def test_missing_essential_facts_are_listed_for_the_closer_without_asking(tmp_path: Path, cv_path: Path):
    notifications: list[dict] = []
    flow = build_flow(tmp_path, cv_path, notifications=notifications)
    flow.essentials_checker = lambda **_kwargs: ["sponsorship", "salary expectations"]

    result = flow.run(page=object(), navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "essential_facts_missing")
    assert result.to_dict()["missing"] == ["sponsorship", "salary expectations"]
    assert notifications == []


def test_answer_sources_keep_only_known_origins_and_never_values():
    receipt = Receipt.from_dict({
        "screenshot_path": "/tmp/none.png",
        "confirmation_text": "Thank you",
        "answer_sources": {"phone": "user", "motivation": "agent_inferred", "salary": "Synthetic 50000 EUR", 3: "user"},
    })
    assert receipt.answer_sources == {"phone": "user", "motivation": "agent_inferred"}
    assert receipt.to_dict()["answer_sources"] == {"phone": "user", "motivation": "agent_inferred"}


def _cli(tmp_path: Path, *args: str) -> tuple[int, dict]:
    import os
    import subprocess

    env = {
        **os.environ,
        "JHT_HOME": str(tmp_path),
        "JHT_DB": str(tmp_path / "jobs.db"),
        "JHT_APPLY_FLOW_NO_EXTERNAL_NOTIFY": "1",
    }
    done = subprocess.run(
        [sys.executable, str(SKILLS / "application_answers.py"), *args, "--json"],
        capture_output=True, text=True, env=env, timeout=60,
    )
    return done.returncode, json.loads(done.stdout.strip().splitlines()[-1])


def test_end_to_end_the_closer_saves_with_the_cli_and_the_flow_completes(page, tmp_path: Path, cv_path: Path):
    db_path = _answers_db(tmp_path)
    question = "Why do you want to join us?"
    notifications: list[dict] = []

    def flow() -> ApplicationFlow:
        built = build_flow(tmp_path, cv_path, notifications=notifications)
        built.db_path = db_path
        return built

    page.set_content(ashby_form(question=question))
    stop = flow().run(page=page, navigate=False).to_dict()
    pending = stop["pending_question"]

    code, saved = _cli(
        tmp_path, "save", "--key", pending["key"], "--label", pending["label"],
        "--value", "Synthetic motivation written from the vacancy.",
        "--field-type", pending["field_type"], "--basis", "vacancy", "--position-id", "41", "--db", str(db_path),
    )
    assert code == 0, saved

    page.set_content(ashby_form(question=question))
    resumed = flow().run(page=page, navigate=False)

    assert resumed.status == "applied"
    assert notifications == []
    assert resumed.receipt.answer_sources["why do you want to join us"] == "agent_inferred"


def test_end_to_end_the_closer_asks_with_the_cli_when_it_has_no_basis(page, tmp_path: Path, cv_path: Path):
    db_path = _answers_db(tmp_path)
    checkpoint_path = tmp_path / ".cache" / "apply-flow" / "41.json"
    page.set_content(ashby_form(question="Do you hold a synthetic licence?"))
    flow = build_flow(tmp_path, cv_path)
    flow.db_path = db_path
    flow.checkpoint_path = checkpoint_path
    pending = flow.run(page=page, navigate=False).pending_question

    code, asked = _cli(tmp_path, "ask", "--position-id", "41", "--key", pending["key"], "--db", str(db_path))

    assert code == 0, asked
    with sqlite3.connect(db_path) as conn:
        assert conn.execute(
            "SELECT source_action FROM pending_user_messages WHERE related_position_id = 41"
        ).fetchall() == [("closer_application_answer",)]
    assert json.loads(checkpoint_path.read_text())["answer_request"]["asked"] is True


WORK_MODEL = "Which work model can you accept?"


def _radio_form() -> str:
    field = f"""
      <div class="ashby-application-form-field-entry" data-field-path="question-work-model">
        <label class="required-marker ashby-application-form-question-title">{WORK_MODEL}</label>
        <input id="remote" name="question-work-model" type="radio" required>
        <label for="remote">Remote</label>
        <input id="hybrid" name="question-work-model" type="radio" required>
        <label for="hybrid">Hybrid</label>
      </div>
    """
    return ashby_form().replace(
        '<button class="ashby-application-form-submit-button"',
        field + '<button class="ashby-application-form-submit-button"',
    )


def _save_inferred(db_path: Path, key: str, value, field_type: str = "radio", channel: str = "agent_inferred"):
    import application_answers

    with contextlib.closing(sqlite3.connect(db_path)) as conn:
        application_answers.save_answer(
            conn, key=key, label=key, answer=value, field_type=field_type, channel=channel, basis="judgement"
        ) if channel == "agent_inferred" else application_answers.save_answer(
            conn, key=key, label=key, answer=value, field_type=field_type, channel=channel
        )
        conn.commit()


def test_a_saved_answer_that_is_not_an_exact_option_keeps_the_question_open(page, tmp_path: Path, cv_path: Path):
    db_path = _answers_db(tmp_path)

    def flow() -> ApplicationFlow:
        built = build_flow(tmp_path, cv_path)
        built.db_path = db_path
        return built

    page.set_content(ashby_form(question="Why do you want to join us?"))
    first = flow().run(page=page, navigate=False)
    assert first.reason == "required_answer_missing"
    # Saved with a type the question does not have: an empty textarea answer is no answer.
    _save_inferred(db_path, "why do you want to join us", "   ", field_type="text")

    rerun = flow().run(page=page, navigate=False)

    assert (rerun.status, rerun.reason) == ("blocked_human", "required_answer_missing")
    assert rerun.pending_question["key"] == "why do you want to join us"
    assert _read_checkpoint(tmp_path)["answer_request"] is not None


def test_a_worked_out_option_the_form_refuses_becomes_the_question_again(page, tmp_path: Path, cv_path: Path):
    db_path = _answers_db(tmp_path)
    notifications: list[dict] = []
    # An older worked-out answer whose wording is not one of this form's options.
    _save_inferred(db_path, "which work model can you accept", "Remote-first")
    page.set_content(_radio_form())
    flow = build_flow(tmp_path, cv_path, notifications=notifications)
    flow.db_path = db_path

    result = flow.run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "required_answer_missing")
    assert result.pending_question["options"] == ["Remote", "Hybrid"]
    assert notifications == []
    assert page.evaluate("window.submitCount") == 0

    # The CLOSER corrects itself with an exact option, and the flow completes.
    _save_inferred(db_path, "which work model can you accept", "Remote")
    page.set_content(_radio_form())
    again = build_flow(tmp_path, cv_path, notifications=notifications)
    again.db_path = db_path
    assert again.run(page=page, navigate=False).status == "applied"


def test_a_user_option_the_form_refuses_stays_a_human_stop(page, tmp_path: Path, cv_path: Path):
    db_path = _answers_db(tmp_path)
    _save_inferred(db_path, "which work model can you accept", "Remote-first", channel="telegram")
    page.set_content(_radio_form())
    flow = build_flow(tmp_path, cv_path)
    flow.db_path = db_path

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason != "required_answer_missing"
    assert result.pending_question is None


def test_a_worked_out_value_outside_the_options_does_not_reopen_the_browser(
    page, tmp_path: Path, cv_path: Path, monkeypatch
):
    db_path = _answers_db(tmp_path)
    page.set_content(_radio_form())
    first = build_flow(tmp_path, cv_path)
    first.db_path = db_path
    assert first.run(page=page, navigate=False).reason == "required_answer_missing"
    _save_inferred(db_path, "which work model can you accept", "Remote-first")

    rerun = build_flow(tmp_path, cv_path)
    rerun.db_path = db_path
    monkeypatch.setattr(rerun, "_managed_page", lambda: pytest.fail("browser reopened for an answer that cannot fit"))
    result = rerun.run(page=None)

    assert (result.status, result.reason) == ("blocked_human", "required_answer_missing")
    assert result.pending_question["options"] == ["Remote", "Hybrid"]


def _refusing_text_form() -> str:
    """A text question whose field the page empties after every input: answer_not_accepted."""
    field = """
      <div class="ashby-application-form-field-entry" data-field-path="question-work-model">
        <label class="required-marker ashby-application-form-question-title"
               for="work-model">Which work model can you accept?</label>
        <input id="work-model" name="question-work-model" type="text" required>
      </div>
    """
    return ashby_form().replace(
        '<button class="ashby-application-form-submit-button"',
        field + '<button class="ashby-application-form-submit-button"',
    ).replace(
        "window.submitCount = 0;",
        """
        document.querySelector('#work-model').addEventListener('input', event => { event.target.value = ''; });
        window.submitCount = 0;
        """,
    )


def test_the_same_refused_value_twice_stops_the_loop_until_an_explicit_ask(
    page, tmp_path: Path, cv_path: Path, monkeypatch
):
    db_path = _answers_db(tmp_path)
    notifications: list[dict] = []
    _save_inferred(db_path, "which work model can you accept", "Remote", field_type="text")

    def run(page_obj=None):
        flow = build_flow(tmp_path, cv_path, notifications=notifications)
        flow.db_path = db_path
        if page_obj is None:
            monkeypatch.setattr(flow, "_managed_page", lambda: pytest.fail("browser reopened on a value refused twice"))
            return flow.run(page=None)
        return flow.run(page=page_obj, navigate=False)

    page.set_content(_refusing_text_form())
    first = run(page)
    assert (first.status, first.reason) == ("blocked_human", "required_answer_missing")

    # The CLOSER saves the same value again: the form refuses it a second time.
    page.set_content(_refusing_text_form())
    second = run(page)
    assert (second.status, second.reason) == ("blocked_human", "answer_not_accepted")
    assert second.pending_question["key"] == "which work model can you accept"
    checkpoint = _read_checkpoint(tmp_path)
    assert checkpoint["answer_refusals"]["which work model can you accept"]["count"] == 2
    assert "Remote" not in json.dumps(checkpoint["answer_refusals"])

    # Rerun with the same saved value: no browser, same stop, nothing sent.
    third = run()
    assert (third.status, third.reason) == ("blocked_human", "answer_not_accepted")
    assert notifications == []

    # Only the explicit ask sends the question.
    asked = apply_flow_module.ask_pending_question(
        41, db_path=db_path, checkpoint_path=tmp_path / "checkpoint.json",
        notifier=lambda **kwargs: notifications.append(kwargs) or "1",
    )
    assert asked["status"] == "asked" and len(notifications) == 1


def test_a_different_worked_out_value_gets_its_own_tries(page, tmp_path: Path, cv_path: Path):
    db_path = _answers_db(tmp_path)
    _save_inferred(db_path, "which work model can you accept", "Remote", field_type="text")

    def run():
        flow = build_flow(tmp_path, cv_path)
        flow.db_path = db_path
        page.set_content(_refusing_text_form())
        return flow.run(page=page, navigate=False)

    assert run().reason == "required_answer_missing"
    _save_inferred(db_path, "which work model can you accept", "Hybrid", field_type="text")
    assert run().reason == "required_answer_missing"
    assert _read_checkpoint(tmp_path)["answer_refusals"]["which work model can you accept"]["count"] == 1


@pytest.mark.parametrize(
    "refusals",
    [[], {"k": "Remote"}, {"k": {"digest": "abc", "count": "2"}}, {"k": {"digest": 1, "count": 2}}, {"k": {"digest": "a", "count": True}}],
)
def test_answer_refusals_in_a_checkpoint_are_validated(tmp_path: Path, refusals):
    FlowCheckpoint.new(41, ASHBY_URL).save(tmp_path / "checkpoint.json")
    raw = _read_checkpoint(tmp_path)
    raw["answer_refusals"] = refusals
    (tmp_path / "checkpoint.json").write_text(json.dumps(raw), encoding="utf-8")

    with pytest.raises(FlowError):
        FlowCheckpoint.load(tmp_path / "checkpoint.json", 41, ASHBY_URL)


def test_a_user_answer_is_never_held_by_the_count_of_refused_guesses(
    page, tmp_path: Path, cv_path: Path, monkeypatch
):
    db_path = _answers_db(tmp_path)
    _save_inferred(db_path, "which work model can you accept", "Remote", field_type="text")
    for _ in range(2):
        page.set_content(_refusing_text_form())
        flow = build_flow(tmp_path, cv_path)
        flow.db_path = db_path
        last = flow.run(page=page, navigate=False)
    assert last.reason == "answer_not_accepted"

    # The user answers the same value on Telegram: the flow looks at the form again.
    _save_inferred(db_path, "which work model can you accept", "Remote", field_type="text", channel="telegram")
    opened: list[str] = []
    page.set_content(_refusing_text_form())
    flow = build_flow(tmp_path, cv_path)
    flow.db_path = db_path
    monkeypatch.setattr(flow, "_managed_page", lambda: opened.append("browser") or contextlib.nullcontext(page))

    result = flow.run(page=None, navigate=False)

    assert opened == ["browser"], "user answer held by the counter"
    # The form refuses the user's own answer: a human stop, not a question for the CLOSER.
    assert (result.status, result.reason, result.pending_question) == ("blocked_human", "answer_not_accepted", None)
    assert "which work model can you accept" not in _read_checkpoint(tmp_path)["answer_refusals"]

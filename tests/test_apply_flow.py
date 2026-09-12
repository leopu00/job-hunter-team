"""Safety and recovery contracts for the first CLOSER recipe (Ashby)."""

from __future__ import annotations

import json
import contextlib
import sqlite3
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

from apply_flow import (  # noqa: E402
    ApplicationFlow,
    FlowCheckpoint,
    FlowError,
    Receipt,
    _default_applied_recorder,
)


ASHBY_URL = "https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001/application"


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


def test_missing_required_answer_blocks_and_notifies_without_guessing(
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
    assert notifications[0]["position_id"] == 41
    assert question in notifications[0]["message"]
    assert "Test Candidate" not in notifications[0]["message"]
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

"""Safety contracts for the public Greenhouse CLOSER recipe."""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

from apply_flow import ApplicationFlow, FlowCheckpoint, GreenhouseRecipe  # noqa: E402


GREENHOUSE_URLS = (
    "https://job-boards.greenhouse.io/example/jobs/1001",
    "https://job-boards.eu.greenhouse.io/example/jobs/1001",
    "https://boards.greenhouse.io/example/jobs/1001",
)


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool = True
    reason: str = "apply_allowed"
    context: dict = field(default_factory=lambda: {"mode": "authorised"})

    def log_line(self) -> str:
        return f"[apply-gate] {'ALLOW' if self.allowed else 'DENY'} {self.reason}"


def greenhouse_form(
    *,
    question: str | None = None,
    captcha: bool = False,
    confirmation: bool = True,
) -> str:
    custom = ""
    if question:
        custom = f"""
        <div class="field-wrapper">
          <div class="input-wrapper">
            <label id="question_1001-label" for="question_1001" class="label">
              {question}<span aria-hidden="true">*</span>
            </label>
            <textarea id="question_1001" aria-label="{question}"
                      aria-required="true" required></textarea>
          </div>
        </div>
        """
    challenge = """
      <div class="field-wrapper">
        <label for="security_code">Security Code *</label>
        <input id="security_code" name="security_code" required>
        <p>Enter the verification code sent to confirm you are not a robot.</p>
      </div>
    """ if captcha else ""
    submitted = (
        "document.body.innerHTML = "
        "'<main class=\"application--confirmation\">Thank you for applying.</main>';"
        if confirmation
        else "void 0;"
    )
    return f"""
    <html><body>
      <form id="application-form" class="application--form">
        <div class="application--questions">
          <div class="field-wrapper">
            <label for="first_name">First Name<span aria-hidden="true">*</span></label>
            <input id="first_name" aria-label="First Name" aria-required="true" required>
          </div>
          <div class="field-wrapper">
            <label for="last_name">Last Name<span aria-hidden="true">*</span></label>
            <input id="last_name" aria-label="Last Name" aria-required="true" required>
          </div>
          <div class="field-wrapper">
            <label for="email">Email<span aria-hidden="true">*</span></label>
            <input id="email" type="email" aria-label="Email" aria-required="true" required>
          </div>
          <div class="field-wrapper">
            <label for="resume">Resume/CV<span aria-hidden="true">*</span></label>
            <input id="resume" class="visually-hidden" type="file" required>
          </div>
          {custom}
          {challenge}
        </div>
        <button class="btn btn--pill" type="submit">Submit application</button>
      </form>
      <script>
        window.submitCount = 0;
        document.querySelector('form').addEventListener('submit', event => {{
          event.preventDefault();
          window.submitCount += 1;
          {submitted}
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
        "first_name": "Test",
        "last_name": "Candidate",
        "contacts": {"email": "candidate@example.invalid"},
    }
    value.update(extra)
    return value


def build_flow(
    tmp_path: Path,
    cv_path: Path,
    *,
    url: str = GREENHOUSE_URLS[0],
    candidate: dict | None = None,
    verdicts: list[GateVerdict] | None = None,
    notifications: list | None = None,
    recorded: list | None = None,
) -> ApplicationFlow:
    gate_results = list(verdicts or [GateVerdict(), GateVerdict()])
    notifications = notifications if notifications is not None else []
    recorded = recorded if recorded is not None else []

    def gate(**_kwargs):
        return gate_results.pop(0) if len(gate_results) > 1 else gate_results[0]

    return ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
        cv_checker=lambda _path: {"ok": True, "reasons": []},
        position_id=52,
        url=url,
        profile=candidate or profile(),
        cv_path=cv_path,
        checkpoint_path=tmp_path / "checkpoint.json",
        receipt_dir=tmp_path / "receipts",
        gate_checker=gate,
        notifier=lambda **kwargs: notifications.append(kwargs) or "notification-1",
        applied_recorder=lambda **kwargs: recorded.append(kwargs),
        confirmation_timeout_ms=500,
    )


@pytest.mark.parametrize("url", GREENHOUSE_URLS)
def test_greenhouse_recipe_submits_on_every_supported_host(
    page, tmp_path: Path, cv_path: Path, url: str
):
    page.set_content(greenhouse_form())
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, url=url, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied"
    assert page.locator("text=Thank you for applying.").is_visible()
    assert len(recorded) == 1
    assert recorded[0]["receipt"].is_valid()
    checkpoint = json.loads((tmp_path / "checkpoint.json").read_text())
    assert checkpoint["platform"] == "greenhouse"


def test_greenhouse_never_splits_a_full_name_into_required_parts(
    page, tmp_path: Path, cv_path: Path
):
    # 1967 (14/09): a profile with only `name` was a hard stop on First Name.
    # It is a question the CLOSER works out (CL-08); the code never splits.
    page.set_content(greenhouse_form())
    notifications: list[dict] = []
    candidate = {
        "name": "Test Candidate",
        "contacts": {"email": "candidate@example.invalid"},
    }
    flow = build_flow(
        tmp_path, cv_path, candidate=candidate, notifications=notifications
    )

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "required_answer_missing"
    assert result.pending_question["key"] == "first name"
    assert result.pending_question["field_type"] == "text"
    assert page.locator("#first_name").input_value() == ""
    assert page.locator("#last_name").input_value() == ""
    assert page.evaluate("window.submitCount") == 0
    assert notifications == []  # a form question never goes to the user by itself

    # The CLOSER saves both parts from `name`; the rerun fills and submits.
    page.set_content(greenhouse_form())
    worked_out = {**candidate, "application_answers": {"first name": "Test", "last name": "Candidate"}}
    rerun = build_flow(tmp_path, cv_path, candidate=worked_out, notifications=notifications)
    result = rerun.run(page=page, navigate=False)
    assert result.status == "applied", result
    assert notifications == []


def test_greenhouse_profile_aliases_fill_the_name_parts(page, tmp_path: Path, cv_path: Path):
    page.set_content(greenhouse_form())
    candidate = {
        "name": "Test Candidate",
        "given_name": "Test",
        "contacts": {"email": "candidate@example.invalid", "last_name": "Candidate"},
    }
    result = build_flow(tmp_path, cv_path, candidate=candidate).run(page=page, navigate=False)
    assert result.status == "applied", result


def test_greenhouse_accepts_exact_saved_first_and_last_name_answers(
    page, tmp_path: Path, cv_path: Path
):
    page.set_content(greenhouse_form())
    candidate = {
        "name": "Test Candidate",
        "contacts": {"email": "candidate@example.invalid"},
        "application_answers": {
            "First Name": "Test",
            "Last Name": "Candidate",
        },
    }
    flow = build_flow(tmp_path, cv_path, candidate=candidate)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied"


def test_greenhouse_uses_only_an_exact_saved_screening_answer(
    page, tmp_path: Path, cv_path: Path
):
    question = "Why do you want to work here?"
    page.set_content(greenhouse_form(question=question))
    flow = build_flow(
        tmp_path,
        cv_path,
        candidate=profile(application_answers={question: "Test fixture answer"}),
    )

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied"


def test_greenhouse_missing_required_answer_blocks_silently(
    page, tmp_path: Path, cv_path: Path
):
    question = "State the exact certification you hold"
    page.set_content(greenhouse_form(question=question))
    notifications: list[dict] = []
    flow = build_flow(tmp_path, cv_path, notifications=notifications)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "required_answer_missing"
    assert page.locator("#question_1001").input_value() == ""
    assert page.evaluate("window.submitCount") == 0
    assert notifications == []
    assert result.pending_question["label"].startswith(question)


def test_greenhouse_security_code_blocks_before_submit(
    page, tmp_path: Path, cv_path: Path
):
    page.set_content(greenhouse_form(captcha=True))
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "captcha"
    assert page.evaluate("window.submitCount") == 0
    assert recorded == []


def test_greenhouse_invisible_recaptcha_plumbing_is_not_a_challenge(
    page, tmp_path: Path, cv_path: Path
):
    html = greenhouse_form().replace(
        "<button class=\"btn btn--pill\"",
        '<textarea name="g-recaptcha-response-100000" style="display:none"></textarea>'
        '<button class="btn btn--pill"',
    )
    page.set_content(html)
    flow = build_flow(tmp_path, cv_path)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied"


def test_greenhouse_invisible_recaptcha_badge_is_not_a_challenge(
    page, tmp_path: Path, cv_path: Path
):
    html = greenhouse_form().replace(
        "<button class=\"btn btn--pill\"",
        '<iframe title="reCAPTCHA" '
        'src="/recaptcha/enterprise/anchor?size=invisible"></iframe>'
        '<button class="btn btn--pill"',
    )
    page.set_content(html)
    flow = build_flow(tmp_path, cv_path)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied"


def test_greenhouse_runtime_redirect_outside_trusted_hosts_blocks_before_click(
    page, tmp_path: Path, cv_path: Path
):
    page.route(
        "https://careers.example.invalid/**",
        lambda route: route.fulfill(status=200, content_type="text/html", body=greenhouse_form()),
    )
    page.goto("https://careers.example.invalid/role")
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "greenhouse_redirect_untrusted"
    assert page.evaluate("window.submitCount") == 0
    assert recorded == []


def test_greenhouse_accepts_the_current_filename_upload_receipt(
    page, tmp_path: Path, cv_path: Path
):
    html = greenhouse_form().replace(
        "window.submitCount = 0;",
        """
        document.querySelector('#resume').addEventListener('change', event => {
          const field = event.target.closest('.field-wrapper');
          field.innerHTML = '<label>Resume/CV*</label>'
            + '<div class="file-upload__filename"><p>test-profile.pdf</p>'
            + '<button type="button" aria-label="Remove file">Remove</button></div>';
        });
        window.submitCount = 0;
        """,
    )
    page.set_content(html)
    flow = build_flow(tmp_path, cv_path)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied"


def test_greenhouse_legacy_required_marker_still_needs_exact_name_parts(
    page, tmp_path: Path, cv_path: Path
):
    html = greenhouse_form().replace(
        '<input id="first_name" aria-label="First Name" aria-required="true" required>',
        '<input id="first_name" aria-label="First Name">',
    ).replace(
        '<label for="first_name">First Name<span aria-hidden="true">*</span></label>',
        '<label for="first_name">First Name <span class="asterisk">*</span></label>',
    )
    page.set_content(html)
    candidate = {
        "name": "Test Candidate",
        "last_name": "Candidate",
        "contacts": {"email": "candidate@example.invalid"},
    }
    flow = build_flow(tmp_path, cv_path, candidate=candidate)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "required_answer_missing"
    assert result.pending_question["key"] == "first name"
    assert page.locator("#first_name").input_value() == ""


def test_greenhouse_challenge_appearing_after_click_blocks_without_applied(
    page, tmp_path: Path, cv_path: Path
):
    html = greenhouse_form(confirmation=False).replace(
        "void 0;",
        "document.body.innerHTML = '<input id=\"security_code\">' + "
        "'<p>Enter the verification code sent to confirm you are not a robot.</p>';",
    )
    page.set_content(html)
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "captcha"
    assert recorded == []


def test_greenhouse_react_select_requires_an_exact_saved_option(
    page, tmp_path: Path, cv_path: Path
):
    question = "Are you authorised to work here?"
    field = f"""
      <div class="field-wrapper">
        <label id="question_2001-label" for="question_2001">{question}*</label>
        <div class="select-shell">
          <input id="question_2001" role="combobox" aria-required="true"
                 aria-labelledby="question_2001-label">
          <input id="question_2001-required" type="hidden" aria-hidden="true" required>
          <div id="options" hidden>
            <div role="option">Yes</div>
            <div role="option">No</div>
          </div>
        </div>
      </div>
      <script>
        const combo = document.querySelector('#question_2001');
        combo.addEventListener('click', () => document.querySelector('#options').hidden = false);
        document.querySelectorAll('[role=option]').forEach(option => {{
          option.addEventListener('click', () => {{
            const selected = document.createElement('div');
            selected.className = 'select__single-value';
            selected.textContent = option.textContent;
            combo.parentElement.prepend(selected);
            document.querySelector('#question_2001-required').value = option.textContent;
            document.querySelector('#options').hidden = true;
          }});
        }});
      </script>
    """
    html = greenhouse_form().replace(
        '<button class="btn btn--pill"', field + '<button class="btn btn--pill"'
    )
    page.set_content(html)
    flow = build_flow(
        tmp_path,
        cv_path,
        candidate=profile(application_answers={question: "Yes"}),
        verdicts=[GateVerdict(context={"mode": "dry_run"})],
    )

    result = flow.run(page=page, navigate=False)

    assert result.status == "dry_run"
    assert page.locator(".select__single-value").inner_text() == "Yes"


def test_greenhouse_missing_select_exposes_exact_type_and_options(
    page, tmp_path: Path, cv_path: Path
):
    question = "Are you authorised to work here?"
    field = f"""
      <div class="field-wrapper">
        <label id="question_2002-label" for="question_2002">{question}*</label>
        <div class="select-shell">
          <input id="question_2002" role="combobox" aria-required="true"
                 aria-labelledby="question_2002-label">
          <input id="question_2002-required" type="hidden" aria-hidden="true" required>
          <div id="options" hidden>
            <div role="option">Yes</div>
            <div role="option">No</div>
          </div>
        </div>
      </div>
      <script>
        document.querySelector('#question_2002').addEventListener(
          'click', () => document.querySelector('#options').hidden = false
        );
      </script>
    """
    html = greenhouse_form().replace(
        '<button class="btn btn--pill"', field + '<button class="btn btn--pill"'
    )
    page.set_content(html)
    notifications: list[dict] = []
    flow = build_flow(tmp_path, cv_path, notifications=notifications)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "required_answer_missing"
    assert notifications == []
    request = result.pending_question
    # The required marker is text in this fixture (not aria-hidden), so it is
    # part of the exact accessible label shown to the user.
    assert request["label"] == question + "*"
    assert request["key"] == "are you authorised to work here"
    assert request["field_type"] == "select"
    assert request["options"] == ["Yes", "No"]
    assert page.evaluate("window.submitCount") == 0


def test_greenhouse_checkbox_answers_match_every_saved_label(
    page, tmp_path: Path, cv_path: Path
):
    question = "Which work modes can you accept?"
    field = f"""
      <div class="field-wrapper">
        <fieldset id="question_3001[]" aria-required="true">
          <legend>{question} *</legend>
          <input id="remote" name="question_3001[]" type="checkbox" required>
          <label for="remote">Remote</label>
          <input id="hybrid" name="question_3001[]" type="checkbox" required>
          <label for="hybrid">Hybrid</label>
        </fieldset>
      </div>
    """
    html = greenhouse_form().replace(
        '<button class="btn btn--pill"', field + '<button class="btn btn--pill"'
    )
    page.set_content(html)
    flow = build_flow(
        tmp_path,
        cv_path,
        candidate=profile(application_answers={question: ["Remote", "Hybrid"]}),
        verdicts=[GateVerdict(context={"mode": "dry_run"})],
    )

    result = flow.run(page=page, navigate=False)

    assert result.status == "dry_run"
    assert page.locator("#remote").is_checked()
    assert page.locator("#hybrid").is_checked()


def test_greenhouse_without_confirmation_never_records_applied(
    page, tmp_path: Path, cv_path: Path
):
    page.set_content(greenhouse_form(confirmation=False))
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "receipt_missing"
    assert page.evaluate("window.submitCount") == 1
    assert recorded == []


def test_greenhouse_confirmation_redirect_may_cross_only_trusted_hosts():
    assert ApplicationFlow._same_confirmation_origin(
        "https://boards.greenhouse.io/example/jobs/1001",
        "https://job-boards.greenhouse.io/example/jobs/1001/confirmation",
        "greenhouse",
    )
    assert not ApplicationFlow._same_confirmation_origin(
        "https://boards.greenhouse.io/example/jobs/1001",
        "https://greenhouse.io.attacker.invalid/confirmation",
        "greenhouse",
    )
    assert not ApplicationFlow._same_confirmation_origin(
        "https://boards.greenhouse.io/example/jobs/1001",
        "https://job-boards.greenhouse.io:444/confirmation",
        "greenhouse",
    )
    assert not ApplicationFlow._same_confirmation_origin(
        "https://boards.greenhouse.io/example/jobs/1001",
        "http://job-boards.greenhouse.io/confirmation",
        "greenhouse",
    )


def test_greenhouse_submit_started_checkpoint_never_clicks_again(
    page, tmp_path: Path, cv_path: Path
):
    checkpoint = FlowCheckpoint.new(52, GREENHOUSE_URLS[0])
    checkpoint.platform = "greenhouse"
    checkpoint.state = "submit"
    checkpoint.submit_started = True
    checkpoint.save(tmp_path / "checkpoint.json")
    page.set_content(greenhouse_form())
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "submit_outcome_unknown"
    assert page.evaluate("window.submitCount") == 0
    assert recorded == []


def test_greenhouse_recovery_does_not_reuse_job_copy_as_confirmation(
    page, tmp_path: Path, cv_path: Path
):
    checkpoint = FlowCheckpoint.new(52, GREENHOUSE_URLS[0])
    checkpoint.platform = "greenhouse"
    checkpoint.state = "submit"
    checkpoint.submit_started = True
    checkpoint.save(tmp_path / "checkpoint.json")
    page.set_content(
        greenhouse_form().replace(
            '<form id="application-form"',
            '<p>Thank you for applying to our previous vacancy.</p>'
            '<form id="application-form"',
        )
    )
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "submit_outcome_unknown"
    assert recorded == []


def test_greenhouse_recipe_recognises_current_public_form_marker(page, cv_path: Path):
    page.set_content(greenhouse_form())

    recipe = GreenhouseRecipe(profile(), cv_path)

    recipe.open_form(page)
    assert page.locator("#application-form.application--form").count() == 1


def test_greenhouse_name_parts_the_closer_saves_complete_the_flow(page, tmp_path: Path, cv_path: Path):
    """D1 end to end: pending question → application_answers save (--basis profile) → applied."""
    import contextlib
    import sqlite3

    import _db
    import application_answers

    db_path = tmp_path / "jobs.db"
    with contextlib.closing(sqlite3.connect(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        _db.ensure_schema(conn)
        conn.execute(
            "INSERT INTO positions(id, title, company, url, status, apply_requested, apply_requested_at, "
            "apply_requested_by) VALUES (52, 'Fixture Role', 'Fixture Co', ?, 'ready', 1, "
            "'2026-09-14T10:00:00.000Z', 'user_web')",
            (GREENHOUSE_URLS[0],),
        )
        conn.commit()
    candidate = {"name": "Test Candidate", "contacts": {"email": "candidate@example.invalid"}}
    notifications: list[dict] = []

    def flow() -> ApplicationFlow:
        built = build_flow(tmp_path, cv_path, candidate=candidate, notifications=notifications)
        built.db_path = db_path
        return built

    for expected_key, answer in (("first name", "Test"), ("last name", "Candidate")):
        page.set_content(greenhouse_form())
        stopped = flow().run(page=page, navigate=False)
        assert stopped.reason == "required_answer_missing", stopped
        assert stopped.pending_question["key"] == expected_key
        with contextlib.closing(sqlite3.connect(db_path)) as conn:
            application_answers.save_answer(
                conn,
                key=expected_key,
                label=stopped.pending_question["label"],
                answer=answer,
                field_type="text",
                channel="agent_inferred",
                scope=application_answers.answer_scope(conn, "text", 52),
            )
            conn.commit()

    page.set_content(greenhouse_form())
    resumed = flow().run(page=page, navigate=False)
    assert resumed.status == "applied", resumed
    assert page.evaluate("window.submitCount") == 1
    assert notifications == []
    assert resumed.receipt.answer_sources.get("first name") == "agent_inferred"


def _country_field(kind: str) -> str:
    if kind == "select":
        return """
      <div class="field-wrapper">
        <label for="country">Country<span aria-hidden="true">*</span></label>
        <select id="country" required>
          <option value="">Select...</option>
          <option value="DE">Germany</option>
          <option value="IT">Italy</option>
          <option value="ES">Spain</option>
        </select>
      </div>"""
    return """
      <div class="field-wrapper">
        <label id="country-label" for="country">Country*</label>
        <div class="select-shell">
          <input id="country" role="combobox" aria-required="true" aria-labelledby="country-label">
          <input id="country-required" type="hidden" aria-hidden="true" required>
          <div id="country-options" hidden>
            <div role="option">Germany</div>
            <div role="option">Italy</div>
            <div role="option">Spain</div>
          </div>
        </div>
      </div>
      <script>
      (() => {  // a second set_content reuses the page's JS realm: no top-level const
        const country = document.querySelector('#country');
        country.addEventListener('click', () => document.querySelector('#country-options').hidden = false);
        document.querySelectorAll('#country-options [role=option]').forEach(option => {
          option.addEventListener('click', () => {
            const selected = document.createElement('div');
            selected.className = 'select__single-value';
            selected.textContent = option.textContent;
            country.parentElement.prepend(selected);
            document.querySelector('#country-required').value = option.textContent;
            document.querySelector('#country-options').hidden = true;
          });
        });
      })();
      </script>"""


@pytest.mark.parametrize("kind", ["combobox", "select"])
def test_greenhouse_core_country_is_a_question_with_the_page_options(page, tmp_path: Path, cv_path: Path, kind: str):
    """1967 (14/09, after D1): "Country*" stopped and the CLOSER asked the user.
    The page's exact options go to the CLOSER, which picks the one the profile
    supports; the saved option fills the field on the rerun."""
    import contextlib
    import sqlite3

    import _db
    import application_answers

    html = greenhouse_form().replace(
        '<div class="field-wrapper">\n            <label for="resume">', _country_field(kind) + '\n          <div class="field-wrapper">\n            <label for="resume">'
    )
    assert html != greenhouse_form()
    db_path = tmp_path / "jobs.db"
    with contextlib.closing(sqlite3.connect(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        _db.ensure_schema(conn)
        conn.execute(
            "INSERT INTO positions(id, title, company, url, status, apply_requested, apply_requested_at, "
            "apply_requested_by) VALUES (52, 'Fixture Role', 'Fixture Co', ?, 'ready', 1, "
            "'2026-09-14T10:00:00.000Z', 'user_web')",
            (GREENHOUSE_URLS[0],),
        )
        conn.commit()
    candidate = profile(first_name="Test", last_name="Candidate", location="Rome, Italy")
    notifications: list[dict] = []

    def flow() -> ApplicationFlow:
        built = build_flow(tmp_path, cv_path, candidate=candidate, notifications=notifications)
        built.db_path = db_path
        return built

    page.set_content(html)
    stopped = flow().run(page=page, navigate=False)
    assert stopped.reason == "required_answer_missing", stopped
    question = stopped.pending_question
    assert question["key"] == "country"
    assert question["field_type"] == "select"
    assert question["options"] == ["Germany", "Italy", "Spain"]
    assert notifications == []

    with contextlib.closing(sqlite3.connect(db_path)) as conn:
        application_answers.save_answer(
            conn, key="country", label=question["label"], answer="Italy", field_type="select",
            channel="agent_inferred", scope=application_answers.answer_scope(conn, "select", 52),
        )
        conn.commit()
    page.set_content(html)
    resumed = flow().run(page=page, navigate=False)
    assert resumed.status == "applied", resumed
    assert page.evaluate("window.submitCount") == 1
    assert notifications == []
    assert resumed.receipt.answer_sources.get("country") == "agent_inferred"


def test_greenhouse_core_country_never_takes_a_free_text_profile_value(page, tmp_path: Path, cv_path: Path):
    html = greenhouse_form().replace(
        '<div class="field-wrapper">\n            <label for="resume">', _country_field("select") + '\n          <div class="field-wrapper">\n            <label for="resume">'
    )
    page.set_content(html)
    candidate = profile(first_name="Test", last_name="Candidate", country="Italy", location="Italy")
    result = build_flow(tmp_path, cv_path, candidate=candidate).run(page=page, navigate=False)
    assert result.reason == "required_answer_missing"
    assert page.locator("#country").input_value() == ""


def test_greenhouse_required_consent_outside_the_questions_blocks_before_the_click(
    page, tmp_path: Path, cv_path: Path
):
    consent = (
        '<div class="data-compliance"><label><input type="checkbox" name="gdpr_consent" required>'
        " I consent to data processing</label></div>"
    )
    page.set_content(greenhouse_form().replace('<button class="btn btn--pill"', consent + '<button class="btn btn--pill"'))
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "required_field_unanswered")
    assert page.evaluate("window.submitCount") == 0
    assert json.loads((tmp_path / "checkpoint.json").read_text())["submit_started"] is False
    assert recorded == []

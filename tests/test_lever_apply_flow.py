"""Safety contracts for the public Lever CLOSER recipe.

Synthetic pages only: every Lever address is answered by a Playwright route
inside the test browser, no request leaves the machine.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

from apply_flow import ApplicationFlow, FlowCheckpoint, LeverRecipe  # noqa: E402
from ats_detect import detect_ats  # noqa: E402


POSTING = "https://jobs.lever.co/example/0000-test-posting"
APPLY = f"{POSTING}/apply"
EU_APPLY = "https://jobs.eu.lever.co/example/0000-test-posting/apply"


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool = True
    reason: str = "apply_allowed"
    context: dict = field(default_factory=lambda: {"mode": "authorised"})

    def log_line(self) -> str:
        return f"[apply-gate] {'ALLOW' if self.allowed else 'DENY'} {self.reason}"


def question_block(kind: str, label: str) -> str:
    required = '<span class="required">✱</span>'
    head = f'<div class="application-label"><div class="text">{label}{required}</div></div>'
    if kind == "radio":
        field_html = (
            '<ul data-qa="multiple-choice">'
            '<li><label><input type="radio" name="cards[q1][field0]" value="Yes" required>'
            '<span class="application-answer-alternative">Yes</span></label></li>'
            '<li><label><input type="radio" name="cards[q1][field0]" value="No" required>'
            '<span class="application-answer-alternative">No</span></label></li></ul>'
        )
    elif kind == "select":
        field_html = (
            '<select name="cards[q1][field0]" required><option value="">Select...</option>'
            '<option value="a">Less than a month</option><option value="b">One to three months</option></select>'
        )
    elif kind == "checkboxes":
        field_html = (
            '<ul data-qa="checkboxes">'
            '<li><label><input type="checkbox" name="cards[q1][field0]" value="Python">'
            '<span class="application-answer-alternative">Python</span></label></li>'
            '<li><label><input type="checkbox" name="cards[q1][field0]" value="Go">'
            '<span class="application-answer-alternative">Go</span></label></li></ul>'
        )
    else:
        field_html = '<textarea class="card-field-input" name="cards[q1][field0]" required></textarea>'
    return (
        f'<li class="application-question custom-question">{head}'
        f'<div class="application-field">{field_html}</div></li>'
    )


def lever_form(
    *,
    question: tuple[str, str] | None = None,
    captcha: bool = False,
    confirmation: str = "text",
    extra_before_form: str = "",
    extra_in_form: str = "",
) -> str:
    custom = question_block(*question) if question else ""
    challenge = (
        '<iframe title="hCaptcha challenge" src="https://newassets.hcaptcha.com/captcha/v1/challenge"'
        ' style="width:300px;height:300px"></iframe>'
        if captcha
        else ""
    )
    if confirmation == "text":
        submitted = (
            "document.body.innerHTML = '<div class=\"application-confirmation\">"
            "<h3>Application submitted!</h3></div>';"
        )
    elif confirmation == "thanks":
        submitted = "window.location.href = window.location.href.replace(/\\/apply$/, '/thanks');"
    else:
        submitted = "void 0;"
    return f"""
    <html><body>
      {extra_before_form}
      <div class="application-page">
      <form id="application-form" method="POST" enctype="multipart/form-data">
        <div class="section application-form">
          <h4>Submit your application</h4>
          <ul>
            <li class="application-question resume">
              <label><div class="application-label">Resume/CV<span class="required">✱</span></div>
              <div class="application-field">
                <input type="file" id="resume-upload-input" name="resume" required>
              </div></label>
            </li>
            <li class="application-question">
              <label><div class="application-label">Full name<span class="required">✱</span></div>
              <div class="application-field"><input type="text" name="name" required></div></label>
            </li>
            <li class="application-question">
              <label><div class="application-label">Email<span class="required">✱</span></div>
              <div class="application-field"><input type="email" name="email" required></div></label>
            </li>
            <li class="application-question">
              <label><div class="application-label">Phone</div>
              <div class="application-field"><input type="text" name="phone"></div></label>
            </li>
            <li class="application-question">
              <label><div class="application-label">LinkedIn URL</div>
              <div class="application-field"><input type="text" name="urls[LinkedIn]"></div></label>
            </li>
            {custom}
          </ul>
        </div>
        {extra_in_form}
        {challenge}
        <button id="btn-submit" type="submit" class="postings-btn template-btn-submit">Submit application</button>
      </form>
      </div>
      <script>
        window.submitCount = 0;
        document.querySelector('#application-form').addEventListener('submit', event => {{
          event.preventDefault();
          window.submitCount += 1;
          {submitted}
        }});
      </script>
    </body></html>
    """


def posting_page(*links: str) -> str:
    rendered = "".join(
        f'<a class="postings-btn template-btn-submit" href="{href}">Apply for this job</a>'
        for href in links
    )
    return f"<html><body><h2>Test Role</h2><p>About the role.</p>{rendered}</body></html>"


THANKS_PAGE = "<html><body><h3>Done</h3><p>We will be in touch.</p></body></html>"


def serve(page, pages: dict[str, str]) -> None:
    """Answer every Lever address from `pages`; anything else is a 404, never the network."""

    def handler(route):
        body = pages.get(route.request.url)
        if body is None:
            route.fulfill(status=404, content_type="text/html", body="<html><body>missing</body></html>")
        else:
            route.fulfill(status=200, content_type="text/html", body=body)

    page.route("**/*", handler)


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
    url: str = APPLY,
    candidate: dict | None = None,
    notifications: list | None = None,
    recorded: list | None = None,
) -> ApplicationFlow:
    notifications = notifications if notifications is not None else []
    recorded = recorded if recorded is not None else []
    return ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
        cv_checker=lambda _path: {"ok": True, "reasons": []},
        position_id=61,
        url=url,
        profile=candidate or profile(),
        cv_path=cv_path,
        checkpoint_path=tmp_path / "checkpoint.json",
        receipt_dir=tmp_path / "receipts",
        gate_checker=lambda **_kwargs: GateVerdict(),
        notifier=lambda **kwargs: notifications.append(kwargs) or "notification-1",
        applied_recorder=lambda **kwargs: recorded.append(kwargs),
        confirmation_timeout_ms=1500,
    )


def open_at(page, url: str, body: str, **more: str) -> None:
    serve(page, {url: body, **more})
    page.goto(url)


@pytest.mark.parametrize("url", (APPLY, EU_APPLY))
def test_lever_recipe_submits_on_both_public_boards(page, tmp_path: Path, cv_path: Path, url: str):
    open_at(page, url, lever_form())
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, url=url, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied", result
    assert len(recorded) == 1 and recorded[0]["receipt"].is_valid()
    checkpoint = json.loads((tmp_path / "checkpoint.json").read_text())
    assert checkpoint["platform"] == "lever"
    assert page.locator("text=Application submitted!").is_visible()


def test_lever_fills_the_form_it_submits(page, tmp_path: Path, cv_path: Path):
    open_at(page, APPLY, lever_form(confirmation="none"))
    flow = build_flow(tmp_path, cv_path, candidate=profile(contacts={
        "email": "candidate@example.invalid", "linkedin": "https://www.linkedin.com/in/test-fixture"
    }))

    result = flow.run(page=page, navigate=False)

    assert result.reason == "receipt_missing"
    assert page.locator("input[name=name]").input_value() == "Test Candidate"
    assert page.locator("input[name=email]").input_value() == "candidate@example.invalid"
    assert page.locator("input[name='urls[LinkedIn]']").input_value().endswith("test-fixture")
    assert page.locator("input[name=resume]").evaluate("e => e.files.length") == 1
    assert page.evaluate("window.submitCount") == 1


def test_lever_thanks_page_is_the_confirmation(page, tmp_path: Path, cv_path: Path):
    open_at(page, APPLY, lever_form(confirmation="thanks"), **{f"{POSTING}/thanks": THANKS_PAGE})
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied", result
    assert recorded[0]["receipt"].confirmation_url == f"{POSTING}/thanks"


def test_lever_without_confirmation_never_records_applied(page, tmp_path: Path, cv_path: Path):
    open_at(page, APPLY, lever_form(confirmation="none"))
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "receipt_missing"
    assert page.evaluate("window.submitCount") == 1
    assert recorded == []


def test_lever_posting_page_repeats_one_apply_link(page, tmp_path: Path, cv_path: Path):
    serve(page, {POSTING: posting_page(APPLY, APPLY), APPLY: lever_form()})
    page.goto(POSTING)
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, url=POSTING, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied", result
    assert len(recorded) == 1


def test_lever_two_different_apply_links_block(page, tmp_path: Path, cv_path: Path):
    other = "https://jobs.lever.co/example/1111-other-posting/apply"
    serve(page, {POSTING: posting_page(APPLY, other), APPLY: lever_form(), other: lever_form()})
    page.goto(POSTING)
    flow = build_flow(tmp_path, cv_path, url=POSTING)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "lever_apply_ambiguous"
    assert page.url == POSTING


def test_lever_never_joins_first_and_last_names_into_the_full_name(page, tmp_path: Path, cv_path: Path):
    # D1 (14/09): how a person writes the full name is not first + " " + last.
    # Without the profile's own full name it is a question the CLOSER works
    # out (CL-08), never a join in code.
    open_at(page, APPLY, lever_form())
    notifications: list[dict] = []
    candidate = {
        "first_name": "Test",
        "last_name": "Candidate",
        "contacts": {"email": "candidate@example.invalid"},
    }
    flow = build_flow(tmp_path, cv_path, candidate=candidate, notifications=notifications)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "required_answer_missing"
    assert result.pending_question["key"] == "full name"
    assert result.pending_question["field_type"] == "text"
    assert page.locator("input[name=name]").input_value() == ""
    assert page.evaluate("window.submitCount") == 0
    assert notifications == []  # a form question never goes to the user by itself

    # The CLOSER saves the full name with its basis; the rerun fills and submits.
    open_at(page, APPLY, lever_form())
    page.evaluate(
        "() => document.getElementById('application-form').addEventListener('submit',"
        " () => { window.sentName = document.querySelector('input[name=name]').value; }, true)"
    )
    worked_out = {**candidate, "application_answers": {"full name": "Test Candidate"}}
    rerun = build_flow(tmp_path, cv_path, candidate=worked_out, notifications=notifications)
    result = rerun.run(page=page, navigate=False)
    assert result.status == "applied", result
    assert page.evaluate("window.sentName") == "Test Candidate"
    assert notifications == []


def test_lever_full_name_comes_from_a_profile_alias(page, tmp_path: Path, cv_path: Path):
    open_at(page, APPLY, lever_form(confirmation="none"))
    candidate = {"full_name": "Test Candidate", "contacts": {"email": "candidate@example.invalid"}}

    build_flow(tmp_path, cv_path, candidate=candidate).run(page=page, navigate=False)

    assert page.locator("input[name=name]").input_value() == "Test Candidate"


def test_lever_missing_email_is_an_email_question_before_submit(page, tmp_path: Path, cv_path: Path):
    open_at(page, APPLY, lever_form())
    notifications: list[dict] = []
    flow = build_flow(tmp_path, cv_path, candidate={"name": "Test Candidate"}, notifications=notifications)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "required_answer_missing"
    assert (result.pending_question["key"], result.pending_question["field_type"]) == ("email", "email")
    assert page.locator("input[name=email]").input_value() == ""
    assert page.evaluate("window.submitCount") == 0
    assert notifications == []


def test_lever_missing_required_question_stops_silently_with_exact_options(
    page, tmp_path: Path, cv_path: Path
):
    label = "Are you authorized to work in the country of this role?"
    open_at(page, APPLY, lever_form(question=("radio", label)))
    notifications: list[dict] = []
    flow = build_flow(tmp_path, cv_path, notifications=notifications)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "required_answer_missing"
    assert result.pending_question["label"] == label
    assert result.pending_question["field_type"] == "radio"
    assert result.pending_question["options"] == ["Yes", "No"]
    assert notifications == []
    assert page.evaluate("window.submitCount") == 0


@pytest.mark.parametrize(
    ("kind", "label", "answer", "check"),
    (
        ("radio", "Do you need visa sponsorship?", "No", "input[type=radio][value=No]:checked"),
        ("select", "What is your notice period?", "One to three months", "select"),
        ("checkboxes", "Which languages do you use?", ["Python", "Go"], "input[type=checkbox]:checked"),
        ("textarea", "Why this team?", "Test fixture answer", "textarea"),
    ),
)
def test_lever_saved_answers_fill_every_native_control(
    page, tmp_path: Path, cv_path: Path, kind, label, answer, check
):
    open_at(page, APPLY, lever_form(question=(kind, label), confirmation="none"))
    flow = build_flow(tmp_path, cv_path, candidate=profile(application_answers={label: answer}))

    result = flow.run(page=page, navigate=False)

    # Clicked once, the form left in place to read what was filled.
    assert result.reason == "receipt_missing", result
    assert page.evaluate("window.submitCount") == 1
    filled = page.locator(f"li.custom-question {check}")
    if kind == "select":
        assert filled.evaluate("e => e.selectedOptions[0].text") == answer
    elif kind == "textarea":
        assert filled.input_value() == answer
    else:
        assert filled.count() == (len(answer) if isinstance(answer, list) else 1)
    checkpoint = json.loads((tmp_path / "checkpoint.json").read_text())
    assert checkpoint["answer_sources"]


def test_lever_saved_answer_outside_the_options_blocks(page, tmp_path: Path, cv_path: Path):
    label = "Do you need visa sponsorship?"
    open_at(page, APPLY, lever_form(question=("radio", label)))
    flow = build_flow(tmp_path, cv_path, candidate=profile(application_answers={label: "Maybe"}))

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "answer_option_unknown"
    assert page.evaluate("window.submitCount") == 0


def test_lever_visible_captcha_blocks_before_submit(page, tmp_path: Path, cv_path: Path):
    open_at(page, APPLY, lever_form(captcha=True))
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "captcha"
    assert page.evaluate("window.submitCount") == 0
    assert recorded == []


def test_lever_page_outside_its_hosts_blocks_before_click(page, tmp_path: Path, cv_path: Path):
    open_at(page, "https://careers.example.invalid/role", lever_form())
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "lever_redirect_untrusted"
    assert page.evaluate("window.submitCount") == 0
    assert recorded == []


def test_lever_second_application_form_blocks(page, tmp_path: Path, cv_path: Path):
    second = '<form id="other"><ul><li class="application-question"><input name="x"></li></ul></form>'
    open_at(page, APPLY, lever_form(extra_before_form=second))
    flow = build_flow(tmp_path, cv_path)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "lever_form_ambiguous"
    assert page.evaluate("window.submitCount") == 0


def test_lever_newsletter_form_next_to_the_application_is_never_touched(
    page, tmp_path: Path, cv_path: Path
):
    newsletter = (
        '<form id="newsletter"><input type="email" name="email" required>'
        '<button type="submit">Subscribe</button></form>'
        "<script>window.newsletterCount = 0; document.querySelector('#newsletter')"
        ".addEventListener('submit', e => { e.preventDefault(); window.newsletterCount += 1; });</script>"
    )
    open_at(page, APPLY, lever_form(extra_before_form=newsletter))
    flow = build_flow(tmp_path, cv_path)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied", result
    assert page.evaluate("window.newsletterCount") == 0


def test_lever_rendered_form_without_vendor_markers_is_not_recognised(
    page, tmp_path: Path, cv_path: Path
):
    html = lever_form().replace("template-btn-submit", "btn").replace('id="resume-upload-input" ', "")
    open_at(page, APPLY, html)
    flow = build_flow(tmp_path, cv_path)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "lever_dom_unrecognised"
    assert page.evaluate("window.submitCount") == 0


def test_lever_submit_started_checkpoint_never_clicks_again(page, tmp_path: Path, cv_path: Path):
    checkpoint = FlowCheckpoint.new(61, APPLY)
    checkpoint.platform = "lever"
    checkpoint.state = "submit"
    checkpoint.submit_started = True
    checkpoint.save(tmp_path / "checkpoint.json")
    open_at(page, APPLY, lever_form())
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "submit_outcome_unknown"
    assert page.evaluate("window.submitCount") == 0
    assert recorded == []


def test_lever_confirmation_never_crosses_between_boards():
    assert ApplicationFlow._same_confirmation_origin(APPLY, f"{POSTING}/thanks", "lever")
    assert not ApplicationFlow._same_confirmation_origin(
        APPLY, "https://jobs.eu.lever.co/example/0000-test-posting/thanks", "lever"
    )
    assert not ApplicationFlow._same_confirmation_origin(
        APPLY, "https://jobs.lever.co.attacker.invalid/thanks", "lever"
    )
    assert not ApplicationFlow._same_confirmation_origin(
        "https://careers.example.invalid/apply", "https://careers.example.invalid/thanks", "lever"
    )


def test_lever_detection_names_both_boards_and_the_rendered_form():
    assert detect_ats(APPLY).platform == "lever"
    assert detect_ats(EU_APPLY).platform == "lever"
    rendered = detect_ats(APPLY, lever_form())
    assert rendered.platform == "lever" and rendered.dom_match
    assert detect_ats(None, "<form><button class='btn'>Send</button></form>").platform == "unknown"


def test_lever_recipe_label_drops_the_required_mark(page, cv_path: Path):
    page.set_content(lever_form(question=("textarea", "Why this team?")))

    recipe = LeverRecipe(profile(), cv_path)
    entries = page.locator(LeverRecipe.FIELD_ENTRY)

    assert LeverRecipe._label(entries.nth(1)) == "Full name"
    assert LeverRecipe._label(entries.last) == "Why this team?"
    assert recipe.form_present(page)


def test_lever_checkbox_answer_with_an_unknown_label_blocks(page, tmp_path: Path, cv_path: Path):
    label = "Which languages do you use?"
    open_at(page, APPLY, lever_form(question=("checkboxes", label)))
    flow = build_flow(tmp_path, cv_path, candidate=profile(application_answers={label: ["Python", "Rust"]}))

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "answer_option_unknown"
    assert page.locator("input[type=checkbox]:checked").count() == 0
    assert page.evaluate("window.submitCount") == 0


def test_lever_question_the_form_already_answered_needs_no_saved_answer(
    page, tmp_path: Path, cv_path: Path
):
    html = lever_form(question=("textarea", "Why this team?")).replace(
        'required></textarea>', "required>Prefilled by the board</textarea>"
    )
    open_at(page, APPLY, html)
    flow = build_flow(tmp_path, cv_path)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied", result


def test_lever_cv_the_form_does_not_keep_blocks_the_upload(page, tmp_path: Path, cv_path: Path):
    html = lever_form().replace(
        "window.submitCount = 0;",
        "document.querySelector('input[name=resume]').addEventListener('change', e => { e.target.value = ''; });"
        " window.submitCount = 0;",
    )
    open_at(page, APPLY, html)
    flow = build_flow(tmp_path, cv_path)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "upload_rejected"
    assert page.evaluate("window.submitCount") == 0


def test_lever_required_consent_outside_the_questions_blocks_before_the_click(
    page, tmp_path: Path, cv_path: Path
):
    consent = (
        '<div class="application-additional"><label><input type="checkbox" name="consent[store]" required>'
        " I consent to data processing</label></div>"
    )
    open_at(page, APPLY, lever_form(extra_in_form=consent))
    recorded: list[dict] = []
    flow = build_flow(tmp_path, cv_path, recorded=recorded)

    result = flow.run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "required_field_unanswered"
    assert json.loads((tmp_path / "checkpoint.json").read_text())["submit_started"] is False
    assert recorded == []


PLACES = {
    "milan": ["Milan, Lombardy, Italy", "Milan, Tennessee, United States"],
    "milan, italy": [],
}


def lever_location_form(
    *, required: bool = True, script: bool = True, places: dict | None = None, keeps_choice: bool = True
) -> str:
    """Lever's location autocomplete, as its retrieveLocations.js behaves (14/09).

    A search on keydown after a pause (a filled value never searches), a blur
    without a pick empties the field, a mousedown on a suggestion writes the
    visible text and the hidden selectedLocation.
    """
    mark = '<span class="required">✱</span>' if required else ""
    widget = (
        f'<li class="application-question"><label><div class="application-label">Current location{mark}</div>'
        f'<div class="application-field"><input class="location-input" type="text" name="location" {"required" if required else ""}>'
        '<input id="selected-location" type="hidden" name="selectedLocation">'
        '<div class="dropdown-container" style="display:none"><div class="dropdown-results"></div></div></div></label></li>'
    )
    behaviour = """
    <script>
    (() => {
      const places = PLACES_JSON;
      const input = document.querySelector('input.location-input');
      const hidden = document.querySelector('#selected-location');
      const box = document.querySelector('.dropdown-container');
      const results = document.querySelector('.dropdown-results');
      let timer, found = [];
      input.addEventListener('input', () => { box.style.display = 'flex'; });
      input.addEventListener('keydown', () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          results.innerHTML = '';
          found = places[input.value.trim().toLowerCase()] || [];
          found.forEach((name, index) => {
            const option = document.createElement('div');
            option.className = 'dropdown-location';
            option.id = 'location-' + index;
            option.textContent = name;
            results.appendChild(option);
          });
        }, 300);
      });
      input.addEventListener('blur', () => {
        if (box.style.display !== 'none') {
          box.style.display = 'none'; results.innerHTML = ''; input.value = ''; hidden.value = '';
        }
      });
      document.addEventListener('mousedown', event => {
        if (!event.target.classList.contains('dropdown-location')) return;
        box.style.display = 'none';
        input.value = event.target.textContent;
        if (KEEPS) hidden.value = JSON.stringify({name: found[Number(event.target.id.split('-')[1])]});
        results.innerHTML = '';
      });
    })();
    </script>""".replace("PLACES_JSON", json.dumps(places if places is not None else PLACES)).replace(
        "KEEPS", "true" if keeps_choice else "false"
    )
    return lever_form().replace(
        '<li class="application-question">\n              <label><div class="application-label">Phone',
        widget + '<li class="application-question">\n              <label><div class="application-label">Phone',
    ).replace("</form>", "</form>" + (behaviour if script else ""))


def _sent_location(page) -> None:
    page.evaluate(
        "() => document.getElementById('application-form').addEventListener('submit', () => {"
        " window.sentLocation = [document.querySelector('input[name=location]').value,"
        " document.querySelector('#selected-location').value]; }, true)"
    )


def test_lever_location_picks_the_suggestion_of_the_same_city_and_country(page, tmp_path: Path, cv_path: Path):
    # 1888 (14/09): a hard stop and a Telegram question for a fact the profile states.
    open_at(page, APPLY, lever_location_form())
    _sent_location(page)
    notifications: list[dict] = []
    flow = build_flow(tmp_path, cv_path, candidate=profile(location="Milan, Italy"), notifications=notifications)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied", result
    text, selected = page.evaluate("window.sentLocation")
    assert text == "Milan, Lombardy, Italy"
    assert json.loads(selected) == {"name": "Milan, Lombardy, Italy"}
    assert notifications == []


def test_lever_location_without_a_certain_match_is_a_question_with_the_suggestions(
    page, tmp_path: Path, cv_path: Path
):
    open_at(page, APPLY, lever_location_form())
    notifications: list[dict] = []
    candidate = profile(location="Milan")  # no country: two Milans
    flow = build_flow(tmp_path, cv_path, candidate=candidate, notifications=notifications)

    result = flow.run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "required_answer_missing")
    question = result.pending_question
    assert (question["key"], question["label"], question["field_type"]) == (
        "current location", "Current location", "select"
    )
    assert question["options"] == ["Milan, Lombardy, Italy", "Milan, Tennessee, United States"]
    assert page.locator("input[name=location]").input_value() == ""
    assert page.evaluate("window.submitCount") == 0
    assert notifications == []  # a form question never goes to the user by itself

    # The CLOSER chooses one option with its basis; the rerun clicks exactly it.
    open_at(page, APPLY, lever_location_form())
    _sent_location(page)
    chosen = {**candidate, "application_answers": {"current location": "Milan, Tennessee, United States"}}
    result = build_flow(tmp_path, cv_path, candidate=chosen, notifications=notifications).run(page=page, navigate=False)
    assert result.status == "applied", result
    assert page.evaluate("window.sentLocation")[0] == "Milan, Tennessee, United States"
    assert notifications == []


def test_lever_location_whose_hidden_choice_stays_empty_is_not_sent(page, tmp_path: Path, cv_path: Path):
    # The visible text is not what Lever keeps: without selectedLocation the pick did not happen.
    open_at(page, APPLY, lever_location_form(keeps_choice=False))
    flow = build_flow(tmp_path, cv_path, candidate=profile(location="Milan, Italy"))

    result = flow.run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "answer_not_accepted")
    assert page.locator("input[name=location]").input_value() == ""
    assert page.evaluate("window.submitCount") == 0


@pytest.mark.parametrize("required", (True, False))
def test_lever_location_that_shows_no_suggestions_is_never_left_typed(page, tmp_path: Path, cv_path: Path, required):
    open_at(page, APPLY, lever_location_form(required=required, script=False))
    _sent_location(page)
    flow = build_flow(tmp_path, cv_path, candidate=profile(location="Test City, Test Country"))

    result = flow.run(page=page, navigate=False)

    if required:
        assert result.reason == "unknown_required_control"
        assert page.evaluate("window.submitCount") == 0
        assert page.locator("input[name=location]").input_value() == ""
    else:
        assert result.status == "applied", result
        assert page.evaluate("window.sentLocation") == ["", ""]


def test_lever_location_missing_from_the_profile_is_a_question(page, tmp_path: Path, cv_path: Path):
    open_at(page, APPLY, lever_location_form())
    flow = build_flow(tmp_path, cv_path)

    result = flow.run(page=page, navigate=False)

    assert result.reason == "required_answer_missing"
    assert result.pending_question["key"] == "current location"
    assert page.evaluate("window.submitCount") == 0


def test_lever_localised_apply_control_opens_the_form(page, tmp_path: Path, cv_path: Path):
    serve(page, {POSTING: posting_page(APPLY).replace("Apply for this job", "Postuler à cette offre"), APPLY: lever_form()})
    page.goto(POSTING)
    flow = build_flow(tmp_path, cv_path, url=POSTING)

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied", result


def test_lever_hidden_apply_control_does_not_count_as_one():
    class Hidden:
        def count(self):
            return 1

        def nth(self, _index):
            return self

        def is_visible(self):
            return False

    class Page:
        def get_by_role(self, _role, name=None):
            return Hidden()

    assert LeverRecipe(profile(), Path("unused.pdf")).apply_control_present(Page()) is False


def test_lever_receipt_names_the_cv_that_was_uploaded(page, tmp_path: Path, cv_path: Path):
    import hashlib

    open_at(page, APPLY, lever_form())
    recorded: list[dict] = []

    result = build_flow(tmp_path, cv_path, recorded=recorded).run(page=page, navigate=False)

    expected = hashlib.sha256(cv_path.read_bytes()).hexdigest()
    assert result.status == "applied", result
    assert recorded[0]["receipt"].cv_sha256 == expected
    saved = json.loads((tmp_path / "checkpoint.json").read_text())
    assert saved["receipt"]["cv_sha256"] == expected == saved["cv_sha256"]

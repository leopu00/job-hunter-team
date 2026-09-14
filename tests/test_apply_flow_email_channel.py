"""The CLOSER browser flow meets a mailto: application and a page full of other forms.

Origin. On the operator's VPS a vacancy's "Apply" control was a mailto: link.
The CLOSER first took it for a form and then filled the footer NEWSLETTER field
as if it were an application field, declaring a pre-submit boundary that did
not exist.  Nothing was sent; the video review caught it.

What this suite holds, on synthetic pages only:

  1. a mailto: application control — a direct link, or a button that opens a
     mailto — is the application CHANNEL: state ``email_channel``, the raw href
     in the checkpoint (``channel``/``mailto_href``), exit code 4, no click,
     no field filled, and a rerun does not reopen the page;
  2. a mailto that is not an application control ("email us") is not a
     channel, and two different apply addresses are ambiguous;
  3. a careers page with a newsletter in the footer and no application form
     fills nothing;
  4. a real form next to a newsletter fills only the real form, and every
     field, the CV upload and the submit button must belong to that single
     form — otherwise the flow stops before any pre-submit boundary.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import apply_flow as apply_flow_module  # noqa: E402
from apply_flow import ApplicationFlow, FlowCheckpoint  # noqa: E402
from test_apply_flow import ashby_form  # noqa: E402
from test_greenhouse_apply_flow import greenhouse_form  # noqa: E402


CAREERS_URL = "https://careers.example.invalid/jobs/senior-engineer"
ASHBY_URL = "https://jobs.ashbyhq.com/example/00000000-0000-0000-0000-000000000001/application"
GREENHOUSE_URL = "https://job-boards.greenhouse.io/example/jobs/1001"
MAILTO = "mailto:jobs@example.invalid?cc=hr@example.invalid&subject=Application%20-%20Senior%20Engineer&body=Dear%20team"

NEWSLETTER = """
  <footer>
    <form class="newsletter" onsubmit="event.preventDefault(); window.newsletterSubmits = (window.newsletterSubmits||0) + 1">
      <label for="newsletter-email">Email</label>
      <input id="newsletter-email" name="email" type="email">
      <button type="submit">Subscribe</button>
    </form>
  </footer>
"""


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool = True
    reason: str = "apply_allowed"
    context: dict = field(default_factory=lambda: {"mode": "authorised"})

    def log_line(self) -> str:
        return f"[apply-gate] {'ALLOW' if self.allowed else 'DENY'} {self.reason}"


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


def build_flow(tmp_path: Path, cv_path: Path, url: str, notifications=None, recorded=None):
    notifications = notifications if notifications is not None else []
    recorded = recorded if recorded is not None else []
    return ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
        position_id=77,
        url=url,
        profile={
            "name": "Test Candidate",
            "first_name": "Test",
            "last_name": "Candidate",
            "contacts": {"email": "candidate@example.invalid"},
        },
        cv_path=cv_path,
        checkpoint_path=tmp_path / "checkpoint.json",
        receipt_dir=tmp_path / "receipts",
        gate_checker=lambda **_kwargs: GateVerdict(),
        notifier=lambda **kwargs: notifications.append(kwargs) or "notification-1",
        applied_recorder=lambda **kwargs: recorded.append(kwargs),
        confirmation_timeout_ms=500,
    )


def careers_page(apply_control: str, *, extra: str = "") -> str:
    return f"""
    <html><body>
      <header><a href="/">Example</a> <a href="/demo">Book a Demo</a></header>
      <main>
        <h1>Senior Engineer</h1>
        <p>We build synthetic things.</p>
        {apply_control}
        {extra}
      </main>
      {NEWSLETTER}
    </body></html>
    """


def _checkpoint(tmp_path: Path) -> dict:
    return json.loads((tmp_path / "checkpoint.json").read_text(encoding="utf-8"))


def _nothing_filled(page) -> None:
    assert page.eval_on_selector_all(
        "input:not([type=hidden]), textarea",
        "els => els.map(e => e.value).filter(Boolean)",
    ) == []
    assert page.evaluate("window.newsletterSubmits || 0") == 0


# ── 1. mailto as the application channel ─────────────────────────────────────


@pytest.mark.parametrize(
    "control",
    [
        pytest.param(f'<a class="btn" href="{MAILTO}">Apply now</a>', id="direct-link"),
        pytest.param(
            f"""<button type="button" onclick="window.location.href='{MAILTO}'">Send application</button>""",
            id="button-opens-mailto",
        ),
    ],
)
def test_mailto_apply_control_is_the_email_channel(page, tmp_path: Path, cv_path: Path, control: str):
    page.set_content(careers_page(control))
    notifications: list = []
    flow = build_flow(tmp_path, cv_path, CAREERS_URL, notifications=notifications)

    result = flow.run(page=page, navigate=False)

    assert (result.status, result.state, result.reason) == ("email_channel", "email_channel", "mailto_application")
    checkpoint = _checkpoint(tmp_path)
    assert checkpoint["state"] == "email_channel"
    assert checkpoint["channel"] == "email"
    # Raw, exactly as the page carries it: parsing is the email channel's job.
    assert checkpoint["mailto_href"] == MAILTO
    assert checkpoint["submit_started"] is False
    assert notifications == []
    _nothing_filled(page)


def test_mailto_apply_on_a_recipe_host_is_not_a_missing_form(page, tmp_path: Path, cv_path: Path):
    """Greenhouse would otherwise click the single "Apply" control and report a missing form."""
    page.set_content(careers_page(f'<a href="{MAILTO}">Apply</a>'))
    result = build_flow(tmp_path, cv_path, GREENHOUSE_URL).run(page=page, navigate=False)

    assert result.status == "email_channel"
    assert _checkpoint(tmp_path)["mailto_href"] == MAILTO


def test_rerun_of_an_email_channel_does_not_reopen_the_page(page, tmp_path: Path, cv_path: Path):
    page.set_content(careers_page(f'<a href="{MAILTO}">Apply now</a>'))
    flow = build_flow(tmp_path, cv_path, CAREERS_URL)
    assert flow.run(page=page, navigate=False).status == "email_channel"

    page.set_content("<html><body><p>not the vacancy</p></body></html>")
    again = flow.run(page=page, navigate=False)

    assert again.status == "email_channel"
    assert _checkpoint(tmp_path)["mailto_href"] == MAILTO


def test_email_channel_cli_exit_code(tmp_path: Path, monkeypatch):
    profile_path = tmp_path / "profile.yml"
    profile_path.write_text("name: Fixture\n", encoding="utf-8")
    cv = tmp_path / "cv.pdf"
    cv.write_bytes(b"fixture")

    class FakeFlow:
        def __init__(self, **_kwargs):
            pass

        def run(self):
            return apply_flow_module.FlowResult("email_channel", "email_channel", "mailto_application")

    monkeypatch.setattr(apply_flow_module, "ApplicationFlow", FakeFlow)
    code = apply_flow_module.main(
        ["--position-id", "77", "--url", CAREERS_URL, "--profile", str(profile_path), "--cv", str(cv)]
    )
    assert code == 4


def test_checkpoint_rejects_an_email_channel_without_a_mailto(tmp_path: Path):
    path = tmp_path / "checkpoint.json"
    checkpoint = FlowCheckpoint.new(77, CAREERS_URL)
    checkpoint.state = "email_channel"
    checkpoint.channel = "email"
    checkpoint.mailto_href = "https://example.invalid/apply"
    checkpoint.save(path)
    with pytest.raises(apply_flow_module.FlowError):
        FlowCheckpoint.load(path, 77, CAREERS_URL)


# ── 2. what is not a channel ─────────────────────────────────────────────────


def test_contact_mailto_is_not_an_application_channel(page, tmp_path: Path, cv_path: Path):
    page.set_content(careers_page('<p>Questions? <a href="mailto:info@example.invalid">Email us</a></p>'))
    result = build_flow(tmp_path, cv_path, CAREERS_URL).run(page=page, navigate=False)

    assert result.status == "blocked_human"
    assert result.reason == "ats_unsupported"
    assert _checkpoint(tmp_path)["channel"] == ""
    _nothing_filled(page)


def test_two_different_apply_addresses_are_ambiguous(page, tmp_path: Path, cv_path: Path):
    page.set_content(
        careers_page(
            f'<a href="{MAILTO}">Apply now</a>',
            extra='<a href="mailto:other@example.invalid">Apply via recruiter</a>',
        )
    )
    result = build_flow(tmp_path, cv_path, CAREERS_URL).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "mailto_ambiguous")
    assert _checkpoint(tmp_path)["mailto_href"] == ""


def test_same_apply_address_twice_is_one_channel(page, tmp_path: Path, cv_path: Path):
    page.set_content(
        careers_page(f'<a href="{MAILTO}">Apply now</a>', extra=f'<a href="{MAILTO}">Apply</a>')
    )
    assert build_flow(tmp_path, cv_path, CAREERS_URL).run(page=page, navigate=False).status == "email_channel"


def test_recognised_form_wins_over_an_apply_mailto(page, tmp_path: Path, cv_path: Path):
    recorded: list = []
    page.set_content(
        ashby_form().replace(
            "<html><body>",
            f'<html><body><p>Trouble with the form? <a href="{MAILTO}">Send application by email</a></p>',
        )
    )
    result = build_flow(tmp_path, cv_path, ASHBY_URL, recorded=recorded).run(page=page, navigate=False)

    assert result.status == "applied"
    assert _checkpoint(tmp_path)["channel"] == ""


# ── 3. newsletter only, no application form ─────────────────────────────────


@pytest.mark.parametrize("url", [CAREERS_URL, ASHBY_URL, GREENHOUSE_URL])
def test_newsletter_page_without_application_form_fills_nothing(page, tmp_path: Path, cv_path: Path, url: str):
    page.set_content(careers_page("<p>Applications are closed for now.</p>"))
    result = build_flow(tmp_path, cv_path, url).run(page=page, navigate=False)

    assert result.status == "blocked_human"
    # The page says applications are closed.  On a known ATS without its form
    # that is the reason; a page no recipe knows carries a (newsletter) form,
    # so the notice proves nothing there.
    assert result.reason == ("ats_unsupported" if url == CAREERS_URL else "vacancy_closed")
    checkpoint = _checkpoint(tmp_path)
    assert checkpoint["completed_steps"] == []
    assert checkpoint["submit_started"] is False
    _nothing_filled(page)


# ── 4. the real form next to a newsletter ───────────────────────────────────


def test_ashby_form_next_to_newsletter_fills_only_the_application(page, tmp_path: Path, cv_path: Path):
    recorded: list = []
    page.set_content(ashby_form().replace("</body>", NEWSLETTER + "</body>"))
    result = build_flow(tmp_path, cv_path, ASHBY_URL, recorded=recorded).run(page=page, navigate=False)

    assert result.status == "applied"
    assert len(recorded) == 1


def test_greenhouse_form_next_to_newsletter_fills_only_the_application(page, tmp_path: Path, cv_path: Path):
    recorded: list = []
    html = greenhouse_form()
    assert "</body>" in html
    page.set_content(html.replace("</body>", NEWSLETTER + "</body>"))
    flow = build_flow(tmp_path, cv_path, GREENHOUSE_URL, recorded=recorded)
    result = flow.run(page=page, navigate=False)

    assert result.status == "applied", result
    assert len(recorded) == 1
    assert page.evaluate("window.newsletterSubmits || 0") == 0
    newsletter_value = page.evaluate(
        "(() => { const el = document.getElementById('newsletter-email'); return el ? el.value : ''; })()"
    )
    assert newsletter_value == ""


STRAY_ENTRY = """
        <div class="ashby-application-form-field-entry" data-field-path="_systemfield_email">
          <label class="ashby-application-form-question-title" for="stray-email">Email</label>
          <input id="stray-email" type="email">
        </div>
"""


@pytest.mark.parametrize(
    ("wrapper", "reason"),
    [
        pytest.param('<form class="newsletter">{}</form>', "application_form_ambiguous", id="second-form"),
        pytest.param("<footer>{}</footer>", "application_field_outside_form", id="no-form"),
    ],
)
def test_ashby_field_outside_the_application_form_stops_before_filling(
    page, tmp_path: Path, cv_path: Path, wrapper: str, reason: str
):
    page.set_content(ashby_form().replace("</body>", wrapper.format(STRAY_ENTRY) + "</body>"))
    result = build_flow(tmp_path, cv_path, ASHBY_URL).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", reason)
    assert page.evaluate("document.getElementById('stray-email').value") == ""
    assert page.evaluate("document.getElementById('_systemfield_email').value") == ""


def test_submit_button_outside_the_form_is_no_pre_submit_boundary(page, tmp_path: Path, cv_path: Path):
    html = ashby_form()
    button = """<button class="ashby-application-form-submit-button" type="submit">
          Submit Application
        </button>"""
    assert button in html
    html = html.replace(button, "").replace(
        "</form>",
        '</form><button class="ashby-application-form-submit-button" type="button" '
        'onclick="window.outsideClicks=(window.outsideClicks||0)+1">Submit Application</button>',
    )
    page.set_content(html)
    recorded: list = []
    result = build_flow(tmp_path, cv_path, ASHBY_URL, recorded=recorded).run(page=page, navigate=False)

    assert (result.status, result.reason) == ("blocked_human", "submit_outside_form")
    assert page.evaluate("window.outsideClicks || 0") == 0
    assert page.evaluate("window.submitCount") == 0
    checkpoint = _checkpoint(tmp_path)
    assert checkpoint["submit_started"] is False
    assert "review" not in checkpoint["completed_steps"]
    assert recorded == []

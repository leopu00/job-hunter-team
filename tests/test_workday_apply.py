"""The CLOSER on a Workday posting: wait for the single-page app, name the stop, never click.

Position 1817 (14/09) stopped as ats_unsupported with a blank screenshot.
Synthetic pages shaped like a real Workday posting (its data-automation-id
attributes), served by Playwright routes; nothing reaches Workday.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import workday_apply  # noqa: E402
from apply_flow import ApplicationFlow  # noqa: E402

URL = "https://example.wd3.myworkdayjobs.com/Careers/job/Amsterdam/Synthetic-Engineer_R000001"


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool = True
    reason: str = "apply_allowed"
    context: dict = field(default_factory=lambda: {"mode": "authorised"})

    def log_line(self) -> str:
        return "[apply-gate] ALLOW"


def posting(body: str, *, delay_ms: int = 1500) -> str:
    """An empty shell that draws the posting later, as Workday does."""
    return (
        "<html><body><div id='root'></div><script>"
        "window.applyClicks = 0;"
        f"setTimeout(() => {{ document.getElementById('root').innerHTML = {body!r};"
        "document.querySelectorAll('[data-automation-id=adventureButton]').forEach(a => "
        "a.addEventListener('click', e => { e.preventDefault(); window.applyClicks += 1; })); }, "
        f"{delay_ms});"
        "</script></body></html>"
    )


OPEN = (
    "<div data-automation-id='jobPostingPage'><h2 data-automation-id='jobPostingHeader'>Synthetic Engineer</h2>"
    f"<a data-automation-id='adventureButton' href='{URL}/apply'>Apply</a>"
    "<div data-automation-id='jobPostingDescription'>What you will do.</div></div>"
)
CLOSED = (
    "<div data-automation-id='jobPostingPage'><h2 data-automation-id='jobPostingHeader'>Synthetic Engineer</h2>"
    "<p>This job posting is no longer available.</p></div>"
)


@pytest.fixture
def page():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        current = browser.new_context().new_page()
        yield current
        browser.close()


def run(page, tmp_path: Path, html: str, monkeypatch, profile: dict | None = None):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    page.route(URL, lambda route: route.fulfill(status=200, content_type="text/html", body=html))
    monkeypatch.setattr(ApplicationFlow, "_navigate", lambda self, p: p.goto(self.url, wait_until="domcontentloaded"))
    cv = tmp_path / "cv.pdf"
    cv.write_bytes(b"%PDF-1.4\n")
    flow = ApplicationFlow(
        position_id=17,
        url=URL,
        profile=profile if profile is not None else {
            "name": "Test Candidate", "contacts": {"email": "candidate@example.invalid"}
        },
        cv_path=cv,
        checkpoint_path=tmp_path / "17.json",
        receipt_dir=tmp_path / "receipts",
        db_path=tmp_path / "jobs.db",
        gate_checker=lambda **_k: GateVerdict(),
        notifier=lambda **_k: "1",
        essentials_checker=lambda **_k: [],
        cv_checker=lambda _p: {"ok": True, "reasons": []},
        applied_recorder=lambda **_k: None,
    )
    return flow, flow.run(page=page, navigate=True)


APP = r"""
<script>
window.state = {created: null, signedIn: null, consent: false, marketing: false};
const flow = () => document.getElementById('root');
function accountStep(emailInUse) {
  flow().innerHTML = `
    <div data-automation-id="applyFlowPage">
      <ol data-automation-id="progressBar">
        <li data-automation-id="progressBarActiveStep">current step 1 of 5 Create Account/Sign In</li>
      </ol>
      <div data-automation-id="signInContent">
        <div>Password Requirements: a special character, 8 characters.</div>
        <form data-automation-id="signInFormo">
          <div data-automation-id="formField-email"><input data-automation-id="email" type="text"></div>
          <div data-automation-id="formField-password"><input data-automation-id="password" type="password"></div>
          <div data-automation-id="formField-verifyPassword"><input data-automation-id="verifyPassword" type="password"></div>
          <div>By clicking Create Account you agree to the Candidate Privacy Notice.</div>
          <label><input data-automation-id="createAccountCheckbox" type="checkbox"> Yes, I have read and consent to the terms and conditions.</label>
          <label><input data-automation-id="marketingCheckbox" type="checkbox"> Send me job alerts</label>
          <button data-automation-id="createAccountSubmitButton" type="button">Create Account</button>
          <button data-automation-id="signInLink" type="button">Sign In</button>
        </form>
      </div>
    </div>`;
  flow().querySelector('[data-automation-id=createAccountSubmitButton]').addEventListener('click', () => {
    window.state.consent = flow().querySelector('[data-automation-id=createAccountCheckbox]').checked;
    window.state.marketing = flow().querySelector('[data-automation-id=marketingCheckbox]').checked;
    window.state.created = {
      email: flow().querySelector('[data-automation-id=email]').value,
      password: flow().querySelector('[data-automation-id=password]').value,
      verify: flow().querySelector('[data-automation-id=verifyPassword]').value,
    };
    if (emailInUse) {
      flow().insertAdjacentHTML('beforeend',
        '<div data-automation-id="errorMessage">An account with this email already exists.</div>');
      return;
    }
    myInformation();
  });
  flow().querySelector('[data-automation-id=signInLink]').addEventListener('click', () => signInStep());
}
function signInStep() {
  flow().innerHTML = `
    <div data-automation-id="applyFlowPage">
      <ol data-automation-id="progressBar"><li data-automation-id="progressBarActiveStep">current step 1 of 5 Sign In</li></ol>
      <div data-automation-id="signInContent">
        <div data-automation-id="formField-email"><input data-automation-id="email" type="text"></div>
        <div data-automation-id="formField-password"><input data-automation-id="password" type="password"></div>
        <button data-automation-id="signInSubmitButton" type="button">Sign In</button>
      </div>
    </div>`;
  flow().querySelector('[data-automation-id=signInSubmitButton]').addEventListener('click', () => {
    window.state.signedIn = {
      email: flow().querySelector('[data-automation-id=email]').value,
      password: flow().querySelector('[data-automation-id=password]').value,
    };
    myInformation();
  });
}
function myInformation() {
  flow().innerHTML = `
    <div data-automation-id="applyFlowPage">
      <ol data-automation-id="progressBar"><li data-automation-id="progressBarActiveStep">current step 2 of 5 My Information</li></ol>
      <div data-automation-id="formField-firstName"><label>First Name</label><input data-automation-id="legalNameSection_firstName"></div>
    </div>`;
}
function posting() {
  flow().innerHTML = `
    <div data-automation-id="jobPostingPage">
      <h2 data-automation-id="jobPostingHeader">Synthetic Engineer</h2>
      <a data-automation-id="adventureButton" href="#apply">Apply</a>
      <div data-automation-id="jobPostingDescription">What you will do.</div>
    </div>`;
  flow().querySelector('[data-automation-id=adventureButton]').addEventListener('click', e => {
    e.preventDefault();
    flow().insertAdjacentHTML('beforeend', `
      <div data-automation-id="wd-popup-frame" aria-label="Start Your Application">
        <a data-automation-id="autofillWithResume" href="#autofill">Autofill with Resume</a>
        <a data-automation-id="applyManually" href="#manual">Apply Manually</a>
      </div>`);
    flow().querySelector('[data-automation-id=applyManually]').addEventListener('click', ev => {
      ev.preventDefault();
      accountStep(__EMAIL_IN_USE__);
    });
  });
}
setTimeout(posting, __DELAY__);
</script>
"""


def workday_app(*, delay_ms: int = 1200, email_in_use: bool = False) -> str:
    script = APP.replace("__DELAY__", str(delay_ms)).replace("__EMAIL_IN_USE__", "true" if email_in_use else "false")
    return f"<html><body><div id='root'></div>{script}</body></html>"


def accounts_file(home: Path):
    folder = home / "credentials" / "ats-accounts"
    return next(folder.glob("*.json"), None) if folder.is_dir() else None


def test_an_open_posting_is_applied_to_through_its_account_step(page, tmp_path: Path, monkeypatch):
    flow, result = run(page, tmp_path, workday_app(), monkeypatch)

    # The account is created; the steps after it are not walked yet.
    assert (result.status, result.reason) == ("blocked_human", "workday_step_unsupported")
    assert "My Information" in json.loads((tmp_path / "17.json").read_text())["blocked_detail"]
    created = page.evaluate("window.state.created")
    assert created["email"] == "candidate@example.invalid"
    assert created["password"] and created["password"] == created["verify"]
    assert page.evaluate("window.state.consent") is True
    assert page.evaluate("window.state.marketing") is False, "only the terms box is ticked"

    saved = accounts_file(tmp_path)
    assert saved is not None and oct(saved.stat().st_mode & 0o777) == "0o600"
    account = json.loads(saved.read_text())
    assert (account["email"], account["state"]) == ("candidate@example.invalid", "active")
    assert account["password"] == created["password"]
    checkpoint = (tmp_path / "17.json").read_text()
    assert account["password"] not in checkpoint


def test_a_saved_account_signs_in_instead_of_creating_a_second_one(page, tmp_path: Path, monkeypatch):
    import ats_account

    tenant = ats_account.tenant_id("workday", URL)
    credentials = ats_account.create_pending(tmp_path, tenant, "candidate@example.invalid")

    _flow, result = run(page, tmp_path, workday_app(), monkeypatch)

    assert result.reason == "workday_step_unsupported"
    assert page.evaluate("window.state.created") is None
    signed_in = page.evaluate("window.state.signedIn")
    assert signed_in == {"email": credentials.email, "password": credentials.password}


def test_an_email_the_portal_already_knows_stops_without_a_password_reset(page, tmp_path: Path, monkeypatch):
    _flow, result = run(page, tmp_path, workday_app(email_in_use=True), monkeypatch)

    assert (result.status, result.reason) == ("blocked_human", "account_email_in_use")


def test_a_profile_without_an_email_never_starts_an_account(page, tmp_path: Path, monkeypatch):
    _flow, result = run(page, tmp_path, workday_app(), monkeypatch, profile={"name": "Test Candidate"})

    assert (result.status, result.reason) == ("blocked_human", "account_email_missing")
    assert accounts_file(tmp_path) is None
    assert page.evaluate("window.state.created") is None


def test_a_closed_posting_is_a_closed_vacancy(page, tmp_path: Path, monkeypatch):
    _flow, result = run(page, tmp_path, posting(CLOSED), monkeypatch)

    assert result.reason == "vacancy_closed"


def test_a_posting_that_never_renders_is_unavailable_not_unsupported(page, tmp_path: Path, monkeypatch):
    monkeypatch.setattr(workday_apply, "RENDER_WAIT_MS", 800)
    monkeypatch.setattr(workday_apply.stop_for, "__defaults__", (800,), raising=False)

    _flow, result = run(page, tmp_path, "<html><body><div id='root'></div></body></html>", monkeypatch)

    assert result.reason == "page_unavailable"


def test_the_password_field_is_marked_so_screenshots_hide_it(page, tmp_path: Path, monkeypatch):
    import ats_account

    # The portal keeps the account step open (the email is already in use), so
    # the field the CLOSER typed into is still on the page at the stop.
    _flow, result = run(page, tmp_path, workday_app(email_in_use=True), monkeypatch)

    assert result.reason == "account_email_in_use"
    marked = page.evaluate(
        "attr => document.querySelector('[data-automation-id=password]').getAttribute(attr)",
        ats_account.SECRET_ATTR,
    )
    assert marked == "1"
    with ats_account.secrets_hidden(page):
        assert page.evaluate(
            "() => document.querySelector('[data-automation-id=password]').style.visibility"
        ) == "hidden"

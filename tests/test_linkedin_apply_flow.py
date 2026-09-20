"""Safety contracts for the CLOSER on LinkedIn: company-site handoff and Easy Apply.

Synthetic pages only.  Every LinkedIn and Lever address is answered by a
Playwright route inside the test browser; the "account", the password and the
verification codes are made up.  Nothing reaches LinkedIn.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote

import pytest


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import _db  # noqa: E402
import application_answers  # noqa: E402
import apply_flow  # noqa: E402
import linkedin_apply  # noqa: E402
from apply_flow import ApplicationFlow, FlowCheckpoint, PlatformHandoff  # noqa: E402

from test_lever_apply_flow import APPLY as LEVER_APPLY, lever_form  # noqa: E402


JOB = "https://www.linkedin.com/jobs/view/4000000001/"
EMAIL = "candidate@example.invalid"
PASSWORD = "synthetic-password-not-real"
CODE = "246810"


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool = True
    reason: str = "apply_allowed"
    context: dict = field(default_factory=lambda: {"mode": "authorised"})

    def log_line(self) -> str:
        return f"[apply-gate] {'ALLOW' if self.allowed else 'DENY'} {self.reason}"


# ── the synthetic LinkedIn ───────────────────────────────────────────────────

EASY_APPLY_SCRIPT = r"""
<script>
window.submitCount = 0; window.followedAtSubmit = null;
const steps = [
  `<div class="jobs-easy-apply-form-section__grouping"><label for="email">Email address</label>
     <select id="email" name="email" required><option value="a">candidate@example.invalid</option></select></div>
   <div class="jobs-easy-apply-form-section__grouping"><label for="phone">Mobile phone number</label>
     <input id="phone" name="phone" required></div>
   <button aria-label="Continue to next step">Next</button>`,
  `<div class="jobs-easy-apply-form-section__grouping"><label for="resume">Upload resume</label>
     <input id="resume" type="file" name="resume"><span class="filename"></span></div>
   <button aria-label="Continue to next step">Next</button>`,
  `__QUESTION__<button aria-label="Review your application">Review</button>`,
  `<h3>Review your application</h3>
   <label><input type="checkbox" id="follow-company-checkbox" checked> Follow Example to stay up to date</label>
   <button aria-label="Submit application">Submit application</button>`,
];
function render(index) {
  const dialog = document.querySelector('[role=dialog]');
  dialog.innerHTML = steps[index];
  const resume = dialog.querySelector('#resume');
  if (resume) resume.addEventListener('change', e => {
    if (!__REJECT_UPLOAD__) dialog.querySelector('.filename').textContent = e.target.files[0].name;
  });
  dialog.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    if (button.getAttribute('aria-label') === 'Submit application') {
      window.submitCount += 1;
      window.followedAtSubmit = dialog.querySelector('#follow-company-checkbox').checked;
      dialog.innerHTML = '<h2>Your application was sent to Example!</h2>';
      return;
    }
    render(index + 1);
  }));
}
document.querySelectorAll('.jobs-apply-button, [data-easy-apply-fixture]').forEach(control => control.addEventListener('click', () => {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.className = 'jobs-easy-apply-modal';
  if (document.querySelector('[role=dialog]')) return;
  document.body.appendChild(dialog);
  render(0);
}));
</script>
"""

QUESTION = (
    '<div class="jobs-easy-apply-form-section__grouping"><fieldset><legend>Are you comfortable commuting?</legend>'
    '<label><input type="radio" name="commute" value="Yes" required>Yes</label>'
    '<label><input type="radio" name="commute" value="No" required>No</label></fieldset></div>'
)


# The public page of an offsite vacancy, signed out, as LinkedIn serves it:
# the Apply button opens a sign-in dialog, and the only links carrying the
# "apply-link-offsite" tracking name are that dialog's Join and Dismiss.  The
# company address appears only signed in, behind a button opening a new tab.
GUEST_OFFSITE_CONTROLS = (
    '<button class="sign-up-modal__outlet top-card-layout__cta--primary" '
    'data-tracking-control-name="public_jobs_contextual-sign-in-modal_ssr-ui-lib-outlet-button" '
    'data-modal="job-details-topcard-apply-modal">Apply</button>'
    '<div class="contextual-sign-in-modal">'
    '<button data-tracking-control-name="public_jobs_apply-link-offsite_contextual-sign-in-modal_modal_dismiss" '
    'aria-label="Dismiss"></button>'
    '<a class="contextual-sign-in-modal__join-link" '
    'data-tracking-control-name="public_jobs_apply-link-offsite_contextual-sign-in-modal_join-link" '
    'href="https://www.linkedin.com/signup/cold-join?source=jobs_registration&amp;session_redirect='
    'https%3A%2F%2Fes.linkedin.com%2Fjobs%2Fview%2F4000000001">Join now</a></div>'
)
SIGNED_IN_OFFSITE_CONTROLS = (
    '<button class="jobs-apply-button" aria-label="Apply to Test Role on company website" '
    f"onclick=\"window.open('{LEVER_APPLY}', '_blank')\">Apply</button>"
)


def job_page(signed_in: bool, *, offsite: bool = False, easy: bool = True, question: bool = True,
             reject_upload: bool = False, guest_offsite: bool = False, question_html: str | None = None,
             modern_nav: bool = False, closed: bool = False, easy_button: str | None = None) -> str:
    nav = '<nav id="global-nav">Home</nav>' if signed_in else '<a href="/login">Sign in</a>'
    if signed_in and modern_nav:
        # LinkedIn's 2026 top bar, as the box saw it on 14/09: no #global-nav.
        nav = ('<header><a href="https://www.linkedin.com/feed/">Home</a>'
               '<a href="https://www.linkedin.com/mynetwork/grow/">La mia rete</a>'
               '<a href="https://www.linkedin.com/messaging/thread/new/">Messaggistica</a></header>')
    if closed:
        return (f"<html><body>{nav}<h1>Test Role</h1><p>Promossa da recruiter</p>"
                "<p>Not currently accepting applications</p></body></html>")
    if guest_offsite:
        controls = SIGNED_IN_OFFSITE_CONTROLS if signed_in else GUEST_OFFSITE_CONTROLS
        return f"<html><body>{nav}<h1>Test Role</h1>{controls}</body></html>"
    if offsite:
        target = quote(LEVER_APPLY, safe="")
        control = (
            '<a data-tracking-control-name="public_jobs_apply-link-offsite" '
            f'href="https://www.linkedin.com/jobs/view/externalApply/4000000001?url={target}">Apply on company website</a>'
        )
        return f"<html><body>{nav}<h1>Test Role</h1>{control}</body></html>"
    if not easy:
        return f"<html><body>{nav}<h1>Test Role</h1><p>Details.</p></body></html>"
    step_three = question_html if question_html is not None else (QUESTION if question else "")
    script = EASY_APPLY_SCRIPT.replace("__QUESTION__", step_three).replace(
        "__REJECT_UPLOAD__", "true" if reject_upload else "false"
    )
    return (
        f"<html><body>{nav}<h1>Test Role</h1>"
        + (easy_button if easy_button is not None
           else '<button class="jobs-apply-button" aria-label="Easy Apply to Test Role">Easy Apply</button>')
        + f"{script}</body></html>"
    )


LOGIN_PAGE = """
<html><body><form id="login">
  <input id="username" name="session_key"><input id="password" type="password" name="session_password">
  <button type="submit">Sign in</button></form>
  <p id="error" hidden>Wrong email or password.</p>
<script>
document.querySelector('#login').addEventListener('submit', e => {
  e.preventDefault();
  const ok = document.querySelector('#username').value === '__EMAIL__'
    && document.querySelector('#password').value === '__PASSWORD__';
  if (!ok) { document.querySelector('#error').hidden = false; return; }
  if (__TWO_FACTOR__) { location.href = '/checkpoint/challenge/synthetic'; return; }
  document.cookie = 'li_at=synthetic; path=/';
  location.href = '/feed/';
});
</script></body></html>
""".replace("__EMAIL__", EMAIL).replace("__PASSWORD__", PASSWORD)

CODE_PAGE = """
<html><body><form id="pin"><input name="pin"><button type="submit">Submit</button></form>
<script>
document.querySelector('#pin').addEventListener('submit', e => {
  e.preventDefault();
  if (document.querySelector('[name=pin]').value !== '__CODE__') return;
  document.cookie = 'li_at=synthetic; path=/';
  location.href = '/feed/';
});
</script></body></html>
""".replace("__CODE__", CODE)


@dataclass
class Site:
    offsite: bool = False
    easy: bool = True
    question: bool = True
    two_factor: bool = False
    challenge: bool = False
    reject_upload: bool = False
    guest_offsite: bool = False
    wrong_code: bool = False
    question_html: str | None = None
    modern_nav: bool = False
    closed: bool = False
    easy_button: str | None = None
    modern_modal: bool = False
    modern_start_step: int = 0
    requests: list = field(default_factory=list)

    def install(self, page) -> None:
        def handler(route):
            request = route.request
            url = request.url
            self.requests.append(url)
            signed_in = "li_at=synthetic" in (request.all_headers().get("cookie") or "")
            if url.startswith(JOB) and self.modern_modal and signed_in:
                body = modern_job_page(question=self.question, reject_upload=self.reject_upload,
                                       start_step=self.modern_start_step)
            elif url.startswith(JOB):
                body = job_page(signed_in, offsite=self.offsite, easy=self.easy, question=self.question,
                                reject_upload=self.reject_upload, guest_offsite=self.guest_offsite,
                                question_html=self.question_html, modern_nav=self.modern_nav,
                                closed=self.closed, easy_button=self.easy_button)
            elif url.startswith("https://www.linkedin.com/login"):
                body = (
                    "<html><body><h1>Let's do a quick security check</h1></body></html>"
                    if self.challenge
                    else LOGIN_PAGE.replace("__TWO_FACTOR__", "true" if self.two_factor else "false")
                )
            elif url.startswith("https://www.linkedin.com/checkpoint/challenge/"):
                body = CODE_PAGE.replace(CODE, "never-this-code") if self.wrong_code else CODE_PAGE
            elif url.startswith("https://www.linkedin.com/feed/"):
                body = '<html><body><nav id="global-nav">Home</nav></body></html>'
            elif url == LEVER_APPLY:
                body = lever_form()
            else:
                route.fulfill(status=404, content_type="text/html", body="<html><body>missing</body></html>")
                return
            route.fulfill(status=200, content_type="text/html", body=body)

        # The context, not the page: a tab the company-site button opens is
        # answered here too and never reaches the network.
        page.context.route("**/*", handler)

    def logins(self) -> int:
        return sum(url.startswith("https://www.linkedin.com/login") for url in self.requests)


@pytest.fixture
def page():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        context = browser.new_context()
        current = context.new_page()
        yield current
        browser.close()


@pytest.fixture
def home(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    conn = sqlite3.connect(tmp_path / "jobs.db")
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    conn.execute(
        "INSERT INTO positions (id, title, company, url, status) VALUES (71, 'Synthetic role', 'Synthetic company', ?, 'ready')",
        (JOB,),
    )
    conn.commit()
    conn.close()
    # No DNS in tests: a handoff's public-address guard is exercised elsewhere.
    import safe_fetch

    monkeypatch.setattr(safe_fetch, "resolve_public_address", lambda *_a, **_k: None)
    return tmp_path


@pytest.fixture
def cv_path(tmp_path: Path) -> Path:
    path = tmp_path / "test-profile.pdf"
    path.write_bytes(b"%PDF-1.4\n% test fixture only\n")
    return path


def write_credentials(home: Path, *, password: str = PASSWORD, mode: int = 0o600) -> Path:
    path = home / "credentials" / "linkedin.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"email": EMAIL, "password": password}))
    os.chmod(path, mode)
    return path


def write_session(home: Path) -> None:
    linkedin_apply._write_private_json(
        home / ".cache" / "linkedin" / "storage-state.json",
        {"cookies": [{"name": "li_at", "value": "synthetic", "domain": "www.linkedin.com", "path": "/",
                      "secure": True, "httpOnly": True, "sameSite": "Lax", "expires": time.time() + 3600}]},
    )


def build_flow(home: Path, cv_path: Path, *, answers: dict | None = None, recorded: list | None = None,
               code_notifier=None, code_timeout: float = 5.0, extra_profile: dict | None = None,
               url: str = JOB, gate: GateVerdict | None = None) -> ApplicationFlow:
    recorded = recorded if recorded is not None else []
    candidate = {"name": "Test Candidate", "contacts": {"email": EMAIL, "phone": "+10000000000"}}
    candidate.update(extra_profile or {})
    candidate["application_answers"] = answers if answers is not None else {"Are you comfortable commuting?": "Yes"}
    return ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
        cv_checker=lambda _path: {"ok": True, "reasons": []},
        position_id=71,
        url=url,
        profile=candidate,
        cv_path=cv_path,
        checkpoint_path=home / ".cache" / "apply-flow" / "71.json",
        receipt_dir=home / "receipts",
        db_path=home / "jobs.db",
        gate_checker=lambda **_kwargs: gate or GateVerdict(),
        notifier=lambda **_kwargs: "notification-1",
        applied_recorder=lambda **kwargs: recorded.append(kwargs),
        code_notifier=code_notifier,
        login_code_timeout_s=code_timeout,
        confirmation_timeout_ms=1500,
    )


def run(flow: ApplicationFlow, page, site: Site):
    site.install(page)
    return flow.run(page=page, navigate=True)


def checkpoint(home: Path) -> dict:
    return json.loads((home / ".cache" / "apply-flow" / "71.json").read_text())


@pytest.fixture(autouse=True)
def no_dns_guard(monkeypatch):
    monkeypatch.setattr(ApplicationFlow, "_navigate", lambda self, page: page.goto(self.url, wait_until="domcontentloaded"))


# ── company website ──────────────────────────────────────────────────────────


def test_apply_on_company_website_hands_over_to_the_destination_recipe(page, home: Path, cv_path: Path):
    recorded: list = []
    site = Site(offsite=True)

    result = run(build_flow(home, cv_path, recorded=recorded), page, site)

    assert result.status == "applied", result
    saved = checkpoint(home)
    assert (saved["url"], saved["handoff_url"], saved["platform"]) == (JOB, LEVER_APPLY, "lever")
    assert site.logins() == 0
    assert len(recorded) == 1


@pytest.mark.parametrize(
    "target",
    ("http://jobs.lever.co/example/0000-test-posting/apply", "https://www.linkedin.com/jobs/view/1/"),
)
def test_a_handoff_off_https_or_back_to_linkedin_is_refused(home: Path, cv_path: Path, target: str):
    flow = build_flow(home, cv_path)
    saved = FlowCheckpoint.new(71, JOB)
    saved.platform = "linkedin"

    with pytest.raises(apply_flow.BlockedHuman) as stop:
        flow._follow_handoff(saved, page=None, handoff=PlatformHandoff(target), count=1)

    assert stop.value.reason == "application_redirect_untrusted"


def test_a_second_handoff_in_one_run_is_refused(home: Path, cv_path: Path):
    flow = build_flow(home, cv_path)
    saved = FlowCheckpoint.new(71, JOB)
    saved.platform = "lever"

    with pytest.raises(apply_flow.BlockedHuman) as stop:
        flow._follow_handoff(saved, page=None, handoff=PlatformHandoff(LEVER_APPLY), count=2)

    assert "handoff_loop" in stop.value.detail


def test_a_company_form_may_hand_over_only_to_a_known_platform(home: Path, cv_path: Path):
    flow = build_flow(home, cv_path)
    saved = FlowCheckpoint.new(71, "https://careers.example.invalid/job")
    saved.platform = "generic"

    with pytest.raises(apply_flow.BlockedHuman) as stop:
        flow._follow_handoff(saved, page=None, handoff=PlatformHandoff("https://other.example.invalid/form"), count=1)

    assert stop.value.reason == "application_redirect_untrusted"


# ── Easy Apply ───────────────────────────────────────────────────────────────


def test_easy_apply_with_the_saved_session_never_signs_in_and_never_follows(page, home: Path, cv_path: Path):
    write_session(home)
    recorded: list = []
    site = Site()

    result = run(build_flow(home, cv_path, recorded=recorded), page, site)

    assert result.status == "applied", result
    assert site.logins() == 0
    assert page.evaluate("window.submitCount") == 1
    assert page.evaluate("window.followedAtSubmit") is False
    saved = checkpoint(home)
    assert saved["platform"] == "linkedin" and saved["modal_step"] == 4
    assert recorded[0]["receipt"].confirmation_text.startswith("Your application was sent")
    assert (home / ".cache" / "linkedin" / "last-apply.json").is_file()


def test_easy_apply_signs_in_once_and_keeps_the_session(page, home: Path, cv_path: Path, capsys):
    write_credentials(home)
    site = Site()

    result = run(build_flow(home, cv_path), page, site)

    assert result.status == "applied", result
    assert site.logins() == 1
    state = home / ".cache" / "linkedin" / "storage-state.json"
    assert oct(state.stat().st_mode & 0o777) == "0o600"
    assert oct(state.parent.stat().st_mode & 0o777) == "0o700"
    for text in (checkpoint(home) and (home / ".cache" / "apply-flow" / "71.json").read_text(), capsys.readouterr().out):
        assert PASSWORD not in text


@pytest.mark.parametrize("problem", ("missing", "group_readable", "symlink"))
def test_credentials_only_from_a_private_regular_file(page, home: Path, cv_path: Path, problem: str):
    if problem == "group_readable":
        write_credentials(home, mode=0o640)
    elif problem == "symlink":
        real = write_credentials(home)
        moved = home / "elsewhere.json"
        real.rename(moved)
        real.symlink_to(moved)
    site = Site()

    result = run(build_flow(home, cv_path), page, site)

    assert (result.status, result.reason) == ("blocked_human", "linkedin_credentials_missing")
    assert site.logins() == 0  # read before the sign-in page is even opened


def test_a_sign_in_that_fails_twice_stops_and_is_not_tried_again(page, home: Path, cv_path: Path):
    credentials = write_credentials(home, password="wrong-synthetic-password")
    site = Site()

    first = run(build_flow(home, cv_path), page, site)
    second = build_flow(home, cv_path).run(page=page, navigate=True)
    logins = site.logins()
    third = build_flow(home, cv_path).run(page=page, navigate=True)

    assert (first.status, first.reason) == ("denied", "linkedin_login_retry")
    assert (second.status, second.reason) == ("blocked_human", "linkedin_login_failed")
    assert third.reason == "linkedin_login_failed" and site.logins() == logins
    assert PASSWORD not in (home / ".cache" / "apply-flow" / "71.json").read_text()

    # New credentials written after the failures: one more try is allowed.
    write_credentials(home)
    os.utime(credentials, (time.time() + 5, time.time() + 5))
    reauthorised = FlowCheckpoint.new(71, JOB)
    reauthorised.save(home / ".cache" / "apply-flow" / "71.json")
    fourth = build_flow(home, cv_path).run(page=page, navigate=True)
    assert fourth.status == "applied", fourth


def telegram_bridge(home: Path, *, deliver: str = "telegram", reply: str | None = CODE, calls: list | None = None):
    """What jht-notify-user and the Telegram bridge do, synchronously: the row, then the code file."""

    def notifier(*, position_id, message, source_id, payload):
        if calls is not None:
            calls.append({"message": message, "payload": dict(payload)})
        conn = sqlite3.connect(home / "jobs.db")
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, related_position_id, source_id, source_action, "
            "source_payload, delivered_via) VALUES ('closer', ?, 'alert', ?, ?, 'closer_login_code', ?, ?)",
            (message, position_id, source_id, json.dumps(payload), deliver),
        )
        conn.commit()
        if reply is not None:
            # The real bridge function: the user replies to the request with the code.
            outcome = application_answers.resolve_login_code(
                conn, text=f"here it is {reply}", reply_to_text=message, direct=False, jht_home=home
            )
            assert outcome.status == "received", outcome
        conn.commit()
        conn.close()
        return deliver

    return notifier


def login_rows(home: Path) -> list:
    conn = sqlite3.connect(home / "jobs.db")
    try:
        return conn.execute(
            "SELECT user_reply, body, source_payload FROM pending_user_messages WHERE source_action = 'closer_login_code'"
        ).fetchall()
    finally:
        conn.close()


def test_the_verification_code_is_asked_on_telegram_typed_and_forgotten(page, home: Path, cv_path: Path):
    write_credentials(home)
    calls: list = []

    result = run(build_flow(home, cv_path, code_notifier=telegram_bridge(home, calls=calls)), page, Site(two_factor=True))

    assert result.status == "applied", result
    assert len(calls) == 1 and calls[0]["payload"]["service"] == "linkedin"
    rows = login_rows(home)
    assert [row[0] for row in rows] == ["[used]"]
    assert all(CODE not in (row[1] + row[2]) for row in rows)
    assert not list((home / ".cache" / "apply-flow" / "login-code").glob("*.json"))
    assert CODE not in (home / ".cache" / "apply-flow" / "71.json").read_text()


def test_no_code_before_it_expires_stops_and_closes_the_request(page, home: Path, cv_path: Path):
    write_credentials(home)

    result = run(
        build_flow(home, cv_path, code_notifier=telegram_bridge(home, reply=None), code_timeout=0.5),
        page,
        Site(two_factor=True),
    )

    assert (result.status, result.reason) == ("blocked_human", "linkedin_login_code_missing")
    assert [row[0] for row in login_rows(home)] == ["[expired]"]


def test_a_code_request_that_misses_telegram_stops_at_once(page, home: Path, cv_path: Path):
    write_credentials(home)

    result = run(
        build_flow(home, cv_path, code_notifier=telegram_bridge(home, deliver="web", reply=None)),
        page,
        Site(two_factor=True),
    )

    assert (result.status, result.reason) == ("blocked_human", "linkedin_login_code_undelivered")
    assert [row[0] for row in login_rows(home)] == ["[expired]"]


def test_a_code_file_anyone_else_can_read_is_never_typed(page, home: Path, cv_path: Path):
    write_credentials(home)
    bridge = telegram_bridge(home)

    def loose(**kwargs):
        out = bridge(**kwargs)
        for path in (home / ".cache" / "apply-flow" / "login-code").glob("*.json"):
            os.chmod(path, 0o644)
        return out

    result = run(build_flow(home, cv_path, code_notifier=loose), page, Site(two_factor=True))

    assert (result.status, result.reason) == ("blocked_human", "linkedin_login_code_missing")
    assert not list((home / ".cache" / "apply-flow" / "login-code").glob("*.json"))


def test_a_security_check_stops_for_the_user(page, home: Path, cv_path: Path):
    write_credentials(home)

    result = run(build_flow(home, cv_path), page, Site(challenge=True))

    assert (result.status, result.reason) == ("blocked_human", "linkedin_challenge")
    assert checkpoint(home)["stop_screenshot"]


def test_linkedin_applications_are_spaced_out(page, home: Path, cv_path: Path):
    write_session(home)
    linkedin_apply._write_private_json(home / ".cache" / "linkedin" / "last-apply.json", {"at": linkedin_apply._utc_now().isoformat()})
    site = Site()

    result = run(build_flow(home, cv_path), page, site)

    assert (result.status, result.reason) == ("denied", "linkedin_throttled")
    assert page.locator("[role=dialog]").count() == 0

    (home / "jht.config.json").write_text(json.dumps({"applications": {"auto_apply": {"linkedin_min_interval_minutes": 0}}}))
    assert build_flow(home, cv_path).run(page=page, navigate=True).status == "applied"


@pytest.mark.parametrize("value", (-1, "20", True, 2.5))
def test_an_invalid_pause_denies_instead_of_dropping_the_pause(page, home: Path, cv_path: Path, value):
    write_session(home)
    (home / "jht.config.json").write_text(json.dumps({"applications": {"auto_apply": {"linkedin_min_interval_minutes": value}}}))

    result = run(build_flow(home, cv_path), page, Site())

    assert (result.status, result.reason) == ("denied", "linkedin_interval_invalid")


def test_an_unanswered_easy_apply_question_stops_silently(page, home: Path, cv_path: Path):
    write_session(home)

    result = run(build_flow(home, cv_path, answers={}), page, Site())

    assert (result.status, result.reason) == ("blocked_human", "required_answer_missing")
    assert result.pending_question["label"] == "Are you comfortable commuting?"
    assert result.pending_question["options"] == ["Yes", "No"]
    assert page.evaluate("window.submitCount") == 0


def test_a_cv_linkedin_does_not_show_as_attached_blocks(page, home: Path, cv_path: Path):
    write_session(home)

    result = run(build_flow(home, cv_path), page, Site(reject_upload=True))

    assert (result.status, result.reason) == ("blocked_human", "upload_rejected")
    assert page.evaluate("window.submitCount") == 0


def test_no_easy_apply_and_no_company_link_stops(page, home: Path, cv_path: Path):
    write_session(home)

    result = run(build_flow(home, cv_path), page, Site(easy=False))

    assert (result.status, result.reason) == ("blocked_human", "linkedin_apply_control_missing")


def test_a_linkedin_vacancy_served_from_another_host_is_refused(page, home: Path, cv_path: Path, monkeypatch):
    write_session(home)
    site = Site()
    site.install(page)
    page.route("https://careers.example.invalid/**", lambda route: route.fulfill(status=200, content_type="text/html", body=job_page(True)))
    monkeypatch.setattr(ApplicationFlow, "_navigate", lambda self, p: p.goto("https://careers.example.invalid/job"))
    # Isolate the recipe-page guard from the earlier redirected-away check.
    monkeypatch.setattr(apply_flow, "vacancy_redirected_away", lambda *_a: False)

    result = build_flow(home, cv_path).run(page=page, navigate=True)

    assert (result.status, result.reason) == ("blocked_human", "linkedin_redirect_untrusted")


def test_easy_apply_after_submit_started_is_never_clicked_again(page, home: Path, cv_path: Path):
    write_session(home)
    saved = FlowCheckpoint.new(71, JOB)
    saved.platform = "linkedin"
    saved.state = "submit"
    saved.submit_started = True
    saved.save(home / ".cache" / "apply-flow" / "71.json")
    recorded: list = []

    result = run(build_flow(home, cv_path, recorded=recorded), page, Site())

    assert (result.status, result.reason) == ("blocked_human", "submit_outcome_unknown")
    assert recorded == []


def test_offsite_target_unwraps_only_linkedins_own_redirect():
    wrapped = "https://www.linkedin.com/jobs/view/externalApply/1?url=" + quote("https://jobs.lever.co/x/1/apply", safe="")
    assert linkedin_apply.offsite_target(wrapped, JOB) == "https://jobs.lever.co/x/1/apply"
    other = "https://tracker.example.invalid/r?url=" + quote("https://jobs.lever.co/x/1/apply", safe="")
    assert linkedin_apply.offsite_target(other, JOB) == other


def test_a_code_file_for_another_request_is_never_typed(page, home: Path, cv_path: Path):
    write_credentials(home)
    bridge = telegram_bridge(home)

    def crossed(**kwargs):
        out = bridge(**kwargs)
        for path in (home / ".cache" / "apply-flow" / "login-code").glob("*.json"):
            data = json.loads(path.read_text())
            data["source_id"] = "closer-login-code:linkedin:1"
            linkedin_apply._write_private_json(path, data)
        return out

    result = run(build_flow(home, cv_path, code_notifier=crossed), page, Site(two_factor=True))

    assert (result.status, result.reason) == ("blocked_human", "linkedin_login_code_missing")


def test_recovery_after_a_handoff_reads_the_company_site_not_linkedin(page, home: Path, cv_path: Path):
    saved = FlowCheckpoint.new(71, JOB)
    saved.platform = "lever"
    saved.handoff_url = LEVER_APPLY
    saved.state = "submit"
    saved.submit_started = True
    saved.save(home / ".cache" / "apply-flow" / "71.json")
    confirmation = '<html><body><div class="application-confirmation"><h3>Application submitted!</h3></div></body></html>'
    page.route(LEVER_APPLY, lambda route: route.fulfill(status=200, content_type="text/html", body=confirmation))
    page.route(JOB, lambda route: route.fulfill(status=200, content_type="text/html", body=job_page(True)))
    recorded: list = []

    result = build_flow(home, cv_path, recorded=recorded).run(page=page, navigate=True)

    assert result.status == "applied", result
    assert len(recorded) == 1


def test_two_different_company_addresses_are_ambiguous(page, cv_path: Path):
    links = "".join(
        f'<a data-tracking-control-name="public_jobs_apply-link-offsite" href="https://jobs.lever.co/x/{n}/apply">Apply</a>'
        for n in (1, 2)
    )
    page.set_content(f"<html><body>{links}</body></html>")
    recipe = linkedin_apply.LinkedInEasyApplyRecipe({}, cv_path)

    with pytest.raises(apply_flow.BlockedHuman) as stop:
        recipe._offsite(page)

    assert stop.value.reason == "linkedin_apply_ambiguous"


# ── the public page as LinkedIn serves it (shapes read on real vacancies) ────


def test_signed_out_offsite_signs_in_and_hands_over_to_the_company_site(page, home: Path, cv_path: Path):
    write_credentials(home)
    recorded: list = []
    site = Site(guest_offsite=True)

    result = run(build_flow(home, cv_path, recorded=recorded), page, site)

    assert result.status == "applied", result
    saved = checkpoint(home)
    assert (saved["url"], saved["handoff_url"], saved["platform"]) == (JOB, LEVER_APPLY, "lever")
    assert site.logins() == 1
    assert not any("/signup" in url for url in site.requests)
    assert len(recorded) == 1


def test_the_sign_in_dialog_links_are_never_a_company_address(page, cv_path: Path):
    page.set_content(f"<html><body>{GUEST_OFFSITE_CONTROLS}</body></html>")
    recipe = linkedin_apply.LinkedInEasyApplyRecipe({}, cv_path)

    assert recipe._offsite(page) is None
    assert recipe.apply_control_present(page)


def test_signed_out_easy_apply_counts_as_an_apply_control(page, cv_path: Path):
    page.set_content(
        '<html><body><button class="apply-button" data-tracking-control-name="public_jobs_apply-link-onsite">'
        "Apply</button></body></html>"
    )
    recipe = linkedin_apply.LinkedInEasyApplyRecipe({}, cv_path)

    assert recipe._offsite(page) is None
    assert recipe.apply_control_present(page)


@pytest.mark.parametrize(
    "url, expected",
    (
        ("https://es.linkedin.com/jobs/view/1", True),
        ("https://www.linkedin.com/signup/cold-join", True),
        ("https://linkedin.com/jobs/view/1", True),
        ("https://jobs.lever.co/x/1/apply", False),
        ("https://linkedin.com.example.invalid/jobs/view/1", False),
        ("https://notlinkedin.com/jobs/view/1", False),
    ),
)
def test_linkedin_host_includes_the_country_pages_and_nothing_else(url: str, expected: bool):
    assert linkedin_apply.linkedin_host(url) is expected


def test_a_country_page_redirect_is_unwrapped_too():
    wrapped = "https://es.linkedin.com/jobs/view/externalApply/1?url=" + quote("https://jobs.lever.co/x/1/apply", safe="")
    assert linkedin_apply.offsite_target(wrapped, JOB) == "https://jobs.lever.co/x/1/apply"


def test_an_unreadable_pause_file_counts_from_its_write_time_not_forever(home: Path):
    session = linkedin_apply.LinkedInSession(jht_home=home, db_path=home / "jobs.db", position_id=71)
    marker = home / ".cache" / "linkedin" / "last-apply.json"
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text("{not json")

    with pytest.raises(apply_flow.FlowDeferred) as fresh:
        session.assert_interval()
    assert fresh.value.reason == "linkedin_throttled"

    long_ago = time.time() - 3600
    os.utime(marker, (long_ago, long_ago))
    session.assert_interval()  # an hour old: the 20-minute pause is over


def test_a_rejected_code_is_not_a_failed_sign_in(page, home: Path, cv_path: Path):
    write_credentials(home)

    result = run(
        build_flow(home, cv_path, code_notifier=telegram_bridge(home)), page, Site(two_factor=True, wrong_code=True)
    )

    assert (result.status, result.reason) == ("blocked_human", "linkedin_login_code_missing")
    assert not (home / ".cache" / "linkedin" / "login-failures.json").exists()
    assert [row[0] for row in login_rows(home)] == ["[used]"]


# ── core facts (profile_facts, D1) ───────────────────────────────────────────

FIRST_NAME_STEP = (
    '<div class="jobs-easy-apply-form-section__grouping"><label for="first">First name</label>'
    '<input id="first" name="firstName" type="text" required></div>'
)


def test_a_first_name_the_profile_does_not_state_is_a_question_never_a_split_name(page, home: Path, cv_path: Path):
    write_session(home)

    result = run(build_flow(home, cv_path, answers={}), page, Site(question_html=FIRST_NAME_STEP))

    assert (result.status, result.reason) == ("blocked_human", "required_answer_missing")
    assert result.pending_question["key"] == "first name"
    assert (result.pending_question["label"], result.pending_question["field_type"]) == ("First name", "text")
    assert page.evaluate("window.submitCount") == 0


def test_a_saved_first_name_fills_the_dialog(page, home: Path, cv_path: Path):
    write_session(home)
    recorded: list = []

    result = run(
        build_flow(home, cv_path, answers={"first name": "Test"}, recorded=recorded),
        page,
        Site(question_html=FIRST_NAME_STEP),
    )

    assert result.status == "applied", result
    assert page.evaluate("window.submitCount") == 1


def test_a_first_name_under_a_profile_alias_comes_from_the_profile(page, home: Path, cv_path: Path):
    write_session(home)
    recorded: list = []

    result = run(
        build_flow(home, cv_path, answers={}, recorded=recorded, extra_profile={"given_name": "Test"}),
        page,
        Site(question_html=FIRST_NAME_STEP),
    )

    assert result.status == "applied", result
    assert recorded[0]["receipt"].answer_sources.get("first name") == "profile"


# ── the flow around the recipe: country pages, pause, dry run, recovery ─────

COUNTRY_JOB = "https://es.linkedin.com/jobs/view/test-role-at-example-4000000001"


@pytest.mark.parametrize(
    "url, job, opened",
    (
        (COUNTRY_JOB, True, JOB),
        ("https://www.linkedin.com/jobs/view/4000000001", True, JOB),
        ("https://linkedin.com/jobs/view/4000000001/?trk=public_jobs", True, JOB),
        ("https://www.linkedin.com/jobs/search/?keywords=x", True, "https://www.linkedin.com/jobs/search/?keywords=x"),
        ("https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4000000001", True, JOB),
        ("https://it.linkedin.com/jobs/search/?currentJobId=4000000001&keywords=x", True, JOB),
        ("https://www.linkedin.com/jobs/search/?currentJobId=1&currentJobId=2", True,
         "https://www.linkedin.com/jobs/search/?currentJobId=1&currentJobId=2"),
        ("https://es.linkedin.com.example.invalid/jobs/view/4000000001", False, None),
        ("https://a.b.linkedin.com/jobs/view/4000000001", False, None),
        ("https://www.linkedin.com:8443/jobs/view/4000000001", False, None),
        ("http://es.linkedin.com/jobs/view/4000000001", False, None),
    ),
)
def test_a_country_page_is_the_same_vacancy_opened_on_www(url: str, job: bool, opened):
    assert apply_flow.is_linkedin_job(url) is job
    assert apply_flow.linkedin_job_url(url) == (opened or url)


def test_a_vacancy_queued_with_its_country_page_applies_and_keeps_the_queue_address(page, home: Path, cv_path: Path):
    write_session(home)
    recorded: list = []
    site = Site()

    result = run(build_flow(home, cv_path, recorded=recorded, url=COUNTRY_JOB), page, site)

    assert result.status == "applied", result
    assert checkpoint(home)["url"] == COUNTRY_JOB
    assert not any("es.linkedin.com" in url for url in site.requests)


def test_a_handoff_to_a_linkedin_country_page_is_refused(home: Path, cv_path: Path):
    flow = build_flow(home, cv_path)
    saved = FlowCheckpoint.new(71, JOB)
    saved.platform = "linkedin"

    with pytest.raises(apply_flow.BlockedHuman) as stop:
        flow._follow_handoff(saved, page=None, handoff=PlatformHandoff("https://es.linkedin.com/signup"), count=1)

    assert stop.value.reason == "application_redirect_untrusted"


def test_the_pause_denies_before_linkedin_is_opened_and_leaves_the_checkpoint_alone(page, home: Path, cv_path: Path):
    write_session(home)
    linkedin_apply._write_private_json(home / ".cache" / "linkedin" / "last-apply.json", {"at": linkedin_apply._utc_now().isoformat()})
    site = Site()

    result = run(build_flow(home, cv_path), page, site)

    assert (result.status, result.reason) == ("denied", "linkedin_throttled")
    assert site.requests == []
    assert not (home / ".cache" / "apply-flow" / "71.json").exists()


def test_recovery_is_never_throttled_and_reads_the_outcome_signed_in(page, home: Path, cv_path: Path):
    write_session(home)
    linkedin_apply._write_private_json(home / ".cache" / "linkedin" / "last-apply.json", {"at": linkedin_apply._utc_now().isoformat()})
    saved = FlowCheckpoint.new(71, JOB)
    saved.platform = "linkedin"
    saved.state = "submit"
    saved.submit_started = True
    saved.save(home / ".cache" / "apply-flow" / "71.json")

    def job(route):
        signed_in = "li_at=synthetic" in (route.request.all_headers().get("cookie") or "")
        sent = '<div role="alert">Your application was sent to Example!</div>' if signed_in else ""
        route.fulfill(status=200, content_type="text/html", body=f"<html><body><h1>Test Role</h1>{sent}</body></html>")

    page.context.route(JOB + "**", job)
    recorded: list = []

    result = build_flow(home, cv_path, recorded=recorded).run(page=page, navigate=True)

    assert result.status == "applied", result
    assert len(recorded) == 1


def test_a_dry_run_never_signs_in_nor_asks_for_a_code(page, home: Path, cv_path: Path):
    write_credentials(home)
    calls: list = []
    site = Site(two_factor=True)
    dry = GateVerdict(context={"mode": "dry_run"})

    result = run(build_flow(home, cv_path, code_notifier=telegram_bridge(home, calls=calls), gate=dry), page, site)

    assert (result.status, result.reason) == ("denied", "linkedin_dry_run_signed_out")
    assert site.logins() == 0 and calls == []


CITY_STEP = (
    '<div class="jobs-easy-apply-form-section__grouping"><label for="city">City</label>'
    '<select id="city" name="city" required><option value="">Select an option</option>'
    '<option value="Madrid, Spain">Madrid, Spain</option><option value="Milan, Italy">Milan, Italy</option></select></div>'
)


def test_a_core_choice_asks_with_the_dialogs_exact_options_never_profile_text(page, home: Path, cv_path: Path):
    write_session(home)

    result = run(
        build_flow(home, cv_path, answers={}, extra_profile={"location": "Milan"}), page, Site(question_html=CITY_STEP)
    )

    assert (result.status, result.reason) == ("blocked_human", "required_answer_missing")
    assert result.pending_question["label"] == "City"
    assert result.pending_question["options"] == ["Madrid, Spain", "Milan, Italy"]
    assert page.evaluate("window.submitCount") == 0


def test_a_saved_exact_city_option_fills_the_choice(page, home: Path, cv_path: Path):
    write_session(home)

    result = run(build_flow(home, cv_path, answers={"city": "Milan, Italy"}), page, Site(question_html=CITY_STEP))

    assert result.status == "applied", result


def test_the_same_flow_run_again_still_finds_the_queue_checkpoint(page, home: Path, cv_path: Path):
    # A second run of one flow object (the headed retry after a bot wall does
    # this) opened on www must still read the checkpoint of the country page.
    write_session(home)
    flow = build_flow(home, cv_path, answers={}, url=COUNTRY_JOB)
    site = Site()

    first = run(flow, page, site)
    second = flow.run(page=page, navigate=True)

    assert first.reason == "required_answer_missing"
    assert second.reason == "required_answer_missing", second
    assert checkpoint(home)["url"] == COUNTRY_JOB


def test_recovery_receipt_keeps_the_digest_of_the_cv_sent_before(page, home: Path, cv_path: Path):
    saved = FlowCheckpoint.new(71, JOB)
    saved.platform = "lever"
    saved.handoff_url = LEVER_APPLY
    saved.state = "submit"
    saved.submit_started = True
    saved.cv_sha256 = "a" * 64
    saved.save(home / ".cache" / "apply-flow" / "71.json")
    confirmation = '<html><body><div class="application-confirmation"><h3>Application submitted!</h3></div></body></html>'
    page.route(LEVER_APPLY, lambda route: route.fulfill(status=200, content_type="text/html", body=confirmation))
    recorded: list = []

    result = build_flow(home, cv_path, recorded=recorded).run(page=page, navigate=True)

    assert result.status == "applied", result
    assert recorded[0]["receipt"].cv_sha256 == "a" * 64


# ── live 14/09: "Candidatura semplice" on screen, linkedin_apply_control_missing ──


@pytest.mark.parametrize(
    "button",
    (
        # The Italian button as it reads on the box, no vendor class (2026 layout).
        '<button data-easy-apply-fixture aria-label="Candidatura semplice a IA Engineer presso Example">'
        "Candidatura semplice</button>",
        '<a href="#" role="button" data-easy-apply-fixture>Candidatura semplice</a>',
        # A language the labels do not know: the structure alone.
        '<a href="https://www.linkedin.com/jobs/view/4000000001/apply/?openSDUIApplyFlow=true" '
        'data-easy-apply-fixture onclick="event.preventDefault()">Łatwe aplikowanie</a>',
        # The same button twice (top card and sticky bar) is one control.
        '<button class="jobs-apply-button">Einfach bewerben</button>'
        '<button class="jobs-apply-button">Einfach bewerben</button>',
    ),
)
def test_easy_apply_is_recognised_by_its_real_labels_and_its_structure(page, home: Path, cv_path: Path, button: str):
    write_session(home)
    recorded: list = []
    site = Site(easy_button=button)

    result = run(build_flow(home, cv_path, recorded=recorded), page, site)

    assert result.status == "applied", result
    assert site.logins() == 0 and len(recorded) == 1


def test_an_apply_button_to_the_company_site_is_never_taken_for_easy_apply(page, cv_path: Path):
    page.set_content(
        '<html><body><nav id="global-nav">Home</nav>'
        '<button class="jobs-apply-button" aria-label="Candidati">Candidati'
        '<svg data-test-icon="link-external-small"></svg></button></body></html>'
    )
    recipe = linkedin_apply.LinkedInEasyApplyRecipe({}, cv_path)

    assert recipe._easy_apply(page) == []


# ── live 14/09 (patch 27): one Easy Apply button and the "similar jobs" cards ──

REAL_TOP_CARD_BUTTON = (
    # Shape read on the box: hashed classes, no vendor id, the label at the start of its own name.
    '<div class="_6ce302b8 c114e5fa"><button type="button" data-easy-apply-fixture '
    'class="_5dfaadcf _11c561b9 _752db2a5" aria-label="Candidatura semplice per questa offerta di lavoro">'
    '<span class="c5ca9708"><svg><path d=""></path></svg></span><span class="b7895f36">Candidatura semplice</span>'
    "</button></div>"
)


def similar_job_cards(count: int) -> str:
    cards = "".join(
        f'<a tabindex="0" class="d9f2bdde _873a8d0a" href="https://www.linkedin.com/jobs/search-results/'
        f'?keywords=Engineer&origin=JobSearchOrigin_JOB_DETAILS_SIMILAR_JOBS_CARD&currentJobId=400000010{n}">'
        f"<div>Synthetic Similar Role {n}</div><div>Example Company {n}</div><div>Madrid</div>"
        "<div>Promosso · 2 giorni fa · Candidatura semplice</div></a>"
        for n in range(count)
    )
    return f'<div id="JobDetailsSimilarJobsSlot_4000000001" class="_8aaf5c5f">{cards}</div>'


def test_the_real_top_card_button_among_similar_job_cards_is_one_easy_apply(page, home: Path, cv_path: Path):
    write_session(home)
    recorded: list = []
    site = Site(easy_button=REAL_TOP_CARD_BUTTON + similar_job_cards(8))

    result = run(build_flow(home, cv_path, recorded=recorded), page, site)

    assert result.status == "applied", result
    assert len(recorded) == 1


def test_similar_job_cards_alone_are_never_easy_apply(page, cv_path: Path):
    chips = (
        # A card whose own link is named exactly like Easy Apply still leads to another vacancy.
        '<a href="https://www.linkedin.com/jobs/search-results/?currentJobId=4000000109">Candidatura semplice</a>'
        '<div id="JobDetailsSimilarJobsSlot_4000000001"><button type="button">Candidatura semplice</button></div>'
    )
    page.set_content(f"<html><body>{similar_job_cards(3)}{chips}</body></html>")
    recipe = linkedin_apply.LinkedInEasyApplyRecipe({}, cv_path)

    assert recipe._easy_apply(page) == []


def test_two_easy_apply_controls_to_really_different_places_are_still_ambiguous(page, cv_path: Path):
    page.set_content(
        '<html><body><a href="https://www.linkedin.com/jobs/view/4000000001/apply/?openSDUIApplyFlow=true">Easy Apply</a>'
        '<a href="https://www.linkedin.com/jobs/view/4000000002/apply/?openSDUIApplyFlow=true">Easy Apply</a></body></html>'
    )
    recipe = linkedin_apply.LinkedInEasyApplyRecipe({}, cv_path)

    assert len(recipe._easy_apply(page)) == 2


def test_a_control_that_only_ends_with_the_label_is_not_easy_apply(page, cv_path: Path):
    body = (
        '<html><body><div role="button">Jobs you may like · Example Company · Candidatura semplice</div>'
        '<a href="https://www.linkedin.com/jobs/view/4000000300/">Candidatura semplice</a></body></html>'
    )
    page.route(JOB, lambda route: route.fulfill(status=200, content_type="text/html", body=body))
    page.goto(JOB)
    recipe = linkedin_apply.LinkedInEasyApplyRecipe({}, cv_path)

    assert recipe._easy_apply(page) == []


def test_a_link_and_the_button_inside_it_are_one_easy_apply(page, cv_path: Path):
    page.set_content(
        '<html><body><a href="https://www.linkedin.com/jobs/view/4000000001/apply/?openSDUIApplyFlow=true">'
        '<button class="jobs-apply-button">Easy Apply</button></a>'
        '<div role="button" aria-label="Easy Apply"><button type="button">Easy Apply</button></div></body></html>'
    )
    recipe = linkedin_apply.LinkedInEasyApplyRecipe({}, cv_path)

    assert len(recipe._easy_apply(page)) == 1


# ── the 2026 Easy Apply dialog, as read on the box (1842): native <dialog>, no role ──

MODERN_MODAL_SCRIPT = r"""
<script>
window.submitCount = 0; window.followedAtSubmit = null;
const steps = [
  `<p>Informaci\u00f3n de contacto</p>
   <div><label for="f-email"><div>Email*</div></label><select id="f-email" required><option value="a">candidate@example.invalid</option></select></div>
   <div componentkey="easyApplyFieldFocus_ea.q::21794308617::PHONE_MOBILE::phoneNumber.validation">
     <label for="f-phone"><div>Tel\u00e9fono m\u00f3vil*</div></label><input id="f-phone" type="tel" required></div>`,
  `<div><label for="f-cv"><div>Curriculum</div></label><input id="f-cv" type="file"><span class="filename"></span></div>`,
  `__QUESTION__`,
  `<p>Rivedi la candidatura</p>
   <div><label for="f-follow">Segui Example per restare aggiornato</label><input type="checkbox" id="f-follow" checked></div>`,
];
function footer(index) {
  if (index === steps.length - 1) return `<footer><button type="button" componentkey="x">` +
    `<span><span>Invia candidatura</span></span></button></footer>`;
  if (index === steps.length - 2) return `<footer><button type="button"><span><span>Rivedi</span></span></button></footer>`;
  return `<footer><button type="button"><span><span>Avanti</span></span></button></footer>`;
}
function back(index) {
  return index === 0 ? `` : `<button type="button"><span><span>Indietro</span></span></button>`;
}
function render(index) {
  const content = document.querySelector('[data-sdui-screen]');
  content.innerHTML = `<p>Pagina ${index + 1}/${steps.length}</p>` + back(index) + steps[index] + footer(index);
  const resume = content.querySelector('#f-cv');
  if (resume) resume.addEventListener('change', e => {
    if (!__REJECT_UPLOAD__) content.querySelector('.filename').textContent = e.target.files[0].name;
  });
  content.querySelectorAll('button').forEach(button => button.addEventListener('click', () => {
    const name = (button.innerText || '').trim();
    if (name.startsWith('Invia')) {
      window.submitCount += 1;
      const box = content.querySelector('#f-follow');
      window.followedAtSubmit = box ? box.checked : null;
      document.querySelector('dialog').innerHTML = '<h2>Candidatura inviata</h2>';
      return;
    }
    render(name.startsWith('Indietro') ? index - 1 : index + 1);
  }));
}
document.querySelectorAll('[data-easy-apply-fixture]').forEach(control => control.addEventListener('click', () => {
  if (document.querySelector('dialog')) return;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('open', '');
  dialog.setAttribute('data-testid', 'dialog');
  dialog.setAttribute('aria-labelledby', 'dialog-header');
  dialog.innerHTML = '<button type="button" aria-label="Chiudi"></button>' +
    '<header id="dialog-header"><h2>Candidati per Example</h2></header>' +
    '<div data-testid="dialog-content"><div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.easyapply.EasyApply"></div></div>';
  document.body.appendChild(dialog);
  render(__START_STEP__);
}));
</script>
"""


def modern_job_page(*, question: bool = True, reject_upload: bool = False, start_step: int = 0) -> str:
    script = (
        MODERN_MODAL_SCRIPT.replace("__QUESTION__", QUESTION if question else "<p>Nessuna domanda</p>")
        .replace("__REJECT_UPLOAD__", "true" if reject_upload else "false")
        .replace("__START_STEP__", str(start_step))
    )
    return (
        '<html><body><header><a href="https://www.linkedin.com/mynetwork/">La mia rete</a>'
        '<a href="https://www.linkedin.com/messaging/">Messaggistica</a></header><h1>Test Role</h1>'
        + REAL_TOP_CARD_BUTTON
        + script
        + "</body></html>"
    )




def test_the_2026_dialog_is_recognised_and_walked_to_its_submit(page, home: Path, cv_path: Path):
    """Live 14/09 (patch 28): the dialog was open and the recipe said it never opened."""
    write_session(home)
    recorded: list = []
    site = Site(modern_modal=True, modern_nav=True)

    result = run(build_flow(home, cv_path, recorded=recorded), page, site)

    assert result.status == "applied", result
    assert page.evaluate("window.submitCount") == 1
    assert page.evaluate("window.followedAtSubmit") is False, "the follow-the-company box is cleared"
    assert len(recorded) == 1
    assert checkpoint(home)["modal_step"] == 4


def test_a_saved_draft_reopened_at_a_later_step_goes_back_to_the_first(page, home: Path, cv_path: Path):
    write_session(home)
    recorded: list = []
    site = Site(modern_modal=True, modern_nav=True, modern_start_step=2)

    result = run(build_flow(home, cv_path, recorded=recorded), page, site)

    assert result.status == "applied", result
    assert recorded[0]["receipt"].cv_sha256, "the CV step was walked, not skipped"


def test_the_phone_field_is_known_by_its_component_key_whatever_the_language(page, home: Path, cv_path: Path):
    """The form reads "Teléfono móvil"; the component key says PHONE_MOBILE."""
    write_session(home)
    site = Site(modern_modal=True, modern_nav=True)

    result = run(build_flow(home, cv_path, answers={"are you comfortable commuting?": "Yes"}), page, site)

    assert result.status == "applied", result
    assert page.evaluate("window.submitCount") == 1


def test_a_dialog_without_a_recognised_next_button_never_sends(page, home: Path, cv_path: Path):
    write_session(home)
    body = (
        '<html><body><header><a href="https://www.linkedin.com/messaging/">M</a></header>'
        + REAL_TOP_CARD_BUTTON
        + "<script>document.querySelectorAll('[data-easy-apply-fixture]').forEach(c => c.addEventListener('click', () => {"
        "const d = document.createElement('dialog'); d.setAttribute('open',''); d.setAttribute('data-testid','dialog');"
        "d.innerHTML = '<div data-testid=\"dialog-content\"><div data-sdui-screen=\"com.linkedin.sdui.flagshipnav.jobs.easyapply.EasyApply\">'"
        " + '<p>Pagina 1/4</p><div><label for=\"x\">Email*</label><select id=\"x\"><option value=\"a\">a</option></select></div>'"
        " + '<footer><button type=\"button\">Qualcosa</button></footer></div>';"
        "document.body.appendChild(d); }));</script></body></html>"
    )
    site = Site()
    site.install(page)
    page.route(JOB, lambda route: route.fulfill(status=200, content_type="text/html", body=body))

    result = build_flow(home, cv_path).run(page=page, navigate=True)

    assert (result.status, result.reason) == ("blocked_human", "linkedin_step_unrecognised")

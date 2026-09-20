"""Oracle Recruiting Cloud: identify the candidate, then apply (1944, 14/09).

The identity step is the one seen live, read-only, on the DNV vacancy:
"Let's get started" · What's your email? · a hidden honey-pot · "I agree with
the terms and conditions" · Next, under the site's own cookie banner. What
comes after it (the one-time PIN, the application form) is synthetic here and
waits for a live run to be confirmed.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "tests"))

import apply_generic  # noqa: E402
import oracle_ce_apply  # noqa: E402
import verification_code  # noqa: E402
from apply_flow import ApplicationFlow, BlockedHuman, FlowDeferred  # noqa: E402
from oracle_ce_apply import OracleCERecipe  # noqa: E402

SITE = "https://ecyq.fa.em2.oraclecloud.com"
APPLY = f"{SITE}/hcmUI/CandidateExperience/en/sites/CX_1/job/7406/apply/email"
EMAIL = "jane@example.invalid"
PIN = "246810"

COOKIES = """<div id="cookie-consent" class="cookie-banner"><p>DNV websites and cookies</p>
<button id="accept">ACCEPT</button><button id="decline" data-hide="cookie-consent">DECLINE</button></div>"""

IDENTITY = """<main id="step"><h1>AI Engineer - Agentic Systems</h1><h2>Let's get started</h2>
<form onsubmit="return false">
<label for="primary-email">What's your email?</label><input id="primary-email" type="email" required>
<input id="honey-pot" name="honey-pot" type="text" style="position:absolute;left:-9999px">
<label for="legal-disclaimer-checkbox">I agree with the terms and conditions</label>
<input id="legal-disclaimer-checkbox" type="checkbox" required>
<button id="next" type="button">Next</button>
</form></main>"""

CODE = """<main id="step"><h2>Confirm it's you</h2><p>We sent a code to your email. Enter the code below.</p>
<form onsubmit="return false"><label for="pin">Verification code</label>
<input id="pin" autocomplete="one-time-code"><button id="next" type="button">Continue</button></form></main>"""

FORM = """<main id="step"><h2>Apply for this job</h2><form onsubmit="return false">
<label for="name">Full name</label><input id="name" required>
<label for="email2">Email</label><input id="email2" type="email" required>
<label for="cv">Resume</label><input id="cv" type="file" required>
<label for="why">Why do you want to join us?</label><textarea id="why" required></textarea>
<button id="send" type="submit">Submit application</button></form></main>"""

SCRIPT = """<script>
window.steps = []; window.submitCount = 0; window.sent = null;
document.querySelectorAll('[data-hide]').forEach(b => b.addEventListener('click', () =>
  document.getElementById(b.getAttribute('data-hide')).remove()));
window.render = (html) => {
  document.getElementById('step').outerHTML = html;
  wire();
};
function wire() {
  const next = document.getElementById('next');
  if (next) next.addEventListener('click', () => {
    const email = document.getElementById('primary-email');
    const pin = document.getElementById('pin');
    if (email) {
      window.steps.push({step: 'identity', email: email.value, honeypot: document.getElementById('honey-pot').value,
                         terms: document.getElementById('legal-disclaimer-checkbox').checked});
      window.render(__AFTER_IDENTITY__);
    } else if (pin) {
      window.steps.push({step: 'code', pin: pin.value});
      if (pin.value === '__PIN__') window.render(__AFTER_CODE__);
    }
  });
  const form = document.querySelector('#step form');
  if (form && document.getElementById('send')) form.addEventListener('submit', e => {
    e.preventDefault(); window.submitCount += 1;
    window.sent = {name: document.getElementById('name').value, why: document.getElementById('why').value};
    document.getElementById('step').outerHTML = '<main id="step"><h2>Thank you for applying</h2></main>';
  });
}
wire();
</script>"""


def site(browser, *, after_identity: str = CODE, after_code: str = FORM, first: str = IDENTITY):
    body = COOKIES + first + SCRIPT.replace("__AFTER_IDENTITY__", json.dumps(after_identity)).replace(
        "__AFTER_CODE__", json.dumps(after_code)
    ).replace("__PIN__", PIN)
    page = browser.new_page()
    page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html; charset=utf-8",
                                                   body=f"<html><body>{body}</body></html>"))
    page.goto(APPLY)
    return page


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool = True
    reason: str = "apply_allowed"
    context: dict = field(default_factory=lambda: {"mode": "authorised"})

    def log_line(self) -> str:
        return "[apply-gate] ALLOW"


@pytest.fixture
def browser():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        launched = runtime.chromium.launch(headless=True)
        yield launched
        launched.close()


@pytest.fixture
def cv_path(tmp_path: Path) -> Path:
    path = tmp_path / "synthetic-profile.pdf"
    path.write_bytes(b"%PDF-1.4\n% synthetic test fixture only\n")
    return path


@pytest.fixture(autouse=True)
def home(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(apply_generic, "guard_public_url", lambda url: url)
    return tmp_path


def build_flow(tmp_path: Path, cv_path: Path, *, mode: str = "authorised", answers: dict | None = None,
               recorded: list | None = None, code: str | None = PIN) -> ApplicationFlow:
    profile = {"name": "Jane Example", "contacts": {"email": EMAIL}, "application_answers": answers or {}}
    flow = ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
        cv_checker=lambda _path: {"ok": True, "reasons": []},
        position_id=94,
        url=APPLY,
        profile=profile,
        cv_path=cv_path,
        checkpoint_path=tmp_path / "94.json",
        receipt_dir=tmp_path / "receipts",
        gate_checker=lambda **_kwargs: GateVerdict(context={"mode": mode}),
        notifier=lambda **_kwargs: "1",
        applied_recorder=lambda **kwargs: (recorded if recorded is not None else []).append(kwargs),
        confirmation_timeout_ms=2000,
    )
    if code is None:
        flow.site_verification_code = lambda *a, **k: (_ for _ in ()).throw(
            verification_code.CodeUnavailable("code_missing", "no code arrived")
        )
    else:
        flow.site_verification_code = lambda *a, **k: code
    return flow


def recipe(flow=None) -> OracleCERecipe:
    built = OracleCERecipe({"name": "Jane Example", "contacts": {"email": EMAIL}}, None)
    if flow is not None:
        built.attach(flow)
    return built


# ── the identity step ────────────────────────────────────────────────────────


def test_the_identity_step_types_the_email_ticks_the_terms_and_leaves_the_trap_empty(browser, tmp_path, cv_path):
    page = site(browser)
    flow = build_flow(tmp_path, cv_path)
    built = recipe(flow)

    built.open_form(page)

    steps = page.evaluate("window.steps")
    assert steps[0] == {"step": "identity", "email": EMAIL, "honeypot": "", "terms": True}
    assert steps[1]["pin"] == PIN
    assert page.evaluate("window.submitCount") == 0  # open_form never sends the application
    assert not page.locator("#cookie-consent").count()  # the banner was declined


def test_a_dry_run_never_asks_the_site_to_email_the_candidate(browser, tmp_path, cv_path):
    page = site(browser)
    flow = build_flow(tmp_path, cv_path, mode="dry_run")
    built = recipe(flow)
    built.dry_run = True

    with pytest.raises(FlowDeferred) as stop:
        built.open_form(page)

    assert stop.value.reason == "oracle_ce_dry_run_identity"
    assert page.evaluate("window.steps") == []


def test_a_filled_trap_stops_before_anything_is_typed(browser, tmp_path, cv_path):
    page = site(browser)
    page.evaluate("() => { document.getElementById('honey-pot').value = 'bot'; }")
    built = recipe(build_flow(tmp_path, cv_path))

    with pytest.raises(BlockedHuman) as stop:
        built.open_form(page)

    assert stop.value.reason == "oracle_ce_honeypot_filled"
    assert page.evaluate("window.steps") == []


def test_without_an_email_in_the_profile_nothing_is_typed(browser, tmp_path, cv_path):
    page = site(browser)
    built = OracleCERecipe({"name": "Jane Example"}, None)
    built.attach(build_flow(tmp_path, cv_path))

    with pytest.raises(BlockedHuman) as stop:
        built.open_form(page)

    assert stop.value.reason == "required_profile_field_missing"
    assert page.evaluate("window.steps") == []


# ── the one-time code ────────────────────────────────────────────────────────


def test_the_code_screen_is_recognised_and_the_code_typed_once(browser, tmp_path, cv_path):
    page = site(browser, first=CODE)
    built = recipe(build_flow(tmp_path, cv_path))
    assert built.security_code_screen(page)

    built.open_form(page)

    assert [step["step"] for step in page.evaluate("window.steps")] == ["code"]


def test_without_a_code_the_run_stops_and_never_guesses(browser, tmp_path, cv_path):
    page = site(browser, first=CODE)
    built = recipe(build_flow(tmp_path, cv_path, code=None))

    with pytest.raises(BlockedHuman) as stop:
        built.open_form(page)

    assert stop.value.reason == "oracle_ce_code_unavailable"
    assert page.evaluate("window.steps") == []


def test_a_wrong_code_does_not_open_a_form_and_stops(browser, tmp_path, cv_path):
    page = site(browser, first=CODE)
    built = recipe(build_flow(tmp_path, cv_path, code="000000"))

    with pytest.raises(BlockedHuman) as stop:
        built.open_form(page)

    assert stop.value.reason == "oracle_ce_step_unrecognised"


@pytest.mark.parametrize(
    ("text", "code"),
    [
        ("Your one-time PIN: 246810", PIN),
        ("Su código de verificación es 246810", PIN),
        ("Call 246810 for support", None),  # no code word before it
        ("Your code is 12345", None),  # five digits is not Oracle's PIN
        ("Your code is 1234567", None),  # seven either
        ("Your code is ABCD1234", None),  # that shape is Greenhouse's
    ],
)
def test_the_pin_shape_is_exactly_six_digits(text, code):
    assert verification_code.code_in_text(text, "digits6") == code


# ── the application form, and steps the recipe does not know ─────────────────


def test_a_step_the_recipe_does_not_know_stops_with_its_name(browser, tmp_path, cv_path):
    unknown = '<main id="step"><h2>Something else entirely</h2><p>No form here.</p></main>'
    page = site(browser, first=unknown)
    built = recipe(build_flow(tmp_path, cv_path))

    with pytest.raises(BlockedHuman) as stop:
        built.open_form(page)

    assert stop.value.reason == "oracle_ce_step_unrecognised"
    # The step is named at once, not after six rounds of waiting.
    assert "does not know" in stop.value.detail and "Something else entirely" in stop.value.detail


def test_the_whole_application_from_the_apply_url_to_the_receipt(browser, tmp_path, cv_path):
    page = site(browser)
    recorded: list = []
    flow = build_flow(
        tmp_path, cv_path, answers={"Why do you want to join us?": "Synthetic answer for a fictional test."},
        recorded=recorded,
    )

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied", result
    assert page.evaluate("window.submitCount") == 1
    assert page.evaluate("window.sent")["name"] == "Jane Example"
    saved = json.loads((tmp_path / "94.json").read_text())
    assert saved["platform"] == "oracle_ce"
    assert recorded[0]["receipt"].attachments  # the CV went out with it

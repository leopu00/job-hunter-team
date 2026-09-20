"""iCIMS: the email step with its GDPR consent, the account, then the application (1843).

The email step is the one seen live, read-only, on the AXA vacancy: one form
with the email, a data-protection consent with two options, the privacy box,
"Siguiente", and an hCaptcha the page creates as invisible and executes on
submit. The company names and the consent wording are rewritten here; what is
kept is the shape of the page. Everything after the email step is synthetic
and waits for a live run to be confirmed.
"""

from __future__ import annotations

import json
import stat
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "tests"))

import apply_generic  # noqa: E402
import ats_account  # noqa: E402
import icims_apply  # noqa: E402
from apply_flow import ApplicationFlow, BlockedHuman, FlowDeferred  # noqa: E402
from icims_apply import ICIMSRecipe  # noqa: E402

SITE = "https://careers-es-example.icims.com"
LOGIN = f"{SITE}/jobs/24335/login?in_iframe=1"
EMAIL = "jane@example.invalid"

CONSENT_FUTURE = (
    "Autorizo a que la empresa procese mis datos personales en el contexto de mi aplicación a esta "
    "posición y que me informe sobre futuras oportunidades que coincidan con mi perfil."
)
CONSENT_ONLY = (
    "Solo autorizo a que la empresa procese mis datos personales en el contexto de mi aplicación a "
    "esta posición. Mis datos se eliminarán posteriormente."
)

COOKIES = """<div id="cookie-consent" class="cookie-banner"><p>This site uses cookies</p>
<button id="accept">Aceptarlas todas</button>
<button id="reject" data-hide="cookie-consent">Rechazarlas todas</button></div>"""

EMAIL_STEP = """<main id="step"><h1>Ingeniero/a de soluciones</h1>
<form id="enterEmailForm" onsubmit="return false">
<label for="email">Correo electrónico</label><input type="email" id="email" name="css_loginName" required>
<input type="hidden" id="consentCaptureTitle" value="Reglamento General de Protección de Datos (RGPD)">
<select id="gdpr_consent_type" name="gdpr_consent_type" aria-required="true">
<option value="">Elegir</option>
<option value="37002057001">__FUTURE__</option>
<option value="37002057002">__ONLY__</option>
</select>
<label for="accept_gdpr">Acepto el aviso de privacidad</label>
<input type="checkbox" id="accept_gdpr" name="accept_gdpr" value="1" aria-required="true">
<input id="enterEmailSubmitButton" type="submit" class="iCIMS_PrimaryButton" value="Siguiente">
</form></main>""".replace("__FUTURE__", CONSENT_FUTURE).replace("__ONLY__", CONSENT_ONLY)

ACCOUNT_STEP = """<main id="step"><h2>Create your account</h2>
<form id="accountForm" onsubmit="return false">
<label for="pw">Password</label><input type="password" id="pw" required>
<label for="pw2">Confirm password</label><input type="password" id="pw2" required>
<input id="enterEmailSubmitButton" type="submit" value="Siguiente">
</form></main>"""

SIGN_IN_STEP = """<main id="step"><h2>Welcome back</h2>
<form id="accountForm" onsubmit="return false">
<label for="pw">Password</label><input type="password" id="pw" required>
<input id="enterEmailSubmitButton" type="submit" value="Siguiente">
</form></main>"""

APPLICATION = """<main id="step"><h2>Apply for this job</h2><form onsubmit="return false">
<label for="name">Full name</label><input id="name" required>
<label for="email2">Email</label><input id="email2" type="email" required>
<label for="cv">Resume</label><input id="cv" type="file" required>
<label for="why">Why do you want to join us?</label><textarea id="why" required></textarea>
<button id="send" type="submit">Submit application</button></form></main>"""

SCRIPT = """<script>
window.steps = []; window.submitCount = 0; window.sent = null;
document.querySelectorAll('[data-hide]').forEach(b => b.addEventListener('click', () =>
  document.getElementById(b.getAttribute('data-hide')).remove()));
window.render = (html) => { document.getElementById('step').outerHTML = html; wire(); };
function wire() {
  const next = document.getElementById('enterEmailSubmitButton');
  if (next) next.addEventListener('click', () => {
    const email = document.getElementById('email');
    const pw = document.getElementById('pw');
    if (email) {
      window.steps.push({step: 'email', email: email.value,
                         consent: document.getElementById('gdpr_consent_type').value,
                         privacy: document.getElementById('accept_gdpr').checked,
                         honeypot: (document.getElementById('honey-pot') || {value: ''}).value});
      window.render(__AFTER_EMAIL__);
    } else if (pw) {
      const second = document.getElementById('pw2');
      window.steps.push({step: 'account', password: pw.value, confirm: second ? second.value : null});
      window.render(__AFTER_ACCOUNT__);
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


def site(browser, *, first: str = EMAIL_STEP, after_email: str = ACCOUNT_STEP, after_account: str = APPLICATION,
         extra: str = ""):
    body = COOKIES + first + extra + SCRIPT.replace("__AFTER_EMAIL__", json.dumps(after_email)).replace(
        "__AFTER_ACCOUNT__", json.dumps(after_account)
    )
    page = browser.new_page()
    page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html; charset=utf-8",
                                                   body=f"<html><body>{body}</body></html>"))
    page.goto(LOGIN)
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
               recorded: list | None = None) -> ApplicationFlow:
    profile = {"name": "Jane Example", "contacts": {"email": EMAIL}, "application_answers": answers or {}}
    return ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
        cv_checker=lambda _path: {"ok": True, "reasons": []},
        position_id=95,
        url=LOGIN,
        profile=profile,
        cv_path=cv_path,
        checkpoint_path=tmp_path / "95.json",
        receipt_dir=tmp_path / "receipts",
        gate_checker=lambda **_kwargs: GateVerdict(context={"mode": mode}),
        notifier=lambda **_kwargs: "1",
        applied_recorder=lambda **kwargs: (recorded if recorded is not None else []).append(kwargs),
        confirmation_timeout_ms=2000,
    )


def recipe(flow=None) -> ICIMSRecipe:
    built = ICIMSRecipe({"name": "Jane Example", "contacts": {"email": EMAIL}}, None)
    if flow is not None:
        built.attach(flow)
    return built


# ── the consent, the heart of this step ──────────────────────────────────────


def test_the_consent_kept_is_the_one_limited_to_this_position():
    value, text = ICIMSRecipe.position_only_consent(
        [("", "Elegir"), ("1", CONSENT_FUTURE), ("2", CONSENT_ONLY)]
    )
    assert (value, text) == ("2", CONSENT_ONLY)


@pytest.mark.parametrize(
    "options",
    [
        [("", "Choose"), ("1", CONSENT_FUTURE)],  # only the one that covers more
        [("", "Choose"), ("1", "I consent to the processing of my data for this position."),
         ("2", "Doy mi consentimiento para esta posición.")],  # two, nothing tells them apart
        [("", "Choose")],  # none at all
    ],
    ids=["only-future", "two-alike", "none"],
)
def test_a_consent_that_cannot_be_told_apart_is_never_guessed(options):
    with pytest.raises(BlockedHuman) as stop:
        ICIMSRecipe.position_only_consent(options)
    assert stop.value.reason == "icims_gdpr_option_unknown"


@pytest.mark.parametrize(
    ("future", "only"),
    [
        ("I agree to be contacted about future opportunities matching my profile.",
         "I agree only to the processing of my data for this position."),
        ("Acconsento al trattamento anche per future opportunità e per la comunità di talenti.",
         "Acconsento al trattamento dei miei dati soltanto per questa posizione."),
        ("Ich stimme zu, auch über zukünftige Stellen informiert zu werden.",
         "Ich stimme der Verarbeitung nur für diese Stelle zu."),
        ("Autorizo o tratamento dos meus dados para futuras oportunidades e banco de talentos.",
         "Autorizo o tratamento dos meus dados apenas para esta vaga."),
    ],
    ids=["en", "it", "de", "pt"],
)
def test_the_consent_is_chosen_in_other_languages_too(future, only):
    value, _text = ICIMSRecipe.position_only_consent([("", ""), ("1", future), ("2", only)])
    assert value == "2"


# ── the email step ───────────────────────────────────────────────────────────


def test_the_email_step_types_the_email_picks_the_limited_consent_and_ticks_the_privacy_box(
    browser, tmp_path, cv_path
):
    page = site(browser)
    built = recipe(build_flow(tmp_path, cv_path))

    built.open_form(page)

    first = page.evaluate("window.steps")[0]
    assert first["email"] == EMAIL
    assert first["consent"] == "37002057002"  # the one limited to this position
    assert first["privacy"] is True
    assert built.consent["terms_text"].startswith("Solo autorizo")
    assert "Acepto el aviso de privacidad" in built.consent["terms_text"]
    assert not page.locator("#cookie-consent").count()  # the banner was refused, never accepted
    assert page.evaluate("window.submitCount") == 0  # open_form never sends the application


def test_a_dry_run_never_starts_an_account_on_the_portal(browser, tmp_path, cv_path):
    page = site(browser)
    flow = build_flow(tmp_path, cv_path, mode="dry_run")
    built = recipe(flow)
    built.dry_run = True

    with pytest.raises(FlowDeferred) as stop:
        built.open_form(page)

    assert stop.value.reason == "icims_dry_run_identity"
    assert page.evaluate("window.steps") == []


def test_without_an_email_in_the_profile_nothing_is_typed(browser, tmp_path, cv_path):
    page = site(browser)
    built = ICIMSRecipe({"name": "Jane Example"}, None)
    built.attach(build_flow(tmp_path, cv_path))

    with pytest.raises(BlockedHuman) as stop:
        built.open_form(page)

    assert stop.value.reason == "required_profile_field_missing"
    assert page.evaluate("window.steps") == []


def test_a_filled_trap_stops_before_anything_is_typed(browser, tmp_path, cv_path):
    trap = '<input id="honey-pot" name="honey-pot" style="position:absolute;left:-9999px">'
    page = site(browser, first=EMAIL_STEP.replace("</form>", trap + "</form>"))
    page.evaluate("() => { document.getElementById('honey-pot').value = 'bot'; }")
    built = recipe(build_flow(tmp_path, cv_path))

    with pytest.raises(BlockedHuman) as stop:
        built.open_form(page)

    assert stop.value.reason == "icims_honeypot_filled"
    assert page.evaluate("window.steps") == []
    # Nothing was typed either: the trap is checked before the email, not at the click.
    assert page.evaluate("() => document.getElementById('email').value") == ""


def test_a_visible_captcha_stops_the_run_with_no_attempt(browser, tmp_path, cv_path):
    challenge = '<iframe title="hCaptcha challenge" src="https://newassets.hcaptcha.com/captcha/v1/x/frame"></iframe>'
    page = site(browser, extra=challenge)
    built = recipe(build_flow(tmp_path, cv_path))

    with pytest.raises(BlockedHuman) as stop:
        built.open_form(page)

    assert stop.value.reason == "captcha"
    assert page.evaluate("window.steps") == []
    assert page.evaluate("() => document.getElementById('email').value") == ""  # no attempt at all


def test_the_invisible_captcha_of_the_portal_is_not_a_stop(browser, tmp_path, cv_path):
    # iCIMS builds an hCaptcha with data-size=invisible on the email form: it is
    # not a challenge until it shows one.
    invisible = '<div id="h-captcha" class="h-captcha" data-sitekey="synthetic" data-size="invisible"></div>'
    page = site(browser, first=EMAIL_STEP.replace("</form>", invisible + "</form>"))
    built = recipe(build_flow(tmp_path, cv_path))

    built.open_form(page)

    assert page.evaluate("window.steps")[0]["step"] == "email"


# ── the account step ─────────────────────────────────────────────────────────


def test_a_new_account_saves_its_password_before_typing_it_and_never_shows_it(browser, tmp_path, cv_path):
    page = site(browser)
    built = recipe(build_flow(tmp_path, cv_path))

    built.open_form(page)

    tenant = ats_account.tenant_id("icims", LOGIN)
    saved = ats_account.load(tmp_path, tenant)
    assert saved is not None and saved.state == ats_account.ACTIVE  # the portal took it
    path = tmp_path / "credentials" / "ats-accounts" / f"{tenant}.json"
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    account = [step for step in page.evaluate("window.steps") if step["step"] == "account"][0]
    assert account["password"] == saved.password and account["confirm"] == saved.password
    assert saved.password not in page.content()  # never written into the page text


def test_the_password_typed_by_the_recipe_is_hidden_from_a_stop_screenshot(browser, tmp_path, cv_path, monkeypatch):
    """A stop between typing the password and confirming it photographs the
    live page: the recipe's own fields must be ones `secrets_hidden` hides."""
    page = site(browser, first=ACCOUNT_STEP)
    built = recipe(build_flow(tmp_path, cv_path))
    built.identity_email = EMAIL
    monkeypatch.setattr(built, "_forward", lambda *_args, **_kwargs: None)  # stop right after typing

    built._account_step(page)

    typed = page.evaluate("() => [document.getElementById('pw').value, document.getElementById('pw2').value]")
    # The portal's own "show password" turns the boxes into plain text: what
    # hides them then is the mark the recipe put on them, not their type.
    page.evaluate("() => ['pw','pw2'].forEach(id => { document.getElementById(id).type = 'text'; })")
    with ats_account.secrets_hidden(page):
        shown = page.evaluate(
            "() => ['pw','pw2'].map(id => getComputedStyle(document.getElementById(id)).visibility)"
        )
    assert typed[0] and typed[0] == typed[1]
    assert shown == ["hidden", "hidden"]


def test_a_sign_in_without_a_saved_password_stops_and_never_resets_one(browser, tmp_path, cv_path):
    page = site(browser, after_email=SIGN_IN_STEP)
    built = recipe(build_flow(tmp_path, cv_path))

    with pytest.raises(BlockedHuman) as stop:
        built.open_form(page)

    assert stop.value.reason == "account_email_in_use"
    assert "never resets" in stop.value.detail
    assert [step["step"] for step in page.evaluate("window.steps")] == ["email"]


def test_a_saved_account_is_reused_instead_of_a_new_one(browser, tmp_path, cv_path):
    tenant = ats_account.tenant_id("icims", LOGIN)
    existing = ats_account.create_pending(tmp_path, tenant, EMAIL)
    page = site(browser, after_email=SIGN_IN_STEP)
    built = recipe(build_flow(tmp_path, cv_path))

    built.open_form(page)

    account = [step for step in page.evaluate("window.steps") if step["step"] == "account"][0]
    assert account["password"] == existing.password  # the one the portal already knows
    assert ats_account.load(tmp_path, tenant).password == existing.password


def test_an_unsafe_credentials_file_stops_the_run(browser, tmp_path, cv_path):
    tenant = ats_account.tenant_id("icims", LOGIN)
    ats_account.create_pending(tmp_path, tenant, EMAIL)
    (tmp_path / "credentials" / "ats-accounts" / f"{tenant}.json").chmod(0o644)
    page = site(browser, after_email=SIGN_IN_STEP)
    built = recipe(build_flow(tmp_path, cv_path))

    with pytest.raises(BlockedHuman) as stop:
        built.open_form(page)

    assert stop.value.reason == "account_credentials_unsafe"


# ── steps the recipe does not know, and the whole run ────────────────────────


def test_a_step_the_recipe_does_not_know_stops_with_its_name(browser, tmp_path, cv_path):
    unknown = '<main id="step"><h2>Something else entirely</h2><p>No form here.</p></main>'
    page = site(browser, first=unknown)
    built = recipe(build_flow(tmp_path, cv_path))

    with pytest.raises(BlockedHuman) as stop:
        built.open_form(page)

    assert stop.value.reason == "icims_step_unrecognised"
    assert "does not know" in stop.value.detail and "Something else entirely" in stop.value.detail


def test_the_portal_inside_the_company_iframe_is_opened_directly(browser, tmp_path, cv_path):
    page = browser.new_page()
    company = "https://careers.example.com/jobs/24335"
    pages = {
        company: f'<html><body><iframe id="icims_content_iframe" src="{LOGIN}"></iframe></body></html>',
        LOGIN.split("?")[0]: f"<html><body>{EMAIL_STEP}</body></html>",
    }
    page.route("**/*", lambda route: route.fulfill(
        status=200, content_type="text/html; charset=utf-8",
        body=pages.get(route.request.url.split("?")[0], "<html><body></body></html>")))
    page.goto(company)
    built = recipe(build_flow(tmp_path, cv_path))

    assert built._enter_content(page) is True
    assert page.url.startswith(LOGIN.split("?")[0])
    assert built.email_screen(page)


def test_the_whole_application_from_the_portal_to_the_receipt(browser, tmp_path, cv_path):
    page = site(browser)
    recorded: list = []
    flow = build_flow(
        tmp_path, cv_path, answers={"Why do you want to join us?": "Synthetic answer for a fictional test."},
        recorded=recorded,
    )

    result = flow.run(page=page, navigate=False)

    assert result.status == "applied", result
    assert page.evaluate("window.submitCount") == 1
    saved = json.loads((tmp_path / "95.json").read_text())
    assert saved["platform"] == "icims"
    # The password never reaches what is written down.
    credentials = ats_account.load(tmp_path, ats_account.tenant_id("icims", LOGIN))
    assert credentials.password not in (tmp_path / "95.json").read_text()
    assert recorded[0]["receipt"].attachments  # the CV went out with it

"""Generic CLOSER recipe on company career sites (shared/skills/apply_generic.py).

Origin. On the 14/09 queue five of the fourteen best positions were on the
company's own site and the CLOSER stopped on each with ats_unsupported. The
generic recipe reads a page it has never seen: which form is the application,
what each field asks, and what must never be touched.

Synthetic pages, all served by page.route (no request leaves the browser),
with different structures:

  1. classic: label[for], CV upload, fieldset radio, consent checkbox, select,
     plus a NEWSLETTER form in the footer (the trap: never filled);
  2. reveal: an Apply button shows the form; wrapped labels, placeholder-only
     email, German labels, a required textarea; a CONTACT form next to it;
  3. link: "Jetzt bewerben" leads to /apply on the same site, labels by
     aria-labelledby, confirmation by URL + text on a new page;
  4. Italian form with a required cover-letter file and an unanswered question;
  5. stops: form embedded from another host, login, account creation, captcha,
     two application forms, only newsletter + contact, Apply to another site.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import apply_flow  # noqa: E402
import apply_generic  # noqa: E402
from apply_flow import BlockedHuman  # noqa: E402
from apply_generic import GenericRecipe, classify_form, core_field, same_site  # noqa: E402

BASE = "https://careers.example.com"

PROFILE = {
    "name": "Jane Example",
    "first_name": "Jane",
    "last_name": "Example",
    "contacts": {
        "email": "jane@example.invalid",
        "phone": "+1 555 0100",
        "linkedin": "https://linkedin.example/in/jane-example",
    },
    "application_answers": {
        "Do you need visa sponsorship?": "No",
        "I agree to the processing of my personal data": True,
        "Warum möchtest du bei uns arbeiten?": "Synthetic answer written for a fictional test only.",
        "Wie viele Jahre Erfahrung hast du?": "5",
    },
}

CONFIRM_SCRIPT = """
<script>
  window.submitCount = 0;
  document.querySelectorAll('form.application').forEach(f => f.addEventListener('submit', e => {
    e.preventDefault();
    window.submitCount += 1;
    CONFIRM
  }));
  document.querySelectorAll('form:not(.application)').forEach(f => f.addEventListener('submit', e => {
    e.preventDefault(); window.trapSubmitted = true;
  }));
</script>
"""

NEWSLETTER = """
<footer>
  <form class="newsletter">
    <h4>Newsletter</h4>
    <label for="nl-email">Your email</label><input id="nl-email" type="email" required>
    <button type="submit">Subscribe</button>
  </form>
</footer>
"""

CLASSIC = f"""
<html><head><title>Backend Engineer — Example Co</title></head><body>
<main>
  <h1>Backend Engineer</h1><p>Fictional vacancy used only by tests.</p>
  <h2>Apply for this position</h2>
  <form class="application">
    <label for="fn">First name *</label><input id="fn" name="first_name" required>
    <label for="ln">Last name *</label><input id="ln" name="last_name" required>
    <label for="em">Email address *</label><input id="em" type="email" name="email" required>
    <label for="ph">Phone</label><input id="ph" type="tel" name="phone">
    <label for="cv">Upload your CV *</label><input id="cv" type="file" name="cv" accept=".pdf" required>
    <label for="src">How did you hear about us?</label>
    <select id="src" name="source"><option value="">Choose</option><option value="web">Website</option></select>
    <fieldset><legend>Do you need visa sponsorship? *</legend>
      <input type="radio" id="sp-y" name="sponsorship" value="yes" required><label for="sp-y">Yes</label>
      <input type="radio" id="sp-n" name="sponsorship" value="no"><label for="sp-n">No</label>
    </fieldset>
    <input type="checkbox" id="gdpr" name="gdpr" required>
    <label for="gdpr">I agree to the processing of my personal data</label>
    <button type="submit">Submit application</button>
  </form>
</main>
{NEWSLETTER}
{CONFIRM_SCRIPT.replace("CONFIRM", "document.body.innerHTML = '<main><h1>Thank you for your application!</h1></main>';")}
</body></html>
"""

REVEAL = f"""
<html lang="de"><body>
<h1>Data Engineer (m/w/d)</h1>
<button id="open" onclick="document.getElementById('apply').hidden = false">Jetzt bewerben</button>
<section id="apply" hidden>
  <h2>Deine Bewerbung</h2>
  <form class="application">
    <label>Vorname * <input name="vorname" required></label>
    <label>Nachname * <input name="nachname" required></label>
    <input type="email" name="mail" placeholder="E-Mail *" required>
    <label>Lebenslauf (PDF) * <input type="file" name="resume" accept="application/pdf" required></label>
    <label>Warum möchtest du bei uns arbeiten? * <textarea name="motiv" required></textarea></label>
    <button>Bewerbung absenden</button>
  </form>
</section>
<aside>
  <h3>Kontakt</h3>
  <form class="contact">
    <label>Name <input name="cname"></label>
    <label>E-Mail <input type="email" name="cmail"></label>
    <label>Nachricht <textarea name="msg"></textarea></label>
    <button type="submit">Nachricht senden</button>
  </form>
</aside>
{CONFIRM_SCRIPT.replace("CONFIRM", "document.body.innerHTML = '<p>Vielen Dank für Ihre Bewerbung.</p>';")}
</body></html>
"""

LINK_JOB = """
<html><body>
<h1>ML Engineer</h1><p>Fictional vacancy.</p>
<a href="/jobs/42/apply">Jetzt bewerben</a>
<a href="/jobs/42/apply#top">Jetzt bewerben</a>
</body></html>
"""

LINK_APPLY = f"""
<html><body>
<h2 id="t">Bewerbung</h2>
<form class="application" aria-labelledby="t">
  <span id="l1">Vollständiger Name</span><input aria-labelledby="l1" name="n" required>
  <span id="l2">E-Mail</span><input aria-labelledby="l2" type="email" name="e" required>
  <span id="l3">Lebenslauf</span><input aria-labelledby="l3" type="file" name="doc" required>
  <label for="yrs">Wie viele Jahre Erfahrung hast du?</label><input id="yrs" name="yrs" type="number" required>
  <input type="submit" value="Senden">
</form>
{CONFIRM_SCRIPT.replace("CONFIRM", "location.href = '/jobs/42/submitted';")}
</body></html>
"""

ITALIAN = """
<html lang="it"><body>
<h1>Sviluppatore</h1>
<form class="application">
  <label for="nome">Nome *</label><input id="nome" required>
  <label for="cognome">Cognome *</label><input id="cognome" required>
  <label for="mail">Email *</label><input id="mail" type="email" required>
  <label for="cv">Curriculum vitae *</label><input id="cv" type="file" required>
  <label for="lettera">Lettera di presentazione *</label><input id="lettera" type="file" required>
  <label for="ral">Qual è la tua RAL attuale? *</label><input id="ral" required>
  <button type="submit">Invia candidatura</button>
</form>
</body></html>
"""


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


def _site_page(browser, pages: dict[str, str]):
    page = browser.new_page()

    def serve(route):
        path = route.request.url.split(BASE, 1)[-1].split("#")[0] or "/"
        body = pages.get(path)
        if body is None:
            route.fulfill(status=404, body="not found")
        else:
            route.fulfill(status=200, content_type="text/html; charset=utf-8", body=body)

    page.route("**/*", serve)
    return page


def _recipe(cv_path: Path, profile=PROFILE) -> GenericRecipe:
    recipe = GenericRecipe(profile, cv_path)
    recipe.url_guard = lambda url: url  # synthetic hosts never resolve
    return recipe


def _run_until_review(recipe: GenericRecipe, page) -> None:
    recipe.open_form(page)
    assert recipe.dom_match(page)
    recipe.fill_core(page)
    recipe.upload_cv(page)
    recipe.fill_screening(page)
    recipe.review(page)


def _blocked(call) -> BlockedHuman:
    with pytest.raises(BlockedHuman) as caught:
        call()
    return caught.value


# ── 1. classic page with a newsletter trap ─────────────────────────────────


def test_classic_form_is_filled_submitted_once_and_confirmed(browser, cv_path, tmp_path):
    page = _site_page(browser, {"/jobs/7": CLASSIC})
    page.goto(f"{BASE}/jobs/7")
    recipe = _recipe(cv_path)
    recipe.pre_submit_screenshot_path = tmp_path / "evidence" / "7-pre-submit.png"
    _run_until_review(recipe, page)
    assert page.locator("#fn").input_value() == "Jane"
    assert page.locator("#ln").input_value() == "Example"
    assert page.locator("#em").input_value() == "jane@example.invalid"
    assert page.locator("#ph").input_value() == "+1 555 0100"
    assert page.locator("#sp-n").is_checked() and not page.locator("#sp-y").is_checked()
    assert page.locator("#gdpr").is_checked()
    assert page.locator("#cv").evaluate("el => el.files.length") == 1
    # the trap: the newsletter box next to the application is never touched
    assert page.locator("#nl-email").input_value() == ""
    assert (tmp_path / "evidence" / "7-pre-submit.png").read_bytes()[:4] == b"\x89PNG"
    assert recipe.pre_submit_screenshot.endswith("7-pre-submit.png")
    assert GenericRecipe.confirmation_text(page) == ""
    recipe.submit(page)
    assert page.evaluate("window.submitCount") == 1
    assert not page.evaluate("window.trapSubmitted || false")
    assert "thank you for your application" in GenericRecipe.confirmation_text(page).casefold()
    assert recipe.answer_sources["do you need visa sponsorship"] == "profile"


def test_unanswered_required_radio_becomes_a_pending_question(browser, cv_path):
    page = _site_page(browser, {"/jobs/7": CLASSIC})
    page.goto(f"{BASE}/jobs/7")
    profile = {**PROFILE, "application_answers": {"I agree to the processing of my personal data": True}}
    recipe = _recipe(cv_path, profile)
    recipe.open_form(page)
    recipe.fill_core(page)
    recipe.upload_cv(page)
    stop = _blocked(lambda: recipe.fill_screening(page))
    assert stop.reason == "required_answer_missing"
    assert stop.answer_request == {
        "key": "do you need visa sponsorship",
        "label": "Do you need visa sponsorship?",
        "field_type": "radio",
        "options": ["Yes", "No"],
    }


def test_a_core_fact_the_profile_lacks_becomes_a_question_then_fills(browser, cv_path):
    # 1967 (14/09): the profile had only `name`; a hard stop on First Name.
    only_name = {"name": "Jane Example", "contacts": PROFILE["contacts"],
                 "application_answers": PROFILE["application_answers"]}
    page = _site_page(browser, {"/jobs/7": CLASSIC})
    page.goto(f"{BASE}/jobs/7")
    recipe = _recipe(cv_path, only_name)
    recipe.open_form(page)
    stop = _blocked(lambda: recipe.fill_core(page))
    assert stop.reason == "required_answer_missing"
    assert stop.answer_request == {"key": "first name", "label": "First name", "field_type": "text", "options": []}
    assert page.locator("#fn").input_value() == ""
    # The CLOSER works it out from `name` (CL-08) and saves it; the rerun fills.
    saved = {**only_name, "application_answers": {**only_name["application_answers"], "first name": "Jane"}}
    page.goto(f"{BASE}/jobs/7")
    recipe = _recipe(cv_path, saved)
    recipe.open_form(page)
    stop = _blocked(lambda: recipe.fill_core(page))
    assert stop.answer_request["key"] == "last name"
    assert page.locator("#fn").input_value() == "Jane"
    saved["application_answers"]["last name"] = "Example"
    page.goto(f"{BASE}/jobs/7")
    recipe = _recipe(cv_path, saved)
    recipe.open_form(page)
    recipe.fill_core(page)
    assert (page.locator("#fn").input_value(), page.locator("#ln").input_value()) == ("Jane", "Example")
    assert recipe.answer_sources["first name"] == "profile"


def test_profile_aliases_win_over_a_question(browser, cv_path):
    aliased = {"given_name": "Jana", "family_name": "Beispiel", "contacts": PROFILE["contacts"]}
    page = _site_page(browser, {"/jobs/7": CLASSIC})
    page.goto(f"{BASE}/jobs/7")
    recipe = _recipe(cv_path, aliased)
    recipe.open_form(page)
    recipe.fill_core(page)
    assert (page.locator("#fn").input_value(), page.locator("#ln").input_value()) == ("Jana", "Beispiel")


def _to_screening(browser, cv_path, answers, origins=None):
    page = _site_page(browser, {"/jobs/7": CLASSIC})
    page.goto(f"{BASE}/jobs/7")
    recipe = _recipe(cv_path, {**PROFILE, "application_answers": answers})
    recipe.answer_origins = origins or {}
    recipe.open_form(page)
    recipe.fill_core(page)
    recipe.upload_cv(page)
    return recipe, page


def test_a_saved_answer_that_is_not_an_option_stops_the_profile_answer(browser, cv_path):
    answers = {"Do you need visa sponsorship?": "Maybe", "I agree to the processing of my personal data": True}
    recipe, page = _to_screening(browser, cv_path, answers)
    assert _blocked(lambda: recipe.fill_screening(page)).reason == "answer_option_unknown"
    assert not page.locator("#sp-y").is_checked() and not page.locator("#sp-n").is_checked()


def test_a_refused_worked_out_answer_is_the_question_again(browser, cv_path):
    answers = {"Do you need visa sponsorship?": "Maybe", "I agree to the processing of my personal data": True}
    recipe, page = _to_screening(browser, cv_path, answers, {"do you need visa sponsorship": "agent_inferred"})
    stop = _blocked(lambda: recipe.fill_screening(page))
    assert stop.reason == "required_answer_missing"
    assert stop.answer_request["options"] == ["Yes", "No"]
    assert getattr(stop, "refused_digest", "")


# ── 2. Apply button reveals the form; contact form next to it ───────────────


def test_reveal_form_with_german_wrapped_labels_and_a_contact_trap(browser, cv_path):
    page = _site_page(browser, {"/stellen/9": REVEAL})
    page.goto(f"{BASE}/stellen/9")
    recipe = _recipe(cv_path, {**PROFILE, "first_name": "Jana", "last_name": "Beispiel"})
    assert not recipe.form_present(page)
    assert recipe.apply_control_present(page)
    _run_until_review(recipe, page)
    assert page.locator("input[name=vorname]").input_value() == "Jana"
    assert page.locator("input[name=nachname]").input_value() == "Beispiel"
    assert page.locator("input[name=mail]").input_value() == "jane@example.invalid"
    assert page.locator("textarea[name=motiv]").input_value().startswith("Synthetic answer")
    for trap in ("cname", "cmail"):
        assert page.locator(f"input[name={trap}]").input_value() == ""
    assert page.locator("textarea[name=msg]").input_value() == ""
    recipe.submit(page)
    assert page.evaluate("window.submitCount") == 1
    assert "vielen dank für ihre bewerbung" in GenericRecipe.confirmation_text(page).casefold()


# ── 3. Apply link to another page of the same site ─────────────────────────


def test_apply_link_on_the_same_site_opens_the_form_page(browser, cv_path):
    page = _site_page(browser, {
        "/jobs/42": LINK_JOB,
        "/jobs/42/apply": LINK_APPLY,
        "/jobs/42/submitted": "<html><body><h1>Vielen Dank für Ihre Bewerbung</h1></body></html>",
    })
    page.goto(f"{BASE}/jobs/42")
    recipe = _recipe(cv_path)
    _run_until_review(recipe, page)  # two links to the same target are one Apply
    assert page.url == f"{BASE}/jobs/42/apply"
    assert page.locator("input[name=n]").input_value() == "Jane Example"
    assert page.locator("input[name=yrs]").input_value() == "5"
    recipe.submit(page)
    page.wait_for_url(f"{BASE}/jobs/42/submitted")
    assert GenericRecipe.confirmation_text(page)
    assert page.locator(GenericRecipe.SUBMIT).count() == 0
    assert any(marker in page.url for marker in GenericRecipe.CONFIRMATION_URL_MARKERS)


# ── 4. Italian form: cover letter file, unanswered question ────────────────


def test_required_cover_letter_file_is_its_own_stop(browser, cv_path):
    page = _site_page(browser, {"/lavora/1": ITALIAN})
    page.goto(f"{BASE}/lavora/1")
    recipe = _recipe(cv_path, {**PROFILE, "application_answers": {"Qual è la tua RAL attuale?": "Synthetic"}})
    recipe.open_form(page)
    recipe.fill_core(page)
    recipe.upload_cv(page)
    assert _blocked(lambda: recipe.fill_screening(page)).reason == "cover_letter_required"


def test_unanswered_text_question_carries_its_exact_label(browser, cv_path):
    without_cover = ITALIAN.replace('  <label for="lettera">Lettera di presentazione *</label><input id="lettera" type="file" required>\n', "")
    assert without_cover != ITALIAN
    page = _site_page(browser, {"/lavora/1": without_cover})
    page.goto(f"{BASE}/lavora/1")
    recipe = _recipe(cv_path)
    recipe.open_form(page)
    recipe.fill_core(page)
    assert page.locator("#nome").input_value() == "Jane"
    assert page.locator("#cognome").input_value() == "Example"
    recipe.upload_cv(page)
    stop = _blocked(lambda: recipe.fill_screening(page))
    assert stop.reason == "required_answer_missing"
    assert stop.answer_request["label"] == "Qual è la tua RAL attuale?"
    assert stop.answer_request["field_type"] == "text"


# ── 5. stops ────────────────────────────────────────────────────────────────


def _open_stop(browser, cv_path, html: str) -> BlockedHuman:
    page = _site_page(browser, {"/x": html})
    page.goto(f"{BASE}/x")
    return _blocked(lambda: _recipe(cv_path).open_form(page))


def test_only_newsletter_and_contact_forms_are_never_an_application(browser, cv_path):
    page = _site_page(browser, {"/x": f"<html><body><h1>Careers</h1>{NEWSLETTER}{REVEAL.split('<aside>')[1].split('</aside>')[0]}</body></html>"})
    page.goto(f"{BASE}/x")
    recipe = _recipe(cv_path)
    assert not recipe.form_present(page)
    assert _blocked(lambda: recipe.open_form(page)).reason == "generic_form_missing"
    assert page.locator("#nl-email").input_value() == ""
    assert page.locator("input[name=cmail]").input_value() == ""


def test_form_embedded_from_another_host_names_the_host(browser, cv_path):
    stop = _open_stop(browser, cv_path, '<html><body><h1>Jobs</h1><iframe title="Apply" src="https://jobs.personio.example/job/1" width="600" height="400"></iframe></body></html>')
    assert stop.reason == "application_form_embedded"
    assert "jobs.personio.example" in stop.detail


def test_login_and_account_creation_are_human_stops(browser, cv_path):
    login = '<html><body><form><label for="u">Email</label><input id="u" type="email"><label for="p">Password</label><input id="p" type="password"><button>Sign in to apply</button></form></body></html>'
    assert _open_stop(browser, cv_path, login).reason == "login_required"
    account = login.replace("Sign in to apply", "Create an account").replace('</form>', '<label for="p2">Confirm password</label><input id="p2" type="password"></form>')
    assert _open_stop(browser, cv_path, account).reason == "account_creation"


def test_two_application_forms_are_ambiguous(browser, cv_path):
    form = CLASSIC.split("<form class=\"application\">")[1].split("</form>")[0]
    html = f'<html><body><form class="application">{form}</form><form class="application">{form.replace("id=", "data-x=")}</form></body></html>'
    assert _open_stop(browser, cv_path, html).reason == "application_form_ambiguous"


def test_visible_captcha_stops_before_screening(browser, cv_path):
    html = CLASSIC.replace("<button type=\"submit\">Submit application</button>",
                           '<iframe title="reCAPTCHA challenge" src="https://www.google.com/recaptcha/api2/anchor?k=x" width="300" height="80"></iframe><button type="submit">Submit application</button>')
    page = _site_page(browser, {"/x": html})
    page.goto(f"{BASE}/x")
    recipe = _recipe(cv_path)
    recipe.open_form(page)
    recipe.fill_core(page)
    recipe.upload_cv(page)
    assert _blocked(lambda: recipe.fill_screening(page)).reason == "captcha"


def test_apply_to_another_site_is_refused_without_a_handoff(browser, cv_path, monkeypatch):
    monkeypatch.delattr(apply_flow, "PlatformHandoff", raising=False)
    html = '<html><body><h1>Job</h1><a href="https://jobs.lever.co/example/123">Apply now</a></body></html>'
    stop = _open_stop(browser, cv_path, html)
    assert stop.reason == "application_redirect_untrusted"
    assert "jobs.lever.co" in stop.detail


def test_apply_to_a_known_ats_is_handed_off_when_the_flow_supports_it(browser, cv_path, monkeypatch):
    class PlatformHandoff(apply_flow.FlowError):
        def __init__(self, url: str, detail: str = ""):
            super().__init__(detail)
            self.url, self.detail = url, detail

    monkeypatch.setattr(apply_flow, "PlatformHandoff", PlatformHandoff, raising=False)
    monkeypatch.setattr(apply_flow, "SUPPORTED_PLATFORMS", frozenset({"ashby", "greenhouse", "lever", "generic"}))
    page = _site_page(browser, {"/x": '<html><body><a href="https://jobs.lever.co/example/123">Apply now</a></body></html>'})
    page.goto(f"{BASE}/x")
    with pytest.raises(PlatformHandoff) as caught:
        _recipe(cv_path).open_form(page)
    assert caught.value.url == "https://jobs.lever.co/example/123"
    assert "lever" in caught.value.detail


def test_submit_without_review_never_clicks(browser, cv_path):
    page = _site_page(browser, {"/jobs/7": CLASSIC})
    page.goto(f"{BASE}/jobs/7")
    recipe = _recipe(cv_path)
    recipe.open_form(page)
    assert _blocked(lambda: recipe.submit(page)).reason == "submit_unavailable"
    assert page.evaluate("window.submitCount") == 0


def test_unfilled_required_field_blocks_review(browser, cv_path):
    page = _site_page(browser, {"/jobs/7": CLASSIC})
    page.goto(f"{BASE}/jobs/7")
    recipe = _recipe(cv_path)
    recipe.open_form(page)
    recipe.fill_core(page)
    assert _blocked(lambda: recipe.review(page)).reason == "required_field_unanswered"


def test_pre_submit_screenshot_failure_is_a_stop(browser, cv_path, tmp_path):
    page = _site_page(browser, {"/jobs/7": CLASSIC})
    page.goto(f"{BASE}/jobs/7")
    blocker = tmp_path / "file"
    blocker.write_text("not a directory")
    recipe = _recipe(cv_path)
    recipe.pre_submit_screenshot_path = blocker / "shot.png"
    recipe.open_form(page)
    recipe.fill_core(page)
    recipe.upload_cv(page)
    recipe.fill_screening(page)
    assert _blocked(lambda: recipe.review(page)).reason == "pre_submit_screenshot_failed"


# ── pure functions ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("form", "kind"),
    [
        ({"questions": [{"type": "email", "label": "Email"}], "submits": ["Subscribe"], "text": "Newsletter"}, "newsletter"),
        ({"questions": [{"type": "email", "label": "E-Mail"}, {"type": "text", "label": "Name"}], "submits": ["Abonnieren"], "text": "Job-Newsletter"}, "newsletter"),
        ({"questions": [{"type": "text", "label": "Name"}, {"type": "email", "label": "Email"}, {"type": "select", "label": "Country"}], "submits": ["Subscribe"], "text": "Our newsletter, once a month", "heading": "Stay in touch"}, "newsletter"),
        ({"questions": [{"type": "email", "label": "Email"}], "submits": ["Go"], "text": ""}, "newsletter"),
        ({"questions": [{"type": "text", "label": "Name"}, {"type": "email", "label": "Email"}, {"type": "textarea", "label": "Your message"}], "submits": ["Send message"], "text": "Contact us"}, "contact"),
        ({"questions": [{"type": "search", "label": "Search jobs"}], "submits": ["Search"], "text": ""}, "search"),
        ({"questions": [{"type": "email", "label": "Email"}, {"type": "password", "label": "Password"}], "submits": ["Log in"], "text": ""}, "login"),
        ({"questions": [{"type": "text", "label": "Full name"}, {"type": "email", "label": "Email"}, {"type": "file", "label": "CV"}], "submits": ["Send application"], "text": ""}, "application"),
        ({"questions": [{"type": "text", "label": "Full name"}, {"type": "email", "label": "Email"}, {"type": "file", "label": "CV"}], "submits": ["Send"], "text": ""}, "other"),
        ({"questions": [{"type": "text", "label": "Full name"}, {"type": "email", "label": "Email"}, {"type": "file", "label": "CV"}], "submits": ["Apply"], "heading": "Talent pool", "text": ""}, "talent"),
        ({"questions": [{"type": "text", "label": "Full name"}, {"type": "email", "label": "Email"}, {"type": "file", "label": "CV"}], "submits": ["Submit application"], "heading": "Refer a candidate", "text": ""}, "talent"),
        ({"questions": [{"type": "text", "label": "Nome"}, {"type": "email", "label": "Email"}], "submits": ["Invia candidatura"], "text": ""}, "application"),
        ({"questions": [{"type": "text", "label": "Name"}, {"type": "email", "label": "Email"}, {"type": "file", "label": "Lettre de motivation"}], "submits": ["Envoyer"], "text": ""}, "other"),
    ],
)
def test_classify_form(form, kind):
    assert classify_form(form) == kind


def test_core_fields_by_label_in_several_languages():
    assert core_field({"type": "text", "label": "Vorname *"})[0] == "first name"
    assert core_field({"type": "text", "label": "Cognome"})[0] == "last name"
    assert core_field({"type": "text", "label": "Téléphone"})[0] == "phone"
    assert core_field({"type": "email", "label": ""})[0] == "email"
    assert core_field({"type": "text", "label": "E-Mail-Adresse"})[0] == "email"
    assert core_field({"type": "text", "label": "Correo electrónico"})[0] == "email"
    assert core_field({"type": "textarea", "label": "Email"}) is None


@pytest.mark.parametrize(
    ("label", "fact"),
    [
        ("Email address *", "email"), ("Your email", "email"), ("E-Mail-Adresse", "email"),
        ("Indirizzo e-mail", "email"), ("Adresse e-mail", "email"), ("Correo electrónico", "email"),
        ("Phone number", "phone"), ("Mobile phone", "phone"), ("Telefonnummer", "phone"),
        ("Numéro de téléphone", "phone"), ("Número de teléfono", "phone"), ("Cellulare", "phone"),
        ("LinkedIn profile URL", "linkedin"), ("GitHub", "github"), ("Portfolio website", "website"),
        ("Full name", "full name"), ("Name *", "full name"), ("Nome completo", "full name"),
        ("First name", "first name"), ("Vorname", "first name"), ("Cognome", "last name"),
        ("Current location *", "location"), ("City", "location"), ("Città di residenza", "location"),
        ("Wohnort", "location"), ("Ciudad de residencia", "location"), ("Location (City)", "location"),
    ],
)
def test_labels_that_are_the_fact(label, fact):
    assert core_field({"type": "text", "label": label})[0] == fact


@pytest.mark.parametrize(
    "label",
    ["Referee email", "Emergency contact phone", "How did you hear about us? (LinkedIn, Indeed, other)",
     "Website where you found this job", "Manager's phone number", "Recruiter name", "Current company website",
     "Email of a reference", "Your name as it appears on your passport and visa documents",
     "Preferred job location", "Are you willing to relocate to this city?", "Country of residence"],
)
def test_labels_about_something_else_are_questions(label):
    assert core_field({"type": "text", "label": label}) is None
    assert core_field({"type": "email", "label": label}) is None


def test_type_decides_only_without_any_label():
    assert core_field({"type": "email", "label": "", "name": ""})[0] == "email"
    assert core_field({"type": "tel", "label": "", "name": ""})[0] == "phone"


def test_same_site():
    assert same_site("https://jobs.ml6.eu/a", "https://www.ml6.eu/b")
    assert not same_site("https://a.co.uk/x", "https://b.co.uk/y")
    assert not same_site("https://careers.example.com/x", "https://jobs.lever.co/y")


def test_recipe_contract_matches_the_other_recipes():
    for name in ("form_present", "apply_control_present", "open_form", "fill_core", "upload_cv",
                 "fill_screening", "review", "submit", "_challenge_reason"):
        assert callable(getattr(GenericRecipe, name))
    recipe = GenericRecipe()
    assert recipe.answer_sources == {} and recipe.last_answer_key == ""
    assert isinstance(GenericRecipe.SUBMIT, str) and GenericRecipe.SUCCESS == ""
    assert all(m == m.casefold() for m in apply_generic.CONFIRMATION_MARKERS)


# ── the CLOSER's skill names every stop of the recipe ──────────────────────


def _generic_reasons() -> set[str]:
    source = (ROOT / "shared" / "skills" / "apply_generic.py").read_text(encoding="utf-8")
    found = set(__import__("re").findall(r'BlockedHuman\(\s*"([a-z_]+)"', source))
    assert len(found) >= 15, found  # a search that finds nothing is not a pass
    return found | {"captcha", "two_factor", "account_creation"}  # raised from _challenge_reason


@pytest.mark.parametrize("lang", ("en", "it", "es", "fr", "de", "pt", "hu"))
def test_apply_flow_skill_names_every_generic_stop(lang):
    name = "SKILL.md" if lang == "en" else f"SKILL.{lang}.md"
    text = (ROOT / "agents" / "_skills" / "apply-flow" / name).read_text(encoding="utf-8")
    missing = sorted(r for r in _generic_reasons() if f"`{r}`" not in text)
    assert not missing, f"{lang}: apply-flow does not name {missing}"
    assert "apply_generic.py" in text


# ── review R3 (HQ-BACKEND): a confirmation is proved, not read off the page ─


class _TextPage:
    def __init__(self, text):
        self._text = text

    def locator(self, _selector):
        page = self

        class _Body:
            def count(self):
                return 1

            def inner_text(self):
                return page._text

        return _Body()


def test_a_marker_already_there_before_the_click_is_not_a_confirmation():
    copy = "Our process. After you apply we reply: thank you for applying, we will be in touch."
    assert GenericRecipe.confirmation_text(_TextPage(copy), before=copy) == ""
    assert GenericRecipe.confirmation_text(_TextPage(copy), before="Our process.")


def test_url_markers_are_only_words_of_a_finished_submission():
    common = {"thanks", "danke", "merci", "grazie", "gracias", "obrigado", "koszonjuk", "apply", "jobs", "careers"}
    assert not common & set(apply_generic.CONFIRMATION_URL_MARKERS)


def test_submit_selector_sees_the_application_form_not_a_footer_form(browser, cv_path):
    thanks = f"<html><body><h1>Thank you for your application!</h1>{NEWSLETTER}</body></html>"
    page = _site_page(browser, {"/jobs/7": CLASSIC, "/thanks": thanks})
    page.goto(f"{BASE}/jobs/7")
    assert page.locator(GenericRecipe.SUBMIT).count() >= 1  # a reloaded form reads as still there
    page.goto(f"{BASE}/thanks")
    assert page.locator(GenericRecipe.SUBMIT).count() == 0  # the footer newsletter does not hide the receipt


# ── location with suggestions (1888, 14/09) ──────────────────────────────────

LOCATION_COMBO = f"""
<html><head><title>Data Engineer — Example Co</title></head><body>
<main>
  <h2>Apply for this position</h2>
  <form class="application">
    <label for="em">Email *</label><input id="em" type="email" name="email" required>
    <label for="cv">Upload your CV *</label><input id="cv" type="file" name="cv" required>
    <label id="city-label" for="city">City *</label>
    <div class="combo">
      <span class="chosen"></span>
      <input id="city" name="city" role="combobox" aria-autocomplete="list" aria-controls="city-list"
             aria-labelledby="city-label" aria-required="true">
      <ul id="city-list" role="listbox" hidden></ul>
    </div>
    <button type="submit">Submit application</button>
  </form>
</main>
<script>
(() => {{
  const places = {{"lyon": ["Lyon, Auvergne-Rhône-Alpes, France", "Lyons, Colorado, United States"]}};
  const input = document.querySelector('#city'), list = document.querySelector('#city-list');
  let timer;
  input.addEventListener('input', () => {{
    clearTimeout(timer);
    timer = setTimeout(() => {{
      list.innerHTML = '';
      (places[input.value.trim().toLowerCase()] || []).forEach(name => {{
        const li = document.createElement('li');
        li.setAttribute('role', 'option'); li.textContent = name;
        li.addEventListener('click', () => {{
          document.querySelector('.chosen').textContent = name; input.value = ''; list.hidden = true;
        }});
        list.appendChild(li);
      }});
      list.hidden = !list.children.length;
    }}, 200);
  }});
}})();
</script>
{CONFIRM_SCRIPT.replace("CONFIRM", "void 0;")}
</body></html>
"""


def test_a_company_location_combobox_takes_the_suggestion_of_the_same_city_and_country(browser, cv_path):
    page = _site_page(browser, {"/jobs/9": LOCATION_COMBO})
    page.goto(f"{BASE}/jobs/9")
    recipe = _recipe(cv_path, {**PROFILE, "location": "Lyon, France"})
    recipe.open_form(page)
    recipe.fill_core(page)
    assert page.locator(".chosen").inner_text() == "Lyon, Auvergne-Rhône-Alpes, France"
    assert recipe.answer_sources["city"] == "profile"


def test_a_company_location_combobox_without_a_certain_match_is_a_question(browser, cv_path):
    page = _site_page(browser, {"/jobs/9": LOCATION_COMBO})
    page.goto(f"{BASE}/jobs/9")
    recipe = _recipe(cv_path, {**PROFILE, "location": "Lyon"})
    recipe.open_form(page)
    stop = _blocked(lambda: recipe.fill_core(page))
    assert stop.reason == "required_answer_missing"
    assert stop.answer_request == {
        "key": "city", "label": "City", "field_type": "select",
        "options": ["Lyon, Auvergne-Rhône-Alpes, France", "Lyons, Colorado, United States"],
    }
    assert page.locator(".chosen").inner_text() == "" and page.locator("#city").input_value() == ""

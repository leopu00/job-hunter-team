"""Cookie banners, "APLICAR", and the Apply control that leads to THIS vacancy.

Origin: patch 26 (14/09). 1843 AXA: two "APLICAR" links (to the ATS login)
under a OneTrust banner, stopped as generic_form_missing. 1944 DNV: "Apply"
and "Manage your application" to two different places under a OneTrust
banner, stopped as application_form_ambiguous. Synthetic pages with those
structures.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import cookie_consent  # noqa: E402
from apply_flow import BlockedHuman  # noqa: E402
from apply_generic import APPLY_LABEL, GenericRecipe, _NOT_AN_APPLY_CONTROL  # noqa: E402

BASE = "https://careers.example.com"

TRACK = """<script>window.clicked = [];
document.addEventListener('click', e => { const b = e.target.closest('button,a'); if (b) window.clicked.push(b.innerText.trim() || b.getAttribute('aria-label')); }, true);
document.querySelectorAll('[data-hide]').forEach(b => b.addEventListener('click', () => {
  document.getElementById(b.getAttribute('data-hide')).style.display = 'none'; }));</script>"""

ONETRUST = """<div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk" role="dialog" aria-label="Cookie banner">
<p>Al hacer clic en "Aceptar todas las cookies", usted acepta…</p>
<button id="onetrust-pc-btn-handler">Configuración de cookies</button>
<button id="onetrust-reject-all-handler" data-hide="onetrust-banner-sdk">Rechazarlas todas</button>
<button id="onetrust-accept-btn-handler" data-hide="onetrust-banner-sdk">Aceptar todas las cookies</button>
</div></div>"""


def page_with(browser, body: str, url: str = f"{BASE}/jobs/24335"):
    page = browser.new_page()
    page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html; charset=utf-8",
                                                    body=f"<html><body>{body}{TRACK}</body></html>"))
    page.goto(url)
    return page


@pytest.fixture
def browser():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        launched = runtime.chromium.launch(headless=True)
        yield launched
        launched.close()


# ── cookie banners ───────────────────────────────────────────────────────────


def test_a_onetrust_banner_is_refused_never_accepted(browser):
    page = page_with(browser, ONETRUST + "<h1>Ingeniero</h1>")

    assert cookie_consent.dismiss(page, settle_ms=50) == "rejected"

    assert page.evaluate("window.clicked") == ["Rechazarlas todas"]
    assert not page.locator("#onetrust-banner-sdk").is_visible()


@pytest.mark.parametrize(
    ("buttons", "clicked"),
    [
        ('<button>Accetta tutti</button><button data-hide="cb">Rifiuta</button>', ["Rifiuta"]),
        ('<button>Alle akzeptieren</button><button data-hide="cb">Nur notwendige Cookies</button>', ["Nur notwendige Cookies"]),
        ('<a href="#" data-hide="cb">Continuar sin aceptar</a><button>Aceptar</button>', ["Continuar sin aceptar"]),
        ('<button>Accept all</button><button aria-label="Close" data-hide="cb">×</button>', ["Close"]),
    ],
    ids=["italian", "german", "continue-without-accepting", "close-only"],
)
def test_a_banner_without_a_known_tool_is_refused_by_its_words(browser, buttons, clicked):
    page = page_with(browser, f'<div id="cb" class="cookie-banner">We use cookies. {buttons}</div>')

    assert cookie_consent.dismiss(page, settle_ms=50) in {"rejected", "closed"}

    assert [c for c in page.evaluate("window.clicked") if c] in (clicked, ["×"])
    assert not any("ccept" in (c or "") or "kzeptier" in (c or "") for c in page.evaluate("window.clicked"))


def test_a_banner_that_only_accepts_is_left_alone(browser):
    page = page_with(browser, '<div class="cookie-consent">We use cookies. <button>Accept all</button><button>OK</button></div>')

    assert cookie_consent.dismiss(page, settle_ms=50) == ""
    assert page.evaluate("window.clicked") == []


def test_a_reject_button_outside_any_consent_box_is_never_clicked(browser):
    page = page_with(browser, "<main><h1>Offer</h1><button>Reject</button></main>")

    assert cookie_consent.dismiss(page, settle_ms=50) == ""
    assert page.evaluate("window.clicked") == []


def test_a_broken_page_is_no_error():
    class Broken:
        def evaluate(self, *_args):
            raise RuntimeError("target closed")

    assert cookie_consent.dismiss(Broken()) == ""


# ── "APLICAR" and the controls that are not Apply ────────────────────────────


@pytest.mark.parametrize("label", ["APLICAR", "Aplicar : Ingeniero/a Soluciones IA_Madrid", "Aplicar agora"])
def test_aplicar_is_an_apply_label(label):
    assert APPLY_LABEL.search(label)


@pytest.mark.parametrize(
    ("label", "not_apply"),
    [
        ("Manage your application", True),
        ("Track my application", True),
        ("Mis aplicaciones", True),
        ("Sign in", True),
        ("Apply for AI Engineer - Agentic Systems", False),
        ("Submit application", False),
    ],
)
def test_controls_that_name_an_application_without_starting_one(label, not_apply):
    assert bool(_NOT_AN_APPLY_CONTROL.search(label)) is not_apply


AXA = ONETRUST + """<main><h1>Ingeniero/a Soluciones IA_Madrid</h1>
<a class="apply" aria-label="Aplicar : Ingeniero/a Soluciones IA_Madrid" href="https://careers-ats.example.net/jobs/24335/login">APLICAR</a>
<p>Número de Empleo: 24335</p>
<a class="apply" aria-label="Aplicar : Ingeniero/a Soluciones IA_Madrid" href="https://careers-ats.example.net/jobs/24335/login">APLICAR</a>
</main>"""


def recipe() -> GenericRecipe:
    built = GenericRecipe({"name": "Jane Example"}, None)
    built.url_guard = lambda url: url
    return built


def test_the_1843_page_refuses_cookies_and_follows_aplicar(browser):
    page = page_with(browser, AXA)

    with pytest.raises(BlockedHuman) as stop:
        recipe().open_form(page)

    # Not generic_form_missing: APLICAR was followed, to another site with no recipe.
    assert stop.value.reason == "application_redirect_untrusted"
    assert "careers-ats.example.net" in stop.value.detail
    assert page.evaluate("window.clicked")[0] == "Rechazarlas todas"


DNV = ONETRUST.replace("Rechazarlas todas", "Reject All Cookies").replace("Aceptar todas las cookies", "Accept All Cookies") + """
<main><h1>AI Engineer - Agentic Systems</h1><p>Job ID: 7406</p>
<a aria-label="Apply for AI Engineer - Agentic Systems" href="https://ats.example.net/CX_1/job/7406/apply/email">Apply</a>
<footer><a href="https://ats.example.net/CX_1/my-profile/sign-in">Manage your application</a></footer></main>"""


def test_the_1944_page_is_not_ambiguous_over_manage_your_application(browser):
    page = page_with(browser, DNV, f"{BASE}/job-search/it/ai-engineer-agentic-systems/300001688284443")
    assert [c.inner_text() for c in recipe()._apply_controls(page)] == ["Apply"]

    with pytest.raises(BlockedHuman) as stop:
        recipe().open_form(page)

    assert stop.value.reason == "application_redirect_untrusted"
    assert "ats.example.net" in stop.value.detail


TWO_APPLY = """<main><h1>AI Engineer</h1><p>Job ID: 7406</p>
<a href="https://ats.example.net/job/7406/apply">Apply now</a>
<a href="https://ats.example.net/job/9999/apply">Apply</a></main>"""


def test_of_two_apply_links_the_one_carrying_the_job_id_wins(browser):
    page = page_with(browser, TWO_APPLY, f"{BASE}/jobs/ai-engineer")

    with pytest.raises(BlockedHuman) as stop:
        recipe().open_form(page)

    assert stop.value.reason == "application_redirect_untrusted"  # followed, not ambiguous
    built = recipe()
    built.application_url = page.url
    links = {c.get_attribute("href"): c for c in built._apply_controls(page)}
    assert built._position_target(page, links) == "https://ats.example.net/job/7406/apply"


def test_two_apply_links_with_nothing_of_the_vacancy_stay_ambiguous(browser):
    page = page_with(browser, TWO_APPLY.replace("<p>Job ID: 7406</p>", "").replace("7406", "1111"),
                     f"{BASE}/jobs/ai-engineer")

    with pytest.raises(BlockedHuman) as stop:
        recipe().open_form(page)

    assert stop.value.reason == "application_form_ambiguous"

"""apply_instructions: an application channel written in words.

Origin: 1798 (14/09) — "How to Apply: Send your CV and a short cover letter
to careers@…" in plain text inside collapsed role blocks, no form, no mailto:
the CLOSER stopped as ats_unsupported. Synthetic pages with that structure.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import apply_instructions as ai  # noqa: E402

ROLE = """<div class="role"><h3>{title}</h3><p>Location: Remote</p>
<div class="collapsible" style="display:none"><p>The Role. {body}</p>
<p>How to Apply</p><p>{how}</p></div><button class="collapsible-content-more">Show More</button></div>"""

CAREERS = """<html><body><h1>Careers</h1>{roles}
<p>By responding to the advertisement, you agree that your personal information may be processed.
For more information, please contact the relevant internal team at info@example.com.</p>
<form><input type="email" placeholder="Email address"><textarea placeholder="Provide a brief motivation"></textarea>
<button>Send</button></form>
<script>window.support = "help@example.com";</script></body></html>"""


def careers(*hows: str) -> str:
    roles = "".join(
        ROLE.format(title=f"Role {i}", body="Python and data.", how=how) for i, how in enumerate(hows)
    )
    return CAREERS.format(roles=roles)


@pytest.mark.parametrize(
    ("sentence", "address"),
    [
        ("Send your CV and a short cover letter to careers@example.com", "careers@example.com"),
        ("Applications should be emailed to Jobs@example.org.", "jobs@example.org"),
        ("Please apply by sending your résumé to hiring@example.net", "hiring@example.net"),
        ("Invia il tuo CV a lavora@example.com", "lavora@example.com"),
        ("Bitte schicken Sie Ihre Bewerbung an karriere@example.com", "karriere@example.com"),
        ("Envoyez votre CV et lettre de motivation à recrutement@example.com", "recrutement@example.com"),
        ("Envía tu CV a empleo@example.com", "empleo@example.com"),
        ("Envie o seu currículo para vagas@example.com", "vagas@example.com"),
        ("Önéletrajzát küldje a karrier@example.com címre", "karrier@example.com"),
    ],
)
def test_a_sentence_that_sends_a_cv_to_an_address_is_the_channel(sentence, address):
    found = ai.email_instruction(f"The role. {sentence} We look forward to it.")
    assert found is not None and found.address == address


def test_a_how_to_apply_heading_gives_the_verb_to_the_next_line():
    found = ai.email_instruction("How to Apply\nYour CV and cover letter: careers@example.com")
    assert found is not None and found.address == "careers@example.com"


@pytest.mark.parametrize(
    "text",
    [
        "For more information about your personal data, please contact info@example.com.",
        "Questions? Write to hello@example.com.",
        "Press and media inquiries: send your requests to press@example.com.",
        "Our privacy team reviews every application: privacy@example.com.",
        "Send your CV through the form below.",
        "To exercise your data protection rights about your application, send an email to privacy@example.com.",
        "Send us an email at hello@example.com.",
        "",
    ],
)
def test_no_application_address_is_no_channel(text):
    assert ai.email_instruction(text) is None


def test_two_different_application_addresses_are_no_conclusion():
    text = "Role A. Send your CV to uk-jobs@example.com. Role B. Send your CV to it-jobs@example.com."
    assert ai.email_instruction(text) is None


def test_the_same_address_under_every_role_is_one_channel():
    text = " ".join(["Send your CV and a short cover letter to careers@example.com."] * 4)
    found = ai.email_instruction(text)
    assert found is not None and found.address == "careers@example.com"


def test_mailto_href():
    assert ai.mailto_href(ai.EmailInstruction("careers@example.com", "")) == "mailto:careers@example.com"


# --- the page: collapsed blocks, scripts, privacy notes ----------------------


@pytest.fixture
def page():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        current = browser.new_page()
        yield current
        browser.close()


def test_the_address_inside_a_collapsed_block_is_read(page):
    how = "Send your CV and a short cover letter to careers@example.com"
    page.set_content(careers(how, how, how))
    assert "careers@example.com" not in page.locator("body").inner_text()  # hidden to innerText

    found = ai.email_instruction(ai.page_text(page))

    assert found is not None and found.address == "careers@example.com"


def test_scripts_and_the_privacy_note_never_give_an_address(page):
    page.set_content(careers("Use the form below.", "Use the form below."))
    text = ai.page_text(page)
    assert "help@example.com" not in text
    assert ai.email_instruction(text) is None


def test_a_broken_page_gives_no_text():
    class Broken:
        def evaluate(self, _script):
            raise RuntimeError("target closed")

    assert ai.page_text(Broken()) == ""

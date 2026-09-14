"""apply_vocabulary: Apply controls beyond the seven languages, in Python and in the browser.

Origin: 2071 (14/09) — a Czech vacancy dialog with "Poslat přihlášku" (a
mailto link with the role in its subject) stopped as generic_form_missing
next to the visible button. Synthetic pages with that structure.
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

import apply_flow  # noqa: E402
import apply_generic  # noqa: E402
from apply_flow import ApplicationFlow  # noqa: E402

LABELS = [apply_flow._MAILTO_APPLY_LABEL, apply_generic.APPLY_LABEL]

APPLY = [
    "Poslat přihlášku",
    "Poslat přihlášku — AI Platform Engineer (EU/UK)",
    "Odoslať žiadosť",
    "Aplikuj teraz",
    "Wyślij aplikację",
    "Solliciteer nu",
    "Ansök",
    "Søk på stillingen",
    "Lähetä hakemus",
    "Aplică acum",
    "Prijavi se",
    "Hemen başvur",
    "Υποβολή αίτησης",
    "Откликнуться",
    "Подати заявку",
]
NOT_APPLY = [
    "Napsat nám",  # "write to us"
    "přihlášky zde",
    "aplikujemy rozwiązania",  # a longer word is not the phrase
    "Prijavite se na newsletter",
    "Contact us",
]


@pytest.mark.parametrize("label", APPLY)
@pytest.mark.parametrize("pattern", LABELS, ids=["mailto", "generic"])
def test_apply_phrases_in_more_languages(pattern, label):
    assert pattern.search(label)


@pytest.mark.parametrize("label", NOT_APPLY)
@pytest.mark.parametrize("pattern", LABELS, ids=["mailto", "generic"])
def test_other_words_are_not_apply(pattern, label):
    assert not pattern.search(label)


# ── the browser: the same pattern through get_by_role ────────────────────────


@pytest.fixture
def browser():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        launched = runtime.chromium.launch(headless=True)
        yield launched
        launched.close()


def test_the_pattern_finds_the_same_controls_in_the_browser(browser):
    # Playwright compiles the Python pattern as a JavaScript RegExp, where \b
    # is ASCII-only: "Poslat přihlášku" must still be found there.
    page = browser.new_page()
    buttons = "".join(f"<button>{label}</button>" for label in APPLY + NOT_APPLY)
    page.set_content(f"<html><body>{buttons}</body></html>")

    for pattern in LABELS:
        found = page.get_by_role("button", name=pattern)
        names = [found.nth(i).inner_text() for i in range(found.count())]
        assert names == APPLY


@dataclass(frozen=True)
class GateVerdict:
    allowed: bool = True
    reason: str = "apply_allowed"
    context: dict = field(default_factory=lambda: {"mode": "authorised"})

    def log_line(self) -> str:
        return "[apply-gate] ALLOW"


JOB_DIALOG = """<!doctype html><html><head><title>Kariéra</title></head><body>
<main><h1>Přijďte vyřešit problém</h1>
<section><h2>Nevidíte svou pozici?</h2>
<a href="mailto:friends@example.com?subject=Kari%C3%A9ra%3A%20spont%C3%A1nn%C3%AD%20p%C5%99ihl%C3%A1%C5%A1ka">Napsat nám</a></section>
<form><input placeholder="Který proces chcete zautomatizovat?"><button>pokračovat</button></form>
<footer><a href="mailto:friends@example.com">friends@example.com</a></footer></main>
<aside role="dialog" aria-modal="true"><p>PRODUCT</p><h2>AI Platform Engineer (EU/UK — Remote)</h2>
<a href="mailto:friends@example.com?subject=Kari%C3%A9ra%3A%20AI%20Platform%20Engineer%20(EU%2FUK)">Poslat přihlášku</a>
<p>Stavíte mozek, který řídí celou firmu.</p>
<a href="mailto:friends@example.com?subject=Kari%C3%A9ra%3A%20AI%20Platform%20Engineer%20(EU%2FUK)">Poslat přihlášku — AI Platform Engineer (EU/UK)</a>
</aside></body></html>"""


def test_a_czech_apply_mailto_in_the_vacancy_dialog_is_the_email_channel(browser, tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    cv = tmp_path / "synthetic-profile.pdf"
    cv.write_bytes(b"%PDF-1.4\n% synthetic test fixture only\n")
    url = "https://careers.example.com/kariera?jid=ai-platform-engineer"
    page = browser.new_page()
    page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html; charset=utf-8", body=JOB_DIALOG))
    page.goto(url)
    flow = ApplicationFlow(
        essentials_checker=lambda **_kwargs: [],
        cap_reserver=lambda **_kwargs: GateVerdict(True, "cap_reserved"),
        cv_checker=lambda _path: {"ok": True, "reasons": []},
        position_id=92,
        url=url,
        profile={"name": "Jane Example", "contacts": {"email": "jane@example.invalid"}},
        cv_path=cv,
        checkpoint_path=tmp_path / "92.json",
        receipt_dir=tmp_path / "receipts",
        gate_checker=lambda **_kwargs: GateVerdict(),
        notifier=lambda **_kwargs: "1",
        applied_recorder=lambda **_kwargs: None,
    )

    result = flow.run(page=page, navigate=False)

    assert (result.status, result.reason) == ("email_channel", "mailto_application"), result
    saved = json.loads((tmp_path / "92.json").read_text(encoding="utf-8"))
    # The role's own link, not "Napsat nám" (a spontaneous application) nor the footer address.
    assert saved["mailto_href"] == (
        "mailto:friends@example.com?subject=Kari%C3%A9ra%3A%20AI%20Platform%20Engineer%20(EU%2FUK)"
    )

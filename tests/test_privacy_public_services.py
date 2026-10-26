"""The privacy page lists every public service the desktop app talks to.

One section, "Public services used by the app", in the seven languages, says
for each service what it sees and when the app calls it: GitHub (version check),
Frankfurter (exchange rates) and CARTO (map tiles), plus where the installer and
the container image come from. A host that the desktop allows in its content
security policy, or that its code calls on purpose, must be named there: a new
one turns this test red until the page says it.
"""

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LANGS = ["it", "en", "es", "fr", "de", "pt", "hu"]
# Named by the page elsewhere (cloud sync, the site itself) or local to the machine.
DECLARED_ELSEWHERE = ("supabase.co", "jobhunterteam.ai", "127.0.0.1", "ipc.localhost")


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


PAGE = text("web/app/privacy/page.tsx")


def block(lang: str) -> str:
    start = re.search(rf"\n  {lang}: \{{\n", PAGE)
    assert start, lang
    end = PAGE.find("\n  },\n", start.end())
    return PAGE[start.end():end]


def services(lang: str) -> str:
    body = re.search(r'\n    s9_body:\n      "((?:[^"\\\n]|\\.)*)",\n', block(lang))
    assert body, f"{lang}: no s9_body"
    return body.group(1)


def hosts(csp: str) -> set[str]:
    found = set()
    for source in csp.split():
        match = re.match(r"^(?:https?|wss?)://(?:\*\.)?([A-Za-z0-9.-]+)", source)
        if match:
            found.add(match.group(1))
    return found


def external_hosts_of_the_desktop() -> set[str]:
    config = json.loads(text("desktop/src-tauri/tauri.conf.json"))
    csp = config["app"]["security"]["csp"]
    found = hosts(csp)
    # The hosts the desktop code calls on purpose (a constant URL in a source file).
    for path, pattern in [
        ("desktop/src-tauri/src/app_update.rs", r'LATEST_URL: &str = "https://([A-Za-z0-9.-]+)'),
        ("desktop/src/lib/existing-team-dashboard.ts", r'RATES_URL = "https://([A-Za-z0-9.-]+)'),
    ]:
        match = re.search(pattern, text(path))
        assert match, path
        found.add(match.group(1))
    return {h for h in found if not h.endswith(DECLARED_ELSEWHERE) and h not in DECLARED_ELSEWHERE}


def test_the_hosts_the_desktop_can_reach_are_the_ones_this_test_knows():
    # If this list changes, read the new host and decide what the page says about it.
    assert external_hosts_of_the_desktop() == {
        "basemaps.cartocdn.com", "api.frankfurter.dev", "api.github.com",
    }


@pytest.mark.parametrize("lang", LANGS)
def test_every_language_has_the_public_services_section_and_no_old_version_check_one(lang):
    chunk = block(lang)
    assert "s9_title:" in chunk and "s9_body:" in chunk
    assert "s8_" not in chunk
    paragraphs = services(lang).split("\\n")
    assert len(paragraphs) == 6
    # The last one: services the person starts themselves (Google sign-in, feedback) are contacted only then.
    assert "Google" in paragraphs[-1]


@pytest.mark.parametrize("lang", LANGS)
def test_every_service_the_desktop_calls_is_named_in_every_language(lang):
    body = services(lang)
    for host in external_hosts_of_the_desktop():
        named = "GitHub" if host == "api.github.com" else host
        assert named in body, f"{lang}: {named} is missing from the public services section"
    assert "ghcr.io" in body and "jobhunterteam.ai" in body


@pytest.mark.parametrize("lang", LANGS)
def test_each_language_says_what_the_services_see_and_that_none_gets_the_users_data(lang):
    body = services(lang)
    assert re.search(r"user[ -]agent", body, re.IGNORECASE)
    assert re.search(r"\bIP\b|IP-", body)


def test_the_section_is_in_the_rendered_list_in_place_of_the_old_one():
    assert '["s9_title", "s9_body"],' in PAGE
    assert '["s8_title", "s8_body"],' not in PAGE
    assert "whitespace-pre-line" in PAGE

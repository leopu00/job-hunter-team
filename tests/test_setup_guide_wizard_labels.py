"""The site's setup guide says the words the app says, language by language.

The chapters on the first start follow the app's wizard: the start screen, the four steps, the
automatic start with its stages, the provider sign-in, the Assistant and the working hours. Every
button and screen name in those phases is read here from the app's own text files, in each of the
seven languages, so a label the app renames stops being quoted wrong on the site without anyone
noticing. The phases of the old flow are gone for good.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LANGS = ["it", "en", "de", "es", "fr", "hu", "pt"]
GUIDE = (ROOT / "web/app/setup-guide/guide-content.ts").read_text(encoding="utf-8")
ONBOARDING = (ROOT / "desktop/src/onboarding/onboarding.i18n.ts").read_text(encoding="utf-8")
LOGIN = (ROOT / "desktop/src/components/login-screen.i18n.ts").read_text(encoding="utf-8")
HOURS = (ROOT / "desktop/src/pages/work-hours/work-hours.i18n.ts").read_text(encoding="utf-8")


def const_blocks(source: str) -> dict:
    """`const it = {…}` … `const pt: T = {…}`: the text of each language block."""
    heads = [(m.start(), m.group(1)) for m in re.finditer(r"^const (it|en|de|es|fr|hu|pt)\b", source, re.M)]
    end = re.search(r"^export const [A-Z_]+: Record<Locale", source, re.M).start()
    return {lang: source[at: heads[i + 1][0] if i + 1 < len(heads) else end] for i, (at, lang) in enumerate(heads)}


def login_blocks() -> dict:
    blocks = {"it": source_between(LOGIN, r"^const it = \{", r"^export const LOGIN_TEXT")}
    body = LOGIN[LOGIN.index("export const LOGIN_TEXT"):]
    heads = [(m.start(), m.group(1)) for m in re.finditer(r"^  (en|de|fr|es|pt|hu): \{", body, re.M)]
    for i, (at, lang) in enumerate(heads):
        blocks[lang] = body[at: heads[i + 1][0] if i + 1 < len(heads) else len(body)]
    return blocks


def source_between(source: str, start: str, stop: str) -> str:
    a = re.search(start, source, re.M).start()
    return source[a: re.search(stop, source[a:], re.M).start() + a]


def value(block: str, key: str) -> str:
    match = re.search(rf'\b{re.escape(key)}: "((?:[^"\\]|\\.)*)"', block)
    assert match, key
    return match.group(1)


ON, LO, WH = const_blocks(ONBOARDING), login_blocks(), const_blocks(HOURS)


def stage_labels(lang: str) -> list:
    stages = re.search(r"stages: \{(.*?)\n  \},", ON[lang], re.S).group(1)
    return re.findall(r'label: "([^"]+)"', stages)


def step_one(lang: str) -> str:
    return re.findall(r'"([^"]+)"', re.search(r"steps: \[(.*?)\]", ON[lang]).group(1))[0]


def phase_body(phase_id: str, lang: str) -> str:
    start = GUIDE.index(f'id: "{phase_id}"')
    block = GUIDE[start: GUIDE.find('\n      {\n        id: "', start + 10)]
    body = block[block.index("body: {"):]
    return re.search(rf'\n          {lang}: "((?:[^"\\\n]|\\.)*)",', body).group(1)


def expected(lang: str) -> dict:
    stages = stage_labels(lang)  # server identity, runtime, container, provider, provider login, team, assistant
    return {
        "start-locally": [value(LO[lang], "title").rstrip("?").rstrip(), value(LO[lang], "useLocal"), value(LO[lang], "name"), value(LO[lang], "continueLocal")],
        "welcome": [step_one(lang), value(ON[lang], "profileName"), value(ON[lang], "startSetup")],
        "choose-environment": [value(ON[lang], "thisComputer"), value(ON[lang], "vpsServer")],
        "choose-provider": [value(ON[lang], "noApiKey")],
        "confirm-setup": [value(ON[lang], "reviewTitle").rstrip("."), value(ON[lang], "prepareTeam")],
        "start-container": stages[1:],
        "authorize-provider": [stages[4], value(ON[lang], "signInProvider")],
        "team-starting": [stages[5], value(ON[lang], "elapsed"), value(ON[lang], "openAssistant")],
        "talk-to-the-assistant": [stages[6]],
        "set-working-hours": [value(WH[lang], "title"), value(WH[lang], "back")],
        "verify-team-working": [stages[6]],
    }


@pytest.mark.parametrize("lang", LANGS)
def test_every_phase_quotes_the_apps_own_words(lang):
    for phase_id, labels in expected(lang).items():
        body = phase_body(phase_id, lang)
        for label in labels:
            assert label in body, f"{phase_id}/{lang}: «{label}» is not in «{body[:80]}…»"


def test_the_phases_of_the_old_flow_are_gone():
    for gone in ["open-setup", "upload-cv", "complete-profile", "review-setup", "enter-office", "activate-team"]:
        assert f'id: "{gone}"' not in GUIDE, gone
    for stale in ["Activate team", "Team setup", "Profile and CV", "8/8 fields", "Login detected"]:
        assert stale not in GUIDE, stale


def test_the_first_start_phases_come_in_the_order_the_app_asks_them():
    order = ["choose-language", "start-locally", "welcome", "choose-environment", "choose-provider", "confirm-setup",
             "start-container", "authorize-provider", "team-starting", "talk-to-the-assistant", "set-working-hours",
             "verify-team-working"]
    at = [GUIDE.index(f'id: "{phase}"') for phase in order]
    assert at == sorted(at)


def test_the_screens_of_those_phases_exist_in_the_registry_and_the_old_ones_do_not():
    screens = (ROOT / "web/app/setup-guide/guide-screens.ts").read_text(encoding="utf-8")
    for new in ["S07a-start-screen", "S07b-display-name", "S07-enter-office", "S08-environment", "S08-provider", "S08-confirm"]:
        assert f'id: "{new}"' in screens, new
    for old in ["S08-setup-overview-empty", "S10-choose-provider", "S12-upload-cv", "S13-profile-ready", "S14-working-hours", "S15-setup-complete"]:
        assert old not in screens and old not in GUIDE, old
    assert "Docker" not in screens

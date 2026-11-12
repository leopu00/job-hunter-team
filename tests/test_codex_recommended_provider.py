"""Codex is the only provider offered, everywhere the product lists providers.

The open source product runs officially on Codex, with each person's own
ChatGPT subscription. Kimi (archived) and Claude Code are not offered in 0.4:
no text, no choice and no list names them as something to pick. The desktop
onboarding proposes Codex already chosen, and the web, the guides and the
changelog say the same in the languages where they describe the choice.
"""

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
RECOMMENDED = {
    "en": "recommended", "it": "consigliato", "es": "recomendado", "fr": "recommandé",
    "de": "empfohlen", "pt": "recomendado", "hu": "ajánlott",
}


def text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_the_desktop_proposes_only_codex_and_already_chosen():
    flow = text("desktop/src/onboarding/OnboardingFlow.tsx")
    assert 'const PROPOSED_PROVIDER: SubscriptionProvider = "codex";' in flow
    listed = flow[flow.index("function providers("):]
    listed = listed[:listed.index("\n}\n")]
    assert re.findall(r'value: "(\w+)"', listed) == ["codex"]


@pytest.mark.parametrize("path", [
    "web/app/docs/guides/getting-started/page.tsx",
    "web/app/docs/guides/connect-ai-provider/page.tsx",
])
def test_the_web_guides_offer_codex_only(path):
    page = text(path)
    # 0.4.0: the guide of the provider offers GLM and says Codex comes later; getting-started still shows Codex
    assert ("🟢 <strong>GLM</strong>" in page and "{t.coming}" in page) if "connect-ai-provider" in path else "🔵 <strong>Codex</strong>" in page
    assert "Kimi" not in page and "Claude" not in page


@pytest.mark.parametrize("path,key", [
    ("web/app/docs/guides/getting-started/page.i18n.ts", "codex"),
])
def test_the_web_guides_call_codex_recommended_in_every_language(path, key):
    source = text(path)
    values = re.findall(rf"\n    {key}:\s*\n?\s*\"([^\"]+)\"", source)
    langs = re.findall(r"\n  (\w\w): \{", source)
    assert len(values) == 7 and sorted(langs) == sorted(RECOMMENDED)
    for value, word in zip(values, [RECOMMENDED[lang] for lang in langs]):
        assert word in value, value


@pytest.mark.parametrize("path", [
    "web/app/setup-guide/guide-content.ts",
    "web/app/setup-guide/guide-screens.ts",
    "web/app/docs/guides/faq/page.i18n.ts",
    "web/app/privacy/page.tsx",
    "web/app/terms/page.tsx",
    "web/app/pricing/page.tsx",
])
def test_the_site_texts_do_not_offer_kimi_or_claude(path):
    source = text(path)
    assert not re.search(r"kimi|claude", source, re.IGNORECASE), path


def test_the_guide_of_the_provider_says_glm_and_codex_later_in_every_language():
    source = text("web/app/docs/guides/connect-ai-provider/page.i18n.ts")
    assert len(re.findall(r'\n    whichProviderP: "In 0\.4\.0|\n    whichProviderP: "Nella 0\.4\.0|\n    whichProviderP: "(En la|Dans la|In|A|Na) 0\.4\.0', source)) == 7
    assert len(re.findall(r'\n    coming: "Codex — ', source)) == 7


def test_the_setup_guide_and_faq_name_codex_as_the_provider():
    # the FAQ: in 0.4.0, GLM; Codex comes later (said in every language). The setup guide is the desktop app's, which 0.4.0 does not ship
    assert len(re.findall(r"\n    a1: \"[^\"]*— [^\"]*GLM[^\"]*Codex", text("web/app/docs/guides/faq/page.i18n.ts"))) == 7
    assert text("web/app/setup-guide/guide-content.ts").count("Codex") >= 7


def test_the_pricing_page_shows_the_one_provider_of_0_4_0_and_says_the_others_come_later():
    page = text("web/app/pricing/page.tsx")
    providers = page[page.index("const PROVIDERS: Provider[] = ["):]
    providers = providers[:providers.index("\n];")]
    assert re.findall(r'name: "(\w+)"', providers) == ["GLM"]
    assert "The one provider of 0.4.0" in providers and "L'unico provider della 0.4.0" in providers
    assert page.count("Codex") >= 7, "every language says Codex comes in a later release"


def test_the_guides_and_the_changelog_say_codex_only():
    # 0.4.0 offers only Pi with a GLM key (shared/runtime/release-providers.js): the quickstart and PROVIDERS say so, and say
    # Codex, Kimi and Claude come later, never as a choice of this release
    quickstart = text("docs/guides/QUICKSTART.md")
    table = quickstart[quickstart.index("| Provider   |"):]
    table = table[:table.index("\n\n")]
    assert "| 🟢  | **GLM (Z.ai)** on the Pi harness | API key, per call | ✅ The only one offered in 0.4.0" in table
    assert "Coming in a later release" in table.split("Codex")[1].split("\n")[0]
    assert "providers use claude" not in quickstart
    providers = text("docs/about/PROVIDERS.md")
    assert "**0.4.0 offers one way to power the team: Pi with a GLM (Z.ai) API key.**" in providers
    assert "| 🔵 Codex (OpenAI) with a ChatGPT subscription or an OpenAI key | subscription or API key | Codex CLI | ⏳ coming in a later release |" in providers
    assert "shared/runtime/release-providers.js" in providers
    assert "A GLM (Z.ai) API key: 0.4.0 runs the team only on Pi with GLM." in text("docs/guides/VPS-SETUP-WIZARD.md")
    changelog = text("CHANGELOG.md")
    release = changelog[changelog.index("## [0.4.0]"):]
    # 0.4.0: one way (Pi with a GLM key), the others come later and are refused by the CLI
    assert "team runs on Pi with a GLM (Z.ai) API key.**" in release[:4000]
    assert "One way to power the team: **Pi with GLM (Z.ai)**" in release[:4000]
    assert "Codex (ChatGPT subscription or OpenAI key), Kimi and Claude come" in release[:4000]
    readme = text("README.md")
    assert "in 0.4.0, **GLM (Z.ai) with an API key** on the Pi harness" in readme and "**Codex** (recommended)" not in readme


def test_the_protected_setup_page_starts_on_codex_and_lists_only_it():
    page = text("web/app/(protected)/setup/page.tsx")
    assert 'provider: "openai",\n    model: "",' in page
    providers = page[page.index("const PROVIDERS = ["):page.index("const MODELS")]
    assert re.findall(r'v: "(\w+)"', providers) == ["openai"]
    # the initial value is one of the options, so a confirm without touching the menu sends it
    assert re.search(r'useState<FormState>\(\{\s*provider: "openai"', page)


def test_the_faq_does_not_call_codex_the_most_complete():
    faq = text("web/app/docs/guides/faq/page.i18n.ts")
    answers = re.findall(r"\n    a6:\s*\"([^\"]+)\"", faq)
    assert len(answers) == 7
    for answer in answers:
        assert not re.search(r"most complete|più completo|más completo|plus complet|umfassendsten|legteljesebb|mais completo", answer), answer

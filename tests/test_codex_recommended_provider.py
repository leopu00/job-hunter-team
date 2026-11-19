"""The providers of 0.4.0, said the same everywhere the product lists them.

0.4.0 offers GLM, Kimi, OpenAI and Claude, each with an API key on the Pi harness; the Codex CLI with a ChatGPT
subscription is not in this version. The web, the guides and the changelog say so, in the languages where they
describe the choice. The desktop onboarding is the desktop app's, which 0.4.0 does not ship.
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
    # 0.4.0: both guides offer GLM first, then Kimi, OpenAI and Claude (API key on Pi), and say Codex is not in this version
    order = [page.index("🟢 <strong>%s</strong>" % name) for name in ("GLM", "Kimi", "OpenAI", "Claude")]
    assert order == sorted(order)
    assert "🔵 <strong>Codex</strong>" not in page


def test_the_first_page_of_the_site_says_glm_in_0_4_0_and_codex_not_in_this_version_in_every_language():
    source = text("web/app/docs/guides/getting-started/page.i18n.ts")
    langs = re.findall(r"\n  (\w\w): \{", source)
    assert sorted(langs) == sorted(RECOMMENDED)
    assert len(re.findall(r'\n    subIntroA:\s*"[^"]*0\.4\.0', source)) == 7
    for name in ("GLM", "Kimi", "OpenAI", "Claude"):
        assert len(re.findall(r'\n    subIntroB:\s*"[^"]*%s' % name, source)) == 7, name
    assert len(re.findall(r'\n    codex: " — ', source)) == 7
    for word in RECOMMENDED.values():
        assert word not in source.split("subIntroA")[1], word


@pytest.mark.parametrize("path", [
    "web/app/privacy/page.tsx",
    "web/app/terms/page.tsx",
])
def test_the_pages_that_do_not_list_the_providers_do_not_name_kimi_or_claude(path):
    source = text(path)
    assert not re.search(r"kimi|claude", source, re.IGNORECASE), path


@pytest.mark.parametrize("path", [
    "web/app/docs/guides/faq/page.i18n.ts",
    "web/app/pricing/page.tsx",
    "web/app/download/DownloadClient.tsx",
])
def test_the_site_texts_that_list_the_providers_name_the_four_of_0_4_0_and_not_a_fifth(path):
    source = text(path)
    for name in ("GLM", "Kimi", "OpenAI", "Claude"):
        assert name in source, (path, name)
    assert not re.search(r"Gemini|Mistral|DeepSeek", source), path


def test_the_guide_of_the_provider_says_glm_and_codex_later_in_every_language():
    source = text("web/app/docs/guides/connect-ai-provider/page.i18n.ts")
    # the formatter may put the string on the line after the key: whitespace between the two is not part of the claim
    assert len(re.findall(r'\n    whichProviderP:\s*"(?:In|Nella|En la|Dans la|A|Na) 0\.4\.0', source)) == 7
    assert len(re.findall(r'\n    coming:\s*"Codex — ', source)) == 7


def test_the_faq_names_codex_as_the_provider_that_comes_later():
    # the FAQ: in 0.4.0, GLM; Codex comes later (said in every language)
    assert len(re.findall(r"\n    a1: \"[^\"]*— [^\"]*GLM[^\"]*Codex", text("web/app/docs/guides/faq/page.i18n.ts"))) == 7


def test_the_pricing_page_shows_the_one_provider_of_0_4_0_and_says_the_others_come_later():
    page = text("web/app/pricing/page.tsx")
    providers = page[page.index("const PROVIDERS: Provider[] = ["):]
    providers = providers[:providers.index("\n];")]
    assert re.findall(r'name: "(\w+)"', providers) == ["GLM", "Kimi", "OpenAI", "Claude"]
    assert "One of the four providers of 0.4.0" in providers and "Uno dei quattro provider della 0.4.0" in providers
    assert page.count("Codex") >= 7, "every language says Codex is not in 0.4.0"


def test_the_guides_and_the_changelog_say_codex_only():
    # 0.4.0 offers only Pi with a GLM key (shared/runtime/release-providers.js): the quickstart and PROVIDERS say so, and say
    # Codex, Kimi and Claude are not in 0.4.0, never a choice of this release
    quickstart = text("docs/guides/QUICKSTART.md")
    table = quickstart[quickstart.index("| Provider   |"):]
    table = table[:table.index("\n\n")]
    for name in ("**GLM (Z.ai)**", "**Kimi (Moonshot)**", "**OpenAI**", "**Claude (Anthropic)**"):
        assert "| 🟢  | %s on the Pi harness | API key, per call | ✅ Offered in 0.4.0" % name in table, name
    assert "Not in 0.4.0" in table.split("Codex")[1].split("\n")[0]
    assert "providers use claude" not in quickstart
    providers = text("docs/about/PROVIDERS.md")
    assert "**0.4.0 offers four ways to power the team: Pi with an API key from GLM (Z.ai), Kimi (Moonshot), OpenAI or Claude (Anthropic).**" in providers
    assert "| 🔵 Codex (OpenAI) with a ChatGPT subscription | subscription | Codex CLI | ⏳ not in 0.4.0 |" in providers
    assert "shared/runtime/release-providers.js" in providers
    assert "An API key for GLM (Z.ai), Kimi (Moonshot), OpenAI or Claude (Anthropic): 0.4.0 runs the team only on Pi with one of them." in text("docs/guides/VPS-SETUP-WIZARD.md")
    changelog = text("CHANGELOG.md")
    release = changelog[changelog.index("## [0.4.0]"):]
    # 0.4.0: one way (Pi with a GLM key), the others are not in 0.4.0 and are refused by the CLI
    assert "team runs on Pi with an API key, from GLM (Z.ai), Kimi (Moonshot), OpenAI or Claude (Anthropic).**" in release[:4000]
    assert "Four ways to power the team: **Pi with GLM (Z.ai)**" in release[:4000]
    assert "a team you set up with 0.3.9 on it keeps working**, with one warning" in release[:4000].replace("\n  ", " ")
    readme = text("README.md")
    assert "in 0.4.0, **GLM (Z.ai), Kimi (Moonshot), OpenAI or Claude (Anthropic) with an API key** on the Pi harness" in readme and "**Codex** (recommended)" not in readme


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

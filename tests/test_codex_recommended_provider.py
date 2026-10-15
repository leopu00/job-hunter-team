"""Codex is the recommended provider, everywhere the product lists providers.

The open source product runs officially on Codex, with each person's own
ChatGPT subscription; Claude and Kimi stay supported. The desktop onboarding
proposes Codex first and already chosen: the web, the guides and the
changelog say the same, in the same order (Codex, Claude, Kimi), and say
«recommended» in every language where they describe the choice.
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


def order(source: str, names=("Codex", "Claude", "Kimi")) -> list[int]:
    return [source.index(name) for name in names]


def test_the_desktop_proposes_codex_first_and_already_chosen():
    flow = text("desktop/src/onboarding/OnboardingFlow.tsx")
    assert 'const PROPOSED_PROVIDER: SubscriptionProvider = "codex";' in flow
    listed = flow[flow.index("function providers("):]
    assert order(listed, ('value: "codex"', 'value: "claude"', 'value: "kimi"')) == sorted(
        order(listed, ('value: "codex"', 'value: "claude"', 'value: "kimi"')))


@pytest.mark.parametrize("path", [
    "web/app/docs/guides/getting-started/page.tsx",
    "web/app/docs/guides/connect-ai-provider/page.tsx",
])
def test_the_web_guides_list_codex_first(path):
    page = text(path)
    marks = ["🔵 <strong>Codex</strong>", "🟠 <strong>Claude</strong>", "🌙 <strong>Kimi</strong>"]
    positions = [page.index(mark) for mark in marks]
    assert positions == sorted(positions)


@pytest.mark.parametrize("path,key", [
    ("web/app/docs/guides/getting-started/page.i18n.ts", "codex"),
    ("web/app/docs/guides/connect-ai-provider/page.i18n.ts", "codex"),
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
])
def test_the_setup_guide_and_faq_name_codex_recommended_first(path):
    source = text(path)
    for lang, word in RECOMMENDED.items():
        found = re.findall(rf"Codex \({re.escape(word)}\), Claude,? \w+ Kimi", source)
        assert found, (path, lang)


def test_the_pricing_page_shows_codex_first_and_recommended():
    page = text("web/app/pricing/page.tsx")
    providers = page[page.index("const PROVIDERS: Provider[] = ["):]
    assert re.findall(r'name: "(\w+)"', providers)[:3] == ["Codex", "Claude", "Kimi"]
    codex = providers[:providers.index('name: "Claude"')]
    assert "recommended provider" in codex and "provider consigliato" in codex


def test_the_guides_and_the_changelog_put_codex_first():
    quickstart = text("docs/guides/QUICKSTART.md")
    table = quickstart[quickstart.index("| Provider   |"):]
    assert order(table) == sorted(order(table))
    assert "| 🔵  | **Codex**  | Plus / Pro | ~€100   | ✅ **Recommended**" in table
    assert "`jht providers use codex` (or `claude` / `kimi`)" in quickstart
    providers = text("docs/about/PROVIDERS.md")
    assert "| 🎯 **Recommended**" in providers and "🔵 **Codex Plus / Pro €100**" in providers
    subscriptions = providers[providers.index("## 💳 Supported subscriptions"):]
    assert subscriptions.index("**Codex / OpenAI**") < subscriptions.index("**Claude** | Max x20")
    assert "A dedicated Codex (recommended), Claude or Kimi subscription." in text("docs/guides/VPS-SETUP-WIZARD.md")
    changelog = text("CHANGELOG.md")
    release = changelog[changelog.index("## [0.4.0]"):]
    assert "supported Codex (recommended), Claude Code or Kimi subscription" in release[:4000]

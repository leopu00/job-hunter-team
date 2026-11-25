"""Kimi and Claude Code are not offered (0.4: one subscription, Codex): no choice leads to them any more, and a team already on them keeps working.

The code that serves a team configured on Kimi or Claude stays (the provider install and
update, the login, the Rust enum): this proves that nothing a person can CHOOSE
reaches it. The choice is made in three places: the desktop onboarding (its own
test, `OnboardingFlow.test.tsx`), the setup wizard of the CLI, and `jht providers
use`.
"""

import json
import subprocess
from pathlib import Path

import pytest

from test_cli_config import make_config, run_jht

ROOT = Path(__file__).resolve().parent.parent
LANGS = ("de", "en", "es", "fr", "hu", "it", "pt")


@pytest.fixture
def jht_home(tmp_path):
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)
    return home


def config_of(home: Path) -> dict:
    return json.loads((home / ".jht" / "jht.config.json").read_text())


# Paused providers are refused according to shared/runtime/release-providers.js.
import re  # noqa: E402

# the source is formatted with either quote
_OFFERS = (ROOT / "shared/runtime/release-providers.js").read_text(encoding="utf-8").split("RELEASE_OFFERS = Object.freeze(")[1].split("]);")[0]
OFFERED = " ".join("'%s'" % name for name in re.findall(r"provider: ['\"]([a-z]+)['\"]", _OFFERS))
_CANONICAL = {"moonshot": "kimi", "anthropic": "claude"}


@pytest.mark.parametrize("names", [kept for kept in (tuple(n for n in names if "'%s'" % _CANONICAL.get(n.lower(), n.lower()) not in OFFERED)
                                                     for names in [("glm", "GLM"), ("kimi", "moonshot", "KIMI"), ("claude", "anthropic", "Claude"), ("codex", "openai")])
                                   if kept])
def test_providers_use_refuses_what_this_release_does_not_offer_and_leaves_the_configuration_as_it_was(jht_home, names):
    """The services of a release are one list (shared/runtime/release-providers.js): the setup offers OpenAI and Claude on Pi."""
    make_config(jht_home / ".jht", {"active_provider": "openai", "providers": {"openai": {}}})
    before = (jht_home / ".jht" / "jht.config.json").read_bytes()
    for name in names:
        code, out, err = run_jht("providers", "use", name, env={"HOME": str(jht_home)})
        assert code != 0, (name, out, err)
        assert "is not offered in this release" in (out + err) and "jht setup" in (out + err), (name, out, err)
        assert (jht_home / ".jht" / "jht.config.json").read_bytes() == before, name


def test_the_list_shows_an_archived_provider_only_to_the_team_that_still_uses_it(jht_home):
    make_config(jht_home / ".jht", {"active_provider": "openai", "providers": {"openai": {}}})
    code, out, err = run_jht("providers", "list", env={"HOME": str(jht_home)})
    # an offered service is listed to everybody (Claude on pi with a key), an archived CLI only to the team on it
    assert ("Claude" in out) == ("'claude'" in OFFERED), out
    assert ("Kimi" in out) == ("'kimi'" in OFFERED), out
    # a team that is on one of them keeps seeing it, so it can be read and updated
    for active, config, shown in (("kimi", {"kimi": {"model": "k2"}}, "Kimi"), ("claude", {"claude": {"model": "c"}}, "Claude")):
        make_config(jht_home / ".jht", {"active_provider": active, "providers": config})
        code, out, err = run_jht("providers", "list", env={"HOME": str(jht_home)})
        assert shown in out and "· active" in out, (active, out)


def test_the_wizard_offers_exactly_the_release_list_and_not_kimi_or_claude_as_subscriptions():
    helpers = (ROOT / "cli/wizard/setup-helpers.js").read_text(encoding="utf-8")
    catalog = helpers[helpers.index("export const AI_PROVIDERS"):helpers.index("// --- Config IO")]
    assert "kimi" not in catalog.lower() and "claude" not in catalog.lower()
    for lang in LANGS:
        locale = json.loads((ROOT / f"shared/locales/{lang}.json").read_text(encoding="utf-8"))
        assert "wizard.provider.kimi" not in locale and "wizard.provider.claude" not in locale, lang
    choices = subprocess.run(
        ["node", "--input-type=module", "-e", "import { WIZARD_PROVIDERS } from './cli/wizard/setup.js'; console.log(JSON.stringify(WIZARD_PROVIDERS.map(p => p.value)))"],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    assert json.loads(choices.stdout) == list(dict.fromkeys(re.findall(r"provider: ['\"]([a-z]+)['\"]", _OFFERS)))
    # the choices of the wizard are the catalog's: nothing else feeds them
    setup = (ROOT / "cli/wizard/setup.js").read_text(encoding="utf-8")
    # The runtime catalog stays available; only the release list feeds the choices.
    assert "options: WIZARD_PROVIDERS.map(" in setup
    assert "[...AI_PROVIDERS, ...PI_API_CHOICES].find(" in setup and "OPENAI_PI_CHOICE" in setup  # OpenAI: with a key on pi


def test_what_a_team_already_on_kimi_or_claude_needs_is_still_there():
    """Archived is not deleted: the update, the login and the config check still know them."""
    providers = (ROOT / "cli/src/commands/providers.js").read_text(encoding="utf-8")
    assert "kimi:      { name: 'Kimi K2 (Moonshot)'" in providers and providers.count("archived: true") == 2
    assert "if (target === 'kimi')" in providers  # `jht providers update kimi` still installs it
    assert "if (lower === 'anthropic' || lower === 'claude') return 'claude';" in providers  # and so does claude
    helpers = (ROOT / "cli/wizard/setup-helpers.js").read_text(encoding="utf-8")
    assert "'kimi'" in helpers[helpers.index("validProviders"):][:200]  # an existing config is still valid
    assert "'claude'" in helpers[helpers.index("validProviders"):][:200]
    rust = (ROOT / "desktop/src-tauri/src/onboarding.rs").read_text(encoding="utf-8")
    assert "Kimi," in rust and 'Self::Kimi => "kimi"' in rust

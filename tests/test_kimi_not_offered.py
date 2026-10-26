"""Kimi is archived (0.4): no choice leads to it any more, and a team already on it keeps working.

The code that serves a team configured on Kimi stays (the provider install and
update, the login, the Rust enum): this proves that nothing a person can CHOOSE
reaches it. The choice is made in three places: the desktop onboarding (its own
test, `OnboardingFlow.test.tsx`), the setup wizard of the CLI, and `jht providers
use`.
"""

import json
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


def test_providers_use_refuses_kimi_and_leaves_the_configuration_as_it_was(jht_home):
    make_config(jht_home / ".jht", {"active_provider": "openai", "providers": {"openai": {}}})
    before = (jht_home / ".jht" / "jht.config.json").read_bytes()
    for name in ("kimi", "moonshot", "KIMI"):
        code, out, err = run_jht("providers", "use", name, env={"HOME": str(jht_home)})
        assert code != 0 or "archived" in (out + err), (name, out, err)
        assert "archived" in (out + err), (name, out, err)
        assert (jht_home / ".jht" / "jht.config.json").read_bytes() == before, name
    assert config_of(jht_home)["active_provider"] == "openai"


def test_providers_use_still_accepts_what_is_offered(jht_home):
    make_config(jht_home / ".jht", {"active_provider": "openai", "providers": {"openai": {}}})
    code, out, err = run_jht("providers", "use", "claude", env={"HOME": str(jht_home)})
    assert code == 0, (out, err)
    assert config_of(jht_home)["active_provider"] == "claude"


def test_the_list_shows_kimi_only_to_the_team_that_still_uses_it(jht_home):
    make_config(jht_home / ".jht", {"active_provider": "openai", "providers": {"openai": {}}})
    code, out, err = run_jht("providers", "list", env={"HOME": str(jht_home)})
    assert "Kimi" not in out and "kimi" not in out.lower().replace("jht", ""), out
    # a team that is on Kimi keeps seeing it, so it can be read and updated
    make_config(jht_home / ".jht", {"active_provider": "kimi", "providers": {"kimi": {"model": "k2"}}})
    code, out, err = run_jht("providers", "list", env={"HOME": str(jht_home)})
    assert "Kimi" in out and "[ACTIVE]" in out, out


def test_the_wizard_and_its_languages_do_not_offer_kimi():
    helpers = (ROOT / "cli/wizard/setup-helpers.js").read_text(encoding="utf-8")
    catalog = helpers[helpers.index("export const AI_PROVIDERS"):helpers.index("// --- Config IO")]
    assert "kimi" not in catalog.lower()
    for lang in LANGS:
        locale = json.loads((ROOT / f"shared/locales/{lang}.json").read_text(encoding="utf-8"))
        assert "wizard.provider.kimi" not in locale, lang
        assert "kimi" not in str(locale.get("wizard.cli.provider", "")).lower(), lang
    # the choices of the wizard are the catalog's: nothing else feeds them
    setup = (ROOT / "cli/wizard/setup.js").read_text(encoding="utf-8")
    assert "options: AI_PROVIDERS.map(" in setup


def test_what_a_team_already_on_kimi_needs_is_still_there():
    """Archived is not deleted: the update, the login and the config check still know Kimi."""
    providers = (ROOT / "cli/src/commands/providers.js").read_text(encoding="utf-8")
    assert "kimi:      { name: 'Kimi K2 (Moonshot)'" in providers and "archived: true" in providers
    assert "if (target === 'kimi')" in providers  # `jht providers update kimi` still installs it
    helpers = (ROOT / "cli/wizard/setup-helpers.js").read_text(encoding="utf-8")
    assert "'kimi'" in helpers[helpers.index("validProviders"):][:200]  # an existing config is still valid
    rust = (ROOT / "desktop/src-tauri/src/onboarding.rs").read_text(encoding="utf-8")
    assert "Kimi," in rust and 'Self::Kimi => "kimi"' in rust

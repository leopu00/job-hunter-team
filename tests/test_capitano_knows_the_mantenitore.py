"""The Capitano knows the Mantenitore and when to call him; nobody in the team updates the provider's CLI (JHT-T195).

The prompts are source: agent-harness reads them too. Here, in the seven languages: the role table of the
Capitano names the Mantenitore, the rule says what he is, when and how he is called (and that a bare shell is not
written into), the rule on the provider's CLI is in the Capitano, the Mantenitore and the team rules."""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
AGENTS = ROOT / "agents"
LANGS = ["en", "it", "de", "es", "fr", "hu", "pt"]


def read(kind, lang):
    suffix = "" if lang == "en" else f".{lang}"
    name = {"cap": ("capitano", "capitano"), "man": ("mantenitore", "mantenitore"), "rules": ("_team", "team-rules")}[kind]
    return (AGENTS / name[0] / f"{name[1]}{suffix}.md").read_text(encoding="utf-8")


@pytest.mark.parametrize("lang", LANGS)
def test_the_role_table_names_the_mantenitore_next_to_the_dottore(lang):
    text = read("cap", lang)
    rows = [l for l in text.splitlines() if l.startswith("|")]
    dottore = next(i for i, l in enumerate(rows) if "`DOTTORE`" in l)
    assert "`MANTENITORE`" in rows[dottore + 1]
    # the same columns as every other row of the table
    assert rows[dottore + 1].count("|") == rows[dottore].count("|")


@pytest.mark.parametrize("lang", LANGS)
def test_the_rule_says_who_he_is_when_to_call_him_and_how(lang):
    text = read("cap", lang)
    rule = next(l for l in text.splitlines() if l.startswith("**C-31"))
    assert "`MANTENITORE`" in rule and "Dottore" in rule
    assert "/app/.launcher/spawn-maintainer.sh" in rule
    # the CLI must be up before the request, and exit 3 of jht-tmux-send means a bare shell: nothing is written in it
    assert "capture-pane" in rule and "**3**" in rule and "jht-tmux-send" in rule and "notify-user" in rule
    assert "`[REQ]`" in rule and "`[URG]`" in rule
    # the rule sits with the other C-08 rules, not at the end of the file
    lines = text.splitlines()
    assert lines.index(rule) < next(i for i, l in enumerate(lines) if l.startswith("**C-07"))


@pytest.mark.parametrize("lang", LANGS)
def test_the_dottore_is_never_called_the_maintainer_in_the_capitano_prompt(lang):
    text = read("cap", lang)
    for line in text.splitlines():
        if "DOTTORE" in line and line.startswith("|"):
            assert "mantenitore" not in line.lower() and "maintainer" not in line.lower()


@pytest.mark.parametrize("lang", LANGS)
def test_nobody_updates_the_provider_cli_in_the_three_places(lang):
    cap = read("cap", lang)
    rule = next(l for l in cap.splitlines() if l.startswith("**C-32"))
    for cli in ("codex", "claude", "kimi"):
        assert cli in rule
    man = read("man", lang)
    m05 = next(l for l in man.splitlines() if l.startswith("**M-05**"))
    assert all(cli in m05 for cli in ("codex", "claude", "kimi"))
    rules = read("rules", lang)
    row = next(l for l in rules.splitlines() if l.startswith("|") and "codex, claude, kimi" in l)
    assert row.count("|") == 4  # the same three columns as the table it sits in
    assert re.search(r"jht-install", rules)


@pytest.mark.parametrize("lang", LANGS)
def test_the_prompts_carry_no_real_episode(lang):
    for kind in ("cap", "man", "rules"):
        text = read(kind, lang)
        added = [l for l in text.splitlines() if "C-31" in l or "C-32" in l or "M-05**" in l]
        for line in added:
            assert not re.search(r"\b20\d\d-\d\d-\d\d\b|\b\d{1,2}:\d\d\b|0\.1\d\d\.\d", line)

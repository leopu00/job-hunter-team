"""The Capitano takes the subscription plan only from the configuration or from the user (never from its diary),
and writes the plan's option ids the way the question tool accepts them (`pro-max` is `pro_max`): both rules are in
the first-run-burst skill, in every language the Capitano speaks."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "agents" / "_skills" / "first-run-burst"
LANGS = ("", ".it", ".es", ".fr", ".de", ".hu", ".pt")


@pytest.mark.parametrize("lang", LANGS)
def test_the_plan_comes_only_from_the_configuration_or_the_user(lang: str):
    text = (SKILL / f"SKILL{lang}.md").read_text(encoding="utf-8")
    assert text.count("plan_missing") >= 3
    diary = re.compile(r"diary|diario|diário|journal|Tagebuch|napló", re.I)
    bold = [line for line in text.splitlines() if line.startswith("**") and "plan_missing" in line and diary.search(line)]
    assert len(bold) == 1, f"{lang or 'en'}: one paragraph names the diary and plan_missing"


@pytest.mark.parametrize("lang", LANGS)
def test_the_option_id_rule_is_told_with_the_plan_example(lang: str):
    text = (SKILL / f"SKILL{lang}.md").read_text(encoding="utf-8")
    assert text.count("`pro-max`") == 1 and text.count("`pro_max`") == 1
    assert text.count("plan_registry.py set <provider>:pro-max") == 1
    assert "`a-z`, `0-9` and `_`" in text or "`a-z`, `0-9` e `_`" in text or "`a-z`, `0-9` y `_`" in text \
        or "`a-z`, `0-9` et `_`" in text or "`a-z`, `0-9` und `_`" in text or "`a-z`, `0-9` és `_`" in text \
        or "`a-z`, `0-9` e `_`" in text


def test_the_ids_the_registry_has_are_the_ones_the_skill_example_names():
    out = subprocess.run([sys.executable, str(ROOT / "shared" / "skills" / "plan_registry.py"), "list", "openai"],
                         capture_output=True, text=True, timeout=60, check=True).stdout
    assert re.search(r"^\s+pro-max\s", out, re.M), "the example in the skill must be an id the registry has"


def test_the_help_of_the_tool_says_the_same():
    text = (ROOT / "agents" / "_tools" / "jht-notify-user").read_text(encoding="utf-8")
    assert "niente trattino" in text and "pro_max" in text

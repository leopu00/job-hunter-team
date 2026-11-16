"""The two texts of a budget below the least a team needs are in the seven languages, with the same placeholders as English.

Run:
    pytest tests/test_budget_below_min_texts.py -v
"""
import json
import re
from pathlib import Path

import pytest

LOCALES = Path(__file__).resolve().parent.parent / "shared" / "locales"
LANGS = ("en", "it", "fr", "de", "es", "pt", "hu")
KEYS = ("wizard.budget.below_min", "wizard.budget.below_min_note")


def _catalog(lang):
    return json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("lang", LANGS)
@pytest.mark.parametrize("key", KEYS)
def test_the_text_exists_and_has_the_placeholders_of_english(lang, key):
    text = _catalog(lang)[key]
    assert text.strip()
    assert re.findall(r"%[a-z]", text) == re.findall(r"%[a-z]", _catalog("en")[key])


@pytest.mark.parametrize("key", KEYS)
def test_the_european_portuguese_says_equipa_and_not_equipe(key):
    assert "equipa" in _catalog("pt")[key].lower()
    assert "equipe" not in _catalog("pt")[key].lower()

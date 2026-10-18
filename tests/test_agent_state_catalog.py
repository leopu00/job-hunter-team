"""shared/agent-state/catalog.json: one sentence per state and per reason, in 7 languages.

The reason of a state is a code chosen by shared/skills/agent_state.py; what
the person reads is this table, so a code without a sentence in a language is
a hole in the page, and a sentence nobody can reach is dead weight.
"""
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = json.loads((ROOT / "shared/agent-state/catalog.json").read_text(encoding="utf-8"))
LANGUAGES = ("it", "en", "de", "es", "fr", "hu", "pt")

spec = importlib.util.spec_from_file_location("agent_state_for_catalog", ROOT / "shared/skills/agent_state.py")
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

PLACEHOLDER = re.compile(r"\{[a-z]+\}")


def texts():
    for code, entry in CATALOG["states"].items():
        yield "state", code, entry["text"]
    for code, entry in CATALOG["reasons"].items():
        yield "reason", code, entry["text"]


def test_the_catalog_declares_the_seven_languages():
    assert tuple(CATALOG["languages"]) == LANGUAGES


def test_every_code_has_a_sentence_in_every_language():
    for kind, code, text in texts():
        assert tuple(text) == LANGUAGES, (kind, code)
        for lang, sentence in text.items():
            assert isinstance(sentence, str) and sentence.strip(), (kind, code, lang)


def test_a_sentence_keeps_the_same_placeholders_in_every_language():
    for kind, code, text in texts():
        wanted = sorted(PLACEHOLDER.findall(text["it"]))
        for lang, sentence in text.items():
            assert sorted(PLACEHOLDER.findall(sentence)) == wanted, (kind, code, lang)
            assert set(PLACEHOLDER.findall(sentence)) <= {"{t}", "{d}"}, (kind, code, lang)


def test_the_states_are_the_modules_states():
    assert set(CATALOG["states"]) == set(module.STATES)
    for code, entry in CATALOG["states"].items():
        assert entry["icon"] and entry["tone"] in {"green", "neutral", "amber", "blue", "red", "grey"}, code


def test_every_reason_the_module_emits_has_a_sentence_and_nothing_else_hangs_around():
    emitted = {r for rs in module.REASONS.values() for r in rs}
    absent = set(CATALOG["not_emitted_by_the_module"])
    assert set(CATALOG["reasons"]) == emitted | absent
    assert not (emitted & absent)
    assert absent == set(module.NOT_EMITTED_REASONS)


def test_only_a_login_that_needs_the_person_is_red():
    reds = {code for code, entry in CATALOG["reasons"].items() if entry.get("tone") == "red"}
    assert reds == {"accesso_scaduto"}
    assert not any(entry["tone"] == "red" for entry in CATALOG["states"].values())

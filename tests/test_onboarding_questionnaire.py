"""The Assistant's questionnaire as data (shared/config/onboarding-questionnaire.json): every choice has its words in the
seven languages, writes only what the canonical profile (shared/config/profile-schema.ts) has, and the steps that depend
on the role offer the specialties the schema allows for it.
Run with: pytest tests/test_onboarding_questionnaire.py -v
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "shared" / "config" / "onboarding-questionnaire.json").read_text(encoding="utf-8"))
SCHEMA = (ROOT / "shared" / "config" / "profile-schema.ts").read_text(encoding="utf-8")
LANGS = ["it", "en", "de", "fr", "es", "hu", "pt"]
TEXTS = {lang: json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8")) for lang in LANGS}
STEPS = {step["id"]: step for step in DATA["steps"]}


def schema_specialties() -> dict[str, list[str]]:
    block = SCHEMA.split("TARGET_ROLE_SPECIALTIES", 1)[1].split("};", 1)[0]
    found = {}
    for category, body in re.findall(r"\b([a-z]+): \[(.*?)\]", block, re.S):
        found[category] = re.findall(r'"([a-z_]+)"', body)
    return found


def schema_profile_fields() -> set[str]:
    body = SCHEMA.split("export const CandidateProfileSchema", 1)[1].split("export type CandidateProfileCanonical", 1)[0]
    return set(re.findall(r"^\s{4}([a-z_]+): z\.", body, re.M))


def test_the_steps_are_the_thirteen_in_order():
    assert [step["id"] for step in DATA["steps"]] == [
        "role", "specialty_sw", "specialty_data", "specialty_pm", "specialty_gen", "experience", "current_status",
        "mode", "where", "relocation", "contract", "salary", "company",
    ]
    assert all(step["key"] == f"onb.{step['id']}" for step in DATA["steps"])


def test_the_specialty_steps_offer_what_the_schema_allows_for_the_roles_they_follow():
    allowed = schema_specialties()
    assert set(allowed) >= {"software", "data", "product", "design", "business", "security", "other"}
    for sid in ("specialty_sw", "specialty_data", "specialty_pm", "specialty_gen"):
        step = STEPS[sid]
        categories = step["when"]["in"]
        assert step["when"]["step"] == "role"
        for category in categories:
            assert [option["id"] for option in step["options"]] == allowed[category], (sid, category)
    covered = [category for sid in ("specialty_sw", "specialty_data", "specialty_pm", "specialty_gen") for category in STEPS[sid]["when"]["in"]]
    assert sorted(covered) == sorted(option["id"] for option in STEPS["role"]["options"]), "every role has exactly one specialty step"


def test_a_choice_writes_only_fields_that_exist_in_the_canonical_profile():
    fields = schema_profile_fields()
    assert {"target_role_category_id", "target_specialty", "experience_years", "seniority_target", "target_role", "location",
            "location_preferences"} <= fields
    assert re.search(r'key: "preferences", kind: "key_points"', SCHEMA), "the recommended block the preferences go to"
    for step in DATA["steps"]:
        for option in step["options"]:
            effect = option["effect"]
            assert set(effect) <= {"set", "add", "preference", "ask"}, (step["id"], option["id"])
            assert effect, (step["id"], option["id"])
            for field in (*effect.get("set", {}), *effect.get("add", {}), *effect.get("ask", [])):
                assert field in fields, (step["id"], option["id"], field)
            if "preference" in effect:
                assert effect["preference"] == {"block": "preferences"}
            if "free_text" in option:
                assert option["free_text"]["field"] in fields
    for category in ("software", "data", "product", "design", "business", "security", "other"):
        assert {"set": {"target_role_category_id": category}} == next(o["effect"] for o in STEPS["role"]["options"] if o["id"] == category)


def test_the_values_a_choice_sets_are_values_the_schema_accepts():
    for option in STEPS["experience"]["options"]:
        effect = option["effect"]
        if "set" in effect:
            assert isinstance(effect["set"]["experience_years"], int) and effect["set"]["experience_years"] >= 0
            assert isinstance(effect["set"]["seniority_target"], str) and effect["set"]["seniority_target"]
        else:
            assert option["id"] == "career" and effect == {"ask": ["experience_years", "seniority_target"]}
    for option in STEPS["where"]["options"]:
        effect = option["effect"]
        if "add" in effect:
            assert all(isinstance(value, str) and value for values in effect["add"].values() for value in values)
        else:
            assert effect == {"ask": ["location"]}


def keys_of(step: dict) -> list[str]:
    keys = [f"{step['key']}.object", f"{step['key']}.text", *(f"{step['key']}.opt.{option['id']}" for option in step["options"])]
    keys += [option["free_text"]["prompt_key"] for option in step["options"] if "free_text" in option]
    return keys


@pytest.mark.parametrize("lang", LANGS)
def test_every_step_and_choice_has_its_words_in_every_language(lang):
    texts = TEXTS[lang]
    for step in DATA["steps"]:
        for key in keys_of(step):
            assert isinstance(texts.get(key), str) and texts[key].strip(), f"{lang}: {key}"
        labels = [texts[f"{step['key']}.opt.{option['id']}"] for option in step["options"]]
        assert len(set(labels)) == len(labels), f"{lang}: {step['id']} has two choices worded alike"
        assert all(len(label) <= 60 for label in labels), f"{lang}: {step['id']} a choice over 60 characters"
        assert len(texts[f"{step['key']}.object"]) <= 120, f"{lang}: {step['id']} title over 120 characters"


def test_the_seven_languages_carry_the_same_questionnaire_keys():
    keys = {lang: {key for key in TEXTS[lang] if key.startswith("onb.")} for lang in LANGS}
    expected = {key for step in DATA["steps"] for key in keys_of(step)}
    for lang in LANGS:
        assert keys[lang] == expected, (lang, sorted(keys[lang] ^ expected)[:5])
    assert len(expected) == 103


def test_the_sentences_of_the_other_languages_are_not_the_english_ones_left_in_place():
    english = TEXTS["en"]
    sentences = [f"{step['key']}.{part}" for step in DATA["steps"] for part in ("object", "text")]
    for lang in LANGS:
        if lang == "en":
            continue
        same = [key for key in sentences if TEXTS[lang][key] == english[key]]
        assert not same, (lang, same[:5])

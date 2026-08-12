"""Regression gates for canonical onboarding role-category IDs.

The old wizard discarded its stable option ID, persisted a mixed-language
display label as ``target_role`` and repeated that localized label in the LLM
context.  These tests pin the approved forward-only contract before the fix.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTED = ROOT / "game" / "scripts" / "setup" / "scripted_onboarding.gd"
PROFILE_SAVE = (
    ROOT / "game" / "scripts" / "backend" / "payloads" / "profile_save.py"
)


def test_new_wizard_choice_persists_only_the_canonical_category_id():
    source = SCRIPTED.read_text(encoding="utf-8")

    assert "const TARGET_ROLE_CATEGORY_IDS := [" in source
    assert '_draft["target_role_category_id"] = id' in source
    assert 'var roles := {"software": "Software Engineering"' not in source
    assert '_draft["target_role"] =' not in source
    assert "CONTEXT_SCHEMA_VERSION := 3" in source


def test_model_context_strips_the_localized_role_label():
    source = SCRIPTED.read_text(encoding="utf-8")

    assert "func _model_answers() -> Array:" in source
    assert 'if str(clean.get("topic", clean.get("step", ""))) == "role":' in source
    assert 'clean.erase("label")' in source
    assert '"answers": _model_answers()' in source
    assert "for item in _model_answers():" in source


def test_profile_writer_validates_category_and_specialty_as_a_pair():
    source = PROFILE_SAVE.read_text(encoding="utf-8")

    assert "TARGET_ROLE_SPECIALTIES = {" in source
    assert "category = data.get('target_role_category_id')" in source
    assert "specialty = data.get('target_specialty')" in source
    assert "if category is not None:" in source
    assert "if category not in TARGET_ROLE_SPECIALTIES:" in source
    assert "if specialty not in TARGET_ROLE_SPECIALTIES[category]:" in source
    assert "prof['target_role_category_id'] = category" in source
    assert "prof['target_specialty'] = specialty" in source


def test_legacy_generated_values_are_read_only_specialty_routing_aliases():
    source = SCRIPTED.read_text(encoding="utf-8")

    assert "const LEGACY_TARGET_ROLE_CATEGORIES := {" in source
    assert '"Software Engineering": "software"' in source
    assert '"Data / AI": "data"' in source
    assert '"Product / Project Management": "product"' in source
    assert "func _target_role_category_id() -> String:" in source
    assert "LEGACY_TARGET_ROLE_CATEGORIES.get(" in source
    # Reading an alias must not turn it into a migration during load/export.
    assert '_draft["target_role_category_id"] = _target_role_category_id()' not in source

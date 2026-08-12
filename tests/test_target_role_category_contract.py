"""Regression gates for canonical onboarding role-category IDs.

The old wizard discarded its stable option ID, persisted a mixed-language
display label as ``target_role`` and repeated that localized label in the LLM
context.  These tests pin the approved forward-only contract before the fix.
"""

import base64
import ast
import json
from pathlib import Path
import subprocess
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
SCRIPTED = ROOT / "game" / "scripts" / "setup" / "scripted_onboarding.gd"
PROFILE_SAVE = (
    ROOT / "game" / "scripts" / "backend" / "payloads" / "profile_save.py"
)
PROFILE_VALIDATOR = ROOT / "shared" / "skills" / "validate_profile.py"


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
    assert 'if str(clean.get("step", "")) == "role":' in source
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


def _literal_assignment(path: Path, name: str):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == name
            for target in node.targets
        ):
            return ast.literal_eval(node.value)
    raise AssertionError(f"{name} not found in {path}")


def test_profile_writer_and_runtime_validator_share_the_exact_vocabulary():
    assert _literal_assignment(PROFILE_SAVE, "TARGET_ROLE_SPECIALTIES") == (
        _literal_assignment(PROFILE_VALIDATOR, "TARGET_ROLE_SPECIALTIES")
    )


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


def _run_profile_writer(tmp_path: Path, initial: dict, update: dict):
    profile = tmp_path / "candidate_profile.yml"
    profile.write_text(
        yaml.safe_dump(initial, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    encoded = base64.b64encode(json.dumps(update).encode()).decode()
    source = PROFILE_SAVE.read_text(encoding="utf-8") % encoded
    source = source.replace(
        "path = '/jht_home/profile/candidate_profile.yml'",
        f"path = {str(profile)!r}",
    )
    result = subprocess.run(
        [sys.executable, "-c", source],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        timeout=10,
    )
    saved = yaml.safe_load(profile.read_text(encoding="utf-8"))
    return result, saved, profile


def test_profile_writer_keeps_free_text_and_writes_the_canonical_pair(tmp_path):
    result, saved, _ = _run_profile_writer(
        tmp_path,
        {"name": "Ada", "target_role": "Software Engineering"},
        {
            "target_role_category_id": "software",
            "target_specialty": "fullstack",
        },
    )

    assert result.returncode == 0, result.stderr
    assert saved["target_role"] == "Software Engineering"
    assert saved["target_role_category_id"] == "software"
    assert saved["target_specialty"] == "fullstack"


def test_profile_writer_rejects_an_invalid_pair_before_touching_the_file(tmp_path):
    initial = {"name": "Ada", "target_role": "Data Scientist"}
    result, saved, profile = _run_profile_writer(
        tmp_path,
        initial,
        {
            "target_role_category_id": "software",
            "target_specialty": "research",
        },
    )

    assert result.returncode == 2
    assert saved == initial
    assert list(profile.parent.glob(profile.name + ".bak-*")) == []


def test_legacy_specialty_without_category_is_not_backfilled(tmp_path):
    result, saved, _ = _run_profile_writer(
        tmp_path,
        {"name": "Ada", "target_role": "Data / AI"},
        {"name": "Ada Lovelace", "target_specialty": "research"},
    )

    assert result.returncode == 0, result.stderr
    assert saved["name"] == "Ada Lovelace"
    assert saved["target_role"] == "Data / AI"
    assert "target_role_category_id" not in saved
    assert "target_specialty" not in saved


def _canonical_profile(**extra):
    return {
        "name": "Ada",
        "target_role": "Backend Engineer",
        "location": "Rome",
        "experience_years": 3,
        "has_degree": True,
        "seniority_target": "mid",
        "skills": {"primary": ["Python"]},
        "languages": [{"language": "English", "level": "C1"}],
        **extra,
    }


def _validate_profile(tmp_path: Path, profile: dict):
    path = tmp_path / "profile.yml"
    path.write_text(yaml.safe_dump(profile, sort_keys=False), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(PROFILE_VALIDATOR), str(path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
        timeout=10,
    )


def test_runtime_validator_accepts_the_pair_and_legacy_absence(tmp_path):
    pair = _validate_profile(
        tmp_path,
        _canonical_profile(
            target_role_category_id="software", target_specialty="backend"
        ),
    )
    legacy = _validate_profile(
        tmp_path, _canonical_profile(target_role="Software Engineering")
    )

    assert pair.returncode == 0, pair.stderr
    assert legacy.returncode == 0, legacy.stderr


def test_runtime_validator_rejects_invalid_or_orphan_specialty(tmp_path):
    invalid_pair = _validate_profile(
        tmp_path,
        _canonical_profile(
            target_role_category_id="software", target_specialty="research"
        ),
    )
    orphan = _validate_profile(
        tmp_path, _canonical_profile(target_specialty="backend")
    )

    assert invalid_pair.returncode == 1
    assert "invalid for target_role_category_id" in invalid_pair.stderr
    assert orphan.returncode == 1
    assert "requires target_role_category_id" in orphan.stderr

"""Regression gates for canonical onboarding role-category IDs.

The old wizard discarded its stable option ID, persisted a mixed-language
display label as ``target_role`` and repeated that localized label in the LLM
context.  These tests pin the approved forward-only contract before the fix.

Until 08/10 nine more tests pinned the Godot side (game/: the wizard in
scripted_onboarding.gd and the profile_save.py payload that wrote the pair).
Godot is abandoned and they went with it: what stays is the runtime validator.
"""

from pathlib import Path
import subprocess
import sys

import yaml


ROOT = Path(__file__).resolve().parents[1]
PROFILE_VALIDATOR = ROOT / "shared" / "skills" / "validate_profile.py"


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

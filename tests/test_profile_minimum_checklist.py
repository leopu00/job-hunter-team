"""`validate_profile.py --minimum`: what the team needs to start, read where the app reads it."""

from __future__ import annotations

import copy
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "shared" / "skills" / "validate_profile.py"
FIXTURE = ROOT / "cli" / "tests" / "fixtures" / "profile-synthetic.yml"
COMPLETION = ROOT / "web" / "lib" / "profile-completion.ts"


def _check(tmp_path: Path, profile: dict, *flags: str) -> dict:
    path = tmp_path / "candidate_profile.yml"
    path.write_text(yaml.safe_dump(profile, allow_unicode=True), encoding="utf-8")
    done = subprocess.run(
        [sys.executable, "-I", str(VALIDATOR), str(path), "--json", *flags],
        capture_output=True, text=True, timeout=30, check=False,
    )
    return json.loads(done.stdout)


def _fixture() -> dict:
    return yaml.safe_load(FIXTURE.read_text(encoding="utf-8"))


def test_the_synthetic_profile_has_everything_the_team_needs(tmp_path: Path):
    verdict = _check(tmp_path, _fixture(), "--strict", "--minimum")
    assert verdict["ok"] is True and verdict["missing"] == []


def test_without_the_flag_the_output_is_the_one_it_always_was(tmp_path: Path):
    bare = {"name": "X", "target_role": "Y", "location": "Z", "experience_years": 1, "has_degree": True,
            "seniority_target": "mid", "skills": {"primary": ["a"]}, "languages": [{"language": "en", "level": "C1"}]}
    verdict = _check(tmp_path, bare, "--strict")
    assert verdict["ok"] is True and "missing" not in verdict


def _without(profile: dict, *paths: tuple[str, ...]) -> dict:
    out = copy.deepcopy(profile)
    for path in paths:
        node = out
        for key in path[:-1]:
            node = node.get(key, {})
        node.pop(path[-1], None)
    return out


@pytest.mark.parametrize(
    ("missing", "paths"),
    (
        ("name", [("name",), ("candidate", "name")]),
        ("email", [("candidate", "contacts")]),
        ("target_role", [("target_role",), ("candidate", "target_role")]),
        ("location", [("location",)]),
        ("experience_years", [("experience_years",)]),
        ("skills", [("skills",)]),
        ("languages", [("languages",)]),
        ("experience", [("candidate", "experience")]),
        ("education", [("candidate", "education")]),
    ),
)
def test_each_missing_field_is_named_and_stops_the_profile(tmp_path: Path, missing: str, paths: list):
    verdict = _check(tmp_path, _without(_fixture(), *paths), "--minimum")
    assert verdict["ok"] is False
    assert missing in verdict["missing"]
    assert f"missing for the team to start: {missing}" in verdict["errors"]


def test_one_skill_is_not_enough_and_two_are(tmp_path: Path):
    profile = _fixture()
    profile["skills"] = {"primary": ["Python"]}
    assert "skills" in _check(tmp_path, profile, "--minimum")["missing"]
    profile["skills"] = {"primary": ["Python"], "secondary": ["SQL"]}
    assert "skills" not in _check(tmp_path, profile, "--minimum")["missing"]


def test_the_places_the_app_reads_count_and_a_root_email_does_not(tmp_path: Path):
    # the app takes the email from candidate.contacts or personal, never from the root
    profile = _without(_fixture(), ("candidate", "contacts"))
    profile["email"] = "candidate@example.invalid"
    assert "email" in _check(tmp_path, profile, "--minimum")["missing"]
    profile["personal"] = {"email": "candidate@example.invalid"}
    assert "email" not in _check(tmp_path, profile, "--minimum")["missing"]
    # the first of target_roles is a target role, and the flat experience/education lists count
    flat = _without(_fixture(), ("target_role",), ("candidate",))
    flat["target_roles"] = ["Backend Engineer"]
    flat["personal"] = {"email": "candidate@example.invalid"}
    flat["experience"] = [{"company": "Example Co"}]
    flat["education"] = [{"institution": "Example University"}]
    assert _check(tmp_path, flat, "--minimum")["missing"] == []


def test_a_profile_the_checklist_passes_is_never_one_the_apps_required_fields_refuse(tmp_path: Path):
    """The app's required fields (profile-completion.ts) are the floor this checklist must not be under."""
    source = COMPLETION.read_text(encoding="utf-8")
    required = re.findall(r'key: "([a-z_]+)",\s*level: "required"', source)
    assert set(required) >= {"name", "email", "target_role", "location", "experience_years", "skills", "languages"}
    # the app's key -> where a profile that lacks it is written
    where = {
        "name": [("name",), ("candidate", "name")],
        "email": [("candidate", "contacts")],
        "target_role": [("target_role",), ("candidate", "target_role")],
        "location": [("location",)],
        "experience_years": [("experience_years",)],
        "seniority_target": [("seniority_target",)],
        "skills": [("skills",)],
        "languages": [("languages",)],
    }
    assert set(required) <= set(where), f"a new required field of the app: {set(required) - set(where)}"
    for key in required:
        verdict = _check(tmp_path, _without(_fixture(), *where[key]), "--strict", "--minimum")
        assert verdict["ok"] is False, f"a profile without {key} must not pass"

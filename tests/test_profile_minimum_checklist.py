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
SHARED = ROOT / "shared" / "config" / "profile-minimum.json"
GAME_STATUS = ROOT / "game" / "scripts" / "backend" / "payloads" / "profile_status.py"


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
        ("seniority_target", [("seniority_target",)]),
        ("skills", [("skills",)]),
        ("languages", [("languages",)]),
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


EMAIL = "candidate@example.invalid"


@pytest.mark.parametrize(
    ("form", "place"),
    (
        ("root email (schema, app)", {"email": EMAIL}),
        ("root contacts.email (schema)", {"contacts": {"email": EMAIL}}),
        ("candidate.contacts.email (the Assistant's)", {"candidate": {"contacts": {"email": EMAIL}}}),
        ("personal.email", {"personal": {"email": EMAIL}}),
        ("positioning.contacts.email (app hasEmail)", {"positioning": {"contacts": {"email": EMAIL}}}),
    ),
)
def test_the_email_counts_in_every_place_the_schema_or_the_app_accepts(tmp_path: Path, form: str, place: dict):
    profile = _without(_fixture(), ("candidate", "contacts"))
    assert "email" in _check(tmp_path, profile, "--minimum")["missing"]
    for key, value in place.items():
        if key == "candidate":
            profile["candidate"] = {**profile.get("candidate", {}), **value}
        else:
            profile[key] = value
    verdict = _check(tmp_path, profile, "--strict", "--minimum")
    assert "email" not in verdict["missing"], form
    assert verdict["ok"] is True, form


@pytest.mark.parametrize(
    "emptied",
    (
        {"email": ""},
        {"email": "   "},
        {"email": None},
        {"contacts": {}},
        {"contacts": {"email": ""}},
        {"contacts": EMAIL},  # not a mapping
        {"personal": {"email": ""}},
        {"positioning": {"contacts": {"email": ""}}},
        {"positioning": {"email": EMAIL}},  # the app reads positioning.contacts.email, not positioning.email
    ),
)
def test_an_empty_or_misplaced_email_is_still_missing(tmp_path: Path, emptied: dict):
    profile = {**_without(_fixture(), ("candidate", "contacts")), **emptied}
    assert "email" in _check(tmp_path, profile, "--minimum")["missing"]


def test_experience_and_education_are_recommended_and_do_not_stop_the_team(tmp_path: Path):
    # decision of 2026-06-06: the team starts without them (the app, the Assistant's skill and the game agree)
    bare = _without(_fixture(), ("candidate", "experience"), ("candidate", "education"))
    verdict = _check(tmp_path, bare, "--strict", "--minimum")
    assert verdict["ok"] is True and verdict["missing"] == []


def test_the_first_target_role_counts(tmp_path: Path):
    flat = _without(_fixture(), ("target_role",), ("candidate", "target_role"))
    flat["target_roles"] = ["Backend Engineer"]
    assert _check(tmp_path, flat, "--minimum")["missing"] == []


def _shared() -> dict:
    return json.loads(SHARED.read_text(encoding="utf-8"))


def test_the_checklist_is_the_shared_list_and_the_apps_required_fields(tmp_path: Path):
    """One list, read by the validator, the app, the game: a field added to one and not the others is red here."""
    shared = _shared()["required"]
    # the validator: what an empty profile lacks, in its own order
    assert _check(tmp_path, {}, "--minimum")["missing"] == shared
    # the app: the keys of PROFILE_REQUIREMENTS at level required, in their order
    source = COMPLETION.read_text(encoding="utf-8")
    assert re.findall(r'key: "([a-z_]+)",\s*level: "required"', source) == shared
    # the game's wizard: the keys of the `required` dict of its status payload
    payload = GAME_STATUS.read_text(encoding="utf-8")
    block = re.search(r"required = dict\((.*?)\n\)", payload, re.S)
    assert block is not None
    assert re.findall(r"^\s+([a-z_]+)=", block.group(1), re.M) == shared


@pytest.mark.parametrize("case", _shared()["cases"], ids=lambda case: case["name"])
def test_the_validator_gives_the_answer_the_shared_cases_expect(tmp_path: Path, case: dict):
    # web/lib/profile-minimum-parity.test.ts reads the same cases and asks the app the same
    assert _check(tmp_path, case["profile"], "--minimum")["missing"] == case["missing"]

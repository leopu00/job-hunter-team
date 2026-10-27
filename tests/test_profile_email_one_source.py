"""The email of the candidate profile has ONE list of places, read by the checklist and by the applications.

`jht profile import` (validate_profile.py --minimum) used to accept an email in places the application
recipes did not read, and the recipes read places the checklist did not know. Both now take them from
shared/skills/profile_email.py.

Run with: pytest tests/test_profile_email_one_source.py -v
"""

from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
EMAIL = "candidate@example.invalid"

FORMS = {
    "contacts.email": {"contacts": {"email": EMAIL}},
    "email": {"email": EMAIL},
    "candidate.contacts.email": {"candidate": {"contacts": {"email": EMAIL}}},
    "personal.email": {"personal": {"email": EMAIL}},
    "positioning.contacts.email": {"positioning": {"contacts": {"email": EMAIL}}},
}
NOT_AN_EMAIL = (
    {}, {"email": ""}, {"email": "  "}, {"email": None}, {"email": 7}, {"contacts": EMAIL},
    {"contacts": {"email": ""}}, {"positioning": {"email": EMAIL}}, {"candidate": {"email": EMAIL}},
)


def _load(name: str):
    sys.path.insert(0, str(SKILLS))
    try:
        return importlib.import_module(name)
    finally:
        sys.path.remove(str(SKILLS))


def _minimum_says_email_missing(tmp_path: Path, profile: dict) -> bool:
    path = tmp_path / "candidate_profile.yml"
    path.write_text(yaml.safe_dump(profile), encoding="utf-8")
    done = subprocess.run([sys.executable, "-I", str(SKILLS / "validate_profile.py"), str(path), "--json", "--minimum"],
                          capture_output=True, text=True, timeout=30, check=False)
    return "email" in json.loads(done.stdout)["missing"]


@pytest.mark.parametrize("form", sorted(FORMS))
def test_every_reader_finds_the_email_in_every_place_the_checklist_accepts(tmp_path: Path, form: str):
    profile = FORMS[form]
    assert _minimum_says_email_missing(tmp_path, profile) is False
    assert _load("profile_email").profile_email(profile) == EMAIL
    assert _load("profile_facts").profile_value(profile, "email") == EMAIL
    assert _load("profile_review")._email(profile) == EMAIL


@pytest.mark.parametrize("profile", NOT_AN_EMAIL, ids=lambda p: json.dumps(p)[:40])
def test_where_the_checklist_finds_none_no_reader_does(tmp_path: Path, profile: dict):
    assert _minimum_says_email_missing(tmp_path, profile) is True
    assert _load("profile_email").profile_email(profile) is None
    assert _load("profile_facts").profile_value(profile, "email") is None
    assert _load("profile_review")._email(profile) == ""


def test_the_first_place_wins_in_the_order_the_recipes_always_used():
    profile_email = _load("profile_email")
    both = {"contacts": {"email": "first@example.invalid"}, "email": "second@example.invalid",
            "personal": {"email": "third@example.invalid"}}
    assert profile_email.profile_email(both) == "first@example.invalid"
    assert profile_email.profile_email({"email": " second@example.invalid ", "personal": both["personal"]}) == "second@example.invalid"
    # an empty place does not hide the next one
    assert profile_email.profile_email({"contacts": {"email": ""}, "personal": {"email": EMAIL}}) == EMAIL


def test_the_recipes_take_their_email_places_from_the_one_list():
    flow = _load("apply_flow")
    paths = _load("profile_email").EMAIL_PATHS
    # every place is a known "email" fact of the flow, so a recipe's own paths and the aliases agree
    assert all(flow._CORE_PATH_FACTS[path] == "email" for path in paths)
    assert flow.GreenhouseRecipe._CORE_CONTROLS["email"] == paths
    assert flow.LeverRecipe._CORE_NAMES["email"] == paths
    generic = _load("apply_generic")
    assert [row[2] for row in generic._CORE_FIELDS if row[0] == "email"] == [paths]


@pytest.mark.parametrize("name", [
    "apply_flow", "apply_generic", "workday_apply", "email_application", "profile_facts", "profile_review", "validate_profile",
])
def test_no_module_keeps_its_own_list_of_email_places(name: str):
    text = (SKILLS / f"{name}.py").read_text(encoding="utf-8")
    assert not re.search(r'\(\(?"contacts",\s*"email"\)?,\s*\("email",\)\)', text), name
    assert '.get("email") or' not in text, name

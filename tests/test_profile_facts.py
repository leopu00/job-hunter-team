"""profile_facts: where the CLOSER's recipes read a core fact, and the question when it is not there.

Origin: 1967 stopped on "First Name" with a profile holding only `name`.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

from profile_facts import CORE_ALIASES, core_answer_request, profile_value  # noqa: E402


@pytest.mark.parametrize(
    ("profile", "fact", "expected"),
    [
        ({"first_name": "Jane"}, "first name", "Jane"),
        ({"given_name": " Jane  "}, "first name", "Jane"),
        ({"contacts": {"first_name": "Jane"}}, "first name", "Jane"),
        ({"surname": "Example"}, "last name", "Example"),
        ({"name": "Jane Example"}, "full name", "Jane Example"),
        ({"contacts": {"email": "jane@example.invalid"}}, "email", "jane@example.invalid"),
        ({"email": "jane@example.invalid"}, "email", "jane@example.invalid"),
    ],
)
def test_aliases(profile, fact, expected):
    assert profile_value(profile, fact) == expected


@pytest.mark.parametrize("fact", ["first name", "last name"])
def test_a_full_name_is_never_split(fact):
    assert profile_value({"name": "María José García López"}, fact) is None


def test_first_and_last_are_never_joined():
    assert profile_value({"first_name": "Jane", "last_name": "Example"}, "full name") is None


@pytest.mark.parametrize("value", [True, 0, {"x": 1}, ["Jane"], "", "   "])
def test_only_real_strings_count(value):
    assert profile_value({"first_name": value}, "first name") is None


def test_unknown_fact_and_non_mapping():
    assert profile_value({"first_name": "Jane"}, "nickname") is None
    assert profile_value(None, "first name") is None


def test_core_answer_request_is_a_text_question_under_the_label_key():
    assert core_answer_request("First Name *") == {
        "key": "first name", "label": "First Name", "field_type": "text", "options": [],
    }
    assert core_answer_request("E-mail", "email")["field_type"] == "email"
    assert core_answer_request("Nome", "checkbox")["field_type"] == "text"
    assert core_answer_request("  ") is None


def test_every_alias_path_is_a_tuple_of_keys():
    for fact, paths in CORE_ALIASES.items():
        assert paths and all(isinstance(p, tuple) and p and all(isinstance(k, str) for k in p) for p in paths), fact

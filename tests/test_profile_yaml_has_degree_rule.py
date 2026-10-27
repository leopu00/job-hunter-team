"""The Assistente writes `has_degree` from the education, never as a placeholder.

On 08/10 a tester saw the Assistente write `has_degree: false` into the
profile while it was still asking the user whether to count "no degree". The
validator (shared/skills/validate_profile.py) requires a boolean and the
profile-yaml skill says not to go on until the profile is valid, while the
same skill says to leave unknown fields empty: with nothing telling it where
the value comes from, the agent filled `false` to pass validation. The Scorer
then reads that `false` against the degree requirements of every position.

The rule lives in the skill that governs writing the profile, in all seven
languages: true from a degree in `education`, false only after the user said
so, and a value that is not known is left out, not filled.

Since then `has_degree` is optional (absent is "not declared", never "no"; the
eight fields of the app are enough): the skills no longer list it among the
mandatory fields and no longer tell the Assistente to stop and ask when the
validator complains about it. The validator does not complain about it any
more, so a trigger on that ERROR would never fire, and an Assistente that
believes the field is required would go on asking a question that blocks nothing.
"""

from __future__ import annotations

from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "agents" / "_skills" / "profile-yaml"
LANGS = ("", ".it", ".es", ".fr", ".de", ".hu", ".pt")


def _section(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    start = [i for i, line in enumerate(text.splitlines()) if line.startswith("## 🎓 `has_degree`")]
    assert len(start) == 1, f"{path.name}: {len(start)} has_degree sections"
    lines = text.splitlines()[start[0]:]
    end = next(i for i, line in enumerate(lines[1:], 1) if line.startswith("## "))
    return "\n".join(lines[:end])


@pytest.mark.parametrize("lang", LANGS, ids=lambda l: l or ".en")
def test_has_degree_comes_from_the_education_and_is_asked_not_filled(lang: str) -> None:
    section = _section(SKILL / f"SKILL{lang}.md")

    for needed in ("`education`", "`true`", "`false`", "Scorer"):
        assert needed in section, f"SKILL{lang}.md: the rule lacks {needed!r}"
    # the trigger "the only ERROR is has_degree: ask" is gone: it is not an error any more
    assert "`ERROR:`" not in section, f"SKILL{lang}.md: the rule still waits for an ERROR on has_degree"


def _comment_of(path: Path, key: str) -> str:
    lines = [l for l in path.read_text(encoding="utf-8").splitlines() if l.startswith(f"{key}:") and "#" in l]
    assert len(lines) == 1, f"{path.name}: {len(lines)} lines of {key!r} with a comment"
    return lines[0].split("#", 1)[1].strip()


@pytest.mark.parametrize("lang", LANGS, ids=lambda l: l or ".en")
def test_the_schema_says_it_is_optional_in_the_word_of_its_own_language(lang: str) -> None:
    schema = ROOT / "agents" / "_skills" / "profile-schema" / f"SKILL{lang}.md"
    optional = _comment_of(schema, "email").split()[0]  # the file's own word for "optional"
    mandatory = _comment_of(schema, "name").split()[0]
    degree = _comment_of(schema, "has_degree")

    assert degree.startswith(optional), f"{schema.name}: has_degree is not marked {optional!r}: {degree!r}"
    assert mandatory not in degree.split()[0], f"{schema.name}: has_degree is still {mandatory!r}"


@pytest.mark.parametrize("lang", LANGS, ids=lambda l: l or ".en")
def test_the_minimum_shape_does_not_list_it_as_required(lang: str) -> None:
    schema = ROOT / "agents" / "_skills" / "profile-schema" / f"SKILL{lang}.md"
    minimum = ROOT / "agents" / "_skills" / "profile-yaml" / f"SKILL{lang}.md"
    optional = _comment_of(schema, "email").split()[0]

    lines = [l for l in minimum.read_text(encoding="utf-8").splitlines() if l.startswith("has_degree:")]
    assert len(lines) == 1 and optional in lines[0], f"{minimum.name}: the minimum shape does not mark it {optional!r}"



def _profile_yaml(lang: str) -> list[str]:
    return (ROOT / "agents" / "_skills" / "profile-yaml" / f"SKILL{lang}.md").read_text(encoding="utf-8").splitlines()


@pytest.mark.parametrize("lang", LANGS, ids=lambda l: l or ".en")
def test_the_flag_waits_for_the_eight_fields_and_not_for_experience_or_degrees(lang: str) -> None:
    """The fourth checklist (profile-yaml: the minimum shape and the flag) says what the other three say
    (shared/config/profile-minimum.json): eight fields; experiences and degrees are recommended."""
    lines = _profile_yaml(lang)
    after_invalid = next(i for i, l in enumerate(lines) if l.startswith("- ") and "INVALID_PROFILE" in l)
    missing = [l for l in lines[after_invalid + 1:after_invalid + 4] if l.startswith("- ")]
    assert len(missing) == 1, f"SKILL{lang}.md: the flag has {len(missing)} 'missing' bullets, one is the eight fields"
    assert "`seniority_target`" in missing[0], f"SKILL{lang}.md: the eight fields lack seniority_target"
    # skills (≥2) and languages (≥1): the old bullet also asked experiences (≥1) and degrees (≥1)
    assert missing[0].count("≥1") == 1 and missing[0].count("≥2") == 1, missing[0]


@pytest.mark.parametrize("lang", LANGS, ids=lambda l: l or ".en")
def test_the_minimum_shape_names_the_eight_fields_and_marks_experience_and_education_as_extra(lang: str) -> None:
    lines = _profile_yaml(lang)
    # the first heading whose paragraph speaks of the frontend fallback and ready.flag: the minimum shape
    heading = next(i for i, l in enumerate(lines) if l.startswith("## ") and "ready.flag" in lines[i + 2])
    assert "`seniority_target`" in lines[heading + 2], f"SKILL{lang}.md: the minimum shape does not name the eight fields"
    for key in ("experience", "education"):
        entry = [l for l in lines if l.startswith(f"  {key}:") and "#" in l]
        assert len(entry) == 1 and ">= 1" not in entry[0], f"SKILL{lang}.md: {key} is still asked as at least one entry"

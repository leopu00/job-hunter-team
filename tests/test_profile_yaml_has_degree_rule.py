"""The Assistente writes `has_degree` from the education, never as a placeholder.

On 08/10 a tester saw the Assistente write `has_degree: false` into the
profile while it was still asking the user whether to count "no degree". The
validator (shared/skills/validate_profile.py) requires a boolean and the
profile-yaml skill says not to go on until the profile is valid, while the
same skill says to leave unknown fields empty: with nothing telling it where
the value comes from, the agent filled `false` to pass validation. The Scorer
then reads that `false` against the degree requirements of every position.

The rule now lives in the skill that governs writing the profile, in all
seven languages: true from a degree in `education`, false only after the
user said so, and a validation whose only ERROR is `has_degree` is answered
by asking, not by writing.
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

    for needed in ("`education`", "`true`", "`false`", "`ERROR:`", "Scorer"):
        assert needed in section, f"SKILL{lang}.md: the rule lacks {needed!r}"


def test_the_validator_still_requires_it() -> None:
    """The rule exists because of this line: if it goes, the rule can go too."""
    source = (ROOT / "shared" / "skills" / "validate_profile.py").read_text(encoding="utf-8")
    assert 'err("has_degree: boolean required")' in source

"""JHT-T351, the onboarding part, in the seven languages of the skills: residence and radius, the gaps said with what they mean and
never a gate, the two documents, no question asked twice.

Run:
    pytest tests/test_onboarding_skill_gaps_and_two_documents.py -v
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SUFFIX = {"en": "", "it": ".it", "de": ".de", "es": ".es", "fr": ".fr", "pt": ".pt", "hu": ".hu"}
GAPS = ("place_anywhere", "residence", "commute", "salary", "skills", "cv")


def _skill(name, lang):
    return (ROOT / "agents" / "_skills" / name / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")


def _section(text, emoji):
    start = text.index(f"\n## {emoji}")
    return text[start:text.index("\n## ", start + 4)]


@pytest.mark.parametrize("lang", SUFFIX)
def test_the_skill_asks_where_the_person_lives_and_how_far_they_travel(lang):
    place = _section(_skill("onboarding-flow", lang), "📍")
    assert "`residence`" in place and "`commute_max_km`" in place and "`null`" in place
    assert "`preferences.work_mode`" in place and "`preferences.relocation`" in place


@pytest.mark.parametrize("lang", SUFFIX)
def test_the_gaps_are_said_with_what_they_mean_and_a_choice_made_knowingly_goes_on(lang):
    text = _skill("onboarding-flow", lang)
    gaps = _section(text, "🧭")
    for gap in GAPS:
        assert re.search(rf"^\| `{gap}` \| \S", gaps, re.M), gap
    assert "`accept`" in gaps and '"accept": ["place_anywhere"]' in gaps and "`ready.flag`" in gaps
    # the REQUIRED checklist points to it before the flag
    required = _section(text, "🔴")
    assert "🧭" not in required and ("§" in required.split("\n\n")[1])
    ready = _skill("profile-yaml", lang)
    block = ready[ready.index("## `ready.flag`"):]
    block = block[:block.index("```bash")]
    assert "`gaps`" in block and "`accept`" in block


@pytest.mark.parametrize("lang", SUFFIX)
def test_the_two_documents_get_a_few_clear_chapters_and_only_what_is_missing_is_asked(lang):
    docs = _section(_skill("onboarding-flow", lang), "📄")
    chapters = re.findall(r"^\d\. ", docs, re.M)
    assert 3 <= len(chapters) <= 6
    assert "`gaps`" in docs


@pytest.mark.parametrize("lang", SUFFIX)
def test_a_question_is_not_asked_twice(lang):
    text = _skill("onboarding-flow", lang)
    again = _section(text, "🔁")
    assert "`asked`" in again and '"asked": ["residence"]' in again and "profile_gaps.py" in again
    assert "Bash(python3 /app/shared/skills/profile_gaps.py)" in text.split("---", 2)[1]

"""The Scout's prompts and skill in the seven languages send it to `scout_coverage.py next` before any minor source.

Real run (profile Swedish native + English fluent): 137 passes over 105 sources, the five Swedish portals touched once each,
the biggest never. The code now measures coverage (scout_coverage.py) and refuses «exhausted» while a core portal is short
(scout_exhaustion.py); this is the part the Scout reads: where to ask for the next portal, the rule core-before-minor, what
covers a portal and what closes one. Same needles in every language, so a translation cannot drop one.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SUFFIXES = ("", ".it", ".de", ".es", ".fr", ".pt", ".hu")
NEEDLES = ("scout-coverage", "scout_coverage.py next", "--query-kind", "--status closed", "scout_exhaustion.py check",
           "core_missing", "3")


def _prompt(suffix: str) -> str:
    return (REPO_ROOT / "agents" / "scout" / ("scout%s.md" % suffix)).read_text(encoding="utf-8")


@pytest.mark.parametrize("suffix", SUFFIXES)
def test_every_scout_prompt_sends_the_scout_to_the_plan_before_minor_sources(suffix):
    text = _prompt(suffix)
    for needle in NEEDLES:
        assert needle in text, "%s: %r" % (suffix or "en", needle)
    step3 = text[text.index("STEP 3 —"):text.index("STEP 4 —")]
    assert "scout_coverage.py next" in step3, "STEP 3 must carry the pointer, not only the paragraph below the block"


@pytest.mark.parametrize("suffix", SUFFIXES)
def test_the_skill_exists_in_every_language_with_the_same_commands(suffix):
    skill = (REPO_ROOT / "agents" / "_skills" / "scout-coverage" / ("SKILL%s.md" % suffix)).read_text(encoding="utf-8")
    assert skill.startswith("---\nname: scout-coverage\n")
    for needle in ("scout_coverage.py next", "scout_coverage.py plan", "scout_coverage.py status", "scout_pass_log.py pass",
                   "--status closed", "--query-kind", "scout_exhaustion.py check", "core_missing", "level_terms", "cities",
                   "role_language", "synonym", "plan_done"):
        assert needle in skill, "%s: %r" % (suffix or "en", needle)


def test_the_skill_is_shipped_to_the_scout():
    listed = (REPO_ROOT / "agents" / "scout" / "skills.list").read_text(encoding="utf-8").split()
    assert "scout-coverage" in listed


def test_the_commands_the_skill_names_exist_in_the_tools():
    """The skill must not teach a flag or a query kind the code refuses."""
    skills = REPO_ROOT / "shared" / "skills"
    coverage = (skills / "scout_coverage.py").read_text(encoding="utf-8")
    log = (skills / "scout_pass_log.py").read_text(encoding="utf-8")
    for sub in ("plan", "status", "next"):
        assert '"%s"' % sub in coverage
    for kind in ("role_language", "role", "synonym", "level", "city"):
        assert '"%s"' % kind in log
    for status in ("closed", "gone"):
        assert '"%s"' % status in log
    skill = (REPO_ROOT / "agents" / "_skills" / "scout-coverage" / "SKILL.md").read_text(encoding="utf-8")
    assert not re.search(r"(?i)\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", skill)       # no address in an example

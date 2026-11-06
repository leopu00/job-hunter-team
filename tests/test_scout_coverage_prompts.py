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
           "uncovered", "--status blocked", "scout_yield.py", "3", "praktik", "platsbanken_search.py", "--query-kind broad")


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
                   "--status closed", "--status blocked", "--query-kind", "scout_exhaustion.py check", "core_missing", "uncovered", "level_terms", "cities",
                   "role_language", "synonym", "plan_done", "broad", "broad_terms", "platsbanken_search.py", "boards --country",
                   "ats_board_search.py", "--drop-seniority", "--title-any", "dropped"):
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
    for kind in ("role_language", "role", "synonym", "level", "city", "broad"):
        assert '"%s"' % kind in log
    platsbanken = (skills / "platsbanken_search.py").read_text(encoding="utf-8")
    for flag in ("--q", "--city", "--no-experience", "--query-kind", "--log"):
        assert flag in platsbanken, flag
    assert '"boards"' in coverage
    board = (skills / "ats_board_search.py").read_text(encoding="utf-8")
    for flag in ("--provider", "--board", "--country", "--drop-seniority", "--title-any", "--log", "--query-kind"):
        assert flag in board, flag
    assert "broad_terms" in (skills / "scout_coverage_table.json").read_text(encoding="utf-8")
    for status in ("closed", "gone"):
        assert '"%s"' % status in log
    skill = (REPO_ROOT / "agents" / "_skills" / "scout-coverage" / "SKILL.md").read_text(encoding="utf-8")
    assert not re.search(r"(?i)\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b", skill)       # no address in an example


@pytest.mark.parametrize("suffix", SUFFIXES)
def test_every_scout_prompt_and_pass_log_skill_say_every_local_drop_gets_its_reason_in_bulk(suffix):
    """Field data of 02/11: 1080 ads read on a portal and 3 counted. The log has the reasons and a bulk line; the Scout must use them."""
    prompt = _prompt(suffix)
    paragraph = next(l for l in prompt.split("\n") if l.startswith("**") and "`scout-pass-log`" in l)
    for needle in ("`role`", "`area`", "--count N", "1080"):
        assert needle in paragraph, "%s: %r" % (suffix or "en", needle)
    skill = (REPO_ROOT / "agents" / "_skills" / "scout-pass-log" / ("SKILL%s.md" % suffix)).read_text(encoding="utf-8")
    for needle in ("--outcome role --count 640", "--status closed", "unexpl", "`role` \u00b7 `area`", "`broad`", "100000"):
        assert needle in skill, "%s: %r" % (suffix or "en", needle)
    log = (REPO_ROOT / "shared" / "skills" / "scout_pass_log.py").read_text(encoding="utf-8")
    for outcome in ("role", "area"):
        assert '"%s"' % outcome in log


# ── the profile that changes under the Scout (03/11) ────────────────────────

@pytest.mark.parametrize("suffix", SUFFIXES)
def test_every_scout_prompt_tells_it_to_read_the_profile_again_and_keep_what_it_found(suffix):
    text = _prompt(suffix)
    for needle in ("scout_coverage.py next --agent $MY_ID", "profile_version.py ack --agent $MY_ID", '"changed": true',
                   "roles", "places", "languages", "mode", "STEP 1", "STEP 2"):
        assert needle in text, "%s: %r" % (suffix or "en", needle)
    assert text.count("scout_coverage.py next --agent $MY_ID") >= 2, "the pointer in STEP 3 and the one in the paragraph"
    step3 = text[text.index("STEP 3 —"):text.index("STEP 4 —")]
    assert "scout_coverage.py next --agent $MY_ID" in step3


@pytest.mark.parametrize("suffix", SUFFIXES)
def test_the_skill_names_the_ack_and_may_run_it(suffix):
    skill = (REPO_ROOT / "agents" / "_skills" / "scout-coverage" / ("SKILL%s.md" % suffix)).read_text(encoding="utf-8")
    header = skill.split("---")[1]
    assert "Bash(python3 /app/shared/skills/profile_version.py *)" in header, suffix or "en"
    for needle in ("scout_coverage.py next --agent $MY_ID", "profile_version.py ack --agent $MY_ID", '"changed": true'):
        assert needle in skill, "%s: %r" % (suffix or "en", needle)


def test_the_tool_the_prompts_name_exists_and_takes_what_they_say():
    tool = (REPO_ROOT / "shared" / "skills" / "profile_version.py").read_text(encoding="utf-8")
    for needle in ('"check"', '"ack"', "--agent", '"roles"', '"places"', '"languages"', '"mode"'):
        assert needle in tool, needle
    coverage = (REPO_ROOT / "shared" / "skills" / "scout_coverage.py").read_text(encoding="utf-8")
    assert "--agent" in coverage and "profile_news" in coverage


@pytest.mark.parametrize("suffix", SUFFIXES)
def test_the_captain_prompt_says_saturated_only_at_full_coverage_and_measures_the_night_at_the_bar(suffix):
    """JHT-T187: the Captain sends a dry Scout to the next portal (`uncovered`), does not read an error as a dry market, and reports
    positions at the bar (scout_yield.py), in all seven languages."""
    text = (REPO_ROOT / "agents" / "capitano" / ("capitano%s.md" % suffix)).read_text(encoding="utf-8")
    for needle in ("`uncovered`", "scout_coverage.py next --agent", "`blocked`", "scout_yield.py --json", "`good`", "`pending`", "`below`", "70"):
        assert needle in text, "%s: %r" % (suffix or "en", needle)


@pytest.mark.parametrize("suffix", SUFFIXES)
def test_the_pass_log_skill_teaches_blocked_is_not_empty_and_the_three_empty_alert(suffix):
    skill = (REPO_ROOT / "agents" / "_skills" / "scout-pass-log" / ("SKILL%s.md" % suffix)).read_text(encoding="utf-8")
    for needle in ("--status blocked", "JHT_SCOUT_BLOCKED_PAUSE_H", "ALERT", "scout_coverage.py next"):
        assert needle in skill, "%s: %r" % (suffix or "en", needle)


def test_the_commands_the_prompts_name_exist():
    skills = REPO_ROOT / "shared" / "skills"
    assert '"blocked"' in (skills / "scout_pass_log.py").read_text(encoding="utf-8")
    for tool in ("scout_yield.py", "scout_empty_alert.py"):
        assert (skills / tool).is_file()

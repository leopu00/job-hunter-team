"""The cover letter has a second reader: the Critic's letter mode and the Writer's quality-control steps, in seven languages.

The Critic used to refuse a cover letter (CR-04: CV only). A letter now goes through `cover_letter_check.py` (the
deterministic half, which reads the profile) and one Critic review (the judgement half, which never does: CR-01). These
tests hold the three prompts together: the codes the Writer is told to fix are the codes the script prints, the request
and the answer have the same names everywhere, the Critic is never told to open the profile or run the script, and the
review of a letter has a file name of its own.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

LANGS = ("", ".it", ".es", ".fr", ".de", ".pt", ".hu")
SCRIPT = (SKILLS / "cover_letter_check.py").read_text(encoding="utf-8")
SCRIPT_CODES = set(re.findall(r'"code": "([a-z_]+)"', SCRIPT))
HARD_CODES = {"unsupported_number", "unsupported_term", "placeholder", "wrong_language", "length", "no_company", "opening_cliche"}


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def letter_section(lang: str) -> str:
    """The cover-letter section of the blind-review skill: from its heading to the next `## ` heading that is not a template one."""
    text = read(f"agents/_skills/blind-review/SKILL{lang}.md")
    start = text.index("(`[REQ-LETTER]`)")
    start = text.rindex("\n## ", 0, start) + 1
    fence = text.index("```bash", start)
    end = text.index("```", fence + 7) + 3
    return text[start:end]


def writer_branch(lang: str) -> str:
    lines = read(f"agents/scrittore/scrittore{lang}.md").splitlines()
    branch = [line for line in lines if "request_kind=cover_letter" in line and "cover_letter_check.py" in line]
    assert len(branch) == 1, "the cover-letter branch of the Writer names the check once"
    return branch[0]


def test_the_script_prints_exactly_the_hard_codes_the_writer_is_told_about() -> None:
    hard = {c for c in SCRIPT_CODES if c not in {"words_out_of_range", "buzzword"}}
    assert hard == HARD_CODES, hard ^ HARD_CODES


@pytest.mark.parametrize("lang", LANGS, ids=lambda l: l or "en")
def test_the_writer_runs_the_check_then_one_review_and_fails_closed(lang: str) -> None:
    branch = writer_branch(lang)
    for code in HARD_CODES:
        assert f"`{code}`" in branch, code
    assert "python3 /app/shared/skills/cover_letter_check.py --letter" in branch
    assert "[REQ-LETTER]" in branch and "[RES-LETTER]" in branch
    assert "write_request.py <position_id> --mode off --kind cover_letter" in branch
    assert "critiche/letter-review-*" in branch
    assert "Score ≥ 5" in branch and "Verdict: PASS" in branch
    assert "(T10)" in branch  # a fix removes or rewords; it never adds a fact


@pytest.mark.parametrize("lang", LANGS, ids=lambda l: l or "en")
def test_the_critic_judges_a_letter_against_the_cv_and_never_opens_the_profile(lang: str) -> None:
    critic = read(f"agents/critico/critico{lang}.md")
    assert re.search(r"^\*\*CR-04\*\* — .*\[REQ-LETTER\]", critic, re.M)
    assert "CR-01" in critic.split("**CR-04**", 1)[1].splitlines()[0]
    # CR-01 itself is untouched: still the same rule, still forbidding the profile.
    assert "**CR-01**" in critic and "candidate_profile.yml" in critic.split("**CR-01**", 1)[1].split("**CR-02**", 1)[0]

    section = letter_section(lang)
    assert "CR-01" in section
    assert "[REQ-LETTER]" in section and "[RES-LETTER]" in section
    assert "letter-review-<company>-<YYYY-MM-DD>.md" in section
    # The five hard checks, numbered, and the verdict that depends on them and not on the score.
    assert len(re.findall(r"^[1-5]\. \*\*", section, re.M)) == 5
    assert "## VERDICT: PASS | FAIL" in section and "## Hard checks" in section
    # The Critic is told what the script reported; it is never told to run it or to read the profile.
    assert "cover_letter_check.py" in section
    assert "cover_letter_check.py --" not in section and "python3" not in section
    assert not re.search(r"(?i)open (the )?candidate_profile|read (the )?candidate_profile", section)


def test_the_old_refusal_is_gone_in_every_language() -> None:
    for lang in LANGS:
        skill = read(f"agents/_skills/blind-review/SKILL{lang}.md")
        assert "skipped — I review CVs only" not in skill and "saltata — revisiono solo CV" not in skill, lang
        assert "[RES-LETTER]" in skill, lang


def test_the_review_of_a_letter_has_a_file_name_of_its_own() -> None:
    for lang in LANGS:
        section = letter_section(lang)
        assert "letter-review-" in section
        assert "`review-…`" in section, "the CV rounds keep their own files"

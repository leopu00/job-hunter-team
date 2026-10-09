"""The Critic reads the CV PDF with pdftotext, on every CLI.

Step 1 of blind-review said "Read the PDF → tool Read". Claude Code's Read
tool opens PDFs; Codex has no tool by that name and no PDF reader, so on
Codex the step named nothing the Critic could run. pdftotext and pdfinfo
come with poppler-utils, which the image installs and its build gate checks.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
SKILLS = sorted((ROOT / "agents" / "_skills" / "blind-review").glob("SKILL*.md"))


def _step_one(text: str) -> str:
    block = text.split("```", 2)[1]
    lines = [line for line in block.splitlines() if line.startswith("1. ")]
    assert len(lines) == 1, lines
    return lines[0]


def test_all_seven_languages_are_checked() -> None:
    assert len(SKILLS) == 7


@pytest.mark.parametrize("path", SKILLS, ids=lambda p: p.name)
def test_step_one_runs_pdftotext_not_a_claude_tool(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    step = _step_one(text)

    tool = step.split("→", 1)[1]
    assert 'pdftotext -layout "$PDF" -' in tool
    assert "pdfinfo" in tool
    assert not re.search(r"\bRead\b", tool), step


@pytest.mark.parametrize("path", SKILLS, ids=lambda p: p.name)
def test_claude_may_run_the_same_commands(path: Path) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    meta = yaml.safe_load("\n".join(lines[1:lines.index("---", 1)]))

    assert "Bash(pdftotext *)" in meta["allowed-tools"]
    assert "Bash(pdfinfo *)" in meta["allowed-tools"]


def test_the_image_ships_pdftotext_and_pdfinfo() -> None:
    assert re.search(r"\bpoppler-utils\b", (ROOT / "Dockerfile").read_text(encoding="utf-8"))

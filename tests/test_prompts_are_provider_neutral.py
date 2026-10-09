"""Role prompts and skills name what every CLI runs, not Claude Code's own words.

Codex runs the same prompts as Claude. Two leftovers spoke only to Claude:
- model names: "you run on Sonnet, he runs on Opus", "kill every Sonnet".
  The launcher maps each role to a class, Opus/Sol (Capitano, Scrittore,
  Critico, Mentor) or Sonnet/Terra (the others): Claude's name and Codex's
  alias of the same class. The Capitano's table also put the Critico on
  Sonnet, while start-agent.sh starts it on the heavy class;
- "Read tool" as the way to read a file: Codex has no tool by that name.
  The Assistente's list of jargon not to say to the user keeps it on purpose.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
AGENTS = ROOT / "agents"
# Already written per provider: the tier table and the Mentor's tier line.
PER_PROVIDER = {AGENTS / "_team", AGENTS / "mentor"}
PROMPTS = sorted(
    p for p in AGENTS.rglob("*.md")
    if not any(parent in PER_PROVIDER for parent in p.parents)
)
BARE_MODEL = re.compile(r"\b(Opus|Sonnet)\b(?!/(Sol|Terra)\b)")
READ_TOOL = re.compile(
    r"Read tool|tool Read|outil Read|Read-Tool|Read eszköz|`Read`|\(Read\b"
    r"|(any|qualsiasi|cualquier|qualquer|toute|jedem|BÁRMILYEN) Read\b"
)
JARGON_TABLE = re.compile(r'^\| "[^"]*Read[^"]*" \|')


def test_the_search_covers_the_prompts() -> None:
    assert len(PROMPTS) > 400


def test_no_bare_claude_model_name_outside_the_per_provider_tables() -> None:
    found = [f"{p.relative_to(ROOT)}:{n}" for p in PROMPTS
             for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
             if BARE_MODEL.search(line)]
    assert found == []


def test_no_read_tool_as_the_way_to_read_a_file() -> None:
    found = [f"{p.relative_to(ROOT)}:{n}" for p in PROMPTS
             for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
             if READ_TOOL.search(line) and not JARGON_TABLE.search(line)]
    assert found == []


@pytest.mark.parametrize("lang", ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"])
def test_the_captain_table_puts_the_critic_on_the_heavy_class(lang: str) -> None:
    text = (AGENTS / "capitano" / f"capitano{lang}.md").read_text(encoding="utf-8")
    rows = [line for line in text.splitlines() if line.startswith("| 👨‍⚖️ Critico |")]
    assert len(rows) == 1
    assert "Opus/Sol" in rows[0]

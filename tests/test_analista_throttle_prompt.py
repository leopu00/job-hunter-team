"""The Analista prompt teaches the pause the way the tools have it: `throttle <name>` after the task, then the end of the turn, and
`throttle-ack <name>` as the first command after a `[RIPRENDI]`. Measured on a first run: four Analisti out of four typed
`jht-throttle-ack` (it does not exist) and `jht-throttle <name>` without `--agent` (an error), and lost 0.5 to 2 minutes at their
first wake-up, with the first positions waiting."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LANGS = ("", ".it", ".de", ".es", ".fr", ".hu", ".pt")


def _rule(suffix: str) -> str:
    text = (ROOT / "agents" / "analista" / f"analista{suffix}.md").read_text(encoding="utf-8")
    start = text.index("**RULE-01b**")
    return text[start:text.index("**RULE-02**", start)]


@pytest.mark.parametrize("suffix", LANGS)
def test_the_rule_teaches_the_pause_and_the_wake_signature_by_their_real_names(suffix: str):
    rule = _rule(suffix)
    assert 'throttle analista-N --reason "..."' in rule
    assert "`throttle-ack analista-N`" in rule and "`[RIPRENDI]`" in rule
    assert "jht-" not in rule.replace("`jht-`", "")  # the old forms are named only as «the forms with jht- in front»


@pytest.mark.parametrize("suffix", LANGS)
def test_no_old_throttle_command_is_left_in_the_prompt(suffix: str):
    text = (ROOT / "agents" / "analista" / f"analista{suffix}.md").read_text(encoding="utf-8")
    assert not re.search(r"jht-throttle", text)
    assert not re.search(r"timeout\s*(>=|≥)\s*N\s*\+\s*30", text)


def test_the_commands_the_rule_names_exist_in_the_tools_of_the_agents():
    tools = ROOT / "agents" / "_tools"
    assert (tools / "throttle").is_file() and (tools / "throttle-ack").is_file()
    assert not (tools / "jht-throttle-ack").exists()  # the name the agents guessed is not a command

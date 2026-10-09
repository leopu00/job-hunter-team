"""A Codex worker that closes its turn must not stay idle for the whole run.

Measured on 08/10 while preparing the Codex team: the Scout's SC-09 told it to
self-loop "because you are a Claude agent", and the Capitano's C-08 ter gave
the unblocking `Continua` to Kimi only, describing a `burn_watch` that no
longer exists. A Codex worker that ended its turn after one item had no rule
that restarted it: only the stepcap watchdog, which waits 15 minutes of
unchanged pane and then a throttle of at least 5 (about 20 minutes, twice
the length of the first autonomous run).

These tests read the prompts in all 7 languages: the Scout's self-loop rule
names Codex next to Claude, and C-08 ter applies to Codex with its condition
(idle prompt, unchanged pane, one `Continua`, never on a busy agent) and
names the real watchdog instead of `burn_watch`.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
LANGS = ("", ".it", ".es", ".fr", ".de", ".hu", ".pt")
SCOUT = [ROOT / "agents" / "scout" / f"scout{lang}.md" for lang in LANGS]
CAPITANO = [ROOT / "agents" / "capitano" / f"capitano{lang}.md" for lang in LANGS]


def _rule(path: Path, rule: str) -> str:
    lines = [line for line in path.read_text(encoding="utf-8").splitlines()
             if line.startswith(f"**{rule} ")]
    assert len(lines) == 1, f"{path.name}: {len(lines)} paragraphs for {rule}"
    return lines[0]


@pytest.mark.parametrize("path", SCOUT, ids=lambda p: p.name)
def test_the_scout_self_loop_rule_names_codex_wherever_it_names_claude(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    claude_lines = [line for line in text.splitlines() if "Claude" in line]
    # SC-09 and STEP 7: a search that finds nothing must not pass.
    assert len(claude_lines) >= 2, path.name
    assert [line for line in claude_lines if "Codex" not in line] == []
    assert "Codex" in _rule(path, "SC-09")


@pytest.mark.parametrize("path", CAPITANO, ids=lambda p: p.name)
def test_c08_ter_restarts_an_idle_codex_worker_once(path: Path) -> None:
    rule = _rule(path, "C-08 ter")

    assert re.search(r"`active_provider`[^.]{0,40}`kimi`[^.]{0,20}`codex`", rule), \
        "C-08 ter must apply when active_provider is kimi or codex"
    codex = rule[rule.index("**Codex (2026-10-08)"):]
    for needed in ("Working", "esc to interrupt", "60 s", "`Continua`", "C-08 bis", "jht-tmux-send"):
        assert needed in codex, f"{path.name}: the Codex part lacks {needed!r}"
    assert "burn_watch" not in rule
    assert "stepcap" in rule

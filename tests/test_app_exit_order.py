"""The order the desktop app gives the Capitano when the person asks to stop the team in order is the game's, word for
word, and names the flag the skill creates: the Capitano executes it by reading it, so a rewording is a change of
behaviour. (The text is Italian on purpose: the product's agents work in Italian.)"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUST = (ROOT / "desktop" / "src-tauri" / "src" / "app_exit.rs").read_text(encoding="utf-8")
GAME = (ROOT / "game" / "scripts" / "setup" / "setup_service.gd").read_text(encoding="utf-8")
SKILL = (ROOT / "agents" / "_skills" / "graceful-shutdown" / "SKILL.md").read_text(encoding="utf-8")


def rust_const(name: str) -> str:
    match = re.search(rf'const {name}: &str = "((?:[^"\\]|\\.)*)";', RUST)
    assert match, name
    return match.group(1)


def test_the_order_is_the_games_word_for_word():
    flag = rust_const("READY_FLAG")
    game = re.search(r'var order := (.*?)\n\tvar res', GAME, re.S).group(1)
    literals = re.findall(r'"((?:[^"\\]|\\.)*)"', game)
    expected = literals[0] + literals[1] + literals[2] + literals[3] + flag + literals[4]
    assert rust_const("ORDER") == expected


def test_the_flag_is_the_one_the_game_waits_for_and_the_skill_creates():
    flag = rust_const("READY_FLAG")
    assert f'const SHUTDOWN_READY_FLAG := "{flag}"' in GAME
    assert f"touch {flag}" in SKILL


def test_the_order_names_the_skill_that_exists():
    order = rust_const("ORDER")
    assert "[@utente -> @capitano] [SHUTDOWN]" in order and "graceful-shutdown" in order
    assert (ROOT / "agents" / "_skills" / "graceful-shutdown" / "SKILL.md").is_file()
    assert "[SHUTDOWN]" in SKILL

"""The order the desktop app gives the Capitano when the person asks to stop the team in order is pinned here word for
word, and names the flag the skill creates: the Capitano executes it by reading it, so a rewording is a change of
behaviour. (The text is Italian on purpose: the product's agents work in Italian.)"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUST = (ROOT / "desktop" / "src-tauri" / "src" / "app_exit.rs").read_text(encoding="utf-8")
SKILL = (ROOT / "agents" / "_skills" / "graceful-shutdown" / "SKILL.md").read_text(encoding="utf-8")


def rust_const(name: str) -> str:
    match = re.search(rf'const {name}: &str = "((?:[^"\\]|\\.)*)";', RUST)
    assert match, name
    return match.group(1)


# The order as the Godot office gave it, whose wording the Capitano has always executed: changing it is a decision.
PINNED_ORDER = (
    "[@utente -> @capitano] [SHUTDOWN] L'utente sta chiudendo "
    "l'applicazione. Usa la skill graceful-shutdown: fai annotare a "
    "ogni agente lo stato del lavoro in corso sulla propria agenda, "
    "poi fermali uno a uno e infine crea il flag "
    "/jht_home/.shutdown-ready.flag"
    " che chiude l'applicazione."
)


def test_the_order_is_the_pinned_one_word_for_word():
    assert rust_const("READY_FLAG") == "/jht_home/.shutdown-ready.flag"
    assert rust_const("ORDER") == PINNED_ORDER


def test_the_flag_is_the_one_the_skill_creates():
    flag = rust_const("READY_FLAG")
    assert f"touch {flag}" in SKILL


def test_the_order_names_the_skill_that_exists():
    order = rust_const("ORDER")
    assert "[@utente -> @capitano] [SHUTDOWN]" in order and "graceful-shutdown" in order
    assert (ROOT / "agents" / "_skills" / "graceful-shutdown" / "SKILL.md").is_file()
    assert "[SHUTDOWN]" in SKILL

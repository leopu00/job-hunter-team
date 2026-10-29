"""A Codex that offers «Create a plan?» under its composer still has a composer (TEST 19b, 29/10, the Capitano).

After a turn the Capitano's footer was not the model line but «Create a plan?  shift + tab use Plan mode  esc dismiss».
The reader did not know that footer: the composer was not found, the text the system had pasted into it (the reminder
to start the team) was «another draft», nothing pressed Enter and the first run waited six minutes, until a person
pressed it. The screen below is the tail of the capture taken then."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
MESSAGE = (
    "The subscription plan is declared and the candidate profile is complete: the team can start. "
    "Run first_run.py begin-burst and follow your first-run-burst skill."
)
RULE = "─" * 170


def module(name: str):
    if str(SKILLS) not in sys.path:
        sys.path.insert(0, str(SKILLS))
    spec = importlib.util.spec_from_file_location(f"{name}_plan_hint", SKILLS / f"{name}.py")
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def screen(draft: str, footer: str = "  Create a plan?  shift + tab use Plan mode   esc dismiss") -> str:
    return f"\n• The first-run burst is waiting for the plan.\n\n{RULE}\n\n\n› {draft}\n\n{footer}\n"


def test_the_composer_is_found_above_the_plan_offer_and_holds_the_reminder():
    chat = module("agent_chat")
    pane = screen(MESSAGE)
    assert chat.composer_text(pane) == MESSAGE
    assert chat.delivery_gate(pane) == "text"
    composer = module("tmux_send_composer")
    assert composer.composer_relation(pane, MESSAGE)[0] == "ours", "the transport can now prove it is our text and press Enter"


def test_an_empty_composer_under_the_plan_offer_is_writable():
    chat = module("agent_chat")
    assert chat.delivery_gate(screen("\x1b[2mFind and fix a bug in @filename\x1b[0m")) == "empty"


def test_the_words_inside_a_draft_do_not_make_a_footer():
    """The footer is told by its shape (the row starts with the offer), not by the words: a draft whose last row says
    them is a draft whose composer has no footer, and is not mistaken for one."""
    chat = module("agent_chat")
    pane = f"\n{RULE}\n\n\n› here the person types: Create a plan?  shift + tab use Plan mode\n\n"
    assert chat.composer_text(pane) is None


def test_the_other_footers_still_work():
    chat = module("agent_chat")
    assert chat.composer_text(screen("hello", "  gpt-5.6-sol high · ~/agents/capitano")) == "hello"
    assert chat.composer_text(screen("hello", "  tab to queue message                                      80% context left")) == "hello"

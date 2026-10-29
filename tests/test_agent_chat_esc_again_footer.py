"""A Codex that says «esc again to edit previous message» under its composer still has a composer (vega, 29/10).

The Dottore's round typed `/status` into the sessions and pressed one Escape with the throttle's wake-up waiting in the
composer. Codex then draws «esc again to edit previous message» where the model line was. The reader did not know that
footer: the composer was not found, the `›` row and the footer looked like the two choices of a menu, and the transport
answered «shows a menu, login, or permission request» (rc=3), five rounds in a row, until the session was recreated.
The screens below are shaped like the capture taken then (the card of /status in the scrollback, the wake-up in the
box, the footer last). No key is new: the wake-up is OUR signed text, and Enter is what the transport presses.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
FOOTER = "  esc again to edit previous message"
CARD = [
    "/status",
    "╭" + "─" * 60 + "╮",
    "│  >_ OpenAI Codex (v0.147.0)" + " " * 33 + "│",
    "│  Context window:    72% left (81.7K used / 258K)" + " " * 13 + "│",
    "╰" + "─" * 60 + "╯",
    "",
]


def module(name: str):
    if str(SKILLS) not in sys.path:
        sys.path.insert(0, str(SKILLS))
    spec = importlib.util.spec_from_file_location(f"{name}_esc_again", SKILLS / f"{name}.py")
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def wake_up() -> str:
    engine = module("throttle_engine")
    return engine.WAKE_TEXT.format(AGENT="SCOUT-5", agent="scout-5")


def screen(text: str, width: int, footer_gap: bool = False) -> str:
    # A terminal wraps by columns, space included.
    rows = [text[at:at + width - 2] for at in range(0, len(text), width - 2)] or [""]
    box = ["› " + rows[0]] + ["  " + row for row in rows[1:]]
    return "\n".join(CARD + box + ([""] if footer_gap else []) + [FOOTER]) + "\n"


@pytest.mark.parametrize("width", [120, 170, 240])
@pytest.mark.parametrize("gap", [False, True])
def test_the_wake_up_waiting_above_the_footer_is_a_draft_not_a_menu(width, gap):
    chat = module("agent_chat")
    pane = screen(wake_up(), width, gap)
    assert chat.delivery_gate(pane) == "text", (width, gap)
    assert chat.composer_text(pane) == wake_up(), (width, gap)


def test_the_transport_can_prove_the_text_is_ours_and_press_enter():
    chat, composer = module("agent_chat"), module("tmux_send_composer")
    pane = screen(wake_up(), 170)
    assert chat.delivery_gate(pane) == "text"
    assert composer.composer_relation(pane, wake_up())[0] == "ours"


def test_a_short_message_under_the_footer_is_a_composer_too():
    chat = module("agent_chat")
    pane = "\n".join(CARD + ["› [DA @SISTEMA A @SCOUT-5] [RIPRENDI] Your pause is over.", FOOTER]) + "\n"
    assert chat.composer_snapshot(pane)[0] == "text" and chat.delivery_gate(pane) == "text"


def test_the_words_inside_a_draft_do_not_make_a_footer():
    chat = module("agent_chat")
    pane = "\n".join(["", "─" * 100, "", "› here the person types: esc again to edit previous message", ""]) + "\n"
    assert chat.composer_text(pane) is None


def test_a_real_menu_is_still_a_menu():
    chat = module("agent_chat")
    pane = "\n".join(["earlier output", "", "❯ 1. Yes, continue", "  2. No, and tell Codex what to do differently", "",
                              "  enter to confirm · esc to cancel"]) + "\n"
    assert chat.delivery_gate(pane) == "blocked"


def test_the_banner_of_the_status_card_is_not_a_composer_holding_openai_codex_as_a_draft():
    chat = module("agent_chat")
    pane = "\n".join(CARD[:5] + ["", "Working on it..."]) + "\n"
    assert chat.composer_text(pane) is None and chat.composer_snapshot(pane)[0] == "none"

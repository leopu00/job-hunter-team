"""A long wake-up in the Codex box with the model line drawn RIGHT UNDER it is a composer, not a menu (a real team, 02/11).

The throttle's wake-up could not be typed for 25 minutes (rc=3 «shows a menu, login, or permission request», five rounds,
then a retry a quarter of an hour later) on sessions whose screen held the card of /status in the scrollback and a long
unsent message in the box. Nothing was open: Codex 0.147 draws the model/path line directly under the last row of a draft
that wraps over three rows, with no blank row between. The walk over the draft's rows took that line for one more row,
found the real last row of text too short to be a wrapped one, and gave up: no composer, and the `›` row read as a
menu's cursor. The screens are the shape of the captures taken from the live team (the text masked, the rows' lengths kept).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import agent_chat  # noqa: E402

CARD = [
    "╭" + "─" * 52 + "╮",
    "│ model:       gpt-5.6-terra high   /model to change │",
    "│ directory:   ~/agents/analista-4                   │",
    "│ permissions: YOLO mode                             │",
    "╰" + "─" * 52 + "╯",
    "• You have 3 usage limit resets available. Run /usage to use one.",
]
FOOTER = "  gpt-5.6-terra high · ~/agents/analista-4"


def screen(rows, footer=FOOTER, blank_before_footer=False):
    return "\n".join(CARD + [""] + rows + ([""] if blank_before_footer else []) + [footer, ""])


def draft(*lengths):
    first = "› " + "w" * (lengths[0] - 2)
    return [first] + ["  " + "x" * (n - 2) for n in lengths[1:]]


@pytest.mark.parametrize("lengths", [(215, 217, 81), (215, 217, 40), (215, 216, 216, 30)])
def test_a_wrapped_draft_with_the_model_line_right_under_it_is_text_in_a_composer(lengths):
    pane = screen(draft(*lengths))
    assert agent_chat.composer_snapshot(pane) == ("text", False)
    assert agent_chat.delivery_gate(pane) == "text", "not a menu"


def test_the_same_draft_with_a_blank_row_before_the_footer_was_always_a_composer():
    assert agent_chat.delivery_gate(screen(draft(215, 217, 81), blank_before_footer=True)) == "text"


def test_the_draft_text_does_not_include_the_footer():
    pane = screen(draft(215, 217, 81))
    text = agent_chat.composer_text(pane)
    assert text is not None and "gpt-5.6" not in text and "agents/analista-4" not in text


def test_a_last_row_that_fills_the_line_is_a_row_of_the_draft_not_the_footer():
    # a row with a «·» as long as the draft's rows is text; the real footer is still under it
    rows = draft(215, 217)
    rows.append("  " + "z · " * 53)           # 214 characters, full width
    pane = screen(rows)
    assert agent_chat.delivery_gate(pane) == "text"
    assert "z · z" in (agent_chat.composer_text(pane) or "")


def test_a_real_choice_list_is_still_a_menu_with_the_same_chrome_around_it():
    menu = "\n".join(CARD + ["", "Do you trust this directory?", "› 1. Yes, continue", "  2. No, quit", "", "  Press enter to continue"])
    assert agent_chat.delivery_gate(menu) == "blocked"
    localized = "\n".join(CARD + ["", "› Sì, continua", "  No, esci", "", "  Premi invio per continuare"])
    assert agent_chat.delivery_gate(localized) == "blocked"


def test_a_menu_with_a_long_first_choice_a_short_second_and_a_hint_row_stays_a_menu():
    """The hint under a menu («Esc to cancel · Enter to confirm») has a «·» too, but no path: it is not the model line."""
    for hint in ("  Esc to cancel · Enter to confirm", "  esc dismiss · enter select"):
        pane = "\n".join(CARD + ["", "› " + "q" * 120, "  no", hint, ""])
        assert agent_chat.delivery_gate(pane) == "blocked", hint


def test_the_wake_up_of_the_engine_left_unsent_with_the_footer_under_it_is_still_only_text_for_the_gate():
    pane = screen(draft(215, 217, 81))
    assert agent_chat.new_turn_gate(pane) == "text", "an unsigned draft is never pasted over"


def test_known_limit_an_unnumbered_menu_shaped_exactly_like_a_wrapped_draft_reads_as_text_and_nothing_is_typed():
    """The one form that changed from «blocked» to «text» without being a draft: a menu with no numbers whose cursor row and
    second row are as long as a wrapped draft (~215 characters), a short third row, and the model/path line right under it
    with nothing below. Its shape IS a draft's, and no Codex dialog is known to have it (a dialog takes the place of the
    composer AND of the model line; real lists are numbered or short). What matters is what «text» does: the transport never
    pastes over a draft that is not signed, and a menu's rows are not signed — it waits, says a foreign text is in the box,
    and types nothing (a paste behind a signed draft, and the Enter after it, need the signature to be proved in the box)."""
    pane = screen(["› " + "m" * 213, "  " + "n" * 215, "  " + "o" * 38])
    assert agent_chat.delivery_gate(pane) == "text"
    assert agent_chat.new_turn_gate(pane) == "text", "not «signed»: nothing here carries the transport's signature"

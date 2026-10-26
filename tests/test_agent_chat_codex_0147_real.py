"""The chat's «is the agent at its prompt?» on the REAL screens of Codex 0.147.0 (26/10, Mac, local container).

The two captures were taken by the Mac tester with `tmux capture-pane -e -p` while the chat answered
`agent_not_at_prompt` (Assistente) and `composer_has_text` (Capitano). They are in tests/fixtures/codex_0147/
with every letter and digit turned into «□» (lengths, colours, SGR sequences and punctuation are kept):
the reader looks at the SHAPE of the rows, never at their words.

- Assistente, idle, with the grey suggestion «Run /review on my current changes»: the composer is empty.
  Above it Codex still draws the last input it was sent, with the same `›` as the composer, wrapped over
  two rows. That echo is conversation, not a menu: the chat must write.
- Capitano with an injected [HEARTBEAT] sitting in the composer: that IS text (gate `text`); who submits it
  is the transport's business (jht-tmux-send), not the reading of the screen.

Run with: pytest tests/test_agent_chat_codex_0147_real.py -v
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "shared" / "skills" / "agent_chat.py"
FIXTURES = ROOT / "tests" / "fixtures" / "codex_0147"


def _module():
    spec = importlib.util.spec_from_file_location("agent_chat_under_test_real", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _screen(name: str) -> str:
    return (FIXTURES / f"{name}.txt").read_text(encoding="utf-8")


def test_the_real_idle_assistant_with_the_grey_suggestion_is_writable():
    module = _module()
    screen = _screen("assistente")
    # the composer: the suggestion is drawn with SGR 2 (dim), so it is empty
    assert module.composer_snapshot(screen) == ("empty", False)
    # the echo of the last input, wrapped, sits right above it and is not a choice list
    assert module.delivery_gate(screen) == "empty"
    module.require_prompt  # the guard the send path calls exists
    assert module.prompt_state(screen) == "ready"


def test_the_real_captain_with_a_heartbeat_in_the_composer_has_text():
    module = _module()
    screen = _screen("capitano")
    assert module.composer_snapshot(screen) == ("text", False)
    assert module.delivery_gate(screen) == "text"
    assert module.composer_text(screen)  # the draft is read whole, for the transport's proof


def _echo_over_two_rows(first_len: int, second_len: int) -> str:
    """The shape of the assistant's last input: a long `›` row and its wrapped tail, as in the capture."""
    return (
        "\x1b[2m" + "─" * 220 + "\x1b[0m\n\n\n"
        "\x1b[1m› \x1b[0m\x1b[39m\x1b[49m" + "□" * (first_len - 2) + "\n"
        "  " + "□" * second_len + "\n\n\n"
        "\x1b[2m• \x1b[0m\x1b[39m\x1b[49m" + "□" * 90 + "\n\n\n"
        "\x1b[1m›\x1b[0m\x1b[39m\x1b[49m \x1b[2m" + "□" * 33 + "\n\n"
        "\x1b[0m\x1b[39m\x1b[49m  \x1b[38;2;246;226;183m" + "□" * 17 + "\x1b[2m\x1b[39m · \x1b[0m\x1b[38;2;171;223;167m\x1b[49m" + "□" * 17 + "\n"
    )


def test_a_long_wrapped_input_echo_is_transcript_but_a_short_choice_pair_is_still_a_menu():
    module = _module()
    # 216 columns of echo plus a 30-column tail: the shape of the capture
    assert module.delivery_gate(_echo_over_two_rows(216, 30)) == "empty"
    # the same two rows, but short (a choice and its sibling): a live menu above the composer stays closed
    menu = (
        "\x1b[1m› \x1b[0m\x1b[39m\x1b[49m" + "□" * 20 + "\n"
        "  " + "□" * 30 + "\n\n"
        "\x1b[1m›\x1b[0m\x1b[39m\x1b[49m \x1b[2m" + "□" * 33 + "\n\n"
        "\x1b[0m\x1b[39m\x1b[49m  \x1b[38;2;246;226;183m" + "□" * 17 + "\x1b[2m\x1b[39m · \x1b[0m\x1b[38;2;171;223;167m\x1b[49m" + "□" * 17 + "\n"
    )
    assert module.delivery_gate(menu) == "blocked"
    # a long first row whose next row is NOT a wrapped tail (a blank row ends the run) has no sibling at all
    no_tail = _echo_over_two_rows(216, 30).replace("  " + "□" * 30 + "\n\n\n", "\n")
    assert module.delivery_gate(no_tail) == "empty"


def test_a_real_numbered_codex_permission_choice_above_the_composer_stays_closed():
    module = _module()
    approval = (
        "\x1b[1m› 1. \x1b[0m" + "□" * 40 + "\n"
        "  2. " + "□" * 30 + "\n"
        "  3. " + "□" * 30 + "\n\n"
        "\x1b[1m›\x1b[0m\x1b[39m\x1b[49m \x1b[2m" + "□" * 33 + "\n\n"
        "\x1b[0m\x1b[39m\x1b[49m  \x1b[38;2;246;226;183m" + "□" * 17 + "\x1b[2m\x1b[39m · \x1b[0m\x1b[38;2;171;223;167m\x1b[49m" + "□" * 17 + "\n"
    )
    assert module.delivery_gate(approval) == "blocked"

def test_a_long_first_choice_with_one_short_sibling_and_no_composer_under_it_is_a_live_menu():
    module = _module()
    # the echo shape (long › row + a short tail) but nothing that is a composer below it: a menu took its place
    menu = (
        "\x1b[2m" + "─" * 220 + "\x1b[0m\n\n"
        "\x1b[1m› \x1b[0m\x1b[39m\x1b[49m" + "□" * 214 + "\n"
        "  " + "□" * 30 + "\n"
    )
    assert module.delivery_gate(menu) == "blocked"
    # the very same two rows with the composer drawn under them are the transcript's echo
    with_composer = menu + (
        "\n\x1b[1m›\x1b[0m\x1b[39m\x1b[49m \x1b[2m" + "□" * 33 + "\n\n"
        "\x1b[0m\x1b[39m\x1b[49m  \x1b[38;2;246;226;183m" + "□" * 17 + "\x1b[2m\x1b[39m · \x1b[0m\x1b[38;2;171;223;167m\x1b[49m" + "□" * 17 + "\n"
    )
    assert module.delivery_gate(with_composer) == "empty"

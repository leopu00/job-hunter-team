"""Delivery contract: render; independent cases for file-based scheduling."""

import time
import pytest

from test_tmux_send_delivery_proof import (
    MESSAGE,
    box,
)


def test_a_paste_that_stops_half_drawn_is_refused_without_enter_and_the_log_says_why(box):
    box.put("split", "5")
    done = box.run(JHT_TMUX_PARTIAL_WAIT="1")
    assert done.returncode == 130, done.stderr
    assert box.keys("Enter") == [] and box.keys("Escape") == []
    assert "half drawn" in done.stderr
    assert "JHT_STUCK" in done.stdout.splitlines(), "the caller is told the text stayed in the composer"


def test_a_users_turn_that_wraps_onto_a_row_with_the_fence_mark_gets_its_enter(box):
    """The user's turn is fenced with ⟦UTENTE·id⟧; once it wraps, the closing mark sits on a row with a
    «·», which was read as the model line: the composer looked cut short, 130 after the wait, no Enter."""
    box.put("layout", "codex")
    box.put("wrap", "120")
    chat = "[@utente -> @capitano] [CHAT] " + "Platform engineer in Rome, six years of Kubernetes and CI/CD. " * 3
    done = box.run(message=chat, JHT_TMUX_PARTIAL_WAIT="1")
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1 and box.keys("Escape") == []
    assert "half drawn" not in done.stderr


def test_a_person_typing_next_to_our_text_before_the_first_enter_gets_no_enter(box):
    # The pause after the paste renders is up to 1.5 s: the screen read before it is stale.
    box.put("typing_after", "0.15")
    done = box.run(message=MESSAGE + MESSAGE)
    assert done.returncode == 130, done.stderr
    assert box.keys("Enter") == [] and box.keys("Escape") == []


def test_a_non_numeric_partial_wait_falls_back_to_the_default(box):
    box.put("split", "0.6")
    done = box.run(JHT_TMUX_PARTIAL_WAIT="soon")
    assert done.returncode == 0, done.stderr
    assert "syntax error" not in done.stderr and "unbound" not in done.stderr


@pytest.mark.parametrize("wait", ["08", "09", "99999999999999999999"])
def test_a_partial_wait_with_a_leading_zero_or_a_huge_number_is_tamed(box, wait):
    box.put("split", "0.6")
    done = box.run(JHT_TMUX_PARTIAL_WAIT=wait)
    assert done.returncode == 0, done.stderr
    assert "too great" not in done.stderr and "syntax error" not in done.stderr


def test_a_huge_partial_wait_does_not_wait_forever_on_a_half_drawn_paste(box):
    box.put("split", "30")
    started = time.monotonic()
    done = box.run(JHT_TMUX_PARTIAL_WAIT="99999999999999999999")
    assert done.returncode == 130, done.stderr
    assert time.monotonic() - started < 25, "a huge wait falls back to the default of eight seconds"


def test_a_turn_starting_while_the_paste_renders_does_not_stop_the_delivery(box):
    box.put("turn_on_paste")
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_a_text_that_never_shows_is_typed_once_and_nothing_is_pressed(box):
    box.put("mute")
    done = box.run()
    assert done.returncode == 3, "the one 'maybe dead' signal pacing-bridge counts on keeps its code"
    assert len(box.typed()) == 1
    assert box.keys("Enter") == [] and box.keys("Escape") == [] and box.keys("Space") == []

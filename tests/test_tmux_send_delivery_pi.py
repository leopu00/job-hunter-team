"""jht-tmux-send against the composer of Pi's TUI: the same proofs as for Codex and Claude.

The fake tmux of test_tmux_send_delivery_proof.py with a «pi» layout (rules around the draft, the folder row and the
totals row, «⠹ Working» on the top rule while a turn runs). Before F6 a Pi pane had no composer for the transport: the
gate said «none», the draft of a person was invisible and a submit could be proved only by the text showing up twice.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_tmux_send_delivery_proof as proof
from test_tmux_send_delivery_proof import MESSAGE, _pending_input, box  # noqa: F401  (the fixture)
from pi_screens import FOLDER, RULE, TOTALS, WORKING

TOTALS_FMT = TOTALS.replace("%", "%%")  # it goes through printf
PI_LAYOUT = f"""    if [ -f "$S/layout" ] && [ "$(cat "$S/layout")" = pi ]; then
      if [ "$mode" = pimenu ]; then
        printf ' Trust project folder?\\n → Trust\\n   Do not trust\\n ↑↓ navigate  enter select  escape/ctrl+c cancel\\n{RULE}\\n{FOLDER}\\n{TOTALS_FMT}\\n'; exit 0
      fi
      top='{RULE}'; [ "$mode" = busy ] && top='{WORKING}'
      printf '%s\\n%s\\n{RULE}\\n{FOLDER}\\n{TOTALS_FMT}\\n' "$top" "$(cat "$S/composer" 2>/dev/null)"; exit 0
    fi
"""
CODEX_LAYOUT = '    if [ -f "$S/layout" ] && [ "$(cat "$S/layout")" = codex ]; then'
BUSY_ROW = """    [ "$mode" = busy ] && echo '◦ Working (3s • esc to interrupt)'\n"""
COLLAPSE = '''if [ "$(cat "$S/collapse")" = codex ]; then'''
COLLAPSE_PI = '''if [ "$(cat "$S/collapse")" = pi ]; then n=$(cat "$S/collapse_n" 2>/dev/null || echo "$chars"); token="[paste #1 $n chars]"
        elif [ "$(cat "$S/collapse")" = codex ]; then'''
FAKE_PI = proof.FAKE_TMUX.replace(BUSY_ROW, PI_LAYOUT.replace("exit 0\n    fi\n", "exit 0\n    fi\n", 1) + BUSY_ROW, 1).replace(COLLAPSE, COLLAPSE_PI, 1)
assert FAKE_PI.count("= pi ]") == 2


@pytest.fixture()
def pibox(request, monkeypatch):
    monkeypatch.setattr(proof, "FAKE_TMUX", FAKE_PI)
    box = request.getfixturevalue("box")
    box.put("layout", "pi")
    return box


def test_a_message_to_an_empty_pi_composer_is_pasted_once_and_pressed_once(pibox):
    done = pibox.run()
    assert done.returncode == 0, done.stderr
    assert len(pibox.typed()) == 1 and len(pibox.keys("Enter")) == 1
    assert "unknown" not in done.stderr.lower()


def test_a_draft_of_a_person_in_the_pi_composer_is_not_overwritten_nor_sent(pibox):
    pibox.put("composer", "una bozza che sto scrivendo io")
    done = pibox.run()
    assert done.returncode == 130, done.stderr
    assert pibox.typed() == [] and pibox.keys("Enter") == []
    row = _pending_input(pibox)[-1]
    assert row["reason"] == "composer_foreign"


def test_a_pi_turn_running_does_not_stop_a_delivery_into_the_empty_composer(pibox):
    pibox.put("mode", "busy")
    done = pibox.run()
    assert done.returncode == 0, done.stderr
    assert len(pibox.typed()) == 1 and len(pibox.keys("Enter")) == 1


def test_an_enter_that_pi_ignores_is_not_a_delivery(pibox):
    """The text stays in the composer after the Enter: before F6 the occurrence in the pane tail passed for a proof."""
    pibox.put("enter_ignored")
    done = pibox.run()
    assert done.returncode == 5, done.stderr
    assert len(pibox.typed()) == 1


def test_a_long_message_pi_keeps_behind_a_paste_marker_is_ours_and_gets_its_enter(pibox):
    pibox.put("collapse", "pi")
    long_message = "[@watchdog -> @scout-1] [MSG] " + "parola " * 200
    done = pibox.run(message=long_message)
    assert done.returncode == 0, done.stderr
    assert len(pibox.typed()) == 1 and len(pibox.keys("Enter")) == 1


def test_a_paste_marker_that_is_not_ours_is_a_foreign_draft(pibox):
    pibox.put("composer", "[paste #3 4821 chars]")
    done = pibox.run()
    assert done.returncode == 130, done.stderr
    assert pibox.typed() == [] and pibox.keys("Enter") == []


def test_a_busy_pi_that_draws_the_paste_late_is_busy_not_dead(pibox):
    """rc 3 is the one answer that lets pacing think an agent is dead and respawn it (the overspawn of 07/06). A Pi
    in the middle of a turn has no «esc to interrupt» row: its «⠹ Working» on the top rule is what says it is alive."""
    pibox.put("mode", "busy")
    pibox.put("hold", "")                     # drawn only when released: never within the wait
    done = pibox.run(JHT_TMUX_LATE_RENDER_WAIT="1")
    assert done.returncode == 4, done.stderr
    assert len(pibox.typed()) == 1 and pibox.keys("Enter") == []
    pibox.put("release")
    again = pibox.run(JHT_TMUX_LATE_RENDER_WAIT="1")
    assert again.returncode == 0, again.stderr
    assert len(pibox.typed()) == 1 and len(pibox.keys("Enter")) == 1


def test_a_pi_at_rest_that_never_draws_the_paste_is_the_one_maybe_dead_answer(pibox):
    pibox.put("mute")
    done = pibox.run()
    assert done.returncode == 3, done.stderr


def test_a_selector_of_pi_types_nothing_and_presses_nothing(pibox):
    """The trust dialog or /login: an Enter would pick a choice. rc 3 is the answer for a menu, as on the other TUIs."""
    pibox.put("mode", "pimenu")
    done = pibox.run()
    assert done.returncode == 3, done.stderr
    assert pibox.typed() == [] and pibox.keys("Enter") == [] and pibox.keys("Escape") == []

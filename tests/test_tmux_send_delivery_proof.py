"""jht-tmux-send: il testo si scrive UNA volta, la firma si cerca SOLO nella casella, «preso» ha
bisogno di una prova, e una consegna alla volta per sessione (C1-C4 della revisione del 23/10).

Il trasporto VERO contro un finto `tmux` a copione: lo stato del finto sta in una cartella (la
casella, la conversazione, un modo) e registra ogni chiamata. Il caso che ha fatto sparire un
messaggio il 21/10 e' `test_a_signature_in_the_conversation_is_not_a_proof_when_the_keys_are_lost`.
"""
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TRANSPORT = ROOT / "agents" / "_skills" / "tmux-send" / "jht-tmux-send"

FAKE_TMUX = r"""#!/bin/bash
# Finto tmux. Stato in $FT: composer (la casella), transcript (la conversazione), mode, e file-interruttore:
# mute (l'incolla si perde), lag (secondi prima che il testo compaia), enter_ignored.
S="$FT"; echo "$*" >> "$S/calls"
cmd="$1"; shift
case "$cmd" in
  has-session|list-panes|show-options) exit 0 ;;
  capture-pane)
    # A text that is not ours and goes away by itself (the message another sender is about to submit, a suggestion
    # drawn late): it stays for `foreign_until` looks at the screen, then the box is empty.
    if [ -f "$S/foreign_until" ]; then
      n=$(( $(cat "$S/foreign_looks" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$S/foreign_looks"
      if [ "$n" -gt "$(cat "$S/foreign_until")" ]; then : > "$S/composer"; rm -f "$S/foreign_until"; fi
    fi
    # A paste the TUI keeps `late_captures` looks at the screen before drawing (the number of times the transport
    # LOOKED, not seconds: a loaded runner stretches the seconds and not the looks), or until `release` exists.
    if [ -f "$S/held" ]; then
      n=$(( $(cat "$S/held_looks" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$S/held_looks"
      if { [ -f "$S/late_captures" ] && [ "$n" -ge "$(cat "$S/late_captures")" ]; } || [ -f "$S/release" ]; then
        cat "$S/held" >> "$S/composer"; rm -f "$S/held"
      fi
    fi
    mode=$(cat "$S/mode" 2>/dev/null || echo normal)
    case "$mode" in
      shell) printf 'user@host ~ $ \n'; exit 0 ;;
      menu) [ -f "$S/transcript" ] && cat "$S/transcript"; printf '❯ 1. Yes\n  2. No\n'; exit 0 ;;
      unknown|unknown-echo)
        [ -f "$S/transcript" ] && cat "$S/transcript"
        printf '\033[2m□□□□□□□□□□□□□□□□□□□□□□□□□□□□□□□□\033[0m\n'
        exit 0 ;;
      pondering-it)
        [ -f "$S/transcript" ] && cat "$S/transcript"
        printf '◦ Elaborazione (12s · esc to interrupt)\n\033[2m□□□□□□□□□□□□□□□□□□□□□□□□□□□□□□□□\033[0m\n'
        exit 0 ;;
      menu-it) printf '╭──────────────────╮\n│ › Continua       │\n│   Annulla        │\n╰──────────────────╯\n'; exit 0 ;;
    esac
    [ -f "$S/transcript" ] && cat "$S/transcript"
    [ "$mode" = busy ] && echo '◦ Working (3s • esc to interrupt)'
    if [ -f "$S/layout" ] && [ "$(cat "$S/layout")" = codex ]; then
      # Codex: the mark has no box and the model line sits under the composer. In the middle of a turn that line
      # is «tab to queue message ... 80% context left» (the footer of the real Capitano, TEST 5, 27/10).
      if [ "$mode" = busy ]; then
        printf '› %s\n  tab to queue message                                                        80%% context left\n' "$(cat "$S/composer" 2>/dev/null)"; exit 0
      fi
      if [ -f "$S/wrap" ]; then
        # A long draft wrapped as Codex draws it: the marker row as wide as the terminal, the rest on rows
        # indented under it, a blank row, then the model line.
        python3 -c '
import sys
width = int(sys.argv[1])
text = "› " + open(sys.argv[2], encoding="utf-8").read()
rows = [text[:width]] + ["  " + text[n:n + width - 2] for n in range(width, len(text), width - 2)]
print("\n".join(rows)); print(); print("  gpt-5.6-sol high · ~/agents/capitano")' "$(cat "$S/wrap")" "$S/composer"
        exit 0
      fi
      printf '› %s\n  gpt-5.6-sol high · ~/agents/capitano\n' "$(cat "$S/composer" 2>/dev/null)"; exit 0
    fi
    printf '╭──────────────────────────────────────────────╮\n│ ❯ %s │\n╰──────────────────────────────────────────────╯\n  ? for shortcuts\n' "$(cat "$S/composer" 2>/dev/null)" ;;
  load-buffer)
    while [ "$1" != "-b" ] && [ $# -gt 0 ]; do shift; done
    [ "$1" = "-b" ] && shift
    name="$1"; shift
    cat > "$S/buffer.$name" ;;
  paste-buffer)
    while [ $# -gt 0 ]; do
      if [ "$1" = "-b" ]; then name="$2"; shift 2; continue; fi
      shift
    done
    # The screen can change after the preflight capture and before this paste.
    # These switches model a new menu or a human draft winning that small race.
    [ -f "$S/menu_on_paste" ] && { printf 'menu\n' > "$S/mode"; exit 0; }
    [ -f "$S/draft_on_paste" ] && cat "$S/draft_on_paste" >> "$S/composer"
    [ -f "$S/mute" ] && exit 0
    # A person types next to our text a moment after it rendered (during the settle pause).
    if [ -f "$S/typing_after" ]; then
      (sleep "$(cat "$S/typing_after")"; printf '%s' ' tipo io' >> "$S/composer") >/dev/null 2>&1 &
    fi
    # The agent's turn starts a moment after the paste rendered (the Enter of an earlier paste starts it):
    # the screen goes from «at rest» to «working» while the transport is still settling.
    if [ -f "$S/busy_after" ]; then
      (sleep "$(cat "$S/busy_after")"; printf 'busy\n' > "$S/mode") >/dev/null 2>&1 &
    fi
    # A paste the TUI draws in two goes: the first half now, the rest after the delay in `split`.
    if [ -f "$S/split" ]; then
      text=$(cat "$S/buffer.$name"); half=$(( ${#text} / 2 ))
      printf '%s' "${text:0:half}" >> "$S/composer"
      (sleep "$(cat "$S/split")"; printf '%s' "${text:half}" >> "$S/composer") >/dev/null 2>&1 &
      rm -f "$S/buffer.$name"; exit 0
    fi
    # The agent starts a turn while the paste renders: the screen above the composer changes,
    # the composer keeps the whole text.
    [ -f "$S/turn_on_paste" ] && { printf 'busy\n' > "$S/mode"; printf '• Mittente non verificato: nessuna risposta inviata.\n' >> "$S/transcript"; }
    if [ -f "$S/late_captures" ] || [ -f "$S/hold" ]; then cat "$S/buffer.$name" > "$S/held"; rm -f "$S/buffer.$name" "$S/held_looks"; exit 0; fi
    if [ -f "$S/lag" ]; then (sleep "$(cat "$S/lag")"; cat "$S/buffer.$name" >> "$S/composer") & exit 0; fi
    cat "$S/buffer.$name" > "$S/pasted.$name"
    # A long paste is kept out of sight: the composer shows a token and the TUI keeps the text. `collapse` says
    # which TUI: codex («[Pasted Content N chars]» past 1000 characters) or claude («[Pasted text #1 +N lines]»
    # past 1000 characters); `collapse_n` overrides the number shown (a token that is not ours).
    if [ -f "$S/collapse" ]; then
      text=$(cat "$S/buffer.$name"); chars=${#text}
      if [ "$chars" -gt 1000 ]; then
        lines=$(printf '%s' "$text" | tr -cd '\n' | wc -c | tr -d ' ')
        if [ "$(cat "$S/collapse")" = codex ]; then n=$(cat "$S/collapse_n" 2>/dev/null || echo "$chars"); token="[Pasted Content $n chars]"
        else token="[Pasted text #1 +$(cat "$S/collapse_n" 2>/dev/null || echo "$lines") lines]"; fi
        printf '%s' "$text" > "$S/collapsed"
        [ -f "$S/token_beside" ] && token="$token $(cat "$S/token_beside")"
        printf '%s' "$token" >> "$S/composer"; rm -f "$S/buffer.$name"; exit 0
      fi
    fi
    [ -f "$S/echo_on_paste" ] && { cat "$S/buffer.$name" >> "$S/transcript"; echo >> "$S/transcript"; }
    cat "$S/buffer.$name" >> "$S/composer"; rm -f "$S/buffer.$name" ;;
  send-keys)
    while [ "$1" = "-t" ]; do shift 2; done
    key="$1"
    if [ "$key" = "-l" ]; then
      printf '%s' "$2" >> "$S/composer"; exit 0
    fi
    if [ "$key" = "Enter" ]; then
      [ -f "$S/enter_ignored" ] && exit 0
      if [ -s "$S/composer" ]; then
        # a collapsed paste goes to the conversation as the text it stands for
        if [ -f "$S/collapsed" ] && grep -q 'Pasted' "$S/composer"; then cat "$S/collapsed" >> "$S/transcript"; rm -f "$S/collapsed"
        else cat "$S/composer" >> "$S/transcript"; fi
        echo >> "$S/transcript"
      fi
      : > "$S/composer"; exit 0
    fi
    exit 0 ;;
esac
exit 0
"""

MESSAGE = "[@watchdog -> @capitano] [MSG] prova di consegna con una frase abbastanza lunga da avere testa e coda diverse"


@pytest.fixture()
def box(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "tmux").write_text(FAKE_TMUX, encoding="utf-8")
    (bin_dir / "tmux").chmod(0o755)
    state = tmp_path / "pane"
    state.mkdir()
    (state / "calls").write_text("", encoding="utf-8")
    (state / "composer").write_text("", encoding="utf-8")

    def put(name, content=""):
        (state / name).write_text(content, encoding="utf-8")

    def run(message=MESSAGE, session="CAPITANO", **env):
        full = {
            **os.environ,
            "FT": str(state),
            "PATH": f"{bin_dir}:{Path(sys.executable).parent}:/usr/bin:/bin",
            "JHT_HOME": str(tmp_path / "home"),
            "JHT_TMUX_PROMPT_WAIT": "0",
            "JHT_TMUX_TEXT_WAIT": "0",
            "PYTHONDONTWRITEBYTECODE": "1",
            **env,
        }
        full.pop("TMUX", None)
        for name in ("JHT_TMUX_SEND_FROM", "JHT_TMUX_FOREIGN_WAIT"):
            if name not in env:
                full.pop(name, None)
        return subprocess.run([str(TRANSPORT), session, message], capture_output=True, text=True, timeout=120, env=full)

    def calls():
        return (state / "calls").read_text(encoding="utf-8").splitlines()

    def keys(name):
        return [line for line in calls() if line.startswith("send-keys") and line.endswith(name)]

    def typed():
        return [line for line in calls() if line.startswith("paste-buffer")]

    return type("Box", (), {"put": staticmethod(put), "run": staticmethod(run), "calls": staticmethod(calls),
                            "keys": staticmethod(keys), "typed": staticmethod(typed), "state": state, "home": tmp_path / "home"})


# -- C1 · il testo si scrive UNA volta ---------------------------------------------------------------------------------

def test_a_delivery_types_once_and_presses_enter_once(box):
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1 and box.keys("Escape") == []
    assert "JHT_STUCK" not in done.stdout


def test_a_slow_render_is_waited_for_not_typed_again(box):
    box.put("lag", "1.5")
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1, "the text appeared late: it is not typed a second time"
    assert box.keys("Escape") == []


def test_a_paste_still_being_drawn_is_waited_for_not_refused(box):
    # The TUI of a busy agent draws the paste in more than one go: for a moment the composer holds
    # the first half of OUR text.  That is a render in progress, not someone else's words.
    box.put("split", "0.6")
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1
    # the whole text, once: the transport's sender mark is part of what was pasted
    assert (box.state / "transcript").read_text(encoding="utf-8").count("prova di consegna con una frase abbastanza lunga da avere testa e coda diverse") == 1


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


# -- a text that is not ours may be passing: the person waiting on the command gets a short wait ------------------------

def _captures(box):
    return [line for line in box.calls() if line.startswith("capture-pane")]


def test_a_person_waiting_on_the_command_gets_a_short_wait_for_a_text_that_goes_away(box):
    """TEST 10 (27/10): `jht profile import` answered captain:failed (rc=130) because the Capitano's composer held a
    text that was not provably ours at that second; the same import 100 s later was delivered. A text that goes away
    by itself is waited for, and then the message is delivered whole: pasted once, one Enter, nothing over the text."""
    box.put("composer", "the message another sender of ours is about to submit")
    box.put("foreign_until", "3")
    done = box.run(JHT_TMUX_SEND_FROM="user-console")
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1
    assert len(_captures(box)) > 3, "it looked again while the text was there"


def test_a_text_that_stays_is_still_rc130_after_the_wait_and_nothing_is_pasted_or_pressed(box):
    box.put("composer", "a person's own draft")
    done = box.run(JHT_TMUX_SEND_FROM="user-console", JHT_TMUX_FOREIGN_WAIT="2")
    assert done.returncode == 130 and "NOT delivered" in done.stderr, done.stderr
    assert box.typed() == [] and box.keys("Enter") == []
    assert len(_captures(box)) >= 3, "it waited, looking again, before giving up"
    row = _pending_input(box)[-1]
    assert row["reason"] == "composer_foreign" and row["unsent"].endswith(MESSAGE[-40:])


def test_the_bridges_and_nudges_keep_the_immediate_130(box):
    """Their own loops retry: a wait here would hold the loop of a dozen agents."""
    box.put("composer", "a text that is not ours")
    box.put("foreign_until", "3")
    done = box.run()
    assert done.returncode == 130, done.stderr
    assert box.typed() == [] and len(_captures(box)) < 5


@pytest.mark.parametrize("wait", ["0", "abc", "-3", "1.5"])
def test_the_wait_can_be_switched_off_and_a_bad_value_is_no_wait(box, wait):
    box.put("composer", "a text that is not ours")
    done = box.run(JHT_TMUX_SEND_FROM="user-console", JHT_TMUX_FOREIGN_WAIT=wait)
    assert done.returncode == 130, done.stderr
    assert box.typed() == [] and len(_captures(box)) < 5


def _busy_codex(box, **draw):
    """The Capitano in the middle of a turn (TEST 8, 27/10): the footer is «tab to queue message», and the TUI
    draws what is pasted into the composer late: after `late_captures` looks at the screen (more than the render
    window of an agent at rest), or only when `release` is put there."""
    box.put("layout", "codex")
    box.put("mode", "busy")
    for name, value in draw.items():
        box.put(name, str(value))


def test_a_busy_agent_that_draws_the_paste_late_is_waited_for_and_gets_its_enter(box):
    """Before: the render window of an agent at rest ended, the transport said rc=3 («never shown», the one answer
    that means «maybe dead») and pressed nothing; the text appeared a moment later and waited for the next
    delivery's Enter. The user's chat showed «agent unavailable» for a message that arrived."""
    _busy_codex(box, late_captures=80)        # the window of an agent at rest is about 35 looks
    done = box.run(JHT_TMUX_LATE_RENDER_WAIT="60")
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1, "typed once"
    assert len(box.keys("Enter")) == 1, "and it got its Enter"


def test_a_busy_agent_that_never_draws_it_in_time_is_busy_not_dead_and_the_text_is_not_typed_again(box):
    _busy_codex(box, hold="")                 # drawn only when released: never within the wait
    done = box.run(JHT_TMUX_LATE_RENDER_WAIT="1")
    assert done.returncode == 4, done.stderr          # alive, retry later: pacing does not count it as a death
    assert len(box.typed()) == 1 and box.keys("Enter") == [] and box.keys("Escape") == []
    # the retry finds the text, now drawn, as the pending text of ours: Enter only, never a second paste
    box.put("release")
    again = box.run(JHT_TMUX_LATE_RENDER_WAIT="1")
    assert again.returncode == 0, again.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_a_certain_menu_on_screen_types_nothing_and_never_sends_escape(box):
    box.put("mode", "menu")
    done = box.run()
    assert done.returncode == 3
    assert box.typed() == [] and box.keys("Escape") == [] and box.keys("Enter") == []


def test_an_unrecognised_codex_form_is_pasted_once_and_proven_after_enter(box):
    box.put("mode", "unknown")
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_an_echo_of_paste_before_an_ignored_enter_is_not_a_submit_receipt(box):
    box.put("mode", "unknown-echo")
    box.put("echo_on_paste")
    box.put("enter_ignored")
    done = box.run()
    assert done.returncode != 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_a_localized_structural_menu_receives_no_paste_or_enter(box):
    box.put("mode", "menu-it")
    done = box.run()
    assert done.returncode == 3
    assert box.typed() == [] and box.keys("Enter") == []


def test_a_localized_pondering_form_is_queued_and_proven_after_enter(box):
    box.put("mode", "pondering-it")
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_any_real_text_already_in_the_box_is_never_typed_over_or_submitted(box):
    box.put("composer", "a human draft")
    done = box.run()
    assert done.returncode == 130, done.stderr
    assert box.typed() == [] and box.keys("Enter") == []


def test_an_exact_pending_envelope_is_submitted_without_a_second_paste(box):
    # First attempt leaves the exact, post-fence envelope in the composer.
    # The second transport invocation must attest and reuse it, not paste.
    box.put("enter_ignored")
    assert box.run().returncode == 5
    (box.state / "enter_ignored").unlink()
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 4


def test_an_exact_pending_envelope_retries_enter_only_then_stays_queued(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    done = box.run()
    assert done.returncode == 5, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 6


@pytest.mark.parametrize(("switch", "content"), [
    ("menu_on_paste", ""),
    ("draft_on_paste", "a human draft won the race"),
], ids=["menu", "draft"])
def test_a_change_between_preflight_and_paste_never_gets_an_enter(box, switch, content):
    box.put(switch, content)
    done = box.run()
    assert done.returncode != 0, done.stderr
    assert len(box.typed()) == 1, "the one bracketed paste may race, but is never retried"
    assert box.keys("Enter") == [] and box.keys("Escape") == [] and box.keys("Space") == []
    if switch == "draft_on_paste":
        pasted = next(box.state.glob("pasted.*")).read_text(encoding="utf-8")
        assert pasted.endswith(MESSAGE.rsplit(" ", 1)[-1])
        assert (box.state / "composer").read_text(encoding="utf-8") == content + pasted


# -- C2 · la firma si cerca solo nella casella ------------------------------------------------------------------------

def test_a_signature_in_the_conversation_is_not_a_proof_when_the_keys_are_lost(box):
    """21/10: la firma era gia' nella conversazione, i tasti si sono persi, l'Invio e' partito su una casella
    vuota e il trasporto ha detto «consegnato»."""
    box.put("transcript", MESSAGE + "\n")
    box.put("mute")
    done = box.run()
    assert done.returncode != 0
    assert box.keys("Enter") == [], "nothing is submitted on an empty box"


def test_an_old_nudge_in_the_conversation_does_not_count_for_a_new_one(box):
    nudge = "[MAIL] 1 new message(s) in your mailbox. Run: jht-mail drain"
    box.put("transcript", nudge + "\n")
    box.put("mute")
    done = box.run(message=nudge)
    assert done.returncode != 0 and box.keys("Enter") == []


def test_the_same_text_sent_twice_is_delivered_twice(box):
    assert box.run().returncode == 0
    second = box.run()
    assert second.returncode == 0, second.stderr
    assert len(box.typed()) == 2, "the first one is in the conversation now: the second is still typed and proven"


# -- C3 · «preso» ha una prova ---------------------------------------------------------------------------------------

def test_an_enter_that_is_swallowed_three_times_is_alive_but_mute(box):
    box.put("enter_ignored")
    done = box.run()
    assert done.returncode == 5
    assert len(box.keys("Enter")) == 3


def test_a_busy_pane_alone_is_not_a_proof(box):
    """Before: a pane already busy made the first Enter 'taken' whatever the box still held."""
    box.put("mode", "busy")
    box.put("enter_ignored")
    done = box.run()
    assert done.returncode == 5, done.stderr


def test_a_busy_pane_whose_box_empties_is_taken(box):
    box.put("mode", "busy")
    done = box.run()
    assert done.returncode == 0, done.stderr


def test_an_enter_that_is_ignored_is_retried_with_enter_only(box):
    box.put("enter_ignored")
    done = box.run()
    assert done.returncode == 5, done.stderr
    assert box.keys("Space") == [] and len(box.keys("Enter")) == 3


def test_a_menu_under_the_mark_is_not_an_empty_box(box):
    box.put("mode", "menu")
    done = box.run()
    assert done.returncode != 0, "a permission menu is not 'my text was taken'"
    assert box.keys("Enter") == [] or done.returncode in (3, 5, 7)


# -- C4 · una consegna alla volta per sessione -------------------------------------------------------------------------

def test_two_deliveries_to_the_same_session_do_not_mix(box):
    results = {}

    def go(n, text):
        results[n] = box.run(message=text)

    first = "[@watchdog -> @capitano] [MSG] PRIMO messaggio abbastanza lungo per avere una coda diversa AAAA"
    second = "[@watchdog -> @capitano] [MSG] SECONDO messaggio abbastanza lungo per avere una coda diversa BBBB"
    threads = [threading.Thread(target=go, args=(1, first)), threading.Thread(target=go, args=(2, second))]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert results[1].returncode == 0 and results[2].returncode == 0
    sequence = [("paste" if line.startswith("paste-buffer") else "Enter") for line in box.calls()
                if line.startswith("paste-buffer") or (line.startswith("send-keys") and line.endswith("Enter"))]
    assert sequence == ["paste", "Enter", "paste", "Enter"], sequence


def test_deliveries_to_different_sessions_do_not_wait_for_each_other(box, tmp_path):
    import fcntl

    locks = box.home / "locks"
    locks.mkdir(parents=True)
    held = open(locks / "tmux-send-ANALISTA-1.lock", "a")
    fcntl.flock(held, fcntl.LOCK_EX)
    try:
        started = time.monotonic()
        done = box.run(session="CAPITANO", JHT_TMUX_LOCK_WAIT="1")
        assert done.returncode == 0, done.stderr
        assert time.monotonic() - started < 20
    finally:
        held.close()


def test_a_lock_held_too_long_gives_the_lock_code_and_types_nothing(box):
    import fcntl

    locks = box.home / "locks"
    locks.mkdir(parents=True)
    held = open(locks / "tmux-send-CAPITANO.lock", "a")
    fcntl.flock(held, fcntl.LOCK_EX)
    try:
        started = time.monotonic()
        done = box.run(JHT_TMUX_LOCK_WAIT="1")
        assert done.returncode == 8, done.stderr
        assert time.monotonic() - started < 10, "the wait is bounded, well under the 15 s of the callers"
        assert box.typed() == []
    finally:
        held.close()


def test_the_lock_dies_with_its_holder(box):
    holder = subprocess.Popen([sys.executable, "-I", "-c",
                               "import fcntl,sys,time; f=open(sys.argv[1],'a'); fcntl.flock(f, fcntl.LOCK_EX); print('x', flush=True); time.sleep(60)",
                               str(_lock_path(box))], stdout=subprocess.PIPE, text=True)
    try:
        holder.stdout.readline()
        holder.kill()
        holder.wait()
        done = box.run(JHT_TMUX_LOCK_WAIT="3")
        assert done.returncode == 0, done.stderr
    finally:
        holder.kill()


def _lock_path(box):
    (box.home / "locks").mkdir(parents=True, exist_ok=True)
    return box.home / "locks" / "tmux-send-CAPITANO.lock"


def test_the_header_documents_the_new_codes_and_keeps_the_old_contract():
    text = TRANSPORT.read_text(encoding="utf-8")
    for line in ("#   3 →", "#   5 →", "#   6 → IMPERSONAZIONE", "#   7 →", "#   8 →"):
        assert line in text, line
    assert "_submitted" in text and "_composer_line" in text


# -- C7 · --enter: solo l'Invio, solo sulla firma di QUEL messaggio --------------------------------------------------------

def _enter(box, signature_hex, session="CAPITANO"):
    full = {
        **os.environ,
        "FT": str(box.state),
        "PATH": f"{box.state.parent / 'bin'}:{Path(sys.executable).parent}:/usr/bin:/bin",
        "JHT_HOME": str(box.home),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    full.pop("TMUX", None)
    return subprocess.run([str(TRANSPORT), "--enter", session, signature_hex], capture_output=True, text=True, timeout=60, env=full)


def _stuck_signature(box):
    """A delivery whose Enter is swallowed: exit 5, and the signature of that text on stdout."""
    box.put("enter_ignored")
    done = box.run()
    assert done.returncode == 5, done.stderr
    line = [l for l in done.stdout.splitlines() if l.startswith("JHT_SIGNATURE ")]
    assert len(line) == 1, done.stdout
    (box.state / "enter_ignored").unlink()
    return line[0].split(" ", 1)[1]


def test_enter_is_closed_even_when_the_pending_signature_is_still_visible(box):
    signature = _stuck_signature(box)
    assert bytes.fromhex(signature).decode("utf-8") in MESSAGE[-40:], "the signature is the tail of that text"
    typed_before, enters_before = len(box.typed()), len(box.keys("Enter"))
    done = _enter(box, signature)
    assert done.returncode == 9 and "JHT_REASON retry_unattested" in done.stdout
    assert len(box.typed()) == typed_before, "the text is never typed again"
    assert len(box.keys("Enter")) == enters_before


def test_enter_with_a_draft_plus_the_pending_text_presses_nothing(box):
    signature = _stuck_signature(box)
    box.put("composer", "un testo che ha scritto qualcun altro" + MESSAGE)
    enters_before = len(box.keys("Enter"))
    done = _enter(box, signature)
    assert done.returncode == 9 and "JHT_REASON retry_unattested" in done.stdout
    assert len(box.keys("Enter")) == enters_before


def test_enter_presses_nothing_on_an_empty_composer(box):
    signature = _stuck_signature(box)
    box.put("composer", "")
    enters_before = len(box.keys("Enter"))
    done = _enter(box, signature)
    assert done.returncode == 9 and "JHT_REASON retry_unattested" in done.stdout
    assert len(box.keys("Enter")) == enters_before


def test_enter_presses_nothing_over_a_menu(box):
    signature = _stuck_signature(box)
    box.put("mode", "menu")
    enters_before = len(box.keys("Enter"))
    done = _enter(box, signature)
    assert done.returncode == 9 and "JHT_REASON retry_unattested" in done.stdout
    assert len(box.keys("Enter")) == enters_before


def test_enter_never_presses_when_the_pending_submit_was_swallowed(box):
    signature = _stuck_signature(box)
    box.put("enter_ignored")
    enters_before, spaces_before, typed_before = len(box.keys("Enter")), len(box.keys("Space")), len(box.typed())
    done = _enter(box, signature)
    assert done.returncode == 9 and "JHT_REASON retry_unattested" in done.stdout
    assert len(box.keys("Enter")) == enters_before
    assert len(box.keys("Space")) == spaces_before and len(box.typed()) == typed_before


@pytest.mark.parametrize("bad", ["", "zz", "abc", "41" * 65, "4141; rm -rf /"])
def test_enter_refuses_a_signature_that_is_not_hex_and_touches_nothing(box, bad):
    done = _enter(box, bad)
    assert done.returncode == 1
    assert [c for c in box.calls() if c.startswith("send-keys")] == []


# -- il testo NOSTRO rimasto nella casella: l'Invio, poi la consegna nuova -------------------------------------------

MESSAGE_2 = "[@watchdog -> @capitano] [MSG] il secondo messaggio, che non deve restare incastrato dietro il primo"


BODY_1 = MESSAGE.rsplit("[MSG] ", 1)[1]
BODY_2 = MESSAGE_2.rsplit("[MSG] ", 1)[1]


def _body(box, name):
    """What the pane holds, without the sender mark the transport adds."""
    lines = (box.state / name).read_text(encoding="utf-8").splitlines()
    return [line.rsplit("[MSG] ", 1)[1] if "[MSG] " in line else line for line in lines]


def _pending(box):
    return box.home / "locks" / "tmux-send-pending-CAPITANO.sha"


def test_a_text_of_ours_left_in_the_composer_gets_its_enter_before_the_next_delivery(box):
    box.put("enter_ignored")
    first = box.run()
    assert first.returncode == 5, first.stderr
    assert _body(box, "composer") == [BODY_1] and _pending(box).exists()
    (box.state / "enter_ignored").unlink()
    second = box.run(MESSAGE_2)
    assert second.returncode == 0, second.stderr
    assert _body(box, "transcript") == [BODY_1, BODY_2], "the first got its Enter, then the second was delivered"
    assert len(box.typed()) == 2, "the first text was not pasted a second time"
    assert not _pending(box).exists(), "nothing of ours is left in the composer"


def test_a_confirmed_delivery_leaves_nothing_remembered(box):
    assert box.run().returncode == 0
    assert not _pending(box).exists()


def test_a_draft_that_is_not_the_text_we_left_stays_untouched(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    (box.state / "enter_ignored").unlink()
    box.put("composer", "una bozza scritta da una persona")
    calls_before = len(box.calls())
    second = box.run(MESSAGE_2)
    assert second.returncode == 130, second.stderr
    new_calls = box.calls()[calls_before:]
    assert not any(c.startswith(("paste-buffer", "send-keys")) for c in new_calls), "nothing pasted or pressed"
    assert (box.state / "composer").read_text(encoding="utf-8") == "una bozza scritta da una persona"


def _age_the_pending(box, seconds):
    stamp, *rest = _pending(box).read_text(encoding="utf-8").split()
    _pending(box).write_text(" ".join([str(int(stamp) - seconds), *rest]) + "\n", encoding="utf-8")


def test_a_text_of_ours_an_hour_old_still_gets_its_enter(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    (box.state / "enter_ignored").unlink()
    _age_the_pending(box, 3600)
    second = box.run(MESSAGE_2)
    assert second.returncode == 0, second.stderr
    assert _body(box, "transcript") == [BODY_1, BODY_2]


def test_a_text_of_ours_of_any_age_gets_its_enter_better_late_than_a_deaf_agent(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    (box.state / "enter_ignored").unlink()
    _age_the_pending(box, 5 * 3600)                            # the 5 hours a pane stayed deaf on a real team
    second = box.run(MESSAGE_2)
    assert second.returncode == 0, second.stderr
    assert _body(box, "transcript") == [BODY_1, BODY_2]


def test_every_enter_the_transport_presses_names_its_session_exactly(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    (box.state / "enter_ignored").unlink()
    assert box.run(MESSAGE_2).returncode == 0
    enters = [line for line in box.calls() if line.startswith("send-keys") and line.endswith("Enter")]
    assert enters and all("-t =CAPITANO:" in line for line in enters), enters


def test_a_text_of_ours_that_keeps_ignoring_the_enter_blocks_the_next_one_without_pasting(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    calls_before = len(box.calls())
    second = box.run(MESSAGE_2)
    assert second.returncode == 130, second.stderr
    new_calls = box.calls()[calls_before:]
    assert len([c for c in new_calls if c.startswith("send-keys") and c.endswith("Enter")]) == 3, "Enter only, three times"
    assert not any(c.startswith("paste-buffer") for c in new_calls), "the second was never pasted"
    assert _body(box, "composer") == [BODY_1]


# -- il segnaposto di incolla: un messaggio lungo non e' «una bozza altrui» ----------------------------------------------
# Codex sopra 1000 caratteri disegna «[Pasted Content N chars]» e Claude «[Pasted text #1 +N lines]» al posto del testo:
# il 26/10 un messaggio di 1024 caratteri e' diventato 130 e ha reso sordo un agente per ore.

BIG = "[@watchdog -> @capitano] [MSG] " + " ".join(f"parola{n}" for n in range(1, 260))     # ~2000 characters
BIG_BODY = BIG.rsplit("[MSG] ", 1)[1]
BIG_LINES = "[@watchdog -> @capitano] [MSG] prima riga\n" + "\n".join(f"riga {n} " + "x" * 120 for n in range(1, 12))
assert len(BIG) > 1000 and len(BIG_LINES) > 1000


def _pending_input(box):
    path = box.home / "logs" / "pending-input.jsonl"
    import json
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def _collapse(box, kind, **extra):
    box.put("layout", "codex" if kind == "codex" else "claude")
    box.put("collapse", kind)
    for name, value in extra.items():
        box.put(name, str(value))


@pytest.mark.parametrize("kind", ["codex", "claude"])
def test_a_long_paste_the_tui_keeps_out_of_sight_is_ours_and_gets_its_enter(box, kind):
    _collapse(box, kind)
    done = box.run(BIG)
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1
    assert BIG_BODY in (box.state / "transcript").read_text(encoding="utf-8")
    assert _body(box, "composer") == [] and not _pending(box).exists()


def test_a_long_paste_into_a_codex_that_starts_working_is_still_ours_and_gets_its_enter(box):
    """TEST 5, 27/10: the bridge's 1043-character PACE-GUARD, pasted into a Capitano that was at rest, whose turn
    started 0.1 s later (the Enter of the previous paste starts it). Codex then draws «tab to queue message ... NN%
    context left» as its footer; with that footer unrecognised the composer was no longer «our text» when the
    transport looked again before the Enter (rc=130, composer_changed), and the token stayed in the box until a
    person pressed Enter."""
    _collapse(box, "codex", busy_after=0.12)
    done = box.run(BIG)
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1
    assert _body(box, "composer") == [] and not _pending(box).exists()


def test_a_long_paste_into_a_codex_whose_turn_starts_at_the_paste_is_ours_and_gets_its_enter(box):
    _collapse(box, "codex")
    box.put("turn_on_paste")
    done = box.run(BIG)
    assert done.returncode == 0, done.stderr
    assert len(box.keys("Enter")) == 1 and _body(box, "composer") == []


def test_a_long_paste_into_a_codex_that_is_already_working_is_ours_and_gets_its_enter(box):
    _collapse(box, "codex")
    box.put("mode", "busy")
    done = box.run(BIG)
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1
    assert _body(box, "composer") == []


def test_a_long_message_with_line_breaks_is_ours_on_claude_too(box):
    _collapse(box, "claude")
    done = box.run(BIG_LINES)
    assert done.returncode == 0, done.stderr
    assert len(box.keys("Enter")) == 1


@pytest.mark.parametrize("kind, extra", [("codex", {"collapse_n": 999}), ("claude", {"collapse_n": 99}),
                                         ("codex", {"token_beside": "una bozza accanto"}),
                                         ("claude", {"token_beside": "una bozza accanto"})])
def test_a_paste_token_that_is_not_provably_ours_gets_no_enter_and_is_written_down(box, kind, extra):
    _collapse(box, kind, **extra)
    done = box.run(BIG)
    assert done.returncode == 130, done.stderr
    assert box.keys("Enter") == [] and len(box.typed()) == 1
    rows = _pending_input(box)
    assert rows and rows[-1]["reason"] == "composer_changed" and rows[-1]["session"] == "CAPITANO"
    assert rows[-1]["draft"].endswith(BIG_BODY[-40:])


def test_a_long_text_left_with_its_enter_swallowed_gets_it_with_the_next_delivery(box):
    _collapse(box, "codex")
    box.put("enter_ignored")
    assert box.run(BIG).returncode == 5
    assert "Pasted Content" in (box.state / "composer").read_text(encoding="utf-8")
    (box.state / "enter_ignored").unlink()
    second = box.run(MESSAGE_2)
    assert second.returncode == 0, second.stderr
    transcript = (box.state / "transcript").read_text(encoding="utf-8")
    assert BIG_BODY in transcript and BODY_2 in transcript
    assert len(box.typed()) == 2, "the long text was not pasted a second time"


def test_the_token_of_the_real_team_gets_its_enter_with_no_new_delivery_needed(box):
    # a 1024-character message, the way it was left on the 26/10
    _collapse(box, "codex")
    box.put("enter_ignored")
    assert box.run("x" * 1024).returncode == 5
    assert (box.state / "composer").read_text(encoding="utf-8") == "[Pasted Content 1024 chars]"
    (box.state / "enter_ignored").unlink()
    done = subprocess.run([str(TRANSPORT), "--flush-ours", "CAPITANO"], capture_output=True, text=True, timeout=60,
                          env=_env(box))
    assert done.returncode == 0, done.stderr
    assert (box.state / "composer").read_text(encoding="utf-8") == "" and not _pending(box).exists()


def test_a_token_the_registry_does_not_explain_is_left_alone_and_the_message_is_written_down(box):
    _collapse(box, "codex")
    box.put("composer", "[Pasted Content 1024 chars]")             # nobody of ours left it: no record
    calls_before = len(box.calls())
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert not any(c.startswith(("paste-buffer", "send-keys")) for c in box.calls()[calls_before:])
    rows = _pending_input(box)
    assert rows[-1]["reason"] == "composer_foreign" and rows[-1]["unsent"].endswith(BODY_2)


def test_an_old_two_field_record_cannot_prove_a_token_ours(box):
    _collapse(box, "codex")
    box.put("enter_ignored")
    assert box.run(BIG).returncode == 5
    stamp, digest, *_ = _pending(box).read_text(encoding="utf-8").split()
    _pending(box).write_text(f"{stamp} {digest}\n", encoding="utf-8")   # the record of the transport before this one
    (box.state / "enter_ignored").unlink()
    calls_before = len(box.calls())
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert not any(c.startswith(("paste-buffer", "send-keys")) for c in box.calls()[calls_before:])


@pytest.mark.parametrize("draft_after", ["half", "typing"])
def test_every_130_after_the_paste_is_written_down(box, draft_after):
    if draft_after == "half":
        box.put("split", "30")
        done = box.run(JHT_TMUX_PARTIAL_WAIT="1")
        reason = "half_drawn"
    else:
        box.put("draft_on_paste", "bozza ")
        done = box.run()
        reason = "composer_changed"
    assert done.returncode == 130, done.stderr
    assert _pending_input(box)[-1]["reason"] == reason


def test_a_message_not_typed_because_the_composer_is_somebody_elses_is_written_down(box):
    box.put("composer", "una bozza scritta da una persona")
    done = box.run()
    assert done.returncode == 130 and "NOT delivered" in done.stderr
    row = _pending_input(box)[-1]
    assert row["reason"] == "composer_foreign" and row["unsent"].endswith(BODY_1) and "draft" not in row


# -- --flush-ours: l'Invio sul testo PROVATO nostro, per chi non consegna (la chat dell'utente) -------------------------

def _env(box):
    return {**os.environ, "FT": str(box.state), "JHT_HOME": str(box.home), "JHT_TMUX_LOCK_WAIT": "1",
            "PATH": f"{box.state.parent / 'bin'}:{Path(sys.executable).parent}:/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"}


def _flush(box):
    return subprocess.run([str(TRANSPORT), "--flush-ours", "CAPITANO"], capture_output=True, text=True, timeout=60, env=_env(box))


def test_flush_ours_presses_enter_on_the_text_we_left_and_writes_nothing(box):
    box.put("enter_ignored")
    assert box.run().returncode == 5
    (box.state / "enter_ignored").unlink()
    typed_before, rows_before = len(box.typed()), (box.home / "logs" / "messages.jsonl").read_text(encoding="utf-8")
    done = _flush(box)
    assert done.returncode == 0, done.stderr
    assert _body(box, "transcript") == [BODY_1] and not _pending(box).exists()
    assert len(box.typed()) == typed_before, "nothing pasted"
    assert (box.home / "logs" / "messages.jsonl").read_text(encoding="utf-8") == rows_before, "no message logged"


def test_flush_ours_does_nothing_on_a_free_composer_and_touches_no_key(box):
    done = _flush(box)
    assert done.returncode == 0, done.stderr
    assert [c for c in box.calls() if c.startswith("send-keys")] == []


def test_flush_ours_leaves_a_text_that_is_not_ours(box):
    box.put("composer", "una bozza scritta da una persona")
    done = _flush(box)
    assert done.returncode == 130, done.stderr
    assert [c for c in box.calls() if c.startswith("send-keys")] == []
    assert (box.state / "composer").read_text(encoding="utf-8") == "una bozza scritta da una persona"


def test_flush_ours_stays_out_of_a_menu_and_says_when_the_enter_is_swallowed(box):
    box.put("mode", "menu")
    assert _flush(box).returncode == 3
    box.put("mode", "normal")
    box.put("enter_ignored")
    assert box.run().returncode == 5
    done = _flush(box)
    assert done.returncode == 5 and len(box.keys("Enter")) >= 6, done.stderr
    assert _body(box, "composer") == [BODY_1]


def test_flush_ours_refuses_a_wrong_call(box):
    for args in (["--flush-ours"], ["--flush-ours", "A", "B"]):
        done = subprocess.run([str(TRANSPORT), *args], capture_output=True, text=True, timeout=30, env=_env(box))
        assert done.returncode == 1
    assert [c for c in box.calls() if c.startswith("send-keys")] == []


# -- review del primo commit: il segnaposto di Claude conta RIGHE, dal registro non prova niente --------------------------------

def test_a_claude_token_left_by_us_is_not_proved_ours_by_the_registry_alone(box):
    """The token of Claude counts LINES, which a person can paste too: from the registry it is explained only within
    the window of JHT_TMUX_TOKEN_WINDOW seconds (see the tests of the signed composer); older, it is somebody's paste."""
    _collapse(box, "claude")
    box.put("enter_ignored")
    assert box.run(BIG_LINES).returncode == 5
    token = (box.state / "composer").read_text(encoding="utf-8")
    assert token.startswith("[Pasted text #1 +")
    (box.state / "enter_ignored").unlink()
    _age_the_pending(box, 3600)
    # a person pastes a text of the same number of lines: the same kind of token, the same number
    box.put("composer", token.replace("#1", "#2"))
    calls_before = len(box.calls())
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert not any(c.startswith(("paste-buffer", "send-keys")) for c in box.calls()[calls_before:]), "no Enter on it"
    assert _pending_input(box)[-1]["reason"] == "composer_foreign"


def test_flush_ours_does_not_press_a_claude_token_either(box):
    _collapse(box, "claude")
    box.put("enter_ignored")
    assert box.run(BIG_LINES).returncode == 5
    (box.state / "enter_ignored").unlink()
    done = _flush(box)
    assert done.returncode == 130, done.stderr


# -- pending-input.jsonl carries the text of messages: private, and long enough for the long ones ----------------------

@pytest.mark.skipif(os.name == "nt", reason="mode bits")
def test_pending_input_is_private_and_a_world_readable_file_of_an_older_version_is_tightened(box):
    box.put("composer", "una bozza scritta da una persona")
    logs = box.home / "logs"
    assert box.run().returncode == 130
    assert (logs / "pending-input.jsonl").stat().st_mode & 0o777 == 0o600
    (logs / "pending-input.jsonl").chmod(0o644)
    assert box.run().returncode == 130
    assert (logs / "pending-input.jsonl").stat().st_mode & 0o777 == 0o600


@pytest.mark.skipif(os.name == "nt", reason="mode bits")
def test_the_folder_pending_input_creates_is_private_and_the_one_that_was_there_is_left_alone(box, tmp_path):
    box.put("composer", "una bozza scritta da una persona")
    fresh = tmp_path / "fresh-home"
    assert box.run(JHT_HOME=str(fresh)).returncode == 130
    assert (fresh / "logs").stat().st_mode & 0o777 == 0o700
    old = tmp_path / "old-home"
    (old / "logs").mkdir(parents=True)
    (old / "logs").chmod(0o755)
    assert box.run(JHT_HOME=str(old)).returncode == 130
    assert (old / "logs").stat().st_mode & 0o777 == 0o755, "a logs folder shared with others is not changed"


def test_a_long_message_is_recorded_up_to_64_kib_and_no_further(box):
    box.put("composer", "una bozza scritta da una persona")
    done = box.run("[@watchdog -> @capitano] [MSG] " + "x" * 70000)
    assert done.returncode == 130
    row = _pending_input(box)[-1]
    assert len(row["unsent"]) == 65536
    for locale in ("", ".it", ".de", ".es", ".fr", ".hu", ".pt"):
        text = (TRANSPORT.parent / f"SKILL{locale}.md").read_text(encoding="utf-8")
        assert "64 KiB" in text, locale


# -- Signed text left in the composer: ours goes in behind it, one Enter for both (operator, 28/10) --------------------------------
# (a) an empty composer: as ever (all the tests above). (b) only signed text: pasted behind, one Enter.
# (c) text nobody signed, a person typing: 130, nothing pasted or pressed. (d) a grey suggestion is an empty box.

USER_OLD = "[@utente -> @capitano] [CHAT] ⟦UTENTE·ab12cd⟧ la mia domanda rimasta nella casella ⟦/UTENTE·ab12cd⟧"
AGENT_OLD = "[@mentor -> @capitano] [MSG] un messaggio vecchio rimasto nella casella"


def _signed_taken(box, old, extra_env=None, pasted_by_us=None):
    """`old` is in the box. A message with the person's marks is signed on its face; one without marks only when the
    transport pasted exactly that text itself (`pasted_by_us`: the text its record has the fingerprint of)."""
    box.put("composer", old)
    done = box.run(MESSAGE_2, **(extra_env or {}))
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1, "one paste, one Enter for both"
    transcript = (box.state / "transcript").read_text(encoding="utf-8")
    first = old.split("] ", 2)[2][:20]
    assert first in transcript and BODY_2 in transcript, "the old one and the new one, together"
    assert transcript.index(first) < transcript.index(BODY_2), "the old one first"
    assert _body(box, "composer") == [], "nothing is left in the box"
    assert "pasting behind it" in done.stderr
    assert not _pending(box).exists()


def _left_by_us(box, message=MESSAGE, **env):
    """The transport pastes `message` and the Enter is swallowed: the text stays in the box, its fingerprint is in the record
    (and the record of the last pending text is dropped, as if a later delivery of ours had replaced it)."""
    box.put("enter_ignored")
    assert box.run(message, **env).returncode == 5
    (box.state / "enter_ignored").unlink()
    _pending(box).unlink()
    return (box.state / "composer").read_text(encoding="utf-8")


def test_b_a_message_of_an_agent_the_transport_pasted_and_nobody_submitted_is_not_a_draft_ours_goes_in_behind_it(box):
    left = _left_by_us(box)
    done = box.run(MESSAGE_2)
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 2 and len(box.keys("Enter")) == 4, "the second paste, and one Enter (three were swallowed)"
    transcript = (box.state / "transcript").read_text(encoding="utf-8")
    assert BODY_1 in transcript and BODY_2 in transcript and transcript.index(BODY_1) < transcript.index(BODY_2)
    assert _body(box, "composer") == [] and "pasting behind it" in done.stderr and left


def test_b_the_persons_words_with_their_marks_left_unsent_are_not_a_draft_either(box):
    _signed_taken(box, USER_OLD)


def test_b_the_persons_words_followed_by_a_message_of_ours_are_taken_together(box):
    left = _left_by_us(box)
    box.put("composer", USER_OLD + left)
    done = box.run(MESSAGE_2)
    assert done.returncode == 0, done.stderr
    assert len(box.keys("Enter")) == 4 and BODY_2 in (box.state / "transcript").read_text(encoding="utf-8")
    assert _body(box, "composer") == []


def test_b_a_signed_message_on_codex_is_taken_behind_too(box):
    box.put("layout", "codex")
    left = _left_by_us(box)
    done = box.run(MESSAGE_2)
    assert done.returncode == 0, done.stderr
    assert BODY_2 in (box.state / "transcript").read_text(encoding="utf-8") and left


def test_b_the_wait_of_the_person_on_the_command_does_not_apply_a_signed_text_is_not_waited_for(box):
    box.put("composer", USER_OLD)
    done = box.run(MESSAGE_2, JHT_TMUX_SEND_FROM="user-console", JHT_TMUX_FOREIGN_WAIT="5")
    assert done.returncode == 0, done.stderr
    assert len(_captures(box)) < 15, "no look-again loop for a text that is signed"


def test_c_an_envelope_without_marks_the_transport_did_not_paste_is_the_persons_text(box):
    """A message between agents has no end of its own: a person could be typing at its tail. Without the fingerprint of
    exactly that text in the record, it is not signed: 130, nothing pasted or pressed."""
    box.put("composer", AGENT_OLD)
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert box.typed() == [] and box.keys("Enter") == []
    assert (box.state / "composer").read_text(encoding="utf-8") == AGENT_OLD


def test_c_a_message_of_ours_with_a_sentence_half_typed_after_it_is_not_signed(box):
    """The case that was measured: «[@a -> @b] [MSG] vecchio» followed by a person's half sentence. The fingerprint is of
    the message, not of the message and the words; the box is a person's, and the half sentence does not go out."""
    left = _left_by_us(box)
    box.put("composer", left + " mi sono dimenticato di dire che")
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert len(box.typed()) == 1, "nothing pasted after the first run"
    assert len(box.keys("Enter")) == 3, "only the three swallowed Enter of the first run: none for this one"
    assert "mi sono dimenticato" in (box.state / "composer").read_text(encoding="utf-8")


def test_c_a_fingerprint_older_than_a_day_is_no_fingerprint(box):
    _left_by_us(box)
    path = box.home / "locks" / "tmux-send-fingerprints-CAPITANO.log"
    old = int(__import__("time").time()) - 2 * 86400
    path.write_text("".join(f"{old} {line.split()[1]}\n" for line in path.read_text().splitlines()), encoding="utf-8")
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr


@pytest.mark.parametrize("draft", [
    "una bozza scritta da una persona",
    "ciao " + AGENT_OLD,                                              # a person's words before a head
    USER_OLD + " e poi aggiungo io questo",                         # typed after the closing mark
    "[@utente -> @capitano] [CHAT] ⟦UTENTE·ab12cd⟧ parole non chiuse",   # a mark that is not closed
    "[@utente -> @capitano] [CHAT] parole senza il recinto",       # the person's turn without its fence
    "[@utente -> @capitano] [CHAT] ⟦UTENTE·ab12cd⟧ x ⟦/UTENTE·ZZ⟧",   # closed by another id
    "⟦/UTENTE·ab12cd⟧ [@mentor -> @capitano] [MSG] hi",              # a closing mark with no opening one
    "[Pasted text #1 +4 lines]",                                      # a paste nobody's record explains
    "[Pasted Content 999 chars]",
], ids=["hand", "before-head", "after-close", "unclosed", "unfenced", "wrong-id", "stray-close", "claude-token", "codex-token"])
def test_c_text_that_is_not_all_signed_is_somebodys_typing_nothing_pasted_nothing_pressed(box, draft):
    box.put("composer", draft)
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert box.typed() == [] and box.keys("Enter") == []
    assert _pending_input(box)[-1]["reason"] == "composer_foreign"
    assert (box.state / "composer").read_text(encoding="utf-8") == draft, "the box is as it was"


def test_b_a_signed_text_that_changes_under_the_paste_gets_no_enter(box):
    """The base is checked again after the paste: if the old text changed (a person typed into it), no Enter."""
    box.put("composer", USER_OLD)
    box.put("draft_on_paste", " e io scrivo")
    done = box.run(MESSAGE_2)
    assert done.returncode == 130, done.stderr
    assert box.keys("Enter") == [] and box.keys("Escape") == []


def test_b_the_old_signed_text_taken_by_its_sender_meanwhile_leaves_ours_alone_in_the_box(box):
    """The relation accepts ours with no base at all: the sender of the old one pressed its Enter while we pasted."""
    box.put("composer", USER_OLD)
    box.put("foreign_until", "1")        # the box empties at the next look: its sender took it
    done = box.run(MESSAGE_2)
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1


def test_b_ours_pasted_behind_signed_text_and_never_taken_is_still_ours_for_the_next_enter(box):
    """The record of what was pasted covers the two together: the flush that presses the Enter of a turn held for a
    busy agent recognises the box as ours (base and message), and a later delivery presses only that Enter."""
    box.put("composer", USER_OLD)
    box.put("enter_ignored")
    assert box.run(MESSAGE_2).returncode == 5
    record = _pending(box).read_text(encoding="utf-8").split()
    assert len(record) == 6, "time, hash of both, chars, newlines, hash and length of the base"
    (box.state / "enter_ignored").unlink()
    done = _flush(box)
    assert done.returncode == 0, done.stderr
    transcript = (box.state / "transcript").read_text(encoding="utf-8")
    assert USER_OLD.split("] ", 2)[2][:20] in transcript and BODY_2 in transcript
    assert not _pending(box).exists()


def test_b_a_claude_token_the_record_explains_inside_the_window_is_signed_text(box):
    """The long paste of an earlier delivery of ours that nobody submitted: Claude draws a token with the number of
    lines, which the record of the transport explains for JHT_TMUX_TOKEN_WINDOW seconds (600). Ours goes behind it."""
    _collapse(box, "claude")
    box.put("enter_ignored")
    assert box.run(BIG_LINES).returncode == 5
    (box.state / "enter_ignored").unlink()
    token = (box.state / "composer").read_text(encoding="utf-8")
    assert token.startswith("[Pasted text #1 +")
    box.put("composer", token.replace("#1", "#2"))   # not the one the transport itself knows, but the same lines
    enters, pastes = len(box.keys("Enter")), len(box.typed())
    done = box.run(MESSAGE_2)
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == pastes + 1 and len(box.keys("Enter")) == enters + 1, "pasted behind it, one Enter"
    assert _body(box, "composer") == [], "nothing is left in the box"


def test_b_a_codex_token_the_record_explains_is_signed_text_whatever_its_age(box):
    _collapse(box, "codex")
    box.put("enter_ignored")
    assert box.run(BIG).returncode == 5
    (box.state / "enter_ignored").unlink()
    token = (box.state / "composer").read_text(encoding="utf-8")
    assert token.startswith("[Pasted Content ")
    box.put("composer", token)
    _age_the_pending(box, 86400)
    done = box.run(MESSAGE_2)
    assert done.returncode == 0, done.stderr

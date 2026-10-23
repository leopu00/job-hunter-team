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
# mute (i tasti si perdono), lag (secondi prima che il testo compaia), enter_ignored, enter_needs_space.
S="$FT"; echo "$*" >> "$S/calls"
cmd="$1"; shift
case "$cmd" in
  has-session|list-panes|show-options) exit 0 ;;
  capture-pane)
    mode=$(cat "$S/mode" 2>/dev/null || echo normal)
    case "$mode" in
      shell) printf 'user@host ~ $ \n'; exit 0 ;;
      menu) [ -f "$S/transcript" ] && cat "$S/transcript"; printf '❯ 1. Yes\n  2. No\n'; exit 0 ;;
    esac
    [ -f "$S/transcript" ] && cat "$S/transcript"
    [ "$mode" = busy ] && echo '◦ Working (3s • esc to interrupt)'
    printf '❯ %s\n' "$(cat "$S/composer" 2>/dev/null)" ;;
  send-keys)
    while [ "$1" = "-t" ]; do shift 2; done
    key="$1"
    if [ "$key" = "-l" ]; then
      [ -f "$S/mute" ] && exit 0
      if [ -f "$S/lag" ]; then (sleep "$(cat "$S/lag")"; printf '%s' "$2" >> "$S/composer") & exit 0; fi
      printf '%s' "$2" >> "$S/composer"; exit 0
    fi
    if [ "$key" = "Enter" ]; then
      [ -f "$S/enter_ignored" ] && exit 0
      if [ -f "$S/enter_needs_space" ] && [ ! -f "$S/space_seen" ]; then exit 0; fi
      if [ -s "$S/composer" ]; then cat "$S/composer" >> "$S/transcript"; echo >> "$S/transcript"; fi
      : > "$S/composer"; exit 0
    fi
    [ "$key" = "Space" ] && : > "$S/space_seen"
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
            "JHT_TMUX_RENDER_POLLS": "4",
            "JHT_TMUX_COMPOSER_POLLS": "2",
            "PYTHONDONTWRITEBYTECODE": "1",
            **env,
        }
        full.pop("TMUX", None)
        return subprocess.run([str(TRANSPORT), session, message], capture_output=True, text=True, timeout=120, env=full)

    def calls():
        return (state / "calls").read_text(encoding="utf-8").splitlines()

    def keys(name):
        return [line for line in calls() if line.startswith("send-keys") and line.endswith(name)]

    def typed():
        return [line for line in calls() if line.startswith("send-keys") and " -l " in line]

    return type("Box", (), {"put": staticmethod(put), "run": staticmethod(run), "calls": staticmethod(calls),
                            "keys": staticmethod(keys), "typed": staticmethod(typed), "state": state, "home": tmp_path / "home"})


# -- C1 · il testo si scrive UNA volta ---------------------------------------------------------------------------------

def test_a_delivery_types_once_and_presses_enter_once(box):
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1 and len(box.keys("Enter")) == 1 and box.keys("Escape") == []


def test_a_slow_render_is_waited_for_not_typed_again(box):
    box.put("lag", "1.5")
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.typed()) == 1, "the text appeared late: it is not typed a second time"
    assert box.keys("Escape") == []


def test_a_text_that_never_shows_is_typed_once_and_nothing_is_pressed(box):
    box.put("mute")
    done = box.run()
    assert done.returncode == 3, "the one 'maybe dead' signal pacing-bridge counts on keeps its code"
    assert len(box.typed()) == 1
    assert box.keys("Enter") == [] and box.keys("Escape") == [] and box.keys("Space") == []


def test_no_input_box_on_screen_types_nothing_and_sends_one_escape(box):
    box.put("mode", "shell")
    done = box.run()
    assert done.returncode == 3
    assert box.typed() == [] and len(box.keys("Escape")) == 1 and box.keys("Enter") == []


def test_our_own_text_already_in_the_box_is_not_typed_again(box):
    box.put("composer", MESSAGE)
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert box.typed() == [] and len(box.keys("Enter")) == 1


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


def test_a_cold_first_enter_is_recovered_with_space_and_enter(box):
    box.put("enter_needs_space")
    done = box.run()
    assert done.returncode == 0, done.stderr
    assert len(box.keys("Space")) == 1 and len(box.keys("Enter")) == 2


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
    sequence = [("-l" if " -l " in line else "Enter") for line in box.calls()
                if line.startswith("send-keys") and (" -l " in line or line.endswith("Enter"))]
    assert sequence == ["-l", "Enter", "-l", "Enter"], sequence


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

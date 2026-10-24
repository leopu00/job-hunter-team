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
    if [ -f "$S/lag" ]; then (sleep "$(cat "$S/lag")"; cat "$S/buffer.$name" >> "$S/composer") & exit 0; fi
    cat "$S/buffer.$name" > "$S/pasted.$name"
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
      if [ -s "$S/composer" ]; then cat "$S/composer" >> "$S/transcript"; echo >> "$S/transcript"; fi
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
        return [line for line in calls() if line.startswith("paste-buffer")]

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

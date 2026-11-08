"""jht-tmux-send: il testo si scrive UNA volta, la firma si cerca SOLO nella casella, «preso» ha
bisogno di una prova, e una consegna alla volta per sessione (C1-C4 della revisione del 23/10).

Il trasporto VERO contro un finto `tmux` a copione: lo stato del finto sta in una cartella (la
casella, la conversazione, un modo) e registra ogni chiamata. Il caso che ha fatto sparire un
messaggio il 21/10 e' `test_a_signature_in_the_conversation_is_not_a_proof_when_the_keys_are_lost`.
"""
# Contract groups in test_tmux_send_delivery_*.py share the unchanged fake and
# function-scoped box below; each case owns its state and JHT_HOME in tmp_path.
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
  display-message)
    # the process of the pane (JHT-T195): the format asked for says which of the two files answers
    case "$*" in
      *pane_pid*) cat "$S/pane_pid" 2>/dev/null ;;
      *pane_current_command*) cat "$S/pane_cmd" 2>/dev/null ;;
    esac
    exit 0 ;;
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


# -- a text that is not ours may be passing: the person waiting on the command gets a short wait ------------------------

def _captures(box):
    return [line for line in box.calls() if line.startswith("capture-pane")]


def _busy_codex(box, **draw):
    """The Capitano in the middle of a turn (TEST 8, 27/10): the footer is «tab to queue message», and the TUI
    draws what is pasted into the composer late: after `late_captures` looks at the screen (more than the render
    window of an agent at rest), or only when `release` is put there."""
    box.put("layout", "codex")
    box.put("mode", "busy")
    for name, value in draw.items():
        box.put(name, str(value))


# -- C2 · la firma si cerca solo nella casella ------------------------------------------------------------------------

# -- C3 · «preso» ha una prova ---------------------------------------------------------------------------------------

# -- C4 · una consegna alla volta per sessione -------------------------------------------------------------------------

def _lock_path(box):
    (box.home / "locks").mkdir(parents=True, exist_ok=True)
    return box.home / "locks" / "tmux-send-CAPITANO.lock"


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


def _age_the_pending(box, seconds):
    stamp, *rest = _pending(box).read_text(encoding="utf-8").split()
    _pending(box).write_text(" ".join([str(int(stamp) - seconds), *rest]) + "\n", encoding="utf-8")


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


# -- --flush-ours: l'Invio sul testo PROVATO nostro, per chi non consegna (la chat dell'utente) -------------------------

def _env(box):
    return {**os.environ, "FT": str(box.state), "JHT_HOME": str(box.home), "JHT_TMUX_LOCK_WAIT": "1",
            "PATH": f"{box.state.parent / 'bin'}:{Path(sys.executable).parent}:/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"}


def _flush(box):
    return subprocess.run([str(TRANSPORT), "--flush-ours", "CAPITANO"], capture_output=True, text=True, timeout=60, env=_env(box))


# -- review del primo commit: il segnaposto di Claude conta RIGHE, dal registro non prova niente --------------------------------

# -- pending-input.jsonl carries the text of messages: private, and long enough for the long ones ----------------------

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


# -- Un messaggio BREVE non si riconosce nel pie' di pagina della TUI (TEST 19e: «1» all'Assistente) ---------------

# -- JHT-T195 · una shell nuda non e' un agente: si guarda il PROCESSO del pannello ------------------------------------

FAKE_PS = r"""#!/bin/bash
# Finto ps: risponde alla colonna chiesta con i file dello stato (pgid, tpgid, args del processo del pannello).
S="$FT"; field=""
while [ $# -gt 0 ]; do
  case "$1" in -o) field="$2"; shift 2 ;; *) shift ;; esac
done
case "$field" in
  pgid=) cat "$S/ps_pgid" 2>/dev/null ;;
  tpgid=) cat "$S/ps_tpgid" 2>/dev/null ;;
  args=) cat "$S/ps_args" 2>/dev/null ;;
esac
exit 0
"""


def pane_process(box, command, pgid="4242", tpgid="4242", args="-bash", pid="4242"):
    """The process the pane holds, as tmux and ps would say it."""
    ps = box.state.parent / "bin" / "ps"
    ps.write_text(FAKE_PS, encoding="utf-8")
    ps.chmod(0o755)
    box.put("pane_pid", pid + "\n")
    box.put("pane_cmd", command + "\n")
    box.put("ps_pgid", pgid + "\n")
    box.put("ps_tpgid", tpgid + "\n")
    box.put("ps_args", args + "\n")

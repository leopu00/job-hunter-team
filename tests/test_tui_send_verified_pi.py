"""tui-helpers.sh (kickoff, welcome watchdog) on the TUI of Pi.

Pi's composer has no marker: the draft sits between two rules, with the totals row under them, and a turn running is
«⠹ Working» on the top rule, not an «esc to interrupt» row. The message a Pi delivered stays in the conversation right
above the rules, so «the probe is in the last 10 rows» no longer means «the draft is still in the composer».
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pi_screens import FOLDER, RULE, TOTALS, WORKING

ROOT = Path(__file__).resolve().parent.parent
HELPERS = ROOT / ".launcher" / "tui-helpers.sh"

# FAKE_ENTER: accept | lose:N | never.  FAKE_BUSY=1: after an accepted Enter the top rule says Working.
FAKE_TMUX = r"""#!/usr/bin/env bash
d="$FAKE_DIR"
printf '%s\n' "$*" >> "$d/calls"
sub="$1"; shift
literal=0; key=""
while [ $# -gt 0 ]; do
  case "$1" in -t) shift 2 ;; -p) shift ;; -l) literal=1; shift ;; *) key="$1"; shift ;; esac
done
case "$sub" in
  send-keys)
    if [ "$literal" = 1 ]; then printf '%s' "$key" >> "$d/composer"
    elif [ "$key" = Enter ]; then
      n=$(( $(cat "$d/enters" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/enters"
      accept=0
      case "$FAKE_ENTER" in accept) accept=1 ;; lose:*) [ "$n" -gt "${FAKE_ENTER#lose:}" ] && accept=1 ;; esac
      if [ "$accept" = 1 ] && [ -s "$d/composer" ]; then
        { echo; cat "$d/composer"; echo; } >> "$d/transcript"
        : > "$d/composer"
        [ "${FAKE_BUSY:-0}" = 1 ] && : > "$d/working"
      fi
    fi ;;
  capture-pane)
    cat "$d/transcript" 2>/dev/null
    if [ -f "$d/working" ]; then echo "__WORKING__"; else echo "__RULE__"; fi
    cat "$d/composer" 2>/dev/null; echo
    echo "__RULE__"
    echo "__FOLDER__"
    echo "__TOTALS__"
    for n in 1 2 3 4 5 6; do echo; done ;;   # capture-pane pads the window with empty rows
  *) exit 0 ;;
esac
"""
FAKE_TMUX = (FAKE_TMUX.replace("__WORKING__", WORKING).replace("__RULE__", RULE)
             .replace("__FOLDER__", FOLDER).replace("__TOTALS__", TOTALS))
MSG = "[@utente -> @scout-1] [MSG] Startup. Wait for the first [BRIDGE TICK]."
LONG_MSG = "\n".join(["[@system -> @scout-1] [WELCOME-USER]", ""]
                     + [f"{i}. step {i} of the protocol, idempotent, " + "x" * 40 for i in range(1, 12)])


@pytest.fixture(params=[p for p in (shutil.which("dash"), shutil.which("bash")) if p] or [None],
                ids=lambda p: Path(p).name if p else "none")
def shell(request):
    if sys.platform == "win32" or request.param is None:
        pytest.skip("il launcher gira nel container Linux")
    return request.param


class Fake:
    def __init__(self, tmp_path):
        self.dir = tmp_path / "tui"
        self.dir.mkdir()
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        (self.bin / "tmux").write_text(FAKE_TMUX, encoding="utf-8", newline="\n")
        (self.bin / "tmux").chmod(0o755)
        (self.bin / "sleep").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8", newline="\n")
        (self.bin / "sleep").chmod(0o755)

    def send(self, shell, msg=MSG, *, enter="accept", busy=False):
        env = {**os.environ, "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}", "FAKE_DIR": str(self.dir),
               "FAKE_ENTER": enter, "FAKE_BUSY": "1" if busy else "0", "MSG": msg}
        env.pop("TUI_SUBMIT_TRIES", None)
        script = f'. "{HELPERS}"\ntui_send_verified SCOUT-1 "$MSG"\necho "rc=$?"\n'
        done = subprocess.run([shell, "-c", script], capture_output=True, text=True, env=env, timeout=60)
        rc = [line for line in done.stdout.splitlines() if line.startswith("rc=")]
        assert rc, done.stdout + done.stderr
        return int(rc[-1][3:])

    def calls(self):
        return (self.dir / "calls").read_text(encoding="utf-8").splitlines()

    def typed(self):
        return sum(1 for c in self.calls() if c.startswith("send-keys") and " -l " in c)

    def enters(self):
        return sum(1 for c in self.calls() if c.startswith("send-keys") and c.endswith(" Enter"))


@pytest.mark.parametrize("msg", [MSG, LONG_MSG], ids=["short", "long"])
def test_an_enter_pi_takes_is_sent_ok_though_the_message_stays_in_the_conversation(shell, tmp_path, msg):
    fake = Fake(tmp_path)
    assert fake.send(shell, msg) == 0
    assert fake.typed() == 1 and fake.enters() == 1


def test_a_lost_enter_is_recovered_by_repeating_only_the_enter(shell, tmp_path):
    fake = Fake(tmp_path)
    assert fake.send(shell, enter="lose:1") == 0
    assert fake.typed() == 1 and fake.enters() == 2


def test_an_enter_never_taken_is_not_reported_as_sent(shell, tmp_path):
    fake = Fake(tmp_path)
    assert fake.send(shell, enter="never") == 2
    assert fake.typed() == 1


def test_a_message_already_delivered_and_left_in_the_conversation_is_typed_again_on_a_reinjection(shell, tmp_path):
    """The welcome watchdog reinjects when the flag did not appear: the earlier copy is above the rules, not in the box."""
    fake = Fake(tmp_path)
    (fake.dir / "transcript").write_text("\n" + MSG + "\n", encoding="utf-8")
    assert fake.send(shell) == 0
    assert fake.typed() == 1 and fake.enters() == 1


def test_a_draft_left_in_the_composer_gets_only_its_enter(shell, tmp_path):
    fake = Fake(tmp_path)
    (fake.dir / "composer").write_text(MSG, encoding="utf-8")
    assert fake.send(shell) == 0
    assert fake.typed() == 0 and fake.enters() == 1


def test_a_turn_that_starts_counts_as_accepted_even_if_the_enter_is_all_we_can_tell(shell, tmp_path):
    fake = Fake(tmp_path)
    assert fake.send(shell, busy=True) == 0

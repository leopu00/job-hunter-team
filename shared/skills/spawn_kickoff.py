"""Background kickoff: preserve legacy providers, gate Codex through verified delivery."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import time

from agent_chat import composer_snapshot
from codex_dialog import Tmux, PANE, inactive, inspect_session, managed, unsupported_dialog
from delivery_status import report
from tmux_send_run import run


def kickoff(session, prompt, provider, home, *, tmux=None, sleeper=time.sleep, deliver=None):
    tmux = tmux or Tmux()
    if provider not in ("codex", "openai"):
        for delay, text in ((6, "Enter"), (3, "Enter"), (3, "Enter"),
                            (4, prompt), (1, "Enter"), (2, "Enter")):
            sleeper(delay)
            tmux.call("send-keys", "-t", session, text)
        return True
    sleeper(6)
    if inactive(home, session):
        return False
    if not managed(session):
        raise ValueError("invalid managed session")
    pane = tmux.call("display-message", "-p", "-t", f"={session}:", "#{pane_id}").strip()
    if not PANE.fullmatch(pane):
        raise ValueError("invalid managed pane")
    inspect_session(home, session, pane, tmux)
    capture = tmux.capture(pane)
    kind, _busy = composer_snapshot(capture)
    if (inactive(home, session) or not tmux.identity(pane).endswith(":codex")
            or unsupported_dialog(capture) or kind != "empty"):
        report("message_not_delivered", home=home)
        return False
    # Only a verified empty composer reaches the normal delivery transport.
    if deliver is None:
        binary = os.environ.get("JHT_TMUX_SENDER") or "jht-tmux-send"
        delivered = run([binary, session, prompt], 120).returncode == 0
    else:
        delivered = deliver(session, prompt)
    if not delivered:
        report("message_not_delivered", home=home)
    return delivered


def main():
    home = os.environ.get("JHT_HOME") or Path.home() / ".jht"
    try:
        result = kickoff(os.environ["JHT_SPAWN_SESSION"], os.environ["JHT_SPAWN_PROMPT"],
                         os.environ.get("JHT_SPAWN_PROVIDER", ""), home)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        report("message_not_delivered", home=home)
        return 3
    return 0 if result else 3


if __name__ == "__main__":
    sys.exit(main())

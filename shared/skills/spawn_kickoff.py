"""Background kickoff: preserve legacy providers, gate Codex and Pi through verified delivery."""
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


PI_READY_WAIT_S = 90
PI_READY_STEP_S = 3


def session_harness(session, tmux=None):
    """The harness start-agent.sh wrote on the session (`@jht_harness`), "" for the CLI of the provider."""
    try:
        return (tmux or Tmux()).call("show-options", "-qv", "-t", f"={session}", "@jht_harness").strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def pi_ready(session, pane, tmux, sleeper):
    """Pi's first start downloads its tools (fd, ripgrep) before it draws the composer: wait for it, empty."""
    waited = 0
    while True:
        capture = tmux.capture(pane)
        kind, _busy = composer_snapshot(capture)
        if kind == "empty" and not unsupported_dialog(capture):
            return True
        if waited >= PI_READY_WAIT_S:
            return False
        sleeper(PI_READY_STEP_S)
        waited += PI_READY_STEP_S


def kickoff(session, prompt, provider, home, *, tmux=None, sleeper=time.sleep, deliver=None, harness=""):
    tmux = tmux or Tmux()
    pi = "pi" in (harness, provider)   # the CLI the spawner names, or the harness written on the session
    if provider not in ("codex", "openai") and not pi:
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
    if pi:
        # no Codex dialog to recover on Pi's TUI; what matters is an empty composer to paste into
        if not pi_ready(session, pane, tmux, sleeper) or inactive(home, session):
            report("message_not_delivered", home=home)
            return False
    else:
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
        session = os.environ["JHT_SPAWN_SESSION"]
        result = kickoff(session, os.environ["JHT_SPAWN_PROMPT"], os.environ.get("JHT_SPAWN_PROVIDER", ""), home,
                         harness=os.environ.get("JHT_SPAWN_HARNESS") or session_harness(session))
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        report("message_not_delivered", home=home)
        return 3
    return 0 if result else 3


if __name__ == "__main__":
    sys.exit(main())

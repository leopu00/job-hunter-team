#!/usr/bin/env python3
"""Bounded recovery of the live model reminder, without changing models."""
from __future__ import annotations

import os
import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import time

from agent_chat import composer_snapshot, delivery_gate, strip_terminal_codes
from agent_control import SINGLETONS, NO_ACTIONS, NUMBERED_RE, REVIEWER_RE
from agent_pause import is_paused
from codex_dialog_state import DialogState, report
from tmux_send_run import run

TITLE = "Approaching rate limits"
FOOTER = "Press enter to confirm or esc to go back"
OPTION = re.compile(r"^\s*([›>]?)\s*(\d+)\.\s+(.+?)\s*$")
PANE = re.compile(r"^%\d+$")


def model_menu(pane):
    """Only a complete reminder at the visible pane's bottom earns key input."""
    rows = [strip_terminal_codes(row).strip() for row in pane.splitlines() if row.strip()]
    if not rows or rows[-1] != FOOTER or TITLE not in rows[-8:]:
        return None
    start = len(rows) - 1 - rows[::-1].index(TITLE)
    menu = rows[start:]
    if len(menu) != 6 or not menu[1].startswith("Switch to ") or not menu[1].endswith("?"):
        return None
    options = [OPTION.fullmatch(row) for row in menu[2:5]]
    if not all(options) or len({match[2] for match in options}) != 3:
        return None
    labels = [match[3] for match in options]
    keep = [index for index, label in enumerate(labels) if label == "Keep current model"]
    switch = [label for label in labels if label.startswith("Switch to ")]
    never = [label for label in labels if label.startswith("Keep current model (never show again)")]
    selected = [index for index, match in enumerate(options) if match[1]]
    if len(keep) != 1 or len(switch) != 1 or len(never) != 1 or len(selected) != 1:
        return None
    return tuple(labels), selected[0], keep[0]


def unsupported_dialog(pane):
    if model_menu(pane) is not None or delivery_gate(pane) == "blocked":
        return True
    kind, busy = composer_snapshot(pane)
    if kind != "none" or busy:
        return False
    rows = "\n".join(strip_terminal_codes(row).strip() for row in pane.splitlines()[-12:])
    return any(word in rows for word in (TITLE, "Press enter to confirm", "Do you trust",
                                         "Update available", "Sign in to Codex", "Sign in with ChatGPT"))


class Tmux:
    def call(self, *args):
        result = subprocess.run(["tmux", *args], capture_output=True, text=True, timeout=5)
        if result.returncode:
            raise OSError("tmux operation failed")
        return result.stdout

    def capture(self, pane):
        return self.call("capture-pane", "-p", "-t", pane)

    def identity(self, pane):
        return self.call("display-message", "-p", "-t", pane,
                         "#{pane_id}:#{pane_pid}:#{pane_current_command}").strip()

    def key(self, pane, key):
        self.call("send-keys", "-t", pane, key)


def recover(tmux, pane, identity, expected, *, timeout=4, sleeper=time.sleep, clock=time.monotonic):
    """Recheck every selection move; one confirmation, never a retry on the menu."""
    labels, selected, target = expected
    deadline = clock() + timeout
    while selected != target:
        if clock() >= deadline:
            return "codex_dialog_timeout"
        if tmux.identity(pane) != identity or model_menu(tmux.capture(pane)) != (labels, selected, target):
            return "codex_dialog_changed"
        tmux.key(pane, "Down" if selected < target else "Up")
        selected += 1 if selected < target else -1
        sleeper(0.15)
    if clock() >= deadline:
        return "codex_dialog_timeout"
    if tmux.identity(pane) != identity or model_menu(tmux.capture(pane)) != (labels, target, target):
        return "codex_dialog_changed"
    tmux.key(pane, "Enter")
    while clock() < deadline:
        sleeper(0.2)
        if tmux.identity(pane) != identity:
            return "codex_dialog_changed"
        capture = tmux.capture(pane)
        kind, busy = composer_snapshot(capture)
        if not unsupported_dialog(capture) and (kind in ("empty", "text") or busy):
            return "codex_dialog_recovered"
    return "codex_dialog_timeout"


def notify_captain(text):
    binary = os.environ.get("JHT_TMUX_SENDER") or "jht-tmux-send"
    try:
        return run([binary, "CAPITANO", text], 10).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def inspect_session(home, session, pane, tmux, *, notify=notify_captain, recovery=recover):
    if inactive(home, session):
        return
    store = DialogState(home, session, pane)
    with store.locked() as state:
        if state is None:
            return
        identity = tmux.identity(pane)
        if not identity.endswith(":codex"):
            return
        if state.get("pane") != identity:
            state.clear()
        capture = tmux.capture(pane)
        menu = model_menu(capture)
        if not menu and not unsupported_dialog(capture):
            kind, busy = composer_snapshot(capture)
            if state and (kind in ("empty", "text") or busy):
                state["attempted"] = False
                if state["code"] not in ("codex_dialog_recovered", "codex_dialog_ready"):
                    store.publish(state, "codex_dialog_ready", session, notify)
                else:
                    store.save(state)
            return
        if not state:
            state.clear()
            state.update(pane=identity, attempted=False, code="codex_dialog_pending", notices=0)
        if menu and not state["attempted"]:
            state["attempted"] = True
            state.update(code="codex_dialog_pending", notices=0)
            store.save(state)
            if not report(home, "codex_dialog_pending"):
                raise OSError("dialog diagnostic unavailable")
            code = recovery(tmux, pane, identity, menu)
        else:
            code = state["code"] if state["attempted"] else "codex_dialog_unrecognized"
        store.publish(state, code, session, notify)


def managed(session):
    return session in SINGLETONS or session in NO_ACTIONS or bool(NUMBERED_RE.fullmatch(session)
                                                                 or REVIEWER_RE.fullmatch(session))


def inactive(home, session=None):
    from standby import is_active

    home = Path(home)
    if any((home / flag).exists() for flag in (".team-halted.flag", ".weekly-halt.flag")):
        return True
    return is_active(home=home) or (session is not None and is_paused(session, home=home))


def tick(home, tmux=None):
    home = Path(home)
    if inactive(home):
        return 0
    tmux = tmux or Tmux()
    failed = False
    try:
        rows = tmux.call("list-panes", "-a", "-F", "#{session_name}\t#{pane_id}").splitlines()
        if len(rows) > 100:
            raise ValueError("too many managed panes to check in one tick")
        for row in rows:
            session, pane = row.split("\t", 1)
            if managed(session) and PANE.fullmatch(pane):
                try:
                    inspect_session(home, session, pane, tmux)
                except (OSError, ValueError, subprocess.SubprocessError):
                    failed = True
                    report(home, "codex_dialog_io_error")
    except (OSError, ValueError, subprocess.SubprocessError):
        report(home, "codex_dialog_io_error")
        return 3
    return 3 if failed else 0


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("tick", "status"), default="tick", nargs="?")
    parser.add_argument("session", nargs="?")
    args = parser.parse_args(argv)
    home = os.environ.get("JHT_HOME") or Path.home() / ".jht"
    if args.command == "tick":
        return tick(home)
    if not args.session or not managed(args.session):
        parser.error("status requires a managed session")
    try:
        tmux = Tmux()
        pane = tmux.call("display-message", "-p", "-t", f"={args.session}:", "#{pane_id}").strip()
        if not PANE.fullmatch(pane):
            raise ValueError("invalid managed pane")
        data = DialogState(home, args.session, pane).read()
        if data and data["pane"] != tmux.identity(pane):
            data = {}
    except (OSError, ValueError, subprocess.SubprocessError):
        report(home, "codex_dialog_io_error")
        return 3
    print(json.dumps({"session": args.session, "last_observation": data.get("code", "unobserved"),
                      "at": data.get("at")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())

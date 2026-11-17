#!/usr/bin/env python3
"""The watchdog's delivery bridge; shell callers delegate without interpreting an exit."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path

from delivery_retry import MAX_ATTEMPTS, WakeBudget, atomic_text, retry_delay
from delivery_status import checked, report
from text_language import team_language_line
from tmux_send_run import run

KICKOFF = {
    "scout": "Resume the main loop: start from CIRCLE 1 of the candidate profile and notify the Analysts after each insert (never wait for a batch).",
    "analista": "Resume the main loop using the db_query.py next-for-analista queue.",
    "scorer": "Resume the main loop using the db_query.py next-for-scorer queue.",
    "scrittore": "Resume the main loop using the db_query.py next-for-scrittore queue.",
    "closer": "Resume the main loop from apply_gate.py queue. A stop on the user's choice stays stopped; a wait for answers is worked out (CL-05, CL-08).",
}


def send(binary, session, text, *, transport=run):
    return checked(lambda: transport([binary, session, text], 120).returncode == 0)


def kickoff(session, role, *, sender=None, sleeper=time.sleep):
    from agent_pause import is_paused
    from standby import is_active

    sleeper(12)
    home = os.environ.get("JHT_HOME") or Path.home() / ".jht"
    if is_paused(session, home=home) or is_active(home=home):
        return False
    body = KICKOFF.get(role, "Resume the main loop as instructed by your prompt.")
    message = (
        f"[@watchdog -> @{session.lower()}] [MSG] {team_language_line()} "
        f"Session recreated by the watchdog. {body}"
    )
    binary = os.environ.get("JHT_TMUX_SENDER") or "jht-tmux-send"
    # A finite bootstrap retry: a newly created pane may still be its shell.
    for number in range(MAX_ATTEMPTS):
        if number:
            sleeper(retry_delay(number))
        if is_paused(session, home=home) or is_active(home=home):
            return False
        delivered = checked(lambda: sender(session, message)) if sender else send(binary, session, message)
        if delivered:
            return True
    return False


def nudge(session, role, *, sender=None, sleeper=time.sleep):
    """A worker that is alive and has not worked while positions wait in its queue: one message to resume the loop.

    Not the kickoff of a new pane (no wait for the shell, no «recreated»): the session is old, it was never briefed, or its turn
    ended with nothing to do. Never to a paused agent or in standby."""
    from agent_pause import is_paused
    from standby import is_active

    home = os.environ.get("JHT_HOME") or Path.home() / ".jht"
    if is_paused(session, home=home) or is_active(home=home):
        return False
    body = KICKOFF.get(role, "Resume the main loop as instructed by your prompt.")
    message = (
        f"[@watchdog -> @{session.lower()}] [RIPRENDI] {team_language_line()} "
        f"Positions are waiting in the queue of your role and nothing has been worked for a while. {body}"
    )
    binary = os.environ.get("JHT_TMUX_SENDER") or "jht-tmux-send"
    for number in range(MAX_ATTEMPTS):
        if number:
            sleeper(retry_delay(number))
        if is_paused(session, home=home) or is_active(home=home):
            return False
        delivered = checked(lambda: sender(session, message)) if sender else send(binary, session, message)
        if delivered:
            return True
    return False


def process_alert(key, what, cap, window, text, now):
    """Write one alert about a process that is not an agent to `logs/process-alerts.jsonl`. False when it cannot be written."""
    try:
        home = Path(os.environ.get("JHT_HOME") or Path.home() / ".jht")
        log = home / "logs"
        log.mkdir(parents=True, exist_ok=True)
        entry = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)), "key": key, "what": what, "cap": cap,
                 "window_s": window, "text": text}
        with open(log / "process-alerts.jsonl", "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return True
    except OSError:
        report("delivery_state_unavailable")
        return False


def bridge(stamp, cooldown, what, cap, window, binary, *, sender=None, now=None):
    """True on delivery, None on suppression, False on an attempted delivery error."""
    path = Path(stamp)
    now = time.time() if now is None else now
    try:
        try:
            last = int(path.read_text().strip())
        except FileNotFoundError:
            last = 0
        if now - last < cooldown:
            return None
        budget = WakeBudget(
            os.environ.get("JHT_HOME") or Path.home() / ".jht", filename="watchdog-delivery-retries.json"
        )
        key = hashlib.sha256(f"{path.name}:{last}:{what}".encode()).hexdigest()
        # Requests throughout one failure episode keep its cap exhausted.
        # A full flap window with no escalation requests rearms the next episode.
        if not budget.reserve(key, now, idle_reset_after=window):
            return None
    except (OSError, ValueError, TypeError, KeyError):
        report("delivery_state_unavailable")
        return False
    text = (
        f"[WATCHDOG] {what} keeps dying (>{cap} respawns in {window//60} min). "
        "Automatic respawn has been STOPPED to prevent a crash loop. Manual diagnosis is required: "
        "check $JHT_HOME/logs/*-bridge.log. The Mantenitore will still run a complete canary on the next sweep."
    )
    # A bridge, a Telegram bot or a process of pid1 is not an agent: the Capitano cannot repair it and spent turns answering that it
    # does nothing (build10, Mac: the live screen). The alert goes to the log of the process alerts, which the Mantenitore's sweep reads
    # (its canary is the check of these processes); no agent is written to. `sender` and `binary` stay in the signature for the callers.
    if not process_alert(path.name, what, cap, window, text, now):
        return False
    try:
        atomic_text(path, str(int(now)) + "\n")
    except OSError:
        report("delivery_state_unavailable")
        return False
    return True


def main(argv=None):
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    start = sub.add_parser("kickoff")
    start.add_argument("session")
    start.add_argument("role")
    wake = sub.add_parser("nudge")
    wake.add_argument("session")
    wake.add_argument("role")
    alert = sub.add_parser("bridge")
    for name in ("stamp", "cooldown", "what", "cap", "window", "binary"):
        alert.add_argument(name, type=int if name in ("cooldown", "cap", "window") else str)
    plain = sub.add_parser("send")
    for name in ("binary", "session", "text"):
        plain.add_argument(name)
    args = parser.parse_args(argv)
    if args.command == "kickoff":
        return 0 if kickoff(args.session, args.role) else 3
    if args.command == "nudge":
        return 0 if nudge(args.session, args.role) else 3
    if args.command == "send":
        return 0 if send(args.binary, args.session, args.text) else 3
    result = bridge(args.stamp, args.cooldown, args.what, args.cap, args.window, args.binary)
    return 3 if result is False else 0


if __name__ == "__main__":
    sys.exit(main())

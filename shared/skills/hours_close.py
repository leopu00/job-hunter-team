#!/usr/bin/env python3
"""hours_close.py — at the close of the working window the workers stop, in order, and they start again at the next one.

Until now the close was a message to the Captain (`_maybe_offhours_stop`: «apply rule 11»), and nobody stopped the workers: the Scouts,
the Analisti and the Scorer loop by themselves, and a team that had the window closed at 18:00 had eleven sessions at 18:06 and went on
spending. The brakes that exist look at the starts (the off-hours brake of the queue, the gate of the respawn),
not at who is already running.

Every look of the bridge, outside the window (the person's schedule, and no spending override):

  * each worker (SCOUT-n, ANALISTA-n, SCORER-n, SCRITTORE-n, CLOSER-n) is told once to finish the task it is on, save what it
    produced, start no other and stop: the message waits for the end of its turn, nothing is interrupted;
  * a worker told at least IDLE_AFTER_SEC ago whose pane is idle is closed (its session; the roster keeps it `active`, so the
    restore of the watchdog brings it back at the opening: roster_restore.py, every five minutes, and the respawn of the roster);
  * a worker still busy RESEND_AFTER_SEC after is told again, once; it is never cut in the middle of a turn.

When the window is open again the workers that were told and are still alive are told to resume. The Captain, the Assistente, the
Mentor, the Sentinella and the Dottore are not touched here (the first ones read the hours themselves; the Dottore's watchdog stops).
Never raises: a look that fails is a look lost.
"""
from __future__ import annotations

import re
import subprocess
import time

WORKER = re.compile(r"^(SCOUT|ANALISTA|SCORER|SCRITTORE|CLOSER)-(\d+)$")
IDLE_AFTER_SEC = 240        # told at one look, closed at the next one at the soonest (a look is five minutes)
RESEND_AFTER_SEC = 2700     # a worker still busy 45 minutes after is told again, once
BUSY = re.compile(r"esc to interrupt|to interrupt|ctrl\+c to stop|\bworking\b\s*[….]", re.I)

CLOSE_TEXT = ("[BRIDGE] [OUT OF HOURS] The working window is closed. Finish the task you are on and save what it produced (write the "
              "result, leave no step half done), then DO NOT start another task and DO NOT loop again: stop and wait. Idle workers "
              "are closed by the system and brought back when the window opens. Do not answer this message.")
RESUME_TEXT = ("[BRIDGE] [RIPRENDI] The working window is open again: resume your main loop where you left it.")


def _sessions():
    out = subprocess.run(["tmux", "ls", "-F", "#{session_name}"], capture_output=True, text=True, timeout=10).stdout
    return [line.strip() for line in out.splitlines() if line.strip()]


def _idle(session):
    """True only when the pane shows no sign of a turn running; any doubt is busy."""
    done = subprocess.run(["tmux", "capture-pane", "-p", "-t", "=%s:" % session, "-S", "-20"], capture_output=True, text=True, timeout=10)
    return done.returncode == 0 and bool(done.stdout.strip()) and BUSY.search(done.stdout) is None


def _kill(session):
    return subprocess.run(["tmux", "kill-session", "-t", "=%s" % session], capture_output=True, timeout=10).returncode == 0


def _outside(api, run):
    """True when the schedule the person set says closed. The spending override (burn intent) keeps the gate open, as everywhere."""
    if getattr(run, "_bi_on", False):
        return False
    if not getattr(run, "within_hours", True):
        return True
    try:
        from working_hours import is_within_working_hours
        return not is_within_working_hours()
    except Exception:  # noqa: BLE001 - a schedule that cannot be read is no reason to close the team
        return False


def step(api, run, outside=None, sessions=None, idle=None, send=None, kill=None, now=None):
    """One look. Returns {"told": [...], "closed": [...], "resumed": [...]}. Never raises."""
    out = {"told": [], "closed": [], "resumed": []}
    try:
        now = time.time() if now is None else now
        state = run.state.setdefault("hours_close", {})
        closed_window = _outside(api, run) if outside is None else outside
        live = [s for s in (sessions if sessions is not None else _sessions()) if WORKER.match(s or "")]
        send = send or api.jht_tmux_send
        told = state.setdefault("told", {})
        if not closed_window:
            for name in sorted(told):
                if name in live and send(name, RESUME_TEXT):
                    out["resumed"].append(name)
            if told:
                print("[bridge V6] HOURS-CLOSE window open again: resumed %s" % (", ".join(out["resumed"]) or "nobody"))
            state["told"] = {}
            return out
        idle = idle or _idle
        kill = kill or _kill
        for name in live:
            if name not in told:
                if send(name, CLOSE_TEXT):
                    told[name] = {"at": now, "again": False}
                    out["told"].append(name)
                continue
            seen = told[name]
            if now - seen["at"] >= IDLE_AFTER_SEC and idle(name):
                if kill(name):
                    out["closed"].append(name)
                    told.pop(name)
            elif now - seen["at"] >= RESEND_AFTER_SEC and not seen.get("again") and send(name, CLOSE_TEXT):
                seen["again"] = True
        for name in [n for n in told if n not in live and n not in out["closed"]]:
            told.pop(name)      # gone by itself (or closed by someone else): nothing to resume
        if out["told"] or out["closed"]:
            print("[bridge V6] HOURS-CLOSE outside the working window: told %s, closed %s"
                  % (", ".join(out["told"]) or "nobody", ", ".join(out["closed"]) or "nobody"))
        return out
    except Exception as error:  # noqa: BLE001
        print("[bridge V6] WARN hours close: %s" % error)
        return out

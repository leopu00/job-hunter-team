#!/usr/bin/env python3
"""session_context.py — how full the context of an agent's session is, and no panel left open on it.

The Dottore's round (skill session-refresh, step 1.5) measured the context by typing `/status` into the pane of
every session, capturing, and pressing ONE Escape without looking at the screen. A card that stayed open under the
composer made every wake-up of the throttle come back rc=3 until the session was recreated (a first run, 29/10: eleven
sessions down to seven, the database still for an hour).

This is the one way to read it:

  1. From the logs the CLI writes (agent_state.py): Codex and Kimi say the window and the tokens of their last call,
     so the percentage is read with NO key sent and nothing on the screen to close.
  2. Only for Claude, whose logs do not say the window, the panel: `/context`, read, then closed with Escape
     UNTIL THE SCREEN SHOWS AN EMPTY COMPOSER AGAIN (three presses at most). If it does not, the answer says
     `closed: false` and the exit code is 4: the Dottore must say so and leave the session to the Capitano, not
     go on as if nothing was open.

It never types into a pane that is not idle with an empty composer (a draft, a turn, a menu), and never presses
anything on a turn that has started (Escape would interrupt it).

The number is the share USED, always. The Codex card says `N% left` (the FREE share) and Claude's panel says
`24.9k/1m tokens (2%)` (used). On a 31/10 round of a beta VPS the Dottore recreated three coordinators that were 3 hours
old and 8-42% used on their cards, with 86/96/86 as context_pct in its journal: about 4 points of the weekly budget
for a recreation round. So the round no longer decides by eye: with `--age-h` the answer carries the DECISION
(refresh or skip, and why) computed here, with `used_pct` and `left_pct` side by side, a card that says the free
share is turned into the used one, and a context that could not be measured is a skip, not a recreation on age (the
24 h hard cap stays the safety net).

Usage:
  python3 session_context.py SCORER-2 [--provider claude|codex|kimi] [--age-h 3.2]
  → {"session": "scorer-2", "pct": 41.0, "source": "log"|"panel"|"none", "closed": true, "reason": "...",
     "decision": {"action": "refresh"|"skip", "reason": "ttl"|"context"|"lowctx"|"unmeasured",
                  "used_pct": 41.0, "left_pct": 59.0}}          (decision only with --age-h)
Exit: 0 read (or nothing to read, no panel touched) · 4 a panel was opened and is still open.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

import agent_chat  # noqa: E402
import agent_state  # noqa: E402
import doctor_journal  # noqa: E402

PANEL_COMMANDS = {"claude": "/context"}             # the providers whose context only the panel tells
RENDER_WAIT_S = 3.0
CLOSE_WAIT_S = 0.7
CLOSE_PRESSES = 3
_CONTEXT_LINE = re.compile(r"[0-9.]+k?/[0-9.]+[km] tokens \((\d+)%\)")
# The cards that say the FREE share (Codex: «Context window: 80% left (51.7K used / 258K)»).
_LEFT_LINE = re.compile(r"(\d+(?:\.\d+)?)%\s+(?:left|remaining|free)\b", re.IGNORECASE)
REFRESH_ABOVE_PCT = 50.0       # a session is recreated for its context only when MORE than this share is used
DEFAULT_TTL_H = 24.0           # JHT_AGENT_HARD_CAP_H: the hard cap; below it only MORE than 50% used asks for a recreation


def used_from_text(text: str) -> Optional[float]:
    """The share of the context USED that a screen says, whichever way it says it, or None.

    `24.9k/1m tokens (2%)` is the used share as it stands; `80% left` is the free one and means 20% used. The used form
    wins when both are on the screen.
    """
    used = _CONTEXT_LINE.findall(text)
    if used:
        return float(used[-1])
    left = _LEFT_LINE.findall(text)
    if left:
        return round(max(0.0, min(100.0, 100.0 - float(left[-1]))), 1)
    return None


def decide(pct: Optional[float], age_h: Optional[float], ttl_h: float = DEFAULT_TTL_H,
           threshold: float = REFRESH_ABOVE_PCT) -> dict:
    """Whether the round recreates a session, from the share of its context USED and its age.

    The TTL comes first and overrides everything (a session at 4% after 30 hours is recreated). Below it, only a
    context MORE than `threshold` used asks for a recreation; one that was not measured is not a reason (age alone
    is the TTL's job): a recreation costs about 4 points of the weekly budget.
    """
    used = float(pct) if isinstance(pct, (int, float)) and not isinstance(pct, bool) else None
    shown = {"used_pct": used, "left_pct": round(100.0 - used, 1) if used is not None else None}
    if age_h is not None and age_h >= ttl_h:
        return {"action": "refresh", "reason": "ttl", **shown}
    if used is None:
        return {"action": "skip", "reason": "unmeasured", **shown}
    if used > threshold:
        return {"action": "refresh", "reason": "context", **shown}
    return {"action": "skip", "reason": "lowctx", **shown}


def _tmux(*args: str) -> bool:
    try:
        return subprocess.run(["tmux", *args], capture_output=True, timeout=10, check=False).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def pct_from_log(session: str, home: Optional[Path] = None, now: Optional[float] = None) -> Optional[float]:
    """The percentage the CLI's own logs give, or None (not an agent, no window written, logs unreadable)."""
    uid = session.strip().lower()
    home = home or agent_state.jht_home()
    created = agent_state.tmux_sessions().get(uid)
    if created is None or agent_state.agent_dir(home, uid) is None:
        return None
    try:
        verdict = agent_state.derive(uid, home, created, now if now is not None else time.time())
    except Exception:  # noqa: BLE001 — a log that cannot be read is no reading
        return None
    pct = (verdict.get("context") or {}).get("pct")
    return float(pct) if isinstance(pct, (int, float)) and not isinstance(pct, bool) else None


def _idle(session: str):
    """(pane, ok): the screen, and whether it is a session that takes keys now (empty composer, no turn, no menu)."""
    pane = agent_chat.capture_pane(session)
    if pane is None:
        return None, False
    _state, busy = agent_chat.composer_snapshot(pane)
    return pane, (not busy) and agent_chat.delivery_gate(pane) == "empty"


def close_panel(session: str, presses: int = CLOSE_PRESSES, wait: float = CLOSE_WAIT_S) -> tuple[bool, str]:
    """Escape until the screen shows an empty composer. (closed, reason): `closed` only when it is proved."""
    for _ in range(presses):
        pane = agent_chat.capture_pane(session)
        if pane is None:
            return False, "pane_unreadable"
        if agent_chat.composer_snapshot(pane)[1]:
            return False, "turn_started"          # Escape would interrupt it
        gate = agent_chat.delivery_gate(pane)
        if gate == "empty":
            return True, "closed"
        if gate == "text":
            return False, "draft"                 # a draft appeared while the panel was open: Escape could clear it
        if not _tmux("send-keys", "-t", "=" + session + ":", "Escape"):
            return False, "send_failed"
        time.sleep(wait)
    pane = agent_chat.capture_pane(session)
    if pane is not None and agent_chat.delivery_gate(pane) == "empty":
        return True, "closed"
    return False, "panel_still_open"


def pct_from_panel(session: str, command: str, render_wait: float = RENDER_WAIT_S) -> dict:
    pane, ok = _idle(session)
    if not ok:
        return {"pct": None, "source": "none", "closed": True, "reason": "not_idle"}   # nothing was typed
    target = "=" + session + ":"
    if not (_tmux("send-keys", "-t", target, "-l", command) and _tmux("send-keys", "-t", target, "Enter")):
        closed, why = close_panel(session)
        return {"pct": None, "source": "none", "closed": closed, "reason": "send_failed" if closed else why}
    time.sleep(render_wait)
    shown = agent_chat.capture_pane(session) or ""
    pct = used_from_text(agent_chat.strip_terminal_codes(shown))
    closed, why = close_panel(session)
    return {"pct": pct, "source": "panel" if pct is not None else "none", "closed": closed,
            "reason": "read" if pct is not None and closed else (why if not closed else "unparsed")}


def read(session: str, provider: str = "", home: Optional[Path] = None) -> dict:
    out = {"session": session.strip().lower()}
    pct = pct_from_log(session, home)
    if pct is not None:
        return {**out, "pct": pct, "source": "log", "closed": True, "reason": "read"}
    command = PANEL_COMMANDS.get(provider.strip().lower())
    if command is None:
        return {**out, "pct": None, "source": "none", "closed": True, "reason": "no_log_no_key_sent"}
    return {**out, **pct_from_panel(session, command)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("session")
    ap.add_argument("--provider", default="")
    ap.add_argument("--age-h", type=float, default=None,
                    help="the session's age in hours: adds the decision (refresh or skip, and why)")
    args = ap.parse_args(argv)
    result = read(args.session, args.provider)
    if args.age_h is not None:
        try:
            ttl_h = float(os.environ.get("JHT_AGENT_HARD_CAP_H", DEFAULT_TTL_H))
        except ValueError:
            ttl_h = DEFAULT_TTL_H
        result["decision"] = decide(result.get("pct"), args.age_h, ttl_h)
        # Left for doctor_journal.py: the row of the journal and the right to recreate come from THIS, not from the model.
        result["decision_saved"] = doctor_journal.save_decision(args.session, result["decision"])
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["closed"] else 4


if __name__ == "__main__":
    sys.exit(main())

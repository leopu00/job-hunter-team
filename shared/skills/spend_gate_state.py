#!/usr/bin/env python3
"""spend_gate_state.py — is the spending brake holding the team right now? (the file the pi spend gate reads)

The pi spend gate (shared/runtime/pi-harness/spend-gate.js) HOLDS every message that arrives while the brake's pause is up
(`logs/daily-halt.flag` with reason `pi_spend_cap`): the message is handled and dropped, and the sender cannot tell. The brief of a
Scout started during a pause was dropped that way (banco build9, second round: four Scouts started at 19:39 «unbriefed
am leeren Prompt», the pause lifted a quarter of an hour later and nobody sent it again).

A sender of a first message (the kickoff of a started worker, the recovery message of the watchdog) therefore waits for the pause to
lift. The reading is the gate's own: a plain file of ours, at most 64 KiB, JSON with reason `pi_spend_cap`; anything else is no pause.

  spend_gate_state.py paused            exit 0 while the brake holds the team, 1 otherwise
  spend_gate_state.py wait [--max S]    waits (every 15 s) until the pause lifts: exit 0 lifted or none, 1 still paused after S seconds
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

REASON = "pi_spend_cap"
FLAG_MAX_BYTES = 64 * 1024
POLL_S = 15.0


def paused(home=None) -> bool:
    """True while the brake holds the team. Never raises: a reading that fails is no pause (the gate says the same)."""
    root = home or os.environ.get("JHT_HOME")
    if not root:
        return False
    path = Path(root) / "logs" / "daily-halt.flag"
    try:
        if path.is_symlink() or not path.is_file():
            return False
        size = path.stat().st_size
        if size <= 0 or size > FLAG_MAX_BYTES:
            return False
        payload = json.loads(path.read_text(encoding="utf-8"))
        return isinstance(payload, dict) and payload.get("reason") == REASON
    except (OSError, ValueError):
        return False


def wait_until_lifted(max_s: float, home=None, sleeper=time.sleep, clock=time.monotonic) -> bool:
    """True when the pause is lifted (or there was none) within `max_s` seconds, False when it still holds at the end."""
    deadline = clock() + max(0.0, float(max_s))
    while paused(home):
        if clock() >= deadline:
            return False
        sleeper(min(POLL_S, max(deadline - clock(), 0.01)))
    return True


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    command = argv[0] if argv else "paused"
    if command == "paused":
        return 0 if paused() else 1
    if command == "wait":
        limit = 6 * 3600.0
        if "--max" in argv:
            try:
                limit = float(argv[argv.index("--max") + 1])
            except (IndexError, ValueError):
                return 2
        return 0 if wait_until_lifted(limit) else 1
    print("usage: spend_gate_state.py paused | wait [--max SECONDS]", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())

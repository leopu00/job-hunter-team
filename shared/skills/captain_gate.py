#!/usr/bin/env python3
"""captain_gate.py — is it time for the Capitano? A new user does the onboarding with the Assistente FIRST.

`jht team start` used to light everything at once, the Capitano included, whatever the profile: with an empty profile
the Capitano can do nothing (no profile, no worker to start) and, awake, it still spends: 1.10 USD of 1.33 USD in 31
calls in the first test of a clean server. So the Capitano (and with it the rest of the squad, which only the Capitano
scales) waits until the onboarding has closed.

The onboarding is closed when ANY of these holds (`reason`):
  * `ready_flag`   the Assistente wrote `$JHT_HOME/profile/ready.flag` (it does when the profile has the target role, the
                   place and a language: skill onboarding-flow);
  * `phase`        the first run is already past awaiting_profile (burst or steady): an installation that works, or an
                   update of one, never loses its Capitano;
  * `profile_fit`  the profile already passes the gate to start the search (a profile that existed before the flag);
  * `override`     JHT_CAPTAIN_BEFORE_ONBOARDING=1 (an operator starting it by hand, a test);
  * `unknown`      the state cannot be read: it starts, as it always did.
Otherwise `onboarding_open`: only the Assistente (and the daemons) run.

  python3 captain_gate.py        # {"captain_due": bool, "reason": ..., "phase": ...}; exit 0 = due, 1 = wait
Same contract as `first_run.py mentor-due`; the CLI (`jht team start`) and the agent watchdog both ask it.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def check() -> dict:
    phase = None
    try:
        import first_run
        if os.environ.get("JHT_CAPTAIN_BEFORE_ONBOARDING") == "1":
            return {"captain_due": True, "reason": "override", "phase": None}
        flag = first_run._path("JHT_HOME") / "profile" / "ready.flag"
        phase = first_run.status().get("phase")
        if flag.is_file() and not flag.is_symlink():
            return {"captain_due": True, "reason": "ready_flag", "phase": phase}
        if phase in (first_run.PHASE_BURST, first_run.PHASE_STEADY):
            return {"captain_due": True, "reason": "phase", "phase": phase}
        if first_run._profile_imported() is not None:
            return {"captain_due": True, "reason": "profile_fit", "phase": phase}
        return {"captain_due": False, "reason": "onboarding_open", "phase": phase}
    except Exception:  # whatever cannot be read, the Capitano starts as it always did
        return {"captain_due": True, "reason": "unknown", "phase": phase}


def main() -> int:
    answer = check()
    print(json.dumps(answer))
    return 0 if answer["captain_due"] else 1


if __name__ == "__main__":
    sys.exit(main())

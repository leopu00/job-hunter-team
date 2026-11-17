#!/usr/bin/env python3
"""captain_gate.py — is it time for the Capitano? A new user does the onboarding with the Assistente FIRST.

`jht team start` used to light everything at once, the Capitano included, whatever the profile: with an empty profile
the Capitano can do nothing (no profile, no worker to start) and, awake, it still spends: most of the cost of a
first start measured on a clean server was the Capitano calling the model with nothing to do. So the Capitano (and with it the rest of the squad, which only the Capitano
scales) waits until the onboarding has closed.

The onboarding is closed when ANY of these holds (`reason`):
  * `ready_flag`   the Assistente wrote `$JHT_HOME/profile/ready.flag` (it does when the profile has the target role, the
                   place and a language: skill onboarding-flow);
  * `onboarding_done` `$JHT_HOME/profile/onboarding-done.flag` is there (the questions are over) even with no ready.flag;
  * `phase`        the first run is already past awaiting_profile (burst or steady): an installation that works, or an
                   update of one, never loses its Capitano;
  * `profile_fit`  the profile already passes the gate to start the search (a profile that existed before the flag);
  * `override`     JHT_CAPTAIN_BEFORE_ONBOARDING=1 (someone starting it by hand, a test);
  * `unknown`      the state cannot be read: it starts, as it always did.
Otherwise `onboarding_open`: only the Assistente (and the daemons) run.

A closed onboarding on the CORE image (the tools of the full image still on their way, tools_tier.py) holds the Capitano
at most ten more minutes: `tools_pending`. After that, or when the pull failed, it is due with `tools` saying
`degraded`: captain_boot.py tells it, and the roles that need the tools stay down (start-agent.sh).

  python3 captain_gate.py        # {"captain_due": bool, "reason": ..., "phase": ...}; exit 0 = due, 1 = wait
Same contract as `first_run.py mentor-due`; the CLI (`jht team start`) and the agent watchdog both ask it.

The Scorer waits longer: ready.flag starts the team with three fields of the profile, and the Assistente goes on asking. A
Scorer scores positions against the profile, so before the profile is whole its scores are of a profile that is not the
person's yet, and it spends: on giro Windows 16/11 a Scorer made 19 calls during the onboarding, and its first call started
the budget's period half an hour early. It is due on the first of (`reason`):
  * `onboarding_done`  profile/onboarding-done.flag (the Assistente's questions are over, or the person said to stop);
  * `onboarding_cap`   JHT_SCORER_ONBOARDING_MAX seconds (1800) since ready.flag, as the switch to the full image waits;
  * `phase`            the first run is steady (an installation that has worked for a while);
  * `profile_fit`      no ready.flag, and a profile that passes the gate to start the search (imported, or from before);
  * `override`         JHT_SCORER_BEFORE_PROFILE=1;
  * `unknown`          the state cannot be read: it starts, as it always did.
Otherwise `profile_open`.

  python3 captain_gate.py scorer # {"scorer_due": bool, "reason": ...}; exit 0 = due, 1 = wait
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def _with_tools(answer: dict, flag: Path) -> dict:
    """The tools of the full image: wait for them (a little), or start degraded. Never raises: no clock, no wait."""
    try:
        import tools_tier
        seen = tools_tier.verdict(flag.stat().st_mtime, home=flag.parent.parent)
    except Exception:
        return answer
    if seen is None:
        return answer
    if seen["wait"]:
        return {"captain_due": False, "reason": "tools_pending", "phase": answer["phase"], "tools": seen}
    if seen["degraded"]:
        answer["tools"] = seen
    return answer


def check() -> dict:
    phase = None
    try:
        import first_run
        if os.environ.get("JHT_CAPTAIN_BEFORE_ONBOARDING") == "1":
            return {"captain_due": True, "reason": "override", "phase": None}
        flag = first_run._path("JHT_HOME") / "profile" / "ready.flag"
        phase = first_run.status().get("phase")
        if flag.is_file() and not flag.is_symlink():
            return _with_tools({"captain_due": True, "reason": "ready_flag", "phase": phase}, flag)
        # the Assistente's questions are over (or the person said to stop) even if ready.flag was never written: the onboarding is done
        done = flag.parent / "onboarding-done.flag"
        if _real_file(done):
            return _with_tools({"captain_due": True, "reason": "onboarding_done", "phase": phase}, done)
        if phase in (first_run.PHASE_BURST, first_run.PHASE_STEADY):
            return {"captain_due": True, "reason": "phase", "phase": phase}
        if first_run._profile_imported() is not None:
            return {"captain_due": True, "reason": "profile_fit", "phase": phase}
        return {"captain_due": False, "reason": "onboarding_open", "phase": phase}
    except Exception:  # whatever cannot be read, the Capitano starts as it always did
        return {"captain_due": True, "reason": "unknown", "phase": phase}


def _real_file(path: Path) -> bool:
    return path.is_file() and not path.is_symlink()


def scorer_check(now: float | None = None) -> dict:
    import time

    try:
        import first_run
        if os.environ.get("JHT_SCORER_BEFORE_PROFILE") == "1":
            return {"scorer_due": True, "reason": "override"}
        profile = first_run._path("JHT_HOME") / "profile"
        if _real_file(profile / "onboarding-done.flag"):
            return {"scorer_due": True, "reason": "onboarding_done"}
        if first_run.status().get("phase") == first_run.PHASE_STEADY:
            return {"scorer_due": True, "reason": "phase"}
        ready = profile / "ready.flag"
        if _real_file(ready):
            try:
                cap = int(os.environ.get("JHT_SCORER_ONBOARDING_MAX", "1800"))
            except ValueError:
                cap = 1800
            moment = time.time() if now is None else now
            if moment - ready.stat().st_mtime >= cap:
                return {"scorer_due": True, "reason": "onboarding_cap"}
            return {"scorer_due": False, "reason": "profile_open"}
        if first_run._profile_imported() is not None:
            return {"scorer_due": True, "reason": "profile_fit"}
        return {"scorer_due": False, "reason": "profile_open"}
    except Exception:  # whatever cannot be read, the Scorer starts as it always did
        return {"scorer_due": True, "reason": "unknown"}


def main() -> int:
    if sys.argv[1:] == ["scorer"]:
        answer = scorer_check()
        print(json.dumps(answer))
        return 0 if answer["scorer_due"] else 1
    answer = check()
    print(json.dumps(answer))
    return 0 if answer["captain_due"] else 1


if __name__ == "__main__":
    sys.exit(main())

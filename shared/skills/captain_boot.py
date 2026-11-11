#!/usr/bin/env python3
"""captain_boot.py — what the Capitano needs at boot, gathered BEFORE it wakes, in one block of text.

At every start the Capitano spent about half of its calls on facts a script can read: is the profile ready, has the first
run begun (`begin-burst`), what did yesterday's Capitano note, which standing orders are in force. Each of those calls
re-reads the whole prompt from the cache (31k tokens for the Capitano). This script runs them once, as the system, and
the block is appended to the welcome message the Capitano is sent at its start (start-agent.sh).

  * The first run is opened here, and only here, when the onboarding is closed by the Assistente (`ready.flag`, or a
    profile that already passes the gate to start the search) and the run has not begun: `first_run.py begin-burst`,
    exactly the command the skill first-run-burst asks for. It is idempotent, and it does not wait for the plan: an API
    key sizes the roster by its spending ceiling, a subscription nobody named opens on the lowest plan and the block says
    so (`plan_assumed`). Only a provider with no plan to assume stays closed: then the block says how to ask the card.
  * The roster of the burst IS started here, as the system, when no worker of it is alive (the burst has just opened, or every
    session is gone): `burst_roster.py start --auto --detach`, in the background, so the Scouts are briefed seconds after the
    profile is ready and not after the Capitano's own turns (measured 11/11: 0.9 to 2.8 minutes). The Capitano starts only
    what is still missing afterwards.
  * Nothing is drained: mail, user replies and the bridge are the Capitano's to read, so nothing is lost or read twice.

Whatever cannot be read leaves its line out, and the block says so; a failure never stops the start. Printed to stdout;
exit 0 always.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

SKILLS = Path(__file__).resolve().parent
LIMIT = 1800  # characters kept of each long answer (the diary, the standing orders)


def _run(*argv: str, any_rc: bool = False) -> str | None:
    """stdout of one of the Capitano's own commands, run as it runs them (the script's folder on the path)."""
    try:
        done = subprocess.run([sys.executable, *argv], capture_output=True, text=True, timeout=25, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return done.stdout.strip() if done.returncode == 0 or any_rc else None


def _json(*argv: str) -> dict | None:
    """The JSON object a command printed; first_run.py answers a refusal with exit 1 and the JSON, so any exit counts."""
    out = _run(*argv, any_rc=True)
    try:
        value = json.loads(out) if out else None
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _cut(text: str) -> str:
    return text if len(text) <= LIMIT else text[:LIMIT].rstrip() + " [...cut: read the rest yourself]"


def first_run_line(gate: dict | None) -> str:
    """Open the first run when the onboarding has closed it, and say where it stands."""
    state = _json(str(SKILLS / "first_run.py"), "status")
    if state is None:
        return "first run: could not be read — run `first_run.py status` yourself."
    opened = ""
    if state.get("phase") == "awaiting_profile" and (gate or {}).get("reason") in ("ready_flag", "profile_fit"):
        result = _json(str(SKILLS / "first_run.py"), "begin-burst")
        if result is not None and result.get("ok") is False:
            return ("first run: NOT opened — the subscription plan is not declared (" + str(result.get("reason", "plan")) + "). "
                    "Ask it ONCE with `first_run.py ask-plan` (the card, never plain text), as your first-run-burst skill says.")
        if result is not None:
            state, opened = result, "opened now by the system with begin-burst. " + (
                f"PLAN ASSUMED, already in your diary: {result['plan_assumed']} " if result.get("plan_assumed") else "")
    roster = state.get("roster")
    roster_start = _start_roster(state)
    need = f" roster {json.dumps(roster, sort_keys=True)}, target_scored {state.get('target_scored')}," \
           f" scout_cap_first_pass {state.get('scout_cap_first_pass')}." if roster else ""
    missing = state.get("roster_missing")
    return (f"first run: phase {state.get('phase')}, {opened}{need}" + (f" roster_missing {json.dumps(missing)}." if missing else "")
            + roster_start)


def _start_roster(state: dict) -> str:
    """Start the roster of an open burst in the background, when nothing of it is alive; the words for the block."""
    if state.get("phase") != "burst":
        return ""
    if not (_json(str(SKILLS / "burst_roster.py"), "plan", "--auto") or {}).get("start"):
        return ""  # nothing to start (a worker is already up, the roster is complete, the sessions cannot be read): say nothing
    out = _json(str(SKILLS / "burst_roster.py"), "start", "--auto", "--detach")
    if not (out or {}).get("detached"):
        return ""
    return (" THE SYSTEM IS STARTING THE ROSTER NOW, in the order of your skill, and briefs each worker itself: do NOT start workers "
            "and do not run roll_worker_number.py for the roster in your first minutes (a second Scout would be a duplicate). "
            "Your first action is the rest of your wake; look at `first_run.py status` after about two minutes and start only "
            "what is still in roster_missing (`burst_roster.py start` does that in one command).")


def tools_line(gate: dict | None) -> str | None:
    """The full image's tools are not here yet: the Capitano starts anyway, with only the roles that do not need them."""
    tools = (gate or {}).get("tools") or {}
    if not tools.get("degraded"):
        return None
    why = ("the download did not finish in 10 minutes and goes on in the background" if tools["degraded"] == "timeout"
           else f"the download failed ({tools.get('reason') or 'unknown reason'})")
    return ("tools: NOT READY — the full set of tools (the browser, the CV PDF) is not in the image yet: " + why + ". "
            "Start ONLY the roles that do not need them (Scorer, Critico, Sentinella): start-agent.sh refuses scout, analista, "
            "scrittore and closer with exit 75 until the image has the tools; do not retry them in a loop. Tell the user ONCE, "
            "now, with `notify-user`, in the user's language, that the tools are still arriving and the search starts as "
            "soon as they do. Nothing for you to install or repair: the system switches the image and restarts the team by itself.")


def briefing() -> str:
    gate = _json(str(SKILLS / "captain_gate.py"))
    lines = ["BOOT FACTS gathered by the system just now — do NOT run these commands again, the answers are here:",
             f"- onboarding: {(gate or {}).get('reason', 'unknown')}",
             "- " + first_run_line(gate)]
    if tools := tools_line(gate):
        lines.append("- " + tools)
    for label, argv in (("diary handoff", ("captain_diary.py", "handoff")), ("standing orders", ("team_directives.py", "active"))):
        text = _run(str(SKILLS / argv[0]), *argv[1:])
        lines.append(f"- {label}:\n" + (_cut(text) if text else "(could not be read — run it yourself)"))
    lines.append("Still yours: the mailbox and the user replies (read them as usual), the roster of the first run "
                 "(started by the system; you complete what is missing), and everything after.")
    return "\n".join(lines)


def main() -> int:
    try:
        print(briefing())
    except Exception as exc:  # never stop a start for a briefing
        print(f"BOOT FACTS could not be gathered ({type(exc).__name__}): read the state yourself.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

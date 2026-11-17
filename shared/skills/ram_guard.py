"""ram_guard.py — the RAM of the machine, watched while the team runs.

The seat gate (spawn_gate.py) and the capacity (host_capacity.py) look at the RAM only when a session is born. A team already
running was looked at by nobody: on a 7.7 GB server with no swap, 18 Codex sessions (about 360 MB each) filled the memory, the
kernel OOM killer took the user's manager and everything under it, and the team, the container and tmux went down with it.

This runs on every look of the Sentinella's brake (about once a minute). When MemAvailable is under a threshold it retires
workers, the ones the machine can carry least: the newest Scouts first, then the Scorers, then the Analisti. It keeps one worker
for each of the Analista and the Scorer, until the memory is under HALF the threshold (then it keeps nothing: the kernel's
choice is worse). At most TWO per look, then it waits RETIRE_COOLDOWN_SEC for the memory to come back. The Captain is told, to
tell the person in their language; nothing else is stopped, and the five fixed agents never are.

The retirement is `jht-agent-retire` (the roster first, then the session), so the watchdog does not bring the worker back.
`decide()` is pure (what is read in, what to do out): the tests drive it with made-up machines.
"""
from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys
import time
from pathlib import Path

GIB = 1024 ** 3
HERE = Path(__file__).resolve().parent
LOW_FLOOR_GIB = 0.6            # under this many GiB of MemAvailable the machine is in danger, whatever its size
LOW_SHARE = 0.07               # ... or under this share of its RAM
RETIRE_PER_LOOK = 2
RETIRE_COOLDOWN_SEC = 120
WORKER = re.compile(r"^(SCOUT|ANALISTA|SCORER)-(\d+)$")
ORDER = {"SCOUT": 0, "SCORER": 1, "ANALISTA": 2}
KEEP_ONE = ("SCORER", "ANALISTA")


def threshold_gib(total_gib):
    return max(LOW_FLOOR_GIB, (total_gib or 0.0) * LOW_SHARE)


def decide(avail_gib, total_gib, sessions):
    """The sessions to retire now, in order. [] when the memory is fine or unknown. Pure."""
    if avail_gib is None or total_gib is None:
        return []
    limit = threshold_gib(total_gib)
    if avail_gib >= limit:
        return []
    critical = avail_gib < limit / 2
    workers = []
    for name in sessions:
        m = WORKER.match(name or "")
        if m:
            workers.append((ORDER[m.group(1)], -int(m.group(2)), name, m.group(1)))
    workers.sort()          # Scouts first, the newest (highest number) first; then Scorers; then Analisti
    left = {role: sum(1 for w in workers if w[3] == role) for role in KEEP_ONE}
    out = []
    for _, _, name, role in workers:
        if len(out) >= RETIRE_PER_LOOK:
            break
        if role in KEEP_ONE and not critical and left[role] <= 1:
            continue
        out.append(name)
        if role in left:
            left[role] -= 1
    return out


def _load(name):
    spec = importlib.util.spec_from_file_location("ram_guard_" + name, HERE / (name + ".py"))
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(spec.name, module)
    spec.loader.exec_module(module)
    return module


def _live_sessions():
    out = subprocess.run(["tmux", "ls", "-F", "#{session_name}"], capture_output=True, text=True, timeout=10).stdout
    return [line.strip() for line in out.splitlines() if line.strip()]


def _retire(session, reason):
    tool = next((p for p in (Path("/app/agents/_tools/jht-agent-retire.py"), HERE.parent.parent / "agents" / "_tools" / "jht-agent-retire.py") if p.exists()), None)
    if tool is None:
        return False
    done = subprocess.run([sys.executable, str(tool), session, "--reason", reason], capture_output=True, text=True, timeout=60)
    return done.returncode == 0


def captain_text(retired, avail_gib, total_gib):
    return ("[BRIDGE INFO] THE MACHINE IS RUNNING OUT OF MEMORY: %.2f GiB of %.1f GiB are free, and the system stops what it must "
            "when they are gone, the person's own session manager first. To keep the team alive the system retired %s. Not a fault "
            "of theirs. Tell the person once, in their language, in plain words: the computer's memory was nearly full, a few "
            "of the workers were stopped to protect it, and the search goes on with fewer until the memory is back. Do NOT start "
            "new workers now: the seat gate refuses them while the memory is short."
            % (avail_gib, total_gib, ", ".join(retired)))


def step(api, run, probe=None, sessions=None, retire=None):
    """One look. Never raises. `probe`, `sessions` and `retire` are for the tests."""
    try:
        state = run.state.setdefault("ram_guard", {})
        now = api.time.time()
        if now - float(state.get("last_retire_at") or 0.0) < RETIRE_COOLDOWN_SEC:
            return []
        if probe is None:
            probe = _load("host_capacity").read_probe()
        avail, total = probe.get("ram_avail_gib"), probe.get("ram_total_gib")
        if avail is None or total is None or avail >= threshold_gib(total):
            return []
        names = sessions if sessions is not None else _live_sessions()
        retire = retire or _retire
        done = []
        for session in decide(avail, total, names):
            if retire(session, "ram: %.2f of %.1f GiB free, the machine is about to run out of memory" % (avail, total)):
                done.append(session)
        if done:
            state["last_retire_at"] = now
            print("[bridge V6] RAM-GUARD %.2f of %.1f GiB free: retired %s" % (avail, total, ", ".join(done)))
            from sentinel_delivery import notice
            notice(api, run.state, "ram_guard:%d" % int(now), api.CAPITANO_SESSION, captain_text(done, avail, total))
        return done
    except Exception as error:  # noqa: BLE001 - a guard that fails must not stop the tick
        print("[bridge V6] WARN ram guard: %s" % error)
        return []

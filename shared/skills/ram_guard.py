"""ram_guard.py — the RAM of the machine, watched while the team runs.

The seat gate (spawn_gate.py) and the capacity (host_capacity.py) look at the RAM only when a session is born. A team already
running was looked at by nobody: on a 7.7 GB server with no swap, 18 Codex sessions (about 360 MB each) filled the memory, the
kernel OOM killer took the user's manager and everything under it, and the team, the container and tmux went down with it.

This runs on every look of the Sentinella's brake (about once a minute). When MemAvailable is under a threshold it retires
workers, the ones the machine can carry least: the newest Scouts first (by the moment the session was created, not by its
number: a lower number can be the younger session), then the Scorers, then the Analisti. It keeps one worker
for each of the Analista and the Scorer, until the memory is under HALF the threshold (then it keeps nothing: the kernel's
choice is worse). At most TWO per look, then it waits RETIRE_COOLDOWN_SEC for the memory to come back. The Captain is told, to
tell the person in their language; nothing else is stopped, and the five fixed agents never are. A Captain held by the brake of
the budget never reads what is sent to it, so the person is also told straight (the notifier of the panel) and the last
retirement is written to $JHT_HOME/state/ram-guard.json, which `jht team status` says.

The retirement is `jht-agent-retire` (the roster first, then the session), so the watchdog does not bring the worker back.
`decide()` is pure (what is read in, what to do out): the tests drive it with made-up machines.
"""
from __future__ import annotations

import importlib.util
import json
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
    """The sessions to retire now, in order. [] when the memory is fine or unknown. Pure.
    `sessions` is the list of names, or a {name: created} map (epoch seconds): with it the newest session of a role goes first;
    a name with no date counts as the oldest, and equal dates go by the higher number."""
    if avail_gib is None or total_gib is None:
        return []
    limit = threshold_gib(total_gib)
    if avail_gib >= limit:
        return []
    critical = avail_gib < limit / 2
    created = sessions if isinstance(sessions, dict) else {}
    workers = []
    for name in sessions:
        m = WORKER.match(name or "")
        if m:
            born = created.get(name)
            workers.append((ORDER[m.group(1)], -(born if isinstance(born, (int, float)) else 0), -int(m.group(2)), name, m.group(1)))
    workers.sort()          # Scouts first, the newest (latest created) first; then Scorers; then Analisti
    left = {role: sum(1 for w in workers if w[4] == role) for role in KEEP_ONE}
    out = []
    for _, _, _, name, role in workers:
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
    """{name: created} of the tmux sessions (created in epoch seconds, None when tmux does not say)."""
    out = subprocess.run(["tmux", "ls", "-F", "#{session_name}\t#{session_created}"], capture_output=True, text=True, timeout=10).stdout
    found = {}
    for line in out.splitlines():
        name, _, born = line.strip().partition("\t")
        if name:
            found[name] = int(born) if born.isdigit() else None
    return found


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


STATUS_FILE = Path("state") / "ram-guard.json"


def _write_status(home, done, avail, total, now):
    """The last retirement, for `jht team status`: replaced in one step, 0600. A failure is not a reason to stop the look."""
    path = Path(home) / STATUS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(".%s.%d.tmp" % (path.name, os.getpid()))
    body = '{"at": %d, "retired": %s, "avail_gib": %.2f, "total_gib": %.1f}\n' % (
        int(now), json.dumps(list(done)), avail, total)
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(body)
    os.replace(str(tmp), str(path))


def _tell_the_person(api, run, done, avail, total, now, notify_user):
    """The person straight, not through the Captain: a Captain held by the budget brake never reads its input."""
    try:
        import quota_data as quota
        text = quota.shared_i18n().tf("ram_guard.user_notice", "%.2f" % avail, "%.1f" % total, "%d" % len(done))
        (notify_user or quota._notify_user)(text, "ram-guard-%d" % int(now))
    except Exception as error:  # noqa: BLE001 - not a reason to stop the look
        print("[bridge V6] WARN ram guard user notice: %s" % error)
    try:
        _write_status(api._path("JHT_HOME"), done, avail, total, now)
    except Exception as error:  # noqa: BLE001
        print("[bridge V6] WARN ram guard status: %s" % error)


REOPEN_MARGIN = 1.5            # the memory must be this much over the threshold before the capacity comes back
RESTART_PER_LOOK = 1           # the others, one a look: a start can take minutes and the tick must not wait for all of them
RESTART_SCOUTS_PER_LOOK = 2    # the Scouts, two a look: nothing enters without them, and a pause of the pace leaves short windows
REOPEN_AFTER_SEC = 300         # ... and stay there this long after the last retirement


def reopen_text(back, avail_gib, total_gib):
    return ("[BRIDGE INFO] THE MEMORY IS BACK: %.2f GiB of %.1f GiB are free. The system started again the workers it had retired "
            "to protect the machine: %s. The capacity is open: you may scale the team as usual."
            % (avail_gib, total_gib, ", ".join(back)))


def _restart(session, reason):
    """Start a retired worker again through its launcher; a normal spawn turns `retired` back into `active`."""
    m = WORKER.match(session or "")
    if m is None:
        return False
    queue = _load("queue_demand")
    try:
        if queue is None or queue.brake(time.time(), 0) or queue.held_back(session):
            return False    # a brake (budget, halt, standby, off hours) or a hold the person set: the worker stays down
    except Exception:  # noqa: BLE001 - a brake that raises is a brake
        return False
    burst = _load("burst_roster")
    if burst is None:
        return False
    done = subprocess.run(["bash", burst._launcher(), m.group(1).lower(), m.group(2)], capture_output=True, text=True,  # noqa: SLF001
                          timeout=burst.SPAWN_TIMEOUT_S, check=False, stdin=subprocess.DEVNULL,
                          env=dict(os.environ, JHT_WORKER_BRIEF="The memory guard retired you and the memory is back: resume the main loop."))
    return done.returncode == 0


def _retired_for_ram_in_the_roster():
    """The workers the roster says were retired by the guard (its reason starts with «ram:»): a guard that has just been updated
    has not seen them retire, and they would stay down for good."""
    try:
        agents = (_load("team_roster").load() or {}).get("agents") or {}
        return sorted(name for name, entry in agents.items()
                      if entry.get("status") == "retired" and str(entry.get("retire_reason") or "").startswith("ram:") and WORKER.match(name))
    except Exception:  # noqa: BLE001 - not a reason to stop the look
        return []


BACK = {"SCOUT": 0, "ANALISTA": 1, "SCORER": 2}


def _comes_back_order(name):
    """The Scouts first (nothing enters without them), then the Analisti, then the Scorer; each by its number."""
    m = WORKER.match(name or "")
    return (BACK.get(m.group(1), 9), int(m.group(2))) if m else (9, 0)


def _reopen(api, run, state, avail, total, now, restart, names):
    """Memory well above the threshold for a while: bring back the workers the guard retired, and tell the Captain."""
    if "retired_by_guard" not in state:
        state["retired_by_guard"] = _retired_for_ram_in_the_roster()   # the ones a version before this one retired
    waiting = [n for n in state.get("retired_by_guard") or [] if n not in names]
    waiting.sort(key=_comes_back_order)
    if not waiting:
        state["retired_by_guard"] = []
        return []
    if avail < threshold_gib(total) * REOPEN_MARGIN or now - float(state.get("last_retire_at") or 0.0) < REOPEN_AFTER_SEC:
        return []
    # two Scouts a look, else one worker; the order puts the Scouts first
    first = WORKER.match(waiting[0])
    take = RESTART_SCOUTS_PER_LOOK if first and first.group(1) == "SCOUT" else RESTART_PER_LOOK
    back = []
    for name in [n for n in waiting if (WORKER.match(n).group(1) == "SCOUT") == (take == RESTART_SCOUTS_PER_LOOK)][:take]:
        if restart(name, "ram guard: memory back"):
            back.append(name)
    state["retired_by_guard"] = [n for n in waiting if n not in back]
    if back:
        print("[bridge V6] RAM-GUARD %.2f of %.1f GiB free: restarted %s" % (avail, total, ", ".join(back)))
        try:
            from sentinel_delivery import notice
            notice(api, run.state, "ram_guard_back:%d" % int(now), api.CAPITANO_SESSION, reopen_text(back, avail, total))
        except Exception as error:  # noqa: BLE001
            print("[bridge V6] WARN ram guard reopen notice: %s" % error)
    return back


def step(api, run, probe=None, sessions=None, retire=None, notify_user=None, restart=None):
    """One look. Never raises. `probe`, `sessions`, `retire`, `notify_user` and `restart` are for the tests."""
    try:
        state = run.state.setdefault("ram_guard", {})
        now = api.time.time()
        if now - float(state.get("last_retire_at") or 0.0) < RETIRE_COOLDOWN_SEC:
            return []
        if probe is None:
            probe = _load("host_capacity").read_probe()
        avail, total = probe.get("ram_avail_gib"), probe.get("ram_total_gib")
        if avail is None or total is None:
            return []
        names = sessions if sessions is not None else _live_sessions()
        if avail >= threshold_gib(total):
            _reopen(api, run, state, avail, total, now, restart or _restart, names)
            return []
        retire = retire or _retire
        done = []
        for session in decide(avail, total, names):
            if retire(session, "ram: %.2f of %.1f GiB free, the machine is about to run out of memory" % (avail, total)):
                done.append(session)
        if done:
            state["last_retire_at"] = now
            state["retired_by_guard"] = sorted(set(state.get("retired_by_guard") or []) | set(done))
            print("[bridge V6] RAM-GUARD %.2f of %.1f GiB free: retired %s" % (avail, total, ", ".join(done)))
            # the person first and on its own road: the notice to the Captain can fail without a word and must not hide this one
            _tell_the_person(api, run, done, avail, total, now, notify_user)
            try:
                from sentinel_delivery import notice
                notice(api, run.state, "ram_guard:%d" % int(now), api.CAPITANO_SESSION, captain_text(done, avail, total))
            except Exception as error:  # noqa: BLE001
                print("[bridge V6] WARN ram guard captain notice: %s" % error)
        return done
    except Exception as error:  # noqa: BLE001 - a guard that fails must not stop the tick
        print("[bridge V6] WARN ram guard: %s" % error)
        return []

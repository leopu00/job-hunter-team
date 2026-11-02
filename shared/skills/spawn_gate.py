#!/usr/bin/env python3
"""spawn_gate.py — the seats of the host, kept for the roles that have work waiting.

On a real run the host could carry 4 workers (`host_agent_cap`, derived from the RAM), the Captain filled the 4 seats with
Scouts, and 12 positions waited for an Analista and a Scorer that were never started ("no spawn because host_agent_cap=4
is binding"). Nothing in the code decided who gets the seats: `start-agent.sh` started whatever it was asked, and the cap
was a sentence of the Captain's prompt ("the cap does not yield"). The Scouts produce the positions that nobody evaluates.

The rule, applied to a NEW spawn of a Scout, an Analista or a Scorer:

  - a Scout is let in only when a seat stays free for each of the Analista and the Scorer that has positions waiting in
    its queue (`db_query.role_queue_count`) and no live worker; the Scouts take the rest. With the queues empty there is
    no reservation, and the host cap still holds for the Scouts;
  - an Analista or a Scorer is always let in up to the cap;
  - when the seats are all taken and an Analista or a Scorer with positions waiting has none, the answer is `make_room`,
    with the name of the most recent Scout: "retire SCOUT-N to make room". The gate retires nothing. Taking a worker out is
    the Captain's decision (`jht-agent-retire`), and it comes back to start the one that has the work.

It is for the spawns an agent asks for. The ones that recreate or start a session on their own account (the watchdog's
respawn of the same instance, the operator's `jht team start`, the first-run roster, which already keeps one seat per
role) set `JHT_SPAWN_SRC` and are not gated. A host whose capacity cannot be measured, or a queue that cannot be read,
means no gate: the direction of a doubt is to start the worker.

Use (start-agent.sh calls it, for a session that does not exist yet):
  python3 spawn_gate.py check --role scout            # exit 0 = go, exit 10 = no seat (the reason is on stderr)
  python3 spawn_gate.py check --role analista --json
  python3 spawn_gate.py check --role scout --cap 4 --sessions SCOUT-1,SCOUT-2,SCOUT-3,SCOUT-4 --queues analista=12,scorer=3
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
GATED = ("scout", "analista", "scorer")
RESERVED_FOR = ("analista", "scorer")
# The sessions that take a seat: the workers, never the five fixed core agents the cap already leaves out.
WORKER_SESSION = re.compile(r"^(SCOUT|ANALISTA|SCORER|SCRITTORE|CRITICO|CLOSER)(?:-S?(\d+))?$")


def home() -> Path:
    return Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))


def _load(name: str, filename: str):
    for base in (Path("/app/shared/skills"), HERE):
        path = base / filename
        if path.exists():
            if str(base) not in sys.path:
                sys.path.insert(0, str(base))
            spec = importlib.util.spec_from_file_location(name, path)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    return None


def host_cap():
    """How many workers the host carries (plan_registry, from the RAM), or None when it cannot be measured."""
    try:
        mod = _load("plan_registry_for_spawn_gate", "plan_registry.py")
        return mod._host_agent_cap() if mod is not None else None  # noqa: SLF001 — the one source of the RAM cap
    except Exception:  # noqa: BLE001
        return None


def queues() -> dict:
    """{role: positions waiting} for the roles that have a queue. A queue that cannot be read counts 0: no reservation."""
    out = {}
    try:
        mod = _load("db_query_for_spawn_gate", "db_query.py")
        conn = mod.get_db()
        try:
            for role in RESERVED_FOR:
                out[role] = int(mod.role_queue_count(conn, role))
        finally:
            conn.close()
    except Exception:  # noqa: BLE001
        return {}
    return out


def live_workers():
    """[(session, role, created_epoch)] of the worker sessions alive, or None when tmux cannot say."""
    try:
        done = subprocess.run(["tmux", "list-sessions", "-F", "#{session_name}\t#{session_created}"],
                              capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if done.returncode != 0:
        return [] if "no server running" in done.stderr or "no sessions" in done.stderr else None
    found = []
    for line in done.stdout.splitlines():
        name, _, created = line.partition("\t")
        match = WORKER_SESSION.match(name.strip())
        if match:
            try:
                found.append((name.strip(), match.group(1).lower(), float(created or 0)))
            except ValueError:
                found.append((name.strip(), match.group(1).lower(), 0.0))
    return found


def newest_scout(workers):
    scouts = [w for w in workers if w[1] == "scout"]
    return max(scouts, key=lambda w: (w[2], w[0]))[0] if scouts else None


def decide(role: str, workers, cap, waiting: dict) -> dict:
    """The verdict for a new `role`, from the live workers, the cap and the queues. Pure: the tests drive it."""
    role = str(role or "").lower()
    base = {"role": role, "cap": cap, "live": len(workers) if workers is not None else None}
    if role not in GATED:
        return {**base, "verdict": "go", "reason": "not_gated"}
    if cap is None or workers is None:
        return {**base, "verdict": "go", "reason": "unmeasured"}
    live = len(workers)
    per_role = {r: sum(1 for w in workers if w[1] == r) for r in RESERVED_FOR}
    missing = [r for r in RESERVED_FOR if waiting.get(r, 0) > 0 and per_role[r] == 0]
    base["waiting"] = {r: waiting.get(r, 0) for r in RESERVED_FOR}
    base["missing"] = missing
    if role == "scout":
        if live + 1 + len(missing) <= cap:
            return {**base, "verdict": "go", "reason": "seat_free"}
        retire = newest_scout(workers) if missing and live >= cap else None
        return {**base, "verdict": "no_seat", "reason": "seats_reserved" if missing else "cap_reached", "retire": retire}
    # an Analista or a Scorer
    if live + 1 <= cap:
        return {**base, "verdict": "go", "reason": "seat_free"}
    if role in missing:
        retire = newest_scout(workers)
        if retire:
            return {**base, "verdict": "make_room", "reason": "seats_taken_by_scouts", "retire": retire}
    return {**base, "verdict": "no_seat", "reason": "cap_reached", "retire": None}


def message(result: dict) -> str:
    cap, live, role = result.get("cap"), result.get("live"), result["role"].upper()
    if result["verdict"] == "make_room":
        return ("%s not started: the host carries %s workers and all %s seats are taken, with positions waiting for a %s "
                "and none running. Retire %s to make room (jht-agent-retire %s --reason \"seat for %s: positions waiting\"), "
                "then start the %s again." % (role, cap, live, role, result["retire"], result["retire"], role, role))
    if result["verdict"] == "no_seat":
        if result["reason"] == "seats_reserved":
            who = " and ".join(m.upper() for m in result["missing"])
            text = ("%s not started: the host carries %s workers, %s are running, and a seat is kept for the %s that has "
                    "positions waiting and none running (%s)." % (role, cap, live, who,
                                                                  ", ".join("%s %d" % (m, result["waiting"][m]) for m in result["missing"])))
            if result.get("retire"):
                text += " The seats are all taken: retire %s to make room for it." % result["retire"]
            return text
        return "%s not started: the host carries %s workers and %s are running." % (role, cap, live)
    return ""


def log(result: dict) -> None:
    """One closed line per refusal, for whoever asks why a role was not started. Never raises."""
    if result["verdict"] == "go":
        return
    try:
        path = home() / "logs" / "spawn-gate.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {"ts": round(time.time(), 3), **{k: result.get(k) for k in ("role", "verdict", "reason", "cap", "live", "missing", "retire")}}
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n")
    except OSError:
        pass


def _parse_queues(text: str) -> dict:
    out = {}
    for pair in (text or "").split(","):
        name, _, count = pair.partition("=")
        if name.strip() and count.strip().isdigit():
            out[name.strip().lower()] = int(count)
    return out


def _parse_sessions(text: str):
    found = []
    for i, name in enumerate(s.strip() for s in (text or "").split(",") if s.strip()):
        match = WORKER_SESSION.match(name)
        if match:
            found.append((name, match.group(1).lower(), float(i)))
    return found


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="spawn_gate", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    check = sub.add_parser("check")
    check.add_argument("--role", required=True)
    check.add_argument("--json", action="store_true")
    check.add_argument("--cap", type=int, default=None, help="for a test or a diagnosis: instead of the host's")
    check.add_argument("--sessions", default=None, help="for a test: the live worker sessions, comma separated")
    check.add_argument("--queues", default=None, help="for a test: analista=N,scorer=N")
    args = ap.parse_args(argv)
    cap = args.cap if args.cap is not None else host_cap()
    workers = _parse_sessions(args.sessions) if args.sessions is not None else live_workers()
    waiting = _parse_queues(args.queues) if args.queues is not None else queues()
    result = decide(args.role, workers, cap, waiting)
    text = message(result)
    log(result)
    if args.json:
        print(json.dumps({**result, "message": text}, sort_keys=True))
    if text:
        print(text, file=sys.stderr)
    return 0 if result["verdict"] == "go" else 10


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Dollar reserves and staged Scout admissions for the first run (T362).

The lock covers admission only. Unsettled requests reserve an estimate (last
call of the role times 1.5, at least the configured fallback). They settle when
pi records their usage, or expire after request_ttl_s. The possible overshoot
is the calls already admitted, NOT a guaranteed dollar amount per call. The
existing total/day/period brakes remain authoritative, including for core roles.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import math
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
from plain_file import read_plain

# L2: 50 found, 0 scored; recovery spent 3.436 USD with 0 new/0 scores,
# then scoring 21 positions cost 1.330 USD. M1: 1.95 USD, zero positions
# before the first Scout. Start with half for the downstream
# pipeline; one configurable source, proportional even for a tiny budget.
DEFAULTS = {"analista_share": 0.25, "scorer_share": 0.25,
            "request_estimate_usd": 0.05, "request_ttl_s": 300,
            "scout_stage_seconds": 60}
EXEMPT = {"capitano", "assistente", "scorer"}


def _read(path, default=None):
    try:
        return json.loads(read_plain(path, max_size=4 * 1024 * 1024).decode("utf-8"))
    except FileNotFoundError:
        return default


def settings(config):
    raw = (config.get("team") or {}).get("burst_budget") or {}
    out = dict(DEFAULTS)
    for key in out:
        value = raw.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value > 0:
            out[key] = float(value)
    if out["analista_share"] + out["scorer_share"] >= 1:
        raise ValueError("burst reserve shares must add to less than one")
    return out


def _api_key(config):
    provider = str(config.get("active_provider") or "").lower()
    entry = (config.get("providers") or {}).get(provider) or {}
    return entry.get("auth_method") == "api_key"


def _context(home):
    import team_budget
    config = _read(home / "jht.config.json", {})
    if not _api_key(config):
        return None
    budget = team_budget.read(config, home)
    if budget is None:
        return None
    first = _read(home / "state" / "first-run.json", {})
    if first.get("phase") != "burst":
        return None
    return config, budget, first


def _events(home, since):
    """Strict accounting: pi_sessions deliberately skips unreadable files; here
    unreadable usage must hold upstream workers, so inspect each plain file."""
    import pi_sessions
    root = pi_sessions.sessions_root(home)
    events = []
    if not root.exists():
        raise OSError("pi sessions are unavailable")
    def failed(error):
        raise error
    for folder, _, names in os.walk(root, onerror=failed):
        for name in names:
            if not name.endswith(".jsonl"):
                continue
            path = Path(folder) / name
            if path.stat().st_mtime < since:
                continue
            data = read_plain(path, max_size=128 * 1024 * 1024).decode("utf-8")
            lines = data.splitlines()
            if not lines:
                raise ValueError("empty pi session")
            header = json.loads(lines[0])
            if header.get("type") != "session":
                raise ValueError("invalid pi session header")
            agent = pi_sessions.agent_of(header)
            session = str(header.get("id") or path.stem)
            for index, line in enumerate(lines[1:], 1):
                try:
                    entry = json.loads(line)
                except ValueError:
                    if index == len(lines) - 1 and not data.endswith("\n"):
                        continue  # pi is still writing the last line
                    raise
                event = pi_sessions._event(entry, session, agent)
                if event and event["ts"] >= since:
                    cost = entry["message"]["usage"].get("cost", {}).get("total")
                    if isinstance(cost, bool) or not isinstance(cost, (int, float)) or not math.isfinite(cost) or cost < 0:
                        raise ValueError("missing pi cost")
                    events.append(event)
                if entry.get("type") == "custom" and entry.get("customType") == pi_sessions.SEARCH_ENTRY:
                    ts = pi_sessions._epoch(entry.get("timestamp"))
                    details = entry.get("data") or {}
                    if ts is not None and ts >= since:
                        searches = details.get("searches", 0)
                        events.append({"agent": agent, "ts": ts, "cost": searches * pi_sessions.search_fee(details.get("provider", "openai")), "search": True})
    return sorted(events, key=lambda event: event["ts"])


def _queues(home):
    import db_query
    import sqlite3
    db = Path(os.environ.get("JHT_DB") or home / "jobs.db")
    conn = sqlite3.connect("file:%s?mode=ro" % db, uri=True, timeout=2)
    try:
        queues = {role: int(db_query.role_queue_count(conn, role)) for role in ("analista", "scorer")}
        queues["scored"] = int(conn.execute("SELECT COUNT(DISTINCT position_id) FROM scores").fetchone()[0])
        return queues
    finally:
        conn.close()


def _sourcing_done():
    import first_run
    cap = first_run.sourcing_cap()
    return bool(cap and cap.get("reached"))


def _counts(events):
    out = {}
    for event in events:
        if not event.get("search"):
            agent = event.get("agent") or "?"
            out[agent] = out.get(agent, 0) + 1
    return out


def decide(role, budget_usd, events, queues, sourcing_done, pending, policy, initial=True):
    """Pure reservation decision, independent of total/day/pace brakes."""
    paid = {r: sum(e["cost"] for e in events if (e.get("agent") or "").split("-", 1)[0] == r)
            for r in ("analista", "scorer")}
    needed = {"analista": queues["analista"] > 0 or (initial and not sourcing_done),
              "scorer": queues["scorer"] > 0 or queues["analista"] > 0 or (initial and not sourcing_done)}
    protected = sum(max(0.0, budget_usd * policy[r + "_share"] - paid[r])
                    for r in paid if r != role and needed[r])
    spent = sum(e["cost"] for e in events)
    outstanding = sum(p["estimate"] for p in pending)
    calls = [e["cost"] for e in events if not e.get("search") and (e.get("agent") or "").split("-", 1)[0] == role]
    estimate = max(policy["request_estimate_usd"], 1.5 * calls[-1] if calls else 0.0)
    room = budget_usd - spent - outstanding - protected
    allowed = role in EXEMPT or room + 1e-9 >= estimate
    return {"allowed": allowed, "reason": "allowed" if allowed else "burst-reserve",
            "protected_usd": round(protected, 6), "spent_usd": round(spent, 6),
            "inflight": len(pending), "inflight_usd": round(outstanding, 6),
            "estimate_usd": estimate, "room_usd": round(room, 6),
            "waiting_for_inflight": not allowed and bool(pending) and room + outstanding + 1e-9 >= estimate}


@contextlib.contextmanager
def _lock(home):
    import fcntl
    path = home / "state" / "burst-budget.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def _write(path, value):
    temp = path.with_name(".%s.%d.tmp" % (path.name, os.getpid()))
    temp.write_text(json.dumps(value), encoding="utf-8")
    os.replace(temp, path)


def check(agent, home=None, now=None, claim=None, spawn=False):
    home = Path(home or os.environ.get("JHT_HOME") or "/jht_home")
    now = time.time() if now is None else now
    agent = str(agent).lower()
    role = agent.split("-", 1)[0]
    try:
        context = _context(home)
        if context is None:
            return {"allowed": True, "reason": "not-dollar-burst"}
        config, budget, first = context
        policy = settings(config)
        with _lock(home):
            events = _events(home, budget["counts_from"])
            # Duration budgets start with actual search, not onboarding. This
            # also handles a first Scout whose event precedes the brake's tick.
            start = budget.get("starts")
            if start is None:
                start = next((e["ts"] for e in events if (e.get("agent") or "").startswith("scout-")), now)
            events = [e for e in events if e["ts"] >= start]
            key = [budget.get("saved_at"), budget["counts_from"], first.get("burst_started_at")]
            path = home / "state" / "burst-budget.json"
            record = _read(path, {})
            if record.get("key") != key:
                record = {"key": key, "pending": [], "last_scout": None}
            counts = _counts(events)
            pending = [p for p in record.get("pending", [])
                       if 0 <= now - p["at"] < policy["request_ttl_s"]
                       and counts.get(p["agent"], 0) <= p["count"]]
            queues = _queues(home)
            initial = queues["scored"] <= int(first.get("scored_at_start") or 0)
            result = decide(role, budget["usd"], events, queues, _sourcing_done(), pending, policy, initial)
            if result["allowed"] and spawn and role == "scout":
                last = record.get("last_scout")
                wait = policy["scout_stage_seconds"] - (now - last) if last is not None else 0
                if wait > 0:
                    result.update(allowed=False, reason="burst-stage", retry_after_s=round(wait, 3))
                else:
                    record["last_scout"] = now
            if result["allowed"] and claim:
                # Same-process retries of the same admission are idempotent.
                if not any(p["id"] == claim for p in pending):
                    pending.append({"id": claim, "agent": agent, "at": now,
                                    "estimate": result["estimate_usd"], "count": counts.get(agent, 0)})
            record["pending"] = pending
            _write(path, record)
            return result
    except Exception:  # unreadable accounts do not consume the pipeline's reserve
        return {"allowed": role in EXEMPT, "reason": "burst-accounting-unavailable"}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=("check", "claim", "spawn"))
    parser.add_argument("agent")
    parser.add_argument("--id")
    args = parser.parse_args(argv)
    if args.command == "claim" and not args.id:
        parser.error("claim requires --id")
    result = check(args.agent, claim=args.id if args.command == "claim" else None, spawn=args.command == "spawn")
    print(json.dumps(result))
    return 0 if result["allowed"] else 75


if __name__ == "__main__":
    sys.exit(main())

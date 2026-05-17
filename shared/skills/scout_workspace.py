#!/usr/bin/env python3
"""scout_workspace — claim/release SOURCE per multi-Scout (F-2.D, S-08).

Diverso da `scout_coord.py` (che fa claim per `position_id` SQLite).
Qui gestiamo claim a livello **sorgente** ("linkedin:python:IT",
"glassdoor:python:remote") — strumento per evitare che 2 Scout
attacchino la stessa fonte e producano 100% duplicati (causa storica
14× Canonical, bug #25).

Decisione utente F-2.D:
> "Devi attivare più scout possibili (4), incentivare la coordinazione
>  tra di loro, loro si parlano tra di loro in modo tale che lavorando
>  di squadra inizino a trovare alternative."

Stato condiviso in `$JHT_HOME/agents/_team/scout_workspace.json`:

{
  "claims": [
    {"agent":"scout-1", "source":"linkedin:python:IT",
     "claimed_at":1779648000, "ttl_s":1800}
  ],
  "history": [...]   // ultimi 50 eventi
}

TTL default 30 min: se uno Scout muore, dopo 30 min la sua claim scade
e altri Scout possono prenderla. Niente lock distribuito complicato —
JSON con clock host + cleanup retroattivo a ogni read.

API:
    scout_workspace.py claim <agent> <source> [--ttl-s 1800]
    scout_workspace.py release <agent> <source>
    scout_workspace.py list [--agent <name>]
    scout_workspace.py available <source> [--agent <name>]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

JHT_HOME = Path(os.environ.get("JHT_HOME", "/jht_home"))
WORKSPACE_PATH = JHT_HOME / "agents" / "_team" / "scout_workspace.json"
DEFAULT_TTL_S = 1800  # 30 min


def _now() -> int:
    return int(time.time())


def _load() -> dict:
    if not WORKSPACE_PATH.exists():
        return {"claims": [], "history": []}
    try:
        with WORKSPACE_PATH.open("r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("claims", [])
        data.setdefault("history", [])
        return data
    except (json.JSONDecodeError, OSError):
        return {"claims": [], "history": []}


def _save(data: dict) -> None:
    WORKSPACE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = WORKSPACE_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    tmp.replace(WORKSPACE_PATH)


def _prune_expired(data: dict) -> dict:
    now = _now()
    fresh = [c for c in data.get("claims", [])
             if c.get("claimed_at", 0) + c.get("ttl_s", DEFAULT_TTL_S) >= now]
    if len(fresh) != len(data.get("claims", [])):
        data["claims"] = fresh
    return data


def claim(agent: str, source: str, ttl_s: int = DEFAULT_TTL_S) -> dict:
    data = _prune_expired(_load())
    now = _now()
    holder = next((c for c in data["claims"] if c["source"] == source), None)

    if holder and holder["agent"] != agent:
        return {"ok": False, "reason": "conflict", "claimed_by": holder["agent"],
                "claimed_at": holder["claimed_at"], "ttl_s": holder.get("ttl_s", DEFAULT_TTL_S)}

    if holder:  # tuo, refresh
        holder["claimed_at"] = now
        holder["ttl_s"] = ttl_s
    else:
        data["claims"].append({"agent": agent, "source": source,
                               "claimed_at": now, "ttl_s": ttl_s})

    data["history"] = (data.get("history", []) + [
        {"agent": agent, "source": source, "event": "claim", "ts": now}
    ])[-50:]
    _save(data)
    return {"ok": True, "agent": agent, "source": source, "claimed_at": now}


def release(agent: str, source: str) -> dict:
    data = _load()
    before = len(data["claims"])
    data["claims"] = [c for c in data["claims"]
                      if not (c["agent"] == agent and c["source"] == source)]
    released = before > len(data["claims"])
    if released:
        data["history"] = (data.get("history", []) + [
            {"agent": agent, "source": source, "event": "release", "ts": _now()}
        ])[-50:]
        _save(data)
    return {"ok": True, "released": released, "agent": agent, "source": source}


def list_claims(agent: str | None = None) -> list[dict]:
    data = _prune_expired(_load())
    claims = data["claims"]
    if agent:
        claims = [c for c in claims if c["agent"] == agent]
    return claims


def available(source: str, agent: str | None = None) -> tuple[bool, dict | None]:
    data = _prune_expired(_load())
    for c in data["claims"]:
        if c["source"] == source:
            if agent and c["agent"] == agent:
                return True, c
            return False, c
    return True, None


def main(argv):
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("claim")
    c.add_argument("agent")
    c.add_argument("source")
    c.add_argument("--ttl-s", type=int, default=DEFAULT_TTL_S)

    r = sub.add_parser("release")
    r.add_argument("agent")
    r.add_argument("source")

    ll = sub.add_parser("list")
    ll.add_argument("--agent")

    a = sub.add_parser("available")
    a.add_argument("source")
    a.add_argument("--agent")

    args = p.parse_args(argv)

    if args.cmd == "claim":
        res = claim(args.agent, args.source, args.ttl_s)
        print(json.dumps(res))
        return 0 if res["ok"] else 1
    if args.cmd == "release":
        print(json.dumps(release(args.agent, args.source)))
        return 0
    if args.cmd == "list":
        print(json.dumps(list_claims(args.agent), indent=2))
        return 0
    if args.cmd == "available":
        ok, holder = available(args.source, getattr(args, "agent", None))
        out = {"available": ok}
        if holder:
            out["holder"] = holder
        print(json.dumps(out))
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

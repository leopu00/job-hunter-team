#!/usr/bin/env python3
"""boot_cost — what each role's session spends in its first minutes after it starts.

A restart of the containers starts every session again with a cold cache. This reads, only to read, the session
files the provider CLIs already write (Codex `rollout-*.jsonl`, Claude Code project `*.jsonl`) and answers, per
role: how big the context of the first model call is (the prompt, the tools, the skills: what the session
"rereads"), and what the session spent in its first N minutes, split in fresh input, input read from the cache and
output. It prints numbers and role names only: no message text, no path, no identifier of a person.

  boot_cost.py                      # last 24 h, first 10 minutes of every session, as a table
  boot_cost.py --minutes 5 --hours 6 --json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import stat
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROLES = frozenset({
    "capitano", "sentinella", "assistente", "mentor", "dottore", "mantenitore", "scout", "analista",
    "scorer", "scrittore", "critico", "tesoriere", "closer",
})
CLAUDE_AGENT_PREFIX = "-jht-home-agents-"
# The session folders are written by the agents themselves: a link planted there must not make this read a file
# somewhere else, and a file of any size must not be read whole.
MAX_SESSION_BYTES = 256 * 1024 * 1024


def _jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


def _ts(raw) -> float:
    if not isinstance(raw, str):
        return 0.0
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).timestamp()


def role_of(agent: str | None) -> str | None:
    """`analista-3` → analista; a name that is not a role is None (not counted, not guessed)."""
    if not isinstance(agent, str):
        return None
    base = re.split(r"[-_]", agent.strip().lower(), maxsplit=1)[0]
    return base if base in ROLES else None


def _int(value) -> int:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def _regular(path: Path, since_ts: float) -> bool:
    """A regular file (not a link, not a pipe or device) touched since `since_ts`, of a size that can be read."""
    try:
        info = path.lstat()
    except OSError:
        return False
    return stat.S_ISREG(info.st_mode) and info.st_mtime >= since_ts and info.st_size <= MAX_SESSION_BYTES


def _calls_codex(path: Path):
    """(role, [(ts, fresh_in, cached_in, out)]) of one Codex session. The first token_count has no `info`."""
    agent, calls = None, []
    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            payload = e.get("payload") or {}
            if e.get("type") == "session_meta":
                cwd = payload.get("cwd")
                if isinstance(cwd, str) and cwd:
                    agent = Path(cwd).name
                continue
            if e.get("type") != "event_msg" or payload.get("type") != "token_count":
                continue
            last = (payload.get("info") or {}).get("last_token_usage")
            ts = _ts(e.get("timestamp"))
            if not isinstance(last, dict) or ts <= 0:
                continue
            total_in, cached = _int(last.get("input_tokens")), _int(last.get("cached_input_tokens"))
            out = _int(last.get("output_tokens")) + _int(last.get("reasoning_output_tokens"))
            calls.append((ts, max(0, total_in - cached), cached, out))
    return role_of(agent), calls


def _calls_claude(path: Path, agent: str):
    """Same for a Claude Code session: what it writes to the cache is fresh input, what it reads is cached."""
    calls = []
    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            message = e.get("message")
            usage = message.get("usage") if isinstance(message, dict) else None
            ts = _ts(e.get("timestamp") or e.get("ts"))
            if not isinstance(usage, dict) or ts <= 0:
                continue
            fresh = _int(usage.get("input_tokens")) + _int(usage.get("cache_creation_input_tokens"))
            calls.append((ts, fresh, _int(usage.get("cache_read_input_tokens")), _int(usage.get("output_tokens"))))
    return role_of(agent), calls


def sessions(jht_home: Path, since_ts: float):
    """Yield (role, calls) for every session file touched since `since_ts`. Links are not followed."""
    codex = jht_home / ".codex" / "sessions"
    for rollout in (codex.rglob("rollout-*.jsonl") if codex.is_dir() and not codex.is_symlink() else ()):
        if _regular(rollout, since_ts):
            yield _calls_codex(rollout)
    projects = jht_home / ".claude" / "projects"
    if projects.is_dir() and not projects.is_symlink():
        for folder in projects.iterdir():
            if folder.is_symlink() or not folder.is_dir() or not folder.name.startswith(CLAUDE_AGENT_PREFIX):
                continue
            for jsonl in folder.glob("*.jsonl"):
                if _regular(jsonl, since_ts):
                    yield _calls_claude(jsonl, folder.name[len(CLAUDE_AGENT_PREFIX):])


def measure(jht_home: Path, since_ts: float, minutes: float) -> dict:
    """Per role: how many sessions started in the period, the median context of their first call, and the mean
    of what they spent in their first `minutes` minutes (calls, fresh input, cached input, output)."""
    per_role: dict[str, list[dict]] = defaultdict(list)
    for role, calls in sessions(jht_home, since_ts):
        if role is None or not calls:
            continue
        calls.sort()
        start = calls[0][0]
        if start < since_ts:
            continue  # a session that began before the period: its first minutes are not in it
        window = [c for c in calls if c[0] - start <= minutes * 60]
        per_role[role].append({
            "first_call_context": calls[0][1] + calls[0][2],
            "calls": len(window),
            "fresh_in": sum(c[1] for c in window),
            "cached_in": sum(c[2] for c in window),
            "out": sum(c[3] for c in window),
        })
    roles = {}
    for role, rows in sorted(per_role.items()):
        roles[role] = {
            "sessions": len(rows),
            "first_call_context_median": int(statistics.median(r["first_call_context"] for r in rows)),
            **{key: int(statistics.mean(r[key] for r in rows)) for key in ("calls", "fresh_in", "cached_in", "out")},
        }
    return {"minutes": minutes, "roles": roles}


def render(report: dict) -> str:
    head = f"{'role':<12}{'sessions':>9}{'first call':>12}{'calls':>7}{'fresh in':>10}{'cached in':>11}{'out':>8}"
    lines = [f"first {report['minutes']:g} minutes of each session (tokens; means per session)", head]
    for role, r in report["roles"].items():
        lines.append(
            f"{role:<12}{r['sessions']:>9}{r['first_call_context_median']:>12}{r['calls']:>7}"
            f"{r['fresh_in']:>10}{r['cached_in']:>11}{r['out']:>8}")
    if not report["roles"]:
        lines.append("(no session started in the period)")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--minutes", type=float, default=10.0)
    parser.add_argument("--hours", type=float, default=24.0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    report = measure(_jht_home(), time.time() - args.hours * 3600, args.minutes)
    print(json.dumps(report, indent=2) if args.json else render(report))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

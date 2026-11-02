#!/usr/bin/env python3
"""scout_pass_report.py — the Scout's passes, one row each, and what they cost per position found.

Reads `$JHT_HOME/logs/scout-passes.jsonl` (written by `scout_pass_log.py`) and answers, per source and country:
how many passes, how many candidates came back, how many were opened (full JD fetched), where the rest were dropped
and why, how many positions went in, and how much budget was spent for each.

A pass is a `pass` line plus the `candidate` lines of the SAME agent, source and country that follow it, up to the
agent's next `pass` line. A candidate with no pass before it (the log was rotated, or the Scout did not log the
search) is counted under `orphan` and never invented into a pass.

The budget of a pass is the weighted token usage of that agent between its previous line and the last line of the
pass (the same weights as the team's usage charts, token-by-agent-series.py). It is a window of time, so work the
Scout did that it did not log (a search that was not recorded) lands in the pass that follows: read it as an upper
bound per pass and as a good figure per source over many passes. Without the usage logs (`--no-tokens`, or a machine
that has none) the budget is null and the rest still works.

Use:
  python3 scout_pass_report.py                 # last 72 hours, a table
  python3 scout_pass_report.py --since-hours 12 --json
  python3 scout_pass_report.py --no-tokens
  python3 scout_pass_report.py --coverage      # the coverage plan: one row per portal, covered or not (see scout_coverage.py)
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUTCOMES = ("inserted", "duplicate", "dead_link", "closed_ad", "seniority", "work_auth", "domain", "experience",
            "language", "role", "area", "other")


def home() -> Path:
    return Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))


def read_rows(path: Path, since_ts: float = 0.0) -> list:
    """The valid lines of the log, in time order. A line that is not ours or not JSON is skipped, never raised."""
    rows = []
    for candidate in (path.with_suffix(".jsonl.1"), path):
        try:
            text = candidate.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if (isinstance(row, dict) and row.get("kind") in ("pass", "candidate")
                    and isinstance(row.get("ts"), (int, float)) and row["ts"] >= since_ts
                    and isinstance(row.get("agent"), str) and isinstance(row.get("source"), str)):
                rows.append(row)
    rows.sort(key=lambda r: r["ts"])
    return rows


def weight(row: dict) -> int:
    """How many candidates a candidate line stands for: its `count` (a whole number from 1 to 100000), otherwise 1.
    A value that is not that is read as 1, never raised."""
    count = row.get("count")
    return count if isinstance(count, int) and not isinstance(count, bool) and 1 <= count <= 100000 else 1


def token_events(since_ts: float):
    """{agent: [(ts, weighted)]} from the usage logs, or None when they cannot be read."""
    try:
        spec = importlib.util.spec_from_file_location("token_by_agent_series_for_report",
                                                      HERE / "token-by-agent-series.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.collect_events(since_ts)
    except Exception as exc:  # noqa: BLE001 — a missing measure must not stop the report
        print("scout_pass_report: no usage logs (%s)" % exc.__class__.__name__, file=sys.stderr)
        return None


def _weighted(events, agent: str, after: float, upto: float):
    """Weighted tokens (in thousands) of `agent` in (after, upto]; None without usage for that agent."""
    if events is None or agent not in events:
        return None
    return round(sum(w for ts, w in events[agent] if after < ts <= upto) / 1000.0, 1)


def fold(rows: list, events=None) -> dict:
    """{passes: [...], orphan: {...}, summary: [...]}."""
    passes = []
    open_pass = {}          # agent -> the pass being filled
    last_line = {}          # agent -> ts of its previous line
    orphan = defaultdict(lambda: defaultdict(int))
    for row in rows:
        agent, source, country = row["agent"], row["source"], row.get("country", "multi")
        before = last_line.get(agent, row["ts"] - 1.0)
        last_line[agent] = row["ts"]
        if row["kind"] == "pass":
            current = {"agent": agent, "source": source, "country": country, "ts": row["ts"],
                       "query_kind": row.get("query_kind"), "query_hash": row.get("query_hash"),
                       "returned": int(row.get("returned") or 0), "opened": 0,
                       "outcomes": {o: 0 for o in OUTCOMES}, "_from": before, "_to": row["ts"]}
            passes.append(current)
            open_pass[agent] = current
            continue
        current = open_pass.get(agent)
        outcome = row.get("outcome") if row.get("outcome") in OUTCOMES else "other"
        many = weight(row)
        if current is None or (current["source"], current["country"]) != (source, country):
            key = "%s/%s" % (source, country)
            orphan[key][outcome] += many
            if row.get("opened"):
                orphan[key]["opened"] += many
            continue
        current["outcomes"][outcome] += many
        current["opened"] += many if row.get("opened") else 0
        current["_to"] = row["ts"]
    for p in passes:
        p["tokens_kt"] = _weighted(events, p["agent"], p.pop("_from"), p.pop("_to"))
        p["inserted"] = p["outcomes"]["inserted"]
        p["dropped"] = sum(v for k, v in p["outcomes"].items() if k != "inserted")
        # What the source returned and nobody accounted for: a pass of 1080 ads with 3 reasons logged leaves 1077 here.
        p["unexplained"] = max(0, p["returned"] - sum(p["outcomes"].values()))
    groups = defaultdict(lambda: {"passes": 0, "returned": 0, "opened": 0, "inserted": 0, "unexplained": 0, "tokens_kt": None,
                                  "dropped": {o: 0 for o in OUTCOMES if o != "inserted"}})
    for p in passes:
        g = groups[(time.strftime("%Y-%m-%d", time.localtime(p["ts"])), p["source"], p["country"])]
        g["passes"] += 1
        g["returned"] += p["returned"]
        g["opened"] += p["opened"]
        g["inserted"] += p["inserted"]
        g["unexplained"] += p["unexplained"]
        if p["tokens_kt"] is not None:
            g["tokens_kt"] = round((g["tokens_kt"] or 0.0) + p["tokens_kt"], 1)
        for o in g["dropped"]:
            g["dropped"][o] += p["outcomes"][o]
    summary = []
    for (day, source, country), g in sorted(groups.items()):
        g.update(day=day, source=source, country=country)
        g["kt_per_inserted"] = (round(g["tokens_kt"] / g["inserted"], 1)
                                if g["tokens_kt"] is not None and g["inserted"] else None)
        summary.append(g)
    return {"passes": passes, "orphan": {k: dict(v) for k, v in orphan.items()}, "summary": summary}


def table(report: dict) -> str:
    lines = ["day         source          cc     passes returned opened inserted unexpl  kT  kT/inserted  dropped (reason=n)"]
    for g in report["summary"]:
        dropped = " ".join("%s=%d" % (o, n) for o, n in g["dropped"].items() if n) or "-"
        lines.append("%-11s %-15s %-6s %6d %8d %6d %8d %6d %5s %11s  %s" % (
            g["day"], g["source"], g["country"], g["passes"], g["returned"], g["opened"], g["inserted"], g["unexplained"],
            "-" if g["tokens_kt"] is None else g["tokens_kt"],
            "-" if g["kt_per_inserted"] is None else g["kt_per_inserted"], dropped))
    if len(lines) == 1:
        lines.append("(no passes in the log)")
    if report["orphan"]:
        lines.append("candidates without a pass before them: " + json.dumps(report["orphan"], sort_keys=True))
    return "\n".join(lines)


def coverage(rows: list, as_json: bool) -> int:
    """The coverage plan over these rows: covered / partial / untouched / closed / via_email for every portal of the plan."""
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    import scout_coverage
    plan = scout_coverage.load_plan()
    report = scout_coverage.status(plan, rows)
    if as_json:
        print(json.dumps({"languages": plan["languages"], "unmapped": plan["unmapped"], "rows": report,
                          "core_missing": scout_coverage.core_missing(scout_coverage.portal_states(rows))},
                         sort_keys=True, ensure_ascii=False))
    else:
        print(scout_coverage.render(plan, report))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="scout_pass_report", description=__doc__.split("\n")[0])
    ap.add_argument("--since-hours", type=float, default=72.0)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-tokens", action="store_true", help="skip the usage logs: the budget stays null")
    ap.add_argument("--coverage", action="store_true",
                    help="the coverage plan of the profile's languages over the window, one row per portal, instead of the passes")
    ap.add_argument("--log", default=None, help="another file (default: $JHT_HOME/logs/scout-passes.jsonl)")
    args = ap.parse_args(argv)
    since = time.time() - args.since_hours * 3600.0
    path = Path(args.log) if args.log else home() / "logs" / "scout-passes.jsonl"
    rows = read_rows(path, since)
    if args.coverage:
        return coverage(rows, args.json)
    events = None if args.no_tokens or not rows else token_events(rows[0]["ts"] - 3600.0)
    report = fold(rows, events)
    print(json.dumps(report, sort_keys=True) if args.json else table(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())

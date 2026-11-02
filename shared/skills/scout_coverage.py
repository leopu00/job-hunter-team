#!/usr/bin/env python3
"""scout_coverage.py — where the Scout must search FIRST for this profile, and how much of it is done.

Measured on a real run (Swedish native, English fluent): 137 passes over 105 sources, 55 of 60 asked once; the five Swedish
portals that were touched gave 3 positions in 5 passes, LinkedIn gave 2 in 17, and Blocket, Indeed SE and LinkedIn Sweden
were never asked. Nothing in the product said which national portals of the profile's languages come BEFORE the minor
ones, and nothing said how much of that was done, so «exhausted» could be declared with the home market untouched.

This is that list, as data (`scout_coverage_table.json`), and the counter over the Scout's own pass log:

  plan     for every strong language of the profile (business level, the native one first) its national portals, core
           ones first, then the English-first and remote portals; each with the country to log, its tier and its access.
  status   one row per portal of the plan, over the current working window: covered | partial | untouched | closed |
           via_email, with its passes, different queries and kinds, candidates and positions inserted. The Scout's
           «log P1» (scout_pass_report.py --coverage) prints the same rows.
  next     the next thing to do: the first core portal not covered (then the first minor one) and the KIND of query to
           run there, so that three passes on a portal are three different questions: the title in the portal's own
           language, the title in English, a synonym, a level word, a city.

A portal is COVERED when it has `JHT_SCOUT_COVER_PASSES` passes (default 3) with `JHT_SCOUT_COVER_QUERIES` different queries
(default 3), one of them in the portal's language when that is not English. It is CLOSED when its last pass says so
(`scout_pass_log.py pass --status closed|gone`) or the table says it is confirmed closed: one pass is enough, and it is
shown as closed, never as covered. A portal that is searched through its email alerts (Indeed) is `via_email`. A source is
matched by its slug or one of its aliases AND its country: LinkedIn Sweden is not LinkedIn Germany.

A profile with no readable languages, or a language the table does not have, gets a plan without it and says so
(`unmapped`): the plan is never a reason to stay unable to finish.

What it prints is slugs, country codes, closed vocabularies and counts. Never the profile's text and never a query.

  python3 scout_coverage.py plan   [--profile FILE] [--json]
  python3 scout_coverage.py status [--profile FILE] [--since-hours H] [--json]
  python3 scout_coverage.py next   [--profile FILE] [--since-hours H] [--json]
  python3 scout_coverage.py boards --country se
        the company boards checked and open for a country (Greenhouse, Lever, Teamtailor): read one GET per company.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import scout_language as _lang  # noqa: E402 — the skills folder, put on the path above

TIER_ORDER = {"core": 0, "minor": 1}
CLOSED_STATUSES = ("closed", "gone")
STATES = ("covered", "partial", "untouched", "closed", "via_email")
# The order of the questions on one portal. WIDE first (the role's family or an entry word alone, read in full and filtered
# against the profile: a title in AND with a place often answers 0), then the portal's own language (the title as people write
# it there), the English title, an adjacent title, a level word, a place.
SLOTS_LOCAL = ("broad", "role_language", "role", "synonym", "level", "city")
SLOTS_ENGLISH = ("broad", "role", "synonym", "level", "city")
REMOTE_BLOCKERS = ("on-site", "onsite", "on site", "in sede", "in-sede", "presenza")


def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, ""))
        return value if value > 0 else default
    except ValueError:
        return default


def needed() -> dict:
    return {"passes": _int_env("JHT_SCOUT_COVER_PASSES", 3), "queries": _int_env("JHT_SCOUT_COVER_QUERIES", 3)}


def table() -> dict:
    return json.loads((HERE / "scout_coverage_table.json").read_text(encoding="utf-8"))


def work_mode(profile_path=None) -> str:
    """The profile's `preferences.work_mode`, lowercased; "" when it cannot be read."""
    path = Path(profile_path) if profile_path else Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht")) / "profile" / "candidate_profile.yml"
    try:
        import yaml
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        prefs = data.get("preferences") if isinstance(data, dict) else None
        return str((prefs or {}).get("work_mode") or "").strip().lower() if isinstance(prefs, dict) else ""
    except Exception:  # noqa: BLE001 — no profile, no yaml, a broken file: no answer, never a guess
        return ""


def entry_keys(entry: dict) -> frozenset:
    return frozenset({_lang.portal_slug(entry["slug"])} | {_lang.portal_slug(a) for a in entry.get("aliases", [])})


def build_plan(spoken: dict, mode: str = "", data: dict | None = None) -> dict:
    """{languages, unmapped, remote, entries}: the portals to cover, core ones of every group first."""
    data = data or table()
    strong = sorted(_lang.business_languages(spoken), key=lambda code: (-spoken[code], code))
    groups = [code for code in strong if code != "en"]
    if "en" in strong:
        groups.append("en")
    remote = bool(strong) and not any(word in mode for word in REMOTE_BLOCKERS)
    if remote:
        groups.append("remote")
    entries, unmapped = [], []
    for rank, code in enumerate(groups):
        listed = data["groups"].get(code)
        if not listed:
            unmapped.append(code)
            continue
        for order, item in enumerate(listed):
            entry = dict(item)
            entry["language"] = code
            entry["portal_language"] = _portal_language(code, item)
            entry["_rank"] = (TIER_ORDER.get(item.get("tier"), 1), rank, order)
            entries.append(entry)
    entries.sort(key=lambda e: e["_rank"])
    for position, entry in enumerate(entries, 1):
        entry.pop("_rank")
        entry["priority"] = position
    return {"languages": strong, "unmapped": unmapped, "remote": remote, "entries": entries}


def _portal_language(group: str, item: dict) -> str:
    """The language the portal's ads are in: the entry's own when the table says it, English for the English and remote
    groups, otherwise the group's."""
    if item.get("portal_language"):
        return item["portal_language"]
    return "en" if group in ("en", "remote") else group


def _matches(entry: dict, row: dict) -> bool:
    return (_lang.portal_slug(row.get("source", "")) in entry_keys(entry)
            and str(row.get("country", "")).lower() == entry["country"])


def measure(entry: dict, rows: list, need: dict | None = None) -> dict:
    """The state of one portal of the plan over `rows` (the log lines of the window)."""
    need = need or needed()
    mine = [r for r in rows if r.get("kind") == "pass" and _matches(entry, r)]
    candidates = [r for r in rows if r.get("kind") == "candidate" and _matches(entry, r)]
    ok = [r for r in mine if r.get("status") not in CLOSED_STATUSES]
    hashes = {r["query_hash"] for r in ok if isinstance(r.get("query_hash"), str)}
    kinds = sorted({r["query_kind"] for r in ok if isinstance(r.get("query_kind"), str)})
    result = {"passes": len(ok), "queries": len(hashes), "kinds": kinds,
              "returned": sum(r["returned"] for r in ok if isinstance(r.get("returned"), int) and not isinstance(r["returned"], bool)),
              "inserted": sum(1 for r in candidates if r.get("outcome") == "inserted")}
    last = max(mine, key=lambda r: r["ts"], default=None)
    if entry.get("access") == "email":
        state = "via_email"
    elif entry.get("access") == "closed" or (last is not None and last.get("status") in CLOSED_STATUSES):
        state = "closed"
    elif not ok:
        state = "untouched"
    else:
        missing = _missing(entry, result, need)
        state = "partial" if missing else "covered"
    result["state"] = state
    result["missing"] = _missing(entry, result, need) if state in ("partial", "untouched") else []
    return result


def _missing(entry: dict, numbers: dict, need: dict) -> list:
    missing = []
    if numbers["passes"] < need["passes"]:
        missing.append("passes %d/%d" % (numbers["passes"], need["passes"]))
    if numbers["queries"] < need["queries"]:
        missing.append("different queries %d/%d" % (numbers["queries"], need["queries"]))
    if entry.get("portal_language") != "en" and "role_language" not in numbers["kinds"]:
        missing.append("a query in the portal's language (query-kind role_language)")
    if "broad" not in numbers["kinds"]:
        missing.append("a BROAD query (query-kind broad: the role family or an entry word on its own, filtered locally)")
    return missing


def status(plan: dict, rows: list, need: dict | None = None) -> list:
    need = need or needed()
    out = []
    for entry in plan["entries"]:
        numbers = measure(entry, rows, need)
        out.append({"slug": entry["slug"], "name": entry["name"], "country": entry["country"], "language": entry["language"],
                    "tier": entry["tier"], "access": entry["access"], "priority": entry["priority"], **numbers})
    return out


DONE_STATES = ("covered", "closed", "via_email")


def _next_kind(entry: dict, numbers: dict):
    """The kind of query to run next on a portal not done yet: the first of its slots not used in the window."""
    slots = SLOTS_ENGLISH if entry["portal_language"] == "en" else SLOTS_LOCAL
    usable = [kind for kind in slots if kind != "city" or entry.get("cities")]
    return next((k for k in usable if k not in numbers["kinds"]), usable[-1])


def portal_states(rows: list, profile=None, now: float | None = None) -> list:
    """One dict per portal of the profile's plan over `rows` (the log lines of the window, as `read_rows` gives them):
    source, country, tier, access, state, passes, distinct_queries, candidates, inserted, next_kind.
    `state` is covered | partial | untouched | closed | via_email; the last two (and covered) are DONE. `profile` is a path
    (default $JHT_HOME/profile/candidate_profile.yml). A profile whose languages cannot be read gives []: no plan, no demand.
    This is the only place that says what «covered» means (JHT_SCOUT_COVER_PASSES, JHT_SCOUT_COVER_QUERIES)."""
    plan = load_plan(profile)
    need = needed()
    out = []
    for entry in plan["entries"]:
        numbers = measure(entry, rows, need)
        done = numbers["state"] in DONE_STATES
        out.append({"source": entry["slug"], "name": entry["name"], "country": entry["country"], "language": entry["language"],
                    "tier": entry["tier"], "access": entry["access"], "priority": entry["priority"],
                    "state": numbers["state"], "passes": numbers["passes"], "distinct_queries": numbers["queries"],
                    "kinds": numbers["kinds"], "candidates": numbers["returned"], "inserted": numbers["inserted"],
                    "missing": numbers["missing"], "next_kind": None if done else _next_kind(entry, numbers)})
    return out


def core_missing(states: list) -> list:
    """The core portals not done yet, as `platsbanken/se 1/3` (the smaller of passes and different queries, over what is
    needed), with ` +role_language` when the query in the portal's language is still missing and ` +broad` when no wide query was
    asked yet. Empty = the core is done."""
    need = needed()
    out = []
    for r in states:
        if r["tier"] != "core" or r["state"] in DONE_STATES:
            continue
        have = min(r["passes"], r["distinct_queries"], need["passes"])
        tags = "".join(" +%s" % kind for kind in ("role_language", "broad") if any(kind in m for m in r["missing"]))
        out.append("%s/%s %d/%d%s" % (r["source"], r["country"], have, need["passes"], tags))
    return out


def status(plan: dict, rows: list, need: dict | None = None) -> list:
    """The same rows with the column names of the report (slug, queries, returned)."""
    need = need or needed()
    out = []
    for entry in plan["entries"]:
        numbers = measure(entry, rows, need)
        out.append({"slug": entry["slug"], "name": entry["name"], "country": entry["country"], "language": entry["language"],
                    "tier": entry["tier"], "access": entry["access"], "priority": entry["priority"], **numbers})
    return out


def next_step(plan: dict, rows: list, need: dict | None = None, profile=None) -> dict:
    need = need or needed()
    data = table()
    for entry in plan["entries"]:
        numbers = measure(entry, rows, need)
        if numbers["state"] in DONE_STATES:
            continue
        kind = _next_kind(entry, numbers)
        terms = data["level_terms"].get(entry["portal_language"], data["level_terms"]["en"])
        step = {"plan_done": False, "source": entry["slug"], "name": entry["name"], "country": entry["country"],
                "tier": entry["tier"], "host": entry.get("host"), "query_kind": kind,
                "query_language": entry["portal_language"] if kind in ("role_language", "broad") else "en",
                "have": {"passes": numbers["passes"], "queries": numbers["queries"]}, "need": need}
        if kind == "broad":
            step["broad_terms"] = list(data.get("broad_terms", {}).get(entry["portal_language"], data.get("broad_terms", {}).get("en", []))) + list(terms)
            step["broad_worked_in_english"] = [e["term"] for e in data.get("broad_examples", {}).get("en", [])]
            step["how"] = ("WIDE: the role's family or one of broad_terms on its own, no full title and no place; read ALL the "
                           "results (every page) and filter them against the profile yourself")
        if kind == "level":
            step["level_terms"] = terms
        if kind == "city":
            step["cities"] = entry.get("cities", [])
        step["log"] = ("scout_pass_log.py pass --source %s --country %s --query-kind %s --query \"<the query you ran>\" "
                       "--returned <N> [--status closed|gone|empty]" % (entry["slug"], entry["country"], kind))
        return step
    return {"plan_done": True, "core_done": not core_missing(portal_states(rows, profile)), "entries": len(plan["entries"])}


def default_since(now: float) -> float:
    try:
        import scout_exhaustion
        start = scout_exhaustion.window_start(now)
        if start is not None:
            return start
    except Exception:  # noqa: BLE001 — no window known: the lookback of the exhaustion tool
        pass
    return now - 12.0 * 3600


def load_plan(profile_path=None) -> dict:
    return build_plan(_lang.read_languages(profile_path), work_mode(profile_path))


def rows_since(since_ts: float) -> list:
    import scout_exhaustion
    return scout_exhaustion.read_rows(since_ts)


def render(plan: dict, report: list) -> str:
    lines = ["# %-3s %-6s %-4s %-26s %-3s %-9s %6s %7s %5s %5s  %s" % (
        "", "tier", "lang", "portal", "cc", "state", "passes", "queries", "cand", "ins", "missing")]
    for r in report:
        lines.append("%-5d %-6s %-4s %-26s %-3s %-9s %6d %7d %5d %5d  %s" % (
            r["priority"], r["tier"], r["language"], r["slug"][:26], r["country"], r["state"], r["passes"], r["queries"],
            r["returned"], r["inserted"], "; ".join(r["missing"])))
    if plan["unmapped"]:
        lines.append("languages without a table yet: " + " ".join(plan["unmapped"]))
    if not plan["entries"]:
        lines.append("(no plan: the profile's languages cannot be read)")
    return "\n".join(lines)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="scout_coverage", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("boards").add_argument("--country", required=True)
    for name in ("plan", "status", "next"):
        p = sub.add_parser(name)
        p.add_argument("--profile", default=None, help="default: $JHT_HOME/profile/candidate_profile.yml")
        p.add_argument("--json", action="store_true")
        if name != "plan":
            p.add_argument("--since-hours", type=float, default=None)
    args = ap.parse_args(argv)
    if args.cmd == "boards":
        boards = table().get("ats_boards", {}).get(args.country.lower())
        print(json.dumps(boards if boards else {"boards": None, "country": args.country.lower()}, sort_keys=True, ensure_ascii=False))
        return 0 if boards else 1
    plan = load_plan(args.profile)
    if args.cmd == "plan":
        print(json.dumps(plan, sort_keys=True, ensure_ascii=False) if args.json else render(plan, status(plan, [])))
        return 0
    now = time.time()
    since = now - args.since_hours * 3600.0 if args.since_hours is not None else default_since(now)
    rows = rows_since(since)
    if args.cmd == "status":
        report = status(plan, rows)
        if args.json:
            print(json.dumps({"languages": plan["languages"], "unmapped": plan["unmapped"], "rows": report,
                              "core_missing": core_missing(portal_states(rows, args.profile))}, sort_keys=True, ensure_ascii=False))
        else:
            print(render(plan, report))
        return 0
    step = next_step(plan, rows, profile=args.profile)
    print(json.dumps(step, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

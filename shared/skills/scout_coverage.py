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
           `blocked` is a portal that answered with an error (429, 5xx, timeout): it rests for JHT_SCOUT_BLOCKED_PAUSE_H hours
           (default 3), `next` goes on to the next portal and lists it under `paused`, and it never counts as covered, closed or dry;
           three blocked passes with no good one close it.
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
  python3 scout_coverage.py next   [--profile FILE] [--since-hours H] [--agent MY_ID] [--json]
        with --agent the answer also says whether the profile changed since this Scout built its circles (`profile`:
        changed, the groups, see profile_version.py): the plan above is read from the profile every time, so a language
        added to it adds its portals, and the passes already logged stay counted.
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
# `blocked` (a 429, a 5xx, a timeout, a network error) is NOT `closed` and NOT an empty answer: the source said nothing about
# the market. It is neither a pass of the coverage nor a search of the exhaustion; the portal rests for a few hours and is
# asked again, and three blocked passes with no good one close it (a source that never answers does not forbid the end forever).
BLOCKED_STATUS = "blocked"
DEFAULT_PAUSE_H = 3.0
BLOCKS_THEN_CLOSED = 3
STATES = ("covered", "partial", "untouched", "closed", "via_email", "blocked")
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


def pause_hours() -> float:
    try:
        value = float(os.environ.get("JHT_SCOUT_BLOCKED_PAUSE_H", ""))
        return value if 0 < value <= 48 else DEFAULT_PAUSE_H
    except ValueError:
        return DEFAULT_PAUSE_H


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


def measure(entry: dict, rows: list, need: dict | None = None, now: float | None = None) -> dict:
    """The state of one portal of the plan over `rows` (the log lines of the window)."""
    need = need or needed()
    now = time.time() if now is None else now
    mine = [r for r in rows if r.get("kind") == "pass" and _matches(entry, r)]
    candidates = [r for r in rows if r.get("kind") == "candidate" and _matches(entry, r)]
    blocked = [r for r in mine if r.get("status") == BLOCKED_STATUS]
    mine = [r for r in mine if r.get("status") != BLOCKED_STATUS]       # a blocked pass says nothing about the market
    ok = [r for r in mine if r.get("status") not in CLOSED_STATUSES]
    hashes = {r["query_hash"] for r in ok if isinstance(r.get("query_hash"), str)}
    kinds = sorted({r["query_kind"] for r in ok if isinstance(r.get("query_kind"), str)})
    result = {"passes": len(ok), "queries": len(hashes), "kinds": kinds,
              "returned": sum(r["returned"] for r in ok if isinstance(r.get("returned"), int) and not isinstance(r["returned"], bool)),
              "inserted": sum(1 for r in candidates if r.get("outcome") == "inserted")}
    last = max(mine, key=lambda r: r["ts"], default=None)
    last_block = max((r["ts"] for r in blocked), default=None)
    result["blocks"] = len(blocked)
    result["retry_at"] = None
    if entry.get("access") == "email":
        state = "via_email"
    elif entry.get("access") == "closed" or (last is not None and last.get("status") in CLOSED_STATUSES):
        state = "closed"
    elif len(blocked) >= BLOCKS_THEN_CLOSED and not ok:
        state = "closed"                              # asked three times, never answered: the end does not wait for it
    elif last_block is not None and (last is None or last_block > last["ts"]) and now < last_block + pause_hours() * 3600:
        state = "blocked"
        result["retry_at"] = last_block + pause_hours() * 3600
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


def status(plan: dict, rows: list, need: dict | None = None, now: float | None = None) -> list:
    need = need or needed()
    out = []
    for entry in plan["entries"]:
        numbers = measure(entry, rows, need, now)
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
        numbers = measure(entry, rows, need, now)
        done = numbers["state"] in DONE_STATES
        out.append({"source": entry["slug"], "name": entry["name"], "country": entry["country"], "language": entry["language"],
                    "tier": entry["tier"], "access": entry["access"], "priority": entry["priority"],
                    "state": numbers["state"], "passes": numbers["passes"], "distinct_queries": numbers["queries"],
                    "kinds": numbers["kinds"], "candidates": numbers["returned"], "inserted": numbers["inserted"],
                    "missing": numbers["missing"], "next_kind": None if done or numbers["state"] == "blocked" else _next_kind(entry, numbers),
                    "blocks": numbers["blocks"], "retry_at": numbers["retry_at"]})
    return out


def _hhmm(ts) -> str:
    try:
        return time.strftime("%H:%M", time.gmtime(float(ts))) + " UTC"
    except (TypeError, ValueError, OverflowError):
        return "?"


def _iso(ts):
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(float(ts)))
    except (TypeError, ValueError, OverflowError):
        return None


def _missing_lines(states: list, tiers: tuple) -> list:
    need = needed()
    out = []
    for r in states:
        if r["tier"] not in tiers or r["state"] in DONE_STATES:
            continue
        if r["state"] == "blocked":
            # the source answered with an error, not with «nothing»: it rests and is asked again, never counted as dry
            out.append("%s/%s blocked, retry at %s" % (r["source"], r["country"], _hhmm(r.get("retry_at"))))
            continue
        have = min(r["passes"], r["distinct_queries"], need["passes"])
        tags = "".join(" +%s" % kind for kind in ("role_language", "broad") if any(kind in m for m in r["missing"]))
        out.append("%s/%s %d/%d%s" % (r["source"], r["country"], have, need["passes"], tags))
    return out


def core_missing(states: list) -> list:
    """The core portals not done yet, as `platsbanken/se 1/3` (the smaller of passes and different queries, over what is
    needed), with ` +role_language` when the query in the portal's language is still missing and ` +broad` when no wide query was
    asked yet, or `platsbanken/se blocked, retry at 03:10 UTC`. Empty = the core is done."""
    return _missing_lines(states, ("core",))


def plan_missing(states: list) -> list:
    """EVERY portal of the plan not done yet (core first, then the minor ones, every country of the plan), in the same words as
    `core_missing`. Empty = the whole plan is covered, closed or read by email: the only state in which the market can be called
    saturated (JHT-T187)."""
    return _missing_lines(states, ("core", "minor"))


def status(plan: dict, rows: list, need: dict | None = None, now: float | None = None) -> list:
    """The same rows with the column names of the report (slug, queries, returned)."""
    need = need or needed()
    out = []
    for entry in plan["entries"]:
        numbers = measure(entry, rows, need, now)
        out.append({"slug": entry["slug"], "name": entry["name"], "country": entry["country"], "language": entry["language"],
                    "tier": entry["tier"], "access": entry["access"], "priority": entry["priority"], **numbers})
    return out


def next_step(plan: dict, rows: list, need: dict | None = None, profile=None, now: float | None = None, lane=None) -> dict:
    """The next thing to search. `lane` (a set of portal keys: the Scout's own sources of the burst, see `lanes`) puts the portals
    of that lane first, in the plan's order; the rest of the plan follows, so a Scout whose lane is done goes on to what is left."""
    need = need or needed()
    now = time.time() if now is None else now
    data = table()
    paused = []
    entries = plan["entries"]
    if lane:
        entries = [e for e in entries if lane & entry_keys(e)] + [e for e in entries if not lane & entry_keys(e)]
    for entry in entries:
        numbers = measure(entry, rows, need, now)
        if numbers["state"] in DONE_STATES:
            continue
        if numbers["state"] == "blocked":
            # it said nothing about the market: rest, go to the next portal, come back when the pause ends
            paused.append({"source": entry["slug"], "country": entry["country"], "retry_at": _iso(numbers["retry_at"])})
            continue
        kind = _next_kind(entry, numbers)
        terms = data["level_terms"].get(entry["portal_language"], data["level_terms"]["en"])
        step = {"plan_done": False, "source": entry["slug"], "name": entry["name"], "country": entry["country"],
                "tier": entry["tier"], "host": entry.get("host"), "query_kind": kind,
                "query_language": entry["portal_language"] if kind in ("role_language", "broad") else "en",
                "search_scope": {"from": "profile", "keep_area": True},
                "have": {"passes": numbers["passes"], "queries": numbers["queries"]}, "need": need}
        for field in ("api", "hint"):
            if entry.get(field):
                step[field] = entry[field]
        if lane:
            # a Scout with a lane gets the search of ITS lane; a portal of another lane only when its own has nothing left, and it says so
            step["in_lane"] = bool(lane & entry_keys(entry))
            if not step["in_lane"]:
                step["lane_done"] = "your lane has nothing left: this portal is another Scout's lane, asked only because yours is done"
        if kind == "broad":
            step["broad_terms"] = list(data.get("broad_terms", {}).get(entry["portal_language"], data.get("broad_terms", {}).get("en", []))) + list(terms)
            step["broad_worked_in_english"] = [e["term"] for e in data.get("broad_examples", {}).get("en", [])]
            step["how"] = ("WIDE: the role's family or one of broad_terms on its own, no full title and no place in keywords; "
                           "keep the profile's geographic filter separate and unchanged; read ALL the "
                           "results (every page) and filter them against the profile yourself")
        if kind == "level":
            step["level_terms"] = terms
        if kind == "city":
            step["cities"] = entry.get("cities", [])
        step["log"] = ("scout_pass_log.py pass --source %s --country %s --query-kind %s --query \"<the query you ran>\" "
                       "--returned <N> [--status closed|gone|empty|blocked]" % (entry["slug"], entry["country"], kind))
        if paused:
            step["paused"] = paused
        return step
    if paused:
        # everything left is resting after an error: neither «done» nor «dry». Do something else (a creative attempt, another
        # country, the company boards) or wait for the first retry; never call the market saturated.
        return {"plan_done": False, "waiting": True, "paused": paused, "retry_at": min(p["retry_at"] for p in paused if p["retry_at"]) if any(p["retry_at"] for p in paused) else None,
                "do": "every portal left answered with an error and rests; search elsewhere (see boards) or retry at retry_at"}
    return {"plan_done": True, "core_done": not core_missing(portal_states(rows, profile, now)), "entries": len(plan["entries"])}


AVOID_MAX = 12
ATS_FAMILIES = ("greenhouse", "lever", "ashby")      # the public company-board APIs ats_board_search.py reads
SHARED_CAP_SOURCES = ("linkedin",)                   # one shared request cap for the whole team: one Scout holds it


def lanes(plan: dict, count: int) -> list:
    """The partition of a burst of `count` Scouts, decided by the plan and not negotiated: `[{"lane", "areas", "sources"}]`, one
    per Scout, no source in two of them. The sources are the plan's own (a search a Scout reads; not the email ones, not the
    closed ones), in the plan's order. LinkedIn, which has one request cap for the whole team, is lane 0's alone; the others are
    dealt round robin from lane 1, so every lane gets core portals first; the company-board APIs (Greenhouse, Lever, Ashby) are
    the last lane's when there are three Scouts or more. Same plan and same count: same lanes, whoever asks. Measured 11/11: the
    Scouts spent their first 3.5 minutes agreeing on exactly this by message."""
    count = max(1, int(count))
    slugs = []
    for entry in plan["entries"]:
        if entry["access"] == "search" and entry["slug"] not in slugs:
            slugs.append(entry["slug"])
    out = [{"lane": k, "areas": "1,2", "sources": []} for k in range(count)]
    out[0]["sources"].extend(slug for slug in slugs if slug in SHARED_CAP_SOURCES)
    others = [slug for slug in slugs if slug not in SHARED_CAP_SOURCES]
    order = list(range(1, count)) or [0]
    for number, slug in enumerate(others):
        out[order[number % len(order)]]["sources"].append(slug)
    if count >= 3:
        out[-1]["sources"].extend(family for family in ATS_FAMILIES if family not in out[-1]["sources"])
    return out


def avoid_list(plan: dict, rows: list, data: dict | None = None) -> list:
    """The sources the Scout must NOT open, `[{"source", "why"}]`: the ones the table says fail with certainty (`avoid`: not in the
    plan, so no state of their own), and the ones that failed with certainty on THIS run, for any Scout (the last pass logged says
    closed or gone, or two passes were blocked and none was good). The portals of the plan are not here: they show their own
    state (closed, blocked). A Scout that spends 11-17 minutes of a 30-minute burst on dead portals does not insert (measured 11/11)."""
    data = data or table()
    inplan = set()
    for entry in plan["entries"]:
        inplan |= entry_keys(entry)
    out, seen = [], set()
    for item in data.get("avoid", []):
        key = _lang.portal_slug(item["source"])
        if key not in seen:
            seen.add(key)
            out.append({"source": item["source"], "why": item["why"]})
    by_source: dict = {}
    for row in rows:
        if row.get("kind") == "pass" and isinstance(row.get("source"), str):
            by_source.setdefault(_lang.portal_slug(row["source"]), []).append(row)
    for key, passes in sorted(by_source.items()):
        if key in inplan or key in seen:
            continue
        last = max(passes, key=lambda r: r["ts"])
        blocked = [r for r in passes if r.get("status") == BLOCKED_STATUS]
        good = [r for r in passes if r.get("status") not in CLOSED_STATUSES and r.get("status") != BLOCKED_STATUS]
        if last.get("status") in CLOSED_STATUSES or (len(blocked) >= 2 and not good):
            seen.add(key)
            out.append({"source": key, "why": "closed or blocked on this run"})
    return out[:AVOID_MAX]


def lane_of(agent):
    """The portal keys of `agent`'s lane of the burst (scout_coord.py auto), or None: no lane, or it cannot be read."""
    if not agent:
        return None
    try:
        import scout_coord
        fonti = scout_coord.lane_sources(agent.strip().lower())
        return frozenset(_lang.portal_slug(f) for f in fonti) if fonti else None
    except Exception:  # noqa: BLE001 — a lane that cannot be read is no lane: the plan's own order
        return None


def profile_news(agent: str, profile_path=None) -> dict:
    """What the Scout `agent` has to know about the profile it built its circles on: `changed`, the `groups` that changed
    (roles, places, languages, mode) and, when it did, what to do. Silence (no version file, a profile that cannot be read,
    a name that is not an agent's) is `changed: false`: the search is never stopped by this."""
    try:
        import profile_version
        name = agent.strip().lower()
        if not profile_version.AGENT.match(name):
            return {"changed": False}
        news = profile_version.check(name, Path(profile_path) if profile_path else None)
    except Exception:  # noqa: BLE001 — a question about news never costs the search
        return {"changed": False}
    out = {"changed": bool(news.get("changed")), "groups": news.get("groups", []), "version": news.get("version")}
    if out["changed"]:
        out["do"] = ("read the profile again, widen or narrow your circles for the groups that changed (the portals of a new "
                     "language are in this plan already), keep every position and every pass you logged, then run "
                     "profile_version.py ack --agent %s" % agent.strip().lower())
    return out


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
        if name == "next":
            p.add_argument("--agent", default=None, help="the Scout's own id: the answer says if the profile changed since it last acknowledged")
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
        report = status(plan, rows, now=now)
        if args.json:
            print(json.dumps({"languages": plan["languages"], "unmapped": plan["unmapped"], "rows": report,
                              "core_missing": core_missing(portal_states(rows, args.profile, now)),
                              "plan_missing": plan_missing(portal_states(rows, args.profile, now))}, sort_keys=True, ensure_ascii=False))
        else:
            print(render(plan, report))
        return 0
    step = next_step(plan, rows, profile=args.profile, now=now, lane=lane_of(args.agent))
    avoid = avoid_list(plan, rows)
    if avoid:
        step["avoid"] = avoid          # do not open these: they fail with certainty (the table, or this run's own pass log)
    if args.agent:
        step["profile"] = profile_news(args.agent, args.profile)
    print(json.dumps(step, sort_keys=True, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

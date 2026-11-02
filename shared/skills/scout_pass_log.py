#!/usr/bin/env python3
"""scout_pass_log.py — what the Scout's searches return and where the candidates go.

The question this answers: is a profile's search space exhausted, or does the Scout search badly and discard late
what it could have excluded before spending? The product could not say. A candidate dropped BEFORE the INSERT (a dead
link, a filter of Gate 4, a language seen in the JD) left no trace anywhere but the Scout's own session. Now it leaves
one line.

Two kinds of line, appended to `$JHT_HOME/logs/scout-passes.jsonl`:

  pass       the Scout asked a source and got a list: how many candidates came back.
  candidate  one candidate of that list went through the gates: where it ended (inserted, or the reason it was dropped)
             and whether the full JD was fetched for it (`--opened`: the expensive step).

`scout_pass_report.py` folds the lines into one row per pass and adds the budget spent between them.

What can end up in a line (the file is read by people who are not the user, so NOTHING of the profile may enter):
  - `source`: a slug of [a-z0-9._-], at most 40 characters (`linkedin`, `greenhouse`, ...);
  - `country`: a two-letter code, or `multi` / `remote`;
  - `query_kind`: one word from a closed list;
  - `query_hash`: the first 10 hex digits of the SHA-256 of the normalised query. The query itself is never stored,
    and a hash is enough to tell two passes with the same query apart;
  - counts, the outcome and the agent's own id: closed vocabularies or numbers.
Anything else is refused (exit 2, nothing written), so a free text typed by mistake cannot reach the file.

It must not slow the Scout down: one small append, no database, no network, no import beyond the standard library. An
error in writing the line (disk full, folder not writable) is a warning on stderr and exit 0: the measure never stops
the work it measures.

Use:
  python3 scout_pass_log.py pass --source greenhouse --country nl --returned 25 \\
         --query-kind role --query "backend engineer amsterdam"
  python3 scout_pass_log.py pass --source arbetsformedlingen --country se --returned 0 --status closed   # 403: closed for the pass
  python3 scout_pass_log.py candidate --source greenhouse --country nl --outcome language --opened
  python3 scout_pass_log.py candidate --source greenhouse --country nl --outcome inserted --opened
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

VERSION = 1
# Where a candidate can end. `inserted` is the INSERT of Gate 5; the others are the reasons it never got there.
OUTCOMES = (
    "inserted",
    "duplicate",     # Gate 1
    "dead_link",     # Gate 2: HTTP error
    "closed_ad",     # Gate 2: redirect to a generic page, or the ad says it is closed
    "seniority",     # Gate 4: title senior/lead/staff/...
    "work_auth",     # Gate 4
    "domain",        # Gate 4: outside IT
    "experience",    # Gate 4: hard requirement above the real years + 3
    "language",      # a language the user does not speak, seen in the list or in the JD
    "other",
)
# What the query was about, never the query. `role` is the profile's title in English, `role_language` the same title in
# the language of the portal, `synonym` an adjacent title, `level` a title with a level word (junior, graduate...), `city`
# a title with a place: the kinds scout_coverage.py asks for, one per pass, so a portal is not asked the same thing twice.
# `broad` is a WIDE question: the role's family, or a level / entry word (internship, graduate...) on its own, no full title
# and no place. A portal that takes several words as AND answers 0 to «junior project coordinator» + a city and hundreds to
# «praktik» (Platsbanken, real run of 02/11): the Scout reads the wide list and filters it against the profile itself.
QUERY_KINDS = ("role", "role_language", "synonym", "level", "city", "broad", "company", "generic", "other")
# How the portal answered. Left out, the pass is a normal one. `closed` = it cannot be read this pass (403, a login wall,
# a challenge, a page that is an empty shell); `gone` = 410, the endpoint is dead and the source comes off the lists.
STATUSES = ("ok", "empty", "closed", "gone")
SOURCE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,39}$")
COUNTRY = re.compile(r"^(?:[a-z]{2}|multi|remote)$")
AGENT = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
MAX_COUNT = 100000
# One backup is enough: the report reads days, not months.
ROTATE_BYTES = 5 * 1024 * 1024


def home() -> Path:
    return Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))


def log_path() -> Path:
    return home() / "logs" / "scout-passes.jsonl"


class Refused(ValueError):
    """A value outside the closed vocabularies: nothing is written."""


def query_hash(query: str) -> str:
    return hashlib.sha256(" ".join(str(query).lower().split()).encode("utf-8")).hexdigest()[:10]


def _agent(explicit):
    name = str(explicit or os.environ.get("JHT_AGENT_NAME") or "unknown").strip().lower()
    return name if AGENT.match(name) else "unknown"


def _count(name: str, value) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= MAX_COUNT:
        raise Refused("%s must be a whole number from 0 to %d" % (name, MAX_COUNT))
    return value


def _common(args, kind: str, now: float) -> dict:
    source = str(args.source or "").strip().lower()
    if not SOURCE.match(source):
        raise Refused("source must be a slug of a-z 0-9 . _ - (at most 40 characters)")
    country = str(args.country or "multi").strip().lower()
    if not COUNTRY.match(country):
        raise Refused("country must be a two-letter code, `multi` or `remote`")
    return {"v": VERSION, "kind": kind, "ts": round(now, 3), "agent": _agent(args.agent),
            "source": source, "country": country}


def build(args, now: float = None) -> dict:
    """The line for these arguments, or `Refused`."""
    now = time.time() if now is None else now
    if args.cmd == "pass":
        row = _common(args, "pass", now)
        row["returned"] = _count("returned", args.returned)
        kind = args.query_kind or "other"
        if kind not in QUERY_KINDS:
            raise Refused("query-kind must be one of: %s" % ", ".join(QUERY_KINDS))
        row["query_kind"] = kind
        if args.query:
            row["query_hash"] = query_hash(args.query)
        if getattr(args, "status", None):
            if args.status not in STATUSES:
                raise Refused("status must be one of: %s" % ", ".join(STATUSES))
            row["status"] = args.status
        return row
    row = _common(args, "candidate", now)
    if args.outcome not in OUTCOMES:
        raise Refused("outcome must be one of: %s" % ", ".join(OUTCOMES))
    row["outcome"] = args.outcome
    row["opened"] = bool(args.opened)
    return row


def append(row: dict, path: Path = None) -> bool:
    """One O_APPEND write of one line (a single write under PIPE_BUF stays whole even with two Scouts writing).
    False, and a warning, when it cannot: the Scout goes on."""
    path = path or log_path()
    line = (json.dumps(row, separators=(",", ":"), sort_keys=True) + "\n").encode("utf-8")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            if path.stat().st_size > ROTATE_BYTES:
                os.replace(path, path.with_suffix(".jsonl.1"))
        except OSError:
            pass
        fd = os.open(str(path), os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o644)
        try:
            os.write(fd, line)
        finally:
            os.close(fd)
        return True
    except OSError as exc:
        print("scout_pass_log: could not write the line (%s)" % exc.__class__.__name__, file=sys.stderr)
        return False


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="scout_pass_log", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name, text in (("pass", "a source answered with a list of candidates"),
                       ("candidate", "one candidate went through the gates")):
        p = sub.add_parser(name, help=text)
        p.add_argument("--source", required=True)
        p.add_argument("--country", default="multi")
        p.add_argument("--agent", default=None, help="default: JHT_AGENT_NAME")
    p = sub.choices["pass"]
    p.add_argument("--returned", type=int, required=True, help="how many candidates the source gave back")
    p.add_argument("--query-kind", default="other", choices=QUERY_KINDS)
    p.add_argument("--query", default=None, help="only its hash is stored, never the text")
    p.add_argument("--status", default=None, choices=STATUSES, help="how the portal answered; left out = a normal pass")
    p = sub.choices["candidate"]
    p.add_argument("--outcome", required=True, choices=OUTCOMES)
    p.add_argument("--opened", action="store_true", help="the full JD was fetched for this candidate")
    return ap


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        row = build(args)
    except Refused as exc:
        print("scout_pass_log: refused: %s" % exc, file=sys.stderr)
        return 2
    append(row)
    return 0


if __name__ == "__main__":
    sys.exit(main())

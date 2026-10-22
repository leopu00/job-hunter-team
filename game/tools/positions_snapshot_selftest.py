#!/usr/bin/env python3
"""The positions snapshot of the game reads location_precision, and an older jobs.db
without the column still gives the whole snapshot.

vps_backend.gd sends a one-line Python script and its queries to the container through
`docker exec ... python3 -c '<script>' <db> '<query>' ...` (local_backend.gd runs the same
command). This test rebuilds that command from the GDScript source, the constants and the
`_ssh(...)` call of `_fetch_positions`, runs it with sh against two synthetic jobs.db
(with and without location_precision) and reads the JSON it prints.

Run: python3 tools/positions_snapshot_selftest.py (from game/).
"""

from __future__ import annotations

import json
import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

GAME = Path(__file__).resolve().parents[1]
SOURCE = (GAME / "scripts" / "backend" / "vps_backend.gd").read_text(encoding="utf-8")


def _constants(source: str) -> dict[str, str]:
    """`const NAME := "a" + "b" + OTHER \\` blocks: string literals and earlier constants only."""
    found: dict[str, str] = {}
    lines = source.splitlines()
    i = 0
    while i < len(lines):
        m = re.match(r"^(?:static var|const) ([A-Z_]+) := (.*)$", lines[i])
        if not m:
            i += 1
            continue
        expr = m.group(2)
        while expr.rstrip().endswith("\\"):
            i += 1
            expr = expr.rstrip()[:-1] + " " + lines[i].strip()
        value = _evaluate(expr, found)
        if value is not None:
            found[m.group(1)] = value
        i += 1
    return found


TOKEN = re.compile(r'\s*(?:"((?:[^"\\]|\\.)*)"|([A-Z_]+))\s*(\+|$)')


def _evaluate(expr: str, known: dict[str, str]) -> str | None:
    out, at = [], 0
    while at < len(expr):
        m = TOKEN.match(expr, at)
        if not m:
            return None
        if m.group(1) is not None:
            out.append(m.group(1).encode().decode("unicode_escape"))
        elif m.group(2) in known:
            out.append(known[m.group(2)])
        else:
            return None
        at = m.end()
    return "".join(out)


CONST = _constants(SOURCE)


def _fetch_command() -> str:
    body = SOURCE[SOURCE.index("func _fetch_positions() -> void:") :]
    call = body[body.index("_ssh(") + len("_ssh(") : body.index(")\n", body.index("_ssh("))]
    expr = " ".join(part.strip().rstrip("\\") for part in call.splitlines())
    command = _evaluate(expr, CONST)
    assert command is not None, expr
    return command


def _jobs_db(path: Path, *, with_level: bool) -> None:
    select = CONST["POSITIONS_SELECT"]
    # the columns the queries read, and the level only in the recent one (never taken from the
    # query itself: a query that forgot the column must not shape the database that tests it)
    columns = {alias: sorted(set(re.findall(rf"\b{alias}\.(\w+)", select)) - {"location_precision"})
               for alias in "psa"}
    if with_level:
        columns["p"].append("location_precision")
    db = sqlite3.connect(path)
    db.execute(f"CREATE TABLE positions ({', '.join(columns['p'])})")
    db.execute(f"CREATE TABLE scores (position_id, {', '.join(c for c in columns['s'] if c != 'position_id')})")
    db.execute(f"CREATE TABLE applications (position_id, {', '.join(c for c in columns['a'] if c != 'position_id')})")
    db.execute("CREATE TABLE position_highlights (id INTEGER PRIMARY KEY, position_id, type, text)")
    db.execute("CREATE TABLE position_tickets (id INTEGER PRIMARY KEY, position_id, request_text, kind, status,"
               " assigned_agent, response_text, created_at)")
    db.execute("CREATE TABLE position_state_transitions (id INTEGER PRIMARY KEY, position_id, from_state,"
               " to_state, ts, by_agent)")
    row = {"id": 7, "title": "Backend Engineer", "company": "Acme", "status": "checked", "loc_city": "Roma",
           "loc_country": "Italy", "office_lat": 41.9, "office_lon": 12.5, "office_verified": 0,
           "created_at": "2026-10-22"}
    if with_level:
        row["location_precision"] = "street"
    db.execute(f"INSERT INTO positions ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})", list(row.values()))
    db.commit()
    db.close()


def _snapshot(db: Path) -> dict:
    command = _fetch_command()
    prefix = "docker exec -i jht python3 -c "
    assert command.startswith(prefix), command[:60]
    command = f"'{sys.executable}' -c " + command[len(prefix):].replace("/jht_home/jobs.db", str(db), 1)
    done = subprocess.run(["sh", "-c", command], capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    line = next(line for line in done.stdout.splitlines() if line.startswith("{"))
    return json.loads(line)


def main() -> int:
    failures: list[str] = []

    def check(what: str, ok: bool, got: object = None) -> None:
        if not ok:
            failures.append(f"{what}: {got!r}")

    # the OS.execute recipe: no double quote, $, # or newline inside an argument
    for name in ("POSITIONS_PY", "POSITIONS_SELECT", "POSITIONS_SELECT_NO_LEVEL", "LEVEL_COLUMN",
                 "POSITIONS_COLUMNS_PRAGMA"):
        value = CONST.get(name)
        check(f"{name} exists", value is not None, sorted(CONST))
        if value is not None:
            check(f"{name} has no quote, $, # or newline", not re.search(r"[\"'$#\n]", value), value)
    check("the query names the level", "p.location_precision" in CONST.get("POSITIONS_SELECT", ""))
    check("the fallback query does not", "location_precision" not in CONST.get("POSITIONS_SELECT_NO_LEVEL", "x"))

    with tempfile.TemporaryDirectory() as tmp:
        new_db, old_db = Path(tmp) / "new.db", Path(tmp) / "old.db"
        _jobs_db(new_db, with_level=True)
        _jobs_db(old_db, with_level=False)
        new = _snapshot(new_db)
        check("a recent jobs.db: one position", len(new.get("p", [])) == 1, new)
        if new.get("p"):
            check("a recent jobs.db: the level arrives", new["p"][0].get("location_precision") == "street", new["p"][0])
        old = _snapshot(old_db)
        check("an older jobs.db: the snapshot is still there", len(old.get("p", [])) == 1, old)
        if old.get("p"):
            check("an older jobs.db: no level", "location_precision" not in old["p"][0], old["p"][0])
            check("an older jobs.db: the rest of the row", old["p"][0].get("office_verified") == 0, old["p"][0])
        check("highlights, tickets and transitions still read", all(k in old for k in ("h", "t", "tr")), list(old))

    print("POSITIONS-SNAPSHOT-TEST", "PASS" if not failures else "FAIL " + json.dumps(failures))
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())

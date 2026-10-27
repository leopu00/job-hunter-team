"""La lettura dell'attivita' degli agenti (op `team_activity` di POSITIONS_READ_PY, desktop/src-tauri).

La pagina Team del desktop con profilo locale legge dal jobs.db della squadra quello che il web legge
con `getTeamActivityLocal`: i conteggi per ruolo, istanza e giorno, e gli eventi piu' recenti con la
posizione toccata. Lo script gira in sola lettura; i conteggi si fanno li' (la risposta non cresce con lo
storico); una colonna che manca al database conta zero senza errore.
"""

from __future__ import annotations

import io
import json
import re
import sqlite3
import sys
from collections import Counter
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "desktop" / "src-tauri" / "src" / "existing_team_runtime.rs"


def _script() -> str:
    found = re.search(r'const POSITIONS_READ_PY: &str = r#"(.*?)"#;', SOURCE.read_text(encoding="utf-8"), re.S)
    assert found, "POSITIONS_READ_PY non e' piu' in existing_team_runtime.rs"
    return found.group(1)


def _run(home: Path, request: dict, statements: list[str] | None = None) -> dict:
    source = _script().replace("/jht_home", str(home))
    real_connect = sqlite3.connect

    def connect(*args, **kwargs):
        connection = real_connect(*args, **kwargs)
        if statements is not None:
            connection.set_trace_callback(statements.append)
        return connection

    out = io.StringIO()
    stdin, stdout, patched = sys.stdin, sys.stdout, sqlite3.connect
    sys.stdin, sys.stdout, sqlite3.connect = io.StringIO(json.dumps(request) + "\n"), out, connect
    try:
        with pytest.raises(SystemExit):
            exec(compile(source, "positions_read.py", "exec"), {"__name__": "__main__"})
    finally:
        sys.stdin, sys.stdout, sqlite3.connect = stdin, stdout, patched
    return json.loads(out.getvalue())


def _database(home: Path, *, full: bool = True) -> list[tuple[str, str | None, str, int]]:
    """A team's jobs.db; returns every event as (role, actor, ts, position id) for the checks."""
    home.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(home / "jobs.db")
    positions = "id INTEGER PRIMARY KEY, legacy_id INTEGER, title TEXT, company TEXT, found_at TEXT"
    if full:
        positions += ", found_by TEXT, last_checked TEXT"
    db.executescript(
        f"""
        CREATE TABLE positions({positions});
        CREATE TABLE scores(id INTEGER PRIMARY KEY, position_id INTEGER, total_score INTEGER{", scored_at TEXT, scored_by TEXT" if full else ""});
        CREATE TABLE applications(id INTEGER PRIMARY KEY, position_id INTEGER{", written_at TEXT, written_by TEXT, critic_reviewed_at TEXT, reviewed_by TEXT" if full else ""});
        """
    )
    events: list[tuple[str, str | None, str, int]] = []
    for n in range(1, 31):
        day = f"2026-10-{1 + n % 20:02d}"
        found = f"{day}T0{n % 9}:15:00Z"
        scout = f"scout-{1 + n % 3}"
        if full:
            checked = f"2026-10-{1 + (n + 3) % 20:02d}T11:00:00Z"
            db.execute("INSERT INTO positions VALUES(?,?,?,?,?,?,?)", (n, 1000 + n, f"Role {n}", f"Co {n % 4}", found, scout, checked if n % 2 else None))
            events.append(("scout", scout, found, n))
            if n % 2:
                events.append(("analista", None, checked, n))
        else:
            db.execute("INSERT INTO positions VALUES(?,?,?,?,?)", (n, 1000 + n, f"Role {n}", f"Co {n % 4}", found))
            events.append(("scout", None, found, n))
        if full and n % 3 == 0:
            scored = f"{day}T12:30:00Z"
            db.execute("INSERT INTO scores(position_id,total_score,scored_at,scored_by) VALUES(?,?,?,?)", (n, 50, scored, f"scorer-{1 + n % 2}"))
            events.append(("scorer", f"scorer-{1 + n % 2}", scored, n))
        if full and n % 5 == 0:
            written, reviewed = f"{day}T13:00:00Z", f"{day}T14:00:00Z"
            db.execute("INSERT INTO applications(position_id,written_at,written_by,critic_reviewed_at,reviewed_by) VALUES(?,?,?,?,?)", (n, written, "scrittore-1", reviewed, "critico"))
            events.append(("scrittore", "scrittore-1", written, n))
            events.append(("critico", "critico", reviewed, n))
    db.commit()
    db.close()
    return events


RANGE = {"op": "team_activity", "from": "2026-10-05", "to": "2026-10-15"}


def test_it_counts_per_role_instance_and_day_exactly_as_the_events_do(tmp_path: Path) -> None:
    events = _database(tmp_path)
    reply = _run(tmp_path, RANGE)
    assert reply["ok"] is True
    data = reply["data"]
    assert set(data) == {"daily", "newest", "seen", "meta"}
    inside = [e for e in events if RANGE["from"] <= e[2][:10] <= RANGE["to"]]
    expected = Counter((role, actor, ts[:10]) for role, actor, ts, _ in inside)
    got = {(row["role"], row["actor"], row["day"]): row["n"] for row in data["daily"]}
    assert got == dict(expected)
    # newest first, inside the range, each with the position it touched
    assert [e["ts"] for e in data["newest"]] == sorted((e[2] for e in inside), reverse=True)
    assert {(e["role"], e["actor"], e["ts"], e["pid"]) for e in data["newest"]} == {(r, a, t, str(p)) for r, a, t, p in inside}
    # the title, company and legacy id of the positions of the newest 40 (here: all of them)
    pid = data["newest"][0]["pid"]
    assert data["meta"][pid] == {"legacy_id": 1000 + int(pid), "title": f"Role {pid}", "company": f"Co {int(pid) % 4}"}
    # the last time each instance was seen, whatever the range
    last = {}
    for role, actor, ts, _ in events:
        last[(role, actor)] = max(last.get((role, actor), ""), ts)
    assert {(row["role"], row["actor"]): row["last"] for row in data["seen"]} == last


def test_a_database_without_the_instance_and_event_columns_counts_what_it_has(tmp_path: Path) -> None:
    events = _database(tmp_path, full=False)
    reply = _run(tmp_path, RANGE)
    assert reply["ok"] is True
    roles = {row["role"] for row in reply["data"]["daily"]}
    assert roles == {"scout"}
    assert sum(row["n"] for row in reply["data"]["daily"]) == len([e for e in events if RANGE["from"] <= e[2][:10] <= RANGE["to"]])


def test_a_team_that_never_ran_has_no_activity_and_no_failure(tmp_path: Path) -> None:
    tmp_path.mkdir(exist_ok=True)
    reply = _run(tmp_path, RANGE)
    assert reply == {"ok": True, "data": {"daily": [], "newest": [], "seen": [], "meta": {}}}


@pytest.mark.parametrize(
    "request_",
    [
        {"op": "team_activity"},
        {"op": "team_activity", "from": "2026-10-05"},
        {"op": "team_activity", "from": "2026-10-15", "to": "2026-10-05"},
        {"op": "team_activity", "from": "2026-10-05", "to": "2026-10-15", "limit": 3},
        {"op": "team_activity", "from": "2026-10-5", "to": "2026-10-15"},
        {"op": "team_activity", "from": "2026-13-01", "to": "2026-13-02"},
        {"op": "team_activity", "from": "2025-01-01", "to": "2026-10-15"},
        {"op": "team_activity", "from": "2026-10-05'; DROP TABLE positions;--", "to": "2026-10-15"},
        {"op": "stats", "from": "2026-10-05", "to": "2026-10-15"},
        {"op": "list", "to": "2026-10-15"},
    ],
)
def test_a_request_that_is_not_a_closed_range_is_refused(tmp_path: Path, request_: dict) -> None:
    _database(tmp_path)
    assert _run(tmp_path, request_) == {"ok": False, "error": "positions_request_invalid"}


def test_the_longest_range_is_a_year_and_a_day_of_the_web(tmp_path: Path) -> None:
    _database(tmp_path)
    assert _run(tmp_path, {"op": "team_activity", "from": "2025-10-15", "to": "2026-10-16"})["ok"] is True  # 366 days apart
    assert _run(tmp_path, {"op": "team_activity", "from": "2025-10-14", "to": "2026-10-16"})["ok"] is False  # 367


def test_it_reads_only_the_listed_columns_and_never_writes(tmp_path: Path) -> None:
    _database(tmp_path)
    statements: list[str] = []
    assert _run(tmp_path, RANGE, statements)["ok"] is True
    text = "\n".join(statements)
    for forbidden in ("SELECT *", "INSERT", "UPDATE", "DELETE", "jd_text", "requirements", "notes", "url"):
        assert forbidden not in text, forbidden
    script = _script().split("if op=='team_activity':")[1].split("if op=='map':")[0]
    assert "SELECT *" not in script and "p.*" not in script
    # the range travels as parameters, never glued into the statement
    assert "(first,last)" in script
    assert "+first" not in script and "+last" not in script and "req['from']+" not in script and "req['to']+" not in script

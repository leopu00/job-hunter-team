"""La lettura dei mucchi dell'ufficio (op `piles` di POSITIONS_READ_PY, desktop/src-tauri).

L'ufficio disegna per ogni ruolo quante posizioni ha da lavorare. Prima la pagina leggeva TUTTE le righe (a pagine da 600) per
contarle; qui un solo SELECT aggregato dà cinque numeri. Le regole sono quelle di `inPhase` di desktop/src/office/panel/vps-panels.ts:
scout = new, analisti = checked, scorer = scored e il writer NON ancora chiesto, scrittori = review oppure ready senza il «pass» del
critico, critici = ready con il «pass» (la prima candidatura della posizione, senza distinguere maiuscole). Una colonna che manca
conta come «non richiesto» / «nessun verdetto», senza errore. Lo script gira in sola lettura e non restituisce altro che i cinque numeri.
"""

from __future__ import annotations

import io
import json
import re
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "desktop" / "src-tauri" / "src" / "existing_team_runtime.rs"
KEYS = ("scout", "analisti", "scorer", "scrittori", "critici")


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


def _database(home: Path, rows: list[tuple], *, requested_column: bool = True, verdict_column: bool = True, applications: bool = True):
    """rows: (id, status, write_requested, [critic verdicts of its applications in order])."""
    home.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(home / "jobs.db")
    db.executescript(
        f"""
        CREATE TABLE positions(id INTEGER PRIMARY KEY, title TEXT, status TEXT{", write_requested INTEGER" if requested_column else ""});
        {"CREATE TABLE applications(id INTEGER PRIMARY KEY, position_id INTEGER" + (", critic_verdict TEXT" if verdict_column else "") + ");" if applications else ""}
        """
    )
    for pid, status, requested, verdicts in rows:
        if requested_column:
            db.execute("INSERT INTO positions(id,title,status,write_requested) VALUES (?,?,?,?)", (pid, f"Synthetic role {pid}", status, requested))
        else:
            db.execute("INSERT INTO positions(id,title,status) VALUES (?,?,?)", (pid, f"Synthetic role {pid}", status))
        if applications:
            for verdict in verdicts:
                if verdict_column:
                    db.execute("INSERT INTO applications(position_id,critic_verdict) VALUES (?,?)", (pid, verdict))
                else:
                    db.execute("INSERT INTO applications(position_id) VALUES (?)", (pid,))
    db.commit()
    db.close()


def _counts(reply: dict) -> dict:
    assert reply["ok"] is True, reply
    assert tuple(reply["data"]) == KEYS and all(type(v) is int and v >= 0 for v in reply["data"].values()), reply
    return reply["data"]


def test_the_rules_are_the_offices_own(tmp_path: Path):
    _database(
        tmp_path,
        [
            (1, "new", 0, []), (2, "new", 0, []), (3, "new", 1, []),                    # scout 3
            (4, "checked", 0, []),                                                       # analisti 1
            (5, "scored", 0, []), (6, "scored", None, []), (7, "scored", 1, []),         # scorer 2 (the third is the writer's)
            (8, "review", 0, []), (9, "review", 0, ["pass"]),                            # scrittori: review always
            (10, "ready", 0, ["revise"]), (11, "ready", 0, []), (12, "ready", 0, [None]),  # scrittori: ready without «pass»
            (13, "ready", 0, ["pass"]), (14, "ready", 0, ["PASS"]), (15, "ready", 0, ["Pass", "revise"]),  # critici 3
            (16, "ready", 0, ["revise", "pass"]), (21, "ready", 0, ["revise", "pass"]),  # only the FIRST application counts → scrittori
            (17, "writing", 0, []), (18, "applied", 0, ["pass"]), (19, "excluded", 0, []), (20, None, 0, []),  # in no pile
        ],
    )
    assert _counts(_run(tmp_path, {"op": "piles"})) == {"scout": 3, "analisti": 1, "scorer": 2, "scrittori": 7, "critici": 3}


def test_an_empty_team_has_zeros_and_a_team_that_never_ran_has_no_database(tmp_path: Path):
    _database(tmp_path, [])
    assert _counts(_run(tmp_path, {"op": "piles"})) == dict.fromkeys(KEYS, 0)
    empty = tmp_path / "never"
    empty.mkdir()
    assert _counts(_run(empty, {"op": "piles"})) == dict.fromkeys(KEYS, 0)


@pytest.mark.parametrize("options", ({"requested_column": False}, {"verdict_column": False}, {"applications": False}))
def test_a_missing_column_or_table_counts_as_not_requested_and_no_verdict(tmp_path: Path, options):
    rows = [(1, "scored", 1, []), (2, "scored", 0, []), (3, "ready", 0, ["pass"]), (4, "review", 0, [])]
    _database(tmp_path, rows, **options)
    counts = _counts(_run(tmp_path, {"op": "piles"}))
    if options.get("requested_column") is False:
        assert counts["scorer"] == 2, "no column: every scored position is the scorer's"
    else:
        assert counts["scorer"] == 1
    if options.get("verdict_column") is False or options.get("applications") is False:
        assert (counts["scrittori"], counts["critici"]) == (2, 0), "no verdict: a ready position is never passed"
    else:
        assert (counts["scrittori"], counts["critici"]) == (1, 1)


def test_one_aggregate_select_and_nothing_else_leaves_the_team(tmp_path: Path):
    _database(tmp_path, [(i, "new", 0, []) for i in range(1, 41)])
    statements: list[str] = []
    reply = _run(tmp_path, {"op": "piles"}, statements)
    assert _counts(reply)["scout"] == 40
    assert set(reply) == {"ok", "data"}
    selects = [s for s in statements if s.lstrip().upper().startswith("SELECT") and "FROM positions" in s and "COUNT" not in s.upper() or "SUM(" in s]
    assert len([s for s in statements if "SUM(" in s]) == 1, statements
    assert not any(s.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "CREATE")) for s in statements)
    del selects


@pytest.mark.parametrize(
    "request_",
    (
        {"op": "piles", "filters": {}},
        {"op": "piles", "id": "1"},
        {"op": "piles", "offset": 0},
        {"op": "piles", "from": "2026-10-01", "to": "2026-10-02"},
        {"op": "piles", "limit": 5},
        {"op": "Piles"},
        {"op": "pile"},
    ),
)
def test_any_field_but_op_is_a_refused_request(tmp_path: Path, request_):
    _database(tmp_path, [(1, "new", 0, [])])
    assert _run(tmp_path, request_) == {"ok": False, "error": "positions_request_invalid"}


def test_a_database_that_cannot_be_read_is_unavailable_and_not_zeros(tmp_path: Path):
    tmp_path.mkdir(exist_ok=True)
    (tmp_path / "jobs.db").write_bytes(b"this is not a database" * 50)
    assert _run(tmp_path, {"op": "piles"})["ok"] is False


def test_the_reader_stays_read_only_and_the_op_has_its_name_in_the_load_times_log():
    source = _script()
    block = source.split("if op=='piles':")[1].split("if op=='stats':")[0]
    for forbidden in ("INSERT", "UPDATE", "DELETE", "SELECT *", "os.", "subprocess", "open("):
        assert forbidden not in block, forbidden
    assert "SUM(" in block and "fetchone()" in block
    log = (ROOT / "desktop" / "src-tauri" / "src" / "runtime_log.rs").read_text(encoding="utf-8")
    assert '"directives", "piles"]' in log

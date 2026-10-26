"""La lettura delle posizioni sulla VPS (POSITIONS_READ_PY, desktop/src-tauri).

Lo script gira nel contenitore della squadra e la `list` serve la lista, il
mappamondo e la dashboard del desktop collegato. Due cose non devono tornare
indietro: la lista non legge le colonne pesanti (descrizione, requisiti, note)
e non fa query per riga: il numero di query non cresce con le posizioni. E la
risposta resta quella di sempre: la fixture e' l'uscita dello script PRIMA del
cambio, sullo stesso database di prova.
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
GOLDEN = ROOT / "tests" / "fixtures" / "positions_read_list_golden.json"


def _script() -> str:
    found = re.search(r'const POSITIONS_READ_PY: &str = r#"(.*?)"#;', SOURCE.read_text(encoding="utf-8"), re.S)
    assert found, "POSITIONS_READ_PY non e' piu' in existing_team_runtime.rs"
    return found.group(1)


def _database(home: Path, count: int) -> None:
    home.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(home / "jobs.db")
    db.executescript(
        """
        CREATE TABLE positions(id INTEGER PRIMARY KEY, legacy_id INTEGER, title TEXT, company TEXT,
          location TEXT, remote_type TEXT, source TEXT, found_at TEXT, status TEXT, role_family TEXT,
          loc_country TEXT, loc_city TEXT, write_requested INTEGER, scam_signals TEXT,
          salary_declared_min REAL, salary_declared_max REAL, salary_declared_currency TEXT,
          salary_estimated_min REAL, salary_estimated_max REAL, salary_estimated_currency TEXT,
          office_lat REAL, office_lon REAL, office_address TEXT,
          jd_text TEXT, requirements TEXT, jd_summary TEXT, notes TEXT, url TEXT);
        CREATE TABLE scores(id INTEGER PRIMARY KEY, position_id INTEGER, total_score INTEGER, stack_match INTEGER);
        CREATE TABLE applications(id INTEGER PRIMARY KEY, position_id INTEGER, critic_score INTEGER,
          critic_verdict TEXT, written_at TEXT, applied_at TEXT);
        CREATE TABLE position_tickets(id INTEGER PRIMARY KEY, position_id INTEGER, status TEXT);
        """
    )
    statuses = ["new", "scored", "scored", "ready", "excluded", "applied"]
    for n in range(1, count + 1):
        db.execute(
            "INSERT INTO positions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (n, 1000 + n if n % 4 == 0 else None, f"Engineer {n}", f"Company {n % 5}", "Milano", ["full_remote", "hybrid", "onsite"][n % 3],
             ["linkedin", "indeed"][n % 2], f"2026-10-{1 + n % 25:02d}T10:00:00Z", statuses[n % len(statuses)],
             ["Backend", "Data"][n % 2], "IT", ["Milano", "Roma"][n % 2], n % 2,
             json.dumps({"codes": ["advance_payment", "company_unverifiable"]}) if n % 7 == 0 else None,
             30000 + n if n % 3 == 0 else None, 40000 + n if n % 3 == 0 else None, "EUR",
             None, None, None, 45.0 + n / 100 if n % 2 else None, 9.0 + n / 100 if n % 2 else None,
             f"Via {n}" if n % 2 else None,
             "descrizione " * 400, "requisiti " * 100, "sintesi " * 50, "note " * 20, f"https://example.test/{n}"),
        )
        if n % 5:
            db.execute("INSERT INTO scores(position_id,total_score,stack_match) VALUES(?,?,?)", (n, 20 + n % 70, 1))
        if n % 6 == 0:
            db.execute("INSERT INTO scores(position_id,total_score,stack_match) VALUES(?,?,?)", (n, 99, 1))  # il secondo non conta
        if n % 3 == 0:
            db.execute("INSERT INTO applications(position_id,critic_score,critic_verdict,written_at,applied_at) VALUES(?,?,?,?,?)",
                       (n, n % 10, "approved", "2026-10-20T10:00:00Z", "2026-10-21T10:00:00Z" if n % 2 else None))
        if n % 4 == 0:
            db.execute("INSERT INTO position_tickets(position_id,status) VALUES(?,?)", (n, "open" if n % 8 else "closed"))
    db.commit()
    db.close()


def _run(home: Path, request: dict, statements: list[str] | None = None):
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


REQUESTS = {
    "default_view": {"op": "list", "filters": {"limit": 5, "offset": 0, "scoredOnly": True, "hideExcluded": True}},
    "all": {"op": "list"},
    "by_score": {"op": "list", "filters": {"sort": "score", "dir": "desc", "limit": 8, "offset": 2}},
    "search": {"op": "list", "filters": {"q": "engineer 1", "limit": 20}},
    "bands": {"op": "list", "filters": {"scoreBands": [{"lo": 40, "hi": 100}], "criticBands": [{"lo": 1, "hi": 9}]}},
    "scam_hidden": {"op": "list", "filters": {"scam": "hide", "statuses": ["scored", "ready"]}},
    "dashboard": {"op": "stats"},
}


def test_the_list_answers_exactly_as_it_did(tmp_path: Path) -> None:
    _database(tmp_path, 40)
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert set(golden) == set(REQUESTS)
    for name, request in REQUESTS.items():
        assert _run(tmp_path, request) == golden[name], name


def test_the_list_never_reads_the_heavy_columns_nor_asks_a_query_per_position(tmp_path: Path) -> None:
    counts = {}
    for size in (5, 60):
        home = tmp_path / str(size)
        _database(home, size)
        statements: list[str] = []
        reply = _run(home, {"op": "list", "filters": {"limit": 50}}, statements)
        assert reply["ok"] is True and reply["data"]["total"] == size
        text = "\n".join(statements)
        for heavy in ("jd_text", "requirements", "jd_summary", "notes", "p.*", "SELECT *"):
            assert heavy not in text, heavy
        counts[size] = len(statements)
    assert counts[5] == counts[60], counts


def test_the_dashboard_numbers_do_not_cost_a_query_per_position(tmp_path: Path) -> None:
    counts = {}
    for size in (120, 240):
        home = tmp_path / str(size)
        _database(home, size)
        statements: list[str] = []
        reply = _run(home, {"op": "stats"}, statements)
        assert reply["ok"] is True and reply["data"]["stats"]["total"] == size
        text = "\n".join(statements)
        for heavy in ("jd_text", "requirements", "jd_summary", "notes"):
            assert heavy not in text, heavy
        counts[size] = len(statements)
    assert counts[120] == counts[240], counts

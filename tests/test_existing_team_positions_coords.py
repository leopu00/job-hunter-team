"""The list of an existing team's positions carries the office coordinates, when the team has them.

`POSITIONS_READ_PY` (desktop/src-tauri/src/existing_team_runtime.rs) is the reader the app sends
over SSH, on stdin, with every read: it runs inside the team's container against its jobs.db. The
globe of the read-only view (desktop/src/pages/map/map-api.ts) places a position on its office when
the list gives `office_lat`/`office_lon`, and by its city otherwise. A jobs.db without those columns
(an older one), an empty value or a garbled one must give `None`, never a point.

The reader is taken from the Rust source as it is, its database path pointed at a synthetic jobs.db.
No cargo, no container, no VPS. Synthetic data only.
"""

import json
import sqlite3
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "desktop" / "src-tauri" / "src" / "existing_team_runtime.rs").read_text(encoding="utf-8")


def reader() -> str:
    start = SOURCE.index('r#"', SOURCE.index("const POSITIONS_READ_PY")) + len('r#"')
    return SOURCE[start : SOURCE.index('"#;', start)]


def read_list(db: Path) -> list[dict]:
    script = reader()
    assert "file:/jht_home/jobs.db?mode=ro" in script
    script = script.replace("file:/jht_home/jobs.db?mode=ro", f"file:{db}?mode=ro")
    done = subprocess.run(
        [sys.executable, "-I", "-c", script],
        input=json.dumps({"op": "list"}) + "\n",
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    reply = json.loads(done.stdout)
    assert reply["ok"] is True, reply
    return {item["id"]: item for item in reply["data"]["items"]}


def jobs_db(path: Path, with_office: bool, rows: list[tuple]) -> Path:
    db = sqlite3.connect(path)
    office = ", office_lat REAL, office_lon REAL, office_address TEXT" if with_office else ""
    db.execute(
        "CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT, found_at TEXT,"
        f" loc_country TEXT, loc_city TEXT, remote_type TEXT{office})"
    )
    columns = 11 if with_office else 8
    db.executemany(f"INSERT INTO positions VALUES ({','.join('?' * columns)})", rows)
    db.commit()
    db.close()
    return path


def test_the_list_carries_the_office_coordinates(tmp_path):
    db = jobs_db(tmp_path / "jobs.db", True, [
        (1, "Synthetic role 1", "Synthetic company 1", "scored", "2026-10-01", "Italy", "Milan", "onsite",
         45.4781, 9.2275, "Synthetic street 1, Milan"),
        (2, "Synthetic role 2", "Synthetic company 2", "scored", "2026-10-02", "Italy", "Milan", "hybrid", None, None, None),
    ])
    items = read_list(db)
    assert items["1"]["office_lat"] == 45.4781
    assert items["1"]["office_lon"] == 9.2275
    assert items["1"]["office_address"] == "Synthetic street 1, Milan"
    assert (items["2"]["office_lat"], items["2"]["office_lon"], items["2"]["office_address"]) == (None, None, None)


def test_an_older_jobs_db_without_the_columns_still_reads_and_gives_none(tmp_path):
    db = jobs_db(tmp_path / "jobs.db", False, [
        (1, "Synthetic role 1", "Synthetic company 1", "scored", "2026-10-01", "Italy", "Milan", "onsite"),
    ])
    item = read_list(db)["1"]
    assert item["loc_city"] == "Milan"
    assert (item["office_lat"], item["office_lon"], item["office_address"]) == (None, None, None)


def test_a_garbled_coordinate_is_never_a_point(tmp_path):
    db = jobs_db(tmp_path / "jobs.db", True, [
        (1, "r", "c", "scored", "2026-10-01", "Italy", "Milan", "onsite", 91.0, 9.0, "x" * 500),
        (2, "r", "c", "scored", "2026-10-01", "Italy", "Milan", "onsite", 45.0, -181.0, None),
        (3, "r", "c", "scored", "2026-10-01", "Italy", "Milan", "onsite", "north", "east", None),
        (4, "r", "c", "scored", "2026-10-01", "Italy", "Milan", "onsite", float("nan"), float("inf"), None),
    ])
    items = read_list(db)
    assert items["1"]["office_lat"] is None and items["1"]["office_lon"] == 9.0
    assert len(items["1"]["office_address"]) == 160
    assert items["2"]["office_lat"] == 45.0 and items["2"]["office_lon"] is None
    assert (items["3"]["office_lat"], items["3"]["office_lon"]) == (None, None)
    assert (items["4"]["office_lat"], items["4"]["office_lon"]) == (None, None)

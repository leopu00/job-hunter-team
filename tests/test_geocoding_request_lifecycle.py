"""Contratto end-to-end della lane di geocoding su una SQLite fresca.

Copre il percorso che mancava al ticket #96:
richiesta -> coda on-demand -> office-geocoding/db_update -> persistenza + ACK.
La coda autonoma di care-mode resta deliberatamente distinta.
"""

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILLS = REPO_ROOT / "shared" / "skills"
DB_QUERY = SKILLS / "db_query.py"
DB_UPDATE = SKILLS / "db_update.py"
GEOCODE_REQUEST = SKILLS / "geocode_request.py"


def run(db: Path, script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(script), *args],
        cwd=REPO_ROOT,
        env={**os.environ, "JHT_DB": str(db), "JHT_HOME": str(db.parent)},
        capture_output=True,
        text=True,
    )


@pytest.fixture
def fresh_db(tmp_path: Path) -> tuple[Path, int]:
    db = tmp_path / "jobs.db"
    seed = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                f"sys.path.insert(0, {str(SKILLS)!r}); "
                "from _db import get_db, ensure_schema; "
                "c=get_db(); ensure_schema(c); "
                "p=c.execute(\"INSERT INTO positions "
                "(title,company,status,loc_city,loc_country,loc_country_code,work_mode) "
                "VALUES ('Engineer','Acme','checked','Rome','Italy','IT','hybrid')\"); "
                "c.commit(); print(p.lastrowid); c.close()"
            ),
        ],
        cwd=REPO_ROOT,
        env={**os.environ, "JHT_DB": str(db), "JHT_HOME": str(tmp_path)},
        capture_output=True,
        text=True,
    )
    assert seed.returncode == 0, seed.stderr
    return db, int(seed.stdout.strip())


def row(db: Path, position_id: int) -> sqlite3.Row:
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    result = conn.execute(
        "SELECT geocode_requested, geocode_requested_at, office_lat, office_lon, "
        "office_address, office_geocoded, office_verified "
        "FROM positions WHERE id = ?",
        (position_id,),
    ).fetchone()
    conn.close()
    assert result is not None
    return result


def test_request_persists_coordinates_and_is_acknowledged(fresh_db):
    db, position_id = fresh_db

    requested = run(db, GEOCODE_REQUEST, str(position_id), "--mode", "on")
    assert requested.returncode == 0, requested.stderr
    assert json.loads(requested.stdout)["current"] == 1

    queued = run(db, DB_QUERY, "next-for-geocoding", "--json")
    assert queued.returncode == 0, queued.stderr
    assert [item["id"] for item in json.loads(queued.stdout)["rows"]] == [position_id]

    completed = run(
        db,
        DB_UPDATE,
        "position",
        str(position_id),
        "--office-lat",
        "41.9028",
        "--office-lon",
        "12.4964",
        "--office-address",
        "Rome, Italy",
        "--office-geocoded",
        "true",
        "--office-verified",
        "false",
        "--action",
        "geocode",
        "--outcome",
        "updated",
    )
    assert completed.returncode == 0, completed.stderr

    saved = dict(row(db, position_id))
    assert saved == {
        "geocode_requested": 0,
        "geocode_requested_at": None,
        "office_lat": 41.9028,
        "office_lon": 12.4964,
        "office_address": "Rome, Italy",
        "office_geocoded": 1,
        "office_verified": 0,
    }
    drained = run(db, DB_QUERY, "next-for-geocoding", "--json")
    assert json.loads(drained.stdout)["rows"] == []

    conn = sqlite3.connect(db)
    fields = {
        value[0]
        for value in conn.execute(
            "SELECT field FROM maintenance_events "
            "WHERE target_id = ? AND action = 'geocode'",
            (position_id,),
        )
    }
    conn.close()
    assert {"office_lat", "office_lon", "office_address", "office_geocoded"} <= fields


def test_recompute_request_is_visible_even_when_already_geocoded(fresh_db):
    db, position_id = fresh_db
    conn = sqlite3.connect(db)
    conn.execute(
        "UPDATE positions SET office_lat=41.9, office_lon=12.5, "
        "office_address='old', office_geocoded=1 WHERE id=?",
        (position_id,),
    )
    conn.commit()
    conn.close()

    assert run(db, GEOCODE_REQUEST, str(position_id), "--mode", "on").returncode == 0
    queued = run(db, DB_QUERY, "next-for-geocoding", "--json")
    assert [item["id"] for item in json.loads(queued.stdout)["rows"]] == [position_id]


def test_care_mode_queue_does_not_turn_into_an_on_demand_request(fresh_db):
    db, position_id = fresh_db

    on_demand = run(db, DB_QUERY, "next-for-geocoding", "--json")
    assert json.loads(on_demand.stdout)["rows"] == []

    care = run(db, DB_QUERY, "next-for-geocode-missing", "--json")
    assert [item["id"] for item in json.loads(care.stdout)["rows"]] == [position_id]
    assert row(db, position_id)["geocode_requested"] == 0


def test_exhausted_failure_acknowledges_user_request_but_remains_care_eligible(fresh_db):
    db, position_id = fresh_db
    assert run(db, GEOCODE_REQUEST, str(position_id), "--mode", "on").returncode == 0

    failed = run(
        db,
        DB_UPDATE,
        "position",
        str(position_id),
        "--office-geocoded",
        "false",
        "--office-verified",
        "false",
        "--action",
        "geocode",
        "--outcome",
        "failed",
    )
    assert failed.returncode == 0, failed.stderr
    assert row(db, position_id)["geocode_requested"] == 0
    assert json.loads(run(db, DB_QUERY, "next-for-geocoding", "--json").stdout)["rows"] == []
    care = json.loads(run(db, DB_QUERY, "next-for-geocode-missing", "--json").stdout)
    assert [item["id"] for item in care["rows"]] == [position_id]

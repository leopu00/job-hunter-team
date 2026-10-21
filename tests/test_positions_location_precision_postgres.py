"""JHT-T04 — migration 095: positions.location_precision, a closed set, nothing rewritten.

The migration is run for real on a throwaway Postgres cluster (initdb in a temporary folder, a
unix socket only: no network, no container, nothing of the machine's own databases). The file is
the one in supabase/migrations, not a copy of it, and it is run twice: a migration the operator
applies by hand has to be safe to apply again.

What must hold:
- the column exists, nullable, and every row that was there is still without a level (no data is
  rewritten: the readers derive a level from what the row has);
- the six levels and NULL are accepted, anything else is refused by the CHECK (SQLSTATE 23514),
  in any letter case, with a space, or empty;
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "095_positions_location_precision.sql"
LEVELS = ("address", "street", "district", "city", "country", "remote")


def _tool(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for folder in ("/opt/homebrew/bin", "/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/17/bin", "/usr/local/bin"):
        candidate = Path(folder) / name
        if candidate.exists():
            return str(candidate)
    return None


TOOLS = {name: _tool(name) for name in ("initdb", "pg_ctl", "psql", "postgres")}
pytestmark = pytest.mark.skipif(not all(TOOLS.values()), reason="no local Postgres server binaries")


@pytest.fixture(scope="module")
def cluster():
    root = Path(tempfile.mkdtemp(prefix="jht-pg-095-", dir="/tmp"))
    data, sock = root / "data", root / "sock"
    sock.mkdir()
    env = {**os.environ, "LC_ALL": "C", "PGHOST": str(sock), "PGUSER": "postgres", "PGDATABASE": "postgres"}
    subprocess.run([TOOLS["initdb"], "-D", str(data), "-A", "trust", "-U", "postgres", "--no-sync"],
                   check=True, capture_output=True, env=env, timeout=120)
    subprocess.run([TOOLS["pg_ctl"], "-D", str(data), "-w", "-s", "-o", f"-c listen_addresses='' -k {sock} -c fsync=off", "start"],
                   check=True, capture_output=True, env=env, timeout=120)

    def psql(sql: str | None = None, *, file: Path | None = None, check: bool = True):
        args = [TOOLS["psql"], "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"]
        args += ["-f", str(file)] if file else ["-c", sql]
        return subprocess.run(args, capture_output=True, text=True, env=env, timeout=60, check=check)

    try:
        psql("""
          CREATE TABLE public.positions (
            id serial PRIMARY KEY,
            office_lat numeric, office_lon numeric,
            office_verified boolean NOT NULL DEFAULT false,
            is_remote boolean NOT NULL DEFAULT false
          );
          INSERT INTO public.positions (office_lat, office_lon, office_verified) VALUES
            (41.89, 12.48, true), (41.90, 12.50, false), (NULL, NULL, false);
        """)
        yield psql
    finally:
        subprocess.run([TOOLS["pg_ctl"], "-D", str(data), "-m", "immediate", "-w", "-s", "stop"],
                       capture_output=True, env=env, timeout=60, check=False)
        shutil.rmtree(root, ignore_errors=True)


def test_the_migration_adds_the_column_rewrites_no_row_and_is_safe_to_apply_again(cluster):
    cluster(file=MIGRATION)
    cluster(file=MIGRATION)      # applied by hand, possibly twice
    assert cluster("""SELECT is_nullable FROM information_schema.columns
                      WHERE table_name='positions' AND column_name='location_precision'""").stdout.strip() == "YES"
    assert cluster("SELECT count(*) FILTER (WHERE location_precision IS NULL), count(*) FROM public.positions").stdout.strip() == "3|3"
    assert cluster("SELECT count(*) FROM pg_constraint WHERE conname='positions_location_precision_check'").stdout.strip() == "1"


@pytest.mark.parametrize("level", LEVELS)
def test_every_level_of_the_closed_set_is_accepted(cluster, level):
    cluster(file=MIGRATION)
    cluster(f"INSERT INTO public.positions (location_precision) VALUES ('{level}')")


def test_not_classified_is_accepted(cluster):
    cluster(file=MIGRATION)
    cluster("INSERT INTO public.positions (location_precision) VALUES (NULL)")


@pytest.mark.parametrize("value", ["building", "ADDRESS", "Address", " address", "address ", "", "city;", "region"])
def test_anything_outside_the_set_is_refused_by_the_check(cluster, value):
    cluster(file=MIGRATION)
    done = cluster(f"INSERT INTO public.positions (location_precision) VALUES ($v${value}$v$)", check=False)
    assert done.returncode != 0 and "positions_location_precision_check" in done.stderr, done.stderr

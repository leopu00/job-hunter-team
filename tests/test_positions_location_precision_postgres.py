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
import socket
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.parse import unquote, urlparse

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


# CI hands the suite a postgres:16 service (JHT_TEST_POSTGRES_URL, as for the 094 test): then only psql is
# needed and no server is started here. Without it a throwaway cluster is started, if the server tools exist.
EXTERNAL_URL = os.environ.get("JHT_TEST_POSTGRES_URL")
TOOLS = {name: _tool(name) for name in ("initdb", "pg_ctl", "psql", "postgres")}
pytestmark = pytest.mark.skipif(
    not (TOOLS["psql"] and (EXTERNAL_URL or all(TOOLS.values()))),
    reason="no PostgreSQL server tools and no JHT_TEST_POSTGRES_URL",
)

SCHEMA = """
  CREATE TABLE public.positions (
    id serial PRIMARY KEY,
    office_lat numeric, office_lon numeric,
    office_verified boolean NOT NULL DEFAULT false,
    is_remote boolean NOT NULL DEFAULT false
  );
  INSERT INTO public.positions (office_lat, office_lon, office_verified) VALUES
    (41.89, 12.48, true), (41.90, 12.50, false), (NULL, NULL, false);
"""


@pytest.fixture(scope="module")
def cluster():
    root: Path | None = None
    data: Path | None = None
    if EXTERNAL_URL:
        parsed = urlparse(EXTERNAL_URL)
        if not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL needs a host")
        env = {**os.environ, "PGHOST": parsed.hostname, "PGPORT": str(parsed.port or 5432),
               "PGUSER": unquote(parsed.username or "postgres"), "PGPASSWORD": unquote(parsed.password or "")}
        admin_db = parsed.path.lstrip("/") or "postgres"
    else:
        root = Path(tempfile.mkdtemp(prefix="jht-pg-095-", dir="/tmp"))
        data, sock = root / "data", root / "sock"
        sock.mkdir()
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        env = {**os.environ, "LC_ALL": "C", "PGHOST": str(sock), "PGPORT": str(port), "PGUSER": "postgres"}
        admin_db = "postgres"
        subprocess.run([TOOLS["initdb"], "-D", str(data), "-A", "trust", "-U", "postgres", "--no-sync",
                        "--no-locale", "--encoding=UTF8"], check=True, capture_output=True, env=env, timeout=120)
        # `-l`: without a log file the server keeps the pipes of the captured pg_ctl open and `start -w` never
        # returns to subprocess.run (the timeout of the first CI run).
        subprocess.run([TOOLS["pg_ctl"], "-D", str(data), "-l", str(root / "postgres.log"), "-w", "-s",
                        "-o", f"-F -p {port} -c listen_addresses='' -k {sock}", "start"],
                       check=True, capture_output=True, env=env, timeout=120)

    def run(db: str, sql: str | None, file: Path | None, check: bool):
        args = [TOOLS["psql"], "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", db]
        args += ["-f", str(file)] if file else ["-c", sql]
        return subprocess.run(args, capture_output=True, text=True, env=env, timeout=60, check=check)

    name = "jht_t04_" + uuid.uuid4().hex[:10]
    try:
        run(admin_db, f'CREATE DATABASE "{name}"', None, True)
        run(name, SCHEMA, None, True)
        yield lambda sql=None, *, file=None, check=True: run(name, sql, file, check)
    finally:
        if EXTERNAL_URL:
            run(admin_db, f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)', None, False)
        else:
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

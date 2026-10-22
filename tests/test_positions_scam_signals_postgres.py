"""JHT-T44 — migration 096: positions.scam_signals, a JSON of closed codes, nothing rewritten.

The migration is run for real on PostgreSQL. The file is the one in supabase/migrations, not a
copy of it, and it is run twice: a migration the operator applies by hand has to be safe to apply
again.

Two ways to the same server, like the other PostgreSQL tests of this repository:
- in CI there is the `postgres:16-alpine` service behind JHT_TEST_POSTGRES_URL: a database with a
  random name is created on it and dropped at the end. With the variable set this test never
  skips: a gate that skips where it has to run is a defence that exists and covers nothing;
- without it, a throwaway cluster (initdb in a temporary folder, a unix socket only) if the
  server binaries are on the machine, otherwise the test is skipped.

What must hold:
- the column exists, nullable, and every row that was there is still «never checked» (no data is
  rewritten);
- NULL and a JSON object of the codes are accepted; text that is not a JSON object, or longer than
  400 characters, is refused by the CHECK (SQLSTATE 23514).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "096_positions_scam_signals.sql"
SIGNALS = '{"bucket":"section","codes":["advance_payment","private_chat_only"],"v":1}'
BOOTSTRAP = """
  CREATE TABLE public.positions (
    id serial PRIMARY KEY,
    title text,
    status text NOT NULL DEFAULT 'new'
  );
  INSERT INTO public.positions (title) VALUES ('a'), ('b'), ('c');
"""
PSQL_FLAGS = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"]


def _tool(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for folder in ("/opt/homebrew/bin", "/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/17/bin", "/usr/local/bin"):
        candidate = Path(folder) / name
        if candidate.exists():
            return str(candidate)
    return None


def _runner(psql_argv: list[str], env: dict | None):
    def psql(sql: str | None = None, *, file: Path | None = None, check: bool = True):
        args = [*psql_argv, *(["-f", str(file)] if file else ["-c", sql])]
        return subprocess.run(args, capture_output=True, text=True, env=env, timeout=60, check=check)

    return psql


@pytest.fixture(scope="module")
def cluster():
    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    if external_url:
        client = _tool("psql")
        parsed = urlparse(external_url)
        if not client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL needs psql and a valid host")
        database = f"jht_scam_signals_{uuid.uuid4().hex[:12]}"
        admin = _runner([client, *PSQL_FLAGS, "-d", external_url], None)
        admin(f'CREATE DATABASE "{database}";')
        psql = _runner([client, *PSQL_FLAGS, "-d", urlunparse(parsed._replace(path=f"/{database}"))], None)
        try:
            psql(BOOTSTRAP)
            yield psql
        finally:
            admin(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE);', check=False)
        return

    tools = {name: _tool(name) for name in ("initdb", "pg_ctl", "psql", "postgres")}
    if not all(tools.values()):
        pytest.skip("no JHT_TEST_POSTGRES_URL and no local Postgres server binaries")
    root = Path(tempfile.mkdtemp(prefix="jht-pg-096-", dir="/tmp"))
    data, sock = root / "data", root / "sock"
    sock.mkdir()
    env = {**os.environ, "LC_ALL": "C", "PGHOST": str(sock), "PGUSER": "postgres", "PGDATABASE": "postgres"}
    subprocess.run([tools["initdb"], "-D", str(data), "-A", "trust", "-U", "postgres", "--no-sync"],
                   check=True, capture_output=True, env=env, timeout=120)
    subprocess.run([tools["pg_ctl"], "-D", str(data), "-w", "-s", "-o", f"-c listen_addresses='' -k {sock} -c fsync=off", "start"],
                   check=True, capture_output=True, env=env, timeout=120)
    psql = _runner([tools["psql"], *PSQL_FLAGS], env)
    try:
        psql(BOOTSTRAP)
        yield psql
    finally:
        subprocess.run([tools["pg_ctl"], "-D", str(data), "-m", "immediate", "-w", "-s", "stop"],
                       capture_output=True, env=env, timeout=60, check=False)
        shutil.rmtree(root, ignore_errors=True)


def test_the_migration_adds_the_column_rewrites_no_row_and_is_safe_to_apply_again(cluster):
    cluster(file=MIGRATION)
    cluster(file=MIGRATION)      # applied by hand, possibly twice
    assert cluster("""SELECT is_nullable FROM information_schema.columns
                      WHERE table_name='positions' AND column_name='scam_signals'""").stdout.strip() == "YES"
    assert cluster("SELECT count(*) FILTER (WHERE scam_signals IS NULL), count(*) FROM public.positions").stdout.strip() == "3|3"
    assert cluster("SELECT count(*) FROM pg_constraint WHERE conname='positions_scam_signals_check'").stdout.strip() == "1"


def test_null_and_the_json_of_codes_are_accepted(cluster):
    cluster(file=MIGRATION)
    cluster("INSERT INTO public.positions (title, scam_signals) VALUES ('n', NULL)")
    cluster(f"INSERT INTO public.positions (title, scam_signals) VALUES ('s', $v${SIGNALS}$v$)")
    assert cluster("SELECT scam_signals FROM public.positions WHERE title='s'").stdout.strip() == SIGNALS


@pytest.mark.parametrize("value", ["", "badge", "[]", "not json", "x{}", "{" + "a" * 400 + "}"])
def test_text_that_is_not_a_json_object_or_is_too_long_is_refused_by_the_check(cluster, value):
    cluster(file=MIGRATION)
    done = cluster(f"INSERT INTO public.positions (title, scam_signals) VALUES ('x', $v${value}$v$)", check=False)
    assert done.returncode != 0 and "positions_scam_signals_check" in done.stderr, done.stderr


def test_the_status_of_a_position_is_not_touched_by_the_column(cluster):
    cluster(file=MIGRATION)
    cluster(f"UPDATE public.positions SET scam_signals = $v${SIGNALS}$v$ WHERE title = 'a'")
    assert cluster("SELECT status FROM public.positions WHERE title='a'").stdout.strip() == "new"

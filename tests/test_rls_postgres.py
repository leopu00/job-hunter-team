"""Row Level Security of the cloud schema, on a real PostgreSQL 16.

Every migration in supabase/migrations is replayed, in the order and with the
replay exception of scripts/migration_gate.py, on a fresh database that
behaves like Supabase where it matters here: the anon, authenticated and
service_role roles, auth.uid() read from the request's JWT claim, and
Supabase's default privileges (every role may touch every table; RLS alone
decides which rows). Without those grants a refused read would prove the
grants, not the policies.

Then two users each own one row in every table the web reads, and the tests
ask, as each role, what it can see and write.

Until 08/10 this ground was "covered" by tests/test_supabase_integration.py:
24 tests against the live project's REST API, skipped in every CI run (the job
has no keys), and checking pages and data counts that no longer exist.
"""

from __future__ import annotations

import importlib.util
import os
import secrets
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest


ROOT = Path(__file__).resolve().parents[1]
GATE_PATH = ROOT / "scripts" / "migration_gate.py"

USER_A = "00000000-0000-0000-0000-00000000000a"
USER_B = "00000000-0000-0000-0000-00000000000b"

# The tables the web reads for a user, each seeded with one row per user.
TENANT_TABLES = (
    "companies",
    "positions",
    "scores",
    "applications",
    "position_highlights",
    "candidate_profiles",
)

# What Supabase grants before any migration runs: RLS, not the grants, is the
# barrier the product relies on.
SUPABASE_DEFAULT_GRANTS = b"""
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
"""


def _gate():
    spec = importlib.util.spec_from_file_location("migration_gate", GATE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("migration_gate", module)  # its dataclasses look themselves up there
    spec.loader.exec_module(module)
    return module


def _seed(user: str, tag: str) -> str:
    return f"""
INSERT INTO auth.users (id) VALUES ('{user}');
WITH c AS (
  INSERT INTO public.companies (user_id, name) VALUES ('{user}', 'Company {tag}') RETURNING id
), p AS (
  INSERT INTO public.positions (user_id, title, company, company_id)
  SELECT '{user}', 'Role {tag}', 'Company {tag}', id FROM c RETURNING id
), s AS (
  INSERT INTO public.scores (user_id, position_id, total_score) SELECT '{user}', id, 70 FROM p
), a AS (
  INSERT INTO public.applications (user_id, position_id) SELECT '{user}', id FROM p
)
INSERT INTO public.position_highlights (user_id, position_id, type, text)
SELECT '{user}', id, 'pro', 'Highlight {tag}' FROM p;
INSERT INTO public.candidate_profiles (user_id, name) VALUES ('{user}', 'Candidate {tag}');
"""


@pytest.fixture(scope="module")
def database():
    """A fresh database with every migration applied, two users seeded."""
    raw_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    if not raw_url:
        if os.environ.get("CI"):
            pytest.fail("JHT_TEST_POSTGRES_URL is not set: the RLS tests would not run")
        pytest.skip("JHT_TEST_POSTGRES_URL not set: no PostgreSQL to run the RLS tests on")
    gate = _gate()
    name = "jht_rls_" + secrets.token_hex(6)
    parsed = urlparse(raw_url)
    admin = raw_url
    url = urlunparse(parsed._replace(path="/" + name))
    assert gate._psql(admin, f'CREATE DATABASE "{name}";'.encode()).returncode == 0
    try:
        for step in (gate.BOOTSTRAP_SQL, SUPABASE_DEFAULT_GRANTS):
            result = gate._psql(url, step)
            assert result.returncode == 0, result.stderr.decode()
        migrations, issues = gate.inventory(ROOT, "HEAD")
        assert issues == [] and len(migrations) > 100, (issues, len(migrations))
        for migration in migrations:
            if migration.version in gate.LEGACY_REPLAY_EXCEPTIONS:
                # 018 cannot run as published on PG16; the gate's replay does its work.
                sql = gate.LEGACY_018_REPLAY_SQL if migration.version == "018" else b""
            else:
                sql = gate._blob(ROOT, migration)
            result = gate._psql(url, sql)
            assert result.returncode == 0, f"{migration.version}: {result.stderr.decode()[-600:]}"
        result = gate._psql(url, (_seed(USER_A, "A") + _seed(USER_B, "B")).encode())
        assert result.returncode == 0, result.stderr.decode()
        yield url
    finally:
        gate._psql(admin, f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE);'.encode())


def _sql(url: str, statements: str, *, role: str | None = None, user: str | None = None) -> subprocess.CompletedProcess[str]:
    """Run statements in one transaction, as `role` with `user` in the JWT, then roll back."""
    prelude = ""
    if role:
        prelude += f"SET LOCAL ROLE {role};\n"
    if user:
        prelude += f"SELECT set_config('request.jwt.claim.sub', '{user}', true) \\gset\n"
    script = f"BEGIN;\n{prelude}{statements}\nROLLBACK;\n"
    return subprocess.run(
        ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--dbname", url],
        input=script, capture_output=True, text=True, check=False,
    )


def _rows(url: str, table: str, **who) -> list[str]:
    result = _sql(url, f"SELECT user_id FROM public.{table} ORDER BY user_id;", **who)
    assert result.returncode == 0, result.stderr
    return result.stdout.split()


def test_every_public_table_has_row_level_security(database):
    result = _sql(database, """
        SELECT c.relname || ':' || c.relrowsecurity
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         ORDER BY 1;""")
    assert result.returncode == 0, result.stderr
    tables = dict(line.split(":") for line in result.stdout.split())
    # A search that finds nothing must not pass: the schema has dozens of tables.
    assert len(tables) > 30 and set(TENANT_TABLES) <= set(tables)
    assert [name for name, enabled in tables.items() if enabled != "true"] == []


@pytest.mark.parametrize("table", TENANT_TABLES)
def test_the_seed_is_there_for_the_owner_of_the_database(database, table):
    """The control: without RLS in the way, both users' rows are visible."""
    assert _rows(database, table) == [USER_A, USER_B]


@pytest.mark.parametrize("table", TENANT_TABLES)
def test_anon_reads_no_row(database, table):
    assert _rows(database, table, role="anon") == []


@pytest.mark.parametrize("table", TENANT_TABLES)
def test_a_user_reads_only_their_own_rows(database, table):
    assert _rows(database, table, role="authenticated", user=USER_A) == [USER_A]
    assert _rows(database, table, role="authenticated", user=USER_B) == [USER_B]


@pytest.mark.parametrize("table", TENANT_TABLES)
def test_a_user_cannot_change_or_delete_another_users_rows(database, table):
    result = _sql(database, f"""
        WITH u AS (UPDATE public.{table} SET user_id = user_id WHERE user_id = '{USER_B}' RETURNING 1)
        SELECT 'updated=' || count(*) FROM u;
        WITH d AS (DELETE FROM public.{table} WHERE user_id = '{USER_B}' RETURNING 1)
        SELECT 'deleted=' || count(*) FROM d;
        WITH mine AS (UPDATE public.{table} SET user_id = user_id WHERE user_id = '{USER_A}' RETURNING 1)
        SELECT 'own=' || count(*) FROM mine;""", role="authenticated", user=USER_A)
    assert result.returncode == 0, result.stderr
    # Own row: the write path is open, so the zeros above are the policy's.
    assert result.stdout.split() == ["updated=0", "deleted=0", "own=1"]


def test_a_user_cannot_insert_a_row_for_another_user(database):
    mine = _sql(database, f"INSERT INTO public.companies (user_id, name) VALUES ('{USER_A}', 'Second A');",
                role="authenticated", user=USER_A)
    assert mine.returncode == 0, mine.stderr
    theirs = _sql(database, f"INSERT INTO public.companies (user_id, name) VALUES ('{USER_B}', 'Planted');",
                  role="authenticated", user=USER_A)
    assert theirs.returncode != 0
    assert "row-level security" in theirs.stderr


def test_a_user_cannot_move_their_row_to_another_user(database):
    result = _sql(database, f"UPDATE public.positions SET user_id = '{USER_B}' WHERE user_id = '{USER_A}';",
                  role="authenticated", user=USER_A)
    assert result.returncode != 0
    assert "row-level security" in result.stderr


def test_positions_refuse_a_status_outside_the_pipeline(database):
    """Was a check on the live data's statuses; the schema holds the list."""
    bad = _sql(database, f"UPDATE public.positions SET status = 'archived' WHERE user_id = '{USER_A}';")
    assert bad.returncode != 0 and "positions_status_check" in bad.stderr
    good = _sql(database, f"UPDATE public.positions SET status = 'ready' WHERE user_id = '{USER_A}';")
    assert good.returncode == 0, good.stderr

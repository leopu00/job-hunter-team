"""Migration 091: /graphql/v1 answers nobody once pg_graphql is dropped.

Two databases, two questions:

- a plain PostgreSQL 16 (JHT_TEST_POSTGRES_URL, the CI service, or a local
  postgres:16-alpine container): a self-hosted project without pg_graphql
  runs 091 as a no-op;
- the local Supabase stack (JHT_TEST_SUPABASE_DB_URL, the DB_URL printed by
  `supabase status -o env`): with Supabase's real owners and grants, the
  REVOKE that looks like the fix removes nothing, and the migration as
  written closes the endpoint to anon and authenticated. Everything runs in
  one transaction that is rolled back: the stack is left as it was.

The second test needs the Supabase stack and is skipped without it; the
first runs in CI.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest

from local_supabase import local_supabase_db_url


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/091_graphql_extension_dropped.sql"
IMAGE = "postgres:16-alpine"
PROBE = "{ __schema { types { name } } }"


def _run(argv, *, input_text=None, check=True):
    return subprocess.run(argv, input=input_text, text=True, capture_output=True, check=check, timeout=60)


def _psql_argv(client, target):
    return [*client, "-X", "-q", "-v", "ON_ERROR_STOP=1", *target, "-At", "-F", "|"]


@pytest.fixture(scope="module")
def plain_pg():
    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    if external_url:
        client = shutil.which("psql")
        parsed = urlparse(external_url)
        if not client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL richiede psql e un host valido")
        database = f"jht_graphql_{uuid.uuid4().hex[:12]}"

        def run_on(url, sql, *, check=True):
            return _run(_psql_argv([client], ["-d", url]), input_text=sql, check=check)

        run_on(external_url, f'CREATE DATABASE "{database}";')
        database_url = urlunparse(parsed._replace(path=f"/{database}"))
        try:
            yield lambda sql, *, check=True: run_on(database_url, sql, check=check)
        finally:
            run_on(external_url, f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE);', check=False)
        return

    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    if _run(["docker", "image", "inspect", IMAGE], check=False).returncode:
        pytest.skip(f"immagine locale {IMAGE} non disponibile")
    name = f"jht-graphql-{uuid.uuid4().hex[:10]}"
    started = _run(
        ["docker", "run", "--detach", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD=synthetic-test-only", IMAGE],
        check=False,
    )
    if started.returncode:
        pytest.skip(f"PostgreSQL test non avviabile: {started.stderr.strip()}")

    def psql(sql, *, check=True):
        return _run(
            _psql_argv(["docker", "exec", "-i", name, "psql"], ["-U", "postgres", "-d", "postgres"]),
            input_text=sql,
            check=check,
        )

    try:
        stable = 0
        for _ in range(100):
            stable = stable + 1 if psql("SELECT 1;", check=False).returncode == 0 else 0
            if stable == 2:
                break
            time.sleep(0.1)
        else:
            pytest.fail("PostgreSQL 16 non è diventato ready")
        yield psql
    finally:
        _run(["docker", "rm", "--force", name], check=False)


def test_self_hosted_postgres_without_pg_graphql_runs_091_as_a_no_op(plain_pg):
    assert plain_pg("SELECT count(*) FROM pg_extension WHERE extname = 'pg_graphql';").stdout.strip() == "0"
    plain_pg(MIGRATION.read_text(encoding="utf-8"))
    assert plain_pg("SELECT count(*) FROM pg_extension WHERE extname = 'pg_graphql';").stdout.strip() == "0"


def _supabase_session(sql: str) -> list[str]:
    url = local_supabase_db_url()
    client = shutil.which("psql")
    if not client:
        pytest.fail("JHT_TEST_SUPABASE_DB_URL richiede psql")
    out = _run(_psql_argv([client], ["-d", url]), input_text=sql).stdout
    return [line for line in out.splitlines() if line.strip()]


def test_supabase_stack_091_closes_graphql_where_revoke_does_nothing():
    migration = MIGRATION.read_text(encoding="utf-8")
    rows = _supabase_session(
        f"""
BEGIN;
SELECT 'superuser|' || rolsuper FROM pg_roles WHERE rolname = current_user;
-- A stack that already ran 091 gets the extension back, with the grants
-- Supabase's event trigger gives it (rolled back below).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_graphql') THEN
    CREATE EXTENSION pg_graphql;
  END IF;
END $$;
SET LOCAL ROLE anon;
SELECT 'before|' || graphql_public.graphql(query => '{PROBE}')::text;
RESET ROLE;
REVOKE USAGE ON SCHEMA graphql FROM anon, authenticated;
SELECT 'after_revoke|' || has_schema_privilege('anon', 'graphql', 'USAGE')
       || '|' || has_schema_privilege('authenticated', 'graphql', 'USAGE');
{migration}
SELECT 'installed|' || count(*) FROM pg_extension WHERE extname = 'pg_graphql';
SET LOCAL ROLE anon;
SELECT 'anon|' || graphql_public.graphql(query => '{PROBE}')::text;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT 'authenticated|' || graphql_public.graphql(query => '{PROBE}')::text;
RESET ROLE;
ROLLBACK;
"""
    )
    seen = dict(row.split("|", 1) for row in rows)

    # As a superuser the REVOKE below would work and prove nothing about the
    # role a migration really runs as.
    assert seen["superuser"] == "false"
    assert '"__schema"' in seen["before"]
    assert seen["after_revoke"] == "true|true"
    assert seen["installed"] == "0"
    for role in ("anon", "authenticated"):
        assert "pg_graphql extension is not enabled" in seen[role]
        assert "__schema" not in seen[role]

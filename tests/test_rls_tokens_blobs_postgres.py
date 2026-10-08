"""Row Level Security of cloud_sync_tokens and encrypted_user_blobs.

The two tables hold what lets a box speak for an account (the cloud-sync token
hashes) and the user's encrypted secrets. Both are open to the browser roles
by policy, one per command, each on `auth.uid() = user_id`: a user must reach
only their own rows, anon none.

Two databases answer the same questions:

- "pg16": every migration replayed on PostgreSQL 16 with Supabase's roles and
  default grants (the fixture of tests/test_rls_postgres.py, the one CI runs);
- "supabase": the local Supabase stack (JHT_TEST_SUPABASE_DB_URL, the DB_URL
  of `supabase status -o env`), with Supabase's own roles, grants and
  auth.uid(). Skipped without it.

Every probe seeds its two users and their rows, switches role and rolls
back, in one transaction: nothing is left behind on either database.
"""

from __future__ import annotations

import os
import subprocess
import uuid

import pytest

from test_rls_postgres import database  # noqa: F401  (fixture)


USER_A = str(uuid.uuid4())
USER_B = str(uuid.uuid4())
USERS = f"('{USER_A}', '{USER_B}')"
TABLES = ("cloud_sync_tokens", "encrypted_user_blobs")


def _row(table: str, user: str) -> str:
    tag = uuid.uuid4().hex
    if table == "cloud_sync_tokens":
        return (
            "INSERT INTO public.cloud_sync_tokens (user_id, name, token_prefix, token_hash) "
            f"VALUES ('{user}', 'rls probe', 'jht_rls', 'rls-probe-{tag}');"
        )
    return (
        "INSERT INTO public.encrypted_user_blobs "
        "(user_id, blob_type, kdf_salt, kdf_iterations, cipher_iv, cipher_auth_tag, ciphertext) "
        f"VALUES ('{user}', 'rls-probe-{tag[:8]}', '\\x00', 1, '\\x00', '\\x00', '\\x00');"
    )


SEED = "\n".join(
    [f"INSERT INTO auth.users (id) VALUES ('{USER_A}'), ('{USER_B}');"]
    + [_row(table, user) for table in TABLES for user in (USER_A, USER_B)]
)


@pytest.fixture(params=["pg16", "supabase"])
def target(request) -> str:
    if request.param == "pg16":
        return request.getfixturevalue("database")
    url = os.environ.get("JHT_TEST_SUPABASE_DB_URL")
    if not url:
        pytest.skip("JHT_TEST_SUPABASE_DB_URL non impostata: serve lo stack Supabase locale")
    return url


def _probe(url: str, statements: str, *, role: str | None = None, user: str | None = None):
    """Seed, become `role` with `user` in the JWT, run, roll back."""
    who = ""
    if role:
        who += f"SET LOCAL ROLE {role};\n"
    if user:
        claims = '{"sub": "%s", "role": "%s"}' % (user, role or "authenticated")
        who += (
            f"SELECT set_config('request.jwt.claim.sub', '{user}', true) \\gset\n"
            f"SELECT set_config('request.jwt.claims', '{claims}', true) \\gset\n"
        )
    script = f"BEGIN;\n{SEED}\n{who}{statements}\nROLLBACK;\n"
    return subprocess.run(
        ["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--dbname", url],
        input=script, capture_output=True, text=True, check=False,
    )


def _owners(url: str, table: str, **who) -> list[str]:
    result = _probe(url, f"SELECT user_id FROM public.{table} WHERE user_id IN {USERS} ORDER BY user_id;", **who)
    assert result.returncode == 0, result.stderr
    return result.stdout.split()


@pytest.mark.parametrize("table", TABLES)
def test_the_seed_is_there_for_the_owner_of_the_database(target, table):
    """The control: without RLS in the way, both users' rows are visible."""
    assert _owners(target, table) == sorted([USER_A, USER_B])


@pytest.mark.parametrize("table", TABLES)
def test_anon_reads_writes_and_deletes_nothing(target, table):
    assert _owners(target, table, role="anon") == []
    result = _probe(target, f"""
        WITH u AS (UPDATE public.{table} SET user_id = user_id WHERE user_id IN {USERS} RETURNING 1)
        SELECT 'updated=' || count(*) FROM u;
        WITH d AS (DELETE FROM public.{table} WHERE user_id IN {USERS} RETURNING 1)
        SELECT 'deleted=' || count(*) FROM d;""", role="anon")
    assert result.returncode == 0, result.stderr
    assert result.stdout.split() == ["updated=0", "deleted=0"]
    planted = _probe(target, _row(table, USER_A), role="anon")
    assert planted.returncode != 0
    assert "row-level security" in planted.stderr


@pytest.mark.parametrize("table", TABLES)
def test_a_user_reads_only_their_own_rows(target, table):
    assert _owners(target, table, role="authenticated", user=USER_A) == [USER_A]
    assert _owners(target, table, role="authenticated", user=USER_B) == [USER_B]


@pytest.mark.parametrize("table", TABLES)
def test_a_user_cannot_change_or_delete_another_users_rows(target, table):
    result = _probe(target, f"""
        WITH u AS (UPDATE public.{table} SET user_id = user_id WHERE user_id = '{USER_B}' RETURNING 1)
        SELECT 'updated=' || count(*) FROM u;
        WITH d AS (DELETE FROM public.{table} WHERE user_id = '{USER_B}' RETURNING 1)
        SELECT 'deleted=' || count(*) FROM d;
        WITH mine AS (UPDATE public.{table} SET user_id = user_id WHERE user_id = '{USER_A}' RETURNING 1)
        SELECT 'own=' || count(*) FROM mine;""", role="authenticated", user=USER_A)
    assert result.returncode == 0, result.stderr
    # Own row: the write path is open, so the zeros above are the policy's.
    assert result.stdout.split() == ["updated=0", "deleted=0", "own=1"]


@pytest.mark.parametrize("table", TABLES)
def test_a_user_cannot_insert_a_row_for_another_user(target, table):
    mine = _probe(target, _row(table, USER_A), role="authenticated", user=USER_A)
    assert mine.returncode == 0, mine.stderr
    theirs = _probe(target, _row(table, USER_B), role="authenticated", user=USER_A)
    assert theirs.returncode != 0
    assert "row-level security" in theirs.stderr


@pytest.mark.parametrize("table", TABLES)
def test_a_user_cannot_move_their_row_to_another_user(target, table):
    result = _probe(target, f"UPDATE public.{table} SET user_id = '{USER_B}' WHERE user_id = '{USER_A}';",
                    role="authenticated", user=USER_A)
    assert result.returncode != 0
    assert "row-level security" in result.stderr

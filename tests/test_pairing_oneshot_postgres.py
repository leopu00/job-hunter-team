"""REL-0.3.8: redemption device-flow su PostgreSQL reale.

Nessun mock SQL può dimostrare la proprietà decisiva: due transazioni che
aspettano sullo stesso row lock devono produrre un solo bearer. Il test usa un
PostgreSQL 16 usa-e-getta, applica la migration viva con ON_ERROR_STOP e
interroga stato, privilegi e RLS dopo gli effetti.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/075_cloud_sync_pairing_oneshot.sql"
TENANT_MIGRATION = (
    ROOT
    / "supabase/migrations/074_tenant_edges_and_atomic_account_delete.sql"
)
IMAGE = "postgres:16-alpine"


def _run(argv, *, input_text=None, check=True):
    return subprocess.run(
        argv,
        input=input_text,
        text=True,
        capture_output=True,
        check=check,
        timeout=30,
    )


def _tenant_migration_sql() -> str | None:
    """Legge la 074 locale o, soltanto nel gate pre-merge, da un ref exact."""
    if TENANT_MIGRATION.is_file():
        return TENANT_MIGRATION.read_text(encoding="utf-8")
    ref = os.environ.get("JHT_TENANT_MIGRATION_REF")
    if not ref:
        return None
    return _run(
        [
            "git",
            "show",
            f"{ref}:supabase/migrations/{TENANT_MIGRATION.name}",
        ]
    ).stdout


@pytest.fixture(scope="module")
def postgres16():
    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    if _run(["docker", "image", "inspect", IMAGE], check=False).returncode:
        pytest.skip(f"immagine locale {IMAGE} non disponibile")

    name = f"jht-pairing-oneshot-{uuid.uuid4().hex[:10]}"
    started = _run(
        [
            "docker", "run", "--detach", "--rm", "--name", name,
            "-e", "POSTGRES_PASSWORD=synthetic-test-only", IMAGE,
        ],
        check=False,
    )
    if started.returncode:
        pytest.skip(f"PostgreSQL test non avviabile: {started.stderr.strip()}")

    def psql(sql: str, *, role: str = "postgres", check: bool = True):
        return _run(
            [
                "docker", "exec", "-i", name, "psql", "-X", "-q",
                "-v", "ON_ERROR_STOP=1", "-U", role, "-d", "postgres",
                "-At", "-F", "|",
            ],
            input_text=sql,
            check=check,
        )

    try:
        stable = 0
        for _ in range(100):
            # L'immagine avvia un server temporaneo durante initdb e poi lo
            # riavvia. pg_isready può quindi dare un verde prematuro; servono
            # due query reali consecutive sul server definitivo.
            ready = psql("SELECT 1;", check=False)
            stable = stable + 1 if ready.returncode == 0 else 0
            if stable == 2:
                break
            time.sleep(0.1)
        else:
            pytest.fail("PostgreSQL 16 non è diventato ready")

        setup = """
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role LOGIN;
        CREATE SCHEMA auth;
        CREATE TABLE auth.users (id uuid PRIMARY KEY);
        CREATE TABLE public.cloud_sync_tokens (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES auth.users(id),
          name text NOT NULL,
          token_prefix text NOT NULL,
          token_hash text NOT NULL UNIQUE,
          last_used_at timestamptz,
          revoked_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz
        );
        CREATE TABLE public.cloud_sync_pairing_sessions (
          device_code text PRIMARY KEY,
          user_code text NOT NULL UNIQUE,
          status text NOT NULL CHECK
            (status IN ('pending', 'approved', 'consumed', 'expired')),
          user_id uuid REFERENCES auth.users(id),
          approved_token text,
          approved_token_id uuid REFERENCES public.cloud_sync_tokens(id),
          approved_at timestamptz,
          consumed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL
        );
        -- Schema minimo pre-074 tenant/delete. Tenerlo nello stesso database
        -- fa sì che il gate applichi davvero 074 e poi 075, come in release.
        CREATE TABLE public.companies (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES auth.users(id)
        );
        CREATE TABLE public.positions (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES auth.users(id),
          company_id uuid REFERENCES public.companies(id)
        );
        CREATE TABLE public.scores (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES auth.users(id),
          position_id uuid NOT NULL REFERENCES public.positions(id)
        );
        CREATE TABLE public.applications (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES auth.users(id),
          position_id uuid NOT NULL REFERENCES public.positions(id)
        );
        CREATE TABLE public.position_highlights (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES auth.users(id),
          position_id uuid NOT NULL REFERENCES public.positions(id)
        );
        CREATE TABLE public.position_views (
          user_id uuid NOT NULL REFERENCES auth.users(id),
          position_id uuid NOT NULL REFERENCES public.positions(id),
          PRIMARY KEY (user_id, position_id)
        );
        CREATE TABLE public.position_user_notes (
          user_id uuid NOT NULL REFERENCES auth.users(id),
          position_id uuid NOT NULL REFERENCES public.positions(id),
          origin text NOT NULL,
          body text NOT NULL,
          PRIMARY KEY (user_id, position_id, origin)
        );
        CREATE TABLE public.pending_user_messages (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES auth.users(id),
          related_position_id uuid REFERENCES public.positions(id),
          body text NOT NULL
        );
        CREATE TABLE public.candidate_profiles (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES auth.users(id)
        );
        ALTER TABLE public.cloud_sync_pairing_sessions ENABLE ROW LEVEL SECURITY;
        CREATE POLICY pairing_owner ON public.cloud_sync_pairing_sessions
          FOR SELECT USING (false);
        GRANT SELECT ON public.cloud_sync_pairing_sessions TO anon, authenticated;
        INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001');

        -- Riga legacy già scaduta: migration, non cron, deve sanarla.
        INSERT INTO public.cloud_sync_tokens
          (id, user_id, name, token_prefix, token_hash)
        VALUES
          ('10000000-0000-0000-0000-000000000001',
           '00000000-0000-0000-0000-000000000001',
           'legacy-expired', 'jht_sync_legacy', 'legacy-hash');
        INSERT INTO public.cloud_sync_pairing_sessions
          (device_code, user_code, status, user_id, approved_token,
           approved_token_id, expires_at)
        VALUES
          ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'AAAA-2222', 'approved',
           '00000000-0000-0000-0000-000000000001', 'jht_sync_plain_legacy',
           '10000000-0000-0000-0000-000000000001', now() - interval '1 minute');
        """
        psql(setup)
        tenant_sql = _tenant_migration_sql()
        if tenant_sql is not None:
            psql(tenant_sql)
        pairing_sql = MIGRATION.read_text(encoding="utf-8")
        psql(pairing_sql)
        yield name, psql, tenant_sql is not None
    finally:
        _run(["docker", "rm", "--force", name], check=False)


def test_migration_sanitizes_existing_expired_plaintext(postgres16):
    _, psql, _ = postgres16
    state = psql("""
      SELECT pairing.status, pairing.approved_token IS NULL,
             token.revoked_at IS NOT NULL
      FROM public.cloud_sync_pairing_sessions pairing
      JOIN public.cloud_sync_tokens token ON token.id = pairing.approved_token_id
      WHERE pairing.device_code = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    """).stdout.strip()
    assert state == "expired|t|t"


def test_two_concurrent_polls_deliver_one_token(postgres16):
    name, psql, _ = postgres16
    psql("""
      INSERT INTO public.cloud_sync_tokens
        (id, user_id, name, token_prefix, token_hash, expires_at)
      VALUES
        ('20000000-0000-0000-0000-000000000001',
         '00000000-0000-0000-0000-000000000001',
         'concurrent', 'jht_sync_conc', 'concurrent-hash', now() + interval '10 minutes');
      INSERT INTO public.cloud_sync_pairing_sessions
        (device_code, user_code, status, user_id, approved_token,
         approved_token_id, expires_at)
      VALUES
        ('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 'BBBB-2222', 'approved',
         '00000000-0000-0000-0000-000000000001', 'jht_sync_concurrent_plain',
         '20000000-0000-0000-0000-000000000001', now() + interval '10 minutes');
    """)
    redeem_sql = (
        "SELECT status, COALESCE(approved_token, '<null>') "
        "FROM public.redeem_cloud_sync_pairing"
        "('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');"
    )
    base_argv = [
        "docker", "exec", "-i", name, "psql", "-X", "-q",
        "-v", "ON_ERROR_STOP=1", "-U", "service_role", "-d", "postgres",
        "-At", "-F", "|", "-c",
    ]
    # La prima transazione tiene il row lock dopo la RPC: quando parte la
    # seconda sappiamo che i due poll si sovrappongono davvero, non che il test
    # ha eseguito due chiamate sequenziali molto veloci.
    first_sql = f"BEGIN; {redeem_sql} DO $$ BEGIN PERFORM pg_sleep(0.5); END $$; COMMIT;"
    first = subprocess.Popen(
        [*base_argv, first_sql],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    time.sleep(0.15)
    second = subprocess.Popen(
        [*base_argv, redeem_sql],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    results = [first.communicate(timeout=15), second.communicate(timeout=15)]
    assert first.returncode == second.returncode == 0, results
    outputs = sorted(out.strip() for out, _ in results)
    assert outputs == ["approved|jht_sync_concurrent_plain", "consumed|<null>"]

    state = psql("""
      SELECT pairing.status, pairing.approved_token IS NULL,
             pairing.consumed_at IS NOT NULL, token.expires_at IS NULL
      FROM public.cloud_sync_pairing_sessions pairing
      JOIN public.cloud_sync_tokens token ON token.id = pairing.approved_token_id
      WHERE pairing.device_code = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    """).stdout.strip()
    assert state == "consumed|t|t|t"


def test_never_redeemed_past_ttl_is_unrecoverable_and_invalid(postgres16):
    _, psql, _ = postgres16
    psql("""
      INSERT INTO public.cloud_sync_tokens
        (id, user_id, name, token_prefix, token_hash, expires_at)
      VALUES
        ('30000000-0000-0000-0000-000000000001',
         '00000000-0000-0000-0000-000000000001',
         'never-redeemed', 'jht_sync_never', 'never-hash', now() - interval '1 second');
      INSERT INTO public.cloud_sync_pairing_sessions
        (device_code, user_code, status, user_id, approved_token,
         approved_token_id, expires_at)
      VALUES
        ('cccccccccccccccccccccccccccccccc', 'CCCC-2222', 'approved',
         '00000000-0000-0000-0000-000000000001', 'jht_sync_never_plain',
         '30000000-0000-0000-0000-000000000001', now() - interval '1 second');
    """)
    # Prima ancora di un poll/cleanup il controllo usato da verifyBearerToken
    # non considera valido il bearer: la correttezza non dipende dal cron.
    before = psql("""
      SELECT pairing.approved_token IS NOT NULL,
             count(*) FILTER (WHERE token.revoked_at IS NULL AND
               (token.expires_at IS NULL OR token.expires_at > now())) OVER ()
      FROM public.cloud_sync_pairing_sessions pairing
      JOIN public.cloud_sync_tokens token ON token.id = pairing.approved_token_id
      WHERE pairing.device_code = 'cccccccccccccccccccccccccccccccc';
    """).stdout.strip()
    assert before == "t|0"

    result = psql("""
      SELECT status, approved_token IS NULL
      FROM public.redeem_cloud_sync_pairing('cccccccccccccccccccccccccccccccc');
    """).stdout.strip()
    assert result == "expired|t"
    state = psql("""
      SELECT pairing.approved_token IS NULL, token.revoked_at IS NOT NULL,
             count(*) FILTER (WHERE token.revoked_at IS NULL AND
               (token.expires_at IS NULL OR token.expires_at > now()))
               OVER ()
      FROM public.cloud_sync_pairing_sessions pairing
      JOIN public.cloud_sync_tokens token ON token.id = pairing.approved_token_id
      WHERE pairing.device_code = 'cccccccccccccccccccccccccccccccc';
    """).stdout.strip()
    assert state == "t|t|0"


def test_cleanup_also_wipes_and_revokes_without_redemption(postgres16):
    _, psql, _ = postgres16
    psql("""
      INSERT INTO public.cloud_sync_tokens
        (id, user_id, name, token_prefix, token_hash, expires_at)
      VALUES
        ('40000000-0000-0000-0000-000000000001',
         '00000000-0000-0000-0000-000000000001',
         'cleanup', 'jht_sync_cleanup', 'cleanup-hash', now() - interval '1 second');
      INSERT INTO public.cloud_sync_pairing_sessions
        (device_code, user_code, status, user_id, approved_token,
         approved_token_id, expires_at)
      VALUES
        ('dddddddddddddddddddddddddddddddd', 'DDDD-2222', 'approved',
         '00000000-0000-0000-0000-000000000001', 'jht_sync_cleanup_plain',
         '40000000-0000-0000-0000-000000000001', now() - interval '1 second');
      SELECT * FROM public.cleanup_pairing_sessions();
    """)
    state = psql("""
      SELECT pairing.status, pairing.approved_token IS NULL,
             token.revoked_at IS NOT NULL
      FROM public.cloud_sync_pairing_sessions pairing
      JOIN public.cloud_sync_tokens token ON token.id = pairing.approved_token_id
      WHERE pairing.device_code = 'dddddddddddddddddddddddddddddddd';
    """).stdout.strip()
    assert state == "expired|t|t"


def test_token_expired_before_pairing_is_revoked_and_never_delivered(postgres16):
    _, psql, _ = postgres16
    psql("""
      INSERT INTO public.cloud_sync_tokens
        (id, user_id, name, token_prefix, token_hash, expires_at)
      VALUES
        ('50000000-0000-0000-0000-000000000001',
         '00000000-0000-0000-0000-000000000001',
         'early-expiry', 'jht_sync_early', 'early-hash', now() - interval '1 second');
      INSERT INTO public.cloud_sync_pairing_sessions
        (device_code, user_code, status, user_id, approved_token,
         approved_token_id, expires_at)
      VALUES
        ('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'EEEE-2222', 'approved',
         '00000000-0000-0000-0000-000000000001', 'jht_sync_early_plain',
         '50000000-0000-0000-0000-000000000001', now() + interval '10 minutes');
    """)
    result = psql("""
      SELECT status, approved_token IS NULL
      FROM public.redeem_cloud_sync_pairing('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
    """).stdout.strip()
    assert result == "expired|t"
    state = psql("""
      SELECT pairing.status, pairing.approved_token IS NULL,
             token.revoked_at IS NOT NULL
      FROM public.cloud_sync_pairing_sessions pairing
      JOIN public.cloud_sync_tokens token ON token.id = pairing.approved_token_id
      WHERE pairing.device_code = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    """).stdout.strip()
    assert state == "expired|t|t"


def test_malformed_approved_row_fails_closed_and_wipes_plaintext(postgres16):
    _, psql, _ = postgres16
    psql("""
      INSERT INTO public.cloud_sync_tokens
        (id, user_id, name, token_prefix, token_hash, expires_at)
      VALUES
        ('60000000-0000-0000-0000-000000000001',
         '00000000-0000-0000-0000-000000000001',
         'malformed', 'jht_sync_bad', 'malformed-hash', now() + interval '10 minutes');
      INSERT INTO public.cloud_sync_pairing_sessions
        (device_code, user_code, status, user_id, approved_token,
         approved_token_id, expires_at)
      VALUES
        ('fffffffffffffffffffffffffffffffe', 'FFFF-2223', 'approved',
         NULL, 'jht_sync_malformed_plain',
         '60000000-0000-0000-0000-000000000001', now() + interval '10 minutes');
    """)
    result = psql("""
      SELECT status, approved_token IS NULL
      FROM public.redeem_cloud_sync_pairing('fffffffffffffffffffffffffffffffe');
    """).stdout.strip()
    assert result == "invalid|t"
    state = psql("""
      SELECT pairing.status, pairing.approved_token IS NULL,
             token.revoked_at IS NOT NULL
      FROM public.cloud_sync_pairing_sessions pairing
      JOIN public.cloud_sync_tokens token ON token.id = pairing.approved_token_id
      WHERE pairing.device_code = 'fffffffffffffffffffffffffffffffe';
    """).stdout.strip()
    assert state == "expired|t|t"


def test_rls_execute_and_idempotent_real_migration(postgres16):
    _, psql, _ = postgres16
    # Applicazione ripetuta deve restare valida.
    pairing_sql = MIGRATION.read_text(encoding="utf-8")
    psql(pairing_sql)
    privileges = psql("""
      SELECT
        has_function_privilege('anon',
          'public.redeem_cloud_sync_pairing(text)', 'EXECUTE'),
        has_function_privilege('authenticated',
          'public.redeem_cloud_sync_pairing(text)', 'EXECUTE'),
        has_function_privilege('service_role',
          'public.redeem_cloud_sync_pairing(text)', 'EXECUTE'),
        has_function_privilege('anon',
          'public.cleanup_pairing_sessions()', 'EXECUTE'),
        has_function_privilege('authenticated',
          'public.cleanup_pairing_sessions()', 'EXECUTE'),
        has_function_privilege('service_role',
          'public.cleanup_pairing_sessions()', 'EXECUTE');
      SET ROLE anon;
      SELECT count(*) FROM public.cloud_sync_pairing_sessions;
      RESET ROLE;
    """).stdout.strip().splitlines()
    assert privileges == ["f|f|t|f|f|t", "0"]

    denied = psql(
        "SET ROLE anon; SELECT * FROM public.redeem_cloud_sync_pairing"
        "('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');",
        check=False,
    )
    assert denied.returncode != 0
    assert "permission denied" in denied.stderr.lower()
    cleanup_denied = psql(
        "SET ROLE authenticated; SELECT * FROM "
        "public.cleanup_pairing_sessions();",
        check=False,
    )
    assert cleanup_denied.returncode != 0
    assert "permission denied" in cleanup_denied.stderr.lower()
    allowed = psql(
        "SET ROLE service_role; SELECT status FROM "
        "public.redeem_cloud_sync_pairing"
        "('ffffffffffffffffffffffffffffffff'); RESET ROLE;"
    )
    assert allowed.stdout.strip() == "not_found"


def test_release_migration_prefix_census_has_no_collisions():
    migrations = sorted((ROOT / "supabase/migrations").glob("[0-9][0-9][0-9]_*.sql"))
    by_prefix: dict[str, list[str]] = {}
    for migration in migrations:
        by_prefix.setdefault(migration.name[:3], []).append(migration.name)
    collisions = {prefix: names for prefix, names in by_prefix.items() if len(names) > 1}
    assert collisions == {}
    assert MIGRATION.name == "075_cloud_sync_pairing_oneshot.sql"


def test_tenant_074_then_pairing_075_were_applied_when_available(postgres16):
    _, psql, tenant_applied = postgres16
    if not tenant_applied:
        pytest.skip("migration 074 tenant/delete non ancora presente sulla base")
    functions = psql("""
      SELECT to_regprocedure('public.delete_account_data(uuid)') IS NOT NULL,
             to_regprocedure('public.redeem_cloud_sync_pairing(text)') IS NOT NULL;
    """).stdout.strip()
    assert functions == "t|t"

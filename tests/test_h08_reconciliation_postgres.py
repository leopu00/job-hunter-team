"""PostgreSQL 16 oracle for the H-08 forward reconciliation.

The input is a private, schema-only snapshot supplied out of band through
``JHT_H08_SCHEMA_SNAPSHOT``. The snapshot is never copied into the repository
and the test never connects to a remote database.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
SEQUENCE = [
    MIGRATIONS / "078_positions_write_request_kind.sql",
    MIGRATIONS / "079_team_directive_events_atomic.sql",
    MIGRATIONS / "080_profile_snapshot_atomic.sql",
]
RECONCILIATION = MIGRATIONS / "081_live_schema_reconciliation.sql"
SNAPSHOT_SHA256 = (
    "78269292299f3fe4324a0e7553afc1095a4d8814605677146b82c41d34849346"
)
PROTECTED_FUNCTIONS = (
    "mark_position_applied",
    "sync_upsert_applications",
    "undo_manual_position_application",
)


class Pg16Clone:
    def __init__(self, container: str):
        self.container = container

    def psql(
        self, database: str, sql: str, *, check: bool = True
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                self.container,
                "psql",
                "-X",
                "-A",
                "-t",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                "postgres",
                "-d",
                database,
            ],
            input=sql,
            check=check,
            capture_output=True,
            text=True,
        )

    def apply(self, database: str, migration: Path, *, check: bool = True):
        return self.psql(database, migration.read_text(), check=check)

    def schema_dump(self, database: str) -> str:
        result = subprocess.run(
            [
                "docker",
                "exec",
                self.container,
                "pg_dump",
                "-U",
                "postgres",
                "-d",
                database,
                "--schema-only",
                "--no-owner",
                "-n",
                "public",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        # PostgreSQL 16 emits a fresh psql safety token for every dump. It is
        # transport metadata, not catalog state.
        return re.sub(r"^\\(?:un)?restrict .*$\n?", "", result.stdout, flags=re.M)

    def function_hashes(self, database: str) -> dict[str, str]:
        names = ",".join(f"'{name}'" for name in PROTECTED_FUNCTIONS)
        rows = self.psql(
            database,
            f"""
            SELECT p.proname || '|' || md5(pg_get_functiondef(p.oid))
              FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname IN ({names})
             ORDER BY p.proname;
            """,
        ).stdout.splitlines()
        return dict(row.split("|", 1) for row in rows)


@pytest.fixture(scope="module")
def h08_clone():
    snapshot_value = os.environ.get("JHT_H08_SCHEMA_SNAPSHOT")
    if not snapshot_value:
        pytest.skip("JHT_H08_SCHEMA_SNAPSHOT is required for the private oracle")
    snapshot = Path(snapshot_value)
    if not snapshot.is_file():
        pytest.fail("H-08 schema-only snapshot is unavailable")
    if hashlib.sha256(snapshot.read_bytes()).hexdigest() != SNAPSHOT_SHA256:
        pytest.fail("H-08 schema-only snapshot hash mismatch")
    if not shutil.which("docker"):
        pytest.skip("Docker is unavailable")
    image = "postgres:16-alpine"
    if subprocess.run(
        ["docker", "image", "inspect", image], capture_output=True
    ).returncode:
        pytest.skip(f"local {image} image unavailable")

    name = "jht-h08-oracle-" + uuid.uuid4().hex[:12]
    subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "-d",
            "--name",
            name,
            "-e",
            "POSTGRES_HOST_AUTH_METHOD=trust",
            image,
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    pg = Pg16Clone(name)
    try:
        # The image's entrypoint briefly starts and restarts PostgreSQL during
        # initdb. Wait for the final server, not the transient first socket.
        for _ in range(200):
            log_result = subprocess.run(
                ["docker", "logs", name], capture_output=True, text=True
            )
            logs = log_result.stdout + log_result.stderr
            if logs.count("database system is ready to accept connections") >= 2:
                break
            time.sleep(0.1)
        else:
            pytest.fail("PostgreSQL 16 container did not become ready")

        pg.psql(
            "postgres",
            """
            CREATE ROLE anon NOLOGIN;
            CREATE ROLE authenticated NOLOGIN;
            CREATE ROLE service_role NOLOGIN;
            CREATE DATABASE h08_main;
            CREATE DATABASE h08_rollback;
            """,
        )
        prelude = """
            CREATE SCHEMA auth;
            CREATE FUNCTION auth.uid() RETURNS uuid
            LANGUAGE sql STABLE
            AS $$ SELECT NULLIF(
              current_setting('request.jwt.claim.sub', true), ''
            )::uuid $$;
            CREATE TABLE auth.users (
              id uuid PRIMARY KEY,
              created_at timestamptz
            );
            CREATE TABLE auth.sessions (
              user_id uuid,
              updated_at timestamptz
            );
            GRANT USAGE ON SCHEMA public, auth
              TO anon, authenticated, service_role;
        """
        for database in ("h08_main", "h08_rollback"):
            pg.psql(database, prelude)
            pg.psql(database, snapshot.read_text())
            for migration in SEQUENCE:
                pg.apply(database, migration)

        protected_before = pg.function_hashes("h08_main")
        assert set(protected_before) == set(PROTECTED_FUNCTIONS)
        pg.apply("h08_main", RECONCILIATION)
        yield pg, protected_before
    finally:
        subprocess.run(
            ["docker", "stop", name], capture_output=True, text=True
        )


def test_081_catalog_and_acl_match_the_allowlisted_final_state(h08_clone):
    pg, protected_before = h08_clone
    database = "h08_main"

    columns = set(
        pg.psql(
            database,
            """
            SELECT table_name || '.' || column_name
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND (
                 (table_name = 'positions' AND column_name IN (
                   'role_family', 'loc_city', 'loc_region', 'loc_country',
                   'loc_country_code', 'loc_continent', 'work_mode',
                   'work_country', 'work_country_code', 'is_multi_location',
                   'location_notes'
                 ))
                 OR (table_name = 'team_state' AND column_name IN (
                   'cloud_push_status', 'cloud_push_checked_at'
                 ))
               );
            """,
        ).stdout.splitlines()
    )
    assert len(columns) == 13
    assert pg.psql(
        database, "SELECT to_regclass('public.user_settings') IS NOT NULL;"
    ).stdout.strip() == "t"
    location_indexes = pg.psql(
        database,
        """
        SELECT count(*)
          FROM pg_class
         WHERE relkind = 'i'
           AND relname IN (
             'idx_positions_loc_country_code',
             'idx_positions_work_mode',
             'idx_positions_loc_continent'
           );
        """,
    ).stdout.strip()
    assert location_indexes == "0"

    required_objects = pg.psql(
        database,
        """
        SELECT to_regclass('public.idx_position_tickets_active_rescore') IS NOT NULL;
        SELECT count(*) = 7
          FROM pg_constraint
         WHERE conname IN (
           'positions_company_tenant_fkey',
           'scores_position_tenant_fkey',
           'applications_position_tenant_fkey',
           'position_highlights_position_tenant_fkey',
           'position_views_position_tenant_fkey',
           'position_user_notes_position_tenant_fkey',
           'pending_user_messages_position_tenant_fkey'
         );
        SELECT to_regprocedure(
          'public.sync_confirm_positions_applied(uuid,integer[])'
        ) IS NOT NULL;
        SELECT to_regprocedure(
          'public.redeem_cloud_sync_pairing(text)'
        ) IS NOT NULL;
        SELECT to_regprocedure(
          'public.delete_account_data(uuid)'
        ) IS NOT NULL;
        """,
    ).stdout.splitlines()
    assert required_objects == ["t"] * 5

    privileges = pg.psql(
        database,
        """
        SELECT role_name || '|' || routine || '|' || allowed
        FROM (VALUES
          ('anon', 'public.delete_account_data(uuid)'),
          ('authenticated', 'public.delete_account_data(uuid)'),
          ('service_role', 'public.delete_account_data(uuid)'),
          ('anon', 'public.redeem_cloud_sync_pairing(text)'),
          ('authenticated', 'public.redeem_cloud_sync_pairing(text)'),
          ('service_role', 'public.redeem_cloud_sync_pairing(text)'),
          ('anon', 'public.cleanup_pairing_sessions()'),
          ('authenticated', 'public.cleanup_pairing_sessions()'),
          ('service_role', 'public.cleanup_pairing_sessions()'),
          ('anon', 'public.sync_confirm_positions_applied(uuid,integer[])'),
          ('authenticated', 'public.sync_confirm_positions_applied(uuid,integer[])'),
          ('service_role', 'public.sync_confirm_positions_applied(uuid,integer[])')
        ) AS expected(role_name, routine)
        CROSS JOIN LATERAL (
          SELECT has_function_privilege(role_name, routine, 'EXECUTE') allowed
        ) checked
        ORDER BY routine, role_name;
        """,
    ).stdout.splitlines()
    assert all(
        row.endswith("|false")
        for row in privileges
        if not row.startswith("service_role|")
    )
    assert all(
        row.endswith("|true")
        for row in privileges
        if row.startswith("service_role|")
    )

    policy_rows = pg.psql(
        database,
        """
        SELECT polname || '|' ||
               COALESCE(pg_get_expr(polqual, polrelid), '') || '|' ||
               COALESCE(pg_get_expr(polwithcheck, polrelid), '')
          FROM pg_policy
         WHERE polrelid = 'public.team_directives'::regclass
           AND polname IN (
             'users insert own team directives',
             'users select own team directives',
             'users update own team directives'
           )
         ORDER BY polname;
        """,
    ).stdout.splitlines()
    assert len(policy_rows) == 3
    for row in policy_rows:
        assert "SELECT auth.uid()" in row

    # 081 must add missing effects without replacing the already-final
    # application RPCs from 076/077 or the live cleanup implementation.
    assert pg.function_hashes(database) == protected_before


def test_081_reapply_has_zero_schema_diff(h08_clone):
    pg, _ = h08_clone
    before = pg.schema_dump("h08_main")
    pg.apply("h08_main", RECONCILIATION)
    after = pg.schema_dump("h08_main")
    assert after == before


def test_account_delete_cascades_late_tables_and_rolls_back_atomically(
    h08_clone,
):
    pg, _ = h08_clone
    database = "h08_main"
    success_user = "00000000-0000-0000-0000-000000000081"
    rollback_user = "00000000-0000-0000-0000-000000000082"
    pg.psql(
        database,
        f"""
        INSERT INTO auth.users(id, created_at) VALUES
          ('{success_user}', now()), ('{rollback_user}', now());
        INSERT INTO public.user_settings(user_id, theme) VALUES
          ('{success_user}', 'system'), ('{rollback_user}', 'dark');
        INSERT INTO public.team_directive_request_ledger(
          user_id, request_id, action, target_id
        ) VALUES
          ('{success_user}', 'h08-success', 'created', 0),
          ('{rollback_user}', 'h08-rollback', 'created', 0);
        INSERT INTO public.candidate_profile_sync_state(user_id, content_hash)
        VALUES
          ('{success_user}', repeat('1', 64)),
          ('{rollback_user}', repeat('2', 64));
        """,
    )
    pg.psql(
        database,
        f"SET ROLE service_role; "
        f"SELECT public.delete_account_data('{success_user}');",
    )
    assert pg.psql(
        database,
        f"""
        SELECT
          (SELECT count(*) FROM auth.users WHERE id = '{success_user}') +
          (SELECT count(*) FROM public.user_settings WHERE user_id = '{success_user}') +
          (SELECT count(*) FROM public.team_directive_request_ledger WHERE user_id = '{success_user}') +
          (SELECT count(*) FROM public.candidate_profile_sync_state WHERE user_id = '{success_user}');
        """,
    ).stdout.strip() == "0"

    pg.psql(
        database,
        f"""
        CREATE FUNCTION public.reject_h08_delete() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.user_id = '{rollback_user}' THEN
            RAISE EXCEPTION 'h08_synthetic_rollback';
          END IF;
          RETURN OLD;
        END $$;
        CREATE TRIGGER reject_h08_delete
          BEFORE DELETE ON public.user_settings
          FOR EACH ROW EXECUTE FUNCTION public.reject_h08_delete();
        """,
    )
    failed = pg.psql(
        database,
        f"SET ROLE service_role; "
        f"SELECT public.delete_account_data('{rollback_user}');",
        check=False,
    )
    assert failed.returncode != 0
    assert "h08_synthetic_rollback" in failed.stderr
    assert pg.psql(
        database,
        f"""
        SELECT
          (SELECT count(*) FROM auth.users WHERE id = '{rollback_user}') +
          (SELECT count(*) FROM public.user_settings WHERE user_id = '{rollback_user}') +
          (SELECT count(*) FROM public.team_directive_request_ledger WHERE user_id = '{rollback_user}') +
          (SELECT count(*) FROM public.candidate_profile_sync_state WHERE user_id = '{rollback_user}');
        """,
    ).stdout.strip() == "4"


def test_cleanup_revokes_expired_bearer_and_wipes_plaintext(h08_clone):
    pg, _ = h08_clone
    database = "h08_main"
    user = "00000000-0000-0000-0000-000000000084"
    token = "10000000-0000-0000-0000-000000000084"
    pg.psql(
        database,
        f"""
        INSERT INTO auth.users(id, created_at) VALUES ('{user}', now());
        INSERT INTO public.cloud_sync_tokens(
          id, user_id, name, token_prefix, token_hash, expires_at
        ) VALUES (
          '{token}', '{user}', 'H-08 synthetic', 'jht_test',
          repeat('8', 64), now() + interval '1 hour'
        );
        INSERT INTO public.cloud_sync_pairing_sessions(
          device_code, user_code, status, user_id, approved_token,
          approved_token_id, approved_at, expires_at
        ) VALUES (
          'h08-expired-device', 'H08EXPIRE', 'approved', '{user}',
          'synthetic-plaintext', '{token}', now() - interval '2 minutes',
          now() - interval '1 minute'
        );
        """,
    )
    result = pg.psql(
        database,
        "SET ROLE service_role; SELECT * FROM public.cleanup_pairing_sessions();",
    ).stdout.splitlines()[-1]
    assert result == "1|0"
    state = pg.psql(
        database,
        f"""
        SELECT pairing.status || '|' ||
               (pairing.approved_token IS NULL)::text || '|' ||
               (token.revoked_at IS NOT NULL)::text
          FROM public.cloud_sync_pairing_sessions pairing
          JOIN public.cloud_sync_tokens token
            ON token.id = pairing.approved_token_id
         WHERE pairing.device_code = 'h08-expired-device';
        """,
    ).stdout.strip()
    assert state == "expired|true|true"


def test_081_file_is_one_transaction_on_failure(h08_clone):
    pg, _ = h08_clone
    database = "h08_rollback"
    user = "00000000-0000-0000-0000-000000000083"
    # This pre-existing invalid row makes the new 073 CHECK fail after 070
    # and 071 have run. Their objects must not survive the failed transaction.
    pg.psql(
        database,
        f"""
        ALTER TABLE public.team_state ADD COLUMN cloud_push_status text;
        INSERT INTO auth.users(id, created_at) VALUES ('{user}', now());
        INSERT INTO public.team_state(user_id, cloud_push_status)
        VALUES ('{user}', 'not-an-allowed-status');
        """,
    )
    failed = pg.apply(database, RECONCILIATION, check=False)
    assert failed.returncode != 0
    state = pg.psql(
        database,
        """
        SELECT to_regclass('public.user_settings') IS NULL;
        SELECT to_regclass('public.idx_position_tickets_active_rescore') IS NULL;
        SELECT NOT EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conname = 'team_state_cloud_push_status_valid'
        );
        """,
    ).stdout.splitlines()
    assert state == ["t", "t", "t"]

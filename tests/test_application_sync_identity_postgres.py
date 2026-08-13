"""P0 application identity: effect tests on a real PostgreSQL 16."""

from __future__ import annotations

import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/076_application_sync_identity.sql"
IMAGE = "postgres:16-alpine"
USER_1 = "00000000-0000-0000-0000-000000000001"
USER_2 = "00000000-0000-0000-0000-000000000002"


def _run(argv, *, input_text=None, check=True):
    return subprocess.run(
        argv,
        input=input_text,
        text=True,
        capture_output=True,
        check=check,
        timeout=30,
    )


@pytest.fixture(scope="module")
def postgres16():
    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    if _run(["docker", "image", "inspect", IMAGE], check=False).returncode:
        pytest.skip(f"immagine locale {IMAGE} non disponibile")

    name = f"jht-application-identity-{uuid.uuid4().hex[:10]}"
    started = _run(
        [
            "docker",
            "run",
            "--detach",
            "--rm",
            "--name",
            name,
            "-e",
            "POSTGRES_PASSWORD=synthetic-test-only",
            IMAGE,
        ],
        check=False,
    )
    if started.returncode:
        pytest.skip(f"PostgreSQL test non avviabile: {started.stderr.strip()}")

    def psql(sql: str, *, role: str = "postgres", check: bool = True):
        return _run(
            [
                "docker",
                "exec",
                "-i",
                name,
                "psql",
                "-X",
                "-q",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                role,
                "-d",
                "postgres",
                "-At",
                "-F",
                "|",
            ],
            input_text=sql,
            check=check,
        )

    try:
        stable = 0
        for _ in range(100):
            ready = psql("SELECT 1;", check=False)
            stable = stable + 1 if ready.returncode == 0 else 0
            if stable == 2:
                break
            time.sleep(0.1)
        else:
            pytest.fail("PostgreSQL 16 non è diventato ready")

        psql(
            f"""
            CREATE ROLE anon NOLOGIN;
            CREATE ROLE authenticated NOLOGIN;
            CREATE ROLE service_role LOGIN BYPASSRLS;
            CREATE SCHEMA auth;
            CREATE TABLE auth.users (id UUID PRIMARY KEY);
            INSERT INTO auth.users VALUES ('{USER_1}'), ('{USER_2}');

            CREATE TABLE public.positions (
              id UUID PRIMARY KEY,
              user_id UUID NOT NULL REFERENCES auth.users(id),
              legacy_id INTEGER NOT NULL,
              status TEXT,
              UNIQUE (user_id, legacy_id),
              UNIQUE (user_id, id)
            );
            CREATE TABLE public.applications (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              user_id UUID NOT NULL REFERENCES auth.users(id),
              position_id UUID NOT NULL,
              cv_path TEXT, cv_pdf_path TEXT, cl_path TEXT, cl_pdf_path TEXT,
              status TEXT, critic_score REAL, critic_verdict TEXT,
              critic_notes TEXT, critic_round INTEGER,
              written_at TIMESTAMPTZ, applied_at TIMESTAMPTZ,
              applied_via TEXT, response TEXT, response_at TIMESTAMPTZ,
              written_by TEXT, reviewed_by TEXT,
              critic_reviewed_at TIMESTAMPTZ, applied BOOLEAN,
              cv_drive_id TEXT, cl_drive_id TEXT,
              UNIQUE (position_id),
              FOREIGN KEY (user_id, position_id)
                REFERENCES public.positions (user_id, id)
            );
            ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
            ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
            GRANT SELECT, INSERT, UPDATE ON public.positions, public.applications
              TO service_role;

            INSERT INTO public.positions (id, user_id, legacy_id, status) VALUES
              ('10000000-0000-0000-0000-000000000042', '{USER_1}', 42, 'ready'),
              ('10000000-0000-0000-0000-000000000043', '{USER_1}', 43, 'ready'),
              ('10000000-0000-0000-0000-000000000044', '{USER_1}', 44, 'ready'),
              ('10000000-0000-0000-0000-000000000045', '{USER_1}', 45, 'ready'),
              ('10000000-0000-0000-0000-000000000046', '{USER_1}', 46, 'ready'),
              ('10000000-0000-0000-0000-000000000047', '{USER_1}', 47, 'ready'),
              ('10000000-0000-0000-0000-000000000048', '{USER_1}', 48, 'ready'),
              ('20000000-0000-0000-0000-000000000099', '{USER_2}', 99, 'ready');
            -- Pre-076: application già presente, ma la sua identità locale
            -- non ha ancora una colonna cloud.
            INSERT INTO public.applications (id, user_id, position_id, status)
            VALUES (
              '30000000-0000-0000-0000-000000000193', '{USER_1}',
              '10000000-0000-0000-0000-000000000042', 'draft'
            );
            """
        )
        psql(MIGRATION.read_text(encoding="utf-8"))
        psql.container_name = name
        yield psql
    finally:
        _run(["docker", "rm", "--force", name], check=False)


def _rpc(psql, rows, *, user_id=USER_1, check=True):
    payload = json.dumps(rows, separators=(",", ":"))
    return psql(
        f"SELECT public.sync_upsert_applications('{user_id}', "
        f"$json${payload}$json$::jsonb);",
        role="service_role",
        check=check,
    )


def _rpc_sql(rows, *, user_id=USER_1):
    payload = json.dumps(rows, separators=(",", ":"))
    return (
        f"SELECT public.sync_upsert_applications('{user_id}', "
        f"$json${payload}$json$::jsonb);"
    )


def _overlap(psql, first_rows, second_rows):
    argv = [
        "docker",
        "exec",
        "-i",
        psql.container_name,
        "psql",
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "service_role",
        "-d",
        "postgres",
        "-At",
        "-F",
        "|",
        "-c",
    ]
    first_sql = (
        "BEGIN; "
        + _rpc_sql(first_rows)
        + " SELECT pg_sleep(0.5); COMMIT;"
    )
    first = subprocess.Popen(
        [*argv, first_sql],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    time.sleep(0.15)
    second = subprocess.Popen(
        [*argv, _rpc_sql(second_rows)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    results = [first.communicate(timeout=15), second.communicate(timeout=15)]
    return first.returncode, second.returncode, results


def test_existing_193_is_repaired_194_is_inserted_and_retry_is_idempotent(
    postgres16,
):
    psql = postgres16
    rows = [
        {
            "legacy_id": 193,
            "position_legacy_id": 42,
            "_receipt_id": "q_aaaaaaaaaaaaaaaaaaaaaaaa",
            "status": "draft",
        },
        {
            "legacy_id": 194,
            "position_legacy_id": 43,
            "_receipt_id": "q_bbbbbbbbbbbbbbbbbbbbbbbb",
            "status": "draft",
        },
    ]

    first = json.loads(_rpc(psql, rows).stdout.strip())
    assert first == [
        "q_aaaaaaaaaaaaaaaaaaaaaaaa",
        "q_bbbbbbbbbbbbbbbbbbbbbbbb",
    ]
    state = psql(
        f"""
        SELECT application.legacy_id, position.legacy_id, application.id
          FROM public.applications AS application
          JOIN public.positions AS position ON position.id = application.position_id
         WHERE application.user_id = '{USER_1}'
         ORDER BY application.legacy_id;
        """
    ).stdout.strip().splitlines()
    assert state[0] == "193|42|30000000-0000-0000-0000-000000000193"
    inserted = state[1].split("|")
    assert inserted[:2] == ["194", "43"]
    assert inserted[2] != "10000000-0000-0000-0000-000000000043"

    second = json.loads(_rpc(psql, rows).stdout.strip())
    assert second == first
    assert psql(
        f"SELECT count(*) FROM public.applications WHERE user_id = '{USER_1}';"
    ).stdout.strip() == "2"


@pytest.mark.parametrize(
    ("rows", "error"),
    [
        ([{"legacy_id": 195, "position_legacy_id": 42,
           "_receipt_id": "q_cccccccccccccccccccccccc"}], "identity_mismatch"),
        ([{"legacy_id": 193, "position_legacy_id": 43,
           "_receipt_id": "q_dddddddddddddddddddddddd"}], "identity_mismatch"),
        ([{"legacy_id": 196, "position_legacy_id": 404,
           "_receipt_id": "q_eeeeeeeeeeeeeeeeeeeeeeee"}], "position_not_found"),
    ],
)
def test_mismatch_and_missing_position_fail_closed(postgres16, rows, error):
    rejected = _rpc(postgres16, rows, check=False)
    assert rejected.returncode != 0
    assert error in rejected.stderr


def test_position_lookup_is_tenant_bound(postgres16):
    rejected = _rpc(
        postgres16,
        [{"legacy_id": 197, "position_legacy_id": 99,
          "_receipt_id": "q_ffffffffffffffffffffffff"}],
        user_id=USER_1,
        check=False,
    )
    assert rejected.returncode != 0
    assert "position_not_found" in rejected.stderr


def test_two_application_ids_for_the_same_position_rollback_together(postgres16):
    psql = postgres16
    before = psql(
        f"SELECT legacy_id FROM public.applications WHERE user_id = '{USER_1}' "
        "AND position_id = '10000000-0000-0000-0000-000000000042';"
    ).stdout.strip()
    rejected = _rpc(
        psql,
        [
            {
                "legacy_id": 193,
                "position_legacy_id": 42,
                "_receipt_id": "q_111111111111111111111111",
            },
            {
                "legacy_id": 198,
                "position_legacy_id": 42,
                "_receipt_id": "q_222222222222222222222222",
            },
        ],
        check=False,
    )
    assert rejected.returncode != 0
    assert "application_identity_mismatch" in rejected.stderr
    after = psql(
        f"SELECT legacy_id FROM public.applications WHERE user_id = '{USER_1}' "
        "AND position_id = '10000000-0000-0000-0000-000000000042';"
    ).stdout.strip()
    assert after == before == "193"


def test_concurrent_same_position_different_legacy_has_one_winner(postgres16):
    first = [{
        "legacy_id": 201,
        "position_legacy_id": 44,
        "_receipt_id": "q_333333333333333333333333",
    }]
    second = [{
        "legacy_id": 202,
        "position_legacy_id": 44,
        "_receipt_id": "q_444444444444444444444444",
    }]
    first_rc, second_rc, results = _overlap(postgres16, first, second)
    assert first_rc == 0, results
    assert second_rc != 0, results
    assert "application_identity_mismatch" in results[1][1]
    assert postgres16(
        f"SELECT legacy_id FROM public.applications WHERE user_id = '{USER_1}' "
        "AND position_id = '10000000-0000-0000-0000-000000000044';"
    ).stdout.strip() == "201"


def test_concurrent_same_legacy_different_position_has_one_winner(postgres16):
    first = [{
        "legacy_id": 203,
        "position_legacy_id": 45,
        "_receipt_id": "q_555555555555555555555555",
    }]
    second = [{
        "legacy_id": 203,
        "position_legacy_id": 46,
        "_receipt_id": "q_666666666666666666666666",
    }]
    first_rc, second_rc, results = _overlap(postgres16, first, second)
    assert first_rc == 0, results
    assert second_rc != 0, results
    assert "application_identity_mismatch" in results[1][1]
    state = postgres16(
        f"SELECT position.legacy_id FROM public.applications AS application "
        "JOIN public.positions AS position ON position.id = application.position_id "
        f"WHERE application.user_id = '{USER_1}' AND application.legacy_id = 203;"
    ).stdout.strip()
    assert state == "45"


def test_late_batch_mismatch_rolls_back_earlier_insert(postgres16):
    rejected = _rpc(
        postgres16,
        [
            {
                "legacy_id": 204,
                "position_legacy_id": 47,
                "_receipt_id": "q_777777777777777777777777",
            },
            {
                "legacy_id": 193,
                "position_legacy_id": 48,
                "_receipt_id": "q_888888888888888888888888",
            },
        ],
        check=False,
    )
    assert rejected.returncode != 0
    assert "application_identity_mismatch" in rejected.stderr
    assert postgres16(
        f"SELECT count(*) FROM public.applications WHERE user_id = '{USER_1}' "
        "AND legacy_id = 204;"
    ).stdout.strip() == "0"


def test_execute_is_service_role_only_and_migration_reapplies(postgres16):
    psql = postgres16
    psql(MIGRATION.read_text(encoding="utf-8"))
    privileges = psql(
        """
        SELECT
          has_function_privilege('anon',
            'public.sync_upsert_applications(uuid,jsonb)', 'EXECUTE'),
          has_function_privilege('authenticated',
            'public.sync_upsert_applications(uuid,jsonb)', 'EXECUTE'),
          has_function_privilege('service_role',
            'public.sync_upsert_applications(uuid,jsonb)', 'EXECUTE');
        """
    ).stdout.strip()
    assert privileges == "f|f|t"

    denied = psql(
        f"SET ROLE anon; SELECT public.sync_upsert_applications('{USER_1}', '[]');",
        check=False,
    )
    assert denied.returncode != 0
    assert "permission denied" in denied.stderr.lower()


def test_migration_prefix_is_076_without_collisions():
    migrations = sorted((ROOT / "supabase/migrations").glob("[0-9][0-9][0-9]_*.sql"))
    names = [migration.name for migration in migrations if migration.name.startswith("076_")]
    assert names == [MIGRATION.name]

"""PostgreSQL 16 oracle for the durable F-06 pairing-attempt bucket."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/084_cloud_sync_pairing_attempts.sql"
EXPORT_COLUMNS = ROOT / "web/lib/account-export-columns.ts"
IMAGE = "postgres:16-alpine"
POSTGRES_READY_MARKER = "database system is ready to accept connections"


def _run(args, *, input_text=None, check=True):
    return subprocess.run(
        args,
        input=input_text,
        text=True,
        capture_output=True,
        check=check,
        timeout=45,
    )


@pytest.fixture(scope="module")
def pg16():
    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    if external_url:
        psql_client = shutil.which("psql")
        parsed = urlparse(external_url)
        if not psql_client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL requires psql and a valid host")
        database = f"jht_f06_oracle_{uuid.uuid4().hex[:12]}"

        def external_psql(sql: str, *, target=external_url, check=True):
            return _run(
                [
                    psql_client,
                    "-X",
                    "-q",
                    "-v",
                    "ON_ERROR_STOP=1",
                    "-d",
                    target,
                    "-At",
                    "-F",
                    "|",
                ],
                input_text=sql,
                check=check,
            )

        external_psql(f'CREATE DATABASE "{database}";')
        database_url = urlunparse(parsed._replace(path=f"/{database}"))

        def psql(sql: str, *, check=True):
            return external_psql(sql, target=database_url, check=check)

        try:
            yield psql
        finally:
            external_psql(
                f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE);',
                check=False,
            )
        return

    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    if _run(["docker", "image", "inspect", IMAGE], check=False).returncode:
        pytest.skip("immagine postgres:16-alpine non disponibile")
    name = f"jht-f06-oracle-{uuid.uuid4().hex[:10]}"
    started = _run(
        [
            "docker",
            "run",
            "--detach",
            "--rm",
            "--name",
            name,
            "-e",
            "POSTGRES_PASSWORD=synthetic",
            IMAGE,
        ],
        check=False,
    )
    if started.returncode:
        pytest.skip(started.stderr.strip())

    def psql(sql: str, *, check=True):
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
                "postgres",
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
        for _ in range(100):
            logs_result = _run(["docker", "logs", name], check=False)
            logs = logs_result.stdout + logs_result.stderr
            if logs.count(POSTGRES_READY_MARKER) >= 2:
                ready = psql(
                    "CREATE TEMP TABLE f06_ready(id integer); "
                    "DROP TABLE f06_ready;",
                    check=False,
                )
                if ready.returncode == 0:
                    break
            time.sleep(0.2)
        else:
            pytest.skip("postgres non pronto")
        yield psql
    finally:
        _run(["docker", "rm", "--force", name], check=False)


def _pairing_attempt_export_columns() -> set[str]:
    source = EXPORT_COLUMNS.read_text(encoding="utf-8")
    match = re.search(
        r"\bcloud_sync_pairing_attempts:\s*\[(.*?)\],",
        source,
        flags=re.DOTALL,
    )
    assert match is not None
    columns = set(re.findall(r'"([a-z_]+)"', match.group(1)))
    assert columns
    return columns


def test_f06_migration_is_collision_gated_and_tenant_bound():
    sql = MIGRATION.read_text(encoding="utf-8")
    assert "084 collision" in sql
    assert "user_id uuid primary key" in sql
    assert "for update" in sql.lower()
    assert "invalidated_at" in sql
    assert "consume_pairing_attempt" in sql
    assert "grant execute" in sql and "service_role" in sql


def test_f06_pg16_apply_reapply_and_export_schema_oracle(pg16):
    pg16(
        """
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE ROLE service_role NOLOGIN;
        CREATE SCHEMA auth;
        CREATE TABLE auth.users (id uuid PRIMARY KEY);
        """
    )
    sql = MIGRATION.read_text(encoding="utf-8")

    pg16(sql)
    first_columns = set(
        pg16(
            """
            SELECT column_name
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'cloud_sync_pairing_attempts'
             ORDER BY ordinal_position;
            """
        ).stdout.splitlines()
    )
    pg16(sql)
    reapplied_columns = set(
        pg16(
            """
            SELECT column_name
              FROM information_schema.columns
             WHERE table_schema = 'public'
               AND table_name = 'cloud_sync_pairing_attempts'
             ORDER BY ordinal_position;
            """
        ).stdout.splitlines()
    )

    assert first_columns == reapplied_columns
    assert _pairing_attempt_export_columns() <= reapplied_columns
    assert "attempts" in _pairing_attempt_export_columns()


def test_f06_no_raw_upstash_configuration_is_exposed():
    source = (ROOT / "web/lib/upstash-config.ts").read_text(encoding="utf-8")
    assert "UPSTASH_REDIS_REST_TOKEN" in source
    assert "return token" not in source
    assert "urlHost" in source

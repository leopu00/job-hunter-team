"""O-50 download attribution checks against real PostgreSQL 16."""

from __future__ import annotations

import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
BASE_MIGRATION = ROOT / "supabase/migrations/063_download_clicks.sql"
SOURCE_MIGRATION = ROOT / "supabase/migrations/082_download_clicks_tiktok_source.sql"
IMAGE = "postgres:16-alpine"
READY_MARKER = "database system is ready to accept connections"


def _run(argv: list[str], *, input_text: str | None = None, check: bool = True):
    return subprocess.run(
        argv,
        input=input_text,
        text=True,
        capture_output=True,
        check=check,
        timeout=30,
    )


@pytest.fixture(scope="module")
def download_db():
    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    if _run(["docker", "image", "inspect", IMAGE], check=False).returncode:
        pytest.skip(f"immagine locale {IMAGE} non disponibile")

    name = f"jht-o50-{uuid.uuid4().hex[:10]}"
    started = _run(
        [
            "docker",
            "run",
            "--detach",
            "--rm",
            "--name",
            name,
            "--tmpfs",
            "/var/lib/postgresql/data:rw,size=256m",
            "-e",
            "POSTGRES_PASSWORD=synthetic-test-only",
            IMAGE,
        ],
        check=False,
    )
    if started.returncode:
        pytest.fail("PostgreSQL 16 download oracle non avviabile")

    def psql(sql: str, *, check: bool = True):
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
            logs = _run(["docker", "logs", name], check=False)
            if (logs.stdout + logs.stderr).count(READY_MARKER) >= 2:
                break
            time.sleep(0.1)
        else:
            pytest.fail("PostgreSQL 16 download oracle non pronto")

        psql(
            "CREATE ROLE anon NOLOGIN; "
            "CREATE ROLE authenticated NOLOGIN; "
            "CREATE ROLE service_role NOLOGIN BYPASSRLS;"
        )
        psql(BASE_MIGRATION.read_text(encoding="utf-8"))
        psql(
            """
            INSERT INTO public.download_clicks(
              ts_hour, slug, utm_source, utm_medium, utm_campaign, n
            ) VALUES
              ('2026-08-13T18', 'mac', 'none', 'none', 'none', 1),
              ('2026-08-13T18', 'mac', 'reddit', 'paid',
               'lancio-2026-08', 1);
            """
        )
        # A retry must replace the same named CHECK without losing old rows.
        psql(SOURCE_MIGRATION.read_text(encoding="utf-8"))
        psql(SOURCE_MIGRATION.read_text(encoding="utf-8"))
        yield psql
    finally:
        _run(["docker", "rm", "--force", name], check=False)


def _scalar(psql, sql: str) -> str:
    return [line for line in psql(sql).stdout.splitlines() if line][-1]


def test_pg16_preserves_old_sources_and_attributes_tiktok(download_db):
    psql = download_db

    result = psql(
        """
        SET ROLE service_role;
        SELECT public.increment_download_clicks(
          '2026-08-13T18', 'mac', 'tiktok', 'paid', 'lancio-2026-08'
        );
        SELECT public.increment_download_clicks(
          '2026-08-13T18', 'mac', 'none', 'none', 'none'
        );
        SELECT public.increment_download_clicks(
          '2026-08-13T18', 'mac', 'reddit', 'paid', 'lancio-2026-08'
        );
        RESET ROLE;
        """
    )
    assert [line for line in result.stdout.splitlines() if line] == ["1", "2", "2"]
    assert (
        _scalar(
            psql,
            """
        SELECT string_agg(utm_source || ':' || n, ',' ORDER BY utm_source)
        FROM public.download_clicks;
        """,
        )
        == "none:2,reddit:2,tiktok:1"
    )
    assert (
        _scalar(
            psql,
            """
        SELECT count(*)
        FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.download_clicks'::regclass
          AND conname = 'download_clicks_utm_source_check'
          AND contype = 'c'
          AND convalidated;
        """,
        )
        == "1"
    )


@pytest.mark.parametrize("invalid_source", ["youtube", "TikTok", "", "tiktok "])
def test_pg16_rejects_every_non_allowlisted_source(download_db, invalid_source):
    escaped = invalid_source.replace("'", "''")
    result = download_db(
        f"""
        SET ROLE service_role;
        SELECT public.increment_download_clicks(
          '2026-08-13T19', 'linux', '{escaped}', 'paid', 'lancio-2026-08'
        );
        """,
        check=False,
    )

    assert result.returncode != 0
    assert (
        _scalar(
            download_db,
            f"SELECT count(*) FROM public.download_clicks "
            f"WHERE utm_source = '{escaped}';",
        )
        == "0"
    )

"""Real-PostgreSQL contract for migration 074.

These tests do not parse SQL or emulate Supabase calls. They start an isolated
PostgreSQL cluster, build the schema immediately before migration 074, apply
the migration with psql, and observe constraints, privileges, transactions and
locks on the database engine that will enforce them in production.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import unquote, urlparse

import pytest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "supabase"
    / "migrations"
    / "074_tenant_edges_and_atomic_account_delete.sql"
)

USER_A = "00000000-0000-0000-0000-000000000001"
USER_B = "00000000-0000-0000-0000-000000000002"
USER_C = "00000000-0000-0000-0000-000000000003"
USER_D = "00000000-0000-0000-0000-000000000004"
USER_E = "00000000-0000-0000-0000-000000000005"
COMPANY_A = "10000000-0000-0000-0000-000000000001"
COMPANY_B = "10000000-0000-0000-0000-000000000002"
POSITION_A = "20000000-0000-0000-0000-000000000001"
POSITION_B = "20000000-0000-0000-0000-000000000002"
POSITION_BAD_COMPANY = "20000000-0000-0000-0000-000000000010"


def _pg_binaries() -> dict[str, str] | None:
    """Return one coherent server toolchain, never a client-only libpq mix."""
    names = ("postgres", "initdb", "pg_ctl", "psql")
    candidates: list[Path] = []
    postgres = shutil.which("postgres")
    if postgres:
        candidates.append(Path(postgres).parent)
    candidates.extend(Path("/opt/homebrew/opt").glob("postgresql@*/bin"))
    candidates.extend(Path("/usr/local/opt").glob("postgresql@*/bin"))
    candidates.extend(Path("/usr/lib/postgresql").glob("*/bin"))
    # Prefer the newest complete server installation.
    for directory in reversed(sorted(set(candidates))):
        paths = {name: directory / name for name in names}
        if all(path.is_file() for path in paths.values()):
            return {name: str(path) for name, path in paths.items()}
    return None


@pytest.fixture(scope="module")
def postgres_cluster(tmp_path_factory):
    root = tmp_path_factory.mktemp("tenant-delete-postgres")
    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    binaries = _pg_binaries()
    container_name: str | None = None
    data: Path | None = None
    external = external_url is not None
    if external_url is not None:
        parsed = urlparse(external_url)
        psql_client = shutil.which("psql")
        if not psql_client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL requires psql and a valid host")
        binaries = {"psql": psql_client}
        host = parsed.hostname
        port = parsed.port or 5432
        base_database = parsed.path.lstrip("/") or "postgres"
        user = unquote(parsed.username or "postgres")
        password = unquote(parsed.password or "")
    else:
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        base_database = "postgres"
        user = "postgres"
        password = ""
    if not external and binaries is not None:
        data = root / "data"
        socket_dir = root / "socket"
        socket_dir.mkdir()
        subprocess.run(
            [
                binaries["initdb"],
                "-D",
                str(data),
                "-A",
                "trust",
                "-U",
                "postgres",
                "--no-locale",
                "--encoding=UTF8",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            [
                binaries["pg_ctl"],
                "-D",
                str(data),
                "-l",
                str(root / "postgres.log"),
                "-o",
                f"-F -p {port} -k {socket_dir}",
                "-w",
                "start",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        host = str(socket_dir)
    elif not external:
        docker = shutil.which("docker")
        psql_client = shutil.which("psql")
        image = "postgres:16-alpine"
        if not docker or not psql_client:
            pytest.skip("PostgreSQL server tools and Docker fallback unavailable")
        image_present = subprocess.run(
            [docker, "image", "inspect", image],
            capture_output=True,
            text=True,
        )
        if image_present.returncode != 0:
            pytest.skip(f"local {image} image unavailable")
        container_name = "jht-tenant-delete-" + uuid.uuid4().hex[:12]
        subprocess.run(
            [
                docker,
                "run",
                "--rm",
                "-d",
                "--name",
                container_name,
                "-e",
                "POSTGRES_HOST_AUTH_METHOD=trust",
                "-p",
                f"127.0.0.1:{port}:5432",
                image,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        binaries = {"psql": psql_client, "docker": docker}
        host = "127.0.0.1"
    env = {
        **os.environ,
        "PGHOST": host,
        "PGPORT": str(port),
        "PGUSER": user,
        "PGPASSWORD": password,
    }

    def psql(
        sql: str,
        *,
        database: str = base_database,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                binaries["psql"],
                "-X",
                "-A",
                "-t",
                "-v",
                "ON_ERROR_STOP=1",
                "-d",
                database,
            ],
            input=sql,
            env=env,
            check=check,
            capture_output=True,
            text=True,
        )

    try:
        last_error = ""
        for _ in range(100):
            ready = subprocess.run(
                [binaries["psql"], "-X", "-d", base_database, "-c", "SELECT 1"],
                env=env,
                capture_output=True,
                text=True,
            )
            if ready.returncode == 0:
                break
            last_error = ready.stderr
            time.sleep(0.1)
        else:
            raise AssertionError(f"temporary PostgreSQL did not start: {last_error}")
        psql(
            """
            DO $$ BEGIN CREATE ROLE anon NOLOGIN;
              EXCEPTION WHEN duplicate_object THEN NULL; END $$;
            DO $$ BEGIN CREATE ROLE authenticated NOLOGIN;
              EXCEPTION WHEN duplicate_object THEN NULL; END $$;
            DO $$ BEGIN CREATE ROLE service_role NOLOGIN;
              EXCEPTION WHEN duplicate_object THEN NULL; END $$;
            """
        )
        yield {"psql": psql, "env": env, "bin": binaries}
    finally:
        if external:
            pass
        elif container_name is not None:
            subprocess.run(
                [binaries["docker"], "stop", container_name],
                check=False,
                capture_output=True,
                text=True,
            )
        elif data is not None:
            subprocess.run(
                [
                    binaries["pg_ctl"],
                    "-D",
                    str(data),
                    "-m",
                    "fast",
                    "-w",
                    "stop",
                ],
                check=True,
                capture_output=True,
                text=True,
            )


BOOTSTRAP_SQL = f"""
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS UUID
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

CREATE TABLE auth.users (id UUID PRIMARY KEY);
CREATE TABLE public.companies (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL
);
CREATE TABLE public.positions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  company_id UUID REFERENCES public.companies(id),
  title TEXT NOT NULL
);
CREATE TABLE public.scores (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  position_id UUID NOT NULL UNIQUE REFERENCES public.positions(id) ON DELETE CASCADE
);
CREATE TABLE public.applications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  position_id UUID NOT NULL UNIQUE REFERENCES public.positions(id) ON DELETE CASCADE
);
CREATE TABLE public.position_highlights (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE
);
CREATE TABLE public.position_views (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, position_id)
);
CREATE TABLE public.position_user_notes (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position_id UUID NOT NULL REFERENCES public.positions(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (user_id, position_id, origin)
);
CREATE TABLE public.pending_user_messages (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  related_position_id UUID REFERENCES public.positions(id) ON DELETE SET NULL,
  body TEXT NOT NULL
);
CREATE TABLE public.candidate_profiles (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id)
);
CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  value TEXT NOT NULL
);

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO authenticated;

DO $policies$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'companies', 'positions', 'scores', 'applications',
    'position_highlights', 'position_views', 'position_user_notes',
    'pending_user_messages', 'candidate_profiles', 'user_settings'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY own_rows ON public.%I FOR ALL TO authenticated '
      'USING ((SELECT auth.uid()) = user_id) '
      'WITH CHECK ((SELECT auth.uid()) = user_id)',
      table_name
    );
  END LOOP;
END
$policies$;

INSERT INTO auth.users(id) VALUES
  ('{USER_A}'), ('{USER_B}'), ('{USER_C}'), ('{USER_D}'), ('{USER_E}');
INSERT INTO public.companies(id, user_id, name) VALUES
  ('{COMPANY_A}', '{USER_A}', 'Synthetic A'),
  ('{COMPANY_B}', '{USER_B}', 'Synthetic B');
INSERT INTO public.positions(id, user_id, company_id, title) VALUES
  ('{POSITION_A}', '{USER_A}', '{COMPANY_A}', 'Synthetic A'),
  ('{POSITION_B}', '{USER_B}', '{COMPANY_B}', 'Synthetic B'),
  ('{POSITION_BAD_COMPANY}', '{USER_A}', '{COMPANY_B}', 'Legacy mismatch');

-- Valid rows must survive the legacy repair.
INSERT INTO public.scores VALUES
  ('30000000-0000-0000-0000-000000000001', '{USER_A}', '{POSITION_A}');
INSERT INTO public.applications VALUES
  ('40000000-0000-0000-0000-000000000001', '{USER_A}', '{POSITION_A}');
INSERT INTO public.position_highlights VALUES
  ('50000000-0000-0000-0000-000000000001', '{USER_A}', '{POSITION_A}');
INSERT INTO public.position_views VALUES ('{USER_A}', '{POSITION_A}');
INSERT INTO public.position_user_notes VALUES
  ('{USER_A}', '{POSITION_A}', 'web', 'Synthetic A'),
  ('{USER_B}', '{POSITION_B}', 'web', 'Synthetic B');
INSERT INTO public.pending_user_messages VALUES
  ('70000000-0000-0000-0000-000000000001', '{USER_A}', '{POSITION_A}', 'Synthetic A'),
  ('70000000-0000-0000-0000-000000000002', '{USER_B}', '{POSITION_B}', 'Synthetic B');

-- Each legacy row below passed the old UUID-only FK but crosses tenants.
INSERT INTO public.scores VALUES
  ('30000000-0000-0000-0000-000000000002', '{USER_A}', '{POSITION_B}');
INSERT INTO public.applications VALUES
  ('40000000-0000-0000-0000-000000000002', '{USER_A}', '{POSITION_B}');
INSERT INTO public.position_highlights VALUES
  ('50000000-0000-0000-0000-000000000002', '{USER_A}', '{POSITION_B}');
INSERT INTO public.position_views VALUES ('{USER_A}', '{POSITION_B}');
INSERT INTO public.position_user_notes VALUES
  ('{USER_A}', '{POSITION_B}', 'box', 'Synthetic mismatch');
INSERT INTO public.pending_user_messages VALUES
  ('70000000-0000-0000-0000-000000000010', '{USER_A}', '{POSITION_B}',
   'Synthetic mismatch');
"""


@pytest.fixture()
def migrated_database(postgres_cluster):
    psql = postgres_cluster["psql"]
    name = "jht_tenant_" + uuid.uuid4().hex[:12]
    psql(f'CREATE DATABASE "{name}";')
    try:
        psql(BOOTSTRAP_SQL, database=name)
        result = subprocess.run(
            [
                postgres_cluster["bin"]["psql"],
                "-X",
                "-v",
                "ON_ERROR_STOP=1",
                "-d",
                name,
                "-f",
                str(MIGRATION),
            ],
            env=postgres_cluster["env"],
            check=True,
            capture_output=True,
            text=True,
        )
        assert "ERROR" not in result.stderr
        yield name
    finally:
        psql(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE);')


def _sql(postgres_cluster, database: str, sql: str, *, check: bool = True):
    return postgres_cluster["psql"](sql, database=database, check=check)


def test_migration_repairs_legacy_rows_before_composite_foreign_keys(
    postgres_cluster, migrated_database
):
    db = migrated_database
    repaired = _sql(
        postgres_cluster,
        db,
        f"""
        SELECT company_id IS NULL FROM public.positions
         WHERE id = '{POSITION_BAD_COMPANY}';
        SELECT count(*) FROM public.scores;
        SELECT count(*) FROM public.applications;
        SELECT count(*) FROM public.position_highlights;
        SELECT count(*) FROM public.position_views;
        SELECT count(*) FROM public.position_user_notes;
        SELECT related_position_id IS NULL FROM public.pending_user_messages
         WHERE id = '70000000-0000-0000-0000-000000000010';
        """,
    ).stdout.splitlines()
    assert repaired == ["t", "1", "1", "1", "1", "2", "t"]

    attempts = [
        (
            "position/company",
            f"INSERT INTO public.positions VALUES "
            f"('21000000-0000-0000-0000-000000000001', '{USER_A}', "
            f"'{COMPANY_B}', 'Rejected');",
        ),
        (
            "score/position",
            f"INSERT INTO public.scores VALUES "
            f"('31000000-0000-0000-0000-000000000001', '{USER_A}', "
            f"'{POSITION_B}');",
        ),
        (
            "application/position",
            f"INSERT INTO public.applications VALUES "
            f"('41000000-0000-0000-0000-000000000001', '{USER_A}', "
            f"'{POSITION_B}');",
        ),
        (
            "highlight/position",
            f"INSERT INTO public.position_highlights VALUES "
            f"('51000000-0000-0000-0000-000000000001', '{USER_A}', "
            f"'{POSITION_B}');",
        ),
        (
            "view/position",
            f"INSERT INTO public.position_views VALUES "
            f"('{USER_A}', '{POSITION_B}');",
        ),
        (
            "note/position",
            f"INSERT INTO public.position_user_notes VALUES "
            f"('{USER_A}', '{POSITION_B}', 'box', 'Rejected');",
        ),
        (
            "message/position",
            f"INSERT INTO public.pending_user_messages VALUES "
            f"('71000000-0000-0000-0000-000000000001', '{USER_A}', "
            f"'{POSITION_B}', 'Rejected');",
        ),
    ]
    for edge, statement in attempts:
        result = _sql(postgres_cluster, db, statement, check=False)
        assert result.returncode != 0, f"cross-tenant edge accepted: {edge}"
        assert "foreign key constraint" in result.stderr.lower()


def test_rls_and_execute_permissions_are_fail_closed(
    postgres_cluster, migrated_database
):
    db = migrated_database
    privileges = _sql(
        postgres_cluster,
        db,
        """
        SELECT has_function_privilege(
          'anon', 'public.delete_account_data(uuid)', 'EXECUTE');
        SELECT has_function_privilege(
          'authenticated', 'public.delete_account_data(uuid)', 'EXECUTE');
        SELECT has_function_privilege(
          'service_role', 'public.delete_account_data(uuid)', 'EXECUTE');
        """,
    ).stdout.splitlines()
    assert privileges == ["f", "f", "t"]

    visible = _sql(
        postgres_cluster,
        db,
        f"""
        SET ROLE authenticated;
        SET "request.jwt.claim.sub" = '{USER_A}';
        SELECT count(*) FROM public.positions;
        RESET ROLE;
        """,
    ).stdout.splitlines()
    # USER_A sees its own normal and repaired legacy position, never USER_B's.
    assert [line for line in visible if line.isdigit()] == ["2"]

    denied = _sql(
        postgres_cluster,
        db,
        f"SET ROLE authenticated; "
        f"SELECT public.delete_account_data('{USER_B}');",
        check=False,
    )
    assert denied.returncode != 0
    assert "permission denied for function delete_account_data" in denied.stderr


def test_privileged_rpc_deletes_only_the_selected_tenant(
    postgres_cluster, migrated_database
):
    db = migrated_database
    _sql(
        postgres_cluster,
        db,
        f"""
        INSERT INTO public.candidate_profiles VALUES
          ('60000000-0000-0000-0000-000000000001', '{USER_A}'),
          ('60000000-0000-0000-0000-000000000002', '{USER_B}');
        INSERT INTO public.user_settings VALUES
          ('{USER_A}', 'synthetic-a'), ('{USER_B}', 'synthetic-b');
        """,
    )
    raw = _sql(
        postgres_cluster,
        db,
        f"SET ROLE service_role; "
        f"SELECT public.delete_account_data('{USER_A}');",
    ).stdout.splitlines()[-1]
    outcome = json.loads(raw)
    assert outcome["removed"] == {
        "applications": 1,
        "candidate_profiles": 1,
        "companies": 1,
        "position_highlights": 1,
        "positions": 2,
        "scores": 1,
    }

    remaining = _sql(
        postgres_cluster,
        db,
        f"""
        SELECT count(*) FROM auth.users WHERE id = '{USER_A}';
        SELECT count(*) FROM auth.users WHERE id = '{USER_B}';
        SELECT count(*) FROM public.companies WHERE user_id = '{USER_B}';
        SELECT count(*) FROM public.positions WHERE user_id = '{USER_B}';
        SELECT count(*) FROM public.user_settings WHERE user_id = '{USER_B}';
        SELECT count(*) FROM public.position_user_notes WHERE user_id = '{USER_B}';
        SELECT count(*) FROM public.pending_user_messages WHERE user_id = '{USER_B}';
        """,
    ).stdout.splitlines()
    assert remaining == ["0", "1", "1", "1", "1", "1", "1"]


def _insert_deletion_fixture(postgres_cluster, database: str, user: str, suffix: str):
    company = f"11000000-0000-0000-0000-0000000000{suffix}"
    position = f"22000000-0000-0000-0000-0000000000{suffix}"
    _sql(
        postgres_cluster,
        database,
        f"""
        INSERT INTO public.companies VALUES ('{company}', '{user}', 'Synthetic');
        INSERT INTO public.positions VALUES
          ('{position}', '{user}', '{company}', 'Synthetic');
        INSERT INTO public.scores VALUES
          ('33000000-0000-0000-0000-0000000000{suffix}', '{user}', '{position}');
        INSERT INTO public.applications VALUES
          ('44000000-0000-0000-0000-0000000000{suffix}', '{user}', '{position}');
        INSERT INTO public.position_highlights VALUES
          ('55000000-0000-0000-0000-0000000000{suffix}', '{user}', '{position}');
        INSERT INTO public.position_views VALUES ('{user}', '{position}');
        INSERT INTO public.position_user_notes VALUES
          ('{user}', '{position}', 'web', 'Synthetic');
        INSERT INTO public.pending_user_messages VALUES
          ('77000000-0000-0000-0000-0000000000{suffix}', '{user}',
           '{position}', 'Synthetic');
        INSERT INTO public.candidate_profiles VALUES
          ('66000000-0000-0000-0000-0000000000{suffix}', '{user}');
        INSERT INTO public.user_settings VALUES ('{user}', 'synthetic');
        """,
    )
    return position


def test_rpc_failure_rolls_back_every_database_delete(
    postgres_cluster, migrated_database
):
    db = migrated_database
    _insert_deletion_fixture(postgres_cluster, db, USER_C, "03")
    _sql(
        postgres_cluster,
        db,
        f"""
        CREATE FUNCTION public.reject_synthetic_delete() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.user_id = '{USER_C}' THEN RAISE EXCEPTION 'synthetic_failure'; END IF;
          RETURN OLD;
        END $$;
        CREATE TRIGGER reject_synthetic_delete
          BEFORE DELETE ON public.positions
          FOR EACH ROW EXECUTE FUNCTION public.reject_synthetic_delete();
        """,
    )
    failed = _sql(
        postgres_cluster,
        db,
        f"SET ROLE service_role; SELECT public.delete_account_data('{USER_C}');",
        check=False,
    )
    assert failed.returncode != 0
    assert "synthetic_failure" in failed.stderr

    counts = _sql(
        postgres_cluster,
        db,
        f"""
        SELECT count(*) FROM auth.users WHERE id = '{USER_C}';
        SELECT count(*) FROM public.applications WHERE user_id = '{USER_C}';
        SELECT count(*) FROM public.position_highlights WHERE user_id = '{USER_C}';
        SELECT count(*) FROM public.scores WHERE user_id = '{USER_C}';
        SELECT count(*) FROM public.positions WHERE user_id = '{USER_C}';
        SELECT count(*) FROM public.companies WHERE user_id = '{USER_C}';
        SELECT count(*) FROM public.candidate_profiles WHERE user_id = '{USER_C}';
        SELECT count(*) FROM public.user_settings WHERE user_id = '{USER_C}';
        SELECT count(*) FROM public.position_user_notes WHERE user_id = '{USER_C}';
        SELECT count(*) FROM public.pending_user_messages WHERE user_id = '{USER_C}';
        """,
    ).stdout.splitlines()
    assert counts == ["1"] * 10


def test_concurrent_rpc_calls_serialize_on_the_auth_row(
    postgres_cluster, migrated_database
):
    db = migrated_database
    _insert_deletion_fixture(postgres_cluster, db, USER_D, "04")
    _sql(
        postgres_cluster,
        db,
        f"""
        CREATE FUNCTION public.delay_synthetic_delete() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.user_id = '{USER_D}' THEN PERFORM pg_sleep(1); END IF;
          RETURN OLD;
        END $$;
        CREATE TRIGGER delay_synthetic_delete
          BEFORE DELETE ON public.positions
          FOR EACH ROW EXECUTE FUNCTION public.delay_synthetic_delete();
        """,
    )
    command = [
        postgres_cluster["bin"]["psql"],
        "-X",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        db,
        "-c",
        f"SET ROLE service_role; SELECT public.delete_account_data('{USER_D}');",
    ]
    first = subprocess.Popen(
        command,
        env=postgres_cluster["env"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    second = subprocess.Popen(
        command,
        env=postgres_cluster["env"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    first_out, first_err = first.communicate(timeout=10)
    second_out, second_err = second.communicate(timeout=10)
    results = [(first.returncode, first_out, first_err), (second.returncode, second_out, second_err)]
    assert sum(code == 0 for code, _, _ in results) == 1
    loser = next(item for item in results if item[0] != 0)
    assert "account_not_found" in loser[2]

    remaining = _sql(
        postgres_cluster,
        db,
        f"""
        SELECT count(*) FROM auth.users WHERE id = '{USER_D}';
        SELECT count(*) FROM public.positions WHERE user_id = '{USER_D}';
        SELECT count(*) FROM public.user_settings WHERE user_id = '{USER_D}';
        SELECT count(*) FROM public.position_user_notes WHERE user_id = '{USER_D}';
        SELECT count(*) FROM public.pending_user_messages WHERE user_id = '{USER_D}';
        """,
    ).stdout.splitlines()
    assert remaining == ["0", "0", "0", "0", "0"]


def test_insert_racing_account_delete_cannot_leave_a_child(
    postgres_cluster, migrated_database
):
    db = migrated_database
    position = _insert_deletion_fixture(postgres_cluster, db, USER_E, "05")
    _sql(
        postgres_cluster,
        db,
        f"""
        CREATE FUNCTION public.delay_delete_for_insert_race() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF OLD.user_id = '{USER_E}' THEN PERFORM pg_sleep(1); END IF;
          RETURN OLD;
        END $$;
        CREATE TRIGGER delay_delete_for_insert_race
          BEFORE DELETE ON public.positions
          FOR EACH ROW EXECUTE FUNCTION public.delay_delete_for_insert_race();
        """,
    )
    base_command = [
        postgres_cluster["bin"]["psql"],
        "-X",
        "-A",
        "-t",
        "-v",
        "ON_ERROR_STOP=1",
        "-d",
        db,
        "-c",
    ]
    delete_env = {
        **postgres_cluster["env"],
        "PGAPPNAME": "jht-tenant-delete-insert-race",
    }
    deleter = subprocess.Popen(
        [
            *base_command,
            f"SET ROLE service_role; SELECT public.delete_account_data('{USER_E}');",
        ],
        env=delete_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )

    # Start the writer only after the delete reached its trigger. At that
    # point the RPC already owns auth.users FOR UPDATE; this proves the writer
    # overlaps the protected interval instead of merely running afterwards.
    for _ in range(100):
        activity = _sql(
            postgres_cluster,
            db,
            """
            SELECT state || '|' || COALESCE(wait_event, '')
              FROM pg_stat_activity
             WHERE application_name = 'jht-tenant-delete-insert-race';
            """,
        ).stdout.strip()
        if activity == "active|PgSleep":
            break
        time.sleep(0.02)
    else:
        deleter.kill()
        deleter.communicate(timeout=5)
        pytest.fail(f"delete did not reach the locked interval: {activity!r}")

    inserter = subprocess.Popen(
        [
            *base_command,
            "SET ROLE authenticated; "
            f"SET \"request.jwt.claim.sub\" = '{USER_E}'; "
            "INSERT INTO public.position_user_notes "
            "(user_id, position_id, origin, body) VALUES "
            f"('{USER_E}', '{position}', 'box', 'Synthetic racing insert');",
        ],
        env=postgres_cluster["env"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    delete_out, delete_err = deleter.communicate(timeout=10)
    insert_out, insert_err = inserter.communicate(timeout=10)
    assert deleter.returncode == 0, (delete_out, delete_err)
    assert inserter.returncode != 0, (insert_out, insert_err)
    assert "foreign key constraint" in insert_err.lower()

    remaining = _sql(
        postgres_cluster,
        db,
        f"""
        SELECT count(*) FROM auth.users WHERE id = '{USER_E}';
        SELECT count(*) FROM public.position_user_notes WHERE user_id = '{USER_E}';
        """,
    ).stdout.splitlines()
    assert remaining == ["0", "0"]

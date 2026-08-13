"""O-85: effect tests for the atomic, idempotent profile snapshot RPC."""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WRITER_MIGRATION = ROOT / "supabase/migrations/078_positions_write_request_kind.sql"
DIRECTIVE_MIGRATION = ROOT / "supabase/migrations/079_team_directive_events_atomic.sql"
MIGRATION = ROOT / "supabase/migrations/080_profile_snapshot_atomic.sql"
IMAGE = "postgres:16-alpine"
USER_1 = "00000000-0000-0000-0000-000000000085"
USER_2 = "00000000-0000-0000-0000-000000000086"


def _run(argv, *, input_text=None, check=True, timeout=30):
    return subprocess.run(
        argv,
        input=input_text,
        text=True,
        capture_output=True,
        check=check,
        timeout=timeout,
    )


@pytest.fixture(scope="module")
def postgres16():
    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    if _run(["docker", "image", "inspect", IMAGE], check=False).returncode:
        pytest.skip(f"immagine locale {IMAGE} non disponibile")

    name = f"jht-profile-atomic-{uuid.uuid4().hex[:10]}"
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
            CREATE ROLE authenticated LOGIN;
            CREATE ROLE service_role LOGIN BYPASSRLS;
            CREATE SCHEMA auth;
            CREATE TABLE auth.users (id UUID PRIMARY KEY);
            INSERT INTO auth.users VALUES ('{USER_1}'), ('{USER_2}');
            CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$
              SELECT NULLIF(current_setting('request.jwt.claim.sub', TRUE), '')::UUID
            $$;

            CREATE TABLE public.positions (id UUID PRIMARY KEY);
            CREATE TABLE public.pending_user_messages (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
              legacy_id BIGINT NOT NULL, agent TEXT NOT NULL, body TEXT NOT NULL,
              kind TEXT NOT NULL DEFAULT 'notification', delivered_via TEXT,
              delivered_at TIMESTAMPTZ, acknowledged_at TIMESTAMPTZ,
              user_reply TEXT, user_reply_at TIMESTAMPTZ,
              author TEXT NOT NULL DEFAULT 'agent',
              created_at TIMESTAMPTZ DEFAULT now(), UNIQUE (user_id, legacy_id)
            );
            CREATE TABLE public.team_directives (
              id BIGSERIAL PRIMARY KEY,
              user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
              body TEXT NOT NULL, kind TEXT, status TEXT, created_by TEXT,
              archived_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE TABLE public.team_state (
              user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
              chat_requested_at TIMESTAMPTZ
            );

            CREATE TABLE public.candidate_profiles (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              user_id UUID NOT NULL REFERENCES auth.users(id),
              name TEXT NOT NULL, email TEXT, location TEXT,
              birth_year INTEGER, nationality TEXT,
              work_authorization JSONB DEFAULT '[]', target_role TEXT,
              experience_months INTEGER DEFAULT 0,
              experience_years INTEGER DEFAULT 0,
              has_degree BOOLEAN DEFAULT FALSE, languages JSONB DEFAULT '[]',
              skills JSONB DEFAULT '[]', seniority_target TEXT,
              job_titles JSONB DEFAULT '[]',
              location_preferences JSONB DEFAULT '[]',
              salary_target JSONB DEFAULT '{{}}', positioning JSONB DEFAULT '{{}}',
              timezone TEXT, industry TEXT, schema_version SMALLINT DEFAULT 1,
              created_at TIMESTAMPTZ DEFAULT now(),
              updated_at TIMESTAMPTZ DEFAULT now(), UNIQUE (user_id)
            );
            CREATE TABLE public.candidate_skills (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
              name TEXT NOT NULL, category TEXT NOT NULL CHECK (category IN ('primary','secondary')),
              ord INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(),
              updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE TABLE public.candidate_languages (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
              language TEXT NOT NULL, level TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0,
              created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE TABLE public.candidate_experiences (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
              company TEXT NOT NULL, role TEXT NOT NULL, period TEXT,
              start_date TEXT, end_date TEXT, location TEXT, summary TEXT,
              ord INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now(),
              updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE TABLE public.candidate_education (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
              kind TEXT NOT NULL CHECK (kind IN ('education','certification')),
              institution TEXT NOT NULL, degree TEXT, year TEXT, period TEXT,
              location TEXT, details TEXT, ord INTEGER NOT NULL DEFAULT 0,
              created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE TABLE public.candidate_work_authorization (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
              region TEXT NOT NULL, status TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0,
              created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE TABLE public.candidate_location_preferences (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
              value TEXT NOT NULL, ord INTEGER NOT NULL DEFAULT 0,
              created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
            );
            CREATE TABLE public.candidate_blocks (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
              key TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN (
                'key_value','tag_list','timeline','narrative','key_points','distribution'
              )), title TEXT NOT NULL, content JSONB NOT NULL DEFAULT '[]',
              ord INTEGER NOT NULL DEFAULT 0, source TEXT,
              created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(),
              UNIQUE (user_id, key)
            );
            CREATE TABLE public.candidate_contacts (
              user_id UUID PRIMARY KEY, email TEXT, phone TEXT, linkedin TEXT,
              github TEXT, website TEXT, address TEXT,
              created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
            );
            GRANT USAGE ON SCHEMA public TO service_role;
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
            """
        )
        # Exercise the real release order itself, not migration 080 in
        # isolation: O-80 owns 079 and O-85 must remain applicable after it.
        psql(WRITER_MIGRATION.read_text(encoding="utf-8"))
        psql(DIRECTIVE_MIGRATION.read_text(encoding="utf-8"))
        # Reapplication is part of the contract: release retries must be safe.
        psql(MIGRATION.read_text(encoding="utf-8"))
        psql(MIGRATION.read_text(encoding="utf-8"))
        psql(
            """
            CREATE TABLE public.profile_effect_counts (
              user_id UUID NOT NULL, table_name TEXT NOT NULL,
              operation TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
              PRIMARY KEY (user_id, table_name, operation)
            );
            GRANT SELECT, INSERT, UPDATE ON public.profile_effect_counts TO service_role;
            CREATE FUNCTION public.count_profile_effect() RETURNS trigger
            LANGUAGE plpgsql AS $$
            DECLARE owner UUID := COALESCE(NEW.user_id, OLD.user_id);
            BEGIN
              INSERT INTO public.profile_effect_counts VALUES
                (owner, TG_TABLE_NAME, TG_OP, 1)
              ON CONFLICT (user_id, table_name, operation)
              DO UPDATE SET n = profile_effect_counts.n + 1;
              RETURN COALESCE(NEW, OLD);
            END;
            $$;
            DO $$
            DECLARE table_name TEXT;
            BEGIN
              FOREACH table_name IN ARRAY ARRAY[
                'candidate_profiles','candidate_skills','candidate_languages',
                'candidate_experiences','candidate_education',
                'candidate_work_authorization','candidate_location_preferences',
                'candidate_blocks','candidate_contacts'
              ] LOOP
                EXECUTE format(
                  'CREATE TRIGGER count_effect AFTER INSERT OR UPDATE OR DELETE ON %I '
                  'FOR EACH ROW EXECUTE FUNCTION public.count_profile_effect()',
                  table_name
                );
              END LOOP;
            END $$;
            """
        )
        psql.container_name = name
        yield psql
    finally:
        _run(["docker", "rm", "--force", name], check=False)


def _snapshot(name: str, *, skill_category: str = "primary") -> dict:
    return {
        "profile": {
            "name": name,
            "email": "synthetic@example.invalid",
            "target_role": "Engineer",
            "experience_years": 4,
            "has_degree": True,
            "languages": [{"language": "English", "level": "C1"}],
            "skills": {"primary": ["Python"]},
            "schema_version": 1,
            "positioning": {},
        },
        "skills": [
            {"name": "Python", "category": skill_category, "ord": 0}
        ],
        "languages": [{"language": "English", "level": "C1", "ord": 0}],
        "experiences": [],
        "education": [],
        "work_auth": [],
        "location_preferences": [],
        "contacts": {"email": "synthetic@example.invalid"},
        "blocks": [],
    }


def _hash(snapshot: dict) -> str:
    raw = json.dumps(snapshot, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def _rpc_sql(user_id: str, snapshot: dict, content_hash: str | None = None) -> str:
    payload = json.dumps(snapshot, separators=(",", ":"))
    digest = content_hash or _hash(snapshot)
    return (
        "SELECT public.sync_candidate_profile_atomic("
        f"'{user_id}', '{digest}', $json${payload}$json$::jsonb);"
    )


def _effects(psql, user_id: str) -> int:
    out = psql(
        f"SELECT COALESCE(sum(n), 0) FROM public.profile_effect_counts "
        f"WHERE user_id = '{user_id}';",
        role="service_role",
    )
    return int(out.stdout.strip())


def _state(psql, user_id: str) -> str:
    return psql(
        f"""
        SELECT jsonb_build_object(
          'profile', (SELECT jsonb_build_object(
              'name', name, 'hash', sync_hash, 'updated_at', updated_at
            ) FROM public.candidate_profiles WHERE user_id = '{user_id}'),
          'skills', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id', id, 'name', name, 'category', category, 'ord', ord
            ) ORDER BY ord), '[]') FROM public.candidate_skills
            WHERE user_id = '{user_id}')
        )::text;
        """,
        role="service_role",
    ).stdout.strip()


def test_noop_has_zero_writes_and_real_change_is_idempotent(postgres16):
    psql = postgres16
    first = _snapshot("Synthetic One")
    assert json.loads(psql(_rpc_sql(USER_1, first), role="service_role").stdout)[
        "changed"
    ] is True
    before_effects = _effects(psql, USER_1)
    before_state = _state(psql, USER_1)

    repeated = json.loads(psql(_rpc_sql(USER_1, first), role="service_role").stdout)
    assert repeated == {"changed": False}
    assert _effects(psql, USER_1) == before_effects
    assert _state(psql, USER_1) == before_state

    changed = _snapshot("Synthetic Two")
    assert json.loads(psql(_rpc_sql(USER_1, changed), role="service_role").stdout)[
        "changed"
    ] is True
    assert "Synthetic Two" in _state(psql, USER_1)
    changed_effects = _effects(psql, USER_1)
    assert changed_effects > before_effects
    assert json.loads(psql(_rpc_sql(USER_1, changed), role="service_role").stdout) == {
        "changed": False
    }
    assert _effects(psql, USER_1) == changed_effects


def test_failure_rolls_back_core_and_every_child(postgres16):
    psql = postgres16
    before_state = _state(psql, USER_1)
    before_effects = _effects(psql, USER_1)
    invalid = _snapshot("Must Roll Back", skill_category="invalid")
    failed = psql(_rpc_sql(USER_1, invalid), role="service_role", check=False)
    assert failed.returncode != 0
    assert _state(psql, USER_1) == before_state
    assert _effects(psql, USER_1) == before_effects


def test_overlapping_same_snapshot_writes_once(postgres16):
    psql = postgres16
    psql(
        f"""
        CREATE FUNCTION public.slow_profile_insert() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.user_id = '{USER_2}' THEN PERFORM pg_sleep(0.5); END IF;
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER slow_profile BEFORE INSERT ON public.candidate_profiles
        FOR EACH ROW EXECUTE FUNCTION public.slow_profile_insert();
        """
    )
    sql = _rpc_sql(USER_2, _snapshot("Concurrent Synthetic"))
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
    ]
    first = subprocess.Popen(
        argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True
    )
    assert first.stdin is not None
    first.stdin.write(sql)
    first.stdin.close()
    time.sleep(0.1)
    second = _run(argv, input_text=sql, timeout=10)
    first.wait(timeout=10)
    assert first.returncode == 0
    assert first.stdout is not None
    outcomes = [json.loads(first.stdout.read()), json.loads(second.stdout)]
    assert sorted(item["changed"] for item in outcomes) == [False, True]
    assert _effects(psql, USER_2) == 4  # core + skill + language + contacts
    assert psql(
        f"SELECT count(*) FROM public.candidate_profiles WHERE user_id='{USER_2}';",
        role="service_role",
    ).stdout.strip() == "1"


def test_rpc_is_service_role_only(postgres16):
    denied = postgres16(
        _rpc_sql(USER_1, _snapshot("Denied")), role="authenticated", check=False
    )
    assert denied.returncode != 0
    assert "permission denied" in denied.stderr.lower()


def test_release_migration_sequence_and_prefix_census(postgres16):
    migrations = sorted((ROOT / "supabase/migrations").glob("[0-9][0-9][0-9]_*.sql"))
    by_prefix: dict[str, list[str]] = {}
    for migration in migrations:
        by_prefix.setdefault(migration.name[:3], []).append(migration.name)
    collisions = {prefix: names for prefix, names in by_prefix.items() if len(names) > 1}
    assert collisions == {}
    assert MIGRATION.name == "080_profile_snapshot_atomic.sql"

    contracts = postgres16(
        """
        SELECT EXISTS (
                 SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='positions'
                    AND column_name='write_request_kind'
               ),
               to_regprocedure(
                 'public.mutate_team_directive_with_event(bigint,text,text,text,text)'
               ) IS NOT NULL,
               to_regprocedure(
                 'public.sync_candidate_profile_atomic(uuid,text,jsonb)'
               ) IS NOT NULL;
        """
    ).stdout.strip()
    assert contracts == "t|t|t"

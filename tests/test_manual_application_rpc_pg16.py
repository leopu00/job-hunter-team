"""Executable PostgreSQL-16 oracle for the manual-application RPC hotfix."""
from __future__ import annotations

import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
MIGRATION = ROOT / "supabase/migrations/077_application_mark_undo_hotfix.sql"
IMAGE = "postgres:16-alpine"


def _run(args, *, input_text=None, check=True):
    return subprocess.run(args, input=input_text, text=True, capture_output=True, check=check, timeout=45)


@pytest.fixture(scope="module")
def pg16():
    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    if _run(["docker", "image", "inspect", IMAGE], check=False).returncode:
        pytest.skip("immagine postgres:16-alpine non disponibile")
    name = f"jht-click-oracle-{uuid.uuid4().hex[:10]}"
    started = _run(["docker", "run", "--detach", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD=synthetic", IMAGE], check=False)
    if started.returncode:
        pytest.skip(started.stderr.strip())

    def psql(sql: str, *, check=True):
        return _run(["docker", "exec", "-i", name, "psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres", "-At", "-F", "|"], input_text=sql, check=check)

    try:
        for _ in range(60):
            if _run(["docker", "exec", name, "pg_isready", "-U", "postgres"], check=False).returncode == 0:
                break
            time.sleep(0.2)
        else:
            pytest.skip("postgres non pronto")
        yield psql
    finally:
        _run(["docker", "rm", "--force", name], check=False)


SCHEMA = """
CREATE SCHEMA auth;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.positions (id uuid PRIMARY KEY, user_id uuid NOT NULL, legacy_id integer UNIQUE NOT NULL, status text, last_actor text);
CREATE TABLE public.applications (id serial PRIMARY KEY, user_id uuid NOT NULL, position_id uuid UNIQUE NOT NULL, status text, applied boolean, applied_at timestamptz, applied_via text, critic_notes text, cv_path text, cv_pdf_path text);
CREATE TABLE public.position_transitions (id serial PRIMARY KEY, user_id uuid NOT NULL, position_legacy_id integer, from_state text, to_state text, ts timestamptz, by_agent text, notes text, UNIQUE(user_id, position_legacy_id, ts, by_agent, to_state));
CREATE TABLE public.scores (id serial PRIMARY KEY, user_id uuid NOT NULL, position_id uuid NOT NULL);
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.positions, public.applications, public.position_transitions, public.scores TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.position_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY positions_owner ON public.positions FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY applications_owner ON public.applications FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY transitions_owner ON public.position_transitions FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY scores_owner ON public.scores FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
"""


def test_pg16_apply_reapply_click_undo_tenant_and_privileges(pg16):
    owner = "11111111-1111-1111-1111-111111111111"
    other = "22222222-2222-2222-2222-222222222222"
    pos = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    pg16(SCHEMA)
    before = pg16("SELECT to_regprocedure('public.mark_position_applied(integer,timestamptz,text,text)') IS NULL;").stdout.strip()
    assert before == "t"
    sql = MIGRATION.read_text()
    pg16(sql)
    # Supabase grants newly-created public RPCs to every API role. The
    # migration must remove those explicit grants as well as PUBLIC on reapply.
    pg16("GRANT EXECUTE ON FUNCTION public.mark_position_applied(integer,timestamptz,text,text), public.undo_manual_position_application(integer,text) TO anon, service_role;")
    pg16(sql)  # reapply must be harmless
    privileges = pg16("SELECT has_function_privilege('anon','public.mark_position_applied(integer,timestamptz,text,text)','execute'), has_function_privilege('authenticated','public.mark_position_applied(integer,timestamptz,text,text)','execute'), has_function_privilege('service_role','public.mark_position_applied(integer,timestamptz,text,text)','execute');").stdout.strip()
    assert privileges == "f|t|f"
    pg16(f"INSERT INTO public.positions VALUES ('{pos}','{owner}',73,'ready',NULL), ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','{other}',73+1,'ready',NULL);")
    for role in ("anon", "service_role"):
        denied = pg16(f"SET ROLE {role}; SELECT public.mark_position_applied(73,'2026-08-13T12:00:00Z','user_manual','synthetic');", check=False)
        assert denied.returncode != 0 and "permission denied" in denied.stderr.lower()
    tenant = pg16(f"SET ROLE authenticated; SET request.jwt.claim.sub='{other}'; SELECT public.mark_position_applied(73,'2026-08-13T12:00:00Z','user_manual','synthetic');", check=False)
    assert tenant.returncode != 0 and "position_not_found" in tenant.stderr
    assert pg16("SELECT status FROM public.positions WHERE legacy_id=73;").stdout.strip() == "ready"
    apply_sql = f"SET ROLE authenticated; SET request.jwt.claim.sub='{owner}'; SELECT public.mark_position_applied(73,'2026-08-13T12:00:00Z','user_manual','synthetic'); SELECT public.mark_position_applied(73,'2026-08-13T12:01:00Z','user_manual','synthetic');"
    applied = pg16(apply_sql).stdout.strip().splitlines()
    assert len(applied) == 2 and all('"status": "applied"' in row or '"status":"applied"' in row for row in applied)
    assert pg16("SELECT p.status, a.applied, a.applied_via FROM public.positions p JOIN public.applications a ON a.position_id=p.id WHERE p.legacy_id=73;").stdout.strip() == "applied|t|user_manual"
    for role in ("anon", "service_role"):
        denied = pg16(f"SET ROLE {role}; SELECT public.undo_manual_position_application(73,'ready');", check=False)
        assert denied.returncode != 0 and "permission denied" in denied.stderr.lower()
        assert pg16("SELECT status FROM public.positions WHERE legacy_id=73;").stdout.strip() == "applied"
    tenant_undo = pg16(f"SET ROLE authenticated; SET request.jwt.claim.sub='{other}'; SELECT public.undo_manual_position_application(73,'ready');", check=False)
    assert tenant_undo.returncode != 0 and "position_not_found" in tenant_undo.stderr
    assert pg16("SELECT status FROM public.positions WHERE legacy_id=73;").stdout.strip() == "applied"
    undone = pg16(f"SET ROLE authenticated; SET request.jwt.claim.sub='{owner}'; SELECT public.undo_manual_position_application(73,'ready');").stdout.strip()
    assert '"status": "ready"' in undone or '"status":"ready"' in undone
    assert pg16("SELECT status FROM public.positions WHERE user_id='" + owner + "' AND legacy_id=73;").stdout.strip() == "ready"
    assert pg16("SELECT status FROM public.positions WHERE user_id='" + other + "' AND legacy_id=74;").stdout.strip() == "ready"

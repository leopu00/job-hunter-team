"""Executable PG16 gate for the 076 -> 077 -> 079 migration sequence."""
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]


@pytest.fixture()
def psql():
    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    name = f"jht-o80-{uuid.uuid4().hex[:8]}"
    run = lambda args, **kw: subprocess.run(args, text=True, capture_output=True, check=kw.get("check", True), input=kw.get("input"))
    started = run(["docker", "run", "-d", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD=x", "postgres:16-alpine"], check=False)
    if started.returncode:
        pytest.skip(started.stderr)
    def sql(statement, check=True):
        return run(["docker", "exec", "-i", name, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-F", "|"], input=statement, check=check)
    try:
        stable = 0
        for _ in range(80):
            stable = stable + 1 if sql("select 1;", check=False).returncode == 0 else 0
            if stable >= 3:
                yield sql
                return
            time.sleep(.2)
        pytest.skip("postgres non pronto")
    finally:
        run(["docker", "rm", "-f", name], check=False)


SCHEMA = """
CREATE SCHEMA auth; CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE positions(id uuid primary key,user_id uuid not null,legacy_id int unique,status text,last_actor text);
CREATE TABLE applications(id serial primary key,user_id uuid not null,position_id uuid unique,status text,applied boolean,applied_at timestamptz,applied_via text,critic_notes text);
CREATE TABLE scores(id serial primary key,user_id uuid not null,position_id uuid not null);
CREATE TABLE position_transitions(id serial primary key,user_id uuid not null,position_legacy_id int,from_state text,to_state text,ts timestamptz,by_agent text,notes text,unique(user_id,position_legacy_id,ts,by_agent,to_state));
CREATE TABLE pending_user_messages(id serial primary key,user_id uuid,agent text,body text,kind text,author text,source_id text,created_at timestamptz);
CREATE UNIQUE INDEX pending_user_messages_source_id_unique ON pending_user_messages(user_id, source_id);
CREATE TABLE team_directives(id bigserial primary key,user_id uuid,body text,kind text,status text,created_by text,archived_at timestamptz,updated_at timestamptz);
CREATE TABLE team_state(user_id uuid primary key,chat_requested_at timestamptz);
GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT SELECT,INSERT,UPDATE ON positions,applications,scores,position_transitions,pending_user_messages,team_directives,team_state TO authenticated;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
"""


def test_sequence_reapply_and_tenant_event(psql):
    psql(SCHEMA)
    for name in ("076_application_sync_identity.sql", "077_application_mark_undo_hotfix.sql", "079_team_directive_events_atomic.sql"):
        psql((ROOT / "supabase/migrations" / name).read_text())
    psql((ROOT / "supabase/migrations/079_team_directive_events_atomic.sql").read_text())
    owner = "11111111-1111-1111-1111-111111111111"
    psql(f"INSERT INTO positions VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','{owner}',73,'ready',NULL);")
    result = psql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{owner}'; SELECT public.mutate_team_directive_with_event(0,'created','synthetic','stable-source'); SELECT public.mutate_team_directive_with_event(1,'archived',NULL,'stable-source-archive');").stdout
    assert 'queued' in result
    assert psql("SELECT count(*) FROM pending_user_messages WHERE source_id='stable-source';").stdout.strip() == '1'
    repeat = psql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{owner}'; SELECT public.mutate_team_directive_with_event(0,'created','synthetic','stable-source');").stdout
    assert 'queued' in repeat
    assert psql("SELECT count(*) FROM pending_user_messages WHERE source_id='stable-source';").stdout.strip() == '1'
    denied = psql("RESET ROLE; SELECT public.mutate_team_directive_with_event(1,'edited','bad','other');", check=False)
    assert denied.returncode != 0 and "invalid directive event" in denied.stderr

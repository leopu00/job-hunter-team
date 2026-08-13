"""Real PostgreSQL 16 oracles for O-80 exact-once directive events."""
import concurrent.futures
import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
OWNER = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"
RPC = "public.mutate_team_directive_with_event"


@pytest.fixture(scope="module")
def pg16_server():
    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    name = f"jht-o80-{uuid.uuid4().hex[:8]}"

    def run(args, **kwargs):
        return subprocess.run(
            args, text=True, capture_output=True,
            check=kwargs.get("check", True), input=kwargs.get("input"),
        )

    started = run([
        "docker", "run", "-d", "--rm", "--name", name,
        "--tmpfs", "/var/lib/postgresql/data:rw,size=512m",
        "-e", "POSTGRES_PASSWORD=x", "postgres:16-alpine",
    ], check=False)
    if started.returncode:
        pytest.fail(f"postgres:16 non avviato: {started.stderr}")

    def sql(statement, check=True, database="postgres"):
        return run([
            "docker", "exec", "-i", name, "psql", "-U", "postgres",
            "-d", database, "-v", "ON_ERROR_STOP=1", "-At", "-F", "|",
        ], input=statement, check=check)

    try:
        for _ in range(100):
            if sql("select 1;", check=False).returncode == 0:
                sql(
                    "CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; "
                    "CREATE ROLE service_role NOLOGIN BYPASSRLS;"
                )
                yield sql
                return
            time.sleep(.2)
        logs = run(["docker", "logs", name], check=False).stderr
        pytest.fail(f"postgres:16 non pronto: {logs}")
    finally:
        run(["docker", "rm", "-f", name], check=False)


SCHEMA = f"""
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
INSERT INTO auth.users VALUES ('{OWNER}'), ('{OTHER}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;

CREATE TABLE positions(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  legacy_id int, status text, last_actor text, write_request_kind text
);
CREATE UNIQUE INDEX positions_user_legacy ON positions(user_id,legacy_id);
CREATE TABLE applications(
  id uuid primary key default gen_random_uuid(), user_id uuid not null, position_id uuid unique,
  legacy_id int, cv_path text, cv_pdf_path text, cl_path text, cl_pdf_path text,
  status text, critic_score real, critic_verdict text, critic_notes text, critic_round int,
  written_at timestamptz, applied_at timestamptz, applied_via text, response text,
  response_at timestamptz, written_by text, reviewed_by text, critic_reviewed_at timestamptz,
  applied boolean, cv_drive_id text, cl_drive_id text
);
CREATE TABLE scores(id uuid primary key default gen_random_uuid(),user_id uuid,position_id uuid,legacy_id int);
CREATE TABLE position_transitions(
  id bigserial primary key,user_id uuid,position_legacy_id int,from_state text,to_state text,
  ts timestamptz,by_agent text,notes text,unique(user_id,position_legacy_id,ts,by_agent,to_state)
);
CREATE TABLE pending_user_messages(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  legacy_id bigint not null, agent text not null, body text not null,
  kind text not null default 'notification', related_position_id uuid,
  delivered_via text, delivered_at timestamptz, acknowledged_at timestamptz,
  user_reply text, user_reply_at timestamptz, agent_seen_reply_at timestamptz,
  author text not null default 'agent', chat_ts double precision,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique(user_id,legacy_id)
);
CREATE TABLE team_directives(
  id bigserial primary key,user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,kind text,status text,sort_order int default 0,created_by text,
  created_at timestamptz default now(),archived_at timestamptz,updated_at timestamptz default now()
);
CREATE TABLE team_state(user_id uuid primary key references auth.users(id) on delete cascade,chat_requested_at timestamptz);

ALTER TABLE pending_user_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY pending_select ON pending_user_messages FOR SELECT TO authenticated USING (auth.uid()=user_id);
CREATE POLICY pending_insert ON pending_user_messages FOR INSERT TO authenticated
  WITH CHECK (auth.uid()=user_id AND author='user' AND legacy_id<0);
CREATE POLICY pending_update ON pending_user_messages FOR UPDATE TO authenticated
  USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);
ALTER TABLE team_directives ENABLE ROW LEVEL SECURITY;
CREATE POLICY directive_select ON team_directives FOR SELECT TO authenticated USING (auth.uid()=user_id);
CREATE POLICY directive_insert ON team_directives FOR INSERT TO authenticated WITH CHECK (auth.uid()=user_id);
CREATE POLICY directive_update ON team_directives FOR UPDATE TO authenticated
  USING (auth.uid()=user_id) WITH CHECK (auth.uid()=user_id);

GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon,service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated,anon,service_role;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated,anon,service_role;
"""


def call(user, request_id, action, target=0, body=None, kind=None):
    body_sql = "NULL" if body is None else "'" + body.replace("'", "''") + "'"
    kind_sql = "NULL" if kind is None else "'" + kind + "'"
    return (
        f"SET ROLE authenticated; SET request.jwt.claim.sub='{user}'; "
        f"SELECT {RPC}({target},'{action}',{body_sql},{kind_sql},'{request_id}');"
    )


def parsed(result):
    return json.loads([line for line in result.stdout.splitlines() if line.startswith("{")][-1])


def scalar(psql, statement):
    return [line for line in psql(statement).stdout.splitlines() if line][-1]


@pytest.fixture()
def migrated(pg16_server):
    database = f"o80_{uuid.uuid4().hex[:12]}"
    pg16_server(f'CREATE DATABASE "{database}";')

    def psql(statement, check=True):
        return pg16_server(statement, check=check, database=database)

    psql(SCHEMA)
    for name in (
        "076_application_sync_identity.sql",
        "077_application_mark_undo_hotfix.sql",
        "078_positions_write_request_kind.sql",
        "079_team_directive_events_atomic.sql",
    ):
        psql((ROOT / "supabase/migrations" / name).read_text())
    psql((ROOT / "supabase/migrations/079_team_directive_events_atomic.sql").read_text())
    try:
        yield psql
    finally:
        pg16_server(
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='{database}'; "
            f'DROP DATABASE "{database}";',
            check=False,
        )


def assert_tuple(psql, request_id, action, target_body=None):
    ledger = parsed(psql(
        "SELECT jsonb_build_object('id',request_id,'action',action,'target',target_id,"
        "'payload',payload,'kind',kind,'result',result) "
        f"FROM team_directive_request_ledger WHERE request_id='{request_id}';"
    ))
    assert ledger["action"] == action and ledger["result"]["request_id"] == request_id
    event = parsed(psql(
        "SELECT jsonb_build_object('action',source_action,'payload',source_payload,"
        "'target',source_directive_id,'body',body,'legacy',legacy_id) "
        f"FROM pending_user_messages WHERE source_id='team-directive:{request_id}';"
    ))
    assert event["action"] == action
    assert event["payload"] == target_body
    assert event["body"] == f"[TEAM-DIRECTIVE] {action}"
    if target_body and len(target_body) > 1:
        assert target_body not in event["body"]
    assert event["legacy"] < 0 and abs(event["legacy"]) < 9_007_199_254_740_991


def test_replay_mismatch_semantic_repeat_and_atomic_results(migrated):
    psql = migrated
    created = parsed(psql(call(OWNER, "create-1", "created", body="same", kind="strategy")))
    replay = parsed(psql(call(OWNER, "create-1", "created", body="same", kind="strategy")))
    assert replay == created
    assert scalar(psql, "SELECT kind FROM team_directives WHERE id=%s;" % created["id"]) == "strategy"
    mismatch = psql(call(OWNER, "create-1", "created", body="same", kind="note"), check=False)
    assert mismatch.returncode and "request id payload mismatch" in mismatch.stderr
    repeated = parsed(psql(call(OWNER, "create-2", "created", body="same", kind="strategy")))
    assert repeated["id"] != created["id"]

    for request_id, body in (("edit-b-1", "B"), ("edit-c", "C"), ("edit-b-2", "B")):
        result = parsed(psql(call(OWNER, request_id, "edited", created["id"], body)))
        assert parsed(psql(call(OWNER, request_id, "edited", created["id"], body))) == result
        assert_tuple(psql, request_id, "edited", body)
    assert scalar(psql, f"SELECT body FROM team_directives WHERE id={created['id']};") == "B"
    mismatch = psql(call(OWNER, "edit-b-2", "edited", created["id"], "other"), check=False)
    assert mismatch.returncode and "request id payload mismatch" in mismatch.stderr

    archived = parsed(psql(call(OWNER, "archive-1", "archived", created["id"])))
    assert parsed(psql(call(OWNER, "archive-1", "archived", created["id"]))) == archived
    assert scalar(psql, f"SELECT status FROM team_directives WHERE id={created['id']};") == "archived"
    second_archive = psql(call(OWNER, "archive-2", "archived", created["id"]), check=False)
    assert second_archive.returncode and "directive not found" in second_archive.stderr
    assert scalar(psql, "SELECT count(*) FROM team_directive_request_ledger WHERE request_id='archive-2';") == "0"

    for request_id, action, body in (
        ("create-1", "created", "same"), ("create-2", "created", "same"),
        ("archive-1", "archived", None),
    ):
        assert_tuple(psql, request_id, action, body)
    assert scalar(psql, f"SELECT count(*) FROM pending_user_messages WHERE source_directive_id={created['id']};") == "5"
    assert scalar(psql, f"SELECT (chat_requested_at IS NOT NULL)::int FROM team_state WHERE user_id='{OWNER}';") == "1"


@pytest.mark.parametrize("action", ["created", "edited", "archived"])
def test_event_failure_rolls_back_claim_effect_event_and_result(migrated, action):
    psql = migrated
    target = 0
    if action != "created":
        target = parsed(psql(call(OWNER, f"seed-{action}", "created", body="before", kind="order")))["id"]
    psql("""
      CREATE FUNCTION fail_o80_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.source_id='team-directive:will-rollback' THEN
        RAISE EXCEPTION 'synthetic event failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_o80_event BEFORE INSERT ON pending_user_messages
        FOR EACH ROW EXECUTE FUNCTION fail_o80_event();
    """)
    result = psql(call(
        OWNER, "will-rollback", action, target,
        None if action == "archived" else ("new" if action == "created" else "after"),
        "order" if action == "created" else None,
    ), check=False)
    assert result.returncode and "synthetic event failure" in result.stderr
    assert scalar(psql, "SELECT count(*) FROM team_directive_request_ledger WHERE request_id='will-rollback';") == "0"
    assert scalar(psql, "SELECT count(*) FROM pending_user_messages WHERE source_id='team-directive:will-rollback';") == "0"
    if action == "created":
        assert scalar(psql, "SELECT count(*) FROM team_directives WHERE body='new';") == "0"
    else:
        assert scalar(psql, f"SELECT body||'|'||status FROM team_directives WHERE id={target};") == "before|active"


@pytest.mark.parametrize("action", ["created", "edited", "archived"])
def test_concurrent_calls_return_one_committed_effect(migrated, action):
    psql = migrated
    target = 0
    if action != "created":
        target = parsed(psql(call(OWNER, f"seed-concurrent-{action}", "created", body="before", kind="order")))["id"]
    psql("""
      CREATE TABLE mutation_audit(action text);
      CREATE FUNCTION audit_directive() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='INSERT' THEN INSERT INTO public.mutation_audit VALUES('created');
        ELSIF NEW.status='archived' AND OLD.status='active' THEN INSERT INTO public.mutation_audit VALUES('archived');
        ELSIF NEW.body IS DISTINCT FROM OLD.body THEN INSERT INTO public.mutation_audit VALUES('edited'); END IF;
        PERFORM pg_sleep(.25); RETURN NEW;
      END $$;
      CREATE TRIGGER audit_directive_insert AFTER INSERT ON team_directives FOR EACH ROW EXECUTE FUNCTION audit_directive();
      CREATE TRIGGER audit_directive_update AFTER UPDATE ON team_directives FOR EACH ROW EXECUTE FUNCTION audit_directive();
    """)
    request_id = f"concurrent-{action}"
    statement = call(
        OWNER, request_id, action, target,
        None if action == "archived" else ("new" if action == "created" else "after"),
        "order" if action == "created" else None,
    )
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: psql(statement), range(2)))
    receipts = [parsed(result) for result in results]
    assert receipts[0] == receipts[1]
    assert scalar(psql, f"SELECT count(*) FROM mutation_audit WHERE action='{action}';") == "1"
    assert scalar(psql, f"SELECT count(*) FROM pending_user_messages WHERE source_id='team-directive:{request_id}';") == "1"
    assert_tuple(psql, request_id, action, None if action == "archived" else ("new" if action == "created" else "after"))


def test_acl_tenant_isolation_and_direct_write_bypass_are_closed(migrated):
    psql = migrated
    created = parsed(psql(call(OWNER, "owner-create", "created", body="owner", kind="order")))
    assert scalar(psql, "SELECT has_function_privilege('authenticated','public.mutate_team_directive_with_event(bigint,text,text,text,text)','EXECUTE')::int;") == "1"
    for role in ("anon", "service_role"):
        assert scalar(psql, f"SELECT has_function_privilege('{role}','public.mutate_team_directive_with_event(bigint,text,text,text,text)','EXECUTE')::int;") == "0"
        denied = psql(f"SET ROLE {role}; SELECT {RPC}(0,'created','bad','order','bad');", check=False)
        assert denied.returncode and "permission denied" in denied.stderr

    assert scalar(
        psql,
        "SET ROLE service_role; SELECT count(*) FROM team_directive_request_ledger;",
    ) == "1"
    for statement in (
        f"INSERT INTO team_directive_request_ledger(user_id,request_id,action,target_id) VALUES('{OWNER}','forged','created',0);",
        "UPDATE team_directive_request_ledger SET result='{}'::jsonb;",
        "DELETE FROM team_directive_request_ledger;",
    ):
        denied = psql(f"SET ROLE service_role; {statement}", check=False)
        assert denied.returncode and "permission denied" in denied.stderr

    for statement in (
        f"INSERT INTO team_directives(user_id,body,kind,status,created_by) VALUES('{OWNER}','bypass','order','active','user');",
        f"UPDATE team_directives SET body='bypass' WHERE id={created['id']};",
        "SELECT * FROM team_directive_request_ledger;",
    ):
        denied = psql(f"SET ROLE authenticated; SET request.jwt.claim.sub='{OWNER}'; {statement}", check=False)
        assert denied.returncode and "permission denied" in denied.stderr

    denied = psql(call(OTHER, "tenant-edit", "edited", created["id"], "stolen"), check=False)
    assert denied.returncode and "directive not found" in denied.stderr
    assert scalar(psql, "SELECT count(*) FROM team_directive_request_ledger WHERE request_id='tenant-edit';") == "0"
    assert scalar(psql, f"SELECT body FROM team_directives WHERE id={created['id']};") == "owner"

    message_id = scalar(psql, f"SELECT id FROM pending_user_messages WHERE source_id='team-directive:owner-create';")
    psql(
        f"SET ROLE authenticated; SET request.jwt.claim.sub='{OWNER}'; "
        f"UPDATE pending_user_messages SET delivered_at=now(),acknowledged_at=now(),"
        f"user_reply='ok',user_reply_at=now() WHERE id='{message_id}';"
    )
    denied = psql(
        f"SET ROLE authenticated; SET request.jwt.claim.sub='{OWNER}'; "
        f"UPDATE pending_user_messages SET source_action='forged' WHERE id='{message_id}';",
        check=False,
    )
    assert denied.returncode and "permission denied" in denied.stderr
    psql(f"DELETE FROM auth.users WHERE id='{OWNER}';")
    assert scalar(psql, f"SELECT count(*) FROM team_directive_request_ledger WHERE user_id='{OWNER}';") == "0"


def test_event_identity_collision_fails_closed(migrated):
    psql = migrated
    psql(f"""
      INSERT INTO pending_user_messages(user_id,legacy_id,agent,body,kind,author,source_id)
      VALUES('{OWNER}',-1,'capitano','legacy','notification','user','team-directive:collision');
    """)
    result = psql(call(OWNER, "collision", "created", body="must rollback", kind="order"), check=False)
    assert result.returncode and "directive request identity collision" in result.stderr
    assert scalar(psql, "SELECT count(*) FROM team_directives WHERE body='must rollback';") == "0"
    assert scalar(psql, "SELECT count(*) FROM team_directive_request_ledger WHERE request_id='collision';") == "0"


def test_request_id_boundary_and_result_failure_are_fail_closed(migrated):
    psql = migrated
    accepted = "a" * 180
    result = parsed(psql(call(OWNER, accepted, "created", body="boundary", kind="order")))
    assert result["request_id"] == accepted
    rejected = psql(
        call(OWNER, "b" * 181, "created", body="too long", kind="order"),
        check=False,
    )
    assert rejected.returncode and "invalid directive request id" in rejected.stderr

    psql("""
      CREATE FUNCTION fail_o80_result() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.request_id='result-rollback' AND NEW.result IS NOT NULL THEN
        RAISE EXCEPTION 'synthetic result failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fail_o80_result BEFORE UPDATE OF result ON team_directive_request_ledger
        FOR EACH ROW EXECUTE FUNCTION fail_o80_result();
    """)
    failed = psql(
        call(OWNER, "result-rollback", "created", body="must disappear", kind="order"),
        check=False,
    )
    assert failed.returncode and "synthetic result failure" in failed.stderr
    assert scalar(psql, "SELECT count(*) FROM team_directive_request_ledger WHERE request_id='result-rollback';") == "0"
    assert scalar(psql, "SELECT count(*) FROM team_directives WHERE body='must disappear';") == "0"
    assert scalar(psql, "SELECT count(*) FROM pending_user_messages WHERE source_id='team-directive:result-rollback';") == "0"


def test_concurrent_mismatch_has_one_winner_and_no_hybrid_effect(migrated):
    psql = migrated
    psql("""
      CREATE FUNCTION delay_o80_create() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(.25); RETURN NEW; END $$;
      CREATE TRIGGER delay_o80_create AFTER INSERT ON team_directives
        FOR EACH ROW EXECUTE FUNCTION delay_o80_create();
    """)
    statements = [
        call(OWNER, "concurrent-mismatch", "created", body=body, kind="order")
        for body in ("winner-a", "winner-b")
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(
            lambda statement: psql(statement, check=False), statements
        ))
    assert sorted(result.returncode == 0 for result in results) == [False, True]
    assert "request id payload mismatch" in next(
        result.stderr for result in results if result.returncode
    )
    assert scalar(psql, "SELECT count(*) FROM team_directives WHERE body IN ('winner-a','winner-b');") == "1"
    assert scalar(psql, "SELECT count(*) FROM pending_user_messages WHERE source_id='team-directive:concurrent-mismatch';") == "1"
    assert scalar(psql, "SELECT count(*) FROM team_directive_request_ledger WHERE request_id='concurrent-mismatch' AND result IS NOT NULL;") == "1"

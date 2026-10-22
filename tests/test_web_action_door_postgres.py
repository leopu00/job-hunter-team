"""JHT web capace, phase 2-a — migrations 098 (the single door) and 099 (the door by families).

The migration is run for real on PostgreSQL, from the file in supabase/migrations, twice (a migration
the operator applies by hand has to be safe to apply again). The database is shaped like the live one
where it matters to a boundary:
- the roles anon, authenticated and service_role exist, and a table or a function born in `public`
  is born with everything granted to them (the default privileges of the project): a REVOKE that
  forgot a grant would show here, as it would there;
- the tables the migration touches have the policies they have on the cloud (team_commands and
  team_state with their insert/update policies, positions and applications with the FOR ALL policy);
- the browser is played by `SET ROLE authenticated` plus the claims of a token in
  `request.jwt.claims`, one transaction per request, exactly as PostgREST does it.

What the migration owner is here (a superuser) differs from the live one (postgres, not a
superuser); nothing below depends on that difference: the definer functions only need the owner to
read what the browser roles cannot.

Two ways to the same server, like the other PostgreSQL tests of this repository:
- in CI there is the `postgres:16-alpine` service behind JHT_TEST_POSTGRES_URL: with the variable set
  this test never skips (a gate that skips where it has to run covers nothing);
- without it, a throwaway cluster (initdb in a temporary folder, a unix socket only, started with a log
  file) if the server binaries are on the machine, otherwise the test is skipped.

What must hold:
- a browser role cannot write team_commands, web_action_log, team_directives, the control fields of
  team_state, or truncate the tables of the notebook; anon cannot write anything of these;
- the door is executable by the signed-in role only; it answers with a code (it does not raise) to
  every refusal it expects;
- the vocabulary and its parameters are closed; a level 2 or 3 action needs a session that
  authenticated in the last fifteen minutes (by the `amr` of the token, or by the session);
- a confirmation is of one session and one action, is used once, and expires on the clock of the
  database; a confirmation of the position is checked again when it is used;
- the limits are counted on the log, per group, and an emergency stop is never blocked by them;
- the authorisation to apply is written only through the door, and only for a position that is `ready`
  and has not left: the rule of shared/cloud/apply-request-rule.json.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "098_web_action_door.sql"
MIGRATION_099 = ROOT / "supabase" / "migrations" / "099_web_action_families.sql"
LEVEL_OF = {"team.start": "L2", "team.stop": "L2", "team.restart": "L2", "team.emergency_stop": "L2",
            "position.apply_authorize": "L3", "position.apply_revoke": "L1"}
APPLY_RULE = json.loads((ROOT / "shared" / "cloud" / "apply-request-rule.json").read_text())
PSQL_FLAGS = ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"]

BOOTSTRAP = """
DO $$
DECLARE r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;
ALTER ROLE service_role BYPASSRLS;       -- as on the project: the box is not held back by the row policies

CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $f$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $f$ SELECT NULLIF(auth.jwt() ->> 'sub', '')::uuid $f$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid() TO anon, authenticated, service_role;

-- What the project does to everything born in `public`.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE TABLE public.positions (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  legacy_id integer,
  title text NOT NULL DEFAULT 'a title',
  company text NOT NULL DEFAULT 'a company',
  status text NOT NULL DEFAULT 'new',
  deleted_at timestamptz,
  write_requested boolean DEFAULT false,
  apply_requested boolean DEFAULT false,
  apply_requested_at timestamptz,
  apply_requested_by text);
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own data" ON public.positions FOR ALL USING ((SELECT auth.uid()) = user_id);

CREATE TABLE public.applications (
  id serial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position_id integer,
  applied boolean NOT NULL DEFAULT false,
  deleted_at timestamptz);
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own data" ON public.applications FOR ALL USING ((SELECT auth.uid()) = user_id);

CREATE TABLE public.scores (id serial PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id));
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own data" ON public.scores FOR ALL USING ((SELECT auth.uid()) = user_id);
CREATE TABLE public.candidate_profiles (id serial PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id));
ALTER TABLE public.candidate_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own data" ON public.candidate_profiles FOR ALL USING ((SELECT auth.uid()) = user_id);

CREATE TABLE public.team_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('start', 'stop', 'restart')),
  payload jsonb DEFAULT '{}'::jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error')));
ALTER TABLE public.team_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users select own team commands" ON public.team_commands FOR SELECT USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "users insert own team commands" ON public.team_commands FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "users update own team commands" ON public.team_commands FOR UPDATE
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE TABLE public.team_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  should_run boolean NOT NULL DEFAULT false,
  agents_enabled jsonb NOT NULL DEFAULT '{}'::jsonb,
  restart_token uuid,
  is_running boolean NOT NULL DEFAULT false,
  last_user_activity_at timestamptz,
  sync_requested_at timestamptz,
  chat_requested_at timestamptz,
  emergency_stop_requested_at timestamptz);
ALTER TABLE public.team_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users select own team state" ON public.team_state FOR SELECT USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "users insert own team state" ON public.team_state FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY "users update own team state" ON public.team_state FOR UPDATE
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE TABLE public.team_directives (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL DEFAULT '');
ALTER TABLE public.team_directives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users select own team directives" ON public.team_directives FOR SELECT USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "users insert own team directives" ON public.team_directives FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
-- 079 closed the writes of the browser roles on this one before 098:
REVOKE INSERT, UPDATE, DELETE ON public.team_directives FROM anon, authenticated;
"""


# A family of the tests: it stands for the ones that 100 and 101 will add. It does what the contract says a
# family may do, and what it must not, on request of the parameters.
DEMO_FAMILY = """
CREATE TABLE public.demo_effects (
  id serial PRIMARY KEY, stage text, log_id uuid, params jsonb, body text, uid uuid);

INSERT INTO web_door.vocab (action, family, level, recent, cap_group, cap_n, cap_window, takes_body, params_max_bytes) VALUES
  ('demo.note',   'demo', 'L1', FALSE, 'demo.note',   50, INTERVAL '1 hour', TRUE,  1024),
  ('demo.danger', 'demo', 'L2', FALSE, 'demo.danger', 50, INTERVAL '1 hour', TRUE,  256),
  ('demo.sync',   'demo', 'L1', FALSE, 'demo.sync',   50, INTERVAL '1 hour', FALSE, 256),
  ('ghost.act',   'ghost','L1', FALSE, 'ghost.act',   50, INTERVAL '1 hour', FALSE, 256);

CREATE FUNCTION web_door.ext_demo(p_stage text, p_action text, p_uid uuid, p_params jsonb, p_body text, p_log_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
BEGIN
  INSERT INTO public.demo_effects (stage, log_id, params, body, uid) VALUES (p_stage, p_log_id, p_params, p_body, p_uid);
  IF p_stage = 'prepare' THEN
    IF p_params ? 'fail' THEN RETURN jsonb_build_object('error', p_params ->> 'fail'); END IF;
    IF p_params ? 'broken' THEN
      IF p_params ->> 'broken' = 'nothing' THEN RETURN NULL; END IF;
      IF p_params ->> 'broken' = 'array' THEN RETURN '[]'::jsonb; END IF;
      IF p_params ->> 'broken' = 'nosummary' THEN RETURN jsonb_build_object('params', '{}'::jsonb, 'confirm', FALSE); END IF;
      IF p_params ->> 'broken' = 'noconfirm' THEN RETURN jsonb_build_object('params', '{}'::jsonb, 'summary', 's'); END IF;
      IF p_params ->> 'broken' = 'emptysummary' THEN RETURN jsonb_build_object('params', '{}'::jsonb, 'summary', '  ', 'confirm', FALSE); END IF;
      IF p_params ->> 'broken' = 'bigparams' THEN
        RETURN jsonb_build_object('params', jsonb_build_object('pad', repeat('x', 400)), 'summary', 's', 'confirm', FALSE);
      END IF;
      IF p_params ->> 'broken' = 'bodynottaken' THEN
        RETURN jsonb_build_object('params', '{}'::jsonb, 'body', 'a text', 'summary', 's', 'confirm', FALSE);
      END IF;
    END IF;
    RETURN jsonb_build_object(
      'params', p_params,
      'body', CASE WHEN p_body IS NULL THEN NULL ELSE btrim(p_body) END,
      'summary', 'demo ' || COALESCE(left(p_body, 20), E'\nnothing'),
      'confirm', p_action = 'demo.danger');
  END IF;
  IF p_params ? 'effect_error' THEN RETURN jsonb_build_object('error', p_params ->> 'effect_error'); END IF;
  RETURN jsonb_build_object('status', CASE WHEN (p_params ->> 'done') = 't' THEN 'done' ELSE 'queued' END)
      || CASE WHEN (p_params ->> 'cmd') = 't' THEN jsonb_build_object('command_id', gen_random_uuid()) ELSE '{}'::jsonb END;
END $f$;
REVOKE ALL ON FUNCTION web_door.ext_demo(text, text, uuid, jsonb, text, uuid) FROM PUBLIC, anon, authenticated;
"""


def _tool(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for folder in ("/opt/homebrew/bin", "/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/17/bin", "/usr/local/bin"):
        candidate = Path(folder) / name
        if candidate.exists():
            return str(candidate)
    return None


def _runner(psql_argv: list[str], env: dict | None):
    def psql(sql: str | None = None, *, file: Path | None = None, check: bool = True):
        args = [*psql_argv, *(["-f", str(file)] if file else ["-c", sql])]
        return subprocess.run(args, capture_output=True, text=True, env=env, timeout=120, check=check)

    return psql


@pytest.fixture(scope="module")
def cluster(tmp_path_factory):
    work = tmp_path_factory.mktemp("web-action-door")
    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    if external_url:
        client = _tool("psql")
        parsed = urlparse(external_url)
        if not client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL needs psql and a valid host")
        database = f"jht_web_action_door_{uuid.uuid4().hex[:12]}"
        admin = _runner([client, *PSQL_FLAGS, "-d", external_url], None)
        admin(f'CREATE DATABASE "{database}";')
        psql = _runner([client, *PSQL_FLAGS, "-d", urlunparse(parsed._replace(path=f"/{database}"))], None)
        try:
            psql(BOOTSTRAP)
            for migration in (MIGRATION, MIGRATION_099):
                psql(file=migration)
                psql(file=migration)     # applied by hand, possibly twice
            psql(DEMO_FAMILY)
            psql.work = work
            yield psql
        finally:
            admin(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE);', check=False)
        return

    tools = {name: _tool(name) for name in ("initdb", "pg_ctl", "psql", "postgres")}
    if not all(tools.values()):
        pytest.skip("no JHT_TEST_POSTGRES_URL and no local Postgres server binaries")
    root = Path(tempfile.mkdtemp(prefix="jht-pg-098-", dir="/tmp"))
    data, sock = root / "data", root / "sock"
    sock.mkdir()
    env = {**os.environ, "LC_ALL": "C", "PGHOST": str(sock), "PGUSER": "postgres", "PGDATABASE": "postgres"}
    subprocess.run([tools["initdb"], "-D", str(data), "-A", "trust", "-U", "postgres", "--no-sync"],
                   check=True, capture_output=True, env=env, timeout=120)
    subprocess.run([tools["pg_ctl"], "-D", str(data), "-l", str(root / "postgres.log"), "-w", "-s",
                    "-o", f"-c listen_addresses='' -k {sock} -c fsync=off", "start"],
                   check=True, capture_output=True, env=env, timeout=120)
    psql = _runner([tools["psql"], *PSQL_FLAGS], env)
    try:
        psql(BOOTSTRAP)
        for migration in (MIGRATION, MIGRATION_099):
            psql(file=migration)
            psql(file=migration)         # applied by hand, possibly twice
        psql(DEMO_FAMILY)
        psql.work = work
        yield psql
    finally:
        subprocess.run([tools["pg_ctl"], "-D", str(data), "-m", "immediate", "-w", "-s", "stop"],
                       capture_output=True, env=env, timeout=60, check=False)
        shutil.rmtree(root, ignore_errors=True)


# --------------------------------------------------------------------------------------------------
# helpers: a user, a session, a request
# --------------------------------------------------------------------------------------------------

class Browser:
    """One signed-in browser session: its own user (unless one is given) and its own session."""

    def __init__(self, db, *, user: str | None = None, session: str | None = None):
        self.db = db
        self.user = user or str(uuid.uuid4())
        self.session = session or str(uuid.uuid4())
        if user is None:
            db(f"INSERT INTO auth.users (id) VALUES ('{self.user}')")

    def claims(self, *, login_age_s: float | None = 60, method: str = "oauth", session: str | None = "default",
               extra: dict | None = None) -> str:
        claims: dict = {"sub": self.user, "role": "authenticated"}
        if session == "default":
            claims["session_id"] = self.session
        elif session is not None:
            claims["session_id"] = session
        if login_age_s is not None:
            claims["amr"] = [{"method": method, "timestamp": int(time.time() - login_age_s)}]
        claims.update(extra or {})
        return json.dumps(claims)

    def script(self, statements: str, *, role: str = "authenticated", claims: str | None = None) -> subprocess.CompletedProcess:
        claims = self.claims() if claims is None else claims
        text = (f"BEGIN;\nSET LOCAL ROLE {role};\n"
                f"SELECT set_config('request.jwt.claims', $c${claims}$c$, true) \\g /dev/null\n"
                f"{statements}\nCOMMIT;\n")
        path = self.db.work / f"req-{uuid.uuid4().hex}.sql"
        path.write_text(text)
        return self.db(file=path, check=False)

    def act(self, action: str, params: dict | None = None, *, confirm: str | None = None,
            route_level: str | None = "real", body: str | None = None, **claims_kw) -> dict:
        args = [f"$a${action}$a$"]
        args.append(f"$p${json.dumps(params if params is not None else {})}$p$::jsonb")
        args.append(f"'{confirm}'::uuid" if confirm else "NULL")
        if route_level == "real":
            route_level = LEVEL_OF.get(action, "L1")      # what a well-made route passes
        args.append(f"'{route_level}'" if route_level is not None else "NULL")
        args.append(f"$b${body}$b$" if body is not None else "NULL")
        done = self.script(f"SELECT public.request_action({', '.join(args)});",
                           claims=self.claims(**claims_kw) if claims_kw else None)
        assert done.returncode == 0, done.stderr
        lines = [line for line in done.stdout.splitlines() if line.startswith("{")]
        assert len(lines) == 1, done.stdout
        return json.loads(lines[0])

    def refused(self, statements: str, *, role: str = "authenticated") -> str:
        done = self.script(statements, role=role)
        assert done.returncode != 0, f"expected a refusal, got: {done.stdout}"
        return done.stderr


def _scalar(db, sql: str) -> str:
    return db(sql).stdout.strip()


def _position(db, user: str, legacy_id: int, *, status="ready", title="Platform Engineer",
              company="Acme", applied=False, deleted=False) -> int:
    pid = _scalar(db, f"""INSERT INTO public.positions (user_id, legacy_id, title, company, status, deleted_at)
        VALUES ('{user}', {legacy_id}, $t${title}$t$, $c${company}$c$, '{status}',
                {'now()' if deleted else 'NULL'}) RETURNING id""").splitlines()[0]
    if applied:
        db(f"INSERT INTO public.applications (user_id, position_id, applied) VALUES ('{user}', {pid}, true)")
    return int(pid)


# --------------------------------------------------------------------------------------------------
# the migration and the revoked writes
# --------------------------------------------------------------------------------------------------

def test_the_objects_exist_and_the_door_is_a_definer_with_a_fixed_search_path(cluster):
    assert _scalar(cluster, "SELECT to_regclass('public.web_action_log') IS NOT NULL") == "t"
    row = _scalar(cluster, """SELECT prosecdef, proconfig = ARRAY['search_path=""'] FROM pg_proc
                              WHERE proname = 'request_action' AND pronamespace = 'public'::regnamespace""")
    assert row == "t|t", row
    # one function with that name, one signature
    assert _scalar(cluster, "SELECT count(*) FROM pg_proc WHERE proname = 'request_action'") == "1"


def test_the_door_is_executable_by_the_signed_in_role_and_by_nobody_else(cluster):
    who = Browser(cluster)
    assert _scalar(cluster, "SELECT has_function_privilege('authenticated', 'public.request_action(text,jsonb,uuid,text,text)', 'EXECUTE')") == "t"
    assert _scalar(cluster, "SELECT has_function_privilege('anon', 'public.request_action(text,jsonb,uuid,text,text)', 'EXECUTE')") == "f"
    assert "permission denied for function request_action" in who.refused(
        "SELECT public.request_action('team.restart', '{}'::jsonb, NULL, 'L2');", role="anon")
    # the rules of the vocabulary and the functions of the families are private, in a schema no browser role can use
    assert "permission denied for schema web_door" in who.refused("SELECT * FROM web_door.rule('team.start');")
    assert "permission denied for schema web_door" in who.refused("SELECT * FROM web_door.vocab;")
    assert "permission denied for schema web_door" in who.refused(
        f"SELECT web_door.ext_team('effect', 'team.start', '{who.user}', '{{}}'::jsonb, NULL, NULL);")
    assert _scalar(cluster, "SELECT has_function_privilege('anon', 'public.web_action_log_follow_command()', 'EXECUTE')") == "f"
    assert _scalar(cluster, "SELECT has_function_privilege('authenticated', 'public.positions_guard_apply_requested()', 'EXECUTE')") == "f"


@pytest.mark.parametrize("statement", [
    "INSERT INTO public.team_commands (user_id, action) VALUES ('{u}', 'start');",
    "UPDATE public.team_commands SET status = 'done';",
    "DELETE FROM public.team_commands;",
    "TRUNCATE public.team_commands;",
    "INSERT INTO public.web_action_log (user_id, action, level, summary, status) VALUES ('{u}', 'team.start', 'L2', 'x', 'queued');",
    "UPDATE public.web_action_log SET status = 'done';",
    "DELETE FROM public.web_action_log;",
    "INSERT INTO public.team_directives (user_id, body) VALUES ('{u}', 'x');",
    "UPDATE public.team_directives SET body = 'x';",
    "TRUNCATE public.positions;",
    "TRUNCATE public.applications;",
    "TRUNCATE public.scores;",
    "TRUNCATE public.candidate_profiles;",
    "TRUNCATE public.team_state;",
])
def test_a_browser_role_cannot_write_what_goes_through_the_door(cluster, statement):
    who = Browser(cluster)
    assert "permission denied" in who.refused(statement.format(u=who.user))


@pytest.mark.parametrize("statement", [
    "INSERT INTO public.team_commands (user_id, action) VALUES ('{u}', 'start');",
    "UPDATE public.team_state SET should_run = true;",
    "INSERT INTO public.team_state (user_id) VALUES ('{u}');",
    "SELECT count(*) FROM public.web_action_log;",
    "SELECT count(*) FROM public.team_commands;",
])
def test_anon_can_write_none_of_it_and_read_none_of_it(cluster, statement):
    who = Browser(cluster)
    assert "permission denied" in who.refused(statement.format(u=who.user), role="anon")


def test_a_browser_role_still_reads_its_own_lines_and_only_its_own(cluster):
    mine, other = Browser(cluster), Browser(cluster)
    cluster(f"""INSERT INTO public.team_commands (user_id, action) VALUES ('{mine.user}', 'start'), ('{other.user}', 'stop')""")
    done = mine.script("SELECT count(*) FROM public.team_commands;")
    assert done.returncode == 0 and done.stdout.strip() == "1", done.stderr
    assert mine.act("team.restart", {"target": "scout"})["ok"] is True
    seen = mine.script("SELECT count(*) FROM public.web_action_log;")
    assert seen.stdout.strip() == "1"
    nothing = other.script("SELECT count(*) FROM public.web_action_log;")
    assert nothing.stdout.strip() == "0"


def test_the_presence_the_sync_and_the_chat_bell_stay_writable_by_column_and_nothing_of_control_is(cluster):
    who = Browser(cluster)
    done = who.script(f"""INSERT INTO public.team_state (user_id, last_user_activity_at)
        VALUES ('{who.user}', now())
        ON CONFLICT (user_id) DO UPDATE SET last_user_activity_at = EXCLUDED.last_user_activity_at;
        UPDATE public.team_state SET sync_requested_at = now(), chat_requested_at = now();""")
    assert done.returncode == 0, done.stderr
    for column, value in (("should_run", "true"), ("agents_enabled", "'{}'::jsonb"),
                          ("restart_token", "gen_random_uuid()"), ("emergency_stop_requested_at", "now()"),
                          ("is_running", "true")):
        assert "permission denied for table team_state" in who.refused(f"UPDATE public.team_state SET {column} = {value};"), column
    assert "permission denied for table team_state" in who.refused(
        f"INSERT INTO public.team_state (user_id, should_run) VALUES ('{uuid.uuid4()}', true);")
    assert "permission denied" in who.refused(
        f"""INSERT INTO public.team_state (user_id, should_run) VALUES ('{who.user}', false)
            ON CONFLICT (user_id) DO UPDATE SET should_run = true;""")


def test_the_chat_bell_and_sync_now_are_upserts_of_supabase_js_and_set_every_column_of_the_payload_the_key_too(cluster):
    """The shape PostgREST gives to `.upsert({user_id, chat_requested_at}, {onConflict: 'user_id'})`:
    DO UPDATE SET for each column of the payload, user_id included."""
    who = Browser(cluster)
    bell = (f"INSERT INTO public.team_state (user_id, chat_requested_at) VALUES ('{who.user}', now()) "
            "ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id, chat_requested_at = EXCLUDED.chat_requested_at;")
    sync = (f"INSERT INTO public.team_state (user_id, sync_requested_at, last_user_activity_at) VALUES ('{who.user}', now(), now()) "
            "ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id, sync_requested_at = EXCLUDED.sync_requested_at, "
            "last_user_activity_at = EXCLUDED.last_user_activity_at;")
    for statement in (bell, bell, sync):                    # the first inserts, the others update
        done = who.script(statement)
        assert done.returncode == 0, done.stderr
    assert _scalar(cluster, f"SELECT chat_requested_at IS NOT NULL AND sync_requested_at IS NOT NULL FROM public.team_state WHERE user_id = '{who.user}'") == "t"
    # the key still moves nobody: another user's row is neither reached nor taken
    other = Browser(cluster)
    cluster(f"INSERT INTO public.team_state (user_id) VALUES ('{other.user}')")
    assert who.script(f"UPDATE public.team_state SET user_id = '{other.user}' WHERE user_id = '{who.user}';").returncode != 0
    assert "row-level security" in who.refused(
        f"INSERT INTO public.team_state (user_id, chat_requested_at) VALUES ('{other.user}', now()) "
        "ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id, chat_requested_at = EXCLUDED.chat_requested_at;")


def test_the_box_keeps_its_rights_the_service_role_writes_the_bus_and_the_control_fields(cluster):
    who = Browser(cluster)
    done = who.script(f"""INSERT INTO public.team_commands (user_id, action) VALUES ('{who.user}', 'start');
        UPDATE public.team_commands SET status = 'running';
        INSERT INTO public.team_state (user_id, should_run) VALUES ('{who.user}', true);
        UPDATE public.team_state SET restart_token = gen_random_uuid(), agents_enabled = '{{"scout": true}}'::jsonb;""",
        role="service_role")
    assert done.returncode == 0, done.stderr


# --------------------------------------------------------------------------------------------------
# the guard on the authorisation to apply
# --------------------------------------------------------------------------------------------------

def test_a_browser_cannot_write_the_authorisation_to_apply_in_any_way(cluster):
    who = Browser(cluster)
    pid = _position(cluster, who.user, 11)
    for statement in (
        f"UPDATE public.positions SET apply_requested = true WHERE id = {pid};",
        f"UPDATE public.positions SET apply_requested_at = now() WHERE id = {pid};",
        f"UPDATE public.positions SET apply_requested_by = 'user_web' WHERE id = {pid};",
        f"UPDATE public.positions SET apply_requested = true, apply_requested_at = now(), apply_requested_by = 'user_web' WHERE id = {pid};",
        f"INSERT INTO public.positions (user_id, legacy_id, apply_requested) VALUES ('{who.user}', 12, true);",
        f"INSERT INTO public.positions (user_id, legacy_id, apply_requested_by) VALUES ('{who.user}', 13, 'user_web');",
    ):
        assert "apply_requested_is_door_only" in who.refused(statement), statement
    assert _scalar(cluster, f"SELECT apply_requested FROM public.positions WHERE id = {pid}") == "f"


def test_the_rest_of_the_notebook_is_still_the_users_own(cluster):
    who = Browser(cluster)
    pid = _position(cluster, who.user, 21)
    done = who.script(f"""UPDATE public.positions SET write_requested = true, title = 'edited', status = 'scored' WHERE id = {pid};
        UPDATE public.positions SET apply_requested = false WHERE id = {pid};
        INSERT INTO public.positions (user_id, legacy_id, title, company) VALUES ('{who.user}', 22, 'x', 'y');
        INSERT INTO public.applications (user_id, position_id, applied) VALUES ('{who.user}', {pid}, true);
        INSERT INTO public.scores (user_id) VALUES ('{who.user}');""")
    assert done.returncode == 0, done.stderr      # the same value is not a write of the flag


def test_the_box_and_the_migration_owner_still_write_the_flag(cluster):
    who = Browser(cluster)
    pid = _position(cluster, who.user, 31)
    done = who.script(f"UPDATE public.positions SET apply_requested = true, apply_requested_by = 'user_telegram' WHERE id = {pid};",
                      role="service_role")
    assert done.returncode == 0, done.stderr
    assert _scalar(cluster, f"SELECT apply_requested_by FROM public.positions WHERE id = {pid}") == "user_telegram"


# --------------------------------------------------------------------------------------------------
# the door: who, which action, which parameters
# --------------------------------------------------------------------------------------------------

def test_without_a_user_the_door_answers_unauthenticated(cluster):
    who = Browser(cluster)
    done = who.script("SELECT public.request_action('team.restart', '{\"target\":\"scout\"}'::jsonb, NULL, 'L2');",
                      claims=json.dumps({"role": "authenticated"}))
    assert done.returncode == 0 and json.loads(done.stdout.strip()) == {"ok": False, "error": "unauthenticated"}, done.stderr


def test_the_vocabulary_is_closed(cluster):
    who = Browser(cluster)
    for action in ("team.pause", "team", "TEAM.START", "position.delete", "", "applications.update", "team.start; drop table x"):
        assert who.act(action) == {"ok": False, "error": "unknown_action"}, action
    assert who.script("SELECT public.request_action(NULL, '{}'::jsonb, NULL, 'L1');").stdout.strip() == '{"ok": false, "error": "unknown_action"}'


@pytest.mark.parametrize("action, params", [
    ("team.restart", {"target": "everything"}),
    ("team.restart", {"target": 7}),
    ("team.restart", {"target": ["all"]}),
    ("team.restart", {"target": "scout", "note": "hello"}),
    ("team.restart", {"agents": ["scout"]}),
    ("team.emergency_stop", {"target": "all"}),
    ("team.emergency_stop", {"why": "free text"}),
    ("position.apply_authorize", {}),
    ("position.apply_authorize", {"legacy_id": "12"}),
    ("position.apply_authorize", {"legacy_id": 1.5}),
    ("position.apply_authorize", {"legacy_id": 0}),
    ("position.apply_authorize", {"legacy_id": -3}),
    ("position.apply_authorize", {"legacy_id": 99999999999}),
    ("position.apply_authorize", {"legacy_id": 12, "text": "apply to this one"}),
    ("position.apply_revoke", {"legacy_id": None}),
])
def test_the_parameters_are_closed_per_action(cluster, action, params):
    assert Browser(cluster).act(action, params) == {"ok": False, "error": "invalid_params"}


def test_the_parameters_must_be_an_object_and_small(cluster):
    who = Browser(cluster)
    for raw in ("'[]'::jsonb", "'\"x\"'::jsonb", "'7'::jsonb", "'null'::jsonb"):
        done = who.script(f"SELECT public.request_action('team.restart', {raw}, NULL, 'L2');")
        assert json.loads(done.stdout.strip()) == {"ok": False, "error": "invalid_params"}, raw
    big = {"target": "scout", "pad": "x" * 400}
    assert who.act("team.restart", big) == {"ok": False, "error": "invalid_params"}
    assert _scalar(cluster, f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}'") == "0"


def test_a_refusal_writes_no_line_and_no_effect(cluster):
    who = Browser(cluster)
    who.act("team.restart", {"target": "nobody"})
    who.act("nothing.at.all")
    assert _scalar(cluster, f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}'") == "0"
    assert _scalar(cluster, f"SELECT count(*) FROM public.team_commands WHERE user_id = '{who.user}'") == "0"


def test_a_session_id_that_is_not_a_uuid_is_not_an_error(cluster):
    who = Browser(cluster)
    answer = who.act("team.restart", {"target": "scout"}, session="not-a-uuid")
    assert answer["ok"] is True and answer["state"] == "queued"
    assert _scalar(cluster, f"SELECT session_id IS NULL FROM public.web_action_log WHERE user_id = '{who.user}'") == "t"


# --------------------------------------------------------------------------------------------------
# recent session
# --------------------------------------------------------------------------------------------------

def test_a_team_action_needs_a_session_that_authenticated_in_the_last_fifteen_minutes(cluster):
    who = Browser(cluster)
    fresh = who.act("team.restart", {"target": "scout"}, login_age_s=14 * 60)
    assert fresh["ok"] is True, fresh
    assert who.act("team.restart", {"target": "scout"}, login_age_s=16 * 60) == {"ok": False, "error": "reauth_required"}
    assert who.act("team.restart", {"target": "scout"}, login_age_s=None) == {"ok": False, "error": "reauth_required"}
    assert who.act("team.start", {}, login_age_s=3600) == {"ok": False, "error": "reauth_required"}


def test_only_a_method_that_logs_in_counts_as_a_login(cluster):
    who = Browser(cluster)
    for method in ("token_refresh", "anonymous", "something_new", ""):
        assert who.act("team.restart", {"target": "scout"}, method=method) == {"ok": False, "error": "reauth_required"}, method
    for method in ("password", "oauth", "otp", "magiclink", "sso/saml", "totp", "mfa/totp"):
        assert who.act("team.stop", {"target": "scout"}, method=method)["ok"] is True, method


def test_without_the_claim_the_session_itself_says_when_it_began(cluster):
    who = Browser(cluster)
    cluster(f"INSERT INTO auth.sessions (id, user_id, created_at) VALUES ('{who.session}', '{who.user}', now() - interval '3 minutes')")
    assert who.act("team.restart", {"target": "scout"}, login_age_s=None)["ok"] is True
    old = Browser(cluster)
    cluster(f"INSERT INTO auth.sessions (id, user_id, created_at) VALUES ('{old.session}', '{old.user}', now() - interval '40 minutes')")
    assert old.act("team.restart", {"target": "scout"}, login_age_s=None) == {"ok": False, "error": "reauth_required"}
    # a session of another user does not vouch for this one
    thief = Browser(cluster, session=who.session)
    assert thief.act("team.restart", {"target": "scout"}, login_age_s=None) == {"ok": False, "error": "reauth_required"}


def test_the_login_of_the_user_does_not_make_a_stolen_session_recent(cluster):
    """The user signs in on the phone: that is `last_sign_in_at` of the user. The stolen session has its own
    token, with its own (old) login: the door reads the token, never the user."""
    who = Browser(cluster)
    stolen = who.act("team.restart", {"target": "scout"}, login_age_s=6 * 3600)
    assert stolen == {"ok": False, "error": "reauth_required"}


def test_an_emergency_stop_and_a_withdrawal_do_not_wait_for_a_recent_login(cluster):
    who = Browser(cluster)
    stop = who.act("team.emergency_stop", login_age_s=None)
    assert stop["ok"] is True and stop["state"] == "queued" and stop["level"] == "L2"
    pid = _position(cluster, who.user, 41)
    assert who.act("position.apply_revoke", {"legacy_id": 41}, login_age_s=None)["ok"] is True


# --------------------------------------------------------------------------------------------------
# the bus
# --------------------------------------------------------------------------------------------------

def test_a_single_agent_goes_to_the_bus_without_a_confirmation(cluster):
    who = Browser(cluster)
    answer = who.act("team.restart", {"target": "Scout"})
    assert answer["ok"] and answer["state"] == "queued" and answer["level"] == "L2"
    assert answer["summary"] == "restart scout" and "command_id" in answer
    row = _scalar(cluster, f"SELECT action, payload::text, status FROM public.team_commands WHERE id = '{answer['command_id']}'")
    assert row == 'restart|{"target": "scout"}|pending'
    line = _scalar(cluster, f"SELECT status, level, command_id = '{answer['command_id']}', session_id = '{who.session}' FROM public.web_action_log WHERE id = '{answer['id']}'")
    assert line == "queued|L2|t|t"


def test_the_whole_team_waits_for_a_confirmation_composed_by_the_database(cluster):
    who = Browser(cluster)
    first = who.act("team.restart", {})
    assert first["ok"] and first["state"] == "awaiting_confirm" and first["level"] == "L2"
    assert first["summary"] == "restart all" and "command_id" not in first
    assert _scalar(cluster, f"SELECT count(*) FROM public.team_commands WHERE user_id = '{who.user}'") == "0"
    window = float(_scalar(cluster, f"SELECT extract(epoch FROM expires_at - created_at) FROM public.web_action_log WHERE id = '{first['id']}'"))
    assert window == 120.0

    second = who.act("team.restart", confirm=first["id"])
    assert second["ok"] and second["state"] == "queued" and second["id"] == first["id"] and "command_id" in second
    assert _scalar(cluster, f"SELECT count(*) FROM public.team_commands WHERE user_id = '{who.user}'") == "1"
    assert _scalar(cluster, f"SELECT payload::text FROM public.team_commands WHERE id = '{second['command_id']}'") == '{"target": "all"}'
    # once
    assert who.act("team.restart", confirm=first["id"]) == {"ok": False, "error": "confirm_used"}
    assert _scalar(cluster, f"SELECT count(*) FROM public.team_commands WHERE user_id = '{who.user}'") == "1"


def test_a_confirmation_is_of_one_session_one_user_and_one_action(cluster):
    who = Browser(cluster)
    first = who.act("team.stop", {})
    other_session = Browser(cluster, user=who.user)
    assert other_session.act("team.stop", confirm=first["id"]) == {"ok": False, "error": "confirm_session_mismatch"}
    assert who.act("team.restart", confirm=first["id"]) == {"ok": False, "error": "confirm_action_mismatch"}
    stranger = Browser(cluster)
    assert stranger.act("team.stop", confirm=first["id"]) == {"ok": False, "error": "confirm_not_found"}
    assert who.act("team.stop", confirm=str(uuid.uuid4())) == {"ok": False, "error": "confirm_not_found"}
    assert _scalar(cluster, f"SELECT count(*) FROM public.team_commands WHERE user_id = '{who.user}'") == "0"
    assert who.act("team.stop", confirm=first["id"])["state"] == "queued"      # and the right one still can


def test_a_confirmation_takes_no_parameters_and_expires_on_the_database_clock(cluster):
    who = Browser(cluster)
    first = who.act("team.start", {})
    assert who.act("team.start", {"target": "scout"}, confirm=first["id"]) == {"ok": False, "error": "invalid_params"}
    cluster(f"UPDATE public.web_action_log SET expires_at = now() - interval '1 second' WHERE id = '{first['id']}'")
    assert who.act("team.start", confirm=first["id"]) == {"ok": False, "error": "confirm_expired"}
    assert _scalar(cluster, f"SELECT status FROM public.web_action_log WHERE id = '{first['id']}'") == "expired"
    assert _scalar(cluster, f"SELECT count(*) FROM public.team_commands WHERE user_id = '{who.user}'") == "0"


def test_the_log_follows_the_bus_when_the_box_answers(cluster):
    who = Browser(cluster)
    done = who.act("team.stop", {"target": "scout"})
    failed = who.act("team.start", {"target": "scout"})
    cluster(f"UPDATE public.team_commands SET status = 'running' WHERE id = '{done['command_id']}'")
    assert _scalar(cluster, f"SELECT status FROM public.web_action_log WHERE id = '{done['id']}'") == "queued"
    cluster(f"UPDATE public.team_commands SET status = 'done' WHERE id = '{done['command_id']}'")
    cluster(f"UPDATE public.team_commands SET status = 'error', error = '{'e' * 400}' WHERE id = '{failed['command_id']}'")
    assert _scalar(cluster, f"SELECT status, result IS NULL FROM public.web_action_log WHERE id = '{done['id']}'") == "done|t"
    row = _scalar(cluster, f"SELECT status, char_length(result) FROM public.web_action_log WHERE id = '{failed['id']}'")
    assert row == "error|200"


def test_an_emergency_stop_writes_the_stop_exactly_as_the_route_did(cluster):
    who = Browser(cluster)
    cluster(f"INSERT INTO public.team_state (user_id, should_run) VALUES ('{who.user}', true)")
    answer = who.act("team.emergency_stop")
    assert answer["ok"] and answer["summary"] == "emergency_stop"
    state = _scalar(cluster, f"SELECT should_run, emergency_stop_requested_at IS NOT NULL, last_user_activity_at IS NOT NULL FROM public.team_state WHERE user_id = '{who.user}'")
    assert state == "f|t|t"
    fresh = Browser(cluster)                      # a user with no row yet: the row is made
    assert fresh.act("team.emergency_stop")["ok"] is True
    assert _scalar(cluster, f"SELECT should_run FROM public.team_state WHERE user_id = '{fresh.user}'") == "f"


# --------------------------------------------------------------------------------------------------
# limits
# --------------------------------------------------------------------------------------------------

def test_the_start_and_restart_share_six_an_hour_and_the_stop_has_its_own(cluster):
    who = Browser(cluster)
    for index in range(6):
        assert who.act("team.restart" if index % 2 else "team.start", {"target": "scout"})["ok"] is True, index
    refused = who.act("team.start", {"target": "scout"})
    assert refused["ok"] is False and refused["error"] == "rate_limited" and refused["retry_after_s"] >= 1
    assert who.act("team.restart", {"target": "scout"})["error"] == "rate_limited"
    assert who.act("team.stop", {"target": "scout"})["ok"] is True                 # another group
    assert Browser(cluster).act("team.start", {"target": "scout"})["ok"] is True   # another user
    assert _scalar(cluster, f"SELECT count(*) FROM public.team_commands WHERE user_id = '{who.user}'") == "7"


def test_the_limit_is_a_window_and_the_oldest_line_says_when_it_opens(cluster):
    who = Browser(cluster)
    for _ in range(6):
        who.act("team.restart", {"target": "scout"})
    cluster(f"UPDATE public.web_action_log SET created_at = now() - interval '59 minutes' WHERE user_id = '{who.user}' AND id = (SELECT id FROM public.web_action_log WHERE user_id = '{who.user}' ORDER BY created_at LIMIT 1)")
    refused = who.act("team.restart", {"target": "scout"})
    assert refused["error"] == "rate_limited" and 1 <= refused["retry_after_s"] <= 61
    cluster(f"UPDATE public.web_action_log SET created_at = now() - interval '61 minutes' WHERE user_id = '{who.user}' AND created_at < now() - interval '58 minutes'")
    assert who.act("team.restart", {"target": "scout"})["ok"] is True


def test_the_emergency_stop_is_not_blocked_by_the_limit_of_the_team_actions(cluster):
    who = Browser(cluster)
    for _ in range(6):
        who.act("team.restart", {"target": "scout"})
    assert who.act("team.restart", {"target": "scout"})["error"] == "rate_limited"
    assert who.act("team.emergency_stop")["ok"] is True


def test_confirmations_left_open_are_bounded_and_the_log_is_not_a_place_to_dump_lines(cluster):
    who = Browser(cluster)
    calls = "\n".join("SELECT public.request_action('team.start', '{}'::jsonb, NULL, 'L2');" for _ in range(31))
    done = who.script(calls)
    answers = [json.loads(line) for line in done.stdout.splitlines() if line.startswith("{")]
    assert len(answers) == 31
    assert sum(a["ok"] for a in answers) == 30 and answers[-1] == {"ok": False, "error": "rate_limited", "retry_after_s": 60}
    assert _scalar(cluster, f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}'") == "30"


def test_confirmations_opened_together_do_not_all_pass_a_cap_one_of_them_used_up(cluster):
    who = Browser(cluster)
    pids = [_position(cluster, who.user, 100 + n) for n in range(16)]
    firsts = [who.act("position.apply_authorize", {"legacy_id": 100 + n}) for n in range(16)]
    assert all(f["state"] == "awaiting_confirm" for f in firsts)
    results = [who.act("position.apply_authorize", confirm=f["id"]) for f in firsts]
    assert sum(r["ok"] for r in results) == 15
    assert results[-1]["error"] == "rate_limited"
    assert _scalar(cluster, f"SELECT count(*) FROM public.positions WHERE user_id = '{who.user}' AND apply_requested") == "15"


# --------------------------------------------------------------------------------------------------
# the authorisation to apply
# --------------------------------------------------------------------------------------------------

def test_the_rule_of_the_gate_is_the_one_the_migration_enforces():
    assert APPLY_RULE["authorisable_status"] == "ready"
    assert APPLY_RULE["post_submission_states"] == ["applied", "response"]
    assert "user_web" in APPLY_RULE["user_request_origins"]


def test_the_authorisation_asks_for_a_confirmation_that_names_the_position(cluster):
    who = Browser(cluster)
    _position(cluster, who.user, 51, title="Line one\nLine two\x07", company="Acme & Sons")
    first = who.act("position.apply_authorize", {"legacy_id": 51})
    assert first["ok"] and first["state"] == "awaiting_confirm" and first["level"] == "L3"
    assert first["summary"] == "Line one Line two  @ Acme & Sons"
    assert _scalar(cluster, f"SELECT apply_requested FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 51") == "f"

    second = who.act("position.apply_authorize", confirm=first["id"])
    assert second["ok"] and second["state"] == "queued"
    row = _scalar(cluster, f"SELECT apply_requested, apply_requested_by, apply_requested_at IS NOT NULL FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 51")
    assert row == "t|user_web|t"


def test_the_title_is_cut_at_two_hundred_characters(cluster):
    who = Browser(cluster)
    _position(cluster, who.user, 52, title="T" * 300, company="C" * 300)
    first = who.act("position.apply_authorize", {"legacy_id": 52})
    assert len(first["summary"]) == 200


def test_the_authorisation_and_its_withdrawal_move_the_instant_forward_every_time(cluster):
    who = Browser(cluster)
    _position(cluster, who.user, 53)

    def authorise():
        first = who.act("position.apply_authorize", {"legacy_id": 53})
        return who.act("position.apply_authorize", confirm=first["id"])

    def instant():
        return _scalar(cluster, f"SELECT extract(epoch FROM apply_requested_at)::numeric(20,6) FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 53")

    assert authorise()["ok"]
    t1 = instant()
    assert who.act("position.apply_revoke", {"legacy_id": 53})["ok"]
    t2 = instant()
    assert _scalar(cluster, f"SELECT apply_requested, apply_requested_by IS NULL FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 53") == "f|t"
    assert authorise()["ok"]
    t3 = instant()
    assert float(t1) < float(t2) < float(t3)
    # the instant of a future authorisation is still moved forward
    cluster(f"UPDATE public.positions SET apply_requested_at = now() + interval '1 hour' WHERE user_id = '{who.user}' AND legacy_id = 53")
    future = instant()
    assert who.act("position.apply_revoke", {"legacy_id": 53})["ok"]
    assert float(instant()) > float(future)


@pytest.mark.parametrize("status", ["new", "scored", "writing", "review", "rejected", "excluded"])
def test_only_the_status_of_the_rule_can_be_authorised(cluster, status):
    who = Browser(cluster)
    _position(cluster, who.user, 60, status=status)
    assert who.act("position.apply_authorize", {"legacy_id": 60}) == {"ok": False, "error": "position_not_ready"}
    assert who.act("position.apply_revoke", {"legacy_id": 60})["ok"] is True       # withdrawing is always allowed


@pytest.mark.parametrize("status", APPLY_RULE["post_submission_states"])
def test_an_application_that_left_is_neither_authorised_nor_withdrawn(cluster, status):
    who = Browser(cluster)
    _position(cluster, who.user, 61, status=status)
    assert who.act("position.apply_authorize", {"legacy_id": 61}) == {"ok": False, "error": "already_submitted"}
    assert who.act("position.apply_revoke", {"legacy_id": 61}) == {"ok": False, "error": "already_submitted"}


def test_a_position_marked_applied_in_its_application_has_left_even_if_its_status_is_ready(cluster):
    who = Browser(cluster)
    _position(cluster, who.user, 62, status=APPLY_RULE["authorisable_status"], applied=True)
    assert who.act("position.apply_authorize", {"legacy_id": 62}) == {"ok": False, "error": "already_submitted"}


def test_a_position_that_is_not_the_users_does_not_exist_for_the_door(cluster):
    who, other = Browser(cluster), Browser(cluster)
    _position(cluster, other.user, 63)
    _position(cluster, who.user, 64, deleted=True)
    for legacy_id in (63, 64, 99999):
        assert who.act("position.apply_authorize", {"legacy_id": legacy_id}) == {"ok": False, "error": "not_found"}
        assert who.act("position.apply_revoke", {"legacy_id": legacy_id}) == {"ok": False, "error": "not_found"}
    assert _scalar(cluster, f"SELECT apply_requested FROM public.positions WHERE user_id = '{other.user}'") == "f"


def test_a_position_that_left_while_the_confirmation_waited_is_checked_again(cluster):
    who = Browser(cluster)
    pid = _position(cluster, who.user, 65)
    first = who.act("position.apply_authorize", {"legacy_id": 65})
    cluster(f"UPDATE public.positions SET status = 'applied' WHERE id = {pid}")
    assert who.act("position.apply_authorize", confirm=first["id"]) == {"ok": False, "error": "already_submitted"}
    assert _scalar(cluster, f"SELECT apply_requested FROM public.positions WHERE id = {pid}") == "f"
    assert _scalar(cluster, f"SELECT status, result FROM public.web_action_log WHERE id = '{first['id']}'") == "cancelled|already_submitted"


def test_the_authorisation_does_not_cross_to_another_users_position_through_a_confirmation(cluster):
    who, other = Browser(cluster), Browser(cluster)
    _position(cluster, who.user, 66)
    _position(cluster, other.user, 66)
    first = who.act("position.apply_authorize", {"legacy_id": 66})
    who.act("position.apply_authorize", confirm=first["id"])
    assert _scalar(cluster, f"SELECT apply_requested FROM public.positions WHERE user_id = '{other.user}' AND legacy_id = 66") == "f"
    assert _scalar(cluster, f"SELECT apply_requested FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 66") == "t"


# --------------------------------------------------------------------------------------------------
# the log
# --------------------------------------------------------------------------------------------------

def test_the_log_refuses_anything_outside_its_closed_sets_even_to_its_owner(cluster):
    who = Browser(cluster)
    base = f"INSERT INTO public.web_action_log (user_id, action, level, summary, status) VALUES ('{who.user}', %s, %s, %s, %s)"
    cases = [("'team.reboot'", "'L2'", "'x'", "'queued'", "web_action_log_action_in_vocab"),
             ("'team.start'", "'L9'", "'x'", "'queued'", "web_action_log_level_closed"),
             ("'team.start'", "'L2'", "'x'", "'running'", "web_action_log_status_closed"),
             ("'team.reboot'", "'L2'", "'x'", "'queued'", "web_action_log_action_in_vocab"),
             ("'team.start'", "'L2'", f"'{'x' * 201}'", "'queued'", "web_action_log_summary_short")]
    for *values, constraint in cases:
        done = cluster(base % tuple(values), check=False)
        assert done.returncode != 0 and constraint in done.stderr, done.stderr


def test_the_log_goes_away_with_the_account(cluster):
    who = Browser(cluster)
    who.act("team.restart", {"target": "scout"})
    cluster(f"DELETE FROM public.team_commands WHERE user_id = '{who.user}'")
    cluster(f"DELETE FROM auth.users WHERE id = '{who.user}'")
    assert _scalar(cluster, f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}'") == "0"


# --------------------------------------------------------------------------------------------------
# the level the route declares: refused BEFORE anything is written
# --------------------------------------------------------------------------------------------------

def _footprint(db, who) -> str:
    return _scalar(db, f"""SELECT (SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}')
        || '/' || (SELECT count(*) FROM public.team_commands WHERE user_id = '{who.user}')
        || '/' || (SELECT count(*) FROM public.team_state WHERE user_id = '{who.user}')
        || '/' || (SELECT count(*) FROM public.positions WHERE user_id = '{who.user}' AND apply_requested)""")


@pytest.mark.parametrize("action, params, declared", [
    ("team.restart", {"target": "scout"}, "L1"),         # runs at once: the effect would be written
    ("team.stop", {"target": "scout"}, "L1"),
    ("team.start", {}, "L1"),
    ("team.emergency_stop", {}, "L1"),
    ("position.apply_authorize", {"legacy_id": 71}, "L2"),
    ("position.apply_authorize", {"legacy_id": 71}, "L1"),
])
def test_a_route_that_declares_a_level_lower_than_the_real_one_changes_nothing(cluster, action, params, declared):
    who = Browser(cluster)
    _position(cluster, who.user, 71)
    before = _footprint(cluster, who)
    assert who.act(action, params, route_level=declared) == {"ok": False, "error": "level_mismatch"}
    assert _footprint(cluster, who) == before == "0/0/0/0"


@pytest.mark.parametrize("declared", [None, "", "L0", "L4", "l2", "L2 ", "2", "high", "L1; DROP TABLE x"])
def test_a_missing_or_malformed_level_is_refused_for_every_action_before_anything_else(cluster, declared):
    who = Browser(cluster)
    for action in LEVEL_OF:
        assert who.act(action, {}, route_level=declared) == {"ok": False, "error": "level_mismatch"}, action
    assert who.act("nothing.at.all", route_level=declared) == {"ok": False, "error": "level_mismatch"}
    assert _footprint(cluster, who) == "0/0/0/0"


def test_a_route_that_declares_a_higher_level_is_stricter_than_needed_and_is_accepted(cluster):
    who = Browser(cluster)
    assert who.act("team.restart", {"target": "scout"}, route_level="L3")["state"] == "queued"
    assert who.act("position.apply_revoke", {"legacy_id": 1}, route_level="L1") == {"ok": False, "error": "not_found"}


def test_the_level_is_looked_at_again_on_the_second_call_and_the_line_stays_open(cluster):
    who = Browser(cluster)
    _position(cluster, who.user, 72)
    first = who.act("position.apply_authorize", {"legacy_id": 72})
    assert first["state"] == "awaiting_confirm"
    assert who.act("position.apply_authorize", confirm=first["id"], route_level="L2") == {"ok": False, "error": "level_mismatch"}
    assert _scalar(cluster, f"SELECT status FROM public.web_action_log WHERE id = '{first['id']}'") == "awaiting_confirm"
    assert _scalar(cluster, f"SELECT apply_requested FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 72") == "f"
    assert who.act("position.apply_authorize", confirm=first["id"])["state"] == "queued"


def test_the_level_check_comes_before_the_limit_the_login_and_the_parameters(cluster):
    who = Browser(cluster)
    assert who.act("team.restart", {"target": "nobody"}, route_level="L1", login_age_s=None) == {"ok": False, "error": "level_mismatch"}


# --------------------------------------------------------------------------------------------------
# the stamp of the desired state
# --------------------------------------------------------------------------------------------------

def _stamp(db, user: str) -> str:
    return _scalar(db, f"SELECT COALESCE(desired_changed_at::text, 'null') FROM public.team_state WHERE user_id = '{user}'")


def test_the_desired_state_is_stamped_when_it_changes_and_only_then(cluster):
    who = Browser(cluster)
    cluster(f"INSERT INTO public.team_state (user_id) VALUES ('{who.user}')")
    assert _stamp(cluster, who.user) == "null"                       # nothing desired yet
    cluster(f"UPDATE public.team_state SET is_running = true, last_user_activity_at = now() WHERE user_id = '{who.user}'")
    assert _stamp(cluster, who.user) == "null"                       # observed and presence are not desired
    cluster(f"UPDATE public.team_state SET should_run = true WHERE user_id = '{who.user}'")
    first = _stamp(cluster, who.user)
    assert first != "null"
    time.sleep(0.05)
    cluster(f"UPDATE public.team_state SET should_run = true, is_running = false WHERE user_id = '{who.user}'")
    assert _stamp(cluster, who.user) == first                        # the same value written again is not a change
    time.sleep(0.05)
    cluster(f"UPDATE public.team_state SET restart_token = gen_random_uuid() WHERE user_id = '{who.user}'")
    second = _stamp(cluster, who.user)
    assert second > first
    time.sleep(0.05)
    cluster(f"""UPDATE public.team_state SET agents_enabled = '{{"scout": true}}'::jsonb WHERE user_id = '{who.user}'""")
    third = _stamp(cluster, who.user)
    assert third > second
    cluster(f"""UPDATE public.team_state SET agents_enabled = '{{"scout": true}}'::jsonb WHERE user_id = '{who.user}'""")
    assert _stamp(cluster, who.user) == third


def test_a_row_born_with_a_desired_value_is_stamped_and_one_born_empty_is_not(cluster):
    on, empty, tokened = Browser(cluster), Browser(cluster), Browser(cluster)
    cluster(f"INSERT INTO public.team_state (user_id, should_run) VALUES ('{on.user}', true)")
    cluster(f"INSERT INTO public.team_state (user_id) VALUES ('{empty.user}')")
    cluster(f"INSERT INTO public.team_state (user_id, restart_token) VALUES ('{tokened.user}', gen_random_uuid())")
    assert _stamp(cluster, on.user) != "null" and _stamp(cluster, tokened.user) != "null"
    assert _stamp(cluster, empty.user) == "null"


def test_nobody_writes_the_stamp_by_hand_not_even_the_box(cluster):
    who = Browser(cluster)
    cluster(f"INSERT INTO public.team_state (user_id, desired_changed_at) VALUES ('{who.user}', '2001-01-01')")
    assert _stamp(cluster, who.user) == "null"
    cluster(f"UPDATE public.team_state SET should_run = true WHERE user_id = '{who.user}'")
    real = _stamp(cluster, who.user)
    done = who.script(f"UPDATE public.team_state SET desired_changed_at = '2001-01-01', is_running = true WHERE user_id = '{who.user}';",
                      role="service_role")
    assert done.returncode == 0, done.stderr
    assert _stamp(cluster, who.user) == real
    assert "permission denied for table team_state" in who.refused(
        f"UPDATE public.team_state SET desired_changed_at = now() WHERE user_id = '{who.user}';")
    assert "permission denied for table team_state" in who.refused(
        f"INSERT INTO public.team_state (user_id, desired_changed_at) VALUES ('{uuid.uuid4()}', now());")


def test_the_emergency_stop_through_the_door_stamps_the_change_it_makes(cluster):
    who = Browser(cluster)
    cluster(f"INSERT INTO public.team_state (user_id, should_run) VALUES ('{who.user}', true)")
    before = _stamp(cluster, who.user)
    time.sleep(0.05)
    assert who.act("team.emergency_stop")["ok"] is True
    assert _stamp(cluster, who.user) > before


# --------------------------------------------------------------------------------------------------
# 099: the door by families — what the door keeps, what a family may do, what it may not
# --------------------------------------------------------------------------------------------------

def _stages(db, who, stage: str | None = None) -> int:
    where = f" AND stage = '{stage}'" if stage else ""
    return int(_scalar(db, f"SELECT count(*) FROM public.demo_effects WHERE uid = '{who.user}'{where}"))


def test_the_private_schema_holds_the_vocabulary_and_every_family_and_no_browser_role_reaches_it(cluster):
    who = Browser(cluster)
    assert _scalar(cluster, "SELECT has_schema_privilege('authenticated', 'web_door', 'USAGE') OR has_schema_privilege('anon', 'web_door', 'USAGE')") == "f"
    functions = _scalar(cluster, """SELECT string_agg(p.oid::regprocedure::text, ',') FROM pg_proc AS p
        WHERE p.pronamespace = 'web_door'::regnamespace""")
    assert "web_door.ext_team" in functions and "web_door.ext_position" in functions and "web_door.ext_demo" in functions
    for role in ("anon", "authenticated"):
        assert _scalar(cluster, f"""SELECT bool_or(has_function_privilege('{role}', p.oid, 'EXECUTE')) FROM pg_proc AS p
            WHERE p.pronamespace = 'web_door'::regnamespace""") == "f"
    # a family function can not be called with another uid by a browser, whatever its own grants say
    assert "permission denied for schema web_door" in who.refused(
        f"SELECT web_door.ext_demo('effect', 'demo.sync', '{uuid.uuid4()}', '{{}}'::jsonb, NULL, NULL);")
    assert "permission denied for schema web_door" in who.refused(
        f"SELECT web_door.call_ext('demo', 'effect', 'demo.sync', '{uuid.uuid4()}', '{{}}'::jsonb, NULL, NULL);")


def test_the_log_action_is_a_foreign_key_to_the_vocabulary(cluster):
    who = Browser(cluster)
    done = cluster(f"""INSERT INTO public.web_action_log (user_id, action, level, summary, status)
        VALUES ('{who.user}', 'demo.nothing', 'L1', 'x', 'queued')""", check=False)
    assert done.returncode != 0 and "web_action_log_action_in_vocab" in done.stderr, done.stderr
    cluster(f"""INSERT INTO public.web_action_log (user_id, action, level, summary, status)
        VALUES ('{who.user}', 'demo.sync', 'L1', 'x', 'queued')""")


def test_the_vocabulary_keeps_its_shape_even_for_the_migrations(cluster):
    for values in ("('nodot', 'nodot', 'L1', TRUE, 'g', 1, INTERVAL '1 hour', FALSE, 256)",
                   "('a.b', 'other', 'L1', TRUE, 'g', 1, INTERVAL '1 hour', FALSE, 256)",
                   "('a.b', 'a', 'L9', TRUE, 'g', 1, INTERVAL '1 hour', FALSE, 256)",
                   "('a.b', 'a', 'L1', TRUE, 'g', 0, INTERVAL '1 hour', FALSE, 256)",
                   "('a.b', 'a', 'L1', TRUE, 'g', 1, INTERVAL '1 hour', FALSE, 4096)"):
        done = cluster(f"INSERT INTO web_door.vocab (action, family, level, recent, cap_group, cap_n, cap_window, takes_body, params_max_bytes) VALUES {values}", check=False)
        assert done.returncode != 0 and "violates check constraint" in done.stderr, values


def test_the_text_is_saved_normalised_by_the_family_and_the_confirmation_uses_the_saved_one(cluster):
    who = Browser(cluster)
    first = who.act("demo.danger", {}, route_level="L2", body="  first line\nsecond\tline  ")
    assert first["ok"] and first["state"] == "awaiting_confirm", first
    assert _scalar(cluster, f"SELECT body FROM public.web_action_log WHERE id = '{first['id']}'") == "first line\nsecond\tline"
    assert _stages(cluster, who, "effect") == 0                      # nothing happens before the confirmation
    # the second call can not bring another text, nor a parameter
    assert who.act("demo.danger", confirm=first["id"], route_level="L2", body="another") == {"ok": False, "error": "invalid_params"}
    assert _stages(cluster, who, "effect") == 0
    second = who.act("demo.danger", confirm=first["id"], route_level="L2")
    assert second["ok"] and second["state"] == "queued"
    row = _scalar(cluster, f"SELECT stage, log_id = '{first['id']}', body FROM public.demo_effects WHERE uid = '{who.user}' AND stage = 'effect'")
    assert row == "effect|t|first line\nsecond\tline"               # the saved text, with the id of the line


@pytest.mark.parametrize("text, ok", [
    ("x" * 2000, True), ("x" * 2001, False), ("a\x07b", False), ("tab\there\r\nline", True), ("", True), ("\x7f", False),
])
def test_the_text_has_a_size_and_no_control_character_but_the_line_break_and_the_tab(cluster, text, ok):
    who = Browser(cluster)
    answer = who.act("demo.note", {}, route_level="L1", body=text)
    assert answer.get("ok") is ok, answer
    if not ok:
        assert answer == {"ok": False, "error": "invalid_params"}
        assert _stages(cluster, who) == 0


def test_only_an_action_that_takes_a_text_may_have_one(cluster):
    who = Browser(cluster)
    assert who.act("demo.sync", {}, route_level="L1", body="a text") == {"ok": False, "error": "invalid_params"}
    assert who.act("team.restart", {"target": "scout"}, body="a text") == {"ok": False, "error": "invalid_params"}
    assert who.act("position.apply_revoke", {"legacy_id": 1}, body="a text") == {"ok": False, "error": "invalid_params"}
    assert _footprint(cluster, who) == "0/0/0/0" and _stages(cluster, who) == 0


def test_a_family_that_answers_a_text_it_can_not_take_is_a_bug_and_goes_back(cluster):
    who = Browser(cluster)
    done = who.script("""SELECT public.request_action('demo.sync', '{"broken":"bodynottaken"}'::jsonb, NULL, 'L1', NULL);""")
    assert done.returncode != 0 and "answered with a text it can not take" in done.stderr
    assert _scalar(cluster, f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}'") == "0"


def test_the_room_of_the_parameters_is_the_one_of_the_action(cluster):
    who = Browser(cluster)
    assert who.act("demo.note", {"pad": "x" * 700}, route_level="L1")["ok"] is True            # 1024 for this one
    assert who.act("demo.note", {"pad": "x" * 1100}, route_level="L1") == {"ok": False, "error": "invalid_params"}
    assert who.act("demo.sync", {"pad": "x" * 300}, route_level="L1") == {"ok": False, "error": "invalid_params"}   # the default 256
    assert who.act("team.restart", {"target": "scout", "pad": "x" * 300}) == {"ok": False, "error": "invalid_params"}
    # a family that answers parameters beyond the room of its action is a bug
    done = who.script("""SELECT public.request_action('demo.sync', '{"broken":"bigparams"}'::jsonb, NULL, 'L1', NULL);""")
    assert done.returncode != 0 and "out of shape" in done.stderr
    assert _scalar(cluster, f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}' AND action = 'demo.sync'") == "0"


def test_the_state_of_the_line_is_the_one_the_family_returns_and_the_bus_id_is_kept(cluster):
    who = Browser(cluster)
    plain = who.act("demo.sync", {}, route_level="L1")
    done = who.act("demo.sync", {"done": "t"}, route_level="L1")
    bus = who.act("demo.sync", {"cmd": "t"}, route_level="L1")
    assert [plain["state"], done["state"], bus["state"]] == ["queued", "done", "queued"]   # the caller sees the state the family returned
    assert _scalar(cluster, f"SELECT status FROM public.web_action_log WHERE id = '{plain['id']}'") == "queued"
    assert _scalar(cluster, f"SELECT status FROM public.web_action_log WHERE id = '{done['id']}'") == "done"
    assert "command_id" in bus and "command_id" not in done
    assert _scalar(cluster, f"SELECT command_id = '{bus['command_id']}' FROM public.web_action_log WHERE id = '{bus['id']}'") == "t"
    # a line that is done counts for the limit like any other
    assert _scalar(cluster, f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}' AND status = 'done'") == "1"


@pytest.mark.parametrize("code", ["invalid_params", "not_found", "position_not_ready", "already_submitted"])
def test_a_family_may_refuse_with_the_closed_codes_and_nothing_stays(cluster, code):
    who = Browser(cluster)
    assert who.act("demo.sync", {"fail": code}, route_level="L1") == {"ok": False, "error": code}
    assert _scalar(cluster, f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}'") == "0"
    assert _stages(cluster, who, "effect") == 0


def test_a_refusal_of_the_effect_cancels_the_line_and_says_the_code(cluster):
    who = Browser(cluster)
    answer = who.act("demo.sync", {"effect_error": "not_found"}, route_level="L1")
    assert answer == {"ok": False, "error": "not_found"}
    assert _scalar(cluster, f"SELECT status, result FROM public.web_action_log WHERE user_id = '{who.user}'") == "cancelled|not_found"


@pytest.mark.parametrize("params, message", [
    ({"fail": "a_code_nobody_knows"}, "outside the contract"),
    ({"effect_error": "a_code_nobody_knows"}, "outside the contract"),
    ({"broken": "nothing"}, "answered nothing usable"),
    ({"broken": "array"}, "answered nothing usable"),
    ({"broken": "nosummary"}, "out of shape"),
    ({"broken": "noconfirm"}, "out of shape"),
    ({"broken": "emptysummary"}, "without a summary"),
])
def test_a_family_that_breaks_the_contract_is_a_bug_the_transaction_goes_back_and_nothing_stays(cluster, params, message):
    who = Browser(cluster)
    done = who.script(f"SELECT public.request_action('demo.sync', $p${json.dumps(params)}$p$::jsonb, NULL, 'L1', NULL);")
    assert done.returncode != 0 and message in done.stderr, done.stderr
    assert _scalar(cluster, f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}'") == "0"
    assert _scalar(cluster, f"SELECT count(*) FROM public.demo_effects WHERE uid = '{who.user}' AND stage = 'effect'") == "0"


def test_a_family_that_is_not_there_is_a_bug_and_goes_back(cluster):
    who = Browser(cluster)
    done = who.script("SELECT public.request_action('ghost.act', '{}'::jsonb, NULL, 'L1', NULL);")
    assert done.returncode != 0 and "has no function" in done.stderr
    assert _scalar(cluster, f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}'") == "0"


def test_the_family_is_reached_only_after_the_things_the_door_keeps(cluster):
    """Level, session, parameters shape and the limit come first: the family hears nothing before them."""
    who = Browser(cluster)
    assert who.act("demo.danger", {}, route_level="L1") == {"ok": False, "error": "level_mismatch"}
    assert who.act("demo.danger", {"pad": "x" * 300}, route_level="L2") == {"ok": False, "error": "invalid_params"}
    assert who.act("demo.danger", {}, route_level="L2", body="x" * 3000) == {"ok": False, "error": "invalid_params"}
    assert _stages(cluster, who) == 0
    for _ in range(50):
        who.act("demo.sync", {}, route_level="L1")
    assert who.act("demo.sync", {}, route_level="L1")["error"] == "rate_limited"
    assert _stages(cluster, who, "prepare") == 51          # the last one was asked, and refused by the limit
    assert _stages(cluster, who, "effect") == 50


def test_the_confirmation_of_a_family_action_asks_the_family_again_at_the_effect(cluster):
    who = Browser(cluster)
    first = who.act("demo.danger", {"effect_error": "already_submitted"}, route_level="L2", body="b")
    assert first["state"] == "awaiting_confirm"
    assert _stages(cluster, who, "prepare") == 1 and _stages(cluster, who, "effect") == 0
    assert who.act("demo.danger", confirm=first["id"], route_level="L2") == {"ok": False, "error": "already_submitted"}
    assert _scalar(cluster, f"SELECT status, result FROM public.web_action_log WHERE id = '{first['id']}'") == "cancelled|already_submitted"

"""JHT web capace, phase 4 — migration 101: exclusions and standing orders through the single door.

Runs on PostgreSQL the series 098 (the door), 099 (the door by families), 100 if it is there, and 101,
the last one twice (applied by hand, possibly again). It reuses the database shaped like the live one
of tests/test_web_action_door_postgres.py, and adds what phase 4 touches, as it is on the cloud:
- positions with the columns of the user's decision (user_excluded_*) and last_actor;
- profile_exclusions (094) with its policies and the grants every table of `public` is born with;
- team_directives with its real columns, pending_user_messages, and the RPC of 079 executable by
  the signed-in role (the way in that 101 closes).

What must hold:
- a browser role cannot write the user's decision on a position, profile_exclusions, or execute the RPC
  of 079 or the functions of the families (web_door.ext_exclusion, web_door.ext_directive); it still writes status and the other columns of its own
  positions (the user's sync does);
- through the door: an exclusion and its withdrawal are L1 and take effect at once; the note is the
  body, kept in the log, never in the summary; a second exclusion keeps the first status before it;
  withdrawing what the user never excluded changes nothing;
- creating or editing a standing order needs the confirmation, and what is written is the text saved at
  the first call; the row says origin = 'web', and the Captain gets the wake-up event of 079;
- every parameter outside the closed shape is invalid_params; somebody else's row is not_found;
- the reasons in the migration are the ones of shared/feedback-reasons.json (this one runs without
  PostgreSQL).
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import uuid
import os
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest

import test_web_action_door_postgres as door

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
M101 = MIGRATIONS / "101_web_action_exclusions_directives.sql"
REASONS = json.loads((ROOT / "shared" / "feedback-reasons.json").read_text())

EXTRA = """
ALTER TABLE public.positions
  ADD COLUMN user_excluded_reason text,
  ADD COLUMN user_excluded_note text,
  ADD COLUMN user_excluded_at timestamptz,
  ADD COLUMN user_excluded_prev_status text,
  ADD COLUMN last_actor text;

ALTER TABLE public.team_directives
  ADD COLUMN kind text NOT NULL DEFAULT 'order' CHECK (kind IN ('order', 'strategy', 'formation', 'note')),
  ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN created_by text NOT NULL DEFAULT 'user',
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN source_id text;
CREATE POLICY "users update own team directives" ON public.team_directives FOR UPDATE
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE TABLE public.pending_user_messages (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  legacy_id bigint,
  agent text NOT NULL,
  body text NOT NULL,
  kind text NOT NULL DEFAULT 'notification',
  author text NOT NULL DEFAULT 'agent',
  source_id text,
  source_action text,
  source_payload text,
  source_directive_id bigint,
  created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.pending_user_messages ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.profile_exclusions (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('too_senior', 'too_junior', 'wrong_location', 'salary_low', 'wrong_stack', 'company')),
  status text NOT NULL CHECK (status IN ('accepted', 'dismissed')),
  positions_at_decision integer NOT NULL DEFAULT 0 CHECK (positions_at_decision >= 0),
  decided_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, reason));
ALTER TABLE public.profile_exclusions ENABLE ROW LEVEL SECURITY;
CREATE POLICY profile_exclusions_select_own ON public.profile_exclusions FOR SELECT USING ((SELECT auth.uid()) = user_id);
CREATE POLICY profile_exclusions_insert_own ON public.profile_exclusions FOR INSERT WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY profile_exclusions_update_own ON public.profile_exclusions FOR UPDATE
  USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY profile_exclusions_delete_own ON public.profile_exclusions FOR DELETE USING ((SELECT auth.uid()) = user_id);

-- The RPC of 079 as the browser sees it on the cloud: a definer, executable by the signed-in role.
CREATE FUNCTION public.mutate_team_directive_with_event(p_id bigint, p_action text, p_body text, p_kind text, p_request_id text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $f$ SELECT '{}'::jsonb $f$;
REVOKE ALL ON FUNCTION public.mutate_team_directive_with_event(bigint, text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mutate_team_directive_with_event(bigint, text, text, text, text) TO authenticated;
"""


def _series() -> list[Path]:
    """098, 099, 100 if it is there, then 101: the order of application."""
    files = []
    for number in ("098", "099", "100"):
        found = sorted(MIGRATIONS.glob(f"{number}_*.sql"))
        if number == "100" and not found:
            continue
        if len(found) != 1:
            return []
        files.append(found[0])
    return files


@pytest.fixture(scope="module")
def cluster(tmp_path_factory):
    series = _series()
    if not series:
        pytest.skip("the series 098-099 is not in supabase/migrations yet: 101 sits on the door by families")
    work = tmp_path_factory.mktemp("web-action-phase4")

    def prepare(psql):
        psql(door.BOOTSTRAP)
        psql(EXTRA)
        for path in series:
            psql(file=path)
        psql(file=M101)
        psql(file=M101)              # applied by hand, possibly twice
        psql.work = work

    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    if external_url:
        client = door._tool("psql")
        parsed = urlparse(external_url)
        if not client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL needs psql and a valid host")
        database = f"jht_web_action_phase4_{uuid.uuid4().hex[:12]}"
        admin = door._runner([client, *door.PSQL_FLAGS, "-d", external_url], None)
        admin(f'CREATE DATABASE "{database}";')
        psql = door._runner([client, *door.PSQL_FLAGS, "-d", urlunparse(parsed._replace(path=f"/{database}"))], None)
        try:
            prepare(psql)
            yield psql
        finally:
            admin(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE);', check=False)
        return

    tools = {name: door._tool(name) for name in ("initdb", "pg_ctl", "psql", "postgres")}
    if not all(tools.values()):
        pytest.skip("no JHT_TEST_POSTGRES_URL and no local Postgres server binaries")
    root = Path(tempfile.mkdtemp(prefix="jht-pg-101-", dir="/tmp"))
    data, sock = root / "data", root / "sock"
    sock.mkdir()
    env = {**os.environ, "LC_ALL": "C", "PGHOST": str(sock), "PGUSER": "postgres", "PGDATABASE": "postgres"}
    subprocess.run([tools["initdb"], "-D", str(data), "-A", "trust", "-U", "postgres", "--no-sync"],
                   check=True, capture_output=True, env=env, timeout=120)
    subprocess.run([tools["pg_ctl"], "-D", str(data), "-l", str(root / "postgres.log"), "-w", "-s",
                    "-o", f"-c listen_addresses='' -k {sock} -c fsync=off", "start"],
                   check=True, capture_output=True, env=env, timeout=120)
    psql = door._runner([tools["psql"], *door.PSQL_FLAGS], env)
    try:
        prepare(psql)
        yield psql
    finally:
        subprocess.run([tools["pg_ctl"], "-D", str(data), "-m", "immediate", "-w", "-s", "stop"],
                       capture_output=True, env=env, timeout=60, check=False)
        shutil.rmtree(root, ignore_errors=True)


LEVEL = {"exclusion.decide": "L1", "exclusion.withdraw": "L1", "exclusion.profile_set": "L1",
         "directive.create": "L2", "directive.update": "L2", "directive.archive": "L1"}


def _dollar(text: str, tag: str) -> str:
    assert f"${tag}$" not in text
    return f"${tag}${text}${tag}$"


def act(who: door.Browser, action: str, params: dict | None = None, *, body: str | None = None,
        confirm: str | None = None) -> dict:
    args = [_dollar(action, "a"), _dollar(json.dumps(params if params is not None else {}), "p") + "::jsonb",
            f"'{confirm}'::uuid" if confirm else "NULL", f"'{LEVEL[action]}'",
            _dollar(body, "b") if body is not None else "NULL"]
    done = who.script(f"SELECT public.request_action({', '.join(args)});")
    assert done.returncode == 0, done.stderr
    lines = [line for line in done.stdout.splitlines() if line.startswith("{")]
    assert len(lines) == 1, done.stdout
    return json.loads(lines[0])


def _row(db, sql: str) -> list[str]:
    return door._scalar(db, sql).split("|")


def _directive(db, user: str, text: str = "an order", status: str = "active") -> int:
    return int(door._scalar(db, f"""INSERT INTO public.team_directives (user_id, body, status)
        VALUES ('{user}', {_dollar(text, "t")}, '{status}') RETURNING id""").splitlines()[0])


# --------------------------------------------------------------------------------------------------
# the reasons: one list (no PostgreSQL needed)
# --------------------------------------------------------------------------------------------------

def _in_list_after(sql: str, variable: str) -> list[str]:
    match = re.search(rf"IF {variable} NOT IN \(([^)]*)\)", sql)
    assert match, variable
    return re.findall(r"'([a-z_]+)'", match.group(1))


def test_the_reasons_of_the_migration_are_those_of_the_catalogue():
    sql = M101.read_text()
    first, second = [m.group(1) for m in re.finditer(r"IF v_reason NOT IN \(([^)]*)\)", sql)]
    assert re.findall(r"'([a-z_]+)'", first) == REASONS["proposable"]
    assert re.findall(r"'([a-z_]+)'", second) == REASONS["reasons"]
    assert f"> {REASONS['note_max_chars']} THEN" in sql


# --------------------------------------------------------------------------------------------------
# the ways in that 101 closes
# --------------------------------------------------------------------------------------------------

def test_the_user_decision_on_a_position_is_written_only_by_the_door(cluster):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 11, status="scored")
    for statement in (
        "UPDATE public.positions SET user_excluded_reason = 'other' WHERE legacy_id = 11;",
        "UPDATE public.positions SET user_excluded_at = now() WHERE legacy_id = 11;",
        "UPDATE public.positions SET user_excluded_prev_status = 'new' WHERE legacy_id = 11;",
        "UPDATE public.positions SET user_excluded_note = 'x' WHERE legacy_id = 11;",
        f"INSERT INTO public.positions (user_id, legacy_id, user_excluded_reason) VALUES ('{who.user}', 12, 'other');",
    ):
        assert "user_exclusion_is_door_only" in who.refused(statement), statement
    # the user's sync still writes status and the other columns of its own positions
    done = who.script("UPDATE public.positions SET status = 'excluded', title = 'renamed' WHERE legacy_id = 11;")
    assert done.returncode == 0, done.stderr
    assert _row(cluster, f"SELECT status, title FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 11") \
        == ["excluded", "renamed"]


def test_profile_exclusions_and_the_rpc_of_079_are_closed_to_the_browser(cluster):
    who = door.Browser(cluster)
    for statement in (
        f"INSERT INTO public.profile_exclusions (user_id, reason, status) VALUES ('{who.user}', 'company', 'accepted');",
        "UPDATE public.profile_exclusions SET status = 'dismissed';",
        "DELETE FROM public.profile_exclusions;",
        "SELECT public.mutate_team_directive_with_event(0, 'created', 'x', 'order', 'r1');",
    ):
        assert "permission denied" in who.refused(statement), statement
    assert who.script("SELECT count(*) FROM public.profile_exclusions;").returncode == 0
    for function in ("ext_exclusion", "ext_directive"):
        for role in ("anon", "authenticated", "service_role"):
            assert door._scalar(cluster, f"""SELECT has_function_privilege('{role}',
                'web_door.{function}(text,text,uuid,jsonb,text,uuid)', 'EXECUTE')""") == "f", (function, role)


# --------------------------------------------------------------------------------------------------
# exclusions
# --------------------------------------------------------------------------------------------------

def test_an_exclusion_takes_effect_at_once_with_its_note_kept_out_of_the_summary(cluster):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 21, status="scored")
    answer = act(who, "exclusion.decide", {"legacy_id": 21, "reason": "wrong_stack"}, body="  only Java here  ")
    assert answer["ok"] is True and answer["state"] in ("queued", "done"), answer
    assert _row(cluster, f"""SELECT status, user_excluded_reason, user_excluded_note, user_excluded_prev_status,
        user_excluded_at IS NOT NULL, last_actor FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 21""") \
        == ["excluded", "wrong_stack", "only Java here", "scored", "t", "user"]
    log = _row(cluster, f"SELECT body, summary FROM public.web_action_log WHERE user_id = '{who.user}'")
    assert log[0] == "only Java here"
    assert "Java" not in log[1]

    # a second exclusion keeps the status before the first
    act(who, "exclusion.decide", {"legacy_id": 21, "reason": "other"})
    assert _row(cluster, f"""SELECT user_excluded_reason, user_excluded_note, user_excluded_prev_status
        FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 21""") == ["other", "", "scored"]

    act(who, "exclusion.withdraw", {"legacy_id": 21})
    assert _row(cluster, f"""SELECT status, user_excluded_reason IS NULL, user_excluded_at IS NULL,
        user_excluded_prev_status IS NULL FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 21""") \
        == ["scored", "t", "t", "t"]


def test_an_application_that_already_left_is_not_excluded(cluster):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 25, status="applied")
    door._position(cluster, who.user, 26, status="ready", applied=True)   # the application left, the status lags
    door._position(cluster, who.user, 27, status="response")
    for legacy in (25, 26, 27):
        answer = act(who, "exclusion.decide", {"legacy_id": legacy, "reason": "other"})
        assert answer == {"ok": False, "error": "already_submitted"}, (legacy, answer)
    assert door._scalar(cluster, f"""SELECT count(*) FROM public.positions
        WHERE user_id = '{who.user}' AND user_excluded_at IS NOT NULL""") == "0"
    # nothing was written in the log as queued or done
    assert door._scalar(cluster, f"""SELECT count(*) FROM public.web_action_log
        WHERE user_id = '{who.user}' AND status IN ('queued', 'done')""") == "0"


def test_withdrawing_what_the_user_never_excluded_changes_nothing(cluster):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 22, status="excluded")      # excluded by the team, not by the user
    act(who, "exclusion.withdraw", {"legacy_id": 22})
    assert door._scalar(cluster, f"SELECT status FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 22") \
        == "excluded"


@pytest.mark.parametrize("action,params,body", [
    ("exclusion.decide", {"legacy_id": 31, "reason": "not_interested"}, None),   # an old code: the route maps it
    ("exclusion.decide", {"legacy_id": 31, "reason": "other", "extra": 1}, None),
    ("exclusion.decide", {"legacy_id": "31", "reason": "other"}, None),
    ("exclusion.decide", {"legacy_id": 31}, None),
    ("exclusion.decide", {"legacy_id": 31, "reason": "other"}, "x" * 201),
    ("exclusion.decide", {"legacy_id": 0, "reason": "other"}, None),
    ("exclusion.withdraw", {"legacy_id": 31}, "a note"),
    ("exclusion.withdraw", {"legacy_id": 31, "reason": "other"}, None),
    ("exclusion.profile_set", {"reason": "closed", "status": "accepted"}, None),
    ("exclusion.profile_set", {"reason": "company", "status": "maybe"}, None),
    ("exclusion.profile_set", {"reason": "company", "status": "accepted", "positions": -1}, None),
    ("exclusion.profile_set", {"reason": "company", "status": "accepted", "positions": 1.5}, None),
    ("directive.create", {"kind": "order"}, "   "),
    ("directive.create", {"kind": "order"}, "x" * 2001),
    ("directive.create", {"kind": "law"}, "an order"),
    ("directive.create", {"kind": "order", "id": 1}, "an order"),
    ("directive.update", {"id": "1"}, "a new text"),
    ("directive.archive", {"id": 1}, "why"),
])
def test_every_shape_outside_the_closed_one_is_invalid(cluster, action, params, body):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 31, status="scored")
    answer = act(who, action, params, body=body)
    assert answer == {"ok": False, "error": "invalid_params"} or answer.get("error") == "invalid_params", answer
    assert door._scalar(cluster, f"SELECT user_excluded_at IS NULL FROM public.positions WHERE user_id = '{who.user}'") == "t"


def test_somebody_else_s_rows_are_not_found(cluster):
    owner, other = door.Browser(cluster), door.Browser(cluster)
    door._position(cluster, owner.user, 41, status="scored")
    directive = _directive(cluster, owner.user)
    assert act(other, "exclusion.decide", {"legacy_id": 41, "reason": "other"}).get("error") == "not_found"
    assert act(other, "directive.update", {"id": directive}, body="mine now").get("error") == "not_found"
    assert act(other, "directive.archive", {"id": directive}).get("error") == "not_found"
    assert door._scalar(cluster, f"SELECT body FROM public.team_directives WHERE id = {directive}") == "an order"


def test_a_decision_of_the_profile_is_one_row_per_reason(cluster):
    who = door.Browser(cluster)
    act(who, "exclusion.profile_set", {"reason": "company", "status": "accepted", "positions": 4})
    act(who, "exclusion.profile_set", {"reason": "company", "status": "dismissed"})
    assert _row(cluster, f"""SELECT count(*), max(status), max(positions_at_decision)
        FROM public.profile_exclusions WHERE user_id = '{who.user}'""") == ["1", "dismissed", "0"]


# --------------------------------------------------------------------------------------------------
# standing orders
# --------------------------------------------------------------------------------------------------

def test_a_standing_order_is_written_after_the_confirmation_with_the_saved_text(cluster):
    who = door.Browser(cluster)
    first = act(who, "directive.create", {"kind": "strategy"}, body="  CVs only for 90+  ")
    assert first["ok"] is True and first["state"] == "awaiting_confirm", first
    assert "CVs only for 90+" in first["summary"]
    assert door._scalar(cluster, f"SELECT count(*) FROM public.team_directives WHERE user_id = '{who.user}'") == "0"

    # the confirmation does not bring a text: the saved one is written
    assert act(who, "directive.create", confirm=first["id"], body="something else").get("error") == "invalid_params"
    second = act(who, "directive.create", confirm=first["id"])
    assert second["ok"] is True, second
    assert _row(cluster, f"""SELECT body, kind, origin, created_by, status FROM public.team_directives
        WHERE user_id = '{who.user}'""") == ["CVs only for 90+", "strategy", "web", "user", "active"]
    assert _row(cluster, f"""SELECT agent, body, source_action, source_payload FROM public.pending_user_messages
        WHERE user_id = '{who.user}'""") == ["capitano", "[TEAM-DIRECTIVE] created", "created", "CVs only for 90+"]
    assert door._scalar(cluster, f"SELECT chat_requested_at IS NOT NULL FROM public.team_state WHERE user_id = '{who.user}'") == "t"


def test_editing_marks_the_order_as_written_by_the_website_and_archiving_is_at_once(cluster):
    who = door.Browser(cluster)
    directive = _directive(cluster, who.user, "written in the team's chat")
    assert door._scalar(cluster, f"SELECT origin FROM public.team_directives WHERE id = {directive}") == "desktop"
    first = act(who, "directive.update", {"id": directive}, body="written on the website")
    assert first["state"] == "awaiting_confirm", first
    act(who, "directive.update", confirm=first["id"])
    assert _row(cluster, f"SELECT body, origin FROM public.team_directives WHERE id = {directive}") \
        == ["written on the website", "web"]

    answer = act(who, "directive.archive", {"id": directive})
    assert answer["ok"] is True and answer["state"] in ("queued", "done"), answer
    assert door._scalar(cluster, f"SELECT status FROM public.team_directives WHERE id = {directive}") == "archived"
    assert act(who, "directive.archive", {"id": directive}).get("error") == "not_found"


def test_an_order_archived_between_the_two_calls_is_not_edited(cluster):
    who = door.Browser(cluster)
    directive = _directive(cluster, who.user)
    first = act(who, "directive.update", {"id": directive}, body="too late")
    cluster(f"UPDATE public.team_directives SET status = 'archived' WHERE id = {directive}")
    assert act(who, "directive.update", confirm=first["id"]).get("error") == "not_found"
    assert door._scalar(cluster, f"SELECT body FROM public.team_directives WHERE id = {directive}") == "an order"

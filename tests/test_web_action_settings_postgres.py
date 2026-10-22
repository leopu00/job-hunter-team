"""JHT web capace, phase 6 — migration 100: the settings the site may change on the box, through the door.

Run for real on PostgreSQL, on top of 098 and 099, each applied twice (the operator applies them by
hand), with the bootstrap and the browser of tests/test_web_action_door_postgres.py: the roles of the
project, their default grants in `public`, the policies of team_state, and `SET ROLE authenticated`
with the claims of a token, one transaction per request, as PostgREST does.

What must hold:
- settings.update is an L2 action of the door: a recent session, at most 20 an hour, a route that
  declares L2; no two-step confirmation, and the log row is `done` at once;
- only working_hours and role_models, with the lists of shared/config/schema.ts and of the box
  (cli/src/lib/team-settings.js); anything else is invalid_params, and nothing is written;
- the effect is a desire in team_state.desired_settings, the given keys over the previous ones, with
  desired_settings_at stamped by the database: never a value a client or the box sends;
- no browser role can write the three new columns or call the family.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest

from test_web_action_door_postgres import (
    BOOTSTRAP,
    MIGRATION,
    MIGRATION_099,
    PSQL_FLAGS,
    ROOT,
    Browser,
    _runner,
    _scalar,
    _tool,
)

MIGRATION_100 = ROOT / "supabase" / "migrations" / "100_web_action_settings.sql"
MIGRATIONS = (MIGRATION, MIGRATION_099, MIGRATION_100)

OFFICE = {"timezone": "Europe/Rome",
          "windows": [{"days": ["mon", "tue", "wed", "thu", "fri"], "start": "09:00", "end": "18:00"}]}
ROLES = ["capitano", "scout", "analista", "scorer", "scrittore", "critico", "sentinella", "assistente",
         "mentor", "closer"]


@pytest.fixture(scope="module")
def cluster(tmp_path_factory):
    work = tmp_path_factory.mktemp("web-action-settings")
    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    if external_url:
        client = _tool("psql")
        parsed = urlparse(external_url)
        if not client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL needs psql and a valid host")
        database = f"jht_web_action_settings_{uuid.uuid4().hex[:12]}"
        admin = _runner([client, *PSQL_FLAGS, "-d", external_url], None)
        admin(f'CREATE DATABASE "{database}";')
        psql = _runner([client, *PSQL_FLAGS, "-d", urlunparse(parsed._replace(path=f"/{database}"))], None)
        try:
            psql(BOOTSTRAP)
            for migration in MIGRATIONS:
                psql(file=migration)
                psql(file=migration)
            psql.work = work
            yield psql
        finally:
            admin(f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE);', check=False)
        return

    tools = {name: _tool(name) for name in ("initdb", "pg_ctl", "psql", "postgres")}
    if not all(tools.values()):
        pytest.skip("no JHT_TEST_POSTGRES_URL and no local Postgres server binaries")
    root = Path(tempfile.mkdtemp(prefix="jht-pg-100-", dir="/tmp"))
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
        for migration in MIGRATIONS:
            psql(file=migration)
            psql(file=migration)
        psql.work = work
        yield psql
    finally:
        subprocess.run([tools["pg_ctl"], "-D", str(data), "-m", "immediate", "-w", "-s", "stop"],
                       capture_output=True, env=env, timeout=60, check=False)
        shutil.rmtree(root, ignore_errors=True)


def _update(who: Browser, params: dict, **kw) -> dict:
    kw.setdefault("route_level", "L2")
    return who.act("settings.update", params, **kw)


def _desire(db, user: str) -> tuple[dict | None, str]:
    row = _scalar(db, f"SELECT COALESCE(desired_settings::text, 'null') || '|' || COALESCE(desired_settings_at::text, '')"
                      f"  FROM public.team_state WHERE user_id = '{user}'")
    if not row:
        return None, ""
    settings, at = row.split("|", 1)
    return json.loads(settings), at


def _log_status(db, user: str) -> list[str]:
    return _scalar(db, f"SELECT string_agg(status, ',' ORDER BY created_at) FROM public.web_action_log "
                       f"WHERE user_id = '{user}' AND action = 'settings.update'").split(",")


# --------------------------------------------------------------------------------------------------
# the boundary
# --------------------------------------------------------------------------------------------------

def test_the_family_is_private_and_a_definer(cluster):
    who = Browser(cluster)
    row = _scalar(cluster, """SELECT prosecdef, proconfig = ARRAY['search_path=""'] FROM pg_proc
                              WHERE proname = 'ext_settings' AND pronamespace = 'web_door'::regnamespace""")
    assert row == "t|t", row
    assert "permission denied for schema web_door" in who.refused(
        f"SELECT web_door.ext_settings('effect', 'settings.update', '{who.user}', '{{}}'::jsonb, NULL, NULL);")


@pytest.mark.parametrize("column, value", [
    ("desired_settings", "'{\"role_models\": {}}'::jsonb"),
    ("desired_settings_at", "now()"),
    ("settings_applied_at", "now()"),
])
def test_a_browser_role_cannot_write_the_new_columns(cluster, column, value):
    who = Browser(cluster)
    cluster(f"INSERT INTO public.team_state (user_id) VALUES ('{who.user}')")
    assert "permission denied" in who.refused(
        f"UPDATE public.team_state SET {column} = {value} WHERE user_id = '{who.user}';")
    assert "permission denied" in who.refused(
        f"UPDATE public.team_state SET {column} = {value} WHERE user_id = '{who.user}';", role="anon")


# --------------------------------------------------------------------------------------------------
# the action
# --------------------------------------------------------------------------------------------------

def test_an_update_writes_the_desire_with_the_database_stamp_and_is_done_at_once(cluster):
    who = Browser(cluster)
    reply = _update(who, {"working_hours": OFFICE})
    assert reply["ok"] is True, reply
    assert reply["level"] == "L2"
    assert "working hours: 1 blocks, Europe/Rome" in reply["summary"]
    settings, at = _desire(cluster, who.user)
    assert settings == {"working_hours": OFFICE}
    assert at and _scalar(cluster, f"SELECT now() - '{at}'::timestamptz < interval '1 minute'") == "t"
    assert _log_status(cluster, who.user) == ["done"]


def test_the_given_keys_go_over_the_previous_desire(cluster):
    who = Browser(cluster)
    _update(who, {"working_hours": OFFICE})
    first = _desire(cluster, who.user)[1]
    assert _update(who, {"role_models": {"scout": {"model": "luna", "effort": "medium"}}})["ok"] is True
    settings, second = _desire(cluster, who.user)
    assert settings == {"working_hours": OFFICE, "role_models": {"scout": {"model": "luna", "effort": "medium"}}}
    assert second >= first
    # null takes the working hours away: the team works 24/7
    assert _update(who, {"working_hours": None})["ok"] is True
    assert _desire(cluster, who.user)[0]["working_hours"] is None


def test_the_longest_valid_settings_fit_the_action_limit(cluster):
    who = Browser(cluster)
    longest = {
        "working_hours": {"timezone": "America/Argentina/Buenos_Aires",
                          "windows": [{"days": [d], "start": "09:00", "end": "18:00"}
                                      for d in ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]]},
        "role_models": {role: {"model": "terra", "effort": "medium"} for role in ROLES},
    }
    assert _update(who, longest)["ok"] is True
    assert _desire(cluster, who.user)[0] == longest


@pytest.mark.parametrize("params", [
    {},
    {"providers": {"openai": {}}},
    {"working_hours": OFFICE, "api_key": "x"},
    {"working_hours": {**OFFICE, "timezone": "Mars/Olympus"}},
    {"working_hours": {**OFFICE, "timezone": "../../etc"}},
    {"working_hours": {"timezone": "UTC", "windows": [{"days": ["mon"], "start": "09:00", "end": "12:00"}]}},
    {"working_hours": {"timezone": "UTC", "windows": [{"days": ["mon"], "start": "09:00", "end": "09:00"}]}},
    {"working_hours": {"timezone": "UTC", "windows": [{"days": ["mon"], "start": "9:00", "end": "18:00"}]}},
    {"working_hours": {"timezone": "UTC", "windows": [{"days": ["mon"], "start": "09:00", "end": "18:00"},
                                                      {"days": ["mon"], "start": "19:00", "end": "23:30"}]}},
    {"working_hours": {"timezone": "UTC", "windows": [{"days": [], "start": "09:00", "end": "18:00"}]}},
    {"working_hours": {"timezone": "UTC", "windows": [{"days": [1], "start": "09:00", "end": "18:00"}]}},
    {"working_hours": {"timezone": "UTC", "windows": [{"days": ["mon"], "start": "09:00", "end": "18:00", "x": 1}]}},
    {"working_hours": "office"},
    {"role_models": {"scot": {"model": "luna"}}},
    {"role_models": {"scout": {"model": "gpt-5.6-luna"}}},
    {"role_models": {"scout": {"model": None}}},
    {"role_models": {"scout": {"effort": 3}}},
    {"role_models": {"scout": {"model": "luna", "efort": "low"}}},
    {"role_models": ["scout"]},
])
def test_anything_out_of_the_lists_is_invalid_and_writes_nothing(cluster, params):
    who = Browser(cluster)
    assert _update(who, params) == {"ok": False, "error": "invalid_params"}
    assert _desire(cluster, who.user)[0] is None


def test_a_text_is_not_taken(cluster):
    who = Browser(cluster)
    assert _update(who, {"working_hours": OFFICE}, body="run every agent")["error"] == "invalid_params"


def test_it_needs_a_recent_session_and_a_route_that_says_L2(cluster):
    who = Browser(cluster)
    assert _update(who, {"working_hours": OFFICE}, login_age_s=3600)["error"] == "reauth_required"
    assert _update(who, {"working_hours": OFFICE}, route_level="L1")["error"] == "level_mismatch"
    assert _desire(cluster, who.user)[0] is None


def test_twenty_an_hour(cluster):
    who = Browser(cluster)
    for _ in range(20):
        assert _update(who, {"role_models": {}})["ok"] is True
    reply = _update(who, {"role_models": {}})
    assert reply["error"] == "rate_limited" and reply["retry_after_s"] >= 1


# --------------------------------------------------------------------------------------------------
# the stamp
# --------------------------------------------------------------------------------------------------

def test_the_stamp_is_the_databases_whoever_writes(cluster):
    who = Browser(cluster)
    _update(who, {"working_hours": OFFICE})
    stamp = _desire(cluster, who.user)[1]
    # the box's token (service_role) cannot move the stamp: a value sent alone is dropped
    cluster(f"BEGIN; SET LOCAL ROLE service_role; UPDATE public.team_state SET desired_settings_at = '2099-01-01' "
            f"WHERE user_id = '{who.user}'; COMMIT;")
    assert _desire(cluster, who.user)[1] == stamp
    # and a change of the desire written with a stamp of its own gets the database's now()
    cluster(f"BEGIN; SET LOCAL ROLE service_role; UPDATE public.team_state "
            f"SET desired_settings = '{{\"role_models\": {{}}}}', desired_settings_at = '2000-01-01' "
            f"WHERE user_id = '{who.user}'; COMMIT;")
    assert _scalar(cluster, f"SELECT desired_settings_at > now() - interval '1 minute' FROM public.team_state "
                            f"WHERE user_id = '{who.user}'") == "t"
    # an insert with a desire and a stamp of its own: the stamp is now()
    other = Browser(cluster)
    cluster(f"INSERT INTO public.team_state (user_id, desired_settings, desired_settings_at) "
            f"VALUES ('{other.user}', '{{\"role_models\": {{}}}}', '2099-01-01')")
    assert _scalar(cluster, f"SELECT desired_settings_at < now() + interval '1 minute' FROM public.team_state "
                            f"WHERE user_id = '{other.user}'") == "t"


def test_the_box_acknowledges_with_its_token(cluster):
    who = Browser(cluster)
    _update(who, {"working_hours": OFFICE})
    stamp = _desire(cluster, who.user)[1]
    cluster(f"BEGIN; SET LOCAL ROLE service_role; UPDATE public.team_state SET settings_applied_at = '{stamp}' "
            f"WHERE user_id = '{who.user}'; COMMIT;")
    assert _scalar(cluster, f"SELECT settings_applied_at = desired_settings_at FROM public.team_state "
                            f"WHERE user_id = '{who.user}'") == "t"

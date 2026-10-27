"""JHT web capace — migration 103: the door is closed for team.start, team.stop and team.restart.

The build flag of phase 3 hides the buttons, not the capability: 103 gives web_door.vocab a switch
(`enabled`) and request_action looks at it at the first call and at the confirmation.

Same database as tests/test_web_action_door_postgres.py (its bootstrap, roles and browser). Two chains,
both applied for real and 103 twice:
- the first deploy on the cloud: 098 → 099 → 100 → 103, without 101 and 102 (103 needs nothing after 100);
- then 101 and 102 on top, as the cloud gets them later: the rows 101 adds are open, and the switch
  still holds.

What must hold:
- team.start, team.stop and team.restart are refused with action_disabled at the first call, with or
  without a confirmation, and the refusal is a line of the log (cancelled, action_disabled);
- a confirmation opened while the action was open is refused when it is used after the switch went off;
- nothing reaches team_commands or team_state through a switched-off action;
- team.emergency_stop and the other actions pass;
- the refusals count in the limit of their group: a stolen session cannot fill the log with them;
- a browser role can neither read nor move the switch; a migration (the owner) opens it again.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest

import test_web_action_door_postgres as door
import test_web_action_phase4_postgres as phase4

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
M100 = MIGRATIONS / "100_web_action_settings.sql"
M101 = MIGRATIONS / "101_web_action_exclusions_directives.sql"
M102 = MIGRATIONS / "102_web_action_log_follows_emergency_stop.sql"
M103 = MIGRATIONS / "103_web_door_action_switch.sql"
M105 = MIGRATIONS / "105_web_apply_authorisations.sql"
SWITCHED_OFF = ("team.start", "team.stop", "team.restart")

# What the cloud has and the door's bootstrap does not: the columns 101 and 102 sit on.
EXTRA = phase4.EXTRA + """
ALTER TABLE public.team_state ADD COLUMN emergency_stop_completed_at timestamptz;
ALTER TABLE public.positions ADD COLUMN url text NOT NULL DEFAULT 'https://example.com/apply';
CREATE TABLE public.cloud_sync_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  revoked_at timestamptz,
  expires_at timestamptz
);
"""

CHAINS = {
    "first-deploy": (door.MIGRATION, door.MIGRATION_099, M100, M103, M101, M102, M105),
    "then-101-102": (door.MIGRATION, door.MIGRATION_099, M100, M103, M101, M102, M105),
}


@pytest.fixture(scope="module", params=sorted(CHAINS))
def cluster(request, tmp_path_factory):
    chain = CHAINS[request.param]
    work = tmp_path_factory.mktemp(f"web-door-switch-{request.param}")

    def prepare(psql):
        psql(door.BOOTSTRAP)
        psql(EXTRA)
        for path in chain:
            psql(file=path)
            if path == M103:
                psql(file=path)      # applied by hand, possibly twice
        psql.work = work
        psql.chain = request.param

    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    if external_url:
        client = door._tool("psql")
        parsed = urlparse(external_url)
        if not client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL needs psql and a valid host")
        database = f"jht_web_door_switch_{uuid.uuid4().hex[:12]}"
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
    root = Path(tempfile.mkdtemp(prefix="jht-pg-103-", dir="/tmp"))
    data, sock = root / "data", root / "sock"
    sock.mkdir()
    env = {**os.environ, "LC_ALL": "C", "PGHOST": str(sock), "PGUSER": "postgres", "PGDATABASE": "postgres"}
    subprocess.run([tools["initdb"], "-D", str(data), "-A", "trust", "-U", "postgres", "--no-sync", "-E", "UTF8"],
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


def _switch(db, action: str, on: bool) -> None:
    """What a migration does: the owner moves the switch."""
    db(f"UPDATE web_door.vocab SET enabled = {'true' if on else 'false'} WHERE action = '{action}'")


def _footprint(db, who) -> str:
    return door._scalar(db, f"""SELECT (SELECT count(*) FROM public.team_commands WHERE user_id = '{who.user}')
        || '/' || (SELECT count(*) FROM public.team_state WHERE user_id = '{who.user}')""")


def test_only_the_three_actions_of_the_team_the_box_does_not_run_yet_are_switched_off(cluster):
    rows = door._scalar(cluster, "SELECT string_agg(action || '=' || enabled, ',' ORDER BY action) FROM web_door.vocab")
    states = dict(item.split("=") for item in rows.split(","))
    assert {action for action, on in states.items() if on == "false"} == set(SWITCHED_OFF)
    assert states["team.emergency_stop"] == "true"
    if cluster.chain == "then-101-102":
        assert len(states) > 6 + 2, "the rows of 100 and 101 are there, and open"


@pytest.mark.parametrize("action", SWITCHED_OFF)
@pytest.mark.parametrize("target", ["scout", "all"])          # all asks for a confirmation
def test_a_switched_off_action_is_refused_at_the_first_call_and_the_refusal_is_in_the_log(cluster, action, target):
    who = door.Browser(cluster)
    answer = who.act(action, {"target": target})
    assert answer == {"ok": False, "error": "action_disabled"}
    line = door._scalar(cluster, f"SELECT action || '|' || status || '|' || result || '|' || (expires_at IS NULL) "
                                 f"FROM public.web_action_log WHERE user_id = '{who.user}'")
    assert line == f"{action}|cancelled|action_disabled|true"
    assert _footprint(cluster, who) == "0/0"


def test_a_confirmation_opened_before_the_switch_went_off_does_not_run(cluster):
    who = door.Browser(cluster)
    _switch(cluster, "team.restart", True)
    try:
        first = who.act("team.restart", {"target": "all"})
        assert first["state"] == "awaiting_confirm"
    finally:
        _switch(cluster, "team.restart", False)
    assert who.act("team.restart", confirm=first["id"]) == {"ok": False, "error": "action_disabled"}
    assert door._scalar(cluster, f"SELECT status || '|' || result FROM public.web_action_log WHERE id = '{first['id']}'") == "cancelled|action_disabled"
    assert _footprint(cluster, who) == "0/0"
    # used: it cannot be confirmed again
    assert who.act("team.restart", confirm=first["id"]) == {"ok": False, "error": "confirm_used"}


def test_the_emergency_stop_and_the_other_actions_pass(cluster):
    who = door.Browser(cluster)
    stop = who.act("team.emergency_stop")
    assert stop["ok"] and stop["state"] == "queued"
    assert door._scalar(cluster, f"SELECT should_run FROM public.team_state WHERE user_id = '{who.user}'") == "f"
    door._position(cluster, who.user, 81)
    first = who.act("position.apply_authorize", {"legacy_id": 81})
    assert first["state"] == "awaiting_confirm"
    assert who.act("position.apply_authorize", confirm=first["id"])["state"] == "queued"


def test_a_pairing_session_cannot_open_an_application_authorisation(cluster):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 81)
    cluster(
        f"INSERT INTO public.cloud_sync_tokens (user_id, token_hash, pairing_session_id) "
        f"VALUES ('{who.user}', 'synthetic', '{who.session}')"
    )
    # The no-row answer is intentional: the door does not reveal why that
    # session cannot act, and creates neither confirmation nor desired-state.
    assert who.act("position.apply_authorize", {"legacy_id": 81}) == {"ok": False, "error": "not_found"}
    assert door._scalar(
        cluster,
        f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}'",
    ) == "0"
    assert door._scalar(
        cluster,
        f"SELECT coalesce(apply_requested, false) FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 81",
    ) == "f"


def test_a_legacy_active_token_without_a_pairing_session_closes_the_application_door(cluster):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 81)
    cluster(
        f"INSERT INTO public.cloud_sync_tokens (user_id, token_hash) "
        f"VALUES ('{who.user}', 'synthetic-legacy')"
    )
    # A pre-pairing token has no browser session to compare. It must be
    # re-paired before any L3 authorisation can be recorded.
    assert who.act("position.apply_authorize", {"legacy_id": 81}) == {"ok": False, "error": "not_found"}
    assert door._scalar(
        cluster,
        f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}'",
    ) == "0"
    assert door._scalar(
        cluster,
        f"SELECT coalesce(apply_requested, false) FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 81",
    ) == "f"


def test_the_web_summary_keeps_a_valid_host_and_refuses_invalid_ones(cluster):
    who = door.Browser(cluster)
    for legacy, url in ((81, "https://acme.com/apply"), (82, "https://jobs.acme-company.com/apply"),
                        (83, "https://127.0.0.1/apply"), (84, "")):
        door._position(cluster, who.user, legacy)
        cluster(f"UPDATE public.positions SET url = $u${url}$u$ WHERE user_id = '{who.user}' AND legacy_id = {legacy}")
    assert who.act("position.apply_authorize", {"legacy_id": 81})["summary"].startswith("Destinazione: acme.com · ")
    assert who.act("position.apply_authorize", {"legacy_id": 82})["summary"].startswith("Destinazione: jobs.acme-company.com · ")
    assert who.act("position.apply_authorize", {"legacy_id": 83}) == {"ok": False, "error": "not_found"}
    assert who.act("position.apply_authorize", {"legacy_id": 84}) == {"ok": False, "error": "not_found"}


def test_a_long_title_never_truncates_the_host_in_the_web_summary(cluster):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 81)
    cluster(f"UPDATE public.positions SET title = repeat('x', 300), url = 'https://acme.com/apply' "
            f"WHERE user_id = '{who.user}' AND legacy_id = 81")
    summary = who.act("position.apply_authorize", {"legacy_id": 81})["summary"]
    assert summary.startswith("Destinazione: acme.com · ")
    assert len(summary) <= 200


def test_the_destination_is_its_own_line_after_one_line_labels(cluster):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 85)
    cluster("""UPDATE public.positions
                  SET title = 'Role' || U&'\\202E' || ' title',
                      company = 'Acme · acme.com' || U&'\\2028' || ' Srl',
                      url = 'https://jobs.real-company.example/apply'
                WHERE user_id = '%s' AND legacy_id = 85""" % who.user)
    summary = who.act("position.apply_authorize", {"legacy_id": 85})["summary"]
    assert summary == "Destinazione: jobs.real-company.example · Role title @ Acme acme.com Srl"


def test_a_maximum_length_host_is_complete_at_the_start_of_the_summary(cluster):
    who = door.Browser(cluster)
    host = "a" * 57 + "." + "b" * 57 + ".com"
    door._position(cluster, who.user, 86)
    cluster(f"UPDATE public.positions SET title = repeat('t', 80), company = repeat('c', 80), "
            f"url = 'https://{host}/apply' WHERE user_id = '{who.user}' AND legacy_id = 86")
    summary = who.act("position.apply_authorize", {"legacy_id": 86})["summary"]
    assert summary.startswith(f"Destinazione: {host} · ")
    assert len(summary) <= 200


def test_a_revoke_without_an_authorisation_leaves_the_position_untouched(cluster):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 81)
    before = door._scalar(cluster, f"""SELECT xmin::text || '|' || coalesce(apply_requested::text, 'null') || '|'
        || coalesce(apply_requested_at::text, 'null')
        FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 81""")
    assert who.act("position.apply_revoke", {"legacy_id": 81})["state"] == "done"
    after = door._scalar(cluster, f"""SELECT xmin::text || '|' || coalesce(apply_requested::text, 'null') || '|'
        || coalesce(apply_requested_at::text, 'null')
        FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 81""")
    assert after == before


def test_the_refusals_count_in_the_limit_so_they_cannot_fill_the_log(cluster):
    who = door.Browser(cluster)
    calls = "\n".join("SELECT public.request_action('team.stop', '{\"target\": \"scout\"}'::jsonb, NULL, 'L2');" for _ in range(14))
    done = who.script(calls)
    assert done.returncode == 0, done.stderr
    errors = [line for line in done.stdout.splitlines() if line.startswith("{")]
    assert sum('"action_disabled"' in line for line in errors) == 12          # the cap of team.down
    assert all('"rate_limited"' in line for line in errors[12:])
    assert door._scalar(cluster, f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}'") == "12"


def test_a_browser_can_neither_read_nor_move_the_switch(cluster):
    who = door.Browser(cluster)
    for role in ("authenticated", "anon"):
        refusal = who.refused("UPDATE web_door.vocab SET enabled = true WHERE action = 'team.start';", role=role)
        assert "permission denied" in refusal, refusal
        refusal = who.refused("SELECT enabled FROM web_door.vocab;", role=role)
        assert "permission denied" in refusal, refusal
    assert door._scalar(cluster, "SELECT enabled FROM web_door.vocab WHERE action = 'team.start'") == "f"


def test_a_migration_opens_the_door_again(cluster):
    who = door.Browser(cluster)
    _switch(cluster, "team.start", True)
    try:
        answer = who.act("team.start", {"target": "scout"})
        assert answer["ok"] and answer["state"] == "queued" and "command_id" in answer
    finally:
        _switch(cluster, "team.start", False)
    assert who.act("team.start", {"target": "scout"}) == {"ok": False, "error": "action_disabled"}


# -- 105, the barrier outlives the token (S1/N5, 27/10) --------------------------------------------------------

def _token(db, who, **columns):
    """A token of the user, written the way the server writes it. `now()`-style values go in as SQL."""
    values = {"user_id": f"'{who.user}'", "token_hash": f"'synthetic-{uuid.uuid4().hex}'", **columns}
    db(f"INSERT INTO public.cloud_sync_tokens ({', '.join(values)}) VALUES ({', '.join(values.values())})")


def _authorise(who, legacy_id=81):
    return who.act("position.apply_authorize", {"legacy_id": legacy_id})


@pytest.mark.parametrize("ended", [
    pytest.param({"revoked_at": "now()"}, id="revoked"),
    pytest.param({"expires_at": "now() - interval '1 day'"}, id="expired"),
    pytest.param({"revoked_at": "now()", "expires_at": "now() - interval '1 day'"}, id="both"),
])
def test_a_device_that_ended_its_own_token_is_still_that_device_for_the_door(cluster, ended):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 81)
    _token(cluster, who, pairing_session_id=f"'{who.session}'", **ended)
    assert _authorise(who) == {"ok": False, "error": "not_found"}
    assert door._scalar(cluster, f"SELECT count(*) FROM public.web_action_log WHERE user_id = '{who.user}'") == "0"
    assert door._scalar(cluster, f"SELECT coalesce(apply_requested, false) FROM public.positions "
                                 f"WHERE user_id = '{who.user}' AND legacy_id = 81") == "f"


def test_an_ended_token_of_another_session_or_without_a_session_does_not_close_the_door(cluster):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 81)
    # a past device (another session) and a past legacy token (no session at all): both over
    _token(cluster, who, pairing_session_id=f"'{uuid.uuid4()}'", revoked_at="now()")
    _token(cluster, who, revoked_at="now()")
    _token(cluster, who, expires_at="now() - interval '1 day'")
    first = _authorise(who)
    assert first["ok"] and first["state"] == "awaiting_confirm", first
    assert who.act("position.apply_authorize", confirm=first["id"])["state"] == "queued"


def test_counter_check_with_the_filter_on_the_ended_tokens_back_the_session_gets_through(cluster):
    """The old comparison (only the live tokens) applied over the real one: the case above is then open."""
    path = cluster.work / "m105-live-tokens-only.sql"
    source = M105.read_text(encoding="utf-8")
    needle = "OR (v_session IS NOT NULL AND t.pairing_session_id = v_session)"
    assert source.count(needle) == 1
    path.write_text(source.replace(
        needle,
        "OR (v_session IS NOT NULL AND t.pairing_session_id = v_session\n"
        "                       AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now()))"), encoding="utf-8")
    try:
        cluster(file=path)
        who = door.Browser(cluster)
        door._position(cluster, who.user, 81)
        _token(cluster, who, pairing_session_id=f"'{who.session}'", revoked_at="now()")
        answer = _authorise(who)
        assert answer["ok"] and answer["state"] == "awaiting_confirm", "the defect: the revoked token no longer closes the door"
    finally:
        cluster(file=M105)


def _as(db, role, sql):
    return db(f"SET ROLE {role}; {sql}", check=False)


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_no_browser_role_inserts_updates_or_deletes_a_token_and_the_server_does(cluster, role):
    who = door.Browser(cluster)
    _token(cluster, who, pairing_session_id=f"'{who.session}'")
    for statement in (
        f"DELETE FROM public.cloud_sync_tokens WHERE user_id = '{who.user}'",
        f"UPDATE public.cloud_sync_tokens SET revoked_at = now() WHERE user_id = '{who.user}'",
        f"UPDATE public.cloud_sync_tokens SET pairing_session_id = gen_random_uuid() WHERE user_id = '{who.user}'",
        f"INSERT INTO public.cloud_sync_tokens (user_id, token_hash) VALUES ('{who.user}', 'x')",
    ):
        done = _as(cluster, role, statement)
        assert done.returncode != 0 and "permission denied" in done.stderr, (role, statement, done.stderr)
    assert door._scalar(cluster, f"SELECT count(*) FROM public.cloud_sync_tokens WHERE user_id = '{who.user}'") == "1"
    # the server (the service role) still writes
    assert _as(cluster, "service_role", f"UPDATE public.cloud_sync_tokens SET revoked_at = now() WHERE user_id = '{who.user}'").returncode == 0
    assert _as(cluster, "service_role", f"DELETE FROM public.cloud_sync_tokens WHERE user_id = '{who.user}'").returncode == 0


def test_the_owner_still_reads_their_own_tokens(cluster):
    who = door.Browser(cluster)
    _token(cluster, who, pairing_session_id=f"'{who.session}'")
    done = who.script(f"SELECT count(*) FROM public.cloud_sync_tokens WHERE user_id = '{who.user}';")
    assert done.returncode == 0, done.stderr
    assert "1" in done.stdout.split()


def test_the_policies_of_writing_are_dropped_and_the_one_of_reading_stays(cluster):
    """On the cloud the table has one policy per command (006, 025). 105 drops the three that write."""
    cluster("""
      ALTER TABLE public.cloud_sync_tokens ENABLE ROW LEVEL SECURITY;
      DROP POLICY IF EXISTS "Users can view own cloud sync tokens" ON public.cloud_sync_tokens;
      DROP POLICY IF EXISTS "Users can insert own cloud sync tokens" ON public.cloud_sync_tokens;
      DROP POLICY IF EXISTS "Users can update own cloud sync tokens" ON public.cloud_sync_tokens;
      DROP POLICY IF EXISTS "Users can delete own cloud sync tokens" ON public.cloud_sync_tokens;
      CREATE POLICY "Users can view own cloud sync tokens" ON public.cloud_sync_tokens FOR SELECT USING (user_id = auth.uid());
      CREATE POLICY "Users can insert own cloud sync tokens" ON public.cloud_sync_tokens FOR INSERT WITH CHECK (user_id = auth.uid());
      CREATE POLICY "Users can update own cloud sync tokens" ON public.cloud_sync_tokens FOR UPDATE USING (user_id = auth.uid());
      CREATE POLICY "Users can delete own cloud sync tokens" ON public.cloud_sync_tokens FOR DELETE USING (user_id = auth.uid());
      GRANT INSERT, UPDATE, DELETE ON public.cloud_sync_tokens TO anon, authenticated;
    """)
    try:
        cluster(file=M105)         # applied again, as a migration applied by hand can be
        cluster(file=M105)
        left = door._scalar(cluster, "SELECT string_agg(polcmd::text, ',' ORDER BY polcmd::text) FROM pg_policy "
                                     "WHERE polrelid = 'public.cloud_sync_tokens'::regclass")
        assert left == "r"
        assert door._scalar(cluster, "SELECT has_table_privilege('authenticated', 'public.cloud_sync_tokens', 'DELETE')") == "f"
    finally:
        cluster("ALTER TABLE public.cloud_sync_tokens DISABLE ROW LEVEL SECURITY;")


@pytest.mark.parametrize("left_behind, message", [
    ("GRANT DELETE ON public.cloud_sync_tokens TO PUBLIC", "can still INSERT, UPDATE or DELETE"),
    ("GRANT UPDATE ON public.cloud_sync_tokens TO PUBLIC", "can still INSERT, UPDATE or DELETE"),
    ("GRANT INSERT ON public.cloud_sync_tokens TO PUBLIC", "can still INSERT, UPDATE or DELETE"),
])
def test_the_migration_stops_when_a_privilege_it_cannot_remove_is_left(cluster, left_behind, message):
    """A REVOKE from the browser roles does not remove what PUBLIC grants: the last block of 105 says so."""
    cluster(left_behind)
    try:
        done = cluster(file=M105, check=False)
        assert done.returncode != 0 and message in done.stderr, done.stderr
    finally:
        cluster("REVOKE ALL ON public.cloud_sync_tokens FROM PUBLIC")
        cluster(file=M105)


def test_the_migration_stops_when_a_writing_policy_is_left(cluster):
    """A policy of another name (not one 105 drops) that writes is left in place: the last block stops."""
    cluster("""
      ALTER TABLE public.cloud_sync_tokens ENABLE ROW LEVEL SECURITY;
      CREATE POLICY "other writer" ON public.cloud_sync_tokens FOR DELETE USING (true);
    """)
    try:
        done = cluster(file=M105, check=False)
        assert done.returncode != 0 and "still has an INSERT, UPDATE, DELETE or ALL policy" in done.stderr, done.stderr
    finally:
        cluster('DROP POLICY IF EXISTS "other writer" ON public.cloud_sync_tokens; '
                'ALTER TABLE public.cloud_sync_tokens DISABLE ROW LEVEL SECURITY;')
        cluster(file=M105)

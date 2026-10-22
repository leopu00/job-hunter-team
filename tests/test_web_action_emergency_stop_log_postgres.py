"""JHT web capace — migration 102: the line of an emergency stop in the log is closed when the box confirms it.

The door writes the emergency stop in team_state (099, family `team`), so its log line is born `queued`
with no command to follow. The box completes the stop and writes, with its token,
emergency_stop_completed_at = emergency_stop_requested_at; the trigger of 102 then closes the lines.

Same database as tests/test_web_action_door_postgres.py (its bootstrap, roles and browser), plus the
column emergency_stop_completed_at, which the cloud has since 061. Series 098 → 099 → 102: 100 and 101
do not touch the completion of a stop. 102 is applied twice, as a migration applied by hand can be.

What must hold:
- the box confirming the stop closes the line of that stop, and the older stops of that user still open;
- a completion that does not move (the same value, or null) and any other write closes nothing;
- the lines of another user are not touched;
- a stop asked after the completion stays `queued` until the box completes it too;
- a browser role can neither execute the function nor write the completion;
- (ext_position, again in 102) withdrawing an authorisation that is not there writes nothing, so the box
  sends no false notice of a withdrawn authorisation; a real withdrawal still moves the instant.
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

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
M102 = MIGRATIONS / "102_web_action_log_follows_emergency_stop.sql"

EXTRA = """
ALTER TABLE public.team_state ADD COLUMN emergency_stop_completed_at timestamptz;
"""


@pytest.fixture(scope="module")
def cluster(tmp_path_factory):
    work = tmp_path_factory.mktemp("web-action-emergency-stop")

    def prepare(psql):
        psql(door.BOOTSTRAP)
        psql(EXTRA)
        for path in (door.MIGRATION, door.MIGRATION_099):
            psql(file=path)
        psql(file=M102)
        psql(file=M102)              # applied by hand, possibly twice
        psql.work = work

    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    if external_url:
        client = door._tool("psql")
        parsed = urlparse(external_url)
        if not client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL needs psql and a valid host")
        database = f"jht_web_action_stop_{uuid.uuid4().hex[:12]}"
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
    root = Path(tempfile.mkdtemp(prefix="jht-pg-102-", dir="/tmp"))
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


def _stop(who) -> str:
    answer = who.act("team.emergency_stop")
    assert answer["ok"] and answer["state"] == "queued", answer
    return answer["id"]


def _status(db, line: str) -> str:
    return door._scalar(db, f"SELECT status FROM public.web_action_log WHERE id = '{line}'")


def _box_completes(who, value: str = "emergency_stop_requested_at") -> None:
    """What the box writes after `jht team stop` worked: with its token, the requested instant as completed."""
    done = who.script(f"UPDATE public.team_state SET emergency_stop_completed_at = {value} WHERE user_id = '{who.user}';",
                      role="service_role")
    assert done.returncode == 0, done.stderr


def test_the_box_confirming_the_stop_closes_its_line(cluster):
    who = door.Browser(cluster)
    line = _stop(who)
    assert _status(cluster, line) == "queued"
    _box_completes(who)
    assert _status(cluster, line) == "done"


def test_one_stop_that_worked_closes_the_older_ones_left_open(cluster):
    who = door.Browser(cluster)
    first, second = _stop(who), _stop(who)
    _box_completes(who)
    assert (_status(cluster, first), _status(cluster, second)) == ("done", "done")


def test_a_completion_that_does_not_move_and_other_writes_close_nothing(cluster):
    who = door.Browser(cluster)
    line = _stop(who)
    # The completion already equal to the request, written while the follower was off.
    cluster("ALTER TABLE public.team_state DISABLE TRIGGER trg_web_action_log_follow_emergency_stop")
    try:
        _box_completes(who)
    finally:
        cluster("ALTER TABLE public.team_state ENABLE TRIGGER trg_web_action_log_follow_emergency_stop")
    assert _status(cluster, line) == "queued"
    _box_completes(who)                                   # the same value again
    assert _status(cluster, line) == "queued"
    _box_completes(who, "NULL")                           # cleared
    assert _status(cluster, line) == "queued"
    done = who.script(f"UPDATE public.team_state SET is_running = false, should_run = false WHERE user_id = '{who.user}';",
                      role="service_role")
    assert done.returncode == 0, done.stderr
    assert _status(cluster, line) == "queued"


def test_the_lines_of_another_user_are_not_touched(cluster):
    who, other = door.Browser(cluster), door.Browser(cluster)
    theirs, mine = _stop(other), _stop(who)          # theirs is older than the completion of mine
    _box_completes(who)
    assert (_status(cluster, mine), _status(cluster, theirs)) == ("done", "queued")


def test_a_stop_asked_after_the_completion_waits_for_its_own(cluster):
    who = door.Browser(cluster)
    first = _stop(who)
    _box_completes(who)
    second = _stop(who)
    assert (_status(cluster, first), _status(cluster, second)) == ("done", "queued")
    _box_completes(who)
    assert _status(cluster, second) == "done"


def test_a_stop_asked_while_the_box_was_stopping_the_first_one_waits_for_its_own(cluster):
    """The box read the first request, and while it stopped the team a second stop moved the request on:
    it writes as completed the instant it read, older than the second line."""
    who = door.Browser(cluster)
    first = _stop(who)
    read = door._scalar(cluster, f"SELECT emergency_stop_requested_at FROM public.team_state WHERE user_id = '{who.user}'")
    second = _stop(who)
    _box_completes(who, f"'{read}'::timestamptz")
    assert (_status(cluster, first), _status(cluster, second)) == ("done", "queued")


def test_only_emergency_stops_are_closed(cluster):
    who = door.Browser(cluster)
    restart = who.act("team.restart", {"target": "scout"})
    assert restart["state"] == "queued"
    stop = _stop(who)
    _box_completes(who)
    assert (_status(cluster, restart["id"]), _status(cluster, stop)) == ("queued", "done")


def test_a_browser_can_neither_run_the_follower_nor_write_the_completion(cluster):
    function = "public.web_action_log_follow_emergency_stop()"
    for role in ("anon", "authenticated"):
        assert door._scalar(cluster, f"SELECT has_function_privilege('{role}', '{function}', 'EXECUTE')") == "f", role
    assert door._scalar(cluster, f"SELECT prosecdef FROM pg_proc WHERE oid = '{function}'::regprocedure") == "t"
    who = door.Browser(cluster)
    line = _stop(who)
    refusal = who.refused(f"UPDATE public.team_state SET emergency_stop_completed_at = emergency_stop_requested_at WHERE user_id = '{who.user}';")
    assert "permission denied" in refusal
    assert _status(cluster, line) == "queued"


def test_every_foreign_key_of_the_log_has_an_index_under_it(cluster):
    """The rule of tests/test_foreign_key_indexes_postgres.py (092), on the log: 099 tied the action to
    the vocabulary (web_action_log_action_in_vocab) and 102 gives that key its index."""
    keys = door._scalar(cluster, """
        SELECT string_agg(c.conname || '=' || EXISTS (
                 SELECT 1 FROM pg_index i
                  WHERE i.indrelid = c.conrelid AND i.indisvalid
                    AND (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] = c.conkey), ',' ORDER BY c.conname)
          FROM pg_constraint c
         WHERE c.contype = 'f' AND c.conrelid = 'public.web_action_log'::regclass""")
    assert "web_action_log_action_in_vocab=true" in keys.split(","), keys
    assert "=false" not in keys, keys


def test_withdrawing_what_is_not_authorised_writes_nothing_so_the_box_sends_no_notice(cluster):
    """The box tells the user «authorisation withdrawn» when the instant moves with apply_requested false.
    A withdrawal of a position never authorised, or withdrawn already, must not touch the row: from a
    stolen session it would be one false notice per call."""
    who = door.Browser(cluster)
    door._position(cluster, who.user, 54)

    def row():
        return door._scalar(cluster, f"SELECT xmin::text || '|' || apply_requested || '|' || COALESCE(apply_requested_at::text, 'null') "
                                     f"FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 54")

    never = row()
    assert never.endswith("|false|null")
    answer = who.act("position.apply_revoke", {"legacy_id": 54})
    assert answer["ok"] and answer["state"] == "done"
    assert row() == never, "a position never authorised was written"
    assert _status(cluster, answer["id"]) == "done"

    first = who.act("position.apply_authorize", {"legacy_id": 54})
    assert who.act("position.apply_authorize", confirm=first["id"])["state"] == "queued"
    assert who.act("position.apply_revoke", {"legacy_id": 54})["state"] == "queued"
    withdrawn = row()
    assert "|false|" in withdrawn and not withdrawn.endswith("|null"), "a real withdrawal moves the instant"
    assert who.act("position.apply_revoke", {"legacy_id": 54})["state"] == "done"
    assert row() == withdrawn, "a position withdrawn already was written again"

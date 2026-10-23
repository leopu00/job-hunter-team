"""JHT web capace — migration 104: the summary of an application in the log goes through web_door.one_line.

The summary of position.apply_authorize and position.apply_revoke is «title @ company», read from the
position, so from a vacancy: a text of third parties. Until 104 only [[:cntrl:]] became a space, and the
format characters that reorder or hide text reached web_action_log, the person's record and export.

Same database as tests/test_web_door_action_switch_postgres.py, in the order of the cloud: 098 → 099 →
100 → 103 → 101 → 102 → 104, with 104 applied twice, as a migration applied by hand can be.

What must hold:
- overrides, isolates, zero-width spaces, soft hyphens and tag characters are removed from the summary,
  line breaks and separators become one space, many spaces one;
- ZWNJ, ZWJ, LRM, RLM and ALM stay: they are letters of the writing of a name;
- the summary is at most 200 characters;
- the withdrawal of 102 is unchanged: nothing to withdraw writes nothing;
- the door is still the one of 103 (porta_103): team.start is refused with action_disabled;
- 104 can be applied again after a later migration opens team.* again: its final block checks that the
  switch of 103 is there, not its values;
- web_door.one_line, run for real, removes exactly the characters of external_content.INVISIBLE_COMMANDS
  among every format, separator and tag character (counter-check: a one_line without the soft hyphen is
  seen);
- counter-check: with the family of 102 applied again the summary keeps the override, and the final
  block of 104 stops.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import unicodedata
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest

import test_invisible_commands_copies as copies
import test_web_action_door_postgres as door
import test_web_door_action_switch_postgres as switch

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
M104 = MIGRATIONS / "104_web_action_position_summary_one_line.sql"
CHAIN = (door.MIGRATION, door.MIGRATION_099, switch.M100, switch.M103, switch.M101, switch.M102, M104)

# A vacancy written to mislead: an override and an isolate that reorder, a zero-width space and a soft hyphen
# inside words, a line break, tag characters spelling an invisible word, a line separator.
HOSTILE_TITLE = (r"'Platform' || U&'\202E' || ' Lead' || U&'\2066' || 'X' || U&'\2069' || U&'\200B'"
                 r" || ' Engi' || U&'\00AD' || 'neer'")
HOSTILE_COMPANY = (r"'Acme' || E'\n' || 'Corp' || U&'\+0E0049\+0E0047\+0E004E\+0E004F\+0E0052\+0E0045'"
                   r" || U&'\2028' || 'Srl'")
HOSTILE_SUMMARY = "'Platform LeadX Engineer @ Acme Corp Srl'"

# A name written with the letters that are invisible but belong to its writing.
# For the counter-check: only an override. A line separator would stay in the summary of 102 and cut the
# JSON line the helper reads from psql (str.splitlines breaks on U+2028).
OVERRIDE_TITLE = r"'Platform' || U&'\202E' || ' Lead'"

WRITTEN_TITLE = r"'Ra' || U&'\200C' || 'ha' || U&'\200D' || 'n' || U&'\200E' || U&'\200F' || U&'\061C'"


@pytest.fixture(scope="module")
def cluster(tmp_path_factory):
    work = tmp_path_factory.mktemp("web-action-position-summary")

    def prepare(psql):
        psql(door.BOOTSTRAP)
        psql(switch.EXTRA)
        for path in CHAIN:
            psql(file=path)
        psql(file=M104)              # applied by hand, possibly twice
        psql.work = work

    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    if external_url:
        client = door._tool("psql")
        parsed = urlparse(external_url)
        if not client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL needs psql and a valid host")
        database = f"jht_web_position_summary_{uuid.uuid4().hex[:12]}"
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
    root = Path(tempfile.mkdtemp(prefix="jht-pg-104-", dir="/tmp"))
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


def _position_with(db, who, legacy_id: int, title_sql: str, company_sql: str = "'Acme'") -> None:
    door._position(db, who.user, legacy_id)
    db(f"UPDATE public.positions SET title = {title_sql}, company = {company_sql} "
       f"WHERE user_id = '{who.user}' AND legacy_id = {legacy_id}")


def _summary_is(db, line: str, expected_sql: str) -> bool:
    return door._scalar(db, f"SELECT summary = {expected_sql} FROM public.web_action_log WHERE id = '{line}'") == "t"


def test_the_format_characters_of_a_vacancy_do_not_reach_the_log(cluster):
    who = door.Browser(cluster)
    _position_with(cluster, who, 61, HOSTILE_TITLE, HOSTILE_COMPANY)
    first = who.act("position.apply_authorize", {"legacy_id": 61})
    assert first["ok"] and first["state"] == "awaiting_confirm", first
    assert _summary_is(cluster, first["id"], HOSTILE_SUMMARY), door._scalar(
        cluster, f"SELECT encode(convert_to(summary, 'UTF8'), 'hex') FROM public.web_action_log WHERE id = '{first['id']}'")
    hidden = door._scalar(cluster, rf"""SELECT summary ~ '[\u00AD\u200B\u2028\u202A-\u202E\u2066-\u2069\U000E0000-\U000E007F[:cntrl:]]'
        FROM public.web_action_log WHERE id = '{first['id']}'""")
    assert hidden == "f"

    # The withdrawal names the position the same way.
    assert who.act("position.apply_authorize", confirm=first["id"])["state"] == "queued"
    revoke = who.act("position.apply_revoke", {"legacy_id": 61})
    assert revoke["state"] == "queued"
    assert _summary_is(cluster, revoke["id"], HOSTILE_SUMMARY)


def test_the_letters_a_name_is_written_with_stay(cluster):
    who = door.Browser(cluster)
    _position_with(cluster, who, 62, WRITTEN_TITLE)
    first = who.act("position.apply_authorize", {"legacy_id": 62})
    assert _summary_is(cluster, first["id"], f"{WRITTEN_TITLE} || ' @ Acme'")


def test_the_summary_is_at_most_two_hundred_characters(cluster):
    who = door.Browser(cluster)
    _position_with(cluster, who, 63, "repeat('a', 300)")
    first = who.act("position.apply_authorize", {"legacy_id": 63})
    length = door._scalar(cluster, f"SELECT char_length(summary) FROM public.web_action_log WHERE id = '{first['id']}'")
    assert length == "200"


def test_withdrawing_what_is_not_authorised_still_writes_nothing(cluster):
    who = door.Browser(cluster)
    door._position(cluster, who.user, 64)
    before = door._scalar(cluster, f"SELECT xmin::text FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 64")
    answer = who.act("position.apply_revoke", {"legacy_id": 64})
    assert answer["ok"] and answer["state"] == "done"
    after = door._scalar(cluster, f"SELECT xmin::text FROM public.positions WHERE user_id = '{who.user}' AND legacy_id = 64")
    assert after == before


def test_the_door_is_still_closed_for_the_team_commands(cluster):
    """porta_103: 104 does not touch request_action."""
    who = door.Browser(cluster)
    answer = who.act("team.start", {"target": "scout"})
    assert answer == {"ok": False, "error": "action_disabled"} or answer.get("error") == "action_disabled", answer
    porta = door._scalar(cluster, """SELECT position('action_disabled' IN pg_get_functiondef(
        to_regprocedure('public.request_action(text, jsonb, uuid, text, text)'))) > 0""")
    assert porta == "t"


def test_counter_check_the_family_of_102_keeps_the_override_and_104_stops_on_it(cluster):
    """102 is applied again, then 104 puts its family back (in finally: the other tests see 104)."""
    final_block = M104.read_text(encoding="utf-8").rsplit("DO $$", 1)[1]
    try:
        cluster(file=switch.M102)
        who = door.Browser(cluster)
        _position_with(cluster, who, 65, OVERRIDE_TITLE)
        first = who.act("position.apply_authorize", {"legacy_id": 65})
        assert not _summary_is(cluster, first["id"], "'Platform Lead @ Acme'")
        kept = door._scalar(cluster, rf"SELECT summary ~ '\u202E' FROM public.web_action_log WHERE id = '{first['id']}'")
        assert kept == "t", "the family of 102 should keep the override: the test would prove nothing"
        stopped = cluster("DO $$" + final_block, check=False)
        assert stopped.returncode != 0 and "does not go through web_door.one_line" in stopped.stderr, stopped.stderr
    finally:
        cluster(file=M104)


def _removed_by_one_line(db) -> frozenset[str]:
    """Every format (Cf), line or paragraph separator and tag character, plus the Python list: the ones
    one_line takes away between two letters, without leaving a space."""
    universe = {chr(code) for code in range(0x80, 0x110000)
                if unicodedata.category(chr(code)) in ("Cf", "Zl", "Zp")}
    universe |= copies._python_list() | {chr(code) for code in range(0xE0000, 0xE0080)}
    codes = ",".join(str(ord(c)) for c in sorted(universe))
    found = door._scalar(db, f"""SELECT COALESCE(string_agg(c::text, ',' ORDER BY c), '')
        FROM unnest(ARRAY[{codes}]) AS c WHERE web_door.one_line('a' || chr(c) || 'b', 10) = 'ab'""")
    return frozenset(chr(int(code)) for code in found.split(",") if code)


def test_one_line_removes_exactly_the_python_list(cluster):
    python = copies._python_list()
    removed = _removed_by_one_line(cluster)
    assert removed == python, (f"web_door.one_line diverges from external_content.INVISIBLE_COMMANDS: "
                               f"missing {copies._names(python - removed)}, extra {copies._names(removed - python)}")


def test_counter_check_a_one_line_without_the_soft_hyphen_is_seen(cluster):
    """Run after the comparison: one_line is replaced by itself without U+00AD, then put back as it was."""
    original = door._scalar(cluster, "SELECT pg_get_functiondef(to_regprocedure('web_door.one_line(text, integer)'))")
    soft_hyphen = copies.BSL + "u00AD"
    assert original.count(soft_hyphen) == 1, "the counter-check must change the function for real"
    changed, restore = cluster.work / "one_line_without_shy.sql", cluster.work / "one_line_as_it_was.sql"
    changed.write_text(original.replace(soft_hyphen, "", 1) + ";\n", encoding="utf-8")
    restore.write_text(original + ";\n", encoding="utf-8")
    try:
        cluster(file=changed)
        assert copies._python_list() - _removed_by_one_line(cluster) == {chr(0x00AD)}
    finally:
        cluster(file=restore)
    assert _removed_by_one_line(cluster) == copies._python_list()


def test_104_applies_again_after_team_commands_are_opened_again(cluster):
    """What a later migration (105+) will do: team.* switched on. 104 applied after it must not stop, and the
    door must still be the one of 103 (the switch is there)."""
    off = ("team.start", "team.stop", "team.restart")
    names = ", ".join(f"'{action}'" for action in off)
    try:
        cluster(f"UPDATE web_door.vocab SET enabled = true WHERE action IN ({names})")
        again = cluster(file=M104, check=False)
        assert again.returncode == 0, again.stderr
    finally:
        cluster(f"UPDATE web_door.vocab SET enabled = false WHERE action IN ({names})")
    still = door._scalar(cluster, f"SELECT count(*) FROM web_door.vocab WHERE action IN ({names}) AND NOT enabled")
    assert still == "3"


def test_the_final_block_of_104_stops_when_the_switch_of_103_is_missing(cluster):
    """Counter-check of porta_103 by presence: without the column, the final block refuses."""
    final_block = M104.read_text(encoding="utf-8").rsplit("DO $$", 1)[1]
    script = cluster.work / "104_without_switch.sql"
    script.write_text("BEGIN;\nALTER TABLE web_door.vocab DROP COLUMN enabled CASCADE;\nDO $$" + final_block
                      + "\nROLLBACK;\n", encoding="utf-8")
    stopped = cluster(file=script, check=False)
    assert stopped.returncode != 0 and "has no switch" in stopped.stderr, stopped.stderr
    present = door._scalar(cluster, "SELECT count(*) FROM pg_attribute WHERE attrelid = 'web_door.vocab'::regclass "
                                    "AND attname = 'enabled' AND NOT attisdropped")
    assert present == "1", "the counter-check ran in a transaction rolled back"

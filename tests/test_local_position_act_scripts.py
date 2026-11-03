"""The fixed script of the page of a position in a local profile (desktop/src-tauri/src/local_position_act.rs), run for real.

One script for every act the person does on a position of the team on this computer: it writes through the team's own
position_judgement.py, with the cloud turned off, and only on the database the page read the position from. Synthetic data only.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
from http.server import HTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_local_swipe_scripts import SKILLS, _Cloud, _expect, _query, _team, _with_cloud  # noqa: E402

SOURCE = Path(__file__).resolve().parents[1] / "desktop" / "src-tauri" / "src" / "local_position_act.rs"


def _run_line(home: Path, line: str) -> dict:
    """The script as the container runs it: stdin carries the request line, the paths are the container's."""
    found = re.search(r'const ACT_PY: &str = r#"(.*?)"#;', SOURCE.read_text(encoding="utf-8"), re.S)
    assert found, "ACT_PY is no longer in local_position_act.rs"
    source = found.group(1).replace("/jht_home", str(home)).replace("/app/shared/skills", str(SKILLS))
    script = home.parent / f"{home.name}-act.py"
    script.write_text(source, encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("JHT_", "TMUX"))}
    env.update(PYTHONDONTWRITEBYTECODE="1", TMUX_TMPDIR=str(home))
    done = subprocess.run([sys.executable, str(script)], input=(line + "\n").encode(), capture_output=True, env=env, timeout=60)
    assert done.returncode == 0, done.stderr.decode()
    return json.loads(done.stdout.decode().strip().splitlines()[-1])


def _act(home: Path, request: dict, *, expect: dict | None = None) -> dict:
    return _run_line(home, json.dumps({**request, "expect": expect if expect is not None else _expect(home)}))


@pytest.fixture
def cloud():
    _Cloud.seen = []
    server = HTTPServer(("127.0.0.1", 0), _Cloud)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server
    server.shutdown()


def test_the_requests_of_the_page_are_kept_in_the_team_database_and_nothing_leaves_for_the_cloud(tmp_path, cloud):
    home = _team(tmp_path)
    _with_cloud(home, cloud)
    assert _act(home, {"op": "recheck", "id": "1", "on": True})["recheck_requested"] is True
    assert _act(home, {"op": "geocode", "id": "1", "on": True})["geocode_requested"] is True
    out = _act(home, {"op": "write_request", "id": "1", "on": True, "kind": "cv"})
    assert out["ok"] is True and out["write_requested"] is True and out["write_request_kind"] == "cv"
    assert _query(home, "SELECT recheck_requested, geocode_requested, write_requested, write_request_kind FROM positions WHERE id = 1") == [(1, 1, 1, "cv")]
    out = _act(home, {"op": "feedback", "id": "1", "value": "like", "note": "bene"})
    assert out["ok"] is True and out["cloud_synced"] is False
    assert _Cloud.seen == [], "a local profile has no cloud: nothing left the container"


def test_a_request_is_taken_back_with_off(tmp_path):
    home = _team(tmp_path)
    _act(home, {"op": "recheck", "id": "1", "on": True})
    _act(home, {"op": "geocode", "id": "1", "on": True})
    _act(home, {"op": "write_request", "id": "1", "on": True, "kind": "cv"})
    assert _act(home, {"op": "recheck", "id": "1", "on": False})["recheck_requested"] is False
    assert _act(home, {"op": "geocode", "id": "1", "on": False})["geocode_requested"] is False
    assert _act(home, {"op": "write_request", "id": "1", "on": False, "kind": "cv"})["write_requested"] is False
    assert _query(home, "SELECT recheck_requested, geocode_requested, write_requested FROM positions WHERE id = 1") == [(0, 0, 0)]


def test_the_writers_own_refusals_come_back_as_codes(tmp_path):
    home = _team(tmp_path)
    # a position that is only «checked» has no CV to write; a cover letter needs an application first
    assert _act(home, {"op": "write_request", "id": "3", "on": True, "kind": "cv"})["code"] == "bad_status"
    assert _act(home, {"op": "write_request", "id": "1", "on": True, "kind": "cover_letter"})["code"] == "cover_letter_requires_application"
    for op in ("recheck", "geocode", "write_request", "user_note", "feedback", "restore"):
        extra = {"on": True} if op in ("recheck", "geocode", "write_request") else {"value": "like"} if op == "feedback" else {}
        assert _act(home, {"op": op, "id": "999", **extra})["code"] == "position_not_found", op


def test_the_private_note_is_written_replaced_and_taken_away(tmp_path):
    home = _team(tmp_path)
    assert _act(home, {"op": "user_note", "id": "1", "note": "una riga\ne un'altra, con accenti: è già"})["saved"] is True
    assert _query(home, "SELECT body FROM position_user_notes WHERE position_id = 1 AND origin = 'box'") == [("una riga\ne un'altra, con accenti: è già",)]
    assert _act(home, {"op": "user_note", "id": "1", "note": "la seconda"})["saved"] is True
    assert _query(home, "SELECT body FROM position_user_notes WHERE position_id = 1") == [("la seconda",)]
    assert _act(home, {"op": "user_note", "id": "1"})["saved"] is False
    assert _query(home, "SELECT count(*) FROM position_user_notes WHERE position_id = 1") == [(0,)]
    # too long is refused and never cut
    assert _act(home, {"op": "user_note", "id": "1", "note": "x" * 5000})["code"] == "note_too_long"
    assert _query(home, "SELECT count(*) FROM position_user_notes") == [(0,)]


def test_the_judgement_still_works_through_the_same_script(tmp_path):
    home = _team(tmp_path)
    out = _act(home, {"op": "exclude", "id": "2", "reason": "wrong_stack", "note": "no thanks"})
    assert out["ok"] is True and out["status"] == "excluded" and out["previous_status"] == "ready"
    back = _act(home, {"op": "restore", "id": "2"})
    assert back["ok"] is True and back["status"] == "ready"


def test_a_read_on_another_database_is_an_old_read_and_nothing_is_written(tmp_path):
    first, second = _team(tmp_path, "first"), _team(tmp_path, "second")
    for request in ({"op": "recheck", "id": "1", "on": True}, {"op": "geocode", "id": "1", "on": True},
                    {"op": "write_request", "id": "1", "on": True, "kind": "cv"}, {"op": "user_note", "id": "1", "note": "x"}):
        assert _act(second, request, expect=_expect(first)) == {"ok": False, "code": "deck_outdated"}, request
    assert _query(second, "SELECT recheck_requested, geocode_requested, write_requested FROM positions WHERE id = 1") == [(0, 0, 0)]
    assert _query(second, "SELECT count(*) FROM position_user_notes") == [(0,)]


@pytest.mark.parametrize(
    "request_",
    [
        {"op": "note", "id": "1"},
        {"op": "mark_applied", "id": "1", "on": True},
        {"op": "recheck", "id": "1"},
        {"op": "recheck", "id": "1", "on": 1},
        {"op": "recheck", "id": "1", "on": "yes"},
        {"op": "recheck", "id": "1", "on": True, "extra": 1},
        {"op": "restore", "id": "1", "on": True},
        {"op": "write_request", "id": "1", "on": True, "kind": "poem"},
        {"op": "user_note", "id": "1", "note": 5},
        {"op": "geocode", "id": "0", "on": True},
        {"op": "geocode", "id": 1, "on": True},
        {"op": "geocode", "id": "1" * 19, "on": True},
    ],
)
def test_a_request_that_is_not_closed_is_refused_and_writes_nothing(tmp_path, request_):
    home = _team(tmp_path)
    assert _act(home, request_) == {"ok": False, "code": "request_invalid"}
    assert _query(home, "SELECT count(*) FROM positions WHERE recheck_requested OR geocode_requested OR write_requested") == [(0,)]
    assert _query(home, "SELECT count(*) FROM position_user_notes") == [(0,)]


def test_the_expected_identity_must_be_two_whole_numbers(tmp_path):
    home = _team(tmp_path)
    for expect in (None, {}, {"ino": 1}, {"ino": "1", "dev": 2}, {"ino": 1, "dev": 2, "x": 3}, {"ino": True, "dev": 1}):
        line = json.dumps({"op": "recheck", "id": "1", "on": True, "expect": expect})
        assert _run_line(home, line) == {"ok": False, "code": "request_invalid"}, expect

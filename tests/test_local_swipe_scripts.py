"""The two fixed scripts of the local Swipe (desktop/src-tauri/src/local_swipe.rs), run for real.

The deck script reads the positions to judge and the ones already judged from a team's jobs.db, read only; the
verdict script writes one verdict through the team's own position_judgement.py, with the cloud turned off, and
only on the database the deck was read from. Synthetic data only.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "desktop" / "src-tauri" / "src" / "local_swipe.rs"
SKILLS = ROOT / "shared" / "skills"


def _script(name: str) -> str:
    found = re.search(rf'const {name}: &str = r#"(.*?)"#;', SOURCE.read_text(encoding="utf-8"), re.S)
    assert found, f"{name} is no longer in local_swipe.rs"
    return found.group(1)


def _run(name: str, home: Path, request: dict) -> dict:
    """The script as the container runs it: stdin carries the request line, the paths are the container's."""
    source = _script(name).replace("/jht_home", str(home)).replace("/app/shared/skills", str(SKILLS))
    script = home.parent / f"{home.name}-{name}.py"
    script.write_text(source, encoding="utf-8")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("JHT_", "TMUX"))}
    env.update(PYTHONDONTWRITEBYTECODE="1", TMUX_TMPDIR=str(home))
    done = subprocess.run([sys.executable, str(script)], input=(json.dumps(request) + "\n").encode(), capture_output=True, env=env, timeout=60)
    assert done.returncode == 0, done.stderr.decode()
    return json.loads(done.stdout.decode().strip().splitlines()[-1])


def _team(tmp_path: Path, name: str = "team") -> Path:
    home = tmp_path / name
    home.mkdir()
    env = {**os.environ, "JHT_HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1"}
    env.pop("JHT_DB", None)
    seed = subprocess.run(
        [sys.executable, "-c", f"""
import sys
sys.path.insert(0, {str(SKILLS)!r})
from _db import get_db, ensure_schema
c = get_db(); ensure_schema(c)
rows = [("Backend", "scored", 80), ("Data", "ready", 70), ("Ops", "checked", None), ("Old", "excluded", 40), ("Judged", "scored", 90), ("Cleared", "scored", 60)]
for title, status, score in rows:
    c.execute("INSERT INTO positions (title, company, status, url, found_at) VALUES (?, 'Acme', ?, ?, datetime('now'))",
              (title, status, "https://jobs.example.com/" + title))
    pid = c.execute("SELECT max(id) FROM positions").fetchone()[0]
    if score is not None:
        c.execute("INSERT INTO scores (position_id, total_score) VALUES (?, ?)", (pid, score))
c.execute("INSERT INTO position_feedback (position_id, action, score) VALUES (5, 'like', 4)")
c.execute("INSERT INTO position_feedback (position_id, action) VALUES (6, 'like')")
c.execute("INSERT INTO position_feedback (position_id, action) VALUES (6, 'clear')")
c.execute("INSERT INTO position_feedback (position_id, action) VALUES (4, 'dislike')")
c.commit(); c.close()
"""],
        capture_output=True, text=True, env=env,
    )
    assert seed.returncode == 0, seed.stderr
    return home


def _query(home: Path, sql: str, *params):
    conn = sqlite3.connect(home / "jobs.db")
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def _expect(home: Path) -> dict:
    info = os.lstat(home / "jobs.db")
    return {"ino": info.st_ino, "dev": info.st_dev}


# ── the deck ──

def test_the_deck_holds_the_positions_to_judge_and_the_judged_ones_with_their_last_verdict(tmp_path):
    home = _team(tmp_path)
    answer = _run("DECK_PY", home, {"op": "deck"})
    assert answer["ok"] is True
    assert {"ino": answer["ino"], "dev": answer["dev"]} == _expect(home)
    assert [(row["title"], row["score"]) for row in answer["pending"]] == [("Backend", 80), ("Data", 70), ("Cleared", 60)]
    assert sorted((item["row"]["title"], item["action"], item["fb_score"]) for item in answer["reviewed"]) == [
        ("Judged", "like", 4),
        ("Old", "dislike", None),
    ]
    # «checked» is in neither deck, and a verdict that was cleared leaves the position to be judged again
    titles = {row["title"] for row in answer["pending"]} | {item["row"]["title"] for item in answer["reviewed"]}
    assert "Ops" not in titles


def test_the_deck_is_read_only_and_a_database_without_the_team_is_two_empty_decks(tmp_path):
    home = _team(tmp_path)
    before = (home / "jobs.db").read_bytes()
    _run("DECK_PY", home, {"op": "deck"})
    assert (home / "jobs.db").read_bytes() == before
    empty = tmp_path / "empty"
    empty.mkdir()
    assert _run("DECK_PY", empty, {"op": "deck"}) == {"ok": True, "ino": 0, "dev": 0, "pending": [], "reviewed": []}


def test_the_deck_is_read_from_a_database_in_wal_mode_while_a_writer_holds_it_open(tmp_path):
    """The team's agents write to the database while the app reads it, and the reader opens it read only."""
    home = _team(tmp_path)
    writer = sqlite3.connect(home / "jobs.db")
    try:
        assert writer.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
        writer.execute("INSERT INTO positions (title, company, status, url, found_at) VALUES ('Fresh', 'Acme', 'scored', 'https://jobs.example.com/f', datetime('now'))")
        writer.commit()
        writer.execute("BEGIN IMMEDIATE")
        writer.execute("INSERT INTO positions (title, company, status, found_at) VALUES ('Uncommitted', 'Acme', 'scored', datetime('now'))")
        answer = _run("DECK_PY", home, {"op": "deck"})
    finally:
        writer.rollback()
        writer.close()
    assert answer["ok"] is True
    titles = [row["title"] for row in answer["pending"]]
    assert "Fresh" in titles and "Uncommitted" not in titles


@pytest.mark.parametrize("request_", [{}, {"op": "list"}, {"op": "deck", "path": "/etc"}, {"op": "deck", "limit": 5}])
def test_the_deck_script_answers_only_the_one_request(tmp_path, request_):
    assert _run("DECK_PY", _team(tmp_path), request_) == {"ok": False, "error": "swipe_request_invalid"}


# ── the verdict ──

class _Cloud(BaseHTTPRequestHandler):
    seen: list[str] = []

    def do_POST(self):  # noqa: N802
        _Cloud.seen.append(self.path)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'{"feedback": {}}')

    def log_message(self, *args):  # silence
        pass


@pytest.fixture
def cloud():
    _Cloud.seen = []
    server = HTTPServer(("127.0.0.1", 0), _Cloud)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server
    server.shutdown()


def _with_cloud(home: Path, server: HTTPServer) -> None:
    (home / "cloud.json").write_text(
        json.dumps({"enabled": True, "base_url": f"http://127.0.0.1:{server.server_port}", "token": "synthetic"}), encoding="utf-8"
    )


def test_a_verdict_is_kept_in_the_team_database_and_never_sent_to_the_cloud(tmp_path, cloud):
    home = _team(tmp_path)
    _with_cloud(home, cloud)
    request = {"op": "feedback", "id": "1", "value": "dislike", "reason": "too_senior", "note": "il mio commento", "expect": _expect(home)}
    answer = _run("JUDGE_PY", home, request)
    assert answer["ok"] is True and answer["value"] == "dislike" and answer["cloud_synced"] is False
    assert _query(home, "SELECT action, reason, note FROM position_feedback WHERE position_id = 1") == [("dislike", "too_senior", "il mio commento")]
    assert _Cloud.seen == [], "a local profile has no cloud: nothing left the container"


def test_the_control_without_the_switch_would_have_reached_the_cloud(tmp_path, cloud):
    """The test above means something only if the cloud answers when it is not turned off."""
    home = _team(tmp_path)
    _with_cloud(home, cloud)
    env = {k: v for k, v in os.environ.items() if not k.startswith(("JHT_", "TMUX"))}
    env.update(JHT_HOME=str(home), PYTHONDONTWRITEBYTECODE="1", TMUX_TMPDIR=str(home))
    done = subprocess.run([sys.executable, str(SKILLS / "position_judgement.py"), "feedback", "1", "--value", "like"],
                          capture_output=True, env=env, timeout=60)
    assert done.returncode == 0, done.stderr.decode()
    assert _Cloud.seen == ["/api/positions/1/feedback"]


def test_a_position_is_excluded_with_its_note_and_put_back(tmp_path):
    home = _team(tmp_path)
    expect = _expect(home)
    out = _run("JUDGE_PY", home, {"op": "exclude", "id": "2", "reason": "wrong_stack", "note": "no thanks", "expect": expect})
    assert out["ok"] is True and out["status"] == "excluded" and out["previous_status"] == "ready"
    assert _query(home, "SELECT status, user_excluded_reason, user_excluded_note FROM positions WHERE id = 2") == [("excluded", "wrong_stack", "no thanks")]
    back = _run("JUDGE_PY", home, {"op": "restore", "id": "2", "expect": expect})
    assert back["ok"] is True and back["status"] == "ready"
    assert _query(home, "SELECT status FROM positions WHERE id = 2") == [("ready",)]


def test_a_deck_read_on_another_database_is_an_old_deck_and_nothing_is_written(tmp_path):
    """Two teams, the same position number: the verdict of a deck of the first never lands on the second."""
    first, second = _team(tmp_path, "first"), _team(tmp_path, "second")
    assert _expect(first) != _expect(second)
    answer = _run("JUDGE_PY", second, {"op": "feedback", "id": "1", "value": "like", "expect": _expect(first)})
    assert answer == {"ok": False, "code": "deck_outdated"}
    assert _query(second, "SELECT count(*) FROM position_feedback WHERE position_id = 1") == [(0,)]
    assert _run("JUDGE_PY", second, {"op": "restore", "id": "1", "expect": {"ino": 1, "dev": 1}}) == {"ok": False, "code": "deck_outdated"}


def test_a_position_that_is_not_there_is_refused_with_its_code(tmp_path):
    home = _team(tmp_path)
    assert _run("JUDGE_PY", home, {"op": "feedback", "id": "999", "value": "like", "expect": _expect(home)}) == {
        "ok": False, "op": "feedback", "id": 999, "code": "position_not_found",
    }


@pytest.mark.parametrize(
    "request_",
    [
        {"op": "note", "id": "1", "expect": None},
        {"op": "write-request", "id": "1", "expect": None},
        {"op": "feedback", "id": "1", "value": "like", "extra": 1, "expect": None},
        {"op": "restore", "id": "1", "note": "x", "expect": None},
        {"op": "feedback", "id": "0", "value": "like", "expect": None},
        {"op": "feedback", "id": "01", "value": "like", "expect": None},
        {"op": "feedback", "id": "1" * 19, "value": "like", "expect": None},
        {"op": "feedback", "id": 1, "value": "like", "expect": None},
        {"op": "feedback", "id": "1", "value": "like", "score": 9, "expect": None},
        {"op": "feedback", "id": "1", "value": "like", "score": True, "expect": None},
        {"op": "feedback", "id": "1", "value": ["like"], "expect": None},
    ],
)
def test_a_request_that_is_not_one_of_the_three_operations_is_refused_and_writes_nothing(tmp_path, request_):
    home = _team(tmp_path)
    answer = _run("JUDGE_PY", home, {**request_, "expect": _expect(home)})
    assert answer == {"ok": False, "code": "request_invalid"}
    assert _query(home, "SELECT count(*) FROM position_feedback") == [(4,)]


def test_the_expected_identity_must_be_two_whole_numbers(tmp_path):
    home = _team(tmp_path)
    for expect in (None, {}, {"ino": 1}, {"ino": "1", "dev": 2}, {"ino": 1, "dev": 2, "x": 3}, {"ino": True, "dev": 1}):
        answer = _run("JUDGE_PY", home, {"op": "feedback", "id": "1", "value": "like", "expect": expect})
        assert answer == {"ok": False, "code": "request_invalid"}, expect

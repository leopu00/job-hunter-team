"""The user's judgement on a position, written on the team's VPS by the app.

shared/skills/position_judgement.py is the one script the app reaches through its
pinned SSH connection. Its arguments are closed; the note comes on stdin, never
as an argument; each operation goes through today's writer with its refusals.
Synthetic jobs.db only.
"""

import importlib.util
import json
import os
import sqlite3
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKILLS_DIR = os.path.join(REPO_ROOT, "shared", "skills")
SCRIPT = os.path.join(SKILLS_DIR, "position_judgement.py")
SENTINEL = "SENTINELLA-nota-privata-7f3a"


@pytest.fixture
def home(tmp_path):
    db = str(tmp_path / "jobs.db")
    env = {**os.environ, "JHT_DB": db, "JHT_HOME": str(tmp_path), "PYTHONDONTWRITEBYTECODE": "1"}
    # The person's command, as the app runs it: no agent name, and a tmux with no server
    # (these tests may run inside an agent's own pane).
    for name in ("JHT_AGENT_NAME", "TMUX", "TMUX_PANE"):
        env.pop(name, None)
    env["TMUX_TMPDIR"] = str(tmp_path)
    seed = subprocess.run([sys.executable, "-c", f"""
import sys
sys.path.insert(0, {SKILLS_DIR!r})
from _db import get_db, ensure_schema
c = get_db(); ensure_schema(c)
for title, status in (("Backend", "scored"), ("Data", "ready"), ("Ops", "checked")):
    c.execute("INSERT INTO positions (title, company, status, url) VALUES (?, 'Acme', ?, ?)",
              (title, status, "https://jobs.example.invalid/" + title))
c.commit(); c.close()
"""], capture_output=True, text=True, env=env)
    assert seed.returncode == 0, seed.stderr
    return db, env, tmp_path


def run(env, *args, note=None, raw=None):
    stdin = raw if raw is not None else (json.dumps({"note": note}) + "\n" if note is not None else "")
    done = subprocess.run([sys.executable, SCRIPT, *args], input=stdin.encode() if isinstance(stdin, str) else stdin,
                          capture_output=True, env=env, timeout=60)
    out = json.loads(done.stdout.decode().strip().splitlines()[-1])
    return done.returncode, out


def row(db, sql, *params):
    conn = sqlite3.connect(db)
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def consent(tmp_path, enabled):
    (tmp_path / "jht.config.json").write_text(
        json.dumps({"applications": {"auto_apply": {"enabled": enabled}}}), encoding="utf-8")


# ── every operation, through today's writer ──

def test_feedback_with_a_reason_and_a_note_from_stdin(home):
    db, env, _ = home
    code, out = run(env, "feedback", "1", "--value", "dislike", "--reason", "too_senior", "--note-on-stdin",
                    note="  too many\nyears  ")
    assert code == 0 and out["ok"] and out["value"] == "dislike"
    assert row(db, "SELECT action, reason, note FROM position_feedback WHERE position_id = 1") == \
        ("dislike", "too_senior", "too many years")


def test_exclude_then_restore(home):
    db, env, _ = home
    code, out = run(env, "exclude", "1", "--reason", "wrong_location", "--note-on-stdin", note="far away")
    assert code == 0 and out["status"] == "excluded" and out["previous_status"] == "scored"
    assert row(db, "SELECT status, user_excluded_reason, user_excluded_note FROM positions WHERE id = 1") == \
        ("excluded", "wrong_location", "far away")
    code, out = run(env, "restore", "1")
    assert code == 0 and out["status"] == "scored"


def test_the_private_note_box_is_saved_and_cleared(home):
    db, env, _ = home
    assert run(env, "note", "1", note="call back on monday")[0] == 0
    assert row(db, "SELECT body FROM position_user_notes WHERE position_id = 1 AND origin = 'box'") == \
        ("call back on monday",)
    assert run(env, "note", "1", note="")[0] == 0
    assert row(db, "SELECT COUNT(*) FROM position_user_notes WHERE position_id = 1") == (0,)


def test_a_cv_request_and_a_recheck(home):
    db, env, _ = home
    code, out = run(env, "write-request", "1", "--on")
    assert code == 0 and out["write_requested"] is True
    assert row(db, "SELECT write_requested FROM positions WHERE id = 1") == (1,)
    # the writer's own refusal: a position that is not scored
    code, out = run(env, "write-request", "3", "--on")
    assert code == 1 and out["code"] == "bad_status"
    code, out = run(env, "recheck", "3", "--on")
    assert code == 0 and row(db, "SELECT recheck_requested FROM positions WHERE id = 3") == (1,)


def test_a_star_with_its_score_and_direction(home):
    db, env, _ = home
    code, out = run(env, "feedback", "1", "--value", "star", "--score", "5", "--direction", "more_like_this")
    assert code == 0 and out["value"] == "star" and out["score"] == 5 and out["direction"] == "more_like_this"
    assert row(db, "SELECT action, score, direction FROM position_feedback WHERE position_id = 1") == \
        ("star", 5, "more_like_this")


def test_a_cover_letter_needs_an_application_first(home):
    db, env, _ = home
    code, out = run(env, "write-request", "1", "--on", "--kind", "cover_letter")
    assert code == 1 and out["code"] == "cover_letter_requires_application"
    assert row(db, "SELECT write_requested, write_request_kind FROM positions WHERE id = 1") == (0, None)
    # the CV is still the default, and the answer says which one was asked
    code, out = run(env, "write-request", "1", "--on")
    assert code == 0 and out["write_request_kind"] == "cv"


# ── the application: consent first, then the gate ──

def test_without_consent_an_application_is_not_authorised_and_nothing_is_written(home):
    db, env, tmp_path = home
    consent(tmp_path, False)
    code, out = run(env, "apply-request", "2", "--on")
    assert code == 1 and out["code"] in ("consent_disabled", "consent_absent")
    assert row(db, "SELECT apply_requested, apply_requested_by FROM positions WHERE id = 2") == (0, None)
    (tmp_path / "jht.config.json").unlink()
    code, out = run(env, "apply-request", "2", "--on")
    assert code == 1 and out["code"] == "config_missing"  # the gate's own reason
    assert row(db, "SELECT apply_requested FROM positions WHERE id = 2") == (0,)


def test_with_consent_the_gate_still_decides(home):
    db, env, tmp_path = home
    consent(tmp_path, True)
    code, out = run(env, "apply-request", "2", "--on")
    assert code == 0, out
    assert row(db, "SELECT apply_requested FROM positions WHERE id = 2") == (1,)
    code, out = run(env, "apply-request", "1", "--on")  # scored, not ready: the gate refuses
    assert code == 1 and out["code"] not in ("consent_absent", "consent_disabled")
    assert row(db, "SELECT apply_requested FROM positions WHERE id = 1") == (0,)


def test_an_agent_can_neither_authorise_nor_withdraw_an_application(home):
    db, env, tmp_path = home
    consent(tmp_path, True)
    agent = {**env, "JHT_AGENT_NAME": "capitano"}
    for switch in ("--on", "--off"):
        code, out = run(agent, "apply-request", "2", switch)
        assert code == 1 and out["code"] == "agent_caller", switch
    assert row(db, "SELECT apply_requested, apply_requested_by FROM positions WHERE id = 2") == (0, None)
    # the person's own request still goes through
    assert run(env, "apply-request", "2", "--on")[0] == 0


# ── closed arguments, the note only on stdin ──

def test_a_reason_outside_the_vocabulary_is_refused_and_writes_nothing(home):
    db, env, _ = home
    for args in (("feedback", "1", "--value", "dislike", "--reason", "troppo senior"),
                 ("exclude", "1", "--reason", "not_a_code")):
        code, out = run(env, *args)
        assert code == 1 and out["code"] == "reason_invalid"
    assert row(db, "SELECT COUNT(*) FROM position_feedback") == (0,)
    assert row(db, "SELECT status FROM positions WHERE id = 1") == ("scored",)


@pytest.mark.parametrize("args", [
    ("feedback", "1", "--value", "dislike", "--note", "free text"),  # no note argument exists
    ("feedback", "1", "--value", "superb"),
    ("feedback", "1", "--value", "star", "--score", "6"),
    ("feedback", "1", "--value", "star", "--score", "five"),
    ("feedback", "1", "--value", "like", "--direction", "sideways"),
    ("write-request", "1", "--on", "--kind", "poem"),
    ("feedback", "1;rm", "--value", "like"),
    ("feedback", "-1", "--value", "like"),
    ("recheck", "1"),
    ("run", "1"),
])
def test_anything_but_the_closed_arguments_is_a_request_error(home, args):
    code, out = run(home[1], *args)
    assert code == 2 and out == {"ok": False, "code": "request_invalid"}


def test_a_note_too_long_is_refused_never_cut(home):
    db, env, _ = home
    code, out = run(env, "feedback", "1", "--value", "dislike", "--note-on-stdin", note="x" * 201)
    assert code == 1 and out["code"] == "note_too_long"
    code, out = run(env, "note", "1", raw=b"{\"note\": \"" + b"y" * 5000 + b"\"}\n")
    assert code == 1 and out["code"] == "note_too_long"
    assert row(db, "SELECT COUNT(*) FROM position_feedback") == (0,)
    assert row(db, "SELECT COUNT(*) FROM position_user_notes") == (0,)


def test_only_one_line_of_stdin_is_read(home):
    db, env, _ = home
    raw = json.dumps({"note": "first"}) + "\n" + json.dumps({"note": "second"}) + "\n"
    assert run(env, "note", "1", raw=raw)[0] == 0
    assert row(db, "SELECT body FROM position_user_notes WHERE position_id = 1") == ("first",)
    code, out = run(env, "note", "1", raw='{"note": "a", "extra": 1}\n')
    assert code == 1 and out["code"] == "note_invalid"


def test_a_missing_position_says_so(home):
    _db, env, _ = home
    for args in (("feedback", "99", "--value", "like"), ("exclude", "99", "--reason", "other"),
                 ("note", "99"), ("recheck", "99", "--on"), ("write-request", "99", "--on")):
        code, out = run(env, *args, note="x" if args[0] == "note" else None)
        assert code == 1 and out["code"] == "position_not_found", args


# ── the note stays the user's: every reader an agent can run, on all three notes ──

def test_the_three_notes_written_here_reach_no_agent_reader(home):
    db, env, _ = home
    assert run(env, "feedback", "1", "--value", "dislike", "--reason", "company", "--note-on-stdin",
               note=SENTINEL)[0] == 0
    assert run(env, "exclude", "2", "--reason", "other", "--note-on-stdin", note=SENTINEL)[0] == 0
    assert run(env, "note", "3", note=SENTINEL)[0] == 0
    spec = importlib.util.spec_from_file_location(
        "note_readers", os.path.join(REPO_ROOT, "tests", "test_feedback_note_never_reaches_agents.py"))
    readers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(readers)
    assert len(readers.READERS) >= 10
    for name, args in readers.READERS + [("db_query.py", ["position", "3", "--json"])]:
        done = subprocess.run([sys.executable, os.path.join(SKILLS_DIR, name), *args], capture_output=True,
                              text=True, env=env, cwd=REPO_ROOT, timeout=60)
        assert SENTINEL not in done.stdout + done.stderr, f"{name} {args}"
    # and the user still has all three
    assert row(db, "SELECT body FROM position_user_notes WHERE position_id = 3") == (SENTINEL,)

"""The first sourcing pass has a cap, and the code keeps it: a Scout is stopped at the limit, not by the Capitano.

Gate CLI 19j: the Scout found 21 positions on a first-run cap of 15 before the Capitano stopped it. The cap
(`scout_cap_first_pass`) was only a number the Capitano was to pass on; it is now counted from the table the pipeline
reads and enforced where a Scout creates a position (db_insert, inside the insert's own transaction) and where it
waits (the throttle engine).

Run:
    pytest tests/test_first_pass_cap.py -v
"""

import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
DB_INSERT = SKILLS_DIR / "db_insert.py"
sys.path.insert(0, str(SKILLS_DIR))


def burst_state(home, cap=3, phase="burst", began=None, **extra):
    began = began or datetime.now(timezone.utc) - timedelta(minutes=1)
    state = {"phase": phase, "burst_started_at": began.isoformat(timespec="seconds"),
             "scout_cap_first_pass": cap, **extra}
    (home / "state").mkdir(exist_ok=True)
    (home / "state" / "first-run.json").write_text(json.dumps(state), encoding="utf-8")


def insert(home, n, agent="scout-1", **env):
    """One `db_insert.py position` as the agent runs it."""
    e = {**os.environ, "JHT_HOME": str(home), "JHT_AGENT_NAME": agent, **env}
    e.pop("JHT_DB", None)
    return subprocess.run(
        [sys.executable, str(DB_INSERT), "position", "--title", f"Role {n}", "--company", f"Company {n}",
         "--url", f"https://jobs.example/{n}", "--source", "test", "--found-by", agent],
        capture_output=True, text=True, env=e, timeout=60)


def rows(home):
    conn = sqlite3.connect(str(home / "jobs.db"))
    try:
        return conn.execute("SELECT COUNT(*) FROM positions").fetchone()[0]
    finally:
        conn.close()


def test_a_scout_is_stopped_at_the_cap_and_told_to_stop(tmp_path):
    burst_state(tmp_path, cap=3)
    for n in range(3):
        assert insert(tmp_path, n).returncode == 0
    out = insert(tmp_path, 3)
    assert out.returncode == 3 and "FIRST_PASS_CAP_REACHED: 3/3" in out.stdout and "STOP sourcing" in out.stdout
    assert rows(tmp_path) == 3, "the position over the cap is not written"


def test_positions_found_before_the_burst_do_not_count(tmp_path):
    for n in range(5):
        assert insert(tmp_path, n).returncode == 0
    conn = sqlite3.connect(str(tmp_path / "jobs.db"))
    conn.execute("UPDATE position_state_transitions SET ts = datetime('now', '-3 hours')")
    conn.commit()
    conn.close()
    burst_state(tmp_path, cap=3)
    assert insert(tmp_path, 10).returncode == 0


@pytest.mark.parametrize("state", [
    dict(phase="steady"),                 # the demonstration is over
    dict(phase="awaiting_profile"),
    dict(cap=0),
    dict(cap=None),
    dict(cap="3"),
    dict(cap=True),
])
def test_without_a_burst_with_a_cap_nobody_is_stopped(tmp_path, state):
    assert insert(tmp_path, 0).returncode == 0
    burst_state(tmp_path, **{"cap": 1, **state})
    conn = sqlite3.connect(str(tmp_path / "jobs.db"))
    conn.execute("UPDATE position_state_transitions SET ts = datetime('now', '+1 hour')")   # counted, if a cap applied
    conn.commit()
    conn.close()
    assert insert(tmp_path, 1).returncode == 0


def test_a_state_that_cannot_be_read_is_no_cap(tmp_path):
    (tmp_path / "state").mkdir()
    (tmp_path / "state" / "first-run.json").write_text("{not json", encoding="utf-8")
    assert insert(tmp_path, 0).returncode == 0 and insert(tmp_path, 1).returncode == 0


def test_only_scouts_are_held_to_it(tmp_path):
    burst_state(tmp_path, cap=1)
    assert insert(tmp_path, 0).returncode == 0
    assert insert(tmp_path, 1, agent="scout-2").returncode == 3
    # What the person or another agent adds is not sourcing.
    assert insert(tmp_path, 2, agent="user").returncode == 0
    assert insert(tmp_path, 3, agent="analista-1").returncode == 0


def test_a_scout_that_declares_another_name_is_held_all_the_same(tmp_path):
    burst_state(tmp_path, cap=1)
    assert insert(tmp_path, 0).returncode == 0
    # the environment says scout-1, the flag says somebody else; and the other way round
    e = {**os.environ, "JHT_HOME": str(tmp_path), "JHT_AGENT_NAME": "scout-1"}
    e.pop("JHT_DB", None)
    out = subprocess.run([sys.executable, str(DB_INSERT), "position", "--title", "T", "--company", "C",
                          "--url", "https://jobs.example/x", "--source", "test", "--found-by", "somebody"],
                         capture_output=True, text=True, env=e, timeout=60)
    assert out.returncode == 3
    e["JHT_AGENT_NAME"] = "somebody"
    out = subprocess.run([sys.executable, str(DB_INSERT), "position", "--title", "T", "--company", "C",
                          "--url", "https://jobs.example/y", "--source", "test", "--found-by", "scout-3"],
                         capture_output=True, text=True, env=e, timeout=60)
    assert out.returncode == 3
    assert rows(tmp_path) == 1


def test_six_scouts_at_once_take_exactly_the_places_there_are(tmp_path):
    assert insert(tmp_path, 100, agent="scout-0").returncode == 0           # the schema is there before the race
    conn = sqlite3.connect(str(tmp_path / "jobs.db"))
    conn.execute("UPDATE position_state_transitions SET ts = datetime('now', '-3 hours')")
    conn.commit()
    conn.close()
    burst_state(tmp_path, cap=3)
    env = {**os.environ, "JHT_HOME": str(tmp_path)}
    env.pop("JHT_DB", None)
    procs = [subprocess.Popen(
        [sys.executable, str(DB_INSERT), "position", "--title", f"Role {i}", "--company", f"Company {i}",
         "--url", f"https://jobs.example/race-{i}", "--source", "test", "--found-by", f"scout-{i}"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env={**env, "JHT_AGENT_NAME": f"scout-{i}"})
        for i in range(1, 7)]
    codes = sorted(p.wait(timeout=60) for p in procs)
    assert codes == [0, 0, 0, 3, 3, 3], codes
    assert rows(tmp_path) == 4


# ── the Scout's wait ──────────────────────────────────────────────────────────────────────────────────────

def _engine(home, monkeypatch):
    for k in ("JHT_HOME", "JHT_DB"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("JHT_HOME", str(home))
    spec = importlib.util.spec_from_file_location("throttle_engine_first_pass", SKILLS_DIR / "throttle_engine.py")
    eng = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(eng)
    (home / "config").mkdir(exist_ok=True)
    (home / "config" / "throttle.json").write_text(json.dumps({"scout-1": 300, "analista-1": 300}), encoding="utf-8")
    return eng


def test_a_scout_at_the_cap_waits_the_hold_and_the_others_wait_what_they_did(tmp_path, monkeypatch):
    insert(tmp_path, 0)
    burst_state(tmp_path, cap=1, began=datetime.now(timezone.utc) - timedelta(hours=1))
    conn = sqlite3.connect(str(tmp_path / "jobs.db"))
    conn.execute("UPDATE position_state_transitions SET ts = datetime('now', '-10 minutes')")
    conn.commit()
    conn.close()
    eng = _engine(tmp_path, monkeypatch)
    now = 1_800_000_000
    res = eng.register("scout-1", reason="post-position", now=now)
    assert res["applied_sec"] == eng.FIRST_PASS_HOLD_SEC == 780 and res["until"] == now + 780
    assert res["first_pass_cap"] == {"cap": 1, "found": 1, "reached": True}
    assert eng.register("analista-1", now=now)["applied_sec"] == 300, "only a Scout is held"


def test_the_hold_ends_with_the_burst_and_does_not_shorten_a_longer_pause(tmp_path, monkeypatch):
    insert(tmp_path, 0)
    burst_state(tmp_path, cap=1, began=datetime.now(timezone.utc) - timedelta(hours=1))
    conn = sqlite3.connect(str(tmp_path / "jobs.db"))
    conn.execute("UPDATE position_state_transitions SET ts = datetime('now', '-10 minutes')")
    conn.commit()
    conn.close()
    eng = _engine(tmp_path, monkeypatch)
    (tmp_path / "config" / "throttle.json").write_text(json.dumps({"scout-1": 1860}), encoding="utf-8")
    assert eng.register("scout-1", now=1_800_000_000)["applied_sec"] == 1860
    burst_state(tmp_path, cap=1, phase="steady", began=datetime.now(timezone.utc) - timedelta(hours=1))
    (tmp_path / "config" / "throttle.json").write_text(json.dumps({"scout-2": 300}), encoding="utf-8")
    eng._MODULE_CACHE.clear()
    assert eng.register("scout-2", now=1_800_000_000)["applied_sec"] == 300, "no burst, no hold"

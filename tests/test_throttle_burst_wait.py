"""In the first burst a worker with nothing to do waits at most the burst cap, not the Capitano's 300 s (JHT-T309).

The measured run (first burst, 09/11): the first Scout unit ended with nothing inserted and the engine gave it the full
300 s; the Analista and the Scorer with an empty queue each got 300 s. The event wake (JHT-T297) can bring the last two
forward, but a Scout is woken by nothing. The cap is `burst_wait` in agents/_skills/throttle/pause-rules.json.

Time is the `now` the engine is given (fake timers): nothing here sleeps.

Run:
    pytest tests/test_throttle_burst_wait.py -v
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

NOW = 1_800_000_000
CAP = json.loads((REPO_ROOT / "agents/_skills/throttle/pause-rules.json").read_text(encoding="utf-8"))["burst_wait"]["cap_sec"]
AFTER_CAP = json.loads((REPO_ROOT / "agents/_skills/throttle/pause-rules.json").read_text(encoding="utf-8"))["burst_wait"]["scout_after_insert"]["cap_sec"]


def first_run_state(home, phase="burst", began=None):
    began = began or datetime.now(timezone.utc) - timedelta(minutes=2)
    state = {"phase": phase, "burst_started_at": began.isoformat(timespec="seconds")}
    (home / "state").mkdir(exist_ok=True)
    (home / "state" / "first-run.json").write_text(json.dumps(state), encoding="utf-8")


def insert(home, n, agent="scout-1"):
    env = {**os.environ, "JHT_HOME": str(home), "JHT_AGENT_NAME": agent}
    env.pop("JHT_DB", None)
    done = subprocess.run(
        [sys.executable, str(DB_INSERT), "position", "--title", f"Role {n}", "--company", f"Company {n}",
         "--url", f"https://jobs.example/{n}", "--source", "test", "--found-by", agent],
        capture_output=True, text=True, env=env, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr


@pytest.fixture
def eng(tmp_path, monkeypatch):
    for key in ("JHT_HOME", "JHT_DB"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    spec = importlib.util.spec_from_file_location("throttle_engine_burst_wait", SKILLS_DIR / "throttle_engine.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    (tmp_path / "config").mkdir(exist_ok=True)
    (tmp_path / "config" / "throttle.json").write_text(
        json.dumps({"scout-1": 300, "scout-2": 300, "analista-1": 300, "scorer-1": 300, "mentor": 300}), encoding="utf-8")
    first_run_state(tmp_path)
    insert(tmp_path, 0, agent="user")    # the schema is there; a position of the user is nobody's Scout work
    conn = sqlite3.connect(str(tmp_path / "jobs.db"))
    conn.execute("UPDATE positions SET status = 'scored'")   # already analysed: every queue starts empty
    conn.commit()
    conn.close()
    return module


def test_a_scout_that_found_nothing_in_the_burst_waits_the_cap(tmp_path, eng):
    res = eng.register("scout-1", reason="post-candidate", now=NOW)
    assert res["applied_sec"] == CAP == 60 and res["until"] == NOW + CAP
    assert res["burst_wait"] == {"cap_sec": CAP, "from_sec": 300, "role": "scout"} and res["shortened_from"] == 300


def test_a_scout_that_has_inserted_in_the_burst_waits_the_after_insert_cap(tmp_path, eng):
    """Measured 11/11: 15 of 16 Scout pauses were 300 s after an insert, half of the Scouts' time asleep, 17 positions in
    30 minutes. After an insert the pause is cut to scout_after_insert.cap_sec."""
    insert(tmp_path, 1, agent="scout-1")
    res = eng.register("scout-1", reason="post-insert", now=NOW)
    assert res["applied_sec"] == AFTER_CAP == 60 and res["until"] == NOW + AFTER_CAP
    assert res["burst_wait"] == {"cap_sec": AFTER_CAP, "from_sec": 300, "role": "scout", "after_insert": True}
    # another Scout that has found nothing is on its own count
    assert eng.register("scout-2", now=NOW)["applied_sec"] == CAP


def test_the_spend_brake_keeps_the_pause_of_a_scout_that_has_inserted(tmp_path, eng, monkeypatch):
    insert(tmp_path, 1, agent="scout-1")
    monkeypatch.setattr(eng, "captains_pause_stays", lambda now: {"reason": "team over its pace"})
    res = eng.register("scout-1", now=NOW)
    assert res["applied_sec"] == 300 and "burst_wait" not in res


def suspend_sources(home, names, monkeypatch):
    """Sources refused by a 429 (source_rate.py state in the fake home, real clock: the engine reads it with its own now)."""
    monkeypatch.setenv("JHT_HOME", str(home))
    spec = importlib.util.spec_from_file_location("source_rate_t", SKILLS_DIR / "source_rate.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for name in names:
        mod.note_hit(name, 429, now=NOW)


@pytest.mark.parametrize("names,cut", [(["remoteok"], True), (["remoteok", "jobspresso"], True),
                                       (["remoteok", "jobspresso", "himalayas"], False),
                                       (["a", "b", "c", "d"], False)])
def test_sources_that_refuse_the_scouts_keep_the_pause_after_an_insert(tmp_path, eng, monkeypatch, names, cut):
    """Fewer than max_suspended_sources suspended: the Scout takes another source and the cap holds; at or above it the
    Capitano's pause stays (the team is being refused widely)."""
    insert(tmp_path, 1, agent="scout-1")
    suspend_sources(tmp_path, names, monkeypatch)
    res = eng.register("scout-1", now=NOW)
    assert (res["applied_sec"] == AFTER_CAP) is cut, res
    assert ("burst_wait" in res) is cut


def test_a_source_pause_that_has_ended_does_not_count(tmp_path, eng, monkeypatch):
    insert(tmp_path, 1, agent="scout-1")
    suspend_sources(tmp_path, ["a", "b", "c"], monkeypatch)
    res = eng.register("scout-1", now=NOW + 24 * 3600)      # past the longest first pause (5 min): none is suspended now
    assert res["applied_sec"] == AFTER_CAP


def test_a_source_state_that_cannot_be_read_keeps_the_pause(tmp_path, eng, monkeypatch):
    insert(tmp_path, 1, agent="scout-1")
    monkeypatch.setattr(eng, "_load_shared", lambda name, filename, _o=eng._load_shared: None if name == "source_rate" else _o(name, filename))
    assert eng.register("scout-1", now=NOW)["applied_sec"] == 300


def test_the_first_pass_ceiling_still_wins_over_the_after_insert_cap(tmp_path, eng):
    state = json.loads((tmp_path / "state" / "first-run.json").read_text(encoding="utf-8"))
    state["scout_cap_first_pass"] = 1
    (tmp_path / "state" / "first-run.json").write_text(json.dumps(state), encoding="utf-8")
    insert(tmp_path, 1, agent="scout-1")
    assert eng.register("scout-1", now=NOW)["applied_sec"] == eng.FIRST_PASS_HOLD_SEC


@pytest.mark.parametrize("phase", ["steady", "awaiting_profile"])
def test_outside_the_burst_a_scout_that_inserted_keeps_its_pause(tmp_path, eng, phase):
    insert(tmp_path, 1, agent="scout-1")
    first_run_state(tmp_path, phase=phase)
    res = eng.register("scout-1", now=NOW)
    assert res["applied_sec"] == 300 and "burst_wait" not in res


def test_an_analista_and_a_scorer_with_an_empty_queue_wait_the_cap(tmp_path, eng):
    for agent in ("analista-1", "scorer-1"):
        res = eng.register(agent, reason="empty queue", now=NOW)
        assert res["applied_sec"] == CAP and res["burst_wait"]["role"] == agent.split("-")[0], agent


def test_no_worker_of_the_burst_waits_longer_than_the_cap_after_the_first_position(tmp_path, eng):
    """From the first position inserted to the first score nobody sleeps a fixed 300 s: the Analista's queue now
    has the position (the queue rule: no pause at all) and the Scorer, still empty, waits the cap."""
    insert(tmp_path, 1, agent="scout-1")
    assert eng.register("analista-1", now=NOW)["applied_sec"] == 0
    assert eng.register("scorer-1", now=NOW)["applied_sec"] == CAP


def test_other_roles_are_not_touched_and_a_longer_pause_is_cut(tmp_path, eng):
    assert eng.register("mentor", now=NOW)["applied_sec"] == 300, "only the three workers of the burst"
    (tmp_path / "config" / "throttle.json").write_text(json.dumps({"scout-1": 1860}), encoding="utf-8")
    assert eng.register("scout-1", now=NOW)["applied_sec"] == CAP, "a longer pause is cut to the cap"


@pytest.mark.parametrize("phase", ["steady", "awaiting_profile"])
def test_outside_the_burst_nothing_changes(tmp_path, eng, phase):
    first_run_state(tmp_path, phase=phase)
    for agent in ("scout-1", "analista-1", "scorer-1"):
        res = eng.register(agent, now=NOW)
        assert res["applied_sec"] == 300 and "burst_wait" not in res, agent


def test_a_missing_or_unreadable_state_is_no_burst(tmp_path, eng):
    (tmp_path / "state" / "first-run.json").write_text("{not json", encoding="utf-8")
    assert eng.register("scout-1", now=NOW)["applied_sec"] == 300
    (tmp_path / "state" / "first-run.json").unlink()
    eng._MODULE_CACHE.clear()
    assert eng.register("scout-2", now=NOW)["applied_sec"] == 300


def test_the_spend_brake_still_holds_the_pause_in_the_burst(tmp_path, eng, monkeypatch):
    monkeypatch.setattr(eng, "captains_pause_stays", lambda now: {"reason": "recovery after a freeze"})
    for agent in ("scout-1", "analista-1", "scorer-1"):
        res = eng.register(agent, now=NOW)
        assert res["applied_sec"] == 300 and "burst_wait" not in res, agent


def test_a_queue_that_cannot_be_read_is_no_rule(tmp_path, eng, monkeypatch):
    monkeypatch.setattr(eng, "queue_is_empty", lambda agent: False)
    assert eng.register("analista-1", now=NOW)["applied_sec"] == 300


def test_the_first_pass_hold_is_not_cut_by_the_cap(tmp_path, eng):
    state = json.loads((tmp_path / "state" / "first-run.json").read_text(encoding="utf-8"))
    state["scout_cap_first_pass"] = 1
    (tmp_path / "state" / "first-run.json").write_text(json.dumps(state), encoding="utf-8")
    insert(tmp_path, 1, agent="scout-1")
    res = eng.register("scout-1", now=NOW)
    assert res["applied_sec"] == eng.FIRST_PASS_HOLD_SEC == 780 and "burst_wait" not in res

"""After a stop the roster says the truth: the sessions closed are `stopped`, not `active` (the watchdog brought them back within the
hour, and every reader of the roster saw a team at work), and not `retired` (the restore brings them back at the next start).
An automatic start (the queue, the watchdog) never turns a `retired` worker back to `active`: the queue started ANALISTA-1, retired
from the roster, and record() put it back among the expected ones."""
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import team_roster as tr  # noqa: E402

NOW = datetime(2026, 11, 20, 17, 0, tzinfo=timezone.utc)


@pytest.fixture
def roster(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_SPAWN_SRC", raising=False)
    path = tmp_path / "roster.json"
    for role, n in (("scout", 1), ("scout", 2), ("analista", 1), ("capitano", None)):
        tr.record(role, n, src="start-agent.sh", path=path, spawn_source="cli-team-start")
    return path


def _status(path, session):
    return tr.load(path)["agents"][session]["status"]


def test_a_stop_marks_the_sessions_stopped_and_leaves_retired_and_unknown_ones_alone(roster):
    tr.retire("SCOUT-2", "scale-down", path=roster)
    marked = tr.stop_mark(["SCOUT-1", "JHT-ANALISTA-1", "SCOUT-2", "SCORER-9"], by="hours", path=roster)
    assert marked == ["SCOUT-1", "ANALISTA-1"]
    assert _status(roster, "SCOUT-1") == "stopped" and _status(roster, "ANALISTA-1") == "stopped"
    assert tr.load(roster)["agents"]["SCOUT-1"]["stop_by"] == "hours"
    assert _status(roster, "SCOUT-2") == "retired", "a retire is a stronger decision than a stop"
    assert "SCORER-9" not in tr.load(roster)["agents"]
    assert _status(roster, "CAPITANO") == "active", "only the sessions named are marked"


def test_the_watchdog_does_not_bring_back_a_stopped_worker_that_was_working(roster):
    tr.stop_mark(["SCOUT-1", "ANALISTA-1"], path=roster)
    state = tr.load(roster)
    activity = {"SCOUT-1": NOW - timedelta(minutes=2), "ANALISTA-1": NOW - timedelta(minutes=2)}
    entry, reason, retire = tr.decide_respawn(state, alive=set(), now=NOW, activity=activity, in_window=True, halted="", cap=10)
    assert entry is None and retire == [], reason


def test_missing_leaves_the_stopped_ones_to_the_restore(roster):
    tr.stop_mark(["SCOUT-1"], path=roster)
    assert "SCOUT-1" not in [e["session"] for e in tr.missing(path=roster, live=set())]
    assert "SCOUT-1" in [e["session"] for e in tr.missing(path=roster, live=set(), include_stopped=True)]


def test_a_new_start_turns_a_stopped_worker_back_to_active(roster):
    tr.stop_mark(["SCOUT-1"], path=roster)
    entry = tr.record("scout", 1, path=roster, spawn_source="agent-watchdog")
    assert entry["status"] == "active" and "stopped_at" not in entry and "stop_by" not in entry


@pytest.mark.parametrize("source", sorted(tr.AUTOMATIC_SPAWN_SOURCES))
def test_an_automatic_start_leaves_a_retired_worker_retired(roster, source):
    tr.retire("ANALISTA-1", "scale-down", path=roster)
    entry = tr.record("analista", 1, path=roster, spawn_source=source)
    assert entry["status"] == "retired" and entry["retired_at"]
    assert entry["spawned_while_retired"]["src"] == source
    assert "ANALISTA-1" not in [e["session"] for e in tr.missing(path=roster, live=set(), include_stopped=True)]


def test_the_source_is_read_from_the_environment_of_start_agent(roster, monkeypatch):
    tr.retire("ANALISTA-1", "scale-down", path=roster)
    monkeypatch.setenv("JHT_SPAWN_SRC", "agent-watchdog")
    assert tr.record("analista", 1, path=roster)["status"] == "retired"


@pytest.mark.parametrize("source", ["cli-team-start", "desktop-panel", "", "CAPITANO"])
def test_a_wanted_start_still_brings_a_retired_worker_back(roster, source):
    tr.retire("ANALISTA-1", "scale-down", path=roster)
    entry = tr.record("analista", 1, path=roster, spawn_source=source)
    assert entry["status"] == "active" and "retired_at" not in entry


def test_the_command_line_marks_the_sessions(tmp_path):
    env = {k: v for k, v in os.environ.items() if k != "JHT_SPAWN_SRC"}
    env["JHT_HOME"] = str(tmp_path)
    tool = str(SKILLS / "team_roster.py")
    subprocess.run([sys.executable, tool, "record", "scout", "1"], env=env, check=True, capture_output=True)
    out = subprocess.run([sys.executable, tool, "stop-mark", "SCOUT-1", "--by", "hours"], env=env, check=True,
                         capture_output=True, text=True)
    assert json.loads(out.stdout) == {"stopped": ["SCOUT-1"]}
    listed = json.loads(subprocess.run([sys.executable, tool, "list"], env=env, check=True, capture_output=True, text=True).stdout)
    agents = listed.get("agents", listed)
    assert agents["SCOUT-1"]["status"] == "stopped"

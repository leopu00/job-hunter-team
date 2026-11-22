"""The number of sessions a start may bring up: the lowest of the roster's rule and the capacity of the machine, never above
eleven sessions in all, and never an agent the Capitano retired (a round on Linux: ANALISTA-1, retired, started twice by the queue)."""
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import queue_demand as qd  # noqa: E402
import session_cap as sc  # noqa: E402

T0 = 1_800_000_000.0
FIXED = ["CAPITANO", "SENTINELLA", "ASSISTENTE", "MENTOR", "DOTTORE", "SENTINELLA-WORKER"]


@pytest.fixture
def world(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(qd, "_MODULES", {"session_cap": sc})
    monkeypatch.setattr(sc, "_MODULES", {})
    state = {"sessions": FIXED + ["SCOUT-1", "SCOUT-2"], "retired": set(), "roster_cap": 5, "host_cap": 8}
    monkeypatch.setattr(qd, "phase", lambda: "steady")
    monkeypatch.setattr(qd, "live_sessions", lambda: state["sessions"])
    monkeypatch.setattr(qd, "queue_count", lambda role: 4 if role == "analista" else 0)
    monkeypatch.setattr(qd, "brake", lambda now, live: None)
    monkeypatch.setattr(qd, "held_back", lambda session: False)
    monkeypatch.setattr(sc, "roster_workers", lambda: state["roster_cap"])
    monkeypatch.setattr(sc, "host_workers", lambda: state["host_cap"])
    monkeypatch.setattr(sc, "is_retired", lambda session: session in state["retired"])
    return state


def _decide(world_state):
    qd.decide(T0)
    return qd.decide(T0 + qd.WAIT_S)


def test_the_cap_is_the_lowest_of_the_roster_rule_and_the_machine_and_never_above_eleven(world):
    assert sc.worker_cap() == 5
    world["host_cap"] = 3
    assert sc.worker_cap() == 3, "the machine carries less than the roster asks"
    world["host_cap"], world["roster_cap"] = None, 9
    assert sc.worker_cap() == 5, "11 sessions in all, 6 of them fixed"
    world["roster_cap"] = None
    assert sc.worker_cap() == 5


def test_a_start_that_would_pass_the_cap_is_refused(world):
    world["roster_cap"] = 3
    world["sessions"] = FIXED + ["SCOUT-1", "SCOUT-2", "SCOUT-3"]
    assert sc.check(world["sessions"]) == "capacity" and sc.room(world["sessions"]) == 0
    world["sessions"] = FIXED + ["SCOUT-1", "SCOUT-2"]
    assert sc.check(world["sessions"]) is None and sc.room(world["sessions"]) == 1
    world["roster_cap"], world["host_cap"] = 9, None
    world["sessions"] = FIXED + ["SCOUT-%d" % n for n in range(1, 6)]
    assert sc.check(world["sessions"]) == "session-cap" and sc.room(world["sessions"]) == 0
    world["sessions"] = FIXED + ["SCOUT-1"]
    assert sc.check(world["sessions"]) is None


def test_the_queue_does_not_start_a_worker_past_the_cap(world):
    world["sessions"] = FIXED + ["SCOUT-%d" % n for n in range(1, 6)]
    out = _decide(world)
    assert out["start"] is None and out["why"] == "session-cap"


def test_the_queue_does_not_bring_back_a_retired_agent(world):
    world["retired"] = {"ANALISTA-1"}
    out = _decide(world)
    assert out["start"] is None and out["why"] == "held-back"


def test_the_queue_still_starts_the_worker_when_there_is_room_and_nobody_is_retired(world):
    assert _decide(world)["start"] == ["analista", 1, "ANALISTA-1"]


def test_a_cap_that_cannot_be_read_is_a_brake(world, monkeypatch):
    def boom():
        raise RuntimeError("no reading")
    monkeypatch.setattr(sc, "roster_workers", boom)
    monkeypatch.setattr(sc, "host_workers", boom)
    assert sc.check(world["sessions"]) == "capacity-unreadable"

"""At the opening of the working window the workers the close of the hours stopped come back at once, up to the cap, even when a
worker is already up (21/11: they came back one by one from 08:31 to 10:02, the first one a start of the queue). Never a retired
one, never over the cap of the sessions; a start that fails is tried again at the next check; a role the core image cannot start
waits for the full image (18/11: exit 75). It holds across a refresh of the Capitano (the restore of its boot looks back 6 hours)
and a restart of the container (the roster is on disk)."""
import importlib
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import roster_restore as rr  # noqa: E402
import team_roster as tr  # noqa: E402

FIXED = {"CAPITANO", "SENTINELLA", "ASSISTENTE", "MENTOR", "DOTTORE", "SENTINELLA-WORKER"}
WORKERS = [("scout", 1), ("scout", 2), ("analista", 1), ("analista", 2), ("scorer", 1)]


class Cap:
    """session_cap with a machine that carries `host` workers (None: not measurable), eleven sessions in all."""
    host = None

    @classmethod
    def room(cls, live):
        workers = [s for s in live if rr._is_worker(s)]
        cap = 11 if cls.host is None else cls.host
        return max(0, min(min(cap, 5) - len(workers), 11 - len(live)))


@pytest.fixture
def team(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_SPAWN_SRC", raising=False)
    for role, n in WORKERS:
        tr.record(role, n, spawn_source="cli-team-start")
    alive = set(FIXED)
    monkeypatch.setattr(tr, "live_sessions", lambda: set(alive))
    monkeypatch.setattr(tr, "_tools_missing", lambda: ())
    queue = type("Q", (), {"brake": staticmethod(lambda t, n: None), "held_back": staticmethod(lambda s: False)})
    Cap.host = None
    monkeypatch.setattr(rr, "_MODULES", {"team_roster": tr, "queue_demand": queue, "session_cap": Cap,
                                         "burst_roster": rr._load("burst_roster"), "pi_spend_cap": None})
    monkeypatch.setattr(rr, "phase", lambda: "steady")
    monkeypatch.setattr(rr, "WINDOW_H", 6.0)        # the look-back of the boot of the Capitano, the shortest one
    return {"alive": alive, "queue": queue, "home": tmp_path}


def _close_for_the_hours(hours_ago=14.0, sessions=None):
    """The close of 18:00: the workers stopped by `hours`, `hours_ago` hours ago."""
    names = sessions or ["%s-%d" % (r.upper(), n) for r, n in WORKERS]
    assert tr.stop_mark(names, by="hours") == names
    state = tr.load()
    moment = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat(timespec="seconds").replace("+00:00", "Z")
    for name in names:
        state["agents"][name]["stopped_at"] = moment
    tr.save(state)


def _sessions(out):
    return sorted("%s-%d" % (role.upper(), n) for role, n in out["start"])


def test_at_the_opening_every_worker_stopped_for_the_hours_comes_back_after_a_night_of_fourteen_hours(team):
    _close_for_the_hours(14)
    out = rr.plan()
    assert _sessions(out) == ["ANALISTA-1", "ANALISTA-2", "SCORER-1", "SCOUT-1", "SCOUT-2"], out["why_not"]


def test_a_worker_already_up_does_not_hold_the_others(team):
    _close_for_the_hours(14)
    team["alive"].add("ANALISTA-1")          # 07:54: the queue started one before the opening of the rest
    out = rr.plan()
    assert _sessions(out) == ["ANALISTA-2", "SCORER-1", "SCOUT-1", "SCOUT-2"], out["why_not"]


def test_the_restore_of_the_last_hour_does_not_hold_the_opening(team):
    _close_for_the_hours(14)
    rr._write_marker(time.time())            # the Capitano's boot restored at 08:00 (the TTL refresh), the watchdog looks at 08:05
    assert len(rr.plan()["start"]) == 5


def test_never_over_the_cap_of_the_sessions_nor_the_machine(team):
    _close_for_the_hours(14)
    Cap.host = 3
    assert len(rr.plan()["start"]) == 3, "the machine carries three workers"
    Cap.host = None
    team["alive"].update({"CRITICO-S1", "SCRITTORE-1", "CLOSER-1"})   # 9 sessions alive, 2 workers among them
    out = rr.plan()
    assert len(out["start"]) == 2 and len(team["alive"]) + len(out["start"]) <= 11


def test_a_retired_worker_never_comes_back(team):
    _close_for_the_hours(14)
    tr.retire("ANALISTA-1", "scale-down by the Capitano")
    assert "ANALISTA-1" not in _sessions(rr.plan())


def test_a_worker_stopped_by_the_person_waits_while_another_is_up(team):
    tr.stop_mark(["SCOUT-1"], by="user")
    _close_for_the_hours(14, sessions=["SCOUT-2", "ANALISTA-1", "ANALISTA-2", "SCORER-1"])
    team["alive"].add("SCORER-1")
    assert "SCOUT-1" not in _sessions(rr.plan()), "jht team stop scout-1 is the person's decision: only the close of the hours reopens"


def test_a_start_that_fails_is_tried_again_and_then_given_up(team):
    _close_for_the_hours(14)
    now = time.time()
    rr._write_marker(now, {"SCOUT-1": [now - 600] * (rr.MAX_TRIES - 1)})
    assert "SCOUT-1" in _sessions(rr.plan(now))
    rr._write_marker(now, {"SCOUT-1": [now - 600] * rr.MAX_TRIES})
    assert "SCOUT-1" not in _sessions(rr.plan(now))
    assert "SCOUT-1" in _sessions(rr.plan(now + 13 * 3600)), "the tries of yesterday do not count today"


def test_the_start_records_a_failed_start_for_the_next_check(team, monkeypatch, tmp_path):
    _close_for_the_hours(14, sessions=["SCOUT-1"])
    launcher = tmp_path / "start-agent.sh"
    launcher.write_text("#!/bin/sh\necho 'scout not started: it needs the tools of the full image' >&2\nexit 75\n")
    launcher.chmod(0o755)
    burst = rr._MODULES["burst_roster"]
    monkeypatch.setattr(burst, "_launcher", lambda: str(launcher))
    monkeypatch.setattr(burst, "_log", lambda row: None)
    out = rr.start()
    assert {row["rc"] for row in out["started"]} == {75} and ["scout", 1] in [[r["role"], r["number"]] for r in out["started"]]
    assert len(rr._tries(time.time()).get("SCOUT-1", [])) == 1
    assert tr.load()["agents"]["SCOUT-1"]["status"] == "stopped", "still stopped: the next check tries it again"


def test_on_the_core_image_the_roles_that_need_the_tools_wait_without_spending_a_try(team, monkeypatch):
    _close_for_the_hours(14)
    monkeypatch.setattr(tr, "_tools_missing", lambda: ("scout", "analista"))
    assert _sessions(rr.plan()) == ["SCORER-1"]
    team["alive"].add("SCORER-1")
    out = rr.plan()
    assert out["start"] == [] and "full image" in out["why_not"]


def test_outside_the_window_nothing_comes_back(team):
    _close_for_the_hours(1)
    team["queue"].brake = staticmethod(lambda t, n: "off-hours")
    out = rr.plan()
    assert out["start"] == [] and "off-hours" in out["why_not"]


def test_a_stop_of_more_than_a_week_ago_is_not_an_opening(team):
    _close_for_the_hours(24 * 8)
    team["alive"].add("SCOUT-1")
    assert rr.plan()["start"] == []


def test_a_restart_of_the_container_reads_the_same_roster_from_disk(team, monkeypatch):
    _close_for_the_hours(14)
    before = _sessions(rr.plan())
    fresh = importlib.reload(tr)              # a new process: nothing in memory, the roster file is what is left
    monkeypatch.setattr(fresh, "live_sessions", lambda: set(FIXED))
    monkeypatch.setattr(fresh, "_tools_missing", lambda: ())
    rr._MODULES["team_roster"] = fresh
    assert _sessions(rr.plan()) == before
    assert json.loads((team["home"] / "logs" / "team-roster.json").read_text())["agents"]["SCOUT-1"]["stop_by"] == "hours"

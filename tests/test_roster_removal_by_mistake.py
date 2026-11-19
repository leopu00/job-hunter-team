"""The roster does not take a worker for removed on purpose when the container or its image is the reason it is gone: the update
(core image, then full) retired every worker as «sonda spesa» and the team came back with no Scout (giro Linux, retest of the brake)."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import team_roster as tr  # noqa: E402

T0 = datetime(2026, 11, 19, 2, 40, tzinfo=timezone.utc)
WORKERS = [("SCOUT-1", "scout", 1), ("SCOUT-2", "scout", 2), ("ANALISTA-5", "analista", 5), ("SCORER-2", "scorer", 2)]


def _iso(dt):
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def _state(respawned_at=None, **extra):
    agents = {}
    for name, role, number in WORKERS:
        agents[name] = dict({"session": name, "role": role, "instance": number, "status": "active",
                             "respawns": [_iso(respawned_at)] if respawned_at and role != "scorer" else []}, **extra)
    return {"agents": agents}


def _decide(state, now, started=None, missing=(), activity_at=None, alive=()):
    activity = {name: (activity_at or now) for name, _, _ in WORKERS}
    return tr.decide_respawn(state, alive=set(alive), now=now, activity=activity, in_window=True, halted="",
                             container_started=started, tools_missing=tuple(missing), cap=10)


def test_on_the_core_image_the_workers_that_need_the_tools_are_neither_recreated_nor_retired():
    state = _state(respawned_at=T0 - timedelta(minutes=30))     # a respawn of a few minutes ago, on the same core container
    now = T0
    entry, reason, retire = _decide(state, now, started=T0 - timedelta(minutes=45), missing=("scout", "analista", "scrittore", "closer"))
    assert retire == [], "the second absence is the image, not a probe spent"
    assert entry is not None and entry["session"] == "SCORER-2", "the Scorer does not need the tools: it is the one that can start"
    assert all(e["status"] == "active" for e in state["agents"].values())


def test_a_respawn_of_a_previous_life_of_the_container_is_not_a_spent_probe():
    state = _state(respawned_at=T0 - timedelta(minutes=50))
    started = T0 - timedelta(minutes=10)    # the container started after the last respawn: this one has not been tried
    entry, reason, retire = _decide(state, T0, started=started)
    assert retire == [] and reason == "respawn" and entry is not None
    # a respawn of THIS life that disappeared again is still a probe spent: the rule stays for what it was made for
    entry, reason, retire = _decide(_state(respawned_at=T0 - timedelta(minutes=5)), T0, started=started)
    assert sorted(retire) == ["ANALISTA-5", "SCOUT-1", "SCOUT-2"]


def test_from_the_core_to_the_full_image_with_a_fake_clock_nobody_is_retired_and_the_scouts_come_back_first():
    state = _state(respawned_at=T0 - timedelta(minutes=20))
    core_started = T0 - timedelta(minutes=30)
    for minute in (0, 1, 2, 3):                      # on the core: looks of the watchdog, nothing happens to the roster
        entry, reason, retire = _decide(state, T0 + timedelta(minutes=minute), started=core_started,
                                        missing=("scout", "analista", "scrittore", "closer"))
        assert retire == []
    full_started = T0 + timedelta(minutes=4)         # the container on the full image
    order, alive = [], set()
    for step in range(len(WORKERS)):
        now = T0 + timedelta(minutes=5 + step)
        entry, reason, retire = _decide(state, now, started=full_started, alive=alive)
        assert retire == [] and entry is not None, (step, reason)
        order.append(entry["session"])
        alive.add(entry["session"])
    assert order[:2] == ["SCOUT-1", "SCOUT-2"] or set(order[:2]) == {"SCOUT-1", "SCOUT-2"}, "the Scouts first"
    assert set(order) == {n for n, _, _ in WORKERS}
    assert all(e["status"] == "active" for e in state["agents"].values())


def test_the_workers_retired_by_the_old_rule_in_the_last_24_hours_come_back_once():
    reason = "respawn already attempted and session disappeared again — treating it as an intentional removal"
    state = _state()
    for name in ("SCOUT-1", "SCOUT-2", "ANALISTA-5"):
        state["agents"][name].update(status="retired", retired_at=_iso(T0 - timedelta(hours=2)), retire_reason=reason)
    state["agents"]["SCORER-2"].update(status="retired", retired_at=_iso(T0 - timedelta(hours=30)), retire_reason=reason)   # too old
    state["agents"]["SCOUT-3"] = {"session": "SCOUT-3", "role": "scout", "instance": 3, "status": "retired", "respawns": [],
                                  "retired_at": _iso(T0 - timedelta(hours=1)), "retire_reason": "removed by the Captain: C-02"}
    state["agents"]["ANALISTA-6"] = {"session": "ANALISTA-6", "role": "analista", "instance": 6, "status": "retired", "respawns": [],
                                     "retired_at": _iso(T0 - timedelta(hours=1)), "retire_reason": reason, "reinstated_at": _iso(T0 - timedelta(hours=20))}
    state["agents"]["SCORER-3"] = {"session": "SCORER-3", "role": "scorer", "instance": 3, "status": "retired", "respawns": [],
                                   "retired_at": _iso(T0 - timedelta(hours=1)), "retire_reason": reason, "retire_rule": 2}
    assert sorted(tr.reinstate_removed_by_mistake(state, T0)) == ["ANALISTA-5", "SCOUT-1", "SCOUT-2"]
    assert state["agents"]["SCORER-3"]["status"] == "retired", "retired by the corrected rule (recreated, then removed again): stays"
    assert state["agents"]["SCORER-2"]["status"] == "retired", "older than a day: left as it was"
    assert state["agents"]["SCOUT-3"]["status"] == "retired", "another reason: left"
    assert state["agents"]["ANALISTA-6"]["status"] == "retired", "once only"
    assert state["agents"]["SCOUT-1"]["status"] == "active" and "retire_reason" not in state["agents"]["SCOUT-1"]
    # they are owed a respawn without a sign of life of the last 90 minutes, the Scouts first
    entry, why, retire = tr.decide_respawn(state, alive=set(), now=T0, activity={}, in_window=True, halted="")
    assert why == "respawn" and entry["session"] in ("SCOUT-1", "SCOUT-2") and retire == []
    # on the core the Scouts wait (owed, not recreated), and the one that does not need the tools goes: here no one is left
    entry, why, retire = tr.decide_respawn(state, alive=set(), now=T0, activity={}, in_window=True, halted="",
                                           tools_missing=("scout", "analista", "scrittore", "closer"))
    assert entry is None and retire == []
    # a spawn clears what was owed
    sess = "SCOUT-1"
    state["agents"][sess]["respawns"] = []
    state["agents"][sess].pop("owed_respawn_at", None)
    again, _, _ = tr.decide_respawn(state, alive={"SCOUT-1", "SCOUT-2"}, now=T0, activity={}, in_window=True, halted="")
    assert again is not None and again["session"] == "ANALISTA-5"


def test_a_spawn_clears_the_respawn_that_was_owed(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    path = tmp_path / "team-roster.json"
    state = _state()
    state["agents"]["SCOUT-1"].update(status="retired", retired_at=_iso(datetime.now(timezone.utc)),
                                      retire_reason="respawn already attempted and session disappeared again — x")
    tr.reinstate_removed_by_mistake(state, datetime.now(timezone.utc))
    assert "owed_respawn_at" in state["agents"]["SCOUT-1"]
    tr.save(state, path)
    entry = tr.record("scout", 1, path=path)
    assert "owed_respawn_at" not in entry and entry["status"] == "active" and entry["reinstated_at"]

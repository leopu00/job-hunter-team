"""After an update the system brings back the workers that were working, at once (Mac, build10: one Scout after 11 minutes).

The Capitano wanted to check the spending first and the watchdog's roster brings back one worker per tick, three an hour.
roster_restore.py starts them from the roster, in the order of the first run, under the brakes.
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import roster_restore as rr  # noqa: E402


def _entry(role, number, status="active"):
    return {"session": f"{role.upper()}-{number}", "role": role, "instance": number, "status": status}


class FakeRoster:
    def __init__(self, entries, alive=(), signs=None):
        self.entries, self.alive, self.signs = entries, set(alive), signs or {}

    def live_sessions(self):
        return self.alive

    def missing(self, live=None):
        return [e for e in self.entries if e["status"] == "active" and e["session"] not in (live or set())]

    def last_activity(self, session, home=None):
        return self.signs.get(session)


@pytest.fixture
def world(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    now = datetime.now(timezone.utc)
    entries = [_entry("scout", 1), _entry("scout", 2), _entry("scout", 4), _entry("analista", 3), _entry("scorer", 1), _entry("scrittore", 1)]
    signs = {e["session"]: now - timedelta(minutes=20) for e in entries}
    roster = FakeRoster(entries, signs=signs)
    queue = type("Q", (), {"brake": staticmethod(lambda t, n: None), "held_back": staticmethod(lambda s: False)})
    registry = type("R", (), {"_host_agent_cap": staticmethod(lambda: None)})
    burst = rr._load("burst_roster")
    monkeypatch.setattr(rr, "_MODULES", {"team_roster": roster, "queue_demand": queue, "plan_registry": registry, "burst_roster": burst})
    monkeypatch.setattr(rr, "phase", lambda: "steady")
    return {"roster": roster, "queue": queue, "registry": registry, "now": now, "entries": entries}


def test_the_workers_that_were_working_come_back_in_the_order_of_the_first_run(world):
    out = rr.plan()
    assert out["why_not"] == ""
    roles = [role for role, _ in out["start"]]
    assert roles == ["scout", "scout", "analista", "scorer", "scout"], "two Scouts, an Analista, a Scorer, the rest; the Scrittore is on demand"
    assert out["start"][:2] == [["scout", 1], ["scout", 2]] and ["scout", 4] in out["start"], "each keeps its own number"


def test_only_when_the_first_run_is_over_and_no_worker_is_alive(world, monkeypatch):
    monkeypatch.setattr(rr, "phase", lambda: "burst")
    assert rr.plan()["start"] == []
    monkeypatch.setattr(rr, "phase", lambda: "steady")
    world["roster"].alive = {"SCOUT-1"}
    assert rr.plan()["start"] == [] and "already up" in rr.plan()["why_not"]


def test_a_worker_with_no_recent_sign_of_life_is_not_brought_back(world):
    old = world["now"] - timedelta(hours=30)
    world["roster"].signs["SCOUT-2"] = old
    world["roster"].signs["SCOUT-4"] = None
    out = rr.plan()
    assert ["scout", 2] not in out["start"] and ["scout", 4] not in out["start"] and ["scout", 1] in out["start"]


def test_never_against_a_brake_or_for_an_agent_held_back_or_over_the_capacity(world, monkeypatch):
    world["queue"].brake = staticmethod(lambda t, n: "daily-halt")
    out = rr.plan()
    assert out["start"] == [] and "daily-halt" in out["why_not"]
    world["queue"].brake = staticmethod(lambda t, n: None)
    world["queue"].held_back = staticmethod(lambda s: s == "SCOUT-2")
    assert ["scout", 2] not in rr.plan()["start"]
    world["queue"].held_back = staticmethod(lambda s: False)
    world["registry"]._host_agent_cap = staticmethod(lambda: 3)
    assert len(rr.plan()["start"]) == 3, "never more workers than the machine carries"


def test_a_brake_or_a_capacity_that_cannot_be_read_starts_nothing(world, monkeypatch):
    mods = dict(rr._MODULES)
    monkeypatch.setattr(rr, "_MODULES", {**mods, "queue_demand": None})
    out = rr.plan()
    assert out["start"] == [] and "brakes cannot be read" in out["why_not"]
    monkeypatch.setattr(rr, "_MODULES", {**mods, "plan_registry": None})
    assert rr.plan()["start"] == []

    def boom():
        raise RuntimeError("unreadable")

    monkeypatch.setattr(rr, "_MODULES", {**mods, "plan_registry": type("R", (), {"_host_agent_cap": staticmethod(boom)})})
    out = rr.plan()
    assert out["start"] == [] and "capacity" in out["why_not"]
    world["queue"].brake = staticmethod(lambda t, n: boom())
    monkeypatch.setattr(rr, "_MODULES", mods)
    assert rr.plan()["start"] == []
    # a capacity that is not MEASURABLE (none) has no cap to exceed
    world["queue"].brake = staticmethod(lambda t, n: None)
    assert rr.plan()["start"] != []


def test_one_run_per_boot(world):
    rr._write_marker(world["now"].timestamp())
    out = rr.plan()
    assert out["start"] == [] and "less than an hour" in out["why_not"]
    assert rr.plan(world["now"].timestamp() + 7200)["start"] != []


def test_nothing_is_assumed_when_the_roster_cannot_be_read(world, monkeypatch):
    monkeypatch.setattr(rr, "_roster_entries", lambda: (None, None))
    assert rr.plan()["start"] == []


def test_the_start_launches_each_worker_with_its_brief_through_the_launcher(world, monkeypatch, tmp_path):
    launched = []

    def fake_run(cmd, **kwargs):
        launched.append((cmd[-2:], kwargs["env"].get("JHT_WORKER_BRIEF")))
        return type("R", (), {"returncode": 0, "stdout": "", "stderr": ""})()

    monkeypatch.setattr(rr.subprocess, "run", fake_run)
    monkeypatch.setenv("JHT_START_AGENT", "/bin/true")
    out = rr.start()
    assert [row["ok"] for row in out["started"]] == [True] * 5
    assert launched[0][0] == ["scout", "1"] and "resume the main loop" in launched[0][1]
    assert "scout_coord.py auto scout-1" in launched[0][1], "a Scout takes its lane again"
    again = rr.start()
    assert again["started"] == [] and "less than an hour" in again["note"]


def test_the_boot_block_tells_the_capitano_not_to_hold_the_search(monkeypatch):
    import captain_boot
    calls = []

    def fake_json(*argv):
        calls.append(argv[1:])
        return {"start": [["scout", 1], ["analista", 3]]} if argv[1] == "plan" else {"detached": True}

    monkeypatch.setattr(captain_boot, "_json", fake_json)
    text = captain_boot._start_roster({"phase": "steady"})
    assert "SCOUT" not in text and "scout-1, analista-3" in text and "Do NOT hold the search for a check of the spending" in text
    assert ("start", "--detach") in calls
    monkeypatch.setattr(captain_boot, "_json", lambda *a: {"start": []})
    assert captain_boot._start_roster({"phase": "steady"}) == ""
    assert captain_boot._start_roster({"phase": "awaiting_profile"}) == ""


def test_a_worker_started_shortly_before_the_stop_comes_back_even_with_no_message_or_artifact_yet(world):
    now = world["now"]
    for entry in world["entries"]:
        world["roster"].signs[entry["session"]] = None
    by_name = {e["session"]: e for e in world["entries"]}
    by_name["SCOUT-1"]["last_spawn"] = (now - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    by_name["SCOUT-2"]["last_spawn"] = (now - timedelta(hours=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    by_name["SCOUT-4"]["last_spawn"] = "not a date"
    out = rr.plan()["start"]
    assert ["scout", 1] in out
    assert ["scout", 2] not in out and ["scout", 4] not in out


def _budget_in_config(home, now, usd, hours_gone=1, hours_left=23):
    start, end = now - timedelta(hours=hours_gone), now + timedelta(hours=hours_left)
    (home / "jht.config.json").write_text(json.dumps({"team": {"budget": {"usd": usd, "starts_at": start.isoformat(), "ends_at": end.isoformat()}}}),
                                          encoding="utf-8")


def test_the_restore_after_a_restart_comes_back_by_stages_of_the_pace_not_all_together(world, tmp_path):
    """Retest 8d5f09a2b: at the restart of the container «the team was restarted» went to seven workers at once, past the line."""
    _budget_in_config(tmp_path, world["now"], 3.0)
    out = rr.plan()
    assert out["start"] and out["start"][0] == ["scout", 1], "the Scouts first"
    assert len(out["start"]) < 5, "the rest waits for the line to rise: %s" % out["start"]
    assert out["pace"]["waiting"], "who waits is said"


def test_the_restore_with_room_to_work_brings_everyone_and_without_a_budget_nothing_changes(world, tmp_path):
    _budget_in_config(tmp_path, world["now"], 300.0)
    assert len(rr.plan()["start"]) == 5
    (tmp_path / "jht.config.json").write_text("{}", encoding="utf-8")
    assert len(rr.plan()["start"]) == 5


def test_a_config_that_is_not_json_is_no_budget_and_holds_nothing(world, tmp_path):
    (tmp_path / "jht.config.json").write_text("[" * 100000, encoding="utf-8")
    assert len(rr.plan()["start"]) == 5

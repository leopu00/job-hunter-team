"""JHT-T352 F-08 (collaudo W1 26/11): at the end of the onboarding the container is recreated for the switch onto the full image
(JHT-T346), and the Dottore and the Mantenitore, whose rounds were done, were gone and not started again until their next slot.
The switch job writes $JHT_HOME/state/tools-switch.json {"schema": 1, "at": <ISO UTC>} BEFORE the core goes down: a done round
whose session that recreation took away is opened again, once per recreation. Synthetic state, no tmux, no LLM.
"""
import importlib.util
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location("doctor_schedule_recreation", ROOT / "shared" / "skills" / "doctor_schedule.py")
ds = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ds)

_START = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(hours=2)
TODAY = "2026-11-26"
ALIVE: dict = {}


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(ds, "JHT_HOME", tmp_path)
    monkeypatch.setattr(ds, "STATE_FILE", tmp_path / "logs" / "doctor-schedule-state.json")
    monkeypatch.setattr(ds, "SWITCH_FILE", tmp_path / "state" / "tools-switch.json")
    monkeypatch.setattr(ds, "_bounds_now", lambda: (_START, _START + timedelta(hours=12), datetime.now(timezone.utc)))
    monkeypatch.setattr(ds, "_today_local", lambda: TODAY)
    monkeypatch.setattr(ds, "is_within_working_hours", lambda: True)
    monkeypatch.setattr(ds, "_service_blocked", lambda role: False)
    ALIVE.clear()
    monkeypatch.setattr(ds, "_session_alive", lambda session: ALIVE.get(session, False))
    (tmp_path / "logs").mkdir()
    (tmp_path / "state").mkdir()
    return tmp_path


def record(home, role, age):
    (home / "logs" / f"spawn-last-{role}.json").write_text(json.dumps({"ts": int(time.time() - age), "session": role.upper(),
                                                                       "role": role, "cli": "claude"}), encoding="utf-8")


def switch(home, age):
    at = datetime.now(timezone.utc) - timedelta(seconds=age)
    (home / "state" / "tools-switch.json").write_text(json.dumps({"schema": 1, "at": at.isoformat().replace("+00:00", "Z")}),
                                                      encoding="utf-8")


def rounds_done(home, age=1100):
    """The Dottore's T30 and the day's Mantenitore round, started 20 minutes ago, done (their first turn seen) `age` s ago."""
    assert ds.claim() == "T30"
    ds.mark("T30")
    ds.mark("MAINT")
    path = home / "logs" / "doctor-schedule-state.json"
    state = json.loads(path.read_text(encoding="utf-8"))
    for done in state["last_done"].values():
        done["at"] = int(time.time() - age)
    path.write_text(json.dumps(state), encoding="utf-8")
    record(home, "dottore", 1200)
    record(home, "mantenitore", 1200)
    assert ds.claim() == "WAIT" and ds.check_maintainer() == "WAIT"


def test_a_done_round_whose_session_the_recreation_took_is_opened_again_once(home):
    rounds_done(home)
    switch(home, 300)                                # the switch recreated the container five minutes ago
    lines = ds.settle()
    assert sorted(lines) == ["REOPEN MAINT recreated", "REOPEN T30 recreated"]
    assert ds.claim() == "T30", "the Dottore starts again"
    assert ds.check_maintainer() == "MAINT", "the Mantenitore starts again"
    assert ds.settle() == [], "once per recreation"


def test_a_session_still_alive_or_started_after_the_recreation_is_left_alone(home):
    rounds_done(home)
    switch(home, 300)
    ALIVE["DOTTORE"] = True                          # survived (no recreation of its session)
    record(home, "mantenitore", 60)                  # started again after the switch
    assert ds.settle() == []
    assert ds.claim() == "WAIT" and ds.check_maintainer() == "WAIT"


@pytest.mark.parametrize("body", [None, "{broken", json.dumps({"schema": 2, "at": "2026-11-26T15:22:00Z"}),
                                  json.dumps({"schema": 1, "at": "not a time"})])
def test_no_recreation_no_reopen(home, body):
    rounds_done(home)
    if body is not None:
        (home / "state" / "tools-switch.json").write_text(body, encoding="utf-8")
    assert ds.settle() == []
    assert ds.claim() == "WAIT"


def test_a_round_done_after_the_recreation_or_an_old_recreation_is_not_opened(home):
    switch(home, 600)
    rounds_done(home, age=60)                        # done AFTER the switch: nothing took it away
    assert ds.settle() == []
    switch(home, 7 * 3600)                           # a recreation of hours ago is not this one
    assert ds.settle() == []
    switch(home, -3600)                              # a time in the future is no recreation
    assert ds.settle() == []


def test_the_watchdog_says_the_reopened_round():
    text = (ROOT / ".launcher" / "doctor-watchdog.sh").read_text(encoding="utf-8")
    assert "REOPEN)" in text and "round opened again" in text

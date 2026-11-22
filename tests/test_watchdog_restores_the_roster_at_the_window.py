"""The workers come back when the working window opens (`jht up` at night, nobody at 08:00).

Two layers: the watchdog's function (throttled, asks `plan`, starts only when the plan has something, with the long look-back and
the system's spawn source) with a made-up tool; and the real plan of roster_restore.py with real working hours and brakes."""
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "shared" / "skills"))
import roster_restore as rr  # noqa: E402

LAUNCHER = REPO / ".launcher" / "agent-watchdog.sh"


def _prelude():
    src = LAUNCHER.read_text()
    return src[: src.index('log "watchdog start')]


def _fake_tool(tmp_path, plan_start):
    tool = tmp_path / "roster_restore.py"
    calls = tmp_path / "calls.txt"
    tool.write_text(
        "import json, os, sys\n"
        "open(%r, 'a').write(' '.join(sys.argv[1:]) + ' win=' + os.environ.get('JHT_ROSTER_RESTORE_WINDOW_H', '') + ' src=' + os.environ.get('JHT_SPAWN_SRC', '') + '\\n')\n"
        "if sys.argv[1] == 'plan':\n    print(json.dumps({'start': %r, 'why_not': ''}))\n" % (str(calls), plan_start))
    return tool, calls


def _run(tmp_path, tool, home, times=1):
    script = _prelude() + "\nfor i in $(seq 1 %d); do maybe_restore_roster; done\n" % times
    stub = tmp_path / "bin"
    stub.mkdir(exist_ok=True)
    (stub / "timeout").write_text('#!/bin/sh\nshift\nexec "$@"\n')  # the container has timeout; a Mac does not
    (stub / "timeout").chmod(0o755)
    env = dict(os.environ, JHT_HOME=str(home), JHT_ROSTER_RESTORE_TOOL=str(tool), PATH="%s:%s" % (stub, os.environ["PATH"]))
    path = tmp_path / "run.sh"
    path.write_text(script)  # a file, not -c: the watchdog reads its own path (BASH_SOURCE)
    return subprocess.run(["bash", str(path)], text=True, capture_output=True, env=env, timeout=60)


def test_a_plan_with_workers_starts_them_with_the_long_look_back_and_the_system_source(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    tool, calls = _fake_tool(tmp_path, [["scout", 1]])
    done = _run(tmp_path, tool, home)
    assert done.returncode == 0, done.stderr + done.stdout
    lines = calls.read_text().splitlines()
    assert lines[0].startswith("plan") and lines[1].startswith("start --detach")
    assert all("win=72" in line for line in lines) and "src=agent-watchdog" in lines[1]


def test_an_empty_plan_starts_nothing_and_the_look_is_throttled(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    tool, calls = _fake_tool(tmp_path, [])
    _run(tmp_path, tool, home, times=3)
    assert calls.read_text().splitlines() == ["plan win=72 src="], "one look, no start, and the next two ticks wait"


# the real plan, with real brakes and a real working window
def _world(monkeypatch, tmp_path, inside):
    home = tmp_path / "jht"
    (home / "logs").mkdir(parents=True)
    now = datetime.now(timezone.utc)
    start, end = ((now - timedelta(hours=2)).hour, (now + timedelta(hours=2)).hour) if inside else ((now + timedelta(hours=3)).hour, (now + timedelta(hours=5)).hour)
    (home / "jht.config.json").write_text(json.dumps({"team": {"working_hours": {"timezone": "UTC", "windows": [
        {"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "start": "%02d:00" % start, "end": "%02d:00" % end}]}}}))
    monkeypatch.setenv("JHT_HOME", str(home))
    entry = {"session": "SCOUT-6", "role": "scout", "instance": 6, "status": "active"}
    roster = type("R", (), {"live_sessions": staticmethod(lambda: set()), "missing": staticmethod(lambda live=None, include_stopped=False: [entry]),
                            "last_activity": staticmethod(lambda s, h=None: now - timedelta(hours=10))})
    registry = type("P", (), {"_host_agent_cap": staticmethod(lambda: None)})
    rr._MODULES.clear()
    queue = rr._load("queue_demand")
    monkeypatch.setattr(queue, "_home", lambda: home)
    monkeypatch.setattr(queue, "held_back", lambda s: False)
    monkeypatch.setitem(rr._MODULES, "team_roster", roster)
    monkeypatch.setitem(rr._MODULES, "plan_registry", registry)
    monkeypatch.setattr(rr, "phase", lambda: "steady")
    monkeypatch.setattr(rr, "WINDOW_H", 72.0)
    return home


def test_up_with_the_window_closed_brings_nothing_then_the_window_opens_and_the_worker_comes_back(monkeypatch, tmp_path):
    home = _world(monkeypatch, tmp_path, inside=False)
    out = rr.plan()
    assert out["start"] == [] and "off-hours" in out["why_not"]
    # 08:00: the window opens (the same machine, the same roster, the last sign 10 hours old)
    now = datetime.now(timezone.utc)
    (home / "jht.config.json").write_text(json.dumps({"team": {"working_hours": {"timezone": "UTC", "windows": [
        {"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "start": "%02d:00" % (now - timedelta(hours=1)).hour,
         "end": "%02d:00" % (now + timedelta(hours=1)).hour}]}}}))
    assert rr.plan()["start"] == [["scout", 6]], "the look-back of the watchdog (72 h) covers the night"


def test_a_closed_brake_inside_the_window_starts_nothing(monkeypatch, tmp_path):
    home = _world(monkeypatch, tmp_path, inside=True)
    assert rr.plan()["start"] == [["scout", 6]]
    (home / "logs" / "daily-halt.flag").write_text("{}")
    assert rr.plan()["start"] == [] and "daily-halt" in rr.plan()["why_not"]
    (home / "logs" / "daily-halt.flag").unlink()
    (home / ".team-halted.flag").write_text("")
    assert rr.plan()["start"] == [] and "team-halted" in rr.plan()["why_not"], "the halt of the team holds it too"


def test_with_the_short_default_look_back_the_night_would_not_be_covered(monkeypatch, tmp_path):
    _world(monkeypatch, tmp_path, inside=True)
    monkeypatch.setattr(rr, "WINDOW_H", 6.0)
    assert rr.plan()["start"] == [], "this is why the watchdog passes 72 h"

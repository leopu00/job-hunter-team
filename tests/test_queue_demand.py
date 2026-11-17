"""A queue of positions that nobody works: the system starts the one worker that is missing (banco 17/11).

In `steady` nothing brought an Analista or a Scorer back unless it had been working: four positions stayed `new` while the
two Scouts that found them waited for a session that never existed. `queue_demand.py` names ONE worker once a queue has waited,
and never against a brake; the watchdog starts it.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

from test_doctor_unblock_ttl import home, run_watchdog, tmux_factory  # noqa: F401  (the shell harness of the watchdog)

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import queue_demand as qd  # noqa: E402

T0 = 1_800_000_000.0


@pytest.fixture
def world(tmp_path, monkeypatch):
    """A steady team: two Scouts alive, four positions `new`, nothing else alive, no brake."""
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(qd, "_MODULES", {})
    state = {"phase": "steady", "sessions": ["CAPITANO", "SCOUT-1", "SCOUT-4"], "queues": {"analista": 4, "scorer": 0},
             "brake": None, "held": False}
    monkeypatch.setattr(qd, "phase", lambda: state["phase"])
    monkeypatch.setattr(qd, "live_sessions", lambda: state["sessions"])
    monkeypatch.setattr(qd, "queue_count", lambda role: state["queues"].get(role))
    monkeypatch.setattr(qd, "brake", lambda now, live: state["brake"])
    monkeypatch.setattr(qd, "held_back", lambda session: state["held"])
    return state


def test_a_queue_that_waited_gets_its_worker_once_the_captain_had_his_time(world):
    first = qd.decide(T0)
    assert first["start"] is None and first["why"] == "waiting" and first["waiting"]["analista"]["count"] == 4
    assert qd.decide(T0 + qd.WAIT_S - 1)["start"] is None, "the Capitano still has his time"
    done = qd.decide(T0 + qd.WAIT_S)
    assert done["start"] == ["analista", 1, "ANALISTA-1"] and done["why"] == "start"


def test_a_session_of_the_role_that_is_alive_means_nobody_is_missing(world):
    world["sessions"] = ["CAPITANO", "SCOUT-1", "ANALISTA-2"]
    qd.decide(T0)
    assert qd.decide(T0 + 2 * qd.WAIT_S)["start"] is None
    assert "analista" not in json.loads(qd._state_path().read_text())["waiting_since"]


def test_an_empty_queue_starts_nobody_and_forgets_the_wait(world):
    qd.decide(T0)
    world["queues"]["analista"] = 0
    assert qd.decide(T0 + qd.WAIT_S)["why"] == "nothing-waits"
    world["queues"]["analista"] = 2
    assert qd.decide(T0 + qd.WAIT_S + 60)["start"] is None, "the wait starts again from the new pile"


def test_the_scorer_is_started_for_its_own_queue_when_the_analyst_queue_is_empty(world):
    world["queues"] = {"analista": 0, "scorer": 3}
    qd.decide(T0)
    assert qd.decide(T0 + qd.WAIT_S)["start"] == ["scorer", 1, "SCORER-1"]


@pytest.mark.parametrize("phase", ["burst", "awaiting_profile", None])
def test_only_steady_is_served_the_burst_has_its_own_roster(world, phase):
    world["phase"] = phase
    qd.decide(T0)
    assert qd.decide(T0 + 10 * qd.WAIT_S)["start"] is None


@pytest.mark.parametrize("why", ["team-standby", "team-halted", "daily-halt", "weekly-halt", "off-hours", "capacity"])
def test_never_against_a_brake_and_a_refused_start_is_not_claimed(world, why):
    world["brake"] = why
    qd.decide(T0)
    done = qd.decide(T0 + qd.WAIT_S)
    assert done["start"] is None and done["why"] == why
    state = json.loads(qd._state_path().read_text())
    assert state["starts"] == [] and state["last"] == {}, "the claim is written only for a start that goes out"
    world["brake"] = None
    assert qd.decide(T0 + qd.WAIT_S + 60)["start"] == ["analista", 1, "ANALISTA-1"], "the brake lifted: it goes"


def test_an_agent_the_person_paused_or_the_team_contained_is_not_started(world):
    world["held"] = True
    qd.decide(T0)
    assert qd.decide(T0 + qd.WAIT_S)["why"] == "held-back"


def test_one_start_per_cooldown_and_a_daily_cap(world):
    qd.decide(T0)
    assert qd.decide(T0 + qd.WAIT_S)["start"] is not None
    # the worker died at once: the queue still waits and nothing is alive
    again = qd.decide(T0 + qd.WAIT_S + 60)
    assert again["start"] is None and again["why"] == "cooldown"
    when = T0 + qd.WAIT_S
    started = 1
    for _ in range(10):
        when += qd.COOLDOWN_S
        if qd.decide(when)["start"] is not None:
            started += 1
    assert started == qd.DAILY_CAP, "never more than the daily cap, even with a team that cannot keep a worker"


def test_a_tmux_that_cannot_be_read_starts_nobody(world, monkeypatch):
    monkeypatch.setattr(qd, "live_sessions", lambda: None)
    assert qd.decide(T0)["why"] == "no-tmux-reading"


def test_the_brakes_read_from_the_home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(qd, "_MODULES", {"standby": None, "working_hours": None, "plan_registry": None})
    assert qd.brake(T0, 2) is None
    (tmp_path / "logs").mkdir()
    (tmp_path / "logs" / "daily-halt.flag").write_text("{}")
    assert qd.brake(T0, 2) == "daily-halt"
    (tmp_path / "logs" / "daily-halt.flag").unlink()
    (tmp_path / ".team-halted.flag").write_text("")
    assert qd.brake(T0, 2) == "team-halted"


def test_the_capacity_of_the_machine_and_the_hours_are_brakes(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    registry = type("R", (), {"_host_agent_cap": staticmethod(lambda: 3)})
    hours = type("H", (), {"is_within_working_hours": staticmethod(lambda now=None: True)})
    monkeypatch.setattr(qd, "_MODULES", {"standby": None, "working_hours": hours, "plan_registry": registry})
    assert qd.brake(T0, 2) is None and qd.brake(T0, 3) == "capacity"
    hours.is_within_working_hours = staticmethod(lambda now=None: False)
    assert qd.brake(T0, 0) == "off-hours"


def test_the_command_prints_the_worker_and_status_changes_nothing(world, capfd, tmp_path):
    world["queues"]["analista"] = 1
    qd.decide(time.time() - qd.WAIT_S - 5)          # the wait began a while ago
    before = qd._state_path().read_text()
    assert qd.main(["queue_demand.py", "status"]) == 0
    assert qd._state_path().read_text() == before and json.loads(capfd.readouterr().out)["start"] is not None
    assert qd.main(["queue_demand.py", "next"]) == 0
    assert capfd.readouterr().out.split() == ["analista", "1", "ANALISTA-1"]
    assert qd.main(["queue_demand.py", "bogus"]) == 2


def test_the_command_runs_from_a_shell_and_says_nothing_with_nothing_to_do(tmp_path):
    res = subprocess.run([sys.executable, str(SKILLS / "queue_demand.py"), "next"], capture_output=True, text=True,
                         env={"JHT_HOME": str(tmp_path), "PATH": "/usr/bin:/bin", "PYTHONDONTWRITEBYTECODE": "1"}, timeout=60)
    assert res.returncode == 0 and res.stdout == ""


# ── the watchdog: it runs what the tool says, and only that ─────────────────────────────────────────────────

def _fake_start(tmux, marker):
    script = tmux.bin / "start-agent.sh"
    script.write_text(
        "#!/bin/sh\n"
        f"echo \"$@\" > {str(marker)!r}\n"
        f"python3 - {str(tmux.state_file)!r} <<'PY'\n"
        "import json, sys\nfrom pathlib import Path\n"
        "p = Path(sys.argv[1]); s = json.loads(p.read_text())\n"
        "s['sessions']['ANALISTA-1'] = {'created': 1, 'cmd': 'claude'}\n"
        "p.write_text(json.dumps(s))\nPY\n")
    script.chmod(0o755)
    return script


def test_the_watchdog_starts_the_worker_the_tool_names(tmux_factory, home):  # noqa: F811
    tmux = tmux_factory({"CAPITANO": {"created": 1}})
    marker = home / "started.txt"
    tool = tmux.bin / "queue_demand.py"
    tool.write_text("print('analista 1 ANALISTA-1')\n")
    tool.chmod(0o755)
    res = run_watchdog("maybe_start_queued_roles", tmux, home, JHT_START_AGENT=_fake_start(tmux, marker),
                       JHT_QUEUE_DEMAND_TOOL=str(tool))
    assert res.returncode == 0, res.stderr
    assert marker.read_text().split() == ["analista", "1"], res.stdout
    assert "queue demand: positions wait for analista" in res.stdout
    assert "not a recovery" in res.stdout and "ANALISTA-1" in tmux.sessions()


def test_the_watchdog_starts_nothing_when_the_tool_says_nothing(tmux_factory, home):  # noqa: F811
    tmux = tmux_factory({"CAPITANO": {"created": 1}})
    marker = home / "started.txt"
    tool = tmux.bin / "queue_demand.py"
    tool.write_text("pass\n")
    tool.chmod(0o755)
    res = run_watchdog("maybe_start_queued_roles", tmux, home, JHT_START_AGENT=_fake_start(tmux, marker),
                       JHT_QUEUE_DEMAND_TOOL=str(tool))
    assert res.returncode == 0 and not marker.exists()


def test_the_tick_calls_it_after_the_respawn_of_the_workers():
    src = (Path(__file__).resolve().parents[1] / ".launcher" / "agent-watchdog.sh").read_text()
    assert src.index("    maybe_start_queued_roles\n") > src.index("    maybe_respawn_workers\n")

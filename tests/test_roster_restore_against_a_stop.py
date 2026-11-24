"""A stop of the person that comes while the restore is starting the workers wins (collaudo Linux 23/11).

The watchdog's restore read the brakes once, in its plan, then started Scout, Analista and Scorer one after the other, seconds each.
`jht team stop --all` came in the middle: it wrote `.team-halted.flag`, closed the sessions it saw, and the restore went on starting
the rest. Those workers missed the stop, kept running through `jht profile import --replace` and `jht team start`, and searched and
scored on the profile of before. Now the brakes are read again before each worker, and a worker whose start ends after the flag
appeared is closed at once and marked stopped: after the stop, nobody is left running, and the next start opens a new session.
"""
import os
import sys
import time
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import roster_restore as rr  # noqa: E402
import team_roster as tr  # noqa: E402

FIXED = {"CAPITANO", "SENTINELLA", "ASSISTENTE", "MENTOR"}
WORKERS = [("scout", 6), ("analista", 1), ("scorer", 2)]


class Cap:
    @staticmethod
    def room(live):
        return 11 - len(live)


@pytest.fixture
def team(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.delenv("JHT_SPAWN_SRC", raising=False)
    for role, n in WORKERS:
        tr.record(role, n, spawn_source="cli-team-start")
    monkeypatch.setattr(tr, "live_sessions", lambda: set(FIXED))
    monkeypatch.setattr(tr, "_tools_missing", lambda: ())
    halted = home / ".team-halted.flag"
    # the brake of queue_demand for the flag of the stop (the other brakes are not what this test is about)
    queue = type("Q", (), {"brake": staticmethod(lambda t, n: "team-halted" if halted.exists() else None),
                           "held_back": staticmethod(lambda s: False)})
    burst = rr._load("burst_roster")
    monkeypatch.setattr(rr, "_MODULES", {"team_roster": tr, "queue_demand": queue, "session_cap": Cap,
                                         "burst_roster": burst, "pi_spend_cap": None})
    monkeypatch.setattr(rr, "phase", lambda: "steady")
    monkeypatch.setattr(burst, "_log", lambda row: None)
    # tmux of the test: it writes what it was asked
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    calls = tmp_path / "tmux-calls"
    (bin_dir / "tmux").write_text(f"#!/bin/sh\necho \"$*\" >> '{calls}'\n", encoding="utf-8")
    (bin_dir / "tmux").chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}{os.pathsep}{os.environ['PATH']}")
    started = tmp_path / "started"
    return {"home": home, "halted": halted, "calls": calls, "started": started, "tmp": tmp_path, "burst": burst}


def _launcher(team, monkeypatch, stop_during: str | None):
    """start-agent.sh of the test: it records the worker, and the person's stop comes while `stop_during` is starting."""
    script = team["tmp"] / "start-agent.sh"
    stop = (f"[ \"$1-$2\" = '{stop_during}' ] && : > '{team['halted']}'\n") if stop_during else ""
    script.write_text(f"#!/bin/sh\necho \"$1-$2\" >> '{team['started']}'\n{stop}exit 0\n", encoding="utf-8")
    script.chmod(0o755)
    monkeypatch.setattr(team["burst"], "_launcher", lambda: str(script))


def _lines(path: Path):
    return path.read_text(encoding="utf-8").split() if path.exists() else []


def _tmux(team):
    return team["calls"].read_text(encoding="utf-8").splitlines() if team["calls"].exists() else []


def test_without_a_stop_every_worker_starts_and_none_is_closed(team, monkeypatch):
    _launcher(team, monkeypatch, None)
    out = rr.start()
    assert sorted(_lines(team["started"])) == ["analista-1", "scorer-2", "scout-6"], out
    assert _tmux(team) == []


def test_a_stop_during_the_first_start_closes_that_worker_and_starts_no_other(team, monkeypatch):
    role, number = rr.plan()["start"][0]
    first = f"{role}-{number}"
    _launcher(team, monkeypatch, first)
    out = rr.start()
    assert _lines(team["started"]) == [first], f"after the stop nobody else starts: {out}"
    assert _tmux(team) == [f"kill-session -t ={first.upper()}"], "the worker started across the stop is closed"
    entry = tr.load()["agents"][first.upper()]
    assert (entry["status"], entry["stop_by"]) == ("stopped", "user"), "the roster says the truth: stopped by the person, as the stop writes"
    assert [row.get("why") for row in out["started"] if not row["ok"]] == ["brake: team-halted"]


def test_a_stop_during_a_later_start_closes_only_the_one_starting_and_the_rest_never_starts(team, monkeypatch):
    order = ["%s-%d" % (role, n) for role, n in rr.plan()["start"]]
    assert len(order) == 3
    _launcher(team, monkeypatch, order[1])
    out = rr.start()
    assert _lines(team["started"]) == order[:2], out
    # the first one ended before the flag: `jht team stop` lists and closes it itself; the second one is the restore's to close
    assert _tmux(team) == [f"kill-session -t ={order[1].upper()}"]
    assert tr.load()["agents"][order[1].upper()]["stop_by"] == "user"
    assert order[2] not in _lines(team["started"])
    assert not rr._tries(time.time()).get(order[2].upper()), "a worker held by the stop does not spend a try"


# ── renew: `jht profile import --replace` with the team running ─────────────────────────────────────────────────────────────

def test_renew_closes_every_worker_of_the_old_profile_and_starts_the_scouts_analisti_and_scorers_again(team, monkeypatch):
    _launcher(team, monkeypatch, None)
    alive = sorted(FIXED | {"SCOUT-6", "ANALISTA-1", "SCORER-2", "SCRITTORE-1", "CRITICO-S1", "CRITICO", "CLOSER-1"})
    assert rr.renew_targets(alive) == ["ANALISTA-1", "CLOSER-1", "CRITICO", "CRITICO-S1", "SCORER-2", "SCOUT-6", "SCRITTORE-1"]
    out = rr.renew(alive)
    assert sorted(_tmux(team)) == sorted(f"kill-session -t ={s}" for s in rr.renew_targets(alive)), "the Capitano and the Assistente go on"
    assert sorted(_lines(team["started"])) == ["analista-1", "scorer-2", "scout-6"], out
    assert all(row["ok"] for row in out["started"])


def test_renew_with_no_worker_running_does_nothing(team, monkeypatch):
    _launcher(team, monkeypatch, None)
    assert rr.renew(sorted(FIXED)) == {"closed": [], "started": [], "note": "no worker is running"}
    assert _tmux(team) == [] and _lines(team["started"]) == []


def test_a_stop_during_the_renew_wins_too(team, monkeypatch):
    _launcher(team, monkeypatch, "analista-1")
    out = rr.renew(["SCOUT-6", "ANALISTA-1", "SCORER-2", "CAPITANO"])
    assert _lines(team["started"]) == ["analista-1"], out
    assert _tmux(team)[-1] == "kill-session -t =ANALISTA-1", "the one started across the stop is closed again"
    assert out["started"][-1]["why"] == "brake: team-halted"

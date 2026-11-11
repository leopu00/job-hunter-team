"""burst_roster.py: the system starts the roster of the first run in one go, in the order of the skill, and each worker is briefed by
start-agent.sh (JHT_WORKER_BRIEF) — the Capitano no longer spends a model turn and a `sleep 12` per worker. Fake data, fake tmux,
fake launcher: nothing is started."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "shared" / "skills" / "burst_roster.py"
BOOT = ROOT / "shared" / "skills" / "captain_boot.py"
START_AGENT = ROOT / ".launcher" / "start-agent.sh"
LANGS = ("", ".it", ".de", ".es", ".fr", ".hu", ".pt")
ROSTER = {"scout": 5, "analista": 3, "scorer": 2}
FULL_ORDER = ["scout", "scout", "analista", "scorer", "scout", "scout", "scout", "analista", "analista", "scorer"]


def _module():
    spec = importlib.util.spec_from_file_location("burst_roster_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _world(tmp_path: Path, *, sessions: list[str] | None = None, phase: str = "burst") -> dict:
    """A home with a state file, a tmux that lists the sessions in a file, a launcher that records its calls and
    creates the session."""
    home, bindir = tmp_path / "jht", tmp_path / "bin"
    (home / "state").mkdir(parents=True)
    bindir.mkdir()
    (home / "jht.config.json").write_text(json.dumps({"active_provider": "codex", "providers": {"openai": {"plan": "pro"}}}), encoding="utf-8")
    state = {"phase": phase, "created_at": "2026-11-11T07:00:00+00:00", "burst_started_at": "2026-11-11T07:00:00+00:00",
             "completed_at": None, "completed_reason": None, "scored_at_start": 0, "roster": ROSTER, "scout_cap_first_pass": 50}
    (home / "state" / "first-run.json").write_text(json.dumps(state), encoding="utf-8")
    listing = tmp_path / "sessions.txt"
    listing.write_text("".join(f"{name}\n" for name in (sessions or [])), encoding="utf-8")
    tmux = bindir / "tmux"
    tmux.write_text(f"#!/bin/sh\ncat '{listing}'\n", encoding="utf-8")
    tmux.chmod(0o755)
    calls = tmp_path / "calls.jsonl"
    launcher = tmp_path / "start-agent.sh"
    launcher.write_text(
        "#!/bin/bash\n"
        f"printf '{{\"role\":\"%s\",\"n\":\"%s\",\"brief\":\"%s\"}}\\n' \"$1\" \"$2\" \"$JHT_WORKER_BRIEF\" >> '{calls}'\n"
        f"echo \"$(echo $1 | tr a-z A-Z)-$2\" >> '{listing}'\n", encoding="utf-8")
    env = {"PATH": f"{bindir}:/bin:/usr/bin", "JHT_HOME": str(home), "JHT_START_AGENT": str(launcher),
           "JHT_HOST_ENV_FILE": "/nonexistent/jht-host.env", "PYTHONDONTWRITEBYTECODE": "1"}
    return {"home": home, "env": env, "calls": calls, "listing": listing}


def _run(world: dict, *args: str) -> dict:
    done = subprocess.run([sys.executable, "-I", str(SCRIPT), *args], capture_output=True, text=True, timeout=90,
                          env=world["env"], check=False)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


def _calls(world: dict) -> list[dict]:
    path = world["calls"]
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def test_the_order_is_the_one_of_the_skill():
    module = _module()
    assert module.order(ROSTER) == FULL_ORDER
    assert module.order({"scout": 5, "analista": 0, "scorer": 0}) == ["scout"] * 5
    assert module.order({"scout": 0, "analista": 1, "scorer": 1}) == ["analista", "scorer"]
    assert module.order({"scout": 7, "analista": 4, "scorer": 3}) == FULL_ORDER + ["analista", "scorer", "scout", "scout"]
    assert module.order({}) == []


def test_a_burst_with_nothing_alive_starts_the_whole_roster_in_order(tmp_path: Path):
    world = _world(tmp_path)
    out = _run(world, "start", "--auto")
    calls = _calls(world)
    assert [c["role"] for c in calls] == FULL_ORDER
    assert all(row["ok"] for row in out["started"])
    for role in ("scout", "analista", "scorer"):
        numbers = [c["n"] for c in calls if c["role"] == role]
        assert len(numbers) == len(set(numbers)) == ROSTER[role]  # the numbers are rolled free, never twice


def test_the_brief_of_a_scout_names_its_number_its_first_command_and_the_cap(tmp_path: Path):
    world = _world(tmp_path)
    _run(world, "start", "--auto")
    scouts = [c for c in _calls(world) if c["role"] == "scout"]
    for scout in scouts:
        brief = scout["brief"]
        assert brief.startswith(f"[@capitano -> @scout-{scout['n']}] [MSG]")
        assert f"scout_coord.py auto scout-{scout['n']}" in brief and "at most 50 positions" in brief
    analyst = next(c for c in _calls(world) if c["role"] == "analista")["brief"]
    scorer = next(c for c in _calls(world) if c["role"] == "scorer")["brief"]
    assert "next-for-analista" in analyst and "next-for-scorer" in scorer


def test_automatic_start_leaves_a_burst_alone_when_a_worker_is_alive(tmp_path: Path):
    world = _world(tmp_path, sessions=["CAPITANO", "SCOUT-3"])
    out = _run(world, "start", "--auto")
    assert out["started"] == [] and "already up" in out["note"] and _calls(world) == []


def test_the_capitano_start_completes_only_what_is_missing(tmp_path: Path):
    world = _world(tmp_path, sessions=["SCOUT-1", "SCOUT-2", "SCOUT-4", "ANALISTA-2"])
    _run(world, "start")
    roles = [c["role"] for c in _calls(world)]
    assert roles == ["scout", "scout", "analista", "scorer", "analista", "scorer"]  # the missing ones, still in the order of the skill
    started_scouts = {c["n"] for c in _calls(world) if c["role"] == "scout"}
    assert not started_scouts & {"1", "2", "4"}  # never over a session that is up


def test_a_second_run_right_after_the_first_does_nothing_unless_forced(tmp_path: Path):
    world = _world(tmp_path)
    _run(world, "start", "--auto")
    assert len(_calls(world)) == 10
    world["listing"].write_text("", encoding="utf-8")  # every session gone again, seconds later
    again = _run(world, "start", "--auto")
    assert again["started"] == [] and "less than" in again["note"] and len(_calls(world)) == 10
    _run(world, "start", "--auto", "--force")
    assert len(_calls(world)) == 20


@pytest.mark.parametrize("phase", ["steady", "awaiting_profile"])
def test_outside_a_burst_nothing_is_started(tmp_path: Path, phase: str):
    world = _world(tmp_path, phase=phase)
    out = _run(world, "start", "--auto")
    assert out["started"] == [] and "not in a burst" in out["note"] and _calls(world) == []


def test_when_tmux_cannot_be_asked_nothing_is_assumed(tmp_path: Path):
    world = _world(tmp_path)
    (tmp_path / "bin" / "tmux").unlink()
    world["env"]["PATH"] = str(tmp_path / "nobin")
    out = subprocess.run([sys.executable, "-I", str(SCRIPT), "start", "--auto"], capture_output=True, text=True, timeout=60,
                         env=dict(world["env"], PATH=str(tmp_path / "nobin")), check=False)
    assert out.returncode == 0 and json.loads(out.stdout)["started"] == [] and _calls(world) == []


def test_a_failing_launcher_is_reported_and_does_not_stop_the_others(tmp_path: Path):
    world = _world(tmp_path)
    launcher = Path(world["env"]["JHT_START_AGENT"])
    launcher.write_text("#!/bin/bash\n[ \"$1\" = analista ] && { echo boom >&2; exit 7; }\n" + launcher.read_text().split("\n", 1)[1],
                        encoding="utf-8")
    out = _run(world, "start", "--auto")
    assert [row["ok"] for row in out["started"]].count(False) == 3
    assert all(row["rc"] == 7 and "boom" in row["tail"] for row in out["started"] if not row["ok"])
    assert len([c for c in _calls(world) if c["role"] == "scout"]) == 5


def test_the_launcher_sends_the_brief_of_a_numbered_worker_and_only_of_those():
    text = START_AGENT.read_text(encoding="utf-8")
    block = text[text.index("JHT_WORKER_BRIEF") - 600:]
    assert "scout|analista|scorer)" in block
    assert '_kickoff "$SESSION" "$JHT_WORKER_BRIEF"' in block
    # the brief is sent after the sentinella branch and before the receipt is written, like every other kick-off
    assert text.index('_kickoff "$SESSION" "$_msg"') < text.index('_kickoff "$SESSION" "$JHT_WORKER_BRIEF"') < text.index('_spawn_stage="complete"\n', text.index("JHT_WORKER_BRIEF"))


def test_the_start_of_the_capitano_starts_the_roster_in_the_background_and_says_so(tmp_path: Path):
    world = _world(tmp_path, phase="awaiting_profile")
    (world["home"] / "profile").mkdir()
    (world["home"] / "profile" / "ready.flag").write_text("x", encoding="utf-8")
    done = subprocess.run([sys.executable, "-I", str(BOOT)], capture_output=True, text=True, timeout=120, env=world["env"], check=False)
    assert done.returncode == 0
    assert "opened now by the system" in done.stdout and "THE SYSTEM IS STARTING THE ROSTER NOW" in done.stdout
    roster = json.loads((world["home"] / "state" / "first-run.json").read_text(encoding="utf-8"))["roster"]  # sized by the plan
    expected = _module().order(roster)
    assert expected and expected[0] == "scout"
    deadline = time.time() + 60
    while time.time() < deadline and len(_calls(world)) < len(expected):
        time.sleep(0.5)
    assert [c["role"] for c in _calls(world)] == expected


def test_the_boot_block_does_not_promise_a_start_that_will_not_happen(tmp_path: Path):
    world = _world(tmp_path, sessions=["CAPITANO", "SCOUT-3"])  # a Capitano restarted in an open burst with a worker up
    done = subprocess.run([sys.executable, "-I", str(BOOT)], capture_output=True, text=True, timeout=120, env=world["env"], check=False)
    assert done.returncode == 0 and "first run: phase burst" in done.stdout
    assert "STARTING THE ROSTER" not in done.stdout
    time.sleep(1)
    assert _calls(world) == []


def test_the_plan_names_what_would_start_and_starts_nothing(tmp_path: Path):
    world = _world(tmp_path)
    out = _run(world, "plan", "--auto")
    assert out["start"] == FULL_ORDER and _calls(world) == []
    world["listing"].write_text("SCOUT-2\n", encoding="utf-8")
    assert _run(world, "plan", "--auto")["start"] == []


def test_a_run_that_holds_the_lock_keeps_a_second_one_from_rolling_numbers(tmp_path: Path):
    import fcntl
    world = _world(tmp_path)
    lock = world["home"] / "state" / "burst-roster.lock"
    with lock.open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        out = _run(world, "start", "--auto")
    assert out["started"] == [] and "another run" in out["note"] and _calls(world) == []
    assert len(_run(world, "start", "--auto")["started"]) == 10  # the lock is free again: it starts


def test_two_runs_at_the_same_time_start_the_roster_once(tmp_path: Path):
    world = _world(tmp_path)
    launcher = Path(world["env"]["JHT_START_AGENT"])
    launcher.write_text(launcher.read_text().replace("#!/bin/bash\n", "#!/bin/bash\nsleep 0.3\n", 1), encoding="utf-8")
    argv = [sys.executable, "-I", str(SCRIPT), "start", "--auto"]
    procs = [subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=world["env"]) for _ in range(2)]
    outs = [json.loads(p.communicate(timeout=90)[0]) for p in procs]
    assert sorted(len(o["started"]) for o in outs) == [0, 10]
    assert len(_calls(world)) == 10


@pytest.mark.parametrize("suffix", LANGS)
def test_every_language_of_the_skill_tells_the_capitano_the_system_starts_the_roster(suffix: str):
    text = (ROOT / "agents" / "_skills" / "first-run-burst" / f"SKILL{suffix}.md").read_text(encoding="utf-8")
    start, end = text.index("\n**2. "), text.index("\n**3. ")
    step = text[start:end]
    for key in ("burst_roster.py start --auto --detach", "THE SYSTEM IS STARTING THE ROSTER NOW", "roll_worker_number.py",
                "roster_missing", "burst_roster.py start`"):
        assert key in step, (suffix, key)

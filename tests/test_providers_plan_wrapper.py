"""`jht providers plan` only reads: it never starts the team's container, the machine or the engine.

A reading that turns a stopped container on is not a reading: the person asked what the plan is and the
Mac starts spending memory and the team starts working. Declaring a plan (`jht providers plan <id>`) is a
write the person asked for, and goes on starting the container as every command of the CLI does.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from test_desktop_chat_wrapper import _runtime


def _run(tmp_path: Path, *args: str, stopped: bool = False, engine_ready: bool = True):
    wrapper, env, log = _runtime(tmp_path)
    if engine_ready:
        env["JHT_TEST_RUNTIME_READY"] = "1"
    if stopped:
        # the container of an earlier `up`, Exited: it is only running again once `up -d` runs
        env["JHT_TEST_EXITED_STATE"] = str(tmp_path / "container-never-started")
    done = subprocess.run([str(wrapper), *args], env=env, text=True, capture_output=True, timeout=20, check=False)
    return done, log.read_text(encoding="utf-8").splitlines() if log.exists() else []


def _real_up(calls: list[str]) -> list[str]:
    # `--dry-run` is how the wrapper asks compose for the hash it expects: it creates nothing
    return [line for line in calls if line.startswith("podman-compose ") and line.endswith(" up -d") and "--dry-run" not in line]


def _starts_something(calls: list[str]) -> list[str]:
    return _real_up(calls) + [
        line for line in calls if "machine start" in line or "machine init" in line or line.startswith("docker exec")
    ]


def test_reading_the_plan_does_not_start_a_stopped_container(tmp_path: Path):
    done, calls = _run(tmp_path, "providers", "plan", stopped=True)

    assert done.returncode == 1, done.stderr
    assert "non attivo" in done.stdout + done.stderr
    assert _starts_something(calls) == []


def test_reading_the_plan_wakes_no_engine_and_no_machine(tmp_path: Path):
    done, calls = _run(tmp_path, "providers", "plan", engine_ready=False)

    assert done.returncode == 1, done.stderr
    assert "non attivo" in done.stdout + done.stderr
    assert _starts_something(calls) == []


def test_reading_the_plan_of_a_running_container_asks_its_cli(tmp_path: Path):
    done, calls = _run(tmp_path, "providers", "plan")

    assert done.returncode == 0, done.stderr
    (call,) = [line for line in calls if line.startswith("docker exec")]
    assert call.endswith("providers plan")
    assert _real_up(calls) == []


def test_declaring_a_plan_goes_on_starting_the_container(tmp_path: Path):
    done, calls = _run(tmp_path, "providers", "plan", "plus", stopped=True)

    assert done.returncode == 0, done.stderr
    assert len(_real_up(calls)) == 1
    (call,) = [line for line in calls if line.startswith("docker exec")]
    assert call.endswith("providers plan plus")


def test_the_other_providers_commands_are_unchanged(tmp_path: Path):
    done, calls = _run(tmp_path, "providers", "list", stopped=True)

    assert done.returncode == 0, done.stderr
    assert len(_real_up(calls)) == 1
    assert any(line.startswith("docker exec") and line.endswith("providers list") for line in calls)

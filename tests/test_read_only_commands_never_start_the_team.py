"""The commands that only read the team never start a stopped container.

`jht team status` and `jht agents` went through ensure_up: a sampler looking at the team (or a person) started again a team
stopped with `jht down`. jht agents, stats, health, team list and team status now say that the team is off and start nothing,
as jht status does; with the container running they reach the CLI in it as before. A command that acts still starts it.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_cli_help_never_starts_docker import calls, make_docker_spy, run_wrapper, write_trusted_runtime  # noqa: E402

READ_ONLY = [["agents"], ["agents", "--json"], ["stats"], ["health"], ["team", "list"], ["team", "status"]]
pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the POSIX wrapper")


def _started(observed: list[str]) -> bool:
    return any("compose" in call and " up" in f" {call}" for call in observed)


@pytest.mark.parametrize("args", READ_ONLY, ids=" ".join)
def test_a_read_only_command_on_a_stopped_team_starts_nothing_and_says_it_is_off(tmp_path, args):
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=False)
    done = run_wrapper(args, fake_bin, tmp_path, extra_env={**write_trusted_runtime(tmp_path), "JHT_LANG": "en", "JHT_MACHINE_OUTPUT": "0"})
    observed = calls(log)
    assert not _started(observed), observed
    assert not any(call.startswith("exec ") for call in observed), observed
    assert done.returncode == 0, done.stderr
    assert "The team's container is not running." in done.stdout and "jht up" in done.stdout, done.stdout + done.stderr


@pytest.mark.parametrize("args", READ_ONLY, ids=" ".join)
def test_a_read_only_command_on_a_running_team_reaches_the_cli(tmp_path, args):
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=True)
    done = run_wrapper(args, fake_bin, tmp_path, extra_env=write_trusted_runtime(tmp_path))
    observed = calls(log)
    assert not _started(observed), observed
    assert any(call.startswith("exec ") and call.endswith("node /app/cli/bin/jht.js " + " ".join(args)) or
               (call.startswith("exec ") and call.endswith(" ".join(args))) for call in observed), observed
    assert done.returncode == 0, done.stderr


def test_with_the_engine_off_a_read_only_command_starts_nothing(tmp_path):
    fake_bin, log = make_docker_spy(tmp_path, reachable=False, container_running=False)
    done = run_wrapper(["agents"], fake_bin, tmp_path, extra_env={**write_trusted_runtime(tmp_path), "JHT_MACHINE_OUTPUT": "0"})
    assert not _started(calls(log)), calls(log)
    assert done.returncode == 0 and "jht up" in done.stdout, done.stdout + done.stderr


def test_a_program_reading_a_stopped_team_gets_the_machine_line_and_rc_1(tmp_path):
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=False)
    done = run_wrapper(["team", "status"], fake_bin, tmp_path,
                       extra_env={**write_trusted_runtime(tmp_path), "JHT_MACHINE_OUTPUT": "1"})
    assert not _started(calls(log)), calls(log)
    assert done.returncode == 1 and "container 'jht' non attivo" in done.stdout, done.stdout + done.stderr


def test_team_start_still_starts_the_container(tmp_path):
    """The counter-proof: a command that acts on the team still starts it."""
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=False)
    run_wrapper(["team", "start"], fake_bin, tmp_path, extra_env=write_trusted_runtime(tmp_path))
    assert _started(calls(log)), calls(log)


def test_the_windows_wrapper_has_the_same_read_only_arm_before_its_default():
    source = (Path(__file__).resolve().parents[1] / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
    start = source.index("{ $_ -cin @('agents', 'stats', 'health') -or ($_ -ceq 'team'")
    arm = source[start : source.index("\n  }\n", start)]
    assert "@('list', 'status')" in arm
    assert "Ensure-Up" not in arm and "Test-ContainerUp" in arm and "status.not_running" in arm
    assert start < source.index("\n  default {")

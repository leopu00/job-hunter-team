"""`jht down` stays down: nothing but `jht up`, `jht start-container` and `jht setup` makes or starts the team again.

On the ThinkPad with Linux the team's container started again one second after a `jht down`, with no agent in it, and the installer
then found the team running (exit 84): every command forwarded to the container (doctor, positions, providers…) started it first.
`jht down` now leaves a mark in the runtime folder; while it is there a forwarded command says the team is stopped and how to start
it. `jht doctor` never starts anything: with the team off it gives the checks this computer can make.
"""

from __future__ import annotations

import json
from pathlib import Path

from test_cli_help_never_starts_docker import calls, make_docker_spy, run_wrapper, write_trusted_runtime

STOPPED_IT = "Job Hunter Team e' fermato: jht up per riaccenderlo."
STOPPED_EN = "Job Hunter Team is stopped: 'jht up' starts it again."


def _mutations(log: Path) -> list[str]:
    return [c for c in calls(log) if c.startswith("compose") and (" up" in f" {c} " or " run " in f" {c} " or " create" in c)]


def test_a_command_after_down_says_the_team_is_stopped_and_starts_nothing(tmp_path: Path):
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=False)
    env = write_trusted_runtime(tmp_path)
    (Path(env["JHT_RUNTIME_DIR"]) / "team-stopped").write_text("jht down\n", encoding="utf-8")
    result = run_wrapper(["positions", "list"], fake_bin, tmp_path, extra_env=env)
    assert result.returncode == 1
    assert STOPPED_EN in result.stderr or STOPPED_IT in result.stderr, result.stderr
    assert _mutations(log) == [], calls(log)


def test_a_link_in_place_of_the_mark_is_not_the_mark(tmp_path: Path):
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=False)
    env = write_trusted_runtime(tmp_path)
    (tmp_path / "elsewhere").write_text("x", encoding="utf-8")
    (Path(env["JHT_RUNTIME_DIR"]) / "team-stopped").symlink_to(tmp_path / "elsewhere")
    result = run_wrapper(["positions", "list"], fake_bin, tmp_path, extra_env=env)
    assert STOPPED_EN not in result.stderr and STOPPED_IT not in result.stderr


def test_doctor_with_the_team_off_starts_nothing_and_gives_the_host_checks(tmp_path: Path):
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=False)
    env = write_trusted_runtime(tmp_path)
    result = run_wrapper(["doctor"], fake_bin, tmp_path, extra_env=env)
    assert _mutations(log) == [], calls(log)
    out = result.stdout
    assert ("the team is off" in out) or ("squadra spenta" in out), out
    assert ("container engine reachable" in out) or ("motore dei container raggiungibile" in out), out
    assert "'jht up'" in out


def test_doctor_json_with_the_team_off(tmp_path: Path):
    fake_bin, log = make_docker_spy(tmp_path, reachable=False, container_running=False)
    env = write_trusted_runtime(tmp_path)
    result = run_wrapper(["doctor", "--json"], fake_bin, tmp_path, extra_env=env)
    answer = json.loads(result.stdout)
    assert answer["teamRunning"] is False and answer["ok"] is False
    assert answer["summary"]["problems"] >= 1  # the engine is not reachable
    assert {c["status"] for c in answer["checks"]} <= {"ok", "warn", "fail"}
    assert result.returncode == 1
    assert _mutations(log) == []


def test_doctor_with_the_team_running_is_the_cli_s_own(tmp_path: Path):
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=True)
    env = write_trusted_runtime(tmp_path)
    run_wrapper(["doctor"], fake_bin, tmp_path, extra_env=env)
    assert any(c.startswith("exec") and "doctor" in c for c in calls(log)), calls(log)


def test_the_wrapper_marks_on_down_and_clears_on_up_start_container_and_setup():
    text = (Path(__file__).resolve().parents[1] / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
    def branch(head: str) -> str:
        start = text.index(f"\n  {head}\n")
        return text[start:text.index("\n    ;;\n", start)]
    assert "container_down || exit 1\n    team_stopped_mark" in branch("down|stop-container)")
    for head in ("up)", "start-container)", "setup)"):
        assert "team_stopped_clear" in branch(head), head
    ensure = text[text.index("ensure_up() {"):]
    ensure = ensure[:ensure.index("\n}\n")]
    assert ensure.index("team_stopped_by_person") < ensure.index("compose_up_team")

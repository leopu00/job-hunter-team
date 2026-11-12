"""`jht down` never says «stopped» while a container of the project is still there.

Measured once in three on a Mac with Podman, ~30 s after the first start: down printed «cannot remove container … is running»,
then «Job Hunter Team stopped.» rc 0, and the team was running again (restart: unless-stopped restarts it by itself in its first
minute). A project that still has a container after the stop gets one more pass; if it still has one, that is said and down fails.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from test_podman_compose_exact_version_boundary import _wrapper_functions


def _down(tmp_path: Path, ps_answers: list[str]):
    log = tmp_path / "calls.log"
    answers = tmp_path / "answers"
    answers.write_text("\n".join(a if a else "-" for a in ps_answers) + "\n", encoding="utf-8")
    script = f"""
set -u
CONTAINER_RUNTIME=podman
CONTAINER_SERVICE=jht
COMPOSE_ALL_PROFILES=all
TMPDIR="{tmp_path}"
info() {{ echo "info: $*"; }}
err() {{ echo "error: $*" >&2; }}
jht_say() {{ printf '%s' "$1"; }}
container_up() {{ return 0; }}
compose_noise_filter() {{ cat; }}
rootless_netns_noise_filter() {{ cat; }}
compose_stdout_quiet() {{ echo "down $*" >> "{log}"; }}
compose() {{
  echo "compose $*" >> "{log}"
  [ "$1 $2" = "ps -q" ] || return 0
  line="$(head -n 1 "{answers}")"; sed -i.bak 1d "{answers}"
  [ "$line" = - ] || printf '%s\\n' "$line"
}}
{_wrapper_functions("container_down")}
container_down; echo "rc=$?"
"""
    result = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60)
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return result, calls


def test_a_stop_that_leaves_nothing_says_stopped_once(tmp_path: Path):
    result, calls = _down(tmp_path, [""])
    assert "rc=0" in result.stdout and "down.done" in result.stdout
    assert [c for c in calls if c.startswith("down")] == ["down down"]


def test_a_container_back_up_after_the_stop_gets_a_second_pass(tmp_path: Path):
    result, calls = _down(tmp_path, ["a" * 64, ""])
    assert "rc=0" in result.stdout and "down.done" in result.stdout
    assert [c for c in calls if c.startswith("down")] == ["down down", "down down"]


def test_a_container_still_there_after_two_passes_is_said_and_down_fails(tmp_path: Path):
    result, _ = _down(tmp_path, ["a" * 64, "a" * 64])
    assert "rc=1" in result.stdout
    assert "down.done" not in result.stdout
    assert "error: down.still_running" in result.stderr

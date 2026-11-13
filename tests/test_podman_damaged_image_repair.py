"""A Podman machine stopped abruptly a few seconds after a pull leaves the image half on its disk.

Measured on a Mac (packages 18 and 19): `kill -9` of the machine 3-6 s after the container was made, then every `jht up` failed with
«unable to start container … can't stat (or find?) lower layer …/overlay/diff», rc 125, and neither down + up nor the installer cured
it. `jht up` now says it in a sentence, takes the project's containers down, pulls the pinned image again and starts once more.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from test_podman_compose_exact_version_boundary import _wrapper_functions

DAMAGED = ("Error: unable to start container \"0123\": mounting storage for container 0123: "
           "can't stat (or find?) lower layer \"/var/lib/containers/storage/overlay/abcd/diff\": no such file or directory")
PINNED = "ghcr.io/leopu00/jht@sha256:" + "1" * 64
DEFAULT = "ghcr.io/leopu00/jht@sha256:" + "2" * 64


def _up(tmp_path: Path, *, runtime="podman", first_err=DAMAGED, first_rc=125, second_rc=0, pull_rc=0, rmi_rc=0, pinned=PINNED):
    log = tmp_path / "calls.log"
    count = tmp_path / "count"
    script = f"""
set -u
CONTAINER_RUNTIME={runtime}
JHT_COMPOSE_VERBOSE=0
DEFAULT_RUNTIME_IMAGE="{DEFAULT}"
TMPDIR="{tmp_path}"
info() {{ echo "info: $*"; }}
err() {{ echo "error: $*" >&2; }}
jht_say() {{ printf '%s' "$1"; }}
runtime_selected_image() {{ [ -z "{pinned}" ] || printf '%s\\n' "{pinned}"; }}
container_down() {{ echo down >> "{log}"; }}
docker() {{
  echo "docker $*" >> "{log}"
  case "$1" in rmi) return {rmi_rc} ;; pull) return {pull_rc} ;; esac
}}
compose_quiet() {{
  echo "compose $*" >> "{log}"
  n=$(cat "{count}" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "{count}"
  if [ "$n" -eq 1 ]; then [ -z "$FIRST_ERR" ] || printf '%s\n' "$FIRST_ERR" >&2; return {first_rc}; fi
  return {second_rc}
}}
{_wrapper_functions("compose_up_team")}
compose_up_team; echo "rc=$?"
"""
    env = {**os.environ, "FIRST_ERR": first_err}
    result = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60, env=env)
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return result, calls


def test_a_damaged_image_is_said_pulled_again_and_the_team_started(tmp_path: Path):
    result, calls = _up(tmp_path)
    assert "rc=0" in result.stdout, result
    assert "info: up.storage_damaged" in result.stdout
    assert "lower layer" not in result.stdout + result.stderr  # the engine's raw line is not shown
    assert calls == ["compose up -d", "down", f"docker rmi {PINNED}", f"docker pull {PINNED}", "compose up -d"]


def test_with_no_pin_it_is_the_image_the_compose_names_by_default(tmp_path: Path):
    _, calls = _up(tmp_path, pinned="")
    assert f"docker pull {DEFAULT}" in calls


def test_an_image_that_will_not_go_away_is_removed_by_force(tmp_path: Path):
    _, calls = _up(tmp_path, rmi_rc=1)
    assert calls[2:4] == [f"docker rmi {PINNED}", f"docker rmi -f {PINNED}"]


def test_a_repair_that_cannot_download_says_what_to_do_and_fails(tmp_path: Path):
    result, calls = _up(tmp_path, pull_rc=1)
    assert "rc=1" in result.stdout
    assert "error: up.storage_repair_failed" in result.stderr
    assert calls.count("compose up -d") == 1


def test_a_start_that_fails_again_after_the_repair_says_what_to_do(tmp_path: Path):
    result, _ = _up(tmp_path, second_rc=125)
    assert "rc=1" in result.stdout and "error: up.storage_repair_failed" in result.stderr


def test_any_other_failure_is_compose_s_answer_as_before(tmp_path: Path):
    result, calls = _up(tmp_path, first_err="Error: no space left on device", first_rc=5)
    assert "rc=5" in result.stdout
    assert "Error: no space left on device" in result.stderr
    assert calls == ["compose up -d"]


def test_a_start_that_works_touches_nothing_else(tmp_path: Path):
    result, calls = _up(tmp_path, first_err="", first_rc=0)
    assert "rc=0" in result.stdout and calls == ["compose up -d"]


def test_docker_or_colima_never_repairs(tmp_path: Path):
    result, calls = _up(tmp_path, runtime="docker")
    assert "rc=125" in result.stdout
    assert calls == ["compose up -d"]


# The Podman machine killed while `jht up` runs (giro Mac 7: 3 s and 7 s after the start, during `podman ps` / `volume create`):
# podman-compose dies with a raw Python traceback. The person reads one line instead: what happened, its last error line, and
# the command that starts again. Nothing is repaired or removed for it.
TRACEBACK = """Traceback (most recent call last):
  File "/opt/homebrew/bin/podman-compose", line 8, in <module>
    sys.exit(main())
  File "/opt/homebrew/lib/python3.13/site-packages/podman_compose.py", line 4100, in main
    asyncio.run(async_main())
subprocess.CalledProcessError: Command '['podman', 'volume', 'create', 'jht_home']' returned non-zero exit status 125."""


def test_a_machine_that_died_under_compose_is_one_line_and_not_the_stack(tmp_path: Path):
    result, calls = _up(tmp_path, first_err=TRACEBACK, first_rc=1)
    assert "rc=1" in result.stdout
    assert "Traceback" not in result.stdout + result.stderr and 'File "' not in result.stdout + result.stderr
    assert "error: up.engine_lost" in result.stderr
    assert calls == ["compose up -d"]  # no repair, no second start


def test_the_line_names_the_error_and_the_command_that_starts_again(tmp_path: Path):
    from test_podman_compose_exact_version_boundary import _wrapper_functions as functions
    script = f"""
set -u
JHT_SAY_LANG=it
{functions("jht_text_en", "jht_text_it", "jht_say")}
jht_say up.engine_lost "subprocess.CalledProcessError: Command x"
"""
    said = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30).stdout
    assert "La macchina Podman si e' fermata" in said and "CalledProcessError" in said and "Rilancia jht up" in said

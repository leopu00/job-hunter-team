"""After the Mac restarts, `jht up` turns the team's Colima back on by itself.

The Colima that the team runs in is off after a restart, and `jht up` used to stop with «Docker daemon non risponde. Avvialo:
'colima start' oppure 'open -a Docker'»: terminal commands, and a Docker the person never installed. Now `jht up` starts that Colima,
says so in one line and goes on. Only the profile the Docker of this computer talks to (…/.colima/<profile>/docker.sock), only when
that profile already exists (its colima.yaml: `colima start` on a missing profile would create a new machine), never another
profile and never Docker Desktop. The function is taken from the wrapper and run with a made-up colima and docker (no VM).
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the bash wrapper is not run on Windows")


def _functions(*names: str) -> str:
    return "\n".join(re.search(rf"^{n}\(\) \{{\n.*?^\}}\n", SOURCE, re.S | re.M).group(0) for n in names)


def _world(tmp_path: Path, *, profile="default", running=(), profiles=("default",), start_works=True, endpoint=None):
    """`profiles` exist on disk (with colima.yaml); `running` are on; the Docker of the computer talks to `profile`."""
    colima_home = tmp_path / ".colima"
    for name in profiles:
        (colima_home / name).mkdir(parents=True)
        (colima_home / name / "colima.yaml").write_text("cpu: 2\n", encoding="utf-8")
    states = tmp_path / "states"
    states.mkdir()
    for name in running:
        (states / name).touch()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "calls.log"
    start = f'touch "{states}/$prof"' if start_works else 'echo "level=fatal msg=\\"error starting vm: boom\\"" >&2; exit 1'
    (bin_dir / "colima").write_text(f"""#!/bin/sh
echo "colima $*" >> "{log}"
sub="$1"; shift
prof=default
if [ "${{1:-}}" = "-p" ]; then prof="$2"; fi
case "$sub" in
  status) [ -e "{states}/$prof" ] ;;
  start) {start} ;;
esac
""", encoding="utf-8")
    sock = endpoint or f"unix://{colima_home}/{profile}/docker.sock"
    (bin_dir / "docker").write_text(f"""#!/bin/sh
echo "docker $*" >> "{log}"
case "$1" in
  context) echo "{sock}" ;;
  info) [ -e "{states}/{profile}" ] ;;
esac
""", encoding="utf-8")
    for tool in ("colima", "docker"):
        (bin_dir / tool).chmod(0o755)
    return bin_dir, log, states


def _wake(tmp_path: Path, bin_dir: Path, *, kernel="Darwin", podman_mode="", lang="en"):
    script = f"""set -u
HOST_KERNEL={kernel}
PODMAN_RUNTIME_MODE="{podman_mode}"
JHT_SAY_LANG={lang}
UNINSTALL_TOOL_DIRS="{bin_dir}"
info() {{ printf 'info: %s\\n' "$*"; }}
err() {{ printf 'err: %s\\n' "$*"; }}
{_functions("jht_text_en", "jht_text_it", "jht_say", "uninstall_tool", "uninstall_docker_endpoint", "wake_jht_colima")}
wake_jht_colima
echo "RC=$?"
"""
    env = {"HOME": str(tmp_path), "PATH": f"{bin_dir}:/usr/bin:/bin"}
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=30)


def _calls(log: Path) -> list[str]:
    return log.read_text().splitlines() if log.exists() else []


def _starts(log: Path) -> list[str]:
    return [line for line in _calls(log) if line.startswith("colima start")]


@pytest.mark.parametrize("profile", ["default", "work", "giro-mac.2"])
def test_the_colima_of_the_team_is_started_with_one_line_and_the_engine_answers(tmp_path, profile):
    bin_dir, log, states = _world(tmp_path, profile=profile, profiles=(profile,))
    done = _wake(tmp_path, bin_dir)
    assert "RC=0" in done.stdout, done.stdout + done.stderr
    assert f"info: Colima (profile {profile}), where the team runs, is off: starting it" in done.stdout
    assert _starts(log) == [f"colima start -p {profile}"] and (states / profile).exists()
    assert "err:" not in done.stdout


def test_the_line_is_in_the_language_of_the_person(tmp_path):
    bin_dir, _, _ = _world(tmp_path)
    done = _wake(tmp_path, bin_dir, lang="it")
    assert "info: Colima (profilo default), dove gira la squadra, e' spenta: la accendo" in done.stdout


def test_another_profile_is_never_started(tmp_path):
    # the Docker of the computer talks to «work»; the operator's «default» is off and stays off
    bin_dir, log, states = _world(tmp_path, profile="work", profiles=("work", "default"))
    _wake(tmp_path, bin_dir)
    assert _starts(log) == ["colima start -p work"] and not (states / "default").exists()
    for line in _calls(log):
        if line.startswith("colima "):
            assert " -p work" in line, line


def test_a_profile_that_does_not_exist_is_not_created(tmp_path):
    # the context names a profile with no colima.yaml: `colima start` would make a new machine
    bin_dir, log, _ = _world(tmp_path, profile="gone", profiles=("default",))
    done = _wake(tmp_path, bin_dir)
    assert "RC=1" in done.stdout and not _starts(log) and "info:" not in done.stdout


@pytest.mark.parametrize("endpoint", [
    "unix:///Users/someone/.docker/run/docker.sock",          # Docker Desktop
    "unix:///var/run/docker.sock",
    "tcp://192.0.2.10:2376",
])
def test_an_engine_that_is_not_a_colima_is_never_started(tmp_path, endpoint):
    bin_dir, log, _ = _world(tmp_path, endpoint=endpoint)
    done = _wake(tmp_path, bin_dir)
    assert "RC=1" in done.stdout and not any(line.startswith("colima") for line in _calls(log))


def test_a_colima_that_is_already_on_is_not_started_again(tmp_path):
    bin_dir, log, _ = _world(tmp_path, running=("default",))
    done = _wake(tmp_path, bin_dir)
    assert "RC=1" in done.stdout and not _starts(log)


def test_a_failed_start_says_why_and_stops(tmp_path):
    bin_dir, log, _ = _world(tmp_path, start_works=False)
    done = _wake(tmp_path, bin_dir)
    assert "RC=2" in done.stdout
    assert "err: Colima (profile default) could not be started:" in done.stdout and "error starting vm: boom" in done.stdout


@pytest.mark.parametrize("kernel,podman_mode", [("Linux", ""), ("Darwin", "machine")])
def test_only_a_mac_with_the_docker_engine_wakes_colima(tmp_path, kernel, podman_mode):
    bin_dir, log, _ = _world(tmp_path)
    done = _wake(tmp_path, bin_dir, kernel=kernel, podman_mode=podman_mode)
    assert "RC=1" in done.stdout and not _calls(log)


def test_jht_up_on_a_mac_goes_through_it_before_the_old_message():
    body = re.search(r"^wake_container_runtime_for_up\(\) \{\n.*?^\}\n", SOURCE, re.S | re.M).group(0)
    darwin = body[body.index('elif [ "$(uname)" = "Darwin" ]'):]
    assert darwin.index("wake_jht_colima") < darwin.index("Docker daemon non risponde")
    # the probes and the other commands stay observational: only `up` may start the engine
    observe = re.search(r"^require_docker\(\) \{\n.*?^\}\n", SOURCE, re.S | re.M).group(0)
    assert "wake_jht_colima" not in observe and "colima start" not in observe
    assert "Avvialo con: jht up" in observe

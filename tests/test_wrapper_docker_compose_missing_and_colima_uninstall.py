"""The wrapper says «docker compose is missing» when it is, and the uninstall stops the Colima that the installer started.

1. A Docker that answers but has no `docker compose` (Colima with only the client of Homebrew): every command used to end in «Container JHT
   non attestabile». The tests run the wrapper itself with a docker that has no Compose and read what the person reads.
2. `jht uninstall` on a Mac with Colima: the installer marks the Colima it started (colima-started); once the containers, volumes and images
   of JHT are gone, that Colima is stopped if nothing else runs in it; otherwise it stays on and the person is told why and how to stop it.
   The function is taken from the wrapper and run with a made-up colima and docker (no real VM, no network).
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

from test_cli_help_never_starts_docker import write_trusted_runtime

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
SOURCE = WRAPPER.read_text(encoding="utf-8")

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the bash wrapper is not run on Windows")


# ── 1. docker compose missing ─────────────────────────────────────────────

def _docker(tmp_path: Path, compose: str) -> Path:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    compose_branch = {
        "missing": 'echo "docker: unknown command: docker compose" >&2; exit 1',
        "old": 'echo "docker: \'compose\' is not a docker command." >&2; exit 1',
        "broken": 'echo "Cannot connect: something else" >&2; exit 1',
        "ok": 'echo "Docker Compose version v2.0.0"; exit 0',
    }[compose]
    (bin_dir / "docker").write_text(f"""#!/bin/sh
if [ "$1" = compose ] && [ "$2" = version ]; then {compose_branch}; fi
case "$1" in
  info) exit 0 ;;
  compose) exit 1 ;;
esac
exit 0
""", encoding="utf-8")
    (bin_dir / "docker").chmod(0o755)
    return bin_dir


def _wrapper(tmp_path: Path, args: list[str], compose: str, lang: str | None = None):
    bin_dir = _docker(tmp_path, compose)
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True, exist_ok=True)
    if lang:
        (home / ".jht" / "i18n-prefs.json").write_text('{"locale": "%s"}' % lang, encoding="utf-8")
    env = {"HOME": str(home), "PATH": f"{bin_dir}:/usr/bin:/bin", **write_trusted_runtime(tmp_path)}
    return subprocess.run(["bash", str(WRAPPER), *args], capture_output=True, text=True, env=env, timeout=60)


@pytest.mark.parametrize("compose", ["missing", "old"])
@pytest.mark.parametrize("args", [["status"], ["up"], ["shell"], ["down"]])
def test_without_the_compose_plugin_the_commands_say_it_is_missing_and_how_to_get_it(tmp_path, args, compose):
    done = _wrapper(tmp_path, args, compose)
    text = done.stdout + done.stderr
    assert done.returncode == 1, text
    assert "docker compose is missing" in text and "brew install docker-compose" in text and "docker-compose-v2" in text
    assert "non attestabile" not in text


def test_the_message_is_in_the_language_of_the_person(tmp_path):
    done = _wrapper(tmp_path, ["status"], "missing", lang="it")
    assert "manca docker compose" in done.stdout + done.stderr


def test_a_compose_that_fails_for_another_reason_is_not_called_missing(tmp_path):
    done = _wrapper(tmp_path, ["status"], "broken")
    assert "docker compose is missing" not in done.stdout + done.stderr


def test_with_the_plugin_there_is_no_such_message(tmp_path):
    done = _wrapper(tmp_path, ["status"], "ok")
    assert "docker compose is missing" not in done.stdout + done.stderr


def test_podman_does_not_ask_docker_for_compose():
    func = re.search(r"^docker_compose_plugin_missing\(\) \{\n.*?^\}\n", SOURCE, re.S | re.M).group(0)
    assert '[ -z "$PODMAN_RUNTIME_MODE" ]' in func and '"$CONTAINER_RUNTIME" != podman' in func


# ── 2. the uninstall and Colima ───────────────────────────────────────────

def _functions(*names: str) -> str:
    return "\n".join(re.search(rf"^{n}\(\) \{{\n.*?^\}}\n", SOURCE, re.S | re.M).group(0) for n in names)


def _colima_world(tmp_path: Path, *, running=("default",), stop_works=True, others="", profile="default", marker="auto",
                  marker_is_link=False, endpoint=None):
    """The Docker of the computer is the one of `profile`; `running` lists the Colima profiles that are on (the others may be someone's)."""
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    if marker == "auto":
        marker = f"colima\n{profile}\n"
    if marker is not None:
        if marker_is_link:
            (tmp_path / "elsewhere").write_text(marker, encoding="utf-8")
            (runtime / "colima-started").symlink_to(tmp_path / "elsewhere")
        else:
            (runtime / "colima-started").write_text(marker, encoding="utf-8")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    states = tmp_path / "states"
    states.mkdir()
    for name in running:
        (states / name).touch()
    log = tmp_path / "calls.log"
    # colima answers only for a profile it is given with -p; without -p it would be the default one: the log shows if that ever happens
    (bin_dir / "colima").write_text(f"""#!/bin/sh
echo "colima $*" >> "{log}"
sub="$1"; shift
prof=default
if [ "${{1:-}}" = "-p" ]; then prof="$2"; fi
case "$sub" in
  status) [ -e "{states}/$prof" ] ;;
  stop) {'rm -f "' + str(states) + '/$prof"' if stop_works else ':'} ;;
esac
""", encoding="utf-8")
    sock = endpoint or f"unix://{tmp_path}/.colima/{profile}/docker.sock"
    (bin_dir / "docker").write_text(f"""#!/bin/sh
echo "docker $*" >> "{log}"
case "$1" in
  context) echo "{sock}" ;;
  ps) printf '%s' "{others}" ;;
esac
""", encoding="utf-8")
    for tool in ("colima", "docker"):
        (bin_dir / tool).chmod(0o755)
    return runtime, bin_dir, log, states


def _uninstall_colima(tmp_path: Path, runtime: Path, bin_dir: Path, selection="docker", kernel="Darwin"):
    script = f"""set -u
HOST_KERNEL={kernel}
UNINSTALL_TOOL_DIRS="{bin_dir}"
jht_say() {{ printf '<%s>' "$1"; }}
info() {{ printf 'info: %s\\n' "$*"; }}
warn() {{ printf 'warn: %s\\n' "$*"; }}
{_functions("uninstall_tool", "uninstall_docker_endpoint", "uninstall_colima")}
uninstall_colima "{runtime}" "{selection}"
echo "RC=$?"
"""
    env = {"HOME": str(tmp_path), "PATH": f"{bin_dir}:/usr/bin:/bin"}
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env, timeout=30)


def _calls(log: Path) -> list[str]:
    return log.read_text().splitlines() if log.exists() else []


def _never_without_a_profile(log: Path) -> None:
    for line in _calls(log):
        if line.startswith("colima status") or line.startswith("colima stop"):
            assert " -p " in line, line


@pytest.mark.parametrize("profile", ["default", "work", "giro-mac.2"])
def test_a_colima_the_installer_started_is_stopped_once_nothing_else_runs_in_it(tmp_path, profile):
    runtime, bin_dir, log, states = _colima_world(tmp_path, profile=profile, running=(profile,))
    done = _uninstall_colima(tmp_path, runtime, bin_dir)
    assert "info: <uninstall.colima_stopping>" in done.stdout and "RC=0" in done.stdout and "warn" not in done.stdout
    assert f"colima stop -p {profile}" in _calls(log) and not (states / profile).exists()
    _never_without_a_profile(log)


def test_the_colima_of_another_profile_is_not_even_looked_at_nor_stopped(tmp_path):
    # the Docker of the computer is the profile «work» (a test run, marker «work»); the operator's «default» is on and stays on
    runtime, bin_dir, log, states = _colima_world(tmp_path, profile="work", running=("work", "default"))
    done = _uninstall_colima(tmp_path, runtime, bin_dir)
    assert not (states / "work").exists() and (states / "default").exists()
    assert all("-p default" not in line for line in _calls(log)), _calls(log)
    _never_without_a_profile(log)
    assert "warn" not in done.stdout


def test_a_marker_that_names_another_profile_than_the_one_of_the_docker_does_not_stop_it(tmp_path):
    # the marker says the installer started «work»; the Docker of the computer is the operator's «default»
    runtime, bin_dir, log, states = _colima_world(tmp_path, profile="default", marker="colima\nwork\n", running=("default", "work"))
    done = _uninstall_colima(tmp_path, runtime, bin_dir)
    assert "warn: <uninstall.colima_running>" in done.stdout
    assert (states / "default").exists() and (states / "work").exists()
    assert not any(line.startswith("colima stop") for line in _calls(log))


def test_it_stays_on_with_the_reason_when_other_containers_run_in_it(tmp_path):
    runtime, bin_dir, log, states = _colima_world(tmp_path, others="abc123\n")
    done = _uninstall_colima(tmp_path, runtime, bin_dir)
    assert "warn: <uninstall.colima_busy>" in done.stdout
    assert not any(line.startswith("colima stop") for line in _calls(log)) and (states / "default").exists()


@pytest.mark.parametrize("kind", ["no marker", "marker is a link", "marker of another thing", "marker without a profile"])
def test_a_colima_the_installer_did_not_start_stays_on_and_the_person_is_told(tmp_path, kind):
    marker = {"no marker": None, "marker is a link": "auto", "marker of another thing": "something\ndefault\n",
              "marker without a profile": "colima\n"}[kind]
    runtime, bin_dir, log, states = _colima_world(tmp_path, marker=marker, marker_is_link=(kind == "marker is a link"))
    done = _uninstall_colima(tmp_path, runtime, bin_dir)
    assert "warn: <uninstall.colima_running>" in done.stdout
    assert not any(line.startswith("colima stop") for line in _calls(log)) and (states / "default").exists()


def test_a_stop_that_does_not_take_is_said_and_never_fails_the_uninstall(tmp_path):
    runtime, bin_dir, log, states = _colima_world(tmp_path, stop_works=False)
    done = _uninstall_colima(tmp_path, runtime, bin_dir)
    assert "warn: <uninstall.colima_stop_failed>" in done.stdout and "RC=0" in done.stdout


@pytest.mark.parametrize("case, kwargs, extra", [
    ("off", {"running": ()}, {}),
    ("docker desktop", {"endpoint": "unix:///Users/x/.docker/run/docker.sock"}, {}),
    ("not a profile socket", {"endpoint": "unix:///Users/x/.colima/docker.sock"}, {}),
    ("a longer path", {"endpoint": "unix:///Users/x/.colima/default/sub/docker.sock"}, {}),
    ("a profile that is an option", {"endpoint": "unix:///Users/x/.colima/-h/docker.sock", "marker": "colima\n-h\n"}, {}),
    ("a profile with a space", {"endpoint": "unix:///Users/x/.colima/a b/docker.sock"}, {}),
    ("podman", {}, {"selection": "podman"}),
    ("linux", {}, {"kernel": "Linux"}),
])
def test_nothing_is_said_when_colima_is_off_or_is_not_the_engine_of_this_computer_or_podman_was_chosen(tmp_path, case, kwargs, extra):
    runtime, bin_dir, log, states = _colima_world(tmp_path, **kwargs)
    done = _uninstall_colima(tmp_path, runtime, bin_dir, **extra)
    assert done.stdout.strip() == "RC=0", (case, done.stdout)
    assert not any(line.startswith("colima stop") for line in _calls(log)), case


def test_the_stop_comes_after_the_images_and_before_the_runtime_folder_with_its_marker_goes():
    body = re.search(r"^jht_uninstall\(\) \{\n.*?^\}\n", SOURCE, re.S | re.M).group(0)
    assert body.index("uninstall_images") < body.index("uninstall_colima ") < body.index("uninstall_phase uninstall_runtime")


def test_the_texts_exist_in_english_and_italian():
    for key in ("compose.missing", "uninstall.colima_stopping", "uninstall.colima_busy", "uninstall.colima_stop_failed", "uninstall.colima_running"):
        assert SOURCE.count(f"    {key}) printf") == 2, key

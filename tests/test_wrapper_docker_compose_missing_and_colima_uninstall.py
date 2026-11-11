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


def _colima_world(tmp_path: Path, *, running=True, stop_works=True, others="", endpoint=None, marker: str | None = "colima\n",
                  marker_is_link=False):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    if marker is not None:
        if marker_is_link:
            (tmp_path / "elsewhere").write_text(marker, encoding="utf-8")
            (runtime / "colima-started").symlink_to(tmp_path / "elsewhere")
        else:
            (runtime / "colima-started").write_text(marker, encoding="utf-8")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    state = tmp_path / "colima-running"
    if running:
        state.touch()
    log = tmp_path / "calls.log"
    (bin_dir / "colima").write_text(f"""#!/bin/sh
echo "colima $*" >> "{log}"
case "$1" in
  status) [ -e "{state}" ] ;;
  stop) {"rm -f " + str(state) if stop_works else ":"} ;;
esac
""", encoding="utf-8")
    (bin_dir / "docker").write_text(f"""#!/bin/sh
echo "docker $*" >> "{log}"
case "$1" in
  context) echo "{endpoint or "unix://" + str(tmp_path) + "/.colima/default/docker.sock"}" ;;
  ps) printf '%s' "{others}" ;;
esac
""", encoding="utf-8")
    for tool in ("colima", "docker"):
        (bin_dir / tool).chmod(0o755)
    return runtime, bin_dir, log, state


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


def test_a_colima_the_installer_started_is_stopped_once_nothing_else_runs_in_it(tmp_path):
    runtime, bin_dir, log, state = _colima_world(tmp_path)
    done = _uninstall_colima(tmp_path, runtime, bin_dir)
    assert "info: <uninstall.colima_stopping>" in done.stdout and "RC=0" in done.stdout
    assert "colima stop" in log.read_text() and not state.exists()
    assert "warn" not in done.stdout


def test_it_stays_on_with_the_reason_when_other_containers_run_in_it(tmp_path):
    runtime, bin_dir, log, state = _colima_world(tmp_path, others="abc123\n")
    done = _uninstall_colima(tmp_path, runtime, bin_dir)
    assert "warn: <uninstall.colima_busy>" in done.stdout
    assert "colima stop" not in log.read_text() and state.exists()


@pytest.mark.parametrize("kind", ["no marker", "marker is a link", "marker of another thing"])
def test_a_colima_the_installer_did_not_start_stays_on_and_the_person_is_told(tmp_path, kind):
    runtime, bin_dir, log, state = _colima_world(
        tmp_path, marker=None if kind == "no marker" else ("colima\n" if "link" in kind else "something\n"),
        marker_is_link=(kind == "marker is a link"))
    done = _uninstall_colima(tmp_path, runtime, bin_dir)
    assert "warn: <uninstall.colima_running>" in done.stdout
    assert "colima stop" not in log.read_text() and state.exists()


def test_a_stop_that_does_not_take_is_said_and_never_fails_the_uninstall(tmp_path):
    runtime, bin_dir, log, state = _colima_world(tmp_path, stop_works=False)
    done = _uninstall_colima(tmp_path, runtime, bin_dir)
    assert "warn: <uninstall.colima_stop_failed>" in done.stdout and "RC=0" in done.stdout


def test_nothing_is_said_when_colima_is_off_or_is_not_the_engine_of_this_computer_or_podman_was_chosen(tmp_path):
    for case, kwargs, extra in (
        ("off", {"running": False}, {}),
        ("docker desktop", {"endpoint": "unix:///Users/x/.docker/run/docker.sock"}, {}),
        ("another colima profile", {"endpoint": "unix:///Users/x/.colima/work/docker.sock"}, {}),
        ("podman", {}, {"selection": "podman"}),
        ("linux", {}, {"kernel": "Linux"}),
    ):
        sub = tmp_path / case.replace(" ", "-")
        sub.mkdir()
        runtime, bin_dir, log, state = _colima_world(sub, **kwargs)
        done = _uninstall_colima(sub, runtime, bin_dir, **extra)
        assert done.stdout.strip() == "RC=0", (case, done.stdout)
        assert not log.exists() or "colima stop" not in log.read_text(), case


def test_the_stop_comes_after_the_images_and_before_the_runtime_folder_with_its_marker_goes():
    body = re.search(r"^jht_uninstall\(\) \{\n.*?^\}\n", SOURCE, re.S | re.M).group(0)
    assert body.index("uninstall_images") < body.index("uninstall_colima ") < body.index("uninstall_phase uninstall_runtime")


def test_the_texts_exist_in_english_and_italian():
    for key in ("compose.missing", "uninstall.colima_stopping", "uninstall.colima_busy", "uninstall.colima_stop_failed", "uninstall.colima_running"):
        assert SOURCE.count(f"    {key}) printf") == 2, key

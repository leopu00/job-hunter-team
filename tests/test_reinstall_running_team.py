"""Re-installing over a running team never leaves the user without a way on.

A re-install publishes a new compose (and, on the test channel, a new image pin). The wrapper attests
the running team against them through io.podman.compose.config-hash: a team started before the
re-install no longer matched, and `jht up`, `jht down`, `restart` and `recreate` all refused it
(«Container JHT esistente non attestabile»). Nothing in the product could stop it any more.

Now:
- install.sh stops before changing anything while the team's containers run (exit 84, team_running);
- `jht down` stops a team of the same project whose only difference is the config-hash, and says so;
- up/restart/recreate still refuse it, and say to run `jht down`, then `jht up`;
- the rootless netns EPERM that podman prints after the containers are gone becomes a note.

The production functions are cut out of the scripts and run in bash with fake engines.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"

OLD_HASH = "a" * 64
NEW_HASH = "b" * 64


# ── install.sh: a running team stops the re-install before anything changes ──


def install(tmp_path: Path, ps: str, *, os_name: str = "linux", choice: str = "podman", ps_fails: bool = False,
            installed_before: bool = False) -> subprocess.CompletedProcess:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    if installed_before:
        (runtime / ".runtime-integrity").write_text("version=1\n", encoding="utf-8")
    log = tmp_path / "engine-argv.txt"
    for engine in ("podman", "docker"):
        path = bin_dir / engine
        path.write_text(
            "#!/bin/sh\n"
            f'printf "%s %s\\n" "$(basename "$0")" "$*" >> "{log}"\n'
            + ("exit 125\n" if ps_fails else f"printf '{ps}'\nexit 0\n"),
            encoding="utf-8",
        )
        path.chmod(0o755)
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\n'
        f"OS={os_name}\nRUNTIME_CHOICE={choice}\nDOCKER_CLI=docker\nDRY_RUN=0\n"
        "refuse_running_team\n"
        "echo went-on\n"
    )
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    return subprocess.run(
        ["bash", "-c", script],
        env={"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(home), "JHT_RUNTIME_DIR": str(runtime)},
        capture_output=True, text=True, timeout=30,
    )


@pytest.mark.parametrize("names", ["jht\\n", "other\\njht-broker\\n", "jht-telegram\\njht\\n"])
def test_a_running_team_stops_the_reinstall_with_its_own_exit(tmp_path, names):
    done = install(tmp_path, names)
    assert done.returncode == 84, done.stdout + done.stderr
    assert "went-on" not in done.stdout
    assert done.stderr.splitlines()[0] == "JHT_ERROR team_running"
    assert "jht down" in done.stderr and "jht up" in done.stderr


@pytest.mark.parametrize("names", ["", "other\\n", "jht-old\\nmy-jht\\n"])
def test_no_team_container_running_goes_on(tmp_path, names):
    done = install(tmp_path, names)
    assert done.returncode == 0, done.stderr
    assert "went-on" in done.stdout


def test_the_mac_podman_machine_is_asked_through_its_own_connection(tmp_path):
    done = install(tmp_path, "jht\\n", os_name="macos")
    assert done.returncode == 84
    argv = (tmp_path / "engine-argv.txt").read_text(encoding="utf-8").splitlines()
    assert argv[0].startswith("podman --connection ") and " ps --format " in argv[0]


def test_docker_is_asked_on_the_docker_path(tmp_path):
    done = install(tmp_path, "jht\\n", choice="")
    assert done.returncode == 84
    assert (tmp_path / "engine-argv.txt").read_text(encoding="utf-8").startswith("docker ps ")


def test_an_engine_that_cannot_list_goes_on_only_where_nothing_was_installed(tmp_path):
    first = install(tmp_path, "", ps_fails=True)
    assert first.returncode == 0 and "went-on" in first.stdout  # no JHT here before: no team of ours
    again = install(tmp_path, "", ps_fails=True, installed_before=True)
    assert again.returncode == 1 and "went-on" not in again.stdout  # it cannot tell: it refuses


def test_the_check_runs_before_the_image_pull_and_any_file_is_published():
    text = INSTALL.read_text(encoding="utf-8")
    body = re.search(r"^main_docker\(\) \{\n(.*?)^\}", text, re.S | re.M).group(1).split()
    assert body.index("refuse_running_team") > body.index("verify_docker_works")
    assert body.index("refuse_running_team") < body.index("verify_test_image") < body.index("download_runtime_files")


# ── the wrapper: a team started before the re-install can still be stopped ──

FUNCTIONS = (
    "read_only_service_id", "read_only_container_id", "container_up", "container_mutation_preflight", "stale_config_hint",
    "container_down", "rootless_netns_noise_filter",
)


def _functions() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    parts = []
    for name in FUNCTIONS:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, name
        parts.append(match.group(0))
    return "\n".join(parts)


@pytest.fixture()
def wrapper(tmp_path):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    calls = tmp_path / "compose-calls.txt"

    def run(body: str, *, running_hash: str = OLD_HASH, working_dir: str | None = None, down_stderr: str = "",
            down_exit: int = 0, left_after_down: bool = False, broker_left: bool = False, no_container: bool = False,
            ps_fails: bool = False, runtime_kind: str = "podman", only_broker: bool = False, second_ps_fails: bool = False):
        compose_file = runtime / "docker-compose.yml"
        override = runtime / "podman-native-override.yml"
        details = "|".join([
            "jht", "true", "jht", "jht", "jht", "jht", "1", working_dir or str(runtime),
            f"{compose_file},{override}", "1.5.0", "podman-compose@" "jht.service", running_hash,
        ])
        stubs = f"""
set -u
CONTAINER_RUNTIME={runtime_kind}
PODMAN_RUNTIME_MODE=native
CONTAINER_SERVICE=jht
COMPOSE_SERVICES="jht jht-broker jht-telegram"
RUNTIME_DIR="{runtime}"
COMPOSE_FILE="{compose_file}"
err()  {{ echo "error: $*" >&2; }}
warn() {{ echo "warn: $*" >&2; }}
info() {{ echo "info: $*" >&2; }}
runtime_bundle_trusted() {{ return 0; }}
docker_reachable() {{ return 0; }}
compose_project_name() {{ echo jht; }}
podman_compose_binary() {{ echo /fake/podman-compose; }}
podman_compose_version_number() {{ echo 1.5.0; }}
podman_native_override_path() {{ echo "{override}"; }}
podman_expected_config_hash() {{ echo {NEW_HASH}; }}
docker() {{
  case "$*" in
    *fedcba987654*) printf '%s\\n' 'jht-broker|true|jht|jht|jht-broker|jht-broker|1|x|x|1.5.0|x|{NEW_HASH}' ;;
    *) printf '%s\\n' '{details}' ;;
  esac
}}
compose_file() {{
  shift
  case "$1" in
    ps) if [ "{int(ps_fails)}" = 1 ]; then return 1; fi
        n=$(( $(cat "{calls}.ps" 2>/dev/null || echo 0) + 1 )); echo "$n" > "{calls}.ps"
        if [ "{int(second_ps_fails)}" = 1 ] && [ "$n" -ge 2 ]; then return 1; fi
        if [ "{int(only_broker)}" = 1 ] && ! grep -qx down "{calls}" 2>/dev/null; then
          if [ "${{3:-}}" = jht ]; then return 0; fi   # Docker: `ps -q jht` lists only that service
          echo fedcba987654; return 0
        fi
        if [ "{int(no_container)}" = 1 ]; then return 0; fi
        if grep -qx down "{calls}" 2>/dev/null; then
          if [ "{int(broker_left)}" = 1 ]; then echo fedcba987654; return 0; fi
          if [ "{int(not left_after_down)}" = 1 ]; then return 0; fi
        fi
        echo 0123456789ab ;;
    down) echo "down" >> "{calls}"; printf '%b' '{down_stderr}' >&2; return {down_exit} ;;
    *) echo "$*" >> "{calls}" ;;
  esac
}}
compose() {{ compose_file "$COMPOSE_FILE" "$@"; }}
"""
        return subprocess.run(["bash", "-c", stubs + _functions() + "\n" + body], capture_output=True, text=True,
                              env={**os.environ, "LC_ALL": "C"}, timeout=30)

    def downs() -> list[str]:
        return calls.read_text(encoding="utf-8").splitlines() if calls.exists() else []

    return type("Wrapper", (), {"run": run, "downs": downs})


def test_down_stops_a_team_started_before_the_reinstall_and_says_so(wrapper):
    done = wrapper.run("container_down; echo rc=$?")
    assert "rc=0" in done.stdout, done.stderr
    assert wrapper.downs() == ["down"]
    assert "config_changed_while_running" in done.stderr


def test_down_of_a_team_with_the_current_configuration_says_nothing_more(wrapper):
    done = wrapper.run("container_down; echo rc=$?", running_hash=NEW_HASH)
    assert "rc=0" in done.stdout and wrapper.downs() == ["down"]
    assert done.stderr == ""


@pytest.mark.parametrize("label", ["working_dir", "hash"])
def test_down_still_refuses_a_container_that_is_not_ours(wrapper, label):
    kwargs = {"working_dir": "/elsewhere"} if label == "working_dir" else {"running_hash": "not-a-hash"}
    done = wrapper.run("container_down; echo rc=$?", **kwargs)
    assert "rc=1" in done.stdout and wrapper.downs() == []
    assert "arresto negato" in done.stderr


def test_up_still_refuses_it_and_says_down_then_up(wrapper):
    done = wrapper.run("container_mutation_preflight; echo rc=$?")
    assert "rc=1" in done.stdout and wrapper.downs() == []
    assert "config_changed_while_running" in done.stderr and "jht down" in done.stderr and "jht up" in done.stderr


NETNS = ("Error: removing container " + "6" * 64 + " network: 1 error occurred:\\n"
         "\\t* rootless netns: kill network process: permission denied\\n\\n\\n")


def test_the_rootless_netns_eperm_after_down_is_a_note_not_an_error(wrapper):
    done = wrapper.run("container_down; echo rc=$?", running_hash=NEW_HASH, down_stderr=NETNS)
    assert "rc=0" in done.stdout
    assert "Error:" not in done.stderr and "permission denied" in done.stderr
    assert done.stderr.startswith("nota: ")


def test_podman_failing_with_only_the_netns_eperm_exits_ok_once_no_container_is_left(wrapper):
    # The real podman exits non-zero with that one error even though the containers are gone.
    done = wrapper.run("container_down; echo rc=$?", running_hash=NEW_HASH, down_stderr=NETNS, down_exit=1)
    assert "rc=0" in done.stdout and "il team e' fermo" in done.stderr


def test_a_broker_left_standing_keeps_the_failed_exit_even_though_the_jht_service_is_gone(wrapper):
    # `ps -q` lists the whole project: the id left is the broker's, whose inspect says another service.
    done = wrapper.run("container_down; echo rc=$?", running_hash=NEW_HASH, down_stderr=NETNS, down_exit=1,
                       broker_left=True)
    assert "rc=1" in done.stdout


def test_the_netns_note_does_not_turn_a_failed_down_with_a_container_left_into_success(wrapper):
    done = wrapper.run("container_down; echo rc=$?", running_hash=NEW_HASH, down_stderr=NETNS, down_exit=1,
                       left_after_down=True)
    assert "rc=1" in done.stdout


def test_any_other_down_error_passes_as_it_is_with_its_exit(wrapper):
    other = "Error: removing container abc network: 1 error occurred:\\n\\t* something else\\n"
    done = wrapper.run("container_down; echo rc=$?", running_hash=NEW_HASH, down_stderr=NETNS + other, down_exit=3)
    assert "rc=3" in done.stdout
    assert "Error: removing container abc network: 1 error occurred:\n\t* something else" in done.stderr
    assert done.stderr.count("Error:") == 1


# ── `jht down` with no container: nothing to stop, and the uninstall chain goes on (Linux Gate CLI 19i, A1) ──

@pytest.mark.parametrize("kind", ["podman", "docker"])
def test_down_with_no_container_exits_zero_and_says_there_is_nothing_to_stop(wrapper, kind):
    done = wrapper.run("container_down; echo rc=$?", no_container=True, runtime_kind=kind)
    assert "rc=0" in done.stdout, done.stderr
    assert "niente da fermare" in done.stderr
    assert wrapper.downs() == [] and "arresto negato" not in done.stderr


def test_down_that_cannot_ask_the_provider_is_still_a_refusal_not_a_nothing_to_stop(wrapper):
    done = wrapper.run("container_down; echo rc=$?", ps_fails=True)
    assert "rc=1" in done.stdout and "arresto negato" in done.stderr and "niente da fermare" not in done.stderr


def test_a_chain_that_starts_with_down_goes_on_when_there_is_no_container(wrapper):
    done = wrapper.run("container_down && echo went-on", no_container=True)
    assert "went-on" in done.stdout


def test_a_container_of_ours_with_another_hash_is_still_stopped_by_down(wrapper):
    done = wrapper.run("container_down; echo rc=$?", running_hash=OLD_HASH)
    assert "rc=0" in done.stdout and wrapper.downs() == ["down"]


# ── Only the agent service is missing: the broker and Telegram are still a team to stop ──────────

@pytest.mark.parametrize("kind", ["podman", "docker"])
def test_down_with_the_agent_gone_but_the_broker_running_still_runs_compose_down(wrapper, kind):
    done = wrapper.run("container_down; echo rc=$?", only_broker=True, runtime_kind=kind)
    assert "rc=0" in done.stdout, done.stderr
    assert wrapper.downs() == ["down"]
    assert "niente da fermare" not in done.stderr and "altri servizi del progetto girano" in done.stderr


def test_down_refuses_when_it_cannot_ask_for_the_whole_project(wrapper):
    done = wrapper.run("container_down; echo rc=$?", no_container=True, second_ps_fails=True)
    assert "rc=1" in done.stdout and wrapper.downs() == []
    assert "arresto negato" in done.stderr and "niente da fermare" not in done.stderr


def test_the_uninstall_chain_stops_when_down_refuses_so_the_compose_file_stays(wrapper):
    done = wrapper.run("container_down && echo went-on", no_container=True, second_ps_fails=True)
    assert "went-on" not in done.stdout

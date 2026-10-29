"""The desktop chat bridge stays inside the attested JHT Podman runtime."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess

import pytest
from podman_machine_fixture import (
    write_linux_host_tools,
    write_machine_config,
    write_macos_host_tools,
)


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
PODMAN_SYSTEMD_UNIT = "podman-compose" + chr(64) + "jht.service"


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _runtime(tmp_path: Path) -> tuple[Path, dict[str, str], Path]:
    home = tmp_path / "home"
    runtime = tmp_path / "runtime"
    binary = tmp_path / "bin" / "jht"
    adapter = runtime / "bin" / "docker"
    log = tmp_path / "docker.log"
    home.mkdir()
    runtime.mkdir(mode=0o700)
    binary.parent.mkdir()
    adapter.parent.mkdir()
    write_macos_host_tools(binary.parent)
    shutil.copy2(WRAPPER, binary)
    binary.chmod(0o700)

    compose = runtime / "docker-compose.yml"
    compose.write_text(
        "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n",
        encoding="utf-8",
    )
    setup = runtime / "host-setup.sh"
    setup.write_text("#!/bin/sh\nJHT_HOST_SETUP_PROTOCOL=1\n", encoding="utf-8")
    setup.chmod(0o700)
    selection = runtime / "container-runtime"
    selection.write_text("podman\n", encoding="utf-8")
    machine = runtime / "podman-machine"
    machine.write_text("jht-podman\n", encoding="utf-8")
    adapter.write_text(
        """#!/bin/sh
# JHT_PODMAN_DOCKER_SHIM=1
printf 'docker %s\n' "$*" >> "$JHT_TEST_DOCKER_LOG"
case "$1" in
  info) [ "${JHT_TEST_RUNTIME_READY:-0}" = 1 ] || [ -f "$JHT_TEST_RUNTIME_STATE" ] ;;
  inspect)
    if [ "$2:$3" = --type:container ]; then inspect_id="$4"; else inspect_id="$2"; fi
    if [ "$inspect_id" = bbbbbbbbbbbb ] && [ -n "${JHT_TEST_OTHER_RUNNING:-}" ]; then
      # the broker of the same project, running
      case "$*" in
        *'.State.Running}}|{{index'*) printf 'jht-broker|true|jht|jht|jht-broker|jht-broker|1|%s|%s|1.6.0|x|%s\n' "$JHT_RUNTIME_DIR" "$JHT_RUNTIME_DIR/docker-compose.yml" "$JHT_TEST_CONFIG_HASH"; exit 0 ;;
        *'{{.State.Running}}'*) printf 'true\n'; exit 0 ;;
      esac
    fi
    [ "$inspect_id" = aaaaaaaaaaaa ] || exit 91
    case "$*" in
      *'.State.Running}}|{{index'*)
        [ "${JHT_TEST_INSPECT_FAIL:-0}" != 1 ] || exit 93
        if [ -n "${JHT_TEST_INSPECT_DETAILS:-}" ]; then
          printf '%s\n' "$JHT_TEST_INSPECT_DETAILS"
        else
          # config_files as podman-compose writes it: the files given to `-f`, joined by ",".
          running=true
          chash="$JHT_TEST_CONFIG_HASH"
          # a container of an earlier `up` that stopped (the machine was stopped): Exited until `up` starts it again
          if [ -n "${JHT_TEST_EXITED_STATE:-}" ] && [ ! -f "$JHT_TEST_EXITED_STATE" ]; then running=false; fi
          # made by the compose of an earlier version: another config hash, until `up` creates it again
          if [ -n "${JHT_TEST_CONTAINER_HASH:-}" ] && { [ -z "${JHT_TEST_EXITED_STATE:-}" ] || [ ! -f "$JHT_TEST_EXITED_STATE" ]; }; then
            chash="$JHT_TEST_CONTAINER_HASH"
          fi
          printf 'jht|%s|jht|jht|jht|jht|1|%s|%s|1.6.0|podman-compose%sjht.service|%s\n' \
            "$running" "$JHT_RUNTIME_DIR" "${JHT_TEST_CONFIG_FILES:-$JHT_RUNTIME_DIR/docker-compose.yml}" "$(printf '\\100')" "$chash"
        fi
        if [ "${JHT_TEST_STOP_AFTER_INSPECT:-0}" = 1 ]; then : > "$JHT_TEST_CONTAINER_STOPPED"; fi ;;
      *'.State.Running}}'*)
        if [ -f "$JHT_TEST_CONTAINER_STOPPED" ]; then printf 'false\n'; else printf 'true\n'; fi ;;
      *) exit 94 ;;
    esac ;;
  exec)
    shift
    if [ "$1" = -i ] || [ "$1" = -it ]; then shift; fi
    while [ "$1" = -e ]; do shift 2; done
    [ "$1" = aaaaaaaaaaaa ] || exit 95
    shift
    [ ! -f "$JHT_TEST_CONTAINER_STOPPED" ] || exit 96
    case "$1:$2" in
      node:-e)
        # the active provider the wrapper reads from jht.config.json (set, possibly empty)
        if [ -n "${JHT_TEST_ACTIVE_PROVIDER+x}" ]; then printf '%s' "$JHT_TEST_ACTIVE_PROVIDER"; exit 0; fi
        if [ -n "${JHT_TEST_EXPECTED_TEAM:-}" ]; then
          for value in "$@"; do last="$value"; done
          [ "$last" = "$JHT_TEST_EXPECTED_TEAM" ] || exit 72
        fi
        printf '1 1 1' ;;
      codex:*|claude:*|kimi:*) exit 0 ;;   # the provider's own login, which the log records
      tmux:has-session) exit 0 ;;
      test:-f) exit 0 ;;
      node:*)
        # `profile import|validate --stdin`, `artifact upload --stdin`: the file the wrapper handed over, kept for the test that reads it
        case "$3:$4:$5" in profile:import:--stdin|profile:validate:--stdin|artifact:upload:--stdin)
          if [ -n "${JHT_TEST_STDIN_COPY:-}" ]; then cat > "$JHT_TEST_STDIN_COPY"; fi ;;
        esac
        # `ticket open ... --attach-stdin`: the same, with the flag after the ticket text
        if [ "$3:$4" = ticket:open ]; then
          for value in "$@"; do
            if [ "$value" = --attach-stdin ] && [ -n "${JHT_TEST_STDIN_COPY:-}" ]; then cat > "$JHT_TEST_STDIN_COPY"; fi
          done
        fi
        exit 0 ;;
      python3:-I) [ "${JHT_TEST_NO_SCRIPT:-0}" != 1 ] || exit 2; exit 0 ;;   # 2: python3's, no such file
      python3:-c|sh:-c|bash:) exit 0 ;;
      *) exit 97 ;;
    esac ;;
  *) exit 92 ;;
esac
""",
        encoding="utf-8",
    )
    adapter.chmod(0o700)
    podman = binary.parent / "podman"
    podman.write_text(
        """#!/bin/sh
if [ "$1" = --version ]; then printf '%s\n' 'podman version 6.1.3'; exit 0; fi
printf 'podman %s\n' "$*" >> "$JHT_TEST_DOCKER_LOG"
if [ "$1:$2" = machine:list ]; then
  printf '%s true\n' "${JHT_TEST_OTHER_MACHINE:-jht-podman}"
  exit 0
fi
if [ "$1:$2" = machine:start ] && [ -n "${JHT_TEST_OTHER_MACHINE:-}" ]; then
  printf '%s\n' 'Error: only one VM can be active at a time' >&2
  exit 125
fi
if [ "$1:$2" = machine:start ] && [ "${JHT_TEST_WAKE_SUCCESS:-0}" = 1 ]; then
  : > "$JHT_TEST_RUNTIME_STATE"
  exit 0
fi
if [ "$1:$2:$3" = --connection:jht-podman:info ]; then
  [ "${JHT_TEST_RUNTIME_READY:-0}" = 1 ] || [ -f "$JHT_TEST_RUNTIME_STATE" ]
  exit $?
fi
exit 93
""",
        encoding="utf-8",
    )
    podman.chmod(0o700)
    provider = binary.parent / "podman-compose"
    provider.write_text(
        """#!/bin/sh
if [ "$1" = --version ]; then printf '%s\n' 'podman-compose version 1.6.0'; exit 0; fi
printf 'podman-compose %s\n' "$*" >> "$JHT_TEST_DOCKER_LOG"
case "$*" in
  *"--verbose --dry-run --project-name jht"*" up -d --force-recreate jht")
    # podman-compose 1.6.0 prints the create of the dependency first (its own hash), then the service's
    printf 'INFO:podman_compose:podman create --name=jht-telegram --label io.podman.compose.config-hash=%s --label next=value x\n' \
      "$(printf '%064d' 7)" >&2
    printf 'INFO:podman_compose:podman create --name=jht --label io.podman.compose.config-hash=%s --label next=value x\n' \
      "$JHT_TEST_CONFIG_HASH" >&2 ;;
  *" ps -q")
    # podman-compose 1.6.0 lists the project's stopped containers too, as `podman ps -a` does
    if [ -n "${JHT_TEST_EXITED_STATE:-}" ]; then
      # the stopped container is listed until `down` removes it; `up` creates it again
      if [ -f "$JHT_TEST_EXITED_STATE" ] || [ ! -f "${JHT_TEST_DOWN_DONE:-/nonexistent}" ]; then printf '%s\n' aaaaaaaaaaaa; fi
      [ -z "${JHT_TEST_OTHER_RUNNING:-}" ] || printf '%s\n' bbbbbbbbbbbb
    elif [ -n "${JHT_TEST_PS_STATE:-}" ]; then
      [ ! -f "$JHT_TEST_PS_STATE" ] || printf '%s\n' aaaaaaaaaaaa
      true
    else
      printf '%s\n' "${JHT_TEST_PS_IDS-aaaaaaaaaaaa}"
    fi ;;
  *" down")
    [ -z "${JHT_TEST_DOWN_DONE:-}" ] || : > "$JHT_TEST_DOWN_DONE" ;;
  *" up -d")
    [ -z "${JHT_TEST_EXITED_STATE:-}" ] || : > "$JHT_TEST_EXITED_STATE"
    [ -z "${JHT_TEST_PS_STATE:-}" ] || : > "$JHT_TEST_PS_STATE" ;;
  *) exit 90 ;;
esac
""",
        encoding="utf-8",
    )
    provider.chmod(0o700)
    for path in (compose, selection, machine):
        path.chmod(0o600)

    manifest = runtime / ".runtime-integrity"
    manifest.write_text(
        "\n".join(
            (
                "version=1",
                f"docker-compose.yml={_digest(compose)}",
                f"host-setup.sh={_digest(setup)}",
                f"jht-wrapper.sh={_digest(binary)}",
                f"container-runtime={_digest(selection)}",
                f"podman-machine={_digest(machine)}",
                f"docker-shim={_digest(adapter)}",
                "",
            )
        ),
        encoding="utf-8",
    )
    manifest.chmod(0o600)
    env = {
        **os.environ,
        "HOME": str(home),
        "PATH": f"{binary.parent}:/usr/bin:/bin",
        "JHT_RUNTIME_DIR": str(runtime),
        "JHT_WRAPPER_PATH": str(binary),
        "JHT_TEST_DOCKER_LOG": str(log),
        "JHT_TEST_RUNTIME_STATE": str(tmp_path / "runtime-ready"),
        "JHT_TEST_CONTAINER_STOPPED": str(tmp_path / "container-stopped"),
        "JHT_TEST_CONFIG_HASH": "a" * 64,
        "JHT_CONTAINER_NAME": "same-name-decoy",
    }
    write_machine_config(home, env)
    return binary, env, log


def _native_linux_runtime(
    tmp_path: Path, *, rootless: bool = True
) -> tuple[Path, dict[str, str], Path]:
    wrapper, env, log = _runtime(tmp_path)
    runtime = Path(env["JHT_RUNTIME_DIR"])
    binary_dir = wrapper.parent

    # The test runs on every CI host, so expose Linux's uname/stat contract
    # without requiring a nested VM.
    write_linux_host_tools(binary_dir)
    machine = runtime / "podman-machine"
    machine.unlink()
    manifest = runtime / ".runtime-integrity"
    manifest.write_text(
        "\n".join(
            line
            for line in manifest.read_text(encoding="utf-8").splitlines()
            if not line.startswith("podman-machine=")
        )
        + "\n",
        encoding="utf-8",
    )

    podman = binary_dir / "podman"
    # Podman's own rule (podman(1), containers.conf(5)): the client is remote only when
    # CONTAINER_HOST, CONTAINER_CONNECTION, --url/--connection or remote = true in
    # containers.conf turn it on. A default system connection alone leaves it local.
    podman.write_text(
        """#!/bin/sh
printf 'podman %s\n' "$*" >> "$JHT_TEST_DOCKER_LOG"
printf 'podman-env host=%s connection=%s\n' "${CONTAINER_HOST-}" "${CONTAINER_CONNECTION-}" >> "$JHT_TEST_DOCKER_LOG"
if [ "${1:-}" = --version ]; then printf '%s\n' 'podman version 6.1.3'; exit 0; fi
remote=false
if [ -n "${CONTAINER_HOST-}" ] || [ -n "${CONTAINER_CONNECTION-}" ]; then remote=true; fi
if [ -n "${CONTAINERS_CONF-}" ] && grep -Eq '^[[:space:]]*remote[[:space:]]*=[[:space:]]*true' "$CONTAINERS_CONF"; then remote=true; fi
case "$*" in
  *machine*|*--connection*) exit 97 ;;
  "info --format {{.Host.Security.Rootless}} {{.Host.ServiceIsRemote}}")
    printf '%s %s\n' "$JHT_TEST_PODMAN_ROOTLESS" "$remote"
    exit 0 ;;
esac
exit 93
""",
        encoding="utf-8",
    )
    podman.chmod(0o700)

    provider = binary_dir / "podman-compose"
    provider.write_text(
        """#!/bin/sh
if [ "$1" = --version ]; then printf '%s\n' 'podman-compose version 1.6.0'; exit 0; fi
printf 'podman-compose connection=%s argv=%s\n' "${CONTAINER_CONNECTION-}" "$*" >> "$JHT_TEST_DOCKER_LOG"
case "$*" in
  *"--verbose --dry-run --project-name jht"*" up -d --force-recreate jht")
    # podman-compose 1.6.0 prints the create of the dependency first (its own hash), then the service's
    printf 'INFO:podman_compose:podman create --name=jht-telegram --label io.podman.compose.config-hash=%s --label next=value x\n' \
      "$(printf '%064d' 7)" >&2
    printf 'INFO:podman_compose:podman create --name=jht --label io.podman.compose.config-hash=%s --label next=value x\n' \
      "$JHT_TEST_CONFIG_HASH" >&2 ;;
  *" ps -q") printf '%s\n' aaaaaaaaaaaa ;;
  *" up -d") exit 0 ;;
  *) exit 90 ;;
esac
""",
        encoding="utf-8",
    )
    provider.chmod(0o700)
    sudo = binary_dir / "sudo"
    sudo.write_text(
        "#!/bin/sh\nprintf 'sudo %s\\n' \"$*\" >> \"$JHT_TEST_DOCKER_LOG\"\nexit 99\n",
        encoding="utf-8",
    )
    sudo.chmod(0o700)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_PODMAN_ROOTLESS"] = "true" if rootless else "false"
    env["JHT_BIND_OWNER"] = "424242:424242"
    # On native Linux `up` passes the base file and the keep-id override (podman-compose 1.6.0 joins
    # the files it was given with "," in the config_files label): the container the wrapper creates
    # carries both, and the attestation of an existing container expects both.
    env["JHT_TEST_CONFIG_FILES"] = f"{runtime}/docker-compose.yml,{runtime}/docker-compose.podman-linux.yml"
    env["CONTAINER_CONNECTION"] = "user-default-machine"
    return wrapper, env, log


def test_native_linux_podman_up_uses_rootless_local_socket_without_a_machine(
    tmp_path: Path,
):
    wrapper, env, log = _native_linux_runtime(tmp_path)

    result = subprocess.run(
        [str(wrapper), "up"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    calls = log.read_text(encoding="utf-8")
    assert "podman info --format {{.Host.Security.Rootless}} {{.Host.ServiceIsRemote}}" in calls
    assert "podman info\n" not in calls  # the compose check is the same local, rootless probe
    assert "podman-compose connection= argv=" in calls
    assert " up -d" in calls
    assert "machine" not in calls
    assert "--connection" not in calls
    assert "user-default-machine" not in calls
    assert "sudo " not in calls


def test_native_linux_podman_refuses_rootful_before_runtime_mutation(tmp_path: Path):
    wrapper, env, log = _native_linux_runtime(tmp_path, rootless=False)

    result = subprocess.run(
        [str(wrapper), "up"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode != 0
    assert "podman_rootful_refused" in result.stderr
    calls = log.read_text(encoding="utf-8")
    assert "podman info --format {{.Host.Security.Rootless}} {{.Host.ServiceIsRemote}}" in calls
    assert "podman-compose" not in calls
    assert "docker info" not in calls

    source = WRAPPER.read_text(encoding="utf-8")
    assert '[ "$HOST_UID" -ne 0 ] || return 1' in source
    assert "info --format '{{.Host.Security.Rootless}} {{.Host.ServiceIsRemote}}'" in source


def _up(wrapper: Path, env: dict[str, str]) -> subprocess.CompletedProcess:
    return subprocess.run([str(wrapper), "up"], env=env, text=True, capture_output=True, timeout=10, check=False)


def test_native_linux_podman_ignores_a_container_host_of_the_user_and_stays_local(tmp_path: Path):
    wrapper, env, log = _native_linux_runtime(tmp_path)
    env["CONTAINER_HOST"] = "ssh://someone@remotehost.invalid/run/podman/podman.sock"
    result = _up(wrapper, env)
    assert result.returncode == 0, result.stderr
    calls = log.read_text(encoding="utf-8")
    assert "remotehost.invalid" not in calls  # no Podman call saw it
    assert "podman-env host= connection=\n" in calls


def test_native_linux_podman_with_only_a_default_system_connection_stays_local(tmp_path: Path):
    wrapper, env, log = _native_linux_runtime(tmp_path)
    conf = tmp_path / "containers.conf"
    conf.write_text(
        '[engine]\nactive_service = "elsewhere"\n'
        '[engine.service_destinations.elsewhere]\nuri = "ssh://someone@remotehost.invalid/run/podman/podman.sock"\n',
        encoding="utf-8",
    )
    env["CONTAINERS_CONF"] = str(conf)
    result = _up(wrapper, env)
    assert result.returncode == 0, result.stderr
    assert " up -d" in log.read_text(encoding="utf-8")


def test_native_linux_podman_refuses_a_client_in_remote_mode_before_runtime_mutation(tmp_path: Path):
    wrapper, env, log = _native_linux_runtime(tmp_path)
    conf = tmp_path / "containers.conf"
    conf.write_text('[engine]\nremote = true\nactive_service = "elsewhere"\n', encoding="utf-8")
    env["CONTAINERS_CONF"] = str(conf)
    result = _up(wrapper, env)
    assert result.returncode != 0
    assert "podman_remote_service_refused" in result.stderr
    assert "podman_rootful_refused" not in result.stderr
    calls = log.read_text(encoding="utf-8")
    assert "podman-compose" not in calls
    assert "docker info" not in calls


def test_desktop_chat_uses_private_podman_and_exact_compose_container(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"

    result = subprocess.run(
        [str(wrapper), "desktop-chat", "probe"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout == "true\n"
    calls = log.read_text(encoding="utf-8")
    assert "podman-compose --podman-path " in calls
    compose_calls = [line for line in calls.splitlines() if line.startswith("podman-compose ")]
    assert all("--podman-args" not in line and "--connection" not in line for line in compose_calls)
    assert "podman --connection jht-podman info" in calls
    assert " ps -q" in calls and " ps -q jht" not in calls
    assert "docker inspect --type container aaaaaaaaaaaa" in calls
    assert "inspect jht" not in calls
    assert "same-name-decoy" not in calls
    assert not any(
        " up " in line and "--dry-run" not in line for line in calls.splitlines()
    )
    assert "machine start" not in calls


SCRIPT = "python3 -I /app/shared/skills/agent_chat.py"


@pytest.mark.parametrize(
    ("args", "expected"),
    (
        (("read", "capitano"), f"docker exec -i aaaaaaaaaaaa {SCRIPT} read capitano"),
        (("read", "mentor", "4096"), f"docker exec -i aaaaaaaaaaaa {SCRIPT} read mentor 4096"),
        (("chat-send", "assistente", "0b1c2d3e-4f50"), f"docker exec -i aaaaaaaaaaaa {SCRIPT} send assistente 0b1c2d3e-4f50"),
        (("chat-answer", "capitano", "aq:capitano:1792700000-a1b2c3"),
         f"docker exec -i aaaaaaaaaaaa {SCRIPT} answer capitano aq:capitano:1792700000-a1b2c3"),
        (("chat-enter", "mentor", "0b1c2d3e-4f50"), f"docker exec -i aaaaaaaaaaaa {SCRIPT} enter mentor 0b1c2d3e-4f50"),
    ),
)
def test_the_chat_actions_run_the_one_script_of_the_container_with_the_arguments_given(
    tmp_path: Path, args: tuple, expected: str
):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    done = subprocess.run(
        [str(wrapper), "desktop-chat", *args], env=env, input="ciao", text=True, capture_output=True, timeout=10, check=False
    )
    assert done.returncode == 0, done.stderr
    calls = log.read_text(encoding="utf-8").splitlines()
    assert [line for line in calls if "agent_chat.py" in line] == [expected], "one call, nothing else typed"
    assert not any("jht-tmux-send" in line or "python3 -c" in line for line in calls)


@pytest.mark.parametrize(
    "args",
    (
        ("read",),
        ("read", "capitano", "1", "2"),
        ("chat-send",),
        ("chat-send", "capitano"),
        ("chat-send", "capitano", "id", "extra"),
        ("chat-answer", "capitano"),
        ("chat-answer", "capitano", "q1", "extra"),
        ("chat-enter", "capitano"),
        ("chat-enter", "capitano", "m1", "extra"),
        ("write", "capitano", "id"),
    ),
)
def test_a_chat_action_with_the_wrong_arguments_answers_2_and_runs_no_script(tmp_path: Path, args: tuple):
    # 2 is what an older wrapper answers to any action it does not know: the app takes it
    # for «keep the older actions», so a malformed ask must never look like anything else.
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    done = subprocess.run(
        [str(wrapper), "desktop-chat", *args], env=env, input="ciao", text=True, capture_output=True, timeout=10, check=False
    )
    assert done.returncode == 2, done.stderr
    assert "agent_chat.py" not in log.read_text(encoding="utf-8")


def test_the_wrapper_with_the_chat_actions_says_so_by_a_marker_the_app_asks_for_first():
    text = WRAPPER.read_text(encoding="utf-8")
    lines = text.splitlines()
    assert lines.count("JHT_DESKTOP_CHAT_FIXED=1") == 1, "one marker, on a line of its own, as the app greps it"
    # the marker and the actions go together: a wrapper without one has no other
    assert "    chat-send)" in text and "    read)" in text
    # answer and enter have their own marker, with the same rule
    assert lines.count("JHT_DESKTOP_CHAT_ANSWER=1") == 1
    assert "    chat-answer)" in text and "    chat-enter)" in text


def test_an_image_without_the_script_gives_the_scripts_own_2_and_the_wrapper_does_not_turn_it_into_anything(tmp_path: Path):
    # python3 answers 2 for a missing file. That 2 must reach the app as «the image is older than the chat»
    # (it never means «this wrapper has no chat actions»: that is told by the marker, and answered 64).
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_NO_SCRIPT"] = "1"
    for args in (("read", "capitano"), ("chat-send", "capitano", "id-1"), ("chat-answer", "capitano", "q1"), ("chat-enter", "capitano", "m1")):
        done = subprocess.run(
            [str(wrapper), "desktop-chat", *args], env=env, input="ciao", text=True, capture_output=True, timeout=10, check=False
        )
        assert done.returncode == 2, (args, done.stderr)
    assert "JHT_DESKTOP_CHAT_FIXED=1" in wrapper.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    ("argv", "operation"),
    (
        (("logs", "--tail", "1"), "docker logs"),
        (("status",), "docker inspect aaaaaaaaaaaa --format"),
        (("shell",), "docker exec"),
        (("oauth-login",), "docker exec"),
        (("--version",), "docker exec"),
        (("--help",), "docker exec"),
        (("setup", "--non-interactive"), "docker exec"),
        (("download", "--os", "macos"), "docker exec"),
        (("providers", "current"), "docker exec"),
        (("providers", "limits", "--json"), "docker exec"),
    ),
)
def test_host_dispatcher_reuses_only_the_attested_container_id(
    tmp_path: Path, argv: tuple[str, ...], operation: str
):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"

    subprocess.run(
        [str(wrapper), *argv],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    calls = log.read_text(encoding="utf-8").splitlines()
    ownership_index = next(
        index
        for index, line in enumerate(calls)
        if line.startswith("docker inspect --type container aaaaaaaaaaaa ")
    )
    operation_index = next(
        index
        for index, line in enumerate(calls)
        if index > ownership_index
        and line.startswith(operation)
        and "aaaaaaaaaaaa" in line
    )
    assert ownership_index < operation_index
    assert all("same-name-decoy" not in line for line in calls)


def test_attested_container_disappearing_never_falls_back_to_a_name(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_STOP_AFTER_INSPECT"] = "1"

    result = subprocess.run(
        [str(wrapper), "shell"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode != 0
    calls = log.read_text(encoding="utf-8").splitlines()
    assert any("docker exec -i aaaaaaaaaaaa bash" in line for line in calls)
    assert all(
        "same-name-decoy" not in line and " exec jht " not in line for line in calls
    )


def test_desktop_chat_fails_closed_when_private_podman_is_not_ready(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "0"

    result = subprocess.run(
        [str(wrapper), "desktop-chat", "probe"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode != 0
    assert "runtime o container JHT non disponibile" in result.stderr
    calls = log.read_text(encoding="utf-8")
    assert calls.strip() == "docker info"
    assert "machine" not in calls and "compose" not in calls and "inspect" not in calls


def test_status_leaves_an_unreachable_podman_machine_stopped(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "0"

    result = subprocess.run(
        [str(wrapper), "status"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode != 0
    assert "non attivo" in result.stdout
    calls = log.read_text(encoding="utf-8")
    assert calls.strip() == "docker info"
    assert "machine" not in calls and "podman-compose" not in calls


def test_explicit_up_uses_the_same_named_podman_compose_adapter_idempotently(
    tmp_path: Path,
):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"

    results = [
        subprocess.run(
            [str(wrapper), "up"],
            env=env,
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        for _ in range(2)
    ]

    assert all(result.returncode == 0 for result in results), [
        result.stderr for result in results
    ]
    calls = log.read_text(encoding="utf-8").splitlines()
    compose_calls = [line for line in calls if line.startswith("podman-compose ")]
    action_calls = [line for line in compose_calls if line.endswith(" up -d")]
    assert len(action_calls) == 2
    assert action_calls[0] == action_calls[1]
    assert all(
        " -p jht " in line or " --project-name jht " in line
        for line in compose_calls
    )
    assert all("--podman-args" not in line for line in compose_calls)
    assert not any("machine start" in line or "machine init" in line for line in calls)


def test_up_goes_on_when_the_container_of_an_earlier_up_is_there_but_stopped(tmp_path: Path):
    # The machine was stopped (a restart of the Mac, an app update): podman-compose lists the team's
    # containers as Exited. They are ours, attested by every label: `up` starts them, it does not refuse.
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_EXITED_STATE"] = str(tmp_path / "container-started")

    result = subprocess.run([str(wrapper), "up"], env=env, text=True, capture_output=True, timeout=20, check=False)

    assert result.returncode == 0, result.stderr
    assert "non attestabile" not in result.stderr
    calls = log.read_text(encoding="utf-8").splitlines()
    assert len([line for line in calls if line.startswith("podman-compose ") and line.endswith(" up -d")]) == 1


def test_status_says_a_stopped_container_is_not_running_and_does_not_call_it_unattestable(tmp_path: Path):
    wrapper, env, _ = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_EXITED_STATE"] = str(tmp_path / "container-never-started")

    result = subprocess.run([str(wrapper), "status"], env=env, text=True, capture_output=True, timeout=20, check=False)

    assert result.returncode == 1
    assert "non attivo" in result.stdout + result.stderr and "non attestabile" not in result.stdout + result.stderr


def _stale_stopped(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_EXITED_STATE"] = str(tmp_path / "container-started")
    env["JHT_TEST_DOWN_DONE"] = str(tmp_path / "down-done")
    # the containers of the version before: stopped, ours, made by a compose whose hash was another one
    env["JHT_TEST_CONTAINER_HASH"] = "b" * 64
    # `ps` lists it, its Running is false: the plain inspect answers from this file
    Path(env["JHT_TEST_CONTAINER_STOPPED"]).write_text("", encoding="utf-8")
    return wrapper, env, log


def test_up_recreates_the_stopped_containers_of_the_version_before_and_keeps_the_volumes(tmp_path: Path):
    wrapper, env, log = _stale_stopped(tmp_path)

    result = subprocess.run([str(wrapper), "up"], env=env, text=True, capture_output=True, timeout=20, check=False)

    assert result.returncode == 0, result.stderr
    assert "config_changed_stopped" in result.stderr and "i volumi con i dati restano" in result.stderr
    calls = [line for line in log.read_text(encoding="utf-8").splitlines() if line.startswith("podman-compose ")]
    down = next(i for i, line in enumerate(calls) if line.endswith(" down"))
    up = next(i for i, line in enumerate(calls) if line.endswith(" up -d"))
    assert down < up
    # containers and network only: no option of `down` can remove the volumes
    assert not any(" down " in line + " " and ("-v" in line.split() or "--volumes" in line.split()) for line in calls)


def test_up_does_not_recreate_when_another_container_of_the_project_runs(tmp_path: Path):
    wrapper, env, log = _stale_stopped(tmp_path)
    env["JHT_TEST_OTHER_RUNNING"] = "1"   # the broker is up while the team's container is stopped

    result = subprocess.run([str(wrapper), "up"], env=env, text=True, capture_output=True, timeout=20, check=False)

    assert result.returncode == 1
    assert "jht down" in result.stderr
    calls = log.read_text(encoding="utf-8").splitlines()
    assert not any(line.startswith("podman-compose ") and (line.endswith(" down") or line.endswith(" up -d")) for line in calls)


def test_up_does_not_touch_a_running_container_of_the_version_before(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_CONTAINER_HASH"] = "b" * 64   # running, with the hash of the earlier compose

    result = subprocess.run([str(wrapper), "up"], env=env, text=True, capture_output=True, timeout=20, check=False)

    assert result.returncode == 1
    assert "non attestabile" in result.stderr and "jht down" in result.stderr
    calls = log.read_text(encoding="utf-8").splitlines()
    assert not any(line.startswith("podman-compose ") and (line.endswith(" down") or line.endswith(" up -d")) for line in calls)


def test_down_removes_the_stopped_containers_of_the_version_before(tmp_path: Path):
    wrapper, env, log = _stale_stopped(tmp_path)

    result = subprocess.run([str(wrapper), "down"], env=env, text=True, capture_output=True, timeout=20, check=False)

    assert result.returncode == 0, result.stderr
    calls = log.read_text(encoding="utf-8").splitlines()
    assert any(line.startswith("podman-compose ") and line.endswith(" down") for line in calls)


def test_a_stopped_container_that_is_not_ours_still_stops_up(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_EXITED_STATE"] = str(tmp_path / "container-started")
    # another project's container under the same service name: not attested, not touched
    env["JHT_TEST_INSPECT_DETAILS"] = (
        f"jht|false|someone-else|someone-else|jht|jht|1|{env['JHT_RUNTIME_DIR']}|"
        f"{env['JHT_RUNTIME_DIR']}/docker-compose.yml|1.6.0|podman-compose{chr(64)}someone-else.service|{'a' * 64}"
    )

    result = subprocess.run([str(wrapper), "up"], env=env, text=True, capture_output=True, timeout=20, check=False)

    assert result.returncode == 1
    assert "non attestabile" in result.stderr
    calls = log.read_text(encoding="utf-8").splitlines()
    assert not any(line.startswith("podman-compose ") and line.endswith(" up -d") for line in calls)


def test_explicit_up_allows_zero_ids_then_verifies_the_created_container(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_PS_STATE"] = str(tmp_path / "container-created")

    result = subprocess.run(
        [str(wrapper), "up"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    calls = log.read_text(encoding="utf-8").splitlines()
    ps_calls = [line for line in calls if line.startswith("podman-compose ") and " ps -q" in line]
    action_calls = [line for line in calls if line.startswith("podman-compose ") and line.endswith(" up -d")]
    # The check before `up` and the one after it, then the agent and broker
    # lookups that hand the broker its web authorisations.
    assert len(ps_calls) == 4
    assert len(action_calls) == 1
    assert " -p jht " in action_calls[0]
    assert not any("machine start" in line or " create" in line for line in calls)


def test_podman_compose_1_6_uses_podman_6_named_connection_before_subcommand(
    tmp_path: Path,
):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["CONTAINER_CONNECTION"] = "external-default"
    podman = wrapper.parent / "podman"
    podman.write_text(
        """#!/bin/sh
if [ "$1" = --version ]; then printf '%s\n' 'podman version 6.1.3'; exit 0; fi
printf 'podman-6.1.3 connection=%s argv=%s\n' "$CONTAINER_CONNECTION" "$*" >> "$JHT_TEST_DOCKER_LOG"
[ "$1:$2:$3" = --connection:jht-podman:info ] && exit 0
case "$1" in
  ps)
    [ "$CONTAINER_CONNECTION" = jht-podman ] || exit 124
    case " $* " in *" --connection "*) exit 125 ;; esac
    exit 0 ;;
  *) exit 126 ;;
esac
""",
        encoding="utf-8",
    )
    podman.chmod(0o700)
    provider = wrapper.parent / "podman-compose"
    provider.write_text(
        """#!/bin/sh
if [ "$1" = --version ]; then printf '%s\n' 'podman-compose version 1.6.0'; exit 0; fi
printf 'podman-compose-1.6.0 connection=%s argv=%s\n' "$CONTAINER_CONNECTION" "$*" >> "$JHT_TEST_DOCKER_LOG"
case "$*" in
  "--verbose --dry-run --project-name jht "*" up -d --force-recreate jht")
    printf '%s\n' 'INFO:podman_compose:podman create --name=jht --label io.podman.compose.config-hash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --label next=value x' >&2
    exit 0 ;;
esac
[ "$1" = --podman-path ] || exit 120
podman_path="$2"
shift 2
[ "$1:$2" = -p:jht ] || exit 119
shift 2
[ "$1" = -f ] || exit 121
shift 2
case "$*" in
  "ps -q") printf '%s\n' aaaaaaaaaaaa ;;
  "up -d")
    "$podman_path" ps -a --filter label=io.podman.compose.project=jht --format '{{.ID}}' ;;
  *) exit 122 ;;
esac
""",
        encoding="utf-8",
    )
    provider.chmod(0o700)

    result = subprocess.run(
        [str(wrapper), "up"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    calls = log.read_text(encoding="utf-8").splitlines()
    assert "podman-6.1.3 connection= argv=--connection jht-podman info" in calls
    assert any(
        line.startswith("podman-compose-1.6.0 connection=jht-podman argv=--podman-path ")
        for line in calls
    )
    assert (
        "podman-6.1.3 connection=jht-podman "
        "argv=ps -a --filter label=io.podman.compose.project=jht --format {{.ID}}"
    ) in calls
    assert not any("argv=ps --connection" in line for line in calls)


@pytest.mark.parametrize("machine_name", ("", "invalid/name"))
def test_podman_machine_marker_must_be_present_and_valid_before_any_runtime_io(
    tmp_path: Path, machine_name: str
):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    marker = Path(env["JHT_RUNTIME_DIR"]) / "podman-machine"
    marker.write_text(f"{machine_name}\n", encoding="utf-8")
    manifest = Path(env["JHT_RUNTIME_DIR"]) / ".runtime-integrity"
    manifest.write_text(
        "\n".join(
            f"podman-machine={_digest(marker)}"
            if line.startswith("podman-machine=")
            else line
            for line in manifest.read_text(encoding="utf-8").splitlines()
        )
        + "\n",
        encoding="utf-8",
    )

    result = subprocess.run(
        [str(wrapper), "up"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode != 0
    assert "runtime host non attendibile" in result.stderr
    assert not log.exists()


def test_only_explicit_up_can_wake_the_named_podman_machine(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "0"
    env["JHT_TEST_WAKE_SUCCESS"] = "1"

    result = subprocess.run(
        [str(wrapper), "up"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    calls = log.read_text(encoding="utf-8")
    assert "podman machine start --update-connection=false jht-podman" in calls
    assert calls.count("docker info") >= 2
    assert "podman-compose " in calls and " up -d" in calls

    source = WRAPPER.read_text(encoding="utf-8")
    assert source.count("wake_container_runtime_for_up") == 2
    up_arm = source[source.index("  up)\n") : source.index("  start-container)\n")]
    assert "wake_container_runtime_for_up" in up_arm


def test_explicit_up_names_the_other_running_machine_without_stopping_it(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "0"
    env["JHT_TEST_OTHER_MACHINE"] = "personal-work"

    result = subprocess.run(
        [str(wrapper), "up"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 79
    assert result.stdout == "JHT_OTHER_MACHINE personal-work\n"
    assert "podman_other_machine_running" in result.stderr
    assert "personal-work" in result.stderr
    assert "podman machine stop personal-work" in result.stderr
    calls = log.read_text(encoding="utf-8")
    assert "podman machine list --format {{.Name}} {{.Running}}" in calls
    assert "machine stop" not in calls


def test_onboarding_snapshot_is_one_read_only_dispatcher_operation(tmp_path: Path):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"

    result = subprocess.run(
        [str(wrapper), "onboarding-snapshot"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "containerRunning=1" in result.stdout
    assert "providerConfigured=1" in result.stdout
    assert "assistantRunning=1" in result.stdout
    calls = log.read_text(encoding="utf-8")
    assert "podman-compose " in calls and " ps -q" in calls
    assert " ps -q jht" not in calls
    assert not any(
        " up " in line and "--dry-run" not in line for line in calls.splitlines()
    )
    assert "machine start" not in calls


def test_existing_team_snapshot_checks_the_stdin_identity_inside_the_wrapper(
    tmp_path: Path,
):
    wrapper, env, _ = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_EXPECTED_TEAM"] = "00000000-0000-4000-8000-000000000001"

    matching = subprocess.run(
        [str(wrapper), "onboarding-snapshot", "--expect-team-stdin"],
        env=env,
        input=f'{env["JHT_TEST_EXPECTED_TEAM"]}\n',
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )
    mismatch = subprocess.run(
        [str(wrapper), "onboarding-snapshot", "--expect-team-stdin"],
        env=env,
        input="00000000-0000-4000-8000-000000000002\n",
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert matching.returncode == 0, matching.stderr
    assert "containerRunning=1" in matching.stdout
    assert mismatch.returncode == 72


def test_onboarding_snapshot_never_auto_ups_when_container_stops_mid_probe(
    tmp_path: Path,
):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_TEST_STOP_AFTER_INSPECT"] = "1"

    result = subprocess.run(
        [str(wrapper), "onboarding-snapshot"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "runtimeInstalled=1" in result.stdout
    assert "containerRunning=0" in result.stdout
    assert "assistantRunning=0" in result.stdout
    calls = log.read_text(encoding="utf-8")
    assert not any(
        " up " in line and "--dry-run" not in line for line in calls.splitlines()
    )
    assert "machine start" not in calls and "machine init" not in calls


@pytest.mark.parametrize("argv", (("onboarding-snapshot",),))
@pytest.mark.parametrize(
    "failure",
    (
        "zero-ids",
        "multiple-ids",
        "wrong-name",
        "wrong-io-project",
        "wrong-com-project",
        "wrong-io-service",
        "wrong-com-service",
        "wrong-container-number",
        "wrong-working-dir",
        "wrong-config",
        "wrong-provider-version",
        "wrong-systemd-unit",
        "wrong-config-hash",
        "stale",
        "inspect-error",
    ),
)
def test_read_only_consumers_reject_unowned_or_ambiguous_compose_results(
    tmp_path: Path, argv: tuple[str, ...], failure: str
):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    runtime = Path(env["JHT_RUNTIME_DIR"])
    expected_hash = env["JHT_TEST_CONFIG_HASH"]
    expected = (
        f"jht|true|jht|jht|jht|jht|1|{runtime}|"
        f"{runtime / 'docker-compose.yml'}|1.6.0|{PODMAN_SYSTEMD_UNIT}|"
        f"{expected_hash}"
    )
    if failure == "zero-ids":
        env["JHT_TEST_PS_IDS"] = ""
    elif failure == "multiple-ids":
        env["JHT_TEST_PS_IDS"] = "aaaaaaaaaaaa\nbbbbbbbbbbbb"
    elif failure == "inspect-error":
        env["JHT_TEST_INSPECT_FAIL"] = "1"
    else:
        replacements = {
            "wrong-name": expected.replace("jht|true|", "foreign|true|", 1),
            "wrong-io-project": expected.replace(
                "|jht|jht|jht|jht|", "|foreign|jht|jht|jht|", 1
            ),
            "wrong-com-project": expected.replace(
                "|jht|jht|jht|jht|", "|jht|foreign|jht|jht|", 1
            ),
            "wrong-io-service": expected.replace("|jht|jht|1|", "|other|jht|1|", 1),
            "wrong-com-service": expected.replace("|jht|jht|1|", "|jht|other|1|", 1),
            "wrong-container-number": expected.replace(
                f"|1|{runtime}|", f"|2|{runtime}|", 1
            ),
            "wrong-working-dir": expected.replace(f"|{runtime}|", "|/foreign|", 1),
            "wrong-config": expected.replace(
                f"|{runtime / 'docker-compose.yml'}|", "|/foreign/compose.yml|", 1
            ),
            "wrong-provider-version": expected.replace("|1.6.0|", "|1.7.0|", 1),
            "wrong-systemd-unit": expected.replace(
                PODMAN_SYSTEMD_UNIT,
                "podman-compose" + chr(64) + "foreign.service",
                1,
            ),
            "wrong-config-hash": expected.replace(expected_hash, "b" * 64, 1),
            "stale": expected.replace("jht|true|", "jht|false|", 1),
        }
        env["JHT_TEST_INSPECT_DETAILS"] = replacements[failure]

    result = subprocess.run(
        [str(wrapper), *argv],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    if argv[0] == "onboarding-snapshot":
        assert result.returncode == 0
        assert "runtimeInstalled=1" in result.stdout
        assert "containerRunning=0" in result.stdout
    else:
        assert result.returncode != 0
    calls = log.read_text(encoding="utf-8")
    assert " ps -q" in calls and " ps -q jht" not in calls
    assert not any(
        (" up " in line and "--dry-run" not in line) or " create" in line
        for line in calls.splitlines()
    )
    assert "machine start" not in calls and "machine init" not in calls

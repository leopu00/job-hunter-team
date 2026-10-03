"""The desktop chat bridge stays inside the attested JHT Podman runtime."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess

import pytest


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
    [ "$inspect_id" = aaaaaaaaaaaa ] || exit 91
    case "$*" in
      *'.State.Running}}|{{index'*)
        [ "${JHT_TEST_INSPECT_FAIL:-0}" != 1 ] || exit 93
        if [ -n "${JHT_TEST_INSPECT_DETAILS:-}" ]; then
          printf '%s\n' "$JHT_TEST_INSPECT_DETAILS"
        else
          printf 'jht|true|jht|jht|jht|jht|1|%s|%s/docker-compose.yml|1.6.0|podman-compose%sjht.service|%s\n' \
            "$JHT_RUNTIME_DIR" "$JHT_RUNTIME_DIR" "$(printf '\\100')" "$JHT_TEST_CONFIG_HASH"
        fi
        if [ "${JHT_TEST_STOP_AFTER_INSPECT:-0}" = 1 ]; then : > "$JHT_TEST_CONTAINER_STOPPED"; fi ;;
      *'.State.Running}}'*)
        if [ -f "$JHT_TEST_CONTAINER_STOPPED" ]; then printf 'false\n'; else printf 'true\n'; fi ;;
      *) exit 94 ;;
    esac ;;
  exec)
    if [ "$2" = -i ]; then [ "$3" = aaaaaaaaaaaa ]; exit; fi
    [ "$2" = aaaaaaaaaaaa ] || exit 95
    [ ! -f "$JHT_TEST_CONTAINER_STOPPED" ] || exit 96
    case "$3:$4" in
      node:-e) printf '1 1 1' ;;
      tmux:has-session) exit 0 ;;
      test:-f) exit 0 ;;
      node:*) exit 0 ;;
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
    printf 'INFO --label io.podman.compose.config-hash=%s --label next=value\n' \
      "$JHT_TEST_CONFIG_HASH" >&2 ;;
  *" ps -q")
    if [ -n "${JHT_TEST_PS_STATE:-}" ]; then
      [ ! -f "$JHT_TEST_PS_STATE" ] || printf '%s\n' aaaaaaaaaaaa
      true
    else
      printf '%s\n' "${JHT_TEST_PS_IDS-aaaaaaaaaaaa}"
    fi ;;
  *" up -d")
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
    return binary, env, log


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
    assert len(ps_calls) == 2
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
    printf '%s\n' 'INFO --label io.podman.compose.config-hash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --label next=value' >&2
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


def test_podman_compose_fails_closed_when_named_connection_capability_fails(
    tmp_path: Path,
):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    podman = wrapper.parent / "podman"
    podman.write_text(
        """#!/bin/sh
if [ "$1" = --version ]; then printf '%s\n' 'podman version 6.1.3'; exit 0; fi
printf 'podman-capability connection=%s argv=%s\n' "$CONTAINER_CONNECTION" "$*" >> "$JHT_TEST_DOCKER_LOG"
exit 125
""",
        encoding="utf-8",
    )
    podman.chmod(0o700)

    result = subprocess.run(
        [str(wrapper), "up"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode != 0
    assert "non attestabile" in result.stderr
    calls = log.read_text(encoding="utf-8")
    assert "podman-capability connection= argv=--connection jht-podman info" in calls
    assert "podman-compose " not in calls


@pytest.mark.parametrize("component", ("podman", "podman-compose"))
def test_podman_compose_fails_closed_on_unpinned_version(
    tmp_path: Path, component: str
):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    binary = wrapper.parent / component
    expected = "podman version 6.2.0" if component == "podman" else "podman-compose version 1.7.0"
    binary.write_text(
        f"#!/bin/sh\nif [ \"$1\" = --version ]; then printf '%s\\n' '{expected}'; exit 0; fi\n"
        f"printf '{component}-unexpected %s\\n' \"$*\" >> \"$JHT_TEST_DOCKER_LOG\"\nexit 125\n",
        encoding="utf-8",
    )
    binary.chmod(0o700)

    result = subprocess.run(
        [str(wrapper), "up"],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode != 0
    assert "non attestabile" in result.stderr
    calls = log.read_text(encoding="utf-8")
    assert "podman-compose " not in calls
    assert "-unexpected" not in calls


@pytest.mark.parametrize(
    "argv",
    (("up",), ("desktop-chat", "probe"), ("upgrade", "--check")),
)
def test_podman_machine_override_must_match_attested_marker_before_any_runtime_io(
    tmp_path: Path, argv: tuple[str, ...]
):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    env["JHT_PODMAN_MACHINE"] = "other-machine"
    env["CONTAINER_CONNECTION"] = "external-default"

    result = subprocess.run(
        [str(wrapper), *argv],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )

    assert result.returncode != 0
    assert result.stderr
    assert not log.exists()


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


@pytest.mark.parametrize("argv", (("desktop-chat", "probe"), ("onboarding-snapshot",)))
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


@pytest.mark.parametrize(
    "details",
    (
        "foreign|true|jht|jht|jht|jht|1|{runtime}|{compose}|1.6.0|{unit}|{hash}",
        "jht|true|foreign|jht|jht|jht|1|{runtime}|{compose}|1.6.0|{unit}|{hash}",
        "jht|true|jht|jht|jht|jht|1|{runtime}|{compose}|1.6.0|{unit}|{wrong_hash}",
        "jht|false|jht|jht|jht|jht|1|{runtime}|{compose}|1.6.0|{unit}|{hash}",
    ),
)
def test_explicit_up_rejects_unowned_container_before_mutation(
    tmp_path: Path, details: str
):
    wrapper, env, log = _runtime(tmp_path)
    env["JHT_TEST_RUNTIME_READY"] = "1"
    runtime = Path(env["JHT_RUNTIME_DIR"])
    env["JHT_TEST_INSPECT_DETAILS"] = details.format(
        runtime=runtime,
        compose=runtime / "docker-compose.yml",
        unit=PODMAN_SYSTEMD_UNIT,
        hash=env["JHT_TEST_CONFIG_HASH"],
        wrong_hash="b" * 64,
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
    calls = log.read_text(encoding="utf-8").splitlines()
    assert not any(
        line.startswith("podman-compose ")
        and line.endswith(" up -d")
        and "--dry-run" not in line
        for line in calls
    )
    assert not any("machine start" in line or " create" in line for line in calls)

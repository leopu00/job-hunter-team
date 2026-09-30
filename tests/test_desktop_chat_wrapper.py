"""The desktop chat bridge stays inside the attested JHT Podman runtime."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"


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
printf '%s\n' "$*" >> "$JHT_TEST_DOCKER_LOG"
case "$1" in
  info) [ "${JHT_TEST_RUNTIME_READY:-0}" = 1 ] ;;
  compose)
    case "$*" in *" ps -q jht") printf '%s\n' aaaaaaaaaaaa ;; *) exit 90 ;; esac ;;
  inspect)
    [ "$2" = aaaaaaaaaaaa ] || exit 91
    printf 'true jht\n' ;;
  exec) [ "$2" = -i ] && [ "$3" = aaaaaaaaaaaa ] ;;
  *) exit 92 ;;
esac
""",
        encoding="utf-8",
    )
    adapter.chmod(0o700)
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
        "PATH": "/usr/bin:/bin",
        "JHT_RUNTIME_DIR": str(runtime),
        "JHT_WRAPPER_PATH": str(binary),
        "JHT_TEST_DOCKER_LOG": str(log),
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
    assert "compose -f " in calls and " ps -q jht" in calls
    assert "inspect aaaaaaaaaaaa" in calls
    assert "inspect jht" not in calls
    assert "same-name-decoy" not in calls
    assert " up" not in calls and "machine start" not in calls


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
    assert calls.strip() == "info"
    assert "machine" not in calls and "compose" not in calls and "inspect" not in calls

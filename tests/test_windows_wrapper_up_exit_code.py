"""A `jht up` that went well exits 0 on Windows, also when the broker's migration found nothing to move (T89).

The first `up` with the broker runs the migration of the old secrets: for every name it asks the agents'
container `legacy.py exists <name>`, which exits 1 when there is nothing. The migration itself returns 0,
but the wrapper ended its `up` and `recreate` branches with `break` and the script with
`exit $LASTEXITCODE`: the 1 of the last `exists` became the exit code of a start that went well. The
setup reads that code (enable-podman-windows-runtime.ps1, «The migrated JHT container did not start.»)
and stopped there on every new install, with the three containers Up (hand test of T87 with the real
Podman, 23/10).

The wrapper runs here as it is, `up` and `recreate` branches and its last line included. Only the steps
before compose are replaced, right before the dispatcher (the ACL of ~/.jht, the image attestation,
the mount repair, the Telegram inventory); `docker` is a fake that answers `legacy.py exists` with 1.
A compose up that fails keeps its own code (compose_up_failed). On Windows the fake is a native
program and the shell is the one JHT_TEST_SHELL names (tests/windows_native_fakes.py).
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, install_fake, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
ACL_HELPER = ROOT / "scripts" / "windows-private-acl.ps1"
DISPATCHER = "switch ($Sub) {\n"

# What runs before compose touches the person's machine or a real image: it is replaced, the rest is
# the wrapper's own. Invoke-Compose still calls docker, so $LASTEXITCODE is the fake's, as it would be.
STEPS_BEFORE_COMPOSE = r"""
function Require-ComposeFile { }
function Require-Docker { }
function Start-PodmanMachineForUp { }
function Repair-MountOwnership { return $true }
function Initialize-TelegramLegacyInventory { return $true }
function Invoke-Compose { & docker compose @args }
function Get-RunningComposeServiceId {
  param([string]$Service)
  if ($Service -eq 'jht') { return 'aaaaaaaaaaaa' }
  return 'bbbbbbbbbbbb'
}
"""

FAKE_DOCKER = r"""#!/bin/sh
echo "$*" >> "$FAKE_LOG"
case "$*" in
  "compose up -d"*) exit "${FAKE_COMPOSE_UP:-0}" ;;
  *"legacy.py exists "*) exit 1 ;;
esac
exit 0
"""


def _wrapper_under_test(folder: Path) -> Path:
    text = WRAPPER.read_text(encoding="utf-8").replace("\r\n", "\n")     # a checkout with CRLF too
    assert text.count(DISPATCHER) == 1, "the dispatcher of jht-wrapper.ps1 moved"
    folder.mkdir()
    shutil.copyfile(ACL_HELPER, folder / ACL_HELPER.name)          # dot-sourced from $PSScriptRoot
    script = folder / "jht.ps1"
    script.write_text(text.replace(DISPATCHER, STEPS_BEFORE_COMPOSE + ENGINE_CHECK + DISPATCHER),
                      encoding="utf-8-sig")
    return script


def _run(tmp_path: Path, command: str, compose_up: int = 0):
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "docker-compose.yml").write_text(
        "services:\n  jht:\n    image: x\n  jht-broker:\n    image: x\n  jht-telegram:\n    image: x\n",
        encoding="utf-8")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    install_fake(bin_dir, "docker.exe" if WINDOWS else "docker", FAKE_DOCKER)
    log, engine = tmp_path / "docker.log", tmp_path / "engine.txt"
    profile = tmp_path / "user"
    base = windows_env(tmp_path) if WINDOWS else {
        **os.environ, "USERPROFILE": str(profile), "APPDATA": str(profile / "AppData" / "Roaming"),
        "LOCALAPPDATA": str(profile / "AppData" / "Local"),
    }
    env = {
        **base,
        "PATH": str(bin_dir) if WINDOWS else f"{bin_dir}{os.pathsep}/usr/bin{os.pathsep}/bin",
        "HOME": base["USERPROFILE"],
        "JHT_CONTAINER_RUNTIME": "docker",
        "JHT_RUNTIME_DIR": str(runtime),
        "JHT_COMPOSE_FILE": str(runtime / "docker-compose.yml"),
        "JHT_HOST_ENV_FILE": str(tmp_path / "no-host.env"),
        "JHT_ENGINE_FILE": str(engine),
        "FAKE_LOG": str(log),
        "FAKE_COMPOSE_UP": str(compose_up),
    }
    done = subprocess.run([*powershell_argv(), "-File", str(_wrapper_under_test(tmp_path / "wrapper")), command],
                          env=env, capture_output=True, text=True, timeout=120)
    assert_engine(engine, done.stdout + done.stderr)
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return done, calls, runtime / ".broker-legacy-migrated"


@pytest.mark.parametrize("command", ["up", "recreate"])
def test_a_start_that_went_well_exits_zero_after_a_migration_with_nothing_to_move(tmp_path, command):
    done, calls, marker = _run(tmp_path, command)
    # the migration ran, and its last native program was an `exists` that answered 1
    assert any("legacy.py exists" in call for call in calls), calls
    assert calls[-1].endswith("legacy.py exists email_transport"), calls
    assert marker.exists(), "the migration with nothing to move did not end well"
    assert done.returncode == 0, (
        f"`jht {command}` went well and exited {done.returncode}: the setup reads it as a team that did "
        f"not start\n{done.stdout[-1500:]}{done.stderr[-1500:]}"
    )


@pytest.mark.parametrize("command", ["up", "recreate"])
def test_a_compose_up_that_fails_keeps_its_own_code(tmp_path, command):
    done, calls, marker = _run(tmp_path, command, compose_up=3)
    assert done.returncode == 3, done.stdout[-1500:] + done.stderr[-1500:]
    assert "compose_up_failed" in done.stdout + done.stderr
    assert not any("legacy.py" in call for call in calls), "the migration ran after a failed start"
    assert not marker.exists()

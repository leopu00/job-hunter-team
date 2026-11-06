"""The Podman machine of the team is named by the runtime's own file, never by a variable of the environment.

`jht.ps1` used to obey JHT_PODMAN_MACHINE before the attested `podman-machine` file. The installer wrote that variable for the
user, so a terminal opened before an update (and every program started from it, the desktop app among them) kept the OLD
value; after a successful reinstall `jht up` then started the old machine, could not reach the team on the new one, and left
two WSL machines running. Now the file decides: the wrapper does not read the variable, the app does not pass it (nor
CONTAINER_CONNECTION / CONTAINER_HOST) to a child and reads the name from the file itself, and the installer does not write the
variable any more and takes the one an older install wrote.

The sources are read on any host; the wrapper's own resolution runs under PowerShell with made-up machine names.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
PWSH = shutil.which("pwsh")
needs_powershell = pytest.mark.skipif(not WINDOWS and PWSH is None, reason="needs PowerShell")


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")


def _code(path: Path) -> str:
    return "\n".join(line for line in _text(path).split("\n") if not line.lstrip().startswith("#"))


def _resolution_block() -> str:
    text = _text(WRAPPER)
    start = text.index("  $env:CONTAINER_CONNECTION = if (Test-Path -LiteralPath $PodmanMachineFile")
    end = text.index("Remove-Item -LiteralPath Env:JHT_PODMAN_MACHINE -ErrorAction SilentlyContinue", start)
    return text[start : end + len("Remove-Item -LiteralPath Env:JHT_PODMAN_MACHINE -ErrorAction SilentlyContinue")]


def test_the_wrapper_never_reads_the_machine_variable_to_choose_the_machine():
    code = _code(WRAPPER)
    reads = [line for line in code.split("\n") if re.search(r"\$env:JHT_PODMAN_MACHINE", line)]
    assert reads == [], reads
    # what remains of the name is the uninstall's removal and the line that clears it from the wrapper's own children
    assert "Remove-Item -LiteralPath Env:JHT_PODMAN_MACHINE" in code
    assert "'JHT_CONTAINER_RUNTIME', 'JHT_PODMAN_MACHINE'" in code
    # the machine started by `up` is the one chosen from the file
    assert "machine start --update-connection=false $env:CONTAINER_CONNECTION" in code


def test_the_installer_no_longer_writes_the_machine_variable_and_takes_the_one_an_older_install_wrote():
    code = _code(ENABLER)
    assert not re.search(r"SetEnvironmentVariable\('JHT_PODMAN_MACHINE', \$MachineName", code)
    assert "SetEnvironmentVariable('JHT_PODMAN_MACHINE', $null, 'User')" in code
    assert "$env:JHT_PODMAN_MACHINE = " not in code
    # the file the wrapper reads is written before the wrapper is started
    assert code.index("podman-machine") < code.index("& (Join-Path $BinDir 'jht.ps1') up")


def _ps(tmp_path: Path, text: str, env_extra: dict[str, str]) -> subprocess.CompletedProcess:
    script = tmp_path / "case.ps1"
    engine = tmp_path / "engine.txt"
    engine.unlink(missing_ok=True)
    script.write_text(ENGINE_CHECK + text, encoding="utf-8")
    env = {**windows_env(tmp_path), "PATH": ""} if WINDOWS else {"PATH": "/usr/bin:/bin"}
    env.update({"HOME": str(tmp_path), "JHT_ENGINE_FILE": str(engine), **env_extra})
    done = subprocess.run([*powershell_argv(), "-File", str(script)], capture_output=True, text=True, timeout=60, env=env)
    assert_engine(engine, done.stderr)
    return done


def _resolve(tmp_path: Path, file_text: str | None, stale: str | None, preset_connection: str | None = None) -> subprocess.CompletedProcess:
    machine_file = tmp_path / "podman-machine"
    machine_file.unlink(missing_ok=True)
    if file_text is not None:
        machine_file.write_bytes(file_text.encode("utf-8"))
    extra = {}
    if stale is not None:
        extra["JHT_PODMAN_MACHINE"] = stale
    if preset_connection is not None:
        extra["CONTAINER_CONNECTION"] = preset_connection
    case = (
        f"$PodmanMachineFile = '{machine_file}'\n"
        "$ErrorActionPreference = 'Stop'\n"
        "try {\n" + _resolution_block() + "\n'CONNECTION=' + $env:CONTAINER_CONNECTION + ';VARIABLE=' + [string]$env:JHT_PODMAN_MACHINE\n"
        "} catch { 'ERROR: ' + $_.Exception.Message }\n"
    )
    return _ps(tmp_path, case, extra)


@needs_powershell
def test_the_machine_in_the_runtime_file_wins_over_a_variable_an_older_terminal_still_carries(tmp_path):
    done = _resolve(tmp_path, "team-machine\r\n", stale="old-test-machine", preset_connection="another-connection")
    assert done.returncode == 0, done.stdout + done.stderr
    assert "CONNECTION=team-machine;VARIABLE=" in done.stdout, done.stdout


@needs_powershell
def test_without_the_runtime_file_the_default_machine_is_used_and_the_variable_is_still_ignored(tmp_path):
    done = _resolve(tmp_path, None, stale="old-test-machine")
    assert "CONNECTION=jht-podman;VARIABLE=" in done.stdout, done.stdout + done.stderr


@needs_powershell
@pytest.mark.parametrize("named", ["--connection", "two words", "a/b", ""])
def test_a_file_that_does_not_name_a_machine_is_refused_not_obeyed(tmp_path, named):
    done = _resolve(tmp_path, named + "\n", stale=None)
    assert "ERROR: podman-machine does not name a Podman machine" in done.stdout, done.stdout + done.stderr

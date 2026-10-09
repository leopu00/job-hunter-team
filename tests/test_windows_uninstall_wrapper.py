"""Windows `jht uninstall`: fixed scope, confirmation and retry behavior."""

from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
SOURCE = WRAPPER.read_text(encoding="utf-8")
POWERSHELL = shutil.which("powershell") or shutil.which("pwsh")


def _uninstall_source() -> str:
    start = SOURCE.index("function Write-JhtUninstallPhase")
    end = SOURCE.index("$Container   =", start)
    return SOURCE[start:end]


def test_uninstall_is_an_early_fixed_scope_protocol():
    uninstall = _uninstall_source()

    assert "$JHT_UNINSTALL_PROTOCOL = 1" in SOURCE
    assert SOURCE.index(
        "if ($args.Count -ge 1 -and $args[0] -ceq 'uninstall')"
    ) < SOURCE.index(". $AclHelperPath")
    assert "GetFolderPath('UserProfile')" in uninstall
    assert "GetFolderPath('LocalApplicationData')" in uninstall
    assert "$machineName = 'jht-podman'" in uninstall
    assert "podman-machine-$MachineName" in uninstall
    assert "machine rm --force $machineName" in uninstall
    assert "JHT_RUNTIME_DIR" not in uninstall
    assert "JHT_PODMAN_MACHINE" in uninstall  # removed, never used as a target
    assert "Docker.DockerDesktop" not in uninstall
    assert "winget" not in uninstall.lower()


def test_uninstall_requires_one_explicit_confirmation_and_has_stable_output():
    uninstall = _uninstall_source()

    assert (
        "$UninstallArgs.Count -ne 1 -or $UninstallArgs[0] -cne '--confirm'" in uninstall
    )
    assert "return 2" in uninstall
    for phase in ("uninstall_machine", "uninstall_runtime", "uninstall_commands"):
        assert f"'{phase}'" in uninstall
    for leftover in ("machine", "runtime", "commands"):
        assert f"'{leftover}'" in uninstall
    assert "return 24" in uninstall
    assert "--remove-data" not in uninstall
    assert "--remove-podman" not in uninstall


def test_uninstall_preserves_user_data_and_only_removes_known_commands():
    uninstall = _uninstall_source()

    for filename in (
        "jht.ps1",
        "jht.cmd",
        "windows-private-acl.ps1",
        "docker.exe",
    ):
        assert f"'{filename}'" in uninstall
    assert "Get-ChildItem -LiteralPath $binPath -Force" in uninstall
    assert "if ($foreignCommands.Count -eq 0)" in uninstall
    assert "'.jht'" not in uninstall
    assert "Documents\\Job Hunter Team" not in uninstall
    assert "machine reset" not in uninstall


def _ps_literal(path: Path) -> str:
    return "'" + str(path).replace("'", "''") + "'"


def _write_batch(path: Path, source: str) -> None:
    path.write_text(source.replace("\n", "\r\n"), encoding="ascii")


def _run_harness(tmp_path: Path, body: str) -> subprocess.CompletedProcess[str]:
    prefix = SOURCE[: SOURCE.index("$Container   =")]
    harness = tmp_path / "uninstall-harness.ps1"
    harness.write_text(prefix + "\n" + body, encoding="utf-8")
    return subprocess.run(
        [
            POWERSHELL,
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(harness),
        ],
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )


@pytest.mark.skipif(
    os.name != "nt" or not POWERSHELL, reason="requires Windows PowerShell"
)
def test_confirm_removes_only_the_jht_machine_and_is_idempotent(tmp_path: Path):
    profile = tmp_path / "profile"
    local = tmp_path / "local"
    runtime = local / "Job Hunter Team" / "host-runtime"
    bin_dir = profile / ".local" / "bin"
    data = profile / ".jht"
    documents = profile / "Documents" / "Job Hunter Team"
    tools = tmp_path / "tools"
    state = tmp_path / "jht-machine-present"
    log = tmp_path / "podman.log"
    for directory in (runtime, bin_dir, data, documents, tools):
        directory.mkdir(parents=True, exist_ok=True)
    (runtime / "container-runtime").write_text("podman\n", encoding="utf-8")
    for filename in ("jht.ps1", "jht.cmd", "windows-private-acl.ps1", "docker.exe"):
        (bin_dir / filename).write_text("jht\n", encoding="utf-8")
    (data / "profile.json").write_text("keep\n", encoding="utf-8")
    (documents / "cv.txt").write_text("keep\n", encoding="utf-8")
    state.write_text("present\n", encoding="utf-8")

    podman = tools / "podman.cmd"
    wsl = tools / "wsl.cmd"
    _write_batch(
        podman,
        f"""@echo off
echo %*>>"{log}"
if "%1"=="machine" if "%2"=="list" goto list
if "%1"=="machine" if "%2"=="rm" goto remove
exit /b 90
:list
if exist "{state}" (echo [{{"Name":"jht-podman"}},{{"Name":"somebody-else"}}]) else (echo [{{"Name":"somebody-else"}}])
exit /b 0
:remove
if not "%3"=="--force" exit /b 91
if not "%4"=="jht-podman" exit /b 92
del /q "{state}"
exit /b 0
""",
    )
    _write_batch(
        wsl,
        f"""@echo off
if "%1"=="--status" exit /b 0
if "%1"=="--list" if exist "{state}" echo podman-machine-jht-podman
exit /b 0
""",
    )
    body = f"""
$profile = {_ps_literal(profile)}
$local = {_ps_literal(local)}
$bin = {_ps_literal(bin_dir)}
[Environment]::SetEnvironmentVariable('Path', "$bin;C:\\Windows", [System.EnvironmentVariableTarget]::Process)
[Environment]::SetEnvironmentVariable('JHT_CONTAINER_RUNTIME', 'podman', [System.EnvironmentVariableTarget]::Process)
[Environment]::SetEnvironmentVariable('JHT_PODMAN_MACHINE', 'jht-podman', [System.EnvironmentVariableTarget]::Process)
$first = Invoke-JhtWindowsUninstall -UninstallArgs @('--confirm') -ProfilePath $profile -LocalAppDataPath $local -PodmanPath {_ps_literal(podman)} -WslPath {_ps_literal(wsl)} -EnvironmentTarget Process
if ($first -ne 0) {{ throw "first uninstall returned $first" }}
if (Test-Path -LiteralPath {_ps_literal(state)}) {{ throw 'JHT machine remained' }}
if (Test-Path -LiteralPath {_ps_literal(runtime)}) {{ throw 'runtime remained' }}
foreach ($name in @('jht.ps1','jht.cmd','windows-private-acl.ps1','docker.exe')) {{ if (Test-Path -LiteralPath (Join-Path $bin $name)) {{ throw "command remained: $name" }} }}
if (-not (Test-Path -LiteralPath {_ps_literal(data / 'profile.json')})) {{ throw 'user data was removed' }}
if (-not (Test-Path -LiteralPath {_ps_literal(documents / 'cv.txt')})) {{ throw 'documents were removed' }}
if ([Environment]::GetEnvironmentVariable('Path', 'Process') -split ';' -contains $bin) {{ throw 'owned PATH entry remained' }}
if ([Environment]::GetEnvironmentVariable('JHT_CONTAINER_RUNTIME', 'Process')) {{ throw 'runtime env remained' }}
if ([Environment]::GetEnvironmentVariable('JHT_PODMAN_MACHINE', 'Process')) {{ throw 'machine env remained' }}
$second = Invoke-JhtWindowsUninstall -UninstallArgs @('--confirm') -ProfilePath $profile -LocalAppDataPath $local -PodmanPath {_ps_literal(podman)} -WslPath {_ps_literal(wsl)} -EnvironmentTarget Process
if ($second -ne 0) {{ throw "second uninstall returned $second" }}
"""
    result = _run_harness(tmp_path, body)
    assert result.returncode == 0, result.stderr
    calls = log.read_text(encoding="utf-8")
    assert "machine rm --force jht-podman" in calls
    assert "machine rm --force somebody-else" not in calls
    assert result.stdout.count("JHT_PHASE uninstall_machine") == 2


@pytest.mark.skipif(
    os.name != "nt" or not POWERSHELL, reason="requires Windows PowerShell"
)
def test_unresponsive_wsl_keeps_everything_for_retry(tmp_path: Path):
    profile = tmp_path / "profile"
    local = tmp_path / "local"
    runtime = local / "Job Hunter Team" / "host-runtime"
    bin_dir = profile / ".local" / "bin"
    tools = tmp_path / "tools"
    log = tmp_path / "podman.log"
    for directory in (runtime, bin_dir, tools):
        directory.mkdir(parents=True, exist_ok=True)
    (runtime / "container-runtime").write_text("podman\n", encoding="utf-8")
    for filename in ("jht.ps1", "jht.cmd", "windows-private-acl.ps1", "docker.exe"):
        (bin_dir / filename).write_text("jht\n", encoding="utf-8")
    podman = tools / "podman.cmd"
    wsl = tools / "wsl.cmd"
    _write_batch(
        podman,
        f"""@echo off
echo %*>>"{log}"
if "%1"=="machine" if "%2"=="list" echo [{{"Name":"jht-podman"}}]& exit /b 0
if "%1"=="machine" if "%2"=="rm" exit /b 99
exit /b 90
""",
    )
    _write_batch(wsl, '@echo off\nif "%1"=="--status" exit /b 1\nexit /b 0\n')
    body = f"""
$code = Invoke-JhtWindowsUninstall -UninstallArgs @('--confirm') -ProfilePath {_ps_literal(profile)} -LocalAppDataPath {_ps_literal(local)} -PodmanPath {_ps_literal(podman)} -WslPath {_ps_literal(wsl)} -EnvironmentTarget Process
if ($code -ne 24) {{ throw "uninstall returned $code" }}
if (-not (Test-Path -LiteralPath {_ps_literal(runtime)})) {{ throw 'runtime was removed' }}
if (-not (Test-Path -LiteralPath {_ps_literal(bin_dir / 'jht.ps1')})) {{ throw 'wrapper was removed' }}
"""
    result = _run_harness(tmp_path, body)
    assert result.returncode == 0, result.stderr
    assert "JHT_LEFT machine" in result.stdout
    assert "JHT_LEFT runtime" in result.stdout
    assert "JHT_LEFT commands" in result.stdout
    assert "machine rm" not in log.read_text(encoding="utf-8")


@pytest.mark.skipif(
    os.name != "nt" or not POWERSHELL, reason="requires Windows PowerShell"
)
def test_a_foreign_command_keeps_the_shared_bin_directory_on_path(tmp_path: Path):
    profile = tmp_path / "profile"
    local = tmp_path / "local"
    runtime = local / "Job Hunter Team" / "host-runtime"
    bin_dir = profile / ".local" / "bin"
    tools = tmp_path / "tools"
    for directory in (runtime, bin_dir, tools):
        directory.mkdir(parents=True, exist_ok=True)
    (runtime / "container-runtime").write_text("podman\n", encoding="utf-8")
    for filename in ("jht.ps1", "jht.cmd", "windows-private-acl.ps1", "docker.exe"):
        (bin_dir / filename).write_text("jht\n", encoding="utf-8")
    foreign = bin_dir / "another-tool.exe"
    foreign.write_text("keep\n", encoding="utf-8")
    podman = tools / "podman.cmd"
    _write_batch(
        podman,
        """@echo off
if "%1"=="machine" if "%2"=="list" echo [{"Name":"somebody-else"}]& exit /b 0
exit /b 90
""",
    )
    body = f"""
$bin = {_ps_literal(bin_dir)}
[Environment]::SetEnvironmentVariable('Path', "$bin;C:\\Windows", [System.EnvironmentVariableTarget]::Process)
$code = Invoke-JhtWindowsUninstall -UninstallArgs @('--confirm') -ProfilePath {_ps_literal(profile)} -LocalAppDataPath {_ps_literal(local)} -PodmanPath {_ps_literal(podman)} -EnvironmentTarget Process
if ($code -ne 0) {{ throw "uninstall returned $code" }}
if (-not (Test-Path -LiteralPath {_ps_literal(foreign)})) {{ throw 'foreign command was removed' }}
if (-not (([Environment]::GetEnvironmentVariable('Path', 'Process') -split ';') -contains $bin)) {{ throw 'shared PATH entry was removed' }}
foreach ($name in @('jht.ps1','jht.cmd','windows-private-acl.ps1','docker.exe')) {{ if (Test-Path -LiteralPath (Join-Path $bin $name)) {{ throw "JHT command remained: $name" }} }}
"""
    result = _run_harness(tmp_path, body)
    assert result.returncode == 0, result.stderr


@pytest.mark.skipif(
    os.name != "nt" or not POWERSHELL, reason="requires Windows PowerShell"
)
def test_missing_confirmation_and_legacy_docker_runtime_are_non_mutating(
    tmp_path: Path,
):
    profile = tmp_path / "profile"
    local = tmp_path / "local"
    runtime = local / "Job Hunter Team" / "host-runtime"
    bin_dir = profile / ".local" / "bin"
    runtime.mkdir(parents=True)
    bin_dir.mkdir(parents=True)
    (runtime / "container-runtime").write_text("docker\n", encoding="utf-8")
    (bin_dir / "jht.ps1").write_text("jht\n", encoding="utf-8")
    body = f"""
$missing = Invoke-JhtWindowsUninstall -UninstallArgs @() -ProfilePath {_ps_literal(profile)} -LocalAppDataPath {_ps_literal(local)} -EnvironmentTarget Process
if ($missing -ne 2) {{ throw "missing confirmation returned $missing" }}
$legacy = Invoke-JhtWindowsUninstall -UninstallArgs @('--confirm') -ProfilePath {_ps_literal(profile)} -LocalAppDataPath {_ps_literal(local)} -EnvironmentTarget Process
if ($legacy -ne 24) {{ throw "legacy runtime returned $legacy" }}
if (-not (Test-Path -LiteralPath {_ps_literal(runtime)})) {{ throw 'legacy runtime was removed' }}
if (-not (Test-Path -LiteralPath {_ps_literal(bin_dir / 'jht.ps1')})) {{ throw 'legacy wrapper was removed' }}
"""
    result = _run_harness(tmp_path, body)
    assert result.returncode == 0, result.stderr
    assert "JHT_LEFT runtime" in result.stdout
    assert "JHT_LEFT commands" in result.stdout

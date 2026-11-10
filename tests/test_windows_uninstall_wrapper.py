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
    assert "Remove-JhtStartupTask" in uninstall
    assert "Job Hunter Team - Start runtime" in uninstall
    assert "JHT_RUNTIME_DIR" not in uninstall
    assert "JHT_PODMAN_MACHINE" in uninstall  # removed, never used as a target
    assert "Docker.DockerDesktop" not in uninstall
    assert "winget" not in uninstall.lower()


def test_uninstall_requires_one_explicit_confirmation_and_has_stable_output():
    uninstall = _uninstall_source()
    notice = (
        "Vengono cancellati anche la password della posta e i token di Telegram "
        "salvati; ~/.jht e Documenti restano, e con loro la sessione LinkedIn salvata "
        "(secrets/linkedin-profile e .cache/linkedin): si toglie con jht reset --scope creds."
    )

    # --confirm alone, or --confirm with --purge (either order): nothing else
    assert "$UninstallArgs[0] -ceq '--confirm'" in uninstall
    assert "$_ -ceq '--confirm'" in uninstall and "$_ -ceq '--purge'" in uninstall
    assert "uso: jht uninstall --confirm [--purge]" in uninstall
    assert "return 2" in uninstall
    for phase in ("uninstall_machine", "uninstall_runtime", "uninstall_commands"):
        assert f"'{phase}'" in uninstall
    for leftover in ("machine", "runtime", "commands"):
        assert f"'{leftover}'" in uninstall
    assert "return 24" in uninstall
    assert notice in SOURCE
    assert uninstall.count("WriteLine($JhtUninstallRemovalNotice)") == 2
    assert "Write-JhtUninstallMachineLeft" in uninstall
    assert "I segreti salvati non sono stati rimossi" in SOURCE
    assert "--remove-data" not in uninstall
    assert "--remove-podman" not in uninstall


def test_uninstall_preserves_user_data_and_only_removes_known_commands():
    uninstall = _uninstall_source()

    for filename in (
        "jht.ps1",
        "jht.cmd",
        "windows-private-acl.ps1",
        "podman-machine-bridge.ps1",
        "docker.exe",
    ):
        assert f"'{filename}'" in uninstall
    assert "Get-ChildItem -LiteralPath $binPath -Force" in uninstall
    # the folder that holds only the command shim goes too (and its PATH entry), or `jht` in PowerShell would stay half there
    assert "(Join-Path $binPath 'shim\\jht.cmd'), (Join-Path $binPath 'shim')" in uninstall
    assert "$normalizedShim" in uninstall
    assert "if ($foreignCommands.Count -eq 0)" in uninstall
    # the data goes only with --purge (never by default), and only the two fixed folders
    assert "machine reset" not in uninstall
    body = uninstall[uninstall.index("function Invoke-JhtWindowsUninstall"):]
    purge_block = body[body.index("if ($purge) {"):body.index("Write-JhtUninstallPhase uninstall_runtime")]
    assert "'.jht'" in purge_block and "'Documents', 'Job Hunter Team'" in purge_block
    assert "'.jht'" not in body.replace(purge_block, "") and "'Documents'" not in body.replace(purge_block, "")


def _ps_literal(path: Path) -> str:
    return "'" + str(path).replace("'", "''") + "'"


def _write_batch(path: Path, source: str) -> None:
    path.write_text(source.replace("\n", "\r\n"), encoding="ascii")


STARTUP_TASK_LABEL = "Job Hunter Team - Start runtime"


def _scheduled_task_fakes(state: Path, log: Path, unregister_fails: bool) -> str:
    """Get-/Unregister-ScheduledTask as functions, which PowerShell runs before the
    cmdlets of the same name: the real ones would touch this computer's own JHT
    task (and need CIM rights a non-admin session lacks). The task exists while
    `state` does; every call is appended to `log`."""
    unregister = (
        "throw 'Accesso negato (finto)'"
        if unregister_fails
        else "Remove-Item -LiteralPath $script:FakeTaskState -Force"
    )
    return f"""
$script:FakeTaskState = {_ps_literal(state)}
$script:FakeTaskLog = {_ps_literal(log)}
$script:ScopedTask = Get-JhtScopedStartupTaskName
$script:LegacyTask = '{STARTUP_TASK_LABEL}'
if (-not $script:ScopedTask) {{ throw 'current user SID unavailable for scoped task test' }}
function Get-ScheduledTask {{
  [CmdletBinding()] param([string]$TaskName)
  Add-Content -LiteralPath $script:FakeTaskLog -Value "task get $TaskName" -Encoding ascii
  if ($TaskName -ceq $script:ScopedTask -and (Test-Path -LiteralPath $script:FakeTaskState)) {{
    return [pscustomobject]@{{ TaskName = $TaskName }}
  }}
  if ($TaskName -ceq $script:LegacyTask) {{ return [pscustomobject]@{{ TaskName = $TaskName }} }}
}}
function Unregister-ScheduledTask {{
  [CmdletBinding(SupportsShouldProcess = $true)] param([string]$TaskName)
  Add-Content -LiteralPath $script:FakeTaskLog -Value "task unregister $TaskName" -Encoding ascii
  if ($TaskName -ceq $script:LegacyTask) {{ throw 'legacy P23 task must stay untouched' }}
  if ($TaskName -cne $script:ScopedTask) {{ throw 'wrong task' }}
  {unregister}
}}
foreach ($fake in 'Get-ScheduledTask', 'Unregister-ScheduledTask') {{
  if ((Get-Command $fake).CommandType -ne 'Function') {{ throw "$fake is not the fake" }}
}}
"""


def _run_harness(
    tmp_path: Path,
    body: str,
    *,
    task_present: bool = False,
    unregister_fails: bool = False,
    log: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    prefix = SOURCE[: SOURCE.index("$Container   =")]
    state = tmp_path / "startup-task-present"
    if task_present:
        state.write_text("present\n", encoding="utf-8")
    fakes = _scheduled_task_fakes(state, log or tmp_path / "tasks.log", unregister_fails)
    harness = tmp_path / "uninstall-harness.ps1"
    harness.write_text(prefix + "\n" + fakes + "\n" + body, encoding="utf-8")
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
@pytest.mark.parametrize("with_shim", [False, True], ids=["bin-only", "with-shim-folder"])
def test_confirm_removes_only_the_jht_machine_and_is_idempotent(tmp_path: Path, with_shim: bool):
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
    for filename in ("jht.ps1", "jht.cmd", "windows-private-acl.ps1", "podman-machine-bridge.ps1", "docker.exe"):
        (bin_dir / filename).write_text("jht\n", encoding="utf-8")
    if with_shim:  # install.ps1: a folder with only the command shim, before the bin folder in the PATH
        (bin_dir / "shim").mkdir()
        (bin_dir / "shim" / "jht.cmd").write_text("jht\n", encoding="utf-8")
    path_prefix = "$shim;" if with_shim else ""
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
$shim = Join-Path $bin 'shim'
[Environment]::SetEnvironmentVariable('Path', "{path_prefix}$bin;C:\\Windows", [System.EnvironmentVariableTarget]::Process)
[Environment]::SetEnvironmentVariable('JHT_CONTAINER_RUNTIME', 'podman', [System.EnvironmentVariableTarget]::Process)
[Environment]::SetEnvironmentVariable('JHT_PODMAN_MACHINE', 'jht-podman', [System.EnvironmentVariableTarget]::Process)
$first = Invoke-JhtWindowsUninstall -UninstallArgs @('--confirm') -ProfilePath $profile -LocalAppDataPath $local -PodmanPath {_ps_literal(podman)} -WslPath {_ps_literal(wsl)} -EnvironmentTarget Process
if ($first -ne 0) {{ throw "first uninstall returned $first" }}
if (Test-Path -LiteralPath {_ps_literal(state)}) {{ throw 'JHT machine remained' }}
if (Test-Path -LiteralPath {_ps_literal(runtime)}) {{ throw 'runtime remained' }}
foreach ($name in @('jht.ps1','jht.cmd','windows-private-acl.ps1','podman-machine-bridge.ps1','docker.exe')) {{ if (Test-Path -LiteralPath (Join-Path $bin $name)) {{ throw "command remained: $name" }} }}
if (-not (Test-Path -LiteralPath {_ps_literal(data / 'profile.json')})) {{ throw 'user data was removed' }}
if (-not (Test-Path -LiteralPath {_ps_literal(documents / 'cv.txt')})) {{ throw 'documents were removed' }}
if ([Environment]::GetEnvironmentVariable('Path', 'Process') -split ';' -contains $bin) {{ throw 'owned PATH entry remained' }}
if ([Environment]::GetEnvironmentVariable('Path', 'Process') -split ';' -contains $shim) {{ throw 'shim PATH entry remained' }}
if (Test-Path -LiteralPath $shim) {{ throw 'shim folder remained' }}
if ([Environment]::GetEnvironmentVariable('JHT_CONTAINER_RUNTIME', 'Process')) {{ throw 'runtime env remained' }}
if ([Environment]::GetEnvironmentVariable('JHT_PODMAN_MACHINE', 'Process')) {{ throw 'machine env remained' }}
$second = Invoke-JhtWindowsUninstall -UninstallArgs @('--confirm') -ProfilePath $profile -LocalAppDataPath $local -PodmanPath {_ps_literal(podman)} -WslPath {_ps_literal(wsl)} -EnvironmentTarget Process
if ($second -ne 0) {{ throw "second uninstall returned $second" }}
"""
    result = _run_harness(tmp_path, body, task_present=True, log=log)
    assert result.returncode == 0, result.stderr
    calls = log.read_text(encoding="utf-8")
    assert "machine rm --force jht-podman" in calls
    # The logon task goes first, once: a sign-in during uninstall cannot restart the runtime.
    # the task is namespaced by the user's SID since 3622abcd65: «Job Hunter Team - Start runtime [S-1-...]»
    unregistered = [line for line in calls.splitlines() if line.startswith(f"task unregister {STARTUP_TASK_LABEL} [S-1-")]
    assert len(unregistered) == 1
    assert calls.index(unregistered[0]) < calls.index("machine rm")
    assert not (tmp_path / "startup-task-present").exists()
    assert "machine rm --force somebody-else" not in calls
    assert result.stdout.count("JHT_PHASE uninstall_machine") == 2
    assert result.stderr.count("Vengono cancellati anche la password della posta") == 2


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
    for filename in ("jht.ps1", "jht.cmd", "windows-private-acl.ps1", "podman-machine-bridge.ps1", "docker.exe"):
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
    assert "I segreti salvati non sono stati rimossi" in result.stderr
    assert "jht-secrets" in result.stderr and "jht-telegram-secrets" in result.stderr, "which secrets, and where"
    assert "wsl --unregister podman-jht-podman" in result.stderr, "the exact way to remove it by hand"
    assert "WSL non risponde" in result.stderr, "and why it was left"


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
    for filename in ("jht.ps1", "jht.cmd", "windows-private-acl.ps1", "podman-machine-bridge.ps1", "docker.exe"):
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
foreach ($name in @('jht.ps1','jht.cmd','windows-private-acl.ps1','podman-machine-bridge.ps1','docker.exe')) {{ if (Test-Path -LiteralPath (Join-Path $bin $name)) {{ throw "JHT command remained: $name" }} }}
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
    assert "uso: jht uninstall --confirm" in result.stderr
    assert "Vengono cancellati anche la password della posta" in result.stderr


@pytest.mark.skipif(
    os.name != "nt" or not POWERSHELL, reason="requires Windows PowerShell"
)
def test_a_startup_task_that_cannot_be_removed_keeps_everything_for_retry(
    tmp_path: Path,
):
    profile = tmp_path / "profile"
    local = tmp_path / "local"
    runtime = local / "Job Hunter Team" / "host-runtime"
    bin_dir = profile / ".local" / "bin"
    tools = tmp_path / "tools"
    log = tmp_path / "calls.log"
    for directory in (runtime, bin_dir, tools):
        directory.mkdir(parents=True, exist_ok=True)
    (runtime / "container-runtime").write_text("podman\n", encoding="utf-8")
    for filename in ("jht.ps1", "jht.cmd", "windows-private-acl.ps1", "podman-machine-bridge.ps1", "docker.exe"):
        (bin_dir / filename).write_text("jht\n", encoding="utf-8")
    podman = tools / "podman.cmd"
    wsl = tools / "wsl.cmd"
    _write_batch(
        podman,
        f"""@echo off
echo %*>>"{log}"
if "%1"=="machine" if "%2"=="list" echo [{{"Name":"jht-podman"}}]& exit /b 0
if "%1"=="machine" if "%2"=="rm" exit /b 0
exit /b 90
""",
    )
    _write_batch(
        wsl,
        """@echo off
if "%1"=="--status" exit /b 0
if "%1"=="--list" echo podman-machine-jht-podman
exit /b 0
""",
    )
    body = f"""
$code = Invoke-JhtWindowsUninstall -UninstallArgs @('--confirm') -ProfilePath {_ps_literal(profile)} -LocalAppDataPath {_ps_literal(local)} -PodmanPath {_ps_literal(podman)} -WslPath {_ps_literal(wsl)} -EnvironmentTarget Process
if ($code -ne 24) {{ throw "uninstall returned $code" }}
if (-not (Test-Path -LiteralPath {_ps_literal(runtime)})) {{ throw 'runtime was removed' }}
if (-not (Test-Path -LiteralPath {_ps_literal(bin_dir / 'jht.ps1')})) {{ throw 'wrapper was removed' }}
"""
    result = _run_harness(
        tmp_path, body, task_present=True, unregister_fails=True, log=log
    )
    assert result.returncode == 0, result.stderr
    calls = log.read_text(encoding="utf-8")
    assert f"task unregister {STARTUP_TASK_LABEL} [S-1-" in calls
    assert "machine rm" not in calls
    assert (tmp_path / "startup-task-present").exists()
    assert "JHT_LEFT machine" in result.stdout
    assert "JHT_LEFT runtime" in result.stdout
    assert "JHT_LEFT commands" in result.stdout


# ── the machine that podman cannot remove, the data of --purge, and the words for a person ───────────────────────────────────────

BIN_FILES = ("jht.ps1", "jht.cmd", "windows-private-acl.ps1", "podman-machine-bridge.ps1", "docker.exe")


def _box(tmp_path: Path, *, machine: bool = True, data: bool = False):
    profile, local = tmp_path / "profile", tmp_path / "local"
    runtime = local / "Job Hunter Team" / "host-runtime"
    bin_dir = profile / ".local" / "bin"
    tools, state, log = tmp_path / "tools", tmp_path / "jht-machine-present", tmp_path / "calls.log"
    for directory in (runtime, bin_dir, tools):
        directory.mkdir(parents=True, exist_ok=True)
    (runtime / "container-runtime").write_text("podman\n", encoding="utf-8")
    for filename in BIN_FILES:
        (bin_dir / filename).write_text("jht\n", encoding="utf-8")
    home, documents = profile / ".jht", profile / "Documents" / "Job Hunter Team"
    if data:
        for folder, name in ((home, "profile.json"), (documents, "cv.txt")):
            folder.mkdir(parents=True, exist_ok=True)
            (folder / name).write_text("synthetic\n", encoding="utf-8")
    if machine:
        state.write_text("present\n", encoding="utf-8")
    return type("Box", (), {"profile": profile, "local": local, "runtime": runtime, "bin": bin_dir, "tools": tools, "state": state,
                            "log": log, "home": home, "documents": documents})


def _fake_podman(box, *, rm_exit: int = 0, rm_says: str = "") -> Path:
    podman = box.tools / "podman.cmd"
    _write_batch(podman, f"""@echo off
echo %*>>"{box.log}"
if "%1"=="machine" if "%2"=="list" goto list
if "%1"=="machine" if "%2"=="rm" goto remove
exit /b 90
:list
if exist "{box.state}" (echo [{{"Name":"jht-podman"}}]) else (echo [{{"Name":"somebody-else"}}])
exit /b 0
:remove
{f'echo {rm_says} 1>&2' if rm_says else 'rem'}
if {rm_exit} NEQ 0 exit /b {rm_exit}
del /q "{box.state}"
exit /b 0
""")
    return podman


def _fake_wsl(box, *, unregister_exit: int = 0) -> Path:
    """The distro of a Podman machine is `podman-<name>`: podman-jht-podman."""
    wsl = box.tools / "wsl.cmd"
    _write_batch(wsl, f"""@echo off
echo wsl %*>>"{box.log}"
if "%1"=="--status" exit /b 0
if "%1"=="--list" if exist "{box.state}" echo podman-jht-podman
if "%1"=="--terminate" exit /b 0
if "%1"=="--unregister" goto unregister
exit /b 0
:unregister
if not "%2"=="podman-jht-podman" exit /b 91
if {unregister_exit} NEQ 0 (echo The process cannot access the file 1>&2 & exit /b {unregister_exit})
del /q "{box.state}"
exit /b 0
""")
    return wsl


def _uninstall(box, podman: Path, wsl: Path, *args: str, tmp_path: Path, machine_output: str | None = None):
    arguments = ", ".join(f"'{a}'" for a in args)
    body = f"""
$code = Invoke-JhtWindowsUninstall -UninstallArgs @({arguments}) -ProfilePath {_ps_literal(box.profile)} -LocalAppDataPath {_ps_literal(box.local)} -PodmanPath {_ps_literal(podman)} -WslPath {_ps_literal(wsl)} -EnvironmentTarget Process
[Console]::Out.WriteLine("CODE=$code")
"""
    if machine_output is not None:
        body = f"$env:JHT_MACHINE_OUTPUT = '{machine_output}'\n" + body
    return _run_harness(tmp_path, body)


windows_only = pytest.mark.skipif(os.name != "nt" or not POWERSHELL, reason="requires Windows PowerShell")


@windows_only
def test_a_machine_podman_cannot_remove_is_unregistered_through_wsl_by_its_exact_distro_name(tmp_path: Path):
    box = _box(tmp_path)
    result = _uninstall(box, _fake_podman(box, rm_exit=1, rm_says="Error: unable to remove the machine"), _fake_wsl(box), "--confirm", tmp_path=tmp_path)
    assert "CODE=0" in result.stdout, result.stdout + result.stderr
    calls = box.log.read_text(encoding="utf-8")
    assert "wsl --terminate podman-jht-podman" in calls and "wsl --unregister podman-jht-podman" in calls
    assert not box.state.exists() and not box.runtime.exists()
    assert not any(line.startswith("wsl --unregister") and "jht-podman" not in line for line in calls.splitlines())


@windows_only
def test_when_nothing_can_remove_the_machine_the_reason_the_secrets_and_the_manual_command_are_said(tmp_path: Path):
    box = _box(tmp_path)
    podman = _fake_podman(box, rm_exit=1, rm_says="Error: machine is in use by another process")
    result = _uninstall(box, podman, _fake_wsl(box, unregister_exit=1), "--confirm", tmp_path=tmp_path)
    assert "CODE=24" in result.stdout, result.stdout + result.stderr
    assert box.runtime.exists() and (box.bin / "jht.ps1").exists(), "everything stays for a retry"
    for words in ("machine is in use by another process", "The process cannot access the file", "wsl --unregister podman-jht-podman",
                  "jht-secrets", "jht-telegram-secrets", "rilancia jht uninstall --confirm"):
        assert words in result.stderr, words


@windows_only
def test_a_console_gets_sentences_and_a_pipe_gets_the_lines_of_the_app(tmp_path: Path):
    for mode, shown, hidden in (("0", "Tolgo la macchina Podman jht-podman", "JHT_PHASE"), ("1", "JHT_PHASE uninstall_machine", "Tolgo la macchina")):
        box = _box(tmp_path / mode)
        result = _uninstall(box, _fake_podman(box), _fake_wsl(box), "--confirm", tmp_path=tmp_path / mode, machine_output=mode)
        assert "CODE=0" in result.stdout, result.stdout + result.stderr
        assert shown in result.stdout and hidden not in result.stdout, (mode, result.stdout)
    left = _box(tmp_path / "left")
    result = _uninstall(left, _fake_podman(left, rm_exit=1), _fake_wsl(left, unregister_exit=1), "--confirm", tmp_path=tmp_path / "left", machine_output="0")
    assert "JHT_LEFT" not in result.stdout and "JHT_PHASE" not in result.stdout
    assert "Non tolta: la macchina Podman jht-podman" in result.stderr


@windows_only
@pytest.mark.parametrize("arguments", [("--confirm", "--purge"), ("--purge", "--confirm")], ids=["confirm-purge", "purge-confirm"])
def test_purge_deletes_the_two_data_folders_after_the_machine_and_before_the_runtime(tmp_path: Path, arguments):
    box = _box(tmp_path, data=True)
    result = _uninstall(box, _fake_podman(box), _fake_wsl(box), *arguments, tmp_path=tmp_path, machine_output="1")
    assert "CODE=0" in result.stdout, result.stdout + result.stderr
    assert not box.home.exists() and not box.documents.exists() and not box.runtime.exists()
    lines = [line for line in result.stdout.splitlines() if line.startswith("JHT_PHASE")]
    # the app knows three phases and never asks for --purge: the data are a sentence for the person, not a protocol line
    assert lines == ["JHT_PHASE uninstall_machine", "JHT_PHASE uninstall_runtime", "JHT_PHASE uninstall_commands"]
    assert result.stdout.index("Cancello ~/.jht") < result.stdout.index("JHT_PHASE uninstall_runtime")
    assert "~/.jht e Documents\\Job Hunter Team" in result.stderr, "the loss is said before it happens"


@windows_only
def test_without_purge_the_data_stays_and_the_sentence_says_so(tmp_path: Path):
    box = _box(tmp_path, data=True)
    result = _uninstall(box, _fake_podman(box), _fake_wsl(box), "--confirm", tmp_path=tmp_path, machine_output="0")
    assert "CODE=0" in result.stdout
    assert (box.home / "profile.json").exists() and (box.documents / "cv.txt").exists()
    assert "restano (con --purge si cancellano)" in result.stdout


@windows_only
def test_purge_never_follows_a_link_and_leaves_the_command_to_retry(tmp_path: Path):
    box = _box(tmp_path, data=True)
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    (elsewhere / "precious.txt").write_text("synthetic\n", encoding="utf-8")
    import shutil as _shutil
    _shutil.rmtree(box.documents)
    subprocess.run(["cmd", "/c", "mklink", "/J", str(box.documents), str(elsewhere)], check=True, capture_output=True)
    result = _uninstall(box, _fake_podman(box), _fake_wsl(box), "--confirm", "--purge", tmp_path=tmp_path, machine_output="1")
    assert "CODE=24" in result.stdout, result.stdout + result.stderr
    assert (elsewhere / "precious.txt").exists(), "what the link points at is never touched"
    assert "JHT_LEFT data" not in result.stdout and "JHT_PHASE uninstall_runtime" not in result.stdout
    assert "Non cancellati i dati di JHT" in result.stderr
    assert box.runtime.exists() and (box.bin / "jht.ps1").exists(), "the command stays so it can be run again"
    assert "e' un collegamento" in result.stderr


@windows_only
def test_a_file_of_another_program_in_the_bin_folder_is_left_alone(tmp_path: Path):
    box = _box(tmp_path)
    for name in ("kimi.exe", "uv.exe"):
        (box.bin / name).write_text("keep\n", encoding="utf-8")
    result = _uninstall(box, _fake_podman(box), _fake_wsl(box), "--confirm", tmp_path=tmp_path)
    assert "CODE=0" in result.stdout, result.stdout + result.stderr
    assert (box.bin / "kimi.exe").exists() and (box.bin / "uv.exe").exists()
    assert not any((box.bin / name).exists() for name in BIN_FILES)


def test_the_usage_line_names_purge_and_the_wsl_distro_follows_podmans_naming():
    assert "uso: jht uninstall --confirm [--purge]" in SOURCE
    function = SOURCE[SOURCE.index("function Get-JhtPodmanDistroName"):]
    function = function[:function.index("\n}\n")]
    assert "return \"podman-$MachineName\"" in function and "StartsWith('podman'" in function
    assert 'Get-JhtPodmanDistroName $MachineName) -or $distros -ccontains "podman-machine-$MachineName"' in SOURCE


def test_the_nul_of_wsls_utf16_listing_is_removed_with_two_strings_not_a_char_and_an_empty_string():
    # Windows PowerShell 5.1 picks Replace(char, char) for ([char]0, '') and cannot turn '' into a char: the listing of the
    # distros failed there ("String must be exactly one character long") and the fallback through WSL never ran.
    assert "Replace([char]0, '')" not in SOURCE
    assert SOURCE.count("Replace([string][char]0, '')") == 2

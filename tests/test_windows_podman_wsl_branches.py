"""Podman in WSL on Windows: the branches that do not need WSL to be tested.

The desktop app delegates WSL and Podman to install.ps1 and tells what went
wrong from its exit code (windows_runtime.rs, exit_failure): 20 WSL not
usable, 21 Podman or Compose not installable, 22 the Podman machine missing,
not creatable or not starting. The decisions behind those codes live in
PowerShell:
  - install.ps1, Test-WindowsSubsystem: `wsl.exe --status`;
  - enable-podman-windows-runtime.ps1: `podman machine list --format json`,
    then init / start / info of the machine;
  - jht-wrapper.ps1, Start-PodmanMachineForUp: `jht up` wakes the machine.

Each function (or the machine block, which is top-level script code) is taken
from the REAL script through the PowerShell AST and run by pwsh with fake
wsl.exe / podman.exe / docker on PATH. GitHub's ubuntu runners have pwsh, so
this runs in the pytest job, where WSL does not exist. What needs a real WSL2
and a real Podman machine is in the collaudo script, not here.

The fakes are POSIX sh scripts: pwsh on Linux and macOS finds a file named
podman.exe as an application. On Windows the same scripts run under Git for
Windows' bash, behind a small native launcher named like the real program
(wsl.exe, podman.exe, docker.exe): the scripts look them up with Get-Command
-CommandType Application and run them as native processes. There the file runs
under the shell named by JHT_TEST_SHELL (`powershell`, Windows PowerShell 5.1,
the one the app uses; or `pwsh`), and every run checks that the engine was the
one named: 5.1 does not enumerate a JSON array through the pipeline, 7 does. A
missing shell, bash or compiler on Windows is a failure, never a skip.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
ENABLER = SCRIPTS / "enable-podman-windows-runtime.ps1"
INSTALLER = SCRIPTS / "install.ps1"
WRAPPER = SCRIPTS / "jht-wrapper.ps1"
SELFTEST = SCRIPTS / "windows-config-acl-selftest.ps1"
WINDOWS_RUNTIME_RS = ROOT / "desktop" / "src-tauri" / "src" / "windows_runtime.rs"


from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, install_fake, powershell_argv, windows_env


# Dot-sources functions (and, for the enabler, its machine block) from the real
# script, then runs $env:JHT_CASE_BODY. `exit N` inside them ends pwsh with N.
PRELUDE = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($name in ($env:JHT_IMPORT -split ',')) {
  if (-not $name) { continue }
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { throw "function $name missing" }
  . ([scriptblock]::Create($fn.Extent.Text))
}
. ([scriptblock]::Create($env:JHT_CASE_BODY))
exit 0
"""

FAKE = """#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG"
case "$*" in
{cases}
esac
exit 0
"""


def _fake(directory: Path, name: str, cases: str) -> None:
    install_fake(directory, name, FAKE.format(cases=cases))


def _run(tmp_path: Path, script: Path, imports: list[str], body: str, env: dict[str, str]):
    prelude = tmp_path / "prelude.ps1"
    # The engine check first: every case says which PowerShell ran it.
    prelude.write_text(ENGINE_CHECK + PRELUDE, encoding="utf-8")
    log = tmp_path / "calls.log"
    log.touch()
    engine = tmp_path / "engine.txt"
    engine.unlink(missing_ok=True)
    run_env = {
        **(windows_env(tmp_path) if WINDOWS else {}),
        "PATH": str(tmp_path / "bin") if WINDOWS else f"{tmp_path / 'bin'}{os.pathsep}/usr/bin{os.pathsep}/bin",
        "HOME": str(tmp_path),
        "JHT_ENGINE_FILE": str(engine),
        "FAKE_LOG": str(log),
        "FAKE_STATE": str(tmp_path / "state"),
        "FAKE_DEFAULT": str(tmp_path / "default-connection"),
        "JHT_UNDER_TEST": str(script),
        "JHT_IMPORT": ",".join(imports),
        "JHT_CASE_BODY": body,
        **env,
    }
    result = subprocess.run(
        [*powershell_argv(), "-File", str(prelude)],
        env=run_env, capture_output=True, text=True, timeout=120,
    )
    assert_engine(engine, result.stderr)
    calls = [line for line in log.read_text(encoding="utf-8").splitlines() if line]
    return result, calls


def _phases(stdout: str) -> list[str]:
    return re.findall(r"^JHT_PHASE (\S+)$", stdout, flags=re.MULTILINE)


# ---------------------------------------------------------------------------
# enable-podman-windows-runtime.ps1: the machine block
# ---------------------------------------------------------------------------

MACHINE_BLOCK_BODY = r"""
$block = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.TryStatementAst] -and $n.Extent.Text -match 'machine list' }, $true)
if (-not $block) { throw 'machine block missing' }
$Podman = $env:FAKE_PODMAN
$MachineName = 'jht-podman'
$InitializeMachine = ($env:INITIALIZE -eq '1')
# The real one writes HKCU's Lxss key, which off Windows does not exist: here it
# only says, in the same log as the podman calls, when the block asks for it.
function Skip-WslWelcome { Add-Content -LiteralPath $env:FAKE_LOG -Value $env:WELCOME }
. ([scriptblock]::Create($block.Extent.Text))
"""

# Like the real Podman, a refusal says why on stderr: under 'Stop', Windows PowerShell 5.1 turns a
# line of a native program's stderr into an error when the script redirects it (T82).
PODMAN_CASES = """  "machine list --format json") printf '%s' "$FAKE_MACHINES"; exit "${FAKE_LIST_EXIT:-0}" ;;
  "machine init "*) [ "$FAKE_FAIL" = init ] && { echo 'Error: machine init failed' >&2; exit 125; }; case "$*" in *"--update-connection=false"*) ;; *) printf '%s' jht-podman > "$FAKE_DEFAULT" ;; esac ;;
  "machine start "*) [ "$FAKE_FAIL" = start ] && { echo 'Error: machine start failed' >&2; exit 125; }; case "$*" in *"--update-connection=false"*) ;; *) printf '%s' jht-podman > "$FAKE_DEFAULT" ;; esac ;;
  "--connection jht-podman info") [ "$FAKE_FAIL" = info ] && { echo 'Error: cannot connect to Podman' >&2; exit 125; } ;;
  "--connection jht-podman inspect jht "*) echo 'Error: no such object: "jht"' >&2; exit 125 ;;"""

INIT = "machine init --update-connection=false --provider wsl --cpus 2 --memory 3072 --disk-size 30 jht-podman"
START = "machine start --update-connection=false jht-podman"
INFO = "--connection jht-podman info"
WELCOME = "Skip-WslWelcome"


def _machines(*entries: tuple[str, bool]) -> str:
    return json.dumps([{"Name": name, "Running": running, "Default": False} for name, running in entries])


def _enabler(tmp_path, *, machines: str, initialize: bool = True, fail: str = ""):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "podman.exe", PODMAN_CASES)
    return _run(
        tmp_path, ENABLER, ["Invoke-Checked", "Write-JhtPhase"], MACHINE_BLOCK_BODY,
        {
            "FAKE_PODMAN": str(bin_dir / "podman.exe"),
            "FAKE_MACHINES": machines,
            "INITIALIZE": "1" if initialize else "0",
            "FAKE_FAIL": fail,
            "WELCOME": WELCOME,
        },
    )


def test_an_absent_machine_is_created_in_wsl_then_started_then_checked(tmp_path):
    result, calls = _enabler(tmp_path, machines=_machines())
    assert result.returncode == 0, result.stderr
    assert calls == ["machine list --format json", WELCOME, INIT, START, INFO]
    assert _phases(result.stdout) == ["podman_machine_init", "podman_machine_start"]


def test_another_machine_with_a_different_name_is_not_ours(tmp_path):
    result, calls = _enabler(tmp_path, machines=_machines(("podman-machine-default", True)))
    assert result.returncode == 0, result.stderr
    assert INIT in calls and START in calls


def test_install_preserves_an_existing_machine_and_default_connection(tmp_path):
    default = tmp_path / "default-connection"
    default.write_text("user-podman", encoding="utf-8")
    result, calls = _enabler(tmp_path, machines=_machines(("user-podman", True)))
    assert result.returncode == 0, result.stderr
    assert calls == ["machine list --format json", WELCOME, INIT, START, INFO]
    assert default.read_text(encoding="utf-8") == "user-podman"
    assert not any("system connection" in call for call in calls)
    assert not any("machine rm" in call for call in calls)
    assert not any(call.endswith(" user-podman") for call in calls[1:])


def test_a_stopped_machine_is_started_not_recreated(tmp_path):
    result, calls = _enabler(tmp_path, machines=_machines(("jht-podman", False)))
    assert result.returncode == 0, result.stderr
    assert calls == ["machine list --format json", START, INFO]
    assert _phases(result.stdout) == ["podman_machine_start"]


def test_a_running_machine_is_only_checked(tmp_path):
    result, calls = _enabler(tmp_path, machines=_machines(("jht-podman", True)))
    assert result.returncode == 0, result.stderr
    assert calls == ["machine list --format json", INFO]
    assert _phases(result.stdout) == []


def test_v039_docker_volumes_are_reported_as_reinstallable_and_left_untouched(
    tmp_path,
):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(
        bin_dir,
        "docker.exe",
        '  "volume ls --format {{.Name}} --filter label=com.docker.compose.project=host-runtime") '
        "printf '%s\\n' host-runtime_jht-deps host-runtime_jht-runtime-mask; exit 0 ;;",
    )
    result, calls = _run(
        tmp_path,
        ENABLER,
        ["Report-LegacyDockerVolumes"],
        "Report-LegacyDockerVolumes -DockerPath $env:FAKE_DOCKER",
        {"FAKE_DOCKER": str(bin_dir / "docker.exe")},
    )

    assert result.returncode == 0, result.stderr
    assert calls == [
        "volume ls --format {{.Name}} --filter label=com.docker.compose.project=host-runtime"
    ]
    assert "only reinstallable provider CLI/cache" in result.stdout
    assert "empty runtime mask" in result.stdout
    assert "not copied to Podman" in result.stdout
    assert "host-runtime_jht-deps, host-runtime_jht-runtime-mask" in result.stdout


def test_a_stopped_docker_desktop_is_never_started_for_the_v039_inventory(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(
        bin_dir,
        "docker.exe",
        '  "volume ls --format {{.Name}} --filter label=com.docker.compose.project=host-runtime") '
        "exit 1 ;;",
    )
    result, calls = _run(
        tmp_path,
        ENABLER,
        ["Report-LegacyDockerVolumes"],
        "Report-LegacyDockerVolumes -DockerPath $env:FAKE_DOCKER",
        {"FAKE_DOCKER": str(bin_dir / "docker.exe")},
    )

    assert result.returncode == 0, result.stderr
    assert calls == [
        "volume ls --format {{.Name}} --filter label=com.docker.compose.project=host-runtime"
    ]
    assert "Docker Desktop was not started" in result.stdout
    # Whole argv words: "--format" contains "rm" as a substring.
    words = {word for call in calls for word in call.split()}
    assert words.isdisjoint({"start", "rm", "cp", "export"})


COMPOSE_BODY = r"""
$ComposeProviderVersion = '5.1.2'
$ComposeProviderUrl = 'https://example.invalid/docker-compose.exe'
$ComposeProviderSha256 = $env:EXPECTED_SHA
function Invoke-WebRequest {
  param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
  Add-Content -LiteralPath $env:FAKE_LOG -Value "download $Uri"
  [IO.File]::WriteAllText($OutFile, $env:PAYLOAD)
}
Install-PrivateComposeProvider -Destination $env:DEST
"""


@pytest.mark.parametrize(
    ("existing", "expected_sha_of", "downloads", "installed"),
    [
        (None, "compose-5.1.2", 1, True),
        (None, "another build", 1, False),
        ("compose-5.1.2", "compose-5.1.2", 0, True),
        ("compose-from-elsewhere", "compose-5.1.2", 1, True),
    ],
    ids=["downloads-and-verifies", "refuses-a-wrong-digest", "keeps-a-verified-copy", "replaces-a-foreign-copy"],
)
def test_the_private_compose_provider_is_installed_only_with_the_pinned_digest(
    tmp_path, existing, expected_sha_of, downloads, installed
):
    import hashlib

    runtime_bin = tmp_path / "host-runtime" / "bin"
    dest = runtime_bin / "docker-compose.exe"
    if existing is not None:
        runtime_bin.mkdir(parents=True)
        dest.write_text(existing, encoding="utf-8")
    result, calls = _run(
        tmp_path,
        ENABLER,
        ["Install-PrivateComposeProvider"],
        COMPOSE_BODY,
        {
            "DEST": str(dest),
            "PAYLOAD": "compose-5.1.2",
            "EXPECTED_SHA": hashlib.sha256(expected_sha_of.encode()).hexdigest(),
        },
    )

    assert calls == ["download https://example.invalid/docker-compose.exe"] * downloads
    if installed:
        assert result.returncode == 0, result.stderr
        assert dest.read_text(encoding="utf-8") == "compose-5.1.2"
    else:
        assert result.returncode != 0
        assert "has SHA-256" in result.stderr
        assert not dest.exists()
    # No partial download is ever left next to the provider.
    assert sorted(path.name for path in runtime_bin.iterdir()) == (["docker-compose.exe"] if installed else [])


# The app shows podman_start_failed only for exit code 22 (exit_failure):
# every failure of the machine step must end with 22, not with PowerShell's 1.
@pytest.mark.parametrize(
    ("machines", "initialize", "fail", "expected_calls"),
    [
        (_machines(), False, "", ["machine list --format json"]),
        (_machines(), True, "init", ["machine list --format json", WELCOME, INIT]),
        (_machines(("jht-podman", False)), True, "start", ["machine list --format json", START]),
        (_machines(("jht-podman", True)), True, "info", ["machine list --format json", INFO]),
        ("not json", True, "", ["machine list --format json"]),
    ],
    ids=["absent-without-init", "init-fails", "start-fails", "info-fails", "list-not-json"],
)
def test_a_failed_machine_step_exits_22(tmp_path, machines, initialize, fail, expected_calls):
    result, calls = _enabler(tmp_path, machines=machines, initialize=initialize, fail=fail)
    assert result.returncode == 22, (result.returncode, result.stderr[-600:])
    assert calls == expected_calls


# ---------------------------------------------------------------------------
# install.ps1: Test-WindowsSubsystem
# ---------------------------------------------------------------------------

WSL_BODY = r"""
function Write-Step { param([int]$N, [int]$Total, [string]$Title) }
function Write-Ok { param([string]$Msg) }
function Write-Dry { param([string]$Cmd) [Console]::Out.WriteLine("DRY $Cmd") }
$TotalSteps = 5
$DryRun = ($env:DRY_RUN -eq '1')
Test-WindowsSubsystem
"""


def _wsl(tmp_path, *, wsl_present: bool = True, status_exit: int = 0, dry_run: bool = False):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    if wsl_present:
        _fake(bin_dir, "wsl.exe", f'  "--status") exit {status_exit} ;;')
    return _run(
        tmp_path, INSTALLER, ["Test-WindowsSubsystem", "Write-JhtPhase"], WSL_BODY,
        {"DRY_RUN": "1" if dry_run else "0"},
    )


def test_wsl_that_answers_status_lets_the_install_go_on(tmp_path):
    result, calls = _wsl(tmp_path)
    assert result.returncode == 0, result.stderr
    assert calls == ["--status"]
    assert _phases(result.stdout) == ["wsl_check"]


@pytest.mark.parametrize(
    ("present", "status_exit", "message"),
    [(False, 0, "wsl.exe is unavailable"), (True, 1, "WSL is not usable")],
    ids=["no-wsl-exe", "status-fails"],
)
def test_unusable_wsl_exits_20_with_its_reason(tmp_path, present, status_exit, message):
    result, _ = _wsl(tmp_path, wsl_present=present, status_exit=status_exit)
    assert result.returncode == 20, result.stderr
    assert f"wsl_not_ready: {message}" in result.stderr


def test_a_dry_run_does_not_call_wsl(tmp_path):
    result, calls = _wsl(tmp_path, status_exit=1, dry_run=True)
    assert result.returncode == 0, result.stderr
    assert calls == []
    assert "DRY wsl.exe --status" in result.stdout


def test_the_next_launch_retries_wsl_after_the_user_enables_it(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(
        bin_dir,
        "wsl.exe",
        '  "--status") [ -f "$FAKE_STATE" ] && exit 0; exit 1 ;;',
    )
    env = {"DRY_RUN": "0"}

    first, first_calls = _run(
        tmp_path, INSTALLER, ["Test-WindowsSubsystem", "Write-JhtPhase"], WSL_BODY, env,
    )
    assert first.returncode == 20
    assert "wsl_not_ready: WSL is not usable" in first.stderr
    assert first_calls == ["--status"]

    (tmp_path / "state").write_text("enabled", encoding="utf-8")
    second, second_calls = _run(
        tmp_path, INSTALLER, ["Test-WindowsSubsystem", "Write-JhtPhase"], WSL_BODY, env,
    )
    assert second.returncode == 0, second.stderr
    assert _phases(second.stdout) == ["wsl_check"]
    assert second_calls == ["--status", "--status"]


# ---------------------------------------------------------------------------
# jht-wrapper.ps1: Start-PodmanMachineForUp (what `jht up` does first)
# ---------------------------------------------------------------------------

UP_BODY = r"""
$ContainerRuntime = $env:RUNTIME
$env:CONTAINER_CONNECTION = 'jht-podman'
Start-PodmanMachineForUp
"""

# docker answers only once the machine started (the state file), unless told otherwise.
DOCKER_CASES = """  "info") [ "$DOCKER" = up ] && exit 0; [ "$DOCKER" = after-start ] && [ -f "$FAKE_STATE" ] && exit 0; exit 1 ;;"""
UP_PODMAN_CASES = """  "machine start "*) [ "$FAKE_FAIL" = start ] && { echo 'Error: machine start failed' >&2; exit 125; }; case "$*" in *"--update-connection=false"*) ;; *) printf '%s' jht-podman > "$FAKE_DEFAULT" ;; esac; : > "$FAKE_STATE" ;;"""


def _up(tmp_path, *, runtime="podman", docker="after-start", podman=True, fail=""):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "docker", DOCKER_CASES)
    if podman:
        _fake(bin_dir, "podman.exe", UP_PODMAN_CASES)
    return _run(
        tmp_path, WRAPPER, ["Start-PodmanMachineForUp", "Test-DockerReachable", "Write-Err"], UP_BODY,
        {"RUNTIME": runtime, "DOCKER": docker, "FAKE_FAIL": fail},
    )


def test_docker_mode_never_touches_podman(tmp_path):
    result, calls = _up(tmp_path, runtime="docker", docker="down")
    assert result.returncode == 0, result.stderr
    assert calls == []


def test_a_machine_already_reachable_is_not_started_again(tmp_path):
    result, calls = _up(tmp_path, docker="up")
    assert result.returncode == 0, result.stderr
    assert calls == ["info"]


def test_an_unreachable_machine_is_started_with_the_named_connection(tmp_path):
    result, calls = _up(tmp_path)
    assert result.returncode == 0, result.stderr
    assert calls == ["info", START, "info"]


def test_up_does_not_replace_the_users_default_connection(tmp_path):
    default = tmp_path / "default-connection"
    default.write_text("user-podman", encoding="utf-8")
    result, calls = _up(tmp_path)
    assert result.returncode == 0, result.stderr
    assert calls == ["info", START, "info"]
    assert default.read_text(encoding="utf-8") == "user-podman"
    assert not any("system connection" in call for call in calls)


UNINSTALL_BODY = r"""
function Get-ScheduledTask { param($TaskName, $ErrorAction) return $null }
$code = Invoke-JhtWindowsUninstall -UninstallArgs @('--confirm') `
  -ProfilePath $env:TEST_PROFILE -LocalAppDataPath $env:TEST_LOCAL `
  -PodmanPath $env:FAKE_PODMAN -WslPath $env:FAKE_WSL -EnvironmentTarget Process
[Console]::Out.WriteLine("CODE=$code")
"""


UNINSTALL_PODMAN_CASES = """  "machine list --format json") if [ -f "$FAKE_STATE" ]; then printf '%s' '[{"Name":"jht-podman"},{"Name":"user-podman"}]'; else printf '%s' '[{"Name":"user-podman"}]'; fi ;;
  "machine rm --force jht-podman") rm -f "$FAKE_STATE" ;;
  "system connection "*) printf '%s' changed > "$FAKE_DEFAULT" ;;
  "machine rm "*) echo 'Error: machine rm failed' >&2; exit 125 ;;"""


def test_uninstall_removes_only_jht_and_preserves_the_users_default_connection(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "podman.exe", UNINSTALL_PODMAN_CASES)
    _fake(bin_dir, "wsl.exe", '  "--status") exit 0 ;;')
    (tmp_path / "state").write_text("present", encoding="utf-8")
    default = tmp_path / "default-connection"
    default.write_text("user-podman", encoding="utf-8")
    profile = tmp_path / "profile"
    local = tmp_path / "local"
    runtime = local / "Job Hunter Team" / "host-runtime"
    runtime.mkdir(parents=True)
    (runtime / "container-runtime").write_text("podman\n", encoding="utf-8")

    result, calls = _run(
        tmp_path,
        WRAPPER,
        [
            "Write-JhtUninstallPhase", "Write-JhtUninstallLeft",
            "Get-JhtNormalizedWindowsPath", "Get-JhtPodmanMachineState",
            "Remove-JhtUserEnvironment", "Remove-JhtStartupTask",
            "Invoke-JhtWindowsUninstall",
        ],
        UNINSTALL_BODY,
        {
            "TEST_PROFILE": str(profile), "TEST_LOCAL": str(local),
            "FAKE_PODMAN": str(bin_dir / "podman.exe"),
            "FAKE_WSL": str(bin_dir / "wsl.exe"),
        },
    )
    assert result.returncode == 0, result.stderr
    assert "CODE=0" in result.stdout
    assert default.read_text(encoding="utf-8") == "user-podman"
    assert "machine rm --force jht-podman" in calls
    assert not any(call.endswith(" user-podman") for call in calls)
    assert not any("system connection" in call for call in calls)
    assert not (tmp_path / "state").exists()
    assert not runtime.exists()


@pytest.mark.parametrize(
    ("podman", "docker", "fail", "code", "message"),
    [
        (False, "after-start", "", 21, "podman_not_installable"),
        (True, "after-start", "start", 22, "podman_machine_unavailable"),
        (True, "down", "", 22, "podman_machine_unavailable"),
    ],
    ids=["no-podman-exe", "start-fails", "started-but-unreachable"],
)
def test_up_names_why_the_machine_is_not_there(tmp_path, podman, docker, fail, code, message):
    result, _ = _up(tmp_path, podman=podman, docker=docker, fail=fail)
    assert result.returncode == code, (result.returncode, result.stderr[-600:])
    assert message in (result.stdout + result.stderr)


# ---------------------------------------------------------------------------
# Windows logon: the host starts exactly the JHT machine without opening Tauri
# ---------------------------------------------------------------------------

STARTUP_TASK_BODY = r"""
$script:Registered = $null
function New-ScheduledTaskAction {
  param($Execute, $Argument)
  [pscustomobject]@{ Execute = $Execute; Arguments = $Argument }
}
function New-ScheduledTaskTrigger {
  param([switch]$AtLogOn, $User)
  if (-not $AtLogOn) { throw 'not an at-logon trigger' }
  [pscustomobject]@{ UserId = $User }
}
function New-ScheduledTaskPrincipal {
  param($UserId, $LogonType, $RunLevel)
  [pscustomobject]@{ UserId = $UserId; LogonType = $LogonType; RunLevel = $RunLevel }
}
function New-ScheduledTaskSettingsSet {
  param([switch]$Hidden, [switch]$StartWhenAvailable,
        [switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries,
        $MultipleInstances, $ExecutionTimeLimit)
  if (-not $StartWhenAvailable -or $MultipleInstances -ne 'IgnoreNew') { throw 'unsafe settings' }
  [pscustomobject]@{ Hidden = [bool]$Hidden }
}
function Register-ScheduledTask {
  param($TaskName, $Action, $Trigger, $Principal, $Settings, $Description, [switch]$Force)
  if ($env:REGISTER_FAIL -eq '1') { throw 'registration failed' }
  if (-not $Force) { throw 'task is not idempotent' }
  $script:Registered = [pscustomobject]@{
    TaskName = $TaskName; Actions = @($Action); Triggers = @($Trigger)
    Principal = $Principal; Settings = $Settings; Description = $Description
  }
}
function Get-ScheduledTask { param($TaskName, $ErrorAction) $script:Registered }
Install-JhtStartupTask -PodmanPath 'C:\Program Files\RedHat\Podman\podman.exe' `
  -MachineName 'jht-podman' -UserId 'S-1-5-21-test'
[Console]::Out.WriteLine("TASK=$($script:Registered.TaskName)")
[Console]::Out.WriteLine("EXEC=$($script:Registered.Actions[0].Execute)")
[Console]::Out.WriteLine("ARGS=$($script:Registered.Actions[0].Arguments)")
[Console]::Out.WriteLine("USER=$($script:Registered.Principal.UserId)")
[Console]::Out.WriteLine("HIDDEN=$($script:Registered.Settings.Hidden)")
[Console]::Out.WriteLine("DESCRIPTION=$($script:Registered.Description)")
"""


def test_logon_task_is_visible_named_and_described_in_task_scheduler():
    source = ENABLER.read_text(encoding="utf-8")
    task = source[
        source.index("function Install-JhtStartupTask") : source.index(
            "if ($InstallDependencies)"
        )
    ]

    assert "$taskName = 'Job Hunter Team - Start runtime'" in task
    assert "New-ScheduledTaskSettingsSet -Hidden" not in task
    assert "-Description $description -Force" in task
    assert "[bool]$registered.Settings.Hidden -or" in task
    assert "([string]$registered.Description) -cne $description" in task


def test_logon_task_starts_only_the_named_jht_machine_as_the_current_user(tmp_path):
    result, calls = _run(
        tmp_path, ENABLER, ["Install-JhtStartupTask"], STARTUP_TASK_BODY,
        {"REGISTER_FAIL": "0"},
    )
    assert result.returncode == 0, result.stderr
    assert calls == []
    assert "TASK=Job Hunter Team - Start runtime" in result.stdout
    assert "EXEC=C:\\Program Files\\RedHat\\Podman\\podman.exe" in result.stdout
    assert "ARGS=machine start --update-connection=false jht-podman" in result.stdout
    assert "USER=S-1-5-21-test" in result.stdout
    assert "HIDDEN=False" in result.stdout
    assert (
        "DESCRIPTION=Starts the dedicated Job Hunter Team Podman machine at sign-in "
        "so the local team can resume after Windows restarts. It never starts or stops "
        "other Podman machines."
    ) in result.stdout

def test_install_fails_if_the_logon_task_cannot_be_published(tmp_path):
    result, _ = _run(
        tmp_path, ENABLER, ["Install-JhtStartupTask"], STARTUP_TASK_BODY,
        {"REGISTER_FAIL": "1"},
    )
    assert result.returncode != 0
    assert "registration failed" in result.stderr


LEGACY_SHIM_BODY = r"""
$owned = Test-AttestedLegacyDockerShim `
  -ManifestPath $env:TEST_MANIFEST -LegacyShimPath $env:TEST_LEGACY_SHIM
[Console]::Out.WriteLine("OWNED=$owned")
"""


def test_only_an_attested_legacy_path_shim_is_owned_by_jht(tmp_path):
    shim = tmp_path / "docker.exe"
    shim.write_bytes(b"old-jht-shim")
    import hashlib
    digest = hashlib.sha256(shim.read_bytes()).hexdigest()
    manifest = tmp_path / ".runtime-integrity"
    manifest.write_text(f"version=1\ndocker.exe={digest}\n", encoding="utf-8")
    env = {"TEST_MANIFEST": str(manifest), "TEST_LEGACY_SHIM": str(shim)}

    owned, _ = _run(
        tmp_path, ENABLER, ["Test-AttestedLegacyDockerShim"], LEGACY_SHIM_BODY, env,
    )
    assert owned.returncode == 0, owned.stderr
    assert "OWNED=True" in owned.stdout

    shim.write_bytes(b"the-user-replaced-this-file")
    foreign, _ = _run(
        tmp_path, ENABLER, ["Test-AttestedLegacyDockerShim"], LEGACY_SHIM_BODY, env,
    )
    assert foreign.returncode == 0, foreign.stderr
    assert "OWNED=False" in foreign.stdout


REMOVE_STARTUP_TASK_BODY = r"""
$script:Present = $true
function Get-ScheduledTask {
  param($TaskName, $ErrorAction)
  if ($script:Present) { [pscustomobject]@{ TaskName = $TaskName } }
}
function Unregister-ScheduledTask {
  param($TaskName, [switch]$Confirm, $ErrorAction)
  if ($TaskName -cne 'Job Hunter Team - Start runtime') { throw 'wrong task' }
  if ($Confirm) { throw 'interactive confirmation requested' }
  if ($env:UNREGISTER_FAIL -eq '1') { throw 'cannot unregister' }
  $script:Present = $false
}
if ((Remove-JhtStartupTask) -ne ($env:UNREGISTER_FAIL -ne '1')) { throw 'wrong removal result' }
"""


@pytest.mark.parametrize("fails", [False, True], ids=["removed-and-verified", "failure-is-reported"])
def test_uninstall_removes_and_verifies_the_exact_logon_task(tmp_path, fails):
    result, _ = _run(
        tmp_path, WRAPPER, ["Remove-JhtStartupTask"], REMOVE_STARTUP_TASK_BODY,
        {"UNREGISTER_FAIL": "1" if fails else "0"},
    )
    assert result.returncode == 0, result.stderr


# ---------------------------------------------------------------------------
# The manifest keys: one list in four places, two languages
# ---------------------------------------------------------------------------

def _rust_manifest_keys() -> set[str]:
    source = WINDOWS_RUNTIME_RS.read_text(encoding="utf-8")
    block = re.search(r"const MANIFEST_FILES: \[\(&str, Place, &str\); \d+\] = \[(.*?)\];", source, re.DOTALL)
    assert block, "MANIFEST_FILES not found in windows_runtime.rs"
    keys = set(re.findall(r'\(\s*"([^"]+)",\s*Place::', block.group(1)))
    assert keys, "MANIFEST_FILES read as empty"
    return keys


def _powershell_written_keys(text: str) -> set[str]:
    # "`n" is PowerShell's newline inside the manifest strings.
    text = text.replace("`n", "\n")
    return set(re.findall(r'(?m)(?:^|[\s"])([a-z][a-z0-9.\-]*)=\$[A-Za-z]*[Hh]ash', text))


def test_the_manifest_keys_are_the_same_in_the_app_the_installer_the_wrapper_and_the_gate():
    app = _rust_manifest_keys()
    assert '"runtime-image"' in WINDOWS_RUNTIME_RS.read_text(encoding="utf-8")

    wrapper = WRAPPER.read_text(encoding="utf-8")
    writer = wrapper[wrapper.index("function Write-RuntimeManifest"):wrapper.index("function Test-RuntimeBundleTrusted")]
    enabler_line = next(line for line in ENABLER.read_text(encoding="utf-8").splitlines()
                        if line.startswith('$manifest = "version=1'))
    selftest = SELFTEST.read_text(encoding="utf-8")
    gate_block = selftest[selftest.index("$appManifestFiles = [ordered]@{"):selftest.index("function Assert-AppManifest")]
    gate = set(re.findall(r"'([a-z0-9.\-]+)' = ", gate_block))

    optional = {"runtime-image"}
    assert _powershell_written_keys(writer) - optional == app, "Write-RuntimeManifest"
    assert _powershell_written_keys(enabler_line) == app, "the enabler (installer)"
    assert "runtime-image=$runtimeImageHash" in writer
    assert gate == app, "the ACL gate's E04 list"


# ── Which PowerShell compiles the docker.exe shim ────────────────────────────
#
# The enabler compiles the shim with Add-Type, and an executable built by
# Add-Type under pwsh (.NET) dies at start with an unhandled CLR exception
# (0xE0434352, ACL gate run 37890142762); built under Windows PowerShell 5.1
# (.NET Framework) it works. The product is safe only because the enabler always
# runs in powershell.exe 5.1: install.ps1 starts it by absolute path even when
# install.ps1 itself runs in pwsh, nothing else runs it, and nothing else
# compiles the shim. That is what this test holds, in both copies of the
# installer; test_windows_native_runtime_pieces.py compiles the shim only
# under 5.1 because of it.
POWERSHELL_51 = "$powerShell = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'"


@pytest.mark.parametrize("installer", [INSTALLER, ROOT / "web" / "public" / "install.ps1"], ids=["scripts", "web"])
def test_the_enabler_and_so_the_shim_always_run_in_windows_powershell_51(installer):
    text = installer.read_text(encoding="utf-8")
    start = text.index("function Invoke-PodmanRuntimeEnabler")
    function = text[start:text.index("\nfunction ", start + 1)]
    assert POWERSHELL_51 in function
    assert "& $powerShell @enablerArgs" in function
    assert "pwsh" not in function
    # The enabler is run only through that function, once.
    assert len(re.findall(r"(?m)^\s*Invoke-PodmanRuntimeEnabler\b", text)) == 1
    runs = [line for line in text.splitlines()
            if "enable-podman-windows-runtime.ps1" in line and re.search(r"(^|\s)(&|\.)\s|-File\b|Invoke-Expression", line)]
    assert runs == [], runs


def test_only_the_enabler_and_the_opt_in_probe_compile_a_docker_shim():
    compilers = sorted(path.name for path in SCRIPTS.glob("*.ps1")
                       if re.search(r"(?m)^\s*New-DockerShim\b", path.read_text(encoding="utf-8")))
    assert compilers == ["enable-podman-windows-runtime.ps1", "podman-windows-probe.ps1"]


# jht-wrapper.ps1: the folders the compose binds, before every up (T83)
# ---------------------------------------------------------------------------

# Like Podman: a bind whose source folder is missing is refused, the container is not created.
COMPOSE_UP_CASES = """  "compose "*" up -d") [ "$FAKE_FAIL" = up ] && { echo 'Error: compose up failed' >&2; exit 3; }; [ -d "$HOME/.jht" ] && [ -d "$HOME/Documents/Job Hunter Team" ] || { echo 'Error response from daemon: container create: statfs /mnt/c/Users/x/Documents/Job Hunter Team: no such file or directory' >&2; exit 1; } ;;"""

UP_FOLDERS_BODY = r"""
function Test-PrivateJhtHomeAcl { $true }
function Assert-TrustedRuntime {}
$ContainerRuntime = $env:RUNTIME
$ComposeFile = 'docker-compose.yml'; $PodmanComposeFile = 'docker-compose.podman.yml'; $RuntimeDir = '.'
if (-not (Repair-MountOwnership)) { Add-Content -LiteralPath $env:FAKE_LOG -Value 'repair-refused'; exit 1 }
Invoke-Compose 'up' '-d'
Add-Content -LiteralPath $env:FAKE_LOG -Value "up-exit=$LASTEXITCODE"
Stop-OnFailedComposeUp $LASTEXITCODE
Add-Content -LiteralPath $env:FAKE_LOG -Value 'after-up'
"""


def _up_with_folders(tmp_path, *, documents: bool, fail: str = ""):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _fake(bin_dir, "docker", COMPOSE_UP_CASES)
    if documents:
        (tmp_path / "Documents" / "Job Hunter Team").mkdir(parents=True)
        (tmp_path / "Documents" / "Job Hunter Team" / "cv.pdf").write_bytes(b"keep me")
    return _run(
        tmp_path, WRAPPER, ["Repair-MountOwnership", "Invoke-Compose", "Stop-OnFailedComposeUp", "Write-Err"], UP_FOLDERS_BODY,
        {"RUNTIME": "podman", "FAKE_FAIL": fail},
    )


def test_with_podman_up_creates_the_folders_the_compose_binds_on_a_new_machine(tmp_path):
    # a new user: neither ~/.jht nor ~/Documents/Job Hunter Team yet, and Podman does not create them
    result, calls = _up_with_folders(tmp_path, documents=False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert (tmp_path / ".jht").is_dir() and (tmp_path / "Documents" / "Job Hunter Team").is_dir()
    assert calls[-2:] == ["up-exit=0", "after-up"], calls


def test_with_podman_up_leaves_an_existing_documents_folder_as_it_is(tmp_path):
    result, calls = _up_with_folders(tmp_path, documents=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert (tmp_path / "Documents" / "Job Hunter Team" / "cv.pdf").read_bytes() == b"keep me"
    assert calls[-2:] == ["up-exit=0", "after-up"], calls


def test_a_failed_compose_up_stops_jht_with_its_code_and_nothing_after_it_runs(tmp_path):
    # before, the broker's migration ran after it and its own exit code said the start went well
    result, calls = _up_with_folders(tmp_path, documents=True, fail="up")
    assert result.returncode == 3, result.stdout + result.stderr
    assert "compose_up_failed" in result.stdout + result.stderr
    assert calls[-1] == "up-exit=3" and "after-up" not in calls, calls


def test_every_compose_up_of_the_wrapper_is_followed_by_its_exit_code_check():
    lines = WRAPPER.read_text(encoding="utf-8").splitlines()
    ups = [i for i, line in enumerate(lines) if line.strip() == "Invoke-Compose 'up' '-d'"]
    assert len(ups) == 3
    for i in ups:
        assert lines[i + 1].strip() == "Stop-OnFailedComposeUp $LASTEXITCODE", lines[i + 1]

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
podman.exe as an application. On Windows this file is skipped.
"""

from __future__ import annotations

import json
import os
import re
import shutil
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


def _pwsh() -> str:
    found = os.environ.get("JHT_TEST_PWSH") or shutil.which("pwsh")
    if found:
        return found
    if os.environ.get("CI"):
        pytest.fail("pwsh is missing on the CI runner: these branches would go untested")
    pytest.skip("pwsh not installed")


pytestmark = pytest.mark.skipif(os.name == "nt", reason="the fakes are POSIX sh scripts")

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
    path = directory / name
    path.write_text(FAKE.format(cases=cases), encoding="utf-8")
    path.chmod(0o755)


def _run(tmp_path: Path, script: Path, imports: list[str], body: str, env: dict[str, str]):
    prelude = tmp_path / "prelude.ps1"
    prelude.write_text(PRELUDE, encoding="utf-8")
    log = tmp_path / "calls.log"
    log.touch()
    run_env = {
        "PATH": f"{tmp_path / 'bin'}{os.pathsep}/usr/bin{os.pathsep}/bin",
        "HOME": str(tmp_path),
        "FAKE_LOG": str(log),
        "FAKE_STATE": str(tmp_path / "state"),
        "JHT_UNDER_TEST": str(script),
        "JHT_IMPORT": ",".join(imports),
        "JHT_CASE_BODY": body,
        **env,
    }
    result = subprocess.run(
        [_pwsh(), "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(prelude)],
        env=run_env, capture_output=True, text=True, timeout=120,
    )
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
. ([scriptblock]::Create($block.Extent.Text))
"""

PODMAN_CASES = """  "machine list --format json") printf '%s' "$FAKE_MACHINES"; exit "${FAKE_LIST_EXIT:-0}" ;;
  "machine init "*) [ "$FAKE_FAIL" = init ] && exit 125 ;;
  "machine start "*) [ "$FAKE_FAIL" = start ] && exit 125 ;;
  "--connection jht-podman info") [ "$FAKE_FAIL" = info ] && exit 125 ;;"""

INIT = "machine init --provider wsl --cpus 2 --memory 3072 --disk-size 30 jht-podman"
START = "machine start --update-connection=false jht-podman"
INFO = "--connection jht-podman info"


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
        },
    )


def test_an_absent_machine_is_created_in_wsl_then_started_then_checked(tmp_path):
    result, calls = _enabler(tmp_path, machines=_machines())
    assert result.returncode == 0, result.stderr
    assert calls == ["machine list --format json", INIT, START, INFO]
    assert _phases(result.stdout) == ["podman_machine_init", "podman_machine_start"]


def test_another_machine_with_a_different_name_is_not_ours(tmp_path):
    result, calls = _enabler(tmp_path, machines=_machines(("podman-machine-default", True)))
    assert result.returncode == 0, result.stderr
    assert INIT in calls and START in calls


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


# The app shows podman_start_failed only for exit code 22 (exit_failure):
# every failure of the machine step must end with 22, not with PowerShell's 1.
@pytest.mark.parametrize(
    ("machines", "initialize", "fail", "expected_calls"),
    [
        (_machines(), False, "", ["machine list --format json"]),
        (_machines(), True, "init", ["machine list --format json", INIT]),
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
UP_PODMAN_CASES = """  "machine start "*) [ "$FAKE_FAIL" = start ] && exit 125; : > "$FAKE_STATE" ;;"""


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

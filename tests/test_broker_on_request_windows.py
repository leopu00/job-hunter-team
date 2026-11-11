"""The mail broker is made at its first use on Windows too (T316): Ensure-Broker and Resume-Broker of jht-wrapper.ps1.

The functions are read out of the wrapper through the AST and run against stand-ins (the lookup of the running container, a
compose that records, a `docker` function, the fetch of the host scripts), under the PowerShell they are meant for
(5.1 and 7). Checked: a broker that runs is left alone; on Podman the network script (the broker's proxy and its start at boot)
runs BEFORE one compose call that names the broker alone; on Docker there is no network script; a failure at any step leaves no marker;
`jht up` makes nothing on a clean install and brings back a broker made before.

Run with: pytest tests/test_broker_on_request_windows.py -v   (needs PowerShell: pwsh off Windows)
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import WINDOWS, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
NETWORK = ROOT / "scripts" / "configure-podman-windows-network.ps1"
needs_powershell = pytest.mark.skipif(not WINDOWS and shutil.which("pwsh") is None, reason="needs PowerShell")

HARNESS = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($name in 'Write-EnsureLine', 'Invoke-BrokerNetwork', 'Get-ComposeLabel', 'Get-BrokerContainerState', 'Ensure-Broker', 'Resume-Broker', 'Invoke-ComposeQuiet') {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { throw "$name missing" }
  Invoke-Expression $fn.Extent.Text
}
function Write-Err { param([string]$Msg) Add-Content -LiteralPath $env:T_LOG -Value "ERR $Msg" }
function Write-Warn { param([string]$Msg) Add-Content -LiteralPath $env:T_LOG -Value "WARN $Msg" }
function Write-Info { param([string]$Msg) }
function Start-Sleep { param($Seconds) }
$RuntimeDir = $env:T_RUNTIME
$ComposeFile = Join-Path $RuntimeDir 'docker-compose.yml'
$BrokerContainer = 'jht-broker'
$BrokerMadeMarker = Join-Path $RuntimeDir '.broker-made'
$ContainerRuntime = $env:T_RUNTIME_KIND
$PodmanMachineBridgePath = Join-Path $RuntimeDir 'podman-machine-bridge.ps1'
$env:CONTAINER_CONNECTION = 'jht-podman'
$script:Declared = @(); if ($env:T_DECLARED -eq '1') { $script:Declared = @('configure-podman-windows-network.ps1', 'wsl-interop-connect-proxy.py') }
function Get-RunningComposeServiceId { param([string]$Service) if ((Get-Content -LiteralPath $env:T_STATE) -eq 'running') { return 'aaaaaaaaaaaa' }; return $null }
function Get-ComposeProjectName { return 'jht' }
function Test-RuntimeHelperDeclared { param([string]$Name) return ($script:Declared -contains $Name) }
function Test-RuntimeHelpersTrusted { return ($env:T_UNTRUSTED -ne '1') }
function Install-RuntimeHelpers {
  Add-Content -LiteralPath $env:T_LOG -Value 'INSTALL-HELPERS'
  if ($env:T_INSTALL_FAILS -eq '1') { return $false }
  $script:Declared = @('configure-podman-windows-network.ps1', 'wsl-interop-connect-proxy.py')
  return $true
}
function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments)] $Rest)
  Add-Content -LiteralPath $env:T_LOG -Value ('COMPOSE ' + (@($Rest) -join ' '))
  $global:LASTEXITCODE = [int]$env:T_UP_RC
  if ($env:T_UP_RC -eq '0' -and $env:T_NEVER_READY -ne '1') { Set-Content -LiteralPath $env:T_STATE -Value 'running' }
}
function docker {
  Add-Content -LiteralPath $env:T_LOG -Value ('DOCKER ' + ($args -join ' '))
  if ($args[0] -eq 'ps') { if ($env:T_EXISTS -ge '1') { 'bbbbbbbbbbbb' }; if ($env:T_EXISTS -eq '2') { 'cccccccccccc' }; $global:LASTEXITCODE = 0; return }
  if ($args[0] -eq 'inspect') {
    $run = if ((Get-Content -LiteralPath $env:T_STATE) -eq 'running') { 'true' } else { 'false' }
    $project = if ($env:T_FOREIGN -eq '1') { 'another' } else { 'jht' }
    $run + '|{"com.docker.compose.project":"' + $project + '","com.docker.compose.service":"jht-broker"}'
    $global:LASTEXITCODE = 0; return
  }
  $global:LASTEXITCODE = [int]$env:T_ADMIN_RC
}
function Invoke-BrokerMigrateLegacyOnce { Add-Content -LiteralPath $env:T_LOG -Value 'MIGRATE'; return 0 }
function Initialize-BrokerWebAuthorisations { Add-Content -LiteralPath $env:T_LOG -Value 'CONFIGURE' }
$result = & ([scriptblock]::Create($env:T_BODY))
"RESULT=$result"
"MARKER=" + (Test-Path -LiteralPath $BrokerMadeMarker)
"""


def _run(tmp_path: Path, body: str, *, state="absent", kind="podman", declared=True, net_rc="0", up_rc="0", exists=False,
         marker=False, install_fails=False, never_ready=False, admin_rc="0", untrusted=False, foreign=False, count=None):
    tmp_path.mkdir(parents=True, exist_ok=True)
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    (runtime / "docker-compose.yml").write_text("services:\n  jht:\n    image: x\n  jht-broker:\n    profiles: [broker]\n    image: x\n", encoding="utf-8")
    # the network script of the runtime: records how it was called and leaves with the code the test chose
    (runtime / "configure-podman-windows-network.ps1").write_text(
        "param([string]$MachineName, [string]$BridgeScript, [switch]$WithBroker)\n"
        "Add-Content -LiteralPath $env:T_LOG -Value ('NETWORK ' + $MachineName + ' bridge=' + (Split-Path -Leaf $BridgeScript) + ' broker=' + $WithBroker)\n"
        "exit [int]$env:T_NET_RC\n", encoding="utf-8")
    if marker:
        (runtime / ".broker-made").write_text("", encoding="utf-8")
    state_file = tmp_path / "state.txt"
    state_file.write_text(state, encoding="utf-8")
    log = tmp_path / "log.txt"
    log.write_text("", encoding="utf-8")
    harness = tmp_path / "harness.ps1"
    harness.write_text(HARNESS, encoding="utf-8")
    env = {
        **(windows_env(tmp_path) if WINDOWS else os.environ),
        "JHT_UNDER_TEST": str(WRAPPER), "T_RUNTIME": str(runtime), "T_STATE": str(state_file), "T_LOG": str(log), "T_BODY": body,
        "T_RUNTIME_KIND": kind, "T_DECLARED": "1" if declared else "0", "T_NET_RC": net_rc, "T_UP_RC": up_rc,
        "T_EXISTS": str(count) if count is not None else ("1" if exists else "0"), "T_FOREIGN": "1" if foreign else "0", "T_INSTALL_FAILS": "1" if install_fails else "0", "T_NEVER_READY": "1" if never_ready else "0",
        "T_ADMIN_RC": admin_rc, "T_UNTRUSTED": "1" if untrusted else "0",
    }
    done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=180)
    assert done.returncode == 0, done.stdout + done.stderr
    lines = [line.strip() for line in done.stdout.splitlines() if line.strip()]
    values = dict(line.split("=", 1) for line in lines if line.startswith(("RESULT=", "MARKER=")))
    return values, [line.strip() for line in log.read_text(encoding="utf-8").splitlines() if line.strip()]


@needs_powershell
def test_a_broker_that_runs_is_left_alone(tmp_path):
    values, calls = _run(tmp_path, "Ensure-Broker", state="running")
    assert values["RESULT"] == "0" and calls == []
    assert values["MARKER"] == "False"


@needs_powershell
def test_on_podman_the_network_script_runs_before_one_compose_call_that_names_the_broker_alone(tmp_path):
    values, calls = _run(tmp_path, "Ensure-Broker -Quiet")
    assert values["RESULT"] == "0", calls
    # what stands under the broker's name is looked up first (a read-only docker ps), then the network script runs
    assert calls[0].startswith("DOCKER ps -aq")
    assert calls[1] == "NETWORK jht-podman bridge=podman-machine-bridge.ps1 broker=True"
    compose_calls = [c for c in calls if c.startswith("COMPOSE")]
    assert compose_calls == ["COMPOSE --profile broker up -d --no-deps jht-broker"]  # never `jht`: the team is not recreated
    assert calls.index(compose_calls[0]) > 1
    assert "MIGRATE" in calls and "CONFIGURE" in calls
    assert values["MARKER"] == "True"


@needs_powershell
def test_on_docker_there_is_no_network_script(tmp_path):
    values, calls = _run(tmp_path, "Ensure-Broker -Quiet", kind="docker")
    assert values["RESULT"] == "0", calls
    assert not any(c.startswith(("NETWORK", "INSTALL-HELPERS")) for c in calls)
    assert [c for c in calls if c.startswith("COMPOSE")] == ["COMPOSE --profile broker up -d --no-deps jht-broker"]


@needs_powershell
def test_the_host_scripts_of_the_proxy_are_fetched_the_first_time(tmp_path):
    values, calls = _run(tmp_path, "Ensure-Broker -Quiet", declared=False)
    assert values["RESULT"] == "0", calls
    assert calls.count("INSTALL-HELPERS") == 1 and calls.index("INSTALL-HELPERS") < calls.index("NETWORK jht-podman bridge=podman-machine-bridge.ps1 broker=True")
    values, calls = _run(tmp_path / "fails", "Ensure-Broker -Quiet", declared=False, install_fails=True)
    assert values["RESULT"] == "1" and values["MARKER"] == "False"
    assert not any(c.startswith(("NETWORK", "COMPOSE")) for c in calls)
    assert any("broker_network_unavailable" in c for c in calls)


@needs_powershell
def test_a_helper_that_does_not_match_its_digest_is_never_run(tmp_path):
    values, calls = _run(tmp_path, "Ensure-Broker -Quiet", untrusted=True)
    assert values["RESULT"] == "1" and values["MARKER"] == "False"
    assert not any(c.startswith(("NETWORK", "COMPOSE")) for c in calls)


@needs_powershell
def test_a_network_script_that_fails_stops_before_any_compose_call(tmp_path):
    values, calls = _run(tmp_path, "Ensure-Broker -Quiet", net_rc="23")
    assert values["RESULT"] == "1" and values["MARKER"] == "False"
    assert not any(c.startswith("COMPOSE") for c in calls)
    assert any("broker_network_unavailable" in c and "23" in c for c in calls)


@needs_powershell
def test_a_failed_up_and_a_broker_that_never_answers_leave_no_marker(tmp_path):
    values, calls = _run(tmp_path, "Ensure-Broker -Quiet", up_rc="1")
    assert values["RESULT"] == "1" and values["MARKER"] == "False"
    assert any("broker_start_failed" in c for c in calls) and "MIGRATE" not in calls
    values, calls = _run(tmp_path / "never", "Ensure-Broker -Quiet", never_ready=True)
    assert values["RESULT"] == "1" and values["MARKER"] == "False"
    assert any("non risponde" in c for c in calls)


@needs_powershell
def test_an_old_compose_without_the_broker_points_to_upgrade(tmp_path):
    # _run writes the compose with the broker: swap it for an old one through the body, before the call
    body = "Set-Content -LiteralPath $ComposeFile -Value \"services:`n  jht:`n    image: x\"; Ensure-Broker -Quiet"
    values, calls = _run(tmp_path, body)
    assert values["RESULT"] == "1"
    assert any("jht upgrade" in c for c in calls) and not any(c.startswith(("NETWORK", "COMPOSE")) for c in calls)


@needs_powershell
def test_up_makes_no_broker_on_a_clean_install(tmp_path):
    values, calls = _run(tmp_path, "Resume-Broker; 'done'")
    assert values["MARKER"] == "False"
    assert not any(c.startswith(("COMPOSE", "NETWORK")) for c in calls)


@needs_powershell
def test_up_brings_back_a_broker_made_before_and_adopts_one_an_older_install_made(tmp_path):
    values, calls = _run(tmp_path / "before", "Resume-Broker; 'done'", marker=True)
    assert [c for c in calls if c.startswith("COMPOSE")] == ["COMPOSE --profile broker up -d --no-deps jht-broker"]
    assert not any(c.startswith("NETWORK") for c in calls)  # its units live in the machine; `up` does not rewrite them
    values, calls = _run(tmp_path / "adopt", "Resume-Broker; 'done'", state="running", exists=True)
    assert values["MARKER"] == "True"
    assert not any(c.startswith("COMPOSE") for c in calls)  # it runs already: nothing is remade


@needs_powershell
def test_up_starts_a_stopped_broker_of_ours_it_finds_by_name_but_never_a_foreign_one(tmp_path):
    # present, ours (project and service labels), not running: adopted and started
    values, calls = _run(tmp_path / "stopped", "Resume-Broker; 'done'", state="absent", exists=True)
    assert values["MARKER"] == "True"
    assert [c for c in calls if c.startswith("COMPOSE")] == ["COMPOSE --profile broker up -d --no-deps jht-broker"]
    # a container of that name that is another project's (or two of them): not adopted, not touched, no marker
    for label, kwargs in (("foreign", {"exists": True, "foreign": True}), ("two", {"count": 2})):
        values, calls = _run(tmp_path / label, "Resume-Broker; 'done'", state="running", **kwargs)
        assert values["MARKER"] == "False", label
        assert not any(c.startswith(("COMPOSE", "MIGRATE", "CONFIGURE")) for c in calls), label
    # even with the marker (a broker made before) a foreign one is not started over
    values, calls = _run(tmp_path / "marked", "Resume-Broker; 'done'", state="absent", exists=True, foreign=True, marker=True)
    assert not any(c.startswith(("COMPOSE", "MIGRATE")) for c in calls)
    assert any("broker_restart_failed" in c and "non lo tocco" in c for c in calls)


@needs_powershell
def test_a_broker_that_is_not_ours_is_not_made_over_by_ensure(tmp_path):
    values, calls = _run(tmp_path, "Ensure-Broker -Quiet", state="absent", exists=True, foreign=True)
    assert values["RESULT"] == "1" and values["MARKER"] == "False"
    assert not any(c.startswith(("NETWORK", "COMPOSE", "INSTALL-HELPERS")) for c in calls)
    assert any("broker_unavailable" in c and "non lo tocco" in c for c in calls)


# ── what the wrapper does around them (source) ───────────────────────────────

def _wrapper() -> str:
    return WRAPPER.read_text(encoding="utf-8")


def test_the_two_host_scripts_of_the_proxy_are_helpers_and_only_the_powershell_one_is_parsed():
    text = _wrapper()
    assert "$RuntimeHelpers = @('jht-integration.ps1', 'jht-tools.ps1', 'configure-podman-windows-network.ps1', 'wsl-interop-connect-proxy.py')" in text
    assert "if ($name -like '*.ps1') { [scriptblock]::Create($text) | Out-Null }" in text
    for path in (NETWORK, ROOT / "scripts" / "wsl-interop-connect-proxy.py"):
        assert re.search(r"(?m)^# JHT_RUNTIME_HELPER=1\r?$", path.read_text(encoding="utf-8")), path.name


def test_the_network_script_takes_the_bridge_from_where_the_wrapper_has_it():
    text = NETWORK.read_text(encoding="utf-8")
    assert "[string]$BridgeScript = (Join-Path $PSScriptRoot 'podman-machine-bridge.ps1')" in text
    assert ". $BridgeScript" in text


def test_every_whole_project_command_names_the_broker_profile_and_the_first_uses_make_the_broker():
    text = _wrapper()
    code = [line for line in text.splitlines() if not line.lstrip().startswith("#")]
    for line in code:
        if "'--profile' 'telegram'" in line and re.search(r"\b(down|ps)\b", line):
            assert "'--profile' 'broker'" in line or "'--profile', 'broker'" in line, line
    assert sum("Resume-Broker" in line for line in code) == 3  # the definition and the two ups
    assert re.search(r"\$made = Ensure-Broker\n  if \(\$made -ne 0\) \{ \$password = \$null; return \$made \}", text)  # mail setup
    assert "$brokerCode = Ensure-Broker" in text  # Telegram's start
    assert "if ((Ensure-Broker) -eq 0) { Initialize-BrokerWebAuthorisations }" in text  # the link of the site
    assert "(Ensure-Broker -Quiet 6>$null) -eq 0" in text  # the first click of a person, quiet for the app


def test_the_enabler_publishes_and_declares_all_four_helpers_so_a_fresh_install_is_not_fetched_from_the_branch_tip():
    enabler = (ROOT / "scripts" / "enable-podman-windows-runtime.ps1").read_text(encoding="utf-8")
    for name in ("jht-integration.ps1", "jht-tools.ps1", "configure-podman-windows-network.ps1", "wsl-interop-connect-proxy.py"):
        assert f"(Join-Path $PSScriptRoot '{name}') = (Join-Path $RuntimeDir '{name}')" in enabler, name
        assert f"(Join-Path $RuntimeDir '{name}')," in enabler, name   # the owner is set on it with the rest of the bundle
    manifest = next(line for line in enabler.splitlines() if "'.runtime-helpers'), \"jht-integration.ps1=" in line)
    for name, var in (("jht-integration.ps1", "$integrationHash"), ("jht-tools.ps1", "$toolsHash"),
                      ("configure-podman-windows-network.ps1", "$networkHash"), ("wsl-interop-connect-proxy.py", "$proxyHash")):
        assert f"{name}={var}" in manifest, name

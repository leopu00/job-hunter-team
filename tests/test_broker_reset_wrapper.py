"""Host-side reset of the broker's persistent Compose volumes.

The CLI owns the existing reset preview and confirmation.  It returns the
private exit code 20 only after a confirmed reset; the wrappers then stop the
Compose project and remove the three broker volumes by their Compose labels.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
RESET_COMMAND = ROOT / "cli" / "src" / "commands" / "reset.js"
VOLUMES = ("jht-secrets", "jht-broker-state", "jht-broker-sock")


def shell_functions(*names: str) -> str:
    source = SHELL_WRAPPER.read_text(encoding="utf-8")
    functions = []
    for name in names:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", source, re.S | re.M)
        assert match, name
        functions.append(match.group(0))
    return "\n".join(functions)


def run_shell_reset(
    tmp_path: Path,
    *,
    runtime: str,
    broker_running: bool,
    reset_code: int = 20,
) -> tuple[subprocess.CompletedProcess[str], Path, Path]:
    runtime_dir = tmp_path / "runtime"
    runtime_dir.mkdir()
    compose_file = runtime_dir / "docker-compose.yml"
    compose_file.write_text("services:\n  jht:\n  jht-broker:\n", encoding="utf-8")
    marker = runtime_dir / ".broker-legacy-migrated"
    marker.write_text("done\n", encoding="utf-8")
    log = tmp_path / "calls.log"
    body = rf'''
CONTAINER_RUNTIME={runtime!r}
RUNTIME_DIR={str(runtime_dir)!r}
COMPOSE_FILE={str(compose_file)!r}
BROKER_LEGACY_MARKER={str(marker)!r}
BROKER_VOLUME_NAMES="{' '.join(VOLUMES)}"
HOST_RESET_CONFIRMED_EXIT=20
ATTESTED_CONTAINER_ID=agent-id
EXEC_FLAGS=
JHT_HOST_TYPE=test
NODE_ENTRY=/app/cli/bin/jht.js
FAKE_RESET_CODE={reset_code}
FAKE_BROKER_RUNNING={1 if broker_running else 0}
LOG={str(log)!r}

info() {{ printf 'INFO %s\n' "$*" >> "$LOG"; }}
warn() {{ printf 'WARN %s\n' "$*" >> "$LOG"; }}
err() {{ printf 'ERR %s\n' "$*" >> "$LOG"; }}
ensure_up() {{ printf 'ensure_up broker=%s\n' "$FAKE_BROKER_RUNNING" >> "$LOG"; }}
compose_project_name() {{ printf '%s\n' jht; }}
compose() {{
  printf 'compose %s broker=%s\n' "$*" "$FAKE_BROKER_RUNNING" >> "$LOG"
  if [ "$1 $2 $3" = "config --format json" ]; then
    printf '%s\n' '{{' '  "name": "host-runtime",' '  "services": {{}}' '}}'
  fi
  return 0
}}
docker() {{
  printf 'docker %s\n' "$*" >> "$LOG"
  if [ "$1" = exec ]; then return "$FAKE_RESET_CODE"; fi
  if [ "$1 $2 $3" = "volume ls -q" ]; then
    project= logical=
    for arg in "$@"; do
      case "$arg" in
        label=com.docker.compose.project=*) project="${{arg##*=}}" ;;
        label=com.docker.compose.volume=*) logical="${{arg##*=}}" ;;
      esac
    done
    if [ "$CONTAINER_RUNTIME" = podman ]; then
      printf '%s_%s\n' "$project" jht-secrets
      printf '%s_%s\n' "$project" jht-broker-state
      printf '%s_%s\n' "$project" jht-broker-sock
    else
      printf '%s_%s\n' "$project" "$logical"
    fi
    return 0
  fi
  [ "$1 $2" = "volume rm" ] && return 0
  return 97
}}

{shell_functions('reset_compose_project_name', 'remove_broker_reset_data', 'reset_command')}
reset_command --scope creds --non-interactive --confirm-reset
code=$?
printf 'rc=%s\n' "$code"
exit "$code"
'''
    result = subprocess.run(
        ["bash", "-c", body],
        text=True,
        capture_output=True,
        timeout=20,
        check=False,
    )
    return result, log, marker


@pytest.mark.parametrize("runtime,project", [("docker", "host-runtime"), ("podman", "jht")])
@pytest.mark.parametrize("broker_running", [False, True], ids=["broker-down", "broker-up"])
def test_shell_reset_removes_all_broker_volumes_by_compose_labels(
    tmp_path: Path, runtime: str, project: str, broker_running: bool
):
    result, log, marker = run_shell_reset(
        tmp_path, runtime=runtime, broker_running=broker_running
    )

    assert result.returncode == 0, result.stderr
    calls = log.read_text(encoding="utf-8")
    assert "docker exec -e JHT_HOST_TYPE=test -e JHT_HOST_RESET_PROTOCOL=1 agent-id " in calls
    assert f"compose down broker={int(broker_running)}" in calls
    for logical in VOLUMES:
        assert f"label=com.docker.compose.project={project}" in calls
        if runtime == "docker":
            assert f"label=com.docker.compose.volume={logical}" in calls
        assert f"docker volume rm {project}_{logical}" in calls
        assert f"Cancellato: volume broker {logical}" in calls
    assert not marker.exists()
    assert "rifai i login dei portali" in calls


def test_shell_reset_cancellation_never_stops_compose_or_removes_volumes(tmp_path: Path):
    result, log, marker = run_shell_reset(
        tmp_path, runtime="docker", broker_running=True, reset_code=0
    )

    assert result.returncode == 0
    calls = log.read_text(encoding="utf-8")
    assert "JHT_HOST_RESET_PROTOCOL=1" in calls
    assert "compose down" not in calls
    assert "volume rm" not in calls
    assert marker.exists()


def powershell_reset_functions() -> str:
    source = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    start = source.index("function Get-ComposeProjectName {")
    end = source.index("function Invoke-MailSetup {", start)
    return source[start:end]


POWERSHELL = shutil.which("pwsh") or shutil.which("powershell")


def run_powershell_reset(
    tmp_path: Path,
    *,
    runtime: str,
    broker_running: bool,
    reset_code: int = 20,
) -> tuple[subprocess.CompletedProcess[str], Path, Path]:
    runtime_dir = tmp_path / "runtime"
    runtime_dir.mkdir()
    marker = runtime_dir / ".broker-legacy-migrated"
    marker.write_text("done\n", encoding="utf-8")
    log = tmp_path / "calls.log"
    script = tmp_path / "reset-harness.ps1"
    functions = powershell_reset_functions()
    script.write_text(
        rf'''
$ContainerRuntime = {runtime!r}
$RuntimeDir = {str(runtime_dir)!r}
$ComposeFile = Join-Path $RuntimeDir 'docker-compose.yml'
$BrokerLegacyMarker = {str(marker)!r}
$BrokerVolumeNames = @('jht-secrets', 'jht-broker-state', 'jht-broker-sock')
$HostResetConfirmedExit = 20
$ExecFlags = @()
$Container = 'agent-id'
$NodeEntry = '/app/cli/bin/jht.js'
$env:JHT_HOST_TYPE = 'test'
$env:FAKE_RESET_CODE = {str(reset_code)!r}
$env:FAKE_BROKER_RUNNING = {str(int(broker_running))!r}
$Log = {str(log)!r}

function Add-Call([string]$Text) {{ Add-Content -LiteralPath $Log -Value $Text }}
function Write-Info([string]$Text) {{ Add-Call "INFO $Text" }}
function Write-Warn([string]$Text) {{ Add-Call "WARN $Text" }}
function Write-Err([string]$Text) {{ Add-Call "ERR $Text" }}
function Ensure-Up {{ Add-Call "ensure_up broker=$env:FAKE_BROKER_RUNNING" }}
function Invoke-Compose {{
  Add-Call "compose $($args -join ' ') broker=$env:FAKE_BROKER_RUNNING"
  $global:LASTEXITCODE = 0
}}
function docker {{
  $argv = @($args)
  Add-Call "docker $($argv -join ' ')"
  if ($argv[0] -eq 'exec') {{
    $global:LASTEXITCODE = [int]$env:FAKE_RESET_CODE
    return
  }}
  if ($argv[0] -eq 'compose') {{
    Write-Output '{{"name":"host-runtime"}}'
    $global:LASTEXITCODE = 0
    return
  }}
  if ($argv[0] -eq 'volume' -and $argv[1] -eq 'ls') {{
    $projectArg = @($argv | Where-Object {{ "$_" -like 'label=com.docker.compose.project=*' }})[0]
    $project = $projectArg.Substring($projectArg.LastIndexOf('=') + 1)
    if ($ContainerRuntime -eq 'podman') {{
      Write-Output "${{project}}_jht-secrets"
      Write-Output "${{project}}_jht-broker-state"
      Write-Output "${{project}}_jht-broker-sock"
    }} else {{
      $logicalArg = @($argv | Where-Object {{ "$_" -like 'label=com.docker.compose.volume=*' }})[0]
      $logical = $logicalArg.Substring($logicalArg.LastIndexOf('=') + 1)
      Write-Output "${{project}}_${{logical}}"
    }}
    $global:LASTEXITCODE = 0
    return
  }}
  if ($argv[0] -eq 'volume' -and $argv[1] -eq 'rm') {{
    $global:LASTEXITCODE = 0
    return
  }}
  $global:LASTEXITCODE = 97
}}

{functions}
$code = Invoke-ResetCommand @('--scope', 'creds', '--non-interactive', '--confirm-reset')
Write-Output "rc=$code"
exit [int]$code
''',
        encoding="utf-8",
    )
    result = subprocess.run(
        [POWERSHELL, "-NoProfile", "-NonInteractive", "-File", str(script)],
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )
    return result, log, marker


@pytest.mark.skipif(POWERSHELL is None, reason="PowerShell is not installed")
@pytest.mark.parametrize("runtime,project", [("docker", "host-runtime"), ("podman", "jht")])
@pytest.mark.parametrize("broker_running", [False, True], ids=["broker-down", "broker-up"])
def test_powershell_reset_removes_all_broker_volumes_by_compose_labels(
    tmp_path: Path, runtime: str, project: str, broker_running: bool
):
    result, log, marker = run_powershell_reset(
        tmp_path, runtime=runtime, broker_running=broker_running
    )

    assert result.returncode == 0, result.stderr
    calls = log.read_text(encoding="utf-8")
    assert "-e JHT_HOST_TYPE=test -e JHT_HOST_RESET_PROTOCOL=1 agent-id" in calls
    assert f"compose down broker={int(broker_running)}" in calls
    for logical in VOLUMES:
        assert f"label=com.docker.compose.project={project}" in calls
        if runtime == "docker":
            assert f"label=com.docker.compose.volume={logical}" in calls
        assert f"docker volume rm {project}_{logical}" in calls
        assert f"Cancellato: volume broker {logical}" in calls
    assert not marker.exists()
    assert "rifai i login dei portali" in calls


def test_cli_and_both_wrappers_share_the_confirmed_reset_contract():
    cli = RESET_COMMAND.read_text(encoding="utf-8")
    shell = SHELL_WRAPPER.read_text(encoding="utf-8")
    powershell = POWERSHELL_WRAPPER.read_text(encoding="utf-8")

    for logical in VOLUMES:
        assert logical in cli
        assert logical in shell
        assert logical in powershell
    assert "JHT_HOST_RESET_PROTOCOL" in cli
    assert "HOST_RESET_CONFIRMED_EXIT = 20" in cli
    assert "JHT_HOST_RESET_PROTOCOL=1" in shell
    assert "JHT_HOST_RESET_PROTOCOL=1" in powershell
    assert "Portal and mailbox logins will need to be configured again" in cli


def test_powershell_reset_contract_targets_only_attested_broker_volumes():
    source = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    start = source.index("function Get-ComposeProjectName {")
    end = source.index("function Invoke-MailSetup {", start)
    reset = source[start:end]

    assert "if ($ContainerRuntime -eq 'podman') { return 'jht' }" in reset
    assert "ConvertFrom-Json -ErrorAction Stop" in reset
    assert "Invoke-Compose down" in reset
    assert 'label=com.docker.compose.project=$project' in reset
    assert 'label=com.docker.compose.volume=$logical' in reset
    assert 'Where-Object { $_ -eq "${project}_${logical}" }' in reset
    assert "& docker volume rm $id" in reset
    assert "Remove-Item -LiteralPath $BrokerLegacyMarker" in reset
    assert "if ($code -ne $HostResetConfirmedExit) { return $code }" in reset

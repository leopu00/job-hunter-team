"""Reject the 0.3.9 Docker upgrade before pull, snapshot or activation.

Real Compose parsers, no daemon: the legacy preflight fragments below are from
v0.3.9 (POSIX 1287-1298, Windows 1157-1164). Downloads are local copies.
"""

from __future__ import annotations

import os
from pathlib import Path
import re
import shutil
import subprocess

import pytest

from windows_native_fakes import WINDOWS, install_fake, powershell_argv

ROOT = Path(__file__).resolve().parents[1]
READY = "JHT_PODMAN_RUNTIME_READY"


def docker_compose():
    standalone = shutil.which("docker-compose")
    if standalone:
        return [standalone]
    docker = shutil.which("docker")
    if docker and subprocess.run([docker, "compose", "version"], capture_output=True).returncode == 0:
        return [docker, "compose"]
    pytest.skip("Docker Compose is not installed")


def environment(tmp_path, ready=None):
    env = {**os.environ, "HOME": str(tmp_path), "COMPOSE_PROFILES": ""}
    env.pop(READY, None)
    if ready is not None:
        env[READY] = ready
    return env


@pytest.mark.parametrize("provider", ["docker", "podman"])
@pytest.mark.parametrize("ready", [None, "", "1"])
def test_compose_requires_the_migration_marker(tmp_path, provider, ready):
    if provider == "docker":
        command = [*docker_compose(), "-f", str(ROOT / "docker-compose.yml"), "config", "-q"]
    else:
        compose = shutil.which("podman-compose")
        if not compose:
            pytest.skip("podman-compose is not installed")
        podman = install_fake(tmp_path, "podman.exe" if WINDOWS else "podman", '#!/bin/sh\necho "6.1.3"\n')
        command = [compose, "--podman-path", str(podman), "-f", str(ROOT / "docker-compose.yml"), "config"]
    done = subprocess.run(command, env=environment(tmp_path, ready), capture_output=True, text=True, timeout=60)
    if ready:
        assert done.returncode == 0, done.stdout + done.stderr
    else:
        assert done.returncode != 0
        assert "runtime_change_requires_migration" in done.stderr
        assert "migrate the Docker installation" in done.stderr


# Kept as released, including the generic legacy result when config fails.
POSIX_PREFLIGHT = r'''
  release_base="$(attested_raw_base)" || {
    upgrade_result false false preflight "$old_version" "$old_image" "$old_version" "$old_image" false "Release host non attestabile" false
    return 1
  }
  if ! upgrade_run curl -fsSL "${release_base%/}/docker-compose.yml" -o "$candidate_compose" \
      || ! upgrade_run curl -fsSL "${release_base%/}/scripts/jht-wrapper.sh" -o "$candidate_wrapper" \
      || ! bash -n "$candidate_wrapper" \
      || ! grep -Fqx 'JHT_HOST_RUNTIME_PROTOCOL=1' "$candidate_wrapper" \
      || ! grep -Eq '^[[:space:]]*-[[:space:]]*jht-runtime-mask:/jht_home/runtime([[:space:]]|$)' "$candidate_compose" \
      || ! upgrade_run upgrade_compose "$candidate_compose" config -q; then
    upgrade_result false false preflight "$old_version" "$old_image" "$old_version" "$old_image" false "Runtime remoto non valido o non raggiungibile" false
    return 1
  fi
'''

WINDOWS_PREFLIGHT = r'''
    try {
      $releaseBase = Get-AttestedRawBase
      Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/docker-compose.yml" -OutFile $newCompose
      Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/scripts/jht-wrapper.ps1" -OutFile $newWrapper
      [scriptblock]::Create((Get-Content -LiteralPath $newWrapper -Raw)) | Out-Null
      if (-not (Select-String -LiteralPath $newWrapper -SimpleMatch '$JHT_HOST_RUNTIME_PROTOCOL = 1' -Quiet)) { throw 'wrapper runtime protocol missing' }
      if (-not (Select-String -LiteralPath $newCompose -Pattern '^\s*-\s*jht-runtime-mask:/jht_home/runtime(?:\s|$)' -Quiet)) { throw 'compose runtime mask missing' }
    } catch { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false 'Runtime remoto non valido o non raggiungibile' $false; return 1 }
    if (-not (Invoke-UpgradeCompose $newCompose 'config' '-q')) { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false 'Compose remoto non valido' $false; return 1 }
'''


@pytest.mark.parametrize("shell", ["posix", "windows"])
def test_039_preflight_leaves_the_existing_runtime_and_team_untouched(tmp_path, shell):
    compose_command = docker_compose()
    # Keep the existing metadata, team state and user data separate from download staging.
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    for name in ("docker-compose.yml", "wrapper", ".runtime-integrity", "team-running", "user-data"):
        (runtime / name).write_text("existing " + name)
    before = {p.name: p.read_bytes() for p in runtime.iterdir()}
    stage = tmp_path / "stage"
    stage.mkdir()
    env = {**environment(tmp_path), "SOURCE": str(ROOT), "STAGE": str(stage),
           "RUNTIME": str(runtime), "COMPOSE_EXE": compose_command[0],
           "COMPOSE_PLUGIN": "1" if len(compose_command) > 1 else "0"}
    if shell == "posix":
        harness = r'''
old_version=0.3.9; old_image=old; RUNTIME_DIR="$RUNTIME"
candidate_compose="$STAGE/docker-compose.yml"; candidate_wrapper="$STAGE/jht-wrapper.sh"
attested_raw_base() { printf '%s' "$SOURCE"; }
curl() { cp "$2" "$4"; }
upgrade_run() { "$@"; }
upgrade_result() { echo "result=$3"; }
upgrade_compose() {
  local file="$1"; shift
  echo "$*" >> "$STAGE/calls"
  if [ "$COMPOSE_PLUGIN" = 1 ]; then
    "$COMPOSE_EXE" compose -f "$file" --project-directory "$RUNTIME_DIR" "$@"
  else
    "$COMPOSE_EXE" -f "$file" --project-directory "$RUNTIME_DIR" "$@"
  fi
}
preflight() {
''' + POSIX_PREFLIGHT + r'''
  echo activated > "$RUNTIME/team-running"
  upgrade_compose "$candidate_compose" pull jht
  upgrade_compose "$candidate_compose" up -d --force-recreate jht
}
preflight
'''
        command = ["bash", "-c", harness]
    else:
        harness = r'''
$ErrorActionPreference = 'Stop'
$oldVersion = '0.3.9'; $oldImage = 'old'; $RuntimeDir = $env:RUNTIME
$newCompose = Join-Path $env:STAGE 'docker-compose.yml'
$newWrapper = Join-Path $env:STAGE 'jht-wrapper.ps1'
function Get-AttestedRawBase { return $env:SOURCE }
function Invoke-WebRequest { param([switch]$UseBasicParsing, $Uri, $OutFile) Copy-Item -LiteralPath $Uri -Destination $OutFile }
function Write-UpgradeResult { [Console]::Out.WriteLine('result=preflight') }
function Invoke-UpgradeCompose {
  param([string]$File, [Parameter(ValueFromRemainingArguments)] [string[]]$ComposeArgs)
  Add-Content -LiteralPath (Join-Path $env:STAGE 'calls') -Value ($ComposeArgs -join ' ')
  $all = @(); if ($env:COMPOSE_PLUGIN -eq '1') { $all += 'compose' }
  $all += @('-f', $File, '--project-directory', $RuntimeDir) + $ComposeArgs
  & $env:COMPOSE_EXE @all
  return $LASTEXITCODE -eq 0
}
function Test-LegacyPreflight {
''' + WINDOWS_PREFLIGHT + r'''
  Set-Content -LiteralPath (Join-Path $env:RUNTIME 'team-running') -Value 'activated'
  $null = Invoke-UpgradeCompose $newCompose 'pull' 'jht'
  $null = Invoke-UpgradeCompose $newCompose 'up' '-d' '--force-recreate' 'jht'
  return 0
}
exit (Test-LegacyPreflight)
'''
        path = tmp_path / "preflight.ps1"
        path.write_text(harness)
        command = [*powershell_argv(), "-File", str(path)]
    done = subprocess.run(command, env=env, capture_output=True, text=True, timeout=60)
    assert done.returncode == 1, done.stdout + done.stderr
    assert "result=preflight" in done.stdout
    assert "runtime_change_requires_migration" in done.stderr
    assert (stage / "calls").read_text().strip() == "config -q"
    assert {p.name: p.read_bytes() for p in runtime.iterdir()} == before


@pytest.mark.parametrize("previous", [None, "caller-value"])
@pytest.mark.parametrize("command_fails", [False, True])
def test_windows_marker_is_scoped_to_a_verified_podman_call(tmp_path, previous, command_fails):
    source = (ROOT / "scripts/jht-wrapper.ps1").read_text()
    function = re.search(r"^function Invoke-WithPodmanComposeRuntime \{.*?^\}", source, re.M | re.S).group()
    harness = r'''
$ErrorActionPreference = 'Stop'
function Assert-TrustedRuntime { if ($env:JHT_PODMAN_RUNTIME_READY) { throw 'marker before verification' } }
function docker { $global:LASTEXITCODE = $script:EngineCode }
function Get-JhtText { param($Key) return $Key }
''' + function + r'''
foreach ($runtime in @('docker', 'podman')) {
  foreach ($engineCode in @(0, 1)) {
    $ContainerRuntime = $runtime; $script:EngineCode = $engineCode
    $previous = $env:PRIOR_READY
    if ($null -eq $previous) { Remove-Item Env:JHT_PODMAN_RUNTIME_READY -ErrorAction SilentlyContinue }
    else { $env:JHT_PODMAN_RUNTIME_READY = $previous }
    $failed = $false; $script:RanCompose = $false
    try {
      Invoke-WithPodmanComposeRuntime {
        $script:RanCompose = $true
        if ($ContainerRuntime -eq 'podman') {
          if ($env:JHT_PODMAN_RUNTIME_READY -cne '1') { throw 'Podman marker missing' }
        } elseif ($env:JHT_PODMAN_RUNTIME_READY) { throw 'Docker marker present' }
        if ($env:COMMAND_FAILS -eq '1') { throw 'compose failed' }
      }
    } catch { $failed = $true }
    $shouldRun = ($runtime -eq 'docker' -or $engineCode -eq 0)
    if ($script:RanCompose -ne $shouldRun) { throw 'wrong runtime accepted' }
    $shouldFail = (-not $shouldRun -or $env:COMMAND_FAILS -eq '1')
    if ($failed -ne $shouldFail) { throw 'wrong Compose result' }
    if ($env:JHT_PODMAN_RUNTIME_READY -cne $previous) { throw 'caller environment changed' }
  }
}
'''
    path = tmp_path / "marker.ps1"
    path.write_text(harness)
    env = {**os.environ, "COMMAND_FAILS": "1" if command_fails else "0"}
    env.pop("PRIOR_READY", None)
    if previous is not None:
        env["PRIOR_READY"] = previous
    done = subprocess.run([*powershell_argv(), "-File", str(path)], env=env, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr


@pytest.mark.parametrize("operation", ["Invoke-Compose", "Invoke-UpgradeCompose", "Get-ComposeImage"])
def test_windows_compose_paths_validate_the_new_project(tmp_path, operation):
    compose_command = docker_compose()
    source = (ROOT / "scripts/jht-wrapper.ps1").read_text()
    functions = "\n".join(re.search(rf"^function {name} \{{.*?^\}}", source, re.M | re.S).group()
                          for name in ("Invoke-WithPodmanComposeRuntime", operation))
    harness = r'''
$ErrorActionPreference = 'Stop'
$ContainerRuntime = 'podman'; $RuntimeDir = $env:BOX; $JhtHome = $env:BOX
$ComposeFile = Join-Path $env:SOURCE 'docker-compose.yml'
$PodmanComposeFile = Join-Path $env:SOURCE 'docker-compose.podman.yml'
function Assert-TrustedRuntime {}
function Test-PrivateJhtHomeAcl { return $true }
function docker {
  if ($args[0] -eq 'info') { $global:LASTEXITCODE = 0; return }
  if ($env:JHT_PODMAN_RUNTIME_READY -cne '1') { throw 'Compose without verified marker' }
  $all = @($args); if ($env:COMPOSE_PLUGIN -ne '1') { $all = @($args | Select-Object -Skip 1) }
  & $env:COMPOSE_EXE @all
}
''' + functions + r'''
$env:JHT_PODMAN_RUNTIME_READY = 'caller-value'
switch ($env:OPERATION) {
  'Invoke-Compose' { Invoke-Compose 'config' '-q'; if ($LASTEXITCODE -ne 0) { throw 'config failed' } }
  'Invoke-UpgradeCompose' { if (-not (Invoke-UpgradeCompose $ComposeFile 'config' '-q')) { throw 'upgrade config failed' } }
  'Get-ComposeImage' { if ((Get-ComposeImage $ComposeFile) -notmatch '^ghcr.io/leopu00/jht@sha256:') { throw 'image lookup failed' } }
}
if ($env:JHT_PODMAN_RUNTIME_READY -cne 'caller-value') { throw 'caller environment changed' }
'''
    path = tmp_path / "compose-path.ps1"
    path.write_text(harness)
    env = {**environment(tmp_path), "SOURCE": str(ROOT), "BOX": str(tmp_path), "OPERATION": operation,
           "COMPOSE_EXE": compose_command[0], "COMPOSE_PLUGIN": "1" if len(compose_command) > 1 else "0"}
    done = subprocess.run([*powershell_argv(), "-File", str(path)], env=env, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr


@pytest.mark.parametrize("mode", ["machine", "native"])
@pytest.mark.parametrize("operation", ["compose_file_run", "podman_expected_config_hash"])
@pytest.mark.parametrize("engine_ready", [True, False])
def test_posix_every_podman_compose_path_supplies_its_own_marker(tmp_path, mode, operation, engine_ready):
    source = (ROOT / "scripts/jht-wrapper.sh").read_text()
    function = re.search(rf"^{operation}\(\) \{{.*?^\}}", source, re.M | re.S).group()
    provider = tmp_path / "provider"
    provider.write_text('#!/bin/sh\necho "$JHT_PODMAN_RUNTIME_READY" >> "$MARKER_LOG"\n'
                        'echo "podman create --name=jht --label io.podman.compose.config-hash=' + 'a' * 64 + ' jht"\n')
    provider.chmod(0o700)
    podman = tmp_path / "podman"
    podman.write_text('#!/bin/sh\nexit "$ENGINE_CODE"\n')
    podman.chmod(0o700)
    harness = r'''
set -u
CONTAINER_RUNTIME=podman; PODMAN_RUNTIME_MODE="$MODE"; PODMAN_MACHINE_NAME=jht-podman
RUNTIME_DIR="$BOX"; RUNTIME_IMAGE_PIN="$BOX/no-pin"; RUNTIME_TIER_FILE="$BOX/no-tier"
COMPOSE_ALL_PROFILES=broker,telegram
compose_project_name() { echo jht; }
podman_ensure_on_path() { :; }
podman_binary() { echo "$BOX/podman"; }
podman_compose_binary() { echo "$BOX/provider"; }
podman_compose_pair_supported() { return 0; }
podman_native_rootless() { return "$ENGINE_CODE"; }
podman_native_override_ensure() { echo "$BOX/override"; }
podman_native_no_pod_arg() { echo --in-pod=false; }
runtime_extras_digest() { return 1; }
err() { echo "$*" >&2; }
jht_say() { echo "$*"; }
''' + function + '\n' + operation + ' "$BOX/compose.yml" ' + ('jht' if operation == 'podman_expected_config_hash' else 'config') + '\n'
    log = tmp_path / "marker-log"
    done = subprocess.run(["bash", "-c", harness], env={**os.environ, "BOX": str(tmp_path), "MODE": mode,
                          "ENGINE_CODE": "0" if engine_ready else "1", READY: "caller-value", "MARKER_LOG": str(log)},
                          capture_output=True, text=True, timeout=30)
    if engine_ready:
        assert done.returncode == 0, done.stdout + done.stderr
        assert log.read_text().strip() == "1"
    else:
        assert done.returncode != 0
        assert not log.exists()

"""The Podman compatibility marker under the native Windows gate's selected shell."""

from __future__ import annotations

import os
import re
import subprocess

import pytest

from windows_native_fakes import powershell_argv
from test_upgrade_docker_requires_podman import (
    ROOT, docker_compose, environment,
    legacy_preflight_leaves_the_existing_runtime_and_team_untouched,
)


def test_039_windows_preflight_leaves_the_existing_runtime_and_team_untouched(tmp_path):
    legacy_preflight_leaves_the_existing_runtime_and_team_untouched(tmp_path, "windows")


@pytest.mark.parametrize("previous", [None, "caller-value"])
@pytest.mark.parametrize("command_fails", [False, True])
def test_windows_marker_is_scoped_to_a_verified_podman_call(tmp_path, previous, command_fails):
    source = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8")
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
    path.write_text(harness, encoding="utf-8")
    env = {**os.environ, "COMMAND_FAILS": "1" if command_fails else "0"}
    env.pop("PRIOR_READY", None)
    if previous is not None:
        env["PRIOR_READY"] = previous
    done = subprocess.run([*powershell_argv(), "-File", str(path)], env=env, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr


@pytest.mark.parametrize("operation", ["Invoke-Compose", "Invoke-UpgradeCompose", "Get-ComposeImage"])
def test_windows_compose_paths_validate_the_new_project(tmp_path, operation):
    compose_command = docker_compose()
    source = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8")
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
    path.write_text(harness, encoding="utf-8")
    env = {**environment(tmp_path), "SOURCE": str(ROOT), "BOX": str(tmp_path), "OPERATION": operation,
           "COMPOSE_EXE": compose_command[0], "COMPOSE_PLUGIN": "1" if len(compose_command) > 1 else "0"}
    done = subprocess.run([*powershell_argv(), "-File", str(path)], env=env, capture_output=True, text=True, timeout=60)
    assert done.returncode == 0, done.stdout + done.stderr

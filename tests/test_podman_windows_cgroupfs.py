"""The Podman service of the Windows machine runs under cgroupfs, and the setup checks it.

In Podman's WSL machine every cgroup systemd holds sits under /non-systemd with no controller: the
root of the WSL VM enables none. Under the systemd manager rootless Podman gives every container a
pids limit of 2048, and crun refuses to start it, "controller pids is not available" (T87). Under
cgroupfs rootless Podman sets no pids limit. The unit used to ask for cgroupfs through the variable
CONTAINERS_CGROUP_MANAGER, which is not a Podman setting: the service ran under systemd, and the
setup's migration of jht (it wants cgroupfs) ran at every setup.

- the unit gives the manager as Podman's own flag, and no longer the variable;
- after starting the services, the setup reads `podman info` and stops when the manager is not
  cgroupfs: the check is the script's own statements, read through the AST and run against a fake
  podman (on Windows a native fake, under the shell JHT_TEST_SHELL names).
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, install_fake, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
NETWORK = ROOT / "scripts" / "configure-podman-windows-network.ps1"
SOURCE = NETWORK.read_text(encoding="utf-8")

HARNESS = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-Checked' }, $true)
if (-not $fn) { throw 'Invoke-Checked missing' }
Invoke-Expression $fn.Extent.Text
$statements = @($ast.EndBlock.Statements)
$at = -1
for ($i = 0; $i -lt $statements.Count; $i++) { if ($statements[$i].Extent.Text -match '^\$hostInfo = ') { $at = $i; break } }
if ($at -lt 0 -or $statements[$at + 1].Extent.Text -notmatch '^if \(\$hostInfo -notmatch ') { throw 'cgroup check missing' }
$Podman = $env:FAKE_PODMAN
$MachineName = 'jht-podman'
. ([scriptblock]::Create($statements[$at].Extent.Text + "`n" + $statements[$at + 1].Extent.Text))
[Console]::Out.WriteLine("CHECKED=[$hostInfo]")
"""

FAKE_PODMAN = r"""#!/bin/sh
echo "$*" >> "$FAKE_LOG"
[ -n "$FAKE_INFO_FAILS" ] && { echo 'Error: unable to connect to Podman socket' >&2; exit 125; }
printf '%s\n' "$FAKE_INFO"
exit 0
"""


def _check(tmp_path: Path, info: str, fails: bool = False):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    podman = install_fake(bin_dir, "podman.exe", FAKE_PODMAN)
    harness = tmp_path / "harness.ps1"
    harness.write_text(ENGINE_CHECK + HARNESS, encoding="utf-8")
    engine = tmp_path / "engine.txt"
    log = tmp_path / "calls.log"
    env = {
        **(windows_env(tmp_path) if WINDOWS else os.environ),
        "PATH": str(bin_dir) if WINDOWS else f"{bin_dir}{os.pathsep}/usr/bin{os.pathsep}/bin",
        "JHT_ENGINE_FILE": str(engine), "JHT_UNDER_TEST": str(NETWORK),
        "FAKE_PODMAN": str(podman), "FAKE_INFO": info, "FAKE_LOG": str(log),
    }
    if fails:
        env["FAKE_INFO_FAILS"] = "1"
    done = subprocess.run([*powershell_argv(), "-File", str(harness)], env=env, capture_output=True, text=True, timeout=120)
    assert_engine(engine, done.stderr)
    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return done, calls


def _api_unit() -> str:
    start = SOURCE.index('$apiService = @"')
    return SOURCE[start:SOURCE.index('"@', start)]


def test_the_podman_service_runs_under_cgroupfs_by_podmans_own_flag():
    unit = _api_unit()
    assert "ExecStart=/usr/bin/podman --cgroup-manager=cgroupfs --log-level=info system service --time=0 unix:///run/user/1000/podman/podman.sock" in unit
    # the variable is not a Podman setting: a unit that still had it would only look configured
    assert "CONTAINERS_CGROUP_MANAGER" not in unit


def test_the_setup_goes_on_when_the_service_answers_under_cgroupfs(tmp_path):
    done, calls = _check(tmp_path, "rootless=true cgroups=cgroupfs")
    assert done.returncode == 0, done.stdout + done.stderr
    assert "CHECKED=[rootless=true cgroups=cgroupfs]" in done.stdout
    assert calls == ["--connection jht-podman info --format rootless={{.Host.Security.Rootless}} cgroups={{.Host.CgroupManager}}"]


@pytest.mark.parametrize("info", ["rootless=true cgroups=systemd", "rootless=true cgroups=", "rootless=true cgroups=cgroupfsx", ""])
def test_the_setup_stops_when_the_service_is_not_under_cgroupfs(tmp_path, info):
    done, _ = _check(tmp_path, info)
    assert done.returncode != 0
    assert "podman_cgroup_manager" in done.stdout + done.stderr and "CHECKED=" not in done.stdout


def test_the_setup_stops_when_podman_info_fails(tmp_path):
    done, _ = _check(tmp_path, "rootless=true cgroups=cgroupfs", fails=True)
    assert done.returncode != 0 and "CHECKED=" not in done.stdout

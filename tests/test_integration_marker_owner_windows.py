"""`jht integration` from an ELEVATED Windows process: «cartella dei marcatori non sicura».

What the helper makes in <runtime>\\integrations (the folder, then every marker) is owned by the group Administrators when the process is elevated,
and Test-ProtectedRuntimeNode wants the person as the owner. The helper now gives each node it made to the person (Set-ProtectedRuntimeNodeOwner of the wrapper, the
way the installer gives the runtime), takes only a node owned by the person or by Administrators, and the check itself is the one of the wrapper.

Two kinds of test:
- stand-ins of the owner (any machine with PowerShell): a registry says who owns each node, a run that is «elevated» makes its nodes the
  Administrators', the check is the wrapper's rule (owner = the person). They test who calls the fix, when, and that the check still refuses;
- the real thing (only on Windows, where a CI runner is elevated): the real Test-ProtectedRuntimeNode of the wrapper and the real owner of the node.

Run with: pytest tests/test_integration_marker_owner_windows.py -v   (needs PowerShell: pwsh off Windows)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from windows_native_fakes import install_fake, powershell_argv

from test_integration_command_windows import CASE, FAKE_PODMAN, LIBRARY, WRAPPER
from windows_owner_fakes import STAND_INS, function_text, owners_of

NODES = STAND_INS
ANCHOR = "$IntegrationRetryWaitSeconds = 0\n"


@pytest.fixture
def host(tmp_path):
    assert CASE.count(ANCHOR) == 1
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "docker-compose.yml").write_text("services:\n  jht:\n    image: x\n", encoding="utf-8")
    for name in ("log", "volumes", "running", "owners"):
        (tmp_path / name).write_text("", encoding="utf-8")
    script = tmp_path / "case.ps1"
    script.write_text(CASE.replace(ANCHOR, ANCHOR + NODES), encoding="utf-8-sig")

    class H:
        pass

    h = H()
    h.tmp, h.runtime, h.script = tmp_path, runtime, script
    h.log, h.volumes, h.running, h.owners = tmp_path / "log", tmp_path / "volumes", tmp_path / "running", tmp_path / "owners"
    h.integrations = runtime / "integrations"
    h.argv = powershell_argv()
    h.bin = tmp_path / "bin"
    h.bin.mkdir()
    install_fake(h.bin, "podman.exe", FAKE_PODMAN)
    return h


def run(host, args: list[str], **extra: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "T_RUNTIME": str(host.runtime), "T_LOG": str(host.log), "T_VOLUMES": str(host.volumes),
           "T_RUNNING": str(host.running), "T_LIBRARY": str(LIBRARY), "T_ARGS": json.dumps(args), "T_OWNERS": str(host.owners),
           "T_JHT_HOME": str(host.tmp / "jht-home"), "PATH": f"{host.bin}{os.pathsep}{os.environ['PATH']}", **extra}
    return subprocess.run([*host.argv, "-File", str(host.script)], env=env, capture_output=True, text=True, timeout=120)


def owners(host) -> dict[str, str]:
    return owners_of(host.owners)


@pytest.mark.parametrize("elevated", ["0", "1"])
def test_add_works_from_a_normal_and_from_an_elevated_process(host, elevated):
    done = run(host, ["add", "google", "--json"], T_ELEVATED=elevated)
    assert done.returncode == 0, done.stdout + done.stderr
    answer = json.loads(done.stdout)
    assert answer["ok"] is True and answer["state"] != "not_installed"
    assert (host.integrations / "google.ok").is_file()


def test_from_an_elevated_process_the_folder_and_the_marker_are_given_to_the_person(host):
    run(host, ["add", "google", "--json"], T_ELEVATED="1")
    given = owners(host)
    assert given[str(host.integrations)] == "user" and given[str(host.integrations / "google.ok")] == "user"


def test_from_a_normal_process_nothing_is_changed(host):
    run(host, ["add", "google", "--json"], T_ELEVATED="0")
    assert owners(host) == {}


def test_without_the_fix_an_elevated_run_stops_where_the_report_says(host):
    # the same run with a helper that does not give the nodes to the person: the folder is refused (the check is not relaxed)
    done = run(host, ["add", "google", "--json"], T_ELEVATED="1", T_NO_FIX="1")
    assert done.returncode == 1, done.stdout + done.stderr
    assert json.loads(done.stdout)["reason"] == "cartella dei marcatori non sicura"


def test_a_folder_an_earlier_elevated_run_left_with_its_markers_is_repaired(host):
    host.integrations.mkdir()
    (host.integrations / "google.ok").write_text("ok\n", encoding="utf-8")
    host.owners.write_text(f"{host.integrations}|admin\n{host.integrations / 'google.ok'}|admin\n", encoding="utf-8")
    done = run(host, ["add", "telegram", "--json"], T_ELEVATED="1")
    assert done.returncode == 0, done.stdout + done.stderr
    assert owners(host)[str(host.integrations)] == "user"


def test_a_folder_owned_by_somebody_else_is_still_refused(host):
    host.integrations.mkdir()
    host.owners.write_text(f"{host.integrations}|other\n", encoding="utf-8")
    for elevated in ("0", "1"):
        done = run(host, ["add", "google", "--json"], T_ELEVATED=elevated)
        assert done.returncode == 1, done.stdout + done.stderr
        assert json.loads(done.stdout)["reason"] == "cartella dei marcatori non sicura"
    assert owners(host)[str(host.integrations)] == "other", "never taken"


def test_a_marker_owned_by_somebody_else_is_not_read_and_not_taken(host):
    host.integrations.mkdir()
    (host.integrations / "google.ok").write_text("ok\n", encoding="utf-8")
    host.owners.write_text(f"{host.integrations}|user\n{host.integrations / 'google.ok'}|other\n", encoding="utf-8")
    found = {row["id"]: row for row in json.loads(run(host, ["list", "--json"]).stdout)["integrations"]}
    assert found["google"]["state"] == "not_installed"
    assert owners(host)[str(host.integrations / "google.ok")] == "other"


# ---- the real thing, on Windows only ----
REAL = r"""
$ErrorActionPreference = 'Stop'
function Write-Err { param([string]$Msg) [Console]::Error.WriteLine("error: $Msg") }
function Write-Info { param([string]$Msg) [Console]::Error.WriteLine($Msg) }
$RuntimeDir = $env:T_RUNTIME
$ComposeFile = Join-Path $RuntimeDir 'docker-compose.yml'
$JhtHome = $env:T_JHT_HOME
$ContainerRuntime = 'docker'
. $env:T_ACL
. $env:T_NODE_RULE
. $env:T_LIBRARY
$ok = (Test-IntegrationDirReady)
$wrote = (Write-IntegrationMarker 'google' 'ok' 'ok')
$read = Read-IntegrationMarker 'google' 'ok'
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$dirOwner = ([Security.Principal.NTAccount](Get-Acl -LiteralPath (Get-IntegrationDir)).Owner).Translate([Security.Principal.SecurityIdentifier]).Value
$fileOwner = ([Security.Principal.NTAccount](Get-Acl -LiteralPath (Join-Path (Get-IntegrationDir) 'google.ok')).Owner).Translate([Security.Principal.SecurityIdentifier]).Value
[Console]::Out.WriteLine((ConvertTo-Json -Compress ([ordered]@{ ready = $ok; wrote = $wrote; read = $read; dir_is_me = ($dirOwner -eq $me); file_is_me = ($fileOwner -eq $me) })))
"""


@pytest.mark.skipif(sys.platform != "win32", reason="the owner of a node is a Windows ACL")
def test_the_real_check_of_the_wrapper_accepts_what_the_helper_makes_whoever_runs_it(tmp_path):
    # On a CI runner the process is elevated: the folder this makes is the Administrators' until the helper gives it to the person.
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "docker-compose.yml").write_text("services:\n  jht:\n    image: x\n", encoding="utf-8")
    rule = tmp_path / "node-rule.ps1"
    wrapper = WRAPPER.read_text(encoding="utf-8")
    rule.write_text(function_text(wrapper, "Test-ProtectedRuntimeNode") + function_text(wrapper, "Set-ProtectedRuntimeNodeOwner"), encoding="utf-8-sig")
    script = tmp_path / "real.ps1"
    script.write_text(REAL, encoding="utf-8-sig")
    env = {**os.environ, "T_RUNTIME": str(runtime), "T_JHT_HOME": str(tmp_path / "jht-home"), "T_LIBRARY": str(LIBRARY),
           "T_ACL": str(WRAPPER.parent / "windows-private-acl.ps1"), "T_NODE_RULE": str(rule)}
    done = subprocess.run([*powershell_argv(), "-File", str(script)], env=env, capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stdout + done.stderr
    assert json.loads(done.stdout.strip().splitlines()[-1]) == {"ready": True, "wrote": True, "read": "ok", "dir_is_me": True, "file_is_me": True}

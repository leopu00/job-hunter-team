"""The Podman setup gives every file of the bundle to the user before the wrapper checks them (T103).

The wrapper trusts the host runtime only when each file it checks is owned by the current user
(jht-wrapper.ps1, Test-RuntimeBundleTrusted / Test-ProtectedRuntimeNode). An elevated process of an
administrator creates files owned by BUILTIN\\Administrators: on the elevated Windows CI runner, as for
a person who runs the setup as administrator, the setup's first `jht up` refused the whole bundle,
"untrusted host runtime path, owner, reparse point or SHA-256". install.ps1 gives the files to the
user too, but only after the enabler has returned and its `jht up` has run. The check is not
loosened: the enabler makes each file the user's, only where it is not already.

- the enabler's list holds every file the wrapper checks the owner of, and is applied after the
  manifest is written and before the wrapper runs (read from the scripts, anywhere);
- on Windows: a file created by an elevated process becomes the user's; a file that is already the
  user's is not written at all (an install that is not elevated changes nothing).
"""

from __future__ import annotations

import ctypes
import os
import re
import subprocess
from pathlib import Path

import pytest
from windows_native_fakes import ENGINE_CHECK, WINDOWS, assert_engine, powershell_argv

ROOT = Path(__file__).resolve().parent.parent
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
ACL_HELPER = ROOT / "scripts" / "windows-private-acl.ps1"

# What the wrapper checks the owner of, and how the enabler names the same file.
OWNER_CHECKED = {
    "$ComposeFile": "(Join-Path $RuntimeDir 'docker-compose.yml')",
    "$PodmanComposeFile": "(Join-Path $RuntimeDir 'docker-compose.podman.yml')",
    "$RuntimeSelectionFile": "$selectionFile",
    "$PodmanMachineFile": "$machineFile",
    "$ContainerUnitFile": "$containerUnitFile",
    "$RuntimeManifest": "(Join-Path $RuntimeDir '.runtime-integrity')",
    "$WrapperPath": "(Join-Path $BinDir 'jht.ps1')",
    "$AclHelperPath": "(Join-Path $BinDir 'windows-private-acl.ps1')",
    "$DockerShim": "$shim",
    "$RuntimeImageFile": "$runtimeImageFile",
}


def _function(source: str, name: str) -> str:
    start = source.index(f"function {name} {{")
    return source[start : source.index("\nfunction ", start + 1)]


def test_the_enabler_gives_the_user_every_file_the_wrapper_checks_the_owner_of():
    trusted = _function(WRAPPER.read_text(encoding="utf-8"), "Test-RuntimeBundleTrusted")
    checked = set(re.findall(r"Test-ProtectedRuntimeNode (\$\w+)", trusted))
    # the runtime folder itself is the enabler's Protect-OwnerOnlyDirectory
    assert checked - {"$RuntimeDir"} == set(OWNER_CHECKED), "a file the wrapper checks has no owner repair in the enabler"
    enabler = ENABLER.read_text(encoding="utf-8")
    listed = enabler[enabler.index("$bundleFiles = @(") : enabler.index("foreach ($bundleFile in $bundleFiles)")]
    for name in OWNER_CHECKED.values():
        assert name in listed, name
    assert "Protect-OwnerOnlyDirectory -Path $RuntimeDir" in enabler


def test_the_owners_are_repaired_after_the_manifest_and_before_the_wrapper_runs():
    lines = ENABLER.read_text(encoding="utf-8").splitlines()
    def at(text: str) -> int:
        found = [i for i, line in enumerate(lines) if line.startswith(text)]
        assert len(found) == 1, (text, found)
        return found[0]
    manifest = at("[IO.File]::WriteAllText((Join-Path $RuntimeDir '.runtime-integrity')")
    repair = at("foreach ($bundleFile in $bundleFiles) { Set-JhtOwnerToCurrentUser -Path $bundleFile }")
    wrapper = at("& (Join-Path $BinDir 'jht.ps1') up")
    assert manifest < repair < wrapper


HARNESS = r"""
$ErrorActionPreference = 'Stop'
. $env:JHT_ACL_HELPER
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Set-JhtOwnerToCurrentUser' }, $true)
if (-not $fn) { throw 'Set-JhtOwnerToCurrentUser missing' }
Invoke-Expression $fn.Extent.Text
$real = (Get-Command Set-JhtAccessControl).ScriptBlock
if ($env:JHT_PREOWN -eq '1') {
  # a file that is already the user's, also when this process is elevated
  $pre = Get-Acl -LiteralPath $env:JHT_FILE
  $pre.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
  & $real -Path $env:JHT_FILE -Acl $pre
}
# counts the writes, and still writes
$script:Writes = 0
function Set-JhtAccessControl { param($Path, $Acl) $script:Writes++; & $real -Path $Path -Acl $Acl }
$sid = { param($p) ([Security.Principal.NTAccount](Get-Acl -LiteralPath $p).Owner).Translate([Security.Principal.SecurityIdentifier]).Value }
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
[Console]::Out.WriteLine("BEFORE_IS_ME=$((& $sid $env:JHT_FILE) -eq $me)")
Set-JhtOwnerToCurrentUser -Path $env:JHT_FILE
[Console]::Out.WriteLine("AFTER_IS_ME=$((& $sid $env:JHT_FILE) -eq $me) WRITES=$script:Writes")
Set-JhtOwnerToCurrentUser -Path $env:JHT_FILE
[Console]::Out.WriteLine("AGAIN_WRITES=$script:Writes")
"""


def _elevated() -> bool:
    return bool(ctypes.windll.shell32.IsUserAnAdmin())  # type: ignore[attr-defined]


def _repair(tmp_path: Path, preown: bool = False) -> dict[str, str]:
    target = tmp_path / "docker-compose.yml"
    target.write_text("services: {}\n", encoding="utf-8")  # created by this process: elevated or not
    harness = tmp_path / "harness.ps1"
    harness.write_text(ENGINE_CHECK + HARNESS, encoding="utf-8")
    engine = tmp_path / "engine.txt"
    done = subprocess.run(
        [*powershell_argv(), "-File", str(harness)],
        env={**os.environ, "JHT_ENGINE_FILE": str(engine), "JHT_UNDER_TEST": str(ENABLER),
             "JHT_ACL_HELPER": str(ACL_HELPER), "JHT_FILE": str(target), "JHT_PREOWN": "1" if preown else "0"},
        capture_output=True, text=True, timeout=120,
    )
    assert_engine(engine, done.stderr)
    assert done.returncode == 0, done.stdout + done.stderr
    return dict(pair.split("=", 1) for line in done.stdout.splitlines() for pair in line.split() if "=" in pair)


@pytest.mark.skipif(not WINDOWS, reason="file owners are Windows ACLs")
def test_a_file_made_by_an_elevated_process_becomes_the_users(tmp_path):
    if not _elevated():
        pytest.skip("only an elevated process creates files owned by Administrators")
    seen = _repair(tmp_path)
    assert seen["BEFORE_IS_ME"] == "False", seen  # BUILTIN\Administrators, as on the CI runner
    assert seen["AFTER_IS_ME"] == "True" and seen["WRITES"] == "1", seen
    assert seen["AGAIN_WRITES"] == "1", seen


@pytest.mark.skipif(not WINDOWS, reason="file owners are Windows ACLs")
def test_a_file_that_is_already_the_users_is_not_written(tmp_path):
    seen = _repair(tmp_path, preown=True)
    assert seen["BEFORE_IS_ME"] == "True" and seen["AFTER_IS_ME"] == "True", seen
    assert seen["WRITES"] == "0" and seen["AGAIN_WRITES"] == "0", seen

"""What the Windows wrapper makes in the runtime after the install must be the person's even when it runs ELEVATED.

An elevated process makes nodes owned by the group Administrators, and the wrapper trusts only the person's own (Test-ProtectedRuntimeNode, not
relaxed). The install gives its files to the person (install.ps1, the enabler: tests/test_podman_windows_bundle_owner.py); the places below make
files later, and from an elevated `jht upgrade` or `jht integration add` would have left a runtime the next command refuses («untrusted host
runtime path, owner, reparse point or SHA-256»), or an upgrade whose rollback is refused at the moment it is needed:

  Write-RuntimeHelpersManifest, Install-RuntimeHelpers   the helpers of the host and their manifest (.runtime-helpers)
  Write-RuntimeManifest                                  the manifest of the runtime (.runtime-integrity)
  Replace-UpgradeFile                                    the compose and the wrapper an upgrade puts in place (also in the rollback)
  Write-UpgradeJournal, the rollback of the upgrade      the journal, the rollback folder and its three snapshots
  Install-ProtectedRuntimeFromRelease                    the runtime made again from the release (the folder, the compose, the wrapper)
  (the folder of the markers of `jht integration`: tests/test_integration_marker_owner_windows.py)

Set-ProtectedRuntimeNodeOwner is the one function that gives a node to the person. Three kinds of test: the behavior of each function with
stand-ins of the owner (any machine with PowerShell), who calls the function where (read from the script), and the real thing (Windows only).

Run with: pytest tests/test_runtime_nodes_owner_windows.py -v   (needs PowerShell: pwsh off Windows)
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
from windows_native_fakes import powershell_argv
from windows_owner_fakes import STAND_INS, child_env, function_text, owners_of

ROOT = Path(__file__).resolve().parent.parent
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
ACL = ROOT / "scripts" / "windows-private-acl.ps1"
SOURCE = WRAPPER.read_text(encoding="utf-8")


def run_case(tmp_path: Path, functions: list[str], body: str, **env: str) -> subprocess.CompletedProcess:
    """Runs `body` with the real text of the wrapper's `functions` and the stand-ins of the owner."""
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    owners = tmp_path / "owners"
    owners.touch()
    script = tmp_path / "case.ps1"
    text = "\n".join([
        "$ErrorActionPreference = 'Stop'",
        f". '{ACL}'",
        STAND_INS,
        *[function_text(SOURCE, name) for name in functions],
        f"$RuntimeDir = '{runtime}'",
        body,
    ])
    script.write_text(text, encoding="utf-8-sig")
    return subprocess.run([*powershell_argv(), "-File", str(script)], env=child_env(T_OWNERS=str(owners), **env),
                          capture_output=True, text=True, timeout=120)


def last_json(done: subprocess.CompletedProcess) -> dict:
    assert done.returncode == 0, done.stdout + done.stderr
    return json.loads(done.stdout.strip().splitlines()[-1])


# ---- behavior, with stand-ins of the owner ----
HELPERS_BODY = r"""
$RuntimeHelpers = @('jht-integration.ps1')
$RuntimeHelpersManifest = Join-Path $RuntimeDir '.runtime-helpers'
[IO.File]::WriteAllText((Join-Path $RuntimeDir 'jht-integration.ps1'), "# JHT_RUNTIME_HELPER=1`n")
Write-RuntimeHelpersManifest
[Console]::Out.WriteLine((ConvertTo-Json -Compress @{ trusted = (Test-ProtectedRuntimeNode $RuntimeHelpersManifest) }))
"""


@pytest.mark.parametrize("elevated,expected", [("0", True), ("1", True)])
def test_the_helpers_manifest_is_the_persons_from_a_normal_and_from_an_elevated_process(tmp_path, elevated, expected):
    done = run_case(tmp_path, ["Get-RuntimeHelperHash", "Write-RuntimeHelpersManifest"], HELPERS_BODY, T_ELEVATED=elevated)
    assert last_json(done) == {"trusted": expected}


def test_the_helpers_manifest_of_an_elevated_run_without_the_fix_is_refused(tmp_path):
    done = run_case(tmp_path, ["Get-RuntimeHelperHash", "Write-RuntimeHelpersManifest"], HELPERS_BODY, T_ELEVATED="1", T_NO_FIX="1")
    assert last_json(done) == {"trusted": False}


def test_the_helpers_manifest_that_cannot_be_given_to_the_person_stops_the_install_of_the_helpers(tmp_path):
    (tmp_path / "runtime").mkdir()
    (tmp_path / "runtime" / ".runtime-helpers").write_text("", encoding="utf-8")
    (tmp_path / "owners").write_text(f"{tmp_path / 'runtime' / '.runtime-helpers'}|other\n", encoding="utf-8")
    done = run_case(tmp_path, ["Get-RuntimeHelperHash", "Write-RuntimeHelpersManifest"], HELPERS_BODY, T_ELEVATED="1")
    assert done.returncode != 0 and "cannot be given to the person" in done.stdout + done.stderr


MANIFEST_BODY = r"""
$ComposeFile = Join-Path $RuntimeDir 'docker-compose.yml'; $WrapperPath = Join-Path $RuntimeDir 'jht.ps1'; $AclHelperPath = Join-Path $RuntimeDir 'acl.ps1'
$RuntimeManifest = Join-Path $RuntimeDir '.runtime-integrity'; $RuntimeImageFile = Join-Path $RuntimeDir 'runtime-image'; $ContainerRuntime = 'docker'
foreach ($file in @($ComposeFile, $WrapperPath, $AclHelperPath)) { [IO.File]::WriteAllText($file, "x`n") }
Write-RuntimeManifest
[Console]::Out.WriteLine((ConvertTo-Json -Compress @{ trusted = (Test-ProtectedRuntimeNode $RuntimeManifest) }))
"""


@pytest.mark.parametrize("elevated", ["0", "1"])
def test_the_manifest_of_the_runtime_is_the_persons_from_a_normal_and_from_an_elevated_process(tmp_path, elevated):
    assert last_json(run_case(tmp_path, ["Write-RuntimeManifest"], MANIFEST_BODY, T_ELEVATED=elevated)) == {"trusted": True}


def test_the_manifest_of_an_elevated_run_without_the_fix_is_refused(tmp_path):
    assert last_json(run_case(tmp_path, ["Write-RuntimeManifest"], MANIFEST_BODY, T_ELEVATED="1", T_NO_FIX="1")) == {"trusted": False}


REPLACE_BODY = r"""
$source = Join-Path $RuntimeDir 'new.yml'; $target = Join-Path $RuntimeDir 'docker-compose.yml'
[IO.File]::WriteAllText($source, "new`n")
if ($env:T_TARGET_EXISTS -eq '1') { [IO.File]::WriteAllText($target, "old`n") }
$done = Replace-UpgradeFile $source $target
[Console]::Out.WriteLine((ConvertTo-Json -Compress @{ done = $done; text = ([IO.File]::ReadAllText($target)).Trim(); trusted = (Test-ProtectedRuntimeNode $target) }))
"""


# `File.Replace` with no backup name (how the upgrade replaces a file that is there) throws on the pwsh of a Linux machine; it is the call of Windows
REPLACE_IS_WINDOWS = pytest.mark.skipif(sys.platform != "win32", reason="File.Replace without a backup name is a call of Windows")


def test_every_file_replace_of_the_wrapper_passes_a_real_null_as_the_backup_name() -> None:
    """`$null` is turned into "" by PowerShell for the string parameter of a .NET method, and File.Replace with the backup name "" throws («The path
    is not of a legal form» in 5.1, «The path is empty» in 7): the function that put an upgrade file in place swallowed it and returned false. Read
    from the script because a machine that is not Windows cannot make the call (the real case is above)."""
    calls = re.findall(r"\[IO\.File\]::Replace\(([^()]*)\)", SOURCE)
    assert len(calls) >= 3, "the wrapper replaces a file in at least three places: the scan lost them"
    assert [c for c in calls if not c.rstrip().endswith("[NullString]::Value")] == []


@pytest.mark.parametrize("exists", ["0", pytest.param("1", marks=REPLACE_IS_WINDOWS)])
@pytest.mark.parametrize("elevated", ["0", "1"])
def test_a_file_the_upgrade_puts_in_place_is_the_persons(tmp_path, elevated, exists):
    done = run_case(tmp_path, ["Replace-UpgradeFile"], REPLACE_BODY, T_ELEVATED=elevated, T_TARGET_EXISTS=exists)
    assert last_json(done) == {"done": True, "text": "new", "trusted": True}


@REPLACE_IS_WINDOWS
def test_a_file_the_upgrade_cannot_give_to_the_person_is_a_failed_replace(tmp_path):
    (tmp_path / "runtime").mkdir()
    target = tmp_path / "runtime" / "docker-compose.yml"
    target.write_text("old\n", encoding="utf-8")
    (tmp_path / "owners").write_text(f"{target}|other\n", encoding="utf-8")
    done = run_case(tmp_path, ["Replace-UpgradeFile"], REPLACE_BODY, T_ELEVATED="1", T_TARGET_EXISTS="1")
    assert last_json(done)["done"] is False, "the commit of the upgrade then rolls back"


JOURNAL_BODY = r"""
$script:UpgradeJournal = Join-Path $RuntimeDir '.upgrade-journal'; $script:UpgradeRollbackDir = Join-Path $RuntimeDir '.upgrade-rollback-1-2'
$done = Write-UpgradeJournal 'prepared' 'none' $false
[Console]::Out.WriteLine((ConvertTo-Json -Compress @{ done = $done; trusted = (Test-ProtectedRuntimeNode $script:UpgradeJournal) }))
"""


@pytest.mark.parametrize("elevated", ["0", "1"])
def test_the_journal_of_an_upgrade_is_the_persons_so_that_the_rollback_can_read_it(tmp_path, elevated):
    assert last_json(run_case(tmp_path, ["Write-UpgradeJournal"], JOURNAL_BODY, T_ELEVATED=elevated)) == {"done": True, "trusted": True}


def test_the_journal_of_an_elevated_run_without_the_fix_is_refused(tmp_path):
    done = run_case(tmp_path, ["Write-UpgradeJournal"], JOURNAL_BODY, T_ELEVATED="1", T_NO_FIX="1")
    assert last_json(done)["trusted"] is False


# ---- who calls the function, where (read from the script) ----
def gives_to_the_person(function: str, written: str) -> bool:
    """True when the line that writes `written`, in the body of `function`, is followed at once by a call of Set-ProtectedRuntimeNodeOwner."""
    body = function_text(SOURCE, function)
    following = body[body.index(written):].split("\n")[1:3]
    return any("Set-ProtectedRuntimeNodeOwner" in line for line in following)


@pytest.mark.parametrize("function,written", [
    ("Write-RuntimeHelpersManifest", "Publish-JhtFile"),
    ("Install-RuntimeHelpers", "Publish-JhtFile"),
    ("Write-RuntimeManifest", "Move-Item"),
    ("Replace-UpgradeFile", "[IO.File]::Move($temp, $Target)"),
    ("Write-UpgradeJournal", "[IO.File]::Move($temp, $script:UpgradeJournal)"),
    ("Install-ProtectedRuntimeFromRelease", "New-Item -ItemType Directory -Path $RuntimeDir"),
    ("Install-ProtectedRuntimeFromRelease", "Move-Item -LiteralPath $temp -Destination $ComposeFile"),
    ("Install-ProtectedRuntimeFromRelease", "Move-Item -LiteralPath $wrapperTemp -Destination $WrapperPath"),
])
def test_each_place_that_makes_a_node_of_the_runtime_gives_it_to_the_person_after_making_it(function, written):
    assert gives_to_the_person(function, written), f"{function}: nothing gives the node to the person after `{written}`"


def test_the_rollback_of_an_upgrade_gives_the_person_the_folder_and_its_three_snapshots_before_the_journal_is_written():
    start = SOURCE.index("$script:UpgradeRollbackDir = Join-Path $RuntimeDir ('.upgrade-rollback-'")
    block = SOURCE[start:SOURCE.index("Write-UpgradeJournal 'prepared'", start)]
    assert "Set-ProtectedRuntimeNodeOwner $script:UpgradeRollbackDir" in block
    for snapshot in ("docker-compose.yml", "jht-wrapper.ps1", ".runtime-integrity"):
        assert f"'{snapshot}'" in block
    assert block.index("Copy-Item -LiteralPath $RuntimeManifest") < block.index("Set-ProtectedRuntimeNodeOwner")


def test_the_one_function_is_in_the_wrapper_and_is_not_copied_into_the_helpers():
    assert len(re.findall(r"^function Set-ProtectedRuntimeNodeOwner \{", SOURCE, re.M)) == 1
    for helper in ("jht-integration.ps1", "jht-tools.ps1"):
        text = (ROOT / "scripts" / helper).read_text(encoding="utf-8")
        assert "SetOwner(" not in text, f"{helper} has its own copy of the owner change"


# ---- the real thing, on Windows only ----
REAL = r"""
$ErrorActionPreference = 'Stop'
. $env:T_RULE
$me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
function Owner-Is-Me { param([string]$Path) return ((([Security.Principal.NTAccount](Get-Acl -LiteralPath $Path).Owner).Translate([Security.Principal.SecurityIdentifier])).Value -eq $me) }
$dir = Join-Path $env:T_ROOT 'made'; New-Item -ItemType Directory -Path $dir | Out-Null
$file = Join-Path $dir 'marker'; [IO.File]::WriteAllText($file, "x`n")
$outside = Join-Path $env:T_ROOT 'outside'; New-Item -ItemType Directory -Path $outside | Out-Null
$link = Join-Path $env:T_ROOT 'link'; cmd /c mklink /J "$link" "$outside" | Out-Null
$before = (Get-Acl -LiteralPath $outside).Sddl
$result = [ordered]@{
  dir = (Set-ProtectedRuntimeNodeOwner $dir); file = (Set-ProtectedRuntimeNodeOwner $file)
  dir_is_me = (Owner-Is-Me $dir); file_is_me = (Owner-Is-Me $file)
  rule_dir = (Test-ProtectedRuntimeNode $dir -Directory); rule_file = (Test-ProtectedRuntimeNode $file)
  again = (Set-ProtectedRuntimeNodeOwner $file)
  link = (Set-ProtectedRuntimeNodeOwner $link); link_target_untouched = ((Get-Acl -LiteralPath $outside).Sddl -eq $before)
  missing = (Set-ProtectedRuntimeNodeOwner (Join-Path $dir 'nothing'))
}
[Console]::Out.WriteLine((ConvertTo-Json -Compress $result))
"""


@pytest.mark.skipif(sys.platform != "win32", reason="the owner of a node is a Windows ACL")
def test_the_real_function_gives_the_person_what_an_elevated_run_made_and_refuses_a_link_and_what_is_not_there(tmp_path):
    # On a CI runner the process is elevated: what this makes is the Administrators' until the function gives it to the person.
    rule = tmp_path / "rule.ps1"
    rule.write_text(function_text(SOURCE, "Test-ProtectedRuntimeNode") + function_text(SOURCE, "Set-ProtectedRuntimeNodeOwner"), encoding="utf-8-sig")
    script = tmp_path / "real.ps1"
    script.write_text(REAL, encoding="utf-8-sig")
    root = tmp_path / "work"
    root.mkdir()
    done = subprocess.run([*powershell_argv(), "-File", str(script)], env=child_env(T_RULE=str(rule), T_ROOT=str(root)),
                          capture_output=True, text=True, timeout=120)
    assert last_json(done) == {"dir": True, "file": True, "dir_is_me": True, "file_is_me": True, "rule_dir": True, "rule_file": True,
                               "again": True, "link": False, "link_target_untouched": True, "missing": False}

"""SEC-09 P1-2 and P2-5: the ACL of the JHT folder never goes through a link, and the backup folder is new.

`Protect-JhtHomeAcl` (install.ps1, its public copy, windows-private-acl.ps1) walked `.jht` with `Get-ChildItem -Recurse` and
rewrote the ACL of every entry by path. The agents write in that folder: a junction or a link one of them leaves made the
installer, and the setup from the app, rewrite the ACL of a file or a folder of the person OUTSIDE the mounts (inheritance
removed, other principals out). Windows PowerShell 5.1 walks into links with -Recurse. Now the folder is walked by hand,
a reparse point is neither changed nor entered, and a node that became a link since the walk is left alone.

The backup folder of the repair of the legacy Docker metadata had a name made of the time, and was made with -Force: a name
the agents could foresee, taken with a link, took the data of the team out of the mounts.

The static checks run everywhere; the real runs are Windows PowerShell 5.1 and PowerShell 7 on Windows.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
COPIES = ("install.ps1", "windows-private-acl.ps1")
SHELLS = ("powershell", "pwsh")


def function_text(path: Path, name: str) -> str:
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    start = text.index(f"function {name} {{")
    end = text.index("\n}\n", start)
    return text[start:end + 3]


@pytest.mark.parametrize("name", COPIES)
def test_the_folder_is_walked_by_hand_and_a_link_is_neither_changed_nor_entered(name):
    body = function_text(SCRIPTS / name, "Protect-JhtHomeAcl")

    assert "-Recurse" not in body, "Get-ChildItem -Recurse walks into links in Windows PowerShell 5.1"
    assert "[IO.FileAttributes]::ReparsePoint" in body
    # the walk skips a reparse point and does not push it to be entered
    assert re.search(r"if \(\(\$child\.Attributes -band \[IO\.FileAttributes\]::ReparsePoint\) -ne 0\) \{ continue \}", body)
    # a folder is looked at again, with the folders above it, when it leaves the stack and BEFORE it is listed, and a node
    # right before it is written
    assert body.index("if (& $underLink $folder) { continue }") < body.index("Get-ChildItem -LiteralPath $folder -Force")
    assert body.index("if (& $underLink $node.FullName) { continue }") < body.index("Set-JhtAccessControl -Path $node.FullName")
    # up the path to the root: a reparse point on the way, or no way up, is a link
    assert "$step = if ($step.PSIsContainer) { $step.Parent } else { $step.Directory }" in body
    assert body.count("[IO.FileAttributes]::ReparsePoint") == 2


def test_the_two_walks_are_the_same_text():
    """install.ps1 has to work alone (it is downloaded), so the walk is written twice: the lines of the walk are equal."""
    def walk(name):
        body = function_text(SCRIPTS / name, "Protect-JhtHomeAcl")
        return body[body.index("  $rootFull = "):body.index("    $acl = Get-Acl")]
    assert walk("install.ps1") == walk("windows-private-acl.ps1")


def test_the_public_installer_is_the_installer():
    assert (SCRIPTS / "install.ps1").read_bytes() == (ROOT / "web" / "public" / "install.ps1").read_bytes()


def test_the_backup_folder_is_new_under_a_name_nobody_can_foresee_and_not_a_link():
    text = (SCRIPTS / "enable-podman-windows-runtime.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
    start = text.index("$backup = Join-Path $JhtHome")
    block = text[start:start + 900]

    assert "[guid]::NewGuid().ToString('N')" in block.split("\n")[0]
    create = next(line for line in block.split("\n") if "New-Item -ItemType Directory -Path $backup" in line)
    assert "-Force" not in create and "-ErrorAction Stop" in create, create
    assert "$backup -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0" in block
    assert "podman-metadata-backup-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())" not in text


def _shell(name: str) -> str:
    if name == "powershell":
        found = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe"
        found = str(found) if found.is_file() else None
    else:
        found = shutil.which(name)
    if found:
        return found
    if os.environ.get("JHT_REQUIRE_WINDOWS_SHELLS") == "1":
        pytest.fail(f"{name} is missing, and this gate requires it")
    pytest.skip(f"{name} not installed")


RUN = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($wanted in @('Set-JhtAccessControl', 'Protect-JhtHomeAcl')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $wanted }, $true)
  if (-not $fn) { throw "function not found: $wanted" }
  Invoke-Expression $fn.Extent.Text
}
$base = $env:JHT_FIXTURE
$home_ = Join-Path $base 'home'
$outside = Join-Path $base 'outside'
New-Item -ItemType Directory -Path $home_, $outside, (Join-Path $home_ 'sub') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $outside 'kept.txt') -Value 'kept'
Set-Content -LiteralPath (Join-Path $home_ 'sub\plain.txt') -Value 'plain'
New-Item -ItemType Junction -Path (Join-Path $home_ 'junction') -Target $outside | Out-Null
New-Item -ItemType Junction -Path (Join-Path $home_ 'sub\deep') -Target $outside | Out-Null
$sddl = (Get-Acl -LiteralPath $outside).Sddl
$fileSddl = (Get-Acl -LiteralPath (Join-Path $outside 'kept.txt')).Sddl
Protect-JhtHomeAcl -Path $home_
foreach ($made in @($home_, (Join-Path $home_ 'sub'), (Join-Path $home_ 'sub\plain.txt'))) {
  if (-not (Get-Acl -LiteralPath $made).AreAccessRulesProtected) { throw "not made private: $made" }
}
if ((Get-Acl -LiteralPath $outside).Sddl -ne $sddl) { throw 'the ACL of the folder a junction points at was rewritten' }
if ((Get-Acl -LiteralPath (Join-Path $outside 'kept.txt')).Sddl -ne $fileSddl) { throw 'the ACL of a file behind a junction was rewritten' }
if ((Get-Acl -LiteralPath $outside).AreAccessRulesProtected) { throw 'the folder a junction points at lost its inheritance' }
Write-Output 'LINKS_LEFT_ALONE'
"""


@pytest.mark.skipif(os.name != "nt", reason="ACLs and junctions of Windows")
@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("name", COPIES)
def test_a_junction_in_the_folder_keeps_the_acl_of_what_it_points_at(shell, name, tmp_path):
    script = tmp_path / "run.ps1"
    script.write_text(RUN, encoding="utf-8")
    env = dict(os.environ, JHT_UNDER_TEST=str(SCRIPTS / name), JHT_FIXTURE=str(tmp_path / "fixture"))
    done = subprocess.run(
        [_shell(shell), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)],
        capture_output=True, text=True, env=env, timeout=240,
    )
    assert done.returncode == 0 and "LINKS_LEFT_ALONE" in done.stdout, (done.stdout, done.stderr)


@pytest.mark.skipif(os.name != "nt", reason="ACLs and junctions of Windows")
@pytest.mark.parametrize("shell", SHELLS)
def test_the_old_walk_would_have_failed_this_check(shell, tmp_path):
    """The proof that the check sees the defect: the old text, with -Recurse, rewrites the ACL behind the junction."""
    old = (SCRIPTS / "windows-private-acl.ps1").read_text(encoding="utf-8")
    walk = old[old.index("  $rootFull = "):old.index("  foreach ($node in $nodes) {")]
    old_text = old.replace(walk, "  $nodes = @(Get-Item -LiteralPath $Path) + @(Get-ChildItem -LiteralPath $Path -Force -Recurse)\n")
    old_text = re.sub(r"    # looked at again right before the write.*?\n    if \(& \$underLink \$node\.FullName\) \{ continue \}\n", "", old_text, flags=re.S)
    old_copy = tmp_path / "old-acl.ps1"
    old_copy.write_text(old_text, encoding="utf-8")
    script = tmp_path / "run.ps1"
    script.write_text(RUN, encoding="utf-8")
    env = dict(os.environ, JHT_UNDER_TEST=str(old_copy), JHT_FIXTURE=str(tmp_path / "fixture"))
    done = subprocess.run(
        [_shell(shell), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)],
        capture_output=True, text=True, env=env, timeout=240,
    )
    # 5.1 walks into the junction; 7 does not, so there only the static checks above hold the line
    if shell == "powershell":
        assert done.returncode != 0 and "LINKS_LEFT_ALONE" not in done.stdout, (done.stdout, done.stderr)


# The folder is changed while the walk runs. `Get-ChildItem` and `Set-JhtAccessControl` are wrapped in the scope the function
# runs in (a function wins over the cmdlet of the same name): the first call does its work and THEN the folder is replaced by
# a junction, which is what an agent that writes in the folder could do between the stack and the write.
RACE = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($wanted in @('Set-JhtAccessControl', 'Protect-JhtHomeAcl')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $wanted }, $true)
  Invoke-Expression $fn.Extent.Text
}
$base = $env:JHT_FIXTURE
$home_ = Join-Path $base 'home'
$outside = Join-Path $base 'outside'
New-Item -ItemType Directory -Path (Join-Path $home_ 'sub\deeper'), (Join-Path $home_ 'other'), $outside -Force | Out-Null
Set-Content -LiteralPath (Join-Path $home_ 'sub\plain.txt') -Value 'plain'
Set-Content -LiteralPath (Join-Path $home_ 'sub\deeper\more.txt') -Value 'more'
# what the junction will point at has the same names, and an ACL that must not change
New-Item -ItemType Directory -Path (Join-Path $outside 'deeper') -Force | Out-Null
Set-Content -LiteralPath (Join-Path $outside 'plain.txt') -Value 'outside'
Set-Content -LiteralPath (Join-Path $outside 'deeper\more.txt') -Value 'outside'
$watched = @($outside, (Join-Path $outside 'plain.txt'), (Join-Path $outside 'deeper'), (Join-Path $outside 'deeper\more.txt'))
$before = @($watched | ForEach-Object { (Get-Acl -LiteralPath $_).Sddl })
$script:swapped = $false
function Swap-SubForAJunction {
  if ($script:swapped) { return }
  $script:swapped = $true
  Remove-Item -LiteralPath (Join-Path $home_ 'sub') -Recurse -Force
  New-Item -ItemType Junction -Path (Join-Path $home_ 'sub') -Target $outside | Out-Null
}
if ($env:JHT_RACE -eq 'queued') {
  # the folders 'sub' and 'other' are queued by the first listing; 'sub' becomes a junction before it is listed
  function Get-ChildItem {
    $found = @(Microsoft.PowerShell.Management\Get-ChildItem @args)
    Swap-SubForAJunction
    $found
  }
} else {
  # the walk is over; 'sub' becomes a junction when the first node is written, and its children are written through it
  $original = (Get-Command Set-JhtAccessControl -CommandType Function).ScriptBlock
  function Set-JhtAccessControl {
    param([string]$Path, $Acl)
    & $original -Path $Path -Acl $Acl
    Swap-SubForAJunction
  }
}
Protect-JhtHomeAcl -Path $home_
if (-not $script:swapped) { throw 'the folder was never swapped: the test proves nothing' }
$after = @($watched | ForEach-Object { (Get-Acl -LiteralPath $_).Sddl })
for ($i = 0; $i -lt $watched.Count; $i++) {
  if ($after[$i] -ne $before[$i]) { throw "the ACL behind the junction was rewritten: $($watched[$i])" }
}
if ((Get-Acl -LiteralPath $outside).AreAccessRulesProtected) { throw 'the folder behind the junction lost its inheritance' }
Write-Output 'RACE_LEFT_ALONE'
"""


@pytest.mark.skipif(os.name != "nt", reason="ACLs and junctions of Windows")
@pytest.mark.parametrize("race", ("queued", "written"))
@pytest.mark.parametrize("shell", SHELLS)
@pytest.mark.parametrize("name", COPIES)
def test_a_folder_turned_into_a_junction_after_it_was_queued_or_before_it_is_written_is_left_alone(name, shell, race, tmp_path):
    script = tmp_path / "race.ps1"
    script.write_text(RACE, encoding="utf-8")
    env = dict(os.environ, JHT_UNDER_TEST=str(SCRIPTS / name), JHT_FIXTURE=str(tmp_path / "fixture"), JHT_RACE=race)
    done = subprocess.run(
        [_shell(shell), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script)],
        capture_output=True, text=True, env=env, timeout=240,
    )
    assert done.returncode == 0 and "RACE_LEFT_ALONE" in done.stdout, (done.stdout, done.stderr)

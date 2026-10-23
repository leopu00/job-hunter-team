"""No native call with its stderr redirected runs under 'Stop' in the Windows scripts.

Under `$ErrorActionPreference = 'Stop'`, Windows PowerShell 5.1, the shell the app
runs the scripts with, turns any line a native program writes on stderr into an
error that stops the script, even when that stderr goes to `$null`; PowerShell 7
does not. `podman inspect jht` answers "no such object" on a new machine, so the
enabler stopped at every first installation (T82); the probe's `docker inspect jht`
and install.ps1's `wsl --status 2>&1` had the same form.

So every `& native ... 2>...` runs where the preference is 'Continue': in its own
block, `& { $ErrorActionPreference = 'Continue'; & $exe ... 2>$null }`, or after
an assignment of 'Continue' in a block that holds it (the network script's waits).
Where the failure must stop, the script reads $LASTEXITCODE.

- the gate reads the covered scripts through the PowerShell AST and fails on a
  redirected native call whose nearest preceding preference is not 'Continue';
- it sees the old lines, in a function and at the top (counter-check carried with it).

The real 5.1 next to 7 runs on Windows: test_windows_powershell51_native_stderr.py.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ROOT / "scripts"
# The scripts the app runs under 'Stop'. The wrapper joins when its 34 calls are done.
COVERED = [
    SCRIPTS / "enable-podman-windows-runtime.ps1",
    SCRIPTS / "configure-podman-windows-network.ps1",
    SCRIPTS / "podman-windows-probe.ps1",
    SCRIPTS / "install.ps1",
]

GATE = r"""
$ErrorActionPreference = 'Stop'
$L = [System.Management.Automation.Language.AssignmentStatementAst]
function Get-Preference([System.Management.Automation.Language.Ast]$node) {
  # The value of the nearest $ErrorActionPreference assignment before $node, in the blocks that hold it,
  # from the innermost out; '' when there is none.
  $at = $node.Extent.StartOffset
  for ($parent = $node.Parent; $parent; $parent = $parent.Parent) {
    $statements = $null
    if ($parent -is [System.Management.Automation.Language.StatementBlockAst]) { $statements = $parent.Statements }
    elseif ($parent -is [System.Management.Automation.Language.NamedBlockAst]) { $statements = $parent.Statements }
    if (-not $statements) { continue }
    $last = $null
    foreach ($statement in $statements) {
      if ($statement.Extent.EndOffset -gt $at) { break }
      # the assignments of this statement, nested ones too (a finally that puts the preference back),
      # but not those in a block or a function of their own: their scope ends with them
      $assignments = $statement.FindAll({ param($n)
        if (-not ($n -is $L -and "$($n.Left)" -match '^\$ErrorActionPreference$')) { return $false }
        for ($up = $n.Parent; $up -and $up -ne $statement.Parent; $up = $up.Parent) {
          if ($up -is [System.Management.Automation.Language.ScriptBlockExpressionAst] -or
              $up -is [System.Management.Automation.Language.FunctionDefinitionAst]) { return $false }
        }
        return $true }, $true)
      foreach ($assignment in $assignments) { $last = $assignment }
    }
    if ($last) { return ("$($last.Right)" -replace "^'|'$", '') }
  }
  return ''
}
$scanned = 0
foreach ($path in ($env:JHT_GATE_FILES -split [IO.Path]::PathSeparator)) {
  if (-not $path) { continue }
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw "parse ${path}: $($errors[0])" }
  foreach ($command in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.CommandAst] }, $true)) {
    if ($command.InvocationOperator -ne 'Ampersand') { continue }
    if ($command.CommandElements[0] -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) { continue }
    $errorRedirected = @($command.Redirections | Where-Object { $_.FromStream -eq 'Error' }).Count -gt 0
    if (-not $errorRedirected) { continue }
    $scanned++
    $preference = Get-Preference $command
    if ($preference -ne 'Continue') {
      [Console]::Out.WriteLine("STOP $([IO.Path]::GetFileName($path)):$($command.Extent.StartLineNumber)")
    }
  }
}
[Console]::Out.WriteLine("SCANNED $scanned")
"""


def _pwsh() -> str:
    found = os.environ.get("JHT_TEST_PWSH") or shutil.which("pwsh")
    if found:
        return found
    if os.environ.get("CI"):
        pytest.fail("pwsh is missing on the CI runner: the stderr gate would go untested")
    pytest.skip("pwsh not installed")


def _gate(tmp_path: Path, files: list[Path]) -> tuple[list[str], int]:
    script = tmp_path / "gate.ps1"
    script.write_text(GATE, encoding="utf-8")
    result = subprocess.run(
        [_pwsh(), "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(script)],
        env={**os.environ, "JHT_GATE_FILES": os.pathsep.join(str(f) for f in files)},
        capture_output=True, text=True, timeout=120,
    )
    assert result.returncode == 0, result.stderr
    found = sorted(set(re.findall(r"^STOP (\S+)$", result.stdout, flags=re.MULTILINE)))
    scanned = int(re.search(r"^SCANNED (\d+)$", result.stdout, flags=re.MULTILINE).group(1))
    return found, scanned


def test_every_covered_script_runs_under_stop():
    for path in COVERED:
        assert re.search(r"^\$ErrorActionPreference = 'Stop'$", path.read_text(encoding="utf-8"), re.MULTILINE), path.name


def test_no_redirected_native_call_of_the_windows_scripts_runs_under_stop(tmp_path):
    found, scanned = _gate(tmp_path, COVERED)
    assert found == [], "under 'Stop' Windows PowerShell 5.1 stops on a line of their stderr: " + ", ".join(found)
    # it read the scripts' redirected native calls, not an empty search
    assert scanned >= 15, scanned


def test_the_gate_sees_the_old_lines_and_nothing_else(tmp_path):
    old = tmp_path / "old.ps1"
    old.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        "[string]$p = (& $Podman --connection $MachineName inspect jht --format '{{json .Config.Labels}}' 2>$null | Select-Object -First 1)\n"
        "function Get-State { param($Name)\n"
        "  $json = ((& podman machine list --format json 2>$null) -join \"`n\")\n"
        "}\n"
        "$null = & $wsl.Source --status 2>&1\n"
        "$ok = (& { $ErrorActionPreference = 'Continue'; & $Podman inspect jht 2>$null } | Select-Object -First 1)\n"
        "& $Podman ps\n"
        "$previous = $ErrorActionPreference\n"
        "$ErrorActionPreference = 'Continue'\n"
        "try { & $Podman machine ssh m 'true' 2>$null | Out-Null } finally { $ErrorActionPreference = $previous }\n"
        "& $Podman inspect jht 2>$null\n",
        encoding="utf-8",
    )
    found, scanned = _gate(tmp_path, [old])
    # lines 2, 4, 6 and 12 run under 'Stop' (12: after the finally put 'Stop' back); 7 and 11 under 'Continue'
    assert found == ["old.ps1:12", "old.ps1:2", "old.ps1:4", "old.ps1:6"]
    assert scanned == 6

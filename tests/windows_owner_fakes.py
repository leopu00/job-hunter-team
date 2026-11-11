"""Stand-ins of who owns a node, for the tests of the Windows runtime that must work from an ELEVATED process.

From an elevated process what the wrapper and its helpers make is owned by the group Administrators; the wrapper trusts only the person's own
nodes (Test-ProtectedRuntimeNode). On a machine where owners are not a thing (pwsh off Windows) the stand-ins say who owns what:
- a registry file (T_OWNERS, lines `<path>|<owner>`, owner `user`, `admin` or `other`) holds what the test fixes in advance;
- a node that is not in it is owned by who made it: the Administrators when T_ELEVATED=1, the person otherwise;
- Test-ProtectedRuntimeNode is the rule of the wrapper: a plain node of the right kind, owned by the person;
- Set-ProtectedRuntimeNodeOwner is the contract of the real one: the person's node is left, the Administrators' becomes the person's, anybody
  else's is refused (false); with T_NO_FIX=1 it is a function that says yes and changes nothing (the code before the fix: the control of a test).
"""

from __future__ import annotations

import re

STAND_INS = r"""
function Get-FakeOwner {
  param([string]$Path)
  $row = @(Get-Content -LiteralPath $env:T_OWNERS -ErrorAction SilentlyContinue | Where-Object { $_ -like "$Path|*" })
  if ($row.Count) { return ($row[$row.Count - 1] -split '\|')[1] }
  if ($env:T_ELEVATED -eq '1') { return 'admin' }
  return 'user'
}
function Set-FakeOwner { param([string]$Path, [string]$Owner) Add-Content -LiteralPath $env:T_OWNERS -Value "$Path|$Owner" }
function Test-ProtectedRuntimeNode {
  param([string]$Path, [switch]$Directory)
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if (-not $item) { return $false }
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
  if ([bool]$Directory -ne [bool]$item.PSIsContainer) { return $false }
  return ((Get-FakeOwner $Path) -ceq 'user')
}
if ($env:T_NO_FIX -eq '1') {
  function Set-ProtectedRuntimeNodeOwner { param([string]$Path) return $true }
} else {
  function Set-ProtectedRuntimeNodeOwner {
    param([string]$Path)
    $owner = Get-FakeOwner $Path
    if ($owner -ceq 'user') { return $true }
    if ($owner -ceq 'admin') { Set-FakeOwner $Path 'user'; return $true }
    return $false
  }
}
"""


def function_text(source: str, name: str) -> str:
    """The text of `function <name> { ... }` of a script, up to the closing brace at the start of a line."""
    match = re.search(rf"^function {re.escape(name)} \{{\n.*?^\}}\n", source, re.S | re.M)
    assert match, name
    return match.group(0)


def owners_of(path) -> dict[str, str]:
    rows = [line.rsplit("|", 1) for line in path.read_text(encoding="utf-8").splitlines() if "|" in line]
    return {node: who for node, who in rows}

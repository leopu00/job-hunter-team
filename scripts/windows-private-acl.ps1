# Never Set-Acl. When the target's access rules are already protected (as a
# previous install leaves ~/.jht), Windows PowerShell's Set-Acl writes the SACL
# too. That needs SeSecurityPrivilege, which only an elevated process holds:
# the desktop app, a normal user, got PrivilegeNotHeldException on ~/.jht.
# .NET persists only the sections that changed (access rules, owner).
function Set-JhtAccessControl {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$Acl)
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if ($PSVersionTable.PSEdition -eq 'Core') { [IO.FileSystemAclExtensions]::SetAccessControl($item, $Acl) }
  else { $item.SetAccessControl($Acl) }
}

function Protect-JhtHomeAcl {
  param([Parameter(Mandatory)][string]$Path)
  $owner = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  # The folder is walked by hand. A reparse point (a link, a junction) is neither changed nor entered: the agents write in
  # this folder, a link one of them leaves would carry the change of the ACL to a file or a folder of the person outside the
  # mounts, and Windows PowerShell 5.1's recursive Get-ChildItem walks into links.
  $nodes = New-Object System.Collections.Generic.List[object]
  $nodes.Add((Get-Item -LiteralPath $Path -Force))
  $pending = New-Object System.Collections.Generic.Stack[string]
  $pending.Push($Path)
  while ($pending.Count -gt 0) {
    $folder = $pending.Pop()
    foreach ($child in @(Get-ChildItem -LiteralPath $folder -Force)) {
      if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
      $nodes.Add($child)
      if ($child.PSIsContainer) { $pending.Push($child.FullName) }
    }
  }
  foreach ($node in $nodes) {
    # looked at again right before the write: a node that became a link since the walk is left alone
    if ($node.FullName -ne $Path) {
      $now = Get-Item -LiteralPath $node.FullName -Force -ErrorAction SilentlyContinue
      if (-not $now -or ($now.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    }
    $acl = Get-Acl -LiteralPath $node.FullName
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existing in @($acl.Access)) {
      if ($existing.AccessControlType -eq 'Allow' -and $existing.IdentityReference.Value -ne $owner -and
          $existing.IdentityReference.Value -notin @('NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')) {
        [void]$acl.RemoveAccessRule($existing)
      }
    }
    $inherit = if ($node.PSIsContainer) { 'ContainerInherit,ObjectInherit' } else { 'None' }
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($owner, 'FullControl', $inherit, 'None', 'Allow')
    $acl.SetAccessRule($rule)
    Set-JhtAccessControl -Path $node.FullName -Acl $acl
  }
  $check = Get-Acl -LiteralPath $Path
  if (-not $check.AreAccessRulesProtected) { throw "ACL inheritance remains enabled: $Path" }
}

function Test-PrivateJhtHomeAcl {
  param([Parameter(Mandatory)][string]$Path)
  try {
    $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
    if (-not $acl.AreAccessRulesProtected) { return $false }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    foreach ($rule in $acl.Access) {
      if ($rule.AccessControlType -ne 'Allow') { continue }
      $rSid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
      if ($rSid -ne $sid -and $rSid -notin @('S-1-5-18','S-1-5-32-544')) { return $false }
    }
    return $true
  } catch { return $false }
}

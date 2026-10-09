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
  $nodes = @(Get-Item -LiteralPath $Path) + @(Get-ChildItem -LiteralPath $Path -Force -Recurse)
  foreach ($node in $nodes) {
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

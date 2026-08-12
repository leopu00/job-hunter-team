function Protect-JhtHomeAcl {
  param([Parameter(Mandatory)][string]$Path)
  $owner = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $nodes = @(Get-Item -LiteralPath $Path) + @(Get-ChildItem -LiteralPath $Path -Force -Recurse)
  foreach ($node in $nodes) {
    $acl = Get-Acl -LiteralPath $node.FullName
    $acl.SetAccessRuleProtection($true, $false)
    $inherit = if ($node.PSIsContainer) { 'ContainerInherit,ObjectInherit' } else { 'None' }
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($owner, 'FullControl', $inherit, 'None', 'Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $node.FullName -AclObject $acl
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

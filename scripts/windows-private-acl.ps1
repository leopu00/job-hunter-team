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
  $rootFull = (Get-Item -LiteralPath $Path -Force).FullName.TrimEnd('\')
  # a node is under a link when it, or a folder above it up to the root, is a reparse point (or is gone)
  $underLink = {
    param([string]$Candidate)
    $step = Get-Item -LiteralPath $Candidate -Force -ErrorAction SilentlyContinue
    while ($step) {
      if ($step.FullName.TrimEnd('\') -eq $rootFull) { return $false }
      if (($step.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
      # by the type, not by PSIsContainer: that property is the provider's, and the folder this very line returns has none
      $step = if ($step -is [IO.DirectoryInfo]) { $step.Parent } else { $step.Directory }
    }
    return $true
  }
  $nodes = New-Object System.Collections.Generic.List[object]
  $nodes.Add((Get-Item -LiteralPath $Path -Force))
  $pending = New-Object System.Collections.Generic.Stack[string]
  $pending.Push($Path)
  while ($pending.Count -gt 0) {
    $folder = $pending.Pop()
    # a folder waits in the stack while others are listed: looked at again, with the folders above it, before it is listed
    if (& $underLink $folder) { continue }
    foreach ($child in @(Get-ChildItem -LiteralPath $folder -Force)) {
      if (($child.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
      $nodes.Add($child)
      if ($child.PSIsContainer) { $pending.Push($child.FullName) }
    }
  }
  foreach ($node in $nodes) {
    # looked at again right before the write, with the folders above it: a node that, or whose path, became a link since the walk is left alone
    if (& $underLink $node.FullName) { continue }
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

# A file of the bin folder is published by taking its place, never by writing in it. Writing in place truncates the file
# first: a program that holds it open for a moment (a scanner that looks at a command file just written) then leaves it
# EMPTY, and the person is left with a command that does nothing. Here the new bytes go to a temporary file beside it, and
# the temporary takes the place of the file only when it is whole; a file that is already these bytes is not touched; while
# another program holds the file open the take-over is tried again a few times, briefly, and if it never works the file is
# as it was and the error says so.
function Publish-JhtFile {
  param(
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][byte[]]$Bytes,
    [int]$Attempts = 6,
    [int]$DelayMilliseconds = 500,
    # called with the number of the attempt that found the file held, before the next one (a seam for tests)
    [scriptblock]$OnBusy
  )
  $digest = {
    param([byte[]]$Data)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($sha.ComputeHash($Data)) } finally { $sha.Dispose() }
  }
  if ([IO.File]::Exists($Destination)) {
    $current = $null
    try { $current = [IO.File]::ReadAllBytes($Destination) } catch [IO.IOException] { }
    if ($null -ne $current -and $current.Length -eq $Bytes.Length -and (& $digest $current) -ceq (& $digest $Bytes)) { return }
  }
  $folder = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Destination))
  $temporary = [IO.Path]::Combine($folder, ('.jht-publish-{0}.tmp' -f [guid]::NewGuid().ToString('N')))
  try {
    $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($Bytes, 0, $Bytes.Length); $stream.Flush() } finally { $stream.Dispose() }
    for ($attempt = 1; $true; $attempt++) {
      try {
        if ([IO.File]::Exists($Destination)) { [IO.File]::Replace($temporary, $Destination, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $Destination) }
        return
      } catch [IO.IOException] {
        if ($attempt -ge $Attempts) {
          throw ("{0} could not be replaced: another program holds it open ({1}). It was left as it was; close that program and run the installer again." -f $Destination, $_.Exception.Message)
        }
        if ($OnBusy) { & $OnBusy $attempt }
        Start-Sleep -Milliseconds $DelayMilliseconds
      }
    }
  } finally {
    if ([IO.File]::Exists($temporary)) { try { [IO.File]::Delete($temporary) } catch { } }
  }
}

# JHT-T352 F-13: is the private ACL of ~/.jht the one that holds?
#
# Inside the container /jht_home shows rwxrwxrwx: the Podman machine reaches %USERPROFILE%\.jht through the WSL mount of
# C: (drvfs over 9p), which has no Linux metadata and shows every node as 0777. Those bits are made up by the mount: every
# access goes to Windows with the token of the Windows user who runs the machine, and Windows decides with the folder's
# ACL. So what protects the folder from the other people of the computer is the ACL that install.ps1 sets
# (Protect-JhtHomeAcl): this script checks it the way it is used, as ANOTHER Windows user, not an administrator.
#
#   1. a synthetic ~/.jht (a config, a database in a subfolder) protected by Protect-JhtHomeAcl;
#   2. a local user made for the run, member of Users only, tries to list, read and write in it: all must be denied;
#   3. counter-proof: the same user reads a folder that is not protected, so a "denied" above is the ACL, not a probe that
#      cannot read anything;
#   4. the user, its profile and the folders are removed.
# Needs an elevated runner (it makes a local user). Never run it on a person's computer.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\windows-private-acl.ps1')

$root = Join-Path $env:SystemDrive ('jht-acl-cross-' + [guid]::NewGuid().ToString('N'))
$jhtHome = Join-Path $root 'profile\.jht'
$open = Join-Path $root 'open'
$out = Join-Path $root 'out'
$name = 'jhtacl' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$userMade = $false
try {
  foreach ($folder in @($jhtHome, (Join-Path $jhtHome 'data'), $open, $out)) { [void][IO.Directory]::CreateDirectory($folder) }
  [IO.File]::WriteAllText((Join-Path $jhtHome 'jht.config.json'), '{"active_provider": "synthetic"}')
  [IO.File]::WriteAllText((Join-Path $jhtHome 'data\jobs.db'), 'synthetic database')
  [IO.File]::WriteAllText((Join-Path $open 'open.txt'), 'readable by the users of the computer')
  # the counter-proof folder: Users may read; the results folder: everyone may write the result
  & icacls.exe $open /grant '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'icacls on the open folder failed.' }
  & icacls.exe $out /grant '*S-1-1-0:(OI)(CI)M' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'icacls on the results folder failed.' }

  Protect-JhtHomeAcl -Path $jhtHome
  if (-not (Test-PrivateJhtHomeAcl -Path $jhtHome)) { throw 'Test-PrivateJhtHomeAcl refused the folder Protect-JhtHomeAcl made.' }
  [Console]::Out.WriteLine("T352_ACL sddl=$((Get-Acl -LiteralPath $jhtHome).Sddl)")
  foreach ($rule in @((Get-Acl -LiteralPath $jhtHome).Access)) {
    [Console]::Out.WriteLine("T352_ACL rule=$($rule.AccessControlType) $($rule.IdentityReference.Value) $($rule.FileSystemRights) inherited=$($rule.IsInherited)")
  }

  $chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object byte[] 24
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $password = 'Aa1!' + (-join @($bytes | ForEach-Object { $chars[$_ % $chars.Length] }))
  $secure = ConvertTo-SecureString $password -AsPlainText -Force
  New-LocalUser -Name $name -Password $secure -AccountNeverExpires -Description 'JHT ACL gate, removed at the end of the run' | Out-Null
  $userMade = $true
  if (-not @(Get-LocalGroupMember -SID 'S-1-5-32-545' | Where-Object { $_.Name -like "*\$name" }).Count) { Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $name }
  $admins = @(Get-LocalGroupMember -SID 'S-1-5-32-544' | Where-Object { $_.Name -like "*\$name" })
  if ($admins.Count) { throw 'The probe user is an administrator.' }

  $probe = Join-Path $out 'probe.ps1'
  $result = Join-Path $out 'result.txt'
  [IO.File]::WriteAllText($probe, @'
param([string]$JhtHome, [string]$Open, [string]$Result)
$lines = New-Object System.Collections.Generic.List[string]
function Try-It([string]$Label, [scriptblock]$Do) {
  try { & $Do | Out-Null; $lines.Add("$Label=allowed") }
  catch [UnauthorizedAccessException] { $lines.Add("$Label=denied") }
  catch { $lines.Add("$Label=error:$($_.Exception.GetType().Name)") }
}
$lines.Add("whoami=$([Security.Principal.WindowsIdentity]::GetCurrent().Name)")
Try-It 'list_home' { [IO.Directory]::GetFileSystemEntries($JhtHome) }
Try-It 'read_config' { [IO.File]::ReadAllText((Join-Path $JhtHome 'jht.config.json')) }
Try-It 'read_database' { [IO.File]::ReadAllText((Join-Path $JhtHome 'data\jobs.db')) }
Try-It 'write_home' { [IO.File]::WriteAllText((Join-Path $JhtHome 'planted.txt'), 'x') }
Try-It 'read_open' { [IO.File]::ReadAllText((Join-Path $Open 'open.txt')) }
[IO.File]::WriteAllLines($Result, $lines)
'@)
  $credential = New-Object Management.Automation.PSCredential($name, $secure)
  $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $child = Start-Process -FilePath $windowsPowerShell -Credential $credential -WorkingDirectory $out -PassThru -Wait -WindowStyle Hidden `
    -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$probe`"", '-JhtHome', "`"$jhtHome`"", '-Open', "`"$open`"", '-Result', "`"$result`"")
  if ($child.ExitCode -ne 0) { throw "The probe of the other user exited with $($child.ExitCode)." }
  $seen = @{}
  foreach ($line in [IO.File]::ReadAllLines($result)) {
    [Console]::Out.WriteLine("T352_ACL other_user $line")
    $cut = $line.IndexOf('=')
    $seen[$line.Substring(0, $cut)] = $line.Substring($cut + 1)
  }
  if ($seen['whoami'] -notlike "*\$name") { throw "The probe did not run as the other user: $($seen['whoami'])" }
  foreach ($denied in 'list_home', 'read_config', 'read_database', 'write_home') {
    if ($seen[$denied] -ne 'denied') { throw "The other user got ${denied}: $($seen[$denied])" }
  }
  if ($seen['read_open'] -ne 'allowed') { throw "Counter-proof failed: the other user could not read an open folder ($($seen['read_open']))." }
  if ([IO.File]::Exists((Join-Path $jhtHome 'planted.txt'))) { throw 'The other user planted a file in ~/.jht.' }
  [Console]::Out.WriteLine("T352_ACL_CROSS_USER engine=$($PSVersionTable.PSVersion) other_user_denied=list,read,write counter_proof_open_read=allowed PASS")
} finally {
  if ($userMade) {
    $sid = (Get-LocalUser -Name $name).SID.Value
    Remove-LocalUser -Name $name
    $userProfile = Get-CimInstance -ClassName Win32_UserProfile -Filter "SID = '$sid'" -ErrorAction SilentlyContinue
    if ($userProfile) { $userProfile | Remove-CimInstance -ErrorAction SilentlyContinue }
  }
  if ([IO.Directory]::Exists($root)) { Remove-Item -LiteralPath $root -Recurse -Force }
}

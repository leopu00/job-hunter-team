$ErrorActionPreference = 'Stop'
$root = Join-Path $env:RUNNER_TEMP ("jht-acl-selftest-" + [guid]::NewGuid().ToString('N'))
. (Join-Path $PSScriptRoot 'windows-private-acl.ps1')
New-Item -ItemType Directory -Path $root -Force | Out-Null
try {
  $owner = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $foreign = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')
  $acl = Get-Acl $root
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($foreign, 'FullControl', 'Allow')))
  Set-Acl $root $acl

  Protect-JhtHomeAcl -Path $root
  $effective = Get-Acl $root
  $allowed = @($owner, 'NT AUTHORITY\SYSTEM', 'BUILTIN\Administrators')
  if (-not $effective.AreAccessRulesProtected) { throw 'inheritance still enabled' }
  foreach ($rule in $effective.Access) {
    if ($rule.AccessControlType -eq 'Allow' -and $allowed -notcontains $rule.IdentityReference.Value) {
      throw "unexpected writable ACE: $($rule.IdentityReference.Value)"
    }
  }
  if (-not (Test-PrivateJhtHomeAcl -Path $root)) { throw 'foreign ACE survived repair' }

  # A broad ACE must fail before docker compose is reached.
  $bad = Join-Path $root 'bad'; New-Item -ItemType Directory $bad | Out-Null
  $badAcl = Get-Acl $bad; $badAcl.SetAccessRuleProtection($true, $false)
  $badAcl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($foreign, 'FullControl', 'Allow')))
  Set-Acl $bad $badAcl
  $env:JHT_HOME_HOST = $bad
  $env:JHT_RUNTIME_DIR = (Join-Path $root 'runtime')
  $env:JHT_COMPOSE_FILE = (Join-Path $env:JHT_RUNTIME_DIR 'docker-compose.yml')
  $output = & powershell -NoProfile -File (Join-Path $PSScriptRoot 'jht-wrapper.ps1') status 2>&1
  if ($LASTEXITCODE -eq 0 -or ($output -notmatch 'owner-only|ACL')) { throw 'wrapper did not fail closed before compose' }
  Write-Host 'WINDOWS-CONFIG-ACL-SELFTEST PASS'
} finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }

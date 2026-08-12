$ErrorActionPreference = 'Stop'
$root = Join-Path $env:RUNNER_TEMP ("jht-acl-selftest-" + [guid]::NewGuid().ToString('N'))
. (Join-Path $PSScriptRoot 'windows-private-acl.ps1')
New-Item -ItemType Directory -Path $root -Force | Out-Null
try {
  $owner = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $foreign = New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-545')
  foreach ($script in @('install.ps1', 'jht-wrapper.ps1', 'windows-private-acl.ps1', 'windows-config-acl-selftest.ps1')) {
    $path = Join-Path $PSScriptRoot $script
    [void][scriptblock]::Create((Get-Content -LiteralPath $path -Raw))
  }
  $a = Get-FileHash (Join-Path $PSScriptRoot 'install.ps1') -Algorithm SHA256
  $b = Get-FileHash (Join-Path $PSScriptRoot '..\web\public\install.ps1') -Algorithm SHA256
  if ($a.Hash -ne $b.Hash) { throw 'public installer is not byte-identical to scripts/install.ps1' }
  $standalone = Join-Path $root 'standalone-install.ps1'
  Copy-Item (Join-Path $PSScriptRoot 'install.ps1') $standalone
  if (Test-Path (Join-Path $root 'windows-private-acl.ps1')) { throw 'standalone fixture unexpectedly has helper' }
  $tokens = $null; $errors = $null
  $ast = [System.Management.Automation.Language.Parser]::ParseFile($standalone, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw "standalone parse failed: $($errors[0])" }
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Protect-JhtHomeAcl' }, $true)
  if (-not $fn) { throw 'standalone Protect-JhtHomeAcl function missing' }
  . ([scriptblock]::Create($fn.Extent.Text))
  $standaloneFixture = Join-Path $root 'standalone-fixture'
  New-Item -ItemType Directory -Path $standaloneFixture -Force | Out-Null
  $foreignRule = New-Object System.Security.AccessControl.FileSystemAccessRule($foreign, 'FullControl', 'Allow')
  $standaloneAcl = Get-Acl $standaloneFixture; $standaloneAcl.SetAccessRuleProtection($true, $false); $standaloneAcl.AddAccessRule($foreignRule); Set-Acl $standaloneFixture $standaloneAcl
  Protect-JhtHomeAcl -Path $standaloneFixture
  if (-not (Test-PrivateJhtHomeAcl -Path $standaloneFixture)) { throw 'standalone inline ACL repair failed' }
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
  $output = & powershell -NoProfile -File (Join-Path $PSScriptRoot 'jht-wrapper.ps1') up 2>&1
  $wrapperExit = $LASTEXITCODE
  $outputText = ($output | Out-String)
  if ($wrapperExit -eq 0 -or -not ($outputText -match 'owner-only|ACL')) { throw 'wrapper did not fail closed before compose' }
  Write-Host 'WINDOWS-CONFIG-ACL-SELFTEST PASS'
} finally { Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue }
exit 0

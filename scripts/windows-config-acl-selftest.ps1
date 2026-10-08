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
  foreach ($installerFunctionName in @('Protect-JhtHomeAcl', 'Set-JhtNodeOwner')) {
    $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $installerFunctionName }, $true)
    if (-not $fn) { throw "standalone $installerFunctionName function missing" }
    . ([scriptblock]::Create($fn.Extent.Text))
  }
  $standaloneFixture = Join-Path $root 'standalone-fixture'
  New-Item -ItemType Directory -Path $standaloneFixture -Force | Out-Null
  $foreignRule = New-Object System.Security.AccessControl.FileSystemAccessRule($foreign, 'FullControl', 'Allow')
  $standaloneAcl = Get-Acl $standaloneFixture; $standaloneAcl.SetAccessRuleProtection($true, $false); $standaloneAcl.AddAccessRule($foreignRule); Set-Acl $standaloneFixture $standaloneAcl
  Protect-JhtHomeAcl -Path $standaloneFixture
  if (-not (Test-PrivateJhtHomeAcl -Path $standaloneFixture)) { throw 'standalone inline ACL repair failed' }

  # E03 CLEAN_START: exercise the real installer function with exact repository
  # bytes, then run the installed wrapper far enough to observe Docker. This is
  # deliberately stronger than checking that three destination paths exist:
  # the regression was a syntactically valid install whose first `jht up`
  # failed while dot-sourcing an omitted sibling helper.
  $getRuntimeFiles = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-RuntimeFiles' }, $true)
  if (-not $getRuntimeFiles) { throw 'standalone Get-RuntimeFiles function missing' }
  . ([scriptblock]::Create($getRuntimeFiles.Extent.Text))
  function Write-Step { param([int]$N, [int]$Total, [string]$Title) }
  function Write-Info { param([string]$Msg) }
  function Write-Ok { param([string]$Msg) }
  function Write-Dry { param([string]$Cmd) throw "unexpected dry run: $Cmd" }
  function Write-Fail { param([string]$Msg) throw $Msg }
  function Invoke-Action {
    param([scriptblock]$Block, [string]$Description)
    & $Block
  }
  function Get-File {
    param([string]$Url, [string]$Dest)
    $source = switch -Wildcard ($Url) {
      '*/docker-compose.yml' { Join-Path $PSScriptRoot '..\docker-compose.yml'; break }
      '*/scripts/jht-wrapper.ps1' { Join-Path $PSScriptRoot 'jht-wrapper.ps1'; break }
      '*/scripts/windows-private-acl.ps1' { Join-Path $PSScriptRoot 'windows-private-acl.ps1'; break }
      default { throw "unexpected clean-start URL: $Url" }
    }
    Copy-Item -LiteralPath $source -Destination $Dest
  }

  $cleanRoot = Join-Path $root 'clean-start'
  $cleanProfile = Join-Path $cleanRoot 'profile'
  $cleanUserData = Join-Path $cleanProfile 'Documents\Job Hunter Team'
  $RuntimeDir = Join-Path $cleanRoot 'host-runtime'
  $BinDir = Join-Path $cleanRoot 'bin'
  $JhtHome = Join-Path $cleanProfile '.jht'
  $RawBaseOverride = 'https://clean-start.invalid/revision'
  $Branch = 'clean-start-fixture'
  $DryRun = $false
  $env:USERPROFILE = $cleanProfile
  $env:JHT_USER_DIR_HOST = $cleanUserData
  New-Item -ItemType Directory -Path $cleanProfile, $cleanUserData -Force | Out-Null
  Get-RuntimeFiles

  $installedWrapper = Join-Path $BinDir 'jht.ps1'
  $installedHelper = Join-Path $BinDir 'windows-private-acl.ps1'
  $manifest = Join-Path $RuntimeDir '.runtime-integrity'
  foreach ($installed in @($installedWrapper, $installedHelper, $manifest, (Join-Path $RuntimeDir 'docker-compose.yml'))) {
    if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) { throw "clean-start artifact missing: $installed" }
  }
  $sourceHelperHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PSScriptRoot 'windows-private-acl.ps1')).Hash.ToLowerInvariant()
  $installedHelperHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installedHelper).Hash.ToLowerInvariant()
  $manifestValues = ConvertFrom-StringData (Get-Content -LiteralPath $manifest -Raw)
  if ($installedHelperHash -ne $sourceHelperHash -or $manifestValues.'windows-private-acl.ps1' -ne $installedHelperHash) {
    throw 'clean-start ACL helper bytes are not exactly attested'
  }
  $installedWrapperHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installedWrapper).Hash.ToLowerInvariant()
  $installedCompose = Join-Path $RuntimeDir 'docker-compose.yml'
  $installedComposeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installedCompose).Hash.ToLowerInvariant()
  if ($manifestValues.'jht-wrapper.ps1' -ne $installedWrapperHash -or $manifestValues.'docker-compose.yml' -ne $installedComposeHash) {
    throw 'clean-start wrapper or compose bytes are not exactly attested'
  }

  # Name the failed trust predicate instead of collapsing every native CI
  # failure into the wrapper's intentionally generic production error.
  $wrapperTokens = $null; $wrapperErrors = $null
  $wrapperAst = [System.Management.Automation.Language.Parser]::ParseFile($installedWrapper, [ref]$wrapperTokens, [ref]$wrapperErrors)
  if ($wrapperErrors.Count) { throw "installed wrapper parse failed: $($wrapperErrors[0])" }
  foreach ($functionName in @('Test-RuntimePathAuthority', 'Test-RuntimeAncestorsWithoutReparsePoint', 'Test-ProtectedRuntimeNode', 'Test-RuntimeDirectoryAcl')) {
    $functionAst = $wrapperAst.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $functionName }, $true)
    if (-not $functionAst) { throw "installed wrapper trust predicate missing: $functionName" }
    . ([scriptblock]::Create($functionAst.Extent.Text))
  }
  $ComposeFile = $installedCompose
  $RuntimeManifest = $manifest
  $WrapperPath = $installedWrapper
  $trustChecks = [ordered]@{
    path_authority = (Test-RuntimePathAuthority)
    runtime_ancestors = (Test-RuntimeAncestorsWithoutReparsePoint $RuntimeDir)
    wrapper_ancestors = (Test-RuntimeAncestorsWithoutReparsePoint $WrapperPath)
    runtime_node = (Test-ProtectedRuntimeNode $RuntimeDir -Directory)
    runtime_acl = (Test-RuntimeDirectoryAcl)
    compose_node = (Test-ProtectedRuntimeNode $ComposeFile)
    manifest_node = (Test-ProtectedRuntimeNode $RuntimeManifest)
    wrapper_node = (Test-ProtectedRuntimeNode $WrapperPath)
  }
  $failedTrustChecks = @($trustChecks.Keys | Where-Object { -not $trustChecks[$_] })
  if ($failedTrustChecks.Count) { throw "clean-start trust predicate failed: $($failedTrustChecks -join ', ')" }

  $fakeBin = Join-Path $cleanRoot 'fake-bin'
  $dockerLog = Join-Path $cleanRoot 'docker.log'
  New-Item -ItemType Directory -Path $fakeBin | Out-Null
  $dockerCmd = @"
@echo off
>>"$dockerLog" echo %*
if "%~1"=="run" (
  if not "%JHT_FAKE_REPAIR_EMPTY%"=="1" (
    echo mount_repaired /jht_home
    echo mount_repaired /jht_user
  )
)
exit /b 0
"@
  Set-Content -LiteralPath (Join-Path $fakeBin 'docker.cmd') -Value $dockerCmd -Encoding ASCII
  $env:PATH = "$fakeBin;$env:PATH"
  $env:JHT_HOME_HOST = $JhtHome
  $env:JHT_RUNTIME_DIR = $RuntimeDir
  $env:JHT_COMPOSE_FILE = Join-Path $RuntimeDir 'docker-compose.yml'
  $env:JHT_WRAPPER_PATH = $installedWrapper
  $windowsPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $installerOutput = & $windowsPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $standalone -DryRun -SkipOnboard 2>&1
  if ($LASTEXITCODE -ne 0) { throw "desktop noninteractive installer contract failed: $($installerOutput | Out-String)" }
  if (($installerOutput | Out-String) -match 'Launching the setup wizard') { throw 'desktop installer unexpectedly launched onboarding' }

  $env:JHT_FAKE_REPAIR_EMPTY = '1'
  $emptyRepairOutput = & $windowsPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installedWrapper up 2>&1
  $emptyRepairExit = $LASTEXITCODE
  Remove-Item Env:JHT_FAKE_REPAIR_EMPTY
  if ($emptyRepairExit -eq 0) { throw 'empty mount-repair output was accepted' }
  $emptyRepairCalls = Get-Content -LiteralPath $dockerLog -Raw
  if ($emptyRepairCalls -match '(?m)^compose .* up -d\s*$') { throw 'empty mount-repair output reached compose up' }
  Clear-Content -LiteralPath $dockerLog

  $output = & $windowsPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installedWrapper up 2>&1
  $wrapperExit = $LASTEXITCODE
  if ($wrapperExit -ne 0) { throw "E03 clean-start wrapper failed before Docker: $($output | Out-String)" }
  $dockerCalls = Get-Content -LiteralPath $dockerLog -Raw
  # A mount whose host path has a space (Documents\Job Hunter Team) is quoted
  # whole, so the fake docker logs -v "...:/jht_user" with the quote last.
  $repairCall = [regex]::Match($dockerCalls, '(?m)^run .*--user 0:0 .*--cap-drop ALL .*--cap-add CHOWN .*--network none .*--security-opt no-new-privileges .*:/jht_home"? .*:/jht_user"? .*$')
  if (-not $repairCall.Success) { throw "E03 clean-start did not use the confined mount repair: $dockerCalls" }
  if ($dockerCalls -notmatch '(?m)^compose .* up -d\s*$') { throw "E03 clean-start did not reach docker compose up -d: $dockerCalls" }
  if ($repairCall.Index -gt $dockerCalls.IndexOf(' up -d')) { throw 'E03 clean-start reached compose up before mount repair' }

  # The fake compose deliberately returns no service id: the desktop must get
  # the exact eight-line, exit-zero inactive snapshot without starting again.
  $snapshotOutput = @(& $windowsPowerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installedWrapper onboarding-snapshot 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "desktop onboarding snapshot failed: $($snapshotOutput | Out-String)" }
  $expectedSnapshot = @(
    'runtimeInstalled=1', 'containerRunning=0', 'providerConfigured=0', 'providerAuthenticated=0',
    'assistantWelcomed=0', 'assistantRunning=0', 'captainRunning=0', 'profileReady=0'
  )
  if (($snapshotOutput -join "`n") -ne ($expectedSnapshot -join "`n")) {
    throw "desktop onboarding snapshot schema changed: $($snapshotOutput | Out-String)"
  }
  Write-Host 'E03 CLEAN_START installer-helper-smoke PASS'

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

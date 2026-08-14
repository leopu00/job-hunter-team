# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Job Hunter Team — Windows-native installer (PowerShell)                 ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Usage:                                                                  ║
# ║    iwr -useb https://jobhunterteam.ai/install.ps1 | iex                  ║
# ║                                                                          ║
# ║    # Alternative branch, to test dev-N:                                  ║
# ║    & ([scriptblock]::Create((iwr -useb https://raw.githubusercontent.com/leopu00/job-hunter-team/master/scripts/install.ps1).Content)) -Branch dev-1
# ║                                                                          ║
# ║  Default (Docker mode): installs nothing on the host except Docker       ║
# ║  Desktop (which must already be there; we check for it but do not        ║
# ║  download it for you — it needs user consent + WSL2 + a reboot).         ║
# ║                                                                          ║
# ║  Downloads:                                                              ║
# ║    - $env:LOCALAPPDATA\Job Hunter Team\host-runtime\docker-compose.yml   ║
# ║    - $env:USERPROFILE\.local\bin\jht.ps1 (PowerShell wrapper)            ║
# ║    - $env:USERPROFILE\.local\bin\jht.cmd (shim for CMD)                  ║
# ║                                                                          ║
# ║  The Node CLI, Python, tmux and the agents ALL run inside the long-      ║
# ║  running container managed by compose. No Node/Python/tmux on the host.  ║
# ║  No Docker socket inside the container.                                  ║
# ║                                                                          ║
# ║  Only two host folders are exposed to the container:                     ║
# ║    $env:USERPROFILE\.jht                  → /jht_home                    ║
# ║    $env:USERPROFILE\Documents\Job Hunter Team → /jht_user                ║
# ║                                                                          ║
# ║  Differences vs install.sh (Linux/macOS):                                ║
# ║    - NO --no-docker: Windows native (Node+tmux+Claude standalone) is     ║
# ║      not supported. The container is the only path.                      ║
# ║    - NO sudo / apt / dnf / pacman / Colima / Homebrew: Docker Desktop    ║
# ║      is the only runtime; pre-install it via winget or by hand.          ║
# ║    - PATH registered with [Environment]::SetEnvironmentVariable in the   ║
# ║      User scope (no shell rc). Effective from the next terminal.         ║
# ║                                                                          ║
# ║  Parameters:                                                             ║
# ║    -DryRun           Show the actions without running them               ║
# ║    -Branch <name>    Source branch (default: production)                 ║
# ║    -PairingToken     Opaque token for VPS pairing (skips the wizard)     ║
# ║    -SkipOnboard      Do not launch the wizard at the end                 ║
# ║                                                                          ║
# ║  Design reference: docs/internal/ops/vps.md                              ║
# ╚══════════════════════════════════════════════════════════════════════════╝

[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$Branch = $(if ($env:JHT_BRANCH) { $env:JHT_BRANCH } else { 'production' }),
  [string]$PairingToken = '',
  [switch]$SkipOnboard
)

$ErrorActionPreference = 'Stop'

# ── Config ────────────────────────────────────────────────────────────────
$LocalAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
if (-not $LocalAppData) { throw 'LOCALAPPDATA is unavailable: refusing an unprotected runtime fallback' }
$RuntimeDir = if ($env:JHT_RUNTIME_DIR) { $env:JHT_RUNTIME_DIR } else { Join-Path $LocalAppData 'Job Hunter Team\host-runtime' }
$BinDir     = if ($env:JHT_BIN_DIR)     { $env:JHT_BIN_DIR }     else { Join-Path $env:USERPROFILE '.local\bin' }
$JhtHome    = Join-Path $env:USERPROFILE '.jht'
function Protect-JhtHomeAcl {
  param([Parameter(Mandatory)][string]$Path)
  $owner = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $nodes = @(Get-Item -LiteralPath $Path) + @(Get-ChildItem -LiteralPath $Path -Force -Recurse)
  foreach ($node in $nodes) {
    $acl = Get-Acl -LiteralPath $node.FullName
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existing in @($acl.Access)) {
      if ($existing.AccessControlType -eq 'Allow' -and $existing.IdentityReference.Value -ne $owner -and $existing.IdentityReference.Value -notin @('NT AUTHORITY\\SYSTEM','BUILTIN\\Administrators')) { [void]$acl.RemoveAccessRule($existing) }
    }
    $inherit = if ($node.PSIsContainer) { 'ContainerInherit,ObjectInherit' } else { 'None' }
    $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($owner, 'FullControl', $inherit, 'None', 'Allow')))
    Set-Acl -LiteralPath $node.FullName -AclObject $acl
  }
  if (-not (Get-Acl -LiteralPath $Path).AreAccessRulesProtected) { throw "ACL inheritance remains enabled: $Path" }
}
$Image      = if ($env:JHT_IMAGE)       { $env:JHT_IMAGE }       else { 'ghcr.io/leopu00/jht@sha256:07b154bee43f32d2e6313c54f28e389836556e2b5cbe1b76d03398684c38b598' }
$env:JHT_IMAGE = $Image
$RawBaseOverride = if ($env:JHT_RAW_BASE) { $env:JHT_RAW_BASE.TrimEnd('/') } else { '' }

$TotalSteps = 5

# ── UI helpers ────────────────────────────────────────────────────────────
function Write-Ok   { param([string]$Msg) Write-Host "  $([char]0x2713) $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "  ! $Msg" -ForegroundColor Yellow }
function Write-Info { param([string]$Msg) Write-Host "  > $Msg" -ForegroundColor Cyan }
function Write-Fail { param([string]$Msg) Write-Host "  x $Msg" -ForegroundColor Red; exit 1 }
function Write-Step { param([int]$N, [int]$Total, [string]$Title) Write-Host ""; Write-Host "[$N/$Total] $Title" -ForegroundColor White }
function Write-Dry  { param([string]$Cmd) Write-Host "  [dry-run] would execute: $Cmd" -ForegroundColor DarkGray }


function Invoke-Action {
  param([scriptblock]$Block, [string]$Description)
  if ($DryRun) {
    Write-Dry $Description
    return $true
  }
  & $Block
}

function Show-Header {
  Write-Host ""
  Write-Host "+------------------------------------------+" -ForegroundColor White
  Write-Host "|     Job Hunter Team - Installer (Win)    |" -ForegroundColor White
  Write-Host "+------------------------------------------+" -ForegroundColor White
  Write-Host ""
  Write-Host "  mode:    Docker Desktop (Windows-native)" -ForegroundColor DarkGray
  Write-Host "  image:   $Image" -ForegroundColor DarkGray
  Write-Host "  branch:  $Branch" -ForegroundColor DarkGray
  Write-Host "  runtime: $RuntimeDir" -ForegroundColor DarkGray
  Write-Host "  bin:     $BinDir" -ForegroundColor DarkGray
  if ($DryRun)       { Write-Host "  dry-run: ON (no changes to the system)" -ForegroundColor Yellow }
  if ($PairingToken) { Write-Host "  pairing: token present (skips the wizard)" -ForegroundColor Yellow }
  Write-Host ""
}

# ── Step 1: System detection ──────────────────────────────────────────────
function Test-System {
  Write-Step 1 $TotalSteps "System detection"
  $os = [System.Environment]::OSVersion
  if ($os.Platform -ne 'Win32NT') {
    Write-Fail "install.ps1 only supports Windows. On Linux/macOS use install.sh."
  }
  $psVersion = $PSVersionTable.PSVersion
  if ($psVersion.Major -lt 5) {
    Write-Fail "PowerShell 5.1+ required (current version: $psVersion). Install PowerShell 7: https://aka.ms/PowerShell"
  }
  Write-Ok "Windows $($os.Version) / PowerShell $psVersion"
}

# ── Step 2: Docker Desktop check ──────────────────────────────────────────
function Test-DockerDesktop {
  Write-Step 2 $TotalSteps "Docker Desktop check"

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Warn "docker not found in PATH."
    Write-Info "Install Docker Desktop for Windows:"
    Write-Info "  - winget install Docker.DockerDesktop"
    Write-Info "  - or: https://www.docker.com/products/docker-desktop/"
    Write-Info "Docker Desktop needs WSL2 enabled and a reboot after installation."
    Write-Fail "Re-run install.ps1 once Docker Desktop is installed."
  }
  Write-Ok "docker CLI found: $(docker --version)"

  if ($DryRun) {
    Write-Dry "docker info (skip in dry-run)"
    return
  }

  $null = & docker info 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "docker daemon is not responding."
    Write-Info "Start Docker Desktop from the system tray icon or the Start menu."
    Write-Info "Wait until the status reads 'Engine running' before retrying."
    Write-Fail "Docker Desktop is not running."
  }
  Write-Ok "docker daemon reachable"

  # Check compose v2 (bundled with Docker Desktop by default, but verify)
  $null = & docker compose version 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "docker compose v2 not available. Update Docker Desktop to the latest version."
  }
  Write-Ok "docker compose v2 available"
}

# ── Step 3: Download runtime files ────────────────────────────────────────
function Get-File {
  param([string]$Url, [string]$Dest)

  if ($DryRun) {
    Write-Dry "iwr $Url -OutFile $Dest"
    return
  }

  try {
    # -UseBasicParsing avoids the dependency on the Internet Explorer engine
    # (deprecated in PS7). Force avoids the overwrite prompt.
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Dest -ErrorAction Stop
  } catch {
    Write-Fail "Download failed: $Url`n  $($_.Exception.Message)`n  Check your connection and branch ($Branch)."
  }
}

function Get-RuntimeFiles {
  Write-Step 3 $TotalSteps "Downloading wrapper + docker-compose.yml"

  if ($RawBaseOverride) {
    $releaseBase = $RawBaseOverride
  } elseif ($DryRun) {
    $releaseBase = "https://raw.githubusercontent.com/leopu00/job-hunter-team/$Branch"
  } else {
    try {
      $metadata = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/leopu00/job-hunter-team/commits/$Branch"
      $sha = [string]$metadata.sha
      if ($sha -notmatch '^[0-9a-fA-F]{40}$') { throw 'invalid release commit' }
      $releaseBase = "https://raw.githubusercontent.com/leopu00/job-hunter-team/$sha"
    } catch { Write-Fail "Cannot resolve branch '$Branch' to an immutable release commit." }
  }
  $composeUrl  = "$releaseBase/docker-compose.yml"
  $wrapperUrl  = "$releaseBase/scripts/jht-wrapper.ps1"
  $composeDest = Join-Path $RuntimeDir 'docker-compose.yml'
  $wrapperDest = Join-Path $BinDir 'jht.ps1'
  $shimDest    = Join-Path $BinDir 'jht.cmd'
  $manifestDest = Join-Path $RuntimeDir '.runtime-integrity'

  $runtimeFull = [IO.Path]::GetFullPath($RuntimeDir).TrimEnd('\', '/')
  $legacyFull = [IO.Path]::GetFullPath($JhtHome).TrimEnd('\', '/')
  $userDataHost = if ($env:JHT_USER_DIR_HOST) { $env:JHT_USER_DIR_HOST } else { Join-Path $env:USERPROFILE 'Documents\Job Hunter Team' }
  $userDataFull = [IO.Path]::GetFullPath($userDataHost).TrimEnd('\', '/')
  if ($runtimeFull.Equals($legacyFull, [StringComparison]::OrdinalIgnoreCase) -or $runtimeFull.StartsWith($legacyFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Fail "Host runtime must be outside the container-writable .jht tree: $RuntimeDir"
  }
  if ($runtimeFull.Equals($userDataFull, [StringComparison]::OrdinalIgnoreCase) -or $runtimeFull.StartsWith($userDataFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Fail "Host runtime must be outside the container-writable user data tree: $RuntimeDir"
  }
  $binFull = [IO.Path]::GetFullPath($BinDir).TrimEnd('\', '/')
  if ($binFull.Equals($legacyFull, [StringComparison]::OrdinalIgnoreCase) -or $binFull.StartsWith($legacyFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Fail "Host wrapper must be outside the container-writable .jht tree: $BinDir"
  }
  if ($binFull.Equals($userDataFull, [StringComparison]::OrdinalIgnoreCase) -or $binFull.StartsWith($userDataFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Fail "Host wrapper must be outside the container-writable user data tree: $BinDir"
  }

  Invoke-Action -Description "mkdir $RuntimeDir, $BinDir, $JhtHome" -Block {
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    New-Item -ItemType Directory -Force -Path $BinDir     | Out-Null
    New-Item -ItemType Directory -Force -Path $JhtHome    | Out-Null
    Protect-JhtHomeAcl -Path $JhtHome
  } | Out-Null

  if (-not $DryRun) {
    foreach ($protectedPath in @($RuntimeDir, $BinDir)) {
      $current = Get-Item -LiteralPath $protectedPath -Force -ErrorAction Stop
      while ($current) {
        if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
          Write-Fail "Protected host path has a reparse-point ancestor: $protectedPath"
        }
        $parent = $current.Parent
        if (-not $parent -or $parent.FullName -eq $current.FullName) { break }
        $current = $parent
      }
    }
    $acl = Get-Acl -LiteralPath $RuntimeDir
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule(
      [Security.Principal.WindowsIdentity]::GetCurrent().User,
      'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $RuntimeDir -AclObject $acl
  }

  Write-Info "Downloading docker-compose.yml..."
  $composeTemp = Join-Path $RuntimeDir ('.compose-' + [guid]::NewGuid().ToString('N'))
  Get-File -Url $composeUrl -Dest $composeTemp
  if (-not $DryRun -and -not (Select-String -LiteralPath $composeTemp -Pattern '^\s*-\s*jht-runtime-mask:/jht_home/runtime(?:\s|$)' -Quiet)) {
    Write-Fail 'Downloaded compose does not enforce the protected runtime boundary.'
  }
  if (-not $DryRun) { Move-Item -LiteralPath $composeTemp -Destination $composeDest -Force }
  Write-Ok "compose: $composeDest"

  Write-Info "Downloading jht-wrapper.ps1..."
  $wrapperTemp = Join-Path $BinDir ('.jht-' + [guid]::NewGuid().ToString('N') + '.ps1')
  Get-File -Url $wrapperUrl -Dest $wrapperTemp
  if (-not $DryRun) {
    [scriptblock]::Create((Get-Content -LiteralPath $wrapperTemp -Raw)) | Out-Null
    if (-not (Select-String -LiteralPath $wrapperTemp -SimpleMatch '$JHT_HOST_RUNTIME_PROTOCOL = 1' -Quiet)) {
      Write-Fail 'Downloaded wrapper does not implement the protected runtime protocol.'
    }
    Move-Item -LiteralPath $wrapperTemp -Destination $wrapperDest -Force
  }
  Write-Ok "wrapper: $wrapperDest"

  # CMD shim for people using cmd.exe instead of pwsh. It allows `jht <args>`
  # without the .ps1 extension, bypassing the default Restricted
  # ExecutionPolicy. Falls back to powershell.exe (PS 5.1, ships with Windows)
  # when pwsh (PS 7+) is not installed — feedback master#28, cross-review d87890f8.
  if (-not $DryRun) {
    $composeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $composeDest).Hash.ToLowerInvariant()
    $wrapperHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $wrapperDest).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText(
      $manifestDest,
      "version=1`ndocker-compose.yml=$composeHash`njht-wrapper.ps1=$wrapperHash`n",
      [Text.UTF8Encoding]::new($false))
    $shimContent = @"
@echo off
where pwsh.exe >nul 2>&1
if errorlevel 1 goto jht_windows_powershell
pwsh -NoLogo -ExecutionPolicy Bypass -File "%~dp0jht.ps1" %*
exit /b %errorlevel%
:jht_windows_powershell
powershell -NoLogo -ExecutionPolicy Bypass -File "%~dp0jht.ps1" %*
exit /b %errorlevel%
"@
    Set-Content -Path $shimDest -Value $shimContent -Encoding ASCII
    Write-Ok "CMD shim: $shimDest (pwsh + powershell.exe fallback)"
  } else {
    Write-Dry "Set-Content $shimDest (CMD shim)"
  }
}

# ── Step 4: PATH register ─────────────────────────────────────────────────
function Add-ToUserPath {
  Write-Step 4 $TotalSteps "Registering the user PATH"

  if ($DryRun) {
    Write-Dry "[Environment]::SetEnvironmentVariable('Path', '...;$BinDir', 'User')"
    Write-Dry "Update `$env:Path for the current session"
    $script:PathReady = $true
    return
  }

  # Use the USER-scope PATH (HKCU). System-wide would require elevation;
  # user scope survives multiple logins without a UAC prompt.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }

  $pathEntries = $userPath -split ';' | Where-Object { $_ -and ($_.Trim() -ne '') }
  $normalizedBin = $BinDir.TrimEnd('\')
  $alreadyPresent = $pathEntries | Where-Object { $_.TrimEnd('\') -ieq $normalizedBin }

  if ($alreadyPresent) {
    Write-Ok "$BinDir already in the user PATH"
  } else {
    $newPath = if ($userPath) { "$userPath;$BinDir" } else { $BinDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Ok "User PATH updated (effective from the next terminal)"
  }

  # Also update $env:Path for the current session so the installer's next
  # commands (e.g. the wizard) find `jht.cmd` without reopening a terminal.
  $sessionPath = $env:Path -split ';' | Where-Object { $_.TrimEnd('\') -ieq $normalizedBin }
  if (-not $sessionPath) {
    $env:Path = "$env:Path;$BinDir"
  }

  $script:PathReady = $true
}

# ── Step 5: host.env + pairing token ──────────────────────────────────────
function Write-HostEnv {
  Write-Step 5 $TotalSteps "Writing host.env"

  $hostEnvFile = Join-Path $JhtHome 'host.env'
  $hostType = if ($PairingToken) { 'vps' } else { 'local' }

  # Best-effort timezone detection (Windows TimeZoneInfo → IANA name).
  # When the mapping is unknown we leave UTC and the wizard asks the user.
  $tz = 'UTC'
  try {
    $winTz = [System.TimeZoneInfo]::Local.Id
    # Minimal mapping of the most common Windows time zones. Full list at
    # https://github.com/unicode-org/cldr/blob/main/common/supplemental/windowsZones.xml
    $tzMap = @{
      'W. Europe Standard Time'      = 'Europe/Berlin'
      'Central European Standard Time' = 'Europe/Warsaw'
      'Romance Standard Time'        = 'Europe/Paris'
      'GMT Standard Time'            = 'Europe/London'
      'Eastern Standard Time'        = 'America/New_York'
      'Pacific Standard Time'        = 'America/Los_Angeles'
      'UTC'                          = 'UTC'
    }
    if ($tzMap.ContainsKey($winTz)) { $tz = $tzMap[$winTz] }
  } catch {
    # Silent fallback: $tz stays 'UTC', the wizard will ask.
  }

  $content = @"
# Host env for the JHT wrapper + container. Generated by install.ps1.
JHT_HOST_TYPE=$hostType
JHT_LANG=en
JHT_USER_TZ=$tz
"@

  if ($DryRun) {
    Write-Dry "Set-Content $hostEnvFile (JHT_HOST_TYPE=$hostType, JHT_USER_TZ=$tz)"
  } else {
    Set-Content -Path $hostEnvFile -Value $content -Encoding UTF8
    Write-Ok "host.env written: $hostEnvFile (mode=$hostType, tz=$tz)"
  }

  # Pairing token: saved to $JhtHome\.pairing-token with restrictive perms
  # (Windows ACL: only the USERPROFILE owner reads/writes). The container
  # reads it on first boot via `jht cloud pair`.
  if ($PairingToken) {
    $tokenFile = Join-Path $JhtHome '.pairing-token'
    if ($DryRun) {
      Write-Dry "Set-Content $tokenFile (pairing token, ACL owner-only)"
    } else {
      Set-Content -Path $tokenFile -Value $PairingToken -Encoding ASCII -NoNewline

      # Restrict the ACL to the current user only (drops the inherited
      # Users/Everyone entries). Best-effort: a failure does not block the install.
      try {
        $acl = Get-Acl $tokenFile
        $acl.SetAccessRuleProtection($true, $false)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
          [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
          'FullControl', 'Allow'
        )
        $acl.SetAccessRule($rule)
        Set-Acl -Path $tokenFile -AclObject $acl
      } catch {
        Write-Warn "ACL restriction failed (file still readable by Users): $($_.Exception.Message)"
      }
      Write-Ok "Pairing token saved: $tokenFile"
    }
  }
}

# ── Final message + optional onboarding ───────────────────────────────────
function Show-Final {
  Write-Host ""
  Write-Host "+------------------------------------------+" -ForegroundColor Green
  Write-Host "|  Installation complete!                  |" -ForegroundColor Green
  Write-Host "+------------------------------------------+" -ForegroundColor Green
  Write-Host ""
  Write-Host "  Container mode active." -ForegroundColor White
  Write-Host "  The agents only see:" -ForegroundColor DarkGray
  Write-Host "    $JhtHome                          -> /jht_home (config, db, agents)" -ForegroundColor DarkGray
  Write-Host "    $env:USERPROFILE\Documents\Job Hunter Team -> /jht_user (CVs, attachments, output)" -ForegroundColor DarkGray
  Write-Host ""

  if (-not (Test-WillAutoOnboard)) {
    Write-Host "  Next steps:" -ForegroundColor White
    Write-Host ""
    if ($script:PathReady) {
      Write-Host "      jht setup        # setup wizard (also starts the container)" -ForegroundColor White
    } else {
      Write-Host "      $BinDir\jht.cmd setup" -ForegroundColor White
    }
    Write-Host ""
  }

  Write-Host "  To uninstall (keeps the data in ~/.jht and ~/Documents/Job Hunter Team):" -ForegroundColor DarkGray
  Write-Host "    jht down" -ForegroundColor DarkGray
  Write-Host "    Remove-Item -Recurse -Force '$RuntimeDir', '$BinDir\jht.ps1', '$BinDir\jht.cmd'" -ForegroundColor DarkGray
  Write-Host "    docker rmi $Image" -ForegroundColor DarkGray
  Write-Host "  To delete the data as well (config, db, CVs, output):" -ForegroundColor DarkGray
  Write-Host "    Remove-Item -Recurse -Force '$JhtHome', '$env:USERPROFILE\Documents\Job Hunter Team'" -ForegroundColor DarkGray
  Write-Host ""
}

function Test-WillAutoOnboard {
  if ($DryRun)        { return $false }
  if ($SkipOnboard)   { return $false }
  if ($env:JHT_SKIP_ONBOARD -eq '1') { return $false }
  if ($PairingToken)  { return $false }
  # The interactive wizard needs a host process — when install.ps1 runs via
  # `iwr|iex` inside an interactive pwsh we have a normal host. When it runs
  # from a job/CI with redirection, IsInputRedirected is true.
  if ([Console]::IsInputRedirected) { return $false }
  return $true
}

function Invoke-Onboard {
  if (-not (Test-WillAutoOnboard)) {
    if ($PairingToken) {
      Write-Info "Pairing token present: skipping the interactive wizard. The container will complete the pairing on first boot."
    }
    return
  }
  Write-Host ""
  Write-Info "Launching the setup wizard..."
  # Use the CMD shim, which handles the ExecutionPolicy. PathReady guarantees
  # that `jht.cmd` is reachable in this session.
  & "$BinDir\jht.cmd" setup
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "The wizard exited with an error. Re-run it with: jht setup"
  }
}

# ── Main ──────────────────────────────────────────────────────────────────
Show-Header
Test-System
Test-DockerDesktop
Get-RuntimeFiles
Add-ToUserPath
Write-HostEnv
Show-Final
Invoke-Onboard

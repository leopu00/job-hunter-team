# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Job Hunter Team — Windows-native installer (PowerShell)                 ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Usage: download the file, check its SHA-256, then run it with -File.    ║
# ║  Do not run it straight from the download (no pipe into                  ║
# ║  Invoke-Expression, no compile in memory): in our tests Microsoft        ║
# ║  Defender has blocked that scheme as malicious content (AMSI),           ║
# ║  whatever the script was.                                                ║
# ║    $f = Join-Path $env:TEMP ("jht-install-{0}.ps1" -f [guid]::NewGuid().ToString('N'))
# ║    iwr -useb https://jobhunterteam.ai/install.ps1 -OutFile $f            ║
# ║    $published = (iwr -useb https://raw.githubusercontent.com/leopu00/job-hunter-team/master/desktop/src-tauri/installer-windows.sha256).Content.Trim()
# ║    if ((Get-FileHash $f -Algorithm SHA256).Hash -eq $published) { powershell -NoProfile -ExecutionPolicy Bypass -File $f } else { Remove-Item $f; Write-Error 'SHA-256 does not match: stop, do not run it' }
# ║  -ExecutionPolicy Bypass is the policy of that one process only (Windows ║
# ║  clients refuse scripts by default); it does not touch Defender.         ║
# ║  If the two SHA-256 differ, stop: do not run the file.                   ║
# ║    # Alternative branch, to test dev-N: same file, with -Branch dev-1    ║
# ║    powershell -NoProfile -ExecutionPolicy Bypass -File $f -Branch dev-1  ║
# ║  Default: Podman rootless in a dedicated WSL machine. The desktop        ║
# ║  obtains consent; this script installs the user-scope Podman CLI when    ║
# ║  absent and the runtime's own Compose provider. Docker Desktop is not    ║
# ║  used.                                                                   ║
# ║  Downloads:                                                              ║
# ║    - $env:LOCALAPPDATA\Job Hunter Team\host-runtime\docker-compose.yml   ║
# ║    - $env:USERPROFILE\.local\bin\jht.ps1 (PowerShell wrapper)            ║
# ║    - $env:USERPROFILE\.local\bin\windows-private-acl.ps1 (ACL helper)    ║
# ║    - $env:USERPROFILE\.local\bin\jht.cmd (shim for CMD)                  ║
# ║  The Node CLI, Python, tmux and the agents ALL run inside the long-      ║
# ║  running container managed by compose. No Node/Python/tmux on the host.  ║
# ║  No Docker socket inside the container.                                  ║
# ║  Only two host folders are exposed to the container:                     ║
# ║    $env:USERPROFILE\.jht                  → /jht_home                    ║
# ║    $env:USERPROFILE\Documents\Job Hunter Team → /jht_user                ║
# ║  Differences vs install.sh (Linux/macOS):                                ║
# ║    - NO --no-docker: Windows native (Node+tmux+Claude standalone) is     ║
# ║      not supported. The container is the only path.                      ║
# ║    - NO Docker Desktop. WSL must already be usable; Podman is installed  ║
# ║      silently through winget, docker-compose.exe 5.1.2 is downloaded and ║
# ║      verified into the runtime, never taken from PATH.                   ║
# ║    - PATH registered with [Environment]::SetEnvironmentVariable in the   ║
# ║      User scope (no shell rc). Effective from the next terminal.         ║
# ║  Parameters:                                                             ║
# ║    -DryRun           Show the actions without running them               ║
# ║    -Branch <name>    Source branch (default: production)                 ║
# ║    -PairingToken     Opaque token for VPS pairing (skips the wizard)     ║
# ║    -CloudSync        on|off. With -PairingToken: off (default) pairs     ║
# ║                      the device with the sync paused; on starts it       ║
# ║                      (`jht cloud resume` turns it on later)              ║
# ║    -SkipOnboard      Noninteractive install; do not launch the wizard    ║
# ║    -WindowsSupportNoticeOnly  Read the Windows support warning only      ║
# ║    -SourceSha        Test channel source commit (with next two options)  ║
# ║    -Image            Test channel image reference                        ║
# ║    -ExpectedImageDigest  Expected test image sha256                      ║
# ║    -ExtrasImageDigest    Test channel, optional: sha256 of the image of  ║
# ║                          the tools that come on request. Pinned, not     ║
# ║                          downloaded here: `jht screen on` pulls it.      ║
# ║                                                                          ║
# ║  Design reference: docs/internal/ops/vps.md                              ║
# ╚══════════════════════════════════════════════════════════════════════════╝

[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$Branch = $(if ($env:JHT_BRANCH) { $env:JHT_BRANCH } else { 'production' }),
  [string]$PairingToken = '',
  [ValidateSet('on', 'off')]
  [string]$CloudSync = 'off',
  [switch]$SkipOnboard,
  [switch]$WindowsSupportNoticeOnly,
  [string]$SourceSha = '',
  [string]$Image = '',
  [string]$ExpectedImageDigest = '',
  [string]$ExtrasImageDigest = ''
)

$ErrorActionPreference = 'Stop'
# PSMODULEPATH-BEGIN
# An app started from PowerShell 7 hands its module folders (the 7 ones first) down to the Windows PowerShell 5.1 it starts, and
# 5.1 then cannot load Microsoft.PowerShell.Security (Get-Acl, Get-FileHash): "could not autoload the matching module". The list
# is rebuilt from the folders Windows PowerShell itself uses, before any command that needs a module. PowerShell 7 keeps its own.
if ($PSVersionTable.PSEdition -eq 'Desktop') {
  $jhtModuleFolders = New-Object System.Collections.Generic.List[string]
  $jhtModuleFolders.Add([IO.Path]::Combine([Environment]::GetFolderPath('MyDocuments'), 'WindowsPowerShell', 'Modules'))
  $jhtModuleFolders.Add([IO.Path]::Combine([Environment]::GetFolderPath('ProgramFiles'), 'WindowsPowerShell', 'Modules'))
  $jhtModuleFolders.Add([IO.Path]::Combine($PSHOME, 'Modules'))
  foreach ($jhtScope in 'Machine', 'User') {
    $jhtScoped = [Environment]::GetEnvironmentVariable('PSModulePath', $jhtScope)
    if ($jhtScoped) { $jhtModuleFolders.Add($jhtScoped) }
  }
  $env:PSModulePath = [string]::Join(';', $jhtModuleFolders.ToArray())
}
# PSMODULEPATH-END

# The test channel is one atomic contract. Validate it before environment,
# filesystem, network or process access so malformed build metadata cannot
# leave a half-published runtime.
$channelValues = @($SourceSha, $Image, $ExpectedImageDigest)
$channelPresent = @($channelValues | Where-Object { $_ }).Count
if ($channelPresent -notin @(0, 3) -or
    ($channelPresent -eq 3 -and (
      $SourceSha -notmatch '^[0-9a-f]{40}$' -or
      $Image -notmatch '^ghcr\.io/leopu00/jht(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[0-9a-f]{64})$' -or
      $ExpectedImageDigest -notmatch '^sha256:[0-9a-f]{64}$' -or
      ($Image -match '@(sha256:[0-9a-f]{64})$' -and $Matches[1] -ne $ExpectedImageDigest)
    ))) {
  [Console]::Error.WriteLine('invalid test-channel parameters')
  exit 2
}
$TestChannel = ($channelPresent -eq 3)
# The image of the tools on request belongs to the test channel and has the exact shape of a digest (it becomes an image name and a file).
if ($ExtrasImageDigest -and (-not $TestChannel -or $ExtrasImageDigest -cnotmatch '^sha256:[0-9a-f]{64}\z')) {
  [Console]::Error.WriteLine('invalid test-channel parameters')
  exit 2
}

# ── Config ────────────────────────────────────────────────────────────────
$LocalAppData = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [Environment]::GetFolderPath('LocalApplicationData') }
if (-not $LocalAppData) { throw 'LOCALAPPDATA is unavailable: refusing an unprotected runtime fallback' }
$RuntimeDir = if ($env:JHT_RUNTIME_DIR) { $env:JHT_RUNTIME_DIR } else { Join-Path $LocalAppData 'Job Hunter Team\host-runtime' }
$BinDir     = if ($env:JHT_BIN_DIR)     { $env:JHT_BIN_DIR }     else { Join-Path $env:USERPROFILE '.local\bin' }
$ShimBin    = Join-Path $BinDir 'shim'
# The PATH of the window that launched the installer, before any step adds to it (Show-Final reads it).
$script:JhtStartPath = $env:Path
$JhtHome    = Join-Path $env:USERPROFILE '.jht'
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
      if ($existing.AccessControlType -eq 'Allow' -and $existing.IdentityReference.Value -ne $owner -and $existing.IdentityReference.Value -notin @('NT AUTHORITY\SYSTEM','BUILTIN\Administrators')) { [void]$acl.RemoveAccessRule($existing) }
    }
    $inherit = if ($node.PSIsContainer) { 'ContainerInherit,ObjectInherit' } else { 'None' }
    $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($owner, 'FullControl', $inherit, 'None', 'Allow')))
    Set-JhtAccessControl -Path $node.FullName -Acl $acl
  }
  if (-not (Get-Acl -LiteralPath $Path).AreAccessRulesProtected) { throw "ACL inheritance remains enabled: $Path" }
}
function Set-JhtNodeOwner {
  param([Parameter(Mandatory)][string]$Path)
  $ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = Get-Acl -LiteralPath $Path -ErrorAction Stop
  $acl.SetOwner($ownerSid)
  Set-JhtAccessControl -Path $Path -Acl $acl
  $actualOwner = (Get-Acl -LiteralPath $Path -ErrorAction Stop).Owner
  $actualSid = ([Security.Principal.NTAccount]$actualOwner).Translate([Security.Principal.SecurityIdentifier])
  if ($actualSid.Value -ne $ownerSid.Value) { throw "Owner is not the current user: $Path" }
}
$TestChannelImage = $Image
$Image = if ($env:JHT_IMAGE) { $env:JHT_IMAGE } else { 'ghcr.io/leopu00/jht@sha256:99ff0d4d5dda8c41f43db41c98e7e27d7e15cb03dcc84e18904333f6566a3355' }
$CoreImageDigest = if ($env:JHT_CORE_IMAGE_DIGEST) { $env:JHT_CORE_IMAGE_DIGEST } else { 'sha256:af6288d3b017f2526ca9bb0a368e962a8ca0d8c3be7bae6fb06688b10f1335fd' }
# It becomes an image name, a file and a hash: only the exact shape of a digest goes through, whatever the environment says.
if ($CoreImageDigest -and $CoreImageDigest -cnotmatch '^sha256:[0-9a-f]{64}\z') { throw 'JHT_CORE_IMAGE_DIGEST is not a sha256 digest' }
$RuntimeTier = if ($CoreImageDigest -and -not $env:JHT_IMAGE -and -not $TestChannel) { 'core' } else { '' }  # core: the tools come later
if ($RuntimeTier) { $Image = "ghcr.io/leopu00/jht@$CoreImageDigest" }
$RuntimeImage = if ($TestChannel) { $TestChannelImage } else { $Image }
$RuntimeImageDigest = if ($TestChannel) { $ExpectedImageDigest } elseif ($RuntimeImage -match '@(sha256:[0-9a-f]{64})$') { $Matches[1] } else { '' }
$env:JHT_IMAGE = $Image
if ($TestChannel) { $env:JHT_IMAGE = $RuntimeImage }
$RawBaseOverride = if ($env:JHT_RAW_BASE) { $env:JHT_RAW_BASE.TrimEnd('/') } else { '' }

$TotalSteps = 5

# ── UI helpers ────────────────────────────────────────────────────────────
function Write-Ok   { param([string]$Msg) Write-Host "  $([char]0x2713) $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "  ! $Msg" -ForegroundColor Yellow }
function Write-Info { param([string]$Msg) Write-Host "  > $Msg" -ForegroundColor Cyan }
# An error says what went wrong in red and, under it, what to do now in yellow:
# a person at a terminal needs the next step, not only the cause.
function Write-JhtProblem {
  param([Parameter(Mandatory)][string]$What, [string[]]$Todo = @())
  Write-Host ""
  Write-Host "  x $What" -ForegroundColor Red
  if ($Todo.Count -gt 0) {
    Write-Host ""
    Write-Host "  $(Ts 'installer.windows.what_do_now' 'What to do now:')" -ForegroundColor Yellow
    foreach ($line in $Todo) { Write-Host "    $line" -ForegroundColor Yellow }
  }
  Write-Host ""
}
# The folders this run created and a failure leaves empty: removed again, with a
# delete that refuses a folder holding anything (nothing recursive, nothing
# that was already there).
$script:JhtCreatedDirs = @()
function Remove-JhtCreatedEmptyDirs {
  foreach ($dir in @($script:JhtCreatedDirs | Sort-Object { $_.Length } -Descending)) {
    try { [IO.Directory]::Delete($dir) } catch { }
  }
  $script:JhtCreatedDirs = @()
}
function Write-Fail {
  param([string]$Msg, [string[]]$Todo = @())
  if ($Todo.Count -gt 0) { Write-JhtProblem -What $Msg -Todo $Todo } else { Write-Host "  x $Msg" -ForegroundColor Red }
  Remove-JhtCreatedEmptyDirs
  exit 1
}
function Write-Step { param([int]$N, [int]$Total, [string]$Title) Write-Host ""; Write-Host "[$N/$Total] $Title" -ForegroundColor White }
function Write-Dry  { param([string]$Cmd) Write-Host "  [dry-run] would execute: $Cmd" -ForegroundColor DarkGray }
# The JHT_PHASE lines are for the desktop app, which reads this script's output
# through a pipe; at a terminal they are noise. JHT_MACHINE_OUTPUT=1 asks for
# them anyway, =0 never; unset, they follow whether the output is redirected.
function Write-JhtPhase {
  param([Parameter(Mandatory)][ValidateSet(
    'wsl_check', 'podman_install', 'podman_machine_init',
    'podman_machine_start', 'runtime_download', 'image_pull'
  )][string]$Id)
  # JHT_MACHINE_OUTPUT=1 asks for the line, =0 refuses it; unset, it follows whether the output is redirected.
  $machine = if ($env:JHT_MACHINE_OUTPUT -eq '1') { $true } elseif ($env:JHT_MACHINE_OUTPUT -eq '0') { $false } else { [Console]::IsOutputRedirected }
  if ($machine) { [Console]::Out.WriteLine("JHT_PHASE $Id"); if ($env:JHT_PHASE_TIMES -eq '1') { [Console]::Out.WriteLine("JHT_TIME $([DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')) $Id") } }
}
# A notice the desktop keeps on screen for the whole setup (a phase is replaced
# by the next one). The install goes on after it.
function Write-JhtNotice {
  param([Parameter(Mandatory)][ValidateSet('windows10_unsupported')][string]$Id)
  # Like JHT_PHASE, for the app only: a person at a terminal has the sentence Write-Warn gave just before.
  $machine = if ($env:JHT_MACHINE_OUTPUT -eq '1') { $true } elseif ($env:JHT_MACHINE_OUTPUT -eq '0') { $false } else { [Console]::IsOutputRedirected }
  if ($machine) { [Console]::Out.WriteLine("JHT_NOTICE $Id") }
}


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
  Write-Host "  $(Ts 'installer.windows.mode_podman_machine_wsl' 'mode:    Podman machine (WSL)')" -ForegroundColor DarkGray
  Write-Host "  $(Ts 'installer.windows.image' 'image:  ') $RuntimeImage" -ForegroundColor DarkGray
  # A test-channel install is one commit, not a branch: the banner says the commit that was asked for (the Linux installer
  # does the same). Plain syntax only: this runs in Windows PowerShell 5.1.
  if ($SourceSha) {
    Write-Host "  commit:  $SourceSha" -ForegroundColor DarkGray
  } else {
    Write-Host "  $(Ts 'installer.windows.branch' 'branch: ') $Branch" -ForegroundColor DarkGray
  }
  Write-Host "  runtime: $RuntimeDir" -ForegroundColor DarkGray
  Write-Host "  bin:     $BinDir" -ForegroundColor DarkGray
  if ($DryRun)       { Write-Host "  dry-run: ON (no changes to the system)" -ForegroundColor Yellow }
  if ($PairingToken) { Write-Host "  $(Ts 'installer.windows.header_pairing' 'pairing: token present (skips the wizard)')" -ForegroundColor Yellow }
  Write-Host ""
}

# ── Step 1: System detection ──────────────────────────────────────────────
function Test-System {
  Write-Step 1 $TotalSteps (Ts 'installer.windows.system_detection' 'System detection')
  $os = [System.Environment]::OSVersion
  if ($os.Platform -ne 'Win32NT') {
    Write-Fail (Ts 'installer.windows.only_windows' 'install.ps1 only supports Windows. On Linux/macOS use install.sh.')
  }
  $psVersion = $PSVersionTable.PSVersion
  if ($psVersion.Major -lt 5) {
    Write-Fail (Tsf 'installer.windows.powershell_too_old' 'PowerShell 5.1+ required (current version: %s). Install PowerShell 7: https://aka.ms/PowerShell' $psVersion)
  }
  Write-Ok "Windows $($os.Version) / PowerShell $psVersion"
  Show-WindowsSupportNotice
}

# Windows 11 is the supported system: Podman 6 removed Windows 10 support.
# Windows 10 still installs, with a warning and no block. The product type is
# read before the build, because Windows Server 2019 and 2022 also have builds
# under 22000 and are not Windows 10. ProductType: 1 workstation, 2 domain
# controller, 3 server. Windows 10 builds run from 10240 to 19045.
function Get-JhtWindowsEdition {
  try {
    # A WMI that does not answer must not hold the setup: after 10 s the read fails
    # like any other, and the setup goes on without the notice.
    $os = Get-CimInstance -ClassName Win32_OperatingSystem -OperationTimeoutSec 10 -ErrorAction Stop
    return @{ ProductType = [int]$os.ProductType; Build = [int]$os.BuildNumber }
  } catch {
    return $null
  }
}
function Test-JhtWindows10Client {
  param([int]$ProductType, [int]$Build)
  return ($ProductType -eq 1 -and $Build -ge 10240 -and $Build -lt 22000)
}
# The language of the person, by the rule of the CLI and of the wrapper: the choice saved by the setup or the picker
# (i18n-prefs.json, read as data: not a link, a small file, one of the seven codes), then JHT_LANG as set in this terminal,
# then the one in host.env (an earlier install), then the language of Windows, then English. The sentences of this script are said
# in that language, in all seven (Ts/Tsf, from the block below); the Windows 10 notice has its own seven. It is also the language
# written in host.env (Get-JhtPersonLanguage).
# A value of the host.env an earlier install wrote, read as data (not a link, a small file, only a valid value): an update keeps
# the language, the host type and the time zone saved there. $null when there is none.
function Get-JhtSavedHostEnvValue {
  param([string]$Name)
  try {
    $file = Join-Path $JhtHome 'host.env'
    $item = Get-Item -LiteralPath $file -Force -ErrorAction Stop
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $item.Length -gt 4096) { return $null }
    $value = $null
    foreach ($line in [IO.File]::ReadAllLines($file)) {
      if ($line -match "^\s*$Name=(.*)$") { $value = $Matches[1].Trim().Trim('"').Trim("'") }
    }
    switch ($Name) {
      'JHT_LANG'      { if ($value -cmatch '^(en|it|hu|es|de|fr|pt)\z') { return $value } }
      'JHT_HOST_TYPE' { if ($value -ceq 'local' -or $value -ceq 'vps') { return $value } }
      'JHT_USER_TZ'   { if ($value -cmatch '^[A-Za-z0-9_+./-]{1,64}\z' -and $value -notmatch '\.\.') { return $value } }
    }
  } catch { }
  return $null
}
function Get-JhtTextLanguage {
  $known = @('en', 'it', 'de', 'fr', 'es', 'hu', 'pt')
  try {
    $prefs = Join-Path $JhtHome 'i18n-prefs.json'
    $item = Get-Item -LiteralPath $prefs -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $item.Length -le 4096) {
      # a saved choice of a language the product does not have reads English, not the language of Windows
      $match = [regex]::Match(([IO.File]::ReadAllText($prefs) -replace '[\r\n]', ''), '"locale"\s*:\s*"([^"]{1,20})"')
      if ($match.Success) {
        if ($known -ccontains $match.Groups[1].Value) { return $match.Groups[1].Value }
        return 'en'
      }
    }
  } catch { }
  $asked = ([string]$env:JHT_LANG).ToLowerInvariant() -replace '[-_.@].*$', ''
  if ($known -contains $asked) { return $asked }
  if ($asked) { return 'en' }   # asked for a language the product does not have
  # host.env of an earlier install, read here as Get-JhtSavedHostEnvValue does (this function is also used on its own)
  try {
    $hostEnv = Join-Path $JhtHome 'host.env'
    $item = Get-Item -LiteralPath $hostEnv -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $item.Length -le 4096) {
      $saved = $null
      foreach ($line in [IO.File]::ReadAllLines($hostEnv)) { if ($line -match '^\s*JHT_LANG=(.*)$') { $saved = $Matches[1].Trim() } }
      if ($known -ccontains $saved) { return $saved }
    }
  } catch { }
  try {
    $windows = ([string][Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName).ToLowerInvariant()
    if ($known -contains $windows) { return $windows }
  } catch { }
  return 'en'
}
# Ts '<key>' '<English>': the sentence in the person's language, in the 7 languages of shared/locales. The installer runs before
# anything of JHT is on the computer, so the texts are written inside it, in the block below, made from the catalogs by
# `python3 tests/installer_ps1_texts.py --write` (a test fails when the two differ), in ASCII ([char]0x.... for every other
# letter): Windows PowerShell 5.1 reads this file in the legacy console encoding. A key a language lacks says the English of the call.
function Ts {
  param([string]$Key, [string]$English)
  $text = Get-InstallerTextTable (Get-JhtTextLanguage) $Key
  if ($null -eq $text) { return $English }
  return $text
}
# Tsf '<key>' '<English with %s/%d>' values...: the same, with the values put in for %s/%d in order (never -f: the catalog is the
# one of the bash installer too, and a { in a text breaks nothing).
function Tsf {
  param([string]$Key, [string]$English, [Parameter(ValueFromRemainingArguments = $true)][object[]]$Values)
  $text = Ts $Key $English
  $out = New-Object System.Text.StringBuilder
  $at = 0
  $next = 0
  foreach ($match in [regex]::Matches($text, '%[sd]')) {
    [void]$out.Append($text.Substring($at, $match.Index - $at))
    if ($null -ne $Values -and $next -lt $Values.Count) { [void]$out.Append([string]$Values[$next]) }
    $next++
    $at = $match.Index + $match.Length
  }
  [void]$out.Append($text.Substring($at))
  return $out.ToString()
}

# >>> texts in the 7 languages, made from shared/locales by `python3 tests/installer_ps1_texts.py --write`: do not edit by hand
function Get-InstallerTextTable {
  param([string]$Lang, [string]$Key)
  switch -CaseSensitive ("$Lang`:$Key") {
    'en:installer.check.compose_boundary' { return 'Downloaded compose does not enforce the protected runtime boundary.' }
    'en:installer.windows.acl_failed' { return 'JHT_HOME ACL verification failed after repair: %s' }
    'en:installer.windows.agents_only_see' { return 'The agents only see:' }
    'en:installer.windows.already_user_path' { return 'already in the user PATH' }
    'en:installer.windows.branch' { return 'branch: ' }
    'en:installer.windows.branch_unresolved' { return 'Cannot resolve branch ''%s'' to an immutable release commit.' }
    'en:installer.windows.check_connection_branch' { return 'Check your connection and branch (%s).' }
    'en:installer.windows.config_db_agents' { return '(config, db, agents)' }
    'en:installer.windows.container_mode_active' { return 'Container mode active.' }
    'en:installer.windows.cvs_attachments_output' { return '(CVs, attachments, output)' }
    'en:installer.windows.delete_data_as_well' { return 'To delete the data as well (config, db, CVs, output):' }
    'en:installer.windows.docker_desktop_volumes_old' { return 'In Docker Desktop the volumes of the old team stay: provider tools and, by the version, the API key kept by the setup, the mail password and the Telegram tokens. The new team does not read them: give those again with jht setup. If you do not need them any more:' }
    'en:installer.windows.download_failed' { return 'Download failed: %s' }
    'en:installer.windows.downloading_enabling_podman_runtime' { return 'Downloading and enabling the Podman runtime' }
    'en:installer.windows.earlier_job_hunter_team' { return 'an earlier Job Hunter Team is still running on Docker Desktop (container %s). Since 0.4 the team runs in a Podman machine: installed next to it, two teams would work on the same data. Nothing was changed.' }
    'en:installer.windows.earlier_job_hunter_team_2' { return 'an earlier Job Hunter Team is still installed on Docker Desktop (container %s, stopped; it starts again with Docker Desktop). Since 0.4 the team runs in a Podman machine: installed next to it, two teams would work on the same data. Nothing was changed.' }
    'en:installer.windows.header_pairing' { return 'pairing: token present (skips the wizard)' }
    'en:installer.windows.host_env_written' { return 'host.env written:' }
    'en:installer.windows.image' { return 'image:  ' }
    'en:installer.windows.image_free_disk' { return 'And its image, to free the disk:' }
    'en:installer.windows.install_may_not_know' { return 'install and may not know them yet ("not recognized as the name of a cmdlet").' }
    'en:installer.windows.installation_complete' { return '|  Installation complete!                  |' }
    'en:installer.windows.jht_podman_are_your' { return 'jht and podman are on your PATH from now on, but THIS PowerShell window was open before the' }
    'en:installer.windows.launching_setup_wizard' { return 'Launching the setup wizard...' }
    'en:installer.windows.mode_podman_machine_wsl' { return 'mode:    Podman machine (WSL)' }
    'en:installer.windows.next_steps' { return 'Next steps:' }
    'en:installer.windows.only_windows' { return 'install.ps1 only supports Windows. On Linux/macOS use install.sh.' }
    'en:installer.windows.open_new_powershell_window' { return 'Open a NEW PowerShell window to use jht and podman. No restart of the computer is needed.' }
    'en:installer.windows.override_lacks_keep_id' { return 'Downloaded Podman override lacks keep-id.' }
    'en:installer.windows.pairing_token_present_skipping' { return 'Pairing token present: skipping the interactive wizard. The container will complete the pairing on first boot.' }
    'en:installer.windows.pairing_token_saved' { return 'Pairing token saved:' }
    'en:installer.windows.podman.check_wsl' { return 'The line above says why. Check that WSL works: run "wsl --status" in PowerShell.' }
    'en:installer.windows.podman.from_desktop' { return 'The line above says why. Run the installer from the Windows desktop of this user (the Start menu, Windows PowerShell), not from ssh, a service or a scheduled task: those run without a desktop.' }
    'en:installer.windows.podman.install_failed' { return 'Podman could not be installed.' }
    'en:installer.windows.podman.install_failed_todo' { return 'The line above says why. Podman comes from winget, or from its official release when winget cannot be used: check that this computer can reach github.com, and that winget works if you have it (for a broken one, install or repair "App Installer": https://aka.ms/getwinget).' }
    'en:installer.windows.podman.machine_failed' { return 'The Podman machine of Job Hunter Team could not be created or started.' }
    'en:installer.windows.podman.network_not_ready' { return 'The Podman machine started but its network is not ready.' }
    'en:installer.windows.podman.network_todo' { return 'The line above says why. Wait a minute and run the same install command again; if it stops here again, restart Windows first.' }
    'en:installer.windows.podman.other_user' { return 'Podman is installed for another Windows user of this computer.' }
    'en:installer.windows.podman.other_user_todo' { return 'Run the installer as that Windows user, or remove Podman for the computer (Settings > Apps) and run the install command again.' }
    'en:installer.windows.podman.other_version' { return 'Another Podman version is installed on this computer.' }
    'en:installer.windows.podman.restart_pending' { return 'If a restart of Windows is pending, restart it.' }
    'en:installer.windows.podman.restart_then_again' { return 'Only if it stops here again from the desktop: restart Windows, then run it once more.' }
    'en:installer.windows.podman.run_again' { return 'Then run the same install command again: it starts over from the beginning.' }
    'en:installer.windows.podman.runs_on_6' { return 'Job Hunter Team runs on Podman 6 and does not change another Podman.' }
    'en:installer.windows.podman.sshproxy' { return 'Podman started the machine, but its connection for Docker tools (win-sshproxy.exe) did not start.' }
    'en:installer.windows.podman.stopped' { return 'The Podman setup stopped (exit code %s).' }
    'en:installer.windows.podman.stopped_todo' { return 'The line above says why. Run the same install command again; if it stops at the same place, keep that line and ask for help.' }
    'en:installer.windows.podman.update_or_remove' { return 'Update it to version 6, or remove it (Settings > Apps), whichever you prefer.' }
    'en:installer.windows.podman_machine_windows_user' { return 'Podman machine of this Windows user:' }
    'en:installer.windows.powershell_too_old' { return 'PowerShell 5.1+ required (current version: %s). Install PowerShell 7: https://aka.ms/PowerShell' }
    'en:installer.windows.registering_user_path' { return 'Registering the user PATH' }
    'en:installer.windows.reparse_ancestor' { return 'Protected host path has a reparse-point ancestor: %s' }
    'en:installer.windows.runtime_artifact_missing' { return 'Podman runtime artifact missing: %s' }
    'en:installer.windows.runtime_overlaps' { return 'Protected host runtime path overlaps a container-writable tree: %s' }
    'en:installer.windows.setup_wizard_also_starts' { return 'setup wizard (also starts the container)' }
    'en:installer.windows.stop_remove_old_team' { return 'Stop and remove the old team (Docker Desktop on), in PowerShell:' }
    'en:installer.windows.system_detection' { return 'System detection' }
    'en:installer.windows.then_run_installer_again' { return 'Then run this installer again.' }
    'en:installer.windows.token_acl_failed' { return 'ACL restriction failed (file still readable by Users): %s' }
    'en:installer.windows.uninstall_keeps_data_jht' { return 'To uninstall (keeps the data in ~/.jht and ~/Documents/Job Hunter Team):' }
    'en:installer.windows.user_path_updated_effective' { return 'User PATH updated (effective from the next terminal)' }
    'en:installer.windows.what_do_now' { return 'What to do now:' }
    'en:installer.windows.windows_subsystem_linux_check' { return 'Windows Subsystem for Linux check' }
    'en:installer.windows.wizard_exited_error_re' { return 'The wizard exited with an error. Re-run it with: jht setup' }
    'en:installer.windows.wrapper_lacks_protocol' { return 'Downloaded wrapper lacks the protected runtime protocol.' }
    'en:installer.windows.wrapper_overlaps' { return 'Protected host wrapper path overlaps a container-writable tree: %s' }
    'en:installer.windows.writing_host_env' { return 'Writing host.env' }
    'en:installer.windows.wsl_ready' { return 'WSL is ready' }
    'en:installer.windows.your_data_stays_jht' { return 'Your data stays: ~/.jht (configuration, database, profile) and Documents\Job Hunter Team (CVs, outputs) are folders of this computer, and the new team uses them.' }
    'it:installer.check.compose_boundary' { return 'Il docker-compose.yml scaricato non applica il confine protetto del runtime.' }
    'it:installer.windows.acl_failed' { return 'La verifica dei permessi (ACL) di JHT_HOME non e'' riuscita dopo la riparazione: %s' }
    'it:installer.windows.agents_only_see' { return 'Gli agenti vedono solo:' }
    'it:installer.windows.already_user_path' { return 'e'' gia'' nel PATH dell''utente' }
    'it:installer.windows.branch' { return 'ramo:    ' }
    'it:installer.windows.branch_unresolved' { return 'Non riesco a ricondurre il ramo ''%s'' a un commit di rilascio immutabile.' }
    'it:installer.windows.check_connection_branch' { return 'Controlla la connessione e il ramo (%s).' }
    'it:installer.windows.config_db_agents' { return '(configurazione, db, agenti)' }
    'it:installer.windows.container_mode_active' { return 'Modalita'' container attiva.' }
    'it:installer.windows.cvs_attachments_output' { return '(CV, allegati, risultati)' }
    'it:installer.windows.delete_data_as_well' { return 'Per cancellare anche i dati (configurazione, db, CV, risultati):' }
    'it:installer.windows.docker_desktop_volumes_old' { return 'In Docker Desktop restano i volumi del team vecchio: strumenti dei provider e, secondo la versione, la chiave API salvata dal setup, la password della posta e i token di Telegram. Il nuovo team non li legge: quelli vanno ridati con jht setup. Se non ti servono piu'':' }
    'it:installer.windows.download_failed' { return 'Download non riuscito: %s' }
    'it:installer.windows.downloading_enabling_podman_runtime' { return 'Scarico e attivo il runtime Podman' }
    'it:installer.windows.earlier_job_hunter_team' { return 'su Docker Desktop gira ancora una versione precedente di Job Hunter Team (container %s). Dalla 0.4 il team gira in una macchina Podman: installata accanto, ci sarebbero due team sugli stessi dati. Non e'' stato cambiato niente.' }
    'it:installer.windows.earlier_job_hunter_team_2' { return 'su Docker Desktop c''e'' ancora una versione precedente di Job Hunter Team (container %s, fermo; ripartirebbe con Docker Desktop). Dalla 0.4 il team gira in una macchina Podman: installata accanto, ci sarebbero due team sugli stessi dati. Non e'' stato cambiato niente.' }
    'it:installer.windows.header_pairing' { return 'abbinamento: token presente (salta la configurazione guidata)' }
    'it:installer.windows.host_env_written' { return 'host.env scritto:' }
    'it:installer.windows.image' { return 'immagine:' }
    'it:installer.windows.image_free_disk' { return 'E la sua immagine, per liberare il disco:' }
    'it:installer.windows.install_may_not_know' { return 'installazione e potrebbe non conoscerli ancora ("non riconosciuto come nome di cmdlet").' }
    'it:installer.windows.installation_complete' { return '|  Installazione completata!               |' }
    'it:installer.windows.jht_podman_are_your' { return 'da adesso jht e podman sono nel PATH, ma QUESTA finestra di PowerShell era aperta prima dell''' }
    'it:installer.windows.launching_setup_wizard' { return 'Avvio la configurazione guidata...' }
    'it:installer.windows.mode_podman_machine_wsl' { return 'modo:     macchina Podman (WSL)' }
    'it:installer.windows.next_steps' { return 'Prossimi passi:' }
    'it:installer.windows.only_windows' { return 'install.ps1 funziona solo su Windows. Su Linux/macOS usa install.sh.' }
    'it:installer.windows.open_new_powershell_window' { return 'Apri una NUOVA finestra di PowerShell per usare jht e podman. Non serve riavviare il computer.' }
    'it:installer.windows.override_lacks_keep_id' { return 'Il file di Podman scaricato (docker-compose.podman.yml) non ha keep-id.' }
    'it:installer.windows.pairing_token_present_skipping' { return 'Token di abbinamento presente: salto il wizard interattivo. Il container completera'' l''abbinamento al primo avvio.' }
    'it:installer.windows.pairing_token_saved' { return 'Token di abbinamento salvato:' }
    'it:installer.windows.podman.check_wsl' { return 'La riga sopra dice perche''. Controlla che WSL funzioni: lancia "wsl --status" in PowerShell.' }
    'it:installer.windows.podman.from_desktop' { return 'La riga sopra dice perche''. Lancia l''installer dal desktop di Windows di questo utente (il menu Start, Windows PowerShell), non da ssh, da un servizio o da un''attivita'' pianificata: quelli girano senza desktop.' }
    'it:installer.windows.podman.install_failed' { return 'Podman non si e'' potuto installare.' }
    'it:installer.windows.podman.install_failed_todo' { return 'La riga sopra dice perche''. Podman arriva da winget, o dalla sua release ufficiale quando winget non si puo'' usare: controlla che questo computer raggiunga github.com, e che winget funzioni se ce l''hai (se e'' rotto, installa o ripara "App Installer": https://aka.ms/getwinget).' }
    'it:installer.windows.podman.machine_failed' { return 'La macchina Podman di Job Hunter Team non si e'' potuta creare o avviare.' }
    'it:installer.windows.podman.network_not_ready' { return 'La macchina Podman e'' partita ma la sua rete non e'' pronta.' }
    'it:installer.windows.podman.network_todo' { return 'La riga sopra dice perche''. Aspetta un minuto e rilancia lo stesso comando di installazione; se si ferma di nuovo qui, prima riavvia Windows.' }
    'it:installer.windows.podman.other_user' { return 'Podman e'' installato per un altro utente Windows di questo computer.' }
    'it:installer.windows.podman.other_user_todo' { return 'Lancia l''installer come quell''utente Windows, o togli Podman per il computer (Impostazioni > App) e rilancia il comando di installazione.' }
    'it:installer.windows.podman.other_version' { return 'Su questo computer e'' installata un''altra versione di Podman.' }
    'it:installer.windows.podman.restart_pending' { return 'Se Windows aspetta un riavvio, riavvialo.' }
    'it:installer.windows.podman.restart_then_again' { return 'Solo se si ferma di nuovo qui dal desktop: riavvia Windows, poi lancialo ancora una volta.' }
    'it:installer.windows.podman.run_again' { return 'Poi rilancia lo stesso comando di installazione: riparte dall''inizio.' }
    'it:installer.windows.podman.runs_on_6' { return 'Job Hunter Team gira su Podman 6 e non cambia un altro Podman.' }
    'it:installer.windows.podman.sshproxy' { return 'Podman ha avviato la macchina, ma il suo collegamento per gli strumenti Docker (win-sshproxy.exe) non e'' partito.' }
    'it:installer.windows.podman.stopped' { return 'La preparazione di Podman si e'' fermata (codice di uscita %s).' }
    'it:installer.windows.podman.stopped_todo' { return 'La riga sopra dice perche''. Rilancia lo stesso comando di installazione; se si ferma nello stesso punto, tieni quella riga e chiedi aiuto.' }
    'it:installer.windows.podman.update_or_remove' { return 'Aggiornalo alla versione 6, o toglilo (Impostazioni > App), come preferisci.' }
    'it:installer.windows.podman_machine_windows_user' { return 'Macchina Podman di questo utente Windows:' }
    'it:installer.windows.powershell_too_old' { return 'Serve PowerShell 5.1 o successivo (versione attuale: %s). Installa PowerShell 7: https://aka.ms/PowerShell' }
    'it:installer.windows.registering_user_path' { return 'Registro il PATH dell''utente' }
    'it:installer.windows.reparse_ancestor' { return 'Un percorso protetto dell''host ha sopra di se'' un reparse point (un collegamento): %s' }
    'it:installer.windows.runtime_artifact_missing' { return 'Manca un file del runtime Podman: %s' }
    'it:installer.windows.runtime_overlaps' { return 'La cartella protetta del runtime sull''host si sovrappone a una cartella che il container puo'' scrivere: %s' }
    'it:installer.windows.setup_wizard_also_starts' { return 'configurazione guidata (accende anche il container)' }
    'it:installer.windows.stop_remove_old_team' { return 'Ferma e togli il team vecchio (con Docker Desktop acceso), in PowerShell:' }
    'it:installer.windows.system_detection' { return 'Rilevamento del sistema' }
    'it:installer.windows.then_run_installer_again' { return 'Poi rilancia questo installer.' }
    'it:installer.windows.token_acl_failed' { return 'La restrizione dei permessi (ACL) non e'' riuscita (il file e'' ancora leggibile dal gruppo Users): %s' }
    'it:installer.windows.uninstall_keeps_data_jht' { return 'Per disinstallare (i dati in ~/.jht e ~/Documents/Job Hunter Team restano):' }
    'it:installer.windows.user_path_updated_effective' { return 'PATH dell''utente aggiornato (vale dal prossimo terminale)' }
    'it:installer.windows.what_do_now' { return 'Cosa fare adesso:' }
    'it:installer.windows.windows_subsystem_linux_check' { return 'Controllo del Sottosistema Windows per Linux' }
    'it:installer.windows.wizard_exited_error_re' { return 'La configurazione guidata e'' uscita con un errore. Rilanciala con: jht setup' }
    'it:installer.windows.wrapper_lacks_protocol' { return 'Il wrapper scaricato non ha il protocollo protetto del runtime.' }
    'it:installer.windows.wrapper_overlaps' { return 'La cartella protetta del wrapper sull''host si sovrappone a una cartella che il container puo'' scrivere: %s' }
    'it:installer.windows.writing_host_env' { return 'Scrivo host.env' }
    'it:installer.windows.wsl_ready' { return 'WSL e'' pronto' }
    'it:installer.windows.your_data_stays_jht' { return 'I tuoi dati restano: ~/.jht (configurazione, database, profilo) e Documenti\Job Hunter Team (CV, risultati) sono cartelle di questo computer, e il nuovo team le usa.' }
    'hu:installer.check.compose_boundary' { return ('A let' + [char]0x00F6 + 'lt' + [char]0x00F6 + 'tt docker-compose.yml nem ' + [char]0x00E9 + 'rv' + [char]0x00E9 + 'nyes' + [char]0x00ED + 'ti a runtime v' + [char]0x00E9 + 'dett hat' + [char]0x00E1 + 'r' + [char]0x00E1 + 't.') }
    'hu:installer.windows.acl_failed' { return ('A JHT_HOME ACL-ellen' + [char]0x0151 + 'rz' + [char]0x00E9 + 'se a jav' + [char]0x00ED + 't' + [char]0x00E1 + 's ut' + [char]0x00E1 + 'n sem siker' + [char]0x00FC + 'lt: %s') }
    'hu:installer.windows.agents_only_see' { return ('Az ' + [char]0x00FC + 'gyn' + [char]0x00F6 + 'k' + [char]0x00F6 + 'k csak ezt l' + [char]0x00E1 + 'tj' + [char]0x00E1 + 'k:') }
    'hu:installer.windows.already_user_path' { return ('m' + [char]0x00E1 + 'r benne van a felhaszn' + [char]0x00E1 + 'l' + [char]0x00F3 + 'i PATH-ban') }
    'hu:installer.windows.branch' { return ('' + [char]0x00E1 + 'g:  ') }
    'hu:installer.windows.branch_unresolved' { return ('A(z) ''%s'' ' + [char]0x00E1 + 'g nem vezethet' + [char]0x0151 + ' vissza egy megv' + [char]0x00E1 + 'ltoztathatatlan kiad' + [char]0x00E1 + 'si commitra.') }
    'hu:installer.windows.check_connection_branch' { return ('Ellen' + [char]0x0151 + 'rizd a kapcsolatot ' + [char]0x00E9 + 's az ' + [char]0x00E1 + 'gat (%s).') }
    'hu:installer.windows.config_db_agents' { return ('(be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 's, adatb' + [char]0x00E1 + 'zis, ' + [char]0x00FC + 'gyn' + [char]0x00F6 + 'k' + [char]0x00F6 + 'k)') }
    'hu:installer.windows.container_mode_active' { return ('Kont' + [char]0x00E9 + 'neres m' + [char]0x00F3 + 'd bekapcsolva.') }
    'hu:installer.windows.cvs_attachments_output' { return ('(' + [char]0x00F6 + 'n' + [char]0x00E9 + 'letrajzok, mell' + [char]0x00E9 + 'kletek, eredm' + [char]0x00E9 + 'nyek)') }
    'hu:installer.windows.delete_data_as_well' { return ('Ha az adatokat is t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lni akarod (be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 's, adatb' + [char]0x00E1 + 'zis, ' + [char]0x00F6 + 'n' + [char]0x00E9 + 'letrajzok, eredm' + [char]0x00E9 + 'nyek):') }
    'hu:installer.windows.docker_desktop_volumes_old' { return ('A Docker Desktopban megmaradnak a r' + [char]0x00E9 + 'gi csapat k' + [char]0x00F6 + 'tetei: a szolg' + [char]0x00E1 + 'ltat' + [char]0x00F3 + 'k eszk' + [char]0x00F6 + 'zei ' + [char]0x00E9 + 's, verzi' + [char]0x00F3 + 't' + [char]0x00F3 + 'l f' + [char]0x00FC + 'gg' + [char]0x0151 + 'en, a be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 's ' + [char]0x00E1 + 'ltal mentett API-kulcs, a levelez' + [char]0x00E9 + 's jelszava ' + [char]0x00E9 + 's a Telegram-tokenek. Az ' + [char]0x00FA + 'j csapat ezeket nem olvassa: add meg ' + [char]0x0151 + 'ket ' + [char]0x00FA + 'jra a jht setup paranccsal. Ha m' + [char]0x00E1 + 'r nincs r' + [char]0x00E1 + 'juk sz' + [char]0x00FC + 'ks' + [char]0x00E9 + 'ged:') }
    'hu:installer.windows.download_failed' { return ('A let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 's nem siker' + [char]0x00FC + 'lt: %s') }
    'hu:installer.windows.downloading_enabling_podman_runtime' { return ('A Podman futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 'se ' + [char]0x00E9 + 's bekapcsol' + [char]0x00E1 + 'sa') }
    'hu:installer.windows.earlier_job_hunter_team' { return ('a Docker Desktopon m' + [char]0x00E9 + 'g fut a Job Hunter Team egy kor' + [char]0x00E1 + 'bbi verzi' + [char]0x00F3 + 'ja (kont' + [char]0x00E9 + 'ner: %s). A 0.4 ' + [char]0x00F3 + 'ta a csapat egy Podman-g' + [char]0x00E9 + 'pen fut: ha mell' + [char]0x00E9 + ' telep' + [char]0x00ED + 'ten' + [char]0x00E9 + 'd, k' + [char]0x00E9 + 't csapat dolgozna ugyanazokon az adatokon. Semmi sem v' + [char]0x00E1 + 'ltozott.') }
    'hu:installer.windows.earlier_job_hunter_team_2' { return ('a Docker Desktopon m' + [char]0x00E9 + 'g telep' + [char]0x00ED + 'tve van a Job Hunter Team egy kor' + [char]0x00E1 + 'bbi verzi' + [char]0x00F3 + 'ja (kont' + [char]0x00E9 + 'ner: %s, le' + [char]0x00E1 + 'll' + [char]0x00ED + 'tva; a Docker Desktoppal ' + [char]0x00FA + 'jraindul). A 0.4 ' + [char]0x00F3 + 'ta a csapat egy Podman-g' + [char]0x00E9 + 'pen fut: ha mell' + [char]0x00E9 + ' telep' + [char]0x00ED + 'ten' + [char]0x00E9 + 'd, k' + [char]0x00E9 + 't csapat dolgozna ugyanazokon az adatokon. Semmi sem v' + [char]0x00E1 + 'ltozott.') }
    'hu:installer.windows.header_pairing' { return ('p' + [char]0x00E1 + 'ros' + [char]0x00ED + 't' + [char]0x00E1 + 's: van token (kihagyja a var' + [char]0x00E1 + 'zsl' + [char]0x00F3 + 't)') }
    'hu:installer.windows.host_env_written' { return ('A host.env meg' + [char]0x00ED + 'rva:') }
    'hu:installer.windows.image' { return ('k' + [char]0x00E9 + 'p: ') }
    'hu:installer.windows.image_free_disk' { return ('' + [char]0x00C9 + 's a k' + [char]0x00E9 + 'p' + [char]0x00E9 + 't is, hogy helyet szabad' + [char]0x00ED + 'ts fel a lemezen:') }
    'hu:installer.windows.install_may_not_know' { return ('telep' + [char]0x00ED + 't' + [char]0x00E9 + 's el' + [char]0x0151 + 'tt ny' + [char]0x00ED + 'lt meg, ' + [char]0x00E9 + 's lehet, hogy m' + [char]0x00E9 + 'g nem ismeri ' + [char]0x0151 + 'ket ("not recognized as the name of a cmdlet").') }
    'hu:installer.windows.installation_complete' { return '|  A telepites kesz!                       |' }
    'hu:installer.windows.jht_podman_are_your' { return ('a jht ' + [char]0x00E9 + 's a podman mostant' + [char]0x00F3 + 'l benne van a PATH-ban, de EZ a PowerShell-ablak m' + [char]0x00E9 + 'g a') }
    'hu:installer.windows.launching_setup_wizard' { return ('A be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00F3 + ' var' + [char]0x00E1 + 'zsl' + [char]0x00F3 + ' ind' + [char]0x00ED + 't' + [char]0x00E1 + 'sa...') }
    'hu:installer.windows.mode_podman_machine_wsl' { return ('m' + [char]0x00F3 + 'd:  Podman-g' + [char]0x00E9 + 'p (WSL)') }
    'hu:installer.windows.next_steps' { return ('K' + [char]0x00F6 + 'vetkez' + [char]0x0151 + ' l' + [char]0x00E9 + 'p' + [char]0x00E9 + 'sek:') }
    'hu:installer.windows.only_windows' { return ('Az install.ps1 csak Windowson m' + [char]0x0171 + 'k' + [char]0x00F6 + 'dik. Linuxon/macOS-en haszn' + [char]0x00E1 + 'ld az install.sh-t.') }
    'hu:installer.windows.open_new_powershell_window' { return ('Nyiss egy ' + [char]0x00DA + 'J PowerShell-ablakot a jht ' + [char]0x00E9 + 's a podman haszn' + [char]0x00E1 + 'lat' + [char]0x00E1 + 'hoz. A sz' + [char]0x00E1 + 'm' + [char]0x00ED + 't' + [char]0x00F3 + 'g' + [char]0x00E9 + 'pet nem kell ' + [char]0x00FA + 'jraind' + [char]0x00ED + 'tani.') }
    'hu:installer.windows.override_lacks_keep_id' { return ('A let' + [char]0x00F6 + 'lt' + [char]0x00F6 + 'tt Podman-fel' + [char]0x00FC + 'l' + [char]0x00ED + 'r' + [char]0x00F3 + 'f' + [char]0x00E1 + 'jlb' + [char]0x00F3 + 'l hi' + [char]0x00E1 + 'nyzik a keep-id.') }
    'hu:installer.windows.pairing_token_present_skipping' { return ('Van p' + [char]0x00E1 + 'ros' + [char]0x00ED + 't' + [char]0x00E1 + 'si token: kihagyom az interakt' + [char]0x00ED + 'v var' + [char]0x00E1 + 'zsl' + [char]0x00F3 + 't. A kont' + [char]0x00E9 + 'ner az els' + [char]0x0151 + ' ind' + [char]0x00ED + 't' + [char]0x00E1 + 'skor befejezi a p' + [char]0x00E1 + 'ros' + [char]0x00ED + 't' + [char]0x00E1 + 'st.') }
    'hu:installer.windows.pairing_token_saved' { return ('A p' + [char]0x00E1 + 'ros' + [char]0x00ED + 't' + [char]0x00E1 + 'si token elmentve:') }
    'hu:installer.windows.podman.check_wsl' { return ('A fenti sor megmondja, mi' + [char]0x00E9 + 'rt. Ellen' + [char]0x0151 + 'rizd, hogy m' + [char]0x0171 + 'k' + [char]0x00F6 + 'dik-e a WSL: futtasd a "wsl --status" parancsot PowerShellben.') }
    'hu:installer.windows.podman.from_desktop' { return ('A fenti sor megmondja, mi' + [char]0x00E9 + 'rt. A telep' + [char]0x00ED + 't' + [char]0x0151 + 't ennek a felhaszn' + [char]0x00E1 + 'l' + [char]0x00F3 + 'nak a Windows-asztal' + [char]0x00E1 + 'r' + [char]0x00F3 + 'l futtasd (Start men' + [char]0x00FC + ', Windows PowerShell), ne ssh-b' + [char]0x00F3 + 'l, szolg' + [char]0x00E1 + 'ltat' + [char]0x00E1 + 'sb' + [char]0x00F3 + 'l vagy ' + [char]0x00FC + 'temezett feladatb' + [char]0x00F3 + 'l: azok asztal n' + [char]0x00E9 + 'lk' + [char]0x00FC + 'l futnak.') }
    'hu:installer.windows.podman.install_failed' { return ('A Podmant nem siker' + [char]0x00FC + 'lt telep' + [char]0x00ED + 'teni.') }
    'hu:installer.windows.podman.install_failed_todo' { return ('A fenti sor megmondja, mi' + [char]0x00E9 + 'rt. A Podman a wingetb' + [char]0x0151 + 'l j' + [char]0x00F6 + 'n, vagy a hivatalos kiad' + [char]0x00E1 + 's' + [char]0x00E1 + 'b' + [char]0x00F3 + 'l, ha a winget nem haszn' + [char]0x00E1 + 'lhat' + [char]0x00F3 + ': ellen' + [char]0x0151 + 'rizd, hogy ez a sz' + [char]0x00E1 + 'm' + [char]0x00ED + 't' + [char]0x00F3 + 'g' + [char]0x00E9 + 'p el' + [char]0x00E9 + 'ri-e a github.com-ot, ' + [char]0x00E9 + 's hogy a winget m' + [char]0x0171 + 'k' + [char]0x00F6 + 'dik-e, ha van (ha hib' + [char]0x00E1 + 's, telep' + [char]0x00ED + 'tsd vagy jav' + [char]0x00ED + 'tsd az "App Installer"-t: https://aka.ms/getwinget).') }
    'hu:installer.windows.podman.machine_failed' { return ('A Job Hunter Team Podman-g' + [char]0x00E9 + 'p' + [char]0x00E9 + 't nem siker' + [char]0x00FC + 'lt l' + [char]0x00E9 + 'trehozni vagy elind' + [char]0x00ED + 'tani.') }
    'hu:installer.windows.podman.network_not_ready' { return ('A Podman-g' + [char]0x00E9 + 'p elindult, de a h' + [char]0x00E1 + 'l' + [char]0x00F3 + 'zata nincs k' + [char]0x00E9 + 'sz.') }
    'hu:installer.windows.podman.network_todo' { return ('A fenti sor megmondja, mi' + [char]0x00E9 + 'rt. V' + [char]0x00E1 + 'rj egy percet, ' + [char]0x00E9 + 's futtasd ' + [char]0x00FA + 'jra ugyanazt a telep' + [char]0x00ED + 't' + [char]0x00E9 + 'si parancsot; ha megint itt ' + [char]0x00E1 + 'll meg, el' + [char]0x0151 + 'bb ind' + [char]0x00ED + 'tsd ' + [char]0x00FA + 'jra a Windowst.') }
    'hu:installer.windows.podman.other_user' { return ('A Podman ennek a sz' + [char]0x00E1 + 'm' + [char]0x00ED + 't' + [char]0x00F3 + 'g' + [char]0x00E9 + 'pnek egy m' + [char]0x00E1 + 'sik Windows-felhaszn' + [char]0x00E1 + 'l' + [char]0x00F3 + 'j' + [char]0x00E1 + 'hoz van telep' + [char]0x00ED + 'tve.') }
    'hu:installer.windows.podman.other_user_todo' { return ('Futtasd a telep' + [char]0x00ED + 't' + [char]0x0151 + 't azzal a Windows-felhaszn' + [char]0x00E1 + 'l' + [char]0x00F3 + 'val, vagy t' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tsd el a Podmant a sz' + [char]0x00E1 + 'm' + [char]0x00ED + 't' + [char]0x00F3 + 'g' + [char]0x00E9 + 'pr' + [char]0x0151 + 'l (G' + [char]0x00E9 + 'ph' + [char]0x00E1 + 'z > Alkalmaz' + [char]0x00E1 + 'sok), ' + [char]0x00E9 + 's futtasd ' + [char]0x00FA + 'jra a telep' + [char]0x00ED + 't' + [char]0x00E9 + 'si parancsot.') }
    'hu:installer.windows.podman.other_version' { return ('Ezen a sz' + [char]0x00E1 + 'm' + [char]0x00ED + 't' + [char]0x00F3 + 'g' + [char]0x00E9 + 'pen a Podman egy m' + [char]0x00E1 + 'sik verzi' + [char]0x00F3 + 'ja van telep' + [char]0x00ED + 'tve.') }
    'hu:installer.windows.podman.restart_pending' { return ('Ha a Windows ' + [char]0x00FA + 'jraind' + [char]0x00ED + 't' + [char]0x00E1 + 'sra v' + [char]0x00E1 + 'r, ind' + [char]0x00ED + 'tsd ' + [char]0x00FA + 'jra.') }
    'hu:installer.windows.podman.restart_then_again' { return ('Csak ha az asztalr' + [char]0x00F3 + 'l is megint itt ' + [char]0x00E1 + 'll meg: ind' + [char]0x00ED + 'tsd ' + [char]0x00FA + 'jra a Windowst, majd futtasd m' + [char]0x00E9 + 'g egyszer.') }
    'hu:installer.windows.podman.run_again' { return ('Ut' + [char]0x00E1 + 'na futtasd ' + [char]0x00FA + 'jra ugyanazt a telep' + [char]0x00ED + 't' + [char]0x00E9 + 'si parancsot: el' + [char]0x00F6 + 'lr' + [char]0x0151 + 'l kezdi.') }
    'hu:installer.windows.podman.runs_on_6' { return ('A Job Hunter Team Podman 6-on fut, ' + [char]0x00E9 + 's nem m' + [char]0x00F3 + 'dos' + [char]0x00ED + 't egy m' + [char]0x00E1 + 'sik Podmant.') }
    'hu:installer.windows.podman.sshproxy' { return ('A Podman elind' + [char]0x00ED + 'totta a g' + [char]0x00E9 + 'pet, de a Docker-eszk' + [char]0x00F6 + 'z' + [char]0x00F6 + 'kh' + [char]0x00F6 + 'z val' + [char]0x00F3 + ' kapcsolata (win-sshproxy.exe) nem indult el.') }
    'hu:installer.windows.podman.stopped' { return ('A Podman el' + [char]0x0151 + 'k' + [char]0x00E9 + 'sz' + [char]0x00ED + 't' + [char]0x00E9 + 'se le' + [char]0x00E1 + 'llt (kil' + [char]0x00E9 + 'p' + [char]0x00E9 + 'si k' + [char]0x00F3 + 'd: %s).') }
    'hu:installer.windows.podman.stopped_todo' { return ('A fenti sor megmondja, mi' + [char]0x00E9 + 'rt. Futtasd ' + [char]0x00FA + 'jra ugyanazt a telep' + [char]0x00ED + 't' + [char]0x00E9 + 'si parancsot; ha ugyanott ' + [char]0x00E1 + 'll meg, ' + [char]0x0151 + 'rizd meg azt a sort, ' + [char]0x00E9 + 's k' + [char]0x00E9 + 'rj seg' + [char]0x00ED + 'ts' + [char]0x00E9 + 'get.') }
    'hu:installer.windows.podman.update_or_remove' { return ('Friss' + [char]0x00ED + 'tsd a 6-os verzi' + [char]0x00F3 + 'ra, vagy t' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tsd el (G' + [char]0x00E9 + 'ph' + [char]0x00E1 + 'z > Alkalmaz' + [char]0x00E1 + 'sok), ahogy jobban tetszik.') }
    'hu:installer.windows.podman_machine_windows_user' { return ('Ennek a Windows-felhaszn' + [char]0x00E1 + 'l' + [char]0x00F3 + 'nak a Podman-g' + [char]0x00E9 + 'pe:') }
    'hu:installer.windows.powershell_too_old' { return ('PowerShell 5.1 vagy ' + [char]0x00FA + 'jabb kell (a jelenlegi verzi' + [char]0x00F3 + ': %s). Telep' + [char]0x00ED + 'tsd a PowerShell 7-et: https://aka.ms/PowerShell') }
    'hu:installer.windows.registering_user_path' { return ('A felhaszn' + [char]0x00E1 + 'l' + [char]0x00F3 + 'i PATH be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'sa') }
    'hu:installer.windows.reparse_ancestor' { return ('A gazdag' + [char]0x00E9 + 'p egyik v' + [char]0x00E9 + 'dett ' + [char]0x00FA + 'tvonala f' + [char]0x00F6 + 'l' + [char]0x00F6 + 'tt reparse point (link) van: %s') }
    'hu:installer.windows.runtime_artifact_missing' { return ('Hi' + [char]0x00E1 + 'nyzik egy f' + [char]0x00E1 + 'jl a Podman futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezetb' + [char]0x0151 + 'l: %s') }
    'hu:installer.windows.runtime_overlaps' { return ('A gazdag' + [char]0x00E9 + 'p v' + [char]0x00E9 + 'dett futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet-' + [char]0x00FA + 'tvonala ' + [char]0x00E1 + 'tfed' + [char]0x00E9 + 'sben van egy, a kont' + [char]0x00E9 + 'ner ' + [char]0x00E1 + 'ltal ' + [char]0x00ED + 'rhat' + [char]0x00F3 + ' mapp' + [char]0x00E1 + 'val: %s') }
    'hu:installer.windows.setup_wizard_also_starts' { return ('be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00F3 + ' var' + [char]0x00E1 + 'zsl' + [char]0x00F3 + ' (a kont' + [char]0x00E9 + 'nert is elind' + [char]0x00ED + 'tja)') }
    'hu:installer.windows.stop_remove_old_team' { return ('' + [char]0x00C1 + 'll' + [char]0x00ED + 'tsd le ' + [char]0x00E9 + 's t' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tsd el a r' + [char]0x00E9 + 'gi csapatot (bekapcsolt Docker Desktoppal), PowerShellben:') }
    'hu:installer.windows.system_detection' { return ('A rendszer felismer' + [char]0x00E9 + 'se') }
    'hu:installer.windows.then_run_installer_again' { return ('Ut' + [char]0x00E1 + 'na futtasd ' + [char]0x00FA + 'jra ezt a telep' + [char]0x00ED + 't' + [char]0x0151 + 't.') }
    'hu:installer.windows.token_acl_failed' { return ('Az ACL-korl' + [char]0x00E1 + 'toz' + [char]0x00E1 + 's nem siker' + [char]0x00FC + 'lt (a f' + [char]0x00E1 + 'jlt a Users csoport m' + [char]0x00E9 + 'g olvashatja): %s') }
    'hu:installer.windows.uninstall_keeps_data_jht' { return ('Elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 't' + [char]0x00E1 + 's (az adatok megmaradnak a ~/.jht ' + [char]0x00E9 + 's a ~/Documents/Job Hunter Team mapp' + [char]0x00E1 + 'ban):') }
    'hu:installer.windows.user_path_updated_effective' { return ('A felhaszn' + [char]0x00E1 + 'l' + [char]0x00F3 + 'i PATH friss' + [char]0x00ED + 'tve (a k' + [char]0x00F6 + 'vetkez' + [char]0x0151 + ' termin' + [char]0x00E1 + 'lt' + [char]0x00F3 + 'l ' + [char]0x00E9 + 'rv' + [char]0x00E9 + 'nyes)') }
    'hu:installer.windows.what_do_now' { return ('Mit tegy' + [char]0x00E9 + 'l most:') }
    'hu:installer.windows.windows_subsystem_linux_check' { return ('A Linuxos Windows-alrendszer (WSL) ellen' + [char]0x0151 + 'rz' + [char]0x00E9 + 'se') }
    'hu:installer.windows.wizard_exited_error_re' { return ('A var' + [char]0x00E1 + 'zsl' + [char]0x00F3 + ' hib' + [char]0x00E1 + 'val ' + [char]0x00E1 + 'llt le. Futtasd ' + [char]0x00FA + 'jra ' + [char]0x00ED + 'gy: jht setup') }
    'hu:installer.windows.wrapper_lacks_protocol' { return ('A let' + [char]0x00F6 + 'lt' + [char]0x00F6 + 'tt wrapperb' + [char]0x0151 + 'l hi' + [char]0x00E1 + 'nyzik a futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet v' + [char]0x00E9 + 'dett protokollja.') }
    'hu:installer.windows.wrapper_overlaps' { return ('A gazdag' + [char]0x00E9 + 'p v' + [char]0x00E9 + 'dett wrapper-' + [char]0x00FA + 'tvonala ' + [char]0x00E1 + 'tfed' + [char]0x00E9 + 'sben van egy, a kont' + [char]0x00E9 + 'ner ' + [char]0x00E1 + 'ltal ' + [char]0x00ED + 'rhat' + [char]0x00F3 + ' mapp' + [char]0x00E1 + 'val: %s') }
    'hu:installer.windows.writing_host_env' { return ('A host.env meg' + [char]0x00ED + 'r' + [char]0x00E1 + 'sa') }
    'hu:installer.windows.wsl_ready' { return ('A WSL k' + [char]0x00E9 + 'sz') }
    'hu:installer.windows.your_data_stays_jht' { return ('Az adataid megmaradnak: a ~/.jht (be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 's, adatb' + [char]0x00E1 + 'zis, profil) ' + [char]0x00E9 + 's a Dokumentumok\Job Hunter Team (' + [char]0x00F6 + 'n' + [char]0x00E9 + 'letrajzok, eredm' + [char]0x00E9 + 'nyek) ennek a sz' + [char]0x00E1 + 'm' + [char]0x00ED + 't' + [char]0x00F3 + 'g' + [char]0x00E9 + 'pnek a mapp' + [char]0x00E1 + 'i, ' + [char]0x00E9 + 's az ' + [char]0x00FA + 'j csapat ezeket haszn' + [char]0x00E1 + 'lja.') }
    'es:installer.check.compose_boundary' { return ('El docker-compose.yml descargado no aplica el l' + [char]0x00ED + 'mite protegido del runtime.') }
    'es:installer.windows.acl_failed' { return ('La verificaci' + [char]0x00F3 + 'n de la ACL de JHT_HOME ha fallado despu' + [char]0x00E9 + 's de repararla: %s') }
    'es:installer.windows.agents_only_see' { return 'Los agentes solo ven:' }
    'es:installer.windows.already_user_path' { return ('ya est' + [char]0x00E1 + ' en el PATH del usuario') }
    'es:installer.windows.branch' { return 'rama:   ' }
    'es:installer.windows.branch_unresolved' { return ('No puedo resolver la rama ''%s'' en un commit de versi' + [char]0x00F3 + 'n inmutable.') }
    'es:installer.windows.check_connection_branch' { return ('Comprueba la conexi' + [char]0x00F3 + 'n y la rama (%s).') }
    'es:installer.windows.config_db_agents' { return ('(configuraci' + [char]0x00F3 + 'n, db, agentes)') }
    'es:installer.windows.container_mode_active' { return 'Modo contenedor activo.' }
    'es:installer.windows.cvs_attachments_output' { return '(CV, adjuntos, resultados)' }
    'es:installer.windows.delete_data_as_well' { return ('Para borrar tambi' + [char]0x00E9 + 'n los datos (configuraci' + [char]0x00F3 + 'n, db, CV, resultados):') }
    'es:installer.windows.docker_desktop_volumes_old' { return ('En Docker Desktop se quedan los vol' + [char]0x00FA + 'menes del equipo antiguo: las herramientas de los proveedores y, seg' + [char]0x00FA + 'n la versi' + [char]0x00F3 + 'n, la clave API guardada por la configuraci' + [char]0x00F3 + 'n, la contrase' + [char]0x00F1 + 'a del correo y los tokens de Telegram. El equipo nuevo no los lee: vuelve a darlos con jht setup. Si ya no los necesitas:') }
    'es:installer.windows.download_failed' { return 'La descarga ha fallado: %s' }
    'es:installer.windows.downloading_enabling_podman_runtime' { return 'Descargando y activando el motor Podman' }
    'es:installer.windows.earlier_job_hunter_team' { return ('todav' + [char]0x00ED + 'a hay un Job Hunter Team anterior en marcha en Docker Desktop (contenedor %s). Desde la 0.4 el equipo funciona en una m' + [char]0x00E1 + 'quina Podman: si lo instalas al lado, dos equipos trabajar' + [char]0x00ED + 'an con los mismos datos. No se ha cambiado nada.') }
    'es:installer.windows.earlier_job_hunter_team_2' { return ('todav' + [char]0x00ED + 'a hay un Job Hunter Team anterior instalado en Docker Desktop (contenedor %s, parado; vuelve a arrancar con Docker Desktop). Desde la 0.4 el equipo funciona en una m' + [char]0x00E1 + 'quina Podman: si lo instalas al lado, dos equipos trabajar' + [char]0x00ED + 'an con los mismos datos. No se ha cambiado nada.') }
    'es:installer.windows.header_pairing' { return ('emparejamiento: hay token (se salta la configuraci' + [char]0x00F3 + 'n guiada)') }
    'es:installer.windows.host_env_written' { return 'host.env escrito:' }
    'es:installer.windows.image' { return 'imagen: ' }
    'es:installer.windows.image_free_disk' { return 'Y su imagen, para liberar disco:' }
    'es:installer.windows.install_may_not_know' { return ('instalaci' + [char]0x00F3 + 'n y puede que a' + [char]0x00FA + 'n no los conozca ("no se reconoce como nombre de un cmdlet").') }
    'es:installer.windows.installation_complete' { return '|  Instalacion completada!                 |' }
    'es:installer.windows.jht_podman_are_your' { return ('desde ahora jht y podman est' + [char]0x00E1 + 'n en tu PATH, pero ESTA ventana de PowerShell ya estaba abierta antes de la') }
    'es:installer.windows.launching_setup_wizard' { return ('Iniciando la configuraci' + [char]0x00F3 + 'n guiada...') }
    'es:installer.windows.mode_podman_machine_wsl' { return ('modo:    m' + [char]0x00E1 + 'quina Podman (WSL)') }
    'es:installer.windows.next_steps' { return ('Pr' + [char]0x00F3 + 'ximos pasos:') }
    'es:installer.windows.only_windows' { return 'install.ps1 solo funciona en Windows. En Linux/macOS usa install.sh.' }
    'es:installer.windows.open_new_powershell_window' { return 'Abre una NUEVA ventana de PowerShell para usar jht y podman. No hace falta reiniciar el ordenador.' }
    'es:installer.windows.override_lacks_keep_id' { return 'Al override de Podman descargado le falta keep-id.' }
    'es:installer.windows.pairing_token_present_skipping' { return ('Hay un token de emparejamiento: me salto la configuraci' + [char]0x00F3 + 'n guiada. El contenedor completar' + [char]0x00E1 + ' el emparejamiento en el primer arranque.') }
    'es:installer.windows.pairing_token_saved' { return 'Token de emparejamiento guardado:' }
    'es:installer.windows.podman.check_wsl' { return ('La l' + [char]0x00ED + 'nea de arriba dice por qu' + [char]0x00E9 + '. Comprueba que WSL funciona: ejecuta "wsl --status" en PowerShell.') }
    'es:installer.windows.podman.from_desktop' { return ('La l' + [char]0x00ED + 'nea de arriba dice por qu' + [char]0x00E9 + '. Ejecuta el instalador desde el escritorio de Windows de este usuario (el men' + [char]0x00FA + ' Inicio, Windows PowerShell), no desde ssh, un servicio o una tarea programada: esos funcionan sin escritorio.') }
    'es:installer.windows.podman.install_failed' { return 'No se ha podido instalar Podman.' }
    'es:installer.windows.podman.install_failed_todo' { return ('La l' + [char]0x00ED + 'nea de arriba dice por qu' + [char]0x00E9 + '. Podman se descarga con winget, o de su versi' + [char]0x00F3 + 'n oficial cuando no se puede usar winget: comprueba que este ordenador llega a github.com, y que winget funciona si lo tienes (si est' + [char]0x00E1 + ' roto, instala o repara "App Installer": https://aka.ms/getwinget).') }
    'es:installer.windows.podman.machine_failed' { return ('No se ha podido crear o arrancar la m' + [char]0x00E1 + 'quina Podman de Job Hunter Team.') }
    'es:installer.windows.podman.network_not_ready' { return ('La m' + [char]0x00E1 + 'quina Podman ha arrancado, pero su red no est' + [char]0x00E1 + ' lista.') }
    'es:installer.windows.podman.network_todo' { return ('La l' + [char]0x00ED + 'nea de arriba dice por qu' + [char]0x00E9 + '. Espera un minuto y vuelve a ejecutar el mismo comando de instalaci' + [char]0x00F3 + 'n; si se para otra vez aqu' + [char]0x00ED + ', reinicia antes Windows.') }
    'es:installer.windows.podman.other_user' { return ('Podman est' + [char]0x00E1 + ' instalado para otro usuario de Windows de este ordenador.') }
    'es:installer.windows.podman.other_user_todo' { return ('Ejecuta el instalador como ese usuario de Windows, o quita Podman del ordenador (Configuraci' + [char]0x00F3 + 'n > Aplicaciones) y vuelve a ejecutar el comando de instalaci' + [char]0x00F3 + 'n.') }
    'es:installer.windows.podman.other_version' { return ('En este ordenador hay instalada otra versi' + [char]0x00F3 + 'n de Podman.') }
    'es:installer.windows.podman.restart_pending' { return ('Si Windows tiene un reinicio pendiente, rein' + [char]0x00ED + 'cialo.') }
    'es:installer.windows.podman.restart_then_again' { return ('Solo si se para otra vez aqu' + [char]0x00ED + ' desde el escritorio: reinicia Windows y vuelve a ejecutarlo una vez m' + [char]0x00E1 + 's.') }
    'es:installer.windows.podman.run_again' { return ('Luego vuelve a ejecutar el mismo comando de instalaci' + [char]0x00F3 + 'n: empieza otra vez desde el principio.') }
    'es:installer.windows.podman.runs_on_6' { return 'Job Hunter Team funciona con Podman 6 y no cambia otro Podman.' }
    'es:installer.windows.podman.sshproxy' { return ('Podman ha arrancado la m' + [char]0x00E1 + 'quina, pero su conexi' + [char]0x00F3 + 'n para las herramientas de Docker (win-sshproxy.exe) no ha arrancado.') }
    'es:installer.windows.podman.stopped' { return ('La configuraci' + [char]0x00F3 + 'n de Podman se ha parado (c' + [char]0x00F3 + 'digo de salida %s).') }
    'es:installer.windows.podman.stopped_todo' { return ('La l' + [char]0x00ED + 'nea de arriba dice por qu' + [char]0x00E9 + '. Vuelve a ejecutar el mismo comando de instalaci' + [char]0x00F3 + 'n; si se para en el mismo punto, guarda esa l' + [char]0x00ED + 'nea y pide ayuda.') }
    'es:installer.windows.podman.update_or_remove' { return ('Actual' + [char]0x00ED + 'zalo a la versi' + [char]0x00F3 + 'n 6 o qu' + [char]0x00ED + 'talo (Configuraci' + [char]0x00F3 + 'n > Aplicaciones), como prefieras.') }
    'es:installer.windows.podman_machine_windows_user' { return ('M' + [char]0x00E1 + 'quina Podman de este usuario de Windows:') }
    'es:installer.windows.powershell_too_old' { return ('Hace falta PowerShell 5.1+ (versi' + [char]0x00F3 + 'n actual: %s). Instala PowerShell 7: https://aka.ms/PowerShell') }
    'es:installer.windows.registering_user_path' { return 'Registrando el PATH del usuario' }
    'es:installer.windows.reparse_ancestor' { return ('La ruta protegida del host tiene un antecesor que es un punto de rean' + [char]0x00E1 + 'lisis: %s') }
    'es:installer.windows.runtime_artifact_missing' { return 'Falta un artefacto del motor Podman: %s' }
    'es:installer.windows.runtime_overlaps' { return ('La ruta protegida del motor en el host se solapa con un ' + [char]0x00E1 + 'rbol en el que el contenedor puede escribir: %s') }
    'es:installer.windows.setup_wizard_also_starts' { return ('configuraci' + [char]0x00F3 + 'n guiada (tambi' + [char]0x00E9 + 'n arranca el contenedor)') }
    'es:installer.windows.stop_remove_old_team' { return 'Para y quita el equipo antiguo (con Docker Desktop encendido), en PowerShell:' }
    'es:installer.windows.system_detection' { return ('Detecci' + [char]0x00F3 + 'n del sistema') }
    'es:installer.windows.then_run_installer_again' { return 'Luego vuelve a ejecutar este instalador.' }
    'es:installer.windows.token_acl_failed' { return ('La restricci' + [char]0x00F3 + 'n de la ACL ha fallado (el grupo Users a' + [char]0x00FA + 'n puede leer el archivo): %s') }
    'es:installer.windows.uninstall_keeps_data_jht' { return 'Para desinstalar (conserva los datos en ~/.jht y ~/Documents/Job Hunter Team):' }
    'es:installer.windows.user_path_updated_effective' { return ('PATH del usuario actualizado (vale desde la pr' + [char]0x00F3 + 'xima terminal)') }
    'es:installer.windows.what_do_now' { return ('Qu' + [char]0x00E9 + ' hacer ahora:') }
    'es:installer.windows.windows_subsystem_linux_check' { return ('Comprobaci' + [char]0x00F3 + 'n del Subsistema de Windows para Linux') }
    'es:installer.windows.wizard_exited_error_re' { return ('La configuraci' + [char]0x00F3 + 'n guiada ha terminado con un error. Vuelve a ejecutarla con: jht setup') }
    'es:installer.windows.wrapper_lacks_protocol' { return 'Al wrapper descargado le falta el protocolo protegido del motor.' }
    'es:installer.windows.wrapper_overlaps' { return ('La ruta protegida del wrapper en el host se solapa con un ' + [char]0x00E1 + 'rbol en el que el contenedor puede escribir: %s') }
    'es:installer.windows.writing_host_env' { return 'Escribiendo host.env' }
    'es:installer.windows.wsl_ready' { return ('WSL est' + [char]0x00E1 + ' listo') }
    'es:installer.windows.your_data_stays_jht' { return ('Tus datos se quedan: ~/.jht (configuraci' + [char]0x00F3 + 'n, base de datos, perfil) y Documents\Job Hunter Team (CV, resultados) son carpetas de este ordenador, y el equipo nuevo las usa.') }
    'de:installer.check.compose_boundary' { return ('Die heruntergeladene docker-compose.yml setzt die gesch' + [char]0x00FC + 'tzte Grenze der Runtime nicht durch.') }
    'de:installer.windows.acl_failed' { return ('Pr' + [char]0x00FC + 'fung der ACL von JHT_HOME nach der Reparatur fehlgeschlagen: %s') }
    'de:installer.windows.agents_only_see' { return 'Die Agenten sehen nur:' }
    'de:installer.windows.already_user_path' { return 'schon im Benutzer-PATH' }
    'de:installer.windows.branch' { return 'Branch: ' }
    'de:installer.windows.branch_unresolved' { return ('Branch ''%s'' l' + [char]0x00E4 + 'sst sich keinem unver' + [char]0x00E4 + 'nderlichen Release-Commit zuordnen.') }
    'de:installer.windows.check_connection_branch' { return ('Pr' + [char]0x00FC + 'fe deine Verbindung und den Branch (%s).') }
    'de:installer.windows.config_db_agents' { return '(Konfiguration, Datenbank, Agenten)' }
    'de:installer.windows.container_mode_active' { return 'Container-Modus aktiv.' }
    'de:installer.windows.cvs_attachments_output' { return ('(Lebensl' + [char]0x00E4 + 'ufe, Anh' + [char]0x00E4 + 'nge, Ergebnisse)') }
    'de:installer.windows.delete_data_as_well' { return ('Um auch die Daten zu l' + [char]0x00F6 + 'schen (Konfiguration, Datenbank, Lebensl' + [char]0x00E4 + 'ufe, Ergebnisse):') }
    'de:installer.windows.docker_desktop_volumes_old' { return ('In Docker Desktop bleiben die Volumes des alten Teams: Werkzeuge der Anbieter und, je nach Version, der vom Setup gespeicherte API-Schl' + [char]0x00FC + 'ssel, das Mail-Passwort und die Telegram-Tokens. Das neue Team liest sie nicht: Gib sie mit jht setup noch einmal ein. Wenn du sie nicht mehr brauchst:') }
    'de:installer.windows.download_failed' { return 'Download fehlgeschlagen: %s' }
    'de:installer.windows.downloading_enabling_podman_runtime' { return 'Lade die Podman-Laufzeit herunter und aktiviere sie' }
    'de:installer.windows.earlier_job_hunter_team' { return ('ein fr' + [char]0x00FC + 'heres Job Hunter Team l' + [char]0x00E4 + 'uft noch auf Docker Desktop (Container %s). Seit 0.4 l' + [char]0x00E4 + 'uft das Team in einer Podman-Maschine: Daneben installiert, w' + [char]0x00FC + 'rden zwei Teams mit denselben Daten arbeiten. Nichts wurde ge' + [char]0x00E4 + 'ndert.') }
    'de:installer.windows.earlier_job_hunter_team_2' { return ('ein fr' + [char]0x00FC + 'heres Job Hunter Team ist noch auf Docker Desktop installiert (Container %s, gestoppt; er startet mit Docker Desktop wieder). Seit 0.4 l' + [char]0x00E4 + 'uft das Team in einer Podman-Maschine: Daneben installiert, w' + [char]0x00FC + 'rden zwei Teams mit denselben Daten arbeiten. Nichts wurde ge' + [char]0x00E4 + 'ndert.') }
    'de:installer.windows.header_pairing' { return ('Kopplung: Token vorhanden (' + [char]0x00FC + 'berspringt den Assistenten)') }
    'de:installer.windows.host_env_written' { return 'host.env geschrieben:' }
    'de:installer.windows.image' { return 'Image:  ' }
    'de:installer.windows.image_free_disk' { return 'Und sein Image, um Speicherplatz freizugeben:' }
    'de:installer.windows.install_may_not_know' { return 'Installation offen und kennt sie vielleicht noch nicht ("wird nicht als Name eines Cmdlet erkannt").' }
    'de:installer.windows.installation_complete' { return '|  Installation abgeschlossen!             |' }
    'de:installer.windows.jht_podman_are_your' { return 'jht und podman sind ab jetzt in deinem PATH, aber DIESES PowerShell-Fenster war schon vor der' }
    'de:installer.windows.launching_setup_wizard' { return 'Starte den Einrichtungsassistenten...' }
    'de:installer.windows.mode_podman_machine_wsl' { return 'Modus:   Podman-Maschine (WSL)' }
    'de:installer.windows.next_steps' { return ('N' + [char]0x00E4 + 'chste Schritte:') }
    'de:installer.windows.only_windows' { return ('install.ps1 unterst' + [char]0x00FC + 'tzt nur Windows. Unter Linux/macOS nutze install.sh.') }
    'de:installer.windows.open_new_powershell_window' { return ('' + [char]0x00D6 + 'ffne ein NEUES PowerShell-Fenster, um jht und podman zu nutzen. Ein Neustart des Computers ist nicht n' + [char]0x00F6 + 'tig.') }
    'de:installer.windows.override_lacks_keep_id' { return 'Dem heruntergeladenen Podman-Override fehlt keep-id.' }
    'de:installer.windows.pairing_token_present_skipping' { return ('Kopplungstoken vorhanden: Der interaktive Assistent wird ' + [char]0x00FC + 'bersprungen. Der Container schlie' + [char]0x00DF + 't die Kopplung beim ersten Start ab.') }
    'de:installer.windows.pairing_token_saved' { return 'Kopplungstoken gespeichert:' }
    'de:installer.windows.podman.check_wsl' { return ('Die Zeile oben sagt, warum. Pr' + [char]0x00FC + 'fe, ob WSL funktioniert: F' + [char]0x00FC + 'hre "wsl --status" in PowerShell aus.') }
    'de:installer.windows.podman.from_desktop' { return ('Die Zeile oben sagt, warum. F' + [char]0x00FC + 'hre den Installer vom Windows-Desktop dieses Benutzers aus (Startmen' + [char]0x00FC + ', Windows PowerShell), nicht ' + [char]0x00FC + 'ber ssh, einen Dienst oder eine geplante Aufgabe: Die laufen ohne Desktop.') }
    'de:installer.windows.podman.install_failed' { return 'Podman konnte nicht installiert werden.' }
    'de:installer.windows.podman.install_failed_todo' { return ('Die Zeile oben sagt, warum. Podman kommt von winget oder, wenn winget nicht nutzbar ist, aus seinem offiziellen Release: Pr' + [char]0x00FC + 'fe, ob dieser Computer github.com erreicht und ob winget funktioniert, falls du es hast (wenn es kaputt ist, installiere oder repariere "App Installer": https://aka.ms/getwinget).') }
    'de:installer.windows.podman.machine_failed' { return 'Die Podman-Maschine von Job Hunter Team konnte nicht erstellt oder gestartet werden.' }
    'de:installer.windows.podman.network_not_ready' { return 'Die Podman-Maschine ist gestartet, aber ihr Netzwerk ist nicht bereit.' }
    'de:installer.windows.podman.network_todo' { return ('Die Zeile oben sagt, warum. Warte eine Minute und f' + [char]0x00FC + 'hre denselben Installationsbefehl erneut aus; wenn er hier wieder stoppt, starte zuerst Windows neu.') }
    'de:installer.windows.podman.other_user' { return ('Podman ist f' + [char]0x00FC + 'r einen anderen Windows-Benutzer dieses Computers installiert.') }
    'de:installer.windows.podman.other_user_todo' { return ('F' + [char]0x00FC + 'hre den Installer als dieser Windows-Benutzer aus, oder entferne Podman f' + [char]0x00FC + 'r den Computer (Einstellungen > Apps) und f' + [char]0x00FC + 'hre den Installationsbefehl erneut aus.') }
    'de:installer.windows.podman.other_version' { return 'Auf diesem Computer ist eine andere Podman-Version installiert.' }
    'de:installer.windows.podman.restart_pending' { return 'Wenn ein Neustart von Windows aussteht, starte es neu.' }
    'de:installer.windows.podman.restart_then_again' { return ('Nur wenn er auch vom Desktop aus hier wieder stoppt: Starte Windows neu und f' + [char]0x00FC + 'hre ihn dann noch einmal aus.') }
    'de:installer.windows.podman.run_again' { return ('Dann f' + [char]0x00FC + 'hre denselben Installationsbefehl erneut aus: Er beginnt wieder von vorn.') }
    'de:installer.windows.podman.runs_on_6' { return ('Job Hunter Team l' + [char]0x00E4 + 'uft auf Podman 6 und ' + [char]0x00E4 + 'ndert kein anderes Podman.') }
    'de:installer.windows.podman.sshproxy' { return ('Podman hat die Maschine gestartet, aber ihre Verbindung f' + [char]0x00FC + 'r Docker-Werkzeuge (win-sshproxy.exe) ist nicht gestartet.') }
    'de:installer.windows.podman.stopped' { return 'Die Podman-Einrichtung wurde abgebrochen (Exit-Code %s).' }
    'de:installer.windows.podman.stopped_todo' { return ('Die Zeile oben sagt, warum. F' + [char]0x00FC + 'hre denselben Installationsbefehl erneut aus; wenn er an derselben Stelle stoppt, behalte diese Zeile und bitte um Hilfe.') }
    'de:installer.windows.podman.update_or_remove' { return 'Aktualisiere es auf Version 6 oder entferne es (Einstellungen > Apps), wie du willst.' }
    'de:installer.windows.podman_machine_windows_user' { return 'Podman-Maschine dieses Windows-Benutzers:' }
    'de:installer.windows.powershell_too_old' { return 'PowerShell 5.1+ erforderlich (aktuelle Version: %s). Installiere PowerShell 7: https://aka.ms/PowerShell' }
    'de:installer.windows.registering_user_path' { return 'Trage den Benutzer-PATH ein' }
    'de:installer.windows.reparse_ancestor' { return ('Gesch' + [char]0x00FC + 'tzter Host-Pfad hat einen Analysepunkt (Reparse Point) als Vorfahren: %s') }
    'de:installer.windows.runtime_artifact_missing' { return 'Podman-Laufzeitartefakt fehlt: %s' }
    'de:installer.windows.runtime_overlaps' { return ('Gesch' + [char]0x00FC + 'tzter Laufzeitpfad des Hosts ' + [char]0x00FC + 'berschneidet sich mit einem vom Container beschreibbaren Baum: %s') }
    'de:installer.windows.setup_wizard_also_starts' { return 'Einrichtungsassistent (startet auch den Container)' }
    'de:installer.windows.stop_remove_old_team' { return 'Stoppe und entferne das alte Team (Docker Desktop an), in PowerShell:' }
    'de:installer.windows.system_detection' { return 'Systemerkennung' }
    'de:installer.windows.then_run_installer_again' { return ('Dann f' + [char]0x00FC + 'hre diesen Installer erneut aus.') }
    'de:installer.windows.token_acl_failed' { return ('Einschr' + [char]0x00E4 + 'nkung der ACL fehlgeschlagen (Datei ist f' + [char]0x00FC + 'r Users noch lesbar): %s') }
    'de:installer.windows.uninstall_keeps_data_jht' { return 'Zum Deinstallieren (die Daten in ~/.jht und ~/Documents/Job Hunter Team bleiben erhalten):' }
    'de:installer.windows.user_path_updated_effective' { return ('Benutzer-PATH aktualisiert (gilt ab dem n' + [char]0x00E4 + 'chsten Terminal)') }
    'de:installer.windows.what_do_now' { return 'Was du jetzt tun kannst:' }
    'de:installer.windows.windows_subsystem_linux_check' { return ('Pr' + [char]0x00FC + 'fung des Windows-Subsystems f' + [char]0x00FC + 'r Linux') }
    'de:installer.windows.wizard_exited_error_re' { return 'Der Assistent wurde mit einem Fehler beendet. Starte ihn erneut mit: jht setup' }
    'de:installer.windows.wrapper_lacks_protocol' { return ('Dem heruntergeladenen Wrapper fehlt das gesch' + [char]0x00FC + 'tzte Laufzeitprotokoll.') }
    'de:installer.windows.wrapper_overlaps' { return ('Gesch' + [char]0x00FC + 'tzter Wrapper-Pfad des Hosts ' + [char]0x00FC + 'berschneidet sich mit einem vom Container beschreibbaren Baum: %s') }
    'de:installer.windows.writing_host_env' { return 'Schreibe host.env' }
    'de:installer.windows.wsl_ready' { return 'WSL ist bereit' }
    'de:installer.windows.your_data_stays_jht' { return ('Deine Daten bleiben: ~/.jht (Konfiguration, Datenbank, Profil) und Documents\Job Hunter Team (Lebensl' + [char]0x00E4 + 'ufe, Ergebnisse) sind Ordner dieses Computers, und das neue Team nutzt sie.') }
    'fr:installer.check.compose_boundary' { return ('Le docker-compose.yml t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charg' + [char]0x00E9 + ' n''applique pas la fronti' + [char]0x00E8 + 're prot' + [char]0x00E9 + 'g' + [char]0x00E9 + 'e du runtime.') }
    'fr:installer.windows.acl_failed' { return ('' + [char]0x00C9 + 'chec de la v' + [char]0x00E9 + 'rification des ACL de JHT_HOME apr' + [char]0x00E8 + 's r' + [char]0x00E9 + 'paration : %s') }
    'fr:installer.windows.agents_only_see' { return 'Les agents ne voient que :' }
    'fr:installer.windows.already_user_path' { return ('d' + [char]0x00E9 + 'j' + [char]0x00E0 + ' dans le PATH utilisateur') }
    'fr:installer.windows.branch' { return 'branche : ' }
    'fr:installer.windows.branch_unresolved' { return ('Impossible de r' + [char]0x00E9 + 'soudre la branche ''%s'' en un commit de release immuable.') }
    'fr:installer.windows.check_connection_branch' { return ('V' + [char]0x00E9 + 'rifie ta connexion et la branche (%s).') }
    'fr:installer.windows.config_db_agents' { return '(configuration, db, agents)' }
    'fr:installer.windows.container_mode_active' { return 'Mode conteneur actif.' }
    'fr:installer.windows.cvs_attachments_output' { return ('(CV, pi' + [char]0x00E8 + 'ces jointes, r' + [char]0x00E9 + 'sultats)') }
    'fr:installer.windows.delete_data_as_well' { return ('Pour effacer aussi tes donn' + [char]0x00E9 + 'es (configuration, db, CV, r' + [char]0x00E9 + 'sultats) :') }
    'fr:installer.windows.docker_desktop_volumes_old' { return ('Dans Docker Desktop, les volumes de l''ancienne ' + [char]0x00E9 + 'quipe restent : les outils des providers et, selon la version, la cl' + [char]0x00E9 + ' API gard' + [char]0x00E9 + 'e par la configuration, le mot de passe mail et les tokens Telegram. La nouvelle ' + [char]0x00E9 + 'quipe ne les lit pas : redonne-les avec jht setup. Si tu n''en as plus besoin :') }
    'fr:installer.windows.download_failed' { return ('' + [char]0x00C9 + 'chec du t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement : %s') }
    'fr:installer.windows.downloading_enabling_podman_runtime' { return ('T' + [char]0x00E9 + 'l' + [char]0x00E9 + 'chargement et activation du runtime Podman') }
    'fr:installer.windows.earlier_job_hunter_team' { return ('un ancien Job Hunter Team tourne encore sur Docker Desktop (conteneur %s). Depuis la 0.4, l''' + [char]0x00E9 + 'quipe tourne dans une machine Podman : install' + [char]0x00E9 + 'es c' + [char]0x00F4 + 'te ' + [char]0x00E0 + ' c' + [char]0x00F4 + 'te, deux ' + [char]0x00E9 + 'quipes travailleraient sur les m' + [char]0x00EA + 'mes donn' + [char]0x00E9 + 'es. Rien n''a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' modifi' + [char]0x00E9 + '.') }
    'fr:installer.windows.earlier_job_hunter_team_2' { return ('un ancien Job Hunter Team est encore install' + [char]0x00E9 + ' sur Docker Desktop (conteneur %s, arr' + [char]0x00EA + 't' + [char]0x00E9 + ' ; il red' + [char]0x00E9 + 'marre avec Docker Desktop). Depuis la 0.4, l''' + [char]0x00E9 + 'quipe tourne dans une machine Podman : install' + [char]0x00E9 + 'es c' + [char]0x00F4 + 'te ' + [char]0x00E0 + ' c' + [char]0x00F4 + 'te, deux ' + [char]0x00E9 + 'quipes travailleraient sur les m' + [char]0x00EA + 'mes donn' + [char]0x00E9 + 'es. Rien n''a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' modifi' + [char]0x00E9 + '.') }
    'fr:installer.windows.header_pairing' { return ('appairage : token pr' + [char]0x00E9 + 'sent (saute l''assistant)') }
    'fr:installer.windows.host_env_written' { return ('host.env ' + [char]0x00E9 + 'crit :') }
    'fr:installer.windows.image' { return 'image :   ' }
    'fr:installer.windows.image_free_disk' { return ('Et son image, pour lib' + [char]0x00E9 + 'rer le disque :') }
    'fr:installer.windows.install_may_not_know' { return ('l''installation et ne les conna' + [char]0x00EE + 't peut-' + [char]0x00EA + 'tre pas encore ("n''est pas reconnu comme nom d''applet de commande").') }
    'fr:installer.windows.installation_complete' { return '|  Installation terminee !                 |' }
    'fr:installer.windows.jht_podman_are_your' { return ('jht et podman sont dans ton PATH d' + [char]0x00E8 + 's maintenant, mais CETTE fen' + [char]0x00EA + 'tre PowerShell ' + [char]0x00E9 + 'tait ouverte avant') }
    'fr:installer.windows.launching_setup_wizard' { return 'Lancement de l''assistant de configuration...' }
    'fr:installer.windows.mode_podman_machine_wsl' { return 'mode :    machine Podman (WSL)' }
    'fr:installer.windows.next_steps' { return ('' + [char]0x00C9 + 'tapes suivantes :') }
    'fr:installer.windows.only_windows' { return 'install.ps1 ne prend en charge que Windows. Sur Linux/macOS, utilise install.sh.' }
    'fr:installer.windows.open_new_powershell_window' { return ('Ouvre une NOUVELLE fen' + [char]0x00EA + 'tre PowerShell pour utiliser jht et podman. Pas besoin de red' + [char]0x00E9 + 'marrer l''ordinateur.') }
    'fr:installer.windows.override_lacks_keep_id' { return ('L''override Podman t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charg' + [char]0x00E9 + ' n''a pas keep-id.') }
    'fr:installer.windows.pairing_token_present_skipping' { return ('Token d''appairage pr' + [char]0x00E9 + 'sent : je saute l''assistant interactif. Le conteneur terminera l''appairage ' + [char]0x00E0 + ' son premier d' + [char]0x00E9 + 'marrage.') }
    'fr:installer.windows.pairing_token_saved' { return ('Token d''appairage enregistr' + [char]0x00E9 + ' :') }
    'fr:installer.windows.podman.check_wsl' { return ('La ligne ci-dessus dit pourquoi. V' + [char]0x00E9 + 'rifie que WSL fonctionne : lance "wsl --status" dans PowerShell.') }
    'fr:installer.windows.podman.from_desktop' { return ('La ligne ci-dessus dit pourquoi. Lance l''installeur depuis le bureau Windows de cet utilisateur (le menu D' + [char]0x00E9 + 'marrer, Windows PowerShell), pas depuis ssh, un service ou une t' + [char]0x00E2 + 'che planifi' + [char]0x00E9 + 'e : ceux-l' + [char]0x00E0 + ' tournent sans bureau.') }
    'fr:installer.windows.podman.install_failed' { return 'Impossible d''installer Podman.' }
    'fr:installer.windows.podman.install_failed_todo' { return ('La ligne ci-dessus dit pourquoi. Podman vient de winget, ou de sa release officielle quand winget n''est pas utilisable : v' + [char]0x00E9 + 'rifie que cet ordinateur peut joindre github.com, et que winget fonctionne si tu l''as (s''il est cass' + [char]0x00E9 + ', installe ou r' + [char]0x00E9 + 'pare "App Installer" : https://aka.ms/getwinget).') }
    'fr:installer.windows.podman.machine_failed' { return ('Impossible de cr' + [char]0x00E9 + 'er ou de d' + [char]0x00E9 + 'marrer la machine Podman de Job Hunter Team.') }
    'fr:installer.windows.podman.network_not_ready' { return ('La machine Podman a d' + [char]0x00E9 + 'marr' + [char]0x00E9 + ', mais son r' + [char]0x00E9 + 'seau n''est pas pr' + [char]0x00EA + 't.') }
    'fr:installer.windows.podman.network_todo' { return ('La ligne ci-dessus dit pourquoi. Attends une minute et relance la m' + [char]0x00EA + 'me commande d''installation ; si elle s''arr' + [char]0x00EA + 'te encore ici, red' + [char]0x00E9 + 'marre d''abord Windows.') }
    'fr:installer.windows.podman.other_user' { return ('Podman est install' + [char]0x00E9 + ' pour un autre utilisateur Windows de cet ordinateur.') }
    'fr:installer.windows.podman.other_user_todo' { return ('Lance l''installeur avec cet utilisateur Windows, ou supprime Podman pour tout l''ordinateur (Param' + [char]0x00E8 + 'tres > Applications) et relance la commande d''installation.') }
    'fr:installer.windows.podman.other_version' { return ('Une autre version de Podman est install' + [char]0x00E9 + 'e sur cet ordinateur.') }
    'fr:installer.windows.podman.restart_pending' { return ('Si un red' + [char]0x00E9 + 'marrage de Windows est en attente, red' + [char]0x00E9 + 'marre.') }
    'fr:installer.windows.podman.restart_then_again' { return ('Seulement s''il s''arr' + [char]0x00EA + 'te encore ici depuis le bureau : red' + [char]0x00E9 + 'marre Windows, puis relance-le une fois de plus.') }
    'fr:installer.windows.podman.run_again' { return ('Puis relance la m' + [char]0x00EA + 'me commande d''installation : elle repart du d' + [char]0x00E9 + 'but.') }
    'fr:installer.windows.podman.runs_on_6' { return 'Job Hunter Team tourne sur Podman 6 et ne modifie pas un autre Podman.' }
    'fr:installer.windows.podman.sshproxy' { return ('Podman a d' + [char]0x00E9 + 'marr' + [char]0x00E9 + ' la machine, mais sa connexion pour les outils Docker (win-sshproxy.exe) n''a pas d' + [char]0x00E9 + 'marr' + [char]0x00E9 + '.') }
    'fr:installer.windows.podman.stopped' { return ('La configuration de Podman s''est arr' + [char]0x00EA + 't' + [char]0x00E9 + 'e (code de sortie %s).') }
    'fr:installer.windows.podman.stopped_todo' { return ('La ligne ci-dessus dit pourquoi. Relance la m' + [char]0x00EA + 'me commande d''installation ; si elle s''arr' + [char]0x00EA + 'te au m' + [char]0x00EA + 'me endroit, garde cette ligne et demande de l''aide.') }
    'fr:installer.windows.podman.update_or_remove' { return ('Mets-le ' + [char]0x00E0 + ' jour vers la version 6, ou supprime-le (Param' + [char]0x00E8 + 'tres > Applications), comme tu pr' + [char]0x00E9 + 'f' + [char]0x00E8 + 'res.') }
    'fr:installer.windows.podman_machine_windows_user' { return 'Machine Podman de cet utilisateur Windows :' }
    'fr:installer.windows.powershell_too_old' { return 'PowerShell 5.1+ requis (version actuelle : %s). Installe PowerShell 7 : https://aka.ms/PowerShell' }
    'fr:installer.windows.registering_user_path' { return 'Enregistrement du PATH utilisateur' }
    'fr:installer.windows.reparse_ancestor' { return ('Le chemin prot' + [char]0x00E9 + 'g' + [char]0x00E9 + ' sur l''h' + [char]0x00F4 + 'te a au-dessus de lui un point d''analyse (reparse point) : %s') }
    'fr:installer.windows.runtime_artifact_missing' { return 'Artefact du runtime Podman manquant : %s' }
    'fr:installer.windows.runtime_overlaps' { return ('Le chemin prot' + [char]0x00E9 + 'g' + [char]0x00E9 + ' du runtime sur l''h' + [char]0x00F4 + 'te chevauche un dossier que le conteneur peut ' + [char]0x00E9 + 'crire : %s') }
    'fr:installer.windows.setup_wizard_also_starts' { return ('assistant de configuration (d' + [char]0x00E9 + 'marre aussi le conteneur)') }
    'fr:installer.windows.stop_remove_old_team' { return ('Arr' + [char]0x00EA + 'te et supprime l''ancienne ' + [char]0x00E9 + 'quipe (Docker Desktop allum' + [char]0x00E9 + '), dans PowerShell :') }
    'fr:installer.windows.system_detection' { return ('D' + [char]0x00E9 + 'tection du syst' + [char]0x00E8 + 'me') }
    'fr:installer.windows.then_run_installer_again' { return 'Puis relance cet installeur.' }
    'fr:installer.windows.token_acl_failed' { return ('' + [char]0x00C9 + 'chec de la restriction des ACL (fichier encore lisible par Users) : %s') }
    'fr:installer.windows.uninstall_keeps_data_jht' { return ('Pour d' + [char]0x00E9 + 'sinstaller (tes donn' + [char]0x00E9 + 'es dans ~/.jht et ~/Documents/Job Hunter Team restent) :') }
    'fr:installer.windows.user_path_updated_effective' { return ('PATH utilisateur mis ' + [char]0x00E0 + ' jour (actif ' + [char]0x00E0 + ' partir du prochain terminal)') }
    'fr:installer.windows.what_do_now' { return 'Que faire maintenant :' }
    'fr:installer.windows.windows_subsystem_linux_check' { return ('V' + [char]0x00E9 + 'rification du Sous-syst' + [char]0x00E8 + 'me Windows pour Linux') }
    'fr:installer.windows.wizard_exited_error_re' { return ('L''assistant s''est termin' + [char]0x00E9 + ' avec une erreur. Relance-le avec : jht setup') }
    'fr:installer.windows.wrapper_lacks_protocol' { return ('Le wrapper t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charg' + [char]0x00E9 + ' n''a pas le protocole prot' + [char]0x00E9 + 'g' + [char]0x00E9 + ' du runtime.') }
    'fr:installer.windows.wrapper_overlaps' { return ('Le chemin prot' + [char]0x00E9 + 'g' + [char]0x00E9 + ' du wrapper sur l''h' + [char]0x00F4 + 'te chevauche un dossier que le conteneur peut ' + [char]0x00E9 + 'crire : %s') }
    'fr:installer.windows.writing_host_env' { return ('' + [char]0x00C9 + 'criture de host.env') }
    'fr:installer.windows.wsl_ready' { return ('WSL est pr' + [char]0x00EA + 't') }
    'fr:installer.windows.your_data_stays_jht' { return ('Tes donn' + [char]0x00E9 + 'es restent : ~/.jht (configuration, base de donn' + [char]0x00E9 + 'es, profil) et Documents\Job Hunter Team (CV, r' + [char]0x00E9 + 'sultats) sont des dossiers de cet ordinateur, et la nouvelle ' + [char]0x00E9 + 'quipe les utilise.') }
    'pt:installer.check.compose_boundary' { return ('O docker-compose.yml descarregado n' + [char]0x00E3 + 'o aplica a fronteira protegida do runtime.') }
    'pt:installer.windows.acl_failed' { return ('A verifica' + [char]0x00E7 + [char]0x00E3 + 'o das permiss' + [char]0x00F5 + 'es (ACL) de JHT_HOME falhou depois da repara' + [char]0x00E7 + [char]0x00E3 + 'o: %s') }
    'pt:installer.windows.agents_only_see' { return ('Os agentes s' + [char]0x00F3 + ' veem:') }
    'pt:installer.windows.already_user_path' { return ('j' + [char]0x00E1 + ' est' + [char]0x00E1 + ' no PATH do utilizador') }
    'pt:installer.windows.branch' { return 'ramo:   ' }
    'pt:installer.windows.branch_unresolved' { return ('N' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel associar o ramo ''%s'' a um commit de vers' + [char]0x00E3 + 'o imut' + [char]0x00E1 + 'vel.') }
    'pt:installer.windows.check_connection_branch' { return ('Verifica a liga' + [char]0x00E7 + [char]0x00E3 + 'o e o ramo (%s).') }
    'pt:installer.windows.config_db_agents' { return ('(configura' + [char]0x00E7 + [char]0x00E3 + 'o, db, agentes)') }
    'pt:installer.windows.container_mode_active' { return 'Modo contentor ativo.' }
    'pt:installer.windows.cvs_attachments_output' { return '(CV, anexos, resultados)' }
    'pt:installer.windows.delete_data_as_well' { return ('Para apagar tamb' + [char]0x00E9 + 'm os dados (configura' + [char]0x00E7 + [char]0x00E3 + 'o, db, CV, resultados):') }
    'pt:installer.windows.docker_desktop_volumes_old' { return ('No Docker Desktop ficam os volumes da equipa antiga: ferramentas dos fornecedores e, conforme a vers' + [char]0x00E3 + 'o, a chave API guardada pela configura' + [char]0x00E7 + [char]0x00E3 + 'o, a palavra-passe do correio e os tokens do Telegram. A nova equipa n' + [char]0x00E3 + 'o os l' + [char]0x00EA + ': volta a d' + [char]0x00E1 + '-los com jht setup. Se j' + [char]0x00E1 + ' n' + [char]0x00E3 + 'o precisas deles:') }
    'pt:installer.windows.download_failed' { return 'O descarregamento falhou: %s' }
    'pt:installer.windows.downloading_enabling_podman_runtime' { return 'A descarregar e a ativar o runtime Podman' }
    'pt:installer.windows.earlier_job_hunter_team' { return ('uma vers' + [char]0x00E3 + 'o anterior do Job Hunter Team ainda est' + [char]0x00E1 + ' a correr no Docker Desktop (contentor %s). Desde a 0.4 a equipa corre numa m' + [char]0x00E1 + 'quina Podman: instalada ao lado, haveria duas equipas a trabalhar sobre os mesmos dados. N' + [char]0x00E3 + 'o foi alterado nada.') }
    'pt:installer.windows.earlier_job_hunter_team_2' { return ('uma vers' + [char]0x00E3 + 'o anterior do Job Hunter Team ainda est' + [char]0x00E1 + ' instalada no Docker Desktop (contentor %s, parado; volta a arrancar com o Docker Desktop). Desde a 0.4 a equipa corre numa m' + [char]0x00E1 + 'quina Podman: instalada ao lado, haveria duas equipas a trabalhar sobre os mesmos dados. N' + [char]0x00E3 + 'o foi alterado nada.') }
    'pt:installer.windows.header_pairing' { return 'emparelhamento: token presente (salta o assistente)' }
    'pt:installer.windows.host_env_written' { return 'host.env escrito:' }
    'pt:installer.windows.image' { return 'imagem: ' }
    'pt:installer.windows.image_free_disk' { return 'E a sua imagem, para libertar o disco:' }
    'pt:installer.windows.install_may_not_know' { return ('instala' + [char]0x00E7 + [char]0x00E3 + 'o e pode ainda n' + [char]0x00E3 + 'o os conhecer ("not recognized as the name of a cmdlet").') }
    'pt:installer.windows.installation_complete' { return '|  Instalacao concluida!                   |' }
    'pt:installer.windows.jht_podman_are_your' { return ('A partir de agora o jht e o podman est' + [char]0x00E3 + 'o no teu PATH, mas ESTA janela do PowerShell j' + [char]0x00E1 + ' estava aberta antes da') }
    'pt:installer.windows.launching_setup_wizard' { return ('A iniciar a configura' + [char]0x00E7 + [char]0x00E3 + 'o guiada...') }
    'pt:installer.windows.mode_podman_machine_wsl' { return ('modo:    m' + [char]0x00E1 + 'quina Podman (WSL)') }
    'pt:installer.windows.next_steps' { return ('Pr' + [char]0x00F3 + 'ximos passos:') }
    'pt:installer.windows.only_windows' { return ('O install.ps1 s' + [char]0x00F3 + ' funciona no Windows. No Linux/macOS usa o install.sh.') }
    'pt:installer.windows.open_new_powershell_window' { return ('Abre uma NOVA janela do PowerShell para usar o jht e o podman. N' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' preciso reiniciar o computador.') }
    'pt:installer.windows.override_lacks_keep_id' { return ('O ficheiro do Podman descarregado (docker-compose.podman.yml) n' + [char]0x00E3 + 'o tem keep-id.') }
    'pt:installer.windows.pairing_token_present_skipping' { return 'Token de emparelhamento presente: vou saltar o assistente interativo. O contentor vai concluir o emparelhamento no primeiro arranque.' }
    'pt:installer.windows.pairing_token_saved' { return 'Token de emparelhamento guardado:' }
    'pt:installer.windows.podman.check_wsl' { return ('A linha acima diz porqu' + [char]0x00EA + '. Verifica que o WSL funciona: corre "wsl --status" no PowerShell.') }
    'pt:installer.windows.podman.from_desktop' { return ('A linha acima diz porqu' + [char]0x00EA + '. Corre o instalador a partir do ambiente de trabalho do Windows deste utilizador (o menu Iniciar, Windows PowerShell), n' + [char]0x00E3 + 'o a partir do ssh, de um servi' + [char]0x00E7 + 'o ou de uma tarefa agendada: esses correm sem ambiente de trabalho.') }
    'pt:installer.windows.podman.install_failed' { return ('N' + [char]0x00E3 + 'o foi poss' + [char]0x00ED + 'vel instalar o Podman.') }
    'pt:installer.windows.podman.install_failed_todo' { return ('A linha acima diz porqu' + [char]0x00EA + '. O Podman vem do winget, ou da sua vers' + [char]0x00E3 + 'o oficial quando n' + [char]0x00E3 + 'o ' + [char]0x00E9 + ' poss' + [char]0x00ED + 'vel usar o winget: verifica que este computador consegue chegar a github.com, e que o winget funciona se o tiveres (se estiver avariado, instala ou repara o "App Installer": https://aka.ms/getwinget).') }
    'pt:installer.windows.podman.machine_failed' { return ('N' + [char]0x00E3 + 'o foi poss' + [char]0x00ED + 'vel criar ou iniciar a m' + [char]0x00E1 + 'quina Podman do Job Hunter Team.') }
    'pt:installer.windows.podman.network_not_ready' { return ('A m' + [char]0x00E1 + 'quina Podman arrancou, mas a sua rede n' + [char]0x00E3 + 'o est' + [char]0x00E1 + ' pronta.') }
    'pt:installer.windows.podman.network_todo' { return ('A linha acima diz porqu' + [char]0x00EA + '. Espera um minuto e corre o mesmo comando de instala' + [char]0x00E7 + [char]0x00E3 + 'o de novo; se parar aqui outra vez, reinicia primeiro o Windows.') }
    'pt:installer.windows.podman.other_user' { return ('O Podman est' + [char]0x00E1 + ' instalado para outro utilizador do Windows deste computador.') }
    'pt:installer.windows.podman.other_user_todo' { return ('Corre o instalador como esse utilizador do Windows, ou remove o Podman do computador (Defini' + [char]0x00E7 + [char]0x00F5 + 'es > Aplica' + [char]0x00E7 + [char]0x00F5 + 'es) e corre o comando de instala' + [char]0x00E7 + [char]0x00E3 + 'o de novo.') }
    'pt:installer.windows.podman.other_version' { return ('Est' + [char]0x00E1 + ' instalada outra vers' + [char]0x00E3 + 'o do Podman neste computador.') }
    'pt:installer.windows.podman.restart_pending' { return ('Se o Windows estiver ' + [char]0x00E0 + ' espera de um rein' + [char]0x00ED + 'cio, reinicia-o.') }
    'pt:installer.windows.podman.restart_then_again' { return ('S' + [char]0x00F3 + ' se parar aqui outra vez a partir do ambiente de trabalho: reinicia o Windows e depois corre-o mais uma vez.') }
    'pt:installer.windows.podman.run_again' { return ('Depois corre o mesmo comando de instala' + [char]0x00E7 + [char]0x00E3 + 'o de novo: recome' + [char]0x00E7 + 'a do in' + [char]0x00ED + 'cio.') }
    'pt:installer.windows.podman.runs_on_6' { return ('O Job Hunter Team corre no Podman 6 e n' + [char]0x00E3 + 'o altera outro Podman.') }
    'pt:installer.windows.podman.sshproxy' { return ('O Podman iniciou a m' + [char]0x00E1 + 'quina, mas a sua liga' + [char]0x00E7 + [char]0x00E3 + 'o para as ferramentas Docker (win-sshproxy.exe) n' + [char]0x00E3 + 'o arrancou.') }
    'pt:installer.windows.podman.stopped' { return ('A prepara' + [char]0x00E7 + [char]0x00E3 + 'o do Podman parou (c' + [char]0x00F3 + 'digo de sa' + [char]0x00ED + 'da %s).') }
    'pt:installer.windows.podman.stopped_todo' { return ('A linha acima diz porqu' + [char]0x00EA + '. Corre o mesmo comando de instala' + [char]0x00E7 + [char]0x00E3 + 'o de novo; se parar no mesmo s' + [char]0x00ED + 'tio, guarda essa linha e pede ajuda.') }
    'pt:installer.windows.podman.update_or_remove' { return ('Atualiza-o para a vers' + [char]0x00E3 + 'o 6, ou remove-o (Defini' + [char]0x00E7 + [char]0x00F5 + 'es > Aplica' + [char]0x00E7 + [char]0x00F5 + 'es), como preferires.') }
    'pt:installer.windows.podman_machine_windows_user' { return ('M' + [char]0x00E1 + 'quina Podman deste utilizador do Windows:') }
    'pt:installer.windows.powershell_too_old' { return ('' + [char]0x00C9 + ' preciso o PowerShell 5.1 ou posterior (vers' + [char]0x00E3 + 'o atual: %s). Instala o PowerShell 7: https://aka.ms/PowerShell') }
    'pt:installer.windows.registering_user_path' { return 'A registar o PATH do utilizador' }
    'pt:installer.windows.reparse_ancestor' { return ('Um caminho protegido do anfitri' + [char]0x00E3 + 'o tem acima de si um reparse point (uma liga' + [char]0x00E7 + [char]0x00E3 + 'o): %s') }
    'pt:installer.windows.runtime_artifact_missing' { return 'Falta um ficheiro do runtime Podman: %s' }
    'pt:installer.windows.runtime_overlaps' { return ('O caminho protegido do runtime no anfitri' + [char]0x00E3 + 'o sobrep' + [char]0x00F5 + 'e-se a uma ' + [char]0x00E1 + 'rvore que o contentor pode escrever: %s') }
    'pt:installer.windows.setup_wizard_also_starts' { return ('configura' + [char]0x00E7 + [char]0x00E3 + 'o guiada (tamb' + [char]0x00E9 + 'm inicia o contentor)') }
    'pt:installer.windows.stop_remove_old_team' { return 'Para e remove a equipa antiga (com o Docker Desktop ligado), no PowerShell:' }
    'pt:installer.windows.system_detection' { return ('Dete' + [char]0x00E7 + [char]0x00E3 + 'o do sistema') }
    'pt:installer.windows.then_run_installer_again' { return 'Depois corre este instalador de novo.' }
    'pt:installer.windows.token_acl_failed' { return ('A restri' + [char]0x00E7 + [char]0x00E3 + 'o das permiss' + [char]0x00F5 + 'es (ACL) falhou (o ficheiro ainda pode ser lido pelo grupo Users): %s') }
    'pt:installer.windows.uninstall_keeps_data_jht' { return 'Para desinstalar (os dados em ~/.jht e ~/Documents/Job Hunter Team ficam):' }
    'pt:installer.windows.user_path_updated_effective' { return ('PATH do utilizador atualizado (vale a partir do pr' + [char]0x00F3 + 'ximo terminal)') }
    'pt:installer.windows.what_do_now' { return 'O que fazer agora:' }
    'pt:installer.windows.windows_subsystem_linux_check' { return ('Verifica' + [char]0x00E7 + [char]0x00E3 + 'o do Subsistema Windows para Linux') }
    'pt:installer.windows.wizard_exited_error_re' { return ('A configura' + [char]0x00E7 + [char]0x00E3 + 'o guiada terminou com um erro. Corre-a de novo com: jht setup') }
    'pt:installer.windows.wrapper_lacks_protocol' { return ('O wrapper descarregado n' + [char]0x00E3 + 'o tem o protocolo protegido do runtime.') }
    'pt:installer.windows.wrapper_overlaps' { return ('O caminho protegido do wrapper no anfitri' + [char]0x00E3 + 'o sobrep' + [char]0x00F5 + 'e-se a uma ' + [char]0x00E1 + 'rvore que o contentor pode escrever: %s') }
    'pt:installer.windows.writing_host_env' { return 'A escrever host.env' }
    'pt:installer.windows.wsl_ready' { return ('O WSL est' + [char]0x00E1 + ' pronto') }
    'pt:installer.windows.your_data_stays_jht' { return ('Os teus dados ficam: ~/.jht (configura' + [char]0x00E7 + [char]0x00E3 + 'o, base de dados, perfil) e Documents\Job Hunter Team (CV, resultados) s' + [char]0x00E3 + 'o pastas deste computador, e a nova equipa usa-as.') }
  }
  return $null
}
# <<< texts in the 7 languages
function Get-Windows10SupportWarning {
  # install.ps1 deliberately stays ASCII: Windows PowerShell 5.1 reads a
  # BOM-less script in the legacy console encoding. The desktop has the full
  # translated copy; this is what a person sees when running the downloaded file.
  param([string]$Language = (Get-JhtTextLanguage))
  switch ($Language.ToLowerInvariant()) {
    'it' { return "Podman non supporta piu' Windows 10: puo' funzionare, ma non lo garantiamo. Il sistema supportato e' Windows 11." }
    'de' { return 'Podman unterstuetzt Windows 10 nicht mehr: Es kann funktionieren, aber wir garantieren es nicht. Unterstuetzt wird Windows 11.' }
    'es' { return 'Podman ya no es compatible con Windows 10: puede funcionar, pero no lo garantizamos. El sistema compatible es Windows 11.' }
    'fr' { return 'Podman ne prend plus en charge Windows 10 : cela peut fonctionner, mais nous ne le garantissons pas. Le systeme pris en charge est Windows 11.' }
    'hu' { return 'A Podman mar nem tamogatja a Windows 10-et: mukodhet, de nem garantaljuk. A tamogatott rendszer a Windows 11.' }
    'pt' { return 'O Podman ja nao suporta o Windows 10: pode funcionar, mas nao o garantimos. O sistema suportado e o Windows 11.' }
    default { return 'Podman no longer supports Windows 10: it may work, but we do not guarantee it. The supported system is Windows 11.' }
  }
}
function Show-WindowsSupportNotice {
  $edition = Get-JhtWindowsEdition
  if (-not $edition) { return }
  if (Test-JhtWindows10Client -ProductType $edition.ProductType -Build $edition.Build) {
    Write-Warn (Get-Windows10SupportWarning)
    Write-JhtNotice windows10_unsupported
  }
}

# ── Step 2: WSL check ─────────────────────────────────────────────────────
function Test-WindowsSubsystem {
  Write-Step 2 $TotalSteps (Ts 'installer.windows.windows_subsystem_linux_check' 'Windows Subsystem for Linux check')
  Write-JhtPhase wsl_check
  if ($DryRun) { Write-Dry 'wsl.exe --status'; return }
  $wsl = Get-Command wsl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $wsl) { [Console]::Error.WriteLine('wsl_not_ready: wsl.exe is unavailable'); exit 20 }
  # under 'Stop', Windows PowerShell 5.1 would turn a line of wsl's stderr into an error, not exit 20 (T82)
  $null = & { $ErrorActionPreference = 'Continue'; & $wsl.Source --status 2>&1 }
  if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine('wsl_not_ready: WSL is not usable'); exit 20 }
  Write-Ok (Ts 'installer.windows.wsl_ready' 'WSL is ready')
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
    Write-Fail ((Tsf 'installer.windows.download_failed' 'Download failed: %s' $Url) + "`n  $($_.Exception.Message)`n  " + (Tsf 'installer.windows.check_connection_branch' 'Check your connection and branch (%s).' $Branch))
  }
}

# One Podman machine per Windows user (JHT-T305). The pipe a machine opens is named after it (\\.\pipe\podman-<machine>) and is
# global to the computer: with a fixed name, the second user's installer found the pipe held by the first one's machine and stopped.
# A user who has none gets jht-podman-<8 hex of the SHA-256 of their SID>: the same for the same user, another for every other.
# (The same function is in the uninstall of the wrapper and in the one of the app: tests/test_windows_machine_per_user.py keeps them equal.)
function Get-JhtUserMachineName {
  param([string]$Sid = '')
  if (-not $Sid) { try { $Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value } catch { $Sid = '' } }
  if ($Sid -notmatch '^S-1-\d+(-\d+)+$') { return 'jht-podman' }
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::ASCII.GetBytes($Sid))
  return 'jht-podman-' + (([BitConverter]::ToString($hash, 0, 4) -replace '-', '').ToLowerInvariant())
}

# The machine this install uses: the one an earlier install of THIS user attested (the podman-machine file of the runtime: an old
# install says jht-podman and keeps it), else a jht-podman machine this user already has (Podman machines belong to the user), else
# the one of their own name. $ExistingMachines: the names `podman machine list` gives this user.
function Resolve-JhtPodmanMachineName {
  param([string]$RuntimePath, [string[]]$ExistingMachines = @(), [string]$Sid = '')
  $attested = ''
  try { $attested = ([IO.File]::ReadAllText((Join-Path $RuntimePath 'podman-machine'))).Trim() } catch { $attested = '' }
  if ($attested -cmatch '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$') { return $attested }
  if (@($ExistingMachines) -ccontains 'jht-podman') { return 'jht-podman' }
  return (Get-JhtUserMachineName -Sid $Sid)
}

# The names of this user's Podman machines, or none when Podman is not there yet (the enabler installs it) or does not answer.
function Get-JhtExistingMachineNames {
  $podman = Get-Command podman.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $path = if ($podman) { $podman.Source } else { '' }
  if (-not $path) {
    foreach ($folder in @((Join-Path $env:LOCALAPPDATA 'Programs\Podman'), (Join-Path $env:ProgramFiles 'RedHat\Podman'))) {
      if ($folder -and (Test-Path -LiteralPath (Join-Path $folder 'podman.exe'))) { $path = Join-Path $folder 'podman.exe'; break }
    }
  }
  if (-not $path) { return @() }
  try {
    $raw = ((& { $ErrorActionPreference = 'Continue'; & $path machine list --format json 2>$null }) -join '')
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return @() }
    return @(foreach ($listed in (ConvertFrom-Json -InputObject $raw)) { [string]$listed.Name })
  } catch { return @() }
}

function Invoke-PodmanRuntimeEnabler {
  param([Parameter(Mandatory)][string]$ScriptPath)
  $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $machineName = Resolve-JhtPodmanMachineName -RuntimePath $RuntimeDir -ExistingMachines (Get-JhtExistingMachineNames)
  Write-Info "$(Ts 'installer.windows.podman_machine_windows_user' 'Podman machine of this Windows user:') $machineName"
  $enablerArgs = @(
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', $ScriptPath, '-MachineName', $machineName, '-InitializeMachine',
    '-RuntimeImage', $RuntimeImage, '-ExpectedImageDigest', $RuntimeImageDigest
  )
  # docker-compose.exe is the runtime's own, which the enabler always
  # downloads and verifies: only Podman comes from winget.
  if (-not (Get-Command podman.exe -CommandType Application -ErrorAction SilentlyContinue)) {
    $enablerArgs += '-InstallDependencies'
  }
  if ($TestChannel) { $enablerArgs += '-PersistImagePin' }
  if ($TestChannel -and $ExtrasImageDigest) { $enablerArgs += @('-ExtrasImageDigest', $ExtrasImageDigest) }
  if ($RuntimeTier) { $enablerArgs += @('-RuntimeTier', $RuntimeTier) }
  $oldRuntimeDir = $env:JHT_RUNTIME_DIR
  $oldBinDir = $env:JHT_BIN_DIR
  $oldMachineOutput = $env:JHT_MACHINE_OUTPUT
  $oldLang = $env:JHT_LANG
  $oldTz = $env:JHT_USER_TZ
  try {
    $env:JHT_RUNTIME_DIR = $RuntimeDir
    $env:JHT_BIN_DIR = $BinDir
    # The enabler's `jht up` makes the container before step 5 writes host.env: without these it was made with the wrapper's
    # defaults (English, UTC) and kept them, so jht setup proposed English and wrote the hours in UTC. The same values host.env gets.
    $env:JHT_LANG = Get-JhtPersonLanguage
    $env:JHT_USER_TZ = Get-JhtInstallTimezone
    # The enabler's output comes back through this script, so it cannot tell on
    # its own whether a person or the app is reading: it is told.
    $machineOutput = if ($env:JHT_MACHINE_OUTPUT -eq '1') { $true } elseif ($env:JHT_MACHINE_OUTPUT -eq '0') { $false } else { [Console]::IsOutputRedirected }
    $env:JHT_MACHINE_OUTPUT = if ($machineOutput) { '1' } else { '0' }
    & $powerShell @enablerArgs
    $code = $LASTEXITCODE
  } finally {
    $env:JHT_RUNTIME_DIR = $oldRuntimeDir
    $env:JHT_BIN_DIR = $oldBinDir
    $env:JHT_MACHINE_OUTPUT = $oldMachineOutput
    $env:JHT_LANG = $oldLang
    $env:JHT_USER_TZ = $oldTz
  }
  # The caller leaves with it once the staging folder is gone and the empty
  # folders of this run are removed.
  # An enabler that left without a code did not succeed: no code is 1, never a go-on.
  $script:EnablerExitCode = if ($null -eq $code) { 1 } else { $code }
}

# What the person does next, for the codes the enabler leaves with. The reason
# itself is the line the enabler wrote on stderr just above.
function Show-PodmanSetupProblem {
  param([int]$Code)
  $again = (Ts 'installer.windows.podman.run_again' 'Then run the same install command again: it starts over from the beginning.')
  switch ($Code) {
    21 {
      Write-JhtProblem -What (Ts 'installer.windows.podman.install_failed' 'Podman could not be installed.') -Todo @(
        (Ts 'installer.windows.podman.install_failed_todo' 'The line above says why. Podman comes from winget, or from its official release when winget cannot be used: check that this computer can reach github.com, and that winget works if you have it (for a broken one, install or repair "App Installer": https://aka.ms/getwinget).'),
        $again)
    }
    22 {
      Write-JhtProblem -What (Ts 'installer.windows.podman.machine_failed' 'The Podman machine of Job Hunter Team could not be created or started.') -Todo @(
        (Ts 'installer.windows.podman.check_wsl' 'The line above says why. Check that WSL works: run "wsl --status" in PowerShell.'),
        (Ts 'installer.windows.podman.restart_pending' 'If a restart of Windows is pending, restart it.'),
        $again)
    }
    23 {
      Write-JhtProblem -What (Ts 'installer.windows.podman.network_not_ready' 'The Podman machine started but its network is not ready.') -Todo @(
        (Ts 'installer.windows.podman.network_todo' 'The line above says why. Wait a minute and run the same install command again; if it stops here again, restart Windows first.'))
    }
    24 {
      Write-JhtProblem -What (Ts 'installer.windows.podman.other_version' 'Another Podman version is installed on this computer.') -Todo @(
        (Ts 'installer.windows.podman.runs_on_6' 'Job Hunter Team runs on Podman 6 and does not change another Podman.'),
        (Ts 'installer.windows.podman.update_or_remove' 'Update it to version 6, or remove it (Settings > Apps), whichever you prefer.'),
        $again)
    }
    25 {
      Write-JhtProblem -What (Ts 'installer.windows.podman.other_user' 'Podman is installed for another Windows user of this computer.') -Todo @(
        (Ts 'installer.windows.podman.other_user_todo' 'Run the installer as that Windows user, or remove Podman for the computer (Settings > Apps) and run the install command again.'))
    }
    26 {
      Write-JhtProblem -What (Ts 'installer.windows.podman.sshproxy' 'Podman started the machine, but its connection for Docker tools (win-sshproxy.exe) did not start.') -Todo @(
        (Ts 'installer.windows.podman.from_desktop' 'The line above says why. Run the installer from the Windows desktop of this user (the Start menu, Windows PowerShell), not from ssh, a service or a scheduled task: those run without a desktop.'),
        $again,
        (Ts 'installer.windows.podman.restart_then_again' 'Only if it stops here again from the desktop: restart Windows, then run it once more.'))
    }
    default {
      Write-JhtProblem -What (Tsf 'installer.windows.podman.stopped' 'The Podman setup stopped (exit code %s).' $Code) -Todo @(
        (Ts 'installer.windows.podman.stopped_todo' 'The line above says why. Run the same install command again; if it stops at the same place, keep that line and ask for help.'))
    }
  }
}

function Test-JhtDownloadedRuntimeScripts {
  param([string]$ScriptsPath)
  foreach ($ps1 in @('jht-wrapper.ps1', 'windows-private-acl.ps1', 'enable-podman-windows-runtime.ps1', 'configure-podman-windows-network.ps1', 'podman-machine-bridge.ps1', 'jht-integration.ps1', 'jht-tools.ps1')) {
    [scriptblock]::Create((Get-Content -LiteralPath (Join-Path $ScriptsPath $ps1) -Raw)) | Out-Null
  }
}

function Get-RuntimeFiles {
  Write-Step 3 $TotalSteps (Ts 'installer.windows.downloading_enabling_podman_runtime' 'Downloading and enabling the Podman runtime')
  Write-JhtPhase runtime_download

  if ($TestChannel) {
    $releaseBase = "https://raw.githubusercontent.com/leopu00/job-hunter-team/$SourceSha"
  } elseif ($RawBaseOverride) {
    $releaseBase = $RawBaseOverride
  } elseif ($DryRun) {
    $releaseBase = "https://raw.githubusercontent.com/leopu00/job-hunter-team/$Branch"
  } else {
    try {
      $metadata = Invoke-RestMethod -UseBasicParsing -Uri "https://api.github.com/repos/leopu00/job-hunter-team/commits/$Branch"
      $sha = [string]$metadata.sha
      if ($sha -notmatch '^[0-9a-fA-F]{40}$') { throw 'invalid release commit' }
      $releaseBase = "https://raw.githubusercontent.com/leopu00/job-hunter-team/$sha"
    } catch { Write-Fail (Tsf 'installer.windows.branch_unresolved' 'Cannot resolve branch ''%s'' to an immutable release commit.' $Branch) }
  }

  if ($DryRun) {
    foreach ($relative in @(
      'docker-compose.yml', 'docker-compose.podman.yml', 'scripts/jht-wrapper.ps1',
      'scripts/windows-private-acl.ps1', 'scripts/enable-podman-windows-runtime.ps1',
      'scripts/configure-podman-windows-network.ps1', 'scripts/podman-machine-bridge.ps1', 'scripts/jht-integration.ps1', 'scripts/jht-tools.ps1', 'scripts/wsl-interop-connect-proxy.py'
    )) { Write-Dry "iwr $releaseBase/$relative" }
    Write-JhtPhase image_pull
    Write-Dry "podman pull $RuntimeImage"
    return
  }

  $runtimeFull = [IO.Path]::GetFullPath($RuntimeDir).TrimEnd('\', '/')
  $legacyFull = [IO.Path]::GetFullPath($JhtHome).TrimEnd('\', '/')
  $userDataHost = if ($env:JHT_USER_DIR_HOST) { $env:JHT_USER_DIR_HOST } else { Join-Path $env:USERPROFILE 'Documents\Job Hunter Team' }
  $userDataFull = [IO.Path]::GetFullPath($userDataHost).TrimEnd('\', '/')
  $binFull = [IO.Path]::GetFullPath($BinDir).TrimEnd('\', '/')
  if ($runtimeFull.Equals($legacyFull, [StringComparison]::OrdinalIgnoreCase) -or $runtimeFull.StartsWith($legacyFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
      $runtimeFull.Equals($userDataFull, [StringComparison]::OrdinalIgnoreCase) -or $runtimeFull.StartsWith($userDataFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Fail (Tsf 'installer.windows.runtime_overlaps' 'Protected host runtime path overlaps a container-writable tree: %s' $runtimeFull)
  }
  if ($binFull.Equals($legacyFull, [StringComparison]::OrdinalIgnoreCase) -or $binFull.StartsWith($legacyFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
      $binFull.Equals($userDataFull, [StringComparison]::OrdinalIgnoreCase) -or $binFull.StartsWith($userDataFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Fail (Tsf 'installer.windows.wrapper_overlaps' 'Protected host wrapper path overlaps a container-writable tree: %s' $binFull)
  }

  # Podman comes from winget, or from its official release for this Windows user when winget is not usable (missing, an empty
  # list of programs, Podman registered for another user): the enabler decides, so a PC without winget is no stop here (JHT-T184).

  # The folders that do not exist yet, with the ones above them: if the setup
  # stops, the ones it made and left empty go away again.
  $script:JhtCreatedDirs = @(foreach ($target in @($RuntimeDir, $BinDir, $JhtHome)) {
    $walk = [IO.Path]::GetFullPath($target).TrimEnd('\', '/')
    while ($walk -and -not (Test-Path -LiteralPath $walk)) { $walk; $walk = Split-Path -Parent $walk }
  }) | Select-Object -Unique
  New-Item -ItemType Directory -Force -Path $RuntimeDir, $BinDir, $JhtHome | Out-Null
  Protect-JhtHomeAcl -Path $JhtHome
  foreach ($protectedPath in @($RuntimeDir, $BinDir)) {
    $current = Get-Item -LiteralPath $protectedPath -Force -ErrorAction Stop
    while ($current) {
      if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Write-Fail (Tsf 'installer.windows.reparse_ancestor' 'Protected host path has a reparse-point ancestor: %s' $protectedPath) }
      $parent = $current.Parent
      if (-not $parent -or $parent.FullName -eq $current.FullName) { break }
      $current = $parent
    }
  }
  $runtimeAcl = Get-Acl -LiteralPath $RuntimeDir
  $runtimeAcl.SetAccessRuleProtection($true, $false)
  $runtimeAcl.SetAccessRule((New-Object Security.AccessControl.FileSystemAccessRule(
    [Security.Principal.WindowsIdentity]::GetCurrent().User,
    'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
  Set-JhtAccessControl -Path $RuntimeDir -Acl $runtimeAcl
  Set-JhtNodeOwner -Path $RuntimeDir

  $stage = Join-Path $RuntimeDir ('.install-stage-' + [guid]::NewGuid().ToString('N'))
  $stageScripts = Join-Path $stage 'scripts'
  New-Item -ItemType Directory -Path $stageScripts -Force | Out-Null
  try {
    $downloads = [ordered]@{
      'docker-compose.yml' = (Join-Path $stage 'docker-compose.yml')
      'docker-compose.podman.yml' = (Join-Path $stage 'docker-compose.podman.yml')
      'scripts/jht-wrapper.ps1' = (Join-Path $stageScripts 'jht-wrapper.ps1')
      'scripts/windows-private-acl.ps1' = (Join-Path $stageScripts 'windows-private-acl.ps1')
      'scripts/enable-podman-windows-runtime.ps1' = (Join-Path $stageScripts 'enable-podman-windows-runtime.ps1')
      'scripts/configure-podman-windows-network.ps1' = (Join-Path $stageScripts 'configure-podman-windows-network.ps1')
      'scripts/podman-machine-bridge.ps1' = (Join-Path $stageScripts 'podman-machine-bridge.ps1')
      'scripts/jht-integration.ps1' = (Join-Path $stageScripts 'jht-integration.ps1')
      'scripts/jht-tools.ps1' = (Join-Path $stageScripts 'jht-tools.ps1')
      'scripts/wsl-interop-connect-proxy.py' = (Join-Path $stageScripts 'wsl-interop-connect-proxy.py')
    }
    foreach ($relative in $downloads.Keys) { Get-File -Url "$releaseBase/$relative" -Dest $downloads[$relative] }
    Test-JhtDownloadedRuntimeScripts -ScriptsPath $stageScripts
    if (-not (Select-String -LiteralPath (Join-Path $stage 'docker-compose.yml') -Pattern '^\s*-\s*jht-runtime-mask:/jht_home/runtime(?:\s|$)' -Quiet)) { Write-Fail (Ts 'installer.check.compose_boundary' 'Downloaded compose does not enforce the protected runtime boundary.') }
    if (-not (Select-String -LiteralPath (Join-Path $stage 'docker-compose.podman.yml') -SimpleMatch 'keep-id:uid=1001,gid=1001' -Quiet)) { Write-Fail (Ts 'installer.windows.override_lacks_keep_id' 'Downloaded Podman override lacks keep-id.') }
    if (-not (Select-String -LiteralPath (Join-Path $stageScripts 'jht-wrapper.ps1') -SimpleMatch '$JHT_HOST_RUNTIME_PROTOCOL = 1' -Quiet)) { Write-Fail (Ts 'installer.windows.wrapper_lacks_protocol' 'Downloaded wrapper lacks the protected runtime protocol.') }
    Invoke-PodmanRuntimeEnabler -ScriptPath (Join-Path $stageScripts 'enable-podman-windows-runtime.ps1')
  } finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($script:EnablerExitCode) {
    Show-PodmanSetupProblem -Code $script:EnablerExitCode
    Remove-JhtCreatedEmptyDirs
    exit $script:EnablerExitCode
  }

  $wrapperDest = Join-Path $BinDir 'jht.ps1'
  $helperDest = Join-Path $BinDir 'windows-private-acl.ps1'
  $shimDest = Join-Path $BinDir 'jht.cmd'
  $publishedNodes = @(
    (Join-Path $RuntimeDir 'docker-compose.yml'),
    (Join-Path $RuntimeDir 'docker-compose.podman.yml'),
    (Join-Path $RuntimeDir 'container-runtime'),
    (Join-Path $RuntimeDir 'podman-machine'),
    (Join-Path $RuntimeDir 'jht-container.service'),
    (Join-Path $RuntimeDir '.runtime-integrity'),
    $wrapperDest,
    $helperDest,
    (Join-Path $BinDir 'podman-machine-bridge.ps1'),
    (Join-Path $RuntimeDir 'jht-integration.ps1'),
    (Join-Path $RuntimeDir 'jht-tools.ps1'),
    (Join-Path $RuntimeDir '.runtime-helpers'),
    (Join-Path $RuntimeDir 'bin\docker.exe')
  )
  $runtimeImageDest = Join-Path $RuntimeDir 'runtime-image'
  if (Test-Path -LiteralPath $runtimeImageDest -PathType Leaf) { $publishedNodes += $runtimeImageDest }
  $runtimeExtrasDest = Join-Path $RuntimeDir 'runtime-extras-image'
  if (Test-Path -LiteralPath $runtimeExtrasDest -PathType Leaf) { $publishedNodes += $runtimeExtrasDest, (Join-Path $RuntimeDir '.runtime-extras-integrity') }
  $runtimeTierDest = Join-Path $RuntimeDir 'runtime-tier'
  if (Test-Path -LiteralPath $runtimeTierDest -PathType Leaf) { $publishedNodes += $runtimeTierDest, (Join-Path $RuntimeDir '.runtime-tier-integrity') }
  foreach ($published in $publishedNodes) {
    if (-not (Test-Path -LiteralPath $published -PathType Leaf)) { Write-Fail (Tsf 'installer.windows.runtime_artifact_missing' 'Podman runtime artifact missing: %s' $published) }
    Set-JhtNodeOwner -Path $published
  }
  . $helperDest
  if (-not (Test-PrivateJhtHomeAcl -Path $JhtHome)) { Write-Fail (Tsf 'installer.windows.acl_failed' 'JHT_HOME ACL verification failed after repair: %s' $JhtHome) }

  # One line each: `(goto) 2>nul` leaves the batch context first, then the rest of the line (already read whole: %~dp0 and %* are
  # expanded) runs jht. cmd reopens a batch file after every command it runs from it, also before `goto :eof` or `exit /b`, and `jht
  # uninstall` deletes this very file while it runs: "cannot find the batch file" and rc 1 after a good uninstall. Out of the batch
  # context there is nothing to reopen, the code of jht arrives intact, and a caller's `call jht` goes on with its errorlevel.
  $shimContent = @"
@echo off
where pwsh.exe >nul 2>&1
if errorlevel 1 goto jht_windows_powershell
(goto) 2>nul & pwsh -NoLogo -ExecutionPolicy Bypass -File "%~dp0jht.ps1" %*
:jht_windows_powershell
(goto) 2>nul & powershell -NoLogo -ExecutionPolicy Bypass -File "%~dp0jht.ps1" %*
"@
  # Taken in place by a temporary file, never written in place: a program that holds the file for a moment must not leave it empty.
  $shimBytes = [Text.Encoding]::ASCII.GetBytes((($shimContent -replace "`r?`n", "`r`n") + "`r`n"))
  Publish-JhtFile -Destination $shimDest -Bytes $shimBytes
  Set-JhtNodeOwner -Path $shimDest
  # PowerShell takes jht.ps1 before jht.cmd in the SAME folder and the default policy refuses it: this folder holds only the command shim, and comes first in the PATH
  New-Item -ItemType Directory -Force -Path $ShimBin | Out-Null
  $shimToWrapper = [Text.Encoding]::ASCII.GetBytes((($shimContent.Replace('%~dp0jht.ps1', '%~dp0..\jht.ps1') -replace "`r?`n", "`r`n") + "`r`n"))
  Publish-JhtFile -Destination (Join-Path $ShimBin 'jht.cmd') -Bytes $shimToWrapper
  Set-JhtNodeOwner -Path (Join-Path $ShimBin 'jht.cmd')
  Write-Ok "Podman runtime: $RuntimeDir"
  Write-Ok "wrapper: $wrapperDest"
}

# ── Step 4: PATH register ─────────────────────────────────────────────────
# The user PATH with the shim folder right BEFORE the bin folder: PowerShell takes the first folder of the PATH that has a `jht`,
# and in the bin folder jht.ps1 comes before jht.cmd (the default policy then refuses it). Everything else keeps its place.
function Get-OrderedUserPath {
  param([string]$UserPath, [string]$ShimBin, [string]$BinDir)
  $ordered = New-Object System.Collections.Generic.List[string]; $hasBin = $false
  foreach ($entry in @($UserPath -split ';' | Where-Object { $_ -and ($_.Trim() -ne '') })) {
    if ($entry.TrimEnd('\') -ieq $ShimBin.TrimEnd('\')) { continue }
    if ($entry.TrimEnd('\') -ieq $BinDir.TrimEnd('\')) { $hasBin = $true; $ordered.Add($ShimBin) }
    $ordered.Add($entry)
  }
  if (-not $hasBin) { $ordered.Add($ShimBin); $ordered.Add($BinDir) }
  return ($ordered -join ';')
}
# What the registry has in the machine and user PATH and this process lacks goes at the end of this process's PATH: the
# programs a step of this very install put there (Podman, from winget or from its release) are found by the commands that
# follow. Only this process: the window the installer was started from is another process and keeps its own PATH, which
# is why Show-Final says to open a new one.
function Add-NewRegistryPathToSession {
  param(
    [string]$MachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine'),
    [string]$UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  )
  $have = @($env:Path -split ';' | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') })
  foreach ($entry in @(($MachinePath -split ';') + ($UserPath -split ';'))) {
    if (-not $entry) { continue }
    $key = $entry.TrimEnd('\')
    if ($have -icontains $key) { continue }
    $env:Path = "$env:Path;$entry"
    $have += $key
  }
}

# The window that ran the installer was open before it: a program the install put on the PATH (jht, and Podman when
# the install added it) is not in that window's PATH, and a new window brings it in. No restart of the computer is needed.
# No command to paste: a person who is not technical is told only to open a new window.
function Write-JhtNewWindowNotice {
  Write-Host "  $(Ts 'installer.windows.jht_podman_are_your' 'jht and podman are on your PATH from now on, but THIS PowerShell window was open before the')" -ForegroundColor Yellow
  Write-Host "  $(Ts 'installer.windows.install_may_not_know' 'install and may not know them yet ("not recognized as the name of a cmdlet").')" -ForegroundColor Yellow
  Write-Host "  $(Ts 'installer.windows.open_new_powershell_window' 'Open a NEW PowerShell window to use jht and podman. No restart of the computer is needed.')" -ForegroundColor Yellow
  Write-Host ""
}

# The window that launched the installer already finds jht and podman when its PATH had the jht folders and a podman.exe
# (an install over an earlier one): then the notice of the new window has nothing to say.
function Test-JhtStartWindowHasTools {
  param([string]$StartPath = $script:JhtStartPath)
  if (-not $StartPath) { return $false }
  $entries = @($StartPath -split ';' | Where-Object { $_ -and ($_.Trim() -ne '') } | ForEach-Object { $_.TrimEnd('\') })
  if (-not ($entries -icontains $BinDir.TrimEnd('\')) -or -not ($entries -icontains $ShimBin.TrimEnd('\'))) { return $false }
  foreach ($entry in $entries) {
    try { if (Test-Path -LiteralPath (Join-Path $entry 'podman.exe') -PathType Leaf) { return $true } } catch { }
  }
  return $false
}

function Add-ToUserPath {
  Write-Step 4 $TotalSteps (Ts 'installer.windows.registering_user_path' 'Registering the user PATH')

  if ($DryRun) {
    Write-Dry "[Environment]::SetEnvironmentVariable('Path', '...;$BinDir', 'User')"
    Write-Dry "Update `$env:Path for the current session"
    $script:PathReady = $true
    return
  }
  # The USER-scope PATH (HKCU): system-wide would require elevation.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }
  $newPath = Get-OrderedUserPath -UserPath $userPath -ShimBin $ShimBin -BinDir $BinDir
  if ($newPath -ceq $userPath) {
    Write-Ok "$BinDir $(Ts 'installer.windows.already_user_path' 'already in the user PATH')"
  } else {
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Ok (Ts 'installer.windows.user_path_updated_effective' 'User PATH updated (effective from the next terminal)')
  }

  # The current session too, so the installer's next commands (e.g. the wizard) find `jht.cmd`.
  $env:Path = "$ShimBin;" + (($env:Path -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $ShimBin.TrimEnd('\') }) -join ';')
  if (-not ($env:Path -split ';' | Where-Object { $_.TrimEnd('\') -ieq $BinDir.TrimEnd('\') })) { $env:Path = "$env:Path;$BinDir" }
  Add-NewRegistryPathToSession

  $script:PathReady = $true
}

# ── Step 5: host.env + pairing token ──────────────────────────────────────
# host.env e il token di pairing stanno in una cartella montata nel container: un agente puo' metterci al posto del file un LINK
# (che nel container e' pendente e sull'host punta a un file dell'utente). Tutto cio' che l'host scrive in quella cartella passa
# da qui: un temporaneo fuori dalla cartella montata e poi Move-Item; il link, se c'e', viene tolto (solo lui) e mai seguito.
function Write-HostFile {
  param([string]$Path, [string]$Content, [string]$Encoding = 'UTF8', [switch]$NoNewline, [scriptblock]$Prepare)
  # The temporary lives OUTSIDE the mounted folder (its parent, the profile, is not mounted): inside, an agent could swap it for a
  # link as soon as it appears and the write by path would follow it.
  $dir = Split-Path -Parent (Split-Path -Parent $Path)
  $tmp = Join-Path $dir (".jht-host-file.{0}.tmp" -f [guid]::NewGuid().ToString('N'))
  try {
    Set-Content -LiteralPath $tmp -Value $Content -Encoding $Encoding -NoNewline:$NoNewline
    # What has to be true of the file (its ACL) is set on the temporary, before it takes the place: by path on the final name it
    # would reach whatever a link planted in the meantime names.
    if ($Prepare) { & $Prepare $tmp }
    # GetAttributes looks at the entry itself, so a link whose target is gone (the usual one, dangling in the container) is seen too.
    $attributes = $null
    try { $attributes = [IO.File]::GetAttributes($Path) } catch [IO.FileNotFoundException] { } catch [IO.DirectoryNotFoundException] { }
    if ($null -ne $attributes) {
      $isFolder = (($attributes -band [IO.FileAttributes]::Directory) -ne 0)
      if (($attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        if ($isFolder) { [IO.Directory]::Delete($Path) } else { [IO.File]::Delete($Path) }
      } elseif ($isFolder) {
        throw "$Path is a directory"
      }
    }
    Move-Item -LiteralPath $tmp -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  }
}

# The language written in host.env, which the wrapper and the team read when the person has chosen none yet: the person's,
# by the rule of Get-JhtTextLanguage. A fixed en here made a Windows in Italian answer in English until `jht setup --language it`.
function Get-JhtPersonLanguage {
  return (Get-JhtTextLanguage)
}

# The country of this computer, two capital letters, or $null: the country of the region settings of Windows (Settings > Time & language >
# Region: HKCU\Control Panel\International\Geo, Name), else the one of the culture of the user (it-IT: IT).
function Get-JhtComputerCountry {
  $country = $null
  try { $country = [string](Get-ItemProperty -LiteralPath 'HKCU:\Control Panel\International\Geo' -Name 'Name' -ErrorAction Stop).Name } catch { }
  if (-not $country) {
    try { $country = [Globalization.RegionInfo]::CurrentRegion.TwoLetterISORegionName } catch { }
  }
  if ($country -cmatch '^[a-zA-Z]{2}\z') { return $country.ToUpperInvariant() }
  return $null
}

# >>> zones of the Windows ids, made from shared/data/timezones.txt by `python3 tests/installer_ps1_zones.py --write`: do not edit by hand
function Get-JhtWindowsZoneLines {
  return @'
P|AUS Central Standard Time|Australia/Darwin
P|AUS Eastern Standard Time|Australia/Sydney
P|Afghanistan Standard Time|Asia/Kabul
P|Alaskan Standard Time|America/Anchorage
P|Aleutian Standard Time|America/Adak
P|Altai Standard Time|Asia/Barnaul
P|Arab Standard Time|Asia/Riyadh
P|Arabian Standard Time|Asia/Dubai
P|Arabic Standard Time|Asia/Baghdad
P|Argentina Standard Time|America/Argentina/Buenos_Aires
P|Astrakhan Standard Time|Europe/Astrakhan
P|Atlantic Standard Time|America/Halifax
P|Aus Central W. Standard Time|Australia/Eucla
P|Azerbaijan Standard Time|Asia/Baku
P|Azores Standard Time|Atlantic/Azores
P|Bahia Standard Time|America/Bahia
P|Bangladesh Standard Time|Asia/Dhaka
P|Belarus Standard Time|Europe/Minsk
P|Bougainville Standard Time|Pacific/Bougainville
P|Canada Central Standard Time|America/Regina
P|Cape Verde Standard Time|Atlantic/Cape_Verde
P|Caucasus Standard Time|Asia/Yerevan
P|Cen. Australia Standard Time|Australia/Adelaide
P|Central America Standard Time|America/Guatemala
P|Central Asia Standard Time|Asia/Almaty
P|Central Brazilian Standard Time|America/Cuiaba
P|Central Europe Standard Time|Europe/Budapest
P|Central European Standard Time|Europe/Warsaw
P|Central Pacific Standard Time|Pacific/Guadalcanal
P|Central Standard Time|America/Chicago
P|Central Standard Time (Mexico)|America/Mexico_City
P|Chatham Islands Standard Time|Pacific/Chatham
P|China Standard Time|Asia/Shanghai
P|Cuba Standard Time|America/Havana
P|E. Africa Standard Time|Africa/Nairobi
P|E. Australia Standard Time|Australia/Brisbane
P|E. Europe Standard Time|Europe/Chisinau
P|E. South America Standard Time|America/Sao_Paulo
P|Easter Island Standard Time|Pacific/Easter
P|Eastern Standard Time|America/New_York
P|Eastern Standard Time (Mexico)|America/Cancun
P|Egypt Standard Time|Africa/Cairo
P|Ekaterinburg Standard Time|Asia/Yekaterinburg
P|FLE Standard Time|Europe/Helsinki
P|Fiji Standard Time|Pacific/Fiji
P|GMT Standard Time|Europe/London
P|GTB Standard Time|Europe/Bucharest
P|Georgian Standard Time|Asia/Tbilisi
P|Greenland Standard Time|America/Nuuk
P|Greenwich Standard Time|Atlantic/Reykjavik
P|Haiti Standard Time|America/Port-au-Prince
P|Hawaiian Standard Time|Pacific/Honolulu
P|India Standard Time|Asia/Kolkata
P|Iran Standard Time|Asia/Tehran
P|Israel Standard Time|Asia/Jerusalem
P|Jordan Standard Time|Asia/Amman
P|Kaliningrad Standard Time|Europe/Kaliningrad
P|Korea Standard Time|Asia/Seoul
P|Libya Standard Time|Africa/Tripoli
P|Line Islands Standard Time|Pacific/Kiritimati
P|Lord Howe Standard Time|Australia/Lord_Howe
P|Magadan Standard Time|Asia/Magadan
P|Magallanes Standard Time|America/Punta_Arenas
P|Marquesas Standard Time|Pacific/Marquesas
P|Mauritius Standard Time|Indian/Mauritius
P|Middle East Standard Time|Asia/Beirut
P|Montevideo Standard Time|America/Montevideo
P|Morocco Standard Time|Africa/Casablanca
P|Mountain Standard Time|America/Denver
P|Mountain Standard Time (Mexico)|America/Mazatlan
P|Myanmar Standard Time|Asia/Yangon
P|N. Central Asia Standard Time|Asia/Novosibirsk
P|Namibia Standard Time|Africa/Windhoek
P|Nepal Standard Time|Asia/Kathmandu
P|New Zealand Standard Time|Pacific/Auckland
P|Newfoundland Standard Time|America/St_Johns
P|Norfolk Standard Time|Pacific/Norfolk
P|North Asia East Standard Time|Asia/Irkutsk
P|North Asia Standard Time|Asia/Krasnoyarsk
P|North Korea Standard Time|Asia/Pyongyang
P|Omsk Standard Time|Asia/Omsk
P|Pacific SA Standard Time|America/Santiago
P|Pacific Standard Time|America/Los_Angeles
P|Pacific Standard Time (Mexico)|America/Tijuana
P|Pakistan Standard Time|Asia/Karachi
P|Paraguay Standard Time|America/Asuncion
P|Qyzylorda Standard Time|Asia/Qyzylorda
P|Romance Standard Time|Europe/Paris
P|Russia Time Zone 10|Asia/Srednekolymsk
P|Russia Time Zone 11|Asia/Kamchatka
P|Russia Time Zone 3|Europe/Samara
P|Russian Standard Time|Europe/Moscow
P|SA Eastern Standard Time|America/Cayenne
P|SA Pacific Standard Time|America/Bogota
P|SA Western Standard Time|America/La_Paz
P|SE Asia Standard Time|Asia/Bangkok
P|Saint Pierre Standard Time|America/Miquelon
P|Sakhalin Standard Time|Asia/Sakhalin
P|Samoa Standard Time|Pacific/Apia
P|Sao Tome Standard Time|Africa/Sao_Tome
P|Saratov Standard Time|Europe/Saratov
P|Singapore Standard Time|Asia/Singapore
P|South Africa Standard Time|Africa/Johannesburg
P|South Sudan Standard Time|Africa/Juba
P|Sri Lanka Standard Time|Asia/Colombo
P|Sudan Standard Time|Africa/Khartoum
P|Syria Standard Time|Asia/Damascus
P|Taipei Standard Time|Asia/Taipei
P|Tasmania Standard Time|Australia/Hobart
P|Tocantins Standard Time|America/Araguaina
P|Tokyo Standard Time|Asia/Tokyo
P|Tomsk Standard Time|Asia/Tomsk
P|Tonga Standard Time|Pacific/Tongatapu
P|Transbaikal Standard Time|Asia/Chita
P|Turkey Standard Time|Europe/Istanbul
P|Turks And Caicos Standard Time|America/Grand_Turk
P|US Eastern Standard Time|America/Indiana/Indianapolis
P|US Mountain Standard Time|America/Phoenix
P|UTC|UTC
P|UTC+12|Pacific/Funafuti
P|UTC+13|Pacific/Fakaofo
P|UTC-02|America/Noronha
P|UTC-08|Pacific/Pitcairn
P|UTC-09|Pacific/Gambier
P|UTC-11|Pacific/Midway
P|Ulaanbaatar Standard Time|Asia/Ulaanbaatar
P|Venezuela Standard Time|America/Caracas
P|Vladivostok Standard Time|Asia/Vladivostok
P|Volgograd Standard Time|Europe/Volgograd
P|W. Australia Standard Time|Australia/Perth
P|W. Central Africa Standard Time|Africa/Lagos
P|W. Europe Standard Time|Europe/Berlin
P|W. Mongolia Standard Time|Asia/Hovd
P|West Asia Standard Time|Asia/Tashkent
P|West Bank Standard Time|Asia/Hebron
P|West Pacific Standard Time|Pacific/Port_Moresby
P|Yakutsk Standard Time|Asia/Yakutsk
P|Yukon Standard Time|America/Whitehorse
T|Arab Standard Time|BH|Asia/Bahrain
T|Arab Standard Time|KW|Asia/Kuwait
T|Arab Standard Time|QA|Asia/Qatar
T|Arab Standard Time|YE|Asia/Aden
T|Arabian Standard Time|OM|Asia/Muscat
T|Atlantic Standard Time|BM|Atlantic/Bermuda
T|Atlantic Standard Time|GL|America/Thule
T|Azores Standard Time|GL|America/Scoresbysund
T|Bangladesh Standard Time|BT|Asia/Thimphu
T|Central America Standard Time|BZ|America/Belize
T|Central America Standard Time|CR|America/Costa_Rica
T|Central America Standard Time|EC|Pacific/Galapagos
T|Central America Standard Time|HN|America/Tegucigalpa
T|Central America Standard Time|NI|America/Managua
T|Central America Standard Time|SV|America/El_Salvador
T|Central Asia Standard Time|AQ|Antarctica/Vostok
T|Central Asia Standard Time|CN|Asia/Urumqi
T|Central Asia Standard Time|IO|Indian/Chagos
T|Central Asia Standard Time|KG|Asia/Bishkek
T|Central Europe Standard Time|AL|Europe/Tirane
T|Central Europe Standard Time|CZ|Europe/Prague
T|Central Europe Standard Time|ME|Europe/Podgorica
T|Central Europe Standard Time|RS|Europe/Belgrade
T|Central Europe Standard Time|SI|Europe/Ljubljana
T|Central Europe Standard Time|SK|Europe/Bratislava
T|Central European Standard Time|BA|Europe/Sarajevo
T|Central European Standard Time|HR|Europe/Zagreb
T|Central European Standard Time|MK|Europe/Skopje
T|Central Pacific Standard Time|AQ|Antarctica/Casey
T|Central Pacific Standard Time|FM|Pacific/Pohnpei
T|Central Pacific Standard Time|NC|Pacific/Noumea
T|Central Pacific Standard Time|VU|Pacific/Efate
T|Central Standard Time|CA|America/Winnipeg
T|Central Standard Time|MX|America/Matamoros
T|China Standard Time|HK|Asia/Hong_Kong
T|China Standard Time|MO|Asia/Macau
T|E. Africa Standard Time|AQ|Antarctica/Syowa
T|E. Africa Standard Time|DJ|Africa/Djibouti
T|E. Africa Standard Time|ER|Africa/Asmara
T|E. Africa Standard Time|ET|Africa/Addis_Ababa
T|E. Africa Standard Time|KM|Indian/Comoro
T|E. Africa Standard Time|MG|Indian/Antananarivo
T|E. Africa Standard Time|SO|Africa/Mogadishu
T|E. Africa Standard Time|TZ|Africa/Dar_es_Salaam
T|E. Africa Standard Time|UG|Africa/Kampala
T|E. Africa Standard Time|YT|Indian/Mayotte
T|Eastern Standard Time|BS|America/Nassau
T|Eastern Standard Time|CA|America/Toronto
T|FLE Standard Time|AX|Europe/Mariehamn
T|FLE Standard Time|BG|Europe/Sofia
T|FLE Standard Time|EE|Europe/Tallinn
T|FLE Standard Time|LT|Europe/Vilnius
T|FLE Standard Time|LV|Europe/Riga
T|FLE Standard Time|UA|Europe/Kyiv
T|GMT Standard Time|ES|Atlantic/Canary
T|GMT Standard Time|FO|Atlantic/Faroe
T|GMT Standard Time|GG|Europe/Guernsey
T|GMT Standard Time|IE|Europe/Dublin
T|GMT Standard Time|IM|Europe/Isle_of_Man
T|GMT Standard Time|JE|Europe/Jersey
T|GMT Standard Time|PT|Europe/Lisbon
T|GTB Standard Time|CY|Asia/Nicosia
T|GTB Standard Time|GR|Europe/Athens
T|Greenwich Standard Time|BF|Africa/Ouagadougou
T|Greenwich Standard Time|CI|Africa/Abidjan
T|Greenwich Standard Time|GH|Africa/Accra
T|Greenwich Standard Time|GL|America/Danmarkshavn
T|Greenwich Standard Time|GM|Africa/Banjul
T|Greenwich Standard Time|GN|Africa/Conakry
T|Greenwich Standard Time|GW|Africa/Bissau
T|Greenwich Standard Time|LR|Africa/Monrovia
T|Greenwich Standard Time|ML|Africa/Bamako
T|Greenwich Standard Time|MR|Africa/Nouakchott
T|Greenwich Standard Time|SH|Atlantic/St_Helena
T|Greenwich Standard Time|SL|Africa/Freetown
T|Greenwich Standard Time|SN|Africa/Dakar
T|Greenwich Standard Time|TG|Africa/Lome
T|Hawaiian Standard Time|CK|Pacific/Rarotonga
T|Hawaiian Standard Time|PF|Pacific/Tahiti
T|Mauritius Standard Time|RE|Indian/Reunion
T|Mauritius Standard Time|SC|Indian/Mahe
T|Morocco Standard Time|EH|Africa/El_Aaiun
T|Mountain Standard Time|CA|America/Edmonton
T|Mountain Standard Time|MX|America/Ciudad_Juarez
T|Myanmar Standard Time|CC|Indian/Cocos
T|New Zealand Standard Time|AQ|Antarctica/McMurdo
T|Pacific Standard Time|CA|America/Vancouver
T|Romance Standard Time|BE|Europe/Brussels
T|Romance Standard Time|DK|Europe/Copenhagen
T|Romance Standard Time|ES|Europe/Madrid
T|Russian Standard Time|UA|Europe/Simferopol
T|SA Eastern Standard Time|AQ|Antarctica/Palmer
T|SA Eastern Standard Time|BR|America/Belem
T|SA Eastern Standard Time|FK|Atlantic/Stanley
T|SA Eastern Standard Time|SR|America/Paramaribo
T|SA Pacific Standard Time|BR|America/Eirunepe
T|SA Pacific Standard Time|CA|America/Atikokan
T|SA Pacific Standard Time|EC|America/Guayaquil
T|SA Pacific Standard Time|JM|America/Jamaica
T|SA Pacific Standard Time|KY|America/Cayman
T|SA Pacific Standard Time|PA|America/Panama
T|SA Pacific Standard Time|PE|America/Lima
T|SA Western Standard Time|AG|America/Antigua
T|SA Western Standard Time|AI|America/Anguilla
T|SA Western Standard Time|AW|America/Aruba
T|SA Western Standard Time|BB|America/Barbados
T|SA Western Standard Time|BL|America/St_Barthelemy
T|SA Western Standard Time|BQ|America/Kralendijk
T|SA Western Standard Time|BR|America/Porto_Velho
T|SA Western Standard Time|CA|America/Blanc-Sablon
T|SA Western Standard Time|CW|America/Curacao
T|SA Western Standard Time|DM|America/Dominica
T|SA Western Standard Time|DO|America/Santo_Domingo
T|SA Western Standard Time|GD|America/Grenada
T|SA Western Standard Time|GP|America/Guadeloupe
T|SA Western Standard Time|GY|America/Guyana
T|SA Western Standard Time|KN|America/St_Kitts
T|SA Western Standard Time|LC|America/St_Lucia
T|SA Western Standard Time|MF|America/Marigot
T|SA Western Standard Time|MQ|America/Martinique
T|SA Western Standard Time|MS|America/Montserrat
T|SA Western Standard Time|PR|America/Puerto_Rico
T|SA Western Standard Time|SX|America/Lower_Princes
T|SA Western Standard Time|TT|America/Port_of_Spain
T|SA Western Standard Time|VC|America/St_Vincent
T|SA Western Standard Time|VG|America/Tortola
T|SA Western Standard Time|VI|America/St_Thomas
T|SE Asia Standard Time|AQ|Antarctica/Davis
T|SE Asia Standard Time|CX|Indian/Christmas
T|SE Asia Standard Time|ID|Asia/Jakarta
T|SE Asia Standard Time|KH|Asia/Phnom_Penh
T|SE Asia Standard Time|LA|Asia/Vientiane
T|SE Asia Standard Time|VN|Asia/Ho_Chi_Minh
T|Singapore Standard Time|BN|Asia/Brunei
T|Singapore Standard Time|ID|Asia/Makassar
T|Singapore Standard Time|MY|Asia/Kuala_Lumpur
T|Singapore Standard Time|PH|Asia/Manila
T|South Africa Standard Time|BI|Africa/Bujumbura
T|South Africa Standard Time|BW|Africa/Gaborone
T|South Africa Standard Time|CD|Africa/Lubumbashi
T|South Africa Standard Time|LS|Africa/Maseru
T|South Africa Standard Time|MW|Africa/Blantyre
T|South Africa Standard Time|MZ|Africa/Maputo
T|South Africa Standard Time|RW|Africa/Kigali
T|South Africa Standard Time|SZ|Africa/Mbabane
T|South Africa Standard Time|ZM|Africa/Lusaka
T|South Africa Standard Time|ZW|Africa/Harare
T|Tokyo Standard Time|ID|Asia/Jayapura
T|Tokyo Standard Time|PW|Pacific/Palau
T|Tokyo Standard Time|TL|Asia/Dili
T|US Mountain Standard Time|CA|America/Creston
T|US Mountain Standard Time|MX|America/Hermosillo
T|UTC+12|KI|Pacific/Tarawa
T|UTC+12|MH|Pacific/Majuro
T|UTC+12|NR|Pacific/Nauru
T|UTC+12|UM|Pacific/Wake
T|UTC+12|WF|Pacific/Wallis
T|UTC+13|KI|Pacific/Kanton
T|UTC-02|GS|Atlantic/South_Georgia
T|UTC-11|AS|Pacific/Pago_Pago
T|UTC-11|NU|Pacific/Niue
T|W. Central Africa Standard Time|AO|Africa/Luanda
T|W. Central Africa Standard Time|BJ|Africa/Porto-Novo
T|W. Central Africa Standard Time|CD|Africa/Kinshasa
T|W. Central Africa Standard Time|CF|Africa/Bangui
T|W. Central Africa Standard Time|CG|Africa/Brazzaville
T|W. Central Africa Standard Time|CM|Africa/Douala
T|W. Central Africa Standard Time|DZ|Africa/Algiers
T|W. Central Africa Standard Time|GA|Africa/Libreville
T|W. Central Africa Standard Time|GQ|Africa/Malabo
T|W. Central Africa Standard Time|NE|Africa/Niamey
T|W. Central Africa Standard Time|TD|Africa/Ndjamena
T|W. Central Africa Standard Time|TN|Africa/Tunis
T|W. Europe Standard Time|AD|Europe/Andorra
T|W. Europe Standard Time|AT|Europe/Vienna
T|W. Europe Standard Time|CH|Europe/Zurich
T|W. Europe Standard Time|GI|Europe/Gibraltar
T|W. Europe Standard Time|IT|Europe/Rome
T|W. Europe Standard Time|LI|Europe/Vaduz
T|W. Europe Standard Time|LU|Europe/Luxembourg
T|W. Europe Standard Time|MC|Europe/Monaco
T|W. Europe Standard Time|MT|Europe/Malta
T|W. Europe Standard Time|NL|Europe/Amsterdam
T|W. Europe Standard Time|NO|Europe/Oslo
T|W. Europe Standard Time|SE|Europe/Stockholm
T|W. Europe Standard Time|SJ|Arctic/Longyearbyen
T|W. Europe Standard Time|SM|Europe/San_Marino
T|W. Europe Standard Time|VA|Europe/Vatican
T|West Asia Standard Time|AQ|Antarctica/Mawson
T|West Asia Standard Time|KZ|Asia/Aqtobe
T|West Asia Standard Time|MV|Indian/Maldives
T|West Asia Standard Time|TF|Indian/Kerguelen
T|West Asia Standard Time|TJ|Asia/Dushanbe
T|West Asia Standard Time|TM|Asia/Ashgabat
T|West Pacific Standard Time|AQ|Antarctica/DumontDUrville
T|West Pacific Standard Time|FM|Pacific/Chuuk
T|West Pacific Standard Time|GU|Pacific/Guam
T|West Pacific Standard Time|MP|Pacific/Saipan
'@
}
# <<< zones of the Windows ids
# The IANA zone of a Windows zone id, or $null. The country picks among the zones of the id (W. Europe Standard Time in IT: Europe/Rome), as
# the CLDR does; without one of its own the id's zone of the CLDR, the 001 one (W. Europe Standard Time: Europe/Berlin).
function Get-JhtZoneOfWindowsId {
  param([string]$Id, [string]$Country)
  if (-not $Id) { return $null }
  $primary = $null
  foreach ($line in [regex]::Split((Get-JhtWindowsZoneLines), '\r?\n')) {
    $f = $line.Split('|')
    if ($f[0] -ceq 'T' -and $f.Count -eq 4 -and $f[1] -ceq $Id -and $Country -and $f[2] -ceq $Country) { return $f[3] }
    if ($f[0] -ceq 'P' -and $f.Count -eq 3 -and $f[1] -ceq $Id) { $primary = $f[2] }
  }
  return $primary
}

# The zone of this computer for host.env: its Windows zone, in its country. When the id is not known it is UTC and jht setup asks.
# Written in host.env (step 5) and given to the enabler (step 3), whose `jht up` makes the container before host.env exists.
function Get-JhtInstallTimezone {
  param([string]$WindowsId, [string]$Country)
  if (-not $PSBoundParameters.ContainsKey('WindowsId')) { try { $WindowsId = [System.TimeZoneInfo]::Local.Id } catch { $WindowsId = '' } }
  if (-not $PSBoundParameters.ContainsKey('Country')) { $Country = Get-JhtComputerCountry }
  $tz = Get-JhtZoneOfWindowsId -Id $WindowsId -Country $Country
  if (-not $tz) { $tz = 'UTC' }
  # An update keeps the time zone saved by the install before (the enabler of step 3 makes the container with it too). Only the 001 zone
  # of this very Windows id, which installs up to build 6 wrote whatever the country (Europe/Berlin in Italy), gives way to the zone of the
  # country: the same clock, the right name.
  $savedTz = Get-JhtSavedHostEnvValue -Name 'JHT_USER_TZ'
  if ($savedTz -and -not ($savedTz -ceq (Get-JhtZoneOfWindowsId -Id $WindowsId -Country ''))) { $tz = $savedTz }
  return $tz
}

function Write-HostEnv {
  Write-Step 5 $TotalSteps (Ts 'installer.windows.writing_host_env' 'Writing host.env')

  $hostEnvFile = Join-Path $JhtHome 'host.env'
  # An update keeps the host type and the time zone saved by the install before (the language too: Get-JhtTextLanguage reads it).
  $savedHostType = Get-JhtSavedHostEnvValue -Name 'JHT_HOST_TYPE'
  $hostType = if ($PairingToken) { 'vps' } elseif ($savedHostType) { $savedHostType } else { 'local' }
  $lang = Get-JhtPersonLanguage
  $tz = Get-JhtInstallTimezone

  $content = @"
# Host env for the JHT wrapper + container. Generated by install.ps1.
JHT_HOST_TYPE=$hostType
JHT_LANG=$lang
JHT_USER_TZ=$tz
"@

  if ($DryRun) {
    Write-Dry "Set-Content $hostEnvFile (JHT_HOST_TYPE=$hostType, JHT_LANG=$lang, JHT_USER_TZ=$tz)"
  } else {
    Write-HostFile -Path $hostEnvFile -Content $content
    Write-Ok "$(Ts 'installer.windows.host_env_written' 'host.env written:') $hostEnvFile (mode=$hostType, lang=$lang, tz=$tz)"
  }

  # Pairing token: saved to $JhtHome\.pairing-token with restrictive perms
  # (Windows ACL: only the USERPROFILE owner reads/writes). The container
  # reads it on first boot via `jht cloud pair`.
  if ($PairingToken) {
    $tokenFile = Join-Path $JhtHome '.pairing-token'
    if ($DryRun) {
      Write-Dry "Set-Content $tokenFile (pairing token, ACL owner-only)"
      if ($CloudSync -ne 'on') { Write-Dry "Set-Content (Join-Path $JhtHome '.pairing-paused') (marker: the pairing starts with the sync paused)" }
    } else {
      # Restrict the ACL to the current user only (drops the inherited Users/Everyone entries), on the temporary and before it
      # takes the place of the file. Best-effort: a failure does not block the install.
      $restrictAcl = {
        param($file)
        try {
          $acl = Get-Acl -LiteralPath $file
          $acl.SetAccessRuleProtection($true, $false)
          $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
            'FullControl', 'Allow'
          )
          $acl.SetAccessRule($rule)
          Set-JhtAccessControl -Path $file -Acl $acl
        } catch {
          Write-Warn (Tsf 'installer.windows.token_acl_failed' 'ACL restriction failed (file still readable by Users): %s' $_.Exception.Message)
        }
      }
      Write-HostFile -Path $tokenFile -Content $PairingToken -Encoding ASCII -NoNewline -Prepare $restrictAcl

      Write-Ok "$(Ts 'installer.windows.pairing_token_saved' 'Pairing token saved:') $tokenFile"
      # The sync with the site is a choice: unless it was asked for (-CloudSync on), the marker tells `jht cloud pair`
      # to start with the sync paused (the device is paired all the same; `jht cloud resume` turns it on).
      $pausedMarker = Join-Path $JhtHome '.pairing-paused'
      if ($CloudSync -eq 'on') {
        try { [IO.File]::Delete($pausedMarker) } catch { }
      } else {
        Write-HostFile -Path $pausedMarker -Content '' -Encoding ASCII -NoNewline -Prepare $restrictAcl
      }
    }
  }
}

# ── Final message + optional onboarding ───────────────────────────────────
function Show-Final {
  Write-Host ""
  Write-Host "+------------------------------------------+" -ForegroundColor Green
  Write-Host (Ts 'installer.windows.installation_complete' '|  Installation complete!                  |') -ForegroundColor Green
  Write-Host "+------------------------------------------+" -ForegroundColor Green
  Write-Host ""
  Write-Host "  $(Ts 'installer.windows.container_mode_active' 'Container mode active.')" -ForegroundColor White
  Write-Host "  $(Ts 'installer.windows.agents_only_see' 'The agents only see:')" -ForegroundColor DarkGray
  Write-Host "    $JhtHome                          -> /jht_home $(Ts 'installer.windows.config_db_agents' '(config, db, agents)')" -ForegroundColor DarkGray
  Write-Host "    $env:USERPROFILE\Documents\Job Hunter Team -> /jht_user $(Ts 'installer.windows.cvs_attachments_output' '(CVs, attachments, output)')" -ForegroundColor DarkGray
  Write-Host ""

  # Not for the desktop app, which reads this output through a pipe, nor for a dry run (nothing was installed).
  if (-not $DryRun -and $env:JHT_MACHINE_OUTPUT -ne '1' -and -not (Test-JhtStartWindowHasTools)) { Write-JhtNewWindowNotice }
  if (-not (Test-WillAutoOnboard)) {
    Write-Host "  $(Ts 'installer.windows.next_steps' 'Next steps:')" -ForegroundColor White
    Write-Host ""
    if ($script:PathReady) {
      Write-Host "      jht setup        # $(Ts 'installer.windows.setup_wizard_also_starts' 'setup wizard (also starts the container)')" -ForegroundColor White
    } else {
      Write-Host "      $BinDir\jht.cmd setup" -ForegroundColor White
    }
    Write-Host ""
  }

  # `jht uninstall` stops the team and takes away the machine (with its images), the runtime and the `jht` command; the data stays.
  Write-Host "  $(Ts 'installer.windows.uninstall_keeps_data_jht' 'To uninstall (keeps the data in ~/.jht and ~/Documents/Job Hunter Team):')" -ForegroundColor DarkGray
  Write-Host "    jht uninstall --confirm" -ForegroundColor DarkGray
  Write-Host "  $(Ts 'installer.windows.delete_data_as_well' 'To delete the data as well (config, db, CVs, output):')" -ForegroundColor DarkGray
  Write-Host "    jht uninstall --confirm --purge" -ForegroundColor DarkGray
  Write-Host ""
}

function Test-WillAutoOnboard {
  if ($DryRun)        { return $false }
  if ($SkipOnboard)   { return $false }
  if ($env:JHT_SKIP_ONBOARD -eq '1') { return $false }
  if ($PairingToken)  { return $false }
  # The interactive wizard needs a host process — when install.ps1 runs as a
  # downloaded file inside an interactive PowerShell we have a normal host. When it runs
  # from a job/CI with redirection, IsInputRedirected is true.
  if ([Console]::IsInputRedirected) { return $false }
  return $true
}

function Invoke-Onboard {
  if (-not (Test-WillAutoOnboard)) {
    if ($PairingToken) {
      Write-Info (Ts 'installer.windows.pairing_token_present_skipping' 'Pairing token present: skipping the interactive wizard. The container will complete the pairing on first boot.')
    }
    return
  }
  Write-Host ""
  Write-Info (Ts 'installer.windows.launching_setup_wizard' 'Launching the setup wizard...')
  # Use the CMD shim, which handles the ExecutionPolicy. PathReady guarantees
  # that `jht.cmd` is reachable in this session.
  & "$BinDir\jht.cmd" setup
  if ($LASTEXITCODE -ne 0) {
    Write-Warn (Ts 'installer.windows.wizard_exited_error_re' 'The wizard exited with an error. Re-run it with: jht setup')
  }
}

# -- A team of an earlier JHT on Docker Desktop -------------------------------
# Up to 0.3.9 JHT on Windows ran on Docker Desktop: the container "jht" of the Compose project of this runtime folder
# (docker compose -f <runtime>\docker-compose.yml --project-directory <runtime>), with restart: unless-stopped. Since 0.4 the team
# runs in the Podman machine, and one installed next to a 0.3.9 container would be a second team on the same ~/.jht and Documents.
# So when Docker answers and holds a container of ours (named jht or jht-..., with the working_dir label of this runtime folder),
# the installer stops before it changes anything, says how to stop and remove the old team and what stays, and leaves with 85
# (runtime_change_requires_migration, as install.sh on the Mac). It never stops or removes anything itself. No Docker, or a Docker
# that does not answer within its time: nothing changes. JHT's own docker.exe (the shim in the runtime or bin folder) is not Docker.
$RuntimeChangeRequiresMigrationExit = 85
$LegacyDockerTimeoutSeconds = 20

function Get-JhtLegacyDockerCli {
  $own = @(@($RuntimeDir, $BinDir) | Where-Object { $_ } | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\', '/') })
  $candidates = @()
  if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe') }
  $candidates += @(Get-Command docker -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
  foreach ($path in $candidates) {
    if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
    $full = [IO.Path]::GetFullPath($path)
    $dir = [IO.Path]::GetDirectoryName($full).TrimEnd('\', '/')
    $inside = @($own | Where-Object { $dir -ieq $_ -or $dir.StartsWith($_ + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) })
    if ($inside.Count -gt 0) { continue }
    return $full
  }
  return $null
}

# docker with a time limit (Docker Desktop that is starting can keep a call waiting): its stdout, or $null when it did not answer, did
# not end in time or left with a code other than 0. The arguments carry no quote and no path.
function Invoke-JhtLegacyDocker {
  param([Parameter(Mandatory)][string]$Docker, [Parameter(Mandatory)][string[]]$Arguments, [int]$Seconds = $LegacyDockerTimeoutSeconds)
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Docker
  $info.Arguments = (@($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' ')
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.CreateNoWindow = $true
  try { $process = [Diagnostics.Process]::Start($info) } catch { return $null }
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $null = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit($Seconds * 1000)) {
    try { $process.Kill() } catch { }
    return $null
  }
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { return $null }
  return [string]$stdout.Result
}

# The containers of an earlier JHT in Docker: name, state, image and Compose project, only those with the working_dir of this runtime.
function Get-JhtLegacyDockerTeam {
  param([Parameter(Mandatory)][string]$Docker)
  $listed = Invoke-JhtLegacyDocker -Docker $Docker -Arguments @('ps', '--all', '--no-trunc', '--filter', 'name=^jht', '--format', '{{.Names}}|{{.State}}|{{.Image}}|{{.Labels}}')
  if ($null -eq $listed) { return @() }
  $runtime = [IO.Path]::GetFullPath($RuntimeDir).TrimEnd('\', '/')
  return @(foreach ($line in ($listed -split '\r?\n')) {
    $parts = $line.Split([char[]]@('|'), 4)
    if ($parts.Count -lt 4 -or $parts[0] -cnotmatch '^jht(-[A-Za-z0-9_.-]+)?$') { continue }
    $dir = $null; $project = $null
    foreach ($label in $parts[3].Split(',')) {
      if ($label.StartsWith('com.docker.compose.project.working_dir=')) { $dir = $label.Substring('com.docker.compose.project.working_dir='.Length) }
      elseif ($label.StartsWith('com.docker.compose.project=')) { $project = $label.Substring('com.docker.compose.project='.Length) }
    }
    if (-not $dir -or -not $project -or $project -cnotmatch '^[a-z0-9][a-z0-9_-]*$') { continue }
    try { $full = [IO.Path]::GetFullPath($dir).TrimEnd('\', '/') } catch { continue }
    if ($full -ine $runtime) { continue }
    [pscustomobject]@{ Name = $parts[0]; Running = ($parts[1] -ceq 'running'); Image = $parts[2]; Project = $project }
  })
}

# Whether the engine docker talks to is Docker's own (Docker Desktop, Docker Engine). On Windows Podman answers the Docker API on the
# docker_engine pipe when Docker Desktop is not running: a docker.exe then sees the team of this JHT 0.4, in the same runtime folder.
# Docker only when the server says Docker and nothing of Podman; an engine that cannot be told is not Docker (nothing changes).
function Test-JhtDockerOwnEngine {
  param([Parameter(Mandatory)][string]$Docker)
  $server = Invoke-JhtLegacyDocker -Docker $Docker -Arguments @('version', '--format', '{{.Server.Platform.Name}}|{{range .Server.Components}}{{.Name}};{{end}}')
  if (-not $server) { return $false }
  return ($server -match 'Docker' -and $server -notmatch 'Podman')
}

function Assert-NoLegacyDockerTeam {
  $docker = Get-JhtLegacyDockerCli
  if (-not $docker) { return }
  if (-not (Test-JhtDockerOwnEngine -Docker $docker)) { return }
  $team = @(Get-JhtLegacyDockerTeam -Docker $docker)
  if ($team.Count -eq 0) { return }
  $names = @($team | ForEach-Object { $_.Name })
  $projects = @($team | ForEach-Object { $_.Project } | Sort-Object -Unique)
  $volumes = @(foreach ($project in $projects) {
    $found = Invoke-JhtLegacyDocker -Docker $docker -Arguments @('volume', 'ls', '--filter', "label=com.docker.compose.project=$project", '--format', '{{.Name}}')
    if ($found) { @($found -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ -cmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*$' }) }
  })
  $images = @($team | ForEach-Object { $_.Image } | Where-Object { $_ -and $_ -cmatch '^[A-Za-z0-9][A-Za-z0-9_./:@-]*$' } | Sort-Object -Unique)
  $running = @($team | Where-Object { $_.Running }).Count -gt 0
  $what = if ($running) {
    Tsf 'installer.windows.earlier_job_hunter_team' 'an earlier Job Hunter Team is still running on Docker Desktop (container %s). Since 0.4 the team runs in a Podman machine: installed next to it, two teams would work on the same data. Nothing was changed.' ($names -join ', ')
  } else {
    Tsf 'installer.windows.earlier_job_hunter_team_2' 'an earlier Job Hunter Team is still installed on Docker Desktop (container %s, stopped; it starts again with Docker Desktop). Since 0.4 the team runs in a Podman machine: installed next to it, two teams would work on the same data. Nothing was changed.' ($names -join ', ')
  }
  if (Test-JhtMachineOutput) {
    [Console]::Error.WriteLine("runtime_change_requires_migration: an earlier JHT container on Docker Desktop ($($names -join ', ')); stop and remove it, then run the installer again.")
    Remove-JhtCreatedEmptyDirs
    exit $RuntimeChangeRequiresMigrationExit
  }
  $todo = @(
    (Ts 'installer.windows.stop_remove_old_team' 'Stop and remove the old team (Docker Desktop on), in PowerShell:'),
    "  docker stop $($names -join ' ')",
    "  docker rm $($names -join ' ')",
    (Ts 'installer.windows.your_data_stays_jht' 'Your data stays: ~/.jht (configuration, database, profile) and Documents\Job Hunter Team (CVs, outputs) are folders of this computer, and the new team uses them.')
  )
  if ($volumes.Count -gt 0) {
    # The 0.3.x installer took the compose of the branch at the time of the install: by then it can have the volumes of the secrets too.
    $todo += (Ts 'installer.windows.docker_desktop_volumes_old' 'In Docker Desktop the volumes of the old team stay: provider tools and, by the version, the API key kept by the setup, the mail password and the Telegram tokens. The new team does not read them: give those again with jht setup. If you do not need them any more:')
    $todo += "  docker volume rm $($volumes -join ' ')"
  }
  if ($images.Count -gt 0) {
    $todo += (Ts 'installer.windows.image_free_disk' 'And its image, to free the disk:')
    $todo += "  docker image rm $($images -join ' ')"
  }
  $todo += (Ts 'installer.windows.then_run_installer_again' 'Then run this installer again.')
  Write-JhtProblem -What $what -Todo $todo
  Remove-JhtCreatedEmptyDirs
  exit $RuntimeChangeRequiresMigrationExit
}

function Test-JhtMachineOutput {
  if ($env:JHT_MACHINE_OUTPUT -eq '1') { return $true }
  if ($env:JHT_MACHINE_OUTPUT -eq '0') { return $false }
  return [Console]::IsOutputRedirected
}

# ── Main ──────────────────────────────────────────────────────────────────
if ($WindowsSupportNoticeOnly) {
  Show-WindowsSupportNotice
  exit 0
}
Show-Header
Test-System
Assert-NoLegacyDockerTeam
Test-WindowsSubsystem
Get-RuntimeFiles
Add-ToUserPath
Write-HostEnv
Show-Final
Invoke-Onboard

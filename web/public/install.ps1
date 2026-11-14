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
$Image = if ($env:JHT_IMAGE) { $env:JHT_IMAGE } else { 'ghcr.io/leopu00/jht@sha256:fa78c975c04dd5f95d6225a35c8c3bb9646f8ef14b32c8ca558d5332de0cce00' }
$CoreImageDigest = if ($env:JHT_CORE_IMAGE_DIGEST) { $env:JHT_CORE_IMAGE_DIGEST } else { '' }
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
    Write-Host "  $(T 'What to do now:' 'Cosa fare adesso:')" -ForegroundColor Yellow
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
  Write-Host "  $(T 'mode:    Podman machine (WSL)' 'modo:     macchina Podman (WSL)')" -ForegroundColor DarkGray
  Write-Host "  $(T 'image:  ' 'immagine:') $RuntimeImage" -ForegroundColor DarkGray
  # A test-channel install is one commit, not a branch: the banner says the commit that was asked for (the Linux installer
  # does the same). Plain syntax only: this runs in Windows PowerShell 5.1.
  if ($SourceSha) {
    Write-Host "  commit:  $SourceSha" -ForegroundColor DarkGray
  } else {
    Write-Host "  $(T 'branch: ' 'ramo:    ') $Branch" -ForegroundColor DarkGray
  }
  Write-Host "  runtime: $RuntimeDir" -ForegroundColor DarkGray
  Write-Host "  bin:     $BinDir" -ForegroundColor DarkGray
  if ($DryRun)       { Write-Host "  dry-run: ON (no changes to the system)" -ForegroundColor Yellow }
  if ($PairingToken) { Write-Host "  pairing: token present (skips the wizard)" -ForegroundColor Yellow }
  Write-Host ""
}

# ── Step 1: System detection ──────────────────────────────────────────────
function Test-System {
  Write-Step 1 $TotalSteps (T 'System detection' 'Rilevamento del sistema')
  $os = [System.Environment]::OSVersion
  if ($os.Platform -ne 'Win32NT') {
    Write-Fail "install.ps1 only supports Windows. On Linux/macOS use install.sh."
  }
  $psVersion = $PSVersionTable.PSVersion
  if ($psVersion.Major -lt 5) {
    Write-Fail "PowerShell 5.1+ required (current version: $psVersion). Install PowerShell 7: https://aka.ms/PowerShell"
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
# then the language of Windows, then English. The sentences of this script are written in English and Italian (T); the
# Windows 10 notice in all seven. It is also the language written in host.env (Get-JhtPersonLanguage).
function Get-JhtTextLanguage {
  $known = @('en', 'it', 'de', 'fr', 'es', 'hu', 'pt')
  try {
    $prefs = Join-Path $JhtHome 'i18n-prefs.json'
    $item = Get-Item -LiteralPath $prefs -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -and -not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and $item.Length -le 4096) {
      $match = [regex]::Match(([IO.File]::ReadAllText($prefs) -replace '[\r\n]', ''), '"locale"\s*:\s*"(en|it|hu|es|de|fr|pt)"')
      if ($match.Success) { return $match.Groups[1].Value }
    }
  } catch { }
  $asked = ([string]$env:JHT_LANG).ToLowerInvariant() -replace '[-_.@].*$', ''
  if ($known -contains $asked) { return $asked }
  try {
    $windows = ([string][Globalization.CultureInfo]::CurrentUICulture.TwoLetterISOLanguageName).ToLowerInvariant()
    if ($known -contains $windows) { return $windows }
  } catch { }
  return 'en'
}
# T "english" "italiano": the sentence in the person's language; every language other than Italian reads English.
function T {
  param([string]$En, [string]$It)
  if ((Get-JhtTextLanguage) -ceq 'it') { return $It }
  return $En
}
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
  Write-Step 2 $TotalSteps (T 'Windows Subsystem for Linux check' 'Controllo del Sottosistema Windows per Linux')
  Write-JhtPhase wsl_check
  if ($DryRun) { Write-Dry 'wsl.exe --status'; return }
  $wsl = Get-Command wsl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $wsl) { [Console]::Error.WriteLine('wsl_not_ready: wsl.exe is unavailable'); exit 20 }
  # under 'Stop', Windows PowerShell 5.1 would turn a line of wsl's stderr into an error, not exit 20 (T82)
  $null = & { $ErrorActionPreference = 'Continue'; & $wsl.Source --status 2>&1 }
  if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine('wsl_not_ready: WSL is not usable'); exit 20 }
  Write-Ok (T 'WSL is ready' "WSL e' pronto")
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
  Write-Info "$(T 'Podman machine of this Windows user:' 'Macchina Podman di questo utente Windows:') $machineName"
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
  try {
    $env:JHT_RUNTIME_DIR = $RuntimeDir
    $env:JHT_BIN_DIR = $BinDir
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
  $again = 'Then run the same install command again: it starts over from the beginning.'
  switch ($Code) {
    21 {
      Write-JhtProblem -What 'Podman could not be installed.' -Todo @(
        'The line above says why. Podman comes from winget, or from its official release when winget',
        'cannot be used: check that this computer can reach github.com, and that winget works if you have it',
        '(for a broken one, install or repair "App Installer": https://aka.ms/getwinget).',
        $again)
    }
    22 {
      Write-JhtProblem -What 'The Podman machine of Job Hunter Team could not be created or started.' -Todo @(
        'The line above says why. Check that WSL works: run "wsl --status" in PowerShell.',
        'If a restart of Windows is pending, restart it.',
        $again)
    }
    23 {
      Write-JhtProblem -What 'The Podman machine started but its network is not ready.' -Todo @(
        'The line above says why. Wait a minute and run the same install command again;',
        'if it stops here again, restart Windows first.')
    }
    24 {
      Write-JhtProblem -What 'Another Podman version is installed on this computer.' -Todo @(
        'Job Hunter Team runs on Podman 6 and does not change another Podman.',
        'Update it to version 6, or remove it (Settings > Apps), whichever you prefer.',
        $again)
    }
    25 {
      Write-JhtProblem -What 'Podman is installed for another Windows user of this computer.' -Todo @(
        'Run the installer as that Windows user, or remove Podman for the computer',
        '(Settings > Apps) and run the install command again.')
    }
    26 {
      Write-JhtProblem -What 'Podman started the machine, but its connection for Docker tools (win-sshproxy.exe) did not start.' -Todo @(
        'The line above says why. Run the installer from the Windows desktop of this user (the Start menu,',
        'Windows PowerShell), not from ssh, a service or a scheduled task: those run without a desktop.',
        $again,
        'Only if it stops here again from the desktop: restart Windows, then run it once more.')
    }
    default {
      Write-JhtProblem -What "The Podman setup stopped (exit code $Code)." -Todo @(
        'The line above says why. Run the same install command again;',
        'if it stops at the same place, keep that line and ask for help.')
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
  Write-Step 3 $TotalSteps (T 'Downloading and enabling the Podman runtime' 'Scarico e attivo il runtime Podman')
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
    } catch { Write-Fail "Cannot resolve branch '$Branch' to an immutable release commit." }
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
    Write-Fail "Protected host runtime path overlaps a container-writable tree: $runtimeFull"
  }
  if ($binFull.Equals($legacyFull, [StringComparison]::OrdinalIgnoreCase) -or $binFull.StartsWith($legacyFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
      $binFull.Equals($userDataFull, [StringComparison]::OrdinalIgnoreCase) -or $binFull.StartsWith($userDataFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    Write-Fail "Protected host wrapper path overlaps a container-writable tree: $binFull"
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
      if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { Write-Fail "Protected host path has a reparse-point ancestor: $protectedPath" }
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
    if (-not (Select-String -LiteralPath (Join-Path $stage 'docker-compose.yml') -Pattern '^\s*-\s*jht-runtime-mask:/jht_home/runtime(?:\s|$)' -Quiet)) { Write-Fail 'Downloaded compose does not enforce the protected runtime boundary.' }
    if (-not (Select-String -LiteralPath (Join-Path $stage 'docker-compose.podman.yml') -SimpleMatch 'keep-id:uid=1001,gid=1001' -Quiet)) { Write-Fail 'Downloaded Podman override lacks keep-id.' }
    if (-not (Select-String -LiteralPath (Join-Path $stageScripts 'jht-wrapper.ps1') -SimpleMatch '$JHT_HOST_RUNTIME_PROTOCOL = 1' -Quiet)) { Write-Fail 'Downloaded wrapper lacks the protected runtime protocol.' }
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
    if (-not (Test-Path -LiteralPath $published -PathType Leaf)) { Write-Fail "Podman runtime artifact missing: $published" }
    Set-JhtNodeOwner -Path $published
  }
  . $helperDest
  if (-not (Test-PrivateJhtHomeAcl -Path $JhtHome)) { Write-Fail "JHT_HOME ACL verification failed after repair: $JhtHome" }

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
# the install added it) is not in that window's PATH, and only a new window, or this line, brings it in.
# No restart of the computer is needed.
function Write-JhtNewWindowNotice {
  Write-Host "  $(T 'jht and podman are on your PATH from now on, but THIS PowerShell window was open before the' "da adesso jht e podman sono nel PATH, ma QUESTA finestra di PowerShell era aperta prima dell'")" -ForegroundColor Yellow
  Write-Host "  $(T 'install and may not know them yet ("not recognized as the name of a cmdlet").' 'installazione e potrebbe non conoscerli ancora ("non riconosciuto come nome di cmdlet").')" -ForegroundColor Yellow
  Write-Host "  $(T 'Open a NEW PowerShell window to use jht and podman. No restart of the computer is needed.' 'Apri una NUOVA finestra di PowerShell per usare jht e podman. Non serve riavviare il computer.')" -ForegroundColor Yellow
  Write-Host "  $(T 'To use them in this window right away, paste:' 'Per usarli subito in questa finestra, incolla:')" -ForegroundColor DarkGray
  Write-Host "    `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')" -ForegroundColor White
  Write-Host ""
}

function Add-ToUserPath {
  Write-Step 4 $TotalSteps (T 'Registering the user PATH' "Registro il PATH dell'utente")

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
    Write-Ok "$BinDir $(T 'already in the user PATH' "e' gia' nel PATH dell'utente")"
  } else {
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Ok (T 'User PATH updated (effective from the next terminal)' "PATH dell'utente aggiornato (vale dal prossimo terminale)")
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

function Write-HostEnv {
  Write-Step 5 $TotalSteps (T 'Writing host.env' 'Scrivo host.env')

  $hostEnvFile = Join-Path $JhtHome 'host.env'
  $hostType = if ($PairingToken) { 'vps' } else { 'local' }
  $lang = Get-JhtPersonLanguage

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
JHT_LANG=$lang
JHT_USER_TZ=$tz
"@

  if ($DryRun) {
    Write-Dry "Set-Content $hostEnvFile (JHT_HOST_TYPE=$hostType, JHT_LANG=$lang, JHT_USER_TZ=$tz)"
  } else {
    Write-HostFile -Path $hostEnvFile -Content $content
    Write-Ok "$(T 'host.env written:' 'host.env scritto:') $hostEnvFile (mode=$hostType, lang=$lang, tz=$tz)"
  }

  # Pairing token: saved to $JhtHome\.pairing-token with restrictive perms
  # (Windows ACL: only the USERPROFILE owner reads/writes). The container
  # reads it on first boot via `jht cloud pair`.
  if ($PairingToken) {
    $tokenFile = Join-Path $JhtHome '.pairing-token'
    if ($DryRun) {
      Write-Dry "Set-Content $tokenFile (pairing token, ACL owner-only)"
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
          Write-Warn "ACL restriction failed (file still readable by Users): $($_.Exception.Message)"
        }
      }
      Write-HostFile -Path $tokenFile -Content $PairingToken -Encoding ASCII -NoNewline -Prepare $restrictAcl

      Write-Ok "$(T 'Pairing token saved:' 'Token di abbinamento salvato:') $tokenFile"
    }
  }
}

# ── Final message + optional onboarding ───────────────────────────────────
function Show-Final {
  Write-Host ""
  Write-Host "+------------------------------------------+" -ForegroundColor Green
  Write-Host (T '|  Installation complete!                  |' '|  Installazione completata!               |') -ForegroundColor Green
  Write-Host "+------------------------------------------+" -ForegroundColor Green
  Write-Host ""
  Write-Host "  $(T 'Container mode active.' "Modalita' container attiva.")" -ForegroundColor White
  Write-Host "  $(T 'The agents only see:' 'Gli agenti vedono solo:')" -ForegroundColor DarkGray
  Write-Host "    $JhtHome                          -> /jht_home $(T '(config, db, agents)' '(configurazione, db, agenti)')" -ForegroundColor DarkGray
  Write-Host "    $env:USERPROFILE\Documents\Job Hunter Team -> /jht_user $(T '(CVs, attachments, output)' '(CV, allegati, risultati)')" -ForegroundColor DarkGray
  Write-Host ""

  # Not for the desktop app, which reads this output through a pipe, nor for a dry run (nothing was installed).
  if (-not $DryRun -and $env:JHT_MACHINE_OUTPUT -ne '1') { Write-JhtNewWindowNotice }
  if (-not (Test-WillAutoOnboard)) {
    Write-Host "  $(T 'Next steps:' 'Prossimi passi:')" -ForegroundColor White
    Write-Host ""
    if ($script:PathReady) {
      Write-Host "      jht setup        # $(T 'setup wizard (also starts the container)' 'configurazione guidata (accende anche il container)')" -ForegroundColor White
    } else {
      Write-Host "      $BinDir\jht.cmd setup" -ForegroundColor White
    }
    Write-Host ""
  }

  # `jht uninstall` stops the team and takes away the machine (with its images), the runtime and the `jht` command; the data stays.
  Write-Host "  $(T 'To uninstall (keeps the data in ~/.jht and ~/Documents/Job Hunter Team):' 'Per disinstallare (i dati in ~/.jht e ~/Documents/Job Hunter Team restano):')" -ForegroundColor DarkGray
  Write-Host "    jht uninstall --confirm" -ForegroundColor DarkGray
  Write-Host "  $(T 'To delete the data as well (config, db, CVs, output):' 'Per cancellare anche i dati (configurazione, db, CV, risultati):')" -ForegroundColor DarkGray
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
      Write-Info (T 'Pairing token present: skipping the interactive wizard. The container will complete the pairing on first boot.' "Token di abbinamento presente: salto il wizard interattivo. Il container completera' l'abbinamento al primo avvio.")
    }
    return
  }
  Write-Host ""
  Write-Info (T 'Launching the setup wizard...' 'Avvio la configurazione guidata...')
  # Use the CMD shim, which handles the ExecutionPolicy. PathReady guarantees
  # that `jht.cmd` is reachable in this session.
  & "$BinDir\jht.cmd" setup
  if ($LASTEXITCODE -ne 0) {
    Write-Warn (T 'The wizard exited with an error. Re-run it with: jht setup' "La configurazione guidata e' uscita con un errore. Rilanciala con: jht setup")
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

function Assert-NoLegacyDockerTeam {
  $docker = Get-JhtLegacyDockerCli
  if (-not $docker) { return }
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
    T "an earlier Job Hunter Team is still running on Docker Desktop (container $($names -join ', ')). Since 0.4 the team runs in a Podman machine: installed next to it, two teams would work on the same data. Nothing was changed." "su Docker Desktop gira ancora una versione precedente di Job Hunter Team (container $($names -join ', ')). Dalla 0.4 il team gira in una macchina Podman: installata accanto, ci sarebbero due team sugli stessi dati. Non e' stato cambiato niente."
  } else {
    T "an earlier Job Hunter Team is still installed on Docker Desktop (container $($names -join ', '), stopped; it starts again with Docker Desktop). Since 0.4 the team runs in a Podman machine: installed next to it, two teams would work on the same data. Nothing was changed." "su Docker Desktop c'e' ancora una versione precedente di Job Hunter Team (container $($names -join ', '), fermo; ripartirebbe con Docker Desktop). Dalla 0.4 il team gira in una macchina Podman: installata accanto, ci sarebbero due team sugli stessi dati. Non e' stato cambiato niente."
  }
  if (Test-JhtMachineOutput) {
    [Console]::Error.WriteLine("runtime_change_requires_migration: an earlier JHT container on Docker Desktop ($($names -join ', ')); stop and remove it, then run the installer again.")
    Remove-JhtCreatedEmptyDirs
    exit $RuntimeChangeRequiresMigrationExit
  }
  $todo = @(
    (T 'Stop and remove the old team (Docker Desktop on), in PowerShell:' 'Ferma e togli il team vecchio (con Docker Desktop acceso), in PowerShell:'),
    "  docker stop $($names -join ' ')",
    "  docker rm $($names -join ' ')",
    (T 'Your data stays: ~/.jht (configuration, database, profile) and Documents\Job Hunter Team (CVs, outputs) are folders of this computer, and the new team uses them.' "I tuoi dati restano: ~/.jht (configurazione, database, profilo) e Documenti\Job Hunter Team (CV, risultati) sono cartelle di questo computer, e il nuovo team le usa.")
  )
  if ($volumes.Count -gt 0) {
    # The 0.3.x installer took the compose of the branch at the time of the install: by then it can have the volumes of the secrets too.
    $todo += (T 'In Docker Desktop the volumes of the old team stay: provider tools and, by the version, the API key kept by the setup, the mail password and the Telegram tokens. The new team does not read them: give those again with jht setup. If you do not need them any more:' "In Docker Desktop restano i volumi del team vecchio: strumenti dei provider e, secondo la versione, la chiave API salvata dal setup, la password della posta e i token di Telegram. Il nuovo team non li legge: quelli vanno ridati con jht setup. Se non ti servono piu':")
    $todo += "  docker volume rm $($volumes -join ' ')"
  }
  if ($images.Count -gt 0) {
    $todo += (T 'And its image, to free the disk:' "E la sua immagine, per liberare il disco:")
    $todo += "  docker image rm $($images -join ' ')"
  }
  $todo += (T 'Then run this installer again.' 'Poi rilancia questo installer.')
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

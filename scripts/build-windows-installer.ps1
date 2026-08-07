#!/usr/bin/env pwsh
# Build and optionally smoke-test the staged NSIS installer.
# This script is deliberately not wired into release.yml yet: publishing the
# installer remains an operator decision. It makes that later workflow change
# a single invocation while preserving the current portable release asset.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$')]
  [string]$Version,

  [Parameter(Mandatory = $true)]
  [string]$AuthorityDirectory,

  [switch]$Smoke,

  # CI seam: Initialize exercises the real creation/protection path; Assert is
  # read-only. Neither mode requires an export, signature, or NSIS build.
  [ValidateSet('', 'Initialize', 'Assert')]
  [string]$AclSelfTestMode = '',

  [string]$AclSelfTestPath = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

function Get-FileSystemParent {
  param([IO.FileSystemInfo]$Node)
  if ($Node -is [IO.FileInfo]) { return $Node.Directory }
  if ($Node -is [IO.DirectoryInfo]) { return $Node.Parent }
  throw 'Unexpected filesystem node type during installer path traversal.'
}

function Assert-NoReparseAncestors {
  param([string]$Path)
  $full = [IO.Path]::GetFullPath($Path)
  $probe = if (Test-Path -LiteralPath $full) { Get-Item -LiteralPath $full -Force } else { Get-Item -LiteralPath ([IO.Path]::GetDirectoryName($full)) -Force }
  while ($probe) {
    if (($probe.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Installer authority path contains a reparse point: $Path"
    }
    $parent = Get-FileSystemParent $probe
    if ($null -eq $parent -or $parent.FullName -eq $probe.FullName) { break }
    $probe = $parent
  }
}

function Initialize-ProtectedDirectory {
  param([string]$Path)
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
  Assert-NoReparseAncestors $Path
  $item = [IO.DirectoryInfo]::new([IO.Path]::GetFullPath($Path))
  $acl = [IO.FileSystemAclExtensions]::GetAccessControl($item, [Security.AccessControl.AccessControlSections]::All)
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.SetOwner($currentSid)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($acl.GetAccessRules(
      $true, $true, [Security.Principal.SecurityIdentifier]) |
      ForEach-Object { $_.IdentityReference } | Select-Object -Unique)) {
    $acl.PurgeAccessRules($identity)
  }
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $currentSid,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit',
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow)
  $acl.SetAccessRule($rule)
  [IO.FileSystemAclExtensions]::SetAccessControl($item, $acl)
  Assert-ProtectedDirectory $Path
}

function Assert-ProtectedDirectory {
  param([string]$Path)
  Assert-NoReparseAncestors $Path
  $item = [IO.DirectoryInfo]::new([IO.Path]::GetFullPath($Path))
  $verified = [IO.FileSystemAclExtensions]::GetAccessControl($item, [Security.AccessControl.AccessControlSections]::All)
  if (-not $verified.AreAccessRulesProtected) { throw 'Installer authority staging still inherits its DACL.' }
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $ownerSid = $verified.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -ne $currentSid) { throw 'Installer authority directory has a foreign owner.' }
  $writeMask = [Security.AccessControl.FileSystemRights]::WriteData -bor [Security.AccessControl.FileSystemRights]::AppendData -bor [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor [Security.AccessControl.FileSystemRights]::WriteAttributes -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach ($rule in $verified.GetAccessRules(
      $true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne 'Allow' -or (([Security.AccessControl.FileSystemRights]$rule.FileSystemRights -band $writeMask) -eq 0)) { continue }
    $sid = $rule.IdentityReference.Value
    if ($sid -ne $currentSid) { throw 'Installer authority directory grants write to another principal.' }
  }
}

if (-not $IsWindows) {
  throw 'The native installer smoke must run on Windows.'
}
if ($AclSelfTestMode) {
  if (-not $AclSelfTestPath) { throw 'ACL self-test path is required.' }
  if ($AclSelfTestMode -eq 'Initialize') {
    if (Test-Path -LiteralPath $AclSelfTestPath) {
      throw 'ACL initialize self-test requires an absent directory.'
    }
    Initialize-ProtectedDirectory $AclSelfTestPath
  } else {
    Assert-ProtectedDirectory $AclSelfTestPath
  }
  [ordered]@{ acl = 'protected'; mode = $AclSelfTestMode } | ConvertTo-Json -Compress
  return
}
$root = Split-Path -Parent $PSScriptRoot
$gameDir = Join-Path $root 'game'
$portable = Join-Path $gameDir 'builds/windows/job-hunter-team.exe'
$setup = Join-Path $gameDir 'builds/windows/job-hunter-team-windows-x64-setup.exe'
$nsi = Join-Path $gameDir 'installer/windows.nsi'
$numericVersion = (($Version -split '-', 2)[0]) + '.0'
$authoritySource = [IO.Path]::GetFullPath($AuthorityDirectory)
$stagingRoot = Join-Path $env:LOCALAPPDATA ('Job Hunter Team\installer-authority-' + [guid]::NewGuid().ToString('N'))
$authority = [IO.Path]::GetFullPath($stagingRoot)
$authorityFiles = @()
try {
  if (-not (Test-Path -LiteralPath $portable -PathType Leaf)) {
    throw "Portable Windows export missing: $portable"
  }
  Assert-NoReparseAncestors $authoritySource
  Initialize-ProtectedDirectory $authority
  foreach ($name in @('job-hunter-team-windows-x64-portable.exe', 'jht-windows-update.ps1', 'RELEASE-MANIFEST.json', 'RELEASE-MANIFEST.json.sig')) {
    $source = Join-Path $authoritySource $name
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Signed update authority missing: $source" }
    Assert-NoReparseAncestors $source
    Copy-Item -LiteralPath $source -Destination (Join-Path $authority $name) -ErrorAction Stop
  }
  $authorityFiles = @(
    (Join-Path $authority 'jht-windows-update.ps1'),
    (Join-Path $authority 'RELEASE-MANIFEST.json'),
    (Join-Path $authority 'RELEASE-MANIFEST.json.sig'),
    (Join-Path $authority 'job-hunter-team-windows-x64-portable.exe')
  )
  $env:JHT_INSTALLER_AUTHORITY = $authority
  if ((Get-Item -LiteralPath $authorityFiles[2]).Length -ne 384) {
    throw 'Detached release signature must be exactly 384 raw bytes.'
  }
  $fingerprint = & python scripts/release_signing.py fingerprint `
    --public-key scripts/release-keys/production-spki.pem
  if ($LASTEXITCODE -ne 0 -or $fingerprint -ne '3ab73bd9203a2e4f5d01a61bfecbb2bd891663164732a647af8c9164da97a0b2') {
    throw 'Production release trust root fingerprint mismatch.'
  }
  & python scripts/release_signing.py verify `
    --manifest $authorityFiles[1] --signature $authorityFiles[2] `
    --public-key scripts/release-keys/production-spki.pem
  if ($LASTEXITCODE -ne 0) { throw 'Signed release authority verification failed.' }
  & python -c "import os; from pathlib import Path; from scripts.release_manifest import parse_manifest_bytes,verify_artifact_files; p=Path(os.environ['JHT_INSTALLER_AUTHORITY']); verify_artifact_files(directory=p,manifest=parse_manifest_bytes((p/'RELEASE-MANIFEST.json').read_bytes()))"
  if ($LASTEXITCODE -ne 0) { throw 'Signed release artifact binding failed.' }
  if ((Get-FileHash -LiteralPath $portable -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $authorityFiles[3] -Algorithm SHA256).Hash) {
    throw 'Portable input differs from the signed Windows desktop artifact.'
  }

$makensisCommand = Get-Command makensis.exe -ErrorAction SilentlyContinue
if ($makensisCommand) {
  $makensis = $makensisCommand.Source
} else {
  $knownMakensis = Join-Path ${env:ProgramFiles(x86)} 'NSIS/makensis.exe'
  if (Test-Path -LiteralPath $knownMakensis -PathType Leaf) {
    $makensis = $knownMakensis
  } else {
    throw 'makensis.exe not found on PATH or in Program Files (x86)/NSIS.'
  }
}

Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
  # Reattestazione immediatamente prima che makensis consumi i File: staging
  # owner-only, nessun reparse e binding firma+size+SHA ancora esatti.
  foreach ($required in $authorityFiles) { Assert-NoReparseAncestors $required }
  Assert-ProtectedDirectory $authority
  & python scripts/release_signing.py verify --manifest $authorityFiles[1] `
    --signature $authorityFiles[2] --public-key scripts/release-keys/production-spki.pem
  if ($LASTEXITCODE -ne 0) { throw 'Signed release authority changed before packaging.' }
  & python -c "import os; from pathlib import Path; from scripts.release_manifest import parse_manifest_bytes,verify_artifact_files; p=Path(os.environ['JHT_INSTALLER_AUTHORITY']); verify_artifact_files(directory=p,manifest=parse_manifest_bytes((p/'RELEASE-MANIFEST.json').read_bytes()))"
  if ($LASTEXITCODE -ne 0) { throw 'Signed release artifacts changed before packaging.' }
  & $makensis /V4 "/DVERSION=$Version" "/DVERSION_NUMERIC=$numericVersion" `
    "/DAUTHORITY_DIR=$authority" $nsi
if ($LASTEXITCODE -ne 0) {
  throw "makensis failed with exit code $LASTEXITCODE"
}
if (-not (Test-Path -LiteralPath $setup -PathType Leaf)) {
  throw "NSIS output missing: $setup"
}

$versionInfo = (Get-Item -LiteralPath $setup).VersionInfo
if ($versionInfo.ProductName -ne 'Job Hunter Team') {
  throw "Unexpected installer ProductName: $($versionInfo.ProductName)"
}
if ($versionInfo.ProductVersion -ne $Version) {
  throw "Unexpected installer ProductVersion: $($versionInfo.ProductVersion)"
}
if ($versionInfo.FileVersion -ne $numericVersion) {
  throw "Unexpected installer FileVersion: $($versionInfo.FileVersion)"
}

if ($Smoke) {
  $installDir = Join-Path $env:LOCALAPPDATA 'Programs/Job Hunter Team'
  $installedExe = Join-Path $installDir 'job-hunter-team.exe'
  $uninstaller = Join-Path $installDir 'Uninstall.exe'
  $installedHelper = Join-Path $installDir 'jht-windows-update.ps1'
  $installedManifest = Join-Path $installDir 'RELEASE-MANIFEST.json'
  $installedSignature = Join-Path $installDir 'RELEASE-MANIFEST.json.sig'
  $desktopShortcut = Join-Path $env:USERPROFILE 'Desktop/Job Hunter Team.lnk'
  $startMenuDir = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs/Job Hunter Team'
  $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JobHunterTeam'
  $hostileSentinel = Join-Path $env:LOCALAPPDATA ('jht-installer-sentinel-' + [guid]::NewGuid().ToString('N'))
  $installedHelperBytes = $null

  if (Test-Path -LiteralPath $installDir) {
    throw "Refusing to overwrite an existing per-user installation: $installDir"
  }

  # Baseline realistica v0.3.5: path per-user ereditato, solo vecchio EXE/icona
  # e nessuna authority updater. Il setup manuale 0.3.6 deve censirla senza
  # mutare nulla, quindi proteggerla e completare la migrazione forward-only.
  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  [IO.File]::WriteAllText($installedExe, 'legacy-v0.3.5-placeholder')
  [IO.File]::WriteAllText((Join-Path $installDir 'icon.ico'), 'legacy-icon')
  $legacyAcl = [IO.FileSystemAclExtensions]::GetAccessControl(
    [IO.DirectoryInfo]$installDir,
    [Security.AccessControl.AccessControlSections]::All)
  if ($legacyAcl.AreAccessRulesProtected) {
    throw 'Synthetic v0.3.5 baseline unexpectedly has a protected DACL.'
  }

  try {
    $install = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
    if ($install.ExitCode -ne 0) {
      throw "Silent installer exited with $($install.ExitCode)"
    }
    foreach ($required in @($installedExe, $installedHelper, $installedManifest,
        $installedSignature, $uninstaller, $desktopShortcut, $startMenuDir, $uninstallKey)) {
      if (-not (Test-Path -LiteralPath $required)) {
        throw "Installer did not create expected per-user target: $required"
      }
    }
    if ((Get-ItemPropertyValue -LiteralPath $uninstallKey -Name DisplayVersion) -ne $Version) {
      throw 'Apps & Features DisplayVersion does not match the release version.'
    }
    if ((Get-FileHash -LiteralPath $portable -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash) {
      throw 'Installed executable does not match the exported portable executable.'
    }
    foreach ($pair in @(
        @($authorityFiles[0], $installedHelper),
        @($authorityFiles[1], $installedManifest),
        @($authorityFiles[2], $installedSignature))) {
      if ((Get-FileHash -LiteralPath $pair[0] -Algorithm SHA256).Hash -ne
          (Get-FileHash -LiteralPath $pair[1] -Algorithm SHA256).Hash) {
        throw "Installed signed authority differs: $($pair[1])"
      }
    }
    Assert-ProtectedDirectory $installDir

    # Reinstallazione vera sullo stesso path protetto: il preflight deve
    # accettare soltanto l'autorita che l'installer ha appena materializzato.
    $reinstall = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
    if ($reinstall.ExitCode -ne 0) {
      throw "Silent reinstall exited with $($reinstall.ExitCode)"
    }
    foreach ($pair in @(
        @($portable, $installedExe),
        @($authorityFiles[0], $installedHelper),
        @($authorityFiles[1], $installedManifest),
        @($authorityFiles[2], $installedSignature))) {
      if ((Get-FileHash -LiteralPath $pair[0] -Algorithm SHA256).Hash -ne
          (Get-FileHash -LiteralPath $pair[1] -Algorithm SHA256).Hash) {
        throw "Reinstall changed signed authority bytes: $($pair[1])"
      }
    }
    Assert-ProtectedDirectory $installDir

    # Un hardlink preesistente deve abortire PRIMA che NSIS sovrascriva byte,
    # ACL o registry. Il sentinel esterno sullo stesso volume resta immutato.
    $installedHelperBytes = [IO.File]::ReadAllBytes($installedHelper)
    [IO.File]::WriteAllText($hostileSentinel, 'installer-sentinel-do-not-mutate')
    $sentinelHash = (Get-FileHash -LiteralPath $hostileSentinel -Algorithm SHA256).Hash
    $exeHash = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash
    Remove-Item -LiteralPath $installedHelper -Force
    New-Item -ItemType HardLink -Path $installedHelper -Target $hostileSentinel | Out-Null
    $blocked = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
    if ($blocked.ExitCode -eq 0) { throw 'Installer accepted a hostile hardlink child.' }
    if ((Get-FileHash -LiteralPath $hostileSentinel -Algorithm SHA256).Hash -ne $sentinelHash) {
      throw 'Installer mutated the hardlink sentinel before failing.'
    }
    if ((Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash -ne $exeHash) {
      throw 'Installer mutated another payload before rejecting the hardlink.'
    }
    if ((Get-ItemPropertyValue -LiteralPath $uninstallKey -Name DisplayVersion) -ne $Version) {
      throw 'Installer mutated registry state before rejecting the hardlink.'
    }
    Remove-Item -LiteralPath $installedHelper -Force
    [IO.File]::WriteAllBytes($installedHelper, $installedHelperBytes)
    Remove-Item -LiteralPath $hostileSentinel -Force
    $installedHelperBytes = $null

    $previousNoVps = $env:JHT_NOVPS
    $env:JHT_NOVPS = '1'
    try {
      $launch = Start-Process -FilePath $installedExe -ArgumentList '--headless', '--quit-after', '3' -Wait -PassThru
      if ($launch.ExitCode -ne 0) {
        throw "Installed application smoke exited with $($launch.ExitCode)"
      }
    } finally {
      $env:JHT_NOVPS = $previousNoVps
    }
  } finally {
    if (Test-Path -LiteralPath $hostileSentinel -PathType Leaf) {
      if (Test-Path -LiteralPath $installedHelper -PathType Leaf) {
        Remove-Item -LiteralPath $installedHelper -Force
      }
      if ($null -ne $installedHelperBytes) {
        [IO.File]::WriteAllBytes($installedHelper, $installedHelperBytes)
      }
      Remove-Item -LiteralPath $hostileSentinel -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
      $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
      if ($uninstall.ExitCode -ne 0) {
        throw "Silent uninstaller exited with $($uninstall.ExitCode)"
      }
    }
  }

  foreach ($removed in @($installedExe, $installedHelper, $installedManifest,
      $installedSignature, $uninstaller, $desktopShortcut, $startMenuDir, $uninstallKey)) {
    if (Test-Path -LiteralPath $removed) {
      throw "Uninstaller left a published target behind: $removed"
    }
  }
}

  $hash = Get-FileHash -LiteralPath $setup -Algorithm SHA256
  $output = [ordered]@{
    setup = $setup
    sha256 = $hash.Hash.ToLowerInvariant()
    version = $Version
    portable = $portable
    smoke = [bool]$Smoke
  }
} finally {
  Remove-Item Env:JHT_INSTALLER_AUTHORITY -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}
$output | ConvertTo-Json -Compress

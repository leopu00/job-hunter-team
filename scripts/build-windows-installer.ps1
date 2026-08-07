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

  [switch]$Smoke
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$gameDir = Join-Path $root 'game'
$portable = Join-Path $gameDir 'builds/windows/job-hunter-team.exe'
$setup = Join-Path $gameDir 'builds/windows/job-hunter-team-windows-x64-setup.exe'
$nsi = Join-Path $gameDir 'installer/windows.nsi'
$numericVersion = (($Version -split '-', 2)[0]) + '.0'
$authority = [IO.Path]::GetFullPath($AuthorityDirectory)
$authorityFiles = @(
  (Join-Path $authority 'jht-windows-update.ps1'),
  (Join-Path $authority 'RELEASE-MANIFEST.json'),
  (Join-Path $authority 'RELEASE-MANIFEST.json.sig')
)

if (-not $IsWindows) {
  throw 'The native installer smoke must run on Windows.'
}
if (-not (Test-Path -LiteralPath $portable -PathType Leaf)) {
  throw "Portable Windows export missing: $portable"
}
foreach ($required in $authorityFiles) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Signed update authority missing: $required"
  }
}
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

  if (Test-Path -LiteralPath $installDir) {
    throw "Refusing to overwrite an existing per-user installation: $installDir"
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
    $acl = Get-Acl -LiteralPath $installDir
    if (-not $acl.AreAccessRulesProtected) {
      throw 'Installed updater directory still inherits its DACL.'
    }

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
[ordered]@{
  setup = $setup
  sha256 = $hash.Hash.ToLowerInvariant()
  version = $Version
  portable = $portable
  smoke = [bool]$Smoke
} | ConvertTo-Json -Compress

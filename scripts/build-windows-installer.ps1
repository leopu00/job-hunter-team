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

  [switch]$Smoke
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$gameDir = Join-Path $root 'game'
$portable = Join-Path $gameDir 'builds/windows/job-hunter-team.exe'
$setup = Join-Path $gameDir 'builds/windows/job-hunter-team-windows-x64-setup.exe'
$nsi = Join-Path $gameDir 'installer/windows.nsi'
$numericVersion = (($Version -split '-', 2)[0]) + '.0'

function Get-FileObservation {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  $item = Get-Item -LiteralPath $Path
  $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  return '{0}:{1}:{2}' -f $item.LastWriteTimeUtc.Ticks, $item.Length, $hash
}

if (-not $IsWindows) {
  throw 'The native installer smoke must run on Windows.'
}
if (-not (Test-Path -LiteralPath $portable -PathType Leaf)) {
  throw "Portable Windows export missing: $portable"
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
& $makensis /V4 "/DVERSION=$Version" "/DVERSION_NUMERIC=$numericVersion" $nsi
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
  $desktopShortcut = Join-Path $env:USERPROFILE 'Desktop/Job Hunter Team.lnk'
  $startMenuDir = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs/Job Hunter Team'
  $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\JobHunterTeam'
  # Godot's stable Windows `user://`. project.godot pins this exact historical
  # path independently from config/name: the workflow deliberately exports a
  # renamed product and the launch below must still update the log here.
  # The uninstaller leaves it alone unless the user ticks the opt-in component.
  # [WIN-USERDIR-SURVIVES-REINSTALL] [WIN-USERDIR-ORPHANED-BY-RENAME]
  $userDataDir = Join-Path $env:APPDATA 'Godot/app_userdata/Job Hunter Team'
  $userDataSentinel = Join-Path $userDataDir 'smoke-userdata-sentinel.txt'
  $userDataRuntimeLog = Join-Path $userDataDir 'jht-game.log'

  if (Test-Path -LiteralPath $installDir) {
    throw "Refusing to overwrite an existing per-user installation: $installDir"
  }

  try {
    $install = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
    if ($install.ExitCode -ne 0) {
      throw "Silent installer exited with $($install.ExitCode)"
    }
    foreach ($required in @($installedExe, $uninstaller, $desktopShortcut, $startMenuDir, $uninstallKey)) {
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

    $previousNoVps = $env:JHT_NOVPS
    $env:JHT_NOVPS = '1'
    $userDataRuntimeLogBefore = Get-FileObservation $userDataRuntimeLog
    try {
      $launch = Start-Process -FilePath $installedExe -ArgumentList '--headless', '--quit-after', '3' -Wait -PassThru
      if ($launch.ExitCode -ne 0) {
        throw "Installed application smoke exited with $($launch.ExitCode)"
      }
    } finally {
      $env:JHT_NOVPS = $previousNoVps
    }

    $userDataRuntimeLogAfter = Get-FileObservation $userDataRuntimeLog
    if ($null -eq $userDataRuntimeLogAfter) {
      throw "Renamed application did not write its log to stable user data: $userDataRuntimeLog"
    }
    if ($null -ne $userDataRuntimeLogBefore -and
        $userDataRuntimeLogAfter -eq $userDataRuntimeLogBefore) {
      throw "Renamed application did not update the pre-existing stable user data log: $userDataRuntimeLog"
    }

    # A file of the user's, placed where the user's files live, before the
    # uninstaller runs. Nothing else in this smoke would notice if a future
    # edit made the uninstaller wipe the directory — and by the time a real
    # user noticed, their profile would be gone.
    New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null
    Set-Content -LiteralPath $userDataSentinel -Value 'user data must survive' -Encoding utf8
  } finally {
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
      $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -Wait -PassThru
      if ($uninstall.ExitCode -ne 0) {
        throw "Silent uninstaller exited with $($uninstall.ExitCode)"
      }
    }
  }

  foreach ($removed in @($installedExe, $uninstaller, $desktopShortcut, $startMenuDir, $uninstallKey)) {
    if (Test-Path -LiteralPath $removed) {
      throw "Uninstaller left a published target behind: $removed"
    }
  }

  # The other direction, and it is a directive rather than a preference: a
  # silent uninstall keeps the user's data. Removing it is an opt-in component
  # on the uninstaller's page, deselected by default, and `/S` cannot select
  # it. An installer that takes a profile away on its own is the worst damage
  # this product can do.
  if (-not (Test-Path -LiteralPath $userDataSentinel)) {
    throw "Silent uninstall deleted user data: $userDataDir must survive (see game/installer/windows.nsi)"
  }
  Remove-Item -LiteralPath $userDataSentinel -Force
}

$hash = Get-FileHash -LiteralPath $setup -Algorithm SHA256
[ordered]@{
  setup = $setup
  sha256 = $hash.Hash.ToLowerInvariant()
  version = $Version
  portable = $portable
  smoke = [bool]$Smoke
} | ConvertTo-Json -Compress

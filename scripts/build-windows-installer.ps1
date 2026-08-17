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

function Get-FileObservation {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  # Il logger Godot mantiene il file aperto durante il probe. Metadata e size
  # attestano l'avanzamento senza contendere il file handle al processo vivo.
  $item = Get-Item -LiteralPath $Path
  return '{0}:{1}' -f $item.LastWriteTimeUtc.Ticks, $item.Length
}

if (-not $IsWindows) {
  throw 'The native installer smoke must run on Windows.'
}
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
    $previousGuardPckTest = $env:JHT_WINDOWS_INSTANCE_GUARD_PCK_TEST
    $env:JHT_NOVPS = '1'
    $guardStdout = Join-Path $env:TEMP ('jht-instance-guard-' + [guid]::NewGuid().ToString('N') + '.out')
    $guardStderr = Join-Path $env:TEMP ('jht-instance-guard-' + [guid]::NewGuid().ToString('N') + '.err')
    $userDataRuntimeLogBefore = Get-FileObservation $userDataRuntimeLog
    $userDataRuntimeLogAfter = $null
    $first = $null
    $firstGuardPid = $null
    try {
      # Il source eseguito viene letto dal PCK dell'artefatto, non dal checkout:
      # il census esatto lega byte, hash e argv alla guardia che verra pubblicata.
      $env:JHT_WINDOWS_INSTANCE_GUARD_PCK_TEST = '1'
      $sourceProbe = Start-Process -FilePath $installedExe `
        -ArgumentList '--headless', '--quit-after', '10' -Wait -PassThru `
        -RedirectStandardOutput $guardStdout -RedirectStandardError $guardStderr
      $expectedCensus = 'WINDOWS-INSTANCE-GUARD-PCK source=exported-pck bytes=9965 argv_utf16=26696 sha256=bb90ae8f9f1f0cff7d41ceedc3eec380f18b78d7b4f4b07921606afda8b8054b'
      $sourceOutput = if (Test-Path -LiteralPath $guardStdout) {
        Get-Content -LiteralPath $guardStdout -Raw
      } else { '' }
      $sourceMatches = @($sourceOutput -split "`r?`n" | Where-Object { $_ -ceq $expectedCensus })
      if ($sourceProbe.ExitCode -ne 0 -or $sourceMatches.Count -ne 1) {
        $sourceError = if (Test-Path -LiteralPath $guardStderr) {
          Get-Content -LiteralPath $guardStderr -Raw
        } else { '' }
        $sidecarCode = [regex]::Match($sourceError, 'JHT-INSTANCE-GUARD ([a-z_]+)')
        $godotCode = [regex]::Match($sourceError, 'WINDOWS-INSTANCE-GUARD FAIL code=([a-z_]+)')
        $failure = if ($sidecarCode.Success) { $sidecarCode.Groups[1].Value }
          elseif ($godotCode.Success) { $godotCode.Groups[1].Value }
          else { 'unknown' }
        throw "Exported PCK instance guard census mismatch: exit=$($sourceProbe.ExitCode) count=$($sourceMatches.Count) code=$failure."
      }
      Start-Sleep -Milliseconds 500

      # Un primo processo deve completare l'handshake e iniziare lavoro normale;
      # il secondo, concorrente e identico, deve fallire mentre il primo vive.
      $env:JHT_WINDOWS_INSTANCE_GUARD_PCK_TEST = $null
      $primaryStartedUtc = [DateTime]::UtcNow
      $first = Start-Process -FilePath $installedExe `
        -ArgumentList '--headless' -PassThru
      try {
        $normalWorkDeadline = [DateTime]::UtcNow.AddSeconds(12)
        do {
          Start-Sleep -Milliseconds 100
          $userDataRuntimeLogAfter = Get-FileObservation $userDataRuntimeLog
        } while (-not $first.HasExited -and
          ($null -eq $userDataRuntimeLogAfter -or
           $userDataRuntimeLogAfter -eq $userDataRuntimeLogBefore) -and
          [DateTime]::UtcNow -lt $normalWorkDeadline)
        if ($first.HasExited -or $null -eq $userDataRuntimeLogAfter -or
            $userDataRuntimeLogAfter -eq $userDataRuntimeLogBefore) {
          throw 'Primary installed application did not reach normal work after guard handshake.'
        }
        $guardRoot = Join-Path $env:LOCALAPPDATA 'Job Hunter Team/host-runtime/instance-guard'
        $guardAcks = @()
        if (Test-Path -LiteralPath $guardRoot -PathType Container) {
          foreach ($candidate in Get-ChildItem -LiteralPath $guardRoot -Filter 'ack-guard-*.json' -File) {
            if ($candidate.LastWriteTimeUtc -lt $primaryStartedUtc.AddSeconds(-1)) { continue }
            try { $guardAck = Get-Content -LiteralPath $candidate.FullName -Raw | ConvertFrom-Json -ErrorAction Stop }
            catch { continue }
            if ($guardAck.schema -eq 1 -and $guardAck.type -ceq 'ready' -and
                $guardAck.desktop_pid -eq $first.Id -and
                $guardAck.source_sha256 -ceq 'bb90ae8f9f1f0cff7d41ceedc3eec380f18b78d7b4f4b07921606afda8b8054b') {
              $guardAcks += @($guardAck)
            }
          }
        }
        if ($guardAcks.Count -ne 1 -or [int]$guardAcks[0].guard_pid -le 0) {
          throw 'Primary installed application did not publish one bound guard ACK.'
        }
        $firstGuardPid = [int]$guardAcks[0].guard_pid
        if (-not (Get-Process -Id $firstGuardPid -ErrorAction SilentlyContinue)) {
          throw 'Primary installed application guard was not alive before concurrency probe.'
        }
        $second = Start-Process -FilePath $installedExe `
          -ArgumentList '--headless', '--quit-after', '3' -Wait -PassThru
        if ($second.ExitCode -ne 1) {
          throw "Concurrent installed application did not fail closed: exit=$($second.ExitCode)."
        }
        if ($first.HasExited) {
          throw 'Primary installed application exited during singleton probe.'
        }
      } finally {
        if ($first -and -not $first.HasExited) {
          $first.Kill()
          $first.WaitForExit()
        }
        if ($firstGuardPid) {
          $guardExitDeadline = [DateTime]::UtcNow.AddSeconds(3)
          while ((Get-Process -Id $firstGuardPid -ErrorAction SilentlyContinue) -and
                 [DateTime]::UtcNow -lt $guardExitDeadline) {
            Start-Sleep -Milliseconds 50
          }
          if (Get-Process -Id $firstGuardPid -ErrorAction SilentlyContinue) {
            throw 'Primary instance guard survived its desktop process.'
          }
        }
      }
    } finally {
      $env:JHT_NOVPS = $previousNoVps
      $env:JHT_WINDOWS_INSTANCE_GUARD_PCK_TEST = $previousGuardPckTest
      Remove-Item -LiteralPath $guardStdout, $guardStderr -Force -ErrorAction SilentlyContinue
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

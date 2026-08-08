"""Windows PowerShell 5.1 gate for the protected desktop update helper."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import time
from pathlib import Path

import pytest

from scripts.release_manifest import build_manifest, canonical_bytes
from scripts.release_signing import public_key_id, render_helper


ROOT = Path(__file__).resolve().parents[1]
HELPER_SOURCE = ROOT / "scripts" / "jht-windows-update.ps1"
DESKTOP = "job-hunter-team-windows-x64-portable.exe"
INSTALLED_DESKTOP = "job-hunter-team.exe"
HELPER = "jht-windows-update.ps1"
SPECS = [
    (
        "windows-desktop",
        "windows",
        "x86_64",
        DESKTOP,
        "jht-windows-desktop-v1",
    ),
    (
        "windows-update-helper",
        "windows",
        "x86_64",
        HELPER,
        "jht-windows-update-v1",
    ),
]
EXTRA_ARTIFACTS = {
    "extra-windows-installer": {
        "role": "windows-installer",
        "platform": "windows",
        "arch": "x86_64",
        "filename": "job-hunter-team-windows-x64-setup.exe",
        "protocol": "jht-windows-installer-v1",
    },
    "extra-linux-desktop": {
        "role": "linux-desktop",
        "platform": "linux",
        "arch": "x86_64",
        "filename": "job-hunter-team-linux-x64.tar.gz",
        "protocol": "jht-linux-desktop-v1",
    },
    "extra-macos-desktop": {
        "role": "macos-desktop",
        "platform": "macos",
        "arch": "universal2",
        "filename": "job-hunter-team.zip",
        "protocol": "jht-macos-desktop-v1",
    },
}
FOREIGN_ACL_MUTATIONS = {
    "foreign-write-ace": "WriteData",
    "foreign-delete-ace": "Delete",
    "foreign-permissions-ace": "ChangePermissions",
    "foreign-owner-right-ace": "TakeOwnership",
}

ANCESTOR_PROBE = r"""
$source = [IO.File]::ReadAllText($env:JHT_TEST_HELPER_SOURCE)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'rendered helper parse failed' }
$names = @('Get-FileSystemParent', 'Assert-NoReparseAncestors')
$functions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -in $names
}, $true) | Sort-Object { $_.Extent.StartOffset })
if ($functions.Count -ne 2) { throw 'production traversal functions are missing' }
$body = ($functions | ForEach-Object { $_.Extent.Text }) -join "`n"
$probe = @'
Set-StrictMode -Version 2.0
$script:FailureCode = 'location_init'
try {
  Assert-NoReparseAncestors $env:JHT_TEST_PROBE_PATH `
    -ReparseCode 'location_node_reparse' `
    -InternalCode 'location_node_internal'
  throw 'reparse ancestor was accepted'
} catch {
  if ($script:FailureCode -cne 'location_node_reparse') { throw }
  [Console]::Error.WriteLine(
    'JHT-WINDOWS-UPDATE-ERROR schema=1 phase=location ' +
    'code=' + $script:FailureCode)
  exit 23
}
'@
& ([ScriptBlock]::Create($body + "`n" + $probe))
"""

LOCK_PROBE = r"""
$source = [IO.File]::ReadAllText($env:JHT_TEST_HELPER_SOURCE)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'rendered helper parse failed' }
$names = @(
  'Test-JsonInteger', 'Test-ExactProperties', 'Get-FileSystemParent',
  'Assert-NoReparseAncestors', 'Assert-NoForeignWriteAcl',
  'Assert-OwnerAndAcl', 'Assert-ExactCurrentOnlyAcl', 'Assert-CurrentOwner',
  'Initialize-ProtectedDirectory', 'Protect-File', 'Protect-OwnedFile',
  'Get-BytesSha256', 'Assert-AtomicDestinationPreflight',
  'Open-AtomicTempStream', 'Write-AtomicTempContent',
  'Flush-AtomicTempStream', 'Protect-OwnedAtomicStream', 'Promote-AtomicTemp',
  'Assert-ProtectedFileContent', 'New-ProtectedAtomicTemp',
  'Write-ProtectedAtomicFile',
  'Write-AtomicJson', 'Read-JsonFile',
  'Get-ExactProcess', 'Acquire-Lock')
$functions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -in $names
}, $true) | Sort-Object { $_.Extent.StartOffset })
if ($functions.Count -ne $names.Count) {
  throw 'production lock functions are missing'
}
$body = ($functions | ForEach-Object { $_.Extent.Text }) -join "`n"
$typeMarker = "Add-Type -TypeDefinition @'"
$typeStart = $source.IndexOf($typeMarker) + $typeMarker.Length
$typeEnd = $source.IndexOf("`n'@", $typeStart)
if ($typeStart -lt $typeMarker.Length -or $typeEnd -le $typeStart) {
  throw 'production native helper is missing'
}
$native = $source.Substring($typeStart, $typeEnd - $typeStart)
if (-not ('JhtUpdateFileIdentity' -as [type])) {
  Add-Type -TypeDefinition $native
}
$probe = @'
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($env:JHT_TEST_LOCK_ROOT)
$script:FailureCode = 'lock_init'
$script:LockOwnerStarted =
  [Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString()

function Get-Sha256 {
  param([string]$Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $stream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() } finally { $stream.Dispose() }
  } finally { $algorithm.Dispose() }
}

function Protect-OwnedAtomicStream {
  param(
    [IO.FileStream]$Stream,
    [string]$Path,
    [string]$ExpectedSha256,
    [uint64]$ExpectedSize)
  $Stream.Dispose()
  Protect-OwnedFile $Path
  if ((Get-Sha256 $Path) -cne $ExpectedSha256 -or
      [uint64]([IO.FileInfo]::new($Path).Length) -ne $ExpectedSize) {
    throw 'lock seam atomic content mismatch'
  }
}

function Assert-NoLockResidue {
  param([string]$StateRoot)
  $claims = @(Get-ChildItem -LiteralPath $StateRoot -Force |
    Where-Object { $_.Name -like '.update-claim-*' })
  $stale = @(Get-ChildItem -LiteralPath $StateRoot -Force |
    Where-Object { $_.Name -like '.update-stale-*' })
  if ($claims.Count -ne 0 -or $stale.Count -ne 0) {
    throw 'lock seam left transient residue'
  }
}

function Assert-ExactLockOwner {
  param([string]$LockPath, [string]$ExpectedNonce)
  Assert-ExactCurrentOnlyAcl $LockPath -Directory
  $ownerPath = Join-Path $LockPath 'owner.json'
  Assert-ExactCurrentOnlyAcl $ownerPath
  $owner = Read-JsonFile $ownerPath
  if (-not (Test-ExactProperties $owner @('nonce','pid','schema','started')) -or
      -not (Test-JsonInteger $owner.schema) -or [int64]$owner.schema -ne 1 -or
      -not (Test-JsonInteger $owner.pid) -or [int]$owner.pid -ne $PID -or
      [string]$owner.nonce -cne $ExpectedNonce -or
      [string]$owner.started -cne $script:LockOwnerStarted) {
    throw 'production lock owner schema or binding mismatch'
  }
}

function Get-LockSnapshot {
  param([string]$LockPath)
  $children = @(Get-ChildItem -LiteralPath $LockPath -Force)
  if ($children.Count -ne 1 -or $children[0].Name -cne 'owner.json') {
    throw 'production lock contains unexpected nodes'
  }
  $directory = [IO.DirectoryInfo]::new($LockPath)
  $owner = [IO.FileInfo]::new((Join-Path $LockPath 'owner.json'))
  $sections = [Security.AccessControl.AccessControlSections]::All
  return ([ordered]@{
    directory_sddl = $directory.GetAccessControl($sections).GetSecurityDescriptorSddlForm($sections)
    owner_sddl = $owner.GetAccessControl($sections).GetSecurityDescriptorSddlForm($sections)
    owner_bytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($owner.FullName))
  } | ConvertTo-Json -Compress)
}

function Get-StateSnapshot {
  param([string]$StateRoot)
  $sections = [Security.AccessControl.AccessControlSections]::All
  $directory = [IO.DirectoryInfo]::new($StateRoot)
  $children = @(Get-ChildItem -LiteralPath $StateRoot -Force |
    Sort-Object { $_.Name } |
    ForEach-Object { $_.Name + '|' + ([int]$_.Attributes).ToString() })
  return ([ordered]@{
    directory_sddl = $directory.GetAccessControl($sections).GetSecurityDescriptorSddlForm($sections)
    children = $children
  } | ConvertTo-Json -Compress)
}

function Invoke-LockCase {
  param([ValidateSet('clean','active','stale')][string]$Case)
  $script:StateRoot = Join-Path $root $Case
  $script:LockPath = Join-Path $script:StateRoot '.update.lock'
  $script:Nonce = $Case.Substring(0, 1) * 32
  Initialize-ProtectedDirectory $script:StateRoot
  try {
    if ($Case -ceq 'stale') {
      Initialize-ProtectedDirectory $script:LockPath
      $staleOwnerPath = Join-Path $script:LockPath 'owner.json'
      Write-AtomicJson $staleOwnerPath @{
        schema = 1
        nonce = 'f' * 32
        pid = 2147483647
        started = '100000000000000000'
      }
      Protect-File $staleOwnerPath
      Assert-ExactCurrentOnlyAcl $staleOwnerPath
    }
    Acquire-Lock
    if (-not (Test-Path -LiteralPath $script:LockPath -PathType Container)) {
      throw 'production lock was not materialized'
    }
    Assert-ExactLockOwner $script:LockPath $script:Nonce
    $expected = 'lock_claim_promote'
    if ($Case -ceq 'active') {
      $beforeActive = Get-LockSnapshot $script:LockPath
      try {
        Acquire-Lock
        throw 'active production lock was accepted'
      } catch {
        if ($script:FailureCode -cne 'lock_existing_validate') { throw }
      }
      $afterActive = Get-LockSnapshot $script:LockPath
      if ($afterActive -cne $beforeActive) {
        throw 'active production lock was mutated by the rejected claimant'
      }
      $expected = 'lock_existing_validate'
    }
    if ($script:FailureCode -cne $expected) {
      throw 'unexpected production lock stage'
    }
    Assert-NoLockResidue $script:StateRoot
    [Console]::Out.WriteLine(
      'WINDOWS-LOCK-SEAM PASS mode=' + $Case +
      ' code=' + $script:FailureCode)
  } catch {
    [Console]::Error.WriteLine(
      'WINDOWS-LOCK-SEAM ERROR mode=' + $Case +
      ' code=' + $script:FailureCode)
    exit 31
  } finally {
    Remove-Item -LiteralPath $script:StateRoot -Recurse -Force `
      -ErrorAction SilentlyContinue
  }
}

function Invoke-LockFailureCase {
  param([ValidateSet('init','write','promote')][string]$Case)
  $script:StateRoot = Join-Path $root ('failure-' + $Case)
  $script:LockPath = Join-Path $script:StateRoot '.update.lock'
  $script:Nonce = 'e' * 32
  Initialize-ProtectedDirectory $script:StateRoot
  $beforeFailure = Get-StateSnapshot $script:StateRoot
  $productionInitialize = ${function:Initialize-ProtectedDirectory}
  $productionWrite = ${function:Write-AtomicJson}
  try {
    if ($Case -ceq 'init') {
      Set-Item -Path Function:\Initialize-ProtectedDirectory -Value {
        param(
          [string]$Path,
          [switch]$RequireNew,
          $CreatedByInvocation = $null)
        $trackCreation = $PSBoundParameters.ContainsKey('CreatedByInvocation')
        if ($trackCreation) {
          if ($CreatedByInvocation -isnot [System.Management.Automation.PSReference]) {
            throw 'creation tracker must be a PSReference'
          }
          $CreatedByInvocation.Value = $false
        }
        if (-not $RequireNew) { throw 'unexpected injected init call' }
        New-Item -ItemType Directory -Path $Path -ErrorAction Stop | Out-Null
        if ($trackCreation) { $CreatedByInvocation.Value = $true }
        throw 'injected lock claim init failure'
      }
    } elseif ($Case -ceq 'write') {
      Set-Item -Path Function:\Write-AtomicJson -Value {
        param([string]$Path, [hashtable]$Value)
        throw 'injected lock claim write failure'
      }
    } else {
      $script:LockPath = Join-Path $script:StateRoot 'missing-parent\.update.lock'
    }
    try {
      Acquire-Lock
      throw 'injected production lock failure was accepted'
    } catch {
      $expected = if ($Case -ceq 'init') { 'lock_claim_init' } `
        elseif ($Case -ceq 'write') { 'lock_claim_write' } `
        else { 'lock_exhausted' }
      if ($script:FailureCode -cne $expected) { throw }
    }
    if ((Get-StateSnapshot $script:StateRoot) -cne $beforeFailure) {
      throw 'failed production claimant mutated state authority'
    }
    Assert-NoLockResidue $script:StateRoot
    [Console]::Out.WriteLine(
      'WINDOWS-LOCK-SEAM PASS mode=failure-' + $Case +
      ' code=' + $script:FailureCode)
  } catch {
    [Console]::Error.WriteLine(
      'WINDOWS-LOCK-SEAM ERROR mode=failure-' + $Case +
      ' code=' + $script:FailureCode)
    exit 31
  } finally {
    Set-Item -Path Function:\Initialize-ProtectedDirectory -Value $productionInitialize
    Set-Item -Path Function:\Write-AtomicJson -Value $productionWrite
    Remove-Item -LiteralPath $script:StateRoot -Recurse -Force `
      -ErrorAction SilentlyContinue
  }
}

try {
  $script:InjectedNewPath = $root
  function New-Item {
    [CmdletBinding()]
    param([string]$ItemType, [string]$Path)
    $created = Microsoft.PowerShell.Management\New-Item `
      -ItemType $ItemType -Path $Path -ErrorAction Stop
    if ([IO.Path]::GetFullPath($Path).Equals(
        [IO.Path]::GetFullPath($script:InjectedNewPath),
        [StringComparison]::OrdinalIgnoreCase)) {
      $item = [IO.DirectoryInfo]::new([IO.Path]::GetFullPath($Path))
      $acl = $item.GetAccessControl(
        [Security.AccessControl.AccessControlSections]::All)
      $foreign = [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545')
      $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        $foreign, 'WriteData', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
      $acl.AddAccessRule($rule)
      $item.SetAccessControl($acl)
    }
    return $created
  }
  try {
    Initialize-ProtectedDirectory $root
  } finally {
    Remove-Item -LiteralPath Function:\New-Item -Force -ErrorAction SilentlyContinue
  }
  Assert-ExactCurrentOnlyAcl $root -Directory
  Initialize-ProtectedDirectory $root
  $bindingPath = Join-Path $root 'binding-tracked'
  $bindingCreated = $false
  Initialize-ProtectedDirectory $bindingPath -RequireNew `
    -CreatedByInvocation ([ref]$bindingCreated)
  if (-not $bindingCreated) {
    throw 'tracked initialize did not report its created directory'
  }
  Assert-OwnerAndAcl $bindingPath -Directory
  Remove-Item -LiteralPath $bindingPath -Recurse -Force -ErrorAction Stop
  [Console]::Out.WriteLine('WINDOWS-LOCK-SEAM PASS mode=initialize-binding')
  foreach ($case in @('clean','active','stale')) { Invoke-LockCase $case }
  foreach ($case in @('init','write','promote')) { Invoke-LockFailureCase $case }
} finally {
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
'@
& ([ScriptBlock]::Create($body + "`n" + $probe))
"""

INITIALIZE_COLLISION_PROBE = r"""
$source = [IO.File]::ReadAllText($env:JHT_TEST_HELPER_SOURCE)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'rendered helper parse failed' }
$names = @(
  'Get-FileSystemParent', 'Assert-NoReparseAncestors',
  'Assert-NoForeignWriteAcl', 'Assert-OwnerAndAcl',
  'Assert-ExactCurrentOnlyAcl', 'Assert-CurrentOwner',
  'Initialize-ProtectedDirectory')
$functions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -in $names
}, $true) | Sort-Object { $_.Extent.StartOffset })
if ($functions.Count -ne $names.Count) {
  throw 'production initialize functions are missing'
}
$body = ($functions | ForEach-Object { $_.Extent.Text }) -join "`n"
$probe = @'
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:FailureCode = 'lock_claim_init'
$created = $false
try {
  if ($env:JHT_TEST_COLLISION_MODE -ceq 'attest') {
    Initialize-ProtectedDirectory $env:JHT_TEST_COLLISION_PATH `
      -CreatedByInvocation ([ref]$created)
  } else {
    Initialize-ProtectedDirectory $env:JHT_TEST_COLLISION_PATH `
      -RequireNew -CreatedByInvocation ([ref]$created)
  }
  throw 'preexisting protected node was adopted'
} catch {
  if ($script:FailureCode -cne 'lock_claim_init' -or $created) { throw }
  [Console]::Error.WriteLine(
    'JHT-WINDOWS-UPDATE-ERROR schema=1 phase=lock ' +
    'code=' + $script:FailureCode)
  exit 23
}
'@
& ([ScriptBlock]::Create($body + "`n" + $probe))
"""

INITIALIZE_INVALID_TRACKER_PROBE = r"""
$source = [IO.File]::ReadAllText($env:JHT_TEST_HELPER_SOURCE)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'rendered helper parse failed' }
$names = @(
  'Get-FileSystemParent', 'Assert-NoReparseAncestors',
  'Assert-NoForeignWriteAcl', 'Assert-OwnerAndAcl',
  'Assert-ExactCurrentOnlyAcl', 'Assert-CurrentOwner',
  'Initialize-ProtectedDirectory')
$functions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -in $names
}, $true) | Sort-Object { $_.Extent.StartOffset })
if ($functions.Count -ne $names.Count) {
  throw 'production initialize functions are missing'
}
$body = ($functions | ForEach-Object { $_.Extent.Text }) -join "`n"
$probe = @'
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:FailureCode = 'lock_claim_init'
try {
  Initialize-ProtectedDirectory $env:JHT_TEST_INVALID_TRACKER_PATH `
    -RequireNew -CreatedByInvocation $false
  throw 'invalid creation tracker was accepted'
} catch {
  if (Test-Path -LiteralPath $env:JHT_TEST_INVALID_TRACKER_PATH) { throw }
  if ($script:FailureCode -cne 'lock_claim_init') { throw }
  [Console]::Error.WriteLine(
    'JHT-WINDOWS-UPDATE-ERROR schema=1 phase=lock ' +
    'code=' + $script:FailureCode)
  exit 23
}
'@
& ([ScriptBlock]::Create($body + "`n" + $probe))
"""

ATOMIC_FILE_PROBE = r"""
$source = [IO.File]::ReadAllText($env:JHT_TEST_HELPER_SOURCE)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'rendered helper parse failed' }
$names = @(
  'Get-FileSystemParent', 'Assert-NoReparseAncestors',
  'Assert-NoForeignWriteAcl', 'Assert-OwnerAndAcl',
  'Assert-ExactCurrentOnlyAcl', 'Assert-CurrentOwner', 'Protect-OwnedFile',
  'Get-Sha256', 'Get-BytesSha256', 'Assert-AtomicDestinationPreflight',
  'Open-AtomicTempStream', 'Write-AtomicTempContent',
  'Flush-AtomicTempStream', 'Protect-OwnedAtomicStream', 'Promote-AtomicTemp',
  'Assert-ProtectedFileContent', 'New-ProtectedAtomicTemp',
  'Write-ProtectedAtomicFile',
  'Write-AtomicJson', 'Copy-AtomicVerified')
$functions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -in $names
}, $true) | Sort-Object { $_.Extent.StartOffset })
if ($functions.Count -ne $names.Count) {
  throw 'production atomic functions are missing'
}
$body = ($functions | ForEach-Object { $_.Extent.Text }) -join "`n"
$typeMarker = "Add-Type -TypeDefinition @'"
$typeStart = $source.IndexOf($typeMarker) + $typeMarker.Length
$typeEnd = $source.IndexOf("`n'@", $typeStart)
if ($typeStart -lt $typeMarker.Length -or $typeEnd -le $typeStart) {
  throw 'production native helper is missing'
}
$native = $source.Substring($typeStart, $typeEnd - $typeStart)
if (-not ('JhtUpdateFileIdentity' -as [type])) {
  Add-Type -TypeDefinition $native
}
$injection = @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

public static class JhtAtomicTestInjection {
    private const uint OWNER_SECURITY_INFORMATION = 0x00000001;
    private const uint DACL_SECURITY_INFORMATION = 0x00000004;
    private const uint PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorOwner(
        IntPtr descriptor, out IntPtr owner, out bool defaulted);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorDacl(
        IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint SetSecurityInfo(
        IntPtr handle, int objectType, uint information, IntPtr owner,
        IntPtr group, IntPtr dacl, IntPtr sacl);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateHardLink(
        string newName, string existingName, IntPtr security);

    public static void InjectForeignSecurity(FileStream stream) {
        FileSecurity security = new FileSecurity();
        security.SetOwner(new SecurityIdentifier("S-1-5-32-544"));
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new FileSystemAccessRule(
            WindowsIdentity.GetCurrent().User, FileSystemRights.FullControl,
            AccessControlType.Allow));
        security.AddAccessRule(new FileSystemAccessRule(
            new SecurityIdentifier("S-1-5-32-545"),
            FileSystemRights.WriteData, AccessControlType.Allow));
        byte[] descriptor = security.GetSecurityDescriptorBinaryForm();
        GCHandle pinned = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        try {
            IntPtr owner;
            IntPtr dacl;
            bool ownerDefaulted;
            bool daclPresent;
            bool daclDefaulted;
            IntPtr value = pinned.AddrOfPinnedObject();
            if (!GetSecurityDescriptorOwner(value, out owner, out ownerDefaulted) ||
                !GetSecurityDescriptorDacl(
                    value, out daclPresent, out dacl, out daclDefaulted) ||
                !daclPresent)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            uint result = SetSecurityInfo(stream.SafeFileHandle.DangerousGetHandle(),
                1, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION |
                PROTECTED_DACL_SECURITY_INFORMATION, owner, IntPtr.Zero,
                dacl, IntPtr.Zero);
            if (result != 0) throw new Win32Exception((int)result);
        } finally {
            pinned.Free();
        }
    }

    public static void InjectHardLink(string newName, string existingName) {
        if (!CreateHardLink(Path.GetFullPath(newName),
            Path.GetFullPath(existingName), IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
}
'@
if (-not ('JhtAtomicTestInjection' -as [type])) {
  Add-Type -TypeDefinition $injection
}
$probe = @'
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($env:JHT_TEST_ATOMIC_ROOT)
$destination = Join-Path $root 'destination.bin'
$copyDestination = Join-Path $root 'copy.bin'
$externalLink = Join-Path $root 'external-link.bin'
$externalTarget = Join-Path $root 'external-target.bin'
$sourcePath = [IO.Path]::GetFullPath($env:JHT_TEST_ATOMIC_SOURCE)
$mode = $env:JHT_TEST_ATOMIC_MODE

function Get-FileSnapshot {
  param([string]$Path)
  $item = [IO.FileInfo]::new($Path)
  $sections = [Security.AccessControl.AccessControlSections]::All
  return ([ordered]@{
    bytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($Path))
    sddl = $item.GetAccessControl($sections).GetSecurityDescriptorSddlForm($sections)
  } | ConvertTo-Json -Compress)
}

function Assert-NoAtomicResidue {
  if (@(Get-ChildItem -LiteralPath $root -Force | Where-Object {
      $_.Name -like '.jht-atomic-*' }).Count -ne 0) {
    throw 'atomic primitive left transient residue'
  }
}

try {
  if ($mode -ceq 'happy') {
    $first = [Text.UTF8Encoding]::new($false).GetBytes('first')
    $second = [Text.UTF8Encoding]::new($false).GetBytes('second')
    Write-ProtectedAtomicFile -Destination $destination -Bytes $first
    Assert-ProtectedFileContent $destination (Get-BytesSha256 $first) $first.Length
    Write-ProtectedAtomicFile -Destination $destination -Bytes $second
    Assert-ProtectedFileContent $destination (Get-BytesSha256 $second) $second.Length
    $sourceHash = Get-Sha256 $sourcePath
    Copy-AtomicVerified $sourcePath $copyDestination $sourceHash
    Copy-AtomicVerified $sourcePath $copyDestination $sourceHash
    Assert-ProtectedFileContent $copyDestination $sourceHash ([IO.FileInfo]::new($sourcePath).Length)
    Remove-Item -LiteralPath $destination, $copyDestination -Force
  } elseif ($mode -ceq 'foreign-temp') {
    $productionProtect = ${function:Protect-OwnedAtomicStream}
    Set-Item -Path Function:\Protect-OwnedAtomicStream -Value {
      param(
        [IO.FileStream]$Stream,
        [string]$Path,
        [string]$ExpectedSha256,
        [uint64]$ExpectedSize)
      [JhtAtomicTestInjection]::InjectForeignSecurity($Stream)
      & $productionProtect $Stream $Path $ExpectedSha256 $ExpectedSize
    }
    try {
      $bytes = [Text.UTF8Encoding]::new($false).GetBytes('hardened')
      Write-ProtectedAtomicFile -Destination $destination -Bytes $bytes
      Assert-ProtectedFileContent $destination (Get-BytesSha256 $bytes) $bytes.Length
    } finally {
      Set-Item -Path Function:\Protect-OwnedAtomicStream -Value $productionProtect
      Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
    }
  } elseif ($mode -ceq 'harden-hardlink') {
    $productionProtect = ${function:Protect-OwnedAtomicStream}
    Set-Item -Path Function:\Protect-OwnedAtomicStream -Value {
      param(
        [IO.FileStream]$Stream,
        [string]$Path,
        [string]$ExpectedSha256,
        [uint64]$ExpectedSize)
      try {
        [JhtAtomicTestInjection]::InjectHardLink($script:ExternalLink, $Path)
      } catch {
        $script:HardlinkDeniedByOpenHandle = $true
        & $productionProtect $Stream $Path $ExpectedSha256 $ExpectedSize
        return
      }
      $item = [IO.FileInfo]::new($script:ExternalLink)
      $sections = [Security.AccessControl.AccessControlSections]::All
      $script:ExternalSddlBefore =
        $item.GetAccessControl($sections).GetSecurityDescriptorSddlForm($sections)
      try {
        & $productionProtect $Stream $Path $ExpectedSha256 $ExpectedSize
      } finally {
        $script:ExternalSddlAfter =
          $item.GetAccessControl($sections).GetSecurityDescriptorSddlForm($sections)
      }
    }
    $script:ExternalLink = $externalLink
    $script:HardlinkDeniedByOpenHandle = $false
    try {
      $failed = $false
      try {
        Write-ProtectedAtomicFile -Destination $destination `
          -Bytes ([Text.UTF8Encoding]::new($false).GetBytes('linked'))
      } catch { $failed = $true }
      if ($script:HardlinkDeniedByOpenHandle) {
        if ($failed -or -not (Test-Path -LiteralPath $destination -PathType Leaf)) {
          throw 'denied hardlink injection corrupted the atomic write'
        }
        Remove-Item -LiteralPath $destination -Force -ErrorAction Stop
      } elseif (-not $failed -or
          $script:ExternalSddlAfter -cne $script:ExternalSddlBefore) {
          throw 'same-handle hardlink boundary was not fail-closed'
      }
    } finally {
      Set-Item -Path Function:\Protect-OwnedAtomicStream -Value $productionProtect
      Remove-Item -LiteralPath $externalLink -Force -ErrorAction SilentlyContinue
    }
  } elseif ($mode -ceq 'harden-reparse-denied') {
    $externalBytes = [Text.UTF8Encoding]::new($false).GetBytes('external-target')
    Write-ProtectedAtomicFile -Destination $externalTarget -Bytes $externalBytes
    $externalBefore = Get-FileSnapshot $externalTarget
    $productionProtect = ${function:Protect-OwnedAtomicStream}
    Set-Item -Path Function:\Protect-OwnedAtomicStream -Value {
      param(
        [IO.FileStream]$Stream,
        [string]$Path,
        [string]$ExpectedSha256,
        [uint64]$ExpectedSize)
      $deleteDenied = $false
      try { [IO.File]::Delete($Path) } catch { $deleteDenied = $true }
      $replaceDenied = $false
      try {
        [JhtUpdateFileIdentity]::MoveReplace(
          $script:ExternalTarget, $Path, $true)
      } catch { $replaceDenied = $true }
      if (-not $deleteDenied -or -not $replaceDenied) {
        throw 'share-none handle allowed path substitution at harden boundary'
      }
      & $productionProtect $Stream $Path $ExpectedSha256 $ExpectedSize
    }
    $script:ExternalTarget = $externalTarget
    try {
      $bytes = [Text.UTF8Encoding]::new($false).GetBytes('share-none')
      Write-ProtectedAtomicFile -Destination $destination -Bytes $bytes
      Assert-ProtectedFileContent $destination (Get-BytesSha256 $bytes) $bytes.Length
      if (-not (Test-Path -LiteralPath $externalTarget -PathType Leaf) -or
          (Get-FileSnapshot $externalTarget) -cne $externalBefore) {
        throw 'denied path substitution mutated the external target'
      }
    } finally {
      Set-Item -Path Function:\Protect-OwnedAtomicStream -Value $productionProtect
      Remove-Item -LiteralPath $destination, $externalTarget -Force `
        -ErrorAction SilentlyContinue
    }
  } elseif ($mode -ceq 'hostile') {
    try {
      Write-ProtectedAtomicFile -Destination $destination `
        -Bytes ([Text.UTF8Encoding]::new($false).GetBytes('replacement'))
      throw 'hostile destination was replaced'
    } catch {
      [Console]::Error.WriteLine(
        'JHT-WINDOWS-UPDATE-ERROR schema=1 phase=atomic ' +
        'code=atomic_preflight_failed')
      exit 23
    }
  } else {
    $old = [Text.UTF8Encoding]::new($false).GetBytes('old')
    Write-ProtectedAtomicFile -Destination $destination -Bytes $old
    $before = Get-FileSnapshot $destination
    $functionName = switch ($mode) {
      'failure-create' { 'Open-AtomicTempStream' }
      'failure-write' { 'Write-AtomicTempContent' }
      'failure-flush' { 'Flush-AtomicTempStream' }
      'failure-harden' { 'Protect-OwnedAtomicStream' }
      'failure-promote' { 'Promote-AtomicTemp' }
      'failure-postflight' { 'Assert-ProtectedFileContent' }
      default { throw 'unknown atomic probe mode' }
    }
    $path = 'Function:\' + $functionName
    $production = Get-Item -LiteralPath $path
    $script:calls = 0
    if ($mode -ceq 'failure-postflight') {
      $productionPostflight = ${function:Assert-ProtectedFileContent}
      $script:AtomicDestination = $destination
      Set-Item -LiteralPath $path -Value {
        param([string]$Path, [string]$ExpectedSha256, [uint64]$ExpectedSize)
        if ([IO.Path]::GetFullPath($Path).Equals(
            [IO.Path]::GetFullPath($script:AtomicDestination),
            [StringComparison]::OrdinalIgnoreCase)) {
          throw 'injected atomic postflight failure'
        }
        & $productionPostflight $Path $ExpectedSha256 $ExpectedSize
      }
    } else {
      Set-Item -LiteralPath $path -Value { throw 'injected atomic stage failure' }
    }
    try {
      $failureObserved = $false
      try {
        Write-ProtectedAtomicFile -Destination $destination `
          -Bytes ([Text.UTF8Encoding]::new($false).GetBytes('new'))
      } catch { $failureObserved = $true }
      if (-not $failureObserved) { throw 'injected atomic failure was accepted' }
    } finally {
      Set-Item -LiteralPath $path -Value $production.ScriptBlock
    }
    if ((Get-FileSnapshot $destination) -cne $before) {
      throw 'atomic failure mutated its destination'
    }
    Remove-Item -LiteralPath $destination -Force
  }
  Assert-NoAtomicResidue
  [Console]::Out.WriteLine('WINDOWS-ATOMIC-SEAM PASS mode=' + $mode)
} finally {
  if ($mode -cne 'hostile') {
    Remove-Item -LiteralPath $destination, $copyDestination, $externalLink, $externalTarget -Force `
      -ErrorAction SilentlyContinue
  }
}
'@
& ([ScriptBlock]::Create($body + "`n" + $probe))
"""

STAGE_FAULT_PROBE = r"""
$source = [IO.File]::ReadAllText($env:JHT_TEST_HELPER_SOURCE)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'rendered helper parse failed' }
$names = @(
  'Get-FreshBundle',
  'Get-JournalWriteCode', 'Write-Journal', 'Update-JournalState',
  'Update-JournalProcess', 'Backup-OldAuthority',
  'Install-CandidateMetadata', 'Install-CandidateHelper', 'Write-Result')
$functions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -in $names
}, $true) | Sort-Object { $_.Extent.StartOffset })
if ($functions.Count -ne $names.Count) {
  throw 'production stage functions are missing'
}
$body = ($functions | ForEach-Object { $_.Extent.Text }) -join "`n"
$probe = @'
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$mode = $env:JHT_TEST_STAGE_MODE
$script:FailurePhase = 'unset'
$script:FailureCode = 'unset'
$script:copyCalls = 0
$script:manifestCalls = 0
$script:floorCalls = 0
$script:JournalPath = 'journal.json'
$script:ResultPath = 'result.json'
$script:Nonce = 'a' * 32
$script:AuthorityBackupDir = 'authority'
$script:PSCommandPath = 'helper.ps1'
$script:OldHelperBackupPath = 'old-helper.ps1'
$script:InstalledManifestPath = 'installed.json'
$script:OldManifestBackupPath = 'old-manifest.json'
$script:InstalledSignaturePath = 'installed.sig'
$script:OldSignatureBackupPath = 'old-signature.sig'
$script:CandidateManifestPath = 'candidate.json'
$script:CandidateSignaturePath = 'candidate.sig'
$script:CandidateHelperPath = 'candidate-helper.ps1'
$script:HelperRole = 'windows-update-helper'
$script:DesktopRole = 'windows-desktop'
$script:BaselineVersion = '0.3.6'
$script:FloorPath = 'floor.json'
$script:TargetPath = 'target.exe'
$script:CandidatePath = 'candidate.exe'
$manifest = [pscustomobject]@{
  Value = [pscustomobject]@{ version = '0.3.6'; sequence = 1 }
  Sha256 = 'a' * 64
}
$artifact = [pscustomobject]@{ sha256 = 'b' * 64 }
$bundle = @{
  Installed = $manifest
  Candidate = [pscustomobject]@{
    Value = [pscustomobject]@{ version = '0.3.7'; sequence = 2 }
    Sha256 = 'c' * 64
  }
  Old = $artifact
  OldHelper = $artifact
  New = $artifact
  NewHelper = $artifact
  OldSignatureSha256 = 'd' * 64
  CandidateSignatureSha256 = 'e' * 64
}
$script:installedManifest = $manifest
$script:candidateManifest = $bundle.Candidate
$script:artifact = $artifact
$journal = [pscustomobject]@{
  schema = 1; nonce = $script:Nonce; state = 'prepared'
  installed_version = '0.3.6'; installed_sequence = 1
  target_version = '0.3.7'; target_sequence = 2
  old_sha256 = 'b' * 64; old_helper_sha256 = 'b' * 64
  old_manifest_sha256 = 'a' * 64; old_signature_sha256 = 'd' * 64
  candidate_sha256 = 'b' * 64; candidate_helper_sha256 = 'b' * 64
  candidate_manifest_sha256 = 'c' * 64
  candidate_signature_sha256 = 'e' * 64
  candidate_pid = 0; candidate_started = ''
}

function Write-AtomicJson {
  if ($mode -ceq 'floor-init-postflight') { return }
  throw 'injected JSON writer failure'
}
function Read-VerifiedManifest {
  $script:manifestCalls++
  if ($mode -ceq 'bundle-installed' -and $script:manifestCalls -eq 1) {
    throw 'injected installed manifest failure'
  }
  if ($mode -ceq 'bundle-candidate' -and $script:manifestCalls -eq 2) {
    throw 'injected candidate manifest failure'
  }
  if ($script:manifestCalls -eq 1) { return $script:installedManifest }
  return $script:candidateManifest
}
function Compare-Version {
  param([string]$Left, [string]$Right)
  if ($mode -ceq 'bundle-version') { return 0 }
  if ($Left -ceq $script:BaselineVersion) { return 0 }
  return 1
}
function Read-Floor {
  $script:floorCalls++
  if ($mode -ceq 'floor-read') { throw 'injected floor read failure' }
  if ($mode -in @('floor-init','floor-init-postflight')) {
    if ($script:floorCalls -eq 1) { return $null }
    if ($mode -ceq 'floor-init-postflight') {
      throw 'injected floor postflight failure'
    }
  }
  return [pscustomobject]@{ sequence = 1; version = '0.3.6' }
}
function Get-ArtifactByRole {
  if ($mode -ceq 'bundle-artifact') { throw 'injected artifact failure' }
  return $script:artifact
}
function Assert-FileMatchesArtifact { }
function Get-Sha256 { return 'f' * 64 }
function Initialize-ProtectedDirectory {
  if ($mode -ceq 'authority-init') { throw 'injected authority init failure' }
}
function Copy-AtomicVerified {
  $script:copyCalls++
  $failureCall = switch ($mode) {
    'authority-helper' { 1 }
    'authority-manifest' { 2 }
    'authority-signature' { 3 }
    'metadata-manifest' { 1 }
    'metadata-signature' { 2 }
    'helper-install' { 1 }
    default { 0 }
  }
  if ($script:copyCalls -eq $failureCall) { throw 'injected copy writer failure' }
}
function Assert-FileMatchesArtifact {
  if ($mode -ceq 'helper-postflight') { throw 'injected helper postflight failure' }
}

try {
  if ($mode.StartsWith('bundle-') -or $mode.StartsWith('floor-')) {
    Get-FreshBundle | Out-Null
  } elseif ($mode.StartsWith('journal-')) {
    Write-Journal $mode.Substring(8) $bundle
  } elseif ($mode -ceq 'journal-process') {
    Update-JournalProcess $journal 123 '100000000000000000'
  } elseif ($mode -ceq 'result-write') {
    Write-Result $false 'test' 'test_failed'
  } elseif ($mode.StartsWith('authority-')) {
    Backup-OldAuthority $bundle
  } elseif ($mode.StartsWith('metadata-')) {
    Install-CandidateMetadata $bundle
  } elseif ($mode.StartsWith('helper-')) {
    Install-CandidateHelper $bundle
  } else {
    throw 'unknown stage fault mode'
  }
  throw 'injected stage fault was accepted'
} catch {
  if ($script:FailurePhase -cne $env:JHT_TEST_EXPECTED_PHASE -or
      $script:FailureCode -cne $env:JHT_TEST_EXPECTED_CODE) { throw }
  [Console]::Out.WriteLine(
    'WINDOWS-STAGE-SEAM PASS mode=' + $mode +
    ' phase=' + $script:FailurePhase + ' code=' + $script:FailureCode)
}
'@
& ([ScriptBlock]::Create($body + "`n" + $probe))
"""

DISPATCH_FAULT_PROBE = r"""
$source = [IO.File]::ReadAllText($env:JHT_TEST_HELPER_SOURCE)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'rendered helper parse failed' }
$names = @('Initialize-HealthCapability', 'Invoke-Apply')
$functions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -in $names
}, $true) | Sort-Object { $_.Extent.StartOffset })
if ($functions.Count -ne $names.Count) {
  throw 'production dispatch functions are missing'
}
$body = ($functions | ForEach-Object { $_.Extent.Text }) -join "`n"
$native = @'
using System;
using System.Diagnostics;

public sealed class JhtSuspendedProcess : IDisposable {
    public int ProcessId { get; private set; }
    private JhtSuspendedProcess() {
        ProcessId = Process.GetCurrentProcess().Id;
    }
    public static JhtSuspendedProcess Create(string path) {
        if (Environment.GetEnvironmentVariable("JHT_TEST_DISPATCH_MODE") ==
            "health-process") throw new InvalidOperationException("injected create failure");
        return new JhtSuspendedProcess();
    }
    public void Resume() {
        if (Environment.GetEnvironmentVariable("JHT_TEST_DISPATCH_MODE") ==
            "health-resume") throw new InvalidOperationException("injected resume failure");
    }
    public void ReleaseOwnership() {
        if (Environment.GetEnvironmentVariable("JHT_TEST_DISPATCH_MODE") ==
            "health-release") throw new InvalidOperationException("injected release failure");
    }
    public void Dispose() { }
}
'@
if (-not ('JhtSuspendedProcess' -as [type])) { Add-Type -TypeDefinition $native }
$probe = @'
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$mode = $env:JHT_TEST_DISPATCH_MODE
$script:FailurePhase = 'unset'
$script:FailureCode = 'unset'
$script:Mode = 'Apply'
$script:OldPid = 123
$script:OldStartedUtcTicks = ''
$script:Nonce = 'a' * 32
$script:RequestId = 'request'
$script:InstanceId = 'instance'
$script:TargetPath = 'target.exe'
$script:CandidatePath = 'candidate.exe'
$script:BackupPath = 'backup.exe'
$script:HealthPath = 'health.json'
$script:JournalPath = 'journal.json'
$script:ReadyPath = 'ready.json'
$script:FloorPath = 'floor.json'
$script:writeProtectedCalls = 0
$script:assertPathCalls = 0
$script:journalWrites = 0
$manifest = [pscustomobject]@{
  Value = [pscustomobject]@{ version = '0.3.7'; sequence = 2 }
  Sha256 = 'a' * 64
}
$artifact = [pscustomobject]@{ sha256 = 'b' * 64; size = 10 }
$bundle = @{ Candidate = $manifest; New = $artifact; Old = $artifact }
$old = [pscustomobject]@{}
$old | Add-Member -MemberType ScriptMethod -Name WaitForExit -Value {
  param([int]$Milliseconds)
  if ($script:mode -ceq 'process-wait') { throw 'injected old-process wait failure' }
  return $true
}

function Initialize-StagingProtection {
  if ($script:mode -ceq 'bundle-staging') { throw 'injected staging failure' }
}
function Assert-Paths {
  $script:assertPathCalls++
  if ($script:mode -ceq 'bundle-path' -and $script:assertPathCalls -eq 1) {
    throw 'injected initial path failure'
  }
  if ($script:mode -ceq 'bundle-postwait' -and $script:assertPathCalls -eq 2) {
    throw 'injected post-wait path failure'
  }
}
function Get-FreshBundle { return $script:bundle }
function Get-ObservedProcess {
  if ($script:mode -ceq 'process-identity') { return $null }
  return @{ Process = $script:old; Started = '100000000000000000' }
}
function Write-Journal {
  param(
    [string]$State,
    [hashtable]$Bundle,
    [int]$CandidatePid = 0,
    [string]$CandidateStarted = '')
  $script:journalWrites++
  $script:FailurePhase = 'journal'
  $script:FailureCode = switch ($State) {
    'prepared' { 'journal_prepared_write_failed' }
    'swap_intent' { 'journal_swap_intent_write_failed' }
    'candidate_installed' { 'journal_candidate_installed_write_failed' }
    'health_acked' { 'journal_health_acked_write_failed' }
    'authority_intent' { 'journal_authority_intent_write_failed' }
    'metadata_installed' { 'journal_metadata_installed_write_failed' }
    'floor_intent' { 'journal_floor_intent_write_failed' }
    'helper_intent' { 'journal_helper_intent_write_failed' }
    'committed' { 'journal_committed_write_failed' }
    default { throw 'dispatch seam received an unexpected journal state' }
  }
}
function Write-AtomicJson {
  param([string]$Path, [hashtable]$Value)
  if ($script:mode -ceq 'ready' -and $Path -ceq $script:ReadyPath) {
    throw 'injected ready writer failure'
  }
  if ($script:mode -ceq 'floor-commit' -and $Path -ceq $script:FloorPath) {
    throw 'injected floor commit failure'
  }
}
function Write-Result { throw 'dispatch seam reached an unexpected result writer' }
function Remove-ProtectedFileIfPresent {
  if ($script:mode -ceq 'swap-cleanup') { throw 'injected swap cleanup failure' }
}
function Write-ProtectedAtomicFile {
  $script:writeProtectedCalls++
  if ($script:mode -ceq 'swap-promote' -and
      $script:writeProtectedCalls -eq 1) { throw 'injected swap promotion failure' }
  if ($script:mode -ceq 'health-capability' -and
      $script:writeProtectedCalls -eq 2) { throw 'injected health capability failure' }
}
function Assert-ProtectedFileContent { }
function Get-BytesSha256 { return '0' * 64 }
function Test-CandidateHealth {
  if ($script:mode -ceq 'health-ack') { throw 'injected health ACK failure' }
  return $true
}
function Read-ProtectedJsonFile { return [pscustomobject]@{} }
function Backup-OldAuthority { }
function Install-CandidateMetadata { }
function Install-CandidateHelper { }
function Remove-ProtectedTreeIfPresent { }

$script:mode = $mode
$script:bundle = $bundle
$script:old = $old
try {
  Invoke-Apply
  throw 'injected dispatch fault was accepted'
} catch {
  if ($script:FailurePhase -cne $env:JHT_TEST_EXPECTED_PHASE -or
      $script:FailureCode -cne $env:JHT_TEST_EXPECTED_CODE) { throw }
  $expectedJournalWrites = switch ($mode) {
    'ready' { 1 }
    'process-wait' { 1 }
    'bundle-postwait' { 1 }
    'swap-cleanup' { 2 }
    'swap-promote' { 2 }
    'health-capability' { 3 }
    'health-process' { 3 }
    'health-resume' { 4 }
    'health-release' { 4 }
    'health-ack' { 4 }
    'floor-commit' { 8 }
    default { 0 }
  }
  if ($script:journalWrites -ne $expectedJournalWrites) {
    throw 'dispatch seam did not traverse the expected nested journal writers'
  }
  [Console]::Out.WriteLine(
    'WINDOWS-DISPATCH-SEAM PASS mode=' + $mode +
    ' phase=' + $script:FailurePhase + ' code=' + $script:FailureCode)
}
'@
& ([ScriptBlock]::Create($body + "`n" + $probe))
"""

RECOVERY_FAULT_PROBE = r"""
$source = [IO.File]::ReadAllText($env:JHT_TEST_HELPER_SOURCE)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'rendered helper parse failed' }
$functions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -ceq 'Invoke-Rollback'
}, $true))
if ($functions.Count -ne 1) { throw 'production rollback function is missing' }
$body = $functions[0].Extent.Text
$probe = @'
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$mode = $env:JHT_TEST_RECOVERY_MODE
$script:FailurePhase = 'unset'
$script:FailureCode = 'unset'
$script:TargetPath = 'target.exe'
$script:journalWrites = 0
function Restore-OldTarget {
  if ($script:mode -ceq 'target') { throw 'injected target recovery failure' }
}
function Test-OldAuthorityInstalled { return $false }
function Restore-OldAuthority {
  if ($script:mode -ceq 'authority') { throw 'injected authority recovery failure' }
}
function Write-Journal {
  $script:journalWrites++
  $script:FailurePhase = 'journal'
  $script:FailureCode = 'journal_rolled_back_write_failed'
  if ($script:mode -ceq 'journal') { throw 'injected rollback journal failure' }
}
function Start-Process {
  if ($script:mode -ceq 'restart') { throw 'injected recovery restart failure' }
}
function Write-Result {
  $script:FailurePhase = 'result'
  $script:FailureCode = 'result_write_failed'
  throw 'injected recovery result failure'
}
$script:mode = $mode
try {
  Invoke-Rollback @{} ([pscustomobject]@{}) 'injected'
  throw 'injected recovery fault was accepted'
} catch {
  if ($script:FailurePhase -cne $env:JHT_TEST_EXPECTED_PHASE -or
      $script:FailureCode -cne $env:JHT_TEST_EXPECTED_CODE) { throw }
  $expectedJournalWrites = if ($mode -in @('journal','restart','result')) {
    1
  } else {
    0
  }
  if ($script:journalWrites -ne $expectedJournalWrites) {
    throw 'rollback seam did not traverse the expected nested journal writer'
  }
  [Console]::Out.WriteLine(
    'WINDOWS-RECOVERY-SEAM PASS mode=' + $mode +
    ' phase=' + $script:FailurePhase + ' code=' + $script:FailureCode)
}
'@
& ([ScriptBlock]::Create($body + "`n" + $probe))
"""

RECOVERY_HEALTH_FAULT_PROBE = r"""
$source = [IO.File]::ReadAllText($env:JHT_TEST_HELPER_SOURCE)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'rendered helper parse failed' }
$names = @('Initialize-HealthCapability', 'Start-RecoveryHealthProbe')
$functions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -in $names
}, $true) | Sort-Object { $_.Extent.StartOffset })
if ($functions.Count -ne $names.Count) {
  throw 'production recovery health functions are missing'
}
$body = ($functions | ForEach-Object { $_.Extent.Text }) -join "`n"
$native = @'
using System;
using System.Diagnostics;
public sealed class JhtSuspendedProcess : IDisposable {
    public int ProcessId { get; private set; }
    private JhtSuspendedProcess() {
        ProcessStartInfo start = new ProcessStartInfo(
            Environment.GetEnvironmentVariable("SystemRoot") +
            @"\System32\ping.exe", "-n 30 127.0.0.1");
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        ProcessId = Process.Start(start).Id;
    }
    public static JhtSuspendedProcess Create(string path) {
        if (Environment.GetEnvironmentVariable("JHT_TEST_RECOVERY_HEALTH_MODE") ==
            "process") throw new InvalidOperationException("injected create failure");
        return new JhtSuspendedProcess();
    }
    public void Resume() {
        if (Environment.GetEnvironmentVariable("JHT_TEST_RECOVERY_HEALTH_MODE") ==
            "resume") throw new InvalidOperationException("injected resume failure");
    }
    public void ReleaseOwnership() {
        if (Environment.GetEnvironmentVariable("JHT_TEST_RECOVERY_HEALTH_MODE") ==
            "release") throw new InvalidOperationException("injected release failure");
    }
    public void Dispose() { }
}
'@
if (-not ('JhtSuspendedProcess' -as [type])) { Add-Type -TypeDefinition $native }
$probe = @'
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$mode = $env:JHT_TEST_RECOVERY_HEALTH_MODE
$script:FailurePhase = 'unset'
$script:FailureCode = 'unset'
$script:TargetPath = 'target.exe'
$script:HealthPath = 'health.json'
$script:JournalPath = 'journal.json'
$script:Nonce = 'a' * 32
$script:journalProcessWrites = 0
function Stop-JournalCandidate { }
function Remove-ProtectedFileIfPresent {
  if ($script:mode -ceq 'cleanup') { throw 'injected health cleanup failure' }
}
function Write-ProtectedAtomicFile {
  if ($script:mode -ceq 'capability') { throw 'injected capability failure' }
}
function Assert-ProtectedFileContent { }
function Get-BytesSha256 { return '0' * 64 }
function Update-JournalProcess {
  $script:journalProcessWrites++
  $script:FailurePhase = 'journal'
  $script:FailureCode = 'journal_process_write_failed'
}
function Test-CandidateHealth {
  param([hashtable]$Bundle, [Diagnostics.Process]$Process, [string]$Started)
  if ($script:mode -ceq 'validate') {
    $Process.Kill()
    $null = $Process.WaitForExit(5000)
    throw 'injected health validation failure'
  }
  return $true
}
$script:mode = $mode
try {
  Start-RecoveryHealthProbe @{} ([pscustomobject]@{}) | Out-Null
  throw 'injected recovery health fault was accepted'
} catch {
  if ($script:FailurePhase -cne $env:JHT_TEST_EXPECTED_PHASE -or
      $script:FailureCode -cne $env:JHT_TEST_EXPECTED_CODE) { throw }
  $expectedJournalWrites = if ($mode -in @('resume','release','validate')) {
    1
  } else {
    0
  }
  if ($script:journalProcessWrites -ne $expectedJournalWrites) {
    throw 'recovery health seam did not traverse the nested journal writer'
  }
  [Console]::Out.WriteLine(
    'WINDOWS-RECOVERY-HEALTH-SEAM PASS mode=' + $mode +
    ' phase=' + $script:FailurePhase + ' code=' + $script:FailureCode)
}
'@
& ([ScriptBlock]::Create($body + "`n" + $probe))
"""

RESULT_FALLBACK_PROBE = r"""
$source = [IO.File]::ReadAllText($env:JHT_TEST_HELPER_SOURCE)
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseInput(
  $source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'rendered helper parse failed' }
$names = @('Write-Result', 'Write-FailureResultOrStderr')
$functions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -in $names
}, $true) | Sort-Object { $_.Extent.StartOffset })
if ($functions.Count -ne $names.Count) {
  throw 'production result fallback functions are missing'
}
$body = ($functions | ForEach-Object { $_.Extent.Text }) -join "`n"
$probe = @'
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$script:FailurePhase = 'original'
$script:FailureCode = 'original_failed'
$script:ResultPath = 'result.json'
$script:Nonce = 'a' * 32
function Write-AtomicJson { throw 'injected result writer failure' }
$written = Write-FailureResultOrStderr 'health' 'health_ack_failed'
if ($written -or $script:FailurePhase -cne 'result' -or
    $script:FailureCode -cne 'result_write_failed') {
  throw 'result fallback did not preserve its exact stage'
}
[Console]::Out.WriteLine('WINDOWS-RESULT-FALLBACK-SEAM PASS')
'@
& ([ScriptBlock]::Create($body + "`n" + $probe))
"""


def test_helper_source_has_no_remote_or_shell_bootstrap() -> None:
    source = HELPER_SOURCE.read_text()
    producer = (ROOT / "scripts" / "release_manifest.py").read_text()
    assert "__JHT_RELEASE_PUBLIC_KEYS_SPKI_PEM__" in source
    assert "$pair.Actual" in source
    assert "$pair[0]" not in source
    for diagnostic in (
        "location_resolve",
        "location_forbidden_root",
        "location_fixed_binding",
        "location_node_reparse",
        "location_node_internal",
        "location_node_owner",
        "location_state_acl",
        "location_target_acl",
        "lock_claim_init",
        "lock_claim_write",
        "lock_claim_promote",
        "lock_existing_validate",
        "lock_stale_promote",
        "lock_stale_remove",
        "lock_exhausted",
        "bundle_installed_read_failed",
        "bundle_candidate_read_failed",
        "floor_read_failed",
        "floor_init_failed",
        "floor_init_postflight_failed",
        "floor_commit_failed",
        "journal_prepared_write_failed",
        "journal_swap_intent_write_failed",
        "journal_candidate_installed_write_failed",
        "journal_health_acked_write_failed",
        "journal_authority_intent_write_failed",
        "journal_metadata_installed_write_failed",
        "journal_floor_intent_write_failed",
        "journal_helper_intent_write_failed",
        "journal_committed_write_failed",
        "journal_rolled_back_write_failed",
        "ready_write_failed",
        "process_old_identity_failed",
        "process_old_wait_failed",
        "swap_backup_cleanup_failed",
        "swap_promote_failed",
        "health_cleanup_failed",
        "health_capability_init_failed",
        "health_process_start_failed",
        "health_process_resume_failed",
        "health_process_release_failed",
        "health_ack_failed",
        "authority_backup_init_failed",
        "authority_backup_helper_failed",
        "authority_backup_manifest_failed",
        "authority_backup_signature_failed",
        "metadata_manifest_install_failed",
        "metadata_signature_install_failed",
        "metadata_postflight_failed",
        "helper_install_failed",
        "helper_postflight_failed",
        "result_preflight_failed",
        "result_write_failed",
        "result_read_failed",
        "recovery_journal_read_failed",
        "recovery_health_capability_init_failed",
        "recovery_health_resume_failed",
        "recovery_health_release_failed",
        "recovery_restart_failed",
        "recovery_target_restore_failed",
    ):
        assert diagnostic in source
    assert "update_failed" not in source
    for forbidden in (
        "Invoke-Expression",
        "DownloadString",
        "Invoke-WebRequest",
        "Start-BitsTransfer",
        "cmd.exe",
        "taskkill",
        "Stop-Process",
    ):
        assert forbidden not in source
    for required in (
        "Read-VerifiedManifest",
        "Get-CanonicalManifestText",
        "Assert-ManifestSchema",
        "Acquire-Lock",
        "Get-RecoveryBundle",
        "Restore-OldAuthority",
        "Install-CandidateMetadata",
        "Install-CandidateHelper",
        "ReleaseOwnership",
        "PROC_THREAD_ATTRIBUTE_JOB_LIST",
        "EXTENDED_STARTUPINFO_PRESENT",
        "Get-ObservedProcess",
        "interrupted_commit_completed",
        "committed floor forbids rollback",
    ):
        assert required in source
    assert "function Get-FileSystemParent" in source
    assert "if ($Node -is [IO.FileInfo]) { return $Node.Directory }" in source
    assert "if ($Node -is [IO.DirectoryInfo]) { return $Node.Parent }" in source
    assert "$parent = $probe.Parent" not in source
    initialize = source[
        source.index("function Initialize-ProtectedDirectory") : source.index(
            "function Protect-File"
        )
    ]
    assert "New-Item -ItemType Directory -Path $Path -Force" not in initialize
    assert "$CreatedByInvocation = $null" in initialize
    assert "$PSBoundParameters.ContainsKey('CreatedByInvocation')" in initialize
    assert "[System.Management.Automation.PSReference]" in initialize
    assert "[ref]$CreatedByInvocation" not in initialize
    assert "-CreatedByInvocation ([ref]$claimCreated)" in source
    assert (
        "else { New-Object Security.AccessControl.DirectorySecurity }" in initialize
    )
    assert "$acl.AddAccessRule($rule)" in initialize
    assert "Assert-ExactCurrentOnlyAcl $Path -Directory" in initialize
    assert initialize.index("Assert-CurrentOwner $Path") < initialize.index(
        "if (-not $preexisting) { $acl.SetOwner("
    ) < initialize.index(
        "$acl.SetAccessRuleProtection("
    ) < initialize.index("Assert-OwnerAndAcl $Path -Directory")
    exact_acl = source[
        source.index("function Assert-ExactCurrentOnlyAcl") : source.index(
            "function Assert-CurrentOwner"
        )
    ]
    for exact_contract in (
        "$rules.Count -ne 1",
        "$rule.IsInherited",
        "AccessControlType]::Allow",
        "FileSystemRights]::FullControl",
        "PropagationFlags]::None",
    ):
        assert exact_contract in exact_acl
    acquire_lock = source[
        source.index("function Acquire-Lock") : source.index(
            "function Assert-SafeLocationPlan"
        )
    ]
    assert acquire_lock.index("Write-AtomicJson $claimOwnerPath") < acquire_lock.index(
        "Assert-ExactCurrentOnlyAcl $claimOwnerPath"
    ) < acquire_lock.index("[IO.Directory]::Move($claim, $LockPath)")
    atomic = source[
        source.index("function Protect-OwnedFile") : source.index(
            "function Write-AtomicJson"
        )
    ]
    for atomic_contract in (
        "New-Object Security.AccessControl.FileSecurity",
        "CreateNewAtomicStream",
        "$Stream.Flush($true)",
        "Protect-OwnedAtomicStream $stream",
        "Assert-AtomicDestinationPreflight $destinationFull",
        "New-ProtectedAtomicTemp -Path $temporary",
        "Promote-AtomicTemp $temporary",
        "Assert-ProtectedFileContent $destinationFull",
        "Remove-Item -LiteralPath $temporary",
    ):
        assert atomic_contract in atomic
    assert "MOVEFILE_REPLACE_EXISTING" in source
    assert "MOVEFILE_WRITE_THROUGH" in source
    assert "SetSecurityInfo" in source
    assert "HardenAndSha256" in source
    harden = source[
        source.index("public static string HardenAndSha256") : source.index(
            "public static FileStream CreateNewAtomicStream"
        )
    ]
    assert harden.index("AssertIdentity(handle, expected)") < harden.index(
        "SetSecurityInfo("
    ) < harden.rindex("AssertIdentity(handle, expected)")
    assert "JhtUpdateFileIdentity]::MoveReplace" in atomic
    assert "[IO.File]::Replace" not in atomic
    copy_atomic = source[
        source.index("function Copy-AtomicVerified") : source.index(
            "function Stop-JournalCandidate"
        )
    ]
    assert "Write-ProtectedAtomicFile" in copy_atomic
    assert "Copy-Item" not in copy_atomic
    write_result = source[
        source.index("function Write-Result") : source.index(
            "function Write-FailureResultOrStderr"
        )
    ]
    assert "catch" not in write_result
    result_fallback = source[
        source.index("function Write-FailureResultOrStderr") : source.index(
            "function Get-ExactProcess"
        )
    ]
    assert "phase=result code=result_write_failed" in result_fallback
    assert "Get-Process -ErrorAction SilentlyContinue" not in source
    assert source.index("Write-AtomicJson $FloorPath") < source.index(
        "Install-CandidateHelper $bundle"
    )
    main_dispatch = "if ($Mode -eq 'Recover') { Invoke-Recover } else { Invoke-Apply }"
    assert source.index("Assert-AtomicDestinationPreflight $ResultPath") < source.rindex(
        main_dispatch
    )
    assert "Get-Acl" not in source
    assert "Set-Acl" not in source
    assert "FileSystemRights]::Modify -bor" not in source
    assert "FileSystemRights]::FullControl -bor" not in source
    for mutating_right in (
        "WriteData",
        "AppendData",
        "WriteExtendedAttributes",
        "WriteAttributes",
        "DeleteSubdirectoriesAndFiles",
        "ChangePermissions",
        "TakeOwnership",
    ):
        assert mutating_right in source
    assert (
        "Assert-FileMatchesArtifact $PSCommandPath "
        "(Get-ArtifactByRole $installed.Value $HelperRole)"
    ) in source
    assert "Assert-FileMatchesArtifact $oldHelperPath" not in source
    for forbidden_role in (
        "windows-installer",
        "linux-desktop",
        "macos-desktop",
    ):
        assert forbidden_role not in source
        assert forbidden_role not in producer


pytestmark = pytest.mark.skipif(
    sys.platform != "win32",
    reason="PowerShell 5.1 process/ACL contract is Windows-only",
)


def _powershell() -> str:
    executable = shutil.which("powershell.exe")
    if not executable:
        pytest.skip("Windows PowerShell 5.1 is unavailable")
    return executable


def _run_powershell_command(
    command: str,
    *,
    env_values: dict[str, str],
    check: bool = True,
    capture_output: bool = False,
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment.update(env_values)
    return subprocess.run(
        [
            _powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference='Stop';Set-StrictMode -Version 2.0;" + command,
        ],
        env=environment,
        check=check,
        capture_output=capture_output,
        text=True,
    )


def test_powershell_command_fixture_stops_on_nonterminating_error(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "must-not-run"
    result = _run_powershell_command(
        "Get-Item -LiteralPath $env:JHT_TEST_MISSING_PATH;"
        "[IO.File]::WriteAllText($env:JHT_TEST_MARKER,'bad')",
        env_values={
            "JHT_TEST_MISSING_PATH": str(tmp_path / "missing"),
            "JHT_TEST_MARKER": str(marker),
        },
        check=False,
        capture_output=True,
    )
    assert result.returncode != 0
    assert not marker.exists()


def test_consumer_uses_file_without_execution_policy_bypass() -> None:
    source = (ROOT / "game/scripts/support/windows_update_client.gd").read_text()
    argv = source[source.index("static func helper_argv"):]
    assert '"-File"' in argv
    assert "ExecutionPolicy" not in argv
    assert "Bypass" not in argv
    service = (ROOT / "game/scripts/support/update_service.gd").read_text()
    health = service[
        service.index("func _write_windows_health_ack") : service.index(
            "func _join_thread"
        )
    ]
    assert "or not FileAccess.file_exists(path)" in health
    assert "FileAccess.open(path, FileAccess.WRITE)" in health
    assert '"%s.tmp-%d"' not in health
    assert "DirAccess.rename_absolute" not in health


def test_restricted_execution_policy_fails_closed(tmp_path: Path) -> None:
    probe = tmp_path / "must-not-run.ps1"
    marker = tmp_path / "policy-was-bypassed"
    probe.write_text(
        f"[IO.File]::WriteAllText('{str(marker).replace("'", "''")}', 'bad')\n",
        encoding="utf-8",
    )
    result = subprocess.run(
        [
            _powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Restricted",
            "-File",
            str(probe),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert not marker.exists()


def _generate_rsa_pair(directory: Path, prefix: str) -> tuple[Path, Path]:
    openssl = shutil.which("openssl.exe") or shutil.which("openssl")
    if not openssl:
        pytest.skip("OpenSSL is unavailable on the Windows runner")
    private = directory / f"{prefix}-private.pem"
    public = directory / f"{prefix}-public.pem"
    subprocess.run(
        [
            openssl,
            "genpkey",
            "-algorithm",
            "RSA",
            "-pkeyopt",
            "rsa_keygen_bits:3072",
            "-out",
            private,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        [openssl, "pkey", "-in", private, "-pubout", "-out", public],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return private, public


@pytest.fixture(scope="module")
def rsa_keys(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path]:
    return _generate_rsa_pair(tmp_path_factory.mktemp("windows-helper-rsa"), "release")


def _protect_directory(path: Path) -> None:
    _run_powershell_command(
        "$p=$env:JHT_TEST_ACL_PATH;$item=[IO.DirectoryInfo]::new($p);"
        "$acl=$item.GetAccessControl([Security.AccessControl.AccessControlSections]::All);"
        "$acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User);"
        "$acl.SetAccessRuleProtection($true,$false);"
        "foreach($identity in @($acl.GetAccessRules($true,$true,"
        "[Security.Principal.SecurityIdentifier]) | "
        "ForEach-Object {$_.IdentityReference} | "
        "Select-Object -Unique)){$acl.PurgeAccessRules($identity)};"
        "$rule=New-Object System.Security.AccessControl.FileSystemAccessRule("
        "[System.Security.Principal.WindowsIdentity]::GetCurrent().User,"
        "'FullControl','ContainerInherit,ObjectInherit','None','Allow');"
        "$acl.SetAccessRule($rule);$item.SetAccessControl($acl)",
        env_values={"JHT_TEST_ACL_PATH": str(path)},
    )


def _set_current_owner(path: Path) -> None:
    _run_powershell_command(
        "$full=[IO.Path]::GetFullPath($env:JHT_TEST_OWNER_PATH);"
        "$item=if([IO.Directory]::Exists($full)){[IO.DirectoryInfo]::new($full)}"
        "elseif([IO.File]::Exists($full)){[IO.FileInfo]::new($full)}"
        "else{throw 'owner fixture path is missing'};"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User);"
        "$item.SetAccessControl($acl)",
        env_values={"JHT_TEST_OWNER_PATH": str(path)},
    )


def _protect_file_current_only(path: Path) -> None:
    _run_powershell_command(
        "$item=[IO.FileInfo]::new($env:JHT_TEST_ACL_PATH);"
        "$acl=New-Object Security.AccessControl.FileSecurity;"
        "$current=[Security.Principal.WindowsIdentity]::GetCurrent().User;"
        "$acl.SetOwner($current);$acl.SetAccessRuleProtection($true,$false);"
        "$rule=New-Object Security.AccessControl.FileSystemAccessRule("
        "$current,'FullControl','Allow');$acl.AddAccessRule($rule);"
        "$item.SetAccessControl($acl)",
        env_values={"JHT_TEST_ACL_PATH": str(path)},
    )


def _directory_acl_is_protected(path: Path) -> bool:
    observed = _run_powershell_command(
        "$item=[IO.DirectoryInfo]::new($env:JHT_TEST_ACL_PATH);"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "[Console]::Out.Write($acl.AreAccessRulesProtected.ToString())",
        env_values={"JHT_TEST_ACL_PATH": str(path)},
        capture_output=True,
    )
    return observed.stdout == "True"


def _file_acl_is_current_only(path: Path) -> bool:
    observed = _run_powershell_command(
        "$item=[IO.FileInfo]::new($env:JHT_TEST_ACL_PATH);"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;"
        "$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;"
        "$rules=@($acl.GetAccessRules($true,$true,"
        "[Security.Principal.SecurityIdentifier]));"
        "$ok=$owner -eq $current -and $acl.AreAccessRulesProtected -and "
        "$rules.Count -eq 1 -and -not $rules[0].IsInherited -and "
        "$rules[0].IdentityReference.Value -eq $current -and "
        "$rules[0].AccessControlType -eq 'Allow' -and "
        "[Security.AccessControl.FileSystemRights]$rules[0].FileSystemRights "
        "-eq [Security.AccessControl.FileSystemRights]::FullControl;"
        "[Console]::Out.Write($ok.ToString())",
        env_values={"JHT_TEST_ACL_PATH": str(path)},
        capture_output=True,
    )
    return observed.stdout == "True"


def _is_reparse(path: Path) -> bool:
    return path.is_symlink() or bool(
        hasattr(os.path, "isjunction") and os.path.isjunction(path)
    )


def _tree_snapshot(root: Path) -> tuple[tuple[object, ...], ...]:
    if _is_reparse(root):
        metadata = root.lstat()
        return ((".", "reparse", metadata.st_size, metadata.st_nlink),)
    observed: list[tuple[object, ...]] = []

    def visit(directory: Path) -> None:
        for entry in sorted(os.scandir(directory), key=lambda item: item.name):
            path = Path(entry.path)
            relative = path.relative_to(root).as_posix()
            metadata = entry.stat(follow_symlinks=False)
            if _is_reparse(path):
                observed.append((relative, "reparse", metadata.st_size, metadata.st_nlink))
            elif stat.S_ISDIR(metadata.st_mode):
                observed.append((relative, "directory", metadata.st_nlink))
                visit(path)
            elif stat.S_ISREG(metadata.st_mode):
                observed.append(
                    (
                        relative,
                        "file",
                        metadata.st_size,
                        metadata.st_nlink,
                        hashlib.sha256(path.read_bytes()).hexdigest(),
                    )
                )
            else:
                observed.append((relative, "other", metadata.st_size))

    visit(root)
    return tuple(observed)


def _sddl_digest(path: Path) -> str:
    raw = _run_powershell_command(
        "$full=[IO.Path]::GetFullPath($env:JHT_TEST_ACL_PATH);"
        "$item=if([IO.Directory]::Exists($full)){[IO.DirectoryInfo]::new($full)}"
        "elseif([IO.File]::Exists($full)){[IO.FileInfo]::new($full)}"
        "else{throw 'snapshot node missing'};"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "[Console]::Out.Write($acl.GetSecurityDescriptorSddlForm("
        "[Security.AccessControl.AccessControlSections]::All))",
        env_values={"JHT_TEST_ACL_PATH": str(path)},
        capture_output=True,
    ).stdout
    return hashlib.sha256(raw.encode()).hexdigest()


def _acl_tree_snapshot(root: Path) -> tuple[tuple[str, str, str], ...]:
    if _is_reparse(root) or not root.exists():
        return ()
    nodes = [root]
    if root.is_dir():
        pending = [root]
        while pending:
            directory = pending.pop()
            for entry in sorted(os.scandir(directory), key=lambda item: item.name):
                path = Path(entry.path)
                if _is_reparse(path):
                    continue
                nodes.append(path)
                if entry.is_dir(follow_symlinks=False):
                    pending.append(path)
    return tuple(
        (
            "." if path == root else path.relative_to(root).as_posix(),
            "directory" if path.is_dir() else "file",
            _sddl_digest(path),
        )
        for path in sorted(nodes, key=lambda item: item.as_posix())
    )


def _authority_census(path: Path) -> dict[str, object]:
    raw = _run_powershell_command(
        "$full=[IO.Path]::GetFullPath($env:JHT_TEST_AUTHORITY_PATH);"
        "$item=if([IO.Directory]::Exists($full)){[IO.DirectoryInfo]::new($full)}"
        "elseif([IO.File]::Exists($full)){[IO.FileInfo]::new($full)}"
        "else{throw 'authority node missing'};"
        "$reparse=$false;$probe=$item;while($null -ne $probe){"
        "if(($probe.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){"
        "$reparse=$true;break};"
        "$parent=if($probe -is [IO.FileInfo]){$probe.Directory}"
        "elseif($probe -is [IO.DirectoryInfo]){$probe.Parent}"
        "else{throw 'unexpected census node type'};"
        "if($null -eq $parent -or $parent.FullName -eq $probe.FullName){break};"
        "$probe=$parent};"
        "$acl=$item.GetAccessControl("
        "[Security.AccessControl.AccessControlSections]::All);"
        "$current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;"
        "$owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value;"
        "$mask=[Security.AccessControl.FileSystemRights]::WriteData -bor "
        "[Security.AccessControl.FileSystemRights]::AppendData -bor "
        "[Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor "
        "[Security.AccessControl.FileSystemRights]::WriteAttributes -bor "
        "[Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor "
        "[Security.AccessControl.FileSystemRights]::Delete -bor "
        "[Security.AccessControl.FileSystemRights]::ChangePermissions -bor "
        "[Security.AccessControl.FileSystemRights]::TakeOwnership;"
        "$foreign=0;foreach($rule in $acl.GetAccessRules("
        "$true,$true,[Security.Principal.SecurityIdentifier])){"
        "if($rule.AccessControlType -ne 'Allow' -or "
        "(([Security.AccessControl.FileSystemRights]$rule.FileSystemRights "
        "-band $mask) -eq 0)){continue};$sid=$rule.IdentityReference.Value;"
        "if($sid -notin @($current,'S-1-5-18','S-1-5-32-544')){$foreign++}};"
        "[ordered]@{directory=[bool]($item -is [IO.DirectoryInfo]);"
        "owner_current=($owner -eq $current);"
        "acl_protected=[bool]$acl.AreAccessRulesProtected;"
        "reparse_ancestor=$reparse;foreign_mutating=$foreign} | "
        "ConvertTo-Json -Compress",
        env_values={"JHT_TEST_AUTHORITY_PATH": str(path)},
        capture_output=True,
    ).stdout
    census = json.loads(raw)
    assert isinstance(census, dict)
    return census


def _assert_authority(
    label: str,
    path: Path,
    *,
    directory: bool,
    protected: bool | None,
    foreign_mutating: int = 0,
) -> None:
    census = _authority_census(path)
    expected = {
        "directory": directory,
        "owner_current": True,
        "reparse_ancestor": False,
        "foreign_mutating": foreign_mutating,
    }
    for key, value in expected.items():
        assert census.get(key) == value, f"{label} authority={census}"
    if protected is not None:
        assert census.get("acl_protected") == protected, (
            f"{label} authority={census}"
        )


def _authority_snapshot(root: Path) -> tuple[object, ...]:
    return (_tree_snapshot(root), _acl_tree_snapshot(root))


def _side_effect_snapshot(
    target_dir: Path, state: Path, transaction: Path
) -> tuple[object, ...]:
    return (
        _tree_snapshot(target_dir),
        _tree_snapshot(state),
        _tree_snapshot(transaction),
        _acl_tree_snapshot(target_dir),
        _acl_tree_snapshot(state),
        _acl_tree_snapshot(transaction),
    )


def test_acl_fixture_treats_path_with_spaces_as_data(tmp_path: Path) -> None:
    protected = tmp_path / "protected ';&$() path with spaces"
    protected.mkdir()
    _protect_directory(protected)
    observed = _run_powershell_command(
        "[Console]::Out.Write($env:JHT_TEST_ACL_PATH)",
        env_values={"JHT_TEST_ACL_PATH": str(protected)},
        capture_output=True,
    )
    assert observed.stdout == str(protected)


def _write_signed_manifest(
    *,
    directory: Path,
    version: str,
    private: Path,
    public: Path,
) -> None:
    manifest = build_manifest(
        directory=directory,
        artifact_specs=SPECS,
        key_id=public_key_id(public),
        version=version,
        commit="2" * 40,
        published_at="2026-08-07T12:34:56Z",
    )
    manifest_path = directory / "RELEASE-MANIFEST.json"
    manifest_path.write_bytes(canonical_bytes(manifest))
    openssl = shutil.which("openssl.exe") or shutil.which("openssl")
    assert openssl is not None
    subprocess.run(
        [
            openssl,
            "dgst",
            "-sha256",
            "-sign",
            str(private),
            "-out",
            str(directory / "RELEASE-MANIFEST.json.sig"),
            str(manifest_path),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _run_verify(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    *,
    candidate_version: str = "0.3.7",
    mutation: str = "none",
    rotation_keys: tuple[Path, Path] | None = None,
    candidate_helper_suffix: bytes = b"",
) -> tuple[subprocess.CompletedProcess[str], Path, Path]:
    private, public = rsa_keys
    candidate_private, candidate_public = rotation_keys or rsa_keys
    real_local_app_data = Path(os.environ["LOCALAPPDATA"]).resolve()
    assert tmp_path.resolve().is_relative_to(real_local_app_data)
    local_authority = tmp_path / "local-app-data"
    local_authority.mkdir()
    _protect_directory(local_authority)
    helper_env = os.environ.copy()
    helper_env["LOCALAPPDATA"] = str(local_authority)
    programs = local_authority / "Programs"
    programs.mkdir()
    _protect_directory(programs)
    target_dir = programs / "Job Hunter Team"
    target_dir.mkdir(parents=True)
    _protect_directory(target_dir)
    nonce = "a" * 32
    consumer_inherited_state = False
    if mutation in {"bind-root", "bind-descendant"}:
        fake_profile = tmp_path / "profile"
        fake_profile.mkdir()
        helper_env["USERPROFILE"] = str(fake_profile)
        state = fake_profile / ".jht"
        if mutation == "bind-descendant":
            state /= "container-visible"
    elif mutation == "state-junction":
        state = tmp_path / "state"
        junction_target = tmp_path / "state-real"
        junction_target.mkdir()
        _run_powershell_command(
            "New-Item -ItemType Junction -Path $env:JHT_TEST_JUNCTION_PATH "
            "-Target $env:JHT_TEST_JUNCTION_TARGET | Out-Null",
            env_values={
                "JHT_TEST_JUNCTION_PATH": str(state),
                "JHT_TEST_JUNCTION_TARGET": str(junction_target),
            },
        )
    else:
        state = local_authority / "Job Hunter Team" / "host-runtime"
        consumer_inherited_state = True
    transaction = state / nonce
    transaction.mkdir(parents=True)
    if consumer_inherited_state:
        # The game creates these children recursively and does not protect
        # their DACL itself. Model a normal non-elevated owner while keeping
        # the inherited DACL so the helper must perform the normalization.
        _set_current_owner(state)
        _set_current_owner(transaction)
        assert not _directory_acl_is_protected(state)
        assert not _directory_acl_is_protected(transaction)
    elif mutation != "state-junction":
        _protect_directory(state)
        _protect_directory(transaction)
    installed_build = tmp_path / "installed-build"
    candidate_build = tmp_path / "candidate-build"
    installed_build.mkdir()
    candidate_build.mkdir()

    ping = Path(os.environ["SystemRoot"]) / "System32" / "ping.exe"
    helper = target_dir / HELPER
    additional = (candidate_public,) if rotation_keys else ()
    render_helper(
        template=HELPER_SOURCE,
        output=helper,
        public_key=public,
        additional_public_keys=additional,
    )
    shutil.copy2(ping, installed_build / DESKTOP)
    shutil.copy2(helper, installed_build / HELPER)
    _write_signed_manifest(
        directory=installed_build,
        version="0.3.6",
        private=private,
        public=public,
    )
    target = target_dir / INSTALLED_DESKTOP
    shutil.copy2(installed_build / DESKTOP, target)
    shutil.copy2(installed_build / "RELEASE-MANIFEST.json", target_dir)
    shutil.copy2(installed_build / "RELEASE-MANIFEST.json.sig", target_dir)

    candidate_bytes = (installed_build / DESKTOP).read_bytes() + b"candidate"
    (candidate_build / DESKTOP).write_bytes(candidate_bytes)
    if rotation_keys:
        render_helper(
            template=HELPER_SOURCE,
            output=candidate_build / HELPER,
            public_key=candidate_public,
        )
    else:
        shutil.copy2(helper, candidate_build / HELPER)
    if candidate_helper_suffix:
        with (candidate_build / HELPER).open("ab") as stream:
            stream.write(candidate_helper_suffix)
    _write_signed_manifest(
        directory=candidate_build,
        version=candidate_version,
        private=candidate_private,
        public=candidate_public,
    )
    candidate = target_dir / f".jht-update-{nonce}.candidate.exe"
    candidate.write_bytes(candidate_bytes)
    shutil.copy2(candidate_build / HELPER, transaction / HELPER)
    shutil.copy2(candidate_build / "RELEASE-MANIFEST.json", transaction)
    shutil.copy2(candidate_build / "RELEASE-MANIFEST.json.sig", transaction)
    for owned_path in (
        helper,
        target,
        target_dir / "RELEASE-MANIFEST.json",
        target_dir / "RELEASE-MANIFEST.json.sig",
        candidate,
        transaction / HELPER,
        transaction / "RELEASE-MANIFEST.json",
        transaction / "RELEASE-MANIFEST.json.sig",
    ):
        _set_current_owner(owned_path)
    if mutation == "asset":
        candidate.write_bytes(candidate.read_bytes() + b"tamper")
    elif mutation == "signature":
        signature = transaction / "RELEASE-MANIFEST.json.sig"
        raw = bytearray(signature.read_bytes())
        raw[0] ^= 1
        signature.write_bytes(raw)
    elif mutation == "unsigned":
        (transaction / "RELEASE-MANIFEST.json.sig").unlink()
    elif mutation == "stale-result-before-lock":
        signature = transaction / "RELEASE-MANIFEST.json.sig"
        raw = bytearray(signature.read_bytes())
        raw[0] ^= 1
        signature.write_bytes(raw)
        (transaction / "result.json").write_text(
            json.dumps(
                {
                    "schema": 1,
                    "ok": True,
                    "phase": "committed",
                    "code": "stale",
                    "nonce": nonce,
                    "rolled_back": False,
                }
            )
        )
    elif mutation in EXTRA_ARTIFACTS:
        manifest_path = transaction / "RELEASE-MANIFEST.json"
        manifest = json.loads(manifest_path.read_text())
        entry = dict(EXTRA_ARTIFACTS[mutation])
        entry.update(size=1, sha256="4" * 64)
        manifest["artifacts"].append(entry)
        manifest["artifacts"].sort(
            key=lambda item: (
                item["role"],
                item["platform"],
                item["arch"],
                item["filename"],
            )
        )
        manifest_path.write_bytes(canonical_bytes(manifest))
        openssl = shutil.which("openssl.exe") or shutil.which("openssl")
        assert openssl is not None
        subprocess.run(
            [
                openssl,
                "dgst",
                "-sha256",
                "-sign",
                str(private),
                "-out",
                str(transaction / "RELEASE-MANIFEST.json.sig"),
                str(manifest_path),
            ],
            check=True,
        )
    elif mutation == "foreign-read-ace" or mutation in FOREIGN_ACL_MUTATIONS:
        rights = (
            "ReadAndExecute"
            if mutation == "foreign-read-ace"
            else FOREIGN_ACL_MUTATIONS[mutation]
        )
        _run_powershell_command(
            "$item=[IO.DirectoryInfo]::new($env:JHT_TEST_ACL_PATH);"
            "$acl=$item.GetAccessControl([Security.AccessControl.AccessControlSections]::All);"
            "$sid=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-545');"
            "$rule=[Security.AccessControl.FileSystemAccessRule]::new("
            f"$sid,'{rights}','ContainerInherit,ObjectInherit','None','Allow');"
            "$acl.AddAccessRule($rule);$item.SetAccessControl($acl)",
            env_values={"JHT_TEST_ACL_PATH": str(transaction)},
        )

    if consumer_inherited_state:
        expected_foreign = 1 if mutation in FOREIGN_ACL_MUTATIONS else 0
        _assert_authority(
            "target_dir", target_dir, directory=True, protected=True
        )
        _assert_authority(
            "state", state, directory=True, protected=False
        )
        _assert_authority(
            "transaction",
            transaction,
            directory=True,
            protected=False,
            foreign_mutating=expected_foreign,
        )
        authority_files = {
            "helper": helper,
            "target": target,
            "installed_manifest": target_dir / "RELEASE-MANIFEST.json",
            "installed_signature": target_dir / "RELEASE-MANIFEST.json.sig",
            "candidate": candidate,
            "candidate_helper": transaction / HELPER,
            "candidate_manifest": transaction / "RELEASE-MANIFEST.json",
            "candidate_signature": transaction / "RELEASE-MANIFEST.json.sig",
        }
        for label, authority_path in authority_files.items():
            if authority_path.exists():
                _assert_authority(
                    label,
                    authority_path,
                    directory=False,
                    protected=None,
                    foreign_mutating=(
                        expected_foreign
                        if authority_path.parent == transaction
                        else 0
                    ),
                )

    expected_success = (
        candidate_version == "0.3.7"
        and mutation in {"none", "foreign-read-ace"}
    )
    before_side_effects = (
        None
        if expected_success
        else _side_effect_snapshot(target_dir, state, transaction)
    )
    process = subprocess.Popen(
        [str(target), "-t", "127.0.0.1"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        command = [
            _powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(helper),
            "-Mode",
            "Verify",
            "-TargetPath",
            str(target),
            "-CandidatePath",
            str(candidate),
            "-CandidateHelperPath",
            str(transaction / HELPER),
            "-InstalledManifestPath",
            str(target_dir / "RELEASE-MANIFEST.json"),
            "-InstalledSignaturePath",
            str(target_dir / "RELEASE-MANIFEST.json.sig"),
            "-CandidateManifestPath",
            str(transaction / "RELEASE-MANIFEST.json"),
            "-CandidateSignaturePath",
            str(transaction / "RELEASE-MANIFEST.json.sig"),
            "-StateRoot",
            str(state),
            "-Nonce",
            nonce,
            "-OldPid",
            str(process.pid),
        ]
        result = subprocess.run(
            command,
            text=True,
            capture_output=True,
            timeout=30,
            env=helper_env,
        )
        if not expected_success:
            expected_phase, expected_code = (
                ("location", "location_forbidden_root")
                if mutation in {"bind-root", "bind-descendant"}
                else ("location", "location_node_reparse")
                if mutation == "state-junction"
                else ("location", "location_state_acl")
                if mutation in FOREIGN_ACL_MUTATIONS
                else ("trust", "trust_failed")
            )
            diagnostic = _helper_result_diagnostic(transaction, result.stderr)
            assert diagnostic == (
                "JHT-WINDOWS-UPDATE-ERROR schema=1 "
                f"phase={expected_phase} code={expected_code}"
            )
        if before_side_effects is not None:
            assert _side_effect_snapshot(target_dir, state, transaction) == (
                before_side_effects
            )
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
    return result, target, transaction


def _helper_command(
    *, target: Path, transaction: Path, mode: str, old_pid: int = 1
) -> list[str]:
    state = transaction.parent
    nonce = transaction.name
    return [
        _powershell(),
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-File",
        str(target.parent / HELPER),
        "-Mode",
        mode,
        "-TargetPath",
        str(target),
        "-CandidatePath",
        str(target.parent / f".jht-update-{nonce}.candidate.exe"),
        "-CandidateHelperPath",
        str(transaction / HELPER),
        "-InstalledManifestPath",
        str(target.parent / "RELEASE-MANIFEST.json"),
        "-InstalledSignaturePath",
        str(target.parent / "RELEASE-MANIFEST.json.sig"),
        "-CandidateManifestPath",
        str(transaction / "RELEASE-MANIFEST.json"),
        "-CandidateSignaturePath",
        str(transaction / "RELEASE-MANIFEST.json.sig"),
        "-StateRoot",
        str(state),
        "-Nonce",
        nonce,
        "-OldPid",
        str(old_pid),
    ]


def _write_compact_json(path: Path, value: dict[str, object]) -> None:
    path.write_text(
        json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def _helper_result_diagnostic(transaction: Path, stderr: str = "") -> str:
    for line in stderr.splitlines():
        if line.startswith("JHT-WINDOWS-UPDATE-ERROR schema=1 phase="):
            return line
    result_path = transaction / "result.json"
    if not result_path.is_file():
        return "helper result=missing"
    try:
        frame = json.loads(result_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "helper result=malformed"
    if not isinstance(frame, dict):
        return "helper result=wrong-type"
    safe = {
        key: frame.get(key)
        for key in ("schema", "ok", "phase", "code", "rolled_back")
    }
    return "helper result=" + json.dumps(safe, sort_keys=True, separators=(",", ":"))


@pytest.mark.parametrize(
    ("boundary", "install_candidate", "install_metadata", "commit_floor", "promote_helper"),
    [
        ("swap_intent", False, False, False, False),
        ("candidate_installed", True, False, False, False),
        ("metadata_installed", True, True, False, False),
        ("floor_intent", True, True, True, False),
        ("helper_intent", True, True, True, False),
        ("helper_promoted", True, True, True, True),
    ],
)
def test_reboot_recovery_is_idempotent_at_every_promotion_boundary(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    boundary: str,
    install_candidate: bool,
    install_metadata: bool,
    commit_floor: bool,
    promote_helper: bool,
) -> None:
    verified, target, transaction = _run_verify(
        tmp_path,
        rsa_keys,
        candidate_helper_suffix=b"\n# independently signed next helper\n",
    )
    assert verified.returncode == 0, _helper_result_diagnostic(
        transaction, verified.stderr
    )
    nonce = transaction.name
    state = transaction.parent
    candidate = target.parent / f".jht-update-{nonce}.candidate.exe"
    backup = target.parent / f".jht-update-{nonce}.backup.exe"
    authority_backup = target.parent / f".jht-update-{nonce}.authority-backup"
    installed_helper = target.parent / HELPER
    installed_manifest = target.parent / "RELEASE-MANIFEST.json"
    installed_signature = target.parent / "RELEASE-MANIFEST.json.sig"
    old_bytes = target.read_bytes()
    old_helper_bytes = installed_helper.read_bytes()
    candidate_bytes = candidate.read_bytes()
    candidate_helper_bytes = (transaction / HELPER).read_bytes()
    journal_path = transaction / "journal.json"
    journal = json.loads(journal_path.read_text(encoding="utf-8"))

    if install_candidate:
        shutil.copy2(target, backup)
        shutil.copy2(candidate, target)
        _set_current_owner(backup)
        _set_current_owner(target)
        candidate.unlink()
    if install_metadata:
        authority_backup.mkdir()
        _protect_directory(authority_backup)
        shutil.copy2(installed_helper, authority_backup / HELPER)
        shutil.copy2(installed_manifest, authority_backup / "RELEASE-MANIFEST.json")
        shutil.copy2(
            installed_signature,
            authority_backup / "RELEASE-MANIFEST.json.sig",
        )
        shutil.copy2(transaction / "RELEASE-MANIFEST.json", installed_manifest)
        shutil.copy2(
            transaction / "RELEASE-MANIFEST.json.sig", installed_signature
        )
        for owned_path in (
            authority_backup / HELPER,
            authority_backup / "RELEASE-MANIFEST.json",
            authority_backup / "RELEASE-MANIFEST.json.sig",
            installed_manifest,
            installed_signature,
        ):
            _set_current_owner(owned_path)
    if commit_floor:
        _write_compact_json(
            state / "committed-floor.json",
            {
                "schema": 1,
                "sequence": int(journal["target_sequence"]),
                "version": str(journal["target_version"]),
            },
        )
        _set_current_owner(state / "committed-floor.json")
    if promote_helper:
        shutil.copy2(transaction / HELPER, installed_helper)
        _set_current_owner(installed_helper)

    journal["state"] = "helper_intent" if boundary == "helper_promoted" else boundary
    candidate_process: subprocess.Popen[bytes] | None = None
    try:
        if commit_floor:
            candidate_process = subprocess.Popen(
                [str(target), "-t", "127.0.0.1"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            started = _run_powershell_command(
                "(Get-Process -Id ([int]$env:JHT_TEST_PID) -ErrorAction Stop)."
                "StartTime.ToUniversalTime().Ticks.ToString()",
                env_values={"JHT_TEST_PID": str(candidate_process.pid)},
                capture_output=True,
            ).stdout.strip()
            journal["candidate_pid"] = candidate_process.pid
            journal["candidate_started"] = started
            _write_compact_json(
                transaction / "health.json",
                {
                    "schema": 1,
                    "type": "healthy",
                    "nonce": nonce,
                    "version": str(journal["target_version"]),
                    "exe_path": str(target.resolve()),
                    "exe_sha256": str(journal["candidate_sha256"]),
                    "pid": candidate_process.pid,
                    "process_started_utc_ticks": started,
                },
            )
            _protect_file_current_only(transaction / "health.json")
        _write_compact_json(journal_path, journal)

        recovered = subprocess.run(
            _helper_command(
                target=target,
                transaction=transaction,
                mode="Recover",
            ),
            text=True,
            capture_output=True,
            timeout=45,
        )
        result = json.loads((transaction / "result.json").read_text())
        if commit_floor:
            assert recovered.returncode == 0, _helper_result_diagnostic(
                transaction, recovered.stderr
            )
            assert result["phase"] == "committed"
            assert target.read_bytes() == candidate_bytes
            assert installed_helper.read_bytes() == candidate_helper_bytes
            assert json.loads(journal_path.read_text())["state"] == "committed"
        else:
            assert recovered.returncode != 0, recovered.stderr
            assert result["phase"] in {"rollback", "recovered"}
            assert target.read_bytes() == old_bytes
            assert installed_helper.read_bytes() == old_helper_bytes
            assert json.loads(journal_path.read_text())["state"] == "rolled_back"
    finally:
        if candidate_process and candidate_process.poll() is None:
            candidate_process.kill()


def test_windows_powershell51_verifies_signed_bundle(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    result, target, transaction = _run_verify(tmp_path, rsa_keys)
    assert result.returncode == 0, _helper_result_diagnostic(
        transaction, result.stderr
    )
    assert (transaction / "ready.json").is_file()
    ready = json.loads((transaction / "ready.json").read_text())
    assert ready["old_pid"] > 0
    assert str(ready["old_started"]).isdigit()
    assert b"candidate" not in target.read_bytes()
    assert _directory_acl_is_protected(transaction.parent)
    assert _directory_acl_is_protected(transaction)
    for protected_file in (
        transaction.parent / "committed-floor.json",
        transaction / "journal.json",
        transaction / "ready.json",
        transaction / "result.json",
    ):
        assert _file_acl_is_current_only(protected_file), protected_file.name


def test_windows_powershell51_rotation_overlap_accepts_new_signed_new_only_helper(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    keys = tmp_path / "rotation-keys"
    keys.mkdir()
    next_keys = _generate_rsa_pair(keys, "next")
    result, target, transaction = _run_verify(
        tmp_path, rsa_keys, rotation_keys=next_keys
    )
    assert result.returncode == 0, _helper_result_diagnostic(
        transaction, result.stderr
    )
    assert _directory_acl_is_protected(transaction.parent)
    assert _directory_acl_is_protected(transaction)
    assert (transaction / "ready.json").is_file()
    installed_helper = target.parent / HELPER
    candidate_helper = transaction / HELPER
    assert installed_helper.read_text().count("-----BEGIN PUBLIC KEY-----") == (
        candidate_helper.read_text().count("-----BEGIN PUBLIC KEY-----") + 1
    )


def test_windows_powershell51_accepts_foreign_read_only_acl(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    result, _target, transaction = _run_verify(
        tmp_path, rsa_keys, mutation="foreign-read-ace"
    )
    assert result.returncode == 0, _helper_result_diagnostic(
        transaction, result.stderr
    )


@pytest.mark.parametrize(
    ("candidate_version", "mutation"),
    [
        ("0.3.7", "asset"),
        ("0.3.7", "signature"),
        ("0.3.7", "unsigned"),
        ("0.3.7", "stale-result-before-lock"),
        ("0.3.7", "extra-windows-installer"),
        ("0.3.7", "extra-linux-desktop"),
        ("0.3.7", "extra-macos-desktop"),
        ("0.3.7", "foreign-write-ace"),
        ("0.3.7", "foreign-delete-ace"),
        ("0.3.7", "foreign-permissions-ace"),
        ("0.3.7", "foreign-owner-right-ace"),
        ("0.3.7", "state-junction"),
        ("0.3.7", "bind-root"),
        ("0.3.7", "bind-descendant"),
        ("0.3.6", "none"),
    ],
)
def test_windows_powershell51_rejects_untrusted_or_replayed_candidate(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    candidate_version: str,
    mutation: str,
) -> None:
    result, target, transaction = _run_verify(
        tmp_path,
        rsa_keys,
        candidate_version=candidate_version,
        mutation=mutation,
    )
    assert result.returncode != 0
    assert not (transaction / "ready.json").exists()
    assert not (transaction.parent / "committed-floor.json").exists()
    assert not (transaction.parent / ".update.lock").exists()
    assert b"candidate" not in target.read_bytes()


def test_windows_prelock_error_is_sanitized(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    result, _target, transaction = _run_verify(
        tmp_path, rsa_keys, mutation="state-junction"
    )
    assert result.returncode != 0
    regular_leaf = transaction / HELPER
    assert regular_leaf.is_file()
    assert not _is_reparse(regular_leaf)
    assert _is_reparse(transaction.parent)
    diagnostic = _helper_result_diagnostic(transaction, result.stderr)
    assert diagnostic == (
        "JHT-WINDOWS-UPDATE-ERROR schema=1 phase=location "
        "code=location_node_reparse"
    )
    assert str(tmp_path) not in result.stderr


@pytest.mark.parametrize("node_kind", ["file", "directory"])
def test_production_traversal_rejects_regular_node_below_reparse_ancestor(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    node_kind: str,
) -> None:
    _private, public = rsa_keys
    helper = tmp_path / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)
    real = tmp_path / "real"
    regular_directory = real / "regular"
    regular_directory.mkdir(parents=True)
    regular_file = regular_directory / "payload.bin"
    regular_file.write_bytes(b"regular payload\n")
    junction = tmp_path / "junction"
    _run_powershell_command(
        "New-Item -ItemType Junction -Path $env:JHT_TEST_JUNCTION_PATH "
        "-Target $env:JHT_TEST_JUNCTION_TARGET | Out-Null",
        env_values={
            "JHT_TEST_JUNCTION_PATH": str(junction),
            "JHT_TEST_JUNCTION_TARGET": str(real),
        },
    )
    probe = (
        junction / "regular" / "payload.bin"
        if node_kind == "file"
        else junction / "regular"
    )
    assert probe.is_file() if node_kind == "file" else probe.is_dir()
    assert not _is_reparse(probe)
    assert _is_reparse(junction)

    state = tmp_path / "state"
    transaction = state / ("d" * 32)
    before = _authority_snapshot(tmp_path)
    result = _run_powershell_command(
        ANCESTOR_PROBE,
        env_values={
            "JHT_TEST_HELPER_SOURCE": str(helper),
            "JHT_TEST_PROBE_PATH": str(probe),
        },
        check=False,
        capture_output=True,
    )
    assert result.returncode == 23
    assert result.stdout == ""
    assert result.stderr.strip() == (
        "JHT-WINDOWS-UPDATE-ERROR schema=1 phase=location "
        "code=location_node_reparse"
    )
    assert str(tmp_path) not in result.stderr
    assert _authority_snapshot(tmp_path) == before
    assert not state.exists()
    assert not transaction.exists()
    assert not (state / ".update.lock").exists()
    assert not (state / "committed-floor.json").exists()
    assert not (transaction / "ready.json").exists()


def test_production_lock_clean_active_and_stale_seams_leave_no_residue(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    _private, public = rsa_keys
    helper = tmp_path / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)
    lock_root = tmp_path / "lock-seam"
    before = _authority_snapshot(tmp_path)
    result = _run_powershell_command(
        LOCK_PROBE,
        env_values={
            "JHT_TEST_HELPER_SOURCE": str(helper),
            "JHT_TEST_LOCK_ROOT": str(lock_root),
        },
        check=False,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert result.stdout.splitlines() == [
        "WINDOWS-LOCK-SEAM PASS mode=initialize-binding",
        "WINDOWS-LOCK-SEAM PASS mode=clean code=lock_claim_promote",
        "WINDOWS-LOCK-SEAM PASS mode=active code=lock_existing_validate",
        "WINDOWS-LOCK-SEAM PASS mode=stale code=lock_claim_promote",
        "WINDOWS-LOCK-SEAM PASS mode=failure-init code=lock_claim_init",
        "WINDOWS-LOCK-SEAM PASS mode=failure-write code=lock_claim_write",
        "WINDOWS-LOCK-SEAM PASS mode=failure-promote code=lock_exhausted",
    ]
    assert _authority_snapshot(tmp_path) == before
    assert not lock_root.exists()


@pytest.mark.parametrize(
    "collision_kind",
    ["foreign-owner", "foreign-ace", "preexisting-foreign-ace", "reparse"],
)
def test_production_initialize_rejects_preexisting_collision_without_mutation(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    collision_kind: str,
) -> None:
    _private, public = rsa_keys
    helper = tmp_path / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)
    collision = tmp_path / "claim-collision"
    if collision_kind == "reparse":
        target = tmp_path / "junction-target"
        target.mkdir()
        _run_powershell_command(
            "New-Item -ItemType Junction -Path $env:JHT_TEST_JUNCTION_PATH "
            "-Target $env:JHT_TEST_JUNCTION_TARGET | Out-Null",
            env_values={
                "JHT_TEST_JUNCTION_PATH": str(collision),
                "JHT_TEST_JUNCTION_TARGET": str(target),
            },
        )
    else:
        collision.mkdir()
        _set_current_owner(collision)
        if collision_kind == "foreign-owner":
            _run_powershell_command(
                "$item=[IO.DirectoryInfo]::new($env:JHT_TEST_COLLISION_PATH);"
                "$acl=$item.GetAccessControl("
                "[Security.AccessControl.AccessControlSections]::All);"
                "$acl.SetOwner([Security.Principal.SecurityIdentifier]::new("
                "'S-1-5-32-544'));$item.SetAccessControl($acl)",
                env_values={"JHT_TEST_COLLISION_PATH": str(collision)},
            )
        else:
            _run_powershell_command(
                "$item=[IO.DirectoryInfo]::new($env:JHT_TEST_COLLISION_PATH);"
                "$acl=$item.GetAccessControl("
                "[Security.AccessControl.AccessControlSections]::All);"
                "$sid=[Security.Principal.SecurityIdentifier]::new("
                "'S-1-5-32-545');"
                "$rule=[Security.AccessControl.FileSystemAccessRule]::new("
                "$sid,'WriteData','ContainerInherit,ObjectInherit','None','Allow');"
                "$acl.AddAccessRule($rule);$item.SetAccessControl($acl)",
                env_values={"JHT_TEST_COLLISION_PATH": str(collision)},
            )
    before = _authority_snapshot(tmp_path)
    result = _run_powershell_command(
        INITIALIZE_COLLISION_PROBE,
        env_values={
            "JHT_TEST_HELPER_SOURCE": str(helper),
            "JHT_TEST_COLLISION_PATH": str(collision),
            "JHT_TEST_COLLISION_MODE": (
                "attest" if collision_kind == "preexisting-foreign-ace" else "require-new"
            ),
        },
        check=False,
        capture_output=True,
    )
    assert result.returncode == 23
    assert result.stdout == ""
    assert result.stderr.strip() == (
        "JHT-WINDOWS-UPDATE-ERROR schema=1 phase=lock code=lock_claim_init"
    )
    assert str(tmp_path) not in result.stderr
    assert _authority_snapshot(tmp_path) == before
    assert not tuple(tmp_path.glob("**/.update-claim-*"))
    assert not tuple(tmp_path.glob("**/.update-stale-*"))


def test_production_initialize_rejects_invalid_tracker_without_mutation(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    _private, public = rsa_keys
    helper = tmp_path / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)
    tracked = tmp_path / "invalid-tracker-claim"
    before = _authority_snapshot(tmp_path)
    result = _run_powershell_command(
        INITIALIZE_INVALID_TRACKER_PROBE,
        env_values={
            "JHT_TEST_HELPER_SOURCE": str(helper),
            "JHT_TEST_INVALID_TRACKER_PATH": str(tracked),
        },
        check=False,
        capture_output=True,
    )
    assert result.returncode == 23
    assert result.stdout == ""
    assert result.stderr.strip() == (
        "JHT-WINDOWS-UPDATE-ERROR schema=1 phase=lock code=lock_claim_init"
    )
    assert str(tmp_path) not in result.stderr
    assert _authority_snapshot(tmp_path) == before
    assert not tracked.exists()
    assert not tuple(tmp_path.glob("**/.update-claim-*"))
    assert not tuple(tmp_path.glob("**/.update-stale-*"))


@pytest.mark.parametrize(
    "mode",
    [
        "happy",
        "foreign-temp",
        "harden-hardlink",
        "harden-reparse-denied",
        "failure-create",
        "failure-write",
        "failure-flush",
        "failure-harden",
        "failure-promote",
        "failure-postflight",
    ],
)
def test_production_atomic_file_seam_is_current_only_and_cleans_failures(
    tmp_path: Path, rsa_keys: tuple[Path, Path], mode: str
) -> None:
    _private, public = rsa_keys
    helper = tmp_path / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)
    root = tmp_path / "atomic-seam"
    root.mkdir()
    _protect_directory(root)
    source = root / "source.bin"
    source.write_bytes(b"trusted source\n")
    _set_current_owner(source)
    before = _authority_snapshot(tmp_path)
    result = _run_powershell_command(
        ATOMIC_FILE_PROBE,
        env_values={
            "JHT_TEST_HELPER_SOURCE": str(helper),
            "JHT_TEST_ATOMIC_ROOT": str(root),
            "JHT_TEST_ATOMIC_SOURCE": str(source),
            "JHT_TEST_ATOMIC_MODE": mode,
        },
        check=False,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert result.stdout.strip() == f"WINDOWS-ATOMIC-SEAM PASS mode={mode}"
    assert _authority_snapshot(tmp_path) == before
    assert not tuple(root.glob(".jht-atomic-*"))


@pytest.mark.parametrize(
    "hostile_kind",
    ["foreign-owner", "foreign-ace", "reparse", "hardlink"],
)
def test_production_atomic_file_rejects_hostile_existing_without_mutation(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    hostile_kind: str,
) -> None:
    _private, public = rsa_keys
    helper = tmp_path / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)
    root = tmp_path / "atomic-hostile"
    root.mkdir()
    _protect_directory(root)
    source = root / "source.bin"
    source.write_bytes(b"trusted source\n")
    _set_current_owner(source)
    destination = root / "destination.bin"
    if hostile_kind == "reparse":
        reparse_target = root / "reparse-target"
        reparse_target.mkdir()
        _run_powershell_command(
            "New-Item -ItemType Junction -Path $env:JHT_TEST_JUNCTION_PATH "
            "-Target $env:JHT_TEST_JUNCTION_TARGET | Out-Null",
            env_values={
                "JHT_TEST_JUNCTION_PATH": str(destination),
                "JHT_TEST_JUNCTION_TARGET": str(reparse_target),
            },
        )
    elif hostile_kind == "hardlink":
        hardlink_target = root / "hardlink-target.bin"
        hardlink_target.write_bytes(b"hostile destination\n")
        os.link(hardlink_target, destination)
        _set_current_owner(destination)
    else:
        destination.write_bytes(b"hostile destination\n")
        _set_current_owner(destination)
        if hostile_kind == "foreign-owner":
            mutation = (
                "$acl.SetOwner([Security.Principal.SecurityIdentifier]::new("
                "'S-1-5-32-544'))"
            )
        else:
            mutation = (
                "$foreign=[Security.Principal.SecurityIdentifier]::new("
                "'S-1-5-32-545');"
                "$rule=[Security.AccessControl.FileSystemAccessRule]::new("
                "$foreign,'WriteData','Allow');$acl.AddAccessRule($rule)"
            )
        _run_powershell_command(
            "$item=[IO.FileInfo]::new($env:JHT_TEST_ATOMIC_DESTINATION);"
            "$acl=$item.GetAccessControl("
            "[Security.AccessControl.AccessControlSections]::All);"
            + mutation
            + ";$item.SetAccessControl($acl)",
            env_values={"JHT_TEST_ATOMIC_DESTINATION": str(destination)},
        )
    before = _authority_snapshot(tmp_path)
    result = _run_powershell_command(
        ATOMIC_FILE_PROBE,
        env_values={
            "JHT_TEST_HELPER_SOURCE": str(helper),
            "JHT_TEST_ATOMIC_ROOT": str(root),
            "JHT_TEST_ATOMIC_SOURCE": str(source),
            "JHT_TEST_ATOMIC_MODE": "hostile",
        },
        check=False,
        capture_output=True,
    )
    assert result.returncode == 23
    assert result.stdout == ""
    assert result.stderr.strip() == (
        "JHT-WINDOWS-UPDATE-ERROR schema=1 phase=atomic "
        "code=atomic_preflight_failed"
    )
    assert str(tmp_path) not in result.stderr
    assert _authority_snapshot(tmp_path) == before
    assert not tuple(root.glob(".jht-atomic-*"))


@pytest.mark.parametrize(
    ("mode", "phase", "code"),
    [
        ("bundle-installed", "bundle", "bundle_installed_read_failed"),
        ("bundle-candidate", "bundle", "bundle_candidate_read_failed"),
        ("bundle-version", "bundle", "bundle_version_failed"),
        ("floor-read", "floor", "floor_read_failed"),
        ("floor-init", "floor", "floor_init_failed"),
        ("floor-init-postflight", "floor", "floor_init_postflight_failed"),
        ("bundle-artifact", "bundle", "bundle_artifact_validation_failed"),
        ("journal-prepared", "journal", "journal_prepared_write_failed"),
        ("journal-swap_intent", "journal", "journal_swap_intent_write_failed"),
        (
            "journal-candidate_installed",
            "journal",
            "journal_candidate_installed_write_failed",
        ),
        ("journal-health_acked", "journal", "journal_health_acked_write_failed"),
        (
            "journal-authority_intent",
            "journal",
            "journal_authority_intent_write_failed",
        ),
        (
            "journal-metadata_installed",
            "journal",
            "journal_metadata_installed_write_failed",
        ),
        ("journal-floor_intent", "journal", "journal_floor_intent_write_failed"),
        (
            "journal-helper_intent",
            "journal",
            "journal_helper_intent_write_failed",
        ),
        ("journal-committed", "journal", "journal_committed_write_failed"),
        ("journal-rolled_back", "journal", "journal_rolled_back_write_failed"),
        ("journal-process", "journal", "journal_process_write_failed"),
        ("result-write", "result", "result_write_failed"),
        ("authority-init", "authority", "authority_backup_init_failed"),
        ("authority-helper", "authority", "authority_backup_helper_failed"),
        (
            "authority-manifest",
            "authority",
            "authority_backup_manifest_failed",
        ),
        (
            "authority-signature",
            "authority",
            "authority_backup_signature_failed",
        ),
        ("metadata-manifest", "metadata", "metadata_manifest_install_failed"),
        (
            "metadata-signature",
            "metadata",
            "metadata_signature_install_failed",
        ),
        ("metadata-postflight", "metadata", "metadata_postflight_failed"),
        ("helper-install", "helper", "helper_install_failed"),
        ("helper-postflight", "helper", "helper_postflight_failed"),
    ],
)
def test_production_stage_faults_emit_exact_path_free_subcodes(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    mode: str,
    phase: str,
    code: str,
) -> None:
    _private, public = rsa_keys
    helper = tmp_path / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)
    result = _run_powershell_command(
        STAGE_FAULT_PROBE,
        env_values={
            "JHT_TEST_HELPER_SOURCE": str(helper),
            "JHT_TEST_STAGE_MODE": mode,
            "JHT_TEST_EXPECTED_PHASE": phase,
            "JHT_TEST_EXPECTED_CODE": code,
        },
        check=False,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert result.stdout.strip() == (
        f"WINDOWS-STAGE-SEAM PASS mode={mode} phase={phase} code={code}"
    )
    assert str(tmp_path) not in result.stdout
    assert str(tmp_path) not in result.stderr


@pytest.mark.parametrize(
    ("mode", "phase", "code"),
    [
        ("bundle-staging", "bundle", "bundle_staging_protection_failed"),
        ("bundle-path", "bundle", "bundle_path_attestation_failed"),
        ("process-identity", "process", "process_old_identity_failed"),
        ("ready", "ready", "ready_write_failed"),
        ("process-wait", "process", "process_old_wait_failed"),
        ("bundle-postwait", "bundle", "bundle_post_wait_attestation_failed"),
        ("swap-cleanup", "swap", "swap_backup_cleanup_failed"),
        ("swap-promote", "swap", "swap_promote_failed"),
        ("health-capability", "health", "health_capability_init_failed"),
        ("health-process", "health", "health_process_start_failed"),
        ("health-resume", "health", "health_process_resume_failed"),
        ("health-release", "health", "health_process_release_failed"),
        ("health-ack", "health", "health_ack_failed"),
        ("floor-commit", "floor", "floor_commit_failed"),
    ],
)
def test_production_apply_dispatch_faults_preserve_exact_stage(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    mode: str,
    phase: str,
    code: str,
) -> None:
    _private, public = rsa_keys
    helper = tmp_path / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)
    result = _run_powershell_command(
        DISPATCH_FAULT_PROBE,
        env_values={
            "JHT_TEST_HELPER_SOURCE": str(helper),
            "JHT_TEST_DISPATCH_MODE": mode,
            "JHT_TEST_EXPECTED_PHASE": phase,
            "JHT_TEST_EXPECTED_CODE": code,
        },
        check=False,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert result.stdout.strip() == (
        f"WINDOWS-DISPATCH-SEAM PASS mode={mode} phase={phase} code={code}"
    )
    assert str(tmp_path) not in result.stdout
    assert str(tmp_path) not in result.stderr


@pytest.mark.parametrize(
    ("mode", "phase", "code"),
    [
        ("target", "recovery", "recovery_rollback_target_failed"),
        ("authority", "recovery", "recovery_rollback_authority_failed"),
        ("journal", "journal", "journal_rolled_back_write_failed"),
        ("restart", "recovery", "recovery_restart_failed"),
        ("result", "result", "result_write_failed"),
    ],
)
def test_production_recovery_dispatch_faults_preserve_exact_stage(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    mode: str,
    phase: str,
    code: str,
) -> None:
    _private, public = rsa_keys
    helper = tmp_path / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)
    result = _run_powershell_command(
        RECOVERY_FAULT_PROBE,
        env_values={
            "JHT_TEST_HELPER_SOURCE": str(helper),
            "JHT_TEST_RECOVERY_MODE": mode,
            "JHT_TEST_EXPECTED_PHASE": phase,
            "JHT_TEST_EXPECTED_CODE": code,
        },
        check=False,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert result.stdout.strip() == (
        f"WINDOWS-RECOVERY-SEAM PASS mode={mode} phase={phase} code={code}"
    )
    assert str(tmp_path) not in result.stdout
    assert str(tmp_path) not in result.stderr


@pytest.mark.parametrize(
    ("mode", "phase", "code"),
    [
        ("cleanup", "recovery", "recovery_health_cleanup_failed"),
        ("capability", "recovery", "recovery_health_capability_init_failed"),
        ("process", "recovery", "recovery_health_process_failed"),
        ("resume", "recovery", "recovery_health_resume_failed"),
        ("release", "recovery", "recovery_health_release_failed"),
        ("validate", "recovery", "recovery_health_validate_failed"),
    ],
)
def test_production_recovery_health_faults_preserve_exact_stage(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path],
    mode: str,
    phase: str,
    code: str,
) -> None:
    _private, public = rsa_keys
    helper = tmp_path / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)
    result = _run_powershell_command(
        RECOVERY_HEALTH_FAULT_PROBE,
        env_values={
            "JHT_TEST_HELPER_SOURCE": str(helper),
            "JHT_TEST_RECOVERY_HEALTH_MODE": mode,
            "JHT_TEST_EXPECTED_PHASE": phase,
            "JHT_TEST_EXPECTED_CODE": code,
        },
        check=False,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert result.stdout.strip() == (
        f"WINDOWS-RECOVERY-HEALTH-SEAM PASS mode={mode} "
        f"phase={phase} code={code}"
    )
    assert str(tmp_path) not in result.stdout
    assert str(tmp_path) not in result.stderr


def test_production_result_failure_falls_back_to_exact_path_free_stderr(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    _private, public = rsa_keys
    helper = tmp_path / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)
    result = _run_powershell_command(
        RESULT_FALLBACK_PROBE,
        env_values={"JHT_TEST_HELPER_SOURCE": str(helper)},
        check=False,
        capture_output=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "WINDOWS-RESULT-FALLBACK-SEAM PASS"
    assert result.stderr.strip() == (
        "JHT-WINDOWS-UPDATE-ERROR schema=1 "
        "phase=result code=result_write_failed"
    )
    assert str(tmp_path) not in result.stdout
    assert str(tmp_path) not in result.stderr


def test_windows_prelock_internal_error_is_not_reported_as_reparse(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    _private, public = rsa_keys
    installed = tmp_path / "installed"
    installed.mkdir()
    _protect_directory(installed)
    helper = installed / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)
    _set_current_owner(helper)
    _assert_authority("installed", installed, directory=True, protected=True)
    _assert_authority("helper", helper, directory=False, protected=None)
    nonce = "c" * 32
    target = installed / INSTALLED_DESKTOP
    state = tmp_path / "missing-state-parent" / "state"
    transaction = state / nonce
    before = _authority_snapshot(tmp_path)
    result = subprocess.run(
        [
            _powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(helper),
            "-Mode",
            "Verify",
            "-TargetPath",
            str(target),
            "-CandidatePath",
            str(installed / f".jht-update-{nonce}.candidate.exe"),
            "-CandidateHelperPath",
            str(transaction / HELPER),
            "-InstalledManifestPath",
            str(installed / "RELEASE-MANIFEST.json"),
            "-InstalledSignaturePath",
            str(installed / "RELEASE-MANIFEST.json.sig"),
            "-CandidateManifestPath",
            str(transaction / "RELEASE-MANIFEST.json"),
            "-CandidateSignaturePath",
            str(transaction / "RELEASE-MANIFEST.json.sig"),
            "-StateRoot",
            str(state),
            "-Nonce",
            nonce,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert _helper_result_diagnostic(transaction, result.stderr) == (
        "JHT-WINDOWS-UPDATE-ERROR schema=1 phase=location "
        "code=location_node_internal"
    )
    assert "location_node_reparse" not in result.stderr
    assert str(tmp_path) not in result.stderr
    assert _authority_snapshot(tmp_path) == before
    assert not state.exists()
    assert not transaction.exists()
    assert not (state / ".update.lock").exists()
    assert not (state / "committed-floor.json").exists()
    assert not (transaction / "ready.json").exists()


def test_windows_recovery_reclaims_stale_lock_and_rolls_back_post_switch_crash(
    tmp_path: Path, rsa_keys: tuple[Path, Path]
) -> None:
    private, public = rsa_keys
    nonce = "b" * 32
    assert tmp_path.resolve().is_relative_to(
        Path(os.environ["LOCALAPPDATA"]).resolve()
    )
    local_authority = tmp_path / "local-app-data"
    local_authority.mkdir()
    _protect_directory(local_authority)
    helper_env = os.environ.copy()
    helper_env["LOCALAPPDATA"] = str(local_authority)
    programs = local_authority / "Programs"
    programs.mkdir()
    _protect_directory(programs)
    target_dir = programs / "Job Hunter Team"
    target_dir.mkdir(parents=True)
    _protect_directory(target_dir)
    state = local_authority / "Job Hunter Team" / "host-runtime"
    transaction = state / nonce
    transaction.mkdir(parents=True)
    _set_current_owner(state)
    _set_current_owner(transaction)
    assert not _directory_acl_is_protected(state)
    assert not _directory_acl_is_protected(transaction)
    installed_build = tmp_path / "installed-build"
    candidate_build = tmp_path / "candidate-build"
    installed_build.mkdir()
    candidate_build.mkdir()
    system32 = Path(os.environ["SystemRoot"]) / "System32"
    ping = system32 / "ping.exe"
    notepad = system32 / "notepad.exe"
    helper = target_dir / HELPER
    render_helper(template=HELPER_SOURCE, output=helper, public_key=public)

    shutil.copy2(ping, installed_build / DESKTOP)
    shutil.copy2(helper, installed_build / HELPER)
    _write_signed_manifest(
        directory=installed_build,
        version="0.3.6",
        private=private,
        public=public,
    )
    target = target_dir / INSTALLED_DESKTOP
    old_bytes = (installed_build / DESKTOP).read_bytes()
    target.write_bytes(old_bytes)
    shutil.copy2(installed_build / "RELEASE-MANIFEST.json", target_dir)
    shutil.copy2(installed_build / "RELEASE-MANIFEST.json.sig", target_dir)

    shutil.copy2(notepad, candidate_build / DESKTOP)
    shutil.copy2(helper, candidate_build / HELPER)
    _write_signed_manifest(
        directory=candidate_build,
        version="0.3.7",
        private=private,
        public=public,
    )
    candidate = target_dir / f".jht-update-{nonce}.candidate.exe"
    shutil.copy2(candidate_build / DESKTOP, candidate)
    shutil.copy2(candidate_build / HELPER, transaction / HELPER)
    shutil.copy2(candidate_build / "RELEASE-MANIFEST.json", transaction)
    shutil.copy2(candidate_build / "RELEASE-MANIFEST.json.sig", transaction)
    for owned_path in (
        helper,
        target,
        target_dir / "RELEASE-MANIFEST.json",
        target_dir / "RELEASE-MANIFEST.json.sig",
        candidate,
        transaction / HELPER,
        transaction / "RELEASE-MANIFEST.json",
        transaction / "RELEASE-MANIFEST.json.sig",
    ):
        _set_current_owner(owned_path)
    _assert_authority("target_dir", target_dir, directory=True, protected=True)
    _assert_authority("state", state, directory=True, protected=False)
    _assert_authority(
        "transaction", transaction, directory=True, protected=False
    )
    for label, authority_path in (
        ("helper", helper),
        ("target", target),
        ("installed_manifest", target_dir / "RELEASE-MANIFEST.json"),
        ("installed_signature", target_dir / "RELEASE-MANIFEST.json.sig"),
        ("candidate", candidate),
        ("candidate_helper", transaction / HELPER),
        ("candidate_manifest", transaction / "RELEASE-MANIFEST.json"),
        ("candidate_signature", transaction / "RELEASE-MANIFEST.json.sig"),
    ):
        _assert_authority(
            label, authority_path, directory=False, protected=None
        )

    old = subprocess.Popen(
        [str(target), "-t", "127.0.0.1"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    candidate_pid = 0
    updater: subprocess.Popen[str] | None = None
    try:
        base = [
            _powershell(),
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            str(helper),
            "-TargetPath",
            str(target),
            "-CandidatePath",
            str(candidate),
            "-CandidateHelperPath",
            str(transaction / HELPER),
            "-InstalledManifestPath",
            str(target_dir / "RELEASE-MANIFEST.json"),
            "-InstalledSignaturePath",
            str(target_dir / "RELEASE-MANIFEST.json.sig"),
            "-CandidateManifestPath",
            str(transaction / "RELEASE-MANIFEST.json"),
            "-CandidateSignaturePath",
            str(transaction / "RELEASE-MANIFEST.json.sig"),
            "-StateRoot",
            str(state),
            "-Nonce",
            nonce,
            "-OldPid",
            str(old.pid),
        ]
        updater = subprocess.Popen(
            base + ["-Mode", "Apply"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=helper_env,
        )
        ready = transaction / "ready.json"
        deadline = time.monotonic() + 15
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        if not ready.exists():
            _stdout, stderr = updater.communicate(timeout=2)
            pytest.fail(_helper_result_diagnostic(transaction, stderr))
        assert _directory_acl_is_protected(state)
        assert _directory_acl_is_protected(transaction)
        old.terminate()
        old.wait(timeout=5)

        journal_path = transaction / "journal.json"
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if journal_path.exists():
                journal = json.loads(journal_path.read_text())
                if (
                    journal.get("state") == "candidate_installed"
                    and int(journal.get("candidate_pid", 0)) > 0
                ):
                    candidate_pid = int(journal["candidate_pid"])
                    break
            time.sleep(0.05)
        assert candidate_pid > 0
        updater.terminate()
        updater.wait(timeout=5)
        assert not candidate.exists()
        assert (state / ".update.lock").is_dir()

        recovered = subprocess.run(
            base + ["-Mode", "Recover"],
            text=True,
            capture_output=True,
            timeout=30,
            env=helper_env,
        )
        assert recovered.returncode != 0, recovered.stderr
        assert target.read_bytes() == old_bytes
        assert json.loads(journal_path.read_text())["state"] == "rolled_back"
        assert not (state / ".update.lock").exists()
        process_check = _run_powershell_command(
            "if (Get-Process -Id ([int]$env:JHT_TEST_PID) "
            "-ErrorAction SilentlyContinue) { exit 1 }",
            env_values={"JHT_TEST_PID": str(candidate_pid)},
            check=False,
        )
        assert process_check.returncode == 0
    finally:
        if updater and updater.poll() is None:
            updater.kill()
        if old.poll() is None:
            old.kill()

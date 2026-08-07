#!/usr/bin/env powershell
# Fail-closed authority guard embedded in the per-user NSIS installer.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Prepare', 'VerifyInstalled')]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$InstallDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

if (-not ('JhtInstallerFileIdentity' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class JhtInstallerFileIdentity {
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_SHARE_DELETE = 0x00000004;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;

    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string name, uint access, uint share, IntPtr security, uint creation,
        uint flags, IntPtr template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle file, out BY_HANDLE_FILE_INFORMATION information);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(
        SafeFileHandle file, StringBuilder path, uint length, uint flags);

    private static string NormalizeFinalPath(string path) {
        if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
            return @"\\" + path.Substring(8);
        if (path.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase))
            return path.Substring(4);
        return path;
    }

    public static void AssertNode(string inputPath, bool expectDirectory) {
        string expected = Path.GetFullPath(inputPath);
        using (SafeFileHandle handle = CreateFile(
            expected, 0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero, OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero)) {
            if (handle.IsInvalid)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            BY_HANDLE_FILE_INFORMATION info;
            if (!GetFileInformationByHandle(handle, out info))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            bool isDirectory = (info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
            if (isDirectory != expectDirectory)
                throw new InvalidDataException("installer node type mismatch");
            if ((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                throw new InvalidDataException("installer node is a reparse point");
            if (!isDirectory && info.NumberOfLinks != 1)
                throw new InvalidDataException("installer file has multiple hard links");
            StringBuilder finalPath = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(
                handle, finalPath, (uint)finalPath.Capacity, 0);
            if (length == 0 || length >= finalPath.Capacity)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            string actual = Path.GetFullPath(NormalizeFinalPath(finalPath.ToString()));
            if (!String.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("installer canonical path changed");
        }
    }
}
'@
}

function Get-NodeAcl {
  param([IO.FileSystemInfo]$Node)
  return $Node.GetAccessControl(
    [Security.AccessControl.AccessControlSections]::All)
}

function Set-NodeAcl {
  param([IO.FileSystemInfo]$Node, [Security.AccessControl.FileSystemSecurity]$Acl)
  $Node.SetAccessControl($Acl)
}

function Assert-OwnerAndAcl {
  param(
    [IO.FileSystemInfo]$Node,
    [switch]$RequireProtected,
    [string]$Label = 'node')
  $acl = Get-NodeAcl $Node
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $ownerSid = $acl.GetOwner(
    [Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -ne $currentSid) {
    throw "installer node has a foreign owner [$Label]"
  }
  if ($RequireProtected -and -not $acl.AreAccessRulesProtected) {
    throw 'installer directory inherits its DACL'
  }
  $writeMask = [Security.AccessControl.FileSystemRights]::WriteData -bor
    [Security.AccessControl.FileSystemRights]::AppendData -bor
    [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
    [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
    [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [Security.AccessControl.FileSystemRights]::Delete -bor
    [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach ($rule in $acl.GetAccessRules(
      $true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne 'Allow') { continue }
    $rights = [Security.AccessControl.FileSystemRights]$rule.FileSystemRights
    if (($rights -band $writeMask) -eq 0) { continue }
    $sid = $rule.IdentityReference.Value
    if ($sid -notin @($currentSid, 'S-1-5-18', 'S-1-5-32-544')) {
      throw 'installer node grants write to another principal'
    }
  }
}

function Protect-Node {
  param([IO.FileSystemInfo]$Node)
  $acl = Get-NodeAcl $Node
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.SetOwner($currentSid)
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($identity in @($acl.GetAccessRules(
      $true, $true, [Security.Principal.SecurityIdentifier]) |
      ForEach-Object { $_.IdentityReference } | Select-Object -Unique)) {
    $acl.PurgeAccessRules($identity)
  }
  $inheritance = if ($Node -is [IO.DirectoryInfo]) {
    [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
  } else {
    [Security.AccessControl.InheritanceFlags]::None
  }
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $currentSid,
    [Security.AccessControl.FileSystemRights]::FullControl,
    $inheritance,
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow)
  $acl.SetAccessRule($rule)
  Set-NodeAcl $Node $acl
}

function Assert-PostWritePayload {
  param([IO.FileInfo]$Node)
  $acl = Get-NodeAcl $Node
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $ownerSid = $acl.GetOwner(
    [Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -notin @($currentSid, 'S-1-5-18', 'S-1-5-32-544')) {
    throw 'installed payload has an unexpected owner'
  }
  $writeMask = [Security.AccessControl.FileSystemRights]::WriteData -bor
    [Security.AccessControl.FileSystemRights]::AppendData -bor
    [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
    [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
    [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [Security.AccessControl.FileSystemRights]::Delete -bor
    [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [Security.AccessControl.FileSystemRights]::TakeOwnership
  foreach ($rule in $acl.GetAccessRules(
      $true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne 'Allow') { continue }
    $rights = [Security.AccessControl.FileSystemRights]$rule.FileSystemRights
    if (($rights -band $writeMask) -eq 0) { continue }
    if ($rule.IdentityReference.Value -notin @(
        $currentSid, 'S-1-5-18', 'S-1-5-32-544')) {
      throw 'installed payload grants write to another principal'
    }
  }
}

function Get-TreeNodes {
  param([IO.DirectoryInfo]$Root)
  $pending = [Collections.Generic.Stack[IO.DirectoryInfo]]::new()
  $pending.Push($Root)
  while ($pending.Count -gt 0) {
    $directory = $pending.Pop()
    Write-Output $directory
    foreach ($child in $directory.EnumerateFileSystemInfos()) {
      $isDirectory = $child -is [IO.DirectoryInfo]
      [JhtInstallerFileIdentity]::AssertNode($child.FullName, $isDirectory)
      if ($isDirectory) {
        $pending.Push([IO.DirectoryInfo]$child)
      } else {
        Write-Output $child
      }
    }
  }
}

function Get-FileSystemParent {
  param([IO.FileSystemInfo]$Node)
  if ($Node -is [IO.FileInfo]) { return $Node.Directory }
  if ($Node -is [IO.DirectoryInfo]) { return $Node.Parent }
  throw 'unexpected filesystem node type during installer path traversal'
}

function Assert-Ancestors {
  param([string]$Path)
  $probe = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  while ($null -ne $probe) {
    [JhtInstallerFileIdentity]::AssertNode($probe.FullName, $true)
    $parent = Get-FileSystemParent $probe
    if ($null -eq $parent -or $parent.FullName -eq $probe.FullName) { break }
    $probe = $parent
  }
}

function Assert-Tree {
  param([IO.DirectoryInfo]$Root, [switch]$RequireProtectedRoot)
  foreach ($node in Get-TreeNodes $Root) {
    $label = if ($node.FullName -eq $Root.FullName) {
      'root'
    } elseif ($node -is [IO.DirectoryInfo]) {
      'child_directory'
    } else {
      'child_file'
    }
    [JhtInstallerFileIdentity]::AssertNode(
      $node.FullName, ($node -is [IO.DirectoryInfo]))
    Assert-OwnerAndAcl $node -RequireProtected:(
      $RequireProtectedRoot -and $node.FullName -eq $Root.FullName) -Label $label
  }
}

$expected = [IO.Path]::GetFullPath(
  (Join-Path $env:LOCALAPPDATA 'Programs\Job Hunter Team'))
$requested = [IO.Path]::GetFullPath($InstallDir)
if (-not [string]::Equals(
    $requested, $expected, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'installer path is not the fixed per-user host path'
}

$local = [IO.Path]::GetFullPath($env:LOCALAPPDATA)
Assert-Ancestors $local
$localNode = Get-Item -LiteralPath $local -Force -ErrorAction Stop
Assert-OwnerAndAcl $localNode -Label 'localappdata'
$programs = Join-Path $local 'Programs'
if (-not (Test-Path -LiteralPath $programs)) {
  if ($Mode -ne 'Prepare') { throw 'installer Programs directory is missing' }
  New-Item -ItemType Directory -Path $programs -ErrorAction Stop | Out-Null
}
[JhtInstallerFileIdentity]::AssertNode($programs, $true)
$programsNode = Get-Item -LiteralPath $programs -Force -ErrorAction Stop
Assert-OwnerAndAcl $programsNode -Label 'programs'

$created = $false
if (-not (Test-Path -LiteralPath $requested)) {
  if ($Mode -ne 'Prepare') { throw 'installer directory is missing' }
  New-Item -ItemType Directory -Path $requested -ErrorAction Stop | Out-Null
  $created = $true
}
$root = Get-Item -LiteralPath $requested -Force -ErrorAction Stop
[JhtInstallerFileIdentity]::AssertNode($root.FullName, $true)

if (-not $created -and $Mode -eq 'Prepare') {
  # Census completo e read-only della baseline legacy prima di normalizzare ACL.
  Assert-Tree $root
}

if ($Mode -eq 'Prepare') {
  $nodes = @(Get-TreeNodes $root)
  foreach ($node in $nodes) { Protect-Node $node }
  Assert-Tree $root -RequireProtectedRoot
  exit 0
}

$requiredPaths = @(
    'job-hunter-team.exe',
    'icon.ico',
    'jht-windows-update.ps1',
    'RELEASE-MANIFEST.json',
    'RELEASE-MANIFEST.json.sig',
    'Uninstall.exe') | ForEach-Object { Join-Path $requested $_ }
foreach ($path in $requiredPaths) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw 'installed payload is missing'
  }
}

# The installer writes these embedded bytes only after Prepare completed. Do a
# full read-only identity/ACL census first; only then normalize the known
# payload nodes to the current owner and an owner-only protected DACL.
$payloads = [Collections.Generic.HashSet[string]]::new(
  [StringComparer]::OrdinalIgnoreCase)
foreach ($path in $requiredPaths) { $null = $payloads.Add([IO.Path]::GetFullPath($path)) }
$nodes = @(Get-TreeNodes $root)
foreach ($node in $nodes) {
  if ($payloads.Contains($node.FullName)) {
    if ($node -isnot [IO.FileInfo]) { throw 'installed payload is not a file' }
    Assert-PostWritePayload ([IO.FileInfo]$node)
  } else {
    $label = if ($node.FullName -eq $root.FullName) {
      'postwrite_root'
    } elseif ($node -is [IO.DirectoryInfo]) {
      'postwrite_unexpected_directory'
    } else {
      'postwrite_unexpected_file'
    }
    Assert-OwnerAndAcl $node -Label $label
  }
}
foreach ($node in $nodes) {
  if ($payloads.Contains($node.FullName)) { Protect-Node $node }
}
Assert-Tree $root -RequireProtectedRoot

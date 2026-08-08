# Job Hunter Team Windows desktop updater.
#
# This script is rendered with the production SPKI before it is shipped.  It is
# never downloaded as an authority: v0.3.6 installs/materializes it first, and
# every later invocation verifies both its installed bytes and the candidate
# release with the already-pinned key.

[CmdletBinding()]
param(
  [ValidateSet('Verify','Apply','Recover')]
  [string]$Mode = 'Verify',
  [Parameter(Mandatory = $true)][string]$TargetPath,
  [Parameter(Mandatory = $true)][string]$CandidatePath,
  [Parameter(Mandatory = $true)][string]$CandidateHelperPath,
  [Parameter(Mandatory = $true)][string]$InstalledManifestPath,
  [Parameter(Mandatory = $true)][string]$InstalledSignaturePath,
  [Parameter(Mandatory = $true)][string]$CandidateManifestPath,
  [Parameter(Mandatory = $true)][string]$CandidateSignaturePath,
  [Parameter(Mandatory = $true)][string]$StateRoot,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{32}$')][string]$Nonce,
  [int]$OldPid = 0,
  [string]$OldStartedUtcTicks = '',
  [string]$RequestId = '',
  [string]$InstanceId = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$TrustedPublicKeysSpkiPem = @(
__JHT_RELEASE_PUBLIC_KEYS_SPKI_PEM__
)
$ManifestLimit = 65536
$SignatureSize = 384
$Protocol = 'jht-windows-update-v1'
$DesktopRole = 'windows-desktop'
$HelperRole = 'windows-update-helper'
$BaselineVersion = '0.3.6'
$AllowedDesktopName = 'job-hunter-team-windows-x64-portable.exe'
$AllowedHelperName = 'jht-windows-update.ps1'
$TxnDir = Join-Path $StateRoot $Nonce
$JournalPath = Join-Path $TxnDir 'journal.json'
$ReadyPath = Join-Path $TxnDir 'ready.json'
$HealthPath = Join-Path $TxnDir 'health.json'
$ResultPath = Join-Path $TxnDir 'result.json'
$FloorPath = Join-Path $StateRoot 'committed-floor.json'
$LockPath = Join-Path $StateRoot '.update.lock'
$BackupPath = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($TargetPath))) ('.jht-update-' + $Nonce + '.backup.exe')
$FailedPath = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($TargetPath))) ('.jht-update-' + $Nonce + '.failed.exe')
$AuthorityBackupDir = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($TargetPath))) ('.jht-update-' + $Nonce + '.authority-backup')
$OldHelperBackupPath = Join-Path $AuthorityBackupDir $AllowedHelperName
$OldManifestBackupPath = Join-Path $AuthorityBackupDir 'RELEASE-MANIFEST.json'
$OldSignatureBackupPath = Join-Path $AuthorityBackupDir 'RELEASE-MANIFEST.json.sig'
$script:LockOwnerStarted = [Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().Ticks.ToString()
$script:FailurePhase = 'location'
$script:FailureCode = 'location_init'

if (-not ('JhtUpdateFileIdentity' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class JhtUpdateFileIdentity {
    private const uint GENERIC_READ = 0x80000000;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint READ_CONTROL = 0x00020000;
    private const uint WRITE_DAC = 0x00040000;
    private const uint WRITE_OWNER = 0x00080000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_SHARE_DELETE = 0x00000004;
    private const uint CREATE_NEW = 1;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_FLAG_SEQUENTIAL_SCAN = 0x08000000;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
    private const uint MOVEFILE_REPLACE_EXISTING = 0x00000001;
    private const uint MOVEFILE_WRITE_THROUGH = 0x00000008;
    private const uint OWNER_SECURITY_INFORMATION = 0x00000001;
    private const uint DACL_SECURITY_INFORMATION = 0x00000004;
    private const uint PROTECTED_DACL_SECURITY_INFORMATION = 0x80000000;

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

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool MoveFileEx(
        string existingName, string newName, uint flags);

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

    private static string NormalizeFinalPath(string path) {
        if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
            return @"\\" + path.Substring(8);
        if (path.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase))
            return path.Substring(4);
        return path;
    }

    private static BY_HANDLE_FILE_INFORMATION AssertIdentity(
        SafeFileHandle handle, string expected) {
        BY_HANDLE_FILE_INFORMATION info;
        if (!GetFileInformationByHandle(handle, out info))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if ((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
            throw new InvalidDataException("update file is a reparse point");
        if (info.NumberOfLinks != 1)
            throw new InvalidDataException("update file has multiple hard links");
        StringBuilder finalPath = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandle(
            handle, finalPath, (uint)finalPath.Capacity, 0);
        if (length == 0 || length >= finalPath.Capacity)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        string actual = Path.GetFullPath(NormalizeFinalPath(finalPath.ToString()));
        if (!String.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("update file canonical path changed");
        return info;
    }

    public static int GetNoFollowNodeKind(string inputPath) {
        string expected = Path.GetFullPath(inputPath);
        using (SafeFileHandle handle = CreateFile(
            expected, 0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero, OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            IntPtr.Zero)) {
            if (handle.IsInvalid) {
                int error = Marshal.GetLastWin32Error();
                if (error == 2 || error == 3) return 0;
                throw new Win32Exception(error);
            }
            BY_HANDLE_FILE_INFORMATION info;
            if (!GetFileInformationByHandle(handle, out info))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if ((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                return 3;
            return (info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0
                ? 2 : 1;
        }
    }

    public static int GetNoFollowCanonicalState(string inputPath) {
        string expected = Path.GetFullPath(inputPath);
        using (SafeFileHandle handle = CreateFile(
            expected, 0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero, OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            IntPtr.Zero)) {
            if (handle.IsInvalid)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            StringBuilder finalPath = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(
                handle, finalPath, (uint)finalPath.Capacity, 0);
            if (length == 0 || length >= finalPath.Capacity)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            string actual = Path.GetFullPath(
                NormalizeFinalPath(finalPath.ToString()));
            return String.Equals(actual, expected,
                StringComparison.OrdinalIgnoreCase) ? 1 : 2;
        }
    }

    public static string Sha256(string inputPath) {
        string expected = Path.GetFullPath(inputPath);
        using (SafeFileHandle handle = CreateFile(
            expected, GENERIC_READ, FILE_SHARE_READ, IntPtr.Zero, OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            AssertIdentity(handle, expected);
            using (FileStream stream = new FileStream(handle, FileAccess.Read, 1048576, false))
            using (SHA256 algorithm = SHA256.Create()) {
                return BitConverter.ToString(algorithm.ComputeHash(stream))
                    .Replace("-", "").ToLowerInvariant();
            }
        }
    }

    public static string HardenAndSha256(FileStream stream, string inputPath) {
        string expected = Path.GetFullPath(inputPath);
        SafeFileHandle handle = stream.SafeFileHandle;
        BY_HANDLE_FILE_INFORMATION before = AssertIdentity(handle, expected);
        FileSecurity security = new FileSecurity();
        SecurityIdentifier current = WindowsIdentity.GetCurrent().User;
        security.SetOwner(current);
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new FileSystemAccessRule(
            current, FileSystemRights.FullControl, AccessControlType.Allow));
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
            uint result = SetSecurityInfo(handle.DangerousGetHandle(), 1,
                OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION |
                PROTECTED_DACL_SECURITY_INFORMATION, owner, IntPtr.Zero,
                dacl, IntPtr.Zero);
            if (result != 0) throw new Win32Exception((int)result);
        } finally {
            pinned.Free();
        }
        BY_HANDLE_FILE_INFORMATION after = AssertIdentity(handle, expected);
        if (before.VolumeSerialNumber != after.VolumeSerialNumber ||
            before.FileIndexHigh != after.FileIndexHigh ||
            before.FileIndexLow != after.FileIndexLow)
            throw new InvalidDataException("update file identity changed");
        stream.Position = 0;
        using (SHA256 algorithm = SHA256.Create()) {
            return BitConverter.ToString(algorithm.ComputeHash(stream))
                .Replace("-", "").ToLowerInvariant();
        }
    }

    public static FileStream CreateNewAtomicStream(string inputPath) {
        string path = Path.GetFullPath(inputPath);
        SafeFileHandle handle = CreateFile(path,
            GENERIC_READ | GENERIC_WRITE | READ_CONTROL | WRITE_DAC | WRITE_OWNER,
            0, IntPtr.Zero, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            return new FileStream(handle, FileAccess.ReadWrite, 4096, false);
        } catch {
            handle.Dispose();
            throw;
        }
    }

    public static void MoveReplace(string sourcePath, string destinationPath,
        bool replaceExisting) {
        uint flags = MOVEFILE_WRITE_THROUGH;
        if (replaceExisting) flags |= MOVEFILE_REPLACE_EXISTING;
        if (!MoveFileEx(Path.GetFullPath(sourcePath),
            Path.GetFullPath(destinationPath), flags))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
}

public sealed class JhtSuspendedProcess : IDisposable {
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002000D;
    private IntPtr processHandle;
    private IntPtr threadHandle;
    private IntPtr jobHandle;
    public int ProcessId { get; private set; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO {
        public uint cb; public string reserved; public string desktop; public string title;
        public uint x; public uint y; public uint xSize; public uint ySize;
        public uint xCountChars; public uint yCountChars; public uint fillAttribute;
        public uint flags; public short showWindow; public short reserved2;
        public IntPtr reserved2Pointer; public IntPtr standardInput;
        public IntPtr standardOutput; public IntPtr standardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION {
        public IntPtr process; public IntPtr thread; public uint processId; public uint threadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX {
        public STARTUPINFO startupInfo;
        public IntPtr attributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long perProcessUserTimeLimit; public long perJobUserTimeLimit;
        public uint limitFlags; public UIntPtr minimumWorkingSetSize;
        public UIntPtr maximumWorkingSetSize; public uint activeProcessLimit;
        public UIntPtr affinity; public uint priorityClass; public uint schedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS {
        public ulong readOperationCount; public ulong writeOperationCount;
        public ulong otherOperationCount; public ulong readTransferCount;
        public ulong writeTransferCount; public ulong otherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION basicLimitInformation;
        public IO_COUNTERS ioInfo; public UIntPtr processMemoryLimit;
        public UIntPtr jobMemoryLimit; public UIntPtr peakProcessMemoryUsed;
        public UIntPtr peakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName, StringBuilder commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint creationFlags,
        IntPtr environment, string currentDirectory, ref STARTUPINFOEX startup,
        out PROCESS_INFORMATION information);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(
        IntPtr job, int informationClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information, uint length);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList, int attributeCount, uint flags, ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList, uint flags, IntPtr attribute, IntPtr value,
        IntPtr size, IntPtr previousValue, IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    public static JhtSuspendedProcess Create(string inputPath) {
        string path = Path.GetFullPath(inputPath);
        JhtSuspendedProcess value = new JhtSuspendedProcess();
        IntPtr attributeList = IntPtr.Zero;
        IntPtr jobValue = IntPtr.Zero;
        try {
            value.jobHandle = CreateJobObject(IntPtr.Zero, null);
            if (value.jobHandle == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits =
                new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.basicLimitInformation.limitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if (!SetInformationJobObject(value.jobHandle, 9, ref limits,
                (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
                throw new Win32Exception(Marshal.GetLastWin32Error());

            IntPtr attributeBytes = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeBytes);
            if (attributeBytes == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            attributeList = Marshal.AllocHGlobal(attributeBytes);
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeBytes))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            jobValue = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobValue, value.jobHandle);
            if (!UpdateProcThreadAttribute(
                attributeList, 0, new IntPtr(PROC_THREAD_ATTRIBUTE_JOB_LIST),
                jobValue, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error());

            STARTUPINFOEX startup = new STARTUPINFOEX();
            startup.startupInfo.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFOEX));
            startup.attributeList = attributeList;
            PROCESS_INFORMATION info;
            StringBuilder command = new StringBuilder("\"" + path + "\"");
            if (!CreateProcess(path, command, IntPtr.Zero, IntPtr.Zero, false,
                CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
                IntPtr.Zero, Path.GetDirectoryName(path), ref startup, out info))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            value.processHandle = info.process;
            value.threadHandle = info.thread;
            value.ProcessId = checked((int)info.processId);
            return value;
        } catch {
            if (value.processHandle != IntPtr.Zero)
                TerminateProcess(value.processHandle, 1);
            value.Dispose();
            throw;
        } finally {
            if (attributeList != IntPtr.Zero) {
                DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }
            if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
        }
    }

    public void Resume() {
        if (threadHandle == IntPtr.Zero || ResumeThread(threadHandle) == UInt32.MaxValue)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        CloseHandle(threadHandle); threadHandle = IntPtr.Zero;
    }

    public void ReleaseOwnership() {
        if (jobHandle == IntPtr.Zero) throw new InvalidOperationException("process job is unavailable");
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits =
            new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        if (!SetInformationJobObject(jobHandle, 9, ref limits,
            (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        CloseHandle(jobHandle); jobHandle = IntPtr.Zero;
    }

    public void Dispose() {
        if (jobHandle != IntPtr.Zero) { CloseHandle(jobHandle); jobHandle = IntPtr.Zero; }
        if (threadHandle != IntPtr.Zero) { CloseHandle(threadHandle); threadHandle = IntPtr.Zero; }
        if (processHandle != IntPtr.Zero) { CloseHandle(processHandle); processHandle = IntPtr.Zero; }
    }
}
'@
}

function ConvertTo-LowerHex {
  param([byte[]]$Bytes)
  return ([BitConverter]::ToString($Bytes)).Replace('-', '').ToLowerInvariant()
}

function Get-Sha256 {
  param([string]$Path)
  return [JhtUpdateFileIdentity]::Sha256([IO.Path]::GetFullPath($Path))
}

function Test-ExactProperties {
  param([object]$Value, [string[]]$Expected)
  if ($null -eq $Value -or $null -eq $Value.PSObject) { return $false }
  $actual = @($Value.PSObject.Properties.Name | Sort-Object)
  $wanted = @($Expected | Sort-Object)
  if ($actual.Count -ne $wanted.Count) { return $false }
  for ($i = 0; $i -lt $wanted.Count; $i++) {
    if ($actual[$i] -cne $wanted[$i]) { return $false }
  }
  return $true
}

function Test-JsonInteger {
  param([object]$Value)
  return ($Value -is [int] -or $Value -is [long]) -and $Value -ge 0
}

function Get-VersionParts {
  param([string]$Version)
  if ($Version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { return $null }
  $parts = @([uint64]$Matches[1], [uint64]$Matches[2], [uint64]$Matches[3])
  if ($parts | Where-Object { $_ -gt 2097151 }) { return $null }
  return $parts
}

function Get-VersionSequence {
  param([string]$Version)
  $parts = Get-VersionParts $Version
  if ($null -eq $parts) { throw 'invalid stable semantic version' }
  $sequence = $parts[0] * [uint64]4398046511104 + $parts[1] * [uint64]2097152 + $parts[2]
  if ($sequence -eq 0) { throw 'release sequence must be positive' }
  return [uint64]$sequence
}

function Compare-Version {
  param([string]$Left, [string]$Right)
  $a = Get-VersionParts $Left
  $b = Get-VersionParts $Right
  if ($null -eq $a -or $null -eq $b) { throw 'invalid stable semantic version' }
  for ($i = 0; $i -lt 3; $i++) {
    if ($a[$i] -lt $b[$i]) { return -1 }
    if ($a[$i] -gt $b[$i]) { return 1 }
  }
  return 0
}

function Read-DerLength {
  param([byte[]]$Bytes, [ref]$Offset)
  if ($Offset.Value -ge $Bytes.Length) { throw 'truncated DER length' }
  $first = [int]$Bytes[$Offset.Value]
  $Offset.Value += 1
  if (($first -band 0x80) -eq 0) { return $first }
  $count = $first -band 0x7f
  if ($count -lt 1 -or $count -gt 4 -or $Offset.Value + $count -gt $Bytes.Length) { throw 'invalid DER length' }
  if ($Bytes[$Offset.Value] -eq 0) { throw 'non-canonical DER length' }
  $length = 0
  for ($i = 0; $i -lt $count; $i++) {
    $length = ($length -shl 8) -bor [int]$Bytes[$Offset.Value]
    $Offset.Value += 1
  }
  if ($length -lt 128) { throw 'non-canonical DER long length' }
  return $length
}

function Read-DerElement {
  param([byte[]]$Bytes, [ref]$Offset, [int]$Tag)
  if ($Offset.Value -ge $Bytes.Length -or [int]$Bytes[$Offset.Value] -ne $Tag) { throw 'unexpected DER tag' }
  $Offset.Value += 1
  $length = Read-DerLength $Bytes $Offset
  if ($length -lt 0 -or $Offset.Value + $length -gt $Bytes.Length) { throw 'truncated DER value' }
  $value = [byte[]]@($Bytes[$Offset.Value..($Offset.Value + $length - 1)])
  $Offset.Value += $length
  return $value
}

function Get-RsaFromPem {
  param([string]$Pem)
  $body = $Pem.Replace('-----BEGIN PUBLIC KEY-----', '').Replace('-----END PUBLIC KEY-----', '') -replace '\s', ''
  try { $der = [Convert]::FromBase64String($body) } catch { throw 'embedded SPKI PEM is invalid' }
  $fingerprint = ConvertTo-LowerHex ([Security.Cryptography.SHA256]::Create().ComputeHash($der))

  $offset = 0
  $spki = Read-DerElement $der ([ref]$offset) 0x30
  if ($offset -ne $der.Length) { throw 'trailing SPKI bytes' }
  $innerOffset = 0
  $algorithm = Read-DerElement $spki ([ref]$innerOffset) 0x30
  if ((ConvertTo-LowerHex $algorithm) -cne '06092a864886f70d0101010500') { throw 'SPKI is not rsaEncryption with NULL parameters' }
  $bits = Read-DerElement $spki ([ref]$innerOffset) 0x03
  if ($innerOffset -ne $spki.Length -or $bits.Length -lt 2 -or $bits[0] -ne 0) { throw 'invalid SPKI bit string' }
  $rsaDer = [byte[]]@($bits[1..($bits.Length - 1)])
  $rsaOffset = 0
  $rsaSequence = Read-DerElement $rsaDer ([ref]$rsaOffset) 0x30
  if ($rsaOffset -ne $rsaDer.Length) { throw 'trailing RSA public-key bytes' }
  $keyOffset = 0
  $modulus = Read-DerElement $rsaSequence ([ref]$keyOffset) 0x02
  $exponent = Read-DerElement $rsaSequence ([ref]$keyOffset) 0x02
  if ($keyOffset -ne $rsaSequence.Length) { throw 'trailing RSA parameters' }
  if ($modulus.Length -eq 385 -and $modulus[0] -eq 0) { $modulus = [byte[]]@($modulus[1..384]) }
  if ($modulus.Length -ne 384 -or $exponent.Length -lt 1 -or $exponent.Length -gt 4) { throw 'release key is not RSA-3072' }
  $parameters = New-Object Security.Cryptography.RSAParameters
  $parameters.Modulus = $modulus
  $parameters.Exponent = $exponent
  $provider = New-Object Security.Cryptography.CspParameters
  $provider.ProviderType = 24
  $rsa = New-Object -TypeName Security.Cryptography.RSACryptoServiceProvider -ArgumentList $provider
  $rsa.PersistKeyInCsp = $false
  $rsa.ImportParameters($parameters)
  return @{ Rsa = $rsa; KeyId = $fingerprint }
}

function Get-PinnedRsas {
  if (@($TrustedPublicKeysSpkiPem).Count -lt 1 -or @($TrustedPublicKeysSpkiPem).Count -gt 2) { throw 'release keyring size is invalid' }
  $seen = @{}; $keys = @()
  foreach ($pem in @($TrustedPublicKeysSpkiPem)) {
    if ($pem.Contains('__JHT_RELEASE_PUBLIC_KEYS_')) { throw 'production release public key is not embedded' }
    $key = Get-RsaFromPem $pem
    if ($seen.ContainsKey($key.KeyId)) { throw 'duplicate release key fingerprint' }
    $seen[$key.KeyId] = $true; $keys += $key
  }
  return $keys
}

function Read-VerifiedManifest {
  param([string]$ManifestPath, [string]$SignaturePath)
  $manifestInfo = Get-Item -LiteralPath $ManifestPath -Force -ErrorAction Stop
  $signatureInfo = Get-Item -LiteralPath $SignaturePath -Force -ErrorAction Stop
  if (($manifestInfo -is [IO.DirectoryInfo]) -or ($signatureInfo -is [IO.DirectoryInfo]) -or $manifestInfo.Length -lt 1 -or $manifestInfo.Length -gt $ManifestLimit -or $signatureInfo.Length -ne $SignatureSize) { throw 'signed release metadata size is invalid' }
  $manifestHash = Get-Sha256 $manifestInfo.FullName
  $signatureHash = Get-Sha256 $signatureInfo.FullName
  [byte[]]$raw = [IO.File]::ReadAllBytes($manifestInfo.FullName)
  [byte[]]$signature = [IO.File]::ReadAllBytes($signatureInfo.FullName)
  if ((Get-Sha256 $manifestInfo.FullName) -cne $manifestHash -or (Get-Sha256 $signatureInfo.FullName) -cne $signatureHash) { throw 'signed release metadata changed while reading' }
  $verifiedKeys = @()
  foreach ($key in @(Get-PinnedRsas)) { if ($key.Rsa.VerifyData($raw, [Security.Cryptography.CryptoConfig]::MapNameToOID('SHA256'), $signature)) { $verifiedKeys += $key } }
  if ($verifiedKeys.Count -ne 1) { throw 'release signature verification failed' }

  # Parsing happens only after signature verification. The producer signs the
  # canonical ASCII bytes; these cheap framing checks prevent alternate JSON
  # encodings from reaching ConvertFrom-Json.
  if ($raw[0] -eq 0xef -or $raw[$raw.Length - 1] -ne 0x0a -or ($raw -contains 0x0d) -or ($raw -contains 0x00)) { throw 'release manifest encoding is invalid' }
  foreach ($byte in $raw) { if ($byte -gt 0x7f) { throw 'release manifest must be ASCII' } }
  $text = [Text.Encoding]::ASCII.GetString($raw)
  try { $manifest = $text | ConvertFrom-Json -ErrorAction Stop } catch { throw 'signed release manifest JSON is invalid' }
  Assert-ManifestSchema $manifest $verifiedKeys[0].KeyId
  if ((Get-CanonicalManifestText $manifest) -cne $text) { throw 'release manifest bytes are not canonical' }
  return @{ Value = $manifest; Raw = $raw; Sha256 = ConvertTo-LowerHex ([Security.Cryptography.SHA256]::Create().ComputeHash($raw)) }
}

function Get-CanonicalManifestText {
  param([object]$Manifest)
  $artifacts = @()
  foreach ($artifact in @($Manifest.artifacts)) {
    $artifacts += [ordered]@{
      arch = [string]$artifact.arch
      filename = [string]$artifact.filename
      platform = [string]$artifact.platform
      protocol = [string]$artifact.protocol
      role = [string]$artifact.role
      sha256 = [string]$artifact.sha256
      size = [uint64]$artifact.size
    }
  }
  $canonical = [ordered]@{
    artifacts = $artifacts
    channel = [string]$Manifest.channel
    commit = [string]$Manifest.commit
    key_id = [string]$Manifest.key_id
    product = [string]$Manifest.product
    published_at = [string]$Manifest.published_at
    repository = [string]$Manifest.repository
    schema_version = [int64]$Manifest.schema_version
    sequence = [uint64]$Manifest.sequence
    tag = [string]$Manifest.tag
    version = [string]$Manifest.version
  }
  return ($canonical | ConvertTo-Json -Compress -Depth 8) + "`n"
}

function Assert-ManifestSchema {
  param([object]$Manifest, [string]$ExpectedKeyId)
  $top = @('artifacts','channel','commit','key_id','product','published_at','repository','schema_version','sequence','tag','version')
  if (-not (Test-ExactProperties $Manifest $top)) { throw 'release manifest top-level schema mismatch' }
  if (-not (Test-JsonInteger $Manifest.schema_version) -or [int64]$Manifest.schema_version -ne 1) { throw 'invalid manifest schema_version type/value' }
  if ($Manifest.key_id -isnot [string] -or $Manifest.key_id -cne $ExpectedKeyId) { throw 'manifest key_id does not match embedded SPKI' }
  if ($Manifest.product -cne 'job-hunter-team' -or $Manifest.repository -cne 'leopu00/job-hunter-team' -or $Manifest.channel -cne 'stable') { throw 'manifest product/repository/channel mismatch' }
  if ($Manifest.version -isnot [string] -or $Manifest.tag -isnot [string] -or $Manifest.tag -cne ('v' + $Manifest.version)) { throw 'manifest tag/version mismatch' }
  $expectedSequence = Get-VersionSequence $Manifest.version
  if (-not (Test-JsonInteger $Manifest.sequence) -or [uint64]$Manifest.sequence -ne $expectedSequence) { throw 'manifest sequence/version mismatch' }
  if ($Manifest.commit -isnot [string] -or $Manifest.commit -notmatch '^[0-9a-f]{40}$') { throw 'invalid manifest commit' }
  if ($Manifest.published_at -isnot [string] -or $Manifest.published_at -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$') { throw 'invalid manifest published_at' }
  $published = [DateTime]::MinValue
  if (-not [DateTime]::TryParseExact($Manifest.published_at, 'yyyy-MM-ddTHH:mm:ssZ', [Globalization.CultureInfo]::InvariantCulture, ([Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal), [ref]$published)) { throw 'invalid manifest published_at' }
  $artifacts = @($Manifest.artifacts)
  if ($artifacts.Count -ne 2) { throw 'manifest must contain exactly two update artifacts' }
  $seenRoles = @{}
  $seenNames = @{}
  $previous = ''
  foreach ($artifact in $artifacts) {
    if (-not (Test-ExactProperties $artifact @('arch','filename','platform','protocol','role','sha256','size'))) { throw 'artifact schema mismatch' }
    foreach ($field in @('arch','filename','platform','protocol','role','sha256')) { if ($artifact.$field -isnot [string]) { throw "artifact $field type mismatch" } }
    foreach ($field in @('arch','platform','protocol','role')) { if ($artifact.$field -notmatch '^[a-z0-9][a-z0-9._-]{0,63}$') { throw "artifact $field value mismatch" } }
    if (-not (Test-JsonInteger $artifact.size) -or [uint64]$artifact.size -lt 1) { throw 'artifact size type/value mismatch' }
    if ($artifact.sha256 -notmatch '^[0-9a-f]{64}$' -or $artifact.filename -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') { throw 'artifact filename/hash mismatch' }
    $identity = "$($artifact.role)`n$($artifact.platform)`n$($artifact.arch)`n$($artifact.filename)"
    if ($previous -and [string]::CompareOrdinal($previous, $identity) -ge 0) { throw 'artifacts are not uniquely sorted' }
    $previous = $identity
    if ($seenRoles.ContainsKey($artifact.role) -or $seenNames.ContainsKey($artifact.filename.ToLowerInvariant())) { throw 'duplicate artifact role/filename' }
    $seenRoles[$artifact.role] = $true
    $seenNames[$artifact.filename.ToLowerInvariant()] = $true
    $binding = "$($artifact.platform)|$($artifact.arch)|$($artifact.filename)|$($artifact.protocol)"
    switch -CaseSensitive ([string]$artifact.role) {
      'windows-desktop' { if ($binding -cne 'windows|x86_64|job-hunter-team-windows-x64-portable.exe|jht-windows-desktop-v1') { throw 'Windows desktop artifact binding mismatch' } }
      'windows-update-helper' { if ($binding -cne 'windows|x86_64|jht-windows-update.ps1|jht-windows-update-v1') { throw 'Windows helper artifact binding mismatch' } }
      default { throw 'unknown artifact role' }
    }
  }
  $desktop = @($artifacts | Where-Object { $_.role -ceq $DesktopRole })
  $helper = @($artifacts | Where-Object { $_.role -ceq $HelperRole })
  if ($desktop.Count -ne 1 -or $helper.Count -ne 1) { throw 'required Windows roles are missing or duplicated' }
}

function Get-ArtifactByRole {
  param([object]$Manifest, [string]$Role)
  $matches = @(@($Manifest.artifacts) | Where-Object { $_.role -ceq $Role })
  if ($matches.Count -ne 1) { throw "manifest role is not unique: $Role" }
  return $matches[0]
}

function Assert-FileMatchesArtifact {
  param([string]$Path, [object]$Artifact)
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (($item -is [IO.DirectoryInfo]) -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'artifact path is not a regular file' }
  if ([uint64]$item.Length -ne [uint64]$Artifact.size -or (Get-Sha256 $item.FullName) -cne [string]$Artifact.sha256) { throw 'artifact size/SHA-256 mismatch' }
}

function Get-NoFollowNodeKind {
  param([string]$Path)
  return [JhtUpdateFileIdentity]::GetNoFollowNodeKind($Path)
}

function Get-NoFollowCanonicalState {
  param([string]$Path)
  return [JhtUpdateFileIdentity]::GetNoFollowCanonicalState($Path)
}

function Assert-NoReparseAncestors {
  param(
    [string]$Path,
    [string]$ReparseCode = '',
    [string]$InternalCode = '')
  $reparseDetected = $false
  try {
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    if (-not $root) { throw 'protected path root is unavailable' }
    $prefixes = New-Object Collections.Generic.List[string]
    $prefixes.Add([IO.Path]::GetFullPath($root))
    $relative = $full.Substring($root.Length)
    $segments = @($relative.Split(
      [char[]]@([IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar),
      [StringSplitOptions]::RemoveEmptyEntries))
    $prefix = [IO.Path]::GetFullPath($root)
    foreach ($segment in $segments) {
      $prefix = Join-Path $prefix $segment
      $prefixes.Add([IO.Path]::GetFullPath($prefix))
    }
    for ($index = 0; $index -lt $prefixes.Count; $index++) {
      $probePath = $prefixes[$index]
      $terminal = $index -eq ($prefixes.Count - 1)
      $kind = Get-NoFollowNodeKind $probePath
      if ($kind -eq 0) {
        if ($terminal) { return }
        throw 'protected path has a missing intermediate component'
      }
      if ($kind -eq 3) {
        $reparseDetected = $true
        if ($ReparseCode) { $script:FailureCode = $ReparseCode }
        throw 'reparse point in protected path'
      }
      if (-not $terminal -and $kind -ne 2) {
        throw 'protected path intermediate component is not a directory'
      }
      $canonical = Get-NoFollowCanonicalState $probePath
      if ($canonical -eq 2) {
        $reparseDetected = $true
        if ($ReparseCode) { $script:FailureCode = $ReparseCode }
        throw 'redirected component in protected path'
      }
      if ($canonical -ne 1) {
        throw 'protected path canonical census is invalid'
      }
    }
  } catch {
    if (-not $reparseDetected -and $InternalCode) {
      $script:FailureCode = $InternalCode
    }
    throw
  }
}

function Assert-OwnerAndAcl {
  param([string]$Path, [switch]$Directory)
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  $isDirectory = $item -is [IO.DirectoryInfo]
  if ($Directory -and -not $isDirectory) { throw 'protected directory expected' }
  if (-not $Directory -and $isDirectory) { throw 'protected file expected' }
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'protected node is a reparse point' }
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl = $item.GetAccessControl([Security.AccessControl.AccessControlSections]::All)
  $ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -ne $currentSid) { throw 'protected node has a foreign owner' }
  if ($Directory -and -not $acl.AreAccessRulesProtected) { throw 'protected directory inherits its DACL' }
  Assert-NoForeignWriteAcl $Path
}

function Assert-NoForeignWriteAcl {
  param([string]$Path)
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  $acl = $item.GetAccessControl([Security.AccessControl.AccessControlSections]::All)
  foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
    if ($rule.AccessControlType -ne 'Allow') { continue }
    $rights = [Security.AccessControl.FileSystemRights]$rule.FileSystemRights
    $writeMask = [Security.AccessControl.FileSystemRights]::WriteData -bor [Security.AccessControl.FileSystemRights]::AppendData -bor [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor [Security.AccessControl.FileSystemRights]::WriteAttributes -bor [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor [Security.AccessControl.FileSystemRights]::Delete -bor [Security.AccessControl.FileSystemRights]::ChangePermissions -bor [Security.AccessControl.FileSystemRights]::TakeOwnership
    if (($rights -band $writeMask) -eq 0) { continue }
    $sid = $rule.IdentityReference.Value
    if ($sid -notin @($currentSid, 'S-1-5-18', 'S-1-5-32-544')) { throw 'protected node grants write to another principal' }
  }
}

function Assert-ExactCurrentOnlyAcl {
  param([string]$Path, [switch]$Directory)
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  $isDirectory = $item -is [IO.DirectoryInfo]
  if ($Directory -and -not $isDirectory) { throw 'protected directory expected' }
  if (-not $Directory -and $isDirectory) { throw 'protected file expected' }
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'protected node is a reparse point' }
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl = $item.GetAccessControl([Security.AccessControl.AccessControlSections]::All)
  if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $currentSid) { throw 'protected node has a foreign owner' }
  if (-not $acl.AreAccessRulesProtected) { throw 'protected node inherits its DACL' }
  $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 1) { throw 'protected node DACL is not current-only' }
  $rule = $rules[0]
  $expectedInheritance = if ($Directory) { [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit } else { [Security.AccessControl.InheritanceFlags]::None }
  if ($rule.IsInherited -or
      $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
      $rule.IdentityReference.Value -ne $currentSid -or
      [Security.AccessControl.FileSystemRights]$rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl -or
      $rule.InheritanceFlags -ne $expectedInheritance -or
      $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None) {
    throw 'protected node DACL is not current-only'
  }
}

function Assert-CurrentOwner {
  param([string]$Path)
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'protected node is a reparse point' }
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $acl = $item.GetAccessControl([Security.AccessControl.AccessControlSections]::All)
  $ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
  if ($ownerSid -ne $currentSid) { throw 'protected node has a foreign owner' }
}

function Initialize-ProtectedDirectory {
  param(
    [string]$Path,
    [switch]$RequireNew,
    $CreatedByInvocation = $null)
  $trackCreation = $PSBoundParameters.ContainsKey('CreatedByInvocation')
  if ($trackCreation) {
    if ($CreatedByInvocation -isnot [System.Management.Automation.PSReference]) { throw 'creation tracker must be a PSReference' }
    $CreatedByInvocation.Value = $false
  }
  $preexisting = Test-Path -LiteralPath $Path
  if ($RequireNew -and $preexisting) { throw 'protected directory collision' }
  if ($preexisting) {
    Assert-NoReparseAncestors $Path
    $existing = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (($existing -isnot [IO.DirectoryInfo]) -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'protected directory expected' }
    Assert-CurrentOwner $Path
    Assert-NoForeignWriteAcl $Path
  } else {
    New-Item -ItemType Directory -Path $Path -ErrorAction Stop | Out-Null
    if ($trackCreation) { $CreatedByInvocation.Value = $true }
  }
  Assert-NoReparseAncestors $Path
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (($item -isnot [IO.DirectoryInfo]) -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'protected directory expected' }
  $acl = if ($preexisting) { $item.GetAccessControl([Security.AccessControl.AccessControlSections]::All) } else { New-Object Security.AccessControl.DirectorySecurity }
  if (-not $preexisting) { $acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User) }
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  if ($preexisting) { $acl.SetAccessRule($rule) } else { $acl.AddAccessRule($rule) }
  $item.SetAccessControl($acl)
  if ($preexisting) { Assert-OwnerAndAcl $Path -Directory } else { Assert-ExactCurrentOnlyAcl $Path -Directory }
}

function Protect-File {
  param([string]$Path)
  Assert-NoReparseAncestors $Path
  Assert-CurrentOwner $Path
  Assert-NoForeignWriteAcl $Path
  $null = Get-Sha256 $Path
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  $acl = $item.GetAccessControl([Security.AccessControl.AccessControlSections]::All)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'Allow')
  $acl.SetAccessRule($rule)
  $item.SetAccessControl($acl)
  Assert-OwnerAndAcl $Path
}

function Protect-OwnedFile {
  param([string]$Path)
  Assert-NoReparseAncestors $Path
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (($item -isnot [IO.FileInfo]) -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'protected file expected' }
  $acl = New-Object Security.AccessControl.FileSecurity
  $acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'Allow')
  $acl.AddAccessRule($rule)
  $item.SetAccessControl($acl)
  Assert-ExactCurrentOnlyAcl $Path
}

function Get-BytesSha256 {
  param([byte[]]$Bytes)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace('-', '').ToLowerInvariant() } finally { $algorithm.Dispose() }
}

function Assert-AtomicDestinationPreflight {
  param([string]$Path)
  Assert-NoReparseAncestors $Path
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) { return }
  if (($item -isnot [IO.FileInfo]) -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'atomic destination is not a regular file' }
  Assert-CurrentOwner $Path
  Assert-NoForeignWriteAcl $Path
  $null = Get-Sha256 $Path
}

function Remove-ProtectedFileIfPresent {
  param([string]$Path)
  Assert-AtomicDestinationPreflight $Path
  if (Test-Path -LiteralPath $Path -PathType Leaf) { Remove-Item -LiteralPath $Path -Force -ErrorAction Stop }
}

function Assert-AuthorityBackupLeaf {
  param([string]$Path, [string]$ExpectedName)
  if ([JhtUpdateFileIdentity]::GetNoFollowNodeKind($Path) -ne 1) {
    throw 'authority backup leaf is not a regular file'
  }
  Assert-NoReparseAncestors $Path
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (($item -isnot [IO.FileInfo]) -or
      ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      $item.Name -cne $ExpectedName -or
      -not ([IO.Path]::GetFullPath($item.FullName)).Equals(
        [IO.Path]::GetFullPath($Path), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'authority backup leaf is not canonical'
  }
  Assert-CurrentOwner $item.FullName
  Assert-NoForeignWriteAcl $item.FullName
  $null = Get-Sha256 $item.FullName
}

function Test-AuthorityBackupLeafPresent {
  param([string]$Path, [string]$ExpectedName)
  $kind = [JhtUpdateFileIdentity]::GetNoFollowNodeKind($Path)
  if ($kind -eq 0) {
    Assert-NoReparseAncestors $Path
    return $false
  }
  if ($kind -ne 1) { throw 'authority backup leaf is not a regular file' }
  Assert-AuthorityBackupLeaf $Path $ExpectedName
  return $true
}

function Get-AttestedAuthorityBackupRoot {
  param([switch]$Required)
  $rootKind = [JhtUpdateFileIdentity]::GetNoFollowNodeKind($AuthorityBackupDir)
  if ($rootKind -eq 0) {
    Assert-NoReparseAncestors $AuthorityBackupDir
    if ($Required) { throw 'authority backup root disappeared' }
    return $null
  }
  if ($rootKind -ne 2) { throw 'authority backup root is not a directory' }
  Assert-NoReparseAncestors $AuthorityBackupDir
  $root = Get-Item -LiteralPath $AuthorityBackupDir -Force -ErrorAction Stop
  if (($root -isnot [IO.DirectoryInfo]) -or
      ($root.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
      -not ([IO.Path]::GetFullPath($root.FullName)).Equals(
        [IO.Path]::GetFullPath($AuthorityBackupDir),
        [StringComparison]::OrdinalIgnoreCase)) {
    throw 'authority backup root is not canonical'
  }
  Assert-CurrentOwner $root.FullName
  Assert-NoForeignWriteAcl $root.FullName
  return $root
}

function Assert-AuthorityBackupPreflight {
  $root = Get-AttestedAuthorityBackupRoot
  if ($null -eq $root) { return }
  foreach ($child in @(Get-ChildItem -LiteralPath $root.FullName -Force -ErrorAction Stop)) {
    $expectedPath = switch -CaseSensitive ($child.Name) {
      $AllowedHelperName { $OldHelperBackupPath; break }
      'RELEASE-MANIFEST.json' { $OldManifestBackupPath; break }
      'RELEASE-MANIFEST.json.sig' { $OldSignatureBackupPath; break }
      default { throw 'authority backup contains an unexpected node' }
    }
    Assert-AuthorityBackupLeaf $expectedPath $child.Name
  }
}

function Assert-AuthorityBackupRootEmpty {
  $root = Get-AttestedAuthorityBackupRoot -Required
  if (@(Get-ChildItem -LiteralPath $root.FullName -Force -ErrorAction Stop).Count -ne 0) {
    throw 'authority backup root is not empty'
  }
  return $true
}

function Open-AtomicTempStream {
  param([string]$Path)
  return [JhtUpdateFileIdentity]::CreateNewAtomicStream($Path)
}

function Write-AtomicTempContent {
  param([IO.Stream]$Stream, [byte[]]$Bytes = $null, [string]$Source = '')
  if ($PSBoundParameters.ContainsKey('Bytes')) {
    $Stream.Write($Bytes, 0, $Bytes.Length)
    return
  }
  $sourceStream = [IO.File]::Open($Source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try { $sourceStream.CopyTo($Stream) } finally { $sourceStream.Dispose() }
}

function Flush-AtomicTempStream {
  param([IO.Stream]$Stream)
  $Stream.Flush($true)
}

function Protect-OwnedAtomicStream {
  param([IO.FileStream]$Stream, [string]$Path, [string]$ExpectedSha256, [uint64]$ExpectedSize)
  if ([uint64]$Stream.Length -ne $ExpectedSize) { throw 'atomic stream size mismatch' }
  $actual = [JhtUpdateFileIdentity]::HardenAndSha256($Stream, $Path)
  if ($actual -cne $ExpectedSha256) { throw 'atomic stream hash mismatch' }
}

function Promote-AtomicTemp {
  param([string]$Temporary, [string]$Destination, [bool]$DestinationExisted, [string]$Backup = '')
  if ($Backup) { throw 'atomic promotion does not accept an implicit backup' }
  [JhtUpdateFileIdentity]::MoveReplace($Temporary, $Destination, $DestinationExisted)
}

function Assert-ProtectedFileContent {
  param([string]$Path, [string]$ExpectedSha256, [uint64]$ExpectedSize)
  Assert-NoReparseAncestors $Path
  Assert-ExactCurrentOnlyAcl $Path
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  if (($item -isnot [IO.FileInfo]) -or [uint64]$item.Length -ne $ExpectedSize) { throw 'atomic file size mismatch' }
  if ((Get-Sha256 $Path) -cne $ExpectedSha256) { throw 'atomic file hash mismatch' }
}

function New-ProtectedAtomicTemp {
  param(
    [string]$Path,
    [byte[]]$Bytes = $null,
    [string]$Source = '',
    [string]$ExpectedSha256,
    [uint64]$ExpectedSize)
  $stream = Open-AtomicTempStream $Path
  try {
    if ($PSBoundParameters.ContainsKey('Bytes')) { Write-AtomicTempContent $stream -Bytes $Bytes } else { Write-AtomicTempContent $stream -Source $Source }
    Flush-AtomicTempStream $stream
    Protect-OwnedAtomicStream $stream $Path $ExpectedSha256 $ExpectedSize
  } finally { $stream.Dispose() }
  Assert-ProtectedFileContent $Path $ExpectedSha256 $ExpectedSize
}

function Write-ProtectedAtomicFile {
  param(
    [string]$Destination,
    [byte[]]$Bytes = $null,
    [string]$Source = '',
    [string]$ExpectedSha256 = '',
    [string]$ReplacementBackupPath = '',
    [switch]$ConsumeSource)
  $hasBytes = $PSBoundParameters.ContainsKey('Bytes')
  if ($hasBytes -eq [bool]$Source) { throw 'atomic content source is ambiguous' }
  $destinationFull = [IO.Path]::GetFullPath($Destination)
  $parent = [IO.Path]::GetDirectoryName($destinationFull)
  Assert-NoReparseAncestors $parent
  Assert-OwnerAndAcl $parent -Directory
  $destinationExisted = Test-Path -LiteralPath $destinationFull
  Assert-AtomicDestinationPreflight $destinationFull
  $replacementBackupFull = ''
  if ($ReplacementBackupPath) {
    $replacementBackupFull = [IO.Path]::GetFullPath($ReplacementBackupPath)
    if (-not ([IO.Path]::GetDirectoryName($replacementBackupFull)).Equals($parent, [StringComparison]::OrdinalIgnoreCase)) { throw 'atomic replacement backup must share the destination directory' }
    Assert-AtomicDestinationPreflight $replacementBackupFull
    if (Test-Path -LiteralPath $replacementBackupFull) { throw 'atomic replacement backup collision' }
  }
  if ($hasBytes) {
    $expectedHash = Get-BytesSha256 $Bytes
    $expectedSize = [uint64]$Bytes.Length
  } else {
    Assert-NoReparseAncestors $Source
    Assert-CurrentOwner $Source
    Assert-NoForeignWriteAcl $Source
    $expectedHash = if ($ExpectedSha256) { $ExpectedSha256 } else { Get-Sha256 $Source }
    if ((Get-Sha256 $Source) -cne $expectedHash) { throw 'atomic source hash mismatch' }
    $expectedSize = [uint64](Get-Item -LiteralPath $Source -Force -ErrorAction Stop).Length
  }
  $temporary = Join-Path $parent ('.jht-atomic-' + [guid]::NewGuid().ToString('N'))
  $rollback = if ($destinationExisted) { Join-Path $parent ('.jht-atomic-backup-' + [guid]::NewGuid().ToString('N')) } else { '' }
  $rollbackLocation = $rollback
  $originalSecurity = $null
  $originalHash = ''
  $originalSize = [uint64]0
  $promoted = $false
  try {
    if ($destinationExisted) {
      $originalItem = Get-Item -LiteralPath $destinationFull -Force -ErrorAction Stop
      $originalSecurity = $originalItem.GetAccessControl([Security.AccessControl.AccessControlSections]::All)
      $originalHash = Get-Sha256 $destinationFull
      $originalSize = [uint64]$originalItem.Length
      New-ProtectedAtomicTemp -Path $rollback -Source $destinationFull -ExpectedSha256 $originalHash -ExpectedSize $originalSize
      Assert-AtomicDestinationPreflight $destinationFull
      if ((Get-Sha256 $destinationFull) -cne $originalHash) { throw 'atomic destination changed during backup' }
    }
    if ($hasBytes) {
      New-ProtectedAtomicTemp -Path $temporary -Bytes $Bytes -ExpectedSha256 $expectedHash -ExpectedSize $expectedSize
    } else {
      New-ProtectedAtomicTemp -Path $temporary -Source $Source -ExpectedSha256 $expectedHash -ExpectedSize $expectedSize
    }
    Promote-AtomicTemp $temporary $destinationFull $destinationExisted
    $promoted = $true
    Assert-ProtectedFileContent $destinationFull $expectedHash $expectedSize
    if ($replacementBackupFull) {
      Promote-AtomicTemp $rollback $replacementBackupFull $false
      $rollbackLocation = $replacementBackupFull
      Assert-ProtectedFileContent $replacementBackupFull $originalHash $originalSize
    } elseif ($rollback -and (Test-Path -LiteralPath $rollback)) {
      Remove-Item -LiteralPath $rollback -Force -ErrorAction Stop
      $rollbackLocation = ''
    }
    if ($ConsumeSource -and (Test-Path -LiteralPath $Source)) { Remove-Item -LiteralPath $Source -Force -ErrorAction Stop }
  } catch {
    if ($promoted) {
      if ($destinationExisted -and $rollbackLocation -and (Test-Path -LiteralPath $rollbackLocation -PathType Leaf)) {
        Promote-AtomicTemp $rollbackLocation $destinationFull $true
        $rollbackLocation = ''
        if ($null -ne $originalSecurity) {
          $restored = Get-Item -LiteralPath $destinationFull -Force -ErrorAction Stop
          $restored.SetAccessControl($originalSecurity)
        }
        Assert-AtomicDestinationPreflight $destinationFull
        if ((Get-Sha256 $destinationFull) -cne $originalHash) { throw 'atomic rollback content mismatch' }
      } elseif (-not $destinationExisted -and (Test-Path -LiteralPath $destinationFull -PathType Leaf)) {
        Remove-Item -LiteralPath $destinationFull -Force -ErrorAction Stop
      }
    }
    throw
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction Stop }
    if ($rollback -and (Test-Path -LiteralPath $rollback)) { Remove-Item -LiteralPath $rollback -Force -ErrorAction Stop }
  }
}

function Write-AtomicJson {
  param([string]$Path, [hashtable]$Value)
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Compress -Depth 8) + "`n")
  Write-ProtectedAtomicFile -Destination $Path -Bytes $bytes
}

function Read-JsonFile {
  param([string]$Path)
  try { return Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
}

function Read-ProtectedJsonFile {
  param([string]$Path, [switch]$ExactCurrentOnly)
  Assert-NoReparseAncestors $Path
  Assert-CurrentOwner $Path
  Assert-NoForeignWriteAcl $Path
  $null = Get-Sha256 $Path
  if ($ExactCurrentOnly) { Assert-ExactCurrentOnlyAcl $Path }
  return Read-JsonFile $Path
}

function Read-Result {
  if (-not (Test-Path -LiteralPath $ResultPath -PathType Leaf)) { return $null }
  $result = Read-ProtectedJsonFile $ResultPath -ExactCurrentOnly
  if (-not $result -or -not (Test-ExactProperties $result @('code','nonce','ok','phase','rolled_back','schema')) -or
      -not (Test-JsonInteger $result.schema) -or [int64]$result.schema -ne 1 -or
      [string]$result.nonce -cne $Nonce) { return $null }
  return $result
}

function Read-Floor {
  if (-not (Test-Path -LiteralPath $FloorPath)) { return $null }
  $floor = Read-ProtectedJsonFile $FloorPath -ExactCurrentOnly
  if (-not (Test-ExactProperties $floor @('schema','sequence','version')) -or -not (Test-JsonInteger $floor.schema) -or [int64]$floor.schema -ne 1 -or -not (Test-JsonInteger $floor.sequence) -or [uint64]$floor.sequence -ne (Get-VersionSequence ([string]$floor.version))) { throw 'committed update floor is corrupt' }
  return $floor
}

function Write-Result {
  param([bool]$Ok, [string]$Phase, [string]$Code, [bool]$RolledBack = $false)
  $script:FailurePhase = 'result'
  $script:FailureCode = 'result_write_failed'
  Write-AtomicJson $ResultPath @{ schema = 1; ok = $Ok; phase = $Phase; code = $Code; nonce = $Nonce; rolled_back = $RolledBack }
}

function Write-FailureResultOrStderr {
  param([string]$Phase, [string]$Code)
  try {
    Write-Result $false $Phase $Code
    return $true
  } catch {
    [Console]::Error.WriteLine(
      'JHT-WINDOWS-UPDATE-ERROR schema=1 phase=result code=result_write_failed')
    return $false
  }
}

function Get-ExactProcess {
  param([int]$ProcessId, [string]$StartedTicks, [string]$Executable = '')
  if ($ProcessId -le 0 -or $StartedTicks -notmatch '^[0-9]{10,20}$') { return $null }
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    if ($process.StartTime.ToUniversalTime().Ticks.ToString() -cne $StartedTicks) { return $null }
    if ($Executable) {
      $actual = [IO.Path]::GetFullPath($process.MainModule.FileName)
      if (-not $actual.Equals([IO.Path]::GetFullPath($Executable), [StringComparison]::OrdinalIgnoreCase)) { return $null }
    }
    return $process
  } catch { return $null }
}

function Get-ObservedProcess {
  param([int]$ProcessId, [string]$Executable, [string]$ExpectedStartedTicks = '')
  if ($ProcessId -le 0) { return $null }
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    $started = $process.StartTime.ToUniversalTime().Ticks.ToString()
    $actual = [IO.Path]::GetFullPath($process.MainModule.FileName)
    if (-not $actual.Equals([IO.Path]::GetFullPath($Executable), [StringComparison]::OrdinalIgnoreCase)) { return $null }
    if ($ExpectedStartedTicks -and $started -cne $ExpectedStartedTicks) { return $null }
    return @{ Process = $process; Started = $started }
  } catch { return $null }
}

function Acquire-Lock {
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    $claim = Join-Path $StateRoot ('.update-claim-' + [guid]::NewGuid().ToString('N'))
    $claimCreated = $false
    try {
      $script:FailureCode = 'lock_claim_init'
      Initialize-ProtectedDirectory $claim -RequireNew -CreatedByInvocation ([ref]$claimCreated)
      $script:FailureCode = 'lock_claim_write'
      $claimOwnerPath = Join-Path $claim 'owner.json'
      Write-AtomicJson $claimOwnerPath @{ schema = 1; nonce = $Nonce; pid = $PID; started = $script:LockOwnerStarted }
      Assert-ExactCurrentOnlyAcl $claimOwnerPath
      $script:FailureCode = 'lock_claim_promote'
      try {
        [IO.Directory]::Move($claim, $LockPath)
        $claimCreated = $false
        return
      } catch {
        if ($claimCreated -and (Test-Path -LiteralPath $claim)) { Remove-Item -LiteralPath $claim -Recurse -Force -ErrorAction Stop }
        $claimCreated = $false
        if (-not (Test-Path -LiteralPath $LockPath -PathType Container)) { continue }
        $script:FailureCode = 'lock_existing_validate'
        Assert-NoReparseAncestors $LockPath
        Assert-OwnerAndAcl $LockPath -Directory
        $lockOwnerPath = Join-Path $LockPath 'owner.json'
        Assert-ExactCurrentOnlyAcl $lockOwnerPath
        $owner = Read-JsonFile $lockOwnerPath
        if ($owner -and (Test-ExactProperties $owner @('nonce','pid','schema','started')) -and (Test-JsonInteger $owner.schema) -and [int64]$owner.schema -eq 1) {
          $active = Get-ExactProcess ([int]$owner.pid) ([string]$owner.started)
          if ($active) { throw 'another Windows update transaction is active' }
        }
        $stale = Join-Path $StateRoot ('.update-stale-' + [guid]::NewGuid().ToString('N'))
        $script:FailureCode = 'lock_stale_promote'
        try { [IO.Directory]::Move($LockPath, $stale) } catch { continue }
        $script:FailureCode = 'lock_stale_remove'
        Remove-Item -LiteralPath $stale -Recurse -Force -ErrorAction Stop
      }
    } catch {
      if ($claimCreated -and (Test-Path -LiteralPath $claim)) { Remove-Item -LiteralPath $claim -Recurse -Force -ErrorAction Stop }
      throw
    }
  }
  $script:FailureCode = 'lock_exhausted'
  throw 'unable to acquire the Windows update transaction lock'
}

function Assert-SafeLocationPlan {
  $script:FailureCode = 'location_resolve'
  $target = [IO.Path]::GetFullPath($TargetPath)
  $targetDir = [IO.Path]::GetDirectoryName($target)
  $state = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\','/')
  $transaction = [IO.Path]::GetFullPath($TxnDir)
  $legacy = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.jht')).TrimEnd('\','/')
  $documents = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\Job Hunter Team')).TrimEnd('\','/')
  $script:FailureCode = 'location_forbidden_root'
  foreach ($path in @($targetDir, $state)) {
    foreach ($forbidden in @($legacy, $documents)) {
      if ($path.Equals($forbidden, [StringComparison]::OrdinalIgnoreCase) -or $path.StartsWith($forbidden + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'update authority is inside a container-writable path' }
    }
  }
  $script:FailureCode = 'location_fixed_binding'
  $fixed = @(
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($CandidatePath); Expected = Join-Path $targetDir ('.jht-update-' + $Nonce + '.candidate.exe') },
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($CandidateHelperPath); Expected = Join-Path $transaction $AllowedHelperName },
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($CandidateManifestPath); Expected = Join-Path $transaction 'RELEASE-MANIFEST.json' },
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($CandidateSignaturePath); Expected = Join-Path $transaction 'RELEASE-MANIFEST.json.sig' },
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($InstalledManifestPath); Expected = Join-Path $targetDir 'RELEASE-MANIFEST.json' },
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($InstalledSignaturePath); Expected = Join-Path $targetDir 'RELEASE-MANIFEST.json.sig' },
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($PSCommandPath); Expected = Join-Path $targetDir $AllowedHelperName }
  )
  foreach ($pair in $fixed) { if (-not $pair.Actual.Equals([IO.Path]::GetFullPath($pair.Expected), [StringComparison]::OrdinalIgnoreCase)) { throw 'update path does not match its fixed protected location' } }
  foreach ($path in @($targetDir, $StateRoot, $TxnDir, $TargetPath, $CandidateHelperPath, $InstalledManifestPath, $InstalledSignaturePath, $CandidateManifestPath, $CandidateSignaturePath, $PSCommandPath)) {
    Assert-NoReparseAncestors $path `
      -ReparseCode 'location_node_reparse' `
      -InternalCode 'location_node_internal'
    if (Test-Path -LiteralPath $path) {
      $script:FailureCode = 'location_node_owner'
      Assert-CurrentOwner $path
    }
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $script:FailureCode = 'location_node_read'
      $null = Get-Sha256 $path
    }
  }
  $script:FailureCode = 'location_state_acl'
  foreach ($directory in @($StateRoot, $TxnDir)) { Assert-NoForeignWriteAcl $directory }
  if (Test-Path -LiteralPath $CandidatePath -PathType Leaf) {
    Assert-NoReparseAncestors $CandidatePath `
      -ReparseCode 'location_candidate_reparse' `
      -InternalCode 'location_candidate_internal'
    $script:FailureCode = 'location_candidate_owner'; Assert-CurrentOwner $CandidatePath
    $script:FailureCode = 'location_candidate_read'; $null = Get-Sha256 $CandidatePath
  }
  $authorityBackupKind =
    [JhtUpdateFileIdentity]::GetNoFollowNodeKind($AuthorityBackupDir)
  if ($authorityBackupKind -ne 0) {
    Assert-NoReparseAncestors $AuthorityBackupDir `
      -ReparseCode 'location_backup_reparse' `
      -InternalCode 'location_backup_internal'
    if ($authorityBackupKind -ne 2) {
      $script:FailureCode = 'location_backup_internal'
      throw 'authority backup root is not a directory'
    }
    $script:FailureCode = 'location_backup_owner'
    Assert-CurrentOwner $AuthorityBackupDir
    foreach ($path in @($OldHelperBackupPath, $OldManifestBackupPath, $OldSignatureBackupPath)) {
      $authorityLeafKind = [JhtUpdateFileIdentity]::GetNoFollowNodeKind($path)
      if ($authorityLeafKind -ne 0) {
        Assert-NoReparseAncestors $path `
          -ReparseCode 'location_backup_child_reparse' `
          -InternalCode 'location_backup_child_internal'
        if ($authorityLeafKind -ne 1) {
          $script:FailureCode = 'location_backup_child_internal'
          throw 'authority backup child is not a regular file'
        }
        $script:FailureCode = 'location_backup_child_owner'
        Assert-CurrentOwner $path
      }
    }
  }
  $script:FailureCode = 'location_target_acl'
  Assert-OwnerAndAcl $targetDir -Directory
}

function Release-Lock {
  if (-not (Test-Path -LiteralPath $LockPath -PathType Container)) { return }
  $owner = Read-JsonFile (Join-Path $LockPath 'owner.json')
  if ($owner -and [int]$owner.pid -eq $PID -and $owner.started -ceq $script:LockOwnerStarted -and $owner.nonce -ceq $Nonce) {
    Remove-Item -LiteralPath $LockPath -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Assert-Paths {
  $target = [IO.Path]::GetFullPath($TargetPath)
  $candidate = [IO.Path]::GetFullPath($CandidatePath)
  $targetDir = [IO.Path]::GetDirectoryName($target)
  $state = [IO.Path]::GetFullPath($StateRoot).TrimEnd('\','/')
  $transaction = [IO.Path]::GetFullPath($TxnDir)
  $expected = @{
    CandidatePath = Join-Path $targetDir ('.jht-update-' + $Nonce + '.candidate.exe')
    CandidateHelperPath = Join-Path $transaction $AllowedHelperName
    CandidateManifestPath = Join-Path $transaction 'RELEASE-MANIFEST.json'
    CandidateSignaturePath = Join-Path $transaction 'RELEASE-MANIFEST.json.sig'
    InstalledManifestPath = Join-Path $targetDir 'RELEASE-MANIFEST.json'
    InstalledSignaturePath = Join-Path $targetDir 'RELEASE-MANIFEST.json.sig'
    HelperPath = Join-Path $targetDir $AllowedHelperName
  }
  foreach ($pair in @(
    [pscustomobject]@{ Actual = $candidate; Expected = $expected.CandidatePath },
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($CandidateHelperPath); Expected = $expected.CandidateHelperPath },
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($CandidateManifestPath); Expected = $expected.CandidateManifestPath },
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($CandidateSignaturePath); Expected = $expected.CandidateSignaturePath },
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($InstalledManifestPath); Expected = $expected.InstalledManifestPath },
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($InstalledSignaturePath); Expected = $expected.InstalledSignaturePath },
    [pscustomobject]@{ Actual = [IO.Path]::GetFullPath($PSCommandPath); Expected = $expected.HelperPath }
  )) { if (-not $pair.Actual.Equals([IO.Path]::GetFullPath($pair.Expected), [StringComparison]::OrdinalIgnoreCase)) { throw 'update path does not match its fixed protected location' } }
  $legacy = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE '.jht')).TrimEnd('\','/')
  $documents = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE 'Documents\Job Hunter Team')).TrimEnd('\','/')
  foreach ($path in @($targetDir, $state)) {
    foreach ($forbidden in @($legacy, $documents)) {
      if ($path.Equals($forbidden, [StringComparison]::OrdinalIgnoreCase) -or $path.StartsWith($forbidden + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'update authority is inside a container-writable path' }
    }
  }
  foreach ($path in @($target, $candidate, $CandidateHelperPath, $InstalledManifestPath, $InstalledSignaturePath, $CandidateManifestPath, $CandidateSignaturePath, $StateRoot, $TxnDir, $PSCommandPath, $AuthorityBackupDir)) { Assert-NoReparseAncestors $path }
  Assert-OwnerAndAcl $targetDir -Directory
  Assert-OwnerAndAcl $StateRoot -Directory
  Assert-OwnerAndAcl $TxnDir -Directory
  foreach ($path in @($target, $CandidateHelperPath, $InstalledManifestPath, $InstalledSignaturePath, $CandidateManifestPath, $CandidateSignaturePath, $PSCommandPath)) { Assert-OwnerAndAcl $path }
  if (Test-Path -LiteralPath $candidate) { Assert-OwnerAndAcl $candidate }
}

function Initialize-StagingProtection {
  foreach ($path in @($CandidateHelperPath, $CandidateManifestPath, $CandidateSignaturePath)) { Protect-File $path }
  if (Test-Path -LiteralPath $CandidatePath -PathType Leaf) { Protect-File $CandidatePath }
}

function Assert-PreMutationTrust {
  $candidate = Read-VerifiedManifest $CandidateManifestPath $CandidateSignaturePath
  Assert-FileMatchesArtifact $CandidateHelperPath (Get-ArtifactByRole $candidate.Value $HelperRole)
  if ($Mode -ne 'Recover') { Assert-FileMatchesArtifact $CandidatePath (Get-ArtifactByRole $candidate.Value $DesktopRole) }
  if ($Mode -eq 'Recover') {
    $floor = Read-Floor
    $active = $null
    try { $active = Read-VerifiedManifest $InstalledManifestPath $InstalledSignaturePath } catch { }
    $candidateDesktop = Get-ArtifactByRole $candidate.Value $DesktopRole
    $candidateHelper = Get-ArtifactByRole $candidate.Value $HelperRole
    if ($floor -and [uint64]$floor.sequence -ge [uint64]$candidate.Value.sequence -and $active -and $active.Sha256 -ceq $candidate.Sha256 -and (Get-Sha256 $TargetPath) -ceq [string]$candidateDesktop.sha256 -and (Get-Sha256 $PSCommandPath) -ceq [string]$candidateHelper.sha256) { return }
  }
  $oldManifestPresent = $Mode -eq 'Recover' -and `
    (Test-AuthorityBackupLeafPresent $OldManifestBackupPath 'RELEASE-MANIFEST.json')
  $oldSignaturePresent = $Mode -eq 'Recover' -and `
    (Test-AuthorityBackupLeafPresent $OldSignatureBackupPath 'RELEASE-MANIFEST.json.sig')
  $oldManifest = if ($oldManifestPresent) { $OldManifestBackupPath } else { $InstalledManifestPath }
  $oldSignature = if ($oldSignaturePresent) { $OldSignatureBackupPath } else { $InstalledSignaturePath }
  $installed = Read-VerifiedManifest $oldManifest $oldSignature
  # Recovery può usare lo snapshot per autenticare la release old, ma deve
  # attestare SEMPRE i byte del helper che PowerShell sta eseguendo. Mai
  # sostituire questa verifica con quella della copia staged/backup.
  Assert-FileMatchesArtifact $PSCommandPath (Get-ArtifactByRole $installed.Value $HelperRole)
  if ($Mode -ne 'Recover') {
    Assert-FileMatchesArtifact $TargetPath (Get-ArtifactByRole $installed.Value $DesktopRole)
    if ((Compare-Version ([string]$installed.Value.version) $BaselineVersion) -lt 0) { throw 'v0.3.5 to v0.3.6 is manual-only' }
    if ((Compare-Version ([string]$candidate.Value.version) ([string]$installed.Value.version)) -le 0 -or
        [uint64]$candidate.Value.sequence -le [uint64]$installed.Value.sequence) {
      throw 'candidate is not strictly forward'
    }
  }
}

function Get-FreshBundle {
  $script:FailurePhase = 'bundle'
  $script:FailureCode = 'bundle_installed_read_failed'
  $installed = Read-VerifiedManifest $InstalledManifestPath $InstalledSignaturePath
  $script:FailureCode = 'bundle_candidate_read_failed'
  $candidate = Read-VerifiedManifest $CandidateManifestPath $CandidateSignaturePath
  $script:FailureCode = 'bundle_version_failed'
  if ((Compare-Version ([string]$installed.Value.version) $BaselineVersion) -lt 0) { throw 'v0.3.5 to v0.3.6 is manual-only' }
  if ((Compare-Version ([string]$candidate.Value.version) ([string]$installed.Value.version)) -le 0 -or [uint64]$candidate.Value.sequence -le [uint64]$installed.Value.sequence) { throw 'candidate is not strictly forward' }
  $script:FailurePhase = 'floor'
  $script:FailureCode = 'floor_read_failed'
  $floor = Read-Floor
  if (-not $floor) {
    $script:FailureCode = 'floor_init_failed'
    Write-AtomicJson $FloorPath @{ schema = 1; sequence = [uint64]$installed.Value.sequence; version = [string]$installed.Value.version }
    $script:FailureCode = 'floor_init_postflight_failed'
    $floor = Read-Floor
  }
  $script:FailurePhase = 'bundle'
  $script:FailureCode = 'bundle_artifact_validation_failed'
  if ([uint64]$candidate.Value.sequence -le [uint64]$floor.sequence -or (Compare-Version ([string]$candidate.Value.version) ([string]$floor.version)) -le 0) { throw 'candidate is a replay or downgrade' }
  if ([uint64]$installed.Value.sequence -lt [uint64]$floor.sequence) { throw 'installed version is below committed floor' }
  $old = Get-ArtifactByRole $installed.Value $DesktopRole
  $oldHelper = Get-ArtifactByRole $installed.Value $HelperRole
  $new = Get-ArtifactByRole $candidate.Value $DesktopRole
  $newHelper = Get-ArtifactByRole $candidate.Value $HelperRole
  if ($old.sha256 -ceq $new.sha256) { throw 'candidate desktop bytes equal the installed release' }
  Assert-FileMatchesArtifact $TargetPath $old
  Assert-FileMatchesArtifact $PSCommandPath $oldHelper
  Assert-FileMatchesArtifact $CandidatePath $new
  Assert-FileMatchesArtifact $CandidateHelperPath $newHelper
  return @{
    Installed = $installed; Candidate = $candidate; Old = $old; OldHelper = $oldHelper; New = $new; NewHelper = $newHelper
    OldSignatureSha256 = Get-Sha256 $InstalledSignaturePath
    CandidateSignatureSha256 = Get-Sha256 $CandidateSignaturePath
  }
}

function Get-RecoveryBundle {
  $script:FailurePhase = 'recovery'
  $script:FailureCode = 'recovery_candidate_read_failed'
  $candidate = Read-VerifiedManifest $CandidateManifestPath $CandidateSignaturePath
  $script:FailureCode = 'recovery_installed_read_failed'
  $oldManifest = if (Test-AuthorityBackupLeafPresent $OldManifestBackupPath 'RELEASE-MANIFEST.json') { $OldManifestBackupPath } else { $InstalledManifestPath }
  $oldSignature = if (Test-AuthorityBackupLeafPresent $OldSignatureBackupPath 'RELEASE-MANIFEST.json.sig') { $OldSignatureBackupPath } else { $InstalledSignaturePath }
  $installed = Read-VerifiedManifest $oldManifest $oldSignature
  $old = Get-ArtifactByRole $installed.Value $DesktopRole
  $oldHelper = Get-ArtifactByRole $installed.Value $HelperRole
  $new = Get-ArtifactByRole $candidate.Value $DesktopRole
  $newHelper = Get-ArtifactByRole $candidate.Value $HelperRole
  Assert-FileMatchesArtifact $CandidateHelperPath $newHelper
  if (Test-AuthorityBackupLeafPresent $OldHelperBackupPath $AllowedHelperName) {
    Assert-FileMatchesArtifact $OldHelperBackupPath $oldHelper
  }
  return @{
    Installed = $installed; Candidate = $candidate; Old = $old; OldHelper = $oldHelper; New = $new; NewHelper = $newHelper
    OldSignatureSha256 = Get-Sha256 $oldSignature
    CandidateSignatureSha256 = Get-Sha256 $CandidateSignaturePath
  }
}

function Get-JournalWriteCode {
  param([string]$State)
  switch -CaseSensitive ($State) {
    'prepared' { return 'journal_prepared_write_failed' }
    'swap_intent' { return 'journal_swap_intent_write_failed' }
    'candidate_installed' { return 'journal_candidate_installed_write_failed' }
    'health_acked' { return 'journal_health_acked_write_failed' }
    'authority_intent' { return 'journal_authority_intent_write_failed' }
    'metadata_installed' { return 'journal_metadata_installed_write_failed' }
    'floor_intent' { return 'journal_floor_intent_write_failed' }
    'helper_intent' { return 'journal_helper_intent_write_failed' }
    'committed' { return 'journal_committed_write_failed' }
    'rolled_back' { return 'journal_rolled_back_write_failed' }
    default { throw 'unknown journal transition' }
  }
}

function Write-Journal {
  param([string]$State, [hashtable]$Bundle, [int]$CandidatePid = 0, [string]$CandidateStarted = '')
  $script:FailurePhase = 'journal'
  $script:FailureCode = Get-JournalWriteCode $State
  Write-AtomicJson $JournalPath @{
    schema = 1; nonce = $Nonce; state = $State
    installed_version = [string]$Bundle.Installed.Value.version; installed_sequence = [uint64]$Bundle.Installed.Value.sequence
    target_version = [string]$Bundle.Candidate.Value.version; target_sequence = [uint64]$Bundle.Candidate.Value.sequence
    old_sha256 = [string]$Bundle.Old.sha256; old_helper_sha256 = [string]$Bundle.OldHelper.sha256
    old_manifest_sha256 = [string]$Bundle.Installed.Sha256; old_signature_sha256 = [string]$Bundle.OldSignatureSha256
    candidate_sha256 = [string]$Bundle.New.sha256; candidate_helper_sha256 = [string]$Bundle.NewHelper.sha256
    candidate_manifest_sha256 = [string]$Bundle.Candidate.Sha256; candidate_signature_sha256 = [string]$Bundle.CandidateSignatureSha256
    candidate_pid = $CandidatePid; candidate_started = $CandidateStarted
  }
}

function Update-JournalState {
  param([object]$Journal, [string]$State, [int]$CandidatePid = 0, [string]$CandidateStarted = '')
  $script:FailurePhase = 'journal'
  $script:FailureCode = Get-JournalWriteCode $State
  $value = @{}
  foreach ($property in $Journal.PSObject.Properties) { $value[$property.Name] = $property.Value }
  $value['state'] = $State
  $value['candidate_pid'] = $CandidatePid
  $value['candidate_started'] = $CandidateStarted
  Write-AtomicJson $JournalPath $value
}

function Assert-Journal {
  param([object]$Journal, [hashtable]$Bundle)
  $keys = @('candidate_helper_sha256','candidate_manifest_sha256','candidate_pid','candidate_sha256','candidate_signature_sha256','candidate_started','installed_sequence','installed_version','nonce','old_helper_sha256','old_manifest_sha256','old_sha256','old_signature_sha256','schema','state','target_sequence','target_version')
  if (-not (Test-ExactProperties $Journal $keys) -or -not (Test-JsonInteger $Journal.schema) -or [int64]$Journal.schema -ne 1 -or $Journal.nonce -cne $Nonce) { throw 'update journal is corrupt' }
  if (@('prepared','swap_intent','candidate_installed','health_acked','authority_intent','metadata_installed','floor_intent','helper_intent','committed','rolled_back') -cnotcontains [string]$Journal.state) { throw 'update journal state is invalid' }
  $expected = @{
    installed_version = [string]$Bundle.Installed.Value.version; installed_sequence = [uint64]$Bundle.Installed.Value.sequence
    target_version = [string]$Bundle.Candidate.Value.version; target_sequence = [uint64]$Bundle.Candidate.Value.sequence
    old_sha256 = [string]$Bundle.Old.sha256; old_helper_sha256 = [string]$Bundle.OldHelper.sha256
    old_manifest_sha256 = [string]$Bundle.Installed.Sha256; old_signature_sha256 = [string]$Bundle.OldSignatureSha256
    candidate_sha256 = [string]$Bundle.New.sha256; candidate_helper_sha256 = [string]$Bundle.NewHelper.sha256
    candidate_manifest_sha256 = [string]$Bundle.Candidate.Sha256; candidate_signature_sha256 = [string]$Bundle.CandidateSignatureSha256
  }
  foreach ($key in $expected.Keys) { if ([string]$Journal.$key -cne [string]$expected[$key]) { throw 'update journal identity mismatch' } }
}

function Copy-AtomicVerified {
  param([string]$Source, [string]$Destination, [string]$ExpectedSha256)
  Write-ProtectedAtomicFile -Destination $Destination -Source $Source -ExpectedSha256 $ExpectedSha256
}

function Stop-JournalCandidate {
  param([object]$Journal)
  $process = Get-ExactProcess ([int]$Journal.candidate_pid) ([string]$Journal.candidate_started) $TargetPath
  if (-not $process) { return }
  try { $null = $process.CloseMainWindow(); if ($process.WaitForExit(5000)) { return } } catch { }
  try { $process.Kill(); $null = $process.WaitForExit(5000) } catch { }
}

function Backup-OldAuthority {
  param([hashtable]$Bundle)
  $script:FailurePhase = 'authority'
  $script:FailureCode = 'authority_backup_init_failed'
  Initialize-ProtectedDirectory $AuthorityBackupDir
  $script:FailureCode = 'authority_backup_helper_failed'
  Copy-AtomicVerified $PSCommandPath $OldHelperBackupPath ([string]$Bundle.OldHelper.sha256)
  $script:FailureCode = 'authority_backup_manifest_failed'
  Copy-AtomicVerified $InstalledManifestPath $OldManifestBackupPath ([string]$Bundle.Installed.Sha256)
  $script:FailureCode = 'authority_backup_signature_failed'
  Copy-AtomicVerified $InstalledSignaturePath $OldSignatureBackupPath ([string]$Bundle.OldSignatureSha256)
}

function Restore-OldAuthority {
  param([hashtable]$Bundle)
  $script:FailurePhase = 'recovery'
  $script:FailureCode = 'recovery_authority_validate_failed'
  foreach ($leaf in @(
      [pscustomobject]@{ Path = $OldHelperBackupPath; Name = $AllowedHelperName },
      [pscustomobject]@{ Path = $OldManifestBackupPath; Name = 'RELEASE-MANIFEST.json' },
      [pscustomobject]@{ Path = $OldSignatureBackupPath; Name = 'RELEASE-MANIFEST.json.sig' })) {
    if (-not (Test-AuthorityBackupLeafPresent $leaf.Path $leaf.Name)) {
      throw 'verified authority rollback snapshot is unavailable'
    }
  }
  $script:FailureCode = 'recovery_authority_helper_failed'
  Copy-AtomicVerified $OldHelperBackupPath $PSCommandPath ([string]$Bundle.OldHelper.sha256)
  $script:FailureCode = 'recovery_authority_manifest_failed'
  Copy-AtomicVerified $OldManifestBackupPath $InstalledManifestPath ([string]$Bundle.Installed.Sha256)
  $script:FailureCode = 'recovery_authority_signature_failed'
  Copy-AtomicVerified $OldSignatureBackupPath $InstalledSignaturePath ([string]$Bundle.OldSignatureSha256)
  $restored = Read-VerifiedManifest $InstalledManifestPath $InstalledSignaturePath
  Assert-FileMatchesArtifact $PSCommandPath (Get-ArtifactByRole $restored.Value $HelperRole)
}

function Test-OldAuthorityInstalled {
  param([hashtable]$Bundle)
  try {
    $installed = Read-VerifiedManifest $InstalledManifestPath $InstalledSignaturePath
    return $installed.Sha256 -ceq [string]$Bundle.Installed.Sha256 -and (Get-Sha256 $PSCommandPath) -ceq [string]$Bundle.OldHelper.sha256
  } catch { return $false }
}

function Install-CandidateMetadata {
  param([hashtable]$Bundle)
  $script:FailurePhase = 'metadata'
  $script:FailureCode = 'metadata_manifest_install_failed'
  Copy-AtomicVerified $CandidateManifestPath $InstalledManifestPath ([string]$Bundle.Candidate.Sha256)
  $script:FailureCode = 'metadata_signature_install_failed'
  Copy-AtomicVerified $CandidateSignaturePath $InstalledSignaturePath ([string]$Bundle.CandidateSignatureSha256)
  $script:FailureCode = 'metadata_postflight_failed'
  $installed = Read-VerifiedManifest $InstalledManifestPath $InstalledSignaturePath
  if ($installed.Sha256 -cne [string]$Bundle.Candidate.Sha256) { throw 'candidate authority metadata mismatch' }
}

function Install-CandidateHelper {
  param([hashtable]$Bundle)
  $script:FailurePhase = 'helper'
  $script:FailureCode = 'helper_install_failed'
  Copy-AtomicVerified $CandidateHelperPath $PSCommandPath ([string]$Bundle.NewHelper.sha256)
  $script:FailureCode = 'helper_postflight_failed'
  $installed = Read-VerifiedManifest $InstalledManifestPath $InstalledSignaturePath
  Assert-FileMatchesArtifact $PSCommandPath (Get-ArtifactByRole $installed.Value $HelperRole)
}

function Restore-OldTarget {
  param([hashtable]$Bundle, [object]$Journal)
  $script:FailurePhase = 'recovery'
  $script:FailureCode = 'recovery_process_stop_failed'
  Stop-JournalCandidate $Journal
  $script:FailureCode = 'recovery_target_validate_failed'
  if ((Get-Sha256 $TargetPath) -ceq [string]$Bundle.Old.sha256) { return }
  if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf) -or (Get-Sha256 $BackupPath) -cne [string]$Bundle.Old.sha256) { throw 'verified rollback snapshot is unavailable' }
  $script:FailureCode = 'recovery_failed_cleanup_failed'
  Remove-ProtectedFileIfPresent $FailedPath
  $script:FailureCode = 'recovery_target_restore_failed'
  Write-ProtectedAtomicFile -Destination $TargetPath -Source $BackupPath `
    -ExpectedSha256 ([string]$Bundle.Old.sha256) `
    -ReplacementBackupPath $FailedPath -ConsumeSource
}

function Invoke-Rollback {
  param([hashtable]$Bundle, [object]$Journal, [string]$Code)
  $script:FailurePhase = 'recovery'
  $script:FailureCode = 'recovery_rollback_target_failed'
  Restore-OldTarget $Bundle $Journal
  $script:FailureCode = 'recovery_rollback_authority_failed'
  if (-not (Test-OldAuthorityInstalled $Bundle)) { Restore-OldAuthority $Bundle }
  $script:FailureCode = 'recovery_rollback_journal_failed'
  Write-Journal 'rolled_back' $Bundle
  $script:FailurePhase = 'recovery'
  $script:FailureCode = 'recovery_restart_failed'
  Start-Process -FilePath ([IO.Path]::GetFullPath($TargetPath)) | Out-Null
  Write-Result $false 'rollback' $Code $true
}

function Test-CandidateHealth {
  param([hashtable]$Bundle, [Diagnostics.Process]$Process, [string]$Started)
  try { $health = Read-ProtectedJsonFile $HealthPath -ExactCurrentOnly } catch { return $false }
  if (-not $health -or -not (Test-ExactProperties $health @('exe_path','exe_sha256','nonce','pid','process_started_utc_ticks','schema','type','version'))) { return $false }
  return (Test-JsonInteger $health.schema) -and [int64]$health.schema -eq 1 -and (Test-JsonInteger $health.pid) -and [int]$health.pid -eq $Process.Id -and $health.process_started_utc_ticks -ceq $Started -and $health.type -ceq 'healthy' -and $health.nonce -ceq $Nonce -and $health.version -ceq [string]$Bundle.Candidate.Value.version -and $health.exe_sha256 -ceq [string]$Bundle.New.sha256 -and ([IO.Path]::GetFullPath([string]$health.exe_path)).Equals([IO.Path]::GetFullPath($TargetPath), [StringComparison]::OrdinalIgnoreCase)
}

function Initialize-HealthCapability {
  Write-ProtectedAtomicFile -Destination $HealthPath -Bytes ([byte[]]@())
  Assert-ProtectedFileContent $HealthPath (Get-BytesSha256 ([byte[]]@())) 0
}

function Update-JournalProcess {
  param([object]$Journal, [int]$ProcessId, [string]$Started)
  $script:FailurePhase = 'journal'
  $script:FailureCode = 'journal_process_write_failed'
  $value = @{}
  foreach ($property in $Journal.PSObject.Properties) { $value[$property.Name] = $property.Value }
  $value['candidate_pid'] = $ProcessId
  $value['candidate_started'] = $Started
  Write-AtomicJson $JournalPath $value
}

function Start-RecoveryHealthProbe {
  param([hashtable]$Bundle, [object]$Journal)
  $script:FailurePhase = 'recovery'
  $script:FailureCode = 'recovery_health_process_failed'
  Stop-JournalCandidate $Journal
  $script:FailureCode = 'recovery_health_cleanup_failed'
  Remove-ProtectedFileIfPresent $HealthPath
  $script:FailureCode = 'recovery_health_capability_init_failed'
  Initialize-HealthCapability
  $script:FailureCode = 'recovery_health_process_failed'
  $previousNonce = $env:JHT_UPDATE_NONCE; $previousHealth = $env:JHT_UPDATE_HEALTH_PATH
  $env:JHT_UPDATE_NONCE = $Nonce; $env:JHT_UPDATE_HEALTH_PATH = $HealthPath
  $suspended = $null; $process = $null
  try {
    $suspended = [JhtSuspendedProcess]::Create([IO.Path]::GetFullPath($TargetPath))
    $process = Get-Process -Id $suspended.ProcessId -ErrorAction Stop
    $started = $process.StartTime.ToUniversalTime().Ticks.ToString()
    Update-JournalProcess $Journal $process.Id $started
    $script:FailurePhase = 'recovery'
    $script:FailureCode = 'recovery_health_resume_failed'
    $suspended.Resume()
    $script:FailureCode = 'recovery_health_release_failed'
    $suspended.ReleaseOwnership()
  } catch {
    if ($process) { try { $process.Kill(); $null = $process.WaitForExit(5000) } catch { } }
    throw
  } finally {
    if ($suspended) { $suspended.Dispose() }
    if ($null -eq $previousNonce) { Remove-Item Env:JHT_UPDATE_NONCE -ErrorAction SilentlyContinue } else { $env:JHT_UPDATE_NONCE = $previousNonce }
    if ($null -eq $previousHealth) { Remove-Item Env:JHT_UPDATE_HEALTH_PATH -ErrorAction SilentlyContinue } else { $env:JHT_UPDATE_HEALTH_PATH = $previousHealth }
  }
  $script:FailurePhase = 'recovery'
  $script:FailureCode = 'recovery_health_validate_failed'
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 200
    if (Test-CandidateHealth $Bundle $process $started) { return $true }
    if ($process.HasExited) { break }
  } while ([DateTime]::UtcNow -lt $deadline)
  $currentJournal = Read-ProtectedJsonFile $JournalPath -ExactCurrentOnly
  if ($currentJournal) { Stop-JournalCandidate $currentJournal }
  return $false
}

function Invoke-Apply {
  $script:FailurePhase = 'bundle'
  $script:FailureCode = 'bundle_staging_protection_failed'
  Initialize-StagingProtection
  $script:FailureCode = 'bundle_path_attestation_failed'
  Assert-Paths
  $bundle = Get-FreshBundle
  if (Test-Path -LiteralPath $JournalPath -PathType Leaf) {
    $script:FailurePhase = 'journal'
    $script:FailureCode = 'journal_existing_read_failed'
    $existingJournal = Read-ProtectedJsonFile $JournalPath -ExactCurrentOnly
    $script:FailureCode = 'journal_existing_validate_failed'
    Assert-Journal $existingJournal $bundle
    if ($existingJournal.state -cne 'prepared') { throw 'update nonce was already consumed' }
  }
  $script:FailurePhase = 'process'
  $script:FailureCode = 'process_old_identity_failed'
  $oldIdentity = Get-ObservedProcess $OldPid $TargetPath $OldStartedUtcTicks
  if (-not $oldIdentity) { throw 'old process identity is invalid' }
  $old = $oldIdentity.Process
  $observedOldStarted = [string]$oldIdentity.Started
  Write-Journal 'prepared' $bundle
  $script:FailurePhase = 'ready'
  $script:FailureCode = 'ready_write_failed'
  Write-AtomicJson $ReadyPath @{ schema = 1; type = 'ready'; ok = $true; nonce = $Nonce; request_id = $RequestId; instance_id = $InstanceId; old_pid = $OldPid; old_started = $observedOldStarted; manifest_sha256 = [string]$bundle.Candidate.Sha256; candidate_sha256 = [string]$bundle.New.sha256 }
  if ($Mode -eq 'Verify') { Write-Result $true 'ready' 'verified'; return }
  $script:FailurePhase = 'process'
  $script:FailureCode = 'process_old_wait_failed'
  if (-not $old.WaitForExit(60000)) { Write-Result $false 'ready' 'old_process_timeout'; return }

  $script:FailurePhase = 'bundle'
  $script:FailureCode = 'bundle_post_wait_attestation_failed'
  Assert-Paths
  $bundle = Get-FreshBundle
  Write-Journal 'swap_intent' $bundle
  $script:FailurePhase = 'swap'
  $script:FailureCode = 'swap_backup_cleanup_failed'
  Remove-ProtectedFileIfPresent $BackupPath
  $script:FailureCode = 'swap_promote_failed'
  Write-ProtectedAtomicFile -Destination $TargetPath -Source $CandidatePath `
    -ExpectedSha256 ([string]$bundle.New.sha256) `
    -ReplacementBackupPath $BackupPath -ConsumeSource
  Assert-ProtectedFileContent $BackupPath ([string]$bundle.Old.sha256) ([uint64]$bundle.Old.size)
  Write-Journal 'candidate_installed' $bundle

  $script:FailurePhase = 'health'
  $script:FailureCode = 'health_cleanup_failed'
  Remove-ProtectedFileIfPresent $HealthPath
  $script:FailureCode = 'health_capability_init_failed'
  Initialize-HealthCapability
  $script:FailureCode = 'health_process_start_failed'
  $previousNonce = $env:JHT_UPDATE_NONCE; $previousHealth = $env:JHT_UPDATE_HEALTH_PATH
  $env:JHT_UPDATE_NONCE = $Nonce; $env:JHT_UPDATE_HEALTH_PATH = $HealthPath
  $suspended = $null
  try {
    $suspended = [JhtSuspendedProcess]::Create([IO.Path]::GetFullPath($TargetPath))
    $candidateProcess = Get-Process -Id $suspended.ProcessId -ErrorAction Stop
    $candidateStarted = $candidateProcess.StartTime.ToUniversalTime().Ticks.ToString()
    Write-Journal 'candidate_installed' $bundle $candidateProcess.Id $candidateStarted
    $script:FailurePhase = 'health'
    $script:FailureCode = 'health_process_resume_failed'
    $suspended.Resume()
    $script:FailureCode = 'health_process_release_failed'
    $suspended.ReleaseOwnership()
  } finally {
    if ($suspended) { $suspended.Dispose() }
    if ($null -eq $previousNonce) { Remove-Item Env:JHT_UPDATE_NONCE -ErrorAction SilentlyContinue } else { $env:JHT_UPDATE_NONCE = $previousNonce }
    if ($null -eq $previousHealth) { Remove-Item Env:JHT_UPDATE_HEALTH_PATH -ErrorAction SilentlyContinue } else { $env:JHT_UPDATE_HEALTH_PATH = $previousHealth }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(30); $healthy = $false
  $script:FailureCode = 'health_ack_failed'
  do {
    Start-Sleep -Milliseconds 200
    if (Test-CandidateHealth $bundle $candidateProcess $candidateStarted) { $healthy = $true; break }
    if ($candidateProcess.HasExited) { break }
  } while ([DateTime]::UtcNow -lt $deadline)
  $script:FailurePhase = 'journal'
  $script:FailureCode = 'journal_health_read_failed'
  $journal = Read-ProtectedJsonFile $JournalPath -ExactCurrentOnly
  if (-not $healthy) { Invoke-Rollback $bundle $journal 'health_ack_failed'; return }

  Write-Journal 'health_acked' $bundle $candidateProcess.Id $candidateStarted
  Backup-OldAuthority $bundle
  Write-Journal 'authority_intent' $bundle $candidateProcess.Id $candidateStarted
  Install-CandidateMetadata $bundle
  Write-Journal 'metadata_installed' $bundle $candidateProcess.Id $candidateStarted
  Write-Journal 'floor_intent' $bundle $candidateProcess.Id $candidateStarted
  $script:FailurePhase = 'floor'
  $script:FailureCode = 'floor_commit_failed'
  Write-AtomicJson $FloorPath @{ schema = 1; sequence = [uint64]$bundle.Candidate.Value.sequence; version = [string]$bundle.Candidate.Value.version }
  Write-Journal 'helper_intent' $bundle $candidateProcess.Id $candidateStarted
  Install-CandidateHelper $bundle
  Write-Journal 'committed' $bundle $candidateProcess.Id $candidateStarted
  Complete-CommitCleanup -Context 'commit'
  Write-Result $true 'committed' 'updated'
}

function Set-CommitCleanupFailure {
  param(
    [ValidateSet('commit','recovery')][string]$Context,
    [ValidateSet('backup','failed','authority-preflight','authority-helper',
      'authority-manifest','authority-signature','authority-root')][string]$Stage)
  $script:FailurePhase = if ($Context -ceq 'commit') { 'cleanup' } else { 'recovery' }
  $script:FailureCode = switch -CaseSensitive ($Context + ':' + $Stage) {
    'commit:backup' { 'commit_backup_cleanup_failed'; break }
    'commit:failed' { 'commit_failed_cleanup_failed'; break }
    'commit:authority-preflight' { 'commit_authority_preflight_failed'; break }
    'commit:authority-helper' { 'commit_authority_helper_cleanup_failed'; break }
    'commit:authority-manifest' { 'commit_authority_manifest_cleanup_failed'; break }
    'commit:authority-signature' { 'commit_authority_signature_cleanup_failed'; break }
    'commit:authority-root' { 'commit_authority_root_cleanup_failed'; break }
    'recovery:backup' { 'recovery_commit_backup_cleanup_failed'; break }
    'recovery:failed' { 'recovery_commit_failed_cleanup_failed'; break }
    'recovery:authority-preflight' { 'recovery_commit_authority_preflight_failed'; break }
    'recovery:authority-helper' { 'recovery_commit_authority_helper_cleanup_failed'; break }
    'recovery:authority-manifest' { 'recovery_commit_authority_manifest_cleanup_failed'; break }
    'recovery:authority-signature' { 'recovery_commit_authority_signature_cleanup_failed'; break }
    'recovery:authority-root' { 'recovery_commit_authority_root_cleanup_failed'; break }
  }
}

function Remove-AuthorityBackupExact {
  param([ValidateSet('commit','recovery')][string]$Context)
  Set-CommitCleanupFailure $Context 'authority-preflight'
  $root = Get-AttestedAuthorityBackupRoot
  if ($null -eq $root) { return }
  foreach ($leaf in @(
      [pscustomobject]@{ Stage = 'authority-helper'; Path = $OldHelperBackupPath; Name = $AllowedHelperName },
      [pscustomobject]@{ Stage = 'authority-manifest'; Path = $OldManifestBackupPath; Name = 'RELEASE-MANIFEST.json' },
      [pscustomobject]@{ Stage = 'authority-signature'; Path = $OldSignatureBackupPath; Name = 'RELEASE-MANIFEST.json.sig' })) {
    Set-CommitCleanupFailure $Context $leaf.Stage
    $null = Get-AttestedAuthorityBackupRoot -Required
    $leafKind = [JhtUpdateFileIdentity]::GetNoFollowNodeKind($leaf.Path)
    if ($leafKind -ne 0) {
      if ($leafKind -ne 1) { throw 'authority backup leaf changed before cleanup' }
      Assert-AuthorityBackupLeaf $leaf.Path $leaf.Name
      Remove-Item -LiteralPath $leaf.Path -Force -ErrorAction Stop
    }
  }
  Set-CommitCleanupFailure $Context 'authority-root'
  if (Assert-AuthorityBackupRootEmpty) {
    Remove-Item -LiteralPath $AuthorityBackupDir -Force -ErrorAction Stop
  }
}

function Complete-CommitCleanup {
  param([ValidateSet('commit','recovery')][string]$Context)
  # Attest every target before the first deletion.  The fixed authority
  # snapshot is then removed leaf-by-leaf so a partial cleanup is retryable.
  Set-CommitCleanupFailure $Context 'backup'
  Assert-AtomicDestinationPreflight $BackupPath
  Set-CommitCleanupFailure $Context 'failed'
  Assert-AtomicDestinationPreflight $FailedPath
  Set-CommitCleanupFailure $Context 'authority-preflight'
  Assert-AuthorityBackupPreflight
  Set-CommitCleanupFailure $Context 'backup'
  Remove-ProtectedFileIfPresent $BackupPath
  Set-CommitCleanupFailure $Context 'failed'
  Remove-ProtectedFileIfPresent $FailedPath
  Remove-AuthorityBackupExact $Context
}

function Invoke-Recover {
  $script:FailurePhase = 'recovery'
  $script:FailureCode = 'recovery_path_attestation_failed'
  Assert-Paths
  $script:FailureCode = 'recovery_journal_read_failed'
  $journal = Read-ProtectedJsonFile $JournalPath -ExactCurrentOnly
  $script:FailureCode = 'recovery_candidate_read_failed'
  $candidate = Read-VerifiedManifest $CandidateManifestPath $CandidateSignaturePath
  $candidateDesktop = Get-ArtifactByRole $candidate.Value $DesktopRole
  $candidateHelper = Get-ArtifactByRole $candidate.Value $HelperRole
  $candidateSignatureSha256 = Get-Sha256 $CandidateSignaturePath
  $journalKeys = @('candidate_helper_sha256','candidate_manifest_sha256','candidate_pid','candidate_sha256','candidate_signature_sha256','candidate_started','installed_sequence','installed_version','nonce','old_helper_sha256','old_manifest_sha256','old_sha256','old_signature_sha256','schema','state','target_sequence','target_version')
  $journalShapeOk = $journal -and (Test-ExactProperties $journal $journalKeys) -and (Test-JsonInteger $journal.schema) -and [int64]$journal.schema -eq 1
  $candidateIdentityMatches = $journalShapeOk -and $journal.nonce -ceq $Nonce -and $journal.target_version -ceq [string]$candidate.Value.version -and [string]$journal.target_sequence -ceq [string]$candidate.Value.sequence -and $journal.candidate_sha256 -ceq [string]$candidateDesktop.sha256 -and $journal.candidate_helper_sha256 -ceq [string]$candidateHelper.sha256 -and $journal.candidate_manifest_sha256 -ceq [string]$candidate.Sha256 -and $journal.candidate_signature_sha256 -ceq $candidateSignatureSha256
  $script:FailureCode = 'recovery_floor_read_failed'
  $floor = Read-Floor
  if ($candidateIdentityMatches -and @('metadata_installed','floor_intent','helper_intent','committed') -ccontains [string]$journal.state -and $floor -and [uint64]$floor.sequence -ge [uint64]$candidate.Value.sequence -and (Get-Sha256 $TargetPath) -ceq [string]$candidateDesktop.sha256) {
    $active = $null
    try { $active = Read-VerifiedManifest $InstalledManifestPath $InstalledSignaturePath } catch { }
    if ($active -and $active.Sha256 -ceq [string]$candidate.Sha256) {
      $healthBundle = @{ Candidate = $candidate; New = $candidateDesktop }
      $script:FailureCode = 'recovery_health_validate_failed'
      $candidateProcess = Get-ExactProcess ([int]$journal.candidate_pid) ([string]$journal.candidate_started) $TargetPath
      $healthy = $candidateProcess -and (Test-CandidateHealth $healthBundle $candidateProcess ([string]$journal.candidate_started))
      if (-not $healthy) { $healthy = Start-RecoveryHealthProbe $healthBundle $journal }
      if (-not $healthy) { throw 'candidate health is not recoverable for commit' }
      if ($healthy) {
        $script:FailureCode = 'recovery_journal_refresh_failed'
        $journal = Read-ProtectedJsonFile $JournalPath -ExactCurrentOnly
        if ((Get-Sha256 $PSCommandPath) -cne [string]$candidateHelper.sha256) {
          Update-JournalState $journal 'helper_intent' ([int]$journal.candidate_pid) ([string]$journal.candidate_started)
          Install-CandidateHelper @{ Candidate = $candidate; NewHelper = $candidateHelper }
          $script:FailurePhase = 'recovery'
          $script:FailureCode = 'recovery_journal_refresh_failed'
          $journal = Read-ProtectedJsonFile $JournalPath -ExactCurrentOnly
        }
        Update-JournalState $journal 'committed' ([int]$journal.candidate_pid) ([string]$journal.candidate_started)
        Complete-CommitCleanup -Context 'recovery'
        Write-Result $true 'committed' 'interrupted_commit_completed'
        return
      }
    }
  }
  $bundle = Get-RecoveryBundle
  $script:FailurePhase = 'recovery'
  $script:FailureCode = 'recovery_journal_validate_failed'
  Assert-Journal $journal $bundle
  $targetHash = Get-Sha256 $TargetPath
  $helperHash = Get-Sha256 $PSCommandPath
  $script:FailureCode = 'recovery_floor_read_failed'
  $floor = Read-Floor
  if ($floor -and [uint64]$floor.sequence -ge [uint64]$bundle.Candidate.Value.sequence) { throw 'committed floor forbids rollback to the previous version' }
  if ($targetHash -ceq [string]$bundle.Old.sha256 -and $helperHash -ceq [string]$bundle.OldHelper.sha256 -and @('prepared','rolled_back') -ccontains [string]$journal.state) {
    Write-Result $true 'recovered' 'old_version_intact' ($journal.state -ceq 'rolled_back')
    return
  }
  Invoke-Rollback $bundle $journal 'interrupted_update_recovered'
}

$exitCode = 1
$lockHeld = $false
try {
  Assert-SafeLocationPlan
  $script:FailurePhase = 'trust'
  $script:FailureCode = 'trust_failed'
  Assert-PreMutationTrust
  $script:FailurePhase = 'state'
  $script:FailureCode = 'state_failed'
  Initialize-ProtectedDirectory $StateRoot
  Initialize-ProtectedDirectory $TxnDir
  $script:FailurePhase = 'lock'
  $script:FailureCode = 'lock_failed'
  Acquire-Lock; $lockHeld = $true
  $script:FailurePhase = 'result'
  $script:FailureCode = 'result_preflight_failed'
  Assert-AtomicDestinationPreflight $ResultPath
  Remove-ProtectedFileIfPresent $ResultPath
  if ($Mode -eq 'Recover') { Invoke-Recover } else { Invoke-Apply }
  $script:FailurePhase = 'result'
  $script:FailureCode = 'result_read_failed'
  $result = Read-Result
  if (-not $result) { throw 'update result is missing or corrupt' }
  $exitCode = if ($result -and $result.ok -eq $true) { 0 } elseif ($result -and $result.phase -eq 'ready' -and $result.code -eq 'old_process_timeout') { 3 } else { 1 }
} catch {
  if ($lockHeld) {
    $failedPhase = $script:FailurePhase
    $failedCode = $script:FailureCode
    if (Test-Path -LiteralPath $JournalPath -PathType Leaf) {
      try { Invoke-Recover } catch { $failedPhase = $script:FailurePhase; $failedCode = $script:FailureCode }
    }
    try { $result = Read-Result } catch { $result = $null }
    if (-not $result) {
      $null = Write-FailureResultOrStderr $failedPhase $failedCode
    }
    try { $result = Read-Result } catch { $result = $null }
    $exitCode = if ($result -and $result.ok -eq $true -and $result.phase -ceq 'committed') { 0 } else { 1 }
  } else {
    [Console]::Error.WriteLine(
      'JHT-WINDOWS-UPDATE-ERROR schema=1 phase=' + $script:FailurePhase +
      ' code=' + $script:FailureCode)
    $exitCode = 1
  }
} finally {
  if ($lockHeld) { Release-Lock }
}
exit $exitCode

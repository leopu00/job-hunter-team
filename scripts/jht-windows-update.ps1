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
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class JhtUpdateFileIdentity {
    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_SEQUENTIAL_SCAN = 0x08000000;
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

    public static string Sha256(string inputPath) {
        string expected = Path.GetFullPath(inputPath);
        using (SafeFileHandle handle = CreateFile(
            expected, GENERIC_READ, FILE_SHARE_READ, IntPtr.Zero, OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_SEQUENTIAL_SCAN, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            BY_HANDLE_FILE_INFORMATION info;
            if (!GetFileInformationByHandle(handle, out info))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if ((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                throw new InvalidDataException("update file is a reparse point");
            if (info.NumberOfLinks != 1)
                throw new InvalidDataException("update file has multiple hard links");
            StringBuilder finalPath = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(handle, finalPath, (uint)finalPath.Capacity, 0);
            if (length == 0 || length >= finalPath.Capacity)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            string actual = Path.GetFullPath(NormalizeFinalPath(finalPath.ToString()));
            if (!String.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("update file canonical path changed");
            using (FileStream stream = new FileStream(handle, FileAccess.Read, 1048576, false))
            using (SHA256 algorithm = SHA256.Create()) {
                return BitConverter.ToString(algorithm.ComputeHash(stream))
                    .Replace("-", "").ToLowerInvariant();
            }
        }
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

function Get-FileSystemParent {
  param([IO.FileSystemInfo]$Node)
  if ($Node -is [IO.FileInfo]) { return $Node.Directory }
  if ($Node -is [IO.DirectoryInfo]) { return $Node.Parent }
  throw 'unexpected filesystem node type during protected path traversal'
}

function Assert-NoReparseAncestors {
  param(
    [string]$Path,
    [string]$ReparseCode = '',
    [string]$InternalCode = '')
  $reparseDetected = $false
  try {
    $full = [IO.Path]::GetFullPath($Path)
    $probe = if (Test-Path -LiteralPath $full) { Get-Item -LiteralPath $full -Force } else { Get-Item -LiteralPath ([IO.Path]::GetDirectoryName($full)) -Force }
    while ($null -ne $probe) {
      if (($probe.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        $reparseDetected = $true
        if ($ReparseCode) { $script:FailureCode = $ReparseCode }
        throw 'reparse point in protected path'
      }
      $parent = Get-FileSystemParent $probe
      if ($null -eq $parent -or $parent.FullName -eq $probe.FullName) { break }
      $probe = $parent
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
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) { Assert-CurrentOwner $Path; Assert-NoForeignWriteAcl $Path } else { New-Item -ItemType Directory -Path $Path -Force | Out-Null }
  Assert-NoReparseAncestors $Path
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
  $acl = $item.GetAccessControl([Security.AccessControl.AccessControlSections]::All)
  $acl.SetAccessRuleProtection($true, $false)
  $rule = New-Object Security.AccessControl.FileSystemAccessRule([Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
  $acl.SetAccessRule($rule)
  $item.SetAccessControl($acl)
  Assert-OwnerAndAcl $Path -Directory
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

function Write-AtomicJson {
  param([string]$Path, [hashtable]$Value)
  $temporary = "$Path.tmp-$PID-$([guid]::NewGuid().ToString('N'))"
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Compress -Depth 8) + "`n")
  $stream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
  if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, $null) } else { [IO.File]::Move($temporary, $Path) }
}

function Read-JsonFile {
  param([string]$Path)
  try { return Get-Content -LiteralPath $Path -Raw -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop } catch { return $null }
}

function Read-Floor {
  if (-not (Test-Path -LiteralPath $FloorPath)) { return $null }
  Assert-OwnerAndAcl $FloorPath
  $floor = Read-JsonFile $FloorPath
  if (-not (Test-ExactProperties $floor @('schema','sequence','version')) -or -not (Test-JsonInteger $floor.schema) -or [int64]$floor.schema -ne 1 -or -not (Test-JsonInteger $floor.sequence) -or [uint64]$floor.sequence -ne (Get-VersionSequence ([string]$floor.version))) { throw 'committed update floor is corrupt' }
  return $floor
}

function Write-Result {
  param([bool]$Ok, [string]$Phase, [string]$Code, [bool]$RolledBack = $false)
  try { Write-AtomicJson $ResultPath @{ schema = 1; ok = $Ok; phase = $Phase; code = $Code; nonce = $Nonce; rolled_back = $RolledBack } } catch { }
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
    Initialize-ProtectedDirectory $claim
    Write-AtomicJson (Join-Path $claim 'owner.json') @{ schema = 1; nonce = $Nonce; pid = $PID; started = $script:LockOwnerStarted }
    try {
      [IO.Directory]::Move($claim, $LockPath)
      return
    } catch {
      Remove-Item -LiteralPath $claim -Recurse -Force -ErrorAction SilentlyContinue
      if (-not (Test-Path -LiteralPath $LockPath -PathType Container)) { continue }
      Assert-NoReparseAncestors $LockPath
      Assert-OwnerAndAcl $LockPath -Directory
      $owner = Read-JsonFile (Join-Path $LockPath 'owner.json')
      if ($owner -and (Test-ExactProperties $owner @('nonce','pid','schema','started')) -and (Test-JsonInteger $owner.schema) -and [int64]$owner.schema -eq 1) {
        $active = Get-ExactProcess ([int]$owner.pid) ([string]$owner.started)
        if ($active) { throw 'another Windows update transaction is active' }
      }
      $stale = Join-Path $StateRoot ('.update-stale-' + [guid]::NewGuid().ToString('N'))
      try { [IO.Directory]::Move($LockPath, $stale) } catch { continue }
      Remove-Item -LiteralPath $stale -Recurse -Force -ErrorAction Stop
    }
  }
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
  if (Test-Path -LiteralPath $AuthorityBackupDir -PathType Container) {
    Assert-NoReparseAncestors $AuthorityBackupDir `
      -ReparseCode 'location_backup_reparse' `
      -InternalCode 'location_backup_internal'
    $script:FailureCode = 'location_backup_owner'
    Assert-CurrentOwner $AuthorityBackupDir
    foreach ($path in @($OldHelperBackupPath, $OldManifestBackupPath, $OldSignatureBackupPath)) { if (Test-Path -LiteralPath $path -PathType Leaf) { Assert-NoReparseAncestors $path -ReparseCode 'location_backup_child_reparse' -InternalCode 'location_backup_child_internal'; $script:FailureCode = 'location_backup_child_owner'; Assert-CurrentOwner $path } }
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
  $oldManifest = if ($Mode -eq 'Recover' -and (Test-Path -LiteralPath $OldManifestBackupPath -PathType Leaf)) { $OldManifestBackupPath } else { $InstalledManifestPath }
  $oldSignature = if ($Mode -eq 'Recover' -and (Test-Path -LiteralPath $OldSignatureBackupPath -PathType Leaf)) { $OldSignatureBackupPath } else { $InstalledSignaturePath }
  $installed = Read-VerifiedManifest $oldManifest $oldSignature
  # Recovery può usare lo snapshot per autenticare la release old, ma deve
  # attestare SEMPRE i byte del helper che PowerShell sta eseguendo. Mai
  # sostituire questa verifica con quella della copia staged/backup.
  Assert-FileMatchesArtifact $PSCommandPath (Get-ArtifactByRole $installed.Value $HelperRole)
  if ($Mode -ne 'Recover') { Assert-FileMatchesArtifact $TargetPath (Get-ArtifactByRole $installed.Value $DesktopRole) }
}

function Get-FreshBundle {
  $installed = Read-VerifiedManifest $InstalledManifestPath $InstalledSignaturePath
  $candidate = Read-VerifiedManifest $CandidateManifestPath $CandidateSignaturePath
  if ((Compare-Version ([string]$installed.Value.version) $BaselineVersion) -lt 0) { throw 'v0.3.5 to v0.3.6 is manual-only' }
  if ((Compare-Version ([string]$candidate.Value.version) ([string]$installed.Value.version)) -le 0 -or [uint64]$candidate.Value.sequence -le [uint64]$installed.Value.sequence) { throw 'candidate is not strictly forward' }
  $floor = Read-Floor
  if (-not $floor) {
    Write-AtomicJson $FloorPath @{ schema = 1; sequence = [uint64]$installed.Value.sequence; version = [string]$installed.Value.version }
    Protect-File $FloorPath
    $floor = Read-Floor
  }
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
  $candidate = Read-VerifiedManifest $CandidateManifestPath $CandidateSignaturePath
  $oldManifest = if (Test-Path -LiteralPath $OldManifestBackupPath -PathType Leaf) { $OldManifestBackupPath } else { $InstalledManifestPath }
  $oldSignature = if (Test-Path -LiteralPath $OldSignatureBackupPath -PathType Leaf) { $OldSignatureBackupPath } else { $InstalledSignaturePath }
  $installed = Read-VerifiedManifest $oldManifest $oldSignature
  $old = Get-ArtifactByRole $installed.Value $DesktopRole
  $oldHelper = Get-ArtifactByRole $installed.Value $HelperRole
  $new = Get-ArtifactByRole $candidate.Value $DesktopRole
  $newHelper = Get-ArtifactByRole $candidate.Value $HelperRole
  Assert-FileMatchesArtifact $CandidateHelperPath $newHelper
  if (Test-Path -LiteralPath $OldHelperBackupPath -PathType Leaf) { Assert-FileMatchesArtifact $OldHelperBackupPath $oldHelper }
  return @{
    Installed = $installed; Candidate = $candidate; Old = $old; OldHelper = $oldHelper; New = $new; NewHelper = $newHelper
    OldSignatureSha256 = Get-Sha256 $oldSignature
    CandidateSignatureSha256 = Get-Sha256 $CandidateSignaturePath
  }
}

function Write-Journal {
  param([string]$State, [hashtable]$Bundle, [int]$CandidatePid = 0, [string]$CandidateStarted = '')
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
  if ((Get-Sha256 $Source) -cne $ExpectedSha256) { throw 'trusted copy source hash mismatch' }
  $temporary = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Destination))) ('.jht-copy-' + [guid]::NewGuid().ToString('N'))
  Copy-Item -LiteralPath $Source -Destination $temporary -ErrorAction Stop
  Protect-File $temporary
  if ((Get-Sha256 $temporary) -cne $ExpectedSha256) { throw 'trusted copy staging hash mismatch' }
  if (Test-Path -LiteralPath $Destination -PathType Leaf) { [IO.File]::Replace($temporary, $Destination, $null) } else { [IO.File]::Move($temporary, $Destination) }
  if ((Get-Sha256 $Destination) -cne $ExpectedSha256) { throw 'trusted copy destination hash mismatch' }
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
  Initialize-ProtectedDirectory $AuthorityBackupDir
  Copy-AtomicVerified $PSCommandPath $OldHelperBackupPath ([string]$Bundle.OldHelper.sha256)
  Copy-AtomicVerified $InstalledManifestPath $OldManifestBackupPath ([string]$Bundle.Installed.Sha256)
  Copy-AtomicVerified $InstalledSignaturePath $OldSignatureBackupPath ([string]$Bundle.OldSignatureSha256)
}

function Restore-OldAuthority {
  param([hashtable]$Bundle)
  foreach ($path in @($OldHelperBackupPath, $OldManifestBackupPath, $OldSignatureBackupPath)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'verified authority rollback snapshot is unavailable' } }
  Copy-AtomicVerified $OldHelperBackupPath $PSCommandPath ([string]$Bundle.OldHelper.sha256)
  Copy-AtomicVerified $OldManifestBackupPath $InstalledManifestPath ([string]$Bundle.Installed.Sha256)
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
  Copy-AtomicVerified $CandidateManifestPath $InstalledManifestPath ([string]$Bundle.Candidate.Sha256)
  Copy-AtomicVerified $CandidateSignaturePath $InstalledSignaturePath ([string]$Bundle.CandidateSignatureSha256)
  $installed = Read-VerifiedManifest $InstalledManifestPath $InstalledSignaturePath
  if ($installed.Sha256 -cne [string]$Bundle.Candidate.Sha256) { throw 'candidate authority metadata mismatch' }
}

function Install-CandidateHelper {
  param([hashtable]$Bundle)
  Copy-AtomicVerified $CandidateHelperPath $PSCommandPath ([string]$Bundle.NewHelper.sha256)
  $installed = Read-VerifiedManifest $InstalledManifestPath $InstalledSignaturePath
  Assert-FileMatchesArtifact $PSCommandPath (Get-ArtifactByRole $installed.Value $HelperRole)
}

function Restore-OldTarget {
  param([hashtable]$Bundle, [object]$Journal)
  Stop-JournalCandidate $Journal
  if ((Get-Sha256 $TargetPath) -ceq [string]$Bundle.Old.sha256) { return }
  if (-not (Test-Path -LiteralPath $BackupPath -PathType Leaf) -or (Get-Sha256 $BackupPath) -cne [string]$Bundle.Old.sha256) { throw 'verified rollback snapshot is unavailable' }
  $restore = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($TargetPath))) ('.jht-update-' + $Nonce + '.restore.exe')
  Copy-Item -LiteralPath $BackupPath -Destination $restore -Force
  Protect-File $restore
  if ((Get-Sha256 $restore) -cne [string]$Bundle.Old.sha256) { throw 'rollback staging verification failed' }
  Remove-Item -LiteralPath $FailedPath -Force -ErrorAction SilentlyContinue
  [IO.File]::Replace($restore, [IO.Path]::GetFullPath($TargetPath), $FailedPath)
  if ((Get-Sha256 $TargetPath) -cne [string]$Bundle.Old.sha256) { throw 'rollback target verification failed' }
}

function Invoke-Rollback {
  param([hashtable]$Bundle, [object]$Journal, [string]$Code)
  Restore-OldTarget $Bundle $Journal
  if (-not (Test-OldAuthorityInstalled $Bundle)) { Restore-OldAuthority $Bundle }
  Write-Journal 'rolled_back' $Bundle
  Start-Process -FilePath ([IO.Path]::GetFullPath($TargetPath)) | Out-Null
  Write-Result $false 'rollback' $Code $true
}

function Test-CandidateHealth {
  param([hashtable]$Bundle, [Diagnostics.Process]$Process, [string]$Started)
  $health = Read-JsonFile $HealthPath
  if (-not $health -or -not (Test-ExactProperties $health @('exe_path','exe_sha256','nonce','pid','process_started_utc_ticks','schema','type','version'))) { return $false }
  return (Test-JsonInteger $health.schema) -and [int64]$health.schema -eq 1 -and (Test-JsonInteger $health.pid) -and [int]$health.pid -eq $Process.Id -and $health.process_started_utc_ticks -ceq $Started -and $health.type -ceq 'healthy' -and $health.nonce -ceq $Nonce -and $health.version -ceq [string]$Bundle.Candidate.Value.version -and $health.exe_sha256 -ceq [string]$Bundle.New.sha256 -and ([IO.Path]::GetFullPath([string]$health.exe_path)).Equals([IO.Path]::GetFullPath($TargetPath), [StringComparison]::OrdinalIgnoreCase)
}

function Update-JournalProcess {
  param([object]$Journal, [int]$ProcessId, [string]$Started)
  $value = @{}
  foreach ($property in $Journal.PSObject.Properties) { $value[$property.Name] = $property.Value }
  $value['candidate_pid'] = $ProcessId
  $value['candidate_started'] = $Started
  Write-AtomicJson $JournalPath $value
}

function Start-RecoveryHealthProbe {
  param([hashtable]$Bundle, [object]$Journal)
  Stop-JournalCandidate $Journal
  Remove-Item -LiteralPath $HealthPath -Force -ErrorAction SilentlyContinue
  $previousNonce = $env:JHT_UPDATE_NONCE; $previousHealth = $env:JHT_UPDATE_HEALTH_PATH
  $env:JHT_UPDATE_NONCE = $Nonce; $env:JHT_UPDATE_HEALTH_PATH = $HealthPath
  $suspended = $null; $process = $null
  try {
    $suspended = [JhtSuspendedProcess]::Create([IO.Path]::GetFullPath($TargetPath))
    $process = Get-Process -Id $suspended.ProcessId -ErrorAction Stop
    $started = $process.StartTime.ToUniversalTime().Ticks.ToString()
    Update-JournalProcess $Journal $process.Id $started
    $suspended.Resume()
    $suspended.ReleaseOwnership()
  } catch {
    if ($process) { try { $process.Kill(); $null = $process.WaitForExit(5000) } catch { } }
    throw
  } finally {
    if ($suspended) { $suspended.Dispose() }
    if ($null -eq $previousNonce) { Remove-Item Env:JHT_UPDATE_NONCE -ErrorAction SilentlyContinue } else { $env:JHT_UPDATE_NONCE = $previousNonce }
    if ($null -eq $previousHealth) { Remove-Item Env:JHT_UPDATE_HEALTH_PATH -ErrorAction SilentlyContinue } else { $env:JHT_UPDATE_HEALTH_PATH = $previousHealth }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 200
    if (Test-CandidateHealth $Bundle $process $started) { return $true }
    if ($process.HasExited) { break }
  } while ([DateTime]::UtcNow -lt $deadline)
  $currentJournal = Read-JsonFile $JournalPath
  if ($currentJournal) { Stop-JournalCandidate $currentJournal }
  return $false
}

function Invoke-Apply {
  Initialize-StagingProtection
  Assert-Paths
  $bundle = Get-FreshBundle
  if (Test-Path -LiteralPath $JournalPath -PathType Leaf) {
    $existingJournal = Read-JsonFile $JournalPath
    Assert-Journal $existingJournal $bundle
    if ($existingJournal.state -cne 'prepared') { throw 'update nonce was already consumed' }
  }
  $oldIdentity = Get-ObservedProcess $OldPid $TargetPath $OldStartedUtcTicks
  if (-not $oldIdentity) { throw 'old process identity is invalid' }
  $old = $oldIdentity.Process
  $observedOldStarted = [string]$oldIdentity.Started
  Write-Journal 'prepared' $bundle
  Write-AtomicJson $ReadyPath @{ schema = 1; type = 'ready'; ok = $true; nonce = $Nonce; request_id = $RequestId; instance_id = $InstanceId; old_pid = $OldPid; old_started = $observedOldStarted; manifest_sha256 = [string]$bundle.Candidate.Sha256; candidate_sha256 = [string]$bundle.New.sha256 }
  if ($Mode -eq 'Verify') { Write-Result $true 'ready' 'verified'; return }
  if (-not $old.WaitForExit(60000)) { Write-Result $false 'ready' 'old_process_timeout'; return }

  Assert-Paths
  $bundle = Get-FreshBundle
  Write-Journal 'swap_intent' $bundle
  Remove-Item -LiteralPath $BackupPath -Force -ErrorAction SilentlyContinue
  [IO.File]::Replace([IO.Path]::GetFullPath($CandidatePath), [IO.Path]::GetFullPath($TargetPath), $BackupPath)
  if ((Get-Sha256 $TargetPath) -cne [string]$bundle.New.sha256 -or (Get-Sha256 $BackupPath) -cne [string]$bundle.Old.sha256) { throw 'post-replacement hash verification failed' }
  Write-Journal 'candidate_installed' $bundle

  Remove-Item -LiteralPath $HealthPath -Force -ErrorAction SilentlyContinue
  $previousNonce = $env:JHT_UPDATE_NONCE; $previousHealth = $env:JHT_UPDATE_HEALTH_PATH
  $env:JHT_UPDATE_NONCE = $Nonce; $env:JHT_UPDATE_HEALTH_PATH = $HealthPath
  $suspended = $null
  try {
    $suspended = [JhtSuspendedProcess]::Create([IO.Path]::GetFullPath($TargetPath))
    $candidateProcess = Get-Process -Id $suspended.ProcessId -ErrorAction Stop
    $candidateStarted = $candidateProcess.StartTime.ToUniversalTime().Ticks.ToString()
    Write-Journal 'candidate_installed' $bundle $candidateProcess.Id $candidateStarted
    $suspended.Resume()
    $suspended.ReleaseOwnership()
  } finally {
    if ($suspended) { $suspended.Dispose() }
    if ($null -eq $previousNonce) { Remove-Item Env:JHT_UPDATE_NONCE -ErrorAction SilentlyContinue } else { $env:JHT_UPDATE_NONCE = $previousNonce }
    if ($null -eq $previousHealth) { Remove-Item Env:JHT_UPDATE_HEALTH_PATH -ErrorAction SilentlyContinue } else { $env:JHT_UPDATE_HEALTH_PATH = $previousHealth }
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(30); $healthy = $false
  do {
    Start-Sleep -Milliseconds 200
    if (Test-CandidateHealth $bundle $candidateProcess $candidateStarted) { $healthy = $true; break }
    if ($candidateProcess.HasExited) { break }
  } while ([DateTime]::UtcNow -lt $deadline)
  $journal = Read-JsonFile $JournalPath
  if (-not $healthy) { Invoke-Rollback $bundle $journal 'health_ack_failed'; return }

  Write-Journal 'health_acked' $bundle $candidateProcess.Id $candidateStarted
  Backup-OldAuthority $bundle
  Write-Journal 'authority_intent' $bundle $candidateProcess.Id $candidateStarted
  Install-CandidateMetadata $bundle
  Write-Journal 'metadata_installed' $bundle $candidateProcess.Id $candidateStarted
  Write-Journal 'floor_intent' $bundle $candidateProcess.Id $candidateStarted
  Write-AtomicJson $FloorPath @{ schema = 1; sequence = [uint64]$bundle.Candidate.Value.sequence; version = [string]$bundle.Candidate.Value.version }
  Protect-File $FloorPath
  Write-Journal 'helper_intent' $bundle $candidateProcess.Id $candidateStarted
  Install-CandidateHelper $bundle
  Write-Journal 'committed' $bundle $candidateProcess.Id $candidateStarted
  Remove-Item -LiteralPath $BackupPath, $FailedPath, $AuthorityBackupDir -Recurse -Force -ErrorAction SilentlyContinue
  Write-Result $true 'committed' 'updated'
}

function Invoke-Recover {
  Assert-Paths
  $journal = Read-JsonFile $JournalPath
  $candidate = Read-VerifiedManifest $CandidateManifestPath $CandidateSignaturePath
  $candidateDesktop = Get-ArtifactByRole $candidate.Value $DesktopRole
  $candidateHelper = Get-ArtifactByRole $candidate.Value $HelperRole
  $candidateSignatureSha256 = Get-Sha256 $CandidateSignaturePath
  $journalKeys = @('candidate_helper_sha256','candidate_manifest_sha256','candidate_pid','candidate_sha256','candidate_signature_sha256','candidate_started','installed_sequence','installed_version','nonce','old_helper_sha256','old_manifest_sha256','old_sha256','old_signature_sha256','schema','state','target_sequence','target_version')
  $journalShapeOk = $journal -and (Test-ExactProperties $journal $journalKeys) -and (Test-JsonInteger $journal.schema) -and [int64]$journal.schema -eq 1
  $candidateIdentityMatches = $journalShapeOk -and $journal.nonce -ceq $Nonce -and $journal.target_version -ceq [string]$candidate.Value.version -and [string]$journal.target_sequence -ceq [string]$candidate.Value.sequence -and $journal.candidate_sha256 -ceq [string]$candidateDesktop.sha256 -and $journal.candidate_helper_sha256 -ceq [string]$candidateHelper.sha256 -and $journal.candidate_manifest_sha256 -ceq [string]$candidate.Sha256 -and $journal.candidate_signature_sha256 -ceq $candidateSignatureSha256
  $floor = Read-Floor
  if ($candidateIdentityMatches -and @('metadata_installed','floor_intent','helper_intent','committed') -ccontains [string]$journal.state -and $floor -and [uint64]$floor.sequence -ge [uint64]$candidate.Value.sequence -and (Get-Sha256 $TargetPath) -ceq [string]$candidateDesktop.sha256) {
    $active = $null
    try { $active = Read-VerifiedManifest $InstalledManifestPath $InstalledSignaturePath } catch { }
    if ($active -and $active.Sha256 -ceq [string]$candidate.Sha256) {
      $healthBundle = @{ Candidate = $candidate; New = $candidateDesktop }
      $candidateProcess = Get-ExactProcess ([int]$journal.candidate_pid) ([string]$journal.candidate_started) $TargetPath
      $healthy = $candidateProcess -and (Test-CandidateHealth $healthBundle $candidateProcess ([string]$journal.candidate_started))
      if (-not $healthy) { $healthy = Start-RecoveryHealthProbe $healthBundle $journal }
      if (-not $healthy) { throw 'candidate health is not recoverable for commit' }
      if ($healthy) {
        $journal = Read-JsonFile $JournalPath
        if ((Get-Sha256 $PSCommandPath) -cne [string]$candidateHelper.sha256) {
          Update-JournalState $journal 'helper_intent' ([int]$journal.candidate_pid) ([string]$journal.candidate_started)
          Install-CandidateHelper @{ Candidate = $candidate; NewHelper = $candidateHelper }
          $journal = Read-JsonFile $JournalPath
        }
        Update-JournalState $journal 'committed' ([int]$journal.candidate_pid) ([string]$journal.candidate_started)
        Remove-Item -LiteralPath $BackupPath, $FailedPath, $AuthorityBackupDir -Recurse -Force -ErrorAction SilentlyContinue
        Write-Result $true 'committed' 'interrupted_commit_completed'
        return
      }
    }
  }
  $bundle = Get-RecoveryBundle
  Assert-Journal $journal $bundle
  $targetHash = Get-Sha256 $TargetPath
  $helperHash = Get-Sha256 $PSCommandPath
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
  Remove-Item -LiteralPath $ResultPath -Force -ErrorAction SilentlyContinue
  if ($Mode -eq 'Recover') { Invoke-Recover } else { Invoke-Apply }
  $result = Read-JsonFile $ResultPath
  $exitCode = if ($result -and $result.ok -eq $true) { 0 } elseif ($result -and $result.phase -eq 'ready' -and $result.code -eq 'old_process_timeout') { 3 } else { 1 }
} catch {
  if ($lockHeld) {
    if (Test-Path -LiteralPath $JournalPath -PathType Leaf) {
      try { Invoke-Recover } catch { }
    }
    $result = Read-JsonFile $ResultPath
    if (-not $result) { Write-Result $false 'failed' 'update_failed' }
    $result = Read-JsonFile $ResultPath
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

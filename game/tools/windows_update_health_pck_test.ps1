[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [string]$ProjectFile = (Join-Path $PSScriptRoot '..\project.godot')
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'the exported-PCK health gate requires Windows'
}

$Executable = [IO.Path]::GetFullPath($Executable)
$ProjectFile = [IO.Path]::GetFullPath($ProjectFile)
if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
  throw 'exported Windows executable is missing'
}
if (-not (Test-Path -LiteralPath $ProjectFile -PathType Leaf)) {
  throw 'Godot project file is missing'
}

$versionLine = Get-Content -LiteralPath $ProjectFile | Where-Object {
  $_ -match '^config/version="([0-9]+\.[0-9]+\.[0-9]+)"$'
} | Select-Object -First 1
if (-not $versionLine) { throw 'stable Godot version is missing' }
$null = $versionLine -match '^config/version="([0-9]+\.[0-9]+\.[0-9]+)"$'
$expectedVersion = $Matches[1]
$expectedExecutableHash = (Get-FileHash -LiteralPath $Executable -Algorithm SHA256).Hash.ToLowerInvariant()
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$sections = [Security.AccessControl.AccessControlSections]::All

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class JhtHealthPckIdentity {
    private const uint GENERIC_READ = 0x80000000;
    private const uint READ_CONTROL = 0x00020000;
    private const uint WRITE_DAC = 0x00040000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_SHARE_DELETE = 0x00000004;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;
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

    private static string Identity(BY_HANDLE_FILE_INFORMATION info) {
        return info.VolumeSerialNumber.ToString("x8") + ":" +
            info.FileIndexHigh.ToString("x8") +
            info.FileIndexLow.ToString("x8");
    }

    private static string FinalPath(SafeFileHandle handle) {
        StringBuilder path = new StringBuilder(32768);
        uint length = GetFinalPathNameByHandle(
            handle, path, (uint)path.Capacity, 0);
        if (length == 0 || length >= path.Capacity)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return Path.GetFullPath(NormalizeFinalPath(path.ToString()));
    }

    public static int GetNoFollowNodeKind(string inputPath) {
        string path = Path.GetFullPath(inputPath);
        using (SafeFileHandle handle = CreateFile(
            path, 0,
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

    public static string InspectNode(string inputPath) {
        string path = Path.GetFullPath(inputPath);
        using (SafeFileHandle handle = CreateFile(
            path, READ_CONTROL,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero, OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            IntPtr.Zero)) {
            if (handle.IsInvalid)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            BY_HANDLE_FILE_INFORMATION info;
            if (!GetFileInformationByHandle(handle, out info))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if ((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                return "reparse|" + info.NumberOfLinks.ToString() + "|" +
                    Identity(info);
            string kind = (info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0
                ? "directory" : "file";
            string canonical = String.Equals(FinalPath(handle), path,
                StringComparison.OrdinalIgnoreCase) ? "canonical" : "redirect";
            return kind + "|" + info.NumberOfLinks.ToString() + "|" +
                Identity(info) + "|" + canonical;
        }
    }

    public static void ProtectCurrentOnlyDacl(string inputPath, bool directory) {
        string path = Path.GetFullPath(inputPath);
        using (SafeFileHandle handle = CreateFile(
            path, READ_CONTROL | WRITE_DAC,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero, OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            IntPtr.Zero)) {
            if (handle.IsInvalid)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            BY_HANDLE_FILE_INFORMATION before;
            if (!GetFileInformationByHandle(handle, out before))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if ((before.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
                (!directory && before.NumberOfLinks != 1) ||
                directory != ((before.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) ||
                !String.Equals(FinalPath(handle), path,
                    StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("gate node identity is not exact");
            FileSystemSecurity security = directory
                ? (FileSystemSecurity)new DirectorySecurity()
                : new FileSecurity();
            SecurityIdentifier current = WindowsIdentity.GetCurrent().User;
            security.SetAccessRuleProtection(true, false);
            if (directory) {
                security.AddAccessRule(new FileSystemAccessRule(
                    current, FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None, AccessControlType.Allow));
            } else {
                security.AddAccessRule(new FileSystemAccessRule(
                    current, FileSystemRights.FullControl, AccessControlType.Allow));
            }
            byte[] descriptor = security.GetSecurityDescriptorBinaryForm();
            GCHandle pinned = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
            try {
                bool present;
                bool defaulted;
                IntPtr dacl;
                if (!GetSecurityDescriptorDacl(
                        pinned.AddrOfPinnedObject(), out present, out dacl,
                        out defaulted) || !present)
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                uint result = SetSecurityInfo(handle.DangerousGetHandle(), 1,
                    DACL_SECURITY_INFORMATION |
                    PROTECTED_DACL_SECURITY_INFORMATION,
                    IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero);
                if (result != 0) throw new Win32Exception((int)result);
            } finally {
                pinned.Free();
            }
            BY_HANDLE_FILE_INFORMATION after;
            if (!GetFileInformationByHandle(handle, out after))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (Identity(before) != Identity(after) ||
                before.NumberOfLinks != after.NumberOfLinks ||
                !String.Equals(FinalPath(handle), path,
                    StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("gate node identity changed");
        }
    }

    public static string Snapshot(string inputPath) {
        string path = Path.GetFullPath(inputPath);
        using (SafeFileHandle handle = CreateFile(
            path, GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT,
            IntPtr.Zero)) {
            if (handle.IsInvalid)
                throw new Win32Exception(Marshal.GetLastWin32Error());
            BY_HANDLE_FILE_INFORMATION info;
            if (!GetFileInformationByHandle(handle, out info))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if ((info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0)
                throw new InvalidDataException("health capability is a reparse point");
            if (info.NumberOfLinks != 1)
                throw new InvalidDataException("health capability has multiple links");
            return Identity(info);
        }
    }
}

public sealed class JhtHealthPckProcess : IDisposable {
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint WAIT_OBJECT_0 = 0x00000000;
    private const uint WAIT_TIMEOUT = 0x00000102;
    private IntPtr processHandle;
    private IntPtr threadHandle;
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
        public IntPtr process; public IntPtr thread;
        public uint processId; public uint threadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName, StringBuilder commandLine,
        IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles,
        uint creationFlags, IntPtr environment, string currentDirectory,
        ref STARTUPINFO startup, out PROCESS_INFORMATION information);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint ResumeThread(IntPtr thread);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static JhtHealthPckProcess CreateCommand(
        string application, string command, string currentDirectory) {
        JhtHealthPckProcess value = new JhtHealthPckProcess();
        STARTUPINFO startup = new STARTUPINFO();
        startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
        PROCESS_INFORMATION info;
        if (!CreateProcess(application, new StringBuilder(command), IntPtr.Zero,
            IntPtr.Zero, false, CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
            IntPtr.Zero, currentDirectory, ref startup, out info))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        value.processHandle = info.process;
        value.threadHandle = info.thread;
        value.ProcessId = checked((int)info.processId);
        return value;
    }

    public static JhtHealthPckProcess Create(
        string inputPath, string logPath, bool automaticQuit) {
        string path = Path.GetFullPath(inputPath);
        string log = Path.GetFullPath(logPath);
        StringBuilder command = new StringBuilder(
            "\"" + path + "\" --headless");
        if (automaticQuit) command.Append(" --quit-after 120");
        command.Append(" --log-file \"").Append(log).Append("\"");
        return CreateCommand(path, command.ToString(), Path.GetDirectoryName(path));
    }

    public static JhtHealthPckProcess CreateExitProbe() {
        string shell = Environment.GetEnvironmentVariable("ComSpec");
        if (String.IsNullOrEmpty(shell))
            throw new InvalidOperationException("command interpreter is unavailable");
        string path = Path.GetFullPath(shell);
        return CreateCommand(path,
            "\"" + path + "\" /d /s /c \"exit /b 7\"",
            Path.GetDirectoryName(path));
    }

    public static JhtHealthPckProcess CreateExitProbeForTest(int exitCode) {
        if (exitCode < 0 || exitCode > 255)
            throw new ArgumentOutOfRangeException("exitCode");
        string shell = Environment.GetEnvironmentVariable("ComSpec");
        if (String.IsNullOrEmpty(shell))
            throw new InvalidOperationException("command interpreter is unavailable");
        string path = Path.GetFullPath(shell);
        return CreateCommand(path,
            "\"" + path + "\" /d /s /c \"exit /b " +
                exitCode.ToString() + "\"",
            Path.GetDirectoryName(path));
    }

    public void Resume() {
        if (threadHandle == IntPtr.Zero ||
            ResumeThread(threadHandle) == UInt32.MaxValue)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        CloseHandle(threadHandle);
        threadHandle = IntPtr.Zero;
    }

    public void TerminateAndWait(uint milliseconds) {
        if (processHandle == IntPtr.Zero)
            throw new ObjectDisposedException("JhtHealthPckProcess");
        uint result = WaitForSingleObject(processHandle, 0);
        if (result == WAIT_OBJECT_0) return;
        if (result != WAIT_TIMEOUT)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if (!TerminateProcess(processHandle, 1))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        result = WaitForSingleObject(processHandle, milliseconds);
        if (result == WAIT_TIMEOUT)
            throw new TimeoutException("terminated process wait timed out");
        if (result != WAIT_OBJECT_0)
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    public int WaitForExitCode(uint milliseconds) {
        if (processHandle == IntPtr.Zero)
            throw new ObjectDisposedException("JhtHealthPckProcess");
        uint result = WaitForSingleObject(processHandle, milliseconds);
        if (result == WAIT_TIMEOUT) throw new TimeoutException("process wait timed out");
        if (result != WAIT_OBJECT_0)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        uint exitCode;
        if (!GetExitCodeProcess(processHandle, out exitCode))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        return unchecked((int)exitCode);
    }

    public void Dispose() {
        if (threadHandle != IntPtr.Zero) {
            CloseHandle(threadHandle);
            threadHandle = IntPtr.Zero;
        }
        if (processHandle != IntPtr.Zero) {
            CloseHandle(processHandle);
            processHandle = IntPtr.Zero;
        }
    }
}
'@

function Set-ExactDirectorySecurity {
  param([string]$Path)
  $security = New-Object Security.AccessControl.DirectorySecurity
  $security.SetOwner($currentSid)
  $security.SetAccessRuleProtection($true, $false)
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $currentSid,
    [Security.AccessControl.FileSystemRights]::FullControl,
    ([Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [Security.AccessControl.InheritanceFlags]::ObjectInherit),
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow)
  $security.AddAccessRule($rule)
  ([IO.DirectoryInfo]::new($Path)).SetAccessControl($security)
}

function New-ExactDirectory {
  param([string]$Path)
  $null = [IO.Directory]::CreateDirectory($Path)
  Set-ExactDirectorySecurity $Path
}

function Set-ExactFileSecurity {
  param([string]$Path)
  $security = New-Object Security.AccessControl.FileSecurity
  $security.SetOwner($currentSid)
  $security.SetAccessRuleProtection($true, $false)
  $rule = [Security.AccessControl.FileSystemAccessRule]::new(
    $currentSid,
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.AccessControlType]::Allow)
  $security.AddAccessRule($rule)
  ([IO.FileInfo]::new($Path)).SetAccessControl($security)
}

function Set-HostileFileSecurity {
  param([string]$Path)
  $security = New-Object Security.AccessControl.FileSecurity
  $security.SetOwner($currentSid)
  $security.SetAccessRuleProtection($true, $false)
  $deny = [Security.AccessControl.FileSystemAccessRule]::new(
    $currentSid,
    ([Security.AccessControl.FileSystemRights]::WriteData -bor
      [Security.AccessControl.FileSystemRights]::AppendData),
    [Security.AccessControl.AccessControlType]::Deny)
  $read = [Security.AccessControl.FileSystemAccessRule]::new(
    $currentSid,
    [Security.AccessControl.FileSystemRights]::ReadAndExecute,
    [Security.AccessControl.AccessControlType]::Allow)
  $foreignWrite = [Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new('S-1-5-32-545'),
    [Security.AccessControl.FileSystemRights]::WriteData,
    [Security.AccessControl.AccessControlType]::Allow)
  $security.AddAccessRule($deny)
  $security.AddAccessRule($read)
  $security.AddAccessRule($foreignWrite)
  ([IO.FileInfo]::new($Path)).SetAccessControl($security)
}

function New-ExactFile {
  param([string]$Path, [byte[]]$Bytes)
  $stream = [IO.File]::Open(
    $Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write,
    [IO.FileShare]::None)
  try {
    $stream.Write($Bytes, 0, $Bytes.Length)
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
  }
  Set-ExactFileSecurity $Path
}

function Assert-ExactCurrentFile {
  param([string]$Path)
  $item = [IO.FileInfo]::new($Path)
  $security = $item.GetAccessControl($sections)
  $owner = $security.GetOwner(
    [Security.Principal.SecurityIdentifier])
  $rules = @($security.GetAccessRules(
    $true, $true, [Security.Principal.SecurityIdentifier]))
  if ($owner -ne $currentSid -or -not $security.AreAccessRulesProtected -or
      $rules.Count -ne 1 -or $rules[0].IsInherited -or
      $rules[0].IdentityReference -ne $currentSid -or
      $rules[0].AccessControlType -ne
        [Security.AccessControl.AccessControlType]::Allow -or
      $rules[0].FileSystemRights -ne
        [Security.AccessControl.FileSystemRights]::FullControl) {
    throw 'health capability ACL is not exact current-only'
  }
}

function Get-AuthoritySnapshot {
  param([string]$Path)
  $item = [IO.FileInfo]::new($Path)
  $security = $item.GetAccessControl($sections)
  return ([ordered]@{
    identity = [JhtHealthPckIdentity]::Snapshot($Path)
    sddl = $security.GetSecurityDescriptorSddlForm($sections)
  } | ConvertTo-Json -Compress)
}

function Get-FullSnapshot {
  param([string]$Path)
  $item = [IO.FileInfo]::new($Path)
  $security = $item.GetAccessControl($sections)
  return ([ordered]@{
    identity = [JhtHealthPckIdentity]::Snapshot($Path)
    sddl = $security.GetSecurityDescriptorSddlForm($sections)
    bytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($Path))
  } | ConvertTo-Json -Compress)
}

function Write-ExactJournal {
  param(
    [string]$Path,
    [string]$Nonce,
    [int]$CandidatePid,
    [string]$CandidateStarted)
  $value = [ordered]@{
    candidate_helper_sha256 = '1' * 64
    candidate_manifest_sha256 = '2' * 64
    candidate_pid = $CandidatePid
    candidate_sha256 = $expectedExecutableHash
    candidate_signature_sha256 = '3' * 64
    candidate_started = $CandidateStarted
    installed_sequence = 1
    installed_version = $expectedVersion
    nonce = $Nonce
    old_helper_sha256 = '4' * 64
    old_manifest_sha256 = '5' * 64
    old_sha256 = '6' * 64
    old_signature_sha256 = '7' * 64
    schema = 1
    state = 'candidate_installed'
    target_sequence = 2
    target_version = $expectedVersion
  }
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(
    (($value | ConvertTo-Json -Compress) + "`n"))
  New-ExactFile $Path $bytes
}

function Assert-NoHealthTemporary {
  param([string]$Directory)
  if (@(Get-ChildItem -LiteralPath $Directory -Recurse -Force | Where-Object {
      $_.Name -like 'health.json.tmp-*'
    }).Count -ne 0) {
    throw 'exported health consumer left a temporary file'
  }
}

function Get-GateNodeRecord {
  param([string]$Path, [string]$Root)
  $full = [IO.Path]::GetFullPath($Path)
  $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
  if (-not ($full.Equals($rootFull, [StringComparison]::OrdinalIgnoreCase) -or
      $full.StartsWith(
        $rootFull + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase))) {
    throw 'health gate node escapes the fixed root'
  }
  $parts = [JhtHealthPckIdentity]::InspectNode($full).Split('|')
  if ($parts.Count -lt 3 -or $parts[0] -ceq 'reparse') {
    throw 'health gate contains a reparse point'
  }
  if ($parts.Count -ne 4 -or $parts[3] -cne 'canonical' -or
      $parts[0] -notin @('file','directory')) {
    throw 'health gate node is not canonical'
  }
  $kind = $parts[0]
  $links = [uint32]::Parse($parts[1])
  if ($kind -ceq 'file' -and $links -ne 1) {
    throw 'health gate file has multiple links'
  }
  $item = if ($kind -ceq 'directory') {
    [IO.DirectoryInfo]::new($full)
  } else {
    [IO.FileInfo]::new($full)
  }
  $security = $item.GetAccessControl($sections)
  $owner = $security.GetOwner(
    [Security.Principal.SecurityIdentifier])
  if ($owner -ne $currentSid) { throw 'health gate node has a foreign owner' }
  $rules = @($security.GetAccessRules(
    $true, $true, [Security.Principal.SecurityIdentifier]))
  $currentPrincipalOnly = $rules.Count -ge 1
  foreach ($rule in $rules) {
    if ($rule.IdentityReference -ne $currentSid -or
        $rule.AccessControlType -ne
          [Security.AccessControl.AccessControlType]::Allow) {
      $currentPrincipalOnly = $false
    }
  }
  return [pscustomobject]@{
    Path = $full
    Kind = $kind
    Identity = $parts[2]
    Owner = $owner.Value
    Sddl = $security.GetSecurityDescriptorSddlForm($sections)
    Bytes = if ($kind -ceq 'file') {
      [Convert]::ToBase64String([IO.File]::ReadAllBytes($full))
    } else { '' }
    CurrentPrincipalOnly = $currentPrincipalOnly
  }
}

function Get-GateTreeCensus {
  param([string]$Root)
  $records = New-Object Collections.Generic.List[object]
  $pending = New-Object Collections.Generic.Stack[string]
  $rootRecord = Get-GateNodeRecord $Root $Root
  if ($rootRecord.Kind -cne 'directory') {
    throw 'health gate root is not a directory'
  }
  $records.Add($rootRecord)
  $pending.Push($rootRecord.Path)
  while ($pending.Count -gt 0) {
    $directory = [IO.DirectoryInfo]::new($pending.Pop())
    foreach ($child in @($directory.GetFileSystemInfos())) {
      $record = Get-GateNodeRecord $child.FullName $Root
      $records.Add($record)
      if ($record.Kind -ceq 'directory') { $pending.Push($record.Path) }
    }
  }
  return @($records)
}

function Assert-ExactCurrentDacl {
  param([string]$Path, [ValidateSet('file','directory')][string]$Kind)
  $item = if ($Kind -ceq 'directory') {
    [IO.DirectoryInfo]::new($Path)
  } else {
    [IO.FileInfo]::new($Path)
  }
  $security = $item.GetAccessControl($sections)
  $owner = $security.GetOwner(
    [Security.Principal.SecurityIdentifier])
  $rules = @($security.GetAccessRules(
    $true, $true, [Security.Principal.SecurityIdentifier]))
  if ($owner -ne $currentSid -or -not $security.AreAccessRulesProtected -or
      $rules.Count -ne 1 -or $rules[0].IsInherited -or
      $rules[0].IdentityReference -ne $currentSid -or
      $rules[0].AccessControlType -ne
        [Security.AccessControl.AccessControlType]::Allow -or
      $rules[0].FileSystemRights -ne
        [Security.AccessControl.FileSystemRights]::FullControl) {
    throw 'health gate DACL reset is not exact current-only'
  }
}

function Remove-GateTree {
  param([string]$Path)
  $records = @(Get-GateTreeCensus $Path)
  $hostileFull = ''
  if ($script:HostileHealthPath) {
    $hostileFull = [IO.Path]::GetFullPath($script:HostileHealthPath)
    $hostile = @($records | Where-Object {
      $_.Path.Equals($hostileFull, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($hostile.Count -ne 1 -or $hostile[0].Kind -cne 'file') {
      throw 'health gate hostile capability binding is not exact'
    }
    $hostileBefore = $script:HostileHealthSnapshot |
      ConvertFrom-Json -ErrorAction Stop
    if ($hostile[0].Identity -cne [string]$hostileBefore.identity -or
        $hostile[0].Sddl -cne [string]$hostileBefore.sddl -or
        $hostile[0].Bytes -cne [string]$hostileBefore.bytes) {
      throw 'health gate hostile capability changed before teardown'
    }
  }
  foreach ($record in $records) {
    if ($record.Path.Equals(
        $hostileFull, [StringComparison]::OrdinalIgnoreCase)) {
      continue
    }
    if (-not $record.CurrentPrincipalOnly) {
      throw 'health gate contains an unexpected DACL'
    }
    Assert-ExactCurrentDacl $record.Path $record.Kind
  }
  if ($env:JHT_TEST_HEALTH_DACL_RESET_FAILURE -ceq '1') {
    throw 'injected health gate DACL reset failure'
  }
  if ($hostileFull) {
    $record = @($records | Where-Object {
      $_.Path.Equals($hostileFull, [StringComparison]::OrdinalIgnoreCase)
    })[0]
    [JhtHealthPckIdentity]::ProtectCurrentOnlyDacl(
      $record.Path, $false)
    $after = Get-GateNodeRecord $record.Path $Path
    if ($after.Identity -cne $record.Identity -or
        $after.Owner -cne $record.Owner -or
        $after.Bytes -cne $record.Bytes) {
      throw 'health gate DACL reset changed node identity, owner, or bytes'
    }
    Assert-ExactCurrentDacl $record.Path $record.Kind
  }
  $postReset = @(Get-GateTreeCensus $Path)
  if ($postReset.Count -ne $records.Count) {
    throw 'health gate census changed during DACL reset'
  }
  foreach ($record in $records) {
    $observed = @($postReset | Where-Object {
      $_.Path.Equals($record.Path, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($observed.Count -ne 1 -or
        $observed[0].Identity -cne $record.Identity -or
        $observed[0].Owner -cne $record.Owner -or
        $observed[0].Bytes -cne $record.Bytes -or
        (-not $record.Path.Equals(
          $hostileFull, [StringComparison]::OrdinalIgnoreCase) -and
          $observed[0].Sddl -cne $record.Sddl)) {
      throw 'health gate census changed before delete'
    }
    Assert-ExactCurrentDacl $observed[0].Path $observed[0].Kind
  }
  Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
  if ([JhtHealthPckIdentity]::GetNoFollowNodeKind($Path) -ne 0) {
    throw 'exported health gate left fixture residue'
  }
}

function Restore-Environment {
  param([hashtable]$Previous)
  foreach ($name in $Previous.Keys) {
    if ($null -eq $Previous[$name]) {
      Remove-Item -LiteralPath ("Env:" + $name) -ErrorAction SilentlyContinue
    } else {
      Set-Item -LiteralPath ("Env:" + $name) -Value $Previous[$name]
    }
  }
}

function Get-ManagedExitCodeBestEffort {
  param(
    [Diagnostics.Process]$Process = $null,
    [int]$ProcessId = 0,
    [switch]$InjectFailure)
  $owned = $false
  try {
    if ($InjectFailure) { throw 'injected managed exit-code read failure' }
    if ($null -eq $Process) {
      $Process = Get-Process -Id $ProcessId -ErrorAction Stop
      $owned = $true
    }
    $Process.Refresh()
    return [int]$Process.ExitCode
  } catch {
    return -1
  } finally {
    if ($owned -and $null -ne $Process) {
      try { $Process.Dispose() } catch { }
    }
  }
}

function Invoke-HealthCase {
  param(
    [string]$Root,
    [ValidateSet('normal','positive','absent','hostile','nonce-only',
      'path-only','invalid-nonce','invalid-path','journal-absent',
      'journal-malformed','pid-mismatch','start-invalid')]
    [string]$Mode)
  $nonce = [guid]::NewGuid().ToString('N')
  $caseRoot = Join-Path $Root $Mode
  $runtimeRoot = Join-Path $caseRoot 'host-runtime'
  $nonceRoot = Join-Path $runtimeRoot $nonce
  $appData = Join-Path $caseRoot 'appdata'
  $consumerLogPath = Join-Path $caseRoot 'consumer.log'
  foreach ($directory in @($caseRoot, $runtimeRoot, $nonceRoot, $appData)) {
    New-ExactDirectory $directory
  }
  $healthPath = Join-Path $nonceRoot 'health.json'
  $journalPath = Join-Path $nonceRoot 'journal.json'
  $invalidPath = Join-Path $caseRoot 'invalid-health.json'
  $hostileBytes = [Text.UTF8Encoding]::new($false).GetBytes('hostile-capability')
  if ($Mode -ceq 'positive') {
    New-ExactFile $healthPath ([byte[]]@())
    Assert-ExactCurrentFile $healthPath
    if ([IO.FileInfo]::new($healthPath).Length -ne 0) {
      throw 'precreated health capability is not empty'
    }
    $beforeAuthority = Get-AuthoritySnapshot $healthPath
  } elseif ($Mode -ceq 'hostile') {
    New-ExactFile $healthPath $hostileBytes
    Set-HostileFileSecurity $healthPath
    $beforeCapability = Get-FullSnapshot $healthPath
    $script:HostileHealthPath = $healthPath
    $script:HostileHealthSnapshot = $beforeCapability
  } elseif ($Mode -in @('journal-absent','journal-malformed','pid-mismatch',
      'start-invalid')) {
    New-ExactFile $healthPath ([byte[]]@())
    $beforeCapability = Get-FullSnapshot $healthPath
  } elseif ($Mode -ceq 'invalid-path') {
    New-ExactFile $invalidPath $hostileBytes
    $beforeInvalid = Get-FullSnapshot $invalidPath
  }

  $previous = @{}
  foreach ($name in @('APPDATA','JHT_NOVPS','JHT_UPDATE_HEALTH_PATH',
      'JHT_UPDATE_NONCE','JHT_UPDATE_NOTICE',
      'JHT_WINDOWS_UPDATE_HEALTH_BOOT_TEST')) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name)
  }
  $env:APPDATA = $appData
  $env:JHT_NOVPS = '1'
  $env:JHT_UPDATE_NOTICE = $expectedVersion
  $env:JHT_WINDOWS_UPDATE_HEALTH_BOOT_TEST = '1'
  Remove-Item Env:JHT_UPDATE_HEALTH_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:JHT_UPDATE_NONCE -ErrorAction SilentlyContinue
  if ($Mode -notin @('normal','nonce-only')) {
    $env:JHT_UPDATE_HEALTH_PATH = if ($Mode -ceq 'invalid-path') {
      $invalidPath
    } else {
      $healthPath
    }
  }
  if ($Mode -notin @('normal','path-only')) {
    $env:JHT_UPDATE_NONCE = if ($Mode -ceq 'invalid-nonce') {
      'invalid'
    } else {
      $nonce
    }
  }

  $suspended = $null
  $process = $null
  $nativeExited = $false
  try {
    $automaticQuit = $Mode -in @('normal','positive')
    $suspended = [JhtHealthPckProcess]::Create(
      $Executable, $consumerLogPath, $automaticQuit)
    $process = Get-Process -Id $suspended.ProcessId -ErrorAction Stop
    $candidatePid = [int]$process.Id
    $started = $process.StartTime.ToUniversalTime().Ticks.ToString()
    if ($Mode -in @('positive','absent','hostile')) {
      Write-ExactJournal $journalPath $nonce $candidatePid $started
    } elseif ($Mode -ceq 'journal-malformed') {
      New-ExactFile $journalPath (
        [Text.UTF8Encoding]::new($false).GetBytes('not-json'))
    } elseif ($Mode -ceq 'pid-mismatch') {
      Write-ExactJournal $journalPath $nonce ($candidatePid + 1) $started
    } elseif ($Mode -ceq 'start-invalid') {
      Write-ExactJournal $journalPath $nonce $candidatePid 'invalid'
    }
    $suspended.Resume()
    try {
      $nativeExitCode = $suspended.WaitForExitCode(30000)
      $nativeExited = $true
    } catch [TimeoutException] {
      throw ('health case timeout mode=' + $Mode)
    }
    $managedExitCode = Get-ManagedExitCodeBestEffort -Process $process

    Assert-NoHealthTemporary $caseRoot
    if ($Mode -ceq 'positive') {
      if ((Get-AuthoritySnapshot $healthPath) -cne $beforeAuthority) {
        throw 'health consumer replaced or changed capability authority'
      }
      Assert-ExactCurrentFile $healthPath
      $frame = Get-Content -LiteralPath $healthPath -Raw |
        ConvertFrom-Json -ErrorAction Stop
      $keys = @($frame.PSObject.Properties.Name | Sort-Object)
      $expectedKeys = @('exe_path','exe_sha256','nonce','pid',
        'process_started_utc_ticks','schema','type','version') | Sort-Object
      if ($keys.Count -ne $expectedKeys.Count) {
        throw 'health frame property count is not exact'
      }
      for ($index = 0; $index -lt $expectedKeys.Count; $index++) {
        if ($keys[$index] -cne $expectedKeys[$index]) {
          throw 'health frame properties are not exact'
        }
      }
      if ([int64]$frame.schema -ne 1 -or $frame.type -cne 'healthy' -or
          $frame.nonce -cne $nonce -or $frame.version -cne $expectedVersion -or
          [int]$frame.pid -ne $candidatePid -or
          $frame.process_started_utc_ticks -cne $started -or
          $frame.exe_sha256 -cne $expectedExecutableHash -or
          -not ([IO.Path]::GetFullPath([string]$frame.exe_path)).Equals(
            $Executable, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'health frame does not match the exported consumer process'
      }
    } elseif ($Mode -ceq 'absent') {
      if (Test-Path -LiteralPath $healthPath) {
        throw 'health consumer created an absent capability'
      }
    } elseif ($Mode -in @('hostile','journal-absent','journal-malformed',
        'pid-mismatch','start-invalid') -and
        (Get-FullSnapshot $healthPath) -cne $beforeCapability) {
      throw 'health consumer mutated a hostile capability'
    } elseif ($Mode -ceq 'invalid-path' -and
        (Get-FullSnapshot $invalidPath) -cne $beforeInvalid) {
      throw 'health consumer mutated an invalid capability path'
    }

    $expectedCode = switch ($Mode) {
      'normal' { '' }
      'positive' { 'health_written' }
      'absent' { 'health_capability_absent' }
      'hostile' { 'health_capability_open_failed' }
      'nonce-only' { 'health_env_partial' }
      'path-only' { 'health_env_partial' }
      'invalid-nonce' { 'health_nonce_invalid' }
      'invalid-path' { 'health_path_invalid' }
      'journal-absent' { 'health_journal_absent' }
      'journal-malformed' { 'health_journal_invalid' }
      'pid-mismatch' { 'health_process_invalid' }
      'start-invalid' { 'health_frame_invalid' }
    }
    if (-not (Test-Path -LiteralPath $consumerLogPath -PathType Leaf)) {
      throw ('health case log missing mode=' + $Mode +
        ' native_rc=' + $nativeExitCode + ' managed_rc=' + $managedExitCode)
    }
    $consumerLog = [IO.File]::ReadAllText($consumerLogPath)
    $codeMatches = @([regex]::Matches(
      $consumerLog,
      '(?m)^WINDOWS-UPDATE-HEALTH code=([a-z_]+)\r?$'))
    if ($expectedCode -ceq '') {
      if ($codeMatches.Count -ne 0) {
        throw ('health case unexpected protocol mode=' + $Mode +
          ' native_rc=' + $nativeExitCode + ' managed_rc=' + $managedExitCode)
      }
    } elseif ($codeMatches.Count -ne 1 -or
        $codeMatches[0].Groups[1].Value -cne $expectedCode) {
      throw ('health case code mismatch mode=' + $Mode +
        ' native_rc=' + $nativeExitCode + ' managed_rc=' + $managedExitCode)
    }
    $normalWorkMatches = @([regex]::Matches(
      $consumerLog,
      '(?m)^WINDOWS-UPDATE-HEALTH-NORMAL-WORK component=' +
      '(backend|feedback|game|onboarding|setup|sfx|title|tour|update)\r?$'))
    $normalWork = @($normalWorkMatches | ForEach-Object {
      $_.Groups[1].Value
    } | Sort-Object)
    $expectedNormalWork = if ($Mode -in @('normal','positive')) {
      @('backend','feedback','game','onboarding','setup','sfx','title','tour','update')
    } else {
      @()
    }
    if (($normalWork -join ',') -cne ($expectedNormalWork -join ',')) {
      throw ('health case normal-work mismatch mode=' + $Mode +
        ' native_rc=' + $nativeExitCode + ' managed_rc=' + $managedExitCode)
    }
    $expectedExitCode = if ($Mode -in @('normal','positive')) { 0 } else { 1 }
    if ($nativeExitCode -ne $expectedExitCode) {
      throw ('health case exit mismatch mode=' + $Mode +
        ' native_rc=' + $nativeExitCode + ' managed_rc=' + $managedExitCode)
    }
    $outcome = if ($expectedCode -ceq '') { 'normal_boot' } else { $expectedCode }
    [Console]::Out.WriteLine('WINDOWS-UPDATE-HEALTH-PCK-CASE mode=' +
      $Mode + ' native_rc=' + $nativeExitCode +
      ' managed_rc=' + $managedExitCode + ' outcome=' + $outcome)
  } finally {
    try {
      if ($suspended -and -not $nativeExited) {
        $suspended.TerminateAndWait(5000)
      }
    } finally {
      if ($suspended) { $suspended.Dispose() }
      if ($process) { try { $process.Dispose() } catch { } }
      Restore-Environment $previous
    }
  }
}

$probe = $null
$probeNativeExited = $false
try {
  $probe = [JhtHealthPckProcess]::CreateExitProbe()
  $probe.Resume()
  $probeNativeExitCode = $probe.WaitForExitCode(5000)
  $probeNativeExited = $true
  $probeManagedExitCode = Get-ManagedExitCodeBestEffort `
    -ProcessId $probe.ProcessId
  if ($probeNativeExitCode -ne 7) {
    [Console]::Out.WriteLine(
      'WINDOWS-UPDATE-HEALTH-PCK-CASE mode=calibration native_rc=' +
      $probeNativeExitCode + ' managed_rc=' + $probeManagedExitCode)
    throw 'native exit-code oracle calibration failed'
  }
} finally {
  try {
    if ($probe -and -not $probeNativeExited) {
      $probe.TerminateAndWait(5000)
    }
  } finally {
    if ($probe) { $probe.Dispose() }
  }
}

$gateRoot = Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) (
  'jht-health-pck-' + [guid]::NewGuid().ToString('N'))
$script:HostileHealthPath = ''
$script:HostileHealthSnapshot = ''
$casesPassed = $false
try {
  New-ExactDirectory $gateRoot
  foreach ($mode in @('normal','positive','absent','hostile','nonce-only',
      'path-only','invalid-nonce','invalid-path','journal-absent',
      'journal-malformed','pid-mismatch','start-invalid')) {
    Invoke-HealthCase $gateRoot $mode
  }
  [Console]::Out.WriteLine('WINDOWS-UPDATE-HEALTH-PCK-CASES PASS')
  $casesPassed = $true
} finally {
  Remove-GateTree $gateRoot
}
if ($casesPassed -and
    [JhtHealthPckIdentity]::GetNoFollowNodeKind($gateRoot) -eq 0) {
  [Console]::Out.WriteLine('WINDOWS-UPDATE-HEALTH-PCK-TEST PASS')
}

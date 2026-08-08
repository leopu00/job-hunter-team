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
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class JhtHealthPckIdentity {
    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_SHARE_DELETE = 0x00000004;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
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
            return info.VolumeSerialNumber.ToString("x8") + ":" +
                info.FileIndexHigh.ToString("x8") +
                info.FileIndexLow.ToString("x8");
        }
    }
}

public sealed class JhtHealthPckProcess : IDisposable {
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
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

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    public static JhtHealthPckProcess Create(string inputPath, string logPath) {
        string path = Path.GetFullPath(inputPath);
        string log = Path.GetFullPath(logPath);
        JhtHealthPckProcess value = new JhtHealthPckProcess();
        STARTUPINFO startup = new STARTUPINFO();
        startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
        PROCESS_INFORMATION info;
        StringBuilder command = new StringBuilder(
            "\"" + path + "\" --headless --quit-after 120 --log-file \"" +
            log + "\"");
        if (!CreateProcess(path, command, IntPtr.Zero, IntPtr.Zero, false,
            CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, IntPtr.Zero,
            Path.GetDirectoryName(path), ref startup, out info))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        value.processHandle = info.process;
        value.threadHandle = info.thread;
        value.ProcessId = checked((int)info.processId);
        return value;
    }

    public void Resume() {
        if (threadHandle == IntPtr.Zero ||
            ResumeThread(threadHandle) == UInt32.MaxValue)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        CloseHandle(threadHandle);
        threadHandle = IntPtr.Zero;
    }

    public void Terminate() {
        if (processHandle != IntPtr.Zero) TerminateProcess(processHandle, 1);
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

function Remove-GateTree {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
  $nodes = @(Get-ChildItem -LiteralPath $Path -Recurse -Force |
    Sort-Object { $_.FullName.Length } -Descending)
  foreach ($node in $nodes) {
    if (($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw 'exported health gate produced an unexpected reparse point'
    }
    if ($node -is [IO.FileInfo]) {
      Set-ExactFileSecurity $node.FullName
    } elseif ($node -is [IO.DirectoryInfo]) {
      Set-ExactDirectorySecurity $node.FullName
    }
  }
  Set-ExactDirectorySecurity $Path
  Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
  if (Test-Path -LiteralPath $Path) {
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
  try {
    $suspended = [JhtHealthPckProcess]::Create($Executable, $consumerLogPath)
    $process = Get-Process -Id $suspended.ProcessId -ErrorAction Stop
    $started = $process.StartTime.ToUniversalTime().Ticks.ToString()
    if ($Mode -in @('positive','absent','hostile')) {
      Write-ExactJournal $journalPath $nonce $process.Id $started
    } elseif ($Mode -ceq 'journal-malformed') {
      New-ExactFile $journalPath (
        [Text.UTF8Encoding]::new($false).GetBytes('not-json'))
    } elseif ($Mode -ceq 'pid-mismatch') {
      Write-ExactJournal $journalPath $nonce ($process.Id + 1) $started
    } elseif ($Mode -ceq 'start-invalid') {
      Write-ExactJournal $journalPath $nonce $process.Id 'invalid'
    }
    $suspended.Resume()
    if (-not $process.WaitForExit(30000)) {
      throw ('health case timeout mode=' + $Mode)
    }
    $consumerExitCode = [int]$process.ExitCode

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
          [int]$frame.pid -ne $process.Id -or
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
    $expectedExitCode = if ($Mode -in @('normal','positive')) { 0 } else { 1 }
    if ($consumerExitCode -ne $expectedExitCode) {
      throw ('health case exit mismatch mode=' + $Mode +
        ' consumer_rc=' + $consumerExitCode)
    }
    if (-not (Test-Path -LiteralPath $consumerLogPath -PathType Leaf)) {
      throw ('health case log missing mode=' + $Mode +
        ' consumer_rc=' + $consumerExitCode)
    }
    $consumerLog = [IO.File]::ReadAllText($consumerLogPath)
    $codeMatches = @([regex]::Matches(
      $consumerLog,
      '(?m)^WINDOWS-UPDATE-HEALTH code=([a-z_]+)\r?$'))
    if ($expectedCode -ceq '') {
      if ($codeMatches.Count -ne 0) {
        throw ('health case unexpected protocol mode=' + $Mode +
          ' consumer_rc=' + $consumerExitCode)
      }
    } elseif ($codeMatches.Count -ne 1 -or
        $codeMatches[0].Groups[1].Value -cne $expectedCode) {
      throw ('health case code mismatch mode=' + $Mode +
        ' consumer_rc=' + $consumerExitCode)
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
        ' consumer_rc=' + $consumerExitCode)
    }
    $outcome = if ($expectedCode -ceq '') { 'normal_boot' } else { $expectedCode }
    [Console]::Out.WriteLine('WINDOWS-UPDATE-HEALTH-PCK-CASE mode=' +
      $Mode + ' consumer_rc=' + $consumerExitCode + ' outcome=' + $outcome)
  } finally {
    if ($process -and -not $process.HasExited) {
      try { $process.Kill(); $null = $process.WaitForExit(5000) } catch { }
    }
    if ($suspended) { $suspended.Dispose() }
    if ($process) { $process.Dispose() }
    Restore-Environment $previous
  }
}

$gateRoot = Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) (
  'jht-health-pck-' + [guid]::NewGuid().ToString('N'))
try {
  New-ExactDirectory $gateRoot
  foreach ($mode in @('normal','positive','absent','hostile','nonce-only',
      'path-only','invalid-nonce','invalid-path','journal-absent',
      'journal-malformed','pid-mismatch','start-invalid')) {
    Invoke-HealthCase $gateRoot $mode
  }
  [Console]::Out.WriteLine('WINDOWS-UPDATE-HEALTH-PCK-TEST PASS')
} finally {
  Remove-GateTree $gateRoot
}

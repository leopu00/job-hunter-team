# ponte urgente T205/T214, da sostituire con il sidecar Rust
# Only process deadlines, bounded capture and the shared machine-start boundary live here.

if (-not ('JhtPodmanBridgeCapture' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// The job is private to one invocation. A suspended child cannot escape before assignment.
public sealed class JhtPodmanOwnedProcess : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct Security { public int size; public IntPtr descriptor; public int inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
        public int cb; public string reserved, desktop, title;
        public uint x,y,width,height,xChars,yChars,fill,flags; public short show,reservedSize;
        public IntPtr reservedBytes,input,output,error;
    }
    [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup startup; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] struct Created { public IntPtr process,thread; public uint pid,tid; }
    [StructLayout(LayoutKind.Sequential)] struct Accounting {
        public long user,kernel,periodUser,periodKernel;
        public uint faults,total,active,terminated;
    }
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting info,int length,IntPtr returned);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref Security attributes,int size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateFile(string name,uint access,uint share,ref Security attributes,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcess(string file,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string directory,ref StartupEx startup,out Created created);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint code);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    IntPtr job,attributes,handleList; Created child; bool assigned,attributesReady;
    public Process Process { get; private set; }
    public StreamReader Output { get; private set; }
    public StreamReader Error { get; private set; }
    public bool HasProcess { get { return child.process != IntPtr.Zero; } }
    static void Check(bool success) { if (!success) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
    static void Close(ref IntPtr handle) { if (handle!=IntPtr.Zero && handle!=new IntPtr(-1)) CloseHandle(handle); handle=IntPtr.Zero; }
    public JhtPodmanOwnedProcess() {
        job=CreateJobObject(IntPtr.Zero,null);
        if (job==IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    static StreamReader Pipe(ref Security security,out IntPtr writer) {
        IntPtr reader; Check(CreatePipe(out reader,out writer,ref security,0));
        var owned=new SafeFileHandle(reader,true);
        try {
            Check(SetHandleInformation(reader,1,0));
            return new StreamReader(new FileStream(owned,FileAccess.Read,4096,false),new UTF8Encoding(false),true,4096);
        } catch { owned.Dispose(); throw; }
    }
    void InheritOnly(IntPtr input,IntPtr output,IntPtr error) {
        IntPtr size=IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
        if (size==IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        attributes=Marshal.AllocHGlobal(size);
        Check(InitializeProcThreadAttributeList(attributes,1,0,ref size)); attributesReady=true;
        handleList=Marshal.AllocHGlobal(3*IntPtr.Size);
        Marshal.WriteIntPtr(handleList,0,input); Marshal.WriteIntPtr(handleList,IntPtr.Size,output); Marshal.WriteIntPtr(handleList,2*IntPtr.Size,error);
        Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handleList,new IntPtr(3*IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
    }
    public void Start(string file,string arguments) {
        if (HasProcess) throw new InvalidOperationException("An owned process can only be started once.");
        if (file.IndexOf('"')>=0) throw new ArgumentException("Invalid executable path.");
        var security=new Security { size=Marshal.SizeOf(typeof(Security)),inherit=1 };
        IntPtr output=IntPtr.Zero,error=IntPtr.Zero,input=IntPtr.Zero;
        try {
            Output=Pipe(ref security,out output); Error=Pipe(ref security,out error);
            input=CreateFile("NUL",0x80000000,3,ref security,3,0x80,IntPtr.Zero);
            if (input==new IntPtr(-1)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            InheritOnly(input,output,error);
            var startup=new StartupEx { startup=new Startup { cb=Marshal.SizeOf(typeof(StartupEx)),flags=0x100,input=input,output=output,error=error },attributes=attributes };
            Check(CreateProcess(file,new StringBuilder("\""+file+"\" "+arguments),IntPtr.Zero,IntPtr.Zero,true,0x08080004,IntPtr.Zero,null,ref startup,out child));
            Check(AssignProcessToJobObject(job,child.process)); assigned=true;
            Process=System.Diagnostics.Process.GetProcessById((int)child.pid);
            if (Process.Handle==IntPtr.Zero) throw new InvalidOperationException("The owned process handle is missing.");
            if (ResumeThread(child.thread)==UInt32.MaxValue) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        } finally {
            Close(ref input); Close(ref output); Close(ref error); Close(ref child.thread);
            if (attributesReady) DeleteProcThreadAttributeList(attributes);
            if (attributes!=IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            if (handleList!=IntPtr.Zero) Marshal.FreeHGlobal(handleList);
            attributes=IntPtr.Zero; handleList=IntPtr.Zero; attributesReady=false;
        }
    }
    bool Empty() {
        Accounting info; Check(QueryInformationJobObject(job,1,out info,Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero));
        return info.active==0;
    }
    public bool Stop(int milliseconds) {
        if (!HasProcess) return true;
        try {
            var watch=Stopwatch.StartNew();
            // Before assignment, the initial thread is still suspended and has no children.
            if (!assigned) return (WaitForSingleObject(child.process,0)==0 || TerminateProcess(child.process,124)) && WaitForSingleObject(child.process,(uint)milliseconds)==0;
            if (Empty()) return true;
            Check(TerminateJobObject(job,124));
            do {
                if (Empty()) return true;
                System.Threading.Thread.Sleep(10);
            } while (watch.ElapsedMilliseconds<milliseconds);
            return Empty();
        } catch { return false; }
    }
    public void Dispose() {
        // No KILL_ON_JOB_CLOSE: successful commands may leave a permitted helper running.
        if (Output!=null) Output.Dispose(); if (Error!=null) Error.Dispose();
        if (Process!=null) Process.Dispose(); Close(ref child.thread); Close(ref child.process); Close(ref job);
    }
}

public sealed class JhtPodmanBridgeCapture {
    private readonly object gate = new object();
    private readonly StringBuilder output = new StringBuilder();
    private readonly StringBuilder error = new StringBuilder();
    private readonly StreamReader outputReader;
    private readonly StreamReader errorReader;
    private volatile bool closing;
    public volatile bool Truncated;
    public volatile bool ReadFailed;
    public Task OutputDone { get; private set; }
    public Task ErrorDone { get; private set; }
    public JhtPodmanBridgeCapture(Process process) {
        outputReader = process.StandardOutput; errorReader = process.StandardError;
        OutputDone = Read(outputReader, output); ErrorDone = Read(errorReader, error);
    }
    public JhtPodmanBridgeCapture(StreamReader stdout,StreamReader stderr) {
        outputReader = stdout; errorReader = stderr;
        OutputDone = Read(outputReader, output);
        ErrorDone = Read(errorReader, error);
    }
    private async Task Read(StreamReader reader, StringBuilder kept) {
        char[] buffer = new char[4096];
        try {
            for (;;) {
                int count = await reader.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
                if (count == 0) return;
                lock (gate) {
                    if (closing) return;
                    int room = Math.Max(0, 262144 - kept.Length);
                    if (count > room) Truncated = true;
                    kept.Append(buffer, 0, Math.Min(count, room));
                }
            }
        } catch (IOException) { lock (gate) { if (!closing) ReadFailed = true; } }
          catch (ObjectDisposedException) { lock (gate) { if (!closing) ReadFailed = true; } }
    }
    public string Stdout { get { lock (gate) { return output.ToString(); } } }
    public string Stderr { get { lock (gate) { return error.ToString(); } } }
    public JhtPodmanBridgeSnapshot Freeze() {
        lock (gate) {
            closing = true;
            return new JhtPodmanBridgeSnapshot(output.ToString(), error.ToString(), Truncated, ReadFailed,
                OutputDone.IsCompleted && ErrorDone.IsCompleted);
        }
    }
    public void Close() {
        lock (gate) { closing = true; }
        outputReader.Dispose(); errorReader.Dispose();
    }
}
public sealed class JhtPodmanBridgeSnapshot {
    public readonly string Stdout, Stderr;
    public readonly bool Truncated, ReadFailed, OutputComplete;
    public JhtPodmanBridgeSnapshot(string stdout, string stderr, bool truncated, bool readFailed, bool complete) {
        Stdout = stdout; Stderr = stderr; Truncated = truncated; ReadFailed = readFailed; OutputComplete = complete;
    }
}
'@
}

# A line every few seconds while a long command runs, from a timer thread of its own: a PowerShell
# pipeline that waits for a native program (the image pull) cannot print while it waits. Plain
# Console.Out lines (the installer's output reaches a person through the same pipe), ASCII only,
# and nothing after Dispose returns. C# 5: this compiles in Windows PowerShell 5.1 too.
if (-not ('JhtLiveWait' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Threading;

public sealed class JhtLiveWait : IDisposable {
    private readonly object gate = new object();
    private readonly Stopwatch watch = Stopwatch.StartNew();
    private readonly Timer timer;
    private readonly string label;
    private string detail = "";
    private bool stopped;
    public JhtLiveWait(string label, int seconds) {
        this.label = label;
        int milliseconds = Math.Max(1, seconds) * 1000;
        timer = new Timer(Tick, null, milliseconds, milliseconds);
    }
    public string Detail {
        get { lock (gate) { return detail; } }
        set { lock (gate) { detail = value ?? ""; } }
    }
    public static string Format(TimeSpan span) {
        long seconds = (long)span.TotalSeconds;
        if (seconds >= 3600) return String.Format("{0}:{1:00}:{2:00}", seconds / 3600, (seconds / 60) % 60, seconds % 60);
        return String.Format("{0}:{1:00}", seconds / 60, seconds % 60);
    }
    private void Tick(object state) {
        lock (gate) {
            if (stopped) return;
            string line = "  ... " + label + " (" + Format(watch.Elapsed) + (detail.Length > 0 ? ", " + detail : "") + ")";
            try { Console.Out.WriteLine(line); } catch (Exception) { }
        }
    }
    public void Dispose() {
        lock (gate) { stopped = true; }
        timer.Dispose();
    }
}
'@
}

function ConvertTo-JhtPodmanNativeArguments {
  param([AllowEmptyCollection()][AllowEmptyString()][string[]]$Arguments)
  # Windows argv quoting, including embedded quotes and backslashes before the closing quote (.NET Framework/PS5.1).
  return (@($Arguments | ForEach-Object {
    '"' + [regex]::Replace($_, '(\\*)("|$)', {
      param($match)
      $doubled = $match.Groups[1].Value + $match.Groups[1].Value
      if ($match.Groups[2].Value -eq '"') { $doubled + '\"' } else { $doubled }
    }) + '"'
  }) -join ' ')
}

function Write-JhtPodmanBridgeEvent {
  param(
    [Parameter(Mandatory)][ValidatePattern('^podman_machine_[a-z_]+$')][string]$Phase,
    [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9_]{0,95}$')][string]$Code,
    [long]$ElapsedMilliseconds = 0, [Nullable[int]]$ExitCode = $null, [string]$LogPath = ''
  )
  try {
    if (-not $LogPath) { $LogPath = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ai.jobhunterteam.desktop\logs\runtime.log' }
    $directory = Split-Path -LiteralPath $LogPath
    [void][IO.Directory]::CreateDirectory($directory)
    foreach ($node in @($directory, $LogPath)) {
      if (Test-Path -LiteralPath $node) {
        if (((Get-Item -LiteralPath $node -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Log path is a link.' }
      }
    }
    $exit = if ($null -eq $ExitCode) { '' } else { " exit=$ExitCode" }
    $entry = "=== $([DateTime]::UtcNow.ToString('o')) ${Phase}: $Code elapsed_ms=$ElapsedMilliseconds$exit`n"
    [IO.File]::AppendAllText($LogPath, $entry, [Text.UTF8Encoding]::new($false))
  } catch {
    Write-Error -Message 'runtime_log_failed: The runtime log could not be written.' -ErrorAction Continue
  }
}

function Stop-JhtPodmanProcessTree {
  param([Diagnostics.Process]$Process, [JhtPodmanOwnedProcess]$Owner = $null)
  if ($Owner) { return $Owner.Stop(5000) }
  # Outside Windows no job-tree guarantee is available; never report a clean tree.
  try { if ($Process -and -not $Process.HasExited) { $Process.Kill(); [void]$Process.WaitForExit(1000) } } catch { }
  return $false
}

function Invoke-JhtPodmanProcess {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Arguments,
    [Parameter(Mandatory)][ValidatePattern('^podman_machine_[a-z_]+$')][string]$Phase,
    [ValidateRange(1, 600000)][int]$TimeoutMilliseconds = 300000,
    [string]$LogPath = '', [switch]$RequireCompleteOutput
  )
  $process = New-Object Diagnostics.Process
  $capture = $null
  $owned = $null
  $started = $false
  $watch = [Diagnostics.Stopwatch]::StartNew()
  try {
    $process.StartInfo.FileName = $FilePath
    $process.StartInfo.Arguments = ConvertTo-JhtPodmanNativeArguments -Arguments $Arguments
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    $process.StartInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false)
    $process.StartInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false)
    if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
      $owned = [JhtPodmanOwnedProcess]::new()
      $owned.Start($FilePath, $process.StartInfo.Arguments)
      $process.Dispose(); $process = $owned.Process; $started = $true
      $capture = [JhtPodmanBridgeCapture]::new($owned.Output, $owned.Error)
    } else { $started = $process.Start(); $capture = [JhtPodmanBridgeCapture]::new($process) }
    $remaining = [Math]::Max(0, $TimeoutMilliseconds - [int]$watch.ElapsedMilliseconds)
    if (-not $process.WaitForExit($remaining)) {
      $clean = Stop-JhtPodmanProcessTree -Process $process -Owner $owned
      $code = if ($clean) { 'podman_machine_timeout' } else { 'podman_machine_cleanup_failed' }
      Write-JhtPodmanBridgeEvent -Phase $Phase -Code $code -ElapsedMilliseconds $watch.ElapsedMilliseconds -LogPath $LogPath
      $global:LASTEXITCODE = 124
      $detail = if ($clean) { 'The installer stopped this command. Check WSL before trying again.' } else { 'The process tree could not be stopped cleanly. Restart Windows before trying again.' }
      $failure = [TimeoutException]::new("${code}: Podman did not respond in time. Phase: $Phase. $detail")
      $failure.Data['Code'] = $code
      $failure.Data['Phase'] = $Phase
      throw $failure
    }
    # A successfully started machine can leave a helper holding its pipes. Never wait indefinitely for EOF.
    $remaining = [Math]::Max(0, [Math]::Min(2000, $TimeoutMilliseconds - [int]$watch.ElapsedMilliseconds))
    [void][Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($capture.OutputDone, $capture.ErrorDone), $remaining)
    $snapshot = $capture.Freeze()
    if ($snapshot.Truncated -or $snapshot.ReadFailed -or ($RequireCompleteOutput -and -not $snapshot.OutputComplete)) {
      throw (New-JhtPodmanCommandFailure -Process $process -Owner $owned -Started $started -Phase $Phase -ElapsedMilliseconds $watch.ElapsedMilliseconds -LogPath $LogPath)
    }
    $global:LASTEXITCODE = $process.ExitCode
    return [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $snapshot.Stdout; Stderr = $snapshot.Stderr; OutputComplete = $snapshot.OutputComplete; ElapsedMilliseconds = $watch.ElapsedMilliseconds }
  } catch {
    if ($_.Exception.Data['Code'] -in @('podman_machine_timeout', 'podman_machine_cleanup_failed', 'podman_machine_command_failed')) { throw }
    throw (New-JhtPodmanCommandFailure -Process $process -Owner $owned -Started $started -Phase $Phase -ElapsedMilliseconds $watch.ElapsedMilliseconds -LogPath $LogPath)
  } finally {
    if ($capture) { $capture.Close() }
    $process.Dispose()
    if ($owned) { $owned.Dispose() }
  }
}

function New-JhtPodmanCommandFailure {
  param([Diagnostics.Process]$Process, [JhtPodmanOwnedProcess]$Owner, [bool]$Started, [string]$Phase, [long]$ElapsedMilliseconds, [string]$LogPath)
  $code = 'podman_machine_command_failed'
  if ($Owner -and $Owner.HasProcess) {
    if (-not (Stop-JhtPodmanProcessTree -Process $Process -Owner $Owner)) { $code = 'podman_machine_cleanup_failed' }
  } elseif ($Started) {
    try {
      if (-not $Process.HasExited -and -not (Stop-JhtPodmanProcessTree -Process $Process)) { $code = 'podman_machine_cleanup_failed' }
    } catch { $code = 'podman_machine_cleanup_failed' }
  }
  Write-JhtPodmanBridgeEvent -Phase $Phase -Code $code -ElapsedMilliseconds $ElapsedMilliseconds -LogPath $LogPath
  $global:LASTEXITCODE = if ($code -eq 'podman_machine_cleanup_failed') { 124 } else { 1 }
  $failure = [InvalidOperationException]::new("${code}: The Podman command could not be completed safely. Phase: $Phase.")
  $failure.Data['Code'] = $code
  $failure.Data['Phase'] = $Phase
  return $failure
}

# Whether a person reads this output, as the enabler and the installer decide it (JHT_MACHINE_OUTPUT=1
# is the desktop app reading through a pipe, =0 a person); unset, it follows whether the output is redirected.
function Test-JhtHumanOutput {
  if ($env:JHT_MACHINE_OUTPUT -eq '1') { return $false }
  if ($env:JHT_MACHINE_OUTPUT -eq '0') { return $true }
  return (-not [Console]::IsOutputRedirected)
}

# The "still doing it" line for a long wait, for a person only (the app has its own phases). The seconds
# between two lines are 10, or JHT_LIVE_WAIT_SECONDS (1 to 60, ASCII digits) for the tests.
function Start-JhtLiveWait {
  param([Parameter(Mandatory)][string]$Label)
  if (-not (Test-JhtHumanOutput)) { return $null }
  $seconds = 10
  if ($env:JHT_LIVE_WAIT_SECONDS -cmatch '^[0-9]{1,2}$' -and [int]$env:JHT_LIVE_WAIT_SECONDS -ge 1 -and [int]$env:JHT_LIVE_WAIT_SECONDS -le 60) { $seconds = [int]$env:JHT_LIVE_WAIT_SECONDS }
  return [JhtLiveWait]::new($Label, $seconds)
}

# What Podman says that only worries a person who reads it: the size of a terminal it does not have.
function Test-JhtPodmanNoiseLine {
  param([AllowNull()][string]$Line)
  return ($null -ne $Line -and $Line -match 'screen size is bogus')
}

function Get-JhtPodmanTextLines {
  param([AllowNull()][string]$Text)
  if (-not $Text) { return @() }
  return @([regex]::Split($Text, '\r?\n') | ForEach-Object { ([string]$_).TrimEnd() } | Where-Object { $_ -and -not (Test-JhtPodmanNoiseLine $_) })
}

# What a person reads is in their language: the wrapper's (Get-JhtTextLanguage) when this file is dot-sourced there, else JHT_LANG,
# which the installer gives the enabler (the person's language, the one it writes in host.env), else English. The block below is made
# from shared/locales (python3 tests/bridge_ps1_texts.py --write), in ASCII for Windows PowerShell 5.1; a test fails when the two
# differ. A key a language lacks says the English of the call. Own names: this file is dot-sourced into other scripts.
function Get-BridgeTextLanguage {
  if (Get-Command Get-JhtTextLanguage -CommandType Function -ErrorAction SilentlyContinue) { return [string](Get-JhtTextLanguage) }
  $asked = ([string]$env:JHT_LANG).ToLowerInvariant() -replace '[-_.@].*$', ''
  if (@('en', 'it', 'de', 'fr', 'es', 'hu', 'pt') -ccontains $asked) { return $asked }
  return 'en'
}

function Get-BridgeText {
  param([string]$Key, [string]$English)
  $text = Get-BridgeTextTable (Get-BridgeTextLanguage) $Key
  if ($null -eq $text) { return $English }
  return $text
}

# The same, with the values put in for %s/%d in order (never -f: a { in a text breaks nothing).
function Format-BridgeText {
  param([string]$Key, [string]$English, [Parameter(ValueFromRemainingArguments = $true)][object[]]$Values)
  $text = Get-BridgeText $Key $English
  $out = New-Object System.Text.StringBuilder
  $at = 0
  $next = 0
  foreach ($match in [regex]::Matches($text, '%[sd]')) {
    [void]$out.Append($text.Substring($at, $match.Index - $at))
    if ($null -ne $Values -and $next -lt $Values.Count) { [void]$out.Append([string]$Values[$next]) }
    $next++
    $at = $match.Index + $match.Length
  }
  [void]$out.Append($text.Substring($at))
  return $out.ToString()
}

# >>> texts in the 7 languages, made from shared/locales by `python3 tests/bridge_ps1_texts.py --write`: do not edit by hand
function Get-BridgeTextTable {
  param([string]$Lang, [string]$Key)
  switch -CaseSensitive ("$Lang`:$Key") {
    'en:podman_machine.init' { return 'Creating the Linux machine for Podman: it downloads its system image (several hundred MB) and sets it up. This takes several minutes.' }
    'en:podman_machine.init_wait' { return 'still creating the Linux machine' }
    'en:podman_machine.layers_started' { return '%s layers started' }
    'en:podman_machine.legacy_docker_not_started' { return 'Docker Desktop was not started; no legacy volume was enumerated.' }
    'en:podman_machine.legacy_mail_password' { return 'If the old game stored a mail password, rotate that app password after startup; the broker migration will keep warning until setup is renewed.' }
    'en:podman_machine.legacy_reused' { return 'Existing JHT config, profile and Codex login will be reused in Podman; Documents stay in their current folder.' }
    'en:podman_machine.legacy_volumes_left' { return 'Legacy v0.3.9 volumes left in Docker Desktop: %s.' }
    'en:podman_machine.legacy_volumes_not_copied' { return 'Those Docker volumes are not copied to Podman and remain in Docker Desktop for manual removal after the upgrade is verified.' }
    'en:podman_machine.legacy_volumes_reinstallable' { return 'JHT v0.3.9 Docker volumes contain only reinstallable provider CLI/cache (jht-deps) and an empty runtime mask; config, profile, provider login and documents are in ~/.jht and Documents.' }
    'en:podman_machine.legacy_volumes_untouched' { return 'Additional JHT Docker volumes were left untouched and were not migrated: %s.' }
    'en:podman_machine.pull' { return 'Downloading the Job Hunter Team runtime image: this can take several minutes.' }
    'en:podman_machine.pull_wait' { return 'still downloading the runtime image' }
    'en:podman_machine.start' { return 'Starting the Linux machine (about a minute).' }
    'en:podman_machine.start_wait' { return 'still starting the Linux machine' }
    'en:podman_machine.stop' { return 'Stopping the Linux machine.' }
    'en:podman_machine.stop_wait' { return 'still stopping the Linux machine' }
    'en:podman_machine.team_restarts' { return 'The team restarts on the new version of its runtime.' }
    'en:podman_machine.wsl_added' { return 'WSL settings added to %s:' }
    'en:podman_machine.wsl_applying' { return 'Applying the memory limit to WSL: the machine waits for WSL to restart (about a minute).' }
    'en:podman_machine.wsl_limit_waits' { return 'WSL is already running: the memory limit applies from the next restart of Windows, or of WSL (wsl --shutdown stops all your WSL distributions, so it is not done for you).' }
    'en:podman_machine.wsl_no_limit' { return 'WSL memory: no limit was set, because other WSL distributions are registered and a limit would apply to them too.' }
    'en:podman_machine.wsl_set_yourself' { return 'To set one yourself: in %s, under [wsl2], add memory=%s (it applies after the next restart of Windows or of WSL).' }
    'en:podman_machine.wsl_undo' { return 'To undo it: jht uninstall takes these lines out, or delete them by hand (each has a comment line above it).' }
    'it:podman_machine.init' { return 'Creo la macchina Linux per Podman: scarica la sua immagine di sistema (alcune centinaia di MB) e la prepara. Ci vuole qualche minuto.' }
    'it:podman_machine.init_wait' { return 'sto ancora creando la macchina Linux' }
    'it:podman_machine.layers_started' { return '%s strati iniziati' }
    'it:podman_machine.legacy_docker_not_started' { return ('Docker Desktop non ' + [char]0x00E8 + ' stato avviato: nessun volume vecchio ' + [char]0x00E8 + ' stato elencato.') }
    'it:podman_machine.legacy_mail_password' { return ('Se la versione precedente aveva salvato una password della posta, cambia quella password per app dopo l''avvio: l''avviso resta finch' + [char]0x00E9 + ' non rifai il setup.') }
    'it:podman_machine.legacy_reused' { return ('La configurazione, il profilo e il login di Codex che hai gi' + [char]0x00E0 + ' vengono usati anche con Podman; i Documenti restano nella loro cartella.') }
    'it:podman_machine.legacy_volumes_left' { return 'Volumi della v0.3.9 rimasti in Docker Desktop: %s.' }
    'it:podman_machine.legacy_volumes_not_copied' { return 'Quei volumi Docker non vengono copiati in Podman e restano in Docker Desktop: puoi toglierli a mano quando hai visto che l''aggiornamento funziona.' }
    'it:podman_machine.legacy_volumes_reinstallable' { return 'I volumi Docker della v0.3.9 contengono solo programmi reinstallabili dei provider (jht-deps) e una cartella vuota; configurazione, profilo, login e documenti stanno in ~/.jht e in Documenti.' }
    'it:podman_machine.legacy_volumes_untouched' { return 'Altri volumi Docker di JHT sono stati lasciati come sono e non sono stati migrati: %s.' }
    'it:podman_machine.pull' { return ('Scarico l''immagine di Job Hunter Team: pu' + [char]0x00F2 + ' volerci qualche minuto.') }
    'it:podman_machine.pull_wait' { return 'sto ancora scaricando l''immagine' }
    'it:podman_machine.start' { return 'Avvio la macchina Linux (circa un minuto).' }
    'it:podman_machine.start_wait' { return 'sto ancora avviando la macchina Linux' }
    'it:podman_machine.stop' { return 'Fermo la macchina Linux.' }
    'it:podman_machine.stop_wait' { return 'sto ancora fermando la macchina Linux' }
    'it:podman_machine.team_restarts' { return 'La squadra riparte sulla nuova versione del suo ambiente.' }
    'it:podman_machine.wsl_added' { return 'Impostazioni di WSL aggiunte a %s:' }
    'it:podman_machine.wsl_applying' { return 'Applico il limite di memoria a WSL: la macchina aspetta che WSL si riavvii (circa un minuto).' }
    'it:podman_machine.wsl_limit_waits' { return ('WSL ' + [char]0x00E8 + ' gi' + [char]0x00E0 + ' acceso: il limite di memoria vale dal prossimo riavvio di Windows o di WSL (wsl --shutdown ferma tutte le tue distribuzioni WSL, per questo non lo faccio io).') }
    'it:podman_machine.wsl_no_limit' { return ('Memoria di WSL: nessun limite impostato, perch' + [char]0x00E9 + ' ci sono altre distribuzioni WSL registrate e il limite varrebbe anche per loro.') }
    'it:podman_machine.wsl_set_yourself' { return 'Per impostarlo tu: in %s, sotto [wsl2], aggiungi memory=%s (vale dal prossimo riavvio di Windows o di WSL).' }
    'it:podman_machine.wsl_undo' { return 'Per toglierle: jht uninstall toglie queste righe, oppure cancellale a mano (ognuna ha sopra una riga di commento).' }
    'hu:podman_machine.init' { return ('L' + [char]0x00E9 + 'trehozom a Podman Linux-g' + [char]0x00E9 + 'p' + [char]0x00E9 + 't: let' + [char]0x00F6 + 'lti a rendszerk' + [char]0x00E9 + 'p' + [char]0x00E9 + 't (n' + [char]0x00E9 + 'h' + [char]0x00E1 + 'ny sz' + [char]0x00E1 + 'z MB) ' + [char]0x00E9 + 's be' + [char]0x00E1 + 'll' + [char]0x00ED + 'tja. Ez n' + [char]0x00E9 + 'h' + [char]0x00E1 + 'ny percig tart.') }
    'hu:podman_machine.init_wait' { return ('m' + [char]0x00E9 + 'g tart a Linux-g' + [char]0x00E9 + 'p l' + [char]0x00E9 + 'trehoz' + [char]0x00E1 + 'sa') }
    'hu:podman_machine.layers_started' { return ('%s r' + [char]0x00E9 + 'teg elkezdve') }
    'hu:podman_machine.legacy_docker_not_started' { return ('A Docker Desktop nem indult el: egyetlen r' + [char]0x00E9 + 'gi k' + [char]0x00F6 + 'tet sem lett list' + [char]0x00E1 + 'zva.') }
    'hu:podman_machine.legacy_mail_password' { return ('Ha az el' + [char]0x0151 + 'z' + [char]0x0151 + ' verzi' + [char]0x00F3 + ' levelez' + [char]0x00E9 + 'si jelsz' + [char]0x00F3 + 't mentett, ind' + [char]0x00ED + 't' + [char]0x00E1 + 's ut' + [char]0x00E1 + 'n cser' + [char]0x00E9 + 'ld le azt az alkalmaz' + [char]0x00E1 + 'sjelsz' + [char]0x00F3 + 't: a figyelmeztet' + [char]0x00E9 + 's addig marad, am' + [char]0x00ED + 'g ' + [char]0x00FA + 'jra el nem v' + [char]0x00E9 + 'gzed a be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'st.') }
    'hu:podman_machine.legacy_reused' { return ('A megl' + [char]0x00E9 + 'v' + [char]0x0151 + ' be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'saidat, profilodat ' + [char]0x00E9 + 's Codex-bejelentkez' + [char]0x00E9 + 'sedet a Podman is haszn' + [char]0x00E1 + 'lja; a Dokumentumok a hely' + [char]0x00FC + 'k' + [char]0x00F6 + 'n maradnak.') }
    'hu:podman_machine.legacy_volumes_left' { return ('A Docker Desktopban maradt v0.3.9 k' + [char]0x00F6 + 'tetek: %s.') }
    'hu:podman_machine.legacy_volumes_not_copied' { return ('Ezeket a Docker-k' + [char]0x00F6 + 'teteket nem m' + [char]0x00E1 + 'soljuk ' + [char]0x00E1 + 't a Podmanbe, a Docker Desktopban maradnak: k' + [char]0x00E9 + 'zzel t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'lheted ' + [char]0x0151 + 'ket, ha l' + [char]0x00E1 + 'ttad, hogy a friss' + [char]0x00ED + 't' + [char]0x00E9 + 's m' + [char]0x0171 + 'k' + [char]0x00F6 + 'dik.') }
    'hu:podman_machine.legacy_volumes_reinstallable' { return ('A v0.3.9 Docker-k' + [char]0x00F6 + 'tetei csak ' + [char]0x00FA + 'jratelep' + [char]0x00ED + 'thet' + [char]0x0151 + ' szolg' + [char]0x00E1 + 'ltat' + [char]0x00F3 + 'i programokat (jht-deps) ' + [char]0x00E9 + 's egy ' + [char]0x00FC + 'res mapp' + [char]0x00E1 + 't tartalmaznak; a be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'sok, a profil, a bejelentkez' + [char]0x00E9 + 's ' + [char]0x00E9 + 's a dokumentumok a ~/.jht mapp' + [char]0x00E1 + 'ban ' + [char]0x00E9 + 's a Dokumentumokban vannak.') }
    'hu:podman_machine.legacy_volumes_untouched' { return ('A JHT tov' + [char]0x00E1 + 'bbi Docker-k' + [char]0x00F6 + 'teteit ' + [char]0x00E9 + 'rintetlen' + [char]0x00FC + 'l hagytuk, ' + [char]0x00E9 + 's nem lettek ' + [char]0x00E1 + 'tk' + [char]0x00F6 + 'lt' + [char]0x00F6 + 'ztetve: %s.') }
    'hu:podman_machine.pull' { return ('Let' + [char]0x00F6 + 'lt' + [char]0x00F6 + 'm a Job Hunter Team k' + [char]0x00E9 + 'p' + [char]0x00E9 + 't: ez n' + [char]0x00E9 + 'h' + [char]0x00E1 + 'ny percig tarthat.') }
    'hu:podman_machine.pull_wait' { return ('m' + [char]0x00E9 + 'g tart a k' + [char]0x00E9 + 'p let' + [char]0x00F6 + 'lt' + [char]0x00E9 + 'se') }
    'hu:podman_machine.start' { return ('Elind' + [char]0x00ED + 'tom a Linux-g' + [char]0x00E9 + 'pet (kb. egy perc).') }
    'hu:podman_machine.start_wait' { return ('m' + [char]0x00E9 + 'g tart a Linux-g' + [char]0x00E9 + 'p ind' + [char]0x00ED + 't' + [char]0x00E1 + 'sa') }
    'hu:podman_machine.stop' { return ('Le' + [char]0x00E1 + 'll' + [char]0x00ED + 'tom a Linux-g' + [char]0x00E9 + 'pet.') }
    'hu:podman_machine.stop_wait' { return ('m' + [char]0x00E9 + 'g tart a Linux-g' + [char]0x00E9 + 'p le' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'sa') }
    'hu:podman_machine.team_restarts' { return ('A csapat a k' + [char]0x00F6 + 'rnyezete ' + [char]0x00FA + 'j verzi' + [char]0x00F3 + 'j' + [char]0x00E1 + 'val indul ' + [char]0x00FA + 'jra.') }
    'hu:podman_machine.wsl_added' { return ('WSL-be' + [char]0x00E1 + 'll' + [char]0x00ED + 't' + [char]0x00E1 + 'sok hozz' + [char]0x00E1 + 'adva: %s:') }
    'hu:podman_machine.wsl_applying' { return ('Alkalmazom a mem' + [char]0x00F3 + 'riakorl' + [char]0x00E1 + 'tot a WSL-re: a g' + [char]0x00E9 + 'p megv' + [char]0x00E1 + 'rja a WSL ' + [char]0x00FA + 'jraindul' + [char]0x00E1 + 's' + [char]0x00E1 + 't (kb. egy perc).') }
    'hu:podman_machine.wsl_limit_waits' { return ('A WSL m' + [char]0x00E1 + 'r fut: a mem' + [char]0x00F3 + 'riakorl' + [char]0x00E1 + 't a Windows vagy a WSL k' + [char]0x00F6 + 'vetkez' + [char]0x0151 + ' ' + [char]0x00FA + 'jraind' + [char]0x00ED + 't' + [char]0x00E1 + 's' + [char]0x00E1 + 't' + [char]0x00F3 + 'l ' + [char]0x00E9 + 'rv' + [char]0x00E9 + 'nyes (a wsl --shutdown minden WSL-disztrib' + [char]0x00FA + 'ci' + [char]0x00F3 + 'dat le' + [char]0x00E1 + 'll' + [char]0x00ED + 'tja, ez' + [char]0x00E9 + 'rt nem teszem meg helyetted).') }
    'hu:podman_machine.wsl_no_limit' { return ('WSL-mem' + [char]0x00F3 + 'ria: nincs korl' + [char]0x00E1 + 't be' + [char]0x00E1 + 'll' + [char]0x00ED + 'tva, mert m' + [char]0x00E1 + 's WSL-disztrib' + [char]0x00FA + 'ci' + [char]0x00F3 + 'k is regisztr' + [char]0x00E1 + 'lva vannak, ' + [char]0x00E9 + 's a korl' + [char]0x00E1 + 't r' + [char]0x00E1 + 'juk is vonatkozna.') }
    'hu:podman_machine.wsl_set_yourself' { return ('Ha magad ' + [char]0x00E1 + 'll' + [char]0x00ED + 'tan' + [char]0x00E1 + 'd be: a %s f' + [char]0x00E1 + 'jlban, a [wsl2] alatt add hozz' + [char]0x00E1 + ': memory=%s (a Windows vagy a WSL k' + [char]0x00F6 + 'vetkez' + [char]0x0151 + ' ' + [char]0x00FA + 'jraind' + [char]0x00ED + 't' + [char]0x00E1 + 'sa ut' + [char]0x00E1 + 'n ' + [char]0x00E9 + 'rv' + [char]0x00E9 + 'nyes).') }
    'hu:podman_machine.wsl_undo' { return ('Visszavon' + [char]0x00E1 + 's: a jht uninstall kiveszi ezeket a sorokat, vagy t' + [char]0x00F6 + 'r' + [char]0x00F6 + 'ld ' + [char]0x0151 + 'ket k' + [char]0x00E9 + 'zzel (mindegyik f' + [char]0x00F6 + 'l' + [char]0x00F6 + 'tt van egy megjegyz' + [char]0x00E9 + 'ssor).') }
    'es:podman_machine.init' { return ('Creo la m' + [char]0x00E1 + 'quina Linux de Podman: descarga su imagen del sistema (unos cientos de MB) y la prepara. Tarda unos minutos.') }
    'es:podman_machine.init_wait' { return ('sigo creando la m' + [char]0x00E1 + 'quina Linux') }
    'es:podman_machine.layers_started' { return '%s capas empezadas' }
    'es:podman_machine.legacy_docker_not_started' { return ('Docker Desktop no se ha iniciado: no se ha listado ning' + [char]0x00FA + 'n volumen antiguo.') }
    'es:podman_machine.legacy_mail_password' { return ('Si la versi' + [char]0x00F3 + 'n anterior guard' + [char]0x00F3 + ' una contrase' + [char]0x00F1 + 'a de correo, cambia esa contrase' + [char]0x00F1 + 'a de aplicaci' + [char]0x00F3 + 'n despu' + [char]0x00E9 + 's del inicio: el aviso seguir' + [char]0x00E1 + ' hasta que vuelvas a hacer el setup.') }
    'es:podman_machine.legacy_reused' { return ('Tu configuraci' + [char]0x00F3 + 'n, tu perfil y tu inicio de sesi' + [char]0x00F3 + 'n de Codex se reutilizan tambi' + [char]0x00E9 + 'n con Podman; los Documentos se quedan en su carpeta.') }
    'es:podman_machine.legacy_volumes_left' { return ('Vol' + [char]0x00FA + 'menes de la v0.3.9 que quedan en Docker Desktop: %s.') }
    'es:podman_machine.legacy_volumes_not_copied' { return ('Esos vol' + [char]0x00FA + 'menes Docker no se copian a Podman y se quedan en Docker Desktop: puedes quitarlos a mano cuando hayas visto que la actualizaci' + [char]0x00F3 + 'n funciona.') }
    'es:podman_machine.legacy_volumes_reinstallable' { return ('Los vol' + [char]0x00FA + 'menes Docker de la v0.3.9 solo contienen programas reinstalables de los proveedores (jht-deps) y una carpeta vac' + [char]0x00ED + 'a; configuraci' + [char]0x00F3 + 'n, perfil, inicio de sesi' + [char]0x00F3 + 'n y documentos est' + [char]0x00E1 + 'n en ~/.jht y en Documentos.') }
    'es:podman_machine.legacy_volumes_untouched' { return ('Otros vol' + [char]0x00FA + 'menes Docker de JHT se han dejado como estaban y no se han migrado: %s.') }
    'es:podman_machine.pull' { return 'Descargo la imagen de Job Hunter Team: puede tardar unos minutos.' }
    'es:podman_machine.pull_wait' { return 'sigo descargando la imagen' }
    'es:podman_machine.start' { return ('Arranco la m' + [char]0x00E1 + 'quina Linux (alrededor de un minuto).') }
    'es:podman_machine.start_wait' { return ('sigo arrancando la m' + [char]0x00E1 + 'quina Linux') }
    'es:podman_machine.stop' { return ('Detengo la m' + [char]0x00E1 + 'quina Linux.') }
    'es:podman_machine.stop_wait' { return ('sigo deteniendo la m' + [char]0x00E1 + 'quina Linux') }
    'es:podman_machine.team_restarts' { return ('El equipo se reinicia con la nueva versi' + [char]0x00F3 + 'n de su entorno.') }
    'es:podman_machine.wsl_added' { return ('Ajustes de WSL a' + [char]0x00F1 + 'adidos a %s:') }
    'es:podman_machine.wsl_applying' { return ('Aplico el l' + [char]0x00ED + 'mite de memoria a WSL: la m' + [char]0x00E1 + 'quina espera a que WSL se reinicie (alrededor de un minuto).') }
    'es:podman_machine.wsl_limit_waits' { return ('WSL ya est' + [char]0x00E1 + ' en marcha: el l' + [char]0x00ED + 'mite de memoria se aplica desde el pr' + [char]0x00F3 + 'ximo reinicio de Windows o de WSL (wsl --shutdown detiene todas tus distribuciones de WSL, por eso no lo hago yo).') }
    'es:podman_machine.wsl_no_limit' { return ('Memoria de WSL: no se ha puesto ning' + [char]0x00FA + 'n l' + [char]0x00ED + 'mite, porque hay otras distribuciones de WSL registradas y el l' + [char]0x00ED + 'mite tambi' + [char]0x00E9 + 'n se aplicar' + [char]0x00ED + 'a a ellas.') }
    'es:podman_machine.wsl_set_yourself' { return ('Para ponerlo t' + [char]0x00FA + ': en %s, bajo [wsl2], a' + [char]0x00F1 + 'ade memory=%s (se aplica tras el pr' + [char]0x00F3 + 'ximo reinicio de Windows o de WSL).') }
    'es:podman_machine.wsl_undo' { return ('Para deshacerlo: jht uninstall quita estas l' + [char]0x00ED + 'neas, o b' + [char]0x00F3 + 'rralas a mano (cada una tiene encima una l' + [char]0x00ED + 'nea de comentario).') }
    'de:podman_machine.init' { return ('Ich erstelle die Linux-Maschine f' + [char]0x00FC + 'r Podman: Sie l' + [char]0x00E4 + 'dt ihr Systemabbild herunter (einige hundert MB) und richtet es ein. Das dauert einige Minuten.') }
    'de:podman_machine.init_wait' { return 'erstelle noch die Linux-Maschine' }
    'de:podman_machine.layers_started' { return '%s Schichten begonnen' }
    'de:podman_machine.legacy_docker_not_started' { return 'Docker Desktop wurde nicht gestartet: Es wurde kein altes Volume aufgelistet.' }
    'de:podman_machine.legacy_mail_password' { return ('Wenn die vorherige Version ein E-Mail-Passwort gespeichert hat, ' + [char]0x00E4 + 'ndere dieses App-Passwort nach dem Start: Der Hinweis bleibt, bis du das Setup erneut durchf' + [char]0x00FC + 'hrst.') }
    'de:podman_machine.legacy_reused' { return 'Deine bisherige Konfiguration, dein Profil und deine Codex-Anmeldung werden auch mit Podman verwendet; die Dokumente bleiben in ihrem Ordner.' }
    'de:podman_machine.legacy_volumes_left' { return 'In Docker Desktop verbliebene Volumes der v0.3.9: %s.' }
    'de:podman_machine.legacy_volumes_not_copied' { return 'Diese Docker-Volumes werden nicht nach Podman kopiert und bleiben in Docker Desktop: Du kannst sie von Hand entfernen, wenn du gesehen hast, dass das Update funktioniert.' }
    'de:podman_machine.legacy_volumes_reinstallable' { return 'Die Docker-Volumes der v0.3.9 enthalten nur neu installierbare Programme der Anbieter (jht-deps) und einen leeren Ordner; Konfiguration, Profil, Anmeldung und Dokumente liegen in ~/.jht und in Dokumente.' }
    'de:podman_machine.legacy_volumes_untouched' { return ('Weitere Docker-Volumes von JHT wurden so gelassen und nicht ' + [char]0x00FC + 'bernommen: %s.') }
    'de:podman_machine.pull' { return 'Ich lade das Image von Job Hunter Team herunter: Das kann einige Minuten dauern.' }
    'de:podman_machine.pull_wait' { return 'lade noch das Image herunter' }
    'de:podman_machine.start' { return 'Ich starte die Linux-Maschine (etwa eine Minute).' }
    'de:podman_machine.start_wait' { return 'starte noch die Linux-Maschine' }
    'de:podman_machine.stop' { return 'Ich halte die Linux-Maschine an.' }
    'de:podman_machine.stop_wait' { return 'halte noch die Linux-Maschine an' }
    'de:podman_machine.team_restarts' { return 'Das Team startet mit der neuen Version seiner Umgebung neu.' }
    'de:podman_machine.wsl_added' { return ('WSL-Einstellungen hinzugef' + [char]0x00FC + 'gt zu %s:') }
    'de:podman_machine.wsl_applying' { return 'Ich wende das Speicherlimit auf WSL an: Die Maschine wartet, bis WSL neu startet (etwa eine Minute).' }
    'de:podman_machine.wsl_limit_waits' { return ('WSL l' + [char]0x00E4 + 'uft bereits: Das Speicherlimit gilt ab dem n' + [char]0x00E4 + 'chsten Neustart von Windows oder WSL (wsl --shutdown h' + [char]0x00E4 + 'lt alle deine WSL-Distributionen an, deshalb mache ich das nicht f' + [char]0x00FC + 'r dich).') }
    'de:podman_machine.wsl_no_limit' { return ('WSL-Speicher: Es wurde kein Limit gesetzt, weil andere WSL-Distributionen registriert sind und ein Limit auch f' + [char]0x00FC + 'r sie gelten w' + [char]0x00FC + 'rde.') }
    'de:podman_machine.wsl_set_yourself' { return ('Um selbst eines zu setzen: in %s unter [wsl2] memory=%s hinzuf' + [char]0x00FC + 'gen (gilt nach dem n' + [char]0x00E4 + 'chsten Neustart von Windows oder WSL).') }
    'de:podman_machine.wsl_undo' { return ('R' + [char]0x00FC + 'ckg' + [char]0x00E4 + 'ngig machen: jht uninstall entfernt diese Zeilen, oder l' + [char]0x00F6 + 'sche sie von Hand (' + [char]0x00FC + 'ber jeder steht eine Kommentarzeile).') }
    'fr:podman_machine.init' { return ('Je cr' + [char]0x00E9 + 'e la machine Linux de Podman : elle t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charge son image syst' + [char]0x00E8 + 'me (quelques centaines de Mo) et la pr' + [char]0x00E9 + 'pare. Cela prend quelques minutes.') }
    'fr:podman_machine.init_wait' { return ('je cr' + [char]0x00E9 + 'e encore la machine Linux') }
    'fr:podman_machine.layers_started' { return ('%s couches commenc' + [char]0x00E9 + 'es') }
    'fr:podman_machine.legacy_docker_not_started' { return ('Docker Desktop n''a pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' d' + [char]0x00E9 + 'marr' + [char]0x00E9 + ' : aucun ancien volume n''a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' list' + [char]0x00E9 + '.') }
    'fr:podman_machine.legacy_mail_password' { return ('Si la version pr' + [char]0x00E9 + 'c' + [char]0x00E9 + 'dente avait enregistr' + [char]0x00E9 + ' un mot de passe de messagerie, change ce mot de passe d''application apr' + [char]0x00E8 + 's le d' + [char]0x00E9 + 'marrage : l''avertissement reste jusqu''' + [char]0x00E0 + ' ce que tu refasses le setup.') }
    'fr:podman_machine.legacy_reused' { return ('Ta configuration, ton profil et ta connexion Codex existants sont r' + [char]0x00E9 + 'utilis' + [char]0x00E9 + 's avec Podman ; les Documents restent dans leur dossier.') }
    'fr:podman_machine.legacy_volumes_left' { return ('Volumes de la v0.3.9 rest' + [char]0x00E9 + 's dans Docker Desktop : %s.') }
    'fr:podman_machine.legacy_volumes_not_copied' { return ('Ces volumes Docker ne sont pas copi' + [char]0x00E9 + 's dans Podman et restent dans Docker Desktop : tu peux les supprimer ' + [char]0x00E0 + ' la main une fois la mise ' + [char]0x00E0 + ' jour v' + [char]0x00E9 + 'rifi' + [char]0x00E9 + 'e.') }
    'fr:podman_machine.legacy_volumes_reinstallable' { return ('Les volumes Docker de la v0.3.9 ne contiennent que des programmes r' + [char]0x00E9 + 'installables des fournisseurs (jht-deps) et un dossier vide ; configuration, profil, connexion et documents sont dans ~/.jht et dans Documents.') }
    'fr:podman_machine.legacy_volumes_untouched' { return ('D''autres volumes Docker de JHT ont ' + [char]0x00E9 + 't' + [char]0x00E9 + ' laiss' + [char]0x00E9 + 's tels quels et n''ont pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' migr' + [char]0x00E9 + 's : %s.') }
    'fr:podman_machine.pull' { return ('Je t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charge l''image de Job Hunter Team : cela peut prendre quelques minutes.') }
    'fr:podman_machine.pull_wait' { return ('je t' + [char]0x00E9 + 'l' + [char]0x00E9 + 'charge encore l''image') }
    'fr:podman_machine.start' { return ('Je d' + [char]0x00E9 + 'marre la machine Linux (environ une minute).') }
    'fr:podman_machine.start_wait' { return ('je d' + [char]0x00E9 + 'marre encore la machine Linux') }
    'fr:podman_machine.stop' { return ('J''arr' + [char]0x00EA + 'te la machine Linux.') }
    'fr:podman_machine.stop_wait' { return ('j''arr' + [char]0x00EA + 'te encore la machine Linux') }
    'fr:podman_machine.team_restarts' { return ('L''' + [char]0x00E9 + 'quipe red' + [char]0x00E9 + 'marre sur la nouvelle version de son environnement.') }
    'fr:podman_machine.wsl_added' { return ('R' + [char]0x00E9 + 'glages WSL ajout' + [char]0x00E9 + 's ' + [char]0x00E0 + ' %s :') }
    'fr:podman_machine.wsl_applying' { return ('J''applique la limite de m' + [char]0x00E9 + 'moire ' + [char]0x00E0 + ' WSL : la machine attend que WSL red' + [char]0x00E9 + 'marre (environ une minute).') }
    'fr:podman_machine.wsl_limit_waits' { return ('WSL tourne d' + [char]0x00E9 + 'j' + [char]0x00E0 + ' : la limite de m' + [char]0x00E9 + 'moire s''applique au prochain red' + [char]0x00E9 + 'marrage de Windows ou de WSL (wsl --shutdown arr' + [char]0x00EA + 'te toutes tes distributions WSL, c''est pourquoi je ne le fais pas ' + [char]0x00E0 + ' ta place).') }
    'fr:podman_machine.wsl_no_limit' { return ('M' + [char]0x00E9 + 'moire de WSL : aucune limite n''a ' + [char]0x00E9 + 't' + [char]0x00E9 + ' fix' + [char]0x00E9 + 'e, car d''autres distributions WSL sont enregistr' + [char]0x00E9 + 'es et une limite s''appliquerait aussi ' + [char]0x00E0 + ' elles.') }
    'fr:podman_machine.wsl_set_yourself' { return ('Pour en fixer une toi-m' + [char]0x00EA + 'me : dans %s, sous [wsl2], ajoute memory=%s (elle s''applique apr' + [char]0x00E8 + 's le prochain red' + [char]0x00E9 + 'marrage de Windows ou de WSL).') }
    'fr:podman_machine.wsl_undo' { return ('Pour annuler : jht uninstall retire ces lignes, ou supprime-les ' + [char]0x00E0 + ' la main (chacune a une ligne de commentaire au-dessus).') }
    'pt:podman_machine.init' { return ('Estou a criar a m' + [char]0x00E1 + 'quina Linux do Podman: descarrega a sua imagem de sistema (algumas centenas de MB) e prepara-a. Demora alguns minutos.') }
    'pt:podman_machine.init_wait' { return ('ainda a criar a m' + [char]0x00E1 + 'quina Linux') }
    'pt:podman_machine.layers_started' { return '%s camadas iniciadas' }
    'pt:podman_machine.legacy_docker_not_started' { return ('O Docker Desktop n' + [char]0x00E3 + 'o foi iniciado: nenhum volume antigo foi listado.') }
    'pt:podman_machine.legacy_mail_password' { return ('Se a vers' + [char]0x00E3 + 'o anterior guardou uma palavra-passe de correio, muda essa palavra-passe de aplica' + [char]0x00E7 + [char]0x00E3 + 'o depois do arranque: o aviso continua at' + [char]0x00E9 + ' voltares a fazer o setup.') }
    'pt:podman_machine.legacy_reused' { return ('A tua configura' + [char]0x00E7 + [char]0x00E3 + 'o, o teu perfil e o teu login do Codex s' + [char]0x00E3 + 'o reutilizados tamb' + [char]0x00E9 + 'm com o Podman; os Documentos ficam onde est' + [char]0x00E3 + 'o.') }
    'pt:podman_machine.legacy_volumes_left' { return 'Volumes da v0.3.9 que ficaram no Docker Desktop: %s.' }
    'pt:podman_machine.legacy_volumes_not_copied' { return ('Esses volumes Docker n' + [char]0x00E3 + 'o s' + [char]0x00E3 + 'o copiados para o Podman e ficam no Docker Desktop: podes remov' + [char]0x00EA + '-los ' + [char]0x00E0 + ' m' + [char]0x00E3 + 'o quando vires que a atualiza' + [char]0x00E7 + [char]0x00E3 + 'o funciona.') }
    'pt:podman_machine.legacy_volumes_reinstallable' { return ('Os volumes Docker da v0.3.9 s' + [char]0x00F3 + ' cont' + [char]0x00EA + 'm programas reinstal' + [char]0x00E1 + 'veis dos fornecedores (jht-deps) e uma pasta vazia; configura' + [char]0x00E7 + [char]0x00E3 + 'o, perfil, login e documentos est' + [char]0x00E3 + 'o em ~/.jht e em Documentos.') }
    'pt:podman_machine.legacy_volumes_untouched' { return ('Outros volumes Docker do JHT foram deixados como estavam e n' + [char]0x00E3 + 'o foram migrados: %s.') }
    'pt:podman_machine.pull' { return 'Estou a descarregar a imagem do Job Hunter Team: pode demorar alguns minutos.' }
    'pt:podman_machine.pull_wait' { return 'ainda a descarregar a imagem' }
    'pt:podman_machine.start' { return ('Estou a iniciar a m' + [char]0x00E1 + 'quina Linux (cerca de um minuto).') }
    'pt:podman_machine.start_wait' { return ('ainda a iniciar a m' + [char]0x00E1 + 'quina Linux') }
    'pt:podman_machine.stop' { return ('Estou a parar a m' + [char]0x00E1 + 'quina Linux.') }
    'pt:podman_machine.stop_wait' { return ('ainda a parar a m' + [char]0x00E1 + 'quina Linux') }
    'pt:podman_machine.team_restarts' { return ('A equipa reinicia na nova vers' + [char]0x00E3 + 'o do seu ambiente.') }
    'pt:podman_machine.wsl_added' { return ('Defini' + [char]0x00E7 + [char]0x00F5 + 'es do WSL adicionadas a %s:') }
    'pt:podman_machine.wsl_applying' { return ('Estou a aplicar o limite de mem' + [char]0x00F3 + 'ria ao WSL: a m' + [char]0x00E1 + 'quina espera que o WSL reinicie (cerca de um minuto).') }
    'pt:podman_machine.wsl_limit_waits' { return ('O WSL j' + [char]0x00E1 + ' est' + [char]0x00E1 + ' a correr: o limite de mem' + [char]0x00F3 + 'ria aplica-se a partir do pr' + [char]0x00F3 + 'ximo rein' + [char]0x00ED + 'cio do Windows ou do WSL (wsl --shutdown para todas as tuas distribui' + [char]0x00E7 + [char]0x00F5 + 'es WSL, por isso n' + [char]0x00E3 + 'o o fa' + [char]0x00E7 + 'o por ti).') }
    'pt:podman_machine.wsl_no_limit' { return ('Mem' + [char]0x00F3 + 'ria do WSL: n' + [char]0x00E3 + 'o foi definido nenhum limite, porque h' + [char]0x00E1 + ' outras distribui' + [char]0x00E7 + [char]0x00F5 + 'es WSL registadas e o limite aplicar-se-ia tamb' + [char]0x00E9 + 'm a elas.') }
    'pt:podman_machine.wsl_set_yourself' { return ('Para o definires tu: em %s, em [wsl2], acrescenta memory=%s (aplica-se depois do pr' + [char]0x00F3 + 'ximo rein' + [char]0x00ED + 'cio do Windows ou do WSL).') }
    'pt:podman_machine.wsl_undo' { return ('Para desfazer: jht uninstall retira estas linhas, ou apaga-as ' + [char]0x00E0 + ' m' + [char]0x00E3 + 'o (cada uma tem por cima uma linha de coment' + [char]0x00E1 + 'rio).') }
  }
  return $null
}
# <<< texts in the 7 languages

# What a person is told before each long machine command, and what the wait line says it is doing.
function Get-JhtPodmanMachineAnnouncement {
  param([string]$Verb)
  switch ($Verb) {
    'init' { return @{ Said = (Get-BridgeText 'podman_machine.init' 'Creating the Linux machine for Podman: it downloads its system image (several hundred MB) and sets it up. This takes several minutes.'); Doing = (Get-BridgeText 'podman_machine.init_wait' 'still creating the Linux machine') } }
    'start' { return @{ Said = (Get-BridgeText 'podman_machine.start' 'Starting the Linux machine (about a minute).'); Doing = (Get-BridgeText 'podman_machine.start_wait' 'still starting the Linux machine') } }
    'stop' { return @{ Said = (Get-BridgeText 'podman_machine.stop' 'Stopping the Linux machine.'); Doing = (Get-BridgeText 'podman_machine.stop_wait' 'still stopping the Linux machine') } }
    default { return $null }
  }
}

# What Podman says on stderr while it succeeds («Created symlink», «daemon-reload», «Getting image source signatures»): notes, not
# errors. A person reads them grey and indented; the app gets them as plain lines on stderr, the same words and no error record.
function Write-JhtPodmanNotes {
  param([AllowNull()][string[]]$Lines, [bool]$Human)
  foreach ($line in @($Lines)) {
    if (-not $line) { continue }
    # systemd's routine words when a unit is enabled (the link it made, the reminder that its files changed): a person has no use for
    # them, so they are left out of the console; everything else Podman says stays, and the app still gets every line.
    if ($Human -and $line -cmatch '^(Created symlink |Warning: The unit file, source configuration file or drop-ins of \S+ changed on disk\.)') { continue }
    if ($Human) { Write-Host "    $line" -ForegroundColor DarkGray } else { [Console]::Error.WriteLine("podman: $line") }
  }
}

function Invoke-JhtPodmanMachine {
  param([Parameter(Mandatory)][string]$FilePath, [Parameter(Mandatory)][AllowEmptyString()][string[]]$Arguments)
  if ($Arguments.Count -lt 2 -or $Arguments[0] -ne 'machine' -or $Arguments[1] -notin @('ssh', 'start', 'init', 'stop', 'list')) {
    & $FilePath @Arguments
    return
  }
  $requireComplete = $Arguments[1] -in @('ssh', 'list')
  $announcement = Get-JhtPodmanMachineAnnouncement -Verb $Arguments[1]
  if (-not $announcement) {
    # ssh and list: their output is data for the caller, handed back as it came.
    $result = Invoke-JhtPodmanProcess -FilePath $FilePath -Arguments $Arguments -Phase ('podman_machine_' + $Arguments[1]) -RequireCompleteOutput:$requireComplete
    if ($result.Stderr.Length) {
      # A command that succeeded and said things on stderr (systemctl enable, daemon-reload): notes, not red error records. A command that
      # failed keeps its stderr as an error, which a caller that redirects it (`2>$null`) can still hold back.
      # A person reads only the step's own sentences: what the machine says while it succeeds goes to the app alone.
      if ($result.ExitCode -eq 0) { if (-not (Test-JhtHumanOutput)) { Write-JhtPodmanNotes -Lines (Get-JhtPodmanTextLines -Text $result.Stderr) -Human $false } }
      else { Write-Error -Message $result.Stderr -ErrorAction Continue }
    }
    if ($result.Stdout.Length) {
      $lines = [regex]::Split($result.Stdout, '\r?\n')
      if ($lines[-1] -eq '') { $lines = @($lines | Select-Object -First ($lines.Count - 1)) }
      $lines | ForEach-Object { Write-Output $_ }
    }
    $global:LASTEXITCODE = $result.ExitCode
    return
  }
  # init, start and stop take minutes and say nothing until they end (the output is captured): a person is told
  # what is going on and sees a line every few seconds. Podman's own words (in English, "This machine is currently
  # configured in rootless mode...") are not for a person when the command succeeds; a command that fails shows them,
  # its stdout as grey notes and its stderr as plain lines on stderr, never as the error records of PowerShell, then
  # the caller's own message with the code.
  $human = Test-JhtHumanOutput
  if ($human) { Write-Host "  > $($announcement.Said)" -ForegroundColor Cyan }
  $wait = if ($human) { Start-JhtLiveWait -Label $announcement.Doing } else { $null }
  try {
    $result = Invoke-JhtPodmanProcess -FilePath $FilePath -Arguments $Arguments -Phase ('podman_machine_' + $Arguments[1])
  } finally {
    if ($wait) { $wait.Dispose() }
  }
  $errorLines = Get-JhtPodmanTextLines -Text $result.Stderr
  if ($human) {
    if ($result.ExitCode -ne 0) {
      foreach ($line in (Get-JhtPodmanTextLines -Text $result.Stdout)) { Write-Host "    $line" -ForegroundColor DarkGray }
      # the lines go to stderr as plain text, as the app reads them
      Write-JhtPodmanNotes -Lines $errorLines -Human $false
    }
  } else {
    if ($result.Stdout.Length) {
      $lines = [regex]::Split($result.Stdout, '\r?\n')
      if ($lines[-1] -eq '') { $lines = @($lines | Select-Object -First ($lines.Count - 1)) }
      $lines | ForEach-Object { Write-Output $_ }
    }
    Write-JhtPodmanNotes -Lines $errorLines -Human $false
  }
  $global:LASTEXITCODE = $result.ExitCode
}

# The pipe a Podman machine opens (\\.\pipe\podman-<machine>) is global to the computer, and the program that holds it
# (win-sshproxy.exe) can outlive its machine. 'absent': nobody holds it; 'connected': it answers this user (their own machine's);
# 'denied': it exists and this user may not open it, so another Windows user's program holds it; 'unknown'/'busy': not told apart.
function Get-JhtPodmanPipeState {
  param([Parameter(Mandatory)][string]$MachineName)
  $pipe = "podman-$MachineName"
  try { $listed = @([IO.Directory]::GetFiles('\\.\pipe\') | ForEach-Object { [IO.Path]::GetFileName([string]$_) }) } catch { return 'unknown' }
  if ($listed -cnotcontains $pipe) { return 'absent' }
  $client = $null
  try {
    $client = New-Object IO.Pipes.NamedPipeClientStream('.', $pipe, [IO.Pipes.PipeDirection]::InOut, [IO.Pipes.PipeOptions]::None)
    $client.Connect(300)
    return 'connected'
  } catch [UnauthorizedAccessException] { return 'denied' }
  catch { return 'busy' }
  finally { if ($client) { $client.Dispose() } }
}

# What to tell a person whose pipe is held by another user's program: who holds it, and what to do.
function Get-JhtPodmanPipeAdvice {
  param([Parameter(Mandatory)][string]$MachineName)
  $ids = @()
  try { $ids = @(Get-Process -Name 'win-sshproxy' -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.Id }) } catch { $ids = @() }
  $who = if ($ids.Count -gt 0) { "win-sshproxy.exe, process id $($ids -join ', ')" } else { 'win-sshproxy.exe' }
  return ("The Podman pipe \\.\pipe\podman-$MachineName is held by a program of another Windows user of this computer ($who). " +
    'It can stay alive after that user''s Podman machine has stopped. To free it: sign in as that user and run "podman machine stop", ' +
    'or end win-sshproxy.exe in Task Manager (Details tab, with the User name column; an administrator can do it for you). ' +
    'Then run the installer again.')
}

# `podman machine start` leaves with 0 even when its win-sshproxy.exe did not start («API forwarding for Docker API clients is not
# available»): Podman has already waited about twenty seconds for the pipe by then. Only ASCII digits, up to 30, can change the
# few seconds more this waits.
function Get-JhtPodmanPipeWaitMilliseconds {
  param([string]$Seconds = $env:JHT_PIPE_WAIT_SECONDS)
  if ($Seconds -cmatch '^[0-9]{1,2}$' -and [int]$Seconds -le 30) { return ([int]$Seconds * 1000) }
  return 5000
}

# The state of the machine's pipe once it has had a moment to appear: anything but 'absent' is answered at once.
function Wait-JhtPodmanPipe {
  param([Parameter(Mandatory)][string]$MachineName, [int]$Milliseconds = (Get-JhtPodmanPipeWaitMilliseconds))
  $deadline = [DateTime]::UtcNow.AddMilliseconds($Milliseconds)
  while ($true) {
    $state = Get-JhtPodmanPipeState -MachineName $MachineName
    if ($state -cne 'absent' -or [DateTime]::UtcNow -ge $deadline) { return $state }
    Start-Sleep -Milliseconds 250
  }
}

# win-sshproxy.exe writes why it stopped to the Application log (source ".NET Runtime", «[error] <machine>: ...»): Podman only says
# «see windows event logs». The newest line of this machine since $Since, ASCII and short; '' when there is none or the log cannot
# be read (a standard user may read it, a log that is off or a Windows without it gives nothing).
function Get-JhtWinSshProxyReason {
  param([Parameter(Mandatory)][string]$MachineName, [DateTime]$Since = ([DateTime]::Now.AddMinutes(-15)))
  try {
    $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = '.NET Runtime'; StartTime = $Since } -ErrorAction Stop)
  } catch { return '' }
  $pattern = '\[(?:error|fatal|panic|warning)\s*\]\s+' + [regex]::Escape($MachineName) + ':\s*(.+)'
  foreach ($logged in $events) {
    # the line travels as the event's first insertion string; Message holds it inside Windows' own sentence
    $text = if ($logged.Properties -and $logged.Properties.Count) { [string]$logged.Properties[0].Value } else { [string]$logged.Message }
    if ($text -match $pattern) {
      $reason = (([string]$Matches[1] -split '\r?\n')[0] -replace '[^\x20-\x7E]', '?').Trim()
      if ($reason.Length -gt 300) { $reason = $reason.Substring(0, 300) }
      if ($reason) { return $reason }
    }
  }
  return ''
}

# The win-sshproxy.exe of Podman up to 6.1.3 (gvisor-tap-vsock 0.8.x) opens the Windows event log (RegisterEventSource of
# ".NET Runtime") before anything else and leaves with 1 when that is refused: it is refused to a logon without a desktop of the person
# (ssh, a service, a scheduled task that runs whether the user is logged on or not) and the pipe then never exists. Podman 6.1.4 and
# newer carry a win-sshproxy that goes on without the log.
function Test-JhtWinSshProxyNeedsEventLog {
  param([string]$PodmanVersion)
  $parsed = $null
  if ($PodmanVersion -and [version]::TryParse(([string]$PodmanVersion).Trim(), [ref]$parsed)) { return ($parsed -lt [version]'6.1.4') }
  # a version that cannot be read is the one the installer pins (6.0.2)
  return $true
}

# The question win-sshproxy.exe asks first, without writing anything to the log: 'writable', 'denied' (access denied, error 5) or
# 'unknown' (not Windows, or the question could not be asked).
function Test-JhtEventLogWritable {
  try {
    if (-not ('JhtEventSourceProbe' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class JhtEventSourceProbe {
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr RegisterEventSourceW(string server, string source);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool DeregisterEventSource(IntPtr handle);
  public static int Probe(string source) {
    IntPtr handle = RegisterEventSourceW(null, source);
    if (handle == IntPtr.Zero) { return Marshal.GetLastWin32Error(); }
    DeregisterEventSource(handle);
    return 0;
  }
}
'@
    }
    $error5 = [JhtEventSourceProbe]::Probe('.NET Runtime')
    if ($error5 -eq 0) { return 'writable' }
    if ($error5 -eq 5) { return 'denied' }
    return 'unknown'
  } catch { return 'unknown' }
}

# The version `podman --version` says ('' when it does not say).
function Get-JhtPodmanExeVersion {
  param([string]$Path)
  if (-not $Path) { return '' }
  $line = @(& { $ErrorActionPreference = 'Continue'; & $Path --version 2>$null }) | Select-Object -First 1
  if ([string]$line -match '^podman(?:\.exe)? version (\S+)$') { return [string]$Matches[1] }
  return ''
}

# The Windows session this script runs in: 0 is where ssh logons, services and scheduled tasks run, with no desktop of the person.
function Get-JhtWindowsSessionId {
  try { return [int][Diagnostics.Process]::GetCurrentProcess().SessionId } catch { return -1 }
}

# The stop's words: the machine line (read by the app and the logs), the cause, and where to run the installer instead.
function Get-JhtApiForwardingFailure {
  param([Parameter(Mandatory)][string]$MachineName, [string]$Reason = '', [bool]$Restarted = $false, [int]$SessionId = -1, [bool]$EventLogDenied = $false, [bool]$Started = $true, [string]$What = 'installer')
  $text = "podman_api_forwarding_unavailable: Podman's connection for Docker tools (win-sshproxy.exe) "
  $text += if ($Started) { "did not start for the machine $MachineName" } else { "cannot start for the machine $MachineName" }
  $text += ', so nothing can reach the containers of the team'
  if ($Restarted) { $text += ' (the machine was restarted once and it did not start again)' }
  $text += '. '
  if ($EventLogDenied) {
    $text += 'It stops at once when the Windows logon it runs in may not write to the Windows event log, as in an ssh login, a service or a scheduled task that has no desktop of the person. '
    $text += "Run the $What from the Windows desktop of this user (Start menu, Windows PowerShell), not from ssh."
  } else {
    $text += if ($Reason) { "Windows says: $Reason" } else { 'Windows did not say why: Event Viewer > Windows Logs > Application, source ".NET Runtime".' }
    if ($SessionId -eq 0) { $text += " This $What runs in Windows session 0 (an ssh login, a service or a scheduled task), which has no desktop: run it from the Windows desktop of this user, not from ssh." }
  }
  return $text
}

# WSLCONFIG-BEGIN
# %USERPROFILE%\.wslconfig is the settings file of WSL2 for ALL of the person's distributions, not ours: it is never replaced and a key
# the person already has is never touched. A key is added only when it is absent, with a comment line before it that says who added
# it; what was added is recorded (one record file) so that the uninstall takes out exactly those lines and nothing else. The same
# block is in podman-machine-bridge.ps1 and jht-uninstall-windows.ps1 (a test keeps them identical).
$script:JhtWslConfigComment = '# Job Hunter Team added the next line (its installer); "jht uninstall" removes it. Edit or delete it freely.'

# The file as lines, or the reason it is not read: a link, a folder, UTF-16 (Notepad's "Unicode"), or text that is not UTF-8 (WSL reads
# it in the system's code page, so a file with accented text in it is not ours to rewrite).
function Read-JhtWslConfigFile {
  param([Parameter(Mandatory)][string]$Path)
  $info = $null
  try { $info = Get-Item -LiteralPath $Path -Force -ErrorAction Stop } catch { $info = $null }
  if (-not $info) { return @{ Exists = $false; Lines = @(); NewLine = "`r`n"; Bom = $false; Reason = '' } }
  if ($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) { return @{ Exists = $true; Reason = 'it is a link or a folder' } }
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF))) { return @{ Exists = $true; Reason = 'it is saved as UTF-16' } }
  if ($bytes -contains 0) { return @{ Exists = $true; Reason = 'it is not plain text' } }
  $bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  try { $text = [Text.UTF8Encoding]::new($false, $true).GetString($bytes, $(if ($bom) { 3 } else { 0 }), $bytes.Length - $(if ($bom) { 3 } else { 0 })) }
  catch { return @{ Exists = $true; Reason = 'it is not UTF-8 text' } }
  $newLine = if ($text.Contains("`r`n")) { "`r`n" } elseif ($text.Contains("`n")) { "`n" } else { "`r`n" }
  $lines = @()
  if ($text.Length) {
    $lines = @($text -split '\r?\n')
    if ($lines[-1] -eq '') { $lines = @($lines | Select-Object -First ($lines.Count - 1)) }
  }
  return @{ Exists = $true; Lines = $lines; NewLine = $newLine; Bom = $bom; Reason = '' }
}

# Written to a temporary file beside it and put in its place: a program reading it never meets half a file.
function Write-JhtWslConfigFile {
  param([Parameter(Mandatory)][string]$Path, [string[]]$Lines, [string]$NewLine = "`r`n", [bool]$Bom = $false)
  $body = if ($Lines.Count) { ($Lines -join $NewLine) + $NewLine } else { '' }
  $encoded = [Text.UTF8Encoding]::new($false).GetBytes($body)
  if ($Bom) { $encoded = [byte[]](@(0xEF, 0xBB, 0xBF) + $encoded) }
  $temporary = $Path + '.jht-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.tmp'
  try {
    [IO.File]::WriteAllBytes($temporary, $encoded)
    if ([IO.File]::Exists($Path)) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) } else { [IO.File]::Move($temporary, $Path) }
  } finally { if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) } }
}

# The lines of each section: name (lower case) -> first and last line index; the lines before any header are not in a section.
function Get-JhtWslConfigSections {
  param([string[]]$Lines)
  $found = [ordered]@{}
  $name = $null
  for ($i = 0; $i -lt $Lines.Count; $i++) {
    if ($Lines[$i] -match '^\s*\[([^\]]+)\]\s*(?:[#;].*)?$') {
      $name = $Matches[1].Trim().ToLowerInvariant()
      if (-not $found.Contains($name)) { $found[$name] = @{ Header = $i; Last = $i } }
      $current = $name
    } elseif ($null -ne $name -and $found.Contains($name)) {
      $found[$name].Last = $i
    }
  }
  return $found
}

# Adds each wanted key that is absent from its section: @{ Section; Key; Value }. Answer: Status 'added' | 'unchanged' | 'skipped'
# (with Reason), Created (the file did not exist), Added (the entries written, with SectionCreated).
function Add-JhtWslConfigKeys {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][object[]]$Entries)
  $file = Read-JhtWslConfigFile -Path $Path
  if ($file.Reason) { return @{ Status = 'skipped'; Reason = $file.Reason; Created = $false; Added = @() } }
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in @($file.Lines)) { $lines.Add([string]$line) }
  $added = @()
  foreach ($entry in $Entries) {
    $section = ([string]$entry.Section).ToLowerInvariant()
    $sections = Get-JhtWslConfigSections -Lines $lines.ToArray()
    if ($sections.Contains($section)) {
      $range = $sections[$section]
      $present = $false
      for ($i = $range.Header + 1; $i -le $range.Last; $i++) {
        if ($lines[$i] -match ('^\s*' + [regex]::Escape([string]$entry.Key) + '\s*=')) { $present = $true; break }
      }
      if ($present) { continue }
      # after the last line that is a setting (a comment or blank lines at the end of the section belong to what follows)
      $at = $range.Header
      for ($i = $range.Header + 1; $i -le $range.Last; $i++) { if ($lines[$i] -match '^\s*[^\s#;]') { $at = $i } }
      $lines.Insert($at + 1, "$($entry.Key)=$($entry.Value)")
      $lines.Insert($at + 1, $script:JhtWslConfigComment)
      $added += @{ Section = $section; Key = [string]$entry.Key; Value = [string]$entry.Value; SectionCreated = $false }
    } else {
      if ($lines.Count -and $lines[$lines.Count - 1].Trim() -ne '') { $lines.Add('') }
      $lines.Add("[$section]")
      $lines.Add($script:JhtWslConfigComment)
      $lines.Add("$($entry.Key)=$($entry.Value)")
      $added += @{ Section = $section; Key = [string]$entry.Key; Value = [string]$entry.Value; SectionCreated = $true }
    }
  }
  if (-not $added.Count) { return @{ Status = 'unchanged'; Reason = ''; Created = $false; Added = @() } }
  Write-JhtWslConfigFile -Path $Path -Lines $lines.ToArray() -NewLine $file.NewLine -Bom $file.Bom
  return @{ Status = 'added'; Reason = ''; Created = (-not $file.Exists); Added = $added }
}

# The record of what was added, one fact per line: file=<path>, created=0|1, add=<section>|<key>|<value>|<section created 0|1>.
function ConvertTo-JhtWslConfigRecord {
  param([Parameter(Mandatory)][string]$Path, [bool]$Created, [object[]]$Added)
  $out = @('version=1', "file=$Path", "created=$(if ($Created) { 1 } else { 0 })")
  foreach ($entry in $Added) { $out += "add=$($entry.Section)|$($entry.Key)|$($entry.Value)|$(if ($entry.SectionCreated) { 1 } else { 0 })" }
  return ($out -join "`n") + "`n"
}

# Takes out exactly the lines the record names, each only if it is still there as it was written (the comment line before it too).
# What the person changed stays. Answer: Removed, Kept (the lines left because they were changed or are gone), Path.
# The record of what the setup added, read only from a plain small file (never through a link or a folder): '' otherwise.
function Read-JhtWslConfigRecord {
  param([Parameter(Mandatory)][string]$Path)
  try {
    $info = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if ($info.PSIsContainer -or ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $info.Length -gt 4096) { return '' }
    return [IO.File]::ReadAllText($Path)
  } catch { return '' }
}

# The only file a record may name: .wslconfig in the profile of the person who runs the uninstall. A record that names any other
# file is not acted on (it sits in a folder the person can write, and created=1 would delete the file it names).
function Test-JhtWslConfigRecordTarget {
  param([string]$Path, [Parameter(Mandatory)][string]$ProfilePath)
  try {
    if (-not $Path -or -not [IO.Path]::IsPathRooted($Path) -or -not [IO.Path]::IsPathRooted($ProfilePath)) { return $false }
    $expected = [IO.Path]::GetFullPath([IO.Path]::Combine($ProfilePath, '.wslconfig'))
    return [string]::Equals([IO.Path]::GetFullPath($Path), $expected, [StringComparison]::OrdinalIgnoreCase)
  } catch { return $false }
}

function Remove-JhtWslConfigKeys {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$RecordText, [Parameter(Mandatory)][string]$ProfilePath)
  $path = ''; $created = $false; $adds = @()
  foreach ($line in ($RecordText -split '\r?\n')) {
    if ($line -match '^file=(.+)$') { $path = $Matches[1] }
    elseif ($line -match '^created=1$') { $created = $true }
    elseif ($line -match '^add=([^|]+)\|([^|]+)\|([^|]*)\|([01])$') { $adds += @{ Section = $Matches[1]; Key = $Matches[2]; Value = $Matches[3]; SectionCreated = ($Matches[4] -eq '1') } }
  }
  if (-not $path -or -not [IO.Path]::IsPathRooted($path) -or -not $adds.Count) { return @{ Removed = 0; Kept = 0; Path = $path; Reason = 'no record' } }
  if (-not (Test-JhtWslConfigRecordTarget -Path $path -ProfilePath $ProfilePath)) { return @{ Removed = 0; Kept = 0; Path = $path; Reason = 'no record' } }
  $file = Read-JhtWslConfigFile -Path $path
  if (-not $file.Exists) { return @{ Removed = 0; Kept = 0; Path = $path; Reason = '' } }
  if ($file.Reason) { return @{ Removed = 0; Kept = $adds.Count; Path = $path; Reason = $file.Reason } }
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in @($file.Lines)) { $lines.Add([string]$line) }
  $removed = 0; $kept = 0
  foreach ($entry in $adds) {
    $sections = Get-JhtWslConfigSections -Lines $lines.ToArray()
    $hit = -1
    if ($sections.Contains($entry.Section)) {
      $range = $sections[$entry.Section]
      for ($i = $range.Header + 1; $i -le $range.Last; $i++) {
        if ($lines[$i] -match ('^\s*' + [regex]::Escape($entry.Key) + '\s*=\s*(.*?)\s*$') -and $Matches[1] -eq $entry.Value -and $i -gt $range.Header + 0 -and $lines[$i - 1] -ceq $script:JhtWslConfigComment) { $hit = $i; break }
      }
    }
    if ($hit -lt 0) { $kept++; continue }
    $lines.RemoveRange($hit - 1, 2)
    $removed++
    if ($entry.SectionCreated) {
      $sections = Get-JhtWslConfigSections -Lines $lines.ToArray()
      if ($sections.Contains($entry.Section)) {
        $range = $sections[$entry.Section]
        $empty = $true
        for ($i = $range.Header + 1; $i -le $range.Last; $i++) { if ($lines[$i].Trim() -ne '') { $empty = $false; break } }
        if ($empty) {
          $lines.RemoveRange($range.Header, $range.Last - $range.Header + 1)
          if ($range.Header -gt 0 -and $lines.Count -ge $range.Header -and $lines[$range.Header - 1].Trim() -eq '') { $lines.RemoveAt($range.Header - 1) }
        }
      }
    }
  }
  if ($removed) {
    $onlyBlank = -not @($lines | Where-Object { $_.Trim() -ne '' }).Count
    if ($created -and $onlyBlank) { [IO.File]::Delete($path) }
    else { Write-JhtWslConfigFile -Path $path -Lines $lines.ToArray() -NewLine $file.NewLine -Bom $file.Bom }
  }
  return @{ Removed = $removed; Kept = $kept; Path = $path; Reason = '' }
}
# WSLCONFIG-END

# What the setup asks of WSL for the memory of its machine. Measured on a 12 GB computer (Windows 10, WSL 3.0.5, no .wslconfig): WSL2
# took 50% of the RAM (6 GB) for a machine that uses 0.5 to 0.7 GB, and the rest filled with page cache.
# - memory=: a hard ceiling for the VM. Measured: 2GB held the VM at 2047 MB (Windows at 61%, from 93%) with the team's container up;
#   the cache inside the ceiling is the kernel's to free. The VM is shared by EVERY distribution of the person, so the key is added
#   only when the machine of Job Hunter Team is the only distribution registered, and only when it is below the half WSL takes anyway.
#   2 GB up to 8 GB of RAM, 3 GB above (the 3 GB the machine was always asked for: `podman machine init --memory 3072` is not applied on WSL).
# - autoMemoryReclaim=gradual ([experimental]) is NOT written: measured at rest, the VM stayed at 6058 MB for 15 minutes with it.
#   The function below can add any [section] key, so a measured value (autoMemoryReclaim=dropCache has not been) is one entry.
$script:JhtWslMemorySmallMegabytes = 2048
$script:JhtWslMemoryMegabytes = 3072
$script:JhtWslSmallComputerMegabytes = 8192

# The distributions this Windows user has registered in WSL (their names), or $null when that cannot be read.
function Get-JhtWslDistributionNames {
  try {
    $root = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
    if (-not (Test-Path -LiteralPath $root)) { return ,@() }
    return ,@(Get-ChildItem -LiteralPath $root -ErrorAction Stop | ForEach-Object { [string](Get-ItemProperty -LiteralPath $_.PSPath -Name DistributionName -ErrorAction SilentlyContinue).DistributionName } | Where-Object { $_ })
  } catch { return $null }
}

# 0 when it cannot be read.
function Get-JhtTotalMemoryMegabytes {
  try { return [long]([long](Get-CimInstance -ClassName Win32_ComputerSystem -OperationTimeoutSec 10 -ErrorAction Stop).TotalPhysicalMemory / 1MB) } catch { return 0 }
}

# Whether the WSL virtual machine is up now: WSL reads .wslconfig only when its VM starts. vmmemWSL is the VM of the WSL from the Store,
# vmmem the one of the inbox WSL of Windows 10 (a name Hyper-V machines share: then the line below is said once too often, never missing).
# $true when it cannot be read.
function Test-JhtWslVmRunning {
  try { return [bool](@(Get-Process -Name 'vmmemWSL', 'vmmem' -ErrorAction SilentlyContinue).Count) } catch { return $true }
}

# The distro WSL gives a Podman machine (the same rule as the wrapper's Get-JhtPodmanDistroName).
function Get-JhtWslDistroNameOfMachine {
  param([Parameter(Mandatory)][string]$MachineName)
  if ($MachineName.StartsWith('podman', [StringComparison]::Ordinal)) { return $MachineName }
  return "podman-$MachineName"
}

# The memory= value for this computer ('2GB' or '3GB'), or '' when the RAM is not known or the limit is not below the half WSL takes anyway.
function Get-JhtWslMemoryLimitText {
  param([long]$TotalMegabytes)
  if ($TotalMegabytes -le 0) { return '' }
  $limit = if ($TotalMegabytes -le $script:JhtWslSmallComputerMegabytes) { $script:JhtWslMemorySmallMegabytes } else { $script:JhtWslMemoryMegabytes }
  if ($limit -lt ($TotalMegabytes / 2)) { return "$([int]($limit / 1024))GB" }
  return ''
}

function Get-JhtWslConfigWanted {
  param([long]$TotalMegabytes, $DistributionNames, [string]$OwnDistribution)
  $wanted = @()
  $alone = ($null -ne $DistributionNames -and @($DistributionNames | Where-Object { $_ -cne $OwnDistribution }).Count -eq 0)
  $limit = Get-JhtWslMemoryLimitText -TotalMegabytes $TotalMegabytes
  if ($alone -and $limit) { $wanted += @{ Section = 'wsl2'; Key = 'memory'; Value = $limit } }
  return $wanted
}

# The limit the setup does NOT write because other distributions of the person are registered (it would cap them too): the value it
# would have written, or ''. The person is told, and jht doctor keeps telling them while their .wslconfig has no memory= of its own.
function Get-JhtWslMemoryAdvice {
  param([long]$TotalMegabytes, $DistributionNames, [string]$OwnDistribution)
  if ($null -eq $DistributionNames -or -not @($DistributionNames | Where-Object { $_ -cne $OwnDistribution }).Count) { return '' }
  return (Get-JhtWslMemoryLimitText -TotalMegabytes $TotalMegabytes)
}

# Whether the [wsl2] section of the file has a memory= of its own. A file that cannot be read counts as having one: nothing is advised
# about a file that cannot be told. (The same function is in jht-wrapper.ps1, for jht doctor; a test keeps them identical.)
function Test-JhtWslConfigHasMemory {
  param([Parameter(Mandatory)][string]$Path)
  $file = Read-JhtWslConfigFile -Path $Path
  if ($file.Reason) { return $true }
  $lines = @($file.Lines)
  $sections = Get-JhtWslConfigSections -Lines $lines
  if (-not $sections.Contains('wsl2')) { return $false }
  for ($i = $sections['wsl2'].Header + 1; $i -le $sections['wsl2'].Last; $i++) { if ($lines[$i] -match '^\s*memory\s*=') { return $true } }
  return $false
}

# What the setup says when the limit was written while the WSL VM runs and the VM could not be restarted for it.
$script:JhtWslLimitWaitsText = '  ' + (Get-BridgeText 'podman_machine.wsl_limit_waits' 'WSL is already running: the memory limit applies from the next restart of Windows, or of WSL (wsl --shutdown stops all your WSL distributions, so it is not done for you).')

# Waits for the WSL virtual machine to stop by itself (WSL ends it about a minute after its last distribution stopped): $true once it
# is gone, $false after the time (120 seconds, or JHT_WSL_STOP_WAIT_SECONDS, 1 to 300, for the tests). It never stops anything.
function Wait-JhtWslVmStopped {
  param([string]$Seconds = $env:JHT_WSL_STOP_WAIT_SECONDS)
  $limit = 120
  if ($Seconds -cmatch '^[0-9]{1,3}$' -and [int]$Seconds -ge 1 -and [int]$Seconds -le 300) { $limit = [int]$Seconds }
  $deadline = [DateTime]::UtcNow.AddSeconds($limit)
  while (Test-JhtWslVmRunning) {
    if ([DateTime]::UtcNow -ge $deadline) { return $false }
    Start-Sleep -Seconds 1
  }
  return $true
}

# Adds what is wanted that the person does not already have, records it, and says it. Never fails a setup: the caller catches.
# Answers 'vm-running' when it wrote a limit while the WSL virtual machine runs (the limit waits for the VM to start again; the enabler
# restarts it when it may), '' otherwise.
function Set-JhtWslConfigForMachine {
  param([Parameter(Mandatory)][string]$RuntimeDir, [Parameter(Mandatory)][string]$MachineName, [string]$ProfilePath = $env:USERPROFILE)
  if (-not $ProfilePath -or -not [IO.Path]::IsPathRooted($ProfilePath)) { return '' }
  $total = Get-JhtTotalMemoryMegabytes
  $names = Get-JhtWslDistributionNames
  $own = Get-JhtWslDistroNameOfMachine $MachineName
  $wanted = @(Get-JhtWslConfigWanted -TotalMegabytes $total -DistributionNames $names -OwnDistribution $own)
  $path = [IO.Path]::Combine($ProfilePath, '.wslconfig')
  # what jht doctor reads: in the runtime folder, which no container mounts
  $advicePath = [IO.Path]::Combine($RuntimeDir, 'wslconfig-advice')
  if (-not $wanted.Count) {
    $advice = Get-JhtWslMemoryAdvice -TotalMegabytes $total -DistributionNames $names -OwnDistribution $own
    if ($advice -and -not (Test-JhtWslConfigHasMemory -Path $path)) {
      [IO.Directory]::CreateDirectory($RuntimeDir) | Out-Null
      [IO.File]::WriteAllText($advicePath, "memory=$advice`n", [Text.UTF8Encoding]::new($false))
      Write-Host ('  ' + (Get-BridgeText 'podman_machine.wsl_no_limit' 'WSL memory: no limit was set, because other WSL distributions are registered and a limit would apply to them too.')) -ForegroundColor Yellow
      Write-Host ('  ' + (Format-BridgeText 'podman_machine.wsl_set_yourself' 'To set one yourself: in %s, under [wsl2], add memory=%s (it applies after the next restart of Windows or of WSL).' $path $advice)) -ForegroundColor Yellow
    } elseif ([IO.File]::Exists($advicePath)) { [IO.File]::Delete($advicePath) }
    return ''
  }
  if ([IO.File]::Exists($advicePath)) { [IO.File]::Delete($advicePath) }
  $answer = Add-JhtWslConfigKeys -Path $path -Entries $wanted
  if ($answer.Status -eq 'skipped') {
    Write-Host "  WSL settings: $path was left as it is ($($answer.Reason))." -ForegroundColor Yellow
    return ''
  }
  if ($answer.Status -ne 'added') { return '' }
  $recordPath = [IO.Path]::Combine($RuntimeDir, 'wslconfig-added')
  $created = [bool]$answer.Created
  $added = @($answer.Added)
  if ([IO.File]::Exists($recordPath)) {
    # an earlier setup added other lines: its record stays and grows
    $old = Read-JhtWslConfigRecord -Path $recordPath
    if ($old -match '(?m)^created=1\s*$') { $created = $true }
    foreach ($line in ($old -split '\r?\n')) {
      if ($line -match '^add=([^|]+)\|([^|]+)\|([^|]*)\|([01])$') { $added = @(@{ Section = $Matches[1]; Key = $Matches[2]; Value = $Matches[3]; SectionCreated = ($Matches[4] -eq '1') }) + $added }
    }
  }
  [IO.Directory]::CreateDirectory($RuntimeDir) | Out-Null
  [IO.File]::WriteAllText($recordPath, (ConvertTo-JhtWslConfigRecord -Path $path -Created $created -Added $added), [Text.UTF8Encoding]::new($false))
  Write-Host ('  ' + (Format-BridgeText 'podman_machine.wsl_added' 'WSL settings added to %s:' $path)) -ForegroundColor Cyan
  foreach ($entry in @($answer.Added)) { Write-Host "    [$($entry.Section)] $($entry.Key)=$($entry.Value)" -ForegroundColor Cyan }
  Write-Host ('  ' + (Get-BridgeText 'podman_machine.wsl_undo' 'To undo it: jht uninstall takes these lines out, or delete them by hand (each has a comment line above it).')) -ForegroundColor DarkGray
  # The setup starts the machine right after this: with WSL off, that start reads the file and nothing needs saying.
  if (Test-JhtWslVmRunning) { return 'vm-running' }
  return ''
}

# The pull of an image, and then the team's first minutes, fill the machine's page cache (about 5 GB were seen on a 12 GB computer,
# measured: Windows counted it as the machine's memory and went to 93%; after this it went back to 63% in 20 seconds). It is clean
# cache that WSL2 hands back to Windows once it is dropped. `sync` first, so nothing dirty is ever in it. Best effort: true when it
# was done, false when it could not be (the machine did not answer, no sudo): a setup is never stopped for it.
# After the drop the free memory is compacted too: what WSL needs to open a channel into the machine (every podman machine ssh, the API
# forwarding, a new container's I/O) is one contiguous piece (order 7, 512 KB), and a machine full of scattered free pages cannot give it.
function Invoke-JhtMachineDropCaches {
  param([Parameter(Mandatory)][string]$PodmanPath, [Parameter(Mandatory)][string]$MachineName)
  try {
    & { $ErrorActionPreference = 'Continue'; Invoke-JhtPodmanMachine -FilePath $PodmanPath -Arguments @('machine', 'ssh', $MachineName, 'sync && echo 3 | sudo timeout 30 tee /proc/sys/vm/drop_caches >/dev/null && echo 1 | sudo timeout 60 tee /proc/sys/vm/compact_memory >/dev/null') 2>$null | Out-Null }
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}

# The memory the machine's kernel keeps free, for good: with the memory limit (2 or 3 GB) a long pull filled the machine with page
# cache, and the kernel could no longer find one contiguous piece of 512 KB for a new vmbus channel («page allocation failure: order:7»
# in vmbus_alloc_ring, measured on a Windows 10 computer): every new session or connection into the machine failed with 0xffffffff
# (the setup's last steps, then `jht screen on` after the pull of the tools' image). vm.min_free_kbytes = 128 MB makes the kernel give
# cache back before free memory runs that low, and keeps it in pieces large enough. Written in /etc/sysctl.d, so it holds at every start
# of the machine; applied at once. Done before the first pull, while the machine has its memory; best effort: never a reason to stop.
$script:JhtMachineMinFreeKbytes = 131072
function Set-JhtMachineMemoryReserve {
  param([Parameter(Mandatory)][string]$PodmanPath, [Parameter(Mandatory)][string]$MachineName)
  $value = $script:JhtMachineMinFreeKbytes
  $command = "printf 'vm.min_free_kbytes = $value\n' | sudo timeout 30 tee /etc/sysctl.d/90-jht-memory.conf >/dev/null && sudo timeout 30 sysctl -q -w vm.min_free_kbytes=$value"
  try {
    & { $ErrorActionPreference = 'Continue'; Invoke-JhtPodmanMachine -FilePath $PodmanPath -Arguments @('machine', 'ssh', $MachineName, $command) 2>$null | Out-Null }
    return ($LASTEXITCODE -eq 0)
  } catch { return $false }
}

function Invoke-Checked {
  param([Parameter(Mandatory)][string]$FilePath, [Parameter(ValueFromRemainingArguments)][AllowEmptyString()][string[]]$Arguments)
  Invoke-JhtPodmanMachine -FilePath $FilePath -Arguments $Arguments
  if ($LASTEXITCODE -ne 0) { throw "Command failed ($LASTEXITCODE): $FilePath $($Arguments -join ' ')" }
}

function Get-JhtPodmanReadinessBudget {
  param([string]$Seconds = $env:JHT_MACHINE_WAIT_SECONDS)
  # Only ASCII digits can shorten the fixed thirty-second budget.
  if ($Seconds -cmatch '^[0-9]{1,3}$' -and [int]$Seconds -ge 1 -and [int]$Seconds -le 30) { return ([int]$Seconds * 1000) }
  return 30000
}

function New-JhtPodmanReadinessFailure {
  param([Nullable[int]]$StartExitCode, [long]$ElapsedMilliseconds, [string]$LogPath)
  $code = 'podman_machine_unavailable'
  Write-JhtPodmanBridgeEvent -Phase podman_machine_readiness -Code $code -ElapsedMilliseconds $ElapsedMilliseconds -ExitCode $StartExitCode -LogPath $LogPath
  $global:LASTEXITCODE = 22
  $start = if ($null -eq $StartExitCode) { 'not started' } else { [string]$StartExitCode }
  $failure = [TimeoutException]::new("${code}: The Podman machine is not ready (machine start: code $start).")
  $failure.Data['Code'] = $code
  $failure.Data['Phase'] = 'podman_machine_readiness'
  $failure.Data['StartExitCode'] = $StartExitCode
  return $failure
}

function Invoke-JhtPodmanReadiness {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$')][string]$Connection,
    [ValidateRange(1, 30000)][int]$TimeoutMilliseconds = 30000, [string]$LogPath = '',
    # run right before the machine is started (never when it already answers): it may throw to stop the start
    [scriptblock]$BeforeStart = $null
  )
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $startCode = $null
  try {
    while ($true) {
      $remaining = $TimeoutMilliseconds - [int]$watch.ElapsedMilliseconds
      if ($remaining -le 0) { throw (New-JhtPodmanReadinessFailure -StartExitCode $startCode -ElapsedMilliseconds $watch.ElapsedMilliseconds -LogPath $LogPath) }
      if ($null -ne $startCode -and $remaining -le 200) { Start-Sleep -Milliseconds $remaining; continue }
      $probe = Invoke-JhtPodmanProcess -FilePath $FilePath -Arguments @('--connection', $Connection, 'info') -Phase podman_machine_probe -TimeoutMilliseconds $remaining -LogPath $LogPath
      if ($probe.ExitCode -eq 0) {
        $global:LASTEXITCODE = 0
        return [pscustomobject]@{ Ready = $true; StartExitCode = $startCode; ElapsedMilliseconds = $watch.ElapsedMilliseconds }
      }
      if ($null -eq $startCode) {
        $remaining = $TimeoutMilliseconds - [int]$watch.ElapsedMilliseconds
        if ($remaining -le 0) { throw (New-JhtPodmanReadinessFailure -StartExitCode $startCode -ElapsedMilliseconds $watch.ElapsedMilliseconds -LogPath $LogPath) }
        if ($BeforeStart) { & $BeforeStart }
        $started = Invoke-JhtPodmanProcess -FilePath $FilePath -Arguments @('machine', 'start', '--update-connection=false', $Connection) -Phase podman_machine_start -TimeoutMilliseconds $remaining -LogPath $LogPath
        $startCode = $started.ExitCode
      } else {
        $remaining = $TimeoutMilliseconds - [int]$watch.ElapsedMilliseconds
        if ($remaining -gt 0) { Start-Sleep -Milliseconds ([Math]::Min(200, $remaining)) }
      }
    }
  } catch {
    $_.Exception.Data['StartExitCode'] = $startCode
    throw
  }
}

function Update-ProcessPath {
  [CmdletBinding()]
  param(
    [string]$MachinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine'),
    [string]$UserPath = [Environment]::GetEnvironmentVariable('Path', 'User'),
    [string]$ProcessPath = $env:PATH,
    [switch]$PreserveProcessFirst
  )
  if ($PreserveProcessFirst) {
    $env:PATH = @($ProcessPath, $MachinePath, $UserPath) -join [IO.Path]::PathSeparator
    return
  }
  $env:PATH = @(
    $MachinePath,
    $UserPath,
    $ProcessPath
  ) -join [IO.Path]::PathSeparator
}

function Start-JhtPodmanMachineForUp {
  param([string]$Runtime, [string]$Connection)
  if ($Runtime -ne 'podman') { return }
  Update-ProcessPath -PreserveProcessFirst
  $podman = Get-Command podman.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $podman) {
    Write-JhtPodmanBridgeEvent -Phase podman_machine_readiness -Code podman_not_installable
    [Console]::Error.WriteLine('podman_not_installable: podman.exe is unavailable.'); exit 21
  }
  # As in the installer: with a Podman whose win-sshproxy.exe stops at once when this logon may not write to the event log (ssh, a
  # service, a scheduled task), no pipe there yet and a refusal, the machine is not even started.
  # No .GetNewClosure(): a closure runs in a module of its own, which does not see the functions the wrapper dot-sourced into the
  # scope of Start-PodmanMachineForUp; as plain script block it sees them, and $podman and $Connection, by dynamic scope.
  $beforeStart = {
    if ((Get-JhtPodmanPipeState -MachineName $Connection) -ceq 'absent' -and
        (Test-JhtWinSshProxyNeedsEventLog -PodmanVersion (Get-JhtPodmanExeVersion -Path $podman.Source)) -and
        (Test-JhtEventLogWritable) -ceq 'denied') {
      throw (Get-JhtApiForwardingFailure -MachineName $Connection -EventLogDenied $true -Started $false -What 'jht command')
    }
  }
  try {
    $ready = Invoke-JhtPodmanReadiness -FilePath $podman.Source -Connection $Connection -TimeoutMilliseconds (Get-JhtPodmanReadinessBudget) -BeforeStart $beforeStart
    # This call started the machine, so nothing of the team runs in it: if Podman's connection for Docker tools did not come up,
    # one stop and start, and then the same stop as the installer's (compose would only say «cannot find the file»).
    if ($null -ne $ready.StartExitCode -and (Wait-JhtPodmanPipe -MachineName $Connection) -ceq 'absent') {
      Invoke-JhtPodmanMachine -FilePath $podman.Source -Arguments @('machine', 'stop', $Connection)
      if ($LASTEXITCODE -ne 0) { throw "podman_machine_unavailable: The Podman machine did not stop (machine stop: code $LASTEXITCODE)." }
      $null = Invoke-JhtPodmanReadiness -FilePath $podman.Source -Connection $Connection -TimeoutMilliseconds (Get-JhtPodmanReadinessBudget)
      if ((Wait-JhtPodmanPipe -MachineName $Connection) -ceq 'absent') {
        throw (Get-JhtApiForwardingFailure -MachineName $Connection -Reason (Get-JhtWinSshProxyReason -MachineName $Connection) -Restarted $true -SessionId (Get-JhtWindowsSessionId) -What 'jht command')
      }
    }
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    if ($_.Exception.Message -clike 'podman_api_forwarding_unavailable: *') { exit 26 }
    if ($_.Exception.Data['Code'] -in @('podman_machine_timeout', 'podman_machine_cleanup_failed')) { exit 124 }
    exit 22
  }
}

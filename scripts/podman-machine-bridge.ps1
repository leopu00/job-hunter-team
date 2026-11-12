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
            string line = "  ... still " + label + " (" + Format(watch.Elapsed) + (detail.Length > 0 ? ", " + detail : "") + ")";
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

# What a person is told before each long machine command, and what the wait line says it is doing.
function Get-JhtPodmanMachineAnnouncement {
  param([string]$Verb)
  switch ($Verb) {
    'init' { return @{ Said = 'Creating the Linux machine for Podman: it downloads its system image (several hundred MB) and sets it up. This takes several minutes.'; Doing = 'creating the Linux machine' } }
    'start' { return @{ Said = 'Starting the Linux machine (about a minute).'; Doing = 'starting the Linux machine' } }
    'stop' { return @{ Said = 'Stopping the Linux machine.'; Doing = 'stopping the Linux machine' } }
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
      if ($result.ExitCode -eq 0) { Write-JhtPodmanNotes -Lines (Get-JhtPodmanTextLines -Text $result.Stderr) -Human (Test-JhtHumanOutput) }
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
  # what is going on, sees a line every few seconds, and reads Podman's own words afterwards as plain notes,
  # not as the error records of PowerShell. A command that fails still leaves its stderr, and the caller's
  # own message with the code.
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
    foreach ($line in (Get-JhtPodmanTextLines -Text $result.Stdout)) { Write-Host "    $line" -ForegroundColor DarkGray }
    # on a failure the lines go to stderr as plain text, as the app reads them
    Write-JhtPodmanNotes -Lines $errorLines -Human ($result.ExitCode -eq 0)
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

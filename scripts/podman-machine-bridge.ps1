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
$script:JhtWslLimitWaitsText = '  WSL is already running: the memory limit applies from the next restart of Windows, or of WSL (wsl --shutdown stops all your WSL distributions, so it is not done for you).'

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
      Write-Host '  WSL memory: no limit was set, because other WSL distributions are registered and a limit would apply to them too.' -ForegroundColor Yellow
      Write-Host "  To set one yourself: in $path, under [wsl2], add memory=$advice (it applies after the next restart of Windows or of WSL)." -ForegroundColor Yellow
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
  Write-Host "  WSL settings added to ${path}:" -ForegroundColor Cyan
  foreach ($entry in @($answer.Added)) { Write-Host "    [$($entry.Section)] $($entry.Key)=$($entry.Value)" -ForegroundColor Cyan }
  Write-Host '  To undo it: jht uninstall takes these lines out, or delete them by hand (each has a comment line above it).' -ForegroundColor DarkGray
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

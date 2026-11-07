param(
  [ValidateSet(5, 7)][int]$ExpectedMajor = $PSVersionTable.PSVersion.Major,
  [string]$ModulePath = (Join-Path $PSScriptRoot 'podman-machine-bridge.ps1'),
  [switch]$WithoutDeadlineChild, [string]$FakePath = '', [string]$FixtureRoot = ''
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne $ExpectedMajor) { throw 'Wrong PowerShell interpreter.' }
. $ModulePath

if ($WithoutDeadlineChild) {
  $env:JHT_PODMAN_FIXTURE_ROOT = $FixtureRoot
  Invoke-JhtPodmanProcess -FilePath $FakePath -Arguments @('machine', 'ssh', 'jht-fixture', 'hang') -Phase podman_machine_ssh -TimeoutMilliseconds 1000 -LogPath (Join-Path $FixtureRoot 'runtime.log')
  throw 'The deadline-free counter-proof unexpectedly returned.'
}

function Assert-JhtDeadlineCase {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function New-JhtDeadlineCase {
  param([string]$Name)
  $case = Join-Path $script:Sandbox $Name
  [void][IO.Directory]::CreateDirectory($case)
  $env:JHT_PODMAN_FIXTURE_ROOT = $case
  return $case
}

function Stop-JhtFixtureChildren {
  foreach ($file in @(Get-ChildItem -LiteralPath $script:Sandbox -Filter '*.pid' -Recurse -File)) {
    $child = Get-JhtFixtureProcess $file.FullName
    if (-not $child) { continue }
    try {
      if (-not $child.HasExited) {
        $child.Kill()
        Assert-JhtDeadlineCase ($child.WaitForExit(2000)) 'The fake child could not be stopped.'
      }
    } finally { $child.Dispose() }
  }
}

function Get-JhtFixtureProcess {
  param([string]$PidFile)
  $fixtureId = [int][IO.File]::ReadAllText($PidFile)
  Assert-JhtDeadlineCase ($fixtureId -gt 0) 'Invalid fixture process identity.'
  try { $child = [Diagnostics.Process]::GetProcessById($fixtureId) } catch [ArgumentException] { return $null }
  try {
    $identity = $null
    if (-not $child.HasExited) {
      try { $identity = $child.MainModule.FileName } catch { if (-not $child.HasExited) { throw } }
    }
    if (-not $child.HasExited -and -not $identity) { throw 'Fixture process identity could not be verified.' }
    if (-not $child.HasExited -and -not [string]::Equals($identity, $script:Fake, [StringComparison]::OrdinalIgnoreCase)) {
      [Console]::Out.WriteLine("T205_FIXTURE_PID_REUSED pid=$fixtureId")
      $child.Dispose()
      return $null
    }
    return $child
  } catch { $child.Dispose(); throw }
}

function Wait-JhtFixtureImageRelease {
  param([ValidateRange(0, 5000)][int]$TimeoutMilliseconds = 5000)
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $fileCode = 0
  do {
    $alive = @()
    foreach ($file in @(Get-ChildItem -LiteralPath $script:Sandbox -Filter '*.pid' -Recurse -File)) {
      $child = Get-JhtFixtureProcess $file.FullName
      if (-not $child) { continue }
      try { if (-not $child.WaitForExit(0)) { $alive += $child.Id } } finally { $child.Dispose() }
    }
    if ($alive.Count -eq 0) {
      try {
        # Deny new readers/writers while permitting our ONE deletion through this lease.
        return [IO.File]::Open($script:Fake, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Delete)
      } catch {
        $reason = $_.Exception
        while ($reason.InnerException) { $reason = $reason.InnerException }
        if (-not ($reason -is [IO.IOException] -or $reason -is [UnauthorizedAccessException])) { throw }
        $fileCode = $reason.HResult -band 0xffff
      }
    }
    if ($clock.ElapsedMilliseconds -ge $TimeoutMilliseconds) {
      if ($alive.Count) { throw "fixture_process_alive: owned_pids=$($alive -join ',') elapsed_ms=$($clock.ElapsedMilliseconds)" }
      throw "fixture_file_not_released: owned_pids_exited=true win32=$fileCode elapsed_ms=$($clock.ElapsedMilliseconds)"
    }
    Start-Sleep -Milliseconds ([int][Math]::Max(0, [Math]::Min(20, $TimeoutMilliseconds - $clock.ElapsedMilliseconds)))
  } while ($true)
}

function Test-JhtFixtureImageFence {
  $held = [IO.File]::Open($script:Fake, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $failure = $null
  try {
    try { $unexpected = Wait-JhtFixtureImageRelease -TimeoutMilliseconds 0; $unexpected.Dispose() } catch { $failure = $_.Exception }
    Assert-JhtDeadlineCase ($failure -and $failure.Message.StartsWith('fixture_file_not_released:')) 'A real held image did not block fixture deletion.'
    Assert-JhtDeadlineCase ($failure.Message.Contains('win32=32 ')) 'The held image did not produce the real sharing violation.'
  } finally { $held.Dispose() }
}

function Test-JhtMachineDeadline {
  param([string]$Action)
  $case = New-JhtDeadlineCase $Action
  $failed = $null
  $clock = [Diagnostics.Stopwatch]::StartNew()
  try {
    Invoke-JhtPodmanProcess -FilePath $script:Fake -Arguments @('machine', $Action, 'jht-fixture', 'hang') -Phase ('podman_machine_' + $Action) -TimeoutMilliseconds 2000 -LogPath (Join-Path $case 'runtime.log') | Out-Null
  } catch { $failed = $_.Exception }
  Assert-JhtDeadlineCase ($clock.ElapsedMilliseconds -le 12000) 'The 2s deadline exceeded its 6s cleanup allowance and 4s scheduling margin.'
  Assert-JhtDeadlineCase ($null -ne $failed -and $failed.Data['Code'] -eq 'podman_machine_timeout') "Missing real timeout for $Action."
  Assert-JhtDeadlineCase ($failed.Data['Phase'] -eq ('podman_machine_' + $Action)) 'Timeout lost its phase.'
  Assert-JhtDeadlineCase ($LASTEXITCODE -eq 124) 'Timeout lost its exit code.'
  $calls = [IO.File]::ReadAllLines((Join-Path $case 'calls.log'))
  Assert-JhtDeadlineCase ($calls.Count -eq 1) 'The timed-out Podman call was repeated.'
  foreach ($name in 'parent.pid', 'child.pid', 'grandchild.pid') {
    $pidFile = Join-Path $case $name
    Assert-JhtDeadlineCase ([IO.File]::Exists($pidFile)) "Fake process did not start: $name"
    $child = Get-JhtFixtureProcess $pidFile
    if ($child) {
      try { Assert-JhtDeadlineCase ($child.WaitForExit(2000)) "Fake process survived: $name" } finally { $child.Dispose() }
    }
  }
  $log = [IO.File]::ReadAllText((Join-Path $case 'runtime.log'))
  Assert-JhtDeadlineCase ($log.Contains('podman_machine_timeout') -and $log.Contains('podman_machine_' + $Action)) 'Runtime log lost timeout or phase.'
  Assert-JhtDeadlineCase (-not $log.Contains('synthetic-private-detail')) 'Private output reached runtime.log.'
  [Console]::Out.WriteLine("T205_CASE engine=$($PSVersionTable.PSVersion) action=$Action timeout124 elapsed_ms=$($clock.ElapsedMilliseconds) tree_stopped=true log_verified=true calls=1 PASS")
}

function Test-JhtMachineAnswers {
  $case = New-JhtDeadlineCase 'answers'
  $values = @('machine', 'ssh', 'jht-fixture', 'printf "%s" "two words"', '', 'C:\Ada Fixture\tail\', 'a\"b')
  $result = Invoke-JhtPodmanProcess -FilePath $script:Fake -Arguments $values -Phase podman_machine_ssh -TimeoutMilliseconds 10000
  Assert-JhtDeadlineCase ($result.ExitCode -eq 0 -and $result.OutputComplete) 'Successful output was not complete.'
  $seen = @($result.Stdout.TrimEnd("`r", "`n") -split '\r?\n' | ForEach-Object { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) })
  Assert-JhtDeadlineCase ($seen.Count -eq $values.Count) 'Argument cardinality changed.'
  for ($index = 0; $index -lt $values.Count; $index++) { Assert-JhtDeadlineCase ($seen[$index] -ceq $values[$index]) "Argument changed: $index" }
  $result = Invoke-JhtPodmanProcess -FilePath $script:Fake -Arguments @('machine', 'ssh', 'jht-fixture', 'fail') -Phase podman_machine_ssh -TimeoutMilliseconds 10000
  Assert-JhtDeadlineCase ($result.ExitCode -eq 17 -and $result.Stderr.Contains('synthetic-private-detail')) 'Failed command lost its real exit or stderr.'
  Assert-JhtDeadlineCase ($LASTEXITCODE -eq 17) 'Failed command lost LASTEXITCODE.'
  Assert-JhtDeadlineCase ($result.OutputComplete) 'Failed command output was silently incomplete.'
  [Console]::Out.WriteLine("T205_CASE engine=$($PSVersionTable.PSVersion) argv_roundtrip=true failed_exit17=true PASS")
}

function Test-JhtMissingProgram {
  $case = New-JhtDeadlineCase 'missing'
  $failed = $null
  try {
    Invoke-JhtPodmanProcess -FilePath (Join-Path $case 'absent-podman.exe') -Arguments @('machine', 'ssh') -Phase podman_machine_ssh -TimeoutMilliseconds 1000 -LogPath (Join-Path $case 'runtime.log') | Out-Null
  } catch { $failed = $_.Exception }
  Assert-JhtDeadlineCase ($null -ne $failed -and $failed.Data['Code'] -eq 'podman_machine_command_failed') 'Missing executable escaped structured failure.'
  Assert-JhtDeadlineCase ($failed.Data['Phase'] -eq 'podman_machine_ssh' -and $LASTEXITCODE -ne 0) 'Missing executable lost its phase/exit.'
  Assert-JhtDeadlineCase ([IO.File]::ReadAllText((Join-Path $case 'runtime.log')).Contains('podman_machine_command_failed')) 'Missing executable was not logged.'
  [Console]::Out.WriteLine("T205_CASE engine=$($PSVersionTable.PSVersion) missing_program_normalized=true PASS")
}

function Test-JhtCaptureBound {
  $case = New-JhtDeadlineCase 'oversized'
  $failed = $null
  try {
    Invoke-JhtPodmanProcess -FilePath $script:Fake -Arguments @('machine', 'ssh', 'jht-fixture', 'oversized') -Phase podman_machine_ssh -TimeoutMilliseconds 10000 -LogPath (Join-Path $case 'runtime.log') | Out-Null
  } catch { $failed = $_.Exception }
  Assert-JhtDeadlineCase ($null -ne $failed -and $failed.Data['Code'] -eq 'podman_machine_command_failed') 'A truncated answer was accepted as a complete answer.'
  Assert-JhtDeadlineCase ($failed.Data['Phase'] -eq 'podman_machine_ssh' -and $LASTEXITCODE -ne 0) 'The capture bound lost its phase/exit.'
  $log = [IO.File]::ReadAllText((Join-Path $case 'runtime.log'))
  Assert-JhtDeadlineCase ($log.Contains('podman_machine_command_failed') -and -not $log.Contains('synthetic-private-detail')) 'The capture bound lost its fixed event or logged private output.'
  $helper = Get-JhtFixtureProcess (Join-Path $case 'oversized-child.pid')
  if ($helper) {
    try { Assert-JhtDeadlineCase ($helper.WaitForExit(2000)) 'A rejected capture left its helper running.' } finally { $helper.Dispose() }
  }
  [Console]::Out.WriteLine("T205_CASE engine=$($PSVersionTable.PSVersion) oversized_answer_rejected=true PASS")
}

function Test-JhtInheritedPipe {
  $case = New-JhtDeadlineCase 'inherited-pipe'
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $result = Invoke-JhtPodmanProcess -FilePath $script:Fake -Arguments @('machine', 'ssh', 'jht-fixture', 'pipe-held') -Phase podman_machine_ssh -TimeoutMilliseconds 1000
  Assert-JhtDeadlineCase ($result.ExitCode -eq 0 -and -not $result.OutputComplete) 'Inherited open pipe was silently declared complete.'
  Assert-JhtDeadlineCase ($clock.ElapsedMilliseconds -le 6000) 'The pipe drain did not keep its deadline.'
  $helper = Get-JhtFixtureProcess (Join-Path $case 'child.pid')
  Assert-JhtDeadlineCase ($null -ne $helper) 'A successful command killed its permitted helper.'
  try {
    Assert-JhtDeadlineCase (-not $helper.HasExited) 'A successful command killed its permitted helper.'
    $failure = $null
    try { $unexpected = Wait-JhtFixtureImageRelease -TimeoutMilliseconds 0; $unexpected.Dispose() } catch { $failure = $_.Exception }
    Assert-JhtDeadlineCase ($failure -and $failure.Message.StartsWith('fixture_process_alive:')) 'The fixture fence missed a live owned helper.'
    Assert-JhtDeadlineCase (-not $helper.HasExited) 'The fixture fence killed a permitted live helper.'
  } finally { $helper.Dispose() }
  Stop-JhtFixtureChildren
  [IO.File]::Delete((Join-Path $case 'child.pid'))
  $failed = $null
  try { Invoke-JhtPodmanMachine -FilePath $script:Fake -Arguments @('machine', 'ssh', 'jht-fixture', 'pipe-held') | Out-Null } catch { $failed = $_.Exception }
  Assert-JhtDeadlineCase ($null -ne $failed -and $failed.Data['Code'] -eq 'podman_machine_command_failed') 'The SSH adapter accepted an incomplete inherited pipe.'
  $pidFile = Join-Path $case 'child.pid'
  Assert-JhtDeadlineCase ([IO.File]::Exists($pidFile)) 'The rejected adapter never started its real helper.'
  $helper = Get-JhtFixtureProcess $pidFile
  if ($helper) {
    try { Assert-JhtDeadlineCase ($helper.WaitForExit(2000)) 'The rejected SSH answer left its helper running.' } finally { $helper.Dispose() }
  }
  Stop-JhtFixtureChildren
  [Console]::Out.WriteLine("T205_CASE engine=$($PSVersionTable.PSVersion) inherited_pipe_incomplete=true ssh_rejected=true permitted_helper_alive=true rejected_helper_stopped=true PASS")
}

function Test-JhtWithoutDeadlineCounterProof {
  $case = New-JhtDeadlineCase 'without-deadline'
  $copy = Join-Path $case 'podman-machine-bridge.ps1'
  $source = [IO.File]::ReadAllText($ModulePath)
  $needle = '$process.WaitForExit($remaining)'
  Assert-JhtDeadlineCase ([regex]::Matches($source, [regex]::Escape($needle)).Count -eq 1) 'Counter-proof must mutate the unique real child deadline.'
  [IO.File]::WriteAllText($copy, $source.Replace($needle, '$process.WaitForExit()'), [Text.UTF8Encoding]::new($false))
  $owner = [JhtPodmanOwnedProcess]::new()
  $child = $null; $capture = $null
  try {
    $binary = if ($ExpectedMajor -eq 5) { 'powershell.exe' } else { 'pwsh.exe' }
    $arguments = ConvertTo-JhtPodmanNativeArguments -Arguments @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-ExpectedMajor', [string]$ExpectedMajor, '-ModulePath', $copy, '-WithoutDeadlineChild', '-FakePath', $script:Fake, '-FixtureRoot', $case)
    $owner.Start((Join-Path $PSHOME $binary), $arguments)
    $child = $owner.Process
    $capture = [JhtPodmanBridgeCapture]::new($owner.Output, $owner.Error)
    $bootstrap = [Diagnostics.Stopwatch]::StartNew()
    while (-not [IO.File]::Exists((Join-Path $case 'ready'))) {
      Assert-JhtDeadlineCase (-not $child.HasExited -and $bootstrap.ElapsedMilliseconds -lt 20000) 'Counter-proof never reached the fake hung Podman.'
      Start-Sleep -Milliseconds 20
    }
    Assert-JhtDeadlineCase (-not $child.WaitForExit(3000)) 'Removing the deadline did not make the actual command hang.'
    Assert-JhtDeadlineCase (Stop-JhtPodmanProcessTree -Process $child -Owner $owner) 'Outer counter-proof watchdog could not stop its own tree.'
    [Console]::Out.WriteLine("T205_CASE engine=$($PSVersionTable.PSVersion) without_deadline_hangs=true outer_watchdog_stopped=true PASS")
  } finally {
    if ($owner.HasProcess) { Assert-JhtDeadlineCase ($owner.Stop(5000)) 'Counter-proof fixture cleanup failed.' }
    if ($capture) { $capture.Close() }
    $owner.Dispose()
  }
}

$oldFixtureRoot = $env:JHT_PODMAN_FIXTURE_ROOT
$script:Sandbox = Join-Path ([IO.Path]::GetTempPath()) ('jht-podman-deadline [case] ' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($script:Sandbox)
$script:Fake = Join-Path $script:Sandbox 'podman.exe'
$completed = $false
try {
  $source = @'
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
public static class PodmanDeadlineFake {
    public static int Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        string root = Environment.GetEnvironmentVariable("JHT_PODMAN_FIXTURE_ROOT");
        if (args.Length == 1 && args[0] == "leaf") { Thread.Sleep(Timeout.Infinite); return 0; }
        if (args.Length == 1 && args[0] == "branch") {
            var grandchild = Process.Start(new ProcessStartInfo {
                FileName = Process.GetCurrentProcess().MainModule.FileName,
                Arguments = "leaf", UseShellExecute = false, CreateNoWindow = true
            });
            File.WriteAllText(Path.Combine(root, "grandchild.pid"), grandchild.Id.ToString());
            Thread.Sleep(Timeout.Infinite); return 0;
        }
        if (args.Length == 1 && args[0] == "pipe-leaf") {
            Console.Out.WriteLine("pipe-leaf"); Console.Out.Flush();
            File.WriteAllText(Path.Combine(root, "pipe-ready"), "ready");
            Thread.Sleep(Timeout.Infinite); return 0;
        }
        File.AppendAllText(Path.Combine(root, "calls.log"), String.Join("|", args) + "\n");
        if (Array.IndexOf(args, "pipe-held") >= 0) {
            File.Delete(Path.Combine(root, "pipe-ready"));
            var child = Process.Start(new ProcessStartInfo {
                FileName = Process.GetCurrentProcess().MainModule.FileName,
                Arguments = "pipe-leaf", UseShellExecute = false, CreateNoWindow = true
            });
            File.WriteAllText(Path.Combine(root, "child.pid"), child.Id.ToString());
            var watch = Stopwatch.StartNew();
            while (!File.Exists(Path.Combine(root, "pipe-ready"))) {
                if (watch.ElapsedMilliseconds > 10000) return 98;
                Thread.Sleep(10);
            }
            return 0;
        }
        bool hang = Array.IndexOf(args, "hang") >= 0;
        if (hang) {
            var child = Process.Start(new ProcessStartInfo {
                FileName = Process.GetCurrentProcess().MainModule.FileName,
                Arguments = "branch", UseShellExecute = false, CreateNoWindow = true
            });
            File.WriteAllText(Path.Combine(root, "parent.pid"), Process.GetCurrentProcess().Id.ToString());
            File.WriteAllText(Path.Combine(root, "child.pid"), child.Id.ToString());
            var ready = Stopwatch.StartNew();
            while (!File.Exists(Path.Combine(root, "grandchild.pid"))) {
                if (ready.ElapsedMilliseconds > 10000) return 98;
                Thread.Sleep(10);
            }
            File.WriteAllText(Path.Combine(root, "ready"), "ready");
            Console.Error.WriteLine("synthetic-private-detail");
            Console.Out.Write(new string('x', 8192));
            Console.Error.Write(new string('y', 8192));
            Thread.Sleep(Timeout.Infinite);
        }
        if (Array.IndexOf(args, "fail") >= 0) { Console.Error.WriteLine("synthetic-private-detail"); return 17; }
        if (Array.IndexOf(args, "oversized") >= 0) {
            var child = Process.Start(new ProcessStartInfo {
                FileName = Process.GetCurrentProcess().MainModule.FileName,
                Arguments = "leaf", UseShellExecute = false, CreateNoWindow = true
            });
            File.WriteAllText(Path.Combine(root, "oversized-child.pid"), child.Id.ToString());
            Console.Out.Write(new string('z', 300000)); Console.Error.WriteLine("synthetic-private-detail"); return 0;
        }
        foreach (string value in args) Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(value)));
        return 0;
    }
}
'@
  $code = Join-Path $script:Sandbox 'podman.cs'
  [IO.File]::WriteAllText($code, $source, [Text.UTF8Encoding]::new($false))
  $compiler = Join-Path ([Environment]::GetFolderPath('Windows')) 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
  & $compiler /nologo /target:exe ("/out:" + $script:Fake) $code
  if ($LASTEXITCODE -ne 0 -or -not [IO.File]::Exists($script:Fake)) { throw 'Native Podman fixture did not compile.' }
  foreach ($action in 'ssh', 'start', 'init') { Test-JhtMachineDeadline $action }
  Test-JhtMachineAnswers
  Test-JhtMissingProgram
  Test-JhtCaptureBound
  Test-JhtInheritedPipe
  Test-JhtWithoutDeadlineCounterProof
  Test-JhtFixtureImageFence
  $completed = $true
} finally {
  try {
    if (-not $completed) { Stop-JhtFixtureChildren }
    $lease = Wait-JhtFixtureImageRelease
    try { Remove-Item -LiteralPath $script:Fake -Force } finally { $lease.Dispose() }
    Remove-Item -LiteralPath $script:Sandbox -Recurse -Force
    Assert-JhtDeadlineCase (-not [IO.Directory]::Exists($script:Sandbox)) 'The fixture sandbox remained after cleanup.'
  } catch {
    $failure = $_
    if ([IO.Directory]::Exists($script:Sandbox)) { Stop-JhtFixtureChildren }
    throw $failure
  } finally { $env:JHT_PODMAN_FIXTURE_ROOT = $oldFixtureRoot }
}
[Console]::Out.WriteLine("T205_FIXTURE_CLEANUP engine=$($PSVersionTable.PSVersion) held_lock_rejected=true released=true sandbox_removed=true PASS")
[Console]::Out.WriteLine("T205_DEADLINE_SELFTEST engine=$($PSVersionTable.PSVersion) PASS")

#!/usr/bin/env pwsh
# Native causal oracle for the in-memory PowerShell guard, without Godot/NSIS.

$ErrorActionPreference = 'Stop'

function Read-GuardProgram {
  param([string]$Path)
  $raw = [IO.File]::ReadAllBytes($Path)
  if ($raw.Length -eq 0 -or $raw.Length -ge 10000 -or $raw[-1] -ne 10 -or
      $raw -contains 0 -or $raw -contains 13 -or @($raw | Where-Object { $_ -gt 127 }).Count -ne 0) {
    throw 'Windows instance guard native selftest failed: source_contract.'
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $digest = ([BitConverter]::ToString($sha.ComputeHash($raw))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([Text.Encoding]::UTF8.GetString($raw)))
  $roundTrip = [Text.Encoding]::UTF8.GetBytes([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($encoded)))
  if ([Convert]::ToBase64String($roundTrip) -cne [Convert]::ToBase64String($raw)) {
    throw 'Windows instance guard native selftest failed: encoded_roundtrip.'
  }
  return [pscustomobject]@{ Raw = $raw; Digest = $digest; Encoded = $encoded }
}

function Read-GuardFrames {
  param([IO.Stream]$Stream)
  $received = New-Object Collections.Generic.List[byte]
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while (@($received | Where-Object { $_ -eq 10 }).Count -lt 2) {
    $buffer = New-Object byte[] 2048
    $readTask = $Stream.ReadAsync($buffer, 0, $buffer.Length)
    $remaining = [int][Math]::Max(1, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
    if ([DateTime]::UtcNow -ge $deadline -or -not $readTask.Wait($remaining)) {
      throw 'Windows instance guard native selftest failed: ready_timeout.'
    }
    $count = $readTask.Result
    if ($count -le 0) { throw 'Windows instance guard native selftest failed: ready_eof.' }
    for ($index = 0; $index -lt $count; $index++) { $received.Add($buffer[$index]) }
    if ($received.Count -gt 4096) { throw 'Windows instance guard native selftest failed: frame_size.' }
  }
  return ,($received.ToArray())
}

function Assert-GuardHandshake {
  param([byte[]]$FramesRaw, [string]$AckPath, [object]$Expected)
  foreach ($byte in $FramesRaw) {
    if (($byte -lt 32 -and $byte -ne 10) -or $byte -gt 126) {
      throw 'Windows instance guard native selftest failed: frame_bytes.'
    }
  }
  $frames = (New-Object Text.UTF8Encoding($false, $true)).GetString($FramesRaw).Split([char]10)
  $readyLine = $frames[0]
  try { $ready = $readyLine | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'Windows instance guard native selftest failed: ready_json.' }
  if ($ready.schema -ne 1 -or $ready.type -cne 'ready' -or
      $ready.desktop_pid -ne $Expected.DesktopPid -or $ready.guard_pid -ne $Expected.GuardPid -or
      $ready.request_token -cne $Expected.Token -or $ready.source_sha256 -cne $Expected.Digest) {
    throw 'Windows instance guard native selftest failed: ready_binding.'
  }
  if (-not (Test-Path -LiteralPath $AckPath -PathType Leaf)) {
    throw 'Windows instance guard native selftest failed: ack_missing.'
  }
  try { $ack = Get-Content -LiteralPath $AckPath -Raw | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'Windows instance guard native selftest failed: ack_json.' }
  if (($ack | ConvertTo-Json -Compress) -cne $readyLine) {
    throw 'Windows instance guard native selftest failed: ack_binding.'
  }
  if ($frames[1] -cne 'ALIVE') {
    throw 'Windows instance guard native selftest failed: heartbeat.'
  }
  return $readyLine
}

function Invoke-GuardOracle {
  param([object]$Program)
  $token = 'guard-' + [guid]::NewGuid().ToString('N')
  $request = [ordered]@{
    desktop_pid = $PID
    instance_id = 'instance-' + ([guid]::NewGuid().ToString('N').Substring(0, 24))
    mode = 'normal'
    nonce = [guid]::NewGuid().ToString('N')
    request_id = 'normal-' + ([guid]::NewGuid().ToString('N').Substring(0, 24))
    request_token = $token
    schema = 1
    source_sha256 = $Program.Digest
  } | ConvertTo-Json -Compress
  $guardRoot = Join-Path $env:LOCALAPPDATA 'Job Hunter Team/host-runtime/instance-guard'
  $ackPath = Join-Path $guardRoot ('ack-' + $token + '.json')
  $powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
  $process = $null; $started = $false; $result = $null
  try {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $powershell
    $start.Arguments = '-NoLogo -NoProfile -NonInteractive -EncodedCommand ' + $Program.Encoded
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.StandardOutputEncoding = New-Object Text.UTF8Encoding($false, $true)
    $start.EnvironmentVariables['JHT_INSTANCE_GUARD_REQUEST'] = $request
    $start.EnvironmentVariables['JHT_WINDOWS_INSTANCE_GUARD_PCK_TEST'] = '1'
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    if (-not $process.Start()) { throw 'Windows instance guard native selftest failed: launch.' }
    $started = $true
    $expected = [pscustomobject]@{ DesktopPid = $PID; GuardPid = $process.Id; Token = $token; Digest = $Program.Digest }
    $framesRaw = Read-GuardFrames -Stream $process.StandardOutput.BaseStream
    $readyLine = Assert-GuardHandshake -FramesRaw $framesRaw -AckPath $ackPath -Expected $expected
    $result = [pscustomobject]@{ FramesRaw = $framesRaw; ReadyLine = $readyLine; AckText = (Get-Content -LiteralPath $ackPath -Raw); Expected = $expected }
  } finally {
    if ($started -and -not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    $exited = -not $started -or $process.HasExited
    if ($process) { $process.Dispose() }
    Remove-Item -LiteralPath @($ackPath) -Force -ErrorAction SilentlyContinue
    $ackAbsent = -not (Test-Path -LiteralPath $ackPath)
    Write-Host "WINDOWS-INSTANCE-GUARD-CLEANUP started=$started exited=$exited ack_absent=$ackAbsent"
    if (-not $exited -or -not $ackAbsent) { throw 'Windows instance guard native selftest failed: cleanup.' }
  }
  return $result
}

$script:negativeCases = New-Object Collections.Generic.List[string]
function Expect-GuardRejection {
  param([string]$Case, [string]$Code, [scriptblock]$Action, [type]$ExceptionType)
  $failure = $null
  try { $null = & $Action } catch { $failure = $_ }
  if ($null -eq $failure) { throw "Windows instance guard negative not refused: $Case" }
  if ($null -ne $ExceptionType) {
    $exception = $failure.Exception
    while ($null -ne $exception -and -not $ExceptionType.IsInstanceOfType($exception)) { $exception = $exception.InnerException }
    if ($null -eq $exception) { throw $failure }
  } elseif (-not $failure.Exception.Message.Contains("selftest failed: $Code.")) { throw $failure }
  $script:negativeCases.Add($Case)
  Write-Output "WINDOWS-INSTANCE-GUARD-NEGATIVE PASS case=$Case code=$Code"
}

$sourcePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/support/windows_instance_guard.ps1'
$program = Read-GuardProgram -Path $sourcePath
Write-Output "WINDOWS-INSTANCE-GUARD-INPUT source=game/scripts/support/windows_instance_guard.ps1 bytes=$($program.Raw.Length) sha256=$($program.Digest) encoded_chars=$($program.Encoded.Length)"
$observed = Invoke-GuardOracle -Program $program
Write-Output 'WINDOWS-INSTANCE-GUARD-NATIVE PASS ready=1 ack=1 heartbeat=1'

# Counterfactual inputs are separate fixtures. Never rewrite the real program,
# manufacture an alternate guard, concatenate source chunks or use a fallback.
$caseRoot = Join-Path ([IO.Path]::GetTempPath()) ('jht-instance-guard-negative-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($caseRoot)
try {
  $caseSource = Join-Path $caseRoot 'guard-source.ps1'
  Expect-GuardRejection -Case 'source-missing' -Code 'source_missing' -ExceptionType ([IO.FileNotFoundException]) -Action {
    Read-GuardProgram -Path (Join-Path $caseRoot 'missing.ps1')
  }
  $withoutLf = New-Object byte[] ($program.Raw.Length - 1)
  [Array]::Copy($program.Raw, 0, $withoutLf, 0, $withoutLf.Length)
  $nonAscii = [byte[]]$program.Raw.Clone(); $nonAscii[0] = 255
  $nul = [byte[]]$program.Raw.Clone(); $nul[0] = 0
  $cr = [byte[]]$program.Raw.Clone(); $cr[0] = 13
  $sizeLimitSource = New-Object byte[] 10000
  for ($index = 0; $index -lt $sizeLimitSource.Length; $index++) { $sizeLimitSource[$index] = 32 }
  $sizeLimitSource[-1] = 10
  $invalidSources = @(
    @{ Name = 'source-empty'; Bytes = [byte[]]@() },
    @{ Name = 'source-truncated-no-lf'; Bytes = $withoutLf },
    @{ Name = 'source-non-ascii'; Bytes = $nonAscii },
    @{ Name = 'source-nul'; Bytes = $nul },
    @{ Name = 'source-cr'; Bytes = $cr },
    @{ Name = 'source-size-limit'; Bytes = $sizeLimitSource }
  )
  foreach ($case in $invalidSources) {
    [IO.File]::WriteAllBytes($caseSource, $case.Bytes)
    Expect-GuardRejection -Case $case.Name -Code 'source_contract' -Action { Read-GuardProgram -Path $caseSource }
  }
  # A real source prefix with valid ASCII/LF passes the byte contract but must
  # fail the unchanged runtime oracle, rather than being accepted by format.
  $firstLf = [Array]::IndexOf($program.Raw, [byte]10)
  if ($firstLf -lt 0 -or $firstLf -ge $program.Raw.Length - 1) { throw 'No proper LF-terminated source prefix for the negative fixture.' }
  $prefix = New-Object byte[] ($firstLf + 1)
  [Array]::Copy($program.Raw, 0, $prefix, 0, $prefix.Length)
  [IO.File]::WriteAllBytes($caseSource, $prefix)
  Expect-GuardRejection -Case 'source-truncated-valid-prefix' -Code 'ready_eof' -Action {
    Invoke-GuardOracle -Program (Read-GuardProgram -Path $caseSource)
  }

  # Protocol fixtures derive from the READY/ACK emitted by the real program.
  # JSON frame construction below is data mutation, not program substitution.
  $utf8 = New-Object Text.UTF8Encoding($false, $true)
  $fixtureAck = Join-Path $caseRoot 'ack.json'
  [IO.File]::WriteAllText($fixtureAck, $observed.AckText, $utf8)
  $bindingChanges = @(
    @{ Field = 'schema'; Value = 2 }, @{ Field = 'type'; Value = 'not-ready' },
    @{ Field = 'desktop_pid'; Value = ($observed.Expected.DesktopPid + 1) },
    @{ Field = 'guard_pid'; Value = ($observed.Expected.GuardPid + 1) },
    @{ Field = 'request_token'; Value = ('guard-' + [guid]::NewGuid().ToString('N')) },
    @{ Field = 'source_sha256'; Value = ('0' * 64) }
  )
  foreach ($change in $bindingChanges) {
    $ready = $observed.ReadyLine | ConvertFrom-Json
    $ready.($change.Field) = $change.Value
    $frame = $utf8.GetBytes(($ready | ConvertTo-Json -Compress) + "`nALIVE`n")
    Expect-GuardRejection -Case ('binding-' + $change.Field) -Code 'ready_binding' -Action {
      Assert-GuardHandshake -FramesRaw $frame -AckPath $fixtureAck -Expected $observed.Expected
    }
  }
  Expect-GuardRejection -Case 'ack-missing' -Code 'ack_missing' -Action {
    Assert-GuardHandshake -FramesRaw $observed.FramesRaw -AckPath (Join-Path $caseRoot 'missing-ack.json') -Expected $observed.Expected
  }
  [IO.File]::WriteAllText($fixtureAck, '{', $utf8)
  Expect-GuardRejection -Case 'ack-invalid-json' -Code 'ack_json' -Action {
    Assert-GuardHandshake -FramesRaw $observed.FramesRaw -AckPath $fixtureAck -Expected $observed.Expected
  }
  $wrongAck = $observed.AckText | ConvertFrom-Json; $wrongAck.nonce = [guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($fixtureAck, ($wrongAck | ConvertTo-Json -Compress), $utf8)
  Expect-GuardRejection -Case 'ack-mismatch' -Code 'ack_binding' -Action {
    Assert-GuardHandshake -FramesRaw $observed.FramesRaw -AckPath $fixtureAck -Expected $observed.Expected
  }
  [IO.File]::WriteAllText($fixtureAck, $observed.AckText, $utf8)
  $wrongHeartbeat = $utf8.GetBytes($observed.ReadyLine + "`nNOT-ALIVE`n")
  Expect-GuardRejection -Case 'heartbeat-mismatch' -Code 'heartbeat' -Action {
    Assert-GuardHandshake -FramesRaw $wrongHeartbeat -AckPath $fixtureAck -Expected $observed.Expected
  }
  $badFrame = [byte[]]$observed.FramesRaw.Clone(); $badFrame[0] = 13
  Expect-GuardRejection -Case 'frame-invalid-bytes' -Code 'frame_bytes' -Action {
    Assert-GuardHandshake -FramesRaw $badFrame -AckPath $fixtureAck -Expected $observed.Expected
  }
  $badJson = $utf8.GetBytes("{`nALIVE`n")
  Expect-GuardRejection -Case 'ready-invalid-json' -Code 'ready_json' -Action {
    Assert-GuardHandshake -FramesRaw $badJson -AckPath $fixtureAck -Expected $observed.Expected
  }
  $stream = New-Object IO.MemoryStream
  try {
    $oneFrame = $utf8.GetBytes($observed.ReadyLine + "`n")
    $stream.Write($oneFrame, 0, $oneFrame.Length); $stream.Position = 0
    Expect-GuardRejection -Case 'stream-truncated' -Code 'ready_eof' -Action { Read-GuardFrames -Stream $stream }
  } finally { $stream.Dispose() }
  $oversize = New-Object byte[] 4097
  for ($index = 0; $index -lt $oversize.Length; $index++) { $oversize[$index] = 65 }
  $oversize[0] = 10; $oversize[-1] = 10
  $stream = New-Object IO.MemoryStream
  try {
    $stream.Write($oversize, 0, $oversize.Length); $stream.Position = 0
    Expect-GuardRejection -Case 'stream-size-limit' -Code 'frame_size' -Action { Read-GuardFrames -Stream $stream }
  } finally { $stream.Dispose() }
  $canary = $false
  try { Expect-GuardRejection -Case 'not-applied-canary' -Code 'source_contract' -Action { } }
  catch { if ($_.Exception.Message -cne 'Windows instance guard negative not refused: not-applied-canary') { throw }; $canary = $true }
  if (-not $canary) { throw 'A non-applied negative was accepted.' }
  if ($script:negativeCases.Count -ne 22 -or @($script:negativeCases | Sort-Object -Unique).Count -ne 22) {
    throw 'Windows instance guard negative fixture inventory incomplete or duplicated.'
  }
  Write-Output "WINDOWS-INSTANCE-GUARD-NEGATIVE-SUITE PASS cases=$($script:negativeCases.Count) not_applied_rejected=1"
} finally {
  Remove-Item -LiteralPath $caseRoot -Recurse -Force -ErrorAction Stop
}

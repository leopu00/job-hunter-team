#!/usr/bin/env pwsh
# Native causal oracle for the in-memory PowerShell guard, without Godot/NSIS.

$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/support/windows_instance_guard.ps1'
$raw = [IO.File]::ReadAllBytes($sourcePath)
if ($raw.Length -eq 0 -or $raw.Length -ge 10000 -or $raw[-1] -ne 10 -or
    $raw -contains 0 -or $raw -contains 13 -or @($raw | Where-Object { $_ -gt 127 }).Count -ne 0) {
  throw 'Windows instance guard native selftest failed: source_contract.'
}
$sha = [Security.Cryptography.SHA256]::Create()
try { $digest = ([BitConverter]::ToString($sha.ComputeHash($raw))).Replace('-', '').ToLowerInvariant() }
finally { $sha.Dispose() }
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes([Text.Encoding]::UTF8.GetString($raw)))
$token = 'guard-' + [guid]::NewGuid().ToString('N')
$request = [ordered]@{
  desktop_pid = $PID
  instance_id = 'instance-' + ([guid]::NewGuid().ToString('N').Substring(0, 24))
  mode = 'normal'
  nonce = [guid]::NewGuid().ToString('N')
  request_id = 'normal-' + ([guid]::NewGuid().ToString('N').Substring(0, 24))
  request_token = $token
  schema = 1
  source_sha256 = $digest
} | ConvertTo-Json -Compress
$root = Join-Path $env:LOCALAPPDATA 'Job Hunter Team/host-runtime/instance-guard'
$ackPath = Join-Path $root ('ack-' + $token + '.json')
$powershell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$process = $null
$started = $false

try {
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $powershell
  $start.Arguments = '-NoLogo -NoProfile -NonInteractive -EncodedCommand ' + $encoded
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

  $received = New-Object Collections.Generic.List[byte]
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while (@($received | Where-Object { $_ -eq 10 }).Count -lt 2) {
    $buffer = New-Object byte[] 2048
    $readTask = $process.StandardOutput.BaseStream.ReadAsync($buffer, 0, $buffer.Length)
    $remaining = [int][Math]::Max(1, ($deadline - [DateTime]::UtcNow).TotalMilliseconds)
    if ([DateTime]::UtcNow -ge $deadline -or -not $readTask.Wait($remaining)) {
      throw 'Windows instance guard native selftest failed: ready_timeout.'
    }
    $count = $readTask.Result
    if ($count -le 0) { throw 'Windows instance guard native selftest failed: ready_eof.' }
    for ($index = 0; $index -lt $count; $index++) { $received.Add($buffer[$index]) }
    if ($received.Count -gt 4096) { throw 'Windows instance guard native selftest failed: frame_size.' }
  }
  $framesRaw = $received.ToArray()
  foreach ($byte in $framesRaw) {
    if (($byte -lt 32 -and $byte -ne 10) -or $byte -gt 126) {
      throw 'Windows instance guard native selftest failed: frame_bytes.'
    }
  }
  $frames = (New-Object Text.UTF8Encoding($false, $true)).GetString($framesRaw).Split([char]10)
  $readyLine = $frames[0]
  try { $ready = $readyLine | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'Windows instance guard native selftest failed: ready_json.' }
  if ($ready.schema -ne 1 -or $ready.type -cne 'ready' -or
      $ready.desktop_pid -ne $PID -or $ready.guard_pid -ne $process.Id -or
      $ready.request_token -cne $token -or $ready.source_sha256 -cne $digest) {
    throw 'Windows instance guard native selftest failed: ready_binding.'
  }
  if (-not (Test-Path -LiteralPath $ackPath -PathType Leaf)) {
    throw 'Windows instance guard native selftest failed: ack_missing.'
  }
  try { $ack = Get-Content -LiteralPath $ackPath -Raw | ConvertFrom-Json -ErrorAction Stop }
  catch { throw 'Windows instance guard native selftest failed: ack_json.' }
  if (($ack | ConvertTo-Json -Compress) -cne $readyLine) {
    throw 'Windows instance guard native selftest failed: ack_binding.'
  }
  if ($frames[1] -cne 'ALIVE') {
    throw 'Windows instance guard native selftest failed: heartbeat.'
  }
  Write-Output 'WINDOWS-INSTANCE-GUARD-NATIVE PASS ready=1 ack=1 heartbeat=1'
} finally {
  if ($started -and -not $process.HasExited) {
    $process.Kill()
    $process.WaitForExit()
  }
  if ($process) { $process.Dispose() }
  Remove-Item -LiteralPath @($ackPath) -Force -ErrorAction SilentlyContinue
}

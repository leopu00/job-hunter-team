#!/usr/bin/env pwsh
# Native causal oracle for the in-memory PowerShell guard, without Godot/NSIS.
param([switch]$AclOnly, [string]$GuardSourcePath)

$ErrorActionPreference = 'Stop'
$sourcePath = if ($GuardSourcePath) { $GuardSourcePath } else {
  Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts/support/windows_instance_guard.ps1'
}
$raw = [IO.File]::ReadAllBytes($sourcePath)
if ($raw.Length -eq 0 -or $raw.Length -ge 10000 -or $raw[-1] -ne 10 -or
    $raw -contains 0 -or $raw -contains 13 -or @($raw | Where-Object { $_ -gt 127 }).Count -ne 0) {
  throw 'Windows instance guard native selftest failed: source_contract.'
}

# Exercise the production assertions against native .NET descriptors. The
# historical directory had flags 0x9404: protected, auto-inherited, DACL present,
# self-relative; owner=current and exactly current+SYSTEM FullControl OI+CI.
# AI describes OS inheritance bookkeeping; P and every ACE must still match.
# These fixtures contain only synthetic SIDs, never the operator's descriptor.
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile(
  $sourcePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Instance guard ACL oracle: source_parse.' }
$definitions = @($ast.FindAll({
  param($node)
  $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -cin @('DirAcl', 'Sddl', 'Assert-Dir')
}, $false))
if ($definitions.Count -ne 3) { throw 'Instance guard ACL oracle: source_functions.' }

& {
  foreach ($definition in $definitions) {
    . ([scriptblock]::Create($definition.Extent.Text))
  }
  $sid = New-Object Security.Principal.SecurityIdentifier('S-1-5-21-111111111-222222222-333333333-1001')
  $expected = DirAcl $sid
  $expectedSddl = Sddl $expected
  $historicalSddl = 'O:' + $sid.Value + 'D:PAI(A;OICI;FA;;;SY)(A;OICI;FA;;;' + $sid.Value + ')'
  $descriptor = New-Object Security.AccessControl.RawSecurityDescriptor($historicalSddl)
  if ($expectedSddl -ceq $historicalSddl -or [int]$descriptor.ControlFlags -ne 37892) {
    throw 'Instance guard ACL oracle: historical_fixture.'
  }
  $fixture = [pscustomobject]@{
    PSIsContainer = $true
    Attributes = [IO.FileAttributes]::Directory
    Security = $null
  }
  $fixture | Add-Member ScriptMethod GetAccessControl { param($sections) $this.Security }
  # Only Get-Item is replaced in this child scope: production Assert-Dir and
  # Sddl run unchanged against native security objects, without touching state.
  function Get-Item { param($LiteralPath, [switch]$Force) $fixture }
  function Set-Fixture([string]$Value) {
    $security = New-Object Security.AccessControl.DirectorySecurity
    $security.SetSecurityDescriptorSddlForm($Value)
    $fixture.Security = $security
  }
  function Reject-Fixture([string]$Name, [string]$Value, [string]$Code = 'root_acl') {
    Set-Fixture $Value
    try { Assert-Dir 'synthetic' $expected }
    catch {
      if ($_.Exception.Message -ceq $Code) { return }
      throw ('Instance guard ACL oracle: wrong_rejection_' + $Name)
    }
    throw ('Instance guard ACL oracle: accepted_' + $Name)
  }
  Set-Fixture $expectedSddl
  Assert-Dir 'synthetic' $expected
  Set-Fixture $historicalSddl
  Assert-Dir 'synthetic' $expected
  # Prove the pre-fix assertion rejects this exact rights-preserving change.
  if ((Sddl $fixture.Security) -ceq $expectedSddl) {
    throw 'Instance guard ACL oracle: baseline_did_not_reject.'
  }
  Reject-Fixture 'unprotected' ($historicalSddl.Replace('D:PAI(', 'D:AI('))
  Reject-Fixture 'foreign_read' ($historicalSddl + '(A;OICI;FR;;;WD)')
  Reject-Fixture 'foreign_write' ($historicalSddl + '(A;OICI;FA;;;WD)')
  Reject-Fixture 'admin' ($historicalSddl + '(A;OICI;FA;;;BA)')
  Reject-Fixture 'wrong_owner' ($historicalSddl.Replace('O:' + $sid.Value, 'O:SY'))
  Reject-Fixture 'missing_system' ($historicalSddl.Replace('(A;OICI;FA;;;SY)', ''))
  Reject-Fixture 'missing_inheritance' ($historicalSddl.Replace(';OICI;', ';;'))
  Reject-Fixture 'inherited_ace' ($historicalSddl.Replace(';OICI;', ';OICIID;'))
  Reject-Fixture 'inherit_only' ($historicalSddl.Replace(';OICI;', ';OICIIO;'))
  Reject-Fixture 'reduced_rights' ($historicalSddl.Replace(';FA;', ';FR;'))
  Reject-Fixture 'deny' ($historicalSddl.Replace('(A;', '(D;'))
  Reject-Fixture 'empty_dacl' ('O:' + $sid.Value + 'D:P')
  Reject-Fixture 'null_dacl' ('O:' + $sid.Value + 'D:NO_ACCESS_CONTROL')
  $fixture.PSIsContainer = $false
  Reject-Fixture 'file' $historicalSddl 'root_identity'
  $fixture.PSIsContainer = $true
  $fixture.Attributes = [IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint
  Reject-Fixture 'reparse' $historicalSddl 'root_identity'
}

# Also round-trip an ACL through the Windows filesystem, in a new disposable
# directory only. No production root, existing ACL or application data changes.
& {
  foreach ($definition in $definitions) {
    . ([scriptblock]::Create($definition.Extent.Text))
  }
  $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl = DirAcl $sid
  $path = Join-Path ([IO.Path]::GetTempPath()) ('jht-guard-acl-' + [guid]::NewGuid().ToString('N'))
  try {
    [void][IO.Directory]::CreateDirectory($path, $acl)
    Assert-Dir $path $acl
  } finally {
    if ([IO.Directory]::Exists($path)) { [IO.Directory]::Delete($path) }
  }
}
Write-Output 'WINDOWS-INSTANCE-GUARD-ACL PASS historical=1 baseline_reject=1 unsafe=15 disk=1'
if ($AclOnly) { return }

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

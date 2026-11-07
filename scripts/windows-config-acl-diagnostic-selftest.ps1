param([Parameter(Mandatory)][ValidateSet(5, 7)][int]$ExpectedMajor)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne $ExpectedMajor -or
    ($ExpectedMajor -eq 5 -and $PSVersionTable.PSVersion.Minor -ne 1)) {
  throw "wrong PowerShell engine: expected $ExpectedMajor, got $($PSVersionTable.PSVersion)"
}

# Import only the real diagnostic/retry functions, without running the full
# ACL selftest or changing an ACL. The simulated denial targets a real child
# so the diagnostic must exercise Split-Path to reach the requested root.
$subject = Join-Path $PSScriptRoot 'windows-config-acl-selftest.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($subject, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "ACL selftest parse failed: $($errors[0])" }
foreach ($name in @('Write-JhtAclNodeDiagnostic', 'Write-JhtAclRepairFailure', 'Invoke-ProtectJhtHomeAclWithDiagnosis')) {
  $definitions = @($ast.FindAll({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name
  }, $true))
  if ($definitions.Count -ne 1) { throw "expected one real function $name" }
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}

function Get-JhtAclProcessSnapshot { return @() }

function Protect-JhtHomeAcl {
  param([Parameter(Mandatory)][string]$Path)
  if ($Path -cne $script:fixtureRoot) { throw 'retry changed the requested path' }
  $script:protectCalls += 1
  if ($script:protectCalls -le $script:forcedFailures) {
    $exception = [System.UnauthorizedAccessException]::new("forced ACL UnauthorizedAccess attempt=$script:protectCalls")
    $record = [System.Management.Automation.ErrorRecord]::new(
      $exception, 'AclDiagnosticForcedDenial', [System.Management.Automation.ErrorCategory]::PermissionDenied, $script:refusedChild)
    throw $record
  }
}

function Assert-DiagnosticOrder {
  param([string]$Text, [string[]]$Needles)
  $previous = -1
  foreach ($needle in $Needles) {
    $at = $Text.IndexOf($needle, $previous + 1, [StringComparison]::Ordinal)
    if ($at -lt 0) { throw "missing or out-of-order diagnostic: $needle" }
    $previous = $at
  }
}

$script:fixtureRoot = Join-Path $env:RUNNER_TEMP ("jht-acl-diagnostic-[literal]-" + [guid]::NewGuid().ToString('N'))
$script:refusedChild = Join-Path $script:fixtureRoot 'child[denied]'
[void][IO.Directory]::CreateDirectory($script:refusedChild)
try {
  foreach ($failures in @(1, 2)) {
    $script:protectCalls = 0
    $script:forcedFailures = $failures
    $script:lastFailure = $null
    $records = @(& {
      try {
        Invoke-ProtectJhtHomeAclWithDiagnosis -Path $script:fixtureRoot -BaselineProcesses @([pscustomobject]@{ ProcessId = -1 })
      } catch { $script:lastFailure = $_ }
    } 6>&1)
    $lines = @($records | ForEach-Object { $_.ToString() })
    $text = $lines -join "`n"
    $lines | ForEach-Object { Write-Host $_ }
    if ($script:protectCalls -ne 2) { throw "expected exactly two attempts, got $script:protectCalls" }
    $child = "ACL_REPAIR_NODE path=$script:refusedChild owner="
    $parent = "ACL_REPAIR_NODE path=$script:fixtureRoot owner="
    Assert-DiagnosticOrder -Text $text -Needles @(
      'ACL_REPAIR_FAILURE attempt=1 type=System.UnauthorizedAccessException', $child, $parent,
      'ACL_REPAIR_E03_PROCESSES none', 'ACL_REPAIR_RETRY attempt=2 after_ms=750')
    foreach ($node in @($child, $parent)) {
      if (@($lines | Where-Object { $_.StartsWith($node, [StringComparison]::Ordinal) }).Count -ne $failures) {
        throw "diagnostic did not visit the literal node once per denial: $node"
      }
    }
    if ($failures -eq 1) {
      if ($null -ne $script:lastFailure) { throw $script:lastFailure }
      Assert-DiagnosticOrder -Text $text -Needles @('ACL_REPAIR_RETRY attempt=2 after_ms=750', 'ACL_REPAIR_RETRY_PASS attempt=2')
    } else {
      if ($null -eq $script:lastFailure) { throw 'two denials did not propagate the final error' }
      if ($script:lastFailure.Exception -isnot [System.UnauthorizedAccessException] -or
          $script:lastFailure.Exception.Message -ne 'forced ACL UnauthorizedAccess attempt=2') {
        throw "the final denial was replaced: $($script:lastFailure.Exception.Message)"
      }
      Assert-DiagnosticOrder -Text $text -Needles @('ACL_REPAIR_RETRY attempt=2 after_ms=750', 'ACL_REPAIR_FAILURE attempt=2 type=System.UnauthorizedAccessException')
      if ($text.Contains('ACL_REPAIR_RETRY_PASS')) { throw 'a failed repair was reported as successful' }
    }
    Write-Host "ACL_DIAGNOSTIC_REGRESSION engine=$($PSVersionTable.PSVersion) failures=$failures attempts=2 PASS"
  }
} finally {
  Remove-Item -LiteralPath $script:fixtureRoot -Recurse -Force
}

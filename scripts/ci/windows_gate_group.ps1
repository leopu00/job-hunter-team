# Helper of .github/workflows/windows-config-acl.yml, dot-sourced by its steps.
# Invoke-GateGroup runs one group of tests/windows_gate_files.py (strict or open) under the shell and the slice the job
# names (JHT_TEST_SHELL, JHT_TEST_SLICE), and checks what ran against what the collection of the same slice holds:
# every test accounted for as passed or skipped, none failed, none lost, and no more skips than the group allows.
# The slice is cut by place (tests/conftest.py), so what it holds is read from the collection of this very run: nothing
# to keep in step with the list by hand. The total of the group (it may grow, never shrink) is counted by the host job.

function Invoke-GateGroup {
  param(
    [Parameter(Mandatory)][ValidateSet('strict', 'open')][string]$Group,
    [Parameter(Mandatory)][int]$MaxSkipped
  )
  $files = @(python tests/windows_gate_files.py "--$Group")
  if ($files.Count -eq 0) { throw "the list of the group $Group is empty" }
  $collected = @(python -m pytest @files --collect-only -q -p no:cacheprovider 2>&1 | ForEach-Object { "$_" } | Where-Object { $_ -match '::' })
  $expected = $collected.Count
  if ($expected -eq 0) { throw "the slice $env:JHT_TEST_SLICE of the group $Group holds no test" }
  Write-Host "== group $Group, shell $env:JHT_TEST_SHELL, slice $env:JHT_TEST_SLICE: $expected tests to run, at most $MaxSkipped skipped"
  $out = python -m pytest @files -n 4 -p no:cacheprovider -rs --durations=15 --durations-min=1 2>&1
  $code = $LASTEXITCODE
  $out | ForEach-Object { Write-Host "$_" }
  if ($code -ne 0) { return [int]$code }
  $summary = "$($out[-1])"
  if ($summary -notmatch '^=+ (\d+) passed(?:, (\d+) skipped)?(?:, \d+ warnings?)? in [0-9.]+s') { throw "unexpected pytest summary, group $Group under ${env:JHT_TEST_SHELL}: $summary" }
  $passed = [int]$Matches[1]
  $skipped = if ($Matches[2]) { [int]$Matches[2] } else { 0 }
  if ($passed + $skipped -ne $expected) { throw "group ${Group}: $passed passed and $skipped skipped, the slice holds $expected" }
  if ($skipped -gt $MaxSkipped) { throw "group ${Group}: $skipped tests skipped under $env:JHT_TEST_SHELL, at most $MaxSkipped are expected (the ones of what Windows is)" }
  $line = "$Group, $env:JHT_TEST_SHELL, slice $env:JHT_TEST_SLICE: $passed passed, $skipped skipped"
  Write-Host $line
  $line | Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Append -Encoding utf8
  return [int]0
}

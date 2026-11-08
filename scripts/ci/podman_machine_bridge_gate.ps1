# Canonical CI entrypoint for the real deadline/counter-proof selftests; never product code.
$ErrorActionPreference = 'Stop'
$head = git rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $head -ne $env:GITHUB_SHA) { throw 'The Podman proof checkout does not match the CI pin.' }
$source = (Get-FileHash -LiteralPath scripts/podman-machine-bridge.ps1 -Algorithm SHA256).Hash
$proofInputs = @('scripts/podman-machine-bridge.ps1', 'scripts/podman-machine-bridge-selftest.ps1', 'scripts/ci/podman_machine_bridge_gate.ps1')
$before = @{}
foreach ($inputPath in $proofInputs) {
  $expected = git rev-parse "${head}:$inputPath"
  $actual = git hash-object -- $inputPath
  if ($LASTEXITCODE -ne 0 -or $actual -ne $expected) { throw "Podman proof input does not match Git: $inputPath" }
  $before[$inputPath] = (Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash
  Write-Output "T205_SOURCE head=$head path=$inputPath blob=$actual raw_sha256=$($before[$inputPath])"
}
. ./scripts/podman-machine-bridge.ps1
foreach ($engine in @(@('powershell', 5), @('pwsh', 7))) {
  $stdout = Join-Path $env:RUNNER_TEMP "t205-$($engine[1])-stdout.log"
  $stderr = Join-Path $env:RUNNER_TEMP "t205-$($engine[1])-stderr.log"
  $exe = Get-Command -Name ($engine[0]) -CommandType Application -ErrorAction Stop | Select-Object -First 1
  $owner = [JhtPodmanOwnedProcess]::new()
  $arguments = ConvertTo-JhtPodmanNativeArguments -Arguments @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/podman-machine-bridge-selftest.ps1', '-ExpectedMajor', [string]$engine[1])
  $output = $null; $errors = $null
  try {
    $owner.Start($exe.Source, $arguments)
    $child = $owner.Process
    $output = $owner.Output.ReadToEndAsync(); $errors = $owner.Error.ReadToEndAsync()
    if (-not $child.WaitForExit(120000)) {
      [void](Stop-JhtPodmanProcessTree -Process $child -Owner $owner)
      throw "Podman deadline selftest exceeded its external 120s watchdog on $($engine[0])."
    }
    if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($output, $errors), 5000)) { throw 'The proof output pipes did not close.' }
    if ($child.ExitCode -ne 0) { throw "Podman deadline selftest failed on $($engine[0]): $($child.ExitCode)" }
  } finally {
    $clean = $owner.Stop(5000)
    try {
      if ($output -and $errors) {
        if (-not [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($output, $errors), 5000)) { throw 'The proof output pipes did not close after cleanup.' }
        [IO.File]::WriteAllText($stdout, $output.Result); [IO.File]::WriteAllText($stderr, $errors.Result)
        Get-Content -LiteralPath $stdout; Get-Content -LiteralPath $stderr
      }
    } finally { $owner.Dispose() }
    if (-not $clean) { throw 'The proof could not stop its own process job.' }
  }
  if ((Get-FileHash -LiteralPath scripts/podman-machine-bridge.ps1 -Algorithm SHA256).Hash -ne $source) { throw 'The deadline proof changed its source.' }
}
foreach ($inputPath in $proofInputs) {
  if ((Get-FileHash -LiteralPath $inputPath -Algorithm SHA256).Hash -ne $before[$inputPath]) { throw "The Podman proof changed its input: $inputPath" }
  Write-Output "T205_SOURCE_POST head=$head path=$inputPath raw_sha256=$($before[$inputPath]) unchanged=true"
}

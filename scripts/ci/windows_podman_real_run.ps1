# Helper of .github/workflows/windows-podman-real.yml, dot-sourced by its steps.
# Invoke-Timed runs a script the way the desktop app does on Windows: Windows
# PowerShell 5.1 with -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass
# -File. Every output line gets the seconds since the start (the JHT_PHASE lines
# then show where the time goes); the whole output also goes to a log file
# ($script:LastLog), and the step's name, duration and exit code to $env:TIMES.
# Only the exit code is returned: everything printed goes to the host.

function Invoke-Timed {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Path,
    [string[]]$Arguments = @()
  )
  $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $script:LastLog = Join-Path $env:RUNNER_TEMP (($Name -replace '[^A-Za-z0-9]+', '-') + '.log')
  $clock = [Diagnostics.Stopwatch]::StartNew()
  & $powerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Path @Arguments 2>&1 |
    ForEach-Object { '[{0,7:N1}s] {1}' -f $clock.Elapsed.TotalSeconds, "$_" } |
    Tee-Object -FilePath $script:LastLog | Out-Host
  $code = $LASTEXITCODE
  $clock.Stop()
  Write-Host "== $Name`: exit $code in $([Math]::Round($clock.Elapsed.TotalSeconds, 1)) s"
  "$Name`t$([Math]::Round($clock.Elapsed.TotalSeconds, 1))`t$code" | Out-File -FilePath $env:TIMES -Append -Encoding ascii
  return $code
}


# What `jht uninstall --purge` must leave nowhere: the names of the things still there, none when it is clean.
# The Podman machine is looked for by name and by its WSL distribution; the startup task by the product's name.
function Get-JhtLeftovers {
  $left = New-Object 'System.Collections.Generic.List[string]'
  $runtime = Join-Path $env:LOCALAPPDATA 'Job Hunter Team'
  if (Test-Path -LiteralPath $runtime) { $left.Add("folder $runtime") }
  $bin = Join-Path $env:USERPROFILE '.local\bin'
  foreach ($name in 'jht.ps1', 'jht.cmd', 'shim', 'windows-private-acl.ps1', 'podman-machine-bridge.ps1', 'docker.exe') {
    $path = Join-Path $bin $name
    if (Test-Path -LiteralPath $path) { $left.Add("command $path") }
  }
  foreach ($data in (Join-Path $env:USERPROFILE '.jht'), (Join-Path $env:USERPROFILE 'Documents\Job Hunter Team')) {
    if (Test-Path -LiteralPath $data) { $left.Add("data folder $data") }
  }
  $podman = Get-Command podman.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($podman) {
    $machines = @(& $podman.Source machine list --format '{{.Name}}' 2>$null | Where-Object { "$_" -match 'jht' })
    foreach ($machine in $machines) { $left.Add("podman machine $machine") }
  }
  $distros = @(& wsl.exe --list --quiet 2>$null | ForEach-Object { ("$_" -replace "`0", '').Trim() } | Where-Object { $_ -match 'jht' })
  foreach ($distro in $distros) { $left.Add("WSL distribution $distro") }
  $tasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -like '*Job Hunter*' -or $_.TaskName -like '*jht*' })
  foreach ($task in $tasks) { $left.Add("scheduled task $($task.TaskName)") }
  return $left.ToArray()
}

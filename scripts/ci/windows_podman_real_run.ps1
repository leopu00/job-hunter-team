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

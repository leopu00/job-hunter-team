# sync.ps1 — watch $env:TEMP for jht-* diagnostic files and stream them
# to the Mac LAN upload server in real time.
#
# Usage on the Windows test machine (one-liner):
#   iex (irm http://192.168.1.5:8080/sync.ps1)
#
# Leave the PowerShell window open. Each time the JHT installer (or
# any other code path on the Mac side) writes a jht-* file in TEMP,
# this script POSTs it to /upload using curl.exe (built-in on Win 10+).
#
# Stop with Ctrl+C.

$ErrorActionPreference = 'Continue'

# Hard-coded to the current Mac LAN address — the script is fetched
# from this same host, so by definition it's reachable when the user
# pastes the one-liner above.
$endpoint = 'http://192.168.1.5:8080/upload'
# Watch TWO folders: TEMP for the main install log/result/script, AND
# Desktop for the sentinel diag file that the install script now writes
# as its very first action. If diag appears in Desktop but not in TEMP,
# we know the elevated PS ran but $env:TEMP was a different path.
$watchTargets = @(
  @{ Folder = $env:TEMP;                           Pattern = 'jht-*' },
  @{ Folder = (Join-Path $env:USERPROFILE 'Desktop'); Pattern = 'jht-*' }
)

function Send-File([string]$path) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return }
  $name = Split-Path -Path $path -Leaf
  # curl.exe handles multipart properly; PS 5.1's Invoke-WebRequest is
  # fiddly with binary multipart bodies and PS 7's -Form isn't always
  # present on fresh installs.
  & curl.exe -s -S -o NUL -F "file=@$path" $endpoint 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "[sync $(Get-Date -Format HH:mm:ss)] $name"
  } else {
    Write-Host "[err  $(Get-Date -Format HH:mm:ss)] $name (curl exit $LASTEXITCODE)"
  }
}

foreach ($t in $watchTargets) {
  Write-Host "Watching $($t.Folder)\$($t.Pattern) → $endpoint"
}
Write-Host "Ctrl+C to stop."
Write-Host ""

# Initial flush: upload anything already matching so we don't miss a run
# that completed before the watcher started.
foreach ($t in $watchTargets) {
  if (-not (Test-Path -LiteralPath $t.Folder)) { continue }
  Get-ChildItem -Path $t.Folder -Filter $t.Pattern -File -ErrorAction SilentlyContinue |
    ForEach-Object { Send-File $_.FullName }
}

$pending = @{}
$debounceMs = 400

$onEvent = {
  param($source, $args)
  $p = $args.FullPath
  $now = [DateTime]::UtcNow
  $script:pending[$p] = $now
  Start-Sleep -Milliseconds 50
}

$watchers = @()
foreach ($t in $watchTargets) {
  if (-not (Test-Path -LiteralPath $t.Folder)) { continue }
  $w = New-Object System.IO.FileSystemWatcher $t.Folder, $t.Pattern -Property @{
    IncludeSubdirectories = $false
    EnableRaisingEvents   = $true
    NotifyFilter          = [System.IO.NotifyFilters]::LastWrite -bor `
                            [System.IO.NotifyFilters]::Size -bor `
                            [System.IO.NotifyFilters]::FileName -bor `
                            [System.IO.NotifyFilters]::CreationTime
  }
  $null = Register-ObjectEvent $w Created -Action $onEvent
  $null = Register-ObjectEvent $w Changed -Action $onEvent
  $null = Register-ObjectEvent $w Renamed -Action $onEvent
  $watchers += $w
}

try {
  while ($true) {
    Start-Sleep -Milliseconds 200
    $now = [DateTime]::UtcNow
    $ready = @($pending.GetEnumerator() |
      Where-Object { ($now - $_.Value).TotalMilliseconds -ge $debounceMs } |
      Select-Object -ExpandProperty Key)
    foreach ($p in $ready) {
      $pending.Remove($p)
      Send-File $p
    }
  }
} finally {
  foreach ($w in $watchers) {
    $w.EnableRaisingEvents = $false
    Get-EventSubscriber | Where-Object { $_.SourceObject -eq $w } |
      Unregister-Event -Force
    $w.Dispose()
  }
}

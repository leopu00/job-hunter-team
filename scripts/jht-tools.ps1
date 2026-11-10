# jht-tools.ps1 - the tools of the full image, pulled in the background after the install (P4). PowerShell port of jht-tools.sh.
# JHT_RUNTIME_HELPER=1
#
# A LIBRARY, not a program: the host wrapper loads it (dot-sourced) after checking its sha256 against the runtime manifest and calls
# Invoke-ToolsCommand from its `tools` branch. It uses what the wrapper has: $RuntimeDir, $RuntimeTierFile, $DefaultRuntimeImage,
# $JhtHome, $WrapperPath, Write-RuntimeManifest, Write-Err.
#
#   jht tools status --json   one line: {"ok":true,"state":"none|pending|pulling|ready|failed","tier":"core|full","reason":"<code>"}
#   jht tools pull            starts the pull of the full image, detached; already pulling or pulled: exit 0 and nothing else
#   jht tools switch          the full image takes the place of the core one, with an `up`; exit 0 and nothing printed until
#                             the profile is ready (profile\ready.flag) and the full image is here
#
# The state comes from the engine and from the host files of the runtime, never from a file the container can write. The file
# state\tools.json is a NOTICE for the container (the Capitano reads it): nothing here reads it back.

$ToolsStateDir = Join-Path $JhtHome 'state'
$ToolsLock = Join-Path $RuntimeDir '.tools-pull.lock'
$ToolsFailedFile = Join-Path $RuntimeDir '.tools-pull-failed'

function Get-ToolsNow { return [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'") }

# The tier of this install: `core` while the runtime-tier file is there, `full` otherwise (the image of before).
function Get-ToolsTier { if (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf) { return 'core' } else { return 'full' } }

function Test-ToolsDocker {
  param([string[]]$DockerArgs)
  & { $ErrorActionPreference = 'Continue'; & docker @DockerArgs *> $null }
  return ($LASTEXITCODE -eq 0)
}

function Test-ToolsEngineUp { return (Test-ToolsDocker @('info')) }

function Test-ToolsFullHere { return (Test-ToolsDocker @('image', 'inspect', $DefaultRuntimeImage)) }

# A pull is under way when the lock has a live process behind it (a lock with no pid yet is young: the parent writes it right after
# the start; two minutes without one and the parent is gone).
function Test-ToolsPulling {
  if (-not (Test-Path -LiteralPath $ToolsLock -PathType Container)) { return $false }
  $pidFile = Join-Path $ToolsLock 'pid'
  $pidText = if (Test-Path -LiteralPath $pidFile -PathType Leaf) { ([IO.File]::ReadAllText($pidFile)).Trim() } else { '' }
  if ($pidText -match '^[0-9]+$') { return [bool](Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue) }
  return (((Get-Date) - (Get-Item -LiteralPath $ToolsLock).LastWriteTime).TotalMinutes -lt 2)
}

# state tier reason since -> the notice for the container, written whole (temp + rename).
function Write-ToolsNotice {
  param([string]$State, [string]$Tier, [string]$Reason, [string]$Since)
  try {
    # $JhtHome is the folder the container writes in: a link (a junction, a symlink) in place of `state` or of tools.json must not
    # send the notice somewhere else, and what is there must be a real folder and a plain file.
    $dir = Get-Item -LiteralPath $ToolsStateDir -Force -ErrorAction SilentlyContinue
    if ($dir -and ((($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -or -not $dir.PSIsContainer)) { return }
    New-Item -ItemType Directory -Path $ToolsStateDir -Force | Out-Null
    $dir = Get-Item -LiteralPath $ToolsStateDir -Force
    if (($dir.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return }
    $file = Get-Item -LiteralPath (Join-Path $ToolsStateDir 'tools.json') -Force -ErrorAction SilentlyContinue
    if ($file -and ((($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) -or $file.PSIsContainer)) { return }
    $temp = Join-Path $ToolsStateDir ".tools.json.$PID-$([guid]::NewGuid().ToString('N'))"
    $json = '{{"schema":1,"state":"{0}","tier":"{1}","reason":"{2}","since":"{3}","updated":"{4}"}}' -f $State, $Tier, $Reason, $Since, (Get-ToolsNow)
    [IO.File]::WriteAllText($temp, "$json`n", [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $temp -Destination (Join-Path $ToolsStateDir 'tools.json') -Force
  } catch { }
}

# @(state, reason) as the engine and the host files say them.
function Get-ToolsState {
  if (-not (Test-ToolsEngineUp)) { return @('error', 'engine_unreachable') }
  if (-not (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf)) { return @('none', '') }
  if (Test-ToolsFullHere) { return @('ready', '') }
  if (Test-ToolsPulling) { return @('pulling', '') }
  if ((Test-Path -LiteralPath $ToolsFailedFile -PathType Leaf) -and ([IO.File]::ReadAllText($ToolsFailedFile).Trim() -match '^[a-z_]{1,40}$')) {
    return @('failed', [IO.File]::ReadAllText($ToolsFailedFile).Trim())
  }
  return @('pending', '')
}

function Write-ToolsStatusJson {
  $state, $reason = Get-ToolsState
  if ($state -eq 'error') { [Console]::Out.WriteLine(('{{"ok":false,"error":"{0}"}}' -f $reason)); return 0 }
  [Console]::Out.WriteLine(('{{"ok":true,"state":"{0}","tier":"{1}","reason":"{2}"}}' -f $state, (Get-ToolsTier), $reason))
  return 0
}

# The pull itself, in a detached process (`jht tools pull-job`): its end is on disk (the image, or the failed marker), and in the notice.
function Invoke-ToolsPullJob {
  param([string]$Since)
  & { $ErrorActionPreference = 'Continue'; & docker pull $DefaultRuntimeImage *> $null }
  if ($LASTEXITCODE -eq 0 -and (Test-ToolsFullHere)) {
    Remove-Item -LiteralPath $ToolsFailedFile -Force -ErrorAction SilentlyContinue
    Write-ToolsNotice 'ready' 'core' '' $Since
  } else {
    [IO.File]::WriteAllText($ToolsFailedFile, "pull_failed`n", [Text.UTF8Encoding]::new($false))
    Write-ToolsNotice 'failed' 'core' 'pull_failed' $Since
  }
  Remove-Item -LiteralPath $ToolsLock -Recurse -Force -ErrorAction SilentlyContinue
  return 0
}

function Start-ToolsPull {
  if (-not (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf)) { return 0 }
  if (-not (Test-ToolsEngineUp)) { Write-Err 'tools: il motore dei container non risponde'; return 1 }
  $since = Get-ToolsNow
  if (Test-ToolsFullHere) {
    Remove-Item -LiteralPath $ToolsFailedFile -Force -ErrorAction SilentlyContinue
    Write-ToolsNotice 'ready' 'core' '' $since
    return 0
  }
  if (Test-ToolsPulling) { return 0 }
  Remove-Item -LiteralPath $ToolsLock -Recurse -Force -ErrorAction SilentlyContinue
  try { New-Item -ItemType Directory -Path $ToolsLock -ErrorAction Stop | Out-Null } catch { return 0 }  # another call won the race
  Remove-Item -LiteralPath $ToolsFailedFile -Force -ErrorAction SilentlyContinue
  [Console]::Out.WriteLine('JHT_PHASE tools_pull')
  Write-ToolsNotice 'pulling' 'core' '' $since
  $shell = (Get-Process -Id $PID).Path
  $start = @{ FilePath = $shell; PassThru = $true; ArgumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $WrapperPath, 'tools', 'pull-job', $since) }
  # -WindowStyle exists only on Windows: PowerShell 7 on Linux (a runner, a test) refuses the parameter.
  if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) { $start.WindowStyle = 'Hidden' }
  $process = Start-Process @start
  [IO.File]::WriteAllText((Join-Path $ToolsLock 'pid'), "$($process.Id)`n", [Text.UTF8Encoding]::new($false))
  return 0
}

# The switch: the tier file goes (and the manifest stops attesting it), then an `up` on the image of the compose, the full one.
function Invoke-ToolsSwitch {
  $flag = Join-Path $JhtHome 'profile\ready.flag'
  if (-not (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf)) { return 0 }
  if (-not (Test-Path -LiteralPath $flag -PathType Leaf) -or ((Get-Item -LiteralPath $flag -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { return 0 }
  if (-not ((Test-ToolsEngineUp) -and (Test-ToolsFullHere))) { return 0 }
  try {
    Remove-Item -LiteralPath $RuntimeTierFile -Force
    Write-RuntimeManifest
  } catch { Write-Err 'tools: manifest del runtime non aggiornato'; return 1 }
  Remove-Item Env:\JHT_IMAGE -ErrorAction SilentlyContinue
  $shell = (Get-Process -Id $PID).Path
  $up = Start-Process -FilePath $shell -NoNewWindow -Wait -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $WrapperPath, 'up')
  if ($up.ExitCode -ne 0) { return [int]$up.ExitCode }
  Write-ToolsNotice 'ready' 'full' '' (Get-ToolsNow)
  [Console]::Out.WriteLine('JHT_PHASE tools_ready')
  return 0
}

function Invoke-ToolsCommand {
  param([string[]]$ToolsArgs)
  $a = @($ToolsArgs)
  $sub = if ($a.Count -ge 1) { $a[0] } else { '' }
  if ($sub -eq 'status' -and $a.Count -eq 2 -and $a[1] -eq '--json') { return (Write-ToolsStatusJson) }
  if ($sub -eq 'pull' -and $a.Count -eq 1) { return (Start-ToolsPull) }
  if ($sub -eq 'switch' -and $a.Count -eq 1) { return (Invoke-ToolsSwitch) }
  if ($sub -eq 'pull-job' -and $a.Count -eq 2) { return (Invoke-ToolsPullJob $a[1]) }
  Write-Err 'uso: jht tools status --json | pull | switch'
  return 2
}

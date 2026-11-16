# jht-tools.ps1 - the tools of the full image, pulled in the background after the install (P4). PowerShell port of jht-tools.sh.
# JHT_RUNTIME_HELPER=1
#
# A LIBRARY, not a program: the host wrapper loads it (dot-sourced) after checking its sha256 against the runtime manifest and calls
# Invoke-ToolsCommand from its `tools` branch. It uses what the wrapper has: $RuntimeDir, $RuntimeTierFile, $DefaultRuntimeImage,
# $JhtHome, $WrapperPath, $RuntimeTierIntegrity, Write-Err.
#
#   jht tools status --json   one line: {"ok":true,"state":"none|pending|pulling|ready|failed","tier":"core|full","reason":"<code>"}
#   jht tools pull            starts the pull of the full image, detached; already pulling or pulled: exit 0 and nothing else
#   jht tools switch          the full image takes the place of the core one, with an `up`; exit 0 and nothing printed until
#                             the profile is ready (profile\ready.flag) and the full image is here
#
# Invoke-ToolsKick is what the wrapper calls on `jht up` and `jht setup` of a core install: it keeps the tools moving on a computer
# with the CLI only, as the round of the desktop app does (desktop/src-tauri/src/tools_tier.rs). It starts one detached job, at
# most, that pulls the full image when it is not here yet, waits for profile\ready.flag and then makes the switch itself, once no
# other `jht` command runs: `down` of the core team, the tier goes, `up` on the full image (a team the person stopped stays
# stopped); a switch that fails is written down for `jht up` and `jht status` to say, with the commands to give.
#
# The state comes from the engine and from the host files of the runtime, never from a file the container can write. The file
# state\tools.json is a NOTICE for the container (the Capitano reads it): nothing here reads it back.

$ToolsStateDir = Join-Path $JhtHome 'state'
$ToolsLock = Join-Path $RuntimeDir '.tools-pull.lock'
$ToolsFailedFile = Join-Path $RuntimeDir '.tools-pull-failed'

# What the person reads is in the language the wrapper decided (Get-JhtTextLanguage), in the 7 languages of shared/locales: the block
# below is made from the catalogs (python3 tests/tools_ps1_texts.py --write). Own names: this file is dot-sourced into the wrapper,
# alone or next to jht-integration.ps1. A key a language lacks says the English of the call.
function Get-ToolsText {
  param([string]$Key, [string]$English)
  $lang = 'en'
  if (Get-Command Get-JhtTextLanguage -CommandType Function -ErrorAction SilentlyContinue) { $lang = [string](Get-JhtTextLanguage) }
  $text = Get-ToolsTextTable $lang $Key
  if ($null -eq $text) { return $English }
  return $text
}

# >>> texts in the 7 languages, made from shared/locales by `python3 tests/tools_ps1_texts.py --write`: do not edit by hand
function Get-ToolsTextTable {
  param([string]$Lang, [string]$Key)
  switch -CaseSensitive ("$Lang`:$Key") {
    'en:integration.state.engine_silent' { return 'the container engine does not answer' }
    'en:integration.tools.tier_not_removed' { return 'the runtime tier was not removed' }
    'en:integration.tools.usage' { return 'usage: jht tools status --json | pull | switch' }
    'it:integration.state.engine_silent' { return 'il motore dei container non risponde' }
    'it:integration.tools.tier_not_removed' { return 'livello del runtime non tolto' }
    'it:integration.tools.usage' { return 'uso: jht tools status --json | pull | switch' }
    'hu:integration.state.engine_silent' { return ('a kont' + [char]0x00E9 + 'nermotor nem v' + [char]0x00E1 + 'laszol') }
    'hu:integration.tools.tier_not_removed' { return ('a futtat' + [char]0x00F3 + 'k' + [char]0x00F6 + 'rnyezet szintje nem lett elt' + [char]0x00E1 + 'vol' + [char]0x00ED + 'tva') }
    'hu:integration.tools.usage' { return ('haszn' + [char]0x00E1 + 'lat: jht tools status --json | pull | switch') }
    'es:integration.state.engine_silent' { return 'el motor de contenedores no responde' }
    'es:integration.tools.tier_not_removed' { return 'el nivel del runtime no se ha quitado' }
    'es:integration.tools.usage' { return 'uso: jht tools status --json | pull | switch' }
    'de:integration.state.engine_silent' { return 'die Container-Engine antwortet nicht' }
    'de:integration.tools.tier_not_removed' { return 'die Stufe der Runtime wurde nicht entfernt' }
    'de:integration.tools.usage' { return 'Verwendung: jht tools status --json | pull | switch' }
    'fr:integration.state.engine_silent' { return ('le moteur de conteneurs ne r' + [char]0x00E9 + 'pond pas') }
    'fr:integration.tools.tier_not_removed' { return ('le niveau du runtime n''a pas ' + [char]0x00E9 + 't' + [char]0x00E9 + ' supprim' + [char]0x00E9) }
    'fr:integration.tools.usage' { return 'usage : jht tools status --json | pull | switch' }
    'pt:integration.state.engine_silent' { return ('o motor de contentores n' + [char]0x00E3 + 'o responde') }
    'pt:integration.tools.tier_not_removed' { return ('o n' + [char]0x00ED + 'vel do runtime n' + [char]0x00E3 + 'o foi removido') }
    'pt:integration.tools.usage' { return 'uso: jht tools status --json | pull | switch' }
  }
  return $null
}
# <<< texts in the 7 languages
$ToolsSwitchFailedFile = Join-Path $RuntimeDir '.tools-switch-failed'
# The switch under way (down of the core team, up on the full one): the pid of the job. `jht team chat` reads it when its REPL ends,
# to tell the person why (the REPL runs in the container, and the down ends it).
$ToolsSwitchingFile = Join-Path $RuntimeDir '.tools-switching'

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
# With `auto` (the job Invoke-ToolsKick starts) it goes on: it waits for the profile and makes the switch, holding the lock, so a
# second `jht up` finds the job there and starts no other.
function Invoke-ToolsPullJob {
  param([string]$Since, [string]$Auto = '')
  $here = Test-ToolsFullHere
  if (-not $here) {
    & { $ErrorActionPreference = 'Continue'; & docker pull $DefaultRuntimeImage *> $null }
    $here = ($LASTEXITCODE -eq 0 -and (Test-ToolsFullHere))
  }
  if ($here) {
    Remove-Item -LiteralPath $ToolsFailedFile -Force -ErrorAction SilentlyContinue
    Write-ToolsNotice 'ready' 'core' '' $Since
    if ($Auto -eq 'auto') { Wait-ToolsProfileAndSwitch }
  } else {
    [IO.File]::WriteAllText($ToolsFailedFile, "pull_failed`n", [Text.UTF8Encoding]::new($false))
    Write-ToolsNotice 'failed' 'core' 'pull_failed' $Since
  }
  Remove-Item -LiteralPath $ToolsLock -Recurse -Force -ErrorAction SilentlyContinue
  return 0
}

# Room for the full image, and the old images of JHT, as in jht-tools.sh (tools_disk_room): the full image is about 3.4 GB and its
# pull took some 6 GiB of a computer; when the room is short the old images of JHT go first, and still short nothing is pulled and
# the person is told (state `disk_low`; `jht up` tries again). Space that cannot be measured refuses nothing.
# JHT_TOOLS_PULL_MIN_FREE_GIB (10) is the room asked for.
function Get-ToolsPullNeedKib {
  $gib = [Environment]::GetEnvironmentVariable('JHT_TOOLS_PULL_MIN_FREE_GIB')
  if ($gib -notmatch '^[0-9]{1,6}$') { $gib = '10' }
  return ([long]$gib * 1048576)
}

# The least free KiB of the volumes the pull fills (the data folder's, and JHT_ENGINE_DISK_PATH: Get-DiskFreeMeasure is the
# wrapper's, as for `jht upgrade`), or $null when none can be measured.
function Get-ToolsDiskFreeKib {
  if (-not (Get-Command Get-DiskFreeMeasure -CommandType Function -ErrorAction SilentlyContinue)) { return $null }
  $volumes = @($JhtHome)
  if ($env:JHT_ENGINE_DISK_PATH) { $volumes += $env:JHT_ENGINE_DISK_PATH }
  $least = $null
  foreach ($volume in $volumes) {
    $measure = Get-DiskFreeMeasure $volume
    if ($null -eq $measure) { continue }
    $kib = [long][Math]::Floor([double]$measure.Free / 1024)
    if ($null -eq $least -or $kib -lt $least) { $least = $kib }
  }
  return $least
}

# The old images of JHT go, by the rules of the cleaning after `jht upgrade` (Remove-OldJhtImages in the wrapper: only the
# repositories of JHT by exact name, never an image of a container even stopped, by ID and without -f, never prune, never volumes,
# JHT_KEEP_OLD_IMAGES=1 keeps them all). Kept: the image the container runs, the core image of this version and, while the tier
# file is there, the full one. Only when the container runs on this version's core or full image, and never while an upgrade runs
# or waits to be resumed. Returns the KiB it freed.
function Remove-ToolsOldImages {
  try {
    if (-not ((Get-Command Remove-OldJhtImages -CommandType Function -ErrorAction SilentlyContinue) -and (Get-Command Get-UpgradeImage -CommandType Function -ErrorAction SilentlyContinue))) { return [long]0 }
    if ((Test-Path -LiteralPath (Join-Path $RuntimeDir '.upgrade.lock')) -or (Test-Path -LiteralPath (Join-Path $RuntimeDir '.upgrade-journal'))) { return [long]0 }
    $running = Get-PlainImageId (Get-UpgradeImage)
    if (-not $running) { return [long]0 }
    $coreId = Get-PlainImageId ((& { $ErrorActionPreference = 'Continue'; & docker image inspect --format '{{.Id}}' "ghcr.io/leopu00/jht@$CoreImageDigest" 2>$null } | Select-Object -First 1) -as [string])
    $fullId = Get-PlainImageId ((& { $ErrorActionPreference = 'Continue'; & docker image inspect --format '{{.Id}}' $DefaultRuntimeImage 2>$null } | Select-Object -First 1) -as [string])
    if ($running -ne $coreId -and $running -ne $fullId) { return [long]0 }
    $keep = if ($coreId) { $coreId } else { $running }
    $quiet = $script:UpgradeJson
    $script:UpgradeJson = $true
    try { Remove-OldJhtImages $running $keep } finally { $script:UpgradeJson = $quiet }
    if ($script:UpgradePrune -and $script:UpgradePrune.freedBytes) { return [long][Math]::Floor([double]$script:UpgradePrune.freedBytes / 1024) }
  } catch { }
  return [long]0
}

# $true when there is room for the pull, or it cannot be measured. The space the old images freed counts even when the disk does
# not show it yet (inside the machine of the engine it is free for the pull before the computer sees it).
function Test-ToolsDiskRoom {
  $need = Get-ToolsPullNeedKib
  $free = Get-ToolsDiskFreeKib
  if ($null -eq $free -or $free -ge $need) { return $true }
  $freed = Remove-ToolsOldImages
  $after = Get-ToolsDiskFreeKib
  if ($null -eq $after) { $after = $free }
  if (($free + $freed) -gt $after) { $after = $free + $freed }
  return ($after -ge $need)
}

# One job at a time, detached. $Auto = 'auto' for the job of Invoke-ToolsKick (it pulls if needed, then switches by itself).
function Start-ToolsJob {
  param([string]$Auto = '')
  $since = Get-ToolsNow
  Remove-Item -LiteralPath $ToolsLock -Recurse -Force -ErrorAction SilentlyContinue
  try { New-Item -ItemType Directory -Path $ToolsLock -ErrorAction Stop | Out-Null } catch { return 0 }  # another call won the race
  Remove-Item -LiteralPath $ToolsFailedFile -Force -ErrorAction SilentlyContinue
  if (-not (Test-ToolsFullHere) -and -not (Test-ToolsDiskRoom)) {
    [IO.File]::WriteAllText($ToolsFailedFile, "disk_low`n", [Text.UTF8Encoding]::new($false))
    Write-ToolsNotice 'failed' 'core' 'disk_low' $since
    Remove-Item -LiteralPath $ToolsLock -Recurse -Force -ErrorAction SilentlyContinue
    return 0
  }
  if (-not (Test-ToolsFullHere)) {
    if (-not $Auto) { [Console]::Out.WriteLine('JHT_PHASE tools_pull') }
    Write-ToolsNotice 'pulling' 'core' '' $since
  }
  $shell = (Get-Process -Id $PID).Path
  $jobArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $WrapperPath, 'tools', 'pull-job', $since)
  if ($Auto) { $jobArgs += 'auto' }
  $start = @{ FilePath = $shell; PassThru = $true; ArgumentList = $jobArgs }
  # -WindowStyle exists only on Windows: PowerShell 7 on Linux (a runner, a test) refuses the parameter.
  if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) { $start.WindowStyle = 'Hidden' }
  $process = Start-Process @start
  [IO.File]::WriteAllText((Join-Path $ToolsLock 'pid'), "$($process.Id)`n", [Text.UTF8Encoding]::new($false))
  return 0
}

function Start-ToolsPull {
  if (-not (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf)) { return 0 }
  if (-not (Test-ToolsEngineUp)) { Write-Err ('tools: ' + (Get-ToolsText 'integration.state.engine_silent' 'the container engine does not answer')); return 1 }
  if (Test-ToolsFullHere) {
    Remove-Item -LiteralPath $ToolsFailedFile -Force -ErrorAction SilentlyContinue
    Write-ToolsNotice 'ready' 'core' '' (Get-ToolsNow)
    return 0
  }
  if (Test-ToolsPulling) { return 0 }
  return (Start-ToolsJob)
}

# `jht up` / `jht setup` of a core install: the job that pulls and switches, unless one is already there. Prints nothing (the
# wrapper says what it means for the person, from Get-ToolsPersonState); never fails the command it rides on.
function Invoke-ToolsKick {
  try {
    # on the full image (the tier file gone) an `up` that got here went well: a switch that had failed is over
    if (-not (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf)) {
      Remove-Item -LiteralPath $ToolsSwitchFailedFile -Force -ErrorAction SilentlyContinue
      return 0
    }
    if (-not (Test-ToolsEngineUp)) { return 0 }
    if (Test-ToolsPulling) { return 0 }
    $null = Start-ToolsJob 'auto'
  } catch { }
  return 0
}

function Get-ToolsWaitSeconds {
  param([string]$Name, [int]$Default)
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ($value -match '^[0-9]{1,6}$') { return [int]$value }
  return $Default
}

# ready.flag means "the team starts", not "the onboarding is over": the Assistente sets it with three fields and goes on asking.
# The switch stops the container the conversation runs in, so it waits for the first of: profile\onboarding-done.flag, which the
# Assistente writes when its questions are over or the person says to stop (skill profile-yaml), or JHT_TOOLS_ONBOARDING_MAX
# seconds (1800) since ready.flag. The flag is the container's: it only says WHEN, and a link in its place is not believed.
function Wait-ToolsOnboardingDone {
  param($Flag)
  $cap = Get-ToolsWaitSeconds 'JHT_TOOLS_ONBOARDING_MAX' 1800
  $step = [Math]::Max(1, (Get-ToolsWaitSeconds 'JHT_TOOLS_WAIT_STEP' 15))
  $doneFlag = Join-Path (Join-Path $JhtHome 'profile') 'onboarding-done.flag'
  $since = $Flag.LastWriteTimeUtc
  while ($true) {
    if (-not (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf)) { return }
    $item = Get-Item -LiteralPath $doneFlag -Force -ErrorAction SilentlyContinue
    if ($item -and -not $item.PSIsContainer -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)) { return }
    if (([DateTime]::UtcNow - $since).TotalSeconds -ge $cap) { return }
    Start-Sleep -Seconds $step
  }
}

# The job waits for the profile (the onboarding has closed), then a little more, so the switch does not cut the last answers of the
# onboarding short; the tier file gone means someone made the switch by hand (`jht tools switch`).
function Wait-ToolsProfileAndSwitch {
  $flag = Join-Path $JhtHome 'profile\ready.flag'
  $step = Get-ToolsWaitSeconds 'JHT_TOOLS_WAIT_STEP' 15
  $left = Get-ToolsWaitSeconds 'JHT_TOOLS_WAIT_MAX' 86400
  while ($left -gt 0) {
    if (-not (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf)) { return }
    $item = Get-Item -LiteralPath $flag -Force -ErrorAction SilentlyContinue
    if ($item -and -not $item.PSIsContainer -and (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)) {
      Start-Sleep -Seconds (Get-ToolsWaitSeconds 'JHT_TOOLS_SWITCH_GRACE' 30)
      Wait-ToolsOnboardingDone $item
      Invoke-ToolsSwitchAuto
      return
    }
    Start-Sleep -Seconds ([Math]::Max(1, $step))
    $left -= [Math]::Max(1, $step)
  }
}

function Invoke-ToolsWrapperStep {
  param([string]$Step)
  $shell = (Get-Process -Id $PID).Path
  $run = @{ FilePath = $shell; Wait = $true; PassThru = $true; ArgumentList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $WrapperPath, $Step) }
  if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) { $run.WindowStyle = 'Hidden' } else { $run.NoNewWindow = $true }
  return [int](Start-Process @run).ExitCode
}

# Another `jht` command of this computer that changes the runtime is running (setup, up, down, an upgrade...): the switch waits for
# it, never in the middle of it. Only those: a command that reads or talks (`jht team chat` of the onboarding, logs, status, doctor,
# help...) does not hold the switch back, or the REPL the person keeps open after the onboarding kept the full team away for the
# whole half hour. The list is of what counts, not of what does not: a new command does not hold the switch until it is named here.
function Test-ToolsCommandChangesRuntime {
  param([string]$Command, [string]$Sub)
  switch -CaseSensitive ($Command) {
    { $_ -cin @('setup', 'up', 'start-container', 'down', 'stop-container', 'restart', 'recreate', 'upgrade', 'uninstall', 'reset', 'migrate-runtime', 'podman-machine-recreate') } { return $true }
    'config' { return ($Sub -ceq 'set') }
    'providers' { return ($Sub -ceq 'use' -or $Sub -ceq 'harness') }
    'integration' { return ($Sub -ceq 'add' -or $Sub -ceq 'remove') }
    'tools' { return ($Sub -ceq 'pull' -or $Sub -ceq 'switch') }
  }
  return $false
}

# The words after the wrapper's path on a command line: the command and its first argument (a closing quote of the path dropped).
function Get-ToolsWrapperWords {
  param([string]$Line, [string]$Wrapper)
  $at = $Line.IndexOf($Wrapper, [StringComparison]::OrdinalIgnoreCase)
  if ($at -lt 0) { return @() }
  $rest = $Line.Substring($at + $Wrapper.Length).TrimStart([char]34, [char]39)
  return @($rest.Split([char[]]@([char]32, [char]9), [StringSplitOptions]::RemoveEmptyEntries) | ForEach-Object { $_.Trim([char]34, [char]39) })
}

# The commands of the wrapper that say they are running (Register-JhtRunningCommand in jht-wrapper.ps1): "<pid> <start ticks>
# <command> <first argument>" in $RuntimeDir\.commands\<pid>. A process that is gone, or another one with the same PID (its start
# differs), says nothing, and its file is taken away. The job's own process is left out.
function Test-ToolsRegisteredCommandRunning {
  try {
    $dir = Join-Path $RuntimeDir '.commands'
    $item = Get-Item -LiteralPath $dir -Force -ErrorAction Stop
    if (-not $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return $false }
    foreach ($file in @(Get-ChildItem -LiteralPath $dir -File -Force -ErrorAction Stop)) {
      # one file that cannot be read or believed is left out, never the whole folder
      try {
        if ($file.Name -notmatch '^[0-9]{1,9}$' -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
        $fields = @(([IO.File]::ReadAllText($file.FullName)).Trim().Split([char]32))
        if ($fields.Count -lt 3 -or $fields[0] -cne $file.Name -or $fields[1] -notmatch '^[0-9]{1,19}$') { continue }
        $id = [int]$fields[0]
        if ($id -eq $PID) { continue }
        $process = Get-Process -Id $id -ErrorAction SilentlyContinue
        $alive = $false
        # the same start, give or take 2 s: on Linux .NET works the start out from the boot time, which each process reckons
        # a little differently; a PID used again by another process starts later than that
        if ($process) {
          try { $alive = ([Math]::Abs($process.StartTime.ToUniversalTime().Ticks - [long]$fields[1]) -le 2 * [TimeSpan]::TicksPerSecond) }
          catch { $alive = $true }
        }
        if (-not $alive) { Remove-Item -LiteralPath $file.FullName -Force -ErrorAction SilentlyContinue; continue }
        $sub = ''
        if ($fields.Count -gt 3) { $sub = $fields[3] }
        if (Test-ToolsCommandChangesRuntime $fields[2] $sub) { $script:ToolsRunningCommand = $fields[2]; return $true }
      } catch { continue }
    }
  } catch { }
  return $false
}

# The same from the command lines of the processes, where they can be read (Win32_Process, or PowerShell 7's Get-Process).
# The job is a process of its own with the wrapper on its command line: its own process is left out.
function Test-ToolsOtherWrapperRunning {
  if (Test-ToolsRegisteredCommandRunning) { return $true }
  try {
    # the path as the wrapper was given it and as GetFullPath says it (Windows PowerShell 5.1 turns an 8.3 short name into the long one)
    $wrappers = @($WrapperPath, [IO.Path]::GetFullPath($WrapperPath)) | Select-Object -Unique
    if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) {
      $lines = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine } | ForEach-Object { $_.CommandLine })
    } else {
      $lines = @(Get-Process -ErrorAction Stop | Where-Object { $_.Id -ne $PID -and $_.CommandLine } | ForEach-Object { $_.CommandLine })
    }
    foreach ($line in $lines) {
      $words = @()
      foreach ($wrapper in $wrappers) { if ($words.Count -eq 0) { $words = @(Get-ToolsWrapperWords $line $wrapper) } }
      if ($words.Count -eq 0) { continue }
      $sub = ''
      if ($words.Count -gt 1) { $sub = $words[1] }
      if (Test-ToolsCommandChangesRuntime $words[0] $sub) { $script:ToolsRunningCommand = $words[0]; return $true }
    }
  } catch { }
  return $false
}

# A command that changes the runtime holds the switch for JHT_TOOLS_QUIET_MAX seconds (1800) at most; a `jht setup` for as long as
# it runs (JHT_TOOLS_SETUP_MAX, a day): its wizard waits for the person, and a switch under it ends it all the same, half an hour on.
$script:ToolsRunningCommand = ''
function Wait-ToolsQuiet {
  $left = Get-ToolsWaitSeconds 'JHT_TOOLS_QUIET_MAX' 1800
  $setupLeft = Get-ToolsWaitSeconds 'JHT_TOOLS_SETUP_MAX' 86400
  while (Test-ToolsOtherWrapperRunning) {
    if ($script:ToolsRunningCommand -ceq 'setup') {
      if ($setupLeft -le 0) { return }
      $setupLeft -= 2
    } else {
      if ($left -le 0) { return }
      $left -= 2
    }
    Start-Sleep -Seconds 2
  }
}

# The switch of the job, when no other command runs. A team the person stopped (`jht down`) stays stopped: only the tier goes, and
# the next `jht up` starts on the full image. A team that runs is stopped FIRST, while the tier file still makes it the attested
# core container, then the tier goes and `up` starts it on the full one: never a window in which the running container is the core
# one and the wrapper already expects the full one. Refused still: the marker says so, and `jht up` / `jht status` tell the person
# to run `jht down` and `jht up`.
function Invoke-ToolsSwitchAuto {
  Wait-ToolsQuiet
  if (-not (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf)) { return }
  $stopped = $false
  if (Get-Command Test-JhtTeamStoppedByPerson -ErrorAction SilentlyContinue) { $stopped = [bool](Test-JhtTeamStoppedByPerson) }
  Remove-Item -LiteralPath $ToolsSwitchFailedFile -Force -ErrorAction SilentlyContinue
  Remove-Item Env:\JHT_IMAGE -ErrorAction SilentlyContinue
  if (-not $stopped) {
    [IO.File]::WriteAllText($ToolsSwitchingFile, "$PID`n", [Text.UTF8Encoding]::new($false))
    $null = Invoke-ToolsWrapperStep 'down'
  }
  try {
    try {
      Remove-Item -LiteralPath $RuntimeTierFile -Force
      Remove-Item -LiteralPath $RuntimeTierIntegrity -Force -ErrorAction SilentlyContinue
    } catch { return }
    if ($stopped) { Write-ToolsNotice 'ready' 'full' '' (Get-ToolsNow) }
    elseif ((Invoke-ToolsWrapperStep 'up') -eq 0) { Write-ToolsNotice 'ready' 'full' '' (Get-ToolsNow); $null = Remove-ToolsOldImages }
    else {
      [IO.File]::WriteAllText($ToolsSwitchFailedFile, "switch_failed`n", [Text.UTF8Encoding]::new($false))
      Write-ToolsNotice 'failed' 'full' 'switch_failed' (Get-ToolsNow)
    }
  } finally {
    Remove-Item -LiteralPath $ToolsSwitchingFile -Force -ErrorAction SilentlyContinue
  }
}

# What the wrapper tells the person, one word: arriving (pulling or waiting), failed (the pull), disk_low (no room for the pull),
# switch_failed, or ''.
function Get-ToolsPersonState {
  $tierHere = Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf
  if ((-not $tierHere) -and (Test-Path -LiteralPath $ToolsSwitchFailedFile -PathType Leaf)) { return 'switch_failed' }
  if (-not $tierHere) { return '' }
  if (-not (Test-ToolsEngineUp)) { return '' }
  if (Test-ToolsFullHere) { return 'waiting' }
  if (Test-ToolsPulling) { return 'arriving' }
  if (Test-Path -LiteralPath $ToolsFailedFile -PathType Leaf) {
    try { if ([IO.File]::ReadAllText($ToolsFailedFile).Trim() -ceq 'disk_low') { return 'disk_low' } } catch { }
    return 'failed'
  }
  return 'arriving'
}

# The switch: the tier file goes (and the manifest stops attesting it), then an `up` on the image of the compose, the full one.
function Invoke-ToolsSwitch {
  $flag = Join-Path $JhtHome 'profile\ready.flag'
  if (-not (Test-Path -LiteralPath $RuntimeTierFile -PathType Leaf)) { return 0 }
  if (-not (Test-Path -LiteralPath $flag -PathType Leaf) -or ((Get-Item -LiteralPath $flag -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { return 0 }
  if (-not ((Test-ToolsEngineUp) -and (Test-ToolsFullHere))) { return 0 }
  try {
    # The file first, its integrity second: a crash between them leaves an integrity without a file, which reads as the whole image.
    Remove-Item -LiteralPath $RuntimeTierFile -Force
    Remove-Item -LiteralPath $RuntimeTierIntegrity -Force -ErrorAction SilentlyContinue
  } catch { Write-Err ('tools: ' + (Get-ToolsText 'integration.tools.tier_not_removed' 'the runtime tier was not removed')); return 1 }
  Remove-Item Env:\JHT_IMAGE -ErrorAction SilentlyContinue
  $shell = (Get-Process -Id $PID).Path
  $up = Start-Process -FilePath $shell -NoNewWindow -Wait -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $WrapperPath, 'up')
  if ($up.ExitCode -ne 0) { return [int]$up.ExitCode }
  Write-ToolsNotice 'ready' 'full' '' (Get-ToolsNow)
  $null = Remove-ToolsOldImages
  [Console]::Out.WriteLine('JHT_PHASE tools_ready')
  return 0
}

function Invoke-ToolsCommand {
  param([string[]]$ToolsArgs)
  $a = @($ToolsArgs)
  $sub = if ($a.Count -ge 1) { $a[0] } else { '' }
  if ($sub -eq 'status' -and $a.Count -eq 2 -and $a[1] -eq '--json') { return (Write-ToolsStatusJson) }
  # one line for the person: the words are the wrapper's (Write-JhtToolsStatus in jht-wrapper.ps1, the 7 languages)
  if ($sub -eq 'status' -and $a.Count -eq 1 -and (Get-Command Write-JhtToolsStatus -CommandType Function -ErrorAction SilentlyContinue)) { Write-JhtToolsStatus; return 0 }
  if ($sub -eq 'pull' -and $a.Count -eq 1) { return (Start-ToolsPull) }
  if ($sub -eq 'switch' -and $a.Count -eq 1) { return (Invoke-ToolsSwitch) }
  if ($sub -eq 'pull-job' -and $a.Count -eq 2) { return (Invoke-ToolsPullJob $a[1]) }
  if ($sub -eq 'pull-job' -and $a.Count -eq 3 -and $a[2] -eq 'auto') { return (Invoke-ToolsPullJob $a[1] 'auto') }
  Write-Err (Get-ToolsText 'integration.tools.usage' 'usage: jht tools status --json | pull | switch')
  return 2
}

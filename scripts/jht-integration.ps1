# jht-integration.ps1 - `jht integration list|status|add|remove`: the integrations a person adds AFTER the setup.
#
# Not a program: a library the wrapper dot-sources once its digest matches the runtime manifest (Import-RuntimeHelper in
# jht-wrapper.ps1). It uses the wrapper's own functions (Invoke-Compose, Get-RunningComposeServiceId, Ensure-Up).
# JHT_RUNTIME_HELPER=1
#
# Same contract as scripts/jht-integration.sh, which is the reference:
#   - the id is one of a CLOSED list, checked before anything else; no text of the person ever reaches a native command;
#   - the state is read from the ENGINE (container found by the wrapper, volumes of the compose project) and from small
#     host-owned markers in $RuntimeDir\integrations, never from a file the container can write;
#   - nothing is turned on by an agent: this is the command the person types (or the button of the app).
# States (JSON `state`): not_installed | downloading | ready | running | error, always with a `reason` of one line.
# Exit: 0 done - 1 failed - 2 wrong use - 3 not available yet.

$IntegrationIds = @('google', 'telegram', 'mail', 'linkedin-login', 'screen', 'media')
$IntegrationNotYet = @()
# Fixed text, run inside the team's container: the libraries of Google go to the person's own store (jht-install).
# Single quotes only: Windows PowerShell 5.1 drops a double quote inside a native argument.
$IntegrationGoogleCode = "import sys; sys.path.insert(0, '/app/shared/skills'); from optional_libs import ensure, GOOGLE_DRIVE, GOOGLE_SHEETS; ensure(*GOOGLE_DRIVE, 'Google Drive'); ensure(*GOOGLE_SHEETS, 'Google Sheets')"

function Get-IntegrationLabel {
  param([string]$State)
  switch -CaseSensitive ($State) {
    'not_installed' { return 'non installato' }
    'downloading' { return 'in scaricamento' }
    'ready' { return 'aggiunto' }
    'running' { return 'acceso' }
    default { return 'errore' }
  }
}

# Text from a command goes through here: printable ASCII only, one line, short.
function Get-IntegrationForeign {
  param([string]$Text)
  $clean = -join ($Text.ToCharArray() | Where-Object { [int]$_ -ge 32 -and [int]$_ -le 126 })
  if ($clean.Length -gt 200) { return $clean.Substring(0, 200) }
  return $clean
}

# ---- Host markers: <id>.pending (pid of the run in progress), <id>.error (one line), google.ok ----
function Get-IntegrationDir { return (Join-Path $RuntimeDir 'integrations') }

function Test-IntegrationDirReady {
  $dir = Get-IntegrationDir
  if (-not (Test-Path -LiteralPath $dir)) {
    try { New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null } catch { return $false }
  }
  return (Test-ProtectedRuntimeNode $dir -Directory)
}

function Read-IntegrationMarker {
  param([string]$Id, [string]$Kind)
  $file = Join-Path (Get-IntegrationDir) "$Id.$Kind"
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $null }
  if (-not (Test-ProtectedRuntimeNode $file)) { return $null }
  $line = @(Get-Content -LiteralPath $file -TotalCount 1 -ErrorAction SilentlyContinue)
  if ($line.Count -eq 0) { return '' }
  return [string]$line[0]
}

function Write-IntegrationMarker {
  param([string]$Id, [string]$Kind, [string]$Text)
  if (-not (Test-IntegrationDirReady)) { return $false }
  try {
    Publish-JhtFile -Destination (Join-Path (Get-IntegrationDir) "$Id.$Kind") -Bytes ([Text.UTF8Encoding]::new($false).GetBytes("$Text`n"))
    return $true
  } catch { return $false }
}

function Clear-IntegrationMarker {
  param([string]$Id, [string]$Kind)
  Remove-Item -LiteralPath (Join-Path (Get-IntegrationDir) "$Id.$Kind") -Force -ErrorAction SilentlyContinue
}

# A run in progress leaves its pid; a pid that is not alive (Ctrl-C, closed terminal) is no run.
function Test-IntegrationPending {
  param([string]$Id)
  $text = Read-IntegrationMarker $Id 'pending'
  if (-not $text -or $text -notmatch '^[0-9]+$') { return $false }
  return [bool](Get-Process -Id ([int]$text) -ErrorAction SilentlyContinue)
}

# ---- What the engine says ----
# $true: the volume is among those of the compose project; $false: it is not; $null: the engine did not answer.
function Test-IntegrationVolumePresent {
  param([string]$Volume)
  $project = Get-ComposeProjectName
  if (-not $project) { return $null }
  $ids = @(& { $ErrorActionPreference = 'Continue'; & docker volume ls -q --filter "label=com.docker.compose.project=$project" 2>$null })
  if ($LASTEXITCODE -ne 0) { return $null }
  return (@($ids | ForEach-Object { "$($_)".Trim() }) -contains "${project}_$Volume")
}

# id -> @(service, volume that exists once it has been made)
function Get-IntegrationService {
  param([string]$Id)
  switch -CaseSensitive ($Id) {
    'telegram' { return @($TelegramContainer, 'jht-telegram-state') }
    'mail' { return @($BrokerContainer, 'jht-broker-state') }
  }
  return $null
}

# @(state, reason). The engine is only asked, never started.
function Get-IntegrationState {
  param([string]$Id)
  if ($IntegrationNotYet -ccontains $Id) { return @('not_installed', 'non disponibile ancora') }
  if (Test-IntegrationPending $Id) { return @('downloading', 'operazione in corso') }
  if ($Id -ceq 'google') {
    if ($null -ne (Read-IntegrationMarker 'google' 'ok')) { return @('ready', 'librerie di Google aggiunte al profilo; mancano le credenziali dell''account Google') }
  } elseif ($Id -ceq 'linkedin-login') {
    if (-not (Test-DockerReachable)) { return @('error', 'il motore dei container non risponde') }
    if (Test-LinkedinAnyRunning) { return @('running', 'accesso a LinkedIn in corso') }
    return @('not_installed', 'si accende con: jht linkedin login')
  } elseif ($Id -ceq 'screen') {
    if (-not (Test-DockerReachable)) { return @('error', 'il motore dei container non risponde') }
    if (Get-RunningComposeServiceId $ScreenContainer) { return @('running', 'schermo acceso, stream in sola vista su 127.0.0.1') }
    if ($script:ServiceLookupReason -notmatch '^(compose ps listed no running container|no running container of)') {
      return @('error', "il container non e' attestabile")
    }
    if ($null -ne (Read-IntegrationMarker 'screen' 'ok')) { return @('ready', "chiesto acceso ma il container e' spento: jht screen on lo riaccende") }
  } elseif ($Id -ceq 'media') {
    # The two folders it shares with jht are made by `jht up` whether it is added or not: its own marker says "added".
    if (-not (Test-DockerReachable)) { return @('error', 'il motore dei container non risponde') }
    if (Get-RunningComposeServiceId $MediaContainer) { return @('running', 'container acceso') }
    if ($script:ServiceLookupReason -notmatch '^(compose ps listed no running container|no running container of)') {
      return @('error', "il container non e' attestabile")
    }
    if ($null -ne (Read-IntegrationMarker 'media' 'ok')) { return @('ready', 'aggiunto, container spento: jht integration add media lo riaccende') }
  } else {
    $service = Get-IntegrationService $Id
    if (-not (Test-DockerReachable)) { return @('error', 'il motore dei container non risponde') }
    $running = Get-RunningComposeServiceId $service[0]
    if ($running) {
      # One true state: a Telegram service that is up but holds no bot is not «acceso» for the person, it waits for a token
      # (the same question `jht status` asks). Any answer but a clear «none» keeps what the engine says.
      if ($Id -ceq 'telegram' -and (Get-Command Get-TelegramBotsConfigured -ErrorAction SilentlyContinue)) {
        $configured = Get-TelegramBotsConfigured
        if ($configured -is [bool] -and -not $configured) { return @('ready', 'servizio acceso, nessun bot abbinato: jht telegram pair assistente') }
      }
      return @('running', 'container acceso')
    }
    if ($script:ServiceLookupReason -notmatch '^(compose ps listed no running container|no running container of)') {
      return @('error', "il container non e' attestabile")
    }
    $present = Test-IntegrationVolumePresent $service[1]
    if ($null -eq $present) { return @('error', 'il motore dei container non risponde') }
    if ($present) { return @('ready', 'creato, container spento') }
  }
  $failed = Read-IntegrationMarker $Id 'error'
  if ($failed) { return @('error', (Get-IntegrationForeign $failed)) }
  return @('not_installed', 'non ancora aggiunto')
}

# ---- Output ----
function Write-IntegrationJson {
  param($Value)
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $Value -Compress -Depth 5))
}

function Get-IntegrationRow {
  param([string]$Id)
  $state = Get-IntegrationState $Id
  return [ordered]@{ id = $Id; state = $state[0]; reason = $state[1] }
}

function Write-IntegrationStatus {
  param([string]$Id, [bool]$Json)
  $row = Get-IntegrationRow $Id
  if ($Json) { Write-IntegrationJson $row; return }
  [Console]::Out.WriteLine(('{0,-15} {1,-16} {2}' -f $Id, (Get-IntegrationLabel $row.state), $row.reason))
}

function Write-IntegrationList {
  param([bool]$Json)
  if ($Json) {
    $rows = @(foreach ($id in $IntegrationIds) { Get-IntegrationRow $id })
    Write-IntegrationJson ([ordered]@{ integrations = $rows })
    return
  }
  foreach ($id in $IntegrationIds) { Write-IntegrationStatus $id $false }
}

# `compose stop` and `compose rm -f` of a service that is not there write «No stopped containers» (Podman) to stderr and succeed: in PowerShell
# that is a red error record for something that is not one. Their stderr is dropped here (the reason shown is ours) and the exit code is the answer.
function Invoke-IntegrationComposeQuiet {
  $words = @($args)  # inside the script block below `$args` would be the block's own, empty
  $code = & { $ErrorActionPreference = 'Continue'; Invoke-Compose @words *> $null; $LASTEXITCODE }
  return [int]$code
}

# ---- the engine, when `up` of a tool fails ----
# On Windows the engine is a Podman machine reached through a connection. A first `up` of a tool that failed with «get machine connection URI:
# could not find a matching machine for connection ssh://…» (the next tries worked) left nothing to understand it by. The state is written
# to the runtime log of the desktop (the same file the machine start writes to): the connection this run uses, the connections and the
# machines Podman lists (names, ports and running state only: no identity file, no key), and which variables name a host. The `up` is
# idempotent, so it is tried once more after a few seconds; a second failure says where the state is.
$IntegrationRetryWaitSeconds = 5
# Podman's `compose` finds the machine of a connection by asking the engine of the machine for its state (WSL, on Windows), and WHEN THAT
# QUESTION FAILS IT SAYS «could not find a matching machine» (podman 6.0.2, internal/localapi FindMachineByPort: the error of the state is
# dropped, the loop goes on and ends with that sentence). The question fails while the machine is busy: the first start of a tool copies
# a browser of hundreds of MB into a volume and pulls an image of about 1 GB at the same time, on a machine of 2 CPUs. One more try after 5 s
# is not always enough then, so the steps are tried up to this many times, the wait growing ×3 each time (5 s, 15 s).
$IntegrationEngineTries = 3
# A start of a tool that takes longer than this writes where the time went (pull, copy of the browser, start) to the same log.
$IntegrationSlowSeconds = 60

function Get-IntegrationRuntimeLogPath {
  if ($script:IntegrationRuntimeLogPath) { return [string]$script:IntegrationRuntimeLogPath }
  return (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'ai.jobhunterteam.desktop\logs\runtime.log')
}

function Get-IntegrationEngineState {
  $lines = New-Object System.Collections.Generic.List[string]
  $lines.Add("connection_used=$($env:CONTAINER_CONNECTION)")
  $lines.Add("host_variables=CONTAINER_HOST:$([bool]$env:CONTAINER_HOST) DOCKER_HOST:$([bool]$env:DOCKER_HOST)")
  # The program itself, never an alias or a function of the person's profile (the wrapper runs with it loaded): found as an application,
  # and called by the name with its extension, which no alias or function of a profile takes.
  $podman = Get-Command podman.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $podman) { $lines.Add('podman=not found'); return $lines.ToArray() }
  $queries = @(
    @('connections', @('system', 'connection', 'list', '--format', '{{.Name}} {{.URI}} default={{.Default}}')),
    @('machines', @('machine', 'list', '--format', '{{.Name}} running={{.Running}} starting={{.Starting}} port={{.Port}} lastup={{.LastUp}}'))
  )
  foreach ($query in $queries) {
    $lines.Add("$($query[0]):")
    $podmanArguments = [string[]]$query[1]
    $out = @(& { $ErrorActionPreference = 'Continue'; & podman.exe @podmanArguments 2>&1 })
    $lines.Add("  exit=$LASTEXITCODE")
    $rows = @($out | ForEach-Object { ([string]$_).Trim() })
    # The connections of the person to other hosts are not ours to write down: this runtime's own, and the ones on this computer.
    if ($query[0] -ceq 'connections') { $rows = @($rows | Where-Object { $_.StartsWith("$($env:CONTAINER_CONNECTION) ") -or $_ -match '@(127\.0\.0\.1|localhost)[:/]' }) }
    foreach ($row in @($rows | Select-Object -First 20)) { $lines.Add('  ' + $row.Substring(0, [Math]::Min(300, $row.Length))) }
  }
  return $lines.ToArray()
}

function Write-IntegrationEngineLog {
  param([string]$Tool, [string]$Code, [int]$ExitCode, [string[]]$Lines = @())
  try {
    $path = Get-IntegrationRuntimeLogPath
    $directory = Split-Path -LiteralPath $path
    [void][IO.Directory]::CreateDirectory($directory)
    foreach ($node in @($directory, $path)) {
      if ((Test-Path -LiteralPath $node) -and (((Get-Item -LiteralPath $node -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { return }
    }
    $text = "=== $([DateTime]::UtcNow.ToString('o')) integration_engine_${Code}: tool=$Tool exit=$ExitCode`n"
    foreach ($line in $Lines) { $text += "    $line`n" }
    [IO.File]::AppendAllText($path, $text, [Text.UTF8Encoding]::new($false))
  } catch { }
}

# One compose step of a tool (the copy of the browser, the `up`), tried again after a failure when the engine is a Podman machine: the
# steps are idempotent (the copy ends with a marker, the `up` leaves a container that is there and unchanged as it is). Returns the exit code
# of the last try. The state of the engine is written once, at the first failure, while it is still what made it fail.
function Invoke-IntegrationEngineStep {
  param([string]$Tool, [string[]]$ComposeArguments)
  Invoke-Compose @ComposeArguments | Out-Null
  $code = $LASTEXITCODE
  if ($code -eq 0 -or $ContainerRuntime -ne 'podman') { return [int]$code }
  Write-IntegrationEngineLog -Tool $Tool -Code 'failed' -ExitCode $code -Lines (Get-IntegrationEngineState)
  $wait = $IntegrationRetryWaitSeconds
  $tries = 1
  while ($code -ne 0 -and $tries -lt $IntegrationEngineTries) {
    Start-Sleep -Seconds $wait
    $wait = $wait * 3
    Invoke-Compose @ComposeArguments | Out-Null
    $code = $LASTEXITCODE
    $tries++
  }
  Write-IntegrationEngineLog -Tool $Tool -Code 'retried' -ExitCode $code -Lines @("tries=$tries")
  if ($code -ne 0) { [Console]::Error.WriteLine("stato del motore Podman scritto in $(Get-IntegrationRuntimeLogPath)") }
  return [int]$code
}

# Where the time of a start goes: seconds of each phase, written to the runtime log only when the whole took longer than a minute (a good
# quick start writes nothing). On Windows 11 and 10 the first start has taken from 2 to 6 minutes with nothing on the screen to tell the
# pull of the image from the copy of the browser from the start of the container.
function Start-IntegrationPhases {
  $script:IntegrationPhaseWatch = [Diagnostics.Stopwatch]::StartNew()
  $script:IntegrationPhaseSeconds = [ordered]@{}
  $script:IntegrationPhaseMark = 0
}
function Complete-IntegrationPhase {
  param([string]$Name)
  if (-not $script:IntegrationPhaseWatch) { return }
  $now = [int][Math]::Round($script:IntegrationPhaseWatch.Elapsed.TotalSeconds)
  $script:IntegrationPhaseSeconds[$Name] = $now - $script:IntegrationPhaseMark
  $script:IntegrationPhaseMark = $now
}
function Write-IntegrationPhasesLog {
  param([string]$Tool)
  if (-not $script:IntegrationPhaseWatch -or $ContainerRuntime -ne 'podman') { return }
  $total = [int][Math]::Round($script:IntegrationPhaseWatch.Elapsed.TotalSeconds)
  if ($total -lt $IntegrationSlowSeconds) { return }
  $lines = @("total=${total}s")
  foreach ($name in $script:IntegrationPhaseSeconds.Keys) { $lines += "$name=$($script:IntegrationPhaseSeconds[$name])s" }
  Write-IntegrationEngineLog -Tool $Tool -Code 'slow' -ExitCode 0 -Lines $lines
}

# The result of add/remove, in the form the person asked for.
function Write-IntegrationResult {
  param([string]$Id, [bool]$Json, [int]$Code, [string]$Reason)
  $state = Get-IntegrationState $Id
  $text = $state[1]
  $name = $state[0]
  if ($Code -ne 0) { if ($Code -ne 3) { $name = 'error' }; $text = $Reason }
  # what the run said about itself (the data that stayed, the volume left) is worth more than the state's own line
  if ($Code -eq 0 -and $Reason) { $text = $Reason }
  if ($Json) {
    Write-IntegrationJson ([ordered]@{ id = $Id; ok = ($Code -eq 0); state = $name; reason = $text })
  } elseif ($Code -eq 0) {
    Write-Info "${Id}: $(Get-IntegrationLabel $name) ($text)"
  } else {
    Write-Err "${Id}: $text"
  }
  return $Code
}

# The media container (voice notes and photos): the extras image by the digest this wrapper carries, then the profile of the compose.
$MediaContainer = 'jht-media'
# The live screen of the closer, and the one-shot that copies its browser into a volume (see jht-integration.sh).
$ScreenContainer = 'jht-screen'
$PlaywrightPopulateContainer = 'jht-playwright-populate'

# The reference of the extras image, or '' while the release has none (the digest is checked in its exact shape first).
function Get-IntegrationExtrasRef {
  if ($ExtrasImageDigest -cmatch '^sha256:[0-9a-f]{64}$') { return "ghcr.io/leopu00/jht@$ExtrasImageDigest" }
  return ''
}

# The folder of the viewer password of the live screen, and whether what is there is fit to be mounted: nothing, or a plain folder,
# never a link (a symlink, a junction: anything with a reparse point).
function Get-IntegrationScreenFolder { return (Join-Path $JhtHome 'live-screen') }
function Test-IntegrationScreenFolder {
  $item = Get-Item -LiteralPath (Get-IntegrationScreenFolder) -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $true }
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType) { return $false }
  return [bool]$item.PSIsContainer
}

# ---- add ----
function Invoke-IntegrationAdd {
  param([string]$Id)
  $script:IntegrationWhy = ''
  Start-IntegrationPhases
  try { return (Invoke-IntegrationAddStep $Id) } finally { Write-IntegrationPhasesLog $Id }
}

function Invoke-IntegrationAddStep {
  param([string]$Id)
  switch -CaseSensitive ($Id) {
    'google' {
      Ensure-Up
      $out = @(& { $ErrorActionPreference = 'Continue'; & docker exec -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container python3 -c $IntegrationGoogleCode 2>&1 })
      if ($LASTEXITCODE -ne 0) {
        $last = if ($out.Count) { [string]$out[$out.Count - 1] } else { '' }
        $script:IntegrationWhy = Get-IntegrationForeign $last
        if (-not $script:IntegrationWhy) { $script:IntegrationWhy = 'installazione delle librerie non riuscita' }
        return 1
      }
      if (-not (Write-IntegrationMarker 'google' 'ok' 'ok')) { $script:IntegrationWhy = 'marcatore non scritto'; return 1 }
    }
    'telegram' {
      Invoke-Compose '--profile' 'telegram' up '-d' $TelegramContainer | Out-Null
      if ($LASTEXITCODE -ne 0) { $script:IntegrationWhy = 'il servizio Telegram non parte'; return 1 }
      if ((Confirm-TelegramLifecycle 'start') -ne 0) { $script:IntegrationWhy = 'il servizio Telegram non risulta acceso'; return 1 }
    }
    'media' {
      $ref = Get-IntegrationExtrasRef
      if (-not $ref) { $script:IntegrationWhy = 'non disponibile ancora'; return 3 }
      & { $ErrorActionPreference = 'Continue'; & docker pull $ref *> $null }
      $pullCode = $LASTEXITCODE
      Complete-IntegrationPhase 'pull'
      if ($pullCode -ne 0) { $script:IntegrationWhy = "download dell'immagine degli strumenti non riuscito"; return 1 }
      $before = $env:JHT_EXTRAS_IMAGE
      try {
        $env:JHT_EXTRAS_IMAGE = $ref
        $code = Invoke-IntegrationEngineStep 'media' @('--profile', 'media', 'up', '-d', $MediaContainer)
        Complete-IntegrationPhase 'up'
      } finally { if ($null -eq $before) { Remove-Item Env:\JHT_EXTRAS_IMAGE -ErrorAction SilentlyContinue } else { $env:JHT_EXTRAS_IMAGE = $before } }
      if ($code -ne 0) { $script:IntegrationWhy = 'il container dei media non parte'; return 1 }
      if (-not (Get-RunningComposeServiceId $MediaContainer)) { $script:IntegrationWhy = 'il container dei media non risulta acceso'; return 1 }
      if (-not (Write-IntegrationMarker 'media' 'ok' 'ok')) { $script:IntegrationWhy = 'marcatore non scritto'; return 1 }
    }
    'linkedin-login' {
      $script:IntegrationWhy = 'non si aggiunge: si accende con jht linkedin login'
      return 3
    }
    'screen' {
      $ref = Get-IntegrationExtrasRef
      if (-not $ref) { $script:IntegrationWhy = 'non disponibile ancora'; return 3 }
      & { $ErrorActionPreference = 'Continue'; & docker pull $ref *> $null }
      $pullCode = $LASTEXITCODE
      Complete-IntegrationPhase 'pull'
      if ($pullCode -ne 0) { $script:IntegrationWhy = "download dell'immagine degli strumenti non riuscito"; return 1 }
      # The folder the desktop app reads the viewer password from is made here, by the person: a bind mount of a folder that is not there
      # would be made by the engine, with its own owner.
      # It is mounted writable in the screen container, and the agents write in this folder: a link (a reparse point) in its place would
      # have the engine mount what it points to. A plain folder or the run stops.
      if (-not (Test-IntegrationScreenFolder)) { $script:IntegrationWhy = "live-screen in ~/.jht non e' una cartella normale (un collegamento?): non la uso"; return 1 }
      if (-not (Test-Path -LiteralPath (Get-IntegrationScreenFolder))) {
        try { New-Item -ItemType Directory -Path (Get-IntegrationScreenFolder) -ErrorAction Stop | Out-Null }
        catch { $script:IntegrationWhy = 'cartella della password dello schermo non creata'; return 1 }
      }
      $beforeImage = $env:JHT_EXTRAS_IMAGE; $beforeDigest = $env:JHT_EXTRAS_DIGEST
      try {
        $env:JHT_EXTRAS_IMAGE = $ref
        # The closer's browser with a window comes from the volume the one-shot fills: ready before the screen is.
        $env:JHT_EXTRAS_DIGEST = $ExtrasImageDigest
        $code = Invoke-IntegrationEngineStep 'screen-browser' @('--profile', 'playwright', 'run', '--rm', '--no-deps', '-T', $PlaywrightPopulateContainer)
        Complete-IntegrationPhase 'browser'
        if ($code -ne 0) { $script:IntegrationWhy = 'il browser del closer non si copia nel volume'; return 1 }
        Remove-Item Env:\JHT_EXTRAS_DIGEST -ErrorAction SilentlyContinue
        # Checked again right before the up (the copy above took time): what is left is the instant between this test and the engine's
        # mount, which an agent that wins the race can use; the folder holds nothing but a viewer password.
        if (-not ((Test-IntegrationScreenFolder) -and (Test-Path -LiteralPath (Get-IntegrationScreenFolder) -PathType Container))) {
          $script:IntegrationWhy = "live-screen in ~/.jht non e' una cartella normale (un collegamento?): non la uso"; return 1
        }
        $code = Invoke-IntegrationEngineStep 'screen' @('--profile', 'screen', 'up', '-d', $ScreenContainer)
        Complete-IntegrationPhase 'up'
      } finally {
        if ($null -eq $beforeImage) { Remove-Item Env:\JHT_EXTRAS_IMAGE -ErrorAction SilentlyContinue } else { $env:JHT_EXTRAS_IMAGE = $beforeImage }
        if ($null -eq $beforeDigest) { Remove-Item Env:\JHT_EXTRAS_DIGEST -ErrorAction SilentlyContinue } else { $env:JHT_EXTRAS_DIGEST = $beforeDigest }
      }
      if ($code -ne 0) { $script:IntegrationWhy = 'il container dello schermo non parte'; return 1 }
      if (-not (Get-RunningComposeServiceId $ScreenContainer)) { $script:IntegrationWhy = 'il container dello schermo non risulta acceso'; return 1 }
      if (-not (Write-IntegrationMarker 'screen' 'ok' 'ok')) { $script:IntegrationWhy = 'marcatore non scritto'; return 1 }
    }
    'mail' {
      if ((Ensure-Broker -Quiet 6>$null) -ne 0) { $script:IntegrationWhy = 'il broker della posta non parte'; return 1 }
      if (-not (Get-RunningComposeServiceId $BrokerContainer)) { $script:IntegrationWhy = 'il broker della posta non risulta acceso'; return 1 }
    }
  }
  return 0
}

# ---- remove ----
# Volumes that belong to one integration only. The ones shared with `jht` (sockets) are never listed, and neither is jht-secrets:
# it holds the credentials of every portal besides the mailbox (jht reset --scope creds is the way to empty it).
function Get-IntegrationVolumes {
  param([string]$Id)
  switch -CaseSensitive ($Id) {
    'telegram' { return @('jht-telegram-secrets', 'jht-telegram-state', 'jht-telegram-inbox') }
    'mail' { return @('jht-broker-state') }
    'screen' { return @('jht-x11') }
    'linkedin-login' { return @('jht-login-vnc', 'jht-login-egress') }
  }
  return @()
}

# An older compose still starts the broker with `jht up`: removing it now would only be undone by the next start.
function Test-IntegrationBrokerOnRequest {
  $inService = $false
  foreach ($line in @(Get-Content -LiteralPath $ComposeFile)) {
    if ($line -ceq "  ${BrokerContainer}:") { $inService = $true; continue }
    if ($inService -and $line -match '^  \S') { return $false }
    if ($inService -and $line -match '^    profiles:') { return $true }
  }
  return $false
}

# The extras image (the browser, the screen, the media tools) stays on the disk when a tool made of it is switched off: it was downloaded when the
# person asked for the tool, and the next `on` finds it instead of downloading it again. It goes with `--remove-image`, or with the uninstall (the
# Podman machine goes with everything in it). What the engine reports as the size of the image is the whole of it, and a part is shared with the
# core image: «fino a». Returns 0 done, 1 when the engine does not take the image away.
function Set-IntegrationExtrasAfterOff {
  param([string]$Tool, [bool]$RemoveImage)
  $ref = Get-IntegrationExtrasRef
  if (-not $ref) { return 0 }
  $lines = @(& { $ErrorActionPreference = 'Continue'; & docker image inspect --format '{{.Size}}' $ref 2>$null })
  if ($LASTEXITCODE -ne 0) { return 0 }   # the image is not there: nothing to say
  $mb = ''
  $bytes = if ($lines.Count) { ([string]$lines[0]).Trim() } else { '' }
  if ($bytes -cmatch '^[0-9]+$') { $mb = " (fino a $([long][Math]::Floor([double]$bytes / 1000000)) MB)" }
  if ($RemoveImage) {
    $other = ''
    foreach ($candidate in @('linkedin-login', 'media', 'screen')) {
      if ($candidate -ceq $Tool) { continue }
      if ($null -ne (Read-IntegrationMarker $candidate 'ok')) { $other = $candidate; break }
    }
    if ($other) {
      $script:IntegrationWhy = "$($script:IntegrationWhy); l'immagine degli strumenti$mb non e' tolta: la usa ancora $other"
      return 0
    }
    $null = & { $ErrorActionPreference = 'Continue'; & docker rmi $ref 2>&1 }
    if ($LASTEXITCODE -ne 0) {
      $script:IntegrationWhy = "container tolto, ma il motore non toglie l'immagine degli strumenti${mb}: la usa ancora qualcosa"
      return 1
    }
    $script:IntegrationWhy = "$($script:IntegrationWhy); immagine degli strumenti tolta$mb"
    return 0
  }
  $command = if ($Tool -ceq 'screen') { 'jht screen off --remove-image' } else { "jht integration remove $Tool --remove-image" }
  $script:IntegrationWhy = "$($script:IntegrationWhy); l'immagine degli strumenti$mb resta sul disco per riaccenderlo senza riscaricarla: per liberare lo spazio, $command"
  return 0
}

function Invoke-IntegrationRemove {
  param([string]$Id, [bool]$Purge, [bool]$RemoveImage = $false)
  $script:IntegrationWhy = ''
  switch -CaseSensitive ($Id) {
    'google' {
      Clear-IntegrationMarker 'google' 'ok'
      $script:IntegrationWhy = 'segnato come non aggiunto; le librerie restano nel profilo e non occupano risorse'
      return 0
    }
    'telegram' {
      $code = Invoke-IntegrationComposeQuiet '--profile' 'telegram' stop $TelegramContainer
      if ($code -eq 0) { $code = Invoke-IntegrationComposeQuiet '--profile' 'telegram' rm '-f' $TelegramContainer }
      if ($code -ne 0) { $script:IntegrationWhy = 'il servizio Telegram non si ferma'; return 1 }
    }
    'media' {
      $code = Invoke-IntegrationComposeQuiet '--profile' 'media' stop $MediaContainer
      if ($code -eq 0) { $code = Invoke-IntegrationComposeQuiet '--profile' 'media' rm '-f' $MediaContainer }
      if ($code -ne 0) { $script:IntegrationWhy = 'il container dei media non si ferma'; return 1 }
      Clear-IntegrationMarker 'media' 'ok'
    }
    'linkedin-login' {
      if (-not (Remove-LinkedinContainers)) { $script:IntegrationWhy = "i container dell'accesso a LinkedIn non si fermano"; return 1 }
    }
    'screen' {
      $code = Invoke-IntegrationComposeQuiet '--profile' 'screen' stop $ScreenContainer
      if ($code -eq 0) { $code = Invoke-IntegrationComposeQuiet '--profile' 'screen' rm '-f' $ScreenContainer }
      if ($code -ne 0) { $script:IntegrationWhy = 'il container dello schermo non si ferma'; return 1 }
      Clear-IntegrationMarker 'screen' 'ok'
    }
    'mail' {
      if (-not (Test-IntegrationBrokerOnRequest)) { $script:IntegrationWhy = 'non disponibile ancora'; return 3 }
      $code = Invoke-IntegrationComposeQuiet '--profile' 'broker' stop $BrokerContainer
      if ($code -eq 0) { $code = Invoke-IntegrationComposeQuiet '--profile' 'broker' rm '-f' $BrokerContainer }
      if ($code -ne 0) { $script:IntegrationWhy = 'il broker della posta non si ferma'; return 1 }
      Remove-Item -LiteralPath $BrokerMadeMarker -Force -ErrorAction SilentlyContinue
    }
  }
  if ($Purge) {
    foreach ($volume in (Get-IntegrationVolumes $Id)) {
      if ((Test-IntegrationVolumePresent $volume) -eq $true) {
        $null = & { $ErrorActionPreference = 'Continue'; & docker volume rm "$(Get-ComposeProjectName)_$volume" 2>&1 }
        if ($LASTEXITCODE -ne 0) { $script:IntegrationWhy = "un volume non si cancella: $volume"; return 1 }
      }
    }
    $script:IntegrationWhy = 'container e dati cancellati'
    if ($Id -ceq 'linkedin-login') { $script:IntegrationWhy = 'container tolti; la sessione di LinkedIn nel profilo resta (jht reset --scope creds la toglie)' }
    if ($Id -ceq 'screen') { $script:IntegrationWhy = "container tolto; la cartella del display condivisa con jht e' stata cancellata" }
    if ($Id -ceq 'media') { $script:IntegrationWhy = 'container tolto; le due cartelle di scambio con jht restano (sono di jht e non contengono i tuoi file)' }
    if ($Id -ceq 'mail') { $script:IntegrationWhy = 'container e stato del broker cancellati; la password della posta e le credenziali dei portali restano nel volume dei segreti (jht reset --scope creds)' }
  } elseif ($Id -ceq 'screen') {
    $script:IntegrationWhy = 'schermo spento e container tolto'
  } elseif ($Id -ceq 'linkedin-login') {
    $script:IntegrationWhy = 'container tolti; la sessione di LinkedIn nel profilo resta (jht reset --scope creds la toglie)'
  } else {
    $script:IntegrationWhy = 'container tolto; i dati restano (per cancellarli: --purge --yes)'
  }
  if ($Id -ceq 'screen' -or $Id -ceq 'media') { return (Set-IntegrationExtrasAfterOff $Id $RemoveImage) }
  return 0
}

# add|remove, with the run marked as in progress and the outcome left for the next status.
function Invoke-IntegrationChange {
  param([string]$Action, [string]$Id, [bool]$Json, [bool]$Purge, [bool]$RemoveImage = $false)
  if ($IntegrationNotYet -ccontains $Id) { return (Write-IntegrationResult $Id $Json 3 'non disponibile ancora') }
  if (-not (Test-IntegrationDirReady)) { return (Write-IntegrationResult $Id $Json 1 'cartella dei marcatori non sicura') }
  if (-not (Write-IntegrationMarker $Id 'pending' ([string]$PID))) { return (Write-IntegrationResult $Id $Json 1 'marcatore non scritto') }
  Clear-IntegrationMarker $Id 'error'
  $code = 1
  try {
    # what the steps print (compose, Ensure-Up) must not become part of the code: the code is the LAST thing returned
    if ($Action -ceq 'add') { $done = @(Invoke-IntegrationAdd $Id) } else { $done = @(Invoke-IntegrationRemove $Id $Purge $RemoveImage) }
    $code = [int]$done[$done.Count - 1]
  } catch {
    $script:IntegrationWhy = Get-IntegrationForeign ([string]$_.Exception.Message)
    $code = 1
  } finally {
    Clear-IntegrationMarker $Id 'pending'
  }
  if ($code -ne 0 -and $code -ne 3) { $null = Write-IntegrationMarker $Id 'error' $script:IntegrationWhy }
  return (Write-IntegrationResult $Id $Json $code $script:IntegrationWhy)
}

# ---- Entry point ----
function Write-IntegrationUsage {
  Write-Err 'uso: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--remove-image] [--json]'
  Write-Err ('id: ' + ($IntegrationIds -join ' '))
  return 2
}

function Invoke-IntegrationCommand {
  param([string[]]$IntegrationArgs)
  $action = if ($IntegrationArgs.Count -gt 0) { [string]$IntegrationArgs[0] } else { '' }
  if (@('list', 'status', 'add', 'remove') -cnotcontains $action) { return (Write-IntegrationUsage) }
  $id = ''
  $json = $false; $purge = $false; $yes = $false; $removeImage = $false
  foreach ($arg in @($IntegrationArgs | Select-Object -Skip 1)) {
    switch -CaseSensitive ([string]$arg) {
      '--json' { $json = $true }
      '--purge' { if ($action -cne 'remove') { return (Write-IntegrationUsage) }; $purge = $true }
      '--yes' { if ($action -cne 'remove') { return (Write-IntegrationUsage) }; $yes = $true }
      '--remove-image' { if ($action -cne 'remove') { return (Write-IntegrationUsage) }; $removeImage = $true }
      default {
        if ([string]$arg -like '-*' -or $id) { return (Write-IntegrationUsage) }
        $id = [string]$arg
      }
    }
  }
  if ($action -ceq 'list' -and $id) { return (Write-IntegrationUsage) }
  if ($action -cne 'list' -and $action -cne 'status' -and -not $id) { return (Write-IntegrationUsage) }
  if ($id -and ($IntegrationIds -cnotcontains $id)) {
    Write-Err ('integrazione sconosciuta. id ammessi: ' + ($IntegrationIds -join ' '))
    return 2
  }
  if ($removeImage -and $id -cne 'screen' -and $id -cne 'media') { Write-Err "--remove-image vale per screen e media: sono i due che si fanno con l'immagine degli strumenti"; return 2 }
  if ($purge -and -not $yes) { Write-Err "--purge cancella i dati dell'integrazione: serve anche --yes"; return 2 }
  if ($yes -and -not $purge) { return (Write-IntegrationUsage) }
  switch -CaseSensitive ($action) {
    'list' { Write-IntegrationList $json; return 0 }
    'status' {
      if ($id) { Write-IntegrationStatus $id $json } else { Write-IntegrationList $json }
      return 0
    }
    default {
      if ($IntegrationNotYet -cnotcontains $id) { Require-Docker }
      return (Invoke-IntegrationChange $action $id $json $purge $removeImage)
    }
  }
}


# ---- `jht linkedin login|status` ----
# The manual sign-in to LinkedIn: three containers of the profile `login` (shared/login/). The line the desktop app reads is the one the view
# prints (login_view.py grant); here it is only checked in its exact shape, so nothing else ever reaches the app as a token.
$LoginServices = @('jht-login-proxy', 'jht-login-view', 'jht-login')
$LoginViewContainer = 'jht-login-view'
$LoginBrowserContainer = 'jht-login'
$LinkedinReasons = @('view_busy', 'view_unavailable', 'login_timeout', 'token_expired', 'chromium_sandbox_unavailable')
$LinkedinPollSeconds = 1

function Get-LinkedinProfileDir { return (Join-Path (Join-Path $JhtHome 'secrets') 'linkedin-profile') }

# Nothing, or a plain folder: never a link (a symbolic link, a junction: anything with a reparse point).
function Test-LinkedinPlain {
  param([string]$Path)
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $true }
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $item.LinkType) { return $false }
  return [bool]$item.PSIsContainer
}

# At every step under ~/.jht down to the profile: the folder is mounted writable in the browser container and the agents of the team
# container write under ~/.jht.
function Test-LinkedinProfileOk {
  foreach ($path in @($JhtHome, (Join-Path $JhtHome 'secrets'), (Get-LinkedinProfileDir))) {
    if (-not (Test-LinkedinPlain $path)) { return $false }
  }
  return $true
}

function New-LinkedinProfile {
  if (-not (Test-LinkedinProfileOk)) { return $false }
  try {
    foreach ($path in @($JhtHome, (Join-Path $JhtHome 'secrets'), (Get-LinkedinProfileDir))) {
      if (-not (Test-Path -LiteralPath $path)) { New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null }
    }
  } catch { return $false }
  return (Test-LinkedinProfileOk)
}

function Write-LinkedinFail {
  param([string]$Reason)
  [Console]::Out.WriteLine('{"ok": false, "reason": "' + $Reason + '"}')
}

function Test-LinkedinGrantLine {
  param([string]$Line)
  return ($Line -cmatch '^\{"ok": true, "port": 6081, "path": "/websockify", "token": "[A-Za-z0-9_-]{43}", "expires_at": "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", "session": "[0-9a-f]{1,32}"\}\z')
}

# The reason of a failure line of the view, from the closed list, or nothing.
function Get-LinkedinReasonOf {
  param([string]$Line)
  if ($Line -cmatch '^\{"ok": false, "reason": "([a-z_]+)"\}\z' -and ($LinkedinReasons -ccontains $Matches[1])) { return $Matches[1] }
  return ''
}

function Test-LinkedinAnyRunning {
  foreach ($service in $LoginServices) { if (Get-RunningComposeServiceId $service) { return $true } }
  return $false
}

function Remove-LinkedinContainers {
  $ok = $true
  foreach ($service in $LoginServices) {
    if ((Invoke-IntegrationComposeQuiet '--profile' 'login' stop $service) -ne 0) { $ok = $false }
    if ((Invoke-IntegrationComposeQuiet '--profile' 'login' rm '-f' $service) -ne 0) { $ok = $false }
  }
  return $ok
}

function Invoke-LinkedinLogin {
  $plainMessage = "il profilo di LinkedIn in ~/.jht non e' una cartella normale (un collegamento?): non lo uso"
  if (-not (Test-DockerReachable)) { [Console]::Error.WriteLine('il motore dei container non risponde'); Write-LinkedinFail 'view_unavailable'; return 1 }
  $ref = Get-IntegrationExtrasRef
  if (-not $ref) { [Console]::Error.WriteLine('non disponibile ancora'); Write-LinkedinFail 'view_unavailable'; return 1 }
  if (Test-LinkedinAnyRunning) { Write-LinkedinFail 'view_busy'; return 1 }
  $null = Remove-LinkedinContainers   # what an ended session left, stopped
  if (-not (New-LinkedinProfile)) { [Console]::Error.WriteLine($plainMessage); Write-LinkedinFail 'view_unavailable'; return 1 }
  & { $ErrorActionPreference = 'Continue'; & docker pull $ref *> $null }
  if ($LASTEXITCODE -ne 0) { [Console]::Error.WriteLine("download dell'immagine degli strumenti non riuscito"); Write-LinkedinFail 'view_unavailable'; return 1 }
  # Checked again right before the up (the pull took time): what is left is the instant between this test and the mount of the engine.
  if (-not ((Test-LinkedinProfileOk) -and (Test-Path -LiteralPath (Get-LinkedinProfileDir) -PathType Container))) {
    [Console]::Error.WriteLine($plainMessage); Write-LinkedinFail 'view_unavailable'; return 1
  }
  $before = $env:JHT_EXTRAS_IMAGE
  try {
    $env:JHT_EXTRAS_IMAGE = $ref
    Invoke-Compose '--profile' 'login' up '-d' @LoginServices | Out-Null
    $code = $LASTEXITCODE
  } finally { if ($null -eq $before) { Remove-Item Env:\JHT_EXTRAS_IMAGE -ErrorAction SilentlyContinue } else { $env:JHT_EXTRAS_IMAGE = $before } }
  if ($code -ne 0) { $null = Remove-LinkedinContainers; Write-LinkedinFail 'view_unavailable'; return 1 }
  for ($tries = 1; $tries -le 40; $tries++) {
    $id = Get-RunningComposeServiceId $LoginViewContainer
    $line = ''
    if ($id) {
      $out = @(& { $ErrorActionPreference = 'Continue'; & docker exec $id python3 /app/shared/login/login_view.py grant 2>$null })
      if ($out.Count) { $line = [string]$out[$out.Count - 1] }
    }
    if (Test-LinkedinGrantLine $line) { [Console]::Out.WriteLine($line); return 0 }
    $reason = Get-LinkedinReasonOf $line
    if ($reason -and $reason -cne 'view_unavailable') { $null = Remove-LinkedinContainers; Write-LinkedinFail $reason; return 1 }
    # the browser is not ready yet (the token is not used up): ask again, unless the containers are gone
    if ($tries -gt 3 -and -not (Test-LinkedinAnyRunning)) { break }
    if ($LinkedinPollSeconds -gt 0) { Start-Sleep -Seconds $LinkedinPollSeconds }
  }
  $null = Remove-LinkedinContainers
  Write-LinkedinFail 'view_unavailable'
  return 1
}

function Invoke-LinkedinStop {
  if (-not (Remove-LinkedinContainers)) { Write-LinkedinFail 'view_unavailable'; return 1 }
  [Console]::Out.WriteLine('{"ok": true}')
  return 0
}

# How the last session ended, from the exit code the engine keeps of the stopped view.
function Get-LinkedinLastReason {
  $code = @(& { $ErrorActionPreference = 'Continue'; & docker inspect -f '{{.State.ExitCode}}' $LoginViewContainer 2>$null })
  if ($LASTEXITCODE -ne 0 -or -not $code.Count) { return '' }
  switch -CaseSensitive (([string]$code[0]).Trim()) {
    '10' { return 'logged_in' }
    '11' { return 'login_timeout' }
    '12' { return 'token_expired' }
    '13' { return 'stopped' }
  }
  return ''
}

function Invoke-LinkedinStatus {
  if (-not (Test-DockerReachable)) { Write-LinkedinFail 'view_unavailable'; return 1 }
  $view = 'idle'; $last = ''; $linkedin = 'login_required'
  $id = Get-RunningComposeServiceId $LoginViewContainer
  if ($id) {
    $out = @(& { $ErrorActionPreference = 'Continue'; & docker exec $id python3 /app/shared/login/login_view.py status 2>$null })
    $text = if ($out.Count) { [string]$out[$out.Count - 1] } else { '' }
    if ($text -clike '*"view": "waiting"*') { $view = 'waiting' } elseif ($text -clike '*"view": "connected"*') { $view = 'connected' }
  } else {
    $last = Get-LinkedinLastReason
  }
  $ref = Get-IntegrationExtrasRef
  $profile = Get-LinkedinProfileDir
  if ($ref -and (Test-LinkedinProfileOk) -and (Test-Path -LiteralPath $profile -PathType Container)) {
    & { $ErrorActionPreference = 'Continue'; & docker image inspect $ref *> $null }
    if ($LASTEXITCODE -eq 0) {
      $before = $env:JHT_EXTRAS_IMAGE
      try {
        $env:JHT_EXTRAS_IMAGE = $ref
        $answer = @(Invoke-Compose '--profile' 'login' run '--rm' '--no-deps' '-T' '--entrypoint' 'python3' $LoginBrowserContainer '/app/shared/login/login_session.py' 'check' '/linkedin-profile')
      } finally { if ($null -eq $before) { Remove-Item Env:\JHT_EXTRAS_IMAGE -ErrorAction SilentlyContinue } else { $env:JHT_EXTRAS_IMAGE = $before } }
      if ($answer.Count -and ([string]$answer[$answer.Count - 1]).Trim() -ceq 'logged_in') { $linkedin = 'logged_in' }
    }
  }
  if ($last) {
    [Console]::Out.WriteLine(('{{"ok": true, "view": "{0}", "linkedin": "{1}", "last_session": {{"reason": "{2}"}}}}' -f $view, $linkedin, $last))
  } else {
    [Console]::Out.WriteLine(('{{"ok": true, "view": "{0}", "linkedin": "{1}"}}' -f $view, $linkedin))
  }
  return 0
}

function Invoke-LinkedinCommand {
  param([string[]]$LinkedinArgs)
  $joined = (@($LinkedinArgs) -join ' ')
  if ($joined -ceq 'login') { Require-Docker; return (Invoke-LinkedinLogin) }
  if ($joined -ceq 'login --stop') { Require-Docker; return (Invoke-LinkedinStop) }
  if ($joined -ceq 'status --json') { return (Invoke-LinkedinStatus) }
  Write-Err 'uso: jht linkedin login [--stop] | status --json'
  return 2
}

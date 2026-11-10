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
$IntegrationNotYet = @('linkedin-login', 'screen', 'media')
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

# ---- add ----
function Invoke-IntegrationAdd {
  param([string]$Id)
  $script:IntegrationWhy = ''
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
    'mail' {
      Invoke-Compose '--profile' 'broker' up '-d' $BrokerContainer | Out-Null
      if ($LASTEXITCODE -ne 0) { $script:IntegrationWhy = 'il broker della posta non parte'; return 1 }
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
  }
  return @()
}

# The broker is part of `jht up` until it is made on request: removing it now would only be undone by the next start.
function Test-IntegrationBrokerOnRequest {
  $inService = $false
  foreach ($line in @(Get-Content -LiteralPath $ComposeFile)) {
    if ($line -ceq "  ${BrokerContainer}:") { $inService = $true; continue }
    if ($inService -and $line -match '^  \S') { return $false }
    if ($inService -and $line -match '^    profiles:') { return $true }
  }
  return $false
}

function Invoke-IntegrationRemove {
  param([string]$Id, [bool]$Purge)
  $script:IntegrationWhy = ''
  switch -CaseSensitive ($Id) {
    'google' {
      Clear-IntegrationMarker 'google' 'ok'
      $script:IntegrationWhy = 'segnato come non aggiunto; le librerie restano nel profilo e non occupano risorse'
      return 0
    }
    'telegram' {
      Invoke-Compose '--profile' 'telegram' stop $TelegramContainer | Out-Null
      $code = $LASTEXITCODE
      if ($code -eq 0) { Invoke-Compose '--profile' 'telegram' rm '-f' $TelegramContainer | Out-Null; $code = $LASTEXITCODE }
      if ($code -ne 0) { $script:IntegrationWhy = 'il servizio Telegram non si ferma'; return 1 }
    }
    'mail' {
      if (-not (Test-IntegrationBrokerOnRequest)) { $script:IntegrationWhy = 'non disponibile ancora'; return 3 }
      Invoke-Compose '--profile' 'broker' stop $BrokerContainer | Out-Null
      $code = $LASTEXITCODE
      if ($code -eq 0) { Invoke-Compose '--profile' 'broker' rm '-f' $BrokerContainer | Out-Null; $code = $LASTEXITCODE }
      if ($code -ne 0) { $script:IntegrationWhy = 'il broker della posta non si ferma'; return 1 }
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
    if ($Id -ceq 'mail') { $script:IntegrationWhy = 'container e stato del broker cancellati; la password della posta e le credenziali dei portali restano nel volume dei segreti (jht reset --scope creds)' }
  } else {
    $script:IntegrationWhy = 'container tolto; i dati restano (per cancellarli: --purge --yes)'
  }
  return 0
}

# add|remove, with the run marked as in progress and the outcome left for the next status.
function Invoke-IntegrationChange {
  param([string]$Action, [string]$Id, [bool]$Json, [bool]$Purge)
  if ($IntegrationNotYet -ccontains $Id) { return (Write-IntegrationResult $Id $Json 3 'non disponibile ancora') }
  if (-not (Test-IntegrationDirReady)) { return (Write-IntegrationResult $Id $Json 1 'cartella dei marcatori non sicura') }
  if (-not (Write-IntegrationMarker $Id 'pending' ([string]$PID))) { return (Write-IntegrationResult $Id $Json 1 'marcatore non scritto') }
  Clear-IntegrationMarker $Id 'error'
  $code = 1
  try {
    # what the steps print (compose, Ensure-Up) must not become part of the code: the code is the LAST thing returned
    if ($Action -ceq 'add') { $done = @(Invoke-IntegrationAdd $Id) } else { $done = @(Invoke-IntegrationRemove $Id $Purge) }
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
  Write-Err 'uso: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--json]'
  Write-Err ('id: ' + ($IntegrationIds -join ' '))
  return 2
}

function Invoke-IntegrationCommand {
  param([string[]]$IntegrationArgs)
  $action = if ($IntegrationArgs.Count -gt 0) { [string]$IntegrationArgs[0] } else { '' }
  if (@('list', 'status', 'add', 'remove') -cnotcontains $action) { return (Write-IntegrationUsage) }
  $id = ''
  $json = $false; $purge = $false; $yes = $false
  foreach ($arg in @($IntegrationArgs | Select-Object -Skip 1)) {
    switch -CaseSensitive ([string]$arg) {
      '--json' { $json = $true }
      '--purge' { if ($action -cne 'remove') { return (Write-IntegrationUsage) }; $purge = $true }
      '--yes' { if ($action -cne 'remove') { return (Write-IntegrationUsage) }; $yes = $true }
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
      return (Invoke-IntegrationChange $action $id $json $purge)
    }
  }
}

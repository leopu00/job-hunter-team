# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  jht — host-side dispatcher (PowerShell port di jht-wrapper.sh)          ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Wrapper PowerShell sottile che instrada i comandi:                      ║
# ║                                                                          ║
# ║    LIFECYCLE   → docker compose / docker logs / docker inspect           ║
# ║    OPERATIVITA → docker exec -it jht node /app/cli/bin/jht.js <args>     ║
# ║                                                                          ║
# ║  Niente Node, Python o tmux sull'host. Niente socket Docker dentro al    ║
# ║  container. Il CLI Node gira nel container long-running `jht` e ci       ║
# ║  parla via `docker exec`.                                                ║
# ║                                                                          ║
# ║  Auto-up: se il container `jht` non e' attivo quando l'utente lancia un  ║
# ║  comando di operativita', lo si avvia automaticamente via compose.       ║
# ║                                                                          ║
# ║  Override via env:                                                       ║
# ║    JHT_CONTAINER_NAME=jht                                                ║
# ║    JHT_RUNTIME_DIR=$env:USERPROFILE\.jht\runtime                         ║
# ║    JHT_COMPOSE_FILE=$JHT_RUNTIME_DIR\docker-compose.yml                  ║
# ║                                                                          ║
# ║  Differenze vs jht-wrapper.sh (per design Windows-native):               ║
# ║    - NO ensure_bind_owner: Docker Desktop su Windows gestisce volume     ║
# ║      permissions via Hyper-V/WSL2 namespace, non c'e' chown da fare.     ║
# ║    - NO host-setup.sh invocation: swap config e' Linux-only, lang/tz     ║
# ║      picker resta gestito dal wizard Node dentro al container.           ║
# ║                                                                          ║
# ║  Riferimento design: docs/internal/ops/vps.md                                ║
# ╚══════════════════════════════════════════════════════════════════════════╝

$ErrorActionPreference = 'Stop'

# Capacita' letta dal client desktop prima di invocare `upgrade --check --json`.
# I wrapper storici non la espongono e richiedono il bootstrap temporaneo del
# wrapper production con WrapperPath ancorato al comando host originale.
$JHT_UPGRADE_PROTOCOL = 1

$Container   = if ($env:JHT_CONTAINER_NAME) { $env:JHT_CONTAINER_NAME } else { 'jht' }
$RuntimeDir  = if ($env:JHT_RUNTIME_DIR)    { $env:JHT_RUNTIME_DIR }    else { Join-Path $env:USERPROFILE '.jht\runtime' }
$ComposeFile = if ($env:JHT_COMPOSE_FILE)   { $env:JHT_COMPOSE_FILE }   else { Join-Path $RuntimeDir 'docker-compose.yml' }
$NodeEntry   = if ($env:JHT_NODE_ENTRY)     { $env:JHT_NODE_ENTRY }     else { '/app/cli/bin/jht.js' }
$RawBase     = if ($env:JHT_RAW_BASE)       { $env:JHT_RAW_BASE.TrimEnd('/') } else { 'https://raw.githubusercontent.com/leopu00/job-hunter-team/production' }
$WrapperPath = if ($env:JHT_WRAPPER_PATH)   { $env:JHT_WRAPPER_PATH }   else { $PSCommandPath }

# Carica la host env (scritta da install.ps1 / setup wizard: JHT_HOST_TYPE=local|vps).
# Formato file: VAR=value per riga, ignora # e righe vuote.
$HostEnvFile = if ($env:JHT_HOST_ENV_FILE) { $env:JHT_HOST_ENV_FILE } else { Join-Path $env:USERPROFILE '.jht\host.env' }
if (Test-Path $HostEnvFile) {
  Get-Content $HostEnvFile | ForEach-Object {
    if ($_ -match '^\s*#') { return }
    if ($_ -match '^\s*$') { return }
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)=(.*)$') {
      $name  = $Matches[1]
      $value = $Matches[2].Trim('"').Trim("'")
      Set-Item -Path "env:$name" -Value $value -ErrorAction SilentlyContinue
    }
  }
}
if (-not $env:JHT_HOST_TYPE) { $env:JHT_HOST_TYPE = 'unknown' }
if (-not $env:JHT_LANG)      { $env:JHT_LANG = 'en' }
if (-not $env:JHT_USER_TZ)   { $env:JHT_USER_TZ = 'UTC' }

# Colori (PowerShell gestisce ANSI nativo dal terminale moderno).
function Write-Err  { param([string]$Msg) Write-Host "error: $Msg" -ForegroundColor Red }
function Write-Warn { param([string]$Msg) Write-Host "warn:  $Msg" -ForegroundColor Yellow }
function Write-Info { param([string]$Msg) Write-Host $Msg -ForegroundColor DarkGray }

# ── Verifiche pre-flight ──────────────────────────────────────────────────
function Require-Docker {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Err "docker non trovato nel PATH. Installa Docker Desktop per Windows."
    exit 127
  }
  $null = docker info 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Err "Docker daemon non risponde. Avvia Docker Desktop."
    exit 1
  }
}

function Require-ComposeFile {
  if (-not (Test-Path $ComposeFile)) {
    Write-Err "compose file non trovato: $ComposeFile"
    Write-Info "Esegui di nuovo install.ps1 oppure scarica manualmente:"
    Write-Info "  New-Item -ItemType Directory -Force '$RuntimeDir' | Out-Null"
    Write-Info "  iwr -useb https://raw.githubusercontent.com/leopu00/job-hunter-team/production/docker-compose.yml -OutFile '$ComposeFile'"
    exit 1
  }
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments)] $Args)
  # Docker Desktop Windows accetta forward-slash o backslash. project-directory
  # punta al runtime dir per bind-mount relativi (anche se compose qui e'
  # image-only, lasciamo per simmetria col bash wrapper).
  & docker compose -f $ComposeFile --project-directory $RuntimeDir @Args
}

function Test-ContainerUp {
  $running = & docker ps --format '{{.Names}}' 2>$null
  return ($running -split "`n") -contains $Container
}

function Ensure-Up {
  if (-not (Test-ContainerUp)) {
    Write-Info "Container '$Container' non attivo, lo avvio..."
    Invoke-Compose up -d
    # Attendi che il container sia in stato running.
    $tries = 20
    while (-not (Test-ContainerUp)) {
      $tries -= 1
      if ($tries -le 0) {
        Write-Err "Container '$Container' non e' partito entro 10s. Controlla 'jht logs'."
        exit 1
      }
      Start-Sleep -Milliseconds 500
    }
  }
}

# ── Upgrade runtime, transazionale e host-side ────────────────────────────
# L'installazione utente e' image-only. Git/NPM nel container non puo'
# aggiornare il prodotto e lascerebbe meta' deploy; il wrapper host prepara il
# candidato, conserva l'ultima immagine buona in un journal e fa rollback se
# il nuovo container non riesce a eseguire il suo CLI.
$script:UpgradeJson = $false
$script:UpgradeStage = ''
$script:UpgradeLock = ''
$script:UpgradeJournal = ''
$script:UpgradeRollbackDir = ''

function ConvertTo-UpgradeField {
  param([object]$Value)
  return ([regex]::Replace([string]$Value, '[^A-Za-z0-9._,:+@/\-]', '')).Substring(0, [Math]::Min(220, ([regex]::Replace([string]$Value, '[^A-Za-z0-9._,:+@/\-]', '')).Length))
}

function Write-UpgradeResult {
  param(
    [bool]$Ok, [bool]$Changed, [string]$Phase,
    [string]$PreviousVersion, [string]$PreviousImage,
    [string]$CurrentVersion, [string]$CurrentImage,
    [bool]$RestartRequired, [string]$Message, [bool]$RolledBack
  )
  $result = [ordered]@{
    ok = $Ok; changed = $Changed; phase = $Phase
    previous = [ordered]@{ version = ConvertTo-UpgradeField $PreviousVersion; image = ConvertTo-UpgradeField $PreviousImage }
    current = [ordered]@{ version = ConvertTo-UpgradeField $CurrentVersion; image = ConvertTo-UpgradeField $CurrentImage }
    restartRequired = $RestartRequired; message = $Message; rolledBack = $RolledBack
  }
  if ($script:UpgradeJson) {
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress -Depth 4))
  } elseif ($Ok) {
    Write-Host "Aggiornamento completato: $PreviousVersion ($PreviousImage) -> $CurrentVersion ($CurrentImage). $Message" -ForegroundColor Green
  } else {
    Write-Err "Aggiornamento non completato ($Phase): $Message"
    if ($RolledBack) { Write-Info 'Runtime precedente ripristinato.' }
  }
}

function Write-UpgradeNote { param([string]$Message) if (-not $script:UpgradeJson) { Write-Info $Message } }

function Invoke-UpgradeCompose {
  param([string]$File, [Parameter(ValueFromRemainingArguments)] [string[]]$ComposeArgs)
  $all = @('compose', '-f', $File, '--project-directory', $RuntimeDir) + $ComposeArgs
  if ($script:UpgradeJson) { & docker @all *> $null } else { & docker @all }
  return $LASTEXITCODE -eq 0
}

function Test-UpgradeDockerReady {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  & docker info *> $null
  return $LASTEXITCODE -eq 0
}

function Get-UpgradeImage {
  $value = (& docker inspect $Container --format '{{.Image}}' 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0) { return '' }
  return ([string]$value).Trim()
}

function Get-UpgradeVersion {
  $value = (& docker exec $Container node $NodeEntry --version 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0) { return '' }
  return ([string]$value).Trim()
}

function Test-UpgradeRunning {
  for ($i = 0; $i -lt 20; $i++) {
    if ((Test-ContainerUp) -and (Get-UpgradeVersion)) {
      Start-Sleep -Seconds 1
      if ((Test-ContainerUp) -and (Get-UpgradeVersion)) { return $true }
    }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Replace-UpgradeFile {
  param([string]$Source, [string]$Target, [bool]$Executable = $false)
  $parent = Split-Path -Parent $Target
  $temp = Join-Path $parent ('.' + (Split-Path -Leaf $Target) + '.upgrade.' + [guid]::NewGuid().ToString('N'))
  try {
    [IO.File]::Copy($Source, $temp, $true)
    if (Test-Path $Target) { [IO.File]::Replace($temp, $Target, $null) } else { [IO.File]::Move($temp, $Target) }
    return $true
  } catch {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    return $false
  }
}

function Write-UpgradeJournal {
  param([string]$Phase, [string]$OldImage, [bool]$WasRunning)
  $value = [ordered]@{ version = 1; phase = $Phase; rollback_dir = $script:UpgradeRollbackDir; old_image = $OldImage; was_running = $WasRunning }
  $temp = "$script:UpgradeJournal.tmp.$PID"
  try {
    [IO.File]::WriteAllText($temp, ($value | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
    if (Test-Path $script:UpgradeJournal) { [IO.File]::Replace($temp, $script:UpgradeJournal, $null) } else { [IO.File]::Move($temp, $script:UpgradeJournal) }
    return $true
  } catch {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
    return $false
  }
}

function Remove-UpgradeTransaction {
  Remove-Item -LiteralPath $script:UpgradeJournal -Force -ErrorAction SilentlyContinue
  if ($script:UpgradeRollbackDir -and (Test-Path $script:UpgradeRollbackDir)) {
    Remove-Item -LiteralPath (Join-Path $script:UpgradeRollbackDir 'docker-compose.yml') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $script:UpgradeRollbackDir 'jht-wrapper.ps1') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $script:UpgradeRollbackDir -Force -ErrorAction SilentlyContinue
  }
}

function Restore-UpgradePrevious {
  if (-not (Test-Path $script:UpgradeJournal)) { return $false }
  try { $journal = Get-Content -LiteralPath $script:UpgradeJournal -Raw | ConvertFrom-Json } catch { return $false }
  if ([string]$journal.version -ne '1') { return $false }
  if ([string]$journal.phase -notin @('prepared', 'pulled', 'candidate_started', 'metadata_committed')) { return $false }
  if ($journal.was_running -isnot [bool]) { return $false }
  $rollback = [string]$journal.rollback_dir
  try {
    $runtimeRoot = ([IO.Path]::GetFullPath($RuntimeDir)).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $fullRollback = if ($rollback) { [IO.Path]::GetFullPath($rollback) } else { '' }
    $rollbackInfo = Get-Item -LiteralPath $fullRollback -Force -ErrorAction Stop
  } catch { return $false }
  # Il journal non puo' scegliere una directory arbitraria: accettiamo solo
  # una directory reale creata direttamente sotto il runtime. `GetFullPath`
  # rende innocuo anche un prefisso seguito da ../, mentre il rifiuto dei link
  # evita che un journal corrotto porti fuori dal runtime fisico.
  if (-not $rollbackInfo.PSIsContainer -or $rollbackInfo.LinkType) { return $false }
  $rollbackParent = ([IO.Path]::GetFullPath((Split-Path -LiteralPath $fullRollback -Parent))).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $rollbackLeaf = Split-Path -LiteralPath $fullRollback -Leaf
  if ($rollbackParent -ne $runtimeRoot -or $rollbackLeaf -notmatch '^\.upgrade-rollback-[A-Za-z0-9_-]+$') { return $false }
  try {
    $composeSnapshot = Get-Item -LiteralPath (Join-Path $fullRollback 'docker-compose.yml') -Force -ErrorAction Stop
    $wrapperSnapshot = Get-Item -LiteralPath (Join-Path $fullRollback 'jht-wrapper.ps1') -Force -ErrorAction Stop
  } catch { return $false }
  if ($composeSnapshot.PSIsContainer -or $wrapperSnapshot.PSIsContainer -or $composeSnapshot.LinkType -or $wrapperSnapshot.LinkType) { return $false }
  if ([bool]$journal.was_running) {
    if ([string]$journal.old_image -notmatch '^sha256:[A-Za-z0-9]+$') { return $false }
    # Verifica l'immagine immutabile prima della prima sostituzione metadata:
    # un digest solo formalmente valido non deve lasciare compose/wrapper in
    # uno stato diverso se il rollback non puo' ricreare il container.
    & docker image inspect ([string]$journal.old_image) *> $null
    if ($LASTEXITCODE -ne 0) { return $false }
  } elseif ([string]$journal.old_image -ne 'none') { return $false }
  if (-not (Replace-UpgradeFile $composeSnapshot.FullName $ComposeFile)) { return $false }
  if (-not (Replace-UpgradeFile $wrapperSnapshot.FullName $WrapperPath)) { return $false }
  if ([bool]$journal.was_running) {
    $before = $env:JHT_IMAGE
    $env:JHT_IMAGE = [string]$journal.old_image
    $ok = Invoke-UpgradeCompose $ComposeFile 'up' '-d' '--force-recreate' $Container
    $env:JHT_IMAGE = $before
    if (-not $ok -or -not (Test-UpgradeRunning)) { return $false }
  } else {
    if (-not (Invoke-UpgradeCompose $ComposeFile 'rm' '-s' '-f' $Container)) { return $false }
  }
  $script:UpgradeRollbackDir = $fullRollback
  Remove-UpgradeTransaction
  return $true
}

function Enter-UpgradeLock {
  $script:UpgradeLock = Join-Path $RuntimeDir '.upgrade.lock'
  try {
    New-Item -ItemType Directory -Path $script:UpgradeLock -ErrorAction Stop | Out-Null
    Set-Content -LiteralPath (Join-Path $script:UpgradeLock 'pid') -Value $PID -NoNewline
    return $true
  } catch {
    $pidFile = Join-Path $script:UpgradeLock 'pid'
    $holder = if (Test-Path $pidFile) { Get-Content -LiteralPath $pidFile -Raw } else { '' }
    if ($holder -and (Get-Process -Id ([int]$holder) -ErrorAction SilentlyContinue)) { return $false }
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $script:UpgradeLock -Force -ErrorAction SilentlyContinue
    try {
      New-Item -ItemType Directory -Path $script:UpgradeLock -ErrorAction Stop | Out-Null
      Set-Content -LiteralPath (Join-Path $script:UpgradeLock 'pid') -Value $PID -NoNewline
      return $true
    } catch { return $false }
  }
}

function Clear-UpgradeEphemeral {
  if ($script:UpgradeStage -and (Test-Path $script:UpgradeStage)) { Remove-Item -LiteralPath $script:UpgradeStage -Recurse -Force -ErrorAction SilentlyContinue }
  if ($script:UpgradeLock -and (Test-Path $script:UpgradeLock)) {
    Remove-Item -LiteralPath (Join-Path $script:UpgradeLock 'pid') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $script:UpgradeLock -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-RuntimeUpgrade {
  param([string[]]$UpgradeArgs)
  $checkOnly = $false
  foreach ($arg in $UpgradeArgs) {
    if ($arg -eq '--json') { $script:UpgradeJson = $true }
    elseif ($arg -eq '--check') { $checkOnly = $true }
    elseif ($arg -ne '--apply') { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false 'Opzione upgrade non supportata' $false; return 2 }
  }
  if (-not (Enter-UpgradeLock)) { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false 'Un aggiornamento e gia in corso' $false; return 1 }
  $script:UpgradeJournal = Join-Path $RuntimeDir '.upgrade-journal'
  try {
    if (-not (Test-UpgradeDockerReady) -or -not (Test-Path $ComposeFile) -or -not (Test-Path $WrapperPath)) { Write-UpgradeResult $false $false 'preflight' 'unknown' 'none' 'unknown' 'none' $false 'Docker o runtime host non disponibile' $false; return 1 }
    if ((Test-Path $script:UpgradeJournal) -and -not (Restore-UpgradePrevious)) { Write-UpgradeResult $false $false 'recovery' 'unknown' 'none' 'unknown' 'none' $false 'Recovery dell upgrade precedente non riuscita' $false; return 1 }
    $wasRunning = Test-ContainerUp
    $oldImage = if ($wasRunning) { Get-UpgradeImage } else { 'none' }
    $oldVersion = if ($wasRunning) { Get-UpgradeVersion } else { 'non-installata' }
    if (-not $oldImage) { $oldImage = 'none' }; if (-not $oldVersion) { $oldVersion = 'sconosciuta' }
    $script:UpgradeStage = Join-Path $RuntimeDir ('.upgrade-stage-' + $PID + '-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $script:UpgradeStage -ErrorAction Stop | Out-Null
    $newCompose = Join-Path $script:UpgradeStage 'docker-compose.yml'; $newWrapper = Join-Path $script:UpgradeStage 'jht-wrapper.ps1'
    Write-UpgradeNote 'Scarico runtime aggiornato...'
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$RawBase/docker-compose.yml" -OutFile $newCompose
      Invoke-WebRequest -UseBasicParsing -Uri "$RawBase/scripts/jht-wrapper.ps1" -OutFile $newWrapper
      [scriptblock]::Create((Get-Content -LiteralPath $newWrapper -Raw)) | Out-Null
    } catch { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false 'Runtime remoto non valido o non raggiungibile' $false; return 1 }
    if (-not (Invoke-UpgradeCompose $newCompose 'config' '-q')) { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false 'Compose remoto non valido' $false; return 1 }
    $metadataChanged = -not ((Get-FileHash $newCompose).Hash -eq (Get-FileHash $ComposeFile).Hash) -or -not ((Get-FileHash $newWrapper).Hash -eq (Get-FileHash $WrapperPath).Hash)
    $script:UpgradeRollbackDir = Join-Path $RuntimeDir ('.upgrade-rollback-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + '-' + $PID)
    New-Item -ItemType Directory -Path $script:UpgradeRollbackDir -ErrorAction Stop | Out-Null
    Copy-Item -LiteralPath $ComposeFile -Destination (Join-Path $script:UpgradeRollbackDir 'docker-compose.yml')
    Copy-Item -LiteralPath $WrapperPath -Destination (Join-Path $script:UpgradeRollbackDir 'jht-wrapper.ps1')
    if (-not (Write-UpgradeJournal 'prepared' $oldImage $wasRunning)) { Write-UpgradeResult $false $false 'preflight' $oldVersion $oldImage $oldVersion $oldImage $false 'Impossibile preparare il rollback' $false; return 1 }
    Write-UpgradeNote 'Scarico l immagine piu recente...'
    if (-not (Invoke-UpgradeCompose $newCompose 'pull' $Container)) { Remove-UpgradeTransaction; Write-UpgradeResult $false $false 'pull' $oldVersion $oldImage $oldVersion $oldImage $false 'Download immagine non riuscito' $false; return 1 }
    $candidateRef = ((& docker compose -f $newCompose --project-directory $RuntimeDir config --images 2>$null | Select-Object -First 1) -as [string]).Trim()
    if (-not $candidateRef) { $candidateRef = if ($env:JHT_IMAGE) { $env:JHT_IMAGE } else { 'ghcr.io/leopu00/jht:0.3.5' } }
    $candidateImage = ((& docker image inspect $candidateRef --format '{{.Id}}' 2>$null | Select-Object -First 1) -as [string]).Trim()
    if (-not $candidateImage) { $candidateImage = 'sconosciuta' }
    if (-not (Write-UpgradeJournal 'pulled' $oldImage $wasRunning)) { Write-UpgradeResult $false $false 'pull' $oldVersion $oldImage $oldVersion $oldImage $false 'Impossibile aggiornare il journal' $false; return 1 }
    if ($checkOnly) { Remove-UpgradeTransaction; $changed = ($candidateImage -ne $oldImage) -or $metadataChanged; Write-UpgradeResult $true $changed 'check' $oldVersion $oldImage $oldVersion $candidateImage $changed 'Controllo completato; nessuna modifica al runtime' $false; return 0 }
    Write-UpgradeNote 'Attivo il nuovo runtime...'
    if (-not (Invoke-UpgradeCompose $newCompose 'up' '-d' '--force-recreate' $Container) -or -not (Write-UpgradeJournal 'candidate_started' $oldImage $wasRunning) -or -not (Test-UpgradeRunning)) {
      $rolledBack = Restore-UpgradePrevious; Write-UpgradeResult $false $false 'verify' $oldVersion $oldImage $oldVersion $oldImage $false 'Il nuovo runtime non ha superato la verifica' $rolledBack; return 1
    }
    $newVersion = Get-UpgradeVersion; if (-not $newVersion) { $newVersion = 'sconosciuta' }
    if (-not (Replace-UpgradeFile $newCompose $ComposeFile) -or -not (Replace-UpgradeFile $newWrapper $WrapperPath) -or -not (Write-UpgradeJournal 'metadata_committed' $oldImage $wasRunning)) {
      $rolledBack = Restore-UpgradePrevious; Write-UpgradeResult $false $false 'commit' $oldVersion $oldImage $oldVersion $oldImage $false 'Metadata runtime non persistiti' $rolledBack; return 1
    }
    Remove-UpgradeTransaction
    $changed = ($candidateImage -ne $oldImage) -or $metadataChanged
    Write-UpgradeResult $true $changed 'complete' $oldVersion $oldImage $newVersion $candidateImage $false 'Nuova versione attiva e verificata' $false
    return 0
  } catch {
    if (Test-Path $script:UpgradeJournal) {
      $rolledBack = Restore-UpgradePrevious
    } else {
      Remove-UpgradeTransaction
      $rolledBack = $false
    }
    Write-UpgradeResult $false $false 'unexpected' 'unknown' 'none' 'unknown' 'none' $false 'Errore inatteso durante l aggiornamento' $rolledBack
    return 1
  } finally { Clear-UpgradeEphemeral }
}

# Decide se passare -it a docker exec: serve solo se stdin/stdout sono terminali.
# Su Windows pwsh, [Console]::IsInputRedirected restituisce true quando lo
# script gira sotto pipe / redirect — in quel caso usiamo -i (no TTY).
if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) {
  $ExecFlags = @('-i')
} else {
  $ExecFlags = @('-it')
}

# ── Dispatcher ────────────────────────────────────────────────────────────
$Sub = if ($args.Count -ge 1) { $args[0] } else { '' }
# BUG FIX 2026-05-22: `$args[1..1]` collapses to a scalar string (PowerShell
# unwraps single-element arrays). When that scalar is splatted via @Rest,
# docker exec iterates char-by-char and the inner CLI sees `cloud l o g i n`
# instead of `cloud login`. Forziamo array via @() per garantire splat
# corretto anche con 1 solo arg di coda.
$Rest = if ($args.Count -gt 1) { @($args[1..($args.Count - 1)]) } else { @() }

switch ($Sub) {
  { $_ -in @('up', 'start-container') } {
    Require-Docker
    Require-ComposeFile
    Invoke-Compose up -d
    break
  }

  { $_ -in @('down', 'stop-container') } {
    Require-Docker
    Require-ComposeFile
    Invoke-Compose down
    break
  }

  'restart' {
    Require-Docker
    Require-ComposeFile
    Invoke-Compose restart $Container
    break
  }

  'recreate' {
    Require-Docker
    Require-ComposeFile
    Invoke-Compose down
    Invoke-Compose up -d
    break
  }

  'upgrade' {
    $code = Invoke-RuntimeUpgrade $Rest
    exit $code
  }

  'logs' {
    Require-Docker
    & docker logs @Rest $Container
    break
  }

  'status' {
    Require-Docker
    if (Test-ContainerUp) {
      & docker inspect $Container --format 'name={{.Name}} status={{.State.Status}} started={{.State.StartedAt}} image={{.Config.Image}}'
    } else {
      Write-Host "container '$Container' non attivo"
      exit 1
    }
    break
  }

  'shell' {
    Require-Docker
    Ensure-Up
    & docker exec @ExecFlags $Container bash
    break
  }

  # OAuth login: legge il provider attivo e avvia il suo flusso reale.
  { $_ -in @('oauth-login', 'claude-login') } {
    Require-Docker
    Require-ComposeFile
    Ensure-Up
    $Provider = (& docker exec $Container node -e "try{const c=require('/jht_home/jht.config.json');process.stdout.write(String(c.active_provider||''))}catch{}" 2>$null)
    switch (($Provider | Out-String).Trim().ToLowerInvariant()) {
      { $_ -in @('openai', 'codex') } { & docker exec @ExecFlags $Container codex login --device-auth; break }
      { $_ -in @('kimi', 'moonshot') } { & docker exec @ExecFlags $Container kimi --yolo; break }
      { $_ -in @('', 'claude', 'anthropic') } { & docker exec @ExecFlags $Container claude --dangerously-skip-permissions; break }
      default { throw "provider attivo non riconosciuto: $Provider" }
    }
    break
  }

  # Setup: skip host-setup (non esiste su Windows), delega tutto al wizard
  # Node nel container che leggera' JHT_HOST_TYPE dall'env passato.
  'setup' {
    Require-Docker
    Require-ComposeFile
    Ensure-Up
    & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry @Rest
    break
  }

  # Default: nessun arg = help.
  '' {
    Require-Docker
    Require-ComposeFile
    Ensure-Up
    & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry --help
    break
  }

  # Tutto il resto: delegato al CLI Node nel container.
  default {
    Require-Docker
    Require-ComposeFile
    Ensure-Up
    & docker exec @ExecFlags -e "JHT_HOST_TYPE=$env:JHT_HOST_TYPE" $Container node $NodeEntry $Sub @Rest
    break
  }
}

exit $LASTEXITCODE

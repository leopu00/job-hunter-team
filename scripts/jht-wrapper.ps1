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
# ║  Riferimento design: docs/internal/vps.md                                ║
# ╚══════════════════════════════════════════════════════════════════════════╝

$ErrorActionPreference = 'Stop'

$Container   = if ($env:JHT_CONTAINER_NAME) { $env:JHT_CONTAINER_NAME } else { 'jht' }
$RuntimeDir  = if ($env:JHT_RUNTIME_DIR)    { $env:JHT_RUNTIME_DIR }    else { Join-Path $env:USERPROFILE '.jht\runtime' }
$ComposeFile = if ($env:JHT_COMPOSE_FILE)   { $env:JHT_COMPOSE_FILE }   else { Join-Path $RuntimeDir 'docker-compose.yml' }
$NodeEntry   = if ($env:JHT_NODE_ENTRY)     { $env:JHT_NODE_ENTRY }     else { '/app/cli/bin/jht.js' }

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
    Write-Info "  iwr -useb https://raw.githubusercontent.com/leopu00/job-hunter-team/master/docker-compose.yml -OutFile '$ComposeFile'"
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
$Rest = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

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
    Require-Docker
    Require-ComposeFile
    Invoke-Compose pull
    Invoke-Compose up -d
    break
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

  # OAuth login: lancia il CLI del provider (claude/codex/kimi) per il
  # device-flow OAuth. Per ora hardcode "claude" come da bash wrapper.
  { $_ -in @('oauth-login', 'claude-login') } {
    Require-Docker
    Require-ComposeFile
    Ensure-Up
    & docker exec @ExecFlags $Container claude
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

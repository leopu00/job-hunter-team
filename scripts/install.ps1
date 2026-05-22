# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  Job Hunter Team — Installer Windows-native (PowerShell)                 ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Uso:                                                                    ║
# ║    iwr -useb https://jobhunterteam.ai/install.ps1 | iex                  ║
# ║                                                                          ║
# ║    # Branch alternativa per testare dev-N:                               ║
# ║    & ([scriptblock]::Create((iwr -useb https://raw.githubusercontent.com/leopu00/job-hunter-team/master/scripts/install.ps1).Content)) -Branch dev-1
# ║                                                                          ║
# ║  Default (Docker-mode): non installa nulla sull'host se non Docker       ║
# ║  Desktop (che deve essere gia' installato; lo controlliamo ma non lo     ║
# ║  scarichiamo per te — richiede consenso utente + WSL2 + reboot).         ║
# ║                                                                          ║
# ║  Scarica:                                                                ║
# ║    - $env:USERPROFILE\.jht\runtime\docker-compose.yml                    ║
# ║    - $env:USERPROFILE\.local\bin\jht.ps1 (wrapper PowerShell)            ║
# ║    - $env:USERPROFILE\.local\bin\jht.cmd (shim per CMD)                  ║
# ║                                                                          ║
# ║  Il CLI Node, Python, tmux, agents girano TUTTI nel container long-      ║
# ║  running gestito dal compose. Niente Node/Python/tmux sull'host.         ║
# ║  Niente socket Docker dentro al container.                               ║
# ║                                                                          ║
# ║  Solo due cartelle host vengono esposte al container:                    ║
# ║    $env:USERPROFILE\.jht                  → /jht_home                    ║
# ║    $env:USERPROFILE\Documents\Job Hunter Team → /jht_user                ║
# ║                                                                          ║
# ║  Differenze vs install.sh (Linux/macOS):                                 ║
# ║    - NO --no-docker: Windows native (Node+tmux+Claude standalone) non    ║
# ║      e' supportato. Il container e' l'unico path.                        ║
# ║    - NO sudo / apt / dnf / pacman / Colima / Homebrew: Docker Desktop    ║
# ║      e' l'unico runtime; lo si pre-installa via winget o manualmente.    ║
# ║    - PATH register via [Environment]::SetEnvironmentVariable User-scope  ║
# ║      (no shell rc). Effettivo dal prossimo terminale.                    ║
# ║                                                                          ║
# ║  Parametri:                                                              ║
# ║    -DryRun           Mostra azioni senza eseguirle                       ║
# ║    -Branch <name>    Branch sorgente (default: master)                   ║
# ║    -PairingToken     Token opaco per VPS pairing (skippa wizard)         ║
# ║    -SkipOnboard      Non lanciare il wizard alla fine                    ║
# ║                                                                          ║
# ║  Riferimento design: docs/internal/vps.md                                ║
# ╚══════════════════════════════════════════════════════════════════════════╝

[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$Branch = $(if ($env:JHT_BRANCH) { $env:JHT_BRANCH } else { 'master' }),
  [string]$PairingToken = '',
  [switch]$SkipOnboard
)

$ErrorActionPreference = 'Stop'

# ── Config ────────────────────────────────────────────────────────────────
$RuntimeDir = if ($env:JHT_RUNTIME_DIR) { $env:JHT_RUNTIME_DIR } else { Join-Path $env:USERPROFILE '.jht\runtime' }
$BinDir     = if ($env:JHT_BIN_DIR)     { $env:JHT_BIN_DIR }     else { Join-Path $env:USERPROFILE '.local\bin' }
$JhtHome    = Join-Path $env:USERPROFILE '.jht'
$Image      = if ($env:JHT_IMAGE)       { $env:JHT_IMAGE }       else { 'ghcr.io/leopu00/jht:latest' }
$RawBase    = if ($env:JHT_RAW_BASE)    { $env:JHT_RAW_BASE }    else { "https://raw.githubusercontent.com/leopu00/job-hunter-team/$Branch" }

$TotalSteps = 5

# ── UI helpers ────────────────────────────────────────────────────────────
function Write-Ok   { param([string]$Msg) Write-Host "  $([char]0x2713) $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "  ! $Msg" -ForegroundColor Yellow }
function Write-Info { param([string]$Msg) Write-Host "  > $Msg" -ForegroundColor Cyan }
function Write-Fail { param([string]$Msg) Write-Host "  x $Msg" -ForegroundColor Red; exit 1 }
function Write-Step { param([int]$N, [int]$Total, [string]$Title) Write-Host ""; Write-Host "[$N/$Total] $Title" -ForegroundColor White }
function Write-Dry  { param([string]$Cmd) Write-Host "  [dry-run] would execute: $Cmd" -ForegroundColor DarkGray }

function Invoke-Action {
  param([scriptblock]$Block, [string]$Description)
  if ($DryRun) {
    Write-Dry $Description
    return $true
  }
  & $Block
}

function Show-Header {
  Write-Host ""
  Write-Host "+------------------------------------------+" -ForegroundColor White
  Write-Host "|     Job Hunter Team - Installer (Win)    |" -ForegroundColor White
  Write-Host "+------------------------------------------+" -ForegroundColor White
  Write-Host ""
  Write-Host "  mode:    Docker Desktop (Windows-native)" -ForegroundColor DarkGray
  Write-Host "  image:   $Image" -ForegroundColor DarkGray
  Write-Host "  branch:  $Branch" -ForegroundColor DarkGray
  Write-Host "  runtime: $RuntimeDir" -ForegroundColor DarkGray
  Write-Host "  bin:     $BinDir" -ForegroundColor DarkGray
  if ($DryRun)       { Write-Host "  dry-run: ON (nessuna modifica al sistema)" -ForegroundColor Yellow }
  if ($PairingToken) { Write-Host "  pairing: token presente (skip wizard)" -ForegroundColor Yellow }
  Write-Host ""
}

# ── Step 1: System detection ──────────────────────────────────────────────
function Test-System {
  Write-Step 1 $TotalSteps "Rilevamento sistema"
  $os = [System.Environment]::OSVersion
  if ($os.Platform -ne 'Win32NT') {
    Write-Fail "install.ps1 supporta solo Windows. Su Linux/macOS usa install.sh."
  }
  $psVersion = $PSVersionTable.PSVersion
  if ($psVersion.Major -lt 5) {
    Write-Fail "PowerShell 5.1+ richiesto (versione corrente: $psVersion). Installa PowerShell 7: https://aka.ms/PowerShell"
  }
  Write-Ok "Windows $($os.Version) / PowerShell $psVersion"
}

# ── Step 2: Docker Desktop check ──────────────────────────────────────────
function Test-DockerDesktop {
  Write-Step 2 $TotalSteps "Verifica Docker Desktop"

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Warn "docker non trovato nel PATH."
    Write-Info "Installa Docker Desktop per Windows:"
    Write-Info "  - winget install Docker.DockerDesktop"
    Write-Info "  - oppure: https://www.docker.com/products/docker-desktop/"
    Write-Info "Docker Desktop richiede WSL2 attivo e un riavvio dopo l'installazione."
    Write-Fail "Rilancia install.ps1 dopo aver installato Docker Desktop."
  }
  Write-Ok "docker CLI trovato: $(docker --version)"

  if ($DryRun) {
    Write-Dry "docker info (skip in dry-run)"
    return
  }

  $null = & docker info 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "docker daemon non risponde."
    Write-Info "Avvia Docker Desktop dall'icona system tray o dal menu Start."
    Write-Info "Attendi che lo stato sia 'Engine running' prima di rilanciare."
    Write-Fail "Docker Desktop non e' attivo."
  }
  Write-Ok "docker daemon raggiungibile"

  # Verifica compose v2 (incluso in Docker Desktop di default ma controlliamo)
  $null = & docker compose version 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "docker compose v2 non disponibile. Aggiorna Docker Desktop all'ultima versione."
  }
  Write-Ok "docker compose v2 disponibile"
}

# ── Step 3: Download runtime files ────────────────────────────────────────
function Get-File {
  param([string]$Url, [string]$Dest)

  if ($DryRun) {
    Write-Dry "iwr $Url -OutFile $Dest"
    return
  }

  try {
    # -UseBasicParsing evita la dipendenza da Internet Explorer engine
    # (deprecato in PS7). Force evita prompt overwrite.
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Dest -ErrorAction Stop
  } catch {
    Write-Fail "Download fallito: $Url`n  $($_.Exception.Message)`n  Controlla connessione e branch ($Branch)."
  }
}

function Get-RuntimeFiles {
  Write-Step 3 $TotalSteps "Download wrapper + docker-compose.yml"

  $composeUrl  = "$RawBase/docker-compose.yml"
  $wrapperUrl  = "$RawBase/scripts/jht-wrapper.ps1"
  $composeDest = Join-Path $RuntimeDir 'docker-compose.yml'
  $wrapperDest = Join-Path $BinDir 'jht.ps1'
  $shimDest    = Join-Path $BinDir 'jht.cmd'

  Invoke-Action -Description "mkdir $RuntimeDir, $BinDir, $JhtHome" -Block {
    New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
    New-Item -ItemType Directory -Force -Path $BinDir     | Out-Null
    New-Item -ItemType Directory -Force -Path $JhtHome    | Out-Null
  } | Out-Null

  Write-Info "Scarico docker-compose.yml..."
  Get-File -Url $composeUrl -Dest $composeDest
  Write-Ok "compose: $composeDest"

  Write-Info "Scarico jht-wrapper.ps1..."
  Get-File -Url $wrapperUrl -Dest $wrapperDest
  Write-Ok "wrapper: $wrapperDest"

  # Shim CMD per chi usa cmd.exe invece di pwsh. Permette `jht <args>` senza
  # estensione .ps1, con bypass della ExecutionPolicy default Restricted.
  if (-not $DryRun) {
    $shimContent = @"
@echo off
pwsh -NoLogo -ExecutionPolicy Bypass -File "%~dp0jht.ps1" %*
if errorlevel 1 exit /b %errorlevel%
"@
    Set-Content -Path $shimDest -Value $shimContent -Encoding ASCII
    Write-Ok "shim CMD: $shimDest"
  } else {
    Write-Dry "Set-Content $shimDest (CMD shim)"
  }
}

# ── Step 4: PATH register ─────────────────────────────────────────────────
function Add-ToUserPath {
  Write-Step 4 $TotalSteps "Registrazione PATH utente"

  if ($DryRun) {
    Write-Dry "[Environment]::SetEnvironmentVariable('Path', '...;$BinDir', 'User')"
    Write-Dry "Update `$env:Path corrente sessione"
    $script:PathReady = $true
    return
  }

  # Usa il PATH USER-scope (HKCU). System-wide richiederebbe elevation;
  # user-scope sopravvive a login multipli senza prompt UAC.
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }

  $pathEntries = $userPath -split ';' | Where-Object { $_ -and ($_.Trim() -ne '') }
  $normalizedBin = $BinDir.TrimEnd('\')
  $alreadyPresent = $pathEntries | Where-Object { $_.TrimEnd('\') -ieq $normalizedBin }

  if ($alreadyPresent) {
    Write-Ok "$BinDir gia' nel PATH utente"
  } else {
    $newPath = if ($userPath) { "$userPath;$BinDir" } else { $BinDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Ok "PATH utente aggiornato (effettivo dal prossimo terminale)"
  }

  # Aggiorna anche $env:Path della sessione corrente cosi' i comandi
  # successivi dell'installer (es. wizard) trovano `jht.cmd` senza riaprire.
  $sessionPath = $env:Path -split ';' | Where-Object { $_.TrimEnd('\') -ieq $normalizedBin }
  if (-not $sessionPath) {
    $env:Path = "$env:Path;$BinDir"
  }

  $script:PathReady = $true
}

# ── Step 5: host.env + pairing token ──────────────────────────────────────
function Write-HostEnv {
  Write-Step 5 $TotalSteps "Configurazione host.env"

  $hostEnvFile = Join-Path $JhtHome 'host.env'
  $hostType = if ($PairingToken) { 'vps' } else { 'local' }

  # Best-effort timezone detection (Windows TimeZoneInfo → IANA name).
  # Se la mappatura non e' nota lasciamo UTC, il wizard chiedera' all'utente.
  $tz = 'UTC'
  try {
    $winTz = [System.TimeZoneInfo]::Local.Id
    # Mappatura minima dei TZ Windows piu' comuni. Lista completa in
    # https://github.com/unicode-org/cldr/blob/main/common/supplemental/windowsZones.xml
    $tzMap = @{
      'W. Europe Standard Time'      = 'Europe/Berlin'
      'Central European Standard Time' = 'Europe/Warsaw'
      'Romance Standard Time'        = 'Europe/Paris'
      'GMT Standard Time'            = 'Europe/London'
      'Eastern Standard Time'        = 'America/New_York'
      'Pacific Standard Time'        = 'America/Los_Angeles'
      'UTC'                          = 'UTC'
    }
    if ($tzMap.ContainsKey($winTz)) { $tz = $tzMap[$winTz] }
  } catch {
    # Fallback silente: $tz resta 'UTC', il wizard chiedera'.
  }

  $content = @"
# Host env per JHT wrapper + container. Generato da install.ps1.
JHT_HOST_TYPE=$hostType
JHT_LANG=en
JHT_USER_TZ=$tz
"@

  if ($DryRun) {
    Write-Dry "Set-Content $hostEnvFile (JHT_HOST_TYPE=$hostType, JHT_USER_TZ=$tz)"
  } else {
    Set-Content -Path $hostEnvFile -Value $content -Encoding UTF8
    Write-Ok "host.env scritto: $hostEnvFile (mode=$hostType, tz=$tz)"
  }

  # Pairing token: salva in $JhtHome\.pairing-token con perms restrictive
  # (Windows ACL: solo USERPROFILE owner legge/scrive). Il container lo
  # leggera' al primo boot via `jht cloud pair`.
  if ($PairingToken) {
    $tokenFile = Join-Path $JhtHome '.pairing-token'
    if ($DryRun) {
      Write-Dry "Set-Content $tokenFile (pairing token, ACL owner-only)"
    } else {
      Set-Content -Path $tokenFile -Value $PairingToken -Encoding ASCII -NoNewline

      # Restringe ACL al solo utente corrente (rimuove eredita' Users/Everyone).
      # Best-effort: se fallisce non blocchiamo l'install.
      try {
        $acl = Get-Acl $tokenFile
        $acl.SetAccessRuleProtection($true, $false)
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
          [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
          'FullControl', 'Allow'
        )
        $acl.SetAccessRule($rule)
        Set-Acl -Path $tokenFile -AclObject $acl
      } catch {
        Write-Warn "ACL restriction failed (file ancora accessibile a Users): $($_.Exception.Message)"
      }
      Write-Ok "Pairing token salvato: $tokenFile"
    }
  }
}

# ── Final message + optional onboarding ───────────────────────────────────
function Show-Final {
  Write-Host ""
  Write-Host "+------------------------------------------+" -ForegroundColor Green
  Write-Host "|  Installazione completata!               |" -ForegroundColor Green
  Write-Host "+------------------------------------------+" -ForegroundColor Green
  Write-Host ""
  Write-Host "  Modalita' container attiva." -ForegroundColor White
  Write-Host "  Gli agenti vedono solo:" -ForegroundColor DarkGray
  Write-Host "    $JhtHome                          -> /jht_home (config, db, agenti)" -ForegroundColor DarkGray
  Write-Host "    $env:USERPROFILE\Documents\Job Hunter Team -> /jht_user (CV, allegati, output)" -ForegroundColor DarkGray
  Write-Host ""

  if (-not (Test-WillAutoOnboard)) {
    Write-Host "  Prossimi passi:" -ForegroundColor White
    Write-Host ""
    if ($script:PathReady) {
      Write-Host "      jht setup        # wizard di configurazione (avvia anche il container)" -ForegroundColor White
    } else {
      Write-Host "      $BinDir\jht.cmd setup" -ForegroundColor White
    }
    Write-Host ""
  }

  Write-Host "  Per disinstallare (mantiene i dati in ~/.jht e ~/Documents/Job Hunter Team):" -ForegroundColor DarkGray
  Write-Host "    jht down" -ForegroundColor DarkGray
  Write-Host "    Remove-Item -Recurse -Force '$RuntimeDir', '$BinDir\jht.ps1', '$BinDir\jht.cmd'" -ForegroundColor DarkGray
  Write-Host "    docker rmi $Image" -ForegroundColor DarkGray
  Write-Host "  Per cancellare anche dati (config, db, CV, output):" -ForegroundColor DarkGray
  Write-Host "    Remove-Item -Recurse -Force '$JhtHome', '$env:USERPROFILE\Documents\Job Hunter Team'" -ForegroundColor DarkGray
  Write-Host ""
}

function Test-WillAutoOnboard {
  if ($DryRun)        { return $false }
  if ($SkipOnboard)   { return $false }
  if ($env:JHT_SKIP_ONBOARD -eq '1') { return $false }
  if ($PairingToken)  { return $false }
  # Wizard interattivo richiede un host process — quando install.ps1 e' eseguito
  # via `iwr|iex` dentro pwsh interattivo, abbiamo host normale. Quando e'
  # eseguito da un job/CI con redirect, IsInputRedirected e' true.
  if ([Console]::IsInputRedirected) { return $false }
  return $true
}

function Invoke-Onboard {
  if (-not (Test-WillAutoOnboard)) {
    if ($PairingToken) {
      Write-Info "Pairing token presente: skip wizard interattivo. Il container completera' il pairing al primo avvio."
    }
    return
  }
  Write-Host ""
  Write-Info "Lancio wizard di setup..."
  # Usa il shim CMD che gestisce ExecutionPolicy. PathReady garantisce
  # che `jht.cmd` sia raggiungibile in questa sessione.
  & "$BinDir\jht.cmd" setup
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "Il wizard e' uscito con errore. Rilancialo con: jht setup"
  }
}

# ── Main ──────────────────────────────────────────────────────────────────
Show-Header
Test-System
Test-DockerDesktop
Get-RuntimeFiles
Add-ToUserPath
Write-HostEnv
Show-Final
Invoke-Onboard

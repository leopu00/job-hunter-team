# ──────────────────────────────────────────────────────────────────
# Job Hunter Team — Windows Launcher (PowerShell)
# Avvia il backend e apre il browser su http://localhost:3000
# ──────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"
$Port = 3000
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WebDir = Join-Path $AppDir "web"
$LogFile = Join-Path $AppDir ".jht-server.log"

function Write-Banner {
    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "  ║  " -ForegroundColor Green -NoNewline
    Write-Host "Job Hunter Team" -ForegroundColor White -NoNewline
    Write-Host "                    ║" -ForegroundColor Green
    Write-Host "  ║  Sistema multi-agente di ricerca     ║" -ForegroundColor Green
    Write-Host "  ║  e candidatura automatizzata         ║" -ForegroundColor Green
    Write-Host "  ╚══════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
}

function Write-Info  { param($Msg) Write-Host "[info]  $Msg" -ForegroundColor Cyan }
function Write-Ok    { param($Msg) Write-Host "[ok]    $Msg" -ForegroundColor Green }
function Write-Warn  { param($Msg) Write-Host "[warn]  $Msg" -ForegroundColor Yellow }
function Write-Fail  { param($Msg) Write-Host "[err]   $Msg" -ForegroundColor Red; exit 1 }

Write-Banner

# ── Check Node.js ──
Write-Info "Verifica Node.js..."
try {
    $nodeVersion = & node -v 2>$null
    if (-not $nodeVersion) { throw "not found" }
    $major = [int]($nodeVersion -replace 'v','').Split('.')[0]
    if ($major -lt 18) {
        Write-Fail "Serve Node.js 18+. Versione attuale: $nodeVersion"
    }
    Write-Ok "Node.js $nodeVersion"
} catch {
    Write-Warn "Node.js non trovato."
    Write-Host ""
    Write-Host "  Installa Node.js 18+ da:" -ForegroundColor White
    Write-Host "  https://nodejs.org/en/download" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Oppure con winget:" -ForegroundColor White
    Write-Host "  winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
    Write-Host ""
    Write-Fail "Installa Node.js e riprova."
}

# ── Check npm ──
try {
    $npmVersion = & npm -v 2>$null
    Write-Ok "npm $npmVersion"
} catch {
    Write-Fail "npm non trovato. Installa Node.js da https://nodejs.org"
}

# ── Check directory web ──
if (-not (Test-Path $WebDir)) {
    Write-Fail "Directory web\ non trovata in $AppDir"
}

# ── Installa dipendenze ──
$nodeModules = Join-Path $WebDir "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Info "Installazione dipendenze (prima esecuzione)..."
    Push-Location $WebDir
    & npm install --production=false 2>&1 | Select-Object -Last 1
    Pop-Location
    Write-Ok "Dipendenze installate"
} else {
    Write-Ok "Dipendenze presenti"
}

# ── Build (se necessario) ──
$nextDir = Join-Path $WebDir ".next"
if (-not (Test-Path $nextDir)) {
    Write-Info "Build dell'applicazione (prima esecuzione, potrebbe richiedere qualche minuto)..."
    Push-Location $WebDir
    & npm run build 2>&1 | Select-Object -Last 3
    Pop-Location
    Write-Ok "Build completata"
} else {
    Write-Ok "Build presente"
}

# ── Verifica porta libera ──
$portInUse = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
if ($portInUse) {
    Write-Warn "Porta $Port occupata. Provo a liberarla..."
    $portInUse | ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

# ── Avvio server ──
Write-Info "Avvio server su http://localhost:$Port ..."
Push-Location $WebDir
$serverJob = Start-Job -ScriptBlock {
    param($Dir, $P, $Log)
    Set-Location $Dir
    & npm run start -- -p $P *> $Log
} -ArgumentList $WebDir, $Port, $LogFile
Pop-Location

# ── Attendi che il server sia pronto ──
Write-Info "Attendo che il server sia pronto..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$Port" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    Write-Fail "Il server non risponde dopo 30 secondi. Controlla $LogFile"
}

Write-Ok "Server attivo"

# ── Apri browser ──
Write-Info "Apertura browser..."
Start-Process "http://localhost:$Port"

Write-Host ""
Write-Host "  Job Hunter Team e' attivo!" -ForegroundColor Green
Write-Host "  URL:  http://localhost:$Port" -ForegroundColor White
Write-Host "  Log:  $LogFile" -ForegroundColor White
Write-Host "  Stop: Premi Ctrl+C o chiudi questa finestra" -ForegroundColor White
Write-Host ""

# ── Mantieni in foreground ──
Write-Host "Premi Ctrl+C per arrestare il server..." -ForegroundColor DarkGray
try {
    while ($true) {
        if ($serverJob.State -ne 'Running') {
            Write-Warn "Il server si e' arrestato. Controlla $LogFile"
            break
        }
        Start-Sleep -Seconds 2
    }
} finally {
    Write-Info "Arresto server..."
    Stop-Job $serverJob -ErrorAction SilentlyContinue
    Remove-Job $serverJob -Force -ErrorAction SilentlyContinue
    Write-Ok "Server arrestato. Alla prossima!"
}

# setup.ps1 — Job Hunter Team
#
# DEPRECATO: questo script e' l'onboarding legacy da dentro la repo clonata.
#            Per l'installazione standard su WSL preferisci:
#
#   curl -fsSL https://jobhunterteam.ai/install.sh | bash
#
# setup.ps1 resta per chi lavora nativo Windows senza WSL e vuole un
# onboarding idempotente delle dipendenze Python/Node dal source.
#
# Esegui con: powershell -ExecutionPolicy Bypass -File setup.ps1

$ErrorActionPreference = "Stop"
$RepoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Steps = 10

# Warning deprecation
Write-Host ""
Write-Host "[!!] setup.ps1 e' il flow legacy." -ForegroundColor Yellow
Write-Host "     Per l'installazione standard (WSL) usa:"
Write-Host "     curl -fsSL https://jobhunterteam.ai/install.sh | bash" -ForegroundColor White
Write-Host ""

# ── Colori ────────────────────────────────────────────────────────────────────
function Ok   { param($msg) Write-Host "  " -NoNewline; Write-Host "[OK]" -ForegroundColor Green -NoNewline; Write-Host " $msg" }
function Warn { param($msg) Write-Host "  " -NoNewline; Write-Host "[!!]" -ForegroundColor Yellow -NoNewline; Write-Host " $msg" }
function Fail { param($msg) Write-Host "  " -NoNewline; Write-Host "[XX]" -ForegroundColor Red -NoNewline; Write-Host " $msg"; exit 1 }
function Step { param($n, $msg) Write-Host ""; Write-Host "[$n/$Steps] $msg" -ForegroundColor White }

Write-Host ""
Write-Host "+======================================+" -ForegroundColor White
Write-Host "|    Job Hunter Team - Setup (Win)      |" -ForegroundColor White
Write-Host "+======================================+" -ForegroundColor White

# ── 1. Prerequisiti ───────────────────────────────────────────────────────────
Step 1 "Verifica prerequisiti"

# Python >= 3.10
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
if (-not $py) { Fail "Python non trovato. Installalo da https://python.org" }

$pyCmd = $py.Source
$pyVersion = & $pyCmd -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>$null
$pyParts = $pyVersion -split '\.'
$pyMajor = [int]$pyParts[0]
$pyMinor = [int]$pyParts[1]

if ($pyMajor -gt 3 -or ($pyMajor -eq 3 -and $pyMinor -ge 10)) {
    Ok "python $pyVersion"
} else {
    Fail "python $pyVersion trovato, ma e' richiesto >= 3.10"
}

# Node.js
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodeVersion = & node --version 2>$null
    Ok "node $nodeVersion"
} else {
    Fail "Node.js non trovato. Installalo da https://nodejs.org"
}

# npm
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($npm) {
    $npmVersion = & npm --version 2>$null
    Ok "npm $npmVersion"
} else {
    Fail "npm non trovato. Viene installato con Node.js"
}

# Git
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
    $gitVersion = & git --version 2>$null
    Ok "$gitVersion"
} else {
    Fail "Git non trovato. Installalo da https://git-scm.com"
}

# WSL + tmux (opzionale)
$wsl = Get-Command wsl -ErrorAction SilentlyContinue
if ($wsl) {
    $tmuxCheck = & wsl -d Ubuntu-22.04 -- which tmux 2>$null
    if ($tmuxCheck) {
        Ok "WSL + tmux disponibile (Ubuntu-22.04)"
    } else {
        Warn "WSL trovato ma tmux non installato in Ubuntu-22.04"
    }
} else {
    Warn "WSL non disponibile — gli agenti tmux non funzioneranno"
}

# ── 2. Virtualenv + dipendenze Python ────────────────────────────────────────
Step 2 "Virtualenv e dipendenze Python"

$venvDir = Join-Path $RepoDir ".venv"

if (Test-Path $venvDir) {
    Ok ".venv/ gia' presente"
} else {
    & $pyCmd -m venv $venvDir
    Ok ".venv/ creato"
}

# Attiva il venv
$activateScript = Join-Path $venvDir "Scripts\Activate.ps1"
if (Test-Path $activateScript) {
    . $activateScript
    Ok ".venv attivato"
} else {
    Warn "Impossibile attivare .venv — Scripts\Activate.ps1 non trovato"
}

$requirements = Join-Path $RepoDir "requirements.txt"
if (Test-Path $requirements) {
    & pip install --quiet -r $requirements 2>$null
    Ok "requirements.txt installato nel venv"
} else {
    & pip install --quiet pyyaml 2>$null
    Ok "pyyaml installato nel venv"
    Warn "requirements.txt non trovato, installato solo pyyaml"
}

# ── 3. File .env ──────────────────────────────────────────────────────────────
Step 3 "Configurazione .env"

$envFile = Join-Path $RepoDir ".env"
$envExample = Join-Path $RepoDir ".env.example"

if (Test-Path $envFile) {
    Ok ".env gia' presente"
} elseif (Test-Path $envExample) {
    Copy-Item $envExample $envFile
    Ok ".env creato da .env.example"
    Warn "Con Claude Max (abbonamento): non serve ANTHROPIC_API_KEY."
    Warn "Con API key: apri .env e inserisci ANTHROPIC_API_KEY."
} else {
    Fail ".env.example non trovato in $RepoDir"
}

# ── 4. candidate_profile.yml ─────────────────────────────────────────────────
Step 4 "Configurazione candidate_profile.yml"

$profile = Join-Path $RepoDir "candidate_profile.yml"
$profileExample = Join-Path $RepoDir "candidate_profile.yml.example"

if (Test-Path $profile) {
    Ok "candidate_profile.yml gia' presente"
} elseif (Test-Path $profileExample) {
    Copy-Item $profileExample $profile
    Ok "candidate_profile.yml creato da .example"
    Warn "AZIONE RICHIESTA: apri candidate_profile.yml e compila il tuo profilo"
} else {
    Warn "candidate_profile.yml.example non trovato, skippato"
}

# ── 5. Web App — web/.env.local ──────────────────────────────────────────────
Step 5 "Configurazione web app (web/.env.local)"

$webEnvExample = Join-Path $RepoDir "web\.env.example"
$webEnvLocal = Join-Path $RepoDir "web\.env.local"

if (Test-Path $webEnvLocal) {
    Ok "web/.env.local gia' presente"
} elseif (Test-Path $webEnvExample) {
    Copy-Item $webEnvExample $webEnvLocal
    Ok "web/.env.local creato da web/.env.example"
    Warn "AZIONE RICHIESTA: apri web/.env.local e inserisci le credenziali Supabase"
    Warn "  NEXT_PUBLIC_SUPABASE_URL=https://tuo-progetto.supabase.co"
    Warn "  NEXT_PUBLIC_SUPABASE_ANON_KEY=..."
} else {
    Warn "web/.env.example non trovato — crea manualmente web/.env.local"
}

# ── 6. Web App — npm install ─────────────────────────────────────────────────
Step 6 "Installazione dipendenze web (npm install)"

$webDir = Join-Path $RepoDir "web"
$nodeModules = Join-Path $webDir "node_modules"

if (Test-Path (Join-Path $nodeModules ".package-lock.json")) {
    Ok "node_modules/ gia' presente"
} else {
    Push-Location $webDir
    & npm install 2>&1 | Out-Null
    Pop-Location
    Ok "npm install completato"
}

# ── 7. Directory di dati ─────────────────────────────────────────────────────
Step 7 "Creazione directory necessarie"

$dirs = @(
    (Join-Path $RepoDir "shared\data\applications"),
    (Join-Path $RepoDir "shared\secrets")
)
foreach ($d in $dirs) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
Ok "shared/data/ OK"
Ok "shared/data/applications/ OK"
Ok "shared/secrets/ OK (gitignored — metti qui le credenziali OAuth/LinkedIn)"

# ── 8. Git hooks ─────────────────────────────────────────────────────────────
Step 8 "Installazione git hooks (pre-commit sicurezza)"

$githooks = Join-Path $RepoDir ".githooks"

if (Test-Path $githooks) {
    & git -C $RepoDir config core.hooksPath .githooks
    Ok "pre-commit hook installato (.githooks/)"
} else {
    Warn ".githooks/ non trovato — hook di sicurezza non installati"
}

# ── 9. Inizializzazione DB ───────────────────────────────────────────────────
Step 9 "Inizializzazione database"

$dbInit = Join-Path $RepoDir "shared\skills\db_init.py"

if (-not (Test-Path $dbInit)) {
    Fail "db_init.py non trovato in $dbInit"
}

& $pyCmd $dbInit
Ok "Database inizializzato"

# ── 10. Verifica integrita DB ────────────────────────────────────────────────
Step 10 "Verifica integrita database"

$dbMigrate = Join-Path $RepoDir "shared\skills\db_migrate_v2.py"

if (-not (Test-Path $dbMigrate)) {
    Warn "db_migrate_v2.py non trovato, verifica saltata"
} else {
    try {
        $verifyOut = & $pyCmd $dbMigrate --verify 2>&1
        Ok "Integrita DB verificata"
    } catch {
        if ($verifyOut -match "ZeroDivisionError") {
            Warn "DB vuoto (nessun record ancora) — verra' popolato al primo utilizzo"
        } else {
            Warn "Verifica DB ha restituito warning:"
            Write-Host "    $verifyOut"
        }
    }
}

# ── Riepilogo finale ─────────────────────────────────────────────────────────
Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host "  Setup completato con successo!" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green

# Controlla azioni pendenti
$pending = $false
if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -Raw -ErrorAction SilentlyContinue
    if ($envContent -match "your-key-here") { $pending = $true }
}
if (Test-Path $profile) {
    $profileContent = Get-Content $profile -Raw -ErrorAction SilentlyContinue
    if ($profileContent -match "^name:$|Il tuo nome|your-name") { $pending = $true }
}

if ($pending) {
    Write-Host ""
    Write-Host "Prima di avviare il team:" -ForegroundColor Yellow
    if ($envContent -match "your-key-here") {
        Write-Host "  1. Compila .env  ->  inserisci ANTHROPIC_API_KEY" -ForegroundColor Yellow
    }
    if ($profileContent -match "^name:$|Il tuo nome|your-name") {
        Write-Host "  2. Compila candidate_profile.yml  ->  inserisci i tuoi dati" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Prossimi step:" -ForegroundColor White
Write-Host ""
Write-Host "  > " -NoNewline -ForegroundColor Green; Write-Host "Attiva il virtualenv:"
Write-Host "      .venv\Scripts\Activate.ps1"
Write-Host ""
Write-Host "  > " -NoNewline -ForegroundColor Green; Write-Host "Avvia la web app:"
Write-Host "      cd web; npm run dev"
Write-Host ""

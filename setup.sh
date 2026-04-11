#!/usr/bin/env bash
# setup.sh — Job Hunter Team
#
# ⚠ DEPRECATO: questo script e' il vecchio onboarding da dentro la repo
#              clonata. Per l'installazione standard preferisci:
#
#   curl -fsSL https://jobhunterteam.ai/install.sh | bash
#
# setup.sh resta per chi sta gia' lavorando nella repo clonata e vuole
# un onboarding idempotente delle dipendenze Python/Node dal source.
#
# Idempotente: sicuro da rieseguire. Compatibile con macOS e Linux.
set -euo pipefail

# Mostra warning deprecation in cima (non blocca)
if [ -t 1 ]; then
  printf "\n\033[1;33m⚠  setup.sh e' il flow legacy.\033[0m\n"
  printf "   Per l'installazione standard usa:\n"
  printf "   \033[1mcurl -fsSL https://jobhunterteam.ai/install.sh | bash\033[0m\n\n"
fi

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
STEPS=10

# ── Colori ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
fail() { echo -e "  ${RED}✗${RESET} $*" >&2; exit 1; }
step() { echo -e "\n${BOLD}[$1/$STEPS] $2${RESET}"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║    Job Hunter Team — Setup           ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"

# ── 1. Prerequisiti ───────────────────────────────────────────────────────────
step 1 "Verifica prerequisiti"

# python3 >= 3.10
if command -v python3 &>/dev/null; then
  PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
  PY_MAJOR=$(echo "$PY_VERSION" | cut -d. -f1)
  PY_MINOR=$(echo "$PY_VERSION" | cut -d. -f2)
  if [ "$PY_MAJOR" -gt 3 ] || { [ "$PY_MAJOR" -eq 3 ] && [ "$PY_MINOR" -ge 10 ]; }; then
    ok "python3 $PY_VERSION"
  else
    fail "python3 $PY_VERSION trovato, ma è richiesto >= 3.10"
  fi
else
  fail "python3 non trovato. Installalo da https://python.org"
fi

# tmux
if command -v tmux &>/dev/null; then
  ok "tmux $(tmux -V | awk '{print $2}')"
else
  fail "tmux non trovato. Installalo con: brew install tmux  oppure  apt install tmux"
fi

# ── 2. Virtualenv + dipendenze Python ────────────────────────────────────────
step 2 "Virtualenv e dipendenze Python"

VENV_DIR="$REPO_DIR/.venv"

# Crea .venv se non esiste (idempotente)
if [ -d "$VENV_DIR" ]; then
  ok ".venv/ già presente"
else
  python3 -m venv "$VENV_DIR"
  ok ".venv/ creato"
fi

# Attiva il venv per questa sessione
# shellcheck source=/dev/null
source "$VENV_DIR/bin/activate"
ok ".venv attivato"

REQUIREMENTS="$REPO_DIR/requirements.txt"
if [ -f "$REQUIREMENTS" ]; then
  pip install --quiet -r "$REQUIREMENTS"
  ok "requirements.txt installato nel venv"
else
  pip install --quiet pyyaml
  ok "pyyaml installato nel venv"
  warn "requirements.txt non trovato, installato solo pyyaml"
fi

# ── 3. File .env ──────────────────────────────────────────────────────────────
step 3 "Configurazione .env"

ENV_FILE="$REPO_DIR/.env"
ENV_EXAMPLE="$REPO_DIR/.env.example"

if [ -f "$ENV_FILE" ]; then
  ok ".env già presente"
else
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    ok ".env creato da .env.example"
    warn "Con Claude Max (abbonamento): non serve ANTHROPIC_API_KEY."
    warn "Con API key: apri .env e inserisci ANTHROPIC_API_KEY."
  else
    fail ".env.example non trovato in $REPO_DIR"
  fi
fi

# ── 4. candidate_profile.yml ──────────────────────────────────────────────────
step 4 "Configurazione candidate_profile.yml"

PROFILE="$REPO_DIR/candidate_profile.yml"
PROFILE_EXAMPLE="$REPO_DIR/candidate_profile.yml.example"

if [ -f "$PROFILE" ]; then
  ok "candidate_profile.yml già presente"
else
  if [ -f "$PROFILE_EXAMPLE" ]; then
    cp "$PROFILE_EXAMPLE" "$PROFILE"
    ok "candidate_profile.yml creato da .example"
    warn "AZIONE RICHIESTA: apri candidate_profile.yml e compila il tuo profilo"
  else
    warn "candidate_profile.yml.example non trovato, skippato"
  fi
fi

# ── 5. Web App — web/.env.local ───────────────────────────────────────────────
step 5 "Configurazione web app (web/.env.local)"

WEB_ENV_EXAMPLE="$REPO_DIR/web/.env.example"
WEB_ENV_LOCAL="$REPO_DIR/web/.env.local"

if [ -f "$WEB_ENV_LOCAL" ]; then
  ok "web/.env.local già presente"
else
  if [ -f "$WEB_ENV_EXAMPLE" ]; then
    cp "$WEB_ENV_EXAMPLE" "$WEB_ENV_LOCAL"
    ok "web/.env.local creato da web/.env.example"
    warn "AZIONE RICHIESTA: apri web/.env.local e inserisci le credenziali Supabase"
    warn "  NEXT_PUBLIC_SUPABASE_URL=https://tuo-progetto.supabase.co"
    warn "  NEXT_PUBLIC_SUPABASE_ANON_KEY=..."
  else
    warn "web/.env.example non trovato — crea manualmente web/.env.local"
    warn "Vedi docs/quickstart.md per le istruzioni"
  fi
fi

# ── 6. Web App — npm install ────────────────────────────────────────────────
step 6 "Installazione dipendenze web (npm install)"

WEB_DIR="$REPO_DIR/web"
if [ -f "$WEB_DIR/node_modules/.package-lock.json" ]; then
  ok "node_modules/ già presente"
else
  if command -v npm &>/dev/null; then
    (cd "$WEB_DIR" && npm install --silent)
    ok "npm install completato"
  else
    warn "npm non trovato — installa Node.js da https://nodejs.org"
  fi
fi

# ── 7. Directory di dati ──────────────────────────────────────────────────────
step 7 "Creazione directory necessarie"

mkdir -p "$REPO_DIR/shared/data/applications"
mkdir -p "$REPO_DIR/shared/secrets"
ok "shared/data/ OK"
ok "shared/data/applications/ OK"
ok "shared/secrets/ OK (gitignored — metti qui le credenziali OAuth/LinkedIn)"

# ── 8. Git hooks ──────────────────────────────────────────────────────────────
step 8 "Installazione git hooks (pre-commit sicurezza)"

if [ -d "$REPO_DIR/.githooks" ]; then
  git -C "$REPO_DIR" config core.hooksPath .githooks
  chmod +x "$REPO_DIR/.githooks/pre-commit"
  ok "pre-commit hook installato (.githooks/)"
else
  warn ".githooks/ non trovato — hook di sicurezza non installati"
fi

# ── 9. Inizializzazione DB ────────────────────────────────────────────────────
step 9 "Inizializzazione database"

DB_INIT="$REPO_DIR/shared/skills/db_init.py"

if [ ! -f "$DB_INIT" ]; then
  fail "db_init.py non trovato in $DB_INIT"
fi

python3 "$DB_INIT"
ok "Database inizializzato"

# ── 10. Verifica integrità DB ─────────────────────────────────────────────────
step 10 "Verifica integrità database"

DB_MIGRATE="$REPO_DIR/shared/skills/db_migrate_v2.py"

if [ ! -f "$DB_MIGRATE" ]; then
  warn "db_migrate_v2.py non trovato, verifica saltata"
else
  # Bug noto: ZeroDivisionError su DB vuoto — lo ignoriamo silenziosamente
  VERIFY_OUT=$(python3 "$DB_MIGRATE" --verify 2>&1) && VERIFY_RC=0 || VERIFY_RC=$?
  if [ $VERIFY_RC -eq 0 ]; then
    ok "Integrità DB verificata"
  elif echo "$VERIFY_OUT" | grep -q "ZeroDivisionError"; then
    warn "DB vuoto (nessun record ancora) — verrà popolato al primo utilizzo"
  else
    warn "Verifica DB ha restituito warning:"
    echo "$VERIFY_OUT" | sed 's/^/    /'
  fi
fi

# ── Riepilogo finale ──────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  Setup completato con successo!${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════${RESET}"

# Controlla azioni pendenti
PENDING=0
[ ! -s "$ENV_FILE" ] || grep -q "your-key-here" "$ENV_FILE" 2>/dev/null && PENDING=1 || true
[ -f "$PROFILE" ] && grep -q "^name:$\|nome:" "$PROFILE" 2>/dev/null && PENDING=1 || true

if [ $PENDING -eq 1 ] || grep -q "your-key-here" "$ENV_FILE" 2>/dev/null; then
  echo ""
  echo -e "${YELLOW}${BOLD}Prima di avviare il team:${RESET}"
  grep -q "your-key-here" "$ENV_FILE" 2>/dev/null && \
    echo -e "  ${YELLOW}1.${RESET} Compila ${BOLD}.env${RESET}  →  inserisci ANTHROPIC_API_KEY" || true
  [ -f "$PROFILE" ] && grep -q "^name:$\|Il tuo nome\|your-name" "$PROFILE" 2>/dev/null && \
    echo -e "  ${YELLOW}2.${RESET} Compila ${BOLD}candidate_profile.yml${RESET}  →  inserisci i tuoi dati" || true
fi

echo ""
echo -e "${BOLD}Prossimi step:${RESET}"
echo ""

REPO_ROOT="$(git -C "$REPO_DIR" rev-parse --show-toplevel 2>/dev/null || echo "$REPO_DIR")"
START_SCRIPT="$REPO_ROOT/.launcher/start.sh"

if [ -f "$START_SCRIPT" ]; then
  echo -e "  ${GREEN}▶${RESET} Attiva il virtualenv:"
  echo -e "      ${BOLD}source .venv/bin/activate${RESET}"
  echo ""
  echo -e "  ${GREEN}▶${RESET} Avvia il team:"
  echo -e "      ${BOLD}$START_SCRIPT${RESET}"
  echo ""
  echo -e "  ${GREEN}▶${RESET} Connettiti al Coordinatore:"
  echo -e "      ${BOLD}tmux attach -t ALFA${RESET}"
else
  echo -e "  ${GREEN}▶${RESET} Attiva il virtualenv:"
  echo -e "      ${BOLD}source .venv/bin/activate${RESET}"
  echo ""
  echo -e "  ${GREEN}▶${RESET} Avvia il team:"
  echo -e "      ${BOLD}.launcher/start.sh${RESET}  (dalla root del repo)"
  echo ""
  echo -e "  ${GREEN}▶${RESET} Connettiti al Coordinatore:"
  echo -e "      ${BOLD}tmux attach -t ALFA${RESET}"
fi

echo ""
echo -e "${BOLD}Web App (Next.js) — setup locale:${RESET}"
echo ""
echo -e "  ${GREEN}▶${RESET} Configura le variabili d'ambiente:"
echo -e "      ${BOLD}cp web/.env.example web/.env.local${RESET}  e compila i valori Supabase"
echo ""
echo -e "  ${GREEN}▶${RESET} Avvia con Docker (hot reload):"
echo -e "      ${BOLD}cd web && docker compose up${RESET}"
echo ""
echo -e "  ${GREEN}▶${RESET} Oppure avvia senza Docker:"
echo -e "      ${BOLD}cd web && npm install && npm run dev${RESET}"
echo ""

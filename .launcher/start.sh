#!/usr/bin/env bash
# .launcher/start.sh — Avvia il Job Hunter Team in locale
#
# Prerequisiti: tmux, Claude CLI (claude), node/npm o Docker
# Uso: ./.launcher/start.sh [mode]
# Mode: default (bilanciato) | fast (token ridotti)
#
# Avvia: Coordinatore + agenti principali (Scout, Analista, Scorer, Scrittore)
set -euo pipefail

DEV_TEAM_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DEV_TEAM_DIR/config.sh"

MODE="${1:-default}"
AGENT_SCRIPT="$DEV_TEAM_DIR/start-agent.sh"

# ── Colori ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET} $*"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
fail() { echo -e "  ${RED}✗${RESET} $*" >&2; exit 1; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║    Job Hunter Team — Avvio           ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""
echo -e "Mode: ${BOLD}$MODE${RESET}  |  Repo: $REPO_ROOT"
echo ""

# ── Verifica prerequisiti ─────────────────────────────────────────────────────
if ! command -v tmux &>/dev/null;  then fail "tmux non trovato. Installa con: brew install tmux"; fi
if ! command -v claude &>/dev/null; then fail "Claude CLI non trovato. Scarica da https://claude.ai/download"; fi

# ── Inizializza struttura JHT ─────────────────────────────────────────────────
mkdir -p "$JHT_HOME" "$JHT_AGENTS_DIR" "$JHT_LOGS_DIR"
mkdir -p "$JHT_USER_DIR/cv" "$JHT_USER_DIR/allegati" "$JHT_USER_DIR/output"
ok "JHT_HOME:     $JHT_HOME"
ok "JHT_USER_DIR: $JHT_USER_DIR"

if [ ! -f "$JHT_CONFIG" ]; then
  warn "jht.config.json non trovato in $JHT_HOME. Avvia prima la TUI per configurare provider e API key."
fi

# ── Avvia Job Hunter Team (configurazione dal legacy) ─────────────────────────
# Ordine: prima CAPITANO (coordinatore), poi agenti operativi
# Configurazione di default: CAPITANO + SCOUT-1 + ANALISTA-1 + SCORER-1
#                            + SCRITTORE-1 + CRITICO + SENTINELLA
echo "  Avvio CAPITANO..."
"$AGENT_SCRIPT" capitano "" "$MODE" && true

echo "  Avvio SCOUT-1..."
"$AGENT_SCRIPT" scout 1 "$MODE" && true

echo "  Avvio ANALISTA-1..."
"$AGENT_SCRIPT" analista 1 "$MODE" && true

echo "  Avvio SCORER-1..."
"$AGENT_SCRIPT" scorer 1 "$MODE" && true

echo "  Avvio SCRITTORE-1..."
"$AGENT_SCRIPT" scrittore 1 "$MODE" && true

echo "  Avvio CRITICO..."
"$AGENT_SCRIPT" critico "" "$MODE" && true

echo "  Avvio SENTINELLA..."
"$AGENT_SCRIPT" sentinella "" "$MODE" && true

# ── Riepilogo ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  Job Hunter Team online!${RESET}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════${RESET}"
echo ""
echo "Sessioni attive:"
tmux list-sessions 2>/dev/null | grep -E "CAPITANO|SCOUT|ANALISTA|SCORER|SCRITTORE|CRITICO|SENTINELLA" || warn "Nessuna sessione trovata"
echo ""
echo -e "${BOLD}Connettiti al Coordinatore:${RESET}"
echo "  tmux attach -t CAPITANO"
echo ""
echo -e "${BOLD}Web App (localhost:3000):${RESET}"

WEB_ENV="$REPO_ROOT/web/.env.local"
if [ ! -f "$WEB_ENV" ]; then
  warn "web/.env.local mancante. Esegui:"
  echo "    cp web/.env.example web/.env.local"
  echo "    # poi compila con le tue credenziali Supabase"
  echo ""
fi

if command -v docker &>/dev/null && docker compose version &>/dev/null 2>&1; then
  echo "  Con Docker:  cd web && docker compose up"
else
  echo "  Senza Docker: cd web && npm install && npm run dev"
fi
echo ""

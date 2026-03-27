#!/usr/bin/env bash
# .dev-team/start-agent.sh — Avvia un singolo agente del Job Hunter Team
# Uso: ./start-agent.sh <ruolo> [istanza] [mode]
#
# Ruoli: alfa, scout, analista, scorer, scrittore, critico, sentinella, assistente
# Istanza: numero per agenti multipli (es: scout 1 → SCOUT-1)
# Mode: default|fast (default se omesso)
#
# Il template CLAUDE.md viene copiato da agents/<ruolo>/<ruolo>.md nel workspace.
set -euo pipefail

DEV_TEAM_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DEV_TEAM_DIR/config.sh"

if [ -z "${1:-}" ]; then
  echo "Uso: $0 <ruolo> [istanza] [mode]"
  echo ""
  echo "Ruoli disponibili:"
  echo "  alfa        → ALFA         (Coordinatore pipeline Job Hunter)"
  echo "  scout       → SCOUT-N      (Cerca posizioni lavorative)"
  echo "  analista    → ANALISTA-N   (Analizza job description e aziende)"
  echo "  scorer      → SCORER-N     (Calcola punteggio match)"
  echo "  scrittore   → SCRITTORE-N  (Scrive CV e cover letter)"
  echo "  critico     → CRITICO      (Revisione qualità CV)"
  echo "  sentinella  → SENTINELLA   (Monitora token usage e rate limit)"
  echo "  assistente  → ASSISTENTE   (Aiuta l'utente a navigare la piattaforma)"
  echo ""
  echo "Esempi:"
  echo "  $0 alfa              → avvia ALFA"
  echo "  $0 scout 1           → avvia SCOUT-1"
  echo "  $0 scrittore 2 fast  → avvia SCRITTORE-2 in modalità fast"
  echo "  $0 assistente        → avvia ASSISTENTE"
  exit 1
fi

ROLE="$1"
INSTANCE="${2:-}"
MODE="${3:-default}"

# Mappa ruolo → prefisso sessione | effort
get_agent_info() {
  case "$1" in
    alfa)       echo "ALFA|high" ;;
    scout)      echo "SCOUT|high" ;;
    analista)   echo "ANALISTA|high" ;;
    scorer)     echo "SCORER|medium" ;;
    scrittore)  echo "SCRITTORE|high" ;;
    critico)    echo "CRITICO|high" ;;
    sentinella) echo "SENTINELLA|low" ;;
    assistente) echo "ASSISTENTE|medium" ;;
    *)          echo "" ;;
  esac
}

AGENT_INFO=$(get_agent_info "$ROLE")

if [ -z "$AGENT_INFO" ]; then
  echo "Errore: ruolo '$ROLE' non riconosciuto."
  echo "Ruoli validi: alfa, scout, analista, scorer, scrittore, critico, sentinella, assistente"
  exit 1
fi

IFS='|' read -r session_prefix effort <<< "$AGENT_INFO"

# Costruisci nome sessione tmux
if [ "$ROLE" = "alfa" ] || [ "$ROLE" = "critico" ] || [ "$ROLE" = "sentinella" ] || [ "$ROLE" = "assistente" ]; then
  # Agenti singoli — nessun numero
  SESSION="$session_prefix"
else
  # Agenti multipli — richiede istanza
  if [ -z "$INSTANCE" ]; then
    INSTANCE="1"
    echo "Nota: istanza non specificata, uso $ROLE $INSTANCE"
  fi
  SESSION="${session_prefix}-${INSTANCE}"
fi

# Determina effort in base al mode
if [ "$MODE" = "fast" ]; then
  effort="low"
fi

# Verifica prerequisiti
if ! command -v claude &>/dev/null; then
  echo "Errore: comando 'claude' non trovato."
  echo "Installa Claude CLI: https://claude.ai/download"
  exit 1
fi
if ! command -v tmux &>/dev/null; then
  echo "Errore: tmux non trovato. Installalo con: sudo apt install tmux"
  exit 1
fi

# ── Workspace ────────────────────────────────────────────────────────────────
if [ -z "${JHT_WORKSPACE:-}" ]; then
  echo "Errore: JHT_WORKSPACE non configurato."
  echo "Impostalo in .env o come variabile d'ambiente."
  echo "Esempio: JHT_WORKSPACE=~/job-hunter-workspace"
  exit 1
fi

# Directory di lavoro dell'agente nel workspace
if [ "$ROLE" = "alfa" ] || [ "$ROLE" = "critico" ] || [ "$ROLE" = "sentinella" ] || [ "$ROLE" = "assistente" ]; then
  AGENT_DIR="$JHT_WORKSPACE/$ROLE"
else
  AGENT_DIR="$JHT_WORKSPACE/${ROLE}-${INSTANCE}"
fi
mkdir -p "$AGENT_DIR"

# ── CLAUDE.md per l'agente ────────────────────────────────────────────────────
CLAUDE_DEST="$AGENT_DIR/CLAUDE.md"
TEMPLATE="$REPO_ROOT/agents/$ROLE/$ROLE.md"

if [ ! -f "$CLAUDE_DEST" ]; then
  if [ -f "$TEMPLATE" ]; then
    cp "$TEMPLATE" "$CLAUDE_DEST"
    echo "  → CLAUDE.md creato da template ($ROLE.md)"
  else
    echo "Errore: template $TEMPLATE non trovato e CLAUDE.md non esiste in $AGENT_DIR."
    echo "Crea agents/$ROLE/$ROLE.md nel repo oppure $CLAUDE_DEST manualmente."
    exit 1
  fi
fi

# ── Avvia agente ─────────────────────────────────────────────────────────────
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Sessione '$SESSION' già attiva."
  echo "Connettiti con: tmux attach -t \"$SESSION\""
  exit 0
fi

# Rileva se siamo in WSL — Claude CLI è un binario Windows, va lanciato via PowerShell
if grep -qi microsoft /proc/version 2>/dev/null; then
  WIN_AGENT_DIR=$(wslpath -w "$AGENT_DIR")
  tmux new-session -d -s "$SESSION" powershell.exe
  sleep 2
  tmux send-keys -t "$SESSION" "Set-Location '${WIN_AGENT_DIR}'" Enter
  sleep 1
  tmux send-keys -t "$SESSION" "claude --dangerously-skip-permissions --effort $effort" Enter
  # Auto-accept workspace trust dialog ("Yes, I trust" è già selezionato, basta Enter)
  sleep 8
  tmux send-keys -t "$SESSION" Enter
else
  tmux new-session -d -s "$SESSION" -c "$AGENT_DIR"
  tmux send-keys -t "$SESSION" "claude --dangerously-skip-permissions --effort $effort" C-m
fi

echo "✓ $SESSION avviato (effort: $effort, mode: $MODE)"
echo "  Workspace: $AGENT_DIR"
echo "  Connettiti con: tmux attach -t \"$SESSION\""

#!/usr/bin/env bash
# .dev-team/start-agent.sh — Avvia un singolo agente del Job Hunter Team
# Uso: ./start-agent.sh <ruolo> [istanza] [mode]
#
# Ruoli: alfa, scout, analista, scorer, scrittore, critico, sentinella
# Istanza: numero per agenti multipli (es: scout 1 → SCOUT-1)
# Mode: default|fast (default se omesso)
#
# CLAUDE.md: copiato dalla legacy (~/Repos/job-hunter/<ruolo>/) se disponibile.
# I CLAUDE.md NON vengono committati (.gitignore).
set -euo pipefail

DEV_TEAM_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DEV_TEAM_DIR/config.sh"

if [ -z "${1:-}" ]; then
  echo "Uso: $0 <ruolo> [istanza] [mode]"
  echo ""
  echo "Ruoli disponibili (dal legacy):"
  echo "  alfa       → ALFA         (Coordinatore pipeline Job Hunter)"
  echo "  scout      → SCOUT-N      (Cerca posizioni lavorative)"
  echo "  analista   → ANALISTA-N   (Analizza job description e aziende)"
  echo "  scorer     → SCORER-N     (Calcola punteggio match)"
  echo "  scrittore  → SCRITTORE-N  (Scrive CV e cover letter)"
  echo "  critico    → CRITICO      (Revisione qualità CV)"
  echo "  sentinella → SENTINELLA   (Monitora token usage e rate limit)"
  echo ""
  echo "Esempi:"
  echo "  $0 alfa              → avvia ALFA"
  echo "  $0 scout 1           → avvia SCOUT-1"
  echo "  $0 scrittore 2 fast  → avvia SCRITTORE-2 in modalità fast"
  exit 1
fi

ROLE="$1"
INSTANCE="${2:-}"
MODE="${3:-default}"

# Mappa ruolo → prefisso sessione | effort | nome legacy
get_agent_info() {
  case "$1" in
    alfa)       echo "ALFA|high|alfa" ;;
    scout)      echo "SCOUT|high|scout" ;;
    analista)   echo "ANALISTA|high|analista" ;;
    scorer)     echo "SCORER|medium|scorer" ;;
    scrittore)  echo "SCRITTORE|high|scrittore" ;;
    critico)    echo "CRITICO|high|critico" ;;
    sentinella) echo "SENTINELLA|low|mentor" ;;
    *)          echo "" ;;
  esac
}

AGENT_INFO=$(get_agent_info "$ROLE")

if [ -z "$AGENT_INFO" ]; then
  echo "Errore: ruolo '$ROLE' non riconosciuto."
  echo "Ruoli validi: alfa, scout, analista, scorer, scrittore, critico, sentinella"
  exit 1
fi

IFS='|' read -r session_prefix effort legacy_name <<< "$AGENT_INFO"

# Costruisci nome sessione tmux
if [ "$ROLE" = "alfa" ] || [ "$ROLE" = "critico" ] || [ "$ROLE" = "sentinella" ]; then
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
  echo "Errore: tmux non trovato. Installalo con: brew install tmux"
  exit 1
fi

# ── CLAUDE.md per l'agente ────────────────────────────────────────────────────
AGENT_DIR="$REPO_ROOT/agents/$ROLE"
mkdir -p "$AGENT_DIR"
CLAUDE_DEST="$AGENT_DIR/CLAUDE.md"

# Cerca nella legacy repo locale (~/Repos/job-hunter/<ruolo>/)
LEGACY_BASE="$HOME/Repos/job-hunter"

# Per agenti multipli controlla prima l'istanza specifica, poi il ruolo base
if [ -n "$INSTANCE" ] && [ -f "$LEGACY_BASE/$legacy_name-$INSTANCE/CLAUDE.md" ]; then
  cp "$LEGACY_BASE/$legacy_name-$INSTANCE/CLAUDE.md" "$CLAUDE_DEST"
  echo "  → CLAUDE.md copiato dalla legacy ($legacy_name-$INSTANCE)"
elif [ -f "$LEGACY_BASE/$legacy_name/CLAUDE.md" ]; then
  cp "$LEGACY_BASE/$legacy_name/CLAUDE.md" "$CLAUDE_DEST"
  echo "  → CLAUDE.md copiato dalla legacy ($legacy_name)"
else
  echo "  → CLAUDE.md legacy non trovato in $LEGACY_BASE/$legacy_name"
  echo "  → Crea manualmente $CLAUDE_DEST prima di avviare questo agente"
  echo "  → Oppure copia da un'altra installazione di job-hunter"
fi

# ── Avvia agente ─────────────────────────────────────────────────────────────
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Sessione '$SESSION' già attiva."
  echo "Connettiti con: tmux attach -t \"$SESSION\""
  exit 0
fi

if [ ! -f "$CLAUDE_DEST" ]; then
  echo "Errore: $CLAUDE_DEST mancante. Impossibile avviare senza CLAUDE.md."
  exit 1
fi

tmux new-session -d -s "$SESSION" -c "$AGENT_DIR"
tmux send-keys -t "$SESSION" "unset CLAUDECODE && claude --dangerously-skip-permissions --effort $effort" C-m

echo "✓ $SESSION avviato (effort: $effort, mode: $MODE)"
echo "  Dir: $AGENT_DIR"
echo "  Connettiti con: tmux attach -t \"$SESSION\""

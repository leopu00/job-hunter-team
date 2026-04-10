#!/usr/bin/env bash
# .launcher/start-agent.sh — Avvia un singolo agente del Job Hunter Team
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

# ── Selezione provider CLI (multi-provider) ──────────────────────────────────
# Legge ~/.jht/jht.config.json per scegliere tra claude / codex / kimi
# e capire se usare api_key (env var) o subscription (sessione CLI esistente).
# Default: claude subscription (comportamento pre-multi-provider).

JHT_CONFIG_FILE="${HOME}/.jht/jht.config.json"

extract_provider_info() {
  local cfg="$1"
  if ! [ -f "$cfg" ]; then
    echo "||"
    return
  fi
  if command -v python3 &>/dev/null; then
    python3 - "$cfg" 2>/dev/null <<'PYEOF' || echo "||"
import json, sys
try:
    with open(sys.argv[1]) as f:
        c = json.load(f)
    active = c.get("active_provider", "") or ""
    prov = (c.get("providers") or {}).get(active, {}) if active else {}
    auth = prov.get("auth_method", "") or ""
    key = prov.get("api_key", "") or ""
    print(f"{active}|{auth}|{key}")
except Exception:
    print("||")
PYEOF
  elif command -v jq &>/dev/null; then
    local active auth key
    active=$(jq -r '.active_provider // ""' "$cfg" 2>/dev/null || echo "")
    if [ -n "$active" ]; then
      auth=$(jq -r ".providers[\"$active\"].auth_method // \"\"" "$cfg" 2>/dev/null || echo "")
      key=$(jq -r ".providers[\"$active\"].api_key // \"\"" "$cfg" 2>/dev/null || echo "")
    else
      auth=""
      key=""
    fi
    echo "${active}|${auth}|${key}"
  else
    echo "||"
  fi
}

IFS='|' read -r PROVIDER AUTH_METHOD API_KEY <<< "$(extract_provider_info "$JHT_CONFIG_FILE")"

# Default: Claude subscription
CLI_BIN="claude"
CLI_ARGS="--dangerously-skip-permissions --effort $effort"
CLI_ENV_PREFIX=""

case "$PROVIDER" in
  ""|anthropic|claude)
    CLI_BIN="claude"
    CLI_ARGS="--dangerously-skip-permissions --effort $effort"
    if [ "$AUTH_METHOD" = "api_key" ] && [ -n "$API_KEY" ]; then
      CLI_ENV_PREFIX="ANTHROPIC_API_KEY='${API_KEY}' "
    fi
    ;;
  openai)
    CLI_BIN="codex"
    CLI_ARGS=""
    if [ "$AUTH_METHOD" = "api_key" ] && [ -n "$API_KEY" ]; then
      CLI_ENV_PREFIX="OPENAI_API_KEY='${API_KEY}' "
    fi
    ;;
  kimi|moonshot)
    CLI_BIN="kimi"
    CLI_ARGS=""
    if [ "$AUTH_METHOD" = "api_key" ] && [ -n "$API_KEY" ]; then
      CLI_ENV_PREFIX="MOONSHOT_API_KEY='${API_KEY}' "
    fi
    ;;
  *)
    echo "Warning: provider '$PROVIDER' non riconosciuto in jht.config.json, fallback a claude."
    ;;
esac

# Verifica prerequisiti della CLI scelta
if ! command -v "$CLI_BIN" &>/dev/null; then
  echo "Errore: comando '$CLI_BIN' non trovato (provider configurato: ${PROVIDER:-claude})."
  case "$CLI_BIN" in
    claude) echo "Installa Claude CLI: https://claude.ai/download" ;;
    codex)  echo "Installa Codex CLI: https://github.com/openai/codex" ;;
    kimi)   echo "Installa Kimi CLI del provider Moonshot." ;;
  esac
  echo "In alternativa, modifica ~/.jht/jht.config.json per usare un altro provider."
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

FULL_CMD="${CLI_ENV_PREFIX}${CLI_BIN}${CLI_ARGS:+ $CLI_ARGS}"

# Rileva se siamo in WSL — Claude CLI è un binario Windows, va lanciato via PowerShell
if grep -qi microsoft /proc/version 2>/dev/null; then
  WIN_AGENT_DIR=$(wslpath -w "$AGENT_DIR")
  tmux new-session -d -s "$SESSION" powershell.exe
  sleep 2
  tmux send-keys -t "$SESSION" "Set-Location '${WIN_AGENT_DIR}'" Enter
  sleep 1
  tmux send-keys -t "$SESSION" "$FULL_CMD" Enter
  # Auto-accept workspace trust dialog ("Yes, I trust" è già selezionato, basta Enter)
  sleep 8
  tmux send-keys -t "$SESSION" Enter
else
  tmux new-session -d -s "$SESSION" -c "$AGENT_DIR"
  tmux send-keys -t "$SESSION" "$FULL_CMD" C-m
  # Auto-accept workspace trust dialog (Enter in background dopo qualche secondo)
  # L'Enter extra e' innocuo se la CLI e' gia' partita (input vuoto = ignorato)
  (sleep 4 && tmux send-keys -t "$SESSION" Enter && sleep 3 && tmux send-keys -t "$SESSION" Enter) &>/dev/null &
fi

echo "✓ $SESSION avviato (cli: $CLI_BIN, provider: ${PROVIDER:-claude}, auth: ${AUTH_METHOD:-subscription}, effort: $effort, mode: $MODE)"
echo "  Workspace: $AGENT_DIR"
echo "  Connettiti con: tmux attach -t \"$SESSION\""

#!/usr/bin/env bash
# .launcher/start-agent.sh — Avvia un singolo agente del Job Hunter Team
# Uso: ./start-agent.sh <ruolo> [istanza] [mode]
#
# Ruoli: capitano, scout, analista, scorer, scrittore, critico, sentinella, assistente
# Istanza: numero per agenti multipli (es: scout 1 → SCOUT-1)
# Mode: default|fast (default se omesso)
#
# Il template CLAUDE.md viene copiato da agents/<ruolo>/<ruolo>.md nel workspace.
set -euo pipefail

# PATH robusto: senza questo, quando un agente Codex/Claude chiama
# `bash /app/.launcher/start-agent.sh scout 1` da dentro la sua TUI, il
# sub-shell eredita il PATH minimale della shell login (/usr/local/bin:
# /usr/bin:/bin:...) — manca /jht_home/.npm-global/bin dove vivono
# codex/claude/kimi, e lo script esce con "codex: command not found".
# Esportiamo esplicitamente sempre i path dei CLI qui.
export PATH="/app/agents/_tools:/jht_home/.npm-global/bin:/home/jht/.local/bin:${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"

DEV_TEAM_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DEV_TEAM_DIR/config.sh"

if [ -z "${1:-}" ]; then
  echo "Uso: $0 <ruolo> [istanza] [mode]"
  echo ""
  echo "Ruoli disponibili:"
  echo "  capitano        → CAPITANO         (Coordinatore pipeline Job Hunter)"
  echo "  scout       → SCOUT-N      (Cerca posizioni lavorative)"
  echo "  analista    → ANALISTA-N   (Analizza job description e aziende)"
  echo "  scorer      → SCORER-N     (Calcola punteggio match)"
  echo "  scrittore   → SCRITTORE-N  (Scrive CV e cover letter)"
  echo "  critico     → CRITICO      (Revisione qualità CV)"
  echo "  sentinella  → SENTINELLA   (Monitora token usage e rate limit)"
  echo "  assistente  → ASSISTENTE   (Aiuta l'utente a navigare la piattaforma)"
  echo ""
  echo "Esempi:"
  echo "  $0 capitano              → avvia CAPITANO"
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
    capitano)       echo "CAPITANO|high" ;;
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
  echo "Ruoli validi: capitano, scout, analista, scorer, scrittore, critico, sentinella, assistente"
  exit 1
fi

IFS='|' read -r session_prefix effort <<< "$AGENT_INFO"

# Costruisci nome sessione tmux
if [ "$ROLE" = "capitano" ] || [ "$ROLE" = "critico" ] || [ "$ROLE" = "sentinella" ] || [ "$ROLE" = "assistente" ]; then
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

# In the JHT container HOME is overridden to /jht_home (the bind-mount
# that matches the host's ~/.jht), so the provider config lives at
# ${HOME}/jht.config.json — not ${HOME}/.jht/jht.config.json. On the
# host the same file is at ~/.jht/jht.config.json. Honour JHT_HOME
# when set (container path), fall back to ~/.jht for host runs.
if [ -n "${JHT_HOME:-}" ] && [ -f "${JHT_HOME}/jht.config.json" ]; then
  JHT_CONFIG_FILE="${JHT_HOME}/jht.config.json"
else
  JHT_CONFIG_FILE="${HOME}/.jht/jht.config.json"
fi

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
    # --yolo è alias di --dangerously-bypass-approvals-and-sandbox:
    # salta sia approval che sandbox FS, così l'agente può scrivere
    # chat.jsonl, creare la profile dir, ecc. senza bloccarsi sul
    # prompt di approval (equivalente di claude --dangerously-skip-permissions).
    CLI_ARGS="--yolo"
    if [ "$AUTH_METHOD" = "api_key" ] && [ -n "$API_KEY" ]; then
      CLI_ENV_PREFIX="OPENAI_API_KEY='${API_KEY}' "
    fi
    ;;
  kimi|moonshot)
    CLI_BIN="kimi"
    # --yolo auto-approves every shell command so the agent can write
    # chat.jsonl, create the profile dir, etc. without blocking on the
    # approval prompt (equivalent of Claude's --dangerously-skip-permissions).
    CLI_ARGS="--yolo"
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

# ── Cartelle JHT ─────────────────────────────────────────────────────────────
mkdir -p "$JHT_HOME" "$JHT_AGENTS_DIR" "$JHT_LOGS_DIR"
mkdir -p "$JHT_USER_DIR/cv" "$JHT_USER_DIR/allegati" "$JHT_USER_DIR/output"

# Directory di lavoro dell'agente nella zona nascosta
if [ "$ROLE" = "capitano" ] || [ "$ROLE" = "critico" ] || [ "$ROLE" = "sentinella" ] || [ "$ROLE" = "assistente" ]; then
  AGENT_DIR="$JHT_AGENTS_DIR/$ROLE"
else
  AGENT_DIR="$JHT_AGENTS_DIR/${ROLE}-${INSTANCE}"
fi
mkdir -p "$AGENT_DIR"

# ── File d'identità per l'agente ──────────────────────────────────────────────
# Convenzione per provider:
#   - Claude Code legge CLAUDE.md
#   - Codex + Kimi leggono AGENTS.md (standard OpenAI / Moonshot)
# Il contenuto è identico, cambia solo il nome del file.
case "$PROVIDER" in
  ""|anthropic|claude) IDENTITY_FILE="CLAUDE.md" ;;
  *)                   IDENTITY_FILE="AGENTS.md" ;;
esac
IDENTITY_DEST="$AGENT_DIR/$IDENTITY_FILE"
TEMPLATE="$REPO_ROOT/agents/$ROLE/$ROLE.md"

if [ ! -f "$TEMPLATE" ] && [ ! -f "$IDENTITY_DEST" ]; then
  echo "Errore: template $TEMPLATE non trovato e $IDENTITY_FILE non esiste in $AGENT_DIR."
  echo "Crea agents/$ROLE/$ROLE.md nel repo oppure $IDENTITY_DEST manualmente."
  exit 1
fi
# Copia il template se:
#   (a) il file runtime non esiste ancora, oppure
#   (b) il template nel repo è più recente (commit aggiornato) → sync
#       così le modifiche al prompt fatte nel repo arrivano a ogni
#       spawn, senza dover wipare $JHT_HOME/agents a mano.
if [ -f "$TEMPLATE" ] && { [ ! -f "$IDENTITY_DEST" ] || [ "$TEMPLATE" -nt "$IDENTITY_DEST" ]; }; then
  cp "$TEMPLATE" "$IDENTITY_DEST"
  echo "  → $IDENTITY_FILE sincronizzato da template ($ROLE.md)"
fi

# ── Avvia agente ─────────────────────────────────────────────────────────────
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Sessione '$SESSION' già attiva."
  echo "Connettiti con: tmux attach -t \"$SESSION\""
  exit 0
fi

FULL_CMD="${CLI_ENV_PREFIX}${CLI_BIN}${CLI_ARGS:+ $CLI_ARGS}"

send_env_vars() {
  # Inside the JHT container a fresh tmux bash resets HOME to the OS
  # default (/home/jht, from /etc/passwd) — but the CLI credential
  # files live under /jht_home (the bind-mounted ~/.jht from the
  # host). Without this override, kimi/claude/codex would report
  # "not logged in" even when the user authed successfully.
  #
  # Nota: esportiamo SEMPRE HOME (senza il guard `$JHT_HOME != $HOME`
  # che prima saltava il send-keys quando il caller aveva già HOME
  # settato a $JHT_HOME). Motivo: quando il Capitano — che gira dentro
  # una tmux dove HOME è già /jht_home — invoca start-agent.sh per
  # spawnare un agente figlio, la nuova tmux parte con una bash fresca
  # che legge /etc/passwd → HOME torna a /home/jht. Senza l'export,
  # kimi/claude del nuovo agente cercano le credenziali nel posto
  # sbagliato e chiedono di rifare il login device.
  if [ -d "${JHT_HOME:-}" ]; then
    tmux send-keys -t "$SESSION" "export HOME='$JHT_HOME'" C-m
  fi
  # Propagate our PATH into the tmux pane: a fresh interactive bash
  # re-reads /etc/profile and ~/.bashrc which can clobber the PATH
  # that docker's ENV set (e.g. /jht_home/.npm-global/bin where kimi
  # lives after uv tool install). Re-exporting here guarantees the
  # CLI binary resolves.
  # Prepend /app/agents/_tools: contiene wrapper come `jht-send` che
  # gli agenti usano per interagire con l'UI web senza toccare JSON/shell
  # quoting a mano. Da lì scriviamo chat.jsonl in modo sicuro.
  AGENT_TOOLS_DIR="/app/agents/_tools"
  tmux send-keys -t "$SESSION" "export PATH='${AGENT_TOOLS_DIR}:$PATH'" C-m
  tmux send-keys -t "$SESSION" "export JHT_HOME='$JHT_HOME'" C-m
  tmux send-keys -t "$SESSION" "export JHT_USER_DIR='$JHT_USER_DIR'" C-m
  tmux send-keys -t "$SESSION" "export JHT_DB='$JHT_DB'" C-m
  tmux send-keys -t "$SESSION" "export JHT_CONFIG='$JHT_CONFIG'" C-m
  tmux send-keys -t "$SESSION" "export JHT_AGENT_DIR='$AGENT_DIR'" C-m
}

# Rileva se siamo in WSL nativo (non dentro un container Docker Desktop, che
# condivide il kernel WSL2 ma non ha wslpath/powershell.exe): in WSL la CLI
# Claude è un binario Windows e va lanciata via PowerShell.
if [ "${IS_CONTAINER:-0}" != "1" ] && grep -qi microsoft /proc/version 2>/dev/null; then
  WIN_AGENT_DIR=$(wslpath -w "$AGENT_DIR")
  tmux new-session -d -s "$SESSION" powershell.exe
  sleep 2
  tmux send-keys -t "$SESSION" "Set-Location '${WIN_AGENT_DIR}'" Enter
  sleep 1
  tmux send-keys -t "$SESSION" "\$env:JHT_HOME='$JHT_HOME'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_USER_DIR='$JHT_USER_DIR'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_DB='$JHT_DB'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_CONFIG='$JHT_CONFIG'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_AGENT_DIR='$AGENT_DIR'" Enter
  tmux send-keys -t "$SESSION" "$FULL_CMD" Enter
  # Auto-accept workspace trust dialog ("Yes, I trust" è già selezionato, basta Enter)
  sleep 8
  tmux send-keys -t "$SESSION" Enter
else
  tmux new-session -d -s "$SESSION" -c "$AGENT_DIR"
  send_env_vars
  tmux send-keys -t "$SESSION" "$FULL_CMD" C-m
  # Auto-accept any first-launch trust / approval dialog the CLI
  # might show. Each provider has its own "skip permissions" flag
  # (claude --dangerously-skip-permissions, kimi --yolo) so in the
  # steady state these Enters hit an empty prompt and are harmless,
  # but when the CLI *does* pop up a "do you trust this dir?" modal
  # on very first run we want to push through it without waiting
  # for the user.
  # setsid scollega dalla sessione/process-group di chi ha chiamato
  # start-agent.sh: senza, quando start-agent.sh esce il suo caller
  # (Node.js del backend web) manda SIGTERM al process group e ammazza
  # la subshell prima che lo sleep finisca.
  setsid sh -c '
    sleep 3  && tmux send-keys -t "'"$SESSION"'" Enter
    sleep 3  && tmux send-keys -t "'"$SESSION"'" Enter
    sleep 3  && tmux send-keys -t "'"$SESSION"'" Enter
  ' >/dev/null 2>&1 < /dev/null &
fi

echo "✓ $SESSION avviato (cli: $CLI_BIN, provider: ${PROVIDER:-claude}, auth: ${AUTH_METHOD:-subscription}, effort: $effort, mode: $MODE)"
echo "  Agent dir:    $AGENT_DIR"
echo "  JHT_USER_DIR: $JHT_USER_DIR"
echo "  Connettiti con: tmux attach -t \"$SESSION\""

# ── Prompt di avvio per l'assistente ─────────────────────────────────────────
# Solo per role=assistente: dopo che il CLI è pronto, inietta un trigger che
# fa scrivere al modello il primo messaggio di benvenuto nel chat.jsonl.
# Gli altri ruoli (capitano / scout / ecc.) ricevono istruzioni dal Capitano.
# ── Kick-off per il Capitano ────────────────────────────────────────────────
# Dopo start-agent.sh il CLI e' bootato ma l'agente sta fermo in attesa di
# input. Il bottone "Avvia team" nella UI web ora delega anche il primo ordine
# al Capitano: senza questo kick-off, il Comandante deve andare sul pane tmux
# CAPITANO e dargli manualmente l'avvio.
if [ "$ROLE" = "capitano" ]; then
  setsid sh -c '
    sleep 15
    tmux send-keys -t "'"$SESSION"'" -l "[@utente -> @capitano] [MSG] Il team e stato avviato dal Comandante. Inizia subito il tuo loop operativo: (1) leggi $JHT_HOME/profile/candidate_profile.yml per sapere chi e il candidato, (2) python3 /app/shared/skills/db_query.py dashboard per vedere lo stato DB, (3) spawn SCOUT-1 e ANALISTA-1 con /app/.launcher/start-agent.sh e dagli kick-off via jht-tmux-send, (4) scala gradualmente gli altri agenti (SCORER, SCRITTORE, CRITICO) secondo le soglie del tuo prompt. La Sentinella e gia attiva con tick ogni 10 min e ti avvisera se il consumo si alza."
    sleep 3
    tmux send-keys -t "'"$SESSION"'" Enter
    sleep 2
    tmux send-keys -t "'"$SESSION"'" Enter
  ' >/dev/null 2>&1 < /dev/null &
fi

if [ "$ROLE" = "assistente" ]; then
  # setsid: idem come sopra (survive al parent exit). Senza, la sleep 15
  # viene killata dal backend quando start-agent.sh esce, e il messaggio
  # di welcome non parte mai.
  setsid sh -c '
    sleep 15
    # Le TUI Ink (Codex / Kimi) non "vedono" l'\''Enter se arriva troppo
    # vicino al testo: il testo va inviato letterale con -l, poi una
    # pausa, poi l'\''Enter in una chiamata separata. Double-Enter idempotente
    # nel caso il primo venga perso o serva chiudere un trust-modal.
    tmux send-keys -t "'"$SESSION"'" -l "[@utente -> @assistente] [CHAT] (avvio) Presentati seguendo il flusso CV-first descritto nel tuo prompt: offri le due modalità (caricamento documenti con estrazione automatica, oppure domande guidate via chat/voce), NON fare domande finché l'\''utente non sceglie o allega qualcosa."
    sleep 3
    tmux send-keys -t "'"$SESSION"'" Enter
    sleep 2
    tmux send-keys -t "'"$SESSION"'" Enter
  ' >/dev/null 2>&1 < /dev/null &
fi

# ── Sentinella: worker CLI + ticker in background ────────────────────────────
# La Sentinella lavora in pattern "Vigil":
#   1. resta in attesa silenziosa del [TICK HH:MM] dal ticker esterno
#   2. al tick, polla SENTINELLA-WORKER (stesso CLI del provider attivo) con
#      /status (codex) o /usage (claude/kimi), parsa, logga, alerta
# Spawniamo il worker (stesso provider, stesso FULL_CMD) e il ticker Python
# in background via setsid così sopravvivono al parent exit del launcher.
if [ "$ROLE" = "sentinella" ]; then
  WORKER_SESSION="SENTINELLA-WORKER"
  # Worker: stessa CLI, nessun kick-off (resta lì a ricevere /status su keypress)
  if ! tmux has-session -t "$WORKER_SESSION" 2>/dev/null; then
    tmux new-session -d -s "$WORKER_SESSION" -c "$JHT_HOME"
    if [ -d "${JHT_HOME:-}" ]; then
      tmux send-keys -t "$WORKER_SESSION" "export HOME='$JHT_HOME'" C-m
    fi
    tmux send-keys -t "$WORKER_SESSION" "export PATH='/app/agents/_tools:/jht_home/.npm-global/bin:$PATH'" C-m
    tmux send-keys -t "$WORKER_SESSION" "$FULL_CMD" C-m
    # Auto-accept trust dialog dopo boot CLI
    setsid sh -c '
      sleep 3  && tmux send-keys -t "'"$WORKER_SESSION"'" Enter
      sleep 3  && tmux send-keys -t "'"$WORKER_SESSION"'" Enter
      sleep 3  && tmux send-keys -t "'"$WORKER_SESSION"'" Enter
    ' >/dev/null 2>&1 < /dev/null &
    echo "✓ $WORKER_SESSION avviato (worker per polling /status o /usage)"
  fi

  # Ticker: heartbeat esterno. Intervallo letto da JHT_TICK_INTERVAL
  # (env var, in minuti). Default nel Python script = 5.
  TICKER_SCRIPT="/app/.launcher/sentinel-ticker.py"
  if [ -x "$TICKER_SCRIPT" ]; then
    setsid sh -c "
      sleep 30
      JHT_SENTINEL_SESSION='$SESSION' JHT_TICK_INTERVAL='${JHT_TICK_INTERVAL:-5}' \
        python3 -u $TICKER_SCRIPT >> /tmp/sentinel-ticker.log 2>&1
    " >/dev/null 2>&1 < /dev/null &
    echo "  → ticker partito (intervallo: ${JHT_TICK_INTERVAL:-5} min, log /tmp/sentinel-ticker.log)"
  else
    echo "  ⚠ $TICKER_SCRIPT non eseguibile — ticker NON partito"
  fi
fi

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
source "$DEV_TEAM_DIR/tui-helpers.sh"

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

# ── Worker sentinel (fallback /usage per bridge) ─────────────────────
# Short-circuit per un ruolo speciale "worker": spawna una sessione
# SENTINELLA-WORKER con un claude CLI idle, da interrogare col comando
# /usage quando l'HTTP /api/oauth/usage di Anthropic e' 429. Non e' un
# agente del team: niente template, niente profile sync, niente kickoff,
# niente bridge. Singleton: se gia' viva, exit 0 senza errori.
if [ "$ROLE" = "worker" ]; then
  WORKER_SESSION="${JHT_SENTINEL_WORKER:-SENTINELLA-WORKER}"
  if tmux has-session -t "$WORKER_SESSION" 2>/dev/null; then
    echo "✓ $WORKER_SESSION gia' attivo"
    exit 0
  fi
  : "${JHT_HOME:=/jht_home}"
  tmux new-session -d -x 220 -y 50 -s "$WORKER_SESSION" -c "$JHT_HOME"
  tmux send-keys -t "$WORKER_SESSION" "export HOME='$JHT_HOME'" C-m
  tmux send-keys -t "$WORKER_SESSION" "export PATH='/app/agents/_tools:/jht_home/.npm-global/bin:\$PATH'" C-m
  tmux send-keys -t "$WORKER_SESSION" "claude --dangerously-skip-permissions" C-m
  # Auto-accept trust dialog × 3 (safety net: se il CLI e' gia' trusted
  # le Enter extra sono innocue; se chiede il prompt, rispondiamo).
  setsid sh -c "
    sleep 3  && tmux send-keys -t '$WORKER_SESSION' Enter
    sleep 3  && tmux send-keys -t '$WORKER_SESSION' Enter
    sleep 3  && tmux send-keys -t '$WORKER_SESSION' Enter
  " >/dev/null 2>&1 < /dev/null &
  echo "✓ $WORKER_SESSION avviato (fallback /usage TUI per bridge)"
  exit 0
fi

# ── Bridge sentinel (V5: ruolo dedicato, non più appiccicato al capitano) ──
# Short-circuit per "bridge": spawna il sentinel-bridge.py in background.
# Non è una sessione tmux, è un processo Python detached. Singleton: killa
# eventuali bridge preesistenti prima di spawnarne uno nuovo (bug storico:
# ogni restart del Capitano accumulava un bridge in più).
#
# Lanciato dopo che CAPITANO e SENTINELLA sono già partiti e stabili, così
# il primo [BRIDGE TICK] arriva alla SENTINELLA che è già pronta a riceverlo.
if [ "$ROLE" = "bridge" ]; then
  BRIDGE_SCRIPT="/app/.launcher/sentinel-bridge.py"
  if [ ! -f "$BRIDGE_SCRIPT" ]; then
    echo "✗ $BRIDGE_SCRIPT non trovato — bridge NON partito"
    exit 1
  fi
  # Kill bridge preesistenti via /proc/*/cmdline (pkill non è installato
  # nell'immagine busybox slim). Matching su 'sentinel-bridge.py' copre
  # setsid wrapper + python + eventuali figli.
  for _pid in $(grep -l sentinel-bridge.py /proc/[0-9]*/cmdline 2>/dev/null | sed 's|/proc/||;s|/cmdline||'); do
    kill "$_pid" 2>/dev/null || true
  done
  sleep 1
  setsid sh -c "
    JHT_TARGET_SESSION='${JHT_TARGET_SESSION:-CAPITANO}' \
      python3 -u $BRIDGE_SCRIPT >> /tmp/sentinel-bridge.log 2>&1
  " >/dev/null 2>&1 < /dev/null &
  echo "✓ sentinel-bridge partito (target=${JHT_TARGET_SESSION:-CAPITANO}, log /tmp/sentinel-bridge.log)"
  exit 0
fi

# Mappa ruolo → prefisso sessione | effort | model
# model: "" = default del provider (Opus per claude, gpt-5.4 per codex,
#   kimi-for-coding per kimi). Altrimenti alias come "sonnet" o nome
#   completo, passato come --model al CLI claude. Per codex/kimi il
#   model override non e' ancora cablato (aggiungere quando serve).
#
# Scelta modelli:
#   - Assistente: Sonnet high — chat conversazionale con utente,
#     non serve reasoning pesante ma serve reattivita'; Sonnet costa
#     meno di Opus e un effort high compensa il gap di capability
#   - Tutti gli altri: default del provider (Opus su claude), effort per
#     ruolo calibrato (coordinatori/spawn high, scorer medium)
#
# Nota: il ruolo "sentinella" e' stato reintrodotto come watchdog leggero
# (2026-04-25). Il monitoraggio principale del rate-limit resta del
# bridge deterministico (.launcher/sentinel-bridge.py); la sentinella LLM
# e' un livello di sicurezza sopra che interviene quando il bridge fallisce
# o serve un check fresco indipendente. Vedi agents/sentinella/sentinella.md
# per il loop e le regole. Una sola istanza, polling 10 min, sonnet.
get_agent_info() {
  case "$1" in
    # Opus high — task con reasoning pesante:
    # Capitano (coordinatore team), Scrittore (creative writing CV),
    # Critico (review di qualita' richiede nuance).
    capitano)   echo "CAPITANO|high|" ;;
    scrittore)  echo "SCRITTORE|high|" ;;
    critico)    echo "CRITICO|high|" ;;
    # Sonnet high — task I/O-bound, parsing, matching:
    # piu' veloce, costa meno, effort high compensa.
    scout)      echo "SCOUT|high|sonnet" ;;
    analista)   echo "ANALISTA|high|sonnet" ;;
    scorer)     echo "SCORER|high|sonnet" ;;
    assistente) echo "ASSISTENTE|high|sonnet" ;;
    # Sonnet (no high) — watchdog: logica if-then semplice, non serve
    # reasoning profondo. Riduce il costo del polling 10-min sostenuto.
    sentinella) echo "SENTINELLA|medium|sonnet" ;;
    *)          echo "" ;;
  esac
}

AGENT_INFO=$(get_agent_info "$ROLE")

if [ -z "$AGENT_INFO" ]; then
  echo "Errore: ruolo '$ROLE' non riconosciuto."
  echo "Ruoli validi: capitano, scout, analista, scorer, scrittore, critico, sentinella, assistente"
  exit 1
fi

IFS='|' read -r session_prefix effort model_override <<< "$AGENT_INFO"

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
    # Override modello per ruoli con model_override settato (es.
    # sentinella/assistente su sonnet). Default account Claude = opus.
    if [ -n "$model_override" ]; then
      CLI_ARGS="$CLI_ARGS --model $model_override"
    fi
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
    # -c model_reasoning_effort=<effort> applica il livello di reasoning
    # per ruolo (default del config.toml e' "medium"): capitano/scout/
    # analista/scrittore/critico vanno su "high", scorer/assistente
    # restano "medium". Codex non ha un --effort flag; si passa via -c.
    CLI_ARGS="--yolo -c model_reasoning_effort=$effort"
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

# ── Soppressione auto-update interattivo di kimi ─────────────────────────────
# Kimi CLI mostra un blocking gate TUI "kimi-cli update available" con default
# Enter = "Upgrade now" che esegue `uv tool upgrade kimi-cli` e poi sys.exit.
# Stessa dinamica di codex: il nostro Enter auto-accept (anche dopo verify)
# trigga l'update che su NTFS/WSL2 bind-mount fallisce, kimi esce → sessione
# cade sulla shell. Il binario espone una env var ufficiale: settandola il
# gate viene saltato interamente. Applicata per tutti gli agenti (l'env var
# è innocua anche quando kimi non è il provider attivo).
export KIMI_CLI_NO_AUTO_UPDATE=1

# ── Soppressione auto-update interattivo di codex ────────────────────────────
# Codex mostra un prompt TUI "Update now / Skip / Skip until next version"
# quando rileva una versione più recente, con "Update now" selezionato di
# default. Gli auto-Enter che mandiamo per chiudere il trust-dialog finiscono
# sul prompt update, codex lancia `npm install -g @openai/codex` che fallisce
# con EACCES durante il rename() atomico su bind-mount NTFS/WSL2 (rename di
# @openai/codex mentre il binario è in uso non è supportato), exit 243 →
# sessione tmux torna al prompt shell, agente risulta "online" ma morto.
#
# Fix: settiamo dismissed_version = latest_version in $JHT_HOME/.codex/
# version.json prima del launch. Chiave confermata guardando le stringhe del
# binario Rust (dismissed_version accanto a latest_version/last_checked_at).
if [ "$CLI_BIN" = "codex" ]; then
  CODEX_VERSION_FILE="${JHT_HOME:-/jht_home}/.codex/version.json"
  if [ -f "$CODEX_VERSION_FILE" ] && command -v python3 &>/dev/null; then
    python3 - "$CODEX_VERSION_FILE" <<'PYEOF' || true
import json, sys
p = sys.argv[1]
try:
    with open(p) as f:
        data = json.load(f)
    latest = data.get("latest_version")
    if latest and data.get("dismissed_version") != latest:
        data["dismissed_version"] = latest
        with open(p, "w") as f:
            json.dump(data, f)
except Exception:
    pass
PYEOF
  fi
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
  # KIMI_CLI_NO_AUTO_UPDATE disabilita il blocking gate di kimi. Lo
  # esportiamo sempre (anche quando il provider non è kimi) perché è
  # innocuo se il binario non lo legge.
  tmux send-keys -t "$SESSION" "export KIMI_CLI_NO_AUTO_UPDATE=1" C-m
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
  tmux new-session -d -x 220 -y 50 -s "$SESSION" powershell.exe
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
  # -x/-y: dimensioni pane senza client attaccato. Di default tmux usa
  # 80x24 quando la sessione è detached, e capture-pane restituisce output
  # troncato a 80 colonne — leggibilità terribile nella webUI. 220x50 dà
  # margine per dashboard / task lists del CLI senza esagerare con i byte
  # da leggere a ogni tick.
  tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"
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

# ── Kick-off Capitano / Assistente ──────────────────────────────────────────
# Dopo start-agent.sh il CLI e' bootato ma l'agente sta fermo in attesa di
# input. Il Capitano riceve l'ordine di avvio pipeline; l'Assistente riceve
# il prompt di presentazione CV-first.
#
# Detection di readiness: tui_wait_ready (idle-diff) — cerca un pane che
# rimane identico per 3s, invariante universale cross-provider (Claude /
# Codex / Kimi). Non dipende da marker hardcoded nei banner, che cambiano
# tra release (es. codex 0.124 ha aggiunto il banner "Tip: GPT-5.5...").
#
# Send: tui_send_verified — dopo il send -l del testo, capture-pane e
# verifica che la signature sia presente PRIMA di spingere Enter. Con 3
# retry recuperiamo i casi in cui la TUI non era davvero ricettiva.
#
# setsid: scolleghiamo dal process-group di start-agent.sh cosi' il parent
# puo' uscire senza killare il sub-shell del kick-off.

_kickoff() {
  local sess="$1"
  local msg="$2"
  # Esportiamo via env var invece di interpolare nella stringa sh -c:
  # i messaggi contengono apostrofi e caratteri speciali che rompono
  # il quoting sh nested. Env var e' trasparente a qualsiasi charset.
  #
  # Log su /tmp/kickoff-<session>.log per troubleshooting: vediamo se
  # il child ha davvero eseguito, se wait_ready e' terminato, se send
  # e' andato a buon fine. Log idempotente, viene sovrascritto ogni
  # volta (conta solo l'ultimo kickoff).
  JHT_KICKOFF_SESS="$sess" JHT_KICKOFF_MSG="$msg" JHT_KICKOFF_LOG="/tmp/kickoff-$sess.log" \
  setsid sh -c '
    exec >"$JHT_KICKOFF_LOG" 2>&1
    echo "[$(date +%H:%M:%S)] kickoff start for $JHT_KICKOFF_SESS"
    . /app/.launcher/tui-helpers.sh
    echo "[$(date +%H:%M:%S)] waiting for ready..."
    if tui_wait_ready "$JHT_KICKOFF_SESS"; then
      echo "[$(date +%H:%M:%S)] ready. sending message (${#JHT_KICKOFF_MSG} chars)..."
      if tui_send_verified "$JHT_KICKOFF_SESS" "$JHT_KICKOFF_MSG"; then
        echo "[$(date +%H:%M:%S)] SENT OK"
      else
        echo "[$(date +%H:%M:%S)] SEND FAILED (retries exhausted)"
      fi
    else
      echo "[$(date +%H:%M:%S)] WAIT_READY TIMEOUT"
    fi
  ' </dev/null &
}

if [ "$ROLE" = "capitano" ]; then
  _msg="[@utente -> @capitano] [MSG] Team avviato dal Comandante. Boot: (1) UN check iniziale con python3 /app/shared/skills/rate_budget.py live per sapere il punto di partenza — se proj>95% NON spawnare; (2) leggi $JHT_HOME/profile/candidate_profile.yml; (3) python3 /app/shared/skills/db_query.py dashboard per stato DB; (4) se budget OK spawn SCOUT-1 (UN solo agente) con /app/.launcher/start-agent.sh + kick-off via /app/agents/_tools/jht-tmux-send. REGOLA D'ORO: 1 SPAWN ALLA VOLTA, POI ASPETTA IL PROSSIMO [BRIDGE TICK] DELLA SENTINELLA (~5 min) PRIMA DI SPAWNARNE UN ALTRO. La Sentinella valuta l'effetto del tuo spawn sull'usage e ti dirà se puoi aggiungere capacità o devi fermarti. Spawnare 5 agenti dopo un singolo ACCELERARE ha causato incident +17% in 5 min e freeze d'emergenza il 2026-04-25 — non ripeterlo. POI BASTA con rate_budget live: il monitoring è della SENTINELLA, lei riceve [BRIDGE TICK] ogni 5 min e ti manda ORDINE concreto, tu esegui. Solo eccezione: ORDINE Sentinella ATTENZIONE/CRITICO/URG/EMERGENZA può richiedere una verifica indipendente prima di applicare throttle pesante (mai entro 2 min dall'ultimo sample)."
  _kickoff "$SESSION" "$_msg"

  # Nota V5: il sentinel-bridge.py NON viene più spawnato qui. È un ruolo
  # separato (`start-agent.sh bridge`) lanciato esplicitamente da
  # /api/team/start-all dopo che CAPITANO e SENTINELLA sono già attivi,
  # per garantire che il primo [BRIDGE TICK] arrivi alla SENTINELLA quando
  # è già pronta a riceverlo. Il SENTINELLA-WORKER (Claude TUI fallback)
  # è creato lazy dalla skill check_usage.py quando serve.
fi

if [ "$ROLE" = "assistente" ]; then
  _msg="[@utente -> @assistente] [CHAT] (avvio) Presentati seguendo il flusso CV-first descritto nel tuo prompt: offri le due modalità (caricamento documenti con estrazione automatica, oppure domande guidate via chat/voce), NON fare domande finché l'utente non sceglie o allega qualcosa."
  _kickoff "$SESSION" "$_msg"
fi

if [ "$ROLE" = "sentinella" ]; then
  # La Sentinella e' un watchdog LLM: senza kick-off resta idle nel CLI.
  # Le diamo solo l'avvio e le ricordiamo le 2 skill, il resto sta nel
  # suo prompt (~/agents/sentinella/AGENTS.md, copiato dal launcher).
  _msg="[@utente -> @sentinella] [MSG] Avvio V5 (watchdog attivo). Leggi il tuo prompt (~/agents/sentinella/AGENTS.md o sentinella.md). Sei l'ORGANO DECISIONALE del throttle: ogni 5 min il bridge ti manda [BRIDGE TICK] col dato (usage/proj/status), tu calcoli velocità smussata su 3 letture, determini stato (CRITICO/ATTENZIONE/OK/SOTTOUTILIZZO) e mandi ORDINE concreto al Capitano con throttle=N (sleep Xs) — mai suggerimenti vaghi. Cooldown 2-tick + bypass emergenza (proj>200%, vel>ideale*5, usage>=90%) → in emergenza esegui freeze_team.py PRIMA della notifica. NIENTE sleep/loop. Aspetta il primo [BRIDGE TICK]."
  _kickoff "$SESSION" "$_msg"
fi


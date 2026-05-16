#!/usr/bin/env bash
# agent-watchdog.sh — controlla che le 3 sessioni tmux user-facing
# (ASSISTENTE, CAPITANO, MENTOR) siano sempre attive. Se una manca,
# la rilancia via `jht team start <role>`.
#
# Pensato come daemon spawnato da pid1 al boot del container. NON
# sostituisce il dottore (LLM ogni 30min, analisi alto livello), copre
# solo il caso "session tmux morta o non partita".
#
# Loop interval: 30s (configurable via env JHT_AGENT_WATCHDOG_INTERVAL).
# Idempotente: `jht team start` skippa session già attive.
# Failure mode: log + retry al prossimo tick, non fail-fast.
#
# Trigger gate: parte solo se ci sono bot Telegram configurati E
# active_provider settato in jht.config.json. Senza, gli agenti non
# possono partire — niente loop spazzatura.

set -u

JHT_HOME="${JHT_HOME:-/jht_home}"
CONFIG="$JHT_HOME/jht.config.json"
JHT_BIN="/app/cli/bin/jht.js"
INTERVAL_SEC="${JHT_AGENT_WATCHDOG_INTERVAL:-30}"
LOG="$JHT_HOME/logs/agent-watchdog.log"
AGENTS=(assistente capitano mentor)

mkdir -p "$(dirname "$LOG")"

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] $*" | tee -a "$LOG"
}

config_ready() {
  # active_provider + almeno 1 bot Telegram con bot_token.
  python3 - "$CONFIG" 2>/dev/null <<'PYEOF'
import json, sys
try:
  d = json.load(open(sys.argv[1]))
except Exception:
  sys.exit(1)
prov = (d.get('active_provider') or '').strip()
bots = (d.get('channels') or {}).get('telegram', {}).get('bots') or {}
has_bot = any((b or {}).get('bot_token','').strip() for b in bots.values())
sys.exit(0 if (prov and has_bot) else 1)
PYEOF
}

is_session_alive() {
  tmux has-session -t "$1" 2>/dev/null
}

ensure_agent() {
  local role="$1"
  local session
  session="$(echo "$role" | tr '[:lower:]' '[:upper:]')"
  if is_session_alive "$session"; then
    return 0
  fi
  log "agent $role: session $session non attiva — relancio via jht team start"
  if /usr/local/bin/node "$JHT_BIN" team start "$role" >>"$LOG" 2>&1; then
    log "agent $role: start OK"
  else
    log "agent $role: start FAIL (rc=$?) — riprovo al prossimo tick"
  fi
}

log "watchdog start · interval=${INTERVAL_SEC}s · agents=${AGENTS[*]}"

# Loop principale: gate sulla config (può non essere ancora pronta al
# primo boot del container — il wizard la scrive post-pairing). Sleep
# tra un tick e l'altro anche quando non facciamo niente: non vogliamo
# saturare CPU.
trap 'log "watchdog shutdown (SIGTERM)"; exit 0' TERM INT

while true; do
  if config_ready; then
    for role in "${AGENTS[@]}"; do
      ensure_agent "$role"
    done
  else
    # Soft log: config non pronta = wizard non ancora finito. Aspettiamo
    # silenziosamente, niente spam.
    :
  fi
  sleep "$INTERVAL_SEC"
done

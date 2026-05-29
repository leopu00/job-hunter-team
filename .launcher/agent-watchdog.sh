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
  # active_provider + almeno 1 bot Telegram con bot_token + credenziali
  # OAuth del provider presenti (es. kimi.json scritto da `kimi --yolo`
  # post-OAuth). Senza credenziali, l'agente parte ma kimi mostra "LLM
  # not set" e resta inutilizzabile (visto 2026-05-16 in cold fresh test).
  python3 - "$CONFIG" "$JHT_HOME" 2>/dev/null <<'PYEOF'
import json, os, sys
cfg_path, jht_home = sys.argv[1], sys.argv[2]
try:
  d = json.load(open(cfg_path))
except Exception:
  sys.exit(1)
prov = (d.get('active_provider') or '').strip().lower()
bots = (d.get('channels') or {}).get('telegram', {}).get('bots') or {}
has_bot = any((b or {}).get('bot_token','').strip() for b in bots.values())
markers = {
  'kimi':   f'{jht_home}/.kimi/kimi.json',
  'claude': f'{jht_home}/.claude/.credentials.json',
  'codex':  f'{jht_home}/.codex/auth.json',
}
has_creds = bool(prov) and os.path.exists(markers.get(prov, ''))
sys.exit(0 if (prov and has_bot and has_creds) else 1)
PYEOF
}

is_session_alive() {
  # Bug 2026-05-18 (post-mortem capitano-zombie-night): tmux has-session
  # ritornava 0 anche quando il process LLM dentro al pane era morto
  # (kimi crashato, pane ridotto a bash idle). 11h di silent watchdog
  # mentre il Capitano era zombie e l'utente attendeva risposta.
  #
  # Fix: verifica anche pane_current_command. Se non è un LLM CLI noto
  # (kimi/Kimi/claude/codex/node/python/python3), la sessione è zombie
  # e va riavviata. La whitelist include 'node'/'python*' per
  # supportare CLI custom che usano runtime di base (rare ma possibili).
  local session="$1"
  tmux has-session -t "$session" 2>/dev/null || return 1
  local cmd
  cmd=$(tmux list-panes -t "$session" -F '#{pane_current_command}' 2>/dev/null | head -1)
  case "$cmd" in
    [Kk]imi|claude|Claude|codex|Codex|node|python|python3) return 0 ;;
    *)
      # Zombie: kill+rispawn al prossimo ensure_agent. Log a basso volume
      # qui per audit, il messaggio "session zombie — killing" è loud
      # apposta perché è un evento raro che vogliamo notare.
      log "agent $session: ZOMBIE detected (pane_current_command='$cmd') — killing session"
      tmux kill-session -t "$session" 2>/dev/null || true
      return 1
      ;;
  esac
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

TEAM_HALTED_FLAG="$JHT_HOME/.team-halted.flag"
WEEKLY_HALT_FLAG="$JHT_HOME/.weekly-halt.flag"
halt_log_tick=0

while true; do
  # Team-halted gate (set by team-state-reconciler quando user clicca Stop
  # dalla dashboard). Source of truth: team_state.should_run. Quando
  # presente, NIENTE respawn — l'utente ha esplicitamente fermato.
  # Stesso comportamento per .weekly-halt.flag (limite rate budget).
  if [ -e "$TEAM_HALTED_FLAG" ] || [ -e "$WEEKLY_HALT_FLAG" ]; then
    if [ $((halt_log_tick % 20)) -eq 0 ]; then
      if [ -e "$TEAM_HALTED_FLAG" ]; then
        log "halt: .team-halted.flag presente — respawn agenti disabilitato"
      else
        log "halt: .weekly-halt.flag presente — respawn agenti disabilitato"
      fi
    fi
    halt_log_tick=$((halt_log_tick + 1))
    sleep "$INTERVAL_SEC"
    continue
  fi
  if [ "$halt_log_tick" -gt 0 ]; then
    log "halt: flag rimosso — riprendo respawn watchdog"
    halt_log_tick=0
  fi

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

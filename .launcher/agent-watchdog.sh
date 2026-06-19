#!/usr/bin/env bash
# agent-watchdog.sh — controlla che le 4 sessioni tmux core
# (ASSISTENTE, CAPITANO, MENTOR, SENTINELLA) siano sempre attive. Se una
# manca, la rilancia via `jht team start <role>`.
#
# Pensato come daemon spawnato da pid1 al boot del container. NON
# sostituisce il dottore (context-refresh LLM degli agenti CON stato),
# copre il caso "session tmux morta o non partita".
#
# La SENTINELLA ha in più un refresh-per-ETÀ deterministico (vedi
# maybe_refresh_sentinella): è near-stateless — il suo stato operativo vive
# nel bridge/config, non nella sua chat — quindi dopo molte ore il suo
# context window si gonfia e ne degrada il giudizio di pace, e va ricreata
# fresca oltre una soglia. È age-based, NON health-based: non re-introduce
# il restart-loop del vecchio sentinel_health (V4 bug). Gli altri core hanno
# stato e li rinfresca il Dottore (refresh ricco con resume).
#
# Loop interval: 30s (configurable via env JHT_AGENT_WATCHDOG_INTERVAL).
# Idempotente: `jht team start` skippa session già attive.
# Failure mode: log + retry al prossimo tick, non fail-fast.
#
# Trigger gate: parte se active_provider è settato in jht.config.json E
# le credenziali del provider sono presenti. Telegram NON è più richiesto:
# l'interazione è web-first (chat/feedback dalla dashboard), Telegram è un
# canale secondario opzionale. Richiederlo bloccava Capitano/Mentor in
# modalità no-telegram (il watchdog non li spawnava mai → team monco al boot).

set -u

JHT_HOME="${JHT_HOME:-/jht_home}"
CONFIG="$JHT_HOME/jht.config.json"
JHT_BIN="/app/cli/bin/jht.js"
INTERVAL_SEC="${JHT_AGENT_WATCHDOG_INTERVAL:-30}"
LOG="$JHT_HOME/logs/agent-watchdog.log"
AGENTS=(assistente capitano mentor sentinella)
# Soglia (ore) oltre cui la sessione SENTINELLA viene ricreata per ripulire
# il context window accumulato. Refresh deterministico, near-stateless.
SENTINELLA_MAX_CTX_AGE_H="${JHT_SENTINELLA_MAX_CTX_AGE_H:-24}"

mkdir -p "$(dirname "$LOG")"

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] $*" | tee -a "$LOG"
}

config_ready() {
  # active_provider + credenziali OAuth del provider presenti (es. kimi.json
  # scritto da `kimi --yolo` post-OAuth). Senza credenziali, l'agente parte ma
  # mostra "LLM not set" e resta inutilizzabile (visto 2026-05-16 in cold fresh
  # test). Telegram NON è più richiesto (canale secondario opzionale): un bot
  # configurato è solo INFO, non un prerequisito allo spawn.
  python3 - "$CONFIG" "$JHT_HOME" 2>/dev/null <<'PYEOF'
import json, os, sys
cfg_path, jht_home = sys.argv[1], sys.argv[2]
try:
  d = json.load(open(cfg_path))
except Exception:
  sys.exit(1)
prov = (d.get('active_provider') or '').strip().lower()
markers = {
  # kimi-cli 1.47+ scrive le creds in .kimi/credentials/<plan>.json
  # (es. kimi-code.json), non piu' .kimi/kimi.json (allineato a sentinel-bridge).
  'kimi':   f'{jht_home}/.kimi/credentials/kimi-code.json',
  'claude': f'{jht_home}/.claude/.credentials.json',
  'codex':  f'{jht_home}/.codex/auth.json',
}
has_creds = bool(prov) and os.path.exists(markers.get(prov, ''))
sys.exit(0 if (prov and has_creds) else 1)
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

session_age_h() {
  # Età della sessione tmux in ore intere (now - session_created).
  local session="$1" created now
  created=$(tmux display-message -p -t "$session" '#{session_created}' 2>/dev/null) || return 1
  [ -z "$created" ] && return 1
  now=$(date -u +%s)
  echo $(( (now - created) / 3600 ))
}

maybe_refresh_sentinella() {
  # Refresh-per-ETÀ della SENTINELLA: near-stateless (stato nel bridge/config,
  # non nella chat) → un context window vecchio di ore le fa "sbagliare" il
  # giudizio di pace. Oltre la soglia la si ricrea fresca. age-based (NON
  # health-based) → niente restart-loop V4. Killa qui: ensure_agent la ricrea
  # nello stesso tick (subito sotto nel loop). Gli ALTRI core li rinfresca il
  # Dottore (refresh ricco). Qui solo lei.
  is_session_alive SENTINELLA || return 0   # se non viva, la (ri)crea ensure_agent
  # Niente refresh fuori orario lavorativo: ricreare ora sprecherebbe un
  # kick-off LLM di notte (allineato alla regola "no LLM fuori finestra").
  python3 -c "import sys; sys.path.insert(0,'/app'); from shared.skills.working_hours import is_within_working_hours as f; sys.exit(0 if f() else 1)" 2>/dev/null || return 0
  local age
  age=$(session_age_h SENTINELLA) || return 0
  if [ "$age" -ge "$SENTINELLA_MAX_CTX_AGE_H" ]; then
    log "sentinella: context age ${age}h ≥ ${SENTINELLA_MAX_CTX_AGE_H}h — refresh (kill+recreate) per ripulire il contesto"
    tmux kill-session -t SENTINELLA 2>/dev/null || true
  fi
}

log "watchdog start · interval=${INTERVAL_SEC}s · agents=${AGENTS[*]} · sentinella_max_ctx_age=${SENTINELLA_MAX_CTX_AGE_H}h"

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
    # Refresh-per-età della Sentinella PRIMA del giro di ensure: se è troppo
    # vecchia la killa, poi ensure_agent la ricrea fresca nello stesso tick.
    maybe_refresh_sentinella
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

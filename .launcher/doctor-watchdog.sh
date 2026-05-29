#!/usr/bin/env bash
# doctor-watchdog.sh — loop infinito che spawna un Dottore ogni 30 min.
# Pensato per girare in una sessione tmux dedicata `DOCTOR-WATCHDOG`.
#
# Avvio (una volta sola):
#   tmux new-session -d -s DOCTOR-WATCHDOG \
#     "bash /app/.launcher/doctor-watchdog.sh"
#
# Spegnimento:
#   tmux kill-session -t DOCTOR-WATCHDOG
#
# Robustezza: se spawn-doctor fallisce, logga l'errore e riprova al
# prossimo ciclo. Non muore mai per un singolo fallimento.

set -u
JHT_HOME="${JHT_HOME:-/jht_home}"
LOGS_DIR="$JHT_HOME/logs"
mkdir -p "$LOGS_DIR"

INTERVAL_SEC="${DOCTOR_WATCHDOG_INTERVAL:-7200}"  # 2h default
# Decisione 2026-05-18 (post-mortem capitano-zombie-night): 30 min era
# troppo aggressivo — 20 spawn a vuoto in 11h notturne, ~3-5% budget Kimi
# bruciato per giri vuoti. Con cadenza 2h: 12 spawn/giorno invece di 48.
# Per casi urgenti (es. l'utente chiede "fai partire il dottore"), i
# coordinatori (Capitano/Assistente/Sentinella/Mentor) hanno la skill
# `spawn-doctor` che invoca questo script on-demand.
SPAWNER="/app/.launcher/spawn-doctor.sh"

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] $*" | tee -a "$LOGS_DIR/doctor-watchdog.log"
}

TEAM_HALTED_FLAG="$JHT_HOME/.team-halted.flag"
WEEKLY_HALT_FLAG="$JHT_HOME/.weekly-halt.flag"
halt_log_tick=0

log "watchdog starting · interval=${INTERVAL_SEC}s · spawner=$SPAWNER"

# Spawna IMMEDIATAMENTE al primo giro (non aspettare 30min al boot).
while true; do
  # Team-halted gate: se utente ha cliccato Stop o weekly-halt è attivo,
  # NON spawnare il dottore. Source: team_state.should_run.
  if [ -e "$TEAM_HALTED_FLAG" ] || [ -e "$WEEKLY_HALT_FLAG" ]; then
    if [ $((halt_log_tick % 4)) -eq 0 ]; then
      log "halt flag presente — spawn dottore disabilitato"
    fi
    halt_log_tick=$((halt_log_tick + 1))
    sleep "$INTERVAL_SEC"
    continue
  fi
  if [ "$halt_log_tick" -gt 0 ]; then
    log "halt flag rimosso — riprendo spawn dottore"
    halt_log_tick=0
  fi

  if [ ! -x "$SPAWNER" ] && [ ! -f "$SPAWNER" ]; then
    log "ERROR: spawner non trovato a $SPAWNER — sleep $INTERVAL_SEC e ritento"
  else
    out=$(bash "$SPAWNER" 2>&1) && rc=0 || rc=$?
    if [ "$rc" -eq 0 ]; then
      log "spawn ok: $out"
    else
      log "spawn FAILED rc=$rc: $out"
    fi
  fi
  sleep "$INTERVAL_SEC"
done

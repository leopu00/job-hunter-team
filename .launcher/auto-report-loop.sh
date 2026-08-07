#!/usr/bin/env bash
# auto-report-loop.sh — loop infinito che ogni N minuti tenta un
# auto-report Telegram (panoramica grafica con emoji + PNG pipeline).
#
# Robustezza: se l'invio fallisce (network, Telegram down, config
# mancante), logga e riprova al prossimo ciclo. Non muore mai per un
# singolo fallimento.
#
# Cadenza esterna 5 min; throttle reale gestito dentro auto_report.py
# (JHT_AUTO_REPORT_INTERVAL_MIN=120 default → 1 panoramica ogni 2h).
# Avere il loop a 5 min permette di avere la prima panoramica entro
# 5 min dal boot, senza aspettare 2h.

set -u
JHT_HOME="${JHT_HOME:-/jht_home}"
LOGS_DIR="$JHT_HOME/logs"
mkdir -p "$LOGS_DIR"

LOOP_INTERVAL_SEC="${AUTO_REPORT_LOOP_SEC:-300}"
SKILL="/app/shared/skills/auto_report.py"

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] $*" | tee -a "$LOGS_DIR/auto-report.log"
}

log "auto-report-loop starting · check interval=${LOOP_INTERVAL_SEC}s · skill=$SKILL"

while true; do
  if [ ! -f "$SKILL" ]; then
    log "ERROR: skill not found at $SKILL — retrying in $LOOP_INTERVAL_SEC s"
  else
    out=$(python3 "$SKILL" send 2>&1) && rc=0 || rc=$?
    if [ "$rc" -eq 0 ]; then
      # Non logga ogni 5 min "skip" per non riempire il file. Logga
      # solo quando ha effettivamente inviato.
      if echo "$out" | grep -Eq "auto-report (sent|inviato)"; then
        log "$out"
      fi
    else
      log "auto-report rc=$rc: $out"
    fi
  fi
  sleep "$LOOP_INTERVAL_SEC"
done

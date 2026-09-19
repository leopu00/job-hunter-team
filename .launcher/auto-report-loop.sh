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

# daemon-lib.sh (inerte: solo definizioni) per jht_daemon_log — path del diario
# + rotazione a 5 MB, la stessa soglia di pid1.
JHT_LAUNCHER_DIR="${JHT_LAUNCHER_DIR:-$(cd "$(dirname "$0")" 2>/dev/null && pwd)}"
if [ -f "$JHT_LAUNCHER_DIR/daemon-lib.sh" ]; then
  # shellcheck source=/dev/null
  . "$JHT_LAUNCHER_DIR/daemon-lib.sh"
fi
# Ripiego innocuo: costa la sola rotazione, il path è lo stesso.
if ! command -v jht_daemon_log >/dev/null 2>&1; then
  jht_daemon_log() { printf '%s\n' "$LOGS_DIR/$1"; }
fi

LOOP_INTERVAL_SEC="${AUTO_REPORT_LOOP_SEC:-300}"
SKILL="/app/shared/skills/auto_report.py"

# ── Diario: UN path per scrittore ───────────────────────────────────────────
# Il diario di questo script NON è logs/auto-report.log: quel path è di pid1,
# che cattura la nostra stdout (spawnLabeled('auto-report') in
# cli/src/commands/pid1.js) e la scrive lì con un fd persistente, ruotandolo
# con renameSync. Con `tee -a` sullo stesso path c'erano DUE scrittori: ogni
# riga finiva due volte nello stesso file — byte doppi su un bind mount — e
# appena qualcuno ruota il file mentre il daemon gira, l'fd persistente di pid1
# continua a scrivere sull'inode scollegato, quindi metà del diario diventa
# invisibile.
#
# Un path per scrittore, col `tee` che resta perché è così che la rotazione
# arriva gratis anche da pid1 — come gli altri daemon bash della famiglia:
#   agent-watchdog.sh         → agent-watchdog.log         · pid1 → watchdog.log
#   doctor-watchdog.sh        → doctor-watchdog-loop.log   · pid1 → doctor-watchdog.log
#   pager-unstick-watchdog.sh → pager-unstick-watchdog.log · pid1 → pager-unstick.log
#   questo file               → auto-report-loop.log       · pid1 → auto-report.log
# Nessuna continuità si perde: auto-report.log continua a ricevere le stesse
# righe via stdout, con la rotazione di pid1.
#
# jht_daemon_log ruota solo QUANDO VIENE CHIAMATA, quindi la richiamiamo a ogni
# giro (uno stat ogni 5 minuti): un loop che vive mesi non ruoterebbe mai.
LOG_FILE="$(jht_daemon_log auto-report-loop.log)"

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] $*" | tee -a "$LOG_FILE"
}

log "auto-report-loop starting · check interval=${LOOP_INTERVAL_SEC}s · skill=$SKILL"

while true; do
  # Ricontrollo della soglia di rotazione del diario (vedi il blocco «Diario»).
  LOG_FILE="$(jht_daemon_log auto-report-loop.log)"
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

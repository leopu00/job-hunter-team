#!/usr/bin/env bash
# doctor-watchdog.sh — loop che spawna il Dottore (2×/finestra) e il
# Mantenitore (👷‍♂️ 1x/giorno). Gira in una sessione tmux dedicata `DOCTOR-WATCHDOG`.
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

# Ridisegno 2026-06-13: scheduling 2× per FINESTRA di lavoro (a +30min
# dall'inizio finestra ON e a META' finestra, es. +6h su una notte 20:00-08:00)
# invece di "ogni 2h" cieco. La DECISIONE (siamo a uno slot? quale?) sta in
# shared/skills/doctor_schedule.py (che legge working_hours). Qui: poll + spawn.
# Motivo: il Dottore vecchio era il #1 consumatore (51% burn, 0 check) facendo
# ping liveness ogni 2h — su Kimi = idle-burn storico.
POLL_SEC="${DOCTOR_WATCHDOG_POLL:-300}"               # ricontrolla ogni 5 min
OFF_RECHECK_SEC="${DOCTOR_WATCHDOG_OFF_RECHECK:-900}" # fuori finestra ogni 15 min
FALLBACK_SEC="${DOCTOR_WATCHDOG_FALLBACK:-21600}"     # 24/7 senza finestra: ~ogni 6h
SPAWNER="/app/.launcher/spawn-doctor.sh"
MAINT_SPAWNER="/app/.launcher/spawn-maintainer.sh"   # 👷‍♂️ Mantenitore (1x/giorno)
SCHED="/app/shared/skills/doctor_schedule.py"
# On-demand: i coordinatori (Capitano/Assistente/Sentinella/Mentor) hanno la
# skill `spawn-doctor` per invocare lo spawner fuori dagli slot programmati.

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] $*" | tee -a "$LOGS_DIR/doctor-watchdog.log"
}

TEAM_HALTED_FLAG="$JHT_HOME/.team-halted.flag"
WEEKLY_HALT_FLAG="$JHT_HOME/.weekly-halt.flag"
# Standby a spesa zero ([TEAM-STANDBY-ZERO-SPEND]): un Dottore/Mantenitore
# spawnato in standby è un turno LLM speso mentre il team è fermo di proposito.
TEAM_STANDBY_FLAG="$JHT_HOME/.team-standby.flag"
STANDBY_PY="${JHT_STANDBY_PY:-/app/shared/skills/standby.py}"
[ -f "$STANDBY_PY" ] || STANDBY_PY="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)/shared/skills/standby.py"

# Standby ATTIVO adesso? Stesso predicato unico degli altri respawner
# ([STANDBY-EXPIRY-IGNORED-BY-RESPAWNERS]): un flag SCADUTO non è più standby,
# e continuare a gatarci sopra terrebbe Dottore e Mantenitore spenti per
# sempre se chi doveva rimuoverlo è morto. Fail-CLOSED: qualunque esito non
# riconosciuto (python assente, modulo rotto) ricade sul solo
# `[ -e "$TEAM_STANDBY_FLAG" ]`, mai su «non in standby».
standby_active() {
  [ -e "$TEAM_STANDBY_FLAG" ] || return 1
  local state
  state="$(JHT_HOME="$JHT_HOME" python3 "$STANDBY_PY" active 2>/dev/null)"
  case "$state" in
    active)              return 0 ;;
    expired|invalid|off) return 1 ;;
    *)                   return 0 ;;   # fallback: il flag c'è → standby
  esac
}

# Stesso gate di agent-watchdog.sh: Doctor e Mantenitore usano il provider LLM
# e non devono partire durante il wizard, quando active_provider può essere già
# scritto ma il login OAuth non è ancora terminato. Senza questo controllo lo
# spawner ricade sul default Claude e produce sessioni fallite e log fuorvianti
# durante una prima installazione pulita.
config_ready() {
  python3 - "$JHT_HOME/jht.config.json" "$JHT_HOME" 2>/dev/null <<'PYEOF'
import json, os, sys
cfg_path, jht_home = sys.argv[1], sys.argv[2]
try:
  data = json.load(open(cfg_path))
except Exception:
  sys.exit(1)
provider = (data.get('active_provider') or '').strip().lower()
markers = {
  'kimi':      f'{jht_home}/.kimi/credentials/kimi-code.json',
  'claude':    f'{jht_home}/.claude/.credentials.json',
  'anthropic': f'{jht_home}/.claude/.credentials.json',
  'codex':     f'{jht_home}/.codex/auth.json',
  'openai':    f'{jht_home}/.codex/auth.json',
}
marker = markers.get(provider, '')
sys.exit(0 if provider and marker and os.path.exists(marker) else 1)
PYEOF
}

halt_log_tick=0
offhours_log_tick=0
config_log_tick=0

log "watchdog starting · Dottore twice/window (+30 min, halfway) + Mantenitore once/day · poll=${POLL_SEC}s · sched=$SCHED"

last_fallback=0
while true; do
  # Il wizard salva il provider prima che il browser completi OAuth. Fino alla
  # comparsa del marker credenziali non consumare turni LLM e non tentare il
  # fallback storico a Claude. Il loop resta vivo e ricontrolla normalmente.
  if ! config_ready; then
    if [ $((config_log_tick % 8)) -eq 0 ]; then
      log "provider not authenticated yet — Dottore/Mantenitore scheduling suspended"
    fi
    config_log_tick=$((config_log_tick + 1))
    sleep "$POLL_SEC"
    continue
  fi
  if [ "$config_log_tick" -gt 0 ]; then
    log "provider authenticated — enabling Dottore/Mantenitore scheduling"
    config_log_tick=0
  fi

  # Team-halted gate: se l'utente ha cliccato Stop, weekly-halt è attivo o il
  # team è in standby a spesa zero, NON spawnare dottore/mantenitore.
  if [ -e "$TEAM_HALTED_FLAG" ] || [ -e "$WEEKLY_HALT_FLAG" ] || standby_active; then
    if [ $((halt_log_tick % 8)) -eq 0 ]; then
      if standby_active; then
        log "standby ACTIVE — Dottore/Mantenitore spawn disabled"
      else
        log "halt flag present — Dottore spawn disabled"
      fi
    fi
    halt_log_tick=$((halt_log_tick + 1))
    sleep "$POLL_SEC"
    continue
  fi
  if [ "$halt_log_tick" -gt 0 ]; then
    log "halt flag removed — resuming Dottore scheduling"
    halt_log_tick=0
  fi

  # 👷‍♂️ Slot MANTENITORE — cadenza GIORNALIERA indipendente dal Dottore (redesign
  # 2026-06-13). check-maintainer ritorna MAINT solo 1x/giorno ed entro working
  # hours (gestisce lui il gate); marchiamo solo su spawn riuscito → ritenta al
  # prossimo poll se fallisce. Stesso halt-gate del Dottore (sopra).
  mslot=$(python3 "$SCHED" check-maintainer 2>/dev/null) || mslot=WAIT
  if [ "$mslot" = "MAINT" ]; then
    if [ ! -f "$MAINT_SPAWNER" ]; then
      log "ERROR: Mantenitore spawner not found at $MAINT_SPAWNER"
    else
      mout=$(bash "$MAINT_SPAWNER" 2>&1) && mrc=0 || mrc=$?
      if [ "$mrc" -eq 0 ]; then
        log "spawn mantenitore ok: $mout"
        python3 "$SCHED" mark-maintainer 2>/dev/null || true
      else
        log "spawn mantenitore FAILED rc=$mrc: $mout"
      fi
    fi
  fi

  # Decisione di scheduling: doctor_schedule.py gestisce GIA' il gate
  # working-hours (ritorna OFF fuori finestra) + gli slot +30min / metà.
  # Fail-open conservativo: su errore → WAIT (non spawnare a vuoto).
  slot=$(python3 "$SCHED" check 2>/dev/null) || slot=WAIT

  case "$slot" in
    T30|MID)
      if [ ! -f "$SPAWNER" ]; then
        log "ERROR: spawner not found at $SPAWNER"
      else
        out=$(bash "$SPAWNER" 2>&1) && rc=0 || rc=$?
        if [ "$rc" -eq 0 ]; then
          log "spawn ok (slot=$slot): $out"
          python3 "$SCHED" mark "$slot" 2>/dev/null || true
        else
          # Non marchiamo lo slot: ritenta al prossimo poll.
          log "spawn FAILED (slot=$slot) rc=$rc: $out"
        fi
      fi
      sleep "$POLL_SEC"
      ;;
    OFF)
      if [ $((offhours_log_tick % 8)) -eq 0 ]; then
        log "outside working hours — scheduling suspended (actual OFF interval)"
      fi
      offhours_log_tick=$((offhours_log_tick + 1))
      sleep "$OFF_RECHECK_SEC"
      ;;
    NOWINDOW)
      # Team 24/7 (nessuna finestra delimitata): fallback periodico ~ogni 6h.
      offhours_log_tick=0
      now_s=$(date +%s)
      if [ $((now_s - last_fallback)) -ge "$FALLBACK_SEC" ] && [ -f "$SPAWNER" ]; then
        out=$(bash "$SPAWNER" 2>&1) && rc=0 || rc=$?
        if [ "$rc" -eq 0 ]; then log "spawn ok (24/7 fallback): $out"; last_fallback=$now_s
        else log "spawn FAILED (24/7) rc=$rc: $out"; fi
      fi
      sleep "$POLL_SEC"
      ;;
    *)  # WAIT o errore: dentro finestra ma nessuno slot dovuto ora.
      offhours_log_tick=0
      sleep "$POLL_SEC"
      ;;
  esac
done

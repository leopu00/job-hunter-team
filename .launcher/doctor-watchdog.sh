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
# prossimo ciclo. Non muore mai per un singolo fallimento — e nemmeno per un
# fallimento che non finisce: ogni chiamata bloccante del loop (i due spawner e
# gli helper python) ha un tetto di tempo, perché un figlio appeso qui fermava
# il loop per sempre e in silenzio (vedi il blocco «Tetti di tempo» sotto).

set -u
JHT_HOME="${JHT_HOME:-/jht_home}"
LOGS_DIR="$JHT_HOME/logs"
mkdir -p "$LOGS_DIR"

# daemon-lib.sh è inerte (definisce solo funzioni) e serve per jht_timeout:
# `jht_timeout <secondi> <comando...>` è la cascata portabile timeout →
# gtimeout → comando nudo (rc propagato, 124 = scaduto), perché `timeout` è
# GNU coreutils e su un host macOS non esiste.
JHT_LAUNCHER_DIR="${JHT_LAUNCHER_DIR:-$(cd "$(dirname "$0")" 2>/dev/null && pwd)}"
if [ -f "$JHT_LAUNCHER_DIR/daemon-lib.sh" ]; then
  # shellcheck source=/dev/null
  . "$JHT_LAUNCHER_DIR/daemon-lib.sh"
fi
# Compatibilità con un daemon-lib.sh che non espone (ancora) jht_timeout:
# uscire con rc=127 qui significherebbe «né Dottore né Mantenitore, mai», cioè
# peggio del guasto che i tetti chiudono. Si degrada all'ultimo ramo della
# stessa cascata — comando NON limitato — e lo si dice a voce alta nel diario
# (vedi il log di avvio): una degradazione silenziosa è esattamente il difetto
# che questo file sta correggendo. Da togliere quando jht_timeout è in
# daemon-lib.sh su tutti i rami.
TIME_BOUNDS_OK=1
if ! command -v jht_timeout >/dev/null 2>&1; then
  TIME_BOUNDS_OK=0
  jht_timeout() { shift; "$@"; }
fi
# jht_daemon_log (path del diario sotto $JHT_HOME/logs + rotazione a 5 MB) sta
# nello stesso file: senza di essa il diario resta dov'è, solo senza rotazione.
if ! command -v jht_daemon_log >/dev/null 2>&1; then
  jht_daemon_log() { printf '%s\n' "$LOGS_DIR/$1"; }
fi

# Ridisegno 2026-06-13: scheduling 2× per FINESTRA di lavoro (a +30min
# dall'inizio finestra ON e a META' finestra, es. +6h su una notte 20:00-08:00)
# invece di "ogni 2h" cieco. La DECISIONE (siamo a uno slot? quale?) sta in
# shared/skills/doctor_schedule.py (che legge working_hours). Qui: poll + spawn.
# Motivo: il Dottore vecchio era il #1 consumatore (51% burn, 0 check) facendo
# ping liveness ogni 2h — su Kimi = idle-burn storico.
POLL_SEC="${DOCTOR_WATCHDOG_POLL:-300}"               # ricontrolla ogni 5 min
OFF_RECHECK_SEC="${DOCTOR_WATCHDOG_OFF_RECHECK:-900}" # fuori finestra ogni 15 min
FALLBACK_SEC="${DOCTOR_WATCHDOG_FALLBACK:-21600}"     # 24/7 senza finestra: ~ogni 6h
SPAWNER="${JHT_DOCTOR_SPAWNER:-/app/.launcher/spawn-doctor.sh}"
MAINT_SPAWNER="${JHT_MAINT_SPAWNER:-/app/.launcher/spawn-maintainer.sh}" # 👷‍♂️ 1x/giorno
SCHED="${JHT_DOCTOR_SCHED:-/app/shared/skills/doctor_schedule.py}"
# Test seam: zero significa daemon infinito (produzione). Un valore positivo
# chiude dopo N cicli completi, così il contratto runtime si esercita senza tmux
# o processi LLM e senza usare timeout che nascondono loop inattesi.
MAX_TICKS="${JHT_DOCTOR_WATCHDOG_MAX_TICKS:-0}"
tick_count=0
# On-demand: i coordinatori (Capitano/Assistente/Sentinella/Mentor) hanno la
# skill `spawn-doctor` per invocare lo spawner fuori dagli slot programmati.

# ── Tetti di tempo sulle chiamate bloccanti del loop ────────────────────────
# Prima non ce n'era nessuno: `out=$(bash "$SPAWNER" 2>&1)` e le chiamate agli
# helper python aspettavano senza limite. Se il figlio si appende — il caso
# documentato è `tmux new-session -c` che non ritorna su un bind mount
# stallato, vedi 214-7-osservabilita-spawn.md §4 H2 — QUESTO loop si fermava
# per sempre e in silenzio: niente Dottore, niente Mantenitore, nessuna riga
# di log. Qui non c'è flock, quindi il guasto è «loop fermo», non il «lockout
# permanente» dello spawn degli agenti: nessun altro percorso resta bloccato,
# ma nessuno se ne accorge.
#
# I valori sono la scala del sistema (214-3-timeout-value.md §2), dal budget
# più esterno al più interno:
#   POLL_SEC                 300 s  ← cadenza del loop
#     └─ spawner             180 s  ← 2× il caso peggiore SANO di uno spawner:
#                                     45 s di tmux new-session + ~26 s di
#                                     jht_spawn_wait_repl (12+1+12) + copia
#                                     skill su un mount 158× più lento
#          └─ tmux new-session 45 s ← spawn-lib.sh, JHT_SPAWN_TMUX_TIMEOUT_SEC
#     └─ helper python        30 s  ← stesso ordine degli altri singoli helper
#                                     del sistema (start-agent.sh:985
#                                     `timeout 30 claude`, container-proxy.js)
SPAWN_TIMEOUT_SEC="${JHT_DOCTOR_SPAWN_TIMEOUT_SEC:-180}"
HELPER_TIMEOUT_SEC="${JHT_DOCTOR_HELPER_TIMEOUT_SEC:-30}"

# Buffer di cattura dell'output dei comandi limitati. Volutamente sotto /tmp
# (layer overlay del container, veloce) e non in $JHT_HOME/logs: quello è il
# bind mount che nell'incidente si è stallato, e la redirezione viene aperta
# PRIMA che il tetto possa fare qualcosa.
RUN_PREFIX="${TMPDIR:-/tmp}/jht-doctor-watchdog.$$"
CONFIG_READY_PY="$RUN_PREFIX.config-ready.py"

# Passo del poll di attesa. `sleep 0.2` non è POSIX ma GNU coreutils, busybox
# e la sleep di macOS lo accettano; dove non è accettato si ricade su 1 s, che
# costa solo latenza (≈1 s per chiamata), non correttezza.
if sleep 0.2 2>/dev/null; then
  BOUND_POLL_STEP=0.2
  BOUND_POLL_PER_SEC=5
else
  BOUND_POLL_STEP=1
  BOUND_POLL_PER_SEC=1
fi
# Margine oltre il tetto prima di dichiarare il figlio non chiudibile: il
# tempo che jht_timeout ha per mandare il segnale, vedere morire il figlio e
# ritornare 124.
BOUND_GRACE_SEC="${JHT_DOCTOR_BOUND_GRACE_SEC:-15}"
# Esito dell'ultimo tetto scattato: "expired" (figlio chiuso dal tetto) o
# "abandoned pid=N" (figlio non chiudibile, lasciato orfano). Le due cose
# vanno distinte nel diario: la seconda dice che sulla macchina è rimasto un
# processo in I/O ininterrompibile, ed è l'unica traccia che ne resta.
BOUND_STATE=""

# jht_doctor_bounded <secondi> <file-output> <comando...>
#   Esegue il comando con un tetto di tempo; stdout+stderr finiscono nel file,
#   che il chiamante legge con `cat`. Ritorna l'rc del comando, o 124 se il
#   tetto è scattato (BOUND_STATE dice come).
#
#   Su FILE e non in command substitution per un motivo preciso: `out=$(cmd)`
#   non ritorna finché TUTTI i writer della pipe l'hanno chiusa, nipoti
#   compresi — e il `tmux new-session` appeso è esattamente uno di quei nipoti
#   (eredita lo stdout dello spawner). Con la pipe, il tetto chiuderebbe il
#   figlio diretto e il loop resterebbe comunque bloccato a leggere.
#
#   In BACKGROUND e con un'attesa a scadenza invece di un `jht_timeout` in
#   primo piano, perché `timeout` manda il segnale e poi ASPETTA che il figlio
#   sia raccolto: un processo in stato D (uninterruptible sleep) su un mount
#   stallato — cioè proprio lo scenario dell'incidente — non muore né con
#   SIGTERM né con SIGKILL finché la syscall non ritorna, quindi `timeout`
#   resterebbe appeso quanto lui e il loop con lui. Alla scadenza il figlio
#   viene ABBANDONATO: resta orfano e visibile a `ps` (il pid finisce nel
#   diario), ma il loop riprende. Il tetto interno resta perché nei casi
#   chiudibili è lui a fare il lavoro, subito e in modo pulito.
#
#   L'attesa guarda il file di rc, non `kill -0`: un figlio già finito ma non
#   ancora raccolto è uno zombie, e `kill -0` su uno zombie riesce — l'attesa
#   non finirebbe mai prima della scadenza.
#
#   `rm -f` prima di ogni uso: se un tentativo precedente è stato abbandonato,
#   il suo processo continua a scrivere sull'inode scollegato e non contamina
#   la lettura di questo.
jht_doctor_bounded() {
  local secs="$1" outfile="$2" rcfile="$2.rc" rc=0 steps=0 max_steps child
  shift 2
  BOUND_STATE=""
  rm -f "$outfile" "$rcfile" 2>/dev/null || true
  # `>/dev/null 2>&1` sul BLOCCO (l'output del comando va comunque in
  # $outfile, la redirezione interna vince): un figlio che può restare orfano
  # non deve tenere aperta la stdout di questo script, che sotto pid1 è una
  # pipe. È la stessa lezione del `9>&-` in start-agent.sh — un fd ereditato
  # da un processo detached resta aperto quanto lui.
  { jht_timeout "$secs" "$@" >"$outfile" 2>&1; printf '%s' "$?" >"$rcfile"; } \
    >/dev/null 2>&1 &
  child=$!
  max_steps=$(( (secs + BOUND_GRACE_SEC) * BOUND_POLL_PER_SEC ))
  while [ ! -s "$rcfile" ]; do
    if [ "$steps" -ge "$max_steps" ]; then
      BOUND_STATE="abandoned pid=$child"
      return 124
    fi
    sleep "$BOUND_POLL_STEP" 2>/dev/null || sleep 1
    steps=$((steps + 1))
  done
  wait "$child" 2>/dev/null || true
  rc="$(cat "$rcfile" 2>/dev/null || echo 124)"
  case "$rc" in ''|*[!0-9]*) rc=124 ;; esac
  [ "$rc" -eq 124 ] && BOUND_STATE="expired"
  return "$rc"
}

# ── Diario: UN path per scrittore ───────────────────────────────────────────
# Il diario di questo script NON è più logs/doctor-watchdog.log: quel path è
# di pid1, che cattura la nostra stdout (spawnLabeled('doctor-watchdog') in
# cli/src/commands/pid1.js) e la scrive lì con un fd persistente, ruotando il
# file con renameSync a ogni spawn. Con `tee -a` sullo stesso path c'erano DUE
# scrittori: ogni riga finiva due volte nello stesso file — byte doppi su un
# bind mount — e appena qualcuno ruota il file mentre il daemon gira, l'fd
# persistente di pid1 continua a scrivere sull'inode scollegato, quindi metà
# del diario diventa invisibile.
#
# Il pattern vigente nel repo è un path per scrittore, con il `tee` che resta
# perché è così che la rotazione arriva gratis anche da pid1:
#   agent-watchdog.sh         → agent-watchdog.log         · pid1 → watchdog.log
#   pager-unstick-watchdog.sh → pager-unstick-watchdog.log · pid1 → pager-unstick.log
#   questo file               → doctor-watchdog-loop.log   · pid1 → doctor-watchdog.log
# Nessuna continuità storica si perde: doctor-watchdog.log continua a ricevere
# le stesse righe via stdout, con la rotazione di pid1.
#
# jht_daemon_log ruota solo QUANDO VIENE CHIAMATA (daemon-lib.sh), perché
# nasce per daemon che risolvono il path allo spawn: un loop che vive mesi non
# ruoterebbe mai, quindi la richiamiamo a ogni tick (uno stat ogni 5 minuti).
LOG_FILE="$(jht_daemon_log doctor-watchdog-loop.log)"

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] $*" | tee -a "$LOG_FILE"
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
  local state=""
  # Il tetto legge un file nel bind mount: se scade, `state` resta vuoto e si
  # ricade sul fallback fail-CLOSED qui sotto (flag presente → standby), la
  # stessa scelta già fatta per «python assente / modulo rotto».
  if jht_doctor_bounded "$HELPER_TIMEOUT_SEC" "$RUN_PREFIX.standby" \
       env JHT_HOME="$JHT_HOME" python3 "$STANDBY_PY" active; then
    state="$(cat "$RUN_PREFIX.standby" 2>/dev/null || true)"
  fi
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
  # Lo snippet gira come FILE, non come heredoc su stdin: una chiamata
  # limitata parte in BACKGROUND e bash redirige lo stdin di un comando
  # asincrono da /dev/null, quindi `python3 -` leggerebbe EOF, non
  # eseguirebbe nulla e uscirebbe 0 — cioè «provider autenticato» sempre,
  # esattamente il contrario del gate. Materializzato sotto /tmp e riscritto
  # se sparisce.
  if [ ! -s "$CONFIG_READY_PY" ]; then
    cat >"$CONFIG_READY_PY" <<'PYEOF'
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
  fi
  jht_doctor_bounded "$HELPER_TIMEOUT_SEC" "$RUN_PREFIX.config" \
    python3 "$CONFIG_READY_PY" "$JHT_HOME/jht.config.json" "$JHT_HOME"
}

finish_tick() {
  local delay="$1"
  tick_count=$((tick_count + 1))
  # Ricontrollo della soglia di rotazione del diario: jht_daemon_log ruota
  # solo quando la si chiama (vedi il blocco «Diario» sopra).
  LOG_FILE="$(jht_daemon_log doctor-watchdog-loop.log)"
  if [ "$MAX_TICKS" -gt 0 ] && [ "$tick_count" -ge "$MAX_TICKS" ]; then
    log "watchdog max ticks reached (${MAX_TICKS}) — exiting"
    exit 0
  fi
  sleep "$delay"
}

halt_log_tick=0
offhours_log_tick=0
config_log_tick=0

log "watchdog starting · Dottore twice/window (+30 min, halfway) + Mantenitore once/day · poll=${POLL_SEC}s · sched=$SCHED · spawn bound=${SPAWN_TIMEOUT_SEC}s · helper bound=${HELPER_TIMEOUT_SEC}s"
if [ "$TIME_BOUNDS_OK" -eq 0 ]; then
  log "WARNING: daemon-lib.sh does not expose jht_timeout — spawner and helper TIME BOUNDS ARE DISABLED (historical unbounded behaviour); a hung spawn will stall this loop until daemon-lib.sh is updated"
fi

while true; do
  # Il wizard salva il provider prima che il browser completi OAuth. Fino alla
  # comparsa del marker credenziali non consumare turni LLM e non tentare il
  # fallback storico a Claude. Il loop resta vivo e ricontrolla normalmente.
  config_ready && config_rc=0 || config_rc=$?
  if [ "$config_rc" -ne 0 ]; then
    if [ "$config_rc" -eq 124 ]; then
      # Senza questa riga un mount stallato è indistinguibile da un provider
      # non autenticato: il loop resterebbe «sospeso» per sempre e la causa
      # non sarebbe da nessuna parte.
      log "config check hit the ${HELPER_TIMEOUT_SEC}s bound [${BOUND_STATE}] (stalled storage?) — treated as not ready, loop alive"
    elif [ $((config_log_tick % 8)) -eq 0 ]; then
      log "provider not authenticated yet — Dottore/Mantenitore scheduling suspended"
    fi
    config_log_tick=$((config_log_tick + 1))
    finish_tick "$POLL_SEC"
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
    finish_tick "$POLL_SEC"
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
  jht_doctor_bounded "$HELPER_TIMEOUT_SEC" "$RUN_PREFIX.sched" \
    python3 "$SCHED" check-maintainer && mslot_rc=0 || mslot_rc=$?
  if [ "$mslot_rc" -eq 0 ]; then
    mslot="$(cat "$RUN_PREFIX.sched" 2>/dev/null || true)"
  else
    mslot=WAIT
    [ "$mslot_rc" -eq 124 ] && log "schedule check-maintainer hit the ${HELPER_TIMEOUT_SEC}s bound [${BOUND_STATE}] — treated as WAIT, loop alive"
  fi
  if [ "$mslot" = "MAINT" ]; then
    if [ ! -f "$MAINT_SPAWNER" ]; then
      log "ERROR: Mantenitore spawner not found at $MAINT_SPAWNER"
    else
      jht_doctor_bounded "$SPAWN_TIMEOUT_SEC" "$RUN_PREFIX.maint" \
        bash "$MAINT_SPAWNER" && mrc=0 || mrc=$?
      mout="$(cat "$RUN_PREFIX.maint" 2>/dev/null || true)"
      if [ "$mrc" -eq 0 ]; then
        log "spawn mantenitore ok: $mout"
        jht_doctor_bounded "$HELPER_TIMEOUT_SEC" "$RUN_PREFIX.sched" \
          python3 "$SCHED" mark-maintainer || true
      elif [ "$mrc" -eq 124 ]; then
        # Esito INCERTO: il tetto ha chiuso lo spawner, ma la sessione
        # MANTENITORE può essere già nata (l'hang può stare a valle della
        # creazione). Vale la stessa regola del claim del Dottore qui sotto —
        # un esito incerto NON si ritenta: un secondo spawn ucciderebbe e
        # ricreerebbe un Mantenitore magari vivo, bruciando due turni LLM.
        # Marchiamo la giornata; il gate working-hours riproverà domani.
        log "spawn mantenitore hit the ${SPAWN_TIMEOUT_SEC}s bound [${BOUND_STATE}] — day marked to avoid a duplicate LLM spawn (outcome uncertain), loop alive: $mout"
        jht_doctor_bounded "$HELPER_TIMEOUT_SEC" "$RUN_PREFIX.sched" \
          python3 "$SCHED" mark-maintainer || true
      else
        log "spawn mantenitore FAILED rc=$mrc: $mout"
      fi
    fi
  fi

  # Decisione + ownership: doctor_schedule.py persiste un CLAIM prima di
  # restituire uno slot. Se il claim non può essere scritto, nessun Dottore
  # parte (fail-closed); agent-watchdog conserva comunque il tetto TTL.
  # Un claim dal risultato incerto NON viene rilasciato: meglio saltare un rich
  # round che duplicare spawn LLM. Solo un fallimento certo dello spawner fa
  # `release`, così il prossimo poll può ritentare.
  jht_doctor_bounded "$HELPER_TIMEOUT_SEC" "$RUN_PREFIX.claim" \
    env DOCTOR_FALLBACK_SEC="$FALLBACK_SEC" python3 "$SCHED" claim \
    && slot_rc=0 || slot_rc=$?
  slot_out="$(cat "$RUN_PREFIX.claim" 2>/dev/null || true)"
  if [ "$slot_rc" -eq 124 ]; then
    log "schedule claim hit the ${HELPER_TIMEOUT_SEC}s bound [${BOUND_STATE}] — rich refresh not spawned (TTL fail-safe remains active), loop alive: $slot_out"
    slot=WAIT
  elif [ "$slot_rc" -ne 0 ]; then
    log "schedule claim FAILED rc=$slot_rc — rich refresh not spawned (TTL fail-safe remains active): $slot_out"
    slot=WAIT
  else
    slot="$slot_out"
  fi

  case "$slot" in
    T30|MID|FALLBACK)
      if [ ! -f "$SPAWNER" ]; then
        log "ERROR: spawner not found at $SPAWNER"
        jht_doctor_bounded "$HELPER_TIMEOUT_SEC" "$RUN_PREFIX.sched" \
          python3 "$SCHED" release "$slot" \
          || log "schedule release FAILED for missing spawner (slot=$slot) — claim stays fail-closed"
      else
        jht_doctor_bounded "$SPAWN_TIMEOUT_SEC" "$RUN_PREFIX.spawn" \
          bash "$SPAWNER" && rc=0 || rc=$?
        out="$(cat "$RUN_PREFIX.spawn" 2>/dev/null || true)"
        if [ "$rc" -eq 0 ]; then
          if jht_doctor_bounded "$HELPER_TIMEOUT_SEC" "$RUN_PREFIX.sched" \
               python3 "$SCHED" mark "$slot"; then
            log "spawn ok and claim finalized (slot=$slot): $out"
          else
            # Il claim pre-spawn resta su disco: niente doppio spawn al poll
            # successivo, anche se la finalizzazione ha perso la risposta.
            log "schedule mark FAILED after successful spawn (slot=$slot) — claim retained, no duplicate retry"
          fi
        elif [ "$rc" -eq 124 ]; then
          # Il tetto è scattato: esito INCERTO (la sessione DOTTORE può essere
          # nata e l'hang stare a valle). Il claim NON si rilascia — è la
          # regola dichiarata qui sopra: meglio saltare un rich round che
          # duplicare uno spawn LLM. Il loop riprende dal prossimo poll.
          log "spawn dottore hit the ${SPAWN_TIMEOUT_SEC}s bound [${BOUND_STATE}] (slot=$slot) — claim RETAINED (outcome uncertain, no duplicate LLM spawn), loop alive: $out"
        else
          log "spawn FAILED (slot=$slot) rc=$rc: $out"
          jht_doctor_bounded "$HELPER_TIMEOUT_SEC" "$RUN_PREFIX.sched" \
            python3 "$SCHED" release "$slot" \
            || log "schedule release FAILED (slot=$slot) — claim retained fail-closed"
        fi
      fi
      finish_tick "$POLL_SEC"
      ;;
    OFF)
      if [ $((offhours_log_tick % 8)) -eq 0 ]; then
        log "outside working hours — scheduling suspended (actual OFF interval)"
      fi
      offhours_log_tick=$((offhours_log_tick + 1))
      finish_tick "$OFF_RECHECK_SEC"
      ;;
    *)  # WAIT o errore: dentro finestra ma nessuno slot dovuto ora.
      offhours_log_tick=0
      finish_tick "$POLL_SEC"
      ;;
  esac
done

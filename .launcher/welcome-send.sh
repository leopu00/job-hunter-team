#!/usr/bin/env bash
# welcome-send.sh — invia i 3 welcome (assistente, capitano, mentor) via
# jht-telegram-send come bash script deterministico. Niente LLM in the
# loop: kimi-cli ha problemi di OAuth-per-work-dir che bloccano gli
# agenti dal mandare il welcome iniziale (scoperto 2026-05-16 in test
# fresh #3). Il welcome è copy hardcoded — gli agenti restano per
# ricevere/rispondere ai messaggi runtime, ma il primo benvenuto lo
# fa lo script che è sicuro di funzionare.
#
# Idempotente: per ogni ruolo verifica il proprio flag prima di inviare,
# tocca il flag solo se l'invio ha avuto successo.
#
# Trigger: pid1 lo chiama al boot del container quando le condizioni
# sono soddisfatte (bot configurati + active_provider settato).

set -u

JHT_HOME="${JHT_HOME:-/jht_home}"
PROFILE_DIR="$JHT_HOME/profile"
SENDER="/app/agents/_tools/jht-telegram-send"
LOG="$JHT_HOME/logs/welcome-send.log"
mkdir -p "$(dirname "$LOG")" "$PROFILE_DIR"

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] $*" | tee -a "$LOG"
}

send_one() {
  local role="$1" flag_name="$2" body="$3"
  local flag="$PROFILE_DIR/$flag_name"
  if [ -f "$flag" ]; then
    log "$role: flag già presente, skip"
    return 0
  fi
  log "$role: invio welcome via jht-telegram-send --from $role"
  if "$SENDER" --from "$role" "$body" >>"$LOG" 2>&1; then
    touch "$flag"
    log "$role: invio OK + flag creato"
  else
    log "$role: invio FAIL (rc=$?), flag NON creato, retry al prossimo boot"
    return 1
  fi
}

# ── Copy welcome per i 3 ruoli ──────────────────────────────────────
ASSISTENTE_MSG="Ciao! 👋

Sono l'Assistente di Job Hunter Team — il tuo punto di contatto con il team AI che ti cercherà lavoro.

Per partire ho bisogno di conoscerti. Mandami qui su Telegram il tuo CV (PDF, DOC, anche una foto del cartaceo va benissimo), oppure raccontami in due righe cosa cerchi — ruolo, settore, città. Da lì costruisco il profilo e il resto del team si mette al lavoro per te.

Anche un draft o degli appunti grezzi vanno benissimo, non serve niente di pronto. 📄 Parto da quello che hai."

CAPITANO_MSG="Sono il Capitano. 👨‍✈️

Coordino il team che si occuperà di te: c'è chi cerca posizioni, chi le analizza, chi calcola il match col tuo profilo, chi scrive il CV su misura, chi fa la review finale prima di candidarti.

Per ora resto in silenzio. Appena il tuo profilo è pronto accendo il motore, e da lì ti scrivo quando ho qualcosa di concreto: un lotto di posizioni interessanti, una candidatura pronta da rivedere insieme, oppure un blocco che vale la pena segnalarti. A presto. 🎯"

MENTOR_MSG="Sono il Mentor. 🧙‍♂️

Mi occupo del quadro generale della tua ricerca: una volta a settimana ti porto una lettura dei numeri — pattern emersi, segnali di mercato, scelte di carriera che vale la pena considerare. Voce misurata, ti scrivo solo quando c'è qualcosa che merita davvero la tua attenzione.

Per ora resto in ascolto. Quando avrò dati abbastanza per dirti qualcosa di utile, ti scrivo. 📊"

log "welcome-send start"

send_one assistente welcomed.flag           "$ASSISTENTE_MSG" || true
send_one capitano   capitano-welcomed.flag  "$CAPITANO_MSG"   || true
send_one mentor     mentor-welcomed.flag    "$MENTOR_MSG"     || true

log "welcome-send done"

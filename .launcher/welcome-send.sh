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

# i18n: carica catalogo locales (en/it/hu) — usa $JHT_LANG da host.env
# English fallback if i18n.sh is unavailable (legacy build).
if [ -f /app/shared/i18n.sh ]; then
  # shellcheck disable=SC1091
  source /app/shared/i18n.sh
fi

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
# Stringhe da shared/locales/<JHT_LANG>.json. Se il catalogo non c'è
# (legacy build without i18n.sh), English fallback.
if declare -F t >/dev/null 2>&1; then
  ASSISTENTE_MSG="$(t welcome.assistente)"
  CAPITANO_MSG="$(t welcome.capitano)"
  MENTOR_MSG="$(t welcome.mentor)"
else
  log "WARN: shared/i18n.sh unavailable, using hardcoded English welcome messages"
  ASSISTENTE_MSG="Hi! 👋

I'm the Job Hunter Team Assistant — your point of contact with the AI team that's about to start looking for jobs for you.

To get going I need to know you. Send me here on Telegram your CV (PDF, DOC, even a photo of the paper version works), or just tell me in a couple of lines what you're looking for — role, sector, city. From that I build the profile and the rest of the team gets to work for you.

A draft or rough notes are perfectly fine, no need to have anything polished. 📄 I start from what you have."

  CAPITANO_MSG="I'm the Captain. 👨‍✈️

I coordinate the team that will work on your search: someone hunts positions, someone analyzes them, someone calculates the match against your profile, someone writes the CV tailored to each one, someone does the final review before applying.

For now I'll stay silent. As soon as your profile is ready I'll fire up the engine, and from there I'll write to you when I have something concrete: a batch of interesting positions, an application ready to review together, or a blocker worth flagging. Talk soon. 🎯"

  MENTOR_MSG="I'm the Mentor. 🧙‍♂️

I take care of the big picture of your search: once a week I'll bring you a reading of the numbers — patterns that emerged, market signals, career choices worth considering. Measured voice, I'll only write when there's something that really deserves your attention.

For now I'm listening. When I have enough data to tell you something useful, I'll write. 📊"
fi

log "welcome-send start"

send_one assistente welcomed.flag           "$ASSISTENTE_MSG" || true
send_one capitano   capitano-welcomed.flag  "$CAPITANO_MSG"   || true
send_one mentor     mentor-welcomed.flag    "$MENTOR_MSG"     || true

log "welcome-send done"

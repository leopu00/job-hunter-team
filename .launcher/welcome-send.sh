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

# i18n: carica uno dei sette cataloghi dalla preferenza canonica
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
    log "$role: flag already present, skipping"
    return 0
  fi
  log "$role: sending welcome via jht-telegram-send --from $role"
  if "$SENDER" --from "$role" "$body" >>"$LOG" 2>&1; then
    touch "$flag"
    log "$role: send OK + flag created"
  else
    log "$role: send FAILED (rc=$?), flag NOT created; retrying at next boot"
    return 1
  fi
}

# ── Copy welcome per i 3 ruoli ──────────────────────────────────────
# Stringhe da shared/locales/<locale>.json. Se il catalogo non c'è
# (legacy build without i18n.sh), English fallback.
if declare -F t >/dev/null 2>&1; then
  CAPITANO_MSG="$(t welcome.capitano)"
  MENTOR_MSG="$(t welcome.mentor)"
else
  log "WARN: shared/i18n.sh unavailable, using hardcoded English welcome messages"
  CAPITANO_MSG="I'm the Captain. 👨‍✈️

I coordinate the team that will work on your search: someone hunts positions, someone analyzes them, someone calculates the match against your profile, someone writes the CV tailored to each one, someone does the final review before applying.

For now I'll stay silent. As soon as your profile is ready I'll fire up the engine, and from there I'll write to you when I have something concrete: a batch of interesting positions, an application ready to review together, or a blocker worth flagging. Talk soon. 🎯"

  MENTOR_MSG="I'm the Mentor. 🧙‍♂️

I take care of the big picture of your search: once a week I'll bring you a reading of the numbers — patterns that emerged, market signals, career choices worth considering. Measured voice, I'll only write when there's something that really deserves your attention.

For now I'm listening. When I have enough data to tell you something useful, I'll write. 📊"
fi

log "welcome-send start"

# The Assistente is welcomed in the chat of the app first, Telegram in addition:
# the same command the agent runs, the only one that writes welcomed.flag.
log "assistente: welcome in the app chat (+ Telegram when configured)"
python3 /app/shared/skills/assistant_welcome.py deliver 2>&1 | tee -a "$LOG" || true
send_one capitano   capitano-welcomed.flag  "$CAPITANO_MSG"   || true
send_one mentor     mentor-welcomed.flag    "$MENTOR_MSG"     || true

log "welcome-send done"

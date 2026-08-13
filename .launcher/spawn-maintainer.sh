#!/usr/bin/env bash
# spawn-maintainer.sh — spawna una sessione MANTENITORE 👷‍♂️ (one-shot, 1x/giorno)
# killando ogni Mantenitore precedente. Gemello di spawn-doctor.sh ma per il
# ruolo INFRA: salute container/deps/disco/tool + standardizzazione.
#
# Uso: spawn-maintainer.sh
# Env: JHT_HOME (default /jht_home)
#
# Output: stampa il nome della sessione creata, oppure errore.
#
# Lo invoca doctor-watchdog.sh sullo slot 'maintainer' (1x/giorno, gate
# working-hours in doctor_schedule.py:check-maintainer). Il Mantenitore esegue
# il maintainer-sweep e resta in standby (sostituito al prossimo spawn).
#
# I passi comuni con spawn-doctor.sh vivono in .launcher/spawn-lib.sh.

set -u

JHT_HOME="${JHT_HOME:-/jht_home}"
MANT_DIR="$JHT_HOME/agents/mantenitore"
LOGS_DIR="$JHT_HOME/logs"
mkdir -p "$MANT_DIR/tools" "$MANT_DIR/tmp" "$LOGS_DIR"

# shellcheck source=/dev/null
. "$(cd "$(dirname "$0")" && pwd)/spawn-lib.sh"

LABEL="spawn-maintainer"
SESSION="MANTENITORE"
ACTIVE_PROVIDER="$(jht_spawn_active_provider)" || exit 1

# 1) Killa ogni sessione MANTENITORE* esistente (idempotente: ne lascia uno).
jht_spawn_kill_sessions '^MANTENITORE([-_].*)?$' "$LABEL"

# 2) Riallinea il prompt: agents/mantenitore/mantenitore.md → AGENTS.md.
jht_spawn_sync_prompt mantenitore "$MANT_DIR" "$LABEL"

# 2b) Skill discovery: le skill di skills.list nella workdir, così
#     `maintainer-sweep`/`resilience` sono discoverabili come skill vere dal
#     provider (Claude → .claude/skills, Codex/Kimi → .agents/skills).
jht_spawn_copy_skills mantenitore "$MANT_DIR" "$LABEL" \
  "$ACTIVE_PROVIDER"

# 3) Soppressione auto-update Codex (stesso fix di spawn-doctor/start-agent).
jht_spawn_codex_dismiss_update

# 4) Crea la sessione tmux MANTENITORE nella workdir corretta.
tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$MANT_DIR" || {
  echo "[$LABEL] ERROR: tmux new-session failed" >&2
  exit 1
}

# 5) PATH nel pane (shell non interattiva: non carica .bashrc). Include
#    /opt/jht-deps/bin (prefisso globale) così il Mantenitore vede gli extra.
tmux send-keys -t "$SESSION" "export PATH='$JHT_SPAWN_PANE_PATH'" C-m
sleep 1

# 6) Avvia il REPL del provider attivo (stesso del team).
MANT_CMD="$(jht_spawn_repl_cmd "$ACTIVE_PROVIDER")" || exit 1
tmux send-keys -t "$SESSION" "$MANT_CMD" C-m

# 6b) Robustezza REPL: niente prompt-di-lavoro dentro una shell.
jht_spawn_wait_repl "$SESSION" "$MANT_CMD" "$LABEL" mantenitore "$LOGS_DIR" "spawn-maintainer.sh" || exit 1

# 6c) Auto-accept dei dialog + iniezione del prompt iniziale.
jht_spawn_kickoff "$SESSION" 'Read AGENTS.md and run the maintainer sweep as documented. Outside working hours, log the condition and remain on standby. When finished, write the final log and REMAIN available on standby — DO NOT self-terminate (the next spawn replaces you using kill-then-create). If the coordinators contact you, respond to their request.'

# 7) Log spawn evento per tracciabilità.
ROUND_ID="$(date -u +%Y%m%dT%H%M%SZ)-maint"
jht_spawn_log_event "$LOGS_DIR" mantenitore "$SESSION" "$ROUND_ID" "spawn-maintainer.sh"

echo "[$LABEL] $SESSION started — workdir=$MANT_DIR — round=$ROUND_ID"

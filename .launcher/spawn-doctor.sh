#!/usr/bin/env bash
# spawn-doctor.sh — spawna una nuova sessione DOTTORE killando ogni
# Dottore precedente. Idempotente: ne lascia sempre esattamente uno.
#
# Uso: spawn-doctor.sh
# Env:
#   JHT_HOME (default /jht_home)
#
# Output: stampa il nome della sessione creata, oppure errore.
#
# Gemello di spawn-maintainer.sh: i passi comuni (kill, prompt, skill, REPL del
# provider attivo, attesa REPL, kickoff) vivono in .launcher/spawn-lib.sh.

set -u

JHT_HOME="${JHT_HOME:-/jht_home}"
DOTTORE_DIR="$JHT_HOME/agents/dottore"
LOGS_DIR="$JHT_HOME/logs"
mkdir -p "$DOTTORE_DIR/tools" "$DOTTORE_DIR/tmp" "$LOGS_DIR"

# shellcheck source=/dev/null
. "$(cd "$(dirname "$0")" && pwd)/spawn-lib.sh"

LABEL="spawn-doctor"
SESSION="DOTTORE"
ACTIVE_PROVIDER="$(jht_spawn_active_provider)" || exit 1

# 1) Killa ogni sessione DOTTORE* esistente. Convenzione user: "se uno
#    precedente non si è auto-killato, il nuovo lo killa". Match case-insensitive
#    per beccare sia DOTTORE che dottore-N.
jht_spawn_kill_sessions '^DOTTORE([-_].*)?$' "$LABEL"

# 2) Prompt corrente → AGENTS.md nella workdir del dottore.
jht_spawn_sync_prompt dottore "$DOTTORE_DIR" "$LABEL"

# 2b) Skill discovery: le skill dichiarate in agents/dottore/skills.list vanno
#     COPIATE nella workdir, altrimenti `session-refresh` (che il prompt del
#     Dottore gli dice di aprire) semplicemente non esiste per il provider.
#     Divergenza storica: spawn-maintainer.sh lo faceva, spawn-doctor no.
jht_spawn_copy_skills dottore "$DOTTORE_DIR" "$LABEL" \
  "$ACTIVE_PROVIDER"

# 3) Soppressione auto-update Codex (stesso fix di start-agent.sh).
jht_spawn_codex_dismiss_update

# 4) Crea la sessione tmux DOTTORE nella workdir corretta, con un tetto di
#    tempo: `-c` fa chdir() nel bind mount e su un mount stallato non ritorna
#    mai (vedi jht_spawn_new_session in spawn-lib.sh).
jht_spawn_new_session "$SESSION" "$DOTTORE_DIR" "$LABEL" || exit 1

# 5) PATH nel pane (shell non interattiva: non carica .bashrc).
tmux send-keys -t "$SESSION" "export PATH='$JHT_SPAWN_PANE_PATH'" C-m
sleep 1

# 5b) Un nuovo tentativo dopo un errore di capacita' (JHT_DOCTOR_RETRY=<n>, messo dal watchdog)
#     usa il modello di riserva, se la configurazione lo prevede: `doctor_fallback_model` in
#     jht.config.json. Senza quella chiave il modello resta quello di sempre.
case "${JHT_DOCTOR_RETRY:-0}" in
  ''|0|*[!0-9]*) ;;
  *)
    FALLBACK_MODEL="$(python3 - "$JHT_HOME/jht.config.json" <<'PYEOF' 2>/dev/null || true
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        print(str(json.load(handle).get("doctor_fallback_model") or "").strip())
except Exception:
    pass
PYEOF
)"
    if [ -n "$FALLBACK_MODEL" ]; then
      # Il valore viene dal file di configurazione: si valida PRIMA di esportarlo e di scriverlo nel log
      # del giro (un a-capo o una sequenza di escape non devono finirci).
      if jht_spawn_model_name_ok "$FALLBACK_MODEL"; then
        export JHT_SPAWN_MODEL_OVERRIDE="$FALLBACK_MODEL"
        echo "[$LABEL] retry ${JHT_DOCTOR_RETRY}: fallback model '$FALLBACK_MODEL'"
      else
        echo "[$LABEL] retry ${JHT_DOCTOR_RETRY}: doctor_fallback_model is not a model name — ignored"
      fi
    fi
    ;;
esac

# 6) Avvia il REPL del provider attivo (effort alto).
DOCTOR_CMD="$(jht_spawn_repl_cmd "$ACTIVE_PROVIDER")" || exit 1
tmux send-keys -t "$SESSION" "$DOCTOR_CMD" C-m

# 6b) Robustezza REPL (#12): niente prompt-di-lavoro dentro una shell.
jht_spawn_wait_repl "$SESSION" "$DOCTOR_CMD" "$LABEL" dottore "$LOGS_DIR" "spawn-doctor.sh" || exit 1

# 6c) Auto-accept dei dialog + iniezione del prompt iniziale.
jht_spawn_kickoff "$SESSION" 'Read AGENTS.md and run the health-check cycle as documented. When finished, write the final log and REMAIN available on standby — DO NOT self-terminate (the next spawn replaces you using kill-then-create). If the coordinators contact you, respond to their request.'

# 6d) L'avvio e' riuscito solo se la sessione non e' ferma sul prompt per un errore di capacita':
#     rc 75, e chi ci sta sopra NON segna il giro fatto (riprova dopo un'attesa, o round_failed).
jht_spawn_verify_start "$SESSION" "$LABEL" dottore "$LOGS_DIR" "spawn-doctor.sh" || exit $?

# 7) Log spawn evento per tracciabilità (UI lo mostrerà in timeline).
ROUND_ID="$(date -u +%Y%m%dT%H%M%SZ)-spawn"
jht_spawn_log_event "$LOGS_DIR" dottore "$SESSION" "$ROUND_ID" "spawn-doctor.sh"

echo "[$LABEL] $SESSION started — workdir=$DOTTORE_DIR — round=$ROUND_ID"

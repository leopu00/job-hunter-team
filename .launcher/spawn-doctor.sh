#!/usr/bin/env bash
# spawn-doctor.sh — spawna una nuova sessione DOTTORE killando ogni
# Dottore precedente. Idempotente: ne lascia sempre esattamente uno.
#
# Uso: spawn-doctor.sh
# Env:
#   JHT_HOME (default /jht_home)
#
# Output: stampa il nome della sessione creata, oppure errore.

set -u

JHT_HOME="${JHT_HOME:-/jht_home}"
DOTTORE_DIR="$JHT_HOME/agents/dottore"
LOGS_DIR="$JHT_HOME/logs"
mkdir -p "$DOTTORE_DIR/tools" "$DOTTORE_DIR/tmp" "$LOGS_DIR"

# 1) Killa ogni sessione DOTTORE* esistente. Convenzione user: "se uno
#    precedente non si è auto-killato, il nuovo lo killa". Usiamo grep -i
#    per beccare sia DOTTORE che dottore-N.
existing=$(tmux ls 2>/dev/null | awk -F: '{print $1}' | grep -iE '^DOTTORE([-_].*)?$' || true)
for s in $existing; do
  echo "[spawn-doctor] killing old session: $s"
  tmux kill-session -t "$s" 2>/dev/null || true
done

# 2) Copia il prompt corrente in AGENTS.md (Codex/Kimi standard) nella
#    workdir del dottore. Source di verità: /app/agents/dottore/dottore.md
#    (mounted da dev1). Riallinea ad ogni spawn così se aggiorni il prompt
#    il prossimo dottore lo vede subito.
SRC_PROMPT="/app/agents/dottore/dottore.md"
if [ ! -f "$SRC_PROMPT" ]; then
  # Fallback: cerca nei worktree mount alternativi
  for cand in /app/agents/dottore/dottore.md "$JHT_HOME/agents/dottore/dottore.md"; do
    if [ -f "$cand" ]; then SRC_PROMPT="$cand"; break; fi
  done
fi
if [ -f "$SRC_PROMPT" ]; then
  cp "$SRC_PROMPT" "$DOTTORE_DIR/AGENTS.md"
else
  echo "[spawn-doctor] WARN: prompt sorgente non trovato — il dottore partirà senza AGENTS.md fresh"
fi

# 3) Soppressione auto-update Codex (stesso fix di start-agent.sh).
CODEX_VERSION_FILE="$JHT_HOME/.codex/version.json"
if [ -f "$CODEX_VERSION_FILE" ] && command -v python3 &>/dev/null; then
  python3 - "$CODEX_VERSION_FILE" <<'PYEOF' || true
import json, sys
p = sys.argv[1]
try:
    with open(p) as f:
        data = json.load(f)
    latest = data.get("latest_version")
    if latest and data.get("dismissed_version") != latest:
        data["dismissed_version"] = latest
        with open(p, "w") as f:
            json.dump(data, f)
except Exception:
    pass
PYEOF
fi

# 4) Crea la sessione tmux DOTTORE nella workdir corretta.
SESSION="DOTTORE"
tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$DOTTORE_DIR" || {
  echo "[spawn-doctor] ERROR: tmux new-session fallito" >&2
  exit 1
}

# 5) Setup PATH dentro al pane: tmux new-session -d apre una shell non
#    interattiva che NON carica .bashrc, quindi codex (in
#    /jht_home/.npm-global/bin) non e' nel PATH. Esportiamolo a mano.
tmux send-keys -t "$SESSION" "export PATH='/app/agents/_tools:/jht_home/.npm-global/bin:/home/jht/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'" C-m
sleep 1

# 6) Avvia codex --yolo (effort=high per evitare diagnosi superficiali).
tmux send-keys -t "$SESSION" "codex --yolo -c model_reasoning_effort=high" C-m

# 6) Auto-accept dei trust/approval dialogs (3 Enter cadenzati come
#    start-agent.sh). Setsid scollega dal nostro process group, così il
#    watchdog può uscire senza ammazzare lo sleep.
setsid sh -c "
  sleep 4 && tmux send-keys -t '$SESSION' Enter
  sleep 3 && tmux send-keys -t '$SESSION' Enter
  sleep 3 && tmux send-keys -t '$SESSION' Enter
  sleep 3 && tmux send-keys -t '$SESSION' 'Leggi AGENTS.md ed esegui il giro di health-check come da procedura. Quando hai finito, autodistruggiti come da sezione Self-destruct.' C-m
" >/dev/null 2>&1 < /dev/null &
disown 2>/dev/null

# 7) Log spawn evento per tracciabilità (UI lo mostrerà in timeline).
ROUND_ID="$(date -u +%Y%m%dT%H%M%SZ)-spawn"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "{\"ts\":\"$TS\",\"round_id\":\"$ROUND_ID\",\"session\":\"$SESSION\",\"role\":\"dottore\",\"event\":\"spawn\",\"src\":\"spawn-doctor.sh\"}" >> "$LOGS_DIR/dottore-actions.jsonl"

echo "[spawn-doctor] $SESSION avviato — workdir=$DOTTORE_DIR — round=$ROUND_ID"

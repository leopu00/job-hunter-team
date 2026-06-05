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

# 6) Avvia il REPL del PROVIDER ATTIVO (NON più codex hardcoded): il Dottore
#    deve usare lo stesso provider del team — su un setup claude, lanciare codex
#    fallirebbe (CLI/auth assenti). effort=high per diagnosi non superficiali.
#    Per claude: pre-seed onboarding (skip wizard TUI) + IS_SANDBOX.
DOCTOR_PROVIDER=$(python3 -c "import json;print(json.load(open('$JHT_HOME/jht.config.json')).get('active_provider','claude'))" 2>/dev/null || echo claude)
case "$DOCTOR_PROVIDER" in
  openai|codex) DOCTOR_CMD="codex --yolo -c model_reasoning_effort=high" ;;
  kimi)         DOCTOR_CMD="kimi --yolo" ;;
  *)  # claude / anthropic / default
    python3 - "$JHT_HOME/.claude.json" <<'PYDOC' 2>/dev/null || true
import json, sys, os
f = sys.argv[1]
try: d = json.load(open(f))
except Exception: d = {}
d["hasCompletedOnboarding"] = True
d.setdefault("theme", "dark")
d["bypassPermissionsModeAccepted"] = True
os.makedirs(os.path.dirname(f), exist_ok=True)
json.dump(d, open(f, "w"), indent=2)
PYDOC
    DOCTOR_CMD="IS_SANDBOX=1 claude --dangerously-skip-permissions --effort high --model sonnet" ;;
esac
tmux send-keys -t "$SESSION" "$DOCTOR_CMD" C-m

# 6b) Robustezza REPL (#12): verifica che il REPL Codex sia EFFETTIVAMENTE
#     partito prima di iniettare il prompt. Se codex crasha al boot (auth
#     assente, binario ko, update fallito), il pane ricade su una shell:
#     senza questo check inietteremmo il prompt-di-lavoro in una shell (che lo
#     eseguirebbe come comando) e riporteremmo "avviato" falsamente, ingannando
#     il watchdog. Poll del pane_current_command; se resta una shell → 1 retry,
#     poi spawn_failed + exit 1 così il watchdog logga FAILED e ritenta.
repl_up=0
attempt=1
while : ; do
  for _i in $(seq 1 12); do
    sleep 1
    cmd=$(tmux display-message -p -t "$SESSION" '#{pane_current_command}' 2>/dev/null || echo "")
    case "$cmd" in
      ""|bash|sh|zsh|dash|-bash|-sh|-zsh) : ;;   # shell o vuoto → non ancora su
      *) repl_up=1; break ;;                       # un processo gira → REPL up
    esac
  done
  [ "$repl_up" -eq 1 ] && break
  if [ "$attempt" -ge 2 ]; then
    last_cmd=$(tmux display-message -p -t "$SESSION" '#{pane_current_command}' 2>/dev/null || echo "?")
    echo "[spawn-doctor] ERROR: REPL ($DOCTOR_PROVIDER) non partito dopo 2 tentativi (pane=$last_cmd) — spawn fallito" >&2
    TS_FAIL="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '{"ts":"%s","session":"%s","role":"dottore","event":"spawn_failed","reason":"repl_not_up","pane_cmd":"%s","src":"spawn-doctor.sh"}\n' \
      "$TS_FAIL" "$SESSION" "$last_cmd" >> "$LOGS_DIR/dottore-actions.jsonl"
    tmux kill-session -t "$SESSION" 2>/dev/null || true
    exit 1
  fi
  echo "[spawn-doctor] REPL non salito (tentativo $attempt) — retry ($DOCTOR_PROVIDER)" >&2
  tmux send-keys -t "$SESSION" C-c 2>/dev/null || true
  sleep 1
  tmux send-keys -t "$SESSION" "$DOCTOR_CMD" C-m
  attempt=$((attempt + 1))
done

# 6c) Auto-accept dei trust/approval dialogs (3 Enter cadenzati come
#    start-agent.sh) e SOLO DOPO inietta il prompt iniziale. Setsid
#    scollega dal nostro process group così il watchdog può uscire senza
#    ammazzare lo sleep. Cadenze allungate: codex ci mette ~6s a renderizzare
#    il banner, gli Enter prima del banner finiscono nel buffer della shell
#    e non chiudono il trust dialog. Aggiungo anche un Enter di conferma
#    dopo il prompt perché Ink ha un piccolo lag tra type e submit.
setsid sh -c "
  sleep 6 && tmux send-keys -t '$SESSION' Enter
  sleep 3 && tmux send-keys -t '$SESSION' Enter
  sleep 3 && tmux send-keys -t '$SESSION' Enter
  sleep 4 && tmux send-keys -t '$SESSION' 'Leggi AGENTS.md ed esegui il giro di health-check come da procedura. Quando hai finito, autodistruggiti come da sezione Self-destruct.'
  sleep 1 && tmux send-keys -t '$SESSION' Enter
  sleep 2 && tmux send-keys -t '$SESSION' Enter
" >/dev/null 2>&1 < /dev/null &
disown 2>/dev/null

# 7) Log spawn evento per tracciabilità (UI lo mostrerà in timeline).
ROUND_ID="$(date -u +%Y%m%dT%H%M%SZ)-spawn"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "{\"ts\":\"$TS\",\"round_id\":\"$ROUND_ID\",\"session\":\"$SESSION\",\"role\":\"dottore\",\"event\":\"spawn\",\"src\":\"spawn-doctor.sh\"}" >> "$LOGS_DIR/dottore-actions.jsonl"

echo "[spawn-doctor] $SESSION avviato — workdir=$DOTTORE_DIR — round=$ROUND_ID"

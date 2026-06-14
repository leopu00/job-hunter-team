#!/usr/bin/env bash
# spawn-maintainer.sh — spawna una sessione MANTENITORE 🦺 (one-shot, 1x/giorno)
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
# il maintainer-sweep e si auto-distrugge (come il Dottore).

set -u

JHT_HOME="${JHT_HOME:-/jht_home}"
MANT_DIR="$JHT_HOME/agents/mantenitore"
LOGS_DIR="$JHT_HOME/logs"
mkdir -p "$MANT_DIR/tools" "$MANT_DIR/tmp" "$LOGS_DIR"

# 1) Killa ogni sessione MANTENITORE* esistente (idempotente: ne lascia uno).
existing=$(tmux ls 2>/dev/null | awk -F: '{print $1}' | grep -iE '^MANTENITORE([-_].*)?$' || true)
for s in $existing; do
  echo "[spawn-maintainer] killing old session: $s"
  tmux kill-session -t "$s" 2>/dev/null || true
done

# 2) Riallinea il prompt: /app/agents/mantenitore/mantenitore.md → AGENTS.md.
SRC_PROMPT="/app/agents/mantenitore/mantenitore.md"
if [ ! -f "$SRC_PROMPT" ]; then
  for cand in "$JHT_HOME/agents/mantenitore/mantenitore.md"; do
    if [ -f "$cand" ]; then SRC_PROMPT="$cand"; break; fi
  done
fi
if [ -f "$SRC_PROMPT" ]; then
  cp "$SRC_PROMPT" "$MANT_DIR/AGENTS.md"
else
  echo "[spawn-maintainer] WARN: prompt sorgente non trovato — partirà senza AGENTS.md fresh"
fi

# 2b) Skill discovery: a differenza di spawn-doctor (che si appoggia a path
#     /app assoluti), copiamo le skill dichiarate in skills.list nella workdir
#     così `maintainer-sweep`/`resilience` sono discoverabili come skill vere
#     dal provider (Claude → .claude/skills, Codex/Kimi → .agents/skills).
SKILLS_LIB="/app/agents/_skills"
MANIFEST="/app/agents/mantenitore/skills.list"
for dest in "$MANT_DIR/.claude/skills" "$MANT_DIR/.agents/skills"; do
  mkdir -p "$dest"
  if [ -f "$MANIFEST" ]; then
    while IFS= read -r name; do
      case "$name" in ''|\#*) continue ;; esac
      name="$(echo "$name" | tr -d '[:space:]')"
      [ -z "$name" ] && continue
      if [ -d "$SKILLS_LIB/$name" ]; then
        rm -rf "$dest/$name" 2>/dev/null || true
        cp -R "$SKILLS_LIB/$name" "$dest/$name" 2>/dev/null || true
      fi
    done < "$MANIFEST"
  fi
done

# 3) Soppressione auto-update Codex (stesso fix di spawn-doctor/start-agent).
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

# 4) Crea la sessione tmux MANTENITORE nella workdir corretta.
SESSION="MANTENITORE"
tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$MANT_DIR" || {
  echo "[spawn-maintainer] ERROR: tmux new-session fallito" >&2
  exit 1
}

# 5) PATH nel pane (shell non interattiva non carica .bashrc). Include
#    /opt/jht-deps/bin (prefisso globale) così il Mantenitore vede gli extra.
tmux send-keys -t "$SESSION" "export PATH='/app/agents/_tools:/opt/jht-deps/bin:/jht_home/.npm-global/bin:/home/jht/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'" C-m
sleep 1

# 6) Avvia il REPL del PROVIDER ATTIVO (stesso del team).
MANT_PROVIDER=$(python3 -c "import json;print(json.load(open('$JHT_HOME/jht.config.json')).get('active_provider','claude'))" 2>/dev/null || echo claude)
case "$MANT_PROVIDER" in
  openai|codex) MANT_CMD="codex --yolo -c model_reasoning_effort=high" ;;
  kimi)         MANT_CMD="kimi --yolo" ;;
  *)
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
    MANT_CMD="IS_SANDBOX=1 claude --dangerously-skip-permissions --effort high --model sonnet" ;;
esac
tmux send-keys -t "$SESSION" "$MANT_CMD" C-m

# 6b) Robustezza REPL: verifica che il REPL sia partito prima di iniettare il
#     prompt (altrimenti il prompt-di-lavoro finirebbe in una shell). Poll del
#     pane_current_command; 1 retry, poi spawn_failed + exit 1.
repl_up=0
attempt=1
while : ; do
  for _i in $(seq 1 12); do
    sleep 1
    cmd=$(tmux display-message -p -t "$SESSION" '#{pane_current_command}' 2>/dev/null || echo "")
    case "$cmd" in
      ""|bash|sh|zsh|dash|-bash|-sh|-zsh) : ;;
      *) repl_up=1; break ;;
    esac
  done
  [ "$repl_up" -eq 1 ] && break
  if [ "$attempt" -ge 2 ]; then
    last_cmd=$(tmux display-message -p -t "$SESSION" '#{pane_current_command}' 2>/dev/null || echo "?")
    echo "[spawn-maintainer] ERROR: REPL ($MANT_PROVIDER) non partito dopo 2 tentativi (pane=$last_cmd)" >&2
    TS_FAIL="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '{"ts":"%s","session":"%s","role":"mantenitore","event":"spawn_failed","reason":"repl_not_up","pane_cmd":"%s","src":"spawn-maintainer.sh"}\n' \
      "$TS_FAIL" "$SESSION" "$last_cmd" >> "$LOGS_DIR/mantenitore-actions.jsonl"
    tmux kill-session -t "$SESSION" 2>/dev/null || true
    exit 1
  fi
  echo "[spawn-maintainer] REPL non salito (tentativo $attempt) — retry ($MANT_PROVIDER)" >&2
  tmux send-keys -t "$SESSION" C-c 2>/dev/null || true
  sleep 1
  tmux send-keys -t "$SESSION" "$MANT_CMD" C-m
  attempt=$((attempt + 1))
done

# 6c) Auto-accept trust/approval dialogs (3 Enter cadenzati) poi inietta il
#     prompt iniziale. Setsid scollega dal process group così il watchdog può
#     uscire senza ammazzare lo sleep.
setsid sh -c "
  sleep 6 && tmux send-keys -t '$SESSION' Enter
  sleep 3 && tmux send-keys -t '$SESSION' Enter
  sleep 3 && tmux send-keys -t '$SESSION' Enter
  sleep 4 && tmux send-keys -t '$SESSION' 'Leggi AGENTS.md ed esegui il maintainer-sweep come da procedura. Se sei fuori working hours, logga e autodistruggiti subito. Quando hai finito, autodistruggiti come da sezione self-destruct.'
  sleep 1 && tmux send-keys -t '$SESSION' Enter
  sleep 2 && tmux send-keys -t '$SESSION' Enter
" >/dev/null 2>&1 < /dev/null &
disown 2>/dev/null

# 7) Log spawn evento per tracciabilità.
ROUND_ID="$(date -u +%Y%m%dT%H%M%SZ)-maint"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "{\"ts\":\"$TS\",\"round_id\":\"$ROUND_ID\",\"session\":\"$SESSION\",\"role\":\"mantenitore\",\"event\":\"spawn\",\"src\":\"spawn-maintainer.sh\"}" >> "$LOGS_DIR/mantenitore-actions.jsonl"

echo "[spawn-maintainer] $SESSION avviato — workdir=$MANT_DIR — round=$ROUND_ID"

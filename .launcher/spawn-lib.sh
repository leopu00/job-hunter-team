#!/usr/bin/env bash
# .launcher/spawn-lib.sh — parti comuni di spawn-doctor.sh e spawn-maintainer.sh.
#
# I due script sono gemelli (kill-then-create di una sessione tmux one-shot con
# il REPL del provider attivo) ma erano copie divergenti: il Dottore non
# installava le proprie skill (le 7 di agents/dottore/skills.list restavano sul
# disco dell'immagine e `session-refresh`, citata dal suo prompt, non era
# apribile), il PATH del pane non includeva /opt/jht-deps/bin e il fallback di
# ricerca del prompt differiva. Qui vive UNA implementazione sola; gli script
# restano due, con la stessa interfaccia di prima (nessun argomento, env
# JHT_HOME, stessi messaggi su stdout, stessi exit code).
#
# Sourced da: spawn-doctor.sh, spawn-maintainer.sh.

# PATH del pane tmux: `tmux new-session -d` apre una shell NON interattiva che
# non legge .bashrc, quindi i CLI (codex/claude/kimi) e gli extra installati
# dagli agenti (/opt/jht-deps/bin, vedi JHT_DEPS_PREFIX nel Dockerfile) non
# sarebbero nel PATH.
#
# ⚠️ `/opt/jht-deps/npm-global/bin` è OBBLIGATORIO e va tenuto in lista: da
# quando le dipendenze vivono nel volume, `providers update` installa i CLI
# lì, NON più in `/jht_home/.npm-global/bin`. Senza quella voce il pane resta
# su `bash` e lo spawn muore con "REPL (claude) non partito" — visto in campo
# il 2026-07-27: Dottore e Mantenitore in retry-loop su una VPS dove i worker
# giravano benissimo, perché `start-agent.sh` compone un PATH più ricco e solo
# questi due passano di qui.
JHT_SPAWN_PANE_PATH='/app/agents/_tools:/opt/jht-deps/bin:/opt/jht-deps/npm-global/bin:/jht_home/.npm-global/bin:/home/jht/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

# jht_spawn_kill_sessions <regex-sessione> <label>
#   Killa ogni sessione tmux che matcha (idempotente: ne resta esattamente una,
#   quella che il chiamante sta per creare).
jht_spawn_kill_sessions() {
  local pattern="$1" label="$2" existing s
  existing=$(tmux ls 2>/dev/null | awk -F: '{print $1}' | grep -iE "$pattern" || true)
  for s in $existing; do
    echo "[$label] killing old session: $s"
    tmux kill-session -t "$s" 2>/dev/null || true
  done
}

# jht_spawn_sync_prompt <ruolo> <workdir> <label>
#   Copia il prompt corrente in <workdir>/AGENTS.md (standard Codex/Kimi).
#   Source di verità: /app/agents/<ruolo>/<ruolo>.md; fallback sul mount
#   alternativo in $JHT_HOME. Riallinea a ogni spawn, così un update del
#   prompt lo vede subito il prossimo agente.
jht_spawn_sync_prompt() {
  local role="$1" workdir="$2" label="$3" src cand
  src="/app/agents/$role/$role.md"
  if [ ! -f "$src" ]; then
    for cand in "/app/agents/$role/$role.md" "${JHT_HOME:-/jht_home}/agents/$role/$role.md"; do
      if [ -f "$cand" ]; then src="$cand"; break; fi
    done
  fi
  if [ -f "$src" ]; then
    cp "$src" "$workdir/AGENTS.md"
  else
    echo "[$label] WARN: prompt sorgente non trovato — partirà senza AGENTS.md fresh"
  fi
}

# jht_spawn_copy_skills <ruolo> <workdir> <label>
#   Installa nella workdir le skill dichiarate in agents/<ruolo>/skills.list.
#   Claude legge .claude/skills/, Codex/Kimi leggono .agents/skills/: popoliamo
#   entrambe come fa start-agent.sh, così l'agente funziona con ogni provider.
#   Ogni spawn riscrive le cartelle → un cambio di manifest è preso al volo.
jht_spawn_copy_skills() {
  local role="$1" workdir="$2" label="$3"
  local lib="/app/agents/_skills" manifest="/app/agents/$role/skills.list"
  local dest name line
  [ -f "$manifest" ] || return 0
  for dest in "$workdir/.claude/skills" "$workdir/.agents/skills"; do
    mkdir -p "$dest" 2>/dev/null || continue
    while IFS= read -r line || [ -n "$line" ]; do
      # strip del commento inline + spazi (il manifest è documentato)
      name="${line%%#*}"
      name="$(printf '%s' "$name" | tr -d '[:space:]')"
      [ -z "$name" ] && continue
      if [ ! -d "$lib/$name" ]; then
        echo "[$label] WARN: skill '$name' in skills.list ma assente in $lib" >&2
        continue
      fi
      rm -rf "$dest/$name" 2>/dev/null || true
      cp -R "$lib/$name" "$dest/$name" 2>/dev/null || true
    done < "$manifest"
  done
}

# jht_spawn_codex_dismiss_update
#   Soppressione dell'auto-update interattivo di Codex (stesso fix di
#   start-agent.sh): senza, gli Enter di auto-accept trigano `npm install -g`
#   e la sessione cade sulla shell.
jht_spawn_codex_dismiss_update() {
  local f="${JHT_HOME:-/jht_home}/.codex/version.json"
  [ -f "$f" ] || return 0
  command -v python3 >/dev/null 2>&1 || return 0
  python3 - "$f" <<'PYEOF' || true
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
}

# jht_spawn_repl_cmd
#   Stampa il comando REPL del PROVIDER ATTIVO (non più codex hardcoded: su un
#   setup claude, lanciare codex fallirebbe per CLI/auth assenti). effort=high
#   per diagnosi/sweep non superficiali. Per claude pre-seed dell'onboarding
#   (skip del wizard TUI) + IS_SANDBOX.
jht_spawn_repl_cmd() {
  local home="${JHT_HOME:-/jht_home}" provider
  provider=$(python3 -c "import json;print(json.load(open('$home/jht.config.json')).get('active_provider','claude'))" 2>/dev/null || echo claude)
  case "$provider" in
    openai|codex) printf '%s\n' "codex --yolo -c model_reasoning_effort=high" ;;
    kimi)         printf '%s\n' "kimi --yolo" ;;
    *)
      python3 - "$home/.claude.json" <<'PYDOC' 2>/dev/null || true
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
      printf '%s\n' "IS_SANDBOX=1 claude --dangerously-skip-permissions --effort high --model sonnet" ;;
  esac
}

# jht_spawn_active_provider — nome del provider attivo (per i messaggi d'errore).
jht_spawn_active_provider() {
  local home="${JHT_HOME:-/jht_home}"
  python3 -c "import json;print(json.load(open('$home/jht.config.json')).get('active_provider','claude'))" 2>/dev/null || echo claude
}

# jht_spawn_wait_repl <sessione> <cmd> <label> <ruolo> <logs_dir> <src>
#   Verifica che il REPL sia EFFETTIVAMENTE partito prima che il chiamante
#   inietti il prompt: se il CLI crasha al boot (auth assente, binario ko), il
#   pane ricade su una shell e il prompt-di-lavoro verrebbe eseguito come
#   comando, riportando "avviato" falsamente. Poll di pane_current_command,
#   1 retry, poi log spawn_failed + return 1 (il chiamante esce 1 e il watchdog
#   ritenta).
jht_spawn_wait_repl() {
  local session="$1" cmd="$2" label="$3" role="$4" logs_dir="$5" src="$6"
  local repl_up=0 attempt=1 _i pane last_cmd ts_fail
  while : ; do
    for _i in $(seq 1 12); do
      sleep 1
      pane=$(tmux display-message -p -t "$session" '#{pane_current_command}' 2>/dev/null || echo "")
      case "$pane" in
        ""|bash|sh|zsh|dash|-bash|-sh|-zsh) : ;;  # shell o vuoto → non ancora su
        *) repl_up=1; break ;;                     # un processo gira → REPL up
      esac
    done
    [ "$repl_up" -eq 1 ] && return 0
    if [ "$attempt" -ge 2 ]; then
      last_cmd=$(tmux display-message -p -t "$session" '#{pane_current_command}' 2>/dev/null || echo "?")
      echo "[$label] ERROR: REPL ($(jht_spawn_active_provider)) non partito dopo 2 tentativi (pane=$last_cmd) — spawn fallito" >&2
      ts_fail="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf '{"ts":"%s","session":"%s","role":"%s","event":"spawn_failed","reason":"repl_not_up","pane_cmd":"%s","src":"%s"}\n' \
        "$ts_fail" "$session" "$role" "$last_cmd" "$src" >> "$logs_dir/$role-actions.jsonl"
      tmux kill-session -t "$session" 2>/dev/null || true
      return 1
    fi
    echo "[$label] REPL non salito (tentativo $attempt) — retry" >&2
    tmux send-keys -t "$session" C-c 2>/dev/null || true
    sleep 1
    tmux send-keys -t "$session" "$cmd" C-m
    attempt=$((attempt + 1))
  done
}

# jht_spawn_kickoff <sessione> <prompt>
#   Auto-accept dei trust/approval dialog (3 Enter cadenzati) e SOLO DOPO
#   iniezione del prompt iniziale. setsid scollega dal nostro process group,
#   così il watchdog può uscire senza ammazzare gli sleep. Cadenze allungate:
#   codex ci mette ~6s a renderizzare il banner e gli Enter mandati prima
#   finiscono nel buffer della shell senza chiudere il dialog. L'Enter finale
#   compensa il lag di Ink tra type e submit.
jht_spawn_kickoff() {
  local session="$1" prompt="$2"
  JHT_SPAWN_SESSION="$session" JHT_SPAWN_PROMPT="$prompt" setsid sh -c '
    sleep 6 && tmux send-keys -t "$JHT_SPAWN_SESSION" Enter
    sleep 3 && tmux send-keys -t "$JHT_SPAWN_SESSION" Enter
    sleep 3 && tmux send-keys -t "$JHT_SPAWN_SESSION" Enter
    sleep 4 && tmux send-keys -t "$JHT_SPAWN_SESSION" "$JHT_SPAWN_PROMPT"
    sleep 1 && tmux send-keys -t "$JHT_SPAWN_SESSION" Enter
    sleep 2 && tmux send-keys -t "$JHT_SPAWN_SESSION" Enter
  ' >/dev/null 2>&1 < /dev/null &
  disown 2>/dev/null || true
}

# jht_spawn_log_event <logs_dir> <ruolo> <sessione> <round_id> <src>
jht_spawn_log_event() {
  local logs_dir="$1" role="$2" session="$3" round_id="$4" src="$5" ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '{"ts":"%s","round_id":"%s","session":"%s","role":"%s","event":"spawn","src":"%s"}\n' \
    "$ts" "$round_id" "$session" "$role" "$src" >> "$logs_dir/$role-actions.jsonl"
}

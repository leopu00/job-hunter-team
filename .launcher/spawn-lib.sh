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
# Sourced da: spawn-doctor.sh, spawn-maintainer.sh e — per la sola risoluzione
# del locale utente — start-agent.sh, che di questo file usa
# `jht_spawn_user_locale`. Il source va tenuto privo di effetti collaterali
# fatali: start-agent.sh gira sotto `set -euo pipefail`.

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
#
# `/opt/jht-deps/python/bin` è lo stesso difetto sul percorso accanto: lì
# `providers update` mette `uv` (`pip3 install --user` con
# PYTHONUSERBASE=/opt/jht-deps/python, vedi cli/src/commands/providers.js), ed
# è l'UNICO posto dell'immagine in cui `uv` esiste — non è in requirements.txt
# né in apt. Il PATH del container (Dockerfile e docker-compose.yml) lo ha,
# questa lista no: `kimi` si trovava, `uv` no. Da qui l'ordine sotto: i
# percorsi noti nella STESSA sequenza del PATH del container.
#
# ── perché la lista resta esplicita ──────────────────────────────────────────
# Il commit che aggiunse npm-global/bin si chiedeva se non convenisse ereditare
# il PATH come fa `start-agent.sh` invece di mantenere una copia. Ereditare e
# basta qui non si può: questi script non vengono invocati solo dal watchdog
# (che ha il PATH del container), ma anche da un agente via la skill
# `spawn-doctor` / `agent-emergency`, e Codex/Kimi in --yolo lanciano i comandi
# da sub-shell `bash -l` che /etc/login.defs ripulisce — è scritto nel
# Dockerfile, ed è il motivo per cui i tool di `_tools` sono symlinkati in
# /usr/local/bin. Un PATH puramente ereditato farebbe partire il Dottore o no a
# seconda di CHI lo spawna: un guasto intermittente, molto peggio di una lista
# che marcisce in modo uguale per tutti.
#
# Quindi: entrambe le cose. La lista esplicita è il pavimento — deterministico,
# indipendente dal chiamante — e il PATH ereditato le va IN CODA, così un
# percorso d'installazione che si sposta domani viene raccolto da solo senza
# toccare questo file. In coda e non in testa: le priorità già funzionanti non
# si spostano. Il dedup (prima occorrenza vince, esattamente come la risoluzione
# di PATH) serve solo a non stampare nel pane una riga lunga il doppio.
jht_spawn_pane_path() {
  local base out
  base='/app/agents/_tools:/opt/jht-deps/bin:/opt/jht-deps/npm-global/bin:/opt/jht-deps/python/bin:/jht_home/.npm-global/bin:/home/jht/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  out="$(printf '%s' "${base}${PATH:+:$PATH}" | awk -v RS=: -v ORS= '
    $0 != "" && !seen[$0]++ { printf "%s%s", (n++ ? ":" : ""), $0 }' 2>/dev/null)"
  # Il dedup è cosmetico: se awk mancasse, meglio un PATH lungo il doppio che
  # un pane con `export PATH=''`.
  [ -n "$out" ] || out="${base}${PATH:+:$PATH}"
  printf '%s' "$out"
}
# `|| true`: questo file è sourceable anche da uno script con `set -e`
# (start-agent.sh). Un'assegnazione da command substitution che fallisce
# fa uscire il chiamante — e un PATH cosmetico non deve mai poterlo fare.
JHT_SPAWN_PANE_PATH="$(jht_spawn_pane_path)" || true

# jht_spawn_session_name <role> <prefix> [instance]
# jht_spawn_agent_name   <role>          [instance]
#
# Il Critico e' l'unico ruolo normalmente singleton che ammette istanze
# effimere: ogni SCRITTORE-N possiede CRITICO-SN. La scelta del provider resta
# comunque nel launcher; l'istanza decide soltanto identita' e workspace.
# Tenere questa risoluzione in funzioni sourceable permette un controtest senza
# avviare tmux o un CLI reale.
jht_spawn_session_name() {
  local role="$1" prefix="$2" instance="${3:-}"
  if [ "$role" = "critico" ] && [ -n "$instance" ]; then
    case "$instance" in
      0|0[0-9]*|*[!0-9]*|"") return 2 ;;
    esac
    printf '%s' "${prefix}-S${instance}"
    return 0
  fi
  case "$role" in
    capitano|critico|sentinella|assistente|mentor)
      printf '%s' "$prefix"
      ;;
    *)
      [ -n "$instance" ] || instance="1"
      case "$instance" in
        0|0[0-9]*|*[!0-9]*|"") return 2 ;;
      esac
      printf '%s' "${prefix}-${instance}"
      ;;
  esac
}

jht_spawn_agent_name() {
  local role="$1" instance="${2:-}"
  if [ "$role" = "critico" ] && [ -n "$instance" ]; then
    case "$instance" in
      0|0[0-9]*|*[!0-9]*|"") return 2 ;;
    esac
    printf '%s' "${role}-S${instance}"
    return 0
  fi
  case "$role" in
    capitano|critico|sentinella|assistente|mentor)
      printf '%s' "$role"
      ;;
    *)
      [ -n "$instance" ] || instance="1"
      case "$instance" in
        0|0[0-9]*|*[!0-9]*|"") return 2 ;;
      esac
      printf '%s' "${role}-${instance}"
      ;;
  esac
}

# jht_spawn_user_locale
#   Locale dell'utente, con la cascata canonica (in ordine di priorità):
#     1. $JHT_HOME/i18n-prefs.json::locale — scelta persistente canonica
#     2. $JHT_LANG (env) — bootstrap/test, soltanto se la scelta non esiste
#     3. host.env::JHT_LANG — persistito dal preflight di host-setup.sh
#     4. 'en' — la lingua master dei template
#
#   Viveva SOLO dentro start-agent.sh, quindi gli unici due agenti che non
#   passano di lì — Dottore e Mantenitore — leggevano sempre il prompt EN e si
#   portavano in workspace tutte e 6 le traduzioni di ogni skill, pur essendo
#   `<ruolo>.<locale>.md` versionati e allineati al baseline. Qui è una funzione
#   sola, sourceata da entrambi i lati: la parità dichiarata in testa a questo
#   file vale anche sull'i18n.
jht_spawn_user_locale() {
  local locale="" prefs host_env home
  home="${JHT_HOME:-$HOME/.jht}"
  prefs="$home/i18n-prefs.json"
  if [ -f "$prefs" ] && command -v jq >/dev/null 2>&1; then
    locale="$(jq -r '.locale // empty' "$prefs" 2>/dev/null || true)"
    [ "$locale" = "null" ] && locale=""
  fi
  case "$locale" in en|it|hu|es|de|fr|pt) ;; *) locale="" ;; esac
  if [ -z "$locale" ]; then
    locale="${JHT_LANG:-}"
    case "$locale" in en|it|hu|es|de|fr|pt) ;; *) locale="" ;; esac
  fi
  host_env="$home/host.env"
  if [ -z "$locale" ] && [ -f "$host_env" ]; then
    locale="$(grep -E '^JHT_LANG=' "$host_env" 2>/dev/null | cut -d= -f2 | tr -d '"' | head -1)"
    case "$locale" in en|it|hu|es|de|fr|pt) ;; *) locale="" ;; esac
  fi
  [ -z "$locale" ] && locale="en"
  printf '%s' "$locale"
}

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
#   Source di verità: /app/agents/<ruolo>/<ruolo>.<locale>.md, con fallback sul
#   baseline EN <ruolo>.md e, per entrambi, sul mount alternativo in $JHT_HOME.
#   Stessa convenzione di start-agent.sh: il fallback al baseline è silenzioso
#   perché 'en' è la lingua master. Riallinea a ogni spawn, così un update del
#   prompt lo vede subito il prossimo agente.
jht_spawn_sync_prompt() {
  local role="$1" workdir="$2" label="$3" src cand locale home
  locale="$(jht_spawn_user_locale)"
  home="${JHT_HOME:-/jht_home}"
  src=""
  for cand in \
    "/app/agents/$role/$role.$locale.md" \
    "/app/agents/$role/$role.md" \
    "$home/agents/$role/$role.$locale.md" \
    "$home/agents/$role/$role.md"; do
    if [ -f "$cand" ]; then src="$cand"; break; fi
  done
  if [ -n "$src" ]; then
    cp "$src" "$workdir/AGENTS.md"
  else
    echo "[$label] WARN: source prompt not found — starting without a fresh AGENTS.md"
  fi
}

# jht_spawn_copy_skills <ruolo> <workdir> <label> [provider]
#   Installa nella workdir le skill condivise dichiarate nel manifest e tutte
#   le private del ruolo. JHT_APP_ROOT e' configurabile solo per gli scaffold
#   riproducibili; nel container resta /app.
#   Claude legge .claude/skills/; Codex legge .agents/skills/; Kimi supporta
#   entrambi ma usiamo il generico .agents/skills/ per non duplicare la stessa
#   skill tra scope brand e generic. Se il provider manca/non e' riconosciuto,
#   il fallback conserva il mirror su entrambi i path.
#   Ogni spawn riscrive le cartelle → un cambio di manifest è preso al volo.
#   Locale-aware come start-agent.sh: SKILL.<locale>.md diventa SKILL.md e le
#   varianti spariscono dalla workspace — l'agente vede UN solo SKILL.md,
#   nella sua lingua, invece di leggersi 6 traduzioni a ogni giro.
jht_spawn_copy_skills() {
  local role="$1" workdir="$2" label="$3"
  local provider="${4:-}"
  local app_root="${JHT_APP_ROOT:-/app}"
  local lib="$app_root/agents/_skills"
  local manifest="$app_root/agents/$role/skills.list"
  local private="$app_root/agents/$role/_skills"
  local dest name line locale localized src skill
  local -a destinations
  locale="$(jht_spawn_user_locale)"

  # Puliamo sempre entrambi: dopo un cambio provider nessuna skill del vecchio
  # scope deve restare visibile al nuovo processo.
  rm -rf "$workdir/.claude/skills" "$workdir/.agents/skills" 2>/dev/null || true
  case "$provider" in
    anthropic|claude) destinations=("$workdir/.claude/skills") ;;
    openai|codex|kimi) destinations=("$workdir/.agents/skills") ;;
    *) destinations=("$workdir/.claude/skills" "$workdir/.agents/skills") ;;
  esac

  for dest in "${destinations[@]}"; do
    mkdir -p "$dest" 2>/dev/null || continue

    if [ -f "$manifest" ]; then
      while IFS= read -r line || [ -n "$line" ]; do
        # strip del commento inline + spazi (il manifest e' documentato)
        name="${line%%#*}"
        name="$(printf '%s' "$name" | tr -d '[:space:]')"
        [ -z "$name" ] && continue
        # _lib contiene dipendenze delle skill, non una skill discoverable.
        [ "$name" = "_lib" ] && continue
        src="$lib/$name"
        if [ ! -d "$src" ]; then
          echo "[$label] WARN: skill '$name' is listed in skills.list but is missing from $lib" >&2
          continue
        fi
        cp -R "$src" "$dest/$name" 2>/dev/null || true
        # Locale-aware: SKILL.<locale>.md vince su SKILL.md (fallback
        # silenzioso sul baseline EN), poi via le varianti.
        localized="$src/SKILL.$locale.md"
        if [ "$locale" != "en" ] && [ -f "$localized" ]; then
          cp "$localized" "$dest/$name/SKILL.md" 2>/dev/null || true
        fi
        rm -f "$dest/$name"/SKILL.*.md 2>/dev/null || true
      done < "$manifest"
    fi

    if [ -d "$private" ]; then
      for skill in "$private"/*/; do
        [ -d "$skill" ] || continue
        name="$(basename "$skill")"
        [ "$name" = "_lib" ] && continue
        src="${skill%/}"
        cp -R "$src" "$dest/$name" 2>/dev/null || true
        localized="$src/SKILL.$locale.md"
        if [ "$locale" != "en" ] && [ -f "$localized" ]; then
          cp "$localized" "$dest/$name/SKILL.md" 2>/dev/null || true
        fi
        rm -f "$dest/$name"/SKILL.*.md 2>/dev/null || true
      done
    fi
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
  local provider="${1:-}"
  if [ -z "$provider" ]; then
    provider="$(jht_spawn_active_provider)" || return 2
  fi
  case "$provider" in
    openai|codex) printf '%s\n' "codex --yolo -c model_reasoning_effort=high" ;;
    kimi|moonshot) printf '%s\n' "kimi --yolo" ;;
    claude|anthropic)
      local home="${JHT_HOME:-/jht_home}"
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
    *)
      echo "[spawn-lib] ERROR: unsupported configured provider '$provider'" >&2
      return 2
      ;;
  esac
}

# jht_spawn_active_provider — nome del provider attivo (per i messaggi d'errore).
jht_spawn_active_provider() {
  local home="${JHT_HOME:-/jht_home}" provider
  provider="$(python3 - "$home/jht.config.json" <<'PYEOF'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        value = str(json.load(handle).get("active_provider") or "").strip().lower()
except Exception:
    raise SystemExit(2)
if value not in {"claude", "anthropic", "openai", "codex", "kimi", "moonshot"}:
    raise SystemExit(2)
print(value)
PYEOF
  )" || {
    echo "[spawn-lib] ERROR: active_provider is missing, unreadable or unsupported in '$home/jht.config.json'" >&2
    return 2
  }
  printf '%s\n' "$provider"
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
      echo "[$label] ERROR: REPL ($(jht_spawn_active_provider)) did not start after 2 attempts (pane=$last_cmd) — spawn failed" >&2
      ts_fail="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      printf '{"ts":"%s","session":"%s","role":"%s","event":"spawn_failed","reason":"repl_not_up","pane_cmd":"%s","src":"%s"}\n' \
        "$ts_fail" "$session" "$role" "$last_cmd" "$src" >> "$logs_dir/$role-actions.jsonl"
      tmux kill-session -t "$session" 2>/dev/null || true
      return 1
    fi
    echo "[$label] REPL did not start (attempt $attempt) — retrying" >&2
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

#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  codex-auth-healer.sh — #6 mitigazione: refresh-token Codex condiviso    ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  PROBLEMA (#6): tutti gli agenti Codex condividono UN solo               ║
# ║  $JHT_HOME/.codex/auth.json. Quando un agente fa il refresh OAuth, ruota ║
# ║  il refresh_token e lo riscrive nel file; gli ALTRI agenti hanno ancora  ║
# ║  il token vecchio IN MEMORIA → al loro refresh ottengono                 ║
# ║  "Your session has ended. Please log in again." e si bloccano.           ║
# ║                                                                          ║
# ║  INSIGHT: il FILE auth.json ha sempre l'ultimo token VALIDO (l'ha        ║
# ║  scritto chi ha refreshato per ultimo). L'agente bloccato ha solo una    ║
# ║  copia stale in memoria → basta RIAVVIARLO perché ri-legga il file       ║
# ║  fresco e torni operativo. Questo healer rileva il marker di fallimento  ║
# ║  nel pane e riavvia l'agente.                                            ║
# ║                                                                          ║
# ║  Standalone (non tocca agent-watchdog.sh): proprio loop detached.        ║
# ║  Idempotente, con cooldown per evitare restart-storm quando il file è    ║
# ║  davvero morto (es. login dello stesso account altrove).                 ║
# ║                                                                          ║
# ╚══════════════════════════════════════════════════════════════════════════╝
set +e

JHT_HOME="${JHT_HOME:-/jht_home}"
JHT_ENTRY="${JHT_ENTRY:-/app/cli/bin/jht.js}"
HALT_FLAG="$JHT_HOME/.team-halted.flag"
# Gli ALTRI due freni che i tre watchdog rispettano già e questo ignorava
# ([HEALER-BLIND-TO-GATES-AND-ROLES]). Non è un dettaglio: qui si fa
# `tmux kill-session` + `team start <role>`, cioè un kick-off LLM. In standby a
# spesa zero questo era l'UNICO processo capace di far ripartire una TUI e
# rimettersi a spendere — esattamente ciò che lo standby esiste per impedire.
WEEKLY_HALT_FLAG="$JHT_HOME/.weekly-halt.flag"
TEAM_STANDBY_FLAG="$JHT_HOME/.team-standby.flag"
LOG="$JHT_HOME/logs/codex-auth-healer.log"
STATE_DIR="$JHT_HOME/logs/.auth-healer"
INTERVAL="${CODEX_AUTH_HEALER_INTERVAL:-60}"   # poll ogni 60s
COOLDOWN="${CODEX_AUTH_HEALER_COOLDOWN:-300}"  # max 1 restart/agente ogni 5 min
mkdir -p "$STATE_DIR" "$(dirname "$LOG")" 2>/dev/null

# Marker di fallimento auth nel pane Codex.
AUTH_FAIL_RE='session has ended|Please log in again|Failed to refresh token|401 Unauthorized|invalid_grant'

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"; }

# ── Fonti uniche: ruoli e standby ─────────────────────────────────────────
# NIENTE liste di ruoli scritte a mano qui. La mappa `AGENTS` che c'era prima
# elencava cinque sessioni che il matching per pattern già risolveva (righe
# morte) e NON conteneva né `scrittore` né `critico`: `role_of` tornava vuoto e
# i due ruoli che producono il deliverable finale non venivano mai curati con
# un refresh-token Codex stale. I ruoli arrivano da `team_roster.py roles`
# (WORKER + CORE + EFFIMERI), che è anche la fonte del respawn.
ROSTER_PY="${JHT_TEAM_ROSTER_PY:-/app/shared/skills/team_roster.py}"
[ -f "$ROSTER_PY" ] || ROSTER_PY="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)/shared/skills/team_roster.py"
STANDBY_PY="${JHT_STANDBY_PY:-/app/shared/skills/standby.py}"
[ -f "$STANDBY_PY" ] || STANDBY_PY="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)/shared/skills/standby.py"

KNOWN_ROLES=""
EPHEMERAL_ROLES=""

upper_of() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

is_ephemeral() {
  local r
  for r in $EPHEMERAL_ROLES; do [ "$r" = "$1" ] && return 0; done
  return 1
}

load_roles() {
  # Lista vuota = non curiamo NIENTE (direzione sicura: zero kick-off, zero
  # spesa) ma rumorosa: senza i ruoli questo processo è cieco, e un healer
  # cieco che tace è il guasto invisibile che il ticket documenta.
  KNOWN_ROLES="$(JHT_HOME="$JHT_HOME" python3 "$ROSTER_PY" roles 2>/dev/null | tr '\n' ' ')"
  if [ -z "${KNOWN_ROLES// /}" ]; then
    log "WARN roles cannot be read from $ROSTER_PY — no agents can be healed this cycle"
    return 1
  fi
  EPHEMERAL_ROLES="$(JHT_HOME="$JHT_HOME" python3 "$ROSTER_PY" roles --kind ephemeral 2>/dev/null | tr '\n' ' ')"
  return 0
}

# Standby ATTIVO? Stesso predicato unico dei watchdog: un flag SCADUTO non è
# più standby (fail-CLOSED sul solo `-e` se il modulo non è invocabile).
standby_active() {
  [ -e "$TEAM_STANDBY_FLAG" ] || return 1
  local state
  state="$(JHT_HOME="$JHT_HOME" python3 "$STANDBY_PY" active 2>/dev/null)"
  case "$state" in
    active)              return 0 ;;
    expired|invalid|off) return 1 ;;
    *)                   return 0 ;;   # fallback: il flag c'è → standby
  esac
}

# Ruolo da nome sessione, per PATTERN (nessuna enumerazione di istanze):
#   CAPITANO → capitano · SCOUT-2 → scout · SCRITTORE-1 → scrittore
#   CRITICO → critico   · CRITICO-S1 → critico (spawn per-Scrittore)
# Le forme sono quelle di `team_roster.session_name()`. Restano fuori, e
# devono restarci, SENTINELLA-WORKER (pane sensore, non un agente in chat) e
# DOCTOR-WATCHDOG/DOTTORE/MANTENITORE (one-shot, li rimpiazza il loro
# scheduler): nessuno dei due matcha `RUOLO`, `RUOLO-<n>` o `RUOLO-S<n>`.
role_of() {
  local sess="$1" r up
  for r in $KNOWN_ROLES; do
    up="$(printf '%s' "$r" | tr '[:lower:]' '[:upper:]')"
    case "$sess" in
      "$up")         echo "$r"; return 0 ;;
      "$up"-[0-9]*)  echo "$r"; return 0 ;;
      "$up"-S[0-9]*) echo "$r"; return 0 ;;
    esac
  done
  echo ""
}

# ── Singleton (flock) ─────────────────────────────────────────────────────
# `start-agent.sh bridge` ha almeno tre invocatori concorrenti (agent-watchdog
# ogni 30s, la skill maintainer-sweep, la riparazione di process_health.py):
# due esecuzioni sovrapposte fanno kill→spawn entrambe e lasciano due healer
# vivi, cioè due restart per lo stesso auth-fail — due kick-off LLM invece di
# uno ([BRIDGE-SINGLETON-PARTIAL]). Il lockfile è DEDICATO: si rilascia da
# solo alla morte del processo (anche di SIGKILL) e non va mai cancellato,
# perché cancellare un file flockato ne rompe la mutua esclusione.
# Se `flock` non c'è (mount non-POSIX, bind Windows) si prosegue: meglio un
# healer senza lock che nessun healer — il kill-by-marker dello spawner resta.
LOCK_FILE="$JHT_HOME/logs/codex-auth-healer.lock"
if ! command -v flock >/dev/null 2>&1; then
  log "WARN flock unavailable — continuing without singleton lock"
elif ! : >>"$LOCK_FILE" 2>/dev/null; then
  # Verificata PRIMA di `exec`: un errore di redirezione su `exec` fa uscire
  # una shell non interattiva, e un lockfile non scrivibile ucciderebbe il
  # healer invece di degradarlo.
  log "WARN lockfile is not writable ($LOCK_FILE) — continuing without singleton lock"
else
  exec 9>>"$LOCK_FILE"
  if ! flock -n 9; then
    log "another instance is running (lock $LOCK_FILE); exiting"
    exit 0
  fi
fi

load_roles
log "codex-auth-healer started (interval=${INTERVAL}s cooldown=${COOLDOWN}s roles='${KNOWN_ROLES}')"

while true; do
  # Rispetta lo Stop utente, il weekly-halt e lo standby a spesa zero: un
  # restart qui è un kick-off LLM, cioè spesa. Gli stessi tre gate degli altri
  # watchdog — un curatore non è una deroga ai freni di sicurezza.
  if [ -f "$HALT_FLAG" ] || [ -f "$WEEKLY_HALT_FLAG" ] || standby_active; then
    sleep "$INTERVAL"; continue
  fi

  # I ruoli possono non essere leggibili al primo giro (bind mount non ancora
  # pronto): si riprova, non si resta ciechi per sempre.
  [ -z "${KNOWN_ROLES// /}" ] && { load_roles || { sleep "$INTERVAL"; continue; }; }

  # Itera le session tmux vive che ci interessano.
  for sess in $(tmux list-sessions -F '#{session_name}' 2>/dev/null); do
    role="$(role_of "$sess")"
    [ -z "$role" ] && continue

    pane="$(tmux capture-pane -t "$sess" -p 2>/dev/null | tail -25)"
    echo "$pane" | grep -qaE "$AUTH_FAIL_RE" || continue

    # Cooldown per-agente: evita restart-storm se il file auth è davvero morto.
    cd_file="$STATE_DIR/$sess"
    now=$(date +%s)
    last=$(cat "$cd_file" 2>/dev/null || echo 0)
    if [ $((now - last)) -lt "$COOLDOWN" ]; then
      log "$sess: auth failure detected during cooldown (last restart $((now - last))s ago); skipped"
      continue
    fi
    echo "$now" > "$cd_file"

    log "$sess: AUTH FAILURE detected ('session has ended'/refresh); restarting to reload the current auth.json"
    tmux kill-session -t "$sess" 2>/dev/null
    sleep 1

    # Sessione EFFIMERA con nome non canonico (`CRITICO-S1`, spawnata dallo
    # Scrittore dentro critic-loop): `team start critico` creerebbe un
    # `CRITICO` singleton che NON è la sessione che lo Scrittore sta
    # aspettando — un doppione, non una cura. Qui il kill È la cura: il
    # proprietario la ricrea col nome giusto e ri-legge auth.json fresca.
    if is_ephemeral "$role" && [ "$sess" != "$(upper_of "$role")" ]; then
      log "$sess: ephemeral session ($role) — killing without restart; its owner will recreate it"
      continue
    fi

    node "$JHT_ENTRY" team start "$role" >>"$LOG" 2>&1
    log "$sess: restart ($role) sent"
  done

  sleep "$INTERVAL"
done

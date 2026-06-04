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
LOG="$JHT_HOME/logs/codex-auth-healer.log"
STATE_DIR="$JHT_HOME/logs/.auth-healer"
INTERVAL="${CODEX_AUTH_HEALER_INTERVAL:-60}"   # poll ogni 60s
COOLDOWN="${CODEX_AUTH_HEALER_COOLDOWN:-300}"  # max 1 restart/agente ogni 5 min
mkdir -p "$STATE_DIR" "$(dirname "$LOG")" 2>/dev/null

# Marker di fallimento auth nel pane Codex.
AUTH_FAIL_RE='session has ended|Please log in again|Failed to refresh token|401 Unauthorized|invalid_grant'

# Agenti gestiti: session tmux → ruolo per `jht team start`.
# (solo gli agenti Codex/LLM persistenti; il Dottore è one-shot, lo salta)
declare -A AGENTS=(
  [ASSISTENTE]=assistente [CAPITANO]=capitano [MENTOR]=mentor
  [SENTINELLA]=sentinella [SCOUT-1]=scout [SCOUT-2]=scout
  [ANALISTA-1]=analista [ANALISTA-2]=analista [SCORER-1]=scorer
)

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"; }

# ruolo da nome session (gestisce SCOUT-N / ANALISTA-N / SCORER-N generici)
role_of() {
  local sess="$1"
  case "$sess" in
    SCOUT-*)    echo "scout" ;;
    ANALISTA-*) echo "analista" ;;
    SCORER-*)   echo "scorer" ;;
    *)          echo "${AGENTS[$sess]:-}" ;;
  esac
}

log "codex-auth-healer avviato (interval=${INTERVAL}s cooldown=${COOLDOWN}s)"

while true; do
  # Rispetta lo Stop utente: se il team è halted, non riavviare nulla.
  if [ -f "$HALT_FLAG" ]; then sleep "$INTERVAL"; continue; fi

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
      log "$sess: auth-fail rilevato ma in cooldown (ultimo restart $((now - last))s fa) — skip"
      continue
    fi
    echo "$now" > "$cd_file"

    log "$sess: AUTH-FAIL rilevato ('session has ended'/refresh) → restart per ri-leggere auth.json fresca"
    tmux kill-session -t "$sess" 2>/dev/null
    sleep 1
    node "$JHT_ENTRY" team start "$role" >>"$LOG" 2>&1
    log "$sess: restart ($role) inviato"
  done

  sleep "$INTERVAL"
done

#!/usr/bin/env bash
# .launcher/start-agent.sh — Avvia un singolo agente del Job Hunter Team
# Uso: ./start-agent.sh <ruolo> [istanza] [mode]
#
# Ruoli: capitano, scout, analista, scorer, scrittore, critico, sentinella, assistente
# Istanza: numero per agenti multipli (es: scout 1 → SCOUT-1)
# Mode: default|fast (default se omesso)
#
# Il template CLAUDE.md viene copiato da agents/<ruolo>/<ruolo>.md nel workspace.
set -euo pipefail

# PATH robusto: senza questo, quando un agente Codex/Claude chiama
# `bash /app/.launcher/start-agent.sh scout 1` da dentro la sua TUI, il
# sub-shell eredita il PATH minimale della shell login (/usr/local/bin:
# /usr/bin:/bin:...) — manca /jht_home/.npm-global/bin dove vivono
# codex/claude/kimi, e lo script esce con "codex: command not found".
# Esportiamo esplicitamente sempre i path dei CLI qui.
export PATH="/app/agents/_tools:/jht_home/.npm-global/bin:/home/jht/.local/bin:${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"

DEV_TEAM_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DEV_TEAM_DIR/config.sh"
source "$DEV_TEAM_DIR/tui-helpers.sh"
# jht_kill_by_marker / jht_daemon_log — singleton dei daemon detached e log
# sotto $JHT_HOME/logs con rotazione (vedi daemon-lib.sh).
source "$DEV_TEAM_DIR/daemon-lib.sh"

if [ -z "${1:-}" ]; then
  echo "Uso: $0 <ruolo> [istanza] [mode]"
  echo ""
  echo "Ruoli disponibili:"
  echo "  capitano        → CAPITANO         (Coordinatore pipeline Job Hunter)"
  echo "  scout       → SCOUT-N      (Cerca posizioni lavorative)"
  echo "  analista    → ANALISTA-N   (Analizza job description e aziende)"
  echo "  scorer      → SCORER-N     (Calcola punteggio match)"
  echo "  scrittore   → SCRITTORE-N  (Scrive CV e cover letter)"
  echo "  critico     → CRITICO      (Revisione qualità CV)"
  echo "  sentinella  → SENTINELLA   (Monitora token usage e rate limit)"
  echo "  assistente  → ASSISTENTE   (Aiuta l'utente a navigare la piattaforma)"
  echo ""
  echo "Esempi:"
  echo "  $0 capitano              → avvia CAPITANO"
  echo "  $0 scout 1           → avvia SCOUT-1"
  echo "  $0 scrittore 2 fast  → avvia SCRITTORE-2 in modalità fast"
  echo "  $0 assistente        → avvia ASSISTENTE"
  exit 1
fi

ROLE="$1"
INSTANCE="${2:-}"
MODE="${3:-default}"

# ── Provider claude: pre-seed onboarding (BUG-CLAUDE-TRUST-PROMPT) ─────
# Su una install fresca la CLI claude (TUI) blocca gli agenti sul wizard
# first-run: theme-picker → browser-login → "Bypass Permissions mode".
# Pre-seediamo i flag in ~/.claude.json così la TUI salta il wizard e usa
# direttamente il token (CLAUDE_CODE_OAUTH_TOKEN) / le credenziali persistite.
# Idempotente. IS_SANDBOX=1 (esportato sotto) salta anche il warning bypass.
_ensure_claude_onboarding() {
  local home="${1:-${JHT_HOME:-/jht_home}}"
  python3 - "$home/.claude.json" <<'PY' 2>/dev/null || true
import json, sys, os
f = sys.argv[1]
try:
    d = json.load(open(f))
except Exception:
    d = {}
d["hasCompletedOnboarding"] = True
d.setdefault("theme", "dark")
d["bypassPermissionsModeAccepted"] = True
os.makedirs(os.path.dirname(f), exist_ok=True)
json.dump(d, open(f, "w"), indent=2)
PY
}

# ── Worker sentinel (fallback /usage per bridge) ─────────────────────
# Short-circuit per un ruolo speciale "worker": spawna una sessione
# SENTINELLA-WORKER con un claude CLI idle, da interrogare col comando
# /usage quando l'HTTP /api/oauth/usage di Anthropic e' 429. Non e' un
# agente del team: niente template, niente profile sync, niente kickoff,
# niente bridge. Singleton: se gia' viva, exit 0 senza errori.
if [ "$ROLE" = "worker" ]; then
  WORKER_SESSION="${JHT_SENTINEL_WORKER:-SENTINELLA-WORKER}"
  if tmux has-session -t "$WORKER_SESSION" 2>/dev/null; then
    echo "✓ $WORKER_SESSION gia' attivo"
    exit 0
  fi
  : "${JHT_HOME:=/jht_home}"
  _ensure_claude_onboarding "$JHT_HOME"
  tmux new-session -d -x 220 -y 50 -s "$WORKER_SESSION" -c "$JHT_HOME"
  tmux send-keys -t "$WORKER_SESSION" "export HOME='$JHT_HOME'" C-m
  tmux send-keys -t "$WORKER_SESSION" "export PATH='/app/agents/_tools:/jht_home/.npm-global/bin:\$PATH'" C-m
  tmux send-keys -t "$WORKER_SESSION" "export IS_SANDBOX=1" C-m
  # marcatore per agent_vitals.py: il worker era l'unico senza flag
  tmux send-keys -t "$WORKER_SESSION" "export JHT_AGENT_NAME='sentinella-worker'" C-m
  tmux send-keys -t "$WORKER_SESSION" "claude --dangerously-skip-permissions" C-m
  # Auto-respond a TUI startup prompt: detect-and-respond invece di blind
  # Enter. Claude Code 2.1.x mostra il "Bypass Permissions mode" warning
  # con default "1. No, exit" → blind Enter killa claude. Fix: capture-pane,
  # se vede il warning manda Down + Enter (sceglie "2. Yes, I accept").
  # Vedi BACKLOG [BUG-CLAUDE-TRUST-PROMPT].
  setsid sh -c "
    _i=0
    while [ \$_i -lt 6 ]; do
      sleep 2
      _pane=\$(tmux capture-pane -t '$WORKER_SESSION' -p -S -40 2>/dev/null)
      if echo \"\$_pane\" | grep -q 'Bypass Permissions mode'; then
        tmux send-keys -t '$WORKER_SESSION' Down
        sleep 1
        tmux send-keys -t '$WORKER_SESSION' Enter
        exit 0
      fi
      if echo \"\$_pane\" | grep -qE 'trust (the files|this folder|this directory)'; then
        tmux send-keys -t '$WORKER_SESSION' Enter
        exit 0
      fi
      _i=\$((_i + 1))
    done
    tmux send-keys -t '$WORKER_SESSION' Enter
  " >/dev/null 2>&1 < /dev/null &
  echo "✓ $WORKER_SESSION avviato (fallback /usage TUI per bridge)"
  exit 0
fi

# ── Bridge sentinel (V5: ruolo dedicato, non più appiccicato al capitano) ──
# Short-circuit per "bridge": spawna il sentinel-bridge.py in background.
# Non è una sessione tmux, è un processo Python detached. Singleton: killa
# eventuali bridge preesistenti prima di spawnarne uno nuovo (bug storico:
# ogni restart del Capitano accumulava un bridge in più).
#
# Lanciato dopo che CAPITANO e SENTINELLA sono già partiti e stabili, così
# il primo [BRIDGE TICK] arriva alla SENTINELLA che è già pronta a riceverlo.
if [ "$ROLE" = "bridge" ]; then
  BRIDGE_SCRIPT="/app/.launcher/sentinel-bridge.py"
  if [ ! -f "$BRIDGE_SCRIPT" ]; then
    echo "✗ $BRIDGE_SCRIPT non trovato — bridge NON partito"
    exit 1
  fi
  # Kill bridge preesistenti (pkill non è installato nell'immagine slim).
  # Matching su 'sentinel-bridge.py' copre setsid wrapper + python + figli.
  # Bug 2026-05-17 20:42: dopo recreate restavano 2 coppie process vive
  # perché SIGTERM + sleep 1 era troppo permissivo. Doppio kill TERM→KILL.
  # La scansione passa da proc-kill.py (Python): il vecchio
  # `grep -l MARKER /proc/*/cmdline` trovava anche il proprio argv e
  # qualunque processo innocente che nominasse il marker.
  # NB: il singleton VERO è il flock dentro sentinel-bridge.py (copre anche
  # l'entry point bridge-control.sh); questo kill serve al restart pulito.
  jht_kill_by_marker sentinel-bridge.py 1 0.5
  BRIDGE_LOG="$(jht_daemon_log sentinel-bridge.log)"
  setsid sh -c "
    JHT_TARGET_SESSION='${JHT_TARGET_SESSION:-CAPITANO}' \
      python3 -u $BRIDGE_SCRIPT >> '$BRIDGE_LOG' 2>&1
  " >/dev/null 2>&1 < /dev/null &
  echo "✓ sentinel-bridge partito (target=${JHT_TARGET_SESSION:-CAPITANO}, log $BRIDGE_LOG)"

  # Pacing bridge — tick alla SENTINELLA (analista del pacing) sul ritmo del
  # team (2026-06-25 push→pull: NON più al Capitano, vedi bridge-to-sentinella
  # doc). Stesso
  # pattern del sentinel-bridge: setsid + singleton (kill by marker +
  # flock nel .py) + log in $JHT_HOME/logs. Indipendente dal sentinel-bridge:
  # legge sentinel-data.jsonl (scritto dal sentinel-bridge) + token logs
  # locali, calcola Δusage / vel_team / vel_target / %/h per agente, e
  # manda un [BRIDGE PACING] alla Sentinella allineato a :00,:15,:30,:45 UTC.
  PACING_SCRIPT="/app/.launcher/pacing-bridge.py"
  if [ -f "$PACING_SCRIPT" ]; then
    jht_kill_by_marker pacing-bridge.py 1 0.5
    PACING_LOG="$(jht_daemon_log pacing-bridge.log)"
    # Niente PATH= esplicito: lo `export PATH` in cima a start-agent.sh
    # (riga 18) include già /app/agents/_tools, e setsid sh -c eredita
    # le env vars del parent. Setting PATH a single-quoted lo aveva
    # rotto (BUG: $PATH non espanso → python3 not found, bridge morto).
    setsid sh -c "
      JHT_PACING_TARGET_SESSION='${JHT_PACING_TARGET_SESSION:-SENTINELLA}' \
        python3 -u $PACING_SCRIPT >> '$PACING_LOG' 2>&1
    " >/dev/null 2>&1 < /dev/null &
    echo "✓ pacing-bridge partito (target=${JHT_PACING_TARGET_SESSION:-SENTINELLA}, log $PACING_LOG)"
  else
    echo "⚠ $PACING_SCRIPT non trovato — pacing NON partito (sentinel ok)"
  fi

  # Capitano heartbeat bridge — battito ORARIO al Capitano (2026-06-26). Col
  # push→pull il Capitano non riceve più il pacing ogni 15min e si incaglia
  # quando la Sentinella tace: questo lo risveglia 1×/ora con un nudge basato sui
  # dati DB (deterministico, NON LLM), così resta attivo senza essere passivo.
  HEARTBEAT_SCRIPT="/app/.launcher/heartbeat-bridge.py"
  if [ -f "$HEARTBEAT_SCRIPT" ]; then
    jht_kill_by_marker heartbeat-bridge.py 0.5 0.5
    HEARTBEAT_LOG="$(jht_daemon_log heartbeat-bridge.log)"
    setsid sh -c "
      JHT_HEARTBEAT_SESSION='${JHT_TARGET_SESSION:-CAPITANO}' \
        python3 -u $HEARTBEAT_SCRIPT >> '$HEARTBEAT_LOG' 2>&1
    " >/dev/null 2>&1 < /dev/null &
    echo "✓ heartbeat-bridge (nudge orario al Capitano) partito (log $HEARTBEAT_LOG)"
  else
    echo "⚠ $HEARTBEAT_SCRIPT non trovato — heartbeat NON partito"
  fi

  # Window ratio meter — calibrazione auto del rapporto cap-5h/cap-weekly.
  # Daemon leggero (un pass ogni 5 min su sentinel-data.jsonl), scrive
  # ~/.jht/logs/window-ratio-state.json che provider_capacity.py blenda
  # col seed table. Inattivo per Kimi (no weekly cap): il daemon parte
  # comunque ma update_ratio scarta tutti i sample senza weekly_usage.
  WRM_SCRIPT="/app/shared/skills/window_ratio_meter.py"
  if [ -f "$WRM_SCRIPT" ]; then
    jht_kill_by_marker window_ratio_meter.py 0.5 0
    WRM_LOG="$(jht_daemon_log window-ratio-meter.log)"
    setsid sh -c "
      python3 -u $WRM_SCRIPT --watch >> '$WRM_LOG' 2>&1
    " >/dev/null 2>&1 < /dev/null &
    echo "✓ window-ratio-meter partito (log $WRM_LOG)"
  else
    echo "⚠ $WRM_SCRIPT non trovato — calibrazione auto N/D (seed only)"
  fi

  # Token-meter — nella suite dal 19/07: prima partiva SOLO a mano
  # (start-agent.sh token-meter) e senza watchdog: morto il 13/07 è
  # rimasto giù 6 giorni. Ora vive e muore con la bridge-suite.
  METER_SCRIPT="/app/shared/skills/token-meter.py"
  if [ -f "$METER_SCRIPT" ]; then
    jht_kill_by_marker token-meter.py 0 0.5
    METER_LOG="$(jht_daemon_log token-meter.log)"
    setsid sh -c "
      JHT_HOME='${JHT_HOME:-/jht_home}' \
        python3 -u $METER_SCRIPT >> '$METER_LOG' 2>&1
    " >/dev/null 2>&1 < /dev/null &
    echo "✓ token-meter partito (log $METER_LOG)"
  else
    echo "⚠ $METER_SCRIPT non trovato — token-meter N/D"
  fi

  # Agent-vitals — CPU%/RSS PER-AGENTE nel tempo (richiesta Leone 19/07:
  # il meccanismo AGENT_ID del monitor di claude-team, portato su
  # /proc/*/environ via JHT_AGENT_NAME). Scrive agent-vitals.jsonl per
  # la scheda agente del gioco. Stesso pattern: setsid + singleton.
  AV_SCRIPT="/app/shared/skills/agent_vitals.py"
  if [ -f "$AV_SCRIPT" ]; then
    jht_kill_by_marker agent_vitals.py 0 0.5
    AV_LOG="$(jht_daemon_log agent-vitals.log)"
    setsid sh -c "
      JHT_HOME='${JHT_HOME:-/jht_home}' \
        python3 -u $AV_SCRIPT >> '$AV_LOG' 2>&1
    " >/dev/null 2>&1 < /dev/null &
    echo "✓ agent-vitals partito (cpu/rss per-agente, log $AV_LOG)"
  else
    echo "⚠ $AV_SCRIPT non trovato — vitals per-agente N/D"
  fi

  # Codex auth-healer (#6) — rileva "session has ended"/refresh-fail nei pane
  # degli agenti e li riavvia per ri-leggere la auth.json CONDIVISA fresca
  # (l'ultimo refresh valido è sempre nel file → un restart cura l'agente con
  # token stale in memoria). Standalone, non tocca agent-watchdog/Dottore.
  # Stesso pattern: setsid + singleton via marker cmdline + cooldown anti-storm.
  HEALER_SCRIPT="/app/.launcher/codex-auth-healer.sh"
  if [ -f "$HEALER_SCRIPT" ]; then
    jht_kill_by_marker codex-auth-healer.sh 0 0.5
    HEALER_LOG="$(jht_daemon_log codex-auth-healer.log)"
    setsid sh -c "
      JHT_HOME='${JHT_HOME:-/jht_home}' bash $HEALER_SCRIPT >> '$HEALER_LOG' 2>&1
    " >/dev/null 2>&1 < /dev/null &
    echo "✓ codex-auth-healer partito (#6, log $HEALER_LOG)"
  fi

  exit 0
fi

# ── Telegram inbound bridge (long-poll → tmux <agente>) ───────────────
# Short-circuit per "tg-bridge": spawna 3 istanze di tg-bridge.py in
# background, una per ogni bot user-facing (assistente, capitano, mentor —
# decisione 2026-05-13 rev2). Stesso pattern del sentinel-bridge (setsid +
# singleton via /proc cmdline). Lanciato dopo che le 3 sessioni tmux sono
# partite, cosi' i primi messaggi trovano gia' sessione pronta a ricevere.
if [ "$ROLE" = "tg-bridge" ]; then
  TG_SCRIPT="/app/.launcher/tg-bridge.py"
  if [ ! -f "$TG_SCRIPT" ]; then
    echo "✗ $TG_SCRIPT non trovato — tg-bridge NON partito"
    exit 1
  fi
  # Kill TUTTE le istanze esistenti (di qualsiasi ruolo): rispawnamo 3 fresche.
  jht_kill_by_marker tg-bridge.py 0 1
  # JHT_TG_OFFSET_RESET=1 → al primo poll skippa il backlog (utile in fresh
  # install per non rifare replay di vecchi /start dell'utente).
  for _role in assistente capitano mentor; do
    _target=$(echo "$_role" | tr '[:lower:]' '[:upper:]')
    _log="$(jht_daemon_log "tg-bridge-${_role}.log")"
    setsid sh -c "
      JHT_TG_BOT_ROLE='$_role' \
      JHT_TG_TARGET_SESSION='$_target' \
      JHT_TG_OFFSET_RESET='${JHT_TG_OFFSET_RESET:-}' \
        python3 -u $TG_SCRIPT >> '$_log' 2>&1
    " >/dev/null 2>&1 < /dev/null &
    echo "✓ tg-bridge[$_role] partito (target=$_target, log $_log)"
  done
  exit 0
fi

# ── Token meter daemon (Bridge V7 Step 5) ──────────────────────────────
# Short-circuit per "token-meter": spawna il daemon Python che osserva i
# log dei provider e calcola weighted/pct + EMA ratio + per-agent rate
# (vedi shared/skills/token-meter.py). Detached/setsid + singleton via
# /proc/cmdline come gli altri bridge. Output:
#   • $JHT_HOME/logs/token-meter-state.json  (consumer: /api/tokens/status)
#   • $JHT_HOME/logs/token-meter.csv
#   • $JHT_HOME/logs/token-meter.log
if [ "$ROLE" = "token-meter" ]; then
  METER_SCRIPT="/app/shared/skills/token-meter.py"
  if [ ! -f "$METER_SCRIPT" ]; then
    echo "✗ $METER_SCRIPT non trovato — token-meter NON partito"
    exit 1
  fi
  # Kill istanze preesistenti.
  jht_kill_by_marker token-meter.py 0 1
  METER_LOG="$(jht_daemon_log token-meter.log)"
  setsid sh -c "
    JHT_HOME='${JHT_HOME:-/jht_home}' \
      python3 -u $METER_SCRIPT >> '$METER_LOG' 2>&1
  " >/dev/null 2>&1 < /dev/null &
  echo "✓ token-meter partito (log $METER_LOG)"
  exit 0
fi

# ── Agent-vitals daemon (cpu/rss per-agente, 19/07) ───────────────────
# Short-circuit per "agent-vitals": avvio manuale del sampler (parte
# comunque da solo con la bridge-suite, vedi ROLE=bridge). Attribuzione
# via JHT_AGENT_NAME in /proc/*/environ; storico su agent-vitals.jsonl.
if [ "$ROLE" = "agent-vitals" ]; then
  AV_SCRIPT="/app/shared/skills/agent_vitals.py"
  if [ ! -f "$AV_SCRIPT" ]; then
    echo "✗ $AV_SCRIPT non trovato — agent-vitals NON partito"
    exit 1
  fi
  jht_kill_by_marker agent_vitals.py 0 1
  AV_LOG="$(jht_daemon_log agent-vitals.log)"
  setsid sh -c "
    JHT_HOME='${JHT_HOME:-/jht_home}' \
      python3 -u $AV_SCRIPT >> '$AV_LOG' 2>&1
  " >/dev/null 2>&1 < /dev/null &
  echo "✓ agent-vitals partito (log $AV_LOG)"
  exit 0
fi

# Mappa ruolo → prefisso sessione | effort | model
# model: "" = default del provider (Opus per claude, gpt-5.4 per codex,
#   kimi-for-coding per kimi). Altrimenti alias come "sonnet" o nome
#   completo, passato come --model al CLI claude. Per codex/kimi il
#   model override non e' ancora cablato (aggiungere quando serve).
#
# Scelta modelli:
#   - Assistente: Sonnet high — chat conversazionale con utente,
#     non serve reasoning pesante ma serve reattivita'; Sonnet costa
#     meno di Opus e un effort high compensa il gap di capability
#   - Tutti gli altri: default del provider (Opus su claude), effort per
#     ruolo calibrato (coordinatori/spawn high, scorer medium)
#
# Nota: il ruolo "sentinella" e' stato reintrodotto come watchdog leggero
# (2026-04-25). Il monitoraggio principale del rate-limit resta del
# bridge deterministico (.launcher/sentinel-bridge.py); la sentinella LLM
# e' un livello di sicurezza sopra che interviene quando il bridge fallisce
# o serve un check fresco indipendente. Vedi agents/sentinella/sentinella.md
# per il loop e le regole. Una sola istanza, polling 10 min, sonnet.
get_agent_info() {
  case "$1" in
    # Opus high — task con reasoning pesante:
    # Capitano (coordinatore team), Scrittore (creative writing CV),
    # Critico (review di qualita' richiede nuance).
    capitano)   echo "CAPITANO|high|" ;;
    scrittore)  echo "SCRITTORE|high|" ;;
    critico)    echo "CRITICO|high|" ;;
    # Sonnet high — task I/O-bound, parsing, matching:
    # piu' veloce, costa meno, effort high compensa.
    scout)      echo "SCOUT|high|sonnet" ;;
    analista)   echo "ANALISTA|high|sonnet" ;;
    scorer)     echo "SCORER|high|sonnet" ;;
    assistente) echo "ASSISTENTE|high|sonnet" ;;
    # Mentor (user-facing always-on, come l'Assistente):
    # Opus high — coaching/posizionamento richiedono nuance reasoning.
    mentor)     echo "MENTOR|high|" ;;
    # Sonnet high — la Sentinella governa pacing/throttle/escalation: le
    # decisioni (vel vs target, ordini al Capitano) meritano effort high.
    sentinella) echo "SENTINELLA|high|sonnet" ;;
    *)          echo "" ;;
  esac
}

AGENT_INFO=$(get_agent_info "$ROLE")

if [ -z "$AGENT_INFO" ]; then
  echo "Errore: ruolo '$ROLE' non riconosciuto."
  echo "Ruoli validi: capitano, scout, analista, scorer, scrittore, critico, sentinella, assistente, mentor"
  exit 1
fi

IFS='|' read -r session_prefix effort model_override <<< "$AGENT_INFO"

# Costruisci nome sessione tmux
# Agenti singoli (multi:false in AGENTS): tmux ha nome = prefix (no
# suffix). Il tg-bridge per assistente/capitano/mentor punta a queste
# session esatte, senza -1, quindi mentor DEVE essere qui.
case "$ROLE" in
  capitano|critico|sentinella|assistente|mentor)
    SESSION="$session_prefix"
    ;;
  *)
    # Agenti multipli — richiede istanza
    if [ -z "$INSTANCE" ]; then
      INSTANCE="1"
      echo "Nota: istanza non specificata, uso $ROLE $INSTANCE"
    fi
    SESSION="${session_prefix}-${INSTANCE}"
    ;;
esac

# Determina effort in base al mode
if [ "$MODE" = "fast" ]; then
  effort="low"
fi

# ── Selezione provider CLI (multi-provider) ──────────────────────────────────
# Legge ~/.jht/jht.config.json per scegliere tra claude / codex / kimi
# e capire se usare api_key (env var) o subscription (sessione CLI esistente).
# Default: claude subscription (comportamento pre-multi-provider).

# In the JHT container HOME is overridden to /jht_home (the bind-mount
# that matches the host's ~/.jht), so the provider config lives at
# ${HOME}/jht.config.json — not ${HOME}/.jht/jht.config.json. On the
# host the same file is at ~/.jht/jht.config.json. Honour JHT_HOME
# when set (container path), fall back to ~/.jht for host runs.
if [ -n "${JHT_HOME:-}" ] && [ -f "${JHT_HOME}/jht.config.json" ]; then
  JHT_CONFIG_FILE="${JHT_HOME}/jht.config.json"
else
  JHT_CONFIG_FILE="${HOME}/.jht/jht.config.json"
fi

extract_provider_info() {
  local cfg="$1"
  if ! [ -f "$cfg" ]; then
    echo "||"
    return
  fi
  if command -v python3 &>/dev/null; then
    python3 - "$cfg" 2>/dev/null <<'PYEOF' || echo "||"
import json, sys
try:
    with open(sys.argv[1]) as f:
        c = json.load(f)
    active = c.get("active_provider", "") or ""
    prov = (c.get("providers") or {}).get(active, {}) if active else {}
    auth = prov.get("auth_method", "") or ""
    key = prov.get("api_key", "") or ""
    print(f"{active}|{auth}|{key}")
except Exception:
    print("||")
PYEOF
  elif command -v jq &>/dev/null; then
    local active auth key
    active=$(jq -r '.active_provider // ""' "$cfg" 2>/dev/null || echo "")
    if [ -n "$active" ]; then
      auth=$(jq -r ".providers[\"$active\"].auth_method // \"\"" "$cfg" 2>/dev/null || echo "")
      key=$(jq -r ".providers[\"$active\"].api_key // \"\"" "$cfg" 2>/dev/null || echo "")
    else
      auth=""
      key=""
    fi
    echo "${active}|${auth}|${key}"
  else
    echo "||"
  fi
}

IFS='|' read -r PROVIDER AUTH_METHOD API_KEY <<< "$(extract_provider_info "$JHT_CONFIG_FILE")"

# Default: Claude subscription
CLI_BIN="claude"
CLI_ARGS="--dangerously-skip-permissions --effort $effort"
CLI_ENV_PREFIX=""

case "$PROVIDER" in
  ""|anthropic|claude)
    CLI_BIN="claude"
    CLI_ARGS="--dangerously-skip-permissions --effort $effort"
    # Override modello per ruolo. I ruoli "Opus high" (capitano/scrittore/
    # critico/mentor) hanno model_override VUOTO: la CLI claude di oggi defaulta
    # a Sonnet (NON Opus), quindi passiamo Opus ESPLICITAMENTE invece di affidarci
    # a un "default account = opus" che non vale più. I ruoli con override
    # esplicito (es. sonnet per scout/analista/scorer/assistente/sentinella) lo usano.
    if [ -n "$model_override" ]; then
      CLI_ARGS="$CLI_ARGS --model $model_override"
    else
      CLI_ARGS="$CLI_ARGS --model opus"
    fi
    if [ "$AUTH_METHOD" = "api_key" ] && [ -n "$API_KEY" ]; then
      CLI_ENV_PREFIX="ANTHROPIC_API_KEY='${API_KEY}' "
    fi
    ;;
  openai|codex)
    CLI_BIN="codex"
    # --yolo è alias di --dangerously-bypass-approvals-and-sandbox:
    # salta sia approval che sandbox FS, così l'agente può scrivere
    # chat.jsonl, creare la profile dir, ecc. senza bloccarsi sul
    # prompt di approval (equivalente di claude --dangerously-skip-permissions).
    # -c model_reasoning_effort=<effort> applica il livello di reasoning
    # per ruolo (default del config.toml e' "medium"): capitano/scout/
    # analista/scrittore/critico vanno su "high", scorer/assistente
    # restano "medium". Codex non ha un --effort flag; si passa via -c.
    CLI_ARGS="--yolo -c model_reasoning_effort=$effort"
    if [ "$AUTH_METHOD" = "api_key" ] && [ -n "$API_KEY" ]; then
      CLI_ENV_PREFIX="OPENAI_API_KEY='${API_KEY}' "
    fi
    ;;
  kimi|moonshot)
    CLI_BIN="kimi"
    # --yolo auto-approves every shell command so the agent can write
    # chat.jsonl, create the profile dir, etc. without blocking on the
    # approval prompt (equivalent of Claude's --dangerously-skip-permissions).
    # --max-steps-per-turn 100 (2026-06-25): cap il loop autonomo di un turno
    # a 100 step (default kimi-cli = 1000). K2.7-Code tende a turni lunghissimi
    # (rabbit-hole: scraping a mano + processor custom, ~170k token / 0 output);
    # 100 cappa SOLO i runaway veri (un batch sano è ~20 step → non si pianta).
    # Quando un worker tocca il cap, la CLI termina il turno con "Max number of
    # steps reached" e ASPETTA input (max_ralph=0, niente auto-continue): è il
    # Capitano a sbloccarlo con un "Continua" (regola C-08 ter). Trasforma i
    # runaway in checkpoint controllabili invece che in burn cieco.
    # --no-thinking (#5, 2026-06-30): K2.7-Code ha il "thinking" (catena di reasoning
    # fatturata come output) ON di default; è la causa del coordinator-burn — i
    # coordinatori Kimi costavano ~7-12x un tick di Codex (vedi
    # docs/internal/_archive/2026-06-29-coordinator-burn-kimi-vs-codex.md). Lo spegniamo SOLO
    # per i COORDINATORI (Capitano + Sentinella): il loro lavoro non è user-facing,
    # lì il thinking è idle-burn puro (il Capitano congelato bruciava ~35 kT/h solo
    # per ri-deliberare "resto in coast"). I WORKER (Scout/Analista/Scorer/Scrittore/
    # Critico) e gli user-facing (Assistente/Mentor) LO TENGONO: a loro serve
    # l'intelligenza per trovare e valutare offerte (a thinking spento il team betaB
    # non trovava nulla). Revisione mirata del "tutti off" del 2026-06-29; il flag
    # commuta in "Instant mode", il ragionamento resta visibile nella risposta.
    # REVISIONE 2026-07-01: il CAPITANO torna a thinking ON. Prova sul campo (beta-3):
    # il Capitano Kimi a thinking OFF ha VIOLATO il gate writer-on-demand (C-10) —
    # ha invertito la regola ("il filtro è score>=50, non write_requested") e ordinato
    # 30 CV mai richiesti, bruciando il weekly all'88%. Il coordinamento del Capitano
    # (enforcement dei gate, giudizio pacing) richiede la catena di reasoning: senza,
    # Kimi delibera male e fa danni gravi. Costa di più del coast-burn ma è NECESSARIO.
    # La SENTINELLA resta OFF (compito più stretto: monitoraggio/soglie) — si osserva
    # nei prossimi giorni se regge. Doc: docs/internal/postmortems/2026-07-01-capitano-kimi-thinking-off-writer-gate.md
    THINKING_FLAG=""
    case "$(printf '%s' "$ROLE" | tr 'A-Z' 'a-z')" in
      sentinella) THINKING_FLAG=" --no-thinking" ;;
    esac
    CLI_ARGS="--yolo --max-steps-per-turn 100${THINKING_FLAG}"
    if [ "$AUTH_METHOD" = "api_key" ] && [ -n "$API_KEY" ]; then
      CLI_ENV_PREFIX="MOONSHOT_API_KEY='${API_KEY}' "
    fi
    ;;
  *)
    echo "Warning: provider '$PROVIDER' non riconosciuto in jht.config.json, fallback a claude."
    ;;
esac

# Verifica prerequisiti della CLI scelta
if ! command -v "$CLI_BIN" &>/dev/null; then
  echo "Errore: comando '$CLI_BIN' non trovato (provider configurato: ${PROVIDER:-claude})."
  case "$CLI_BIN" in
    claude) echo "Installa Claude CLI: https://claude.ai/download" ;;
    codex)  echo "Installa Codex CLI: https://github.com/openai/codex" ;;
    kimi)   echo "Installa Kimi CLI del provider Moonshot." ;;
  esac
  echo "In alternativa, modifica ~/.jht/jht.config.json per usare un altro provider."
  exit 1
fi
if ! command -v tmux &>/dev/null; then
  echo "Errore: tmux non trovato. Installalo con: sudo apt install tmux"
  exit 1
fi

# ── Soppressione auto-update interattivo di kimi ─────────────────────────────
# Kimi CLI mostra un blocking gate TUI "kimi-cli update available" con default
# Enter = "Upgrade now" che esegue `uv tool upgrade kimi-cli` e poi sys.exit.
# Stessa dinamica di codex: il nostro Enter auto-accept (anche dopo verify)
# trigga l'update che su NTFS/WSL2 bind-mount fallisce, kimi esce → sessione
# cade sulla shell. Il binario espone una env var ufficiale: settandola il
# gate viene saltato interamente. Applicata per tutti gli agenti (l'env var
# è innocua anche quando kimi non è il provider attivo).
export KIMI_CLI_NO_AUTO_UPDATE=1

# ── Soppressione auto-update interattivo di codex ────────────────────────────
# Codex mostra un prompt TUI "Update now / Skip / Skip until next version"
# quando rileva una versione più recente, con "Update now" selezionato di
# default. Gli auto-Enter che mandiamo per chiudere il trust-dialog finiscono
# sul prompt update, codex lancia `npm install -g @openai/codex` che fallisce
# con EACCES durante il rename() atomico su bind-mount NTFS/WSL2 (rename di
# @openai/codex mentre il binario è in uso non è supportato), exit 243 →
# sessione tmux torna al prompt shell, agente risulta "online" ma morto.
#
# Fix: settiamo dismissed_version = latest_version in $JHT_HOME/.codex/
# version.json prima del launch. Chiave confermata guardando le stringhe del
# binario Rust (dismissed_version accanto a latest_version/last_checked_at).
if [ "$CLI_BIN" = "codex" ]; then
  CODEX_VERSION_FILE="${JHT_HOME:-/jht_home}/.codex/version.json"
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
fi

# ── Cartelle JHT ─────────────────────────────────────────────────────────────
mkdir -p "$JHT_HOME" "$JHT_AGENTS_DIR" "$JHT_LOGS_DIR"
mkdir -p "$JHT_USER_DIR/cv" "$JHT_USER_DIR/critiche" "$JHT_USER_DIR/allegati" "$JHT_USER_DIR/output"

# Directory di lavoro dell'agente nella zona nascosta. Stesso set di
# "agenti singoli" usato sopra per il SESSION name — devono restare
# allineati (multi:false in AGENTS).
case "$ROLE" in
  capitano|critico|sentinella|assistente|mentor)
    AGENT_DIR="$JHT_AGENTS_DIR/$ROLE"
    AGENT_NAME="$ROLE"
    ;;
  *)
    AGENT_DIR="$JHT_AGENTS_DIR/${ROLE}-${INSTANCE}"
    AGENT_NAME="${ROLE}-${INSTANCE}"
    ;;
esac
mkdir -p "$AGENT_DIR"
# Workspace layout (RULE-T12): agents must use these subdirs instead of
# scattering files at the root of $AGENT_DIR. tools/ holds helper
# scripts the agent wrote for itself; tmp/ holds throwaway intermediate
# scratch (downloaded JDs, draft buffers, …) and is wiped by the agent
# at boot for files older than 7 days.
mkdir -p "$AGENT_DIR/tools" "$AGENT_DIR/tmp"

# ── Pre-trust della cwd per Codex CLI ────────────────────────────────────────
# Codex mostra al primo avvio in una nuova working dir un prompt blocking
# "Do you trust the contents of this directory?" (default = nessuna scelta).
# Quando lo spawn avviene dentro `tmux new -s NAME 'codex ...'` il prompt
# resta in attesa, dopo qualche secondo codex esce silenziosamente → il
# pane tmux torna a bash e i messaggi successivi vengono interpretati come
# comandi shell ("command not found").
#
# Fix: scriviamo idempotentemente l'entry trust_level="trusted" per la
# AGENT_DIR corrente in $JHT_HOME/.codex/config.toml prima di lanciare la
# CLI. Funziona anche per gli scout/analista/scrittore/critico spawnati
# on-demand dal Capitano (cwd dinamiche non note al boot di pid1).
# Vedi docs/internal/_archive/2026-05-20-vps-bootstrap-bugs.md §Bug #2.
if [ "$CLI_BIN" = "codex" ]; then
  CODEX_CONFIG_FILE="${JHT_HOME:-/jht_home}/.codex/config.toml"
  mkdir -p "$(dirname "$CODEX_CONFIG_FILE")"
  touch "$CODEX_CONFIG_FILE"
  TRUST_KEY="[projects.\"$AGENT_DIR\"]"
  if ! grep -qF "$TRUST_KEY" "$CODEX_CONFIG_FILE"; then
    printf '\n%s\ntrust_level = "trusted"\n' "$TRUST_KEY" >> "$CODEX_CONFIG_FILE"
  fi
fi

# ── File d'identità per l'agente ──────────────────────────────────────────────
# Convenzione per provider:
#   - Claude Code legge CLAUDE.md
#   - Codex + Kimi leggono AGENTS.md (standard OpenAI / Moonshot)
# Il contenuto è identico, cambia solo il nome del file.
case "$PROVIDER" in
  ""|anthropic|claude) IDENTITY_FILE="CLAUDE.md" ;;
  *)                   IDENTITY_FILE="AGENTS.md" ;;
esac
IDENTITY_DEST="$AGENT_DIR/$IDENTITY_FILE"

# Risoluzione locale del template d'identità.
# Convenzione: agents/<role>/<role>.<locale>.md → fallback agents/<role>/<role>.md.
# Cascade lookup (in ordine di priorità):
#   1. $JHT_LANG (env var) — usata per test rapidi e dagli altri script i18n
#      (shared/i18n.sh, shared/i18n.py, cli/wizard/i18n.js)
#   2. $JHT_HOME/i18n-prefs.json::locale — popolato dal desktop wizard
#   3. host.env::JHT_LANG — persisted dal host-setup.sh preflight
#   4. default 'en' — la lingua master dei template. (Il `DEFAULT_LOCALE` di
#      shared/i18n/types.ts, che questa riga citava, è sparito il 2026-07-25
#      con lo scaffolding TS irraggiungibile: il default vive qui sotto.)
# Il fallback al baseline (`<role>.md`, sempre EN dal 2026-05-18) è
# silenzioso perché 'en' è il master language.
# Vedi docs/internal/experiments/2026-05-06-agent-prompts-i18n.md.
USER_LOCALE=""
if [ -n "${JHT_LANG:-}" ]; then
  USER_LOCALE="$JHT_LANG"
fi
PREFS_FILE="${JHT_HOME:-$HOME/.jht}/i18n-prefs.json"
if [ -z "$USER_LOCALE" ] && [ -f "$PREFS_FILE" ] && command -v jq >/dev/null 2>&1; then
  USER_LOCALE="$(jq -r '.locale // "en"' "$PREFS_FILE" 2>/dev/null || echo en)"
  [ "$USER_LOCALE" = "null" ] && USER_LOCALE=""
fi
HOST_ENV_FILE="${JHT_HOME:-$HOME/.jht}/host.env"
if [ -z "$USER_LOCALE" ] && [ -f "$HOST_ENV_FILE" ]; then
  USER_LOCALE="$(grep -E '^JHT_LANG=' "$HOST_ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '"' | head -1)"
fi
[ -z "$USER_LOCALE" ] && USER_LOCALE="en"

# #7 — welcome i18n: invece di hardcodare il body del welcome in EN nel
# _welcome_kickoff, pescalo dal catalogo locali (shared/locales/<lang>.json
# via `t welcome.<role>`), risolto su USER_LOCALE. Fallback al testo EN
# hardcoded passato dal caller se il catalogo non è disponibile (build legacy
# senza i18n.sh) o la chiave è vuota → non si rompe mai.
export JHT_LANG="$USER_LOCALE"
[ -f /app/shared/i18n.sh ] && . /app/shared/i18n.sh 2>/dev/null || true
_welcome_body() {
  local role="$1" fallback="$2" body=""
  if declare -F t >/dev/null 2>&1; then
    body="$(t "welcome.$role" 2>/dev/null)"
  fi
  if [ -n "$body" ]; then printf '%s' "$body"; else printf '%s' "$fallback"; fi
}

LOCALIZED_TEMPLATE="$REPO_ROOT/agents/$ROLE/$ROLE.$USER_LOCALE.md"
BASELINE_TEMPLATE="$REPO_ROOT/agents/$ROLE/$ROLE.md"
if [ -f "$LOCALIZED_TEMPLATE" ]; then
  TEMPLATE="$LOCALIZED_TEMPLATE"
else
  TEMPLATE="$BASELINE_TEMPLATE"
fi

if [ ! -f "$TEMPLATE" ] && [ ! -f "$IDENTITY_DEST" ]; then
  echo "Errore: template $TEMPLATE non trovato e $IDENTITY_FILE non esiste in $AGENT_DIR."
  echo "Crea agents/$ROLE/$ROLE.md (baseline) o agents/$ROLE/$ROLE.$USER_LOCALE.md, oppure $IDENTITY_DEST manualmente."
  exit 1
fi
# Copia il template se il file runtime non esiste o differisce dal repo.
# Confronto sul contenuto (cmp), non su mtime: se l'mtime del runtime
# diventa più recente del template (es. spawn precedenti scritti in
# ordine fuori-fase, o tocchi accidentali), un check "-nt" si rompe per
# sempre — il repo non vince più anche quando il prompt è cambiato.
# Il repo è single source of truth: se il contenuto diverge, il template
# vince sempre.
if [ -f "$TEMPLATE" ] && { [ ! -f "$IDENTITY_DEST" ] || ! cmp -s "$TEMPLATE" "$IDENTITY_DEST"; }; then
  cp "$TEMPLATE" "$IDENTITY_DEST"
  echo "  → $IDENTITY_FILE sincronizzato da template ($(basename "$TEMPLATE"))"
fi

# ── Team docs (team-rules, architettura) — fix-radice-A 2026-06-14 ───────────
# I prompt agente linkano [..](../_team/team-rules.md): path RELATIVO alla
# workdir runtime ($JHT_AGENTS_DIR/<role>/). Senza copiare i doc team-wide
# accanto alle workdir quel link è rotto a runtime (il file vive solo in
# /app/agents/_team/). Copiandoli in $JHT_AGENTS_DIR/_team/ il "../_team/..."
# risolve per OGNI agente, e la tassonomia role_family team-wide diventa
# raggiungibile. Locale-aware come le skill (variante <name>.<locale>.md → <name>.md).
TEAM_SRC="$REPO_ROOT/agents/_team"
TEAM_DEST="$JHT_AGENTS_DIR/_team"
if [ -d "$TEAM_SRC" ]; then
  mkdir -p "$TEAM_DEST"
  for f in "$TEAM_SRC"/*.md; do
    [ -f "$f" ] || continue
    base="$(basename "$f")"
    case "$base" in *.??.md) continue;; esac   # salta le varianti localizzate
    cp "$f" "$TEAM_DEST/$base"
    localized="$TEAM_SRC/${base%.md}.$USER_LOCALE.md"
    if [ "$USER_LOCALE" != "en" ] && [ -f "$localized" ]; then
      cp "$localized" "$TEAM_DEST/$base"
    fi
  done
fi

# ── Skill distribution ──────────────────────────────────────────────────────
# Per-agent skill discovery: each agent only sees the skills it actually
# uses. The shared library lives at agents/_skills/; the manifest at
# agents/<role>/skills.list declares which ones the agent consumes.
# Private skills under agents/<role>/_skills/ are always copied (no
# manifest needed — they are role-specific by definition).
#
# Claude Code reads .claude/skills/ in the cwd; Codex/Kimi read
# .agents/skills/ — we populate both so the agent works regardless of
# which CLI start-agent.sh selects via PROVIDER. Each spawn rewrites
# the workspace skill folders so a manifest change between spawns is
# picked up cleanly.
SKILLS_LIB="$REPO_ROOT/agents/_skills"
SKILL_MANIFEST="$REPO_ROOT/agents/$ROLE/skills.list"
PRIVATE_SKILLS_DIR="$REPO_ROOT/agents/$ROLE/_skills"
CLAUDE_SKILLS_DIR="$AGENT_DIR/.claude/skills"
AGENTS_SKILLS_DIR="$AGENT_DIR/.agents/skills"

rm -rf "$CLAUDE_SKILLS_DIR" "$AGENTS_SKILLS_DIR"
mkdir -p "$CLAUDE_SKILLS_DIR" "$AGENTS_SKILLS_DIR"

_copy_skill() {
  local src="$1"
  local name="$2"
  cp -R "$src" "$CLAUDE_SKILLS_DIR/$name"
  cp -R "$src" "$AGENTS_SKILLS_DIR/$name"
  # Locale-aware: if SKILL.<locale>.md exists, use it as SKILL.md
  local localized="$src/SKILL.$USER_LOCALE.md"
  if [ "$USER_LOCALE" != "en" ] && [ -f "$localized" ]; then
    cp "$localized" "$CLAUDE_SKILLS_DIR/$name/SKILL.md"
    cp "$localized" "$AGENTS_SKILLS_DIR/$name/SKILL.md"
  fi
  # Remove locale variants from workspace (agent sees only SKILL.md)
  rm -f "$CLAUDE_SKILLS_DIR/$name"/SKILL.*.md
  rm -f "$AGENTS_SKILLS_DIR/$name"/SKILL.*.md
}

_skills_count=0
if [ -f "$SKILL_MANIFEST" ]; then
  while IFS= read -r _line || [ -n "$_line" ]; do
    # Strip comments and surrounding whitespace
    _name="${_line%%#*}"
    _name="$(echo "$_name" | tr -d '[:space:]')"
    [ -z "$_name" ] && continue
    _src="$SKILLS_LIB/$_name"
    if [ ! -d "$_src" ]; then
      echo "  ⚠ skill '$_name' listed in $SKILL_MANIFEST but not found at $_src" >&2
      continue
    fi
    _copy_skill "$_src" "$_name"
    _skills_count=$((_skills_count + 1))
  done < "$SKILL_MANIFEST"
fi

if [ -d "$PRIVATE_SKILLS_DIR" ]; then
  for _skill in "$PRIVATE_SKILLS_DIR"/*/; do
    [ -d "$_skill" ] || continue
    _name="$(basename "$_skill")"
    [ "$_name" = "_lib" ] && continue
    _copy_skill "$_skill" "$_name"
    _skills_count=$((_skills_count + 1))
  done
fi

echo "  → $_skills_count skill(s) distribuite in $CLAUDE_SKILLS_DIR + $AGENTS_SKILLS_DIR"
unset _line _name _src _skill _skills_count

# ── Avvia agente ─────────────────────────────────────────────────────────────
if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "Sessione '$SESSION' già attiva."
  echo "Connettiti con: tmux attach -t \"$SESSION\""
  exit 0
fi

# ── Warmup ~/.claude.json se manca ──────────────────────────────────────────
# Bug osservato 2026-05-12: Claude Code 2.1.139 considera "loggato" solo se
# ESISTONO ENTRAMBI $JHT_HOME/.claude/.credentials.json E $JHT_HOME/.claude.json.
# `jht oauth-login` scrive solo credentials.json — .claude.json viene scritto
# da claude TUI al primo boot effettivo. Quindi il PRIMO agente del bootstrap
# cade su "Select login method" e premendo "1" fa un nuovo OAuth (ignorando
# le credentials esistenti). Fix: prima di lanciare il claude TUI, se
# .claude.json manca, lo creiamo via warmup con `claude -p "ok"` (modalita'
# one-shot non-TUI, usa credentials.json e popola .claude.json all'avvio).
# Skippato se gia' popolato (es. agenti successivi al primo).
if [ "$CLI_BIN" = "claude" ] && [ -n "${JHT_HOME:-}" ]; then
  # Salta il wizard first-run della TUI claude + il warning bypass-permissions
  # (vedi _ensure_claude_onboarding sopra). Senza, ogni agente si blocca.
  _ensure_claude_onboarding "$JHT_HOME"
  CLI_ENV_PREFIX="IS_SANDBOX=1 ${CLI_ENV_PREFIX}"
  _claude_json="$JHT_HOME/.claude.json"
  if [ ! -s "$_claude_json" ] && [ -s "$JHT_HOME/.claude/.credentials.json" ]; then
    echo "  → warmup ~/.claude.json (mancante, popolo via claude -p)"
    HOME="$JHT_HOME" timeout 30 claude --dangerously-skip-permissions -p "ok" \
      >/dev/null 2>&1 || true
    if [ -s "$_claude_json" ]; then
      echo "  ✓ .claude.json popolato ($(wc -c <"$_claude_json") byte)"
    else
      echo "  ⚠ warmup non ha popolato .claude.json — l'agente potrebbe cadere su Select login method"
    fi
  fi
fi

FULL_CMD="${CLI_ENV_PREFIX}${CLI_BIN}${CLI_ARGS:+ $CLI_ARGS}"

send_env_vars() {
  # Inside the JHT container a fresh tmux bash resets HOME to the OS
  # default (/home/jht, from /etc/passwd) — but the CLI credential
  # files live under /jht_home (the bind-mounted ~/.jht from the
  # host). Without this override, kimi/claude/codex would report
  # "not logged in" even when the user authed successfully.
  #
  # Nota: esportiamo SEMPRE HOME (senza il guard `$JHT_HOME != $HOME`
  # che prima saltava il send-keys quando il caller aveva già HOME
  # settato a $JHT_HOME). Motivo: quando il Capitano — che gira dentro
  # una tmux dove HOME è già /jht_home — invoca start-agent.sh per
  # spawnare un agente figlio, la nuova tmux parte con una bash fresca
  # che legge /etc/passwd → HOME torna a /home/jht. Senza l'export,
  # kimi/claude del nuovo agente cercano le credenziali nel posto
  # sbagliato e chiedono di rifare il login device.
  if [ -d "${JHT_HOME:-}" ]; then
    tmux send-keys -t "$SESSION" "export HOME='$JHT_HOME'" C-m
  fi
  # Propagate our PATH into the tmux pane: a fresh interactive bash
  # re-reads /etc/profile and ~/.bashrc which can clobber the PATH
  # that docker's ENV set (e.g. /jht_home/.npm-global/bin where kimi
  # lives after uv tool install). Re-exporting here guarantees the
  # CLI binary resolves.
  # Prepend /app/agents/_tools: contiene wrapper come `jht-send` che
  # gli agenti usano per interagire con l'UI web senza toccare JSON/shell
  # quoting a mano. Da lì scriviamo chat.jsonl in modo sicuro.
  AGENT_TOOLS_DIR="/app/agents/_tools"
  tmux send-keys -t "$SESSION" "export PATH='${AGENT_TOOLS_DIR}:$PATH'" C-m
  # KIMI_CLI_NO_AUTO_UPDATE disabilita il blocking gate di kimi. Lo
  # esportiamo sempre (anche quando il provider non è kimi) perché è
  # innocuo se il binario non lo legge.
  tmux send-keys -t "$SESSION" "export KIMI_CLI_NO_AUTO_UPDATE=1" C-m
  # KIMI_SHARE_DIR esplicito: kimi-cli risolve di default a $HOME/.kimi,
  # ma quando lanciato in tmux/subprocess in una work_dir diversa da
  # quella del primo /login risulta "LLM not set" (issue osservato
  # 2026-05-16, vedi github.com/MoonshotAI/kimi-cli issue #1983 sui
  # subagents/sibling processes). Settare la env esplicita forza il
  # path della share dir e le credentials OAuth diventano visibili.
  tmux send-keys -t "$SESSION" "export KIMI_SHARE_DIR='$JHT_HOME/.kimi'" C-m
  tmux send-keys -t "$SESSION" "export JHT_HOME='$JHT_HOME'" C-m
  tmux send-keys -t "$SESSION" "export JHT_USER_DIR='$JHT_USER_DIR'" C-m
  tmux send-keys -t "$SESSION" "export JHT_DB='$JHT_DB'" C-m
  tmux send-keys -t "$SESSION" "export JHT_CONFIG='$JHT_CONFIG'" C-m
  tmux send-keys -t "$SESSION" "export JHT_AGENT_DIR='$AGENT_DIR'" C-m
  tmux send-keys -t "$SESSION" "export JHT_AGENT_NAME='$AGENT_NAME'" C-m
}

# Rileva se siamo in WSL nativo (non dentro un container Docker Desktop, che
# condivide il kernel WSL2 ma non ha wslpath/powershell.exe): in WSL la CLI
# Claude è un binario Windows e va lanciata via PowerShell.
if [ "${IS_CONTAINER:-0}" != "1" ] && grep -qi microsoft /proc/version 2>/dev/null; then
  WIN_AGENT_DIR=$(wslpath -w "$AGENT_DIR")
  tmux new-session -d -x 220 -y 50 -s "$SESSION" powershell.exe
  sleep 2
  tmux send-keys -t "$SESSION" "Set-Location '${WIN_AGENT_DIR}'" Enter
  sleep 1
  tmux send-keys -t "$SESSION" "\$env:JHT_HOME='$JHT_HOME'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_USER_DIR='$JHT_USER_DIR'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_DB='$JHT_DB'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_CONFIG='$JHT_CONFIG'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_AGENT_DIR='$AGENT_DIR'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_AGENT_NAME='$AGENT_NAME'" Enter
  tmux send-keys -t "$SESSION" "$FULL_CMD" Enter
  # Auto-accept workspace trust dialog ("Yes, I trust" è già selezionato, basta Enter)
  sleep 8
  tmux send-keys -t "$SESSION" Enter
else
  # -x/-y: dimensioni pane senza client attaccato. Di default tmux usa
  # 80x24 quando la sessione è detached, e capture-pane restituisce output
  # troncato a 80 colonne — leggibilità terribile nella webUI. 220x50 dà
  # margine per dashboard / task lists del CLI senza esagerare con i byte
  # da leggere a ogni tick.
  tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"
  send_env_vars
  tmux send-keys -t "$SESSION" "$FULL_CMD" C-m
  # Auto-respond a TUI startup prompt: detect-and-respond invece di blind
  # Enter. Claude Code 2.1.x mostra il "Bypass Permissions mode" warning
  # con default "1. No, exit" → blind Enter killa claude → CAPITANO/SENTINELLA
  # diventano fantasmi (sessione tmux esiste ma LLM exited). Vedi BACKLOG
  # [BUG-CLAUDE-TRUST-PROMPT]. Fix: capture-pane, se trova il warning manda
  # Down + sleep 1s + Enter (sceglie "2. Yes, I accept"); se trova il classico
  # folder-trust dialog manda Enter (default "Yes"); se trova "Select login
  # method" (capita quando il primo claude lanciato non ha ~/.claude.json
  # pre-esistente — bug 2026-05-12) manda Enter (default "1. Claude account
  # with subscription"); fallback Enter dopo timeout finale.
  # setsid scollega dalla sessione/process-group di chi ha chiamato
  # start-agent.sh: senza, quando start-agent.sh esce il suo caller
  # (Node.js del backend web) manda SIGTERM al process group e ammazza
  # la subshell prima che lo sleep finisca.
  #
  # Loop: 60 iterazioni × 2s = 120s totali. Il dialog appare 5-30s dopo il
  # CLI start; 120s copre anche partenze lente (rete, immagine grossa).
  # Exit immediato appena uno dei pattern matcha → no overhead a regime.
  setsid sh -c '
    _sess="'"$SESSION"'"
    _i=0
    _login_handled=0
    while [ $_i -lt 60 ]; do
      sleep 2
      _pane=$(tmux capture-pane -t "$_sess" -p -S -40 2>/dev/null)
      if echo "$_pane" | grep -q "Bypass Permissions mode"; then
        tmux send-keys -t "$_sess" Down
        sleep 1
        tmux send-keys -t "$_sess" Enter
        exit 0
      fi
      if echo "$_pane" | grep -qE "trust (the files|this folder|this directory)"; then
        tmux send-keys -t "$_sess" Enter
        exit 0
      fi
      # Select login method: primo claude lanciato in container fresh con
      # .credentials.json ma SENZA .claude.json popolato cade qui. Default
      # = "1. Claude account with subscription", Enter conferma. Subito
      # dopo claude mostra Bypass Permissions, gestito dal ramo sopra al
      # giro successivo. Niente exit qui: restiamo in loop per il prossimo.
      if [ "$_login_handled" = "0" ] && echo "$_pane" | grep -q "Select login method"; then
        tmux send-keys -t "$_sess" Enter
        _login_handled=1
        sleep 2
      fi
      _i=$((_i + 1))
    done
    tmux send-keys -t "$_sess" Enter
  ' >/dev/null 2>&1 < /dev/null &
fi

# ── Sfasamento iniziale del worker ──────────────────────────────────────────
# Due worker sullo STESSO gradino di throttle che partono insieme restano
# appaiati: ogni loro ciclo cade nello stesso istante e ogni coincidenza è un
# picco di richieste simultanee. Lo stagger che c'era prima era una costante
# (~10 min) scollegata dal periodo reale: più grande del periodo stesso sui
# gradini brevi (il primo worker aveva già ciclato due volte prima che partisse
# il secondo, quindi le fasi finivano dove capita) e per costruzione a rischio
# di lockstep quando coincideva col periodo. Ora la distanza la decide il
# gradino: T/N, con T letto da throttle-config e N i worker che quel gradino lo
# condividono davvero. Vedi shared/skills/spawn_stagger.py per limiti e
# aritmetica.
#
# L'attesa NON la fa questo script (bloccherebbe il Capitano che lo ha invocato,
# e le tool call dei provider scadono in 30-120s): si pre-arma il throttle del
# worker, che si ferma da solo al gate `jht-throttle-check` che il suo prompt
# gli impone già al primo giro di loop. Un worker solo sul gradino non aspetta
# niente — il primo spawn è il percorso anti-idle.
STAGGER_SCRIPT="/app/shared/skills/spawn_stagger.py"
[ -f "$STAGGER_SCRIPT" ] || STAGGER_SCRIPT="$DEV_TEAM_DIR/../shared/skills/spawn_stagger.py"
STAGGER_SEC=0
if [ -f "$STAGGER_SCRIPT" ] && command -v python3 >/dev/null 2>&1; then
  STAGGER_SEC=$(python3 "$STAGGER_SCRIPT" "$AGENT_NAME" --arm 2>/dev/null || echo 0)
fi
case "$STAGGER_SEC" in
  ''|*[!0-9]*) STAGGER_SEC=0 ;;
esac

echo "✓ $SESSION avviato (cli: $CLI_BIN, provider: ${PROVIDER:-claude}, auth: ${AUTH_METHOD:-subscription}, effort: $effort, mode: $MODE)"

# ── Roster atteso ───────────────────────────────────────────────────────────
# Registra lo spawn nello STATO CONDIVISO letto da agent-watchdog.sh per
# sorvegliare i worker numerati. Fino al 2026-07-29 il watchdog guardava solo i
# quattro ruoli core: Scout/Analisti/Scorer/Scrittori morivano senza una riga di
# log e senza respawn (quattro persi nell'incidente 2026-07-28/29). Il roster
# non si può DEDURRE dalle sessioni vive — è esattamente la cosa da verificare —
# quindi va scritto qui, che è l'unico percorso per cui un agente esiste (le
# skill vietano il `tmux new-session` a mano).
# Best-effort e fail-open: un roster non scrivibile non deve impedire uno spawn.
if [ -f /app/shared/skills/team_roster.py ]; then
  JHT_HOME="${JHT_HOME:-/jht_home}" python3 /app/shared/skills/team_roster.py \
    record "$ROLE" "${INSTANCE:-}" --src start-agent.sh >/dev/null 2>&1 || true
fi
echo "  Agent dir:    $AGENT_DIR"
echo "  JHT_USER_DIR: $JHT_USER_DIR"
if [ "$STAGGER_SEC" -gt 0 ]; then
  echo "  Stagger:      ${STAGGER_SEC}s prima del primo ciclo (throttle pre-armato, gradino condiviso)"
else
  echo "  Stagger:      nessuno (primo worker del gradino, o ruolo senza periodo)"
fi
echo "  Connettiti con: tmux attach -t \"$SESSION\""

# ── Kick-off Capitano / Assistente ──────────────────────────────────────────
# Dopo start-agent.sh il CLI e' bootato ma l'agente sta fermo in attesa di
# input. Il Capitano riceve l'ordine di avvio pipeline; l'Assistente riceve
# il prompt di presentazione CV-first.
#
# Detection di readiness: tui_wait_ready (idle-diff) — cerca un pane che
# rimane identico per 3s, invariante universale cross-provider (Claude /
# Codex / Kimi). Non dipende da marker hardcoded nei banner, che cambiano
# tra release (es. codex 0.124 ha aggiunto il banner "Tip: GPT-5.5...").
#
# Send: tui_send_verified — dopo il send -l del testo, capture-pane e
# verifica che la signature sia presente PRIMA di spingere Enter. Con 3
# retry recuperiamo i casi in cui la TUI non era davvero ricettiva.
#
# setsid: scolleghiamo dal process-group di start-agent.sh cosi' il parent
# puo' uscire senza killare il sub-shell del kick-off.

_kickoff() {
  local sess="$1"
  local msg="$2"
  # Esportiamo via env var invece di interpolare nella stringa sh -c:
  # i messaggi contengono apostrofi e caratteri speciali che rompono
  # il quoting sh nested. Env var e' trasparente a qualsiasi charset.
  #
  # Log su /tmp/kickoff-<session>.log per troubleshooting: vediamo se
  # il child ha davvero eseguito, se wait_ready e' terminato, se send
  # e' andato a buon fine. Log idempotente, viene sovrascritto ogni
  # volta (conta solo l'ultimo kickoff).
  JHT_KICKOFF_SESS="$sess" JHT_KICKOFF_MSG="$msg" JHT_KICKOFF_LOG="/tmp/kickoff-$sess.log" \
  setsid sh -c '
    exec >"$JHT_KICKOFF_LOG" 2>&1
    echo "[$(date +%H:%M:%S)] kickoff start for $JHT_KICKOFF_SESS"
    . /app/.launcher/tui-helpers.sh
    echo "[$(date +%H:%M:%S)] waiting for ready..."
    if tui_wait_ready "$JHT_KICKOFF_SESS"; then
      echo "[$(date +%H:%M:%S)] ready. sending message (${#JHT_KICKOFF_MSG} chars)..."
      if tui_send_verified "$JHT_KICKOFF_SESS" "$JHT_KICKOFF_MSG"; then
        echo "[$(date +%H:%M:%S)] SENT OK"
      else
        echo "[$(date +%H:%M:%S)] SEND FAILED (retries exhausted)"
      fi
    else
      echo "[$(date +%H:%M:%S)] WAIT_READY TIMEOUT"
    fi
  ' </dev/null &
}

# ── Welcome kickoff helper ──────────────────────────────────────────────
# Marker [WELCOME-USER] (decisione utente 2026-05-16): l'agente deve
# inviare il welcome SOLO se riceve questo marker preciso. Niente reazione
# a "ciao" generici, niente reazione a [CHAT] vuoti, niente rispamma a
# restart con context pieno. Il prompt nel role .md ribadisce la regola.
#
# Lo stesso messaggio viene re-iniettato dal watchdog se il flag non
# appare (3 retry × 90s) — copre boot lenti / trust dialog / contesto
# pieno che ha ignorato il primo prompt.
_welcome_kickoff() {
  local role="$1" flag_name="$2" body="$3"
  local welcome_flag="${JHT_HOME:-/jht_home}/profile/${flag_name}"
  local welcome_dir="${JHT_HOME:-/jht_home}/profile"
  local welcome_log="/tmp/welcome-watchdog-${role}.log"
  local msg
  msg=$(printf '%s\n' \
    "[@system -> @${role}] [WELCOME-USER]" \
    "" \
    "Protocollo welcome utente — idempotente:" \
    "" \
    "1. Se ${welcome_flag} esiste: NON inviare nulla. Sei gia' stato presentato in un boot precedente. Ack al system e resta in attesa di [CHAT] / [TG] reali." \
    "" \
    "2. Altrimenti, Telegram e' OPZIONALE (web-first). Verifica se c'e' un bot Telegram configurato: python3 -c \"import json;b=(json.load(open('\${JHT_HOME:-/jht_home}/jht.config.json')).get('channels') or {}).get('telegram',{}).get('bots') or {};print(any((x or {}).get('bot_token','').strip() for x in b.values()))\"." \
    "   - Se True: invia il messaggio di welcome sotto via jht-telegram-send --from ${role} (skill telegram-send). UN SOLO messaggio, nella lingua dell'utente (il testo sotto e' gia' localizzato — invialo ESATTAMENTE com'e'), righe vuote vere (\\n\\n)." \
    "   - Se False (nessun Telegram): NON inviare nulla — il welcome non e' bloccante, compare sulla dashboard. Reagisci a [WELCOME-USER] e SOLO a questo, mai welcome su [CHAT]/[TG]." \
    "" \
    "Contenuto del welcome da inviare (solo se Telegram configurato):" \
    "${body}" \
    "" \
    "3. Tocca SEMPRE il flag (sia inviato via Telegram, sia saltato in web-first): mkdir -p ${welcome_dir} && touch ${welcome_flag}. Il welcome e' one-shot, NON un gate per iniziare a lavorare." \
    "" \
    "4. Ack al system con riga unica '[@${role} -> @system] [WELCOME-ACK] inviato/saltato + flag creato', POI inizia subito a lavorare (apri pipeline-triage / leggi il budget e agisci). NON restare idle 'in attesa di un segnale Telegram'."
  )
  _kickoff "$SESSION" "$msg"

  # Watchdog: 3 retry × 90s. Stesso pattern usato prima del refactor.
  JHT_WELCOME_SESS="$SESSION" JHT_WELCOME_FLAG="$welcome_flag" JHT_WELCOME_MSG="$msg" JHT_WELCOME_LOG="$welcome_log" \
  setsid sh -c '
    exec >"$JHT_WELCOME_LOG" 2>&1
    echo "[$(date +%H:%M:%S)] welcome watchdog start (flag=$JHT_WELCOME_FLAG)"
    . /app/.launcher/tui-helpers.sh
    for retry in 1 2 3; do
      sleep 90
      if [ -f "$JHT_WELCOME_FLAG" ]; then
        echo "[$(date +%H:%M:%S)] flag presente dopo retry=$retry-1, exit"
        exit 0
      fi
      echo "[$(date +%H:%M:%S)] flag mancante (retry $retry/3): re-injection"
      tui_send_verified "$JHT_WELCOME_SESS" "$JHT_WELCOME_MSG" || \
        echo "[$(date +%H:%M:%S)] tui_send_verified fallito"
    done
    if [ ! -f "$JHT_WELCOME_FLAG" ]; then
      echo "[$(date +%H:%M:%S)] watchdog give up: welcome non confermato"
    fi
  ' </dev/null &
}

if [ "$ROLE" = "assistente" ]; then
  _welcome_kickoff "assistente" "welcomed.flag" \
"$(_welcome_body assistente "Hi! 👋

I'm the Job Hunter Team Assistant — your point of contact with the AI team that's about to start looking for jobs for you.

To get going I need to know you. Send me here on Telegram your CV (PDF, DOC, even a photo of the paper version works), or just tell me in a couple of lines what you're looking for — role, sector, city. From that I build the profile and the rest of the team gets to work for you.

A draft or rough notes are perfectly fine, no need to have anything polished. 📄 I start from what you have.")"
fi

if [ "$ROLE" = "capitano" ]; then
  _welcome_kickoff "capitano" "capitano-welcomed.flag" \
"$(_welcome_body capitano "I'm the Captain. 👨‍✈️

I coordinate the team that will work on your search: someone hunts positions, someone analyzes them, someone calculates the match against your profile, someone writes the CV tailored to each one, someone does the final review before applying.

For now I'll stay silent. As soon as your profile is ready I'll fire up the engine, and from there I'll write to you when I have something concrete: a batch of interesting positions, an application ready to review together, or a blocker worth flagging. Talk soon. 🎯")"
fi

if [ "$ROLE" = "mentor" ]; then
  _welcome_kickoff "mentor" "mentor-welcomed.flag" \
"$(_welcome_body mentor "I'm the Mentor. 🧙‍♂️

I take care of the big picture of your search: once a week I'll bring you a reading of the numbers — patterns that emerged, market signals, career choices worth considering. Measured voice, I'll only write when there's something that really deserves your attention.

For now I'm listening. When I have enough data to tell you something useful, I'll write. 📊")"
fi

if [ "$ROLE" = "sentinella" ]; then
  # La Sentinella e' un watchdog LLM: senza kick-off resta idle nel CLI.
  # Tutto il protocollo sta nel suo prompt (agents/sentinella/sentinella.md).
  _msg="[@utente -> @sentinella] [MSG] Avvio. Aspetta il primo [BRIDGE TICK]."
  _kickoff "$SESSION" "$_msg"
fi


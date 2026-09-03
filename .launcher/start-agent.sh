#!/usr/bin/env bash
# .launcher/start-agent.sh — Avvia un singolo agente del Job Hunter Team
# Uso: ./start-agent.sh <ruolo> [istanza] [mode]
#
# Ruoli: capitano, scout, analista, scorer, scrittore, critico, sentinella, assistente
# Istanza: numero per agenti multipli (es: scout 1 → SCOUT-1) e per il
# Critico effimero posseduto dallo Scrittore (critico 1 → CRITICO-S1)
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
export PATH="/app/agents/_tools:/opt/jht-deps/bin:/opt/jht-deps/npm-global/bin:/opt/jht-deps/python/bin:/jht_home/.npm-global/bin:/home/jht/.local/bin:${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"

DEV_TEAM_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DEV_TEAM_DIR/config.sh"
source "$DEV_TEAM_DIR/tui-helpers.sh"
# jht_kill_by_marker / jht_daemon_log — singleton dei daemon detached e log
# sotto $JHT_HOME/logs con rotazione (vedi daemon-lib.sh).
source "$DEV_TEAM_DIR/daemon-lib.sh"
# jht_spawn_user_locale — la cascata del locale utente, condivisa con
# spawn-doctor.sh/spawn-maintainer.sh: viveva qui e loro non la vedevano,
# quindi Dottore e Mantenitore restavano in inglese su ogni installazione.
source "$DEV_TEAM_DIR/spawn-lib.sh"

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <role> [instance] [mode]"
  echo ""
  echo "Available roles:"
  echo "  capitano        → CAPITANO         (Job Hunter pipeline coordinator)"
  echo "  scout       → SCOUT-N      (Finds job openings)"
  echo "  analista    → ANALISTA-N   (Analyzes job descriptions and companies)"
  echo "  scorer      → SCORER-N     (Calculates match scores)"
  echo "  scrittore   → SCRITTORE-N  (Writes CVs and cover letters)"
  echo "  critico     → CRITICO[-SN] (CV quality review; SN is Writer-owned)"
  echo "  sentinella  → SENTINELLA   (Monitors token usage and rate limits)"
  echo "  assistente  → ASSISTENTE   (Helps the user navigate the platform)"
  echo ""
  echo "Examples:"
  echo "  $0 capitano              → start CAPITANO"
  echo "  $0 scout 1           → start SCOUT-1"
  echo "  $0 scrittore 2 fast  → start SCRITTORE-2 in fast mode"
  echo "  $0 critico 2         → start CRITICO-S2 via configured provider"
  echo "  $0 assistente        → start ASSISTENTE"
  exit 1
fi

ROLE="$1"
INSTANCE="${2:-}"
MODE="${3:-default}"

# ── Budget di tempo dello spawn ─────────────────────────────────────────────
# Due numeri, un solo vincolo che li lega. Dall'esterno all'interno:
#
#   docker exec (CLI)          90s  ← cli/src/commands/team/start.js, fissato
#     └─ flock -w               75s  ← attesa di chi trova il lock occupato
#          ├─ warmup claude     30s  ← `timeout 30 claude -p ok`, piu' sotto
#          └─ tmux new-session  45s  ← la guardia sullo spawn, piu' sotto
#
# `flock -w` deve superare il tempo che il detentore puo' bruciare, altrimenti
# un ritardo legittimo del detentore arriva agli altri come "concurrent spawn"
# — un errore che incolpa la concorrenza mentre la causa e' la lentezza. 75 =
# 30 + 45, cioe' i due soli passi della sezione critica che hanno un tetto
# esplicito; e resta sotto i 90s del chiamante, cosi' la CLI non tronca il
# `docker exec` prima che l'errore vero sia stampato (un troncamento a monte
# si vede come "unknown error" vuoto: regressione gia' osservata, vedi il
# commento accanto a `timeoutMs` in start.js).
#
# 45s per la new-session e non 20: il caso sano e' sotto i 2s (crea una
# sessione detached, non avvia l'agente — l'avvio ha budget suoi, 120s per il
# loop TUI e 270s per il welcome watchdog), ma su un bind mount Windows saturo
# la stessa manciata di syscall e' stata misurata a ~56ms l'una
# (docker-compose.yml), e la fascia 10-25s e' raggiungibile. 20s cadeva dentro
# quella fascia; 45s la scavalca con margine, supera i 30s del warmup che nella
# stessa sezione critica e' gia' accettato, e resta metà del budget del
# chiamante. Oltre non serve: il guasto qui e' bimodale — o ritorna in pochi
# secondi, o non ritorna mai — e alzare ancora ritarderebbe solo il recupero.
JHT_SPAWN_TMUX_TIMEOUT_SEC="${JHT_SPAWN_TMUX_TIMEOUT_SEC:-45}"
JHT_SPAWN_LOCK_WAIT_SEC="${JHT_SPAWN_LOCK_WAIT_SEC:-75}"
# Un override non numerico non deve trasformarsi in un `flock -w abc` (che
# fallisce subito) o in un tetto assente: si torna al default, come per lo
# stagger piu' sotto.
case "$JHT_SPAWN_TMUX_TIMEOUT_SEC" in ''|*[!0-9]*) JHT_SPAWN_TMUX_TIMEOUT_SEC=45 ;; esac
case "$JHT_SPAWN_LOCK_WAIT_SEC" in ''|*[!0-9]*) JHT_SPAWN_LOCK_WAIT_SEC=75 ;; esac

# ── Provider claude: pre-seed onboarding (BUG-CLAUDE-TRUST-PROMPT) ─────
# Su una install fresca la CLI claude (TUI) blocca gli agenti sul wizard
# first-run: theme-picker → browser-login → "Bypass Permissions mode".
# Pre-seediamo i flag in ~/.claude.json così la TUI salta il wizard e usa
# direttamente il token (CLAUDE_CODE_OAUTH_TOKEN) / le credenziali persistite.
# Idempotente. IS_SANDBOX=1 (esportato sotto) salta anche il warning bypass.
_ensure_claude_onboarding() {
  local home="${1:-${JHT_HOME:-/jht_home}}"
  local _out
  # stderr catturato invece che buttato: qui dentro ora passa anche l'avviso
  # sull'effort sganciato (O-19), e un avviso in `2>/dev/null` non è un avviso.
  _out="$(python3 - "$home/.claude.json" <<'PY' 2>&1 || true
import json, sys, os
f = sys.argv[1]
try:
    d = json.load(open(f))
except Exception:
    d = {}
d["hasCompletedOnboarding"] = True
d.setdefault("theme", "dark")
d["bypassPermissionsModeAccepted"] = True

# O-19 — `--effort` dichiarato ma non applicato.
#
# Un tocco dell'utente sul selettore della TUI scrive qui dei flag
# `unpin<Modello>LaunchEffort`. Sganciano l'effort DI LANCIO: il processo
# nasce col suo `--effort high` (`ps` lo mostra) e gira lo stesso al default
# del modello. Gli agenti funzionano, quindi non se ne accorge nessuno —
# l'unico segnale e' la bolletta, ed e' denaro dell'utente.
#
# Il file e' UNO per container (HOME=/jht_home): un tocco vale per tutti gli
# agenti insieme, e resta vero a ogni riavvio finche' qualcuno non lo toglie.
# Qui si toglie, allo stesso punto in cui gia' normalizziamo l'onboarding.
#
# Per PREFISSO e non per elenco: i tre nomi noti oggi sono legati a modelli
# specifici (Opus 4.7, Opus 4.8, Fable 5) e il prossimo modello portera' il
# suo. Un elenco fisso tornerebbe muto proprio quando cambia il modello.
unpinned = sorted(
    k for k, v in d.items()
    if k.startswith("unpin") and k.endswith("LaunchEffort") and v
)
for k in unpinned:
    d[k] = False
os.makedirs(os.path.dirname(f), exist_ok=True)
json.dump(d, open(f, "w"), indent=2)
# Il disallineamento deve essere VISIBILE: dichiararlo e correggerlo in
# silenzio ripeterebbe il difetto in forma piu' educata.
if unpinned:
    print("effort-unpin cleared: " + ", ".join(unpinned), file=sys.stderr)
PY
)"
  # Solo l'avviso arriva a schermo: gli errori del normalizzatore restano
  # fail-open come prima (un .claude.json illeggibile non blocca lo spawn).
  case "$_out" in
    *effort-unpin*)
      echo "  ⚠ $_out — launch effort was unpinned in .claude.json:" \
           "agents were running at the model default, not at the effort" \
           "requested on the command line. Re-pinned for this start." ;;
  esac
}

# ── Worker sentinel (fallback /usage per bridge) ─────────────────────
# Short-circuit per un ruolo speciale "worker": spawna una sessione
# SENTINELLA-WORKER con un claude CLI idle, da interrogare col comando
# /usage quando l'HTTP /api/oauth/usage di Anthropic e' 429. Non e' un
# agente del team: niente template, niente profile sync, niente kickoff,
# niente bridge. Singleton: se gia' viva, exit 0 senza errori.
if [ "$ROLE" = "worker" ]; then
  WORKER_SESSION="${JHT_SENTINEL_WORKER:-SENTINELLA-WORKER}"
  # `=`: exact match, come il guard di idempotenza piu' sotto. Qui nessuna
  # sessione nota inizia per SENTINELLA-WORKER, quindi oggi non cambia esito;
  # e' la stessa domanda ("questa sessione esatta esiste?") e va posta nello
  # stesso modo, perche' un nome nuovo che ne estende il prefisso la
  # trasformerebbe di nuovo in un falso "e' gia' attivo".
  if tmux has-session -t "=$WORKER_SESSION" 2>/dev/null; then
    echo "✓ $WORKER_SESSION is already active"
    exit 0
  fi
  : "${JHT_HOME:=/jht_home}"
  _ensure_claude_onboarding "$JHT_HOME"
  tmux new-session -d -x 220 -y 50 -s "$WORKER_SESSION" -c "$JHT_HOME"
  tmux send-keys -t "$WORKER_SESSION" "export HOME='$JHT_HOME'" C-m
  # ⚠️ Le doppie esterne sono obbligatorie: con "export PATH='...:\$PATH'" il
  # \$ resta letterale e gli apici SINGOLI impediscono l'espansione, quindi al
  # pane arriva una directory chiamata "$PATH" e /usr/bin, /bin & co. spariscono
  # → `claude` non si trova → il pane resta bash per sempre. Era così fino al
  # 2026-07-30: è l'ultimo ramo rimasto col difetto documentato a riga 167.
  # I percorsi /opt/jht-deps/* non sono opzionali: da quando le dipendenze
  # vivono nel volume, `providers update` installa lì i CLI.
  tmux send-keys -t "$WORKER_SESSION" "export PATH='/app/agents/_tools:/opt/jht-deps/bin:/opt/jht-deps/npm-global/bin:/opt/jht-deps/python/bin:/jht_home/.npm-global/bin:$PATH'" C-m
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
  # Il REPL è partito davvero? Finora questa riga stampava "✓ avviato" a
  # prescindere: col PATH rotto il pane restava un bash nudo, il singleton
  # sopra ("già attivo") lo rendeva DEFINITIVO — la sessione esiste, quindi non
  # verrà mai ricreata — e i consumatori (check_usage.py, sentinel-bridge)
  # controllano solo `tmux has-session`. Risultato: il fallback /usage esisteva
  # solo sulla carta, e mancava proprio quando serve, cioè quando l'HTTP di
  # Anthropic risponde 429. Un guscio va segnalato e rimosso, non ereditato.
  _w_up=0
  for _i in $(seq 1 12); do
    sleep 1
    case "$(tmux display-message -p -t "$WORKER_SESSION" '#{pane_current_command}' 2>/dev/null || echo "")" in
      ""|bash|sh|zsh|dash|-bash|-sh|-zsh) : ;;
      *) _w_up=1; break ;;
    esac
  done
  if [ "$_w_up" -ne 1 ]; then
    echo "✗ $WORKER_SESSION: REPL did not start (pane remains a shell) — session removed" >&2
    # `=`: un kill e' distruttivo e non deve mai poter atterrare su una
    # sessione sorella per prefisso. Qui la nostra esiste (l'abbiamo appena
    # creata) e l'exact match vincerebbe comunque, ma la regola vale sulla
    # forma: nessun kill senza target ancorato.
    tmux kill-session -t "=$WORKER_SESSION" 2>/dev/null || true
    exit 1
  fi
  echo "✓ $WORKER_SESSION started (TUI /usage fallback for the bridge)"
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
    echo "✗ $BRIDGE_SCRIPT not found — bridge did NOT start"
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
  echo "✓ sentinel-bridge started (target=${JHT_TARGET_SESSION:-CAPITANO}, log $BRIDGE_LOG)"

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
    echo "✓ pacing-bridge started (target=${JHT_PACING_TARGET_SESSION:-SENTINELLA}, log $PACING_LOG)"
  else
    echo "⚠ $PACING_SCRIPT not found — pacing did NOT start (sentinel is OK)"
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
    echo "✓ heartbeat-bridge (hourly nudge to Capitano) started (log $HEARTBEAT_LOG)"
  else
    echo "⚠ $HEARTBEAT_SCRIPT not found — heartbeat did NOT start"
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
    echo "✓ window-ratio-meter started (log $WRM_LOG)"
  else
    echo "⚠ $WRM_SCRIPT not found — automatic calibration unavailable (seed only)"
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
    echo "✓ token-meter started (log $METER_LOG)"
  else
    echo "⚠ $METER_SCRIPT not found — token-meter unavailable"
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
    echo "✓ agent-vitals started (per-agent CPU/RSS, log $AV_LOG)"
  else
    echo "⚠ $AV_SCRIPT not found — per-agent vitals unavailable"
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
    echo "✓ codex-auth-healer started (#6, log $HEALER_LOG)"
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
  # Accanto a questo script, non un path assoluto al container: in /app è la
  # stessa cosa, e fuori (test, host) lo script diventa eseguibile davvero
  # invece di fallire su una directory che non esiste.
  TG_SCRIPT="$DEV_TEAM_DIR/tg-bridge.py"
  if [ ! -f "$TG_SCRIPT" ]; then
    echo "✗ $TG_SCRIPT not found — tg-bridge did NOT start"
    exit 1
  fi

  # O-58 — un solo ruolo, se richiesto: `start-agent.sh tg-bridge mentor`.
  # Prima esisteva solo il rispawn di tutti e tre, e chi voleva rianimarne uno
  # ammazzava gli altri due che stavano lavorando. Il watchdog ora chiede il
  # ruolo mancante e basta; senza argomento il comportamento è quello storico
  # (tutti e tre), che serve al boot.
  TG_ROLES="assistente capitano mentor"
  if [ -n "$INSTANCE" ]; then
    case " $TG_ROLES " in
      *" $INSTANCE "*) TG_ROLES="$INSTANCE" ;;
      *)
        echo "Error: unknown tg-bridge role '$INSTANCE' (valid: assistente, capitano, mentor)." >&2
        exit 1
        ;;
    esac
  fi

  # O-58 — LOCK, come per le sessioni agente (vedi più sotto, stessa
  # motivazione: watchdog, Capitano e operatore chiedono lo stesso spawn quasi
  # nello stesso istante). Questo ramo ne era escluso, e senza lock due start
  # concorrenti si intrecciano così: A uccide, B uccide, A spawna 3, B spawna
  # 3 → SEI poller sugli stessi tre bot. Telegram risponde 409 a raffica a
  # getUpdates concorrenti, e da lì un messaggio dell'operatore è stato
  # ricevuto e mai consegnato (jht-tmux-send rc=141), per trenta ore.
  # UNA chiave sola, non una per ruolo: il boot chiede tutti e tre mentre il
  # watchdog può chiedere il mentor, e con due lock diversi quelle due
  # sequenze si intreccerebbero di nuovo. Serializzare costa l'attesa di uno
  # spawn (il python parte staccato, sono millisecondi) e toglie la classe
  # intera.
  if command -v flock >/dev/null 2>&1; then
    mkdir -p "${JHT_HOME:-/jht_home}/locks"
    exec 9>"${JHT_HOME:-/jht_home}/locks/start-tg-bridge.lock"
    if ! flock -w "$JHT_SPAWN_LOCK_WAIT_SEC" 9; then
      echo "Error: timed out after ${JHT_SPAWN_LOCK_WAIT_SEC}s waiting for the concurrent spawn of tg-bridge [$TG_ROLES]." >&2
      exit 1
    fi
  fi

  # Kill MIRATO: il marker include il ruolo, che compare nel cmdline grazie a
  # `--role` (vedi tg-bridge.py). Prima si uccideva per marker `tg-bridge.py`,
  # cioè tutti e tre, anche quando ne serviva uno solo — ed è così che la
  # morte del mentor si portava dietro assistente e capitano.
  for _role in $TG_ROLES; do
    jht_kill_by_marker "tg-bridge.py --role $_role" 0 0
  done
  # UN solo settle per l'intera raffica, come quando il kill era uno solo:
  # tre attese da un secondo allungherebbero ogni boot senza motivo.
  sleep 1

  # JHT_TG_OFFSET_RESET=1 → al primo poll skippa il backlog (utile in fresh
  # install per non rifare replay di vecchi /start dell'utente).
  #
  # `9>&-` NON è decorativo: il lock di flock vive nella *open file
  # description*, che i figli EREDITANO. I bridge sono detached e restano vivi
  # per giorni, quindi senza questa chiusura il fd 9 resta aperto in loro e il
  # lock non viene mai rilasciato: il primo spawn della vita del container
  # bloccherebbe ogni respawn successivo, che andrebbe in timeout dopo 30s. Il
  # rimedio sarebbe stato peggiore del difetto — il watchdog non avrebbe più
  # potuto rianimare niente. Trovato dal test della race, non a occhio.
  for _role in $TG_ROLES; do
    _target=$(echo "$_role" | tr '[:lower:]' '[:upper:]')
    _log="$(jht_daemon_log "tg-bridge-${_role}.log")"
    setsid sh -c "
      JHT_TG_BOT_ROLE='$_role' \
      JHT_TG_TARGET_SESSION='$_target' \
      JHT_TG_OFFSET_RESET='${JHT_TG_OFFSET_RESET:-}' \
        python3 -u $TG_SCRIPT --role $_role >> '$_log' 2>&1
    " >/dev/null 2>&1 < /dev/null 9>&- &
    echo "✓ tg-bridge[$_role] started (target=$_target, log $_log)"
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
    echo "✗ $METER_SCRIPT not found — token-meter did NOT start"
    exit 1
  fi
  # Kill istanze preesistenti.
  jht_kill_by_marker token-meter.py 0 1
  METER_LOG="$(jht_daemon_log token-meter.log)"
  setsid sh -c "
    JHT_HOME='${JHT_HOME:-/jht_home}' \
      python3 -u $METER_SCRIPT >> '$METER_LOG' 2>&1
  " >/dev/null 2>&1 < /dev/null &
  echo "✓ token-meter started (log $METER_LOG)"
  exit 0
fi

# ── Agent-vitals daemon (cpu/rss per-agente, 19/07) ───────────────────
# Short-circuit per "agent-vitals": avvio manuale del sampler (parte
# comunque da solo con la bridge-suite, vedi ROLE=bridge). Attribuzione
# via JHT_AGENT_NAME in /proc/*/environ; storico su agent-vitals.jsonl.
if [ "$ROLE" = "agent-vitals" ]; then
  AV_SCRIPT="/app/shared/skills/agent_vitals.py"
  if [ ! -f "$AV_SCRIPT" ]; then
    echo "✗ $AV_SCRIPT not found — agent-vitals did NOT start"
    exit 1
  fi
  jht_kill_by_marker agent_vitals.py 0 1
  AV_LOG="$(jht_daemon_log agent-vitals.log)"
  setsid sh -c "
    JHT_HOME='${JHT_HOME:-/jht_home}' \
      python3 -u $AV_SCRIPT >> '$AV_LOG' 2>&1
  " >/dev/null 2>&1 < /dev/null &
  echo "✓ agent-vitals started (log $AV_LOG)"
  exit 0
fi

# Mappa ruolo → prefisso sessione | effort | model
# model: "" = default pesante del provider; altrimenti alias come "sonnet".
# Claude riceve l'alias direttamente. Codex lo traduce con la mappa sotto;
# Kimi continua a usare il proprio default e non legge questa colonna.
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
  echo "Error: unrecognized role '$ROLE'."
  echo "Valid roles: capitano, scout, analista, scorer, scrittore, critico, sentinella, assistente, mentor"
  exit 1
fi

IFS='|' read -r session_prefix effort model_override <<< "$AGENT_INFO"

# Costruisci nome sessione tmux. I singleton restano senza suffisso; il
# Critico con istanza e' la sola eccezione, perche' SCRITTORE-N possiede una
# sessione effimera CRITICO-SN. Questa scelta NON riguarda il provider.
if ! SESSION="$(jht_spawn_session_name "$ROLE" "$session_prefix" "$INSTANCE")"; then
  echo "Error: instance must be a positive numeric identifier." >&2
  exit 1
fi
case "$ROLE" in
  capitano|critico|sentinella|assistente|mentor) ;;
  *)
    if [ -z "$INSTANCE" ]; then
      INSTANCE="1"
      echo "Note: no instance specified; using $ROLE $INSTANCE"
    fi
    ;;
esac

# Capitano, watchdog e operatore possono chiedere lo stesso spawn quasi nello
# stesso istante. Prima il controllo `tmux has-session` arrivava DOPO `rm -rf`
# delle cartelle skill: due start concorrenti cancellavano la destinazione
# mentre l'altro processo la copiava (`cp: ... No such file or directory`).
# Serializziamo per sessione e riconosciamo l'idempotenza prima di toccare la
# workdir. `flock` è disponibile nel container Linux; fuori dal container il
# fallback conserva il comportamento storico.
if command -v flock >/dev/null 2>&1; then
  mkdir -p "${JHT_HOME:-/jht_home}/locks"
  exec 9>"${JHT_HOME:-/jht_home}/locks/start-${SESSION}.lock"
  if ! flock -w "$JHT_SPAWN_LOCK_WAIT_SEC" 9; then
    echo "Error: timed out after ${JHT_SPAWN_LOCK_WAIT_SEC}s waiting for the concurrent spawn of '$SESSION'." >&2
    exit 1
  fi
fi
# `=` forza l'EXACT match. Senza, la risoluzione dei target tmux prosegue col
# prefisso: `-t SENTINELLA` trova SENTINELLA-WORKER, `-t SCOUT-1` trova
# SCOUT-10, `-t CRITICO` trova CRITICO-S3. Su questa riga il prezzo e' il
# peggiore possibile: la sessione chiesta NON esiste, il guard la dichiara
# "already active" ed esce 0, quindi l'agente non nasce mai e nessun respawn
# lo ricreera' — il fallimento e' silenzioso e permanente. Non e' teorico:
# registrato in produzione come prefix-match SENTINELLA vs SENTINELLA-WORKER
# che ha bloccato un relaunch. Stessa convenzione di agent-watchdog.sh.
if tmux has-session -t "=$SESSION" 2>/dev/null; then
  echo "Session '$SESSION' is already active."
  echo "Connect with: tmux attach -t \"$SESSION\""
  exit 0
fi

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

# Traduce gli alias semantici della mappa ruoli nei modelli Codex:
#   opus   == gpt-5.6-sol
#   sonnet == gpt-5.6-terra
resolve_codex_model() {
  local alias="$1"
  local resolved=""
  case "$alias" in
    ""|opus) resolved="gpt-5.6-sol" ;;
    sonnet) resolved="gpt-5.6-terra" ;;
  esac
  if [ -z "$resolved" ]; then
    echo "Error: no Codex model mapping for role alias '$alias'." >&2
    return 1
  fi
  printf '%s\n' "$resolved"
}

# Nessun default implicito: il provider e' configurazione utente. Se il file
# manca, e' illeggibile o contiene un valore sconosciuto, avviare un CLI
# diverso trasformerebbe un errore di configurazione in consumo e lavoro sul
# provider sbagliato.
CLI_BIN=""
CLI_ARGS=""
CLI_ENV_PREFIX=""

case "$PROVIDER" in
  anthropic|claude)
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
    if ! codex_model="$(resolve_codex_model "$model_override")"; then
      exit 1
    fi
    # --yolo è alias di --dangerously-bypass-approvals-and-sandbox:
    # salta sia approval che sandbox FS, così l'agente può scrivere
    # chat.jsonl, creare la profile dir, ecc. senza bloccarsi sul
    # prompt di approval (equivalente di claude --dangerously-skip-permissions).
    # Codex non ha un --effort flag; l'effort passa via -c. Il modello invece
    # va passato separatamente: senza --model tutti i ruoli ereditavano il
    # default del CLI (gpt-5.6-sol), inclusi quelli calibrati su Terra.
    CLI_ARGS="--yolo --model $codex_model -c model_reasoning_effort=$effort"
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
    echo "Error: active_provider is missing or unsupported in '$JHT_CONFIG_FILE'." >&2
    echo "Configure it with jht setup or jht config before starting the team." >&2
    exit 1
    ;;
esac

# Override sperimentale e ROLE-SCOPED della missione M5. Non aggiunge un
# quarto provider globale: active_provider continua a governare tutti gli
# altri agenti. Il runner rilegge e valida la config (incluso host locale)
# prima di toccare la coda dello Scorer.
if [ "$(printf '%s' "$ROLE" | tr 'A-Z' 'a-z')" = "scorer" ] && \
   [ -f "$JHT_CONFIG_FILE" ] && command -v python3 >/dev/null 2>&1 && \
   python3 - "$JHT_CONFIG_FILE" >/dev/null 2>&1 <<'PYEOF'
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as handle:
        cfg = json.load(handle)
    raise SystemExit(0 if cfg.get("team", {}).get("local_scorer", {}).get("enabled") is True else 1)
except (OSError, TypeError, ValueError):
    raise SystemExit(1)
PYEOF
then
  LOCAL_SCORER_RUNNER="/app/shared/skills/local_scorer.py"
  [ -f "$LOCAL_SCORER_RUNNER" ] || LOCAL_SCORER_RUNNER="$DEV_TEAM_DIR/../shared/skills/local_scorer.py"
  CLI_BIN="python3"
  CLI_ARGS="$LOCAL_SCORER_RUNNER serve"
  CLI_ENV_PREFIX=""
  PROVIDER="local-scorer"
  AUTH_METHOD="local-endpoint"
fi

# Verifica prerequisiti della CLI scelta
if ! command -v "$CLI_BIN" &>/dev/null; then
  echo "Error: command '$CLI_BIN' not found (configured provider: $PROVIDER)."
  case "$CLI_BIN" in
    claude) echo "Install the Claude CLI: https://claude.ai/download" ;;
    codex)  echo "Install the Codex CLI: https://github.com/openai/codex" ;;
    kimi)   echo "Install the Kimi CLI from provider Moonshot." ;;
  esac
  echo "Alternatively, edit ~/.jht/jht.config.json to use another provider."
  exit 1
fi
if ! command -v tmux &>/dev/null; then
  echo "Error: tmux not found. Install it with: sudo apt install tmux"
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

# Directory di lavoro dell'agente nella zona nascosta. La stessa funzione che
# risolve il nome sessione rende CRITICO-SN anche un workspace separato: due
# Writer non condividono identita', tmp o skill durante review concorrenti.
if ! AGENT_NAME="$(jht_spawn_agent_name "$ROLE" "$INSTANCE")"; then
  echo "Error: invalid agent instance '$INSTANCE'." >&2
  exit 1
fi
AGENT_DIR="$JHT_AGENTS_DIR/$AGENT_NAME"
mkdir -p "$AGENT_DIR"

# ── DB di coordinamento Scout (issue #132) ───────────────────────────────────
# Nel run Windows del 2026-08-05 il primo Scout non è riuscito ad aprire il
# database di coordinamento — `$JHT_HOME/data/` non esisteva e nessuno la
# creava — e ha proseguito scegliendosi un fallback scrivibile: due agenti
# possono così credere di coordinarsi mentre guardano due file diversi. La
# cartella e il file si creano e si VERIFICANO qui, prima dello spawn, perché
# il primo a scoprire il problema non deve essere un agente a metà
# negoziazione. Un fallimento NON blocca lo Scout (sorgere si può anche da
# soli) ma resta a schermo: da lì in poi `scout_coord.py` esce 3 con un
# messaggio azionabile invece di inventarsi un secondo database.
if [ "$ROLE" = "scout" ] && command -v python3 >/dev/null 2>&1; then
  COORD_SCRIPT="/app/shared/skills/scout_coord.py"
  [ -f "$COORD_SCRIPT" ] || COORD_SCRIPT="$DEV_TEAM_DIR/../shared/skills/scout_coord.py"
  if [ -f "$COORD_SCRIPT" ]; then
    python3 "$COORD_SCRIPT" bootstrap || \
      echo "⚠️  scout coordination db NOT ready — see the message above (issue #132)"
  fi
fi

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
  anthropic|claude) IDENTITY_FILE="CLAUDE.md" ;;
  *)                   IDENTITY_FILE="AGENTS.md" ;;
esac
IDENTITY_DEST="$AGENT_DIR/$IDENTITY_FILE"

# Risoluzione locale del template d'identità.
# Convenzione: agents/<role>/<role>.<locale>.md → fallback agents/<role>/<role>.md.
# La cascata (i18n-prefs.json → $JHT_LANG → host.env → 'en') vive in
# .launcher/spawn-lib.sh::jht_spawn_user_locale, sourceata in testa a questo
# file: era codice locale a start-agent.sh, e i due agenti che NON passano da
# qui (Dottore e Mantenitore, spawnati da spawn-doctor.sh/spawn-maintainer.sh)
# se ne restavano fuori. Il default 'en' è la lingua master dei template — il
# `DEFAULT_LOCALE` di shared/i18n/types.ts, che questa riga citava, è sparito
# il 2026-07-25 con lo scaffolding TS irraggiungibile.
# Il fallback al baseline (`<role>.md`, sempre EN dal 2026-05-18) è
# silenzioso perché 'en' è il master language.
# Vedi docs/internal/experiments/2026-05-06-agent-prompts-i18n.md.
USER_LOCALE="$(jht_spawn_user_locale)"

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
  echo "Error: template $TEMPLATE not found and $IDENTITY_FILE does not exist in $AGENT_DIR."
  echo "Create agents/$ROLE/$ROLE.md (baseline) or agents/$ROLE/$ROLE.$USER_LOCALE.md, or create $IDENTITY_DEST manually."
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
  echo "  → $IDENTITY_FILE synchronized from template ($(basename "$TEMPLATE"))"
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
# Unica implementazione condivisa con gli spawn speciali. skills.list resta
# la source of truth delle shared; agents/<role>/_skills aggiunge solo le
# private del ruolo. CLI_BIN e' gia' la selezione provider normalizzata.
JHT_APP_ROOT="$REPO_ROOT" jht_spawn_copy_skills \
  "$ROLE" "$AGENT_DIR" "start-agent" "$CLI_BIN"

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
    echo "  → warming up ~/.claude.json (missing; populating via claude -p)"
    # `timeout` nudo e NON `jht_timeout`, deliberatamente: qui il tetto non e'
    # un guard-rail, e' la condizione per eseguire. Se `timeout` manca (host
    # macOS senza coreutils GNU) l'rc 127 + `|| true` fa SALTARE il warmup, e
    # saltarlo e' recuperabile — l'agente cade su "Select login method" e il
    # watcher auto-Enter piu' sotto lo gestisce. Degradare al comando nudo
    # significherebbe invece lanciare senza tetto una chiamata di rete
    # interattiva in mezzo alla sezione critica del lock: peggio del difetto.
    HOME="$JHT_HOME" timeout 30 claude --dangerously-skip-permissions -p "ok" \
      >/dev/null 2>&1 || true
    if [ -s "$_claude_json" ]; then
      echo "  ✓ .claude.json populated ($(wc -c <"$_claude_json") bytes)"
    else
      echo "  ⚠ warmup did not populate .claude.json — the agent may fall back to Select login method"
    fi
  fi
fi

FULL_CMD="${CLI_ENV_PREFIX}${CLI_BIN}${CLI_ARGS:+ $CLI_ARGS}"

# Env OPZIONALI che, quando esistono, devono arrivare all'agente. Le liste di
# export qui sotto sono esplicite per costruzione — una tmux nuova non eredita
# l'ambiente di questo processo, e sul ramo PowerShell (WSL) non eredita
# proprio niente da bash — quindi una variabile che non è in lista, per
# l'agente non esiste.
#
# Il caso che ha aperto questa lista (issue #132, 2026-08-08):
# `JHT_SCOUT_COORD_DB` è l'UNICA deroga ammessa quando il percorso canonico del
# database di coordinamento non è scrivibile. Il bootstrap pre-spawn la vedeva
# (gira in questo processo) e lo Scout no: la deroga non raggiungeva chi la
# doveva usare, e l'agente usciva 3 proprio sulla piattaforma dell'incidente.
#
# Si propagano SOLO se valorizzate: esportare una stringa vuota renderebbe
# indistinguibile "non dichiarata" da "dichiarata male".
OPTIONAL_AGENT_ENV=(JHT_SCOUT_COORD_DB)

send_optional_env() {
  # $1 = "bash" | "powershell" — la sintassi cambia, la lista no.
  local _name _value
  for _name in "${OPTIONAL_AGENT_ENV[@]}"; do
    _value="${!_name:-}"
    if [ -n "$_value" ]; then
      if [ "$1" = "powershell" ]; then
        tmux send-keys -t "$SESSION" "\$env:$_name='$_value'" Enter
      else
        tmux send-keys -t "$SESSION" "export $_name='$_value'" C-m
      fi
    fi
  done
}

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
  send_optional_env bash
}

# Rileva se siamo in WSL nativo (non dentro un container Docker Desktop, che
# condivide il kernel WSL2 ma non ha wslpath/powershell.exe): in WSL la CLI
# Claude è un binario Windows e va lanciata via PowerShell.
if [ "${IS_CONTAINER:-0}" != "1" ] && grep -qi microsoft /proc/version 2>/dev/null; then
  WIN_AGENT_DIR=$(wslpath -w "$AGENT_DIR")
  # `9>&-` come nel ramo container qui sotto: anche questa new-session può
  # forkare il server tmux, che sopravvive a start-agent.sh col fd 9 aperto.
  tmux new-session -d -x 220 -y 50 -s "$SESSION" powershell.exe 9>&-
  sleep 2
  tmux send-keys -t "$SESSION" "Set-Location '${WIN_AGENT_DIR}'" Enter
  sleep 1
  tmux send-keys -t "$SESSION" "\$env:JHT_HOME='$JHT_HOME'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_USER_DIR='$JHT_USER_DIR'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_DB='$JHT_DB'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_CONFIG='$JHT_CONFIG'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_AGENT_DIR='$AGENT_DIR'" Enter
  tmux send-keys -t "$SESSION" "\$env:JHT_AGENT_NAME='$AGENT_NAME'" Enter
  # Le stesse deroghe del ramo bash: qui una env dell'ambiente bash non
  # attraversa PowerShell in nessun modo implicito, quindi se non la si
  # scrive a mano, per l'agente Windows non esiste (issue #132).
  send_optional_env powershell
  tmux send-keys -t "$SESSION" "$FULL_CMD" Enter
  if [ "$CLI_BIN" != "python3" ]; then
    # Auto-accept workspace trust dialog ("Yes, I trust" è già selezionato, basta Enter)
    sleep 8
    tmux send-keys -t "$SESSION" Enter
  fi
else
  # -x/-y: dimensioni pane senza client attaccato. Di default tmux usa
  # 80x24 quando la sessione è detached, e capture-pane restituisce output
  # troncato a 80 colonne — leggibilità terribile nella webUI. 220x50 dà
  # margine per dashboard / task lists del CLI senza esagerare con i byte
  # da leggere a ogni tick.
  #
  # Il tetto di tempo qui e' voluto: osservato in produzione (Docker Desktop /
  # bind mount Windows) un `tmux new-session` che non ritorna mai — ne'
  # crea la sessione ne' esce ne' fallisce, semplicemente resta appeso.
  # Senza un limite, il processo tiene aperto per sempre il fd 9 del
  # flock preso piu' sopra: ogni respawn successivo dello STESSO agente
  # (watchdog, utente, capitano) va in timeout allo scadere di `flock -w`
  # e fallisce con "concurrent spawn", indefinitamente — osservati 756
  # respawn falliti in 37h su una singola installazione prima che la
  # causa fosse isolata a un `tmux new-session` orfano di 15h+. Il tetto
  # garantisce che questo branch ritorni sempre, cosi' il lock si libera
  # e il prossimo tentativo puo' ripartire pulito invece di ripetere
  # all'infinito lo stesso fallimento silenzioso.
  #
  # `jht_timeout` (daemon-lib.sh) e non `timeout` nudo: `timeout` e' GNU
  # coreutils e su un host macOS non esiste. Nudo esce 127, e un 127 letto
  # come "spawn fallito" farebbe morire OGNI spawn per l'assenza della
  # protezione, non per un guasto. L'helper degrada al comando senza tetto,
  # come fa `.launcher/` con ogni altro binario opzionale.
  #
  # `9>&-`: stessa classe di difetto del ramo tg-bridge (vedi il commento
  # esteso più sopra), ma qui è peggio. Quando il server tmux non è ancora
  # vivo, è questa PRIMA `new-session` a forkarlo: il server eredita il fd 9
  # del flock, si stacca (PPid 1) e resta su quanto il container. Il lock di
  # questa sessione non viene quindi rilasciato MAI — nemmeno dopo che
  # start-agent.sh è uscito pulito — e ogni respawn dell'agente muore in
  # "concurrent spawn" allo scadere di `flock -w` finché il container non
  # riparte. Osservato in produzione: server tmux vivo da 11 giorni con
  # `fd 9 -> locks/start-<AGENTE>.lock`, 2.677 start falliti a valle. Chiuso
  # sull'intero comando cosi' il fd sparisce sia per il wrapper sia per tmux.
  #
  # L'rc va DISCRIMINATO: 124 e' il tetto scattato, 125/126/127 sono problemi
  # del wrapper (binario assente o non eseguibile), tutto il resto e' l'rc che
  # tmux ha propagato. Un `if !` nudo li collassa in uno e il messaggio
  # afferma un hang che il codice non ha verificato: `duplicate session`,
  # socket dir non scrivibile e nome sessione invalido finivano tutti sotto
  # "did not return within 20s". La diagnosi mentiva in ogni caso tranne uno,
  # e manda chi legge a cercare nel posto sbagliato — cioe' esattamente il
  # depistaggio che questo blocco esiste per chiudere.
  #
  # `|| _ns_rc=$?` e non `if ! cmd; then ... $?`: dentro il `then` di un
  # `if !`, `$?` vale la NEGAZIONE logica (0/1), non l'rc del comando, quindi
  # il 124 non sarebbe distinguibile. Ed e' anche l'unica forma che non fa
  # uscire lo script per il `set -e` di testa.
  #
  # Lo stderr di tmux va catturato e RIMESSO nella nostra riga: il chiamante
  # principale (cli/src/commands/team/start.js) conserva solo l'ULTIMA riga di
  # stderr, quindi la diagnosi nativa di tmux, se resta una riga a se', non
  # arriva mai ne' all'utente ne' alla dashboard.
  _ns_err="${TMPDIR:-/tmp}/jht-new-session-$$.err"
  _ns_rc=0
  jht_timeout "$JHT_SPAWN_TMUX_TIMEOUT_SEC" tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR" 2>"$_ns_err" 9>&- || _ns_rc=$?
  _ns_msg=""
  if [ -s "$_ns_err" ]; then
    _ns_msg="$(tr '\n' ' ' <"$_ns_err" | sed 's/  */ /g; s/ *$//')" || _ns_msg=""
  fi
  rm -f "$_ns_err" 2>/dev/null || true
  if [ "$_ns_rc" -ne 0 ]; then
    case "$_ns_rc" in
      124|137)
        echo "Error: 'tmux new-session' for '$SESSION' did not return within ${JHT_SPAWN_TMUX_TIMEOUT_SEC}s (hung spawn; tmux said: ${_ns_msg:-nothing})." >&2
        # Pulizia SOLO qui. `timeout` uccide il CLIENT tmux, non il server:
        # se il server era lento ma vivo — che e' precisamente il caso in cui
        # il tetto riesce a scattare — la sessione nasce QUALCHE SECONDO DOPO
        # il SIGTERM, con un pane bash nudo, senza env e senza CLI. Un kill
        # immediato sarebbe un no-op e lascerebbe quel guscio, che il guard di
        # idempotenza piu' sopra rende PERMANENTE ("already active" per
        # sempre). Diamo al server il tempo di decidersi prima di dichiarare
        # che non c'e' niente da pulire; il costo e' solo sul percorso che ha
        # gia' fallito.
        #
        # Su ogni ALTRO rc non si tocca niente: sul rc=1 `duplicate session`
        # la sessione esiste ma NON l'ha creata questo tentativo, e ucciderla
        # significherebbe ammazzare l'agente di qualcun altro (team-rules T01).
        # Il cleanup incondizionato faceva esattamente questo.
        #
        # `9>&-` anche qui: sono altri due client tmux nati mentre il lock e'
        # nostro. Se uno resta appeso oltre il proprio tetto, il tetto lo
        # abbandona ma il figlio sopravvive col fd 9 aperto, e il lock non si
        # rilascia piu'.
        _i=0
        while [ "$_i" -lt 5 ]; do
          jht_timeout 5 tmux has-session -t "=$SESSION" 2>/dev/null 9>&- && break
          sleep 1
          _i=$((_i + 1))
        done
        # `=` obbligatorio: nel ramo d'errore la sessione tipicamente NON
        # esiste, quindi tmux passerebbe al prefix matching e il kill
        # atterrerebbe su una sessione SORELLA (`-t SCOUT-1` uccide SCOUT-10,
        # `-t CRITICO` uccide il CRITICO-S3 di uno Scrittore in mezzo a una
        # review). Stessa convenzione di agent-watchdog.sh. E il tetto qui non
        # e' decorativo: questo e' un altro client verso lo stesso server
        # sospetto di essere appeso, ed e' l'ultimo punto del ramo che potrebbe
        # ancora bloccarsi per sempre col fd 9 in mano — cioe' ricreare da
        # solo il lockout che tutta questa guardia esiste per impedire.
        jht_timeout 5 tmux kill-session -t "=$SESSION" 2>/dev/null 9>&- || true
        ;;
      125|126|127)
        echo "Error: could not run the time-bounded 'tmux new-session' for '$SESSION' (rc=$_ns_rc: command missing or not executable). No session was created." >&2
        ;;
      *)
        echo "Error: 'tmux new-session' for '$SESSION' failed immediately (rc=$_ns_rc, not a timeout): ${_ns_msg:-no message from tmux}. No session was created by this attempt." >&2
        ;;
    esac
    exit 1
  fi
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
  if [ "$CLI_BIN" != "python3" ]; then
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
    ' >/dev/null 2>&1 < /dev/null 9>&- &
  fi
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

echo "✓ $SESSION started (cli: $CLI_BIN, provider: $PROVIDER, auth: ${AUTH_METHOD:-subscription}, effort: $effort, mode: $MODE)"

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
  echo "  Stagger:      ${STAGGER_SEC}s before the first cycle (pre-armed throttle, shared rung)"
else
  echo "  Stagger:      none (first worker on the rung, or role without a period)"
fi
echo "  Connect with: tmux attach -t \"$SESSION\""

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
  ' </dev/null 9>&- &
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
    "User welcome protocol — idempotent:" \
    "" \
    "1. If ${welcome_flag} exists: DO NOT send anything. You were already introduced on a previous boot. Acknowledge the system and wait for actual [CHAT] / [TG] messages." \
    "" \
    "2. Otherwise, Telegram is OPTIONAL (web-first). Check whether a Telegram bot is configured: python3 -c \"import json;b=(json.load(open('\${JHT_HOME:-/jht_home}/jht.config.json')).get('channels') or {}).get('telegram',{}).get('bots') or {};print(any((x or {}).get('bot_token','').strip() for x in b.values()))\"." \
    "   - If True: send the welcome message below via jht-telegram-send --from ${role} (telegram-send skill). Send ONE message in the user's language (the text below is already localized — send it EXACTLY as written), with real blank lines (\\n\\n)." \
    "   - If False (no Telegram): DO NOT send anything — the welcome is non-blocking and appears on the dashboard. React to [WELCOME-USER] and ONLY to this event; never welcome in response to [CHAT]/[TG]." \
    "" \
    "Welcome content to send (only when Telegram is configured):" \
    "${body}" \
    "" \
    "3. ALWAYS create the flag (whether sent via Telegram or skipped in web-first mode): mkdir -p ${welcome_dir} && touch ${welcome_flag}. The welcome is one-shot, NOT a gate for starting work." \
    "" \
    "4. Acknowledge the system with one line: '[@${role} -> @system] [WELCOME-ACK] sent/skipped + flag created'. THEN start working immediately (open pipeline-triage, read the budget, and act). DO NOT remain idle waiting for a Telegram signal."
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
        echo "[$(date +%H:%M:%S)] flag present after retry=$retry-1, exiting"
        exit 0
      fi
      echo "[$(date +%H:%M:%S)] flag missing (retry $retry/3): reinjecting"
      tui_send_verified "$JHT_WELCOME_SESS" "$JHT_WELCOME_MSG" || \
        echo "[$(date +%H:%M:%S)] tui_send_verified failed"
    done
    if [ ! -f "$JHT_WELCOME_FLAG" ]; then
      echo "[$(date +%H:%M:%S)] watchdog giving up: welcome not confirmed"
    fi
  ' </dev/null 9>&- &
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
  _msg="[@utente -> @sentinella] [MSG] Startup. Wait for the first [BRIDGE TICK]."
  _kickoff "$SESSION" "$_msg"
fi

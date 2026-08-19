#!/usr/bin/env bash
# agent-watchdog.sh — controlla che le sessioni tmux degli agenti siano attive:
# i 4 ruoli core (ASSISTENTE, CAPITANO, MENTOR, SENTINELLA) e — dal 2026-07-29 —
# anche i WORKER NUMERATI letti dal roster atteso. Se una manca, la rilancia.
#
# Pensato come daemon spawnato da pid1 al boot del container. NON
# sostituisce il dottore (context-refresh LLM degli agenti CON stato),
# copre il caso "session tmux morta o non partita".
#
# La SENTINELLA ha in più un refresh-per-ETÀ deterministico (vedi
# maybe_refresh_sentinella): è near-stateless — il suo stato operativo vive
# nel bridge/config, non nella sua chat — quindi dopo molte ore il suo
# context window si gonfia e ne degrada il giudizio di pace, e va ricreata
# fresca oltre una soglia. È age-based, NON health-based: non re-introduce
# il restart-loop del vecchio sentinel_health (V4 bug). Gli altri core hanno
# stato e li rinfresca il Dottore (refresh ricco con resume).
#
# ── TTL di 12h su OGNI sessione agente (2026-07-29) ─────────────────────
# maybe_ttl_refresh: superata JHT_AGENT_MAX_SESSION_AGE_H la sessione viene
# ricreata, punto. Il criterio è SOLO l'età: non conta il contesto (una
# sessione al 4% dopo 30 ore va comunque ricreata), non conta che l'agente
# stia lavorando, non conta lo stato PARKED, non conta nessuna euristica di
# salute. Motivo: nell'incidente 2026-07-28/29 le sessioni avevano 38,5 ·
# 29,5 · 27,0 · 14,5 · 14,2 ore e TUTTE le euristiche disponibili dicevano
# "sano" mentre il team era paralizzato per undici ore. Un TTL non ha
# euristiche da sbagliare.
#
# Il TTL vive QUI oltre che nel Dottore per ridondanza: il Dottore è un
# agente e può essere fermo, bloccato o non spawnato — è successo proprio
# quella notte. Il Dottore fa il refresh RICCO (capture + intervista +
# retrospettiva + resume), questo è la rete che garantisce il tetto a
# qualsiasi costo. Due differenze deliberate dal refresh della Sentinella:
#   • NIENTE gate orario — una sessione di 30 ore va ricreata anche di
#     notte: il costo di un kick-off è trascurabile rispetto a una giornata
#     persa (il gate resta invece sul respawn dei worker, sotto);
#   • UN SOLO refresh per tick, il più vecchio — le sessioni nascono a
#     ondate e scadrebbero insieme, scaglionarle evita di rifare il team
#     intero in un colpo.
#
# Loop interval: 30s (configurable via env JHT_AGENT_WATCHDOG_INTERVAL).
# Idempotente: `jht team start` skippa session già attive.
# Failure mode: log + retry al prossimo tick, non fail-fast.
#
# Trigger gate: parte se active_provider è settato in jht.config.json E
# le credenziali del provider sono presenti. Telegram NON è più richiesto:
# l'interazione vive nell'app desktop (chat/feedback dal gioco), Telegram è un
# canale secondario opzionale. Richiederlo bloccava Capitano/Mentor in
# modalità no-telegram (il watchdog non li spawnava mai → team monco al boot).

set -u

# jht-tmux-send vive in /app/agents/_tools (come in start-agent.sh): serve per
# l'escalation al Capitano in maybe_respawn_bridges. Best-effort se assente.
export PATH="/app/agents/_tools:${PATH}"

JHT_HOME="${JHT_HOME:-/jht_home}"
CONFIG="$JHT_HOME/jht.config.json"
JHT_BIN="/app/cli/bin/jht.js"
INTERVAL_SEC="${JHT_AGENT_WATCHDOG_INTERVAL:-30}"
LOG="$JHT_HOME/logs/agent-watchdog.log"
AGENTS=(assistente capitano mentor sentinella)
# Soglia (ore) oltre cui la sessione SENTINELLA viene ricreata per ripulire
# il context window accumulato. Refresh deterministico, near-stateless.
SENTINELLA_MAX_CTX_AGE_H="${JHT_SENTINELLA_MAX_CTX_AGE_H:-24}"
# TTL: età massima (ore) di QUALSIASI sessione agente. Vedi il blocco in testa.
AGENT_MAX_SESSION_AGE_H="${JHT_AGENT_MAX_SESSION_AGE_H:-12}"
# Roster atteso (chi dovrebbe essere vivo): stato condiviso scritto da
# start-agent.sh a ogni spawn riuscito, letto qui per sorvegliare i worker
# numerati. Vedi shared/skills/team_roster.py per le tre guardie che
# impediscono al watchdog di combattere col coordinatore.
# Path overridabili solo per poterli esercitare nei test con dei finti: in
# container restano quelli dell'immagine.
ROSTER_TOOL="${JHT_ROSTER_TOOL:-/app/shared/skills/team_roster.py}"
START_AGENT="${JHT_START_AGENT:-/app/.launcher/start-agent.sh}"
PROCESS_HEALTH_TOOL="${JHT_PROCESS_HEALTH_TOOL:-/app/shared/skills/process_health.py}"
# Recuperi degli agenti: il watchdog non deve limitarsi a far sparire il
# problema. Questo registro è una misura append-only, non il log rotante del
# watchdog: deve poter rispondere a "quante volte è stato recuperato oggi
# SCOUT-1?" anche dopo che i messaggi al Capitano sono scorsi via.
# Le tre dipendenze si iniettano nei test: il comportamento si prova con tmux,
# spawner e sender finti, senza una macchina o una TUI vera.
RECOVERY_LOG="${JHT_AGENT_RECOVERY_LOG:-$JHT_HOME/logs/agent-recoveries.tsv}"
NODE_BIN="${JHT_NODE_BIN:-/usr/local/bin/node}"
TMUX_SENDER="${JHT_TMUX_SENDER:-jht-tmux-send}"
# TTL e refresh della Sentinella sono ricreazioni DECISIONALI, non morti da
# misurare. Il prossimo ensure_agent consuma questo singolo marcatore.
INTENTIONAL_RECREATE_SESSION=""

# ── Bridge suite supervision (2026-06-27) ──────────────────────────────
# I bridge/daemon ausiliari sono lanciati `setsid` detached da start-agent.sh
# → NON sono figli di pid1, quindi il respawn-on-crash di pid1 NON li copre.
# Se uno muore (crash da eccezione, OOM-kill) resta giù finché non riparte il
# container — è il buco che ha lasciato betaC cieco sull'usage per 8h il
# 2026-06-27. Qui li risorvegliamo a ogni tick. **Anti-flap** (lezione del V4
# restart-loop, per cui il self-restart del bridge fu RIMOSSO): oltre un cap di
# respawn in finestra, NON rispawna più e ESCALA al Capitano — niente crash-loop.
# Vedi docs/internal/postmortems/2026-06-27-betaC-sentinel-bridge-crash.md.
BRIDGE_STATE_DIR="$JHT_HOME/logs"
BRIDGE_FLAP_WINDOW_SEC="${JHT_BRIDGE_FLAP_WINDOW_SEC:-600}"   # 10 min
BRIDGE_FLAP_CAP="${JHT_BRIDGE_FLAP_CAP:-3}"                   # max respawn/finestra
BRIDGE_ESCALATE_COOLDOWN_SEC="${JHT_BRIDGE_ESCALATE_COOLDOWN_SEC:-3600}"
# La liveness dei processi la calcola shared/skills/process_health.py (in Python,
# senza self-match) — stessa fonte di verità del Mantenitore. La suite detached
# riparabile da un solo `start-agent.sh bridge` è definita lì (gruppo bridge-suite).

mkdir -p "$(dirname "$LOG")"

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] $*" | tee -a "$LOG"
}

config_ready() {
  # active_provider + credenziali OAuth del provider presenti (es. kimi.json
  # scritto da `kimi --yolo` post-OAuth). Senza credenziali, l'agente parte ma
  # mostra "LLM not set" e resta inutilizzabile (visto 2026-05-16 in cold fresh
  # test). Telegram NON è più richiesto (canale secondario opzionale): un bot
  # configurato è solo INFO, non un prerequisito allo spawn.
  python3 - "$CONFIG" "$JHT_HOME" 2>/dev/null <<'PYEOF'
import json, os, sys
cfg_path, jht_home = sys.argv[1], sys.argv[2]
try:
  d = json.load(open(cfg_path))
except Exception:
  sys.exit(1)
prov = (d.get('active_provider') or '').strip().lower()
# Accettiamo sia il nome-VENDOR del provider (openai/anthropic/kimi — quello che
# scrive `jht providers use`) sia il nome-CLI storico (codex/claude). Mappano allo
# stesso marker di credenziali. Un mismatch qui era una timebomb: active_provider=
# "openai"/"anthropic" cadeva su markers.get(prov,'')='' -> os.path.exists('')=
# False -> config_ready FALSE in SILENZIO -> il watchdog smetteva di rispawnare
# CAPITANO/MENTOR dopo un reboot, senza una riga di log (ashley morta ~44h il
# 2026-07-18, barto armata dopo lo switch a Codex).
# Vedi docs/internal/postmortems/2026-07-18-provider-vendor-enum-config-ready.md
markers = {
  # kimi-cli 1.47+ scrive le creds in .kimi/credentials/<plan>.json
  # (es. kimi-code.json), non piu' .kimi/kimi.json (allineato a sentinel-bridge).
  'kimi':      f'{jht_home}/.kimi/credentials/kimi-code.json',
  'claude':    f'{jht_home}/.claude/.credentials.json',
  'anthropic': f'{jht_home}/.claude/.credentials.json',
  'codex':     f'{jht_home}/.codex/auth.json',
  'openai':    f'{jht_home}/.codex/auth.json',
}
has_creds = bool(prov) and os.path.exists(markers.get(prov, ''))
sys.exit(0 if (prov and has_creds) else 1)
PYEOF
}

is_session_alive() {
  # Bug 2026-05-18 (post-mortem capitano-zombie-night): tmux has-session
  # ritornava 0 anche quando il process LLM dentro al pane era morto
  # (kimi crashato, pane ridotto a bash idle). 11h di silent watchdog
  # mentre il Capitano era zombie e l'utente attendeva risposta.
  #
  # Fix: verifica anche pane_current_command. Se non è un LLM CLI noto
  # (kimi/Kimi/claude/codex/node/python/python3), la sessione è zombie
  # e va riavviata. La whitelist include 'node'/'python*' per
  # supportare CLI custom che usano runtime di base (rare ma possibili).
  local session="$1"
  tmux has-session -t "$session" 2>/dev/null || return 1
  local cmd
  cmd=$(tmux list-panes -t "$session" -F '#{pane_current_command}' 2>/dev/null | head -1)
  case "$cmd" in
    [Kk]imi|claude|Claude|codex|Codex|node|python|python3) return 0 ;;
    *)
      # Zombie: kill+rispawn al prossimo ensure_agent. Log a basso volume
      # qui per audit, il messaggio "session zombie — killing" è loud
      # apposta perché è un evento raro che vogliamo notare.
      log "agent $session: ZOMBIE detected (pane_current_command='$cmd') — killing session"
      tmux kill-session -t "$session" 2>/dev/null || true
      return 1
      ;;
  esac
}

recovery_today_count() {
  # TSV, non un contatore in memoria: un crash del watchdog non può azzerare
  # la storia che serve a capire se un agente è morto dieci volte oggi. I
  # campi sono prodotti solo qui (timestamp UTC, nome tmux, osservazione),
  # quindi il separatore non può entrare nei dati.
  local day="$1" session="$2"
  [ -f "$RECOVERY_LOG" ] || { echo 0; return 0; }
  awk -F '\t' -v day="$day" -v session="$session" \
    '$1 ~ ("^" day "T") && $2 == session { count += 1 } END { print count + 0 }' \
    "$RECOVERY_LOG" 2>/dev/null
}

record_recovery() {
  # Stampa il conteggio giornaliero solo DOPO aver scritto l'evento. Se la
  # scrittura fallisce non mandiamo un numero inventato al Capitano: log loud,
  # nessuna misura dichiarata completa.
  local session="$1" observation="$2" now day count
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  day="${now%%T*}"
  mkdir -p "$(dirname "$RECOVERY_LOG")" 2>/dev/null || {
    log "recovery: $session observed inactive, but cannot create durable log $RECOVERY_LOG"
    return 1
  }
  printf '%s\t%s\t%s\n' "$now" "$session" "$observation" >> "$RECOVERY_LOG" || {
    log "recovery: $session observed inactive, but cannot record durable event in $RECOVERY_LOG"
    return 1
  }
  count="$(recovery_today_count "$day" "$session")"
  case "$count" in ''|*[!0-9]*)
    log "recovery: $session recorded, but daily count is undecidable in $RECOVERY_LOG"
    return 1
    ;;
  esac
  echo "$count"
}

notify_captain_recovery() {
  # "morto" sarebbe una causa inventata: tmux ci dice solo che la sessione
  # era inattiva. Diciamo il fatto osservato, registriamo il recupero riuscito
  # e rendiamo il conteggio recuperabile dal TSV. Il sender verifica il submit;
  # un suo fallimento non cancella l'evidenza appena scritta.
  local session="$1" observation="$2" count rc
  count="$(record_recovery "$session" "$observation")" || return 1
  if "$TMUX_SENDER" CAPITANO \
      "[WATCHDOG] Automatic recovery: $session was $observation and was recreated successfully. Recovery #$count for $session today; durable count: $RECOVERY_LOG. The watchdog observed an inactive session, not the cause of its stop." \
      >/dev/null 2>&1; then
    log "recovery: $session recorded as #$count today and notified CAPITANO"
    return 0
  fi
  rc=$?
  log "recovery: $session recorded as #$count today, but CAPITANO notification failed (rc=$rc); durable event remains in $RECOVERY_LOG"
  return "$rc"
}

ensure_agent() {
  local role="$1"
  local session
  session="$(echo "$role" | tr '[:lower:]' '[:upper:]')"
  if is_session_alive "$session"; then
    return 0
  fi
  log "agent $role: session $session is inactive — relaunching via jht team start"
  if "$NODE_BIN" "$JHT_BIN" team start "$role" >>"$LOG" 2>&1; then
    # Il comando accetta anche il no-op "gia' attivo" e uno spawner può uscire
    # 0 prima che la TUI sia davvero pronta. Non dichiarare una resurrezione
    # solo perché l'abbiamo chiesta: la stessa sonda deve vedere la sessione
    # viva DOPO lo start.
    if ! is_session_alive "$session"; then
      log "agent $role: start reported OK but session $session is still inactive — recovery not recorded"
      return 1
    fi
    log "agent $role: start OK and session verified alive"
    if [ "$INTENTIONAL_RECREATE_SESSION" = "$session" ]; then
      log "agent $role: intentional refresh recreated — not counted as an inactive-session recovery"
      INTENTIONAL_RECREATE_SESSION=""
    else
      notify_captain_recovery "$session" "inactive at the watchdog check" || true
    fi
  else
    log "agent $role: start FAILED (rc=$?) — retrying at the next tick"
  fi
}

session_age_h() {
  # Età della sessione tmux in ore intere (now - session_created).
  local session="$1" created now
  created=$(tmux display-message -p -t "$session" '#{session_created}' 2>/dev/null) || return 1
  [ -z "$created" ] && return 1
  now=$(date -u +%s)
  echo $(( (now - created) / 3600 ))
}

maybe_refresh_sentinella() {
  # Refresh-per-ETÀ della SENTINELLA: near-stateless (stato nel bridge/config,
  # non nella chat) → un context window vecchio di ore le fa "sbagliare" il
  # giudizio di pace. Oltre la soglia la si ricrea fresca. age-based (NON
  # health-based) → niente restart-loop V4. Killa qui: ensure_agent la ricrea
  # nello stesso tick (subito sotto nel loop). Gli ALTRI core li rinfresca il
  # Dottore (refresh ricco). Qui solo lei.
  is_session_alive SENTINELLA || return 0   # se non viva, la (ri)crea ensure_agent
  # Niente refresh fuori orario lavorativo: ricreare ora sprecherebbe un
  # kick-off LLM di notte (allineato alla regola "no LLM fuori finestra").
  python3 -c "import sys; sys.path.insert(0,'/app'); from shared.skills.working_hours import is_within_working_hours as f; sys.exit(0 if f() else 1)" 2>/dev/null || return 0
  local age
  age=$(session_age_h SENTINELLA) || return 0
  if [ "$age" -ge "$SENTINELLA_MAX_CTX_AGE_H" ]; then
    log "sentinella: context age ${age}h ≥ ${SENTINELLA_MAX_CTX_AGE_H}h — refreshing (kill+recreate) to clear the context"
    if tmux kill-session -t SENTINELLA 2>/dev/null; then
      INTENTIONAL_RECREATE_SESSION="SENTINELLA"
    fi
  fi
}

is_agent_session() {
  # Sessioni soggette a TTL: i core + i worker numerati + il Critico.
  # ESCLUSE di proposito: DOTTORE / MANTENITORE / DOCTOR-WATCHDOG (one-shot,
  # li rimpiazza il loro scheduler), SENTINELLA-WORKER (pane di appoggio del
  # bridge, non un agente LLM con contesto) e qualunque sessione utente.
  case "$1" in
    DOTTORE*|DOCTOR-WATCHDOG|MANTENITORE*|SENTINELLA-WORKER) return 1 ;;
    ASSISTENTE|CAPITANO|MENTOR|SENTINELLA|CRITICO) return 0 ;;
    SCOUT-[0-9]*|ANALISTA-[0-9]*|SCORER-[0-9]*|SCRITTORE-[0-9]*|CRITICO-S[0-9]*) return 0 ;;
    *) return 1 ;;
  esac
}

session_role() {
  # SCOUT-3 → "scout 3" · CRITICO-S3 → "critico 3" · CAPITANO →
  # "capitano". Stampa "ruolo[ istanza]".
  local s="$1" base inst
  case "$s" in
    CRITICO-S*)
      inst="${s#CRITICO-S}"
      case "$inst" in ''|0|0[0-9]*|*[!0-9]*) return 1 ;; esac
      printf 'critico %s' "$inst"
      return 0
      ;;
  esac
  base="${s%%-*}"
  inst=""
  case "$s" in
    *-*) inst="${s##*-}"; case "$inst" in ''|*[!0-9]*) inst="" ;; esac ;;
  esac
  printf '%s %s' "$(echo "$base" | tr '[:upper:]' '[:lower:]')" "$inst"
}

worker_kickoff() {
  # Un respawn senza kick-off lascia l'agente al prompt vuoto: la sessione
  # risulta viva e non lavora — esattamente il guasto invisibile che questo
  # watchdog esiste per evitare. Messaggio minimo per ruolo; il protocollo
  # completo sta nel prompt che start-agent.sh ha già installato.
  local session="$1" role="$2" body
  case "$role" in
    scout)     body="Resume the main loop: start from CIRCLE 1 of the candidate profile and notify the Analysts in batches of 3–5 positions." ;;
    analista)  body="Resume the main loop using the db_query.py next-for-analista queue." ;;
    scorer)    body="Resume the main loop using the db_query.py next-for-scorer queue." ;;
    scrittore) body="Resume the main loop using the db_query.py next-for-scrittore queue." ;;
    *)         body="Resume the main loop as instructed by your prompt." ;;
  esac
  ( sleep 12
    jht-tmux-send "$session" "[@watchdog -> @$(echo "$session" | tr '[:upper:]' '[:lower:]')] [MSG] Session recreated by the watchdog. $body" >/dev/null 2>&1 || true
  ) >/dev/null 2>&1 &
}

respawn_worker() {
  # start-agent.sh con lo STESSO numero d'istanza (il dado di
  # roll_worker_number è per gli spawn NUOVI, non per le ricreazioni).
  local role="$1" inst="$2" session="$3" recovery_kind="${4:-unexpected}"
  if JHT_HOME="$JHT_HOME" bash "$START_AGENT" "$role" "$inst" >>"$LOG" 2>&1; then
    if ! is_session_alive "$session"; then
      log "worker $session: start reported OK but session is still inactive — recovery not recorded"
      return 1
    fi
    log "worker $session: start OK and session verified alive"
    worker_kickoff "$session" "$role"
    if [ "$recovery_kind" = "unexpected" ]; then
      notify_captain_recovery "$session" "missing after recent worker activity" || true
    else
      log "worker $session: intentional refresh recreated — not counted as an inactive-session recovery"
    fi
    return 0
  fi
  log "worker $session: start FAILED — retrying at the next tick"
  return 1
}

maybe_ttl_refresh() {
  # TTL duro su ogni sessione agente. SOLO l'età decide: nessun gate orario,
  # nessuna soglia di contesto, nessun check di salute, nessuno stato PARKED.
  # Un refresh per tick, il più vecchio per primo (scaglionamento).
  local oldest="" oldest_age=-1 line s age
  while IFS= read -r line; do
    s="${line%%|*}"
    [ -z "$s" ] && continue
    is_agent_session "$s" || continue
    age=$(session_age_h "$s") || continue
    [ -z "$age" ] && continue
    if [ "$age" -ge "$AGENT_MAX_SESSION_AGE_H" ] && [ "$age" -gt "$oldest_age" ]; then
      oldest="$s"; oldest_age="$age"
    fi
  done <<EOF
$(tmux list-sessions -F '#{session_name}' 2>/dev/null)
EOF
  [ -z "$oldest" ] && return 0

  local role inst
  read -r role inst <<EOF
$(session_role "$oldest")
EOF
  log "ttl: $oldest is ${oldest_age}h old ≥ ${AGENT_MAX_SESSION_AGE_H}h — kill+recreate (age only: context/PARKED/activity do NOT matter)"
  if ! tmux kill-session -t "$oldest" 2>/dev/null; then
    return 0
  fi
  # I core li ricrea ensure_agent nello stesso tick (subito sotto nel loop);
  # i worker numerati non passano di lì e vanno ricreati qui.
  if [ -n "$inst" ]; then
    respawn_worker "$role" "$inst" "$oldest" intentional_ttl
  else
    INTENTIONAL_RECREATE_SESSION="$oldest"
  fi
  return 0
}

maybe_respawn_workers() {
  # Rete deterministica sui worker numerati: fino al 2026-07-29 la lista
  # AGENTS copriva solo i core, quindi Scout/Analisti/Scorer/Scrittori —
  # cioè tutti quelli che PRODUCONO — non erano sorvegliati da nulla che non
  # fosse un agente. Quattro sono morti in silenzio nell'incidente.
  #
  # La decisione di respawnare NON è presa qui: sta in team_roster.py, che
  # applica il gate orario (fuori finestra un worker assente è normale), il
  # cancello di attività (si ricrea solo chi stava LAVORANDO quando è sparito
  # — chi il Capitano ha tolto era già fermo), la sonda a colpo singolo e il
  # tetto globale. Qui si esegue e basta: uno per tick.
  [ -f "$ROSTER_TOOL" ] || return 0
  local plan role inst session
  plan=$(JHT_HOME="$JHT_HOME" python3 "$ROSTER_TOOL" next-respawn 2>/dev/null) || return 0
  [ -z "$plan" ] && return 0
  read -r role inst session <<EOF
$plan
EOF
  [ -z "${session:-}" ] && return 0
  log "roster: expected session $session is missing (recently active) — respawning via start-agent.sh $role $inst"
  JHT_HOME="$JHT_HOME" python3 "$ROSTER_TOOL" mark-respawn "$session" >/dev/null 2>&1 || true
  respawn_worker "$role" "$inst" "$session"
}

bridge_flap_ok() {
  # 0 se sotto il cap di respawn nella finestra, 1 se il cap è superato.
  local key="$1" f="$BRIDGE_STATE_DIR/bridge-flap-$1" now cutoff cnt
  now=$(date -u +%s); cutoff=$((now - BRIDGE_FLAP_WINDOW_SEC))
  [ -f "$f" ] || return 0
  cnt=$(awk -v c="$cutoff" '$1+0>=c' "$f" 2>/dev/null | wc -l | tr -d ' ')
  [ "${cnt:-0}" -lt "$BRIDGE_FLAP_CAP" ]
}

bridge_flap_record() {
  # appende 'now' e pota i timestamp fuori finestra (rolling window).
  local key="$1" f="$BRIDGE_STATE_DIR/bridge-flap-$1" now cutoff
  now=$(date -u +%s); cutoff=$((now - BRIDGE_FLAP_WINDOW_SEC))
  { [ -f "$f" ] && awk -v c="$cutoff" '$1+0>=c' "$f" 2>/dev/null; echo "$now"; } \
    > "$f.tmp" 2>/dev/null && mv "$f.tmp" "$f" 2>/dev/null || true
}

bridge_escalate() {
  # avvisa il Capitano UNA volta per finestra di cooldown (no spam), poi tace.
  local what="$1" now ef last
  now=$(date -u +%s)
  ef="$BRIDGE_STATE_DIR/bridge-escalate.ts"
  if [ -f "$ef" ]; then
    last=$(cat "$ef" 2>/dev/null || echo 0)
    [ $((now - last)) -lt "$BRIDGE_ESCALATE_COOLDOWN_SEC" ] && return 0
  fi
  echo "$now" > "$ef" 2>/dev/null || true
  log "bridge-watchdog: FLAP CAP exceeded ($what) — STOPPING respawn and escalating to Capitano"
  jht-tmux-send CAPITANO "[WATCHDOG] $what keeps dying (>${BRIDGE_FLAP_CAP} respawns in $((BRIDGE_FLAP_WINDOW_SEC/60)) min). Automatic respawn has been STOPPED to prevent a crash loop. Manual diagnosis is required: check \$JHT_HOME/logs/*-bridge.log. The Mantenitore will still run a complete canary on the next sweep." >/dev/null 2>&1 || true
}

tg_bots_configured() {
  # vero se almeno un bot Telegram ha un token (channels.telegram.bots.<role>).
  python3 - "$CONFIG" 2>/dev/null <<'PYEOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    sys.exit(1)
bots = (d.get("channels", {}) or {}).get("telegram", {}).get("bots", {}) or {}
sys.exit(0 if any((b or {}).get("bot_token") for b in bots.values()) else 1)
PYEOF
}

maybe_respawn_bridges() {
  # Liveness via process_health.py (legge /proc in PYTHON → NIENTE self-match,
  # a differenza di `grep MARKER /proc/*/cmdline` che trova il proprio argv e
  # riporterebbe SEMPRE "vivo"). Unica fonte di verità, condivisa col Mantenitore
  # (step 0 di maintainer-sweep). In steady-state: 1 call, tutti vivi, zero azione.
  local plan PROC_DEAD_BRIDGE_SUITE="" PROC_DEAD_DEEP="" PROC_TG_ALIVE=0 PROC_ALL_OK=1
  local PROC_TG_MISSING="" PROC_TG_EXPECTED=0 _tg_role
  # NB: process_health.py esce 1 PROPRIO quando c'è un morto (è il caso che ci
  # interessa) → NON gatare su `|| return` sull'exit code, sarebbe un no-op
  # esattamente quando serve agire. Catturiamo l'output sempre; skip solo se vuoto
  # (python assente/errore reale).
  # Path override-abili come JHT_PROC_KILL_PY (daemon-lib.sh): il default è
  # quello del container, e fuori si può eseguire questa funzione per davvero
  # invece di leggerla.
  plan=$(python3 "$PROCESS_HEALTH_TOOL" summary --shell 2>/dev/null)
  [ -z "$plan" ] && return 0
  eval "$plan" 2>/dev/null || return 0
  # Uscita rapida dello steady-state. La condizione sul Telegram è "nessun
  # ruolo atteso manca" (O-58): con `-ge 3` una install a due bot non usciva
  # mai di qui, e ogni tick ripartiva la riparazione di qualcosa che non era
  # rotto. `PROC_TG_MISSING` assente (versione vecchia dello script) → vuoto →
  # nessun respawn, che è il default prudente.
  local _tg_missing="${PROC_TG_MISSING:-}"
  [ "${PROC_ALL_OK:-1}" = "1" ] && [ -z "$PROC_DEAD_BRIDGE_SUITE" ] && [ -z "$_tg_missing" ] && return 0

  # (1) bridge-suite morti → un solo `start-agent.sh bridge` li rispawna tutti
  #     (idempotente kill+respawn). Anti-flap: oltre il cap, escala invece di loopare.
  if [ -n "$PROC_DEAD_BRIDGE_SUITE" ]; then
    if bridge_flap_ok bridge; then
      log "bridge-watchdog: incomplete suite (dead: $PROC_DEAD_BRIDGE_SUITE) — respawning via start-agent.sh bridge"
      JHT_HOME="$JHT_HOME" bash "$START_AGENT" bridge >>"$LOG" 2>&1 \
        || log "bridge-watchdog: respawn bridge FAIL (rc=$?)"
      bridge_flap_record bridge
    else
      bridge_escalate "suite bridge (morti: $PROC_DEAD_BRIDGE_SUITE)"
    fi
  fi

  # (2) tg-bridge: canale Telegram OPZIONALE → respawn dei SOLI ruoli mancanti.
  #
  # O-58 — prima qui c'era `PROC_TG_ALIVE < 3`, cioè un conteggio globale
  # confrontato con un numero fisso, e la riparazione era rifare tutti e tre.
  # Due conseguenze, entrambe pagate: un bot non configurato (mentor senza
  # token → FATAL in partenza) teneva il conteggio sotto soglia PER SEMPRE, e
  # ogni giro uccideva e ricreava anche i due bridge SANI. In quella finestra
  # un messaggio dell'operatore è stato ricevuto e mai consegnato.
  #
  # Ora `PROC_TG_MISSING` contiene i ruoli ATTESI (= con bot_token) e assenti:
  # vuoto significa "niente da fare", anche quando i processi sono meno di
  # tre. Il flap-cap è per ruolo, se no quello rotto consuma il credito dei
  # sani e li lascia morti quando muoiono davvero.
  if tg_bots_configured && [ -n "${PROC_TG_MISSING:-}" ]; then
    for _tg_role in $PROC_TG_MISSING; do
      if bridge_flap_ok "tg-bridge-$_tg_role"; then
        log "bridge-watchdog: tg-bridge[$_tg_role] missing (alive=${PROC_TG_ALIVE:-0}, expected=${PROC_TG_EXPECTED:-0}) — respawning that role only"
        JHT_HOME="$JHT_HOME" bash "$START_AGENT" tg-bridge "$_tg_role" >>"$LOG" 2>&1 \
          || log "bridge-watchdog: respawn tg-bridge[$_tg_role] FAIL (rc=$?)"
        bridge_flap_record "tg-bridge-$_tg_role"
      else
        bridge_escalate "tg-bridge[$_tg_role]"
      fi
    done
  fi

  # (3) Process "profondi" morti (doctor-watchdog/auto-report/cloud-daemon/pid1):
  #     dovrebbe rispawnarli pid1. Se restano morti è un problema più serio →
  #     ESCALA (NON tentare il respawn da qui: li orfaneremmo). agent-watchdog
  #     non comparirà mai qui (è il processo che gira questo check).
  if [ -n "$PROC_DEAD_DEEP" ]; then
    bridge_escalate "process pid1-managed morti: $PROC_DEAD_DEEP"
  fi
}

log "watchdog start · interval=${INTERVAL_SEC}s · agents=${AGENTS[*]} · sentinella_max_ctx_age=${SENTINELLA_MAX_CTX_AGE_H}h · agent_ttl=${AGENT_MAX_SESSION_AGE_H}h (no schedule gate, one per tick) · worker_supervision=roster · bridge_supervision=on (flap_cap=${BRIDGE_FLAP_CAP}/$((BRIDGE_FLAP_WINDOW_SEC/60))min)"

# Loop principale: gate sulla config (può non essere ancora pronta al
# primo boot del container — il wizard la scrive post-pairing). Sleep
# tra un tick e l'altro anche quando non facciamo niente: non vogliamo
# saturare CPU.
trap 'log "watchdog shutdown (SIGTERM)"; exit 0' TERM INT

TEAM_HALTED_FLAG="$JHT_HOME/.team-halted.flag"
WEEKLY_HALT_FLAG="$JHT_HOME/.weekly-halt.flag"
# Standby a spesa zero ([TEAM-STANDBY-ZERO-SPEND]): flag DIVERSO da halted,
# semantica diversa — halted = "l'utente ha fermato il team" (tutto giù),
# standby = sospensione tecnica che si risveglia da sola via sentinel-bridge.
TEAM_STANDBY_FLAG="$JHT_HOME/.team-standby.flag"
STANDBY_PY="${JHT_STANDBY_PY:-/app/shared/skills/standby.py}"
[ -f "$STANDBY_PY" ] || STANDBY_PY="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)/shared/skills/standby.py"

# Standby ATTIVO adesso? UN solo predicato per tutto il team
# ([STANDBY-EXPIRY-IGNORED-BY-RESPAWNERS]): il flag porta con sé la sua
# condizione di uscita (`until`/`wake_on`), quindi un flag SCADUTO non è più
# standby. Gatare sulla nuda esistenza del file lascerebbe questo watchdog a
# non respawnare più nulla se chi doveva rimuovere il flag è morto — lo
# standby eterno, cioè il caso che il flag esiste per rendere impossibile.
#
# Fail-CLOSED: il predicato risponde con una PAROLA su stdout; qualunque altro
# esito (python assente, modulo rotto, traceback) ricade sul comportamento
# storico `[ -e "$TEAM_STANDBY_FLAG" ]`. Riaccendere il team a spesa zero per
# un errore Python sarebbe peggio del bug che stiamo correggendo.
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
halt_log_tick=0
standby_log_tick=0
# Contatore per rendere LOUD un config_ready=false PERSISTENTE (ramo else in fondo
# al loop): al primo boot è normale (wizard non ancora finito), ma oltre la grace
# è un guasto reale che NON deve restare invisibile. Grace ~5min @ 30s/tick.
config_not_ready_tick=0
CONFIG_NOT_READY_GRACE_TICKS="${JHT_CONFIG_NOT_READY_GRACE_TICKS:-10}"

while true; do
  # Team-halted gate (set by team-state-reconciler quando user clicca Stop
  # dalla dashboard). Source of truth: team_state.should_run. Quando
  # presente, NIENTE respawn — l'utente ha esplicitamente fermato.
  # Stesso comportamento per .weekly-halt.flag (limite rate budget).
  if [ -e "$TEAM_HALTED_FLAG" ] || [ -e "$WEEKLY_HALT_FLAG" ]; then
    if [ $((halt_log_tick % 20)) -eq 0 ]; then
      if [ -e "$TEAM_HALTED_FLAG" ]; then
        log "halt: .team-halted.flag present — agent respawn disabled"
      else
        log "halt: .weekly-halt.flag present — agent respawn disabled"
      fi
    fi
    halt_log_tick=$((halt_log_tick + 1))
    sleep "$INTERVAL_SEC"
    continue
  fi
  if [ "$halt_log_tick" -gt 0 ]; then
    log "halt: flag removed — resuming watchdog respawn"
    halt_log_tick=0
  fi

  # Standby a spesa zero: le sessioni agente restano vive ma MUTE — niente
  # respawn (una sessione ricreata fa un kick-off LLM = spesa) e niente
  # refresh-per-età della Sentinella. I BRIDGE però restano sorvegliati: in
  # standby sono LORO la sveglia (il sentinel-bridge valuta until/wake_on a
  # ogni tick) e un bridge morto senza respawn = standby eterno. È l'unica
  # differenza rispetto al gate halted qui sopra, ed è deliberata.
  if standby_active; then
    if [ $((standby_log_tick % 20)) -eq 0 ]; then
      log "standby: ACTIVE — agent respawn/refresh suspended; bridge supervision remains ACTIVE"
    fi
    standby_log_tick=$((standby_log_tick + 1))
    if config_ready; then
      maybe_respawn_bridges
    fi
    sleep "$INTERVAL_SEC"
    continue
  fi
  if [ "$standby_log_tick" -gt 0 ]; then
    log "standby: no longer active (flag removed or expired) — resuming agent respawn/refresh"
    standby_log_tick=0
  fi

  if config_ready; then
    if [ "$config_not_ready_tick" -gt 0 ]; then
      log "config: ready again after ${config_not_ready_tick} ticks — resuming agent respawn"
      config_not_ready_tick=0
    fi
    # Refresh-per-età della Sentinella PRIMA del giro di ensure: se è troppo
    # vecchia la killa, poi ensure_agent la ricrea fresca nello stesso tick.
    maybe_refresh_sentinella
    # TTL duro (12h) su ogni sessione agente, uno per tick, il più vecchio
    # per primo. Deliberatamente PRIMA di ensure_agent: se la vittima è un
    # core, ensure_agent la ricrea fresca subito sotto.
    maybe_ttl_refresh
    for role in "${AGENTS[@]}"; do
      ensure_agent "$role"
    done
    # Worker numerati: respawn guidato dal roster atteso (gate orario +
    # cancello di attività + sonda a colpo singolo dentro team_roster.py).
    maybe_respawn_workers
    # Bridge/daemon detached (sentinel/pacing/heartbeat-bridge/window-ratio/
    # codex-auth-healer + tg-bridge): respawn se morti, con anti-flap. Sono
    # fuori dal respawn-on-crash di pid1 (setsid), questo è il loro recovery.
    maybe_respawn_bridges
  else
    # config non pronta. Al primo boot è NORMALE (il wizard la scrive post-pairing):
    # restiamo silenziosi per i primi CONFIG_NOT_READY_GRACE_TICKS. Ma se PERSISTE
    # oltre la grace è un guasto vero (active_provider fuori-mappa, credenziali
    # mancanti) e NON deve più essere invisibile: quella silenziosità ha tenuto
    # ashley morta ~44h il 2026-07-18 senza una riga di log. Escaliamo a log loud.
    if [ "$config_not_ready_tick" -eq "$CONFIG_NOT_READY_GRACE_TICKS" ]; then
      _prov="$(python3 -c "import json,sys; print((json.load(open(sys.argv[1])).get('active_provider') or '?').strip() or '?')" "$CONFIG" 2>/dev/null || echo '?')"
      log "config NOT ready for ${CONFIG_NOT_READY_GRACE_TICKS} ticks (~$((CONFIG_NOT_READY_GRACE_TICKS*INTERVAL_SEC/60)) min): active_provider='${_prov}' has no valid credential marker — CAPITANO/MENTOR respawn SUSPENDED. If this is not the initial wizard, check active_provider against the map in config_ready()."
    elif [ "$config_not_ready_tick" -gt "$CONFIG_NOT_READY_GRACE_TICKS" ] && [ $((config_not_ready_tick % 60)) -eq 0 ]; then
      log "config still NOT ready (tick=${config_not_ready_tick}) — agent respawn remains suspended"
    fi
    config_not_ready_tick=$((config_not_ready_tick + 1))
  fi
  sleep "$INTERVAL_SEC"
done

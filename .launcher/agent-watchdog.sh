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
# Failure mode: retry al prossimo tick, non fail-fast — MA il fallimento viene
# anche MISURATO (agent-spawn-failures.tsv) ed escalato in due gradini, vedi il
# blocco "Fallimenti di spawn" sotto. Fino al 2026-09-03 era solo una riga di
# log, e un agente che non partiva restava invisibile per giorni.
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
# Canale verso l'UTENTE: CLI Python deterministico (scrive in
# pending_user_messages, poi tenta Telegram e ricade sulla dashboard). Zero
# token: il gradino 2 dell'escalation non deve costare un turno LLM, perche'
# il caso peggiore e' proprio quello in cui gli agenti non partono.
# Iniettabile come le altre tre dipendenze: i test non chiamano il binario vero.
NOTIFY_USER_BIN="${JHT_NOTIFY_USER_BIN:-jht-notify-user}"
# TTL e refresh della Sentinella sono ricreazioni DECISIONALI, non morti da
# misurare. Il prossimo ensure_agent consuma questo singolo marcatore.
INTENTIONAL_RECREATE_SESSION=""

# ── Fallimenti di spawn: la misura che mancava ──────────────────────────
# Il watchdog misurava i propri SUCCESSI (RECOVERY_LOG) e restava cieco sui
# propri FALLIMENTI: il ramo `start FAILED` era una riga di log e nient'altro,
# che nessun consumatore legge. Su una VPS di produzione un agente core non e'
# riuscito a partire per 2.677 tentativi consecutivi senza che scattasse alcun
# allarme — non perche' la soglia fosse alta, ma perche' non esisteva nessun
# contatore da superare. Nessuno degli altri anelli lo vedeva: process_health.py
# non ha sessioni agente in EXPECTED, il Dottore inventaria le sessioni che
# ESISTONO, il Mantenitore ha il divieto esplicito di toccare le sessioni
# agente, e nessuno script del launcher aveva mai parlato all'utente.
#
# Registro SEPARATO da RECOVERY_LOG di proposito: recovery_today_count() conta
# le righe per sessione SENZA filtrare l'osservazione, quindi una terza colonna
# nel TSV dei recuperi falsificherebbe il "Recovery #N" che il Capitano riceve.
SPAWN_FAILURE_LOG="${JHT_AGENT_SPAWN_FAILURE_LOG:-$JHT_HOME/logs/agent-spawn-failures.tsv}"
# Stato per-sessione: serie corrente + marcatori di escalation (che fanno anche
# da cooldown). Directory iniettabile per poter esercitare l'anti-spam nei test.
SPAWN_STATE_DIR="${JHT_SPAWN_STATE_DIR:-$JHT_HOME/logs}"
# Presa in carico dal CAPITANO: DUE condizioni necessarie — conteggio E tempo
# trascorso dal primo fallimento della serie, sul modello di
# CONFIG_NOT_READY_GRACE_TICKS. Il solo conteggio suonerebbe su un cold start
# lento (`jht team start` concede da solo 90s per tentativo); il solo tempo
# suonerebbe su un flap benigno. Al tick di default (30s) e col backoff sotto,
# l'aritmetica e': gradino 1 dopo ~5 min, gradino 2 dopo ~20 min — e il vincolo
# che lega e' il TEMPO, i conteggi proteggono un INTERVAL_SEC molto largo.
SPAWN_FAIL_ESCALATE_AFTER="${JHT_SPAWN_FAIL_ESCALATE_AFTER:-5}"
SPAWN_FAIL_ESCALATE_MIN_SEC="${JHT_SPAWN_FAIL_ESCALATE_MIN_SEC:-300}"
# Allarme all'UTENTE: stessa doppia condizione, seconda soglia. ~20 min
# ininterrotti al tick di default.
SPAWN_FAIL_ALERT_AFTER="${JHT_SPAWN_FAIL_ALERT_AFTER:-8}"
SPAWN_FAIL_ALERT_MIN_SEC="${JHT_SPAWN_FAIL_ALERT_MIN_SEC:-1200}"
# Anti-spam PER SESSIONE (non globale): un allarme non deve zittirne un altro.
SPAWN_FAIL_COOLDOWN_SEC="${JHT_SPAWN_FAIL_COOLDOWN_SEC:-3600}"
SPAWN_FAIL_ALERT_COOLDOWN_SEC="${JHT_SPAWN_FAIL_ALERT_COOLDOWN_SEC:-21600}"
# Oltre il gradino 1 si tenta UNA volta ogni N tick invece di una per tick.
# NON e' un cap: vedi spawn_backoff_active — il respawn non si ferma mai.
SPAWN_FAIL_BACKOFF_TICKS="${JHT_SPAWN_FAIL_BACKOFF_TICKS:-10}"
# Una serie e' CONSECUTIVA: se dall'ultimo fallimento e' passato piu' di questo,
# la sessione e' tornata su per una strada che questo watchdog non vede (Dottore,
# Capitano, riavvio del container) e il conteggio riparte da 1. Senza questa
# scadenza fallimenti separati da giorni si sommerebbero fino a suonare a vuoto.
SPAWN_FAIL_STREAK_TTL_SEC="${JHT_SPAWN_FAIL_STREAK_TTL_SEC:-1800}"

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

escalate_key() {
  # Chiave usabile come nome di file. bridge_escalate riceve testo libero
  # (nomi di processi morti, ruoli), quindi la sanificazione non e' teorica.
  printf '%s' "$1" | tr -c 'A-Za-z0-9._-' '_' | cut -c1-64
}

escalate_once() {
  # 0 (e aggiorna il timestamp) se il cooldown di QUESTA chiave e' scaduto.
  # Il cooldown vive in un file PER CHIAVE: prima bridge_escalate ne usava uno
  # solo per qualunque allarme, quindi un'escalation sui bridge zittiva per
  # un'ora quella sui process pid1-managed e viceversa. Un allarme che ne
  # sopprime un altro e' peggio di nessun cooldown.
  local f="$1" cooldown="$2" now last
  now="$(date -u +%s)"
  if [ -f "$f" ]; then
    last="$(cat "$f" 2>/dev/null || echo 0)"
    case "$last" in ''|*[!0-9]*) last=0 ;; esac
    [ $((now - last)) -lt "$cooldown" ] && return 1
  fi
  mkdir -p "$(dirname "$f")" 2>/dev/null || true
  echo "$now" > "$f" 2>/dev/null || true
  return 0
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

spawn_streak_state() {
  # "count first_ts last_ts" della serie corrente, "0 0 0" se non c'e'.
  local f line
  f="$SPAWN_STATE_DIR/spawn-streak-$(escalate_key "$1")"
  [ -f "$f" ] || { echo "0 0 0"; return 0; }
  line="$(tr -d '\r' < "$f" 2>/dev/null | head -1)"
  case "$line" in
    [0-9]*' '[0-9]*' '[0-9]*) echo "$line" ;;
    *) echo "0 0 0" ;;
  esac
}

spawn_log_offset() {
  # Byte del LOG PRIMA del tentativo: il "detail" di un fallimento e' l'ultima
  # riga che lo spawner scrive dopo questo punto. Si legge dal log invece di
  # catturare l'output in una variabile perche' la cattura serializza: su uno
  # spawner APPESO — il guasto di produzione — perderemmo anche l'output
  # parziale, che in quel caso e' l'unica traccia che resta.
  [ -f "$LOG" ] || { echo 0; return 0; }
  wc -c < "$LOG" 2>/dev/null | tr -d ' \t' || echo 0
}

spawn_detail_since() {
  # Ultima riga non vuota aggiunta al LOG dopo l'offset, normalizzata: il
  # registro e' un TSV e il testo finisce anche in un messaggio.
  local offset="$1"
  case "$offset" in ''|*[!0-9]*) offset=0 ;; esac
  [ -f "$LOG" ] || return 0
  tail -c "+$((offset + 1))" "$LOG" 2>/dev/null \
    | grep -v '^[[:space:]]*$' | tail -1 | tr '\t\r' '  ' | cut -c1-200
}

record_spawn_failure() {
  # Gemella di record_recovery, sul ramo che finora era muto. Stampa la serie
  # di fallimenti CONSECUTIVI solo DOPO aver scritto: se la scrittura fallisce
  # non mandiamo a nessuno un numero inventato — log loud, nessuna misura
  # dichiarata completa.
  local session="$1" detail="$2" now ts count first last f
  now="$(date -u +%s)"
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  f="$SPAWN_STATE_DIR/spawn-streak-$(escalate_key "$session")"
  mkdir -p "$SPAWN_STATE_DIR" "$(dirname "$SPAWN_FAILURE_LOG")" 2>/dev/null || {
    log "spawn-failure: $session did not start, but cannot create the durable register $SPAWN_FAILURE_LOG"
    return 1
  }
  printf '%s\t%s\t%s\n' "$ts" "$session" "$detail" >> "$SPAWN_FAILURE_LOG" || {
    log "spawn-failure: $session did not start, but cannot record the durable event in $SPAWN_FAILURE_LOG"
    return 1
  }
  read -r count first last <<EOF
$(spawn_streak_state "$session")
EOF
  if [ "$count" -gt 0 ] && [ $((now - last)) -gt "$SPAWN_FAIL_STREAK_TTL_SEC" ]; then
    count=0; first=0
  fi
  count=$((count + 1))
  [ "$first" -le 0 ] && first="$now"
  { printf '%s %s %s\n' "$count" "$first" "$now" > "$f.tmp" 2>/dev/null \
      && mv "$f.tmp" "$f" 2>/dev/null; } || {
    log "spawn-failure: $session recorded in $SPAWN_FAILURE_LOG, but the consecutive-streak state is not writable in $SPAWN_STATE_DIR"
    return 1
  }
  echo "$count"
}

spawn_failure_breadth() {
  # Quante sessioni sono in serie di fallimenti ADESSO. Distingue "un agente
  # non parte" da "il team non parte" (provider giu', disco pieno) DENTRO un
  # messaggio, senza sopprimerne nessuno: sopprimere perderebbe il nome della
  # sessione, che e' l'unica informazione azionabile che il messaggio porta.
  # Solo le serie ANCORA aperte: una sessione tornata su per una strada che
  # questo watchdog non vede lascia il suo file indietro, e contarla gonfierebbe
  # il numero. Stessa scadenza usata da record_spawn_failure.
  local f n=0 count last now
  now="$(date -u +%s)"
  for f in "$SPAWN_STATE_DIR"/spawn-streak-*; do
    [ -f "$f" ] || continue
    # Il `.tmp` della scrittura atomica ha lo stesso prefisso: contarlo
    # raddoppierebbe la sessione a cui appartiene, e un numero gonfiato in un
    # messaggio e' un'affermazione non osservata come le altre.
    case "$f" in *.tmp) continue ;; esac
    count="$(cut -d' ' -f1 < "$f" 2>/dev/null)"
    last="$(cut -d' ' -f3 < "$f" 2>/dev/null)"
    case "$count" in ''|*[!0-9]*) continue ;; esac
    case "$last" in ''|*[!0-9]*) continue ;; esac
    [ "$count" -ge "$SPAWN_FAIL_ESCALATE_AFTER" ] \
      && [ $((now - last)) -le "$SPAWN_FAIL_STREAK_TTL_SEC" ] && n=$((n + 1))
  done
  echo "$n"
}

spawn_failure_escalate() {
  # Presa in carico, non un freno: il respawn continua. Il Dottore resta
  # deliberatamente fuori dal percorso automatico — costa un turno LLM ricco e
  # i suoi strumenti lavorano su capture-pane di sessioni ESISTENTI, e qui la
  # sessione non nasce. Resta raggiungibile su decisione del Capitano (C-08).
  local session="$1" detail="$2" streak="$3" now count first last elapsed rc \
        key breadth pace message
  read -r count first last <<EOF
$(spawn_streak_state "$session")
EOF
  now="$(date -u +%s)"
  elapsed=$((now - first))
  [ "$first" -le 0 ] && elapsed=0
  key="$(escalate_key "$session")"
  pace="$((SPAWN_FAIL_BACKOFF_TICKS * INTERVAL_SEC))"

  if [ "$streak" -ge "$SPAWN_FAIL_ESCALATE_AFTER" ] && [ "$elapsed" -ge "$SPAWN_FAIL_ESCALATE_MIN_SEC" ] \
     && escalate_once "$SPAWN_STATE_DIR/spawn-escalate-$key-captain.ts" "$SPAWN_FAIL_COOLDOWN_SEC"; then
    breadth="$(spawn_failure_breadth)"
    # Disciplina dei messaggi: il watchdog ha osservato dei TENTATIVI DI AVVIO
    # FALLITI. Non ha osservato perche' falliscono, e non lo dichiara.
    message="[WATCHDOG] $session cannot be started: $streak consecutive start attempts failed over the last $((elapsed / 60)) min. The watchdog KEEPS RETRYING and never gives up — from now roughly once every $((pace / 60)) min instead of every ${INTERVAL_SEC}s, so do NOT relaunch it by hand before reading the evidence. Last line the spawner wrote: ${detail:-none captured}. Sessions in a failed-start streak right now: $breadth. Durable register: $SPAWN_FAILURE_LOG · full output: $LOG. The watchdog observed failed start attempts, not the reason they fail."
    if "$TMUX_SENDER" CAPITANO "$message" >/dev/null 2>&1; then
      log "spawn-failure: $session at streak $streak (${elapsed}s) — escalated to CAPITANO"
    else
      rc=$?
      log "spawn-failure: $session at streak $streak (${elapsed}s), but the CAPITANO escalation failed (rc=$rc); durable register remains in $SPAWN_FAILURE_LOG"
    fi
  fi

  # Gradino 2 — allarme all'UTENTE. Costa ZERO token: nessuno script di
  # .launcher/ aveva mai usato questo canale, ed e' il motivo per cui un agente
  # non avviabile poteva restare invisibile per giorni.
  if [ "$streak" -ge "$SPAWN_FAIL_ALERT_AFTER" ] && [ "$elapsed" -ge "$SPAWN_FAIL_ALERT_MIN_SEC" ] \
     && escalate_once "$SPAWN_STATE_DIR/spawn-escalate-$key-user.ts" "$SPAWN_FAIL_ALERT_COOLDOWN_SEC"; then
    message="[TEAM] The agent session $session is not starting. The watchdog has tried $streak times in a row over the last $((elapsed / 60)) min and keeps retrying on its own — you do not have to do anything to keep it trying, and the rest of the team goes on without that agent. Observed: every start attempt fails, and the last line the spawner wrote was: ${detail:-none captured}. NOT observed: why it fails. Full history: $SPAWN_FAILURE_LOG and $LOG."
    if "$NOTIFY_USER_BIN" --agent capitano --kind alert "$message" >/dev/null 2>&1; then
      log "spawn-failure: $session at streak $streak (${elapsed}s) — USER alerted via $NOTIFY_USER_BIN"
    else
      rc=$?
      log "spawn-failure: $session at streak $streak (${elapsed}s), but the USER alert failed (rc=$rc) via $NOTIFY_USER_BIN; durable register remains in $SPAWN_FAILURE_LOG"
    fi
  fi
  return 0
}

observe_spawn_failure() {
  # Gemella di notify_captain_recovery sul ramo di fallimento: misura prima,
  # parla dopo. Unico punto di ingresso per i rami che erano muti.
  local session="$1" detail="$2" streak
  streak="$(record_spawn_failure "$session" "$detail")" || return 1
  spawn_failure_escalate "$session" "$detail" "$streak"
}

spawn_backoff_active() {
  # 0 = salta il tentativo in QUESTO tick. NON e' un cap alla bridge_flap_cap:
  # un agente che non parte e per cui smettiamo di provare e' peggio del
  # rumore, quindi il respawn non si ferma MAI — cambia solo il passo. Oltre il
  # gradino 1 un tentativo ogni SPAWN_FAIL_BACKOFF_TICKS tick: meno pressione
  # su lock, CPU e log, e nessuna reattivita' reale persa (se non parte al
  # quinto tentativo non parte al sesto).
  # Deliberatamente MUTO: una riga di log per ogni tick saltato ricreerebbe
  # esattamente il rumore-senza-segnale che questa misura esiste per sostituire
  # (2.677 righe identiche e zero allarmi). La misura sta nel registro.
  local session="$1" count first last now
  [ "$SPAWN_FAIL_BACKOFF_TICKS" -gt 1 ] || return 1
  read -r count first last <<EOF
$(spawn_streak_state "$session")
EOF
  [ "$count" -ge "$SPAWN_FAIL_ESCALATE_AFTER" ] || return 1
  now="$(date -u +%s)"
  [ $((now - first)) -ge "$SPAWN_FAIL_ESCALATE_MIN_SEC" ] || return 1
  [ $((now - last)) -lt $((SPAWN_FAIL_BACKOFF_TICKS * INTERVAL_SEC)) ]
}

clear_spawn_failures() {
  # L'allarme si spegne da solo al primo successo, e chi era stato avvisato
  # viene informato del rientro: un allarme che non si chiude e' un allarme che
  # si impara a ignorare, e il prossimo vero non verra' letto. Il messaggio di
  # rientro non e' un extra, e' parte del contratto.
  # Steady state: tre stat e nessun altro lavoro, nessuna riga di log.
  local session="$1" key streak marker_captain marker_user count first last minutes
  key="$(escalate_key "$session")"
  streak="$SPAWN_STATE_DIR/spawn-streak-$key"
  marker_captain="$SPAWN_STATE_DIR/spawn-escalate-$key-captain.ts"
  marker_user="$SPAWN_STATE_DIR/spawn-escalate-$key-user.ts"
  [ -f "$streak" ] || [ -f "$marker_captain" ] || [ -f "$marker_user" ] || return 0
  read -r count first last <<EOF
$(spawn_streak_state "$session")
EOF
  minutes=$(( (last - first) / 60 ))
  [ "$first" -le 0 ] && minutes=0
  rm -f "$streak" 2>/dev/null || true
  log "spawn-failure: $session started successfully — consecutive-failure streak reset (was $count)"
  if [ -f "$marker_captain" ]; then
    rm -f "$marker_captain" 2>/dev/null || true
    "$TMUX_SENDER" CAPITANO "[WATCHDOG] Resolved: $session started successfully after $count consecutive failed start attempts spanning ${minutes} min. The failed-start alarm for $session is cleared and the watchdog is back to its normal ${INTERVAL_SEC}s interval. History: $SPAWN_FAILURE_LOG" >/dev/null 2>&1 \
      || log "spawn-failure: $session recovered, but the CAPITANO resolution notice failed"
  fi
  if [ -f "$marker_user" ]; then
    rm -f "$marker_user" 2>/dev/null || true
    "$NOTIFY_USER_BIN" --agent capitano --kind notification "[TEAM] $session is running again: it started successfully after $count failed attempts over ${minutes} min. Nothing is pending on your side; the earlier alert about $session is closed." >/dev/null 2>&1 \
      || log "spawn-failure: $session recovered, but the USER resolution notice failed via $NOTIFY_USER_BIN"
  fi
}

ensure_agent() {
  local role="$1"
  local session mark rc detail
  session="$(echo "$role" | tr '[:lower:]' '[:upper:]')"
  # Un containment e' sticky e vale anche per i core: il normale `record`
  # di start-agent non puo' revocarlo, soltanto `release` puo' farlo.
  # Deliberatamente PRIMA di qualsiasi misura: una sessione tenuta giu' non e'
  # un fallimento di spawn e non deve alimentare nessuna serie.
  if agent_is_contained "$session"; then
    return 0
  fi
  if is_session_alive "$session"; then
    # La serie deve essere CONSECUTIVA: se la sessione e' tornata su per una
    # strada che non e' questa (Dottore, Capitano, riavvio), il conteggio va
    # chiuso qui, altrimenti fallimenti di incidenti diversi si sommerebbero.
    clear_spawn_failures "$session"
    return 0
  fi
  # Backoff, non cap: dopo il gradino 1 si tenta piu' RADI, mai zero volte.
  if spawn_backoff_active "$session"; then
    return 0
  fi
  log "agent $role: session $session is inactive — relaunching via jht team start"
  mark="$(spawn_log_offset)"
  if "$NODE_BIN" "$JHT_BIN" team start "$role" >>"$LOG" 2>&1; then
    # PRIMA della sonda: is_session_alive puo' scrivere la sua riga ZOMBIE nel
    # LOG, e attribuirla allo spawner sarebbe dichiarare una causa non
    # osservata su un messaggio che va al Capitano e all'utente.
    detail="$(spawn_detail_since "$mark")"
    # Il comando accetta anche il no-op "gia' attivo" e uno spawner può uscire
    # 0 prima che la TUI sia davvero pronta. Non dichiarare una resurrezione
    # solo perché l'abbiamo chiesta: la stessa sonda deve vedere la sessione
    # viva DOPO lo start.
    if ! is_session_alive "$session"; then
      log "agent $role: start reported OK but session $session is still inactive — recovery not recorded"
      observe_spawn_failure "$session" \
        "start reported rc=0 but the session was still inactive${detail:+ · $detail}" || true
      return 1
    fi
    log "agent $role: start OK and session verified alive"
    clear_spawn_failures "$session"
    if [ "$INTENTIONAL_RECREATE_SESSION" = "$session" ]; then
      log "agent $role: intentional refresh recreated — not counted as an inactive-session recovery"
      INTENTIONAL_RECREATE_SESSION=""
    else
      notify_captain_recovery "$session" "inactive at the watchdog check" || true
    fi
  else
    rc=$?
    detail="$(spawn_detail_since "$mark")"
    log "agent $role: start FAILED (rc=$rc) — retrying at the next tick"
    observe_spawn_failure "$session" "rc=$rc${detail:+ · $detail}" || true
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
  local role="$1" inst="$2" session="$3" recovery_kind="${4:-unexpected}" mark rc detail
  mark="$(spawn_log_offset)"
  if JHT_HOME="$JHT_HOME" bash "$START_AGENT" "$role" "$inst" >>"$LOG" 2>&1; then
    # PRIMA della sonda, come in ensure_agent: la riga ZOMBIE di
    # is_session_alive non e' output dello spawner e non va attribuita a lui.
    detail="$(spawn_detail_since "$mark")"
    if ! is_session_alive "$session"; then
      log "worker $session: start reported OK but session is still inactive — recovery not recorded"
      observe_spawn_failure "$session" \
        "start reported rc=0 but the session was still inactive${detail:+ · $detail}" || true
      return 1
    fi
    log "worker $session: start OK and session verified alive"
    clear_spawn_failures "$session"
    worker_kickoff "$session" "$role"
    if [ "$recovery_kind" = "unexpected" ]; then
      notify_captain_recovery "$session" "missing after recent worker activity" || true
    else
      log "worker $session: intentional refresh recreated — not counted as an inactive-session recovery"
    fi
    return 0
  else
    # `recovery_kind` distingue solo i RECUPERI: una ricreazione voluta (TTL)
    # che NON riesce e' un fallimento di spawn a pieno titolo — la sessione e'
    # gia' stata uccisa e ora non risale. Escluderla riaprirebbe esattamente il
    # buco che questa misura chiude.
    rc=$?
    detail="$(spawn_detail_since "$mark")"
    log "worker $session: start FAILED (rc=$rc) — retrying at the next tick"
    observe_spawn_failure "$session" "rc=$rc${detail:+ · $detail}" || true
    return 1
  fi
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
    agent_is_contained "$s" && continue
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

agent_is_contained() {
  [ -f "$ROSTER_TOOL" ] || return 1
  JHT_HOME="$JHT_HOME" python3 "$ROSTER_TOOL" is-contained "$1" >/dev/null 2>&1
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
  # Backoff, non cap: come per i core, dopo il gradino 1 si tenta piu' RADI.
  # Il gate sta QUI e non in respawn_worker perche' il percorso TTL deve poter
  # ricreare subito una sessione che ha appena ucciso di proposito.
  if spawn_backoff_active "$session"; then
    return 0
  fi
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
  # Il cooldown e' PER CHIAVE: fino al 2026-09-03 c'era un solo
  # `bridge-escalate.ts` per qualunque `what`, quindi un'escalation sulla suite
  # bridge zittiva per un'ora quella sui process pid1-managed e viceversa —
  # cioe' l'allarme piu' grave dei due poteva non arrivare mai.
  local key="$1" what="$2"
  escalate_once "$BRIDGE_STATE_DIR/bridge-escalate-$(escalate_key "$key").ts" \
    "$BRIDGE_ESCALATE_COOLDOWN_SEC" || return 0
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
      bridge_escalate bridge "suite bridge (morti: $PROC_DEAD_BRIDGE_SUITE)"
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
        bridge_escalate "tg-bridge-$_tg_role" "tg-bridge[$_tg_role]"
      fi
    done
  fi

  # (3) Process "profondi" morti (doctor-watchdog/auto-report/cloud-daemon/pid1):
  #     dovrebbe rispawnarli pid1. Se restano morti è un problema più serio →
  #     ESCALA (NON tentare il respawn da qui: li orfaneremmo). agent-watchdog
  #     non comparirà mai qui (è il processo che gira questo check).
  if [ -n "$PROC_DEAD_DEEP" ]; then
    bridge_escalate pid1-child "process pid1-managed morti: $PROC_DEAD_DEEP"
  fi
}

log "watchdog start · interval=${INTERVAL_SEC}s · agents=${AGENTS[*]} · sentinella_max_ctx_age=${SENTINELLA_MAX_CTX_AGE_H}h · agent_ttl=${AGENT_MAX_SESSION_AGE_H}h (no schedule gate, one per tick) · worker_supervision=roster · bridge_supervision=on (flap_cap=${BRIDGE_FLAP_CAP}/$((BRIDGE_FLAP_WINDOW_SEC/60))min) · spawn_failures=measured (capitano after ${SPAWN_FAIL_ESCALATE_AFTER} consecutive and $((SPAWN_FAIL_ESCALATE_MIN_SEC/60))min, user after ${SPAWN_FAIL_ALERT_AFTER} and $((SPAWN_FAIL_ALERT_MIN_SEC/60))min, respawn never stops: backoff to 1 per ${SPAWN_FAIL_BACKOFF_TICKS} ticks)"

# Queste funzioni stanno deliberatamente dopo il marker di bootstrap qui
# sopra: i test unitari storici estraggono il prelude fino a quel marker.
capture_for_containment() {
  local session="$1" evidence_dir stamp evidence
  evidence_dir="$JHT_HOME/logs/containment"
  mkdir -p "$evidence_dir" 2>/dev/null || return 1
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  evidence="$evidence_dir/${stamp}-${session}-reenforced.txt"
  # La scena viene salvata PRIMA del kill. Se la cattura fallisce non
  # distruggiamo la sola evidenza rimasta: ritentiamo al tick successivo.
  tmux capture-pane -t "=$session" -p -S - > "$evidence" 2>/dev/null || {
    rm -f "$evidence" 2>/dev/null || true
    return 1
  }
  chmod 600 "$evidence" 2>/dev/null || true
  printf '%s' "$evidence"
}

maybe_enforce_containments() {
  # Uno spawn ordinario non revoca `contained`: se qualcuno prova a
  # riaccendere la sessione, salviamo di nuovo il pane, la rimettiamo giu' e
  # avvisiamo chi aveva deciso (oltre al Capitano). Nessun override silenzioso.
  [ -f "$ROSTER_TOOL" ] || return 0
  local plan session actor old_evidence evidence message
  plan=$(JHT_HOME="$JHT_HOME" python3 "$ROSTER_TOOL" contained-live --tsv 2>/dev/null) || return 0
  [ -z "$plan" ] && return 0
  while IFS=$'\t' read -r session actor old_evidence; do
    [ -z "$session" ] && continue
    evidence="$(capture_for_containment "$session")" || {
      log "containment: $session is live but capture failed — NOT killing; retry next tick"
      continue
    }
    if tmux kill-session -t "=$session" 2>/dev/null; then
      log "containment: $session was live despite sticky containment — captured to $evidence and stopped again"
      message="[CONTAINMENT] $session was started despite your keep-down decision. The watchdog captured it to $evidence and stopped it again; the containment remains active. Original evidence: $old_evidence"
      "$TMUX_SENDER" "${actor:-CAPITANO}" "$message" >/dev/null 2>&1 || true
      if [ "${actor:-CAPITANO}" != "CAPITANO" ]; then
        "$TMUX_SENDER" CAPITANO "$message" >/dev/null 2>&1 || true
      fi
    fi
  done <<EOF
$plan
EOF
}

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
  # Il containment e' un cancello di sicurezza, non una funzione del provider:
  # resta applicabile anche con config incompleta o credenziali non pronte.
  maybe_enforce_containments
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

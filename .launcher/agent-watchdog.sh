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
# ── TTL su OGNI sessione agente (2026-07-29; condizionato il 2026-11-02, vedi maybe_ttl_refresh) ──
# maybe_ttl_refresh: tetto duro sull'eta' (JHT_AGENT_HARD_CAP_H, 24 h) e, sotto
# il tetto, ricreazione condizionata. Il tetto non guarda contesto, lavoro in
# corso, stato PARKED, orario o salute: nessuna sessione puo' superarlo.
# Motivo (incidente 2026-07-28/29): le sessioni avevano 38,5 · 29,5 · 27,0 ·
# 14,5 · 14,2 ore e TUTTE le euristiche dicevano «sano» mentre il team era
# paralizzato per undici ore. Un tetto d'eta' non ha euristiche da sbagliare.
# Fra JHT_AGENT_MAX_SESSION_AGE_H (12 h) e il tetto, dal 2026-11-02, la
# ricreazione scatta solo in orario di lavoro e solo con il contesto >= 50%
# (misurato dai log, mai con tasti): la maggior parte dei cicli cadeva quando
# il team dorme, e ogni ricreazione e' un kick-off LLM senza lavoro da fare.
#
# Il tetto vive QUI oltre che nel Dottore per ridondanza: il Dottore è un
# agente e può essere fermo, bloccato o non spawnato — è successo proprio
# quella notte. Il Dottore fa il refresh RICCO (capture + intervista +
# retrospettiva + resume), questo è la rete che garantisce il tetto a
# qualsiasi costo. UN SOLO refresh per tick, il più vecchio.
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
_AGENT_WATCHDOG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_DAEMON_LIB="${JHT_DAEMON_LIB:-$_AGENT_WATCHDOG_DIR/daemon-lib.sh}"
if [ -f "$_DAEMON_LIB" ]; then
  # Keep the watchdog evidence under the same bounded-log policy as the other
  # launcher daemons. Sliced unit harnesses inject paths and lack this sibling.
  source "$_DAEMON_LIB"
else
  jht_daemon_log() {
    local dir="${JHT_LOGS_DIR:-${JHT_HOME:-/jht_home}/logs}"
    mkdir -p "$dir" 2>/dev/null || true
    printf '%s\n' "$dir/$1"
  }
fi
CONFIG="$JHT_HOME/jht.config.json"
JHT_BIN="/app/cli/bin/jht.js"
INTERVAL_SEC="${JHT_AGENT_WATCHDOG_INTERVAL:-30}"
LOG="${JHT_AGENT_WATCHDOG_LOG:-$(jht_daemon_log agent-watchdog.log)}"
AGENTS=(assistente capitano mentor sentinella)
# Soglia (ore) oltre cui la sessione SENTINELLA viene ricreata per ripulire
# il context window accumulato. Refresh deterministico, near-stateless.
SENTINELLA_MAX_CTX_AGE_H="${JHT_SENTINELLA_MAX_CTX_AGE_H:-24}"
# TTL: età massima (ore) di QUALSIASI sessione agente. Vedi il blocco in testa.
AGENT_MAX_SESSION_AGE_H="${JHT_AGENT_MAX_SESSION_AGE_H:-12}"
# Tetto DURO sull'eta' (ore): a questa eta' la sessione si ricrea comunque, di giorno o di notte, con qualunque contesto.
# Fra AGENT_MAX_SESSION_AGE_H e il tetto la ricreazione e' condizionata (vedi maybe_ttl_refresh).
AGENT_HARD_CAP_H="${JHT_AGENT_HARD_CAP_H:-24}"
[ "$AGENT_HARD_CAP_H" -ge "$AGENT_MAX_SESSION_AGE_H" ] 2>/dev/null || AGENT_HARD_CAP_H="$AGENT_MAX_SESSION_AGE_H"
# Sotto il tetto si ricrea solo se il contesto usato e' almeno questa percentuale.
AGENT_TTL_CONTEXT_PCT="${JHT_AGENT_TTL_CONTEXT_PCT:-50}"
# Quanto ci si fida di una misura del contesto (secondi) prima di rifarla: il watchdog gira ogni 30 s.
AGENT_TTL_CONTEXT_RECHECK_SEC="${JHT_AGENT_TTL_CONTEXT_RECHECK_SEC:-600}"
SESSION_CONTEXT_TOOL="${JHT_SESSION_CONTEXT_TOOL:-/app/shared/skills/session_context.py}"
TTL_STATE_DIR="${JHT_AGENT_TTL_STATE_DIR:-$JHT_HOME/state}"
WORKING_HOURS_ROOT="${JHT_APP_ROOT:-$_AGENT_WATCHDOG_DIR/..}"
# Roster atteso (chi dovrebbe essere vivo): stato condiviso scritto da
# start-agent.sh a ogni spawn riuscito, letto qui per sorvegliare i worker
# numerati. Vedi shared/skills/team_roster.py per le tre guardie che
# impediscono al watchdog di combattere col coordinatore.
# Path overridabili solo per poterli esercitare nei test con dei finti: in
# container restano quelli dell'immagine.
ROSTER_TOOL="${JHT_ROSTER_TOOL:-/app/shared/skills/team_roster.py}"
FIRST_RUN_TOOL="${JHT_FIRST_RUN_TOOL:-/app/shared/skills/first_run.py}"
START_AGENT="${JHT_START_AGENT:-/app/.launcher/start-agent.sh}"
PROCESS_HEALTH_TOOL="${JHT_PROCESS_HEALTH_TOOL:-/app/shared/skills/process_health.py}"
# Recuperi degli agenti: il watchdog non deve limitarsi a far sparire il
# problema. Questo registro è una misura append-only, non il log rotante del
# watchdog: deve poter rispondere a "quante volte è stato recuperato oggi
# SCOUT-1?" anche dopo che i messaggi al Capitano sono scorsi via.
# Le tre dipendenze si iniettano nei test: il comportamento si prova con tmux,
# spawner e sender finti, senza una macchina o una TUI vera.
RECOVERY_LOG="${JHT_AGENT_RECOVERY_LOG:-$(jht_daemon_log agent-recoveries.tsv)}"
NODE_BIN="${JHT_NODE_BIN:-/usr/local/bin/node}"
TMUX_SENDER="${JHT_TMUX_SENDER:-jht-tmux-send}"
# Canale verso l'UTENTE: CLI Python deterministico (scrive in
# pending_user_messages, poi tenta Telegram e ricade sulla dashboard). Zero
# token: il gradino 2 dell'escalation non deve costare un turno LLM, perche'
# il caso peggiore e' proprio quello in cui gli agenti non partono.
# Iniettabile come le altre tre dipendenze: i test non chiamano il binario vero.
NOTIFY_USER_BIN="${JHT_NOTIFY_USER_BIN:-jht-notify-user}"
# La posta degli agenti (JHT-T09): ad ogni giro si fanno scadere i messaggi non presi, si
# avvisa chi di dovere e si risveglia di nuovo chi ha posta in coda. `jht-mail tick` stampa
# righe «SESSIONE<TAB>TESTO» e basta; si digitano col sender di sempre. Senza destinatari
# in `mail_receivers` non stampa niente. Iniettabile come gli altri.
MAIL_BIN="${JHT_MAIL_BIN:-jht-mail}"
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
SPAWN_FAILURE_LOG="${JHT_AGENT_SPAWN_FAILURE_LOG:-$(jht_daemon_log agent-spawn-failures.tsv)}"
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

_rotate_watchdog_log() {
  [ -n "${JHT_AGENT_WATCHDOG_LOG:-}" ] \
    || LOG="$(jht_daemon_log agent-watchdog.log)"
}

_rotate_recovery_log() {
  [ -n "${JHT_AGENT_RECOVERY_LOG:-}" ] \
    || RECOVERY_LOG="$(jht_daemon_log agent-recoveries.tsv)"
}

_rotate_spawn_failure_log() {
  [ -n "${JHT_AGENT_SPAWN_FAILURE_LOG:-}" ] \
    || SPAWN_FAILURE_LOG="$(jht_daemon_log agent-spawn-failures.tsv)"
}

log() {
  local ts
  # The daemon lives as long as the container, so startup-only rotation is
  # not a bound. Every real write rechecks the shared 5 MB threshold.
  _rotate_watchdog_log
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
# CAPITANO/MENTOR dopo un reboot, senza una riga di log (un'istanza morta ~44h il
# 2026-07-18, un'altra armata dopo lo switch a Codex).
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
# harness pi (campo `harness`, o JHT_AGENT_HARNESS_<RUOLO>=pi) con provider openai/codex: conta SOLO il login di pi, mai quello di codex
pi = d.get('harness') == 'pi' or 'pi' in [v for k, v in os.environ.items() if k.startswith('JHT_AGENT_HARNESS_')]
# glm/kimi/moonshot run only on pi and only with an API key: the key is in the config (a file or an env name), pi has no login for them
def api_key_there():
  cfg = (d.get('providers') or {}).get(prov) or {}
  ref = cfg.get('api_key_ref')
  if isinstance(ref, dict) and ref.get('source') == 'file':
    return os.path.exists(str(ref.get('path') or ''))
  return bool(ref) or bool(cfg.get('api_key'))
if pi and prov in ('glm', 'kimi', 'moonshot'):
  has_creds = api_key_there()
else:
  has_creds = bool(prov) and os.path.exists(f'{jht_home}/.pi/agent/auth.json' if pi and prov in ('openai', 'codex') else markers.get(prov, ''))
  # Pi keeps one entry per service in its file: the sign-in of THIS provider is there only with its own entry (a file with only
  # Anthropic's, a Claude subscription billed per token from pi, is not). Only the NAMES are looked at, never a value.
  # The names are the ones of shared/runtime/pi-login-keys.list (tests/test_agent_watchdog_pi.py keeps them together).
  if has_creds and pi and prov in ('openai', 'codex'):
    try:
      with open(f'{jht_home}/.pi/agent/auth.json', encoding='utf-8') as handle:
        saved = json.load(handle)
      has_creds = isinstance(saved, dict) and any(isinstance(saved.get(n), dict) and bool(saved.get(n)) for n in ('openai-codex', 'openai'))
    except Exception:
      has_creds = False
sys.exit(0 if (prov and has_creds) else 1)
PYEOF
}

is_session_alive() {
  # Bug 2026-05-18 (post-mortem capitano-zombie-night): tmux has-session ritornava 0 anche quando il process
  # LLM dentro al pane era morto (kimi crashato, pane ridotto a bash idle): 11h di silent watchdog mentre il
  # Capitano era zombie e l'utente attendeva risposta.
  #
  # Fix: verifica anche pane_current_command. Se non è un LLM CLI noto (kimi/claude/codex/pi/node/python), la
  # sessione è zombie e va riavviata. 'node'/'python*' coprono le CLI su un runtime di base (pi è sempre 'node').
  #
  # Target ANCORATI (2026-09-13). tmux risolve un nome esatto, poi per
  # PREFISSO: con SENTINELLA morta e SENTINELLA-WORKER viva, `has-session -t
  # SENTINELLA` rispondeva "viva", il respawn non partiva mai, e il kill del
  # ramo ZOMBIE poteva atterrare sulla sorella. Due forme, perche' `=` vale
  # solo sulla parte SESSIONE del target:
  #   - `=NOME`  per i comandi a target sessione (has-session, kill-session);
  #   - `=NOME:` per quelli a target finestra/pane (list-panes, display-message,
  #     capture-pane, send-keys). Misurato su tmux 3.6: `list-panes -t =NOME`
  #     SENZA i due punti, con NOME assente, risponde con i pane della sorella.
  local session="$1"
  tmux has-session -t "=$session" 2>/dev/null || return 1
  local cmd
  cmd=$(tmux list-panes -t "=$session:" -F '#{pane_current_command}' 2>/dev/null | head -1)
  case "$cmd" in
    [Kk]imi|claude|Claude|codex|Codex|pi|node|python|python3) return 0 ;;
    *)
      # Zombie: kill+rispawn al prossimo ensure_agent. Log a basso volume
      # qui per audit, il messaggio "session zombie — killing" è loud
      # apposta perché è un evento raro che vogliamo notare.
      log "agent $session: ZOMBIE detected (pane_current_command='$cmd') — killing session"
      tmux kill-session -t "=$session" 2>/dev/null || true
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
  local files=()
  [ -f "$RECOVERY_LOG.old" ] && files+=("$RECOVERY_LOG.old")
  [ -f "$RECOVERY_LOG" ] && files+=("$RECOVERY_LOG")
  [ "${#files[@]}" -gt 0 ] || { echo 0; return 0; }
  awk -F '\t' -v day="$day" -v session="$session" \
    '$1 ~ ("^" day "T") && $2 == session { count += 1 } END { print count + 0 }' \
    "${files[@]}" 2>/dev/null
}

record_recovery() {
  # Stampa il conteggio giornaliero solo DOPO aver scritto l'evento. Se la
  # scrittura fallisce non mandiamo un numero inventato al Capitano: log loud,
  # nessuna misura dichiarata completa.
  local session="$1" observation="$2" now day count
  _rotate_recovery_log
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
  _rotate_spawn_failure_log
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

# Il Mentor non ha niente da leggere finche' il primo giro non e' chiuso (first_run.py mentor-due: 0 = e' ora, 1 = non
# ancora): si accende da solo, entro un tick, a fase `steady`. Altra risposta (script assente, crash) = «e' ora».
mentor_due() {
  local rc=0
  python3 /app/shared/skills/first_run.py mentor-due >/dev/null 2>&1 || rc=$?
  [ "$rc" -ne 1 ]
}

# Capitano e Sentinella (guarda il budget PER lui) aspettano la fine dell'onboarding (captain_gate.py: 1 = non ancora).
captain_due() { local rc=0; python3 /app/shared/skills/captain_gate.py >/dev/null 2>&1 || rc=$?; [ "$rc" -ne 1 ]; }

ensure_agent() {
  local role="$1"
  local session mark rc detail
  session="$(echo "$role" | tr '[:lower:]' '[:upper:]')"
  # Un containment e' sticky e vale anche per i core: il normale `record` di start-agent non puo' revocarlo, soltanto
  # `release` puo' farlo. Deliberatamente PRIMA di qualsiasi misura: una sessione tenuta giu' non e' un fallimento di
  # spawn e non deve alimentare nessuna serie.
  if agent_is_contained "$session"; then
    return 0
  fi
  if is_session_alive "$session"; then
    # La serie deve essere CONSECUTIVA: se la sessione e' tornata su per una strada che non e' questa (Dottore,
    # Capitano, riavvio), il conteggio va chiuso qui, altrimenti fallimenti di incidenti diversi si sommerebbero.
    clear_spawn_failures "$session"
    return 0
  fi
  # Non e' un guasto ne' un fallimento di spawn: il Mentor e il Capitano aspettano il loro momento.
  if { [ "$session" = "MENTOR" ] && ! mentor_due; } || { { [ "$session" = "CAPITANO" ] || [ "$session" = "SENTINELLA" ]; } && ! captain_due; }; then
    return 0
  fi
  # Backoff, non cap: dopo il gradino 1 si tenta piu' RADI, mai zero volte.
  if spawn_backoff_active "$session"; then
    return 0
  fi
  log "agent $role: session $session is inactive — relaunching via jht team start"
  mark="$(spawn_log_offset)"
  if JHT_SPAWN_SRC=agent-watchdog "$NODE_BIN" "$JHT_BIN" team start "$role" >>"$LOG" 2>&1; then
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
  created=$(tmux display-message -p -t "=$session:" '#{session_created}' 2>/dev/null) || return 1
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
  agent_is_paused SENTINELLA && return 0    # in pausa per volere dell'utente: il contesto non si tocca
  # Niente refresh fuori orario lavorativo: ricreare ora sprecherebbe un
  # kick-off LLM di notte (allineato alla regola "no LLM fuori finestra").
  python3 -c "import sys; sys.path.insert(0,'/app'); from shared.skills.working_hours import is_within_working_hours as f; sys.exit(0 if f() else 1)" 2>/dev/null || return 0
  local age
  age=$(session_age_h SENTINELLA) || return 0
  if [ "$age" -ge "$SENTINELLA_MAX_CTX_AGE_H" ]; then
    log "sentinella: context age ${age}h ≥ ${SENTINELLA_MAX_CTX_AGE_H}h — refreshing (kill+recreate) to clear the context"
    if tmux kill-session -t =SENTINELLA 2>/dev/null; then
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
    SCOUT-[0-9]*|ANALISTA-[0-9]*|SCORER-[0-9]*|SCRITTORE-[0-9]*|CLOSER-[0-9]*|CRITICO-S[0-9]*) return 0 ;;
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
  JHT_HOME="$JHT_HOME" JHT_TMUX_SENDER="$TMUX_SENDER" python3 \
    "${JHT_WATCHDOG_DELIVERY:-$_AGENT_WATCHDOG_DIR/../shared/skills/watchdog_delivery.py}" \
    kickoff "$1" "$2" >>"$LOG" 2>&1 &
}

mark_roster_respawn() {
  # Esito del respawn nel ROSTER, accanto al registro dei fallimenti. Serve a
  # team_roster.py per distinguere "ricreato e poi tolto di nuovo" (si ritira,
  # sonda a colpo singolo) da "il respawn e' fallito" (resta candidato, e la
  # serie arriva alle soglie di escalation qui sopra). Senza, il roster ritirava
  # il worker al primo avvio fallito e per i worker l'escalation non scattava
  # mai. Best-effort: un roster non scrivibile non deve fermare il watchdog.
  local session="$1" outcome="$2"
  [ -f "$ROSTER_TOOL" ] || return 0
  JHT_HOME="$JHT_HOME" python3 "$ROSTER_TOOL" "mark-respawn-$outcome" "$session" >/dev/null 2>&1 || true
}

respawn_worker() {
  # start-agent.sh con lo STESSO numero d'istanza (il dado di
  # roll_worker_number è per gli spawn NUOVI, non per le ricreazioni).
  local role="$1" inst="$2" session="$3" recovery_kind="${4:-unexpected}" mark rc detail
  mark="$(spawn_log_offset)"
  if JHT_HOME="$JHT_HOME" JHT_SPAWN_SRC=agent-watchdog bash "$START_AGENT" "$role" "$inst" >>"$LOG" 2>&1; then
    # PRIMA della sonda, come in ensure_agent: la riga ZOMBIE di
    # is_session_alive non e' output dello spawner e non va attribuita a lui.
    detail="$(spawn_detail_since "$mark")"
    if ! is_session_alive "$session"; then
      log "worker $session: start reported OK but session is still inactive — recovery not recorded"
      mark_roster_respawn "$session" failed
      observe_spawn_failure "$session" \
        "start reported rc=0 but the session was still inactive${detail:+ · $detail}" || true
      return 1
    fi
    log "worker $session: start OK and session verified alive"
    mark_roster_respawn "$session" ok
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
    mark_roster_respawn "$session" failed
    observe_spawn_failure "$session" "rc=$rc${detail:+ · $detail}" || true
    return 1
  fi
}

ttl_in_working_hours() {
  # Dentro l'orario di lavoro? Una risposta che non e' un «out» esplicito (config assente, modulo non importabile) vale
  # «dentro»: il TTL tra 12 h e il tetto non deve sparire per un guasto della sonda, resta il tetto duro.
  local r
  r="$(python3 -c "import sys; sys.path.insert(0,'$WORKING_HOURS_ROOT'); from shared.skills.working_hours import is_within_working_hours as f; print('in' if f() else 'out')" 2>/dev/null)" || r=""
  [ "$r" != "out" ]
}

ttl_context_recently_checked() {
  local session="$1" now="$2" last
  last="$(cat "$TTL_STATE_DIR/ttl-ctx-$session" 2>/dev/null)" || return 1
  case "$last" in ''|*[!0-9]*) return 1 ;; esac
  [ $((now - last)) -lt "$AGENT_TTL_CONTEXT_RECHECK_SEC" ]
}

ttl_context_stamp() {
  mkdir -p "$TTL_STATE_DIR" 2>/dev/null || return 0
  printf '%s\n' "$2" >"$TTL_STATE_DIR/ttl-ctx-$1" 2>/dev/null || true
}

ttl_context_pct() {
  # Percentuale di contesto USATA, letta dai log del CLI (session_context.py SENZA --provider: nessun tasto nel pane).
  # Vuoto e rc 1 se non e' misurabile.
  local out pct
  [ -f "$SESSION_CONTEXT_TOOL" ] || return 1
  out="$(JHT_HOME="$JHT_HOME" python3 "$SESSION_CONTEXT_TOOL" "$1" 2>/dev/null)" || true
  pct="$(printf '%s' "$out" | python3 -c 'import sys, json
try:
    v = json.loads(sys.stdin.read()).get("pct")
except Exception:
    v = None
print("" if v is None or isinstance(v, bool) else v)' 2>/dev/null)" || return 1
  case "$pct" in ''|*[!0-9.]*) return 1 ;; esac
  printf '%s' "$pct"
}

ttl_reason() {
  # Perche' questa sessione, gia' oltre AGENT_MAX_SESSION_AGE_H, va ricreata ADESSO (stampa il motivo, rc 0),
  # oppure rc 1 (aspetta).
  local session="$1" age="$2" now="$3" pct
  if [ "$age" -ge "$AGENT_HARD_CAP_H" ]; then
    echo "hard cap ${AGENT_HARD_CAP_H}h"
    return 0
  fi
  ttl_in_working_hours || return 1
  ttl_context_recently_checked "$session" "$now" && return 1
  if ! pct="$(ttl_context_pct "$session")"; then
    ttl_context_stamp "$session" "$now"      # non misurato: vale solo il tetto
    return 1
  fi
  if awk -v p="$pct" -v t="$AGENT_TTL_CONTEXT_PCT" 'BEGIN { exit !(p + 0 >= t + 0) }'; then
    echo "context ${pct}% used"
    return 0
  fi
  ttl_context_stamp "$session" "$now"
  return 1
}

maybe_ttl_refresh() {
  # Ricreazione a scadenza di ogni sessione agente. Un refresh per tick, il piu' vecchio per primo.
  #
  #   eta' >= AGENT_HARD_CAP_H (24 h)  → SEMPRE, a qualunque ora e con qualunque contesto: e' il tetto duro.
  #   12 h <= eta' < tetto             → solo IN ORARIO DI LAVORO e solo se il contesto usato e' >= 50% (misurato dai
  #                                      log, senza tasti). Contesto non misurato → aspetta il tetto.
  #
  # PERCHE' l'orario: fino al 02/11 il TTL era di sola eta' e ignorava l'orario di proposito (incidente del 28-29/07:
  # sessioni di 38,5 · 29,5 · 27 h mentre tutte le euristiche dicevano «sano» e il team era fermo da undici ore).
  # Ma la maggior parte dei cicli cadeva quando la squadra dorme o ai bordi dell'orario, e ogni ricreazione e' un
  # kick-off LLM senza niente da fare. PERCHE' il tetto di 24 h basta ancora: le sessioni piu' vecchie dell'incidente
  # avevano 38,5 · 29,5 · 27 h e il tetto e' duro (non guarda orario, contesto, PARKED, salute), quindi nessuna puo'
  # arrivare a quelle eta'; il resto di quell'incidente (input pendente, retry) lo copre lo sblocco del Dottore.
  local oldest="" oldest_age=-1 oldest_why="" line s age why now
  now=$(date -u +%s)
  while IFS= read -r line; do
    s="${line%%|*}"
    [ -z "$s" ] && continue
    is_agent_session "$s" || continue
    agent_is_contained "$s" && continue
    agent_is_paused "$s" && continue
    age=$(session_age_h "$s") || continue
    [ -z "$age" ] && continue
    [ "$age" -ge "$AGENT_MAX_SESSION_AGE_H" ] || continue
    [ "$age" -gt "$oldest_age" ] || continue
    why="$(ttl_reason "$s" "$age" "$now")" || continue
    oldest="$s"; oldest_age="$age"; oldest_why="$why"
  done <<EOF
$(tmux list-sessions -F '#{session_name}' 2>/dev/null)
EOF
  [ -z "$oldest" ] && return 0

  local role inst
  read -r role inst <<EOF
$(session_role "$oldest")
EOF
  log "ttl: $oldest is ${oldest_age}h old ≥ ${AGENT_MAX_SESSION_AGE_H}h — ${oldest_why} — kill+recreate"
  if ! tmux kill-session -t "=$oldest" 2>/dev/null; then
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

# JHT-T181: l'utente ha messo in pausa QUESTO agente (agent_pause.py). La sessione resta accesa col suo contesto:
# ricrearla (refresh a 12/24 h) lo cancellerebbe, e un messaggio automatico lo rimetterebbe al lavoro. UN predicato,
# come per lo standby; la risposta è una PAROLA (paused|off) e, se non arriva, vale il marcatore: un guasto
# di python non deve cancellare il contesto di un agente fermo apposta.
AGENT_PAUSE_PY="${JHT_AGENT_PAUSE_PY:-/app/shared/skills/agent_pause.py}"
[ -f "$AGENT_PAUSE_PY" ] || AGENT_PAUSE_PY="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)/shared/skills/agent_pause.py"
agent_is_paused() {
  [ -e "$JHT_HOME/.agent-pauses/$1.json" ] || return 1
  local state
  state="$(JHT_HOME="$JHT_HOME" python3 "$AGENT_PAUSE_PY" active "$1" 2>/dev/null)"
  case "$state" in
    paused) return 0 ;;
    off)    return 1 ;;
    *)      return 0 ;;   # fallback: il marcatore c'è → in pausa
  esac
}

maybe_mail_tick() {
  JHT_HOME="$JHT_HOME" JHT_TMUX_SENDER="$TMUX_SENDER" "$MAIL_BIN" tick --deliver
}

# --- rete della domanda sul piano
# Il piano si chiede con UNA card (first_run.py ask-plan). Se il profilo e' importato, il piano manca e nessuna
# domanda sul piano e' aperta da qualche minuto, la posta il sistema: una domanda scritta solo nel pane del
# Capitano non arriva all'utente (TEST 13). La decisione sta in first_run.py (mai prima dell'import del
# profilo); qui si esegue e si scrive una riga di log se ha fatto qualcosa. Un guasto non ferma il giro.
# Vale anche al contrario: il piano scritto da un altro canale (chat dell'Assistente, comando, app) chiude la card
# ancora aperta ("closed"), cosi' in Agents non resta «1 domanda aperta» per una cosa gia' detta (TEST 15).
maybe_plan_question() {
  [ -f "$FIRST_RUN_TOOL" ] || return 0
  local out
  out="$(JHT_HOME="$JHT_HOME" python3 "$FIRST_RUN_TOOL" plan-question-check 2>/dev/null)" || return 0
  case "$out" in
    *'"action": "asked"'*|*'"action": "declared"'*|*'"action": "closed"'*|*'"action": "start"'*|*'"pressed": '[1-9]*)
      plan_question_failures=0
      log "plan question: $(printf '%s' "$out" | tr -d '\n' | tr -s ' ' | cut -c1-200)" ;;
    *'"action": "stopped"'*)
      # tre card senza che l'utente nomini un piano: la rete tace da qui in poi, e lo dice UNA volta
      if [ "$plan_question_stopped_logged" -eq 0 ]; then
        plan_question_stopped_logged=1
        log "plan question STOPPED: $(printf '%s' "$out" | tr -d '\n' | tr -s ' ' | cut -c1-240) — the user will not be asked again by the system"
      fi ;;
    *'"action": "failed"'*)
      # un guasto vero (il DB, lo strumento): visibile, ma una riga ogni ~10 minuti e non una per tick
      if [ $((plan_question_failures % 20)) -eq 0 ]; then
        log "plan question NOT posted: $(printf '%s' "$out" | tr -d '\n' | tr -s ' ' | cut -c1-240)"
      fi
      plan_question_failures=$((plan_question_failures + 1)) ;;
  esac
  return 0
}
plan_question_failures=0
plan_question_stopped_logged=0
# --- fine rete della domanda sul piano

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
  JHT_HOME="$JHT_HOME" python3 \
    "${JHT_WATCHDOG_DELIVERY:-$_AGENT_WATCHDOG_DIR/../shared/skills/watchdog_delivery.py}" \
    bridge "$BRIDGE_STATE_DIR/bridge-escalate-$(escalate_key "$1").ts" \
    "$BRIDGE_ESCALATE_COOLDOWN_SEC" "$2" "$BRIDGE_FLAP_CAP" "$BRIDGE_FLAP_WINDOW_SEC" "$TMUX_SENDER"
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
      JHT_HOME="$JHT_HOME" JHT_SPAWN_SRC=agent-watchdog bash "$START_AGENT" bridge >>"$LOG" 2>&1 \
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
  if [ ! -f /run/jht-telegram/cutover ] && [ ! -f /run/jht-telegram/cutover-required ] \
      && tg_bots_configured && [ -n "${PROC_TG_MISSING:-}" ]; then
    for _tg_role in $PROC_TG_MISSING; do
      if bridge_flap_ok "tg-bridge-$_tg_role"; then
        log "bridge-watchdog: tg-bridge[$_tg_role] missing (alive=${PROC_TG_ALIVE:-0}, expected=${PROC_TG_EXPECTED:-0}) — respawning that role only"
        JHT_HOME="$JHT_HOME" JHT_SPAWN_SRC=agent-watchdog bash "$START_AGENT" tg-bridge "$_tg_role" >>"$LOG" 2>&1 \
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
  #
  # `capture-pane` vuole un target PANE, e il prefisso `=` esiste solo per i
  # target SESSIONE/FINESTRA: `capture-pane -t "=NOME"` esce SEMPRE con
  # "can't find pane". Con lo stderr scartato e il `|| return 1` qui sotto, il
  # guasto era invisibile e il chiamante concludeva "cattura fallita, NON
  # uccido" a ogni tick — cioe' il ri-contenimento non e' mai avvenuto.
  # Osservato in produzione: 24.340 righe "capture failed — NOT killing" e una
  # sessione viva per 15 giorni contro una decisione esplicita di keep-down.
  #
  # L'esattezza voluta da chi ha scritto `=` resta, spostata dove e' valida:
  # `list-panes` ci da' il `pane_id`, che e' univoco per l'intero server tmux e
  # non ammette risoluzione per prefisso. Il target di list-panes pero' e' una
  # FINESTRA, non una sessione: `=NOME` senza i due punti, con NOME assente,
  # restituisce i pane di una sorella (misurato su tmux 3.6) e la cattura
  # finirebbe sulla sessione sbagliata. `=NOME:` fallisce, come deve.
  local pane_id
  pane_id="$(tmux list-panes -t "=$session:" -F '#{pane_id}' 2>/dev/null | head -1)"
  if [ -z "$pane_id" ]; then
    rm -f "$evidence" 2>/dev/null || true
    return 1
  fi
  tmux capture-pane -t "$pane_id" -p -S - > "$evidence" 2>/dev/null || {
    rm -f "$evidence" 2>/dev/null || true
    return 1
  }
  # Una cattura vuota non e' evidenza: meglio ritentare che archiviare un file
  # da zero byte e dichiarare la scena salvata.
  if [ ! -s "$evidence" ]; then
    rm -f "$evidence" 2>/dev/null || true
    return 1
  fi
  chmod 600 "$evidence" 2>/dev/null || true
  printf '%s' "$evidence"
}

maybe_enforce_containments() {
  # Uno spawn ordinario non revoca `contained`: se qualcuno prova a
  # riaccendere la sessione, salviamo di nuovo il pane, la rimettiamo giu' e
  # avvisiamo chi aveva deciso (oltre al Capitano). Nessun override silenzioso.
  [ -f "$ROSTER_TOOL" ] || return 0
  local plan session actor old_evidence evidence message expired held_for mode
  # Un hold dovuto a una MODALITA' (contain --while-mode) finisce con la
  # modalita': si toglie prima di applicare gli altri. Senza, una SENTINELLA
  # fermata per `saving` resta giu' per sempre (leone, 21/08-28/09): la
  # condizione «finche' non cambia la modalita'» era solo prosa.
  expired=$(JHT_HOME="$JHT_HOME" python3 "$ROSTER_TOOL" release-expired --tsv 2>/dev/null) || expired=""
  while IFS=$'\t' read -r session held_for mode actor; do
    [ -z "$session" ] && continue
    log "containment: $session released — it was held for mode $held_for, the team is now in $mode"
    message="[CONTAINMENT] $session was held down for mode $held_for; the team is now in $mode, so the hold has ended and normal supervision resumes."
    JHT_HOME="$JHT_HOME" python3 "${JHT_WATCHDOG_DELIVERY:-$_AGENT_WATCHDOG_DIR/../shared/skills/watchdog_delivery.py}" \
      send "$TMUX_SENDER" "${actor:-CAPITANO}" "$message"
    if [ "${actor:-CAPITANO}" != "CAPITANO" ]; then
      JHT_HOME="$JHT_HOME" python3 "${JHT_WATCHDOG_DELIVERY:-$_AGENT_WATCHDOG_DIR/../shared/skills/watchdog_delivery.py}" \
        send "$TMUX_SENDER" CAPITANO "$message"
    fi
  done <<EOF
$expired
EOF
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
      JHT_HOME="$JHT_HOME" python3 "${JHT_WATCHDOG_DELIVERY:-$_AGENT_WATCHDOG_DIR/../shared/skills/watchdog_delivery.py}" \
        send "$TMUX_SENDER" "${actor:-CAPITANO}" "$message"
      if [ "${actor:-CAPITANO}" != "CAPITANO" ]; then
        JHT_HOME="$JHT_HOME" python3 "${JHT_WATCHDOG_DELIVERY:-$_AGENT_WATCHDOG_DIR/../shared/skills/watchdog_delivery.py}" \
          send "$TMUX_SENDER" CAPITANO "$message"
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
    JHT_HOME="$JHT_HOME" JHT_TMUX_SENDER="$TMUX_SENDER" python3 "$_AGENT_WATCHDOG_DIR/../shared/skills/codex_dialog.py"
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
    # Posta degli agenti: scadenze, avvisi e solleciti (non fa niente senza `mail_receivers`).
    maybe_mail_tick
    # Il piano dell'abbonamento: se nessuno l'ha chiesto con la card, la posta il sistema.
    maybe_plan_question
    # Bridge/daemon detached (sentinel/pacing/heartbeat-bridge/window-ratio/
    # codex-auth-healer + tg-bridge): respawn se morti, con anti-flap. Sono
    # fuori dal respawn-on-crash di pid1 (setsid), questo è il loro recovery.
    maybe_respawn_bridges
  else
    # config non pronta. Al primo boot è NORMALE (il wizard la scrive post-pairing):
    # restiamo silenziosi per i primi CONFIG_NOT_READY_GRACE_TICKS. Ma se PERSISTE
    # oltre la grace è un guasto vero (active_provider fuori-mappa, credenziali
    # mancanti) e NON deve più essere invisibile: quella silenziosità ha tenuto
    # un'istanza morta ~44h il 2026-07-18 senza una riga di log. Escaliamo a log loud.
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

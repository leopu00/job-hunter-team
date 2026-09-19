#!/usr/bin/env bash
# live-screen.sh — lo «schermo» del container: un display X virtuale su cui il
# browser del CLOSER gira in modalità headed, più lo stream che lo porta
# all'app desktop.
#
#   Xvfb :99  ──►  x11vnc (solo loopback del container, sola visione)
#                    ──►  websockify :6080  ──►  porta pubblicata su 127.0.0.1
#
# Perché esiste. Le candidature non passano da API: il CLOSER compila i form
# con un browser vero (shared/skills/apply_flow.py). L'utente deve poter VEDERE
# cosa fa quel browser, e un browser headless non ha niente da far vedere.
# L'immagine esporta DISPLAY=:99 (Dockerfile), quindi `apply_flow.py --headful`
# si apre proprio su questo schermo, da qualunque shell parta: pane tmux di un
# agente o `docker exec`.
#
# Avvio: lo supervisiona pid1 (cli/src/commands/pid1.js) come processo in
# primo piano. Se uno dei tre figli muore, lo script chiude gli altri ed esce
# non-zero: il respawn lo fa pid1, e a ripartire è la terna intera, perché
# x11vnc senza Xvfb o websockify senza x11vnc sono uno stream che non mostra
# niente pur risultando «su».
#
# Sicurezza. Lo schermo mostra CV e form di candidatura, cioè dati personali:
#   - x11vnc ascolta SOLO sul loopback del container e rifiuta ogni input
#     (-viewonly): chi guarda non può cliccare al posto del CLOSER;
#   - websockify ascolta su JHT_LIVE_SCREEN_BIND. Il default 0.0.0.0 è
#     l'interfaccia del container sulla rete bridge di Docker, e diventa
#     raggiungibile dall'host SOLO tramite la porta pubblicata, che il compose
#     lega a 127.0.0.1. Con `network_mode: host` (compose Podman) l'interfaccia
#     del container È quella dell'host: lì il compose imposta 127.0.0.1;
#   - un WebSocket verso 127.0.0.1 non è soggetto a CORS, quindi QUALUNQUE
#     pagina web aperta sull'host potrebbe collegarsi. Per questo ogni avvio
#     genera una password VNC nuova, scritta in $JHT_HOME/live-screen/ con
#     permessi 0600: la legge solo l'app desktop dello stesso utente.
#
# Variabili (tutte opzionali):
#   JHT_LIVE_SCREEN_DISPLAY   display X          (default :99)
#   JHT_LIVE_SCREEN_GEOMETRY  risoluzione Xvfb   (default 1440x1000x24)
#   JHT_LIVE_SCREEN_PORT      porta websockify   (default 6080)
#   JHT_LIVE_SCREEN_BIND      indirizzo di bind  (default 0.0.0.0)

set -u

JHT_HOME="${JHT_HOME:-/jht_home}"
DISPLAY_NAME="${JHT_LIVE_SCREEN_DISPLAY:-:99}"
GEOMETRY="${JHT_LIVE_SCREEN_GEOMETRY:-1440x1000x24}"
WS_PORT="${JHT_LIVE_SCREEN_PORT:-6080}"
WS_BIND="${JHT_LIVE_SCREEN_BIND:-0.0.0.0}"
VNC_PORT=5900
STATE_DIR="$JHT_HOME/live-screen"
PASSWORD_FILE="$STATE_DIR/viewer-password"
RUN_DIR="${TMPDIR:-/tmp}/jht-live-screen"

LOGS_DIR="$JHT_HOME/logs"
mkdir -p "$LOGS_DIR"

# daemon-lib.sh (inerte: solo definizioni) per jht_daemon_log — path del diario
# + rotazione a 5 MB, la stessa soglia di pid1.
JHT_LAUNCHER_DIR="${JHT_LAUNCHER_DIR:-$(cd "$(dirname "$0")" 2>/dev/null && pwd)}"
if [ -f "$JHT_LAUNCHER_DIR/daemon-lib.sh" ]; then
  # shellcheck source=/dev/null
  . "$JHT_LAUNCHER_DIR/daemon-lib.sh"
fi
# Ripiego innocuo: costa la sola rotazione, il path è lo stesso.
if ! command -v jht_daemon_log >/dev/null 2>&1; then
  jht_daemon_log() { printf '%s\n' "$LOGS_DIR/$1"; }
fi

# Diario: UN path per scrittore. logs/live-screen.log è di pid1, che cattura la
# stdout di questo script e dei suoi tre figli (spawnLabeled('live-screen')) e
# lo ruota: qui si scrive su un file proprio, e il `tee` lascia a pid1 la sua
# copia. Lo script non ha un loop: il diario si ruota a ogni avvio, cioè a ogni
# respawn, e riceve poche righe per avvio.
LOG_FILE="$(jht_daemon_log live-screen-loop.log)"

log() {
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[$ts] [live-screen] $*" | tee -a "$LOG_FILE"
}

case "$DISPLAY_NAME" in
  :[0-9]|:[0-9][0-9]|:[0-9][0-9][0-9]) ;;
  *) log "ERROR: JHT_LIVE_SCREEN_DISPLAY='$DISPLAY_NAME' is not a local display (:N)"; exit 2 ;;
esac
case "$WS_PORT" in
  ''|*[!0-9]*) log "ERROR: JHT_LIVE_SCREEN_PORT='$WS_PORT' is not a port number"; exit 2 ;;
esac
if [ "$WS_PORT" -lt 1024 ] || [ "$WS_PORT" -gt 65535 ]; then
  log "ERROR: JHT_LIVE_SCREEN_PORT=$WS_PORT is outside 1024-65535"; exit 2
fi

for bin in Xvfb x11vnc websockify; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    log "ERROR: '$bin' not found — the image was built without the live screen"
    exit 3
  fi
done

DISPLAY_NUM="${DISPLAY_NAME#:}"
# Seam per i test: Xvfb scrive socket e lock sempre sotto /tmp, e un test non
# può toccare il /tmp di chi lo esegue. In produzione non si imposta.
X_TMP="${JHT_LIVE_SCREEN_X_TMP:-/tmp}"
X_SOCKET="$X_TMP/.X11-unix/X$DISPLAY_NUM"
X_LOCK="$X_TMP/.X$DISPLAY_NUM-lock"

# Un respawn dopo un crash trova il lock e il socket del server morto: Xvfb
# rifiuterebbe di partire («Server is already active for display») e pid1
# ritenterebbe all'infinito. Si rimuovono SOLO se il pid scritto nel lock non
# è più vivo — un Xvfb vivo di qualcun altro non si tocca.
if [ -f "$X_LOCK" ]; then
  stale_pid="$(tr -dc '0-9' < "$X_LOCK" 2>/dev/null || true)"
  if [ -z "$stale_pid" ] || ! kill -0 "$stale_pid" 2>/dev/null; then
    rm -f "$X_LOCK" "$X_SOCKET"
  else
    log "ERROR: display $DISPLAY_NAME is held by live pid $stale_pid"
    exit 4
  fi
elif [ -e "$X_SOCKET" ]; then
  # Socket senza lock: nessun server lo possiede. Lasciarlo farebbe passare
  # subito l'attesa del socket qui sotto, e x11vnc partirebbe prima di Xvfb.
  rm -f "$X_SOCKET"
fi

mkdir -p "$RUN_DIR" "$STATE_DIR"
chmod 700 "$RUN_DIR" "$STATE_DIR" 2>/dev/null || true

# Password nuova a ogni avvio: 8 caratteri, il massimo che l'autenticazione VNC
# considera. Scritta prima in un file temporaneo e poi rinominata, così l'app
# non legge mai una password a metà.
password="$(LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 8)"
if [ "${#password}" -ne 8 ]; then
  log "ERROR: could not generate the viewer password"
  exit 5
fi
umask 077
printf '%s\n' "$password" > "$PASSWORD_FILE.tmp" && mv -f "$PASSWORD_FILE.tmp" "$PASSWORD_FILE"
x11vnc -storepasswd "$password" "$RUN_DIR/rfbauth" >/dev/null 2>&1 || {
  log "ERROR: x11vnc -storepasswd failed"
  exit 5
}
unset password

pids=()
cleanup() {
  trap - TERM INT EXIT
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  # Una password che non protegge più niente non resta in giro.
  rm -f "$PASSWORD_FILE" "$RUN_DIR/rfbauth"
}
trap 'cleanup; exit 0' TERM INT
trap cleanup EXIT

Xvfb "$DISPLAY_NAME" -screen 0 "$GEOMETRY" -nolisten tcp &
pids+=("$!")

# x11vnc che parte prima del socket X muore subito: si aspetta il socket, con
# un tetto, invece di affidarsi a uno sleep fisso. Il tetto è in secondi veri
# (SECONDS), non in giri: su una macchina carica cento `sleep 0.1` durano ben
# più di dieci secondi.
socket_deadline=$((SECONDS + 10))
while [ ! -S "$X_SOCKET" ] && [ "$SECONDS" -lt "$socket_deadline" ]; do
  sleep 0.1
done
if [ ! -S "$X_SOCKET" ]; then
  log "ERROR: Xvfb did not create $X_SOCKET within 10s"
  exit 6
fi

x11vnc -display "$DISPLAY_NAME" -localhost -rfbport "$VNC_PORT" \
  -rfbauth "$RUN_DIR/rfbauth" -viewonly -shared -forever \
  -noxdamage -quiet &
pids+=("$!")

websockify "$WS_BIND:$WS_PORT" "127.0.0.1:$VNC_PORT" &
pids+=("$!")

log "up — display $DISPLAY_NAME ($GEOMETRY), stream on $WS_BIND:$WS_PORT, view-only"

# Il primo figlio che esce chiude la terna: pid1 la riavvia intera.
wait -n
rc=$?
log "a component exited (rc=$rc) — stopping the live screen"
exit 1

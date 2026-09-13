#!/usr/bin/env bash
# live-screen-tunnel.sh — guarda dal Mac lo schermo del CLOSER che gira nel
# container `jht` di una macchina remota (VPS), in sola visione.
#
# Uso:
#   scripts/live-screen-tunnel.sh <alias-ssh> [--ssh-config FILE]
#       [--container jht] [--local-port 16080] [--viewer tauri|none]
#
# Cosa fa, e cosa NON fa:
#   1. chiede via SSH l'IP del container sulla rete bridge della VPS e apre un
#      tunnel `-L 127.0.0.1:<porta locale> -> <IP container>:6080`. Sulla VPS
#      non si pubblica nessuna porta, non si tocca il compose, non si riavvia
#      niente: websockify ascolta già sull'interfaccia bridge del container,
#      raggiungibile solo dall'host. Con network_mode host (Podman) il target
#      è il loopback della VPS;
#   2. legge via SSH la password VNC dal file 0600 del container e la scrive in
#      una JHT_HOME temporanea (cartella 0700, file 0600) sul Mac. La password
#      non passa mai da argomenti di processo, stdout o log: resta in una
#      variabile della shell e in quel file, che sparisce all'uscita. Se il
#      container riparte la password ruota: lo script la rilegge ogni 10s;
#   3. apre l'app desktop (Tauri, `npm run tauri:dev`) con JHT_HOME e
#      JHT_LIVE_SCREEN_PORT puntati al tunnel: nell'app si clicca «Schermo
#      CLOSER». Con --viewer none resta solo il tunnel.
#
# Ctrl-C chiude tunnel, app e file temporanei.
#
# La sola visione non dipende da questo script: x11vnc nel container gira con
# -viewonly, quindi nessun client può mandare input al browser del CLOSER.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER="jht"
LOCAL_PORT=16080
VIEWER="tauri"
SSH_CONFIG=""
ALIAS=""
REFRESH_SEC="${JHT_LIVE_SCREEN_TUNNEL_REFRESH_SEC:-10}"
REMOTE_PASSWORD_FILE="/jht_home/live-screen/viewer-password"

fail() { printf '[live-screen-tunnel] ERRORE: %s\n' "$*" >&2; exit 1; }
info() { printf '[live-screen-tunnel] %s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ssh-config) SSH_CONFIG="${2:-}"; shift 2 ;;
    --container) CONTAINER="${2:-}"; shift 2 ;;
    --local-port) LOCAL_PORT="${2:-}"; shift 2 ;;
    --viewer) VIEWER="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    -*) fail "opzione sconosciuta: $1" ;;
    *) [ -z "$ALIAS" ] || fail "un solo alias SSH"; ALIAS="$1"; shift ;;
  esac
done

[ -n "$ALIAS" ] || fail "manca l'alias SSH (es. andris)"
case "$ALIAS" in *[!A-Za-z0-9_.-]*|-*) fail "alias SSH non valido: $ALIAS" ;; esac
case "$CONTAINER" in ''|*[!A-Za-z0-9_.-]*|-*) fail "nome container non valido: $CONTAINER" ;; esac
case "$LOCAL_PORT" in ''|*[!0-9]*) fail "--local-port non è un numero" ;; esac
{ [ "$LOCAL_PORT" -ge 1024 ] && [ "$LOCAL_PORT" -le 65535 ]; } || fail "--local-port fuori da 1024-65535"
case "$VIEWER" in tauri|none) ;; *) fail "--viewer vale tauri o none" ;; esac
command -v ssh >/dev/null 2>&1 || fail "ssh non trovato"

SSH=(ssh -o BatchMode=yes -o ConnectTimeout=12)
[ -n "$SSH_CONFIG" ] && SSH+=(-F "$SSH_CONFIG")

remote() { "${SSH[@]}" "$ALIAS" "$1"; }

# ── 1. Dove ascolta lo stream ────────────────────────────────────────────────
ip_list="$(remote "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' $CONTAINER")" \
  || fail "docker inspect $CONTAINER fallito su $ALIAS (container assente?)"
TARGET_HOST=""
for candidate in $ip_list; do
  if [[ "$candidate" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then TARGET_HOST="$candidate"; break; fi
done
# network_mode host: nessun IP proprio, websockify è sul loopback della VPS.
[ -n "$TARGET_HOST" ] || TARGET_HOST="127.0.0.1"

remote "docker exec $CONTAINER test -f $REMOTE_PASSWORD_FILE" \
  || fail "nel container $CONTAINER di $ALIAS lo schermo live non è acceso (immagine senza live-screen o JHT_LIVE_SCREEN=0)"

# ── 2. Password in una JHT_HOME temporanea privata ───────────────────────────
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jht-live-screen-tunnel.XXXXXX")"
chmod 700 "$WORK_DIR"
LOCAL_JHT_HOME="$WORK_DIR/jht_home"
LOCAL_PASSWORD_FILE="$LOCAL_JHT_HOME/live-screen/viewer-password"
mkdir -p "$LOCAL_JHT_HOME/live-screen"
chmod 700 "$LOCAL_JHT_HOME" "$LOCAL_JHT_HOME/live-screen"

children=()
# L'app Tauri lancia npm -> tauri -> cargo/vite -> app: si chiude l'albero intero,
# dalle foglie in su.
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$child"; done
  kill "$1" 2>/dev/null || true
}
cleanup() {
  trap - EXIT INT TERM
  for pid in "${children[@]}"; do kill_tree "$pid"; done
  wait 2>/dev/null || true
  rm -rf "$WORK_DIR"
  info "tunnel chiuso, file temporanei rimossi"
}
trap cleanup EXIT
trap 'exit 0' INT TERM

refresh_password() {
  local password
  password="$(remote "docker exec $CONTAINER cat $REMOTE_PASSWORD_FILE" 2>/dev/null)" || return 1
  password="${password//[$'\r\n']/}"
  [[ "$password" =~ ^[A-Za-z0-9]{8}$ ]] || return 1
  if [ ! -f "$LOCAL_PASSWORD_FILE" ] || [ "$(cat "$LOCAL_PASSWORD_FILE")" != "$password" ]; then
    (umask 077; printf '%s\n' "$password" > "$LOCAL_PASSWORD_FILE.tmp")
    mv -f "$LOCAL_PASSWORD_FILE.tmp" "$LOCAL_PASSWORD_FILE"
  fi
}
refresh_password || fail "password dello schermo illeggibile o malformata su $ALIAS"

# ── 3. Tunnel ────────────────────────────────────────────────────────────────
# ControlMaster=no/ControlPath=none: con un master SSH condiviso (ControlMaster
# auto nel ssh_config) il forward finirebbe nel master persistente, il client
# uscirebbe subito e Ctrl-C non chiuderebbe più la porta locale.
"${SSH[@]}" -N -o ControlMaster=no -o ControlPath=none \
  -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L "127.0.0.1:$LOCAL_PORT:$TARGET_HOST:6080" "$ALIAS" &
TUNNEL_PID=$!
children+=("$TUNNEL_PID")

tunnel_up=0
for _ in $(seq 1 60); do
  kill -0 "$TUNNEL_PID" 2>/dev/null || fail "il tunnel SSH si è chiuso (porta $LOCAL_PORT occupata o forwarding negato)"
  if (exec 3<>"/dev/tcp/127.0.0.1/$LOCAL_PORT") 2>/dev/null; then tunnel_up=1; break; fi
  sleep 0.5
done
[ "$tunnel_up" = 1 ] || fail "il tunnel non risponde su 127.0.0.1:$LOCAL_PORT dopo 30s"
info "stream di $ALIAS/$CONTAINER su ws://127.0.0.1:$LOCAL_PORT/websockify (sola visione)"

# ── 4. Visore ────────────────────────────────────────────────────────────────
if [ "$VIEWER" = "tauri" ]; then
  command -v npm >/dev/null 2>&1 || fail "npm non trovato: usa --viewer none"
  (
    cd "$ROOT_DIR/desktop"
    JHT_HOME="$LOCAL_JHT_HOME" JHT_LIVE_SCREEN_PORT="$LOCAL_PORT" exec npm run tauri:dev
  ) &
  children+=("$!")
  info "app desktop in avvio: clicca «Schermo CLOSER» nella barra in alto"
fi
info "Ctrl-C per chiudere tutto"

# Attesa a passi da 1s in PRIMO piano: Ctrl-C arriva a tutto il gruppo, il sleep
# muore e il trap scatta subito. Con un `sleep N & wait` il figlio in background
# ignora SIGINT e bash rimanda il trap finché non esce: Ctrl-C tardava fino a Ns.
elapsed=0
while kill -0 "$TUNNEL_PID" 2>/dev/null; do
  sleep 1
  elapsed=$((elapsed + 1))
  if [ "$elapsed" -ge "$REFRESH_SEC" ]; then
    elapsed=0
    refresh_password || info "password non rilevata in questo giro (container in riavvio?)"
  fi
done
fail "il tunnel SSH si è chiuso"

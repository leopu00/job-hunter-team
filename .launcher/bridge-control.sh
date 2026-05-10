#!/usr/bin/env bash
# bridge-control.sh — start/stop del sentinel-bridge.py.
# Pensato per essere invocato dagli endpoint /api/bridge/{start,stop}.
# Esce sempre con 0 a meno di errori veri (file mancanti); il "kill di
# pid che non esistono" o "for loop vuoto" non è un errore.
#
# Uso: bridge-control.sh start | stop

set +e

ACTION="${1:-}"
JHT_HOME="${JHT_HOME:-/jht_home}"
PID_FILE="$JHT_HOME/logs/sentinel-bridge.pid"
BRIDGE_PY="/app/.launcher/sentinel-bridge.py"
LOG_FILE="/tmp/sentinel-bridge.log"

kill_all_bridges() {
  for f in /proc/[0-9]*/cmdline; do
    if grep -q sentinel-bridge.py "$f" 2>/dev/null; then
      pid="${f#/proc/}"
      pid="${pid%/cmdline}"
      kill "$pid" 2>/dev/null
    fi
  done
}

case "$ACTION" in
  start)
    kill_all_bridges
    sleep 0.5
    rm -f "$PID_FILE"
    if [ ! -f "$BRIDGE_PY" ]; then
      echo "bridge script not found: $BRIDGE_PY" >&2
      exit 1
    fi
    # Spawn detached: setsid stacca dal process group del chiamante (così
    # il bridge sopravvive al ritorno dello script), redirect IO, & per
    # non bloccare. PATH include /app/agents/_tools per jht-tmux-send.
    # Niente nohup: l'immagine è busybox slim e non lo include.
    setsid bash -c "
      export PATH='/app/agents/_tools:/jht_home/.npm-global/bin:/home/jht/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      export JHT_HOME='$JHT_HOME'
      export JHT_TARGET_SESSION='${JHT_TARGET_SESSION:-CAPITANO}'
      exec /usr/bin/python3 -u '$BRIDGE_PY' >> '$LOG_FILE' 2>&1
    " < /dev/null > /dev/null 2>&1 &
    disown 2>/dev/null
    exit 0
    ;;
  stop)
    kill_all_bridges
    sleep 0.3
    rm -f "$PID_FILE"
    exit 0
    ;;
  *)
    echo "Usage: $0 start|stop" >&2
    exit 2
    ;;
esac

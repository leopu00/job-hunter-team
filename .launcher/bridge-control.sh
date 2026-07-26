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

# jht_kill_by_marker / jht_daemon_log — STESSA procedura di start-agent.sh
# (l'altro entry point del bridge: agent-watchdog.sh → start-agent.sh bridge,
# questo → team-commands-poller.js). Prima divergevano: qui un kill-by-scan
# single-shot che si auto-matchava, là TERM→KILL; il PID file era dichiarato
# e mai scritto. Ora entrambi killano allo stesso modo e il singleton vero è
# il flock dentro sentinel-bridge.py, che copre pure lo start in parallelo.
. "$(dirname "$0")/daemon-lib.sh"
LOG_FILE="$(jht_daemon_log sentinel-bridge.log)"

kill_all_bridges() {
  jht_kill_by_marker sentinel-bridge.py 1 0.5
}

case "$ACTION" in
  start)
    kill_all_bridges
    rm -f "$PID_FILE"
    if [ ! -f "$BRIDGE_PY" ]; then
      echo "bridge script not found: $BRIDGE_PY" >&2
      exit 1
    fi
    # Spawn detached: setsid stacca dal process group del chiamante (così
    # il bridge sopravvive al ritorno dello script), redirect IO, & per
    # non bloccare. PATH include /usr/local/bin dove il Dockerfile linka
    # i tool da agents/_tools/ e agents/_skills/<skill>/jht-* (refactor
    # skill-distribution 2026-05-13).
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
    rm -f "$PID_FILE"
    exit 0
    ;;
  *)
    echo "Usage: $0 start|stop" >&2
    exit 2
    ;;
esac

#!/usr/bin/env bash
# token-meter-control.sh — start/stop/status del daemon token-meter.
#
# Stesso pattern del sentinel-bridge: setsid + singleton via /proc/*/cmdline
# (fallback su kill(0) se /proc non disponibile, es. macOS host).
#
# Usage:
#   token-meter-control.sh start    # spawn daemon detached (no-op se già up)
#   token-meter-control.sh stop     # kill istanze esistenti
#   token-meter-control.sh status   # mostra pid + ultimo update state file
#   token-meter-control.sh restart  # stop + sleep 1 + start

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
METER_SCRIPT="${TOKEN_METER_SCRIPT:-$SCRIPT_DIR/token-meter.py}"
JHT_HOME="${JHT_HOME:-$HOME/.jht}"
LOGS_DIR="$JHT_HOME/logs"
LOG_FILE="${TOKEN_METER_LOG:-$LOGS_DIR/token-meter.log}"
PID_FILE="$LOGS_DIR/token-meter.pid"
STATE_FILE="$LOGS_DIR/token-meter-state.json"

mkdir -p "$LOGS_DIR"

_find_pids() {
  # Stampa i pid del daemon su stdout (uno per riga). Su Linux con /proc usa
  # cmdline match; su macOS cade su ps -A.
  if [ -d /proc ]; then
    grep -l token-meter.py /proc/[0-9]*/cmdline 2>/dev/null \
      | sed 's|/proc/||;s|/cmdline||' || true
  else
    # macOS host (sviluppo): ps cmdline match
    ps -A -o pid=,command= 2>/dev/null \
      | awk '/token-meter\.py/ && !/awk/ && !/grep/ {print $1}' || true
  fi
}

_cmd_start() {
  if [ ! -f "$METER_SCRIPT" ]; then
    echo "✗ token-meter script not found: $METER_SCRIPT" >&2
    return 1
  fi
  # Singleton: se già up, no-op (idempotente per integrazione launcher).
  _existing="$(_find_pids | head -1 || true)"
  if [ -n "$_existing" ]; then
    echo "✓ token-meter already running (pid=$_existing)"
    return 0
  fi
  # setsid esiste sul container Linux (busybox) ma non su macOS host.
  # Su mac usiamo nohup + & come fallback per detacharsi dal terminale.
  if command -v setsid >/dev/null 2>&1; then
    setsid sh -c "
      JHT_HOME='$JHT_HOME' \
        python3 -u '$METER_SCRIPT' >> '$LOG_FILE' 2>&1
    " >/dev/null 2>&1 < /dev/null &
  else
    nohup env JHT_HOME="$JHT_HOME" python3 -u "$METER_SCRIPT" >> "$LOG_FILE" 2>&1 < /dev/null &
    disown 2>/dev/null || true
  fi
  # Diamo un attimo al daemon per scrivere il PID file (acquire_singleton_lock).
  # 1s perché il primo poll lib può prendersi un attimo a leggere wire.jsonl.
  sleep 1
  _new="$(_find_pids | head -1 || true)"
  if [ -z "$_new" ] && [ -f "$PID_FILE" ]; then
    _new="$(cat "$PID_FILE" 2>/dev/null)"
  fi
  echo "✓ token-meter started (pid=${_new:-?}, log $LOG_FILE)"
}

_cmd_stop() {
  _pids="$(_find_pids)"
  if [ -z "$_pids" ]; then
    echo "○ token-meter not running"
    return 0
  fi
  for _pid in $_pids; do
    kill "$_pid" 2>/dev/null || true
    echo "  killed pid=$_pid"
  done
  # Best-effort: aspetta che muoiano davvero.
  sleep 0.5
  for _pid in $_pids; do
    kill -0 "$_pid" 2>/dev/null && kill -9 "$_pid" 2>/dev/null || true
  done
  rm -f "$PID_FILE"
  echo "✓ token-meter stopped"
}

_cmd_status() {
  _pids="$(_find_pids)"
  if [ -z "$_pids" ]; then
    echo "status: DOWN"
  else
    echo "status: UP  pids=$_pids"
  fi
  if [ -f "$STATE_FILE" ]; then
    echo "state:  $STATE_FILE"
    python3 -c "
import json, sys, time
from pathlib import Path
p = Path('$STATE_FILE')
try:
    d = json.loads(p.read_text())
    age = time.time() - p.stat().st_mtime
    print(f'  updated_at={d.get(\"updated_at\")} (age={age:.1f}s)')
    print(f'  provider={d.get(\"provider\")} window_source={d.get(\"window_source\")}')
    print(f'  bridge={d.get(\"bridge\",{}).get(\"usage_pct\")}% reset={d.get(\"bridge\",{}).get(\"reset_at\")}')
    r = d.get('ratio',{})
    if r.get('ema_kt_per_pct'):
        print(f'  ratio_ema={r[\"ema_kt_per_pct\"]:.2f} kT/1% (n_calib={r[\"calibrations\"]})')
    pa = d.get('per_agent', {})
    if pa:
        active = sorted(((a, info['rate_kt_per_min_60s']) for a, info in pa.items() if info.get('rate_kt_per_min_60s',0)>0), key=lambda x:-x[1])
        if active:
            print('  per_agent (active 60s):')
            for a, r in active[:8]:
                print(f'    {a:<14} {r:.2f} kT/min')
except Exception as e:
    print(f'  (errore lettura state: {e})')
"
  fi
}

case "${1:-status}" in
  start)   _cmd_start ;;
  stop)    _cmd_stop ;;
  status)  _cmd_status ;;
  restart) _cmd_stop; sleep 1; _cmd_start ;;
  *)
    echo "usage: $0 {start|stop|status|restart}" >&2
    exit 2
    ;;
esac

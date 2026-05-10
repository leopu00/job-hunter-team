#!/usr/bin/env bash
# dev-down-additional.sh — Ferma un dev secondario su una porta specifica.
# NON tocca il container `jht` né il dev primario su :3001.
#
# Uso: bash scripts/dev-down-additional.sh <port>

set -euo pipefail

PORT="${1:-}"

if [ -z "$PORT" ]; then
  echo "Usage: $0 <port>" >&2
  exit 2
fi

if [ "$PORT" = "3001" ]; then
  echo "Use scripts/dev-down.sh for port 3001 (primary dev)" >&2
  exit 2
fi

# Kill `next dev -p <port>` + figlio `next-server` + postcss workers.
HOST_PIDS=$(pgrep -f "next dev -p $PORT" 2>/dev/null || true)
if [ -n "${HOST_PIDS}" ]; then
  # shellcheck disable=SC2086
  kill -TERM ${HOST_PIDS} 2>/dev/null || true
  sleep 1
  # SIGKILL su quelli ancora vivi
  STILL_ALIVE=$(pgrep -f "next dev -p $PORT" 2>/dev/null || true)
  if [ -n "${STILL_ALIVE}" ]; then
    # shellcheck disable=SC2086
    kill -KILL ${STILL_ALIVE} 2>/dev/null || true
  fi
fi

# Cleanup eventuale processo che tiene la porta (orfano).
PORT_PID=$(lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
if [ -n "$PORT_PID" ]; then
  kill -KILL "$PORT_PID" 2>/dev/null || true
fi

echo "STOPPED port=$PORT"

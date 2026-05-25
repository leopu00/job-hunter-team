#!/usr/bin/env bash
# sim-down.sh — Ferma il container `jht-sim-d2` senza distruggerlo.
# Per cancellare anche il volume ~/.jht-sim-d2 passa --purge.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/scripts/sim/docker-compose.sim.yml"
SIM_HOME="${HOME}/.jht-sim-d2"

PURGE=0
if [ "${1:-}" = "--purge" ]; then PURGE=1; fi

echo "▶ docker compose down (jht-sim-d2)..."
docker compose -f "$COMPOSE_FILE" down

if [ "$PURGE" = "1" ]; then
  echo "▶ Cancello volume host $SIM_HOME (--purge)..."
  rm -rf "$SIM_HOME"
  echo "✓ Volume cancellato."
else
  echo "ℹ Volume ${SIM_HOME} preservato. Per cancellarlo: sim-down.sh --purge"
fi

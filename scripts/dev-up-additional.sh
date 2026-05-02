#!/usr/bin/env bash
# dev-up-additional.sh — Avvia un Next dev SECONDARIO su un worktree a scelta,
# riusando il container `jht` condiviso (NON lo distrugge).
#
# Uso: bash scripts/dev-up-additional.sh <worktree-path> <port>
#   es: bash scripts/dev-up-additional.sh /Users/.../dev2 3002
#
# Differenze chiave rispetto a dev-up.sh:
#   - NON tocca il container `jht` (il primario su :3001 e il team lo usano)
#   - NON killa altri `next dev` (solo quello eventualmente sulla stessa porta)
#   - rm -rf <worktree>/web/.next come preflight (anti loop SWC al boot,
#     vedi memory feedback_no_long_running_with_parallel_agents crash #8)
#   - vm_stat preflight: aborta se Pages free < 50000 (Mac M3 18 GB)
#   - Esporta JHT_SHELL_VIA=docker:jht così il dev parla col container condiviso
#   - Log dedicato per porta: .dev-logs/host-next-<port>.log
#   - Stampa il PID al termine, così Electron lo può salvare per kill mirato

set -euo pipefail

WORKTREE="${1:-}"
PORT="${2:-}"

if [ -z "$WORKTREE" ] || [ -z "$PORT" ]; then
  echo "Usage: $0 <worktree-path> <port>" >&2
  exit 2
fi

if [ ! -d "$WORKTREE/web" ]; then
  echo "Worktree path invalid (no web/ subdir): $WORKTREE" >&2
  exit 2
fi

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 3000 ] || [ "$PORT" -gt 9999 ]; then
  echo "Port must be 3000-9999: $PORT" >&2
  exit 2
fi

if [ "$PORT" = "3001" ]; then
  echo "Port 3001 is reserved for the primary dev (use scripts/dev-up.sh)" >&2
  exit 2
fi

# ── Preflight: porta libera ────────────────────────────────────────────────
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT already in use" >&2
  exit 3
fi

# ── Preflight: memoria sufficiente (Mac) ───────────────────────────────────
# Pages free > 50000 (~800 MB). Sotto soglia il next dev può saturare e
# innescare wdog kernel (vedi crash 2026-05-02).
if [ "$(uname)" = "Darwin" ]; then
  PAGES_FREE=$(vm_stat | awk '/Pages free/ { gsub(/\./,""); print $3 }')
  if [ -n "$PAGES_FREE" ] && [ "$PAGES_FREE" -lt 50000 ]; then
    echo "Insufficient free memory (Pages free=$PAGES_FREE, need >50000)" >&2
    exit 4
  fi
fi

# ── Preflight: container jht raggiungibile ─────────────────────────────────
# Se il container condiviso è giù il dev:3001 primario non è ancora partito;
# meglio fermarsi qui e dirlo all'utente, sennò il secondario parte ma le
# API server-side che fanno docker exec falliranno silenziosamente.
if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx jht; then
  echo "Container 'jht' is not running. Avvia prima dev primario (:3001)." >&2
  exit 5
fi

# ── Cleanup .next del worktree target (anti loop SWC al boot) ──────────────
# Sicuro: il dev secondario non è ancora avviato (porta libera, vedi check sopra).
rm -rf "$WORKTREE/web/.next"

# ── Setup log + lancio ─────────────────────────────────────────────────────
LOG_DIR="$WORKTREE/.dev-logs"
mkdir -p "$LOG_DIR"
LOG_PATH="$LOG_DIR/host-next-$PORT.log"
: > "$LOG_PATH"  # truncate

cd "$WORKTREE/web"

export JHT_SHELL_VIA="docker:jht"
nohup npm run dev -- -p "$PORT" > "$LOG_PATH" 2>&1 &
DEV_PID=$!
disown "$DEV_PID" 2>/dev/null || true

# ── Wait for ready (max 30s) ───────────────────────────────────────────────
DEADLINE=$(( $(date +%s) + 30 ))
READY=0
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/" 2>/dev/null; then
    READY=1
    break
  fi
  sleep 2
done

# ── Output structurato (parsato da Electron) ───────────────────────────────
echo "PID=$DEV_PID"
echo "PORT=$PORT"
echo "WORKTREE=$WORKTREE"
echo "LOG=$LOG_PATH"
echo "URL=http://localhost:$PORT"
echo "READY=$READY"

if [ "$READY" -ne 1 ]; then
  echo "WARN: server not ready in 30s, but PID is alive — check log" >&2
  exit 6
fi

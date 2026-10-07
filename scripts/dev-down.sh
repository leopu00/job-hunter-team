#!/usr/bin/env bash
# dev-down.sh — Spegne il dev mode: ferma host Next su :3001 e container jht.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COLOR_RESET=$'\e[0m'
COLOR_DIM=$'\e[2m'
COLOR_GREEN=$'\e[32m'
COLOR_YELLOW=$'\e[33m'

log()  { printf "%s▶%s %s\n" "$COLOR_GREEN" "$COLOR_RESET" "$*"; }
info() { printf "%s  %s%s\n" "$COLOR_DIM" "$*" "$COLOR_RESET"; }
warn() { printf "%s⚠%s %s\n" "$COLOR_YELLOW" "$COLOR_RESET" "$*"; }

# Solo i processi di QUESTA worktree: il loro cmdline contiene il path di
# web/ (npm mette web/node_modules/.bin nel PATH col path assoluto). Un
# `pgrep -f "next dev -p N"` nudo prendeva anche il Next di un'altra worktree
# o di un altro team sulla stessa macchina.
worktree_re() { printf '%s' "$REPO_ROOT" | sed 's/[][\.*^$+?(){}|]/\\&/g'; }

# ── Host Next ─────────────────────────────────────────────────────────────
HOST_PIDS=$(pgrep -f "$(worktree_re)/web/node_modules/.*next dev -p 3001" 2>/dev/null || true)
if [ -n "${HOST_PIDS}" ]; then
  log "Termino Next host (pids: ${HOST_PIDS})"
  # shellcheck disable=SC2086
  kill -TERM ${HOST_PIDS} 2>/dev/null || true
  sleep 1
fi

# Pulizia postcss worker orfani (vedi memory: feedback_web_dev_host_mode).
# Turbopack su bind-mount Windows li spawna ma non li chiude, saturando la RAM.
POSTCSS_PIDS=$(pgrep -f "$(worktree_re)/web/.*postcss\.js" 2>/dev/null || true)
if [ -n "${POSTCSS_PIDS}" ]; then
  COUNT=$(printf "%s\n" "${POSTCSS_PIDS}" | wc -l | tr -d ' ')
  info "Termino $COUNT postcss worker orfani"
  # shellcheck disable=SC2086
  kill -9 ${POSTCSS_PIDS} 2>/dev/null || true
fi

# ── Container ─────────────────────────────────────────────────────────────
if docker ps -a --format '{{.Names}}' | grep -qx jht; then
  log "Stop container jht"
  docker compose stop jht >/dev/null 2>&1 || docker stop jht >/dev/null 2>&1 || true
fi

info "Dev mode off. Il container non e' stato rimosso: bastera' 'bash scripts/dev-up.sh' per riaccenderlo."

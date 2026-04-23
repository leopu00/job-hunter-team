#!/usr/bin/env bash
# dev-up.sh — Launch JHT dev mode: container (bind-mounts) + host Next su :3001.
#
# Cosa fa:
#   1. Ferma/rimuove eventuale container `jht` esistente (anche se lanciato da Electron)
#   2. Crea il container tramite `docker compose up --no-start` (bind-mount di
#      web/, agents/, shared/, .launcher/ presi dal compose alla repo root)
#   3. Fixa l'ownership dell'anonymous volume `.next` (altrimenti Next crasha
#      in EACCES alla prima compile)
#   4. Avvia il container
#   5. Avvia Next sull'host su porta 3001 con JHT_SHELL_VIA=docker:jht
#      (le API del frontend delegano tmux/agenti al container)
#
# Uso: bash scripts/dev-up.sh  (da git-bash su Windows, o da qualunque shell POSIX)
# Stop: bash scripts/dev-down.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

COLOR_RESET=$'\e[0m'
COLOR_DIM=$'\e[2m'
COLOR_GREEN=$'\e[32m'
COLOR_YELLOW=$'\e[33m'
COLOR_RED=$'\e[31m'
COLOR_BOLD=$'\e[1m'

log()  { printf "%s▶%s %s\n" "$COLOR_GREEN" "$COLOR_RESET" "$*"; }
info() { printf "%s  %s%s\n" "$COLOR_DIM" "$*" "$COLOR_RESET"; }
warn() { printf "%s⚠%s %s\n" "$COLOR_YELLOW" "$COLOR_RESET" "$*"; }
err()  { printf "%s✗%s %s\n" "$COLOR_RED" "$COLOR_RESET" "$*" >&2; }

# ── 1. Prerequisiti ────────────────────────────────────────────────────────
if ! docker info >/dev/null 2>&1; then
  err "Docker non raggiungibile. Avvia Docker Desktop e riprova."
  exit 1
fi

IMAGE="ghcr.io/leopu00/jht:latest"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  warn "Immagine $IMAGE non presente; la scaricherò al primo avvio compose."
fi

# ── 2. Cleanup container esistente ────────────────────────────────────────
if docker ps -a --format '{{.Names}}' | grep -qx jht; then
  log "Rimuovo container jht esistente (era: $(docker inspect jht --format '{{.State.Status}}'))"
  docker rm -f jht >/dev/null
fi

# ── 3. Crea container (bind-mount) senza avviarlo, così da fixare .next ──
log "Creo container via compose (bind-mount web/ agents/ shared/ .launcher/)"
docker compose up --no-start jht >/dev/null

# ── 4. Fix ownership .next volume ─────────────────────────────────────────
# L'anonymous volume che maschera /app/web/.next parte root-owned; il
# container gira come uid 1001 (jht) e fallirebbe EACCES alla prima
# compile di Turbopack. Risolto con un one-shot --volumes-from.
# MSYS_NO_PATHCONV=1 evita che git-bash converta /bin/sh in C:/... su Windows.
log "Fixo ownership di /app/web/.next (uid 1001)"
MSYS_NO_PATHCONV=1 docker run --rm --user root --entrypoint /bin/sh \
  --volumes-from jht "$IMAGE" \
  -c "chown -R 1001:1001 /app/web/.next" >/dev/null

# ── 5. Start container ────────────────────────────────────────────────────
log "Avvio container jht"
docker compose start jht >/dev/null
info "Container in avvio. Next dentro parte su :3000 (baked), Assistente in background."

# ── 6. Azzera env Supabase per dev host e avvia Next ──────────────────────
# Dev host mode usa SQLite locale: se .env.local definisce Supabase il
# fallback non scatta e vedi 0 risultati. Lo svuotiamo SOLO per questo
# processo Next (non tocca .env.local sul disco).
log "Avvio Next sull'host su :3001 (docker-exec mode)"

cd "$REPO_ROOT/web"

# Kill eventuale Next host precedente per non intasare la memoria
# con postcss worker (vedi memory: feedback_web_dev_host_mode).
HOST_NEXT_PIDS=$(pgrep -f "next dev -p 3001" 2>/dev/null || true)
if [ -n "${HOST_NEXT_PIDS}" ]; then
  info "Termino Next host precedenti: ${HOST_NEXT_PIDS}"
  # shellcheck disable=SC2086
  kill -TERM ${HOST_NEXT_PIDS} 2>/dev/null || true
  sleep 1
fi

LOG_DIR="$REPO_ROOT/.dev-logs"
mkdir -p "$LOG_DIR"
HOST_LOG="$LOG_DIR/host-next.log"

# Lancia in background, detach dalla shell corrente
export JHT_SHELL_VIA="docker:jht"
export NEXT_PUBLIC_SUPABASE_URL=""
export NEXT_PUBLIC_SUPABASE_ANON_KEY=""
(
  cd "$REPO_ROOT/web"
  nohup npm run dev -- -p 3001 > "$HOST_LOG" 2>&1 &
)
sleep 5

# Verifica boot
if curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/" --max-time 30 | grep -qE "^(200|307|308)"; then
  log "Host Next pronto su ${COLOR_BOLD}http://localhost:3001${COLOR_RESET}"
else
  warn "Host Next non risponde ancora; log: $HOST_LOG"
fi

# ── 7. Riepilogo ──────────────────────────────────────────────────────────
printf "\n"
printf "  %sDev mode attivo%s\n" "$COLOR_GREEN$COLOR_BOLD" "$COLOR_RESET"
printf "    UI dev (hot-reload):  %shttp://localhost:3001%s\n" "$COLOR_BOLD" "$COLOR_RESET"
printf "    Next container:       %shttp://localhost:3000%s %s(usato solo come fallback)%s\n" "$COLOR_DIM" "$COLOR_RESET" "$COLOR_DIM" "$COLOR_RESET"
printf "    Log host Next:        %s%s%s\n" "$COLOR_DIM" "$HOST_LOG" "$COLOR_RESET"
printf "    Log container:        %sdocker logs -f jht%s\n" "$COLOR_DIM" "$COLOR_RESET"
printf "\n"
printf "  %sStop:%s bash scripts/dev-down.sh\n" "$COLOR_DIM" "$COLOR_RESET"

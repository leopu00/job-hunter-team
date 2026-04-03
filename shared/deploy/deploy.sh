#!/usr/bin/env bash
# Deploy JHT su server.
#
# Fasi: build → migrate → restart servizi.
#
# Uso:
#   ./shared/deploy/deploy.sh                # deploy completo
#   ./shared/deploy/deploy.sh --build-only   # solo build
#   ./shared/deploy/deploy.sh --restart-only # solo restart
#   ./shared/deploy/deploy.sh --health       # health check post-deploy
#   ./shared/deploy/deploy.sh --rollback     # torna all'ultima versione stabile
#
# Variabili d'ambiente:
#   JHT_ENV          Ambiente target: production | staging (default: production)
#   JHT_WEB_DIR      Path alla directory web/ (default: ./web)
#   JHT_WORKSPACE    Path alla workspace JHT (default: ~/.jht)
#   JHT_DEPLOY_LOG   File di log deploy (default: ~/.jht/deploy.log)

set -euo pipefail

JHT_ENV="${JHT_ENV:-production}"
JHT_WEB_DIR="${JHT_WEB_DIR:-./web}"
JHT_WORKSPACE="${JHT_WORKSPACE:-$HOME/.jht}"
JHT_DEPLOY_LOG="${JHT_DEPLOY_LOG:-$JHT_WORKSPACE/deploy.log}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="deploy"
SHOW_HEALTH=false

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$JHT_DEPLOY_LOG"; }
err() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $*" | tee -a "$JHT_DEPLOY_LOG" >&2; }

# ---------------------------------------------------------------------------
# Argomenti
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-only)   MODE="build" ;;
    --restart-only) MODE="restart" ;;
    --health)       SHOW_HEALTH=true ;;
    --rollback)     MODE="rollback" ;;
    -h|--help)
      cat <<'HELP'
Uso: ./shared/deploy/deploy.sh [OPZIONE]

  (nessun arg)     Deploy completo (build + migrate + restart)
  --build-only     Solo build Next.js
  --restart-only   Solo restart servizi (senza build)
  --health         Esegui health check dopo il deploy
  --rollback       Torna all'ultima versione stabile
  -h, --help       Mostra questo messaggio
HELP
      exit 0 ;;
    *) err "Opzione sconosciuta: $1"; exit 1 ;;
  esac
  shift
done

mkdir -p "$JHT_WORKSPACE"
log "=== Deploy JHT — env=$JHT_ENV mode=$MODE ==="

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
build_web() {
  log "Build web..."
  if [[ ! -d "$JHT_WEB_DIR" ]]; then
    err "Directory web non trovata: $JHT_WEB_DIR"
    exit 1
  fi
  (cd "$JHT_WEB_DIR" && npm ci --prefer-offline && npm run build)
  log "Build completata."
}

# ---------------------------------------------------------------------------
# Migrate (es. Supabase o script SQL)
# ---------------------------------------------------------------------------
run_migrations() {
  log "Migrazioni..."
  local MIGRATIONS_DIR="${SCRIPT_DIR}/../../migrations"
  if [[ -d "$MIGRATIONS_DIR" ]]; then
    log "Eseguo script migrazioni in $MIGRATIONS_DIR"
    for f in "$MIGRATIONS_DIR"/*.sql; do
      [[ -f "$f" ]] || continue
      log "  -> $f"
    done
  else
    log "Nessuna directory migrations trovata — skip."
  fi
}

# ---------------------------------------------------------------------------
# Restart servizi (pm2 o systemd)
# ---------------------------------------------------------------------------
restart_services() {
  log "Restart servizi..."

  if command -v pm2 &>/dev/null; then
    log "Restart via pm2..."
    pm2 restart jht-web 2>/dev/null || pm2 start "$JHT_WEB_DIR" --name jht-web 2>/dev/null || true
    pm2 save 2>/dev/null || true

  elif command -v systemctl &>/dev/null && systemctl is-active jht-web &>/dev/null; then
    log "Restart via systemctl..."
    sudo systemctl restart jht-web

  else
    log "Nessun gestore servizi trovato (pm2/systemd) — restart manuale richiesto."
  fi

  log "Restart completato."
}

# ---------------------------------------------------------------------------
# Rollback
# ---------------------------------------------------------------------------
rollback() {
  log "Rollback..."
  if command -v pm2 &>/dev/null; then
    pm2 revert jht-web 2>/dev/null || { err "Rollback pm2 fallito."; exit 1; }
  else
    err "Rollback automatico non supportato senza pm2."
    exit 1
  fi
  log "Rollback completato."
}

# ---------------------------------------------------------------------------
# Esecuzione
# ---------------------------------------------------------------------------
case "$MODE" in
  deploy)
    build_web
    run_migrations
    restart_services
    ;;
  build)
    build_web
    ;;
  restart)
    restart_services
    ;;
  rollback)
    rollback
    ;;
esac

if $SHOW_HEALTH; then
  log "Health check..."
  npx tsx "$SCRIPT_DIR/health-check.ts" || log "WARN: health check segnala problemi."
fi

log "=== Deploy terminato. ==="

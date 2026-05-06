#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  jht — host-side dispatcher                                              ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Wrapper Bash sottile che instrada i comandi:                            ║
# ║                                                                          ║
# ║    LIFECYCLE   → docker compose / docker logs / docker inspect           ║
# ║    OPERATIVITA → docker exec -it jht node /app/cli/bin/main.js <args>    ║
# ║                                                                          ║
# ║  Niente Node, Python o tmux sull'host. Niente socket Docker dentro al    ║
# ║  container. Il CLI Node gira nel container long-running `jht` e ci       ║
# ║  parla via `docker exec`.                                                ║
# ║                                                                          ║
# ║  Auto-up: se il container `jht` non e' attivo quando l'utente lancia un  ║
# ║  comando di operativita', lo si avvia automaticamente via compose.       ║
# ║                                                                          ║
# ║  Override via env:                                                       ║
# ║    JHT_CONTAINER_NAME=jht                                                ║
# ║    JHT_RUNTIME_DIR=$HOME/.jht/runtime                                    ║
# ║    JHT_COMPOSE_FILE=$JHT_RUNTIME_DIR/docker-compose.yml                  ║
# ║                                                                          ║
# ║  Riferimento design: docs/internal/2026-05-06-host-container-split.md    ║
# ╚══════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

CONTAINER="${JHT_CONTAINER_NAME:-jht}"
RUNTIME_DIR="${JHT_RUNTIME_DIR:-$HOME/.jht/runtime}"
COMPOSE_FILE="${JHT_COMPOSE_FILE:-$RUNTIME_DIR/docker-compose.yml}"
NODE_ENTRY="${JHT_NODE_ENTRY:-/app/cli/bin/jht.js}"

# Colori solo se stdout e' un terminale.
if [ -t 1 ]; then
  RED='\033[0;31m' YELLOW='\033[1;33m' DIM='\033[2m' BOLD='\033[1m' RESET='\033[0m'
else
  RED='' YELLOW='' DIM='' BOLD='' RESET=''
fi

err()  { printf "${RED}error:${RESET} %s\n" "$*" >&2; }
warn() { printf "${YELLOW}warn:${RESET}  %s\n" "$*" >&2; }
info() { printf "${DIM}%s${RESET}\n" "$*" >&2; }

# ── Verifiche pre-flight ──────────────────────────────────────────────────
require_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    err "docker non trovato nel PATH. Installa Docker Desktop (Mac/Win) o docker.io (Linux)."
    exit 127
  fi
  if ! docker info >/dev/null 2>&1; then
    err "Docker daemon non risponde. Avvialo (colima start / systemctl start docker / Docker Desktop)."
    exit 1
  fi
}

require_compose_file() {
  if [ ! -f "$COMPOSE_FILE" ]; then
    err "compose file non trovato: $COMPOSE_FILE"
    info "Esegui di nuovo install.sh oppure scarica manualmente:"
    info "  mkdir -p $RUNTIME_DIR && curl -fsSL https://raw.githubusercontent.com/leopu00/job-hunter-team/master/docker-compose.yml -o $COMPOSE_FILE"
    exit 1
  fi
}

compose() {
  # `docker compose` dell'host. MSYS_NO_PATHCONV protegge da git-bash su Windows.
  MSYS_NO_PATHCONV=1 docker compose -f "$COMPOSE_FILE" --project-directory "$RUNTIME_DIR" "$@"
}

container_up() {
  docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"
}

# Allinea l'owner delle dir bind-mountate all'UID che il container usa
# internamente (jht = 1001). Senza questo, su VPS root (uid 0) il
# container 'jht' non puo' scrivere in /jht_home: EACCES su jht.config.json,
# ~/.jht/.npm-global, ecc.
#
# Override via JHT_BIND_OWNER (default 1001:1001). Best-effort: ignora
# fallimenti chown su Mac/Colima dove userns mapping gestisce diversamente.
ensure_bind_owner() {
  [ "$(uname -s)" = "Linux" ] || return 0
  local target="${JHT_BIND_OWNER:-1001:1001}"
  local target_uid="${target%%:*}"
  local home_dir="${JHT_HOME_HOST:-$HOME/.jht}"
  local user_dir="${JHT_USER_DIR_HOST:-$HOME/Documents/Job Hunter Team}"
  mkdir -p "$home_dir" "$user_dir" 2>/dev/null || true
  for d in "$home_dir" "$user_dir"; do
    [ -d "$d" ] || continue
    local cur_uid
    cur_uid=$(stat -c '%u' "$d" 2>/dev/null || echo "")
    if [ -n "$cur_uid" ] && [ "$cur_uid" != "$target_uid" ]; then
      info "Allineo owner di $d a $target (era uid $cur_uid)..."
      if [ "$(id -u)" = "0" ]; then
        chown -R "$target" "$d" 2>/dev/null || warn "chown fallito su $d"
      else
        sudo chown -R "$target" "$d" 2>/dev/null || warn "sudo chown fallito su $d (potrebbe servire 'sudo $0 up')"
      fi
    fi
  done
}

ensure_up() {
  if ! container_up; then
    info "Container '$CONTAINER' non attivo, lo avvio..."
    ensure_bind_owner
    compose up -d
    # Attendi che il container sia in stato running prima di proseguire.
    local tries=20
    while ! container_up; do
      tries=$((tries - 1))
      if [ "$tries" -le 0 ]; then
        err "Container '$CONTAINER' non e' partito entro 10s. Controlla 'jht logs'."
        exit 1
      fi
      sleep 0.5
    done
  fi
}

# Decide se passare -it a docker exec: serve solo se stdin/stdout sono terminali.
exec_flags() {
  if [ -t 0 ] && [ -t 1 ]; then
    printf -- '-it'
  else
    printf -- '-i'
  fi
}

# ── Dispatcher ────────────────────────────────────────────────────────────
SUB="${1:-}"

case "$SUB" in
  # ── Lifecycle: parlano direttamente al daemon Docker ───────────────────
  up|start-container)
    require_docker
    require_compose_file
    ensure_bind_owner
    compose up -d
    ;;

  down|stop-container)
    require_docker
    require_compose_file
    compose down
    ;;

  restart)
    require_docker
    require_compose_file
    compose restart "$CONTAINER"
    ;;

  recreate)
    require_docker
    require_compose_file
    ensure_bind_owner
    compose down
    compose up -d
    ;;

  upgrade)
    require_docker
    require_compose_file
    ensure_bind_owner
    compose pull
    compose up -d
    ;;

  logs)
    require_docker
    shift || true
    # Passa eventuali flag (-f, --tail N) a docker logs.
    docker logs "$@" "$CONTAINER"
    ;;

  status)
    require_docker
    if container_up; then
      docker inspect "$CONTAINER" --format \
        'name={{.Name}} status={{.State.Status}} started={{.State.StartedAt}} image={{.Config.Image}}'
    else
      printf "container '%s' non attivo\n" "$CONTAINER"
      exit 1
    fi
    ;;

  shell)
    require_docker
    ensure_up
    docker exec $(exec_flags) "$CONTAINER" bash
    ;;

  # ── Operativita': delegata al CLI Node nel container ───────────────────
  '')
    require_docker
    require_compose_file
    ensure_up
    docker exec $(exec_flags) "$CONTAINER" node "$NODE_ENTRY" --help
    ;;

  *)
    require_docker
    require_compose_file
    ensure_up
    docker exec $(exec_flags) "$CONTAINER" node "$NODE_ENTRY" "$@"
    ;;
esac

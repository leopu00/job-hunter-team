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
# ║  Riferimento design: docs/internal/vps.md    ║
# ╚══════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

CONTAINER="${JHT_CONTAINER_NAME:-jht}"
RUNTIME_DIR="${JHT_RUNTIME_DIR:-$HOME/.jht/runtime}"
COMPOSE_FILE="${JHT_COMPOSE_FILE:-$RUNTIME_DIR/docker-compose.yml}"
NODE_ENTRY="${JHT_NODE_ENTRY:-/app/cli/bin/jht.js}"
HOST_SETUP_SCRIPT="${JHT_HOST_SETUP_SCRIPT:-$RUNTIME_DIR/host-setup.sh}"

# Carica la host env (scritta da host-setup.sh: JHT_HOST_TYPE=vps|local).
# Il wizard Node usa JHT_HOST_TYPE per attivare step obbligatori (cloud
# pairing, telegram) sul path VPS, e il dispatcher pid1 del container
# lo usa per scegliere tra dashboard locale e cloud sync daemon.
HOST_ENV_FILE="${JHT_HOST_ENV_FILE:-$HOME/.jht/host.env}"
if [ -f "$HOST_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$HOST_ENV_FILE"
fi
JHT_HOST_TYPE="${JHT_HOST_TYPE:-unknown}"
JHT_LANG="${JHT_LANG:-en}"
# Export per docker compose: il compose file fa `${JHT_HOST_TYPE:-}` /
# `${JHT_LANG:-}` substitution per passare i valori al container. Senza
# export restano variabili di shell e compose non le vede.
export JHT_HOST_TYPE
export JHT_LANG

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
# Il check va fatto QUI nel parent shell, NON dentro $(...): la command
# substitution chiude/reindirizza stdin+stdout del subshell, quindi
# `[ -t 0 ]` e `[ -t 1 ]` sarebbero sempre falsi e il wrapper passerebbe
# sempre `-i` anche su SSH interattivo. Risultato: clack/wizard riceve
# stdin senza raw mode → exit silenzioso al primo selettore.
if [ -t 0 ] && [ -t 1 ]; then
  EXEC_FLAGS="-it"
else
  EXEC_FLAGS="-i"
fi

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
    docker exec $EXEC_FLAGS "$CONTAINER" bash
    ;;

  # ── OAuth login: lancia il CLI del provider (claude/codex/kimi) per il
  # device-flow OAuth. Comando dedicato perche' va eseguito in un terminale
  # separato durante il setup wizard (clack non rilascia bene il TTY).
  # Per ora hardcode "claude" come provider beta. TODO: leggere active_provider
  # da ~/.jht/jht.config.json e mappare claude/codex/kimi.
  oauth-login|claude-login)
    require_docker
    require_compose_file
    ensure_up
    docker exec $EXEC_FLAGS "$CONTAINER" claude
    ;;

  # ── Setup: host-side preflight (swap, VPS detect) prima del wizard ────
  setup)
    require_docker
    require_compose_file
    # Skip host-setup se utente ha passato --non-interactive (i flag CLI
    # del wizard sono espliciti, niente domande possibili) o env esplicita.
    if [ "${JHT_SKIP_HOST_SETUP:-0}" != "1" ] \
       && ! printf '%s\n' "$@" | grep -q -- '--non-interactive'; then
      if [ -x "$HOST_SETUP_SCRIPT" ]; then
        bash "$HOST_SETUP_SCRIPT" || warn "host-setup.sh terminato con errore — proseguo"
      else
        info "host-setup.sh non trovato in $HOST_SETUP_SCRIPT — skip preflight host"
      fi
    fi
    # Re-source host.env DOPO host-setup.sh: il file viene scritto solo li',
    # quindi il source iniziale del wrapper (top-level) lo manca al primo
    # setup. Senza questo, JHT_HOST_TYPE arriverebbe "unknown" al wizard
    # Node e il branch VPS-only (cloud + telegram obbligatori) non si
    # attiverebbe. Idempotente nei run successivi.
    if [ -f "$HOST_ENV_FILE" ]; then
      # shellcheck disable=SC1090
      . "$HOST_ENV_FILE"
    fi
    JHT_HOST_TYPE="${JHT_HOST_TYPE:-unknown}"
    ensure_up
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$CONTAINER" node "$NODE_ENTRY" "$@"
    ;;

  # ── Operativita': delegata al CLI Node nel container ───────────────────
  '')
    require_docker
    require_compose_file
    ensure_up
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$CONTAINER" node "$NODE_ENTRY" --help
    ;;

  *)
    require_docker
    require_compose_file
    ensure_up
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$CONTAINER" node "$NODE_ENTRY" "$@"
    ;;
esac

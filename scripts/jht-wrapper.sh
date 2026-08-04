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
# ║  Riferimento design: docs/internal/ops/vps.md    ║
# ╚══════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

CONTAINER="${JHT_CONTAINER_NAME:-jht}"
RUNTIME_DIR="${JHT_RUNTIME_DIR:-$HOME/.jht/runtime}"
COMPOSE_FILE="${JHT_COMPOSE_FILE:-$RUNTIME_DIR/docker-compose.yml}"
NODE_ENTRY="${JHT_NODE_ENTRY:-/app/cli/bin/jht.js}"
HOST_SETUP_SCRIPT="${JHT_HOST_SETUP_SCRIPT:-$RUNTIME_DIR/host-setup.sh}"
# `jht upgrade` aggiorna anche i due file host scaricati dall'installer. Il
# wrapper non puo' fidarsi di un checkout Git (la distribuzione utente e'
# image-only), quindi la fonte e' la stessa raw release dell'installer. Chi
# prova una release di branch puo' fissarla esplicitamente con JHT_RAW_BASE.
RAW_BASE="${JHT_RAW_BASE:-https://raw.githubusercontent.com/leopu00/job-hunter-team/${JHT_BRANCH:-master}}"
WRAPPER_PATH="${JHT_WRAPPER_PATH:-$0}"

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
# Bug #15: timezone utente esplicita dal setup wizard. Default UTC se mai
# configurata — niente hardcoding geografico (l'utente potrebbe stare
# ovunque). Il container la usa via format_time skill.
JHT_USER_TZ="${JHT_USER_TZ:-UTC}"
# Export per docker compose: il compose file fa `${JHT_HOST_TYPE:-}` /
# `${JHT_LANG:-}` / `${JHT_USER_TZ:-}` substitution per passare i valori al
# container. Senza export restano variabili di shell e compose non le vede.
export JHT_HOST_TYPE
export JHT_LANG
export JHT_USER_TZ

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
    if [ "$(uname)" = "Darwin" ]; then
      err "Docker daemon non risponde. Avvialo: 'colima start' oppure 'open -a Docker' (Docker Desktop)."
    else
      err "Docker daemon non risponde. Avvialo (systemctl start docker / Docker Desktop)."
    fi
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

# ── Upgrade runtime, transazionale e host-side ────────────────────────────
#
# L'immagine del prodotto e' l'unita' di deploy: dentro /app non c'e' un
# checkout Git e un `git pull` li' sarebbe sia inefficace sia pericoloso. Il
# wrapper host possiede quindi l'intero aggiornamento: prepara compose+wrapper
# nuovi, pullla l'immagine, ricrea il container e la verifica DAVVERO prima di
# rendere persistenti i metadata host. Un journal fuori dal container conserva
# l'immagine e i file precedenti: un kill a meta' viene rollbackato al prossimo
# `jht upgrade`, mai lasciato come deploy ambiguo.

UPGRADE_JSON=0
UPGRADE_STAGE=""
UPGRADE_LOCK=""
UPGRADE_JOURNAL=""
UPGRADE_ROLLBACK_DIR=""

upgrade_safe_field() {
  # I valori arrivano da Docker e dal CLI, ma il JSON e' un contratto per la
  # GUI: non permettere mai newline/quote non attese nel frame finale.
  LC_ALL=C printf '%s' "${1:-}" | tr -cd '[:alnum:].,:_+@/-' | cut -c1-220
}

upgrade_result() {
  # ok changed phase previous-version previous-image current-version
  # current-image restart-required message rolled-back
  local ok="$1" changed="$2" phase="$3" previous_version="$4" previous_image="$5"
  local current_version="$6" current_image="$7" restart_required="$8" message="$9" rolled_back="${10}"
  previous_version="$(upgrade_safe_field "$previous_version")"
  previous_image="$(upgrade_safe_field "$previous_image")"
  current_version="$(upgrade_safe_field "$current_version")"
  current_image="$(upgrade_safe_field "$current_image")"
  if [ "$UPGRADE_JSON" = "1" ]; then
    printf '{"ok":%s,"changed":%s,"phase":"%s","previous":{"version":"%s","image":"%s"},"current":{"version":"%s","image":"%s"},"restartRequired":%s,"message":"%s","rolledBack":%s}\n' \
      "$ok" "$changed" "$phase" "$previous_version" "$previous_image" \
      "$current_version" "$current_image" "$restart_required" "$message" "$rolled_back"
  elif [ "$ok" = "true" ]; then
    printf 'Aggiornamento completato: %s (%s) -> %s (%s). %s\n' \
      "$previous_version" "$previous_image" "$current_version" "$current_image" "$message"
  else
    printf 'Aggiornamento non completato (%s): %s. %s\n' "$phase" "$message" \
      "${rolled_back:+Runtime precedente ripristinato.}" >&2
  fi
}

upgrade_note() {
  [ "$UPGRADE_JSON" = "1" ] || info "$*"
}

upgrade_run() {
  if [ "$UPGRADE_JSON" = "1" ]; then
    "$@" >/dev/null 2>&1
  else
    "$@"
  fi
}

upgrade_docker_ready() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

upgrade_compose_ready() {
  [ -f "$COMPOSE_FILE" ]
}

upgrade_compose() {
  local file="$1"
  shift
  MSYS_NO_PATHCONV=1 docker compose -f "$file" --project-directory "$RUNTIME_DIR" "$@"
}

upgrade_image() {
  docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || true
}

upgrade_version() {
  docker exec "$CONTAINER" node "$NODE_ENTRY" --version 2>/dev/null \
    | head -n 1 | tr -d '\r\n' || true
}

upgrade_verify_running() {
  local tries=20
  while [ "$tries" -gt 0 ]; do
    if container_up && [ -n "$(upgrade_version)" ]; then
      # Un PID 1 che muore appena dopo il primo exec e' un deploy rotto anche
      # se `--version` e' riuscito una volta. Richiediamo due osservazioni
      # separate prima di dichiarare sano il candidato.
      sleep 1
      if container_up && [ -n "$(upgrade_version)" ]; then
        return 0
      fi
    fi
    tries=$((tries - 1))
    sleep 0.5
  done
  return 1
}

upgrade_atomic_replace() {
  local source="$1" target="$2" mode="${3:-}"
  local parent base tmp
  parent="$(dirname "$target")"
  base="$(basename "$target")"
  tmp="$(mktemp "$parent/.${base}.upgrade.XXXXXX")" || return 1
  if ! cp "$source" "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  if [ -n "$mode" ] && ! chmod "$mode" "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  mv -f "$tmp" "$target"
}

upgrade_journal_value() {
  local key="$1"
  [ -f "$UPGRADE_JOURNAL" ] || return 0
  sed -n "s/^${key}=//p" "$UPGRADE_JOURNAL" | head -n 1
}

upgrade_write_journal() {
  local phase="$1" old_image="$2" was_running="$3"
  local tmp="${UPGRADE_JOURNAL}.tmp.$$"
  umask 077
  {
    printf 'version=1\n'
    printf 'phase=%s\n' "$phase"
    printf 'rollback_dir=%s\n' "$UPGRADE_ROLLBACK_DIR"
    printf 'old_image=%s\n' "$old_image"
    printf 'was_running=%s\n' "$was_running"
  } > "$tmp" || return 1
  mv -f "$tmp" "$UPGRADE_JOURNAL"
}

upgrade_remove_transaction() {
  rm -f "$UPGRADE_JOURNAL"
  if [ -n "$UPGRADE_ROLLBACK_DIR" ] && [ -d "$UPGRADE_ROLLBACK_DIR" ]; then
    rm -f "$UPGRADE_ROLLBACK_DIR/docker-compose.yml" "$UPGRADE_ROLLBACK_DIR/jht-wrapper.sh"
    rmdir "$UPGRADE_ROLLBACK_DIR" 2>/dev/null || true
  fi
}

upgrade_cleanup_ephemeral() {
  if [ -n "$UPGRADE_STAGE" ] && [ -d "$UPGRADE_STAGE" ]; then
    rm -rf "$UPGRADE_STAGE"
  fi
  if [ -n "$UPGRADE_LOCK" ] && [ -d "$UPGRADE_LOCK" ]; then
    rm -f "$UPGRADE_LOCK/pid"
    rmdir "$UPGRADE_LOCK" 2>/dev/null || true
  fi
}

upgrade_restore_previous() {
  # Il journal e' stato scritto PRIMA di compose up. Ripristinare prima i
  # metadata e poi l'immagine rende il retry idempotente anche se il processo
  # viene interrotto durante il rollback stesso.
  local rollback_dir runtime_real old_image was_running phase version
  rollback_dir="$(upgrade_journal_value rollback_dir)"
  old_image="$(upgrade_journal_value old_image)"
  was_running="$(upgrade_journal_value was_running)"
  phase="$(upgrade_journal_value phase)"
  version="$(upgrade_journal_value version)"
  # Journal assente/corrotto non deve mai trasformarsi in un path arbitrario
  # da sovrascrivere: il solo rollback ammesso e' quello creato da questo
  # wrapper sotto la sua runtime directory. Normalizzare PRIMA del controllo
  # impedisce anche `.upgrade-rollback-x/../../qualcosa` e symlink esterni.
  runtime_real="$(cd -P "$RUNTIME_DIR" 2>/dev/null && pwd -P)" || return 1
  rollback_dir="$(cd -P "$rollback_dir" 2>/dev/null && pwd -P)" || return 1
  case "$rollback_dir" in
    "$runtime_real"/.upgrade-rollback-*) ;;
    *) return 1 ;;
  esac
  [ "$version" = "1" ] || return 1
  case "$phase" in prepared|pulled|candidate_started|metadata_committed) ;; *) return 1 ;; esac
  case "$was_running" in 0|1) ;; *) return 1 ;; esac
  if [ "$was_running" = "1" ]; then
    printf '%s' "$old_image" | grep -Eq '^sha256:[A-Za-z0-9]+$' || return 1
  elif [ "$old_image" != "none" ]; then
    return 1
  fi
  [ -n "$rollback_dir" ] && [ -d "$rollback_dir" ] || return 1
  [ -f "$rollback_dir/docker-compose.yml" ] || return 1
  [ -f "$rollback_dir/jht-wrapper.sh" ] || return 1
  upgrade_atomic_replace "$rollback_dir/docker-compose.yml" "$COMPOSE_FILE" || return 1
  upgrade_atomic_replace "$rollback_dir/jht-wrapper.sh" "$WRAPPER_PATH" 755 || return 1

  if [ "$was_running" = "1" ]; then
    [ -n "$old_image" ] || return 1
    if ! JHT_IMAGE="$old_image" upgrade_run upgrade_compose "$COMPOSE_FILE" up -d --force-recreate "$CONTAINER"; then
      return 1
    fi
    upgrade_verify_running || return 1
  else
    # Prima non c'era un runtime attivo: un candidato fallito non deve restare
    # come container morto che l'utente scambia per un'installazione sana.
    upgrade_run upgrade_compose "$COMPOSE_FILE" rm -sf "$CONTAINER" || return 1
  fi
  UPGRADE_ROLLBACK_DIR="$rollback_dir"
  upgrade_remove_transaction
  return 0
}

upgrade_recover_if_needed() {
  [ -f "$UPGRADE_JOURNAL" ] || return 0
  upgrade_note "Rilevato upgrade interrotto: ripristino l'ultima versione verificata..."
  upgrade_restore_previous
}

upgrade_acquire_lock() {
  UPGRADE_LOCK="$RUNTIME_DIR/.upgrade.lock"
  if mkdir "$UPGRADE_LOCK" 2>/dev/null; then
    printf '%s\n' "$$" > "$UPGRADE_LOCK/pid"
    return 0
  fi
  local holder=""
  [ -f "$UPGRADE_LOCK/pid" ] && holder="$(cat "$UPGRADE_LOCK/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && kill -0 "$holder" 2>/dev/null; then
    return 1
  fi
  # Un kill -9 lascia solo la nostra directory lock. Non usare rm -rf: se il
  # contenuto non e' esattamente il lock conosciuto, fallire e' piu' sicuro.
  rm -f "$UPGRADE_LOCK/pid"
  rmdir "$UPGRADE_LOCK" 2>/dev/null || return 1
  mkdir "$UPGRADE_LOCK" || return 1
  printf '%s\n' "$$" > "$UPGRADE_LOCK/pid"
}

handle_runtime_upgrade() {
  local check_only=0 old_image old_version candidate_image candidate_version candidate_ref
  local was_running=0 changed=false rolled_back=false phase="preflight"
  local candidate_compose candidate_wrapper metadata_changed=false
  for arg in "$@"; do
    case "$arg" in
      --json) UPGRADE_JSON=1 ;;
      --check) check_only=1 ;;
      --apply) ;; # compatibilita' con il vecchio contratto CLI
      *)
        upgrade_result false false preflight unknown none unknown none false "Opzione upgrade non supportata" false
        return 2
        ;;
    esac
  done

  if ! upgrade_acquire_lock; then
    upgrade_result false false preflight unknown none unknown none false "Un aggiornamento e gia in corso" false
    return 1
  fi
  UPGRADE_JOURNAL="$RUNTIME_DIR/.upgrade-journal"
  trap upgrade_cleanup_ephemeral EXIT INT TERM

  if ! upgrade_docker_ready; then
    upgrade_result false false preflight unknown none unknown none false "Docker non e disponibile" false
    return 1
  fi
  if ! upgrade_compose_ready; then
    upgrade_result false false preflight unknown none unknown none false "Runtime compose non disponibile" false
    return 1
  fi
  # Stesso preflight di `jht up`: su VPS installate da root l'immagine nuova
  # deve poter riaprire i bind mount al primo boot, non solo il container che
  # era gia' in vita prima dell'upgrade.
  ensure_bind_owner
  if ! upgrade_recover_if_needed; then
    upgrade_result false false recovery unknown none unknown none false "Recovery dell upgrade precedente non riuscita" false
    return 1
  fi
  if [ ! -f "$WRAPPER_PATH" ]; then
    upgrade_result false false preflight unknown none unknown none false "Wrapper host non leggibile" false
    return 1
  fi

  if container_up; then
    was_running=1
    old_image="$(upgrade_image)"
    old_version="$(upgrade_version)"
  else
    old_image=""
    old_version="non-installata"
  fi
  old_image="${old_image:-none}"
  old_version="${old_version:-sconosciuta}"

  UPGRADE_STAGE="$(mktemp -d "$RUNTIME_DIR/.upgrade-stage.XXXXXX")" || {
    upgrade_result false false preflight "$old_version" "$old_image" "$old_version" "$old_image" false "Spazio temporaneo non disponibile" false
    return 1
  }
  candidate_compose="$UPGRADE_STAGE/docker-compose.yml"
  candidate_wrapper="$UPGRADE_STAGE/jht-wrapper.sh"
  upgrade_note "Scarico runtime aggiornato..."
  if ! upgrade_run curl -fsSL "${RAW_BASE%/}/docker-compose.yml" -o "$candidate_compose" \
      || ! upgrade_run curl -fsSL "${RAW_BASE%/}/scripts/jht-wrapper.sh" -o "$candidate_wrapper" \
      || ! bash -n "$candidate_wrapper" \
      || ! upgrade_run upgrade_compose "$candidate_compose" config -q; then
    upgrade_result false false preflight "$old_version" "$old_image" "$old_version" "$old_image" false "Runtime remoto non valido o non raggiungibile" false
    return 1
  fi
  if ! cmp -s "$candidate_compose" "$COMPOSE_FILE" || ! cmp -s "$candidate_wrapper" "$WRAPPER_PATH"; then
    metadata_changed=true
  fi

  UPGRADE_ROLLBACK_DIR="$RUNTIME_DIR/.upgrade-rollback-$(date +%s)-$$"
  if ! mkdir "$UPGRADE_ROLLBACK_DIR" \
      || ! cp "$COMPOSE_FILE" "$UPGRADE_ROLLBACK_DIR/docker-compose.yml" \
      || ! cp "$WRAPPER_PATH" "$UPGRADE_ROLLBACK_DIR/jht-wrapper.sh" \
      || ! upgrade_write_journal prepared "$old_image" "$was_running"; then
    upgrade_remove_transaction
    upgrade_result false false preflight "$old_version" "$old_image" "$old_version" "$old_image" false "Impossibile preparare il rollback" false
    return 1
  fi

  phase="pull"
  upgrade_note "Scarico l immagine piu recente..."
  if ! upgrade_run upgrade_compose "$candidate_compose" pull "$CONTAINER"; then
    upgrade_remove_transaction
    upgrade_result false false pull "$old_version" "$old_image" "$old_version" "$old_image" false "Download immagine non riuscito" false
    return 1
  fi
  # Il compose nuovo e' la fonte di verita': non assumere che l'immagine
  # resti per sempre latest o che un override JHT_IMAGE punti allo stesso ref.
  candidate_ref="$(upgrade_compose "$candidate_compose" config --images 2>/dev/null | head -n 1)"
  candidate_image="$(docker image inspect "${candidate_ref:-${JHT_IMAGE:-ghcr.io/leopu00/jht:latest}}" --format '{{.Id}}' 2>/dev/null || true)"
  candidate_image="${candidate_image:-sconosciuta}"
  upgrade_write_journal pulled "$old_image" "$was_running" || {
    upgrade_result false false pull "$old_version" "$old_image" "$old_version" "$old_image" false "Impossibile aggiornare il journal" false
    return 1
  }

  if [ "$check_only" = "1" ]; then
    upgrade_remove_transaction
    if [ "$candidate_image" = "$old_image" ]; then
      changed=false
    else
      changed=true
    fi
    upgrade_result true "$changed" check "$old_version" "$old_image" "$old_version" "$candidate_image" "$changed" "Controllo completato; nessuna modifica al runtime" false
    return 0
  fi

  phase="activate"
  upgrade_note "Attivo il nuovo runtime..."
  if ! upgrade_run upgrade_compose "$candidate_compose" up -d --force-recreate "$CONTAINER"; then
    if upgrade_restore_previous; then rolled_back=true; fi
    upgrade_result false false activate "$old_version" "$old_image" "$old_version" "$old_image" false "Avvio della nuova versione fallito" "$rolled_back"
    return 1
  fi
  upgrade_write_journal candidate_started "$old_image" "$was_running" || {
    if upgrade_restore_previous; then rolled_back=true; fi
    upgrade_result false false activate "$old_version" "$old_image" "$old_version" "$old_image" false "Journal non persistito dopo avvio" "$rolled_back"
    return 1
  }

  phase="verify"
  upgrade_note "Verifico il runtime aggiornato..."
  if ! upgrade_verify_running; then
    if upgrade_restore_previous; then rolled_back=true; fi
    upgrade_result false false verify "$old_version" "$old_image" "$old_version" "$old_image" false "Il nuovo runtime non ha superato la verifica" "$rolled_back"
    return 1
  fi
  candidate_version="$(upgrade_version)"
  candidate_version="${candidate_version:-sconosciuta}"

  phase="commit"
  if ! upgrade_atomic_replace "$candidate_compose" "$COMPOSE_FILE" \
      || ! upgrade_atomic_replace "$candidate_wrapper" "$WRAPPER_PATH" 755 \
      || ! upgrade_write_journal metadata_committed "$old_image" "$was_running"; then
    if upgrade_restore_previous; then rolled_back=true; fi
    upgrade_result false false commit "$old_version" "$old_image" "$old_version" "$old_image" false "Metadata runtime non persistiti" "$rolled_back"
    return 1
  fi

  upgrade_remove_transaction
  if [ "$candidate_image" = "$old_image" ] && [ "$metadata_changed" = "false" ]; then
    changed=false
  else
    changed=true
  fi
  upgrade_result true "$changed" complete "$old_version" "$old_image" "$candidate_version" "$candidate_image" false "Nuova versione attiva e verificata" false
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
    handle_runtime_upgrade "${@:2}"
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
  oauth-login|claude-login)
    require_docker
    require_compose_file
    ensure_up
    provider="$(docker exec "$CONTAINER" node -e \
      "try{const c=require('/jht_home/jht.config.json');process.stdout.write(String(c.active_provider||''))}catch{}" \
      2>/dev/null || true)"
    provider_lc="$(printf '%s' "$provider" | tr '[:upper:]' '[:lower:]')"
    case "$provider_lc" in
      openai|codex)
        docker exec $EXEC_FLAGS "$CONTAINER" codex login --device-auth
        ;;
      kimi|moonshot)
        docker exec $EXEC_FLAGS "$CONTAINER" kimi --yolo
        ;;
      claude|anthropic|'')
        docker exec $EXEC_FLAGS "$CONTAINER" claude --dangerously-skip-permissions
        ;;
      *)
        die "provider attivo non riconosciuto: $provider"
        ;;
    esac
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

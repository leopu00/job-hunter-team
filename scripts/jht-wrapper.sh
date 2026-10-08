#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  jht — host-side dispatcher                                              ║
# ╠══════════════════════════════════════════════════════════════════════════╣
# ║                                                                          ║
# ║  Wrapper Bash sottile che instrada i comandi:                            ║
# ║                                                                          ║
# ║    LIFECYCLE   → docker compose / docker logs / docker inspect           ║
# ║    OPERATIVITA → docker exec -it <ID> node /app/cli/bin/main.js <args>   ║
# ║                                                                          ║
# ║  Niente Node, Python o tmux sull'host. Niente socket Docker dentro al    ║
# ║  container. Il CLI Node gira nel container long-running `jht` e ci       ║
# ║  parla via `docker exec`.                                                ║
# ║                                                                          ║
# ║  Auto-up: se il container `jht` non e' attivo quando l'utente lancia un  ║
# ║  comando di operativita', lo si avvia automaticamente via compose.       ║
# ║                                                                          ║
# ║  Override via env:                                                       ║
# ║    JHT_RUNTIME_DIR=$HOME/.local/share/job-hunter-team/host-runtime       ║
# ║    JHT_COMPOSE_FILE=$JHT_RUNTIME_DIR/docker-compose.yml                  ║
# ║                                                                          ║
# ║  Riferimento design: docs/internal/ops/vps.md    ║
# ╚══════════════════════════════════════════════════════════════════════════╝

set -euo pipefail

# Capacita' letta dal client desktop prima di fidarsi del contratto
# `upgrade --check --json`. I wrapper storici che non la espongono possono
# trattare quei flag come un apply: il client deve allora avviare una copia
# temporanea del wrapper production, con JHT_WRAPPER_PATH ancorato all'host.
JHT_UPGRADE_PROTOCOL=1
JHT_HOST_RUNTIME_PROTOCOL=1
JHT_DESKTOP_CHAT_PROTOCOL=1
JHT_ONBOARDING_SNAPSHOT_PROTOCOL=1

# Sistema e utente non cambiano durante una run: si leggono una volta sola. I
# controlli d'integrita' del runtime (runtime_stat, runtime_node_safe) li
# chiedevano per ogni file: un `uname` e un `id` a ogni stat, centinaia di
# processi in un solo `jht upgrade`.
HOST_KERNEL="$(uname -s)"
HOST_UID="$(id -u)"

CONTAINER_SERVICE="jht"
# I servizi del compose: agenti e i due servizi isolati.
COMPOSE_SERVICES="jht jht-broker jht-telegram"
ATTESTED_CONTAINER_ID=""
if [ -n "${JHT_RUNTIME_DIR:-}" ]; then
  RUNTIME_DIR="$JHT_RUNTIME_DIR"
elif [ "$(uname -s)" = "Darwin" ]; then
  RUNTIME_DIR="$HOME/Library/Application Support/Job Hunter Team/host-runtime"
else
  RUNTIME_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/job-hunter-team/host-runtime"
fi
COMPOSE_FILE="${JHT_COMPOSE_FILE:-$RUNTIME_DIR/docker-compose.yml}"
NODE_ENTRY="${JHT_NODE_ENTRY:-/app/cli/bin/jht.js}"
HOST_SETUP_SCRIPT="${JHT_HOST_SETUP_SCRIPT:-$RUNTIME_DIR/host-setup.sh}"
RUNTIME_MANIFEST="$RUNTIME_DIR/.runtime-integrity"
# `jht upgrade` aggiorna anche i due file host scaricati dall'installer. Il
# wrapper non puo' fidarsi di un checkout Git (la distribuzione utente e'
# image-only), quindi la fonte e' la stessa raw release dell'installer. Chi
# prova una release di branch puo' fissarla esplicitamente con JHT_RAW_BASE.
RAW_BASE_OVERRIDE="${JHT_RAW_BASE:-}"
RELEASE_REF="${JHT_BRANCH:-production}"
WRAPPER_PATH="${JHT_WRAPPER_PATH:-$0}"
WRAPPER_DIR="$(cd -P "$(dirname "$WRAPPER_PATH")" 2>/dev/null && pwd -P)"
RUNTIME_SELECTION_FILE="$RUNTIME_DIR/container-runtime"
PODMAN_MACHINE_FILE="$RUNTIME_DIR/podman-machine"
PODMAN_ADAPTER_BIN="$RUNTIME_DIR/bin"
DOCKER_SHIM="${JHT_DOCKER_SHIM:-$PODMAN_ADAPTER_BIN/docker}"
if [ -n "${JHT_CONTAINER_RUNTIME:-}" ]; then
  CONTAINER_RUNTIME="$(printf '%s' "$JHT_CONTAINER_RUNTIME" | tr '[:upper:]' '[:lower:]')"
elif [ -f "$RUNTIME_SELECTION_FILE" ]; then
  CONTAINER_RUNTIME="$(tr -d '\r\n' < "$RUNTIME_SELECTION_FILE" | tr '[:upper:]' '[:lower:]')"
else
  CONTAINER_RUNTIME="docker"
fi
case "$CONTAINER_RUNTIME" in docker|podman) ;; *) err_runtime="unsupported container runtime: $CONTAINER_RUNTIME" ;; esac
PODMAN_MACHINE_OVERRIDE="${JHT_PODMAN_MACHINE:-}"
PODMAN_MACHINE_NAME=""
if [ -f "$PODMAN_MACHINE_FILE" ]; then
  PODMAN_MACHINE_NAME="$(tr -d '\r\n' < "$PODMAN_MACHINE_FILE")"
fi
if [ "$CONTAINER_RUNTIME" = "podman" ]; then
  case "$PODMAN_MACHINE_NAME" in
    ''|*[!A-Za-z0-9_.-]*) err_runtime="invalid attested Podman machine" ;;
  esac
  if [ -n "$PODMAN_MACHINE_OVERRIDE" ] \
      && [ "$PODMAN_MACHINE_OVERRIDE" != "$PODMAN_MACHINE_NAME" ]; then
    err_runtime="Podman machine override does not match the attested runtime"
  fi
  export PATH="$PODMAN_ADAPTER_BIN:$PATH"
  unset CONTAINER_CONNECTION
  export PODMAN_COMPOSE_WARNING_LOGS=false
  if command -v podman-compose >/dev/null 2>&1; then
    export PODMAN_COMPOSE_PROVIDER="$(command -v podman-compose)"
  fi
fi
DEFAULT_RUNTIME_IMAGE="ghcr.io/leopu00/jht@sha256:07b154bee43f32d2e6313c54f28e389836556e2b5cbe1b76d03398684c38b598"
DEFAULT_RUNTIME_VERSION="0.4.0"
GAME_EXECUTABLE_OVERRIDE="${JHT_GAME_EXECUTABLE:-}"
if [ -n "${JHT_GAME_CONTROL_DIR:-}" ]; then
  GAME_CONTROL_DIR="$JHT_GAME_CONTROL_DIR"
elif [ "$(uname -s)" = "Darwin" ]; then
  GAME_CONTROL_DIR="$HOME/Library/Application Support/Godot/app_userdata/Job Hunter Team/client"
else
  GAME_CONTROL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/godot/app_userdata/Job Hunter Team/client"
fi

# Legge una singola chiave dal file host.env come DATI, mai come shell.
#
# ~/.jht e' montata read-write nel container, quindi host.env non attraversa
# un confine di fiducia: un processo nel container puo' modificarlo. Fare
# `source` di quel file trasformerebbe la scrittura nel bind mount in
# esecuzione di comandi sull'host al successivo `jht`. Il parser accetta solo
# le tre chiavi prodotte da host-setup.sh e valida i rispettivi domini.
jht_host_env_value_valid() {
  local key="$1" value="$2"
  case "$key" in
    JHT_HOST_TYPE)
      case "$value" in local|vps) return 0 ;; esac
      ;;
    JHT_LANG)
      case "$value" in en|it|hu|es|de|fr|pt) return 0 ;; esac
      ;;
    JHT_USER_TZ)
      # IANA timezone: UTC oppure segmenti composti da caratteri portabili.
      # Niente spazi o metacaratteri shell; host-setup fa la validazione
      # semantica completa con zoneinfo quando riceve il valore dall'utente.
      case "$value" in
        ''|*[!A-Za-z0-9_+./-]*) return 1 ;;
        *) return 0 ;;
      esac
      ;;
  esac
  return 1
}

jht_read_host_env_value() {
  local file="$1" requested="$2" line key value result=""
  local found=1
  [ -f "$file" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ ^[[:space:]]*(JHT_HOST_TYPE|JHT_LANG|JHT_USER_TZ)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      case "$value" in
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
      esac
      if [ "$key" = "$requested" ] && jht_host_env_value_valid "$key" "$value"; then
        result="$value"
        found=0
      fi
    fi
  done < "$file"
  [ "$found" -eq 0 ] || return 1
  printf '%s' "$result"
}

# Carica la host env scritta da host-setup.sh. Il wizard Node usa
# JHT_HOST_TYPE per attivare gli step obbligatori sul path VPS, e pid1 lo usa
# per scegliere il runtime. Le assegnazioni esplicite preservano il contratto
# storico senza eseguire il contenuto del file.
HOST_ENV_FILE="${JHT_HOST_ENV_FILE:-$HOME/.jht/host.env}"
if host_env_value="$(jht_read_host_env_value "$HOST_ENV_FILE" JHT_HOST_TYPE)"; then
  JHT_HOST_TYPE="$host_env_value"
fi
if host_env_value="$(jht_read_host_env_value "$HOST_ENV_FILE" JHT_LANG)"; then
  JHT_LANG="$host_env_value"
fi
if host_env_value="$(jht_read_host_env_value "$HOST_ENV_FILE" JHT_USER_TZ)"; then
  JHT_USER_TZ="$host_env_value"
fi
unset host_env_value
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

runtime_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

attested_raw_base() {
  # An explicit override is a host-authorized test/private mirror. The
  # production path resolves its moving ref to an immutable Git commit before
  # downloading any byte that Bash or Docker will interpret.
  if [ -n "$RAW_BASE_OVERRIDE" ]; then
    printf '%s\n' "${RAW_BASE_OVERRIDE%/}"
    return 0
  fi
  local metadata sha
  metadata="$(curl -fsSL "https://api.github.com/repos/leopu00/job-hunter-team/commits/$RELEASE_REF")" \
    || return 1
  sha="$(printf '%s\n' "$metadata" \
    | sed -n 's/^[[:space:]]*"sha": "\([0-9a-fA-F]\{40\}\)".*/\1/p' \
    | head -n 1)"
  printf '%s' "$sha" | grep -Eq '^[0-9a-fA-F]{40}$' || return 1
  printf 'https://raw.githubusercontent.com/leopu00/job-hunter-team/%s\n' "$sha"
}

runtime_stat() {
  if [ "$HOST_KERNEL" = "Darwin" ]; then
    stat -f '%u %Lp' "$1" 2>/dev/null
  else
    stat -c '%u %a' "$1" 2>/dev/null
  fi
}

runtime_node_safe() {
  local path="$1" kind="$2" metadata owner mode mode_num
  [ ! -L "$path" ] || return 1
  case "$kind" in dir) [ -d "$path" ] ;; file) [ -f "$path" ] ;; esac || return 1
  metadata="$(runtime_stat "$path")" || return 1
  owner="${metadata%% *}"
  mode="${metadata#* }"
  [ "$owner" = "$HOST_UID" ] || return 1
  mode_num=$((8#$mode))
  [ $((mode_num & 0022)) -eq 0 ]
}

runtime_manifest_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$RUNTIME_MANIFEST" 2>/dev/null | head -n 1
}

runtime_write_manifest() {
  local tmp="${RUNTIME_MANIFEST}.tmp.$$"
  umask 077
  {
    printf 'version=1\n'
    printf 'docker-compose.yml=%s\n' "$(runtime_sha256 "$COMPOSE_FILE")"
    printf 'host-setup.sh=%s\n' "$(runtime_sha256 "$HOST_SETUP_SCRIPT")"
    printf 'jht-wrapper.sh=%s\n' "$(runtime_sha256 "$WRAPPER_PATH")"
    if [ -f "$RUNTIME_SELECTION_FILE" ]; then
      printf 'container-runtime=%s\n' "$(runtime_sha256 "$RUNTIME_SELECTION_FILE")"
    fi
    if [ "$CONTAINER_RUNTIME" = "podman" ]; then
      printf 'podman-machine=%s\n' "$(runtime_sha256 "$PODMAN_MACHINE_FILE")"
      printf 'docker-shim=%s\n' "$(runtime_sha256 "$DOCKER_SHIM")"
    fi
  } > "$tmp" || return 1
  chmod 600 "$tmp" || { rm -f "$tmp"; return 1; }
  mv -f "$tmp" "$RUNTIME_MANIFEST"
}

runtime_path_allowed() {
  local runtime_real runtime_declared wrapper_real bind_real docs_real shim_real
  runtime_real="$(cd -P "$RUNTIME_DIR" 2>/dev/null && pwd -P)" || return 1
  runtime_declared="${RUNTIME_DIR%/}"
  case "$runtime_declared$COMPOSE_FILE" in
    *'|'*|*$'\n'*|*$'\r'*) return 1 ;;
  esac
  # Rifiuta anche symlink in qualunque antenato: il path dichiarato deve gia'
  # essere il path fisico canonico consumato dal daemon host.
  [ "$runtime_real" = "$runtime_declared" ] || return 1
  bind_real="$(cd -P "$HOME/.jht" 2>/dev/null && pwd -P)" || bind_real="$HOME/.jht"
  docs_real="$(cd -P "$HOME/Documents/Job Hunter Team" 2>/dev/null && pwd -P)" \
    || docs_real="$HOME/Documents/Job Hunter Team"
  case "$runtime_real/" in "$bind_real/"*|"$docs_real/"*) return 1 ;; esac
  [ "$COMPOSE_FILE" = "$RUNTIME_DIR/docker-compose.yml" ] || return 1
  [ "$HOST_SETUP_SCRIPT" = "$RUNTIME_DIR/host-setup.sh" ] || return 1
  [ "$RUNTIME_SELECTION_FILE" = "$RUNTIME_DIR/container-runtime" ] || return 1
  [ "$PODMAN_MACHINE_FILE" = "$RUNTIME_DIR/podman-machine" ] || return 1
  wrapper_real="$(cd -P "$(dirname "$WRAPPER_PATH")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename "$WRAPPER_PATH")")" || return 1
  [ "$wrapper_real" = "$WRAPPER_PATH" ] || return 1
  case "$wrapper_real" in "$bind_real"/*|"$docs_real"/*) return 1 ;; esac
  if [ "$CONTAINER_RUNTIME" = "podman" ]; then
    shim_real="$(cd -P "$(dirname "$DOCKER_SHIM")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename "$DOCKER_SHIM")")" || return 1
    [ "$shim_real" = "$DOCKER_SHIM" ] || return 1
    [ "$(dirname "$shim_real")" = "$RUNTIME_DIR/bin" ] || return 1
  fi
}

runtime_bundle_trusted() {
  [ -z "${err_runtime:-}" ] || return 1
  runtime_path_allowed || return 1
  runtime_node_safe "$RUNTIME_DIR" dir || return 1
  runtime_node_safe "$COMPOSE_FILE" file || return 1
  runtime_node_safe "$HOST_SETUP_SCRIPT" file || return 1
  runtime_node_safe "$WRAPPER_PATH" file || return 1
  runtime_node_safe "$RUNTIME_MANIFEST" file || return 1
  [ "$(runtime_manifest_value version)" = "1" ] || return 1
  [ "$(runtime_manifest_value docker-compose.yml)" = "$(runtime_sha256 "$COMPOSE_FILE")" ] || return 1
  [ "$(runtime_manifest_value host-setup.sh)" = "$(runtime_sha256 "$HOST_SETUP_SCRIPT")" ] || return 1
  [ "$(runtime_manifest_value jht-wrapper.sh)" = "$(runtime_sha256 "$WRAPPER_PATH")" ] || return 1
  if [ -f "$RUNTIME_SELECTION_FILE" ]; then
    runtime_node_safe "$RUNTIME_SELECTION_FILE" file || return 1
    case "$(tr -d '\r\n' < "$RUNTIME_SELECTION_FILE")" in docker|podman) ;; *) return 1 ;; esac
    [ "$(runtime_manifest_value container-runtime)" = "$(runtime_sha256 "$RUNTIME_SELECTION_FILE")" ] || return 1
  elif [ "$CONTAINER_RUNTIME" = "podman" ]; then
    return 1
  fi
  if [ "$CONTAINER_RUNTIME" = "podman" ]; then
    runtime_node_safe "$PODMAN_MACHINE_FILE" file || return 1
    runtime_node_safe "$DOCKER_SHIM" file || return 1
    [ "$(tr -d '\r\n' < "$RUNTIME_SELECTION_FILE")" = "podman" ] || return 1
    case "$(tr -d '\r\n' < "$PODMAN_MACHINE_FILE")" in
      ''|*[!A-Za-z0-9_.-]*) return 1 ;;
    esac
    [ "$(runtime_manifest_value podman-machine)" = "$(runtime_sha256 "$PODMAN_MACHINE_FILE")" ] || return 1
    [ "$(runtime_manifest_value docker-shim)" = "$(runtime_sha256 "$DOCKER_SHIM")" ] || return 1
    grep -Fqx '# JHT_PODMAN_DOCKER_SHIM=1' "$DOCKER_SHIM" || return 1
  fi
  grep -Fqx 'JHT_HOST_RUNTIME_PROTOCOL=1' "$WRAPPER_PATH" || return 1
  grep -Fqx 'JHT_HOST_SETUP_PROTOCOL=1' "$HOST_SETUP_SCRIPT" || return 1
  grep -Eq '^[[:space:]]*-[[:space:]]*jht-runtime-mask:/jht_home/runtime([[:space:]]|$)' "$COMPOSE_FILE" || return 1
}

runtime_bootstrap_release() {
  # Legacy ~/.jht/runtime is deliberately never read or copied. A missing
  # authority is rebuilt only from the selected release origin into a new
  # host-owned directory, then atomically published with its digest manifest.
  local stage release_base migrate_wrapper=0 wrapper_publish
  [ ! -e "$RUNTIME_DIR" ] && [ ! -L "$RUNTIME_DIR" ] || return 1
  umask 077
  mkdir -p "$RUNTIME_DIR" || return 1
  chmod 700 "$RUNTIME_DIR" || return 1
  runtime_path_allowed || { rmdir "$RUNTIME_DIR" 2>/dev/null || true; return 1; }
  stage="$(mktemp -d "$RUNTIME_DIR/.bootstrap.XXXXXX")" || return 1
  release_base="$(attested_raw_base)" || {
    rmdir "$stage" 2>/dev/null || true
    rmdir "$RUNTIME_DIR" 2>/dev/null || true
    return 1
  }
  if ! curl -fsSL "${release_base%/}/docker-compose.yml" -o "$stage/docker-compose.yml" \
      || ! curl -fsSL "${release_base%/}/scripts/host-setup.sh" -o "$stage/host-setup.sh" \
      || ! bash -n "$stage/host-setup.sh" \
      || ! grep -Fqx 'JHT_HOST_SETUP_PROTOCOL=1' "$stage/host-setup.sh" \
      || ! grep -Eq '^[[:space:]]*-[[:space:]]*jht-runtime-mask:/jht_home/runtime([[:space:]]|$)' "$stage/docker-compose.yml"; then
    rm -f "$stage/docker-compose.yml" "$stage/host-setup.sh"
    rmdir "$stage" 2>/dev/null || true
    rmdir "$RUNTIME_DIR" 2>/dev/null || true
    return 1
  fi
  if ! grep -Fqx 'JHT_HOST_RUNTIME_PROTOCOL=1' "$WRAPPER_PATH"; then
    if [ "${JHT_ALLOW_LEGACY_WRAPPER_MIGRATION:-0}" != "1" ] \
        || ! curl -fsSL "${release_base%/}/scripts/jht-wrapper.sh" -o "$stage/jht-wrapper.sh" \
        || ! bash -n "$stage/jht-wrapper.sh" \
        || ! grep -Fqx 'JHT_HOST_RUNTIME_PROTOCOL=1' "$stage/jht-wrapper.sh"; then
      rm -f "$stage/docker-compose.yml" "$stage/host-setup.sh" "$stage/jht-wrapper.sh"
      rmdir "$stage" 2>/dev/null || true
      rmdir "$RUNTIME_DIR" 2>/dev/null || true
      return 1
    fi
    migrate_wrapper=1
  fi
  chmod 600 "$stage/docker-compose.yml"
  chmod 700 "$stage/host-setup.sh"
  if [ "$migrate_wrapper" -eq 1 ]; then
    wrapper_publish="$(mktemp "$(dirname "$WRAPPER_PATH")/.jht-wrapper.XXXXXX")" || wrapper_publish=""
    if [ -z "$wrapper_publish" ] \
        || ! cp "$stage/jht-wrapper.sh" "$wrapper_publish" \
        || ! chmod 700 "$wrapper_publish" \
        || ! mv -f "$wrapper_publish" "$WRAPPER_PATH"; then
      [ -z "$wrapper_publish" ] || rm -f "$wrapper_publish"
      rm -f "$stage/docker-compose.yml" "$stage/host-setup.sh" "$stage/jht-wrapper.sh"
      rmdir "$stage" 2>/dev/null || true
      rmdir "$RUNTIME_DIR" 2>/dev/null || true
      return 1
    fi
    rm -f "$stage/jht-wrapper.sh"
  fi
  if ! { mv "$stage/docker-compose.yml" "$COMPOSE_FILE" \
      && mv "$stage/host-setup.sh" "$HOST_SETUP_SCRIPT" \
      && rmdir "$stage" \
      && runtime_write_manifest \
      && runtime_bundle_trusted; }; then
    rm -f "$stage/docker-compose.yml" "$stage/host-setup.sh" "$stage/jht-wrapper.sh" \
      "$COMPOSE_FILE" "$HOST_SETUP_SCRIPT" "$RUNTIME_MANIFEST"
    rmdir "$stage" 2>/dev/null || true
    rmdir "$RUNTIME_DIR" 2>/dev/null || true
    return 1
  fi
}

require_trusted_runtime() {
  if [ ! -e "$RUNTIME_DIR" ]; then
    runtime_bootstrap_release || {
      err "runtime host protetto non installabile; il legacy ~/.jht/runtime non viene usato"
      return 1
    }
  fi
  runtime_bundle_trusted || {
    err "runtime host non attendibile (path, owner, permessi o SHA-256)"
    return 1
  }
}

# ── Verifiche pre-flight ──────────────────────────────────────────────────
require_docker() {
  if [ -n "${err_runtime:-}" ]; then
    err "$err_runtime"
    exit 1
  fi
  if ! command -v docker >/dev/null 2>&1; then
    err "client container non trovato nel PATH. Ripara il runtime JHT."
    exit 127
  fi
  require_confined_podman_machine
  if ! docker info >/dev/null 2>&1; then
    if [ "$CONTAINER_RUNTIME" = "podman" ]; then
      err "Podman machine JHT non attiva. Esegui 'jht up' per avviarla."
    elif [ "$(uname)" = "Darwin" ]; then
      err "Docker daemon non risponde. Avvialo: 'colima start' oppure 'open -a Docker' (Docker Desktop)."
    else
      err "Docker daemon non risponde. Avvialo (systemctl start docker / Docker Desktop)."
    fi
    exit 1
  fi
}

# Unico ingresso che puo' accendere la machine Podman. Deve restare chiamato
# esclusivamente dall'arm esplicito `up`; tutti i probe e gli altri comandi
# usano require_docker, che e' rigorosamente osservativo.
wake_container_runtime_for_up() {
  if [ -n "${err_runtime:-}" ]; then
    err "$err_runtime"
    exit 1
  fi
  if ! command -v docker >/dev/null 2>&1; then
    err "client container non trovato nel PATH. Ripara il runtime JHT."
    exit 127
  fi
  require_confined_podman_machine
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  if [ "$CONTAINER_RUNTIME" = "podman" ]; then
    local podman_bin
    podman_bin="$(podman_binary)" || podman_bin=""
    [ -n "$podman_bin" ] || { err "Podman non trovato: reinstalla il runtime JHT."; exit 127; }
    ensure_podman_mount_dirs \
      || { err "Non riesco a creare ~/.jht o ~/Documents/Job Hunter Team per la macchina Podman."; exit 1; }
    info "Podman machine '$PODMAN_MACHINE_NAME' non attiva, la avvio..."
    "$podman_bin" machine start --update-connection=false "$PODMAN_MACHINE_NAME" >/dev/null \
      || { err "Podman machine non avviabile; Colima non e' stato modificato."; exit 1; }
  elif [ "$(uname)" = "Darwin" ]; then
    err "Docker daemon non risponde. Avvialo: 'colima start' oppure 'open -a Docker' (Docker Desktop)."
    exit 1
  else
    err "Docker daemon non risponde. Avvialo (systemctl start docker / Docker Desktop)."
    exit 1
  fi
  docker info >/dev/null 2>&1 \
    || { err "Podman machine avviata ma il client JHT non risponde."; exit 1; }
}

# `podman-machine-recreate --confirm` deve leggere lo stato del broker prima
# di cancellare la VM. E' l'unico mutatore, oltre a `up`, autorizzato ad
# accendere una machine spenta; status, GUI e probe restano osservativi.
start_podman_for_recreate() {
  local podman_bin="$1"
  if "$podman_bin" --connection "$PODMAN_MACHINE_NAME" info >/dev/null 2>&1; then
    return 0
  fi
  "$podman_bin" machine start --update-connection=false "$PODMAN_MACHINE_NAME" >/dev/null \
    || { err "Non riesco ad avviare la macchina Podman per salvare lo stato del broker."; return 1; }
}

# ── Cartelle del Mac visibili alla machine Podman di JHT ─────────────────
# Le sole due che il compose monta. Senza --volume, `podman machine init` su
# macOS monta /Users (le home di tutti gli utenti), /private, /var/folders e
# ~/.config/containers (misurato il 08/10/2026): la VM, e un container con un
# bind sbagliato, vedrebbero tutto il Mac. Una machine che monta altro non si
# usa; `jht podman-machine-recreate --confirm` la ricrea confinata.
PODMAN_MOUNT_JHT_HOME="$HOME/.jht"
PODMAN_MOUNT_JHT_DOCS="$HOME/Documents/Job Hunter Team"
PODMAN_MOUNTS_EXIT=78

# I file di configurazione della machine (uno per provider: applehv, libkrun),
# letti senza chiamare podman: il probe resta osservativo e non accende nulla.
podman_machine_config_files() {
  local config_root="${XDG_CONFIG_HOME:-$HOME/.config}/containers/podman/machine"
  local file found=0
  for file in "$config_root"/*/"$PODMAN_MACHINE_NAME.json"; do
    [ -f "$file" ] || continue
    printf '%s\n' "$file"
    found=1
  done
  [ "$found" -eq 1 ]
}

# Stampa una Source per riga. Fallisce (fail-closed) se l'array non si legge
# o se una Source contiene caratteri che il parser non sa leggere.
podman_machine_mount_sources() {
  local config="$1" mounts total sources
  mounts="$(sed -n 's/.*"Mounts":\[\([^]]*\)\].*/\1/p' "$config")"
  if [ -z "$mounts" ]; then
    grep -Eq '"Mounts":(null|\[\])' "$config"
    return $?
  fi
  total="$(printf '%s' "$mounts" | grep -o '"Source":' | wc -l | tr -d ' ')"
  sources="$(printf '%s' "$mounts" | grep -o '"Source":"[^"\\]*"' | sed 's/^"Source":"//; s/"$//')"
  [ "$(printf '%s' "$sources" | grep -c '')" = "$total" ] || return 1
  [ -z "$sources" ] || printf '%s\n' "$sources"
}

# 0 = la machine vede solo le due cartelle; 1 = vede altro; 2 = non verificabile.
podman_machine_confined() {
  local files file sources source
  files="$(podman_machine_config_files)" || return 2
  while IFS= read -r file; do
    sources="$(podman_machine_mount_sources "$file")" || return 2
    while IFS= read -r source; do
      case "$source" in
        ''|"$PODMAN_MOUNT_JHT_HOME"|"$PODMAN_MOUNT_JHT_DOCS") ;;
        *) return 1 ;;
      esac
    done <<EOF_SOURCES
$sources
EOF_SOURCES
  done <<EOF_FILES
$files
EOF_FILES
  return 0
}

require_confined_podman_machine() {
  [ "$CONTAINER_RUNTIME" = "podman" ] || return 0
  local status=0
  podman_machine_confined || status=$?
  case "$status" in
    0) return 0 ;;
    1)
      err "La macchina Podman '$PODMAN_MACHINE_NAME' vede piu' cartelle del Mac di quelle che servono a JHT (~/.jht e ~/Documents/Job Hunter Team)."
      err "Ricreala con 'jht podman-machine-recreate --confirm': i file e lo stato del broker restano, ma le CLI interne e i segreti vengono cancellati."
      exit "$PODMAN_MOUNTS_EXIT"
      ;;
    *)
      err "Non riesco a verificare quali cartelle del Mac vede la macchina Podman '$PODMAN_MACHINE_NAME'."
      exit 1
      ;;
  esac
}

# Una cartella dichiarata con --volume che non esiste impedisce l'avvio della
# machine (vfkit esce con 1): vanno create prima di ogni start.
ensure_podman_mount_dirs() {
  if [ ! -d "$PODMAN_MOUNT_JHT_HOME" ]; then
    mkdir -p "$PODMAN_MOUNT_JHT_HOME" && chmod 700 "$PODMAN_MOUNT_JHT_HOME" || return 1
  fi
  mkdir -p "$PODMAN_MOUNT_JHT_DOCS"
}

podman_binary() {
  local candidate=""
  for candidate in "$(command -v podman 2>/dev/null || true)" \
      /opt/homebrew/bin/podman /usr/local/bin/podman /opt/podman/bin/podman; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

podman_compose_binary() {
  local candidate=""
  for candidate in "$(command -v podman-compose 2>/dev/null || true)" \
      /opt/homebrew/bin/podman-compose /usr/local/bin/podman-compose \
      /opt/podman/bin/podman-compose; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

podman_compose_pair_supported() {
  local podman_bin="$1" compose_bin="$2" podman_version compose_version
  podman_version="$("$podman_bin" --version 2>/dev/null)" || return 1
  [ "$podman_version" = 'podman version 6.1.3' ] || return 1
  compose_version="$(CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME" \
    "$compose_bin" --version 2>/dev/null)" || return 1
  printf '%s\n' "$compose_version" | grep -Fqx 'podman-compose version 1.6.0'
}

compose_project_name() {
  # Identita' prodotto, non input dell'utente e non derivata dal path. Deve
  # restare identica per compose canonico e stage di upgrade: podman-compose
  # 1.6.0 adotta i container esistenti filtrando questa label.
  printf 'jht\n'
}

# `podman machine rm` distrugge i named volume. Lo stato non segreto del
# broker viene quindi esportato sul runtime host protetto e reimportato nella
# macchina nuova. L'archivio vive solo per la durata del comando; i segreti
# non percorrono mai questo canale.
PODMAN_STATE_BACKUP_DIR=""
PODMAN_STATE_BACKUP_ARCHIVE=""
PODMAN_STATE_MANIFEST=""
PODMAN_STATE_VERIFY_MANIFEST=""
PODMAN_STATE_BACKUP_HASH=""
PODMAN_STATE_VOLUME=""
PODMAN_STATE_IMAGE=""

podman_state_backup_cleanup() {
  if [ -n "${PODMAN_STATE_BACKUP_ARCHIVE:-}" ]; then
    rm -f -- "$PODMAN_STATE_BACKUP_ARCHIVE" 2>/dev/null || true
  fi
  [ -z "${PODMAN_STATE_MANIFEST:-}" ] || rm -f -- "$PODMAN_STATE_MANIFEST" 2>/dev/null || true
  [ -z "${PODMAN_STATE_VERIFY_MANIFEST:-}" ] || rm -f -- "$PODMAN_STATE_VERIFY_MANIFEST" 2>/dev/null || true
  if [ -n "${PODMAN_STATE_BACKUP_DIR:-}" ]; then
    rmdir -- "$PODMAN_STATE_BACKUP_DIR" 2>/dev/null || true
  fi
  PODMAN_STATE_BACKUP_DIR=""
  PODMAN_STATE_BACKUP_ARCHIVE=""
  PODMAN_STATE_MANIFEST=""
  PODMAN_STATE_VERIFY_MANIFEST=""
  PODMAN_STATE_BACKUP_HASH=""
  PODMAN_STATE_VOLUME=""
  PODMAN_STATE_IMAGE=""
}

podman_project_volume_name() {
  local podman_bin="$1" logical="$2" project expected ids id found=""
  project="$(compose_project_name)" || return 1
  expected="${project}_${logical}"
  ids="$("$podman_bin" --connection "$PODMAN_MACHINE_NAME" volume ls -q \
    --filter "label=com.docker.compose.project=$project" 2>/dev/null)" || return 1
  for id in $ids; do
    case "$id" in *[!A-Za-z0-9_.-]*) return 1 ;; esac
    [ "$id" = "$expected" ] || continue
    [ -z "$found" ] || return 1
    found="$id"
  done
  [ -n "$found" ] || return 3
  printf '%s\n' "$found"
}

podman_stream_broker_state() {
  local podman_bin="$1" image="$2" volume="$3"
  "$podman_bin" --connection "$PODMAN_MACHINE_NAME" run --rm \
    --userns keep-id:uid=1001,gid=1001 --user 1002:1002 \
    --network none --read-only --security-opt no-new-privileges --cap-drop ALL \
    --volume "$volume:/jht_broker_state:ro" \
    --entrypoint /bin/sh "$image" -ceu '
      dir=/jht_broker_state
      [ "$(/usr/bin/stat -c "%u %a" "$dir")" = "1002 700" ]
      set --
      for name in authorisations.json drafts.json journal.json legacy.json mailbox.json rotation.json seen.json; do
        if [ -e "$dir/$name" ] || [ -L "$dir/$name" ]; then
          [ -f "$dir/$name" ] && [ ! -L "$dir/$name" ]
          [ "$(/usr/bin/stat -c "%u %a" "$dir/$name")" = "1002 600" ]
          [ "$(/usr/bin/stat -c "%s" "$dir/$name")" -le 4194304 ]
          set -- "$@" "$name"
        fi
      done
      cd "$dir"
      if [ "$#" -eq 0 ]; then
        exec /usr/bin/tar -cf - --files-from=/dev/null
      fi
      exec /usr/bin/tar -cf - "$@"
    '
}

podman_broker_state_manifest() {
  local podman_bin="$1" image="$2" volume="$3"
  "$podman_bin" --connection "$PODMAN_MACHINE_NAME" run --rm \
    --userns keep-id:uid=1001,gid=1001 --user 1002:1002 \
    --network none --read-only --security-opt no-new-privileges --cap-drop ALL \
    --volume "$volume:/jht_broker_state:ro" \
    --entrypoint /bin/sh "$image" -ceu '
      dir=/jht_broker_state
      [ "$(/usr/bin/stat -c "%u %a" "$dir")" = "1002 700" ]
      for name in authorisations.json drafts.json journal.json legacy.json mailbox.json rotation.json seen.json; do
        if [ -e "$dir/$name" ] || [ -L "$dir/$name" ]; then
          [ -f "$dir/$name" ] && [ ! -L "$dir/$name" ]
          [ "$(/usr/bin/stat -c "%u %a" "$dir/$name")" = "1002 600" ]
          [ "$(/usr/bin/stat -c "%s" "$dir/$name")" -le 4194304 ]
          /usr/bin/sha256sum "$dir/$name"
        fi
      done
    '
}

podman_export_broker_state() {
  local podman_bin="$1" image="$2" status=0 hash
  PODMAN_STATE_VOLUME="$(podman_project_volume_name "$podman_bin" jht-broker-state)" || status=$?
  [ "$status" -ne 3 ] || { PODMAN_STATE_VOLUME=""; return 0; }
  [ "$status" -eq 0 ] || return 1
  [ -n "$image" ] || return 1
  PODMAN_STATE_IMAGE="$image"
  PODMAN_STATE_BACKUP_DIR="$(mktemp -d "$RUNTIME_DIR/.broker-state-recreate.XXXXXX")" || return 1
  chmod 700 "$PODMAN_STATE_BACKUP_DIR" || return 1
  PODMAN_STATE_BACKUP_ARCHIVE="$PODMAN_STATE_BACKUP_DIR/state.tar"
  PODMAN_STATE_MANIFEST="$PODMAN_STATE_BACKUP_DIR/state.sha256"
  PODMAN_STATE_VERIFY_MANIFEST="$PODMAN_STATE_BACKUP_DIR/verify.sha256"
  podman_broker_state_manifest "$podman_bin" "$image" "$PODMAN_STATE_VOLUME" \
    > "$PODMAN_STATE_MANIFEST" || return 1
  podman_stream_broker_state "$podman_bin" "$image" "$PODMAN_STATE_VOLUME" \
    > "$PODMAN_STATE_BACKUP_ARCHIVE" || return 1
  hash="$(runtime_sha256 "$PODMAN_STATE_BACKUP_ARCHIVE")" || return 1
  case "$hash" in *[!0-9a-fA-F]*|'') return 1 ;; esac
  [ "${#hash}" -eq 64 ] || return 1
  PODMAN_STATE_BACKUP_HASH="$hash"
}

podman_import_broker_state() {
  local podman_bin="$1" hash project
  [ -n "$PODMAN_STATE_VOLUME" ] || return 0
  hash="$(runtime_sha256 "$PODMAN_STATE_BACKUP_ARCHIVE")" || return 1
  [ "$hash" = "$PODMAN_STATE_BACKUP_HASH" ] || return 1
  project="$(compose_project_name)" || return 1
  "$podman_bin" --connection "$PODMAN_MACHINE_NAME" pull "$PODMAN_STATE_IMAGE" >/dev/null || return 1
  "$podman_bin" --connection "$PODMAN_MACHINE_NAME" volume create \
    --label "io.podman.compose.project=$project" \
    --label "com.docker.compose.project=$project" \
    "$PODMAN_STATE_VOLUME" >/dev/null || return 1
  "$podman_bin" --connection "$PODMAN_MACHINE_NAME" run --rm \
    --userns keep-id:uid=1001,gid=1001 --user 1002:1002 \
    --network none --read-only --security-opt no-new-privileges --cap-drop ALL \
    --volume "$PODMAN_STATE_VOLUME:/jht_broker_state" \
    --entrypoint /bin/sh "$PODMAN_STATE_IMAGE" -ceu '
      dir=/jht_broker_state
      chmod 700 "$dir"
      cd "$dir"
      /usr/bin/tar -xf -
      for entry in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        name="${entry##*/}"
        case "$name" in
          authorisations.json|drafts.json|journal.json|legacy.json|mailbox.json|rotation.json|seen.json) ;;
          *) exit 1 ;;
        esac
        [ -f "$entry" ] && [ ! -L "$entry" ]
        [ "$(/usr/bin/stat -c "%u %a" "$entry")" = "1002 600" ]
        [ "$(/usr/bin/stat -c "%s" "$entry")" -le 4194304 ]
      done
      [ "$(/usr/bin/stat -c "%u %a" "$dir")" = "1002 700" ]
    ' < "$PODMAN_STATE_BACKUP_ARCHIVE" || return 1
  podman_broker_state_manifest "$podman_bin" "$PODMAN_STATE_IMAGE" "$PODMAN_STATE_VOLUME" \
    > "$PODMAN_STATE_VERIFY_MANIFEST" || return 1
  cmp -s -- "$PODMAN_STATE_MANIFEST" "$PODMAN_STATE_VERIFY_MANIFEST"
}

require_compose_file() {
  require_trusted_runtime || exit 1
}

compose_file() {
  local file="$1"
  shift
  local project
  project="$(compose_project_name)" \
    || { err "Identita progetto Compose non valida."; return 1; }
  if [ "$CONTAINER_RUNTIME" = "podman" ]; then
    # `podman --connection NAME compose` delegates through the Docker socket
    # bridge. A named macOS machine created with --update-connection=false is
    # reachable by the native client, but that bridge still targets the
    # default socket. podman-compose 1.6.0 also appends --podman-args after
    # each subcommand (`podman ps --connection ...`), which Podman 6 rejects.
    # CONTAINER_CONNECTION is Podman's supported global connection authority;
    # the provider inherits it and therefore emits `podman ps`/`podman run`
    # against the named machine without depending on the mutable default.
    local podman_bin compose_bin
    podman_bin="$(podman_binary)" || { err "Podman non trovato: reinstalla il runtime JHT."; return 127; }
    compose_bin="$(podman_compose_binary)" \
      || { err "Provider Podman Compose non trovato: reinstalla il runtime JHT."; return 127; }
    podman_compose_pair_supported "$podman_bin" "$compose_bin" \
      || { err "Versione Podman Compose non supportata dal runtime JHT."; return 1; }
    "$podman_bin" --connection "$PODMAN_MACHINE_NAME" info >/dev/null 2>&1 \
      || { err "La connessione Podman JHT non supporta il dispatcher Compose."; return 1; }
    (
      cd "$RUNTIME_DIR" || return 1
      CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME" \
      PODMAN_COMPOSE_WARNING_LOGS=false \
        "$compose_bin" \
          --podman-path "$podman_bin" \
          -p "$project" \
          -f "$file" "$@"
    )
    return $?
  fi
  # Il project Docker/VPS storico deriva da --project-directory. Non migrarlo
  # implicitamente al literal Podman: un secondo project colliderebbe sul
  # container_name jht senza poter adottare il runtime esistente.
  MSYS_NO_PATHCONV=1 docker compose -f "$file" --project-directory "$RUNTIME_DIR" "$@"
}

compose() {
  require_trusted_runtime || return 1
  compose_file "$COMPOSE_FILE" "$@"
}

container_up() {
  local container_id
  container_id="$(read_only_container_id)" || return $?
  ATTESTED_CONTAINER_ID="$container_id"
}

# `read_only_container_id` distingue un progetto assente (3) da un risultato
# ambiguo/non posseduto (1). Solo il primo puo' essere creato da un'azione che
# ha gia' autorizzato esplicitamente una mutazione.
container_mutation_preflight() {
  local status=0
  if read_only_container_id >/dev/null; then
    return 0
  else
    status=$?
  fi
  [ "$status" -eq 3 ] && return 0
  err "Container JHT esistente non attestabile; operazione interrotta."
  return 1
}

container_postcheck_running() {
  read_only_container_id >/dev/null || {
    err "Container JHT non verificabile dopo l'operazione."
    return 1
  }
}

# ── Broker dei segreti dei portali (P1 del 08/10) ─────────────────────────
# Il container `jht-broker` possiede l'account della posta. L'host lo
# amministra con exec di `jht-broker-admin`, e il segreto passa solo su stdin.
BROKER_SERVICE="jht-broker"
LEGACY_SECRET_NAMES="email_monitor email_transport"
BROKER_VOLUME_NAMES="jht-secrets jht-broker-state jht-broker-sock"
HOST_RESET_CONFIRMED_EXIT=20

broker_admin() {
  local broker_id
  broker_id="$(read_only_service_id "$BROKER_SERVICE")" || {
    err "broker_unavailable: il broker dei segreti non è attivo o non è attestabile."
    err "Cosa fare: jht up"
    return 1
  }
  docker exec -i "$broker_id" jht-broker-admin "$@"
}

# Telegram isolato: il token nuovo va dallo stdin dell'host direttamente al
# container uid 1003. Il container agenti vede soltanto gli hash dei token
# legacy necessari a imporre la rotazione, mai il token nuovo.
TELEGRAM_SERVICE="jht-telegram"

telegram_admin() {
  local telegram_id
  telegram_id="$(read_only_service_id "$TELEGRAM_SERVICE")" || {
    err "telegram_unavailable: il servizio Telegram isolato non è attivo o non è attestabile."
    err "Cosa fare: jht up"
    return 1
  }
  docker exec "$telegram_id" jht-telegram-admin "$@"
}

telegram_admin_input() {
  local telegram_id
  telegram_id="$(read_only_service_id "$TELEGRAM_SERVICE")" || {
    err "telegram_unavailable: il servizio Telegram isolato non è attivo o non è attestabile."
    err "Cosa fare: jht up"
    return 1
  }
  docker exec -i "$telegram_id" jht-telegram-admin "$@"
}

telegram_image() {
  local images
  images="$(compose config --images 2>/dev/null | sort -u)" || return 1
  case "$images" in ''|*$'\n'*) return 1 ;; esac
  printf '%s\n' "$images"
}

telegram_legacy() {
  local command="${1:-}" image mode home_mount
  local -a userns_args=()
  case "$command" in inventory|remaining) mode=ro ;; remove) mode=rw ;; *) return 2 ;; esac
  image="$(telegram_image)" || return 1
  home_mount="${JHT_HOME_HOST:-$HOME/.jht}"
  if [ "$CONTAINER_RUNTIME" = podman ]; then
    userns_args=(--userns keep-id:uid=1001,gid=1001)
  fi
  docker run --rm \
    ${userns_args[@]+"${userns_args[@]}"} \
    --user 1001:1001 --read-only --tmpfs /tmp:size=4m,mode=1777 \
    --network none --cap-drop ALL --security-opt no-new-privileges \
    --volume "$home_mount:/jht_home:$mode" \
    --entrypoint /usr/bin/python3 "$image" -I \
    /app/shared/telegram_service/bin/jht-telegram-legacy.py "$@"
}

telegram_prepare_legacy_inventory() {
  local role digests digest agent_status=0
  compose up -d "$TELEGRAM_SERVICE" >/dev/null || return 1
  if telegram_admin legacy complete >/dev/null 2>&1; then
    return 0
  fi
  if read_only_container_id >/dev/null 2>&1; then
    compose stop "$CONTAINER_SERVICE" >/dev/null || return 1
  else
    agent_status=$?
    [ "$agent_status" -eq 3 ] || return 1
  fi
  for role in assistente capitano mentor; do
    digests="$(telegram_legacy inventory "$role")" || return 1
    if [ -n "$digests" ]; then
      while IFS= read -r digest; do
        printf '%s' "$digest" | grep -Eq '^[0-9a-f]{64}$' || return 1
      done <<< "$digests"
    fi
    printf '%s' "$digests" \
      | telegram_admin_input legacy remember "$role" >/dev/null || return 1
  done
}

telegram_pair() {
  local role="${1:-}" digest digests="" remaining_rc=0 was_enabled="" first_cutover=0
  local agent_was_running=0 agent_status=0
  local token="" chat_id="" pair_rc=0
  local -a digest_args=()
  case "$role" in assistente|capitano|mentor) ;; *)
    err "uso: jht telegram pair <assistente|capitano|mentor>"
    err "Interattivo: il token viene chiesto senza eco. Automazioni: JSON su stdin; non salvare il token in ~/.jht e cancella subito qualunque file usato fuori da lì."
    return 2
    ;;
  esac
  if read_only_container_id >/dev/null 2>&1; then
    agent_was_running=1
    compose stop "$CONTAINER_SERVICE" >/dev/null || {
      err "legacy_inventory_failed: non riesco a fermare gli agenti prima dell'inventario host."
      return 1
    }
  else
    agent_status=$?
    if [ "$agent_status" -ne 3 ]; then
      err "legacy_inventory_failed: lo stato del container agenti non è attestabile."
      return 1
    fi
  fi
  digests="$(telegram_legacy inventory "$role")" || {
    [ "$agent_was_running" -eq 0 ] || compose start "$CONTAINER_SERVICE" >/dev/null 2>&1 || true
    err "legacy_inventory_failed: migrazione Telegram interrotta."
    return 1
  }
  if [ -n "$digests" ]; then
    while IFS= read -r digest; do
      printf '%s' "$digest" | grep -Eq '^[0-9a-f]{64}$' || {
        err "legacy_inventory_invalid: migrazione Telegram interrotta."
        return 1
      }
      digest_args+=(--legacy-digest "$digest")
    done <<< "$digests"
  fi
  if ! printf '%s' "$digests" | telegram_admin_input legacy remember "$role" >/dev/null; then
    [ "$agent_was_running" -eq 0 ] || compose start "$CONTAINER_SERVICE" >/dev/null 2>&1 || true
    err "legacy_inventory_failed: le impronte non sono state conservate dal servizio isolato."
    return 1
  fi
  if [ "$agent_was_running" -eq 1 ]; then
    compose start "$CONTAINER_SERVICE" >/dev/null || {
      err "agent_restart_failed: inventario conservato, ma il team non è ripartito. Cosa fare: jht up"
      return 1
    }
  fi

  was_enabled="$(telegram_admin cutover status 2>/dev/null || true)"
  if [ -t 0 ]; then
    info "Se esisteva già un bot, revoca il token precedente in BotFather e usa quello nuovo."
    printf 'Token del bot (input nascosto): ' >&2
    if ! IFS= read -rs token; then
      printf '\n' >&2
      err "input_interrotto: token non letto."
      return 1
    fi
    printf "\nChat ID dell'utente: " >&2
    if ! IFS= read -r chat_id; then
      unset token
      err "input_interrotto: chat id non letto."
      return 1
    fi
    if [[ ! "$token" =~ ^[0-9]{5,12}:[A-Za-z0-9_-]{20,}$ ]]; then
      unset token chat_id
      err "bot_token_invalid: controlla il token generato da BotFather."
      return 1
    fi
    if [[ ! "$chat_id" =~ ^-?[0-9]{1,20}$ ]]; then
      unset token chat_id
      err "chat_id_invalid: inserisci l'identificativo numerico della chat."
      return 1
    fi
    if printf '{"bot_token":"%s","chat_id":"%s"}' "$token" "$chat_id" \
        | telegram_admin_input bots pair "$role" ${digest_args[@]+"${digest_args[@]}"}; then
      pair_rc=0
    else
      pair_rc=$?
    fi
    unset token chat_id
  else
    if telegram_admin_input bots pair "$role" ${digest_args[@]+"${digest_args[@]}"}; then
      pair_rc=0
    else
      pair_rc=$?
    fi
  fi
  if [ "$pair_rc" -ne 0 ]; then
    err "Abbinamento rifiutato. Se esisteva già un bot, revoca il token da BotFather e usa quello nuovo."
    return "$pair_rc"
  fi
  telegram_legacy remove "$role" || {
    err "legacy_cleanup_failed: il nuovo token è al sicuro, ma il token vecchio è ancora in ~/.jht; cutover negato."
    return 1
  }

  if telegram_legacy remaining >/dev/null; then
    case "$was_enabled" in *'"enabled": true'*) ;; *) first_cutover=1 ;; esac
    telegram_admin cutover enable >/dev/null || return 1
    compose restart "$TELEGRAM_SERVICE" >/dev/null || return 1
    if [ "$first_cutover" -eq 1 ] && [ "$agent_was_running" -eq 1 ]; then
      # Il riavvio spegne anche eventuali tg-bridge che conservavano il token
      # vecchio in memoria. Al boot pid1 vede il marker read-only.
      compose restart "$CONTAINER_SERVICE" >/dev/null || return 1
    fi
    info "Telegram isolato attivo; il bridge legacy non può più essere riabilitato dagli agenti."
  else
    remaining_rc=$?
    if [ "$remaining_rc" -eq 1 ]; then
      warn "Bot abbinato e copia legacy rimossa. Restano altri token legacy o un token nell'ambiente del container: rimuovili e completa la rotazione prima del cutover."
    else
      err "legacy_inventory_failed: non posso provare che ~/.jht sia privo di token Telegram."
      return 1
    fi
  fi
}

telegram_command() {
  local action="${1:-status}"
  shift || true
  case "$action" in
    status) telegram_admin bots status ;;
    pair) telegram_pair "$@" ;;
    remove)
      case "${1:-}" in assistente|capitano|mentor) telegram_admin bots delete "$1" ;; *)
        err "uso: jht telegram remove <assistente|capitano|mentor>"; return 2 ;;
      esac
      ;;
    *)
      err "uso: jht telegram status|pair <ruolo>|remove <ruolo>"
      return 2
      ;;
  esac
}

# I file vecchi stanno in ~/.jht/credentials, dell'uid degli agenti: li legge
# `legacy.py` dentro il container `jht` e li passa al broker in una busta
# (sha256 + base64) senza toccare il disco dell'host. Il broker li importa una
# volta sola; solo dopo il suo «ok» l'originale si cancella. Una migrazione
# fallita lascia tutto com'era.
broker_migrate_legacy() {
  local agent_id broker_id name answer migrated=0 failed=0
  agent_id="$(read_only_container_id)" || return 1
  broker_id="$(read_only_service_id "$BROKER_SERVICE")" || return 1
  for name in $LEGACY_SECRET_NAMES; do
    docker exec -u 1001 "$agent_id" /usr/bin/python3 -I /app/shared/broker/legacy.py exists "$name" >/dev/null 2>&1 || continue
    answer="$(docker exec -u 1001 "$agent_id" /usr/bin/python3 -I /app/shared/broker/legacy.py read "$name" 2>/dev/null \
      | docker exec -i "$broker_id" jht-broker-admin secrets import-legacy "$name" 2>/dev/null)" || true
    case "$answer" in
      *'"ok": true'*'"state": "imported"'*)
        docker exec -u 1001 "$agent_id" /usr/bin/python3 -I /app/shared/broker/legacy.py remove "$name" >/dev/null 2>&1 \
          || warn "legacy_remove_failed: $name è nel broker ma la copia in ~/.jht/credentials è rimasta."
        migrated=1
        ;;
      *'"ok": true'*'"state": "already_migrated"'*)
        # Un file ricomparso dopo la migrazione non si importa: lo possono
        # scrivere gli agenti. Si toglie e basta.
        docker exec -u 1001 "$agent_id" /usr/bin/python3 -I /app/shared/broker/legacy.py remove "$name" >/dev/null 2>&1 || true
        warn "legacy_secret_reappeared: ~/.jht/credentials/$name.json è ricomparso dopo la migrazione; rimosso senza importarlo."
        ;;
      *)
        warn "legacy_migration_failed: $name resta in ~/.jht/credentials (risposta del broker: ${answer:-nessuna})."
        failed=1
        ;;
    esac
  done
  if [ "$migrated" -eq 1 ]; then
    warn "La casella di posta ora sta nel broker dei segreti. La sua password era leggibile dagli agenti:"
    warn "genera una nuova password per app dal tuo provider e salvala con: jht mail setup"
    warn "Fino ad allora la posta si legge e si invia con la password di oggi; l'avviso resta in jht mail status."
  fi
  return "$failed"
}

# Dopo `up`: la migrazione gira finche' non riesce una volta, poi un
# marcatore nel runtime protetto dell'host la spegne. Un runtime senza broker
# nel compose non fa nessuna chiamata in piu'. `jht mail migrate` la rifa'
# sempre, a richiesta.
BROKER_LEGACY_MARKER="$RUNTIME_DIR/.broker-legacy-migrated"
broker_migrate_legacy_once() {
  grep -q "^  $BROKER_SERVICE:" "$COMPOSE_FILE" 2>/dev/null || return 0
  [ ! -e "$BROKER_LEGACY_MARKER" ] || return 0
  if broker_migrate_legacy; then
    : > "$BROKER_LEGACY_MARKER" 2>/dev/null || true
  fi
  return 0
}

# The CLI owns the existing reset preview and confirmation. Only its internal
# exit 20 means that confirmation completed; cancellation (0) and errors must
# leave the Compose volumes untouched.
reset_compose_project_name() {
  if [ "$CONTAINER_RUNTIME" = podman ]; then
    compose_project_name
    return $?
  fi
  local configured project
  configured="$(compose config --format json 2>/dev/null)" || return 1
  project="$(printf '%s\n' "$configured" \
    | sed -n 's/^[[:space:]]*"name"[[:space:]]*:[[:space:]]*"\([a-z0-9][a-z0-9_-]*\)"[,[:space:]]*$/\1/p' \
    | head -n 1)"
  [ -n "$project" ] || return 1
  printf '%s\n' "$project"
}

remove_broker_reset_data() {
  local project logical ids id failed=0 marker_existed=0
  project="$(reset_compose_project_name)" || {
    err "reset: non riesco a determinare il progetto Compose; i volumi del broker non sono stati toccati."
    return 1
  }
  compose down || {
    err "reset: non riesco a fermare il runtime; i volumi del broker non sono stati toccati."
    return 1
  }
  for logical in $BROKER_VOLUME_NAMES; do
    if [ "$CONTAINER_RUNTIME" = podman ]; then
      # podman-compose 1.6 labels volumes with the project but, unlike Docker
      # Compose, not with the logical volume name. Select the one exact name
      # generated by that attested project; never delete another project.
      ids="$(docker volume ls -q \
        --filter "label=com.docker.compose.project=$project" 2>/dev/null)" || {
        err "reset: ricerca del volume $logical non riuscita."
        failed=1
        continue
      }
      ids="$(printf '%s\n' "$ids" | awk -v expected="${project}_${logical}" '$0 == expected')"
    else
      ids="$(docker volume ls -q \
        --filter "label=com.docker.compose.project=$project" \
        --filter "label=com.docker.compose.volume=$logical" 2>/dev/null)" || {
        err "reset: ricerca del volume $logical non riuscita."
        failed=1
        continue
      }
    fi
    if [ -z "$ids" ]; then
      info "Saltato (non trovato): volume broker $logical"
      continue
    fi
    for id in $ids; do
      case "$id" in *[!A-Za-z0-9_.-]*)
        err "reset: nome volume non valido per $logical; rimozione negata."
        failed=1
        continue
        ;;
      esac
      if docker volume rm "$id" >/dev/null; then
        info "Cancellato: volume broker $logical ($id)"
      else
        err "reset: impossibile cancellare il volume broker $logical ($id)."
        failed=1
      fi
    done
  done
  [ -e "$BROKER_LEGACY_MARKER" ] && marker_existed=1
  if rm -f -- "$BROKER_LEGACY_MARKER"; then
    [ "$marker_existed" -eq 0 ] || info "Cancellato: marcatore migrazione broker $BROKER_LEGACY_MARKER"
  else
    err "reset: impossibile cancellare il marcatore migrazione broker $BROKER_LEGACY_MARKER."
    failed=1
  fi
  if [ "$failed" -eq 0 ]; then
    warn "I segreti e lo stato del broker sono stati cancellati: rifai i login dei portali e configura di nuovo la posta."
  fi
  return "$failed"
}

reset_command() {
  ensure_up
  docker exec $EXEC_FLAGS \
    -e JHT_HOST_TYPE="$JHT_HOST_TYPE" \
    -e JHT_HOST_RESET_PROTOCOL=1 \
    "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" reset "$@"
  local code=$?
  [ "$code" -eq "$HOST_RESET_CONFIRMED_EXIT" ] || return "$code"
  remove_broker_reset_data
}

mail_setup() {
  local user="" imap_host="" smtp_host="" dedicated="" admission password
  while [ $# -gt 0 ]; do
    case "$1" in
      --user) user="${2:-}"; shift 2 ;;
      --imap-host) imap_host="${2:-}"; shift 2 ;;
      --smtp-host) smtp_host="${2:-}"; shift 2 ;;
      --dedicated) dedicated=yes; shift ;;
      --not-dedicated) dedicated=no; shift ;;
      *) err "mail setup: opzione sconosciuta $1"; return 2 ;;
    esac
  done
  if [ -z "$user" ]; then
    printf 'Indirizzo della casella: ' >&2
    IFS= read -r user || return 1
  fi
  if [ -z "$dedicated" ]; then
    printf 'È una casella DEDICATA agli avvisi di lavoro inoltrati? [s/N] ' >&2
    IFS= read -r dedicated || return 1
    case "$dedicated" in s|S|si|sì|y|Y|yes) dedicated=yes ;; *) dedicated=no ;; esac
  fi
  if [ "$dedicated" = yes ]; then admission=whole_mailbox; else admission=allowlist; fi
  printf 'Password per app (non viene mostrata): ' >&2
  IFS= read -rs password || return 1
  printf '\n' >&2
  [ -n "$password" ] || { err "mail setup: password vuota"; return 1; }
  set -- mailbox setup --user "$user" --admission "$admission"
  [ -z "$imap_host" ] || set -- "$@" --imap-host "$imap_host"
  [ -z "$smtp_host" ] || set -- "$@" --smtp-host "$smtp_host"
  printf '%s\n' "$password" | broker_admin "$@"
  local rc=$?
  unset password
  return $rc
}

mail_command() {
  local action="${1:-status}"
  shift || true
  case "$action" in
    setup) mail_setup "$@" ;;
    status) broker_admin secrets status && broker_admin mailbox show ;;
    admission) broker_admin mailbox admission "$@" ;;
    allow) broker_admin mailbox allow "$@" ;;
    drafts) broker_admin mail drafts ;;
    approve|discard) broker_admin mail "$action" "$@" ;;
    journal) broker_admin mail journal "$@" ;;
    delete) broker_admin secrets delete email_monitor ;;
    migrate) broker_migrate_legacy && : > "$BROKER_LEGACY_MARKER" ;;
    *)
      err "uso: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <indirizzo|@dominio>|drafts|approve <id>|discard <id>|journal|delete|migrate"
      return 2
      ;;
  esac
}

# podman-compose 1.6.0 calcola la label dalla configurazione servizio risolta,
# non dal digest dei byte YAML. La sua interfaccia pubblica dry-run applica lo
# stesso resolver usato da `up`. Il provider puo' fare probe Podman read-only,
# ma dry-run gli impedisce create/start/remove; force-recreate obbliga inoltre
# il create-plan a contenere la label anche quando il container esiste gia'.
# L'output verbose puo' contenere variabili risolte: resta confinato in memoria
# e ne estraiamo solo un singolo SHA-256, mai stdout/stderr grezzo.
podman_expected_config_hash() {
  local file="$1" service="${2:-jht}" podman_bin compose_bin resolved hashes hash
  podman_bin="$(podman_binary)" || return 1
  compose_bin="$(podman_compose_binary)" || return 1
  podman_compose_pair_supported "$podman_bin" "$compose_bin" || return 1
  resolved="$({
    cd "$RUNTIME_DIR" || return 1
    CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME" \
    PODMAN_COMPOSE_WARNING_LOGS=false \
      "$compose_bin" --verbose --dry-run --project-name jht \
        --podman-path "$podman_bin" -f "$file" up -d --force-recreate "$service"
  } 2>&1)" || return 1
  hashes="$(printf '%s\n' "$resolved" \
    | sed -n 's/.*io\.podman\.compose\.config-hash=\([0-9a-f]\{64\}\)\([[:space:]].*\)\{0,1\}$/\1/p')"
  unset resolved
  case "$hashes" in ''|*$'\n'*) return 1 ;; esac
  hash="$hashes"
  printf '%s' "$hash" | grep -Eq '^[0-9a-f]{64}$' || return 1
  printf '%s\n' "$hash"
}

# Risolve il container di un servizio tramite l'esatto progetto Compose JHT
# senza bootstrap, wake o auto-up. Un container omonimo non e' mai sufficiente.
# Il progetto ha due servizi: `jht` (agenti) e `jht-broker` (segreti dei
# portali, P1 del 08/10). 3 = servizio assente, 1 = non attestabile.
read_only_service_id() {
  local service="$1"
  runtime_bundle_trusted || return 1
  docker_reachable || return 1
  local ids container_id details expected_hash expected_project expected_unit found="" seen_service
  if [ "$CONTAINER_RUNTIME" = podman ]; then
    # podman-compose 1.6.0 non accetta un operando service su `ps`: elenca
    # tutti i container del progetto, e il servizio lo dice l'inspect
    # attestato qui sotto.
    ids="$(compose_file "$COMPOSE_FILE" ps -q 2>/dev/null)" || return 1
  else
    ids="$(compose_file "$COMPOSE_FILE" ps -q "$service" 2>/dev/null)" || return 1
  fi
  [ -n "$ids" ] || return 3
  for container_id in $ids; do
    case "$container_id" in *[!0-9a-fA-F]*) return 1 ;; esac
    [ "${#container_id}" -ge 12 ] && [ "${#container_id}" -le 64 ] || return 1
  done
  if [ "$CONTAINER_RUNTIME" = podman ]; then
    expected_project="$(compose_project_name)" || return 1
    expected_unit="$(printf 'podman-compose\100%s.service' "$expected_project")"
    expected_hash="$(podman_expected_config_hash "$COMPOSE_FILE" "$service")" || return 1
  fi
  for container_id in $ids; do
    if [ "$CONTAINER_RUNTIME" = podman ]; then
      details="$(docker inspect --type container "$container_id" --format '{{.Name}}|{{.State.Running}}|{{index .Config.Labels "io.podman.compose.project"}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "io.podman.compose.service"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.container-number"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "io.podman.compose.version"}}|{{index .Config.Labels "PODMAN_SYSTEMD_UNIT"}}|{{index .Config.Labels "io.podman.compose.config-hash"}}' 2>/dev/null)" \
        || return 1
      # Quinto campo: il servizio. Un altro servizio del compose (jht o
      # jht-broker) si salta; un servizio che il compose non ha e' un
      # container non nostro, e si rifiuta tutto.
      seen_service="$(printf '%s' "$details" | cut -d'|' -f5)"
      if [ "$seen_service" != "$service" ]; then
        case " $COMPOSE_SERVICES " in *" $seen_service "*) continue ;; esac
        return 1
      fi
      [ -z "$found" ] || return 1
      [ "$details" = "$service|true|$expected_project|$expected_project|$service|$service|1|$RUNTIME_DIR|$COMPOSE_FILE|1.6.0|$expected_unit|$expected_hash" ] \
        || return 1
    else
      [ -z "$found" ] || return 1
      # Conserva il contratto Docker/VPS preesistente: l'ownership stretta
      # project/path/hash e' specifica del provider Podman 1.6.0 qui fissato.
      details="$(docker inspect --type container "$container_id" --format '{{.State.Running}} {{index .Config.Labels "com.docker.compose.service"}}' 2>/dev/null)" \
        || return 1
      [ "$details" = "true $service" ] || return 1
    fi
    found="$container_id"
  done
  [ -n "$found" ] || return 3
  printf '%s\n' "$found"
}

read_only_container_id() {
  read_only_service_id "$CONTAINER_SERVICE"
}

# Bridge interno del desktop. Non avvia runtime, container o team.
desktop_chat_container_id() {
  read_only_container_id
}

emit_inactive_onboarding_snapshot() {
  local runtime_installed="$1"
  printf '%s\n' \
    "runtimeInstalled=$runtime_installed" \
    containerRunning=0 \
    providerConfigured=0 \
    providerAuthenticated=0 \
    assistantWelcomed=0 \
    assistantRunning=0 \
    captainRunning=0 \
    profileReady=0
}

onboarding_snapshot() {
  if ! runtime_bundle_trusted; then
    emit_inactive_onboarding_snapshot 0
    return 0
  fi
  local container_id metadata provider_configured provider_authenticated assistant_welcomed
  local assistant_running captain_running profile_ready final_running
  container_id="$(read_only_container_id)" || {
    emit_inactive_onboarding_snapshot 1
    return 0
  }
  metadata="$(docker exec "$container_id" node -e '
const fs=require("fs"); let config={};
try { config=JSON.parse(fs.readFileSync("/jht_home/jht.config.json","utf8")); } catch {}
const provider=String(config.active_provider||"").toLowerCase();
const providers=config.providers||{}; const entry=providers[provider]||{};
const configured=["claude","anthropic","codex","openai","kimi","moonshot"].includes(provider)
  && (entry.auth_method||"subscription")==="subscription";
const markers={claude:"/jht_home/.claude/.credentials.json",anthropic:"/jht_home/.claude/.credentials.json",codex:"/jht_home/.codex/auth.json",openai:"/jht_home/.codex/auth.json",kimi:"/jht_home/.kimi/credentials/kimi-code.json",moonshot:"/jht_home/.kimi/credentials/kimi-code.json"};
process.stdout.write(`${configured?1:0} ${markers[provider]&&fs.existsSync(markers[provider])?1:0} ${fs.existsSync("/jht_home/profile/welcomed.flag")?1:0}`);
' 2>/dev/null)" || metadata=""
  provider_configured=0
  provider_authenticated=0
  assistant_welcomed=0
  read -r provider_configured provider_authenticated assistant_welcomed <<EOF
$metadata
EOF
  case "$provider_configured:$provider_authenticated:$assistant_welcomed" in
    [01]:[01]:[01]) ;;
    *) provider_configured=0; provider_authenticated=0; assistant_welcomed=0 ;;
  esac
  assistant_running=0
  if docker exec "$container_id" tmux has-session -t ASSISTENTE >/dev/null 2>&1; then
    assistant_running=1
  fi
  captain_running=0
  if docker exec "$container_id" tmux has-session -t CAPITANO >/dev/null 2>&1; then
    captain_running=1
  fi
  profile_ready=0
  if docker exec "$container_id" test -f /jht_home/profile/ready.flag >/dev/null 2>&1 \
      || docker exec "$container_id" node "$NODE_ENTRY" profile validate --strict --json >/dev/null 2>&1; then
    profile_ready=1
  fi
  final_running="$(docker inspect "$container_id" --format '{{.State.Running}}' 2>/dev/null || true)"
  if [ "$final_running" != true ]; then
    emit_inactive_onboarding_snapshot 1
    return 0
  fi
  printf '%s\n' \
    runtimeInstalled=1 \
    containerRunning=1 \
    "providerConfigured=$provider_configured" \
    "providerAuthenticated=$provider_authenticated" \
    "assistantWelcomed=$assistant_welcomed" \
    "assistantRunning=$assistant_running" \
    "captainRunning=$captain_running" \
    "profileReady=$profile_ready"
}

desktop_chat() {
  local action="${1:-}" container_id session="${2:-}"
  container_id="$(desktop_chat_container_id)" || {
    err "runtime o container JHT non disponibile"
    return 1
  }
  case "$action" in
    probe)
      printf 'true\n'
      ;;
    python)
      [ "$#" -eq 1 ] || return 2
      docker exec -i "$container_id" python3 -c \
        'import sys;exec(bytes.fromhex(sys.stdin.buffer.readline().decode()).decode())'
      ;;
    send)
      [ "$#" -eq 2 ] || return 2
      case "$session" in
        CAPITANO|ASSISTENTE|MENTOR|SCOUT-1|ANALISTA-1|SCORER-1|SCRITTORE-1|CRITICO) ;;
        *) return 2 ;;
      esac
      docker exec -i "$container_id" sh -c \
        'msg=$(cat); exec jht-tmux-send "$1" "$msg"' sh "$session"
      ;;
    *) return 2 ;;
  esac
}

# Docker c'e' ED e' raggiungibile? A differenza di require_docker NON esce:
# serve a DECIDERE, non a pretendere.
docker_reachable() {
  command -v docker >/dev/null 2>&1 || return 1
  # Una machine Podman che vede piu' del Mac di ~/.jht e dei documenti JHT non
  # e' "raggiungibile": i probe non la usano, e i comandi che la pretendono
  # (up, status, require_docker, upgrade) escono spiegando il motivo.
  if [ "$CONTAINER_RUNTIME" = "podman" ]; then
    podman_machine_confined || return 1
  fi
  docker info >/dev/null 2>&1
}

# L'aiuto completo vive nel CLI DENTRO il container, quindi senza container si
# stampa questo. Elenca cio' che il wrapper sa fare da se' sull'host: e' meno
# dell'aiuto vero, ma e' onesto ed e' gratis.
local_help() {
  cat <<'JHTHELP'
jht — Job Hunter Team

  Comandi dell'host (funzionano da qui):
    jht up                 avvia il container del team
    jht down               lo ferma
    jht restart            lo riavvia
    jht status             stato di container e team
    jht logs [-f]          log del container
    jht upgrade            aggiorna all'immagine piu' recente
    jht setup              installazione guidata
    jht download --os X    scarica l'app desktop per un sistema
    jht game start|stop    avvia o ferma il videogioco
    jht gui open           apre l'interfaccia grafica
    jht shell              shell dentro il container
    jht mail setup         salva la casella di posta nel broker dei segreti
    jht mail drafts        email scritte dagli agenti in attesa del tuo ok
    jht mail approve <id>  le manda; jht mail discard <id> le scarta
    jht telegram status    stato del servizio Telegram isolato
    jht telegram pair ROLE chiede il token senza eco sul computer host
                           Per automazioni: JSON su stdin. Non salvare il token
                           in ~/.jht; cancella subito file usati fuori da lì.
    jht reset              cancella configurazione e volumi del broker
    jht podman-machine-recreate --confirm
                           ricrea la macchina Podman (macOS) vedendo
                           solo ~/.jht e ~/Documents/Job Hunter Team

  Tutti gli altri comandi (positions, stats, team, providers, cron,
  working-hours, cloud...) girano DENTRO il container: per il loro aiuto
  serve il container attivo.

      jht up && jht --help

JHTHELP
}

# Richiesta di sola informazione: se il container e' gia' in piedi si serve
# l'aiuto vero, altrimenti quello locale. In nessun caso si avvia qualcosa.
serve_help_without_docker() {
  if docker_reachable && container_up; then
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
    return $?
  fi
  local_help
  if [ $# -gt 1 ]; then
    info "Per l'aiuto di '$1' serve il container attivo: 'jht up'."
  fi
  return 0
}

# I comandi implementati dal wrapper non esistono nel CLI Node. Se Docker e'
# gia' attivo, inoltrare per esempio `jht up --help` al container darebbe un
# falso errore; il loro aiuto resta quindi quello locale anche in quel caso.
host_command_uses_local_help() {
  case "$1" in
    up|start-container|down|stop-container|restart|recreate|upgrade|logs|status|shell|oauth-login|claude-login|setup|download|podman-machine-recreate|mail|telegram|reset)
      return 0
      ;;
  esac
  return 1
}

# Allinea l'owner delle dir bind-mountate all'UID che il container usa
# internamente (jht = 1001). Senza questo, su VPS root (uid 0) il
# container 'jht' non puo' scrivere in /jht_home: EACCES su jht.config.json,
# ~/.jht/.npm-global, ecc.
#
# Override via JHT_BIND_OWNER (default 1001:1001). Best-effort: ignora
# fallimenti chown su Mac/Colima dove userns mapping gestisce diversamente.
# The container runs as uid 1001 (or JHT_BIND_OWNER) (`jht`), and ~/.jht plus the documents
# folder are aligned to it. On the HOST that uid must belong to nobody, or to
# the person installing or starting JHT: another account with that uid would
# own all of ~/.jht (data and portal credentials) and could run a file the
# container made setuid there (P2 of the security review, 08/10). Prints the
# account name and succeeds when there is such a conflict.
bind_uid_conflict() {
  local uid="$1" self="${SUDO_UID:-$(id -u)}" name=""
  if command -v getent >/dev/null 2>&1; then
    name="$(getent passwd "$uid" 2>/dev/null | cut -d: -f1)"
  else
    name="$(id -un "$uid" 2>/dev/null || true)"
  fi
  [ -n "$name" ] || return 1
  [ "$self" = "$uid" ] && return 1
  printf '%s\n' "$name"
}

ensure_bind_owner() {
  [ "$(uname -s)" = "Linux" ] || return 0
  local target="${JHT_BIND_OWNER:-1001:1001}"
  local target_uid="${target%%:*}"
  local name
  if name="$(bind_uid_conflict "$target_uid")"; then
    err "bind_uid_conflict: uid $target_uid on this computer is the account '$name'. The Job Hunter Team container runs as uid $target_uid, so that account would own ~/.jht (your data and the portal credentials). Nothing was changed. Run JHT from the account '$name', or give '$name' another uid, then try again."
    exit 1
  fi
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
  local status=0
  if container_up; then
    return 0
  else
    status=$?
  fi
  [ "$status" -eq 3 ] || {
    err "Container JHT esistente non attestabile; avvio automatico negato."
    exit 1
  }
  info "Container '$CONTAINER_SERVICE' non attivo, lo avvio..."
  ensure_bind_owner
  telegram_prepare_legacy_inventory || {
    err "legacy_inventory_failed: il team resta fermo perché l'inventario Telegram host non è stato conservato."
    exit 1
  }
  compose up -d
  # Attendi che il container sia in stato running e con ownership completa
  # prima di inoltrare qualunque comando nel nuovo processo.
  local tries=20
  while ! container_up; do
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then
      err "Container '$CONTAINER_SERVICE' non e' partito entro 10s. Controlla 'jht logs'."
      exit 1
    fi
    sleep 0.5
  done
}

# ── Client desktop nativo (mai Docker) ───────────────────────────────────
# Il wrapper host possiede claim, process discovery e timeout. Il gioco
# possiede invece le azioni UI e l'uscita cooperativa sul main thread.
game_json_string() {
  local path="$1" key="$2"
  [ -f "$path" ] || return 1
  tr -d '\r\n' < "$path" \
    | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p"
}

game_json_number() {
  local path="$1" key="$2"
  [ -f "$path" ] || return 1
  tr -d '\r\n' < "$path" \
    | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p"
}

game_json_bool() {
  local path="$1" key="$2"
  [ -f "$path" ] || return 1
  tr -d '\r\n' < "$path" \
    | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\([a-z][a-z]*\).*/\1/p"
}

game_process_matches() {
  local pid="$1" expected="$2" actual=""
  kill -0 "$pid" 2>/dev/null || return 1
  [ -n "$expected" ] || return 1
  case "$(uname -s)" in
    Linux)
      actual="$(readlink "/proc/$pid/exe" 2>/dev/null || true)"
      [ -n "$actual" ] || return 1
      [ "$(readlink -f -- "$actual" 2>/dev/null || printf '%s' "$actual")" = \
        "$(readlink -f -- "$expected" 2>/dev/null || printf '%s' "$expected")" ]
      ;;
    Darwin)
      actual="$(ps -p "$pid" -o comm= 2>/dev/null | sed 's/^[[:space:]]*//' || true)"
      [ -n "$actual" ] && [ "$actual" = "$expected" ]
      ;;
    *) return 1 ;;
  esac
}

game_process_started_epoch() {
  local pid="$1" raw=""
  raw="$(LC_ALL=C ps -p "$pid" -o lstart= 2>/dev/null \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || true)"
  [ -n "$raw" ] || return 1
  if [ "$(uname -s)" = "Darwin" ]; then
    LC_ALL=C date -j -f '%a %b %e %T %Y' "$raw" '+%s' 2>/dev/null
  else
    LC_ALL=C date -d "$raw" '+%s' 2>/dev/null
  fi
}

game_load_live_state() {
  local state="$GAME_CONTROL_DIR/state.json" current="" state_started="" process_started="" delta=0
  GAME_STATE_PID=""
  GAME_STATE_INSTANCE=""
  GAME_STATE_EXECUTABLE=""
  [ -f "$state" ] || return 1
  GAME_STATE_PID="$(game_json_number "$state" pid || true)"
  GAME_STATE_INSTANCE="$(game_json_string "$state" instance_id || true)"
  GAME_STATE_EXECUTABLE="$(game_json_string "$state" executable || true)"
  state_started="$(game_json_number "$state" started_at || true)"
  case "$GAME_STATE_PID" in ''|*[!0-9]*) return 1 ;; esac
  case "$state_started" in ''|*[!0-9]*) return 1 ;; esac
  [ -n "$GAME_STATE_INSTANCE" ] || return 1
  if game_process_matches "$GAME_STATE_PID" "$GAME_STATE_EXECUTABLE"; then
    process_started="$(game_process_started_epoch "$GAME_STATE_PID" || true)"
    case "$process_started" in ''|*[!0-9]*) process_started=0 ;; esac
    delta=$((process_started - state_started))
    [ "$delta" -ge 0 ] || delta=$((-delta))
    # Come PowerShell: l'EXE embedded puo pubblicare state.json diversi
    # secondi dopo il process start, ma non minuti/ore dopo un PID riciclato.
    if [ "$process_started" -gt 0 ] && [ "$delta" -le 30 ]; then
      return 0
    fi
  fi
  # Rimuove soltanto lo snapshot letto: se un nuovo processo lo ha sostituito
  # nel frattempo, il suo nonce resta intatto.
  current="$(game_json_string "$state" instance_id || true)"
  if [ "$current" = "$GAME_STATE_INSTANCE" ]; then
    rm -f -- "$state"
  fi
  return 1
}

game_resolve_executable() {
  local remembered="" candidate=""
  if [ -n "$GAME_EXECUTABLE_OVERRIDE" ]; then
    printf '%s\n' "$GAME_EXECUTABLE_OVERRIDE"
    return 0
  fi
  remembered="$(game_json_string "$GAME_CONTROL_DIR/launcher.json" executable || true)"
  if [ -n "$remembered" ] && [ -x "$remembered" ]; then
    printf '%s\n' "$remembered"
    return 0
  fi
  if [ "$(uname -s)" = "Darwin" ]; then
    for candidate in \
      "/Applications/Job Hunter Team.app/Contents/MacOS/Job Hunter Team" \
      "$HOME/Applications/Job Hunter Team.app/Contents/MacOS/Job Hunter Team"; do
      if [ -x "$candidate" ]; then printf '%s\n' "$candidate"; return 0; fi
    done
  else
    candidate="$(command -v job-hunter-team.x86_64 2>/dev/null || true)"
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    for candidate in "$HOME/Applications/job-hunter-team.x86_64" \
      "$HOME/.local/bin/job-hunter-team.x86_64" \
      "$HOME/Downloads/job-hunter-team.x86_64"; do
      if [ -x "$candidate" ]; then printf '%s\n' "$candidate"; return 0; fi
    done
  fi
  return 1
}

game_lock_mtime() {
  stat -c '%Y' "$1" 2>/dev/null || stat -f '%m' "$1" 2>/dev/null || printf '0'
}

game_remove_start_lock_if_owned() {
  local lock="$1" owner="$2" current=""
  current="$(cat "$lock/owner.pid" 2>/dev/null || true)"
  if [ "$current" = "$owner" ]; then
    rm -f -- "$lock/owner.pid"
    rmdir -- "$lock" 2>/dev/null || true
  fi
}

game_new_nonce() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr -d '-' | tr '[:upper:]' '[:lower:]'
  else
    printf '%s-%s-%s\n' "$(date +%s)" "$$" "${RANDOM:-0}"
  fi
}

game_start_locked() {
  local executable="" nonce="" pid="" deadline=""
  if game_load_live_state; then
    printf 'game running pid=%s instance=%s\n' "$GAME_STATE_PID" "$GAME_STATE_INSTANCE"
    return 0
  fi
  executable="$(game_resolve_executable || true)"
  if [ -z "$executable" ] || [ ! -x "$executable" ]; then
    err "client non trovato; aprilo una volta manualmente oppure imposta JHT_GAME_EXECUTABLE"
    return 1
  fi
  nonce="$(game_new_nonce)"
  JHT_GAME_INSTANCE_ID="$nonce" JHT_GAME_CONTROL_DIR="$GAME_CONTROL_DIR" \
    nohup "$executable" >/dev/null 2>&1 &
  pid=$!
  deadline=$(( $(date +%s) + 15 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 0.2
    if game_load_live_state \
      && [ "$GAME_STATE_INSTANCE" = "$nonce" ] \
      && [ "$GAME_STATE_PID" = "$pid" ]; then
      printf 'game started pid=%s instance=%s\n' "$pid" "$nonce"
      return 0
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      err "client terminato durante l'avvio"
      return 1
    fi
  done
  err "client avviato ma non pronto entro 15 secondi"
  game_cleanup_started_process "$pid" "$nonce"
  return 1
}

game_cleanup_started_process() {
  local pid="$1" nonce="$2" deadline=""
  if game_load_live_state && [ "$GAME_STATE_INSTANCE" = "$nonce" ]; then
    game_request stop >/dev/null 2>&1 || true
    return
  fi
  # Il control plane non e' mai diventato pronto: TERM e' l'unica uscita
  # recuperabile disponibile, limitata al PID appena creato da questo claim.
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    deadline=$(( $(date +%s) + 5 ))
    while kill -0 "$pid" 2>/dev/null && [ "$(date +%s)" -lt "$deadline" ]; do sleep 0.1; done
  fi
}

game_start() {
  local lock="$GAME_CONTROL_DIR/start.lock" deadline="" acquired=0 mtime=0 now=0 code=1 owner=""
  if game_load_live_state; then
    printf 'game running pid=%s instance=%s\n' "$GAME_STATE_PID" "$GAME_STATE_INSTANCE"
    return 0
  fi
  mkdir -p -- "$GAME_CONTROL_DIR" || { err "directory client non scrivibile: $GAME_CONTROL_DIR"; return 1; }
  deadline=$(( $(date +%s) + 15 ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if mkdir -- "$lock" 2>/dev/null; then
      printf '%s\n' "$$" > "$lock/owner.pid"
      acquired=1
      break
    fi
    if game_load_live_state; then
      printf 'game running pid=%s instance=%s\n' "$GAME_STATE_PID" "$GAME_STATE_INSTANCE"
      return 0
    fi
    owner="$(cat "$lock/owner.pid" 2>/dev/null || true)"
    case "$owner" in
      ''|*[!0-9]*) ;;
      *)
        if ! kill -0 "$owner" 2>/dev/null; then
          rm -f -- "$lock/owner.pid"
          rmdir -- "$lock" 2>/dev/null || true
          continue
        fi
        ;;
    esac
    now="$(date +%s)"; mtime="$(game_lock_mtime "$lock")"
    case "$mtime" in ''|*[!0-9]*) mtime=0 ;; esac
    if [ -z "$owner" ] && [ $((now - mtime)) -gt 2 ]; then
      rmdir -- "$lock" 2>/dev/null || true
    fi
    sleep 0.2
  done
  if [ "$acquired" -ne 1 ]; then err "timeout acquisizione lock di avvio del client"; return 1; fi
  if game_start_locked; then code=0; else code=$?; fi
  game_remove_start_lock_if_owned "$lock" "$$"
  return "$code"
}

game_write_request() {
  local action="$1" request_id="$2" target="$3"
  local path="$GAME_CONTROL_DIR/request.json" temp="$GAME_CONTROL_DIR/.request.tmp-$$-${RANDOM:-0}"
  if ! printf '{"schema":1,"action":"%s","request_id":"%s","target_instance_id":"%s"}\n' \
      "$action" "$request_id" "$target" > "$temp"; then
    rm -f -- "$temp"
    return 1
  fi
  mv -f -- "$temp" "$path"
}

game_remove_request_if_owned() {
  local path="$1" request_id="$2" target="$3"
  [ -f "$path" ] || return 0
  if [ "$(game_json_string "$path" request_id || true)" = "$request_id" ] \
    && [ "$(game_json_string "$path" target_instance_id || true)" = "$target" ]; then
    rm -f -- "$path"
  fi
}

game_request() {
  local action="$1" request_id="" ack="" deadline="" target_pid="" target_instance="" code=1
  if ! game_load_live_state; then
    case "$action" in
      stop) printf 'game already stopped\n'; return 0 ;;
      background) err "client non attivo; usa 'jht game start'"; return 1 ;;
      *)
        game_start || return $?
        game_load_live_state || { err "client avviato senza stato controllabile"; return 1; }
        ;;
    esac
  fi
  target_pid="$GAME_STATE_PID"; target_instance="$GAME_STATE_INSTANCE"
  request_id="$(game_new_nonce)"
  ack="$GAME_CONTROL_DIR/ack-$request_id.json"
  rm -f -- "$ack"
  if ! game_write_request "$action" "$request_id" "$target_instance"; then
    err "impossibile pubblicare la richiesta al client"
    return 1
  fi
  if [ "$action" = "stop" ]; then deadline=$(( $(date +%s) + 15 )); else deadline=$(( $(date +%s) + 10 )); fi
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 0.2
    if [ "$action" = "stop" ]; then
      if ! kill -0 "$target_pid" 2>/dev/null; then
        printf 'game stopped pid=%s; team still running\n' "$target_pid"
        code=0
        break
      fi
    elif [ -f "$ack" ] \
      && [ "$(game_json_string "$ack" request_id || true)" = "$request_id" ] \
      && [ "$(game_json_string "$ack" instance_id || true)" = "$target_instance" ]; then
      if [ "$(game_json_bool "$ack" ok || true)" = "true" ]; then
        if [ "$action" = "background" ]; then
          printf 'game background pid=%s; client and team still running\n' "$target_pid"
        else
          printf 'gui opened pid=%s\n' "$target_pid"
        fi
        code=0
      else
        if [ "$action" = "background" ]; then
          err "il sistema operativo ha rifiutato la minimizzazione della finestra"
        else
          err "il sistema operativo ha rifiutato il foreground della finestra"
        fi
        code=1
      fi
      break
    fi
  done
  if [ "$code" -ne 0 ] && [ "$(date +%s)" -ge "$deadline" ]; then
    err "timeout richiesta $action al client"
  fi
  game_remove_request_if_owned "$GAME_CONTROL_DIR/request.json" "$request_id" "$target_instance"
  rm -f -- "$ack"
  return "$code"
}

game_restart() {
  local previous_instance="" previous_pid=""
  if game_load_live_state; then
    previous_instance="$GAME_STATE_INSTANCE"
    previous_pid="$GAME_STATE_PID"
  fi
  game_request stop || return $?
  game_start || return $?
  game_load_live_state || { err "client riavviato senza stato controllabile"; return 1; }
  if [ -n "$previous_instance" ] && [ "$GAME_STATE_INSTANCE" = "$previous_instance" ]; then
    err "il riavvio non ha sostituito l'istanza precedente"
    return 1
  fi
  printf 'game restarted old_pid=%s pid=%s instance=%s; team still running\n' \
    "${previous_pid:-none}" "$GAME_STATE_PID" "$GAME_STATE_INSTANCE"
}

game_help() {
  printf '%s\n' 'Usage: jht game <start|stop|status|restart|background>' '' \
    '  start    Avvia il client in modo idempotente' \
    '  stop     Chiude il client e lascia il team al lavoro' \
    '  status   Mostra running/stopped, PID e instance_id' \
    '  restart  Riavvia il client in modo cooperativo; il team continua' \
    '  background  Minimizza un client attivo senza fermarlo'
}

gui_help() {
  printf '%s\n' 'Usage: jht gui open' '' \
    '  open     Avvia il client se necessario e porta la finestra in primo piano'
}

handle_game_command() {
  if [ "$#" -eq 0 ] || { [ "$#" -eq 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; }; then
    game_help; return 0
  fi
  if [ "$#" -eq 2 ] && { [ "$2" = "--help" ] || [ "$2" = "-h" ]; }; then
    case "$1" in
      start) printf '%s\n' 'Usage: jht game start' 'Avvia il client in modo idempotente.'; return 0 ;;
      stop) printf '%s\n' 'Usage: jht game stop' 'Chiude il client e lascia il team al lavoro.'; return 0 ;;
      status) printf '%s\n' 'Usage: jht game status' 'Mostra lo stato del client desktop.'; return 0 ;;
      restart) printf '%s\n' 'Usage: jht game restart' 'Riavvia il client in modo cooperativo; il team continua.'; return 0 ;;
      background) printf '%s\n' 'Usage: jht game background' 'Minimizza un client attivo senza fermarlo.'; return 0 ;;
    esac
  fi
  if [ "$#" -ne 1 ]; then err "opzioni game non riconosciute"; return 2; fi
  case "$1" in
    start) game_start ;;
    stop) game_request stop ;;
    restart) game_restart ;;
    background) game_request background ;;
    status)
      if game_load_live_state; then
        printf 'game running pid=%s instance=%s\n' "$GAME_STATE_PID" "$GAME_STATE_INSTANCE"
      else
        printf 'game stopped\n'
      fi
      ;;
    *) err "azione game non riconosciuta: $1"; return 2 ;;
  esac
}

handle_gui_command() {
  if [ "$#" -eq 0 ] || { [ "$#" -eq 1 ] && { [ "$1" = "--help" ] || [ "$1" = "-h" ]; }; }; then
    gui_help; return 0
  fi
  if [ "$#" -eq 2 ] && [ "$1" = "open" ] \
    && { [ "$2" = "--help" ] || [ "$2" = "-h" ]; }; then
    printf '%s\n' 'Usage: jht gui open' 'Avvia il client se necessario e porta la finestra in primo piano.'
    return 0
  fi
  if [ "$#" -ne 1 ] || [ "$1" != "open" ]; then err "uso: jht gui open"; return 2; fi
  game_request foreground
}

# `download --output` indica un path dell'HOST, mentre il CLI Node gira nel
# container. Inoltrarlo alla cieca (soprattutto `C:\\...` su Windows) crea il
# file nel filesystem Linux del container e mente sul risultato. Il download
# resta implementato e verificato una sola volta dal CLI canonico; il wrapper
# gli assegna un path temporaneo interno, poi pubblica i byte sul path host con
# docker cp + rename nello stesso filesystem della destinazione.
handle_host_download() {
  local container_id="$1" host_output="" container_tmp="" host_tmp="" arg next
  shift
  local -a rewritten=()
  local -a download_env=()

  # Seam esplicita per mirror/test di integrita': resta confinata al download
  # e permette al comando HOST di esercitare anche un manifest corrotto.
  if [ -n "${JHT_RELEASE_BASE_URL:-}" ]; then
    download_env=(-e "JHT_RELEASE_BASE_URL=$JHT_RELEASE_BASE_URL")
  fi

  while [ "$#" -gt 0 ]; do
    arg="$1"
    case "$arg" in
      --output)
        if [ -n "$host_output" ]; then
          err "--output specificato piu di una volta"
          return 2
        fi
        if [ "$#" -lt 2 ] || [ -z "$2" ]; then
          err "--output richiede un path"
          return 2
        fi
        next="$2"
        host_output="$next"
        shift 2
        ;;
      --output=*)
        if [ -n "$host_output" ]; then
          err "--output specificato piu di una volta"
          return 2
        fi
        host_output="${arg#--output=}"
        if [ -z "$host_output" ]; then
          err "--output richiede un path"
          return 2
        fi
        shift
        ;;
      *)
        rewritten+=("$arg")
        shift
        ;;
    esac
  done

  # Senza output esplicito il default `/jht_user/downloads` e' gia un bind
  # mount visibile sul computer host: nessuna copia aggiuntiva necessaria.
  if [ -z "$host_output" ]; then
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" \
      ${download_env[@]+"${download_env[@]}"} \
      "$container_id" node "$NODE_ENTRY" download "${rewritten[@]}"
    return $?
  fi

  if [ -e "$host_output" ] || [ -L "$host_output" ]; then
    err "il file di destinazione esiste gia: $host_output"
    return 1
  fi

  container_tmp="/tmp/jht-download-$$-${RANDOM:-0}"
  rewritten+=(--output "$container_tmp")
  local code
  if docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" \
      ${download_env[@]+"${download_env[@]}"} \
      "$container_id" node "$NODE_ENTRY" download "${rewritten[@]}"; then
    code=0
  else
    code=$?
    docker exec "$container_id" rm -f "$container_tmp" >/dev/null 2>&1 || true
    return "$code"
  fi

  local parent
  parent="$(dirname -- "$host_output")"
  if ! mkdir -p -- "$parent"; then
    err "impossibile creare la directory di destinazione: $parent"
    docker exec "$container_id" rm -f "$container_tmp" >/dev/null 2>&1 || true
    return 1
  fi
  host_tmp="${host_output}.part-$$-${RANDOM:-0}"
  if ! docker cp "$container_id:$container_tmp" "$host_tmp"; then
    err "copia del download verificato verso l'host non riuscita"
    rm -f -- "$host_tmp"
    docker exec "$container_id" rm -f "$container_tmp" >/dev/null 2>&1 || true
    return 1
  fi
  docker exec "$container_id" rm -f "$container_tmp" >/dev/null 2>&1 || true

  # `mv -n` non sostituisce un file comparso durante il download. Se il temp
  # esiste ancora dopo il comando, la pubblicazione non e' avvenuta.
  if ! mv -n -- "$host_tmp" "$host_output" || [ -e "$host_tmp" ]; then
    err "la destinazione e' comparsa durante il download; non e' stata sovrascritta"
    rm -f -- "$host_tmp"
    return 1
  fi
  printf "  Salvato sul computer host in: %s\n" "$host_output"
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
  compose_file "$file" "$@"
}

upgrade_image() {
  local container_id
  container_id="$(read_only_container_id)" || return 0
  docker inspect "$container_id" --format '{{.Image}}' 2>/dev/null || true
}

upgrade_version() {
  local container_id
  container_id="$(read_only_container_id)" || return 0
  docker exec "$container_id" node "$NODE_ENTRY" --version 2>/dev/null \
    | head -n 1 | tr -d '\r\n' || true
}

upgrade_verify_running() {
  # 20 osservazioni prima di dichiarare rotto il candidato. JHT_UPGRADE_VERIFY_TRIES
  # serve ai test del ripristino: con un candidato che non passa mai, ogni giro
  # costa una decina di processi e i 20 giri sfioravano il timeout di vitest.
  # Un valore che non e' un intero positivo da 1 a 9999 vale 20 (piu' cifre
  # andrebbero in overflow e la verifica non finirebbe). `10#`: le cifre sono
  # in base dieci anche con uno zero davanti; altrimenti Bash legge `010` come 8
  # e `08` come un errore, che con `set -e` chiude il wrapper a meta' verifica,
  # dopo l'apply e prima del ripristino.
  local tries="${JHT_UPGRADE_VERIFY_TRIES:-20}"
  case "$tries" in
    ''|*[!0-9]*|?????*) tries=20 ;;
  esac
  tries=$((10#$tries))
  [ "$tries" -gt 0 ] || tries=20
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
    rm -f "$UPGRADE_ROLLBACK_DIR/docker-compose.yml" "$UPGRADE_ROLLBACK_DIR/jht-wrapper.sh" \
      "$UPGRADE_ROLLBACK_DIR/.runtime-integrity"
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
  runtime_node_safe "$UPGRADE_JOURNAL" file || return 1
  runtime_node_safe "$rollback_dir" dir || return 1
  [ "$version" = "1" ] || return 1
  case "$phase" in prepared|pulled|candidate_metadata|candidate_started|metadata_committed) ;; *) return 1 ;; esac
  case "$was_running" in 0|1) ;; *) return 1 ;; esac
  if [ "$was_running" = "1" ]; then
    printf '%s' "$old_image" | grep -Eq '^sha256:[A-Za-z0-9]+$' || return 1
  elif [ "$old_image" != "none" ]; then
    return 1
  fi
  [ -n "$rollback_dir" ] && [ -d "$rollback_dir" ] || return 1
  [ -f "$rollback_dir/docker-compose.yml" ] || return 1
  [ -f "$rollback_dir/jht-wrapper.sh" ] || return 1
  [ -f "$rollback_dir/.runtime-integrity" ] || return 1
  [ ! -L "$rollback_dir/docker-compose.yml" ] || return 1
  [ ! -L "$rollback_dir/jht-wrapper.sh" ] || return 1
  [ ! -L "$rollback_dir/.runtime-integrity" ] || return 1
  runtime_node_safe "$rollback_dir/docker-compose.yml" file || return 1
  runtime_node_safe "$rollback_dir/jht-wrapper.sh" file || return 1
  runtime_node_safe "$rollback_dir/.runtime-integrity" file || return 1
  runtime_node_safe "$HOST_SETUP_SCRIPT" file || return 1
  local snapshot_compose_sha snapshot_helper_sha
  snapshot_compose_sha="$(sed -n 's/^docker-compose.yml=//p' "$rollback_dir/.runtime-integrity" | head -n 1)"
  snapshot_helper_sha="$(sed -n 's/^host-setup.sh=//p' "$rollback_dir/.runtime-integrity" | head -n 1)"
  local snapshot_wrapper_sha
  snapshot_wrapper_sha="$(sed -n 's/^jht-wrapper.sh=//p' "$rollback_dir/.runtime-integrity" | head -n 1)"
  [ "$snapshot_compose_sha" = "$(runtime_sha256 "$rollback_dir/docker-compose.yml")" ] || return 1
  [ "$snapshot_helper_sha" = "$(runtime_sha256 "$HOST_SETUP_SCRIPT")" ] || return 1
  [ "$snapshot_wrapper_sha" = "$(runtime_sha256 "$rollback_dir/jht-wrapper.sh")" ] || return 1
  if [ "$was_running" = "1" ]; then
    # Validate every host-consumed byte before the first Docker call. Only
    # then verify that the immutable rollback image is still locally present.
    docker image inspect "$old_image" >/dev/null 2>&1 || return 1
  fi
  upgrade_atomic_replace "$rollback_dir/docker-compose.yml" "$COMPOSE_FILE" || return 1
  upgrade_atomic_replace "$rollback_dir/jht-wrapper.sh" "$WRAPPER_PATH" 755 || return 1
  upgrade_atomic_replace "$rollback_dir/.runtime-integrity" "$RUNTIME_MANIFEST" 600 || return 1

  if [ "$was_running" = "1" ]; then
    [ -n "$old_image" ] || return 1
    if ! JHT_IMAGE="$old_image" upgrade_run upgrade_compose "$COMPOSE_FILE" up -d --force-recreate "$CONTAINER_SERVICE"; then
      return 1
    fi
    upgrade_verify_running || return 1
  else
    # Prima non c'era un runtime attivo: un candidato fallito non deve restare
    # come container morto che l'utente scambia per un'installazione sana.
    upgrade_run upgrade_compose "$COMPOSE_FILE" rm -sf "$CONTAINER_SERVICE" || return 1
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
  local candidate_compose candidate_wrapper metadata_changed=false release_base
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

  if [ ! -e "$RUNTIME_DIR" ]; then
    runtime_bootstrap_release || {
      upgrade_result false false preflight unknown none unknown none false "Runtime host protetto non installabile" false
      return 1
    }
  fi
  runtime_path_allowed && runtime_node_safe "$RUNTIME_DIR" dir || {
    upgrade_result false false preflight unknown none unknown none false "Runtime host fuori authority" false
    return 1
  }
  if [ "$CONTAINER_RUNTIME" = "podman" ]; then
    local machine_status=0
    podman_machine_confined || machine_status=$?
    if [ "$machine_status" -eq 1 ]; then
      upgrade_result false false preflight unknown none unknown none false "La macchina Podman vede piu' cartelle del Mac di quelle di JHT: ricreala con 'jht podman-machine-recreate --confirm'" false
      return "$PODMAN_MOUNTS_EXIT"
    elif [ "$machine_status" -ne 0 ]; then
      upgrade_result false false preflight unknown none unknown none false "Cartelle visibili alla macchina Podman non verificabili" false
      return 1
    fi
  fi
  if ! upgrade_acquire_lock; then
    upgrade_result false false preflight unknown none unknown none false "Un aggiornamento e gia in corso" false
    return 1
  fi
  UPGRADE_JOURNAL="$RUNTIME_DIR/.upgrade-journal"
  trap upgrade_cleanup_ephemeral EXIT INT TERM

  if ! upgrade_recover_if_needed; then
    upgrade_result false false recovery unknown none unknown none false "Recovery dell upgrade precedente non riuscita" false
    return 1
  fi
  if ! runtime_bundle_trusted; then
    upgrade_result false false preflight unknown none unknown none false "Runtime host non attendibile" false
    return 1
  fi
  if ! upgrade_docker_ready; then
    upgrade_result false false preflight unknown none unknown none false "Docker non e disponibile" false
    return 1
  fi
  if ! upgrade_compose_ready; then
    upgrade_result false false preflight unknown none unknown none false "Runtime compose non disponibile" false
    return 1
  fi
  if [ ! -f "$WRAPPER_PATH" ]; then
    upgrade_result false false preflight unknown none unknown none false "Wrapper host non leggibile" false
    return 1
  fi

  local container_status=0
  if container_up; then
    was_running=1
    old_image="$(upgrade_image)"
    old_version="$(upgrade_version)"
  else
    container_status=$?
    if [ "$container_status" -ne 3 ]; then
      upgrade_result false false preflight unknown none unknown none false "Container esistente non attestabile" false
      return 1
    fi
    old_image=""
    old_version="non-installata"
  fi
  old_image="${old_image:-none}"
  old_version="${old_version:-sconosciuta}"

  # Solo dopo avere escluso container estranei/stale e' lecito creare o
  # riallineare le directory bind-mountate sul percorso Linux/VPS.
  ensure_bind_owner

  UPGRADE_STAGE="$(mktemp -d "$RUNTIME_DIR/.upgrade-stage.XXXXXX")" || {
    upgrade_result false false preflight "$old_version" "$old_image" "$old_version" "$old_image" false "Spazio temporaneo non disponibile" false
    return 1
  }
  candidate_compose="$UPGRADE_STAGE/docker-compose.yml"
  candidate_wrapper="$UPGRADE_STAGE/jht-wrapper.sh"
  upgrade_note "Scarico runtime aggiornato..."
  release_base="$(attested_raw_base)" || {
    upgrade_result false false preflight "$old_version" "$old_image" "$old_version" "$old_image" false "Release host non attestabile" false
    return 1
  }
  if ! upgrade_run curl -fsSL "${release_base%/}/docker-compose.yml" -o "$candidate_compose" \
      || ! upgrade_run curl -fsSL "${release_base%/}/scripts/jht-wrapper.sh" -o "$candidate_wrapper" \
      || ! bash -n "$candidate_wrapper" \
      || ! grep -Fqx 'JHT_HOST_RUNTIME_PROTOCOL=1' "$candidate_wrapper" \
      || ! grep -Eq '^[[:space:]]*-[[:space:]]*jht-runtime-mask:/jht_home/runtime([[:space:]]|$)' "$candidate_compose" \
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
      || ! cp "$RUNTIME_MANIFEST" "$UPGRADE_ROLLBACK_DIR/.runtime-integrity" \
      || ! upgrade_write_journal prepared "$old_image" "$was_running"; then
    upgrade_remove_transaction
    upgrade_result false false preflight "$old_version" "$old_image" "$old_version" "$old_image" false "Impossibile preparare il rollback" false
    return 1
  fi

  phase="pull"
  upgrade_note "Scarico l immagine piu recente..."
  if ! upgrade_run upgrade_compose "$candidate_compose" pull "$CONTAINER_SERVICE"; then
    upgrade_remove_transaction
    upgrade_result false false pull "$old_version" "$old_image" "$old_version" "$old_image" false "Download immagine non riuscito" false
    return 1
  fi
  # Il compose nuovo e' la fonte di verita': non assumere che l'immagine
  # resti per sempre latest o che un override JHT_IMAGE punti allo stesso ref.
  candidate_ref="$(upgrade_compose "$candidate_compose" config --images 2>/dev/null | head -n 1)"
  candidate_image="$(docker image inspect "${candidate_ref:-${JHT_IMAGE:-$DEFAULT_RUNTIME_IMAGE}}" --format '{{.Id}}' 2>/dev/null || true)"
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

  phase="candidate_metadata"
  upgrade_note "Pubblico la configurazione candidata attestata..."
  if ! upgrade_atomic_replace "$candidate_compose" "$COMPOSE_FILE" \
      || ! runtime_write_manifest \
      || ! upgrade_write_journal candidate_metadata "$old_image" "$was_running"; then
    if upgrade_restore_previous; then rolled_back=true; fi
    upgrade_result false false candidate_metadata "$old_version" "$old_image" "$old_version" "$old_image" false "Configurazione candidata non persistita" "$rolled_back"
    return 1
  fi

  phase="activate"
  upgrade_note "Attivo il nuovo runtime..."
  if ! telegram_prepare_legacy_inventory; then
    if upgrade_restore_previous; then rolled_back=true; fi
    upgrade_result false false activate "$old_version" "$old_image" "$old_version" "$old_image" false "Inventario Telegram host non conservato prima dell'avvio degli agenti" "$rolled_back"
    return 1
  fi
  if ! upgrade_run upgrade_compose "$COMPOSE_FILE" up -d --force-recreate "$CONTAINER_SERVICE"; then
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
  if ! upgrade_atomic_replace "$candidate_wrapper" "$WRAPPER_PATH" 755 \
      || ! runtime_write_manifest \
      || ! upgrade_write_journal metadata_committed "$old_image" "$was_running"; then
    if upgrade_restore_previous; then rolled_back=true; fi
    upgrade_result false false commit "$old_version" "$old_image" "$old_version" "$old_image" false "Metadata runtime non persistiti" "$rolled_back"
    return 1
  fi

  upgrade_remove_transaction
  # Il broker dei segreti dei portali (P1 del 08/10) usa la stessa immagine
  # del team: dopo il commit riparte con quella nuova. Non decide l'esito
  # dell'upgrade (il team e' gia' verificato): se non parte, la posta resta
  # chiusa (broker_unavailable) finche' un `jht up` non lo riaccende.
  if grep -q "^  $BROKER_SERVICE:" "$COMPOSE_FILE"; then
    upgrade_run upgrade_compose "$COMPOSE_FILE" up -d --force-recreate "$BROKER_SERVICE" \
      || upgrade_note "broker_restart_failed: il broker dei segreti non e' ripartito. Cosa fare: jht up"
    broker_migrate_legacy_once
  fi
  if grep -q "^  $TELEGRAM_SERVICE:" "$COMPOSE_FILE"; then
    upgrade_run upgrade_compose "$COMPOSE_FILE" up -d --force-recreate "$TELEGRAM_SERVICE" \
      || upgrade_note "telegram_restart_failed: il servizio Telegram isolato non è ripartito. Cosa fare: jht up"
  fi
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

# Il gate informativo precede TUTTI i rami, inclusi quelli host-side. Tenerlo
# solo nel catch-all lascia `up --help`, `setup --help`, ecc. liberi di entrare
# nei rispettivi path Docker prima che il wrapper legga `--help`.
if [ "$#" -gt 1 ] && [ "$SUB" != "game" ] && [ "$SUB" != "gui" ]; then
  for arg in "${@:2}"; do
    case "$arg" in
      -h|--help)
        if host_command_uses_local_help "$SUB"; then
          local_help
          exit 0
        fi
        serve_help_without_docker "$@"
        exit $?
        ;;
    esac
  done
fi

# ⚠️ ORDINE: si guarda COSA e' stato chiesto PRIMA di decidere se serve Docker.
# Il contrario — chiamare ensure_up in cima al catch-all — faceva si' che un
# semplice `jht --help` scaricasse l'immagine (~300 MB) e creasse container e
# volumi, cioe' il primo comando di chi non ha ancora deciso se installare
# (P-07, 2026-08-10). Un'eccezione per il solo `--help` avrebbe tappato il buco
# lasciando la forma: e' il ramo informativo che va prima di tutto.
case "$SUB" in
  -h|--help|help|'')
    serve_help_without_docker --help
    exit $?
    ;;

  -V|--version|version)
    if docker_reachable && container_up; then
      docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" --version
    elif [ -n "${JHT_IMAGE_TAG:-}" ]; then
      printf '%s\n' "$JHT_IMAGE_TAG"
      info "Versione dell'immagine configurata. Per quella del CLI in esecuzione: 'jht up' e poi 'jht --version'."
    elif [ -n "${JHT_IMAGE:-}" ]; then
      printf '%s\n' "$(basename "$JHT_IMAGE" | sed 's/.*://')"
      info "Versione dell'immagine configurata. Per quella del CLI in esecuzione: 'jht up' e poi 'jht --version'."
    else
      printf '%s\n' "$DEFAULT_RUNTIME_VERSION"
      info "Versione dell'immagine configurata. Per quella del CLI in esecuzione: 'jht up' e poi 'jht --version'."
    fi
    exit 0
    ;;

  game)
    handle_game_command "${@:2}"
    ;;

  gui)
    handle_gui_command "${@:2}"
    ;;

  desktop-chat)
    shift || true
    desktop_chat "$@"
    ;;

  onboarding-snapshot)
    onboarding_snapshot
    ;;

  # ── Machine Podman confinata (macOS) ─────────────────────────────────
  # Solo su richiesta esplicita (--confirm): salva lo stato non segreto del
  # broker, ferma e cancella la VM di JHT e la ricrea confinata. I segreti non
  # vengono mai esportati: password e login vanno reinseriti.
  # `podman machine rm` sposta la connessione di default dell'utente: quella
  # di prima viene rimessa, perche' e' condivisa con altri progetti.
  podman-machine-recreate)
    require_compose_file
    if [ "$CONTAINER_RUNTIME" != "podman" ]; then
      err "Questo runtime non usa una macchina Podman: non c'e' niente da ricreare."
      exit 1
    fi
    if [ "${2:-}" != "--confirm" ] || [ $# -ne 2 ]; then
      err "Ricrea la macchina Podman '$PODMAN_MACHINE_NAME': la ferma e la cancella, poi la ricrea vedendo solo ~/.jht e ~/Documents/Job Hunter Team."
      err "ATTENZIONE: le CLI interne verranno reinstallate e i segreti non saranno conservati. La configurazione e lo stato della posta restano, ma dovrai reinserire la password della posta e rifare il login LinkedIn."
      err "Per procedere: jht podman-machine-recreate --confirm"
      exit 2
    fi
    podman_bin="$(podman_binary)" || { err "Podman non trovato: reinstalla il runtime JHT."; exit 127; }
    ensure_podman_mount_dirs \
      || { err "Non riesco a creare ~/.jht o ~/Documents/Job Hunter Team per la macchina Podman."; exit 1; }
    start_podman_for_recreate "$podman_bin" || exit 1
    broker_state_image="$(compose config --images 2>/dev/null | sort -u)" \
      || { err "Non riesco a determinare l'immagine attestata del broker."; exit 1; }
    case "$broker_state_image" in ''|*$'\n'*)
      err "Il compose non indica una sola immagine condivisa per team e broker; preservazione negata."
      exit 1
      ;;
    esac
    compose down \
      || { err "Non riesco a fermare i servizi prima di salvare lo stato del broker."; exit 1; }
    trap podman_state_backup_cleanup EXIT INT TERM
    podman_export_broker_state "$podman_bin" "$broker_state_image" \
      || { err "Non riesco a esportare in modo verificabile lo stato del broker; la macchina non e' stata cancellata."; exit 1; }
    default_connection="$("$podman_bin" system connection list --format '{{.Name}} {{.Default}}' 2>/dev/null \
      | awk '$2 == "true" { print $1; exit }')"
    info "Fermo e ricreo la macchina Podman '$PODMAN_MACHINE_NAME'..."
    "$podman_bin" machine stop "$PODMAN_MACHINE_NAME" >/dev/null 2>&1 || true
    "$podman_bin" machine rm -f "$PODMAN_MACHINE_NAME" >/dev/null \
      || { err "Non riesco a rimuovere la macchina Podman '$PODMAN_MACHINE_NAME'."; exit 1; }
    rm -f -- "$BROKER_LEGACY_MARKER" \
      || warn "Non ho potuto rimuovere il marcatore della migrazione del broker: $BROKER_LEGACY_MARKER"
    if ! "$podman_bin" machine init --now --update-connection=false \
      --volume "$PODMAN_MOUNT_JHT_HOME:$PODMAN_MOUNT_JHT_HOME" \
      --volume "$PODMAN_MOUNT_JHT_DOCS:$PODMAN_MOUNT_JHT_DOCS" \
      "$PODMAN_MACHINE_NAME" >/dev/null; then
      if [ -n "$default_connection" ]; then
        "$podman_bin" system connection default "$default_connection" >/dev/null 2>&1 || true
      fi
      err "La nuova macchina Podman '$PODMAN_MACHINE_NAME' non si e' creata."
      exit 1
    fi
    if [ -n "$default_connection" ]; then
      "$podman_bin" system connection default "$default_connection" >/dev/null 2>&1 \
        || warn "Non ho potuto rimettere '$default_connection' come connessione Podman predefinita."
    fi
    podman_import_broker_state "$podman_bin" \
      || { err "La macchina e' stata ricreata, ma lo stato del broker non ha superato la verifica/importazione."; exit 1; }
    require_confined_podman_machine
    podman_state_backup_cleanup
    trap - EXIT INT TERM
    info "Macchina Podman ricreata: vede solo ~/.jht e ~/Documents/Job Hunter Team. Lo stato del broker e' stato conservato; le CLI verranno reinstallate. Avvia il team con 'jht up', reinserisci la password della posta e rifai il login LinkedIn."
    ;;

  # ── Lifecycle: parlano direttamente al daemon Docker ───────────────────
  up)
    require_compose_file
    wake_container_runtime_for_up
    container_mutation_preflight || exit 1
    ensure_bind_owner
    telegram_prepare_legacy_inventory || {
      err "legacy_inventory_failed: il team resta fermo perché l'inventario Telegram host non è stato conservato."
      exit 1
    }
    compose up -d
    container_postcheck_running || exit 1
    broker_migrate_legacy_once
    ;;

  start-container)
    require_compose_file
    require_docker
    container_mutation_preflight || exit 1
    ensure_bind_owner
    telegram_prepare_legacy_inventory || {
      err "legacy_inventory_failed: il team resta fermo perché l'inventario Telegram host non è stato conservato."
      exit 1
    }
    compose up -d
    container_postcheck_running || exit 1
    broker_migrate_legacy_once
    ;;

  down|stop-container)
    require_compose_file
    require_docker
    container_up >/dev/null || {
      err "Container JHT non attestabile; arresto negato."
      exit 1
    }
    compose down
    ;;

  restart)
    require_compose_file
    require_docker
    container_up >/dev/null || {
      err "Container JHT non attestabile; riavvio negato."
      exit 1
    }
    compose restart "$CONTAINER_SERVICE"
    container_postcheck_running || exit 1
    ;;

  recreate)
    require_compose_file
    require_docker
    container_up >/dev/null || {
      err "Container JHT non attestabile; ricreazione negata."
      exit 1
    }
    ensure_bind_owner
    compose down
    telegram_prepare_legacy_inventory || {
      err "legacy_inventory_failed: il team resta fermo perché l'inventario Telegram host non è stato conservato."
      exit 1
    }
    compose up -d
    container_postcheck_running || exit 1
    broker_migrate_legacy_once
    ;;

  upgrade)
    handle_runtime_upgrade "${@:2}"
    ;;

  mail)
    require_compose_file
    require_docker
    mail_command "${@:2}"
    exit $?
    ;;

  telegram)
    require_compose_file
    require_docker
    ensure_up
    telegram_command "${@:2}"
    exit $?
    ;;

  reset)
    require_compose_file
    require_docker
    reset_command "${@:2}"
    exit $?
    ;;

  logs)
    require_docker
    shift || true
    container_id="$(read_only_container_id)" || {
      err "Container JHT non attestabile; lettura log negata."
      exit 1
    }
    # Passa eventuali flag (-f, --tail N) a docker logs.
    docker logs "$@" "$container_id"
    ;;

  status)
    # Probe pura: `status` non deve avviare la machine Podman, Docker Desktop
    # o il container. Solo l'arm esplicito `up` puo' accendere la machine.
    # Una machine che vede tutto il Mac non risulta "attiva" nemmeno qui.
    require_confined_podman_machine
    if ! docker_reachable; then
      printf "container '%s' non attivo\n" "$CONTAINER_SERVICE"
      exit 1
    fi
    if container_id="$(read_only_container_id)"; then
      docker inspect "$container_id" --format \
        'name={{.Name}} status={{.State.Status}} started={{.State.StartedAt}} image={{.Config.Image}}'
    else
      printf "container '%s' non attivo\n" "$CONTAINER_SERVICE"
      exit 1
    fi
    ;;

  shell)
    require_docker
    ensure_up
    docker exec $EXEC_FLAGS "$ATTESTED_CONTAINER_ID" bash
    ;;

  # ── OAuth login: lancia il CLI del provider (claude/codex/kimi) per il
  # device-flow OAuth. Comando dedicato perche' va eseguito in un terminale
  # separato durante il setup wizard (clack non rilascia bene il TTY).
  oauth-login|claude-login)
    require_compose_file
    require_docker
    ensure_up
    provider="$(docker exec "$ATTESTED_CONTAINER_ID" node -e \
      "try{const c=require('/jht_home/jht.config.json');process.stdout.write(String(c.active_provider||''))}catch{}" \
      2>/dev/null || true)"
    provider_lc="$(printf '%s' "$provider" | tr '[:upper:]' '[:lower:]')"
    case "$provider_lc" in
      openai|codex)
        docker exec $EXEC_FLAGS "$ATTESTED_CONTAINER_ID" codex login --device-auth
        ;;
      kimi|moonshot)
        docker exec $EXEC_FLAGS "$ATTESTED_CONTAINER_ID" kimi --yolo
        ;;
      claude|anthropic|'')
        docker exec $EXEC_FLAGS "$ATTESTED_CONTAINER_ID" claude --dangerously-skip-permissions
        ;;
      *)
        die "provider attivo non riconosciuto: $provider"
        ;;
    esac
    ;;

  # ── Setup: host-side preflight (swap, VPS detect) prima del wizard ────
  setup)
    require_compose_file
    require_docker
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
    # Rileggi host.env DOPO host-setup.sh: al primo setup il file non esiste
    # ancora quando parte il wrapper. Anche qui resta input non fidato e passa
    # esclusivamente dallo stesso parser allowlist, mai dalla shell.
    if host_env_value="$(jht_read_host_env_value "$HOST_ENV_FILE" JHT_HOST_TYPE)"; then
      JHT_HOST_TYPE="$host_env_value"
    fi
    if host_env_value="$(jht_read_host_env_value "$HOST_ENV_FILE" JHT_LANG)"; then
      JHT_LANG="$host_env_value"
    fi
    if host_env_value="$(jht_read_host_env_value "$HOST_ENV_FILE" JHT_USER_TZ)"; then
      JHT_USER_TZ="$host_env_value"
    fi
    unset host_env_value
    JHT_HOST_TYPE="${JHT_HOST_TYPE:-unknown}"
    ensure_up
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
    ;;

  # Download verificato dal CLI nel container, pubblicato atomically sul path
  # host quando l'utente passa --output.
  download)
    require_compose_file
    require_docker
    ensure_up
    handle_host_download "$ATTESTED_CONTAINER_ID" "${@:2}"
    ;;

  # ── Operativita': delegata al CLI Node nel container ───────────────────
  *)
    require_compose_file
    require_docker
    ensure_up
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
    ;;
esac

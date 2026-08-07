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

CONTAINER="${JHT_CONTAINER_NAME:-jht}"
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
  if [ "$(uname -s)" = "Darwin" ]; then
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
  [ "$owner" = "$(id -u)" ] || return 1
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
  } > "$tmp" || return 1
  chmod 600 "$tmp" || { rm -f "$tmp"; return 1; }
  mv -f "$tmp" "$RUNTIME_MANIFEST"
}

runtime_path_allowed() {
  local runtime_real runtime_declared wrapper_real bind_real docs_real
  runtime_real="$(cd -P "$RUNTIME_DIR" 2>/dev/null && pwd -P)" || return 1
  runtime_declared="${RUNTIME_DIR%/}"
  # Rifiuta anche symlink in qualunque antenato: il path dichiarato deve gia'
  # essere il path fisico canonico consumato dal daemon host.
  [ "$runtime_real" = "$runtime_declared" ] || return 1
  bind_real="$(cd -P "$HOME/.jht" 2>/dev/null && pwd -P)" || bind_real="$HOME/.jht"
  docs_real="$(cd -P "$HOME/Documents/Job Hunter Team" 2>/dev/null && pwd -P)" \
    || docs_real="$HOME/Documents/Job Hunter Team"
  case "$runtime_real/" in "$bind_real/"*|"$docs_real/"*) return 1 ;; esac
  [ "$COMPOSE_FILE" = "$RUNTIME_DIR/docker-compose.yml" ] || return 1
  [ "$HOST_SETUP_SCRIPT" = "$RUNTIME_DIR/host-setup.sh" ] || return 1
  wrapper_real="$(cd -P "$(dirname "$WRAPPER_PATH")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename "$WRAPPER_PATH")")" || return 1
  [ "$wrapper_real" = "$WRAPPER_PATH" ] || return 1
  case "$wrapper_real" in "$bind_real"/*|"$docs_real"/*) return 1 ;; esac
}

runtime_bundle_trusted() {
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
  grep -Fqx 'JHT_HOST_RUNTIME_PROTOCOL=1' "$WRAPPER_PATH" || return 1
  grep -Fqx 'JHT_HOST_SETUP_PROTOCOL=1' "$HOST_SETUP_SCRIPT" || return 1
  grep -Eq '^[[:space:]]*-[[:space:]]*jht-runtime-mask:/jht_home/runtime([[:space:]]|$)' "$COMPOSE_FILE" || return 1
}

runtime_bootstrap_release() {
  # Legacy ~/.jht/runtime is deliberately never read or copied. A missing
  # authority is rebuilt only from the selected release origin into a new
  # host-owned directory, then atomically published with its digest manifest.
  local stage release_base
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
  chmod 600 "$stage/docker-compose.yml"
  chmod 700 "$stage/host-setup.sh"
  if ! { mv "$stage/docker-compose.yml" "$COMPOSE_FILE" \
      && mv "$stage/host-setup.sh" "$HOST_SETUP_SCRIPT" \
      && rmdir "$stage" \
      && runtime_write_manifest \
      && runtime_bundle_trusted; }; then
    rm -f "$stage/docker-compose.yml" "$stage/host-setup.sh" \
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
  require_trusted_runtime || exit 1
}

compose() {
  require_trusted_runtime || return 1
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
  local host_output="" container_tmp="" host_tmp="" arg next
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
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "${download_env[@]}" \
      "$CONTAINER" node "$NODE_ENTRY" download "${rewritten[@]}"
    return $?
  fi

  if [ -e "$host_output" ] || [ -L "$host_output" ]; then
    err "il file di destinazione esiste gia: $host_output"
    return 1
  fi

  container_tmp="/tmp/jht-download-$$-${RANDOM:-0}"
  rewritten+=(--output "$container_tmp")
  local code
  if docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "${download_env[@]}" \
      "$CONTAINER" node "$NODE_ENTRY" download "${rewritten[@]}"; then
    code=0
  else
    code=$?
    docker exec "$CONTAINER" rm -f "$container_tmp" >/dev/null 2>&1 || true
    return "$code"
  fi

  local parent
  parent="$(dirname -- "$host_output")"
  if ! mkdir -p -- "$parent"; then
    err "impossibile creare la directory di destinazione: $parent"
    docker exec "$CONTAINER" rm -f "$container_tmp" >/dev/null 2>&1 || true
    return 1
  fi
  host_tmp="${host_output}.part-$$-${RANDOM:-0}"
  if ! docker cp "$CONTAINER:$container_tmp" "$host_tmp"; then
    err "copia del download verificato verso l'host non riuscita"
    rm -f -- "$host_tmp"
    docker exec "$CONTAINER" rm -f "$container_tmp" >/dev/null 2>&1 || true
    return 1
  fi
  docker exec "$CONTAINER" rm -f "$container_tmp" >/dev/null 2>&1 || true

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
  # Stesso preflight di `jht up`: su VPS installate da root l'immagine nuova
  # deve poter riaprire i bind mount al primo boot, non solo il container che
  # era gia' in vita prima dell'upgrade.
  ensure_bind_owner
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
  if ! upgrade_run upgrade_compose "$candidate_compose" pull "$CONTAINER"; then
    upgrade_remove_transaction
    upgrade_result false false pull "$old_version" "$old_image" "$old_version" "$old_image" false "Download immagine non riuscito" false
    return 1
  fi
  # Il compose nuovo e' la fonte di verita': non assumere che l'immagine
  # resti per sempre latest o che un override JHT_IMAGE punti allo stesso ref.
  candidate_ref="$(upgrade_compose "$candidate_compose" config --images 2>/dev/null | head -n 1)"
  candidate_image="$(docker image inspect "${candidate_ref:-${JHT_IMAGE:-ghcr.io/leopu00/jht:0.3.5}}" --format '{{.Id}}' 2>/dev/null || true)"
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
      || ! runtime_write_manifest \
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
  game)
    handle_game_command "${@:2}"
    ;;

  gui)
    handle_gui_command "${@:2}"
    ;;

  # ── Lifecycle: parlano direttamente al daemon Docker ───────────────────
  up|start-container)
    require_compose_file
    require_docker
    ensure_bind_owner
    compose up -d
    ;;

  down|stop-container)
    require_compose_file
    require_docker
    compose down
    ;;

  restart)
    require_compose_file
    require_docker
    compose restart "$CONTAINER"
    ;;

  recreate)
    require_compose_file
    require_docker
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
    require_compose_file
    require_docker
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
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$CONTAINER" node "$NODE_ENTRY" "$@"
    ;;

  # Download verificato dal CLI nel container, pubblicato atomically sul path
  # host quando l'utente passa --output.
  download)
    require_compose_file
    require_docker
    ensure_up
    handle_host_download "${@:2}"
    ;;

  # ── Operativita': delegata al CLI Node nel container ───────────────────
  '')
    require_compose_file
    require_docker
    ensure_up
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$CONTAINER" node "$NODE_ENTRY" --help
    ;;

  *)
    require_compose_file
    require_docker
    ensure_up
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$CONTAINER" node "$NODE_ENTRY" "$@"
    ;;
esac

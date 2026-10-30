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
# This wrapper has the chat actions `desktop-chat read` and `desktop-chat chat-send`. The app asks for this
# marker before it calls them, so a wrapper without it is told apart by name, never by an exit code.
JHT_DESKTOP_CHAT_FIXED=1
# And `desktop-chat chat-answer` and `desktop-chat chat-enter`, which came later: the app asks for this
# second marker before it calls them.
JHT_DESKTOP_CHAT_ANSWER=1
JHT_ONBOARDING_SNAPSHOT_PROTOCOL=1
# Il pannello agenti del desktop chiama `agent-control` solo se trova questa
# riga: un wrapper che non la ha passerebbe il comando al ramo generico, che
# avvia il container.
JHT_AGENT_CONTROL_PROTOCOL=1

# Sistema e utente non cambiano durante una run: si leggono una volta sola. I
# controlli d'integrita' del runtime (runtime_stat, runtime_node_safe) li
# chiedevano per ogni file: un `uname` e un `id` a ogni stat, centinaia di
# processi in un solo `jht upgrade`.
HOST_KERNEL="$(uname -s)"
HOST_UID="$(id -u)"

CONTAINER_SERVICE="jht"
# I servizi del compose: agenti e i due servizi isolati.
COMPOSE_SERVICES="jht jht-broker jht-telegram"
RUNTIME_MIGRATION_VOLUMES="jht-broker-state jht-secrets jht-telegram-secrets jht-telegram-state"
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
RUNTIME_MIGRATION_MARKER="$RUNTIME_DIR/.runtime-migrated-podman"
# Canale di test: install.sh --image fissa qui l'immagine verificata del suo
# commit (ref canonico per digest). Sta nel runtime host, fuori dai mount del
# container, ed e' coperto dal manifest: nessuna variabile d'ambiente serve
# ai `jht up` successivi. Assente = produzione (immagine del compose).
RUNTIME_IMAGE_PIN="$RUNTIME_DIR/runtime-image"
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
PODMAN_RUNTIME_MODE=""
if [ "$CONTAINER_RUNTIME" = "podman" ]; then
  case "$HOST_KERNEL" in
    Darwin) PODMAN_RUNTIME_MODE="machine" ;;
    Linux) PODMAN_RUNTIME_MODE="native" ;;
    *) err_runtime="Podman runtime is unsupported on this host" ;;
  esac
  if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
    if [ -f "$PODMAN_MACHINE_FILE" ]; then
      PODMAN_MACHINE_NAME="$(tr -d '\r\n' < "$PODMAN_MACHINE_FILE")"
    fi
    case "$PODMAN_MACHINE_NAME" in
      ''|*[!A-Za-z0-9_.-]*) err_runtime="invalid attested Podman machine" ;;
    esac
    if [ -n "$PODMAN_MACHINE_OVERRIDE" ] \
        && [ "$PODMAN_MACHINE_OVERRIDE" != "$PODMAN_MACHINE_NAME" ]; then
      err_runtime="Podman machine override does not match the attested runtime"
    fi
  elif [ -n "$PODMAN_MACHINE_OVERRIDE" ]; then
    err_runtime="Podman machine override is invalid for native Linux"
  fi
  export PATH="$PODMAN_ADAPTER_BIN:$PATH"
  unset CONTAINER_CONNECTION
  # Native Podman runs locally unless something turns its remote mode on: a
  # default system connection alone does not, CONTAINER_HOST does (and
  # remote = true in containers.conf, which the probe below refuses).
  if [ "$PODMAN_RUNTIME_MODE" = "native" ]; then unset CONTAINER_HOST; fi
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

# I tre valori che decidono come il container viene CREATO e ATTESTATO (tipo di host, lingua, fuso) NON vengono da host.env:
# ~/.jht e' montata read-write nel container, quindi un agente puo' scriverci JHT_HOST_TYPE=vps (alla prossima creazione il
# runtime locale diventa «vps»: pairing, daemon cloud, watcher di cloud.json) o cambiare lingua e fuso (l'hash atteso cambia e
# l'app non attesta piu'). Vengono da $RUNTIME_DIR/host-values: la cartella del runtime NON e' montata, e' dell'utente (0700), e
# il file lo scrive host-setup.sh insieme a host.env. host.env resta il file che leggono i componenti DENTRO il container.
# Un'installazione precedente non ha host-values: la prima esecuzione lo crea dai valori di host.env (validati) e da quel
# momento host.env non conta piu' per il wrapper. Un host-values che non e' del proprietario, e' un link o e' scrivibile da
# altri non si legge e non si sovrascrive: si torna ai valori di host.env, come prima.
HOST_VALUES_FILE="$RUNTIME_DIR/host-values"

# Lo stesso controllo dei nodi del runtime (non e' un link, e' un file dell'utente, ne' il gruppo ne' gli altri possono scriverlo:
# anche 0620 e 0602 sono rifiutati) e, sul Mac, lo stesso dell'app.
jht_host_values_trusted() {
  runtime_node_safe "$HOST_VALUES_FILE" file
}

# Una riga nel registro accanto a host-values, solo se la cartella del runtime e' dell'utente e il registro non e' un link (ne' un
# file scrivibile da altri); un registro oltre i 64 KiB non cresce piu'.
jht_host_values_log() {
  local log="$RUNTIME_DIR/host-values.log" size=0
  runtime_node_safe "$RUNTIME_DIR" dir || return 0
  [ ! -L "$log" ] || return 0
  [ ! -e "$log" ] || runtime_node_safe "$log" file || return 0
  if [ -e "$log" ]; then size="$(wc -c < "$log" 2>/dev/null)" || size=0; size=$((size)); fi
  [ "$size" -le 65536 ] || return 0
  ( umask 077; printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >> "$log" ) 2>/dev/null || true
}

# Un Mac non e' mai una VPS: un «vps» preso da host.env o dall'ambiente (scrivibili dagli agenti) diventa «local». Vale ogni volta che
# il tipo non viene da host-values fidato: alla prima registrazione, se host-values c'e' ma non e' fidato, e se il file fidato non
# dice il tipo; l'app fa lo stesso (direct_chat.rs). Il messaggio sul terminale una volta sola, quando host-values non c'e' ancora; il registro ogni volta.
# (warn() e i colori sono definiti piu' sotto: qui si scrive su stderr direttamente)
jht_a_mac_is_never_a_vps() {
  if [ "$HOST_KERNEL" != "Darwin" ] || [ "$JHT_HOST_TYPE" != "vps" ]; then return 0; fi
  JHT_HOST_TYPE="local"
  if [ ! -e "$HOST_VALUES_FILE" ] && [ ! -L "$HOST_VALUES_FILE" ]; then
    printf 'warn:  %s\n' "su un Mac il tipo di host non puo' essere «vps»: JHT_HOST_TYPE letto da host.env o dall'ambiente e' stato registrato come «local»" >&2
  fi
  jht_host_values_log "host.env o ambiente dicevano JHT_HOST_TYPE=vps su macOS: usato local"
}

jht_load_host_values() {
  local source_file="$HOST_ENV_FILE" key value type_from_values=0
  ! jht_host_values_trusted || source_file="$HOST_VALUES_FILE"
  for key in JHT_HOST_TYPE JHT_LANG JHT_USER_TZ; do
    if value="$(jht_read_host_env_value "$source_file" "$key")"; then
      printf -v "$key" '%s' "$value"
      if [ "$source_file" = "$HOST_VALUES_FILE" ] && [ "$key" = JHT_HOST_TYPE ]; then type_from_values=1; fi
    fi
  done
  JHT_HOST_TYPE="${JHT_HOST_TYPE:-unknown}"
  JHT_LANG="${JHT_LANG:-en}"
  # Bug #15: timezone utente esplicita dal setup wizard. Default UTC se mai
  # configurata — niente hardcoding geografico (l'utente potrebbe stare
  # ovunque). Il container la usa via format_time skill.
  JHT_USER_TZ="${JHT_USER_TZ:-UTC}"
  # Il tipo che non viene dal file fidato (host.env, o l'ambiente quando il file non lo dice) passa dalla regola del Mac.
  if [ "$type_from_values" -ne 1 ]; then jht_a_mac_is_never_a_vps; fi
}

# Prima esecuzione dopo un aggiornamento: registra i valori ora in uso. Solo se il file non c'e' (ne' come link) e la cartella
# del runtime esiste ed e' dell'utente; scrive un temporaneo e lo rinomina.
jht_record_host_values() {
  [ ! -e "$HOST_VALUES_FILE" ] && [ ! -L "$HOST_VALUES_FILE" ] || return 0
  [ -d "$RUNTIME_DIR" ] && [ ! -L "$RUNTIME_DIR" ] && [ -O "$RUNTIME_DIR" ] || return 0
  local tmp="$HOST_VALUES_FILE.tmp.$$"
  (
    umask 077
    printf 'JHT_HOST_TYPE=%s\nJHT_LANG=%s\nJHT_USER_TZ=%s\n' "$JHT_HOST_TYPE" "$JHT_LANG" "$JHT_USER_TZ" > "$tmp"
  ) 2>/dev/null && chmod 600 "$tmp" 2>/dev/null && mv -f -- "$tmp" "$HOST_VALUES_FILE" 2>/dev/null || rm -f -- "$tmp" 2>/dev/null
  return 0
}

jht_load_host_values
jht_record_host_values
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
      if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
        printf 'podman-machine=%s\n' "$(runtime_sha256 "$PODMAN_MACHINE_FILE")"
      fi
      printf 'docker-shim=%s\n' "$(runtime_sha256 "$DOCKER_SHIM")"
    fi
    if [ -f "$RUNTIME_IMAGE_PIN" ]; then
      printf 'runtime-image=%s\n' "$(runtime_sha256 "$RUNTIME_IMAGE_PIN")"
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
    runtime_node_safe "$DOCKER_SHIM" file || return 1
    [ "$(tr -d '\r\n' < "$RUNTIME_SELECTION_FILE")" = "podman" ] || return 1
    if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
      runtime_node_safe "$PODMAN_MACHINE_FILE" file || return 1
      case "$(tr -d '\r\n' < "$PODMAN_MACHINE_FILE")" in
        ''|*[!A-Za-z0-9_.-]*) return 1 ;;
      esac
      [ "$(runtime_manifest_value podman-machine)" = "$(runtime_sha256 "$PODMAN_MACHINE_FILE")" ] || return 1
    else
      [ ! -e "$PODMAN_MACHINE_FILE" ] && [ ! -L "$PODMAN_MACHINE_FILE" ] || return 1
      [ -z "$(runtime_manifest_value podman-machine)" ] || return 1
    fi
    [ "$(runtime_manifest_value docker-shim)" = "$(runtime_sha256 "$DOCKER_SHIM")" ] || return 1
    grep -Fqx '# JHT_PODMAN_DOCKER_SHIM=1' "$DOCKER_SHIM" || return 1
  fi
  if [ -e "$RUNTIME_IMAGE_PIN" ] || [ -L "$RUNTIME_IMAGE_PIN" ]; then
    runtime_node_safe "$RUNTIME_IMAGE_PIN" file || return 1
    [ "$(runtime_manifest_value runtime-image)" = "$(runtime_sha256 "$RUNTIME_IMAGE_PIN")" ] || return 1
    runtime_image_pin_value >/dev/null || return 1
  elif [ -n "$(runtime_manifest_value runtime-image)" ]; then
    # Il manifest attesta un pin che non c'e' piu': tornare in silenzio
    # all'immagine di produzione cambierebbe canale senza che nessuno lo chieda.
    return 1
  fi
  grep -Fqx 'JHT_HOST_RUNTIME_PROTOCOL=1' "$WRAPPER_PATH" || return 1
  grep -Fqx 'JHT_HOST_SETUP_PROTOCOL=1' "$HOST_SETUP_SCRIPT" || return 1
  grep -Eq '^[[:space:]]*-[[:space:]]*jht-runtime-mask:/jht_home/runtime([[:space:]]|$)' "$COMPOSE_FILE" || return 1
}

# Il ref del pin, solo nella forma canonica scritta da install.sh.
runtime_image_pin_value() {
  local value
  [ -f "$RUNTIME_IMAGE_PIN" ] || return 1
  [ "$(wc -l < "$RUNTIME_IMAGE_PIN" | tr -d ' ')" = "1" ] || return 1
  value="$(tr -d '\n' < "$RUNTIME_IMAGE_PIN")"
  printf '%s' "$value" | grep -Eqx 'ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64}' || return 1
  printf '%s\n' "$value"
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
  # Il pin del canale di test vince su un JHT_IMAGE dell'ambiente: il canale
  # e' deciso all'installazione, non da chi lancia il comando.
  if [ -f "$RUNTIME_IMAGE_PIN" ]; then
    JHT_IMAGE="$(runtime_image_pin_value)" || return 1
    export JHT_IMAGE
  fi
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
  require_rootless_podman_native
  if ! docker info >/dev/null 2>&1; then
    if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
      err "Podman machine JHT non attiva. Esegui 'jht up' per avviarla."
    elif [ "$PODMAN_RUNTIME_MODE" = "native" ]; then
      err "podman_rootless_unavailable: il runtime Podman rootless non risponde."
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
running_podman_machine() {
  local podman_bin="$1" name running
  "$podman_bin" machine list --format '{{.Name}} {{.Running}}' 2>/dev/null |
    while IFS=' ' read -r name running _; do
      case "$name" in
        ''|*[!A-Za-z0-9_.-]*) continue ;;
      esac
      if [ "$running" = true ] && [ "$name" != "$PODMAN_MACHINE_NAME" ]; then
        printf '%s\n' "$name"
        break
      fi
    done
}

start_jht_podman_machine() {
  local podman_bin="$1" start_error start_status running
  start_error="$("$podman_bin" machine start --update-connection=false "$PODMAN_MACHINE_NAME" 2>&1 >/dev/null)" \
    && start_status=0 || start_status=$?
  [ "$start_status" -eq 0 ] && return 0
  if printf '%s\n' "$start_error" | grep -Fqi 'only one VM can be active at a time'; then
    running="$(running_podman_machine "$podman_bin")"
    if [ -n "$running" ]; then
      printf 'JHT_OTHER_MACHINE %s\n' "$running"
      err "podman_other_machine_running: un'altra macchina Podman, $running, e' accesa: spegnila con 'podman machine stop $running' e riprova."
    else
      err "podman_other_machine_running: un'altra macchina Podman e' accesa: trovala con 'podman machine list', spegnila con 'podman machine stop <nome>' e riprova."
    fi
    return 79
  fi
  return 1
}

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
  require_rootless_podman_native
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
    local podman_bin
    podman_bin="$(podman_binary)" || podman_bin=""
    [ -n "$podman_bin" ] || { err "Podman non trovato: reinstalla il runtime JHT."; exit 127; }
    ensure_podman_mount_dirs \
      || { err "Non riesco a creare ~/.jht o ~/Documents/Job Hunter Team per la macchina Podman."; exit 1; }
    info "Podman machine '$PODMAN_MACHINE_NAME' non attiva, la avvio..."
    if start_jht_podman_machine "$podman_bin"; then
      :
    else
      local start_status=$?
      [ "$start_status" -eq 79 ] && exit 79
      err "Podman machine non avviabile; Colima non e' stato modificato."
      exit 1
    fi
  elif [ "$PODMAN_RUNTIME_MODE" = "native" ]; then
    err "podman_rootless_unavailable: il runtime Podman rootless non risponde."
    exit 1
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
  start_jht_podman_machine "$podman_bin" \
    || return $?
}

enable_podman_trim_timer() {
  local podman_bin="$1"
  "$podman_bin" machine ssh "$PODMAN_MACHINE_NAME" \
    sudo systemctl enable --now fstrim.timer >/dev/null 2>&1
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
# The size of the machine the installer creates (scripts/install.sh, the same
# three numbers). The recreation uses them too: without them `podman machine
# init` falls back to Podman's own default (2048 MiB of memory), which is
# below what the team needs.
PODMAN_MACHINE_CPUS=2
PODMAN_MACHINE_MEMORY_MIB=4096
PODMAN_MACHINE_DISK_GIB=30

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
  [ "$PODMAN_RUNTIME_MODE" = "machine" ] || return 0
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

# The local Podman of this user, rootless: the client answers for itself
# (ServiceIsRemote false), so a remote service never stands in for it.
PODMAN_NATIVE_REMOTE=0
podman_native_rootless() {
  [ "$PODMAN_RUNTIME_MODE" = "native" ] || return 0
  [ "$HOST_UID" -ne 0 ] || return 1
  local podman_bin state
  podman_bin="$(podman_binary)" || return 1
  state="$("$podman_bin" info --format '{{.Host.Security.Rootless}} {{.Host.ServiceIsRemote}}' 2>/dev/null)" || return 1
  PODMAN_NATIVE_REMOTE=0
  case "$state" in *" true") PODMAN_NATIVE_REMOTE=1; return 1 ;; esac
  [ "$state" = "true false" ]
}

require_rootless_podman_native() {
  [ "$PODMAN_RUNTIME_MODE" = "native" ] || return 0
  podman_native_rootless && return 0
  if [ "$PODMAN_NATIVE_REMOTE" -eq 1 ]; then
    err "podman_remote_service_refused: su Linux JHT usa solo il Podman locale di questo utente, ma il client podman parla con un servizio remoto."
    err "Togli remote = true da containers.conf (o CONTAINERS_CONF) per questo utente e riprova."
    exit 1
  fi
  err "podman_rootful_refused: JHT su Linux richiede Podman rootless eseguito da un utente non root."
  err "Accedi con l'utente JHT rootless configurato dall'installazione e riprova."
  exit 1
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

# podman-compose 1.6.0 looks for `podman` in PATH at its own start (`podman version`), whatever --podman-path says. The wrapper
# finds podman by its usual places (/opt/homebrew/bin, /usr/local/bin) when the caller's PATH has none of them: a terminal
# opened from the app, a script, `env -i`. Then every call of the provider, the `--version` probes included, died with
# «failed to check if podman is installed», the wrapper read that as «no provider» and `status` said «container 'jht' non
# attivo» for a team that was running (TEST 19g). The directory of the podman it found goes at the END of the wrapper's own PATH (it
# takes priority from nothing that is there; what runs in a $(...) loses it, what runs directly keeps it until the wrapper ends).
podman_ensure_on_path() {
  local podman_bin dir
  podman_bin="$(podman_binary)" || return 0
  dir="${podman_bin%/*}"
  case ":$PATH:" in
    *":$dir:"*) ;;
    *) PATH="$PATH:$dir"; export PATH ;;
  esac
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

# Linux nativo: le versioni di macOS (esatte, quelle provate sulla Machine)
# diventano un MINIMO, lo stesso di install.sh: podman 5.0.0 e podman-compose
# 1.1.0 (la 1.1.0 e' la prima con `--verbose --dry-run` e la label
# `io.podman.compose.config-hash` che l'attestazione del container legge).
# Ubuntu 26.04 porta con apt podman 5.7.0 e podman-compose 1.5.0 (universe).
# Un provider che non scrivesse la label fa rifiutare l'attestazione: si chiude,
# non si accetta mai un container non verificato.
PODMAN_NATIVE_MIN_VERSION="5.0.0"
PODMAN_COMPOSE_NATIVE_MIN_VERSION="1.1.0"

# Come install.sh: dei numeri iniziali conta quel che sta prima del primo carattere che non
# e' una cifra o un punto, il resto (`+ds1`, `~rc1`, `-dev`) si scarta. I pacchetti di Ubuntu
# e Debian hanno suffissi cosi' (`5.4.2+ds1`): rifiutarli darebbe un errore tardivo.
version_leading_numbers() {
  printf '%s\n' "$1" | sed 's/[^0-9.].*$//'
}

# $1 >= $2, confronto numerico per componente (10 > 9); componenti mancanti valgono 0.
version_at_least() {
  local have want a1 a2 a3 b1 b2 b3
  have="$(version_leading_numbers "$1")"
  want="$(version_leading_numbers "$2")"
  case "$have" in ''|.*|*..*) return 1 ;; esac
  case "$want" in ''|.*|*..*) return 1 ;; esac
  IFS=. read -r a1 a2 a3 _ <<EOF
$have
EOF
  IFS=. read -r b1 b2 b3 _ <<EOF
$want
EOF
  a1="${a1:-0}" a2="${a2:-0}" a3="${a3:-0}" b1="${b1:-0}" b2="${b2:-0}" b3="${b3:-0}"
  [ "$((10#$a1))" -ne "$((10#$b1))" ] && { [ "$((10#$a1))" -gt "$((10#$b1))" ]; return; }
  [ "$((10#$a2))" -ne "$((10#$b2))" ] && { [ "$((10#$a2))" -gt "$((10#$b2))" ]; return; }
  [ "$((10#$a3))" -ge "$((10#$b3))" ]
}

# La versione di podman e quella di podman-compose, dalle righe di --version.
podman_version_number() {
  local podman_bin="$1" line
  line="$("$podman_bin" --version 2>/dev/null)" || return 1
  case "$line" in 'podman version '*) printf '%s\n' "${line#podman version }" ;; *) return 1 ;; esac
}

podman_compose_version_number() {
  local compose_bin="$1" out
  podman_ensure_on_path
  if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
    out="$(CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME" "$compose_bin" --version 2>/dev/null)" || return 1
  else
    out="$("$compose_bin" --version 2>/dev/null)" || return 1
  fi
  printf '%s\n' "$out" | sed -n 's/^podman-compose version \([^ ]*\)$/\1/p' | head -n 1
}

podman_compose_pair_supported() {
  local podman_bin="$1" compose_bin="$2" podman_version compose_version
  podman_ensure_on_path
  if [ "$PODMAN_RUNTIME_MODE" = "native" ]; then
    podman_version="$(podman_version_number "$podman_bin")" || return 1
    version_at_least "$podman_version" "$PODMAN_NATIVE_MIN_VERSION" || return 1
    compose_version="$(podman_compose_version_number "$compose_bin")" || return 1
    version_at_least "$compose_version" "$PODMAN_COMPOSE_NATIVE_MIN_VERSION"
    return
  fi
  podman_version="$("$podman_bin" --version 2>/dev/null)" || return 1
  [ "$podman_version" = 'podman version 6.1.3' ] || return 1
  compose_version="$(CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME" \
    "$compose_bin" --version 2>/dev/null)" || return 1
  printf '%s\n' "$compose_version" | grep -Fqx 'podman-compose version 1.6.0'
}

# Linux nativo + Podman rootless: senza mappa degli uid, l'uid 1001 del
# container cade in un subuid dell'host e ~/.jht (dell'utente, uid 1000) non
# e' scrivibile. `keep-id:uid=1001,gid=1001` mappa l'utente dell'host
# sull'1001 del container, come fa l'override per Windows. Lo stesso per il
# broker e per il servizio Telegram: client e server devono vedere gli stessi uid
# in SO_PEERCRED. Il contenuto e' QUESTO, nel wrapper (attestato col wrapper), e
# viene riscritto a ogni uso se differisce: un file lasciato li' e modificato
# non arriva mai a un `up`. Serve un percorso fisso: il container ne porta il nome
# nella label `config_files`.
podman_native_override_path() {
  printf '%s\n' "$RUNTIME_DIR/docker-compose.podman-linux.yml"
}

podman_native_override_ensure() {
  local file="$1" target tmp content
  target="$(podman_native_override_path)"
  content='services:
  jht:
    userns_mode: "keep-id:uid=1001,gid=1001"'
  grep -Eq '^  jht-broker:' "$file" 2>/dev/null && content="$content
  jht-broker:
    userns_mode: \"keep-id:uid=1001,gid=1001\""
  grep -Eq '^  jht-telegram:' "$file" 2>/dev/null && content="$content
  jht-telegram:
    userns_mode: \"keep-id:uid=1001,gid=1001\""
  [ ! -L "$target" ] || return 1
  if [ -f "$target" ] && [ "$(cat "$target" 2>/dev/null)" = "$content" ]; then
    printf '%s\n' "$target"
    return 0
  fi
  # Nome imprevedibile, nella stessa cartella (stesso filesystem: il mv e' atomico), 0600.
  tmp="$(mktemp "$target.XXXXXX")" || return 1
  { printf '%s\n' "$content" > "$tmp" && mv -f "$tmp" "$target"; } || { rm -f "$tmp"; return 1; }
  printf '%s\n' "$target"
}

# Linux nativo: niente pod. podman-compose mette i servizi in un pod per default,
# e Podman rifiuta lo userns per container (il keep-id dell'override) dentro un
# pod: «--userns and --pod cannot be set together», e nessun container nasce.
# Il flag giusto dipende dalla versione, e non ce n'e' uno valido per tutte:
#   - 1.1.x: `--in-pod` e' un bool() di Python, ogni stringa non vuota vale vero
#     («false» compreso): spegne il pod solo il valore vuoto; `x-podman: in_pod`
#     li' non esiste;
#   - dalla 1.2.0: «false» spegne il pod, il valore vuoto torna al default (pod).
# Lo stesso flag su ogni chiamata (up, ps, down, il dry-run dell'attestazione):
# la config-hash e' quella del compose unito, il pod non la cambia.
podman_native_no_pod_arg() {
  local version
  version="$(podman_compose_version_number "$1")" || return 1
  if version_at_least "$version" 1.2.0; then
    printf '%s\n' '--in-pod=false'
  else
    printf '%s\n' '--in-pod='
  fi
}

# Tetto di `up` sul Linux nativo. Dalla 1.3.0 podman-compose, prima di avviare un
# servizio, aspetta le sue dipendenze (depends_on) con `podman wait` in un ciclo
# senza fine: se un container non e' mai stato creato, `up -d` non esce piu'. Il
# runtime e' gia' scaricato dall'installazione: su un VPS con Ubuntu 26.04
# (podman 5.7.0, podman-compose 1.5.0) `up -d` ci mette 15 s. Il default e' 300 s;
# JHT_PODMAN_UP_TIMEOUT_S lo cambia (secondi interi, 1-3600), un valore diverso
# non vale e resta il default.
PODMAN_NATIVE_UP_TIMEOUT=300
case "${JHT_PODMAN_UP_TIMEOUT_S:-}" in
  ''|*[!0-9]*) ;;
  *) [ "${#JHT_PODMAN_UP_TIMEOUT_S}" -le 4 ] && [ "$((10#$JHT_PODMAN_UP_TIMEOUT_S))" -ge 1 ] \
       && [ "$((10#$JHT_PODMAN_UP_TIMEOUT_S))" -le 3600 ] && PODMAN_NATIVE_UP_TIMEOUT="$((10#$JHT_PODMAN_UP_TIMEOUT_S))" ;;
esac

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
  # -i: `podman run` forwards its stdin to the container only with it; without it the tar inside
  # reads nothing («This does not look like a tar archive») and the saved state is not restored.
  "$podman_bin" --connection "$PODMAN_MACHINE_NAME" run --rm -i \
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
  # a compose that can change the containers (up, down, stop, restart, rm…) leaves no attestation behind, before or after
  case "${2:-}" in
    ps|config|version) compose_file_run "$@"; return $? ;;
  esac
  local status=0
  attest_cache_clear
  compose_file_run "$@" || status=$?
  attest_cache_clear
  return "$status"
}

compose_file_run() {
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
    podman_ensure_on_path
    podman_bin="$(podman_binary)" || { err "Podman non trovato: reinstalla il runtime JHT."; return 127; }
    if ! compose_bin="$(podman_compose_binary)"; then
      if [ "$PODMAN_RUNTIME_MODE" = "native" ]; then
        # `podman compose` non basta: delega al primo provider che trova (docker-compose,
        # prima di podman-compose), e il wrapper si fida solo delle label di podman-compose.
        err "podman-compose non trovato: installa il pacchetto «podman-compose» (su Ubuntu: sudo apt install podman-compose)."
      else
        err "Provider Podman Compose non trovato: reinstalla il runtime JHT."
      fi
      return 127
    fi
    if ! podman_compose_pair_supported "$podman_bin" "$compose_bin"; then
      if [ "$PODMAN_RUNTIME_MODE" = "native" ]; then
        err "Versione non supportata: servono podman >= $PODMAN_NATIVE_MIN_VERSION (trovato: $(podman_version_number "$podman_bin" || echo '?')) e podman-compose >= $PODMAN_COMPOSE_NATIVE_MIN_VERSION (trovato: $(podman_compose_version_number "$compose_bin" || echo '?'))."
      else
        err "Versione Podman Compose non supportata dal runtime JHT."
      fi
      return 1
    fi
    if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
      "$podman_bin" --connection "$PODMAN_MACHINE_NAME" info >/dev/null 2>&1 \
        || { err "La connessione Podman JHT non supporta il dispatcher Compose."; return 1; }
      (
        cd "$RUNTIME_DIR" || return 1
        CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME" \
        PODMAN_COMPOSE_WARNING_LOGS=false \
          "$compose_bin" --podman-path "$podman_bin" -p "$project" -f "$file" "$@"
      )
      return $?
    else
      podman_native_rootless \
        || { err "Il runtime Podman rootless locale non risponde."; return 1; }
      local override no_pod status=0
      override="$(podman_native_override_ensure "$file")" \
        || { err "Override Compose per Podman rootless non scrivibile in $RUNTIME_DIR."; return 1; }
      no_pod="$(podman_native_no_pod_arg "$compose_bin")" \
        || { err "Versione di podman-compose non leggibile."; return 1; }
      local cap=()
      if [ "${1:-}" = "up" ] && command -v timeout >/dev/null 2>&1; then
        cap=(timeout --kill-after=10 "$PODMAN_NATIVE_UP_TIMEOUT")
      fi
      (
        cd "$RUNTIME_DIR" || return 1
        unset CONTAINER_CONNECTION
        PODMAN_COMPOSE_WARNING_LOGS=false \
          ${cap[@]+"${cap[@]}"} "$compose_bin" "$no_pod" --podman-path "$podman_bin" -p "$project" -f "$file" -f "$override" "$@"
      ) || status=$?
      if [ "${1:-}" = "up" ] && [ "$status" -ne 0 ]; then
        if [ "${#cap[@]}" -gt 0 ] && { [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; }; then
          err "compose_up_timeout: podman-compose up non ha finito in ${PODMAN_NATIVE_UP_TIMEOUT}s ed e' stato fermato. Un servizio non e' partito: guarda «podman ps -a» e «podman logs jht»."
          return 124
        fi
        err "compose_up_failed: podman-compose up e' uscito con $status. L'errore di Podman e' qui sopra."
      fi
      return $status
    fi
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

# The image references of a compose file, one per line. Docker Compose answers
# `config --images`; podman-compose 1.6.0 does not know the option (it exits 2
# with its usage text), so there the normalized `config` is read for its
# `image:` keys. Nothing is silenced here: a failure says why.
compose_file_images() {
  local file="$1" config
  if [ "$CONTAINER_RUNTIME" != "podman" ]; then
    compose_file "$file" config --images
    return
  fi
  config="$(compose_file "$file" config)" || return 1
  printf '%s\n' "$config" | sed -n 's/^[[:space:]]*image:[[:space:]]*//p' | tr -d "\"'" | sed 's/[[:space:]]*$//'
}

compose_images() {
  require_trusted_runtime || return 1
  compose_file_images "$COMPOSE_FILE"
}

container_up() {
  local container_id
  container_id="$(read_only_container_id)" || return $?
  ATTESTED_CONTAINER_ID="$container_id"
}

# `read_only_container_id` distingue un progetto assente (3) da un risultato
# ambiguo/non posseduto (1). Solo il primo puo' essere creato da un'azione che
# ha gia' autorizzato esplicitamente una mutazione.
# Any container of the project that runs (the broker, Telegram): `compose down` would stop it too.
# A list that cannot be read counts as running.
project_has_running_container() {
  local ids id
  ids="$(compose ps -q 2>/dev/null)" || return 0
  for id in $ids; do
    [ "$(docker inspect --type container "$id" --format '{{.State.Running}}' 2>/dev/null)" = false ] || return 0
  done
  return 1
}

container_mutation_preflight() {
  local status=0
  if read_only_container_id >/dev/null; then
    return 0
  else
    status=$?
  fi
  [ "$status" -eq 3 ] && return 0
  # The containers of an earlier version (the compose changed, so its config hash did) that are
  # STOPPED: nothing runs to interrupt. They are ours (project, service, unit, files, version all
  # as expected, only the hash differs) and are recreated with the new configuration; `compose down`
  # removes containers and the network, never the volumes: the team's data stays.
  if [ "$status" -eq 1 ] && [ "$CONTAINER_RUNTIME" = podman ] \
      && read_only_service_id "$CONTAINER_SERVICE" stopped-stale-config >/dev/null 2>&1 \
      && ! project_has_running_container; then
    warn "config_changed_stopped: i container del team, fermi, sono della versione di prima: li ricreo con la configurazione nuova (i volumi con i dati restano)."
    compose down || { err "Non riesco a rimuovere i container fermi della versione di prima: «jht down», poi «jht up»."; return 1; }
    return 0
  fi
  err "Container JHT esistente non attestabile; operazione interrotta."
  stale_config_hint
  return 1
}

# Il team gira con la configurazione di prima di una reinstallazione: si puo'
# solo fermare (jht down) e riavviare con quella nuova (jht up).
stale_config_hint() {
  [ "$CONTAINER_RUNTIME" = podman ] || return 0
  read_only_service_id "$CONTAINER_SERVICE" any-config >/dev/null 2>&1 || return 0
  err "config_changed_while_running: il team e' stato avviato con la configurazione di prima della reinstallazione. Fermalo con «jht down», poi avvialo con «jht up»."
}

# `jht down`: il container attestato, oppure quello avviato prima di una
# reinstallazione (stesso progetto, solo la config-hash e' cambiata): fermarlo
# e' l'unica strada per ripartire con la configurazione nuova.
container_down() {
  if ! container_up >/dev/null; then
    if [ "$CONTAINER_RUNTIME" = podman ] && read_only_service_id "$CONTAINER_SERVICE" any-config >/dev/null; then
      warn "config_changed_while_running: il team era stato avviato con la configurazione di prima della reinstallazione; lo fermo."
    else
      err "Container JHT non attestabile; arresto negato."
      return 1
    fi
  fi
  local status=0 errors
  errors="$(mktemp "${TMPDIR:-/tmp}/jht-down.XXXXXX")" || { compose down; return $?; }
  compose down 2>"$errors" || status=$?
  local shown left
  shown="$(rootless_netns_noise_filter <"$errors")"
  [ -z "$shown" ] || printf '%s\n' "$shown" >&2
  rm -f "$errors"
  # Podman exits non-zero with only that error even though the containers are gone:
  # what «fermo» says is then what exit says, once the project has no container left.
  if [ "$status" -ne 0 ] && [ "$(printf '%s\n' "$shown" | wc -l)" -eq 1 ]; then
    case "$shown" in
      "nota: il processo di rete del team era gia' chiuso"*)
        # podman-compose lists every container of the project (broker and telegram too):
        # an empty answer, and not a failed one, is «nothing left».
        left="$(compose ps -q 2>/dev/null)" && [ -z "$left" ] && return 0
        ;;
    esac
  fi
  return "$status"
}

# Podman rootless, alla rimozione dell'ultimo container, manda SIGTERM al pid
# salvato del processo di rete (pasta). Se quel processo era gia' finito e il
# pid e' passato a un processo di un altro utente, kill risponde EPERM e podman
# stampa un errore a container gia' tolto: la rete e' gia' chiusa, non c'e'
# niente da fare. Solo quel blocco, quando e' l'unico errore, diventa una nota;
# ogni altra riga passa com'e'.
rootless_netns_noise_filter() {
  awk -v note="nota: il processo di rete del team era gia' chiuso (podman: rootless netns, permission denied); il team e' fermo." '
    held != "" {
      if ($0 ~ /^[[:space:]]*\* rootless netns: kill network process: permission denied$/) {
        held = ""; skip_blank = 1; if (!noted) { print note; noted = 1 }; next
      }
      print held; held = ""
    }
    skip_blank && $0 ~ /^[[:space:]]*$/ { next }
    { skip_blank = 0 }
    /^Error: removing container [0-9a-f]+ network: 1 error occurred:$/ { held = $0; next }
    { print }
    END { if (held != "") print held }
  '
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

# Il compose installato segue le release, non il repo: finche' `jht upgrade`
# non lo rinnova, puo' non avere il servizio. Con il servizio assente `jht up`
# non lo crea mai: la via d'uscita giusta e' `jht upgrade`, non un altro `up`.
compose_lacks_service() {
  # Solo un compose LEGGIBILE senza il servizio vale «runtime vecchio»; la
  # chiave si cerca con qualunque rientro, non solo con i due spazi.
  [ -r "$COMPOSE_FILE" ] && ! grep -Eq "^[[:space:]]+$1:[[:space:]]*(#.*)?$" "$COMPOSE_FILE" 2>/dev/null
}

compose_unreadable() {
  [ ! -r "$COMPOSE_FILE" ]
}

broker_admin() {
  local broker_id
  broker_id="$(read_only_service_id "$BROKER_SERVICE")" || {
    if compose_unreadable; then
      err "broker_unavailable: il compose del runtime installato non è leggibile, non si sa se ha il broker dei segreti."
      err "Cosa fare: reinstalla il runtime con l'installer"
      return 1
    fi
    if compose_lacks_service "$BROKER_SERVICE"; then
      err "broker_unavailable: il runtime installato è più vecchio e non ha il broker dei segreti."
      err "Cosa fare: jht upgrade"
      return 1
    fi
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
    if compose_unreadable; then
      err "telegram_unavailable: il compose del runtime installato non è leggibile, non si sa se ha il servizio Telegram isolato."
      err "Cosa fare: reinstalla il runtime con l'installer"
      return 1
    fi
    if compose_lacks_service "$TELEGRAM_SERVICE"; then
      err "telegram_unavailable: il runtime installato è più vecchio e non ha il servizio Telegram isolato."
      err "Cosa fare: jht upgrade"
      return 1
    fi
    err "telegram_unavailable: il servizio Telegram isolato non è attivo o non è attestabile."
    err "Cosa fare: jht up"
    return 1
  }
  docker exec "$telegram_id" jht-telegram-admin "$@"
}

telegram_admin_input() {
  local telegram_id
  telegram_id="$(read_only_service_id "$TELEGRAM_SERVICE")" || {
    if compose_unreadable; then
      err "telegram_unavailable: il compose del runtime installato non è leggibile, non si sa se ha il servizio Telegram isolato."
      err "Cosa fare: reinstalla il runtime con l'installer"
      return 1
    fi
    if compose_lacks_service "$TELEGRAM_SERVICE"; then
      err "telegram_unavailable: il runtime installato è più vecchio e non ha il servizio Telegram isolato."
      err "Cosa fare: jht upgrade"
      return 1
    fi
    err "telegram_unavailable: il servizio Telegram isolato non è attivo o non è attestabile."
    err "Cosa fare: jht up"
    return 1
  }
  docker exec -i "$telegram_id" jht-telegram-admin "$@"
}

telegram_image() {
  local images
  images="$(compose_images 2>/dev/null | sort -u)" || return 1
  case "$images" in ''|*$'\n'*) return 1 ;; esac
  printf '%s\n' "$images"
}

telegram_legacy() {
  local command="${1:-}" image mode home_mount
  local -a userns_args=()
  case "$command" in inventory|remaining) mode=ro ;; remove) mode=rw ;; *) return 2 ;; esac
  image="$(telegram_image)" || return 1
  host_data_dirs_supported || return 1
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

read_hidden_tty() {
  (
    local prompt="${1:-}" value="" chunk="" read_rc=0 started=0
    # Not `local`: bash 3.2 (macOS /bin/bash) drops the locals of the function
    # before it runs the EXIT trap of the subshell on `exit 130`, and with
    # `set -u` restore_tty then failed on tty_state and left the echo off.
    tty_state=""
    [ -t 0 ] || return 2
    tty_state="$(stty -g <&0)" || return 1
    restore_tty() {
      stty "$tty_state" <&0 2>/dev/null || stty echo <&0 2>/dev/null || :
    }
    trap 'restore_tty' EXIT
    trap 'exit 130' HUP INT TERM
    stty -echo <&0 || return 1
    printf '%s' "$prompt" >&2
    # A Ctrl-C that lands between the prompt and the read(2) of `read` is kept
    # by bash as a pending trap, and a `read` already blocked is not woken by
    # it: the script would stay here with the echo off. With -t `read` comes
    # back to the shell every 2 s, the pending trap runs (exit 130, the EXIT
    # trap puts the terminal back) and a typed line is not lost: on a terminal
    # nothing is handed to `read` before Enter.
    # Bash >= 4 answers a timeout with a status above 128 and keeps what was
    # read; bash 3.2 (the macOS /bin/bash) answers 1, like an end of file, so
    # there a status 1 after 2 s of waiting is the timeout.
    while :; do
      started=$SECONDS
      IFS= read -r -t 2 chunk
      read_rc=$?
      value="$value$chunk"
      [ "$read_rc" -gt 128 ] && continue
      [ "${BASH_VERSINFO[0]}" -lt 4 ] && [ "$read_rc" -eq 1 ] && [ $((SECONDS - started)) -ge 2 ] && continue
      break
    done
    printf '\n' >&2
    restore_tty
    trap - EXIT HUP INT TERM
    [ "$read_rc" -eq 0 ] || return "$read_rc"
    printf '%s' "$value"
  )
}

# Un'installazione che non ha mai usato Telegram non ha niente da inventariare:
# senza file legacy l'avvio non passa dal servizio isolato. La prova è sui byte
# grezzi: `legacy.py` legge solo channels.telegram.bots dei config e il file
# Telegram in credentials/, e in JSON la chiave «telegram» può comparire
# soltanto scritta così o con un escape \u. Nel dubbio (file illeggibile, non
# regolare, cartella non leggibile) l'inventario parte e decide lui.
telegram_legacy_sources_present() {
  local root="${JHT_HOME_HOST:-$HOME/.jht}" path rc=0 size stripped
  [ -e "$root" ] || [ -L "$root" ] || return 1
  [ -d "$root" ] && [ -r "$root" ] && [ -x "$root" ] || return 0
  if [ -e "$root/credentials" ] || [ -L "$root/credentials" ]; then
    [ -d "$root/credentials" ] && [ -r "$root/credentials" ] && [ -x "$root/credentials" ] || return 0
    for path in "$root"/credentials/telegram*; do
      [ -e "$path" ] || [ -L "$path" ] && return 0
    done
  fi
  for path in "$root/jht.config.json" "$root"/jht.config.json.bak-model-pin-*; do
    [ -e "$path" ] || [ -L "$path" ] || continue
    [ -f "$path" ] && [ ! -L "$path" ] && [ -r "$path" ] || return 0
    LC_ALL=C grep -q -e 'telegram' -e '\\u' "$path" && return 0
    rc=$?
    [ "$rc" -eq 1 ] || return 0
    # json.load legge anche UTF-16 e UTF-32, e lì «telegram» non è una
    # sequenza di byte ASCII: un BOM UTF-16/32 o un byte NUL fanno partire
    # l'inventario.
    case "$(LC_ALL=C od -An -tx1 -N2 "$path" | tr -d ' \n')" in fffe|feff) return 0 ;; esac
    size="$(wc -c < "$path")" || return 0
    stripped="$(LC_ALL=C tr -d '\000' < "$path" | wc -c)" || return 0
    [ "$((size))" -eq "$((stripped))" ] || return 0
  done
  return 1
}

telegram_prepare_legacy_inventory() {
  local role digests digest agent_status=0
  telegram_legacy_sources_present || return 0
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

# Gli ALTRI ruoli che hanno ancora un token legacy. Il servizio isolato si
# accende solo quando non ne resta nessuno, e intanto il ruolo appena
# abbinato e' muto (copia legacy tolta, servizio non ancora acceso). Serve
# solo ad avvisare: un errore di lettura non dice niente, l'inventario decide.
telegram_pair_other_legacy_roles() {
  local role="$1" listed="" other output rc=0
  output="$(telegram_legacy remaining 2>/dev/null)" || rc=$?
  [ "$rc" -eq 1 ] || return 0
  for other in $output; do
    case "$other" in
      assistente|capitano|mentor) [ "$other" = "$role" ] || listed="${listed:+$listed }$other" ;;
    esac
  done
  printf '%s' "$listed"
}

# Agenti fermi durante l'inventario host: un agente non deve poter togliere un
# token legacy dalla config proprio mentre lo si conta.
TELEGRAM_PAIR_AGENTS_STOPPED=0

telegram_pair_stop_agents() {
  local agent_status=0
  TELEGRAM_PAIR_AGENTS_STOPPED=0
  if read_only_container_id >/dev/null 2>&1; then
    compose stop "$CONTAINER_SERVICE" >/dev/null || {
      err "legacy_inventory_failed: non riesco a fermare gli agenti prima dell'inventario host."
      return 1
    }
    TELEGRAM_PAIR_AGENTS_STOPPED=1
  else
    agent_status=$?
    if [ "$agent_status" -ne 3 ]; then
      err "legacy_inventory_failed: lo stato del container agenti non è attestabile."
      return 1
    fi
  fi
}

telegram_pair_start_agents() {
  [ "$TELEGRAM_PAIR_AGENTS_STOPPED" -eq 1 ] || return 0
  compose start "$CONTAINER_SERVICE" >/dev/null || {
    err "agent_restart_failed: inventario conservato, ma il team non è ripartito. Cosa fare: jht up"
    return 1
  }
}

# Inventario host di un ruolo, conservato dal servizio isolato. Stampa le
# impronte legacy (una per riga) per il successivo `bots pair`.
telegram_pair_inventory() {
  local role="$1" digests digest
  digests="$(telegram_legacy inventory "$role")" || {
    err "legacy_inventory_failed: migrazione Telegram interrotta."
    return 1
  }
  if [ -n "$digests" ]; then
    while IFS= read -r digest; do
      printf '%s' "$digest" | grep -Eq '^[0-9a-f]{64}$' || {
        err "legacy_inventory_invalid: migrazione Telegram interrotta."
        return 1
      }
    done <<< "$digests"
  fi
  if ! printf '%s' "$digests" | telegram_admin_input legacy remember "$role" >/dev/null; then
    err "legacy_inventory_failed: le impronte non sono state conservate dal servizio isolato."
    return 1
  fi
  printf '%s' "$digests"
}

# Il token nuovo va al servizio isolato e basta. Il chat id non si scrive: il
# servizio mostra un codice monouso e lo prende dal messaggio con cui la
# persona lo manda al bot nuovo dal suo Telegram.
telegram_pair_submit() {
  local role="$1" digests="$2" digest token="" pair_rc=0
  local -a digest_args=()
  if [ -n "$digests" ]; then
    while IFS= read -r digest; do
      digest_args+=(--legacy-digest "$digest")
    done <<< "$digests"
  fi
  if [ -t 0 ]; then
    if ! token="$(read_hidden_tty "Token del bot $role (input nascosto): ")"; then
      err "input_interrotto: token non letto."
      return 1
    fi
    if [[ ! "$token" =~ ^[0-9]{5,12}:[A-Za-z0-9_-]{20,}$ ]]; then
      unset token
      err "bot_token_invalid: controlla il token generato da BotFather."
      return 1
    fi
    if printf '{"bot_token":"%s"}' "$token" \
        | telegram_admin_input bots pair "$role" ${digest_args[@]+"${digest_args[@]}"}; then
      pair_rc=0
    else
      pair_rc=$?
    fi
    unset token
  else
    if telegram_admin_input bots pair "$role" ${digest_args[@]+"${digest_args[@]}"}; then
      pair_rc=0
    else
      pair_rc=$?
    fi
  fi
  if [ "$pair_rc" -ne 0 ]; then
    err "Abbinamento rifiutato: genera un token nuovo in BotFather (/revoke) e riprova."
    return "$pair_rc"
  fi
}

# Dopo l'ultima copia legacy tolta il servizio isolato si accende (una volta
# sola, irreversibile) e il team riparte senza il bridge legacy.
telegram_pair_finish() {
  local was_enabled="$1" remaining_rc=0 first_cutover=0
  if telegram_legacy remaining >/dev/null; then
    case "$was_enabled" in *'"enabled": true'*) ;; *) first_cutover=1 ;; esac
    telegram_admin cutover enable >/dev/null || return 1
    compose restart "$TELEGRAM_SERVICE" >/dev/null || return 1
    if [ "$first_cutover" -eq 1 ] && [ "$TELEGRAM_PAIR_AGENTS_STOPPED" -eq 1 ]; then
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

telegram_pair_usage() {
  err "uso: jht telegram pair <assistente|capitano|mentor>|--all"
  err "Interattivo: il token viene chiesto senza eco, poi il bot nuovo riceve un codice monouso dal tuo Telegram. Automazioni: {\"bot_token\": ...} come JSON su stdin; non salvare il token in ~/.jht e cancella subito qualunque file usato fuori da lì."
}

TELEGRAM_NEW_TOKEN_NOTE="Usa sempre un token appena generato in BotFather (/revoke sul bot, oppure un bot nuovo): un token già esistente può essere stato letto dagli agenti anche se oggi non compare in ~/.jht."

telegram_pair() {
  local role="${1:-}" digests="" was_enabled="" others="" answer=""
  [ "$role" != "--all" ] || { telegram_pair_all; return $?; }
  case "$role" in assistente|capitano|mentor) ;; *) telegram_pair_usage; return 2 ;; esac
  others="$(telegram_pair_other_legacy_roles "$role")"
  if [ -n "$others" ]; then
    warn "Restano token legacy per: $others. Finché non abbini anche questi ruoli, $role resta muto su Telegram: abbinali tutti in questa seduta (jht telegram pair --all)."
    if [ -t 0 ]; then
      printf 'Abbinare %s adesso? [s/N] ' "$role" >&2
      IFS= read -r answer || answer=""
      case "$answer" in
        s|S|si|Si|SI|sì|Sì) ;;
        *) info "Abbinamento annullato: nessuna modifica."; return 1 ;;
      esac
    fi
  fi
  telegram_pair_stop_agents || return 1
  digests="$(telegram_pair_inventory "$role")" || {
    telegram_pair_start_agents >/dev/null 2>&1 || true
    return 1
  }
  telegram_pair_start_agents || return 1

  was_enabled="$(telegram_admin cutover status 2>/dev/null || true)"
  # Anche quando l'inventario non trova niente: un agente di una versione
  # precedente può aver tolto il token dalla config prima dell'aggiornamento,
  # e allora un token esposto risulterebbe «fresh».
  info "$TELEGRAM_NEW_TOKEN_NOTE"
  telegram_pair_submit "$role" "$digests" || return $?
  telegram_legacy remove "$role" || {
    err "legacy_cleanup_failed: il nuovo token è al sicuro, ma il token vecchio è ancora in ~/.jht; cutover negato."
    return 1
  }
  telegram_pair_finish "$was_enabled"
}

# Tutti i ruoli con un token legacy, in una seduta. Le copie legacy si tolgono
# solo quando tutti gli abbinamenti sono riusciti: nessun ruolo resta muto a
# meta' strada, e la storia delle impronte rifiuta comunque quei token.
telegram_pair_all() {
  local roles="" role rc=0 was_enabled="" status="" digests=""
  local d_assistente="" d_capitano="" d_mentor=""
  if [ ! -t 0 ]; then
    err "jht telegram pair --all è interattivo: per le automazioni abbina un ruolo alla volta."
    return 2
  fi
  roles="$(telegram_legacy remaining 2>/dev/null)" || rc=$?
  case "$rc" in
    0) info "Nessun ruolo ha un token legacy: per un bot nuovo usa jht telegram pair <ruolo>."; return 0 ;;
    1) ;;
    *) err "legacy_inventory_failed: non riesco a leggere i token legacy in ~/.jht."; return 1 ;;
  esac
  roles="$(printf '%s\n' $roles | grep -Ex 'assistente|capitano|mentor' | tr '\n' ' ' || true)"
  roles="${roles% }"
  [ -n "$roles" ] || { err "legacy_inventory_failed: ruoli legacy non riconosciuti."; return 1; }
  info "Ruoli da abbinare in questa seduta: $roles"

  telegram_pair_stop_agents || return 1
  for role in $roles; do
    digests="$(telegram_pair_inventory "$role")" || {
      telegram_pair_start_agents >/dev/null 2>&1 || true
      return 1
    }
    case "$role" in
      assistente) d_assistente="$digests" ;;
      capitano) d_capitano="$digests" ;;
      mentor) d_mentor="$digests" ;;
    esac
  done
  telegram_pair_start_agents || return 1

  was_enabled="$(telegram_admin cutover status 2>/dev/null || true)"
  status="$(telegram_admin bots status 2>/dev/null || true)"
  info "$TELEGRAM_NEW_TOKEN_NOTE"
  for role in $roles; do
    case "$status" in
      *"\"$role\": \"present\""*)
        info "$role ha già un bot abbinato: tolgo solo la sua copia legacy."
        continue
        ;;
    esac
    case "$role" in
      assistente) digests="$d_assistente" ;;
      capitano) digests="$d_capitano" ;;
      mentor) digests="$d_mentor" ;;
    esac
    telegram_pair_submit "$role" "$digests" || {
      rc=$?
      err "Abbinamento di $role non riuscito: le copie legacy restano tutte. Rilancia jht telegram pair --all: i ruoli già abbinati non chiedono un altro token."
      return "$rc"
    }
  done
  for role in $roles; do
    telegram_legacy remove "$role" || {
      err "legacy_cleanup_failed: i token nuovi sono al sicuro, ma la copia legacy di $role è ancora in ~/.jht; cutover negato."
      return 1
    }
  done
  telegram_pair_finish "$was_enabled"
}

# ── Autorizzare una candidatura dall'host (T68) ───────────────────────────
# Il CLOSER invia solo cio' che il broker ha registrato, e il broker registra
# solo da canali che gli agenti non hanno: questo terminale dell'host e' uno.
# Il container mostra l'anteprima («titolo @ azienda · host») con il suo
# digest, la persona conferma qui, il container scrive il flag solo se la
# posizione e' ancora quella vista, e l'host registra nel broker istante e
# destinazione. Ogni campo che arriva dal container e' chiuso e ricontrollato
# qui prima di finire in una riga di comando. Ritirare restringe e basta.
apply_skill() {
  docker exec -i "$ATTESTED_CONTAINER_ID" python3 /app/shared/skills/apply_request.py "$@" --host </dev/null
}

apply_host_command() {
  local action="$1" id="${2:-}" line ok reason confirm destination instant summary answer
  case "$id" in ''|0*|*[!0-9]*) err "uso: jht apply request|cancel <id>"; return 2 ;; esac
  [ "${#id}" -le 10 ] || { err "uso: jht apply request|cancel <id>"; return 2; }
  if [ "$action" = cancel ]; then
    line="$(apply_skill cancel "$id")" || true
    IFS=$'\t' read -r ok reason confirm destination instant summary <<<"$line"
    if [ "$ok" != 1 ]; then
      err "Ritiro non riuscito: ${reason:-nessuna risposta}."
      return 1
    fi
    info "Ritirata #$id: non verra' inviata."
    return 0
  fi
  line="$(apply_skill show "$id")" || true
  IFS=$'\t' read -r ok reason confirm destination instant summary <<<"$line"
  if [ "$ok" != 1 ]; then
    err "Non autorizzabile: ${reason:-nessuna risposta dal container}."
    return 1
  fi
  if ! printf '%s' "$confirm" | grep -Eq '^[0-9a-f]{64}$' \
    || ! printf '%s' "$destination" | grep -Eq '^((web|email):[a-z0-9.-]{3,253}|portal:[a-z]{2,20})$'; then
    err "Anteprima non valida: niente autorizzato."
    return 1
  fi
  if [ ! -t 0 ]; then
    err "Serve un terminale: l'autorizzazione si conferma a mano."
    return 1
  fi
  printf '\n  #%s  %s\n\n' "$id" "$summary"
  printf '  Con l'"'"'invio automatico acceso il team compila e INVIA la candidatura,\n'
  printf '  senza un'"'"'altra conferma. Una volta partita non si richiama.\n'
  printf '  Autorizzi questa candidatura? [s/N] '
  IFS= read -r answer || answer=""
  case "$answer" in s|S|si|SI|Si|sì|y|Y|yes) ;; *) info "Annullato: niente autorizzato."; return 1 ;; esac

  local shown="$destination"
  line="$(apply_skill request "$id" --expect "$confirm")" || true
  IFS=$'\t' read -r ok reason confirm destination instant summary <<<"$line"
  if [ "$ok" != 1 ]; then
    err "Non autorizzata: ${reason:-nessuna risposta dal container}."
    return 1
  fi
  if [ "$destination" != "$shown" ] || ! printf '%s' "$instant" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'; then
    apply_skill cancel "$id" >/dev/null || true
    err "Risposta del container non valida: autorizzazione ritirata, niente partira'."
    return 1
  fi
  if ! broker_admin apply record "$id" "$instant" "$destination" >/dev/null; then
    apply_skill cancel "$id" >/dev/null || true
    err "Il broker non ha registrato l'autorizzazione: ritirata, niente partira'."
    return 1
  fi
  info "Autorizzata #$id, verso $destination: il CLOSER la prendera' al prossimo giro."
  return 0
}

telegram_command() {
  local action="${1:-status}"
  shift || true
  case "$action" in
    status) telegram_admin bots status ;;
    pair) telegram_pair "$@" ;;
    chat-id)
      case "${1:-}" in assistente|capitano|mentor) telegram_admin bots chat-id "$1" ;; *)
        err "uso: jht telegram chat-id <assistente|capitano|mentor>"; return 2 ;;
      esac
      ;;
    remove)
      case "${1:-}" in assistente|capitano|mentor) telegram_admin bots delete "$1" ;; *)
        err "uso: jht telegram remove <assistente|capitano|mentor>"; return 2 ;;
      esac
      ;;
    *)
      err "uso: jht telegram status|pair <ruolo>|pair --all|chat-id <ruolo>|remove <ruolo>"
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

# The broker owns the polling credential.  At first pairing only, the account
# id is read from cloud.json in the box: that file is box-writable, so this is
# a bootstrap residual.  Once present, the broker account is never replaced
# automatically; changing it requires `jht apply relink-account` on the host.
broker_configure_web_authorisations() {
  local agent_id broker_id state account
  agent_id="$(read_only_container_id)" || return 0
  broker_id="$(read_only_service_id "$BROKER_SERVICE")" || return 0
  state="$(docker exec "$broker_id" jht-broker-admin apply web-status 2>/dev/null)" || return 0
  docker exec -u 1001 "$agent_id" node -e '
    const fs=require("fs"); try { const c=JSON.parse(fs.readFileSync("/jht_home/cloud.json","utf8"));
      if (typeof c.token === "string") process.stdout.write(c.token); } catch {}
  ' | docker exec -i "$broker_id" jht-broker-admin apply web-token >/dev/null 2>&1 || true
  case "$state" in
    *'"account_id": null'*)
      account="$(docker exec -u 1001 "$agent_id" node -e '
        const fs=require("fs"); try { const c=JSON.parse(fs.readFileSync("/jht_home/cloud.json","utf8"));
          if (typeof c.user_id === "string" && /^[0-9a-f-]{36}$/i.test(c.user_id)) process.stdout.write(c.user_id); } catch {}
      ' 2>/dev/null)"
      [ -z "$account" ] || docker exec "$broker_id" jht-broker-admin apply account "$account" >/dev/null 2>&1 || true
      ;;
  esac
}

# This is deliberately separate from normal startup: the cloud file is
# box-writable, so replacing the fixed account needs an explicit host command.
broker_relink_web_account() {
  local agent_id broker_id account
  agent_id="$(read_only_container_id)" || return 1
  broker_id="$(read_only_service_id "$BROKER_SERVICE")" || return 1
  account="$(docker exec -u 1001 "$agent_id" node -e '
    const fs=require("fs"); try { const c=JSON.parse(fs.readFileSync("/jht_home/cloud.json","utf8"));
      if (typeof c.user_id === "string" && /^[0-9a-f-]{36}$/i.test(c.user_id)) process.stdout.write(c.user_id); } catch {}
  ' 2>/dev/null)"
  if [ -z "$account" ]; then
    err "apply relink-account: cloud account non disponibile. Esegui prima jht cloud pair."
    return 1
  fi
  docker exec "$broker_id" jht-broker-admin apply account "$account"
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

# Manifest deterministico del contenuto di un volume. Conta i file regolari e
# lega al digest aggregato sia il percorso relativo sia il digest di ciascun
# file. Symlink e file speciali fanno fallire la migrazione: i quattro volumi
# persistenti JHT contengono soltanto directory e file regolari.
RUNTIME_VOLUME_MANIFEST_PY='import hashlib,os,stat,sys
root=sys.argv[1]
root_stat=os.lstat(root)
entries=[("D",".",str(root_stat.st_uid)+":"+str(root_stat.st_gid)+":"+format(stat.S_IMODE(root_stat.st_mode),"o"),"")]
count=0
for base,dirs,files in os.walk(root,topdown=True,followlinks=False):
    dirs.sort(); files.sort()
    for name in list(dirs):
        path=os.path.join(base,name); mode=os.lstat(path).st_mode
        if not stat.S_ISDIR(mode): raise SystemExit(41)
        metadata=os.lstat(path)
        owner=str(metadata.st_uid)+":"+str(metadata.st_gid)+":"+format(stat.S_IMODE(mode),"o")
        entries.append(("D",os.path.relpath(path,root),owner,""))
    for name in files:
        path=os.path.join(base,name); mode=os.lstat(path).st_mode
        if not stat.S_ISREG(mode): raise SystemExit(42)
        digest=hashlib.sha256()
        with open(path,"rb") as stream:
            for block in iter(lambda:stream.read(1024*1024),b""): digest.update(block)
        metadata=os.lstat(path)
        owner=str(metadata.st_uid)+":"+str(metadata.st_gid)+":"+format(stat.S_IMODE(mode),"o")
        entries.append(("F",os.path.relpath(path,root),owner,digest.hexdigest())); count+=1
aggregate=hashlib.sha256()
for kind,path,owner,digest in entries:
    aggregate.update(kind.encode()+b"\0"+path.encode("utf-8")+b"\0"+owner.encode()+b"\0"+digest.encode()+b"\0")
print(str(count)+" "+aggregate.hexdigest())'

migration_docker_binary() {
  local candidate="${JHT_MIGRATION_DOCKER:-}" resolved=""
  for candidate in "$candidate" "$(command -v docker 2>/dev/null || true)" \
      /usr/bin/docker /usr/local/bin/docker /opt/homebrew/bin/docker \
      /Applications/Docker.app/Contents/Resources/bin/docker; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    resolved="$(cd -P "$(dirname "$candidate")" 2>/dev/null && printf '%s/%s\n' "$(pwd -P)" "$(basename "$candidate")")" || continue
    [ "$resolved" != "$DOCKER_SHIM" ] || continue
    printf '%s\n' "$resolved"
    return 0
  done
  return 1
}

migration_podman_run() {
  local podman_bin="$1"
  shift
  if [ "$HOST_KERNEL" = "Darwin" ]; then
    "$podman_bin" --connection "$PODMAN_MACHINE_NAME" "$@"
  else
    "$podman_bin" "$@"
  fi
}

migration_volume_id() {
  local engine="$1" binary="$2" project="$3" logical="$4" ids=""
  if [ "$engine" = docker ]; then
    ids="$("$binary" volume ls -q \
      --filter "label=com.docker.compose.project=$project" \
      --filter "label=com.docker.compose.volume=$logical")" || return 1
  else
    ids="$(migration_podman_run "$binary" volume ls -q \
      --filter "label=com.docker.compose.project=$project" \
      --filter "label=com.docker.compose.volume=$logical")" || return 1
  fi
  case "$ids" in *$'\n'*) return 2 ;; esac
  printf '%s' "$ids"
}

migration_volume_manifest() {
  local engine="$1" binary="$2" image="$3" volume="$4" result
  if [ "$engine" = docker ]; then
    result="$("$binary" run --rm --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges --volume "$volume:/volume:ro" \
      --entrypoint /usr/bin/python3 "$image" -I -c "$RUNTIME_VOLUME_MANIFEST_PY" /volume)" \
      || return 1
  else
    result="$(migration_podman_run "$binary" run --rm --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges --volume "$volume:/volume:ro" \
      --entrypoint /usr/bin/python3 "$image" -I -c "$RUNTIME_VOLUME_MANIFEST_PY" /volume)" \
      || return 1
  fi
  printf '%s\n' "$result" | grep -Eq '^[0-9]+ [0-9a-f]{64}$' || return 1
  printf '%s\n' "$result"
}

migration_copy_volume() {
  local docker_bin="$1" podman_bin="$2" image="$3" source="$4" target="$5"
  "$docker_bin" run --rm --network none --read-only --cap-drop ALL \
      --security-opt no-new-privileges --volume "$source:/volume:ro" \
      --entrypoint /bin/tar "$image" -C /volume -cf - . \
    | migration_podman_run "$podman_bin" run --rm -i --network none --read-only \
      --cap-drop ALL --security-opt no-new-privileges \
      --volume "$target:/volume" --entrypoint /bin/tar "$image" \
      -C /volume -xf -
}

migration_left() {
  local verified=" $1 " logical
  for logical in $RUNTIME_MIGRATION_VOLUMES; do
    case "$verified" in *" $logical "*) ;; *) printf 'JHT_LEFT %s\n' "$logical" ;; esac
  done
}

migrate_runtime_podman() {
  local docker_bin podman_bin image logical source target source_manifest target_manifest
  local verified="" records="" tmp_marker running
  docker_bin="$(migration_docker_binary)" || {
    err "runtime_migration_docker_missing: il client Docker originale non e' disponibile."
    migration_left "$verified"; return 24
  }
  podman_bin="${JHT_MIGRATION_PODMAN:-$(podman_binary 2>/dev/null || true)}"
  [ -n "$podman_bin" ] && [ -x "$podman_bin" ] || {
    err "runtime_migration_podman_missing: Podman non e' disponibile."
    migration_left "$verified"; return 24
  }
  image="${JHT_MIGRATION_IMAGE:-${JHT_IMAGE:-$DEFAULT_RUNTIME_IMAGE}}"
  if ! printf '%s\n' "$image" \
      | grep -Eq '^ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64}$'; then
    err "runtime_migration_image_invalid: serve l'immagine JHT fissata per digest."
    migration_left "$verified"; return 24
  fi
  "$docker_bin" image inspect "$image" >/dev/null 2>&1 \
    && migration_podman_run "$podman_bin" image inspect "$image" >/dev/null 2>&1 || {
      err "runtime_migration_image_missing: la stessa immagine JHT deve esistere in Docker e Podman."
      migration_left "$verified"; return 24
    }
  running="$("$docker_bin" ps -q --filter label=com.docker.compose.project=host-runtime)" || {
    migration_left "$verified"; return 24
  }
  [ -z "$running" ] || {
    err "runtime_migration_team_running: ferma prima il team Docker."
    migration_left "$verified"; return 24
  }
  running="$(migration_podman_run "$podman_bin" ps -q --filter label=com.docker.compose.project=jht)" || {
    migration_left "$verified"; return 24
  }
  [ -z "$running" ] || {
    err "runtime_migration_team_running: ferma prima il team Podman."
    migration_left "$verified"; return 24
  }

  # Un marker completo rende il comando un no-op soltanto se sorgente e
  # destinazione sono ancora identici. Non sovrascriviamo dati Podman usati
  # dopo una migrazione conclusa.
  if [ -f "$RUNTIME_MIGRATION_MARKER" ]; then
    for logical in $RUNTIME_MIGRATION_VOLUMES; do
      source="$(migration_volume_id docker "$docker_bin" host-runtime "$logical")" || {
        migration_left "$verified"; return 24
      }
      target="$(migration_volume_id podman "$podman_bin" jht "$logical")" || {
        migration_left "$verified"; return 24
      }
      if [ -z "$source" ] && [ -z "$target" ] \
          && grep -Fqx "$logical=absent" "$RUNTIME_MIGRATION_MARKER"; then
        verified="$verified $logical"; continue
      fi
      [ -n "$source" ] && [ -n "$target" ] || {
        err "runtime_migration_changed: $logical non corrisponde piu' al marker verificato."
        migration_left "$verified"; return 24
      }
      source_manifest="$(migration_volume_manifest docker "$docker_bin" "$image" "$source")" || {
        migration_left "$verified"; return 24
      }
      target_manifest="$(migration_volume_manifest podman "$podman_bin" "$image" "$target")" || {
        migration_left "$verified"; return 24
      }
      [ "$source_manifest" = "$target_manifest" ] \
        && grep -Fqx "$logical=$source_manifest" "$RUNTIME_MIGRATION_MARKER" || {
          err "runtime_migration_changed: checksum diverso per $logical dopo la migrazione."
          migration_left "$verified"; return 24
        }
      verified="$verified $logical"
    done
    info "Migrazione Docker -> Podman gia' verificata; i volumi Docker restano intatti e contengono ancora le password della posta, gli accessi ai portali e i token di Telegram."
    return 0
  fi

  for logical in $RUNTIME_MIGRATION_VOLUMES; do
    source="$(migration_volume_id docker "$docker_bin" host-runtime "$logical")" || {
      migration_left "$verified"; return 24
    }
    target="$(migration_volume_id podman "$podman_bin" jht "$logical")" || {
      migration_left "$verified"; return 24
    }
    if [ -z "$source" ]; then
      [ -z "$target" ] || {
        err "runtime_migration_source_missing: $logical manca in Docker ma esiste in Podman; non lo sovrascrivo."
        migration_left "$verified"; return 24
      }
      records="${records}${logical}=absent\n"
      verified="$verified $logical"
      continue
    fi
    source_manifest="$(migration_volume_manifest docker "$docker_bin" "$image" "$source")" || {
      migration_left "$verified"; return 24
    }
    [ -z "$target" ] || migration_podman_run "$podman_bin" volume rm -f "$target" >/dev/null || {
      migration_left "$verified"; return 24
    }
    target="jht_$logical"
    migration_podman_run "$podman_bin" volume create \
      --label com.docker.compose.project=jht \
      --label com.docker.compose.volume="$logical" \
      --label io.podman.compose.project=jht \
      --label io.podman.compose.volume="$logical" "$target" >/dev/null || {
        migration_left "$verified"; return 24
      }
    migration_copy_volume "$docker_bin" "$podman_bin" "$image" "$source" "$target" || {
      err "runtime_migration_interrupted: copia incompleta di $logical; il sorgente Docker e' intatto."
      migration_left "$verified"; return 24
    }
    target_manifest="$(migration_volume_manifest podman "$podman_bin" "$image" "$target")" || {
      migration_left "$verified"; return 24
    }
    [ "$source_manifest" = "$target_manifest" ] || {
      err "runtime_migration_checksum_mismatch: $logical non ha superato la verifica."
      migration_left "$verified"; return 24
    }
    records="${records}${logical}=${source_manifest}\n"
    verified="$verified $logical"
  done
  tmp_marker="${RUNTIME_MIGRATION_MARKER}.tmp.$$"
  umask 077
  {
    printf 'version=1\nsource=docker:host-runtime\ntarget=podman:jht\n'
    printf '%b' "$records"
  } > "$tmp_marker" || { rm -f "$tmp_marker"; migration_left "$verified"; return 24; }
  chmod 600 "$tmp_marker" && mv -f "$tmp_marker" "$RUNTIME_MIGRATION_MARKER" || {
    rm -f "$tmp_marker"; migration_left "$verified"; return 24
  }
  info "Migrazione Docker -> Podman verificata. I volumi Docker non sono stati rimossi e contengono ancora le password della posta, gli accessi ai portali e i token di Telegram: cancellali solo con una conferma esplicita nel futuro comando di pulizia."
}

# `jht mail setup --password-stdin --user U --dedicated|--not-dedicated` e' il
# canale del desktop: nessuna domanda, la password e' la prima riga di stdin
# (mai argv, file o log), e su stdout c'e' una sola riga JSON, quella del
# broker o un errore fisso (setup_argument_missing, secret_password_missing).
# Una password gia' esposta torna come {"ok": false, "reason": "password_not_rotated"}.
mail_setup() {
  local user="" imap_host="" smtp_host="" dedicated="" admission password="" from_stdin=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --user) user="${2:-}"; shift 2 ;;
      --imap-host) imap_host="${2:-}"; shift 2 ;;
      --smtp-host) smtp_host="${2:-}"; shift 2 ;;
      --dedicated) dedicated=yes; shift ;;
      --not-dedicated) dedicated=no; shift ;;
      --password-stdin) from_stdin=yes; shift ;;
      *) err "mail setup: opzione sconosciuta $1"; return 2 ;;
    esac
  done
  if [ -n "$from_stdin" ]; then
    if [ -z "$user" ] || [ -z "$dedicated" ]; then
      printf '%s\n' '{"ok": false, "reason": "setup_argument_missing"}'
      return 2
    fi
    IFS= read -r password || [ -n "$password" ] || password=""
    password="${password%$'\r'}"
    if [ -z "$password" ]; then
      printf '%s\n' '{"ok": false, "reason": "secret_password_missing"}'
      return 1
    fi
  fi
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
  if [ -z "$from_stdin" ]; then
    printf 'Password per app (non viene mostrata): ' >&2
    IFS= read -rs password || return 1
    printf '\n' >&2
    [ -n "$password" ] || { err "mail setup: password vuota"; return 1; }
  fi
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
# The variables docker-compose.yml takes from the CALLER's environment (`${NAME:-default}`): provider keys, the
# coordinator database, the screen port, the Telegram limits. podman-compose 1.6.0 puts their resolved values in the
# config-hash of the service, so a terminal that has one of them set (an `export OPENAI_API_KEY=…` for a login test) gets
# another expected hash than the app that created the container with a clean environment, and every read said «container
# non attivo» while the team ran (TEST 19g). docker-compose.yml and this list are held equal by a test.
PODMAN_CALLER_ENV="ANTHROPIC_API_KEY OPENAI_API_KEY MOONSHOT_API_KEY NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_JHT_DEPLOY JHT_SCOUT_COORD_DB JHT_LIVE_SCREEN_PORT JHT_TELEGRAM_SERVICE_ENABLED JHT_TELEGRAM_BURST_LIMIT JHT_TELEGRAM_DAILY_LIMIT"

# 0 when the caller's environment sets (non-empty) at least one of them: only then does a «clean» hash differ.
podman_caller_env_set() {
  local name
  for name in $PODMAN_CALLER_ENV; do
    [ -z "${!name:-}" ] || return 0
  done
  return 1
}

# The NAMES (never the values) of the variables above that the caller's environment sets, space separated.
podman_caller_env_names() {
  local name found=""
  for name in $PODMAN_CALLER_ENV; do
    [ -z "${!name:-}" ] || found="${found:+$found }$name"
  done
  printf '%s' "$found"
}

podman_expected_config_hash() {
  local file="$1" service="${2:-jht}" env_mode="${3:-caller}" podman_bin compose_bin resolved hashes hash pinned_image=""
  podman_ensure_on_path
  podman_bin="$(podman_binary)" || return 1
  compose_bin="$(podman_compose_binary)" || return 1
  podman_compose_pair_supported "$podman_bin" "$compose_bin" || return 1
  # La stessa immagine di `up`: prima di ogni compose che avvia, require_trusted_runtime
  # esporta JHT_IMAGE dal pin del canale di test. L'attestazione gira anche in un processo
  # che non e' passato di li' (status, ensure_up, snapshot): senza il pin
  # ${JHT_IMAGE:-...} si risolve al default del compose, e su un'installazione di test la
  # hash non e' mai quella del container.
  if [ -f "$RUNTIME_IMAGE_PIN" ]; then
    pinned_image="$(runtime_image_pin_value)" || return 1
  fi
  if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
    resolved="$({
      cd "$RUNTIME_DIR" || return 1
      [ "$env_mode" != clean ] || unset $PODMAN_CALLER_ENV
      [ -z "$pinned_image" ] || export JHT_IMAGE="$pinned_image"
      CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME" \
      PODMAN_COMPOSE_WARNING_LOGS=false \
        "$compose_bin" --verbose --dry-run --project-name jht \
          --podman-path "$podman_bin" -f "$file" up -d --force-recreate "$service"
    } 2>&1)" || return 1
  else
    local override no_pod
    override="$(podman_native_override_ensure "$file")" || return 1
    no_pod="$(podman_native_no_pod_arg "$compose_bin")" || return 1
    resolved="$({
      cd "$RUNTIME_DIR" || return 1
      unset CONTAINER_CONNECTION
      [ "$env_mode" != clean ] || unset $PODMAN_CALLER_ENV
      [ -z "$pinned_image" ] || export JHT_IMAGE="$pinned_image"
      PODMAN_COMPOSE_WARNING_LOGS=false \
        "$compose_bin" "$no_pod" --verbose --dry-run --project-name jht \
          --podman-path "$podman_bin" -f "$file" -f "$override" up -d --force-recreate "$service"
    } 2>&1)" || return 1
  fi
  # podman-compose 1.6.0 calcola la config-hash PER SERVIZIO: il dry-run di `jht`
  # stampa prima il create della sua dipendenza (jht-telegram, con la SUA hash) e poi
  # il create di `jht`. Conta solo la hash del create del servizio chiesto (il suo
  # container_name e' il nome del servizio): e' quella che l'etichetta del container
  # porta. Due valori diversi per lo stesso servizio non sono una configurazione: si
  # rifiuta, come l'assenza del suo create.
  hashes="$(printf '%s\n' "$resolved" | awk -v name="$service" '
    index($0, " create --name=" name " ") {
      n = split($0, parts, "io.podman.compose.config-hash=")
      for (i = 2; i <= n; i++) {
        value = parts[i]
        sub(/[^0-9a-f].*$/, "", value)
        if (length(value) == 64) print value
      }
    }' | LC_ALL=C sort -u)"
  unset resolved
  case "$hashes" in ''|*$'\n'*) return 1 ;; esac
  hash="$hashes"
  printf '%s' "$hash" | grep -Eq '^[0-9a-f]{64}$' || return 1
  printf '%s\n' "$hash"
}

# Why the provider could not list the project (the first line of what it said, or its exit code), for `jht status` to show:
# written to the file named by JHT_ATTEST_WHY_FILE when there is one, nowhere else. At most 200 characters, control characters
# out, never the environment: it is what podman-compose prints to stderr.
attest_why() {
  local status="$1" file="$2" line=""
  [ -n "${JHT_ATTEST_WHY_FILE:-}" ] || return 0
  [ "$file" = /dev/null ] || line="$(sed -n '/[^[:space:]]/{p;q;}' "$file" 2>/dev/null | LC_ALL=C tr -d '\000-\037\177' | sed 's/^[[:space:]]*//' | cut -c1-200)"
  [ -n "$line" ] || line="provider exit code $status, nothing said"
  printf '%s\n' "$line" > "$JHT_ATTEST_WHY_FILE" 2>/dev/null || true
}

# ── Cache dell'attestazione (solo Podman, solo il controllo `exact`) ──────────────
#
# Ogni lettura dell'app attestava il container da zero: `podman info`, `podman-compose ps -q`, un dry run di
# podman-compose per ricalcolare la config-hash attesa (oltre un secondo di CPU) e `podman inspect`. Qui si riusa
# solo cio' che si RICALCOLA (la riga attesa, con la sua hash), mai cio' che si CONFRONTA: a ogni chiamata resta
# l'inspect dell'id noto e il confronto della riga COMPLETA (progetto, servizio, numero, working_dir, config_files,
# versione, unit, config-hash, Running) con la riga attesa salvata, piu' l'identita' del container (Id intero e
# StartedAt: un container ricreato o riavviato non e' piu' quello). L'exec parte sempre per id.
#
# - Il file sta nella cartella del runtime (0700, del proprietario, verificata da runtime_bundle_trusted), FUORI da
#   ogni cartella montata nel container (~/.jht e ~/Documents sono scrivibili dagli agenti, la cache no): un agente
#   non puo' scriverlo. Modo 0600, rename atomico, lettura a campi chiusi.
# - La chiave e' il digest di tutto quello che entra nella riga attesa: compose, pin dell'immagine, manifest del
#   runtime e wrapper, le variabili del chiamante che cambiano l'hash (PODMAN_CALLER_ENV, con il VALORE in digest), il
#   progetto, l'identita' dei binari podman e podman-compose (percorso, dimensione, data, inode, ctime), uid, modalita', e le
#   variabili che il compose sostituisce da solo: HOME e JHT_HOST_TYPE / JHT_LANG / JHT_USER_TZ (queste tre da ~/.jht/host.env).
# - Scade in 30 secondi (attest_cache_ttl); si cancella a ogni compose che non sia una lettura (up, down, stop, restart…),
#   a ogni confronto che non torna, a ogni attestazione completa che fallisce. In caso di dubbio: attestazione completa.
# - Non e' autenticata: protegge dal container, non da un processo dello stesso utente (che puo' gia' scrivere il
#   wrapper e il suo manifest).
attest_inspect_format() {
  printf '%s' '{{.Name}}|{{.State.Running}}|{{index .Config.Labels "io.podman.compose.project"}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "io.podman.compose.service"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.docker.compose.container-number"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "io.podman.compose.version"}}|{{index .Config.Labels "PODMAN_SYSTEMD_UNIT"}}|{{index .Config.Labels "io.podman.compose.config-hash"}}'
}

attest_cache_ttl() {
  printf '%s' 30
}

# The folders the container mounts (the compose mounts ~/.jht and ~/Documents/Job Hunter Team, or the ones the wrapper was told
# with JHT_HOME_HOST / JHT_USER_DIR_HOST): an agent can write there, so no cache lives in or under them.
attest_cache_folder_ok() {
  local mounted
  for mounted in "${JHT_HOME_HOST:-$HOME/.jht}" "${JHT_USER_DIR_HOST:-$HOME/Documents/Job Hunter Team}" "$HOME/.jht" "$HOME/Documents/Job Hunter Team"; do
    mounted="${mounted%/}"
    [ -n "$mounted" ] || return 1
    case "$RUNTIME_DIR/" in "$mounted"/*) return 1 ;; esac
    case "$mounted/" in "$RUNTIME_DIR"/*) return 1 ;; esac
  done
  return 0
}

# One file per service (the agents' container and the broker are attested one after the other).
attest_cache_path() {
  printf '%s/.attest-cache.%s' "$RUNTIME_DIR" "$1"
}

# With a service: its file. Without: every one of them (a compose that changes the containers).
attest_cache_clear() {
  if [ -n "${1:-}" ]; then
    rm -f -- "$(attest_cache_path "$1")" 2>/dev/null || true
  else
    rm -f -- "$RUNTIME_DIR"/.attest-cache.* 2>/dev/null || true
  fi
}

attest_cache_text_digest() {
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  else
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  fi
}

attest_cache_binary_identity() {
  local meta
  if [ "$HOST_KERNEL" = Darwin ]; then
    meta="$(stat -f '%z %m %i %c' "$1" 2>/dev/null)" || return 1
  else
    meta="$(stat -c '%s %Y %i %Z' "$1" 2>/dev/null)" || return 1
  fi
  printf '%s %s' "$1" "$meta"
}

# The key, or non-zero when something it needs cannot be read (then there is no cache).
attest_cache_key() {
  local service="$1" podman_bin compose_bin name value facts project override=""
  podman_bin="$(podman_binary 2>/dev/null)" || return 1
  compose_bin="$(podman_compose_binary 2>/dev/null)" || return 1
  project="$(compose_project_name 2>/dev/null)" || return 1
  # The manifest lists the digest of the compose file, the wrapper, the host setup, the runtime selection, the machine,
  # the docker shim and the image pin, and runtime_bundle_trusted has just checked each against its file: its text IS
  # their digests, read without a process.
  facts="attest-cache-v1
service=$service
uid=$HOST_UID
runtime=$CONTAINER_RUNTIME $PODMAN_RUNTIME_MODE $PODMAN_MACHINE_NAME
project=$project
podman=$(attest_cache_binary_identity "$podman_bin")
podman-compose=$(attest_cache_binary_identity "$compose_bin")
home=$HOME
host-type=${JHT_HOST_TYPE:-}
lang=${JHT_LANG:-}
user-tz=${JHT_USER_TZ:-}
manifest:
$(<"$RUNTIME_MANIFEST")"
  if [ "$PODMAN_RUNTIME_MODE" != machine ]; then
    override="$(podman_native_override_path)" || return 1
    if [ -f "$override" ]; then
      facts="$facts
override=$(runtime_sha256 "$override")"
    else
      facts="$facts
override=none"
    fi
  fi
  if [ -n "${JHT_IMAGE:-}" ]; then
    facts="$facts
image=$(attest_cache_text_digest "$JHT_IMAGE")"
  fi
  for name in $PODMAN_CALLER_ENV; do
    value="${!name:-}"
    if [ -n "$value" ]; then
      facts="$facts
env:$name=$(attest_cache_text_digest "$value")"
    else
      facts="$facts
env:$name=-"
    fi
  done
  attest_cache_text_digest "$facts"
}

# The cache file, read once and with no process: only the seven names it writes, the first line of each, no control
# character (bytes above 0x7e are fine: a path may be in any language; the C locale makes that the same on every machine). Sets ATTEST_V, ATTEST_KEY, ATTEST_EXPIRES, ATTEST_ID, ATTEST_FULLID, ATTEST_STARTED, ATTEST_LINE; non-zero if any is missing.
attest_cache_parse() {
  local LC_ALL=C row name value
  ATTEST_V="" ATTEST_KEY="" ATTEST_EXPIRES="" ATTEST_ID="" ATTEST_FULLID="" ATTEST_STARTED="" ATTEST_LINE=""
  while IFS= read -r row || [ -n "$row" ]; do
    name="${row%%=*}"
    value="${row#*=}"
    case "$row" in *=*) ;; *) return 1 ;; esac
    case "$row" in *[[:cntrl:]]*) return 1 ;; esac
    case "$name" in
      v) [ -n "$ATTEST_V" ] || ATTEST_V="$value" ;;
      key) [ -n "$ATTEST_KEY" ] || ATTEST_KEY="$value" ;;
      expires) [ -n "$ATTEST_EXPIRES" ] || ATTEST_EXPIRES="$value" ;;
      id) [ -n "$ATTEST_ID" ] || ATTEST_ID="$value" ;;
      fullid) [ -n "$ATTEST_FULLID" ] || ATTEST_FULLID="$value" ;;
      started) [ -n "$ATTEST_STARTED" ] || ATTEST_STARTED="$value" ;;
      line) [ -n "$ATTEST_LINE" ] || ATTEST_LINE="$value" ;;
      *) return 1 ;;
    esac
  done < "$1"
  [ -n "$ATTEST_V" ] && [ -n "$ATTEST_KEY" ] && [ -n "$ATTEST_EXPIRES" ] && [ -n "$ATTEST_ID" ] \
    && [ -n "$ATTEST_FULLID" ] && [ -n "$ATTEST_STARTED" ] && [ -n "$ATTEST_LINE" ]
}

# Stores what the complete attestation found: the container id as `ps -q` gave it, its full Id and StartedAt, and
# the exact line it matched. Non-zero if anything cannot be read: the caller then leaves no cache.
attest_cache_store() {
  local service="$1" found="$2" expected_line="$3" key identity full_id started file tmp now
  case "$service" in ''|*[!a-z-]*) return 1 ;; esac
  attest_cache_folder_ok || return 1
  key="$(attest_cache_key "$service")" || return 1
  identity="$(docker inspect --type container "$found" --format '{{.Id}}|{{.State.StartedAt}}' 2>/dev/null)" || return 1
  full_id="${identity%%|*}"
  started="${identity#*|}"
  printf '%s' "$full_id" | grep -Eq '^[0-9a-f]{64}$' || return 1
  printf '%s' "$started" | grep -Eq '^[0-9TZ:.+ A-Za-z_=-]{1,64}$' || return 1
  printf '%s' "$found" | grep -Eq '^[0-9a-f]{12,64}$' || return 1
  case "$full_id" in "$found"*) ;; *) return 1 ;; esac
  [ -z "$(printf '%s' "$expected_line" | LC_ALL=C tr -d '\040-\176\200-\377')" ] || return 1
  now="$(date +%s)" || return 1
  file="$(attest_cache_path "$service")"
  tmp="$file.tmp.$$"
  (
    umask 077
    {
      printf 'v=1\n'
      printf 'key=%s\n' "$key"
      printf 'expires=%s\n' "$((now + $(attest_cache_ttl)))"
      printf 'id=%s\n' "$found"
      printf 'fullid=%s\n' "$full_id"
      printf 'started=%s\n' "$started"
      printf 'line=%s\n' "$expected_line"
    } > "$tmp"
  ) 2>/dev/null || { rm -f -- "$tmp"; return 1; }
  chmod 600 "$tmp" 2>/dev/null || { rm -f -- "$tmp"; return 1; }
  mv -f -- "$tmp" "$file" 2>/dev/null || { rm -f -- "$tmp"; return 1; }
}

# Prints the container id when a cache written within the last 30 seconds still holds in full: same
# key, same container (Id, StartedAt), and the container's labels equal the saved expected line, field by field.
# Any other answer clears the cache and returns non-zero: the complete attestation follows.
attest_cache_lookup() {
  local service="$1" file key now details seen_full seen_started
  case "$service" in ''|*[!a-z-]*) return 1 ;; esac
  attest_cache_folder_ok || return 1
  file="$(attest_cache_path "$service")"
  [ -e "$file" ] || [ -L "$file" ] || return 1
  runtime_node_safe "$file" file || { attest_cache_clear "$service"; return 1; }
  attest_cache_parse "$file" || { attest_cache_clear "$service"; return 1; }
  [ "$ATTEST_V" = 1 ] || { attest_cache_clear "$service"; return 1; }
  key="$(attest_cache_key "$service")" || { attest_cache_clear "$service"; return 1; }
  [ "$ATTEST_KEY" = "$key" ] || { attest_cache_clear "$service"; return 1; }
  [[ "$ATTEST_EXPIRES" =~ ^[0-9]{1,12}$ ]] || { attest_cache_clear "$service"; return 1; }
  [[ "$ATTEST_ID" =~ ^[0-9a-f]{12,64}$ ]] || { attest_cache_clear "$service"; return 1; }
  [[ "$ATTEST_FULLID" =~ ^[0-9a-f]{64}$ ]] || { attest_cache_clear "$service"; return 1; }
  now="$(date +%s)" || return 1
  { [ "$now" -lt "$ATTEST_EXPIRES" ] && [ "$((ATTEST_EXPIRES - now))" -le "$(attest_cache_ttl)" ]; } || { attest_cache_clear "$service"; return 1; }
  case "$ATTEST_LINE" in "$service|true|"*) ;; *) attest_cache_clear "$service"; return 1 ;; esac
  # the container is read again, by id, with the same format the complete attestation compares
  details="$(docker inspect --type container "$ATTEST_ID" --format "$(attest_inspect_format)|{{.Id}}|{{.State.StartedAt}}" 2>/dev/null)" \
    || { attest_cache_clear "$service"; return 1; }
  seen_started="${details##*|}"
  details="${details%|*}"
  seen_full="${details##*|}"
  details="${details%|*}"
  [ "$seen_full" = "$ATTEST_FULLID" ] && [ "$seen_started" = "$ATTEST_STARTED" ] && [ "$details" = "$ATTEST_LINE" ] \
    || { attest_cache_clear "$service"; return 1; }
  printf '%s\n' "$ATTEST_ID"
}

# Risolve il container di un servizio tramite l'esatto progetto Compose JHT
# senza bootstrap, wake o auto-up. Un container omonimo non e' mai sufficiente.
# Il progetto ha due servizi: `jht` (agenti) e `jht-broker` (segreti dei
# portali, P1 del 08/10). 3 = servizio assente, 1 = non attestabile.
# Secondo argomento `any-config` (solo per fermare): accetta un container del
# progetto JHT la cui config-hash non e' piu' quella del compose attuale, cioe'
# avviato prima di una reinstallazione. Ogni altra etichetta resta obbligatoria.
read_only_service_id() {
  local service="$1" config_check="${2:-exact}" cached="" status=0
  runtime_bundle_trusted || return 1
  # Podman recalculates the expected configuration hash with a dry run of podman-compose (more than a second of CPU)
  # on every call. What is reused is what is RECALCULATED; what is COMPARED is still compared in full, every time
  # (see attest_cache_lookup). Anything else, and any failure, is the complete attestation below.
  # JHT_ATTEST_CACHE=0 turns it off (only off: nothing in the environment can make it more trusting).
  if [ "$CONTAINER_RUNTIME" = podman ] && [ "$config_check" = exact ] && [ "${JHT_ATTEST_CACHE:-1}" != 0 ]; then
    if cached="$(attest_cache_lookup "$service")" && [ -n "$cached" ]; then
      printf '%s\n' "$cached"
      return 0
    fi
  fi
  read_only_service_id_attest "$service" "$config_check" || status=$?
  # A refusal never leaves a cache behind
  [ "$status" -eq 0 ] || attest_cache_clear "$service"
  return "$status"
}

read_only_service_id_attest() {
  local service="$1" config_check="${2:-exact}" cacheable=0 expected_line=""
  docker_reachable || return 1
  local ids container_id details expected_hash expected_project expected_unit found="" seen_service stopped seen_hash clean_hash
  if [ "$CONTAINER_RUNTIME" = podman ]; then
    # podman-compose 1.6.0 non accetta un operando service su `ps`: elenca
    # tutti i container del progetto, e il servizio lo dice l'inspect
    # attestato qui sotto.
    local ps_err="" ps_status=0
    ps_err="$(mktemp "${TMPDIR:-/tmp}/jht-attest.XXXXXX" 2>/dev/null)" || ps_err=/dev/null
    ids="$(compose_file "$COMPOSE_FILE" ps -q 2>"$ps_err")" || ps_status=$?
    if [ "$ps_status" -ne 0 ]; then
      attest_why "$ps_status" "$ps_err"
      [ "$ps_err" = /dev/null ] || rm -f -- "$ps_err"
      return 1
    fi
    [ "$ps_err" = /dev/null ] || rm -f -- "$ps_err"
  else
    ids="$(compose_file "$COMPOSE_FILE" ps -q "$service" 2>/dev/null)" || return 1
  fi
  [ -n "$ids" ] || return 3
  for container_id in $ids; do
    case "$container_id" in *[!0-9a-fA-F]*) return 1 ;; esac
    [ "${#container_id}" -ge 12 ] && [ "${#container_id}" -le 64 ] || return 1
  done
  local expected_files="$COMPOSE_FILE" expected_version="1.6.0"
  if [ "$CONTAINER_RUNTIME" = podman ]; then
    expected_project="$(compose_project_name)" || return 1
    expected_unit="$(printf 'podman-compose\100%s.service' "$expected_project")"
    case "$config_check" in
      any-config|stopped-stale-config) ;;
      *) expected_hash="$(podman_expected_config_hash "$COMPOSE_FILE" "$service")" || return 1 ;;
    esac
    if [ "$PODMAN_RUNTIME_MODE" = "native" ]; then
      # Il provider installato (>= 1.1.0) e i due file passati a `up`.
      expected_version="$(podman_compose_version_number "$(podman_compose_binary)")" || return 1
      expected_files="$COMPOSE_FILE,$(podman_native_override_path)"
    fi
  fi
  for container_id in $ids; do
    if [ "$CONTAINER_RUNTIME" = podman ]; then
      details="$(docker inspect --type container "$container_id" --format "$(attest_inspect_format)" 2>/dev/null)" \
        || return 1
      # Quinto campo: il servizio. Un altro servizio del compose (jht o
      # jht-broker) si salta; un servizio che il compose non ha e' un
      # container non nostro, e si rifiuta tutto.
      seen_service="$(printf '%s' "$details" | cut -d'|' -f5)"
      if [ "$seen_service" != "$service" ]; then
        case " $COMPOSE_SERVICES " in *" $seen_service "*) continue ;; esac
        return 1
      fi
      # podman-compose 1.6.0's `ps` lists the project's STOPPED containers too, as `podman ps -a`
      # does (Docker Compose's lists the running ones): after the machine stopped (a restart of
      # the Mac, an app update) the team's containers are there, Exited. They are attested by
      # every label like a running one, and then they are simply not running: not a refusal.
      stopped=0
      case "$details" in
        "$service|false|"*) stopped=1; details="$service|true|${details#"$service|false|"}" ;;
      esac
      # `stopped-stale-config` (only for `up`): exactly one stopped container of ours whose labels
      # are all right and only the hash is another one, made by the compose of an earlier version.
      if [ "$stopped" -eq 1 ] && [ "$config_check" = exact ]; then :; else [ -z "$found" ] || return 1; fi
      [ "$config_check" != stopped-stale-config ] || [ "$stopped" -eq 1 ] || return 1
      case "$config_check" in
        any-config|stopped-stale-config)
          expected_hash="${details##*|}"
          printf '%s' "$expected_hash" | grep -Eq '^[0-9a-f]{64}$' || return 1
          ;;
      esac
      # The hash this wrapper expects follows the environment of whoever asks. A container made with a clean
      # environment (the app's) is ours for a terminal that has a key exported: the hash of the SAME compose resolved
      # without the caller's variables is accepted too. Never more than that: another value still refuses.
      case "$config_check" in
        any-config|stopped-stale-config) ;;
        *)
          seen_hash="${details##*|}"
          if [ "$seen_hash" != "$expected_hash" ] && podman_caller_env_set \
              && printf '%s' "$seen_hash" | grep -Eq '^[0-9a-f]{64}$'; then
            clean_hash="$(podman_expected_config_hash "$COMPOSE_FILE" "$service" clean 2>/dev/null)" || clean_hash=""
            [ -z "$clean_hash" ] || [ "$seen_hash" != "$clean_hash" ] || expected_hash="$seen_hash"
          fi
          ;;
      esac
      expected_line="$service|true|$expected_project|$expected_project|$service|$service|1|$RUNTIME_DIR|$expected_files|$expected_version|$expected_unit|$expected_hash"
      [ "$details" = "$expected_line" ] || return 1
      # what a later call may reuse (attest_cache_store): a running container that matched the line in full
      [ "$stopped" -ne 0 ] || [ "$config_check" != exact ] || cacheable=1
      # A stopped container is not a running one, except for the checks that stop or recreate it.
      case "$config_check" in
        any-config|stopped-stale-config) ;;
        *) [ "$stopped" -eq 0 ] || continue ;;
      esac
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
  if [ "$cacheable" -eq 1 ] && [ "$CONTAINER_RUNTIME" = podman ] && [ "${JHT_ATTEST_CACHE:-1}" != 0 ]; then
    attest_cache_store "$service" "$found" "$expected_line" || attest_cache_clear "$service"
  fi
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
  local expected_team=""
  case "$#:${1:-}" in
    0:) ;;
    1:--expect-team-stdin)
      IFS= read -r expected_team || return 64
      [ "${#expected_team}" -ge 16 ] && [ "${#expected_team}" -le 128 ] || return 64
      case "$expected_team" in *[!A-Za-z0-9_-]*) return 64 ;; esac
      ;;
    *) return 2 ;;
  esac
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
  local metadata_status=0
  metadata="$(docker exec "$container_id" node -e '
const fs=require("fs"); const expected=process.argv[1]||"";
if(expected){
 let cloud; try { cloud=JSON.parse(fs.readFileSync("/jht_home/cloud.json","utf8")); } catch { process.exit(72); }
 if(typeof cloud.user_id!=="string"||cloud.user_id!==expected) process.exit(72);
}
let config={};
try { config=JSON.parse(fs.readFileSync("/jht_home/jht.config.json","utf8")); } catch {}
const provider=String(config.active_provider||"").toLowerCase();
const providers=config.providers||{}; const entry=providers[provider]||{};
const configured=["claude","anthropic","codex","openai","kimi","moonshot"].includes(provider)
  && (entry.auth_method||"subscription")==="subscription";
const markers={claude:"/jht_home/.claude/.credentials.json",anthropic:"/jht_home/.claude/.credentials.json",codex:"/jht_home/.codex/auth.json",openai:"/jht_home/.codex/auth.json",kimi:"/jht_home/.kimi/credentials/kimi-code.json",moonshot:"/jht_home/.kimi/credentials/kimi-code.json"};
process.stdout.write(`${configured?1:0} ${markers[provider]&&fs.existsSync(markers[provider])?1:0} ${fs.existsSync("/jht_home/profile/welcomed.flag")?1:0}`);
' "$expected_team" 2>/dev/null)" || metadata_status=$?
  if [ "$metadata_status" -ne 0 ]; then
    [ -z "$expected_team" ] || return "$metadata_status"
    metadata=""
  fi
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
    # The chat as ONE script of the container with closed arguments (the script refuses
    # anything outside its lists and alphabets again): `read AGENT [CURSOR]` and
    # `chat-send AGENT CLIENT_ID`, the text on standard input. The app calls them only on a wrapper
    # that carries JHT_DESKTOP_CHAT_FIXED=1; for one that does not, it keeps the older actions above.
    # Here a 2 is the script's own (python3 says it when the image has no agent_chat.py).
    read)
      [ "$#" -eq 2 ] || [ "$#" -eq 3 ] || return 2
      docker exec -i "$container_id" python3 -I /app/shared/skills/agent_chat.py read "$2" ${3:+"$3"}
      ;;
    chat-send)
      [ "$#" -eq 3 ] || return 2
      docker exec -i "$container_id" python3 -I /app/shared/skills/agent_chat.py send "$2" "$3"
      ;;
    # `chat-answer AGENT QUESTION_ID`, the options and the words on standard input as one JSON line;
    # `chat-enter AGENT MESSAGE_ID`, nothing on standard input. The app calls them only on a wrapper
    # that carries JHT_DESKTOP_CHAT_ANSWER=1.
    chat-answer)
      [ "$#" -eq 3 ] || return 2
      docker exec -i "$container_id" python3 -I /app/shared/skills/agent_chat.py answer "$2" "$3"
      ;;
    chat-enter)
      [ "$#" -eq 3 ] || return 2
      docker exec -i "$container_id" python3 -I /app/shared/skills/agent_chat.py enter "$2" "$3"
      ;;
    *) return 2 ;;
  esac
}

# Pannello agenti del desktop (`jht agent-control ...`). Non avvia mai niente:
# niente ensure_up, niente compose, niente machine. Con il container spento o
# non attestato risponde con il codice chiuso agent_control_no_team (113) e
# basta. Altrimenti passa gli argomenti, come argv e senza TTY, al CLI nel
# container, che controlla la forma e li passa allo script del pannello;
# stdout e codice d'uscita tornano invariati.
agent_control() {
  local container_id
  container_id="$(read_only_container_id)" || {
    printf '%s\n' '{"ok":false,"error":"agent_control_no_team"}'
    return 113
  }
  docker exec -i -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$container_id" node "$NODE_ENTRY" agent-control "$@"
}

# Docker c'e' ED e' raggiungibile? A differenza di require_docker NON esce:
# serve a DECIDERE, non a pretendere.
docker_reachable() {
  command -v docker >/dev/null 2>&1 || return 1
  # Una machine Podman che vede piu' del Mac di ~/.jht e dei documenti JHT non
  # e' "raggiungibile": i probe non la usano, e i comandi che la pretendono
  # (up, status, require_docker, upgrade) escono spiegando il motivo.
  if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
    podman_machine_confined || return 1
  elif [ "$PODMAN_RUNTIME_MODE" = "native" ]; then
    podman_native_rootless || return 1
  fi
  docker info >/dev/null 2>&1
}

# Il file di un profilo sta sull'host e il container non lo vede: il wrapper lo
# legge (regolare, non un link, al massimo 64 KiB come l'import dell'app) e lo passa
# su stdin al CLI del container attestato. Vale per `jht profile import FILE` e per
# `jht profile validate FILE`: i limiti di sicurezza sono quelli di qui sotto, in un
# posto solo, e al container non arriva mai un percorso dell'host.
profile_host_file_ok() {
  local file="$1" size
  if [ -L "$file" ] || [ ! -f "$file" ]; then
    err "il profilo deve essere un file regolare, non un link: $file"; return 1
  fi
  size="$(wc -c < "$file" | tr -d ' ')"
  if [ -z "$size" ] || [ "$size" -gt 65536 ]; then
    err "il file del profilo supera i 64 KiB"; return 1
  fi
}

# jht profile import FILE: convalida, scrittura atomica e privata, ready.flag e
# avviso al Capitano restano tutti dentro il CLI, in un posto solo.
profile_import_command() {
  local file="" flag
  local -a extra=()
  for flag in "$@"; do
    case "$flag" in
      --replace|--json) extra+=("$flag") ;;
      -*) err "opzione non riconosciuta: $flag"; return 2 ;;
      *)
        if [ -n "$file" ]; then err "uso: jht profile import FILE [--replace] [--json]"; return 2; fi
        file="$flag" ;;
    esac
  done
  if [ -z "$file" ]; then err "uso: jht profile import FILE [--replace] [--json]"; return 2; fi
  profile_host_file_ok "$file" || return 1
  docker exec -i "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" profile import --stdin ${extra[@]+"${extra[@]}"} < "$file"
}

# jht profile validate FILE: stesso passaggio del file di import; non scrive niente.
# Senza FILE il CLI controlla il profilo del team (dentro il container): si inoltra
# com'e'. Chiamato solo quando c'e' un FILE (vedi profile_validate_has_file).
profile_validate_command() {
  local file="" flag
  local -a extra=()
  for flag in "$@"; do
    case "$flag" in
      --strict|--json) extra+=("$flag") ;;
      -*) err "opzione non riconosciuta: $flag"; return 2 ;;
      *)
        if [ -n "$file" ]; then err "uso: jht profile validate [FILE] [--strict] [--json]"; return 2; fi
        file="$flag" ;;
    esac
  done
  profile_host_file_ok "$file" || return 1
  docker exec -i "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" profile validate --stdin ${extra[@]+"${extra[@]}"} < "$file"
}

# C'e' un FILE fra gli argomenti di `profile validate` (e non e' una richiesta di aiuto)?
profile_validate_has_file() {
  local arg has=1
  for arg in "$@"; do
    case "$arg" in
      --help|-h) return 1 ;;
      -*) ;;
      *) has=0 ;;
    esac
  done
  return "$has"
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
    jht clean-images [--json]
                           toglie le immagini JHT vecchie (tiene la corrente, la
                           piu' recente delle altre e quelle in uso); permesso
                           anche a disco quasi pieno
    jht setup              installazione guidata
    jht download --os X    scarica l'app desktop per un sistema
    jht game start|stop    avvia o ferma il videogioco
    jht gui open           apre l'interfaccia grafica
    jht shell              shell dentro il container
    jht profile import FILE [--replace]
                           da' alla squadra il profilo del candidato (YAML)
    jht profile validate [FILE] [--strict] [--json]
                           controlla un profilo (YAML) senza scrivere niente;
                           senza FILE, quello della squadra
    jht mail setup         salva la casella di posta nel broker dei segreti
    jht mail drafts        email scritte dagli agenti in attesa del tuo ok
    jht mail approve <id>  le manda; jht mail discard <id> le scarta
    jht telegram status    stato del servizio Telegram isolato
    jht telegram pair ROLE chiede il token senza eco sul computer host, poi
                           mostra un codice da mandare al bot dal tuo Telegram
                           Per automazioni: JSON su stdin. Non salvare il token
                           in ~/.jht; cancella subito file usati fuori da lì.
    jht telegram pair --all abbina in una seduta tutti i ruoli legacy
    jht telegram chat-id ROLE sposta il bot su un'altra chat, con lo stesso codice
    jht reset              cancella configurazione e volumi del broker
    jht migrate-runtime podman
                           copia e verifica i volumi Docker in Podman;
                           non seleziona il nuovo runtime e non cancella Docker
    jht podman-machine-recreate --confirm
                           ricrea la macchina Podman (macOS) vedendo
                           solo ~/.jht e ~/Documents/Job Hunter Team
    jht uninstall --confirm rimuove il runtime locale (macchina Podman o
                           container e volumi jht, con i segreti salvati);
                           restano ~/.jht, Documenti, Podman e Docker

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
    up|start-container|down|stop-container|restart|recreate|upgrade|clean-images|logs|status|shell|oauth-login|claude-login|setup|download|podman-machine-recreate|mail|telegram|reset|migrate-runtime)
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

# docker-compose.yml monta il volume `jht-runtime-mask` su /jht_home/runtime,
# cioe' DENTRO il bind ~/.jht: il motore deve fare quel punto di mount nel bind, e
# la machine Podman del Mac non puo' (crun: mkdir /jht_home/runtime: Operation not
# permitted) se la cartella non c'e' gia' sull'host. La crea l'avvio, come
# l'installazione crea ~/.jht: idempotente, 700 solo se la crea, mai un chown, e
# mai toccata se c'e' gia' (anche un link o un file: non e' nostra).
ensure_host_mount_points() {
  local home_dir="${JHT_HOME_HOST:-$HOME/.jht}"
  if [ ! -d "$home_dir" ] && [ ! -e "$home_dir" ] && [ ! -L "$home_dir" ]; then
    # Con i permessi di sempre (umask): con Docker su Linux ensure_bind_owner la passa subito a 1001, e
    # una 700 non sarebbe piu' leggibile dall'utente. Privata e' solo la sottocartella che creiamo qui.
    mkdir -p "$home_dir" || return 0
  fi
  if [ ! -e "$home_dir/runtime" ] && [ ! -L "$home_dir/runtime" ]; then
    mkdir "$home_dir/runtime" 2>/dev/null && chmod 700 "$home_dir/runtime" 2>/dev/null || true
  fi
}

ensure_bind_owner() {
  # Prima di ogni avvio (ensure_up, up, upgrade) e su ogni sistema: il
  # disaccordo sulle cartelle dati vale anche dove l'owner non si tocca.
  host_data_dirs_supported || exit 1
  ensure_host_mount_points
  # Con Podman rootless + keep-id l'utente dell'host resta proprietario dei
  # bind mount. Un chown a 1001 qui romperebbe proprio l'isolamento che il
  # namespace utente deve garantire.
  [ "$PODMAN_RUNTIME_MODE" != "native" ] || return 0
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
  local stuck=()
  for d in "$home_dir" "$user_dir"; do
    [ -d "$d" ] || continue
    local cur_uid
    cur_uid=$(stat -c '%u' "$d" 2>/dev/null || echo "")
    if [ -n "$cur_uid" ] && [ "$cur_uid" != "$target_uid" ]; then
      info "Allineo owner di $d a $target (era uid $cur_uid)..."
      if [ "$(id -u)" = "0" ]; then
        chown -R "$target" "$d" 2>/dev/null || warn "chown fallito su $d"
      elif [ "$target" = "1001:1001" ] && repair_owner_in_container "$home_dir" "$user_dir"; then
        break  # un container una tantum ha sistemato entrambe le cartelle: niente sudo
      else
        sudo chown -R "$target" "$d" 2>/dev/null || warn "sudo chown fallito su $d (potrebbe servire 'sudo $0 up')"
      fi
      cur_uid=$(stat -c '%u' "$d" 2>/dev/null || echo "")
      [ "$cur_uid" = "$target_uid" ] || stuck+=("$d")
    fi
  done
  # Il container gira come $target: con le cartelle di un altro utente parte e muore subito
  # (mount_not_writable, EACCES) in un ciclo di riavvii. Meglio fermarsi qui, dicendo cosa fare.
  if [ "${#stuck[@]}" -gt 0 ]; then
    err "mount_repair_failed: ${stuck[*]} non si puo' rendere scrivibile al container (gira come uid $target_uid) e non e' stato avviato niente. Fai una volta: sudo chown -R $target ${stuck[*]} oppure metti questo utente nel gruppo 'docker' e riesegui 'jht up'."
    exit 1
  fi
}

# Un utente normale (uid diverso da 1001, senza sudo) con Docker su Linux: lo stesso container una tantum del
# wrapper Windows (.launcher/repair-mounts.sh, una ricevuta per cartella). Root dentro, ma solo CAP_CHOWN e
# CAP_DAC_READ_SEARCH (la seconda per entrare in una cartella che l'utente tiene privata, 700), senza rete,
# senza nuovi privilegi e con montate solo le due cartelle. Vero solo se entrambe sono confermate.
MOUNT_REPAIR_DISPATCH='if [ -x /app/.launcher/repair-mounts.sh ]; then exec /app/.launcher/repair-mounts.sh; else echo mount_repair_unsupported; fi'
repair_owner_in_container() {
  local home_dir="$1" user_dir="$2" receipts
  [ "$CONTAINER_RUNTIME" = "docker" ] || return 1
  receipts="$(docker run --rm --user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH --network none \
      --security-opt no-new-privileges \
      -v "$home_dir:/jht_home" -v "$user_dir:/jht_user" \
      --entrypoint /bin/sh "${JHT_IMAGE:-$DEFAULT_RUNTIME_IMAGE}" -c "$MOUNT_REPAIR_DISPATCH" 2>/dev/null)" || return 1
  printf '%s\n' "$receipts" | grep -Eqx 'mount_(ok|repaired) /jht_home' || return 1
  printf '%s\n' "$receipts" | grep -Eqx 'mount_(ok|repaired) /jht_user' || return 1
  ! printf '%s\n' "$receipts" | grep -Eqv 'mount_(ok|repaired) /jht_(home|user)'
}

# Le cartelle dei dati sono fisse: docker-compose.yml monta ${HOME}/.jht e
# ${HOME}/Documents/Job Hunter Team, l'app desktop legge ~/.jht, e su macOS la
# machine Podman dichiara esattamente quelle due (PODMAN_MOUNT_*). Una
# JHT_HOME_HOST o JHT_USER_DIR_HOST altrove metterebbe il wrapper in disaccordo
# con tutti gli altri: i dati finirebbero in due posti, e su macOS ogni bind
# della cartella spostata morirebbe con «statfs ... no such file or
# directory». Meglio dirlo prima, con la cosa da fare.
host_data_dir_same() {
  local given="${1%/}" expected="${2%/}" a b
  [ "$given" = "$expected" ] && return 0
  a="$(cd -P "$given" 2>/dev/null && pwd -P)" || return 1
  b="$(cd -P "$expected" 2>/dev/null && pwd -P)" || return 1
  [ "$a" = "$b" ]
}

host_data_dirs_supported() {
  local expected_home="$HOME/.jht" expected_user="$HOME/Documents/Job Hunter Team"
  if [ -n "${JHT_HOME_HOST:-}" ] && ! host_data_dir_same "$JHT_HOME_HOST" "$expected_home"; then
    err "data_dir_moved: JHT_HOME_HOST=$JHT_HOME_HOST non e' $expected_home. Il team usa sempre $expected_home: lo monta il compose, lo legge l'app, e su macOS e' l'unica cartella dati che la macchina Podman vede. Togli JHT_HOME_HOST, oppure sposta i dati in $expected_home."
    return 1
  fi
  if [ -n "${JHT_USER_DIR_HOST:-}" ] && ! host_data_dir_same "$JHT_USER_DIR_HOST" "$expected_user"; then
    err "data_dir_moved: JHT_USER_DIR_HOST=$JHT_USER_DIR_HOST non e' $expected_user. Il team usa sempre $expected_user: lo monta il compose, e su macOS e' l'unica cartella documenti che la macchina Podman vede. Togli JHT_USER_DIR_HOST, oppure sposta i documenti in $expected_user."
    return 1
  fi
}

# `jht team stop`: stopping the team must work whenever `jht down` does. A container of ours whose config-hash is not the
# expected one (a caller's environment, a reinstall) is attested by every other label and is used here, for the stop only;
# the same rule `container_down` has. An absent container, or anything else, goes the old way (ensure_up).
ensure_up_for_stop() {
  local status=0 found
  if container_up; then
    return 0
  else
    status=$?
  fi
  if [ "$status" -ne 3 ] && [ "$CONTAINER_RUNTIME" = podman ] \
      && found="$(read_only_service_id "$CONTAINER_SERVICE" any-config 2>/dev/null)"; then
    ATTESTED_CONTAINER_ID="$found"
    warn "config_changed_while_running: il team gira con una configurazione diversa da quella attesa; la uso solo per fermarlo."
    return 0
  fi
  ensure_up
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
    stale_config_hint
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

# ── Disco quasi pieno: nessun upgrade ──────────────────────────────────────
# Un upgrade scarica un'immagine da centinaia di MB e riscrive il runtime: su un
# disco al limite muore a meta' e lascia un rollback da fare su un disco pieno.
# Si rifiuta PRIMA di scaricare qualunque cosa, col codice chiuso `disk_low`
# (anche `--check`, che scarica l'immagine), quando lo spazio libero e' sotto il
# 3% E sotto 8 GiB: la percentuale da sola rifiutava un disco da 500 GiB con 14 GiB
# ancora liberi. Le soglie (avviso: 10% E 20 GiB) sono le stesse di
# shared/skills/host_vitals.py e cli/src/lib/disk-guard.js (tests/test_disk_guard.py
# le confronta), qui in per mille e in KiB (l'unita' di `df -Pk`) per restare in
# aritmetica intera.
#
# La pulizia che gira a upgrade riuscito (piu' sotto) non parte sotto la soglia,
# perche' l'upgrade e' rifiutato prima. La via per recuperare spazio a disco
# pieno e' `jht clean-images`: la stessa pulizia, in un comando SEPARATO che non
# passa da `disk_low`. Il rifiuto dice all'utente di usarlo (messaggio qui sotto
# e frase `disk.low.cli`).
#
# Si misurano i volumi che l'host puo' vedere: la cartella dati (~/.jht) e, su
# Linux, la radice dati del motore. Su macOS il disco del motore sta dentro la
# macchina Podman/VM e da qui non si legge: resta «sconosciuto» e NON si ripiega
# sul disco del Mac. Un volume che non si misura non rifiuta niente.
DISK_WARN_FREE_PERMILLE=100
DISK_WARN_FREE_KIB=20971520
DISK_BLOCK_FREE_PERMILLE=30
DISK_BLOCK_FREE_KIB=8388608
DISK_LOW_PERMILLE=""
DISK_LOW_AVAIL_KIB=""

# KiB -> «GiB» a un decimale con la virgola italiana («8», «5,2»). Per DIFETTO: non si
# promette piu' spazio di quello che c'e'. In interi, come le soglie.
disk_gib_text() {
  local tenths=$(( $1 * 10 / 1048576 ))
  if [ $(( tenths % 10 )) -eq 0 ]; then
    printf '%s' $(( tenths / 10 ))
  else
    printf '%s,%s' $(( tenths / 10 )) $(( tenths % 10 ))
  fi
}

# Stampa «<per mille liberi> <KiB liberi>» del volume che contiene $1.
disk_free_measure() {
  local target="$1" line total avail
  [ -n "$target" ] || return 1
  # La cartella dati puo' non esistere ancora: si misura il primo antenato.
  while [ ! -e "$target" ] && [ "$target" != "/" ] && [ "$target" != "." ]; do
    target="$(dirname "$target")"
  done
  [ -e "$target" ] || return 1
  line="$(df -Pk "$target" 2>/dev/null | awk 'NR==2 {print $2 " " $4}')" || return 1
  read -r total avail <<<"$line"
  case "$total" in ''|*[!0-9]*) return 1 ;; esac
  case "$avail" in ''|*[!0-9]*) return 1 ;; esac
  [ "$total" -gt 0 ] || return 1
  printf '%s %s' $(( avail * 1000 / total )) "$avail"
}

disk_engine_path() {
  if [ -n "${JHT_ENGINE_DISK_PATH+x}" ]; then
    printf '%s' "$JHT_ENGINE_DISK_PATH"
    return 0
  fi
  [ "$(uname -s)" = "Linux" ] || return 0
  local candidate
  for candidate in /var/lib/docker /var/lib/containers; do
    if [ -d "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
}

# Livello di uno spazio libero (`ok|warn|low`) dato per mille e KiB liberi: serve
# la percentuale E i byte. Il per mille e' il pavimento di libero*1000/totale,
# quindi «< 30» equivale esattamente a «libero*100 < 3*totale»: lo stesso
# confine di Python e JS, senza arrotondamenti.
disk_level_of() {
  if [ "$1" -lt "$DISK_BLOCK_FREE_PERMILLE" ] && [ "$2" -lt "$DISK_BLOCK_FREE_KIB" ]; then
    printf low
  elif [ "$1" -lt "$DISK_WARN_FREE_PERMILLE" ] && [ "$2" -lt "$DISK_WARN_FREE_KIB" ]; then
    printf warn
  else
    printf ok
  fi
}

# 0 = almeno un volume misurato e' sotto il 3% E sotto 8 GiB (in
# DISK_LOW_PERMILLE il valore e in DISK_LOW_AVAIL_KIB lo spazio libero); 1 = tutti sani oppure non misurabili.
disk_low() {
  local volume measure permille avail_kib
  DISK_LOW_PERMILLE=""
  DISK_LOW_AVAIL_KIB=""
  for volume in "${JHT_HOME_HOST:-$HOME/.jht}" "$(disk_engine_path)"; do
    [ -n "$volume" ] || continue
    measure="$(disk_free_measure "$volume")" || continue
    read -r permille avail_kib <<<"$measure"
    if [ "$(disk_level_of "$permille" "$avail_kib")" = "low" ]; then
      DISK_LOW_PERMILLE="$permille"
      DISK_LOW_AVAIL_KIB="$avail_kib"
      return 0
    fi
  done
  return 1
}

UPGRADE_JSON=0
UPGRADE_STAGE=""
UPGRADE_LOCK=""
UPGRADE_JOURNAL=""
UPGRADE_ROLLBACK_DIR=""
UPGRADE_PRUNE_JSON=""

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
    # imagePrune c'e' solo dopo un upgrade riuscito che ha provato a pulire:
    # gli altri esiti (check, fallimenti, rollback) restano byte per byte quelli di sempre.
    local prune_field=""
    [ -z "$UPGRADE_PRUNE_JSON" ] || prune_field=",\"imagePrune\":$UPGRADE_PRUNE_JSON"
    printf '{"ok":%s,"changed":%s,"phase":"%s","previous":{"version":"%s","image":"%s"},"current":{"version":"%s","image":"%s"},"restartRequired":%s,"message":"%s","rolledBack":%s%s}\n' \
      "$ok" "$changed" "$phase" "$previous_version" "$previous_image" \
      "$current_version" "$current_image" "$restart_required" "$message" "$rolled_back" "$prune_field"
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

# ── Pulizia delle immagini JHT vecchie dopo un upgrade riuscito ────────────
# Ogni upgrade porta un'immagine nuova e Docker/Podman non cancellano mai da
# soli quelle vecchie: sull'host di un utente se ne accumulavano 23 (decine di
# GB). Si tiene SOLO la corrente e la precedente (l'ancora del rollback).
# Regole, tutte qui sotto e nei test:
#   - solo repository JHT per nome ESATTO (ghcr.io/leopu00/jht, jht,
#     localhost/jht): ghcr.io/leopu00/jht-altro o qualunque altro e' un'altra cosa;
#   - mai un'immagine di un container, anche fermo; se i container non si
#     leggono non si toglie niente;
#   - un ID che porta anche un nome NON JHT (altro repository, o `<none>`) non
#     e' nostro da togliere: si tiene;
#   - per ID, senza -f, mai `prune`; il rifiuto del motore si CONTA;
#   - chiamata a upgrade riuscito (mai su check, fallimento o rollback) e dal
#     comando `jht clean-images` (vedi sotto), che e' l'unica via di pulizia
#     permessa anche a disco quasi pieno;
#   - JHT_KEEP_OLD_IMAGES=1 tiene tutto.
JHT_IMAGE_REPOSITORIES="ghcr.io/leopu00/jht jht localhost/jht"

upgrade_repo_is_jht() {
  local r
  for r in $JHT_IMAGE_REPOSITORIES; do
    [ "$1" != "$r" ] || return 0
  done
  return 1
}

# Gli ID che compaiono anche sotto un nome non JHT, uno per riga, preceduti da
# una riga vuota (lo stesso formato del confronto di riga intera piu' sotto).
# $1 = l'elenco «<id> <repository>» del motore.
upgrade_foreign_image_ids() {
  local id repo out=""
  while IFS=' ' read -r id repo; do
    [ -n "$id" ] || continue
    upgrade_repo_is_jht "$repo" || out="$out
$(upgrade_image_plain "$id")"
  done <<EOF
$1
EOF
  printf '%s\n' "$out"
}

upgrade_image_plain() {
  # Docker rende sha256:<id>, Podman l'id nudo: si confronta senza prefisso.
  printf '%s' "${1#sha256:}"
}

upgrade_prune_result() {
  # skipped removed freed_bytes refused in_use
  UPGRADE_PRUNE_JSON="$(printf '{"removed":%s,"freedBytes":%s,"refused":%s,"inUse":%s,"kept":["current","previous"],"skipped":"%s"}' \
    "$2" "$3" "$4" "$5" "$1")"
}

upgrade_prune_old_images() {
  local current previous running_id containers in_use in_use_plain listing id repo foreign
  local removed=0 freed=0 refused=0 busy=0 size seen=""
  UPGRADE_PRUNE_JSON=""
  if [ "${JHT_KEEP_OLD_IMAGES:-0}" = "1" ]; then
    upgrade_prune_result opt-out 0 0 0 0
    upgrade_note "Immagini JHT vecchie: tenute tutte (JHT_KEEP_OLD_IMAGES=1)."
    return 0
  fi
  current="$(upgrade_image_plain "$1")"
  previous="$(upgrade_image_plain "$2")"
  case "$current" in ''|none|sconosciuta|unknown) upgrade_prune_result current-unidentified 0 0 0 0; return 0 ;; esac
  case "$previous" in ''|none|sconosciuta|unknown) upgrade_prune_result previous-unidentified 0 0 0 0; return 0 ;; esac
  # La corrente deve essere davvero quella del container che gira adesso.
  running_id="$(upgrade_image_plain "$(upgrade_image)")"
  if [ "$running_id" != "$current" ]; then
    upgrade_prune_result current-not-running 0 0 0 0
    return 0
  fi
  # Immagini di TUTTI i container, anche fermi. Se non si leggono: niente.
  containers="$(docker container ls -a -q --no-trunc 2>/dev/null)" || containers="__unreadable__"
  if [ "$containers" = "__unreadable__" ]; then
    upgrade_prune_result containers-unreadable 0 0 0 0
    return 0
  fi
  in_use=""
  if [ -n "$containers" ]; then
    # shellcheck disable=SC2086
    in_use="$(docker inspect --format '{{.Image}}' $containers 2>/dev/null)" || in_use="__unreadable__"
    if [ "$in_use" = "__unreadable__" ]; then
      upgrade_prune_result containers-unreadable 0 0 0 0
      return 0
    fi
  fi
  # Un id per riga, senza prefisso, con una riga vuota ai due capi: il
  # confronto e' di riga intera, senza pipe (set -o pipefail + grep -q e SIGPIPE).
  in_use_plain="
$(printf '%s\n' "$in_use" | sed 's/^sha256://')
"
  listing="$(docker image ls --no-trunc --format '{{.ID}} {{.Repository}}' 2>/dev/null)" || listing="__unreadable__"
  if [ "$listing" = "__unreadable__" ]; then
    upgrade_prune_result images-unreadable 0 0 0 0
    return 0
  fi
  foreign="$(upgrade_foreign_image_ids "$listing")"
  while IFS=' ' read -r id repo; do
    [ -n "$id" ] || continue
    upgrade_repo_is_jht "$repo" || continue
    local plain
    plain="$(upgrade_image_plain "$id")"
    [ "$plain" != "$current" ] || continue
    # `previous` e' un ID (upgrade) o piu' ID, uno per riga (clean-images).
    case "
$previous
" in *"
$plain
"*) continue ;; esac
    case "$foreign
" in *"
$plain
"*) continue ;; esac
    # Lo stesso ID compare una volta per tag: lo si tratta una volta sola.
    case "
$seen
" in *"
$plain
"*) continue ;; esac
    seen="$seen
$plain"
    case "$in_use_plain" in
      *"
$plain
"*) busy=$((busy + 1)); continue ;;
    esac
    size="$(docker image inspect --format '{{.Size}}' "$id" 2>/dev/null | head -n 1)" || size=0
    case "$size" in ''|*[!0-9]*) size=0 ;; esac
    if docker image rm "$id" >/dev/null 2>&1; then
      removed=$((removed + 1))
      freed=$((freed + size))
    else
      refused=$((refused + 1))
    fi
  done <<EOF
$listing
EOF
  upgrade_prune_result "" "$removed" "$freed" "$refused" "$busy"
  local note="Immagini JHT vecchie: rimosse $removed, liberati circa $((freed / 1048576)) MB (dimensione nominale: i layer condivisi si liberano solo in parte), tenute: corrente, precedente."
  [ "$busy" -eq 0 ] || note="$note In uso da un container (tenute): $busy."
  [ "$refused" -eq 0 ] || note="$note Rifiutate dal motore (tenute): $refused."
  upgrade_note "$note"
  return 0
}

# ── `jht clean-images`: la pulizia, permessa anche a disco quasi pieno ─────────
# `jht upgrade` sotto la soglia del disco rifiuta (`disk_low`) e con lui la
# pulizia che gira a upgrade riuscito: a disco pieno l'utente non avrebbe una
# via per recuperare spazio. Questo comando e' quella via, SEPARATA dall'upgrade
# (che resta rifiutato) e senza passare da `disk_low`. Fa la stessa pulizia
# (upgrade_prune_old_images: stesse regole, nessuna in piu' o in meno sotto
# soglia) e in piu' non accende niente: ne' machine Podman, ne' Docker, ne'
# container.
#
# Fuori da un upgrade non c'e' un'immagine «precedente» registrata: e' la JHT
# piu' recente per data di creazione fra le non correnti (a pari secondo si
# tengono tutte). Dopo un rollback puo' essere PIU' NUOVA della corrente: va
# bene, sbaglia dal lato prudente (tiene un'immagine in piu', mai una in meno).
# Le date si confrontano come secondi dall'epoca UTC (clean_images_epoch), non
# come testo: i due motori le scrivono in modo diverso e Podman con un fuso
# esplicito. Se una data non si legge, non si toglie niente.

# Stampa i secondi dall'epoca UTC di una data di creazione, o ritorna 1 se non
# e' in uno dei due formati noti (qualunque altra cosa = illeggibile):
#   Docker  2026-10-05T10:00:00.123456789Z       (RFC 3339, sempre «Z»)
#   Podman  2026-10-05 10:00:00.123456789 +0000 UTC
# Podman stampa `.Created` con time.Time.String() di Go: layout
# «2006-01-02 15:04:05.999999999 -0700 MST», frazione senza zeri finali (o
# assente), fuso numerico sempre presente; il nome del fuso e' una sigla
# («UTC», «CEST») oppure, se il fuso non ha nome, ancora l'offset («+0200»).
# Conta solo l'offset numerico, il nome si ignora. Prima del 1970 = illeggibile
# (una data a zero e' «nessuna data», non «la piu' vecchia»).
# $1 = il testo stampato dal motore.
clean_images_epoch() {
  local text="$1" y m d hh mi ss sign oh om offset days
  local docker_re='^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?Z$'
  local podman_re='^([0-9]{4})-([0-9]{2})-([0-9]{2})[ ]([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]+)?[ ]([+-])([0-9]{2})([0-9]{2})([ ][^ ]+)?$'
  if [[ "$text" =~ $docker_re ]]; then
    sign=+ oh=00 om=00
  elif [[ "$text" =~ $podman_re ]]; then
    sign="${BASH_REMATCH[8]}" oh="${BASH_REMATCH[9]}" om="${BASH_REMATCH[10]}"
  else
    return 1
  fi
  y=$((10#${BASH_REMATCH[1]})) m=$((10#${BASH_REMATCH[2]})) d=$((10#${BASH_REMATCH[3]}))
  hh=$((10#${BASH_REMATCH[4]})) mi=$((10#${BASH_REMATCH[5]})) ss=$((10#${BASH_REMATCH[6]}))
  oh=$((10#$oh)) om=$((10#$om))
  [ "$y" -ge 1970 ] && [ "$m" -ge 1 ] && [ "$m" -le 12 ] && [ "$d" -ge 1 ] && [ "$d" -le 31 ] || return 1
  [ "$hh" -le 23 ] && [ "$mi" -le 59 ] && [ "$ss" -le 59 ] && [ "$oh" -le 14 ] && [ "$om" -le 59 ] || return 1
  # Giorni dal 1970-01-01 (calendario gregoriano, algoritmo days-from-civil).
  [ "$m" -gt 2 ] || y=$((y - 1))
  days=$(( (y / 400) * 146097 + (y % 400) * 365 + (y % 400) / 4 - (y % 400) / 100 \
           + (153 * ((m + 9) % 12) + 2) / 5 + d - 1 - 719468 ))
  offset=$((oh * 3600 + om * 60))
  [ "$sign" = + ] || offset=$((0 - offset))
  echo $((days * 86400 + hh * 3600 + mi * 60 + ss - offset))
}

# Stampa gli ID (senza prefisso) delle JHT non correnti piu' recenti, uno per
# riga; niente se non ce ne sono. Ritorna 1 se non si legge l'elenco o una data.
# $1 = ID della corrente, senza prefisso.
clean_images_previous() {
  local current="$1" listing foreign id repo plain created epoch
  local seen="" newest="" keep=""
  listing="$(docker image ls --no-trunc --format '{{.ID}} {{.Repository}}' 2>/dev/null)" || return 1
  foreign="$(upgrade_foreign_image_ids "$listing")"
  while IFS=' ' read -r id repo; do
    [ -n "$id" ] || continue
    upgrade_repo_is_jht "$repo" || continue
    plain="$(upgrade_image_plain "$id")"
    [ "$plain" != "$current" ] || continue
    case "$foreign
" in *"
$plain
"*) continue ;; esac
    case "
$seen
" in *"
$plain
"*) continue ;; esac
    seen="$seen
$plain"
    created="$(docker image inspect --format '{{.Created}}' "$id" 2>/dev/null | head -n 1)" || return 1
    epoch="$(clean_images_epoch "$created")" || return 1
    if [ -z "$newest" ] || [ "$epoch" -gt "$newest" ]; then
      newest="$epoch"
      keep="$plain"
    elif [ "$epoch" -eq "$newest" ]; then
      keep="$keep
$plain"
    fi
  done <<EOF
$listing
EOF
  [ -z "$keep" ] || printf '%s\n' "$keep"
}

clean_images_message() {
  case "$1" in
    opt-out) printf '%s' "JHT_KEEP_OLD_IMAGES=1: le immagini vecchie restano tutte. Toglilo per pulire." ;;
    runtime-not-installed) printf '%s' "Il runtime di Job Hunter Team non e' installato: non c'e' niente da pulire." ;;
    upgrade-in-progress) printf '%s' "Un aggiornamento e' in corso: riprova quando e' finito. Non e' stato tolto niente." ;;
    upgrade-pending) printf '%s' "Un aggiornamento interrotto aspetta di essere ripreso (la versione precedente serve al ripristino): esegui 'jht upgrade'. Non e' stato tolto niente." ;;
    current-unidentified|current-not-running) printf '%s' "Il container di Job Hunter Team non e' in esecuzione, quindi non so quale immagine e' quella in uso: accendilo con 'jht up' e riprova. Non e' stato tolto niente." ;;
    previous-unidentified) printf '%s' "Non riesco a leggere la data delle immagini: non e' stato tolto niente." ;;
    containers-unreadable|images-unreadable) printf '%s' "Il motore non risponde come atteso: non e' stato tolto niente." ;;
    *) printf '%s' "Non e' stato tolto niente." ;;
  esac
}

# $1 = ok (true|false), $2 = messaggio (testo fisso nostro: senza virgolette ne'
# backslash). In --json e' l'unica riga di stdout.
clean_images_emit() {
  if [ "$UPGRADE_JSON" = "1" ]; then
    printf '{"ok":%s,"message":"%s"%s}\n' "$1" "$2" \
      "${UPGRADE_PRUNE_JSON:+,\"imagePrune\":$UPGRADE_PRUNE_JSON}"
  elif [ -n "$2" ]; then
    info "$2"
  fi
}

handle_clean_images() {
  local arg current previous skipped
  UPGRADE_JSON=0
  for arg in "$@"; do
    case "$arg" in
      --json) UPGRADE_JSON=1 ;;
      *) err "Opzione di clean-images non supportata: $arg (uso: jht clean-images [--json])"; return 2 ;;
    esac
  done
  # Come `status`: una sonda. Una machine Podman che vede piu' del dovuto, o un
  # motore spento, non si accendono ne' si ripara da qui.
  require_confined_podman_machine
  if ! docker_reachable; then
    [ "$UPGRADE_JSON" = "1" ] || err "Il motore dei container non e' attivo: non e' stato tolto niente."
    UPGRADE_PRUNE_JSON=""
    clean_images_emit false "Motore non attivo"
    return 1
  fi
  UPGRADE_PRUNE_JSON=""
  if [ ! -d "$RUNTIME_DIR" ]; then
    upgrade_prune_result runtime-not-installed 0 0 0 0
    clean_images_emit true "$(clean_images_message runtime-not-installed)"
    return 0
  fi
  if ! upgrade_acquire_lock; then
    upgrade_prune_result upgrade-in-progress 0 0 0 0
    clean_images_emit true "$(clean_images_message upgrade-in-progress)"
    return 0
  fi
  trap upgrade_cleanup_ephemeral EXIT INT TERM
  if [ -e "$RUNTIME_DIR/.upgrade-journal" ]; then
    upgrade_prune_result upgrade-pending 0 0 0 0
    clean_images_emit true "$(clean_images_message upgrade-pending)"
    return 0
  fi
  if [ "${JHT_KEEP_OLD_IMAGES:-0}" = "1" ]; then
    upgrade_prune_result opt-out 0 0 0 0
    clean_images_emit true "$(clean_images_message opt-out)"
    return 0
  fi
  current="$(upgrade_image_plain "$(upgrade_image)")"
  case "$current" in
    ''|none|sconosciuta|unknown)
      upgrade_prune_result current-unidentified 0 0 0 0
      clean_images_emit true "$(clean_images_message current-unidentified)"
      return 0
      ;;
  esac
  if ! previous="$(clean_images_previous "$current")"; then
    upgrade_prune_result previous-unidentified 0 0 0 0
    clean_images_emit true "$(clean_images_message previous-unidentified)"
    return 0
  fi
  if [ -z "$previous" ]; then
    # Nessuna JHT oltre alla corrente: niente da togliere.
    upgrade_prune_result "" 0 0 0 0
    clean_images_emit true "Nessuna immagine JHT vecchia da togliere."
    return 0
  fi
  # La pulizia stampa da sola l'esito (e lascia il blocco in UPGRADE_PRUNE_JSON).
  upgrade_prune_old_images "$current" "$previous" || true
  skipped="$(printf '%s' "$UPGRADE_PRUNE_JSON" | sed -n 's/.*"skipped":"\([^"]*\)".*/\1/p')"
  if [ -n "$skipped" ]; then
    clean_images_emit true "$(clean_images_message "$skipped")"
  else
    clean_images_emit true ""
  fi
  return 0
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
  if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
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
  # Un'installazione del canale di test e' fissata a un commit: l'upgrade
  # scaricherebbe il compose di produzione e mescolerebbe i due canali.
  if [ -f "$RUNTIME_IMAGE_PIN" ]; then
    upgrade_result false false preflight unknown none unknown none false "Installazione del canale di test: si aggiorna reinstallando dalla build di test" false
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
    # A team of ours that is there but stopped counts as absent for the upgrade (there is nothing running
    # to put back), yet it is not "not installed": say so.
    if [ "$CONTAINER_RUNTIME" = podman ] && read_only_service_id "$CONTAINER_SERVICE" any-config >/dev/null 2>&1; then
      old_version="ferma"
    fi
  fi
  old_image="${old_image:-none}"
  old_version="${old_version:-sconosciuta}"

  # Disco quasi pieno (< 3% E < 8 GiB liberi): nessun upgrade, e nemmeno `--check` che
  # scarica l'immagine. PRIMA di creare directory o scaricare: il runtime in
  # corso, e gli agenti che ci girano, restano intatti. Il codice e' chiuso
  # (`disk_low`); la frase la mostra l'app dalla sua tabella codice->frase.
  if disk_low; then
    [ "$UPGRADE_JSON" = "1" ] || err "disk_low: Gli agenti richiedono almeno $(disk_gib_text "$DISK_BLOCK_FREE_KIB") GiB di disco — disponibili: $(disk_gib_text "$DISK_LOW_AVAIL_KIB") GiB. Per liberare spazio esegui 'jht clean-images' (toglie solo le vecchie versioni di Job Hunter Team), svuota il Cestino ed elimina i file grandi che non ti servono, poi riprova: non e' stato scaricato ne' modificato niente."
    upgrade_result false false preflight "$old_version" "$old_image" "$old_version" "$old_image" false "disk_low" false
    return 1
  fi

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
  candidate_ref="$(compose_file_images "$candidate_compose" 2>/dev/null | head -n 1)"
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
  # Solo qui: upgrade riuscito, container nuovo verificato e commit fatto.
  # Mai su check, fallimento o rollback, che escono prima.
  upgrade_prune_old_images "$candidate_image" "$old_image" || true
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

# ── jht uninstall ─────────────────────────────────────────────────────────
# Stesso contratto del wrapper Windows: una sola conferma esplicita, righe
# stabili JHT_PHASE/JHT_LEFT su stdout, uscita 0 (niente resta), 2 (uso) o
# 24 (qualcosa resta: si rilancia). Ripetuto dopo un successo esce con 0.
#
# Si toglie solo cio' che l'installer ha messo, da percorsi fissi e mai da
# override d'ambiente: la macchina Podman jht-podman per nome esplicito
# (mai la connessione di default, mai altre macchine), oppure container, reti
# e volumi del progetto Compose di JHT per label (mai un prune); poi il runtime
# host, le righe PATH che install.sh ha aggiunto ai file rc e il comando jht,
# per ultimo, cosi' un fallimento lascia il wrapper per riprovare. Restano
# ~/.jht, Documenti, Homebrew, Podman, podman-compose, Docker, Colima e le
# immagini. Nessun LaunchAgent: ne' install.sh ne' l'app ne creano.
JHT_UNINSTALL_PROTOCOL=1
UNINSTALL_MACHINE_NAME="jht-podman"
UNINSTALL_PROJECT="jht"
UNINSTALL_RC_MARKER="# Added by JHT install.sh"
UNINSTALL_LOSS="Vengono cancellati anche la password della posta e i token di Telegram salvati; ~/.jht e Documenti restano, e con loro la sessione LinkedIn salvata (secrets/linkedin-profile e .cache/linkedin): si toglie con jht reset --scope creds."

uninstall_usage() {
  err "uso: jht uninstall --confirm"
  info "Rimuove il runtime locale di JHT: la macchina Podman jht-podman oppure i container e i volumi di JHT, il runtime host e il comando jht."
  info "$UNINSTALL_LOSS"
  info "Restano anche Podman, podman-compose, Docker, Colima e Homebrew."
}

uninstall_phase() { printf 'JHT_PHASE %s\n' "$1"; }

uninstall_left() {
  printf 'JHT_LEFT %s\n' "$1"
  case "$1" in
    machine) err "Non rimossi: la macchina Podman jht-podman o i container e i volumi di JHT, con i segreti salvati. Rilancia 'jht uninstall --confirm' quando Podman o Docker rispondono." ;;
    runtime) err "Non rimosso: il runtime host di JHT." ;;
    commands) err "Non rimossi: il comando jht o le righe PATH aggiunte dall'installer." ;;
  esac
}

uninstall_runtime_dir() {
  if [ "$HOST_KERNEL" = "Darwin" ]; then
    printf '%s\n' "$HOME/Library/Application Support/Job Hunter Team/host-runtime"
  else
    printf '%s\n' "${XDG_DATA_HOME:-$HOME/.local/share}/job-hunter-team/host-runtime"
  fi
}

# Le cartelle dove install.sh pubblica `jht`: ~/.local/bin, e /usr/local/bin
# quando l'installazione e' stata fatta da root.
uninstall_bin_dirs() {
  printf '%s\n' "$HOME/.local/bin"
  [ "$HOST_UID" -ne 0 ] || printf '%s\n' "/usr/local/bin"
}

uninstall_is_wrapper() {
  [ -f "$1" ] && [ ! -L "$1" ] && grep -Fqx 'JHT_HOST_RUNTIME_PROTOCOL=1' "$1" 2>/dev/null
}

# Altri programmi nella stessa cartella: allora le righe PATH restano, sono
# anche casa loro.
uninstall_bin_has_foreign() {
  local entry
  [ -d "$1" ] || return 1
  for entry in "$1"/* "$1"/.[!.]* "$1"/..?*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    [ "$entry" = "$1/jht" ] && continue
    return 0
  done
  return 1
}

uninstall_rc_files() {
  printf '%s\n' "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile"
}

uninstall_rc_has_block() {
  [ -f "$1" ] || return 1
  JHT_RC_LINE="export PATH=\"\$PATH:$2\"" JHT_RC_MARKER="$UNINSTALL_RC_MARKER" awk '
    BEGIN { line = ENVIRON["JHT_RC_LINE"]; marker = ENVIRON["JHT_RC_MARKER"] }
    prev == marker && $0 == line { found = 1 }
    { prev = $0 }
    END { exit found ? 0 : 1 }
  ' "$1"
}

# Toglie il blocco che install.sh ha aggiunto (riga vuota, commento, export) e
# nient'altro. Si riscrive accanto e si rinomina: un file rc a meta' non resta.
uninstall_rc_drop_block() {
  local rc="$1" bin="$2" tmp
  [ -f "$rc" ] && [ ! -L "$rc" ] && [ -w "$rc" ] || return 1
  tmp="$(mktemp "$(dirname "$rc")/.jht-uninstall.XXXXXX")" || return 1
  if cp -p "$rc" "$tmp" \
      && JHT_RC_LINE="export PATH=\"\$PATH:$bin\"" JHT_RC_MARKER="$UNINSTALL_RC_MARKER" awk '
        BEGIN { line = ENVIRON["JHT_RC_LINE"]; marker = ENVIRON["JHT_RC_MARKER"] }
        { lines[n++] = $0 }
        END {
          for (i = 0; i < n; i++) {
            if (lines[i] == marker && i + 1 < n && lines[i + 1] == line) {
              if (k > 0 && out[k - 1] == "") k--
              i++
              continue
            }
            out[k++] = lines[i]
          }
          for (j = 0; j < k; j++) print out[j]
        }
      ' "$rc" > "$tmp" \
      && mv -f "$tmp" "$rc"; then
    return 0
  fi
  rm -f -- "$tmp"
  return 1
}

uninstall_commands_left() {
  local bin rc
  while IFS= read -r bin; do
    uninstall_is_wrapper "$bin/jht" && return 0
    uninstall_bin_has_foreign "$bin" && continue
    while IFS= read -r rc; do
      uninstall_rc_has_block "$rc" "$bin" && return 0
    done < <(uninstall_rc_files)
  done < <(uninstall_bin_dirs)
  return 1
}

uninstall_report_rest() {
  [ ! -e "$1" ] && [ ! -L "$1" ] || uninstall_left runtime
  ! uninstall_commands_left || uninstall_left commands
}

# Dove cercare podman e docker oltre al PATH: un'app aperta dal Finder riceve
# il PATH ridotto di launchd, senza Homebrew.
UNINSTALL_TOOL_DIRS="/opt/homebrew/bin /usr/local/bin /usr/bin /opt/podman/bin /Applications/Docker.app/Contents/Resources/bin"

# Il primo eseguibile vero con quel nome; mai lo shim JHT che inoltra Docker a
# Podman (il wrapper lo mette in testa al PATH con il runtime Podman).
uninstall_tool() {
  local candidate dir
  while IFS= read -r candidate; do
    [ -n "$candidate" ] && [ -f "$candidate" ] && [ -x "$candidate" ] || continue
    grep -Fqx '# JHT_PODMAN_DOCKER_SHIM=1' "$candidate" 2>/dev/null && continue
    printf '%s\n' "$candidate"
    return 0
  done < <(
    type -ap "$1" 2>/dev/null || true
    for dir in $UNINSTALL_TOOL_DIRS; do printf '%s\n' "$dir/$1"; done
  )
  return 1
}

# present | absent; ritorna 1 quando Podman non sa rispondere.
uninstall_podman_machine_state() {
  local names name
  names="$("$1" machine list --format '{{.Name}}' 2>/dev/null)" || return 1
  while IFS= read -r name; do
    # Podman marca con * la macchina di default anche in questo formato.
    if [ "${name%\*}" = "$UNINSTALL_MACHINE_NAME" ]; then
      printf 'present\n'
      return 0
    fi
  done <<< "$names"
  printf 'absent\n'
}

# Il progetto Compose ha due nomi: jht con Podman (e in futuro ovunque) e,
# con Docker, il nome della cartella del runtime (host-runtime), perche' li'
# compose_file usa --project-directory. "host-runtime" da solo e' troppo
# generico per cancellare: oltre al progetto si chiede il servizio, il volume
# logico o la rete di default di QUESTO compose, come fa `jht reset`.
UNINSTALL_PROJECTS="jht host-runtime"
UNINSTALL_SERVICES="jht jht-broker jht-telegram"
UNINSTALL_VOLUMES="jht-deps jht-runtime-mask jht-secrets jht-broker-state jht-broker-sock jht-telegram-broker-sock jht-telegram-secrets jht-telegram-state jht-telegram-sock jht-telegram-inbox"

uninstall_docker_ids() {
  local docker_bin="$1" kind="$2" project name ids id
  for project in $UNINSTALL_PROJECTS; do
    case "$kind" in
      container)
        for name in $UNINSTALL_SERVICES; do
          ids="$("$docker_bin" ps -aq --filter "label=com.docker.compose.project=$project" \
            --filter "label=com.docker.compose.service=$name")" || return 1
          uninstall_print_ids $ids || return 1
        done
        ;;
      network)
        ids="$("$docker_bin" network ls -q --filter "label=com.docker.compose.project=$project" \
          --filter "label=com.docker.compose.network=default")" || return 1
        uninstall_print_ids $ids || return 1
        ;;
      volume)
        for name in $UNINSTALL_VOLUMES; do
          ids="$("$docker_bin" volume ls -q --filter "label=com.docker.compose.project=$project" \
            --filter "label=com.docker.compose.volume=$name")" || return 1
          uninstall_print_ids $ids || return 1
        done
        ;;
    esac
  done
}

uninstall_print_ids() {
  local id
  for id in "$@"; do
    case "$id" in ''|*[!A-Za-z0-9_.-]*) return 1 ;; esac
    printf '%s\n' "$id"
  done
}

# Container, reti e volumi di JHT, nell'ordine in cui si liberano.
uninstall_docker_project() {
  local docker_bin="$1" kind id ids
  for kind in container network volume; do
    ids="$(uninstall_docker_ids "$docker_bin" "$kind")" || return 1
    for id in $ids; do
      case "$kind" in
        container) "$docker_bin" rm -f "$id" >/dev/null 2>&1 || return 1 ;;
        network) "$docker_bin" network rm "$id" >/dev/null 2>&1 || return 1 ;;
        volume) "$docker_bin" volume rm "$id" >/dev/null 2>&1 || return 1 ;;
      esac
    done
  done
  for kind in container network volume; do
    ids="$(uninstall_docker_ids "$docker_bin" "$kind")" || return 1
    [ -z "$ids" ] || return 1
  done
}

# L'endpoint a cui parla questo docker: DOCKER_HOST, altrimenti il context
# attivo. Si cancella solo su un Docker di questo computer (socket unix o pipe
# Windows): un context sulla VPS dell'utente farebbe sparire la' i segreti.
uninstall_docker_endpoint() {
  local endpoint
  if [ -n "${DOCKER_HOST:-}" ]; then
    endpoint="$DOCKER_HOST"
  else
    endpoint="$("$1" context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)" || return 1
  fi
  [ -n "$endpoint" ] || return 1
  printf '%s\n' "$endpoint"
}

uninstall_machine() {
  local selection="$1" podman_bin docker_bin state endpoint
  # La macchina jht-podman esiste solo sul Mac. Va tolta anche se il runtime
  # scelto oggi e' Docker: una prova Podman precedente la lascia inerte, con
  # i suoi volumi.
  if [ "$HOST_KERNEL" = "Darwin" ]; then
    if podman_bin="$(uninstall_tool podman)"; then
      state="$(uninstall_podman_machine_state "$podman_bin")" || return 1
      if [ "$state" = "present" ]; then
        "$podman_bin" machine rm --force "$UNINSTALL_MACHINE_NAME" >/dev/null 2>&1 || return 1
        state="$(uninstall_podman_machine_state "$podman_bin")" || return 1
        [ "$state" = "absent" ] || return 1
      fi
    elif [ "$selection" = "podman" ]; then
      return 1
    fi
  fi
  # Linux e Mac con Colima o Docker Desktop: il team e' un progetto Compose
  # nel Docker dell'utente. Con Podman scelto, un vecchio progetto Docker si
  # toglie solo se Docker risponde.
  if docker_bin="$(uninstall_tool docker)"; then
    if ! endpoint="$(uninstall_docker_endpoint "$docker_bin")"; then
      [ "$selection" = "podman" ] && return 0
      err "Non riesco a sapere a quale Docker parla questo computer: i container e i volumi jht non si toccano."
      return 1
    fi
    case "$endpoint" in
      unix://*|npipe://*) ;;
      *)
        [ "$selection" = "podman" ] && return 0
        err "Docker punta a $endpoint, che non e' questo computer: i container e i volumi jht li' non si toccano. Riporta Docker su quello locale (DOCKER_HOST o docker context) e rilancia."
        return 1
        ;;
    esac
    if "$docker_bin" info >/dev/null 2>&1; then
      uninstall_docker_project "$docker_bin" || return 1
    elif [ "$selection" != "podman" ]; then
      return 1
    fi
  fi
}

jht_uninstall() {
  local runtime_dir selection="" bin rc failed=0
  if [ "$#" -ne 1 ] || [ "$1" != "--confirm" ]; then
    uninstall_usage
    return 2
  fi
  case "$HOME" in
    /?*) ;;
    *) err "HOME non valida: rimozione negata."; return 2 ;;
  esac
  runtime_dir="$(uninstall_runtime_dir)"
  if [ -e "$runtime_dir/container-runtime" ] || [ -L "$runtime_dir/container-runtime" ]; then
    if [ -f "$runtime_dir/container-runtime" ] && [ ! -L "$runtime_dir/container-runtime" ]; then
      selection="$(tr -d '\r\n' < "$runtime_dir/container-runtime")"
    fi
    case "$selection" in
      docker|podman) ;;
      *)
        err "Scelta del runtime JHT non leggibile: nessuna rimozione."
        uninstall_report_rest "$runtime_dir"
        return 24
        ;;
    esac
  fi
  info "$UNINSTALL_LOSS"

  uninstall_phase uninstall_machine
  if ! uninstall_machine "$selection"; then
    uninstall_left machine
    uninstall_report_rest "$runtime_dir"
    return 24
  fi

  uninstall_phase uninstall_runtime
  if [ -e "$runtime_dir" ] || [ -L "$runtime_dir" ]; then
    rm -rf -- "$runtime_dir" 2>/dev/null || true
  fi
  if [ -e "$runtime_dir" ] || [ -L "$runtime_dir" ]; then
    uninstall_report_rest "$runtime_dir"
    return 24
  fi
  rmdir -- "$(dirname "$runtime_dir")" 2>/dev/null || true

  uninstall_phase uninstall_commands
  while IFS= read -r bin; do
    uninstall_bin_has_foreign "$bin" && continue
    while IFS= read -r rc; do
      uninstall_rc_has_block "$rc" "$bin" || continue
      uninstall_rc_drop_block "$rc" "$bin" || failed=1
    done < <(uninstall_rc_files)
  done < <(uninstall_bin_dirs)
  if [ "$failed" -eq 0 ]; then
    while IFS= read -r bin; do
      uninstall_is_wrapper "$bin/jht" || continue
      rm -f -- "$bin/jht" 2>/dev/null || failed=1
    done < <(uninstall_bin_dirs)
  fi
  if [ "$failed" -ne 0 ] || uninstall_commands_left; then
    uninstall_left commands
    return 24
  fi
  return 0
}

# ── Dispatcher ────────────────────────────────────────────────────────────
SUB="${1:-}"

# Prima di tutto il resto: deve funzionare anche con il runtime gia' a meta'.
if [ "$SUB" = "uninstall" ]; then
  if jht_uninstall "${@:2}"; then exit 0; else exit $?; fi
fi

# Il gate informativo precede TUTTI i rami, inclusi quelli host-side. Tenerlo
# solo nel catch-all lascia `up --help`, `setup --help`, ecc. liberi di entrare
# nei rispettivi path Docker prima che il wrapper legga `--help`.
# `agent-control` ne resta fuori: le sue forme sono chiuse e un `--help` fra i
# suoi argomenti e' una richiesta da rifiutare con il suo codice, non aiuto.
if [ "$#" -gt 1 ] && [ "$SUB" != "game" ] && [ "$SUB" != "gui" ] && [ "$SUB" != "agent-control" ]; then
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
  -h|--help|'')
    serve_help_without_docker --help
    exit $?
    ;;

  # `jht help` is the LONG list: the short help sends the person to it, so it must not answer with the short one.
  help)
    serve_help_without_docker help
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
    shift || true
    onboarding_snapshot "$@"
    ;;

  agent-control)
    shift || true
    agent_control "$@"
    ;;

  # ── Machine Podman confinata (macOS) ─────────────────────────────────
  # Solo su richiesta esplicita (--confirm): salva lo stato non segreto del
  # broker, ferma e cancella la VM di JHT e la ricrea confinata. I segreti non
  # vengono mai esportati: password e login vanno reinseriti.
  # `podman machine rm` sposta la connessione di default dell'utente: quella
  # di prima viene rimessa, perche' e' condivisa con altri progetti.
  podman-machine-recreate)
    require_compose_file
    if [ "$PODMAN_RUNTIME_MODE" != "machine" ]; then
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
    broker_state_image="$(compose_images)" \
      || { err "Non riesco a determinare l'immagine attestata del broker: il compose del runtime non ha risposto."; exit 1; }
    broker_state_image="$(printf '%s\n' "$broker_state_image" | sort -u)"
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
      --cpus "$PODMAN_MACHINE_CPUS" \
      --memory "$PODMAN_MACHINE_MEMORY_MIB" \
      --disk-size "$PODMAN_MACHINE_DISK_GIB" \
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
    # The stock Fedora CoreOS timer trims weekly. Re-enable it after replacing
    # the VM so applehv can deallocate unused blocks in the sparse disk image.
    enable_podman_trim_timer "$podman_bin" \
      || warn "La macchina e' pronta, ma non ho potuto abilitare il trim settimanale del disco."
    podman_import_broker_state "$podman_bin" \
      || { err "La macchina e' stata ricreata, ma lo stato del broker non ha superato la verifica/importazione."; exit 1; }
    require_confined_podman_machine
    podman_state_backup_cleanup
    trap - EXIT INT TERM
    info "Macchina Podman ricreata: vede solo ~/.jht e ~/Documents/Job Hunter Team. Lo stato del broker e' stato conservato; le CLI dei provider si reinstallano da sole al primo 'jht up' (circa un minuto, serve la rete: 'jht providers versions' lo conferma, 'jht providers update' le rimette a mano). Avvia il team con 'jht up', reinserisci la password della posta e rifai il login LinkedIn."
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
    broker_configure_web_authorisations
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
    broker_configure_web_authorisations
    ;;

  down|stop-container)
    require_compose_file
    require_docker
    container_down || exit 1
    ;;

  restart)
    require_compose_file
    require_docker
    container_up >/dev/null || {
      err "Container JHT non attestabile; riavvio negato."
      stale_config_hint
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
      stale_config_hint
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
    broker_configure_web_authorisations
    ;;

  upgrade)
    handle_runtime_upgrade "${@:2}"
    ;;

  clean-images)
    handle_clean_images "${@:2}"
    exit $?
    ;;

  mail)
    require_compose_file
    require_docker
    mail_command "${@:2}"
    exit $?
    ;;

  apply)
    require_compose_file
    require_docker
    ensure_up
    if [ "${2:-}" = relink-account ]; then
      if [ $# -ne 2 ]; then
        err "uso: jht apply relink-account"
        exit 2
      fi
      broker_relink_web_account
      exit $?
    fi
    case "${2:-}" in
      request|cancel) apply_host_command "$2" "${3:-}"; exit $? ;;
    esac
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
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

  migrate-runtime)
    require_compose_file
    if [ "${2:-}" != podman ] || [ $# -ne 2 ]; then
      err "uso: jht migrate-runtime podman"
      exit 2
    fi
    migrate_runtime_podman
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
    why_file="$(mktemp "${TMPDIR:-/tmp}/jht-why.XXXXXX" 2>/dev/null)" || why_file=""
    JHT_ATTEST_WHY_FILE="$why_file"
    if container_id="$(read_only_container_id)"; then
      JHT_ATTEST_WHY_FILE=""
      [ -z "$why_file" ] || rm -f -- "$why_file"
      docker inspect "$container_id" --format \
        'name={{.Name}} status={{.State.Status}} started={{.State.StartedAt}} image={{.Config.Image}}'
    else
      attest_status=$?
      JHT_ATTEST_WHY_FILE=""
      # 3 = the project has no such container; anything else = a container is there and cannot be attested.
      # Saying «non attivo» for the second hid a team that was running (TEST 19g).
      if [ "$attest_status" -eq 3 ]; then
        printf "container '%s' non attivo\n" "$CONTAINER_SERVICE"
      else
        printf "container '%s' non attestabile: c'e' qualcosa che non si riesce a verificare (una configurazione diversa dall'attesa, o il motore che non risponde); non vuol dire che non giri.\n" "$CONTAINER_SERVICE"
        if [ "$CONTAINER_RUNTIME" = podman ] && podman_caller_env_set; then
          printf "  Nell'ambiente di questo terminale sono impostate: %s. Il container e' stato creato senza: togli la variabile (unset) e riprova.\n" "$(podman_caller_env_names)"
        fi
        if [ -n "$why_file" ] && [ -s "$why_file" ]; then
          printf "  Il provider ha detto: %s\n" "$(head -n 1 "$why_file")"
        fi
      fi
      [ -z "$why_file" ] || rm -f -- "$why_file"
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
      claude|anthropic)
        docker exec $EXEC_FLAGS "$ATTESTED_CONTAINER_ID" claude --dangerously-skip-permissions
        ;;
      '')
        # Nessun provider scelto: nessuna CLI "di default", si sceglie prima.
        err "nessun provider attivo: scegline uno con 'jht providers use openai'"
        exit 1
        ;;
      *)
        err "provider attivo non riconosciuto: $provider"
        exit 1
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
    jht_load_host_values
    jht_record_host_values
    ensure_up
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
    rc=$?
    if [ "${1:-}" = cloud ] && [ "${2:-}" = pair ] && [ "$rc" -eq 0 ]; then broker_configure_web_authorisations; fi
    exit "$rc"
    ;;

  # Download verificato dal CLI nel container, pubblicato atomically sul path
  # host quando l'utente passa --output.
  download)
    require_compose_file
    require_docker
    ensure_up
    handle_host_download "$ATTESTED_CONTAINER_ID" "${@:2}"
    ;;

  profile)
    require_compose_file
    require_docker
    ensure_up
    if [ "${2:-}" = import ]; then
      case " ${*:3} " in
        *" --help "*|*" -h "*) ;;   # l'aiuto e' del CLI nel container
        *) profile_import_command "${@:3}"; exit $? ;;
      esac
    fi
    if [ "${2:-}" = validate ] && profile_validate_has_file "${@:3}"; then
      profile_validate_command "${@:3}"; exit $?
    fi
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
    ;;

  # `jht providers plan` senza id LEGGE il piano dichiarato: non accende niente. Con il
  # container spento (o la machine, o Docker) lo dice e basta, come `status`; il CLI che
  # legge il piano sta nel container e l'host non ha il registro dei piani. Dichiarare un
  # piano (`jht providers plan <id>`) e gli altri `jht providers ...` scrivono o usano la
  # rete: vanno avanti come il catch-all, che avvia il container.
  providers)
    if [ "${2:-}" = plan ] && [ "$#" -eq 2 ]; then
      require_confined_podman_machine
      if docker_reachable && container_up; then
        docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
        exit $?
      fi
      err "container '$CONTAINER_SERVICE' non attivo: leggere il piano non lo accende. Avvialo con 'jht up' e riprova."
      exit 1
    fi
    require_compose_file
    require_docker
    ensure_up
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
    ;;

  # `jht team stop`: si deve poter fermare anche un container che non si attesta per la sola hash (vedi ensure_up_for_stop).
  team)
    require_compose_file
    require_docker
    if [ "${2:-}" = stop ]; then ensure_up_for_stop; else ensure_up; fi
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
    ;;

  # ── Operativita': delegata al CLI Node nel container ───────────────────
  *)
    require_compose_file
    require_docker
    ensure_up
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
    ;;
esac

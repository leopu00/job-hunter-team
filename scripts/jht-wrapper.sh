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
# And the chat with a numbered role by instance (`analista-2`, the session ANALISTA-2): the app asks for this marker
# before it names an instance after the first, so a wrapper without it is told apart by name too.
JHT_DESKTOP_CHAT_INSTANCES=1
JHT_ONBOARDING_SNAPSHOT_PROTOCOL=1
# Il pannello agenti del desktop chiama `agent-control` solo se trova questa
# riga: un wrapper che non la ha passerebbe il comando al ramo generico, che
# avvia il container.
JHT_AGENT_CONTROL_PROTOCOL=1
# L'app del desktop registra nel broker l'autorizzazione a una candidatura con `desktop-apply record` solo se
# trova questa riga: un wrapper che non la ha passerebbe il comando al ramo generico, che avvia il container.
JHT_DESKTOP_APPLY_PROTOCOL=1
# `jht integration list|status|add|remove --json` (the integrations added after the setup). The app asks for this line before it calls them.
JHT_INTEGRATION_PROTOCOL=1

# Sistema e utente non cambiano durante una run: si leggono una volta sola. I
# controlli d'integrita' del runtime (runtime_stat, runtime_node_safe) li
# chiedevano per ogni file: un `uname` e un `id` a ogni stat, centinaia di
# processi in un solo `jht upgrade`.
HOST_KERNEL="$(uname -s)"
HOST_UID="$(id -u)"

CONTAINER_SERVICE="jht"
# Every service of the compose (tests/test_podman_screen_attestation.py holds it to docker-compose.yml). podman-compose's `ps`
# lists every container of the project, and the attestation refuses the whole project when one has a service not named here:
# with only the agents and the two isolated services, the screen of `jht screen on` made every command «non attestabile».
COMPOSE_SERVICES="jht jht-broker jht-telegram jht-media jht-screen jht-login jht-login-proxy jht-login-view jht-playwright-populate"
# Every profile of the project: what looks at or takes down the WHOLE project names them all (the broker and Telegram are made on request).
COMPOSE_ALL_PROFILES="telegram,broker,media,playwright,screen,login"
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
COMPOSE_EXTRA_FILE=""  # never taken from the environment: only jht-integration.sh sets it, for one call, to the seccomp overlay of the sign-in
NODE_ENTRY="${JHT_NODE_ENTRY:-/app/cli/bin/jht.js}"
HOST_SETUP_SCRIPT="${JHT_HOST_SETUP_SCRIPT:-$RUNTIME_DIR/host-setup.sh}"
RUNTIME_MANIFEST="$RUNTIME_DIR/.runtime-integrity"
RUNTIME_MIGRATION_MARKER="$RUNTIME_DIR/.runtime-migrated-podman"
# Canale di test: install.sh --image fissa qui l'immagine verificata del suo
# commit (ref canonico per digest). Sta nel runtime host, fuori dai mount del
# container, ed e' coperto dal manifest: nessuna variabile d'ambiente serve
# ai `jht up` successivi. Assente = produzione (immagine del compose).
RUNTIME_IMAGE_PIN="$RUNTIME_DIR/runtime-image"
# Il canale di test fissa anche l'immagine degli strumenti su richiesta (schermo, media, playwright), che l'installer non scarica:
# `jht screen on` la scarica per questo digest. Sta in un file suo, attestato in un file suo (non nel manifest principale: l'app ne
# confronta l'insieme esatto delle chiavi).
RUNTIME_EXTRAS_PIN="$RUNTIME_DIR/runtime-extras-image"
RUNTIME_EXTRAS_INTEGRITY="$RUNTIME_DIR/.runtime-extras-integrity"
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
# The engine of THIS runtime is the one its attested bundle names (the container-runtime file). No environment variable the person
# can have left behind (an older terminal's, a program's) chooses it; only a test names another one, with its own variable.
if [ -n "${JHT_TEST_CONTAINER_RUNTIME:-}" ]; then
  CONTAINER_RUNTIME="$(printf '%s' "$JHT_TEST_CONTAINER_RUNTIME" | tr '[:upper:]' '[:lower:]')"
elif [ -f "$RUNTIME_SELECTION_FILE" ]; then
  CONTAINER_RUNTIME="$(tr -d '\r\n' < "$RUNTIME_SELECTION_FILE" | tr '[:upper:]' '[:lower:]')"
else
  CONTAINER_RUNTIME="docker"
fi
unset JHT_CONTAINER_RUNTIME
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
DEFAULT_RUNTIME_IMAGE="ghcr.io/leopu00/jht@sha256:c9e21cee9680771d893d55f47794ec7d2d77da7a339a3d44f3711dfbe5a1878a"
CORE_IMAGE_DIGEST="sha256:bf889fa9fc196fb109d0eeb6e03246d651fbd673c13c70514ef9d119d526000d"
EXTRAS_IMAGE_DIGEST="sha256:8c4bb2713c330c14957cfd77acd79813a77a2ddc63e8dfab040b8dd96198c9f6"
RUNTIME_TIER_FILE="$RUNTIME_DIR/runtime-tier"
RUNTIME_TIER_INTEGRITY="$RUNTIME_DIR/.runtime-tier-integrity"
DEFAULT_RUNTIME_VERSION="0.4.0"

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
  # Un link al posto di host.env lo puo' aver messo un agente: non si legge quello che indica (come in host-setup.sh).
  [ ! -L "$file" ] || return 1
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
      [ "$key" != JHT_LANG ] || JHT_LANG_FROM_FILE=1
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

# La lingua dei TESTI del wrapper (jht_say: uninstall, avvio del container...). `jht setup --language it` e il picker la salvano in
# i18n-prefs.json, accanto a host.env: e' la scelta della persona e passa avanti a quella di host-values (che resta com'era, en finche'
# nessun host-setup la cambia, ed e' quella che entra nell'hash del container: JHT_LANG non si tocca). Cascata dei lettori Node:
# i18n-prefs.json, poi JHT_LANG. Il file sta in una cartella che il container puo' scrivere: si legge come DATO (non e' un link, e'
# un file piccolo, il valore e' uno dei sette codici) e serve solo a scegliere il testo che si stampa. Stampa il codice.
jht_ui_language() {
  local prefs line value size
  prefs="$(dirname "$HOST_ENV_FILE")/i18n-prefs.json"
  if [ -f "$prefs" ] && [ ! -L "$prefs" ] && [ -r "$prefs" ]; then
    size="$(wc -c < "$prefs" 2>/dev/null)" || size=0
    if [ "$((size + 0))" -le 4096 ]; then
      line="$(tr -d '\r\n' < "$prefs" 2>/dev/null | sed -n 's/.*"locale"[[:space:]]*:[[:space:]]*"\([a-z][a-z]\)".*/\1/p' | head -n 1)"
      value="$line"
      if jht_host_env_value_valid JHT_LANG "$value"; then printf '%s' "$value"; return 0; fi
    fi
  fi
  # then the rule of the CLI: JHT_LANG as the person set it here, the one in host.env (the installer writes the person's), the
  # system's (the first of LC_ALL, LC_MESSAGES, LANG that is set decides; C, POSIX or a language we do not have read en), en
  if jht_host_env_value_valid JHT_LANG "${JHT_CALLER_LANG:-}"; then printf '%s' "$JHT_CALLER_LANG"; return 0; fi
  if [ "${JHT_LANG_FROM_FILE:-0}" = 1 ] && jht_host_env_value_valid JHT_LANG "${JHT_LANG:-}"; then printf '%s' "$JHT_LANG"; return 0; fi
  for line in "${LC_ALL:-}" "${LC_MESSAGES:-}" "${LANG:-}"; do
    [ -n "$line" ] || continue
    value="$(printf '%s' "${line%%[-_.@]*}" | tr '[:upper:]' '[:lower:]')"
    if jht_host_env_value_valid JHT_LANG "$value"; then printf '%s' "$value"; else printf 'en'; fi
    return 0
  done
  printf 'en'
}

JHT_CALLER_LANG="${JHT_LANG:-}"
jht_load_host_values
jht_record_host_values
JHT_SAY_LANG="$(jht_ui_language)"
# Export per docker compose: il compose file fa `${JHT_HOST_TYPE:-}` /
# `${JHT_LANG:-}` / `${JHT_USER_TZ:-}` substitution per passare i valori al
# container. Senza export restano variabili di shell e compose non le vede.
export JHT_HOST_TYPE
export JHT_LANG
export JHT_USER_TZ

# ── Testi nella lingua dell'utente ────────────────────────────────────────
# `jht_say CHIAVE [valori]` prints the text of the person's language (JHT_SAY_LANG, by the rule of the CLI) with its `%s`
# filled by the values. The texts of the 7 languages are a block made from shared/locales (keys wrapper.<CHIAVE>), written
# here as data: the wrapper runs on the host, where the catalogs are not, and reads no file the container can write.
# python3 tests/wrapper_texts.py --write makes it again; a test fails when it and the catalogs differ. A key with no text in
# a language is said in English. Only `%s`/`%d` in the texts, in the same order in every language (printf cannot reorder).
# >>> texts in the 7 languages, made from shared/locales by `python3 tests/wrapper_texts.py --write`: do not edit by hand
jht_text_en() {
  case "$1" in
    compose.missing) printf '%s' 'docker compose is missing: the engine answers, but the «docker compose» command does not exist (JHT needs the Compose v2 plugin). On a Mac: brew install docker-compose, then mkdir -p ~/.docker/cli-plugins && ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose. On Linux: install the docker-compose-v2 package (apt) or docker-compose-plugin (dnf). Then run the command again.' ;;
    config.changed_down) printf '%s' 'config_changed_while_running: the team was started with a configuration other than the current one (changed while JHT was running, or a reinstall); stopping it.' ;;
    config.changed_other) printf '%s' 'config_changed_while_running: the team runs with a configuration other than the expected one; it is used only to stop it.' ;;
    config.changed_start) printf '%s' 'config_changed_while_running: the configuration changed while JHT was running (jht config set, settings changed from the site or the app, or a reinstall), so the running team cannot be verified. Stop it with «jht down», then start it with «jht up».' ;;
    config.changed_stopped) printf '%s' 'config_changed_stopped: the team'\''s containers, stopped, are from the earlier version: recreating them with the new configuration (the volumes with the data stay).' ;;
    container.starting) printf '%s' 'Container '\''%s'\'' is not running, starting it...' ;;
    doctor.host_config_none) printf '%s' 'no configuration yet: '\''jht setup'\''' ;;
    doctor.host_config_ok) printf '%s' 'configuration present' ;;
    doctor.host_engine_fail) printf '%s' 'container engine not reachable' ;;
    doctor.host_engine_ok) printf '%s' 'container engine reachable' ;;
    doctor.host_more) printf '%s' 'For the full checks (configuration, provider, database, agents): '\''jht up'\'', then '\''jht doctor'\''.' ;;
    doctor.host_runtime_fail) printf '%s' 'JHT runtime missing or changed: '\''jht upgrade'\'' installs it again' ;;
    doctor.host_runtime_ok) printf '%s' 'JHT runtime intact' ;;
    doctor.host_team_off) printf '%s' 'team off: '\''jht up'\'' starts it' ;;
    doctor.host_team_unattestable) printf '%s' 'a container of the team is there but cannot be verified as ours: nothing was touched ('\''jht status'\'' says more)' ;;
    doctor.host_title) printf '%s' 'Job Hunter Team: the team is off (its container is not running). Checks made from this computer:' ;;
    down.done) printf '%s' 'Job Hunter Team stopped.' ;;
    down.still_running) printf '%s' 'The team did not stop: a container of the project was running again after two tries (it can restart by itself in its first minute). Run '\''jht down'\'' once more; if it stays, '\''jht doctor'\''.' ;;
    download.asset_failed) printf '%s' 'download failed: %s' ;;
    download.bad_version) printf '%s' 'invalid version: %s. Example: 0.3.5.' ;;
    download.copy_failed) printf '%s' 'copying the verified download to the destination failed' ;;
    download.deb_only_linux) printf '%s' '--deb is only for Linux.' ;;
    download.dest_appeared) printf '%s' 'the destination appeared during the download; it was not overwritten' ;;
    download.dest_is_link) printf '%s' 'the destination is a link: %s' ;;
    download.dest_not_file) printf '%s' 'the destination exists and is not a file: %s' ;;
    download.fetching) printf '%s' 'Downloading %s...' ;;
    download.hash_invalid) printf '%s' 'invalid SHA-256 for %s: expected %s, got %s.' ;;
    download.intel_mac) printf '%s' 'The 0.4 macOS app only runs on Macs with Apple silicon (M1 and later); this is an Intel Mac, which 0.4 does not support. Nothing was downloaded.' ;;
    download.linux_no_app) printf '%s' 'In this version there is no desktop app for Linux: use install.sh. Nothing was downloaded.' ;;
    download.mismatch_existing) printf '%s' 'the file %s exists but its SHA-256 does not match: it was not overwritten.' ;;
    download.mkdir_failed) printf '%s' 'cannot create the destination folder: %s' ;;
    download.no_curl) printf '%s' 'curl not found: it is needed to download the release.' ;;
    download.no_tmp) printf '%s' 'the temporary folder could not be created' ;;
    download.parent_unreachable) printf '%s' 'the destination folder cannot be reached: %s' ;;
    download.present_verified) printf '%s' 'File already present and verified: %s' ;;
    download.release_no_app) printf '%s' 'This release (v%s) has no app for macOS: use 0.4.0 or later. Nothing was downloaded.' ;;
    download.saved_in) printf '%s' 'Saved in: %s' ;;
    download.sha_verified) printf '%s' 'SHA-256 verified: %s' ;;
    download.shared_folder) printf '%s' 'the destination is inside a folder shared with the team (%s): choose one outside it, like ~/Downloads.' ;;
    download.sum_missing) printf '%s' 'no SHA-256 declared for %s.' ;;
    download.sums_failed) printf '%s' 'download failed: SHA256SUMS of v%s' ;;
    download.unsupported_os) printf '%s' 'unsupported system: %s. Use windows or macos.' ;;
    download.windows_missing) printf '%s' 'Windows is not part of 0.4.0: the release has no installer for Windows. Nothing was downloaded.' ;;
    help.download) printf '%s' 'usage: jht download --os windows|macos --version X.Y.Z [--output FILE]
  The desktop app is not part of 0.4.0: for a release that has it, downloads it, checks its SHA-256 and saves it (by default in ~/Downloads).' ;;
    help.integration) printf '%s' 'Usage: jht integration <command>

  list [--json]                   the integrations and their status
  status [ID] [--json]            the status of one, or of all
  add ID [--json]                 adds an integration
  remove ID [--purge --yes] [--remove-image] [--json]
                                  removes it; --purge also deletes its data (needs --yes);
                                  --remove-image (screen and media only) also removes the tools image

The allowed IDs are the ones `jht integration list` shows. Nothing is downloaded or turned on
until you ask for it with `add`.' ;;
    help.linkedin) printf '%s' 'Usage: jht linkedin <command>

  login [--stop]    the manual sign-in to LinkedIn (with Google): a browser in a separate container, with no network,
                    whose window you see and use from the app; --stop closes everything
  status --json     says whether the sign-in is in progress and whether the LinkedIn session is saved

Nothing is downloaded or turned on until you ask for it with `login`.' ;;
    help.main) printf '%s' 'jht — Job Hunter Team

  Host commands (they work from here):
    jht up                 starts the team'\''s container
    jht down               stops it
                           (with --verbose you also see the engine'\''s lines)
    jht restart            restarts it
    jht status             status of the container and the team
    jht logs [-f]          container log
    jht upgrade            updates to the latest image
    jht clean-images [--json]
                           removes old JHT images (keeps the current one, the
                           latest of the others and those in use); allowed
                           even when the disk is almost full
    jht setup              guided installation
    jht shell              shell inside the container
    jht profile import FILE [--replace]
                           gives the team the candidate'\''s profile (YAML)
    jht profile validate [FILE] [--strict] [--json]
                           checks a profile (YAML) without writing anything;
                           without FILE, the team'\''s one
    jht mail setup         saves the mailbox in the secrets broker
    jht mail drafts        emails written by the agents, waiting for your ok
    jht mail approve <id>  sends them; jht mail discard <id> discards them
    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]
                           the integrations you add after setup
                           (google, telegram, mail): status read from the engine
    jht telegram status    status of the isolated Telegram service
    jht telegram pair ROLE asks for the token without echo on the host computer, then
                           shows a code to send to the bot from your Telegram.
                           For automation: JSON on stdin. Do not save the token
                           in ~/.jht; delete right away any file used outside it.
    jht telegram pair --all pairs all the legacy roles in one session
    jht telegram chat-id ROLE moves the bot to another chat, with the same code
    jht reset              deletes the broker'\''s configuration and volumes
    jht migrate-runtime podman
                           copies and checks the Docker volumes into Podman;
                           it does not select the new runtime and does not delete Docker
    jht podman-machine-recreate --confirm
                           recreates the Podman machine (macOS) so that it sees
                           only ~/.jht and ~/Documents/Job Hunter Team
    jht uninstall --confirm removes the local runtime (Podman machine or
                           jht containers and volumes, with the saved secrets);
                           ~/.jht, Documents, Podman and Docker stay
    jht uninstall --confirm --purge
                           as above, and also deletes ~/.jht and
                           ~/Documents/Job Hunter Team (even if the container
                           owns them, without sudo and without changing permissions)

  All the other commands (positions, stats, team, providers, cron,
  working-hours, cloud...) run INSIDE the container: for their help
  the container must be running.

      jht up && jht --help
' ;;
    help.screen) printf '%s' 'Usage: jht screen <command>

  on [--json]       turns on the closer'\''s live screen: a separate container, with the stream only on 127.0.0.1
  off [--remove-image] [--json]
                    turns it off and removes the container; the tools image stays on disk, to turn it on again
                    without downloading it again: --remove-image removes it and frees the space
  status [--json]   says whether it is on

Nothing is downloaded or turned on until you ask for it with `on`. The stream is view-only.' ;;
    help.setup) printf '%s' 'Usage: jht setup [options]

Without options the guided installation starts. With --non-interactive it asks nothing:
you give everything with the options.

  --non-interactive            no questions
  --provider <name>            glm (Z.ai, default), kimi (Moonshot), openai or claude (Anthropic)
  --harness <name>             pi (default)
  --api-key-file <path>        file that contains the API key (one line, readable only by you).
                               jht reads a file of your computer and passes it to setup: with glm and kimi
                               setup keeps the key on its own, never in the configuration
  --api-key-stdin              reads the API key from standard input (one line): never on the command line
  --api-key <key>              the key written here, in clear text (not allowed for glm and kimi)
  --secret-mode <mode>         how the key is saved: plaintext (default), env or file
  --secret-env <name>          with --secret-mode env: the environment variable that contains it
  --secret-file <path>         with --secret-mode file: the file that contains it
  --model <model>              the model to use
  --language <code>            the language (for example it or en)
  --budget-usd <dollars>       the most the team may spend, in dollars (with one of --budget-minutes, --budget-days, --budget-until)
  --budget-minutes <n>         the budget lasts this many minutes from now
  --budget-days <n>            the budget lasts this many days from now
  --budget-until <hour>        the budget lasts until this hour of the day, 0-23 (the next one)
  --no-budget                  no spending limit (the team stops only at the credit of the provider)
  --skip-health                skips the final check
  --reset                      starts again from a clean configuration

Examples:
  with a GLM key in a file:
    jht setup --non-interactive --provider glm --harness pi --api-key-file key.txt
  OpenAI with an API key, on Pi (for Claude: --provider claude):
    jht setup --non-interactive --provider openai --harness pi --api-key-stdin' ;;
    help.tools) printf '%s' 'Usage: jht tools <command>

  status --json   whether the Scouts'\'' tools (the full image) are here, on their way or failed
  pull            downloads them in the background (jht up and jht setup start it by themselves)
  switch          moves the team onto them once the onboarding is closed (the download does it by itself)

This help starts nothing and downloads nothing.' ;;
    host_setup.skip_done) printf '%s' 'host.env is in a folder owned by the container (uid 1001): the host preflight is already done, skipping it.' ;;
    host_setup.skip_unknown) printf '%s' 'host.env is in a folder owned by the container (uid 1001) and this user cannot write to it: skipping the host preflight, but host.env cannot be read or does not say the host type (local or VPS): the type stays '\''unknown'\''.' ;;
    keyfile.both) printf '%s' 'use --api-key-file or --api-key-stdin, not both' ;;
    keyfile.not_file) printf '%s' 'the file given to --api-key-file must be a regular file, not a folder or a link: %s' ;;
    keyfile.readable) printf '%s' 'the file %s can be read by other users: chmod 600 it.' ;;
    keyfile.shape) printf '%s' 'the content of the file given to --api-key-file is not one line of 16 to 512 printable characters without spaces: %s' ;;
    keyfile.size) printf '%s' 'the file given to --api-key-file is empty or too big for a key (1 to 4096 bytes): %s' ;;
    keyfile.twice) printf '%s' '--api-key-file was given twice' ;;
    keyfile.unreadable) printf '%s' 'the file given to --api-key-file cannot be read: %s' ;;
    line.abbinamento_annullato_nessuna_modifica) printf '%s' 'Pairing cancelled: nothing changed.' ;;
    line.abbinamento_di_s_non_riuscito) printf '%s' 'Pairing of %s failed: all the legacy copies stay. Run jht telegram pair --all again: the roles already paired do not ask for another token.' ;;
    line.abbinamento_rifiutato_genera_un_token) printf '%s' 'Pairing refused: generate a new token in BotFather (/revoke) and try again.' ;;
    line.accedi_con_l_utente_jht) printf '%s' 'Log in with the rootless JHT user set up by the install and try again.' ;;
    line.agent_restart_failed.inventario_conservato_ma_il_team) printf '%s' 'inventory kept, but the team did not restart. What to do: jht up' ;;
    line.allineo_owner_di_s_a) printf '%s' 'Setting the owner of %s to %s (it was uid %s)...' ;;
    line.annullato_niente_autorizzato) printf '%s' 'Cancelled: nothing authorized.' ;;
    line.anteprima_non_valida_niente_autorizzato) printf '%s' 'Invalid preview: nothing authorized.' ;;
    line.apply.authorize) printf '%s' 'Do you authorize this application?' ;;
    line.apply_relink_account_cloud_account) printf '%s' 'apply relink-account: cloud account not available. Run jht cloud pair first.' ;;
    line.attenzione_le_cli_interne_verranno) printf '%s' 'WARNING: the internal CLIs will be reinstalled and the secrets will not be kept. The configuration and the mail state stay, but you will have to enter the mail password again and log in to LinkedIn again.' ;;
    line.autorizzata_s_verso_s_il) printf '%s' 'Authorized #%s, to %s: the CLOSER will pick it up on its next round.' ;;
    line.bind_uid_conflict.uid_s_on_this_computer) printf '%s' 'uid %s on this computer is the account '\''%s'\''. The Job Hunter Team container runs as uid %s, so that account would own ~/.jht (your data and the portal credentials). Nothing was changed. Run JHT from the account '\''%s'\'', or give '\''%s'\'' another uid, then try again.' ;;
    line.bot_abbinato_e_copia_legacy) printf '%s' 'Bot paired and legacy copy removed. Other legacy tokens, or a token in the container environment, are still there: remove them and finish the rotation before the cutover.' ;;
    line.bot_token_invalid.controlla_il_token_generato_da) printf '%s' 'check the token BotFather generated.' ;;
    line.broker_restart_failed.il_servizio_della_posta_non_4) printf '%s' 'the mail service did not restart. What to do: jht mail status' ;;
    line.broker_start_failed.il_servizio_della_posta_non_2) printf '%s' 'the mail service did not start.' ;;
    line.broker_start_failed.il_servizio_della_posta_non_3) printf '%s' 'the mail service does not answer after 30 seconds.' ;;
    line.broker_unavailable.il_broker_dei_segreti_esiste) printf '%s' 'the secrets broker exists but cannot be verified as ours: not touching it.' ;;
    line.broker_unavailable.il_broker_dei_segreti_non) printf '%s' 'the secrets broker is not running or cannot be verified.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato) printf '%s' 'the compose file of the installed runtime cannot be read, so it is not known whether it has the secrets broker.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato_2) printf '%s' 'the compose file of the installed runtime cannot be read, so it is not known whether it has the secrets broker.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio) printf '%s' 'the installed runtime is older and has no secrets broker.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio_2) printf '%s' 'the installed runtime is older and has no secrets broker.' ;;
    line.broker_unavailable.il_servizio_della_posta_non) printf '%s' 'the mail service is not there yet: it is created the first time it is needed.' ;;
    line.cancellato_marcatore_migrazione_broker_s) printf '%s' 'Deleted: broker migration marker %s' ;;
    line.cancellato_volume_broker_s_s) printf '%s' 'Deleted: broker volume %s (%s)' ;;
    line.chown_fallito_su_s) printf '%s' 'chown failed on %s' ;;
    line.client_container_non_trovato_nel) printf '%s' 'container client not found in PATH. Repair the JHT runtime.' ;;
    line.client_container_non_trovato_nel_2) printf '%s' 'container client not found in PATH. Repair the JHT runtime.' ;;
    line.compose_extra_file_non_e) printf '%s' 'COMPOSE_EXTRA_FILE is not the seccomp overlay for the login: doing nothing.' ;;
    line.compose_up_failed.podman_compose_up_e_uscito) printf '%s' 'podman-compose up exited with %s. The Podman error is above.' ;;
    line.compose_up_timeout.podman_compose_up_non_ha) printf '%s' 'podman-compose up did not finish in %ss and was stopped. A service did not start: look at «podman ps -a» and «podman logs jht».' ;;
    line.container_jht_non_verificabile_dopo) printf '%s' 'The JHT container cannot be verified after the operation.' ;;
    line.container_s_non_attivo_leggere) printf '%s' 'container '\''%s'\'' is not running: reading the plan does not start it. Start it with '\''jht up'\'' and try again.' ;;
    line.container_s_non_e_partito) printf '%s' 'Container '\''%s'\'' did not start within 10s. Check '\''jht logs'\''.' ;;
    line.cosa_fare_jht_mail_setup) printf '%s' 'What to do: jht mail setup' ;;
    line.cosa_fare_jht_up) printf '%s' 'What to do: jht up' ;;
    line.cosa_fare_jht_up_2) printf '%s' 'What to do: jht up' ;;
    line.cosa_fare_jht_up_3) printf '%s' 'What to do: jht up' ;;
    line.cosa_fare_jht_upgrade) printf '%s' 'What to do: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_2) printf '%s' 'What to do: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_3) printf '%s' 'What to do: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_4) printf '%s' 'What to do: jht upgrade' ;;
    line.cosa_fare_reinstalla_il_runtime) printf '%s' 'What to do: reinstall the runtime with the installer' ;;
    line.cosa_fare_reinstalla_il_runtime_2) printf '%s' 'What to do: reinstall the runtime with the installer' ;;
    line.cosa_fare_reinstalla_il_runtime_3) printf '%s' 'What to do: reinstall the runtime with the installer' ;;
    line.cosa_fare_reinstalla_il_runtime_4) printf '%s' 'What to do: reinstall the runtime with the installer' ;;
    line.cosa_fare_riprova_il_comando) printf '%s' 'What to do: try the command again' ;;
    line.cosa_fare_riprova_il_comando_2) printf '%s' 'What to do: try the command again' ;;
    line.data_dir_moved.jht_home_host_s_non) printf '%s' 'JHT_HOME_HOST=%s is not %s. The team always uses %s: the compose file mounts it, the app reads it, and on macOS it is the only data folder the Podman machine sees. Remove JHT_HOME_HOST, or move the data to %s.' ;;
    line.data_dir_moved.jht_user_dir_host_s) printf '%s' 'JHT_USER_DIR_HOST=%s is not %s. The team always uses %s: the compose file mounts it, and on macOS it is the only documents folder the Podman machine sees. Remove JHT_USER_DIR_HOST, or move the documents to %s.' ;;
    line.disk_low.gli_agenti_richiedono_almeno_disk) printf '%s' 'The agents need at least %s GiB of disk — available: %s GiB. To free space run '\''jht clean-images'\'' (it removes only the old versions of Job Hunter Team), empty the Trash and delete large files you do not need, then try again: nothing was downloaded or changed.' ;;
    line.docker_punta_a_s_che) printf '%s' 'Docker points to %s, which is not this computer: the jht containers and volumes there are not touched. Point Docker back to the local one (DOCKER_HOST or docker context) and run again.' ;;
    line.fermo_e_ricreo_la_macchina) printf '%s' 'Stopping and recreating the Podman machine '\''%s'\''...' ;;
    line.fino_ad_allora_la_posta) printf '%s' 'Until then mail is read and sent with today'\''s password; the warning stays in jht mail status.' ;;
    line.genera_una_nuova_password_per) printf '%s' 'generate a new app password from your provider and save it with: jht mail setup' ;;
    line.host_setup_sh_non_trovato) printf '%s' 'host-setup.sh not found in %s — skipping the host preflight' ;;
    line.host_setup_sh_terminato_con) printf '%s' 'host-setup.sh ended with an error — going on' ;;
    line.i_segreti_e_lo_stato) printf '%s' 'The secrets and the broker state were deleted: log in to the portals again and set up mail again.' ;;
    line.identita_progetto_compose_non_valida) printf '%s' 'Invalid Compose project identity.' ;;
    line.il_broker_non_ha_registrato) printf '%s' 'The broker did not record the authorization: withdrawn, nothing will be sent.' ;;
    line.il_compose_non_indica_una) printf '%s' 'The compose file does not name one shared image for team and broker; keeping the state refused.' ;;
    line.il_container_s_non_c) printf '%s' 'the container '\''%s'\'' is not there, but other services of the project are running: stopping them.' ;;
    line.il_documento_deve_essere_un) printf '%s' 'the document must be a regular file, not a link: %s' ;;
    line.il_documento_supera_i_mb) printf '%s' 'the document is bigger than 10 MB' ;;
    line.il_file_del_profilo_supera) printf '%s' 'the profile file is bigger than 64 KiB' ;;
    line.il_motore_dei_container_non) printf '%s' 'The container engine is not running: nothing was removed.' ;;
    line.il_profilo_deve_essere_un) printf '%s' 'the profile must be a regular file, not a link: %s' ;;
    line.il_progetto_ha_container_che) printf '%s' 'The project has containers that are neither the team nor its verified services: not touching them.' ;;
    line.il_runtime_podman_rootless_locale) printf '%s' 'The local rootless Podman runtime does not answer.' ;;
    line.il_servizio_s_del_progetto) printf '%s' 'The project service '\''%s'\'' is running but cannot be verified as ours: not touching it and not stopping anything else.' ;;
    line.input_interrotto.token_non_letto) printf '%s' 'token not read.' ;;
    line.integration.install_hint) printf '%s' 'to install them: '\''jht upgrade'\'' (or a '\''jht integration add <id>'\'')' ;;
    line.integration.not_installed) printf '%s' 'not installed' ;;
    line.integration.not_installed_yet) printf '%s' 'not installed yet' ;;
    line.interattivo_il_token_viene_chiesto) printf '%s' 'Interactive: the token is asked without echo, then the new bot gets a one-time code from your Telegram. Automations: {"bot_token": ...} as JSON on stdin; do not save the token in ~/.jht, and delete right away any file used outside it.' ;;
    line.jht_home_host_o_jht) printf '%s' 'JHT_HOME_HOST or JHT_USER_DIR_HOST point elsewhere: not deleting folders that are not the fixed JHT ones.' ;;
    line.jht_telegram_pair_all_interattivo) printf '%s' 'jht telegram pair --all is interactive: for automations, pair one role at a time.' ;;
    line.job_hunter_team_non_ancora) printf '%s' 'Job Hunter Team is not started yet: run '\''jht up'\'' (the first time, '\''jht setup'\'').' ;;
    line.job_hunter_team_non_installato) printf '%s' 'Job Hunter Team is not fully installed: the integrity file is missing from the runtime folder (an interrupted install?). Run the installer again.' ;;
    line.l_overlay_seccomp_dell_accesso) printf '%s' 'The seccomp overlay for the login is not a regular file.' ;;
    line.la_casella_di_posta_ora) printf '%s' 'The mailbox is now in the secrets broker. Its password could be read by the agents:' ;;
    line.la_connessione_podman_jht_non) printf '%s' 'The JHT Podman connection does not support the Compose dispatcher.' ;;
    line.la_macchina_e_pronta_ma) printf '%s' 'The machine is ready, but the weekly disk trim could not be turned on.' ;;
    line.la_macchina_e_stata_ricreata) printf '%s' 'The machine was recreated, but the broker state did not pass the check/import.' ;;
    line.la_macchina_podman_s_vede) printf '%s' 'The Podman machine '\''%s'\'' sees more Mac folders than JHT needs (~/.jht and ~/Documents/Job Hunter Team).' ;;
    line.la_nuova_macchina_podman_s) printf '%s' 'The new Podman machine '\''%s'\'' was not created.' ;;
    line.legacy_cleanup_failed.i_token_nuovi_sono_al) printf '%s' 'the new tokens are safe, but the legacy copy of %s is still in ~/.jht; cutover refused.' ;;
    line.legacy_cleanup_failed.il_nuovo_token_al_sicuro) printf '%s' 'the new token is safe, but the old token is still in ~/.jht; cutover refused.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch) printf '%s' 'the team stays stopped because the host Telegram inventory was not kept.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_2) printf '%s' 'the team stays stopped because the host Telegram inventory was not kept.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_3) printf '%s' 'the team stays stopped because the host Telegram inventory was not kept.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_4) printf '%s' 'the team stays stopped because the host Telegram inventory was not kept.' ;;
    line.legacy_inventory_failed.le_impronte_non_sono_state) printf '%s' 'the fingerprints were not kept by the isolated service.' ;;
    line.legacy_inventory_failed.lo_stato_del_container_agenti) printf '%s' 'the state of the agents container cannot be verified.' ;;
    line.legacy_inventory_failed.migrazione_telegram_interrotta) printf '%s' 'Telegram migration stopped.' ;;
    line.legacy_inventory_failed.non_posso_provare_che_jht) printf '%s' 'cannot prove that ~/.jht has no Telegram tokens.' ;;
    line.legacy_inventory_failed.non_riesco_a_fermare_gli) printf '%s' 'cannot stop the agents before the host inventory.' ;;
    line.legacy_inventory_failed.non_riesco_a_leggere_i) printf '%s' 'cannot read the legacy tokens in ~/.jht.' ;;
    line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti) printf '%s' 'legacy roles not recognized.' ;;
    line.legacy_inventory_invalid.migrazione_telegram_interrotta_2) printf '%s' 'Telegram migration stopped.' ;;
    line.legacy_migration_failed.s_resta_in_jht_credentials) printf '%s' '%s stays in ~/.jht/credentials (broker answer: %s).' ;;
    line.legacy_remove_failed.s_nel_broker_ma_la) printf '%s' '%s is in the broker but the copy in ~/.jht/credentials is still there.' ;;
    line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso) printf '%s' '~/.jht/credentials/%s.json came back after the migration; removed without importing it.' ;;
    line.macchina_podman_ricreata_vede_solo) printf '%s' 'Podman machine recreated: it sees only ~/.jht and ~/Documents/Job Hunter Team. The broker state was kept; the provider CLIs reinstall by themselves at the first '\''jht up'\'' (about a minute, it needs the network: '\''jht providers versions'\'' confirms it, '\''jht providers update'\'' puts them back by hand). Start the team with '\''jht up'\'', enter the mail password again and log in to LinkedIn again.' ;;
    line.mail.address_prompt) printf '%s' 'Mailbox address:' ;;
    line.mail.app_password_prompt) printf '%s' 'App password (it is not shown):' ;;
    line.mail.dedicated_prompt) printf '%s' 'Is it a mailbox DEDICATED to forwarded job alerts?' ;;
    line.mail_setup_opzione_sconosciuta_s) printf '%s' 'mail setup: unknown option %s' ;;
    line.mail_setup_password_vuota) printf '%s' 'mail setup: empty password' ;;
    line.migrazione_docker_podman_gia_verificata) printf '%s' 'Docker -> Podman migration already verified; the Docker volumes stay intact and still hold the mail passwords, the portal logins and the Telegram tokens.' ;;
    line.migrazione_docker_podman_verificata_i) printf '%s' 'Docker -> Podman migration verified. The Docker volumes were not removed and still hold the mail passwords, the portal logins and the Telegram tokens: delete them only with an explicit confirmation in the future cleanup command.' ;;
    line.mount_repair_failed.s_non_si_puo_rendere) printf '%s' '%s cannot be made writable for the container (it runs as uid %s) and nothing was started. Run once: sudo chown -R %s %s and run '\''jht up'\'' again.' ;;
    line.nessun_provider_attivo_scegline_uno) printf '%s' 'no active provider: choose one with '\''jht providers use glm'\''' ;;
    line.nessun_ruolo_ha_un_token) printf '%s' 'No role has a legacy token: for a new bot use jht telegram pair <role>.' ;;
    line.niente_da_fermare_nessun_container) printf '%s' 'nothing to stop: no container of the project.' ;;
    line.no_answer) printf '%s' 'no answer' ;;
    line.no_answer_from_container) printf '%s' 'no answer from the container' ;;
    line.non_autorizzabile_s) printf '%s' 'Cannot be authorized: %s.' ;;
    line.non_autorizzata_s) printf '%s' 'Not authorized: %s.' ;;
    line.non_ho_potuto_rimettere_s) printf '%s' 'Could not set '\''%s'\'' back as the default Podman connection.' ;;
    line.non_ho_potuto_rimuovere_il) printf '%s' 'Could not remove the broker migration marker: %s' ;;
    line.non_riesco_a_creare_jht) printf '%s' 'Cannot create ~/.jht or ~/Documents/Job Hunter Team for the Podman machine.' ;;
    line.non_riesco_a_creare_jht_2) printf '%s' 'Cannot create ~/.jht or ~/Documents/Job Hunter Team for the Podman machine.' ;;
    line.non_riesco_a_determinare_l) printf '%s' 'Cannot find the verified broker image: the runtime compose did not answer.' ;;
    line.non_riesco_a_esportare_in) printf '%s' 'Cannot export the broker state in a verifiable way; the machine was not deleted.' ;;
    line.non_riesco_a_fermare_i) printf '%s' 'Cannot stop the services before saving the broker state.' ;;
    line.non_riesco_a_leggere_il) printf '%s' 'cannot read the document: %s' ;;
    line.non_riesco_a_rimuovere_i) printf '%s' 'Cannot remove the stopped containers of the earlier version: «jht down», then «jht up».' ;;
    line.non_riesco_a_rimuovere_la) printf '%s' 'Cannot remove the Podman machine '\''%s'\''.' ;;
    line.non_riesco_a_sapere_a) printf '%s' 'Cannot tell which Docker this computer talks to: the jht containers and volumes are not touched.' ;;
    line.non_riesco_a_verificare_quali) printf '%s' 'Cannot check which Mac folders the Podman machine '\''%s'\'' sees.' ;;
    line.non_sono_riuscito_a_cancellare) printf '%s' 'Could not delete %s (it belongs to another user, for example the container one, and the service container is not available).' ;;
    line.opzione_di_clean_images_non) printf '%s' 'Unsupported clean-images option: %s (usage: jht clean-images [--json])' ;;
    line.opzione_non_riconosciuta_s) printf '%s' 'unrecognized option: %s' ;;
    line.opzione_non_riconosciuta_s_2) printf '%s' 'unrecognized option: %s' ;;
    line.opzione_non_riconosciuta_s_3) printf '%s' 'unrecognized option: %s' ;;
    line.os_and_version_are_required) printf '%s' '--os and --version are required' ;;
    line.override_compose_per_podman_rootless) printf '%s' 'Compose override for rootless Podman cannot be written in %s.' ;;
    line.per_l_aiuto_di_s) printf '%s' 'The help for '\''%s'\'' needs the container running: '\''jht up'\''.' ;;
    line.per_procedere_jht_podman_machine) printf '%s' 'To go ahead: jht podman-machine-recreate --confirm' ;;
    line.pin_dell_immagine_degli_strumenti) printf '%s' 'the pin of the tools image cannot be trusted' ;;
    line.podman_compose_non_trovato_installa) printf '%s' 'podman-compose not found: install the «podman-compose» package (on Ubuntu: sudo apt install podman-compose).' ;;
    line.podman_machine_avviata_ma_il) printf '%s' 'The Podman machine started but the JHT client does not answer.' ;;
    line.podman_machine_jht_non_attiva) printf '%s' 'JHT Podman machine is not running. Run '\''jht up'\'' to start it.' ;;
    line.podman_machine_non_avviabile) printf '%s' 'The Podman machine cannot be started.' ;;
    line.podman_machine_s_non_attiva) printf '%s' 'Podman machine '\''%s'\'' is not running, starting it...' ;;
    line.podman_non_trovato_reinstalla_il) printf '%s' 'Podman not found: reinstall the JHT runtime.' ;;
    line.podman_non_trovato_reinstalla_il_2) printf '%s' 'Podman not found: reinstall the JHT runtime.' ;;
    line.podman_non_trovato_reinstalla_il_3) printf '%s' 'Podman not found: reinstall the JHT runtime.' ;;
    line.podman_other_machine_running.named) printf '%s' 'another Podman machine, %s, is running: stop it with '\''podman machine stop %s'\'' and try again.' ;;
    line.podman_other_machine_running.unnamed) printf '%s' 'another Podman machine is running: find it with '\''podman machine list'\'', stop it with '\''podman machine stop <name>'\'' and try again.' ;;
    line.podman_remote_service_refused.su_linux_jht_usa_solo) printf '%s' 'on Linux JHT uses only the local Podman of this user, but the podman client talks to a remote service.' ;;
    line.podman_rootful_refused.jht_su_linux_richiede_podman) printf '%s' 'JHT on Linux needs rootless Podman, run by a user that is not root.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non) printf '%s' 'the rootless Podman runtime does not answer.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non_2) printf '%s' 'the rootless Podman runtime does not answer.' ;;
    line.preparo_il_servizio_della_posta) printf '%s' 'Preparing the mail service (it is created only the first time it is needed)…' ;;
    line.provider_attivo_non_riconosciuto_s) printf '%s' 'active provider not recognized: %s' ;;
    line.provider_podman_compose_non_trovato) printf '%s' 'Podman Compose provider not found: reinstall the JHT runtime.' ;;
    line.questo_runtime_non_usa_una) printf '%s' 'This runtime does not use a Podman machine: there is nothing to recreate.' ;;
    line.reset_impossibile_cancellare_il_marcatore) printf '%s' 'reset: cannot delete the broker migration marker %s.' ;;
    line.reset_impossibile_cancellare_il_marcatore_2) printf '%s' 'reset: cannot delete the broker marker %s.' ;;
    line.reset_impossibile_cancellare_il_volume) printf '%s' 'reset: cannot delete the broker volume %s (%s).' ;;
    line.reset_nome_volume_non_valido) printf '%s' 'reset: invalid volume name for %s; removal refused.' ;;
    line.reset_non_riesco_a_determinare) printf '%s' 'reset: cannot find the Compose project; the broker volumes were not touched.' ;;
    line.reset_non_riesco_a_fermare) printf '%s' 'reset: cannot stop the runtime; the broker volumes were not touched.' ;;
    line.reset_ricerca_del_volume_s) printf '%s' 'reset: search for the volume %s failed.' ;;
    line.reset_ricerca_del_volume_s_2) printf '%s' 'reset: search for the volume %s failed.' ;;
    line.restano_token_legacy_per_s) printf '%s' 'Legacy tokens are left for: %s. Until you pair these roles too, %s stays silent on Telegram: pair them all in this session (jht telegram pair --all).' ;;
    line.ricrea_la_macchina_podman_s) printf '%s' 'Recreate the Podman machine '\''%s'\'': it stops and deletes it, then recreates it seeing only ~/.jht and ~/Documents/Job Hunter Team.' ;;
    line.ricreala_con_jht_podman_machine) printf '%s' 'Recreate it with '\''jht podman-machine-recreate --confirm'\'': the files and the broker state stay, but the internal CLIs and the secrets are deleted.' ;;
    line.risposta_del_container_non_valida) printf '%s' 'Invalid answer from the container: authorization withdrawn, nothing will be sent.' ;;
    line.ritirata_s_non_verra_inviata) printf '%s' 'Withdrawn #%s: it will not be sent.' ;;
    line.ritiro_non_riuscito_s) printf '%s' 'Withdrawal failed: %s.' ;;
    line.runtime_host_non_attendibile_path) printf '%s' 'the host runtime cannot be trusted (path, owner, permissions or SHA-256)' ;;
    line.runtime_host_protetto_non_installabile) printf '%s' 'the protected host runtime cannot be installed; the legacy ~/.jht/runtime is not used' ;;
    line.runtime_migration_changed.checksum_diverso_per_s_dopo) printf '%s' 'different checksum for %s after the migration.' ;;
    line.runtime_migration_changed.s_non_corrisponde_piu_al) printf '%s' '%s no longer matches the verified marker.' ;;
    line.runtime_migration_checksum_mismatch.s_non_ha_superato_la) printf '%s' '%s did not pass the check.' ;;
    line.runtime_migration_docker_missing.il_client_docker_originale_non) printf '%s' 'the original Docker client is not available.' ;;
    line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata) printf '%s' 'the JHT image pinned by digest is needed.' ;;
    line.runtime_migration_image_missing.la_stessa_immagine_jht_deve) printf '%s' 'the same JHT image must exist in Docker and Podman.' ;;
    line.runtime_migration_interrupted.copia_incompleta_di_s_il) printf '%s' 'incomplete copy of %s; the Docker source is intact.' ;;
    line.runtime_migration_podman_missing.podman_non_e_disponibile) printf '%s' 'Podman is not available.' ;;
    line.runtime_migration_source_missing.s_manca_in_docker_ma) printf '%s' '%s is missing in Docker but exists in Podman; not overwriting it.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_docker) printf '%s' 'stop the Docker team first.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_podman) printf '%s' 'stop the Podman team first.' ;;
    line.runtime_o_container_jht_non) printf '%s' 'JHT runtime or container not available' ;;
    line.ruoli_da_abbinare_in_questa) printf '%s' 'Roles to pair in this session: %s' ;;
    line.s_e_un_collegamento_non) printf '%s' '%s is a link: not following it and not deleting it.' ;;
    line.s_ha_gi_un_bot) printf '%s' '%s already has a paired bot: removing only its legacy copy.' ;;
    line.s_needs_a_value) printf '%s' '%s needs a value' ;;
    line.s_non_e_una_cartella) printf '%s' '%s is not a folder: not deleting it.' ;;
    line.saltato_non_trovato_volume_broker) printf '%s' 'Skipped (not found): broker volume %s' ;;
    line.script_s_non_ancora_installato) printf '%s' 'script %s is not installed yet: run '\''jht upgrade'\'' (or a '\''jht integration add/remove'\'') and try again' ;;
    line.script_s_non_scaricabile_controlla) printf '%s' 'script %s cannot be downloaded: check the network or run '\''jht upgrade'\''' ;;
    line.serve_un_terminale_l_autorizzazione) printf '%s' 'A terminal is needed: the authorization is confirmed by hand.' ;;
    line.status.caller_env) printf '%s' 'In this terminal'\''s environment these are set: %s. The container was created without them: remove the variable (unset) and try again.' ;;
    line.status.provider_said) printf '%s' 'The provider said: %s' ;;
    line.status.unattestable) printf '%s' 'container '\''%s'\'' cannot be verified: there is something that cannot be checked (a configuration different from the expected one, or the engine not answering); it does not mean it is not running.' ;;
    line.sudo_chown_fallito_su_s) printf '%s' 'sudo chown failed on %s (you may need '\''sudo %s up'\'')' ;;
    line.telegram_isolato_attivo_il_bridge) printf '%s' 'Isolated Telegram is active; the agents can no longer turn the legacy bridge back on.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_3) printf '%s' 'the compose file of the installed runtime cannot be read, so it is not known whether it has the isolated Telegram service.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_4) printf '%s' 'the compose file of the installed runtime cannot be read, so it is not known whether it has the isolated Telegram service.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_3) printf '%s' 'the installed runtime is older and has no isolated Telegram service.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_4) printf '%s' 'the installed runtime is older and has no isolated Telegram service.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non) printf '%s' 'the isolated Telegram service is not running or cannot be verified.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non_2) printf '%s' 'the isolated Telegram service is not running or cannot be verified.' ;;
    line.the_setup_keeps_the_key) printf '%s' 'The setup keeps the key: you can delete the file on this computer now (%s).' ;;
    line.togli_remote_true_da_containers) printf '%s' 'Remove remote = true from containers.conf (or CONTAINERS_CONF) for this user and try again.' ;;
    line.unattestable.autostart) printf '%s' 'Existing JHT container cannot be verified as ours; automatic start refused.' ;;
    line.unattestable.existing) printf '%s' 'Existing JHT container cannot be verified as ours; operation stopped.' ;;
    line.unattestable.logs) printf '%s' 'JHT container cannot be verified as ours; reading the logs refused.' ;;
    line.unattestable.other) printf '%s' 'JHT container cannot be verified as ours; operation refused.' ;;
    line.unattestable.recreate) printf '%s' 'JHT container cannot be verified as ours; recreation refused.' ;;
    line.unattestable.restart) printf '%s' 'JHT container cannot be verified as ours; restart refused.' ;;
    line.unattestable.stop) printf '%s' 'JHT container cannot be verified as ours; stop refused.' ;;
    line.unknown_argument_s) printf '%s' 'unknown argument: %s' ;;
    line.upgrade.activate) printf '%s' 'Activating the new runtime...' ;;
    line.upgrade.broker_restart_failed) printf '%s' 'the secrets broker did not start again. What to do: jht up' ;;
    line.upgrade.check_available) printf '%s' 'Check: there is an update, %s (%s) -> %s. %s. To apply it: jht upgrade' ;;
    line.upgrade.check_none) printf '%s' 'Check: no update, %s (%s) is already the latest. %s.' ;;
    line.upgrade.check_only) printf '%s' 'Check: %s.' ;;
    line.upgrade.disk_room) printf '%s' 'The update downloads about %s GiB, and after the download the agents would have less than the %s GiB of disk they need: %s GiB are free now. Free at least %s GiB more (empty the Trash, delete large files you do not need), then try again: nothing was downloaded or changed (only the old versions of Job Hunter Team that nothing used were removed).' ;;
    line.upgrade.done) printf '%s' 'Update completed: %s (%s) -> %s (%s). %s' ;;
    line.upgrade.failed) printf '%s' 'Update not completed (%s): %s. %s' ;;
    line.upgrade.full_pull_failed) printf '%s' 'the new full image did not arrive, the old one stays. What to do: jht tools pull' ;;
    line.upgrade.helper_install_failed) printf '%s' 'the new host scripts are taken at the first request or with another '\''jht upgrade'\''' ;;
    line.upgrade.interrupted) printf '%s' 'Interrupted upgrade found: restoring the last verified version...' ;;
    line.upgrade.keep_old) printf '%s' 'Old JHT images: all kept (JHT_KEEP_OLD_IMAGES=1).' ;;
    line.upgrade.publish) printf '%s' 'Publishing the verified candidate configuration...' ;;
    line.upgrade.pull_full) printf '%s' 'Downloading the updated full image...' ;;
    line.upgrade.pull_latest) printf '%s' 'Downloading the latest image...' ;;
    line.upgrade.pull_runtime) printf '%s' 'Downloading the updated runtime...' ;;
    line.upgrade.restored) printf '%s' 'Previous runtime restored.' ;;
    line.upgrade.telegram_restart_failed) printf '%s' 'the isolated Telegram service did not start again. What to do: jht up' ;;
    line.upgrade.verify) printf '%s' 'Checking the updated runtime...' ;;
    line.uso_jht_apply_relink_account) printf '%s' 'usage: jht apply relink-account' ;;
    line.uso_jht_apply_request_cancel) printf '%s' 'usage: jht apply request|cancel <id>' ;;
    line.uso_jht_apply_request_cancel_2) printf '%s' 'usage: jht apply request|cancel <id>' ;;
    line.uso_jht_artifact_upload_file) printf '%s' 'usage: jht artifact upload FILE [--json]' ;;
    line.uso_jht_artifact_upload_file_2) printf '%s' 'usage: jht artifact upload FILE [--json]' ;;
    line.uso_jht_mail_setup_status) printf '%s' 'usage: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <indirizzo|@dominio>|drafts|approve <id>|discard <id>|journal|delete|migrate' ;;
    line.uso_jht_migrate_runtime_podman) printf '%s' 'usage: jht migrate-runtime podman' ;;
    line.uso_jht_profile_import_file) printf '%s' 'usage: jht profile import FILE [--replace] [--json]' ;;
    line.uso_jht_profile_import_file_2) printf '%s' 'usage: jht profile import FILE [--replace] [--json]' ;;
    line.uso_jht_profile_validate_file) printf '%s' 'usage: jht profile validate [FILE] [--strict] [--json]' ;;
    line.uso_jht_screen_on_off) printf '%s' 'usage: jht screen on | off | status [--json]' ;;
    line.uso_jht_telegram_chat_id) printf '%s' 'usage: jht telegram chat-id <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_pair_assistente) printf '%s' 'usage: jht telegram pair <assistente|capitano|mentor>|--all' ;;
    line.uso_jht_telegram_remove_assistente) printf '%s' 'usage: jht telegram remove <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_status_pair) printf '%s' 'usage: jht telegram status|pair <ruolo>|pair --all|chat-id <ruolo>|remove <ruolo>' ;;
    line.uso_jht_ticket_open_posizione) printf '%s' 'usage: jht ticket open POSIZIONE TESTO [--kind TIPO] [--attach FILE]' ;;
    line.uso_jht_ticket_open_posizione_2) printf '%s' 'usage: jht ticket open POSIZIONE TESTO [--kind TIPO] [--attach FILE]' ;;
    line.versione_dell_immagine_configurata_per) printf '%s' 'Configured image version. For the version of the running CLI: '\''jht up'\'', then '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_2) printf '%s' 'Configured image version. For the version of the running CLI: '\''jht up'\'', then '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_3) printf '%s' 'Configured image version. For the version of the running CLI: '\''jht up'\'', then '\''jht --version'\''.' ;;
    line.versione_di_podman_compose_non) printf '%s' 'The podman-compose version cannot be read.' ;;
    line.versione_non_supportata_servono_podman) printf '%s' 'Unsupported version: podman >= %s is needed (found: %s) and podman-compose >= %s (found: %s).' ;;
    line.versione_non_supportata_sul_mac) printf '%s' 'Unsupported version: on the Mac podman %s.%s or a later %s.x is needed (not 6.2 or later; found: %s) and podman-compose %s (found: %s). If you updated Homebrew past the %s series, update JHT (curl -fsSL https://jobhunterteam.ai/install.sh | bash).' ;;
    migrate.left) printf '%s' 'Not copied or not verified: the volume %s.' ;;
    monitor.window_failed) printf '%s' 'monitor_window_unavailable: cannot open a terminal window here. Run '\''jht monitor'\'' in the current terminal (or inside your tmux session).' ;;
    monitor.window_invalid) printf '%s' 'monitor_window_invalid: use '\''jht monitor --window'\'' without other options.' ;;
    removed.office) printf '%s' ''\''jht %s'\'' was removed in 0.4.0 with the Godot office: use the jht commands (jht help).' ;;
    status.container) printf '%s' 'Container' ;;
    status.image) printf '%s' 'Image' ;;
    status.next_other) printf '%s' 'Start the team with: jht up' ;;
    status.next_running) printf '%s' 'Who is working: jht agents' ;;
    status.no_options) printf '%s' ''\''jht status'\'' takes no options (%s): run it as '\''jht status'\''.' ;;
    status.not_running) printf '%s' 'The team'\''s container is not running.' ;;
    status.not_running_next) printf '%s' 'Start it with: jht up' ;;
    status.running) printf '%s' 'running since %s' ;;
    status.state) printf '%s' '%s since %s' ;;
    status.title) printf '%s' 'Status' ;;
    team.stopped) printf '%s' 'Job Hunter Team is stopped: '\''jht up'\'' starts it again.' ;;
    tools.arriving) printf '%s' 'The Scouts'\'' tools are on their way: the full image is downloading in the background (about 3 GB). The search for positions starts by itself once they are here; there is nothing to do.' ;;
    tools.chat_reconnecting) printf '%s' 'The team is moving onto the Scouts'\'' full tools, so the chat stops for a moment: it comes back by itself once the team is running again (a couple of minutes).' ;;
    tools.chat_resumed) printf '%s' 'The team has moved onto the full tools: let'\''s pick up again.' ;;
    tools.chat_switched) printf '%s' 'The team is moving onto the Scouts'\'' full tools, so this chat has closed. Open it again in a couple of minutes with jht team chat.' ;;
    tools.chat_update_closed) printf '%s' 'JHT is updating, so this chat has closed. Open it again in a couple of minutes with jht team chat.' ;;
    tools.chat_update_resumed) printf '%s' 'JHT is up to date: let'\''s pick up again.' ;;
    tools.chat_updating) printf '%s' 'JHT is updating, so the chat stops for a moment: it comes back by itself in a minute or two.' ;;
    tools.disk_low) printf '%s' 'The Scouts'\'' tools were not downloaded: they need about %s GiB free on the disk and there are %s GiB, so the team cannot search for positions yet. Free some space (empty the Trash, delete large files you do not need), then run jht up: the download starts again by itself.' ;;
    tools.engine_down) printf '%s' 'The state of the Scouts'\'' tools cannot be read: the container engine does not answer. Start it with jht up.' ;;
    tools.failed) printf '%s' 'The download of the Scouts'\'' tools failed, so the team cannot search for positions yet. Run jht tools pull to try again (jht up tries again too).' ;;
    tools.not_started) printf '%s' 'The download of the Scouts'\'' tools has not started, so the team cannot search for positions yet. Run jht tools pull to start it (jht up starts it too).' ;;
    tools.ready) printf '%s' 'The Scouts'\'' tools are here: the team searches with the full image.' ;;
    tools.switch_failed) printf '%s' 'The Scouts'\'' tools are here, but the team could not be restarted on them: run jht down, then jht up.' ;;
    tools.switch_wait) printf '%s' 'The team is moving onto the Scouts'\'' full tools: waiting for it to start again (a couple of minutes at most).' ;;
    tools.waiting) printf '%s' 'The Scouts'\'' tools are here: the team moves onto them by itself once the onboarding is closed.' ;;
    uninstall.bad_home) printf '%s' 'HOME is not valid: removal refused.' ;;
    uninstall.colima_busy) printf '%s' 'Colima is still running: the JHT installer started it, but other containers are running in it, so it is left on. To stop it: colima stop.' ;;
    uninstall.colima_running) printf '%s' 'Colima is still running: the JHT installer did not start it (it was already on, or it is not the standard one), so it is left on, and it may be yours. To stop it: colima stop.' ;;
    uninstall.colima_stop_failed) printf '%s' 'Colima could not be stopped. To stop it: colima stop.' ;;
    uninstall.colima_stopping) printf '%s' 'Stopping the Colima virtual machine, which the JHT installer started and where nothing else is running; your folders on the Mac stay.' ;;
    uninstall.compose_link_left) printf '%s' 'The link to the Docker Compose plugin that the JHT installer made could not be removed: %s. You can delete it.' ;;
    uninstall.compose_link_removed) printf '%s' 'Removed the link to the Docker Compose plugin that the JHT installer made: %s. The plugin that Homebrew installed stays (brew uninstall docker-compose removes it).' ;;
    uninstall.images_removed) printf '%s' 'Removed %s JHT images: the core and the full one, and the old ones.' ;;
    uninstall.left.commands) printf '%s' 'Not removed: the jht command or the PATH lines the installer added.' ;;
    uninstall.left.data) printf '%s' 'The JHT data listed above was not deleted. The jht command and the runtime are still there: run '\''jht uninstall --confirm --purge'\'' again once it is sorted out.' ;;
    uninstall.left.images) printf '%s' 'Not removed: some JHT images (the engine refused). Run '\''jht uninstall --confirm'\'' again once nothing else uses them.' ;;
    uninstall.left.machine) printf '%s' 'Not removed: the jht-podman Podman machine or JHT'\''s containers and volumes, with the saved secrets. Run '\''jht uninstall --confirm'\'' again when Podman or Docker answer.' ;;
    uninstall.left.runtime) printf '%s' 'Not removed: JHT'\''s host runtime.' ;;
    uninstall.loss) printf '%s' 'The saved mail password and Telegram tokens are deleted too; ~/.jht and Documents stay, and with them the saved LinkedIn session (secrets/linkedin-profile and .cache/linkedin): remove it with jht reset --scope creds.' ;;
    uninstall.loss_purge) printf '%s' 'The saved mail password and Telegram tokens are deleted too.' ;;
    uninstall.machine_kept) printf '%s' 'The Podman machine '\''%s'\'' was not created by the JHT installer (it was already there, or it is not the standard jht-podman one), so it is not removed: it may be yours. The JHT volumes and image inside it stay with it. To remove it: podman machine stop %s, then podman machine rm %s.' ;;
    uninstall.machine_removing) printf '%s' 'Removing the Podman machine '\''%s'\'', which the JHT installer created: everything inside it goes with it (the JHT volumes and image); your folders on the Mac stay.' ;;
    uninstall.phase.commands) printf '%s' 'Removing the jht command and the PATH lines the installer added...' ;;
    uninstall.phase.data) printf '%s' 'Deleting ~/.jht and the Documents folder (--purge)...' ;;
    uninstall.phase.images) printf '%s' 'Removing the JHT images (the core and the full one, and the old ones)...' ;;
    uninstall.phase.machine) printf '%s' 'Removing the Podman machine, or JHT'\''s containers and volumes...' ;;
    uninstall.phase.runtime) printf '%s' 'Removing the host runtime...' ;;
    uninstall.purge_loss) printf '%s' 'With --purge ~/.jht and ~/Documents/Job Hunter Team are deleted too: configuration, database, CVs and output. There is no way back.' ;;
    uninstall.runtime_choice_unreadable) printf '%s' 'The JHT runtime choice cannot be read: nothing was removed.' ;;
    uninstall.usage) printf '%s' 'usage: jht uninstall --confirm [--purge]' ;;
    uninstall.usage_stays) printf '%s' 'Podman, podman-compose, Docker, Colima and Homebrew stay too.' ;;
    uninstall.usage_what) printf '%s' 'Removes the local JHT runtime: the jht-podman Podman machine or JHT'\''s containers, volumes and images (the core and the full one, by the repository names ghcr.io/leopu00/jht, jht and localhost/jht), the host runtime and the jht command.' ;;
    up.docker_legacy) printf '%s' 'This computer runs JHT on Docker, and its engine does not answer. Since 0.4 JHT runs only on Podman. Your data stays: ~/.jht and ~/Documents/Job Hunter Team are folders of this computer. To move to Podman: jht uninstall --confirm (it keeps those two folders), run the installer again, then jht setup with your API key (the key, the mail password and the Telegram tokens stayed in Docker'\''s volumes: give them again). To go on with Docker for now, start its engine yourself and run jht up again.' ;;
    up.done) printf '%s' 'Job Hunter Team started.' ;;
    up.engine_lost) printf '%s' 'The Podman machine stopped while the team was starting (%s). Nothing of yours was lost: your data is in the volumes and in your folders. Run jht up again: it starts the machine and the team.' ;;
    up.storage_damaged) printf '%s' 'The team'\''s image was damaged on the Podman machine'\''s disk (the machine was stopped abruptly while it was writing it): I download it again and recreate the containers. Your data is in the volumes and in your folders, and it stays. It takes a few minutes.' ;;
    up.storage_repair_failed) printf '%s' 'The team'\''s image could not be repaired on the Podman machine. '\''jht uninstall --confirm'\'' and then the installer make a new machine (your ~/.jht and Documents folders stay).' ;;
    *) return 1 ;;
  esac
}
jht_text_it() {
  case "$1" in
    compose.missing) printf '%s' 'manca docker compose: il motore risponde, ma il comando «docker compose» non esiste (a JHT serve il plugin Compose v2). Su Mac: brew install docker-compose, poi mkdir -p ~/.docker/cli-plugins && ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose. Su Linux: installa il pacchetto docker-compose-v2 (apt) o docker-compose-plugin (dnf). Poi rilancia il comando.' ;;
    config.changed_down) printf '%s' 'config_changed_while_running: il team era stato avviato con una configurazione diversa da quella attuale (cambiata mentre JHT era acceso, o una reinstallazione); lo fermo.' ;;
    config.changed_other) printf '%s' 'config_changed_while_running: il team gira con una configurazione diversa da quella attesa; la uso solo per fermarlo.' ;;
    config.changed_start) printf '%s' 'config_changed_while_running: la configurazione e'\'' cambiata mentre JHT era acceso (jht config set, impostazioni cambiate dal sito o dall'\''app, o una reinstallazione): il team in corso non si puo'\'' verificare. Fermalo con «jht down», poi avvialo con «jht up».' ;;
    config.changed_stopped) printf '%s' 'config_changed_stopped: i container del team, fermi, sono della versione di prima: li ricreo con la configurazione nuova (i volumi con i dati restano).' ;;
    container.starting) printf '%s' 'Container '\''%s'\'' non attivo, lo avvio...' ;;
    doctor.host_config_none) printf '%s' 'ancora nessuna configurazione: '\''jht setup'\''' ;;
    doctor.host_config_ok) printf '%s' 'configurazione presente' ;;
    doctor.host_engine_fail) printf '%s' 'motore dei container non raggiungibile' ;;
    doctor.host_engine_ok) printf '%s' 'motore dei container raggiungibile' ;;
    doctor.host_more) printf '%s' 'Per i controlli completi (configurazione, provider, database, agenti): '\''jht up'\'', poi '\''jht doctor'\''.' ;;
    doctor.host_runtime_fail) printf '%s' 'runtime JHT mancante o cambiato: '\''jht upgrade'\'' lo reinstalla' ;;
    doctor.host_runtime_ok) printf '%s' 'runtime JHT integro' ;;
    doctor.host_team_off) printf '%s' 'squadra spenta: '\''jht up'\'' la accende' ;;
    doctor.host_team_unattestable) printf '%s' 'c'\''e'\'' un container della squadra ma non si puo'\'' verificare che sia nostro: non ho toccato niente ('\''jht status'\'' dice di piu'\'')' ;;
    doctor.host_title) printf '%s' 'Job Hunter Team: squadra spenta (il suo container non gira). Controlli fatti da questo computer:' ;;
    down.done) printf '%s' 'Job Hunter Team fermato.' ;;
    down.still_running) printf '%s' 'Il team non si e'\'' fermato: un container del progetto era di nuovo acceso dopo due tentativi (nel suo primo minuto puo'\'' ripartire da solo). Rilancia '\''jht down'\''; se resta, '\''jht doctor'\''.' ;;
    download.asset_failed) printf '%s' 'download non riuscito: %s' ;;
    download.bad_version) printf '%s' 'versione non valida: %s. Esempio: 0.3.5.' ;;
    download.copy_failed) printf '%s' 'copia del download verificato verso la destinazione non riuscita' ;;
    download.deb_only_linux) printf '%s' '--deb vale solo per Linux.' ;;
    download.dest_appeared) printf '%s' 'la destinazione e'\'' comparsa durante il download; non e'\'' stata sovrascritta' ;;
    download.dest_is_link) printf '%s' 'la destinazione e'\'' un link: %s' ;;
    download.dest_not_file) printf '%s' 'la destinazione esiste e non e'\'' un file: %s' ;;
    download.fetching) printf '%s' 'Scarico %s...' ;;
    download.hash_invalid) printf '%s' 'SHA-256 non valido per %s: atteso %s, ottenuto %s.' ;;
    download.intel_mac) printf '%s' 'L'\''app per macOS della 0.4 gira solo su Mac con Apple silicon (M1 e successivi); questo e'\'' un Mac Intel, non supportato nella 0.4. Non e'\'' stato scaricato niente.' ;;
    download.linux_no_app) printf '%s' 'In questa versione non c'\''e'\'' l'\''app desktop per Linux: usa install.sh. Non e'\'' stato scaricato niente.' ;;
    download.mismatch_existing) printf '%s' 'il file %s esiste ma il suo SHA-256 non corrisponde: non e'\'' stato sovrascritto.' ;;
    download.mkdir_failed) printf '%s' 'impossibile creare la directory di destinazione: %s' ;;
    download.no_curl) printf '%s' 'curl non trovato: serve per scaricare la release.' ;;
    download.no_tmp) printf '%s' 'cartella temporanea non creata' ;;
    download.parent_unreachable) printf '%s' 'directory di destinazione non raggiungibile: %s' ;;
    download.present_verified) printf '%s' 'File gia'\'' presente e verificato: %s' ;;
    download.release_no_app) printf '%s' 'Questa release (v%s) non ha l'\''app per macOS: usa la 0.4.0 o successive. Non e'\'' stato scaricato niente.' ;;
    download.saved_in) printf '%s' 'Salvato in: %s' ;;
    download.sha_verified) printf '%s' 'SHA-256 verificato: %s' ;;
    download.shared_folder) printf '%s' 'la destinazione sta in una cartella condivisa con il team (%s): scegline una fuori, come ~/Downloads.' ;;
    download.sum_missing) printf '%s' 'SHA-256 dichiarato non trovato per %s.' ;;
    download.sums_failed) printf '%s' 'download non riuscito: SHA256SUMS di v%s' ;;
    download.unsupported_os) printf '%s' 'sistema non supportato: %s. Usa windows o macos.' ;;
    download.windows_missing) printf '%s' 'Windows non fa parte della 0.4.0: la release non ha un installer per Windows. Non e'\'' stato scaricato niente.' ;;
    help.download) printf '%s' 'uso: jht download --os windows|macos --version X.Y.Z [--output FILE]
  L'\''app desktop non fa parte della 0.4.0: per una release che la contiene, la scarica, ne controlla lo SHA-256 e la salva (di norma in ~/Downloads).' ;;
    help.integration) printf '%s' 'Uso: jht integration <comando>

  list [--json]                   le integrazioni e il loro stato
  status [ID] [--json]            lo stato di una, o di tutte
  add ID [--json]                 aggiunge un'\''integrazione
  remove ID [--purge --yes] [--remove-image] [--json]
                                  la toglie; --purge cancella anche i suoi dati (serve --yes);
                                  --remove-image (solo screen e media) toglie anche l'\''immagine degli strumenti

Gli ID ammessi sono quelli che mostra `jht integration list`. Niente si scarica o si accende
finche'\'' non lo chiedi con `add`.' ;;
    help.linkedin) printf '%s' 'Uso: jht linkedin <comando>

  login [--stop]    l'\''accesso a mano a LinkedIn (con Google): un browser in un container a parte, senza rete, di cui vedi
                    e usi la finestra dall'\''app; --stop chiude tutto
  status --json     dice se l'\''accesso e'\'' in corso e se la sessione di LinkedIn e'\'' salvata

Niente si scarica o si accende finche'\'' non lo chiedi con `login`.' ;;
    help.main) printf '%s' 'jht — Job Hunter Team

  Comandi dell'\''host (funzionano da qui):
    jht up                 avvia il container del team
    jht down               lo ferma
                           (con --verbose si vedono anche le righe del motore)
    jht restart            lo riavvia
    jht status             stato di container e team
    jht logs [-f]          log del container
    jht upgrade            aggiorna all'\''immagine piu'\'' recente
    jht clean-images [--json]
                           toglie le immagini JHT vecchie (tiene la corrente, la
                           piu'\'' recente delle altre e quelle in uso); permesso
                           anche a disco quasi pieno
    jht setup              installazione guidata
    jht shell              shell dentro il container
    jht profile import FILE [--replace]
                           da'\'' alla squadra il profilo del candidato (YAML)
    jht profile validate [FILE] [--strict] [--json]
                           controlla un profilo (YAML) senza scrivere niente;
                           senza FILE, quello della squadra
    jht mail setup         salva la casella di posta nel broker dei segreti
    jht mail drafts        email scritte dagli agenti in attesa del tuo ok
    jht mail approve <id>  le manda; jht mail discard <id> le scarta
    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]
                           le integrazioni che si aggiungono dopo il setup
                           (google, telegram, mail): stato letto dal motore
    jht telegram status    stato del servizio Telegram isolato
    jht telegram pair ROLE chiede il token senza eco sul computer host, poi
                           mostra un codice da mandare al bot dal tuo Telegram
                           Per automazioni: JSON su stdin. Non salvare il token
                           in ~/.jht; cancella subito file usati fuori da lì.
    jht telegram pair --all abbina in una seduta tutti i ruoli legacy
    jht telegram chat-id ROLE sposta il bot su un'\''altra chat, con lo stesso codice
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
    jht uninstall --confirm --purge
                           come sopra, e cancella anche ~/.jht e
                           ~/Documents/Job Hunter Team (anche se le possiede
                           il container, senza sudo e senza cambiare permessi)

  Tutti gli altri comandi (positions, stats, team, providers, cron,
  working-hours, cloud...) girano DENTRO il container: per il loro aiuto
  serve il container attivo.

      jht up && jht --help
' ;;
    help.screen) printf '%s' 'Uso: jht screen <comando>

  on [--json]       accende lo schermo dal vivo del closer: un container a parte, con lo stream solo su 127.0.0.1
  off [--remove-image] [--json]
                    lo spegne e toglie il container; l'\''immagine degli strumenti resta sul disco, per riaccenderlo
                    senza riscaricarla: --remove-image la toglie e libera lo spazio
  status [--json]   dice se e'\'' acceso

Niente si scarica o si accende finche'\'' non lo chiedi con `on`. Lo stream e'\'' in sola visione.' ;;
    help.setup) printf '%s' 'Uso: jht setup [opzioni]

Senza opzioni parte l'\''installazione guidata. Con --non-interactive non chiede niente:
tutto si da'\'' con le opzioni.

  --non-interactive            nessuna domanda
  --provider <nome>            glm (Z.ai, predefinito), kimi (Moonshot), openai o claude (Anthropic)
  --harness <nome>             pi (predefinito)
  --api-key-file <percorso>    file che contiene la chiave API (una riga, leggibile solo da te).
                               Un file del tuo computer lo legge jht e lo passa al setup: con glm e kimi
                               il setup tiene la chiave per conto suo, mai nella configurazione
  --api-key-stdin              legge la chiave API dallo standard input (una riga): mai sulla riga di comando
  --api-key <chiave>           la chiave scritta qui, in chiaro (non ammessa per glm e kimi)
  --secret-mode <modo>         come si salva la chiave: plaintext (predefinito), env o file
  --secret-env <nome>          con --secret-mode env: la variabile d'\''ambiente che la contiene
  --secret-file <percorso>     con --secret-mode file: il file che la contiene
  --model <modello>            il modello da usare
  --language <codice>          la lingua (per esempio it o en)
  --budget-usd <dollari>       quanto puo'\'' spendere il team, in dollari (con una fra --budget-minutes, --budget-days, --budget-until)
  --budget-minutes <n>         il budget dura questi minuti da ora
  --budget-days <n>            il budget dura questi giorni da ora
  --budget-until <ora>         il budget dura fino a questa ora del giorno, 0-23 (la prossima)
  --no-budget                  nessun limite di spesa (il team si ferma solo al credito del provider)
  --skip-health                salta il controllo finale
  --reset                      riparte da una configurazione pulita

Esempi:
  con una chiave GLM in un file:
    jht setup --non-interactive --provider glm --harness pi --api-key-file chiave.txt
  OpenAI con una chiave API, su Pi (per Claude: --provider claude):
    jht setup --non-interactive --provider openai --harness pi --api-key-stdin' ;;
    help.tools) printf '%s' 'Uso: jht tools <comando>

  status --json   se gli strumenti degli Scout (l'\''immagine piena) sono arrivati, in arrivo o falliti
  pull            li scarica in background (jht up e jht setup lo avviano da soli)
  switch          ci porta la squadra quando l'\''onboarding e'\'' chiuso (il download lo fa da solo)

Questo aiuto non avvia niente e non scarica niente.' ;;
    host_setup.skip_done) printf '%s' 'host.env sta in una cartella del container (uid 1001): il preflight dell'\''host e'\'' gia'\'' fatto, lo salto.' ;;
    host_setup.skip_unknown) printf '%s' 'host.env sta in una cartella del container (uid 1001) e questo utente non puo'\'' scriverci: salto il preflight dell'\''host, ma host.env non si legge o non dice il tipo di host (locale o VPS): il tipo resta '\''unknown'\''.' ;;
    keyfile.both) printf '%s' 'usa --api-key-file o --api-key-stdin, non tutti e due' ;;
    keyfile.not_file) printf '%s' 'il file dato a --api-key-file deve essere un file normale, non una cartella o un collegamento: %s' ;;
    keyfile.readable) printf '%s' 'il file %s lo possono leggere anche altri utenti: chmod 600 sul file.' ;;
    keyfile.shape) printf '%s' 'il contenuto del file dato a --api-key-file non e'\'' una riga da 16 a 512 caratteri stampabili senza spazi: %s' ;;
    keyfile.size) printf '%s' 'il file dato a --api-key-file e'\'' vuoto o troppo grande per una chiave (da 1 a 4096 byte): %s' ;;
    keyfile.twice) printf '%s' '--api-key-file e'\'' stato dato due volte' ;;
    keyfile.unreadable) printf '%s' 'il file dato a --api-key-file non si puo'\'' leggere: %s' ;;
    line.abbinamento_annullato_nessuna_modifica) printf '%s' 'Abbinamento annullato: nessuna modifica.' ;;
    line.abbinamento_di_s_non_riuscito) printf '%s' 'Abbinamento di %s non riuscito: le copie legacy restano tutte. Rilancia jht telegram pair --all: i ruoli già abbinati non chiedono un altro token.' ;;
    line.abbinamento_rifiutato_genera_un_token) printf '%s' 'Abbinamento rifiutato: genera un token nuovo in BotFather (/revoke) e riprova.' ;;
    line.accedi_con_l_utente_jht) printf '%s' 'Accedi con l'\''utente JHT rootless configurato dall'\''installazione e riprova.' ;;
    line.agent_restart_failed.inventario_conservato_ma_il_team) printf '%s' 'inventario conservato, ma il team non è ripartito. Cosa fare: jht up' ;;
    line.allineo_owner_di_s_a) printf '%s' 'Allineo owner di %s a %s (era uid %s)...' ;;
    line.annullato_niente_autorizzato) printf '%s' 'Annullato: niente autorizzato.' ;;
    line.anteprima_non_valida_niente_autorizzato) printf '%s' 'Anteprima non valida: niente autorizzato.' ;;
    line.apply.authorize) printf '%s' 'Autorizzi questa candidatura?' ;;
    line.apply_relink_account_cloud_account) printf '%s' 'apply relink-account: cloud account non disponibile. Esegui prima jht cloud pair.' ;;
    line.attenzione_le_cli_interne_verranno) printf '%s' 'ATTENZIONE: le CLI interne verranno reinstallate e i segreti non saranno conservati. La configurazione e lo stato della posta restano, ma dovrai reinserire la password della posta e rifare il login LinkedIn.' ;;
    line.autorizzata_s_verso_s_il) printf '%s' 'Autorizzata #%s, verso %s: il CLOSER la prendera'\'' al prossimo giro.' ;;
    line.bind_uid_conflict.uid_s_on_this_computer) printf '%s' 'l'\''uid %s su questo computer e'\'' l'\''account '\''%s'\''. Il container di Job Hunter Team gira come uid %s, quindi quell'\''account sarebbe proprietario di ~/.jht (i tuoi dati e le credenziali dei portali). Non e'\'' stato cambiato niente. Esegui JHT dall'\''account '\''%s'\'', oppure dai a '\''%s'\'' un altro uid, poi riprova.' ;;
    line.bot_abbinato_e_copia_legacy) printf '%s' 'Bot abbinato e copia legacy rimossa. Restano altri token legacy o un token nell'\''ambiente del container: rimuovili e completa la rotazione prima del cutover.' ;;
    line.bot_token_invalid.controlla_il_token_generato_da) printf '%s' 'controlla il token generato da BotFather.' ;;
    line.broker_restart_failed.il_servizio_della_posta_non_4) printf '%s' 'il servizio della posta non è ripartito. Cosa fare: jht mail status' ;;
    line.broker_start_failed.il_servizio_della_posta_non_2) printf '%s' 'il servizio della posta non è partito.' ;;
    line.broker_start_failed.il_servizio_della_posta_non_3) printf '%s' 'il servizio della posta non risponde dopo 30 secondi.' ;;
    line.broker_unavailable.il_broker_dei_segreti_esiste) printf '%s' 'il broker dei segreti esiste ma non è attestabile come nostro: non lo tocco.' ;;
    line.broker_unavailable.il_broker_dei_segreti_non) printf '%s' 'il broker dei segreti non è attivo o non è attestabile.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato) printf '%s' 'il compose del runtime installato non è leggibile, non si sa se ha il broker dei segreti.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato_2) printf '%s' 'il compose del runtime installato non è leggibile, non si sa se ha il broker dei segreti.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio) printf '%s' 'il runtime installato è più vecchio e non ha il broker dei segreti.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio_2) printf '%s' 'il runtime installato è più vecchio e non ha il broker dei segreti.' ;;
    line.broker_unavailable.il_servizio_della_posta_non) printf '%s' 'il servizio della posta non c'\''è ancora: si crea la prima volta che serve.' ;;
    line.cancellato_marcatore_migrazione_broker_s) printf '%s' 'Cancellato: marcatore migrazione broker %s' ;;
    line.cancellato_volume_broker_s_s) printf '%s' 'Cancellato: volume broker %s (%s)' ;;
    line.chown_fallito_su_s) printf '%s' 'chown fallito su %s' ;;
    line.client_container_non_trovato_nel) printf '%s' 'client container non trovato nel PATH. Ripara il runtime JHT.' ;;
    line.client_container_non_trovato_nel_2) printf '%s' 'client container non trovato nel PATH. Ripara il runtime JHT.' ;;
    line.compose_extra_file_non_e) printf '%s' 'COMPOSE_EXTRA_FILE non e'\'' l'\''overlay seccomp dell'\''accesso: non faccio niente.' ;;
    line.compose_up_failed.podman_compose_up_e_uscito) printf '%s' 'podman-compose up e'\'' uscito con %s. L'\''errore di Podman e'\'' qui sopra.' ;;
    line.compose_up_timeout.podman_compose_up_non_ha) printf '%s' 'podman-compose up non ha finito in %ss ed e'\'' stato fermato. Un servizio non e'\'' partito: guarda «podman ps -a» e «podman logs jht».' ;;
    line.container_jht_non_verificabile_dopo) printf '%s' 'Container JHT non verificabile dopo l'\''operazione.' ;;
    line.container_s_non_attivo_leggere) printf '%s' 'container '\''%s'\'' non attivo: leggere il piano non lo accende. Avvialo con '\''jht up'\'' e riprova.' ;;
    line.container_s_non_e_partito) printf '%s' 'Container '\''%s'\'' non e'\'' partito entro 10s. Controlla '\''jht logs'\''.' ;;
    line.cosa_fare_jht_mail_setup) printf '%s' 'Cosa fare: jht mail setup' ;;
    line.cosa_fare_jht_up) printf '%s' 'Cosa fare: jht up' ;;
    line.cosa_fare_jht_up_2) printf '%s' 'Cosa fare: jht up' ;;
    line.cosa_fare_jht_up_3) printf '%s' 'Cosa fare: jht up' ;;
    line.cosa_fare_jht_upgrade) printf '%s' 'Cosa fare: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_2) printf '%s' 'Cosa fare: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_3) printf '%s' 'Cosa fare: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_4) printf '%s' 'Cosa fare: jht upgrade' ;;
    line.cosa_fare_reinstalla_il_runtime) printf '%s' 'Cosa fare: reinstalla il runtime con l'\''installer' ;;
    line.cosa_fare_reinstalla_il_runtime_2) printf '%s' 'Cosa fare: reinstalla il runtime con l'\''installer' ;;
    line.cosa_fare_reinstalla_il_runtime_3) printf '%s' 'Cosa fare: reinstalla il runtime con l'\''installer' ;;
    line.cosa_fare_reinstalla_il_runtime_4) printf '%s' 'Cosa fare: reinstalla il runtime con l'\''installer' ;;
    line.cosa_fare_riprova_il_comando) printf '%s' 'Cosa fare: riprova il comando' ;;
    line.cosa_fare_riprova_il_comando_2) printf '%s' 'Cosa fare: riprova il comando' ;;
    line.data_dir_moved.jht_home_host_s_non) printf '%s' 'JHT_HOME_HOST=%s non e'\'' %s. Il team usa sempre %s: lo monta il compose, lo legge l'\''app, e su macOS e'\'' l'\''unica cartella dati che la macchina Podman vede. Togli JHT_HOME_HOST, oppure sposta i dati in %s.' ;;
    line.data_dir_moved.jht_user_dir_host_s) printf '%s' 'JHT_USER_DIR_HOST=%s non e'\'' %s. Il team usa sempre %s: lo monta il compose, e su macOS e'\'' l'\''unica cartella documenti che la macchina Podman vede. Togli JHT_USER_DIR_HOST, oppure sposta i documenti in %s.' ;;
    line.disk_low.gli_agenti_richiedono_almeno_disk) printf '%s' 'Gli agenti richiedono almeno %s GiB di disco — disponibili: %s GiB. Per liberare spazio esegui '\''jht clean-images'\'' (toglie solo le vecchie versioni di Job Hunter Team), svuota il Cestino ed elimina i file grandi che non ti servono, poi riprova: non e'\'' stato scaricato ne'\'' modificato niente.' ;;
    line.docker_punta_a_s_che) printf '%s' 'Docker punta a %s, che non e'\'' questo computer: i container e i volumi jht li'\'' non si toccano. Riporta Docker su quello locale (DOCKER_HOST o docker context) e rilancia.' ;;
    line.fermo_e_ricreo_la_macchina) printf '%s' 'Fermo e ricreo la macchina Podman '\''%s'\''...' ;;
    line.fino_ad_allora_la_posta) printf '%s' 'Fino ad allora la posta si legge e si invia con la password di oggi; l'\''avviso resta in jht mail status.' ;;
    line.genera_una_nuova_password_per) printf '%s' 'genera una nuova password per app dal tuo provider e salvala con: jht mail setup' ;;
    line.host_setup_sh_non_trovato) printf '%s' 'host-setup.sh non trovato in %s — skip preflight host' ;;
    line.host_setup_sh_terminato_con) printf '%s' 'host-setup.sh terminato con errore — proseguo' ;;
    line.i_segreti_e_lo_stato) printf '%s' 'I segreti e lo stato del broker sono stati cancellati: rifai i login dei portali e configura di nuovo la posta.' ;;
    line.identita_progetto_compose_non_valida) printf '%s' 'Identita progetto Compose non valida.' ;;
    line.il_broker_non_ha_registrato) printf '%s' 'Il broker non ha registrato l'\''autorizzazione: ritirata, niente partira'\''.' ;;
    line.il_compose_non_indica_una) printf '%s' 'Il compose non indica una sola immagine condivisa per team e broker; preservazione negata.' ;;
    line.il_container_s_non_c) printf '%s' 'il container '\''%s'\'' non c'\''e'\'', ma altri servizi del progetto girano: li fermo.' ;;
    line.il_documento_deve_essere_un) printf '%s' 'il documento deve essere un file regolare, non un link: %s' ;;
    line.il_documento_supera_i_mb) printf '%s' 'il documento supera i 10 MB' ;;
    line.il_file_del_profilo_supera) printf '%s' 'il file del profilo supera i 64 KiB' ;;
    line.il_motore_dei_container_non) printf '%s' 'Il motore dei container non e'\'' attivo: non e'\'' stato tolto niente.' ;;
    line.il_profilo_deve_essere_un) printf '%s' 'il profilo deve essere un file regolare, non un link: %s' ;;
    line.il_progetto_ha_container_che) printf '%s' 'Il progetto ha container che non sono ne'\'' il team ne'\'' i suoi servizi attestati: non li tocco.' ;;
    line.il_runtime_podman_rootless_locale) printf '%s' 'Il runtime Podman rootless locale non risponde.' ;;
    line.il_servizio_s_del_progetto) printf '%s' 'Il servizio '\''%s'\'' del progetto gira ma non e'\'' attestabile come nostro: non lo tocco e non fermo nient'\''altro.' ;;
    line.input_interrotto.token_non_letto) printf '%s' 'token non letto.' ;;
    line.integration.install_hint) printf '%s' 'per installarli: '\''jht upgrade'\'' (o un '\''jht integration add <id>'\'')' ;;
    line.integration.not_installed) printf '%s' 'non installato' ;;
    line.integration.not_installed_yet) printf '%s' 'non ancora installato' ;;
    line.interattivo_il_token_viene_chiesto) printf '%s' 'Interattivo: il token viene chiesto senza eco, poi il bot nuovo riceve un codice monouso dal tuo Telegram. Automazioni: {"bot_token": ...} come JSON su stdin; non salvare il token in ~/.jht e cancella subito qualunque file usato fuori da lì.' ;;
    line.jht_home_host_o_jht) printf '%s' 'JHT_HOME_HOST o JHT_USER_DIR_HOST puntano altrove: non cancello cartelle che non sono quelle fisse di JHT.' ;;
    line.jht_telegram_pair_all_interattivo) printf '%s' 'jht telegram pair --all è interattivo: per le automazioni abbina un ruolo alla volta.' ;;
    line.job_hunter_team_non_ancora) printf '%s' 'Job Hunter Team non è ancora avviato: lancia '\''jht up'\'' (la prima volta, '\''jht setup'\'').' ;;
    line.job_hunter_team_non_installato) printf '%s' 'Job Hunter Team non è installato del tutto: nella cartella del runtime manca il file di integrità (un'\''installazione interrotta?). Rilancia l'\''installer.' ;;
    line.l_overlay_seccomp_dell_accesso) printf '%s' 'L'\''overlay seccomp dell'\''accesso non e'\'' un file normale.' ;;
    line.la_casella_di_posta_ora) printf '%s' 'La casella di posta ora sta nel broker dei segreti. La sua password era leggibile dagli agenti:' ;;
    line.la_connessione_podman_jht_non) printf '%s' 'La connessione Podman JHT non supporta il dispatcher Compose.' ;;
    line.la_macchina_e_pronta_ma) printf '%s' 'La macchina e'\'' pronta, ma non ho potuto abilitare il trim settimanale del disco.' ;;
    line.la_macchina_e_stata_ricreata) printf '%s' 'La macchina e'\'' stata ricreata, ma lo stato del broker non ha superato la verifica/importazione.' ;;
    line.la_macchina_podman_s_vede) printf '%s' 'La macchina Podman '\''%s'\'' vede piu'\'' cartelle del Mac di quelle che servono a JHT (~/.jht e ~/Documents/Job Hunter Team).' ;;
    line.la_nuova_macchina_podman_s) printf '%s' 'La nuova macchina Podman '\''%s'\'' non si e'\'' creata.' ;;
    line.legacy_cleanup_failed.i_token_nuovi_sono_al) printf '%s' 'i token nuovi sono al sicuro, ma la copia legacy di %s è ancora in ~/.jht; cutover negato.' ;;
    line.legacy_cleanup_failed.il_nuovo_token_al_sicuro) printf '%s' 'il nuovo token è al sicuro, ma il token vecchio è ancora in ~/.jht; cutover negato.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch) printf '%s' 'il team resta fermo perché l'\''inventario Telegram host non è stato conservato.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_2) printf '%s' 'il team resta fermo perché l'\''inventario Telegram host non è stato conservato.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_3) printf '%s' 'il team resta fermo perché l'\''inventario Telegram host non è stato conservato.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_4) printf '%s' 'il team resta fermo perché l'\''inventario Telegram host non è stato conservato.' ;;
    line.legacy_inventory_failed.le_impronte_non_sono_state) printf '%s' 'le impronte non sono state conservate dal servizio isolato.' ;;
    line.legacy_inventory_failed.lo_stato_del_container_agenti) printf '%s' 'lo stato del container agenti non è attestabile.' ;;
    line.legacy_inventory_failed.migrazione_telegram_interrotta) printf '%s' 'migrazione Telegram interrotta.' ;;
    line.legacy_inventory_failed.non_posso_provare_che_jht) printf '%s' 'non posso provare che ~/.jht sia privo di token Telegram.' ;;
    line.legacy_inventory_failed.non_riesco_a_fermare_gli) printf '%s' 'non riesco a fermare gli agenti prima dell'\''inventario host.' ;;
    line.legacy_inventory_failed.non_riesco_a_leggere_i) printf '%s' 'non riesco a leggere i token legacy in ~/.jht.' ;;
    line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti) printf '%s' 'ruoli legacy non riconosciuti.' ;;
    line.legacy_inventory_invalid.migrazione_telegram_interrotta_2) printf '%s' 'migrazione Telegram interrotta.' ;;
    line.legacy_migration_failed.s_resta_in_jht_credentials) printf '%s' '%s resta in ~/.jht/credentials (risposta del broker: %s).' ;;
    line.legacy_remove_failed.s_nel_broker_ma_la) printf '%s' '%s è nel broker ma la copia in ~/.jht/credentials è rimasta.' ;;
    line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso) printf '%s' '~/.jht/credentials/%s.json è ricomparso dopo la migrazione; rimosso senza importarlo.' ;;
    line.macchina_podman_ricreata_vede_solo) printf '%s' 'Macchina Podman ricreata: vede solo ~/.jht e ~/Documents/Job Hunter Team. Lo stato del broker e'\'' stato conservato; le CLI dei provider si reinstallano da sole al primo '\''jht up'\'' (circa un minuto, serve la rete: '\''jht providers versions'\'' lo conferma, '\''jht providers update'\'' le rimette a mano). Avvia il team con '\''jht up'\'', reinserisci la password della posta e rifai il login LinkedIn.' ;;
    line.mail.address_prompt) printf '%s' 'Indirizzo della casella:' ;;
    line.mail.app_password_prompt) printf '%s' 'Password per app (non viene mostrata):' ;;
    line.mail.dedicated_prompt) printf '%s' 'È una casella DEDICATA agli avvisi di lavoro inoltrati?' ;;
    line.mail_setup_opzione_sconosciuta_s) printf '%s' 'mail setup: opzione sconosciuta %s' ;;
    line.mail_setup_password_vuota) printf '%s' 'mail setup: password vuota' ;;
    line.migrazione_docker_podman_gia_verificata) printf '%s' 'Migrazione Docker -> Podman gia'\'' verificata; i volumi Docker restano intatti e contengono ancora le password della posta, gli accessi ai portali e i token di Telegram.' ;;
    line.migrazione_docker_podman_verificata_i) printf '%s' 'Migrazione Docker -> Podman verificata. I volumi Docker non sono stati rimossi e contengono ancora le password della posta, gli accessi ai portali e i token di Telegram: cancellali solo con una conferma esplicita nel futuro comando di pulizia.' ;;
    line.mount_repair_failed.s_non_si_puo_rendere) printf '%s' '%s non si puo'\'' rendere scrivibile al container (gira come uid %s) e non e'\'' stato avviato niente. Fai una volta: sudo chown -R %s %s e riesegui '\''jht up'\''.' ;;
    line.nessun_provider_attivo_scegline_uno) printf '%s' 'nessun provider attivo: scegline uno con '\''jht providers use glm'\''' ;;
    line.nessun_ruolo_ha_un_token) printf '%s' 'Nessun ruolo ha un token legacy: per un bot nuovo usa jht telegram pair <ruolo>.' ;;
    line.niente_da_fermare_nessun_container) printf '%s' 'niente da fermare: nessun container del progetto.' ;;
    line.no_answer) printf '%s' 'nessuna risposta' ;;
    line.no_answer_from_container) printf '%s' 'nessuna risposta dal container' ;;
    line.non_autorizzabile_s) printf '%s' 'Non autorizzabile: %s.' ;;
    line.non_autorizzata_s) printf '%s' 'Non autorizzata: %s.' ;;
    line.non_ho_potuto_rimettere_s) printf '%s' 'Non ho potuto rimettere '\''%s'\'' come connessione Podman predefinita.' ;;
    line.non_ho_potuto_rimuovere_il) printf '%s' 'Non ho potuto rimuovere il marcatore della migrazione del broker: %s' ;;
    line.non_riesco_a_creare_jht) printf '%s' 'Non riesco a creare ~/.jht o ~/Documents/Job Hunter Team per la macchina Podman.' ;;
    line.non_riesco_a_creare_jht_2) printf '%s' 'Non riesco a creare ~/.jht o ~/Documents/Job Hunter Team per la macchina Podman.' ;;
    line.non_riesco_a_determinare_l) printf '%s' 'Non riesco a determinare l'\''immagine attestata del broker: il compose del runtime non ha risposto.' ;;
    line.non_riesco_a_esportare_in) printf '%s' 'Non riesco a esportare in modo verificabile lo stato del broker; la macchina non e'\'' stata cancellata.' ;;
    line.non_riesco_a_fermare_i) printf '%s' 'Non riesco a fermare i servizi prima di salvare lo stato del broker.' ;;
    line.non_riesco_a_leggere_il) printf '%s' 'non riesco a leggere il documento: %s' ;;
    line.non_riesco_a_rimuovere_i) printf '%s' 'Non riesco a rimuovere i container fermi della versione di prima: «jht down», poi «jht up».' ;;
    line.non_riesco_a_rimuovere_la) printf '%s' 'Non riesco a rimuovere la macchina Podman '\''%s'\''.' ;;
    line.non_riesco_a_sapere_a) printf '%s' 'Non riesco a sapere a quale Docker parla questo computer: i container e i volumi jht non si toccano.' ;;
    line.non_riesco_a_verificare_quali) printf '%s' 'Non riesco a verificare quali cartelle del Mac vede la macchina Podman '\''%s'\''.' ;;
    line.non_sono_riuscito_a_cancellare) printf '%s' 'Non sono riuscito a cancellare %s (appartiene a un altro utente, per esempio quello del container, e il container di servizio non e'\'' disponibile).' ;;
    line.opzione_di_clean_images_non) printf '%s' 'Opzione di clean-images non supportata: %s (uso: jht clean-images [--json])' ;;
    line.opzione_non_riconosciuta_s) printf '%s' 'opzione non riconosciuta: %s' ;;
    line.opzione_non_riconosciuta_s_2) printf '%s' 'opzione non riconosciuta: %s' ;;
    line.opzione_non_riconosciuta_s_3) printf '%s' 'opzione non riconosciuta: %s' ;;
    line.os_and_version_are_required) printf '%s' '--os e --version sono obbligatori' ;;
    line.override_compose_per_podman_rootless) printf '%s' 'Override Compose per Podman rootless non scrivibile in %s.' ;;
    line.per_l_aiuto_di_s) printf '%s' 'Per l'\''aiuto di '\''%s'\'' serve il container attivo: '\''jht up'\''.' ;;
    line.per_procedere_jht_podman_machine) printf '%s' 'Per procedere: jht podman-machine-recreate --confirm' ;;
    line.pin_dell_immagine_degli_strumenti) printf '%s' 'pin dell'\''immagine degli strumenti non attendibile' ;;
    line.podman_compose_non_trovato_installa) printf '%s' 'podman-compose non trovato: installa il pacchetto «podman-compose» (su Ubuntu: sudo apt install podman-compose).' ;;
    line.podman_machine_avviata_ma_il) printf '%s' 'Podman machine avviata ma il client JHT non risponde.' ;;
    line.podman_machine_jht_non_attiva) printf '%s' 'Podman machine JHT non attiva. Esegui '\''jht up'\'' per avviarla.' ;;
    line.podman_machine_non_avviabile) printf '%s' 'Podman machine non avviabile.' ;;
    line.podman_machine_s_non_attiva) printf '%s' 'Podman machine '\''%s'\'' non attiva, la avvio...' ;;
    line.podman_non_trovato_reinstalla_il) printf '%s' 'Podman non trovato: reinstalla il runtime JHT.' ;;
    line.podman_non_trovato_reinstalla_il_2) printf '%s' 'Podman non trovato: reinstalla il runtime JHT.' ;;
    line.podman_non_trovato_reinstalla_il_3) printf '%s' 'Podman non trovato: reinstalla il runtime JHT.' ;;
    line.podman_other_machine_running.named) printf '%s' 'un'\''altra macchina Podman, %s, e'\'' accesa: spegnila con '\''podman machine stop %s'\'' e riprova.' ;;
    line.podman_other_machine_running.unnamed) printf '%s' 'un'\''altra macchina Podman e'\'' accesa: trovala con '\''podman machine list'\'', spegnila con '\''podman machine stop <nome>'\'' e riprova.' ;;
    line.podman_remote_service_refused.su_linux_jht_usa_solo) printf '%s' 'su Linux JHT usa solo il Podman locale di questo utente, ma il client podman parla con un servizio remoto.' ;;
    line.podman_rootful_refused.jht_su_linux_richiede_podman) printf '%s' 'JHT su Linux richiede Podman rootless eseguito da un utente non root.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non) printf '%s' 'il runtime Podman rootless non risponde.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non_2) printf '%s' 'il runtime Podman rootless non risponde.' ;;
    line.preparo_il_servizio_della_posta) printf '%s' 'Preparo il servizio della posta (si crea solo la prima volta che serve)…' ;;
    line.provider_attivo_non_riconosciuto_s) printf '%s' 'provider attivo non riconosciuto: %s' ;;
    line.provider_podman_compose_non_trovato) printf '%s' 'Provider Podman Compose non trovato: reinstalla il runtime JHT.' ;;
    line.questo_runtime_non_usa_una) printf '%s' 'Questo runtime non usa una macchina Podman: non c'\''e'\'' niente da ricreare.' ;;
    line.reset_impossibile_cancellare_il_marcatore) printf '%s' 'reset: impossibile cancellare il marcatore migrazione broker %s.' ;;
    line.reset_impossibile_cancellare_il_marcatore_2) printf '%s' 'reset: impossibile cancellare il marcatore del broker %s.' ;;
    line.reset_impossibile_cancellare_il_volume) printf '%s' 'reset: impossibile cancellare il volume broker %s (%s).' ;;
    line.reset_nome_volume_non_valido) printf '%s' 'reset: nome volume non valido per %s; rimozione negata.' ;;
    line.reset_non_riesco_a_determinare) printf '%s' 'reset: non riesco a determinare il progetto Compose; i volumi del broker non sono stati toccati.' ;;
    line.reset_non_riesco_a_fermare) printf '%s' 'reset: non riesco a fermare il runtime; i volumi del broker non sono stati toccati.' ;;
    line.reset_ricerca_del_volume_s) printf '%s' 'reset: ricerca del volume %s non riuscita.' ;;
    line.reset_ricerca_del_volume_s_2) printf '%s' 'reset: ricerca del volume %s non riuscita.' ;;
    line.restano_token_legacy_per_s) printf '%s' 'Restano token legacy per: %s. Finché non abbini anche questi ruoli, %s resta muto su Telegram: abbinali tutti in questa seduta (jht telegram pair --all).' ;;
    line.ricrea_la_macchina_podman_s) printf '%s' 'Ricrea la macchina Podman '\''%s'\'': la ferma e la cancella, poi la ricrea vedendo solo ~/.jht e ~/Documents/Job Hunter Team.' ;;
    line.ricreala_con_jht_podman_machine) printf '%s' 'Ricreala con '\''jht podman-machine-recreate --confirm'\'': i file e lo stato del broker restano, ma le CLI interne e i segreti vengono cancellati.' ;;
    line.risposta_del_container_non_valida) printf '%s' 'Risposta del container non valida: autorizzazione ritirata, niente partira'\''.' ;;
    line.ritirata_s_non_verra_inviata) printf '%s' 'Ritirata #%s: non verra'\'' inviata.' ;;
    line.ritiro_non_riuscito_s) printf '%s' 'Ritiro non riuscito: %s.' ;;
    line.runtime_host_non_attendibile_path) printf '%s' 'runtime host non attendibile (path, owner, permessi o SHA-256)' ;;
    line.runtime_host_protetto_non_installabile) printf '%s' 'runtime host protetto non installabile; il legacy ~/.jht/runtime non viene usato' ;;
    line.runtime_migration_changed.checksum_diverso_per_s_dopo) printf '%s' 'checksum diverso per %s dopo la migrazione.' ;;
    line.runtime_migration_changed.s_non_corrisponde_piu_al) printf '%s' '%s non corrisponde piu'\'' al marker verificato.' ;;
    line.runtime_migration_checksum_mismatch.s_non_ha_superato_la) printf '%s' '%s non ha superato la verifica.' ;;
    line.runtime_migration_docker_missing.il_client_docker_originale_non) printf '%s' 'il client Docker originale non e'\'' disponibile.' ;;
    line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata) printf '%s' 'serve l'\''immagine JHT fissata per digest.' ;;
    line.runtime_migration_image_missing.la_stessa_immagine_jht_deve) printf '%s' 'la stessa immagine JHT deve esistere in Docker e Podman.' ;;
    line.runtime_migration_interrupted.copia_incompleta_di_s_il) printf '%s' 'copia incompleta di %s; il sorgente Docker e'\'' intatto.' ;;
    line.runtime_migration_podman_missing.podman_non_e_disponibile) printf '%s' 'Podman non e'\'' disponibile.' ;;
    line.runtime_migration_source_missing.s_manca_in_docker_ma) printf '%s' '%s manca in Docker ma esiste in Podman; non lo sovrascrivo.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_docker) printf '%s' 'ferma prima il team Docker.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_podman) printf '%s' 'ferma prima il team Podman.' ;;
    line.runtime_o_container_jht_non) printf '%s' 'runtime o container JHT non disponibile' ;;
    line.ruoli_da_abbinare_in_questa) printf '%s' 'Ruoli da abbinare in questa seduta: %s' ;;
    line.s_e_un_collegamento_non) printf '%s' '%s e'\'' un collegamento: non lo seguo e non lo cancello.' ;;
    line.s_ha_gi_un_bot) printf '%s' '%s ha già un bot abbinato: tolgo solo la sua copia legacy.' ;;
    line.s_needs_a_value) printf '%s' '%s richiede un valore' ;;
    line.s_non_e_una_cartella) printf '%s' '%s non e'\'' una cartella: non la cancello.' ;;
    line.saltato_non_trovato_volume_broker) printf '%s' 'Saltato (non trovato): volume broker %s' ;;
    line.script_s_non_ancora_installato) printf '%s' 'script %s non ancora installato: '\''jht upgrade'\'' (o un '\''jht integration add/remove'\'') e riprova' ;;
    line.script_s_non_scaricabile_controlla) printf '%s' 'script %s non scaricabile: controlla la rete o fai '\''jht upgrade'\''' ;;
    line.serve_un_terminale_l_autorizzazione) printf '%s' 'Serve un terminale: l'\''autorizzazione si conferma a mano.' ;;
    line.status.caller_env) printf '%s' 'Nell'\''ambiente di questo terminale sono impostate: %s. Il container e'\'' stato creato senza: togli la variabile (unset) e riprova.' ;;
    line.status.provider_said) printf '%s' 'Il provider ha detto: %s' ;;
    line.status.unattestable) printf '%s' 'container '\''%s'\'' non attestabile: c'\''e'\'' qualcosa che non si riesce a verificare (una configurazione diversa dall'\''attesa, o il motore che non risponde); non vuol dire che non giri.' ;;
    line.sudo_chown_fallito_su_s) printf '%s' 'sudo chown fallito su %s (potrebbe servire '\''sudo %s up'\'')' ;;
    line.telegram_isolato_attivo_il_bridge) printf '%s' 'Telegram isolato attivo; il bridge legacy non può più essere riabilitato dagli agenti.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_3) printf '%s' 'il compose del runtime installato non è leggibile, non si sa se ha il servizio Telegram isolato.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_4) printf '%s' 'il compose del runtime installato non è leggibile, non si sa se ha il servizio Telegram isolato.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_3) printf '%s' 'il runtime installato è più vecchio e non ha il servizio Telegram isolato.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_4) printf '%s' 'il runtime installato è più vecchio e non ha il servizio Telegram isolato.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non) printf '%s' 'il servizio Telegram isolato non è attivo o non è attestabile.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non_2) printf '%s' 'il servizio Telegram isolato non è attivo o non è attestabile.' ;;
    line.the_setup_keeps_the_key) printf '%s' 'Il setup tiene la chiave: ora puoi cancellare il file su questo computer (%s).' ;;
    line.togli_remote_true_da_containers) printf '%s' 'Togli remote = true da containers.conf (o CONTAINERS_CONF) per questo utente e riprova.' ;;
    line.unattestable.autostart) printf '%s' 'Container JHT esistente non attestabile; avvio automatico negato.' ;;
    line.unattestable.existing) printf '%s' 'Container JHT esistente non attestabile; operazione interrotta.' ;;
    line.unattestable.logs) printf '%s' 'Container JHT non attestabile; lettura log negata.' ;;
    line.unattestable.other) printf '%s' 'Container JHT non attestabile; operazione negata.' ;;
    line.unattestable.recreate) printf '%s' 'Container JHT non attestabile; ricreazione negata.' ;;
    line.unattestable.restart) printf '%s' 'Container JHT non attestabile; riavvio negato.' ;;
    line.unattestable.stop) printf '%s' 'Container JHT non attestabile; arresto negato.' ;;
    line.unknown_argument_s) printf '%s' 'argomento sconosciuto: %s' ;;
    line.upgrade.activate) printf '%s' 'Attivo il nuovo runtime...' ;;
    line.upgrade.broker_restart_failed) printf '%s' 'il broker dei segreti non e'\'' ripartito. Cosa fare: jht up' ;;
    line.upgrade.check_available) printf '%s' 'Controllo: c'\''e'\'' un aggiornamento, %s (%s) -> %s. %s. Per applicarlo: jht upgrade' ;;
    line.upgrade.check_none) printf '%s' 'Controllo: nessun aggiornamento, %s (%s) e'\'' gia'\'' l'\''ultima. %s.' ;;
    line.upgrade.check_only) printf '%s' 'Controllo: %s.' ;;
    line.upgrade.disk_room) printf '%s' 'L'\''aggiornamento scarica circa %s GiB, e dopo il download agli agenti resterebbero meno dei %s GiB di disco che servono: ora ne sono liberi %s. Libera almeno altri %s GiB (svuota il Cestino, elimina i file grandi che non ti servono), poi riprova: non è stato scaricato né cambiato niente (sono state tolte solo le vecchie versioni di Job Hunter Team che non usava nessuno).' ;;
    line.upgrade.done) printf '%s' 'Aggiornamento completato: %s (%s) -> %s (%s). %s' ;;
    line.upgrade.failed) printf '%s' 'Aggiornamento non completato (%s): %s. %s' ;;
    line.upgrade.full_pull_failed) printf '%s' 'l'\''immagine piena nuova non e'\'' arrivata, resta la vecchia. Cosa fare: jht tools pull' ;;
    line.upgrade.helper_install_failed) printf '%s' 'gli script host nuovi si prendono alla prima richiesta o con un altro '\''jht upgrade'\''' ;;
    line.upgrade.interrupted) printf '%s' 'Rilevato upgrade interrotto: ripristino l'\''ultima versione verificata...' ;;
    line.upgrade.keep_old) printf '%s' 'Immagini JHT vecchie: tenute tutte (JHT_KEEP_OLD_IMAGES=1).' ;;
    line.upgrade.publish) printf '%s' 'Pubblico la configurazione candidata attestata...' ;;
    line.upgrade.pull_full) printf '%s' 'Scarico l'\''immagine piena aggiornata...' ;;
    line.upgrade.pull_latest) printf '%s' 'Scarico l immagine piu recente...' ;;
    line.upgrade.pull_runtime) printf '%s' 'Scarico runtime aggiornato...' ;;
    line.upgrade.restored) printf '%s' 'Runtime precedente ripristinato.' ;;
    line.upgrade.telegram_restart_failed) printf '%s' 'il servizio Telegram isolato non è ripartito. Cosa fare: jht up' ;;
    line.upgrade.verify) printf '%s' 'Verifico il runtime aggiornato...' ;;
    line.uso_jht_apply_relink_account) printf '%s' 'uso: jht apply relink-account' ;;
    line.uso_jht_apply_request_cancel) printf '%s' 'uso: jht apply request|cancel <id>' ;;
    line.uso_jht_apply_request_cancel_2) printf '%s' 'uso: jht apply request|cancel <id>' ;;
    line.uso_jht_artifact_upload_file) printf '%s' 'uso: jht artifact upload FILE [--json]' ;;
    line.uso_jht_artifact_upload_file_2) printf '%s' 'uso: jht artifact upload FILE [--json]' ;;
    line.uso_jht_mail_setup_status) printf '%s' 'uso: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <indirizzo|@dominio>|drafts|approve <id>|discard <id>|journal|delete|migrate' ;;
    line.uso_jht_migrate_runtime_podman) printf '%s' 'uso: jht migrate-runtime podman' ;;
    line.uso_jht_profile_import_file) printf '%s' 'uso: jht profile import FILE [--replace] [--json]' ;;
    line.uso_jht_profile_import_file_2) printf '%s' 'uso: jht profile import FILE [--replace] [--json]' ;;
    line.uso_jht_profile_validate_file) printf '%s' 'uso: jht profile validate [FILE] [--strict] [--json]' ;;
    line.uso_jht_screen_on_off) printf '%s' 'uso: jht screen on | off | status [--json]' ;;
    line.uso_jht_telegram_chat_id) printf '%s' 'uso: jht telegram chat-id <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_pair_assistente) printf '%s' 'uso: jht telegram pair <assistente|capitano|mentor>|--all' ;;
    line.uso_jht_telegram_remove_assistente) printf '%s' 'uso: jht telegram remove <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_status_pair) printf '%s' 'uso: jht telegram status|pair <ruolo>|pair --all|chat-id <ruolo>|remove <ruolo>' ;;
    line.uso_jht_ticket_open_posizione) printf '%s' 'uso: jht ticket open POSIZIONE TESTO [--kind TIPO] [--attach FILE]' ;;
    line.uso_jht_ticket_open_posizione_2) printf '%s' 'uso: jht ticket open POSIZIONE TESTO [--kind TIPO] [--attach FILE]' ;;
    line.versione_dell_immagine_configurata_per) printf '%s' 'Versione dell'\''immagine configurata. Per quella del CLI in esecuzione: '\''jht up'\'' e poi '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_2) printf '%s' 'Versione dell'\''immagine configurata. Per quella del CLI in esecuzione: '\''jht up'\'' e poi '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_3) printf '%s' 'Versione dell'\''immagine configurata. Per quella del CLI in esecuzione: '\''jht up'\'' e poi '\''jht --version'\''.' ;;
    line.versione_di_podman_compose_non) printf '%s' 'Versione di podman-compose non leggibile.' ;;
    line.versione_non_supportata_servono_podman) printf '%s' 'Versione non supportata: servono podman >= %s (trovato: %s) e podman-compose >= %s (trovato: %s).' ;;
    line.versione_non_supportata_sul_mac) printf '%s' 'Versione non supportata: sul Mac servono podman %s.%s o un %s.x successivo (non 6.2 o oltre; trovato: %s) e podman-compose %s (trovato: %s). Se hai aggiornato Homebrew oltre la serie %s, aggiorna JHT (curl -fsSL https://jobhunterteam.ai/install.sh | bash).' ;;
    migrate.left) printf '%s' 'Non copiato o non verificato: il volume %s.' ;;
    monitor.window_failed) printf '%s' 'monitor_window_unavailable: impossibile aprire una finestra qui. Esegui '\''jht monitor'\'' nel terminale corrente (o dentro la tua sessione tmux).' ;;
    monitor.window_invalid) printf '%s' 'monitor_window_invalid: usa '\''jht monitor --window'\'' senza altre opzioni.' ;;
    removed.office) printf '%s' ''\''jht %s'\'' e'\'' stato tolto nella 0.4.0 insieme all'\''ufficio Godot: usa i comandi jht (jht help).' ;;
    status.container) printf '%s' 'Container' ;;
    status.image) printf '%s' 'Immagine' ;;
    status.next_other) printf '%s' 'Accendi la squadra con: jht up' ;;
    status.next_running) printf '%s' 'Chi sta lavorando: jht agents' ;;
    status.no_options) printf '%s' ''\''jht status'\'' non ha opzioni (%s): si lancia come '\''jht status'\''.' ;;
    status.not_running) printf '%s' 'Il container della squadra non e'\'' acceso.' ;;
    status.not_running_next) printf '%s' 'Accendilo con: jht up' ;;
    status.running) printf '%s' 'acceso dal %s' ;;
    status.state) printf '%s' '%s dal %s' ;;
    status.title) printf '%s' 'Stato' ;;
    team.stopped) printf '%s' 'Job Hunter Team e'\'' fermato: jht up per riaccenderlo.' ;;
    tools.arriving) printf '%s' 'Gli strumenti degli Scout stanno arrivando: l'\''immagine piena si scarica in background (circa 3 GB). La ricerca delle posizioni parte da sola quando sono arrivati; non devi fare niente.' ;;
    tools.chat_reconnecting) printf '%s' 'La squadra passa agli strumenti completi degli Scout, quindi la chat si ferma un momento: riprende da sola appena la squadra e'\'' ripartita (un paio di minuti).' ;;
    tools.chat_resumed) printf '%s' 'La squadra e'\'' passata agli strumenti completi: riprendiamo.' ;;
    tools.chat_switched) printf '%s' 'La squadra passa agli strumenti completi degli Scout, quindi questa chat si e'\'' chiusa. Riaprila fra un paio di minuti con jht team chat.' ;;
    tools.chat_update_closed) printf '%s' 'JHT si sta aggiornando, quindi questa chat si è chiusa. Riaprila fra un paio di minuti con jht team chat.' ;;
    tools.chat_update_resumed) printf '%s' 'JHT è aggiornato: riprendiamo.' ;;
    tools.chat_updating) printf '%s' 'JHT si sta aggiornando, quindi la chat si ferma un momento: riparte da sola fra poco.' ;;
    tools.disk_low) printf '%s' 'Gli strumenti degli Scout non sono stati scaricati: servono circa %s GiB liberi sul disco e ce ne sono %s, quindi la squadra non puo'\'' ancora cercare posizioni. Libera spazio (svuota il Cestino, elimina i file grandi che non ti servono), poi esegui jht up: il download riparte da solo.' ;;
    tools.engine_down) printf '%s' 'Lo stato degli strumenti degli Scout non si legge: il motore dei container non risponde. Avvialo con jht up.' ;;
    tools.failed) printf '%s' 'Il download degli strumenti degli Scout non e'\'' riuscito: la squadra non puo'\'' ancora cercare posizioni. Esegui jht tools pull per riprovare (anche jht up riprova).' ;;
    tools.not_started) printf '%s' 'Il download degli strumenti degli Scout non è partito, quindi la squadra non può ancora cercare posizioni. Lancia jht tools pull per avviarlo (lo avvia anche jht up).' ;;
    tools.ready) printf '%s' 'Gli strumenti degli Scout sono arrivati: la squadra cerca con l'\''immagine piena.' ;;
    tools.switch_failed) printf '%s' 'Gli strumenti degli Scout sono arrivati, ma la squadra non si e'\'' potuta riavviare con loro: esegui jht down, poi jht up.' ;;
    tools.switch_wait) printf '%s' 'La squadra sta passando agli strumenti completi degli Scout: aspetto che riparta (al massimo un paio di minuti).' ;;
    tools.waiting) printf '%s' 'Gli strumenti degli Scout sono arrivati: la squadra ci passa da sola quando l'\''onboarding e'\'' chiuso.' ;;
    uninstall.bad_home) printf '%s' 'HOME non valida: rimozione negata.' ;;
    uninstall.colima_busy) printf '%s' 'Colima resta accesa: l'\''ha accesa l'\''installer di JHT, ma dentro girano altri container, quindi la lascio. Per fermarla: colima stop.' ;;
    uninstall.colima_running) printf '%s' 'Colima resta accesa: non l'\''ha accesa l'\''installer di JHT (era gia'\'' accesa, oppure non e'\'' quella standard), quindi la lascio, e potrebbe essere tua. Per fermarla: colima stop.' ;;
    uninstall.colima_stop_failed) printf '%s' 'Non sono riuscito a fermare Colima. Per fermarla: colima stop.' ;;
    uninstall.colima_stopping) printf '%s' 'Fermo la macchina virtuale Colima, che ha acceso l'\''installer di JHT e dove non gira nient'\''altro; le tue cartelle sul Mac restano.' ;;
    uninstall.compose_link_left) printf '%s' 'Non sono riuscito a togliere il collegamento al plugin Docker Compose che aveva messo l'\''installer di JHT: %s. Lo puoi cancellare.' ;;
    uninstall.compose_link_removed) printf '%s' 'Ho tolto il collegamento al plugin Docker Compose che aveva messo l'\''installer di JHT: %s. Il plugin installato con Homebrew resta (lo toglie brew uninstall docker-compose).' ;;
    uninstall.images_removed) printf '%s' 'Tolte %s immagini di JHT: il nucleo, quella piena e le vecchie.' ;;
    uninstall.left.commands) printf '%s' 'Non rimossi: il comando jht o le righe PATH aggiunte dall'\''installer.' ;;
    uninstall.left.data) printf '%s' 'Non cancellati i dati di JHT elencati sopra. Il comando jht e il runtime sono rimasti: rilancia '\''jht uninstall --confirm --purge'\'' dopo aver risolto.' ;;
    uninstall.left.images) printf '%s' 'Non tolte alcune immagini di JHT (il motore le ha rifiutate). Rilancia '\''jht uninstall --confirm'\'' quando nient'\''altro le usa.' ;;
    uninstall.left.machine) printf '%s' 'Non rimossi: la macchina Podman jht-podman o i container e i volumi di JHT, con i segreti salvati. Rilancia '\''jht uninstall --confirm'\'' quando Podman o Docker rispondono.' ;;
    uninstall.left.runtime) printf '%s' 'Non rimosso: il runtime host di JHT.' ;;
    uninstall.loss) printf '%s' 'Vengono cancellati anche la password della posta e i token di Telegram salvati; ~/.jht e Documenti restano, e con loro la sessione LinkedIn salvata (secrets/linkedin-profile e .cache/linkedin): si toglie con jht reset --scope creds.' ;;
    uninstall.loss_purge) printf '%s' 'Vengono cancellati anche la password della posta e i token di Telegram salvati.' ;;
    uninstall.machine_kept) printf '%s' 'La macchina Podman '\''%s'\'' non risulta creata dall'\''installer di JHT (c'\''era gia'\'', oppure non e'\'' quella standard jht-podman), quindi non la rimuovo: potrebbe essere tua. I volumi e l'\''immagine di JHT che ha dentro restano con lei. Per toglierla: podman machine stop %s, poi podman machine rm %s.' ;;
    uninstall.machine_removing) printf '%s' 'Rimuovo la macchina Podman '\''%s'\'', creata dall'\''installer di JHT: con lei se ne va tutto quello che ha dentro (i volumi e l'\''immagine di JHT); le tue cartelle sul Mac restano.' ;;
    uninstall.phase.commands) printf '%s' 'Rimuovo il comando jht e le righe PATH aggiunte dall'\''installer...' ;;
    uninstall.phase.data) printf '%s' 'Cancello ~/.jht e la cartella Documenti (--purge)...' ;;
    uninstall.phase.images) printf '%s' 'Rimuovo le immagini di JHT (il nucleo, quella piena e le vecchie)...' ;;
    uninstall.phase.machine) printf '%s' 'Rimuovo la macchina Podman, oppure i container e i volumi di JHT...' ;;
    uninstall.phase.runtime) printf '%s' 'Rimuovo il runtime dell'\''host...' ;;
    uninstall.purge_loss) printf '%s' 'Con --purge vengono cancellati anche ~/.jht e ~/Documents/Job Hunter Team: configurazione, database, CV e output. Non si torna indietro.' ;;
    uninstall.runtime_choice_unreadable) printf '%s' 'Scelta del runtime JHT non leggibile: nessuna rimozione.' ;;
    uninstall.usage) printf '%s' 'uso: jht uninstall --confirm [--purge]' ;;
    uninstall.usage_stays) printf '%s' 'Restano anche Podman, podman-compose, Docker, Colima e Homebrew.' ;;
    uninstall.usage_what) printf '%s' 'Rimuove il runtime locale di JHT: la macchina Podman jht-podman oppure i container, i volumi e le immagini di JHT (il nucleo e quella piena, con i nomi di repository ghcr.io/leopu00/jht, jht e localhost/jht), il runtime host e il comando jht.' ;;
    up.docker_legacy) printf '%s' 'Questo computer fa girare JHT su Docker, e il suo motore non risponde. Dalla 0.4 JHT gira solo su Podman. I tuoi dati restano: ~/.jht e ~/Documents/Job Hunter Team sono cartelle di questo computer. Per passare a Podman: jht uninstall --confirm (tiene quelle due cartelle), rilancia l'\''installer, poi jht setup con la tua chiave API (la chiave, la password della posta e i token di Telegram erano nei volumi di Docker: vanno ridati). Per restare su Docker per ora, accendi tu il suo motore e rilancia jht up.' ;;
    up.done) printf '%s' 'Job Hunter Team avviato.' ;;
    up.engine_lost) printf '%s' 'La macchina Podman si e'\'' fermata mentre la squadra partiva (%s). Non hai perso niente: i tuoi dati sono nei volumi e nelle tue cartelle. Rilancia jht up: riaccende la macchina e la squadra.' ;;
    up.storage_damaged) printf '%s' 'L'\''immagine del team si e'\'' rovinata sul disco della macchina Podman (la macchina e'\'' stata spenta di colpo mentre la scriveva): la riscarico e ricreo i container. I tuoi dati stanno nei volumi e nelle tue cartelle, e restano. Ci vuole qualche minuto.' ;;
    up.storage_repair_failed) printf '%s' 'L'\''immagine del team non si ripara sulla macchina Podman. '\''jht uninstall --confirm'\'' e poi l'\''installer fanno una macchina nuova (le cartelle ~/.jht e Documenti restano).' ;;
    *) return 1 ;;
  esac
}
jht_text_hu() {
  case "$1" in
    compose.missing) printf '%s' 'hiányzik a docker compose: a motor válaszol, de a „docker compose” parancs nem létezik (a JHT-nak a Compose v2 bővítmény kell). Macen: brew install docker-compose, majd mkdir -p ~/.docker/cli-plugins && ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose. Linuxon: telepítsd a docker-compose-v2 csomagot (apt) vagy a docker-compose-plugin csomagot (dnf). Utána futtasd újra a parancsot.' ;;
    config.changed_down) printf '%s' 'config_changed_while_running: a csapat a jelenlegitől eltérő beállításokkal indult (futás közben megváltozott, vagy újratelepítés történt); leállítom.' ;;
    config.changed_other) printf '%s' 'config_changed_while_running: a csapat a vártól eltérő beállításokkal fut; ezeket csak a leállításához használom.' ;;
    config.changed_start) printf '%s' 'config_changed_while_running: a beállítás megváltozott, amíg a JHT futott (jht config set, a webhelyről vagy az appból módosított beállítások, vagy újratelepítés), ezért a futó csapat nem ellenőrizhető. Állítsd le a „jht down” paranccsal, majd indítsd el a „jht up” paranccsal.' ;;
    config.changed_stopped) printf '%s' 'config_changed_stopped: a csapat leállított konténerei a korábbi verzióból valók: újra létrehozom őket az új beállításokkal (az adatokat tartalmazó kötetek megmaradnak).' ;;
    container.starting) printf '%s' 'A(z) '\''%s'\'' konténer nem fut, elindítom...' ;;
    doctor.host_config_none) printf '%s' 'még nincs beállítás: '\''jht setup'\''' ;;
    doctor.host_config_ok) printf '%s' 'a beállítás megvan' ;;
    doctor.host_engine_fail) printf '%s' 'a konténermotor nem érhető el' ;;
    doctor.host_engine_ok) printf '%s' 'a konténermotor elérhető' ;;
    doctor.host_more) printf '%s' 'A teljes ellenőrzésekhez (beállítás, szolgáltató, adatbázis, ügynökök): '\''jht up'\'', majd '\''jht doctor'\''.' ;;
    doctor.host_runtime_fail) printf '%s' 'a JHT futtatókörnyezete hiányzik vagy megváltozott: a '\''jht upgrade'\'' újratelepíti' ;;
    doctor.host_runtime_ok) printf '%s' 'a JHT futtatókörnyezete ép' ;;
    doctor.host_team_off) printf '%s' 'a csapat le van állítva: a '\''jht up'\'' elindítja' ;;
    doctor.host_team_unattestable) printf '%s' 'van egy konténer a csapatból, de nem ellenőrizhető, hogy a miénk-e: semmihez nem nyúltam (a '\''jht status'\'' többet mond)' ;;
    doctor.host_title) printf '%s' 'Job Hunter Team: a csapat le van állítva (a konténere nem fut). Erről a gépről végzett ellenőrzések:' ;;
    down.done) printf '%s' 'A Job Hunter Team leállt.' ;;
    down.still_running) printf '%s' 'A csapat nem állt le: a projekt egyik konténere két próbálkozás után újra futott (az első percében magától újraindulhat). Futtasd újra a '\''jht down'\'' parancsot; ha így marad, '\''jht doctor'\''.' ;;
    download.asset_failed) printf '%s' 'sikertelen letöltés: %s' ;;
    download.bad_version) printf '%s' 'érvénytelen verzió: %s. Példa: 0.3.5.' ;;
    download.copy_failed) printf '%s' 'az ellenőrzött letöltés célhelyre másolása nem sikerült' ;;
    download.deb_only_linux) printf '%s' 'a --deb csak Linuxra való.' ;;
    download.dest_appeared) printf '%s' 'a célhely a letöltés közben jelent meg; nem írtam felül' ;;
    download.dest_is_link) printf '%s' 'a célhely egy link: %s' ;;
    download.dest_not_file) printf '%s' 'a célhely létezik, és nem fájl: %s' ;;
    download.fetching) printf '%s' 'Letöltés: %s...' ;;
    download.hash_invalid) printf '%s' 'érvénytelen SHA-256 ehhez: %s: várt %s, kapott %s.' ;;
    download.intel_mac) printf '%s' 'A 0.4-es macOS-alkalmazás csak Apple siliconos Maceken fut (M1 és újabb); ez egy Intel Mac, amelyet a 0.4 nem támogat. Semmi sem lett letöltve.' ;;
    download.linux_no_app) printf '%s' 'Ebben a verzióban nincs asztali alkalmazás Linuxra: használd az install.sh-t. Semmi sem lett letöltve.' ;;
    download.mismatch_existing) printf '%s' 'a(z) %s fájl létezik, de az SHA-256-ja nem egyezik: nem írtam felül.' ;;
    download.mkdir_failed) printf '%s' 'nem tudom létrehozni a célmappát: %s' ;;
    download.no_curl) printf '%s' 'a curl nem található: kell a kiadás letöltéséhez.' ;;
    download.no_tmp) printf '%s' 'nem sikerült létrehozni az ideiglenes mappát' ;;
    download.parent_unreachable) printf '%s' 'a célmappa nem érhető el: %s' ;;
    download.present_verified) printf '%s' 'A fájl már megvan és ellenőrizve: %s' ;;
    download.release_no_app) printf '%s' 'Ehhez a kiadáshoz (v%s) nincs macOS-alkalmazás: használd a 0.4.0-s vagy újabb verziót. Semmi sem lett letöltve.' ;;
    download.saved_in) printf '%s' 'Mentve ide: %s' ;;
    download.sha_verified) printf '%s' 'SHA-256 ellenőrizve: %s' ;;
    download.shared_folder) printf '%s' 'a célhely egy, a csapattal megosztott mappában van (%s): válassz azon kívüli helyet, például a ~/Downloads mappát.' ;;
    download.sum_missing) printf '%s' 'nincs megadott SHA-256 ehhez: %s.' ;;
    download.sums_failed) printf '%s' 'sikertelen letöltés: a v%s SHA256SUMS fájlja' ;;
    download.unsupported_os) printf '%s' 'nem támogatott rendszer: %s. Használd a windows vagy a macos értéket.' ;;
    download.windows_missing) printf '%s' 'A Windows nem része a 0.4.0-nak: a kiadásban nincs Windows-telepítő. Semmi sem lett letöltve.' ;;
    help.download) printf '%s' 'használat: jht download --os windows|macos --version X.Y.Z [--output FILE]
  Az asztali alkalmazás nem része a 0.4.0-nak: egy olyan kiadásnál, amelyben benne van, letölti, ellenőrzi az SHA-256-ját, és elmenti (alapból a ~/Downloads-ba).' ;;
    help.integration) printf '%s' 'Használat: jht integration <parancs>

  list [--json]                   az integrációk és az állapotuk
  status [ID] [--json]            egynek vagy mindnek az állapota
  add ID [--json]                 hozzáad egy integrációt
  remove ID [--purge --yes] [--remove-image] [--json]
                                  eltávolítja; a --purge az adatait is törli (--yes kell hozzá);
                                  a --remove-image (csak screen és media) az eszközök képét is eltávolítja

Az engedélyezett ID-k azok, amelyeket a `jht integration list` mutat. Semmi sem töltődik le és nem
kapcsol be, amíg az `add` paranccsal nem kéred.' ;;
    help.linkedin) printf '%s' 'Használat: jht linkedin <parancs>

  login [--stop]    kézi bejelentkezés a LinkedInre (Google-lel): böngésző egy külön, hálózat nélküli
                    konténerben, amelynek ablakát az alkalmazásból látod és használod; a --stop mindent bezár
  status --json     megmondja, folyamatban van-e a bejelentkezés, és el van-e mentve
                    a LinkedIn-munkamenet

Semmi sem töltődik le és nem kapcsol be, amíg a `login` paranccsal nem kéred.' ;;
    help.main) printf '%s' 'jht — Job Hunter Team

  Gazdagép-parancsok (innen működnek):
    jht up                 elindítja a csapat konténerét
    jht down               leállítja
                           (a --verbose kapcsolóval a motor sorai is látszanak)
    jht restart            újraindítja
    jht status             a konténer és a csapat állapota
    jht logs [-f]          a konténer naplója
    jht upgrade            frissít a legújabb képre
    jht clean-images [--json]
                           eltávolítja a régi JHT-képeket (megtartja a jelenlegit, a többi
                           közül a legújabbat és a használatban lévőket); majdnem tele
                           lemeznél is engedélyezett
    jht setup              irányított telepítés
    jht shell              shell a konténeren belül
    jht profile import FILE [--replace]
                           átadja a csapatnak a jelölt profilját (YAML)
    jht profile validate [FILE] [--strict] [--json]
                           ellenőriz egy profilt (YAML), és semmit sem ír;
                           FILE nélkül a csapatét
    jht mail setup         elmenti a postafiókot a titokbrokerbe
    jht mail drafts        az ügynökök által írt e-mailek, amelyek a jóváhagyásodra várnak
    jht mail approve <id>  elküldi őket; a jht mail discard <id> elveti őket
    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]
                           a beállítás után hozzáadható integrációk
                           (google, telegram, mail): az állapotot a motorból olvassa
    jht telegram status    az elkülönített Telegram-szolgáltatás állapota
    jht telegram pair ROLE kijelzés nélkül kéri a tokent a gazdagépen, majd
                           mutat egy kódot, amelyet a Telegramodról küldj el a botnak
                           Automatizáláshoz: JSON a stdin-en. Ne mentsd a tokent
                           a ~/.jht-be; az onnan kívül használt fájlokat azonnal töröld.
    jht telegram pair --all egy menetben párosítja az összes régi szerepet
    jht telegram chat-id ROLE ugyanazzal a kóddal másik chatre költözteti a botot
    jht reset              törli a beállítást és a broker köteteit
    jht migrate-runtime podman
                           átmásolja és ellenőrzi a Docker-köteteket a Podmanbe; nem
                           választja ki az új futtatókörnyezetet, és nem törli a Dockert
    jht podman-machine-recreate --confirm
                           újra létrehozza a Podman-gépet (macOS), amely csak
                           a ~/.jht és a ~/Documents/Job Hunter Team mappát látja
    jht uninstall --confirm eltávolítja a helyi futtatókörnyezetet (a Podman-gépet vagy
                           a jht konténereit és köteteit, a mentett titkokkal);
                           a ~/.jht, a Dokumentumok, a Podman és a Docker megmarad
    jht uninstall --confirm --purge
                           mint fent, és törli a ~/.jht és a
                           ~/Documents/Job Hunter Team mappát is (akkor is, ha a
                           konténer a tulajdonosuk, sudo és jogosultságváltás nélkül)

  Az összes többi parancs (positions, stats, team, providers, cron,
  working-hours, cloud...) a konténeren BELÜL fut: a súgójukhoz
  futó konténer kell.

      jht up && jht --help
' ;;
    help.screen) printf '%s' 'Használat: jht screen <parancs>

  on [--json]       bekapcsolja a closer élő képernyőjét: külön konténer, a stream csak a 127.0.0.1-en
  off [--remove-image] [--json]
                    kikapcsolja és eltávolítja a konténert; az eszközök képe a lemezen marad, hogy újraletöltés
                    nélkül kapcsolhasd vissza: a --remove-image eltávolítja, és felszabadítja a helyet
  status [--json]   megmondja, be van-e kapcsolva

Semmi sem töltődik le és nem kapcsol be, amíg az `on` paranccsal nem kéred. A stream csak megtekinthető.' ;;
    help.setup) printf '%s' 'Használat: jht setup [kapcsolók]

Kapcsolók nélkül az irányított telepítés indul. A --non-interactive kapcsolóval semmit sem kérdez:
mindent kapcsolókkal adsz meg.

  --non-interactive            nincs kérdés
  --provider <name>            glm (Z.ai, alapértelmezett), kimi (Moonshot), openai vagy claude (Anthropic)
  --harness <name>             pi (alapértelmezett)
  --api-key-file <path>        az API-kulcsot tartalmazó fájl (egy sor, csak te olvashatod).
                               A gépeden lévő fájlt a jht olvassa be és adja át a beállításnak: glm és kimi
                               esetén a beállítás magánál tartja a kulcsot, sosem a konfigurációban
  --api-key-stdin              a standard bemenetről olvassa az API-kulcsot (egy sor): sosem a parancssorban
  --api-key <key>              az itt beírt kulcs, nyílt szövegként (glm és kimi esetén nem engedélyezett)
  --secret-mode <mode>         hogyan mentődik a kulcs: plaintext (alapértelmezett), env vagy file
  --secret-env <name>          --secret-mode env esetén: a kulcsot tartalmazó környezeti változó
  --secret-file <path>         --secret-mode file esetén: a kulcsot tartalmazó fájl
  --model <model>              a használandó modell
  --language <code>            a nyelv (például it vagy en)
  --budget-usd <dollár>        mennyit költhet a csapat, dollárban (a --budget-minutes, --budget-days, --budget-until egyikével)
  --budget-minutes <n>         a keret ennyi percig tart mostantól
  --budget-days <n>            a keret ennyi napig tart mostantól
  --budget-until <óra>         a keret a nap eddig az óráig tart, 0-23 (a következő)
  --no-budget                  nincs költési korlát (a csapat csak a szolgáltató egyenlegénél áll meg)
  --skip-health                kihagyja a végső ellenőrzést
  --reset                      tiszta beállításból indul újra

Példák:
  egy fájlban lévő GLM-kulccsal:
    jht setup --non-interactive --provider glm --harness pi --api-key-file kulcs.txt
  OpenAI API-kulccsal, Pi-n (Claude-hoz: --provider claude):
    jht setup --non-interactive --provider openai --harness pi --api-key-stdin' ;;
    help.tools) printf '%s' 'Használat: jht tools <parancs>

  status --json   megvannak-e a felderítők (Scout) eszközei (a teljes kép), úton vannak-e, vagy sikertelen volt a letöltés
  pull            letölti őket a háttérben (a jht up és a jht setup magától elindítja)
  switch          átviszi rájuk a csapatot, amint a bevezetés lezárult (a letöltés magától megteszi)

Ez a súgó semmit nem indít el és semmit nem tölt le.' ;;
    host_setup.skip_done) printf '%s' 'A host.env egy konténer tulajdonában lévő mappában van (uid 1001): a gép előzetes ellenőrzése már megtörtént, kihagyom.' ;;
    host_setup.skip_unknown) printf '%s' 'A host.env egy konténer tulajdonában lévő mappában van (uid 1001), és ez a felhasználó nem írhat bele: kihagyom a gép előzetes ellenőrzését, de a host.env nem olvasható, vagy nem mondja meg a gép típusát (helyi vagy VPS): a típus '\''unknown'\'' marad.' ;;
    keyfile.both) printf '%s' 'a --api-key-file vagy a --api-key-stdin kapcsolót használd, ne mindkettőt' ;;
    keyfile.not_file) printf '%s' 'a --api-key-file kapcsolónak megadott fájlnak közönséges fájlnak kell lennie, nem mappának vagy linknek: %s' ;;
    keyfile.readable) printf '%s' 'a(z) %s fájlt más felhasználók is olvashatják: futtasd rá a chmod 600 parancsot.' ;;
    keyfile.shape) printf '%s' 'a --api-key-file kapcsolónak megadott fájl tartalma nem egyetlen, 16–512 nyomtatható karakterből álló, szóköz nélküli sor: %s' ;;
    keyfile.size) printf '%s' 'a --api-key-file kapcsolónak megadott fájl üres, vagy túl nagy egy kulcshoz (1–4096 bájt): %s' ;;
    keyfile.twice) printf '%s' 'a --api-key-file kapcsolót kétszer adtad meg' ;;
    keyfile.unreadable) printf '%s' 'a --api-key-file kapcsolónak megadott fájl nem olvasható: %s' ;;
    line.abbinamento_annullato_nessuna_modifica) printf '%s' 'Párosítás megszakítva: nincs változás.' ;;
    line.abbinamento_di_s_non_riuscito) printf '%s' '%s párosítása nem sikerült: a régi másolatok mind megmaradnak. Futtasd újra a jht telegram pair --all parancsot: a már párosított szerepek nem kérnek új tokent.' ;;
    line.abbinamento_rifiutato_genera_un_token) printf '%s' 'Párosítás elutasítva: generálj új tokent a BotFatherben (/revoke), és próbáld újra.' ;;
    line.accedi_con_l_utente_jht) printf '%s' 'Jelentkezz be a telepítéskor beállított rootless JHT-felhasználóval, és próbáld újra.' ;;
    line.agent_restart_failed.inventario_conservato_ma_il_team) printf '%s' 'a leltár megmaradt, de a csapat nem indult újra. Teendő: jht up' ;;
    line.allineo_owner_di_s_a) printf '%s' '%s tulajdonosának igazítása erre: %s (eddig uid %s)...' ;;
    line.annullato_niente_autorizzato) printf '%s' 'Megszakítva: semmi sincs engedélyezve.' ;;
    line.anteprima_non_valida_niente_autorizzato) printf '%s' 'Érvénytelen előnézet: semmi sincs engedélyezve.' ;;
    line.apply.authorize) printf '%s' 'Engedélyezed ezt a jelentkezést?' ;;
    line.apply_relink_account_cloud_account) printf '%s' 'apply relink-account: a felhőfiók nem érhető el. Előbb futtasd a jht cloud pair parancsot.' ;;
    line.attenzione_le_cli_interne_verranno) printf '%s' 'FIGYELEM: a belső CLI-k újratelepülnek, és a titkok nem maradnak meg. A levelezés beállításai és állapota megmarad, de újra meg kell adnod a levelezési jelszót, és újra be kell jelentkezned a LinkedInre.' ;;
    line.autorizzata_s_verso_s_il) printf '%s' '#%s engedélyezve, cím: %s: a CLOSER a következő körben veszi át.' ;;
    line.bind_uid_conflict.uid_s_on_this_computer) printf '%s' 'A(z) %s uid ezen a gépen a(z) '\''%s'\'' fiók. A Job Hunter Team konténere a(z) %s uid-dal fut, így az a fiók lenne a ~/.jht tulajdonosa (az adataid és a portálok hitelesítő adatai). Semmi sem változott. Futtasd a JHT-t a(z) '\''%s'\'' fiókból, vagy adj '\''%s'\'' fióknak másik uid-t, majd próbáld újra.' ;;
    line.bot_abbinato_e_copia_legacy) printf '%s' 'A bot párosítva, a régi másolat eltávolítva. Maradtak még régi tokenek, vagy van egy token a konténer környezetében: távolítsd el őket, és fejezd be a cserét az átállás előtt.' ;;
    line.bot_token_invalid.controlla_il_token_generato_da) printf '%s' 'ellenőrizd a BotFather által generált tokent.' ;;
    line.broker_restart_failed.il_servizio_della_posta_non_4) printf '%s' 'a levelezési szolgáltatás nem indult újra. Teendő: jht mail status' ;;
    line.broker_start_failed.il_servizio_della_posta_non_2) printf '%s' 'a levelezési szolgáltatás nem indult el.' ;;
    line.broker_start_failed.il_servizio_della_posta_non_3) printf '%s' 'a levelezési szolgáltatás 30 másodperc után sem válaszol.' ;;
    line.broker_unavailable.il_broker_dei_segreti_esiste) printf '%s' 'a titokbroker létezik, de nem igazolható, hogy a miénk: nem nyúlok hozzá.' ;;
    line.broker_unavailable.il_broker_dei_segreti_non) printf '%s' 'a titokbroker nem fut, vagy nem igazolható.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato) printf '%s' 'a telepített futtatókörnyezet compose fájlja nem olvasható, nem tudni, van-e benne titokbroker.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato_2) printf '%s' 'a telepített futtatókörnyezet compose fájlja nem olvasható, nem tudni, van-e benne titokbroker.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio) printf '%s' 'a telepített futtatókörnyezet régebbi, és nincs benne titokbroker.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio_2) printf '%s' 'a telepített futtatókörnyezet régebbi, és nincs benne titokbroker.' ;;
    line.broker_unavailable.il_servizio_della_posta_non) printf '%s' 'a levelezési szolgáltatás még nem létezik: az első alkalommal jön létre, amikor szükség van rá.' ;;
    line.cancellato_marcatore_migrazione_broker_s) printf '%s' 'Törölve: a broker migrációs jelölője, %s' ;;
    line.cancellato_volume_broker_s_s) printf '%s' 'Törölve: %s brokerkötet (%s)' ;;
    line.chown_fallito_su_s) printf '%s' 'a chown nem sikerült itt: %s' ;;
    line.client_container_non_trovato_nel) printf '%s' 'a konténerkliens nem található a PATH-ban. Javítsd meg a JHT futtatókörnyezetét.' ;;
    line.client_container_non_trovato_nel_2) printf '%s' 'a konténerkliens nem található a PATH-ban. Javítsd meg a JHT futtatókörnyezetét.' ;;
    line.compose_extra_file_non_e) printf '%s' 'A COMPOSE_EXTRA_FILE nem a hozzáférés seccomp-overlay fájlja: nem csinálok semmit.' ;;
    line.compose_up_failed.podman_compose_up_e_uscito) printf '%s' 'A podman-compose up ezzel a kóddal lépett ki: %s. A Podman hibája fent látható.' ;;
    line.compose_up_timeout.podman_compose_up_non_ha) printf '%s' 'A podman-compose up nem fejeződött be %s másodperc alatt, ezért leállítottam. Egy szolgáltatás nem indult el: nézd meg a „podman ps -a” és a „podman logs jht” kimenetét.' ;;
    line.container_jht_non_verificabile_dopo) printf '%s' 'A JHT-konténer a művelet után nem ellenőrizhető.' ;;
    line.container_s_non_attivo_leggere) printf '%s' 'a(z) '\''%s'\'' konténer nem fut: a terv beolvasása nem indítja el. Indítsd el a '\''jht up'\'' paranccsal, és próbáld újra.' ;;
    line.container_s_non_e_partito) printf '%s' 'A(z) '\''%s'\'' konténer nem indult el 10 másodpercen belül. Nézd meg: '\''jht logs'\''.' ;;
    line.cosa_fare_jht_mail_setup) printf '%s' 'Teendő: jht mail setup' ;;
    line.cosa_fare_jht_up) printf '%s' 'Teendő: jht up' ;;
    line.cosa_fare_jht_up_2) printf '%s' 'Teendő: jht up' ;;
    line.cosa_fare_jht_up_3) printf '%s' 'Teendő: jht up' ;;
    line.cosa_fare_jht_upgrade) printf '%s' 'Teendő: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_2) printf '%s' 'Teendő: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_3) printf '%s' 'Teendő: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_4) printf '%s' 'Teendő: jht upgrade' ;;
    line.cosa_fare_reinstalla_il_runtime) printf '%s' 'Teendő: telepítsd újra a futtatókörnyezetet a telepítővel' ;;
    line.cosa_fare_reinstalla_il_runtime_2) printf '%s' 'Teendő: telepítsd újra a futtatókörnyezetet a telepítővel' ;;
    line.cosa_fare_reinstalla_il_runtime_3) printf '%s' 'Teendő: telepítsd újra a futtatókörnyezetet a telepítővel' ;;
    line.cosa_fare_reinstalla_il_runtime_4) printf '%s' 'Teendő: telepítsd újra a futtatókörnyezetet a telepítővel' ;;
    line.cosa_fare_riprova_il_comando) printf '%s' 'Teendő: próbáld újra a parancsot' ;;
    line.cosa_fare_riprova_il_comando_2) printf '%s' 'Teendő: próbáld újra a parancsot' ;;
    line.data_dir_moved.jht_home_host_s_non) printf '%s' 'JHT_HOME_HOST=%s nem egyezik ezzel: %s. A csapat mindig ezt használja: %s: a compose ezt csatolja, az alkalmazás ezt olvassa, és macOS-en ez az egyetlen adatmappa, amelyet a Podman-gép lát. Töröld a JHT_HOME_HOST változót, vagy helyezd át az adatokat ide: %s.' ;;
    line.data_dir_moved.jht_user_dir_host_s) printf '%s' 'JHT_USER_DIR_HOST=%s nem egyezik ezzel: %s. A csapat mindig ezt használja: %s: a compose ezt csatolja, és macOS-en ez az egyetlen dokumentummappa, amelyet a Podman-gép lát. Töröld a JHT_USER_DIR_HOST változót, vagy helyezd át a dokumentumokat ide: %s.' ;;
    line.disk_low.gli_agenti_richiedono_almeno_disk) printf '%s' 'Az ügynököknek legalább %s GiB lemezterület kell — szabad: %s GiB. Hely felszabadításához futtasd a '\''jht clean-images'\'' parancsot (csak a Job Hunter Team régi verzióit törli), ürítsd ki a Kukát, és töröld a nagy fájlokat, amelyekre nincs szükséged, majd próbáld újra: semmi nem lett letöltve vagy módosítva.' ;;
    line.docker_punta_a_s_che) printf '%s' 'A Docker ide mutat: %s, ami nem ez a gép: az ottani jht konténerekhez és kötetekhez nem nyúlok. Állítsd vissza a Dockert a helyire (DOCKER_HOST vagy docker context), és futtasd újra.' ;;
    line.fermo_e_ricreo_la_macchina) printf '%s' 'Leállítom és újra létrehozom a(z) '\''%s'\'' Podman-gépet...' ;;
    line.fino_ad_allora_la_posta) printf '%s' 'Addig a leveleket a mostani jelszóval lehet olvasni és küldeni; a figyelmeztetés a jht mail status kimenetében marad.' ;;
    line.genera_una_nuova_password_per) printf '%s' 'generálj új alkalmazásjelszót a szolgáltatódnál, és mentsd el ezzel: jht mail setup' ;;
    line.host_setup_sh_non_trovato) printf '%s' 'a host-setup.sh nem található itt: %s — a gép előzetes ellenőrzését kihagyom' ;;
    line.host_setup_sh_terminato_con) printf '%s' 'a host-setup.sh hibával állt le — folytatom' ;;
    line.i_segreti_e_lo_stato) printf '%s' 'A titkok és a broker állapota törölve: jelentkezz be újra a portálokra, és állítsd be újra a levelezést.' ;;
    line.identita_progetto_compose_non_valida) printf '%s' 'Érvénytelen Compose-projektazonosító.' ;;
    line.il_broker_non_ha_registrato) printf '%s' 'A broker nem rögzítette az engedélyt: visszavonva, semmi sem indul el.' ;;
    line.il_compose_non_indica_una) printf '%s' 'A compose nem ad meg egyetlen közös képet a csapatnak és a brokernek; a megőrzés megtagadva.' ;;
    line.il_container_s_non_c) printf '%s' 'a(z) '\''%s'\'' konténer nincs meg, de a projekt más szolgáltatásai futnak: leállítom őket.' ;;
    line.il_documento_deve_essere_un) printf '%s' 'a dokumentumnak közönséges fájlnak kell lennie, nem linknek: %s' ;;
    line.il_documento_supera_i_mb) printf '%s' 'a dokumentum nagyobb 10 MB-nál' ;;
    line.il_file_del_profilo_supera) printf '%s' 'a profilfájl nagyobb 64 KiB-nál' ;;
    line.il_motore_dei_container_non) printf '%s' 'A konténermotor nem fut: semmi sem lett eltávolítva.' ;;
    line.il_profilo_deve_essere_un) printf '%s' 'a profilnak közönséges fájlnak kell lennie, nem linknek: %s' ;;
    line.il_progetto_ha_container_che) printf '%s' 'A projektnek vannak olyan konténerei, amelyek se nem a csapat, se nem annak igazolt szolgáltatásai: nem nyúlok hozzájuk.' ;;
    line.il_runtime_podman_rootless_locale) printf '%s' 'A helyi rootless Podman futtatókörnyezet nem válaszol.' ;;
    line.il_servizio_s_del_progetto) printf '%s' 'A projekt '\''%s'\'' szolgáltatása fut, de nem igazolható, hogy a miénk: nem nyúlok hozzá, és mást sem állítok le.' ;;
    line.input_interrotto.token_non_letto) printf '%s' 'a token nem lett beolvasva.' ;;
    line.integration.install_hint) printf '%s' 'a telepítésükhöz: '\''jht upgrade'\'' (vagy egy '\''jht integration add <id>'\'')' ;;
    line.integration.not_installed) printf '%s' 'nincs telepítve' ;;
    line.integration.not_installed_yet) printf '%s' 'még nincs telepítve' ;;
    line.interattivo_il_token_viene_chiesto) printf '%s' 'Interaktív: a tokent kijelzés nélkül kéri, majd az új bot egyszer használatos kódot kap a Telegramodról. Automatizáláshoz: {"bot_token": ...} JSON-ként a stdin-en; ne mentsd a tokent a ~/.jht mappába, és azonnal töröld az azon kívül használt fájlokat.' ;;
    line.jht_home_host_o_jht) printf '%s' 'A JHT_HOME_HOST vagy a JHT_USER_DIR_HOST máshová mutat: nem törlök olyan mappákat, amelyek nem a JHT rögzített mappái.' ;;
    line.jht_telegram_pair_all_interattivo) printf '%s' 'a jht telegram pair --all interaktív: automatizáláshoz egyszerre egy szerepet párosíts.' ;;
    line.job_hunter_team_non_ancora) printf '%s' 'A Job Hunter Team még nem indult el: futtasd a '\''jht up'\'' parancsot (az első alkalommal a '\''jht setup'\'' parancsot).' ;;
    line.job_hunter_team_non_installato) printf '%s' 'A Job Hunter Team nincs teljesen telepítve: a futtatókörnyezet mappájából hiányzik az integritásfájl (megszakadt telepítés?). Futtasd újra a telepítőt.' ;;
    line.l_overlay_seccomp_dell_accesso) printf '%s' 'A hozzáférés seccomp-overlay fájlja nem közönséges fájl.' ;;
    line.la_casella_di_posta_ora) printf '%s' 'A postafiók most a titokbrokerben van. A jelszavát az ügynökök olvasni tudták:' ;;
    line.la_connessione_podman_jht_non) printf '%s' 'A JHT Podman-kapcsolata nem támogatja a Compose-diszpécsert.' ;;
    line.la_macchina_e_pronta_ma) printf '%s' 'A gép kész, de nem tudtam bekapcsolni a lemez heti trimelését.' ;;
    line.la_macchina_e_stata_ricreata) printf '%s' 'A gép újra létrejött, de a broker állapota nem ment át az ellenőrzésen/importáláson.' ;;
    line.la_macchina_podman_s_vede) printf '%s' 'A(z) '\''%s'\'' Podman-gép több Maces mappát lát, mint amennyi a JHT-nak kell (~/.jht és ~/Documents/Job Hunter Team).' ;;
    line.la_nuova_macchina_podman_s) printf '%s' 'Az új '\''%s'\'' Podman-gép nem jött létre.' ;;
    line.legacy_cleanup_failed.i_token_nuovi_sono_al) printf '%s' 'az új tokenek biztonságban vannak, de %s régi másolata még a ~/.jht mappában van; az átállás megtagadva.' ;;
    line.legacy_cleanup_failed.il_nuovo_token_al_sicuro) printf '%s' 'az új token biztonságban van, de a régi még a ~/.jht mappában van; az átállás megtagadva.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch) printf '%s' 'a csapat leállítva marad, mert a gépen lévő Telegram-leltár nem maradt meg.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_2) printf '%s' 'a csapat leállítva marad, mert a gépen lévő Telegram-leltár nem maradt meg.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_3) printf '%s' 'a csapat leállítva marad, mert a gépen lévő Telegram-leltár nem maradt meg.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_4) printf '%s' 'a csapat leállítva marad, mert a gépen lévő Telegram-leltár nem maradt meg.' ;;
    line.legacy_inventory_failed.le_impronte_non_sono_state) printf '%s' 'az ujjlenyomatokat az elkülönített szolgáltatás nem őrizte meg.' ;;
    line.legacy_inventory_failed.lo_stato_del_container_agenti) printf '%s' 'az ügynökök konténerének állapota nem igazolható.' ;;
    line.legacy_inventory_failed.migrazione_telegram_interrotta) printf '%s' 'a Telegram-migráció megszakadt.' ;;
    line.legacy_inventory_failed.non_posso_provare_che_jht) printf '%s' 'nem tudom bizonyítani, hogy a ~/.jht nem tartalmaz Telegram-tokent.' ;;
    line.legacy_inventory_failed.non_riesco_a_fermare_gli) printf '%s' 'nem tudom leállítani az ügynököket a gépen lévő leltár előtt.' ;;
    line.legacy_inventory_failed.non_riesco_a_leggere_i) printf '%s' 'nem tudom beolvasni a régi tokeneket a ~/.jht mappában.' ;;
    line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti) printf '%s' 'ismeretlen régi szerepek.' ;;
    line.legacy_inventory_invalid.migrazione_telegram_interrotta_2) printf '%s' 'a Telegram-migráció megszakadt.' ;;
    line.legacy_migration_failed.s_resta_in_jht_credentials) printf '%s' '%s a ~/.jht/credentials mappában marad (a broker válasza: %s).' ;;
    line.legacy_remove_failed.s_nel_broker_ma_la) printf '%s' '%s a brokerben van, de a ~/.jht/credentials mappában lévő másolat megmaradt.' ;;
    line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso) printf '%s' 'a ~/.jht/credentials/%s.json a migráció után újra megjelent; importálás nélkül eltávolítottam.' ;;
    line.macchina_podman_ricreata_vede_solo) printf '%s' 'A Podman-gép újra létrejött: csak a ~/.jht és a ~/Documents/Job Hunter Team mappát látja. A broker állapota megmaradt; a szolgáltatók CLI-jei maguktól újratelepülnek az első '\''jht up'\'' alkalmával (kb. egy perc, hálózat kell: a '\''jht providers versions'\'' megerősíti, a '\''jht providers update'\'' kézzel visszarakja őket). Indítsd el a csapatot a '\''jht up'\'' paranccsal, add meg újra a levelezési jelszót, és jelentkezz be újra a LinkedInre.' ;;
    line.mail.address_prompt) printf '%s' 'A postafiók címe:' ;;
    line.mail.app_password_prompt) printf '%s' 'Alkalmazásjelszó (nem jelenik meg):' ;;
    line.mail.dedicated_prompt) printf '%s' 'Ez a postafiók KIZÁRÓLAG a továbbított állásértesítőknek szól?' ;;
    line.mail_setup_opzione_sconosciuta_s) printf '%s' 'mail setup: ismeretlen kapcsoló: %s' ;;
    line.mail_setup_password_vuota) printf '%s' 'mail setup: üres jelszó' ;;
    line.migrazione_docker_podman_gia_verificata) printf '%s' 'A Docker -> Podman migráció már ellenőrizve; a Docker-kötetek érintetlenek maradnak, és még tartalmazzák a levelezési jelszavakat, a portálok hozzáféréseit és a Telegram-tokeneket.' ;;
    line.migrazione_docker_podman_verificata_i) printf '%s' 'A Docker -> Podman migráció ellenőrizve. A Docker-kötetek nem lettek eltávolítva, és még tartalmazzák a levelezési jelszavakat, a portálok hozzáféréseit és a Telegram-tokeneket: csak a jövőbeli takarító parancsban, kifejezett megerősítéssel töröld őket.' ;;
    line.mount_repair_failed.s_non_si_puo_rendere) printf '%s' '%s nem tehető írhatóvá a konténer számára (uid %s-ként fut), és semmi sem indult el. Futtasd egyszer: sudo chown -R %s %s, majd futtasd újra a '\''jht up'\'' parancsot.' ;;
    line.nessun_provider_attivo_scegline_uno) printf '%s' 'nincs aktív szolgáltató: válassz egyet a '\''jht providers use glm'\'' paranccsal' ;;
    line.nessun_ruolo_ha_un_token) printf '%s' 'Egyik szerepnek sincs régi tokenje: új bothoz használd a jht telegram pair <szerep> parancsot.' ;;
    line.niente_da_fermare_nessun_container) printf '%s' 'nincs mit leállítani: a projektnek nincs konténere.' ;;
    line.no_answer) printf '%s' 'nincs válasz' ;;
    line.no_answer_from_container) printf '%s' 'nincs válasz a konténertől' ;;
    line.non_autorizzabile_s) printf '%s' 'Nem engedélyezhető: %s.' ;;
    line.non_autorizzata_s) printf '%s' 'Nincs engedélyezve: %s.' ;;
    line.non_ho_potuto_rimettere_s) printf '%s' 'Nem tudtam visszaállítani a(z) '\''%s'\'' kapcsolatot alapértelmezett Podman-kapcsolatnak.' ;;
    line.non_ho_potuto_rimuovere_il) printf '%s' 'Nem tudtam eltávolítani a broker migrációs jelölőjét: %s' ;;
    line.non_riesco_a_creare_jht) printf '%s' 'Nem tudom létrehozni a ~/.jht vagy a ~/Documents/Job Hunter Team mappát a Podman-géphez.' ;;
    line.non_riesco_a_creare_jht_2) printf '%s' 'Nem tudom létrehozni a ~/.jht vagy a ~/Documents/Job Hunter Team mappát a Podman-géphez.' ;;
    line.non_riesco_a_determinare_l) printf '%s' 'Nem tudom meghatározni a broker igazolt képét: a futtatókörnyezet compose-a nem válaszolt.' ;;
    line.non_riesco_a_esportare_in) printf '%s' 'Nem tudom ellenőrizhető módon exportálni a broker állapotát; a gép nem lett törölve.' ;;
    line.non_riesco_a_fermare_i) printf '%s' 'Nem tudom leállítani a szolgáltatásokat a broker állapotának mentése előtt.' ;;
    line.non_riesco_a_leggere_il) printf '%s' 'nem tudom beolvasni a dokumentumot: %s' ;;
    line.non_riesco_a_rimuovere_i) printf '%s' 'Nem tudom eltávolítani a korábbi verzió leállított konténereit: „jht down”, majd „jht up”.' ;;
    line.non_riesco_a_rimuovere_la) printf '%s' 'Nem tudom eltávolítani a(z) '\''%s'\'' Podman-gépet.' ;;
    line.non_riesco_a_sapere_a) printf '%s' 'Nem tudom megállapítani, melyik Dockerrel beszél ez a gép: a jht konténereihez és köteteihez nem nyúlok.' ;;
    line.non_riesco_a_verificare_quali) printf '%s' 'Nem tudom ellenőrizni, mely Maces mappákat látja a(z) '\''%s'\'' Podman-gép.' ;;
    line.non_sono_riuscito_a_cancellare) printf '%s' 'Nem sikerült törölni: %s (egy másik felhasználóé, például a konténeré, és a szervizkonténer nem érhető el).' ;;
    line.opzione_di_clean_images_non) printf '%s' 'Nem támogatott clean-images kapcsoló: %s (használat: jht clean-images [--json])' ;;
    line.opzione_non_riconosciuta_s) printf '%s' 'ismeretlen kapcsoló: %s' ;;
    line.opzione_non_riconosciuta_s_2) printf '%s' 'ismeretlen kapcsoló: %s' ;;
    line.opzione_non_riconosciuta_s_3) printf '%s' 'ismeretlen kapcsoló: %s' ;;
    line.os_and_version_are_required) printf '%s' 'a --os és a --version kötelező' ;;
    line.override_compose_per_podman_rootless) printf '%s' 'A rootless Podmanhez tartozó Compose-felülírás nem írható ide: %s.' ;;
    line.per_l_aiuto_di_s) printf '%s' 'A(z) '\''%s'\'' súgójához futó konténer kell: '\''jht up'\''.' ;;
    line.per_procedere_jht_podman_machine) printf '%s' 'A folytatáshoz: jht podman-machine-recreate --confirm' ;;
    line.pin_dell_immagine_degli_strumenti) printf '%s' 'az eszközök képének rögzítése (pin) nem megbízható' ;;
    line.podman_compose_non_trovato_installa) printf '%s' 'A podman-compose nem található: telepítsd a „podman-compose” csomagot (Ubuntun: sudo apt install podman-compose).' ;;
    line.podman_machine_avviata_ma_il) printf '%s' 'A Podman-gép elindult, de a JHT-kliens nem válaszol.' ;;
    line.podman_machine_jht_non_attiva) printf '%s' 'A JHT Podman-gépe nem fut. Futtasd a '\''jht up'\'' parancsot az elindításához.' ;;
    line.podman_machine_non_avviabile) printf '%s' 'A Podman-gép nem indítható el.' ;;
    line.podman_machine_s_non_attiva) printf '%s' 'A(z) '\''%s'\'' Podman-gép nem fut, elindítom...' ;;
    line.podman_non_trovato_reinstalla_il) printf '%s' 'A Podman nem található: telepítsd újra a JHT futtatókörnyezetét.' ;;
    line.podman_non_trovato_reinstalla_il_2) printf '%s' 'A Podman nem található: telepítsd újra a JHT futtatókörnyezetét.' ;;
    line.podman_non_trovato_reinstalla_il_3) printf '%s' 'A Podman nem található: telepítsd újra a JHT futtatókörnyezetét.' ;;
    line.podman_other_machine_running.named) printf '%s' 'egy másik Podman-gép, a(z) %s, fut: állítsd le a '\''podman machine stop %s'\'' paranccsal, és próbáld újra.' ;;
    line.podman_other_machine_running.unnamed) printf '%s' 'egy másik Podman-gép fut: keresd meg a '\''podman machine list'\'' paranccsal, állítsd le a '\''podman machine stop <név>'\'' paranccsal, és próbáld újra.' ;;
    line.podman_remote_service_refused.su_linux_jht_usa_solo) printf '%s' 'Linuxon a JHT csak ennek a felhasználónak a helyi Podmanjét használja, de a podman kliens egy távoli szolgáltatással beszél.' ;;
    line.podman_rootful_refused.jht_su_linux_richiede_podman) printf '%s' 'Linuxon a JHT-hoz rootless Podman kell, nem root felhasználóval futtatva.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non) printf '%s' 'a rootless Podman futtatókörnyezet nem válaszol.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non_2) printf '%s' 'a rootless Podman futtatókörnyezet nem válaszol.' ;;
    line.preparo_il_servizio_della_posta) printf '%s' 'Előkészítem a levelezési szolgáltatást (csak az első alkalommal jön létre, amikor szükség van rá)…' ;;
    line.provider_attivo_non_riconosciuto_s) printf '%s' 'ismeretlen aktív szolgáltató: %s' ;;
    line.provider_podman_compose_non_trovato) printf '%s' 'A Podman Compose szolgáltató nem található: telepítsd újra a JHT futtatókörnyezetét.' ;;
    line.questo_runtime_non_usa_una) printf '%s' 'Ez a futtatókörnyezet nem használ Podman-gépet: nincs mit újra létrehozni.' ;;
    line.reset_impossibile_cancellare_il_marcatore) printf '%s' 'reset: nem lehet törölni a broker migrációs jelölőjét: %s.' ;;
    line.reset_impossibile_cancellare_il_marcatore_2) printf '%s' 'reset: nem lehet törölni a broker jelölőjét: %s.' ;;
    line.reset_impossibile_cancellare_il_volume) printf '%s' 'reset: nem lehet törölni a(z) %s brokerkötetet (%s).' ;;
    line.reset_nome_volume_non_valido) printf '%s' 'reset: érvénytelen kötetnév ehhez: %s; az eltávolítás megtagadva.' ;;
    line.reset_non_riesco_a_determinare) printf '%s' 'reset: nem tudom meghatározni a Compose-projektet; a broker köteteihez nem nyúltam.' ;;
    line.reset_non_riesco_a_fermare) printf '%s' 'reset: nem tudom leállítani a futtatókörnyezetet; a broker köteteihez nem nyúltam.' ;;
    line.reset_ricerca_del_volume_s) printf '%s' 'reset: a(z) %s kötet keresése nem sikerült.' ;;
    line.reset_ricerca_del_volume_s_2) printf '%s' 'reset: a(z) %s kötet keresése nem sikerült.' ;;
    line.restano_token_legacy_per_s) printf '%s' 'Régi tokenek maradtak ezekhez: %s. Amíg ezeket a szerepeket is nem párosítod, %s néma marad a Telegramon: párosítsd mindet ebben a menetben (jht telegram pair --all).' ;;
    line.ricrea_la_macchina_podman_s) printf '%s' 'A(z) '\''%s'\'' Podman-gép újra létrehozása: leállítja és törli, majd újra létrehozza úgy, hogy csak a ~/.jht és a ~/Documents/Job Hunter Team mappát lássa.' ;;
    line.ricreala_con_jht_podman_machine) printf '%s' 'Hozd létre újra a '\''jht podman-machine-recreate --confirm'\'' paranccsal: a fájlok és a broker állapota megmaradnak, de a belső CLI-k és a titkok törlődnek.' ;;
    line.risposta_del_container_non_valida) printf '%s' 'Érvénytelen válasz a konténertől: az engedély visszavonva, semmi sem indul el.' ;;
    line.ritirata_s_non_verra_inviata) printf '%s' '#%s visszavonva: nem lesz elküldve.' ;;
    line.ritiro_non_riuscito_s) printf '%s' 'A visszavonás nem sikerült: %s.' ;;
    line.runtime_host_non_attendibile_path) printf '%s' 'a gépen futó futtatókörnyezet nem megbízható (útvonal, tulajdonos, jogosultságok vagy SHA-256)' ;;
    line.runtime_host_protetto_non_installabile) printf '%s' 'a védett gépen futó futtatókörnyezet nem telepíthető; a régi ~/.jht/runtime nincs használatban' ;;
    line.runtime_migration_changed.checksum_diverso_per_s_dopo) printf '%s' 'eltérő ellenőrzőösszeg ennél: %s a migráció után.' ;;
    line.runtime_migration_changed.s_non_corrisponde_piu_al) printf '%s' '%s már nem egyezik az ellenőrzött jelölővel.' ;;
    line.runtime_migration_checksum_mismatch.s_non_ha_superato_la) printf '%s' '%s nem ment át az ellenőrzésen.' ;;
    line.runtime_migration_docker_missing.il_client_docker_originale_non) printf '%s' 'az eredeti Docker-kliens nem érhető el.' ;;
    line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata) printf '%s' 'digest alapján rögzített JHT-kép kell.' ;;
    line.runtime_migration_image_missing.la_stessa_immagine_jht_deve) printf '%s' 'ugyanannak a JHT-képnek léteznie kell a Dockerben és a Podmanben is.' ;;
    line.runtime_migration_interrupted.copia_incompleta_di_s_il) printf '%s' '%s másolata hiányos; a Docker-forrás érintetlen.' ;;
    line.runtime_migration_podman_missing.podman_non_e_disponibile) printf '%s' 'a Podman nem érhető el.' ;;
    line.runtime_migration_source_missing.s_manca_in_docker_ma) printf '%s' '%s hiányzik a Dockerből, de létezik a Podmanben; nem írom felül.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_docker) printf '%s' 'előbb állítsd le a Docker-csapatot.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_podman) printf '%s' 'előbb állítsd le a Podman-csapatot.' ;;
    line.runtime_o_container_jht_non) printf '%s' 'a JHT futtatókörnyezete vagy konténere nem érhető el' ;;
    line.ruoli_da_abbinare_in_questa) printf '%s' 'Ebben a menetben párosítandó szerepek: %s' ;;
    line.s_e_un_collegamento_non) printf '%s' '%s egy link: nem követem és nem törlöm.' ;;
    line.s_ha_gi_un_bot) printf '%s' '%s: már van párosított bot: csak a régi másolatát távolítom el.' ;;
    line.s_needs_a_value) printf '%s' '%s: érték kell hozzá' ;;
    line.s_non_e_una_cartella) printf '%s' '%s nem mappa: nem törlöm.' ;;
    line.saltato_non_trovato_volume_broker) printf '%s' 'Kihagyva (nem található): %s brokerkötet' ;;
    line.script_s_non_ancora_installato) printf '%s' 'a(z) %s szkript még nincs telepítve: '\''jht upgrade'\'' (vagy egy '\''jht integration add/remove'\''), majd próbáld újra' ;;
    line.script_s_non_scaricabile_controlla) printf '%s' 'a(z) %s szkript nem tölthető le: ellenőrizd a hálózatot, vagy futtasd a '\''jht upgrade'\'' parancsot' ;;
    line.serve_un_terminale_l_autorizzazione) printf '%s' 'Terminál kell: az engedélyt kézzel kell megerősíteni.' ;;
    line.status.caller_env) printf '%s' 'Ennek a terminálnak a környezetében be vannak állítva: %s. A konténer nélkülük jött létre: töröld a változót (unset), és próbáld újra.' ;;
    line.status.provider_said) printf '%s' 'A szolgáltató ezt mondta: %s' ;;
    line.status.unattestable) printf '%s' 'a(z) '\''%s'\'' konténer nem igazolható: valamit nem sikerül ellenőrizni (a vártól eltérő beállítást, vagy a motor nem válaszol); ez nem jelenti azt, hogy nem fut.' ;;
    line.sudo_chown_fallito_su_s) printf '%s' 'a sudo chown nem sikerült itt: %s (lehet, hogy '\''sudo %s up'\'' kell)' ;;
    line.telegram_isolato_attivo_il_bridge) printf '%s' 'Az elkülönített Telegram aktív; a régi bridge-et az ügynökök már nem kapcsolhatják vissza.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_3) printf '%s' 'a telepített futtatókörnyezet compose fájlja nem olvasható, nem tudni, van-e benne elkülönített Telegram-szolgáltatás.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_4) printf '%s' 'a telepített futtatókörnyezet compose fájlja nem olvasható, nem tudni, van-e benne elkülönített Telegram-szolgáltatás.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_3) printf '%s' 'a telepített futtatókörnyezet régebbi, és nincs benne elkülönített Telegram-szolgáltatás.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_4) printf '%s' 'a telepített futtatókörnyezet régebbi, és nincs benne elkülönített Telegram-szolgáltatás.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non) printf '%s' 'az elkülönített Telegram-szolgáltatás nem fut, vagy nem igazolható.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non_2) printf '%s' 'az elkülönített Telegram-szolgáltatás nem fut, vagy nem igazolható.' ;;
    line.the_setup_keeps_the_key) printf '%s' 'A beállítás megőrzi a kulcsot: most már törölheted a fájlt erről a gépről (%s).' ;;
    line.togli_remote_true_da_containers) printf '%s' 'Töröld a remote = true sort a containers.conf fájlból (vagy a CONTAINERS_CONF-ból) ennél a felhasználónál, és próbáld újra.' ;;
    line.unattestable.autostart) printf '%s' 'A meglévő JHT-konténerről nem igazolható, hogy a miénk; az automatikus indítás megtagadva.' ;;
    line.unattestable.existing) printf '%s' 'A meglévő JHT-konténerről nem igazolható, hogy a miénk; a művelet leállt.' ;;
    line.unattestable.logs) printf '%s' 'A JHT-konténerről nem igazolható, hogy a miénk; a naplók olvasása megtagadva.' ;;
    line.unattestable.other) printf '%s' 'A JHT-konténerről nem igazolható, hogy a miénk; a művelet megtagadva.' ;;
    line.unattestable.recreate) printf '%s' 'A JHT-konténerről nem igazolható, hogy a miénk; az újralétrehozás megtagadva.' ;;
    line.unattestable.restart) printf '%s' 'A JHT-konténerről nem igazolható, hogy a miénk; az újraindítás megtagadva.' ;;
    line.unattestable.stop) printf '%s' 'A JHT-konténerről nem igazolható, hogy a miénk; a leállítás megtagadva.' ;;
    line.unknown_argument_s) printf '%s' 'ismeretlen argumentum: %s' ;;
    line.upgrade.activate) printf '%s' 'Aktiválom az új futtatókörnyezetet...' ;;
    line.upgrade.broker_restart_failed) printf '%s' 'a titokbroker nem indult újra. Teendő: jht up' ;;
    line.upgrade.check_available) printf '%s' 'Ellenőrzés: van frissítés, %s (%s) -> %s. %s. Az alkalmazásához: jht upgrade' ;;
    line.upgrade.check_none) printf '%s' 'Ellenőrzés: nincs frissítés, a(z) %s (%s) már a legújabb. %s.' ;;
    line.upgrade.check_only) printf '%s' 'Ellenőrzés: %s.' ;;
    line.upgrade.disk_room) printf '%s' 'A frissítés körülbelül %s GiB-ot tölt le, és a letöltés után az ügynököknek kevesebb maradna a szükséges %s GiB lemezterületnél: most %s GiB szabad. Szabadíts fel még legalább %s GiB-ot (ürítsd ki a Kukát, töröld a nagy fájlokat, amelyekre nincs szükséged), majd próbáld újra: semmi nem lett letöltve vagy módosítva (csak a Job Hunter Team semmi által nem használt régi verziói lettek törölve).' ;;
    line.upgrade.done) printf '%s' 'A frissítés kész: %s (%s) -> %s (%s). %s' ;;
    line.upgrade.failed) printf '%s' 'A frissítés nem fejeződött be (%s): %s. %s' ;;
    line.upgrade.full_pull_failed) printf '%s' 'az új teljes kép nem érkezett meg, a régi marad. Teendő: jht tools pull' ;;
    line.upgrade.helper_install_failed) printf '%s' 'az új host-szkriptek az első kérésnél vagy egy újabb '\''jht upgrade'\'' paranccsal érkeznek' ;;
    line.upgrade.interrupted) printf '%s' 'Megszakadt frissítést találtam: visszaállítom az utolsó ellenőrzött verziót...' ;;
    line.upgrade.keep_old) printf '%s' 'Régi JHT-képek: mind megtartva (JHT_KEEP_OLD_IMAGES=1).' ;;
    line.upgrade.publish) printf '%s' 'Közzéteszem az igazolt jelölt konfigurációt...' ;;
    line.upgrade.pull_full) printf '%s' 'Letöltöm a frissített teljes képet...' ;;
    line.upgrade.pull_latest) printf '%s' 'Letöltöm a legújabb képet...' ;;
    line.upgrade.pull_runtime) printf '%s' 'Letöltöm a frissített futtatókörnyezetet...' ;;
    line.upgrade.restored) printf '%s' 'Az előző futtatókörnyezet visszaállítva.' ;;
    line.upgrade.telegram_restart_failed) printf '%s' 'az elkülönített Telegram-szolgáltatás nem indult újra. Teendő: jht up' ;;
    line.upgrade.verify) printf '%s' 'Ellenőrzöm a frissített futtatókörnyezetet...' ;;
    line.uso_jht_apply_relink_account) printf '%s' 'használat: jht apply relink-account' ;;
    line.uso_jht_apply_request_cancel) printf '%s' 'használat: jht apply request|cancel <id>' ;;
    line.uso_jht_apply_request_cancel_2) printf '%s' 'használat: jht apply request|cancel <id>' ;;
    line.uso_jht_artifact_upload_file) printf '%s' 'használat: jht artifact upload FÁJL [--json]' ;;
    line.uso_jht_artifact_upload_file_2) printf '%s' 'használat: jht artifact upload FÁJL [--json]' ;;
    line.uso_jht_mail_setup_status) printf '%s' 'használat: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <cím|@domain>|drafts|approve <id>|discard <id>|journal|delete|migrate' ;;
    line.uso_jht_migrate_runtime_podman) printf '%s' 'használat: jht migrate-runtime podman' ;;
    line.uso_jht_profile_import_file) printf '%s' 'használat: jht profile import FÁJL [--replace] [--json]' ;;
    line.uso_jht_profile_import_file_2) printf '%s' 'használat: jht profile import FÁJL [--replace] [--json]' ;;
    line.uso_jht_profile_validate_file) printf '%s' 'használat: jht profile validate [FÁJL] [--strict] [--json]' ;;
    line.uso_jht_screen_on_off) printf '%s' 'használat: jht screen on | off | status [--json]' ;;
    line.uso_jht_telegram_chat_id) printf '%s' 'használat: jht telegram chat-id <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_pair_assistente) printf '%s' 'használat: jht telegram pair <assistente|capitano|mentor>|--all' ;;
    line.uso_jht_telegram_remove_assistente) printf '%s' 'használat: jht telegram remove <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_status_pair) printf '%s' 'használat: jht telegram status|pair <szerep>|pair --all|chat-id <szerep>|remove <szerep>' ;;
    line.uso_jht_ticket_open_posizione) printf '%s' 'használat: jht ticket open POZÍCIÓ SZÖVEG [--kind TÍPUS] [--attach FÁJL]' ;;
    line.uso_jht_ticket_open_posizione_2) printf '%s' 'használat: jht ticket open POZÍCIÓ SZÖVEG [--kind TÍPUS] [--attach FÁJL]' ;;
    line.versione_dell_immagine_configurata_per) printf '%s' 'A beállított kép verziója. A futó CLI verziójához: '\''jht up'\'', majd '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_2) printf '%s' 'A beállított kép verziója. A futó CLI verziójához: '\''jht up'\'', majd '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_3) printf '%s' 'A beállított kép verziója. A futó CLI verziójához: '\''jht up'\'', majd '\''jht --version'\''.' ;;
    line.versione_di_podman_compose_non) printf '%s' 'A podman-compose verziója nem olvasható.' ;;
    line.versione_non_supportata_servono_podman) printf '%s' 'Nem támogatott verzió: podman >= %s kell (talált: %s) és podman-compose >= %s (talált: %s).' ;;
    line.versione_non_supportata_sul_mac) printf '%s' 'Nem támogatott verzió: Macen podman %s.%s vagy egy későbbi %s.x kell (nem 6.2 vagy újabb; talált: %s) és podman-compose %s (talált: %s). Ha a Homebrew-t a %s sorozaton túl frissítetted, frissítsd a JHT-t (curl -fsSL https://jobhunterteam.ai/install.sh | bash).' ;;
    migrate.left) printf '%s' 'Nincs átmásolva vagy nincs ellenőrizve: a(z) %s kötet.' ;;
    monitor.window_failed) printf '%s' 'monitor_window_unavailable: itt nem tudok terminálablakot nyitni. Futtasd a '\''jht monitor'\'' parancsot a jelenlegi terminálban (vagy a tmux-munkameneteden belül).' ;;
    monitor.window_invalid) printf '%s' 'monitor_window_invalid: a '\''jht monitor --window'\'' parancsot más kapcsolók nélkül használd.' ;;
    removed.office) printf '%s' 'A '\''jht %s'\'' a 0.4.0-ban a Godot-irodával együtt megszűnt: használd a jht parancsokat (jht help).' ;;
    status.container) printf '%s' 'Konténer' ;;
    status.image) printf '%s' 'Kép' ;;
    status.next_other) printf '%s' 'Indítsd el a csapatot: jht up' ;;
    status.next_running) printf '%s' 'Ki dolgozik: jht agents' ;;
    status.no_options) printf '%s' 'A '\''jht status'\'' nem fogad kapcsolókat (%s): egyszerűen '\''jht status'\''-ként futtasd.' ;;
    status.not_running) printf '%s' 'A csapat konténere nem fut.' ;;
    status.not_running_next) printf '%s' 'Indítsd el: jht up' ;;
    status.running) printf '%s' 'fut ekkor óta: %s' ;;
    status.state) printf '%s' '%s, ekkor óta: %s' ;;
    status.title) printf '%s' 'Állapot' ;;
    team.stopped) printf '%s' 'A Job Hunter Team le van állítva: a '\''jht up'\'' újraindítja.' ;;
    tools.arriving) printf '%s' 'A felderítők (Scout) eszközei úton vannak: a teljes kép a háttérben töltődik le (kb. 3 GB). Az állások keresése magától elindul, amint megérkeztek; nincs teendőd.' ;;
    tools.chat_reconnecting) printf '%s' 'A csapat átáll a felderítők (Scout) teljes eszközeire, ezért a csevegés egy pillanatra megáll: magától folytatódik, amint a csapat újra fut (pár perc).' ;;
    tools.chat_resumed) printf '%s' 'A csapat átállt a teljes eszközökre: folytassuk.' ;;
    tools.chat_switched) printf '%s' 'A csapat átáll a felderítők (Scout) teljes eszközeire, ezért ez a csevegés bezárult. Pár perc múlva nyisd meg újra a jht team chat paranccsal.' ;;
    tools.chat_update_closed) printf '%s' 'A JHT frissül, ezért ez a csevegés bezárult. Pár perc múlva nyisd meg újra a jht team chat paranccsal.' ;;
    tools.chat_update_resumed) printf '%s' 'A JHT frissült: folytassuk.' ;;
    tools.chat_updating) printf '%s' 'A JHT frissül, ezért a csevegés egy pillanatra megáll: magától újraindul egy-két percen belül.' ;;
    tools.disk_low) printf '%s' 'A felderítők (Scout) eszközei nem töltődtek le: kb. %s GiB szabad lemezterület kell hozzájuk, és %s GiB van, így a csapat még nem tud állásokat keresni. Szabadíts fel helyet (ürítsd ki a Kukát, töröld a nagy fájlokat, amelyekre nincs szükséged), majd futtasd a jht up parancsot: a letöltés magától újraindul.' ;;
    tools.engine_down) printf '%s' 'A felderítők (Scout) eszközeinek állapota nem olvasható: a konténermotor nem válaszol. Indítsd el a jht up paranccsal.' ;;
    tools.failed) printf '%s' 'A felderítők (Scout) eszközeinek letöltése nem sikerült, így a csapat még nem tud állásokat keresni. Futtasd a jht tools pull parancsot az újrapróbáláshoz (a jht up is újrapróbálja).' ;;
    tools.not_started) printf '%s' 'A Scoutok eszközeinek letöltése nem indult el, ezért a csapat még nem tud állásokat keresni. Indítsd el a jht tools pull paranccsal (a jht up is elindítja).' ;;
    tools.ready) printf '%s' 'A felderítők (Scout) eszközei megérkeztek: a csapat a teljes képpel keres.' ;;
    tools.switch_failed) printf '%s' 'A felderítők (Scout) eszközei megérkeztek, de a csapatot nem sikerült velük újraindítani: futtasd a jht down, majd a jht up parancsot.' ;;
    tools.switch_wait) printf '%s' 'A csapat átáll a felderítők (Scout) teljes eszközeire: megvárom, amíg újraindul (legfeljebb pár perc).' ;;
    tools.waiting) printf '%s' 'A felderítők (Scout) eszközei megérkeztek: a csapat magától átvált rájuk, amint a bevezetés lezárult.' ;;
    uninstall.bad_home) printf '%s' 'A HOME érvénytelen: az eltávolítás megtagadva.' ;;
    uninstall.colima_busy) printf '%s' 'A Colima még fut: a JHT telepítője indította el, de más konténerek is futnak benne, ezért bekapcsolva hagyom. Leállítás: colima stop.' ;;
    uninstall.colima_running) printf '%s' 'A Colima még fut: nem a JHT telepítője indította el (már futott, vagy nem a szabványos), ezért bekapcsolva hagyom, és lehet, hogy a tiéd. Leállítás: colima stop.' ;;
    uninstall.colima_stop_failed) printf '%s' 'A Colimát nem sikerült leállítani. Leállítás: colima stop.' ;;
    uninstall.colima_stopping) printf '%s' 'Leállítom a Colima virtuális gépet, amelyet a JHT telepítője indított, és amelyben semmi más nem fut; a Maceden lévő mappáid megmaradnak.' ;;
    uninstall.compose_link_left) printf '%s' 'Nem sikerült eltávolítani a Docker Compose bővítményre mutató linket, amelyet a JHT telepítője hozott létre: %s. Törölheted.' ;;
    uninstall.compose_link_removed) printf '%s' 'Eltávolítottam a Docker Compose bővítményre mutató linket, amelyet a JHT telepítője hozott létre: %s. A Homebrew-val telepített bővítmény megmarad (a brew uninstall docker-compose eltávolítja).' ;;
    uninstall.images_removed) printf '%s' '%s JHT-kép eltávolítva: az alap, a teljes és a régiek.' ;;
    uninstall.left.commands) printf '%s' 'Nincs eltávolítva: a jht parancs vagy a telepítő által hozzáadott PATH-sorok.' ;;
    uninstall.left.data) printf '%s' 'A fent felsorolt JHT-adatok nem lettek törölve. A jht parancs és a futtatókörnyezet még megvan: ha rendezted, futtasd újra a '\''jht uninstall --confirm --purge'\'' parancsot.' ;;
    uninstall.left.images) printf '%s' 'Nincs eltávolítva: néhány JHT-kép (a motor elutasította). Futtasd újra a '\''jht uninstall --confirm'\'' parancsot, ha már semmi más nem használja őket.' ;;
    uninstall.left.machine) printf '%s' 'Nincs eltávolítva: a jht-podman Podman-gép vagy a JHT konténerei és kötetei, a mentett titkokkal. Futtasd újra a '\''jht uninstall --confirm'\'' parancsot, amikor a Podman vagy a Docker válaszol.' ;;
    uninstall.left.runtime) printf '%s' 'Nincs eltávolítva: a JHT gépen futó futtatókörnyezete.' ;;
    uninstall.loss) printf '%s' 'A mentett levelezési jelszó és a Telegram-tokenek is törlődnek; a ~/.jht és a Dokumentumok megmarad, és velük a mentett LinkedIn-munkamenet is (secrets/linkedin-profile és .cache/linkedin): ezt a jht reset --scope creds paranccsal törölheted.' ;;
    uninstall.loss_purge) printf '%s' 'A mentett levelezési jelszó és a Telegram-tokenek is törlődnek.' ;;
    uninstall.machine_kept) printf '%s' 'A(z) '\''%s'\'' Podman-gépet nem a JHT telepítője hozta létre (már megvolt, vagy nem a szabványos jht-podman), ezért nem távolítom el: lehet, hogy a tiéd. A benne lévő JHT-kötetek és -kép vele együtt megmaradnak. Eltávolítás: podman machine stop %s, majd podman machine rm %s.' ;;
    uninstall.machine_removing) printf '%s' 'Eltávolítom a(z) '\''%s'\'' Podman-gépet, amelyet a JHT telepítője hozott létre: minden, ami benne van, vele együtt törlődik (a JHT kötetei és képe); a Maceden lévő mappáid megmaradnak.' ;;
    uninstall.phase.commands) printf '%s' 'Eltávolítom a jht parancsot és a telepítő által hozzáadott PATH-sorokat...' ;;
    uninstall.phase.data) printf '%s' 'Törlöm a ~/.jht és a Dokumentumok mappát (--purge)...' ;;
    uninstall.phase.images) printf '%s' 'Eltávolítom a JHT képeit (az alapot, a teljeset és a régieket)...' ;;
    uninstall.phase.machine) printf '%s' 'Eltávolítom a Podman-gépet, vagy a JHT konténereit és köteteit...' ;;
    uninstall.phase.runtime) printf '%s' 'Eltávolítom a gépen futó futtatókörnyezetet...' ;;
    uninstall.purge_loss) printf '%s' 'A --purge kapcsolóval a ~/.jht és a ~/Documents/Job Hunter Team is törlődik: beállítások, adatbázis, önéletrajzok és kimenetek. Nincs visszaút.' ;;
    uninstall.runtime_choice_unreadable) printf '%s' 'A JHT futtatókörnyezetének választása nem olvasható: semmi sem lett eltávolítva.' ;;
    uninstall.usage) printf '%s' 'használat: jht uninstall --confirm [--purge]' ;;
    uninstall.usage_stays) printf '%s' 'A Podman, a podman-compose, a Docker, a Colima és a Homebrew is megmarad.' ;;
    uninstall.usage_what) printf '%s' 'Eltávolítja a helyi JHT-futtatókörnyezetet: a jht-podman Podman-gépet vagy a JHT konténereit, köteteit és képeit (az alapot és a teljeset, a ghcr.io/leopu00/jht, jht és localhost/jht tárolónevekkel), a gépen futó futtatókörnyezetet és a jht parancsot.' ;;
    up.docker_legacy) printf '%s' 'Ez a gép Dockeren futtatja a JHT-t, és a motorja nem válaszol. A 0.4 óta a JHT csak Podmanen fut. Az adataid megmaradnak: a ~/.jht és a ~/Documents/Job Hunter Team ennek a gépnek a mappái. Átállás Podmanre: jht uninstall --confirm (ezt a két mappát megtartja), futtasd újra a telepítőt, majd a jht setup parancsot az API-kulcsoddal (a kulcs, a levelezési jelszó és a Telegram-tokenek a Docker köteteiben maradtak: add meg őket újra). Ha egyelőre Dockeren maradnál, indítsd el magad a motorját, és futtasd újra a jht up parancsot.' ;;
    up.done) printf '%s' 'A Job Hunter Team elindult.' ;;
    up.engine_lost) printf '%s' 'A Podman-gép leállt, miközben a csapat indult (%s). Semmid sem veszett el: az adataid a kötetekben és a mappáidban vannak. Futtasd újra a jht up parancsot: elindítja a gépet és a csapatot.' ;;
    up.storage_damaged) printf '%s' 'A csapat képe megsérült a Podman-gép lemezén (a gépet hirtelen állították le, miközben írta): újra letöltöm, és újra létrehozom a konténereket. Az adataid a kötetekben és a mappáidban vannak, és megmaradnak. Néhány percig tart.' ;;
    up.storage_repair_failed) printf '%s' 'A csapat képét nem lehet megjavítani a Podman-gépen. A '\''jht uninstall --confirm'\'', majd a telepítő új gépet hoz létre (a ~/.jht és a Dokumentumok mappád megmarad).' ;;
    *) return 1 ;;
  esac
}
jht_text_es() {
  case "$1" in
    compose.missing) printf '%s' 'falta docker compose: el motor responde, pero el comando «docker compose» no existe (JHT necesita el plugin Compose v2). En un Mac: brew install docker-compose y luego mkdir -p ~/.docker/cli-plugins && ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose. En Linux: instala el paquete docker-compose-v2 (apt) o docker-compose-plugin (dnf). Luego vuelve a ejecutar el comando.' ;;
    config.changed_down) printf '%s' 'config_changed_while_running: el equipo se arrancó con una configuración distinta de la actual (cambió mientras JHT estaba en marcha, o hubo una reinstalación); lo detengo.' ;;
    config.changed_other) printf '%s' 'config_changed_while_running: el equipo funciona con una configuración distinta de la esperada; solo la uso para detenerlo.' ;;
    config.changed_start) printf '%s' 'config_changed_while_running: la configuración cambió mientras JHT estaba en marcha (jht config set, ajustes cambiados desde el sitio o la app, o una reinstalación), así que el equipo en marcha no se puede verificar. Detenlo con «jht down» y luego arráncalo con «jht up».' ;;
    config.changed_stopped) printf '%s' 'config_changed_stopped: los contenedores del equipo, detenidos, son de la versión anterior: los vuelvo a crear con la configuración nueva (los volúmenes con los datos se quedan).' ;;
    container.starting) printf '%s' 'El contenedor '\''%s'\'' no está en marcha, lo arranco...' ;;
    doctor.host_config_none) printf '%s' 'todavía no hay configuración: '\''jht setup'\''' ;;
    doctor.host_config_ok) printf '%s' 'configuración presente' ;;
    doctor.host_engine_fail) printf '%s' 'motor de contenedores no accesible' ;;
    doctor.host_engine_ok) printf '%s' 'motor de contenedores accesible' ;;
    doctor.host_more) printf '%s' 'Para las comprobaciones completas (configuración, proveedor, base de datos, agentes): '\''jht up'\'' y luego '\''jht doctor'\''.' ;;
    doctor.host_runtime_fail) printf '%s' 'runtime de JHT ausente o cambiado: '\''jht upgrade'\'' lo vuelve a instalar' ;;
    doctor.host_runtime_ok) printf '%s' 'runtime de JHT intacto' ;;
    doctor.host_team_off) printf '%s' 'equipo apagado: '\''jht up'\'' lo enciende' ;;
    doctor.host_team_unattestable) printf '%s' 'hay un contenedor del equipo, pero no se puede verificar que sea nuestro: no he tocado nada ('\''jht status'\'' te dice más)' ;;
    doctor.host_title) printf '%s' 'Job Hunter Team: el equipo está apagado (su contenedor no está en marcha). Comprobaciones hechas desde este ordenador:' ;;
    down.done) printf '%s' 'Job Hunter Team detenido.' ;;
    down.still_running) printf '%s' 'El equipo no se ha detenido: un contenedor del proyecto volvía a estar en marcha tras dos intentos (en su primer minuto puede reiniciarse solo). Vuelve a ejecutar '\''jht down'\''; si sigue, '\''jht doctor'\''.' ;;
    download.asset_failed) printf '%s' 'la descarga ha fallado: %s' ;;
    download.bad_version) printf '%s' 'versión no válida: %s. Ejemplo: 0.3.5.' ;;
    download.copy_failed) printf '%s' 'no se ha podido copiar la descarga verificada al destino' ;;
    download.deb_only_linux) printf '%s' '--deb solo es para Linux.' ;;
    download.dest_appeared) printf '%s' 'el destino ha aparecido durante la descarga; no se ha sobrescrito' ;;
    download.dest_is_link) printf '%s' 'el destino es un enlace: %s' ;;
    download.dest_not_file) printf '%s' 'el destino existe y no es un archivo: %s' ;;
    download.fetching) printf '%s' 'Descargando %s...' ;;
    download.hash_invalid) printf '%s' 'SHA-256 no válido para %s: se esperaba %s, se ha obtenido %s.' ;;
    download.intel_mac) printf '%s' 'La app de macOS de la 0.4 solo funciona en Mac con Apple silicon (M1 y posteriores); este es un Mac Intel, que la 0.4 no admite. No se ha descargado nada.' ;;
    download.linux_no_app) printf '%s' 'En esta versión no hay app de escritorio para Linux: usa install.sh. No se ha descargado nada.' ;;
    download.mismatch_existing) printf '%s' 'el archivo %s existe, pero su SHA-256 no coincide: no se ha sobrescrito.' ;;
    download.mkdir_failed) printf '%s' 'no se puede crear la carpeta de destino: %s' ;;
    download.no_curl) printf '%s' 'no se encuentra curl: hace falta para descargar la versión.' ;;
    download.no_tmp) printf '%s' 'no se ha podido crear la carpeta temporal' ;;
    download.parent_unreachable) printf '%s' 'no se puede acceder a la carpeta de destino: %s' ;;
    download.present_verified) printf '%s' 'Archivo ya presente y verificado: %s' ;;
    download.release_no_app) printf '%s' 'Esta versión (v%s) no tiene app para macOS: usa la 0.4.0 o posterior. No se ha descargado nada.' ;;
    download.saved_in) printf '%s' 'Guardado en: %s' ;;
    download.sha_verified) printf '%s' 'SHA-256 verificado: %s' ;;
    download.shared_folder) printf '%s' 'el destino está dentro de una carpeta compartida con el equipo (%s): elige una fuera de ella, como ~/Downloads.' ;;
    download.sum_missing) printf '%s' 'no hay SHA-256 declarado para %s.' ;;
    download.sums_failed) printf '%s' 'la descarga ha fallado: SHA256SUMS de v%s' ;;
    download.unsupported_os) printf '%s' 'sistema no compatible: %s. Usa windows o macos.' ;;
    download.windows_missing) printf '%s' 'Windows no forma parte de la 0.4.0: la versión no tiene instalador para Windows. No se ha descargado nada.' ;;
    help.download) printf '%s' 'uso: jht download --os windows|macos --version X.Y.Z [--output FILE]
  La app de escritorio no forma parte de la 0.4.0: para una versión que la incluya, la descarga, comprueba su SHA-256 y la guarda
  (por defecto en ~/Downloads).' ;;
    help.integration) printf '%s' 'Uso: jht integration <command>

  list [--json]                   las integraciones y su estado
  status [ID] [--json]            el estado de una, o de todas
  add ID [--json]                 añade una integración
  remove ID [--purge --yes] [--remove-image] [--json]
                                  la quita; --purge borra también sus datos (hace falta --yes);
                                  --remove-image (solo screen y media) quita también la imagen de las
                                  herramientas

Los ID admitidos son los que muestra `jht integration list`. No se descarga ni se enciende nada
hasta que lo pidas con `add`.' ;;
    help.linkedin) printf '%s' 'Uso: jht linkedin <command>

  login [--stop]    el acceso a mano a LinkedIn (con Google): un navegador en un contenedor aparte,
                    sin red, cuya ventana ves y usas desde la app; --stop lo cierra todo
  status --json     dice si el acceso está en curso y si la sesión de LinkedIn está guardada

No se descarga ni se enciende nada hasta que lo pidas con `login`.' ;;
    help.main) printf '%s' 'jht — Job Hunter Team

  Comandos del host (funcionan desde aquí):
    jht up                 arranca el contenedor del equipo
    jht down               lo detiene
                           (con --verbose se ven también las líneas del motor)
    jht restart            lo reinicia
    jht status             estado del contenedor y del equipo
    jht logs [-f]          logs del contenedor
    jht upgrade            actualiza a la imagen más reciente
    jht clean-images [--json]
                           quita las imágenes JHT antiguas (deja la actual, la
                           más reciente de las demás y las que están en uso); se puede
                           también con el disco casi lleno
    jht setup              instalación guiada
    jht shell              shell dentro del contenedor
    jht profile import FILE [--replace]
                           da al equipo el perfil del candidato (YAML)
    jht profile validate [FILE] [--strict] [--json]
                           comprueba un perfil (YAML) sin escribir nada;
                           sin FILE, el del equipo
    jht mail setup         guarda el buzón de correo en el broker de secretos
    jht mail drafts        correos escritos por los agentes que esperan tu ok
    jht mail approve <id>  los envía; jht mail discard <id> los descarta
    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]
                           las integraciones que se añaden después del setup
                           (google, telegram, mail): estado leído del motor
    jht telegram status    estado del servicio de Telegram aislado
    jht telegram pair ROLE pide el token sin eco en el ordenador host, luego
                           muestra un código que mandar al bot desde tu Telegram
                           Para automatizaciones: JSON por stdin. No guardes el token
                           en ~/.jht; borra enseguida los archivos usados fuera de ahí.
    jht telegram pair --all empareja en una sola sesión todos los roles legacy
    jht telegram chat-id ROLE mueve el bot a otro chat, con el mismo código
    jht reset              borra la configuración y los volúmenes del broker
    jht migrate-runtime podman
                           copia y verifica los volúmenes de Docker en Podman;
                           no selecciona el nuevo runtime y no borra Docker
    jht podman-machine-recreate --confirm
                           vuelve a crear la máquina Podman (macOS) viendo
                           solo ~/.jht y ~/Documents/Job Hunter Team
    jht uninstall --confirm elimina el runtime local (máquina Podman o
                           contenedores y volúmenes jht, con los secretos guardados);
                           se quedan ~/.jht, Documentos, Podman y Docker
    jht uninstall --confirm --purge
                           como arriba, y borra también ~/.jht y
                           ~/Documents/Job Hunter Team (aunque pertenezcan al
                           contenedor, sin sudo y sin cambiar permisos)

  Todos los demás comandos (positions, stats, team, providers, cron,
  working-hours, cloud...) se ejecutan DENTRO del contenedor: para su ayuda
  hace falta el contenedor en marcha.

      jht up && jht --help
' ;;
    help.screen) printf '%s' 'Uso: jht screen <command>

  on [--json]       enciende la pantalla en directo del closer: un contenedor aparte,
                    con el stream solo en 127.0.0.1
  off [--remove-image] [--json]
                    la apaga y quita el contenedor; la imagen de las herramientas se queda en el disco,
                    para volver a encenderla sin descargarla otra vez: --remove-image la quita y libera
                    el espacio
  status [--json]   dice si está encendida

No se descarga ni se enciende nada hasta que lo pidas con `on`. El stream es solo para ver.' ;;
    help.setup) printf '%s' 'Uso: jht setup [options]

Sin opciones arranca la instalación guiada. Con --non-interactive no pregunta nada:
todo se da con las opciones.

  --non-interactive            ninguna pregunta
  --provider <name>            glm (Z.ai, predeterminado), kimi (Moonshot), openai o claude (Anthropic)
  --harness <name>             pi (predeterminado)
  --api-key-file <path>        archivo que contiene la clave API (una línea, que solo puedas leer tú).
                               Un archivo de tu ordenador lo lee jht y se lo pasa al setup: con glm y kimi
                               el setup guarda la clave por su cuenta, nunca en la configuración
  --api-key-stdin              lee la clave API de la entrada estándar (una línea):
                               nunca en la línea de comandos
  --api-key <key>              la clave escrita aquí, en claro (no admitida para glm y kimi)
  --secret-mode <mode>         cómo se guarda la clave: plaintext (predeterminado), env o file
  --secret-env <name>          con --secret-mode env: la variable de entorno que la contiene
  --secret-file <path>         con --secret-mode file: el archivo que la contiene
  --model <model>              el modelo que usar
  --language <code>            el idioma (por ejemplo es o en)
  --budget-usd <dólares>       cuánto puede gastar el equipo, en dólares (con una de --budget-minutes, --budget-days, --budget-until)
  --budget-minutes <n>         el presupuesto dura estos minutos desde ahora
  --budget-days <n>            el presupuesto dura estos días desde ahora
  --budget-until <hora>        el presupuesto dura hasta esta hora del día, 0-23 (la siguiente)
  --no-budget                  sin límite de gasto (el equipo se detiene solo con el crédito del proveedor)
  --skip-health                se salta la comprobación final
  --reset                      vuelve a empezar desde una configuración limpia

Ejemplos:
  con una clave GLM en un archivo:
    jht setup --non-interactive --provider glm --harness pi --api-key-file clave.txt
  OpenAI con una clave API, en Pi (para Claude: --provider claude):
    jht setup --non-interactive --provider openai --harness pi --api-key-stdin' ;;
    help.tools) printf '%s' 'Uso: jht tools <comando>

  status --json   si las herramientas de los Scout (la imagen completa) ya están, están en camino o han fallado
  pull            las descarga en segundo plano (jht up y jht setup lo inician solos)
  switch          pasa el equipo a ellas cuando el onboarding está cerrado (la descarga lo hace sola)

Esta ayuda no arranca nada ni descarga nada.' ;;
    host_setup.skip_done) printf '%s' 'host.env está en una carpeta del contenedor (uid 1001): la comprobación previa del host ya está hecha, me la salto.' ;;
    host_setup.skip_unknown) printf '%s' 'host.env está en una carpeta del contenedor (uid 1001) y este usuario no puede escribir en ella: me salto la comprobación previa del host, pero host.env no se puede leer o no indica el tipo de host (local o VPS): el tipo se queda en '\''unknown'\''.' ;;
    keyfile.both) printf '%s' 'usa --api-key-file o --api-key-stdin, no los dos' ;;
    keyfile.not_file) printf '%s' 'el archivo dado a --api-key-file tiene que ser un archivo normal, no una carpeta ni un enlace: %s' ;;
    keyfile.readable) printf '%s' 'otros usuarios pueden leer el archivo %s: haz chmod 600 sobre él.' ;;
    keyfile.shape) printf '%s' 'el contenido del archivo dado a --api-key-file no es una línea de 16 a 512 caracteres imprimibles sin espacios: %s' ;;
    keyfile.size) printf '%s' 'el archivo dado a --api-key-file está vacío o es demasiado grande para una clave (de 1 a 4096 bytes): %s' ;;
    keyfile.twice) printf '%s' '--api-key-file se ha dado dos veces' ;;
    keyfile.unreadable) printf '%s' 'no se puede leer el archivo dado a --api-key-file: %s' ;;
    line.abbinamento_annullato_nessuna_modifica) printf '%s' 'Vinculación cancelada: no se ha cambiado nada.' ;;
    line.abbinamento_di_s_non_riuscito) printf '%s' 'La vinculación de %s no ha salido bien: todas las copias antiguas se quedan. Vuelve a ejecutar jht telegram pair --all: los roles ya vinculados no piden otro token.' ;;
    line.abbinamento_rifiutato_genera_un_token) printf '%s' 'Vinculación rechazada: genera un token nuevo en BotFather (/revoke) y vuelve a intentarlo.' ;;
    line.accedi_con_l_utente_jht) printf '%s' 'Inicia sesión con el usuario rootless de JHT configurado en la instalación y vuelve a intentarlo.' ;;
    line.agent_restart_failed.inventario_conservato_ma_il_team) printf '%s' 'inventario conservado, pero el equipo no ha vuelto a arrancar. Qué hacer: jht up' ;;
    line.allineo_owner_di_s_a) printf '%s' 'Ajustando el propietario de %s a %s (era uid %s)...' ;;
    line.annullato_niente_autorizzato) printf '%s' 'Cancelado: no se ha autorizado nada.' ;;
    line.anteprima_non_valida_niente_autorizzato) printf '%s' 'Vista previa no válida: no se ha autorizado nada.' ;;
    line.apply.authorize) printf '%s' '¿Autorizas esta candidatura?' ;;
    line.apply_relink_account_cloud_account) printf '%s' 'apply relink-account: la cuenta cloud no está disponible. Ejecuta antes jht cloud pair.' ;;
    line.attenzione_le_cli_interne_verranno) printf '%s' 'ATENCIÓN: las CLI internas se volverán a instalar y los secretos no se conservarán. La configuración y el estado del correo se quedan, pero tendrás que volver a introducir la contraseña del correo y volver a iniciar sesión en LinkedIn.' ;;
    line.autorizzata_s_verso_s_il) printf '%s' 'Autorizada la #%s, hacia %s: el CLOSER la recogerá en la próxima ronda.' ;;
    line.bind_uid_conflict.uid_s_on_this_computer) printf '%s' 'el uid %s de este ordenador es la cuenta '\''%s'\''. El contenedor de Job Hunter Team se ejecuta como uid %s, así que esa cuenta sería la propietaria de ~/.jht (tus datos y las credenciales de los portales). No se ha cambiado nada. Ejecuta JHT desde la cuenta '\''%s'\'', o dale otro uid a '\''%s'\'', y vuelve a intentarlo.' ;;
    line.bot_abbinato_e_copia_legacy) printf '%s' 'Bot vinculado y copia antigua eliminada. Quedan otros tokens antiguos o un token en el entorno del contenedor: quítalos y completa la rotación antes del cambio definitivo.' ;;
    line.bot_token_invalid.controlla_il_token_generato_da) printf '%s' 'revisa el token que te ha generado BotFather.' ;;
    line.broker_restart_failed.il_servizio_della_posta_non_4) printf '%s' 'el servicio de correo no se ha reiniciado. Qué hacer: jht mail status' ;;
    line.broker_start_failed.il_servizio_della_posta_non_2) printf '%s' 'el servicio de correo no ha arrancado.' ;;
    line.broker_start_failed.il_servizio_della_posta_non_3) printf '%s' 'el servicio de correo no responde después de 30 segundos.' ;;
    line.broker_unavailable.il_broker_dei_segreti_esiste) printf '%s' 'el broker de secretos existe, pero no se puede verificar que sea nuestro: no lo toco.' ;;
    line.broker_unavailable.il_broker_dei_segreti_non) printf '%s' 'el broker de secretos no está activo o no se puede verificar.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato) printf '%s' 'el compose del runtime instalado no se puede leer, no se sabe si tiene el broker de secretos.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato_2) printf '%s' 'el compose del runtime instalado no se puede leer, no se sabe si tiene el broker de secretos.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio) printf '%s' 'el runtime instalado es más antiguo y no tiene el broker de secretos.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio_2) printf '%s' 'el runtime instalado es más antiguo y no tiene el broker de secretos.' ;;
    line.broker_unavailable.il_servizio_della_posta_non) printf '%s' 'el servicio de correo aún no existe: se crea la primera vez que hace falta.' ;;
    line.cancellato_marcatore_migrazione_broker_s) printf '%s' 'Borrado: marcador de migración del broker %s' ;;
    line.cancellato_volume_broker_s_s) printf '%s' 'Borrado: volumen del broker %s (%s)' ;;
    line.chown_fallito_su_s) printf '%s' 'chown ha fallado en %s' ;;
    line.client_container_non_trovato_nel) printf '%s' 'no se encuentra el cliente de contenedores en el PATH. Repara el runtime de JHT.' ;;
    line.client_container_non_trovato_nel_2) printf '%s' 'no se encuentra el cliente de contenedores en el PATH. Repara el runtime de JHT.' ;;
    line.compose_extra_file_non_e) printf '%s' 'COMPOSE_EXTRA_FILE no es el overlay seccomp del acceso: no hago nada.' ;;
    line.compose_up_failed.podman_compose_up_e_uscito) printf '%s' 'podman-compose up ha salido con %s. El error de Podman está aquí arriba.' ;;
    line.compose_up_timeout.podman_compose_up_non_ha) printf '%s' 'podman-compose up no ha terminado en %ss y se ha detenido. Un servicio no ha arrancado: mira «podman ps -a» y «podman logs jht».' ;;
    line.container_jht_non_verificabile_dopo) printf '%s' 'No se puede verificar el contenedor de JHT después de la operación.' ;;
    line.container_s_non_attivo_leggere) printf '%s' 'el contenedor '\''%s'\'' no está en marcha: leer el plan no lo enciende. Arráncalo con '\''jht up'\'' y vuelve a intentarlo.' ;;
    line.container_s_non_e_partito) printf '%s' 'El contenedor '\''%s'\'' no ha arrancado en 10 s. Revisa '\''jht logs'\''.' ;;
    line.cosa_fare_jht_mail_setup) printf '%s' 'Qué hacer: jht mail setup' ;;
    line.cosa_fare_jht_up) printf '%s' 'Qué hacer: jht up' ;;
    line.cosa_fare_jht_up_2) printf '%s' 'Qué hacer: jht up' ;;
    line.cosa_fare_jht_up_3) printf '%s' 'Qué hacer: jht up' ;;
    line.cosa_fare_jht_upgrade) printf '%s' 'Qué hacer: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_2) printf '%s' 'Qué hacer: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_3) printf '%s' 'Qué hacer: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_4) printf '%s' 'Qué hacer: jht upgrade' ;;
    line.cosa_fare_reinstalla_il_runtime) printf '%s' 'Qué hacer: vuelve a instalar el runtime con el instalador' ;;
    line.cosa_fare_reinstalla_il_runtime_2) printf '%s' 'Qué hacer: vuelve a instalar el runtime con el instalador' ;;
    line.cosa_fare_reinstalla_il_runtime_3) printf '%s' 'Qué hacer: vuelve a instalar el runtime con el instalador' ;;
    line.cosa_fare_reinstalla_il_runtime_4) printf '%s' 'Qué hacer: vuelve a instalar el runtime con el instalador' ;;
    line.cosa_fare_riprova_il_comando) printf '%s' 'Qué hacer: vuelve a intentar el comando' ;;
    line.cosa_fare_riprova_il_comando_2) printf '%s' 'Qué hacer: vuelve a intentar el comando' ;;
    line.data_dir_moved.jht_home_host_s_non) printf '%s' 'JHT_HOME_HOST=%s no es %s. El equipo usa siempre %s: lo monta el compose, lo lee la app, y en macOS es la única carpeta de datos que ve la máquina Podman. Quita JHT_HOME_HOST o mueve los datos a %s.' ;;
    line.data_dir_moved.jht_user_dir_host_s) printf '%s' 'JHT_USER_DIR_HOST=%s no es %s. El equipo usa siempre %s: lo monta el compose, y en macOS es la única carpeta de documentos que ve la máquina Podman. Quita JHT_USER_DIR_HOST o mueve los documentos a %s.' ;;
    line.disk_low.gli_agenti_richiedono_almeno_disk) printf '%s' 'Los agentes necesitan al menos %s GiB de disco — disponibles: %s GiB. Para liberar espacio ejecuta '\''jht clean-images'\'' (solo quita las versiones antiguas de Job Hunter Team), vacía la Papelera y borra los archivos grandes que no necesites; luego vuelve a intentarlo: no se ha descargado ni cambiado nada.' ;;
    line.docker_punta_a_s_che) printf '%s' 'Docker apunta a %s, que no es este ordenador: no se tocan los contenedores ni los volúmenes de jht que hay allí. Vuelve a poner Docker en el local (DOCKER_HOST o docker context) y vuelve a ejecutarlo.' ;;
    line.fermo_e_ricreo_la_macchina) printf '%s' 'Deteniendo y volviendo a crear la máquina Podman '\''%s'\''...' ;;
    line.fino_ad_allora_la_posta) printf '%s' 'Hasta entonces el correo se lee y se envía con la contraseña actual; el aviso sigue en jht mail status.' ;;
    line.genera_una_nuova_password_per) printf '%s' 'genera una nueva contraseña de aplicación en tu proveedor y guárdala con: jht mail setup' ;;
    line.host_setup_sh_non_trovato) printf '%s' 'no se encuentra host-setup.sh en %s — me salto la comprobación previa del host' ;;
    line.host_setup_sh_terminato_con) printf '%s' 'host-setup.sh ha terminado con un error — sigo adelante' ;;
    line.i_segreti_e_lo_stato) printf '%s' 'Se han borrado los secretos y el estado del broker: vuelve a iniciar sesión en los portales y configura otra vez el correo.' ;;
    line.identita_progetto_compose_non_valida) printf '%s' 'Identidad del proyecto Compose no válida.' ;;
    line.il_broker_non_ha_registrato) printf '%s' 'El broker no ha registrado la autorización: retirada, no saldrá nada.' ;;
    line.il_compose_non_indica_una) printf '%s' 'El compose no indica una sola imagen compartida para el equipo y el broker; conservación rechazada.' ;;
    line.il_container_s_non_c) printf '%s' 'el contenedor '\''%s'\'' no está, pero hay otros servicios del proyecto en marcha: los detengo.' ;;
    line.il_documento_deve_essere_un) printf '%s' 'el documento tiene que ser un archivo normal, no un enlace: %s' ;;
    line.il_documento_supera_i_mb) printf '%s' 'el documento supera los 10 MB' ;;
    line.il_file_del_profilo_supera) printf '%s' 'el archivo del perfil supera los 64 KiB' ;;
    line.il_motore_dei_container_non) printf '%s' 'El motor de contenedores no está en marcha: no se ha eliminado nada.' ;;
    line.il_profilo_deve_essere_un) printf '%s' 'el perfil tiene que ser un archivo normal, no un enlace: %s' ;;
    line.il_progetto_ha_container_che) printf '%s' 'El proyecto tiene contenedores que no son ni el equipo ni sus servicios verificados: no los toco.' ;;
    line.il_runtime_podman_rootless_locale) printf '%s' 'El runtime local de Podman rootless no responde.' ;;
    line.il_servizio_s_del_progetto) printf '%s' 'El servicio '\''%s'\'' del proyecto está en marcha, pero no se puede verificar que sea nuestro: no lo toco y no detengo nada más.' ;;
    line.input_interrotto.token_non_letto) printf '%s' 'token no leído.' ;;
    line.integration.install_hint) printf '%s' 'para instalarlas: '\''jht upgrade'\'' (o un '\''jht integration add <id>'\'')' ;;
    line.integration.not_installed) printf '%s' 'no instalado' ;;
    line.integration.not_installed_yet) printf '%s' 'aún no instalado' ;;
    line.interattivo_il_token_viene_chiesto) printf '%s' 'Interactivo: el token se pide sin eco y luego el bot nuevo recibe un código de un solo uso desde tu Telegram. Automatizaciones: {"bot_token": ...} como JSON por stdin; no guardes el token en ~/.jht y borra enseguida cualquier archivo usado fuera de ahí.' ;;
    line.jht_home_host_o_jht) printf '%s' 'JHT_HOME_HOST o JHT_USER_DIR_HOST apuntan a otro sitio: no borro carpetas distintas de las fijas de JHT.' ;;
    line.jht_telegram_pair_all_interattivo) printf '%s' 'jht telegram pair --all es interactivo: para las automatizaciones vincula un rol cada vez.' ;;
    line.job_hunter_team_non_ancora) printf '%s' 'Job Hunter Team aún no está arrancado: ejecuta '\''jht up'\'' (la primera vez, '\''jht setup'\'').' ;;
    line.job_hunter_team_non_installato) printf '%s' 'Job Hunter Team no está instalado del todo: en la carpeta del runtime falta el archivo de integridad (¿una instalación interrumpida?). Vuelve a ejecutar el instalador.' ;;
    line.l_overlay_seccomp_dell_accesso) printf '%s' 'El overlay seccomp del acceso no es un archivo normal.' ;;
    line.la_casella_di_posta_ora) printf '%s' 'El buzón de correo ahora está en el broker de secretos. Su contraseña la podían leer los agentes:' ;;
    line.la_connessione_podman_jht_non) printf '%s' 'La conexión Podman de JHT no admite el dispatcher de Compose.' ;;
    line.la_macchina_e_pronta_ma) printf '%s' 'La máquina está lista, pero no he podido activar el trim semanal del disco.' ;;
    line.la_macchina_e_stata_ricreata) printf '%s' 'La máquina se ha vuelto a crear, pero el estado del broker no ha superado la verificación/importación.' ;;
    line.la_macchina_podman_s_vede) printf '%s' 'La máquina Podman '\''%s'\'' ve más carpetas del Mac de las que necesita JHT (~/.jht y ~/Documents/Job Hunter Team).' ;;
    line.la_nuova_macchina_podman_s) printf '%s' 'La nueva máquina Podman '\''%s'\'' no se ha creado.' ;;
    line.legacy_cleanup_failed.i_token_nuovi_sono_al) printf '%s' 'los tokens nuevos están a salvo, pero la copia antigua de %s sigue en ~/.jht; cambio definitivo rechazado.' ;;
    line.legacy_cleanup_failed.il_nuovo_token_al_sicuro) printf '%s' 'el token nuevo está a salvo, pero el token antiguo sigue en ~/.jht; cambio definitivo rechazado.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch) printf '%s' 'el equipo sigue detenido porque no se ha conservado el inventario de Telegram del host.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_2) printf '%s' 'el equipo sigue detenido porque no se ha conservado el inventario de Telegram del host.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_3) printf '%s' 'el equipo sigue detenido porque no se ha conservado el inventario de Telegram del host.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_4) printf '%s' 'el equipo sigue detenido porque no se ha conservado el inventario de Telegram del host.' ;;
    line.legacy_inventory_failed.le_impronte_non_sono_state) printf '%s' 'el servicio aislado no ha conservado las huellas.' ;;
    line.legacy_inventory_failed.lo_stato_del_container_agenti) printf '%s' 'no se puede verificar el estado del contenedor de los agentes.' ;;
    line.legacy_inventory_failed.migrazione_telegram_interrotta) printf '%s' 'migración de Telegram interrumpida.' ;;
    line.legacy_inventory_failed.non_posso_provare_che_jht) printf '%s' 'no puedo demostrar que ~/.jht no tenga tokens de Telegram.' ;;
    line.legacy_inventory_failed.non_riesco_a_fermare_gli) printf '%s' 'no puedo detener a los agentes antes del inventario del host.' ;;
    line.legacy_inventory_failed.non_riesco_a_leggere_i) printf '%s' 'no puedo leer los tokens antiguos en ~/.jht.' ;;
    line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti) printf '%s' 'roles antiguos no reconocidos.' ;;
    line.legacy_inventory_invalid.migrazione_telegram_interrotta_2) printf '%s' 'migración de Telegram interrumpida.' ;;
    line.legacy_migration_failed.s_resta_in_jht_credentials) printf '%s' '%s se queda en ~/.jht/credentials (respuesta del broker: %s).' ;;
    line.legacy_remove_failed.s_nel_broker_ma_la) printf '%s' '%s está en el broker, pero la copia en ~/.jht/credentials se ha quedado.' ;;
    line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso) printf '%s' '~/.jht/credentials/%s.json ha vuelto a aparecer después de la migración; eliminado sin importarlo.' ;;
    line.macchina_podman_ricreata_vede_solo) printf '%s' 'Máquina Podman creada de nuevo: solo ve ~/.jht y ~/Documents/Job Hunter Team. Se ha conservado el estado del broker; las CLI de los proveedores se vuelven a instalar solas en el primer '\''jht up'\'' (alrededor de un minuto, hace falta red: '\''jht providers versions'\'' lo confirma, '\''jht providers update'\'' las reinstala a mano). Arranca el equipo con '\''jht up'\'', vuelve a introducir la contraseña del correo y vuelve a iniciar sesión en LinkedIn.' ;;
    line.mail.address_prompt) printf '%s' 'Dirección del buzón:' ;;
    line.mail.app_password_prompt) printf '%s' 'Contraseña de aplicación (no se muestra):' ;;
    line.mail.dedicated_prompt) printf '%s' '¿Es un buzón DEDICADO a los avisos de empleo reenviados?' ;;
    line.mail_setup_opzione_sconosciuta_s) printf '%s' 'mail setup: opción desconocida %s' ;;
    line.mail_setup_password_vuota) printf '%s' 'mail setup: contraseña vacía' ;;
    line.migrazione_docker_podman_gia_verificata) printf '%s' 'Migración Docker -> Podman ya verificada; los volúmenes de Docker siguen intactos y aún contienen las contraseñas del correo, los accesos a los portales y los tokens de Telegram.' ;;
    line.migrazione_docker_podman_verificata_i) printf '%s' 'Migración Docker -> Podman verificada. Los volúmenes de Docker no se han eliminado y aún contienen las contraseñas del correo, los accesos a los portales y los tokens de Telegram: bórralos solo con una confirmación explícita en el futuro comando de limpieza.' ;;
    line.mount_repair_failed.s_non_si_puo_rendere) printf '%s' '%s no se puede hacer escribible para el contenedor (se ejecuta como uid %s) y no se ha arrancado nada. Haz una vez: sudo chown -R %s %s y vuelve a ejecutar '\''jht up'\''.' ;;
    line.nessun_provider_attivo_scegline_uno) printf '%s' 'no hay ningún proveedor activo: elige uno con '\''jht providers use glm'\''' ;;
    line.nessun_ruolo_ha_un_token) printf '%s' 'Ningún rol tiene un token antiguo: para un bot nuevo usa jht telegram pair <rol>.' ;;
    line.niente_da_fermare_nessun_container) printf '%s' 'nada que detener: no hay contenedores del proyecto.' ;;
    line.no_answer) printf '%s' 'ninguna respuesta' ;;
    line.no_answer_from_container) printf '%s' 'ninguna respuesta del contenedor' ;;
    line.non_autorizzabile_s) printf '%s' 'No se puede autorizar: %s.' ;;
    line.non_autorizzata_s) printf '%s' 'No autorizada: %s.' ;;
    line.non_ho_potuto_rimettere_s) printf '%s' 'No he podido volver a poner '\''%s'\'' como conexión Podman predeterminada.' ;;
    line.non_ho_potuto_rimuovere_il) printf '%s' 'No he podido quitar el marcador de migración del broker: %s' ;;
    line.non_riesco_a_creare_jht) printf '%s' 'No puedo crear ~/.jht o ~/Documents/Job Hunter Team para la máquina Podman.' ;;
    line.non_riesco_a_creare_jht_2) printf '%s' 'No puedo crear ~/.jht o ~/Documents/Job Hunter Team para la máquina Podman.' ;;
    line.non_riesco_a_determinare_l) printf '%s' 'No puedo determinar la imagen verificada del broker: el compose del runtime no ha respondido.' ;;
    line.non_riesco_a_esportare_in) printf '%s' 'No puedo exportar de forma verificable el estado del broker; la máquina no se ha borrado.' ;;
    line.non_riesco_a_fermare_i) printf '%s' 'No puedo detener los servicios antes de guardar el estado del broker.' ;;
    line.non_riesco_a_leggere_il) printf '%s' 'no puedo leer el documento: %s' ;;
    line.non_riesco_a_rimuovere_i) printf '%s' 'No puedo eliminar los contenedores detenidos de la versión anterior: «jht down» y luego «jht up».' ;;
    line.non_riesco_a_rimuovere_la) printf '%s' 'No puedo eliminar la máquina Podman '\''%s'\''.' ;;
    line.non_riesco_a_sapere_a) printf '%s' 'No puedo saber con qué Docker habla este ordenador: no se tocan los contenedores ni los volúmenes de jht.' ;;
    line.non_riesco_a_verificare_quali) printf '%s' 'No puedo verificar qué carpetas del Mac ve la máquina Podman '\''%s'\''.' ;;
    line.non_sono_riuscito_a_cancellare) printf '%s' 'No he podido borrar %s (pertenece a otro usuario, por ejemplo el del contenedor, y el contenedor de servicio no está disponible).' ;;
    line.opzione_di_clean_images_non) printf '%s' 'Opción de clean-images no compatible: %s (uso: jht clean-images [--json])' ;;
    line.opzione_non_riconosciuta_s) printf '%s' 'opción no reconocida: %s' ;;
    line.opzione_non_riconosciuta_s_2) printf '%s' 'opción no reconocida: %s' ;;
    line.opzione_non_riconosciuta_s_3) printf '%s' 'opción no reconocida: %s' ;;
    line.os_and_version_are_required) printf '%s' '--os y --version son obligatorios' ;;
    line.override_compose_per_podman_rootless) printf '%s' 'No se puede escribir el override de Compose para Podman rootless en %s.' ;;
    line.per_l_aiuto_di_s) printf '%s' 'Para la ayuda de '\''%s'\'' hace falta el contenedor en marcha: '\''jht up'\''.' ;;
    line.per_procedere_jht_podman_machine) printf '%s' 'Para continuar: jht podman-machine-recreate --confirm' ;;
    line.pin_dell_immagine_degli_strumenti) printf '%s' 'el pin de la imagen de las herramientas no es fiable' ;;
    line.podman_compose_non_trovato_installa) printf '%s' 'No se encuentra podman-compose: instala el paquete «podman-compose» (en Ubuntu: sudo apt install podman-compose).' ;;
    line.podman_machine_avviata_ma_il) printf '%s' 'La máquina Podman ha arrancado, pero el cliente de JHT no responde.' ;;
    line.podman_machine_jht_non_attiva) printf '%s' 'La máquina Podman de JHT no está en marcha. Ejecuta '\''jht up'\'' para arrancarla.' ;;
    line.podman_machine_non_avviabile) printf '%s' 'No se puede arrancar la máquina Podman.' ;;
    line.podman_machine_s_non_attiva) printf '%s' 'La máquina Podman '\''%s'\'' no está en marcha, la arranco...' ;;
    line.podman_non_trovato_reinstalla_il) printf '%s' 'No se encuentra Podman: vuelve a instalar el runtime de JHT.' ;;
    line.podman_non_trovato_reinstalla_il_2) printf '%s' 'No se encuentra Podman: vuelve a instalar el runtime de JHT.' ;;
    line.podman_non_trovato_reinstalla_il_3) printf '%s' 'No se encuentra Podman: vuelve a instalar el runtime de JHT.' ;;
    line.podman_other_machine_running.named) printf '%s' 'otra máquina Podman, %s, está encendida: apágala con '\''podman machine stop %s'\'' y vuelve a intentarlo.' ;;
    line.podman_other_machine_running.unnamed) printf '%s' 'otra máquina Podman está encendida: búscala con '\''podman machine list'\'', apágala con '\''podman machine stop <nombre>'\'' y vuelve a intentarlo.' ;;
    line.podman_remote_service_refused.su_linux_jht_usa_solo) printf '%s' 'en Linux JHT solo usa el Podman local de este usuario, pero el cliente podman habla con un servicio remoto.' ;;
    line.podman_rootful_refused.jht_su_linux_richiede_podman) printf '%s' 'En Linux, JHT necesita Podman rootless ejecutado por un usuario que no sea root.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non) printf '%s' 'el runtime de Podman rootless no responde.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non_2) printf '%s' 'el runtime de Podman rootless no responde.' ;;
    line.preparo_il_servizio_della_posta) printf '%s' 'Preparando el servicio de correo (solo se crea la primera vez que hace falta)…' ;;
    line.provider_attivo_non_riconosciuto_s) printf '%s' 'proveedor activo no reconocido: %s' ;;
    line.provider_podman_compose_non_trovato) printf '%s' 'No se encuentra el proveedor de Podman Compose: vuelve a instalar el runtime de JHT.' ;;
    line.questo_runtime_non_usa_una) printf '%s' 'Este runtime no usa una máquina Podman: no hay nada que volver a crear.' ;;
    line.reset_impossibile_cancellare_il_marcatore) printf '%s' 'reset: no se puede borrar el marcador de migración del broker %s.' ;;
    line.reset_impossibile_cancellare_il_marcatore_2) printf '%s' 'reset: no se puede borrar el marcador del broker %s.' ;;
    line.reset_impossibile_cancellare_il_volume) printf '%s' 'reset: no se puede borrar el volumen del broker %s (%s).' ;;
    line.reset_nome_volume_non_valido) printf '%s' 'reset: nombre de volumen no válido para %s; eliminación rechazada.' ;;
    line.reset_non_riesco_a_determinare) printf '%s' 'reset: no puedo determinar el proyecto Compose; no se han tocado los volúmenes del broker.' ;;
    line.reset_non_riesco_a_fermare) printf '%s' 'reset: no puedo detener el runtime; no se han tocado los volúmenes del broker.' ;;
    line.reset_ricerca_del_volume_s) printf '%s' 'reset: no se ha podido buscar el volumen %s.' ;;
    line.reset_ricerca_del_volume_s_2) printf '%s' 'reset: no se ha podido buscar el volumen %s.' ;;
    line.restano_token_legacy_per_s) printf '%s' 'Quedan tokens antiguos para: %s. Hasta que vincules también estos roles, %s se queda mudo en Telegram: vincúlalos todos en esta sesión (jht telegram pair --all).' ;;
    line.ricrea_la_macchina_podman_s) printf '%s' 'Vuelve a crear la máquina Podman '\''%s'\'': la detiene y la borra, y luego la vuelve a crear viendo solo ~/.jht y ~/Documents/Job Hunter Team.' ;;
    line.ricreala_con_jht_podman_machine) printf '%s' 'Vuelve a crearla con '\''jht podman-machine-recreate --confirm'\'': los archivos y el estado del broker se quedan, pero las CLI internas y los secretos se borran.' ;;
    line.risposta_del_container_non_valida) printf '%s' 'Respuesta del contenedor no válida: autorización retirada, no saldrá nada.' ;;
    line.ritirata_s_non_verra_inviata) printf '%s' 'Retirada la #%s: no se enviará.' ;;
    line.ritiro_non_riuscito_s) printf '%s' 'No se ha podido retirar: %s.' ;;
    line.runtime_host_non_attendibile_path) printf '%s' 'runtime del host no fiable (ruta, propietario, permisos o SHA-256)' ;;
    line.runtime_host_protetto_non_installabile) printf '%s' 'no se puede instalar el runtime protegido del host; no se usa el antiguo ~/.jht/runtime' ;;
    line.runtime_migration_changed.checksum_diverso_per_s_dopo) printf '%s' 'checksum distinto para %s después de la migración.' ;;
    line.runtime_migration_changed.s_non_corrisponde_piu_al) printf '%s' '%s ya no coincide con el marcador verificado.' ;;
    line.runtime_migration_checksum_mismatch.s_non_ha_superato_la) printf '%s' '%s no ha superado la verificación.' ;;
    line.runtime_migration_docker_missing.il_client_docker_originale_non) printf '%s' 'el cliente Docker original no está disponible.' ;;
    line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata) printf '%s' 'hace falta la imagen de JHT fijada por digest.' ;;
    line.runtime_migration_image_missing.la_stessa_immagine_jht_deve) printf '%s' 'la misma imagen de JHT tiene que existir en Docker y en Podman.' ;;
    line.runtime_migration_interrupted.copia_incompleta_di_s_il) printf '%s' 'copia incompleta de %s; el origen en Docker está intacto.' ;;
    line.runtime_migration_podman_missing.podman_non_e_disponibile) printf '%s' 'Podman no está disponible.' ;;
    line.runtime_migration_source_missing.s_manca_in_docker_ma) printf '%s' '%s falta en Docker pero existe en Podman; no lo sobrescribo.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_docker) printf '%s' 'detén antes el equipo de Docker.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_podman) printf '%s' 'detén antes el equipo de Podman.' ;;
    line.runtime_o_container_jht_non) printf '%s' 'runtime o contenedor de JHT no disponible' ;;
    line.ruoli_da_abbinare_in_questa) printf '%s' 'Roles que vincular en esta sesión: %s' ;;
    line.s_e_un_collegamento_non) printf '%s' '%s es un enlace: no lo sigo y no lo borro.' ;;
    line.s_ha_gi_un_bot) printf '%s' '%s ya tiene un bot vinculado: solo quito su copia antigua.' ;;
    line.s_needs_a_value) printf '%s' '%s necesita un valor' ;;
    line.s_non_e_una_cartella) printf '%s' '%s no es una carpeta: no la borro.' ;;
    line.saltato_non_trovato_volume_broker) printf '%s' 'Omitido (no encontrado): volumen del broker %s' ;;
    line.script_s_non_ancora_installato) printf '%s' 'el script %s aún no está instalado: '\''jht upgrade'\'' (o un '\''jht integration add/remove'\'') y vuelve a intentarlo' ;;
    line.script_s_non_scaricabile_controlla) printf '%s' 'no se puede descargar el script %s: revisa la red o ejecuta '\''jht upgrade'\''' ;;
    line.serve_un_terminale_l_autorizzazione) printf '%s' 'Hace falta un terminal: la autorización se confirma a mano.' ;;
    line.status.caller_env) printf '%s' 'En el entorno de este terminal están definidas: %s. El contenedor se creó sin ellas: quita la variable (unset) y vuelve a intentarlo.' ;;
    line.status.provider_said) printf '%s' 'El proveedor ha dicho: %s' ;;
    line.status.unattestable) printf '%s' 'contenedor '\''%s'\'' no verificable: hay algo que no se consigue verificar (una configuración distinta de la esperada, o el motor que no responde); no quiere decir que no esté en marcha.' ;;
    line.sudo_chown_fallito_su_s) printf '%s' 'sudo chown ha fallado en %s (puede que haga falta '\''sudo %s up'\'')' ;;
    line.telegram_isolato_attivo_il_bridge) printf '%s' 'Telegram aislado activo; los agentes ya no pueden volver a activar el bridge antiguo.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_3) printf '%s' 'el compose del runtime instalado no se puede leer, no se sabe si tiene el servicio de Telegram aislado.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_4) printf '%s' 'el compose del runtime instalado no se puede leer, no se sabe si tiene el servicio de Telegram aislado.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_3) printf '%s' 'el runtime instalado es más antiguo y no tiene el servicio de Telegram aislado.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_4) printf '%s' 'el runtime instalado es más antiguo y no tiene el servicio de Telegram aislado.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non) printf '%s' 'el servicio de Telegram aislado no está activo o no se puede verificar.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non_2) printf '%s' 'el servicio de Telegram aislado no está activo o no se puede verificar.' ;;
    line.the_setup_keeps_the_key) printf '%s' 'La configuración guarda la clave: ya puedes borrar el archivo de este ordenador (%s).' ;;
    line.togli_remote_true_da_containers) printf '%s' 'Quita remote = true de containers.conf (o CONTAINERS_CONF) para este usuario y vuelve a intentarlo.' ;;
    line.unattestable.autostart) printf '%s' 'No se puede verificar que el contenedor JHT existente sea nuestro; arranque automático denegado.' ;;
    line.unattestable.existing) printf '%s' 'No se puede verificar que el contenedor JHT existente sea nuestro; operación interrumpida.' ;;
    line.unattestable.logs) printf '%s' 'No se puede verificar que el contenedor JHT sea nuestro; lectura de los logs denegada.' ;;
    line.unattestable.other) printf '%s' 'No se puede verificar que el contenedor JHT sea nuestro; operación denegada.' ;;
    line.unattestable.recreate) printf '%s' 'No se puede verificar que el contenedor JHT sea nuestro; recreación denegada.' ;;
    line.unattestable.restart) printf '%s' 'No se puede verificar que el contenedor JHT sea nuestro; reinicio denegado.' ;;
    line.unattestable.stop) printf '%s' 'No se puede verificar que el contenedor JHT sea nuestro; parada denegada.' ;;
    line.unknown_argument_s) printf '%s' 'argumento desconocido: %s' ;;
    line.upgrade.activate) printf '%s' 'Activando el nuevo runtime...' ;;
    line.upgrade.broker_restart_failed) printf '%s' 'el broker de secretos no ha vuelto a arrancar. Qué hacer: jht up' ;;
    line.upgrade.check_available) printf '%s' 'Comprobación: hay una actualización, %s (%s) -> %s. %s. Para aplicarla: jht upgrade' ;;
    line.upgrade.check_none) printf '%s' 'Comprobación: no hay actualizaciones, %s (%s) ya es la última. %s.' ;;
    line.upgrade.check_only) printf '%s' 'Comprobación: %s.' ;;
    line.upgrade.disk_room) printf '%s' 'La actualización descarga unos %s GiB, y después de la descarga a los agentes les quedarían menos de los %s GiB de disco que necesitan: ahora hay %s GiB libres. Libera al menos %s GiB más (vacía la Papelera, borra los archivos grandes que no necesites) y vuelve a intentarlo: no se ha descargado ni cambiado nada (solo se han quitado las versiones antiguas de Job Hunter Team que nada usaba).' ;;
    line.upgrade.done) printf '%s' 'Actualización completada: %s (%s) -> %s (%s). %s' ;;
    line.upgrade.failed) printf '%s' 'Actualización no completada (%s): %s. %s' ;;
    line.upgrade.full_pull_failed) printf '%s' 'la nueva imagen completa no ha llegado, se queda la antigua. Qué hacer: jht tools pull' ;;
    line.upgrade.helper_install_failed) printf '%s' 'los nuevos scripts del host se obtienen en la primera petición o con otro '\''jht upgrade'\''' ;;
    line.upgrade.interrupted) printf '%s' 'Se ha detectado una actualización interrumpida: restauro la última versión verificada...' ;;
    line.upgrade.keep_old) printf '%s' 'Imágenes de JHT antiguas: se conservan todas (JHT_KEEP_OLD_IMAGES=1).' ;;
    line.upgrade.publish) printf '%s' 'Publicando la configuración candidata verificada...' ;;
    line.upgrade.pull_full) printf '%s' 'Descargando la imagen completa actualizada...' ;;
    line.upgrade.pull_latest) printf '%s' 'Descargando la imagen más reciente...' ;;
    line.upgrade.pull_runtime) printf '%s' 'Descargando el runtime actualizado...' ;;
    line.upgrade.restored) printf '%s' 'Runtime anterior restaurado.' ;;
    line.upgrade.telegram_restart_failed) printf '%s' 'el servicio Telegram aislado no ha vuelto a arrancar. Qué hacer: jht up' ;;
    line.upgrade.verify) printf '%s' 'Verificando el runtime actualizado...' ;;
    line.uso_jht_apply_relink_account) printf '%s' 'uso: jht apply relink-account' ;;
    line.uso_jht_apply_request_cancel) printf '%s' 'uso: jht apply request|cancel <id>' ;;
    line.uso_jht_apply_request_cancel_2) printf '%s' 'uso: jht apply request|cancel <id>' ;;
    line.uso_jht_artifact_upload_file) printf '%s' 'uso: jht artifact upload ARCHIVO [--json]' ;;
    line.uso_jht_artifact_upload_file_2) printf '%s' 'uso: jht artifact upload ARCHIVO [--json]' ;;
    line.uso_jht_mail_setup_status) printf '%s' 'uso: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <dirección|@dominio>|drafts|approve <id>|discard <id>|journal|delete|migrate' ;;
    line.uso_jht_migrate_runtime_podman) printf '%s' 'uso: jht migrate-runtime podman' ;;
    line.uso_jht_profile_import_file) printf '%s' 'uso: jht profile import ARCHIVO [--replace] [--json]' ;;
    line.uso_jht_profile_import_file_2) printf '%s' 'uso: jht profile import ARCHIVO [--replace] [--json]' ;;
    line.uso_jht_profile_validate_file) printf '%s' 'uso: jht profile validate [ARCHIVO] [--strict] [--json]' ;;
    line.uso_jht_screen_on_off) printf '%s' 'uso: jht screen on | off | status [--json]' ;;
    line.uso_jht_telegram_chat_id) printf '%s' 'uso: jht telegram chat-id <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_pair_assistente) printf '%s' 'uso: jht telegram pair <assistente|capitano|mentor>|--all' ;;
    line.uso_jht_telegram_remove_assistente) printf '%s' 'uso: jht telegram remove <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_status_pair) printf '%s' 'uso: jht telegram status|pair <rol>|pair --all|chat-id <rol>|remove <rol>' ;;
    line.uso_jht_ticket_open_posizione) printf '%s' 'uso: jht ticket open POSICIÓN TEXTO [--kind TIPO] [--attach ARCHIVO]' ;;
    line.uso_jht_ticket_open_posizione_2) printf '%s' 'uso: jht ticket open POSICIÓN TEXTO [--kind TIPO] [--attach ARCHIVO]' ;;
    line.versione_dell_immagine_configurata_per) printf '%s' 'Versión de la imagen configurada. Para la de la CLI en ejecución: '\''jht up'\'' y luego '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_2) printf '%s' 'Versión de la imagen configurada. Para la de la CLI en ejecución: '\''jht up'\'' y luego '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_3) printf '%s' 'Versión de la imagen configurada. Para la de la CLI en ejecución: '\''jht up'\'' y luego '\''jht --version'\''.' ;;
    line.versione_di_podman_compose_non) printf '%s' 'No se puede leer la versión de podman-compose.' ;;
    line.versione_non_supportata_servono_podman) printf '%s' 'Versión no compatible: hace falta podman >= %s (encontrado: %s) y podman-compose >= %s (encontrado: %s).' ;;
    line.versione_non_supportata_sul_mac) printf '%s' 'Versión no compatible: en el Mac hace falta podman %s.%s o un %s.x posterior (no 6.2 o superior; encontrado: %s) y podman-compose %s (encontrado: %s). Si has actualizado Homebrew más allá de la serie %s, actualiza JHT (curl -fsSL https://jobhunterteam.ai/install.sh | bash).' ;;
    migrate.left) printf '%s' 'No copiado o no verificado: el volumen %s.' ;;
    monitor.window_failed) printf '%s' 'monitor_window_unavailable: aquí no se puede abrir una ventana de terminal. Ejecuta '\''jht monitor'\'' en el terminal actual (o dentro de tu sesión de tmux).' ;;
    monitor.window_invalid) printf '%s' 'monitor_window_invalid: usa '\''jht monitor --window'\'' sin otras opciones.' ;;
    removed.office) printf '%s' ''\''jht %s'\'' se eliminó en la 0.4.0 junto con la oficina de Godot: usa los comandos jht (jht help).' ;;
    status.container) printf '%s' 'Contenedor' ;;
    status.image) printf '%s' 'Imagen' ;;
    status.next_other) printf '%s' 'Arranca el equipo con: jht up' ;;
    status.next_running) printf '%s' 'Quién está trabajando: jht agents' ;;
    status.no_options) printf '%s' ''\''jht status'\'' no admite opciones (%s): ejecútalo como '\''jht status'\''.' ;;
    status.not_running) printf '%s' 'El contenedor del equipo no está en marcha.' ;;
    status.not_running_next) printf '%s' 'Arráncalo con: jht up' ;;
    status.running) printf '%s' 'en marcha desde %s' ;;
    status.state) printf '%s' '%s desde %s' ;;
    status.title) printf '%s' 'Estado' ;;
    team.stopped) printf '%s' 'Job Hunter Team está detenido: '\''jht up'\'' lo vuelve a arrancar.' ;;
    tools.arriving) printf '%s' 'Las herramientas de los Scout están en camino: la imagen completa se descarga en segundo plano (unos 3 GB). La búsqueda de puestos empieza sola cuando lleguen; no tienes que hacer nada.' ;;
    tools.chat_reconnecting) printf '%s' 'El equipo pasa a las herramientas completas de los Scout, así que el chat se detiene un momento: vuelve solo en cuanto el equipo esté en marcha de nuevo (un par de minutos).' ;;
    tools.chat_resumed) printf '%s' 'El equipo ya usa las herramientas completas: sigamos.' ;;
    tools.chat_switched) printf '%s' 'El equipo pasa a las herramientas completas de los Scout, así que este chat se ha cerrado. Vuelve a abrirlo en un par de minutos con jht team chat.' ;;
    tools.chat_update_closed) printf '%s' 'JHT se está actualizando, así que este chat se ha cerrado. Vuelve a abrirlo en un par de minutos con jht team chat.' ;;
    tools.chat_update_resumed) printf '%s' 'JHT ya está actualizado: sigamos.' ;;
    tools.chat_updating) printf '%s' 'JHT se está actualizando, así que el chat se detiene un momento: vuelve solo en un minuto o dos.' ;;
    tools.disk_low) printf '%s' 'Las herramientas de los Scout no se han descargado: necesitan unos %s GiB libres en el disco y hay %s GiB, así que el equipo aún no puede buscar puestos. Libera espacio (vacía la Papelera, borra los archivos grandes que no necesites) y luego ejecuta jht up: la descarga vuelve a empezar sola.' ;;
    tools.engine_down) printf '%s' 'No se puede leer el estado de las herramientas de los Scout: el motor de contenedores no responde. Arráncalo con jht up.' ;;
    tools.failed) printf '%s' 'La descarga de las herramientas de los Scout ha fallado, así que el equipo aún no puede buscar puestos. Ejecuta jht tools pull para reintentarlo (jht up también lo reintenta).' ;;
    tools.not_started) printf '%s' 'La descarga de las herramientas de los Scouts no ha empezado, así que el equipo aún no puede buscar puestos. Lanza jht tools pull para iniciarla (jht up también la inicia).' ;;
    tools.ready) printf '%s' 'Las herramientas de los Scout ya están aquí: el equipo busca con la imagen completa.' ;;
    tools.switch_failed) printf '%s' 'Las herramientas de los Scout ya están aquí, pero el equipo no se ha podido reiniciar con ellas: ejecuta jht down y luego jht up.' ;;
    tools.switch_wait) printf '%s' 'El equipo está pasando a las herramientas completas de los Scout: espero a que vuelva a arrancar (un par de minutos como mucho).' ;;
    tools.waiting) printf '%s' 'Las herramientas de los Scout ya están aquí: el equipo pasa a ellas solo cuando el onboarding esté cerrado.' ;;
    uninstall.bad_home) printf '%s' 'HOME no es válida: eliminación rechazada.' ;;
    uninstall.colima_busy) printf '%s' 'Colima sigue en marcha: la arrancó el instalador de JHT, pero dentro hay otros contenedores en marcha, así que la dejo encendida. Para detenerla: colima stop.' ;;
    uninstall.colima_running) printf '%s' 'Colima sigue en marcha: no la arrancó el instalador de JHT (ya estaba encendida o no es la estándar), así que la dejo encendida, y puede que sea tuya. Para detenerla: colima stop.' ;;
    uninstall.colima_stop_failed) printf '%s' 'No se ha podido detener Colima. Para detenerla: colima stop.' ;;
    uninstall.colima_stopping) printf '%s' 'Deteniendo la máquina virtual de Colima, que arrancó el instalador de JHT y donde no hay nada más en marcha; tus carpetas del Mac se quedan.' ;;
    uninstall.compose_link_left) printf '%s' 'No se ha podido quitar el enlace al plugin de Docker Compose que creó el instalador de JHT: %s. Puedes borrarlo tú.' ;;
    uninstall.compose_link_removed) printf '%s' 'He quitado el enlace al plugin de Docker Compose que creó el instalador de JHT: %s. El plugin que instaló Homebrew se queda (brew uninstall docker-compose lo quita).' ;;
    uninstall.images_removed) printf '%s' 'Eliminadas %s imágenes de JHT: la básica, la completa y las antiguas.' ;;
    uninstall.left.commands) printf '%s' 'No eliminados: el comando jht o las líneas de PATH que añadió el instalador.' ;;
    uninstall.left.data) printf '%s' 'No se han borrado los datos de JHT indicados arriba. El comando jht y el runtime siguen ahí: vuelve a ejecutar '\''jht uninstall --confirm --purge'\'' cuando lo hayas resuelto.' ;;
    uninstall.left.images) printf '%s' 'No eliminadas: algunas imágenes de JHT (el motor las ha rechazado). Vuelve a ejecutar '\''jht uninstall --confirm'\'' cuando nada más las use.' ;;
    uninstall.left.machine) printf '%s' 'No eliminados: la máquina Podman jht-podman o los contenedores y volúmenes de JHT, con los secretos guardados. Vuelve a ejecutar '\''jht uninstall --confirm'\'' cuando Podman o Docker respondan.' ;;
    uninstall.left.runtime) printf '%s' 'No eliminado: el runtime de JHT en el host.' ;;
    uninstall.loss) printf '%s' 'También se borran la contraseña del correo y los tokens de Telegram guardados; ~/.jht y Documentos se quedan, y con ellos la sesión de LinkedIn guardada (secrets/linkedin-profile y .cache/linkedin): bórrala con jht reset --scope creds.' ;;
    uninstall.loss_purge) printf '%s' 'También se borran la contraseña del correo y los tokens de Telegram guardados.' ;;
    uninstall.machine_kept) printf '%s' 'La máquina Podman '\''%s'\'' no la creó el instalador de JHT (ya estaba o no es la estándar jht-podman), así que no la elimino: puede que sea tuya. Los volúmenes y la imagen de JHT que tiene dentro se quedan con ella. Para eliminarla: podman machine stop %s y luego podman machine rm %s.' ;;
    uninstall.machine_removing) printf '%s' 'Eliminando la máquina Podman '\''%s'\'', que creó el instalador de JHT: todo lo que tiene dentro se va con ella (los volúmenes y la imagen de JHT); tus carpetas del Mac se quedan.' ;;
    uninstall.phase.commands) printf '%s' 'Eliminando el comando jht y las líneas de PATH que añadió el instalador...' ;;
    uninstall.phase.data) printf '%s' 'Borrando ~/.jht y la carpeta Documentos (--purge)...' ;;
    uninstall.phase.images) printf '%s' 'Eliminando las imágenes de JHT (la básica, la completa y las antiguas)...' ;;
    uninstall.phase.machine) printf '%s' 'Eliminando la máquina Podman, o los contenedores y volúmenes de JHT...' ;;
    uninstall.phase.runtime) printf '%s' 'Eliminando el runtime del host...' ;;
    uninstall.purge_loss) printf '%s' 'Con --purge también se borran ~/.jht y ~/Documents/Job Hunter Team: configuración, base de datos, CV y resultados. No hay vuelta atrás.' ;;
    uninstall.runtime_choice_unreadable) printf '%s' 'No se puede leer qué runtime de JHT se eligió: no se ha eliminado nada.' ;;
    uninstall.usage) printf '%s' 'uso: jht uninstall --confirm [--purge]' ;;
    uninstall.usage_stays) printf '%s' 'Podman, podman-compose, Docker, Colima y Homebrew también se quedan.' ;;
    uninstall.usage_what) printf '%s' 'Elimina el runtime local de JHT: la máquina Podman jht-podman o los contenedores, volúmenes e imágenes de JHT (la básica y la completa, con los nombres de repositorio ghcr.io/leopu00/jht, jht y localhost/jht), el runtime del host y el comando jht.' ;;
    up.docker_legacy) printf '%s' 'Este ordenador ejecuta JHT en Docker, y su motor no responde. Desde la 0.4, JHT solo funciona con Podman. Tus datos se quedan: ~/.jht y ~/Documents/Job Hunter Team son carpetas de este ordenador. Para pasar a Podman: jht uninstall --confirm (conserva esas dos carpetas), vuelve a ejecutar el instalador y luego jht setup con tu clave API (la clave, la contraseña del correo y los tokens de Telegram estaban en los volúmenes de Docker: tendrás que darlos otra vez). Para seguir con Docker por ahora, arranca tú su motor y vuelve a ejecutar jht up.' ;;
    up.done) printf '%s' 'Job Hunter Team arrancado.' ;;
    up.engine_lost) printf '%s' 'La máquina Podman se ha detenido mientras arrancaba el equipo (%s). No has perdido nada: tus datos están en los volúmenes y en tus carpetas. Vuelve a ejecutar jht up: arranca la máquina y el equipo.' ;;
    up.storage_damaged) printf '%s' 'La imagen del equipo se ha dañado en el disco de la máquina Podman (la máquina se apagó de golpe mientras la escribía): la vuelvo a descargar y vuelvo a crear los contenedores. Tus datos están en los volúmenes y en tus carpetas, y se quedan. Tarda unos minutos.' ;;
    up.storage_repair_failed) printf '%s' 'No se ha podido reparar la imagen del equipo en la máquina Podman. '\''jht uninstall --confirm'\'' y luego el instalador crean una máquina nueva (tus carpetas ~/.jht y Documentos se quedan).' ;;
    *) return 1 ;;
  esac
}
jht_text_de() {
  case "$1" in
    compose.missing) printf '%s' 'docker compose fehlt: Die Engine antwortet, aber der Befehl «docker compose» existiert nicht (JHT braucht das Compose-v2-Plugin). Auf dem Mac: brew install docker-compose, dann mkdir -p ~/.docker/cli-plugins && ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose. Unter Linux: Installiere das Paket docker-compose-v2 (apt) oder docker-compose-plugin (dnf). Führe dann den Befehl erneut aus.' ;;
    config.changed_down) printf '%s' 'config_changed_while_running: Das Team wurde mit einer anderen als der aktuellen Konfiguration gestartet (sie hat sich während des Laufs geändert, oder es gab eine Neuinstallation); es wird gestoppt.' ;;
    config.changed_other) printf '%s' 'config_changed_while_running: Das Team läuft mit einer anderen als der erwarteten Konfiguration; sie wird nur zum Stoppen verwendet.' ;;
    config.changed_start) printf '%s' 'config_changed_while_running: Die Konfiguration hat sich geändert, während JHT lief (jht config set, über die Website oder die App geänderte Einstellungen oder eine Neuinstallation); das laufende Team lässt sich daher nicht verifizieren. Stoppe es mit «jht down» und starte es dann mit «jht up».' ;;
    config.changed_stopped) printf '%s' 'config_changed_stopped: Die gestoppten Container des Teams stammen aus der früheren Version: Sie werden mit der neuen Konfiguration neu erstellt (die Volumes mit den Daten bleiben).' ;;
    container.starting) printf '%s' 'Container '\''%s'\'' läuft nicht, starte ihn...' ;;
    doctor.host_config_none) printf '%s' 'noch keine Konfiguration: '\''jht setup'\''' ;;
    doctor.host_config_ok) printf '%s' 'Konfiguration vorhanden' ;;
    doctor.host_engine_fail) printf '%s' 'Container-Engine nicht erreichbar' ;;
    doctor.host_engine_ok) printf '%s' 'Container-Engine erreichbar' ;;
    doctor.host_more) printf '%s' 'Für die vollständigen Prüfungen (Konfiguration, Anbieter, Datenbank, Agenten): '\''jht up'\'', dann '\''jht doctor'\''.' ;;
    doctor.host_runtime_fail) printf '%s' 'JHT-Runtime fehlt oder wurde verändert: '\''jht upgrade'\'' installiert sie neu' ;;
    doctor.host_runtime_ok) printf '%s' 'JHT-Runtime intakt' ;;
    doctor.host_team_off) printf '%s' 'Team aus: '\''jht up'\'' startet es' ;;
    doctor.host_team_unattestable) printf '%s' 'Ein Container des Teams ist da, lässt sich aber nicht als unserer bestätigen: Nichts wurde angefasst ('\''jht status'\'' sagt mehr)' ;;
    doctor.host_title) printf '%s' 'Job Hunter Team: Das Team ist aus (sein Container läuft nicht). Prüfungen von diesem Computer aus:' ;;
    down.done) printf '%s' 'Job Hunter Team gestoppt.' ;;
    down.still_running) printf '%s' 'Das Team hat nicht gestoppt: Ein Container des Projekts lief nach zwei Versuchen wieder (in seiner ersten Minute kann er von selbst neu starten). Führe '\''jht down'\'' noch einmal aus; wenn er bleibt, '\''jht doctor'\''.' ;;
    download.asset_failed) printf '%s' 'Download fehlgeschlagen: %s' ;;
    download.bad_version) printf '%s' 'Ungültige Version: %s. Beispiel: 0.3.5.' ;;
    download.copy_failed) printf '%s' 'Das Kopieren des geprüften Downloads ans Ziel ist fehlgeschlagen' ;;
    download.deb_only_linux) printf '%s' '--deb gibt es nur für Linux.' ;;
    download.dest_appeared) printf '%s' 'Das Ziel ist während des Downloads aufgetaucht; es wurde nicht überschrieben' ;;
    download.dest_is_link) printf '%s' 'Das Ziel ist ein Link: %s' ;;
    download.dest_not_file) printf '%s' 'Das Ziel existiert und ist keine Datei: %s' ;;
    download.fetching) printf '%s' 'Lade %s herunter...' ;;
    download.hash_invalid) printf '%s' 'Ungültige SHA-256 für %s: erwartet %s, erhalten %s.' ;;
    download.intel_mac) printf '%s' 'Die macOS-App von 0.4 läuft nur auf Macs mit Apple silicon (M1 und neuer); das hier ist ein Intel-Mac, den 0.4 nicht unterstützt. Nichts wurde heruntergeladen.' ;;
    download.linux_no_app) printf '%s' 'In dieser Version gibt es keine Desktop-App für Linux: Nutze install.sh. Nichts wurde heruntergeladen.' ;;
    download.mismatch_existing) printf '%s' 'Die Datei %s existiert, aber ihre SHA-256 stimmt nicht: Sie wurde nicht überschrieben.' ;;
    download.mkdir_failed) printf '%s' 'Der Zielordner lässt sich nicht erstellen: %s' ;;
    download.no_curl) printf '%s' 'curl nicht gefunden: Es wird zum Herunterladen des Release gebraucht.' ;;
    download.no_tmp) printf '%s' 'Der temporäre Ordner konnte nicht erstellt werden' ;;
    download.parent_unreachable) printf '%s' 'Der Zielordner ist nicht erreichbar: %s' ;;
    download.present_verified) printf '%s' 'Datei schon vorhanden und geprüft: %s' ;;
    download.release_no_app) printf '%s' 'Dieses Release (v%s) hat keine App für macOS: Nutze 0.4.0 oder neuer. Nichts wurde heruntergeladen.' ;;
    download.saved_in) printf '%s' 'Gespeichert in: %s' ;;
    download.sha_verified) printf '%s' 'SHA-256 geprüft: %s' ;;
    download.shared_folder) printf '%s' 'Das Ziel liegt in einem Ordner, den du mit dem Team teilst (%s): Wähle einen außerhalb, z. B. ~/Downloads.' ;;
    download.sum_missing) printf '%s' 'Keine SHA-256 angegeben für %s.' ;;
    download.sums_failed) printf '%s' 'Download fehlgeschlagen: SHA256SUMS von v%s' ;;
    download.unsupported_os) printf '%s' 'Nicht unterstütztes System: %s. Nutze windows oder macos.' ;;
    download.windows_missing) printf '%s' 'Windows ist nicht Teil von 0.4.0: Das Release hat keinen Installer für Windows. Nichts wurde heruntergeladen.' ;;
    help.download) printf '%s' 'Verwendung: jht download --os windows|macos --version X.Y.Z [--output FILE]
  Die Desktop-App ist nicht Teil von 0.4.0: Für ein Release, das sie enthält, lädt der Befehl sie herunter, prüft ihre SHA-256 und speichert sie (standardmäßig in ~/Downloads).' ;;
    help.integration) printf '%s' 'Verwendung: jht integration <command>

  list [--json]                   die Integrationen und ihr Zustand
  status [ID] [--json]            der Zustand einer oder aller
  add ID [--json]                 fügt eine Integration hinzu
  remove ID [--purge --yes] [--remove-image] [--json]
                                  entfernt sie; --purge löscht auch ihre Daten (braucht --yes);
                                  --remove-image (nur screen und media) entfernt auch das Tool-Image

Erlaubt sind die IDs, die `jht integration list` zeigt. Nichts wird heruntergeladen oder gestartet,
bevor du es mit `add` verlangst.' ;;
    help.linkedin) printf '%s' 'Verwendung: jht linkedin <command>

  login [--stop]    die Anmeldung von Hand bei LinkedIn (mit Google): ein Browser in einem eigenen Container, ohne
                    Netzwerk, dessen Fenster du in der App siehst und bedienst; --stop schließt alles
  status --json     sagt, ob die Anmeldung läuft und ob die LinkedIn-Sitzung gespeichert ist

Nichts wird heruntergeladen oder gestartet, bevor du es mit `login` verlangst.' ;;
    help.main) printf '%s' 'jht — Job Hunter Team

  Host-Befehle (funktionieren von hier aus):
    jht up                 startet den Container des Teams
    jht down               stoppt ihn
                           (mit --verbose siehst du auch die Zeilen der Engine)
    jht restart            startet ihn neu
    jht status             Zustand von Container und Team
    jht logs [-f]          Logs des Containers
    jht upgrade            aktualisiert auf das neueste Image
    jht clean-images [--json]
                           entfernt alte JHT-Images (behält das aktuelle, das
                           neueste der anderen und die genutzten); erlaubt
                           auch bei fast voller Festplatte
    jht setup              geführte Installation
    jht shell              Shell im Container
    jht profile import FILE [--replace]
                           gibt dem Team das Profil des Kandidaten (YAML)
    jht profile validate [FILE] [--strict] [--json]
                           prüft ein Profil (YAML), ohne etwas zu schreiben;
                           ohne FILE das des Teams
    jht mail setup         speichert das Postfach im Secrets-Broker
    jht mail drafts        von den Agenten geschriebene Mails, die auf dein Okay warten
    jht mail approve <id>  sendet sie; jht mail discard <id> verwirft sie
    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]
                           die Integrationen, die nach dem Setup dazukommen
                           (google, telegram, mail): Zustand von der Engine gelesen
    jht telegram status    Zustand des isolierten Telegram-Dienstes
    jht telegram pair ROLE fragt den Token ohne Echo auf dem Host-Computer ab, dann
                           zeigt es einen Code, den du dem Bot von deinem Telegram schickst
                           Für Automatisierungen: JSON auf stdin. Speichere den Token nicht
                           in ~/.jht; lösche außerhalb davon verwendete Dateien sofort.
    jht telegram pair --all koppelt alle alten Rollen in einer Sitzung
    jht telegram chat-id ROLE verlegt den Bot in einen anderen Chat, mit demselben Code
    jht reset              löscht Konfiguration und Volumes des Brokers
    jht migrate-runtime podman
                           kopiert und prüft die Docker-Volumes in Podman;
                           wählt die neue Runtime nicht und löscht Docker nicht
    jht podman-machine-recreate --confirm
                           erstellt die Podman-Maschine (macOS) neu, die dann
                           nur ~/.jht und ~/Documents/Job Hunter Team sieht
    jht uninstall --confirm entfernt die lokale Runtime (Podman-Maschine oder
                           Container und Volumes von jht, mit den gespeicherten Geheimnissen);
                           es bleiben ~/.jht, Documents, Podman und Docker
    jht uninstall --confirm --purge
                           wie oben, und löscht auch ~/.jht und
                           ~/Documents/Job Hunter Team (auch wenn sie dem
                           Container gehören, ohne sudo und ohne Rechte zu ändern)

  Alle anderen Befehle (positions, stats, team, providers, cron,
  working-hours, cloud...) laufen IM Container: Für ihre Hilfe
  muss der Container laufen.

      jht up && jht --help
' ;;
    help.screen) printf '%s' 'Verwendung: jht screen <command>

  on [--json]       startet den Live-Bildschirm des Closers: ein eigener Container, mit dem Stream nur auf 127.0.0.1
  off [--remove-image] [--json]
                    stoppt ihn und entfernt den Container; das Tool-Image bleibt auf der Festplatte, damit du ihn
                    ohne neuen Download wieder starten kannst: --remove-image entfernt es und gibt den Platz frei
  status [--json]   sagt, ob er läuft

Nichts wird heruntergeladen oder gestartet, bevor du es mit `on` verlangst. Der Stream ist nur zum Ansehen.' ;;
    help.setup) printf '%s' 'Verwendung: jht setup [options]

Ohne Optionen startet die geführte Installation. Mit --non-interactive wird nichts gefragt:
Alles wird über die Optionen angegeben.

  --non-interactive            keine Fragen
  --provider <name>            glm (Z.ai, Standard), kimi (Moonshot), openai oder claude (Anthropic)
  --harness <name>             pi (Standard)
  --api-key-file <path>        Datei mit dem API-Schlüssel (eine Zeile, nur für dich lesbar).
                               jht liest die Datei auf deinem Computer und gibt sie ans Setup weiter; bei glm
                               und kimi behält das Setup den Schlüssel für sich, nie in der Konfiguration
  --api-key-stdin              liest den API-Schlüssel von stdin (eine Zeile): nie auf der Befehlszeile
  --api-key <key>              der Schlüssel direkt hier, im Klartext (nicht erlaubt für glm und kimi)
  --secret-mode <mode>         wie der Schlüssel gespeichert wird: plaintext (Standard), env oder file
  --secret-env <name>          mit --secret-mode env: die Umgebungsvariable, die ihn enthält
  --secret-file <path>         mit --secret-mode file: die Datei, die ihn enthält
  --model <model>              das zu verwendende Modell
  --language <code>            die Sprache (zum Beispiel it oder en)
  --budget-usd <dollar>        wie viel das Team ausgeben darf, in Dollar (mit einer von --budget-minutes, --budget-days, --budget-until)
  --budget-minutes <n>         das Budget gilt so viele Minuten ab jetzt
  --budget-days <n>            das Budget gilt so viele Tage ab jetzt
  --budget-until <stunde>      das Budget gilt bis zu dieser Uhrzeit, 0-23 (der nächsten)
  --no-budget                  kein Ausgabenlimit (das Team hält nur beim Guthaben des Anbieters an)
  --skip-health                überspringt die abschließende Prüfung
  --reset                      beginnt mit einer sauberen Konfiguration neu

Beispiele:
  mit einem GLM-Schlüssel in einer Datei:
    jht setup --non-interactive --provider glm --harness pi --api-key-file schluessel.txt
  OpenAI mit einem API-Schlüssel, auf Pi (für Claude: --provider claude):
    jht setup --non-interactive --provider openai --harness pi --api-key-stdin' ;;
    help.tools) printf '%s' 'Verwendung: jht tools <Befehl>

  status --json   ob die Werkzeuge der Scouts (das vollständige Image) da, unterwegs oder fehlgeschlagen sind
  pull            lädt sie im Hintergrund herunter (jht up und jht setup starten das von selbst)
  switch          bringt das Team darauf, sobald das Onboarding abgeschlossen ist (der Download macht das von selbst)

Diese Hilfe startet nichts und lädt nichts herunter.' ;;
    host_setup.skip_done) printf '%s' 'host.env liegt in einem Ordner, der dem Container gehört (uid 1001): Der Host-Preflight ist schon erledigt, wird übersprungen.' ;;
    host_setup.skip_unknown) printf '%s' 'host.env liegt in einem Ordner, der dem Container gehört (uid 1001), und dieser Benutzer kann dort nicht schreiben: Der Host-Preflight wird übersprungen, aber host.env lässt sich nicht lesen oder nennt den Host-Typ nicht (local oder VPS): Der Typ bleibt '\''unknown'\''.' ;;
    keyfile.both) printf '%s' 'Nutze --api-key-file oder --api-key-stdin, nicht beides' ;;
    keyfile.not_file) printf '%s' 'Die an --api-key-file übergebene Datei muss eine normale Datei sein, kein Ordner und kein Link: %s' ;;
    keyfile.readable) printf '%s' 'Die Datei %s ist für andere Benutzer lesbar: chmod 600 darauf.' ;;
    keyfile.shape) printf '%s' 'Der Inhalt der an --api-key-file übergebenen Datei ist keine einzelne Zeile mit 16 bis 512 druckbaren Zeichen ohne Leerzeichen: %s' ;;
    keyfile.size) printf '%s' 'Die an --api-key-file übergebene Datei ist leer oder zu groß für einen Schlüssel (1 bis 4096 Bytes): %s' ;;
    keyfile.twice) printf '%s' '--api-key-file wurde zweimal angegeben' ;;
    keyfile.unreadable) printf '%s' 'Die an --api-key-file übergebene Datei lässt sich nicht lesen: %s' ;;
    line.abbinamento_annullato_nessuna_modifica) printf '%s' 'Kopplung abgebrochen: keine Änderung.' ;;
    line.abbinamento_di_s_non_riuscito) printf '%s' 'Kopplung von %s fehlgeschlagen: Die alten Kopien bleiben alle. Starte jht telegram pair --all erneut: Bereits gekoppelte Rollen fragen nicht nach einem weiteren Token.' ;;
    line.abbinamento_rifiutato_genera_un_token) printf '%s' 'Kopplung abgelehnt: Erzeuge einen neuen Token in BotFather (/revoke) und versuch es erneut.' ;;
    line.accedi_con_l_utente_jht) printf '%s' 'Melde dich mit dem rootless JHT-Benutzer an, den die Installation eingerichtet hat, und versuch es erneut.' ;;
    line.agent_restart_failed.inventario_conservato_ma_il_team) printf '%s' 'Inventur gesichert, aber das Team ist nicht neu gestartet. Was tun: jht up' ;;
    line.allineo_owner_di_s_a) printf '%s' 'Gleiche den Besitzer von %s an %s an (war uid %s)...' ;;
    line.annullato_niente_autorizzato) printf '%s' 'Abgebrochen: nichts autorisiert.' ;;
    line.anteprima_non_valida_niente_autorizzato) printf '%s' 'Vorschau ungültig: nichts autorisiert.' ;;
    line.apply.authorize) printf '%s' 'Autorisierst du diese Bewerbung?' ;;
    line.apply_relink_account_cloud_account) printf '%s' 'apply relink-account: Cloud-Konto nicht verfügbar. Führe zuerst jht cloud pair aus.' ;;
    line.attenzione_le_cli_interne_verranno) printf '%s' 'ACHTUNG: Die internen CLIs werden neu installiert und die Geheimnisse nicht aufbewahrt. Die Konfiguration und der Mail-Zustand bleiben, aber du musst das Mail-Passwort neu eingeben und dich erneut bei LinkedIn anmelden.' ;;
    line.autorizzata_s_verso_s_il) printf '%s' '#%s autorisiert, an %s: Der CLOSER nimmt sie in der nächsten Runde.' ;;
    line.bind_uid_conflict.uid_s_on_this_computer) printf '%s' 'uid %s ist auf diesem Computer das Konto '\''%s'\''. Der Container von Job Hunter Team läuft als uid %s, also würde diesem Konto ~/.jht gehören (deine Daten und die Portal-Zugangsdaten). Nichts wurde geändert. Starte JHT vom Konto '\''%s'\'' aus oder gib '\''%s'\'' eine andere uid, dann versuch es erneut.' ;;
    line.bot_abbinato_e_copia_legacy) printf '%s' 'Bot gekoppelt und alte Kopie entfernt. Es bleiben andere alte Tokens oder ein Token in der Umgebung des Containers: Entferne sie und schließ die Rotation vor dem Cutover ab.' ;;
    line.bot_token_invalid.controlla_il_token_generato_da) printf '%s' 'Prüfe den von BotFather erzeugten Token.' ;;
    line.broker_restart_failed.il_servizio_della_posta_non_4) printf '%s' 'Der Mail-Dienst ist nicht neu gestartet. Was tun: jht mail status' ;;
    line.broker_start_failed.il_servizio_della_posta_non_2) printf '%s' 'Der Mail-Dienst ist nicht gestartet.' ;;
    line.broker_start_failed.il_servizio_della_posta_non_3) printf '%s' 'Der Mail-Dienst antwortet nach 30 Sekunden nicht.' ;;
    line.broker_unavailable.il_broker_dei_segreti_esiste) printf '%s' 'Der Secrets-Broker existiert, lässt sich aber nicht als unserer bestätigen: Ich fasse ihn nicht an.' ;;
    line.broker_unavailable.il_broker_dei_segreti_non) printf '%s' 'Der Secrets-Broker ist nicht aktiv oder lässt sich nicht bestätigen.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato) printf '%s' 'Die Compose-Datei der installierten Runtime ist nicht lesbar; unklar, ob sie den Secrets-Broker hat.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato_2) printf '%s' 'Die Compose-Datei der installierten Runtime ist nicht lesbar; unklar, ob sie den Secrets-Broker hat.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio) printf '%s' 'Die installierte Runtime ist älter und hat keinen Secrets-Broker.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio_2) printf '%s' 'Die installierte Runtime ist älter und hat keinen Secrets-Broker.' ;;
    line.broker_unavailable.il_servizio_della_posta_non) printf '%s' 'Der Mail-Dienst existiert noch nicht: Er wird beim ersten Bedarf erstellt.' ;;
    line.cancellato_marcatore_migrazione_broker_s) printf '%s' 'Gelöscht: Migrationsmarker des Brokers %s' ;;
    line.cancellato_volume_broker_s_s) printf '%s' 'Gelöscht: Broker-Volume %s (%s)' ;;
    line.chown_fallito_su_s) printf '%s' 'chown auf %s fehlgeschlagen' ;;
    line.client_container_non_trovato_nel) printf '%s' 'Container-Client nicht im PATH gefunden. Repariere die JHT-Runtime.' ;;
    line.client_container_non_trovato_nel_2) printf '%s' 'Container-Client nicht im PATH gefunden. Repariere die JHT-Runtime.' ;;
    line.compose_extra_file_non_e) printf '%s' 'COMPOSE_EXTRA_FILE ist nicht das seccomp-Overlay des Zugangs: Ich mache nichts.' ;;
    line.compose_up_failed.podman_compose_up_e_uscito) printf '%s' 'podman-compose up hat mit %s beendet. Der Fehler von Podman steht oben.' ;;
    line.compose_up_timeout.podman_compose_up_non_ha) printf '%s' 'podman-compose up war nach %ss nicht fertig und wurde gestoppt. Ein Dienst ist nicht gestartet: Schau in «podman ps -a» und «podman logs jht».' ;;
    line.container_jht_non_verificabile_dopo) printf '%s' 'JHT-Container nach dem Vorgang nicht überprüfbar.' ;;
    line.container_s_non_attivo_leggere) printf '%s' 'Container '\''%s'\'' nicht aktiv: Das Lesen des Plans startet ihn nicht. Starte ihn mit '\''jht up'\'' und versuch es erneut.' ;;
    line.container_s_non_e_partito) printf '%s' 'Container '\''%s'\'' ist nicht innerhalb von 10s gestartet. Prüfe '\''jht logs'\''.' ;;
    line.cosa_fare_jht_mail_setup) printf '%s' 'Was tun: jht mail setup' ;;
    line.cosa_fare_jht_up) printf '%s' 'Was tun: jht up' ;;
    line.cosa_fare_jht_up_2) printf '%s' 'Was tun: jht up' ;;
    line.cosa_fare_jht_up_3) printf '%s' 'Was tun: jht up' ;;
    line.cosa_fare_jht_upgrade) printf '%s' 'Was tun: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_2) printf '%s' 'Was tun: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_3) printf '%s' 'Was tun: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_4) printf '%s' 'Was tun: jht upgrade' ;;
    line.cosa_fare_reinstalla_il_runtime) printf '%s' 'Was tun: Installiere die Runtime mit dem Installer neu' ;;
    line.cosa_fare_reinstalla_il_runtime_2) printf '%s' 'Was tun: Installiere die Runtime mit dem Installer neu' ;;
    line.cosa_fare_reinstalla_il_runtime_3) printf '%s' 'Was tun: Installiere die Runtime mit dem Installer neu' ;;
    line.cosa_fare_reinstalla_il_runtime_4) printf '%s' 'Was tun: Installiere die Runtime mit dem Installer neu' ;;
    line.cosa_fare_riprova_il_comando) printf '%s' 'Was tun: Versuch den Befehl erneut' ;;
    line.cosa_fare_riprova_il_comando_2) printf '%s' 'Was tun: Versuch den Befehl erneut' ;;
    line.data_dir_moved.jht_home_host_s_non) printf '%s' 'JHT_HOME_HOST=%s ist nicht %s. Das Team nutzt immer %s: Die Compose-Datei bindet es ein, die App liest es, und unter macOS ist es der einzige Datenordner, den die Podman-Maschine sieht. Entferne JHT_HOME_HOST oder verschiebe die Daten nach %s.' ;;
    line.data_dir_moved.jht_user_dir_host_s) printf '%s' 'JHT_USER_DIR_HOST=%s ist nicht %s. Das Team nutzt immer %s: Die Compose-Datei bindet es ein, und unter macOS ist es der einzige Dokumentenordner, den die Podman-Maschine sieht. Entferne JHT_USER_DIR_HOST oder verschiebe die Dokumente nach %s.' ;;
    line.disk_low.gli_agenti_richiedono_almeno_disk) printf '%s' 'Die Agenten brauchen mindestens %s GiB Speicherplatz — verfügbar: %s GiB. Um Platz freizugeben, führe '\''jht clean-images'\'' aus (entfernt nur alte Versionen von Job Hunter Team), leere den Papierkorb und lösche große Dateien, die du nicht brauchst, dann versuch es erneut: Es wurde nichts heruntergeladen oder geändert.' ;;
    line.docker_punta_a_s_che) printf '%s' 'Docker zeigt auf %s, das nicht dieser Computer ist: Die jht-Container und -Volumes dort werden nicht angefasst. Stell Docker wieder auf das lokale um (DOCKER_HOST oder docker context) und starte erneut.' ;;
    line.fermo_e_ricreo_la_macchina) printf '%s' 'Stoppe die Podman-Maschine '\''%s'\'' und erstelle sie neu...' ;;
    line.fino_ad_allora_la_posta) printf '%s' 'Bis dahin wird die Mail mit dem heutigen Passwort gelesen und gesendet; der Hinweis bleibt in jht mail status.' ;;
    line.genera_una_nuova_password_per) printf '%s' 'Erzeuge ein neues App-Passwort bei deinem Anbieter und speichere es mit: jht mail setup' ;;
    line.host_setup_sh_non_trovato) printf '%s' 'host-setup.sh nicht gefunden in %s — Host-Preflight übersprungen' ;;
    line.host_setup_sh_terminato_con) printf '%s' 'host-setup.sh mit Fehler beendet — ich mache weiter' ;;
    line.i_segreti_e_lo_stato) printf '%s' 'Die Geheimnisse und der Zustand des Brokers wurden gelöscht: Melde dich erneut bei den Portalen an und richte die Mail neu ein.' ;;
    line.identita_progetto_compose_non_valida) printf '%s' 'Compose-Projektidentität ungültig.' ;;
    line.il_broker_non_ha_registrato) printf '%s' 'Der Broker hat die Autorisierung nicht registriert: zurückgezogen, nichts wird gesendet.' ;;
    line.il_compose_non_indica_una) printf '%s' 'Die Compose-Datei nennt kein einzelnes gemeinsames Image für Team und Broker; Sicherung verweigert.' ;;
    line.il_container_s_non_c) printf '%s' 'Der Container '\''%s'\'' ist nicht da, aber andere Dienste des Projekts laufen: Ich stoppe sie.' ;;
    line.il_documento_deve_essere_un) printf '%s' 'Das Dokument muss eine normale Datei sein, kein Link: %s' ;;
    line.il_documento_supera_i_mb) printf '%s' 'Das Dokument ist größer als 10 MB' ;;
    line.il_file_del_profilo_supera) printf '%s' 'Die Profildatei ist größer als 64 KiB' ;;
    line.il_motore_dei_container_non) printf '%s' 'Die Container-Engine ist nicht aktiv: Nichts wurde entfernt.' ;;
    line.il_profilo_deve_essere_un) printf '%s' 'Das Profil muss eine normale Datei sein, kein Link: %s' ;;
    line.il_progetto_ha_container_che) printf '%s' 'Das Projekt hat Container, die weder das Team noch seine bestätigten Dienste sind: Ich fasse sie nicht an.' ;;
    line.il_runtime_podman_rootless_locale) printf '%s' 'Die lokale rootless Podman-Runtime antwortet nicht.' ;;
    line.il_servizio_s_del_progetto) printf '%s' 'Der Dienst '\''%s'\'' des Projekts läuft, lässt sich aber nicht als unserer bestätigen: Ich fasse ihn nicht an und stoppe sonst nichts.' ;;
    line.input_interrotto.token_non_letto) printf '%s' 'Token nicht gelesen.' ;;
    line.integration.install_hint) printf '%s' 'zum Installieren: '\''jht upgrade'\'' (oder ein '\''jht integration add <id>'\'')' ;;
    line.integration.not_installed) printf '%s' 'nicht vorhanden' ;;
    line.integration.not_installed_yet) printf '%s' 'noch nicht installiert' ;;
    line.interattivo_il_token_viene_chiesto) printf '%s' 'Interaktiv: Der Token wird ohne Echo abgefragt, dann bekommt der neue Bot einen Einmalcode von deinem Telegram. Automatisierungen: {"bot_token": ...} als JSON auf stdin; speichere den Token nicht in ~/.jht und lösche jede außerhalb davon verwendete Datei sofort.' ;;
    line.jht_home_host_o_jht) printf '%s' 'JHT_HOME_HOST oder JHT_USER_DIR_HOST zeigen woandershin: Ich lösche keine Ordner, die nicht die festen Ordner von JHT sind.' ;;
    line.jht_telegram_pair_all_interattivo) printf '%s' 'jht telegram pair --all ist interaktiv: Für Automatisierungen kopple eine Rolle nach der anderen.' ;;
    line.job_hunter_team_non_ancora) printf '%s' 'Job Hunter Team ist noch nicht gestartet: Führe '\''jht up'\'' aus (beim ersten Mal '\''jht setup'\'').' ;;
    line.job_hunter_team_non_installato) printf '%s' 'Job Hunter Team ist nicht vollständig installiert: Im Runtime-Ordner fehlt die Integritätsdatei (eine abgebrochene Installation?). Starte den Installer erneut.' ;;
    line.l_overlay_seccomp_dell_accesso) printf '%s' 'Das seccomp-Overlay des Zugangs ist keine normale Datei.' ;;
    line.la_casella_di_posta_ora) printf '%s' 'Das Postfach liegt jetzt im Secrets-Broker. Sein Passwort war für die Agenten lesbar:' ;;
    line.la_connessione_podman_jht_non) printf '%s' 'Die JHT-Podman-Verbindung unterstützt den Compose-Dispatcher nicht.' ;;
    line.la_macchina_e_pronta_ma) printf '%s' 'Die Maschine ist bereit, aber ich konnte den wöchentlichen Trim der Festplatte nicht aktivieren.' ;;
    line.la_macchina_e_stata_ricreata) printf '%s' 'Die Maschine wurde neu erstellt, aber der Zustand des Brokers hat die Prüfung/den Import nicht bestanden.' ;;
    line.la_macchina_podman_s_vede) printf '%s' 'Die Podman-Maschine '\''%s'\'' sieht mehr Ordner des Mac, als JHT braucht (~/.jht und ~/Documents/Job Hunter Team).' ;;
    line.la_nuova_macchina_podman_s) printf '%s' 'Die neue Podman-Maschine '\''%s'\'' wurde nicht erstellt.' ;;
    line.legacy_cleanup_failed.i_token_nuovi_sono_al) printf '%s' 'Die neuen Tokens sind sicher, aber die alte Kopie von %s ist noch in ~/.jht; Cutover verweigert.' ;;
    line.legacy_cleanup_failed.il_nuovo_token_al_sicuro) printf '%s' 'Der neue Token ist sicher, aber der alte Token ist noch in ~/.jht; Cutover verweigert.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch) printf '%s' 'Das Team bleibt gestoppt, weil die Telegram-Inventur des Hosts nicht gesichert wurde.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_2) printf '%s' 'Das Team bleibt gestoppt, weil die Telegram-Inventur des Hosts nicht gesichert wurde.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_3) printf '%s' 'Das Team bleibt gestoppt, weil die Telegram-Inventur des Hosts nicht gesichert wurde.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_4) printf '%s' 'Das Team bleibt gestoppt, weil die Telegram-Inventur des Hosts nicht gesichert wurde.' ;;
    line.legacy_inventory_failed.le_impronte_non_sono_state) printf '%s' 'Die Fingerabdrücke wurden vom isolierten Dienst nicht gesichert.' ;;
    line.legacy_inventory_failed.lo_stato_del_container_agenti) printf '%s' 'Der Zustand des Agenten-Containers lässt sich nicht bestätigen.' ;;
    line.legacy_inventory_failed.migrazione_telegram_interrotta) printf '%s' 'Telegram-Migration abgebrochen.' ;;
    line.legacy_inventory_failed.non_posso_provare_che_jht) printf '%s' 'Ich kann nicht beweisen, dass ~/.jht frei von Telegram-Tokens ist.' ;;
    line.legacy_inventory_failed.non_riesco_a_fermare_gli) printf '%s' 'Ich kann die Agenten vor der Host-Inventur nicht stoppen.' ;;
    line.legacy_inventory_failed.non_riesco_a_leggere_i) printf '%s' 'Ich kann die alten Tokens in ~/.jht nicht lesen.' ;;
    line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti) printf '%s' 'Alte Rollen nicht erkannt.' ;;
    line.legacy_inventory_invalid.migrazione_telegram_interrotta_2) printf '%s' 'Telegram-Migration abgebrochen.' ;;
    line.legacy_migration_failed.s_resta_in_jht_credentials) printf '%s' '%s bleibt in ~/.jht/credentials (Antwort des Brokers: %s).' ;;
    line.legacy_remove_failed.s_nel_broker_ma_la) printf '%s' '%s ist im Broker, aber die Kopie in ~/.jht/credentials ist geblieben.' ;;
    line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso) printf '%s' '~/.jht/credentials/%s.json ist nach der Migration wieder aufgetaucht; ohne Import entfernt.' ;;
    line.macchina_podman_ricreata_vede_solo) printf '%s' 'Podman-Maschine neu erstellt: Sie sieht nur ~/.jht und ~/Documents/Job Hunter Team. Der Zustand des Brokers wurde gesichert; die CLIs der Anbieter installieren sich beim ersten '\''jht up'\'' von selbst neu (etwa eine Minute, Netzwerk nötig: '\''jht providers versions'\'' bestätigt es, '\''jht providers update'\'' installiert sie von Hand). Starte das Team mit '\''jht up'\'', gib das Mail-Passwort neu ein und melde dich erneut bei LinkedIn an.' ;;
    line.mail.address_prompt) printf '%s' 'Adresse des Postfachs:' ;;
    line.mail.app_password_prompt) printf '%s' 'App-Passwort (wird nicht angezeigt):' ;;
    line.mail.dedicated_prompt) printf '%s' 'Ist das ein EIGENES Postfach für weitergeleitete Jobbenachrichtigungen?' ;;
    line.mail_setup_opzione_sconosciuta_s) printf '%s' 'mail setup: unbekannte Option %s' ;;
    line.mail_setup_password_vuota) printf '%s' 'mail setup: leeres Passwort' ;;
    line.migrazione_docker_podman_gia_verificata) printf '%s' 'Migration Docker -> Podman schon geprüft; die Docker-Volumes bleiben unverändert und enthalten noch die Mail-Passwörter, die Portal-Zugänge und die Telegram-Tokens.' ;;
    line.migrazione_docker_podman_verificata_i) printf '%s' 'Migration Docker -> Podman geprüft. Die Docker-Volumes wurden nicht entfernt und enthalten noch die Mail-Passwörter, die Portal-Zugänge und die Telegram-Tokens: Lösche sie nur mit einer ausdrücklichen Bestätigung im künftigen Aufräumbefehl.' ;;
    line.mount_repair_failed.s_non_si_puo_rendere) printf '%s' '%s lässt sich für den Container (läuft als uid %s) nicht beschreibbar machen, und nichts wurde gestartet. Mach einmal: sudo chown -R %s %s und führe '\''jht up'\'' erneut aus.' ;;
    line.nessun_provider_attivo_scegline_uno) printf '%s' 'Kein Anbieter aktiv: Wähle einen mit '\''jht providers use glm'\''' ;;
    line.nessun_ruolo_ha_un_token) printf '%s' 'Keine Rolle hat einen alten Token: Für einen neuen Bot nutze jht telegram pair <Rolle>.' ;;
    line.niente_da_fermare_nessun_container) printf '%s' 'Nichts zu stoppen: kein Container des Projekts.' ;;
    line.no_answer) printf '%s' 'keine Antwort' ;;
    line.no_answer_from_container) printf '%s' 'keine Antwort vom Container' ;;
    line.non_autorizzabile_s) printf '%s' 'Nicht autorisierbar: %s.' ;;
    line.non_autorizzata_s) printf '%s' 'Nicht autorisiert: %s.' ;;
    line.non_ho_potuto_rimettere_s) printf '%s' 'Ich konnte '\''%s'\'' nicht wieder als Standard-Podman-Verbindung setzen.' ;;
    line.non_ho_potuto_rimuovere_il) printf '%s' 'Ich konnte den Migrationsmarker des Brokers nicht entfernen: %s' ;;
    line.non_riesco_a_creare_jht) printf '%s' 'Ich kann ~/.jht oder ~/Documents/Job Hunter Team für die Podman-Maschine nicht erstellen.' ;;
    line.non_riesco_a_creare_jht_2) printf '%s' 'Ich kann ~/.jht oder ~/Documents/Job Hunter Team für die Podman-Maschine nicht erstellen.' ;;
    line.non_riesco_a_determinare_l) printf '%s' 'Ich kann das bestätigte Image des Brokers nicht bestimmen: Die Compose-Datei der Runtime hat nicht geantwortet.' ;;
    line.non_riesco_a_esportare_in) printf '%s' 'Ich kann den Zustand des Brokers nicht überprüfbar exportieren; die Maschine wurde nicht gelöscht.' ;;
    line.non_riesco_a_fermare_i) printf '%s' 'Ich kann die Dienste vor dem Sichern des Broker-Zustands nicht stoppen.' ;;
    line.non_riesco_a_leggere_il) printf '%s' 'Ich kann das Dokument nicht lesen: %s' ;;
    line.non_riesco_a_rimuovere_i) printf '%s' 'Ich kann die gestoppten Container der vorherigen Version nicht entfernen: «jht down», dann «jht up».' ;;
    line.non_riesco_a_rimuovere_la) printf '%s' 'Ich kann die Podman-Maschine '\''%s'\'' nicht entfernen.' ;;
    line.non_riesco_a_sapere_a) printf '%s' 'Ich kann nicht feststellen, mit welchem Docker dieser Computer spricht: Die jht-Container und -Volumes werden nicht angefasst.' ;;
    line.non_riesco_a_verificare_quali) printf '%s' 'Ich kann nicht prüfen, welche Ordner des Mac die Podman-Maschine '\''%s'\'' sieht.' ;;
    line.non_sono_riuscito_a_cancellare) printf '%s' 'Ich konnte %s nicht löschen (es gehört einem anderen Benutzer, z. B. dem des Containers, und der Service-Container ist nicht verfügbar).' ;;
    line.opzione_di_clean_images_non) printf '%s' 'Option von clean-images nicht unterstützt: %s (Verwendung: jht clean-images [--json])' ;;
    line.opzione_non_riconosciuta_s) printf '%s' 'Option nicht erkannt: %s' ;;
    line.opzione_non_riconosciuta_s_2) printf '%s' 'Option nicht erkannt: %s' ;;
    line.opzione_non_riconosciuta_s_3) printf '%s' 'Option nicht erkannt: %s' ;;
    line.os_and_version_are_required) printf '%s' '--os und --version sind erforderlich' ;;
    line.override_compose_per_podman_rootless) printf '%s' 'Compose-Override für rootless Podman in %s nicht schreibbar.' ;;
    line.per_l_aiuto_di_s) printf '%s' 'Für die Hilfe zu '\''%s'\'' muss der Container laufen: '\''jht up'\''.' ;;
    line.per_procedere_jht_podman_machine) printf '%s' 'Zum Fortfahren: jht podman-machine-recreate --confirm' ;;
    line.pin_dell_immagine_degli_strumenti) printf '%s' 'Pin des Tool-Images nicht vertrauenswürdig' ;;
    line.podman_compose_non_trovato_installa) printf '%s' 'podman-compose nicht gefunden: Installiere das Paket «podman-compose» (unter Ubuntu: sudo apt install podman-compose).' ;;
    line.podman_machine_avviata_ma_il) printf '%s' 'Podman-Maschine gestartet, aber der JHT-Client antwortet nicht.' ;;
    line.podman_machine_jht_non_attiva) printf '%s' 'JHT-Podman-Maschine nicht aktiv. Führe '\''jht up'\'' aus, um sie zu starten.' ;;
    line.podman_machine_non_avviabile) printf '%s' 'Podman-Maschine lässt sich nicht starten.' ;;
    line.podman_machine_s_non_attiva) printf '%s' 'Podman-Maschine '\''%s'\'' nicht aktiv, ich starte sie...' ;;
    line.podman_non_trovato_reinstalla_il) printf '%s' 'Podman nicht gefunden: Installiere die JHT-Runtime neu.' ;;
    line.podman_non_trovato_reinstalla_il_2) printf '%s' 'Podman nicht gefunden: Installiere die JHT-Runtime neu.' ;;
    line.podman_non_trovato_reinstalla_il_3) printf '%s' 'Podman nicht gefunden: Installiere die JHT-Runtime neu.' ;;
    line.podman_other_machine_running.named) printf '%s' 'eine andere Podman-Maschine, %s, ist an: Stoppe sie mit '\''podman machine stop %s'\'' und versuch es erneut.' ;;
    line.podman_other_machine_running.unnamed) printf '%s' 'eine andere Podman-Maschine ist an: Finde sie mit '\''podman machine list'\'', stoppe sie mit '\''podman machine stop <Name>'\'' und versuch es erneut.' ;;
    line.podman_remote_service_refused.su_linux_jht_usa_solo) printf '%s' 'Unter Linux nutzt JHT nur das lokale Podman dieses Benutzers, aber der podman-Client spricht mit einem entfernten Dienst.' ;;
    line.podman_rootful_refused.jht_su_linux_richiede_podman) printf '%s' 'JHT unter Linux braucht rootless Podman, ausgeführt von einem Benutzer, der nicht root ist.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non) printf '%s' 'Die rootless Podman-Runtime antwortet nicht.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non_2) printf '%s' 'Die rootless Podman-Runtime antwortet nicht.' ;;
    line.preparo_il_servizio_della_posta) printf '%s' 'Bereite den Mail-Dienst vor (er wird nur beim ersten Bedarf erstellt)…' ;;
    line.provider_attivo_non_riconosciuto_s) printf '%s' 'Aktiver Anbieter nicht erkannt: %s' ;;
    line.provider_podman_compose_non_trovato) printf '%s' 'Provider Podman Compose nicht gefunden: Installiere die JHT-Runtime neu.' ;;
    line.questo_runtime_non_usa_una) printf '%s' 'Diese Runtime nutzt keine Podman-Maschine: Es gibt nichts neu zu erstellen.' ;;
    line.reset_impossibile_cancellare_il_marcatore) printf '%s' 'reset: Der Migrationsmarker des Brokers %s lässt sich nicht löschen.' ;;
    line.reset_impossibile_cancellare_il_marcatore_2) printf '%s' 'reset: Der Marker des Brokers %s lässt sich nicht löschen.' ;;
    line.reset_impossibile_cancellare_il_volume) printf '%s' 'reset: Das Broker-Volume %s (%s) lässt sich nicht löschen.' ;;
    line.reset_nome_volume_non_valido) printf '%s' 'reset: Ungültiger Volume-Name für %s; Entfernen verweigert.' ;;
    line.reset_non_riesco_a_determinare) printf '%s' 'reset: Ich kann das Compose-Projekt nicht bestimmen; die Volumes des Brokers wurden nicht angefasst.' ;;
    line.reset_non_riesco_a_fermare) printf '%s' 'reset: Ich kann die Runtime nicht stoppen; die Volumes des Brokers wurden nicht angefasst.' ;;
    line.reset_ricerca_del_volume_s) printf '%s' 'reset: Suche nach dem Volume %s fehlgeschlagen.' ;;
    line.reset_ricerca_del_volume_s_2) printf '%s' 'reset: Suche nach dem Volume %s fehlgeschlagen.' ;;
    line.restano_token_legacy_per_s) printf '%s' 'Es bleiben alte Tokens für: %s. Solange du nicht auch diese Rollen koppelst, bleibt %s auf Telegram stumm: Kopple sie alle in dieser Sitzung (jht telegram pair --all).' ;;
    line.ricrea_la_macchina_podman_s) printf '%s' 'Erstellt die Podman-Maschine '\''%s'\'' neu: Sie wird gestoppt und gelöscht und dann so neu erstellt, dass sie nur ~/.jht und ~/Documents/Job Hunter Team sieht.' ;;
    line.ricreala_con_jht_podman_machine) printf '%s' 'Erstelle sie neu mit '\''jht podman-machine-recreate --confirm'\'': Die Dateien und der Zustand des Brokers bleiben, aber die internen CLIs und die Geheimnisse werden gelöscht.' ;;
    line.risposta_del_container_non_valida) printf '%s' 'Ungültige Antwort des Containers: Autorisierung zurückgezogen, nichts wird gesendet.' ;;
    line.ritirata_s_non_verra_inviata) printf '%s' '#%s zurückgezogen: Sie wird nicht gesendet.' ;;
    line.ritiro_non_riuscito_s) printf '%s' 'Zurückziehen fehlgeschlagen: %s.' ;;
    line.runtime_host_non_attendibile_path) printf '%s' 'Host-Runtime nicht vertrauenswürdig (Pfad, Besitzer, Rechte oder SHA-256)' ;;
    line.runtime_host_protetto_non_installabile) printf '%s' 'Geschützte Host-Runtime nicht installierbar; die alte ~/.jht/runtime wird nicht verwendet' ;;
    line.runtime_migration_changed.checksum_diverso_per_s_dopo) printf '%s' 'Andere Prüfsumme für %s nach der Migration.' ;;
    line.runtime_migration_changed.s_non_corrisponde_piu_al) printf '%s' '%s stimmt nicht mehr mit dem geprüften Marker überein.' ;;
    line.runtime_migration_checksum_mismatch.s_non_ha_superato_la) printf '%s' '%s hat die Prüfung nicht bestanden.' ;;
    line.runtime_migration_docker_missing.il_client_docker_originale_non) printf '%s' 'Der ursprüngliche Docker-Client ist nicht verfügbar.' ;;
    line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata) printf '%s' 'Das per Digest fixierte JHT-Image ist nötig.' ;;
    line.runtime_migration_image_missing.la_stessa_immagine_jht_deve) printf '%s' 'Dasselbe JHT-Image muss in Docker und Podman existieren.' ;;
    line.runtime_migration_interrupted.copia_incompleta_di_s_il) printf '%s' 'Unvollständige Kopie von %s; die Docker-Quelle ist unverändert.' ;;
    line.runtime_migration_podman_missing.podman_non_e_disponibile) printf '%s' 'Podman ist nicht verfügbar.' ;;
    line.runtime_migration_source_missing.s_manca_in_docker_ma) printf '%s' '%s fehlt in Docker, existiert aber in Podman; ich überschreibe es nicht.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_docker) printf '%s' 'Stoppe zuerst das Docker-Team.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_podman) printf '%s' 'Stoppe zuerst das Podman-Team.' ;;
    line.runtime_o_container_jht_non) printf '%s' 'JHT-Runtime oder -Container nicht verfügbar' ;;
    line.ruoli_da_abbinare_in_questa) printf '%s' 'Zu koppelnde Rollen in dieser Sitzung: %s' ;;
    line.s_e_un_collegamento_non) printf '%s' '%s ist eine Verknüpfung: Ich folge ihr nicht und lösche sie nicht.' ;;
    line.s_ha_gi_un_bot) printf '%s' '%s hat schon einen gekoppelten Bot: Ich entferne nur seine alte Kopie.' ;;
    line.s_needs_a_value) printf '%s' '%s braucht einen Wert' ;;
    line.s_non_e_una_cartella) printf '%s' '%s ist kein Ordner: Ich lösche ihn nicht.' ;;
    line.saltato_non_trovato_volume_broker) printf '%s' 'Übersprungen (nicht gefunden): Broker-Volume %s' ;;
    line.script_s_non_ancora_installato) printf '%s' 'Skript %s noch nicht installiert: '\''jht upgrade'\'' (oder ein '\''jht integration add/remove'\'') und versuch es erneut' ;;
    line.script_s_non_scaricabile_controlla) printf '%s' 'Skript %s nicht herunterladbar: Prüfe das Netzwerk oder führe '\''jht upgrade'\'' aus' ;;
    line.serve_un_terminale_l_autorizzazione) printf '%s' 'Ein Terminal ist nötig: Die Autorisierung wird von Hand bestätigt.' ;;
    line.status.caller_env) printf '%s' 'In der Umgebung dieses Terminals sind gesetzt: %s. Der Container wurde ohne sie erstellt: Entferne die Variable (unset) und versuch es erneut.' ;;
    line.status.provider_said) printf '%s' 'Der Anbieter hat gesagt: %s' ;;
    line.status.unattestable) printf '%s' 'Container '\''%s'\'' nicht bestätigbar: Etwas lässt sich nicht überprüfen (eine andere als die erwartete Konfiguration oder eine Engine, die nicht antwortet); das heißt nicht, dass er nicht läuft.' ;;
    line.sudo_chown_fallito_su_s) printf '%s' 'sudo chown auf %s fehlgeschlagen (eventuell ist '\''sudo %s up'\'' nötig)' ;;
    line.telegram_isolato_attivo_il_bridge) printf '%s' 'Isoliertes Telegram aktiv; die alte Bridge kann von den Agenten nicht mehr reaktiviert werden.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_3) printf '%s' 'Die Compose-Datei der installierten Runtime ist nicht lesbar; unklar, ob sie den isolierten Telegram-Dienst hat.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_4) printf '%s' 'Die Compose-Datei der installierten Runtime ist nicht lesbar; unklar, ob sie den isolierten Telegram-Dienst hat.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_3) printf '%s' 'Die installierte Runtime ist älter und hat keinen isolierten Telegram-Dienst.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_4) printf '%s' 'Die installierte Runtime ist älter und hat keinen isolierten Telegram-Dienst.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non) printf '%s' 'Der isolierte Telegram-Dienst ist nicht aktiv oder lässt sich nicht bestätigen.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non_2) printf '%s' 'Der isolierte Telegram-Dienst ist nicht aktiv oder lässt sich nicht bestätigen.' ;;
    line.the_setup_keeps_the_key) printf '%s' 'Das Setup behält den Schlüssel: Du kannst die Datei auf diesem Computer jetzt löschen (%s).' ;;
    line.togli_remote_true_da_containers) printf '%s' 'Entferne remote = true aus containers.conf (oder CONTAINERS_CONF) für diesen Benutzer und versuch es erneut.' ;;
    line.unattestable.autostart) printf '%s' 'Vorhandener JHT-Container lässt sich nicht als unserer bestätigen; automatischer Start verweigert.' ;;
    line.unattestable.existing) printf '%s' 'Vorhandener JHT-Container lässt sich nicht als unserer bestätigen; Vorgang abgebrochen.' ;;
    line.unattestable.logs) printf '%s' 'JHT-Container lässt sich nicht als unserer bestätigen; Lesen der Logs verweigert.' ;;
    line.unattestable.other) printf '%s' 'JHT-Container lässt sich nicht als unserer bestätigen; Vorgang verweigert.' ;;
    line.unattestable.recreate) printf '%s' 'JHT-Container lässt sich nicht als unserer bestätigen; Neuerstellung verweigert.' ;;
    line.unattestable.restart) printf '%s' 'JHT-Container lässt sich nicht als unserer bestätigen; Neustart verweigert.' ;;
    line.unattestable.stop) printf '%s' 'JHT-Container lässt sich nicht als unserer bestätigen; Stoppen verweigert.' ;;
    line.unknown_argument_s) printf '%s' 'Unbekanntes Argument: %s' ;;
    line.upgrade.activate) printf '%s' 'Aktiviere die neue Runtime...' ;;
    line.upgrade.broker_restart_failed) printf '%s' 'der Secrets-Broker ist nicht wieder gestartet. Was tun: jht up' ;;
    line.upgrade.check_available) printf '%s' 'Prüfung: Es gibt ein Update, %s (%s) -> %s. %s. Zum Anwenden: jht upgrade' ;;
    line.upgrade.check_none) printf '%s' 'Prüfung: kein Update, %s (%s) ist schon die neueste. %s.' ;;
    line.upgrade.check_only) printf '%s' 'Prüfung: %s.' ;;
    line.upgrade.disk_room) printf '%s' 'Das Update lädt etwa %s GiB herunter, und nach dem Download hätten die Agenten weniger als die %s GiB Speicherplatz, die sie brauchen: Jetzt sind %s GiB frei. Gib mindestens %s GiB mehr frei (leere den Papierkorb, lösche große Dateien, die du nicht brauchst), dann versuch es erneut: Es wurde nichts heruntergeladen oder geändert (entfernt wurden nur alte Versionen von Job Hunter Team, die nichts mehr benutzte).' ;;
    line.upgrade.done) printf '%s' 'Update abgeschlossen: %s (%s) -> %s (%s). %s' ;;
    line.upgrade.failed) printf '%s' 'Update nicht abgeschlossen (%s): %s. %s' ;;
    line.upgrade.full_pull_failed) printf '%s' 'das neue vollständige Image ist nicht angekommen, das alte bleibt. Was tun: jht tools pull' ;;
    line.upgrade.helper_install_failed) printf '%s' 'die neuen Host-Skripte kommen bei der ersten Anfrage oder mit einem weiteren '\''jht upgrade'\''' ;;
    line.upgrade.interrupted) printf '%s' 'Unterbrochenes Upgrade erkannt: Ich stelle die letzte bestätigte Version wieder her...' ;;
    line.upgrade.keep_old) printf '%s' 'Alte JHT-Images: alle behalten (JHT_KEEP_OLD_IMAGES=1).' ;;
    line.upgrade.publish) printf '%s' 'Veröffentliche die bestätigte Kandidaten-Konfiguration...' ;;
    line.upgrade.pull_full) printf '%s' 'Lade das aktualisierte vollständige Image herunter...' ;;
    line.upgrade.pull_latest) printf '%s' 'Lade das neueste Image herunter...' ;;
    line.upgrade.pull_runtime) printf '%s' 'Lade die aktualisierte Runtime herunter...' ;;
    line.upgrade.restored) printf '%s' 'Vorherige Runtime wiederhergestellt.' ;;
    line.upgrade.telegram_restart_failed) printf '%s' 'der isolierte Telegram-Dienst ist nicht wieder gestartet. Was tun: jht up' ;;
    line.upgrade.verify) printf '%s' 'Prüfe die aktualisierte Runtime...' ;;
    line.uso_jht_apply_relink_account) printf '%s' 'Verwendung: jht apply relink-account' ;;
    line.uso_jht_apply_request_cancel) printf '%s' 'Verwendung: jht apply request|cancel <id>' ;;
    line.uso_jht_apply_request_cancel_2) printf '%s' 'Verwendung: jht apply request|cancel <id>' ;;
    line.uso_jht_artifact_upload_file) printf '%s' 'Verwendung: jht artifact upload DATEI [--json]' ;;
    line.uso_jht_artifact_upload_file_2) printf '%s' 'Verwendung: jht artifact upload DATEI [--json]' ;;
    line.uso_jht_mail_setup_status) printf '%s' 'Verwendung: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <Adresse|@Domain>|drafts|approve <id>|discard <id>|journal|delete|migrate' ;;
    line.uso_jht_migrate_runtime_podman) printf '%s' 'Verwendung: jht migrate-runtime podman' ;;
    line.uso_jht_profile_import_file) printf '%s' 'Verwendung: jht profile import DATEI [--replace] [--json]' ;;
    line.uso_jht_profile_import_file_2) printf '%s' 'Verwendung: jht profile import DATEI [--replace] [--json]' ;;
    line.uso_jht_profile_validate_file) printf '%s' 'Verwendung: jht profile validate [DATEI] [--strict] [--json]' ;;
    line.uso_jht_screen_on_off) printf '%s' 'Verwendung: jht screen on | off | status [--json]' ;;
    line.uso_jht_telegram_chat_id) printf '%s' 'Verwendung: jht telegram chat-id <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_pair_assistente) printf '%s' 'Verwendung: jht telegram pair <assistente|capitano|mentor>|--all' ;;
    line.uso_jht_telegram_remove_assistente) printf '%s' 'Verwendung: jht telegram remove <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_status_pair) printf '%s' 'Verwendung: jht telegram status|pair <Rolle>|pair --all|chat-id <Rolle>|remove <Rolle>' ;;
    line.uso_jht_ticket_open_posizione) printf '%s' 'Verwendung: jht ticket open POSITION TEXT [--kind TYP] [--attach DATEI]' ;;
    line.uso_jht_ticket_open_posizione_2) printf '%s' 'Verwendung: jht ticket open POSITION TEXT [--kind TYP] [--attach DATEI]' ;;
    line.versione_dell_immagine_configurata_per) printf '%s' 'Version des konfigurierten Images. Für die der laufenden CLI: '\''jht up'\'' und dann '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_2) printf '%s' 'Version des konfigurierten Images. Für die der laufenden CLI: '\''jht up'\'' und dann '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_3) printf '%s' 'Version des konfigurierten Images. Für die der laufenden CLI: '\''jht up'\'' und dann '\''jht --version'\''.' ;;
    line.versione_di_podman_compose_non) printf '%s' 'Version von podman-compose nicht lesbar.' ;;
    line.versione_non_supportata_servono_podman) printf '%s' 'Nicht unterstützte Version: podman >= %s ist nötig (gefunden: %s) und podman-compose >= %s (gefunden: %s).' ;;
    line.versione_non_supportata_sul_mac) printf '%s' 'Nicht unterstützte Version: Auf dem Mac ist podman %s.%s oder ein späteres %s.x nötig (nicht 6.2 oder höher; gefunden: %s) und podman-compose %s (gefunden: %s). Wenn du Homebrew über die Serie %s hinaus aktualisiert hast, aktualisiere JHT (curl -fsSL https://jobhunterteam.ai/install.sh | bash).' ;;
    migrate.left) printf '%s' 'Nicht kopiert oder nicht geprüft: das Volume %s.' ;;
    monitor.window_failed) printf '%s' 'monitor_window_unavailable: Hier lässt sich kein Terminalfenster öffnen. Führe '\''jht monitor'\'' im aktuellen Terminal aus (oder in deiner tmux-Sitzung).' ;;
    monitor.window_invalid) printf '%s' 'monitor_window_invalid: Nutze '\''jht monitor --window'\'' ohne weitere Optionen.' ;;
    removed.office) printf '%s' ''\''jht %s'\'' wurde in 0.4.0 zusammen mit dem Godot-Büro entfernt: Nutze die jht-Befehle (jht help).' ;;
    status.container) printf '%s' 'Container' ;;
    status.image) printf '%s' 'Image' ;;
    status.next_other) printf '%s' 'Starte das Team mit: jht up' ;;
    status.next_running) printf '%s' 'Wer arbeitet: jht agents' ;;
    status.no_options) printf '%s' ''\''jht status'\'' nimmt keine Optionen (%s): Führe es als '\''jht status'\'' aus.' ;;
    status.not_running) printf '%s' 'Der Container des Teams läuft nicht.' ;;
    status.not_running_next) printf '%s' 'Starte ihn mit: jht up' ;;
    status.running) printf '%s' 'läuft seit %s' ;;
    status.state) printf '%s' '%s seit %s' ;;
    status.title) printf '%s' 'Status' ;;
    team.stopped) printf '%s' 'Job Hunter Team ist gestoppt: '\''jht up'\'' startet es wieder.' ;;
    tools.arriving) printf '%s' 'Die Werkzeuge der Scouts sind unterwegs: Das vollständige Image wird im Hintergrund heruntergeladen (etwa 3 GB). Die Stellensuche startet von selbst, sobald sie da sind; du musst nichts tun.' ;;
    tools.chat_reconnecting) printf '%s' 'Das Team wechselt auf die vollständigen Werkzeuge der Scouts, deshalb hält der Chat kurz an: Er kommt von selbst zurück, sobald das Team wieder läuft (ein paar Minuten).' ;;
    tools.chat_resumed) printf '%s' 'Das Team nutzt jetzt die vollständigen Werkzeuge: Machen wir weiter.' ;;
    tools.chat_switched) printf '%s' 'Das Team wechselt auf die vollständigen Werkzeuge der Scouts, deshalb wurde dieser Chat geschlossen. Öffne ihn in ein paar Minuten wieder mit jht team chat.' ;;
    tools.chat_update_closed) printf '%s' 'JHT wird gerade aktualisiert, deshalb wurde dieser Chat geschlossen. Öffne ihn in ein paar Minuten wieder mit jht team chat.' ;;
    tools.chat_update_resumed) printf '%s' 'JHT ist aktualisiert: Machen wir weiter.' ;;
    tools.chat_updating) printf '%s' 'JHT wird gerade aktualisiert, deshalb hält der Chat kurz an: Er startet in ein bis zwei Minuten von selbst neu.' ;;
    tools.disk_low) printf '%s' 'Die Werkzeuge der Scouts wurden nicht heruntergeladen: Sie brauchen etwa %s GiB freien Speicherplatz, verfügbar sind %s GiB, daher kann das Team noch keine Stellen suchen. Gib Platz frei (leere den Papierkorb, lösche große Dateien, die du nicht brauchst), dann führe jht up aus: Der Download startet von selbst neu.' ;;
    tools.engine_down) printf '%s' 'Der Stand der Werkzeuge der Scouts lässt sich nicht lesen: Die Container-Engine antwortet nicht. Starte sie mit jht up.' ;;
    tools.failed) printf '%s' 'Der Download der Werkzeuge der Scouts ist fehlgeschlagen, daher kann das Team noch keine Stellen suchen. Führe jht tools pull aus, um es erneut zu versuchen (jht up versucht es auch).' ;;
    tools.not_started) printf '%s' 'Der Download der Scout-Werkzeuge hat nicht begonnen, das Team kann also noch nicht nach Stellen suchen. Starte ihn mit jht tools pull (auch jht up startet ihn).' ;;
    tools.ready) printf '%s' 'Die Werkzeuge der Scouts sind da: Das Team sucht mit dem vollständigen Image.' ;;
    tools.switch_failed) printf '%s' 'Die Werkzeuge der Scouts sind da, aber das Team konnte damit nicht neu gestartet werden: Führe jht down und dann jht up aus.' ;;
    tools.switch_wait) printf '%s' 'Das Team wechselt gerade auf die vollständigen Werkzeuge der Scouts: Ich warte, bis es wieder läuft (höchstens ein paar Minuten).' ;;
    tools.waiting) printf '%s' 'Die Werkzeuge der Scouts sind da: Das Team wechselt von selbst darauf, sobald das Onboarding abgeschlossen ist.' ;;
    uninstall.bad_home) printf '%s' 'HOME ist ungültig: Entfernen verweigert.' ;;
    uninstall.colima_busy) printf '%s' 'Colima läuft noch: Der JHT-Installer hat es gestartet, aber darin laufen andere Container, also bleibt es an. Zum Stoppen: colima stop.' ;;
    uninstall.colima_running) printf '%s' 'Colima läuft noch: Der JHT-Installer hat es nicht gestartet (es lief schon oder ist nicht das Standard-Colima), also bleibt es an, und es könnte deins sein. Zum Stoppen: colima stop.' ;;
    uninstall.colima_stop_failed) printf '%s' 'Colima ließ sich nicht stoppen. Zum Stoppen: colima stop.' ;;
    uninstall.colima_stopping) printf '%s' 'Stoppe die virtuelle Maschine von Colima, die der JHT-Installer gestartet hat und in der sonst nichts läuft; deine Ordner auf dem Mac bleiben.' ;;
    uninstall.compose_link_left) printf '%s' 'Der Link zum Docker-Compose-Plugin, den der JHT-Installer angelegt hat, ließ sich nicht entfernen: %s. Du kannst ihn löschen.' ;;
    uninstall.compose_link_removed) printf '%s' 'Link zum Docker-Compose-Plugin entfernt, den der JHT-Installer angelegt hat: %s. Das von Homebrew installierte Plugin bleibt (brew uninstall docker-compose entfernt es).' ;;
    uninstall.images_removed) printf '%s' '%s JHT-Images entfernt: das Core-Image, das vollständige und die alten.' ;;
    uninstall.left.commands) printf '%s' 'Nicht entfernt: der Befehl jht oder die PATH-Zeilen, die der Installer hinzugefügt hat.' ;;
    uninstall.left.data) printf '%s' 'Die oben aufgeführten JHT-Daten wurden nicht gelöscht. Der Befehl jht und die Runtime sind noch da: Führe '\''jht uninstall --confirm --purge'\'' erneut aus, sobald das geklärt ist.' ;;
    uninstall.left.images) printf '%s' 'Nicht entfernt: einige JHT-Images (die Engine hat abgelehnt). Führe '\''jht uninstall --confirm'\'' erneut aus, sobald nichts anderes sie nutzt.' ;;
    uninstall.left.machine) printf '%s' 'Nicht entfernt: die Podman-Maschine jht-podman oder die Container und Volumes von JHT, mit den gespeicherten Geheimnissen. Führe '\''jht uninstall --confirm'\'' erneut aus, wenn Podman oder Docker antworten.' ;;
    uninstall.left.runtime) printf '%s' 'Nicht entfernt: die Host-Runtime von JHT.' ;;
    uninstall.loss) printf '%s' 'Das gespeicherte Mail-Passwort und die Telegram-Tokens werden ebenfalls gelöscht; ~/.jht und Documents bleiben, und mit ihnen die gespeicherte LinkedIn-Sitzung (secrets/linkedin-profile und .cache/linkedin): Entferne sie mit jht reset --scope creds.' ;;
    uninstall.loss_purge) printf '%s' 'Das gespeicherte Mail-Passwort und die Telegram-Tokens werden ebenfalls gelöscht.' ;;
    uninstall.machine_kept) printf '%s' 'Die Podman-Maschine '\''%s'\'' wurde nicht vom JHT-Installer erstellt (sie war schon da oder ist nicht die Standard-Maschine jht-podman), daher wird sie nicht entfernt: Sie könnte deine sein. Die JHT-Volumes und das Image darin bleiben bei ihr. Zum Entfernen: podman machine stop %s, dann podman machine rm %s.' ;;
    uninstall.machine_removing) printf '%s' 'Entferne die Podman-Maschine '\''%s'\'', die der JHT-Installer erstellt hat: Alles darin verschwindet mit ihr (die JHT-Volumes und das Image); deine Ordner auf dem Mac bleiben.' ;;
    uninstall.phase.commands) printf '%s' 'Entferne den Befehl jht und die PATH-Zeilen, die der Installer hinzugefügt hat...' ;;
    uninstall.phase.data) printf '%s' 'Lösche ~/.jht und den Ordner Documents (--purge)...' ;;
    uninstall.phase.images) printf '%s' 'Entferne die JHT-Images (das Core-Image, das vollständige und die alten)...' ;;
    uninstall.phase.machine) printf '%s' 'Entferne die Podman-Maschine oder die Container und Volumes von JHT...' ;;
    uninstall.phase.runtime) printf '%s' 'Entferne die Host-Runtime...' ;;
    uninstall.purge_loss) printf '%s' 'Mit --purge werden auch ~/.jht und ~/Documents/Job Hunter Team gelöscht: Konfiguration, Datenbank, Lebensläufe und Ergebnisse. Das lässt sich nicht rückgängig machen.' ;;
    uninstall.runtime_choice_unreadable) printf '%s' 'Die Runtime-Wahl von JHT lässt sich nicht lesen: Nichts wurde entfernt.' ;;
    uninstall.usage) printf '%s' 'Verwendung: jht uninstall --confirm [--purge]' ;;
    uninstall.usage_stays) printf '%s' 'Podman, podman-compose, Docker, Colima und Homebrew bleiben ebenfalls.' ;;
    uninstall.usage_what) printf '%s' 'Entfernt die lokale JHT-Runtime: die Podman-Maschine jht-podman oder die Container, Volumes und Images von JHT (das Core-Image und das vollständige, unter den Repository-Namen ghcr.io/leopu00/jht, jht und localhost/jht), die Host-Runtime und den Befehl jht.' ;;
    up.docker_legacy) printf '%s' 'Dieser Computer betreibt JHT auf Docker, und dessen Engine antwortet nicht. Seit 0.4 läuft JHT nur noch auf Podman. Deine Daten bleiben: ~/.jht und ~/Documents/Job Hunter Team sind Ordner dieses Computers. Zum Wechsel auf Podman: jht uninstall --confirm (behält diese beiden Ordner), führe den Installer erneut aus, dann jht setup mit deinem API-Schlüssel (der Schlüssel, das Mail-Passwort und die Telegram-Tokens sind in den Volumes von Docker geblieben: Gib sie erneut ein). Um vorerst mit Docker weiterzumachen, starte dessen Engine selbst und führe jht up erneut aus.' ;;
    up.done) printf '%s' 'Job Hunter Team gestartet.' ;;
    up.engine_lost) printf '%s' 'Die Podman-Maschine hat gestoppt, während das Team startete (%s). Nichts von dir ist verloren: Deine Daten liegen in den Volumes und in deinen Ordnern. Führe jht up erneut aus: Es startet die Maschine und das Team.' ;;
    up.storage_damaged) printf '%s' 'Das Image des Teams war auf der Festplatte der Podman-Maschine beschädigt (die Maschine wurde abrupt gestoppt, während sie es schrieb): Ich lade es neu herunter und erstelle die Container neu. Deine Daten liegen in den Volumes und in deinen Ordnern und bleiben erhalten. Das dauert ein paar Minuten.' ;;
    up.storage_repair_failed) printf '%s' 'Das Image des Teams ließ sich auf der Podman-Maschine nicht reparieren. '\''jht uninstall --confirm'\'' und danach der Installer erstellen eine neue Maschine (deine Ordner ~/.jht und Documents bleiben).' ;;
    *) return 1 ;;
  esac
}
jht_text_fr() {
  case "$1" in
    compose.missing) printf '%s' 'docker compose est absent : le moteur répond, mais la commande « docker compose » n'\''existe pas (JHT a besoin du plugin Compose v2). Sur Mac : brew install docker-compose, puis mkdir -p ~/.docker/cli-plugins && ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose. Sur Linux : installe le paquet docker-compose-v2 (apt) ou docker-compose-plugin (dnf). Puis relance la commande.' ;;
    config.changed_down) printf '%s' 'config_changed_while_running : l'\''équipe a été démarrée avec une configuration autre que l'\''actuelle (changée pendant que JHT tournait, ou réinstallation) ; je l'\''arrête.' ;;
    config.changed_other) printf '%s' 'config_changed_while_running : l'\''équipe tourne avec une configuration différente de celle attendue ; elle ne sert qu'\''à l'\''arrêter.' ;;
    config.changed_start) printf '%s' 'config_changed_while_running : la configuration a changé pendant que JHT tournait (jht config set, réglages modifiés depuis le site ou l'\''appli, ou une réinstallation) ; l'\''équipe en cours ne peut donc pas être vérifiée. Arrête-la avec « jht down », puis démarre-la avec « jht up ».' ;;
    config.changed_stopped) printf '%s' 'config_changed_stopped : les conteneurs de l'\''équipe, arrêtés, sont de la version précédente : je les recrée avec la nouvelle configuration (les volumes avec les données restent).' ;;
    container.starting) printf '%s' 'Le conteneur '\''%s'\'' n'\''est pas actif, je le démarre...' ;;
    doctor.host_config_none) printf '%s' 'pas encore de configuration : '\''jht setup'\''' ;;
    doctor.host_config_ok) printf '%s' 'configuration présente' ;;
    doctor.host_engine_fail) printf '%s' 'moteur de conteneurs injoignable' ;;
    doctor.host_engine_ok) printf '%s' 'moteur de conteneurs joignable' ;;
    doctor.host_more) printf '%s' 'Pour les vérifications complètes (configuration, fournisseur, base de données, agents) : '\''jht up'\'', puis '\''jht doctor'\''.' ;;
    doctor.host_runtime_fail) printf '%s' 'runtime JHT manquant ou modifié : '\''jht upgrade'\'' le réinstalle' ;;
    doctor.host_runtime_ok) printf '%s' 'runtime JHT intact' ;;
    doctor.host_team_off) printf '%s' 'équipe éteinte : '\''jht up'\'' la démarre' ;;
    doctor.host_team_unattestable) printf '%s' 'un conteneur de l'\''équipe est là mais on ne peut pas vérifier qu'\''il est le nôtre : rien n'\''a été touché ('\''jht status'\'' en dit plus)' ;;
    doctor.host_title) printf '%s' 'Job Hunter Team : l'\''équipe est éteinte (son conteneur ne tourne pas). Vérifications faites depuis cet ordinateur :' ;;
    down.done) printf '%s' 'Job Hunter Team arrêté.' ;;
    down.still_running) printf '%s' 'L'\''équipe ne s'\''est pas arrêtée : un conteneur du projet tournait de nouveau après deux essais (il peut redémarrer tout seul pendant sa première minute). Relance '\''jht down'\'' ; si ça reste, '\''jht doctor'\''.' ;;
    download.asset_failed) printf '%s' 'échec du téléchargement : %s' ;;
    download.bad_version) printf '%s' 'version non valide : %s. Exemple : 0.3.5.' ;;
    download.copy_failed) printf '%s' 'la copie du téléchargement vérifié vers la destination a échoué' ;;
    download.deb_only_linux) printf '%s' '--deb est seulement pour Linux.' ;;
    download.dest_appeared) printf '%s' 'la destination est apparue pendant le téléchargement ; elle n'\''a pas été écrasée' ;;
    download.dest_is_link) printf '%s' 'la destination est un lien : %s' ;;
    download.dest_not_file) printf '%s' 'la destination existe et n'\''est pas un fichier : %s' ;;
    download.fetching) printf '%s' 'Téléchargement de %s...' ;;
    download.hash_invalid) printf '%s' 'SHA-256 non valide pour %s : attendu %s, obtenu %s.' ;;
    download.intel_mac) printf '%s' 'L'\''app macOS 0.4 ne tourne que sur les Mac avec puce Apple (M1 et suivants) ; ce Mac est un Mac Intel, que la 0.4 ne prend pas en charge. Rien n'\''a été téléchargé.' ;;
    download.linux_no_app) printf '%s' 'Dans cette version il n'\''y a pas d'\''app de bureau pour Linux : utilise install.sh. Rien n'\''a été téléchargé.' ;;
    download.mismatch_existing) printf '%s' 'le fichier %s existe mais son SHA-256 ne correspond pas : il n'\''a pas été écrasé.' ;;
    download.mkdir_failed) printf '%s' 'impossible de créer le dossier de destination : %s' ;;
    download.no_curl) printf '%s' 'curl introuvable : il sert à télécharger la version.' ;;
    download.no_tmp) printf '%s' 'le dossier temporaire n'\''a pas pu être créé' ;;
    download.parent_unreachable) printf '%s' 'le dossier de destination est injoignable : %s' ;;
    download.present_verified) printf '%s' 'Fichier déjà présent et vérifié : %s' ;;
    download.release_no_app) printf '%s' 'Cette version (v%s) n'\''a pas d'\''app pour macOS : utilise la 0.4.0 ou une plus récente. Rien n'\''a été téléchargé.' ;;
    download.saved_in) printf '%s' 'Enregistré dans : %s' ;;
    download.sha_verified) printf '%s' 'SHA-256 vérifié : %s' ;;
    download.shared_folder) printf '%s' 'la destination est dans un dossier partagé avec l'\''équipe (%s) : choisis-en un en dehors, comme ~/Downloads.' ;;
    download.sum_missing) printf '%s' 'aucun SHA-256 déclaré pour %s.' ;;
    download.sums_failed) printf '%s' 'échec du téléchargement : SHA256SUMS de v%s' ;;
    download.unsupported_os) printf '%s' 'système non pris en charge : %s. Utilise windows ou macos.' ;;
    download.windows_missing) printf '%s' 'Windows ne fait pas partie de la 0.4.0 : la version n'\''a pas d'\''installeur pour Windows. Rien n'\''a été téléchargé.' ;;
    help.download) printf '%s' 'usage : jht download --os windows|macos --version X.Y.Z [--output FILE]
  L'\''app de bureau ne fait pas partie de la 0.4.0 : pour une version qui la contient, la télécharge, vérifie son SHA-256 et l'\''enregistre (par défaut dans ~/Downloads).' ;;
    help.integration) printf '%s' 'Usage : jht integration <commande>

  list [--json]                   les intégrations et leur état
  status [ID] [--json]            l'\''état d'\''une seule, ou de toutes
  add ID [--json]                 ajoute une intégration
  remove ID [--purge --yes] [--remove-image] [--json]
                                  la retire ; --purge efface aussi ses données (il faut --yes) ;
                                  --remove-image (seulement screen et media) retire aussi l'\''image des outils

Les ID admis sont ceux qu'\''affiche `jht integration list`. Rien ne se télécharge ni ne s'\''allume
tant que tu ne le demandes pas avec `add`.' ;;
    help.linkedin) printf '%s' 'Usage : jht linkedin <commande>

  login [--stop]    la connexion manuelle à LinkedIn (avec Google) : un navigateur dans un conteneur à part, sans réseau,
                    dont tu vois et utilises la fenêtre depuis l'\''app ; --stop ferme tout
  status --json     dit si la connexion est en cours et si la session LinkedIn est enregistrée

Rien ne se télécharge ni ne s'\''allume tant que tu ne le demandes pas avec `login`.' ;;
    help.main) printf '%s' 'jht — Job Hunter Team

  Commandes de l'\''hôte (elles marchent d'\''ici) :
    jht up                 démarre le conteneur de l'\''équipe
    jht down               l'\''arrête
                           (avec --verbose on voit aussi les lignes du moteur)
    jht restart            le redémarre
    jht status             état du conteneur et de l'\''équipe
    jht logs [-f]          logs du conteneur
    jht upgrade            met à jour vers l'\''image la plus récente
    jht clean-images [--json]
                           retire les anciennes images JHT (garde l'\''actuelle, la
                           plus récente des autres et celles utilisées) ; permis
                           même quand le disque est presque plein
    jht setup              installation guidée
    jht shell              shell dans le conteneur
    jht profile import FILE [--replace]
                           donne à l'\''équipe le profil du candidat (YAML)
    jht profile validate [FILE] [--strict] [--json]
                           vérifie un profil (YAML) sans rien écrire ;
                           sans FILE, celui de l'\''équipe
    jht mail setup         enregistre la boîte mail dans le broker des secrets
    jht mail drafts        mails écrits par les agents qui attendent ton accord
    jht mail approve <id>  les envoie ; jht mail discard <id> les écarte
    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]
                           les intégrations qu'\''on ajoute après le setup
                           (google, telegram, mail) : état lu par le moteur
    jht telegram status    état du service Telegram isolé
    jht telegram pair ROLE demande le token sans écho sur l'\''ordinateur hôte, puis
                           affiche un code à envoyer au bot depuis ton Telegram
                           Pour les automatisations : JSON sur stdin. N'\''enregistre pas le token
                           dans ~/.jht ; efface tout de suite les fichiers utilisés hors de là.
    jht telegram pair --all associe en une session tous les rôles aux anciens tokens
    jht telegram chat-id ROLE déplace le bot vers un autre chat, avec le même code
    jht reset              efface la configuration et les volumes du broker
    jht migrate-runtime podman
                           copie et vérifie les volumes Docker dans Podman ;
                           ne sélectionne pas le nouveau runtime et n'\''efface pas Docker
    jht podman-machine-recreate --confirm
                           recrée la machine Podman (macOS) en ne lui faisant voir
                           que ~/.jht et ~/Documents/Job Hunter Team
    jht uninstall --confirm supprime le runtime local (machine Podman ou
                           conteneurs et volumes jht, avec les secrets enregistrés) ;
                           restent ~/.jht, Documents, Podman et Docker
    jht uninstall --confirm --purge
                           comme ci-dessus, et efface aussi ~/.jht et
                           ~/Documents/Job Hunter Team (même s'\''ils appartiennent
                           au conteneur, sans sudo et sans changer les permissions)

  Toutes les autres commandes (positions, stats, team, providers, cron,
  working-hours, cloud...) tournent DANS le conteneur : pour leur aide
  il faut le conteneur actif.

      jht up && jht --help
' ;;
    help.screen) printf '%s' 'Usage : jht screen <commande>

  on [--json]       allume l'\''écran en direct du closer : un conteneur à part, avec le stream seulement sur 127.0.0.1
  off [--remove-image] [--json]
                    l'\''éteint et retire le conteneur ; l'\''image des outils reste sur le disque, pour le rallumer
                    sans la retélécharger : --remove-image la retire et libère l'\''espace
  status [--json]   dit s'\''il est allumé

Rien ne se télécharge ni ne s'\''allume tant que tu ne le demandes pas avec `on`. Le stream se regarde seulement.' ;;
    help.setup) printf '%s' 'Usage : jht setup [options]

Sans options, l'\''installation guidée démarre. Avec --non-interactive, rien n'\''est demandé :
tout se donne avec les options.

  --non-interactive            aucune question
  --provider <name>            glm (Z.ai, par défaut), kimi (Moonshot), openai ou claude (Anthropic)
  --harness <name>             pi (par défaut)
  --api-key-file <path>        fichier qui contient la clé API (une ligne, lisible seulement par toi).
                               jht lit ce fichier sur ton ordinateur et le passe au setup :
                               avec glm et kimi, le setup garde la clé à part, jamais dans la configuration
  --api-key-stdin              lit la clé API sur l'\''entrée standard (une ligne) : jamais sur la ligne de commande
  --api-key <key>              la clé écrite ici, en clair (refusée pour glm et kimi)
  --secret-mode <mode>         comment la clé est enregistrée : plaintext (par défaut), env ou file
  --secret-env <name>          avec --secret-mode env : la variable d'\''environnement qui la contient
  --secret-file <path>         avec --secret-mode file : le fichier qui la contient
  --model <model>              le modèle à utiliser
  --language <code>            la langue (par exemple it ou en)
  --budget-usd <dollars>       combien l'\''équipe peut dépenser, en dollars (avec l'\''une de --budget-minutes, --budget-days, --budget-until)
  --budget-minutes <n>         le budget dure ce nombre de minutes à partir de maintenant
  --budget-days <n>            le budget dure ce nombre de jours à partir de maintenant
  --budget-until <heure>       le budget dure jusqu'\''à cette heure de la journée, 0-23 (la prochaine)
  --no-budget                  aucune limite de dépenses (l'\''équipe ne s'\''arrête qu'\''au crédit du fournisseur)
  --skip-health                saute la vérification finale
  --reset                      repart d'\''une configuration propre

Exemples :
  avec une clé GLM dans un fichier :
    jht setup --non-interactive --provider glm --harness pi --api-key-file cle.txt
  OpenAI avec une clé API, sur Pi (pour Claude : --provider claude) :
    jht setup --non-interactive --provider openai --harness pi --api-key-stdin' ;;
    help.tools) printf '%s' 'Utilisation : jht tools <commande>

  status --json   si les outils des Scout (l'\''image complète) sont là, en route ou en échec
  pull            les télécharge en arrière-plan (jht up et jht setup le lancent tout seuls)
  switch          fait passer l'\''équipe dessus une fois l'\''onboarding terminé (le téléchargement le fait tout seul)

Cette aide ne démarre rien et ne télécharge rien.' ;;
    host_setup.skip_done) printf '%s' 'host.env est dans un dossier qui appartient au conteneur (uid 1001) : le preflight de l'\''hôte est déjà fait, je le saute.' ;;
    host_setup.skip_unknown) printf '%s' 'host.env est dans un dossier qui appartient au conteneur (uid 1001) et cet utilisateur ne peut pas y écrire : je saute le preflight de l'\''hôte, mais host.env est illisible ou n'\''indique pas le type d'\''hôte (local ou VPS) : le type reste '\''unknown'\''.' ;;
    keyfile.both) printf '%s' 'utilise --api-key-file ou --api-key-stdin, pas les deux' ;;
    keyfile.not_file) printf '%s' 'le fichier passé à --api-key-file doit être un fichier normal, pas un dossier ni un lien : %s' ;;
    keyfile.readable) printf '%s' 'le fichier %s est lisible par d'\''autres utilisateurs : fais chmod 600 dessus.' ;;
    keyfile.shape) printf '%s' 'le contenu du fichier passé à --api-key-file n'\''est pas une ligne de 16 à 512 caractères imprimables sans espaces : %s' ;;
    keyfile.size) printf '%s' 'le fichier passé à --api-key-file est vide ou trop gros pour une clé (1 à 4096 octets) : %s' ;;
    keyfile.twice) printf '%s' '--api-key-file a été passé deux fois' ;;
    keyfile.unreadable) printf '%s' 'le fichier passé à --api-key-file est illisible : %s' ;;
    line.abbinamento_annullato_nessuna_modifica) printf '%s' 'Association annulée : aucune modification.' ;;
    line.abbinamento_di_s_non_riuscito) printf '%s' 'L'\''association de %s a échoué : toutes les anciennes copies restent. Relance jht telegram pair --all : les rôles déjà associés ne redemandent pas de token.' ;;
    line.abbinamento_rifiutato_genera_un_token) printf '%s' 'Association refusée : génère un nouveau token dans BotFather (/revoke) et réessaie.' ;;
    line.accedi_con_l_utente_jht) printf '%s' 'Connecte-toi avec l'\''utilisateur JHT rootless configuré par l'\''installation et réessaie.' ;;
    line.agent_restart_failed.inventario_conservato_ma_il_team) printf '%s' 'inventaire conservé, mais l'\''équipe n'\''a pas redémarré. Que faire : jht up' ;;
    line.allineo_owner_di_s_a) printf '%s' 'J'\''aligne le propriétaire de %s sur %s (c'\''était l'\''uid %s)...' ;;
    line.annullato_niente_autorizzato) printf '%s' 'Annulé : rien d'\''autorisé.' ;;
    line.anteprima_non_valida_niente_autorizzato) printf '%s' 'Aperçu non valide : rien d'\''autorisé.' ;;
    line.apply.authorize) printf '%s' 'Tu autorises cette candidature ?' ;;
    line.apply_relink_account_cloud_account) printf '%s' 'apply relink-account : compte cloud non disponible. Lance d'\''abord jht cloud pair.' ;;
    line.attenzione_le_cli_interne_verranno) printf '%s' 'ATTENTION : les CLI internes seront réinstallées et les secrets ne seront pas conservés. La configuration et l'\''état du mail restent, mais tu devras ressaisir le mot de passe mail et refaire la connexion LinkedIn.' ;;
    line.autorizzata_s_verso_s_il) printf '%s' '#%s autorisée, vers %s : le CLOSER la prendra au prochain tour.' ;;
    line.bind_uid_conflict.uid_s_on_this_computer) printf '%s' 'l'\''uid %s sur cet ordinateur est le compte '\''%s'\''. Le conteneur Job Hunter Team tourne en uid %s, donc ce compte serait propriétaire de ~/.jht (tes données et les identifiants des portails). Rien n'\''a été modifié. Lance JHT depuis le compte '\''%s'\'', ou donne un autre uid à '\''%s'\'', puis réessaie.' ;;
    line.bot_abbinato_e_copia_legacy) printf '%s' 'Bot associé et ancienne copie supprimée. Il reste d'\''autres anciens tokens ou un token dans l'\''environnement du conteneur : supprime-les et termine la rotation avant le basculement.' ;;
    line.bot_token_invalid.controlla_il_token_generato_da) printf '%s' 'vérifie le token généré par BotFather.' ;;
    line.broker_restart_failed.il_servizio_della_posta_non_4) printf '%s' 'le service mail n'\''a pas redémarré. Que faire : jht mail status' ;;
    line.broker_start_failed.il_servizio_della_posta_non_2) printf '%s' 'le service mail n'\''a pas démarré.' ;;
    line.broker_start_failed.il_servizio_della_posta_non_3) printf '%s' 'le service mail ne répond pas après 30 secondes.' ;;
    line.broker_unavailable.il_broker_dei_segreti_esiste) printf '%s' 'le broker des secrets existe mais on ne peut pas attester qu'\''il est le nôtre : je n'\''y touche pas.' ;;
    line.broker_unavailable.il_broker_dei_segreti_non) printf '%s' 'le broker des secrets n'\''est pas actif ou n'\''est pas attestable.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato) printf '%s' 'le compose du runtime installé est illisible, on ne sait pas s'\''il a le broker des secrets.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato_2) printf '%s' 'le compose du runtime installé est illisible, on ne sait pas s'\''il a le broker des secrets.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio) printf '%s' 'le runtime installé est plus ancien et n'\''a pas le broker des secrets.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio_2) printf '%s' 'le runtime installé est plus ancien et n'\''a pas le broker des secrets.' ;;
    line.broker_unavailable.il_servizio_della_posta_non) printf '%s' 'le service mail n'\''existe pas encore : il est créé la première fois qu'\''on en a besoin.' ;;
    line.cancellato_marcatore_migrazione_broker_s) printf '%s' 'Effacé : marqueur de migration du broker %s' ;;
    line.cancellato_volume_broker_s_s) printf '%s' 'Effacé : volume broker %s (%s)' ;;
    line.chown_fallito_su_s) printf '%s' 'chown a échoué sur %s' ;;
    line.client_container_non_trovato_nel) printf '%s' 'client de conteneurs introuvable dans le PATH. Répare le runtime JHT.' ;;
    line.client_container_non_trovato_nel_2) printf '%s' 'client de conteneurs introuvable dans le PATH. Répare le runtime JHT.' ;;
    line.compose_extra_file_non_e) printf '%s' 'COMPOSE_EXTRA_FILE n'\''est pas l'\''overlay seccomp de la connexion : je ne fais rien.' ;;
    line.compose_up_failed.podman_compose_up_e_uscito) printf '%s' 'podman-compose up s'\''est terminé avec %s. L'\''erreur de Podman est ci-dessus.' ;;
    line.compose_up_timeout.podman_compose_up_non_ha) printf '%s' 'podman-compose up n'\''a pas fini en %s s et a été arrêté. Un service n'\''a pas démarré : regarde « podman ps -a » et « podman logs jht ».' ;;
    line.container_jht_non_verificabile_dopo) printf '%s' 'Conteneur JHT non vérifiable après l'\''opération.' ;;
    line.container_s_non_attivo_leggere) printf '%s' 'conteneur '\''%s'\'' inactif : lire le plan ne l'\''allume pas. Démarre-le avec '\''jht up'\'' et réessaie.' ;;
    line.container_s_non_e_partito) printf '%s' 'Le conteneur '\''%s'\'' n'\''a pas démarré en 10 s. Regarde '\''jht logs'\''.' ;;
    line.cosa_fare_jht_mail_setup) printf '%s' 'Que faire : jht mail setup' ;;
    line.cosa_fare_jht_up) printf '%s' 'Que faire : jht up' ;;
    line.cosa_fare_jht_up_2) printf '%s' 'Que faire : jht up' ;;
    line.cosa_fare_jht_up_3) printf '%s' 'Que faire : jht up' ;;
    line.cosa_fare_jht_upgrade) printf '%s' 'Que faire : jht upgrade' ;;
    line.cosa_fare_jht_upgrade_2) printf '%s' 'Que faire : jht upgrade' ;;
    line.cosa_fare_jht_upgrade_3) printf '%s' 'Que faire : jht upgrade' ;;
    line.cosa_fare_jht_upgrade_4) printf '%s' 'Que faire : jht upgrade' ;;
    line.cosa_fare_reinstalla_il_runtime) printf '%s' 'Que faire : réinstalle le runtime avec l'\''installeur' ;;
    line.cosa_fare_reinstalla_il_runtime_2) printf '%s' 'Que faire : réinstalle le runtime avec l'\''installeur' ;;
    line.cosa_fare_reinstalla_il_runtime_3) printf '%s' 'Que faire : réinstalle le runtime avec l'\''installeur' ;;
    line.cosa_fare_reinstalla_il_runtime_4) printf '%s' 'Que faire : réinstalle le runtime avec l'\''installeur' ;;
    line.cosa_fare_riprova_il_comando) printf '%s' 'Que faire : relance la commande' ;;
    line.cosa_fare_riprova_il_comando_2) printf '%s' 'Que faire : relance la commande' ;;
    line.data_dir_moved.jht_home_host_s_non) printf '%s' 'JHT_HOME_HOST=%s n'\''est pas %s. L'\''équipe utilise toujours %s : le compose le monte, l'\''app le lit, et sur macOS c'\''est le seul dossier de données que la machine Podman voit. Retire JHT_HOME_HOST, ou déplace les données dans %s.' ;;
    line.data_dir_moved.jht_user_dir_host_s) printf '%s' 'JHT_USER_DIR_HOST=%s n'\''est pas %s. L'\''équipe utilise toujours %s : le compose le monte, et sur macOS c'\''est le seul dossier de documents que la machine Podman voit. Retire JHT_USER_DIR_HOST, ou déplace les documents dans %s.' ;;
    line.disk_low.gli_agenti_richiedono_almeno_disk) printf '%s' 'Les agents ont besoin d'\''au moins %s Gio de disque — disponibles : %s Gio. Pour libérer de l'\''espace, lance '\''jht clean-images'\'' (il ne supprime que les anciennes versions de Job Hunter Team), vide la Corbeille et supprime les gros fichiers dont tu n'\''as pas besoin, puis réessaie : rien n'\''a été téléchargé ni modifié.' ;;
    line.docker_punta_a_s_che) printf '%s' 'Docker pointe vers %s, qui n'\''est pas cet ordinateur : on ne touche pas aux conteneurs et aux volumes jht qui s'\''y trouvent. Ramène Docker sur l'\''instance locale (DOCKER_HOST ou docker context) et relance.' ;;
    line.fermo_e_ricreo_la_macchina) printf '%s' 'J'\''arrête et je recrée la machine Podman '\''%s'\''...' ;;
    line.fino_ad_allora_la_posta) printf '%s' 'D'\''ici là, le mail se lit et s'\''envoie avec le mot de passe actuel ; l'\''avertissement reste dans jht mail status.' ;;
    line.genera_una_nuova_password_per) printf '%s' 'génère un nouveau mot de passe d'\''application chez ton fournisseur et enregistre-le avec : jht mail setup' ;;
    line.host_setup_sh_non_trovato) printf '%s' 'host-setup.sh introuvable dans %s — preflight de l'\''hôte sauté' ;;
    line.host_setup_sh_terminato_con) printf '%s' 'host-setup.sh s'\''est terminé avec une erreur — je continue' ;;
    line.i_segreti_e_lo_stato) printf '%s' 'Les secrets et l'\''état du broker ont été effacés : refais les connexions aux portails et reconfigure le mail.' ;;
    line.identita_progetto_compose_non_valida) printf '%s' 'Identité du projet Compose non valide.' ;;
    line.il_broker_non_ha_registrato) printf '%s' 'Le broker n'\''a pas enregistré l'\''autorisation : retirée, rien ne partira.' ;;
    line.il_compose_non_indica_una) printf '%s' 'Le compose n'\''indique pas une seule image partagée pour l'\''équipe et le broker ; conservation refusée.' ;;
    line.il_container_s_non_c) printf '%s' 'le conteneur '\''%s'\'' n'\''existe pas, mais d'\''autres services du projet tournent : je les arrête.' ;;
    line.il_documento_deve_essere_un) printf '%s' 'le document doit être un fichier normal, pas un lien : %s' ;;
    line.il_documento_supera_i_mb) printf '%s' 'le document dépasse 10 Mo' ;;
    line.il_file_del_profilo_supera) printf '%s' 'le fichier du profil dépasse 64 Kio' ;;
    line.il_motore_dei_container_non) printf '%s' 'Le moteur de conteneurs n'\''est pas actif : rien n'\''a été supprimé.' ;;
    line.il_profilo_deve_essere_un) printf '%s' 'le profil doit être un fichier normal, pas un lien : %s' ;;
    line.il_progetto_ha_container_che) printf '%s' 'Le projet a des conteneurs qui ne sont ni l'\''équipe ni ses services attestés : je n'\''y touche pas.' ;;
    line.il_runtime_podman_rootless_locale) printf '%s' 'Le runtime Podman rootless local ne répond pas.' ;;
    line.il_servizio_s_del_progetto) printf '%s' 'Le service '\''%s'\'' du projet tourne mais on ne peut pas attester qu'\''il est le nôtre : je n'\''y touche pas et je n'\''arrête rien d'\''autre.' ;;
    line.input_interrotto.token_non_letto) printf '%s' 'token non lu.' ;;
    line.integration.install_hint) printf '%s' 'pour les installer : '\''jht upgrade'\'' (ou un '\''jht integration add <id>'\'')' ;;
    line.integration.not_installed) printf '%s' 'non installé' ;;
    line.integration.not_installed_yet) printf '%s' 'pas encore installé' ;;
    line.interattivo_il_token_viene_chiesto) printf '%s' 'Interactif : le token est demandé sans écho, puis le nouveau bot reçoit un code à usage unique depuis ton Telegram. Automatisations : {"bot_token": ...} en JSON sur stdin ; n'\''enregistre pas le token dans ~/.jht et efface tout de suite tout fichier utilisé en dehors.' ;;
    line.jht_home_host_o_jht) printf '%s' 'JHT_HOME_HOST ou JHT_USER_DIR_HOST pointent ailleurs : je n'\''efface pas de dossiers autres que les dossiers fixes de JHT.' ;;
    line.jht_telegram_pair_all_interattivo) printf '%s' 'jht telegram pair --all est interactif : pour les automatisations, associe un rôle à la fois.' ;;
    line.job_hunter_team_non_ancora) printf '%s' 'Job Hunter Team n'\''est pas encore démarré : lance '\''jht up'\'' (la première fois, '\''jht setup'\'').' ;;
    line.job_hunter_team_non_installato) printf '%s' 'Job Hunter Team n'\''est pas complètement installé : le fichier d'\''intégrité manque dans le dossier du runtime (une installation interrompue ?). Relance l'\''installeur.' ;;
    line.l_overlay_seccomp_dell_accesso) printf '%s' 'L'\''overlay seccomp de la connexion n'\''est pas un fichier normal.' ;;
    line.la_casella_di_posta_ora) printf '%s' 'La boîte mail est maintenant dans le broker des secrets. Son mot de passe était lisible par les agents :' ;;
    line.la_connessione_podman_jht_non) printf '%s' 'La connexion Podman JHT ne prend pas en charge le dispatcher Compose.' ;;
    line.la_macchina_e_pronta_ma) printf '%s' 'La machine est prête, mais je n'\''ai pas pu activer le trim hebdomadaire du disque.' ;;
    line.la_macchina_e_stata_ricreata) printf '%s' 'La machine a été recréée, mais l'\''état du broker n'\''a pas passé la vérification/l'\''importation.' ;;
    line.la_macchina_podman_s_vede) printf '%s' 'La machine Podman '\''%s'\'' voit plus de dossiers du Mac que ceux dont JHT a besoin (~/.jht et ~/Documents/Job Hunter Team).' ;;
    line.la_nuova_macchina_podman_s) printf '%s' 'La nouvelle machine Podman '\''%s'\'' n'\''a pas été créée.' ;;
    line.legacy_cleanup_failed.i_token_nuovi_sono_al) printf '%s' 'les nouveaux tokens sont en sécurité, mais l'\''ancienne copie de %s est encore dans ~/.jht ; basculement refusé.' ;;
    line.legacy_cleanup_failed.il_nuovo_token_al_sicuro) printf '%s' 'le nouveau token est en sécurité, mais l'\''ancien token est encore dans ~/.jht ; basculement refusé.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch) printf '%s' 'l'\''équipe reste arrêtée parce que l'\''inventaire Telegram de l'\''hôte n'\''a pas été conservé.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_2) printf '%s' 'l'\''équipe reste arrêtée parce que l'\''inventaire Telegram de l'\''hôte n'\''a pas été conservé.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_3) printf '%s' 'l'\''équipe reste arrêtée parce que l'\''inventaire Telegram de l'\''hôte n'\''a pas été conservé.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_4) printf '%s' 'l'\''équipe reste arrêtée parce que l'\''inventaire Telegram de l'\''hôte n'\''a pas été conservé.' ;;
    line.legacy_inventory_failed.le_impronte_non_sono_state) printf '%s' 'les empreintes n'\''ont pas été conservées par le service isolé.' ;;
    line.legacy_inventory_failed.lo_stato_del_container_agenti) printf '%s' 'l'\''état du conteneur des agents n'\''est pas attestable.' ;;
    line.legacy_inventory_failed.migrazione_telegram_interrotta) printf '%s' 'migration Telegram interrompue.' ;;
    line.legacy_inventory_failed.non_posso_provare_che_jht) printf '%s' 'impossible de prouver que ~/.jht ne contient aucun token Telegram.' ;;
    line.legacy_inventory_failed.non_riesco_a_fermare_gli) printf '%s' 'impossible d'\''arrêter les agents avant l'\''inventaire de l'\''hôte.' ;;
    line.legacy_inventory_failed.non_riesco_a_leggere_i) printf '%s' 'impossible de lire les anciens tokens dans ~/.jht.' ;;
    line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti) printf '%s' 'anciens rôles non reconnus.' ;;
    line.legacy_inventory_invalid.migrazione_telegram_interrotta_2) printf '%s' 'migration Telegram interrompue.' ;;
    line.legacy_migration_failed.s_resta_in_jht_credentials) printf '%s' '%s reste dans ~/.jht/credentials (réponse du broker : %s).' ;;
    line.legacy_remove_failed.s_nel_broker_ma_la) printf '%s' '%s est dans le broker mais la copie dans ~/.jht/credentials est restée.' ;;
    line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso) printf '%s' '~/.jht/credentials/%s.json est réapparu après la migration ; supprimé sans être importé.' ;;
    line.macchina_podman_ricreata_vede_solo) printf '%s' 'Machine Podman recréée : elle ne voit que ~/.jht et ~/Documents/Job Hunter Team. L'\''état du broker a été conservé ; les CLI des fournisseurs se réinstallent toutes seules au premier '\''jht up'\'' (environ une minute, il faut le réseau : '\''jht providers versions'\'' le confirme, '\''jht providers update'\'' les remet à la main). Démarre l'\''équipe avec '\''jht up'\'', ressaisis le mot de passe mail et refais la connexion LinkedIn.' ;;
    line.mail.address_prompt) printf '%s' 'Adresse de la boîte :' ;;
    line.mail.app_password_prompt) printf '%s' 'Mot de passe d'\''application (il ne s'\''affiche pas) :' ;;
    line.mail.dedicated_prompt) printf '%s' 'C'\''est une boîte DÉDIÉE aux alertes d'\''emploi transférées ?' ;;
    line.mail_setup_opzione_sconosciuta_s) printf '%s' 'mail setup : option inconnue %s' ;;
    line.mail_setup_password_vuota) printf '%s' 'mail setup : mot de passe vide' ;;
    line.migrazione_docker_podman_gia_verificata) printf '%s' 'Migration Docker -> Podman déjà vérifiée ; les volumes Docker restent intacts et contiennent encore les mots de passe mail, les accès aux portails et les tokens Telegram.' ;;
    line.migrazione_docker_podman_verificata_i) printf '%s' 'Migration Docker -> Podman vérifiée. Les volumes Docker n'\''ont pas été supprimés et contiennent encore les mots de passe mail, les accès aux portails et les tokens Telegram : efface-les seulement avec une confirmation explicite dans la future commande de nettoyage.' ;;
    line.mount_repair_failed.s_non_si_puo_rendere) printf '%s' '%s ne peut pas être rendu accessible en écriture au conteneur (il tourne en uid %s) et rien n'\''a été démarré. Fais une fois : sudo chown -R %s %s et relance '\''jht up'\''.' ;;
    line.nessun_provider_attivo_scegline_uno) printf '%s' 'aucun fournisseur actif : choisis-en un avec '\''jht providers use glm'\''' ;;
    line.nessun_ruolo_ha_un_token) printf '%s' 'Aucun rôle n'\''a d'\''ancien token : pour un nouveau bot, utilise jht telegram pair <rôle>.' ;;
    line.niente_da_fermare_nessun_container) printf '%s' 'rien à arrêter : aucun conteneur du projet.' ;;
    line.no_answer) printf '%s' 'aucune réponse' ;;
    line.no_answer_from_container) printf '%s' 'aucune réponse du conteneur' ;;
    line.non_autorizzabile_s) printf '%s' 'Impossible à autoriser : %s.' ;;
    line.non_autorizzata_s) printf '%s' 'Non autorisée : %s.' ;;
    line.non_ho_potuto_rimettere_s) printf '%s' 'Je n'\''ai pas pu remettre '\''%s'\'' comme connexion Podman par défaut.' ;;
    line.non_ho_potuto_rimuovere_il) printf '%s' 'Je n'\''ai pas pu supprimer le marqueur de migration du broker : %s' ;;
    line.non_riesco_a_creare_jht) printf '%s' 'Impossible de créer ~/.jht ou ~/Documents/Job Hunter Team pour la machine Podman.' ;;
    line.non_riesco_a_creare_jht_2) printf '%s' 'Impossible de créer ~/.jht ou ~/Documents/Job Hunter Team pour la machine Podman.' ;;
    line.non_riesco_a_determinare_l) printf '%s' 'Impossible de déterminer l'\''image attestée du broker : le compose du runtime n'\''a pas répondu.' ;;
    line.non_riesco_a_esportare_in) printf '%s' 'Impossible d'\''exporter de façon vérifiable l'\''état du broker ; la machine n'\''a pas été effacée.' ;;
    line.non_riesco_a_fermare_i) printf '%s' 'Impossible d'\''arrêter les services avant d'\''enregistrer l'\''état du broker.' ;;
    line.non_riesco_a_leggere_il) printf '%s' 'impossible de lire le document : %s' ;;
    line.non_riesco_a_rimuovere_i) printf '%s' 'Impossible de supprimer les conteneurs arrêtés de la version précédente : « jht down », puis « jht up ».' ;;
    line.non_riesco_a_rimuovere_la) printf '%s' 'Impossible de supprimer la machine Podman '\''%s'\''.' ;;
    line.non_riesco_a_sapere_a) printf '%s' 'Impossible de savoir à quel Docker parle cet ordinateur : on ne touche pas aux conteneurs et aux volumes jht.' ;;
    line.non_riesco_a_verificare_quali) printf '%s' 'Impossible de vérifier quels dossiers du Mac voit la machine Podman '\''%s'\''.' ;;
    line.non_sono_riuscito_a_cancellare) printf '%s' 'Impossible d'\''effacer %s (il appartient à un autre utilisateur, par exemple celui du conteneur, et le conteneur de service n'\''est pas disponible).' ;;
    line.opzione_di_clean_images_non) printf '%s' 'Option de clean-images non prise en charge : %s (usage : jht clean-images [--json])' ;;
    line.opzione_non_riconosciuta_s) printf '%s' 'option non reconnue : %s' ;;
    line.opzione_non_riconosciuta_s_2) printf '%s' 'option non reconnue : %s' ;;
    line.opzione_non_riconosciuta_s_3) printf '%s' 'option non reconnue : %s' ;;
    line.os_and_version_are_required) printf '%s' '--os et --version sont obligatoires' ;;
    line.override_compose_per_podman_rootless) printf '%s' 'Override Compose pour Podman rootless impossible à écrire dans %s.' ;;
    line.per_l_aiuto_di_s) printf '%s' 'L'\''aide de '\''%s'\'' demande le conteneur actif : '\''jht up'\''.' ;;
    line.per_procedere_jht_podman_machine) printf '%s' 'Pour continuer : jht podman-machine-recreate --confirm' ;;
    line.pin_dell_immagine_degli_strumenti) printf '%s' 'pin de l'\''image des outils non fiable' ;;
    line.podman_compose_non_trovato_installa) printf '%s' 'podman-compose introuvable : installe le paquet « podman-compose » (sur Ubuntu : sudo apt install podman-compose).' ;;
    line.podman_machine_avviata_ma_il) printf '%s' 'Machine Podman démarrée mais le client JHT ne répond pas.' ;;
    line.podman_machine_jht_non_attiva) printf '%s' 'Machine Podman JHT inactive. Lance '\''jht up'\'' pour la démarrer.' ;;
    line.podman_machine_non_avviabile) printf '%s' 'Impossible de démarrer la machine Podman.' ;;
    line.podman_machine_s_non_attiva) printf '%s' 'Machine Podman '\''%s'\'' inactive, je la démarre...' ;;
    line.podman_non_trovato_reinstalla_il) printf '%s' 'Podman introuvable : réinstalle le runtime JHT.' ;;
    line.podman_non_trovato_reinstalla_il_2) printf '%s' 'Podman introuvable : réinstalle le runtime JHT.' ;;
    line.podman_non_trovato_reinstalla_il_3) printf '%s' 'Podman introuvable : réinstalle le runtime JHT.' ;;
    line.podman_other_machine_running.named) printf '%s' 'une autre machine Podman, %s, est allumée : éteins-la avec '\''podman machine stop %s'\'' et réessaie.' ;;
    line.podman_other_machine_running.unnamed) printf '%s' 'une autre machine Podman est allumée : trouve-la avec '\''podman machine list'\'', éteins-la avec '\''podman machine stop <nom>'\'' et réessaie.' ;;
    line.podman_remote_service_refused.su_linux_jht_usa_solo) printf '%s' 'sur Linux, JHT utilise seulement le Podman local de cet utilisateur, mais le client podman parle à un service distant.' ;;
    line.podman_rootful_refused.jht_su_linux_richiede_podman) printf '%s' 'Sur Linux, JHT demande Podman rootless lancé par un utilisateur non root.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non) printf '%s' 'le runtime Podman rootless ne répond pas.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non_2) printf '%s' 'le runtime Podman rootless ne répond pas.' ;;
    line.preparo_il_servizio_della_posta) printf '%s' 'Je prépare le service mail (il n'\''est créé que la première fois qu'\''on en a besoin)…' ;;
    line.provider_attivo_non_riconosciuto_s) printf '%s' 'fournisseur actif non reconnu : %s' ;;
    line.provider_podman_compose_non_trovato) printf '%s' 'Fournisseur Podman Compose introuvable : réinstalle le runtime JHT.' ;;
    line.questo_runtime_non_usa_una) printf '%s' 'Ce runtime n'\''utilise pas de machine Podman : il n'\''y a rien à recréer.' ;;
    line.reset_impossibile_cancellare_il_marcatore) printf '%s' 'reset : impossible d'\''effacer le marqueur de migration du broker %s.' ;;
    line.reset_impossibile_cancellare_il_marcatore_2) printf '%s' 'reset : impossible d'\''effacer le marqueur du broker %s.' ;;
    line.reset_impossibile_cancellare_il_volume) printf '%s' 'reset : impossible d'\''effacer le volume broker %s (%s).' ;;
    line.reset_nome_volume_non_valido) printf '%s' 'reset : nom de volume non valide pour %s ; suppression refusée.' ;;
    line.reset_non_riesco_a_determinare) printf '%s' 'reset : impossible de déterminer le projet Compose ; les volumes du broker n'\''ont pas été touchés.' ;;
    line.reset_non_riesco_a_fermare) printf '%s' 'reset : impossible d'\''arrêter le runtime ; les volumes du broker n'\''ont pas été touchés.' ;;
    line.reset_ricerca_del_volume_s) printf '%s' 'reset : la recherche du volume %s a échoué.' ;;
    line.reset_ricerca_del_volume_s_2) printf '%s' 'reset : la recherche du volume %s a échoué.' ;;
    line.restano_token_legacy_per_s) printf '%s' 'Il reste d'\''anciens tokens pour : %s. Tant que tu n'\''associes pas aussi ces rôles, %s reste muet sur Telegram : associe-les tous dans cette session (jht telegram pair --all).' ;;
    line.ricrea_la_macchina_podman_s) printf '%s' 'Recrée la machine Podman '\''%s'\'' : l'\''arrête et l'\''efface, puis la recrée en ne voyant que ~/.jht et ~/Documents/Job Hunter Team.' ;;
    line.ricreala_con_jht_podman_machine) printf '%s' 'Recrée-la avec '\''jht podman-machine-recreate --confirm'\'' : les fichiers et l'\''état du broker restent, mais les CLI internes et les secrets sont effacés.' ;;
    line.risposta_del_container_non_valida) printf '%s' 'Réponse du conteneur non valide : autorisation retirée, rien ne partira.' ;;
    line.ritirata_s_non_verra_inviata) printf '%s' '#%s retirée : elle ne sera pas envoyée.' ;;
    line.ritiro_non_riuscito_s) printf '%s' 'Retrait échoué : %s.' ;;
    line.runtime_host_non_attendibile_path) printf '%s' 'runtime hôte non fiable (chemin, propriétaire, permissions ou SHA-256)' ;;
    line.runtime_host_protetto_non_installabile) printf '%s' 'runtime hôte protégé impossible à installer ; l'\''ancien ~/.jht/runtime n'\''est pas utilisé' ;;
    line.runtime_migration_changed.checksum_diverso_per_s_dopo) printf '%s' 'checksum différent pour %s après la migration.' ;;
    line.runtime_migration_changed.s_non_corrisponde_piu_al) printf '%s' '%s ne correspond plus au marqueur vérifié.' ;;
    line.runtime_migration_checksum_mismatch.s_non_ha_superato_la) printf '%s' '%s n'\''a pas passé la vérification.' ;;
    line.runtime_migration_docker_missing.il_client_docker_originale_non) printf '%s' 'le client Docker d'\''origine n'\''est pas disponible.' ;;
    line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata) printf '%s' 'il faut l'\''image JHT fixée par digest.' ;;
    line.runtime_migration_image_missing.la_stessa_immagine_jht_deve) printf '%s' 'la même image JHT doit exister dans Docker et dans Podman.' ;;
    line.runtime_migration_interrupted.copia_incompleta_di_s_il) printf '%s' 'copie incomplète de %s ; la source Docker est intacte.' ;;
    line.runtime_migration_podman_missing.podman_non_e_disponibile) printf '%s' 'Podman n'\''est pas disponible.' ;;
    line.runtime_migration_source_missing.s_manca_in_docker_ma) printf '%s' '%s manque dans Docker mais existe dans Podman ; je ne l'\''écrase pas.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_docker) printf '%s' 'arrête d'\''abord l'\''équipe Docker.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_podman) printf '%s' 'arrête d'\''abord l'\''équipe Podman.' ;;
    line.runtime_o_container_jht_non) printf '%s' 'runtime ou conteneur JHT non disponible' ;;
    line.ruoli_da_abbinare_in_questa) printf '%s' 'Rôles à associer dans cette session : %s' ;;
    line.s_e_un_collegamento_non) printf '%s' '%s est un lien : je ne le suis pas et je ne l'\''efface pas.' ;;
    line.s_ha_gi_un_bot) printf '%s' '%s a déjà un bot associé : je supprime seulement son ancienne copie.' ;;
    line.s_needs_a_value) printf '%s' '%s demande une valeur' ;;
    line.s_non_e_una_cartella) printf '%s' '%s n'\''est pas un dossier : je ne l'\''efface pas.' ;;
    line.saltato_non_trovato_volume_broker) printf '%s' 'Ignoré (introuvable) : volume broker %s' ;;
    line.script_s_non_ancora_installato) printf '%s' 'script %s pas encore installé : '\''jht upgrade'\'' (ou un '\''jht integration add/remove'\'') et réessaie' ;;
    line.script_s_non_scaricabile_controlla) printf '%s' 'script %s impossible à télécharger : vérifie le réseau ou fais '\''jht upgrade'\''' ;;
    line.serve_un_terminale_l_autorizzazione) printf '%s' 'Il faut un terminal : l'\''autorisation se confirme à la main.' ;;
    line.status.caller_env) printf '%s' 'Dans l'\''environnement de ce terminal sont définies : %s. Le conteneur a été créé sans elles : retire la variable (unset) et réessaie.' ;;
    line.status.provider_said) printf '%s' 'Le fournisseur a dit : %s' ;;
    line.status.unattestable) printf '%s' 'conteneur '\''%s'\'' non attestable : quelque chose ne peut pas être vérifié (une configuration différente de celle attendue, ou le moteur qui ne répond pas) ; ça ne veut pas dire qu'\''il ne tourne pas.' ;;
    line.sudo_chown_fallito_su_s) printf '%s' 'sudo chown a échoué sur %s ('\''sudo %s up'\'' pourrait être nécessaire)' ;;
    line.telegram_isolato_attivo_il_bridge) printf '%s' 'Telegram isolé actif ; les agents ne peuvent plus réactiver l'\''ancien bridge.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_3) printf '%s' 'le compose du runtime installé est illisible, on ne sait pas s'\''il a le service Telegram isolé.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_4) printf '%s' 'le compose du runtime installé est illisible, on ne sait pas s'\''il a le service Telegram isolé.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_3) printf '%s' 'le runtime installé est plus ancien et n'\''a pas le service Telegram isolé.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_4) printf '%s' 'le runtime installé est plus ancien et n'\''a pas le service Telegram isolé.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non) printf '%s' 'le service Telegram isolé n'\''est pas actif ou n'\''est pas attestable.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non_2) printf '%s' 'le service Telegram isolé n'\''est pas actif ou n'\''est pas attestable.' ;;
    line.the_setup_keeps_the_key) printf '%s' 'La configuration garde la clé : tu peux effacer le fichier sur cet ordinateur maintenant (%s).' ;;
    line.togli_remote_true_da_containers) printf '%s' 'Retire remote = true de containers.conf (ou CONTAINERS_CONF) pour cet utilisateur et réessaie.' ;;
    line.unattestable.autostart) printf '%s' 'Conteneur JHT existant non attestable ; démarrage automatique refusé.' ;;
    line.unattestable.existing) printf '%s' 'Conteneur JHT existant non attestable ; opération interrompue.' ;;
    line.unattestable.logs) printf '%s' 'Conteneur JHT non attestable ; lecture des logs refusée.' ;;
    line.unattestable.other) printf '%s' 'Conteneur JHT non attestable ; opération refusée.' ;;
    line.unattestable.recreate) printf '%s' 'Conteneur JHT non attestable ; recréation refusée.' ;;
    line.unattestable.restart) printf '%s' 'Conteneur JHT non attestable ; redémarrage refusé.' ;;
    line.unattestable.stop) printf '%s' 'Conteneur JHT non attestable ; arrêt refusé.' ;;
    line.unknown_argument_s) printf '%s' 'argument inconnu : %s' ;;
    line.upgrade.activate) printf '%s' 'J'\''active le nouveau runtime...' ;;
    line.upgrade.broker_restart_failed) printf '%s' 'le broker des secrets n'\''a pas redémarré. Que faire : jht up' ;;
    line.upgrade.check_available) printf '%s' 'Vérification : il y a une mise à jour, %s (%s) -> %s. %s. Pour l'\''appliquer : jht upgrade' ;;
    line.upgrade.check_none) printf '%s' 'Vérification : aucune mise à jour, %s (%s) est déjà la dernière. %s.' ;;
    line.upgrade.check_only) printf '%s' 'Vérification : %s.' ;;
    line.upgrade.disk_room) printf '%s' 'La mise à jour télécharge environ %s Gio, et après le téléchargement il resterait aux agents moins que les %s Gio de disque dont ils ont besoin : %s Gio sont libres maintenant. Libère au moins %s Gio de plus (vide la Corbeille, supprime les gros fichiers dont tu n'\''as pas besoin), puis réessaie : rien n'\''a été téléchargé ni modifié (seules les anciennes versions de Job Hunter Team que rien n'\''utilisait ont été supprimées).' ;;
    line.upgrade.done) printf '%s' 'Mise à jour terminée : %s (%s) -> %s (%s). %s' ;;
    line.upgrade.failed) printf '%s' 'Mise à jour non terminée (%s) : %s. %s' ;;
    line.upgrade.full_pull_failed) printf '%s' 'la nouvelle image complète n'\''est pas arrivée, l'\''ancienne reste. Que faire : jht tools pull' ;;
    line.upgrade.helper_install_failed) printf '%s' 'les nouveaux scripts de l'\''hôte arrivent à la première demande ou avec un autre '\''jht upgrade'\''' ;;
    line.upgrade.interrupted) printf '%s' 'Mise à jour interrompue détectée : je restaure la dernière version vérifiée...' ;;
    line.upgrade.keep_old) printf '%s' 'Anciennes images JHT : toutes conservées (JHT_KEEP_OLD_IMAGES=1).' ;;
    line.upgrade.publish) printf '%s' 'Je publie la configuration candidate attestée...' ;;
    line.upgrade.pull_full) printf '%s' 'Je télécharge l'\''image complète mise à jour...' ;;
    line.upgrade.pull_latest) printf '%s' 'Je télécharge l'\''image la plus récente...' ;;
    line.upgrade.pull_runtime) printf '%s' 'Je télécharge le runtime mis à jour...' ;;
    line.upgrade.restored) printf '%s' 'Runtime précédent restauré.' ;;
    line.upgrade.telegram_restart_failed) printf '%s' 'le service Telegram isolé n'\''a pas redémarré. Que faire : jht up' ;;
    line.upgrade.verify) printf '%s' 'Je vérifie le runtime mis à jour...' ;;
    line.uso_jht_apply_relink_account) printf '%s' 'usage : jht apply relink-account' ;;
    line.uso_jht_apply_request_cancel) printf '%s' 'usage : jht apply request|cancel <id>' ;;
    line.uso_jht_apply_request_cancel_2) printf '%s' 'usage : jht apply request|cancel <id>' ;;
    line.uso_jht_artifact_upload_file) printf '%s' 'usage : jht artifact upload FICHIER [--json]' ;;
    line.uso_jht_artifact_upload_file_2) printf '%s' 'usage : jht artifact upload FICHIER [--json]' ;;
    line.uso_jht_mail_setup_status) printf '%s' 'usage : jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <adresse|@domaine>|drafts|approve <id>|discard <id>|journal|delete|migrate' ;;
    line.uso_jht_migrate_runtime_podman) printf '%s' 'usage : jht migrate-runtime podman' ;;
    line.uso_jht_profile_import_file) printf '%s' 'usage : jht profile import FICHIER [--replace] [--json]' ;;
    line.uso_jht_profile_import_file_2) printf '%s' 'usage : jht profile import FICHIER [--replace] [--json]' ;;
    line.uso_jht_profile_validate_file) printf '%s' 'usage : jht profile validate [FICHIER] [--strict] [--json]' ;;
    line.uso_jht_screen_on_off) printf '%s' 'usage : jht screen on | off | status [--json]' ;;
    line.uso_jht_telegram_chat_id) printf '%s' 'usage : jht telegram chat-id <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_pair_assistente) printf '%s' 'usage : jht telegram pair <assistente|capitano|mentor>|--all' ;;
    line.uso_jht_telegram_remove_assistente) printf '%s' 'usage : jht telegram remove <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_status_pair) printf '%s' 'usage : jht telegram status|pair <rôle>|pair --all|chat-id <rôle>|remove <rôle>' ;;
    line.uso_jht_ticket_open_posizione) printf '%s' 'usage : jht ticket open POSITION TEXTE [--kind TYPE] [--attach FICHIER]' ;;
    line.uso_jht_ticket_open_posizione_2) printf '%s' 'usage : jht ticket open POSITION TEXTE [--kind TYPE] [--attach FICHIER]' ;;
    line.versione_dell_immagine_configurata_per) printf '%s' 'Version de l'\''image configurée. Pour celle de la CLI en cours d'\''exécution : '\''jht up'\'' puis '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_2) printf '%s' 'Version de l'\''image configurée. Pour celle de la CLI en cours d'\''exécution : '\''jht up'\'' puis '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_3) printf '%s' 'Version de l'\''image configurée. Pour celle de la CLI en cours d'\''exécution : '\''jht up'\'' puis '\''jht --version'\''.' ;;
    line.versione_di_podman_compose_non) printf '%s' 'Version de podman-compose illisible.' ;;
    line.versione_non_supportata_servono_podman) printf '%s' 'Version non prise en charge : il faut podman >= %s (trouvé : %s) et podman-compose >= %s (trouvé : %s).' ;;
    line.versione_non_supportata_sul_mac) printf '%s' 'Version non prise en charge : sur le Mac il faut podman %s.%s ou un %s.x plus récent (pas 6.2 ou au-delà ; trouvé : %s) et podman-compose %s (trouvé : %s). Si tu as mis à jour Homebrew au-delà de la série %s, mets à jour JHT (curl -fsSL https://jobhunterteam.ai/install.sh | bash).' ;;
    migrate.left) printf '%s' 'Non copié ou non vérifié : le volume %s.' ;;
    monitor.window_failed) printf '%s' 'monitor_window_unavailable : impossible d'\''ouvrir une fenêtre de terminal ici. Lance '\''jht monitor'\'' dans le terminal actuel (ou dans ta session tmux).' ;;
    monitor.window_invalid) printf '%s' 'monitor_window_invalid : utilise '\''jht monitor --window'\'' sans autres options.' ;;
    removed.office) printf '%s' ''\''jht %s'\'' a été retiré dans la 0.4.0 avec le bureau Godot : utilise les commandes jht (jht help).' ;;
    status.container) printf '%s' 'Conteneur' ;;
    status.image) printf '%s' 'Image' ;;
    status.next_other) printf '%s' 'Démarre l'\''équipe avec : jht up' ;;
    status.next_running) printf '%s' 'Qui travaille : jht agents' ;;
    status.no_options) printf '%s' ''\''jht status'\'' ne prend pas d'\''options (%s) : lance-le simplement '\''jht status'\''.' ;;
    status.not_running) printf '%s' 'Le conteneur de l'\''équipe ne tourne pas.' ;;
    status.not_running_next) printf '%s' 'Démarre-le avec : jht up' ;;
    status.running) printf '%s' 'actif depuis %s' ;;
    status.state) printf '%s' '%s depuis %s' ;;
    status.title) printf '%s' 'État' ;;
    team.stopped) printf '%s' 'Job Hunter Team est arrêté : '\''jht up'\'' le redémarre.' ;;
    tools.arriving) printf '%s' 'Les outils des Scout arrivent : l'\''image complète se télécharge en arrière-plan (environ 3 Go). La recherche d'\''offres démarre toute seule dès qu'\''ils sont là ; tu n'\''as rien à faire.' ;;
    tools.chat_reconnecting) printf '%s' 'L'\''équipe passe aux outils complets des Scout, donc le chat s'\''arrête un instant : il revient tout seul dès que l'\''équipe tourne à nouveau (quelques minutes).' ;;
    tools.chat_resumed) printf '%s' 'L'\''équipe est passée aux outils complets : reprenons.' ;;
    tools.chat_switched) printf '%s' 'L'\''équipe passe aux outils complets des Scout, donc ce chat s'\''est fermé. Rouvre-le dans quelques minutes avec jht team chat.' ;;
    tools.chat_update_closed) printf '%s' 'JHT se met à jour, donc ce chat s'\''est fermé. Rouvre-le dans quelques minutes avec jht team chat.' ;;
    tools.chat_update_resumed) printf '%s' 'JHT est à jour : reprenons.' ;;
    tools.chat_updating) printf '%s' 'JHT se met à jour, donc le chat s'\''arrête un instant : il repart tout seul dans une minute ou deux.' ;;
    tools.disk_low) printf '%s' 'Les outils des Scout n'\''ont pas été téléchargés : il leur faut environ %s Gio libres sur le disque et il y en a %s, l'\''équipe ne peut donc pas encore chercher d'\''offres. Libère de l'\''espace (vide la Corbeille, supprime les gros fichiers dont tu n'\''as pas besoin), puis lance jht up : le téléchargement repart tout seul.' ;;
    tools.engine_down) printf '%s' 'L'\''état des outils des Scout ne peut pas être lu : le moteur de conteneurs ne répond pas. Démarre-le avec jht up.' ;;
    tools.failed) printf '%s' 'Le téléchargement des outils des Scout a échoué : l'\''équipe ne peut pas encore chercher d'\''offres. Lance jht tools pull pour réessayer (jht up réessaie aussi).' ;;
    tools.not_started) printf '%s' 'Le téléchargement des outils des Scouts n'\''a pas commencé, l'\''équipe ne peut donc pas encore chercher d'\''offres. Lance jht tools pull pour le démarrer (jht up le démarre aussi).' ;;
    tools.ready) printf '%s' 'Les outils des Scout sont là : l'\''équipe cherche avec l'\''image complète.' ;;
    tools.switch_failed) printf '%s' 'Les outils des Scout sont là, mais l'\''équipe n'\''a pas pu redémarrer avec eux : lance jht down, puis jht up.' ;;
    tools.switch_wait) printf '%s' 'L'\''équipe passe aux outils complets des Scout : j'\''attends qu'\''elle redémarre (quelques minutes au plus).' ;;
    tools.waiting) printf '%s' 'Les outils des Scout sont là : l'\''équipe passe dessus toute seule dès que l'\''onboarding est terminé.' ;;
    uninstall.bad_home) printf '%s' 'HOME n'\''est pas valide : suppression refusée.' ;;
    uninstall.colima_busy) printf '%s' 'Colima tourne encore : l'\''installeur JHT l'\''a démarré, mais d'\''autres conteneurs y tournent, donc il reste allumé. Pour l'\''arrêter : colima stop.' ;;
    uninstall.colima_running) printf '%s' 'Colima tourne encore : l'\''installeur JHT ne l'\''a pas démarré (il était déjà allumé, ou ce n'\''est pas celui par défaut), donc il reste allumé, et il est peut-être à toi. Pour l'\''arrêter : colima stop.' ;;
    uninstall.colima_stop_failed) printf '%s' 'Colima n'\''a pas pu être arrêté. Pour l'\''arrêter : colima stop.' ;;
    uninstall.colima_stopping) printf '%s' 'Arrêt de la machine virtuelle Colima, que l'\''installeur JHT a démarrée et où rien d'\''autre ne tourne ; tes dossiers sur le Mac restent.' ;;
    uninstall.compose_link_left) printf '%s' 'Le lien vers le plugin Docker Compose créé par l'\''installeur JHT n'\''a pas pu être supprimé : %s. Tu peux l'\''effacer.' ;;
    uninstall.compose_link_removed) printf '%s' 'Lien vers le plugin Docker Compose créé par l'\''installeur JHT supprimé : %s. Le plugin installé par Homebrew reste (brew uninstall docker-compose le supprime).' ;;
    uninstall.images_removed) printf '%s' '%s images JHT supprimées : celle de base, la complète et les anciennes.' ;;
    uninstall.left.commands) printf '%s' 'Non supprimés : la commande jht ou les lignes PATH ajoutées par l'\''installeur.' ;;
    uninstall.left.data) printf '%s' 'Les données JHT listées ci-dessus n'\''ont pas été effacées. La commande jht et le runtime sont toujours là : relance '\''jht uninstall --confirm --purge'\'' une fois le problème réglé.' ;;
    uninstall.left.images) printf '%s' 'Non supprimées : certaines images JHT (le moteur a refusé). Relance '\''jht uninstall --confirm'\'' quand plus rien ne les utilise.' ;;
    uninstall.left.machine) printf '%s' 'Non supprimés : la machine Podman jht-podman ou les conteneurs et volumes de JHT, avec les secrets enregistrés. Relance '\''jht uninstall --confirm'\'' quand Podman ou Docker répondent.' ;;
    uninstall.left.runtime) printf '%s' 'Non supprimé : le runtime hôte de JHT.' ;;
    uninstall.loss) printf '%s' 'Le mot de passe mail et les tokens Telegram enregistrés sont aussi effacés ; ~/.jht et Documents restent, et avec eux la session LinkedIn enregistrée (secrets/linkedin-profile et .cache/linkedin) : supprime-la avec jht reset --scope creds.' ;;
    uninstall.loss_purge) printf '%s' 'Le mot de passe mail et les tokens Telegram enregistrés sont aussi effacés.' ;;
    uninstall.machine_kept) printf '%s' 'La machine Podman '\''%s'\'' n'\''a pas été créée par l'\''installeur JHT (elle existait déjà, ou ce n'\''est pas la jht-podman par défaut), donc elle n'\''est pas supprimée : elle est peut-être à toi. Les volumes et l'\''image JHT qu'\''elle contient restent avec elle. Pour la supprimer : podman machine stop %s, puis podman machine rm %s.' ;;
    uninstall.machine_removing) printf '%s' 'Suppression de la machine Podman '\''%s'\'', créée par l'\''installeur JHT : tout ce qu'\''elle contient part avec elle (les volumes et l'\''image JHT) ; tes dossiers sur le Mac restent.' ;;
    uninstall.phase.commands) printf '%s' 'Suppression de la commande jht et des lignes PATH ajoutées par l'\''installeur...' ;;
    uninstall.phase.data) printf '%s' 'Effacement de ~/.jht et du dossier Documents (--purge)...' ;;
    uninstall.phase.images) printf '%s' 'Suppression des images JHT (celle de base, la complète et les anciennes)...' ;;
    uninstall.phase.machine) printf '%s' 'Suppression de la machine Podman, ou des conteneurs et volumes de JHT...' ;;
    uninstall.phase.runtime) printf '%s' 'Suppression du runtime hôte...' ;;
    uninstall.purge_loss) printf '%s' 'Avec --purge, ~/.jht et ~/Documents/Job Hunter Team sont aussi effacés : configuration, base de données, CV et résultats. Pas de retour en arrière.' ;;
    uninstall.runtime_choice_unreadable) printf '%s' 'Le choix du runtime JHT est illisible : rien n'\''a été supprimé.' ;;
    uninstall.usage) printf '%s' 'usage : jht uninstall --confirm [--purge]' ;;
    uninstall.usage_stays) printf '%s' 'Podman, podman-compose, Docker, Colima et Homebrew restent aussi.' ;;
    uninstall.usage_what) printf '%s' 'Supprime le runtime JHT local : la machine Podman jht-podman ou les conteneurs, volumes et images de JHT (celle de base et la complète, sous les noms de dépôt ghcr.io/leopu00/jht, jht et localhost/jht), le runtime hôte et la commande jht.' ;;
    up.docker_legacy) printf '%s' 'Cet ordinateur fait tourner JHT sur Docker, et son moteur ne répond pas. Depuis la 0.4, JHT tourne uniquement sur Podman. Tes données restent : ~/.jht et ~/Documents/Job Hunter Team sont des dossiers de cet ordinateur. Pour passer à Podman : jht uninstall --confirm (il garde ces deux dossiers), relance l'\''installeur, puis jht setup avec ta clé API (la clé, le mot de passe mail et les tokens Telegram sont restés dans les volumes de Docker : redonne-les). Pour continuer avec Docker pour l'\''instant, démarre toi-même son moteur et relance jht up.' ;;
    up.done) printf '%s' 'Job Hunter Team démarré.' ;;
    up.engine_lost) printf '%s' 'La machine Podman s'\''est arrêtée pendant le démarrage de l'\''équipe (%s). Tu n'\''as rien perdu : tes données sont dans les volumes et dans tes dossiers. Relance jht up : il démarre la machine et l'\''équipe.' ;;
    up.storage_damaged) printf '%s' 'L'\''image de l'\''équipe a été abîmée sur le disque de la machine Podman (la machine a été arrêtée brusquement pendant qu'\''elle l'\''écrivait) : je la retélécharge et je recrée les conteneurs. Tes données sont dans les volumes et dans tes dossiers, et elles restent. Ça prend quelques minutes.' ;;
    up.storage_repair_failed) printf '%s' 'L'\''image de l'\''équipe n'\''a pas pu être réparée sur la machine Podman. '\''jht uninstall --confirm'\'' puis l'\''installeur créent une nouvelle machine (tes dossiers ~/.jht et Documents restent).' ;;
    *) return 1 ;;
  esac
}
jht_text_pt() {
  case "$1" in
    compose.missing) printf '%s' 'falta o docker compose: o motor responde, mas o comando «docker compose» não existe (o JHT precisa do plugin Compose v2). Num Mac: brew install docker-compose e depois mkdir -p ~/.docker/cli-plugins && ln -sfn "$(brew --prefix)/opt/docker-compose/bin/docker-compose" ~/.docker/cli-plugins/docker-compose. No Linux: instala o pacote docker-compose-v2 (apt) ou docker-compose-plugin (dnf). Depois corre o comando de novo.' ;;
    config.changed_down) printf '%s' 'config_changed_while_running: a equipa foi iniciada com uma configuração diferente da atual (mudou enquanto o JHT corria, ou houve uma reinstalação); vou pará-la.' ;;
    config.changed_other) printf '%s' 'config_changed_while_running: a equipa corre com uma configuração diferente da esperada; só a uso para a parar.' ;;
    config.changed_start) printf '%s' 'config_changed_while_running: a configuração mudou enquanto o JHT estava a correr (jht config set, definições alteradas pelo site ou pela app, ou uma reinstalação); por isso a equipa em execução não pode ser verificada. Para-a com «jht down» e depois inicia-a com «jht up».' ;;
    config.changed_stopped) printf '%s' 'config_changed_stopped: os contentores da equipa, parados, são da versão anterior: vou recriá-los com a configuração nova (os volumes com os dados ficam).' ;;
    container.starting) printf '%s' 'O contentor '\''%s'\'' não está a correr, vou iniciá-lo...' ;;
    doctor.host_config_none) printf '%s' 'ainda sem configuração: '\''jht setup'\''' ;;
    doctor.host_config_ok) printf '%s' 'configuração presente' ;;
    doctor.host_engine_fail) printf '%s' 'motor de contentores inacessível' ;;
    doctor.host_engine_ok) printf '%s' 'motor de contentores acessível' ;;
    doctor.host_more) printf '%s' 'Para as verificações completas (configuração, fornecedor, base de dados, agentes): '\''jht up'\'' e depois '\''jht doctor'\''.' ;;
    doctor.host_runtime_fail) printf '%s' 'runtime do JHT em falta ou alterado: '\''jht upgrade'\'' volta a instalá-lo' ;;
    doctor.host_runtime_ok) printf '%s' 'runtime do JHT intacto' ;;
    doctor.host_team_off) printf '%s' 'equipa desligada: '\''jht up'\'' liga-a' ;;
    doctor.host_team_unattestable) printf '%s' 'há um contentor da equipa, mas não é possível verificar que é nosso: não toquei em nada ('\''jht status'\'' diz mais)' ;;
    doctor.host_title) printf '%s' 'Job Hunter Team: a equipa está desligada (o seu contentor não está a correr). Verificações feitas a partir deste computador:' ;;
    down.done) printf '%s' 'Job Hunter Team parado.' ;;
    down.still_running) printf '%s' 'A equipa não parou: um contentor do projeto estava de novo a correr após duas tentativas (no seu primeiro minuto pode reiniciar sozinho). Corre '\''jht down'\'' mais uma vez; se continuar, '\''jht doctor'\''.' ;;
    download.asset_failed) printf '%s' 'o descarregamento falhou: %s' ;;
    download.bad_version) printf '%s' 'versão inválida: %s. Exemplo: 0.3.5.' ;;
    download.copy_failed) printf '%s' 'a cópia do descarregamento verificado para o destino falhou' ;;
    download.deb_only_linux) printf '%s' '--deb é só para Linux.' ;;
    download.dest_appeared) printf '%s' 'o destino apareceu durante o descarregamento; não foi substituído' ;;
    download.dest_is_link) printf '%s' 'o destino é uma ligação: %s' ;;
    download.dest_not_file) printf '%s' 'o destino existe e não é um ficheiro: %s' ;;
    download.fetching) printf '%s' 'A descarregar %s...' ;;
    download.hash_invalid) printf '%s' 'SHA-256 inválido para %s: esperado %s, obtido %s.' ;;
    download.intel_mac) printf '%s' 'A app para macOS da 0.4 só corre em Macs com Apple silicon (M1 e posteriores); este é um Mac Intel, que a 0.4 não suporta. Não foi descarregado nada.' ;;
    download.linux_no_app) printf '%s' 'Nesta versão não há app de ambiente de trabalho para Linux: usa install.sh. Não foi descarregado nada.' ;;
    download.mismatch_existing) printf '%s' 'o ficheiro %s existe, mas o seu SHA-256 não corresponde: não foi substituído.' ;;
    download.mkdir_failed) printf '%s' 'não é possível criar a pasta de destino: %s' ;;
    download.no_curl) printf '%s' 'curl não encontrado: é necessário para descarregar a versão.' ;;
    download.no_tmp) printf '%s' 'não foi possível criar a pasta temporária' ;;
    download.parent_unreachable) printf '%s' 'a pasta de destino não está acessível: %s' ;;
    download.present_verified) printf '%s' 'Ficheiro já presente e verificado: %s' ;;
    download.release_no_app) printf '%s' 'Esta versão (v%s) não tem app para macOS: usa a 0.4.0 ou posterior. Não foi descarregado nada.' ;;
    download.saved_in) printf '%s' 'Guardado em: %s' ;;
    download.sha_verified) printf '%s' 'SHA-256 verificado: %s' ;;
    download.shared_folder) printf '%s' 'o destino está dentro de uma pasta partilhada com a equipa (%s): escolhe uma fora dela, como ~/Downloads.' ;;
    download.sum_missing) printf '%s' 'nenhum SHA-256 declarado para %s.' ;;
    download.sums_failed) printf '%s' 'o descarregamento falhou: SHA256SUMS de v%s' ;;
    download.unsupported_os) printf '%s' 'sistema não suportado: %s. Usa windows ou macos.' ;;
    download.windows_missing) printf '%s' 'O Windows não faz parte da 0.4.0: a versão não tem instalador para Windows. Não foi descarregado nada.' ;;
    help.download) printf '%s' 'uso: jht download --os windows|macos --version X.Y.Z [--output FILE]
  A app de ambiente de trabalho não faz parte da 0.4.0: para uma versão que a inclua, descarrega-a, verifica o SHA-256 e guarda-a (por omissão em ~/Downloads).' ;;
    help.integration) printf '%s' 'Uso: jht integration <command>

  list [--json]                   as integrações e o seu estado
  status [ID] [--json]            o estado de uma, ou de todas
  add ID [--json]                 acrescenta uma integração
  remove ID [--purge --yes] [--remove-image] [--json]
                                  remove-a; --purge apaga também os seus dados (precisa de --yes);
                                  --remove-image (só screen e media) remove também a imagem das ferramentas

Os ID admitidos são os que `jht integration list` mostra. Nada é descarregado nem ligado
até o pedires com `add`.' ;;
    help.linkedin) printf '%s' 'Uso: jht linkedin <command>

  login [--stop]    o acesso manual ao LinkedIn (com o Google): um browser num contentor à parte, sem rede, cuja
                    janela vês e usas a partir da app; --stop fecha tudo
  status --json     diz se o acesso está em curso e se a sessão do LinkedIn está guardada

Nada é descarregado nem ligado até o pedires com `login`.' ;;
    help.main) printf '%s' 'jht — Job Hunter Team

  Comandos do anfitrião (funcionam a partir daqui):
    jht up                 inicia o contentor da equipa
    jht down               para-o
                           (com --verbose vês também as linhas do motor)
    jht restart            reinicia-o
    jht status             estado do contentor e da equipa
    jht logs [-f]          registos do contentor
    jht upgrade            atualiza para a imagem mais recente
    jht clean-images [--json]
                           remove as imagens antigas do JHT (mantém a atual, a
                           mais recente das outras e as que estão em uso); permitido
                           mesmo com o disco quase cheio
    jht setup              instalação guiada
    jht shell              shell dentro do contentor
    jht profile import FILE [--replace]
                           dá à equipa o perfil do candidato (YAML)
    jht profile validate [FILE] [--strict] [--json]
                           verifica um perfil (YAML) sem escrever nada;
                           sem FILE, o da equipa
    jht mail setup         guarda a caixa de correio no broker dos segredos
    jht mail drafts        emails escritos pelos agentes à espera do teu ok
    jht mail approve <id>  envia-os; jht mail discard <id> descarta-os
    jht integration list|status [ID]|add ID|remove ID [--purge --yes] [--remove-image] [--json]
                           as integrações que se acrescentam depois do setup
                           (google, telegram, mail): estado lido no motor
    jht telegram status    estado do serviço Telegram isolado
    jht telegram pair ROLE pede o token sem eco no computador anfitrião, depois
                           mostra um código para enviares ao bot a partir do teu Telegram
                           Para automações: JSON no stdin. Não guardes o token
                           em ~/.jht; apaga logo os ficheiros usados fora de lá.
    jht telegram pair --all associa numa só sessão todas as funções legacy
    jht telegram chat-id ROLE muda o bot para outro chat, com o mesmo código
    jht reset              apaga a configuração e os volumes do broker
    jht migrate-runtime podman
                           copia e verifica os volumes do Docker no Podman;
                           não seleciona o novo runtime e não apaga o Docker
    jht podman-machine-recreate --confirm
                           recria a máquina Podman (macOS) vendo
                           só ~/.jht e ~/Documents/Job Hunter Team
    jht uninstall --confirm remove o runtime local (máquina Podman ou
                           contentores e volumes do jht, com os segredos guardados);
                           ficam ~/.jht, Documentos, Podman e Docker
    jht uninstall --confirm --purge
                           como acima, e apaga também ~/.jht e
                           ~/Documents/Job Hunter Team (mesmo que pertençam
                           ao contentor, sem sudo e sem mudar permissões)

  Todos os outros comandos (positions, stats, team, providers, cron,
  working-hours, cloud...) correm DENTRO do contentor: para a sua ajuda
  é preciso o contentor ativo.

      jht up && jht --help
' ;;
    help.screen) printf '%s' 'Uso: jht screen <command>

  on [--json]       liga o ecrã ao vivo do closer: um contentor à parte, com o stream só em 127.0.0.1
  off [--remove-image] [--json]
                    desliga-o e remove o contentor; a imagem das ferramentas fica no disco, para o voltares
                    a ligar sem a descarregar de novo: --remove-image remove-a e liberta o espaço
  status [--json]   diz se está ligado

Nada é descarregado nem ligado até o pedires com `on`. O stream é só de visualização.' ;;
    help.setup) printf '%s' 'Uso: jht setup [opções]

Sem opções arranca a instalação guiada. Com --non-interactive não pergunta nada:
tudo se dá com as opções.

  --non-interactive            nenhuma pergunta
  --provider <name>            glm (Z.ai, predefinido), kimi (Moonshot), openai ou claude (Anthropic)
  --harness <name>             pi (predefinido)
  --api-key-file <path>        ficheiro que contém a chave API (uma linha, legível só por ti).
                               O jht lê um ficheiro do teu computador e passa-o ao setup: com glm e kimi
                               o setup guarda a chave por conta própria, nunca na configuração
  --api-key-stdin              lê a chave API da entrada padrão (uma linha): nunca na linha de comandos
  --api-key <key>              a chave escrita aqui, em claro (não admitida para glm e kimi)
  --secret-mode <mode>         como se guarda a chave: plaintext (predefinido), env ou file
  --secret-env <name>          com --secret-mode env: a variável de ambiente que a contém
  --secret-file <path>         com --secret-mode file: o ficheiro que a contém
  --model <model>              o modelo a usar
  --language <code>            a língua (por exemplo pt ou en)
  --budget-usd <dólares>       quanto a equipa pode gastar, em dólares (com uma de --budget-minutes, --budget-days, --budget-until)
  --budget-minutes <n>         o orçamento dura este número de minutos a partir de agora
  --budget-days <n>            o orçamento dura este número de dias a partir de agora
  --budget-until <hora>        o orçamento dura até esta hora do dia, 0-23 (a próxima)
  --no-budget                  sem limite de gasto (a equipa só para no crédito do fornecedor)
  --skip-health                salta a verificação final
  --reset                      recomeça de uma configuração limpa

Exemplos:
  com uma chave GLM num ficheiro:
    jht setup --non-interactive --provider glm --harness pi --api-key-file chave.txt
  OpenAI com uma chave API, no Pi (para Claude: --provider claude):
    jht setup --non-interactive --provider openai --harness pi --api-key-stdin' ;;
    help.tools) printf '%s' 'Uso: jht tools <comando>

  status --json   se as ferramentas dos Scout (a imagem completa) já chegaram, estão a caminho ou falharam
  pull            descarrega-as em segundo plano (jht up e jht setup iniciam-no sozinhos)
  switch          passa a equipa para elas quando o onboarding estiver concluído (o descarregamento fá-lo sozinho)

Esta ajuda não inicia nada nem descarrega nada.' ;;
    host_setup.skip_done) printf '%s' 'host.env está numa pasta do contentor (uid 1001): a verificação prévia do anfitrião já está feita, vou saltá-la.' ;;
    host_setup.skip_unknown) printf '%s' 'host.env está numa pasta do contentor (uid 1001) e este utilizador não pode escrever nela: vou saltar a verificação prévia do anfitrião, mas host.env não pode ser lido ou não diz o tipo de anfitrião (local ou VPS): o tipo fica '\''unknown'\''.' ;;
    keyfile.both) printf '%s' 'usa --api-key-file ou --api-key-stdin, não os dois' ;;
    keyfile.not_file) printf '%s' 'o ficheiro dado a --api-key-file tem de ser um ficheiro normal, não uma pasta nem uma ligação: %s' ;;
    keyfile.readable) printf '%s' 'o ficheiro %s pode ser lido por outros utilizadores: faz chmod 600 no ficheiro.' ;;
    keyfile.shape) printf '%s' 'o conteúdo do ficheiro dado a --api-key-file não é uma linha de 16 a 512 caracteres imprimíveis sem espaços: %s' ;;
    keyfile.size) printf '%s' 'o ficheiro dado a --api-key-file está vazio ou é grande demais para uma chave (1 a 4096 bytes): %s' ;;
    keyfile.twice) printf '%s' '--api-key-file foi dado duas vezes' ;;
    keyfile.unreadable) printf '%s' 'o ficheiro dado a --api-key-file não pode ser lido: %s' ;;
    line.abbinamento_annullato_nessuna_modifica) printf '%s' 'Emparelhamento cancelado: nenhuma alteração.' ;;
    line.abbinamento_di_s_non_riuscito) printf '%s' 'O emparelhamento de %s falhou: as cópias antigas ficam todas. Corre jht telegram pair --all de novo: as funções já emparelhadas não pedem outro token.' ;;
    line.abbinamento_rifiutato_genera_un_token) printf '%s' 'Emparelhamento recusado: gera um token novo no BotFather (/revoke) e tenta de novo.' ;;
    line.accedi_con_l_utente_jht) printf '%s' 'Entra com o utilizador rootless do JHT configurado pela instalação e tenta de novo.' ;;
    line.agent_restart_failed.inventario_conservato_ma_il_team) printf '%s' 'inventário guardado, mas a equipa não voltou a arrancar. O que fazer: jht up' ;;
    line.allineo_owner_di_s_a) printf '%s' 'A alinhar o dono de %s para %s (era uid %s)...' ;;
    line.annullato_niente_autorizzato) printf '%s' 'Cancelado: nada autorizado.' ;;
    line.anteprima_non_valida_niente_autorizzato) printf '%s' 'Pré-visualização inválida: nada autorizado.' ;;
    line.apply.authorize) printf '%s' 'Autorizas esta candidatura?' ;;
    line.apply_relink_account_cloud_account) printf '%s' 'apply relink-account: conta cloud não disponível. Corre primeiro jht cloud pair.' ;;
    line.attenzione_le_cli_interne_verranno) printf '%s' 'ATENÇÃO: as CLI internas vão ser reinstaladas e os segredos não vão ser guardados. A configuração e o estado do correio ficam, mas vais ter de voltar a introduzir a palavra-passe do correio e voltar a iniciar sessão no LinkedIn.' ;;
    line.autorizzata_s_verso_s_il) printf '%s' 'Autorizada #%s, para %s: o CLOSER vai tratá-la na próxima ronda.' ;;
    line.bind_uid_conflict.uid_s_on_this_computer) printf '%s' 'o uid %s neste computador é a conta '\''%s'\''. O contentor do Job Hunter Team corre como uid %s, por isso essa conta ficaria dona de ~/.jht (os teus dados e as credenciais dos portais). Nada foi alterado. Corre o JHT a partir da conta '\''%s'\'', ou dá outro uid a '\''%s'\'', e tenta de novo.' ;;
    line.bot_abbinato_e_copia_legacy) printf '%s' 'Bot emparelhado e cópia antiga removida. Restam outros tokens antigos ou um token no ambiente do contentor: remove-os e conclui a rotação antes da transição.' ;;
    line.bot_token_invalid.controlla_il_token_generato_da) printf '%s' 'verifica o token gerado pelo BotFather.' ;;
    line.broker_restart_failed.il_servizio_della_posta_non_4) printf '%s' 'o serviço de correio não voltou a arrancar. O que fazer: jht mail status' ;;
    line.broker_start_failed.il_servizio_della_posta_non_2) printf '%s' 'o serviço de correio não arrancou.' ;;
    line.broker_start_failed.il_servizio_della_posta_non_3) printf '%s' 'o serviço de correio não responde após 30 segundos.' ;;
    line.broker_unavailable.il_broker_dei_segreti_esiste) printf '%s' 'o broker dos segredos existe, mas não pode ser atestado como nosso: não lhe toco.' ;;
    line.broker_unavailable.il_broker_dei_segreti_non) printf '%s' 'o broker dos segredos não está ativo ou não pode ser atestado.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato) printf '%s' 'não é possível ler o compose do runtime instalado; não se sabe se tem o broker dos segredos.' ;;
    line.broker_unavailable.il_compose_del_runtime_installato_2) printf '%s' 'não é possível ler o compose do runtime instalado; não se sabe se tem o broker dos segredos.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio) printf '%s' 'o runtime instalado é mais antigo e não tem o broker dos segredos.' ;;
    line.broker_unavailable.il_runtime_installato_pi_vecchio_2) printf '%s' 'o runtime instalado é mais antigo e não tem o broker dos segredos.' ;;
    line.broker_unavailable.il_servizio_della_posta_non) printf '%s' 'o serviço de correio ainda não existe: é criado na primeira vez que for preciso.' ;;
    line.cancellato_marcatore_migrazione_broker_s) printf '%s' 'Apagado: marcador de migração do broker %s' ;;
    line.cancellato_volume_broker_s_s) printf '%s' 'Apagado: volume do broker %s (%s)' ;;
    line.chown_fallito_su_s) printf '%s' 'chown falhou em %s' ;;
    line.client_container_non_trovato_nel) printf '%s' 'cliente de contentores não encontrado no PATH. Repara o runtime do JHT.' ;;
    line.client_container_non_trovato_nel_2) printf '%s' 'cliente de contentores não encontrado no PATH. Repara o runtime do JHT.' ;;
    line.compose_extra_file_non_e) printf '%s' 'COMPOSE_EXTRA_FILE não é o overlay seccomp do início de sessão: não faço nada.' ;;
    line.compose_up_failed.podman_compose_up_e_uscito) printf '%s' 'podman-compose up saiu com %s. O erro do Podman está aqui em cima.' ;;
    line.compose_up_timeout.podman_compose_up_non_ha) printf '%s' 'podman-compose up não terminou em %ss e foi parado. Um serviço não arrancou: vê «podman ps -a» e «podman logs jht».' ;;
    line.container_jht_non_verificabile_dopo) printf '%s' 'Não é possível verificar o contentor do JHT depois da operação.' ;;
    line.container_s_non_attivo_leggere) printf '%s' 'o contentor '\''%s'\'' não está ativo: ler o plano não o liga. Inicia-o com '\''jht up'\'' e tenta de novo.' ;;
    line.container_s_non_e_partito) printf '%s' 'O contentor '\''%s'\'' não arrancou em 10s. Vê '\''jht logs'\''.' ;;
    line.cosa_fare_jht_mail_setup) printf '%s' 'O que fazer: jht mail setup' ;;
    line.cosa_fare_jht_up) printf '%s' 'O que fazer: jht up' ;;
    line.cosa_fare_jht_up_2) printf '%s' 'O que fazer: jht up' ;;
    line.cosa_fare_jht_up_3) printf '%s' 'O que fazer: jht up' ;;
    line.cosa_fare_jht_upgrade) printf '%s' 'O que fazer: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_2) printf '%s' 'O que fazer: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_3) printf '%s' 'O que fazer: jht upgrade' ;;
    line.cosa_fare_jht_upgrade_4) printf '%s' 'O que fazer: jht upgrade' ;;
    line.cosa_fare_reinstalla_il_runtime) printf '%s' 'O que fazer: reinstala o runtime com o instalador' ;;
    line.cosa_fare_reinstalla_il_runtime_2) printf '%s' 'O que fazer: reinstala o runtime com o instalador' ;;
    line.cosa_fare_reinstalla_il_runtime_3) printf '%s' 'O que fazer: reinstala o runtime com o instalador' ;;
    line.cosa_fare_reinstalla_il_runtime_4) printf '%s' 'O que fazer: reinstala o runtime com o instalador' ;;
    line.cosa_fare_riprova_il_comando) printf '%s' 'O que fazer: tenta o comando de novo' ;;
    line.cosa_fare_riprova_il_comando_2) printf '%s' 'O que fazer: tenta o comando de novo' ;;
    line.data_dir_moved.jht_home_host_s_non) printf '%s' 'JHT_HOME_HOST=%s não é %s. A equipa usa sempre %s: é montada pelo compose, é lida pela app e, no macOS, é a única pasta de dados que a máquina Podman vê. Retira JHT_HOME_HOST, ou move os dados para %s.' ;;
    line.data_dir_moved.jht_user_dir_host_s) printf '%s' 'JHT_USER_DIR_HOST=%s não é %s. A equipa usa sempre %s: é montada pelo compose e, no macOS, é a única pasta de documentos que a máquina Podman vê. Retira JHT_USER_DIR_HOST, ou move os documentos para %s.' ;;
    line.disk_low.gli_agenti_richiedono_almeno_disk) printf '%s' 'Os agentes precisam de pelo menos %s GiB de disco — disponíveis: %s GiB. Para libertar espaço executa '\''jht clean-images'\'' (só remove as versões antigas do Job Hunter Team), esvazia o Lixo e apaga os ficheiros grandes de que não precisas; depois tenta de novo: nada foi descarregado nem alterado.' ;;
    line.docker_punta_a_s_che) printf '%s' 'O Docker aponta para %s, que não é este computador: os contentores e os volumes jht de lá não são tocados. Volta a pôr o Docker no local (DOCKER_HOST ou docker context) e corre de novo.' ;;
    line.fermo_e_ricreo_la_macchina) printf '%s' 'A parar e a recriar a máquina Podman '\''%s'\''...' ;;
    line.fino_ad_allora_la_posta) printf '%s' 'Até lá, o correio lê-se e envia-se com a palavra-passe atual; o aviso fica em jht mail status.' ;;
    line.genera_una_nuova_password_per) printf '%s' 'gera uma nova palavra-passe de aplicação no teu fornecedor e guarda-a com: jht mail setup' ;;
    line.host_setup_sh_non_trovato) printf '%s' 'host-setup.sh não encontrado em %s — salto a verificação prévia do anfitrião' ;;
    line.host_setup_sh_terminato_con) printf '%s' 'host-setup.sh terminou com erro — continuo' ;;
    line.i_segreti_e_lo_stato) printf '%s' 'Os segredos e o estado do broker foram apagados: volta a iniciar sessão nos portais e configura o correio de novo.' ;;
    line.identita_progetto_compose_non_valida) printf '%s' 'Identidade do projeto Compose inválida.' ;;
    line.il_broker_non_ha_registrato) printf '%s' 'O broker não registou a autorização: retirada, nada vai partir.' ;;
    line.il_compose_non_indica_una) printf '%s' 'O compose não indica uma só imagem partilhada para a equipa e o broker; preservação recusada.' ;;
    line.il_container_s_non_c) printf '%s' 'o contentor '\''%s'\'' não existe, mas outros serviços do projeto estão a correr: vou pará-los.' ;;
    line.il_documento_deve_essere_un) printf '%s' 'o documento tem de ser um ficheiro normal, não uma ligação: %s' ;;
    line.il_documento_supera_i_mb) printf '%s' 'o documento ultrapassa os 10 MB' ;;
    line.il_file_del_profilo_supera) printf '%s' 'o ficheiro do perfil ultrapassa os 64 KiB' ;;
    line.il_motore_dei_container_non) printf '%s' 'O motor de contentores não está ativo: não foi removido nada.' ;;
    line.il_profilo_deve_essere_un) printf '%s' 'o perfil tem de ser um ficheiro normal, não uma ligação: %s' ;;
    line.il_progetto_ha_container_che) printf '%s' 'O projeto tem contentores que não são nem a equipa nem os seus serviços atestados: não lhes toco.' ;;
    line.il_runtime_podman_rootless_locale) printf '%s' 'O runtime Podman rootless local não responde.' ;;
    line.il_servizio_s_del_progetto) printf '%s' 'O serviço '\''%s'\'' do projeto está a correr, mas não pode ser atestado como nosso: não lhe toco e não paro mais nada.' ;;
    line.input_interrotto.token_non_letto) printf '%s' 'token não lido.' ;;
    line.integration.install_hint) printf '%s' 'para os instalar: '\''jht upgrade'\'' (ou um '\''jht integration add <id>'\'')' ;;
    line.integration.not_installed) printf '%s' 'não instalada' ;;
    line.integration.not_installed_yet) printf '%s' 'ainda não instalada' ;;
    line.interattivo_il_token_viene_chiesto) printf '%s' 'Interativo: o token é pedido sem eco e depois o bot novo recebe um código de utilização única do teu Telegram. Automatizações: {"bot_token": ...} como JSON no stdin; não guardes o token em ~/.jht e apaga logo qualquer ficheiro usado fora dali.' ;;
    line.jht_home_host_o_jht) printf '%s' 'JHT_HOME_HOST ou JHT_USER_DIR_HOST apontam para outro lado: não apago pastas que não sejam as fixas do JHT.' ;;
    line.jht_telegram_pair_all_interattivo) printf '%s' 'jht telegram pair --all é interativo: para as automatizações emparelha uma função de cada vez.' ;;
    line.job_hunter_team_non_ancora) printf '%s' 'O Job Hunter Team ainda não foi iniciado: corre '\''jht up'\'' (da primeira vez, '\''jht setup'\'').' ;;
    line.job_hunter_team_non_installato) printf '%s' 'O Job Hunter Team não está totalmente instalado: na pasta do runtime falta o ficheiro de integridade (uma instalação interrompida?). Corre o instalador de novo.' ;;
    line.l_overlay_seccomp_dell_accesso) printf '%s' 'O overlay seccomp do início de sessão não é um ficheiro normal.' ;;
    line.la_casella_di_posta_ora) printf '%s' 'A caixa de correio está agora no broker dos segredos. A palavra-passe dela podia ser lida pelos agentes:' ;;
    line.la_connessione_podman_jht_non) printf '%s' 'A ligação Podman do JHT não suporta o dispatcher do Compose.' ;;
    line.la_macchina_e_pronta_ma) printf '%s' 'A máquina está pronta, mas não consegui ativar o trim semanal do disco.' ;;
    line.la_macchina_e_stata_ricreata) printf '%s' 'A máquina foi recriada, mas o estado do broker não passou na verificação/importação.' ;;
    line.la_macchina_podman_s_vede) printf '%s' 'A máquina Podman '\''%s'\'' vê mais pastas do Mac do que as que o JHT precisa (~/.jht e ~/Documents/Job Hunter Team).' ;;
    line.la_nuova_macchina_podman_s) printf '%s' 'A nova máquina Podman '\''%s'\'' não foi criada.' ;;
    line.legacy_cleanup_failed.i_token_nuovi_sono_al) printf '%s' 'os tokens novos estão seguros, mas a cópia antiga de %s ainda está em ~/.jht; transição recusada.' ;;
    line.legacy_cleanup_failed.il_nuovo_token_al_sicuro) printf '%s' 'o token novo está seguro, mas o token antigo ainda está em ~/.jht; transição recusada.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch) printf '%s' 'a equipa fica parada porque o inventário do Telegram do anfitrião não foi guardado.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_2) printf '%s' 'a equipa fica parada porque o inventário do Telegram do anfitrião não foi guardado.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_3) printf '%s' 'a equipa fica parada porque o inventário do Telegram do anfitrião não foi guardado.' ;;
    line.legacy_inventory_failed.il_team_resta_fermo_perch_4) printf '%s' 'a equipa fica parada porque o inventário do Telegram do anfitrião não foi guardado.' ;;
    line.legacy_inventory_failed.le_impronte_non_sono_state) printf '%s' 'as impressões digitais não foram guardadas pelo serviço isolado.' ;;
    line.legacy_inventory_failed.lo_stato_del_container_agenti) printf '%s' 'o estado do contentor dos agentes não pode ser atestado.' ;;
    line.legacy_inventory_failed.migrazione_telegram_interrotta) printf '%s' 'migração do Telegram interrompida.' ;;
    line.legacy_inventory_failed.non_posso_provare_che_jht) printf '%s' 'não posso provar que ~/.jht não tem tokens do Telegram.' ;;
    line.legacy_inventory_failed.non_riesco_a_fermare_gli) printf '%s' 'não consigo parar os agentes antes do inventário do anfitrião.' ;;
    line.legacy_inventory_failed.non_riesco_a_leggere_i) printf '%s' 'não consigo ler os tokens antigos em ~/.jht.' ;;
    line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti) printf '%s' 'funções antigas não reconhecidas.' ;;
    line.legacy_inventory_invalid.migrazione_telegram_interrotta_2) printf '%s' 'migração do Telegram interrompida.' ;;
    line.legacy_migration_failed.s_resta_in_jht_credentials) printf '%s' '%s fica em ~/.jht/credentials (resposta do broker: %s).' ;;
    line.legacy_remove_failed.s_nel_broker_ma_la) printf '%s' '%s está no broker, mas a cópia em ~/.jht/credentials ficou.' ;;
    line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso) printf '%s' '~/.jht/credentials/%s.json reapareceu depois da migração; removido sem o importar.' ;;
    line.macchina_podman_ricreata_vede_solo) printf '%s' 'Máquina Podman recriada: vê só ~/.jht e ~/Documents/Job Hunter Team. O estado do broker foi guardado; as CLI dos fornecedores reinstalam-se sozinhas no primeiro '\''jht up'\'' (cerca de um minuto, é preciso rede: '\''jht providers versions'\'' confirma-o, '\''jht providers update'\'' repõe-nas à mão). Inicia a equipa com '\''jht up'\'', volta a introduzir a palavra-passe do correio e volta a iniciar sessão no LinkedIn.' ;;
    line.mail.address_prompt) printf '%s' 'Endereço da caixa de correio:' ;;
    line.mail.app_password_prompt) printf '%s' 'Palavra-passe de aplicação (não é mostrada):' ;;
    line.mail.dedicated_prompt) printf '%s' 'É uma caixa DEDICADA aos alertas de emprego reencaminhados?' ;;
    line.mail_setup_opzione_sconosciuta_s) printf '%s' 'mail setup: opção desconhecida %s' ;;
    line.mail_setup_password_vuota) printf '%s' 'mail setup: palavra-passe vazia' ;;
    line.migrazione_docker_podman_gia_verificata) printf '%s' 'Migração Docker -> Podman já verificada; os volumes do Docker ficam intactos e ainda contêm as palavras-passe do correio, os acessos aos portais e os tokens do Telegram.' ;;
    line.migrazione_docker_podman_verificata_i) printf '%s' 'Migração Docker -> Podman verificada. Os volumes do Docker não foram removidos e ainda contêm as palavras-passe do correio, os acessos aos portais e os tokens do Telegram: apaga-os só com uma confirmação explícita no futuro comando de limpeza.' ;;
    line.mount_repair_failed.s_non_si_puo_rendere) printf '%s' 'não é possível tornar %s gravável para o contentor (corre como uid %s) e nada foi iniciado. Faz uma vez: sudo chown -R %s %s e corre '\''jht up'\'' de novo.' ;;
    line.nessun_provider_attivo_scegline_uno) printf '%s' 'nenhum fornecedor ativo: escolhe um com '\''jht providers use glm'\''' ;;
    line.nessun_ruolo_ha_un_token) printf '%s' 'Nenhuma função tem um token antigo: para um bot novo usa jht telegram pair <função>.' ;;
    line.niente_da_fermare_nessun_container) printf '%s' 'nada para parar: nenhum contentor do projeto.' ;;
    line.no_answer) printf '%s' 'nenhuma resposta' ;;
    line.no_answer_from_container) printf '%s' 'nenhuma resposta do contentor' ;;
    line.non_autorizzabile_s) printf '%s' 'Não é possível autorizar: %s.' ;;
    line.non_autorizzata_s) printf '%s' 'Não autorizada: %s.' ;;
    line.non_ho_potuto_rimettere_s) printf '%s' 'Não consegui repor '\''%s'\'' como ligação Podman predefinida.' ;;
    line.non_ho_potuto_rimuovere_il) printf '%s' 'Não consegui remover o marcador da migração do broker: %s' ;;
    line.non_riesco_a_creare_jht) printf '%s' 'Não consigo criar ~/.jht ou ~/Documents/Job Hunter Team para a máquina Podman.' ;;
    line.non_riesco_a_creare_jht_2) printf '%s' 'Não consigo criar ~/.jht ou ~/Documents/Job Hunter Team para a máquina Podman.' ;;
    line.non_riesco_a_determinare_l) printf '%s' 'Não consigo determinar a imagem atestada do broker: o compose do runtime não respondeu.' ;;
    line.non_riesco_a_esportare_in) printf '%s' 'Não consigo exportar de forma verificável o estado do broker; a máquina não foi apagada.' ;;
    line.non_riesco_a_fermare_i) printf '%s' 'Não consigo parar os serviços antes de guardar o estado do broker.' ;;
    line.non_riesco_a_leggere_il) printf '%s' 'não consigo ler o documento: %s' ;;
    line.non_riesco_a_rimuovere_i) printf '%s' 'Não consigo remover os contentores parados da versão anterior: «jht down» e depois «jht up».' ;;
    line.non_riesco_a_rimuovere_la) printf '%s' 'Não consigo remover a máquina Podman '\''%s'\''.' ;;
    line.non_riesco_a_sapere_a) printf '%s' 'Não consigo saber com que Docker este computador fala: os contentores e os volumes jht não são tocados.' ;;
    line.non_riesco_a_verificare_quali) printf '%s' 'Não consigo verificar que pastas do Mac a máquina Podman '\''%s'\'' vê.' ;;
    line.non_sono_riuscito_a_cancellare) printf '%s' 'Não consegui apagar %s (pertence a outro utilizador, por exemplo o do contentor, e o contentor de serviço não está disponível).' ;;
    line.opzione_di_clean_images_non) printf '%s' 'Opção de clean-images não suportada: %s (uso: jht clean-images [--json])' ;;
    line.opzione_non_riconosciuta_s) printf '%s' 'opção não reconhecida: %s' ;;
    line.opzione_non_riconosciuta_s_2) printf '%s' 'opção não reconhecida: %s' ;;
    line.opzione_non_riconosciuta_s_3) printf '%s' 'opção não reconhecida: %s' ;;
    line.os_and_version_are_required) printf '%s' '--os e --version são obrigatórios' ;;
    line.override_compose_per_podman_rootless) printf '%s' 'Não é possível escrever o override do Compose para Podman rootless em %s.' ;;
    line.per_l_aiuto_di_s) printf '%s' 'Para a ajuda de '\''%s'\'' é preciso o contentor ativo: '\''jht up'\''.' ;;
    line.per_procedere_jht_podman_machine) printf '%s' 'Para avançar: jht podman-machine-recreate --confirm' ;;
    line.pin_dell_immagine_degli_strumenti) printf '%s' 'o pin da imagem das ferramentas não é fiável' ;;
    line.podman_compose_non_trovato_installa) printf '%s' 'podman-compose não encontrado: instala o pacote «podman-compose» (no Ubuntu: sudo apt install podman-compose).' ;;
    line.podman_machine_avviata_ma_il) printf '%s' 'A máquina Podman foi iniciada, mas o cliente do JHT não responde.' ;;
    line.podman_machine_jht_non_attiva) printf '%s' 'A máquina Podman do JHT não está ativa. Corre '\''jht up'\'' para a iniciar.' ;;
    line.podman_machine_non_avviabile) printf '%s' 'Não é possível iniciar a máquina Podman.' ;;
    line.podman_machine_s_non_attiva) printf '%s' 'A máquina Podman '\''%s'\'' não está ativa, vou iniciá-la...' ;;
    line.podman_non_trovato_reinstalla_il) printf '%s' 'Podman não encontrado: reinstala o runtime do JHT.' ;;
    line.podman_non_trovato_reinstalla_il_2) printf '%s' 'Podman não encontrado: reinstala o runtime do JHT.' ;;
    line.podman_non_trovato_reinstalla_il_3) printf '%s' 'Podman não encontrado: reinstala o runtime do JHT.' ;;
    line.podman_other_machine_running.named) printf '%s' 'outra máquina Podman, %s, está ligada: desliga-a com '\''podman machine stop %s'\'' e tenta de novo.' ;;
    line.podman_other_machine_running.unnamed) printf '%s' 'outra máquina Podman está ligada: encontra-a com '\''podman machine list'\'', desliga-a com '\''podman machine stop <nome>'\'' e tenta de novo.' ;;
    line.podman_remote_service_refused.su_linux_jht_usa_solo) printf '%s' 'no Linux o JHT só usa o Podman local deste utilizador, mas o cliente podman fala com um serviço remoto.' ;;
    line.podman_rootful_refused.jht_su_linux_richiede_podman) printf '%s' 'No Linux o JHT precisa de Podman rootless executado por um utilizador que não seja root.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non) printf '%s' 'o runtime Podman rootless não responde.' ;;
    line.podman_rootless_unavailable.il_runtime_podman_rootless_non_2) printf '%s' 'o runtime Podman rootless não responde.' ;;
    line.preparo_il_servizio_della_posta) printf '%s' 'A preparar o serviço de correio (só é criado na primeira vez que for preciso)…' ;;
    line.provider_attivo_non_riconosciuto_s) printf '%s' 'fornecedor ativo não reconhecido: %s' ;;
    line.provider_podman_compose_non_trovato) printf '%s' 'Fornecedor Podman Compose não encontrado: reinstala o runtime do JHT.' ;;
    line.questo_runtime_non_usa_una) printf '%s' 'Este runtime não usa uma máquina Podman: não há nada para recriar.' ;;
    line.reset_impossibile_cancellare_il_marcatore) printf '%s' 'reset: não é possível apagar o marcador de migração do broker %s.' ;;
    line.reset_impossibile_cancellare_il_marcatore_2) printf '%s' 'reset: não é possível apagar o marcador do broker %s.' ;;
    line.reset_impossibile_cancellare_il_volume) printf '%s' 'reset: não é possível apagar o volume do broker %s (%s).' ;;
    line.reset_nome_volume_non_valido) printf '%s' 'reset: nome de volume inválido para %s; remoção recusada.' ;;
    line.reset_non_riesco_a_determinare) printf '%s' 'reset: não consigo determinar o projeto Compose; os volumes do broker não foram tocados.' ;;
    line.reset_non_riesco_a_fermare) printf '%s' 'reset: não consigo parar o runtime; os volumes do broker não foram tocados.' ;;
    line.reset_ricerca_del_volume_s) printf '%s' 'reset: a procura do volume %s falhou.' ;;
    line.reset_ricerca_del_volume_s_2) printf '%s' 'reset: a procura do volume %s falhou.' ;;
    line.restano_token_legacy_per_s) printf '%s' 'Restam tokens antigos para: %s. Enquanto não emparelhares também estas funções, %s fica calado no Telegram: emparelha-as todas nesta sessão (jht telegram pair --all).' ;;
    line.ricrea_la_macchina_podman_s) printf '%s' 'Recria a máquina Podman '\''%s'\'': para-a e apaga-a, depois recria-a a ver só ~/.jht e ~/Documents/Job Hunter Team.' ;;
    line.ricreala_con_jht_podman_machine) printf '%s' 'Recria-a com '\''jht podman-machine-recreate --confirm'\'': os ficheiros e o estado do broker ficam, mas as CLI internas e os segredos são apagados.' ;;
    line.risposta_del_container_non_valida) printf '%s' 'Resposta do contentor inválida: autorização retirada, nada vai partir.' ;;
    line.ritirata_s_non_verra_inviata) printf '%s' 'Retirada #%s: não vai ser enviada.' ;;
    line.ritiro_non_riuscito_s) printf '%s' 'A retirada falhou: %s.' ;;
    line.runtime_host_non_attendibile_path) printf '%s' 'runtime do anfitrião não fiável (caminho, dono, permissões ou SHA-256)' ;;
    line.runtime_host_protetto_non_installabile) printf '%s' 'não é possível instalar o runtime protegido do anfitrião; o antigo ~/.jht/runtime não é usado' ;;
    line.runtime_migration_changed.checksum_diverso_per_s_dopo) printf '%s' 'checksum diferente para %s depois da migração.' ;;
    line.runtime_migration_changed.s_non_corrisponde_piu_al) printf '%s' '%s já não corresponde ao marcador verificado.' ;;
    line.runtime_migration_checksum_mismatch.s_non_ha_superato_la) printf '%s' '%s não passou na verificação.' ;;
    line.runtime_migration_docker_missing.il_client_docker_originale_non) printf '%s' 'o cliente Docker original não está disponível.' ;;
    line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata) printf '%s' 'é precisa a imagem do JHT fixada por digest.' ;;
    line.runtime_migration_image_missing.la_stessa_immagine_jht_deve) printf '%s' 'a mesma imagem do JHT tem de existir no Docker e no Podman.' ;;
    line.runtime_migration_interrupted.copia_incompleta_di_s_il) printf '%s' 'cópia incompleta de %s; a origem no Docker está intacta.' ;;
    line.runtime_migration_podman_missing.podman_non_e_disponibile) printf '%s' 'O Podman não está disponível.' ;;
    line.runtime_migration_source_missing.s_manca_in_docker_ma) printf '%s' '%s falta no Docker, mas existe no Podman; não o substituo.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_docker) printf '%s' 'para primeiro a equipa no Docker.' ;;
    line.runtime_migration_team_running.ferma_prima_il_team_podman) printf '%s' 'para primeiro a equipa no Podman.' ;;
    line.runtime_o_container_jht_non) printf '%s' 'runtime ou contentor do JHT não disponível' ;;
    line.ruoli_da_abbinare_in_questa) printf '%s' 'Funções a emparelhar nesta sessão: %s' ;;
    line.s_e_un_collegamento_non) printf '%s' '%s é uma ligação: não a sigo e não a apago.' ;;
    line.s_ha_gi_un_bot) printf '%s' '%s já tem um bot emparelhado: só removo a sua cópia antiga.' ;;
    line.s_needs_a_value) printf '%s' '%s precisa de um valor' ;;
    line.s_non_e_una_cartella) printf '%s' '%s não é uma pasta: não a apago.' ;;
    line.saltato_non_trovato_volume_broker) printf '%s' 'Saltado (não encontrado): volume do broker %s' ;;
    line.script_s_non_ancora_installato) printf '%s' 'o script %s ainda não está instalado: '\''jht upgrade'\'' (ou um '\''jht integration add/remove'\'') e tenta de novo' ;;
    line.script_s_non_scaricabile_controlla) printf '%s' 'não é possível descarregar o script %s: verifica a rede ou faz '\''jht upgrade'\''' ;;
    line.serve_un_terminale_l_autorizzazione) printf '%s' 'É preciso um terminal: a autorização confirma-se à mão.' ;;
    line.status.caller_env) printf '%s' 'No ambiente deste terminal estão definidas: %s. O contentor foi criado sem elas: remove a variável (unset) e tenta de novo.' ;;
    line.status.provider_said) printf '%s' 'O fornecedor disse: %s' ;;
    line.status.unattestable) printf '%s' 'contentor '\''%s'\'' não atestável: há algo que não se consegue verificar (uma configuração diferente da esperada, ou o motor que não responde); não quer dizer que não esteja a correr.' ;;
    line.sudo_chown_fallito_su_s) printf '%s' 'sudo chown falhou em %s (pode ser preciso '\''sudo %s up'\'')' ;;
    line.telegram_isolato_attivo_il_bridge) printf '%s' 'Telegram isolado ativo; a bridge antiga já não pode ser reativada pelos agentes.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_3) printf '%s' 'não é possível ler o compose do runtime instalado; não se sabe se tem o serviço Telegram isolado.' ;;
    line.telegram_unavailable.il_compose_del_runtime_installato_4) printf '%s' 'não é possível ler o compose do runtime instalado; não se sabe se tem o serviço Telegram isolado.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_3) printf '%s' 'o runtime instalado é mais antigo e não tem o serviço Telegram isolado.' ;;
    line.telegram_unavailable.il_runtime_installato_pi_vecchio_4) printf '%s' 'o runtime instalado é mais antigo e não tem o serviço Telegram isolado.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non) printf '%s' 'o serviço Telegram isolado não está ativo ou não pode ser atestado.' ;;
    line.telegram_unavailable.il_servizio_telegram_isolato_non_2) printf '%s' 'o serviço Telegram isolado não está ativo ou não pode ser atestado.' ;;
    line.the_setup_keeps_the_key) printf '%s' 'A configuração guarda a chave: podes apagar já o ficheiro neste computador (%s).' ;;
    line.togli_remote_true_da_containers) printf '%s' 'Retira remote = true do containers.conf (ou CONTAINERS_CONF) para este utilizador e tenta de novo.' ;;
    line.unattestable.autostart) printf '%s' 'Não é possível atestar o contentor JHT existente; arranque automático recusado.' ;;
    line.unattestable.existing) printf '%s' 'Não é possível atestar o contentor JHT existente; operação interrompida.' ;;
    line.unattestable.logs) printf '%s' 'Não é possível atestar o contentor JHT; leitura dos logs recusada.' ;;
    line.unattestable.other) printf '%s' 'Não é possível atestar o contentor JHT; operação recusada.' ;;
    line.unattestable.recreate) printf '%s' 'Não é possível atestar o contentor JHT; recriação recusada.' ;;
    line.unattestable.restart) printf '%s' 'Não é possível atestar o contentor JHT; reinício recusado.' ;;
    line.unattestable.stop) printf '%s' 'Não é possível atestar o contentor JHT; paragem recusada.' ;;
    line.unknown_argument_s) printf '%s' 'argumento desconhecido: %s' ;;
    line.upgrade.activate) printf '%s' 'A ativar o novo runtime...' ;;
    line.upgrade.broker_restart_failed) printf '%s' 'o broker dos segredos não voltou a arrancar. O que fazer: jht up' ;;
    line.upgrade.check_available) printf '%s' 'Verificação: há uma atualização, %s (%s) -> %s. %s. Para a aplicar: jht upgrade' ;;
    line.upgrade.check_none) printf '%s' 'Verificação: nenhuma atualização, %s (%s) já é a mais recente. %s.' ;;
    line.upgrade.check_only) printf '%s' 'Verificação: %s.' ;;
    line.upgrade.disk_room) printf '%s' 'A atualização descarrega cerca de %s GiB, e depois do descarregamento os agentes ficariam com menos dos %s GiB de disco de que precisam: agora há %s GiB livres. Liberta pelo menos mais %s GiB (esvazia o Lixo, apaga os ficheiros grandes de que não precisas) e tenta de novo: nada foi descarregado nem alterado (só foram removidas as versões antigas do Job Hunter Team que nada usava).' ;;
    line.upgrade.done) printf '%s' 'Atualização concluída: %s (%s) -> %s (%s). %s' ;;
    line.upgrade.failed) printf '%s' 'Atualização não concluída (%s): %s. %s' ;;
    line.upgrade.full_pull_failed) printf '%s' 'a nova imagem completa não chegou, fica a antiga. O que fazer: jht tools pull' ;;
    line.upgrade.helper_install_failed) printf '%s' 'os novos scripts do host obtêm-se no primeiro pedido ou com outro '\''jht upgrade'\''' ;;
    line.upgrade.interrupted) printf '%s' 'Detetada uma atualização interrompida: vou repor a última versão verificada...' ;;
    line.upgrade.keep_old) printf '%s' 'Imagens antigas do JHT: mantidas todas (JHT_KEEP_OLD_IMAGES=1).' ;;
    line.upgrade.publish) printf '%s' 'A publicar a configuração candidata atestada...' ;;
    line.upgrade.pull_full) printf '%s' 'A descarregar a imagem completa atualizada...' ;;
    line.upgrade.pull_latest) printf '%s' 'A descarregar a imagem mais recente...' ;;
    line.upgrade.pull_runtime) printf '%s' 'A descarregar o runtime atualizado...' ;;
    line.upgrade.restored) printf '%s' 'Runtime anterior reposto.' ;;
    line.upgrade.telegram_restart_failed) printf '%s' 'o serviço Telegram isolado não voltou a arrancar. O que fazer: jht up' ;;
    line.upgrade.verify) printf '%s' 'A verificar o runtime atualizado...' ;;
    line.uso_jht_apply_relink_account) printf '%s' 'uso: jht apply relink-account' ;;
    line.uso_jht_apply_request_cancel) printf '%s' 'uso: jht apply request|cancel <id>' ;;
    line.uso_jht_apply_request_cancel_2) printf '%s' 'uso: jht apply request|cancel <id>' ;;
    line.uso_jht_artifact_upload_file) printf '%s' 'uso: jht artifact upload FICHEIRO [--json]' ;;
    line.uso_jht_artifact_upload_file_2) printf '%s' 'uso: jht artifact upload FICHEIRO [--json]' ;;
    line.uso_jht_mail_setup_status) printf '%s' 'uso: jht mail setup|status|admission <allowlist|whole_mailbox>|allow add|remove <endereço|@domínio>|drafts|approve <id>|discard <id>|journal|delete|migrate' ;;
    line.uso_jht_migrate_runtime_podman) printf '%s' 'uso: jht migrate-runtime podman' ;;
    line.uso_jht_profile_import_file) printf '%s' 'uso: jht profile import FICHEIRO [--replace] [--json]' ;;
    line.uso_jht_profile_import_file_2) printf '%s' 'uso: jht profile import FICHEIRO [--replace] [--json]' ;;
    line.uso_jht_profile_validate_file) printf '%s' 'uso: jht profile validate [FICHEIRO] [--strict] [--json]' ;;
    line.uso_jht_screen_on_off) printf '%s' 'uso: jht screen on | off | status [--json]' ;;
    line.uso_jht_telegram_chat_id) printf '%s' 'uso: jht telegram chat-id <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_pair_assistente) printf '%s' 'uso: jht telegram pair <assistente|capitano|mentor>|--all' ;;
    line.uso_jht_telegram_remove_assistente) printf '%s' 'uso: jht telegram remove <assistente|capitano|mentor>' ;;
    line.uso_jht_telegram_status_pair) printf '%s' 'uso: jht telegram status|pair <função>|pair --all|chat-id <função>|remove <função>' ;;
    line.uso_jht_ticket_open_posizione) printf '%s' 'uso: jht ticket open POSIÇÃO TEXTO [--kind TIPO] [--attach FICHEIRO]' ;;
    line.uso_jht_ticket_open_posizione_2) printf '%s' 'uso: jht ticket open POSIÇÃO TEXTO [--kind TIPO] [--attach FICHEIRO]' ;;
    line.versione_dell_immagine_configurata_per) printf '%s' 'Versão da imagem configurada. Para a da CLI em execução: '\''jht up'\'' e depois '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_2) printf '%s' 'Versão da imagem configurada. Para a da CLI em execução: '\''jht up'\'' e depois '\''jht --version'\''.' ;;
    line.versione_dell_immagine_configurata_per_3) printf '%s' 'Versão da imagem configurada. Para a da CLI em execução: '\''jht up'\'' e depois '\''jht --version'\''.' ;;
    line.versione_di_podman_compose_non) printf '%s' 'Não é possível ler a versão do podman-compose.' ;;
    line.versione_non_supportata_servono_podman) printf '%s' 'Versão não suportada: é preciso podman >= %s (encontrado: %s) e podman-compose >= %s (encontrado: %s).' ;;
    line.versione_non_supportata_sul_mac) printf '%s' 'Versão não suportada: no Mac é preciso podman %s.%s ou um %s.x posterior (não 6.2 ou superior; encontrado: %s) e podman-compose %s (encontrado: %s). Se atualizaste o Homebrew para além da série %s, atualiza o JHT (curl -fsSL https://jobhunterteam.ai/install.sh | bash).' ;;
    migrate.left) printf '%s' 'Não copiado ou não verificado: o volume %s.' ;;
    monitor.window_failed) printf '%s' 'monitor_window_unavailable: não é possível abrir uma janela de terminal aqui. Corre '\''jht monitor'\'' no terminal atual (ou dentro da tua sessão tmux).' ;;
    monitor.window_invalid) printf '%s' 'monitor_window_invalid: usa '\''jht monitor --window'\'' sem outras opções.' ;;
    removed.office) printf '%s' ''\''jht %s'\'' foi removido na 0.4.0 juntamente com o escritório Godot: usa os comandos jht (jht help).' ;;
    status.container) printf '%s' 'Contentor' ;;
    status.image) printf '%s' 'Imagem' ;;
    status.next_other) printf '%s' 'Liga a equipa com: jht up' ;;
    status.next_running) printf '%s' 'Quem está a trabalhar: jht agents' ;;
    status.no_options) printf '%s' ''\''jht status'\'' não aceita opções (%s): corre-o como '\''jht status'\''.' ;;
    status.not_running) printf '%s' 'O contentor da equipa não está a correr.' ;;
    status.not_running_next) printf '%s' 'Liga-o com: jht up' ;;
    status.running) printf '%s' 'a correr desde %s' ;;
    status.state) printf '%s' '%s desde %s' ;;
    status.title) printf '%s' 'Estado' ;;
    team.stopped) printf '%s' 'O Job Hunter Team está parado: '\''jht up'\'' volta a ligá-lo.' ;;
    tools.arriving) printf '%s' 'As ferramentas dos Scout estão a caminho: a imagem completa está a ser descarregada em segundo plano (cerca de 3 GB). A procura de vagas começa sozinha quando chegarem; não tens de fazer nada.' ;;
    tools.chat_reconnecting) printf '%s' 'A equipa passa para as ferramentas completas dos Scout, por isso o chat para por um momento: volta sozinho assim que a equipa estiver a funcionar outra vez (alguns minutos).' ;;
    tools.chat_resumed) printf '%s' 'A equipa passou para as ferramentas completas: vamos continuar.' ;;
    tools.chat_switched) printf '%s' 'A equipa passa para as ferramentas completas dos Scout, por isso este chat fechou-se. Volta a abri-lo dentro de alguns minutos com jht team chat.' ;;
    tools.chat_update_closed) printf '%s' 'O JHT está a atualizar-se, por isso este chat fechou-se. Volta a abri-lo dentro de alguns minutos com jht team chat.' ;;
    tools.chat_update_resumed) printf '%s' 'O JHT está atualizado: vamos continuar.' ;;
    tools.chat_updating) printf '%s' 'O JHT está a atualizar-se, por isso o chat para por um momento: volta sozinho dentro de um ou dois minutos.' ;;
    tools.disk_low) printf '%s' 'As ferramentas dos Scout não foram descarregadas: precisam de cerca de %s GiB livres no disco e há %s GiB, por isso a equipa ainda não pode procurar vagas. Liberta espaço (esvazia o Lixo, apaga os ficheiros grandes de que não precisas) e depois corre jht up: o descarregamento recomeça sozinho.' ;;
    tools.engine_down) printf '%s' 'Não é possível ler o estado das ferramentas dos Scout: o motor de contentores não responde. Inicia-o com jht up.' ;;
    tools.failed) printf '%s' 'O descarregamento das ferramentas dos Scout falhou, por isso a equipa ainda não pode procurar vagas. Corre jht tools pull para tentar de novo (jht up também tenta de novo).' ;;
    tools.not_started) printf '%s' 'A descarga das ferramentas dos Scouts não começou, por isso a equipa ainda não pode procurar posições. Corre jht tools pull para a iniciar (jht up também a inicia).' ;;
    tools.ready) printf '%s' 'As ferramentas dos Scout já chegaram: a equipa procura com a imagem completa.' ;;
    tools.switch_failed) printf '%s' 'As ferramentas dos Scout já chegaram, mas não foi possível reiniciar a equipa com elas: corre jht down e depois jht up.' ;;
    tools.switch_wait) printf '%s' 'A equipa está a passar para as ferramentas completas dos Scout: espero que volte a arrancar (no máximo alguns minutos).' ;;
    tools.waiting) printf '%s' 'As ferramentas dos Scout já chegaram: a equipa passa para elas sozinha quando o onboarding estiver concluído.' ;;
    uninstall.bad_home) printf '%s' 'HOME não é válida: remoção recusada.' ;;
    uninstall.colima_busy) printf '%s' 'O Colima continua a correr: foi o instalador do JHT que o ligou, mas há outros contentores a correr nele, por isso fica ligado. Para o parar: colima stop.' ;;
    uninstall.colima_running) printf '%s' 'O Colima continua a correr: não foi o instalador do JHT que o ligou (já estava ligado, ou não é o padrão), por isso fica ligado, e pode ser teu. Para o parar: colima stop.' ;;
    uninstall.colima_stop_failed) printf '%s' 'Não foi possível parar o Colima. Para o parar: colima stop.' ;;
    uninstall.colima_stopping) printf '%s' 'A parar a máquina virtual Colima, que o instalador do JHT ligou e onde não corre mais nada; as tuas pastas no Mac ficam.' ;;
    uninstall.compose_link_left) printf '%s' 'Não foi possível remover a ligação ao plugin Docker Compose que o instalador do JHT criou: %s. Podes apagá-la.' ;;
    uninstall.compose_link_removed) printf '%s' 'Removida a ligação ao plugin Docker Compose que o instalador do JHT criou: %s. O plugin instalado pelo Homebrew fica (brew uninstall docker-compose remove-o).' ;;
    uninstall.images_removed) printf '%s' 'Removidas %s imagens do JHT: o núcleo, a completa e as antigas.' ;;
    uninstall.left.commands) printf '%s' 'Não removidos: o comando jht ou as linhas PATH que o instalador acrescentou.' ;;
    uninstall.left.data) printf '%s' 'Os dados do JHT listados acima não foram apagados. O comando jht e o runtime continuam lá: corre '\''jht uninstall --confirm --purge'\'' de novo depois de resolveres isso.' ;;
    uninstall.left.images) printf '%s' 'Não removidas: algumas imagens do JHT (o motor recusou). Corre '\''jht uninstall --confirm'\'' de novo quando mais nada as usar.' ;;
    uninstall.left.machine) printf '%s' 'Não removidos: a máquina Podman jht-podman ou os contentores e volumes do JHT, com os segredos guardados. Corre '\''jht uninstall --confirm'\'' de novo quando o Podman ou o Docker responderem.' ;;
    uninstall.left.runtime) printf '%s' 'Não removido: o runtime do anfitrião do JHT.' ;;
    uninstall.loss) printf '%s' 'A palavra-passe do correio e os tokens do Telegram guardados também são apagados; ~/.jht e Documentos ficam, e com eles a sessão do LinkedIn guardada (secrets/linkedin-profile e .cache/linkedin): remove-a com jht reset --scope creds.' ;;
    uninstall.loss_purge) printf '%s' 'A palavra-passe do correio e os tokens do Telegram guardados também são apagados.' ;;
    uninstall.machine_kept) printf '%s' 'A máquina Podman '\''%s'\'' não foi criada pelo instalador do JHT (já existia, ou não é a jht-podman padrão), por isso não é removida: pode ser tua. Os volumes e a imagem do JHT que tem dentro ficam com ela. Para a remover: podman machine stop %s e depois podman machine rm %s.' ;;
    uninstall.machine_removing) printf '%s' 'A remover a máquina Podman '\''%s'\'', que o instalador do JHT criou: tudo o que tem dentro vai com ela (os volumes e a imagem do JHT); as tuas pastas no Mac ficam.' ;;
    uninstall.phase.commands) printf '%s' 'A remover o comando jht e as linhas PATH que o instalador acrescentou...' ;;
    uninstall.phase.data) printf '%s' 'A apagar ~/.jht e a pasta Documentos (--purge)...' ;;
    uninstall.phase.images) printf '%s' 'A remover as imagens do JHT (o núcleo, a completa e as antigas)...' ;;
    uninstall.phase.machine) printf '%s' 'A remover a máquina Podman, ou os contentores e volumes do JHT...' ;;
    uninstall.phase.runtime) printf '%s' 'A remover o runtime do anfitrião...' ;;
    uninstall.purge_loss) printf '%s' 'Com --purge também são apagados ~/.jht e ~/Documents/Job Hunter Team: configuração, base de dados, currículos e resultados. Não há volta atrás.' ;;
    uninstall.runtime_choice_unreadable) printf '%s' 'A escolha do runtime do JHT não pode ser lida: nada foi removido.' ;;
    uninstall.usage) printf '%s' 'utilização: jht uninstall --confirm [--purge]' ;;
    uninstall.usage_stays) printf '%s' 'O Podman, o podman-compose, o Docker, o Colima e o Homebrew também ficam.' ;;
    uninstall.usage_what) printf '%s' 'Remove o runtime local do JHT: a máquina Podman jht-podman ou os contentores, volumes e imagens do JHT (o núcleo e a completa, pelos nomes de repositório ghcr.io/leopu00/jht, jht e localhost/jht), o runtime do anfitrião e o comando jht.' ;;
    up.docker_legacy) printf '%s' 'Este computador corre o JHT no Docker, e o seu motor não responde. Desde a 0.4 o JHT só corre no Podman. Os teus dados ficam: ~/.jht e ~/Documents/Job Hunter Team são pastas deste computador. Para passar para o Podman: jht uninstall --confirm (mantém essas duas pastas), corre o instalador de novo e depois jht setup com a tua chave API (a chave, a palavra-passe do correio e os tokens do Telegram ficaram nos volumes do Docker: volta a dá-los). Para continuar com o Docker por agora, liga tu o seu motor e corre jht up de novo.' ;;
    up.done) printf '%s' 'Job Hunter Team iniciado.' ;;
    up.engine_lost) printf '%s' 'A máquina Podman parou enquanto a equipa arrancava (%s). Não perdeste nada: os teus dados estão nos volumes e nas tuas pastas. Corre jht up de novo: liga a máquina e a equipa.' ;;
    up.storage_damaged) printf '%s' 'A imagem da equipa ficou danificada no disco da máquina Podman (a máquina foi desligada de repente enquanto a escrevia): vou transferi-la de novo e recriar os contentores. Os teus dados estão nos volumes e nas tuas pastas, e ficam. Demora alguns minutos.' ;;
    up.storage_repair_failed) printf '%s' 'Não foi possível reparar a imagem da equipa na máquina Podman. '\''jht uninstall --confirm'\'' e depois o instalador criam uma máquina nova (as pastas ~/.jht e Documentos ficam).' ;;
    *) return 1 ;;
  esac
}
# <<< texts in the 7 languages

jht_say() {
  local key="$1" lang="${JHT_SAY_LANG:-${JHT_LANG:-en}}" format
  shift
  case "$lang" in en|it|hu|es|de|fr|pt) ;; *) lang=en ;; esac
  format="$("jht_text_$lang" "$key" 2>/dev/null)" || format="$(jht_text_en "$key")" || format="$key"
  # shellcheck disable=SC2059
  printf -- "$format" "$@"
}

# Colori solo se stdout e' un terminale.
# T220: declared host bridge to move into the T214 Rust sidecar. No data logic.
# Explicit rule-2 exception: <=60 added lines, no installer/manifest dependency.
jht_monitor_window() {
  local self="$1" pid
  shift
  if [ "$#" -ne 1 ] || [ "$1" != --window ]; then err "$(jht_say monitor.window_invalid)"; return 2; fi
  if [[ "$self" =~ [[:cntrl:]] ]]; then err "$(jht_say monitor.window_failed)"; return 1; fi
  self="$(cd -P "$(dirname "$self")" 2>/dev/null && printf '%s/%s' "$(pwd -P)" "${self##*/}")" \
    && [ -f "$self" ] && [ -x "$self" ] || { err "$(jht_say monitor.window_failed)"; return 1; }
  if [ -n "${TMUX:-}" ] && command -v tmux >/dev/null 2>&1; then
    tmux new-window -n JHT-monitor -- "$self" monitor >/dev/null 2>&1 && return 0
  elif [ "$HOST_KERNEL" = Darwin ] && command -v osascript >/dev/null 2>&1; then
    if osascript - "$self" >/dev/null 2>&1 <<'JHT_MONITOR_APPLESCRIPT'
on run argv
  tell application "Terminal"
    do script ((quoted form of (item 1 of argv)) & " monitor")
    activate
  end tell
end run
JHT_MONITOR_APPLESCRIPT
    then return 0; fi
  elif [ "$HOST_KERNEL" = Linux ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] \
      && command -v x-terminal-emulator >/dev/null 2>&1; then
    nohup x-terminal-emulator -e "$self" monitor </dev/null >/dev/null 2>&1 &
    pid=$!
    # Bounded launch check, not a claim that the GUI or its monitor is ready.
    sleep 0.25
    if kill -0 "$pid" 2>/dev/null; then return 0; fi
    wait "$pid" && return 0
  fi
  err "$(jht_say monitor.window_failed)"
  return 1
}

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

# Host helpers: scripts of the runtime (scripts/<name>) attested like host-setup.sh, in a manifest of their own (.runtime-helpers,
# `<name>=<sha256>`): the desktop app checks the main manifest key by key and must not meet a key it does not know. A helper is
# loaded with `source` only while the file still matches its line there. A runtime that has none yet (installed before them)
# gets it from the release origin when the person runs `add` or `remove` (never from a read-only command), and at the end of
# every upgrade.
# `jht down` asked by the person: while this file is there, no command but `jht up`, `jht start-container` and `jht setup` makes or
# starts the team's container (a `jht doctor` or any command forwarded to it used to start it again a second after the down, with no
# agent in it, and the installer then found the team running, exit 84). In the runtime folder, which no container mounts.
TEAM_STOPPED_MARKER="$RUNTIME_DIR/team-stopped"
team_stopped_by_person() { [ -f "$TEAM_STOPPED_MARKER" ] && [ ! -L "$TEAM_STOPPED_MARKER" ]; }
team_stopped_mark() { rm -f -- "$TEAM_STOPPED_MARKER" 2>/dev/null; (umask 077 && printf 'jht down\n' > "$TEAM_STOPPED_MARKER") 2>/dev/null || true; }
team_stopped_clear() { rm -f -- "$TEAM_STOPPED_MARKER" 2>/dev/null || true; }

# The setup that is about to open says so on the HOST, before the container is started: the watchdog of the container wakes
# the Assistant and the Mentor the moment it is up, and the flag the wizard writes itself came 40 seconds later (the Mentor
# spent before the person chose the budget). Same file and same 2 h life as cli/src/lib/setup-open.js, which rewrites it when
# the wizard opens and removes it when it ends. Only for the wizard (no sub-command, no --non-interactive), never through a
# link, and silently skipped where the folder is not writable by this user (Linux with Docker: the container writes it).
setup_wizard_args() {
  local arg
  [ "$#" -eq 0 ] || case "$1" in -*) ;; *) return 1 ;; esac
  for arg in "$@"; do [ "$arg" != --non-interactive ] || return 1; done
  return 0
}
setup_open_flag_path() { printf '%s' "${JHT_HOME_HOST:-$HOME/.jht}/.setup-open.flag"; }
setup_open_flag_write() {
  local flag; flag="$(setup_open_flag_path)"
  [ -d "$(dirname "$flag")" ] || return 0
  rm -f -- "$flag" 2>/dev/null || true
  ( umask 077; set -C; date -u +%Y-%m-%dT%H:%M:%SZ > "$flag" ) 2>/dev/null || true
}
setup_open_flag_remove() { rm -f -- "$(setup_open_flag_path)" 2>/dev/null || true; }

RUNTIME_HELPERS="jht-integration.sh jht-tools.sh"
RUNTIME_HELPERS_MANIFEST="$RUNTIME_DIR/.runtime-helpers"

runtime_helper_digest() {
  sed -n "s/^${1}=//p" "$RUNTIME_HELPERS_MANIFEST" 2>/dev/null | head -n 1
}

runtime_helpers_write_manifest() {
  local tmp="${RUNTIME_HELPERS_MANIFEST}.tmp.$$" helper
  umask 077
  {
    for helper in $RUNTIME_HELPERS; do
      if [ -f "$RUNTIME_DIR/$helper" ]; then printf '%s=%s\n' "$helper" "$(runtime_sha256 "$RUNTIME_DIR/$helper")"; fi
    done
  } > "$tmp" || return 1
  chmod 600 "$tmp" || { rm -f "$tmp"; return 1; }
  mv -f "$tmp" "$RUNTIME_HELPERS_MANIFEST"
}

runtime_helpers_trusted() {
  local helper want
  [ -e "$RUNTIME_HELPERS_MANIFEST" ] || [ -L "$RUNTIME_HELPERS_MANIFEST" ] || return 0
  runtime_node_safe "$RUNTIME_HELPERS_MANIFEST" file || return 1
  for helper in $RUNTIME_HELPERS; do
    want="$(runtime_helper_digest "$helper")"
    [ -n "$want" ] || continue
    runtime_node_safe "$RUNTIME_DIR/$helper" file || return 1
    [ "$want" = "$(runtime_sha256 "$RUNTIME_DIR/$helper")" ] || return 1
  done
}

runtime_helpers_install() {
  local stage base helper
  runtime_bundle_trusted || return 1
  base="$(attested_raw_base)" || return 1
  stage="$(mktemp -d "$RUNTIME_DIR/.helpers.XXXXXX")" || return 1
  for helper in $RUNTIME_HELPERS; do
    if ! { curl -fsSL "${base%/}/scripts/$helper" -o "$stage/$helper" && bash -n "$stage/$helper" \
        && grep -Fqx '# JHT_RUNTIME_HELPER=1' "$stage/$helper" && upgrade_atomic_replace "$stage/$helper" "$RUNTIME_DIR/$helper" 700; }; then
      rm -rf "$stage"
      return 1
    fi
  done
  rm -rf "$stage"
  runtime_helpers_write_manifest
}

# Before the helper is there (an install whose first download of the tools has not happened yet) the read-only commands that the app
# reads answer "not installed yet", in the same shape the helper uses, instead of failing: `jht tools status --json`,
# `jht integration list|status [id] [--json]`. $1 is tools|integration, the rest what the person typed. Returns 3 for anything else
# (the old path: add, remove, a wrong use), so the caller goes on to the helper and its error.
INTEGRATION_IDS_ABSENT="google telegram mail linkedin-login screen media"
runtime_helper_absent_answer() {
  local what="$1" word="${2:-}" json=0 id="" arg
  [ "$#" -gt 2 ] && shift 2 || shift "$#"
  for arg in "$@"; do
    case "$arg" in --json) json=1 ;; -*) return 3 ;; *) [ -z "$id" ] || return 3; id="$arg" ;; esac
  done
  case "$what:$word" in
    tools:status) [ "$json" = 1 ] && [ -z "$id" ] || return 3; printf '{"ok":true,"state":"none","tier":"full","reason":"not_installed"}\n'; return 0 ;;
    integration:list|integration:status) ;;
    *) return 3 ;;
  esac
  [ "$word" = status ] || [ -z "$id" ] || return 3
  case " $INTEGRATION_IDS_ABSENT " in *" $id "*) ;; *) [ -z "$id" ] || return 3 ;; esac
  local ids="${id:-$INTEGRATION_IDS_ABSENT}" one first=1
  if [ "$json" = 1 ] && [ -n "$id" ]; then printf '{"id":"%s","state":"not_installed","reason":"non ancora installato"}\n' "$id"; return 0; fi
  [ "$json" = 0 ] || printf '{"integrations":['
  for one in $ids; do
    if [ "$json" = 1 ]; then [ "$first" = 1 ] || printf ','; first=0; printf '{"id":"%s","state":"not_installed","reason":"non ancora installato"}' "$one"
    else printf '%-15s %-16s %s\n' "$one" "$(jht_say line.integration.not_installed)" "$(jht_say line.integration.not_installed_yet)"; fi
  done
  [ "$json" = 0 ] || printf ']}\n'
  # In words, the person is told which command installs them (the lines above stay the shape the helper gives).
  [ "$json" = 1 ] || printf '%s\n' "$(jht_say line.integration.install_hint)" >&2
  return 0
}

# $2 is the command of the person: only `add` and `remove` fetch a helper that is missing. `jht tools` never does: its commands run by
# themselves after the install, and a download at the tip of the branch is not something to start without the person asking for it.
runtime_helper_load() {
  local helper="$1" extras_digest
  if [ -z "$(runtime_helper_digest "$helper")" ]; then
    case "${2:-}" in
      add|remove) runtime_helpers_install || { err "$(jht_say line.script_s_non_scaricabile_controlla "$helper")"; return 1; } ;;
      *) err "$(jht_say line.script_s_non_ancora_installato "$helper")"; return 1 ;;
    esac
  fi
  runtime_helpers_trusted || return 1
  . "$RUNTIME_DIR/$helper" || return 1
  extras_digest="$(runtime_extras_digest)" || { err "$(jht_say line.pin_dell_immagine_degli_strumenti)"; return 1; }
  EXTRAS_IMAGE_DIGEST="$extras_digest"
}

# The tools of a core install (P4). The installer leaves the core image; the full one, with the Scouts' tools, comes after, pulled
# in the background, and the team moves onto it once the onboarding has closed. The desktop app kept that moving; with the CLI only
# it is `jht up` and `jht setup` that start it (tools_kick in jht-tools.sh: one detached job, idempotent) and `jht up`, `jht setup`
# and `jht status` that say where it stands, in the person's language. A helper that is missing or not trusted says nothing here: the
# command it rides on is never failed by it.
tools_tell_person() {
  local kick="${1:-}"
  [ -f "$RUNTIME_TIER_FILE" ] || [ -f "$RUNTIME_DIR/.tools-switch-failed" ] || return 0
  [ -n "$(runtime_helper_digest jht-tools.sh 2>/dev/null)" ] || return 0
  (
    runtime_helper_load jht-tools.sh >/dev/null 2>&1 || exit 0
    [ "$kick" = kick ] && tools_kick
    case "$(tools_person_state)" in
      arriving) info "$(jht_say tools.arriving)" ;;
      not_started) warn "$(jht_say tools.not_started)" ;;
      waiting) info "$(jht_say tools.waiting)" ;;
      failed) warn "$(jht_say tools.failed)" ;;
      disk_low) warn "$(tools_disk_low_text)" ;;
      switch_failed) warn "$(jht_say tools.switch_failed)" ;;
    esac
  ) || true
}

# The team just moved onto this version (`jht up`, `jht setup`): when the disk is already under the agents' threshold (disk_low),
# the old images of JHT go now, with the trim of a Mac's machine, before the agents start, and not only before the pull of the
# tools. An update by the installer left the old version's image beside the new one, and every agent refused to start (giro Mac
# build8). The rules are the cleaning's (tools_clean_old_images in jht-tools.sh: only when the container runs this version's
# image, never during an upgrade, JHT_KEEP_OLD_IMAGES=1 keeps all). Never fails the command it rides on.
agents_room_cleanup() {
  disk_room_after_download 0 && return 0
  [ -n "$(runtime_helper_digest jht-tools.sh 2>/dev/null)" ] || return 0
  (
    runtime_helper_load jht-tools.sh >/dev/null 2>&1 || exit 0
    tools_clean_old_images
  ) >/dev/null 2>&1 || true
}

# No room on the disk for the full image (tools_disk_room in jht-tools.sh): how much free space it asks for (the pull and, after it,
# the agents' threshold) and how much there is now.
tools_disk_low_text() {
  local need free=0 asked
  need="$(tools_pull_need_kib)"
  asked=$((need + DISK_BLOCK_FREE_KIB))
  if ! disk_room_after_download "$need"; then
    free="$DISK_ROOM_FREE_KIB"
    asked=$((free + DISK_ROOM_SHORT_KIB))
  elif [ -n "$DISK_ROOM_FREE_KIB" ]; then
    free="$DISK_ROOM_FREE_KIB"
  fi
  jht_say tools.disk_low "$(disk_gib_up_text "$asked")" "$(disk_gib_text "$free")"
}

# `jht tools status`: one line for the person, the same words `jht up` says (`--json` is for programs). With no tier file the
# tools are here; with one and nothing to say, the engine did not answer.
tools_say_status() {
  case "$(tools_person_state)" in
    arriving) printf '%s\n' "$(jht_say tools.arriving)" ;;
    not_started) printf '%s\n' "$(jht_say tools.not_started)" ;;
    waiting) printf '%s\n' "$(jht_say tools.waiting)" ;;
    failed) printf '%s\n' "$(jht_say tools.failed)" ;;
    disk_low) printf '%s\n' "$(tools_disk_low_text)" ;;
    switch_failed) printf '%s\n' "$(jht_say tools.switch_failed)" ;;
    *) if [ -f "$RUNTIME_TIER_FILE" ]; then printf '%s\n' "$(jht_say tools.engine_down)"; else printf '%s\n' "$(jht_say tools.ready)"; fi ;;
  esac
}

# `jht team chat` whose REPL the switch of the tools ended: the down of the core team stops the container the REPL runs in, and the
# REPL ends with nothing said. The job of the switch writes its pid in .tools-switching while it stops the core team and starts the
# full one; a file whose process is gone is an old one and says nothing.
team_chat_ended_by_switch() {
  local pid
  [ -f "$RUNTIME_DIR/.tools-switching" ] && [ ! -L "$RUNTIME_DIR/.tools-switching" ] || return 1
  pid="$(head -c 20 "$RUNTIME_DIR/.tools-switching" 2>/dev/null | tr -cd '0-9')"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# A command that starts the team (ensure_up) while the switch of the tools is between its down and its up: it waits for the switch
# to end instead of starting a second `compose up` next to the job's (two creates at once lose the keep-id map on Podman <= 6.0.2,
# and an up before the tier goes starts the core image again). A tetto: JHT_TOOLS_SWITCH_WAIT_MAX seconds, 300 by default.
wait_for_tools_switch() {
  local left="${JHT_TOOLS_SWITCH_WAIT_MAX:-300}"
  case "$left" in ''|*[!0-9]*) left=300 ;; esac
  team_chat_ended_by_switch || return 0
  [ "${1:-}" = quiet ] || info "$(jht_say tools.switch_wait)"
  while team_chat_ended_by_switch && [ "$left" -gt 0 ]; do sleep 2; left=$((left - 2)); done
}

# The agent a `jht team chat <agent>` talks to is there again (its tmux session in the container): after the switch the container
# starts the agents the person talks to by itself. <agent> as the CLI takes it: assistente, capitano, scout:1 / scout-1. An agent
# the name does not say is waited for as any session at all. A tetto: JHT_TOOLS_CHAT_RECONNECT_MAX seconds, 180 by default.
team_chat_agent_back() {
  local name left="${JHT_TOOLS_CHAT_RECONNECT_MAX:-180}"
  case "$left" in ''|*[!0-9]*) left=180 ;; esac
  name="$(printf '%s' "${1:-}" | tr '[:lower:]:' '[:upper:]-')"
  case "$name" in ''|*[!A-Z0-9-]*) name="" ;; esac
  while :; do
    if [ -n "$name" ]; then
      docker exec "$ATTESTED_CONTAINER_ID" tmux has-session -t "=$name" >/dev/null 2>&1 && return 0
    else
      docker exec "$ATTESTED_CONTAINER_ID" tmux list-sessions >/dev/null 2>&1 && return 0
    fi
    [ "$left" -gt 0 ] || return 1
    sleep 2
    left=$((left - 2))
  done
}

# `jht team chat` whose REPL the switch ended: it comes back by itself, on the same agent, once the team runs on the full image.
# This wrapper read the runtime before the switch (the core image, the core container) and would refuse the full container as not
# ours: a fresh wrapper reads it as it is now. It is told it resumes a chat (JHT_TEAM_CHAT_RESUME, the round), so it never starts
# or replaces the container: it waits for the agent and attaches (team_chat_resume). At most three switches in a row.
team_chat_through_switch() {
  local round="${JHT_TEAM_CHAT_RESUME:-0}"
  case "$round" in ''|*[!0-9]*) round=0 ;; esac
  if [ "$round" -ge 3 ]; then
    info "$(jht_say tools.chat_switched)"
    return 0
  fi
  info "$(jht_say tools.chat_reconnecting)"
  wait_for_tools_switch quiet
  export JHT_TEAM_CHAT_RESUME=$((round + 1)) JHT_TEAM_CHAT_RESUME_AFTER=switch
  exec bash "$WRAPPER_PATH" "$@"
}

# `jht team chat` whose REPL the container engine ended from under it: an update changes the units of the Podman machine and restarts
# it, and the client of the REPL then says its raw line on stderr («Error: Get "http://d/v6.0.2/libpod/exec/…/json": EOF», «Cannot
# connect to Podman», a connection refused or reset; or, when the container is created again under the REPL, «Error: retrieving exec
# session … no such container»). That line is not for the person: the chat says it is updating and comes back.
# The stderr kept aside by the REPL (see the arm of `team` below) is read, never the REPL's own lines.
team_chat_engine_gone() {
  [ -s "${1:-}" ] || return 1
  grep -Eqi 'libpod/.*(EOF|connection (refused|reset))|Cannot connect to Podman|unable to connect to Podman|error during connect|connection reset by peer|unexpected EOF|retrieving exec session' "$1" 2>/dev/null
}

# The chat the engine ended comes back by itself: wait (JHT_CHAT_UPDATE_WAIT_MAX seconds, 300 by default) for the engine to answer and
# the container to run again, then a fresh wrapper resumes it as after the switch of the tools (it never starts a container: it
# waits for the agent and attaches). Past the wait, or after three rounds, the person is told to open the chat again.
team_chat_through_update() {
  local round="${JHT_TEAM_CHAT_RESUME:-0}" left="${JHT_CHAT_UPDATE_WAIT_MAX:-300}" back=0
  case "$round" in ''|*[!0-9]*) round=0 ;; esac
  case "$left" in ''|*[!0-9]*) left=300 ;; esac
  if [ "$round" -ge 3 ]; then
    info "$(jht_say tools.chat_update_closed)"
    return 0
  fi
  info "$(jht_say tools.chat_updating)"
  while :; do
    if docker_reachable >/dev/null 2>&1 && container_up >/dev/null 2>&1; then back=1; break; fi
    [ "$left" -gt 0 ] || break
    sleep 2
    left=$((left - 2))
  done
  if [ "$back" -ne 1 ]; then
    info "$(jht_say tools.chat_update_closed)"
    return 0
  fi
  export JHT_TEAM_CHAT_RESUME=$((round + 1)) JHT_TEAM_CHAT_RESUME_AFTER=update
  exec bash "$WRAPPER_PATH" "$@"
}

# The fresh wrapper of a chat that the switch ended: the container the switch started must be running and ours, and the agent
# back in it. Nothing is started here: if they are not there, the person is told to open the chat again. The container is
# waited for as the agent is (JHT_TOOLS_CHAT_RECONNECT_MAX): the switch has just started it, and it is not ours yet for a few
# seconds; asked once, the chat said «it comes back by itself» and at once «this chat has closed» (giro Linux build11).
team_chat_container_back() {
  local left="${JHT_TOOLS_CHAT_RECONNECT_MAX:-180}"
  case "$left" in ''|*[!0-9]*) left=180 ;; esac
  until container_up >/dev/null 2>&1; do
    [ "$left" -gt 0 ] || return 1
    sleep 2
    left=$((left - 2))
  done
}

# After an update (a restart of the machine of the engine too) it says the update, not the switch of the tools: it said «the team
# has moved onto the full tools» after a restart (retest Windows build13).
team_chat_resume() {
  if ! team_chat_container_back || ! team_chat_agent_back "${3:-}"; then
    if [ "${JHT_TEAM_CHAT_RESUME_AFTER:-}" = update ]; then info "$(jht_say tools.chat_update_closed)"
    else info "$(jht_say tools.chat_switched)"
    fi
    exit 0
  fi
  if [ "${JHT_TEAM_CHAT_RESUME_AFTER:-}" = update ]; then info "$(jht_say tools.chat_update_resumed)"
  else info "$(jht_say tools.chat_resumed)"
  fi
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
  runtime_helpers_trusted || return 1
  runtime_tier_trusted || return 1
  runtime_extras_pin_trusted || return 1
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

# Il digest del pin degli strumenti su richiesta, solo nella forma canonica scritta da install.sh (`ghcr.io/leopu00/jht@sha256:<64>`).
runtime_extras_pin_value() {
  local value
  [ -f "$RUNTIME_EXTRAS_PIN" ] || return 1
  [ "$(wc -l < "$RUNTIME_EXTRAS_PIN" | tr -d ' ')" = "1" ] || return 1
  value="$(tr -d '\n' < "$RUNTIME_EXTRAS_PIN")"
  printf '%s' "$value" | grep -Eqx 'ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64}' || return 1
  printf '%s\n' "${value#ghcr.io/leopu00/jht@}"
}

# Il pin degli strumenti: file regolare del proprietario, attestato nel suo file di integrita', forma canonica, e solo accanto al pin
# del canale di test (e' li' che l'installer lo scrive). Un'attestazione senza il pin, o un pin senza attestazione: runtime non attendibile.
runtime_extras_pin_trusted() {
  if [ -e "$RUNTIME_EXTRAS_PIN" ] || [ -L "$RUNTIME_EXTRAS_PIN" ]; then
    runtime_node_safe "$RUNTIME_EXTRAS_PIN" file || return 1
    runtime_node_safe "$RUNTIME_EXTRAS_INTEGRITY" file || return 1
    [ "$(sed -n 's/^runtime-extras-image=//p' "$RUNTIME_EXTRAS_INTEGRITY" | head -n 1)" = "$(runtime_sha256 "$RUNTIME_EXTRAS_PIN")" ] || return 1
    runtime_extras_pin_value >/dev/null || return 1
    [ -f "$RUNTIME_IMAGE_PIN" ] || return 1
  elif [ -e "$RUNTIME_EXTRAS_INTEGRITY" ] || [ -L "$RUNTIME_EXTRAS_INTEGRITY" ]; then
    return 1
  fi
}

# Il digest degli strumenti che questo runtime usa: quello del pin attestato se c'e' (vince sulla costante della release, come il pin
# dell'immagine vince su quella del compose), altrimenti la costante, vuota finche' la release non ha l'immagine degli strumenti.
runtime_extras_digest() {
  runtime_extras_pin_trusted || return 1
  if [ -e "$RUNTIME_EXTRAS_PIN" ]; then runtime_extras_pin_value; else printf '%s\n' "$EXTRAS_IMAGE_DIGEST"; fi
}

# Il livello dell'immagine (P4): il file `runtime-tier` (solo `core`) lo scrive l'installer quando la release ha un nucleo; senza
# file e' l'immagine intera di sempre. Un file con un contenuto diverso, non attestato, o un nucleo che questo wrapper non conosce
# non si interpretano: runtime non attendibile. L'attestazione sta in un file suo, `.runtime-tier-integrity`, non nel manifest principale
# (l'app confronta l'insieme esatto delle sue chiavi). Un'attestazione senza il file di livello e' un `switch` interrotto a meta': il
# runtime e' quello intero.
runtime_tier_trusted() {
  if [ -e "$RUNTIME_TIER_FILE" ] || [ -L "$RUNTIME_TIER_FILE" ]; then
    runtime_node_safe "$RUNTIME_TIER_FILE" file || return 1
    # attested in a file of its own: the main manifest is the one whose exact set of keys the desktop app compares
    runtime_node_safe "$RUNTIME_TIER_INTEGRITY" file || return 1
    [ "$(sed -n 's/^runtime-tier=//p' "$RUNTIME_TIER_INTEGRITY" | head -n 1)" = "$(runtime_sha256 "$RUNTIME_TIER_FILE")" ] || return 1
    [ "$(tr -d '\r\n' < "$RUNTIME_TIER_FILE")" = "core" ] && [ -n "$CORE_IMAGE_DIGEST" ] || return 1
    [ ! -e "$RUNTIME_IMAGE_PIN" ] || return 1
  fi
}

# L'immagine che il runtime ha scelto: il pin del canale di test, oppure il nucleo se l'installazione e' a livello `core`.
# Vuota = il default del compose (l'immagine intera).
runtime_selected_image() {
  if [ -f "$RUNTIME_IMAGE_PIN" ]; then runtime_image_pin_value
  elif [ -f "$RUNTIME_TIER_FILE" ]; then printf 'ghcr.io/leopu00/jht@%s\n' "$CORE_IMAGE_DIGEST"
  fi
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
      err "$(jht_say line.runtime_host_protetto_non_installabile)"
      return 1
    }
  fi
  runtime_bundle_trusted || {
    # A manifest that is not there at all is an install that never finished, not a file somebody changed: said as what it is.
    if [ ! -e "$RUNTIME_MANIFEST" ] && [ ! -L "$RUNTIME_MANIFEST" ]; then
      err "$(jht_say line.job_hunter_team_non_installato)"
    else
      err "$(jht_say line.runtime_host_non_attendibile_path)"
    fi
    return 1
  }
  # Il pin del canale di test vince su un JHT_IMAGE dell'ambiente: il canale
  # e' deciso all'installazione, non da chi lancia il comando.
  if [ -f "$RUNTIME_IMAGE_PIN" ] || [ -f "$RUNTIME_TIER_FILE" ]; then
    JHT_IMAGE="$(runtime_selected_image)" || return 1
    export JHT_IMAGE
  fi
}

# ── Verifiche pre-flight ──────────────────────────────────────────────────
# Con Docker (non con Podman) il team si governa con `docker compose`: se il motore risponde ma il comando non c'e' (Colima con il
# solo client docker di Homebrew, un Docker Engine senza il plugin), ogni lettura di Compose fallisce e il resto del wrapper lo
# racconterebbe come «container non attestabile». Lo si riconosce dalle parole del client, non dal solo codice di uscita: un Compose che
# c'e' e fallisce per altro non e' «manca». Vero = manca.
docker_compose_plugin_missing() {
  local out
  [ -z "${PODMAN_RUNTIME_MODE:-}" ] && [ "${CONTAINER_RUNTIME:-docker}" != podman ] || return 1
  out="$(docker compose version 2>&1)" && return 1
  case "$out" in
    *"unknown command"*|*"is not a docker command"*|*"unknown shorthand"*) return 0 ;;
  esac
  return 1
}

# «Non attestabile» e' la risposta a un motore che non si riesce a interrogare; con Docker senza il plugin Compose il motore risponde e
# a mancare e' `docker compose`: lo si dice con le sue parole (e il comando che lo mette), non come un container da non toccare.
err_unattestable() {
  if docker_compose_plugin_missing; then err "$(jht_say compose.missing)"; else err "$1"; fi
}

require_docker() {
  if [ -n "${err_runtime:-}" ]; then
    err "$err_runtime"
    exit 1
  fi
  if ! command -v docker >/dev/null 2>&1; then
    err "$(jht_say line.client_container_non_trovato_nel)"
    exit 127
  fi
  require_confined_podman_machine
  require_rootless_podman_native
  if ! docker info >/dev/null 2>&1; then
    if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
      err "$(jht_say line.podman_machine_jht_non_attiva)"
    elif [ "$PODMAN_RUNTIME_MODE" = "native" ]; then
      err "podman_rootless_unavailable: $(jht_say line.podman_rootless_unavailable.il_runtime_podman_rootless_non)"
    else
      # Un'installazione di prima della 0.4, su Docker: niente si accende da qui, si dice come passare a Podman.
      err "$(jht_say up.docker_legacy)"
    fi
    exit 1
  fi
  if docker_compose_plugin_missing; then
    err "$(jht_say compose.missing)"
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

# The Podman machine (vfkit and gvproxy, started by `podman machine start`/`init --now`) must not live and die with the terminal
# the person ran this from: closing that window sends SIGHUP to what it started, and the machine with the team stopped. The
# command runs in a session of its own, with no terminal and SIGHUP ignored (perl's setsid on macOS, which has no setsid
# command; setsid -w where there is one; nohup otherwise). `podman machine stop` (jht down) still stops it as before.
jht_detached_from_terminal() {
  if command -v perl >/dev/null 2>&1; then
    perl -MPOSIX -e '$SIG{HUP} = "IGNORE"; POSIX::setsid(); exec { $ARGV[0] } @ARGV or exit 127' "$@" </dev/null
  elif command -v setsid >/dev/null 2>&1; then
    setsid -w "$@" </dev/null
  else
    nohup "$@" </dev/null
  fi
}

start_jht_podman_machine() {
  local podman_bin="$1" start_error start_status running
  start_error="$(jht_detached_from_terminal "$podman_bin" machine start --update-connection=false "$PODMAN_MACHINE_NAME" 2>&1 >/dev/null)" \
    && start_status=0 || start_status=$?
  [ "$start_status" -eq 0 ] && return 0
  if printf '%s\n' "$start_error" | grep -Fqi 'only one VM can be active at a time'; then
    running="$(running_podman_machine "$podman_bin")"
    if [ -n "$running" ]; then
      # the marker is for the desktop app (machine output); a person at a terminal reads only the line below
      if jht_machine_output; then printf 'JHT_OTHER_MACHINE %s\n' "$running"; fi
      err "$(jht_code_prefix podman_other_machine_running)$(jht_say line.podman_other_machine_running.named "$running" "$running")"
    else
      err "$(jht_code_prefix podman_other_machine_running)$(jht_say line.podman_other_machine_running.unnamed)"
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
    err "$(jht_say line.client_container_non_trovato_nel_2)"
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
    [ -n "$podman_bin" ] || { err "$(jht_say line.podman_non_trovato_reinstalla_il)"; exit 127; }
    ensure_podman_mount_dirs \
      || { err "$(jht_say line.non_riesco_a_creare_jht)"; exit 1; }
    info "$(jht_say line.podman_machine_s_non_attiva "$PODMAN_MACHINE_NAME")"
    if start_jht_podman_machine "$podman_bin"; then
      :
    else
      local start_status=$?
      [ "$start_status" -eq 79 ] && exit 79
      err "$(jht_say line.podman_machine_non_avviabile)"
      exit 1
    fi
  elif [ "$PODMAN_RUNTIME_MODE" = "native" ]; then
    err "podman_rootless_unavailable: $(jht_say line.podman_rootless_unavailable.il_runtime_podman_rootless_non_2)"
    exit 1
  else
    # Un'installazione di prima della 0.4, su Docker (Colima, Docker Desktop, Docker Engine): `jht up` non accende piu' quel
    # motore. Dice cosa resta e come passare a Podman.
    err "$(jht_say up.docker_legacy)"
    exit 1
  fi
  docker info >/dev/null 2>&1 \
    || { err "$(jht_say line.podman_machine_avviata_ma_il)"; exit 1; }
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
      err "$(jht_say line.la_macchina_podman_s_vede "$PODMAN_MACHINE_NAME")"
      err "$(jht_say line.ricreala_con_jht_podman_machine)"
      exit "$PODMAN_MOUNTS_EXIT"
      ;;
    *)
      err "$(jht_say line.non_riesco_a_verificare_quali "$PODMAN_MACHINE_NAME")"
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
    err "podman_remote_service_refused: $(jht_say line.podman_remote_service_refused.su_linux_jht_usa_solo)"
    err "$(jht_say line.togli_remote_true_da_containers)"
    exit 1
  fi
  err "podman_rootful_refused: $(jht_say line.podman_rootful_refused.jht_su_linux_richiede_podman)"
  err "$(jht_say line.accedi_con_l_utente_jht)"
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

# On the Mac the machine runs Podman of the 6.1 series from 6.1.3 (Homebrew moves the patch: 6.1.4 on 13/11), never 6.2 or later,
# with podman-compose 1.6.0 exactly: the pair the labels and the attestation were measured with. Linux keeps its minimums.
PODMAN_MAC_SERIES="6.1"
PODMAN_MAC_MIN_PATCH=3
PODMAN_COMPOSE_MAC_VERSION="1.6.0"
podman_mac_version_supported() {
  local version="$1" major minor patch rest
  case "$version" in ''|*[!0-9.]*) return 1 ;; esac
  IFS=. read -r major minor patch rest <<EOF
$version
EOF
  [ -z "$rest" ] && [ -n "$patch" ] || return 1
  [ "$major.$minor" = "$PODMAN_MAC_SERIES" ] && [ "$((10#$patch))" -ge "$PODMAN_MAC_MIN_PATCH" ]
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
  podman_version="$(podman_version_number "$podman_bin")" || return 1
  podman_mac_version_supported "$podman_version" || return 1
  compose_version="$(CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME" \
    "$compose_bin" --version 2>/dev/null)" || return 1
  printf '%s\n' "$compose_version" | grep -Fqx "podman-compose version $PODMAN_COMPOSE_MAC_VERSION"
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
    || { err "$(jht_say line.identita_progetto_compose_non_valida)"; return 1; }
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
    podman_bin="$(podman_binary)" || { err "$(jht_say line.podman_non_trovato_reinstalla_il_2)"; return 127; }
    if ! compose_bin="$(podman_compose_binary)"; then
      if [ "$PODMAN_RUNTIME_MODE" = "native" ]; then
        # `podman compose` non basta: delega al primo provider che trova (docker-compose,
        # prima di podman-compose), e il wrapper si fida solo delle label di podman-compose.
        err "$(jht_say line.podman_compose_non_trovato_installa)"
      else
        err "$(jht_say line.provider_podman_compose_non_trovato)"
      fi
      return 127
    fi
    if ! podman_compose_pair_supported "$podman_bin" "$compose_bin"; then
      if [ "$PODMAN_RUNTIME_MODE" = "native" ]; then
        err "$(jht_say line.versione_non_supportata_servono_podman "$PODMAN_NATIVE_MIN_VERSION" "$(podman_version_number "$podman_bin" || echo '?')" "$PODMAN_COMPOSE_NATIVE_MIN_VERSION" "$(podman_compose_version_number "$compose_bin" || echo '?')")"
      else
        err "$(jht_say line.versione_non_supportata_sul_mac "$PODMAN_MAC_SERIES" "$PODMAN_MAC_MIN_PATCH" "$PODMAN_MAC_SERIES" "$(podman_version_number "$podman_bin" || echo '?')" "$PODMAN_COMPOSE_MAC_VERSION" "$(podman_compose_version_number "$compose_bin" || echo '?')" "$PODMAN_MAC_SERIES")"
      fi
      return 1
    fi
    if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
      "$podman_bin" --connection "$PODMAN_MACHINE_NAME" info >/dev/null 2>&1 \
        || { err "$(jht_say line.la_connessione_podman_jht_non)"; return 1; }
      (
        cd "$RUNTIME_DIR" || return 1
        CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME" \
        PODMAN_COMPOSE_WARNING_LOGS=false \
          "$compose_bin" --podman-path "$podman_bin" -p "$project" -f "$file" "$@"
      )
      return $?
    else
      podman_native_rootless \
        || { err "$(jht_say line.il_runtime_podman_rootless_locale)"; return 1; }
      local override no_pod status=0
      override="$(podman_native_override_ensure "$file")" \
        || { err "$(jht_say line.override_compose_per_podman_rootless "$RUNTIME_DIR")"; return 1; }
      no_pod="$(podman_native_no_pod_arg "$compose_bin")" \
        || { err "$(jht_say line.versione_di_podman_compose_non)"; return 1; }
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
          err "compose_up_timeout: $(jht_say line.compose_up_timeout.podman_compose_up_non_ha "${PODMAN_NATIVE_UP_TIMEOUT}")"
          return 124
        fi
        err "compose_up_failed: $(jht_say line.compose_up_failed.podman_compose_up_e_uscito "$status")"
      fi
      return $status
    fi
  fi
  # Il project Docker/VPS storico deriva da --project-directory. Non migrarlo
  # implicitamente al literal Podman: un secondo project colliderebbe sul
  # container_name jht senza poter adottare il runtime esistente.
  # One more file, and only this one: the overlay that gives jht-login its seccomp profile on Docker (jht-integration.sh makes it). Whatever
  # else is in COMPOSE_EXTRA_FILE is not a compose file of ours, and nothing is started.
  case "${COMPOSE_EXTRA_FILE:-}" in
    '') MSYS_NO_PATHCONV=1 docker compose -f "$file" --project-directory "$RUNTIME_DIR" "$@" ;;
    "$RUNTIME_DIR/docker-compose.login-seccomp.yml")
      [ -f "$COMPOSE_EXTRA_FILE" ] && [ ! -L "$COMPOSE_EXTRA_FILE" ] || { err "$(jht_say line.l_overlay_seccomp_dell_accesso)"; return 1; }
      MSYS_NO_PATHCONV=1 docker compose -f "$file" -f "$COMPOSE_EXTRA_FILE" --project-directory "$RUNTIME_DIR" "$@" ;;
    *) err "$(jht_say line.compose_extra_file_non_e)"; return 1 ;;
  esac
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
# Any container of the project that runs (the broker, Telegram): `COMPOSE_PROFILES=telegram compose down` would stop it too.
# A list that cannot be read counts as running.
project_has_running_container() {
  local ids id
  ids="$(COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" compose ps -q 2>/dev/null)" || return 0
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
  # as expected, only the hash differs) and are recreated with the new configuration; `COMPOSE_PROFILES=telegram compose down`
  # removes containers and the network, never the volumes: the team's data stays.
  if [ "$status" -eq 1 ] && [ "$CONTAINER_RUNTIME" = podman ] \
      && read_only_service_id "$CONTAINER_SERVICE" stopped-stale-config >/dev/null 2>&1 \
      && ! project_has_running_container; then
    warn "$(jht_say_sentence config.changed_stopped)"
    # compose_quiet, as on `jht down`: podman-compose's own lines («Error: no container with name or ID "jht-broker" found» for every
    # service never created, the bare names, the id, jht_default) stay out of sight; any other line is shown
    COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" compose_quiet down || { err "$(jht_say line.non_riesco_a_rimuovere_i)"; return 1; }
    return 0
  fi
  err_unattestable "$(jht_say line.unattestable.existing)"
  stale_config_hint
  return 1
}

# Il team gira con la configurazione di prima di una reinstallazione: si puo'
# solo fermare (jht down) e riavviare con quella nuova (jht up).
stale_config_hint() {
  [ "$CONTAINER_RUNTIME" = podman ] || return 0
  read_only_service_id "$CONTAINER_SERVICE" any-config >/dev/null 2>&1 || return 0
  err "$(jht_say_sentence config.changed_start)"
}

# The tools' containers (the live screen, media, the sign-in) go first, each by the id the attestation gives (running or stopped, ours
# by every label, any configuration): with the screen running, podman-compose's `down` could not remove what it stood on («cannot
# remove container … as it is running», «jht_default has associated containers»), and the team's container, left half stopped,
# came back up a few seconds later (Mac with Podman, 3 times out of 3). Then the team's own services, the same way (telegram, the
# team, the broker last): the same raw lines came once without the screen, on a down ~35 s after the first up, and a container
# stopped by `stop` is one its restart policy (unless-stopped) never brings back. compose down then only removes what is stopped.
# Nothing of another project, nothing unattested, never an error.
container_down_tools_first() {
  local svc id names
  # one listing first (the container names are the service names): a tool that is not there costs no attestation
  names="$(docker ps -a --format '{{.Names}}' 2>/dev/null)" || return 0
  for svc in "$SCREEN_SERVICE" "$MEDIA_SERVICE" "$LOGIN_VIEW_SERVICE" "$LOGIN_PROXY_SERVICE" "$LOGIN_SERVICE" "$PLAYWRIGHT_POPULATE_SERVICE" \
             "$TELEGRAM_SERVICE" "$CONTAINER_SERVICE" "$BROKER_SERVICE"; do
    printf '%s\n' "$names" | grep -Fqx "$svc" || continue
    id="$(read_only_service_id "$svc" any-config 2>/dev/null)" || continue
    case "$id" in ''|*[!0-9a-fA-F]*) continue ;; esac
    docker stop -t 10 "$id" >/dev/null 2>&1 || true
    case "$svc" in "$TELEGRAM_SERVICE"|"$CONTAINER_SERVICE"|"$BROKER_SERVICE") continue ;; esac   # the team's: compose down removes them
    docker rm -f "$id" >/dev/null 2>&1 || true
  done
}

# `jht down`: il container attestato, oppure quello avviato prima di una
# reinstallazione (stesso progetto, solo la config-hash e' cambiata): fermarlo
# e' l'unica strada per ripartire con la configurazione nuova.
container_down() {
  local up_status=0
  container_up >/dev/null || up_status=$?
  if [ "$up_status" -ne 0 ]; then
    if [ "$CONTAINER_RUNTIME" = podman ] && read_only_service_id "$CONTAINER_SERVICE" any-config >/dev/null; then
      warn "$(jht_say_sentence config.changed_down)"
    elif [ "$up_status" -eq 3 ]; then
      # No `jht` container. That is nothing to stop only when the WHOLE project is empty: status 3 also means that only the
      # agent service is missing, while the broker (the mail password) or Telegram still run, and a `jht down && rm -rf <runtime>`
      # would delete the compose that was needed to stop them. So the whole project is asked: a failed answer is a refusal, an
      # empty one is «niente da fermare» (and the chain of the uninstall goes on, TEST 19i A1), a non-empty one goes on to `COMPOSE_PROFILES=telegram compose down`
      # only once the services left are attested like the agent's: `COMPOSE_PROFILES=telegram compose down` stops every container of the project, so one that
      # does not attest (or one of a service the compose does not have) is said and nothing is touched.
      local rest svc svc_status leftover=0 refused=""
      if ! rest="$(COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" compose ps -q 2>/dev/null)"; then
        err_unattestable "$(jht_say line.unattestable.stop)"
        return 1
      fi
      if [ -z "$rest" ]; then
        info "$(jht_say line.niente_da_fermare_nessun_container)"
        return 0
      fi
      for svc in "$BROKER_SERVICE" "$TELEGRAM_SERVICE" "$MEDIA_SERVICE" "$PLAYWRIGHT_POPULATE_SERVICE" "$SCREEN_SERVICE" "$LOGIN_SERVICE" "$LOGIN_PROXY_SERVICE" "$LOGIN_VIEW_SERVICE"; do
        svc_status=0
        read_only_service_id "$svc" any-config >/dev/null || svc_status=$?
        case "$svc_status" in
          0) leftover=1 ;;
          3) ;;
          *) refused="${refused:+$refused, }$svc" ;;
        esac
      done
      if [ -n "$refused" ]; then
        err "$(jht_say line.il_servizio_s_del_progetto "$refused")"
        return 1
      fi
      if [ "$leftover" -eq 0 ]; then
        err "$(jht_say line.il_progetto_ha_container_che)"
        return 1
      fi
      info "$(jht_say line.il_container_s_non_c "$CONTAINER_SERVICE")"
    else
      err_unattestable "$(jht_say line.unattestable.stop)"
      return 1
    fi
  fi
  container_down_tools_first
  local status=0 errors
  errors="$(mktemp "${TMPDIR:-/tmp}/jht-down.XXXXXX")" || { COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" compose down; return $?; }
  COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" compose_stdout_quiet down 2>"$errors" || status=$?
  local shown left
  shown="$(compose_noise_filter <"$errors" | rootless_netns_noise_filter)"
  # With Docker or Colima compose writes its progress (Container jht Stopping, Stopped, Removing...) on stderr: it is shown only if
  # the stop failed or with --verbose; a stop that went well says «Job Hunter Team stopped.» and nothing else.
  if [ "$CONTAINER_RUNTIME" != podman ] && [ "$status" -eq 0 ] && [ "${JHT_COMPOSE_VERBOSE:-0}" != 1 ]; then shown=""; fi
  [ -z "$shown" ] || printf '%s\n' "$shown" >&2
  rm -f "$errors"
  # Podman exits non-zero with only that error even though the containers are gone:
  # what «fermo» says is then what exit says, once the project has no container left.
  if [ "$status" -ne 0 ] && [ "$(printf '%s\n' "$shown" | wc -l)" -eq 1 ]; then
    case "$shown" in
      "nota: il processo di rete del team era gia' chiuso"*)
        # podman-compose lists every container of the project (broker and telegram too):
        # an empty answer, and not a failed one, is «nothing left».
        left="$(COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" compose ps -q 2>/dev/null)" && [ -z "$left" ] && { printf '%s\n' "$(jht_say down.done)"; return 0; }
        ;;
    esac
  fi
  # A container that restarted by itself during the stop (restart: unless-stopped, in the team's first minute: measured once in
  # three on a Mac with Podman, «cannot remove container … is running» and the team up again after «stopped»): one more pass,
  # and a project that still has a container is said, never called stopped.
  if [ "$status" -eq 0 ]; then
    left="$(COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" compose ps -q 2>/dev/null)" || left=""
    if [ -n "$left" ]; then
      COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" compose_stdout_quiet down >/dev/null 2>&1 || true
      left="$(COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" compose ps -q 2>/dev/null)" || left=""
      [ -z "$left" ] || { err "$(jht_say down.still_running)"; return 1; }
    fi
  fi
  [ "$status" -ne 0 ] || printf '%s\n' "$(jht_say down.done)"
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

# podman-compose scrive su `up -d` e su `down` gli id grezzi dei container, il nome della rete del progetto e, per i servizi che non sono
# mai stati creati (Telegram, il servizio dei media, il broker: dipende da cosa e' acceso), «Error: no container with name or ID
# "jht-telegram" found»: non e' un errore, e' un servizio che non c'e' (il servizio principale, jht, non e' fra questi: se manca, la riga
# resta). Sono i servizi di nome jht-<qualcosa>, cosi' uno nuovo non rimette quelle righe in vista. Via quelle righe (e solo quelle, a
# riga intera): ogni altra riga passa com'e', stderr compreso.
compose_noise_filter() {
  # Podman 6 also says it the other way round, with single quotes: «Error: no container with ID or name 'jht-media' found: no such
  # container», one line per absent service of the project on every `jht down` (8 to 11 lines before «stopped»).
  # `podman stop` and `podman rm` print the name of each container they stopped or removed («jht», «jht-broker»): the result is the
  # line «stopped» / «started».
  grep -v -E "^[0-9a-f]{12,64}\$|^jht(-[a-z0-9][a-z0-9-]*)?\$|^(jht|host-runtime)_default\$|^Error: no container with (name or ID|ID or name) [\"']jht-[a-z][a-z0-9-]*[\"'] found(: no such container)?\$" || true
}

# `--verbose` on `jht up`, `jht down`, `jht restart`, `jht recreate`... (or JHT_VERBOSE=1) shows what compose says, line by line, as it
# comes. Without it the person reads the phase and the result: compose's own lines (Network, Volume, Container Creating, Created,
# Started...) are kept out of sight when all went well, and shown, whole, when it did not.
jht_compose_verbose_requested() {
  JHT_COMPOSE_VERBOSE=0
  [ "${JHT_VERBOSE:-0}" != 1 ] || JHT_COMPOSE_VERBOSE=1
  local arg
  for arg in "$@"; do
    [ "$arg" != --verbose ] || JHT_COMPOSE_VERBOSE=1
  done
  return 0
}

# `compose <argomenti>` come prima, ma l'output passa per compose_noise_filter (stdout su stdout, stderr su stderr) con Podman; con
# Docker o Colima, a comando riuscito, non si stampa niente (le righe di avanzamento di compose) e, a comando fallito, tutto cio' che
# compose ha detto. Con --verbose compose parla come viene. Il codice di uscita e' quello di compose.
compose_quiet() {
  local out err rc=0
  if [ "${JHT_COMPOSE_VERBOSE:-0}" = 1 ]; then compose "$@"; return $?; fi
  out="$(mktemp "${TMPDIR:-/tmp}/jht-compose-out.XXXXXX")" || { compose "$@"; return $?; }
  err="$(mktemp "${TMPDIR:-/tmp}/jht-compose-err.XXXXXX")" || { rm -f "$out"; compose "$@"; return $?; }
  # Interrotto (Ctrl-C, chiusura del terminale): i due file temporanei non restano in $TMPDIR.
  COMPOSE_QUIET_OUT="$out"; COMPOSE_QUIET_ERR="$err"
  trap 'rm -f -- "$COMPOSE_QUIET_OUT" "$COMPOSE_QUIET_ERR"; exit 130' HUP INT TERM
  compose "$@" >"$out" 2>"$err" || rc=$?
  trap - HUP INT TERM
  if [ "$CONTAINER_RUNTIME" = podman ]; then
    compose_noise_filter <"$out"
    compose_noise_filter <"$err" >&2
  elif [ "$rc" -ne 0 ]; then
    cat "$out"
    cat "$err" >&2
  fi
  rm -f -- "$out" "$err"
  return "$rc"
}

# Come compose_quiet, ma solo per stdout: lo stderr resta a chi chiama (container_down lo raccoglie in un file e lo filtra da se').
compose_stdout_quiet() {
  local out rc=0
  if [ "${JHT_COMPOSE_VERBOSE:-0}" = 1 ]; then compose "$@"; return $?; fi
  out="$(mktemp "${TMPDIR:-/tmp}/jht-compose-out.XXXXXX")" || { compose "$@"; return $?; }
  compose "$@" >"$out" || rc=$?
  if [ "$CONTAINER_RUNTIME" = podman ]; then
    compose_noise_filter <"$out"
  elif [ "$rc" -ne 0 ]; then
    cat "$out"
  fi
  rm -f "$out"
  return "$rc"
}

container_postcheck_running() {
  read_only_container_id >/dev/null || {
    err "$(jht_say line.container_jht_non_verificabile_dopo)"
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
      err "broker_unavailable: $(jht_say line.broker_unavailable.il_compose_del_runtime_installato)"
      err "$(jht_say line.cosa_fare_reinstalla_il_runtime)"
      return 1
    fi
    if compose_lacks_service "$BROKER_SERVICE"; then
      err "broker_unavailable: $(jht_say line.broker_unavailable.il_runtime_installato_pi_vecchio)"
      err "$(jht_say line.cosa_fare_jht_upgrade)"
      return 1
    fi
    if [ -e "$BROKER_WANTED_MARKER" ]; then
      err "broker_unavailable: $(jht_say line.broker_unavailable.il_broker_dei_segreti_non)"
      err "$(jht_say line.cosa_fare_jht_up)"
    else
      err "broker_unavailable: $(jht_say line.broker_unavailable.il_servizio_della_posta_non)"
      err "$(jht_say line.cosa_fare_jht_mail_setup)"
    fi
    return 1
  }
  docker exec -i "$broker_id" jht-broker-admin "$@"
}

# The broker (the mail password, the notary of the authorisations to apply) is made at the first thing that needs it (`jht mail setup`,
# the first record of an authorisation, the link of the site, Telegram) and by nothing else: `jht up` leaves it out unless a marker
# says it was made before. `jht` has mounted the empty socket volume since it was made, so making the broker never recreates the team.
BROKER_WANTED_MARKER="$RUNTIME_DIR/.broker-made"
ensure_broker() {
  local status=0 broker_id i
  read_only_service_id "$BROKER_SERVICE" >/dev/null 2>&1 || status=$?
  [ "$status" -ne 0 ] || return 0
  if compose_unreadable; then
    err "broker_unavailable: $(jht_say line.broker_unavailable.il_compose_del_runtime_installato_2)"
    err "$(jht_say line.cosa_fare_reinstalla_il_runtime_2)"
    return 1
  fi
  if compose_lacks_service "$BROKER_SERVICE"; then
    err "broker_unavailable: $(jht_say line.broker_unavailable.il_runtime_installato_pi_vecchio_2)"
    err "$(jht_say line.cosa_fare_jht_upgrade_2)"
    return 1
  fi
  [ "$status" -eq 3 ] || { err "broker_unavailable: $(jht_say line.broker_unavailable.il_broker_dei_segreti_esiste)"; return 1; }
  info "$(jht_say line.preparo_il_servizio_della_posta)"
  COMPOSE_PROFILES=broker compose up -d --no-deps "$BROKER_SERVICE" >/dev/null \
    || { err "broker_start_failed: $(jht_say line.broker_start_failed.il_servizio_della_posta_non_2)"; err "$(jht_say line.cosa_fare_riprova_il_comando)"; return 1; }
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
    broker_id="$(read_only_service_id "$BROKER_SERVICE" 2>/dev/null)" \
      && docker exec "$broker_id" jht-broker-admin secrets status >/dev/null 2>&1 && break
    broker_id=""
    sleep 1
  done
  [ -n "$broker_id" ] || { err "broker_start_failed: $(jht_say line.broker_start_failed.il_servizio_della_posta_non_3)"; err "$(jht_say line.cosa_fare_riprova_il_comando_2)"; return 1; }
  : > "$BROKER_WANTED_MARKER" 2>/dev/null || true
  broker_migrate_legacy_once
  broker_configure_web_authorisations
}

# After `up`: a broker made before comes back with the team (`down` removes its container); one that an older install made is adopted.
broker_after_up() {
  if [ ! -e "$BROKER_WANTED_MARKER" ]; then
    read_only_service_id "$BROKER_SERVICE" any-config >/dev/null 2>&1 || return 0
    : > "$BROKER_WANTED_MARKER" 2>/dev/null || true
  fi
  ensure_broker || warn "broker_restart_failed: $(jht_say line.broker_restart_failed.il_servizio_della_posta_non_4)"
  broker_migrate_legacy_once
  broker_configure_web_authorisations
}

# Telegram isolato: il token nuovo va dallo stdin dell'host direttamente al
# container uid 1003. Il container agenti vede soltanto gli hash dei token
# legacy necessari a imporre la rotazione, mai il token nuovo.
TELEGRAM_SERVICE="jht-telegram"
MEDIA_SERVICE="jht-media"
PLAYWRIGHT_POPULATE_SERVICE="jht-playwright-populate"
SCREEN_SERVICE="jht-screen"
LOGIN_SERVICE="jht-login"
LOGIN_PROXY_SERVICE="jht-login-proxy"
LOGIN_VIEW_SERVICE="jht-login-view"

telegram_admin() {
  local telegram_id
  telegram_id="$(read_only_service_id "$TELEGRAM_SERVICE")" || {
    if compose_unreadable; then
      err "telegram_unavailable: $(jht_say line.telegram_unavailable.il_compose_del_runtime_installato_3)"
      err "$(jht_say line.cosa_fare_reinstalla_il_runtime_3)"
      return 1
    fi
    if compose_lacks_service "$TELEGRAM_SERVICE"; then
      err "telegram_unavailable: $(jht_say line.telegram_unavailable.il_runtime_installato_pi_vecchio_3)"
      err "$(jht_say line.cosa_fare_jht_upgrade_3)"
      return 1
    fi
    err "telegram_unavailable: $(jht_say line.telegram_unavailable.il_servizio_telegram_isolato_non)"
    err "$(jht_say line.cosa_fare_jht_up_2)"
    return 1
  }
  docker exec "$telegram_id" jht-telegram-admin "$@"
}

telegram_admin_input() {
  local telegram_id
  telegram_id="$(read_only_service_id "$TELEGRAM_SERVICE")" || {
    if compose_unreadable; then
      err "telegram_unavailable: $(jht_say line.telegram_unavailable.il_compose_del_runtime_installato_4)"
      err "$(jht_say line.cosa_fare_reinstalla_il_runtime_4)"
      return 1
    fi
    if compose_lacks_service "$TELEGRAM_SERVICE"; then
      err "telegram_unavailable: $(jht_say line.telegram_unavailable.il_runtime_installato_pi_vecchio_4)"
      err "$(jht_say line.cosa_fare_jht_upgrade_4)"
      return 1
    fi
    err "telegram_unavailable: $(jht_say line.telegram_unavailable.il_servizio_telegram_isolato_non_2)"
    err "$(jht_say line.cosa_fare_jht_up_3)"
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
  COMPOSE_PROFILES=telegram compose up -d "$TELEGRAM_SERVICE" >/dev/null || return 1
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
      err "legacy_inventory_failed: $(jht_say line.legacy_inventory_failed.non_riesco_a_fermare_gli)"
      return 1
    }
    TELEGRAM_PAIR_AGENTS_STOPPED=1
  else
    agent_status=$?
    if [ "$agent_status" -ne 3 ]; then
      err "legacy_inventory_failed: $(jht_say line.legacy_inventory_failed.lo_stato_del_container_agenti)"
      return 1
    fi
  fi
}

telegram_pair_start_agents() {
  [ "$TELEGRAM_PAIR_AGENTS_STOPPED" -eq 1 ] || return 0
  compose start "$CONTAINER_SERVICE" >/dev/null || {
    err "agent_restart_failed: $(jht_say line.agent_restart_failed.inventario_conservato_ma_il_team)"
    return 1
  }
}

# Inventario host di un ruolo, conservato dal servizio isolato. Stampa le
# impronte legacy (una per riga) per il successivo `bots pair`.
telegram_pair_inventory() {
  local role="$1" digests digest
  digests="$(telegram_legacy inventory "$role")" || {
    err "legacy_inventory_failed: $(jht_say line.legacy_inventory_failed.migrazione_telegram_interrotta)"
    return 1
  }
  if [ -n "$digests" ]; then
    while IFS= read -r digest; do
      printf '%s' "$digest" | grep -Eq '^[0-9a-f]{64}$' || {
        err "legacy_inventory_invalid: $(jht_say line.legacy_inventory_invalid.migrazione_telegram_interrotta_2)"
        return 1
      }
    done <<< "$digests"
  fi
  if ! printf '%s' "$digests" | telegram_admin_input legacy remember "$role" >/dev/null; then
    err "legacy_inventory_failed: $(jht_say line.legacy_inventory_failed.le_impronte_non_sono_state)"
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
      err "input_interrotto: $(jht_say line.input_interrotto.token_non_letto)"
      return 1
    fi
    if [[ ! "$token" =~ ^[0-9]{5,12}:[A-Za-z0-9_-]{20,}$ ]]; then
      unset token
      err "bot_token_invalid: $(jht_say line.bot_token_invalid.controlla_il_token_generato_da)"
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
    err "$(jht_say line.abbinamento_rifiutato_genera_un_token)"
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
    COMPOSE_PROFILES=telegram compose restart "$TELEGRAM_SERVICE" >/dev/null || return 1
    if [ "$first_cutover" -eq 1 ] && [ "$TELEGRAM_PAIR_AGENTS_STOPPED" -eq 1 ]; then
      # Il riavvio spegne anche eventuali tg-bridge che conservavano il token
      # vecchio in memoria. Al boot pid1 vede il marker read-only.
      compose restart "$CONTAINER_SERVICE" >/dev/null || return 1
    fi
    info "$(jht_say line.telegram_isolato_attivo_il_bridge)"
  else
    remaining_rc=$?
    if [ "$remaining_rc" -eq 1 ]; then
      warn "$(jht_say line.bot_abbinato_e_copia_legacy)"
    else
      err "legacy_inventory_failed: $(jht_say line.legacy_inventory_failed.non_posso_provare_che_jht)"
      return 1
    fi
  fi
}

telegram_pair_usage() {
  err "$(jht_say line.uso_jht_telegram_pair_assistente)"
  err "$(jht_say line.interattivo_il_token_viene_chiesto)"
}

TELEGRAM_NEW_TOKEN_NOTE="Usa sempre un token appena generato in BotFather (/revoke sul bot, oppure un bot nuovo): un token già esistente può essere stato letto dagli agenti anche se oggi non compare in ~/.jht."

telegram_pair() {
  local role="${1:-}" digests="" was_enabled="" others="" answer=""
  [ "$role" != "--all" ] || { telegram_pair_all; return $?; }
  case "$role" in assistente|capitano|mentor) ;; *) telegram_pair_usage; return 2 ;; esac
  others="$(telegram_pair_other_legacy_roles "$role")"
  if [ -n "$others" ]; then
    warn "$(jht_say line.restano_token_legacy_per_s "$others" "$role")"
    if [ -t 0 ]; then
      printf 'Abbinare %s adesso? [s/N] ' "$role" >&2
      IFS= read -r answer || answer=""
      case "$answer" in
        s|S|si|Si|SI|sì|Sì) ;;
        *) info "$(jht_say line.abbinamento_annullato_nessuna_modifica)"; return 1 ;;
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
    err "legacy_cleanup_failed: $(jht_say line.legacy_cleanup_failed.il_nuovo_token_al_sicuro)"
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
    err "$(jht_say line.jht_telegram_pair_all_interattivo)"
    return 2
  fi
  roles="$(telegram_legacy remaining 2>/dev/null)" || rc=$?
  case "$rc" in
    0) info "$(jht_say line.nessun_ruolo_ha_un_token)"; return 0 ;;
    1) ;;
    *) err "legacy_inventory_failed: $(jht_say line.legacy_inventory_failed.non_riesco_a_leggere_i)"; return 1 ;;
  esac
  roles="$(printf '%s\n' $roles | grep -Ex 'assistente|capitano|mentor' | tr '\n' ' ' || true)"
  roles="${roles% }"
  [ -n "$roles" ] || { err "legacy_inventory_failed: $(jht_say line.legacy_inventory_failed.ruoli_legacy_non_riconosciuti)"; return 1; }
  info "$(jht_say line.ruoli_da_abbinare_in_questa "$roles")"

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
        info "$(jht_say line.s_ha_gi_un_bot "$role")"
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
      err "$(jht_say line.abbinamento_di_s_non_riuscito "$role")"
      return "$rc"
    }
  done
  for role in $roles; do
    telegram_legacy remove "$role" || {
      err "legacy_cleanup_failed: $(jht_say line.legacy_cleanup_failed.i_token_nuovi_sono_al "$role")"
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
  case "$id" in ''|0*|*[!0-9]*) err "$(jht_say line.uso_jht_apply_request_cancel)"; return 2 ;; esac
  [ "${#id}" -le 10 ] || { err "$(jht_say line.uso_jht_apply_request_cancel_2)"; return 2; }
  if [ "$action" = cancel ]; then
    line="$(apply_skill cancel "$id")" || true
    IFS=$'\t' read -r ok reason confirm destination instant summary <<<"$line"
    if [ "$ok" != 1 ]; then
      err "$(jht_say line.ritiro_non_riuscito_s "${reason:-$(jht_say line.no_answer)}")"
      return 1
    fi
    info "$(jht_say line.ritirata_s_non_verra_inviata "$id")"
    return 0
  fi
  line="$(apply_skill show "$id")" || true
  IFS=$'\t' read -r ok reason confirm destination instant summary <<<"$line"
  if [ "$ok" != 1 ]; then
    err "$(jht_say line.non_autorizzabile_s "${reason:-$(jht_say line.no_answer_from_container)}")"
    return 1
  fi
  if ! printf '%s' "$confirm" | grep -Eq '^[0-9a-f]{64}$' \
    || ! printf '%s' "$destination" | grep -Eq '^((web|email):[a-z0-9.-]{3,253}|portal:[a-z]{2,20})$'; then
    err "$(jht_say line.anteprima_non_valida_niente_autorizzato)"
    return 1
  fi
  if [ ! -t 0 ]; then
    err "$(jht_say line.serve_un_terminale_l_autorizzazione)"
    return 1
  fi
  printf '\n  #%s  %s\n\n' "$id" "$summary"
  printf '  Con l'"'"'invio automatico acceso il team compila e INVIA la candidatura,\n'
  printf '  senza un'"'"'altra conferma. Una volta partita non si richiama.\n'
  printf '  %s [s/N] ' "$(jht_say line.apply.authorize)"
  IFS= read -r answer || answer=""
  case "$answer" in s|S|si|SI|Si|sì|y|Y|yes) ;; *) info "$(jht_say line.annullato_niente_autorizzato)"; return 1 ;; esac

  local shown="$destination"
  line="$(apply_skill request "$id" --expect "$confirm")" || true
  IFS=$'\t' read -r ok reason confirm destination instant summary <<<"$line"
  if [ "$ok" != 1 ]; then
    err "$(jht_say line.non_autorizzata_s "${reason:-$(jht_say line.no_answer_from_container)}")"
    return 1
  fi
  if [ "$destination" != "$shown" ] || ! printf '%s' "$instant" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'; then
    apply_skill cancel "$id" >/dev/null || true
    err "$(jht_say line.risposta_del_container_non_valida)"
    return 1
  fi
  if ! broker_admin apply record "$id" "$instant" "$destination" >/dev/null; then
    apply_skill cancel "$id" >/dev/null || true
    err "$(jht_say line.il_broker_non_ha_registrato)"
    return 1
  fi
  info "$(jht_say line.autorizzata_s_verso_s_il "$id" "$destination")"
  return 0
}

# The runtime owns the policy; this adapter only executes closed transport steps.
telegram_lifecycle_plan() {
  COMPOSE_PROFILES=telegram compose run --rm --no-deps -T --entrypoint /usr/bin/python3 "$TELEGRAM_SERVICE" \
    -I /app/shared/telegram_service/lifecycle.py "$@" </dev/null
}

telegram_lifecycle_verify() {
  local operation="$1" observed code=0
  observed="$(docker inspect --type container "$TELEGRAM_SERVICE" --format '{{.State.Running}}' 2>&1)" || code=$?
  printf '%s\n%s' "$code" "$observed" | COMPOSE_PROFILES=telegram compose run --rm --no-deps -T \
    --entrypoint /usr/bin/python3 "$TELEGRAM_SERVICE" -I /app/shared/telegram_service/lifecycle.py verify "$operation"
}

telegram_lifecycle_steps() {
  local steps="$1" role="$2" step
  while IFS= read -r step; do
    case "$step" in ''|start|stop|pair|remove|chat-id|status|not-configured) ;; *) err 'telegram_lifecycle_plan_invalid'; return 1 ;; esac
  done <<< "$steps"
  while IFS= read -r step <&3; do
    case "$step" in
      '') ;;
      start)
        ensure_broker || return $?
        COMPOSE_PROFILES=telegram compose_quiet up -d "$TELEGRAM_SERVICE" >/dev/null || return $?
        telegram_lifecycle_verify start || return $?
        ;;
      stop)
        # After a down the container is not there: podman-compose's «Error: no container with name or ID "jht-telegram" found»
        # is not an error (the noise filter of compose_quiet takes it away); any other line of a failed stop is shown.
        COMPOSE_PROFILES=telegram compose_quiet stop "$TELEGRAM_SERVICE" >/dev/null || return $?
        telegram_lifecycle_verify stop || return $?
        ;;
      pair) telegram_pair "$role" || return $? ;;
      remove) telegram_admin bots delete "$role" || return $? ;;
      chat-id) telegram_admin bots chat-id "$role" || return $? ;;
      status) telegram_admin bots status || return $? ;;
      not-configured) printf '%s\n' 'Telegram non attivo: Telegram non configurato.' ;;
      *) err 'telegram_lifecycle_plan_invalid'; return 1 ;;
    esac
  done 3<<< "$steps"
}

# Telegram keeps its whole state in the jht-telegram-state volume, which only the Telegram service (profile telegram)
# ever mounts: no volume, never configured. True only when the engine LISTED the project's volumes and that one is not
# among them; a listing that fails says nothing, and then the lifecycle runs as it always did. A person with old
# Telegram files to migrate has the volume by now (telegram_prepare_legacy_inventory runs before every resume).
telegram_state_volume_absent() {
  local project ids
  project="$(compose_project_name)" || return 1
  ids="$(docker volume ls -q --filter "label=com.docker.compose.project=$project" 2>/dev/null)" || return 1
  [ -z "$(printf '%s\n' "$ids" | awk -v expected="${project}_jht-telegram-state" '$0 == expected')" ]
}

# Transport capability only: old runtime bundles may not declare this service.
# `resume` (what install, up and upgrade ask) leaves a never-configured Telegram alone: no run container, no volume.
telegram_lifecycle_if_available() {
  compose_lacks_service "$TELEGRAM_SERVICE" && return 0
  if [ "${1:-}" = resume ] && telegram_state_volume_absent; then return 0; fi
  telegram_lifecycle_command "$@"
}

# Does the Telegram service hold a bot? Asked of the RUNNING service, read-only (an exec, no run container, no volume):
# 0 = at least one bot, 1 = none, 2 = it cannot be told (the service is off, not attestable, or answered something else).
# The one place that says whether Telegram is configured: `jht status` and `jht integration` both ask it.
telegram_bots_configured() {
  local id out
  id="$(read_only_service_id "$TELEGRAM_SERVICE" 2>/dev/null)" || return 2
  out="$(docker exec "$id" jht-telegram-admin bots status 2>/dev/null)" || return 2
  case "$out" in *'"ok": true'*) ;; *) return 2 ;; esac
  case "$out" in *'"present"'*) return 0 ;; *) return 1 ;; esac
}

# The line `jht status` says about Telegram. A status command creates nothing and prints nothing of compose: no volume,
# no run container, only questions to the engine. «Never configured» (no state volume) and «no bot» are said in one line.
telegram_status_line() {
  compose_lacks_service "$TELEGRAM_SERVICE" && return 0
  local rc=0
  if telegram_state_volume_absent; then printf '%s\n' 'Telegram non attivo: Telegram non configurato.'; return 0; fi
  telegram_bots_configured || rc=$?
  case "$rc" in
    0) telegram_admin bots status ;;
    1) printf '%s\n' 'Telegram non attivo: Telegram non configurato.' ;;
    *) printf '%s\n' 'Telegram: stato non verificabile adesso (servizio spento o non raggiungibile). Dettagli: jht telegram status' ;;
  esac
}

telegram_lifecycle_command() {
  local action="${1:-status}" role="${2:-}" steps result=0 cleanup
  [ "$action" != setup ] || role="${role:-assistente}"
  steps="$(telegram_lifecycle_plan prepare "$action" -- "$role")" || return $?
  telegram_lifecycle_steps "$steps" "$role" || result=$?
  cleanup="$(telegram_lifecycle_plan complete "$action" -- "$role")" || return 1
  telegram_lifecycle_steps "$cleanup" "$role" || return $?
  return "$result"
}

telegram_command() {
  local action="${1:-status}"
  shift || true
  case "$action" in
    status) telegram_admin bots status ;;
    pair) telegram_pair "$@" ;;
    chat-id)
      case "${1:-}" in assistente|capitano|mentor) telegram_admin bots chat-id "$1" ;; *)
        err "$(jht_say line.uso_jht_telegram_chat_id)"; return 2 ;;
      esac
      ;;
    remove)
      case "${1:-}" in assistente|capitano|mentor) telegram_admin bots delete "$1" ;; *)
        err "$(jht_say line.uso_jht_telegram_remove_assistente)"; return 2 ;;
      esac
      ;;
    *)
      err "$(jht_say line.uso_jht_telegram_status_pair)"
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
          || warn "legacy_remove_failed: $(jht_say line.legacy_remove_failed.s_nel_broker_ma_la "$name")"
        migrated=1
        ;;
      *'"ok": true'*'"state": "already_migrated"'*)
        # Un file ricomparso dopo la migrazione non si importa: lo possono
        # scrivere gli agenti. Si toglie e basta.
        docker exec -u 1001 "$agent_id" /usr/bin/python3 -I /app/shared/broker/legacy.py remove "$name" >/dev/null 2>&1 || true
        warn "legacy_secret_reappeared: $(jht_say line.legacy_secret_reappeared.jht_credentials_s_json_ricomparso "$name")"
        ;;
      *)
        warn "legacy_migration_failed: $(jht_say line.legacy_migration_failed.s_resta_in_jht_credentials "$name" "${answer:-nessuna}")"
        failed=1
        ;;
    esac
  done
  if [ "$migrated" -eq 1 ]; then
    warn "$(jht_say line.la_casella_di_posta_ora)"
    warn "$(jht_say line.genera_una_nuova_password_per)"
    warn "$(jht_say line.fino_ad_allora_la_posta)"
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
    err "$(jht_say line.apply_relink_account_cloud_account)"
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
    err "$(jht_say line.reset_non_riesco_a_determinare)"
    return 1
  }
  COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" compose down || {
    err "$(jht_say line.reset_non_riesco_a_fermare)"
    return 1
  }
  for logical in $BROKER_VOLUME_NAMES; do
    if [ "$CONTAINER_RUNTIME" = podman ]; then
      # podman-compose 1.6 labels volumes with the project but, unlike Docker
      # Compose, not with the logical volume name. Select the one exact name
      # generated by that attested project; never delete another project.
      ids="$(docker volume ls -q \
        --filter "label=com.docker.compose.project=$project" 2>/dev/null)" || {
        err "$(jht_say line.reset_ricerca_del_volume_s "$logical")"
        failed=1
        continue
      }
      ids="$(printf '%s\n' "$ids" | awk -v expected="${project}_${logical}" '$0 == expected')"
    else
      ids="$(docker volume ls -q \
        --filter "label=com.docker.compose.project=$project" \
        --filter "label=com.docker.compose.volume=$logical" 2>/dev/null)" || {
        err "$(jht_say line.reset_ricerca_del_volume_s_2 "$logical")"
        failed=1
        continue
      }
    fi
    if [ -z "$ids" ]; then
      info "$(jht_say line.saltato_non_trovato_volume_broker "$logical")"
      continue
    fi
    for id in $ids; do
      case "$id" in *[!A-Za-z0-9_.-]*)
        err "$(jht_say line.reset_nome_volume_non_valido "$logical")"
        failed=1
        continue
        ;;
      esac
      if docker volume rm "$id" >/dev/null; then
        info "$(jht_say line.cancellato_volume_broker_s_s "$logical" "$id")"
      else
        err "$(jht_say line.reset_impossibile_cancellare_il_volume "$logical" "$id")"
        failed=1
      fi
    done
  done
  [ -e "$BROKER_LEGACY_MARKER" ] && marker_existed=1
  if rm -f -- "$BROKER_LEGACY_MARKER"; then
    [ "$marker_existed" -eq 0 ] || info "$(jht_say line.cancellato_marcatore_migrazione_broker_s "$BROKER_LEGACY_MARKER")"
  else
    err "$(jht_say line.reset_impossibile_cancellare_il_marcatore "$BROKER_LEGACY_MARKER")"
    failed=1
  fi
  rm -f -- "$BROKER_WANTED_MARKER" || { err "$(jht_say line.reset_impossibile_cancellare_il_marcatore_2 "$BROKER_WANTED_MARKER")"; failed=1; }
  if [ "$failed" -eq 0 ]; then
    warn "$(jht_say line.i_segreti_e_lo_stato)"
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
    case "$verified" in *" $logical "*) ;; *) if jht_machine_output; then printf 'JHT_LEFT %s\n' "$logical"; else warn "$(jht_say migrate.left "$logical")"; fi ;; esac
  done
}

migrate_runtime_podman() {
  local docker_bin podman_bin image logical source target source_manifest target_manifest
  local verified="" records="" tmp_marker running
  docker_bin="$(migration_docker_binary)" || {
    err "runtime_migration_docker_missing: $(jht_say line.runtime_migration_docker_missing.il_client_docker_originale_non)"
    migration_left "$verified"; return 24
  }
  podman_bin="${JHT_MIGRATION_PODMAN:-$(podman_binary 2>/dev/null || true)}"
  [ -n "$podman_bin" ] && [ -x "$podman_bin" ] || {
    err "runtime_migration_podman_missing: $(jht_say line.runtime_migration_podman_missing.podman_non_e_disponibile)"
    migration_left "$verified"; return 24
  }
  image="${JHT_MIGRATION_IMAGE:-${JHT_IMAGE:-$DEFAULT_RUNTIME_IMAGE}}"
  if ! printf '%s\n' "$image" \
      | grep -Eq '^ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64}$'; then
    err "runtime_migration_image_invalid: $(jht_say line.runtime_migration_image_invalid.serve_l_immagine_jht_fissata)"
    migration_left "$verified"; return 24
  fi
  "$docker_bin" image inspect "$image" >/dev/null 2>&1 \
    && migration_podman_run "$podman_bin" image inspect "$image" >/dev/null 2>&1 || {
      err "runtime_migration_image_missing: $(jht_say line.runtime_migration_image_missing.la_stessa_immagine_jht_deve)"
      migration_left "$verified"; return 24
    }
  running="$("$docker_bin" ps -q --filter label=com.docker.compose.project=host-runtime)" || {
    migration_left "$verified"; return 24
  }
  [ -z "$running" ] || {
    err "runtime_migration_team_running: $(jht_say line.runtime_migration_team_running.ferma_prima_il_team_docker)"
    migration_left "$verified"; return 24
  }
  running="$(migration_podman_run "$podman_bin" ps -q --filter label=com.docker.compose.project=jht)" || {
    migration_left "$verified"; return 24
  }
  [ -z "$running" ] || {
    err "runtime_migration_team_running: $(jht_say line.runtime_migration_team_running.ferma_prima_il_team_podman)"
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
        err "runtime_migration_changed: $(jht_say line.runtime_migration_changed.s_non_corrisponde_piu_al "$logical")"
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
          err "runtime_migration_changed: $(jht_say line.runtime_migration_changed.checksum_diverso_per_s_dopo "$logical")"
          migration_left "$verified"; return 24
        }
      verified="$verified $logical"
    done
    info "$(jht_say line.migrazione_docker_podman_gia_verificata)"
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
        err "runtime_migration_source_missing: $(jht_say line.runtime_migration_source_missing.s_manca_in_docker_ma "$logical")"
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
      err "runtime_migration_interrupted: $(jht_say line.runtime_migration_interrupted.copia_incompleta_di_s_il "$logical")"
      migration_left "$verified"; return 24
    }
    target_manifest="$(migration_volume_manifest podman "$podman_bin" "$image" "$target")" || {
      migration_left "$verified"; return 24
    }
    [ "$source_manifest" = "$target_manifest" ] || {
      err "runtime_migration_checksum_mismatch: $(jht_say line.runtime_migration_checksum_mismatch.s_non_ha_superato_la "$logical")"
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
  info "$(jht_say line.migrazione_docker_podman_verificata_i)"
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
      *) err "$(jht_say line.mail_setup_opzione_sconosciuta_s "$1")"; return 2 ;;
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
    printf '%s ' "$(jht_say line.mail.address_prompt)" >&2
    IFS= read -r user || return 1
  fi
  if [ -z "$dedicated" ]; then
    printf '%s [s/N] ' "$(jht_say line.mail.dedicated_prompt)" >&2
    IFS= read -r dedicated || return 1
    case "$dedicated" in s|S|si|sì|y|Y|yes) dedicated=yes ;; *) dedicated=no ;; esac
  fi
  if [ "$dedicated" = yes ]; then admission=whole_mailbox; else admission=allowlist; fi
  if [ -z "$from_stdin" ]; then
    printf '%s ' "$(jht_say line.mail.app_password_prompt)" >&2
    IFS= read -rs password || return 1
    printf '\n' >&2
    [ -n "$password" ] || { err "$(jht_say line.mail_setup_password_vuota)"; return 1; }
  fi
  set -- mailbox setup --user "$user" --admission "$admission"
  [ -z "$imap_host" ] || set -- "$@" --imap-host "$imap_host"
  [ -z "$smtp_host" ] || set -- "$@" --smtp-host "$smtp_host"
  ensure_broker || { unset password; return 1; }
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
      err "$(jht_say line.uso_jht_mail_setup_status)"
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
# The variables docker-compose.yml takes from the CALLER's environment (`${NAME:-default}`): the
# coordinator database, the screen port, the Telegram limits. podman-compose 1.6.0 puts their resolved values in the
# config-hash of the service, so a terminal that has one of them set (an `export JHT_SCOUT_COORD_DB=…` for a login test) gets
# another expected hash than the app that created the container with a clean environment, and every read said «container
# non attivo» while the team ran (TEST 19g). docker-compose.yml and this list are held equal by a test.
PODMAN_CALLER_ENV="JHT_EXTRAS_IMAGE JHT_EXTRAS_DIGEST NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_JHT_DEPLOY JHT_SCOUT_COORD_DB JHT_LIVE_SCREEN_PORT JHT_TELEGRAM_SERVICE_ENABLED JHT_TELEGRAM_BURST_LIMIT JHT_TELEGRAM_DAILY_LIMIT"

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
  if [ -f "$RUNTIME_IMAGE_PIN" ] || [ -f "$RUNTIME_TIER_FILE" ]; then
    pinned_image="$(runtime_selected_image)" || return 1
  fi
  # The tools' containers (screen, media, sign-in) are made with JHT_EXTRAS_IMAGE set to the pinned extras image, the one value
  # the wrapper ever gives it: without it here ${JHT_EXTRAS_IMAGE:-...} resolves to the compose's default and their hash is never
  # the one on the container. A pin that cannot be trusted gives no image: those containers are then refused, never the others.
  local extras_digest="" extras_image=""
  extras_digest="$(runtime_extras_digest 2>/dev/null)" || extras_digest=""
  [[ "$extras_digest" =~ ^sha256:[0-9a-f]{64}$ ]] && extras_image="ghcr.io/leopu00/jht@$extras_digest"
  if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then
    resolved="$({
      cd "$RUNTIME_DIR" || return 1
      [ "$env_mode" != clean ] || unset $PODMAN_CALLER_ENV
      [ -z "$pinned_image" ] || export JHT_IMAGE="$pinned_image"
      [ -z "$extras_image" ] || export JHT_EXTRAS_IMAGE="$extras_image"
      CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME" \
      COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" PODMAN_COMPOSE_WARNING_LOGS=false \
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
      [ -z "$extras_image" ] || export JHT_EXTRAS_IMAGE="$extras_image"
      COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" PODMAN_COMPOSE_WARNING_LOGS=false \
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
# Ogni lettura dell'app attestava il container da zero: `podman info`, `podman-COMPOSE_PROFILES=telegram compose ps -q`, un dry run di
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
  local service="$1" podman_bin compose_bin podman_identity compose_identity name value facts project override=""
  podman_bin="$(podman_binary 2>/dev/null)" || return 1
  compose_bin="$(podman_compose_binary 2>/dev/null)" || return 1
  # An identity that cannot be read is no identity: no key, so no cache (inside the text below its failure would be lost and
  # the key would not tell one binary from another).
  podman_identity="$(attest_cache_binary_identity "$podman_bin")" || return 1
  compose_identity="$(attest_cache_binary_identity "$compose_bin")" || return 1
  project="$(compose_project_name 2>/dev/null)" || return 1
  # The manifest lists the digest of the compose file, the wrapper, the host setup, the runtime selection, the machine,
  # the docker shim and the image pin, and runtime_bundle_trusted has just checked each against its file: its text IS
  # their digests, read without a process.
  facts="attest-cache-v1
service=$service
uid=$HOST_UID
runtime=$CONTAINER_RUNTIME $PODMAN_RUNTIME_MODE $PODMAN_MACHINE_NAME
project=$project
podman=$podman_identity
podman-compose=$compose_identity
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
  # the extras image the expected hash of the tools' containers is made with (podman_expected_config_hash)
  facts="$facts
extras=$(runtime_extras_digest 2>/dev/null || printf 'untrusted')"
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
const piApi=config.harness==="pi"&&["glm","kimi","moonshot"].includes(provider);
const keyThere=(()=>{const ref=entry.api_key_ref;if(ref&&typeof ref==="object"&&ref.source==="file"){try{const p=String(ref.path||"");const s=fs.lstatSync(p);return p.startsWith("/")&&s.isFile()&&s.size>0&&s.size<=4096}catch{return false}}return !!ref||!!entry.api_key})();
const configured=piApi?entry.auth_method==="api_key":(["claude","anthropic","codex","openai","kimi","moonshot"].includes(provider)
  && (entry.auth_method||"subscription")==="subscription");
const markers={claude:"/jht_home/.claude/.credentials.json",anthropic:"/jht_home/.claude/.credentials.json",codex:"/jht_home/.codex/auth.json",openai:"/jht_home/.codex/auth.json",kimi:"/jht_home/.kimi/credentials/kimi-code.json",moonshot:"/jht_home/.kimi/credentials/kimi-code.json"};
process.stdout.write(`${configured?1:0} ${(piApi?keyThere:config.harness==="pi"&&(provider==="openai"||provider==="codex")?((p)=>{try{const s=fs.lstatSync(p);if(!(s.isFile()&&s.size>0&&s.size<=262144&&(s.uid===process.getuid()||s.uid===0)))return false;const d=JSON.parse(fs.readFileSync(p,"utf8"));return!!d&&typeof d==="object"&&!Array.isArray(d)&&["openai"].some((n)=>!!d[n]&&typeof d[n]==="object"&&Object.keys(d[n]).length>0)}catch{return false}})("/jht_home/.pi/agent/auth.json"):markers[provider]&&fs.existsSync(markers[provider]))?1:0} ${fs.existsSync("/jht_home/profile/welcomed.flag")?1:0}`);
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
  local action="${1:-}" container_id session="${2:-}" instance
  container_id="$(desktop_chat_container_id)" || {
    err "$(jht_say line.runtime_o_container_jht_non)"
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
        # an instance of a numbered role: SCOUT-2.. up to four digits, no zero in front
        SCOUT-*|ANALISTA-*|SCORER-*|SCRITTORE-*)
          instance="${session#*-}"
          case "$instance" in
            ''|0*|*[!0-9]*) return 2 ;;
          esac
          [ "${#instance}" -le 4 ] || return 2
          ;;
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

# Autorizzazione a una candidatura, dal desktop (`jht desktop-apply record ID INSTANT DESTINATION`). Il CLOSER
# invia solo cio' che il broker ha registrato, e il broker registra solo da canali che gli agenti non hanno:
# l'host e' uno. L'app mostra l'anteprima con il suo digest, la persona conferma con un clic, il container scrive il
# flag solo per la posizione vista, e l'app chiede qui di registrare istante e destinazione. Come agent-control NON
# avvia mai niente (niente ensure_up, niente machine): col broker non attestato risponde col codice chiuso
# apply_record_no_broker (113). Fa eccezione il primo clic di una persona: se il broker non c'e' ancora (e il motore
# risponde) lo crea `ensure_broker`, il solo passo con un compose, e solo il suo container. Ogni campo e' chiuso QUI prima di finire in una riga di comando;
# la risposta e' una riga sola, mai il testo del broker.
desktop_apply() {
  local action="${1:-}" id="${2:-}" instant="${3:-}" destination="${4:-}" broker_id answer
  # [[ =~ ]] compares the WHOLE value: a grep over several lines would accept a first line that fits and a second that does not
  local id_re='^[1-9][0-9]{0,9}$'
  local instant_re='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
  local destination_re='^((web|email):[a-z0-9.-]{3,253}|portal:[a-z]{2,20})$'
  if [ "$action" != record ] || [ "$#" -ne 4 ] \
    || ! [[ "$id" =~ $id_re ]] || ! [[ "$instant" =~ $instant_re ]] || ! [[ "$destination" =~ $destination_re ]]; then
    printf '%s\n' '{"ok":false,"error":"apply_record_invalid"}'
    return 2
  fi
  broker_id="$(read_only_service_id "$BROKER_SERVICE" 2>/dev/null)" || {
    ensure_broker >/dev/null 2>&1 || true
    broker_id="$(read_only_service_id "$BROKER_SERVICE" 2>/dev/null)"
  } || {
    printf '%s\n' '{"ok":false,"error":"apply_record_no_broker"}'
    return 113
  }
  answer="$(docker exec -i "$broker_id" jht-broker-admin apply record "$id" "$instant" "$destination" </dev/null 2>/dev/null)" || {
    printf '%s\n' '{"ok":false,"error":"apply_record_refused"}'
    return 1
  }
  if ! printf '%s' "$answer" | grep -Eq '"status": ?"(recorded|already_recorded)"'; then
    printf '%s\n' '{"ok":false,"error":"apply_record_refused"}'
    return 1
  fi
  printf '%s\n' '{"ok":true}'
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
    err "$(jht_say line.il_profilo_deve_essere_un "$file")"; return 1
  fi
  size="$(wc -c < "$file" | tr -d ' ')"
  if [ -z "$size" ] || [ "$size" -gt 65536 ]; then
    err "$(jht_say line.il_file_del_profilo_supera)"; return 1
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
      -*) err "$(jht_say line.opzione_non_riconosciuta_s "$flag")"; return 2 ;;
      *)
        if [ -n "$file" ]; then err "$(jht_say line.uso_jht_profile_import_file)"; return 2; fi
        file="$flag" ;;
    esac
  done
  if [ -z "$file" ]; then err "$(jht_say line.uso_jht_profile_import_file_2)"; return 2; fi
  profile_host_file_ok "$file" || return 1
  docker exec -i "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" profile import --stdin ${extra[@]+"${extra[@]}"} < "$file"
}

# jht artifact upload FILE: il file e' della persona, sull'host; dentro il container (dove gira il CLI) quel percorso non esiste
# e il comando moriva con ENOENT (Gate CLI Linux 19i, A5). Il wrapper lo legge con i permessi dell'utente (regolare, non un
# link, al massimo 10 MiB come la skill) e lo passa su stdin: la cartella allegati/ resta del container, nessun sudo.
artifact_upload_max_bytes=10485760

artifact_upload_has_file() {
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

# Il file della persona, sull'host, e' un documento da consegnare: regolare, non un link, leggibile, al massimo 10 MiB.
host_document_ok() {
  local file="$1" size
  if [ -L "$file" ] || [ ! -f "$file" ]; then
    err "$(jht_say line.il_documento_deve_essere_un "$file")"; return 1
  fi
  if [ ! -r "$file" ]; then
    err "$(jht_say line.non_riesco_a_leggere_il "$file")"; return 1
  fi
  size="$(wc -c < "$file" | tr -d ' ')"
  if [ -z "$size" ] || [ "$size" -gt "$artifact_upload_max_bytes" ]; then
    err "$(jht_say line.il_documento_supera_i_mb)"; return 1
  fi
  return 0
}

# jht ticket open ... --attach FILE: stesso passaggio dell'upload (il file e' sull'host, dentro il container non esiste).
# Il wrapper toglie --attach FILE, legge il file e lo da' al CLI su stdin con il nome; gli altri argomenti vanno com'erano,
# con le due opzioni nuove prima dell'eventuale `--` (dopo, il CLI le leggerebbe come argomenti).
ticket_open_has_attach() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --) return 1 ;;
      --help|-h) return 1 ;;
      --attach|--attach=*) return 0 ;;
    esac
  done
  return 1
}

ticket_open_command() {
  local file="" seen=0 want=0 literal=0 arg name
  local -a keep=() tail=()
  for arg in "$@"; do
    if [ "$want" = 1 ]; then file="$arg"; want=0; continue; fi
    if [ "$literal" = 1 ]; then tail+=("$arg"); continue; fi
    case "$arg" in
      --) literal=1; tail+=("$arg") ;;
      --attach|--attach=*)
        if [ "$seen" = 1 ]; then err "$(jht_say line.uso_jht_ticket_open_posizione)"; return 2; fi
        seen=1
        if [ "$arg" = --attach ]; then want=1; else file="${arg#--attach=}"; fi ;;
      *) keep+=("$arg") ;;
    esac
  done
  if [ "$want" = 1 ] || [ -z "$file" ]; then err "$(jht_say line.uso_jht_ticket_open_posizione_2)"; return 2; fi
  host_document_ok "$file" || return $?
  name="${file##*/}"
  docker exec -i "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" ticket open ${keep[@]+"${keep[@]}"} --attach-stdin --attach-name "$name" ${tail[@]+"${tail[@]}"} < "$file"
}

artifact_upload_command() {
  local file="" flag name
  local -a extra=()
  for flag in "$@"; do
    case "$flag" in
      --json) extra+=("$flag") ;;
      -*) err "$(jht_say line.opzione_non_riconosciuta_s_2 "$flag")"; return 2 ;;
      *)
        if [ -n "$file" ]; then err "$(jht_say line.uso_jht_artifact_upload_file)"; return 2; fi
        file="$flag" ;;
    esac
  done
  if [ -z "$file" ]; then err "$(jht_say line.uso_jht_artifact_upload_file_2)"; return 2; fi
  host_document_ok "$file" || return $?
  name="${file##*/}"
  docker exec -i "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" artifact upload --stdin --name "$name" ${extra[@]+"${extra[@]}"} < "$file"
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
      -*) err "$(jht_say line.opzione_non_riconosciuta_s_3 "$flag")"; return 2 ;;
      *)
        if [ -n "$file" ]; then err "$(jht_say line.uso_jht_profile_validate_file)"; return 2; fi
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
  printf '%s\n' "$(jht_say help.main)"
}

# `jht integration --help`: la sua riga d'uso, non l'aiuto generico dell'host. Testo fisso: il comando vive in un helper
# che si scarica solo quando serve, e un aiuto non scarica niente.
integration_help() {
  printf '%s\n' "$(jht_say help.integration)"
}

# `jht setup --help`: le sue opzioni, non l'aiuto generico dell'host. Testo fisso, come quello di integration: il setup vero gira nel
# container e un aiuto non lo avvia. Tenerlo d'accordo con le opzioni di cli/src/commands/setup.js (c'e' un test che le confronta).
setup_help() {
  printf '%s\n' "$(jht_say help.setup)"
}

# `jht screen --help`: la sua riga d'uso, a testo fisso come quella di `jht integration`: un aiuto non scarica niente.
screen_help() {
  printf '%s\n' "$(jht_say help.screen)"
}

# `jht linkedin --help`: la sua riga d'uso, a testo fisso: un aiuto non scarica niente.
linkedin_help() {
  printf '%s\n' "$(jht_say help.linkedin)"
}

# `jht tools --help`: i suoi sottocomandi, a testo fisso come quelli di `jht integration`: un aiuto non avvia il container e non
# carica l'helper (che scaricherebbe o leggerebbe il motore).
tools_help() {
  printf '%s\n' "$(jht_say help.tools)"
}

# Richiesta di sola informazione: se il container e' gia' in piedi si serve
# l'aiuto vero, altrimenti quello locale. In nessun caso si avvia qualcosa.
# A help asks nothing and needs no terminal: the container's CLI is run without -i/-t, as in jht-wrapper.ps1 (there, with -t,
# Podman tried to size the terminal of a help already over and the help came out empty).
serve_help_without_docker() {
  if docker_reachable && container_up; then
    docker exec -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
    return $?
  fi
  local_help
  if [ $# -gt 1 ]; then
    info "$(jht_say line.per_l_aiuto_di_s "$1")"
  fi
  return 0
}

# I comandi implementati dal wrapper non esistono nel CLI Node. Se Docker e'
# gia' attivo, inoltrare per esempio `jht up --help` al container darebbe un
# falso errore; il loro aiuto resta quindi quello locale anche in quel caso.
host_command_uses_local_help() {
  case "$1" in
    up|start-container|down|stop-container|restart|recreate|upgrade|clean-images|logs|status|shell|oauth-login|claude-login|setup|download|podman-machine-recreate|mail|telegram|integration|screen|linkedin|tools|reset|migrate-runtime)
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
    err "bind_uid_conflict: $(jht_say line.bind_uid_conflict.uid_s_on_this_computer "$target_uid" "$name" "$target_uid" "$name" "$name")"
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
      info "$(jht_say line.allineo_owner_di_s_a "$d" "$target" "$cur_uid")"
      if [ "$(id -u)" = "0" ]; then
        chown -R "$target" "$d" 2>/dev/null || warn "$(jht_say line.chown_fallito_su_s "$d")"
      elif [ "$target" = "1001:1001" ] && repair_owner_in_container "$home_dir" "$user_dir"; then
        break  # un container una tantum ha sistemato entrambe le cartelle: niente sudo
      else
        sudo chown -R "$target" "$d" 2>/dev/null || warn "$(jht_say line.sudo_chown_fallito_su_s "$d" "$0")"
      fi
      cur_uid=$(stat -c '%u' "$d" 2>/dev/null || echo "")
      [ "$cur_uid" = "$target_uid" ] || stuck+=("$d")
    fi
  done
  # Il container gira come $target: con le cartelle di un altro utente parte e muore subito
  # (mount_not_writable, EACCES) in un ciclo di riavvii. Meglio fermarsi qui, dicendo cosa fare.
  if [ "${#stuck[@]}" -gt 0 ]; then
    err "mount_repair_failed: $(jht_say line.mount_repair_failed.s_non_si_puo_rendere "${stuck[*]}" "$target_uid" "$target" "${stuck[*]}")"
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
    err "data_dir_moved: $(jht_say line.data_dir_moved.jht_home_host_s_non "$JHT_HOME_HOST" "$expected_home" "$expected_home" "$expected_home")"
    return 1
  fi
  if [ -n "${JHT_USER_DIR_HOST:-}" ] && ! host_data_dir_same "$JHT_USER_DIR_HOST" "$expected_user"; then
    err "data_dir_moved: $(jht_say line.data_dir_moved.jht_user_dir_host_s "$JHT_USER_DIR_HOST" "$expected_user" "$expected_user" "$expected_user")"
    return 1
  fi
}

# 0 when host-setup.sh can write what it writes: the folder of host.env is missing (it makes it), or this user can write the
# folder and, if host.env is there, the file. 1 otherwise (the folder belongs to the container's uid).
host_setup_can_write() {
  local dir
  dir="$(dirname "$HOST_ENV_FILE")"
  [ -e "$dir" ] || return 0
  [ -d "$dir" ] && [ -w "$dir" ] && [ -x "$dir" ] || return 1
  [ ! -e "$HOST_ENV_FILE" ] || [ -w "$HOST_ENV_FILE" ]
}

# What `jht setup` says when it skips host-setup.sh because it cannot write host.env: «already done» only when the type of host
# is known (the value `jht_load_host_values` took from the values file of the runtime, or from host.env the first time);
# otherwise the preflight was not done and the type stays unknown, and that is what is said.
host_setup_skip_note() {
  if [ "${JHT_HOST_TYPE:-unknown}" != unknown ]; then
    info "$(jht_say host_setup.skip_done)"
  else
    warn "$(jht_say host_setup.skip_unknown)"
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
    warn "$(jht_say_sentence config.changed_other)"
    return 0
  fi
  ensure_up
}

# `compose up -d` of the team. On Podman, a machine stopped abruptly (a crash, a forced restart of the computer) within seconds of a
# pull can leave the image's layers half on its disk: every start then fails with «can't stat (or find?) lower layer …/overlay/diff»,
# and neither down + up nor a reinstall with the same image cures it (measured on a Mac, packages 18 and 19). That one answer is said in
# a sentence, the project's containers are taken down (the data is in the volumes and the bind mounts), the image is removed and pulled
# again by its pinned digest, and the start is tried once more. Anything else is compose's answer, as before.
compose_up_team() {
  local said rc=0 image
  if [ "$CONTAINER_RUNTIME" != podman ] || [ "${JHT_COMPOSE_VERBOSE:-0}" = 1 ]; then compose_quiet up -d; return $?; fi
  said="$(mktemp "${TMPDIR:-/tmp}/jht-up.XXXXXX")" || { compose_quiet up -d; return $?; }
  compose_quiet up -d 2>"$said" || rc=$?
  # podman-compose is a Python program: when the engine goes away under it (the machine stopped or killed) it dies with a raw
  # traceback. The person reads one line, with its last line (the error) and the command that starts again, not the stack.
  if [ "$rc" -ne 0 ] && grep -Fq "Traceback (most recent call last):" "$said"; then
    local cause
    cause="$(grep -E '^[A-Za-z_.]*(Error|Exception)[A-Za-z_]*(:|$)' "$said" | tail -n 1 | tr -d '\r' | cut -c1-160)"
    [ -n "$cause" ] || cause="podman-compose"
    err "$(jht_say up.engine_lost "$cause")"
    rm -f -- "$said"
    return "$rc"
  fi
  if [ "$rc" -eq 0 ] || ! grep -Fq "lower layer" "$said"; then
    cat "$said" >&2
    rm -f -- "$said"
    return "$rc"
  fi
  rm -f -- "$said"
  info "$(jht_say up.storage_damaged)"
  image="$(runtime_selected_image)" || image=""
  [ -n "$image" ] || image="$DEFAULT_RUNTIME_IMAGE"
  if ! container_down >/dev/null 2>&1 \
      || ! { docker rmi "$image" >/dev/null 2>&1 || docker rmi -f "$image" >/dev/null 2>&1; } \
      || ! docker pull "$image" >/dev/null 2>&1; then
    err "$(jht_say up.storage_repair_failed)"
    return 1
  fi
  compose_quiet up -d || { err "$(jht_say up.storage_repair_failed)"; return 1; }
}

# `jht doctor` with the team off: what this computer can check without starting anything (the engine, the runtime, the
# configuration), and the team said off. Same shape as the CLI's doctor: a summary, and with --json the same keys. 1 with a problem.
host_doctor() { # team (off | unattestable), then the doctor's own arguments
  local team="$1" json=0 arg engine runtime config ok=0 warn=0 fail=0 rows=""
  shift
  for arg in "$@"; do [ "$arg" != --json ] || json=1; done
  if docker_reachable >/dev/null 2>&1; then engine=ok; else engine=fail; fi
  if runtime_bundle_trusted >/dev/null 2>&1; then runtime=ok; else runtime=fail; fi
  if [ -f "$(dirname "$HOST_ENV_FILE")/jht.config.json" ]; then config=ok; else config=warn; fi
  # texts said through a variable: doctor.host_config_none doctor.host_config_ok doctor.host_engine_fail doctor.host_engine_ok doctor.host_runtime_fail doctor.host_runtime_ok doctor.host_team_off doctor.host_team_unattestable
  host_doctor_row() { # status key
    case "$1" in ok) ok=$((ok + 1)) ;; warn) warn=$((warn + 1)) ;; fail) fail=$((fail + 1)) ;; esac
    rows="$rows$1|$(jht_say "$2")
"
  }
  host_doctor_row "$engine" "doctor.host_engine_$engine"
  host_doctor_row "$runtime" "doctor.host_runtime_$runtime"
  if [ "$config" = ok ]; then host_doctor_row ok doctor.host_config_ok; else host_doctor_row warn doctor.host_config_none; fi
  if [ "$team" = unattestable ]; then host_doctor_row fail doctor.host_team_unattestable; else host_doctor_row warn doctor.host_team_off; fi
  if [ "$json" -eq 1 ]; then
    local checks="" first=1 status text
    while IFS='|' read -r status text; do
      [ -n "$status" ] || continue
      text="$(printf '%s' "$text" | sed 's/\\/\\\\/g; s/"/\\"/g')"
      [ "$first" -eq 1 ] || checks="$checks,"
      first=0
      checks="$checks{\"section\":\"host\",\"status\":\"$status\",\"message\":\"$text\",\"hint\":null}"
    done <<EOF_ROWS
$rows
EOF_ROWS
    printf '{"ok":%s,"teamRunning":false,"summary":{"ok":%s,"warnings":%s,"problems":%s},"checks":[%s]}\n' \
      "$([ "$fail" -eq 0 ] && echo true || echo false)" "$ok" "$warn" "$fail" "$checks"
  else
    printf '%s\n' "$(jht_say doctor.host_title)"
    printf '%s' "$rows" | while IFS='|' read -r status text; do
      case "$status" in ok) printf '  ✓ %s\n' "$text" ;; warn) printf '  ! %s\n' "$text" ;; *) printf '  ✗ %s\n' "$text" ;; esac
    done
    printf '%s\n' "$(jht_say doctor.host_more)"
  fi
  [ "$fail" -eq 0 ]
}

# A command that needs the running container, asked before it ever started: `read_only_service_id` says 3 for «no such container»
# and 1 for «there is one and it cannot be attested». The first is a team that is not started (said as that, with the command that
# starts it); only the second is «non attestabile». Always exits 1.
not_started_or_unattestable() { # $1 = the status of the check, $2 = what is denied: restart, recreate or logs
  if [ "${1:-1}" -eq 3 ]; then
    err "$(jht_say line.job_hunter_team_non_ancora)"
  else
    # texts said through a variable: line.unattestable.restart line.unattestable.recreate line.unattestable.logs line.unattestable.other
    case "${2:-}" in restart|recreate|logs) err_unattestable "$(jht_say "line.unattestable.$2")" ;; *) err_unattestable "$(jht_say line.unattestable.other)" ;; esac
    stale_config_hint
  fi
  exit 1
}

ensure_up() {
  local status=0
  wait_for_tools_switch
  if container_up; then
    return 0
  else
    status=$?
  fi
  [ "$status" -eq 3 ] || {
    err_unattestable "$(jht_say line.unattestable.autostart)"
    stale_config_hint
    exit 1
  }
  if team_stopped_by_person; then
    err "$(jht_say team.stopped)"
    exit 1
  fi
  info "$(jht_say container.starting "$CONTAINER_SERVICE")"
  ensure_bind_owner
  telegram_prepare_legacy_inventory || {
    err "legacy_inventory_failed: $(jht_say line.legacy_inventory_failed.il_team_resta_fermo_perch)"
    exit 1
  }
  # come `jht up`: le righe di avanzamento del motore (Volume … Creating, Container … Started) restano fuori vista se va bene, e si
  # vedono intere se fallisce (compose_quiet)
  compose_up_team
  # Attendi che il container sia in stato running e con ownership completa
  # prima di inoltrare qualunque comando nel nuovo processo.
  local tries=20
  while ! container_up; do
    tries=$((tries - 1))
    if [ "$tries" -le 0 ]; then
      err "$(jht_say line.container_s_non_e_partito "$CONTAINER_SERVICE")"
      exit 1
    fi
    sleep 0.5
  done
  telegram_lifecycle_if_available resume || exit $?
}

# `jht download`: scarica l'app desktop e la verifica SULL'HOST. Prima il download e lo SHA-256 stavano dentro il container, e
# i byte verificati venivano poi copiati sull'host senza altra verifica (o lasciati in /jht_user/downloads, che gli agenti
# scrivono): un agente poteva far arrivare alla persona un installer diverso da quello verificato. Ora l'host prende da solo
# SHA256SUMS e l'installer dalla release (HTTPS), li tiene in una cartella privata fuori dai mount, confronta l'hash e pubblica
# il file solo dopo, verso una cartella che gli agenti non scrivono. Il container non entra piu' nel comando.
# JHT_RELEASE_BASE_URL e' la seam per mirror e test: viene dall'ambiente di chi lancia il comando, mai da host.env.
download_usage() {
  printf '%s\n' "$(jht_say help.download)"
}

# Il Mac di 0.4 e' solo Apple silicon: su un Intel il download non si apre, e si rifiuta prima di scaricare.
# JHT_DOWNLOAD_HOST ("<piattaforma>-<arch>") fa le veci della macchina, per i test.
download_host_is_intel_mac() {
  if [ -n "${JHT_DOWNLOAD_HOST:-}" ]; then
    [ "$JHT_DOWNLOAD_HOST" = "darwin-x64" ]
    return $?
  fi
  [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = x86_64 ] || return 1
  # Sotto Rosetta uname dice x86_64 anche su Apple silicon: il kernel dice che il processo e' tradotto.
  [ "$(/usr/sbin/sysctl -in sysctl.proc_translated 2>/dev/null || echo 0)" != 1 ]
}

# 0 se $1 sta dentro la cartella $2 (o e' la cartella stessa); i percorsi sono gia' risolti.
download_path_inside() {
  case "$1/" in "$2"/*) return 0 ;; esac
  return 1
}

handle_host_download() {
  local os="" version="" output="" deb=0 arg
  while [ "$#" -gt 0 ]; do
    arg="$1"
    case "$arg" in
      --help|-h) download_usage; return 0 ;;
      --deb) deb=1; shift ;;
      --os|--version|--output|-o)
        if [ "$#" -lt 2 ] || [ -z "$2" ]; then err "$(jht_say line.s_needs_a_value "$arg")"; return 2; fi
        case "$arg" in --os) os="$2" ;; --version) version="$2" ;; *) output="$2" ;; esac
        shift 2 ;;
      --os=*) os="${arg#--os=}"; shift ;;
      --version=*) version="${arg#--version=}"; shift ;;
      --output=*) output="${arg#--output=}"; shift ;;
      *) err "$(jht_say line.unknown_argument_s "$arg")"; download_usage >&2; return 2 ;;
    esac
  done
  if [ -z "$os" ] || [ -z "$version" ]; then err "$(jht_say line.os_and_version_are_required)"; download_usage >&2; return 2; fi

  local platform asset
  case "$(printf '%s' "$os" | tr '[:upper:]' '[:lower:]')" in
    win|win32|windows) platform=windows ;;
    darwin|mac|macos|osx) platform=macos ;;
    linux) platform=linux ;;
    *) err "$(jht_say download.unsupported_os "$os")"; return 2 ;;
  esac
  version="${version#v}"
  if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
    err "$(jht_say download.bad_version "$version")"
    return 2
  fi
  if [ "$deb" -eq 1 ] && [ "$platform" != linux ]; then err "$(jht_say download.deb_only_linux)"; return 2; fi
  if [ "$platform" = linux ]; then err "$(jht_say download.linux_no_app)"; return 1; fi
  local major minor
  major="${version%%.*}"; minor="${version#*.}"; minor="${minor%%.*}"
  if [ "$platform" = windows ] && { [ "$major" -gt 0 ] || [ "$minor" -ge 4 ]; }; then
    err "$(jht_say download.windows_missing)"
    return 1
  fi
  # Le release 0.3.x hanno altri file (tar.gz, setup.exe, zip): l'app per macOS e' dalla 0.4.0.
  if [ "$platform" != windows ] && [ "$major" -eq 0 ] && [ "$minor" -lt 4 ]; then
    err "$(jht_say download.release_no_app "$version")"
    return 1
  fi
  if [ "$platform" = macos ] && download_host_is_intel_mac; then
    err "$(jht_say download.intel_mac)"
    return 1
  fi
  case "$platform:$deb" in
    windows:*) asset="job-hunter-team-windows-x64-setup.exe" ;;
    macos:*) asset="job-hunter-team-macos-universal.dmg" ;;
  esac
  command -v curl >/dev/null 2>&1 || { err "$(jht_say download.no_curl)"; return 1; }

  # Destinazione: di base ~/Downloads, mai una cartella condivisa con il team; un --output li dentro si rifiuta.
  local dest parent real_parent
  dest="${output:-$HOME/Downloads/$asset}"
  case "$dest" in /*) ;; *) dest="$PWD/$dest" ;; esac
  parent="$(dirname -- "$dest")"
  mkdir -p -- "$parent" || { err "$(jht_say download.mkdir_failed "$parent")"; return 1; }
  real_parent="$(cd -P -- "$parent" 2>/dev/null && pwd -P)" || { err "$(jht_say download.parent_unreachable "$parent")"; return 1; }
  local shared real_shared
  for shared in "$HOME/.jht" "${JHT_USER_DIR_HOST:-$HOME/Documents/Job Hunter Team}"; do
    real_shared="$(cd -P -- "$shared" 2>/dev/null && pwd -P)" || real_shared="$shared"
    if download_path_inside "$real_parent" "$real_shared" || download_path_inside "$real_parent" "$shared"; then
      err "$(jht_say download.shared_folder "$shared")"
      return 1
    fi
  done
  dest="$real_parent/$(basename -- "$dest")"
  if [ -L "$dest" ]; then err "$(jht_say download.dest_is_link "$dest")"; return 1; fi
  if [ -e "$dest" ] && [ ! -f "$dest" ]; then err "$(jht_say download.dest_not_file "$dest")"; return 1; fi

  local base tag work expected code=0 proto
  base="${JHT_RELEASE_BASE_URL:-https://github.com/leopu00/job-hunter-team/releases/download}"
  base="${base%/}/v$version"
  proto="=https"
  [ -z "${JHT_RELEASE_BASE_URL:-}" ] || proto="=https,http"
  work="$(mktemp -d "${TMPDIR:-/tmp}/jht-download.XXXXXX")" || { err "$(jht_say download.no_tmp)"; return 1; }
  chmod 700 "$work" 2>/dev/null || true

  download_fetch() {
    curl --fail --silent --show-error --location --proto "$proto" --proto-redir "$proto" --retry 2 \
      --user-agent job-hunter-team-cli --output "$2" -- "$1"
  }
  download_cleanup() { rm -f -- "$work/SHA256SUMS" "$work/asset"; rmdir -- "$work" 2>/dev/null || true; }

  if ! download_fetch "$base/SHA256SUMS" "$work/SHA256SUMS"; then
    err "$(jht_say download.sums_failed "$version")"; download_cleanup; return 1
  fi
  local line sum rest
  expected=""
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    sum="${line%%[[:space:]]*}"
    rest="${line#"$sum"}"
    rest="${rest#"${rest%%[![:space:]]*}"}"
    rest="${rest#\*}"
    if [[ "$sum" =~ ^[0-9a-fA-F]{64}$ ]] && [ "$rest" = "$asset" ]; then
      expected="$(printf '%s' "$sum" | tr '[:upper:]' '[:lower:]')"
      break
    fi
  done < "$work/SHA256SUMS"
  if [ -z "$expected" ]; then err "$(jht_say download.sum_missing "$asset")"; download_cleanup; return 1; fi

  if [ -f "$dest" ]; then
    if [ "$(runtime_sha256 "$dest")" = "$expected" ]; then
      printf "\n  %s\n  %s\n\n" "$(jht_say download.present_verified "$dest")" "$(jht_say download.sha_verified "$expected")"
      download_cleanup; return 0
    fi
    err "$(jht_say download.mismatch_existing "$dest")"
    download_cleanup; return 1
  fi

  printf "\n  %s\n" "$(jht_say download.fetching "$asset")"
  if ! download_fetch "$base/$asset" "$work/asset"; then
    err "$(jht_say download.asset_failed "$asset")"; download_cleanup; return 1
  fi
  local actual
  actual="$(runtime_sha256 "$work/asset")"
  if [ "$actual" != "$expected" ]; then
    err "$(jht_say download.hash_invalid "$asset" "$expected" "$actual")"
    download_cleanup; return 1
  fi

  # Pubblicazione: copia in un nome nuovo accanto alla destinazione (esclusiva) e rinomina senza sostituire.
  local part="$dest.part-$$-${RANDOM:-0}"
  if ! ( set -C; cat -- "$work/asset" > "$part" ); then
    err "$(jht_say download.copy_failed)"; rm -f -- "$part"; download_cleanup; return 1
  fi
  if ! mv -n -- "$part" "$dest" || [ -e "$part" ]; then
    err "$(jht_say download.dest_appeared)"
    rm -f -- "$part"; download_cleanup; return 1
  fi
  download_cleanup
  printf "  %s\n  %s\n\n" "$(jht_say download.sha_verified "$actual")" "$(jht_say download.saved_in "$dest")"
  return "$code"
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

# ── Room for a download: what stays free AFTER it ──────────────────────────
# A pull grows the disk of this computer by the image unpacked plus its download (on a Mac the disk image of the Podman machine
# grows on the Mac's own disk). The agents refuse to start under the threshold above (disk_low), so a download goes only when
# what stays free after it is not under that threshold: on giro Mac build8 a disk with 9.2 GiB free took the update and then
# refused every agent at 3.9 GiB. The sizes are estimates of what a pull takes, some 4 times the compressed layers (unpacked plus
# the compressed copy of the pull), on the images of 0.4.0: core 0.27 GiB compressed, full 1.08 (they share some layers); on giro
# Mac m21 core and full took some 4 GiB of the machine's disk, 5 at the peak. JHT_PULL_CORE_GIB and JHT_PULL_FULL_GIB change them,
# a value that is not a number keeps the default. The installer reads the exact layers from the registry.
pull_need_kib() {
  local gib default
  case "$1" in
    core) default=1 gib="${JHT_PULL_CORE_GIB:-1}" ;;
    full) default=5 gib="${JHT_PULL_FULL_GIB:-5}" ;;
    *) printf '0\n'; return 0 ;;
  esac
  case "$gib" in ''|*[!0-9]*) gib="$default" ;; esac
  printf '%s\n' $((gib * 1048576))
}

# «<total KiB> <free KiB>» of the volume that holds $1 (its first ancestor that exists); 1 when it cannot be measured.
disk_total_avail() {
  local target="$1" line total avail
  [ -n "$target" ] || return 1
  while [ ! -e "$target" ] && [ "$target" != "/" ] && [ "$target" != "." ]; do
    target="$(dirname "$target")"
  done
  [ -e "$target" ] || return 1
  line="$(df -Pk "$target" 2>/dev/null | awk 'NR==2 {print $2 " " $4}')" || return 1
  read -r total avail <<<"$line"
  case "$total" in ''|*[!0-9]*) return 1 ;; esac
  case "$avail" in ''|*[!0-9]*) return 1 ;; esac
  [ "$total" -gt 0 ] || return 1
  printf '%s %s' "$total" "$avail"
}

# The volumes of THIS computer a download fills, one per line: the data folder, the engine's root on Linux and, on a Mac, the
# folder of the Podman machine's disk image.
disk_download_volumes() {
  printf '%s\n' "${JHT_HOME_HOST:-$HOME/.jht}"
  printf '%s\n' "$(disk_engine_path)"
  [ "${PODMAN_RUNTIME_MODE:-}" != machine ] || printf '%s\n' "${JHT_PODMAN_MACHINE_DIR:-$HOME/.local/share/containers/podman/machine}"
}

# 0 = after a download of $1 KiB no measured volume falls under the agents' threshold (under 3% AND under 8 GiB free), or none
# can be measured; 1 = one would. The least free KiB measured now in DISK_ROOM_FREE_KIB; when short, the KiB to free in
# DISK_ROOM_SHORT_KIB (the smaller of the two distances out of the threshold: either one is enough).
DISK_ROOM_FREE_KIB=""
DISK_ROOM_SHORT_KIB=""
disk_room_after_download() {
  local need="$1" volume measure total avail after short pct_short worst=0
  DISK_ROOM_FREE_KIB=""
  DISK_ROOM_SHORT_KIB=""
  case "$need" in ''|*[!0-9]*) need=0 ;; esac
  while IFS= read -r volume; do
    [ -n "$volume" ] || continue
    measure="$(disk_total_avail "$volume")" || continue
    read -r total avail <<<"$measure"
    if [ -z "$DISK_ROOM_FREE_KIB" ] || [ "$avail" -lt "$DISK_ROOM_FREE_KIB" ]; then DISK_ROOM_FREE_KIB="$avail"; fi
    after=$((avail - need))
    if [ $((after * 1000)) -lt $((DISK_BLOCK_FREE_PERMILLE * total)) ] && [ "$after" -lt "$DISK_BLOCK_FREE_KIB" ]; then
      short=$((DISK_BLOCK_FREE_KIB - after))
      pct_short=$(( (DISK_BLOCK_FREE_PERMILLE * total + 999) / 1000 - after ))
      [ "$pct_short" -ge "$short" ] || short="$pct_short"
      [ "$short" -le "$worst" ] || worst="$short"
    fi
  done <<EOF
$(disk_download_volumes)
EOF
  [ "$worst" -gt 0 ] || return 0
  DISK_ROOM_SHORT_KIB="$worst"
  return 1
}

# KiB -> whole GiB rounded UP: how much to free is never said smaller than it is.
disk_gib_up_text() {
  printf '%s' $(( ($1 + 1048575) / 1048576 ))
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
  elif [ "$ok" = "true" ] && [ "$phase" = check ]; then
    # Un controllo non aggiorna niente: non si dice «Aggiornamento completato».
    if [ "$previous_version" = unknown ]; then
      printf '%s\n' "$(jht_say line.upgrade.check_only "$message")"
    elif [ "$changed" = true ]; then
      printf '%s\n' "$(jht_say line.upgrade.check_available "$previous_version" "$previous_image" "$current_image" "$message")"
    else
      printf '%s\n' "$(jht_say line.upgrade.check_none "$previous_version" "$previous_image" "$message")"
    fi
  elif [ "$ok" = "true" ]; then
    printf '%s\n' "$(jht_say line.upgrade.done "$previous_version" "$previous_image" "$current_version" "$current_image" "$message")"
  else
    # rolled_back e' «true» o «false» (il campo del JSON), mai vuoto: «ripristinato» solo quando un ripristino c'e' stato davvero
    local restored=""
    [ "$rolled_back" != true ] || restored="$(jht_say line.upgrade.restored)"
    printf '%s\n' "$(jht_say line.upgrade.failed "$phase" "$message" "$restored")" >&2
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
    upgrade_note "$(jht_say line.upgrade.keep_old)"
    return 0
  fi
  current="$(upgrade_image_plain "$1")"
  previous="$(upgrade_image_plain "$2")"
  case "$current" in ''|none|sconosciuta|unknown) upgrade_prune_result current-unidentified 0 0 0 0; return 0 ;; esac
  case "$previous" in ''|none|sconosciuta|unknown) upgrade_prune_result previous-unidentified 0 0 0 0; return 0 ;; esac
  # A livello core la piena gia' scaricata aspetta il passaggio: non e' una vecchia versione, si tiene.
  previous="$previous
$(upgrade_tier_keep_ids)"
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
      *) err "$(jht_say line.opzione_di_clean_images_non "$arg")"; return 2 ;;
    esac
  done
  # Come `status`: una sonda. Una machine Podman che vede piu' del dovuto, o un
  # motore spento, non si accendono ne' si ripara da qui.
  require_confined_podman_machine
  if ! docker_reachable; then
    [ "$UPGRADE_JSON" = "1" ] || err "$(jht_say line.il_motore_dei_container_non)"
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
  upgrade_note "$(jht_say line.upgrade.interrupted)"
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

# ── Nucleo e immagine piena nell'upgrade (P7) ─────────────────────────────
# Un'installazione a livello `core` (file runtime-tier) gira sul nucleo; l'immagine piena, se `jht tools` l'ha gia' scaricata in
# background, sta li' ad aspettare il passaggio. L'upgrade porta avanti il nucleo (il digest lo dice il wrapper candidato, non quello
# in uso) e, solo se la piena di oggi e' gia' qui, anche la piena; la pulizia delle vecchie le tiene tutte e due. Senza runtime-tier
# l'installazione e' a un'immagine sola e niente di questo si applica.
UPGRADE_CORE_REF=""   # il nucleo candidato; vuoto = installazione a un'immagine sola
UPGRADE_FULL_REF=""   # la piena candidata, solo se quella di oggi e' gia' scaricata
UPGRADE_FULL_KEEP=""  # la piena che la pulizia deve tenere dopo l'upgrade

# $1 = file, $2 = nome della costante: il suo valore fra virgolette, o niente.
upgrade_candidate_constant() {
  sed -n "s/^$2=\"\(.*\)\"\$/\1/p" "$1" | head -n 1
}

# Letto dal wrapper candidato PRIMA di scaricare. Ritorna 1 se il rilascio non porta un nucleo leggibile o non porta piu' il
# nucleo: un'installazione a livello core non si trasforma a meta' di un upgrade (si reinstalla), e un digest malformato non si usa.
upgrade_tier_plan() {
  local wrapper="$1" core full
  UPGRADE_CORE_REF="" UPGRADE_FULL_REF="" UPGRADE_FULL_KEEP=""
  [ -f "$RUNTIME_TIER_FILE" ] || return 0
  core="$(upgrade_candidate_constant "$wrapper" CORE_IMAGE_DIGEST)"
  full="$(upgrade_candidate_constant "$wrapper" DEFAULT_RUNTIME_IMAGE)"
  printf '%s' "$core" | grep -Eqx 'sha256:[0-9a-f]{64}' || return 1
  printf '%s' "$full" | grep -Eqx 'ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64}' || return 1
  UPGRADE_CORE_REF="ghcr.io/leopu00/jht@$core"
  if docker image inspect "$DEFAULT_RUNTIME_IMAGE" >/dev/null 2>&1; then UPGRADE_FULL_REF="$full"; fi
}

# Dopo il commit: la piena nuova, se la vecchia era gia' qui. Mai decide l'esito dell'upgrade (il team e' gia' verificato): se non
# arriva, la vecchia resta e `jht tools` la riscarica da solo (il suo stato la vede mancante).
upgrade_pull_full() {
  UPGRADE_FULL_KEEP=""
  [ -n "$UPGRADE_FULL_REF" ] || return 0
  if [ "$UPGRADE_FULL_REF" = "$DEFAULT_RUNTIME_IMAGE" ]; then UPGRADE_FULL_KEEP="$UPGRADE_FULL_REF"; return 0; fi
  upgrade_note "$(jht_say line.upgrade.pull_full)"
  if upgrade_run docker pull "$UPGRADE_FULL_REF"; then
    UPGRADE_FULL_KEEP="$UPGRADE_FULL_REF"
  else
    upgrade_note "full_pull_failed: $(jht_say line.upgrade.full_pull_failed)"
  fi
}

# Room on the disk for what this upgrade downloads: the image of the tier it pulls (core, or full) and, at core level with the full
# image here, the new full one after the commit. What stays free AFTER the download must keep the agents above their threshold
# (disk_room_after_download): an update that filled the disk left a team whose agents all refused to start (giro Mac build8). When
# the room is short the old images of JHT go FIRST, by the rules of the cleaning after an upgrade (kept: the running image, the
# full one a core install keeps), the machine of a Mac trims its disk, and the disk is measured again. 1 = still short.
upgrade_disk_room() {
  local running="$1" need
  need="$(pull_need_kib "$([ -n "$UPGRADE_CORE_REF" ] && echo core || echo full)")"
  if [ -n "$UPGRADE_FULL_REF" ] && [ "$UPGRADE_FULL_REF" != "$DEFAULT_RUNTIME_IMAGE" ]; then need=$((need + $(pull_need_kib full))); fi
  UPGRADE_NEED_KIB="$need"
  disk_room_after_download "$need" && return 0
  case "$running" in ''|none|sconosciuta|unknown) ;; *)
    UPGRADE_JSON=1 upgrade_prune_old_images "$running" "$running" >/dev/null 2>&1 || true
    UPGRADE_PRUNE_JSON=""
    upgrade_trim_machine
    ;;
  esac
  disk_room_after_download "$need"
}
UPGRADE_NEED_KIB=0

# What was freed inside the Podman machine of a Mac goes back to the Mac only when the machine trims its disk (as tools_trim_machine
# in jht-tools.sh). A trim that fails changes nothing.
upgrade_trim_machine() {
  local podman_bin
  [ "${PODMAN_RUNTIME_MODE:-}" = machine ] && [ -n "${PODMAN_MACHINE_NAME:-}" ] || return 0
  podman_bin="$(podman_binary)" || return 0
  "$podman_bin" machine ssh "$PODMAN_MACHINE_NAME" sudo fstrim -a </dev/null >/dev/null 2>&1 || return 0
}

# L'ID (senza prefisso) della piena che un'installazione a livello core tiene, uno per riga; niente se non e' qui.
upgrade_tier_keep_ids() {
  local id
  [ -f "$RUNTIME_TIER_FILE" ] || return 0
  id="$(docker image inspect --format '{{.Id}}' "${UPGRADE_FULL_KEEP:-$DEFAULT_RUNTIME_IMAGE}" 2>/dev/null | head -n 1)" || return 0
  [ -z "$id" ] || upgrade_image_plain "$id"
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
  # Con --check e' una risposta, non un errore: niente da controllare qui, nessuna modifica, rc 0.
  if [ -f "$RUNTIME_IMAGE_PIN" ]; then
    if [ "$check_only" = "1" ]; then
      upgrade_result true false check unknown none unknown none false "Installazione del canale di test: jht upgrade non la aggiorna, si aggiorna reinstallando dalla build di test; nessuna modifica al runtime" false
      return 0
    fi
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
    [ "$UPGRADE_JSON" = "1" ] || err "disk_low: $(jht_say line.disk_low.gli_agenti_richiedono_almeno_disk "$(disk_gib_text "$DISK_BLOCK_FREE_KIB")" "$(disk_gib_text "$DISK_LOW_AVAIL_KIB")")"
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
  upgrade_note "$(jht_say line.upgrade.pull_runtime)"
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
  if ! upgrade_tier_plan "$candidate_wrapper"; then
    upgrade_result false false preflight "$old_version" "$old_image" "$old_version" "$old_image" false "Il rilascio non porta un nucleo valido per questa installazione: reinstalla" false
    return 1
  fi
  # A livello core il nucleo candidato e' l'immagine di tutto l'upgrade (pull, avvio, verifica, broker), come per `up`.
  [ -z "$UPGRADE_CORE_REF" ] || export JHT_IMAGE="$UPGRADE_CORE_REF"
  if ! upgrade_disk_room "$old_image"; then
    [ "$UPGRADE_JSON" = "1" ] || err "disk_low: $(jht_say line.upgrade.disk_room "$(disk_gib_up_text "$UPGRADE_NEED_KIB")" "$(disk_gib_text "$DISK_BLOCK_FREE_KIB")" "$(disk_gib_text "${DISK_ROOM_FREE_KIB:-0}")" "$(disk_gib_up_text "${DISK_ROOM_SHORT_KIB:-0}")")"
    upgrade_result false false preflight "$old_version" "$old_image" "$old_version" "$old_image" false "disk_low" false
    return 1
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
  upgrade_note "$(jht_say line.upgrade.pull_latest)"
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
  upgrade_note "$(jht_say line.upgrade.publish)"
  if ! upgrade_atomic_replace "$candidate_compose" "$COMPOSE_FILE" \
      || ! runtime_write_manifest \
      || ! upgrade_write_journal candidate_metadata "$old_image" "$was_running"; then
    if upgrade_restore_previous; then rolled_back=true; fi
    upgrade_result false false candidate_metadata "$old_version" "$old_image" "$old_version" "$old_image" false "Configurazione candidata non persistita" "$rolled_back"
    return 1
  fi

  phase="activate"
  upgrade_note "$(jht_say line.upgrade.activate)"
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
  upgrade_note "$(jht_say line.upgrade.verify)"
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
  runtime_helpers_install || upgrade_note "helper_install_failed: $(jht_say line.upgrade.helper_install_failed)"
  # Il broker dei segreti dei portali (P1 del 08/10) usa la stessa immagine
  # del team: dopo il commit riparte con quella nuova. Non decide l'esito
  # dell'upgrade (il team e' gia' verificato): se non parte, la posta resta
  # chiusa (broker_unavailable) finche' un `jht up` non lo riaccende.
  # Solo se esiste (o lo ha fatto una volta): un'installazione che non ha mai usato la posta non lo ottiene dall'upgrade.
  if grep -q "^  $BROKER_SERVICE:" "$COMPOSE_FILE" \
      && { [ -e "$BROKER_WANTED_MARKER" ] || read_only_service_id "$BROKER_SERVICE" any-config >/dev/null 2>&1; }; then
    : > "$BROKER_WANTED_MARKER" 2>/dev/null || true
    COMPOSE_PROFILES=broker upgrade_run upgrade_compose "$COMPOSE_FILE" up -d --force-recreate --no-deps "$BROKER_SERVICE" \
      || upgrade_note "broker_restart_failed: $(jht_say line.upgrade.broker_restart_failed)"
    broker_migrate_legacy_once
  fi
  telegram_lifecycle_if_available resume \
    || upgrade_note "telegram_restart_failed: $(jht_say line.upgrade.telegram_restart_failed)"
  # Solo qui: upgrade riuscito, container nuovo verificato e commit fatto.
  # Mai su check, fallimento o rollback, che escono prima.
  upgrade_pull_full || true
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

# `jht setup --api-key-file <file on THIS computer>` (glm, kimi): the setup runs in the container, which sees a file of the host
# only if it is under ~/.jht or the documents folder, and whose modes differ from the host's on a shared mount. The wrapper reads
# the file HERE and hands the key to the setup on its standard input (--api-key-stdin), which keeps it in the container's own
# key store with the right modes: the key is never in an argument, in a log or in the config. (The same as the Windows wrapper's
# Convert-SetupKeyFileArgs.) A path that starts with «/» and is not a file of this computer is the container's own and goes
# through untouched. Sets SETUP_KEY_ARGS (the arguments to pass, «setup» included), SETUP_KEY_VALUE (the key, or empty) and
# SETUP_KEY_FILE (the file it came from); rc 1 with a sentence (never the key) on stderr when the file cannot be used.
# Plain shell variables, never exported: the key is not in the environment of any process.
convert_setup_key_args() {
  local LC_ALL=C
  SETUP_KEY_ARGS=("$@")
  SETUP_KEY_VALUE=""
  SETUP_KEY_FILE=""
  local out=() host_file="" have_host=0 value arg found takes_next j has_stdin=0 i=1 n=$#
  for arg in "$@"; do
    if [ "$arg" = "--api-key-stdin" ]; then has_stdin=1; fi
  done
  while [ "$i" -le "$n" ]; do
    arg="${!i}"
    value=""; found=0; takes_next=0
    case "$arg" in
      --api-key-file) if [ "$i" -lt "$n" ]; then j=$((i + 1)); value="${!j}"; found=1; takes_next=1; fi ;;
      --api-key-file=*) value="${arg#--api-key-file=}"; found=1 ;;
    esac
    if [ "$found" = 0 ] || { [ "${value#/}" != "$value" ] && [ ! -e "$value" ]; }; then
      out+=("$arg"); i=$((i + 1)); continue
    fi
    if [ "$have_host" = 1 ]; then err "$(jht_say keyfile.twice)"; return 1; fi
    have_host=1; host_file="$value"
    if [ "$takes_next" = 1 ]; then i=$((i + 1)); fi
    out+=("--api-key-stdin"); i=$((i + 1))
  done
  [ "$have_host" = 1 ] || return 0
  if [ "$has_stdin" = 1 ]; then err "$(jht_say keyfile.both)"; return 1; fi
  if [ -L "$host_file" ] || { [ -e "$host_file" ] && [ ! -f "$host_file" ]; }; then
    err "$(jht_say keyfile.not_file "$host_file")"; return 1
  fi
  if [ ! -f "$host_file" ] || [ ! -r "$host_file" ]; then err "$(jht_say keyfile.unreadable "$host_file")"; return 1; fi
  local size
  size="$(wc -c < "$host_file" | tr -d ' ')"
  if [ "$size" -lt 1 ] || [ "$size" -gt 4096 ]; then
    err "$(jht_say keyfile.size "$host_file")"; return 1
  fi
  # like ssh: a key that others can read is said, not refused
  if [ -n "$(find "$host_file" -maxdepth 0 \( -perm -040 -o -perm -004 \) -print 2>/dev/null || true)" ]; then
    warn "$(jht_say keyfile.readable "$host_file")"
  fi
  local line="" shape='^[!-~]+$'
  IFS= read -r line < "$host_file" || true
  line="${line#$'\xef\xbb\xbf'}"      # a UTF-8 mark some editors add
  line="${line%$'\r'}"
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  if [ "${#line}" -lt 16 ] || [ "${#line}" -gt 512 ] || ! [[ "$line" =~ $shape ]]; then
    err "$(jht_say keyfile.shape "$host_file")"
    return 1
  fi
  SETUP_KEY_ARGS=("${out[@]}")
  SETUP_KEY_VALUE="$line"
  SETUP_KEY_FILE="$host_file"
  return 0
}

# The setup in the container: with a key from a file of this computer it goes on the standard input (-i only: a pipe is not a
# terminal), otherwise exactly as before. The arguments are the ones the wrapper got («setup» first).
setup_exec_container() {
  local rc=0
  if [ -n "${SETUP_KEY_VALUE:-}" ]; then
    printf '%s\n' "$SETUP_KEY_VALUE" | docker exec -i -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" ${SETUP_KEY_ARGS[@]+"${SETUP_KEY_ARGS[@]}"} || rc=$?
    SETUP_KEY_VALUE=""
    if [ "$rc" -eq 0 ]; then info "$(jht_say line.the_setup_keeps_the_key "$SETUP_KEY_FILE")"; fi
    return "$rc"
  fi
  docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@" || rc=$?
  return "$rc"
}

# ── jht status: a sentence for a person, key=value for the app ───────────
# The app (and the tests) read `name=… status=… started=… image=…` from a pipe; at a terminal the same facts come
# as a short screen with the next step. JHT_MACHINE_OUTPUT=1 forces the first form, =0 the second.
status_human_title() { printf '\n  %b%s%b\n\n' "$BOLD" "$(jht_say status.title)" "$RESET"; }

status_human_next() { printf '\n  %b→ %s%b\n\n' "$DIM" "$1" "$RESET"; }

status_human_running() {
  local line="$1" state started image
  state="${line%%|*}"; line="${line#*|}"; started="${line%%|*}"; image="${line#*|}"
  started="$(printf '%s' "$started" | sed 's/T/ /; s/\..*//; s/ \([0-9][0-9]:[0-9][0-9]\):[0-9][0-9]$/ \1/')"
  status_human_title
  if [ "$state" = running ]; then
    printf '  %-12s %s\n' "$(jht_say status.container)" "$(jht_say status.running "$started")"
  else
    printf '  %-12s %s\n' "$(jht_say status.container)" "$(jht_say status.state "$state" "$started")"
  fi
  printf '  %-12s %s\n' "$(jht_say status.image)" "${image##*/}"
  if [ "$state" = running ]; then status_human_next "$(jht_say status.next_running)"; else status_human_next "$(jht_say status.next_other)"; fi
}

# A command that only reads the team (jht agents, stats, health, team list, team status): with the container running it is the
# CLI's in the container; with it off (or the engine off) it says so and starts nothing, as jht status does. Never ensure_up: a
# sampler or a person looking at the team must not undo their own jht down.
read_only_team_command() {
  local up=0
  require_confined_podman_machine
  # The container changes image (the switch of the tools): between its down and its up the container cannot be attested and the person
  # read «operation refused» as a security error (giro Mac 18/11, 16 s). It waits for the switch, as ensure_up does, and says so.
  if jht_machine_output; then wait_for_tools_switch quiet; else wait_for_tools_switch; fi
  if docker_reachable >/dev/null 2>&1; then
    container_up >/dev/null 2>&1 || up=$?
  else
    up=3
  fi
  if [ "$up" -eq 0 ]; then
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
    exit $?
  fi
  [ "$up" -eq 3 ] || not_started_or_unattestable "$up"
  # A team that is simply off is not an error for a person (rc 0, as jht status); programs keep rc 1.
  if jht_machine_output; then printf "container '%s' non attivo\n" "$CONTAINER_SERVICE"; exit 1; fi
  printf '  %b○%b %s\n' "$DIM" "$RESET" "$(jht_say status.not_running)"
  status_human_next "$(jht_say status.not_running_next)"
  exit 0
}

status_human_not_running() {
  status_human_title
  printf '  %b○%b %s\n' "$DIM" "$RESET" "$(jht_say status.not_running)"
  status_human_next "$(jht_say status.not_running_next)"
}

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
# I testi per l'utente sono in `jht_say` (uninstall.*): senza --purge ~/.jht e Documenti restano e lo si dice; con --purge no, perche'
# si cancellano, e si dice solo il resto di cio' che va perso.

uninstall_usage() {
  err "$(jht_say uninstall.usage)"
  info "$(jht_say uninstall.usage_what)"
  info "$(jht_say uninstall.loss)"
  info "$(jht_say uninstall.purge_loss)"
  info "$(jht_say uninstall.usage_stays)"
}

# The code in front of a sentence («podman_other_machine_running: …», «config_changed_stopped: …») is for the desktop app, which keeps
# the line as the cause; a person at a terminal reads the sentence alone (jht_machine_output decides, below).
# Both are asked inside $( ), where stdout is the substitution's pipe: whether a person reads is the answer stdout gave when the
# wrapper started (JHT_STDOUT_AT_START); JHT_MACHINE_OUTPUT still decides first.
jht_code_for_app() {
  case "${JHT_MACHINE_OUTPUT:-}" in
    1) return 0 ;;
    0) return 1 ;;
  esac
  [ "${JHT_STDOUT_AT_START:-pipe}" != terminal ]
}
if [ -t 1 ]; then JHT_STDOUT_AT_START=terminal; else JHT_STDOUT_AT_START=pipe; fi
jht_code_prefix() {
  if jht_code_for_app; then printf '%s: ' "$1"; fi
}
jht_say_sentence() {
  local text
  text="$(jht_say "$@")"
  if ! jht_code_for_app; then
    case "$text" in [a-z]*_*:\ *) text="${text#*: }" ;; esac
  fi
  printf '%s' "$text"
}

# JHT_PHASE / JHT_LEFT are for the desktop app, which reads this through a pipe. At a terminal the person gets a
# sentence instead. JHT_MACHINE_OUTPUT=1 forces the marker, =0 forbids it, unset: only when stdout is not a terminal
# (the same rule as install.sh and install.ps1).
jht_machine_output() {
  case "${JHT_MACHINE_OUTPUT:-}" in
    1) return 0 ;;
    0) return 1 ;;
  esac
  [ ! -t 1 ]
}

uninstall_phase() {
  if jht_machine_output; then
    printf 'JHT_PHASE %s\n' "$1"
  else
# texts said through a variable: uninstall.phase.commands uninstall.phase.data uninstall.phase.images uninstall.phase.machine uninstall.phase.runtime
    info "$(jht_say "uninstall.phase.${1#uninstall_}")"
  fi
}

uninstall_left() {
  if jht_machine_output; then printf 'JHT_LEFT %s\n' "$1"; fi
  case "$1" in
    machine) err "$(jht_say uninstall.left.machine)" ;;
    runtime) err "$(jht_say uninstall.left.runtime)" ;;
    commands) err "$(jht_say uninstall.left.commands)" ;;
    data) err "$(jht_say uninstall.left.data)" ;;
    images) err "$(jht_say uninstall.left.images)" ;;
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
  local names name want="${2:-$UNINSTALL_MACHINE_NAME}"
  names="$("$1" machine list --format '{{.Name}}' 2>/dev/null)" || return 1
  while IFS= read -r name; do
    # Podman marca con * la macchina di default anche in questo formato.
    if [ "${name%\*}" = "$want" ]; then
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
UNINSTALL_SERVICES="jht jht-broker jht-telegram jht-media jht-playwright-populate jht-screen jht-login jht-login-proxy jht-login-view"
UNINSTALL_VOLUMES="jht-deps jht-runtime-mask jht-secrets jht-broker-state jht-broker-sock jht-telegram-broker-sock jht-telegram-secrets jht-telegram-state jht-telegram-sock jht-telegram-inbox jht-media-in jht-media-out jht-playwright jht-x11 jht-login-vnc jht-login-egress"

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

# Linux with rootless Podman: the team is a podman-compose project of this user, and only Podman sees it (the JHT docker shim is
# never taken for Docker by uninstall_tool). The same three kinds, chosen the same narrow way: containers by project AND service
# label; the network and the volumes by project label AND their exact name (podman-compose 1.6 names them <project>_default and
# <project>_<volume>, and does not label a volume with its logical name). Nothing of another project, nothing unlabelled.
uninstall_podman_native_ids() {
  local podman_bin="$1" kind="$2" project name ids
  for project in $UNINSTALL_PROJECTS; do
    case "$kind" in
      container)
        for name in $UNINSTALL_SERVICES; do
          ids="$("$podman_bin" ps -aq --filter "label=com.docker.compose.project=$project" \
            --filter "label=com.docker.compose.service=$name")" || return 1
          uninstall_print_ids $ids || return 1
        done
        ;;
      network)
        ids="$("$podman_bin" network ls -q --filter "label=com.docker.compose.project=$project")" || return 1
        ids="$(printf '%s\n' "$ids" | awk -v expected="${project}_default" '$0 == expected')"
        uninstall_print_ids $ids || return 1
        ;;
      volume)
        ids="$("$podman_bin" volume ls -q --filter "label=com.docker.compose.project=$project")" || return 1
        for name in $UNINSTALL_VOLUMES; do
          uninstall_print_ids $(printf '%s\n' "$ids" | awk -v expected="${project}_${name}" '$0 == expected') || return 1
        done
        ;;
    esac
  done
}

# The team stopped (rm -f stops a running container) and its containers, network and volumes removed, then checked gone.
uninstall_podman_native_project() {
  local podman_bin="$1" kind id ids
  for kind in container network volume; do
    ids="$(uninstall_podman_native_ids "$podman_bin" "$kind")" || return 1
    for id in $ids; do
      case "$kind" in
        container) "$podman_bin" rm -f -t 30 "$id" >/dev/null 2>&1 || return 1 ;;
        network) "$podman_bin" network rm "$id" >/dev/null 2>&1 || return 1 ;;
        volume) "$podman_bin" volume rm "$id" >/dev/null 2>&1 || return 1 ;;
      esac
    done
  done
  for kind in container network volume; do
    ids="$(uninstall_podman_native_ids "$podman_bin" "$kind")" || return 1
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

# Colima (Mac, Docker scelto): l'installer la accende quando non c'e' e lo scrive in <runtime>/colima-started (1a riga «colima», 2a il
# profilo). Finito di togliere container, volumi e immagini di JHT, se e' stato lui ad accenderla e dentro non gira piu' niente, la si
# ferma (colima stop, normale) e si controlla che sia ferma; altrimenti resta accesa e si dice perche' e come fermarla. Non si cancella
# mai la macchina. Il profilo si ricava dal socket del Docker di questo computer (…/.colima/<profilo>/docker.sock) e SOLO quel profilo
# si interroga e si ferma (colima status|stop -p <profilo>): un profilo di un altro (la Colima dell'operatore, quella di un collaudo)
# non si guarda e non si tocca; il marcatore deve dire lo stesso profilo. Con Docker Desktop attivo (o un altro socket) una Colima
# accesa non c'entra e non si dice niente. Mai un errore di disinstallazione: al peggio un avviso.
uninstall_colima() {
  local runtime_dir="$1" selection="$2" colima_bin docker_bin endpoint profile rest marker="$1/colima-started" others
  [ "$HOST_KERNEL" = "Darwin" ] && [ "$selection" != "podman" ] || return 0
  colima_bin="$(uninstall_tool colima)" || return 0
  docker_bin="$(uninstall_tool docker)" || return 0
  endpoint="$(uninstall_docker_endpoint "$docker_bin")" || return 0
  case "$endpoint" in unix://*/.colima/*/docker.sock) ;; *) return 0 ;; esac
  rest="${endpoint#*/.colima/}"
  profile="${rest%%/*}"
  [ "$rest" = "$profile/docker.sock" ] || return 0
  case "$profile" in ''|-*|*[!A-Za-z0-9_.-]*) return 0 ;; esac
  "$colima_bin" status -p "$profile" >/dev/null 2>&1 || return 0
  if [ -f "$marker" ] && [ ! -L "$marker" ] \
      && [ "$(head -c 64 "$marker" 2>/dev/null | sed -n '1p' | tr -d '\r')" = colima ] \
      && [ "$(head -c 64 "$marker" 2>/dev/null | sed -n '2p' | tr -d '\r')" = "$profile" ]; then
    others="$("$docker_bin" ps -q 2>/dev/null)" || others="unknown"
    if [ -n "$others" ]; then
      warn "$(jht_say uninstall.colima_busy)"
      return 0
    fi
    info "$(jht_say uninstall.colima_stopping)"
    if "$colima_bin" stop -p "$profile" >/dev/null 2>&1 && ! "$colima_bin" status -p "$profile" >/dev/null 2>&1; then
      return 0
    fi
    warn "$(jht_say uninstall.colima_stop_failed)"
    return 0
  fi
  warn "$(jht_say uninstall.colima_running)"
}

# Il collegamento al plugin Compose che l'installer ha messo nella cartella dei plugin del client docker: <runtime>/docker-compose-plugin-link
# dice (3 righe) il percorso del collegamento, dove punta, e se la cartella l'ha fatta l'installer. Si toglie SOLO quel collegamento
# (rm del link, mai del plugin di Homebrew), se il marcatore e' un file normale, il percorso e' quello della cartella del client di
# questa persona (~/.docker o DOCKER_CONFIG) e il collegamento e' ancora un link che punta a quello che dice il marcatore: un link che la
# persona ha rifatto altrove non si tocca. La cartella la si toglie solo se l'ha fatta l'installer e ormai e' vuota (rmdir). Mai un
# errore di disinstallazione: al peggio un avviso.
uninstall_compose_plugin_link() {
  local marker="$1/docker-compose-plugin-link" link target made
  [ -f "$marker" ] && [ ! -L "$marker" ] || return 0
  link="$(head -c 1024 "$marker" 2>/dev/null | sed -n '1p' | tr -d '\r')"
  target="$(head -c 1024 "$marker" 2>/dev/null | sed -n '2p' | tr -d '\r')"
  made="$(head -c 1024 "$marker" 2>/dev/null | sed -n '3p' | tr -d '\r')"
  [ -n "$link" ] && [ -n "$target" ] || return 0
  case "$link" in
    "$HOME/.docker/cli-plugins/docker-compose") ;;
    *) [ -n "${DOCKER_CONFIG:-}" ] && [ "$link" = "${DOCKER_CONFIG%/}/cli-plugins/docker-compose" ] || return 0 ;;
  esac
  [ -L "$link" ] && [ "$(readlink "$link" 2>/dev/null)" = "$target" ] || return 0
  if rm -f -- "$link" 2>/dev/null && [ ! -e "$link" ] && [ ! -L "$link" ]; then
    info "$(jht_say uninstall.compose_link_removed "$link")"
    [ "$made" != 1 ] || rmdir -- "$(dirname "$link")" 2>/dev/null || true
  else
    warn "$(jht_say uninstall.compose_link_left "$link")"
  fi
  return 0
}

# Le immagini di JHT (nucleo, piena e le vecchie) nel Docker di questo computer, senza -f e senza pulizie di massa, dopo i container.
# Si toglie per RIFERIMENTO (repository:tag), uno per uno: un ID con piu' tag non si toglie con `image rm <ID>` senza -f (il motore
# rifiuta «referenced in multiple repositories») e la disinstallazione non finirebbe piu'. Senza tag (<none>) si toglie per ID.
# Stesse regole della pulizia dell'upgrade: solo i repository JHT per nome esatto, e un ID che porta anche un nome non JHT e' di
# qualcun altro e si tiene. Il rifiuto del motore e' un residuo: si dice e si rilancia. $1 = docker; scrive in UNINSTALL_IMAGES_REMOVED.
uninstall_docker_images() {
  local docker_bin="$1" listing pairs foreign id repo tag plain target ids="" failed="" n=0 left=0 announced=0 seen_ref=""
  UNINSTALL_IMAGES_REMOVED=0
  listing="$("$docker_bin" image ls --no-trunc --format '{{.ID}} {{.Repository}} {{.Tag}}' 2>/dev/null)" || return 1
  pairs="$(printf '%s\n' "$listing" | while IFS=' ' read -r id repo tag; do printf '%s %s\n' "$id" "$repo"; done)"
  foreign="$(upgrade_foreign_image_ids "$pairs")"
  while IFS=' ' read -r id repo tag; do
    [ -n "$id" ] || continue
    upgrade_repo_is_jht "$repo" || continue
    plain="$(upgrade_image_plain "$id")"
    case "$foreign
" in *"
$plain
"*) continue ;; esac
    if [ -n "$tag" ] && [ "$tag" != "<none>" ]; then target="$repo:$tag"; else target="$id"; fi
    case "
$seen_ref
" in *"
$target
"*) continue ;; esac
    seen_ref="$seen_ref
$target"
    case "
$ids
" in *"
$plain
"*) ;; *) ids="$ids
$plain"; n=$((n + 1)) ;; esac
    # La fase si annuncia alla prima immagine da togliere: senza immagini JHT non c'e' niente da dire.
    [ "$announced" -eq 1 ] || { uninstall_phase uninstall_images; announced=1; }
    if ! "$docker_bin" image rm "$target" >/dev/null 2>&1; then
      case "
$failed
" in *"
$plain
"*) ;; *) failed="$failed
$plain"; left=$((left + 1)) ;; esac
    fi
  done <<EOF
$listing
EOF
  UNINSTALL_IMAGES_REMOVED=$((n - left))
  [ "$left" -eq 0 ]
}

# Il Docker di questo computer, se c'e' e risponde (la macchina Podman porta via le sue immagini con se'): lo stesso controllo
# dell'endpoint di uninstall_machine, che ha gia' rifiutato un Docker che non e' qui.
uninstall_images() { # selection
  local selection="${1:-}" docker_bin endpoint podman_bin native_removed=0
  UNINSTALL_IMAGES_REMOVED=0
  # Linux with rootless Podman: the JHT images are in this user's Podman storage (only JHT's repositories, the same choice as Docker's).
  if [ "$HOST_KERNEL" = "Linux" ] && [ "$selection" = "podman" ] && podman_bin="$(uninstall_tool podman)"; then
    unset CONTAINER_HOST CONTAINER_CONNECTION
    uninstall_docker_images "$podman_bin" || return 1
    native_removed="$UNINSTALL_IMAGES_REMOVED"
  fi
  UNINSTALL_IMAGES_REMOVED="$native_removed"
  docker_bin="$(uninstall_tool docker)" || return 0
  endpoint="$(uninstall_docker_endpoint "$docker_bin")" || return 0
  case "$endpoint" in unix://*|npipe://*) ;; *) return 0 ;; esac
  "$docker_bin" info >/dev/null 2>&1 || return 0
  uninstall_docker_images "$docker_bin" || return 1
  UNINSTALL_IMAGES_REMOVED=$((UNINSTALL_IMAGES_REMOVED + native_removed))
}

# Il nome della macchina Podman che l'installer ha attestato in <runtime>/podman-machine, se e' un nome semplice e NON quello
# standard (jht-podman, che si toglie sempre). L'installer adotta una macchina gia' esistente con il nome che gli si da
# (la variabile del nome, in install.sh): un nome diverso si toglie solo se l'ha creata lui (uninstall_machine_created_by_installer).
uninstall_attested_machine() {
  local file="$1/podman-machine" name
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  name="$(head -c 64 "$file" 2>/dev/null | head -n 1 | tr -d '\r\n')"
  case "$name" in
    ''|-*|"$UNINSTALL_MACHINE_NAME"|*[!A-Za-z0-9_.-]*) return 1 ;;
  esac
  printf '%s\n' "$name"
}

# Il nome in <runtime>/podman-machine e' di QUESTA macchina, creata dall'installer, solo se <runtime>/podman-machine-created e' un file
# regolare (non un collegamento) che dice il nome (1a riga) e il momento della creazione (2a riga), e il motore dice lo stesso momento per
# la macchina di quel nome: una macchina che la persona ha ricreato con lo stesso nome ha un altro momento e non e' questa.
# $1 = cartella runtime, $2 = nome, $3 = podman. Senza 2a riga, o con un motore che non risponde, non e' dimostrato: la macchina resta.
uninstall_machine_created_by_installer() {
  local file="$1/podman-machine-created" content written created now
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  content="$(head -c 256 "$file" 2>/dev/null)" || return 1
  written="$(printf '%s\n' "$content" | sed -n '1p' | tr -d '\r')"
  created="$(printf '%s\n' "$content" | sed -n '2p' | tr -d '\r')"
  [ -n "$written" ] && [ "$written" = "$2" ] && [ -n "$created" ] || return 1
  now="$("$3" machine inspect --format '{{.Created}}' "$2" 2>/dev/null | head -n 1 | tr -d '\r')" || return 1
  [ -n "$now" ] && [ "$now" = "$created" ]
}

# Toglie la macchina Podman $2 (ferma e rimuove, --force): 0 se alla fine non c'e' piu'.
uninstall_remove_podman_machine() {
  local podman_bin="$1" name="$2" state
  state="$(uninstall_podman_machine_state "$podman_bin" "$name")" || return 1
  if [ "$state" = "present" ]; then
    "$podman_bin" machine rm --force "$name" >/dev/null 2>&1 || return 1
    state="$(uninstall_podman_machine_state "$podman_bin" "$name")" || return 1
    [ "$state" = "absent" ] || return 1
  fi
}

uninstall_machine() {
  local selection="$1" runtime_dir="${2:-}" podman_bin docker_bin state endpoint kept
  # La macchina jht-podman esiste solo sul Mac. Va tolta anche se il runtime
  # scelto oggi e' Docker: una prova Podman precedente la lascia inerte, con
  # i suoi volumi.
  if [ "$HOST_KERNEL" = "Darwin" ]; then
    if podman_bin="$(uninstall_tool podman)"; then
      uninstall_remove_podman_machine "$podman_bin" "$UNINSTALL_MACHINE_NAME" || return 1
      # Una macchina attestata con un altro nome si toglie solo se l'ha creata l'installer (marcatore con quel nome); se e' stata
      # adottata (c'era gia': puo' essere dell'utente) resta, e si dice quale e perche'.
      if [ -n "$runtime_dir" ] && kept="$(uninstall_attested_machine "$runtime_dir")" \
          && [ "$(uninstall_podman_machine_state "$podman_bin" "$kept")" = "present" ]; then
        if uninstall_machine_created_by_installer "$runtime_dir" "$kept" "$podman_bin"; then
          info "$(jht_say uninstall.machine_removing "$kept")"
          uninstall_remove_podman_machine "$podman_bin" "$kept" || return 1
        else
          warn "$(jht_say uninstall.machine_kept "$kept" "$kept" "$kept")"
        fi
      fi
    elif [ "$selection" = "podman" ]; then
      return 1
    fi
  fi
  # Linux con Podman rootless: il progetto e' di Podman, di questo utente (mai il Podman di root: le variabili che lo renderebbero
  # remoto si tolgono). Senza podman non c'e' niente da togliere.
  if [ "$HOST_KERNEL" = "Linux" ] && [ "$selection" = "podman" ] && podman_bin="$(uninstall_tool podman)"; then
    unset CONTAINER_HOST CONTAINER_CONNECTION
    uninstall_podman_native_project "$podman_bin" || return 1
  fi
  # Linux e Mac con Colima o Docker Desktop: il team e' un progetto Compose
  # nel Docker dell'utente. Con Podman scelto, un vecchio progetto Docker si
  # toglie solo se Docker risponde.
  if docker_bin="$(uninstall_tool docker)"; then
    if ! endpoint="$(uninstall_docker_endpoint "$docker_bin")"; then
      [ "$selection" = "podman" ] && return 0
      err "$(jht_say line.non_riesco_a_sapere_a)"
      return 1
    fi
    case "$endpoint" in
      unix://*|npipe://*) ;;
      *)
        [ "$selection" = "podman" ] && return 0
        err "$(jht_say line.docker_punta_a_s_che "$endpoint")"
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

# ── jht uninstall --confirm --purge: i dati ───────────────────────────────
# Le cartelle sono quelle due, fisse (vedi host_data_dir_same): mai altre, mai un percorso preso dall'ambiente.
#
# Su Linux con Docker il container gira come uid 1001 e possiede ~/.jht (spesso 700): l'utente di casa non puo' ne'
# leggerla ne' cancellarne il contenuto, nemmeno col comando giusto. Si prova prima come l'utente, SENZA cambiare
# permessi o proprietari; solo se resta qualcosa, un container usa-e-getta della stessa immagine (gia' presente: mai
# scaricata) che gira come 1001, il proprietario, senza capability, senza rete, a filesystem di sola lettura e con
# montata solo quella cartella: ne svuota il contenuto. La cartella, ormai vuota, la toglie l'utente (togliere una voce
# chiede il permesso di scrittura sulla cartella che la contiene, la sua, non quello sulla voce). Con Podman rootless
# senza keep-id i file sono di uno uid dello spazio dei nomi: `podman unshare` li cancella senza sudo.
uninstall_data_dirs() {
  printf '%s\n' "$HOME/.jht" "$HOME/Documents/Job Hunter Team"
}

uninstall_runtime_image() {
  local pin ref
  pin="$1/runtime-image"
  if [ -f "$pin" ] && [ ! -L "$pin" ]; then
    ref="$(head -n 1 "$pin" 2>/dev/null | tr -d '\r\n')"
    case "$ref" in
      ''|-*|*[!A-Za-z0-9./_:@-]*) ;;       # a reference never starts with a dash: it would be read as an option
      *) printf '%s\n' "$ref"; return 0 ;;
    esac
  fi
  printf '%s\n' "$DEFAULT_RUNTIME_IMAGE"
}

uninstall_empty_in_docker() {
  local dir="$1" runtime_dir="$2" docker_bin endpoint image
  case "$dir" in *:*|*,*) return 1 ;; esac
  docker_bin="$(uninstall_tool docker)" || return 1
  endpoint="$(uninstall_docker_endpoint "$docker_bin")" || return 1
  case "$endpoint" in unix://*) ;; *) return 1 ;; esac
  "$docker_bin" info >/dev/null 2>&1 || return 1
  image="$(uninstall_runtime_image "$runtime_dir")"
  "$docker_bin" run --rm --pull never --user 1001:1001 --cap-drop ALL --network none \
    --security-opt no-new-privileges --read-only -v "$dir:/purge" \
    --entrypoint /bin/sh "$image" -c 'find /purge -mindepth 1 -xdev -delete' >/dev/null 2>&1
}

uninstall_remove_data_dir() {
  local dir="$1" runtime_dir="$2" selection="$3" podman_bin
  if [ -L "$dir" ]; then
    err "$(jht_say line.s_e_un_collegamento_non "$dir")"
    return 1
  fi
  [ -e "$dir" ] || return 0
  if [ ! -d "$dir" ]; then
    err "$(jht_say line.s_non_e_una_cartella "$dir")"
    return 1
  fi
  rm -rf -- "$dir" 2>/dev/null || true
  [ -e "$dir" ] || [ -L "$dir" ] || return 0
  if [ "$HOST_KERNEL" = "Linux" ]; then
    if [ "$selection" = "podman" ] && podman_bin="$(uninstall_tool podman)"; then
      "$podman_bin" unshare rm -rf -- "$dir" >/dev/null 2>&1 || true
    else
      uninstall_empty_in_docker "$dir" "$runtime_dir" || true
      rmdir -- "$dir" 2>/dev/null || true
    fi
  fi
  if [ -e "$dir" ] || [ -L "$dir" ]; then
    err "$(jht_say line.non_sono_riuscito_a_cancellare "$dir")"
    return 1
  fi
}

uninstall_remove_data() {
  local runtime_dir="$1" selection="$2" dir failed=0
  case "${JHT_HOME_HOST:-$HOME/.jht}|${JHT_USER_DIR_HOST:-$HOME/Documents/Job Hunter Team}" in
    "$HOME/.jht|$HOME/Documents/Job Hunter Team") ;;
    *) err "$(jht_say line.jht_home_host_o_jht)"; return 1 ;;
  esac
  while IFS= read -r dir; do
    uninstall_remove_data_dir "$dir" "$runtime_dir" "$selection" || failed=1
  done < <(uninstall_data_dirs)
  [ "$failed" -eq 0 ]
}

jht_uninstall() {
  local runtime_dir selection="" bin rc failed=0 purge=0
  case "$*" in
    "--confirm") ;;
    "--confirm --purge"|"--purge --confirm") purge=1 ;;
    *)
      uninstall_usage
      return 2
      ;;
  esac
  case "$HOME" in
    /?*) ;;
    *) err "$(jht_say uninstall.bad_home)"; return 2 ;;
  esac
  runtime_dir="$(uninstall_runtime_dir)"
  if [ -e "$runtime_dir/container-runtime" ] || [ -L "$runtime_dir/container-runtime" ]; then
    if [ -f "$runtime_dir/container-runtime" ] && [ ! -L "$runtime_dir/container-runtime" ]; then
      selection="$(tr -d '\r\n' < "$runtime_dir/container-runtime")"
    fi
    case "$selection" in
      docker|podman) ;;
      *)
        err "$(jht_say uninstall.runtime_choice_unreadable)"
        uninstall_report_rest "$runtime_dir"
        return 24
        ;;
    esac
  fi
  # Con --purge ~/.jht e Documenti NON restano: dirlo e subito dopo il contrario era una contraddizione nella stessa uscita.
  if [ "$purge" -eq 1 ]; then
    info "$(jht_say uninstall.loss_purge)"
    warn "$(jht_say uninstall.purge_loss)"
  else
    info "$(jht_say uninstall.loss)"
  fi

  uninstall_phase uninstall_machine
  if ! uninstall_machine "$selection" "$runtime_dir"; then
    uninstall_left machine
    uninstall_report_rest "$runtime_dir"
    return 24
  fi

  # I dati vanno PRIMA del runtime e del comando: se non si riesce, il comando jht resta e si puo' rilanciare.
  if [ "$purge" -eq 1 ]; then
    uninstall_phase uninstall_data
    if ! uninstall_remove_data "$runtime_dir" "$selection"; then
      uninstall_left data
      return 24
    fi
  fi

  # Le immagini DOPO i dati: con --purge il container usa-e-getta che svuota ~/.jht ha bisogno dell'immagine, gia' presente.
  if ! uninstall_images "$selection"; then
    uninstall_left images
    return 24
  fi
  [ "$UNINSTALL_IMAGES_REMOVED" -eq 0 ] || info "$(jht_say uninstall.images_removed "$UNINSTALL_IMAGES_REMOVED")"
  # La macchina Colima dopo le immagini (servono il motore acceso) e prima della cartella del runtime (che ne tiene il marcatore).
  uninstall_colima "$runtime_dir" "$selection"
  uninstall_compose_plugin_link "$runtime_dir"

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

if [ "$SUB" = monitor ]; then
  for arg in "${@:2}"; do
    if [ "$arg" = --window ]; then jht_monitor_window "$0" "${@:2}"; exit $?; fi
  done
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
        if [ "$SUB" = integration ] && [ "$#" -eq 2 ]; then
          integration_help
          exit 0
        fi
        if [ "$SUB" = screen ] && [ "$#" -eq 2 ]; then
          screen_help
          exit 0
        fi
        if [ "$SUB" = linkedin ] && [ "$#" -eq 2 ]; then
          linkedin_help
          exit 0
        fi
        if [ "$SUB" = tools ]; then
          tools_help
          exit 0
        fi
        if [ "$SUB" = setup ]; then
          setup_help
          exit 0
        fi
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
    # `jht help setup` is `jht setup --help`: the same text, not the long list (the setup runs in the container and a help starts nothing).
    if [ "${2:-}" = setup ] && [ "$#" -eq 2 ]; then
      setup_help
      exit 0
    fi
    serve_help_without_docker help
    exit $?
    ;;

  -V|--version|version)
    if docker_reachable && container_up; then
      docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" --version
    elif [ -n "${JHT_IMAGE_TAG:-}" ]; then
      printf '%s\n' "$JHT_IMAGE_TAG"
      info "$(jht_say line.versione_dell_immagine_configurata_per)"
    elif [ -n "${JHT_IMAGE:-}" ]; then
      printf '%s\n' "$(basename "$JHT_IMAGE" | sed 's/.*://')"
      info "$(jht_say line.versione_dell_immagine_configurata_per_2)"
    else
      printf '%s\n' "$DEFAULT_RUNTIME_VERSION"
      info "$(jht_say line.versione_dell_immagine_configurata_per_3)"
    fi
    exit 0
    ;;

  # The Godot office and its commands are gone (0.4.0): said here, on the host, before anything would start the team for them.
  game|gui)
    err "$(jht_say removed.office "$SUB")"
    exit 2
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

  desktop-apply)
    shift || true
    desktop_apply "$@"
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
      err "$(jht_say line.questo_runtime_non_usa_una)"
      exit 1
    fi
    if [ "${2:-}" != "--confirm" ] || [ $# -ne 2 ]; then
      err "$(jht_say line.ricrea_la_macchina_podman_s "$PODMAN_MACHINE_NAME")"
      err "$(jht_say line.attenzione_le_cli_interne_verranno)"
      err "$(jht_say line.per_procedere_jht_podman_machine)"
      exit 2
    fi
    podman_bin="$(podman_binary)" || { err "$(jht_say line.podman_non_trovato_reinstalla_il_3)"; exit 127; }
    ensure_podman_mount_dirs \
      || { err "$(jht_say line.non_riesco_a_creare_jht_2)"; exit 1; }
    start_podman_for_recreate "$podman_bin" || exit 1
    broker_state_image="$(compose_images)" \
      || { err "$(jht_say line.non_riesco_a_determinare_l)"; exit 1; }
    broker_state_image="$(printf '%s\n' "$broker_state_image" | sort -u)"
    case "$broker_state_image" in ''|*$'\n'*)
      err "$(jht_say line.il_compose_non_indica_una)"
      exit 1
      ;;
    esac
    COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" compose down \
      || { err "$(jht_say line.non_riesco_a_fermare_i)"; exit 1; }
    trap podman_state_backup_cleanup EXIT INT TERM
    podman_export_broker_state "$podman_bin" "$broker_state_image" \
      || { err "$(jht_say line.non_riesco_a_esportare_in)"; exit 1; }
    default_connection="$("$podman_bin" system connection list --format '{{.Name}} {{.Default}}' 2>/dev/null \
      | awk '$2 == "true" { print $1; exit }')"
    info "$(jht_say line.fermo_e_ricreo_la_macchina "$PODMAN_MACHINE_NAME")"
    "$podman_bin" machine stop "$PODMAN_MACHINE_NAME" >/dev/null 2>&1 || true
    "$podman_bin" machine rm -f "$PODMAN_MACHINE_NAME" >/dev/null \
      || { err "$(jht_say line.non_riesco_a_rimuovere_la "$PODMAN_MACHINE_NAME")"; exit 1; }
    rm -f -- "$BROKER_LEGACY_MARKER" \
      || warn "$(jht_say line.non_ho_potuto_rimuovere_il "$BROKER_LEGACY_MARKER")"
    if ! jht_detached_from_terminal "$podman_bin" machine init --now --update-connection=false \
      --cpus "$PODMAN_MACHINE_CPUS" \
      --memory "$PODMAN_MACHINE_MEMORY_MIB" \
      --disk-size "$PODMAN_MACHINE_DISK_GIB" \
      --volume "$PODMAN_MOUNT_JHT_HOME:$PODMAN_MOUNT_JHT_HOME" \
      --volume "$PODMAN_MOUNT_JHT_DOCS:$PODMAN_MOUNT_JHT_DOCS" \
      "$PODMAN_MACHINE_NAME" >/dev/null; then
      if [ -n "$default_connection" ]; then
        "$podman_bin" system connection default "$default_connection" >/dev/null 2>&1 || true
      fi
      err "$(jht_say line.la_nuova_macchina_podman_s "$PODMAN_MACHINE_NAME")"
      exit 1
    fi
    if [ -n "$default_connection" ]; then
      "$podman_bin" system connection default "$default_connection" >/dev/null 2>&1 \
        || warn "$(jht_say line.non_ho_potuto_rimettere_s "$default_connection")"
    fi
    # The stock Fedora CoreOS timer trims weekly. Re-enable it after replacing
    # the VM so applehv can deallocate unused blocks in the sparse disk image.
    enable_podman_trim_timer "$podman_bin" \
      || warn "$(jht_say line.la_macchina_e_pronta_ma)"
    podman_import_broker_state "$podman_bin" \
      || { err "$(jht_say line.la_macchina_e_stata_ricreata)"; exit 1; }
    require_confined_podman_machine
    podman_state_backup_cleanup
    trap - EXIT INT TERM
    info "$(jht_say line.macchina_podman_ricreata_vede_solo)"
    ;;

  # ── Lifecycle: parlano direttamente al daemon Docker ───────────────────
  up)
    jht_compose_verbose_requested "${@:2}"
    require_compose_file
    wake_container_runtime_for_up
    container_mutation_preflight || exit 1
    team_stopped_clear
    ensure_bind_owner
    telegram_prepare_legacy_inventory || {
      err "legacy_inventory_failed: $(jht_say line.legacy_inventory_failed.il_team_resta_fermo_perch_2)"
      exit 1
    }
    compose_up_team
    container_postcheck_running || exit 1
    printf '%s\n' "$(jht_say up.done)"
    # The pull of the full image starts HERE, with the container up, and not after telegram and the broker: an up that ends early
    # on one of them (a broker or telegram left Exited by an earlier up) never reached the end, so nobody started the pull and the
    # team stayed on the core image, refusing its Scouts, with nothing said (giro of a beta tester's server, 18/11).
    agents_room_cleanup
    tools_tell_person kick
    telegram_lifecycle_if_available resume || exit $?
    broker_after_up
    ;;

  start-container)
    jht_compose_verbose_requested "${@:2}"
    require_compose_file
    require_docker
    container_mutation_preflight || exit 1
    team_stopped_clear
    ensure_bind_owner
    telegram_prepare_legacy_inventory || {
      err "legacy_inventory_failed: $(jht_say line.legacy_inventory_failed.il_team_resta_fermo_perch_3)"
      exit 1
    }
    compose_up_team
    container_postcheck_running || exit 1
    printf '%s\n' "$(jht_say up.done)"
    telegram_lifecycle_if_available resume || exit $?
    broker_after_up
    ;;

  down|stop-container)
    jht_compose_verbose_requested "${@:2}"
    require_compose_file
    require_docker
    container_down || exit 1
    team_stopped_mark
    ;;

  restart)
    require_compose_file
    require_docker
    container_up >/dev/null || {
      not_started_or_unattestable $? restart
    }
    compose restart "$CONTAINER_SERVICE"
    container_postcheck_running || exit 1
    ;;

  recreate)
    jht_compose_verbose_requested "${@:2}"
    require_compose_file
    require_docker
    container_up >/dev/null || {
      not_started_or_unattestable $? recreate
    }
    ensure_bind_owner
    COMPOSE_PROFILES="$COMPOSE_ALL_PROFILES" compose_quiet down
    telegram_prepare_legacy_inventory || {
      err "legacy_inventory_failed: $(jht_say line.legacy_inventory_failed.il_team_resta_fermo_perch_4)"
      exit 1
    }
    compose_up_team
    container_postcheck_running || exit 1
    printf '%s\n' "$(jht_say up.done)"
    telegram_lifecycle_if_available resume || exit $?
    broker_after_up
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
        err "$(jht_say line.uso_jht_apply_relink_account)"
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

  integration)
    require_compose_file
    if [ -z "$(runtime_helper_digest jht-integration.sh)" ]; then runtime_helper_absent_answer integration "${@:2}" && exit 0; fi
    runtime_helper_load jht-integration.sh "${2:-}" || exit 1
    integration_main "${@:2}"
    exit $?
    ;;

  screen)
    # The live screen of the closer is the integration `screen`: on = add, off = remove, status = status.
    require_compose_file
    case "${2:-}" in
      on) screen_verb=add ;;
      off) screen_verb=remove ;;
      status) screen_verb=status ;;
      *) err "$(jht_say line.uso_jht_screen_on_off)"; exit 2 ;;
    esac
    if [ -z "$(runtime_helper_digest jht-integration.sh)" ] && [ "$screen_verb" = status ]; then
      runtime_helper_absent_answer integration status screen "${@:3}" && exit 0
    fi
    runtime_helper_load jht-integration.sh "$screen_verb" || exit 1
    integration_main "$screen_verb" screen "${@:3}"
    exit $?
    ;;

  linkedin)
    # The manual sign-in to LinkedIn. The lines the app reads are the same with or without the helper: a read-only question or a stop
    # needs nothing to be installed, and only `login` fetches the helper if it is not there.
    require_compose_file
    if [ -z "$(runtime_helper_digest jht-integration.sh)" ]; then
      case "${*:2}" in
        "status --json") printf '{"ok": true, "view": "idle", "linkedin": "login_required"}\n'; exit 0 ;;
        "login --stop") printf '{"ok": true}\n'; exit 0 ;;
      esac
    fi
    runtime_helper_load jht-integration.sh add || exit 1
    linkedin_main "${@:2}"
    exit $?
    ;;

  tools)
    require_compose_file
    if [ -z "$(runtime_helper_digest jht-tools.sh)" ]; then runtime_helper_absent_answer tools "${@:2}" && exit 0; fi
    runtime_helper_load jht-tools.sh "${2:-}" || exit 1
    tools_main "${@:2}"
    exit $?
    ;;

  telegram)
    require_compose_file
    require_docker
    telegram_lifecycle_command "${@:2}"
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
      err "$(jht_say line.uso_jht_migrate_runtime_podman)"
      exit 2
    fi
    migrate_runtime_podman
    exit $?
    ;;

  logs)
    require_docker
    shift || true
    container_id="$(read_only_container_id)" || {
      not_started_or_unattestable $? logs
    }
    # Passa eventuali flag (-f, --tail N) a docker logs.
    docker logs "$@" "$container_id"
    ;;

  status)
    # No options here (--json lives in the jht of the container): refused out loud, never ignored.
    if [ "$#" -gt 1 ]; then shift; err "$(jht_say status.no_options "$*")"; exit 2; fi
    # Probe pura: `status` non deve avviare la machine Podman, Docker Desktop
    # o il container. Solo l'arm esplicito `up` puo' accendere la machine.
    # Una machine che vede tutto il Mac non risulta "attiva" nemmeno qui.
    require_confined_podman_machine
    if ! docker_reachable; then
      # A team that is simply off is not an error for a person (rc 0, as right after the install); programs keep rc 1.
      if jht_machine_output; then printf "container '%s' non attivo\n" "$CONTAINER_SERVICE"; exit 1; fi
      status_human_not_running
      exit 0
    fi
    why_file="$(mktemp "${TMPDIR:-/tmp}/jht-why.XXXXXX" 2>/dev/null)" || why_file=""
    JHT_ATTEST_WHY_FILE="$why_file"
    if container_id="$(read_only_container_id)"; then
      JHT_ATTEST_WHY_FILE=""
      [ -z "$why_file" ] || rm -f -- "$why_file"
      if jht_machine_output; then
        docker inspect "$container_id" --format \
          'name={{.Name}} status={{.State.Status}} started={{.State.StartedAt}} image={{.Config.Image}}'
      else
        status_human_running "$(docker inspect "$container_id" --format '{{.State.Status}}|{{.State.StartedAt}}|{{.Config.Image}}')"
        telegram_status_line || exit $?
        tools_tell_person
      fi
    else
      attest_status=$?
      JHT_ATTEST_WHY_FILE=""
      # 3 = the project has no such container; anything else = a container is there and cannot be attested.
      # Saying «non attivo» for the second hid a team that was running (TEST 19g).
      if [ "$attest_status" -eq 3 ]; then
        if jht_machine_output; then printf "container '%s' non attivo\n" "$CONTAINER_SERVICE"; else
          [ -z "$why_file" ] || rm -f -- "$why_file"
          status_human_not_running
          exit 0
        fi
      else
        if docker_compose_plugin_missing; then
          err "$(jht_say compose.missing)"
        else
          printf '%s\n' "$(jht_say line.status.unattestable "$CONTAINER_SERVICE")"
        fi
        if [ "$CONTAINER_RUNTIME" = podman ] && podman_caller_env_set; then
          printf '  %s\n' "$(jht_say line.status.caller_env "$(podman_caller_env_names)")"
        fi
        if [ -n "$why_file" ] && [ -s "$why_file" ]; then
          printf '  %s\n' "$(jht_say line.status.provider_said "$(head -n 1 "$why_file")")"
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
    # `oauth-login --stop`: the app's «Cancel» of the sign-in. Closing the window's end of `docker exec` does not stop what
    # it started in the container when there is no terminal (Linux, a pipe): the `codex login --device-auth` stays there,
    # waiting for a code nobody will enter, and finishes later over the credentials the person has. This ends exactly that
    # process (the device login of Codex, found by its command line), never the team's agents.
    if [ "${2:-}" = "--stop" ]; then
      docker exec "$ATTESTED_CONTAINER_ID" node -e \
        "const fs=require('fs');for(const d of fs.readdirSync('/proc')){if(!/^[0-9]+\$/.test(d)||Number(d)===process.pid)continue;try{const a=fs.readFileSync('/proc/'+d+'/cmdline','utf8').split('\\0');if(a.includes('login')&&a.includes('--device-auth')&&a.some(function(x){return /codex/.test(x)}))process.kill(Number(d),'SIGTERM')}catch(e){}}" \
        2>/dev/null || true
      exit 0
    fi
    provider="$(docker exec "$ATTESTED_CONTAINER_ID" node -e \
      "try{const c=require('/jht_home/jht.config.json');process.stdout.write(String(c.active_provider||''))}catch{}" \
      2>/dev/null || true)"
    provider_lc="$(printf '%s' "$provider" | tr '[:upper:]' '[:lower:]')"
    case "$provider_lc" in
      openai|codex)
        docker exec $EXEC_FLAGS "$ATTESTED_CONTAINER_ID" bash -c '[ -f /app/.launcher/oauth-login-openai.sh ] && exec bash /app/.launcher/oauth-login-openai.sh; exec codex login --device-auth'
        ;;
      kimi|moonshot)
        docker exec $EXEC_FLAGS "$ATTESTED_CONTAINER_ID" kimi --yolo
        ;;
      claude|anthropic)
        docker exec $EXEC_FLAGS "$ATTESTED_CONTAINER_ID" claude --dangerously-skip-permissions
        ;;
      '')
        # Nessun provider scelto: nessuna CLI "di default", si sceglie prima.
        err "$(jht_say line.nessun_provider_attivo_scegline_uno)"
        exit 1
        ;;
      *)
        err "$(jht_say line.provider_attivo_non_riconosciuto_s "$provider")"
        exit 1
        ;;
    esac
    ;;

  # ── Setup: host-side preflight (swap, VPS detect) prima del wizard ────
  setup)
    # --api-key-file of a file on this computer: the key goes to the setup on its standard input (convert_setup_key_args).
    convert_setup_key_args "$@" || exit 1
    require_compose_file
    require_docker
    team_stopped_clear
    if setup_wizard_args "$@"; then setup_open_flag_write; fi
    # Skip host-setup se utente ha passato --non-interactive (i flag CLI
    # del wizard sono espliciti, niente domande possibili) o env esplicita.
    if [ "${JHT_SKIP_HOST_SETUP:-0}" != "1" ] \
       && ! printf '%s\n' "$@" | grep -q -- '--non-interactive'; then
      if [ -x "$HOST_SETUP_SCRIPT" ] && ! host_setup_can_write; then
        # On Linux with Docker the installer hands ~/.jht to the container's uid (1001), mode 700: this user cannot write
        # host.env, and host-setup.sh died on «host.env: Permission denied» (TEST 19i, A3). What it writes is already there.
        host_setup_skip_note
      elif [ -x "$HOST_SETUP_SCRIPT" ]; then
        bash "$HOST_SETUP_SCRIPT" || warn "$(jht_say line.host_setup_sh_terminato_con)"
      else
        info "$(jht_say line.host_setup_sh_non_trovato "$HOST_SETUP_SCRIPT")"
      fi
    fi
    # Rileggi host.env DOPO host-setup.sh: al primo setup il file non esiste
    # ancora quando parte il wrapper. Anche qui resta input non fidato e passa
    # esclusivamente dallo stesso parser allowlist, mai dalla shell.
    jht_load_host_values
    jht_record_host_values
    ensure_up
    agents_room_cleanup
    tools_tell_person kick
    rc=0
    setup_exec_container "$@" || rc=$?
    if setup_wizard_args "$@"; then setup_open_flag_remove; fi
    if [ "${1:-}" = cloud ] && [ "${2:-}" = pair ] && [ "$rc" -eq 0 ]; then ensure_broker && broker_configure_web_authorisations; fi
    exit "$rc"
    ;;

  # Download e verifica SHA-256 sull'host (il container non c'entra): vedi handle_host_download.
  download)
    handle_host_download "${@:2}"
    exit $?
    ;;

  # `jht artifact upload FILE`: il file dell'host lo legge il wrapper (vedi artifact_upload_command); gli altri verbi vanno al CLI.
  artifact)
    require_compose_file
    require_docker
    ensure_up
    if [ "${2:-}" = upload ] && artifact_upload_has_file "${@:3}"; then
      artifact_upload_command "${@:3}"; exit $?
    fi
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
    ;;

  # `jht ticket open ... --attach FILE`: come l'upload, il file dell'host lo legge il wrapper (vedi ticket_open_command).
  ticket)
    require_compose_file
    require_docker
    ensure_up
    if [ "${2:-}" = open ] && ticket_open_has_attach "${@:3}"; then
      ticket_open_command "${@:3}"; exit $?
    fi
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
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
      err "$(jht_say line.container_s_non_attivo_leggere "$CONTAINER_SERVICE")"
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
    case "${2:-}" in list|status) read_only_team_command "$@" ;; esac
    require_docker
    if [ "${2:-}" = chat ] && [ -n "${JHT_TEAM_CHAT_RESUME:-}" ]; then team_chat_resume "$@"
    elif [ "${2:-}" = stop ]; then ensure_up_for_stop
    else ensure_up
    fi
    team_rc=0
    # A chat on a terminal: what the container client says on its own stderr is kept aside until the REPL ends (on a terminal the
    # REPL's own lines all come through the tty, on stdout). The switch of the tools removes the container under the REPL, and
    # Podman then says «Error: no container with name or ID "jht" found»: that line is not for the person, the chat says why
    # it stops and comes back. Any other end shows it as before.
    team_err=""
    # A chat that comes back after an update or a switch is told so (the container side asks again the question that got no answer).
    team_chat_flags=""
    if [ "${2:-}" = chat ] && [ -n "${JHT_TEAM_CHAT_RESUME:-}" ]; then team_chat_flags="-e JHT_TEAM_CHAT_RESUMED=1"; fi
    if [ "${2:-}" = chat ] && [ "$EXEC_FLAGS" = "-it" ]; then
      team_err="$(mktemp "${TMPDIR:-/tmp}/jht-chat-err.XXXXXX" 2>/dev/null)" || team_err=""
    fi
    if [ -n "$team_err" ]; then
      docker exec $EXEC_FLAGS $team_chat_flags -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@" 2>"$team_err" || team_rc=$?
    else
      docker exec $EXEC_FLAGS $team_chat_flags -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@" || team_rc=$?
    fi
    # the REPL ended because the team is moving onto the full image: it comes back by itself once the team runs again
    if [ "${2:-}" = chat ] && team_chat_ended_by_switch; then
      [ -z "$team_err" ] || rm -f "$team_err"
      team_chat_through_switch "$@"
      exit $?
    fi
    # the engine went away under the REPL (an update restarts the Podman machine): no raw line, the chat comes back by itself
    if [ "${2:-}" = chat ] && [ "$team_rc" -ne 0 ] && [ -n "$team_err" ] && team_chat_engine_gone "$team_err"; then
      rm -f "$team_err"
      team_chat_through_update "$@"
      exit $?
    fi
    if [ -n "$team_err" ]; then
      cat "$team_err" >&2 2>/dev/null || true
      rm -f "$team_err"
    fi
    exit "$team_rc"
    ;;

  # Commands that only read: they never start a stopped team.
  agents|stats|health)
    require_compose_file
    read_only_team_command "$@"
    ;;

  # ── Operativita': delegata al CLI Node nel container ───────────────────
  doctor)
    # A doctor never starts the team: with the container running it is the CLI's own; with it off, the checks this computer can make.
    require_compose_file
    doctor_team=off
    if docker_reachable >/dev/null 2>&1; then
      doctor_up=0
      container_up >/dev/null 2>&1 || doctor_up=$?
      if [ "$doctor_up" -eq 0 ]; then
        docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
        exit $?
      fi
      [ "$doctor_up" -eq 3 ] || doctor_team=unattestable
    fi
    host_doctor "$doctor_team" "${@:2}"
    exit $?
    ;;

  *)
    require_compose_file
    require_docker
    ensure_up
    docker exec $EXEC_FLAGS -e JHT_HOST_TYPE="$JHT_HOST_TYPE" "$ATTESTED_CONTAINER_ID" node "$NODE_ENTRY" "$@"
    ;;
esac

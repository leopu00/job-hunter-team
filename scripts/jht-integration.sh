#!/usr/bin/env bash
# jht-integration.sh — `jht integration list|status|add|remove`: the integrations a person adds AFTER the setup.
#
# Not a program: a library the wrapper loads with `source` once its digest matches the runtime manifest (see
# runtime_helper_load in jht-wrapper.sh). It uses the wrapper's own functions (compose, read_only_service_id, ensure_up).
# JHT_RUNTIME_HELPER=1
#
# What is asked of it, and what it never does:
#   - the id is one of a CLOSED list, checked before anything else; no text of the person ever reaches a shell or an engine
#     argument (every engine command below has fixed words, or a name taken from the tables in this file);
#   - the state is read from the ENGINE (container attested by the wrapper, volumes of the compose project) and from small
#     host-owned markers in $RUNTIME_DIR/integrations, never from a file the container can write;
#   - nothing is turned on by an agent: this is the command the person types (or the button of the app).
#
# States (JSON `state`; the text in parentheses is what the person reads):
#   not_installed (non installato) | downloading (in scaricamento) | ready (aggiunto) | running (acceso) | error (errore),
#   always with a `reason` of one line.
# Exit: 0 done · 1 failed · 2 wrong use · 3 not available yet.

INTEGRATION_IDS="google telegram mail linkedin-login screen media"
INTEGRATION_NOT_YET=""

integration_label() {
  case "$1" in
    not_installed) printf 'non installato' ;;
    downloading) printf 'in scaricamento' ;;
    ready) printf 'aggiunto' ;;
    running) printf 'acceso' ;;
    *) printf 'errore' ;;
  esac
}

integration_id_valid() {
  case " $INTEGRATION_IDS " in *" $1 "*) return 0 ;; esac
  return 1
}

integration_not_yet() {
  case " $INTEGRATION_NOT_YET " in *" $1 "*) return 0 ;; esac
  return 1
}

# Text of the person's language (ours: the constants below) goes through; text from a command goes through
# integration_foreign first, which keeps printable ASCII only.
integration_foreign() { printf '%s' "$1" | LC_ALL=C tr -cd '\40-\176' | cut -c1-200; }
integration_json_str() { printf '%s' "$1" | tr -d '\000-\037\177' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

# ── Host markers ──────────────────────────────────────────────────────────
# $RUNTIME_DIR/integrations/<id>.pending (pid of the run in progress), <id>.error (one line), google.ok.
# The folder is the host's: outside every mount of the container, checked like the runtime itself.
integration_dir() { printf '%s/integrations\n' "$RUNTIME_DIR"; }

integration_dir_ready() {
  local dir
  dir="$(integration_dir)"
  if [ ! -e "$dir" ] && [ ! -L "$dir" ]; then
    (umask 077 && mkdir "$dir") || return 1
  fi
  runtime_node_safe "$dir" dir
}

integration_marker_read() {
  local file
  file="$(integration_dir)/$1.$2"
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
  runtime_node_safe "$file" file || return 1
  head -n 1 "$file" 2>/dev/null
}

integration_marker_write() {
  local dir tmp
  integration_dir_ready || return 1
  dir="$(integration_dir)"
  tmp="$(mktemp "$dir/.$1.$2.XXXXXX")" || return 1
  printf '%s\n' "$3" > "$tmp" && mv -f "$tmp" "$dir/$1.$2" || { rm -f "$tmp"; return 1; }
}

integration_marker_clear() { rm -f "$(integration_dir)/$1.$2" 2>/dev/null || true; }

# A run in progress leaves its pid; a pid that is not alive (Ctrl-C, closed terminal) is no run.
integration_pending() {
  local pid
  pid="$(integration_marker_read "$1" pending)" || return 1
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null
}

# ── What the engine says ──────────────────────────────────────────────────
# 0 = the volume is among those of the compose project, 1 = it is not, 2 = the engine did not answer.
integration_volume_present() {
  local ids
  ids="$(docker volume ls -q --filter "label=com.docker.compose.project=$(compose_project_name)" 2>/dev/null)" || return 2
  [ -n "$(printf '%s\n' "$ids" | awk -v expected="$(compose_project_name)_$1" '$0 == expected')" ]
}

# service → "<service> <volume that exists once it has been made>"
integration_service_of() {
  case "$1" in
    telegram) printf '%s jht-telegram-state' "$TELEGRAM_SERVICE" ;;
    mail) printf '%s jht-broker-state' "$BROKER_SERVICE" ;;
    *) return 1 ;;
  esac
}

# Prints "<state>|<reason>". The engine is only asked, never started.
integration_state() {
  local id="$1" service volume rc=0 line bots_rc=0
  if integration_not_yet "$id"; then printf 'not_installed|non disponibile ancora\n'; return 0; fi
  if integration_pending "$id"; then printf 'downloading|operazione in corso\n'; return 0; fi
  if [ "$id" = google ]; then
    if integration_marker_read google ok >/dev/null; then printf 'ready|librerie di Google aggiunte al profilo; mancano le credenziali dell'"'"'account Google\n'; return 0; fi
  elif [ "$id" = linkedin-login ]; then
    docker_reachable || { printf 'error|il motore dei container non risponde\n'; return 0; }
    if linkedin_any_running; then printf 'running|accesso a LinkedIn in corso\n'; return 0; fi
    printf 'not_installed|si accende con: jht linkedin login\n'; return 0
  elif [ "$id" = screen ]; then
    docker_reachable || { printf 'error|il motore dei container non risponde\n'; return 0; }
    read_only_service_id "$SCREEN_SERVICE" >/dev/null 2>&1 || rc=$?
    case "$rc" in
      0) printf 'running|schermo acceso, stream in sola vista su 127.0.0.1\n'; return 0 ;;
      3) ;;
      *) printf 'error|il container non e'"'"' attestabile\n'; return 0 ;;
    esac
    if integration_marker_read screen ok >/dev/null; then printf 'ready|chiesto acceso ma il container e'"'"' spento: jht screen on lo riaccende\n'; return 0; fi
  elif [ "$id" = media ]; then
    # The two folders it shares with jht are made by `jht up` whether it is added or not: its own marker says "added".
    docker_reachable || { printf 'error|il motore dei container non risponde\n'; return 0; }
    read_only_service_id "$MEDIA_SERVICE" >/dev/null 2>&1 || rc=$?
    case "$rc" in
      0) printf 'running|container acceso\n'; return 0 ;;
      3) ;;
      *) printf 'error|il container non e'"'"' attestabile\n'; return 0 ;;
    esac
    if integration_marker_read media ok >/dev/null; then printf 'ready|aggiunto, container spento: jht integration add media lo riaccende\n'; return 0; fi
  else
    read -r service volume <<< "$(integration_service_of "$id")"
    docker_reachable || { printf 'error|il motore dei container non risponde\n'; return 0; }
    read_only_service_id "$service" >/dev/null 2>&1 || rc=$?
    case "$rc" in
      0)
        # One true state: a Telegram service that is up but holds no bot is not «acceso» for the person, it is waiting for a token
        # (the same question `jht status` asks). Any answer but a clear «none» keeps what the engine says.
        if [ "$id" = telegram ]; then
          telegram_bots_configured || bots_rc=$?
          if [ "$bots_rc" -eq 1 ]; then
            printf 'ready|servizio acceso, nessun bot abbinato: jht telegram pair assistente\n'
            return 0
          fi
        fi
        printf 'running|container acceso\n'; return 0 ;;
      3) ;;
      *) printf 'error|il container non e'"'"' attestabile\n'; return 0 ;;
    esac
    rc=0
    integration_volume_present "$volume" || rc=$?
    case "$rc" in
      0) printf 'ready|creato, container spento\n'; return 0 ;;
      2) printf 'error|il motore dei container non risponde\n'; return 0 ;;
    esac
  fi
  if line="$(integration_marker_read "$id" error)" && [ -n "$line" ]; then
    printf 'error|%s\n' "$(integration_foreign "$line")"
    return 0
  fi
  printf 'not_installed|non ancora aggiunto\n'
}

# ── Output ────────────────────────────────────────────────────────────────
integration_status_json() { # id state reason
  printf '{"id":"%s","state":"%s","reason":"%s"}' "$1" "$2" "$(integration_json_str "$3")"
}

integration_print_status() { # json id
  local state reason
  IFS='|' read -r state reason <<< "$(integration_state "$2")"
  if [ "$1" = 1 ]; then integration_status_json "$2" "$state" "$reason"; printf '\n'; return 0; fi
  printf '%-15s %-16s %s\n' "$2" "$(integration_label "$state")" "$reason"
}

integration_list() { # json
  local id first=1
  if [ "$1" = 1 ]; then
    printf '{"integrations":['
    for id in $INTEGRATION_IDS; do
      [ "$first" = 1 ] || printf ','
      first=0
      integration_print_status 1 "$id" | tr -d '\n'
    done
    printf ']}\n'
    return 0
  fi
  for id in $INTEGRATION_IDS; do integration_print_status 0 "$id"; done
}

# The result of add/remove, in the form the person asked for. $1 json, $2 id, $3 exit code, $4 reason when it did not work.
integration_result() {
  local state reason
  IFS='|' read -r state reason <<< "$(integration_state "$2")"
  [ "$3" -eq 0 ] || { [ "$3" -eq 3 ] || state=error; reason="$4"; }
  # what the run said about itself (the data that stayed, the volume left) is worth more than the state's own line
  if [ "$3" -eq 0 ] && [ -n "$4" ]; then reason="$4"; fi
  if [ "$1" = 1 ]; then
    printf '{"id":"%s","ok":%s,"state":"%s","reason":"%s"}\n' "$2" "$([ "$3" -eq 0 ] && echo true || echo false)" "$state" "$(integration_json_str "$reason")"
  elif [ "$3" -eq 0 ]; then
    info "$2: $(integration_label "$state") ($reason)"
  else
    err "$2: $reason"
  fi
  return "$3"
}

# ── add ───────────────────────────────────────────────────────────────────
# Fixed text, run inside the team's container: the libraries of Google go to the person's own store (jht-install).
# Single quotes inside, like the .ps1 one: Windows PowerShell 5.1 drops a double quote in a native argument.
INTEGRATION_GOOGLE_CODE="import sys; sys.path.insert(0, '/app/shared/skills'); from optional_libs import ensure, GOOGLE_DRIVE, GOOGLE_SHEETS; ensure(*GOOGLE_DRIVE, 'Google Drive'); ensure(*GOOGLE_SHEETS, 'Google Sheets')"

# The media container (voice notes and photos): the extras image by the digest this wrapper carries, then the profile of the compose.
MEDIA_SERVICE="jht-media"
SCREEN_SERVICE="jht-screen"
PLAYWRIGHT_POPULATE_SERVICE="jht-playwright-populate"

integration_extras_ref() { # prints the reference of the extras image, or nothing while the release has none
  [[ "${EXTRAS_IMAGE_DIGEST:-}" =~ ^sha256:[0-9a-f]{64}$ ]] && printf 'ghcr.io/leopu00/jht@%s\n' "$EXTRAS_IMAGE_DIGEST"
  return 0
}

# The folder of the viewer password of the live screen, and whether what is there is fit to be mounted: nothing, or a plain folder,
# never a link.
integration_screen_folder() { printf '%s/live-screen' "${JHT_HOME_HOST:-$HOME/.jht}"; }
integration_screen_folder_ok() {
  local dir
  dir="$(integration_screen_folder)"
  [ ! -L "$dir" ] && { [ ! -e "$dir" ] || [ -d "$dir" ]; }
}

integration_do_add() { # id → 0 done · 1 failed (reason in INTEGRATION_WHY)
  local out ref
  INTEGRATION_WHY=""
  case "$1" in
    google)
      ensure_up >/dev/null 2>&1 || { INTEGRATION_WHY="il container del team non parte: jht up"; return 1; }
      out="$(docker exec -e JHT_HOST_TYPE="${JHT_HOST_TYPE:-}" "$ATTESTED_CONTAINER_ID" python3 -c "$INTEGRATION_GOOGLE_CODE" 2>&1)" || {
        INTEGRATION_WHY="$(integration_foreign "$(printf '%s\n' "$out" | tail -n 1)")"
        [ -n "$INTEGRATION_WHY" ] || INTEGRATION_WHY="installazione delle librerie non riuscita"
        return 1
      }
      integration_marker_write google ok ok || { INTEGRATION_WHY="marcatore non scritto"; return 1; }
      ;;
    telegram)
      COMPOSE_PROFILES=telegram compose up -d "$TELEGRAM_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="il servizio Telegram non parte"; return 1; }
      telegram_lifecycle_verify start >/dev/null 2>&1 || { INTEGRATION_WHY="il servizio Telegram non risulta acceso"; return 1; }
      ;;
    media)
      ref="$(integration_extras_ref)"
      [ -n "$ref" ] || { INTEGRATION_WHY="non disponibile ancora"; return 3; }
      docker pull "$ref" >/dev/null 2>&1 || { INTEGRATION_WHY="download dell'immagine degli strumenti non riuscito"; return 1; }
      JHT_EXTRAS_IMAGE="$ref" COMPOSE_PROFILES=media compose up -d "$MEDIA_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="il container dei media non parte"; return 1; }
      read_only_service_id "$MEDIA_SERVICE" >/dev/null 2>&1 || { INTEGRATION_WHY="il container dei media non risulta acceso"; return 1; }
      integration_marker_write media ok ok || { INTEGRATION_WHY="marcatore non scritto"; return 1; }
      ;;
    linkedin-login)
      INTEGRATION_WHY="non si aggiunge: si accende con jht linkedin login"
      return 3
      ;;
    screen)
      ref="$(integration_extras_ref)"
      [ -n "$ref" ] || { INTEGRATION_WHY="non disponibile ancora"; return 3; }
      docker pull "$ref" >/dev/null 2>&1 || { INTEGRATION_WHY="download dell'immagine degli strumenti non riuscito"; return 1; }
      # The folder the desktop app reads the viewer password from is made here, by the person: a bind mount of a folder that is not
      # there would be made by the engine, with its own owner. It is mounted writable in the screen container, and ~/.jht is written by
      # the agents: a link in its place would have the engine mount what the link points to. It is a plain folder or the run stops.
      integration_screen_folder_ok || { INTEGRATION_WHY="live-screen in ~/.jht non e' una cartella normale (un collegamento?): non la uso"; return 1; }
      [ -d "$(integration_screen_folder)" ] || (umask 077 && mkdir -p -- "${JHT_HOME_HOST:-$HOME/.jht}" && mkdir -- "$(integration_screen_folder)") 2>/dev/null \
        || { INTEGRATION_WHY="cartella della password dello schermo non creata"; return 1; }
      # The closer's browser with a window comes from the volume the one-shot fills: ready before the screen is.
      JHT_EXTRAS_IMAGE="$ref" JHT_EXTRAS_DIGEST="$EXTRAS_IMAGE_DIGEST" COMPOSE_PROFILES=playwright compose run --rm --no-deps -T "$PLAYWRIGHT_POPULATE_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="il browser del closer non si copia nel volume"; return 1; }
      # Checked again right before the up (the copy above took time): what is left is the instant between this test and the engine's
      # mount, which an agent that wins the race can use; the folder holds nothing but a viewer password.
      integration_screen_folder_ok && [ -d "$(integration_screen_folder)" ] \
        || { INTEGRATION_WHY="live-screen in ~/.jht non e' una cartella normale (un collegamento?): non la uso"; return 1; }
      JHT_EXTRAS_IMAGE="$ref" COMPOSE_PROFILES=screen compose up -d "$SCREEN_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="il container dello schermo non parte"; return 1; }
      read_only_service_id "$SCREEN_SERVICE" >/dev/null 2>&1 || { INTEGRATION_WHY="il container dello schermo non risulta acceso"; return 1; }
      integration_marker_write screen ok ok || { INTEGRATION_WHY="marcatore non scritto"; return 1; }
      ;;
    mail)
      ensure_broker >/dev/null 2>&1 || { INTEGRATION_WHY="il broker della posta non parte"; return 1; }
      read_only_service_id "$BROKER_SERVICE" >/dev/null 2>&1 || { INTEGRATION_WHY="il broker della posta non risulta acceso"; return 1; }
      ;;
  esac
}

# ── remove ────────────────────────────────────────────────────────────────
# Volumes that belong to one integration only. The ones shared with `jht` (sockets) are never listed, and neither is jht-secrets:
# it holds the credentials of every portal besides the mailbox (jht reset --scope creds is the way to empty it).
integration_volumes_of() {
  case "$1" in
    telegram) printf 'jht-telegram-secrets jht-telegram-state jht-telegram-inbox' ;;
    mail) printf 'jht-broker-state' ;;
    screen) printf 'jht-x11' ;;
    linkedin-login) printf 'jht-login-vnc jht-login-egress' ;;
  esac
}

integration_do_remove() { # id purge → 0 done · 1 failed
  local volume rc id ref
  INTEGRATION_WHY=""
  case "$1" in
    google)
      integration_marker_clear google ok
      INTEGRATION_WHY="segnato come non aggiunto; le librerie restano nel profilo e non occupano risorse"
      return 0
      ;;
    telegram)
      COMPOSE_PROFILES=telegram compose stop "$TELEGRAM_SERVICE" >/dev/null 2>&1 \
        && COMPOSE_PROFILES=telegram compose rm -f "$TELEGRAM_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="il servizio Telegram non si ferma"; return 1; }
      ;;
    media)
      COMPOSE_PROFILES=media compose stop "$MEDIA_SERVICE" >/dev/null 2>&1 \
        && COMPOSE_PROFILES=media compose rm -f "$MEDIA_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="il container dei media non si ferma"; return 1; }
      integration_marker_clear media ok
      # The image goes with it unless another tool of the extras image is still added (jht-login, jht-screen, when they exist).
      ref="$(integration_extras_ref)"
      if [ -n "$ref" ] && ! integration_marker_read linkedin-login ok >/dev/null && ! integration_marker_read screen ok >/dev/null; then
        docker rmi "$ref" >/dev/null 2>&1 || true
      fi
      ;;
    linkedin-login)
      linkedin_remove_all || { INTEGRATION_WHY="i container dell'accesso a LinkedIn non si fermano"; return 1; }
      ;;
    screen)
      COMPOSE_PROFILES=screen compose stop "$SCREEN_SERVICE" >/dev/null 2>&1 \
        && COMPOSE_PROFILES=screen compose rm -f "$SCREEN_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="il container dello schermo non si ferma"; return 1; }
      integration_marker_clear screen ok
      ref="$(integration_extras_ref)"
      if [ -n "$ref" ] && ! integration_marker_read linkedin-login ok >/dev/null && ! integration_marker_read media ok >/dev/null; then
        docker rmi "$ref" >/dev/null 2>&1 || true
      fi
      ;;
    mail)
      # An older compose still starts the broker with `jht up`: removing it there would only be undone by the next start.
      awk -v head="  $BROKER_SERVICE:" '$0 == head { in_service = 1; next } in_service && /^  [^ ]/ { exit } in_service && /^    profiles:/ { found = 1 } END { exit !found }' \
        "$COMPOSE_FILE" 2>/dev/null || { INTEGRATION_WHY="non disponibile ancora"; return 3; }
      COMPOSE_PROFILES=broker compose stop "$BROKER_SERVICE" >/dev/null 2>&1 \
        && COMPOSE_PROFILES=broker compose rm -f "$BROKER_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="il broker della posta non si ferma"; return 1; }
      rm -f -- "$BROKER_WANTED_MARKER"
      ;;
  esac
  if [ "$2" = 1 ]; then
    for volume in $(integration_volumes_of "$1"); do
      rc=0
      integration_volume_present "$volume" || rc=$?
      [ "$rc" -ne 0 ] || {
        id="$(compose_project_name)_$volume"
        docker volume rm "$id" >/dev/null 2>&1 || { INTEGRATION_WHY="un volume non si cancella: $volume"; return 1; }
      }
    done
    if [ "$1" = screen ]; then
      INTEGRATION_WHY="container e immagine tolti; la cartella del display condivisa con jht e' stata cancellata"
    elif [ "$1" = media ]; then
      INTEGRATION_WHY="container e immagine tolti; le due cartelle di scambio con jht restano (sono di jht e non contengono i tuoi file)"
    elif [ "$1" = mail ]; then
      INTEGRATION_WHY="container e stato del broker cancellati; la password della posta e le credenziali dei portali restano nel volume dei segreti (jht reset --scope creds)"
    else
      INTEGRATION_WHY="container e dati cancellati"
    fi
  elif [ "$1" = screen ]; then
    INTEGRATION_WHY="schermo spento e container tolto"
  elif [ "$1" = linkedin-login ]; then
    INTEGRATION_WHY="container tolti; la sessione di LinkedIn nel profilo resta (jht reset --scope creds la toglie)"
  else
    INTEGRATION_WHY="container tolto; i dati restano (per cancellarli: --purge --yes)"
  fi
  return 0
}

# add|remove, with the run marked as in progress and the outcome left for the next status.
integration_change() { # action id json purge
  local action="$1" id="$2" json="$3" purge="$4" rc=0
  if integration_not_yet "$id"; then integration_result "$json" "$id" 3 "non disponibile ancora"; return $?; fi
  integration_dir_ready || { integration_result "$json" "$id" 1 "cartella dei marcatori non sicura"; return $?; }
  integration_marker_write "$id" pending "$$" || { integration_result "$json" "$id" 1 "marcatore non scritto"; return $?; }
  integration_marker_clear "$id" error
  if [ "$action" = add ]; then integration_do_add "$id" || rc=$?; else integration_do_remove "$id" "$purge" || rc=$?; fi
  integration_marker_clear "$id" pending
  [ "$rc" -eq 0 ] || { [ "$rc" -eq 3 ] || integration_marker_write "$id" error "$INTEGRATION_WHY" || true; }
  integration_result "$json" "$id" "$rc" "$INTEGRATION_WHY"
}

# ── Entry point ───────────────────────────────────────────────────────────
integration_usage() {
  err "uso: jht integration list [--json] | status [<id>] [--json] | add <id> [--json] | remove <id> [--purge --yes] [--json]"
  err "id: $INTEGRATION_IDS"
  return 2
}

integration_main() {
  local action="${1:-}" id="" json=0 purge=0 yes=0 arg
  [ "$#" -gt 0 ] && shift
  case "$action" in list|status|add|remove) ;; *) integration_usage; return $? ;; esac
  for arg in "$@"; do
    case "$arg" in
      --json) json=1 ;;
      --purge) [ "$action" = remove ] || { integration_usage; return $?; }; purge=1 ;;
      --yes) [ "$action" = remove ] || { integration_usage; return $?; }; yes=1 ;;
      -*) integration_usage; return $? ;;
      *) [ -z "$id" ] || { integration_usage; return $?; }; id="$arg" ;;
    esac
  done
  if [ "$action" = list ] && [ -n "$id" ]; then integration_usage; return $?; fi
  if [ "$action" != list ] && [ "$action" != status ] && [ -z "$id" ]; then integration_usage; return $?; fi
  if [ -n "$id" ] && ! integration_id_valid "$id"; then err "integrazione sconosciuta. id ammessi: $INTEGRATION_IDS"; return 2; fi
  if [ "$purge" = 1 ] && [ "$yes" = 0 ]; then err "--purge cancella i dati dell'integrazione: serve anche --yes"; return 2; fi
  [ "$yes" = 0 ] || [ "$purge" = 1 ] || { integration_usage; return $?; }

  case "$action" in
    list) integration_list "$json" ;;
    status)
      if [ -n "$id" ]; then integration_print_status "$json" "$id"; else integration_list "$json"; fi
      ;;
    add|remove)
      integration_not_yet "$id" || require_docker
      integration_change "$action" "$id" "$json" "$purge"
      ;;
  esac
}


# ── `jht linkedin login|status` ───────────────────────────────────────────
# The manual sign-in to LinkedIn: three containers of the profile `login` (shared/login/). The line the desktop app reads is the one the
# view prints (login_view.py grant); here it is only checked in its exact shape, so nothing else ever reaches the app as a token.
LOGIN_SERVICE="jht-login"
LOGIN_PROXY_SERVICE="jht-login-proxy"
LOGIN_VIEW_SERVICE="jht-login-view"
LOGIN_SERVICES="$LOGIN_PROXY_SERVICE $LOGIN_VIEW_SERVICE $LOGIN_SERVICE"
LINKEDIN_REASONS="view_busy view_unavailable login_timeout token_expired chromium_sandbox_unavailable"

# On Docker (Linux, Colima, Docker Desktop) the browser of the sign-in runs under a seccomp profile of ours: the default profile of Docker plus
# the user, pid and net namespaces the sandbox of Chromium makes (shared/login/seccomp/, tests/test_login_seccomp_profile.py). The default
# one refuses them, and the browser would not start. The profile ships in the extras image, which is pinned by digest, and its digest is here,
# in the helper the wrapper attests: the copy kept in the runtime folder next to the compose file is checked against it at every start and
# taken again from the image when it differs, and with no matching copy the sign-in does not start (it reports chromium_sandbox_unavailable).
# Podman keeps its own default profile, which lets the sandbox through: nothing changes there. Never `seccomp=unconfined`.
LOGIN_SECCOMP_SHA256="5f5ac5bbb2f97aa4b866ba5fa83a2dc9f8b7ddfd725cc1d2949f2c6e245a68c7"
LOGIN_SECCOMP_IN_IMAGE="/app/shared/login/seccomp/jht-login.json"
login_seccomp_path() { printf '%s\n' "$RUNTIME_DIR/jht-login-seccomp.json"; }
login_seccomp_overlay_path() { printf '%s\n' "$RUNTIME_DIR/docker-compose.login-seccomp.yml"; }

# The profile and the overlay file that gives it to jht-login (and to nothing else), both in the runtime folder, which the agents do not
# mount. The folder is an absolute path, and a name that would not stay one string in YAML is refused (see below).
linkedin_seccomp_ensure() {
  local ref="$1" target overlay tmp content
  target="$(login_seccomp_path)"; overlay="$(login_seccomp_overlay_path)"
  # The folder name goes into a double-quoted YAML string and is read back by Compose: a space is fine (the default folder on a Mac has two),
  # what would end the string or be read as something else is not: a quote, a backslash, a dollar, a colon, a hash, any control character.
  case "$RUNTIME_DIR" in
    ''|/|*[[:cntrl:]]*|*'"'*|*\\*|*'$'*|*:*|*'#'*) return 1 ;;
    /*) ;;
    *) return 1 ;;
  esac
  [ ! -L "$target" ] && [ ! -L "$overlay" ] || return 1
  if ! { [ -f "$target" ] && [ "$(runtime_sha256 "$target")" = "$LOGIN_SECCOMP_SHA256" ]; }; then
    tmp="$(mktemp "$target.XXXXXX")" || return 1
    if docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --user 1001:1001 \
         --entrypoint cat "$ref" "$LOGIN_SECCOMP_IN_IMAGE" > "$tmp" 2>/dev/null \
       && [ "$(runtime_sha256 "$tmp")" = "$LOGIN_SECCOMP_SHA256" ]; then
      chmod 0644 "$tmp" && mv -f "$tmp" "$target" || { rm -f "$tmp"; return 1; }
    else
      rm -f "$tmp"
      return 1
    fi
  fi
  content="services:
  $LOGIN_SERVICE:
    security_opt:
      - \"seccomp:$target\""
  if ! { [ -f "$overlay" ] && [ "$(cat "$overlay" 2>/dev/null)" = "$content" ]; }; then
    tmp="$(mktemp "$overlay.XXXXXX")" || return 1
    { printf '%s\n' "$content" > "$tmp" && mv -f "$tmp" "$overlay"; } || { rm -f "$tmp"; return 1; }
  fi
  printf '%s\n' "$overlay"
}

linkedin_base() { printf '%s' "${JHT_HOME_HOST:-$HOME/.jht}"; }
linkedin_profile_dir() { printf '%s/secrets/linkedin-profile' "$(linkedin_base)"; }

# Nothing, or a plain folder, at every step under ~/.jht down to the profile: never a link (the folder is mounted writable in the browser
# container, and the agents of the team container write under ~/.jht).
linkedin_profile_ok() {
  local path
  for path in "$(linkedin_base)" "$(linkedin_base)/secrets" "$(linkedin_profile_dir)"; do
    [ ! -L "$path" ] && { [ ! -e "$path" ] || [ -d "$path" ]; } || return 1
  done
}

linkedin_profile_make() {
  linkedin_profile_ok || return 1
  (
    umask 077
    [ -d "$(linkedin_base)" ] || mkdir -p -- "$(linkedin_base)"
    [ -d "$(linkedin_base)/secrets" ] || mkdir -- "$(linkedin_base)/secrets"
    [ -d "$(linkedin_profile_dir)" ] || mkdir -- "$(linkedin_profile_dir)"
  ) 2>/dev/null && linkedin_profile_ok
}

linkedin_fail() { printf '{"ok": false, "reason": "%s"}\n' "$1"; }

linkedin_grant_line_ok() {
  printf '%s' "$1" | grep -Eq '^\{"ok": true, "port": 6081, "path": "/websockify", "token": "[A-Za-z0-9_-]{43}", "expires_at": "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", "session": "[0-9a-f]{1,32}"\}$'
}

# The reason of a failure line of the view, from the closed list, or nothing.
linkedin_reason_of() {
  local reason
  reason="$(printf '%s' "$1" | sed -n 's/^{"ok": false, "reason": "\([a-z_]*\)"}$/\1/p')"
  case " $LINKEDIN_REASONS " in *" $reason "*) printf '%s' "$reason" ;; esac
}

linkedin_any_running() {
  local svc
  for svc in $LOGIN_SERVICES; do
    read_only_service_id "$svc" >/dev/null 2>&1 && return 0
  done
  return 1
}

linkedin_remove_all() {
  local svc rc=0
  for svc in $LOGIN_SERVICES; do
    COMPOSE_PROFILES=login compose stop "$svc" >/dev/null 2>&1 || rc=1
    COMPOSE_PROFILES=login compose rm -f "$svc" >/dev/null 2>&1 || rc=1
  done
  return $rc
}

linkedin_login() {
  local ref line reason id tries
  docker_reachable || { err "il motore dei container non risponde"; linkedin_fail view_unavailable; return 1; }
  ref="$(integration_extras_ref)"
  [ -n "$ref" ] || { err "non disponibile ancora"; linkedin_fail view_unavailable; return 1; }
  if linkedin_any_running; then linkedin_fail view_busy; return 1; fi
  linkedin_remove_all   # what an ended session left, stopped
  linkedin_profile_make || { err "il profilo di LinkedIn in ~/.jht non e' una cartella normale (un collegamento?): non lo uso"; linkedin_fail view_unavailable; return 1; }
  docker pull "$ref" >/dev/null 2>&1 || { err "download dell'immagine degli strumenti non riuscito"; linkedin_fail view_unavailable; return 1; }
  # Checked again right before the up (the pull took time): what is left is the instant between this test and the mount of the engine.
  linkedin_profile_ok && [ -d "$(linkedin_profile_dir)" ] \
    || { err "il profilo di LinkedIn in ~/.jht non e' una cartella normale (un collegamento?): non lo uso"; linkedin_fail view_unavailable; return 1; }
  local overlay=""
  if [ "${CONTAINER_RUNTIME:-docker}" != "podman" ]; then
    overlay="$(linkedin_seccomp_ensure "$ref")" \
      || { err "il profilo seccomp del browser di accesso non c'e' o non coincide con quello attestato: non parto"; linkedin_fail chromium_sandbox_unavailable; return 1; }
  fi
  JHT_EXTRAS_IMAGE="$ref" COMPOSE_PROFILES=login COMPOSE_EXTRA_FILE="$overlay" compose up -d $LOGIN_SERVICES >/dev/null 2>&1 \
    || { linkedin_remove_all; linkedin_fail view_unavailable; return 1; }
  for tries in $(seq 1 40); do
    id="$(read_only_service_id "$LOGIN_VIEW_SERVICE" 2>/dev/null)" || id=""
    line=""
    if [ -n "$id" ]; then
      line="$(docker exec "$id" python3 /app/shared/login/login_view.py grant 2>/dev/null | tail -n 1)" || line=""
    fi
    if linkedin_grant_line_ok "$line"; then printf '%s\n' "$line"; return 0; fi
    reason="$(linkedin_reason_of "$line")"
    case "$reason" in
      ""|view_unavailable)
        # the browser is not ready yet (the token is not used up): ask again, unless the containers are gone
        if [ "$tries" -gt 3 ] && ! linkedin_any_running; then break; fi
        sleep "${LINKEDIN_POLL_SECONDS:-1}" ;;
      *) linkedin_remove_all; linkedin_fail "$reason"; return 1 ;;
    esac
  done
  linkedin_remove_all
  linkedin_fail view_unavailable
  return 1
}

linkedin_stop() {
  linkedin_remove_all || { linkedin_fail view_unavailable; return 1; }
  printf '{"ok": true}\n'
}

# How the last session ended, from the exit code the engine keeps of the stopped view.
linkedin_last_reason() {
  local code
  code="$(docker inspect -f '{{.State.ExitCode}}' "$LOGIN_VIEW_SERVICE" 2>/dev/null)" || return 0
  case "$code" in
    10) printf 'logged_in' ;;
    11) printf 'login_timeout' ;;
    12) printf 'token_expired' ;;
    13) printf 'stopped' ;;
  esac
}

linkedin_status() {
  local id view="idle" out last="" word ref linkedin="login_required"
  docker_reachable || { linkedin_fail view_unavailable; return 1; }
  if id="$(read_only_service_id "$LOGIN_VIEW_SERVICE" 2>/dev/null)"; then
    out="$(docker exec "$id" python3 /app/shared/login/login_view.py status 2>/dev/null | tail -n 1)" || out=""
    case "$out" in
      *'"view": "waiting"'*) view=waiting ;;
      *'"view": "connected"'*) view=connected ;;
    esac
  else
    last="$(linkedin_last_reason)"
  fi
  ref="$(integration_extras_ref)"
  if [ -n "$ref" ] && [ ! -L "$(linkedin_profile_dir)" ] && [ -d "$(linkedin_profile_dir)" ] && linkedin_profile_ok && docker image inspect "$ref" >/dev/null 2>&1; then
    word="$(JHT_EXTRAS_IMAGE="$ref" COMPOSE_PROFILES=login compose run --rm --no-deps -T --entrypoint python3 "$LOGIN_SERVICE" /app/shared/login/login_session.py check /linkedin-profile 2>/dev/null | tail -n 1)" || word=""
    [ "$word" != logged_in ] || linkedin=logged_in
  fi
  if [ -n "$last" ]; then
    printf '{"ok": true, "view": "%s", "linkedin": "%s", "last_session": {"reason": "%s"}}\n' "$view" "$linkedin" "$last"
  else
    printf '{"ok": true, "view": "%s", "linkedin": "%s"}\n' "$view" "$linkedin"
  fi
}

linkedin_main() {
  case "$*" in
    "login") require_docker; linkedin_login ;;
    "login --stop") require_docker; linkedin_stop ;;
    "status --json") linkedin_status ;;
    *) err "uso: jht linkedin login [--stop] | status --json"; return 2 ;;
  esac
}

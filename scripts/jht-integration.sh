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
#   not_installed (non installato) | downloading (in scaricamento) | ready (pronto) | running (acceso) | error (errore),
#   always with a `reason` of one line.
# Exit: 0 done · 1 failed · 2 wrong use · 3 not available yet.

INTEGRATION_IDS="google telegram mail linkedin-login screen media"
INTEGRATION_NOT_YET="linkedin-login screen media"

integration_label() {
  case "$1" in
    not_installed) printf 'non installato' ;;
    downloading) printf 'in scaricamento' ;;
    ready) printf 'pronto' ;;
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
  local id="$1" service volume rc=0 line
  if integration_not_yet "$id"; then printf 'not_installed|non disponibile ancora\n'; return 0; fi
  if integration_pending "$id"; then printf 'downloading|operazione in corso\n'; return 0; fi
  if [ "$id" = google ]; then
    if integration_marker_read google ok >/dev/null; then printf 'ready|librerie di Google aggiunte al profilo\n'; return 0; fi
  else
    read -r service volume <<< "$(integration_service_of "$id")"
    docker_reachable || { printf 'error|il motore dei container non risponde\n'; return 0; }
    read_only_service_id "$service" >/dev/null 2>&1 || rc=$?
    case "$rc" in
      0) printf 'running|container acceso\n'; return 0 ;;
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

integration_do_add() { # id → 0 done · 1 failed (reason in INTEGRATION_WHY)
  local out
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
    mail)
      COMPOSE_PROFILES=broker compose up -d "$BROKER_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="il broker della posta non parte"; return 1; }
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
  esac
}

integration_do_remove() { # id purge → 0 done · 1 failed
  local volume rc id
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
    mail)
      # The broker is part of `jht up` until it is made on request: removing it now would only be undone by the next start.
      awk -v head="  $BROKER_SERVICE:" '$0 == head { in_service = 1; next } in_service && /^  [^ ]/ { exit } in_service && /^    profiles:/ { found = 1 } END { exit !found }' \
        "$COMPOSE_FILE" 2>/dev/null || { INTEGRATION_WHY="non disponibile ancora"; return 3; }
      COMPOSE_PROFILES=broker compose stop "$BROKER_SERVICE" >/dev/null 2>&1 \
        && COMPOSE_PROFILES=broker compose rm -f "$BROKER_SERVICE" >/dev/null 2>&1 \
        || { INTEGRATION_WHY="il broker della posta non si ferma"; return 1; }
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
    if [ "$1" = mail ]; then
      INTEGRATION_WHY="container e stato del broker cancellati; la password della posta e le credenziali dei portali restano nel volume dei segreti (jht reset --scope creds)"
    else
      INTEGRATION_WHY="container e dati cancellati"
    fi
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

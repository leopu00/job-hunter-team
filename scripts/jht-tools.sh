#!/usr/bin/env bash
# jht-tools.sh — the tools of the full image, pulled in the background after the install (P4).
#
# A LIBRARY, not a program: the host wrapper loads it with `source` after checking its sha256 against the runtime manifest
# (RUNTIME_HELPERS) and calls tools_main from its `tools)` arm.
# It uses what the wrapper has: RUNTIME_DIR, RUNTIME_TIER_FILE,
# RUNTIME_TIER_INTEGRITY, DEFAULT_RUNTIME_IMAGE (the full image), CORE_IMAGE_DIGEST, WRAPPER_PATH, err.
#
#   jht tools status --json   one line: {"ok":true,"state":"none|pending|pulling|ready|failed","tier":"core|full","reason":"<code>"}
#   jht tools pull            starts the pull of the full image, detached; already pulling or pulled: exit 0 and nothing else
#   jht tools switch          the full image takes the place of the core one, with an `up`; exit 0 and nothing printed until
#                             the profile is ready (profile/ready.flag) and the full image is here
#
# tools_kick is what the wrapper calls on `jht up` and `jht setup` of a core install: it keeps the tools moving on a computer
# with the CLI only, as the round of the desktop app does (desktop/src-tauri/src/tools_tier.rs). It starts one detached job, at
# most, that pulls the full image when it is not here yet, waits for profile/ready.flag and then makes the switch itself, once no
# other `jht` command runs: `down` of the core team, the tier goes, `up` on the full image (a team the person stopped stays
# stopped); a switch that fails is written down for `jht up` and `jht status` to say, with the commands to give.
#
# The state comes from the engine and from the host files of the runtime, never from a file the container can write. The file
# $JHT_HOME/state/tools.json is a NOTICE for the container (the Capitano reads it): nothing here reads it back.
# JHT_RUNTIME_HELPER=1

TOOLS_STATE_DIR="${JHT_HOME_HOST:-$HOME/.jht}/state"
TOOLS_LOCK="$RUNTIME_DIR/.tools-pull.lock"
TOOLS_FAILED_FILE="$RUNTIME_DIR/.tools-pull-failed"
TOOLS_SWITCH_FAILED_FILE="$RUNTIME_DIR/.tools-switch-failed"
# The switch under way (down of the core team, up on the full one): the pid of the job. `jht team chat` reads it when its REPL ends,
# to tell the person why (the REPL runs in the container, and the down ends it).
TOOLS_SWITCHING_FILE="$RUNTIME_DIR/.tools-switching"

tools_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# The tier of this install: `core` while the runtime-tier file is there, `full` otherwise (the image of before).
tools_tier() { if [ -f "$RUNTIME_TIER_FILE" ]; then printf 'core\n'; else printf 'full\n'; fi; }

tools_engine_up() { docker info >/dev/null 2>&1; }

tools_full_here() { docker image inspect "$DEFAULT_RUNTIME_IMAGE" --format '{{.Id}}' >/dev/null 2>&1; }

# A pull is under way when the lock has a live process behind it (a lock with no pid yet is young: the parent writes it right
# after the fork; two minutes without one and the parent is gone).
tools_pulling() {
  local pid
  [ -d "$TOOLS_LOCK" ] || return 1
  pid="$(cat "$TOOLS_LOCK/pid" 2>/dev/null)"
  if [ -n "$pid" ]; then kill -0 "$pid" 2>/dev/null; return; fi
  [ -z "$(find "$TOOLS_LOCK" -maxdepth 0 -mmin +2 2>/dev/null)" ]
}

# state tier reason since -> the notice for the container, written whole (tmp + rename), readable by the container user.
tools_notice() {
  local state="$1" tier="$2" reason="$3" since="${4:-}" tmp target="$TOOLS_STATE_DIR/tools.json"
  # $JHT_HOME is the folder the container writes in: a link in place of `state` or of tools.json must not send the notice somewhere
  # else, and what is there must be a real folder and a plain file. (No owner check: the container makes files in `state` too, and
  # the user it runs as may not be this one.)
  [ ! -L "$TOOLS_STATE_DIR" ] || return 0
  mkdir -p "$TOOLS_STATE_DIR" 2>/dev/null || return 0
  [ -d "$TOOLS_STATE_DIR" ] && [ ! -L "$TOOLS_STATE_DIR" ] || return 0
  if [ -e "$target" ] || [ -L "$target" ]; then [ -f "$target" ] && [ ! -L "$target" ] || return 0; fi
  tmp="$(mktemp "$TOOLS_STATE_DIR/.tools.json.XXXXXX")" || return 0
  printf '{"schema":1,"state":"%s","tier":"%s","reason":"%s","since":"%s","updated":"%s"}\n' \
    "$state" "$tier" "$reason" "$since" "$(tools_now)" > "$tmp" && chmod 644 "$tmp" \
    && [ ! -L "$TOOLS_STATE_DIR" ] && mv -f "$tmp" "$target" || rm -f "$tmp"
}

# state and reason as the engine and the host files say them.
tools_state() {
  tools_engine_up || { printf 'error engine_unreachable\n'; return; }
  if [ ! -f "$RUNTIME_TIER_FILE" ]; then printf 'none\n'
  elif tools_full_here; then printf 'ready\n'
  elif tools_pulling; then printf 'pulling\n'
  elif [ -s "$TOOLS_FAILED_FILE" ]; then printf 'failed %s\n' "$(head -c 40 "$TOOLS_FAILED_FILE" | tr -cd 'a-z_')"
  else printf 'pending\n'
  fi
}

tools_status_json() {
  local state reason="" tier
  read -r state reason <<EOF
$(tools_state)
EOF
  tier="$(tools_tier)"
  if [ "$state" = error ]; then printf '{"ok":false,"error":"%s"}\n' "$reason"; return 0; fi
  printf '{"ok":true,"state":"%s","tier":"%s","reason":"%s"}\n' "$state" "$tier" "$reason"
}

# The pull itself, in the background: its end is on disk (the image, or the failed marker), and in the notice. With `auto` (the
# job tools_kick starts) it goes on: it waits for the profile and makes the switch, holding the lock, so a second `jht up` finds
# the job there and starts no other.
tools_pull_job() {
  local since="$1" auto="${2:-}"
  trap '' HUP
  if tools_full_here || { docker pull "$DEFAULT_RUNTIME_IMAGE" >/dev/null 2>&1 && tools_full_here; }; then
    rm -f "$TOOLS_FAILED_FILE"; tools_notice ready core "" "$since"
    [ "$auto" = auto ] && tools_wait_and_switch
  else
    printf 'pull_failed\n' > "$TOOLS_FAILED_FILE"; tools_notice failed core pull_failed "$since"
  fi
  rm -rf "$TOOLS_LOCK"
}

# One job at a time, detached. $1 = `auto` for the job of tools_kick (it pulls if needed, then switches by itself).
tools_start_job() {
  local auto="${1:-}" since
  since="$(tools_now)"
  rm -rf "$TOOLS_LOCK"
  mkdir "$TOOLS_LOCK" 2>/dev/null || return 0  # another call won the race: it is the one pulling
  rm -f "$TOOLS_FAILED_FILE"
  tools_full_here || { [ -n "$auto" ] || printf 'JHT_PHASE tools_pull\n'; tools_notice pulling core "" "$since"; }
  tools_pull_job "$since" "$auto" </dev/null >/dev/null 2>&1 &
  printf '%s\n' "$!" > "$TOOLS_LOCK/pid"
  disown "$!" 2>/dev/null || true
}

tools_pull() {
  [ -f "$RUNTIME_TIER_FILE" ] || return 0
  tools_engine_up || { err "tools: il motore dei container non risponde"; return 1; }
  if tools_full_here; then rm -f "$TOOLS_FAILED_FILE"; tools_notice ready core "" "$(tools_now)"; return 0; fi
  tools_pulling && return 0
  tools_start_job
}

# `jht up` / `jht setup` of a core install: the job that pulls and switches, unless one is already there. Prints nothing (the
# wrapper says what it means for the person, from tools_person_state); never fails the command it rides on.
tools_kick() {
  # on the full image (the tier file gone) an `up` that got here went well: a switch that had failed is over
  [ -f "$RUNTIME_TIER_FILE" ] || { rm -f "$TOOLS_SWITCH_FAILED_FILE"; return 0; }
  tools_engine_up || return 0
  tools_pulling && return 0
  tools_start_job auto
  return 0
}

# The job waits for the profile (the onboarding has closed), then a little more, so the switch does not cut the last answers of
# the onboarding short; the tier file gone means someone made the switch by hand (`jht tools switch`).
tools_wait_and_switch() {
  local flag="${JHT_HOME_HOST:-$HOME/.jht}/profile/ready.flag" step="${JHT_TOOLS_WAIT_STEP:-15}" left="${JHT_TOOLS_WAIT_MAX:-86400}"
  while [ "$left" -gt 0 ]; do
    [ -f "$RUNTIME_TIER_FILE" ] || return 0
    if [ -f "$flag" ] && [ ! -L "$flag" ]; then
      sleep "${JHT_TOOLS_SWITCH_GRACE:-30}"
      tools_switch_auto
      return 0
    fi
    sleep "$step"
    left=$((left - step))
  done
}

# Another `jht` command of this computer that changes the runtime is running (setup, up, down, an upgrade...): the switch waits for
# it, never in the middle of it. Only those: a command that reads or talks (`jht team chat` of the onboarding, logs, status, doctor,
# help...) does not hold the switch back, or the REPL the person keeps open after the onboarding kept the full team away for the
# whole half hour. The list is of what counts, not of what does not: a new command does not hold the switch until it is named here.
tools_command_changes_runtime() {
  case "${1:-}" in
    setup|up|start-container|down|stop-container|restart|recreate|upgrade|uninstall|reset|migrate-runtime|podman-machine-recreate) return 0 ;;
    config) [ "${2:-}" = set ] ;;
    providers) [ "${2:-}" = use ] || [ "${2:-}" = harness ] ;;
    integration) [ "${2:-}" = add ] || [ "${2:-}" = remove ] ;;
    tools) [ "${2:-}" = pull ] || [ "${2:-}" = switch ] ;;
    *) return 1 ;;
  esac
}

# The job is a child of the wrapper that started it, with the same command line: its own process is left out, and so are its own
# children (the subshell of a command substitution is a fork with the same command line, and pgrep only leaves itself out).
tools_other_wrapper_running() {
  # bash 3.2 (the system bash of macOS) has no BASHPID, and $$ in a subshell is still the wrapper's: the parent of a new sh is
  # this process (exec, so no subshell of the command substitution comes in between)
  local me="${BASHPID:-$(exec sh -c 'echo "$PPID"')}" pids pid parent line command sub
  pids="$(pgrep -f -- "$WRAPPER_PATH" 2>/dev/null)" || return 1
  for pid in $pids; do
    [ "$pid" = "$me" ] && continue
    [ "$pid" = "$$" ] && continue
    parent="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [ -n "$parent" ] || continue          # gone already
    [ "$parent" = "$me" ] && continue     # a child of this job (the subshell of the command substitution above)
    line="$(ps -ww -o args= -p "$pid" 2>/dev/null)" || continue   # -ww: whole, never cut at the width of a terminal
    case "$line" in *"$WRAPPER_PATH"*) ;; *) continue ;; esac
    # the words after the wrapper's path: the command and its first argument
    read -r command sub _ <<EOF
${line#*"$WRAPPER_PATH"}
EOF
    tools_command_changes_runtime "$command" "$sub" && return 0
  done
  return 1
}

tools_wait_quiet() {
  local left="${JHT_TOOLS_QUIET_MAX:-1800}"
  while tools_other_wrapper_running && [ "$left" -gt 0 ]; do sleep 2; left=$((left - 2)); done
}

# The switch of the job, when no other command runs. A team the person stopped (`jht down`) stays stopped: only the tier goes, and
# the next `jht up` starts on the full image. A team that runs is stopped FIRST, while the tier file still makes it the attested
# core container, then the tier goes and `up` starts it on the full one: never a window in which the running container is the
# core one and the wrapper already expects the full one (the commands of the person in that window refused it as not ours).
# Refused still: the marker says so, and `jht up` / `jht status` tell the person to run `jht down` and `jht up`.
tools_switch_auto() {
  local stopped=0
  tools_wait_quiet
  [ -f "$RUNTIME_TIER_FILE" ] || return 0
  if declare -F team_stopped_by_person >/dev/null 2>&1 && team_stopped_by_person; then stopped=1; fi
  rm -f "$TOOLS_SWITCH_FAILED_FILE"
  unset JHT_IMAGE
  if [ "$stopped" -eq 0 ]; then
    printf '%s\n' "${BASHPID:-$(exec sh -c 'echo "$PPID"')}" > "$TOOLS_SWITCHING_FILE"
    "$WRAPPER_PATH" down </dev/null >/dev/null 2>&1 || true
  fi
  rm -f "$RUNTIME_TIER_FILE" && rm -f "$RUNTIME_TIER_INTEGRITY" || { rm -f "$TOOLS_SWITCHING_FILE"; return 0; }
  if [ "$stopped" -eq 1 ]; then
    tools_notice ready full "" "$(tools_now)"
  elif "$WRAPPER_PATH" up </dev/null >/dev/null 2>&1; then
    tools_notice ready full "" "$(tools_now)"
  else
    printf 'switch_failed\n' > "$TOOLS_SWITCH_FAILED_FILE"
    tools_notice failed full switch_failed "$(tools_now)"
  fi
  rm -f "$TOOLS_SWITCHING_FILE"
}

# What the wrapper tells the person, one word: arriving (pulling or waiting), failed (the pull), switch_failed, or nothing.
tools_person_state() {
  if [ -s "$TOOLS_SWITCH_FAILED_FILE" ] && [ ! -f "$RUNTIME_TIER_FILE" ]; then printf 'switch_failed\n'; return 0; fi
  [ -f "$RUNTIME_TIER_FILE" ] || return 0
  tools_engine_up || return 0
  if tools_full_here; then printf 'waiting\n'
  elif tools_pulling; then printf 'arriving\n'
  elif [ -s "$TOOLS_FAILED_FILE" ]; then printf 'failed\n'
  else printf 'arriving\n'
  fi
}

# The switch: the tier file goes (and the manifest stops attesting it), then an `up` on the image of the compose, the full one.
tools_switch() {
  local flag="${JHT_HOME_HOST:-$HOME/.jht}/profile/ready.flag"
  [ -f "$RUNTIME_TIER_FILE" ] || return 0
  [ -f "$flag" ] && [ ! -L "$flag" ] || return 0
  tools_engine_up && tools_full_here || return 0
  # The file first, its integrity second: a crash between them leaves an integrity without a file, which reads as the whole image.
  rm -f "$RUNTIME_TIER_FILE" && rm -f "$RUNTIME_TIER_INTEGRITY" || { err "tools: livello del runtime non tolto"; return 1; }
  unset JHT_IMAGE
  "$WRAPPER_PATH" up || return $?
  tools_notice ready full "" "$(tools_now)"
  printf 'JHT_PHASE tools_ready\n'
}

tools_main() {
  case "${1:-}:${2:-}" in
    status:--json) tools_status_json ;;
    pull:) tools_pull ;;
    switch:) tools_switch ;;
    *) err "uso: jht tools status --json | pull | switch"; return 2 ;;
  esac
}

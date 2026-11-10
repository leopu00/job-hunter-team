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
# The state comes from the engine and from the host files of the runtime, never from a file the container can write. The file
# $JHT_HOME/state/tools.json is a NOTICE for the container (the Capitano reads it): nothing here reads it back.
# JHT_RUNTIME_HELPER=1

TOOLS_STATE_DIR="${JHT_HOME_HOST:-$HOME/.jht}/state"
TOOLS_LOCK="$RUNTIME_DIR/.tools-pull.lock"
TOOLS_FAILED_FILE="$RUNTIME_DIR/.tools-pull-failed"

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

# The pull itself, in the background: its end is on disk (the image, or the failed marker), and in the notice.
tools_pull_job() {
  local since="$1"
  trap '' HUP
  if docker pull "$DEFAULT_RUNTIME_IMAGE" >/dev/null 2>&1 && tools_full_here; then
    rm -f "$TOOLS_FAILED_FILE"; tools_notice ready core "" "$since"
  else
    printf 'pull_failed\n' > "$TOOLS_FAILED_FILE"; tools_notice failed core pull_failed "$since"
  fi
  rm -rf "$TOOLS_LOCK"
}

tools_pull() {
  local since
  [ -f "$RUNTIME_TIER_FILE" ] || return 0
  tools_engine_up || { err "tools: il motore dei container non risponde"; return 1; }
  since="$(tools_now)"
  if tools_full_here; then rm -f "$TOOLS_FAILED_FILE"; tools_notice ready core "" "$since"; return 0; fi
  tools_pulling && return 0
  rm -rf "$TOOLS_LOCK"
  mkdir "$TOOLS_LOCK" 2>/dev/null || return 0  # another call won the race: it is the one pulling
  rm -f "$TOOLS_FAILED_FILE"
  printf 'JHT_PHASE tools_pull\n'
  tools_notice pulling core "" "$since"
  tools_pull_job "$since" </dev/null >/dev/null 2>&1 &
  printf '%s\n' "$!" > "$TOOLS_LOCK/pid"
  disown "$!" 2>/dev/null || true
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

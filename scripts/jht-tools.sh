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

# ── Room for the full image, and the old images of JHT ─────────────────────────────────────────────────────────────────────────
# The full image is about 3.4 GB, and pulling it took some 6 GiB of a Mac (the disk of the Podman machine grows on the Mac's own):
# on giro Mac m21 an update went from 10 to 2 GiB free, the old images of the version before still there. The pull goes only when
# what stays free AFTER it keeps the agents above their threshold (disk_room_after_download in the wrapper, the threshold of
# disk_low): a pull that left the disk under it made every agent refuse to start (giro Mac build8). When the room is short, the old
# images of JHT go first (tools_clean_old_images); still short, nothing is pulled and the person is told (state `disk_low`, said by
# `jht up`, `jht setup` and `jht status`; `jht up` tries again). Space that cannot be measured refuses nothing. What the pull takes
# is pull_need_kib full (JHT_PULL_FULL_GIB).
tools_pull_need_kib() {
  if declare -F pull_need_kib >/dev/null 2>&1; then pull_need_kib full; else printf '%s\n' $((6 * 1048576)); fi
}

# The old images of JHT go, by the rules of the cleaning after `jht upgrade` (upgrade_prune_old_images in the wrapper: only the
# repositories of JHT by exact name, never an image of a container even stopped, by ID and without -f, never prune, never volumes,
# JHT_KEEP_OLD_IMAGES=1 keeps them all). Kept: the image the container runs, the core image of this version and, while the tier
# file is there, the full one. Only when the container runs on this version's core or full image, and never while an upgrade runs
# or waits to be resumed (its previous version is its way back). The KiB it freed in TOOLS_FREED_KIB.
TOOLS_FREED_KIB=0
# Then the machine trims its disk, whatever the cleaning did: a pull leaves layers behind too.
tools_clean_old_images() {
  tools_remove_old_images
  tools_trim_machine
}

tools_remove_old_images() {
  local running core_id full_id freed
  TOOLS_FREED_KIB=0
  declare -F upgrade_prune_old_images >/dev/null 2>&1 && declare -F upgrade_image >/dev/null 2>&1 || return 0
  [ -e "$RUNTIME_DIR/.upgrade.lock" ] || [ -e "$RUNTIME_DIR/.upgrade-journal" ] && return 0
  running="$(upgrade_image_plain "$(upgrade_image)")"
  [ -n "$running" ] || return 0
  core_id="$(docker image inspect --format '{{.Id}}' "ghcr.io/leopu00/jht@$CORE_IMAGE_DIGEST" 2>/dev/null | head -n 1)"
  full_id="$(docker image inspect --format '{{.Id}}' "$DEFAULT_RUNTIME_IMAGE" 2>/dev/null | head -n 1)"
  core_id="$(upgrade_image_plain "$core_id")" full_id="$(upgrade_image_plain "$full_id")"
  [ "$running" = "$core_id" ] || [ "$running" = "$full_id" ] || return 0
  UPGRADE_JSON=1 upgrade_prune_old_images "$running" "${core_id:-$running}" >/dev/null 2>&1 || true
  freed="$(printf '%s' "${UPGRADE_PRUNE_JSON:-}" | sed -n 's/.*"freedBytes":\([0-9][0-9]*\).*/\1/p')"
  TOOLS_FREED_KIB=$(( ${freed:-0} / 1024 ))
}

# What was freed inside the Podman machine of a Mac (old images, the layers a pull leaves behind) goes back to the Mac only when
# the machine trims its disk: the weekly timer did it days later, and on giro Mac m21 the disk image grew to 11 GiB and the Mac
# went from 11.3 to 3.8 GiB free. fstrim runs now, in the machine of JHT only. A trim that fails changes nothing (the timer stays).
tools_trim_machine() {
  local podman_bin
  [ "${PODMAN_RUNTIME_MODE:-}" = machine ] && [ -n "${PODMAN_MACHINE_NAME:-}" ] || return 0
  declare -F podman_binary >/dev/null 2>&1 || return 0
  podman_bin="$(podman_binary)" || return 0
  "$podman_bin" machine ssh "$PODMAN_MACHINE_NAME" sudo fstrim -a </dev/null >/dev/null 2>&1 || return 0
}

# 0 when there is room for the pull, or it cannot be measured. What counts is the disk of this computer, measured again after the
# old images went and the machine trimmed its disk: never the space freed inside the machine, which the Mac may not get back.
tools_disk_room() {
  declare -F disk_room_after_download >/dev/null 2>&1 || return 0
  disk_room_after_download "$(tools_pull_need_kib)" && return 0
  tools_clean_old_images
  disk_room_after_download "$(tools_pull_need_kib)"
}

# One job at a time, detached. $1 = `auto` for the job of tools_kick (it pulls if needed, then switches by itself).
tools_start_job() {
  local auto="${1:-}" since
  since="$(tools_now)"
  rm -rf "$TOOLS_LOCK"
  mkdir "$TOOLS_LOCK" 2>/dev/null || return 0  # another call won the race: it is the one pulling
  rm -f "$TOOLS_FAILED_FILE"
  if ! tools_full_here && ! tools_disk_room; then
    printf 'disk_low\n' > "$TOOLS_FAILED_FILE"; tools_notice failed core disk_low "$since"
    rm -rf "$TOOLS_LOCK"
    return 0
  fi
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

tools_mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }

# ready.flag means «the team starts», not «the onboarding is over»: the Assistente sets it with three fields and goes on asking.
# The switch stops the container the conversation runs in, so it waits for the first of: profile/onboarding-done.flag, which the
# Assistente writes when its questions are over or the person says to stop (skill profile-yaml), or JHT_TOOLS_ONBOARDING_MAX
# seconds (1800) since ready.flag. The flag is the container's: it only says WHEN, and a link in its place is not believed.
tools_wait_onboarding_done() {
  local flag="$1" cap="${JHT_TOOLS_ONBOARDING_MAX:-1800}" step="${JHT_TOOLS_WAIT_STEP:-15}"
  local done_flag="${JHT_HOME_HOST:-$HOME/.jht}/profile/onboarding-done.flag" since now
  since="$(tools_mtime "$flag")" || since="$(date +%s)"
  while :; do
    [ -f "$RUNTIME_TIER_FILE" ] || return 0
    [ -f "$done_flag" ] && [ ! -L "$done_flag" ] && return 0
    now="$(date +%s)"
    [ $((now - since)) -ge "$cap" ] && return 0
    sleep "$step"
  done
}

# The job waits for the profile (the onboarding has closed), then a little more, so the switch does not cut the last answers of
# the onboarding short; the tier file gone means someone made the switch by hand (`jht tools switch`).
tools_wait_and_switch() {
  local flag="${JHT_HOME_HOST:-$HOME/.jht}/profile/ready.flag" step="${JHT_TOOLS_WAIT_STEP:-15}" left="${JHT_TOOLS_WAIT_MAX:-86400}"
  while [ "$left" -gt 0 ]; do
    [ -f "$RUNTIME_TIER_FILE" ] || return 0
    if [ -f "$flag" ] && [ ! -L "$flag" ]; then
      sleep "${JHT_TOOLS_SWITCH_GRACE:-30}"
      tools_wait_onboarding_done "$flag"
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
# children (the subshell of a command substitution is a fork with the same command line, and pgrep only leaves itself out). The
# wrapper that started it is NOT left out: $$ in the job is that wrapper's pid, and when it is the `jht setup` of an update (the
# profile already there, so the job switches as soon as the pull ends) the switch recreated the container under its wizard, which
# died with 137 (giro Mac m21). The command found is in TOOLS_RUNNING_COMMAND, for tools_wait_quiet.
TOOLS_RUNNING_COMMAND=""

# The pid namespace of a process (Linux), or nothing where there is none to read (macOS, a process gone, one not ours).
tools_pid_ns() { readlink "/proc/$1/ns/pid" 2>/dev/null; }

tools_other_wrapper_running() {
  # bash 3.2 (the system bash of macOS) has no BASHPID, and $$ in a subshell is still the wrapper's: the parent of a new sh is
  # this process (exec, so no subshell of the command substitution comes in between)
  local me="${BASHPID:-$(exec sh -c 'echo "$PPID"')}" pids pid parent line command sub ancestors="" my_ns
  # the pgrep of macOS leaves out the ancestors of the caller unless told -a, and the `jht setup` that started the job is one
  # (procps on Linux leaves out none, and its -a is another option: the full command line)
  [ "$(uname -s 2>/dev/null)" = Darwin ] && ancestors="-a"
  # Only this user's processes, and on Linux only those of this pid namespace: with a rootful Docker the host sees the
  # processes of the containers too, and one of them with «<wrapper path> setup» on its command line held the switch for a day.
  my_ns="$(tools_pid_ns "$me")"
  pids="$(pgrep $ancestors -u "$(id -u)" -f -- "$WRAPPER_PATH" 2>/dev/null)" || return 1
  for pid in $pids; do
    [ "$pid" = "$me" ] && continue
    if [ -n "$my_ns" ] && [ "$(tools_pid_ns "$pid")" != "$my_ns" ]; then continue; fi
    parent="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
    [ -n "$parent" ] || continue          # gone already
    [ "$parent" = "$me" ] && continue     # a child of this job (the subshell of the command substitution above)
    line="$(ps -ww -o args= -p "$pid" 2>/dev/null)" || continue   # -ww: whole, never cut at the width of a terminal
    case "$line" in *"$WRAPPER_PATH"*) ;; *) continue ;; esac
    # the words after the wrapper's path: the command and its first argument
    read -r command sub _ <<EOF
${line#*"$WRAPPER_PATH"}
EOF
    if tools_command_changes_runtime "$command" "$sub"; then TOOLS_RUNNING_COMMAND="$command"; return 0; fi
  done
  return 1
}

# A command that changes the runtime holds the switch for JHT_TOOLS_QUIET_MAX seconds (1800) at most; a `jht setup` for as long as
# it runs (JHT_TOOLS_SETUP_MAX, a day): its wizard waits for the person, and a switch under it ends it all the same, half an hour on.
tools_wait_quiet() {
  local left="${JHT_TOOLS_QUIET_MAX:-1800}" setup_left="${JHT_TOOLS_SETUP_MAX:-86400}"
  # a value that is not a whole number of seconds is the default, never «no wait» (a failed test of [ -gt ] read as «over»)
  case "$left" in ''|*[!0-9]*) left=1800 ;; esac
  case "$setup_left" in ''|*[!0-9]*) setup_left=86400 ;; esac
  while tools_other_wrapper_running; do
    if [ "$TOOLS_RUNNING_COMMAND" = setup ]; then
      [ "$setup_left" -gt 0 ] || return 0
      setup_left=$((setup_left - 2))
    else
      [ "$left" -gt 0 ] || return 0
      left=$((left - 2))
    fi
    sleep 2
  done
}

# The switch of the job, when no other command runs. A team the person stopped (`jht down`) stays stopped: only the tier goes, and
# the next `jht up` starts on the full image. A team that runs is stopped FIRST, while the tier file still makes it the attested
# core container, then the tier goes and `up` starts it on the full one: never a window in which the running container is the
# core one and the wrapper already expects the full one (the commands of the person in that window refused it as not ours).
# Refused still: the marker says so, and `jht up` / `jht status` tell the person to run `jht down` and `jht up`.
tools_switch_auto() {
  local stopped=0 up=0
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
    up=1
  else
    printf 'switch_failed\n' > "$TOOLS_SWITCH_FAILED_FILE"
    tools_notice failed full switch_failed "$(tools_now)"
  fi
  rm -f "$TOOLS_SWITCHING_FILE"
  # the switch is over (a chat that ended reads it from .tools-switching): then the old images go
  [ "$up" -eq 0 ] || tools_clean_old_images
}

# What the wrapper tells the person, one word: arriving (pulling or waiting), failed (the pull), disk_low (no room for the pull),
# switch_failed, or nothing.
tools_person_state() {
  if [ -s "$TOOLS_SWITCH_FAILED_FILE" ] && [ ! -f "$RUNTIME_TIER_FILE" ]; then printf 'switch_failed\n'; return 0; fi
  [ -f "$RUNTIME_TIER_FILE" ] || return 0
  tools_engine_up || return 0
  if tools_full_here; then printf 'waiting\n'
  elif tools_pulling; then printf 'arriving\n'
  elif [ "$(head -c 40 "$TOOLS_FAILED_FILE" 2>/dev/null | tr -cd 'a-z_')" = disk_low ]; then printf 'disk_low\n'
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
  tools_clean_old_images
  printf 'JHT_PHASE tools_ready\n'
}

tools_main() {
  case "${1:-}:${2:-}" in
    status:--json) tools_status_json ;;
    # one line for the person: the words are the wrapper's (tools_say_status in jht-wrapper.sh, the 7 languages)
    status:) if declare -F tools_say_status >/dev/null 2>&1; then tools_say_status; else tools_status_json; fi ;;
    pull:) tools_pull ;;
    switch:) tools_switch ;;
    *) err "uso: jht tools status --json | pull | switch"; return 2 ;;
  esac
}

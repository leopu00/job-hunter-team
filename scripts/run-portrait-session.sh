#!/usr/bin/env bash
# Run a recorder (or its browser launcher) against an isolated landscape or
# vertical session, never the caller's desktop PipeWire graph.
#
# The source process is already owned by the portrait systemd unit.  Reading
# its /proc environment keeps the session route dynamic: a host rebuild can
# change socket names without teaching this helper any private value.  Only
# the five routing keys are imported; their values are intentionally never
# printed or persisted here.
#
# Examples (run on the ThinkPad, never from the physical desktop session):
#   scripts/run-portrait-session.sh --session vertical -- \
#     python3 "$HOME/.cache/jht-e2e/setup_timing.py" ... mutter-node-live ...
#   scripts/run-portrait-session.sh --session vertical \
#     --browser-entrypoint -- --format portrait
#
# `--browser-entrypoint` only discovers and executes the existing temporary
# launcher.  It never edits it.  A normal `-- COMMAND` invocation is what the
# recorder route uses.

set -euo pipefail

readonly DEFAULT_LAUNCHER_ROOT="/tmp/rel004-thinkpad"
readonly -a ROUTE_KEYS=(
  "DBUS_SESSION_BUS_ADDRESS"
  "XDG_RUNTIME_DIR"
  "WAYLAND_DISPLAY"
  "XDG_CURRENT_DESKTOP"
  "PIPEWIRE_REMOTE"
)

die() {
  printf 'portrait-session: %s\n' "$*" >&2
  exit 2
}

usage() {
  cat >&2 <<'USAGE'
Usage:
  run-portrait-session.sh --session (landscape|vertical) [--launcher-root DIR] -- COMMAND [ARG...]
  run-portrait-session.sh --session (landscape|vertical) --browser-entrypoint [-- browser args]

Test-only:
  run-portrait-session.sh --source-pid PID --proc-root FAKE_PROC -- COMMAND [ARG...]

The helper reads only the isolated session routing environment and verifies its
PipeWire graph before execing the command.  It does not deploy or edit a unit,
browser launcher, or recorder.
USAGE
  exit 2
}

normalize_path() {
  # Keep this lexical normalization alongside `cd -P` below.  It lets the
  # test-only gate reject spellings such as /proc/../proc even on hosts where
  # procfs is unavailable, while `cd -P` catches symlinks on the recording
  # host.
  local input="$1" component
  local -a input_parts=() normalized_parts=()

  if [[ "$input" != /* ]]; then
    input="$(pwd -P)/$input"
  fi
  IFS='/' read -r -a input_parts <<< "$input"
  for component in "${input_parts[@]}"; do
    case "$component" in
      ''|.) ;;
      ..)
        if [ "${#normalized_parts[@]}" -gt 0 ]; then
          normalized_parts=("${normalized_parts[@]:0:${#normalized_parts[@]} - 1}")
        fi
        ;;
      *) normalized_parts+=("$component") ;;
    esac
  done

  local IFS='/'
  printf '/%s' "${normalized_parts[*]}"
}

session=""
source_pid=""
proc_root="/proc"
launcher_root="$DEFAULT_LAUNCHER_ROOT"
browser_entrypoint=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --session)
      [ "$#" -ge 2 ] || usage
      session="$2"
      shift 2
      ;;
    --source-pid)
      [ "$#" -ge 2 ] || usage
      source_pid="$2"
      shift 2
      ;;
    --proc-root)
      [ "$#" -ge 2 ] || usage
      proc_root="$2"
      shift 2
      ;;
    --launcher-root)
      [ "$#" -ge 2 ] || usage
      launcher_root="$2"
      shift 2
      ;;
    --browser-entrypoint)
      browser_entrypoint=true
      shift
      ;;
    --)
      shift
      break
      ;;
    -h|--help)
      usage
      ;;
    *)
      usage
      ;;
  esac
done

if [ -n "$session" ] && [ -n "$source_pid" ]; then
  die 'choose exactly one of --session or the test-only --source-pid'
fi
if [ -z "$session" ] && [ -z "$source_pid" ]; then
  die 'an isolated portrait session is required'
fi

if [ -n "$session" ]; then
  case "$session" in
    landscape|vertical) ;;
    *) die 'session must be landscape or vertical' ;;
  esac
  command -v systemctl >/dev/null 2>&1 || die 'systemctl is required for --session'
  source_unit="rel004-${session}-pipewire.service"
  source_pid="$(systemctl --user show --property=MainPID --value "$source_unit")"
else
  # Compare both normalized and physical directories: `/proc/`,
  # `/proc/../proc`, and a symlink into `/proc` are still the live process
  # table and must never make the test-only PID escape hatch usable.
  normalized_proc_root="$(normalize_path "$proc_root")"
  case "$normalized_proc_root" in
    /proc|/proc/*) die '--source-pid is only available with a test proc root' ;;
  esac
  canonical_proc_root="$(cd -P -- "$proc_root" 2>/dev/null && pwd -P)" \
    || die 'test proc root is unavailable'
  case "$canonical_proc_root" in
    /proc|/proc/*) die '--source-pid is only available with a test proc root' ;;
  esac
  proc_root="$canonical_proc_root"
fi
case "$source_pid" in
  ''|0|*[!0-9]*) die 'portrait source has no live MainPID' ;;
esac

environ_path="$proc_root/$source_pid/environ"
[ -r "$environ_path" ] || die 'portrait source environment is unavailable'

route_environment=()
for key in "${ROUTE_KEYS[@]}"; do
  eval "seen_${key}=false"
done

# /proc/<pid>/environ is NUL-delimited.  Reading it directly avoids `ps` and
# systemd logs, either of which could expose the route values we are carrying.
while IFS= read -r -d '' item; do
  key="${item%%=*}"
  case "$key" in
    DBUS_SESSION_BUS_ADDRESS|XDG_RUNTIME_DIR|WAYLAND_DISPLAY|XDG_CURRENT_DESKTOP|PIPEWIRE_REMOTE)
      route_environment+=("$item")
      eval "seen_${key}=true"
      ;;
  esac
done < "$environ_path"

# PipeWire's default remote is deliberately represented by an *absent*
# PIPEWIRE_REMOTE.  Preserve that absence by removing a potentially stale
# caller value; XDG_RUNTIME_DIR still selects the isolated pipewire-0 socket.
for key in DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR WAYLAND_DISPLAY XDG_CURRENT_DESKTOP; do
  eval "present=\$seen_${key}"
  [ "$present" = true ] || die "portrait source is missing ${key}"
done
eval "has_pipewire_remote=\$seen_PIPEWIRE_REMOTE"
if [ "$has_pipewire_remote" != true ]; then
  unset PIPEWIRE_REMOTE
fi

if [ "$browser_entrypoint" = true ]; then
  entrypoints=()
  while IFS= read -r -d '' candidate; do
    entrypoints+=("$candidate")
  done < <(find "$launcher_root" -type f -path '*/e2e/scripts/open-recording-browser.mjs' -print0 2>/dev/null)
  [ "${#entrypoints[@]}" -eq 1 ] || die 'expected exactly one existing portrait browser entrypoint'
  command=(node "${entrypoints[0]}" "$@")
else
  [ "$#" -gt 0 ] || die 'a recorder command is required after --'
  command=("$@")
fi

# `pw-cli` uses exactly the environment that GStreamer will inherit.  This is
# a no-capture preflight: a failed graph never reaches `pipewiresrc` or creates
# an MKV, which makes the previous zero-buffer route fail closed.
if ! env "${route_environment[@]}" pw-cli info 0 >/dev/null 2>&1; then
  die 'the inherited portrait PipeWire graph is not reachable'
fi

printf '%s\n' 'portrait session route verified; starting requested command' >&2
exec env "${route_environment[@]}" "${command[@]}"

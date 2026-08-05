#!/usr/bin/env bash
# Verify a closed G16-H attempt package after the canonical portal/window take.
#
# This wrapper is intentionally post-capture only: it discovers evidence already
# written by E2E and delegates to the Python gate.  It has no recorder, portal,
# PipeWire, or controller-start path.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: run-g16-h-recorder-regression.sh --attempt-dir DIR [--report FILE]

Require one complete closed G16-H evidence package and write a privacy-safe
gate report. This command never opens a portal or starts a recording.
EOF
  exit 2
}

die() {
  printf 'g16-h regression: %s\n' "$1" >&2
  exit 2
}

attempt_dir=''
report=''

while [ "$#" -gt 0 ]; do
  case "$1" in
    --attempt-dir)
      [ "$#" -ge 2 ] || usage
      attempt_dir="$2"
      shift 2
      ;;
    --report)
      [ "$#" -ge 2 ] || usage
      report="$2"
      shift 2
      ;;
    --help|-h)
      usage
      ;;
    *)
      usage
      ;;
  esac
done

[ -n "$attempt_dir" ] || usage
[ -d "$attempt_dir" ] || die 'attempt directory is missing'

locate_one() {
  local label="$1"
  local pattern="$2"
  local -a matches=()
  local item
  while IFS= read -r -d '' item; do
    matches+=("$item")
  done < <(find "$attempt_dir" -maxdepth 1 -type f -name "$pattern" -print0)
  [ "${#matches[@]}" -eq 1 ] || die "need exactly one ${label}"
  printf '%s\n' "${matches[0]}"
}

video="$(locate_one 'Matroska video' '*.mkv')"
reference="$(locate_one 'I420 reference' '*.reference.i420')"
anchors="$(locate_one 'anchor set' '*.anchors.txt')"
sidecar="$(locate_one 'recorder sidecar' '*.sidecar.json')"
recorder_log="$(locate_one 'recorder log' '*.recorder.log')"
manifest="$(locate_one 'manifest' '*.manifest.json')"

controller_jsons=()
while IFS= read -r -d '' item; do
  controller_jsons+=("$item")
done < <(find "$attempt_dir" -maxdepth 1 -type f -name '*.controller.json' -print0)
if [ "${#controller_jsons[@]}" -gt 0 ]; then
  [ "${#controller_jsons[@]}" -eq 1 ] || die 'need exactly one controller evidence'
  controller="${controller_jsons[0]}"
else
  controller="$(locate_one 'controller evidence' '*.controller.log')"
fi

if [ -z "$report" ]; then
  report="$attempt_dir/g16-h-recorder-regression-report.json"
fi

script_dir="$(cd -P -- "$(dirname -- "$0")" && pwd)"
exec python3 "$script_dir/g16-h-recorder-regression.py" "$video" \
  --reference-i420 "$reference" \
  --anchors "$anchors" \
  --sidecar "$sidecar" \
  --controller "$controller" \
  --recorder-log "$recorder_log" \
  --manifest "$manifest" \
  --report "$report"

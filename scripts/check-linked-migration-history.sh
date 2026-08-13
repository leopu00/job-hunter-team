#!/usr/bin/env bash
# Read-only linked Supabase history check. Raw CLI output is private because it
# may include project URLs, local paths or connection diagnostics.
set +x
set -euo pipefail
umask 077

script_dir="$(cd -P -- "$(dirname -- "$0")" && pwd)"
repo_root="$(cd -P -- "$script_dir/.." && pwd)"
capture_dir="$(mktemp -d "${TMPDIR:-/tmp}/jht-migration-history.XXXXXX")"
cleanup() {
  rm -f -- "$capture_dir/stdout" "$capture_dir/stderr"
  rmdir -- "$capture_dir" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

if ! command -v supabase >/dev/null 2>&1; then
  printf '%s\n' 'migration_gate status=fail stage=linked codes=linked_cli_unavailable:1'
  exit 1
fi

# Fixed read-only argv: no passthrough flags, database URL, repair, push or link.
if ! (cd -- "$repo_root" && supabase migration list --linked --output json) \
  >"$capture_dir/stdout" 2>"$capture_dir/stderr"; then
  printf '%s\n' 'migration_gate status=fail stage=linked codes=linked_cli_failed:1'
  exit 1
fi

python3 "$script_dir/migration_gate.py" linked --input "$capture_dir/stdout"

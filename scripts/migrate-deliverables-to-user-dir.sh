#!/usr/bin/env bash
# One-shot migration of legacy deliverables from $JHT_HOME/agents/<role>[-N]/
# (and the orphan $JHT_HOME/output/) into $JHT_USER_DIR/{cv,critiche,output}.
#
# Background: before RULE-T11 (commit de615c82) Writers and the Critic had no
# canonical destination for their deliverables, so each instance invented its
# own path inside its tmux cwd. This left $JHT_USER_DIR/cv/ empty while
# $JHT_HOME/agents/scrittore-1/cv_output/ accumulated 31 CVs, 87 critiche
# piled up at the root of $JHT_HOME/agents/critico/, etc. This script moves
# the existing files to the canonical layout in one pass.
#
# Idempotent: skips any file already present at the destination (does NOT
# overwrite — the existing copy is treated as authoritative). Safe to re-run.
#
# Pre-conditions: no agent should be active during the run (writers may have
# the source files open). Check with `tmux ls | grep -E 'SCRITTORE|CRITICO'`.
#
# Usage:  scripts/migrate-deliverables-to-user-dir.sh [--dry-run]
set -euo pipefail

JHT_HOME="${JHT_HOME:-$HOME/.jht}"
JHT_USER_DIR="${JHT_USER_DIR:-$HOME/Documents/Job Hunter Team}"

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  echo "DRY-RUN — no files will be moved"
fi

CV_DEST="$JHT_USER_DIR/cv"
CRIT_DEST="$JHT_USER_DIR/critiche"
OUT_DEST="$JHT_USER_DIR/output"

if [ "$DRY_RUN" = 0 ]; then
  mkdir -p "$CV_DEST" "$CRIT_DEST" "$OUT_DEST"
fi

moved=0
skipped=0

# move_file <src> <dst-dir>
# Skips silently if src does not exist; skips with log if dst basename exists.
move_file() {
  local src="$1"
  local dst_dir="$2"
  [ -e "$src" ] || return 0
  local base
  base="$(basename "$src")"
  local dst="$dst_dir/$base"
  if [ -e "$dst" ]; then
    echo "  SKIP (exists at dest): $base"
    skipped=$((skipped + 1))
    return 0
  fi
  echo "  MOVE: $src -> $dst"
  if [ "$DRY_RUN" = 0 ]; then
    mv "$src" "$dst"
  fi
  moved=$((moved + 1))
}

# move_dir_to_subdir <src-dir> <dst-parent>  (preserves the dir name)
# Used for per-position packets to keep their grouping under output/.
move_dir_to_subdir() {
  local src="$1"
  local dst_parent="$2"
  [ -d "$src" ] || return 0
  local base
  base="$(basename "$src")"
  local dst="$dst_parent/$base"
  # If dst exists, fall back to per-file merge (no overwrite).
  if [ -d "$dst" ]; then
    echo "  MERGE into existing: $dst"
    while IFS= read -r f; do
      move_file "$f" "$dst"
    done < <(find "$src" -type f)
    if [ "$DRY_RUN" = 0 ]; then
      find "$src" -type d -empty -delete 2>/dev/null || true
    fi
    return 0
  fi
  echo "  MOVE DIR: $src -> $dst"
  if [ "$DRY_RUN" = 0 ]; then
    mkdir -p "$dst_parent"
    mv "$src" "$dst"
  fi
  moved=$((moved + 1))
}

echo
echo "[1/5] CVs from scrittore-1/cv_output/  ->  $CV_DEST/"
# Only CV_* files: jd_*.txt are scratch JDs the Critic dumped locally, leave them.
if [ -d "$JHT_HOME/agents/scrittore-1/cv_output" ]; then
  while IFS= read -r f; do
    move_file "$f" "$CV_DEST"
  done < <(find "$JHT_HOME/agents/scrittore-1/cv_output" -maxdepth 1 -type f -name 'CV_*')
fi

echo
echo "[2/5] Per-position packets  ->  $OUT_DEST/<scrittore>/"
for role_dir in "$JHT_HOME/agents/scrittore-1/output" \
                "$JHT_HOME/agents/scrittore-2/output" \
                "$JHT_HOME/agents/scrittore-2/cvs" \
                "$JHT_HOME/output/scrittore-3"; do
  [ -d "$role_dir" ] || continue
  # Derive a stable per-writer subdir name from the parent path:
  # .../agents/scrittore-1/output -> scrittore-1
  # .../output/scrittore-3        -> scrittore-3
  parent="$(basename "$(dirname "$role_dir")")"
  case "$parent" in
    scrittore-*) writer="$parent" ;;
    output)      writer="scrittore-3" ;;          # legacy orphan path
    *)           writer="$parent" ;;
  esac
  writer_dest="$OUT_DEST/$writer"
  echo "  scanning $role_dir  ->  $writer_dest/"
  while IFS= read -r d; do
    move_dir_to_subdir "$d" "$writer_dest"
  done < <(find "$role_dir" -mindepth 1 -maxdepth 1 -type d)
done

echo
echo "[3/5] Critiche from critico/ root  ->  $CRIT_DEST/"
if [ -d "$JHT_HOME/agents/critico" ]; then
  while IFS= read -r f; do
    move_file "$f" "$CRIT_DEST"
  done < <(find "$JHT_HOME/agents/critico" -maxdepth 1 -type f -name 'critica-*.md')
fi

echo
echo "[4/5] Reviews from critico/output/  ->  $CRIT_DEST/"
if [ -d "$JHT_HOME/agents/critico/output" ]; then
  while IFS= read -r f; do
    move_file "$f" "$CRIT_DEST"
  done < <(find "$JHT_HOME/agents/critico/output" -maxdepth 1 -type f)
fi

echo
echo "[5/5] Cleanup empty legacy dirs"
if [ "$DRY_RUN" = 0 ]; then
  for d in "$JHT_HOME/agents/scrittore-1/cv_output" \
           "$JHT_HOME/agents/scrittore-1/output" \
           "$JHT_HOME/agents/scrittore-2/output" \
           "$JHT_HOME/agents/scrittore-2/cvs" \
           "$JHT_HOME/agents/critico/output" \
           "$JHT_HOME/output/scrittore-3" \
           "$JHT_HOME/output"; do
    [ -d "$d" ] || continue
    find "$d" -depth -type d -empty -delete 2>/dev/null || true
    [ -d "$d" ] && echo "  KEPT (not empty): $d"
  done
fi

echo
echo "Done. moved=$moved  skipped=$skipped  (dry-run=$DRY_RUN)"

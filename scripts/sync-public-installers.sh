#!/usr/bin/env bash
# Sync canonical installers (scripts/install.sh + scripts/install.ps1) →
# web/public/ cosi' Vercel li serve a jobhunterteam.ai/install.{sh,ps1}.
#
# Origin: WIN-E2E del 2026-05-22 (commit a95fb028 master) ha scoperto che
# jobhunterteam.ai/install.ps1 era 404 perche' install.ps1 esisteva solo
# in scripts/ ma NON in web/public/. Master ha aggiunto la copia + header
# rule in next.config.ts, ma senza automazione le 2 copie possono divergere
# silenziosamente al prossimo edit.
#
# Pattern: scripts/ e' source-of-truth, web/public/ e' mirror "build".
# Run this dopo OGNI edit a scripts/install.{sh,ps1}.
#
# CI gating proposto (post-launch): check `git diff --name-only` su
# scripts/install.* e fail se web/public/install.* non sincronizzati.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="$REPO_ROOT/scripts"
DST_DIR="$REPO_ROOT/web/public"

if [ ! -d "$DST_DIR" ]; then
  echo "error: $DST_DIR non esiste — sei nel repo root?" >&2
  exit 1
fi

changed=0
for name in install.sh install.ps1; do
  src="$SRC_DIR/$name"
  dst="$DST_DIR/$name"
  if [ ! -f "$src" ]; then
    echo "warn: $src non esiste, skip" >&2
    continue
  fi
  if [ ! -f "$dst" ] || ! cmp -s "$src" "$dst"; then
    cp "$src" "$dst"
    echo "✓ synced $name ($src → $dst)"
    changed=$((changed + 1))
  fi
done

if [ "$changed" -eq 0 ]; then
  echo "  (already in sync, nothing to do)"
fi

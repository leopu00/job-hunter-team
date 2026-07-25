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
# CI gating: ATTIVO da 2026-07-24 — tests/test_public_installers_sync.py gira
# nel job `pytest` di .github/workflows/test.yml e fallisce se le due copie
# divergono. Prima il test esisteva ma la suite Python non girava in CI, e il
# drift (source italiano, mirror inglese) e' passato inosservato 3 settimane.
#
# ATTENZIONE — la direzione della copia e' scripts/ → web/public/, MAI il
# contrario: il testo utente-facing e' in inglese ed e' in scripts/ che va
# scritto. Se ti ritrovi un mirror "piu' giusto" del source, la correzione va
# portata a monte prima di lanciare questo script.
#
# QUESTO SCRIPT E' IL buildCommand DI VERCEL (vercel.json, dal 2026-07-25):
# ogni deploy rigenera i due file pubblici dal source, quindi il sito serve
# SEMPRE cio' che sta in scripts/. Prima al suo posto c'era un `cp` del solo
# install.sh (dal 2026-04-11) e questo ha nascosto un problema per mesi: la
# traduzione EN del 2026-07-03 era stata applicata solo a web/public/, cioe'
# proprio al file che il build sovrascriveva → jobhunterteam.ai/install.sh ha
# continuato a servire l'ITALIANO. Ora source, mirror e sito dicono la stessa
# cosa, e il test in CI verifica che il mirror committato non divergano.

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

#!/usr/bin/env bash
# Riprese REALI del gioco per il video di presentazione, con la Movie Maker
# mode di Godot 4 (`--write-movie`): rendering fotogramma per fotogramma,
# deterministico, indipendente dalla velocità della macchina — niente cattura
# schermo, niente permessi macOS, niente frame persi.
#
# La regia in scena è game/tools/promo_director.gd (JHT_PROMO=office|dept|chat):
# testi INVENTATI in inglese, ufficio in showroom (JHT_NOVPS=1), nessun dato
# reale. Le sequenze PNG finiscono in scenes/capture/<clip>/ (gitignored) e
# make_presentation.py le monta nel video.
#
# Uso:
#   tools: richiede `godot` (4.7) nel PATH.
#   ./record_clips.sh            # registra i tre clip (office, dept, chat)
#   ./record_clips.sh office     # uno solo
#
# NB: la finestra di gioco compare piccola in basso a destra (JHT_SHOT_QUIET),
# senza focus e sorda all'input: non ruba la macchina a chi ci lavora.
# Il guard di run.sh contro istanze parallele qui non serve: si registra dal
# worktree corrente e ogni clip è una run che si chiude da sola (--quit-after).

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
GAME_DIR="$(cd "$HERE/../../../game" && pwd)"
CAP="$HERE/scenes/capture"
FPS=30

# frame da registrare per clip (30 fps): la coda extra assorbe l'avvio scena
# (il montaggio scarta i primi ~40 frame di caricamento e usa una finestra
# interna: office 10 s, dept 7 s, chat 9,5 s)
declare -A FRAMES=( [office]=390 [dept]=270 [chat]=340 )

CLIPS=("$@")
if [ ${#CLIPS[@]} -eq 0 ]; then
	CLIPS=(office dept chat)
fi

cd "$GAME_DIR"
echo "[record] import risorse (cache classi fresca)…" >&2
JHT_NOVPS=1 godot --headless --import . >/dev/null 2>&1 || {
	echo "[record] IMPORT KO" >&2; exit 1; }

for clip in "${CLIPS[@]}"; do
	n="${FRAMES[$clip]:?clip sconosciuto: $clip}"
	dir="$CAP/$clip"
	rm -rf "$dir"
	mkdir -p "$dir"
	echo "[record] clip '$clip': $n frame a $FPS fps…" >&2
	# NB: il viewport resta quello di project.godot (1920x1080): il flag
	# --resolution non lo scala. Meglio così: il montaggio riduce a 1280x720.
	JHT_LANG=en JHT_NOVPS=1 JHT_SCENE=office JHT_HOUR=11 \
	JHT_WINDOWED=1 JHT_SHOT_QUIET=1 JHT_PROMO="$clip" \
		godot --path "$GAME_DIR" \
		--write-movie "$dir/f.png" --fixed-fps "$FPS" \
		--quit-after "$n" >/dev/null 2>&1 || true
	got=$(ls "$dir" | grep -c '\.png$' || true)
	if [ "$got" -lt "$n" ]; then
		echo "[record] clip '$clip' KO: attesi $n frame, trovati $got" >&2
		exit 1
	fi
	rm -f "$dir/f.wav"   # la traccia audio del movie writer non serve: video muto
	echo "[record] clip '$clip' OK: $got frame in $dir" >&2
done
echo "[record] FATTO" >&2

#!/usr/bin/env bash
# Avvio e test del gioco SENZA sorprese: la cache classi di Godot
# (.godot/global_script_class_cache.cfg) resta stantia dopo pull/nuovi
# class_name e il gioco muore di parse error silenzioso (successo nel primo
# live-test dell'11/07). Questo script fa sempre un import pulito prima.
#
# Uso:
#   tools/run.sh boot                  # check headless: exit 1 se script error
#   tools/run.sh play                  # lancia il gioco (fullscreen)
#   tools/run.sh shot out.png [ENV..]  # screenshot autonomo e chiude
#                                      #   es: JHT_OVERVIEW=1 JHT_DEPT=scout
# Log di gioco: stampato su stdout e in user://jht-game.log (path nel log).
#
# ⚠️ shot: se la finestra resta occlusa (utente in fullscreen su altra app)
# macOS congela il present e lo screenshot può non arrivare: lo script porta
# la finestra in primo piano da solo.

set -euo pipefail
GAME_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$GAME_DIR"

MODE="${1:-boot}"

# mai due istanze sullo stesso progetto (cache corrotta garantita)
if pgrep -f "godot .*--path $GAME_DIR" >/dev/null 2>&1 \
		|| pgrep -fl "godot" | grep -q "godot --path \.$" 2>/dev/null; then
	echo "[run.sh] c'è già un godot su questo progetto: chiudilo prima (pkill -x godot)" >&2
	exit 2
fi

echo "[run.sh] import risorse/cache classi…" >&2
godot --headless --import . >/dev/null 2>&1 || true

case "$MODE" in
	boot)
		OUT="$(JHT_SCENE=office godot --headless --quit-after 15 . 2>&1 || true)"
		ERRS="$(printf '%s\n' "$OUT" | grep -E "SCRIPT ERROR|Parse Error" || true)"
		if [ -n "$ERRS" ]; then
			printf '%s\n' "$ERRS" >&2
			echo "[run.sh] BOOT KO" >&2
			exit 1
		fi
		echo "[run.sh] BOOT OK"
		;;
	play)
		exec godot --path "$GAME_DIR"
		;;
	shot)
		OUT_PNG="${2:?uso: run.sh shot out.png [VAR=val …]}"
		shift 2
		env "$@" JHT_SCENE=office JHT_WINDOWED=1 JHT_SHOT="$OUT_PNG" \
			godot --path "$GAME_DIR" >/dev/null 2>&1 &
		GPID=$!
		sleep 3
		osascript -e 'tell application "System Events" to set frontmost of (first process whose name is "godot") to true' >/dev/null 2>&1 || true
		# fino a ~4 minuti: JHT_SHOT_DELAY può ritardare lo scatto di molto
		for _ in $(seq 1 120); do
			[ -s "$OUT_PNG" ] && break
			kill -0 "$GPID" 2>/dev/null || break
			sleep 2
		done
		sleep 1
		kill "$GPID" 2>/dev/null || true
		if [ -s "$OUT_PNG" ]; then
			echo "[run.sh] SHOT OK: $OUT_PNG"
		else
			echo "[run.sh] SHOT KO (finestra occlusa? utente in fullscreen?)" >&2
			exit 1
		fi
		;;
	*)
		echo "uso: run.sh boot|play|shot" >&2
		exit 64
		;;
esac

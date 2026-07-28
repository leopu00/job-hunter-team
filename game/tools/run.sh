#!/usr/bin/env bash
# Avvio e test del gioco SENZA sorprese: la cache classi di Godot
# (.godot/global_script_class_cache.cfg) resta stantia dopo pull/nuovi
# class_name e il gioco muore di parse error silenzioso (successo nel primo
# live-test dell'11/07). Questo script fa sempre un import pulito prima.
#
# Uso:
#   tools/run.sh boot                  # check headless: exit 1 se script error
#   tools/run.sh test                  # self-test collisioni/nav postazioni
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

# mai due istanze sullo stesso progetto (cache corrotta garantita), e mai
# in parallelo a un ALTRO worktree: due finestre confondono i test utente
# e lo shot ruba il focus col suo osascript (incrocio del 18:16, 11/07)
if pgrep -f "godot --path.*job-hunter-team" >/dev/null 2>&1 \
		|| pgrep -fl "godot" | grep -q "godot --path \.$" 2>/dev/null; then
	echo "[run.sh] c'è già un godot del progetto (anche altro worktree): chiudilo prima (pkill -x godot)" >&2
	exit 2
fi

echo "[run.sh] import risorse/cache classi…" >&2
if ! IMPORT_OUT="$(JHT_NOVPS=1 godot --headless --import . 2>&1)"; then
	printf '%s\n' "$IMPORT_OUT" >&2
	echo "[run.sh] IMPORT KO" >&2
	exit 1
fi

case "$MODE" in
	test)
		JHT_NOVPS=1 godot --headless --script res://tools/theme_selftest.gd
		VPS_SETUP_OUT="$(JHT_NOVPS=1 JHT_VPS_SETUP_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$VPS_SETUP_OUT" | grep "VPS-SETUP-TEST PASS"
		JHT_NOVPS=1 godot --headless --script res://tools/nav_grid_selftest.gd
		JHT_NOVPS=1 godot --headless --script res://tools/speech_bubble_selftest.gd
		JHT_NOVPS=1 godot --headless --script res://tools/pipeline_queue_selftest.gd
		JHT_NOVPS=1 godot --headless --script res://tools/embedded_terminal_selftest.gd
		JHT_NOVPS=1 godot --headless --script res://tools/terminal_selection_selftest.gd
		JHT_NOVPS=1 godot --headless --script res://tools/budget_notice_selftest.gd
		JHT_NOVPS=1 godot --headless --script res://tools/doc_preview_selftest.gd
		JHT_NOVPS=1 godot --headless --script res://tools/redactor_selftest.gd
		JHT_NOVPS=1 godot --headless --script res://tools/diagnostics_selftest.gd
		JHT_NOVPS=1 godot --headless --script res://tools/i18n_parity_selftest.gd
		python3 tools/python_payload_syntax_test.py
		python3 tools/coordinator_policy_selftest.py
		FEEDBACK_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_FEEDBACK_PANEL_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$FEEDBACK_OUT" | grep "FEEDBACK-PANEL-TEST PASS"
		GUIDED_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_GUIDED_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$GUIDED_OUT" | grep "GUIDED-ONBOARDING-TEST PASS"
		TOUR_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_TOUR_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$TOUR_OUT" | grep "TOUR-TEST PASS"
		VPS_OUT="$(JHT_NOVPS=1 JHT_VPS_CONTRACT_TEST=1 godot --headless --quit-after 3 . 2>&1)"
		printf '%s\n' "$VPS_OUT" | grep "VPS-CONTRACT-TEST PASS"
		CHAT_NOTICE_OUT="$(JHT_NOVPS=1 JHT_CHAT_NOTIFICATION_TEST=1 godot --headless --quit-after 3 . 2>&1)"
		printf '%s\n' "$CHAT_NOTICE_OUT" | grep "CHAT-NOTIFICATION-TEST PASS"
		CHAT_UI_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_CHAT_UI_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$CHAT_UI_OUT" | grep "CHAT-UI-TEST PASS"
		PIPE_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_PIPELINE_FORCE_TEST=scout godot --headless . 2>&1)"
		printf '%s\n' "$PIPE_OUT" | grep "PIPELINE-FORCE-TEST PASS"
		SWITCH_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_BACKEND_SWITCH_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$SWITCH_OUT" | grep "BACKEND-SWITCH-TEST PASS"
		ENTRY_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_ENTRY_TEST=analista godot --headless . 2>&1)"
		printf '%s\n' "$ENTRY_OUT" | grep "ENTRY-CONTINUITY-TEST PASS"
		DOCTOR_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_DOCTOR_TEST=scout-4 godot --headless . 2>&1)"
		printf '%s\n' "$DOCTOR_OUT" | grep "SIMULATION-DOCTOR-TEST PASS"
		WIZ_OUT="$(JHT_SCENE=wizard JHT_NOVPS=1 JHT_WIZARD_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$WIZ_OUT" | grep "WIZARD-TEST PASS"
		CAMERA_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_CAMERA_LOCK_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$CAMERA_OUT" | grep "CAMERA-OVERLAY-LOCK-TEST PASS"
		GFX_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_GFX_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$GFX_OUT" | grep "GFX-PROFILE-TEST PASS"
		JUMP_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_WIZARD_JUMP_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$JUMP_OUT" | grep "WIZARD-JUMP-TEST PASS"
		STUCK_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_STUCK_TEST=scout godot --headless . 2>&1)"
		printf '%s\n' "$STUCK_OUT" | grep "STUCK-TEST PASS"
		TEXT_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_WORLD_TEXT_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$TEXT_OUT" | grep "WORLD-TEXT-TEST PASS"
		GFXPANEL_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_GRAPHICS_PANEL_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$GFXPANEL_OUT" | grep "GRAPHICS-PANEL-TEST PASS"
		POSITIONS_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_POSITIONS_PANEL_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$POSITIONS_OUT" | grep "POSITIONS-PANEL-TEST PASS"
		MAP_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_MAP_PANEL_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$MAP_OUT" | grep "MAP-PANEL-TEST PASS"
		AGENT_UI_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_BACKEND_TEST=1 \
			JHT_THINKING=scout JHT_AGENT_UI_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$AGENT_UI_OUT" | grep "AGENT-UI-TEST PASS"
		USAGE_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_USAGE_PANEL_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$USAGE_OUT" | grep "USAGE-PANEL-TEST PASS"
		COORD_OUT="$(JHT_SCENE=office JHT_NOVPS=1 JHT_BACKEND_TEST=1 \
			JHT_COORDINATOR_TEST=1 godot --headless . 2>&1)"
		printf '%s\n' "$COORD_OUT" | grep "COORDINATOR-CONSOLE-TEST PASS"
		echo "[run.sh] TEST OK"
		;;
	boot)
		set +e
		OUT="$(JHT_SCENE=office JHT_NOVPS=1 godot --headless --quit-after 15 . 2>&1)"
		BOOT_CODE=$?
		set -e
		ERRS="$(printf '%s\n' "$OUT" | grep -E "SCRIPT ERROR|Parse Error|ERROR:" || true)"
		if [ "$BOOT_CODE" -ne 0 ] || [ -n "$ERRS" ]; then
			printf '%s\n' "$OUT" >&2
			echo "[run.sh] Godot exit $BOOT_CODE" >&2
			echo "[run.sh] BOOT KO" >&2
			exit 1
		fi
		printf '%s\n' "$OUT" | grep -E "THROTTLE-TEST|SIMULATION-STATE-TEST" || true
		echo "[run.sh] BOOT OK"
		;;
	play)
		exec godot --path "$GAME_DIR"
		;;
	shot)
		# Shot di verifica SENZA rubare il focus (richiesta Leone 18:3x, un
		# solo schermo): finestra DISCRETA — flag no-focus + angolo in basso
		# a destra (JHT_SHOT_QUIET, vedi game.gd) e focus restituito subito
		# all'app dell'utente. Il vero headless è stato provato e scartato:
		# il DisplayServer headless di Godot non renderizza (PNG mai scritto).
		# La finestra piena resta SOLO per i live-test di Leone (run.sh play).
		OUT_PNG="${2:?uso: run.sh shot out.png [VAR=val …]}"
		shift 2
		FRONT_APP="$(osascript -e 'tell application "System Events" to get name of first process whose frontmost is true' 2>/dev/null || true)"
		env "$@" JHT_SCENE=office JHT_WINDOWED=1 JHT_SHOT="$OUT_PNG" JHT_SHOT_QUIET=1 \
			godot --path "$GAME_DIR" --resolution 1280x720 >/dev/null 2>&1 &
		GPID=$!
		sleep 2
		if [ -n "$FRONT_APP" ]; then
			osascript -e "tell application \"$FRONT_APP\" to activate" >/dev/null 2>&1 || true
		fi
		# fino a ~4 minuti: JHT_SHOT_DELAY può ritardare lo scatto di molto
		for _ in $(seq 1 120); do
			[ -s "$OUT_PNG" ] && break
			kill -0 "$GPID" 2>/dev/null || break
			sleep 2
		done
		sleep 1
		kill "$GPID" 2>/dev/null || true
		if [ -s "$OUT_PNG" ] && python3 "$GAME_DIR/tools/png_not_blank.py" "$OUT_PNG"; then
			echo "[run.sh] SHOT OK: $OUT_PNG"
		else
			echo "[run.sh] SHOT KO (PNG assente o nero: present congelato/finestra occlusa?)" >&2
			exit 1
		fi
		;;
	*)
		echo "uso: run.sh boot|test|play|shot" >&2
		exit 64
		;;
esac

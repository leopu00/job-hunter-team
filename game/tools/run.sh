#!/usr/bin/env bash
# Avvio e test del gioco SENZA sorprese: la cache classi di Godot
# (.godot/global_script_class_cache.cfg) resta stantia dopo pull/nuovi
# class_name e il gioco muore di parse error silenzioso (successo nel primo
# live-test dell'11/07). Questo script fa sempre un import pulito prima.
#
# Uso:
#   tools/run.sh boot                  # check headless: exit 1 se script error
#   tools/run.sh test [gate|watch|all] # selftest da tools/test-matrix.txt
#   tools/run.sh play                  # lancia il gioco (fullscreen)
#   tools/run.sh shot out.png [ENV..]  # screenshot autonomo e chiude
#                                      #   es: JHT_OVERVIEW=1 JHT_DEPT=scout
#
# La lista dei test NON vive qui: sta in tools/test-matrix.txt, unica fonte
# consumata anche da run.ps1 e da .github/workflows/game.yml. Il tier `gate`
# blocca la CI, `watch` e' in osservazione (spiegato nel file), `all` e' il
# default di chi sviluppa. I test si eseguono TUTTI anche dopo un rosso: il
# riepilogo finale vale piu' del secondo risparmiato.
#
# Log di gioco: stampato su stdout e in user://jht-game.log (path nel log).
#
# ⚠️ shot: se la finestra resta occlusa (utente in fullscreen su altra app)
# macOS congela il present e lo screenshot può non arrivare: lo script porta
# la finestra in primo piano da solo.

set -euo pipefail
GAME_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$GAME_DIR"

MODE="${1:-boot}"
TIER="${2:-all}"
MATRIX="$GAME_DIR/tools/test-matrix.txt"

# Esegue una riga della matrice. Ritorna 0/1; l'output del test finisce su
# stderr SOLO se fallisce, altrimenti il log del gate sarebbe illeggibile.
matrix_run_one() {
	local kind="$1" envs="$2" target="$3" marker="$4"
	local out rc=0 extra=""
	# forma `||`: sotto `set -e` una lista `&&` che fallisce fa uscire
	[ "$envs" != "-" ] || envs=""
	[ "$target" = "-" ] || extra="$target"
	case "$kind" in
		script)
			out="$(env JHT_NOVPS=1 $envs godot --headless \
				--script "res://$target" 2>&1)" || rc=$?
			;;
		run)
			# shellcheck disable=SC2086  # env e args sono token voluti
			out="$(env JHT_NOVPS=1 $envs godot --headless $extra . 2>&1)" || rc=$?
			;;
		python)
			out="$(python3 "$target" 2>&1)" || rc=$?
			;;
		*)
			echo "[run.sh] kind sconosciuto '$kind' in test-matrix.txt" >&2
			return 1
			;;
	esac
	if [ "$rc" -eq 0 ] && [ "$marker" != "-" ] \
			&& ! printf '%s\n' "$out" | grep -Fq -- "$marker"; then
		# Uscire 0 senza stampare il marker significa che le asserzioni non
		# sono state eseguite: e' un rosso, non un verde silenzioso.
		rc=1
		out="$out
[run.sh] marker atteso e MAI stampato: $marker"
	fi
	[ "$rc" -eq 0 ] || printf '%s\n' "$out" >&2
	return "$rc"
}

# Legge tools/test-matrix.txt e lancia i test del tier richiesto.
matrix_run() {
	local want="$1"
	local id kind tier platform envs target marker
	local ran=0 failed=0 skipped=0 failed_ids=""
	if [ ! -f "$MATRIX" ]; then
		echo "[run.sh] tools/test-matrix.txt assente: nessun test da eseguire" >&2
		return 1
	fi
	while IFS='|' read -r id kind tier platform envs target marker; do
		case "$id" in ''|'#'*) continue ;; esac
		if [ "$want" != "all" ] && [ "$want" != "$tier" ]; then
			skipped=$((skipped + 1))
			continue
		fi
		ran=$((ran + 1))
		printf '[run.sh] %-22s (%s/%s) …\n' "$id" "$tier" "$kind" >&2
		if matrix_run_one "$kind" "$envs" "$target" "$marker"; then
			printf '[run.sh]   PASS %s\n' "$id" >&2
		else
			printf '[run.sh]   FAIL %s\n' "$id" >&2
			failed=$((failed + 1))
			failed_ids="$failed_ids $id"
		fi
	done < "$MATRIX"
	if [ "$ran" -eq 0 ]; then
		echo "[run.sh] tier '$want' non seleziona nessun test (gate|watch|all)" >&2
		return 1
	fi
	if [ "$failed" -ne 0 ]; then
		echo "[run.sh] TEST KO — $failed/$ran falliti:$failed_ids" >&2
		return 1
	fi
	echo "[run.sh] $ran test verdi (tier=$want, $skipped fuori tier)" >&2
	return 0
}

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
		# Ogni self-test parte da uno stato NOTO, non da quello che gli ha
		# lasciato il test prima (o l'ultima partita vera). La lingua vive in
		# user://lang.cfg e la scrive l'UTENTE da Impostazioni → Lingua:
		# nessun ripristino fatto dai test può metterla al sicuro, perché non
		# sono i test a sporcarla. Le asserzioni della suite sono in italiano
		# ("PAGINA 1 / 3", "SUCCESSIVA ▶"), quindi la lingua va dichiarata
		# come INGRESSO — JHT_LANG ha già la precedenza sul file — invece di
		# essere ereditata. Prima reggeva solo per l'ordine della suite: i tre
		# pannelli, lanciati da soli, cadevano.
		export JHT_LANG=it
		matrix_run "$TIER"
		echo "[run.sh] TEST OK (tier=$TIER)"
		;;
	boot)
		set +e
		OUT="$(JHT_SCENE=office JHT_NOVPS=1 godot --headless --quit-after 15 . 2>&1)"
		BOOT_CODE=$?
		set -e
		# Godot 4.7 headless non esce mai pulito: DOPO che il gioco ha già
		# girato, lo smontaggio del motore stampa "N resources still in use at
		# exit" e "RID allocations … were leaked at exit" — con exit 0. Prese
		# per errori di runtime rendevano questo gate rosso a prescindere dal
		# codice, e un gate sempre rosso non dice niente a nessuno: insegna solo
		# a ignorarlo.
		#
		# Il criterio è POSIZIONALE, non una lista di stringhe da perdonare.
		# Quelle righe arrivano tutte dopo l'ultima riga di gioco, quando il
		# SceneTree è già chiuso e nessuno script può più girare: si taglia il
		# log alla prima riga di smontaggio e si giudica quello che viene PRIMA.
		# Nella coda si tollerano SOLO le forme note di leak, così un errore
		# vero che uscisse là in fondo (un salvataggio che fallisce in uscita,
		# uno SCRIPT ERROR da _exit_tree) continua a far rosso.
		TEARDOWN='(ObjectDB instances were leaked at exit|resources still in use at exit|RID allocations of type .* leaked at exit)'
		RUN_OUT="$(printf '%s\n' "$OUT" | awk -v re="$TEARDOWN" '$0 ~ re { tail = 1 } !tail')"
		EXIT_OUT="$(printf '%s\n' "$OUT" | awk -v re="$TEARDOWN" '$0 ~ re { tail = 1 } tail')"
		ERRS="$(printf '%s\n' "$RUN_OUT" | grep -E "SCRIPT ERROR|Parse Error|ERROR:" || true)"
		ERRS="$ERRS$(printf '%s\n' "$EXIT_OUT" | grep -E "SCRIPT ERROR|Parse Error|ERROR:" \
			| grep -vE "$TEARDOWN" || true)"
		# Terza gamba: un gate che non può più fallire è cieco quanto uno che
		# non può passare. Un avvio muto (scena mai costruita, uscita immediata)
		# non produce errori e passerebbe: qui si pretende la prova che
		# l'ufficio si sia costruito davvero.
		ALIVE="$(printf '%s\n' "$RUN_OUT" | grep -F "[scene] ufficio pronto" || true)"
		if [ "$BOOT_CODE" -ne 0 ] || [ -n "$ERRS" ] || [ -z "$ALIVE" ]; then
			printf '%s\n' "$OUT" >&2
			echo "[run.sh] Godot exit $BOOT_CODE" >&2
			if [ -z "$ALIVE" ]; then
				echo "[run.sh] l'ufficio non si è mai costruito (manca '[scene] ufficio pronto')" >&2
			fi
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
		echo "uso: run.sh boot|test [gate|watch|all]|play|shot" >&2
		exit 64
		;;
esac

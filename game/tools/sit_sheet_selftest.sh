#!/usr/bin/env bash
set -euo pipefail

# Verifica il contratto dei fogli seduti generati per le varianti b-f.
# Ogni cella deve contenere una sola sagoma completa con almeno 8 px di
# trasparenza su tutti i lati: teste, piedi o mani a bordo sono un errore.
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
sheets_dir="$repo_root/game/assets/characters/sheets"
failures=0
checked=0

for role in scout analista scorer scrittore critico; do
	for variant in b c d e f; do
		sheet="$sheets_dir/${role}_${variant}_sit.png"
		if [[ ! -f "$sheet" ]]; then
			echo "[sit-sheet] missing: $sheet" >&2
			failures=$((failures + 1))
			continue
		fi
		read -r width height channels < <(identify -format '%w %h %[channels]\n' "$sheet")
		if [[ "$width" -ne 1024 || "$height" -ne 1152 || "$channels" != *a* ]]; then
			echo "[sit-sheet] invalid canvas: $sheet (${width}x${height}, ${channels})" >&2
			failures=$((failures + 1))
			continue
		fi

		for row in 0 1 2; do
			for col in 0 1 2 3; do
				x_offset=$((col * 256))
				y_offset=$((row * 384))
				bbox="$(magick "$sheet" -crop "256x384+${x_offset}+${y_offset}" +repage \
					-alpha extract -threshold 5% -format '%@' info:)"
				if [[ ! "$bbox" =~ ^([0-9]+)x([0-9]+)\+([0-9]+)\+([0-9]+)$ ]]; then
					echo "[sit-sheet] empty cell: ${role}_${variant} ${row},${col}" >&2
					failures=$((failures + 1))
					continue
				fi
				cell_w="${BASH_REMATCH[1]}"
				cell_h="${BASH_REMATCH[2]}"
				cell_x="${BASH_REMATCH[3]}"
				cell_y="${BASH_REMATCH[4]}"
				if (( cell_x < 8 || cell_y < 8 || cell_x + cell_w > 248 || cell_y + cell_h > 376 )); then
					echo "[sit-sheet] clipped margin: ${role}_${variant} ${row},${col} bbox=$bbox" >&2
					failures=$((failures + 1))
				fi
				components="$(magick "$sheet" -crop "256x384+${x_offset}+${y_offset}" +repage \
					-alpha extract -threshold 5% \
					-define connected-components:verbose=true \
					-connected-components 8 null: 2>&1 \
					| awk '/srgb\(255,255,255\)/ && $4 >= 500 { count++ } END { print count + 0 }')"
				if [[ "$components" -ne 1 ]]; then
					echo "[sit-sheet] fragmented cell: ${role}_${variant} ${row},${col} components=$components" >&2
					failures=$((failures + 1))
				fi
				checked=$((checked + 1))
			done
		done
	done
done

if (( failures > 0 )); then
	echo "[sit-sheet] FAIL: $failures errors across $checked checked cells" >&2
	exit 1
fi

echo "[sit-sheet] PASS: 25 sheets, $checked complete cells"

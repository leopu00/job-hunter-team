#!/usr/bin/env bash
set -euo pipefail

# Normalizza una tavola imagegen 4x3 al contratto SpriteSheetRig:
# 1024x1152, celle 256x384, piedi a y≈360. Ogni cella viene adattata
# separatamente, così canvas sorgente larghi non schiacciano il personaggio.
if [[ $# -ne 2 ]]; then
	echo "usage: $0 INPUT_RGBA OUTPUT_PNG" >&2
	exit 2
fi

input="$1"
output="$2"
sheet_tmp="$(mktemp -d "${TMPDIR:-/tmp}/jht-sit-sheet.XXXXXX")"
cleanup() {
	if [[ -n "${sheet_tmp:-}" && -d "$sheet_tmp" ]]; then
		rm -rf -- "$sheet_tmp"
	fi
}
trap cleanup EXIT

# Griglia intermedia divisibile esattamente per quattro e per tre.
magick "$input" -resize 1344x1152! "$sheet_tmp/source.png"

rows=()
for row in 0 1 2; do
	cells=()
	for col in 0 1 2 3; do
		cell="$sheet_tmp/cell_${row}_${col}.png"
		raw_cell="$sheet_tmp/cell_${row}_${col}_raw.png"
		mask="$sheet_tmp/cell_${row}_${col}_mask.png"
		column="$sheet_tmp/column_${col}.png"
		components="$sheet_tmp/column_${col}_components.txt"
		x=$((col * 336))

		if [[ ! -f "$column" ]]; then
			magick "$sheet_tmp/source.png" -crop "336x1152+${x}+0" +repage "$column"
			magick "$column" -alpha extract -threshold 5% \
				-define connected-components:verbose=true \
				-connected-components 8 null: 2>&1 \
				| awk '
					/srgb\(255,255,255\)/ {
						split($2, box, /[x+]/)
						if ($4 >= 5000) print box[4], box[2]
					}
				' | sort -n > "$components"
			if [[ "$(wc -l < "$components" | tr -d ' ')" -ne 3 ]]; then
				echo "error: expected 3 character silhouettes in column $col of $input" >&2
				cat "$components" >&2
				exit 1
			fi
		fi

		# Imagegen non rispetta sempre i terzi geometrici del canvas: una
		# testa può iniziare decine di pixel prima della fascia prevista.
		# Individua le tre sagome reali della colonna e ritaglia la relativa
		# estensione verticale con 16 px di margine, senza invadere le altre.
		read -r subject_y subject_h < <(sed -n "$((row + 1))p" "$components")
		crop_y=$((subject_y - 16))
		(( crop_y < 0 )) && crop_y=0
		crop_bottom=$((subject_y + subject_h + 16))
		(( crop_bottom > 1152 )) && crop_bottom=1152
		crop_h=$((crop_bottom - crop_y))

		magick "$column" -crop "336x${crop_h}+0+${crop_y}" +repage \
			-trim +repage -filter Lanczos -resize '232x340' \
			-background none -gravity south -extent 256x360 \
			-gravity north -extent 256x384 "$raw_cell"
		# Elimina soltanto micro-frammenti alpha isolati (tipicamente scarpe
		# duplicate fra due righe). Mani, occhiali e calzature reali superano
		# ampiamente questa soglia o sono connessi alla sagoma principale.
		magick "$raw_cell" -alpha extract -threshold 5% \
			-define connected-components:area-threshold=500 \
			-define connected-components:mean-color=true \
			-connected-components 8 -threshold 50% "$mask"
		magick "$raw_cell" "$mask" -compose CopyOpacity -composite "$cell"
		cells+=("$cell")
	done
	row_image="$sheet_tmp/row_${row}.png"
	magick "${cells[@]}" +append +repage "$row_image"
	rows+=("$row_image")
done

mkdir -p "$(dirname "$output")"
magick "${rows[@]}" -append +repage -depth 8 "$output"
identify "$output"

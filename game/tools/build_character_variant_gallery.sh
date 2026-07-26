#!/usr/bin/env bash
set -euo pipefail

# Galleria verificabile del cast di reparto: una tavola 8K con un frame di
# camminata per fronte, retro e profilo. Non dipende da sorgenti temporanee.
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
gallery_tmp="$(mktemp -d "${TMPDIR:-/tmp}/jht-character-gallery.XXXXXX")"
cleanup() {
	if [[ -n "${gallery_tmp:-}" && -d "$gallery_tmp" ]]; then
		rm -rf -- "$gallery_tmp"
	fi
}
trap cleanup EXIT

mkdir -p "$repo_root/tmp"

roles=(scout analista scorer scrittore critico)
titles=(SCOUT ANALISTI SCORER SCRITTORI CRITICI)
variants=(a b c d e f)
angles=(FRONTE RETRO PROFILO)
font_regular='/System/Library/Fonts/Supplemental/Arial.ttf'
font_bold='/System/Library/Fonts/Supplemental/Arial Bold.ttf'

build_frame() {
	local frame="$1"
	local output="$2"
	local panels=()
	for role_i in "${!roles[@]}"; do
		local role="${roles[$role_i]}"
		local title="${titles[$role_i]}"
		local rows=()
		local header="$gallery_tmp/${frame}_${role}_header.png"
		magick -size 1536x160 xc:'#13221e' \
			-fill '#77d7aa' -font "$font_bold" -pointsize 68 \
			-gravity center -annotate +0+0 "$title" "$header"
		rows+=("$header")
		for variant in "${variants[@]}"; do
			local source
			if [[ "$variant" == a ]]; then
				source="$gallery_tmp/${role}_a_walk.png"
				magick "$repo_root/game/assets/characters/sheets/${role}_a.png" \
					-crop 1536x1152+0+1152 +repage "$source"
			else
				source="$repo_root/game/assets/characters/sources/variants/${role}_${variant}_walk.png"
			fi
			local normalized="$gallery_tmp/${frame}_${role}_${variant}_normalized.png"
			magick "$source" -resize 1536x1152! "$normalized"
			local views=()
			for row in 0 1 2; do
				local view="$gallery_tmp/${frame}_${role}_${variant}_${row}.png"
				local crop_x=$((frame * 256))
				local crop_y=$((row * 384))
				magick "$normalized" -crop "256x384+${crop_x}+${crop_y}" +repage \
					-trim +repage -resize '380x500' \
					-background none -gravity south -extent 420x520 "$view"
				views+=("$view")
			done
			local trio="$gallery_tmp/${frame}_${role}_${variant}_trio.png"
			magick "${views[@]}" +append "$trio"
			local cell="$gallery_tmp/${frame}_${role}_${variant}_cell.png"
			magick -size 1536x672 xc:'#192a25' \
				-fill '#d7e7df' -font "$font_bold" -pointsize 50 \
				-gravity northwest -annotate +42+42 "VARIANTE ${variant^^}" \
				-fill '#89a99b' -font "$font_regular" -pointsize 30 \
				-annotate +174+112 "${angles[0]}" \
				-annotate +594+112 "${angles[1]}" \
				-annotate +1014+112 "${angles[2]}" \
				"$trio" -gravity south -geometry +0+18 -composite "$cell"
			rows+=("$cell")
		done
		local panel="$gallery_tmp/${frame}_${role}_panel.png"
		magick "${rows[@]}" -append "$panel"
		panels+=("$panel")
	done
	local body="$gallery_tmp/${frame}_body.png"
	magick "${panels[@]}" +append "$body"
	local titlebar="$gallery_tmp/${frame}_title.png"
	magick -size 7680x128 xc:'#0c1714' \
		-fill '#f0e6cf' -font "$font_bold" -pointsize 58 -gravity center \
		-annotate +0+0 'AGENTI DI REPARTO — CAMMINATA DA TUTTE LE ANGOLATURE' "$titlebar"
	magick "$titlebar" "$body" -append "$output"
}

still="${1:-$repo_root/tmp/agenti-movimento-tutte-angolature-8k.png}"
build_frame 2 "$still"
identify "$still"

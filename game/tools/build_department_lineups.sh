#!/usr/bin/env bash
set -euo pipefail

# Cinque tavole 8K di approvazione: le sei identità di ogni reparto,
# tutte nella stessa posa frontale, alla stessa scala e con lettere A-F.
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
lineup_tmp="$(mktemp -d "${TMPDIR:-/tmp}/jht-department-lineups.XXXXXX")"
cleanup() {
	if [[ -n "${lineup_tmp:-}" && -d "$lineup_tmp" ]]; then
		rm -rf -- "$lineup_tmp"
	fi
}
trap cleanup EXIT

font_regular='/System/Library/Fonts/Supplemental/Arial.ttf'
font_bold='/System/Library/Fonts/Supplemental/Arial Bold.ttf'
roles=(scout analista scorer scrittore critico)
titles=('SCOUT — RICERCATORI' 'ANALISTI' 'SCORER — CONSULENTI' 'SCRITTORI — REDATTORI' 'CRITICI — REVISORI')
person_labels=(Scout Analista Scorer Scrittore Critico)
variants=(a b c d e f)
only_role="${1:-}"

mkdir -p "$repo_root/tmp/approvazione-agenti"

for role_i in "${!roles[@]}"; do
	role="${roles[$role_i]}"
	if [[ -n "$only_role" && "$role" != "$only_role" ]]; then
		continue
	fi
	title="${titles[$role_i]}"
	person_label="${person_labels[$role_i]}"
	cards=()
	for variant_i in "${!variants[@]}"; do
		variant="${variants[$variant_i]}"
		sheet="$repo_root/game/assets/characters/sheets/${role}_${variant}.png"
		figure="$lineup_tmp/${role}_${variant}.png"
		# Prima cella della riga idle-front: figura in piedi e rivolta in camera.
		magick "$sheet" -crop 256x384+0+0 +repage -trim +repage \
			-filter Lanczos -resize '1040x1960' "$figure"
		card="$lineup_tmp/${role}_${variant}_card.png"
		# Fondo neutro: consente di giudicare volto, silhouette e calzature
		# senza il rumore dell'ufficio; il pavimento rende evidente la scala.
		magick -size 1280x2560 gradient:'#20342d-#0c1714' \
			-fill '#09120f' -draw 'rectangle 0,2200 1280,2560' \
			-stroke '#6ad5a0' -strokewidth 8 -draw 'line 0,2200 1280,2200' \
			"$figure" -gravity south -geometry +0+360 -composite \
			-fill '#ff5b57' -font "$font_bold" -pointsize 88 \
			-gravity south -annotate +0+145 "${person_label}$((variant_i + 1))" "$card"
		cards+=("$card")
	done
	body="$lineup_tmp/${role}_body.png"
	magick "${cards[@]}" +append +repage "$body"
	titlebar="$lineup_tmp/${role}_title.png"
	magick -size 7680x320 xc:'#0c1714' \
		-fill '#f0e6cf' -font "$font_bold" -pointsize 138 \
		-gravity center -annotate +0-45 "$title" \
		-fill '#8fb6a5' -font "$font_regular" -pointsize 54 \
		-annotate +0+105 'SEI AGENTI · POSA FRONTALE · STESSA SCALA' "$titlebar"
	output="$repo_root/tmp/approvazione-agenti/${role}-sei-agenti-frontali-8k.png"
	magick "$titlebar" "$body" -append +repage -depth 8 "$output"
done

identify "$repo_root"/tmp/approvazione-agenti/*-sei-agenti-frontali-8k.png

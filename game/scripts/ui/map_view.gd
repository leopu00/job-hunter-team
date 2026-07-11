class_name MapView
extends Control
## La mappa delle offerte con i pin, migrata dalla vista map della
## dashboard web: proiezione equirettangolare dell'Europa su griglia
## terminale, un pin per posizione (città da TeamData, score colorato).
## Usata dalla sezione Mappa della sidebar e dal click sul mappamondo.

## Bounding box Europa: lon -11..26, lat 35..61 (equirettangolare).
const LON_MIN := -11.0
const LON_MAX := 26.0
const LAT_MIN := 35.0
const LAT_MAX := 61.0

## Coordinate delle città note al mock/demo; la versione reale userà i
## geodata della dashboard.
const CITY_COORDS := {
	"Amburgo": Vector2(9.99, 53.55),
	"Milano": Vector2(9.19, 45.46),
	"Berlino": Vector2(13.40, 52.52),
	"Amsterdam": Vector2(4.90, 52.37),
	"Londra": Vector2(-0.13, 51.51),
	"Parigi": Vector2(2.35, 48.86),
	"Madrid": Vector2(-3.70, 40.42),
	"Roma": Vector2(12.50, 41.90),
	"Vienna": Vector2(16.37, 48.21),
	"Zurigo": Vector2(8.54, 47.38),
}

var _pins: Array = []  # [{pos_norm: Vector2, label: String, score: int}]

func _ready() -> void:
	custom_minimum_size = Vector2(0, 480)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	for p in TeamData.positions_today():
		var city: String = str(p.get("location", "")).split(" · ")[0]
		if not CITY_COORDS.has(city):
			Log.debug("ui", "mappa: città senza coordinate: " + city)
			continue
		var c: Vector2 = CITY_COORDS[city]
		_pins.append({
			"pos_norm": Vector2(
				(c.x - LON_MIN) / (LON_MAX - LON_MIN),
				1.0 - (c.y - LAT_MIN) / (LAT_MAX - LAT_MIN)),
			"label": "%s — %s" % [p.get("company", "?"), city],
			"score": int(p.get("score", 0)),
		})
	resized.connect(queue_redraw)

func _draw() -> void:
	var r := Rect2(Vector2.ZERO, size)
	draw_rect(r, Palette.DEEP)
	draw_rect(r, Palette.BORDER_GLOW, false, 1.0)
	# griglia di meridiani/paralleli, jitter zero: è uno strumento
	var step := 60.0
	var x := step
	while x < r.size.x:
		draw_line(Vector2(x, 0), Vector2(x, r.size.y), Color(1, 1, 1, 0.04), 1.0)
		x += step
	var y := step
	while y < r.size.y:
		draw_line(Vector2(0, y), Vector2(r.size.x, y), Color(1, 1, 1, 0.04), 1.0)
		y += step
	# pin: anello + punto + targhetta company/città + score
	var font := TerminalTheme.get_theme().default_font
	for pin in _pins:
		var pos: Vector2 = pin["pos_norm"] * r.size
		var col: Color = Palette.MINT if pin["score"] >= 70 else Palette.YELLOW
		draw_circle(pos, 5.0, col)
		draw_arc(pos, 10.0, 0, TAU, 24, Color(col.r, col.g, col.b, 0.5), 1.5)
		draw_arc(pos, 15.0, 0, TAU, 24, Color(col.r, col.g, col.b, 0.2), 1.0)
		var text := "%s  [%d]" % [pin["label"], pin["score"]]
		draw_string(font, pos + Vector2(20, 5), text,
				HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Palette.BRIGHT)
	if _pins.is_empty():
		draw_string(font, Vector2(24, 40), "nessuna posizione geolocalizzata oggi",
				HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Palette.DIM)

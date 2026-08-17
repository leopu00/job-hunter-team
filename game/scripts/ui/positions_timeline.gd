class_name PositionsTimeline
extends Control
## Grafico temporale compatto delle posizioni trovate, alimentato dallo
## snapshot reale BackendBus.positions. Sette giorni, inclusi gli zeri.

const DAYS := 7
const PAD := Vector2(34, 24)

var accent := Color("#00e87a")
var _labels: Array[String] = []
var _counts: Array[int] = []
var _font: Font

func _init(p_accent := Color("#00e87a")) -> void:
	accent = p_accent
	custom_minimum_size = Vector2(650, 158)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _ready() -> void:
	_font = load(TerminalTheme.FONT_REGULAR)
	set_positions(SimBadge.visible_positions())

func set_positions(rows: Array) -> void:
	_labels.clear()
	_counts.clear()
	var by_day := {}
	var visible_rows: Array = rows \
			if SimBadge.current_state() != SimBadge.DataState.UNAVAILABLE else []
	for p in visible_rows:
		var day := str(p.get("found_at", "")).left(10)
		if day.length() == 10:
			by_day[day] = int(by_day.get(day, 0)) + 1
	var now := int(Time.get_unix_time_from_system())
	for ago in range(DAYS - 1, -1, -1):
		var day := Time.get_date_string_from_unix_time(now - ago * 86400)
		_labels.append(day.substr(5))
		_counts.append(int(by_day.get(day, 0)))
	queue_redraw()

func _draw() -> void:
	var r := Rect2(Vector2.ZERO, size)
	draw_rect(r, Color(Palette.CARD.r, Palette.CARD.g, Palette.CARD.b, 0.92))
	draw_rect(r, Color(accent.r, accent.g, accent.b, 0.30), false, 1.0)
	var plot := Rect2(PAD, size - PAD - Vector2(12, 34))
	for i in 3:
		var y := plot.position.y + plot.size.y * float(i) / 2.0
		draw_line(Vector2(plot.position.x, y), Vector2(plot.end.x, y),
				Color(Palette.BORDER.r, Palette.BORDER.g, Palette.BORDER.b, 0.55), 1.0)
	var peak := 1
	for n in _counts:
		peak = maxi(peak, n)
	var points := PackedVector2Array()
	for i in _counts.size():
		var x := plot.position.x + plot.size.x * float(i) / float(DAYS - 1)
		var y := plot.end.y - plot.size.y * float(_counts[i]) / float(peak)
		points.append(Vector2(x, y))
	if points.size() >= 2:
		draw_polyline(points, accent, 2.5, true)
	for i in points.size():
		draw_circle(points[i], 4.2, accent)
		draw_circle(points[i], 7.0, Color(accent.r, accent.g, accent.b, 0.18), false, 2.0)
		if _font:
			var value := str(_counts[i])
			var vw := _font.get_string_size(value, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
			draw_string(_font, points[i] + Vector2(-vw / 2.0, -9), value,
					HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Palette.BRIGHT)
			var label := _labels[i]
			var lw := _font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 10).x
			draw_string(_font, Vector2(points[i].x - lw / 2.0, size.y - 9), label,
					HORIZONTAL_ALIGNMENT_LEFT, -1, 10, Palette.DIM)

class_name SystemMetricChart
extends Control
## Sparkline infrastrutturale degli ultimi campioni telemetrici.

var metric := "cpu_pct"
var title := "CPU"
var color := Color("#58e68b")
var _history: Array = []
var _font: Font

func _init(p_metric: String, p_title: String, p_color: Color) -> void:
	metric = p_metric
	title = p_title
	color = p_color
	custom_minimum_size = Vector2(310, 150)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _ready() -> void:
	_font = load(TerminalTheme.FONT_REGULAR)
	set_history(BackendBus.telemetry_history)

func set_history(history: Array) -> void:
	_history = history.duplicate()
	queue_redraw()

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(Palette.CARD.r, Palette.CARD.g, Palette.CARD.b, 0.94))
	draw_rect(Rect2(Vector2.ZERO, size), Color(color.r, color.g, color.b, 0.28), false, 1.0)
	if _font:
		draw_string(_font, Vector2(12, 20), title, HORIZONTAL_ALIGNMENT_LEFT,
				-1, 12, Palette.MUTED)
	var plot := Rect2(Vector2(12, 32), size - Vector2(24, 46))
	for i in 3:
		var y := plot.position.y + plot.size.y * float(i) / 2.0
		draw_line(Vector2(plot.position.x, y), Vector2(plot.end.x, y),
				Color(Palette.BORDER.r, Palette.BORDER.g, Palette.BORDER.b, 0.55), 1.0)
	if _history.is_empty():
		return
	var rows: Array = _history.slice(maxi(0, _history.size() - 60))
	var points := PackedVector2Array()
	for i in rows.size():
		var v := clampf(float(rows[i].get(metric, 0.0)), 0.0, 100.0)
		var x := plot.position.x if rows.size() == 1 else \
				plot.position.x + plot.size.x * float(i) / float(rows.size() - 1)
		points.append(Vector2(x, plot.end.y - plot.size.y * v / 100.0))
	if points.size() >= 2:
		draw_polyline(points, color, 2.2, true)
	else:
		draw_circle(points[0], 3.5, color)
	if _font:
		var value := "%.1f%%" % float(rows[-1].get(metric, 0.0))
		var w := _font.get_string_size(value, HORIZONTAL_ALIGNMENT_LEFT, -1, 18).x
		draw_string(_font, Vector2(size.x - w - 12, 22), value,
				HORIZONTAL_ALIGNMENT_LEFT, -1, 18, color)

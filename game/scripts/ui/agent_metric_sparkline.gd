class_name AgentMetricSparkline
extends Control
## Mini grafico per-riga: RAM campionata ogni poll oppure token per bucket.

var key := ""
var mode := "ram"
var color := Color("#58e68b")
var _values: Array[float] = []

func _init(p_key: String, p_mode: String, p_color: Color) -> void:
	key = p_key
	mode = p_mode
	color = p_color
	custom_minimum_size = Vector2(180, 42)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func set_data(history: Array, sample: Dictionary) -> void:
	_values.clear()
	if mode == "ram":
		for row in history.slice(maxi(0, history.size() - 40)):
			_values.append(float((row.get("agent_ram", {}) as Dictionary).get(key, 0.0)) / 1048576.0)
	else:
		var has_key := false
		for row in sample.get("token_series", []):
			if row.has(key):
				has_key = true
				_values.append(float(row[key]))
			else:
				_values.append(0.0)
		if not has_key:
			_values.clear()
	queue_redraw()

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.035, 0.037, 0.052, 0.72))
	if _values.is_empty():
		return
	var peak := 0.001
	for v in _values: peak = maxf(peak, v)
	var points := PackedVector2Array()
	for i in _values.size():
		var x := 3.0 if _values.size() == 1 else 3.0 + (size.x - 6.0) * float(i) / float(_values.size() - 1)
		var y := size.y - 4.0 - (size.y - 8.0) * _values[i] / peak
		points.append(Vector2(x, y))
	if points.size() > 1:
		draw_polyline(points, color, 1.8, true)
	else:
		draw_circle(points[0], 2.8, color)

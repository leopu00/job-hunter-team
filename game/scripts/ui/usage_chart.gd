class_name UsageChart
extends Control
## Grafico temporale multi-serie per il monitoraggio risorse: assi con
## etichette orarie adattive, hover con crosshair e valori, legenda
## cliccabile (mute/unmute serie) e tre modalità di resa.
##
## Contratto dati (indipendente dalla sorgente: live o storico):
##   set_series([{key, label, color, points: [[unix_ts, value], …]}, …],
##              from_ts, to_ts)
## I punti fuori [from_ts, to_ts] vengono ignorati in resa: la finestra
## temporale la decide chi orchestra (il pannello), non il grafico.

enum Mode { LINE, STACKED_AREA, BARS }

var mode: int = Mode.LINE
## Formattatore del valore sull'asse Y e nell'hover (es. "%.0f kt").
var value_suffix := ""
var y_max_forced := 0.0   # 0 = autoscala sul massimo visibile

var _series: Array = []
var _from_ts := 0.0
var _to_ts := 0.0
var _muted := {}          # key → true (serie nascosta via legenda)
var _hover_x := -1.0      # posizione mouse in px locali (-1 = fuori)
var _font: Font
var _font_medium: Font

const PLOT_MARGIN_L := 64.0
const PLOT_MARGIN_R := 14.0
const PLOT_MARGIN_T := 14.0
const PLOT_MARGIN_B := 34.0
const LEGEND_H := 26.0

signal series_toggled(key: String, muted: bool)

func _init() -> void:
	custom_minimum_size = Vector2(520, 260)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	mouse_filter = Control.MOUSE_FILTER_STOP

func _ready() -> void:
	_font = load(TerminalTheme.FONT_REGULAR)
	_font_medium = load(TerminalTheme.FONT_MEDIUM)
	mouse_exited.connect(func() -> void:
		_hover_x = -1.0
		queue_redraw())

func set_series(series: Array, from_ts: float, to_ts: float) -> void:
	_series = series
	_from_ts = from_ts
	_to_ts = maxf(to_ts, from_ts + 1.0)
	queue_redraw()

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		_hover_x = event.position.x
		queue_redraw()
	elif event is InputEventMouseButton and event.pressed \
			and event.button_index == MOUSE_BUTTON_LEFT:
		_legend_click(event.position)

## ── Geometria ─────────────────────────────────────────────────────────

func _plot_rect() -> Rect2:
	return Rect2(Vector2(PLOT_MARGIN_L, PLOT_MARGIN_T),
			Vector2(size.x - PLOT_MARGIN_L - PLOT_MARGIN_R,
					size.y - PLOT_MARGIN_T - PLOT_MARGIN_B - LEGEND_H))

func _x_for(ts: float, plot: Rect2) -> float:
	return plot.position.x + plot.size.x * \
			clampf((ts - _from_ts) / (_to_ts - _from_ts), 0.0, 1.0)

## ── Serie visibili e scala ────────────────────────────────────────────

func _visible_series() -> Array:
	var out: Array = []
	for s in _series:
		if not _muted.get(str(s.get("key", "")), false):
			out.append(s)
	return out

## Punti dentro la finestra, ordinati per ts (fidati ma verifica).
static func _window_points(s: Dictionary, from_ts: float, to_ts: float) -> Array:
	var pts: Array = []
	for p in s.get("points", []):
		var t := float(p[0])
		if t >= from_ts and t <= to_ts:
			pts.append(p)
	pts.sort_custom(func(a: Variant, b: Variant) -> bool:
		return float(a[0]) < float(b[0]))
	return pts

func _peak_value() -> float:
	if y_max_forced > 0.0:
		return y_max_forced
	var peak := 0.000001
	if mode == Mode.STACKED_AREA or mode == Mode.BARS:
		# picco della SOMMA per bucket ts (le serie si impilano)
		var sums := {}
		for s in _visible_series():
			for p in _window_points(s, _from_ts, _to_ts):
				sums[p[0]] = float(sums.get(p[0], 0.0)) + float(p[1])
		for k in sums:
			peak = maxf(peak, float(sums[k]))
	else:
		for s in _visible_series():
			for p in _window_points(s, _from_ts, _to_ts):
				peak = maxf(peak, float(p[1]))
	return peak

## ── Resa ──────────────────────────────────────────────────────────────

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.035, 0.037, 0.052, 0.92))
	draw_rect(Rect2(Vector2.ZERO, size), Palette.BORDER_GLOW, false, 1.0)
	var plot := _plot_rect()
	if plot.size.x < 40.0 or plot.size.y < 40.0:
		return
	var peak := _peak_value()
	_draw_y_axis(plot, peak)
	_draw_time_axis(plot)
	var visible := _visible_series()
	if visible.is_empty() or _to_ts <= _from_ts:
		if _font:
			var msg := UIStrings.t("usage.no_data")
			var w := _font.get_string_size(msg, HORIZONTAL_ALIGNMENT_LEFT, -1, 14).x
			draw_string(_font, plot.position + Vector2((plot.size.x - w) / 2.0,
					plot.size.y / 2.0), msg, HORIZONTAL_ALIGNMENT_LEFT, -1, 14,
					Palette.DIM)
	else:
		match mode:
			Mode.STACKED_AREA:
				_draw_stacked(plot, peak, visible)
			Mode.BARS:
				_draw_bars(plot, peak, visible)
			_:
				_draw_lines(plot, peak, visible)
		_draw_hover(plot, peak, visible)
	_draw_legend(plot)

func _draw_y_axis(plot: Rect2, peak: float) -> void:
	for i in 5:
		var frac := float(i) / 4.0
		var y := plot.end.y - plot.size.y * frac
		draw_line(Vector2(plot.position.x, y), Vector2(plot.end.x, y),
				Color(0.35, 0.37, 0.46, 0.30 if i == 0 else 0.16), 1.0)
		if _font:
			var txt := _fmt_value(peak * frac)
			var w := _font.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
			draw_string(_font, Vector2(plot.position.x - w - 8, y + 4), txt,
					HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Palette.DIM)

## Gridline temporali: passo scelto perché entrino ~4-8 etichette,
## allineato a confini "umani" (ora piena, mezzanotte, lunedì…).
func _draw_time_axis(plot: Rect2) -> void:
	var span := _to_ts - _from_ts
	var step := _nice_time_step(span)
	if step <= 0.0:
		return
	# primo tick allineato al multiplo di step (in ora locale per i giorni)
	var tz_off := _local_tz_offset()
	var first := ceilf((_from_ts + tz_off) / step) * step - tz_off
	var t := first
	while t <= _to_ts:
		var x := _x_for(t, plot)
		draw_line(Vector2(x, plot.position.y), Vector2(x, plot.end.y),
				Color(0.35, 0.37, 0.46, 0.14), 1.0)
		if _font:
			var lbl := _fmt_tick(t, span)
			var w := _font.get_string_size(lbl, HORIZONTAL_ALIGNMENT_LEFT, -1, 11).x
			draw_string(_font, Vector2(x - w / 2.0, plot.end.y + 18), lbl,
					HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Palette.DIM)
		t += step

func _draw_lines(plot: Rect2, peak: float, visible: Array) -> void:
	for s in visible:
		var pts := _window_points(s, _from_ts, _to_ts)
		if pts.is_empty():
			continue
		var color := _series_color(s)
		var poly := PackedVector2Array()
		for p in pts:
			poly.append(Vector2(_x_for(float(p[0]), plot),
					plot.end.y - plot.size.y * clampf(float(p[1]) / peak, 0.0, 1.0)))
		if poly.size() >= 2:
			draw_polyline(poly, color, 2.0, true)
		else:
			draw_circle(poly[0], 3.0, color)

func _draw_stacked(plot: Rect2, peak: float, visible: Array) -> void:
	# griglia ts comune: unione dei timestamp di tutte le serie visibili
	var ts_set := {}
	for s in visible:
		for p in _window_points(s, _from_ts, _to_ts):
			ts_set[float(p[0])] = true
	var ts_list: Array = ts_set.keys()
	ts_list.sort()
	if ts_list.is_empty():
		return
	var base := {}
	for t in ts_list:
		base[t] = 0.0
	for s in visible:
		var color := _series_color(s)
		var vals := {}
		for p in _window_points(s, _from_ts, _to_ts):
			vals[float(p[0])] = float(p[1])
		var top_pts := PackedVector2Array()
		var bot_pts := PackedVector2Array()
		for t in ts_list:
			var lo := float(base[t])
			var hi := lo + float(vals.get(t, 0.0))
			base[t] = hi
			var x := _x_for(float(t), plot)
			bot_pts.append(Vector2(x, plot.end.y - plot.size.y * clampf(lo / peak, 0.0, 1.0)))
			top_pts.append(Vector2(x, plot.end.y - plot.size.y * clampf(hi / peak, 0.0, 1.0)))
		if top_pts.size() < 2:
			continue
		# Riempimento a trapezi per segmento: il poligono unico bot+top
		# degenera (triangulation failed a ogni frame) appena una serie
		# resta a zero per un tratto — bordo inferiore e superiore
		# coincidono e il triangolatore rifiuta la sagoma.
		var fill := Color(color.r, color.g, color.b, 0.42)
		for i in range(top_pts.size() - 1):
			if absf(top_pts[i].y - bot_pts[i].y) < 0.5 \
					and absf(top_pts[i + 1].y - bot_pts[i + 1].y) < 0.5:
				continue
			draw_colored_polygon(PackedVector2Array([bot_pts[i],
					bot_pts[i + 1], top_pts[i + 1], top_pts[i]]), fill)
		draw_polyline(top_pts, color, 1.6, true)

func _draw_bars(plot: Rect2, peak: float, visible: Array) -> void:
	var ts_set := {}
	for s in visible:
		for p in _window_points(s, _from_ts, _to_ts):
			ts_set[float(p[0])] = true
	var ts_list: Array = ts_set.keys()
	ts_list.sort()
	if ts_list.is_empty():
		return
	# larghezza barra = distanza minima fra bucket (con respiro)
	var min_dt := _to_ts - _from_ts
	for i in range(1, ts_list.size()):
		min_dt = minf(min_dt, float(ts_list[i]) - float(ts_list[i - 1]))
	var bar_w := maxf(2.0, plot.size.x * min_dt / (_to_ts - _from_ts) - 2.0)
	for t in ts_list:
		var x := _x_for(float(t), plot)
		var y := plot.end.y
		for s in visible:
			var v := 0.0
			for p in _window_points(s, _from_ts, _to_ts):
				if absf(float(p[0]) - float(t)) < 0.5:
					v = float(p[1])
					break
			if v <= 0.0:
				continue
			var h := plot.size.y * clampf(v / peak, 0.0, 1.0)
			var color := _series_color(s)
			draw_rect(Rect2(Vector2(x - bar_w / 2.0, y - h), Vector2(bar_w, h)),
					Color(color.r, color.g, color.b, 0.78))
			y -= h

## Crosshair + tooltip: il bucket più vicino alla x del mouse, con il
## valore di ogni serie visibile in quel punto.
func _draw_hover(plot: Rect2, peak: float, visible: Array) -> void:
	if _hover_x < plot.position.x or _hover_x > plot.end.x or not _font:
		return
	var ts := _from_ts + (_to_ts - _from_ts) * \
			(_hover_x - plot.position.x) / plot.size.x
	# bucket più vicino fra tutte le serie
	var best_ts := 0.0
	var best_d := 1e18
	for s in visible:
		for p in _window_points(s, _from_ts, _to_ts):
			var d := absf(float(p[0]) - ts)
			if d < best_d:
				best_d = d
				best_ts = float(p[0])
	if best_d >= 1e18:
		return
	var x := _x_for(best_ts, plot)
	draw_line(Vector2(x, plot.position.y), Vector2(x, plot.end.y),
			Color(1, 1, 1, 0.25), 1.0)
	var lines: Array = [_fmt_tick_full(best_ts)]
	var total := 0.0
	for s in visible:
		for p in _window_points(s, _from_ts, _to_ts):
			# confronto ESATTO sul bucket: is_equal_approx su un unix ts
			# ha tolleranza relativa (~mezz'ora su 1.7e9) e aggancia il
			# bucket sbagliato — pallini fuori dalla linea, valori vecchi
			if absf(float(p[0]) - best_ts) < 0.5:
				var v := float(p[1])
				total += v
				lines.append("%s  %s" % [str(s.get("label", s.get("key", "?"))),
						_fmt_value(v)])
				draw_circle(Vector2(x, plot.end.y - plot.size.y * \
						clampf(v / peak, 0.0, 1.0)), 3.4, _series_color(s))
				break
	if visible.size() > 1 and (mode == Mode.STACKED_AREA or mode == Mode.BARS):
		lines.append("Σ  %s" % _fmt_value(total))
	# box tooltip, a destra o sinistra del crosshair a seconda dello spazio
	var w := 0.0
	for l in lines:
		w = maxf(w, _font.get_string_size(str(l), HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x)
	var box_w := w + 20.0
	var box_h := lines.size() * 17.0 + 12.0
	var bx := x + 12.0
	if bx + box_w > plot.end.x:
		bx = x - box_w - 12.0
	var by := plot.position.y + 8.0
	draw_rect(Rect2(Vector2(bx, by), Vector2(box_w, box_h)),
			Color(0.02, 0.02, 0.03, 0.94))
	draw_rect(Rect2(Vector2(bx, by), Vector2(box_w, box_h)),
			Palette.BORDER_GLOW, false, 1.0)
	for i in lines.size():
		var col: Color = Palette.MUTED if i == 0 else Palette.BRIGHT
		if i > 0 and i - 1 < visible.size():
			col = _series_color(visible[i - 1])
		if str(lines[i]).begins_with("Σ"):
			col = Palette.WHITE
		draw_string(_font, Vector2(bx + 10.0, by + 16.0 + i * 17.0),
				str(lines[i]), HORIZONTAL_ALIGNMENT_LEFT, -1, 12, col)

## Legenda in basso: pallino colorato + label, cliccabile per silenziare.
var _legend_hits: Array = []   # [{rect: Rect2, key: String}]

func _draw_legend(plot: Rect2) -> void:
	_legend_hits.clear()
	if not _font or _series.is_empty():
		return
	var x := plot.position.x
	var y := size.y - LEGEND_H + 6.0
	for s in _series:
		var key := str(s.get("key", ""))
		var muted: bool = _muted.get(key, false)
		var label := str(s.get("label", key))
		var color := _series_color(s)
		if muted:
			color = Palette.DIM
		var w := _font.get_string_size(label, HORIZONTAL_ALIGNMENT_LEFT, -1, 12).x
		var hit := Rect2(Vector2(x, y - 4.0), Vector2(w + 24.0, 20.0))
		if x + w + 30.0 < size.x:
			draw_circle(Vector2(x + 6.0, y + 6.0), 4.0, color)
			draw_string(_font, Vector2(x + 16.0, y + 10.0), label,
					HORIZONTAL_ALIGNMENT_LEFT, -1, 12, color)
			_legend_hits.append({"rect": hit, "key": key})
		x += w + 30.0

func _legend_click(pos: Vector2) -> void:
	for hit in _legend_hits:
		if (hit["rect"] as Rect2).has_point(pos):
			var key: String = hit["key"]
			_muted[key] = not _muted.get(key, false)
			series_toggled.emit(key, _muted[key])
			queue_redraw()
			return

## ── Formattazione ─────────────────────────────────────────────────────

func _series_color(s: Dictionary) -> Color:
	var v: Variant = s.get("color")
	return v if v is Color else Palette.GREEN

func _fmt_value(v: float) -> String:
	var txt: String
	if absf(v) >= 100.0:
		txt = "%.0f" % v
	elif absf(v) >= 10.0:
		txt = "%.1f" % v
	else:
		txt = "%.2f" % v
	return txt + (" " + value_suffix if value_suffix != "" else "")

static func _local_tz_offset() -> float:
	return float(Time.get_time_zone_from_system().get("bias", 0)) * 60.0

## Passo temporale "umano" per ~5-7 tick sulla finestra.
static func _nice_time_step(span: float) -> float:
	var target := span / 6.0
	for step in [300.0, 900.0, 1800.0, 3600.0, 7200.0, 10800.0, 21600.0,
			43200.0, 86400.0, 172800.0, 604800.0, 1209600.0, 2592000.0]:
		if step >= target:
			return step
	return 2592000.0

func _fmt_tick(ts: float, span: float) -> String:
	var d := Time.get_datetime_dict_from_unix_time(int(ts + _local_tz_offset()))
	if span <= 172800.0:   # ≤ 2 giorni: solo orario
		return "%02d:%02d" % [d["hour"], d["minute"]]
	if span <= 2678400.0:  # ≤ 31 giorni: giorno/mese
		return "%02d/%02d" % [d["day"], d["month"]]
	return "%02d/%02d" % [d["day"], d["month"]]

func _fmt_tick_full(ts: float) -> String:
	var d := Time.get_datetime_dict_from_unix_time(int(ts + _local_tz_offset()))
	return "%02d/%02d %02d:%02d" % [d["day"], d["month"], d["hour"], d["minute"]]

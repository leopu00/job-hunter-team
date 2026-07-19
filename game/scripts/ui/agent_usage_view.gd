class_name AgentUsageView
extends VBoxContainer
## La finestra "Consumi agenti": chi ha consumato quanto e QUANDO, sul
## periodo scelto nella barra temporale condivisa con la finestra Usage.
## Quattro viste sugli stessi dati per-agente (kT per bucket dai log CLI):
##   1. area impilata nel tempo — il "quando" di ciascun agente
##   2. classifica a barre — il "quanto" totale, cliccabile per isolare
##   3. donut della quota sul totale
##   4. heatmap ora × giorno — i turni di consumo a colpo d'occhio

const AGENT_COLORS := [Palette.GREEN, Palette.BLUE, Palette.PURPLE,
		Palette.YELLOW, Palette.ORANGE, Palette.RED, Palette.MINT,
		Color("#e879f9"), Color("#38bdf8"), Color("#facc15"),
		Color("#4ade80"), Color("#fb7185")]
const RANK_MAX := 14      # righe in classifica (oltre: "(altri)")
const DONUT_MAX := 8      # spicchi nominati nel donut

var _range_bar: UsageRangeBar
var _status: Label
var _stacked: UsageChart
var _rank_box: VBoxContainer
var _donut: AgentDonut
var _donut_legend: VBoxContainer
var _heatmap: AgentHeatmap
var _data: Dictionary = {}
var _pending_query := {}
var _solo := ""           # agente isolato dalla classifica ("" = tutti)

func _ready() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 10)
	BackendBus.usage_history_updated.connect(_on_history)
	if not BackendBus.is_live():
		add_child(TerminalTheme.label(
				"◆ SHOWROOM · consumi agenti simulati", 13, Palette.YELLOW, "medium"))

	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 14)
	add_child(top)
	_range_bar = UsageRangeBar.new()
	_range_bar.range_changed.connect(_request)
	_range_bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(_range_bar)
	_status = TerminalTheme.label("", 13, Palette.DIM)
	top.add_child(_status)

	add_child(TerminalTheme.label(UIStrings.t("usage.stacked"),
			14, Palette.MUTED, "medium"))
	_stacked = UsageChart.new()
	_stacked.mode = UsageChart.Mode.STACKED_AREA
	_stacked.value_suffix = "kt"
	_stacked.custom_minimum_size = Vector2(520, 260)
	add_child(_stacked)

	# sotto: classifica a sinistra, donut+heatmap a destra
	var cols := HBoxContainer.new()
	cols.add_theme_constant_override("separation", 32)
	cols.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_child(cols)

	var left := VBoxContainer.new()
	left.add_theme_constant_override("separation", 6)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.add_child(left)
	left.add_child(TerminalTheme.label(UIStrings.t("usage.ranking"),
			14, Palette.MUTED, "medium"))
	_rank_box = VBoxContainer.new()
	_rank_box.add_theme_constant_override("separation", 4)
	left.add_child(_rank_box)

	var right := VBoxContainer.new()
	right.add_theme_constant_override("separation", 10)
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.add_child(right)
	right.add_child(TerminalTheme.label(UIStrings.t("usage.share"),
			14, Palette.MUTED, "medium"))
	var donut_row := HBoxContainer.new()
	donut_row.add_theme_constant_override("separation", 18)
	right.add_child(donut_row)
	_donut = AgentDonut.new()
	donut_row.add_child(_donut)
	_donut_legend = VBoxContainer.new()
	_donut_legend.add_theme_constant_override("separation", 2)
	_donut_legend.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	donut_row.add_child(_donut_legend)
	right.add_child(TerminalTheme.label(UIStrings.t("usage.heatmap"),
			14, Palette.MUTED, "medium"))
	_heatmap = AgentHeatmap.new()
	right.add_child(_heatmap)
	right.add_child(TerminalTheme.label(UIStrings.t("usage.heatmap_hint"),
			12, Palette.DIM))

	if not BackendBus.usage_history.is_empty():
		_data = BackendBus.usage_history
		_render()
	_request()

func _request() -> void:
	var w := UsageRangeBar.window()
	_pending_query = {"from_ts": w[0], "to_ts": w[1],
			"bucket_sec": UsageRangeBar.bucket_seconds()}
	_status.text = UIStrings.t("usage.loading")
	_status.add_theme_color_override("font_color", Palette.DIM)
	BackendBus.request_usage_history(w[0], w[1], UsageRangeBar.bucket_seconds())

func _on_history(query: Dictionary, data: Dictionary) -> void:
	if not is_instance_valid(self) or not is_inside_tree():
		return
	if not _pending_query.is_empty() \
			and int(query.get("bucket_sec", 0)) != int(_pending_query["bucket_sec"]):
		return
	if not bool(data.get("ok", false)):
		_status.text = UIStrings.t("usage.error") % str(data.get("error", "?"))
		_status.add_theme_color_override("font_color", Palette.RED)
		return
	_data = data
	_status.text = ""
	_render()

## Agenti ordinati per consumo totale decrescente nel periodo.
func _ranked_agents() -> Array:
	var agents: Dictionary = _data.get("agents", {})
	var totals: Dictionary = agents.get("totals_kt", {})
	var names: Array = []
	for n in agents.get("names", []):
		if float(totals.get(n, 0.0)) > 0.0:
			names.append(n)
	names.sort_custom(func(a: Variant, b: Variant) -> bool:
		return float(totals.get(a, 0.0)) > float(totals.get(b, 0.0)))
	return names

func _color_of(rank: int) -> Color:
	return AGENT_COLORS[rank % AGENT_COLORS.size()]

func _render() -> void:
	var w := UsageRangeBar.window()
	var agents: Dictionary = _data.get("agents", {})
	var totals: Dictionary = agents.get("totals_kt", {})
	var rows: Array = agents.get("series", [])
	var ranked := _ranked_agents()
	if _solo != "" and not ranked.has(_solo):
		_solo = ""

	# 1. area impilata: una serie per agente (isolato → solo quello)
	var series: Array = []
	for i in ranked.size():
		var name: String = ranked[i]
		if _solo != "" and name != _solo:
			continue
		var pts: Array = []
		for r in rows:
			if r.has(name):
				pts.append([float(r.get("t", 0)), float(r.get(name, 0))])
		series.append({"key": name, "label": name,
				"color": _color_of(i), "points": pts})
	_stacked.set_series(series, w[0], w[1])

	# 2. classifica a barre cliccabile
	for child in _rank_box.get_children():
		child.queue_free()
	if ranked.is_empty():
		_rank_box.add_child(TerminalTheme.label(
				UIStrings.t("usage.no_agents"), 13, Palette.DIM))
	var grand_total := 0.0
	for n in ranked:
		grand_total += float(totals.get(n, 0.0))
	var peak := 0.001
	for n in ranked:
		peak = maxf(peak, float(totals.get(n, 0.0)))
	var shown := 0
	var others := 0.0
	for i in ranked.size():
		var name: String = ranked[i]
		var kt := float(totals.get(name, 0.0))
		if shown >= RANK_MAX:
			others += kt
			continue
		shown += 1
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		_rank_box.add_child(row)
		var btn := Button.new()
		btn.flat = true
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.clip_text = true
		btn.text = ("▸ " if _solo == name else "") + name
		btn.custom_minimum_size = Vector2(150, 0)
		btn.add_theme_font_size_override("font_size", 13)
		btn.add_theme_color_override("font_color",
				_color_of(i) if _solo == "" or _solo == name else Palette.DIM)
		btn.add_theme_color_override("font_hover_color", Palette.MINT)
		btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var captured := name
		btn.pressed.connect(func() -> void:
			_solo = "" if _solo == captured else captured
			_render())
		row.add_child(btn)
		var bar := ColorRect.new()
		var c := _color_of(i)
		bar.color = Color(c.r, c.g, c.b,
				0.85 if _solo == "" or _solo == name else 0.18)
		bar.custom_minimum_size = Vector2(maxf(3.0, 200.0 * kt / peak), 12)
		bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(bar)
		row.add_child(TerminalTheme.label("%.0f kt · %d%%" % [kt,
				int(round(100.0 * kt / maxf(0.001, grand_total)))],
				13, Palette.MUTED))
	if others > 0.0:
		_rank_box.add_child(TerminalTheme.label("%s  %.0f kt" % [
				UIStrings.t("usage.others"), others], 13, Palette.DIM))
	if grand_total > 0.0:
		_rank_box.add_child(TerminalTheme.label(
				UIStrings.t("usage.total") % ("%.0f" % grand_total),
				13, Palette.BRIGHT, "medium"))

	# 3. donut quote
	_donut.slices.clear()
	for child in _donut_legend.get_children():
		child.queue_free()
	for i in mini(ranked.size(), DONUT_MAX):
		var name: String = ranked[i]
		var kt := float(totals.get(name, 0.0))
		_donut.slices.append({"value": kt, "color": _color_of(i)})
		_donut_legend.add_child(TerminalTheme.label("%s · %d%%" % [name,
				int(round(100.0 * kt / maxf(0.001, grand_total)))],
				12, _color_of(i)))
	var rest := 0.0
	for i in range(DONUT_MAX, ranked.size()):
		rest += float(totals.get(ranked[i], 0.0))
	if rest > 0.0:
		_donut.slices.append({"value": rest, "color": Palette.DIM})
		_donut_legend.add_child(TerminalTheme.label("%s · %d%%" % [
				UIStrings.t("usage.others"),
				int(round(100.0 * rest / maxf(0.001, grand_total)))],
				12, Palette.DIM))
	_donut.queue_redraw()

	# 4. heatmap ora × giorno (agente isolato oppure tutto il team)
	var cells := {}
	var cell_peak := 0.001
	var tz_off := float(Time.get_time_zone_from_system().get("bias", 0)) * 60.0
	for r in rows:
		var kt_sum := 0.0
		if _solo != "":
			kt_sum = float(r.get(_solo, 0.0))
		else:
			for k in r:
				if k != "t":
					kt_sum += float(r[k])
		if kt_sum <= 0.0:
			continue
		var d := Time.get_datetime_dict_from_unix_time(int(float(r.get("t", 0)) + tz_off))
		var key := Vector2i(int(d["weekday"]), int(d["hour"]))
		cells[key] = float(cells.get(key, 0.0)) + kt_sum
		cell_peak = maxf(cell_peak, cells[key])
	_heatmap.set_cells(cells, cell_peak)


## Donut minimale delle quote di consumo (spicchi proporzionali).
class AgentDonut:
	extends Control
	var slices: Array = []   # [{value: float, color: Color}]

	func _init() -> void:
		custom_minimum_size = Vector2(130, 130)

	func _draw() -> void:
		var total := 0.0
		for s in slices:
			total += float(s["value"])
		if total <= 0.0:
			return
		var center := size / 2.0
		var radius := minf(center.x, center.y) - 12.0
		var start := -PI / 2.0
		for s in slices:
			var sweep := TAU * float(s["value"]) / total
			draw_arc(center, radius, start + 0.02, start + sweep - 0.02,
					maxi(8, int(sweep * 24.0)), s["color"], 22.0, true)
			start += sweep


## Heatmap ora (x) × giorno della settimana (y): l'intensità del verde
## è il kT consumato in quella cella sul periodo visibile.
class AgentHeatmap:
	extends Control
	const DAYS := ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"]
	var _cells := {}         # Vector2i(weekday, hour) → kT
	var _peak := 1.0
	var _font: Font

	func _init() -> void:
		custom_minimum_size = Vector2(420, 170)
		size_flags_horizontal = Control.SIZE_EXPAND_FILL

	func _ready() -> void:
		_font = load(TerminalTheme.FONT_REGULAR)

	func set_cells(cells: Dictionary, peak: float) -> void:
		_cells = cells
		_peak = maxf(0.001, peak)
		queue_redraw()

	func _draw() -> void:
		draw_rect(Rect2(Vector2.ZERO, size), Color(0.035, 0.037, 0.052, 0.92))
		draw_rect(Rect2(Vector2.ZERO, size), Palette.BORDER_GLOW, false, 1.0)
		var left := 44.0
		var top := 8.0
		var bottom := 22.0
		var cw := (size.x - left - 8.0) / 24.0
		var ch := (size.y - top - bottom) / 7.0
		for day in 7:
			if _font:
				draw_string(_font, Vector2(6, top + ch * day + ch / 2.0 + 4.0),
						DAYS[day], HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Palette.DIM)
			for hour in 24:
				var v := float(_cells.get(Vector2i(day, hour), 0.0))
				var rect := Rect2(Vector2(left + cw * hour, top + ch * day),
						Vector2(cw - 1.0, ch - 1.0))
				if v <= 0.0:
					draw_rect(rect, Color(1, 1, 1, 0.03))
				else:
					var f := clampf(v / _peak, 0.04, 1.0)
					draw_rect(rect, Color(Palette.GREEN.r, Palette.GREEN.g,
							Palette.GREEN.b, 0.10 + 0.85 * f))
		if _font:
			for hour in [0, 6, 12, 18, 23]:
				draw_string(_font, Vector2(left + cw * hour, size.y - 6.0),
						"%02d" % hour, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Palette.DIM)

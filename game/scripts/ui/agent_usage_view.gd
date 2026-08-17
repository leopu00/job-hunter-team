class_name AgentUsageView
extends VBoxContainer
## La finestra "Consumi agenti": chi ha consumato quanto e QUANDO, sul
## periodo scelto nella barra temporale condivisa con la finestra Usage.
## Quattro viste sugli stessi dati per-agente (kT per bucket dai log CLI):
##   1. area impilata nel tempo — il "quando" di ciascun agente
##   2. classifica a barre — il "quanto" totale, cliccabile per isolare
##   3. donut della quota sul totale
##   4. heatmap ora × giorno — i turni di consumo a colpo d'occhio

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
var _donut_page := 0      # 0 = totale, 1+ = pagine dentro gli "(altri)"
var _veil: UsageLoadingVeil
var _provenance_note: Label
var _last_data_state := -1
var _provenance_generation := 0
var _request_serial := 0

func _ready() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 10)
	BackendBus.usage_history_updated.connect(_on_history)
	BackendBus.connection_changed.connect(_on_connection_changed)
	BackendBus.positions_updated.connect(_on_positions_provenance_changed)
	var data_state := SimBadge.current_state()
	_provenance_note = TerminalTheme.label("", 13, Palette.DIM, "medium")
	add_child(_provenance_note)
	_apply_provenance(data_state, false)

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
	_donut.slice_clicked.connect(_on_donut_slice)
	donut_row.add_child(_donut)
	_donut_legend = VBoxContainer.new()
	_donut_legend.add_theme_constant_override("separation", 2)
	_donut_legend.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	donut_row.add_child(_donut_legend)
	right.add_child(TerminalTheme.label(UIStrings.t("usage.donut_hint"),
			12, Palette.DIM))
	right.add_child(TerminalTheme.label(UIStrings.t("usage.heatmap"),
			14, Palette.MUTED, "medium"))
	_heatmap = AgentHeatmap.new()
	right.add_child(_heatmap)
	right.add_child(TerminalTheme.label(UIStrings.t("usage.heatmap_hint"),
			12, Palette.DIM))

	if data_state != SimBadge.DataState.UNAVAILABLE \
			and not BackendBus.usage_history.is_empty():
		_data = BackendBus.usage_history
		_render()
	if data_state != SimBadge.DataState.UNAVAILABLE:
		_request()


func _on_connection_changed(_state: int, _detail: String) -> void:
	_apply_provenance(SimBadge.current_state(), true)


func _on_positions_provenance_changed(_positions: Array) -> void:
	var state := SimBadge.current_state()
	if _last_data_state != int(state):
		_apply_provenance(state, true)


func _apply_provenance(state: int, request_on_live: bool) -> void:
	var previous := _last_data_state
	if previous != int(state):
		_provenance_generation += 1
	_last_data_state = int(state)
	_provenance_note.visible = state != SimBadge.DataState.LIVE
	_provenance_note.text = UIStrings.t("usage.showroom") \
			if state == SimBadge.DataState.DEMO \
			else UIStrings.t("common.connect_team")
	_provenance_note.add_theme_color_override("font_color",
			Palette.YELLOW if state == SimBadge.DataState.DEMO else Palette.DIM)
	if state == SimBadge.DataState.UNAVAILABLE:
		_clear_usage()
	if request_on_live and previous == int(SimBadge.DataState.UNAVAILABLE) \
			and state != SimBadge.DataState.UNAVAILABLE:
		_request()


func _clear_usage() -> void:
	_data = {}
	_pending_query = {}
	_solo = ""
	_donut_page = 0
	if is_instance_valid(_status):
		_status.text = ""
	if is_instance_valid(_veil):
		_veil.done()
		_veil = null
	if not is_instance_valid(_stacked):
		return
	var w := UsageRangeBar.window()
	_stacked.set_series([], w[0], w[1])
	for child in _rank_box.get_children():
		child.queue_free()
	_donut.slices.clear()
	_donut.queue_redraw()
	for child in _donut_legend.get_children():
		child.queue_free()
	_heatmap.set_cells({}, 0.001)

func _request() -> void:
	if SimBadge.current_state() == SimBadge.DataState.UNAVAILABLE:
		return
	var w := UsageRangeBar.window()
	_request_serial += 1
	var request_id := "%s:%d:%d" % [get_instance_id(),
			_provenance_generation, _request_serial]
	_pending_query = {"from_ts": w[0], "to_ts": w[1],
			"bucket_sec": UsageRangeBar.bucket_seconds(),
			"request_id": request_id}
	_status.text = ""
	if not is_instance_valid(_veil):
		_veil = UsageLoadingVeil.cover(_stacked)
	BackendBus.request_usage_history(w[0], w[1], UsageRangeBar.bucket_seconds(),
			request_id)

func _on_history(query: Dictionary, data: Dictionary) -> void:
	if not is_instance_valid(self) or not is_inside_tree():
		return
	if SimBadge.current_state() == SimBadge.DataState.UNAVAILABLE \
			or _pending_query.is_empty() \
			or str(query.get("request_id", "")) != str(_pending_query["request_id"]) \
			or int(query.get("bucket_sec", 0)) != int(_pending_query["bucket_sec"]) \
			or float(query.get("from_ts", 0.0)) != float(_pending_query["from_ts"]) \
			or float(query.get("to_ts", 0.0)) != float(_pending_query["to_ts"]):
		return
	if is_instance_valid(_veil):
		_veil.done()
	if not bool(data.get("ok", false)):
		_status.text = UIStrings.t("usage.error") % str(data.get("error", "?"))
		_status.add_theme_color_override("font_color", Palette.RED)
		return
	_data = data
	_pending_query = {}
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
	var colors := Palette.accent_cycle()
	colors.append_array([
		Color("#a832a8") if Palette.is_light() else Color("#e879f9"),
		Color("#087aa5") if Palette.is_light() else Color("#38bdf8"),
		Color("#8a6500") if Palette.is_light() else Color("#facc15"),
		Color("#167343") if Palette.is_light() else Color("#4ade80"),
		Color("#b52f50") if Palette.is_light() else Color("#fb7185"),
	])
	return colors[rank % colors.size()]

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
		series.append({"key": name, "label": _display_label(name),
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
		btn.text = ("▸ " if _solo == name else "") + _display_label(name)
		btn.custom_minimum_size = Vector2(190, 0)
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

	# 3. donut quote (pagina 0 = totale; le successive = dentro gli "altri")
	_render_donut(ranked, totals, grand_total)

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
		var key := Vector2i(AgentHeatmap.row_of(int(d["weekday"])), int(d["hour"]))
		cells[key] = float(cells.get(key, 0.0)) + kt_sum
		cell_peak = maxf(cell_peak, cells[key])
	_heatmap.set_cells(cells, cell_peak)

## Nome a schermo: i ruoli con workdir condivisa (es. critico) arrivano
## dai log come voce unica — il badge ×N dice quante istanze ci sono
## dietro, contate dal roster live.
## Solo le voci PER ISTANZA prendono il cognome: `Holmes · scout-1`. La voce
## di ruolo nudo qui non è il lead — è la somma di una workdir condivisa, e
## dietro "critico" ci sono tutte le istanze del reparto insieme. Prestarle il
## cognome della prima attribuirebbe a una persona i consumi di sei, che è
## esattamente il numero che questo pannello serve a leggere.
func _display_label(name: String) -> String:
	if name.contains("-"):
		return AgentNames.display_name(name)
	var instances := 0
	for a in BackendBus.agents:
		var uid := str(a.get("uid", a.get("slug", ""))).to_lower()
		if uid == name or uid.begins_with(name + "-"):
			instances += 1
	if instances > 1:
		return "%s %s" % [name, UIStrings.t("usage.role_pooled") % instances]
	return name

const OTHERS_KEY := "__others__"

## Donut a pagine: pagina 0 = i primi DONUT_MAX + "(altri)"; click su
## "(altri)" → pagina dentro quel gruppo, con ritorno al totale. Le
## percentuali restano sul totale del periodo, così i numeri non
## cambiano significato scendendo di pagina.
func _render_donut(ranked: Array, totals: Dictionary, grand_total: float) -> void:
	_donut.slices.clear()
	for child in _donut_legend.get_children():
		child.queue_free()
	var start := _donut_page * DONUT_MAX
	if start >= ranked.size():
		_donut_page = 0
		start = 0
	if _donut_page > 0:
		var back := Button.new()
		back.flat = true
		back.alignment = HORIZONTAL_ALIGNMENT_LEFT
		back.text = UIStrings.t("usage.donut_back")
		back.add_theme_font_size_override("font_size", 12)
		back.add_theme_color_override("font_color", Palette.MUTED)
		back.add_theme_color_override("font_hover_color", Palette.MINT)
		back.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		back.pressed.connect(func() -> void:
			_donut_page = 0
			_render())
		_donut_legend.add_child(back)
	for i in range(start, mini(start + DONUT_MAX, ranked.size())):
		var name: String = ranked[i]
		var kt := float(totals.get(name, 0.0))
		var color := _color_of(i)
		var label := _display_label(name)
		_donut.slices.append({"name": name, "label": label,
				"value": kt, "color": color})
		_donut_legend.add_child(TerminalTheme.label("%s · %d%%" % [label,
				int(round(100.0 * kt / maxf(0.001, grand_total)))],
				12, color))
	var rest := 0.0
	var rest_n := 0
	for i in range(start + DONUT_MAX, ranked.size()):
		rest += float(totals.get(ranked[i], 0.0))
		rest_n += 1
	if rest > 0.0:
		var others_label := "%s %d" % [UIStrings.t("usage.others"), rest_n]
		_donut.slices.append({"name": OTHERS_KEY, "label": others_label,
				"value": rest, "color": Palette.DIM})
		_donut_legend.add_child(TerminalTheme.label("%s · %d%%" % [others_label,
				int(round(100.0 * rest / maxf(0.001, grand_total)))],
				12, Palette.DIM))
	_donut.queue_redraw()

func _on_donut_slice(name: String) -> void:
	if name == OTHERS_KEY:
		_donut_page += 1   # dentro gli "altri": pagina successiva
		_render()
	else:
		_solo = "" if _solo == name else name
		_render()


## Donut interattivo delle quote di consumo: hover = dettagli al centro
## e spicchio evidenziato, click = segnale (drill sugli "(altri)",
## isolamento sugli agenti). L'hit-test è sull'anello, non sul buco.
class AgentDonut:
	extends Control
	signal slice_clicked(name: String)

	var slices: Array = []   # [{name, label, value: float, color: Color}]
	var _hover := -1
	var _font: Font
	var _font_medium: Font

	func _init() -> void:
		custom_minimum_size = Vector2(170, 170)
		mouse_filter = Control.MOUSE_FILTER_STOP

	func _ready() -> void:
		_font = load(TerminalTheme.FONT_REGULAR)
		_font_medium = load(TerminalTheme.FONT_MEDIUM)
		mouse_exited.connect(func() -> void:
			_hover = -1
			queue_redraw())

	func _gui_input(event: InputEvent) -> void:
		if event is InputEventMouseMotion:
			var hit := _slice_at(event.position)
			if hit != _hover:
				_hover = hit
				queue_redraw()
		elif event is InputEventMouseButton and event.pressed \
				and event.button_index == MOUSE_BUTTON_LEFT:
			var hit := _slice_at(event.position)
			if hit >= 0:
				slice_clicked.emit(str(slices[hit].get("name", "")))

	func _total() -> float:
		var total := 0.0
		for s in slices:
			total += float(s["value"])
		return total

	## Indice dello spicchio sotto il punto (‑1 = fuori dall'anello).
	func _slice_at(pos: Vector2) -> int:
		var total := _total()
		if total <= 0.0:
			return -1
		var center := size / 2.0
		var radius := minf(center.x, center.y) - 12.0
		var d := pos.distance_to(center)
		if d < radius - 14.0 or d > radius + 14.0:
			return -1
		# angolo dal via (-PI/2), normalizzato su [0, TAU)
		var ang := fposmod((pos - center).angle() + PI / 2.0, TAU)
		var start := 0.0
		for i in slices.size():
			var sweep := TAU * float(slices[i]["value"]) / total
			if ang >= start and ang < start + sweep:
				return i
			start += sweep
		return -1

	func _draw() -> void:
		var total := _total()
		if total <= 0.0:
			return
		var center := size / 2.0
		var radius := minf(center.x, center.y) - 12.0
		var start := -PI / 2.0
		for i in slices.size():
			var s: Dictionary = slices[i]
			var sweep := TAU * float(s["value"]) / total
			var col: Color = s["color"]
			var width := 22.0
			if _hover == i:
				width = 28.0   # lo spicchio sotto il mouse si ispessisce
			elif _hover >= 0:
				col = Color(col.r, col.g, col.b, 0.45)
			draw_arc(center, radius, start + 0.02, start + sweep - 0.02,
					maxi(8, int(sweep * 24.0)), col, width, true)
			start += sweep
		# dettagli nel buco: nome, kT e quota dello spicchio in hover
		if _hover >= 0 and _hover < slices.size() and _font:
			var s: Dictionary = slices[_hover]
			var lines := [str(s.get("label", s.get("name", "?"))),
					"%.0f kt" % float(s["value"]),
					"%d%%" % int(round(100.0 * float(s["value"]) / total))]
			for i in lines.size():
				var fnt := _font_medium if i == 0 else _font
				var fsize := 13 if i == 0 else 12
				var w := fnt.get_string_size(lines[i],
						HORIZONTAL_ALIGNMENT_LEFT, -1, fsize).x
				draw_string(fnt, Vector2(center.x - w / 2.0,
						center.y - 12.0 + i * 16.0), lines[i],
						HORIZONTAL_ALIGNMENT_LEFT, -1, fsize,
						s["color"] if i == 0 else Palette.BRIGHT)


## Heatmap ora (x) × giorno della settimana (y): l'intensità del verde
## è il kT consumato in quella cella sul periodo visibile. Le righe
## seguono la settimana lavorativa: lunedì in alto, domenica in fondo.
class AgentHeatmap:
	extends Control
	const DAYS := ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"]

	## weekday di Godot (0 = domenica) → riga con lunedì in testa.
	static func row_of(weekday: int) -> int:
		return (weekday + 6) % 7
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
		draw_rect(Rect2(Vector2.ZERO, size), Color(Palette.CARD.r, Palette.CARD.g, Palette.CARD.b, 0.96))
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
					draw_rect(rect, Color(Palette.BORDER.r, Palette.BORDER.g, Palette.BORDER.b, 0.24))
				else:
					var f := clampf(v / _peak, 0.04, 1.0)
					draw_rect(rect, Color(Palette.GREEN.r, Palette.GREEN.g,
							Palette.GREEN.b, 0.10 + 0.85 * f))
		if _font:
			for hour in [0, 6, 12, 18, 23]:
				draw_string(_font, Vector2(left + cw * hour, size.y - 6.0),
						"%02d" % hour, HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Palette.DIM)

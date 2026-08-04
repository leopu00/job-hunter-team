class_name WorldMap
extends Control
## La vista Mappa completa del web privato: basemap piatta a tile, FILTRI
## cross (famiglia, score, modalità, paese, città), zoom/panoramica e pin
## che aprono tutte le posizioni del luogo. Nessuna fase globo: si entra
## subito nella panoramica operativa e non si cambia rappresentazione.

signal open_position(pid: int)

## Gruppi di filtro nell'ordine della pagina /map del web.
const FILTER_GROUPS := [
	["role_family", "pos.f_family"],
	["score", "map.f_score"],
	["work_mode", "pos.f_mode"],
	["loc_country", "pos.f_country"],
	["loc_city", "map.f_city"],
]
const CHIP_MAX := 12  # chip per gruppo: i più frequenti, il resto tace

var _flat: OsmMap
## Stato dei filtri condiviso PER RIFERIMENTO con la mappa.
var filters := {"role_family": {}, "score": {}, "work_mode": {},
		"loc_country": {}, "loc_city": {}}

var _topright: VBoxContainer
var _filter_btn: Button
var _filter_panel: PanelContainer
var _filter_box: VBoxContainer
var _zoombar: HBoxContainer
var _initial_fit_done := false

func _ready() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	_flat = OsmMap.new()
	_flat.filters = filters
	_flat.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_flat)
	_flat.open_position.connect(func(pid: int) -> void: open_position.emit(pid))
	_initial_fit_done = OS.get_environment("JHT_MAP_ZOOM") != "" \
			or OS.get_environment("JHT_MAP_PIN") != ""
	_build_overlays()
	# TEST-AUTO: JHT_MAP_FILTERS=1 apre il pannello filtri (per gli shot)
	if OS.get_environment("JHT_MAP_FILTERS") == "1":
		_filter_panel.visible = true
		_refresh_filter_panel()
	BackendBus.positions_updated.connect(func(_l: Array) -> void:
		_fit_initial_overview.call_deferred()
		if _filter_panel.visible:
			_refresh_filter_panel())
	_fit_initial_overview.call_deferred()

func _fit_initial_overview() -> void:
	if _initial_fit_done or BackendBus.positions.is_empty():
		return
	_initial_fit_done = true
	_flat.fit_all()

## Gli overlay non hanno anchors utili dentro un container: li teniamo
## a misura minima e li riposizioniamo noi (top-right e basso-centro).
func _process(_delta: float) -> void:
	if is_instance_valid(_topright):
		_topright.reset_size()
		_topright.position = Vector2(size.x - _topright.size.x - 10, 8)
	if is_instance_valid(_zoombar):
		_zoombar.reset_size()
		_zoombar.position = Vector2((size.x - _zoombar.size.x) / 2.0,
				size.y - _zoombar.size.y - 34)

## ── Overlay: bottone+pannello filtri e widget di zoom ────────────────

func _build_overlays() -> void:
	_topright = VBoxContainer.new()
	_topright.add_theme_constant_override("separation", 6)
	add_child(_topright)
	_filter_btn = Button.new()
	_filter_btn.add_theme_font_size_override("font_size", 13)
	_filter_btn.size_flags_horizontal = Control.SIZE_SHRINK_END
	_style_widget_button(_filter_btn, Palette.GREEN)
	_filter_btn.pressed.connect(func() -> void:
		Sfx.play_tick()
		_filter_panel.visible = not _filter_panel.visible
		if _filter_panel.visible:
			_refresh_filter_panel())
	_topright.add_child(_filter_btn)
	_filter_panel = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.96)
	sb.border_color = Palette.BORDER_GLOW
	sb.set_border_width_all(TerminalTheme.hairline())
	for side_val in [["left", 14], ["right", 14], ["top", 10], ["bottom", 10]]:
		sb.set("content_margin_" + side_val[0], side_val[1])
	_filter_panel.add_theme_stylebox_override("panel", sb)
	_filter_panel.visible = false
	_topright.add_child(_filter_panel)
	_filter_box = VBoxContainer.new()
	_filter_box.add_theme_constant_override("separation", 8)
	_filter_box.custom_minimum_size = Vector2(470, 0)
	_filter_panel.add_child(_filter_box)
	_update_filter_btn()

	_zoombar = HBoxContainer.new()
	_zoombar.add_theme_constant_override("separation", 8)
	add_child(_zoombar)
	var minus := Button.new()
	minus.text = "−"
	minus.add_theme_font_size_override("font_size", 16)
	_style_widget_button(minus, Palette.BASE)
	minus.pressed.connect(func() -> void: _zoom_step(-1.0))
	_zoombar.add_child(minus)
	var overview := Button.new()
	overview.text = "◎ " + UIStrings.t("map.overview")
	overview.add_theme_font_size_override("font_size", 13)
	_style_widget_button(overview, Palette.BASE)
	overview.pressed.connect(func() -> void:
		Sfx.play_tick()
		_flat.fit_all())
	_zoombar.add_child(overview)
	var plus := Button.new()
	plus.text = "+"
	plus.add_theme_font_size_override("font_size", 16)
	_style_widget_button(plus, Palette.BASE)
	plus.pressed.connect(func() -> void: _zoom_step(1.0))
	_zoombar.add_child(plus)

func _zoom_step(direction: float) -> void:
	_flat.zoom_step(direction * 0.8)

static func _style_widget_button(btn: Button, col: Color) -> void:
	btn.add_theme_color_override("font_color", col)
	btn.add_theme_color_override("font_hover_color", Palette.MINT)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.94)
	sb.border_color = Palette.BORDER
	sb.set_border_width_all(TerminalTheme.hairline())
	sb.content_margin_left = 10
	sb.content_margin_right = 10
	sb.content_margin_top = 3
	sb.content_margin_bottom = 4
	btn.add_theme_stylebox_override("normal", sb)
	var hover := sb.duplicate()
	hover.border_color = Palette.BORDER_GLOW
	btn.add_theme_stylebox_override("hover", hover)
	btn.add_theme_stylebox_override("pressed", hover.duplicate())
	btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())

func _active_filter_count() -> int:
	var n := 0
	for key in filters:
		n += (filters[key] as Dictionary).size()
	return n

func _update_filter_btn() -> void:
	var n := _active_filter_count()
	# Solo testo: il ⚙ era un pittogramma dipendente dai font di sistema
	# (regola: niente emoji nella UI di prodotto). Il conteggio dei filtri
	# attivi dice già tutto quel che serve.
	_filter_btn.text = UIStrings.t("map.filters") if n == 0 \
			else "%s · %d" % [UIStrings.t("map.filters"), n]
	_filter_btn.add_theme_color_override("font_color",
			Palette.GREEN if n > 0 else Palette.BASE)

## Applica lo stato dei filtri: le due viste ricostruiscono i pin, il
## pannello i conteggi (cross-filter: ogni gruppo conta le posizioni
## filtrate da tutti GLI ALTRI, come sul web e nella vista positions).
func _apply_filters() -> void:
	_flat._rebuild_pins()
	_flat.fit_all()
	_update_filter_btn()
	if _filter_panel.visible:
		_refresh_filter_panel()

func _refresh_filter_panel() -> void:
	for child in _filter_box.get_children():
		child.queue_free()
	if BackendBus.positions.is_empty():
		_filter_box.add_child(TerminalTheme.label(UIStrings.t("pos.need_vps"),
				13, Palette.MUTED))
		return
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 10)
	_filter_box.add_child(head)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(spacer)
	if _active_filter_count() > 0:
		var clear := Button.new()
		clear.flat = true
		clear.text = UIStrings.t("pos.clear")
		clear.add_theme_font_size_override("font_size", 12)
		clear.add_theme_color_override("font_color", Palette.RED)
		clear.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		clear.pressed.connect(func() -> void:
			for key in filters:
				(filters[key] as Dictionary).clear()
			Sfx.play_back()
			_apply_filters())
		head.add_child(clear)
	for group in FILTER_GROUPS:
		_chip_row(str(group[0]), UIStrings.t(str(group[1])))

## Una riga di chip per un gruppo, con conteggi cross-filtrati.
func _chip_row(key: String, title: String) -> void:
	var counts := {}
	for p in BackendBus.positions:
		if not MapPins.passes(p, filters, key):
			continue
		var v := MapPins.value_of(p, key)
		counts[v] = int(counts.get(v, 0)) + 1
	var chosen: Dictionary = filters[key]
	if counts.is_empty() and chosen.is_empty():
		return
	var values: Array = counts.keys()
	if key == "score":  # ordine fisso delle fasce, "senza punteggio" in coda
		var ordered: Array = []
		for band in MapPins.SCORE_BANDS:
			if counts.has(band[0]):
				ordered.append(band[0])
		if counts.has("none"):
			ordered.append("none")
		values = ordered
	else:
		values.sort_custom(func(a: String, b: String) -> bool:
			return int(counts[a]) > int(counts[b]))
		if values.size() > CHIP_MAX:
			values = values.slice(0, CHIP_MAX)
	# un valore scelto deve restare visibile anche se il cross-filter
	# l'ha azzerato: altrimenti non puoi più deselezionarlo
	for v in chosen:
		if not values.has(v):
			values.append(v)

	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 6)
	row.add_theme_constant_override("v_separation", 5)
	_filter_box.add_child(row)
	var lbl := TerminalTheme.label(title, 12, Palette.DIM, "medium")
	lbl.custom_minimum_size = Vector2(130, 0)
	row.add_child(lbl)
	for v in values:
		var chip := Button.new()
		var active: bool = chosen.has(v)
		chip.text = "%s %d" % [_chip_label(key, str(v)), int(counts.get(v, 0))]
		chip.add_theme_font_size_override("font_size", 12)
		var color: Color = MapPins.score_color(
				null if v == "none" else float(str(v)) + 7.0) \
				if key == "score" else Palette.BASE
		chip.add_theme_color_override("font_color",
				color if active or chosen.is_empty() else Palette.DIM)
		chip.add_theme_color_override("font_hover_color", Palette.MINT)
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(color.r, color.g, color.b, 0.18 if active else 0.0)
		sb.border_color = color if active else Palette.BORDER
		sb.set_border_width_all(TerminalTheme.hairline())
		sb.content_margin_left = 7
		sb.content_margin_right = 7
		sb.content_margin_top = 1
		sb.content_margin_bottom = 2
		chip.add_theme_stylebox_override("normal", sb)
		chip.add_theme_stylebox_override("hover", sb.duplicate())
		chip.add_theme_stylebox_override("pressed", sb.duplicate())
		chip.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var value := str(v)
		chip.pressed.connect(func() -> void:
			if chosen.has(value):
				chosen.erase(value)
			else:
				chosen[value] = true
			Sfx.play_tick()
			_apply_filters())
		row.add_child(chip)

static func _chip_label(key: String, v: String) -> String:
	if key != "score":
		return v
	if v == "none":
		return UIStrings.t("map.score_none")
	for band in MapPins.SCORE_BANDS:
		if band[0] == v:
			return band[1]
	return v

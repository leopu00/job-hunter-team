class_name GlobalSearch
extends CanvasLayer
## La GlobalSearch del web (Cmd+K): overlay di ricerca live sulle
## posizioni reali (titolo, azienda, città, famiglia). Invio o click
## aprono la pagina della posizione. ESC chiude.

signal open_position(id: int)
signal closed

const MAX_RESULTS := 12

var _edit: LineEdit
var _list: VBoxContainer
var _results: Array = []

func _init() -> void:
	layer = 30  # sopra sidebar e pannelli
	add_to_group("camera_blocking_overlay")

func _ready() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = TerminalTheme.get_theme()
	add_child(root)
	# velo scuro: click fuori chiude
	var veil := ColorRect.new()
	veil.color = Color(0, 0, 0, 0.55)
	veil.set_anchors_preset(Control.PRESET_FULL_RECT)
	veil.gui_input.connect(func(ev: InputEvent) -> void:
		if ev is InputEventMouseButton and ev.pressed:
			closed.emit())
	root.add_child(veil)

	var panel := BracketPanel.new()
	panel.set_anchors_preset(Control.PRESET_CENTER_TOP)
	panel.position = Vector2(-320, 120)
	panel.custom_minimum_size = Vector2(640, 0)
	panel.grow_horizontal = Control.GROW_DIRECTION_BOTH
	root.add_child(panel)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 18)
	panel.add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	margin.add_child(box)

	_edit = LineEdit.new()
	_edit.placeholder_text = UIStrings.t("search.placeholder")
	_edit.add_theme_font_size_override("font_size", 18)
	_edit.text_changed.connect(func(_t: String) -> void: _refresh())
	_edit.text_submitted.connect(func(_t: String) -> void:
		if not _results.is_empty():
			open_position.emit(int(_results[0].get("id", 0))))
	box.add_child(_edit)
	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 4)
	box.add_child(_list)
	_edit.grab_focus.call_deferred()
	BackendBus.positions_updated.connect(func(_positions: Array) -> void:
		if is_instance_valid(_list):
			_refresh())
	BackendBus.connection_changed.connect(func(_state: int, _detail: String) -> void:
		if is_instance_valid(_list):
			_refresh())
	_refresh()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		closed.emit()
		get_viewport().set_input_as_handled()

## TEST-AUTO: precompila la query (JHT_SEARCH) e aggiorna i risultati.
func set_query(q: String) -> void:
	_edit.text = q
	_refresh()

func _refresh() -> void:
	for child in _list.get_children():
		child.queue_free()
	_results = _search(_edit.text.strip_edges())
	if SimBadge.visible_positions().is_empty():
		_list.add_child(TerminalTheme.label(SimBadge.positions_empty_copy(),
				13, Palette.DIM))
		return
	if _results.is_empty():
		_list.add_child(TerminalTheme.label(UIStrings.t("search.no_match"),
				13, Palette.DIM))
		return
	for p in _results:
		var btn := Button.new()
		btn.flat = true
		var score_v: Variant = p.get("total_score")
		# L'ID nella riga: chi ha cercato "JHT-042" deve VEDERE il 042 nel
		# risultato, se no non sa se ha trovato quello giusto.
		btn.text = "JHT-%03d  %s  %s — %s   · %s" % [
				int(p.get("id", 0)),
				"—" if score_v == null else str(int(score_v)),
				str(p.get("title", "?")), str(p.get("company", "?")),
				str(p.get("loc_city", "") if p.get("loc_city") else "")]
		btn.add_theme_font_size_override("font_size", 14)
		btn.add_theme_color_override("font_color", Palette.BASE)
		btn.add_theme_color_override("font_hover_color", Palette.GREEN)
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.clip_text = true
		btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var pid := int(p.get("id", 0))
		btn.pressed.connect(func() -> void: open_position.emit(pid))
		_list.add_child(btn)

## Match su ID, titolo, azienda, città, famiglia e fonte. La REGOLA vive in
## `position_search.gd` — gemella di `web/lib/position-search.ts` — così le due
## superfici non rispondono due cose diverse alla stessa domanda, e il selftest
## headless può eseguirla senza montare la UI (O-60).
func _search(query: String) -> Array:
	return PositionSearch.filter(SimBadge.visible_positions(), query, MAX_RESULTS)

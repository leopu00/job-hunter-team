class_name PipelineQueuePanel
extends CanvasLayer
## Dettaglio di una pila fisica della pipeline: source_dept identifica
## l'output di un reparto e quindi la coda consumata dal reparto successivo.

signal closed
signal open_position(position_id: int)

const PANEL_MIN_SIZE := Vector2(1040, 560)
const LIST_WIDTH := 500.0

var source_dept := ""
var _selected_id := 0
var _rows: Array = []
var _content: VBoxContainer
var _detail: VBoxContainer

func _init(p_source_dept: String) -> void:
	source_dept = p_source_dept
	layer = 42
	add_to_group("camera_blocking_overlay")

func _ready() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = TerminalTheme.get_theme()
	add_child(root)
	var dim := ColorRect.new()
	dim.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.72)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed \
				and event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT]:
			close())
	root.add_child(dim)

	# Quasi fullscreen ma con respiro: cresce con il viewport invece di
	# restare una finestra fissa troppo stretta sulle risoluzioni grandi.
	var holder := MarginContainer.new()
	holder.set_anchors_preset(Control.PRESET_FULL_RECT)
	holder.add_theme_constant_override("margin_left", 64)
	holder.add_theme_constant_override("margin_right", 64)
	holder.add_theme_constant_override("margin_top", 42)
	holder.add_theme_constant_override("margin_bottom", 42)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(holder)
	var panel := BracketPanel.new()
	panel.custom_minimum_size = PANEL_MIN_SIZE
	holder.add_child(panel)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 24)
	panel.add_child(margin)
	_content = VBoxContainer.new()
	_content.add_theme_constant_override("separation", 10)
	_content.size_flags_vertical = Control.SIZE_EXPAND_FILL
	margin.add_child(_content)

	if not BackendBus.positions_updated.is_connected(_on_positions_updated):
		BackendBus.positions_updated.connect(_on_positions_updated)
	_rebuild()
	Sfx.play_blip()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		close()
		get_viewport().set_input_as_handled()

func close() -> void:
	Sfx.play_back()
	closed.emit()
	queue_free()

func _on_positions_updated(_positions: Array) -> void:
	if is_instance_valid(_content):
		_rebuild()

func _rebuild() -> void:
	for child in _content.get_children():
		child.queue_free()
	_rows = PipelineQueueDefs.positions_for(source_dept, SimBadge.visible_positions())
	if _selected_id == 0 and not _rows.is_empty():
		_selected_id = int((_rows[0] as Dictionary).get("id", 0))
	elif _selected_id != 0 and not _contains(_selected_id):
		_selected_id = 0
	_build_header()
	_content.add_child(HSeparator.new())
	_build_body()
	var hint := TerminalTheme.label(UIStrings.t("queue.close"), 12, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_content.add_child(hint)

func _build_header() -> void:
	var cfg: Dictionary = PipelineQueueDefs.QUEUES.get(source_dept, {})
	var phase := str(cfg.get("phase", ""))
	var dept: Dictionary = DepartmentDefs.DEPARTMENTS.get(source_dept, {})
	var accent: Color = dept.get("color", Palette.GREEN)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_content.add_child(row)
	row.add_child(TerminalTheme.label("▰", 26, accent, "xbold"))
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(titles)
	titles.add_child(TerminalTheme.label(UIStrings.t("queue.title") %
			UIStrings.t(str(cfg.get("consumer", "?"))), 24, Palette.WHITE, "xbold"))
	titles.add_child(TerminalTheme.label(UIStrings.t("queue.subtitle"), 12, Palette.MUTED))
	var badge := VBoxContainer.new()
	row.add_child(badge)
	var phase_label := TerminalTheme.label(UIStrings.t("queue.phase." + phase),
			12, accent, "bold")
	phase_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	badge.add_child(phase_label)
	var count := TerminalTheme.label(UIStrings.t("queue.count") % _rows.size(),
			14, Palette.MINT, "xbold")
	count.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	badge.add_child(count)
	var close_btn := Button.new()
	close_btn.flat = true
	close_btn.text = "✕"
	close_btn.add_theme_font_size_override("font_size", 20)
	close_btn.add_theme_color_override("font_color", Palette.MUTED)
	close_btn.add_theme_color_override("font_hover_color", Palette.RED)
	close_btn.pressed.connect(close)
	row.add_child(close_btn)

func _build_body() -> void:
	var body := HBoxContainer.new()
	body.add_theme_constant_override("separation", 18)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.custom_minimum_size = Vector2(0, 465)
	_content.add_child(body)

	var left := VBoxContainer.new()
	left.custom_minimum_size = Vector2(LIST_WIDTH, 0)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.size_flags_stretch_ratio = 1.15
	left.add_theme_constant_override("separation", 7)
	body.add_child(left)
	left.add_child(TerminalTheme.label(UIStrings.t("queue.list"), 13,
			Palette.MUTED, "medium"))
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	left.add_child(scroll)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 5)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(list)
	if _rows.is_empty():
		var empty := TerminalTheme.label(UIStrings.t("queue.empty"), 13, Palette.DIM)
		empty.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		list.add_child(empty)
	else:
		for p in _rows:
			list.add_child(_position_button(p))

	var detail_panel := PanelContainer.new()
	detail_panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	detail_panel.size_flags_stretch_ratio = 1.0
	detail_panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(detail_panel)
	var detail_margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		detail_margin.add_theme_constant_override("margin_" + side, 16)
	detail_panel.add_child(detail_margin)
	var right := VBoxContainer.new()
	right.add_theme_constant_override("separation", 8)
	detail_margin.add_child(right)
	right.add_child(TerminalTheme.label(UIStrings.t("queue.detail"), 13,
			Palette.MUTED, "medium"))
	var detail_scroll := ScrollContainer.new()
	detail_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	detail_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	right.add_child(detail_scroll)
	_detail = VBoxContainer.new()
	_detail.add_theme_constant_override("separation", 9)
	_detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	detail_scroll.add_child(_detail)
	_build_detail()
	# Sempre visibile: solo il contenuto descrittivo scorre sopra di lui.
	var open := Button.new()
	open.text = UIStrings.t("queue.open_position")
	open.add_theme_font_size_override("font_size", 13)
	open.custom_minimum_size = Vector2(0, 42)
	var selected := _selected()
	open.disabled = selected.is_empty()
	var pid := int(selected.get("id", 0))
	open.pressed.connect(func() -> void:
		if pid != 0:
			open_position.emit(pid))
	right.add_child(open)

func _position_button(p: Dictionary) -> Button:
	var pid := int(p.get("id", 0))
	var selected := pid == _selected_id
	var score := "—" if p.get("total_score") == null else str(int(p["total_score"]))
	var btn := Button.new()
	btn.text = "%s[%s] %s\n   %s · %s" % ["▸ " if selected else "  ", score,
			_value(p, "title"), _value(p, "company"), _value(p, "status")]
	btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	btn.add_theme_font_size_override("font_size", 13)
	btn.add_theme_color_override("font_color", Palette.GREEN if selected else Palette.BASE)
	btn.add_theme_color_override("font_hover_color", Palette.MINT)
	btn.pressed.connect(func() -> void:
		_selected_id = pid
		Sfx.play_tick()
		_rebuild())
	return btn

func _build_detail() -> void:
	var p := _selected()
	if p.is_empty():
		_detail.add_child(TerminalTheme.label(UIStrings.t("queue.select"), 14, Palette.DIM))
		return
	_detail.add_child(TerminalTheme.label(_value(p, "title"), 20,
			Palette.WHITE, "xbold"))
	_detail.add_child(TerminalTheme.label(_value(p, "company"), 15,
			Palette.BRIGHT, "medium"))
	var meta: Array[String] = []
	for key in ["role_family", "loc_city", "loc_country", "work_mode"]:
		var val := _text(p.get(key))
		if val != "" and not meta.has(val):
			meta.append(val)
	if not meta.is_empty():
		_detail.add_child(TerminalTheme.label(" · ".join(meta), 12, Palette.MUTED))
	_detail.add_child(HSeparator.new())
	_add_row(UIStrings.t("pos.f_status"), _value(p, "status"), Palette.MINT)
	_add_row("SCORE", "—" if p.get("total_score") == null \
			else "%d/100" % int(p["total_score"]), Palette.YELLOW)
	_add_row(UIStrings.t("queue.found_by"), "%s · %s" % [_value(p, "found_by"),
			_date(_text(p.get("found_at")))], Palette.BASE)
	var writer := _text(p.get("written_by"))
	if writer != "":
		_add_row(UIStrings.t("cv.written_by"), "%s · %s" % [writer,
				_date(_text(p.get("written_at")))], Palette.BASE)
	var verdict := _text(p.get("critic_verdict"))
	if verdict != "":
		_add_row(UIStrings.t("queue.verdict"), verdict, {"PASS": Palette.GREEN,
				"NEEDS_WORK": Palette.YELLOW, "REJECT": Palette.RED}.get(verdict, Palette.DIM))
	var summary := _text(p.get("jd_summary"))
	if summary != "":
		_detail.add_child(HSeparator.new())
		_detail.add_child(TerminalTheme.markdown_label(summary, 13, Palette.BASE))

func _add_row(label_text: String, value: String, color: Color) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_detail.add_child(row)
	var label := TerminalTheme.label(label_text, 11, Palette.MUTED, "medium")
	label.custom_minimum_size = Vector2(130, 0)
	row.add_child(label)
	var val := TerminalTheme.label(value, 13, color, "medium")
	val.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	val.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(val)

func _selected() -> Dictionary:
	for p in _rows:
		if int(p.get("id", 0)) == _selected_id:
			return p
	return {}

func _contains(pid: int) -> bool:
	for p in _rows:
		if int(p.get("id", 0)) == pid:
			return true
	return false

func _value(p: Dictionary, key: String) -> String:
	var value := _text(p.get(key))
	return "—" if value == "" else value

func _text(value: Variant) -> String:
	if value == null:
		return ""
	var out := str(value).strip_edges()
	return "" if out == "<null>" else out

func _date(value: String) -> String:
	return "—" if value == "" else value.left(10)

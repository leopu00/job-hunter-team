class_name CvShelfPanel
extends CanvasLayer
## Archivio dell'output fisico dell'ufficio. Apre dal mobile CV PRONTI e
## presenta tutti i CV realmente scritti nello snapshot, non dati mock.

signal closed
signal open_position(position_id: int)

const PANEL_MIN_SIZE := Vector2(1040, 560)
const LIST_WIDTH := 500.0

var _rows: Array = []
var _selected_id := 0
var _content: VBoxContainer
var _detail: VBoxContainer

func _init() -> void:
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
	_rows = _written_positions()
	if _selected_id == 0 and not _rows.is_empty():
		_selected_id = int((_rows[0] as Dictionary).get("id", 0))
	elif _selected_id != 0 and not _contains_position(_selected_id):
		_selected_id = 0

	_build_header()
	_content.add_child(HSeparator.new())
	_build_kpis()
	_content.add_child(HSeparator.new())
	_build_body()
	var hint := TerminalTheme.label(UIStrings.t("cv.close"), 12, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_content.add_child(hint)

func _build_header() -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_content.add_child(row)
	row.add_child(TerminalTheme.label("▰", 26, Palette.GREEN, "xbold"))
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(titles)
	titles.add_child(TerminalTheme.label(UIStrings.t("cv.title"), 24,
			Palette.WHITE, "xbold"))
	titles.add_child(TerminalTheme.label(UIStrings.t("cv.subtitle"), 13, Palette.MUTED))
	var close_btn := Button.new()
	close_btn.flat = true
	close_btn.text = "✕"
	close_btn.add_theme_font_size_override("font_size", 20)
	close_btn.add_theme_color_override("font_color", Palette.MUTED)
	close_btn.add_theme_color_override("font_hover_color", Palette.RED)
	close_btn.pressed.connect(close)
	row.add_child(close_btn)

func _build_kpis() -> void:
	var pass_count := 0
	var review_count := 0
	var score_sum := 0.0
	var score_count := 0
	for p in _rows:
		var verdict := _text(p.get("critic_verdict"))
		if verdict == "PASS":
			pass_count += 1
		elif verdict in ["NEEDS_WORK", "REJECT"]:
			review_count += 1
		if p.get("total_score") != null:
			score_sum += float(p["total_score"])
			score_count += 1
	var average := "—" if score_count == 0 \
			else str(int(round(score_sum / float(score_count))))

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	_content.add_child(row)
	_add_kpi(row, UIStrings.t("cv.total"), str(_rows.size()), Palette.BRIGHT)
	_add_kpi(row, UIStrings.t("cv.pass"), str(pass_count), Palette.GREEN)
	_add_kpi(row, UIStrings.t("cv.review"), str(review_count), Palette.YELLOW)
	_add_kpi(row, UIStrings.t("cv.avg_score"), average, Palette.MINT)

func _add_kpi(parent: HBoxContainer, label_text: String, value: String,
		color: Color) -> void:
	var card := PanelContainer.new()
	card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(card)
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 14)
	margin.add_theme_constant_override("margin_right", 14)
	margin.add_theme_constant_override("margin_top", 7)
	margin.add_theme_constant_override("margin_bottom", 7)
	card.add_child(margin)
	var box := VBoxContainer.new()
	margin.add_child(box)
	box.add_child(TerminalTheme.label(label_text, 11, Palette.MUTED, "medium"))
	box.add_child(TerminalTheme.label(value, 22, color, "xbold"))

func _build_body() -> void:
	var body := HBoxContainer.new()
	body.add_theme_constant_override("separation", 18)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.custom_minimum_size = Vector2(0, 390)
	_content.add_child(body)

	var left := VBoxContainer.new()
	left.custom_minimum_size = Vector2(LIST_WIDTH, 0)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	left.size_flags_stretch_ratio = 1.1
	left.add_theme_constant_override("separation", 7)
	body.add_child(left)
	left.add_child(TerminalTheme.label(UIStrings.t("cv.list"), 13,
			Palette.MUTED, "medium"))
	var list_scroll := ScrollContainer.new()
	list_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	list_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	left.add_child(list_scroll)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 5)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list_scroll.add_child(list)
	if _rows.is_empty():
		list.add_child(TerminalTheme.label(UIStrings.t("cv.empty"), 13, Palette.DIM))
	else:
		for p in _rows:
			list.add_child(_cv_button(p))

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
	right.add_child(TerminalTheme.label(UIStrings.t("cv.detail"), 13,
			Palette.MUTED, "medium"))
	var detail_scroll := ScrollContainer.new()
	detail_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	detail_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	right.add_child(detail_scroll)
	_detail = VBoxContainer.new()
	_detail.add_theme_constant_override("separation", 8)
	_detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	detail_scroll.add_child(_detail)
	_build_detail()
	var open := Button.new()
	open.text = UIStrings.t("cv.open_position")
	open.add_theme_font_size_override("font_size", 13)
	open.custom_minimum_size = Vector2(0, 42)
	var selected := _selected_position()
	open.disabled = selected.is_empty()
	var pid := int(selected.get("id", 0))
	open.pressed.connect(func() -> void:
		if pid != 0:
			open_position.emit(pid))
	right.add_child(open)

func _cv_button(p: Dictionary) -> Button:
	var pid := int(p.get("id", 0))
	var score := "—" if p.get("total_score") == null else str(int(p["total_score"]))
	var verdict := _text(p.get("critic_verdict"))
	var marker := "▸ " if pid == _selected_id else "  "
	var when := _date(_text(p.get("written_at")))
	var btn := Button.new()
	btn.text = "%s[%s] %s\n   %s · %s%s" % [marker, score,
			_text_or(p.get("title"), "?"), _text_or(p.get("company"), "?"), when,
			" · " + verdict if verdict != "" else ""]
	btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	btn.add_theme_font_size_override("font_size", 13)
	btn.add_theme_color_override("font_color",
			Palette.GREEN if pid == _selected_id else Palette.BASE)
	btn.add_theme_color_override("font_hover_color", Palette.MINT)
	btn.pressed.connect(func() -> void:
		_selected_id = pid
		Sfx.play_tick()
		_rebuild())
	return btn

func _build_detail() -> void:
	var p := _selected_position()
	if p.is_empty():
		_detail.add_child(TerminalTheme.label(UIStrings.t("cv.select"), 14, Palette.DIM))
		return

	_detail.add_child(TerminalTheme.label(_text_or(p.get("title"), "?"), 20,
			Palette.WHITE, "xbold"))
	_detail.add_child(TerminalTheme.label(_text_or(p.get("company"), "?"), 15,
			Palette.BRIGHT, "medium"))
	var meta: Array[String] = []
	for key in ["role_family", "loc_city", "loc_country", "work_mode"]:
		var value := _text(p.get(key))
		if value != "" and not meta.has(value):
			meta.append(value)
	if not meta.is_empty():
		_detail.add_child(TerminalTheme.label(" · ".join(meta), 12, Palette.MUTED))
	_detail.add_child(HSeparator.new())

	var verdict := _text(p.get("critic_verdict"))
	var critic_score := "—" if p.get("critic_score") == null \
			else ("%.1f/10" % float(p["critic_score"]))
	_add_detail_row(UIStrings.t("cv.verdict"), verdict if verdict != "" else "—",
			_verdict_color(verdict))
	_add_detail_row(UIStrings.t("cv.critic_score"), critic_score, Palette.BRIGHT)
	_add_detail_row(UIStrings.t("cv.written_by"), "%s · %s" % [
			_text_or(p.get("written_by"), "—"), _date(_text(p.get("written_at")))],
			Palette.BASE)
	var reviewed_by := _text(p.get("reviewed_by"))
	if reviewed_by != "":
		_add_detail_row(UIStrings.t("cv.reviewed_by"), "%s · %s" % [reviewed_by,
				_date(_text(p.get("critic_reviewed_at")))], Palette.BASE)
	var notes := _text(p.get("critic_notes"))
	if notes != "":
		_detail.add_child(_paragraph(notes, Palette.BASE))
	_detail.add_child(HSeparator.new())

	_detail.add_child(TerminalTheme.label(UIStrings.t("cv.artifacts"), 13,
			Palette.MUTED, "medium"))
	var artifact_count := 0
	for doc in [["CV", "cv_path", "cv_pdf_path"],
			["COVER LETTER", "cl_path", "cl_pdf_path"]]:
		var md_path := _text(p.get(doc[1]))
		var pdf_path := _text(p.get(doc[2]))
		if md_path == "" and pdf_path == "":
			continue
		artifact_count += 1
		_add_artifact_row(str(doc[0]), md_path, pdf_path, p)
	if artifact_count == 0:
		_detail.add_child(TerminalTheme.label("—", 13, Palette.DIM))
	_detail.add_child(HSeparator.new())

	var match_score := "—" if p.get("total_score") == null \
			else "%d/100" % int(p["total_score"])
	_add_detail_row(UIStrings.t("cv.match"), match_score,
			Palette.MINT if p.get("total_score") != null and int(p["total_score"]) >= 70 \
			else Palette.YELLOW)
	var summary := _text(p.get("jd_summary"))
	if summary != "":
		_detail.add_child(_paragraph(summary, Palette.MUTED))

## Riga documento cliccabile: apre l'anteprima in-game (markdown reso
## nel tema terminale; il pdf passa dal viewer di sistema).
func _add_artifact_row(label_text: String, md_path: String, pdf_path: String,
		p: Dictionary) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_detail.add_child(row)
	var label := TerminalTheme.label(label_text, 11, Palette.MUTED, "medium")
	label.custom_minimum_size = Vector2(150, 0)
	row.add_child(label)
	var display := md_path if md_path != "" else pdf_path
	var btn := Button.new()
	btn.flat = true
	btn.clip_text = true
	btn.text = "▸ " + display.get_file()
	btn.tooltip_text = UIStrings.t("cv.preview")
	btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	btn.add_theme_font_size_override("font_size", 13)
	btn.add_theme_color_override("font_color", Palette.MINT)
	btn.add_theme_color_override("font_hover_color", Palette.GREEN)
	btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var doc_title := "%s · %s" % [_text_or(p.get("title"), "?"),
			_text_or(p.get("company"), "?")]
	btn.pressed.connect(func() -> void:
		Sfx.play_tick()
		add_child(DocPreviewPanel.new(md_path, pdf_path, doc_title)))
	row.add_child(btn)

func _add_detail_row(label_text: String, value: String, color: Color) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_detail.add_child(row)
	var label := TerminalTheme.label(label_text, 11, Palette.MUTED, "medium")
	label.custom_minimum_size = Vector2(150, 0)
	row.add_child(label)
	var val := TerminalTheme.label(value, 13, color, "medium")
	val.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	val.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(val)

func _paragraph(text: String, color: Color) -> RichTextLabel:
	return TerminalTheme.markdown_label(text, 12, color)

func _written_positions() -> Array:
	var result: Array = []
	for raw in BackendBus.positions:
		var p: Dictionary = raw
		var status := _text(p.get("status"))
		if _text(p.get("written_at")) != "" or status in ["ready", "applied", "response"]:
			result.append(p)
	result.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return _text(a.get("written_at")) > _text(b.get("written_at")))
	return result

func _selected_position() -> Dictionary:
	for p in _rows:
		if int(p.get("id", 0)) == _selected_id:
			return p
	return {}

func _contains_position(pid: int) -> bool:
	for p in _rows:
		if int(p.get("id", 0)) == pid:
			return true
	return false

func _verdict_color(verdict: String) -> Color:
	return {"PASS": Palette.GREEN, "NEEDS_WORK": Palette.YELLOW,
			"REJECT": Palette.RED}.get(verdict, Palette.DIM)

func _date(value: String) -> String:
	return "—" if value == "" else value.left(10)

func _text(value: Variant) -> String:
	if value == null:
		return ""
	var out := str(value).strip_edges()
	return "" if out == "<null>" else out

func _text_or(value: Variant, fallback: String) -> String:
	var out := _text(value)
	return fallback if out == "" else out

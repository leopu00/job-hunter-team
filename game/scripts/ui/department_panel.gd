class_name DepartmentPanel
extends CanvasLayer
## Pannello di reparto (click su una zona): nome, tagline e le postazioni
## con chi le occupa. Si chiude cliccando fuori dal pannello.

signal closed

var dept_id := ""

func _init(p_dept: String) -> void:
	dept_id = p_dept
	layer = 40

func _ready() -> void:
	var dept: Dictionary = DepartmentDefs.DEPARTMENTS[dept_id]
	var accent: Color = dept["color"]

	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = TerminalTheme.get_theme()
	add_child(root)
	var dim := ColorRect.new()
	dim.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.6)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed \
				and event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT]:
			close())
	root.add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(center)
	var panel := BracketPanel.new()
	panel.custom_minimum_size = Vector2(720, 0)
	center.add_child(panel)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 28)
	panel.add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	margin.add_child(box)

	var title_row := HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 12)
	box.add_child(title_row)
	title_row.add_child(TerminalTheme.label("▮", 26, accent, "xbold"))
	title_row.add_child(TerminalTheme.label(
			(dept["name"] as String).to_upper(), 26, Palette.WHITE, "xbold"))
	box.add_child(TerminalTheme.label(dept["tagline"], 16, Palette.MUTED))
	box.add_child(HSeparator.new())

	box.add_child(TerminalTheme.label(UIStrings.t("dept.desks"), 15, Palette.MUTED, "medium"))
	var desks: Array = dept["desks"]
	for i in desks.size():
		box.add_child(_desk_row(i, accent))

	var hint := TerminalTheme.label(UIStrings.t("dept.close"), 14, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(hint)
	Sfx.play_blip()

func close() -> void:
	Sfx.play_back()
	closed.emit()
	queue_free()

func _desk_row(index: int, accent: Color) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	var num := TerminalTheme.label("%02d" % (index + 1), 18, accent, "bold")
	num.custom_minimum_size = Vector2(36, 0)
	row.add_child(num)
	var occupant := CharacterDefs.desk_occupant(dept_id, index)
	if occupant.is_empty():
		row.add_child(TerminalTheme.label(UIStrings.t("dept.desk_free"), 16, Palette.DIM))
	else:
		var def: Dictionary = CharacterDefs.AGENTS[occupant]
		row.add_child(TerminalTheme.label(def["name"], 17, Palette.BRIGHT, "medium"))
		var status: Dictionary = TeamData.agent_status().get(occupant, {})
		if status.has("detail"):
			var detail := TerminalTheme.label(status["detail"], 14, Palette.MUTED)
			detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			detail.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			row.add_child(detail)
	return row

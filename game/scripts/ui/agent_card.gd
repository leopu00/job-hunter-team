class_name AgentCard
extends CanvasLayer
## Scheda agente al click: chi è (nome, ruolo, reparto, stato) e cosa ha
## fatto (ultime attività da TeamData). Da qui si apre il dialogo, se il
## ruolo ne ha uno. Click fuori per chiudere.

signal closed
signal talk_requested

var _agent: AgentNPC

func _init(agent: AgentNPC) -> void:
	_agent = agent
	layer = 40

func _ready() -> void:
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
	panel.custom_minimum_size = Vector2(640, 0)
	center.add_child(panel)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 26)
	panel.add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	margin.add_child(box)

	# intestazione: nome + reparto colorato
	var title_row := HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 12)
	box.add_child(title_row)
	var title := TerminalTheme.label(_agent.display_name.to_upper(), 24, Palette.WHITE, "xbold")
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_row.add_child(title)
	if _agent.dept != "":
		var dept: Dictionary = DepartmentDefs.DEPARTMENTS[_agent.dept]
		title_row.add_child(TerminalTheme.label(
				"▮ " + (dept["name"] as String).to_upper(), 16, dept["color"], "bold"))

	# stato dal team data
	var status: Dictionary = TeamData.agent_status().get(_agent.slug, {})
	if status.has("status"):
		var srow := HBoxContainer.new()
		srow.add_theme_constant_override("separation", 10)
		box.add_child(srow)
		srow.add_child(TerminalTheme.label("●", 14, Palette.GREEN))
		srow.add_child(TerminalTheme.label(status["status"], 16, Palette.MINT, "medium"))
		if status.has("detail"):
			var det := TerminalTheme.label(status["detail"], 14, Palette.MUTED)
			det.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			det.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			srow.add_child(det)
	# la scrivania com'è ADESSO: la pila di fogli è simulazione viva
	if _agent.pile:
		box.add_child(TerminalTheme.label(
				UIStrings.t("agent.pile") % _agent.pile.count, 14, Palette.MUTED))
	box.add_child(HSeparator.new())

	# cosa ha fatto: ultime attività
	box.add_child(TerminalTheme.label(UIStrings.t("agent.activity"), 15, Palette.MUTED, "medium"))
	var activity: Array = TeamData.agent_activity(_agent.slug)
	if activity.is_empty():
		box.add_child(TerminalTheme.label(UIStrings.t("agent.activity_none"), 15, Palette.DIM))
	for entry in activity:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 14)
		box.add_child(row)
		var when := TerminalTheme.label(entry["when"], 14, Palette.DIM)
		when.custom_minimum_size = Vector2(90, 0)
		row.add_child(when)
		row.add_child(TerminalTheme.label(entry["text"], 15, Palette.BASE))

	# azioni
	if Dialogues.TREES.has(_agent.slug):
		box.add_child(HSeparator.new())
		var talk := Button.new()
		talk.text = UIStrings.t("agent.talk")
		talk.add_theme_font_size_override("font_size", 17)
		talk.add_theme_color_override("font_color", Palette.GREEN)
		talk.pressed.connect(func() -> void:
			talk_requested.emit()
			close(false))
		box.add_child(talk)

	var hint := TerminalTheme.label(UIStrings.t("dept.close"), 13, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(hint)
	Sfx.play_blip()

func close(sound := true) -> void:
	if sound:
		Sfx.play_back()
	closed.emit()
	queue_free()

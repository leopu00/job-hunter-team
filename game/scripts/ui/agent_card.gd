class_name AgentCard
extends CanvasLayer
## Scheda agente al click: chi è (nome, ruolo, reparto, stato) e cosa ha
## fatto (ultime attività da TeamData). Da qui si apre il dialogo, se il
## ruolo ne ha uno. Click fuori per chiudere.

signal closed
signal talk_requested
signal chat_requested
signal thinking_requested
## Chiesta la scheda completa (sezione Agenti sulla pagina del ruolo,
## con i grafici storici di consumo).
signal stats_requested
signal coordinator_requested

var _agent: AgentNPC

func _init(agent: AgentNPC) -> void:
	_agent = agent
	layer = 40
	add_to_group("camera_blocking_overlay")

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
				"▮ " + DepartmentDefs.display_name(_agent.dept).to_upper(),
				16, dept["color"], "bold"))

	# Stato dell'ISTANZA reale, non il mock per ruolo. Corpo, badge e
	# scheda devono leggere lo stesso snapshot BackendBus.
	var status: Dictionary = {}
	if _agent.uid != "":
		var label := UIStrings.t("dept.agent_status.waiting")
		var color := Palette.MUTED
		match _agent.backend_status:
			"working":
				label = UIStrings.t("dept.agent_status.working")
				color = Palette.GREEN
			"paused":
				label = UIStrings.t("dept.agent_status.paused")
				color = Color("#ff7a65")
			"throttled":
				var total := int(ceil(_agent.throttle_secs))
				label = "THROTTLE %d:%02d" % [total / 60, total % 60]
				color = Color("#f5c518")
			"resting":
				label = UIStrings.t("dept.agent_status.resting")
				color = Color("#a855f7")
		status = {"status": label, "detail": _agent.activity_detail, "color": color}
	else:
		status = TeamData.agent_status().get(_agent.slug, {})
	if status.has("status"):
		var srow := HBoxContainer.new()
		srow.add_theme_constant_override("separation", 10)
		box.add_child(srow)
		var status_color: Color = status.get("color", Palette.MINT)
		srow.add_child(TerminalTheme.label("●", 14, status_color))
		srow.add_child(TerminalTheme.label(status["status"], 16, status_color, "medium"))
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
	var activity: Array = []
	if _agent.uid != "":
		for transition in BackendBus.transitions:
			if str(transition.get("by_agent", "")) != _agent.uid:
				continue
			var what := str(transition.get("title", ""))
			var company := str(transition.get("company", ""))
			if company != "":
				what += (" · " if what != "" else "") + company
			activity.append({"when": str(transition.get("ts", "")).replace("T", " ").left(16),
					"text": "%s → %s" % [what if what != "" else "posizione",
							str(transition.get("to_state", "?"))]})
			if activity.size() >= 5:
				break
	else:
		activity = TeamData.agent_activity(_agent.slug)
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
	box.add_child(HSeparator.new())
	if _agent.slug == "coordinatore":
		var control := Button.new()
		control.text = UIStrings.t("coord.open")
		control.add_theme_font_size_override("font_size", 18)
		control.add_theme_color_override("font_color", _agent.accent_color())
		control.tooltip_text = UIStrings.t("coord.open_tip")
		control.pressed.connect(func() -> void:
			coordinator_requested.emit()
			close(false))
		box.add_child(control)
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 10)
	box.add_child(actions)
	var thinking := Button.new()
	thinking.text = UIStrings.t("agent.thinking")
	thinking.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	thinking.add_theme_font_size_override("font_size", 17)
	thinking.add_theme_color_override("font_color",
			_agent.accent_color() if _agent.uid != "" else Palette.DIM)
	thinking.disabled = _agent.uid == "" or not BackendBus.can_chat_with(_agent.uid)
	thinking.tooltip_text = UIStrings.t("agent.thinking_unavailable") \
			if thinking.disabled else UIStrings.t("agent.thinking_tooltip")
	thinking.pressed.connect(func() -> void:
		thinking_requested.emit()
		close(false))
	actions.add_child(thinking)
	# chat REALE col team: dal canale 1053f1ce OGNI agente del roster è
	# raggiungibile — il pulsante c'è sempre. Il vecchio PARLA (dialoghi
	# finti) è stato TOLTO su ordine di Leone (test finale: "inutile").
	if BackendBus.can_chat_with(_agent.slug) or ScriptedOnboarding.supports(_agent.slug):
		var chat := Button.new()
		chat.text = UIStrings.t("agent.chat")
		chat.add_theme_font_size_override("font_size", 17)
		chat.add_theme_color_override("font_color", Palette.GREEN)
		chat.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		chat.pressed.connect(func() -> void:
			chat_requested.emit()
			close(false))
		actions.add_child(chat)
	var stats := Button.new()
	stats.text = UIStrings.t("agent.stats")
	stats.add_theme_font_size_override("font_size", 17)
	stats.add_theme_color_override("font_color", Palette.BLUE)
	stats.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	stats.pressed.connect(func() -> void:
		stats_requested.emit()
		close(false))
	actions.add_child(stats)

	var hint := TerminalTheme.label(UIStrings.t("dept.close"), 13, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(hint)
	Sfx.play_blip()

func close(sound := true) -> void:
	if sound:
		Sfx.play_back()
	closed.emit()
	queue_free()

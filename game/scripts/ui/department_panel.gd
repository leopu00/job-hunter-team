class_name DepartmentPanel
extends CanvasLayer
## Pannello di reparto (click su una zona): nome, tagline e le postazioni
## con chi le occupa. Si chiude cliccando fuori dal pannello.

signal closed

var dept_id := ""

func _init(p_dept: String) -> void:
	dept_id = p_dept
	layer = 40
	add_to_group("camera_blocking_overlay")

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
			DepartmentDefs.display_name(dept_id).to_upper(), 26, Palette.WHITE, "xbold"))
	box.add_child(TerminalTheme.label(DepartmentDefs.display_tagline(dept_id), 16, Palette.MUTED))
	# Il numero e' mostrabile soltanto quando la sorgente e' attestata. In
	# UNAVAILABLE perfino uno zero suggerirebbe una coda osservata davvero.
	if PaperPile.inbox.has(dept_id) \
			and SimBadge.current_state() != SimBadge.DataState.UNAVAILABLE:
		box.add_child(TerminalTheme.label(
				UIStrings.t("dept.inbox") % PaperPile.inbox[dept_id].count,
				14, Palette.MUTED))
	box.add_child(HSeparator.new())

	box.add_child(TerminalTheme.label(UIStrings.t("dept.desks"), 15, Palette.MUTED, "medium"))
	var desks: Array = dept["desks"]
	for i in desks.size():
		box.add_child(_desk_row(i, accent))

	# Gli Scout producono l'ingresso dell'intera pipeline: il pannello mostra
	# l'andamento temporale reale delle posizioni trovate sulla VPS.
	if dept_id == "scout" \
			and SimBadge.current_state() != SimBadge.DataState.UNAVAILABLE:
		box.add_child(HSeparator.new())
		box.add_child(TerminalTheme.label(UIStrings.t("dept.scout.positions_timeline"),
				15, Palette.MUTED, "medium"))
		var timeline := PositionsTimeline.new(accent)
		box.add_child(timeline)
		BackendBus.positions_updated.connect(timeline.set_positions)

	# Le righe TeamData appartengono esclusivamente alla fixture DEMO.
	var role_slug: String = CharacterDefs.DEPT_ROLES[dept_id]["slug"]
	box.add_child(HSeparator.new())
	var demo_data := SimBadge.synthetic_data_allowed()
	var status: Dictionary = TeamData.agent_status().get(role_slug, {}) \
			if demo_data else {}
	if status.has("detail"):
		var srow := HBoxContainer.new()
		srow.add_theme_constant_override("separation", 10)
		box.add_child(srow)
		srow.add_child(TerminalTheme.label("●", 14, accent))
		srow.add_child(TerminalTheme.label(status.get("status", ""), 15, Palette.MINT, "medium"))
		var det := TerminalTheme.label(status["detail"], 14, Palette.MUTED)
		det.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		det.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		srow.add_child(det)
	box.add_child(TerminalTheme.label(UIStrings.t("agent.activity"), 15, Palette.MUTED, "medium"))
	var activity: Array = TeamData.agent_activity(role_slug) if demo_data else []
	if activity.is_empty():
		box.add_child(TerminalTheme.label(UIStrings.t("agent.activity_none"),
				15, Palette.DIM))
	for entry in activity:
		var arow := HBoxContainer.new()
		arow.add_theme_constant_override("separation", 14)
		box.add_child(arow)
		var when := TerminalTheme.label(entry["when"], 14, Palette.DIM)
		when.custom_minimum_size = Vector2(90, 0)
		arow.add_child(when)
		arow.add_child(TerminalTheme.label(entry["text"], 15, Palette.BASE))

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
	# I nomi assegnati staticamente alle postazioni sono una fixture authored.
	# Fuori da DEMO non dichiariamo nemmeno la scrivania libera: senza un
	# mapping live per banco la sola risposta veritiera e' indisponibile.
	if not SimBadge.synthetic_data_allowed():
		row.add_child(TerminalTheme.label("—", 16, Palette.DIM))
		return row
	var occupant := CharacterDefs.desk_occupant_name(dept_id, index)
	if occupant.is_empty():
		row.add_child(TerminalTheme.label(UIStrings.t("dept.desk_free"), 16, Palette.DIM))
	else:
		var role_slug := CharacterDefs.desk_occupant_slug(dept_id, index)
		# La targa della postazione segue il NUMERO del banco, non chi ci si è
		# seduto per primo: è la stessa regola con cui l'ufficio assegna
		# scrivania e volto (Office._desk_index_from_uid, `scout-5` → quinto
		# banco). Il banco `index` appartiene quindi all'istanza `index + 1`, e
		# il suo cognome è lo stesso a ogni riavvio. La riga mostra già il
		# numero a sinistra e il reparto è nel titolo: basta il cognome.
		var plate := AgentNames.short_name(
				"%s-%d" % [role_slug, index + 1], occupant)
		row.add_child(TerminalTheme.label(plate, 17, Palette.BRIGHT, "medium"))
		var status: Dictionary = TeamData.agent_status().get(role_slug, {}) \
				if SimBadge.synthetic_data_allowed() else {}
		if status.has("status"):
			var detail := TerminalTheme.label(status["status"], 14, Palette.MUTED)
			detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			detail.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			row.add_child(detail)
	return row

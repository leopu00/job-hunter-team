class_name ChatMenu
extends CanvasLayer
## Menu delle chat 1-a-1 (feedback test finale): la lista degli agenti
## in scena, ognuno apribile in conversazione individuale col canale
## reale. Il pallino dice se la risposta è garantita (skill chat-web,
## bus.chat_replies) o solo best-effort. Tasto C oppure dal mondo.

signal open_chat(slug: String, display_name: String)
signal closed

const PANEL_W := 380.0

var _agents: Array = []  # [{slug, name}]

func _init(agents: Array) -> void:
	for a in agents:
		_agents.append({"slug": a.slug if a.uid == "" else a.uid,
				"name": a.display_name})
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
		if event is InputEventMouseButton and event.pressed:
			close())
	root.add_child(dim)

	var panel := BracketPanel.new()
	panel.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	panel.custom_minimum_size = Vector2(PANEL_W, 0)
	panel.offset_left = -PANEL_W - 24
	panel.offset_right = -24
	panel.offset_top = 24
	panel.offset_bottom = -24
	root.add_child(panel)
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 20)
	panel.add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	margin.add_child(box)

	box.add_child(TerminalTheme.label(UIStrings.t("chat.menu"), 20,
			Palette.WHITE, "xbold"))
	box.add_child(HSeparator.new())
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	box.add_child(scroll)
	var list := VBoxContainer.new()
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list.add_theme_constant_override("separation", 4)
	scroll.add_child(list)

	for a in _agents:
		var entry: Dictionary = a
		var btn := Button.new()
		var sure: bool = BackendBus.chat_replies(entry["slug"])
		btn.text = "%s  %s" % ["●" if sure else "◐", entry["name"]]
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.add_theme_font_size_override("font_size", 16)
		btn.add_theme_color_override("font_color",
				Palette.GREEN if sure else Palette.MUTED)
		btn.pressed.connect(func() -> void:
			open_chat.emit(entry["slug"], entry["name"])
			close(false))
		list.add_child(btn)

	# legenda pallini
	box.add_child(HSeparator.new())
	var legend := TerminalTheme.label(
			"● " + UIStrings.t("chat.replies") + "   ◐ " \
			+ UIStrings.t("chat.maybe"), 12, Palette.DIM)
	legend.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(legend)
	var hint := TerminalTheme.label(UIStrings.t("dept.close"), 13, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(hint)
	Sfx.play_blip()

func close(sound := true) -> void:
	if sound:
		Sfx.play_back()
	closed.emit()
	queue_free()

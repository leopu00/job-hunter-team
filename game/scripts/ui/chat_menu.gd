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
var _buttons: Dictionary = {}
var _closing := false

func _init(agents: Array) -> void:
	for a in agents:
		var entry: Dictionary
		if a is Dictionary:
			entry = {"slug": str(a.get("slug", "")), "name": str(a.get("name", ""))}
		else:
			entry = {"slug": a.slug if a.uid == "" else a.uid,
					"name": a.display_name}
		if BackendBus.chat_replies(entry["slug"]) \
				or ScriptedOnboarding.supports(entry["slug"]):
			_agents.append(entry)
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

	var head := HBoxContainer.new()
	box.add_child(head)
	var title := TerminalTheme.label(UIStrings.t("chat.menu"), 20,
			Palette.WHITE, "xbold")
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	var close_btn := Button.new()
	close_btn.text = "✕"
	close_btn.tooltip_text = UIStrings.t("chat.close")
	close_btn.add_theme_color_override("font_color", Palette.MUTED)
	close_btn.pressed.connect(close)
	head.add_child(close_btn)
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
		var sure: bool = BackendBus.chat_replies(entry["slug"]) \
				or ScriptedOnboarding.supports(entry["slug"])
		btn.text = "%s  %s" % ["●" if sure else "◐", entry["name"]]
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.add_theme_font_size_override("font_size", 16)
		btn.add_theme_color_override("font_color",
				Palette.GREEN if sure else Palette.MUTED)
		btn.pressed.connect(func() -> void:
			open_chat.emit(entry["slug"], entry["name"])
			close(false))
		_buttons[entry["slug"]] = btn
		list.add_child(btn)
	_refresh_unread()
	BackendBus.chat_unread_changed.connect(func(_unread: Dictionary) -> void:
		_refresh_unread())

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
	if _closing:
		return
	_closing = true
	if sound:
		Sfx.play_back()
	closed.emit()
	queue_free()

func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo \
			and event.keycode in [KEY_ESCAPE, KEY_C]:
		get_viewport().set_input_as_handled()
		close()

func _refresh_unread() -> void:
	for slug in _buttons:
		var btn: Button = _buttons[slug]
		var count := BackendBus.chat_unread_count(slug)
		var entry: Dictionary = _agents.filter(func(a: Dictionary) -> bool:
			return a["slug"] == slug)[0]
		btn.text = "●  %s%s" % [entry["name"], "  [%d]" % count if count > 0 else ""]
		btn.add_theme_color_override("font_color",
				Palette.YELLOW if count > 0 else Palette.GREEN)

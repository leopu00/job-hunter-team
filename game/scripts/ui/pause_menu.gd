extends CanvasLayer
## Menu pausa: overlay scuro + pannello brackets con le tre azioni.
## Istanziato da Game.open_pause(); si distrugge con Game.close_pause().

func _init() -> void:
	layer = 90
	process_mode = Node.PROCESS_MODE_ALWAYS

func _ready() -> void:
	var dim := ColorRect.new()
	dim.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.78)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	center.theme = TerminalTheme.get_theme()
	add_child(center)

	var panel := BracketPanel.new()
	center.add_child(panel)

	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(420, 0)
	box.add_theme_constant_override("separation", 14)
	panel.add_child(box)

	var title := TerminalTheme.label(UIStrings.t("pause.title"), 30, Palette.WHITE, "xbold")
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)
	box.add_child(HSeparator.new())

	_add_button(box, UIStrings.t("pause.resume"), func() -> void: Game.close_pause())
	_add_button(box, UIStrings.t("pause.window"), func() -> void: Game.toggle_fullscreen())
	_add_button(box, UIStrings.t("pause.quit"), func() -> void: Game.quit_game())

func _add_button(parent: Node, text: String, action: Callable) -> void:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_ALL
	b.pressed.connect(func() -> void:
		Sfx.play_blip()
		action.call())
	parent.add_child(b)
	if parent.get_child_count() == 3:  # primo bottone dopo titolo+separatore
		b.grab_focus.call_deferred()

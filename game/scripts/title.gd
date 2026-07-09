extends Control
## Title screen: wordmark JHT in stile terminale, "PREMI INVIO" lampeggiante.

## Key art pittorica (gen-art); se assente, griglia terminale.
const KEY_ART := "res://assets/gen-art/environment/title_screen.png"

var _blink: Label
var _time := 0.0

func _ready() -> void:
	theme = TerminalTheme.get_theme()
	set_anchors_preset(Control.PRESET_FULL_RECT)

	# exists() è true anche col solo .import: carichiamo e verifichiamo il null,
	# così senza il binario dipinto parte il fallback a griglia (non uno schermo vuoto).
	var art_tex: Texture2D = load(KEY_ART) if ResourceLoader.exists(KEY_ART) else null
	var has_art := art_tex != null
	if has_art:
		var art := TextureRect.new()
		art.texture = art_tex
		art.set_anchors_preset(Control.PRESET_FULL_RECT)
		art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		art.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(art)
		var veil := ColorRect.new()
		veil.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.30)
		veil.set_anchors_preset(Control.PRESET_FULL_RECT)
		veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(veil)
	else:
		var bg := GridBackground.new()
		bg.set_anchors_preset(Control.PRESET_FULL_RECT)
		add_child(bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)

	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	center.add_child(box)
	if has_art:
		# spinge il wordmark nel terzo basso: la box dipinta resta la protagonista
		var art_spacer := Control.new()
		art_spacer.custom_minimum_size = Vector2(0, 620)
		box.add_child(art_spacer)

	var panel := BracketPanel.new()
	panel.bracket_len = 22
	box.add_child(panel)
	var inner := VBoxContainer.new()
	inner.add_theme_constant_override("separation", 4)
	panel.add_child(inner)

	var pad := MarginContainer.new()
	pad.add_theme_constant_override("margin_left", 46)
	pad.add_theme_constant_override("margin_right", 46)
	pad.add_theme_constant_override("margin_top", 30)
	pad.add_theme_constant_override("margin_bottom", 30)
	inner.add_child(pad)
	var pad_box := VBoxContainer.new()
	pad_box.add_theme_constant_override("separation", 6)
	pad.add_child(pad_box)

	var word := TerminalTheme.label(UIStrings.t("title.wordmark"), 76, Palette.WHITE, "xbold")
	word.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	pad_box.add_child(word)

	var sub := TerminalTheme.label(UIStrings.t("title.subtitle"), 26, Palette.GREEN, "medium")
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	pad_box.add_child(sub)

	var spacer := Control.new()
	spacer.custom_minimum_size = Vector2(0, 56)
	box.add_child(spacer)

	_blink = TerminalTheme.label(UIStrings.t("title.press_enter"), 24, Palette.BASE, "medium")
	_blink.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_blink)

	var footer := TerminalTheme.label(UIStrings.t("title.footer"), 15, Palette.DIM)
	footer.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	footer.position = Vector2(28, -40)
	footer.grow_vertical = Control.GROW_DIRECTION_BEGIN
	add_child(footer)

func _process(delta: float) -> void:
	_time += delta
	_blink.visible = fmod(_time, 1.1) < 0.72

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_accept"):
		Sfx.play_confirm()
		Game.goto_wizard()

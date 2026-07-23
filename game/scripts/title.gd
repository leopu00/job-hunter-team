extends Control
## Title screen: wordmark JHT in stile terminale, "PREMI INVIO" lampeggiante.

## Key art pittorica (gen-art); se assente, griglia terminale.
const KEY_ART := "res://assets/gen-art/environment/title_screen.png"

var _blink: Label
var _time := 0.0
var _leaving := false

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
	# Pulse via alpha, MAI via visible: il toggle di visibilità dentro il
	# VBoxContainer collassa il label e il container ricentra tutto (il
	# "titolo che oscilla" visto da Leone).
	_blink.modulate.a = 0.35 + 0.65 * maxf(0.0, sin(_time * 2.6))

func _unhandled_input(event: InputEvent) -> void:
	# INVIO oppure click/tap: su desktop il mouse è il gesto naturale e
	# "PREMI INVIO" da solo lasciava utenti fermi al titolo.
	var clicked := false
	var mb := event as InputEventMouseButton
	if mb != null:
		clicked = mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT
	if (event.is_action_pressed("ui_accept") or clicked) and not _leaving:
		_leaving = true
		Sfx.play_confirm()
		# Primo avvio: prima dell'ufficio ci si presenta — così l'Assistente
		# può chiamare l'utente per nome fin dal primo saluto (Leone 22/07).
		if ScriptedOnboarding.player_first_name() == "" and TourGuide.active():
			_show_name_entry()
		else:
			_fade_out()


## Modulo di presentazione: nome (necessario per proseguire col nome) e
## cognome facoltativo; chi preferisce può entrare senza dirlo.
func _show_name_entry() -> void:
	var dim := ColorRect.new()
	dim.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.72)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(dim)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var panel := BracketPanel.new()
	panel.bracket_len = 22
	center.add_child(panel)
	var pad := MarginContainer.new()
	for side in ["left", "right"]:
		pad.add_theme_constant_override("margin_" + side, 46)
	for side in ["top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 34)
	panel.add_child(pad)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	pad.add_child(box)

	var title := TerminalTheme.label(UIStrings.t("title.name_title"), 26,
			Palette.WHITE, "xbold")
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)
	var sub := TerminalTheme.label(UIStrings.t("title.name_sub"), 15, Palette.BASE)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(sub)

	var first := LineEdit.new()
	first.placeholder_text = UIStrings.t("title.name_first")
	first.custom_minimum_size = Vector2(420, 0)
	first.max_length = 40
	box.add_child(first)
	var last := LineEdit.new()
	last.placeholder_text = UIStrings.t("title.name_last")
	last.custom_minimum_size = Vector2(420, 0)
	last.max_length = 60
	box.add_child(last)

	var enter := Button.new()
	enter.text = UIStrings.t("title.name_enter")
	enter.disabled = true
	box.add_child(enter)
	var skip := Button.new()
	skip.flat = true
	skip.text = UIStrings.t("title.name_skip")
	skip.add_theme_font_size_override("font_size", 13)
	skip.add_theme_color_override("font_color", Palette.MUTED)
	skip.add_theme_color_override("font_hover_color", Palette.WHITE)
	box.add_child(skip)

	var confirm := func() -> void:
		if first.text.strip_edges().is_empty():
			return
		ScriptedOnboarding.set_player_name(first.text, last.text)
		Sfx.play_confirm()
		_fade_out()
	first.text_changed.connect(func(value: String) -> void:
		enter.disabled = value.strip_edges().is_empty())
	first.text_submitted.connect(func(_v: String) -> void: last.grab_focus())
	last.text_submitted.connect(func(_v: String) -> void: confirm.call())
	enter.pressed.connect(confirm)
	skip.pressed.connect(func() -> void:
		Sfx.play_back()
		_fade_out())
	first.grab_focus()

## Dissolvenza a nero sopra tutto, poi sempre nell'ufficio. Il setup non è
## più un tunnel prima del prodotto: container, provider e profilo si
## completano dall'ufficio attraverso la checklist Attiva team.
func _fade_out() -> void:
	var veil := ColorRect.new()
	veil.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.0)
	veil.set_anchors_preset(Control.PRESET_FULL_RECT)
	veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(veil)
	var tw := create_tween()
	tw.tween_property(veil, "color:a", 1.0, 0.4)
	tw.tween_callback(Game.goto_office)

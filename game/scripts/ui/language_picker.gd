extends Control
## Prima superficie interattiva di una nuova installazione. La scelta resta
## qui, separata dalla title screen, per impedire che qualunque testo del gioco
## preceda la lingua che lo deve rendere leggibile.

signal language_confirmed(language: String)

var selected_language := UIStrings.DEFAULT_LANG
var _language_buttons := {}
var _continue: Button

func _ready() -> void:
	theme = TerminalTheme.get_theme()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	_build()


func choose_language(language: String) -> void:
	if not UIStrings.LANGS.has(language):
		return
	selected_language = language
	_refresh_selection()


func confirm() -> void:
	language_confirmed.emit(selected_language)


func supported_language_count() -> int:
	return _language_buttons.size()


func _build() -> void:
	var bg := GridBackground.new()
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(center)
	var panel := BracketPanel.new()
	panel.bracket_len = 22
	center.add_child(panel)
	var padding := MarginContainer.new()
	for side in ["left", "right"]:
		padding.add_theme_constant_override("margin_" + side, 42)
	for side in ["top", "bottom"]:
		padding.add_theme_constant_override("margin_" + side, 34)
	panel.add_child(padding)
	var box := VBoxContainer.new()
	box.custom_minimum_size = Vector2(520, 0)
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 14)
	padding.add_child(box)

	var eyebrow := TerminalTheme.label(UIStrings.t("language_picker.eyebrow"),
			13, Palette.MINT, "bold")
	eyebrow.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(eyebrow)
	var title := TerminalTheme.label(UIStrings.t("language_picker.title"),
			30, Palette.WHITE, "xbold")
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)
	var subtitle := TerminalTheme.label(UIStrings.t("language_picker.subtitle"),
			15, Palette.BASE)
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	subtitle.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(subtitle)
	box.add_child(HSeparator.new())

	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 8)
	box.add_child(grid)
	for language: String in UIStrings.LANGS:
		var button := Button.new()
		button.flat = true
		button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		button.custom_minimum_size = Vector2(220, 42)
		button.add_theme_font_size_override("font_size", 17)
		button.add_theme_color_override("font_hover_color", Palette.MINT)
		button.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		button.pressed.connect(choose_language.bind(language))
		grid.add_child(button)
		_language_buttons[language] = button

	box.add_child(HSeparator.new())
	_continue = Button.new()
	_continue.custom_minimum_size = Vector2(0, 44)
	_continue.add_theme_font_size_override("font_size", 16)
	_continue.pressed.connect(confirm)
	box.add_child(_continue)
	_refresh_selection()
	(_language_buttons[selected_language] as Button).grab_focus.call_deferred()


func _refresh_selection() -> void:
	for language: String in _language_buttons:
		var button := _language_buttons[language] as Button
		var selected := language == selected_language
		button.text = ("▸ " if selected else "  ") + str(UIStrings.LANGS[language])
		button.add_theme_color_override("font_color",
				Palette.GREEN if selected else Palette.BASE)
	if is_instance_valid(_continue):
		_continue.text = UIStrings.t("language_picker.continue") \
				% str(UIStrings.LANGS[selected_language])

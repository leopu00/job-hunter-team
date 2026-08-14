extends Control
## Prima superficie interattiva di una nuova installazione. La scelta resta
## qui, separata dalla title screen, per impedire che qualunque testo del gioco
## preceda la lingua che lo deve rendere leggibile.

signal language_confirmed(language: String)

const KEY_ART := "res://assets/gen-art/environment/title_screen.png"
const PANEL_MIN_WIDTH := 680.0
const SAFE_MARGIN := 24.0

var selected_language := UIStrings.DEFAULT_LANG
var _language_buttons := {}
var _continue: Button

func _ready() -> void:
	theme = TerminalTheme.get_theme()
	# Il picker nasce da codice durante Title._ready(): le sole ancore lasciano
	# gli offset derivati dalla minimum size finche il parent non completa il
	# primo layout. In fullscreen macOS il risultato era un rettangolo grande
	# quanto il pannello, ancorato in alto a sinistra. Ancore E offset fissano
	# invece subito il layer all'intero viewport e continuano a seguirne i resize.
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
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
	# Il gate e' la prima schermata del prodotto: deve avere un fondale completo
	# anche prima che Title costruisca la propria UI. Il TextureRect copre ogni
	# aspect ratio supportato; il velo mantiene leggibili testo e focus senza
	# trasformare il resto della finestra in un rettangolo nero vuoto.
	var art_tex: Texture2D = load(KEY_ART) if ResourceLoader.exists(KEY_ART) else null
	if art_tex != null:
		var art := TextureRect.new()
		art.name = "LanguageGateArtwork"
		art.texture = art_tex
		art.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		art.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		art.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(art)
		art.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	else:
		var fallback := ColorRect.new()
		fallback.name = "LanguageGateArtwork"
		fallback.color = Palette.DEEP
		fallback.mouse_filter = Control.MOUSE_FILTER_IGNORE
		add_child(fallback)
		fallback.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	var veil := ColorRect.new()
	veil.name = "LanguageGateVeil"
	veil.color = Color(Palette.DEEP.r, Palette.DEEP.g, Palette.DEEP.b, 0.72)
	veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(veil)
	veil.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	var bg := GridBackground.new()
	bg.name = "LanguageGateGrid"
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	# GridBackground assegna Palette.VOID al trasparente nel proprio _ready;
	# impostiamo l'alpha dopo l'ingresso nell'albero per lasciare visibile l'art.
	bg.bg_color = Color(0, 0, 0, 0)
	bg.queue_redraw()
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)

	var center := CenterContainer.new()
	center.name = "LanguageGateCenter"
	add_child(center)
	center.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	var panel := BracketPanel.new()
	panel.name = "LanguageGatePanel"
	panel.bracket_len = 22
	var panel_style := StyleBoxFlat.new()
	panel_style.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.97)
	panel_style.border_color = Palette.BORDER_GLOW
	panel_style.set_border_width_all(TerminalTheme.hairline())
	panel_style.set_corner_radius_all(0)
	panel.add_theme_stylebox_override("panel", panel_style)
	center.add_child(panel)
	var padding := MarginContainer.new()
	padding.name = "LanguageGatePadding"
	for side in ["left", "right"]:
		padding.add_theme_constant_override("margin_" + side, 50)
	for side in ["top", "bottom"]:
		padding.add_theme_constant_override("margin_" + side, 38)
	panel.add_child(padding)
	var box := VBoxContainer.new()
	box.name = "LanguageGateContent"
	box.custom_minimum_size = Vector2(PANEL_MIN_WIDTH, 0)
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 16)
	padding.add_child(box)

	var eyebrow := TerminalTheme.label(UIStrings.t("language_picker.eyebrow"),
			14, Palette.MINT, "bold")
	eyebrow.name = "LanguageGateEyebrow"
	eyebrow.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(eyebrow)
	var title := TerminalTheme.label(UIStrings.t("language_picker.title"),
			36, Palette.WHITE, "xbold")
	title.name = "LanguageGateTitle"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)
	var subtitle := TerminalTheme.label(UIStrings.t("language_picker.subtitle"),
			16, Palette.BASE)
	subtitle.name = "LanguageGateSubtitle"
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	subtitle.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(subtitle)
	box.add_child(HSeparator.new())

	var grid := GridContainer.new()
	grid.name = "LanguageGateLanguages"
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 10)
	box.add_child(grid)
	var ordered_buttons: Array[Button] = []
	for language: String in UIStrings.LANGS:
		var button := Button.new()
		button.name = "Language_%s" % language
		button.focus_mode = Control.FOCUS_ALL
		button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		button.custom_minimum_size = Vector2(320, 48)
		button.add_theme_font_size_override("font_size", 17)
		button.add_theme_color_override("font_hover_color", Palette.MINT)
		button.add_theme_color_override("font_focus_color", Palette.MINT)
		# Non cancellare il focus: al primo avvio la tastiera deve mostrare
		# chiaramente dove andra' INVIO. Il bordo da 2 px resta visibile anche
		# dopo lo scaling 1366x768 del canvas 1920x1080.
		var focus_style := StyleBoxFlat.new()
		focus_style.bg_color = Palette.ROW
		focus_style.border_color = Palette.MINT
		focus_style.set_border_width_all(2)
		focus_style.set_corner_radius_all(0)
		focus_style.content_margin_left = 18
		focus_style.content_margin_right = 18
		focus_style.content_margin_top = 8
		focus_style.content_margin_bottom = 8
		button.add_theme_stylebox_override("focus", focus_style)
		button.pressed.connect(choose_language.bind(language))
		grid.add_child(button)
		_language_buttons[language] = button
		ordered_buttons.append(button)

	box.add_child(HSeparator.new())
	_continue = Button.new()
	_continue.name = "LanguageGateContinue"
	_continue.focus_mode = Control.FOCUS_ALL
	_continue.custom_minimum_size = Vector2(0, 52)
	_continue.add_theme_font_size_override("font_size", 18)
	_continue.add_theme_color_override("font_color", Palette.GREEN)
	_continue.add_theme_color_override("font_focus_color", Palette.MINT)
	_continue.pressed.connect(confirm)
	box.add_child(_continue)
	_configure_keyboard_path(ordered_buttons)
	_refresh_selection()
	(_language_buttons[selected_language] as Button).grab_focus.call_deferred()


func _configure_keyboard_path(buttons: Array[Button]) -> void:
	# Tab percorre le lingue nell'ordine visivo e termina sull'azione primaria;
	# Shift+Tab compie il percorso inverso. I vicini verticali seguono le due
	# colonne e portano all'azione quando non esiste un'altra riga.
	var path: Array[Button] = buttons.duplicate()
	path.append(_continue)
	for i in path.size():
		var current := path[i]
		var next := path[(i + 1) % path.size()]
		var previous := path[(i - 1 + path.size()) % path.size()]
		current.focus_next = current.get_path_to(next)
		current.focus_previous = current.get_path_to(previous)
	for i in buttons.size():
		var current := buttons[i]
		if i % 2 == 1:
			current.focus_neighbor_left = current.get_path_to(buttons[i - 1])
		elif i + 1 < buttons.size():
			current.focus_neighbor_right = current.get_path_to(buttons[i + 1])
		if i >= 2:
			current.focus_neighbor_top = current.get_path_to(buttons[i - 2])
		current.focus_neighbor_bottom = current.get_path_to(
				buttons[i + 2] if i + 2 < buttons.size() else _continue)
	_continue.focus_neighbor_top = _continue.get_path_to(buttons[buttons.size() - 1])


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

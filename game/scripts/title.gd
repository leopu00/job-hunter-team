extends Control
## Title screen: wordmark JHT in stile terminale, "PREMI INVIO" lampeggiante.

## Key art pittorica (gen-art); se assente, griglia terminale.
const KEY_ART := "res://assets/gen-art/environment/title_screen.png"
const LanguagePicker := preload("res://scripts/ui/language_picker.gd")
const FORBIDDEN_TITLE_FOOTER_FRAGMENTS := [
	"dati mock", "mock data", "mock adatok", "datos mock", "mock-daten",
	"données mock", "dados mock",
]

var _blink: Label
var _version_label: Label
var _time := 0.0
var _leaving := false
var _language_picker: Control
var _language_test_choice := ""

func _ready() -> void:
	# La guardia PRIMA dell'attesa, come negli altri otto consumatori: e'
	# sincrona e decide se questa istanza puo' esistere, mentre l'health boot
	# decide solo se l'aggiornamento le permette di lavorare adesso. Con il
	# solo gate dell'health il titolo proseguiva quando la guardia aveva gia'
	# detto di no — in `guard-source` l'health non e' nemmeno richiesto, quindi
	# non blocca nulla, e questa schermata era l'unica delle nove a lavorare
	# dopo un rifiuto.
	if not WindowsInstanceGuard.normal_work_allowed():
		return
	if not await Game.windows_health_boot_allowed():
		return
	_start_normal_title_boot()


func _start_normal_title_boot() -> void:
	Game.mark_windows_health_normal_work("title")
	theme = TerminalTheme.get_theme()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	if TutorialHarness.cleanup_test():
		TutorialHarness.clear_storage()
		print("TUTORIAL-HARNESS-CLEANUP PASS")
		get_tree().quit()
		return
	var persistence_test := OS.get_environment("JHT_LANGUAGE_PERSIST_TEST")
	if persistence_test == "cleanup":
		DirAccess.remove_absolute(ProjectSettings.globalize_path(UIStrings.language_config_path()))
		print("LANGUAGE-PERSISTENCE-CLEANUP PASS")
		get_tree().quit()
		return
	# Su una macchina appena installata non mostriamo neppure la title screen
	# prima di sapere in quale lingua costruirla. Il fallback è inglese, mai il
	# locale del sistema o l'italiano storico.
	if UIStrings.needs_initial_language_choice():
		_show_language_picker()
		if OS.get_environment("JHT_LANGUAGE_PICKER_TEST") == "1":
			var layout_shot := OS.get_environment("JHT_LANGUAGE_PICKER_SHOT")
			if layout_shot != "":
				_language_picker_screenshot.call_deferred(layout_shot)
			else:
				_language_picker_selftest.call_deferred()
		elif persistence_test == "write":
			_language_persistence_write_selftest.call_deferred()
		elif persistence_test == "save_failure":
			_language_persistence_save_failure_selftest.call_deferred()
		elif TutorialHarness.auto_test():
			_tutorial_harness_autotest.call_deferred()
		elif TutorialHarness.persistence_test():
			_tutorial_harness_persistence_test.call_deferred()
		return
	_build_title()
	if persistence_test == "verify":
		_language_persistence_verify_selftest.call_deferred()
	if TutorialHarness.auto_test():
		_tutorial_harness_autotest.call_deferred()
	elif TutorialHarness.persistence_test():
		_tutorial_harness_persistence_test.call_deferred()


func _show_language_picker() -> void:
	_language_picker = LanguagePicker.new()
	_language_picker.language_confirmed.connect(_on_language_confirmed)
	add_child(_language_picker)
	TutorialHarness.mark("LANGUAGE_DEFAULT_VISIBLE", {
		"language": UIStrings.DEFAULT_LANG,
		"selected": _language_picker.selected_language,
	})


## Hook di audit visuale, isolato dallo stesso gate del selftest: fotografa la
## prima superficie senza confermare una lingua e senza scrivere preferenze.
func _language_picker_screenshot(path: String) -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	var image := get_viewport().get_texture().get_image()
	var ok := is_instance_valid(_language_picker) and image.save_png(path) == OK \
			and FileAccess.file_exists(path)
	print("LANGUAGE-PICKER-SCREENSHOT %s" % ("PASS" if ok else "FAIL"))
	get_tree().quit(0 if ok else 1)


func _on_language_confirmed(language: String) -> void:
	if not UIStrings.set_lang(language):
		return
	# Il click/INVIO che conferma il picker non deve proseguire nello stesso
	# frame fino alla title appena costruita.
	get_viewport().set_input_as_handled()
	Sfx.play_confirm()
	if is_instance_valid(_language_picker):
		_language_picker.queue_free()
	_language_picker = null
	_build_title()
	TutorialHarness.mark("LANGUAGE_CONFIRMED", {"language": language})


## Verifica la scena vera in uno user:// isolato: prima viene il picker in
## inglese, poi una scelta costruisce DAVVERO la title nella lingua richiesta.
func _language_picker_selftest() -> void:
	await get_tree().process_frame
	var project_version := str(ProjectSettings.get_setting("application/config/version"))
	# Il job artifact imposta questo valore dal tag (senza `v`): il marker sotto
	# rende visibile nel log sia il testo del Label sia l'identita' attesa.
	var expected_version := OS.get_environment("JHT_EXPECTED_GAME_VERSION")
	var ok: bool = is_instance_valid(_language_picker) \
			and not is_instance_valid(_blink) \
			and UIStrings.lang == UIStrings.DEFAULT_LANG \
			and UIStrings.t("language_picker.title") == "Choose your language" \
			and _language_picker.supported_language_count() == UIStrings.LANGS.size()
	if is_instance_valid(_language_picker):
		_language_picker.language_confirmed.connect(func(language: String) -> void:
			_language_test_choice = language)
		_language_picker.choose_language("de")
		_language_picker.confirm()
	await get_tree().process_frame
	ok = ok and _language_test_choice == "de" \
			and UIStrings.lang == "de" and is_instance_valid(_blink) \
			and is_instance_valid(_version_label) \
			and _version_label.is_visible_in_tree() \
			and _version_label.text == "v%s" % project_version \
			and (expected_version == "" or project_version == expected_version) \
			and not _title_has_forbidden_footer()
	print("LANGUAGE-PICKER-TITLE-VERSION %s" % (
			_version_label.text if is_instance_valid(_version_label) else "MISSING"))
	print("LANGUAGE-PICKER-TITLE-TEST %s" % ("PASS" if ok else "FAIL"))
	get_tree().quit(0 if ok else 1)


func _title_has_forbidden_footer() -> bool:
	for node: Node in find_children("*", "Label", true, false):
		var label := node as Label
		var rendered_text := label.text.to_lower()
		for fragment: String in FORBIDDEN_TITLE_FOOTER_FRAGMENTS:
			if rendered_text.contains(fragment):
				return true
	return false


## Fase 1 dell'oracolo: il click attraversa il vero picker e deve arrivare
## su disco. La fase verify gira in un altro processo Godot.
func _language_persistence_write_selftest() -> void:
	await get_tree().process_frame
	var ok := is_instance_valid(_language_picker) \
			and UIStrings.lang == UIStrings.DEFAULT_LANG
	if is_instance_valid(_language_picker):
		_language_picker.choose_language("de")
		_language_picker.confirm()
	await get_tree().process_frame
	ok = ok and not is_instance_valid(_language_picker) \
			and UIStrings.lang == "de" and UIStrings.saved_language() == "de" \
			and is_instance_valid(_blink)
	print("LANGUAGE-PERSISTENCE-WRITE %s" % ("PASS" if ok else "FAIL"))
	get_tree().quit(0 if ok else 1)


## Fase 2 dell'oracolo: nessun override e un processo nuovo devono leggere la
## preferenza, saltare il picker e costruire subito la title tradotta.
func _language_persistence_verify_selftest() -> void:
	await get_tree().process_frame
	var ok := not is_instance_valid(_language_picker) \
			and UIStrings.lang == "de" and is_instance_valid(_blink) \
			and _blink.text == "▶ EINGABE DRÜCKEN"
	DirAccess.remove_absolute(ProjectSettings.globalize_path(UIStrings.language_config_path()))
	print("LANGUAGE-PERSISTENCE-VERIFY %s" % ("PASS" if ok else "FAIL"))
	get_tree().quit(0 if ok else 1)


## Un disco non scrivibile non è una scelta utente riuscita: il picker deve
## restare in primo piano e non costruire la title nella lingua non salvata.
func _language_persistence_save_failure_selftest() -> void:
	await get_tree().process_frame
	var config_path := ProjectSettings.globalize_path(UIStrings.language_config_path())
	DirAccess.remove_absolute(config_path)
	DirAccess.remove_absolute(config_path.get_base_dir())
	var ok := is_instance_valid(_language_picker) \
			and UIStrings.lang == UIStrings.DEFAULT_LANG
	if is_instance_valid(_language_picker):
		_language_picker.choose_language("de")
		_language_picker.confirm()
	await get_tree().process_frame
	ok = ok and is_instance_valid(_language_picker) \
			and UIStrings.lang == UIStrings.DEFAULT_LANG \
			and not is_instance_valid(_blink)
	DirAccess.remove_absolute(config_path)
	DirAccess.remove_absolute(config_path.get_base_dir())
	print("LANGUAGE-PERSISTENCE-SAVE-FAILURE %s" % ("PASS" if ok else "FAIL"))
	get_tree().quit(0 if ok else 1)


func _build_title() -> void:

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

	_version_label = TerminalTheme.label(
			"v%s" % str(ProjectSettings.get_setting("application/config/version")),
			15, Palette.DIM)
	add_child(_version_label)
	_version_label.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	var version_size := _version_label.get_combined_minimum_size()
	_version_label.offset_left = 28
	_version_label.offset_top = -40
	_version_label.offset_right = 28 + version_size.x
	_version_label.offset_bottom = -40 + version_size.y
	_version_label.grow_vertical = Control.GROW_DIRECTION_BEGIN

func _process(delta: float) -> void:
	_time += delta
	if not is_instance_valid(_blink):
		return
	# Pulse via alpha, MAI via visible: il toggle di visibilità dentro il
	# VBoxContainer collassa il label e il container ricentra tutto (il
	# "titolo che oscilla" visto da Leone).
	_blink.modulate.a = 0.35 + 0.65 * maxf(0.0, sin(_time * 2.6))

func _unhandled_input(event: InputEvent) -> void:
	# Il picker cattura sia mouse sia focus tastiera: nessun INVIO/click può
	# lasciarlo e far entrare nell'ufficio prima della scelta.
	if is_instance_valid(_language_picker):
		return
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
	first.name = "TutorialNameFirst"
	first.placeholder_text = UIStrings.t("title.name_first")
	first.custom_minimum_size = Vector2(420, 0)
	first.max_length = 40
	box.add_child(first)
	var last := LineEdit.new()
	last.name = "TutorialNameLast"
	last.placeholder_text = UIStrings.t("title.name_last")
	last.custom_minimum_size = Vector2(420, 0)
	last.max_length = 60
	box.add_child(last)

	var enter := Button.new()
	enter.name = "TutorialEnterOffice"
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
	# Il cognome è facoltativo: il primo nome sintetico e INVIO devono poter
	# entrare davvero nell'ufficio, senza una seconda azione nascosta.
	first.text_submitted.connect(func(_v: String) -> void: confirm.call())
	last.text_submitted.connect(func(_v: String) -> void: confirm.call())
	enter.pressed.connect(confirm)
	skip.pressed.connect(func() -> void:
		Sfx.play_back()
		_fade_out())
	first.grab_focus()


## Oracolo end-to-end del harness: percorre gli stessi signal dei controlli
## nativi (picker, Enter title, submit LineEdit), poi l'Office verifica
## assistant/offline/16:9 prima di stampare il PASS.
func _tutorial_harness_autotest() -> void:
	await get_tree().process_frame
	var ok: bool = is_instance_valid(_language_picker) \
			and _language_picker.selected_language == "en" \
			and TutorialHarness.saw("LANGUAGE_DEFAULT_VISIBLE")
	if not ok:
		_tutorial_harness_fail("picker inglese non visibile")
		return
	_language_picker.confirm()
	await get_tree().process_frame
	ok = is_instance_valid(_blink) and UIStrings.lang == "en" \
			and UIStrings.saved_language() == "en" \
			and TutorialHarness.saw("LANGUAGE_CONFIRMED")
	if not ok:
		_tutorial_harness_fail("continue inglese non persiste title")
		return
	var accept := InputEventAction.new()
	accept.action = "ui_accept"
	accept.pressed = true
	_unhandled_input(accept)
	await get_tree().process_frame
	var first := find_child("TutorialNameFirst", true, false) as LineEdit
	ok = first != null and first.text.is_empty()
	if not ok:
		_tutorial_harness_fail("form nome vuoto non raggiungibile")
		return
	first.text = "Sample"
	first.text_submitted.emit(first.text)


func _tutorial_harness_fail(reason: String) -> void:
	push_error("TUTORIAL-16-9-HARNESS-TEST FAIL: " + reason)
	get_tree().quit(1)


func _tutorial_harness_persistence_test() -> void:
	await get_tree().process_frame
	var ok: bool = not is_instance_valid(_language_picker) \
			and is_instance_valid(_blink) and UIStrings.lang == "en" \
			and UIStrings.saved_language() == "en"
	print("TUTORIAL-EN-PERSISTENCE-TEST %s" % ("PASS" if ok else "FAIL"))
	get_tree().quit(0 if ok else 1)

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

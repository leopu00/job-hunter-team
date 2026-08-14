extends SceneTree
## Contratto del primo avvio: il fallback e la selezione devono restare
## indipendenti dal locale di sistema e tutte le sette lingue devono arrivare
## davvero al picker, non soltanto alla pagina Impostazioni.

const LanguagePicker := preload("res://scripts/ui/language_picker.gd")
const EXPECTED_LANGS := ["it", "en", "hu", "es", "de", "fr", "pt"]
const TEST_LANG_CFG := "user://language_picker_selftest.cfg"
const TITLE_SOURCE := "res://scripts/title.gd"
const TITLE_TRANSLATION_SOURCES := [
	"res://scripts/ui_strings.gd",
	"res://scripts/i18n/ui_en.gd",
	"res://scripts/i18n/ui_hu.gd",
	"res://scripts/i18n/ui_es.gd",
	"res://scripts/i18n/ui_de.gd",
	"res://scripts/i18n/ui_fr.gd",
	"res://scripts/i18n/ui_pt.gd",
]
const FORBIDDEN_TITLE_FOOTERS := [
	"prototipo — dati mock, nessun backend",
	"prototype — mock data, no backend",
	"prototípus — mock adatok, nincs backend",
	"prototipo — datos mock, sin backend",
	"Prototyp — Mock-Daten, kein Backend",
	"prototype — données mock, pas de backend",
	"protótipo — dados mock, sem backend",
]

var _failures: Array[String] = []
var _confirmed := ""

func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	_remove_test_config()
	_check("fallback inglese", UIStrings.DEFAULT_LANG == "en")
	_check("sette lingue", UIStrings.LANGS.size() == EXPECTED_LANGS.size())
	for language: String in EXPECTED_LANGS:
		_check("lingua supportata: " + language, UIStrings.LANGS.has(language))
	_check("prima installazione mostra il picker",
			UIStrings.language_choice_required(false))
	_check("preferenza salvata salta il picker",
			not UIStrings.language_choice_required(true))
	_check("override test valido salta il picker",
			not UIStrings.language_choice_required(false, "fr"))
	_check("override non valido non salta il picker",
			UIStrings.language_choice_required(false, "xx"))
	var title_source := FileAccess.get_file_as_string(TITLE_SOURCE)
	_check("titolo senza claim prototipo/backend incondizionato",
			not title_source.contains("title.footer"))
	var title_sources := [TITLE_SOURCE]
	title_sources.append_array(TITLE_TRANSLATION_SOURCES)
	for source_path: String in title_sources:
		var source := FileAccess.get_file_as_string(source_path)
		_check("chiave claim prototipo rimossa: " + source_path,
				not source.contains('"title.footer"'))
		for forbidden_footer: String in FORBIDDEN_TITLE_FOOTERS:
			_check("claim prototipo storico assente: " + source_path,
					not source.contains(forbidden_footer))
	_check("versione mostrata letta dalla configurazione del progetto",
			title_source.contains(
					'"v%s" % str(ProjectSettings.get_setting('
					+ '"application/config/version"))'))
	var hardcoded_version := RegEx.new()
	hardcoded_version.compile('"v[0-9]+(?:\\.[0-9]+)+"')
	_check("versione titolo non scritta a mano",
			hardcoded_version.search(title_source) == null)
	_check("selftest artifact verifica footer renderizzato assente",
			title_source.contains("and not _title_has_forbidden_footer()"))
	_check("scrive la scelta su preferenza isolata",
			UIStrings.set_lang("de", true, TEST_LANG_CFG))
	var saved_after_restart := UIStrings.saved_language(TEST_LANG_CFG)
	_check("riavvio rilegge la scelta salvata", saved_after_restart == "de")
	_check("scelta salvata salta il picker dopo riavvio",
			not UIStrings.language_choice_required(saved_after_restart != ""))

	UIStrings.set_lang(UIStrings.DEFAULT_LANG, false)
	var pair := await _layout_case(Vector2(1366, 768))
	var host := pair[0] as Control
	var picker := pair[1] as Control
	_check_layout(host, picker, Vector2(1366, 768))
	host.queue_free()
	await process_frame
	pair = await _layout_case(Vector2(1920, 1080))
	host = pair[0] as Control
	picker = pair[1] as Control
	_check_layout(host, picker, Vector2(1920, 1080))
	_check("picker elenca sette lingue", picker.supported_language_count() == 7)
	_check("picker preseleziona inglese", picker.selected_language == "en")
	picker.language_confirmed.connect(func(language: String) -> void:
		_confirmed = language)
	picker.choose_language("de")
	_check("picker accetta una lingua supportata", picker.selected_language == "de")
	picker.confirm()
	_check("picker conferma la lingua selezionata", _confirmed == "de")
	UIStrings.set_lang(UIStrings.DEFAULT_LANG, false)
	_remove_test_config()

	if _failures.is_empty():
		print("LANGUAGE-PICKER-TEST PASS")
		quit(0)
		return
	for failure in _failures:
		push_error("[language-picker-test] " + failure)
	print("LANGUAGE-PICKER-TEST FAIL (%d problemi)" % _failures.size())
	quit(1)


func _layout_case(viewport_size: Vector2) -> Array:
	var host := Control.new()
	host.name = "LanguageLayout_%dx%d" % [int(viewport_size.x), int(viewport_size.y)]
	host.size = viewport_size
	root.add_child(host)
	var picker := LanguagePicker.new()
	host.add_child(picker)
	await process_frame
	await process_frame
	return [host, picker]


func _check_layout(host: Control, picker: Control, expected_size: Vector2) -> void:
	var suffix := "%dx%d" % [int(expected_size.x), int(expected_size.y)]
	_check("host ha la risoluzione " + suffix, host.size.is_equal_approx(expected_size))
	_check("picker copre il viewport " + suffix,
			picker.position.is_equal_approx(Vector2.ZERO)
			and picker.size.is_equal_approx(expected_size))
	var art := picker.get_node_or_null("LanguageGateArtwork") as Control
	var veil := picker.get_node_or_null("LanguageGateVeil") as Control
	var center := picker.get_node_or_null("LanguageGateCenter") as CenterContainer
	var panel := picker.get_node_or_null("LanguageGateCenter/LanguageGatePanel") as Control
	_check("fondale copre il viewport " + suffix, art != null
			and art.position.is_equal_approx(Vector2.ZERO)
			and art.size.is_equal_approx(expected_size))
	_check("fondale pittorico inizializzato " + suffix, art is TextureRect
			and (art as TextureRect).texture != null)
	_check("velo copre il viewport " + suffix, veil != null
			and veil.position.is_equal_approx(Vector2.ZERO)
			and veil.size.is_equal_approx(expected_size))
	_check("pannello presente " + suffix, center != null and panel != null)
	if panel != null:
		var panel_center := panel.position + panel.size * 0.5
		_check("pannello centrato " + suffix,
				panel_center.distance_to(expected_size * 0.5) <= 1.0)
		_check("pannello nei margini " + suffix,
				panel.position.x >= LanguagePicker.SAFE_MARGIN
				and panel.position.y >= LanguagePicker.SAFE_MARGIN
				and panel.position.x + panel.size.x \
						<= expected_size.x - LanguagePicker.SAFE_MARGIN
				and panel.position.y + panel.size.y \
						<= expected_size.y - LanguagePicker.SAFE_MARGIN)
		_check("pannello leggibile " + suffix,
				panel.size.x >= LanguagePicker.PANEL_MIN_WIDTH)
	var title := picker.get_node_or_null(
			"LanguageGateCenter/LanguageGatePanel/LanguageGatePadding/" \
			+ "LanguageGateContent/LanguageGateTitle") as Label
	var continue_button := picker.get_node_or_null(
			"LanguageGateCenter/LanguageGatePanel/LanguageGatePadding/" \
			+ "LanguageGateContent/LanguageGateContinue") as Button
	var english := picker.get_node_or_null(
			"LanguageGateCenter/LanguageGatePanel/LanguageGatePadding/" \
			+ "LanguageGateContent/LanguageGateLanguages/Language_en") as Button
	_check("azione primaria alta almeno 52 " + suffix,
			continue_button != null and continue_button.size.y >= 52.0)
	_check("focus tastiera visibile " + suffix,
			english != null and english.has_theme_stylebox_override("focus")
			and english.get_theme_stylebox("focus").get_border_width(SIDE_LEFT) >= 2)
	_check("focus iniziale inglese " + suffix,
			root.gui_get_focus_owner() == english)
	_check("tab dalla lingua raggiunge la prossima scelta " + suffix,
			english != null and english.focus_next != NodePath("")
			and english.find_next_valid_focus() != null
			and english.find_next_valid_focus() != english)
	_check("frecce dalla lingua hanno vicini espliciti " + suffix,
			english != null
			and english.find_valid_focus_neighbor(SIDE_LEFT) != null
			and english.find_valid_focus_neighbor(SIDE_BOTTOM) != null)
	_check("titolo ad alto contrasto " + suffix, title != null
			and _contrast_ratio(Palette.WHITE, Palette.PANEL) >= 7.0)
	_check("testo e azione ad alto contrasto " + suffix,
			_contrast_ratio(Palette.BASE, Palette.PANEL) >= 4.5
			and _contrast_ratio(Palette.GREEN, Palette.PANEL) >= 4.5)


static func _contrast_ratio(a: Color, b: Color) -> float:
	var lighter := maxf(_relative_luminance(a), _relative_luminance(b))
	var darker := minf(_relative_luminance(a), _relative_luminance(b))
	return (lighter + 0.05) / (darker + 0.05)


static func _relative_luminance(color: Color) -> float:
	var channels := [color.r, color.g, color.b]
	for i in channels.size():
		channels[i] = channels[i] / 12.92 if channels[i] <= 0.04045 \
				else pow((channels[i] + 0.055) / 1.055, 2.4)
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


func _check(name: String, condition: bool) -> void:
	if not condition:
		_failures.append(name)


func _remove_test_config() -> void:
	DirAccess.remove_absolute(ProjectSettings.globalize_path(TEST_LANG_CFG))

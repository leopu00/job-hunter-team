extends SceneTree
## Contratto del primo avvio: il fallback e la selezione devono restare
## indipendenti dal locale di sistema e tutte le sette lingue devono arrivare
## davvero al picker, non soltanto alla pagina Impostazioni.

const LanguagePicker := preload("res://scripts/ui/language_picker.gd")
const EXPECTED_LANGS := ["it", "en", "hu", "es", "de", "fr", "pt"]

var _failures: Array[String] = []
var _confirmed := ""

func _init() -> void:
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

	UIStrings.set_lang(UIStrings.DEFAULT_LANG, false)
	var picker := LanguagePicker.new()
	root.add_child(picker)
	await process_frame
	_check("picker elenca sette lingue", picker.supported_language_count() == 7)
	_check("picker preseleziona inglese", picker.selected_language == "en")
	picker.language_confirmed.connect(func(language: String) -> void:
		_confirmed = language)
	picker.choose_language("de")
	_check("picker accetta una lingua supportata", picker.selected_language == "de")
	picker.confirm()
	_check("picker conferma la lingua selezionata", _confirmed == "de")
	UIStrings.set_lang(UIStrings.DEFAULT_LANG, false)

	if _failures.is_empty():
		print("LANGUAGE-PICKER-TEST PASS")
		quit(0)
		return
	for failure in _failures:
		push_error("[language-picker-test] " + failure)
	print("LANGUAGE-PICKER-TEST FAIL (%d problemi)" % _failures.size())
	quit(1)


func _check(name: String, condition: bool) -> void:
	if not condition:
		_failures.append(name)

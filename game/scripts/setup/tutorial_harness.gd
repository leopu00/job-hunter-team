class_name TutorialHarness
extends RefCounted
## Contratto del percorso registrabile P09–T2. Non costruisce schermate finte:
## isola soltanto il salvataggio della macchina e rende osservabili le azioni
## che l'utente compie nelle vere scene Title e Office.

const ENV := "JHT_TUTORIAL_HARNESS"
const RESET_ENV := "JHT_TUTORIAL_RESET"
const AUTOTEST_ENV := "JHT_TUTORIAL_HARNESS_TEST"
const PERSISTENCE_TEST_ENV := "JHT_TUTORIAL_HARNESS_PERSISTENCE_TEST"
const CLEANUP_TEST_ENV := "JHT_TUTORIAL_HARNESS_CLEANUP_TEST"

const LANGUAGE_CFG := "user://tutorial_harness_lang.cfg"
const ONBOARDING_CFG := "user://tutorial_harness_guided_onboarding.cfg"
const TOUR_CFG := "user://tutorial_harness_tour.cfg"
const CONTEXT_JSON := "user://tutorial_harness_onboarding_context.json"
const CONTEXT_MARKDOWN := "user://tutorial_harness_onboarding_context.md"

static var _markers: Array[String] = []


static func enabled() -> bool:
	return OS.get_environment(ENV) == "1"


static func reset_requested() -> bool:
	return enabled() and OS.get_environment(RESET_ENV) == "1"


static func auto_test() -> bool:
	return enabled() and OS.get_environment(AUTOTEST_ENV) == "1"


static func persistence_test() -> bool:
	return enabled() and OS.get_environment(PERSISTENCE_TEST_ENV) == "1"


static func cleanup_test() -> bool:
	return enabled() and OS.get_environment(CLEANUP_TEST_ENV) == "1"


## Cancella esclusivamente il file sintetico del harness. Mai la preferenza,
## il profilo o il tour della persona che sta usando il gioco.
static func reset_file_if_requested(path: String) -> void:
	if reset_requested():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(path))


static func clear_storage() -> void:
	for path in [LANGUAGE_CFG, ONBOARDING_CFG, TOUR_CFG, CONTEXT_JSON, CONTEXT_MARKDOWN]:
		DirAccess.remove_absolute(ProjectSettings.globalize_path(path))


static func mark(marker: String, details: Dictionary = {}) -> void:
	if not enabled():
		return
	_markers.append(marker)
	var fields: Array[String] = []
	var keys: Array = details.keys()
	keys.sort()
	for key in keys:
		fields.append("%s=%s" % [str(key), str(details[key])])
	print("TUTORIAL-HARNESS %s%s" % [marker,
			(" " + " ".join(fields)) if not fields.is_empty() else ""])


static func saw(marker: String) -> bool:
	return _markers.has(marker)


static func clear_markers() -> void:
	_markers.clear()

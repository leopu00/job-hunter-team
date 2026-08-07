extends SceneTree
## Self-test headless della raccolta diagnostica.
## Esecuzione: godot --headless --path game --script res://tools/diagnostics_selftest.gd
##
## Verifica le due promesse che la sezione "Segnala un problema" fa all'utente:
## che il bundle si raccolga anche senza container (è lo scenario dei bug di
## avvio) e che nulla di identificabile sopravviva alla redazione. Il canarino
## del secondo punto è il nome utente del sistema operativo: compare da solo nel
## path del file di log, quindi se la catena di sanificazione ha un buco lo si
## vede qui senza dover fabbricare dati finti.

const DiagnosticsScript = preload("res://scripts/support/diagnostics.gd")
const RedactorScript = preload("res://scripts/support/redactor.gd")

var _failures: Array[String] = []


func _init() -> void:
	var bundle: Dictionary = DiagnosticsScript.collect(true, true)
	var markdown: String = DiagnosticsScript.to_markdown(bundle)
	_test_sections(bundle)
	_test_survives_without_container(bundle)
	_test_no_identifying_data(markdown)
	_test_markdown_is_useful(markdown)
	_test_preview_is_english(bundle)
	if _failures.is_empty():
		print("[diag-test] PASS: sezioni, resilienza e redazione del bundle")
		quit(0)
		return
	for failure in _failures:
		push_error("[diag-test] " + failure)
	quit(1)


func _check(name: String, condition: bool, detail: String = "") -> void:
	if not condition:
		_failures.append("%s — %s" % [name, detail])


func _test_sections(bundle: Dictionary) -> void:
	for key in ["app", "system", "runtime", "logs", "redaction"]:
		_check("sezione " + key, bundle.has(key), str(bundle.keys()))
	var app: Dictionary = bundle.get("app", {})
	_check("versione presente", app.has("versione"), str(app))
	var system: Dictionary = bundle.get("system", {})
	_check("scheda video presente", system.has("video"), str(system))


## Il caso che conta: niente container, niente docker, la raccolta deve
## comunque produrre un bundle utile invece di sollevare o restituire vuoto.
func _test_survives_without_container(bundle: Dictionary) -> void:
	var runtime: Dictionary = bundle.get("runtime", {})
	_check("stato docker riportato", runtime.has("docker"), str(runtime))
	_check("cartella dati riportata", runtime.has("cartella dati presente"),
			str(runtime))
	var logs: Dictionary = bundle.get("logs", {})
	_check("chiave log container presente", logs.has("container"),
			"anche l'assenza del container è un dato: " + str(logs.keys()))


func _test_no_identifying_data(markdown: String) -> void:
	var user := OS.get_environment("USER")
	if user == "":
		user = OS.get_environment("USERNAME")
	if user.length() >= 3:
		_check("nome utente OS assente", not markdown.contains(user),
				"il path del log lo contiene: la redazione ha un buco")
	_check("nessun segreto residuo",
			not RedactorScript.has_residual_secret(markdown),
			markdown.substr(0, 400))


## Il rischio opposto: un bundle sanificato fino a non dire più niente.
func _test_markdown_is_useful(markdown: String) -> void:
	_check("markdown non vuoto", markdown.length() > 100, markdown)
	_check("intestazioni presenti", markdown.contains("### App"), markdown.substr(0, 200))
	_check("sistema riportato", markdown.contains(OS.get_name()),
			"il sistema operativo non deve essere redatto")


## Il fallback del worker è inglese anche senza autoload/cataloghi caricati.
## È lo stesso percorso usato dall'anteprima prima dell'invio del feedback.
func _test_preview_is_english(bundle: Dictionary) -> void:
	# I log allegati sono dati grezzi e possono legittimamente contenere righe
	# di versioni precedenti. Qui si isola la cornice generata dal prodotto.
	var preview_bundle := bundle.duplicate(true)
	preview_bundle["logs"] = {}
	preview_bundle["redaction"] = {"email": 1}
	var markdown: String = DiagnosticsScript.to_markdown(preview_bundle)
	for forbidden in ["Dati rimossi", "versione", "motore", "lingua UI",
			"sessione", "sistema", "processore", "RAM disponibile", "schermo",
			"cartella dati presente", "non disponibile", "nessuno",
			"log container non disponibili", "troncato", "righe precedenti omesse"]:
		_check("anteprima diagnostica EN senza " + forbidden,
				not markdown.contains(forbidden), markdown.substr(0, 600))
	_check("heading runtime inglese", markdown.contains("### Runtime"), markdown)
	_check("label versione inglese", markdown.contains("**version**"), markdown)

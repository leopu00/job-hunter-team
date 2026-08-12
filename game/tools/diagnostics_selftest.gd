extends SceneTree
## Self-test headless della raccolta diagnostica.
## Esecuzione: godot --headless --path game --script res://tools/diagnostics_selftest.gd
##
## Verifica le promesse che la sezione "Segnala un problema" fa all'utente:
## che il bundle si raccolga anche senza container (è lo scenario dei bug di
## avvio), che la VPS non ricada sul Docker locale, che gli alert sopravvivano
## a compattazione/troncamento e che nulla di identificabile resti. Il canarino
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
	_test_container_log_transport()
	_test_repeated_status_before_budget()
	_test_alerts_survive_truncation_and_redaction()
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
	for key in ["app", "system", "runtime", "logs", "alerts", "redaction"]:
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


## Sorgente osservabile senza rete: in remoto l'eseguibile è sempre ssh, anche
## se la configurazione è incompleta; in quel caso si produce un marker di
## indisponibilità e NON si prova il Docker del computer che mostra la UI.
func _test_container_log_transport() -> void:
	var local: Dictionary = DiagnosticsScript._container_log_spec({})
	_check("fallback locale usa docker", str(local.get("path", "")) == "docker",
			str(local))
	var remote_context := {"backend_remote": true, "vps_config": {
			"ip": "192.0.2.10", "user": "fixture", "key_path": "/tmp/jht-fixture-key"}}
	var remote: Dictionary = DiagnosticsScript._container_log_spec(remote_context)
	var args := " ".join(remote.get("args", PackedStringArray()))
	_check("VPS usa ssh", str(remote.get("path", "")) == "ssh", str(remote))
	_check("VPS esegue docker logs remoto", args.contains("fixture@192.0.2.10") \
			and args.contains("docker logs --tail") and args.ends_with(" jht"), args)
	var runtime: Dictionary = DiagnosticsScript._runtime_section({
			"backend_remote": true,
			"setup_status": {"container_running": true, "active_provider": "codex"},
	})
	_check("runtime VPS non include sonde host", str(runtime.get("backend", "")) == "VPS" \
			and not runtime.has("docker") and not runtime.has("cartella dati presente"),
			str(runtime))
	var invalid_context := {"backend_remote": true, "vps_config": {}}
	var invalid: Dictionary = DiagnosticsScript._container_log_spec(invalid_context)
	_check("VPS invalida non ricade su docker", str(invalid.get("path", "")) == "",
			str(invalid))
	var unavailable: Dictionary = DiagnosticsScript._container_log({}, invalid_context)
	_check("fallback VPS leggibile", str(unavailable.get("main", "")).contains(
			"container logs unavailable"), str(unavailable))


## 600 heartbeat in coda avrebbero espulso tutte le righe utili se il filtro
## fosse applicato dopo MAX_LOG_LINES. Il fatto iniziale deve invece restare.
func _test_repeated_status_before_budget() -> void:
	var lines := PackedStringArray()
	for i in 399:
		lines.append("meaningful-%03d" % i)
	for i in 600:
		lines.append("[00:00:%03d] [INFO] [backend] status connected" % i)
	var prepared: Dictionary = DiagnosticsScript._prepare_log("\n".join(lines))
	var main := str(prepared.get("main", ""))
	_check("stati filtrati prima del budget", main.contains("meaningful-000"),
			main.substr(0, 200))
	_check("una sola riga stato", main.count("status connected") == 1,
			"occorrenze=" + str(main.count("status connected")))


## L'alert è fuori dalla coda ordinaria ma deve restare nella sezione separata;
## entrambe le sezioni passano poi dalla stessa redazione ricorsiva.
func _test_alerts_survive_truncation_and_redaction() -> void:
	var token := "ghp" + "_ABCdefGHIjklMNOpqrSTUvwxYZ0123456789"
	var email := "reporter@example.com"
	var lines := PackedStringArray([
			"[00:00:001] [WARN] synthetic fault " + email + " token=" + token])
	for i in DiagnosticsScript.MAX_LOG_LINES + 50:
		lines.append("ordinary-line-%03d" % i)
	# Un'ultima riga oltre il budget caratteri dimostra anche il cap per byte.
	lines.append("x".repeat(DiagnosticsScript.MAX_LOG_CHARS + 20) + "TAIL-END")
	var prepared: Dictionary = DiagnosticsScript._prepare_log("\n".join(lines))
	_check("alert espulso dalla coda principale", not str(prepared["main"]).contains(
			"synthetic fault"), "il controtest non esercita il troncamento")
	_check("alert preservato separatamente", str(prepared["alerts"]).contains(
			"synthetic fault"), str(prepared))
	_check("budget caratteri applicato", str(prepared["main"]).contains("truncated") \
			and str(prepared["main"]).contains("TAIL-END"),
			str(prepared["main"]).substr(0, 120))
	var raw_bundle := {"logs": {"container": prepared["main"]},
			"alerts": {"container": prepared["alerts"]}}
	var clean: Dictionary = DiagnosticsScript._sanitize(raw_bundle)
	var rendered := DiagnosticsScript.to_markdown(clean)
	_check("alert redatto", not rendered.contains(email) and not rendered.contains(token),
			rendered.substr(0, 300))
	_check("sezione alert separata", rendered.contains("ERROR/WARN from: container"),
			rendered.substr(0, 300))
	_check("alert prima del budget markdown",
			rendered.find("ERROR/WARN from: container") < rendered.find("Log: container"),
			rendered.substr(0, 300))

extends SceneTree
## Self-test headless del ripulitore PII.
## Esecuzione: godot --headless --path game --script res://tools/redactor_selftest.gd
##
## Questo test è il contratto di privacy della segnalazione in-app: se passa,
## nessuna delle famiglie di dato sensibile che compaiono nei log JHT esce dal
## computer dell'utente. Vale in entrambe le direzioni — i casi "innocui"
## verificano che la redazione NON mangi le righe diagnostiche, perché un
## report ripulito fino all'inutilità non fa arrivare nessuna fix.

const RedactorScript = preload("res://scripts/support/redactor.gd")

## I finti segreti si compongono a pezzi invece di stare in chiaro: scritti per
## esteso li blocca il gate anti-secret del pre-commit, ed è giusto che lo
## faccia — un token plausibile committato resta un token plausibile committato,
## anche quando è finto.
const FAKE_GH := "ghp" + "_ABCdefGHIjklMNOpqrSTUvwxYZ0123456789"
const FAKE_PROVIDER := "sk" + "-ant-api03-Zm9vYmFyYmF6cXV1eA_AA"
const FAKE_BEARER := "synthetic" + ".bearer.token"
const FAKE_BASIC := "c2FtcGxl" + "OnN5bnRoZXRpYw=="
const FAKE_AWS := "AK" + "IA" + "A1B2C3D4E5F6G7H8"
const FAKE_SLACK := "xo" + "xb-111122223333-444455556666-abcdefghijklmnopqrstuvwx"
const FAKE_GEMINI := "AI" + "zaSyA1B2C3D4E5F6G7H8J9K0L1M2N3P4Q"
const FAKE_TELEGRAM := "7123456789" + ":AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0"
const FAKE_JWT := "eyJhbGciOiJIUzI1NiJ9" + ".eyJzdWIiOiJzeW50aGV0aWMifQ" \
		+ ".dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk"
const FAKE_LOCAL_TOKEN := "9f8e7d6c5b4a39281706f5e4d3c2b1a0" \
		+ "9f8e7d6c5b4a39281706f5e4d3c2b1a0"

var _failures: Array[String] = []


func _init() -> void:
	# Godot puo' restituire exit 0 e continuare `_init()` anche quando un
	# `preload()` dipendente non compila. Senza questo guard il vecchio test
	# chiamava metodi inesistenti, non registrava failure e stampava PASS.
	if not _script_is_ready(RedactorScript):
		push_error("[redact-test] FAIL: redactor.gd non compilabile")
		quit(1)
		return
	# Un GDScript senza sorgente compilata rappresenta il ramo che il gate
	# deve respingere: il controllo non puo' ridursi a `script != null`.
	_check("gate rifiuta script non compilato", not _script_is_ready(GDScript.new()))
	_test_secrets_are_removed()
	_test_personal_data_is_removed()
	_test_paths_and_documents()
	_test_public_ip_only()
	_test_known_names()
	_test_diagnostic_lines_survive()
	_test_residual_check()
	_test_report_counts()
	_test_secrets_only_mode()
	_test_real_log_line()
	if _failures.is_empty():
		print("[redact-test] PASS: segreti, PII, path e falsi positivi")
		quit(0)
		return
	for failure in _failures:
		push_error("[redact-test] " + failure)
	quit(1)


func _script_is_ready(script: Script) -> bool:
	return script != null and script.can_instantiate()


func _check(name: String, condition: bool, detail: String = "") -> void:
	if not condition:
		_failures.append("%s — %s" % [name, detail])


## Il testo ripulito non deve contenere l'ago, e deve contenere il segnaposto.
func _scrubbed(name: String, raw: String, needle: String, placeholder: String) -> void:
	var out: String = RedactorScript.redact(raw)
	_check(name, not out.contains(needle), "residuo nel testo: " + out)
	_check(name + " (segnaposto)", out.contains(placeholder),
			"atteso %s, ottenuto: %s" % [placeholder, out])


func _test_secrets_are_removed() -> void:
	_scrubbed("bearer auth", "Authorization: Bearer " + FAKE_BEARER,
			FAKE_BEARER, "Bearer [secret]")
	_scrubbed("basic auth", "Authorization: Basic " + FAKE_BASIC,
			FAKE_BASIC, "Basic [secret]")
	_scrubbed("AWS access key", "aws_access_key_id=" + FAKE_AWS,
			FAKE_AWS, "[aws-access-key]")
	_scrubbed("token Slack", "Slack bot token " + FAKE_SLACK,
			FAKE_SLACK, "[slack-token]")
	_scrubbed("chiave Gemini", "Gemini key " + FAKE_GEMINI,
			FAKE_GEMINI, "[gemini-key]")
	_scrubbed("token telegram",
			"bot avviato con " + FAKE_TELEGRAM + " ok",
			FAKE_TELEGRAM, "[telegram-token]")
	_scrubbed("token github",
			"push fallito: " + FAKE_GH,
			FAKE_GH, "[github-token]")
	_scrubbed("chiave provider",
			"Authorization " + FAKE_PROVIDER,
			"sk-ant-api03", "[provider-key]")
	_scrubbed("jwt",
			"cookie sb-access=" + FAKE_JWT,
			FAKE_JWT, "[jwt]")
	_scrubbed("local token esadecimale",
			"jht_local_token=" + FAKE_LOCAL_TOKEN,
			FAKE_LOCAL_TOKEN, "[hash]")
	_scrubbed("password assegnata",
			"smtp password=SuperSegreta123 host=smtp.gmail.com",
			"SuperSegreta123", "[secret]")
	_scrubbed("credenziali nell'URL",
			"clone da https://sample-user:tokenSegreto@example.com/sample/repo.git",
			"tokenSegreto", "[credentials]")
	_scrubbed("token in query string",
			"GET /api/cloud-sync/ping?access_token=abcdef123456xyz HTTP/1.1",
			"abcdef123456xyz", "[secret]")
	var pem := "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\nAAAA\n-----END OPENSSH PRIVATE KEY-----"
	_scrubbed("chiave privata", pem, "b3BlbnNzaC1rZXktdjEA", "[private-key]")


func _test_personal_data_is_removed() -> void:
	_scrubbed("email", "candidatura inviata a avery@example.com",
			"avery@example.com", "[email]")
	_scrubbed("telefono internazionale", "contatto +1 202 555 0100 nel CV",
			"202 555 0100", "[phone]")
	_scrubbed("telefono etichettato", "telefono: 3481234567",
			"3481234567", "[phone]")
	_scrubbed("iban", "bonifico su IT60X0542811101000000123456 ricevuto",
			"IT60X0542811101000000123456", "[iban]")
	_scrubbed("codice fiscale", "CF RSSMRA85M01H501Z verificato",
			"RSSMRA85M01H501Z", "[fiscal-code]")


func _test_paths_and_documents() -> void:
	var mac: String = RedactorScript.redact(
			"CV in /Users/sample-user/.jht/profile/cv.pdf")
	_check("home macOS", not mac.contains("sample-user"), mac)
	_check("home macOS (segnaposto)", mac.contains("/Users/[user]"), mac)
	var win: String = RedactorScript.redact(
			"log in C:\\Users\\Avery Example\\AppData\\Roaming\\Godot")
	_check("home Windows con spazi", not win.contains("Avery Example"), win)
	_check("home Windows con spazi (segnaposto)",
			win.contains("C:\\Users\\[user]\\AppData"), win)
	var linux: String = RedactorScript.redact("home=/home/sample-user/.jht")
	_check("home Linux", not linux.contains("sample-user"), linux)
	var doc: String = RedactorScript.redact(
			"allegato CV_Avery_Example_2026.pdf caricato")
	_check("nome documento", not doc.contains("Avery_Example"), doc)
	_check("estensione conservata", doc.contains(".pdf"),
			"l'estensione serve a capire il formato: " + doc)


func _test_public_ip_only() -> void:
	var out: String = RedactorScript.redact(
			"ssh 203.0.113.42 · docker 172.17.0.2 · web 127.0.0.1:3000 · lan 192.168.1.40")
	_check("ip pubblico redatto", not out.contains("203.0.113.42"), out)
	_check("loopback conservato", out.contains("127.0.0.1"),
			"127.0.0.1 è diagnostico e non identifica nessuno: " + out)
	_check("rete docker conservata", out.contains("172.17.0.2"), out)
	_check("lan conservata", out.contains("192.168.1.40"), out)


func _test_known_names() -> void:
	var out: String = RedactorScript.redact(
			"Il candidato Avery Example ha aperto la posizione",
			PackedStringArray(["Avery", "Example"]))
	_check("nome noto", not out.contains("Avery") and not out.contains("Example"), out)
	# Un termine di due lettere renderebbe illeggibile mezzo log.
	var short_term: String = RedactorScript.redact("stato ok", PackedStringArray(["ok"]))
	_check("termine troppo corto ignorato", short_term.contains("ok"), short_term)


## Il rischio speculare della redazione: se mangia le righe di telemetria, il
## report arriva pulito e inutile.
func _test_diagnostic_lines_survive() -> void:
	var perf := "[perf] fps=42 frame_ms=23.8 draw_calls=1147 nodes=3204 mem_mb=512"
	_check("riga perf intatta", RedactorScript.redact(perf) == perf,
			RedactorScript.redact(perf))
	var boot := "[boot] video: Apple M1 Pro — Metal 3.0"
	_check("riga video intatta", RedactorScript.redact(boot) == boot,
			RedactorScript.redact(boot))
	var err := "[ERROR] [backend] docker exec jht exit=125 container non avviato"
	_check("riga errore intatta", RedactorScript.redact(err) == err,
			RedactorScript.redact(err))
	var version := "versione 0.2.1 · commit 4dd3c1ff · Godot 4.7.stable"
	_check("versione e commit intatti", RedactorScript.redact(version) == version,
			RedactorScript.redact(version))


func _test_residual_check() -> void:
	var dirty := "mail avery@example.com e token " + FAKE_GH
	_check("residuo rilevato prima", RedactorScript.has_residual_secret(dirty), dirty)
	for secret in ["Bearer " + FAKE_BEARER, "Basic " + FAKE_BASIC,
			FAKE_AWS, FAKE_SLACK, FAKE_GEMINI]:
		_check("nuovo residuo rilevato", RedactorScript.has_residual_secret(secret),
				"famiglia non coperta")
	var clean: String = RedactorScript.redact(dirty)
	_check("nessun residuo dopo", not RedactorScript.has_residual_secret(clean), clean)


func _test_report_counts() -> void:
	var report: Dictionary = RedactorScript.redact_with_report(
			"scrivi a a@b.it e a c@d.it, token=abcdefgh")
	var counts: Dictionary = report["counts"]
	_check("conteggio email", int(counts.get("email", 0)) == 2, str(counts))
	_check("conteggio segreti", int(counts.get("assigned_secret", 0)) == 1, str(counts))


## Il testo che l'utente scrive nel form: i segreti spariscono comunque, il
## racconto resta leggibile. Se questa modalità mangiasse anche i dati
## personali, metà delle segnalazioni arriverebbe incomprensibile.
func _test_secrets_only_mode() -> void:
	var raw := "ho messo il token=" + FAKE_GH + " " \
			+ "ma la mia mail avery@example.com non riceve niente"
	var out: String = RedactorScript.redact_secrets(raw)
	_check("form — segreto rimosso",
			not out.contains(FAKE_GH), out)
	_check("form — racconto conservato", out.contains("avery@example.com"),
			"il testo dell'utente non va reso incomprensibile: " + out)


## Una riga vera come quelle che finiranno nei bundle: più famiglie di dato
## nella stessa stringa, dove le regole si possono pestare i piedi a vicenda.
func _test_real_log_line() -> void:
	var raw := "[14:22:07.412] [INFO] [backend] upload /Users/sample-user/.jht/profile/CV_Avery_Example.pdf " \
			+ "→ hr@example.com via 203.0.113.42 (token=" + FAKE_GH + ")"
	var out: String = RedactorScript.redact(raw, PackedStringArray(["Avery", "Example"]))
	for needle in ["sample-user", "hr@example.com", "203.0.113.42",
			FAKE_GH, "Avery", "Example"]:
		_check("riga reale — " + needle, not out.contains(needle), out)
	_check("riga reale — timestamp conservato", out.contains("[14:22:07.412]"), out)
	_check("riga reale — categoria conservata", out.contains("[backend]"), out)

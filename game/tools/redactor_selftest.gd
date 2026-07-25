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

var _failures: Array[String] = []


func _init() -> void:
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
	_scrubbed("token telegram",
			"bot avviato con 7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0 ok",
			"AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0", "[telegram-token]")
	_scrubbed("token github",
			"push fallito: " + FAKE_GH,
			FAKE_GH, "[github-token]")
	_scrubbed("chiave provider",
			"Authorization " + FAKE_PROVIDER,
			"sk-ant-api03", "[provider-key]")
	_scrubbed("jwt",
			"cookie sb-access=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk",
			"eyJhbGciOiJIUzI1NiJ9", "[jwt]")
	_scrubbed("local token esadecimale",
			"jht_local_token=9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0",
			"9f8e7d6c5b4a39281706f5e4d3c2b1a0", "[hash]")
	_scrubbed("password assegnata",
			"smtp password=SuperSegreta123 host=smtp.gmail.com",
			"SuperSegreta123", "[secret]")
	_scrubbed("credenziali nell'URL",
			"clone da https://leone:tokenSegreto@github.com/leopu00/jht.git",
			"tokenSegreto", "[credentials]")
	_scrubbed("token in query string",
			"GET /api/cloud-sync/ping?access_token=abcdef123456xyz HTTP/1.1",
			"abcdef123456xyz", "[secret]")
	var pem := "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\nAAAA\n-----END OPENSSH PRIVATE KEY-----"
	_scrubbed("chiave privata", pem, "b3BlbnNzaC1rZXktdjEA", "[private-key]")


func _test_personal_data_is_removed() -> void:
	_scrubbed("email", "candidatura inviata a hr.recruiting@acme-corp.com",
			"hr.recruiting@acme-corp.com", "[email]")
	_scrubbed("telefono internazionale", "contatto +39 348 123 4567 nel CV",
			"348 123 4567", "[phone]")
	_scrubbed("telefono etichettato", "telefono: 3481234567",
			"3481234567", "[phone]")
	_scrubbed("iban", "bonifico su IT60X0542811101000000123456 ricevuto",
			"IT60X0542811101000000123456", "[iban]")
	_scrubbed("codice fiscale", "CF RSSMRA85M01H501Z verificato",
			"RSSMRA85M01H501Z", "[fiscal-code]")


func _test_paths_and_documents() -> void:
	var mac: String = RedactorScript.redact(
			"CV in /Users/mariorossi/.jht/profile/cv.pdf")
	_check("home macOS", not mac.contains("mariorossi"), mac)
	_check("home macOS (segnaposto)", mac.contains("/Users/[user]"), mac)
	var win: String = RedactorScript.redact(
			"log in C:\\Users\\Leone\\AppData\\Roaming\\Godot")
	_check("home Windows", not win.contains("Leone"), win)
	var linux: String = RedactorScript.redact("home=/home/andras/.jht")
	_check("home Linux", not linux.contains("andras"), linux)
	var doc: String = RedactorScript.redact(
			"allegato CV_Mario_Rossi_2026.pdf caricato")
	_check("nome documento", not doc.contains("Mario_Rossi"), doc)
	_check("estensione conservata", doc.contains(".pdf"),
			"l'estensione serve a capire il formato: " + doc)


func _test_public_ip_only() -> void:
	var out: String = RedactorScript.redact(
			"ssh 65.108.14.22 · docker 172.17.0.2 · web 127.0.0.1:3000 · lan 192.168.1.40")
	_check("ip pubblico redatto", not out.contains("65.108.14.22"), out)
	_check("loopback conservato", out.contains("127.0.0.1"),
			"127.0.0.1 è diagnostico e non identifica nessuno: " + out)
	_check("rete docker conservata", out.contains("172.17.0.2"), out)
	_check("lan conservata", out.contains("192.168.1.40"), out)


func _test_known_names() -> void:
	var out: String = RedactorScript.redact(
			"Il candidato Leone Puglisi ha aperto la posizione",
			PackedStringArray(["Leone", "Puglisi"]))
	_check("nome noto", not out.contains("Leone") and not out.contains("Puglisi"), out)
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
	var dirty := "mail mario@rossi.it e token " + FAKE_GH
	_check("residuo rilevato prima", RedactorScript.has_residual_secret(dirty), dirty)
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
			+ "ma la mia mail mario@rossi.it non riceve niente"
	var out: String = RedactorScript.redact_secrets(raw)
	_check("form — segreto rimosso",
			not out.contains(FAKE_GH), out)
	_check("form — racconto conservato", out.contains("mario@rossi.it"),
			"il testo dell'utente non va reso incomprensibile: " + out)


## Una riga vera come quelle che finiranno nei bundle: più famiglie di dato
## nella stessa stringa, dove le regole si possono pestare i piedi a vicenda.
func _test_real_log_line() -> void:
	var raw := "[14:22:07.412] [INFO] [backend] upload /Users/mariorossi/.jht/profile/CV_Mario_Rossi.pdf " \
			+ "→ hr@acme.com via 65.108.14.22 (token=" + FAKE_GH + ")"
	var out: String = RedactorScript.redact(raw, PackedStringArray(["Mario", "Rossi"]))
	for needle in ["mariorossi", "hr@acme.com", "65.108.14.22",
			FAKE_GH, "Mario", "Rossi"]:
		_check("riga reale — " + needle, not out.contains(needle), out)
	_check("riga reale — timestamp conservato", out.contains("[14:22:07.412]"), out)
	_check("riga reale — categoria conservata", out.contains("[backend]"), out)

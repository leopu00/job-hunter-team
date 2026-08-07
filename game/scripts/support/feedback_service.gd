extends Node
## Autoload `FeedbackService`: il canale con cui un utente ci racconta un bug.
##
## Tre invarianti, in ordine di importanza.
##
## 1. NIENTE ESCE SENZA REDAZIONE. Il bundle e ogni campo libero passano da
##    Redactor con le regole per dati personali e segreti. Un recapito è un
##    dato personale: non esiste nel payload desktop, neppure se un client
##    vecchio prova a inserirlo nel dizionario del modulo.
## 2. LA COPIA LOCALE SI SCRIVE SEMPRE, prima del tentativo di invio. Se la rete
##    manca, se l'endpoint è giù, se l'utente è dietro un proxy ostile, il report
##    esiste comunque su disco e si può allegare a mano. Un canale che perde il
##    lavoro dell'utente quando fallisce non è un canale.
## 3. L'INVIO NON BLOCCA LA FINESTRA. La raccolta gira su un Thread (esegue
##    docker e legge file), l'HTTP è asincrono.

## Anteprima pronta: la UI mostra `markdown` e il rendiconto di cosa è stato
## tolto. `running` copre il tempo delle sonde, che con Docker lento non è zero.
signal preview_changed(running: bool, markdown: String, counts: Dictionary)
## Esito dell'invio. `ticket` è il riferimento da mostrare all'utente.
signal submit_changed(running: bool, ok: bool, message: String, ticket: String)

## Destinazione unica. Override con JHT_FEEDBACK_URL per i test e per chi
## self-hosta: il canale deve poter puntare altrove senza ricompilare il gioco.
const DEFAULT_ENDPOINT := "https://jobhunterteam.ai/api/feedback"
const REPORTS_DIR := "user://reports"
## Cap sui campi liberi: un incollaggio di 3 MB non è una segnalazione, e
## l'endpoint lo rifiuterebbe comunque.
const MAX_FIELD_CHARS := 4000
const HTTP_TIMEOUT := 25.0

var preview_markdown := ""
var preview_counts := {}
## Il bundle esatto che l'anteprima mostra. L'invio riusa questo, non ne
## raccoglie un altro: abbiamo promesso all'utente che parte ciò che vede.
var preview_bundle := {}
## Dove è finita l'ultima copia su disco: la UI la offre in apertura cartella.
var last_saved_path := ""
var last_ticket := ""

var _thread: Thread
## Una raccolta è in volo (le sonde girano su un thread).
var _collecting := false
## Un invio è stato chiesto e non si è ancora concluso.
var _sending := false
## Opzioni con cui è stato costruito `preview_bundle`.
var _preview_opts := {}
## Invio chiesto mentre una raccolta era in corso: parte appena finisce.
var _queued_submit := {}
var _http: HTTPRequest


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS


func endpoint() -> String:
	var custom := OS.get_environment("JHT_FEEDBACK_URL").strip_edges()
	return custom if custom != "" else DEFAULT_ENDPOINT


## Raccoglie la diagnostica e prepara l'anteprima. La UI la chiama all'apertura
## della sezione: l'utente deve poter leggere cosa allegherà PRIMA di scrivere,
## non trovarselo spiegato in una riga di consenso a fondo pagina.
func build_preview(include_logs := true, include_container := true) -> void:
	if _collecting:
		return
	_start_collect({"logs": include_logs, "container": include_container}, {})


## Invia. `form` = {"doing":…, "happened":…, "expected":…}.
##
## Non viene MAI ignorato in silenzio. Se una raccolta di anteprima è ancora in
## volo — succede se l'utente scrive in fretta e preme invia subito — la
## richiesta si accoda e parte da sola: un pulsante che non fa niente e non
## dice niente è il modo più rapido per perdere la segnalazione e la fiducia.
func submit(form: Dictionary, include_logs := true, include_container := true) -> void:
	if _sending:
		return  # già in volo: il doppio clic non manda due segnalazioni
	_sending = true
	submit_changed.emit(true, false, UIStrings.t("feedback.sending"), "")
	var opts := {"logs": include_logs, "container": include_container}
	# L'anteprima fresca È il contenuto da spedire: niente seconda passata di
	# sonde, e nessuna finestra in cui il contenuto cambia dopo che l'utente
	# lo ha letto.
	if not preview_bundle.is_empty() and _preview_opts == opts:
		_deliver(form, preview_bundle, preview_markdown)
		return
	if _collecting:
		_queued_submit = {"form": form.duplicate(), "opts": opts}
		return
	_start_collect(opts, form)


func _start_collect(opts: Dictionary, form: Dictionary) -> void:
	_collecting = true
	var context := Diagnostics.capture_context()
	if form.is_empty():
		preview_changed.emit(true, "", {})
	_thread = Thread.new()
	_thread.start(_collect.bind(
			bool(opts["logs"]), bool(opts["container"]), form, opts, context))


func reports_path() -> String:
	return ProjectSettings.globalize_path(REPORTS_DIR)


func open_reports_folder() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(REPORTS_DIR))
	OS.shell_open(reports_path())


# ── Raccolta (thread) ────────────────────────────────────────────────

func _collect(include_logs: bool, include_container: bool, form: Dictionary,
		opts: Dictionary, context: Dictionary) -> void:
	var bundle := Diagnostics.collect(include_logs, include_container, context)
	var markdown := Diagnostics.to_markdown(bundle,
			context.get("diagnostic_labels", {}))
	call_deferred("_on_collected", bundle, markdown, form, opts)


func _on_collected(bundle: Dictionary, markdown: String, form: Dictionary,
		opts: Dictionary) -> void:
	if _thread != null:
		_thread.wait_to_finish()
		_thread = null
	_collecting = false
	preview_markdown = markdown
	preview_bundle = bundle
	preview_counts = bundle.get("redaction", {})
	_preview_opts = opts
	if not form.is_empty():
		_deliver(form, bundle, markdown)
		return
	preview_changed.emit(false, markdown, preview_counts)
	# Un invio chiesto durante la raccolta parte adesso, con il bundle appena
	# prodotto: è lo stesso che l'utente vedrebbe nell'anteprima.
	if not _queued_submit.is_empty():
		var queued: Dictionary = _queued_submit
		_queued_submit = {}
		_deliver(queued["form"], bundle, markdown)


# ── Consegna ─────────────────────────────────────────────────────────

func _deliver(form: Dictionary, bundle: Dictionary, markdown: String) -> void:
	var payload := _payload(form, bundle, markdown)
	# Prima il disco, poi la rete: se qui sotto va storto qualcosa, il lavoro
	# dell'utente è già salvo.
	last_saved_path = _save_local_copy(payload)
	if _http == null:
		_http = HTTPRequest.new()
		_http.timeout = HTTP_TIMEOUT
		add_child(_http)
		_http.request_completed.connect(_on_response)
	var error := _http.request(endpoint(), PackedStringArray([
			"Content-Type: application/json",
			"User-Agent: jht-desktop/" + str(ProjectSettings.get_setting(
					"application/config/version", "dev")),
	]), HTTPClient.METHOD_POST, JSON.stringify(payload))
	if error != OK:
		Log.warn("feedback", "invio non avviato: errore %d" % error)
		_finish(false, UIStrings.t("feedback.offline"), "")


func _payload(form: Dictionary, bundle: Dictionary, markdown: String) -> Dictionary:
	var terms := Diagnostics.sensitive_terms(Diagnostics.capture_context())
	var doing := _clean_field(form.get("doing", ""), terms)
	var happened := _clean_field(form.get("happened", ""), terms)
	var expected := _clean_field(form.get("expected", ""), terms)
	var counts := _merged_redaction_counts(bundle.get("redaction", {}), [
		doing.get("counts", {}), happened.get("counts", {}), expected.get("counts", {}),
	])
	return {
		"client": "godot-desktop",
		"app_version": ProjectSettings.get_setting("application/config/version", "dev"),
		"locale": UIStrings.lang,
		"platform": OS.get_name(),
		# I racconti sono trattati come la diagnostica: nessun nome, contatto,
		# percorso CV o segreto esce perché l'utente lo ha incollato per errore.
		"doing": str(doing.get("text", "")),
		"happened": str(happened.get("text", "")),
		"expected": str(expected.get("text", "")),
		"diagnostics": markdown,
		"redaction": counts,
	}


func _clean_field(value: Variant,
		sensitive_terms: PackedStringArray = PackedStringArray()) -> Dictionary:
	return Redactor.redact_with_report(
		str(value).strip_edges().substr(0, MAX_FIELD_CHARS), sensitive_terms)


func _merged_redaction_counts(initial: Dictionary, groups: Array) -> Dictionary:
	var counts := initial.duplicate(true)
	for group: Dictionary in groups:
		for key in group:
			counts[key] = int(counts.get(key, 0)) + int(group[key])
	return counts


## Il consenso è reale solo se l'anteprima coincide byte per byte con la
## copia locale e il payload POST. Il modulo chiama questo metodo al click,
## così include anche il testo digitato dopo la raccolta diagnostica.
func preview_report(form: Dictionary) -> String:
	if not preview_is_ready():
		return ""
	return _to_markdown(_payload(form, preview_bundle, preview_markdown))


func preview_redaction_counts(form: Dictionary) -> Dictionary:
	if not preview_is_ready():
		return preview_counts
	return _payload(form, preview_bundle, preview_markdown).get("redaction", {})


func preview_is_ready() -> bool:
	return not _collecting and not preview_bundle.is_empty() and preview_markdown != ""


## Copia su disco in Markdown: apribile con un doppio clic e allegabile a una
## mail senza che l'utente debba capire cos'è un JSON.
func _save_local_copy(payload: Dictionary) -> String:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(REPORTS_DIR))
	var stamp := Time.get_datetime_string_from_system(false, true) \
			.replace(":", "-").replace(" ", "_")
	var path := REPORTS_DIR.path_join("report-%s.md" % stamp)
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		Log.warn("feedback", "copia locale non scrivibile: %s" % path)
		return ""
	file.store_string(_to_markdown(payload))
	file.close()
	var full := ProjectSettings.globalize_path(path)
	Log.info("feedback", "copia locale del report: %s" % full)
	return full


func _to_markdown(payload: Dictionary) -> String:
	var out := "# " + UIStrings.t("feedback.report.title") + "\n\n"
	out += "- **%s**: %s\n- **%s**: %s\n- **%s**: %s\n\n" % [
			UIStrings.t("feedback.report.version"), payload["app_version"],
			UIStrings.t("feedback.report.platform"), payload["platform"],
			UIStrings.t("feedback.report.language"), payload["locale"]]
	for pair in [[UIStrings.t("feedback.report.doing"), "doing"],
			[UIStrings.t("feedback.report.happened"), "happened"],
			[UIStrings.t("feedback.report.expected"), "expected"]]:
		out += "## %s\n\n%s\n\n" % [pair[0], str(payload[pair[1]])]
	out += "## " + UIStrings.t("feedback.report.diagnostics") + "\n\n" \
			+ str(payload.get("diagnostics", ""))
	var redaction: Dictionary = payload.get("redaction", {})
	if not redaction.is_empty():
		var removed := PackedStringArray()
		for key in redaction:
			removed.append("%s×%d" % [key, int(redaction[key])])
		out += "\n## " + UIStrings.t("feedback.report.redacted") + "\n\n" \
				+ ", ".join(removed) + "\n"
	return out


func _on_response(_result: int, code: int, _headers: PackedStringArray,
		body: PackedByteArray) -> void:
	var text := body.get_string_from_utf8()
	var data: Variant = JSON.parse_string(text)
	var payload: Dictionary = data if data is Dictionary else {}
	if code == 200 or code == 201:
		last_ticket = str(payload.get("ticket", ""))
		_finish(true, UIStrings.t("feedback.sent"), last_ticket)
		return
	if code == 429:
		_finish(false, UIStrings.t("feedback.too_many"), "")
		return
	Log.warn("feedback", "endpoint ha risposto %d: %s" % [code, text.substr(0, 200)])
	_finish(false, UIStrings.t("feedback.failed"), "")


func _finish(ok: bool, message: String, ticket: String) -> void:
	_sending = false
	_queued_submit = {}
	submit_changed.emit(false, ok, message, ticket)


## Il thread delle sonde va joinato prima che l'engine smonti gli autoload:
## lasciarlo vivo produce segfault in cleanup (stessa lezione del thread SSH
## del backend, 12/07).
func _exit_tree() -> void:
	if _thread != null and _thread.is_started():
		_thread.wait_to_finish()
		_thread = null

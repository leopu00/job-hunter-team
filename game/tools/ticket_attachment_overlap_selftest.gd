extends Node
## Il trasporto documenti è condiviso dal wizard e dai ticket posizione.
## Questo test ritarda gli esiti per riprodurre l'overlap reale: il CV del
## wizard non deve mai diventare l'allegato del ticket arrivato dopo.

class DelayedBackend extends BackendAdapter:
	var uploads: Array[String] = []
	var tickets: Array[Dictionary] = []

	func start(_config: Dictionary) -> void:
		live = true

	func stop() -> void:
		live = false

	func upload_document(local_path: String) -> void:
		uploads.append(local_path)

	func create_ticket(position_id: int, text: String,
			attachment_path := "") -> void:
		tickets.append({"position_id": position_id, "text": text,
				"attachment_path": attachment_path})


func _ready() -> void:
	var backend := DelayedBackend.new()
	BackendBus.set_backend(backend)

	# A è già in volo dal wizard. B deve fallire chiuso, non partire in
	# parallelo e soprattutto non consumare il completamento di A.
	BackendBus.upload_user_document("/tmp/wizard-cv.pdf")
	BackendBus.create_position_ticket(77, "Leggi il brief", "/tmp/brief.pdf")
	BackendBus.publish_document_upload(
			true, "/jht_user/allegati/wizard-cv.pdf", "")
	if backend.uploads != ["/tmp/wizard-cv.pdf"] or not backend.tickets.is_empty():
		_fail("overlap non fail-closed", backend)
		return

	# Dopo che A ha terminato, riprovare B crea esattamente un upload e il
	# ticket nasce soltanto dal SUO esito attestato.
	BackendBus.create_position_ticket(77, "Leggi il brief", "/tmp/brief.pdf")
	if backend.uploads != ["/tmp/wizard-cv.pdf", "/tmp/brief.pdf"]:
		_fail("retry non ha avviato il brief", backend)
		return
	BackendBus.publish_document_upload(true, "/jht_user/allegati/brief.pdf", "")
	var ok: bool = backend.tickets.size() == 1 \
			and backend.tickets[0]["attachment_path"] \
			== "/jht_user/allegati/brief.pdf"
	if not ok:
		_fail("ticket non correlato al brief", backend)
		return

	BackendBus.set_backend(null)
	print("TICKET-ATTACHMENT-OVERLAP PASS")
	get_tree().quit(0)


func _fail(reason: String, backend: DelayedBackend) -> void:
	print("TICKET-ATTACHMENT-OVERLAP FAIL ", reason, " ",
			JSON.stringify({"uploads": backend.uploads, "tickets": backend.tickets}))
	BackendBus.set_backend(null)
	get_tree().quit(1)

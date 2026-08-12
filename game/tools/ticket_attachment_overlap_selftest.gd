extends Node
## Il trasporto documenti è condiviso dal wizard e dai ticket posizione.
## Questo test ritarda gli esiti per riprodurre l'overlap reale: il CV del
## wizard non deve mai diventare l'allegato del ticket arrivato dopo.

class DelayedBackend extends BackendAdapter:
	var uploads: Array[Dictionary] = []
	var tickets: Array[Dictionary] = []

	func start(_config: Dictionary) -> void:
		live = true

	func stop() -> void:
		live = false

	func upload_document(local_path: String, request_id := 0) -> void:
		uploads.append({"path": local_path, "request_id": request_id})

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
			int(backend.uploads[0]["request_id"]), true,
			"/jht_user/allegati/wizard-cv.pdf", "")
	if backend.uploads.size() != 1 \
			or backend.uploads[0]["path"] != "/tmp/wizard-cv.pdf" \
			or not backend.tickets.is_empty():
		_fail("overlap non fail-closed", backend)
		return

	# Dopo che A ha terminato, riprovare B crea esattamente un upload e il
	# ticket nasce soltanto dal SUO esito attestato.
	BackendBus.create_position_ticket(77, "Leggi il brief", "/tmp/brief.pdf")
	if backend.uploads.size() != 2 \
			or backend.uploads[1]["path"] != "/tmp/brief.pdf":
		_fail("retry non ha avviato il brief", backend)
		return
	# Anche un completamento duplicato/tardivo di A non può consumare B.
	BackendBus.publish_document_upload(int(backend.uploads[0]["request_id"]),
			true, "/jht_user/allegati/wizard-cv.pdf", "")
	if not backend.tickets.is_empty():
		_fail("completamento stale attribuito al retry", backend)
		return
	BackendBus.publish_document_upload(int(backend.uploads[1]["request_id"]),
			true, "/jht_user/allegati/brief.pdf", "")
	var ok: bool = backend.tickets.size() == 1 \
			and backend.tickets[0]["attachment_path"] \
			== "/jht_user/allegati/brief.pdf"
	if not ok:
		_fail("ticket non correlato al brief", backend)
		return

	# Ordine inverso: il ticket C possiede il trasporto; il wizard D deve
	# fallire chiuso senza sottrarre né cambiare l'esito attestato di C.
	var reverse := DelayedBackend.new()
	BackendBus.set_backend(reverse)
	BackendBus.create_position_ticket(88, "Leggi il ticket", "/tmp/ticket.pdf")
	BackendBus.upload_user_document("/tmp/wizard-later.pdf")
	if reverse.uploads.size() != 1 \
			or reverse.uploads[0]["path"] != "/tmp/ticket.pdf" \
			or not reverse.tickets.is_empty():
		_fail("overlap inverso non fail-closed", reverse)
		return
	BackendBus.publish_document_upload(
			int(reverse.uploads[0]["request_id"]), true,
			"/jht_user/allegati/ticket.pdf", "")
	if reverse.tickets.size() != 1 \
			or reverse.tickets[0]["attachment_path"] \
			!= "/jht_user/allegati/ticket.pdf":
		_fail("ticket iniziale consumato dal wizard", reverse)
		return

	BackendBus.set_backend(null)
	print("TICKET-ATTACHMENT-OVERLAP PASS")
	get_tree().quit(0)


func _fail(reason: String, backend: DelayedBackend) -> void:
	print("TICKET-ATTACHMENT-OVERLAP FAIL ", reason, " ",
			JSON.stringify({"uploads": backend.uploads, "tickets": backend.tickets}))
	BackendBus.set_backend(null)
	get_tree().quit(1)

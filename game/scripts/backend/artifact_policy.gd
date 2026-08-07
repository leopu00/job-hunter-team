class_name ArtifactPolicy
## Policy pura per i documenti che attraversano container -> desktop.
## I path nel jobs.db sono input non fidato: il tipo viene dichiarato dal
## chiamante, ma deve essere coerente con root e suffisso prima del fetch e
## con i byte prima che il client scriva qualunque file sull'host.

const KIND_MARKDOWN := "markdown"
const KIND_PDF := "pdf"

const REMOTE_ROOTS := [
	"/jht_user/cv",
	"/jht_user/allegati",
	"/jht_user/output",
	"/jht_user/critiche",
]

const PDF_SUFFIX := ".pdf"
const MARKDOWN_SUFFIX := ".md"


static func is_allowed_request(path: String, kind: String) -> bool:
	# Niente normalizzazione permissiva: traversal, slash doppi, whitespace e
	# separatori host sono input non canonici, non spelling alternativi.
	if path == "" or path != path.strip_edges() or not path.begins_with("/") \
			or path.contains("\\"):
		return false
	for byte in path.to_utf8_buffer():
		if byte == 0:
			return false
	var parts := path.split("/", false)
	if parts.has(".") or parts.has("..") or path.contains("//"):
		return false
	var in_root := false
	for root in REMOTE_ROOTS:
		if path.begins_with(root + "/"):
			in_root = true
			break
	if not in_root:
		return false
	var suffix := PDF_SUFFIX if kind == KIND_PDF else MARKDOWN_SUFFIX \
			if kind == KIND_MARKDOWN else ""
	if suffix == "":
		return false
	var filename := path.get_file()
	if not filename.to_lower().ends_with(suffix):
		return false
	var stem := filename.left(filename.length() - suffix.length())
	# Blocca doppie estensioni: payload.pdf.exe e payload.exe.pdf.
	return stem != "" and not stem.contains(".")


static func is_pdf_bytes(data: PackedByteArray) -> bool:
	# Header al byte zero: un prefisso MZ/HTML seguito da %PDF e' polimorfo.
	# L'EOF vicino alla coda evita il file arbitrario col solo magic prefix.
	if data.size() < 10:
		return false
	var magic := [37, 80, 68, 70, 45]  # %PDF-
	for i in magic.size():
		if data[i] != magic[i]:
			return false
	var eof := [37, 37, 69, 79, 70]  # %%EOF
	var first := maxi(0, data.size() - 1024)
	for i in range(first, data.size() - eof.size() + 1):
		var found := true
		for j in eof.size():
			if data[i + j] != eof[j]:
				found = false
				break
		if found:
			return true
	return false


static func client_filename(remote_path: String, kind: String) -> String:
	# Il basename remoto non raggiunge il filesystem host. Il digest rende
	# stabili due pannelli sullo stesso documento senza conservare il nome o
	# l'estensione scelti dal container.
	var suffix := PDF_SUFFIX if kind == KIND_PDF else MARKDOWN_SUFFIX \
			if kind == KIND_MARKDOWN else ""
	if suffix == "":
		return ""
	return "jht-document-%s%s" % [remote_path.sha256_text().left(16), suffix]

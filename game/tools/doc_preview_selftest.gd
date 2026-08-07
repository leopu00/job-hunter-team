extends SceneTree
## Verifica l'anteprima documenti: conversione markdown→BBCode di
## DocRender (il motore del DocPreviewPanel) (titoli, bullet, righelli, bold, enfasi, parentesi
## quadre letterali) e rasterizzazione PDF locale quando un renderer
## esiste sulla macchina (pdftoppm/sips; senza tool il test la salta).

const MINI_PDF := """%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200]
/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 60 >> stream
BT /F1 24 Tf 40 100 Td (JHT TEST) Tj ET
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
startxref
0
%%EOF
"""

func _init() -> void:
	var failures: Array[String] = []

	# ── markdown → bbcode ──
	var md := "# Titolo\n## Sezione\n- punto **forte**\n---\ntesto *enfasi* [x]"
	var bb := DocRender.md_to_bbcode(md)
	var checks := {
		"h1": bb.contains("[font_size=22]") and bb.contains("Titolo"),
		"h2": bb.contains("[font_size=18]") and bb.contains("▸ Sezione"),
		"bullet": bb.contains("• punto"),
		"bold": bb.contains("[b][color=#") and bb.contains("forte[/color][/b]"),
		"hr": bb.contains("────"),
		"emph": bb.contains("]enfasi[/color]"),
		"brackets": bb.contains("[lb]x[rb]"),
		"no_md_left": not bb.contains("**") and not bb.contains("# "),
	}
	for key in checks:
		if not checks[key]:
			failures.append("md:" + key)

	# ── nomi pagina pdftoppm (1 cifra sotto le 10 pagine, 2 da 10 in su) ──
	if DocRender.page_names("/tmp/p", 3) != ["/tmp/p-3.png", "/tmp/p-03.png"]:
		failures.append("page_names")

	# ── confine artifact container -> host ──
	for root in ArtifactPolicy.REMOTE_ROOTS:
		if not ArtifactPolicy.is_allowed_request(root + "/CV_Test.pdf",
				ArtifactPolicy.KIND_PDF):
			failures.append("policy:canonical_pdf:" + root)
		if not ArtifactPolicy.is_allowed_request(root + "/CV_Test.md",
				ArtifactPolicy.KIND_MARKDOWN):
			failures.append("policy:canonical_md:" + root)
	var denied := [
		["/jht_home/agents/scrittore/payload.pdf", ArtifactPolicy.KIND_PDF],
		["/jht_user/cv/../allegati/payload.pdf", ArtifactPolicy.KIND_PDF],
		["/jht_user/cv/payload.pdf.exe", ArtifactPolicy.KIND_PDF],
		["/jht_user/cv/payload.exe.pdf", ArtifactPolicy.KIND_PDF],
		["/jht_user/cv/payload.txt", ArtifactPolicy.KIND_PDF],
		["/jht_user/cv/payload.pdf", ArtifactPolicy.KIND_MARKDOWN],
		["/jht_user//cv/payload.pdf", ArtifactPolicy.KIND_PDF],
		["/jht_user/cv/payload.pdf ", ArtifactPolicy.KIND_PDF],
		["relative/payload.pdf", ArtifactPolicy.KIND_PDF],
		["/jht_user/cv/payload.pdf", "generic"],
	]
	for item in denied:
		if ArtifactPolicy.is_allowed_request(item[0], item[1]):
			failures.append("policy:accepted:" + item[0])
	var pdf_bytes := MINI_PDF.to_utf8_buffer()
	if not ArtifactPolicy.is_pdf_bytes(pdf_bytes):
		failures.append("pdf:valid_rejected")
	for bad in ["not a pdf".to_utf8_buffer(),
			("MZ" + MINI_PDF).to_utf8_buffer(),
			"%PDF-1.4\nno eof".to_utf8_buffer()]:
		if ArtifactPolicy.is_pdf_bytes(bad):
			failures.append("pdf:invalid_accepted")
	var cache_name := ArtifactPolicy.client_filename(
			"/jht_user/cv/payload.exe.pdf", ArtifactPolicy.KIND_PDF)
	if not cache_name.begins_with("jht-document-") \
			or not cache_name.ends_with(".pdf") or cache_name.contains("payload") \
			or cache_name.contains(".exe"):
		failures.append("pdf:client_filename")

	# Nessun piano OPEN PDF contiene shell o associazioni generiche. `open`
	# su macOS e' ammesso soltanto col bundle Preview esplicito.
	for os_name in ["macOS", "Linux"]:
		for candidate in DocRender.pdf_viewer_candidates(os_name):
			var exe := str(candidate["exe"])
			if exe.get_file() in ["cmd.exe", "xdg-open", "gio"]:
				failures.append("viewer:generic:" + exe)
			if os_name == "macOS" and candidate["args"] != PackedStringArray(
					["-b", "com.apple.Preview"]):
				failures.append("viewer:mac_not_preview")
	var render_source := FileAccess.get_file_as_string(
			"res://scripts/ui/doc_render.gd")
	if render_source.contains("OS.shell_open") or render_source.contains("cmd.exe"):
		failures.append("viewer:generic_launcher_source")
	var panel_source := FileAccess.get_file_as_string(
			"res://scripts/ui/doc_preview_panel.gd")
	for anchor in ["BackendBus.fetch_artifact(_md_path, ArtifactPolicy.KIND_MARKDOWN)",
			"BackendBus.fetch_artifact(_pdf_path, ArtifactPolicy.KIND_PDF)",
			"ArtifactPolicy.is_pdf_bytes(data)", "DocRender.open_pdf(local)"]:
		if not panel_source.contains(anchor):
			failures.append("panel:missing:" + anchor)
	var bus_source := FileAccess.get_file_as_string(
			"res://scripts/backend/backend_bus.gd")
	for anchor in ["func fetch_artifact(path: String, kind: String)",
			"ArtifactPolicy.is_allowed_request(clean, kind)",
			"_backend.fetch_artifact(clean, kind)"]:
		if not bus_source.contains(anchor):
			failures.append("bus:missing:" + anchor)
	var backend_source := FileAccess.get_file_as_string(
			"res://scripts/backend/vps_backend.gd")
	for anchor in ["func fetch_artifact(path: String, kind: String)",
			"ArtifactPolicy.is_allowed_request(path, kind)",
			"kind == ArtifactPolicy.KIND_PDF",
			"ArtifactPolicy.is_pdf_bytes(data)"]:
		if not backend_source.contains(anchor):
			failures.append("backend:missing:" + anchor)

	# ── rasterizzazione locale (solo se un renderer c'è) ──
	var cache := OS.get_cache_dir()
	var pdf_path := cache.path_join("jht-selftest.pdf")
	var rejected_path := cache.path_join("jht-selftest-rejected.pdf")
	var rejected := FileAccess.open(rejected_path, FileAccess.WRITE)
	rejected.store_buffer(("MZ" + MINI_PDF).to_utf8_buffer())
	rejected.close()
	if DocRender.open_pdf(rejected_path):
		failures.append("viewer:opened_unattested_pdf")
	var f := FileAccess.open(pdf_path, FileAccess.WRITE)
	f.store_string(MINI_PDF)
	f.close()
	var result := DocRender.rasterize_pdf(pdf_path,
			cache.path_join("jht-selftest-page"))
	var pages: Array = result["pages"]
	if DocRender.has_renderer():
		if pages.is_empty():
			failures.append("raster:no_pages")
		else:
			var img := Image.new()
			if img.load(pages[0]) != OK or img.get_width() < 50:
				failures.append("raster:png_invalid")
	else:
		print("[doc-preview-test] nessun renderer pdf locale: raster saltata")

	if failures.is_empty():
		print("DOC-PREVIEW-TEST PASS")
	else:
		push_error("[doc-preview-test] falliti: %s" % ", ".join(failures))
		print("DOC-PREVIEW-TEST FAIL")
	quit(0 if failures.is_empty() else 1)

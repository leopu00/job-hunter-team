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

	# ── rasterizzazione locale (solo se un renderer c'è) ──
	var cache := OS.get_cache_dir()
	var pdf_path := cache.path_join("jht-selftest.pdf")
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

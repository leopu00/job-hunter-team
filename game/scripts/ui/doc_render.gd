class_name DocRender
## Motore PURO dell'anteprima documenti: markdown→BBCode, rasterizzazione
## PDF locale e lanciatori di sistema. Nessun riferimento ad autoload o
## backend: così i selftest headless (godot --script, dove gli autoload
## non compilano) possono esercitarlo direttamente. La UI vive in
## DocPreviewPanel, che delega qui tutto il lavoro senza stato.

const RASTER_DPI := "110"
const RASTER_MAX_PAGES := 20

## ── Markdown documento → BBCode ──────────────────────────────────────
## Conversione riga-per-riga pensata per i CV degli Scrittori: titoli
## #/##/###, elenchi -/*, righelli, grassetto e enfasi. Niente italic
## tipografico (JetBrains Mono è caricato solo dritto): l'enfasi diventa
## colore. Le parentesi quadre restano letterali, come in markdown_label.
static func md_to_bbcode(md: String) -> String:
	var text := md.replace("[", "").replace("]", "[rb]") \
			.replace("", "[lb]")
	var bold := RegEx.new()
	bold.compile("\\*\\*([^*]+)\\*\\*")
	var emph := RegEx.new()
	emph.compile("(?<!\\*)\\*([^*\\n]+)\\*(?!\\*)")
	var white := "#" + Palette.WHITE.to_html(false)
	var bright := "#" + Palette.BRIGHT.to_html(false)
	var dim := "#" + Palette.DIM.to_html(false)
	var green := "#" + Palette.GREEN.to_html(false)
	var out := PackedStringArray()
	for raw_line: String in text.split("\n"):
		var line := raw_line.strip_edges(false, true)
		var stripped := line.strip_edges()
		if stripped.begins_with("### "):
			out.append("[font_size=16][color=%s][b]%s[/b][/color][/font_size]"
					% [white, _inline(stripped.substr(4), bold, emph, white, bright)])
			continue
		if stripped.begins_with("## "):
			out.append("[font_size=18][color=%s][b]▸ %s[/b][/color][/font_size]"
					% [green, _inline(stripped.substr(3), bold, emph, white, bright)])
			continue
		if stripped.begins_with("# "):
			out.append("[font_size=22][color=%s][b]%s[/b][/color][/font_size]"
					% [white, _inline(stripped.substr(2), bold, emph, white, bright)])
			continue
		if stripped != "" and stripped.count("-") == stripped.length() \
				and stripped.length() >= 3:
			out.append("[color=%s]────────────────────────────────[/color]" % dim)
			continue
		if stripped.begins_with("- ") or stripped.begins_with("* "):
			out.append("  • " + _inline(stripped.substr(2), bold, emph, white, bright))
			continue
		if stripped.begins_with("> "):
			out.append("[color=%s]│ %s[/color]"
					% [dim, _inline(stripped.substr(2), bold, emph, white, bright)])
			continue
		out.append(_inline(line, bold, emph, white, bright))
	return "\n".join(out)

static func _inline(line: String, bold: RegEx, emph: RegEx, white: String,
		bright: String) -> String:
	var rendered := bold.sub(line, "[b][color=%s]$1[/color][/b]" % white, true)
	return emph.sub(rendered, "[color=%s]$1[/color]" % bright, true)

## ── Rasterizzazione PDF locale ───────────────────────────────────────
## pdftoppm (tutte le pagine) con fallback sips su macOS (solo pagina 1).
## Le GUI su macOS non ereditano il PATH di brew: si provano i percorsi
## noti. Ritorna {pages: Array[String], first_page_only: bool}.
static func rasterize_pdf(pdf_local: String, out_prefix: String) -> Dictionary:
	# pulizia dei residui del giro precedente
	for i in range(1, RASTER_MAX_PAGES + 1):
		for candidate in page_names(out_prefix, i):
			DirAccess.remove_absolute(candidate)
	var out: Array = []
	for exe in ["pdftoppm", "/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm"]:
		if OS.execute(exe, ["-png", "-r", RASTER_DPI, pdf_local, out_prefix],
				out, true) == 0:
			var pages: Array = []
			for i in range(1, RASTER_MAX_PAGES + 1):
				var found := ""
				for candidate in page_names(out_prefix, i):
					if FileAccess.file_exists(candidate):
						found = candidate
						break
				if found == "":
					break
				pages.append(found)
			if not pages.is_empty():
				return {"pages": pages, "first_page_only": false}
	if OS.get_name() == "macOS":
		var png := out_prefix + "-sips.png"
		DirAccess.remove_absolute(png)
		if OS.execute("sips", ["-s", "format", "png", pdf_local, "--out", png],
				out, true) == 0 and FileAccess.file_exists(png):
			return {"pages": [png], "first_page_only": true}
	return {"pages": [], "first_page_only": false}

## pdftoppm numera "-1.png" sotto le 10 pagine e "-01.png" da 10 in su.
static func page_names(prefix: String, page: int) -> Array:
	return ["%s-%d.png" % [prefix, page], "%s-%02d.png" % [prefix, page]]

## Un renderer pdf locale esiste? (sips è di sistema su macOS)
static func has_renderer() -> bool:
	var out: Array = []
	for exe in ["pdftoppm", "/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm"]:
		if OS.execute(exe, ["-v"], out, true) == 0:
			return true
	return OS.get_name() == "macOS"

## ── Lanciatori di sistema ────────────────────────────────────────────

## OS.shell_open può fallire in silenzio (visto col pdf del 19/07): si
## passa ai lanciatori nativi come fallback.
static func open_externally(path: String) -> bool:
	if OS.shell_open(path) == OK:
		return true
	match OS.get_name():
		"macOS":
			return OS.execute("open", [path]) == 0
		"Windows":
			return OS.execute("cmd.exe", ["/c", "start", "", path]) == 0
		_:
			return OS.execute("xdg-open", [path]) == 0

static func reveal_file(path: String) -> bool:
	match OS.get_name():
		"macOS":
			return OS.execute("open", ["-R", path]) == 0
		"Windows":
			var out: Array = []
			# explorer esce con 1 anche quando funziona: niente check exit
			OS.execute("explorer.exe", ["/select,%s" % path.replace("/", "\\")], out)
			return true
		_:
			return OS.execute("xdg-open", [path.get_base_dir()]) == 0

## Nome file sicuro per il filesystem locale: solo [A-Za-z0-9._-], come
## l'igiene dell'upload (VpsBackend non è importabile qui: autoload).
static func safe_filename(name: String) -> String:
	var out := ""
	for i in name.length():
		var c := name[i]
		var code := c.unicode_at(0)
		var is_ok: bool = (code >= 48 and code <= 57) \
				or (code >= 65 and code <= 90) or (code >= 97 and code <= 122) \
				or c == "." or c == "_" or c == "-"
		out += c if is_ok else "_"
	out = out.lstrip(".")
	return out if out != "" else UIStrings.t("common.document")

class_name DocPreviewPanel
extends CanvasLayer
## Anteprima in-game dei documenti scritti dal team (CV / cover letter).
## Il markdown vive sul container: arriva via BackendBus.fetch_artifact e
## viene reso in BBCode nel tema terminale. Il PDF ha tre strade: anteprima
## in-game (rasterizzata in locale con pdftoppm/sips), apertura nel viewer
## di sistema, e "mostra nella cartella" che salva una copia visibile in
## Downloads/JHT-CV e la rivela nel Finder/Explorer.

signal closed

const PANEL_MIN_SIZE := Vector2(880, 620)
const SHEET_WIDTH := 780.0          # larghezza utile del foglio (fit pagine)
const EXPORT_DIR_NAME := "JHT-CV"   # sottocartella di Downloads per il reveal

var _md_path := ""
var _pdf_path := ""
var _title := ""
var _md_bytes := PackedByteArray()
var _pdf_bytes := PackedByteArray()
## Azione da eseguire quando i bytes del pdf arrivano:
## "preview" | "open" | "reveal" | "".
var _pdf_action := ""

var _body: RichTextLabel
var _pdf_box: VBoxContainer
var _status: Label
var _tab_text: Button
var _tab_pdf: Button
var _open_btn: Button
var _reveal_btn: Button
var _pdf_pages_built := false

func _init(md_path: String, pdf_path: String, doc_title: String) -> void:
	_md_path = md_path
	_pdf_path = pdf_path
	_title = doc_title
	layer = 44  # sopra l'archivio CV (42)
	add_to_group("camera_blocking_overlay")

func _ready() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = TerminalTheme.get_theme()
	add_child(root)

	var dim := ColorRect.new()
	dim.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.72)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed \
				and event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT]:
			close())
	root.add_child(dim)

	var holder := MarginContainer.new()
	holder.set_anchors_preset(Control.PRESET_FULL_RECT)
	holder.add_theme_constant_override("margin_left", 140)
	holder.add_theme_constant_override("margin_right", 140)
	holder.add_theme_constant_override("margin_top", 34)
	holder.add_theme_constant_override("margin_bottom", 34)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(holder)
	var panel := BracketPanel.new()
	panel.custom_minimum_size = PANEL_MIN_SIZE
	holder.add_child(panel)

	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 24)
	panel.add_child(margin)
	var content := VBoxContainer.new()
	content.add_theme_constant_override("separation", 10)
	content.size_flags_vertical = Control.SIZE_EXPAND_FILL
	margin.add_child(content)

	# ── testata ──
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	content.add_child(row)
	row.add_child(TerminalTheme.label("▰", 24, Palette.GREEN, "xbold"))
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(titles)
	titles.add_child(TerminalTheme.label(UIStrings.t("cv.preview_title"), 20,
			Palette.WHITE, "xbold"))
	var subtitle := _title if _title != "" else _display_file()
	titles.add_child(TerminalTheme.label(subtitle, 13, Palette.MUTED))
	var close_btn := Button.new()
	close_btn.flat = true
	close_btn.text = "✕"
	close_btn.add_theme_font_size_override("font_size", 20)
	close_btn.add_theme_color_override("font_color", Palette.MUTED)
	close_btn.add_theme_color_override("font_hover_color", Palette.RED)
	close_btn.pressed.connect(close)
	row.add_child(close_btn)
	content.add_child(HSeparator.new())

	# ── tab TESTO / ANTEPRIMA PDF (solo se esistono entrambe le viste) ──
	if _md_path != "" and _pdf_path != "":
		var tabs := HBoxContainer.new()
		tabs.add_theme_constant_override("separation", 8)
		content.add_child(tabs)
		_tab_text = _tab_button(UIStrings.t("cv.tab_text"), true)
		_tab_text.pressed.connect(func() -> void: _switch_view(false))
		tabs.add_child(_tab_text)
		_tab_pdf = _tab_button(UIStrings.t("cv.tab_pdf"), false)
		_tab_pdf.pressed.connect(func() -> void: _switch_view(true))
		tabs.add_child(_tab_pdf)

	# ── foglio documento ──
	var sheet := PanelContainer.new()
	sheet.size_flags_vertical = Control.SIZE_EXPAND_FILL
	content.add_child(sheet)
	var sheet_margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		sheet_margin.add_theme_constant_override("margin_" + side, 18)
	sheet.add_child(sheet_margin)
	var sheet_box := VBoxContainer.new()
	sheet_box.add_theme_constant_override("separation", 8)
	sheet_margin.add_child(sheet_box)
	_status = TerminalTheme.label("", 13, Palette.DIM)
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	sheet_box.add_child(_status)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sheet_box.add_child(scroll)
	var views := VBoxContainer.new()
	views.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(views)
	_body = RichTextLabel.new()
	_body.bbcode_enabled = true
	_body.fit_content = true
	_body.scroll_active = false
	_body.selection_enabled = true
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.add_theme_color_override("default_color", Palette.BASE)
	_body.add_theme_font_size_override("normal_font_size", 14)
	_body.add_theme_font_size_override("bold_font_size", 14)
	views.add_child(_body)
	_pdf_box = VBoxContainer.new()
	_pdf_box.add_theme_constant_override("separation", 14)
	_pdf_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_pdf_box.visible = false
	views.add_child(_pdf_box)

	# ── azioni ──
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 12)
	content.add_child(actions)
	if _pdf_path != "":
		_open_btn = _action_button(UIStrings.t("cv.open_pdf"))
		_open_btn.pressed.connect(func() -> void: _request_pdf("open"))
		actions.add_child(_open_btn)
	_reveal_btn = _action_button(UIStrings.t("cv.reveal"))
	_reveal_btn.pressed.connect(_on_reveal_pressed)
	actions.add_child(_reveal_btn)
	var hint := TerminalTheme.label(UIStrings.t("cv.doc_close"), 12, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	hint.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hint.size_flags_vertical = Control.SIZE_SHRINK_END
	actions.add_child(hint)

	BackendBus.artifact_fetched.connect(_on_artifact)
	if _md_path != "":
		_set_status(UIStrings.t("cv.doc_loading"), Palette.DIM)
		BackendBus.fetch_artifact(_md_path, ArtifactPolicy.KIND_MARKDOWN)
	else:
		# solo pdf: l'anteprima rasterizzata è l'unica vista utile
		_request_pdf("preview")
	Sfx.play_blip()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		close()
		get_viewport().set_input_as_handled()

func close() -> void:
	Sfx.play_back()
	closed.emit()
	queue_free()

func _display_file() -> String:
	return _md_path.get_file() if _md_path != "" else _pdf_path.get_file()

func _tab_button(text: String, active: bool) -> Button:
	var btn := Button.new()
	btn.text = text
	btn.add_theme_font_size_override("font_size", 12)
	btn.add_theme_color_override("font_color",
			Palette.GREEN if active else Palette.MUTED)
	return btn

func _action_button(text: String) -> Button:
	var btn := Button.new()
	btn.text = text
	btn.add_theme_font_size_override("font_size", 13)
	btn.custom_minimum_size = Vector2(0, 40)
	return btn

func _set_status(text: String, color: Color) -> void:
	_status.visible = text != ""
	_status.text = text
	_status.add_theme_color_override("font_color", color)

func _switch_view(pdf: bool) -> void:
	Sfx.play_tick()
	if is_instance_valid(_tab_text):
		_tab_text.add_theme_color_override("font_color",
				Palette.MUTED if pdf else Palette.GREEN)
	if is_instance_valid(_tab_pdf):
		_tab_pdf.add_theme_color_override("font_color",
				Palette.GREEN if pdf else Palette.MUTED)
	_body.visible = not pdf
	_pdf_box.visible = pdf
	if pdf and not _pdf_pages_built:
		_request_pdf("preview")

## ── Flusso bytes PDF (fetch una sola volta, poi azioni locali) ───────

func _request_pdf(action: String) -> void:
	if _pdf_path == "":
		return
	if not _pdf_bytes.is_empty():
		_run_pdf_action(action)
		return
	if _pdf_action != "":
		_pdf_action = action  # l'ultima richiesta vince, il fetch è già in volo
		return
	_pdf_action = action
	_set_buttons_busy(true)
	_set_status(UIStrings.t("cv.doc_loading"), Palette.DIM)
	BackendBus.fetch_artifact(_pdf_path, ArtifactPolicy.KIND_PDF)

func _on_artifact(path: String, ok: bool, data: PackedByteArray, error: String) -> void:
	if not is_instance_valid(_body):
		return
	if path == _md_path:
		if ok:
			_md_bytes = data
			_set_status("", Palette.DIM)
			_body.text = DocRender.md_to_bbcode(data.get_string_from_utf8())
		else:
			_set_status(UIStrings.t("cv.doc_error") + error, Palette.RED)
	elif path == _pdf_path and _pdf_action != "":
		var action := _pdf_action
		_pdf_action = ""
		_set_buttons_busy(false)
		if not ok:
			_set_status(UIStrings.t("cv.doc_error") + error, Palette.RED)
			return
		# Ultimo confine prima del filesystem host: anche una risposta backend
		# ok non puo' trasformare byte generici in un PDF.
		if not ArtifactPolicy.is_pdf_bytes(data):
			_set_status(UIStrings.t("cv.doc_error") \
					+ UIStrings.t("vps.artifact.invalid"), Palette.RED)
			return
		_pdf_bytes = data
		_set_status("", Palette.DIM)
		_run_pdf_action(action)

func _set_buttons_busy(busy: bool) -> void:
	if is_instance_valid(_open_btn):
		_open_btn.disabled = busy
	if is_instance_valid(_reveal_btn):
		_reveal_btn.disabled = busy

func _run_pdf_action(action: String) -> void:
	match action:
		"preview":
			_build_pdf_preview()
		"open":
			_open_pdf_external()
		"reveal":
			_reveal_in_folder()

## ── Anteprima PDF in-game (rasterizzazione locale) ───────────────────

func _build_pdf_preview() -> void:
	if _pdf_pages_built:
		return
	_set_status(UIStrings.t("cv.pdf_rendering"), Palette.DIM)
	var pdf_local := _save_pdf_to(OS.get_cache_dir(), _pdf_bytes)
	if pdf_local == "":
		_set_status(UIStrings.t("cv.error_cache_unwritable"),
				Palette.RED)
		return
	var result := DocRender.rasterize_pdf(pdf_local,
			OS.get_cache_dir().path_join("jht-doc-page"))
	var pages: Array = result["pages"]
	if pages.is_empty():
		# niente renderizzatore locale: il pdf resta apribile fuori dal gioco
		_set_status(UIStrings.t("cv.pdf_no_tool"), Palette.YELLOW)
		if _md_path != "":
			_switch_view(false)
		return
	for page_path in pages:
		var img := Image.new()
		if img.load(page_path) != OK:
			continue
		var rect := TextureRect.new()
		rect.texture = ImageTexture.create_from_image(img)
		rect.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		rect.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		var scale := minf(1.0, SHEET_WIDTH / maxf(1.0, img.get_width()))
		rect.custom_minimum_size = Vector2(img.get_width() * scale,
				img.get_height() * scale)
		_pdf_box.add_child(rect)
	_pdf_pages_built = _pdf_box.get_child_count() > 0
	if not _pdf_pages_built:
		_set_status(UIStrings.t("cv.error_pages_unreadable"),
				Palette.RED)
		return
	_set_status(UIStrings.t("cv.pdf_first_page_only") \
			if result["first_page_only"] else "", Palette.DIM)
	_body.visible = false
	_pdf_box.visible = true
	if is_instance_valid(_tab_text):
		_switch_view(true)

## ── Apertura esterna e reveal nella cartella ─────────────────────────

func _open_pdf_external() -> void:
	var local := _save_pdf_to(OS.get_cache_dir(), _pdf_bytes)
	if local == "":
		_set_status(UIStrings.t("cv.error_cache_unwritable"),
				Palette.RED)
		return
	if not DocRender.open_pdf(local):
		_set_status(UIStrings.t("cv.open_failed") + local, Palette.RED)

func _on_reveal_pressed() -> void:
	# il reveal mostra il PDF se c'è, altrimenti il markdown
	if _pdf_path != "":
		_request_pdf("reveal")
	elif not _md_bytes.is_empty():
		_reveal_in_folder()
	else:
		_set_status(UIStrings.t("cv.error_not_downloaded"),
				Palette.RED)

## Copia visibile in Downloads/JHT-CV (md + pdf quando ci sono), poi
## Finder/Explorer con il file selezionato.
func _reveal_in_folder() -> void:
	var downloads := OS.get_system_dir(OS.SYSTEM_DIR_DOWNLOADS)
	if downloads == "":
		downloads = OS.get_cache_dir()
	var folder := downloads.path_join(EXPORT_DIR_NAME)
	DirAccess.make_dir_recursive_absolute(folder)
	var target := ""
	if not _md_bytes.is_empty():
		target = _save_markdown_to(folder, _md_path, _md_bytes)
	if not _pdf_bytes.is_empty():
		var pdf_target := _save_pdf_to(folder, _pdf_bytes)
		if pdf_target != "":
			target = pdf_target
	if target == "":
		_set_status(UIStrings.t("cv.error_folder_unwritable"),
				Palette.RED)
		return
	_set_status(UIStrings.t("cv.reveal_done") + folder, Palette.MINT)
	if not DocRender.reveal_file(target):
		_set_status(UIStrings.t("cv.open_failed") + folder, Palette.RED)

func _save_markdown_to(folder: String, remote_path: String,
		data: PackedByteArray) -> String:
	if data.is_empty():
		return ""
	var name := ArtifactPolicy.client_filename(remote_path,
			ArtifactPolicy.KIND_MARKDOWN)
	return _write_client_file(folder, name, data)

func _save_pdf_to(folder: String, data: PackedByteArray) -> String:
	if not ArtifactPolicy.is_pdf_bytes(data):
		return ""
	var name := ArtifactPolicy.client_filename(_pdf_path, ArtifactPolicy.KIND_PDF)
	return _write_client_file(folder, name, data)

func _write_client_file(folder: String, filename: String,
		data: PackedByteArray) -> String:
	if filename == "" or data.is_empty():
		return ""
	var local := folder.path_join(filename)
	var f := FileAccess.open(local, FileAccess.WRITE)
	if f == null:
		return ""
	f.store_buffer(data)
	f.close()
	return local

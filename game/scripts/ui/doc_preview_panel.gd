class_name DocPreviewPanel
extends CanvasLayer
## Anteprima in-game dei documenti scritti dal team (CV / cover letter).
## Il markdown vive sul container: arriva via BackendBus.fetch_artifact e
## viene reso in BBCode nel tema terminale. Il PDF non si renderizza in
## Godot: si scarica nella cache locale e si apre nel viewer di sistema.

signal closed

const PANEL_MIN_SIZE := Vector2(880, 620)

var _md_path := ""
var _pdf_path := ""
var _title := ""
var _body: RichTextLabel
var _status: Label
var _pdf_btn: Button
var _pdf_requested := false

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
	sheet_box.add_child(_status)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	sheet_box.add_child(scroll)
	_body = RichTextLabel.new()
	_body.bbcode_enabled = true
	_body.fit_content = true
	_body.scroll_active = false
	_body.selection_enabled = true
	_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_body.add_theme_color_override("default_color", Palette.BASE)
	_body.add_theme_font_size_override("normal_font_size", 14)
	_body.add_theme_font_size_override("bold_font_size", 14)
	scroll.add_child(_body)

	# ── azioni ──
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 12)
	content.add_child(actions)
	if _pdf_path != "":
		_pdf_btn = Button.new()
		_pdf_btn.text = UIStrings.t("cv.open_pdf")
		_pdf_btn.add_theme_font_size_override("font_size", 13)
		_pdf_btn.custom_minimum_size = Vector2(0, 40)
		_pdf_btn.pressed.connect(_open_pdf)
		actions.add_child(_pdf_btn)
	var hint := TerminalTheme.label(UIStrings.t("cv.doc_close"), 12, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	hint.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hint.size_flags_vertical = Control.SIZE_SHRINK_END
	actions.add_child(hint)

	BackendBus.artifact_fetched.connect(_on_artifact)
	if _md_path != "":
		_status.text = UIStrings.t("cv.doc_loading")
		BackendBus.fetch_artifact(_md_path)
	else:
		_status.text = UIStrings.t("cv.doc_pdf_only")
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

func _on_artifact(path: String, ok: bool, data: PackedByteArray, error: String) -> void:
	if not is_instance_valid(_body):
		return
	if path == _md_path:
		if ok:
			_status.visible = false
			_body.text = _md_doc_to_bbcode(data.get_string_from_utf8())
		else:
			_status.add_theme_color_override("font_color", Palette.RED)
			_status.text = UIStrings.t("cv.doc_error") + error
	elif path == _pdf_path and _pdf_requested:
		_pdf_requested = false
		if is_instance_valid(_pdf_btn):
			_pdf_btn.disabled = false
			_pdf_btn.text = UIStrings.t("cv.open_pdf")
		if ok:
			_shell_open_pdf(data)
		else:
			_status.visible = true
			_status.add_theme_color_override("font_color", Palette.RED)
			_status.text = UIStrings.t("cv.doc_error") + error

## Il pdf arriva binario dal container: file nella cache locale e viewer
## di sistema (in Godot non esiste un renderer pdf: scelta deliberata).
func _open_pdf() -> void:
	if _pdf_requested:
		return
	_pdf_requested = true
	_pdf_btn.disabled = true
	_pdf_btn.text = UIStrings.t("cv.opening_pdf")
	Sfx.play_tick()
	BackendBus.fetch_artifact(_pdf_path)

func _shell_open_pdf(data: PackedByteArray) -> void:
	var local := OS.get_cache_dir().path_join(
			VpsBackend._safe_filename(_pdf_path.get_file()))
	var f := FileAccess.open(local, FileAccess.WRITE)
	if f == null:
		_status.visible = true
		_status.add_theme_color_override("font_color", Palette.RED)
		_status.text = UIStrings.t("cv.doc_error") + "cache locale non scrivibile"
		return
	f.store_buffer(data)
	f.close()
	OS.shell_open(local)

## ── Markdown documento → BBCode ──────────────────────────────────────
## Conversione riga-per-riga pensata per i CV degli Scrittori: titoli
## #/##/###, elenchi -/*, righelli, grassetto e enfasi. Niente italic
## tipografico (JetBrains Mono è caricato solo dritto): l'enfasi diventa
## colore. Le parentesi quadre restano letterali, come in markdown_label.
static func _md_doc_to_bbcode(md: String) -> String:
	var text := md.replace("[", "\uE000").replace("]", "[rb]") \
			.replace("\uE000", "[lb]")
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

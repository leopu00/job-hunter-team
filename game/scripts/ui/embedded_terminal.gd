class_name EmbeddedTerminal
extends CanvasLayer
## Console PTY incorporata per login provider e futuri flussi tecnici.
## Nessuna finestra di sistema: output, tastiera, URL e clipboard restano nel
## gioco mentre il processo CLI continua a vivere nel container locale/VPS.

signal closed

const MAX_RAW_CHARS := 100000
const MAX_VISIBLE_CHARS := 50000

var provider := ""
var spec: Dictionary = {}
var _thread: Thread
var _stdio: FileAccess
var _stderr: FileAccess
var _pid := -1
var _closing := false
var _finished := false
var _pending_bytes := PackedByteArray()
var _raw_bytes := PackedByteArray()
var _last_url := ""
var _output: RichTextLabel
var _status: Label
var _input: LineEdit
var _open_url: Button
var _copy_url: Button
var _done: Button
var _mutex := Mutex.new()
var _auth_was_ready := false
var _auth_autoclose_started := false


func _init(p_provider: String, p_spec: Dictionary) -> void:
	provider = p_provider
	spec = p_spec
	layer = 70
	process_mode = Node.PROCESS_MODE_ALWAYS
	add_to_group("camera_blocking_overlay")
	add_to_group("embedded_terminal")


func _ready() -> void:
	_build_ui()
	var setup := get_node_or_null("/root/SetupService")
	if setup != null and provider.begins_with("provider:"):
		_auth_was_ready = _matching_auth_ready(setup.status)
		setup.status_changed.connect(_on_setup_status)
	_thread = Thread.new()
	_thread.start(_run_process)


func _process(_delta: float) -> void:
	if _pending_bytes.is_empty():
		return
	_mutex.lock()
	var chunk := _pending_bytes
	_pending_bytes = PackedByteArray()
	_mutex.unlock()
	_raw_bytes.append_array(chunk)
	if _raw_bytes.size() > MAX_RAW_CHARS:
		_raw_bytes = _raw_bytes.slice(_raw_bytes.size() - MAX_RAW_CHARS)
	# Decodifica il buffer intero: un codepoint UTF-8 può arrivare in più
	# letture, mentre convertire il singolo byte produrrebbe U+FFFD.
	var visible := _terminal_text(_raw_bytes.get_string_from_utf8())
	if visible.length() > MAX_VISIBLE_CHARS:
		visible = "… output precedente omesso …\n" + visible.right(MAX_VISIBLE_CHARS)
	_output.text = visible
	_output.scroll_to_line(maxi(0, _output.get_line_count() - 1))
	_detect_url(visible)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		close()
		get_viewport().set_input_as_handled()


func _build_ui() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = TerminalTheme.get_theme()
	add_child(root)
	var dim := ColorRect.new()
	dim.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.88)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(dim)
	var holder := MarginContainer.new()
	holder.set_anchors_preset(Control.PRESET_FULL_RECT)
	holder.add_theme_constant_override("margin_left", 90)
	holder.add_theme_constant_override("margin_right", 90)
	holder.add_theme_constant_override("margin_top", 55)
	holder.add_theme_constant_override("margin_bottom", 55)
	root.add_child(holder)
	var panel := BracketPanel.new()
	panel.custom_minimum_size = Vector2(980, 650)
	holder.add_child(panel)
	var pad := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 24)
	panel.add_child(pad)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	pad.add_child(col)

	var header := HBoxContainer.new()
	col.add_child(header)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(titles)
	titles.add_child(TerminalTheme.label("LOGIN " + str(spec.get("title", provider)).to_upper(),
			24, Palette.WHITE, "xbold"))
	var hint := TerminalTheme.label(str(spec.get("hint", "")), 13, Palette.YELLOW)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	titles.add_child(hint)
	_status = TerminalTheme.label("● AVVIO CONSOLE…", 13, Palette.YELLOW, "bold")
	_status.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	header.add_child(_status)
	var close_button := Button.new()
	close_button.flat = true
	close_button.text = "✕"
	close_button.pressed.connect(close)
	header.add_child(close_button)
	col.add_child(HSeparator.new())

	_output = RichTextLabel.new()
	_output.bbcode_enabled = false
	_output.selection_enabled = true
	_output.context_menu_enabled = true
	_output.scroll_active = true
	_output.scroll_following = true
	_output.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_output.add_theme_font_size_override("normal_font_size", 15)
	_output.add_theme_color_override("default_color", Palette.BRIGHT)
	_output.text = "Preparazione del terminale interattivo…"
	col.add_child(_output)

	var url_row := HBoxContainer.new()
	url_row.add_theme_constant_override("separation", 8)
	col.add_child(url_row)
	var url_label := TerminalTheme.label("LINK RILEVATO", 12, Palette.MUTED, "medium")
	url_row.add_child(url_label)
	_open_url = Button.new()
	_open_url.text = "APRI NEL BROWSER"
	_open_url.disabled = true
	_open_url.pressed.connect(func() -> void:
		if _last_url != "": OS.shell_open(_last_url))
	url_row.add_child(_open_url)
	_copy_url = Button.new()
	_copy_url.text = "COPIA LINK"
	_copy_url.disabled = true
	_copy_url.pressed.connect(func() -> void:
		if _last_url != "": DisplayServer.clipboard_set(_last_url))
	url_row.add_child(_copy_url)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	url_row.add_child(spacer)
	var paste := Button.new()
	paste.text = "INCOLLA"
	paste.pressed.connect(func() -> void:
		_input.text += DisplayServer.clipboard_get()
		_input.grab_focus())
	url_row.add_child(paste)

	var input_row := HBoxContainer.new()
	input_row.add_theme_constant_override("separation", 8)
	col.add_child(input_row)
	_input = LineEdit.new()
	_input.placeholder_text = "Scrivi una scelta, /login o il codice e premi Invio"
	_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_input.text_submitted.connect(_submit_line)
	input_row.add_child(_input)
	for entry in [["↑", "\u001b[A"], ["↓", "\u001b[B"], ["TAB", "\t"],
			["INVIO", "\r"], ["CTRL+C", "\u0003"]]:
		var button := Button.new()
		button.text = str(entry[0])
		button.pressed.connect(_send.bind(str(entry[1])))
		input_row.add_child(button)
	_done = Button.new()
	_done.text = "HO COMPLETATO IL LOGIN"
	_done.add_theme_color_override("font_color", Palette.GREEN)
	_done.pressed.connect(_complete)
	col.add_child(_done)


func _run_process() -> void:
	var process := OS.execute_with_pipe(str(spec.get("path", "")),
			PackedStringArray(spec.get("args", PackedStringArray())), true)
	if process.is_empty():
		call_deferred("_process_failed", "Impossibile avviare la console interna")
		return
	_mutex.lock()
	_stdio = process["stdio"]
	_stderr = process["stderr"]
	_pid = int(process["pid"])
	_mutex.unlock()
	call_deferred("_process_started")
	# FileAccess sui pipe non espone i byte disponibili. Una lettura per byte
	# consegna immediatamente anche prompt corti in attesa di input; la UI li
	# aggrega una volta per frame evitando migliaia di redraw.
	while not _closing and is_instance_valid(_stderr) and not _stderr.eof_reached():
		var one := _stderr.get_buffer(1)
		if one.is_empty():
			if not OS.is_process_running(_pid):
				break
			OS.delay_msec(2)
			continue
		if _stderr.eof_reached() and one[0] == 0:
			break
		call_deferred("_queue_byte", one[0])
	var exit_code := -1
	if _pid > 0:
		while OS.is_process_running(_pid) and not _closing:
			OS.delay_msec(10)
		if not OS.is_process_running(_pid):
			exit_code = OS.get_process_exit_code(_pid)
	call_deferred("_process_finished", exit_code)


func _process_started() -> void:
	_status.text = "● CONSOLE INTERATTIVA"
	_status.add_theme_color_override("font_color", Palette.GREEN)
	_input.grab_focus()


func _queue_byte(byte: int) -> void:
	if _closing:
		return
	_mutex.lock()
	_pending_bytes.append(byte)
	_mutex.unlock()


func _process_failed(message: String) -> void:
	_finished = true
	_status.text = "● ERRORE"
	_status.add_theme_color_override("font_color", Palette.RED)
	_output.text = message


func _process_finished(code: int) -> void:
	_finished = true
	_status.text = "● LOGIN TERMINATO" if code == 0 else "● PROCESSO CHIUSO (%d)" % code
	_status.add_theme_color_override("font_color", Palette.GREEN if code == 0 else Palette.YELLOW)
	_refresh_setup()


func _submit_line(text: String) -> void:
	if text == "":
		_send("\r")
	else:
		_send(text + "\r")
	_input.clear()


func _send(data: String) -> void:
	_mutex.lock()
	if is_instance_valid(_stdio) and not _finished:
		_stdio.store_buffer(data.to_utf8_buffer())
		_stdio.flush()
	_mutex.unlock()
	_input.grab_focus()


func _complete() -> void:
	_refresh_setup()
	close()


func _matching_auth_ready(next: Dictionary) -> bool:
	if not provider.begins_with("provider:"):
		return false
	var expected := provider.trim_prefix("provider:")
	return str(next.get("active_provider", "")) == expected \
			and bool(next.get("provider_authenticated", false))


func _on_setup_status(next: Dictionary) -> void:
	var ready := _matching_auth_ready(next)
	if ready and not _auth_was_ready and not _auth_autoclose_started:
		_auth_autoclose_started = true
		_status.text = "● LOGIN RILEVATO · CONFIGURAZIONE AGGIORNATA"
		_status.add_theme_color_override("font_color", Palette.GREEN)
		_done.text = "✓ LOGIN COMPLETATO"
		_done.disabled = true
		_finish_authenticated.call_deferred()
	_auth_was_ready = ready


func _finish_authenticated() -> void:
	# Claude/Kimi possono lasciare la CLI interattiva aperta dopo l'OAuth.
	# Le credenziali persistite sono la conferma affidabile: aggiorniamo la
	# checklist e chiudiamo noi il processo, senza un secondo gesto utente.
	await get_tree().create_timer(0.9).timeout
	if _closing:
		return
	_refresh_setup()
	close()


func _refresh_setup() -> void:
	# Lookup dinamico: mantiene la console riusabile e testabile anche quando
	# viene eseguita come script isolato, senza gli autoload del gioco.
	var setup := get_node_or_null("/root/SetupService")
	if setup != null and setup.has_method("refresh"):
		setup.call("refresh")


func close() -> void:
	if _closing:
		return
	_closing = true
	_mutex.lock()
	if is_instance_valid(_stdio):
		_stdio.store_8(3)
		_stdio.flush()
	if _pid > 0 and OS.is_process_running(_pid):
		OS.kill(_pid)
	_mutex.unlock()
	closed.emit()
	queue_free()


func _exit_tree() -> void:
	_closing = true
	if _thread != null and _thread.is_started():
		_thread.wait_to_finish()


func _detect_url(text: String) -> void:
	var regex := RegEx.new()
	if regex.compile("https?://[^\\s<>()\\[\\]{}]+") != OK:
		return
	var matches := regex.search_all(text)
	if matches.is_empty():
		return
	var candidate := str(matches[-1].get_string()).trim_suffix(".").trim_suffix(",")
	if candidate == _last_url:
		return
	_last_url = candidate
	_open_url.disabled = false
	_copy_url.disabled = false


static func _terminal_text(raw: String) -> String:
	var text := raw.replace("\r\n", "\n").replace("\r", "\n")
	# OSC (titolo/link terminale) e CSI (colori, cursore, clear screen).
	var osc := RegEx.new()
	if osc.compile("\\x1b\\][^\\x07]*(?:\\x07|\\x1b\\\\)") == OK:
		text = osc.sub(text, "", true)
	var csi := RegEx.new()
	if csi.compile("\\x1b\\[[0-?]*[ -/]*[@-~]") == OK:
		text = csi.sub(text, "", true)
	var simple := RegEx.new()
	if simple.compile("\\x1b[@-_]") == OK:
		text = simple.sub(text, "", true)
	text = text.replace("\u0000", "").replace("\b", "")
	var blank := RegEx.new()
	if blank.compile("\\n{4,}") == OK:
		text = blank.sub(text, "\n\n\n", true)
	return text.strip_edges()

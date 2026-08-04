class_name EmbeddedTerminal
extends CanvasLayer
## Console PTY incorporata per login provider e futuri flussi tecnici.
## Nessuna finestra di sistema: output, tastiera, URL e clipboard restano nel
## gioco mentre il processo CLI continua a vivere nel container locale/VPS.

signal closed

const MAX_RAW_CHARS := 100000
const MAX_VISIBLE_CHARS := 50000
const EXIT_REPORT_PATTERN := "\u001b\\]1337;JHTExit=([0-9a-f]+):([0-9]+)\u0007"


## Modello di schermo minimale (griglia + scrollback) per i TUI raw-mode.
## Strappare via le sequenze CSI come faceva il vecchio filtro incollava le
## parole tra loro ("Accessingworkspace:", test Leone 23/07): i TUI
## posizionano OGNI parola col cursore (ESC[nG, ESC[r;cH), quindi serve
## un cursore vero che scriva su una griglia. Niente colori né attributi:
## qui conta solo che il testo resti leggibile e nell'ordine giusto.
class TermScreen:
	const ROWS := 40  # in sincrono con lo stty del wrapper Windows
	const SCROLLBACK_MAX := 400

	var rows := PackedStringArray([""])
	var scrollback := PackedStringArray()
	var row := 0
	var col := 0
	var saved := Vector2i.ZERO
	var _esc := ""  # sequenza escape parziale fra un feed e l'altro

	func feed(text: String) -> void:
		for i in text.length():
			var ch := text[i]
			if _esc != "":
				_esc += ch
				_advance_escape()
				continue
			var code := ch.unicode_at(0)
			if code == 0x1b:
				_esc = ch
			elif ch == "\n":
				_newline()
			elif ch == "\r":
				col = 0
			elif ch == "\b":
				col = maxi(0, col - 1)
			elif ch == "\t":
				col = (col / 8 + 1) * 8
			elif code >= 32:
				_put(ch)
			# altri codici di controllo (BEL, NUL…): ignorati

	func text() -> String:
		var all := PackedStringArray()
		for line in scrollback:
			all.append(line.strip_edges(false, true))
		for line in rows:
			all.append(line.strip_edges(false, true))
		var joined := "\n".join(all)
		var blank := RegEx.new()
		if blank.compile("\\n{4,}") == OK:
			joined = blank.sub(joined, "\n\n\n", true)
		return joined.strip_edges()

	## Righe correnti (storico + schermo) già ripulite a destra: servono al
	## riconoscimento degli URL spezzati dal wrap della pty.
	func lines() -> PackedStringArray:
		var all := PackedStringArray()
		for line in scrollback:
			all.append(line.strip_edges(false, true))
		for line in rows:
			all.append(line.strip_edges(false, true))
		return all

	func _put(ch: String) -> void:
		_ensure_row()
		var line := rows[row]
		while line.length() < col:
			line += " "
		if col < line.length():
			line = line.substr(0, col) + ch + line.substr(col + 1)
		else:
			line += ch
		rows[row] = line
		col += 1

	func _ensure_row() -> void:
		while rows.size() <= row:
			rows.append("")

	func _newline() -> void:
		row += 1
		if row >= ROWS:
			# scroll: la riga in cima passa nello storico
			scrollback.append(rows[0])
			rows.remove_at(0)
			if scrollback.size() > SCROLLBACK_MAX:
				scrollback = scrollback.slice(scrollback.size() - SCROLLBACK_MAX)
			row = ROWS - 1
		_ensure_row()

	func _advance_escape() -> void:
		var kind := _esc[1]
		if kind == "[":
			if _esc.length() < 3:
				return
			var last := _esc[_esc.length() - 1]
			var lc := last.unicode_at(0)
			if lc >= 0x40 and lc <= 0x7e:
				_csi(_esc.substr(2, _esc.length() - 3), last)
				_esc = ""
			elif _esc.length() > 64:
				_esc = ""
		elif kind == "]":
			# OSC: termina con BEL o con ST (ESC \)
			if _esc.ends_with(String.chr(7)) or _esc.ends_with("\u001b\\"):
				_esc = ""
			elif _esc.length() > 2048:
				_esc = ""
		elif kind == "7":
			saved = Vector2i(row, col)
			_esc = ""
		elif kind == "8":
			row = saved.x
			col = saved.y
			_esc = ""
		elif kind == "M":
			row = maxi(0, row - 1)
			_esc = ""
		elif kind == "(" or kind == ")":
			if _esc.length() >= 3:
				_esc = ""
		else:
			_esc = ""

	func _csi(params: String, final: String) -> void:
		var parts := params.trim_prefix("?").split(";")
		var n := maxi(1, int(parts[0])) if parts[0].is_valid_int() else 1
		match final:
			"A": row = maxi(0, row - n)
			"B": row = mini(ROWS - 1, row + n)
			"C": col += n
			"D": col = maxi(0, col - n)
			"E":
				row = mini(ROWS - 1, row + n)
				col = 0
			"F":
				row = maxi(0, row - n)
				col = 0
			"G": col = maxi(0, n - 1)
			"d": row = mini(ROWS - 1, maxi(0, n - 1))
			"H", "f":
				row = mini(ROWS - 1, maxi(0, n - 1))
				col = 0
				if parts.size() > 1 and parts[1].is_valid_int():
					col = maxi(0, int(parts[1]) - 1)
			"J": _erase_screen(int(parts[0]) if parts[0].is_valid_int() else 0)
			"K": _erase_line(int(parts[0]) if parts[0].is_valid_int() else 0)
			"s": saved = Vector2i(row, col)
			"u":
				row = saved.x
				col = saved.y
			_: pass  # SGR, modi privati, resize: irrilevanti per il testo
		_ensure_row()

	func _erase_screen(mode: int) -> void:
		_ensure_row()
		if mode >= 2:
			# come un terminale vero: il clear NON archivia (i TUI che
			# ridisegnano di continuo inonderebbero lo storico di frame)
			rows = PackedStringArray([""])
			row = 0
			col = 0
		elif mode == 0:
			_erase_line(0)
			while rows.size() > row + 1:
				rows.remove_at(rows.size() - 1)
		else:
			for i in row:
				rows[i] = ""
			_erase_line(1)

	func _erase_line(mode: int) -> void:
		_ensure_row()
		var line := rows[row]
		if mode == 0:
			rows[row] = line.substr(0, mini(col, line.length()))
		elif mode == 1:
			var keep := line.substr(mini(col, line.length()))
			rows[row] = " ".repeat(mini(col, line.length())) + keep
		else:
			rows[row] = ""

var provider := ""
var spec: Dictionary = {}
var _thread: Thread
var _report_thread: Thread
var _stdio: FileAccess
var _stderr: FileAccess
var _pid := -1
var _closing := false
var _finished := false
var _process_exited := false
var _pending_bytes := PackedByteArray()
var _raw_bytes := PackedByteArray()
var _report_bytes := PackedByteArray()
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
var _screen := TermScreen.new()
var _undecoded := PackedByteArray()
var _result_note := ""
## Mouse premuto dentro l'output: selezione in corso, testo congelato.
var _dragging_selection := false


func _init(p_provider: String, p_spec: Dictionary) -> void:
	provider = p_provider
	spec = p_spec
	layer = 70
	process_mode = Node.PROCESS_MODE_ALWAYS
	add_to_group("camera_blocking_overlay")
	add_to_group("embedded_terminal")


## I flussi di login (provider e pairing cloud) mostrano lessico "LOGIN";
## tutto il resto (compose, install, doctor…) è un comando tecnico generico.
func _is_login_flow() -> bool:
	return provider.begins_with("provider:") or provider == "cloud"


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
	# Feed incrementale al modello di schermo. Un codepoint UTF-8 può
	# arrivare spezzato in più letture: gli eventuali byte di coda incompleti
	# restano in _undecoded fino al prossimo giro (decodificarli subito
	# produrrebbe U+FFFD).
	_undecoded.append_array(chunk)
	var cut := _utf8_safe_length(_undecoded)
	if cut > 0:
		_screen.feed(_undecoded.slice(0, cut).get_string_from_utf8())
		_undecoded = _undecoded.slice(cut)
	var visible := _screen.text()
	if visible.length() > MAX_VISIBLE_CHARS:
		visible = UIStrings.t("term.truncated") + "\n" + visible.right(MAX_VISIBLE_CHARS)
	if _result_note != "":
		visible += "\n\n" + _result_note
	# Il testo NON si tocca mentre l'utente sta selezionando: né durante il
	# trascinamento (mouse premuto), né dopo, finché tiene la selezione. Tutto
	# ciò che arriva resta nel modello di schermo e compare appena molla.
	if not _selection_locked():
		_output.text = visible
		_output.scroll_to_line(maxi(0, _output.get_line_count() - 1))
	_detect_url(_screen.lines())


## Vero mentre l'utente sta selezionando col mouse o tiene una selezione:
## in entrambi i casi riscrivere il testo gliela porterebbe via.
func _selection_locked() -> bool:
	return _dragging_selection or _output.get_selected_text() != ""


func _on_output_gui_input(event: InputEvent) -> void:
	var click := event as InputEventMouseButton
	if click == null or click.button_index != MOUSE_BUTTON_LEFT:
		return
	_dragging_selection = click.pressed
	if not click.pressed:
		# Rilasciato: se non ha selezionato nulla il testo riprende a scorrere
		# al prossimo pezzo di output, senza aspettare altri eventi.
		_flush_pending_output()


## Riporta a schermo tutto ciò che è arrivato mentre il testo era congelato.
func _flush_pending_output() -> void:
	if _selection_locked() or not is_instance_valid(_output):
		return
	_output.text = _screen.text()
	if _result_note != "":
		_output.text += "\n\n" + _result_note
	_output.scroll_to_line(maxi(0, _output.get_line_count() - 1))


## Lunghezza del prefisso decodificabile: si tiene indietro solo una
## sequenza UTF-8 multi-byte troncata alla fine del buffer.
static func _utf8_safe_length(bytes: PackedByteArray) -> int:
	var size := bytes.size()
	if size == 0:
		return 0
	var i := size - 1
	while i >= 0 and i >= size - 4 and (bytes[i] & 0xC0) == 0x80:
		i -= 1
	if i < 0:
		return size
	var lead := bytes[i]
	var need := 0
	if (lead & 0x80) == 0:
		need = 1
	elif (lead & 0xE0) == 0xC0:
		need = 2
	elif (lead & 0xF0) == 0xE0:
		need = 3
	elif (lead & 0xF8) == 0xF0:
		need = 4
	else:
		return size  # byte invalido: tanto vale decodificare tutto
	return size if size - i >= need else i


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
	var raw_title := str(spec.get("title", provider)).to_upper()
	var title := UIStrings.t("term.title_login") % raw_title if _is_login_flow() else raw_title
	titles.add_child(TerminalTheme.label(title, 24, Palette.WHITE, "xbold"))
	var hint := TerminalTheme.label(str(spec.get("hint", "")), 13, Palette.YELLOW)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	titles.add_child(hint)
	_status = TerminalTheme.label(UIStrings.t("term.status_starting"), 13, Palette.YELLOW, "bold")
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
	# Il testo si congela DA QUANDO SI PREME, non da quando la selezione
	# esiste: mentre trascini il mouse la selezione si sta ancora formando, e
	# l'output che arriva nel frattempo la cancellava prima che tu potessi
	# finirla (login Kimi, 25/07 — il primo tentativo di fix guardava
	# get_selected_text(), che durante il trascinamento è ancora vuoto).
	_output.gui_input.connect(_on_output_gui_input)
	_output.text = UIStrings.t("term.preparing")
	col.add_child(_output)

	var url_row := HBoxContainer.new()
	url_row.add_theme_constant_override("separation", 8)
	col.add_child(url_row)
	var url_label := TerminalTheme.label(UIStrings.t("term.url_label"), 12, Palette.MUTED, "medium")
	url_row.add_child(url_label)
	_open_url = Button.new()
	_open_url.text = UIStrings.t("term.open_browser")
	_open_url.disabled = true
	_open_url.pressed.connect(func() -> void:
		if _last_url != "": OS.shell_open(_last_url))
	url_row.add_child(_open_url)
	_copy_url = Button.new()
	_copy_url.text = UIStrings.t("term.copy_link")
	_copy_url.disabled = true
	_copy_url.pressed.connect(func() -> void:
		if _last_url != "": DisplayServer.clipboard_set(_last_url))
	url_row.add_child(_copy_url)
	# Rete di sicurezza indipendente dal riconoscimento del link: qualunque
	# cosa ci sia a schermo — codice di verifica, URL spezzato su due righe,
	# messaggio d'errore da incollare altrove — si porta via in un click.
	# Il rilevamento automatico non può coprire ogni CLI: Kimi stampa il codice
	# dentro l'URL, Claude lo mette su una riga a sé.
	var copy_all := Button.new()
	copy_all.text = UIStrings.t("term.copy_all")
	copy_all.tooltip_text = UIStrings.t("term.copy_all_tip")
	copy_all.pressed.connect(func() -> void:
		DisplayServer.clipboard_set(_screen.text())
		copy_all.text = UIStrings.t("term.copied")
		await get_tree().create_timer(1.5).timeout
		if is_instance_valid(copy_all):
			copy_all.text = UIStrings.t("term.copy_all"))
	url_row.add_child(copy_all)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	url_row.add_child(spacer)
	var paste := Button.new()
	paste.text = UIStrings.t("term.paste")
	paste.pressed.connect(func() -> void:
		_input.text += DisplayServer.clipboard_get()
		_input.grab_focus())
	url_row.add_child(paste)

	var input_row := HBoxContainer.new()
	input_row.add_theme_constant_override("separation", 8)
	col.add_child(input_row)
	_input = LineEdit.new()
	_input.placeholder_text = UIStrings.t("term.input_hint")
	_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_input.text_submitted.connect(_submit_line)
	input_row.add_child(_input)
	# Il comando che apre il login è sempre lo stesso e lo sa il programma:
	# farlo battere all'utente era l'unico punto della schermata che gli
	# chiedeva di sapere qualcosa (Leone, 26/07). Diventa un tasto come INVIO.
	var login_command := str(spec.get("send_command", ""))
	if login_command != "":
		var login_btn := Button.new()
		login_btn.text = login_command.to_upper()
		login_btn.tooltip_text = UIStrings.t("term.login_cmd_tip") % login_command
		login_btn.add_theme_color_override("font_color", Palette.GREEN)
		login_btn.pressed.connect(func() -> void: _send(login_command + "\r"))
		input_row.add_child(login_btn)
	for entry in [["↑", "\u001b[A"], ["↓", "\u001b[B"], ["TAB", "\t"],
			[UIStrings.t("term.key_enter"), "\r"], ["CTRL+C", "\u0003"]]:
		var button := Button.new()
		button.text = str(entry[0])
		button.pressed.connect(_send.bind(str(entry[1])))
		input_row.add_child(button)
	_done = Button.new()
	_done.text = UIStrings.t("term.done_login") if _is_login_flow() \
			else UIStrings.t("term.done_plain")
	_done.add_theme_color_override("font_color",
			Palette.GREEN if _is_login_flow() else Palette.BRIGHT)
	_done.pressed.connect(_complete)
	col.add_child(_done)


func _run_process() -> void:
	var process := OS.execute_with_pipe(str(spec.get("path", "")),
			PackedStringArray(spec.get("args", PackedStringArray())), true)
	if process.is_empty():
		call_deferred("_process_failed", UIStrings.t("term.err_start"))
		return
	_mutex.lock()
	_stdio = process["stdio"]
	_stderr = process["stderr"]
	_pid = int(process["pid"])
	_mutex.unlock()
	if bool(spec.get("reports_exit", false)):
		# stdout è un canale di controllo separato: un reader indipendente evita
		# che l'EOF di stderr tronchi un report più lungo dell'output ospitato.
		_report_thread = Thread.new()
		_report_thread.start(_run_report_reader)
	call_deferred("_process_started")
	# FileAccess sui pipe non espone i byte disponibili. Una lettura per byte
	# consegna immediatamente anche prompt corti in attesa di input; la UI li
	# aggrega una volta per frame evitando migliaia di redraw.
	while not _closing and is_instance_valid(_stderr) and not _stderr.eof_reached():
		var one := _stderr.get_buffer(1)
		if not one.is_empty() and not (_stderr.eof_reached() and one[0] == 0):
			call_deferred("_queue_byte", one[0])
		else:
			OS.delay_msec(2)
	# EOF è già la conferma affidabile che il pipe figlio è terminato. Chiamare
	# is_process_running/get_process_exit_code dopo che Godot lo ha raccolto
	# genera un falso errore "PID is not a child" su macOS.
	_mutex.lock()
	_process_exited = true
	_mutex.unlock()
	if not bool(spec.get("reports_exit", false)):
		call_deferred("_process_finished", -1 if _closing else 0)


func _run_report_reader() -> void:
	# `stdio` è duplex: il main thread continua a scrivere lo stdin, mentre
	# questo reader consuma soltanto stdout. Il comando ospitato non eredita il
	# canale (fd3 chiuso su POSIX, gruppo rediretto su Windows), quindi il primo
	# marker completo è necessariamente il report finale del wrapper.
	var report := PackedByteArray()
	var expected_token := str(spec.get("exit_report_token", ""))
	while not _closing and is_instance_valid(_stdio) and not _stdio.eof_reached():
		var one := _stdio.get_buffer(1)
		if one.is_empty() or (_stdio.eof_reached() and one[0] == 0):
			OS.delay_msec(2)
			continue
		report.append(one[0])
		var code := _exit_code_from_raw(report.get_string_from_utf8(), expected_token)
		if code >= 0:
			call_deferred("_report_finished", report, code)
			return
	if not _closing:
		call_deferred("_report_finished", report, -1)


func _process_started() -> void:
	_status.text = UIStrings.t("term.status_interactive")
	_status.add_theme_color_override("font_color", Palette.GREEN)
	_input.grab_focus()


func _queue_byte(byte: int) -> void:
	if _closing:
		return
	_mutex.lock()
	_pending_bytes.append(byte)
	_mutex.unlock()


func _report_finished(report: PackedByteArray, code: int) -> void:
	if _closing or _finished:
		return
	_mutex.lock()
	_report_bytes.append_array(report)
	_mutex.unlock()
	_process_finished(code)


func _process_failed(message: String) -> void:
	_finished = true
	_status.text = UIStrings.t("term.status_error")
	_status.add_theme_color_override("font_color", Palette.RED)
	_output.text = message
	if not _is_login_flow():
		_done.text = UIStrings.t("term.close_retry")
		_done.add_theme_color_override("font_color", Palette.YELLOW)
		_result_note = UIStrings.t("term.runtime_install_failed") \
				if provider == "runtime-install" \
				else UIStrings.t("term.command_failed")
		_output.text += "\n\n" + _result_note


func _process_finished(code: int) -> void:
	if _finished:
		return
	if bool(spec.get("reports_exit", false)):
		# Il marker OSC è invisibile a TermScreen ma resta nei byte grezzi. Se
		# manca, il protocollo stesso è fallito: non promuoviamo mai un esito
		# sconosciuto a successo.
		code = _captured_exit_code()
	_finished = true
	if code == 0:
		_status.text = UIStrings.t("term.status_login_done") if _is_login_flow() \
				else UIStrings.t("term.status_cmd_done")
		_status.add_theme_color_override("font_color", Palette.GREEN)
		if not _is_login_flow():
			_done.text = UIStrings.t("term.done_success")
			_done.add_theme_color_override("font_color", Palette.GREEN)
	else:
		_status.text = UIStrings.t("term.status_cmd_failed") % code
		_status.add_theme_color_override("font_color", Palette.RED)
		if not _is_login_flow():
			_done.text = UIStrings.t("term.close_retry")
			_done.add_theme_color_override("font_color", Palette.YELLOW)
			_result_note = UIStrings.t("term.runtime_install_failed") \
					if provider == "runtime-install" \
					else UIStrings.t("term.command_failed")
			_output.text += "\n\n" + _result_note
	_refresh_setup()


## Il token casuale lega il report a questa singola console: output ospitato che
## contiene un OSC JHTExit proprio non può finalizzare prematuramente il comando.
## Fra più report validi dello stesso wrapper vince comunque l'ultimo.
static func _exit_code_from_raw(raw: String, expected_token: String) -> int:
	if expected_token == "":
		return -1
	var regex := RegEx.new()
	if regex.compile(EXIT_REPORT_PATTERN) != OK:
		return -1
	var matches := regex.search_all(raw)
	var result := -1
	for found in matches:
		if found.get_string(1) == expected_token:
			result = int(found.get_string(2))
	return result


func _captured_exit_code() -> int:
	_mutex.lock()
	var all_bytes := _report_bytes.duplicate()
	_mutex.unlock()
	return _exit_code_from_raw(all_bytes.get_string_from_utf8(),
			str(spec.get("exit_report_token", "")))


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


## Il CLI scrive le credenziali qualche secondo DOPO aver detto "Login
## successful" a video: sul ThinkPad il file è comparso 8 secondi dopo che
## l'utente era tornato nel gioco (25/07). Un solo refresh al click arrivava
## prima del file, non trovava nulla e non diceva niente — il verde compariva
## da solo mezzo minuto più tardi e il click sembrava ignorato. Ora il pulsante
## risponde subito e continua a controllare finché la prova non c'è.
const AUTH_WAIT_MS := 30000
const AUTH_POLL_S := 0.7

func _complete() -> void:
	if not _is_login_flow():
		_refresh_setup()
		close()
		return
	_done.disabled = true
	_done.text = UIStrings.t("term.verifying")
	var deadline := Time.get_ticks_msec() + AUTH_WAIT_MS
	while Time.get_ticks_msec() < deadline:
		_refresh_setup()
		await get_tree().create_timer(AUTH_POLL_S).timeout
		if _closing or not is_instance_valid(_done):
			return  # l'auto-chiusura su credenziali trovate ci ha preceduti
	# Scaduto il tempo: il login non ha lasciato traccia. Meglio dirlo che
	# chiudere in silenzio facendo credere all'utente di aver finito.
	if not is_instance_valid(_done):
		return
	_status.text = UIStrings.t("term.status_not_detected")
	_status.add_theme_color_override("font_color", Palette.YELLOW)
	_done.disabled = false
	_done.text = UIStrings.t("term.done_login")
	var note := "\n\n" + UIStrings.t("term.auth_not_found")
	_output.text += note


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
		_status.text = UIStrings.t("term.status_detected")
		_status.add_theme_color_override("font_color", Palette.GREEN)
		_done.text = UIStrings.t("term.login_complete")
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
	if _pid > 0 and not _process_exited:
		OS.kill(_pid)
	_mutex.unlock()
	closed.emit()
	queue_free()


func _exit_tree() -> void:
	_closing = true
	# Anche chi smonta la console con queue_free (es. una console che ne
	# sostituisce un'altra) non deve lasciare orfano il processo figlio:
	# il 22/07 un compose doppio è sopravvissuto proprio così.
	_mutex.lock()
	if _pid > 0 and not _process_exited:
		OS.kill(_pid)
	_mutex.unlock()
	if _thread != null and _thread.is_started():
		_thread.wait_to_finish()
	if _report_thread != null and _report_thread.is_started():
		_report_thread.wait_to_finish()


## Ultimo URL nel flusso, ricomposto quando il wrap della pty (o il box del
## TUI) lo spezza su più righe: il "COPIA LINK" monco mandava l'utente su un
## link OAuth invalido (test Leone 23/07). Una riga che finisce in mezzo
## all'URL continua nelle righe successive fatte SOLO di caratteri da URL.
func _detect_url(lines: PackedStringArray) -> void:
	var regex := RegEx.new()
	if regex.compile("https?://[^\\s<>()\\[\\]{}]+") != OK:
		return
	var frag := RegEx.new()
	if frag.compile("^[A-Za-z0-9%&=_.:/?#+~\\-]+$") != OK:
		return
	var best := ""
	for i in lines.size():
		var line := lines[i].strip_edges()
		var matches := regex.search_all(line)
		if matches.is_empty():
			continue
		var m: RegExMatch = matches[-1]
		var candidate := m.get_string()
		if m.get_end() == line.length():
			var j := i + 1
			while j < lines.size():
				var cont := lines[j].strip_edges()
				if cont == "" or frag.search(cont) == null:
					break
				candidate += cont
				j += 1
		best = candidate
	if best == "":
		return
	best = best.trim_suffix(".").trim_suffix(",")
	if best == _last_url:
		return
	_last_url = best
	_open_url.disabled = false
	_copy_url.disabled = false


## Compat per i selftest e i flussi one-shot: testo leggibile da un dump
## grezzo, passando dal modello di schermo.
static func _terminal_text(raw: String) -> String:
	var screen := TermScreen.new()
	screen.feed(raw)
	return screen.text()

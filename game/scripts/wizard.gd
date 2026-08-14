extends Control
## Wizard onboarding — la "foto badge" del GDD §5, ma REALE: il primo
## avvio è una conversazione con l'Assistente (lo stesso agente del
## container, via BackendBus) che compila il candidate_profile.yml.
## Il gioco è un thin-client come la vecchia pagina web /onboarding:
## osserva il profilo (profile_status_updated) e parla in chat; a
## scrivere il badge ci pensa l'agente. Gate d'uscita = `ready` del
## backend (ready.flag oppure checklist required completa), identico
## al gate della dashboard web.
##
## Senza VPS configurata si monta il MockBackend: onboarding recitato
## ma con lo stesso identico contratto (utile per demo e test in 3').

const PROFILE_W := 380.0
const ATTACH_MARK := "[FILE ALLEGATI]"

## Campi required, nell'ordine del badge (stessa checklist del web).
const FIELDS := ["name", "email", "target_role", "location",
		"experience_years", "seniority_target", "skills", "languages"]

var _status: Label
var _badge: Label
var _profile_box: VBoxContainer
var _review_box: VBoxContainer
var _review_status: Label
var _review_btn: Button
var _active_review_id := ""
var _progress: Label
var _list: VBoxContainer
var _scroll: ScrollContainer
var _input: LineEdit
var _send_btn: Button
var _upload_btn: Button
var _waiting_label: Label
var _waiting := false
var _wait_t := 0.0
var _enter_btn: Button
var _enter_hint: Label
var _portrait: PortraitView
var _file_dialog: FileDialog
var _ready_flag := false
var _leaving := false

func _ready() -> void:
	Log.info("scene", "wizard pronto")  # traccia il passo 03 del setup (25/07)
	theme = TerminalTheme.get_theme()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_build_ui()

	# Il mock esiste soltanto per test/demo espliciti: su una nuova installazione
	# non dobbiamo fingere un profilo pronto mentre il container è ancora spento.
	if BackendBus.state == BackendBus.DISCONNECTED and (\
			OS.get_environment("JHT_WIZARD_TEST") == "1" \
			or OS.get_environment("JHT_MOCK_SETUP") == "1"):
		BackendBus.set_backend(MockBackend.new())

	BackendBus.connection_changed.connect(_on_connection)
	BackendBus.agents_updated.connect(_on_agents)
	BackendBus.agent_chat_updated.connect(_on_chat)
	BackendBus.chat_waiting_changed.connect(_on_waiting)
	BackendBus.profile_status_updated.connect(_on_profile)
	BackendBus.profile_review_confirmed.connect(_on_profile_review_confirmed)
	BackendBus.document_uploaded.connect(_on_uploaded)
	BackendBus.user_chat_sent.connect(_on_chat_sent)

	BackendBus.ensure_assistant()
	BackendBus.open_profile_watch()
	BackendBus.open_agent_chat("assistente")

	_on_connection(BackendBus.state, BackendBus.state_detail)
	if not BackendBus.agents.is_empty():
		_on_agents(BackendBus.agents)
	if not BackendBus.profile_status.is_empty():
		var st: Dictionary = BackendBus.profile_status
		_on_profile(st.get("profile", {}), st.get("required", {}),
				bool(st.get("ready", false)))
	else:
		_redraw_profile({}, {})

	# TEST-AUTO: JHT_WIZARD_TEST=1 recita l'onboarding intero sul mock
	# (2 messaggi + upload CV → ready) e stampa WIZARD-TEST PASS/FAIL.
	if OS.get_environment("JHT_WIZARD_TEST") == "1":
		_selftest.call_deferred()
	# TEST-AUTO: JHT_SHOT=path.png → screenshot e chiude (come office.gd);
	# il default aspetta il welcome del mock, JHT_SHOT_DELAY lo cambia.
	var shot := OS.get_environment("JHT_SHOT")
	if shot != "":
		_take_shot(shot)

func _exit_tree() -> void:
	BackendBus.close_profile_watch()
	BackendBus.close_agent_chat()

func _process(delta: float) -> void:
	if not _waiting or _waiting_label == null:
		return
	_wait_t += delta
	_waiting_label.text = UIStrings.t("chat.waiting") \
			+ "…".repeat(1 + int(_wait_t * 2.0) % 3)

## ── Costruzione UI ───────────────────────────────────────────────────

func _build_ui() -> void:
	var bg := GridBackground.new()
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 28)
	add_child(margin)
	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 14)
	margin.add_child(root)

	# header: titolo + sottotitolo + stato connessione a destra
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 16)
	root.add_child(head)
	var head_col := VBoxContainer.new()
	head_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head_col.add_theme_constant_override("separation", 2)
	head.add_child(head_col)
	head_col.add_child(TerminalTheme.label(
			UIStrings.t("wizard.title"), 34, Palette.WHITE, "xbold"))
	var sub := TerminalTheme.label(UIStrings.t("wizard.subtitle"), 15, Palette.MUTED)
	sub.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	head_col.add_child(sub)
	var head_right := VBoxContainer.new()
	head_right.add_theme_constant_override("separation", 2)
	head.add_child(head_right)
	_badge = TerminalTheme.label("", 13, Palette.YELLOW, "bold")
	_badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	head_right.add_child(_badge)
	_status = TerminalTheme.label("", 13, Palette.DIM)
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	head_right.add_child(_status)

	# corpo: ritratto | badge profilo | chat
	var body := HBoxContainer.new()
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 24)
	root.add_child(body)

	var stage := CenterContainer.new()
	stage.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(stage)
	var stage_col := VBoxContainer.new()
	stage_col.add_theme_constant_override("separation", 12)
	stage.add_child(stage_col)
	_portrait = PortraitView.new()
	stage_col.add_child(_portrait)
	_portrait.setup(ChatPanel._portrait_slug("assistente"))
	_portrait.set_state("a", "neutro")
	_portrait.enter_anim()
	var plate_row := CenterContainer.new()
	stage_col.add_child(plate_row)
	var plate := BracketPanel.new()
	plate_row.add_child(plate)
	var plate_pad := MarginContainer.new()
	for side in ["left", "right"]:
		plate_pad.add_theme_constant_override("margin_" + side, 14)
	for side in ["top", "bottom"]:
		plate_pad.add_theme_constant_override("margin_" + side, 6)
	plate.add_child(plate_pad)
	plate_pad.add_child(TerminalTheme.label(
			UIStrings.t("wizard.assistant"), 20, Palette.GREEN, "bold"))

	_build_profile_panel(body)
	_build_chat_panel(body)

	# fondo: hint + bottone d'ingresso
	var foot := HBoxContainer.new()
	foot.add_theme_constant_override("separation", 16)
	root.add_child(foot)
	_enter_hint = TerminalTheme.label(
			UIStrings.t("wizard.waiting_profile"), 14, Palette.DIM)
	_enter_hint.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_enter_hint.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	foot.add_child(_enter_hint)
	_enter_btn = Button.new()
	_enter_btn.text = UIStrings.t("wizard.back_office")
	_enter_btn.disabled = false
	_enter_btn.add_theme_font_size_override("font_size", 18)
	_enter_btn.add_theme_color_override("font_color", Palette.GREEN)
	_enter_btn.pressed.connect(_enter_office)
	foot.add_child(_enter_btn)

func _build_profile_panel(body: HBoxContainer) -> void:
	var panel := BracketPanel.new()
	panel.custom_minimum_size = Vector2(PROFILE_W, 0)
	panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(panel)
	var pad := MarginContainer.new()
	pad.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 18)
	panel.add_child(pad)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 8)
	pad.add_child(col)
	var head := HBoxContainer.new()
	col.add_child(head)
	var title := TerminalTheme.label(
			UIStrings.t("wizard.profile"), 17, Palette.WHITE, "bold")
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	_progress = TerminalTheme.label("", 13, Palette.MUTED)
	head.add_child(_progress)
	col.add_child(HSeparator.new())
	var scroll := ScrollContainer.new()
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	col.add_child(scroll)
	_profile_box = VBoxContainer.new()
	_profile_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_profile_box.add_theme_constant_override("separation", 6)
	scroll.add_child(_profile_box)
	col.add_child(HSeparator.new())
	_review_box = VBoxContainer.new()
	_review_box.add_theme_constant_override("separation", 6)
	_review_box.visible = false
	col.add_child(_review_box)

func _build_chat_panel(body: HBoxContainer) -> void:
	var panel := BracketPanel.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(panel)
	var pad := MarginContainer.new()
	pad.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 18)
	panel.add_child(pad)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	pad.add_child(col)

	_scroll = ScrollContainer.new()
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	col.add_child(_scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 8)
	_scroll.add_child(_list)
	_redraw_chat([])

	_waiting_label = TerminalTheme.label("", 14, Palette.YELLOW)
	_waiting_label.visible = false
	col.add_child(_waiting_label)

	var send_row := HBoxContainer.new()
	send_row.add_theme_constant_override("separation", 10)
	col.add_child(send_row)
	_upload_btn = Button.new()
	_upload_btn.text = UIStrings.t("wizard.upload")
	_upload_btn.add_theme_color_override("font_color", Palette.BLUE)
	_upload_btn.pressed.connect(_browse_cv)
	send_row.add_child(_upload_btn)
	_input = LineEdit.new()
	_input.placeholder_text = UIStrings.t("chat.placeholder")
	_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_input.text_submitted.connect(func(_t: String) -> void: _send())
	send_row.add_child(_input)
	_send_btn = Button.new()
	_send_btn.text = UIStrings.t("chat.send")
	_send_btn.add_theme_color_override("font_color", Palette.GREEN)
	_send_btn.pressed.connect(_send)
	send_row.add_child(_send_btn)
	_input.grab_focus.call_deferred()

## ── Badge profilo (pannello sinistro) ────────────────────────────────

func _redraw_profile(profile: Dictionary, required: Dictionary) -> void:
	for child in _profile_box.get_children():
		child.queue_free()
	var done := 0
	for field in FIELDS:
		var ok := bool(required.get(field, false))
		if ok:
			done += 1
		var row := VBoxContainer.new()
		row.add_theme_constant_override("separation", 0)
		var label := TerminalTheme.label(
				("✓ " if ok else "○ ") + UIStrings.t("wizard.f." + field), 13,
				Palette.GREEN if ok else Palette.MUTED, "medium")
		row.add_child(label)
		var value := _field_value(profile, field)
		if value != "":
			var vl := TerminalTheme.label("   " + value, 14,
					Palette.BRIGHT if ok else Palette.BASE)
			vl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			row.add_child(vl)
		_profile_box.add_child(row)
	_progress.text = UIStrings.t("wizard.progress") % [done, FIELDS.size()]

static func _field_value(profile: Dictionary, field: String) -> String:
	var v: Variant = profile.get(field)
	if v == null:
		return ""
	if v is Array:
		var parts: Array = []
		for x in v:
			parts.append(str(x))
		return ", ".join(PackedStringArray(parts))
	return str(v)

## La revisione del CV è deliberatamente separata dal badge: i valori qui
## sono una proposta locale, mentre il badge sopra continua a rappresentare
## esclusivamente candidate_profile.yml. Solo la ricevuta opaca del poll può
## abilitare il salvataggio; review malformate o stantie restano fail-closed.
func _redraw_review(review: Dictionary, error: String) -> void:
	for child in _review_box.get_children():
		child.queue_free()
	_active_review_id = ""
	_review_btn = null
	_review_status = null
	if review.is_empty() and error == "":
		_review_box.visible = false
		return
	_review_box.visible = true
	_review_box.add_child(TerminalTheme.label(
			UIStrings.t("wizard.review_title"), 14, Palette.YELLOW, "bold"))
	if error != "":
		_review_box.add_child(_review_note("wizard.review_unavailable", Palette.RED))
		return
	var review_id := str(review.get("review_id", ""))
	var id_re := RegEx.create_from_string("^[0-9a-f]{64}$")
	var changes: Variant = review.get("changes", [])
	if id_re.search(review_id) == null or not changes is Array or changes.is_empty():
		_review_box.add_child(_review_note("wizard.review_unavailable", Palette.RED))
		return
	# Non basta che l'array esista: se anche una riga non è visualizzabile,
	# l'utente non sta confermando lo stesso insieme che il backend salverebbe.
	# La revisione intera diventa quindi non confermabile, senza saltare righe.
	for item in changes:
		if not item is Dictionary:
			_review_box.add_child(_review_note("wizard.review_unavailable", Palette.RED))
			return
		var item_field := str(item.get("field", ""))
		var item_profile := {}
		item_profile[item_field] = item.get("value")
		if not FIELDS.has(item_field) or _field_value(item_profile, item_field) == "":
			_review_box.add_child(_review_note("wizard.review_unavailable", Palette.RED))
			return
	_review_box.add_child(_review_note("wizard.review_body", Palette.MUTED))
	for item in changes:
		var field := str(item.get("field", ""))
		var item_profile := {}
		item_profile[field] = item.get("value")
		var value := _field_value(item_profile, field)
		var line := TerminalTheme.label(
				"%s: %s" % [UIStrings.t("wizard.f." + field), value],
				12, Palette.BRIGHT, "medium")
		line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_review_box.add_child(line)
	var missing: Variant = review.get("missing", [])
	if missing is Array and not missing.is_empty():
		var labels := PackedStringArray()
		for field in missing:
			if FIELDS.has(str(field)):
				labels.append(UIStrings.t("wizard.f." + str(field)))
		if not labels.is_empty():
			_review_box.add_child(_review_note_text(
					UIStrings.t("wizard.review_missing") % ", ".join(labels),
					Palette.MUTED))
	_review_status = TerminalTheme.label("", 12, Palette.DIM)
	_review_box.add_child(_review_status)
	if bool(review.get("stale", true)):
		_review_status.text = UIStrings.t("wizard.review_stale")
		_review_status.add_theme_color_override("font_color", Palette.RED)
		return
	_active_review_id = review_id
	_review_btn = Button.new()
	_review_btn.text = UIStrings.t("wizard.review_confirm")
	_review_btn.add_theme_color_override("font_color", Palette.GREEN)
	_review_btn.pressed.connect(_confirm_profile_review)
	_review_box.add_child(_review_btn)

func _review_note(key: String, color: Color) -> Label:
	return _review_note_text(UIStrings.t(key), color)

func _review_note_text(text: String, color: Color) -> Label:
	var note := TerminalTheme.label(text, 12, color)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	return note

func _confirm_profile_review() -> void:
	if _active_review_id == "" or not is_instance_valid(_review_btn):
		return
	_review_btn.disabled = true
	_review_status.text = UIStrings.t("wizard.review_saving")
	_review_status.add_theme_color_override("font_color", Palette.DIM)
	BackendBus.confirm_profile_review(_active_review_id)

func _on_profile_review_confirmed(review_id: String, ok: bool, _error: String) -> void:
	if review_id != _active_review_id or not is_instance_valid(_review_status):
		return
	_review_status.text = UIStrings.t("wizard.review_saved") if ok \
			else UIStrings.t("wizard.review_save_failed")
	_review_status.add_theme_color_override("font_color",
			Palette.GREEN if ok else Palette.RED)
	if not ok and is_instance_valid(_review_btn):
		_review_btn.disabled = false

## ── Chat con l'assistente ────────────────────────────────────────────

func _on_chat(_agent: String, messages: Array) -> void:
	_redraw_chat(messages)
	if _portrait and not messages.is_empty() \
			and str(messages[-1].get("role", "")) != "user":
		_portrait.set_state("a", "caldo")

func _on_waiting(agent: String, waiting: bool) -> void:
	if not agent.begins_with("assistente"):
		return
	_waiting = waiting
	_wait_t = 0.0
	if _waiting_label:
		_waiting_label.visible = waiting
	if _portrait and waiting:
		_portrait.set_state("a", "pensieroso")

## Consegna del messaggio fallita (es. jht-tmux-send exit 3/4: TUI non
## ricettiva o occupata). Senza questo l'errore era MUTO e sembrava che
## l'agente non rispondesse (debug onboarding Codex, Leone 24/07): lo si
## mostra in chat e si spegne l'attesa, così l'utente sa che deve riprovare.
func _on_chat_sent(agent: String, ok: bool, error: String) -> void:
	if ok or not agent.begins_with("assistente"):
		return
	_waiting = false
	if _waiting_label:
		_waiting_label.visible = false
	if _portrait:
		_portrait.set_state("a", "neutro")
	_append_line("⚠ " + error, Palette.RED)

func _redraw_chat(messages: Array) -> void:
	for child in _list.get_children():
		child.queue_free()
	if messages.is_empty():
		var note := TerminalTheme.label(UIStrings.t("wizard.chat_empty"), 14, Palette.DIM)
		note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_list.add_child(note)
		return
	for msg in messages:
		_append(msg)
	_scroll_to_bottom.call_deferred()

func _append(msg: Dictionary) -> void:
	var mine := str(msg.get("role", "")) == "user"
	var partial: bool = msg.get("partial", false) or not msg.get("done", true)
	var row := VBoxContainer.new()
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_theme_constant_override("separation", 1)
	var who := TerminalTheme.label(
			UIStrings.t("chat.you") if mine else UIStrings.t("wizard.assistant"),
			12, Palette.GREEN if mine else Palette.MUTED, "medium")
	who.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT if mine \
			else HORIZONTAL_ALIGNMENT_LEFT
	row.add_child(who)
	var color: Color = Palette.BRIGHT if mine else Palette.BASE
	if partial:
		color = Palette.DIM
	# Stesso trattamento della chat in ufficio: markdown reso, a capo veri.
	row.add_child(TerminalTheme.markdown_label(str(msg.get("text", "")), 15, color,
			HORIZONTAL_ALIGNMENT_RIGHT if mine else HORIZONTAL_ALIGNMENT_LEFT))
	_list.add_child(row)

func _append_line(text: String, color: Color) -> void:
	var line := TerminalTheme.label(text, 14, color)
	line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_list.add_child(line)
	_scroll_to_bottom.call_deferred()

func _scroll_to_bottom() -> void:
	await get_tree().process_frame
	_scroll.scroll_vertical = int(_scroll.get_v_scroll_bar().max_value)

func _send() -> void:
	var text := _input.text.strip_edges()
	if text.is_empty():
		return
	_input.clear()
	BackendBus.send_user_chat("assistente", text)
	Sfx.play_tick()

## ── Upload CV (FileDialog nativo, come _browse_vps_key) ──────────────

func _browse_cv() -> void:
	if _file_dialog == null:
		_file_dialog = FileDialog.new()
		_file_dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
		_file_dialog.access = FileDialog.ACCESS_FILESYSTEM
		_file_dialog.use_native_dialog = true
		_file_dialog.filters = PackedStringArray([UIStrings.t("wizard.file_filter")])
		_file_dialog.file_selected.connect(_on_cv_selected)
		add_child(_file_dialog)
	_file_dialog.popup_centered()

func _on_cv_selected(path: String) -> void:
	_upload_btn.disabled = true
	_append_line(UIStrings.t("wizard.uploading") % path.get_file(), Palette.DIM)
	BackendBus.upload_user_document(path)

## Upload finito: il path REMOTO viaggia verso l'assistente dentro il
## messaggio chat sotto il marker [FILE ALLEGATI], identico al web —
## l'agente lo legge, ne estrae il profilo e archivia in sources/.
func _on_uploaded(ok: bool, remote_path: String, error: String) -> void:
	_upload_btn.disabled = false
	if not ok:
		_append_line("⚠ " + UIStrings.t("wizard.upload_fail") % error, Palette.RED)
		return
	BackendBus.send_user_chat("assistente",
			UIStrings.t("wizard.attach_msg") + "\n\n" + ATTACH_MARK
			+ "\n" + remote_path)
	Sfx.play_confirm()

## ── Stato connessione / roster ───────────────────────────────────────

func _on_connection(state: int, detail: String) -> void:
	match state:
		BackendBus.CONNECTING:
			_status.text = UIStrings.t("wizard.connecting")
		BackendBus.ERROR:
			_status.text = "⚠ " + detail
		BackendBus.CONNECTED:
			_refresh_status()
		_:
			_status.text = UIStrings.t("wizard.setup_required")
			_input.editable = false
			_send_btn.disabled = true
			_upload_btn.disabled = true
	_badge.text = "" if BackendBus.is_live() else UIStrings.t("wizard.sim_badge")

func _on_agents(_agents: Array) -> void:
	# Il roster risolve lo slug nell'uid vero (mock: assistente-1): la
	# chat va riaperta sull'uid risolto, o il backend pubblica per un
	# agente diverso da quello che ascoltiamo.
	if BackendBus.can_chat_with("assistente"):
		BackendBus.open_agent_chat("assistente")
	_refresh_status()

## Con la connessione su ma l'assistente non ancora in sessione (boot
## ~60s dopo ensure_assistant) lo si dice, invece di far scrivere nel
## vuoto — e l'input resta spento finché non può arrivare a destinazione.
func _refresh_status() -> void:
	var reachable := BackendBus.can_chat_with("assistente")
	_input.editable = reachable
	_send_btn.disabled = not reachable
	_upload_btn.disabled = not reachable
	if BackendBus.state != BackendBus.CONNECTED:
		return
	_status.text = "" if reachable else UIStrings.t("wizard.booting_assistant")
	_badge.text = "" if BackendBus.is_live() else UIStrings.t("wizard.sim_badge")

## ── Profilo pronto → ufficio ─────────────────────────────────────────

func _on_profile(profile: Dictionary, required: Dictionary, ready: bool) -> void:
	_ready_flag = ready
	_redraw_profile(profile, required)
	var review: Variant = BackendBus.profile_status.get("review", {})
	_redraw_review(review if review is Dictionary else {},
			str(BackendBus.profile_status.get("review_error", "")))
	_enter_btn.disabled = false
	_enter_btn.text = UIStrings.t("wizard.profile_done_back") if ready \
			else UIStrings.t("wizard.back_office")
	_enter_hint.text = UIStrings.t("wizard.ready_note" if ready
			else "wizard.waiting_profile")
	if ready:
		_enter_hint.add_theme_color_override("font_color", Palette.GREEN)
		if _portrait:
			_portrait.set_state("a", "caldo")

func _take_shot(path: String) -> void:
	var delay := 3.0
	var delay_env := OS.get_environment("JHT_SHOT_DELAY")
	if delay_env != "":
		delay = maxf(0.5, float(delay_env))
	await get_tree().create_timer(delay).timeout
	var img := get_viewport().get_texture().get_image()
	img.save_png(path)
	Log.info("test", "JHT_SHOT salvato: " + path)
	get_tree().quit()

## Flusso completo sul MockBackend, senza rete: la conversazione avanza
## il profilo finto (1 passo a messaggio, 2 con l'upload) fino a ready.
func _selftest() -> void:
	await get_tree().create_timer(2.0).timeout  # boot mock + welcome
	BackendBus.send_user_chat("assistente", "Cerco un ruolo da PM a Firenze")
	await get_tree().create_timer(4.5).timeout  # eco + risposta mock
	BackendBus.send_user_chat("assistente",
			"5 anni di esperienza, parlo italiano e inglese")
	await get_tree().create_timer(4.5).timeout
	# upload con un file VERO temporaneo: si esercita anche il giro
	# document_uploaded → messaggio [FILE ALLEGATI] all'assistente
	var tmp := OS.get_cache_dir().path_join("jht-wizard-test-cv.pdf")
	var f := FileAccess.open(tmp, FileAccess.WRITE)
	f.store_string("cv di prova")
	f.close()
	_on_cv_selected(tmp)
	await get_tree().create_timer(5.5).timeout
	var staged_before_save := _active_review_id != "" and not _ready_flag
	var review_id := _active_review_id
	BackendBus.confirm_profile_review(review_id)
	await get_tree().create_timer(0.5).timeout
	DirAccess.remove_absolute(tmp)
	var ok := _ready_flag and not _enter_btn.disabled \
			and _list.get_child_count() >= 5 and staged_before_save \
			and _active_review_id == ""
	print("WIZARD-TEST ", "PASS " if ok else "FAIL ",
			JSON.stringify({"ready": _ready_flag,
					"enter_enabled": not _enter_btn.disabled,
					"chat_rows": _list.get_child_count(),
					"staged_before_save": staged_before_save,
					"review_cleared": _active_review_id == ""}))
	get_tree().quit()

func _enter_office() -> void:
	if _leaving:
		return
	_leaving = true
	if _ready_flag:
		Game.mark_onboarding_done()
	Sfx.play_confirm()
	var veil := ColorRect.new()
	veil.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.0)
	veil.set_anchors_preset(Control.PRESET_FULL_RECT)
	veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(veil)
	var tw := create_tween()
	tw.tween_property(veil, "color:a", 1.0, 0.4)
	tw.tween_callback(Game.goto_office)

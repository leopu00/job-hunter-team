class_name ChatPanel
extends CanvasLayer
## Conversazione BIDIREZIONALE con un agente del team (missione 19:0x):
## dal click sull'agente si apre questo pannello, l'utente scrive e il
## messaggio parte sul canale REALE del team ([CHAT] via tmux sulla VPS,
## contratto BackendBus validato col Capitano vero). La conversazione
## arriva su agent_chat_updated come storia completa: si ridisegna da
## zero, i messaggi partial sono checkpoint "sta lavorando".

signal closed

const PANEL_W := 560.0

var _slug := ""           # uid di gioco (es. "coordinatore", "scout-2")
var _display_name := ""
var _list: VBoxContainer
var _scroll: ScrollContainer
var _input: LineEdit
var _send_btn: Button
var _choices: VBoxContainer
var _empty_note: Label
var _waiting_label: Label
var _waiting := false
var _wait_t := 0.0
var _fullscreen := false
var _panel: BracketPanel
var _stage: CenterContainer   # palco del ritratto, solo schermo intero
var _portrait: PortraitView
var _expand_btn: Button
var _roster: Array = []       # [{slug, name}] per lo switcher fullscreen
var _roster_col: ScrollContainer
var _roster_buttons := {}     # slug → Button
var _title: Label
var _warn: Label
var _plate_label: Label
var _backend_messages: Array = []
var _live_choices: Array = []
var _setup_signature := ""
var _closing := false

func _process(delta: float) -> void:
	if not _waiting or _waiting_label == null:
		return
	_wait_t += delta
	_waiting_label.text = UIStrings.t("chat.waiting") \
			+ "…".repeat(1 + int(_wait_t * 2.0) % 3)

func _init(slug: String, display_name: String, roster: Array = []) -> void:
	_slug = slug
	_display_name = display_name
	_roster = roster
	layer = 40
	add_to_group("camera_blocking_overlay")

func _ready() -> void:
	BackendBus.mark_chat_read(_slug)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = TerminalTheme.get_theme()
	add_child(root)
	var dim := ColorRect.new()
	dim.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.6)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed \
				and event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT]:
			close())
	root.add_child(dim)

	# colonna conversazione a destra, stile terminale
	_panel = BracketPanel.new()
	_panel.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	_panel.custom_minimum_size = Vector2(PANEL_W, 0)
	_panel.offset_left = -PANEL_W - 24
	_panel.offset_right = -24
	_panel.offset_top = 24
	_panel.offset_bottom = -24
	root.add_child(_panel)
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 20)
	_panel.add_child(margin)
	# affiancamento: palco ritratto (visibile solo a schermo intero,
	# metà sinistra) + colonna chat; in laterale la chat riempie tutto
	var split := HBoxContainer.new()
	split.add_theme_constant_override("separation", 24)
	margin.add_child(split)
	_build_roster(split)
	_stage = CenterContainer.new()
	_stage.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_stage.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_stage.visible = false
	split.add_child(_stage)
	var box := VBoxContainer.new()
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	box.add_theme_constant_override("separation", 10)
	split.add_child(box)

	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 10)
	box.add_child(head)
	_title = TerminalTheme.label(
			UIStrings.t("chat.title") % _display_name.to_upper(), 20, Palette.WHITE, "xbold")
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_title)
	_expand_btn = Button.new()
	_expand_btn.text = UIStrings.t("chat.expand")
	_expand_btn.add_theme_font_size_override("font_size", 13)
	_expand_btn.add_theme_color_override("font_color", Palette.MUTED)
	_expand_btn.pressed.connect(func() -> void: _set_fullscreen(not _fullscreen))
	head.add_child(_expand_btn)
	var close_btn := Button.new()
	close_btn.text = "✕"
	close_btn.tooltip_text = "Chiudi [Esc]"
	close_btn.add_theme_color_override("font_color", Palette.MUTED)
	close_btn.pressed.connect(close)
	head.add_child(close_btn)
	# avviso best-effort: solo alcuni agenti hanno la skill di risposta
	# in chat (bus.chat_replies); gli altri leggono ma possono tacere.
	# Sempre creato: lo switcher fullscreen lo accende/spegne per agente.
	_warn = TerminalTheme.label(UIStrings.t("chat.besteffort"), 13, Palette.YELLOW)
	_warn.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_warn.visible = not BackendBus.chat_replies(_slug)
	box.add_child(_warn)
	box.add_child(HSeparator.new())

	_scroll = ScrollContainer.new()
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	box.add_child(_scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 8)
	_scroll.add_child(_list)

	# indicatore "in attesa della risposta…" (bus.chat_waiting): puntini
	# animati finché l'agente non risponde — feedback test finale (2)
	_waiting_label = TerminalTheme.label("", 14, Palette.YELLOW)
	_waiting_label.visible = false
	box.add_child(_waiting_label)
	_choices = VBoxContainer.new()
	_choices.add_theme_constant_override("separation", 6)
	box.add_child(_choices)

	# input + invio
	var send_row := HBoxContainer.new()
	send_row.add_theme_constant_override("separation", 10)
	box.add_child(send_row)
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

	var hint := TerminalTheme.label(UIStrings.t("dept.close"), 13, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(hint)

	_redraw([])
	# una sola conversazione aperta alla volta: mentre il pannello vive,
	# ogni agent_chat_updated è per noi (l'agent del segnale è il nome
	# del sistema reale, es. "capitano" per il coordinatore)
	BackendBus.agent_chat_updated.connect(_on_updated)
	BackendBus.user_chat_sent.connect(_on_sent)
	BackendBus.chat_waiting_changed.connect(_on_waiting)
	ScriptedOnboarding.conversation_changed.connect(_on_scripted_changed)
	ScriptedOnboarding.action_requested.connect(_on_scripted_action)
	SetupService.status_changed.connect(_on_setup_status_changed)
	_refresh_chat_mode()
	if BackendBus.chat_waiting.has(_slug):
		_on_waiting(_slug, true)  # attesa già in corso da prima
	_input.grab_focus.call_deferred()
	Sfx.play_blip()
	# TEST-AUTO: JHT_CHAT_FULL=1 apre già a schermo intero (per gli shot,
	# si compone con JHT_CHAT/JHT_CHAT_VIEW di office.gd)
	if OS.get_environment("JHT_CHAT_FULL") == "1":
		_set_fullscreen(true)

## Schermo intero: il pannello si allarga a tutta la scena e nella metà
## sinistra compare il ritratto grande dell'agente (PortraitView, lo
## stesso sistema animato dei dialoghi) con la targa del nome.
func _set_fullscreen(on: bool) -> void:
	if _fullscreen == on:
		return
	_fullscreen = on
	_panel.anchor_left = 0.0 if on else 1.0
	_panel.offset_left = 24.0 if on else -PANEL_W - 24
	_stage.visible = on
	_roster_col.visible = on and _roster.size() > 1
	_expand_btn.text = UIStrings.t("chat.shrink" if on else "chat.expand")
	if on:
		if _portrait == null:
			_build_portrait()
		_portrait.enter_anim()
	Sfx.play_blip()

func _build_portrait() -> void:
	for old in _stage.get_children():
		old.queue_free()
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 16)
	_stage.add_child(col)
	_portrait = PortraitView.new()
	col.add_child(_portrait)
	_portrait.setup(_portrait_slug(_slug))
	_portrait.set_state("a", "neutro")
	# targa nome sotto il ritratto, come nei dialoghi
	var plate_row := CenterContainer.new()
	col.add_child(plate_row)
	var plate := BracketPanel.new()
	plate_row.add_child(plate)
	var pad := MarginContainer.new()
	pad.add_theme_constant_override("margin_left", 14)
	pad.add_theme_constant_override("margin_right", 14)
	pad.add_theme_constant_override("margin_top", 6)
	pad.add_theme_constant_override("margin_bottom", 6)
	plate.add_child(pad)
	_plate_label = TerminalTheme.label(
			_display_name.to_upper(), 20, Palette.GREEN, "bold")
	pad.add_child(_plate_label)

## Colonna switcher (solo schermo intero): tutte le chat 1-a-1 del
## roster in scena, si cambia conversazione senza chiudere il pannello.
## Pallini ●/◐ con la stessa semantica del menu chat (bus.chat_replies).
func _build_roster(split: HBoxContainer) -> void:
	_roster_col = ScrollContainer.new()
	_roster_col.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_roster_col.custom_minimum_size = Vector2(250, 0)
	_roster_col.visible = false
	split.add_child(_roster_col)
	var vb := VBoxContainer.new()
	vb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	vb.add_theme_constant_override("separation", 4)
	_roster_col.add_child(vb)
	vb.add_child(TerminalTheme.label(UIStrings.t("chat.menu"), 15,
			Palette.MUTED, "bold"))
	vb.add_child(HSeparator.new())
	for a in _roster:
		var entry: Dictionary = a
		var sure: bool = BackendBus.chat_replies(entry["slug"])
		var btn := Button.new()
		btn.set_meta("base", "%s  %s" % ["●" if sure else "◐", entry["name"]])
		btn.set_meta("sure", sure)
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.add_theme_font_size_override("font_size", 15)
		btn.pressed.connect(func() -> void:
			_switch_to(entry["slug"], entry["name"]))
		_roster_buttons[entry["slug"]] = btn
		vb.add_child(btn)
	_refresh_roster_highlight()

func _refresh_roster_highlight() -> void:
	for slug in _roster_buttons:
		var btn: Button = _roster_buttons[slug]
		var current: bool = slug == _slug
		btn.text = ("▶ " if current else "") + str(btn.get_meta("base"))
		btn.add_theme_color_override("font_color",
				Palette.WHITE if current
				else (Palette.GREEN if btn.get_meta("sure") else Palette.MUTED))

## Cambio conversazione dallo switcher: si chiude il canale corrente,
## si apre quello del nuovo agente; la storia arriva da sola sul solito
## agent_chat_updated (una sola conversazione aperta alla volta).
func _switch_to(slug: String, display_name: String) -> void:
	if slug == _slug:
		return
	BackendBus.close_agent_chat()
	_slug = slug
	BackendBus.mark_chat_read(_slug)
	_display_name = display_name
	_title.text = UIStrings.t("chat.title") % _display_name.to_upper()
	_warn.visible = not BackendBus.chat_replies(_slug)
	_waiting = false
	_waiting_label.visible = false
	_backend_messages.clear()
	_live_choices.clear()
	if _fullscreen:
		_build_portrait()
		_portrait.enter_anim()
	_refresh_roster_highlight()
	_refresh_chat_mode()
	if BackendBus.chat_waiting.has(_slug):
		_on_waiting(_slug, true)
	_input.grab_focus.call_deferred()
	Sfx.play_blip()

## Cartella ritratto dal uid di gioco: "scout-2" → "scout"; se il ruolo
## non ha ritratti (né pittorici né SVG) si presta lo scout, come i rig.
static func _portrait_slug(slug: String) -> String:
	var role := slug
	var dash := slug.rfind("-")
	if dash > 0 and slug.substr(dash + 1).is_valid_int():
		role = slug.substr(0, dash)
	if ResourceLoader.exists(PortraitView.GEN_DIR + role + "/full_neutro.png") \
			or ResourceLoader.exists(PortraitView.DIR + role + "/base.svg"):
		return role
	return "scout"

func _on_updated(agent: String, messages: Array) -> void:
	if ScriptedOnboarding.normalize_agent(agent) \
			!= ScriptedOnboarding.normalize_agent(_slug):
		return
	_backend_messages = messages.duplicate(true)
	_live_choices = _latest_live_choices(_backend_messages)
	_render_conversation()
	_render_choices()
	# il ritratto reagisce all'ultima battuta dell'agente (crossfade
	# emozione; se il ruolo non ha quella faccia resta sul neutro)
	if _portrait and not messages.is_empty() \
			and str(messages[-1].get("role", "")) != "user":
		_portrait.set_state("a", "caldo")

func _on_sent(_agent: String, ok: bool, error: String) -> void:
	if not ok:
		_append_line("⚠ " + error, Palette.RED)

func _on_waiting(agent: String, waiting: bool) -> void:
	if agent != _slug and not agent.begins_with(_slug):
		return
	_waiting = waiting
	_wait_t = 0.0
	if _waiting_label:
		_waiting_label.visible = waiting
	if _portrait and waiting:
		_portrait.set_state("a", "pensieroso")


func _refresh_chat_mode() -> void:
	_setup_signature = _chat_mode_signature()
	var guided := ScriptedOnboarding.supports(_slug) \
			and ScriptedOnboarding.use_scripted_chat(_slug)
	var live_text := ScriptedOnboarding.live_text_available(_slug) \
			if ScriptedOnboarding.supports(_slug) else (\
			ScriptedOnboarding.provider_authenticated() \
			and bool(SetupService.status.get("container_running", false)) \
			and BackendBus.can_chat_with(_slug))
	_input.editable = live_text
	_send_btn.disabled = not live_text
	_input.placeholder_text = UIStrings.t("guided.free_placeholder" if live_text \
			else "guided.choice_placeholder")
	if guided:
		_warn.text = UIStrings.t("guided.offline_note")
		_warn.visible = true
	elif ScriptedOnboarding.provider_authenticated() and not live_text:
		_warn.text = UIStrings.t("guided.agent_unavailable")
		_warn.visible = true
	else:
		_warn.text = UIStrings.t("chat.besteffort")
		_warn.visible = not BackendBus.chat_replies(_slug)
	_render_choices()
	if live_text:
		BackendBus.open_agent_chat(_slug)
	_render_conversation()


func _render_conversation() -> void:
	var shown: Array = []
	if ScriptedOnboarding.supports(_slug) and ScriptedOnboarding.use_scripted_chat(_slug):
		shown.append_array(ScriptedOnboarding.messages(_slug))
	shown.append_array(_backend_messages)
	_redraw(shown)


func _render_choices() -> void:
	for child in _choices.get_children():
		child.queue_free()
	var guided := ScriptedOnboarding.supports(_slug) \
			and ScriptedOnboarding.use_scripted_chat(_slug)
	var options: Array = ScriptedOnboarding.options(_slug) if guided \
			else _live_choices
	if options.is_empty():
		return
	_choices.add_child(TerminalTheme.label(UIStrings.t(
			"guided.choose" if guided else "guided.ai_suggestions"),
			12, Palette.MUTED, "medium"))
	for option in options:
		var entry: Dictionary = option if option is Dictionary \
				else {"label": str(option), "value": str(option)}
		var button := Button.new()
		button.text = "› " + str(entry.get("label", ""))
		button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		button.add_theme_font_size_override("font_size", 14)
		button.add_theme_color_override("font_color", Palette.GREEN)
		button.pressed.connect(func() -> void:
			if guided:
				ScriptedOnboarding.choose(_slug, str(entry.get("id", "")))
			else:
				_send_text(str(entry.get("value", entry.get("label", ""))))
			Sfx.play_tick())
		_choices.add_child(button)


## Suggerimenti REALI: sono accettati soltanto sull'ultima risposta completa
## dell'agente e spariscono appena l'utente invia una battuta successiva.
## Il formato additivo del JSONL è {choices:[{label,value}, ...]}.
static func _latest_live_choices(messages: Array) -> Array:
	if messages.is_empty():
		return []
	var last: Variant = messages[-1]
	if not last is Dictionary or str(last.get("role", "")) == "user" \
			or bool(last.get("partial", false)) or not bool(last.get("done", true)):
		return []
	var raw: Variant = last.get("choices", [])
	if not raw is Array:
		return []
	var out: Array = []
	for item in raw:
		var label := str(item.get("label", "") if item is Dictionary else item).strip_edges()
		var value := str(item.get("value", label) if item is Dictionary else item).strip_edges()
		if not label.is_empty() and not value.is_empty() and out.size() < 5:
			out.append({"label": label.left(120), "value": value.left(1000)})
	return out


func _on_scripted_changed(agent: String) -> void:
	if ScriptedOnboarding.normalize_agent(agent) != ScriptedOnboarding.normalize_agent(_slug):
		return
	_refresh_chat_mode()

func _on_setup_status_changed(_status: Dictionary) -> void:
	# Il login provider è un cambio di regime immediato: nessuna scelta authored
	# deve sopravvivere nel pannello già aperto.
	if _chat_mode_signature() != _setup_signature:
		_refresh_chat_mode()

func _chat_mode_signature() -> String:
	return "%s|%s|%s" % [
		str(ScriptedOnboarding.provider_authenticated()),
		str(bool(SetupService.status.get("container_running", false))),
		str(BackendBus.can_chat_with(_slug)),
	]


func _on_scripted_action(action: String, payload: Dictionary) -> void:
	if action == "open_section":
		close(false)
	elif action == "open_scripted_chat":
		var agent := str(payload.get("agent", "assistente"))
		var names := {"assistente": "Assistente", "coordinatore": "Coordinatore",
				"mentor": "Mentor"}
		_switch_to(agent, str(names.get(agent, agent.capitalize())))

## La storia arriva COMPLETA a ogni giro: si ridisegna da zero.
func _redraw(messages: Array) -> void:
	for child in _list.get_children():
		child.queue_free()
	_empty_note = null
	if messages.is_empty():
		_empty_note = TerminalTheme.label(UIStrings.t("chat.empty"), 14, Palette.DIM)
		_empty_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_list.add_child(_empty_note)
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
			UIStrings.t("chat.you") if mine else _display_name.to_upper(), 12,
			Palette.GREEN if mine else Palette.MUTED, "medium")
	who.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT if mine \
			else HORIZONTAL_ALIGNMENT_LEFT
	row.add_child(who)
	var color: Color = Palette.BRIGHT if mine else Palette.BASE
	if partial:
		color = Palette.DIM  # checkpoint "sta lavorando"
	var body := TerminalTheme.label(str(msg.get("text", "")), 15, color)
	body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT if mine \
			else HORIZONTAL_ALIGNMENT_LEFT
	row.add_child(body)
	_list.add_child(row)

func _append_line(text: String, color: Color) -> void:
	if _empty_note:
		_empty_note.queue_free()
		_empty_note = null
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
	_send_text(text)

func _send_text(text: String) -> void:
	if text.strip_edges().is_empty() or not _input.editable:
		return
	_live_choices.clear()
	_render_choices()
	BackendBus.send_user_chat(_slug, text)
	Sfx.play_tick()

func close(sound := true) -> void:
	if _closing:
		return
	_closing = true
	BackendBus.close_agent_chat()
	if sound:
		Sfx.play_back()
	closed.emit()
	queue_free()

func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo \
			and event.keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		close()

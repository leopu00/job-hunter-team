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

var _slug := ""           # slug di gioco (es. "coordinatore")
var _display_name := ""
var _list: VBoxContainer
var _scroll: ScrollContainer
var _input: LineEdit
var _empty_note: Label

func _init(slug: String, display_name: String) -> void:
	_slug = slug
	_display_name = display_name
	layer = 40

func _ready() -> void:
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
	var panel := BracketPanel.new()
	panel.set_anchors_preset(Control.PRESET_RIGHT_WIDE)
	panel.custom_minimum_size = Vector2(PANEL_W, 0)
	panel.offset_left = -PANEL_W - 24
	panel.offset_right = -24
	panel.offset_top = 24
	panel.offset_bottom = -24
	root.add_child(panel)
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 20)
	panel.add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	margin.add_child(box)

	var title := TerminalTheme.label(
			UIStrings.t("chat.title") % _display_name.to_upper(), 20, Palette.WHITE, "xbold")
	box.add_child(title)
	box.add_child(HSeparator.new())

	_scroll = ScrollContainer.new()
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	box.add_child(_scroll)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 8)
	_scroll.add_child(_list)

	# input + invio
	var send_row := HBoxContainer.new()
	send_row.add_theme_constant_override("separation", 10)
	box.add_child(send_row)
	_input = LineEdit.new()
	_input.placeholder_text = UIStrings.t("chat.placeholder")
	_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_input.text_submitted.connect(func(_t: String) -> void: _send())
	send_row.add_child(_input)
	var send := Button.new()
	send.text = UIStrings.t("chat.send")
	send.add_theme_color_override("font_color", Palette.GREEN)
	send.pressed.connect(_send)
	send_row.add_child(send)

	var hint := TerminalTheme.label(UIStrings.t("dept.close"), 13, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(hint)

	_redraw([])
	# una sola conversazione aperta alla volta: mentre il pannello vive,
	# ogni agent_chat_updated è per noi (l'agent del segnale è il nome
	# del sistema reale, es. "capitano" per il coordinatore)
	BackendBus.agent_chat_updated.connect(_on_updated)
	BackendBus.user_chat_sent.connect(_on_sent)
	BackendBus.open_agent_chat(_slug)
	_input.grab_focus.call_deferred()
	Sfx.play_blip()

func _on_updated(_agent: String, messages: Array) -> void:
	_redraw(messages)

func _on_sent(_agent: String, ok: bool, error: String) -> void:
	if not ok:
		_append_line("⚠ " + error, Palette.RED)

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
	BackendBus.send_user_chat(_slug, text)
	Sfx.play_tick()

func close() -> void:
	BackendBus.close_agent_chat()
	Sfx.play_back()
	closed.emit()
	queue_free()

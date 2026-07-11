class_name ChatPanel
extends CanvasLayer
## Conversazione BIDIREZIONALE con un agente del team (missione 19:0x):
## dal click sull'agente si apre questo pannello, l'utente scrive e il
## messaggio parte sul canale REALE del team (BackendBus.send_chat →
## adapter → tmux sulla VPS); le risposte arrivano dal normale flusso
## chat_message e compaiono qui dentro, oltre che a fumetto in scena.

signal closed

const PANEL_W := 560.0

var _uid := ""            # slug/uid dell'interlocutore (es. "coordinatore")
var _display_name := ""
var _list: VBoxContainer
var _scroll: ScrollContainer
var _input: LineEdit
var _empty_note: Label

func _init(uid: String, display_name: String) -> void:
	_uid = uid
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

	# storico della sessione + aggiornamenti live
	var any := false
	for msg in BackendBus.chat_log:
		if _is_ours(msg):
			_append(msg)
			any = true
	if not any:
		_empty_note = TerminalTheme.label(UIStrings.t("chat.empty"), 14, Palette.DIM)
		_empty_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_list.add_child(_empty_note)
	BackendBus.chat_message.connect(_on_chat)
	_input.grab_focus.call_deferred()
	Sfx.play_blip()

## Della conversazione fanno parte: i miei messaggi a LUI, e tutto ciò
## che LUI dice a me, a tutti, o agli altri (è la sua voce nel team).
func _is_ours(msg: Dictionary) -> bool:
	var from := str(msg.get("from", ""))
	var to := str(msg.get("to", ""))
	return (from == "user" and to == _uid) or from == _uid

func _on_chat(msg: Dictionary) -> void:
	if _is_ours(msg):
		_append(msg)

func _append(msg: Dictionary) -> void:
	if _empty_note:
		_empty_note.queue_free()
		_empty_note = null
	var mine := str(msg.get("from", "")) == "user"
	var row := VBoxContainer.new()
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_theme_constant_override("separation", 1)
	var who_text := UIStrings.t("chat.you") if mine else _display_name.to_upper()
	var to := str(msg.get("to", ""))
	if not mine and to != "user" and to != "":
		who_text += "  → " + to.to_upper()
	var who := TerminalTheme.label(who_text, 12,
			Palette.GREEN if mine else Palette.MUTED, "medium")
	who.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT if mine \
			else HORIZONTAL_ALIGNMENT_LEFT
	row.add_child(who)
	var body := TerminalTheme.label(str(msg.get("text", "")), 15,
			Palette.BRIGHT if mine else Palette.BASE)
	body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT if mine \
			else HORIZONTAL_ALIGNMENT_LEFT
	row.add_child(body)
	_list.add_child(row)
	_scroll_to_bottom.call_deferred()

func _scroll_to_bottom() -> void:
	await get_tree().process_frame
	_scroll.scroll_vertical = int(_scroll.get_v_scroll_bar().max_value)

func _send() -> void:
	var text := _input.text.strip_edges()
	if text.is_empty():
		return
	_input.clear()
	BackendBus.send_chat(_uid, text)
	Sfx.play_tick()

func close() -> void:
	Sfx.play_back()
	closed.emit()
	queue_free()

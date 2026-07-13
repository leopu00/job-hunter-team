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
var _empty_note: Label
var _waiting_label: Label
var _waiting := false
var _wait_t := 0.0
var _fullscreen := false
var _panel: BracketPanel
var _stage: CenterContainer   # palco del ritratto, solo schermo intero
var _portrait: PortraitView
var _expand_btn: Button

func _process(delta: float) -> void:
	if not _waiting or _waiting_label == null:
		return
	_wait_t += delta
	_waiting_label.text = UIStrings.t("chat.waiting") \
			+ "…".repeat(1 + int(_wait_t * 2.0) % 3)

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
	var title := TerminalTheme.label(
			UIStrings.t("chat.title") % _display_name.to_upper(), 20, Palette.WHITE, "xbold")
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	_expand_btn = Button.new()
	_expand_btn.text = UIStrings.t("chat.expand")
	_expand_btn.add_theme_font_size_override("font_size", 13)
	_expand_btn.add_theme_color_override("font_color", Palette.MUTED)
	_expand_btn.pressed.connect(func() -> void: _set_fullscreen(not _fullscreen))
	head.add_child(_expand_btn)
	# avviso best-effort: solo alcuni agenti hanno la skill di risposta
	# in chat (bus.chat_replies); gli altri leggono ma possono tacere
	if not BackendBus.chat_replies(_slug):
		var warn := TerminalTheme.label(UIStrings.t("chat.besteffort"), 13, Palette.YELLOW)
		warn.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		box.add_child(warn)
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
	BackendBus.chat_waiting_changed.connect(_on_waiting)
	BackendBus.open_agent_chat(_slug)
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
	_expand_btn.text = UIStrings.t("chat.shrink" if on else "chat.expand")
	if on:
		if _portrait == null:
			_build_portrait()
		_portrait.enter_anim()
	Sfx.play_blip()

func _build_portrait() -> void:
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
	pad.add_child(TerminalTheme.label(
			_display_name.to_upper(), 20, Palette.GREEN, "bold"))

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

func _on_updated(_agent: String, messages: Array) -> void:
	_redraw(messages)
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

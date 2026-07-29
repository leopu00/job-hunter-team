class_name ComicChat
extends Control
## La VISTA della conversazione 1-a-1 con un agente, impaginata come una
## pagina di fumetto (richiesta dell'utente, 2026-07-28):
##
##     ┌──────────┬──────────────────────────────┬──────────────┐
##     │ roster   │  vignette (scroll)           │   ritratto   │
##     │ (se >1)  │  ...                         │   dell'      │
##     │          │  [ scrivi un messaggio… ]    │   agente     │
##     └──────────┴──────────────────────────────┴──────────────┘
##
## Il ritratto sta a DESTRA, le vignette al CENTRO, la barra di input in
## BASSO al centro. Le vignette dell'agente hanno la coda verso destra (verso
## la sua testa), quelle dell'utente verso sinistra: vedi ComicBubble.
##
## Questa classe non parla col backend: è solo impaginazione e disegno. Il
## canale (BackendBus.open_agent_chat / send_user_chat / agent_chat_updated)
## resta in ChatPanel, che di questa vista è il guscio. Separarli serve a una
## cosa concreta: il self-test headless monta la vista con una storia finta e
## verifica vignette, ordine e colori senza VPS e senza agenti vivi.

signal send_requested(text: String)
signal close_requested
signal switch_requested(slug: String, display_name: String)

## Larghezza MINIMA del palco del ritratto: la misura vera la detta
## PortraitView.SIZE, questa serve solo a non farlo schiacciare.
const PORTRAIT_W := 380.0
const ROSTER_W := 230.0
## Sotto queste larghezze di finestra ritratto e switcher si tolgono di
## mezzo: meglio nessun disegno che una colonna di vignette larga quanto
## una ricevuta (schermi 1366x768, feedback 22/07).
const MIN_W_FOR_PORTRAIT := 940.0
const MIN_W_FOR_ROSTER := 1180.0
## La colonna delle vignette non diventa mai larga quanto lo schermo: oltre
## questa misura il testo smette di essere leggibile in una passata sola.
const PAGE_MAX_W := 820.0
## Quanto della pagina occupa una vignetta: il resto è il vuoto dal lato
## opposto alla coda, che è ciò che rende leggibile "chi parla" da lontano.
const BUBBLE_RATIO := 0.84

var input: LineEdit
var send_button: Button
var choices: VBoxContainer
var warn: Label

var _slug := ""
var _display_name := ""
var _roster: Array = []
var _roster_col: ScrollContainer
var _roster_buttons := {}
var _title: Label
var _scroll: ScrollContainer
var _page: MarginContainer
var _list: VBoxContainer
var _stage: CenterContainer
var _portrait: PortraitView
var _plate: Label
var _waiting_label: Label
var _jump_btn: Button
var _empty_note: Label
var _waiting := false
var _wait_t := 0.0
## L'utente sta rileggendo la storia più in alto? Allora una vignetta nuova
## NON deve strappargli la pagina sotto gli occhi.
var _pinned_to_bottom := true
var _bubbles: Array[ComicBubble] = []


func _init(slug: String, display_name: String, roster: Array = []) -> void:
	_slug = slug
	_display_name = display_name
	_roster = roster


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 26)
	add_child(margin)
	var split := HBoxContainer.new()
	split.add_theme_constant_override("separation", 22)
	margin.add_child(split)

	_build_roster(split)
	var column := VBoxContainer.new()
	column.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	column.add_theme_constant_override("separation", 10)
	split.add_child(column)
	_build_head(column)
	_build_page(column)
	_build_composer(column)
	_build_stage(split)

	resized.connect(_apply_responsive)
	get_viewport().size_changed.connect(_fit_viewport)
	_fit_viewport()
	_apply_responsive()
	set_agent(_slug, _display_name)


func _fit_viewport() -> void:
	if is_inside_tree():
		size = get_viewport().get_visible_rect().size


func _process(delta: float) -> void:
	if not _waiting or _waiting_label == null:
		return
	_wait_t += delta
	_waiting_label.text = UIStrings.t("chat.waiting") \
			+ "…".repeat(1 + int(_wait_t * 2.0) % 3)


# ── Costruzione ──────────────────────────────────────────────────────

func _build_head(column: VBoxContainer) -> void:
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 10)
	column.add_child(head)
	_title = TerminalTheme.label(
			UIStrings.t("chat.title") % _display_name.to_upper(), 20,
			Palette.WHITE, "xbold")
	_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_title)
	var close_btn := Button.new()
	close_btn.text = "✕"
	close_btn.tooltip_text = UIStrings.t("chat.close")
	close_btn.add_theme_color_override("font_color", Palette.MUTED)
	close_btn.pressed.connect(func() -> void: close_requested.emit())
	head.add_child(close_btn)
	# Avviso best-effort / modalità guidata: lo testo lo decide il guscio.
	warn = TerminalTheme.label(UIStrings.t("chat.besteffort"), 13, Palette.YELLOW)
	warn.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	warn.visible = false
	column.add_child(warn)


func _build_page(column: VBoxContainer) -> void:
	_scroll = ScrollContainer.new()
	_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	column.add_child(_scroll)
	# La pagina è centrata e non supera PAGE_MAX_W: su un monitor largo le
	# vignette resterebbero altrimenti righe lunghissime da rileggere.
	_page = MarginContainer.new()
	_page.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_scroll.add_child(_page)
	_list = VBoxContainer.new()
	_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_list.add_theme_constant_override("separation", 14)
	_page.add_child(_list)
	_scroll.get_v_scroll_bar().value_changed.connect(_on_scrolled)
	_scroll.resized.connect(_apply_page_width)

	# "vai all'ultimo": compare SOLO mentre si sta rileggendo indietro.
	var jump_row := HBoxContainer.new()
	jump_row.alignment = BoxContainer.ALIGNMENT_END
	column.add_child(jump_row)
	_jump_btn = Button.new()
	_jump_btn.text = "↓  " + UIStrings.t("chat.jump_latest")
	_jump_btn.add_theme_font_size_override("font_size", 13)
	_jump_btn.add_theme_color_override("font_color", Palette.GREEN)
	_jump_btn.visible = false
	_jump_btn.pressed.connect(func() -> void:
		_pinned_to_bottom = true
		scroll_to_bottom()
		Sfx.play_tick())
	jump_row.add_child(_jump_btn)

	_waiting_label = TerminalTheme.label("", 14, Palette.YELLOW)
	_waiting_label.visible = false
	column.add_child(_waiting_label)
	choices = VBoxContainer.new()
	choices.add_theme_constant_override("separation", 6)
	column.add_child(choices)


func _build_composer(column: VBoxContainer) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	column.add_child(row)
	input = LineEdit.new()
	input.placeholder_text = UIStrings.t("chat.placeholder")
	input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	input.text_submitted.connect(func(_t: String) -> void: submit())
	row.add_child(input)
	send_button = Button.new()
	send_button.text = UIStrings.t("chat.send")
	send_button.add_theme_color_override("font_color", Palette.GREEN)
	send_button.pressed.connect(submit)
	row.add_child(send_button)
	var hint := TerminalTheme.label(UIStrings.t("dept.close"), 13, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	column.add_child(hint)


func _build_stage(split: HBoxContainer) -> void:
	_stage = CenterContainer.new()
	_stage.custom_minimum_size = Vector2(PORTRAIT_W, 0)
	_stage.size_flags_vertical = Control.SIZE_EXPAND_FILL
	split.add_child(_stage)


## Colonna per cambiare interlocutore senza chiudere la pagina. Compare solo
## se c'è più di una conversazione e se lo schermo è abbastanza largo.
func _build_roster(split: HBoxContainer) -> void:
	_roster_col = ScrollContainer.new()
	_roster_col.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_roster_col.custom_minimum_size = Vector2(ROSTER_W, 0)
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
		var btn := Button.new()
		# Un agente senza nome esiste (roster in arrivo, istanza appena
		# nata): un bottone vuoto no. Si ripiega sull'uid, che è sempre
		# qualcosa di leggibile — "scout-2" batte una riga bianca.
		var label := str(entry.get("name", "")).strip_edges()
		if label.is_empty():
			label = str(entry.get("slug", "")).capitalize()
		btn.set_meta("base", label)
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.add_theme_font_size_override("font_size", 15)
		btn.pressed.connect(func() -> void:
			switch_requested.emit(str(entry.get("slug", "")),
					str(entry.get("name", ""))))
		_roster_buttons[str(entry.get("slug", ""))] = btn
		vb.add_child(btn)


## Il ritratto e lo switcher sono un lusso di larghezza: su una finestra
## stretta la pagina resta leggibile perché entrambi si tolgono di mezzo.
func _apply_responsive() -> void:
	if _stage:
		_stage.visible = size.x >= MIN_W_FOR_PORTRAIT
	if _roster_col:
		_roster_col.visible = _roster.size() > 1 and size.x >= MIN_W_FOR_ROSTER
	_apply_page_width()


func _apply_page_width() -> void:
	if _page == null or _scroll == null:
		return
	var side := int(maxf(0.0, (_scroll.size.x - PAGE_MAX_W) * 0.5))
	_page.add_theme_constant_override("margin_left", side)
	_page.add_theme_constant_override("margin_right", side)


# ── API per il guscio (ChatPanel) ────────────────────────────────────

## Cambia interlocutore: titolo, targa e ritratto. Le vignette le ricarica
## il guscio quando il backend gli manda la storia del nuovo agente.
func set_agent(slug: String, display_name: String) -> void:
	_slug = slug
	_display_name = display_name
	if _title:
		_title.text = UIStrings.t("chat.title") % _display_name.to_upper()
	_build_portrait()
	_refresh_roster_highlight()


func set_waiting(on: bool) -> void:
	_waiting = on
	_wait_t = 0.0
	if _waiting_label:
		_waiting_label.visible = on
	if on and _portrait:
		_portrait.set_state("a", "pensieroso")


## Reazione del ritratto all'ultima battuta: stesso sistema dei dialoghi.
## Se il ruolo non ha quella faccia, PortraitView resta sul neutro.
func set_mood(face: String) -> void:
	if _portrait:
		_portrait.set_state("a", face)


func focus_input() -> void:
	if input:
		input.grab_focus.call_deferred()


func submit() -> void:
	if input == null or not input.editable:
		return
	var text := input.text.strip_edges()
	if text.is_empty():
		return
	input.clear()
	send_requested.emit(text)


## La storia arriva SEMPRE completa dal canale (il backend fa il tail del
## chat.jsonl): si ridisegna da zero, come faceva il pannello a lista.
func render(messages: Array) -> void:
	for child in _list.get_children():
		child.queue_free()
	_bubbles.clear()
	_empty_note = null
	if messages.is_empty():
		_empty_note = TerminalTheme.label(UIStrings.t("chat.empty"), 14, Palette.DIM)
		_empty_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_list.add_child(_empty_note)
		return
	# Marcatore d'inizio: dice all'utente che sopra non c'è altro. La storia
	# che il backend conserva è il tail del chat.jsonl, non tutta la vita
	# dell'agente — senza questa riga uno scroll che si ferma sembra un bug.
	var start := TerminalTheme.label(UIStrings.t("chat.history_start"), 12, Palette.DIM)
	start.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_list.add_child(start)
	for msg in messages:
		_append(msg)
	if _pinned_to_bottom:
		scroll_to_bottom.call_deferred()


## Riga fuori conversazione (errori di invio): niente vignetta, è il gioco
## che parla, non l'agente.
func append_notice(text: String, color: Color) -> void:
	if _empty_note:
		_empty_note.queue_free()
		_empty_note = null
	var line := TerminalTheme.label(text, 14, color)
	line.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	line.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_list.add_child(line)
	scroll_to_bottom.call_deferred()


func scroll_to_bottom() -> void:
	if not is_inside_tree():
		return
	await get_tree().process_frame
	if not is_instance_valid(_scroll):
		return
	_scroll.scroll_vertical = int(_scroll.get_v_scroll_bar().max_value)
	_pinned_to_bottom = true
	if _jump_btn:
		_jump_btn.visible = false


## Stato osservabile per il self-test headless: quante vignette, di chi, in
## che ordine, con quali colori e con la coda da che parte.
func debug_snapshot() -> Dictionary:
	var bubbles: Array = []
	for b in _bubbles:
		bubbles.append(b.debug_snapshot())
	var bar := _scroll.get_v_scroll_bar() if _scroll else null
	return {
		"agent": _slug,
		"bubbles": bubbles,
		"portrait_slug": portrait_slug(_slug),
		"portrait_visible": _stage != null and _stage.visible,
		"roster_visible": _roster_col != null and _roster_col.visible,
		"pinned_to_bottom": _pinned_to_bottom,
		"jump_visible": _jump_btn != null and _jump_btn.visible,
		"waiting": _waiting,
		"scroll_max": bar.max_value if bar else 0.0,
		"scroll_at": bar.value if bar else 0.0,
		"width": size.x,
	}


# ── Interno ──────────────────────────────────────────────────────────

func _append(msg: Dictionary) -> void:
	var is_user := str(msg.get("role", "")) == "user"
	var partial: bool = bool(msg.get("partial", false)) \
			or not bool(msg.get("done", true))
	var row := VBoxContainer.new()
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_theme_constant_override("separation", 2)
	var who := TerminalTheme.label(
			UIStrings.t("chat.you") if is_user else _display_name.to_upper(), 12,
			Palette.GREEN if is_user else Palette.MUTED, "medium")
	who.horizontal_alignment = HORIZONTAL_ALIGNMENT_LEFT if is_user \
			else HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(who)
	# La vignetta dell'agente sta sul lato del suo ritratto (destra), quella
	# dell'utente sul lato opposto: le due code non si incontrano mai. La
	# larghezza la decide il layout (rapporti di stiramento), non un calcolo
	# sulle dimensioni: al primo disegno i contenitori misurano ancora zero.
	var align := HBoxContainer.new()
	align.add_theme_constant_override("separation", 0)
	row.add_child(align)
	var bubble := ComicBubble.new(str(msg.get("text", "")), is_user, partial)
	bubble.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	bubble.size_flags_stretch_ratio = BUBBLE_RATIO
	var gutter := Control.new()
	gutter.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	gutter.size_flags_stretch_ratio = 1.0 - BUBBLE_RATIO
	gutter.mouse_filter = Control.MOUSE_FILTER_IGNORE
	if is_user:
		align.add_child(bubble)
		align.add_child(gutter)
	else:
		align.add_child(gutter)
		align.add_child(bubble)
	_bubbles.append(bubble)
	_list.add_child(row)


func _on_scrolled(value: float) -> void:
	if _scroll == null:
		return
	var bar := _scroll.get_v_scroll_bar()
	# Tolleranza di qualche pixel: il fondo "esatto" non si tocca mai quando
	# il contenuto cresce di mezza riga.
	_pinned_to_bottom = value >= bar.max_value - bar.page - 8.0
	if _jump_btn:
		_jump_btn.visible = not _pinned_to_bottom


func _build_portrait() -> void:
	if _stage == null:
		return
	for old in _stage.get_children():
		old.queue_free()
	_portrait = null
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 14)
	_stage.add_child(col)
	_portrait = PortraitView.new()
	col.add_child(_portrait)
	_portrait.setup(portrait_slug(_slug))
	_portrait.set_state("a", "neutro")
	_portrait.enter_anim()
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
	_plate = TerminalTheme.label(_display_name.to_upper(), 20, Palette.GREEN, "bold")
	pad.add_child(_plate)


func _refresh_roster_highlight() -> void:
	for slug in _roster_buttons:
		var btn: Button = _roster_buttons[slug]
		var current: bool = slug == _slug
		btn.text = ("▶ " if current else "   ") + str(btn.get_meta("base"))
		btn.add_theme_color_override("font_color",
				Palette.WHITE if current else Palette.MUTED)


## Cartella del ritratto per un uid di gioco.
##
## "Ogni personaggio è quello unico disegnato": se un giorno arriva il
## ritratto della SECONDA istanza (`scout-2/`) lo si usa così com'è, senza
## toccare questo codice. Finché non c'è, tutte le istanze di un ruolo
## condividono il ritratto del ruolo — che resta comunque sempre lo stesso
## per lo stesso numero, mai uno a caso.
##
## Ordine: ritratto pittorico dell'istanza → pittorico del ruolo → SVG a
## strati del ruolo → nessun ritratto (PortraitView si nasconde da solo e
## resta la targa col nome; il gap d'arte è tracciato in gen-art/LOG.md).
static func portrait_slug(slug: String) -> String:
	var clean := slug.strip_edges().to_lower()
	if clean == "capitano" or clean.begins_with("capitano-"):
		clean = "coordinatore" + clean.substr(8)
	if _has_portrait(clean):
		return clean
	# I suffissi d'istanza non sono solo numeri: "scout-2" ma anche
	# "critico-s1" (la sessione che apre lo Scrittore) e "sentinella-worker".
	# Si tolgono uno alla volta finché resta un ruolo che ha una faccia.
	var parts: Array = Array(clean.split("-"))
	while parts.size() > 1:
		parts.pop_back()
		var candidate := "-".join(PackedStringArray(parts))
		if _has_portrait(candidate):
			return candidate
	return clean.split("-")[0]


static func _has_portrait(name: String) -> bool:
	return ResourceLoader.exists(PortraitView.GEN_DIR + name + "/full_neutro.png") \
			or ResourceLoader.exists(PortraitView.DIR + name + "/base.svg")

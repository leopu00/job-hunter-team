class_name ShutdownDialog
extends CanvasLayer
## Cosa succede al team quando chiudi la finestra.
##
## Gli agenti non vivono nel gioco: vivono nel container e continuavano a
## lavorare — e a consumare token — con l'applicazione chiusa, senza che nulla
## lo dicesse (Leone, 25/07). Chiudere ora è una decisione informata: qui sotto
## c'è chi sta lavorando in questo momento, e due modi di fermarlo.
##
## `ORDINATA` è la strada buona: il Capitano fa annotare a ognuno dove era
## arrivato prima di spegnere, così domani si riprende invece di ricominciare.
## `FORZATA` resta per chi ha fretta o per quando il Capitano non risponde.

signal chosen(mode: String)  # "graceful" | "forced" | "cancel"

const POLL_S := 3.0

var _agents: PackedStringArray
var _status: Label
var _buttons: HBoxContainer
var _waiting := false
var _elapsed := 0.0


func _init(agents: PackedStringArray) -> void:
	_agents = agents
	layer = 95
	process_mode = Node.PROCESS_MODE_ALWAYS


func _ready() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = TerminalTheme.get_theme()
	add_child(root)
	var dim := ColorRect.new()
	dim.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.92)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(center)
	var panel := BracketPanel.new()
	panel.custom_minimum_size = Vector2(680, 0)
	center.add_child(panel)
	var pad := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 26)
	panel.add_child(pad)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 12)
	pad.add_child(col)

	col.add_child(TerminalTheme.label(UIStrings.t("shutdown.title"),
			22, Palette.WHITE, "xbold"))
	var lead := TerminalTheme.label(
			UIStrings.t("shutdown.lead") % _agents.size(), 14, Palette.YELLOW)
	lead.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(lead)

	# Chi stai per interrompere, con nome e cognome.
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 2)
	for name in _agents:
		var row := TerminalTheme.label("  ● " + str(name), 14, Palette.BASE)
		list.add_child(row)
	col.add_child(list)

	col.add_child(HSeparator.new())
	_status = TerminalTheme.label("", 13, Palette.MUTED)
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(_status)

	_buttons = HBoxContainer.new()
	_buttons.add_theme_constant_override("separation", 10)
	col.add_child(_buttons)
	_add_button(UIStrings.t("shutdown.graceful"), Palette.GREEN,
			func() -> void: _start_graceful())
	_add_button(UIStrings.t("shutdown.forced"), Palette.RED,
			func() -> void: chosen.emit("forced"))
	_add_button(UIStrings.t("shutdown.cancel"), Palette.MUTED,
			func() -> void: chosen.emit("cancel"))


func _add_button(text: String, color: Color, action: Callable) -> void:
	var b := Button.new()
	b.text = text
	b.add_theme_color_override("font_color", color)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.pressed.connect(func() -> void:
		Sfx.play_blip()
		action.call())
	_buttons.add_child(b)


## Ordine partito: da qui in poi comanda il Capitano e noi aspettiamo il flag,
## mostrando chi manca ancora. La chiusura forzata resta a portata di mano.
func _start_graceful() -> void:
	if _waiting:
		return
	_waiting = true
	_elapsed = 0.0
	for child in _buttons.get_children():
		child.queue_free()
	_add_button(UIStrings.t("shutdown.forced_now"), Palette.RED,
			func() -> void: chosen.emit("forced"))
	_status.text = UIStrings.t("shutdown.ordered")
	SetupService.request_graceful_shutdown()


func _process(delta: float) -> void:
	if not _waiting:
		return
	_elapsed += delta
	if fmod(_elapsed, POLL_S) > delta:
		return
	if SetupService.graceful_shutdown_ready():
		_status.text = UIStrings.t("shutdown.done")
		chosen.emit("graceful")
		_waiting = false
		return
	var left := SetupService.active_agents()
	_status.text = UIStrings.t("shutdown.waiting") % [left.size(),
			int(_elapsed)]

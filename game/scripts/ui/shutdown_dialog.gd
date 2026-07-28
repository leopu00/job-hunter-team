class_name ShutdownDialog
extends CanvasLayer
## Cosa succede al team quando chiudi la finestra.
##
## Gli agenti non vivono nel gioco: vivono nel container e continuavano a
## lavorare — e a consumare token — con l'applicazione chiusa, senza che nulla
## lo dicesse (Leone, 25/07). Chiudere è quindi una decisione, e le decisioni
## possibili sono TRE, non due:
##
##   `FERMA IL TEAM E CHIUDI` — il Capitano fa annotare a ognuno dove era
##     arrivato, poi si spegne tutto: domani si riprende invece di ricominciare.
##   `ESCI · IL TEAM CONTINUA` — si chiude solo la finestra. Gli agenti restano
##     al lavoro nel container (è la strada della CLI, che li avvia e se ne va):
##     si lascia il computer a lavorare la notte senza tenere aperto un gioco
##     che disegna. Il budget però continua a scorrere, e va detto qui.
##   `CHIUDI TUTTO SUBITO` — non aspetta nessuno, per chi ha fretta o per
##     quando il Capitano non risponde: chi stava lavorando perde il punto.
##
## Le tre stanno su tre righe separate, ognuna con una riga sola di spiegazione
## sotto: in fila orizzontale erano tre bottoni che si assomigliavano, e la
## differenza fra "chiudi in ordine" e "chiudi subito" — cioè se gli agenti
## fanno in tempo a salvare — non si legge in un'etichetta di due parole.

signal chosen(mode: String)  # "graceful" | "detach" | "forced" | "cancel"

const POLL_S := 3.0

var _agents: PackedStringArray
var _status: Label
var _choices: VBoxContainer
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

	# Le tre vie, una per riga: bottone a tutta larghezza e sotto la riga che
	# dice cosa cambia davvero. Il colore fa il resto del lavoro a colpo
	# d'occhio: verde si riprende da dove si era, blu non si ferma niente,
	# rosso si perde il punto.
	_choices = VBoxContainer.new()
	_choices.add_theme_constant_override("separation", 14)
	col.add_child(_choices)
	_add_choice("shutdown.graceful", "shutdown.graceful_hint", Palette.GREEN,
			func() -> void: _start_graceful())
	_add_choice("shutdown.detach", "shutdown.detach_hint", Palette.BLUE,
			func() -> void: _ask_detach())
	_add_choice("shutdown.forced", "shutdown.forced_hint", Palette.RED,
			func() -> void: chosen.emit(HeadlessSession.MODE_FORCED))

	col.add_child(HSeparator.new())
	_status = TerminalTheme.label("", 13, Palette.MUTED)
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	col.add_child(_status)

	_buttons = HBoxContainer.new()
	_buttons.add_theme_constant_override("separation", 10)
	col.add_child(_buttons)
	_add_button(UIStrings.t("shutdown.cancel"), Palette.MUTED,
			func() -> void: chosen.emit(HeadlessSession.MODE_CANCEL))


## Una scelta = un bottone largo quanto il pannello più la sua riga di
## spiegazione. La spiegazione è muted e piccola: si legge se serve, non si
## mette in mezzo a chi ha già deciso.
func _add_choice(label_key: String, hint_key: String, color: Color,
		action: Callable) -> void:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	_choices.add_child(box)
	var b := Button.new()
	b.text = UIStrings.t(label_key)
	b.add_theme_color_override("font_color", color)
	b.pressed.connect(func() -> void:
		Sfx.play_blip()
		action.call())
	box.add_child(b)
	var hint := TerminalTheme.label(UIStrings.t(hint_key), 13, Palette.MUTED)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(hint)


func _add_button(text: String, color: Color, action: Callable) -> void:
	var b := Button.new()
	b.text = text
	b.add_theme_color_override("font_color", color)
	b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	b.pressed.connect(func() -> void:
		Sfx.play_blip()
		action.call())
	_buttons.add_child(b)


## Da qui in poi la scelta è fatta: le tre vie spariscono e restano solo i
## bottoni dello stato in cui siamo entrati.
func _leave_choices() -> void:
	for child in _choices.get_children():
		child.queue_free()
	_choices.visible = false
	for child in _buttons.get_children():
		child.queue_free()


## Ordine partito: da qui in poi comanda il Capitano e noi aspettiamo il flag,
## mostrando chi manca ancora. La chiusura forzata resta a portata di mano.
func _start_graceful() -> void:
	if _waiting:
		return
	_waiting = true
	_elapsed = 0.0
	_leave_choices()
	_add_button(UIStrings.t("shutdown.forced_now"), Palette.RED,
			func() -> void: chosen.emit(HeadlessSession.MODE_FORCED))
	_status.text = UIStrings.t("shutdown.ordered")
	SetupService.request_graceful_shutdown()


## Uscire lasciandoli al lavoro è l'unica delle tre che continua a spendere
## dopo che la finestra è sparita: prima di farlo si dice per intero cosa resta
## acceso, come si torna e come si ferma. Un passo in più su una decisione che
## si prende la sera e si verifica la mattina dopo.
func _ask_detach() -> void:
	if _waiting:
		return
	_leave_choices()
	_status.text = UIStrings.t("shutdown.detach_body") + "\n" \
			+ UIStrings.t("shutdown.detach_back")
	_status.add_theme_color_override("font_color", Palette.BASE)
	_add_button(UIStrings.t("shutdown.detach_confirm"), Palette.BLUE,
			func() -> void: chosen.emit(HeadlessSession.MODE_DETACH))
	_add_button(UIStrings.t("shutdown.cancel"), Palette.MUTED,
			func() -> void: chosen.emit(HeadlessSession.MODE_CANCEL))


func _process(delta: float) -> void:
	if not _waiting:
		return
	_elapsed += delta
	if fmod(_elapsed, POLL_S) > delta:
		return
	if SetupService.graceful_shutdown_ready():
		_status.text = UIStrings.t("shutdown.done")
		chosen.emit(HeadlessSession.MODE_GRACEFUL)
		_waiting = false
		return
	var left := SetupService.active_agents()
	_status.text = UIStrings.t("shutdown.waiting") % [left.size(),
			int(_elapsed)]

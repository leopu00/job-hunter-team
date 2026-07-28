class_name HeadlessNotice
extends PanelContainer
## Il segno che il team ha lavorato senza di te.
##
## Chi esce scegliendo "il team continua" non ha più niente sullo schermo che
## glielo confermi — la finestra è chiusa, e da fuori un container acceso e uno
## spento si assomigliano. Al rientro deve trovare la risposta prima di
## chiedersela: da quanto stanno andando avanti e quanti sono in ufficio adesso.
##
## Compare una volta sola, al ritorno, e dopo mezzo minuto se ne va: è un
## saluto, non un cruscotto. Il marcatore lo consuma comunque, anche quando la
## risposta è "non c'è nessuno" — così un container spento da fuori non lascia
## in giro un rientro che si presenterà, sbagliato, fra tre settimane.

## Quanto resta a schermo. Il tempo di leggerlo tornando dalla macchina del
## caffè, non abbastanza da diventare arredamento.
const SHOW_S := 30.0

var _label: Label
var _marker := 0.0
var _answered := false


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	visible = false
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 16)
	margin.add_theme_constant_override("margin_right", 16)
	margin.add_theme_constant_override("margin_top", 6)
	margin.add_theme_constant_override("margin_bottom", 6)
	add_child(margin)
	_label = TerminalTheme.label("", 15, Palette.GREEN, "bold")
	margin.add_child(_label)
	_marker = HeadlessSession.detached_at()
	if _marker <= 0.0:
		return  # si è usciti fermando il team: niente da salutare
	BackendBus.agents_updated.connect(_on_agents)
	if not BackendBus.agents.is_empty():
		_on_agents(BackendBus.agents)


## Sotto il badge dei dati e la fascia del budget: le tre non si sovrappongono
## mai, e questa è l'unica che sparisce da sola.
func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and is_inside_tree():
		position = Vector2((get_parent_area_size().x - size.x) / 2.0, 98)


## Il primo roster che arriva è la risposta: da lì in poi il marcatore non
## serve più. In simulazione non si dice niente — gli agenti finti non hanno
## lavorato nessuna notte.
func _on_agents(agents: Array) -> void:
	if _answered:
		return
	_answered = true
	HeadlessSession.clear()
	if not BackendBus.is_live():
		return
	var state := HeadlessSession.state_for(_marker, _count_working(agents),
			Time.get_unix_time_from_system())
	if not bool(state["show"]):
		return
	_label.text = UIStrings.t("headless.back") % [
			HeadlessSession.duration_text(int(state["seconds"])),
			_count_working(agents)]
	var style := StyleBoxFlat.new()
	style.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.95)
	style.border_color = Color(Palette.GREEN.r, Palette.GREEN.g,
			Palette.GREEN.b, 0.85)
	style.set_border_width_all(TerminalTheme.hairline())
	add_theme_stylebox_override("panel", style)
	visible = true
	var tree := get_tree()
	if tree != null:
		tree.create_timer(SHOW_S).timeout.connect(
				func() -> void: visible = false)


## Stessa lettura del roster che fa l'ufficio per popolare le scrivanie: chi è
## sparito dal roster è stato fermato, e "killed" è un residuo del simulatore.
static func _count_working(agents: Array) -> int:
	var n := 0
	for item: Dictionary in agents:
		if item.get("active", true) and str(item.get("status", "")) != "killed":
			n += 1
	return n

class_name BudgetNotice
extends PanelContainer
## Perché il team non risponde.
##
## Quando la finestra di lavoro del provider si esaurisce, gli agenti smettono
## di rispondere: l'utente scrive in chat, non riceve niente, e conclude che
## l'applicazione è rotta (successo il 26/07, con la finestra 5h satura per
## 2h40). Il team non può dirglielo — è proprio la parte che tace.
##
## Questa fascia lo dice al posto suo, e solo quando serve: compare sotto il
## badge dei dati, dice quando si riprende, sparisce da sola al reset.
## La soglia e il conto dei minuti vivono in `BudgetWindow` (logica pura,
## testabile senza autoload); qui restano soltanto testo e colore.

var _label: Label
var _timer: Timer


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	visible = false
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 16)
	margin.add_theme_constant_override("margin_right", 16)
	margin.add_theme_constant_override("margin_top", 6)
	margin.add_theme_constant_override("margin_bottom", 6)
	add_child(margin)
	_label = TerminalTheme.label("", 15, Palette.YELLOW, "bold")
	margin.add_child(_label)
	BackendBus.live_settings_updated.connect(func(_s: Dictionary) -> void: _refresh())
	# Il conto alla rovescia scorre anche senza nuovi dati dal backend: i
	# minuti che mancano sono l'informazione che l'utente sta aspettando.
	_timer = Timer.new()
	_timer.wait_time = 30.0
	_timer.timeout.connect(_refresh)
	add_child(_timer)
	_timer.start()
	_refresh()


func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and is_inside_tree():
		position = Vector2((get_parent_area_size().x - size.x) / 2.0, 56)


static func _when(minutes: int) -> String:
	return UIStrings.t("budget.in_minutes") % minutes if minutes < 60 \
			else UIStrings.t("budget.in_hours") % [minutes / 60, minutes % 60]


func _refresh() -> void:
	var raw: Variant = BackendBus.live_settings.get("budget_window", {})
	var state := BudgetWindow.state_for(raw if raw is Dictionary else {})
	visible = str(state["level"]) != BudgetWindow.LEVEL_NONE
	if not visible:
		return
	var full := str(state["level"]) == BudgetWindow.LEVEL_FULL
	var when := _when(int(state["minutes"]))
	_label.text = UIStrings.t("budget.exhausted") % when if full \
			else UIStrings.t("budget.near_limit") % [int(state["usage"]), when]
	var color: Color = Palette.RED if full else Palette.YELLOW
	_label.add_theme_color_override("font_color", color)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.95)
	style.border_color = Color(color.r, color.g, color.b, 0.85)
	style.set_border_width_all(TerminalTheme.hairline())
	add_theme_stylebox_override("panel", style)

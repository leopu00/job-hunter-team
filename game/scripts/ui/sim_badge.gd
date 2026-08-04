class_name SimBadge
extends PanelContainer
## Badge di verità dei dati (ordine Leone 18:0x): finché in scena NON
## scorrono i dati veri della VPS l'utente deve vederlo a colpo d'occhio.
## In alto al centro: ambra "SIMULAZIONE — dati non reali"; quando la VPS
## è collegata e connessa diventa un discreto "DATI REALI", che dice anche
## DOVE gira il team: su una VPS o su questo computer.

var _label: Label

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 16)
	margin.add_theme_constant_override("margin_right", 16)
	margin.add_theme_constant_override("margin_top", 6)
	margin.add_theme_constant_override("margin_bottom", 6)
	add_child(margin)
	_label = TerminalTheme.label("", 16, Palette.YELLOW, "bold")
	margin.add_child(_label)
	BackendBus.connection_changed.connect(func(_s: int, _d: String) -> void:
		_refresh())
	BackendBus.positions_updated.connect(func(_positions: Array) -> void:
		_refresh())
	_refresh()

## Il testo cambia larghezza (SIMULAZIONE vs DATI REALI): il ricentraggio
## vive nel resize, così regge anche il primo layout pass.
func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and is_inside_tree():
		position = Vector2((get_parent_area_size().x - size.x) / 2.0, 14)

func _refresh() -> void:
	# Un collegamento vero puo' convivere per qualche secondo con le posizioni
	# showroom. Finche' il bus le marca demo, il badge deve continuare a dire
	# SIMULAZIONE; "connesso" non rende reali quei numeri.
	var live: bool = BackendBus.is_live() and not BackendBus.positions_are_demo
	var color: Color = Palette.GREEN if live else Palette.YELLOW
	_label.text = UIStrings.t("sim.live_vps" if BackendBus.is_remote() \
			else "sim.live_local") if live else UIStrings.t("sim.mock")
	_label.add_theme_color_override("font_color", color)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.92)
	style.border_color = Color(color.r, color.g, color.b, 0.85)
	style.set_border_width_all(TerminalTheme.hairline())
	add_theme_stylebox_override("panel", style)

class_name SimBadge
extends PanelContainer
## Badge di verità dei dati (ordine Leone 18:0x): finché in scena NON
## scorrono i dati veri della VPS l'utente deve vederlo a colpo d'occhio.
## In alto al centro: ambra "SIMULAZIONE — dati non reali". Quando backend e
## posizioni sono davvero live il warning scompare: non e' un watermark.

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

## Il ricentraggio vive nel resize, così regge anche il primo layout pass.
func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and is_inside_tree():
		position = Vector2((get_parent_area_size().x - size.x) / 2.0, 14)

func _refresh() -> void:
	# Un collegamento vero puo' convivere per qualche secondo con le posizioni
	# showroom. Finche' il bus le marca demo, il badge deve continuare a dire
	# SIMULAZIONE; "connesso" non rende reali quei numeri.
	_apply_state(BackendBus.is_live(), BackendBus.positions_are_demo)


func _apply_state(backend_live: bool, positions_demo: bool) -> void:
	# Questo nodo e' un AVVISO, non un watermark permanente: quando backend e
	# posizioni sono entrambi reali non c'e' piu' nulla da segnalare. Nasconderlo
	# prima (solo perche' la socket e' connessa) sarebbe invece ingannevole.
	visible = warning_needed(backend_live, positions_demo)
	if not visible:
		return
	var color: Color = Palette.YELLOW
	_label.text = UIStrings.t("sim.mock")
	_label.add_theme_color_override("font_color", color)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.92)
	style.border_color = Color(color.r, color.g, color.b, 0.85)
	style.set_border_width_all(TerminalTheme.hairline())
	add_theme_stylebox_override("panel", style)


## Tabella di verita' separata dalla scena: usata anche dal selftest headless.
static func warning_needed(backend_live: bool, positions_demo: bool) -> bool:
	return not backend_live or positions_demo

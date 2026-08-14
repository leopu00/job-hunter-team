class_name SimBadge
extends PanelContainer
## Provenienza unica per tutte le superfici dell'ufficio.
##
## UNAVAILABLE non equivale a DEMO: senza un gate esplicito i consumer devono
## mostrare stati vuoti, mai fixture. Il badge compare soltanto in DEMO;
## LIVE e UNAVAILABLE restano privi di diciture sintetiche.

enum DataState { LIVE, DEMO, UNAVAILABLE }

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
	_apply_state(current_state())


func _apply_state(state: DataState) -> void:
	visible = state == DataState.DEMO
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


## Classificazione pura, coperta dal selftest headless. Il flag demo ha
## precedenza anche su un MockBackend che dichiara la connessione attiva.
## Una posizione marcata demo senza autorizzazione non puo' diventare LIVE.
static func classify(backend_live: bool, positions_demo: bool,
		demo_gate: bool) -> DataState:
	if demo_gate:
		return DataState.DEMO
	if backend_live and not positions_demo:
		return DataState.LIVE
	return DataState.UNAVAILABLE


static func current_state() -> DataState:
	return classify(BackendBus.is_live(), BackendBus.positions_are_demo,
			explicit_demo_requested())


static func synthetic_data_allowed() -> bool:
	return current_state() == DataState.DEMO


## Unico rubinetto per le superfici che consumano lo snapshot posizioni.
## Un array presente sul bus non prova la provenienza: un MockBackend o una
## fixture rimasta in memoria devono diventare invisibili finche' manca un
## gate DEMO esplicito o un backend LIVE non-demo.
static func visible_positions() -> Array:
	return [] if current_state() == DataState.UNAVAILABLE else BackendBus.positions


## Uno snapshot LIVE vuoto e un backend assente chiedono azioni diverse.
## Le tre superfici positions/search/map usano questa stessa decisione per
## non invitare a collegare un team che e' gia' collegato e semplicemente non
## ha ancora posizioni.
static func positions_empty_copy() -> String:
	return UIStrings.t("common.positions_empty") \
			if current_state() == DataState.LIVE \
			else UIStrings.t("common.connect_team")


## La release normale non soddisfa nessuno di questi rami. JHT_DEMO e' il
## gate pubblico intenzionale; mock, tutorial e OfficeSelftests sono fixture
## avviate esplicitamente dai rispettivi runner. Il profilo live e' escluso
## anche se usa il dispatcher dei selftest.
static func explicit_demo_requested() -> bool:
	if OS.get_environment("JHT_LIVE_PROFILE_TEST") == "1" \
			or OS.get_environment("JHT_TRUTHFULNESS_TEST") == "1":
		return false
	if OS.get_environment("JHT_DEMO") == "1" \
			or OS.get_environment("JHT_WIZARD_TEST") == "1" \
			or OS.get_environment("JHT_MOCK_SETUP") == "1" \
			or OS.get_environment("JHT_TUTORIAL_HARNESS") == "1" \
			or OS.get_environment("JHT_SEAT_AUDIT") != "" \
			or OS.get_environment("JHT_ALL_SEATED_PREVIEW") == "1" \
			or OS.get_environment("JHT_PILE_PREVIEW") != "":
		return true
	return OfficeSelftests.armed()

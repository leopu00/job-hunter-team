class_name UsageHistoryView
extends VBoxContainer
## La finestra "Usage": grafico temporale dello usage del provider con
## finestra navigabile (default 5 ore) e metriche commutabili. Sotto al
## grafico principale una riga di grafici secondari sempre visibili
## (velocità, token pesati, throttle) per il colpo d'occhio.
##
## Dati: BackendBus.request_usage_history → serie della sentinella
## (usage% 5h, weekly, proiezione, velocità, throttle) + token-meter.

## Gruppi di metriche del grafico principale: chiave → serie estratte
## dalla risposta. Le quote viaggiano insieme (stessa scala %).
const GROUPS := [
	{"key": "quota", "label_key": "usage.group_quota"},
	{"key": "velocity", "label_key": "usage.group_velocity"},
	{"key": "tokens", "label_key": "usage.group_tokens"},
	{"key": "events", "label_key": "usage.group_events"},
]

static var group_key := "quota"   # sopravvive a chiusura/riapertura

var _range_bar: UsageRangeBar
var _status: Label
var _group_buttons := {}
var _main_chart: UsageChart
var _mini_velocity: UsageChart
var _mini_tokens: UsageChart
var _mini_throttle: UsageChart
var _data: Dictionary = {}
var _pending_query := {}
var _refresh_timer: Timer
var _veil: UsageLoadingVeil
var _provenance_note: Label
var _last_data_state := -1
var _provenance_generation := 0
var _request_serial := 0

func _ready() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 10)
	BackendBus.usage_history_updated.connect(_on_history)
	BackendBus.connection_changed.connect(_on_connection_changed)
	BackendBus.positions_updated.connect(_on_positions_provenance_changed)
	var data_state := SimBadge.current_state()
	_provenance_note = TerminalTheme.label("", 13, Palette.DIM, "medium")
	add_child(_provenance_note)
	_apply_provenance(data_state, false)

	_range_bar = UsageRangeBar.new()
	_range_bar.range_changed.connect(_request)
	add_child(_range_bar)

	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation", 14)
	add_child(controls)
	for g in GROUPS:
		var btn := Button.new()
		btn.flat = true
		btn.text = UIStrings.t(g["label_key"])
		btn.add_theme_font_size_override("font_size", 13)
		btn.add_theme_color_override("font_hover_color", Palette.MINT)
		btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var key: String = g["key"]
		btn.pressed.connect(func() -> void:
			group_key = key
			_restyle_groups()
			_render())
		controls.add_child(btn)
		_group_buttons[key] = btn
	_status = TerminalTheme.label("", 13, Palette.DIM)
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	controls.add_child(_status)
	_restyle_groups()

	_main_chart = UsageChart.new()
	_main_chart.custom_minimum_size = Vector2(520, 300)
	add_child(_main_chart)

	var minis := HBoxContainer.new()
	minis.add_theme_constant_override("separation", 12)
	minis.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_child(minis)
	_mini_velocity = _mini(minis)
	_mini_tokens = _mini(minis)
	_mini_throttle = _mini(minis)
	_mini_throttle.mode = UsageChart.Mode.BARS

	# ancorata a ORA la finestra segue l'orologio: refresh ogni minuto
	_refresh_timer = Timer.new()
	_refresh_timer.wait_time = 60.0
	_refresh_timer.timeout.connect(func() -> void:
		if UsageRangeBar.to_ts == 0.0:
			_request(true))
	add_child(_refresh_timer)
	_refresh_timer.start()

	# la cache del bus evita il buco visivo alla riapertura del pannello
	if data_state != SimBadge.DataState.UNAVAILABLE \
			and not BackendBus.usage_history.is_empty():
		_data = BackendBus.usage_history
		_render()
	if data_state != SimBadge.DataState.UNAVAILABLE:
		_request()


func _on_connection_changed(_state: int, _detail: String) -> void:
	_apply_provenance(SimBadge.current_state(), true)


func _on_positions_provenance_changed(_positions: Array) -> void:
	var state := SimBadge.current_state()
	if _last_data_state != int(state):
		_apply_provenance(state, true)


func _apply_provenance(state: int, request_on_live: bool) -> void:
	var previous := _last_data_state
	if previous != int(state):
		_provenance_generation += 1
	_last_data_state = int(state)
	_provenance_note.visible = state != SimBadge.DataState.LIVE
	_provenance_note.text = UIStrings.t("usage.showroom") \
			if state == SimBadge.DataState.DEMO \
			else UIStrings.t("common.connect_team")
	_provenance_note.add_theme_color_override("font_color",
			Palette.YELLOW if state == SimBadge.DataState.DEMO else Palette.DIM)
	if state == SimBadge.DataState.UNAVAILABLE:
		_clear_usage()
	if request_on_live and previous == int(SimBadge.DataState.UNAVAILABLE) \
			and state != SimBadge.DataState.UNAVAILABLE:
		_request()


func _clear_usage() -> void:
	_data = {}
	_pending_query = {}
	if is_instance_valid(_status):
		_status.text = ""
	if is_instance_valid(_veil):
		_veil.done()
		_veil = null
	if not is_instance_valid(_main_chart):
		return
	var w := UsageRangeBar.window()
	for chart in [_main_chart, _mini_velocity, _mini_tokens, _mini_throttle]:
		chart.set_series([], w[0], w[1])

func _mini(parent: Control) -> UsageChart:
	var c := UsageChart.new()
	c.custom_minimum_size = Vector2(220, 150)
	parent.add_child(c)
	return c

func _restyle_groups() -> void:
	for key in _group_buttons:
		_group_buttons[key].add_theme_color_override("font_color",
				Palette.GREEN if key == group_key else Palette.MUTED)

## silent = refresh periodico in live: niente velo sopra il grafico,
## i dati nuovi subentrano e basta. Ogni azione dell'utente invece
## copre il grafico finché lo storico non arriva.
func _request(silent := false) -> void:
	if SimBadge.current_state() == SimBadge.DataState.UNAVAILABLE:
		return
	var w := UsageRangeBar.window()
	_request_serial += 1
	var request_id := "%s:%d:%d" % [get_instance_id(),
			_provenance_generation, _request_serial]
	_pending_query = {"from_ts": w[0], "to_ts": w[1],
			"bucket_sec": UsageRangeBar.bucket_seconds(),
			"request_id": request_id}
	_status.text = ""
	if not silent and not is_instance_valid(_veil):
		_veil = UsageLoadingVeil.cover(_main_chart)
	BackendBus.request_usage_history(w[0], w[1], UsageRangeBar.bucket_seconds(),
			request_id)

func _on_history(query: Dictionary, data: Dictionary) -> void:
	if not is_instance_valid(self) or not is_inside_tree():
		return
	# Una risposta senza il token dell'ultima richiesta di QUESTA istanza, o
	# arrivata dopo il passaggio a UNAVAILABLE, non puo' ripopolare i grafici.
	if SimBadge.current_state() == SimBadge.DataState.UNAVAILABLE \
			or _pending_query.is_empty() \
			or str(query.get("request_id", "")) != str(_pending_query["request_id"]) \
			or int(query.get("bucket_sec", 0)) != int(_pending_query["bucket_sec"]) \
			or float(query.get("from_ts", 0.0)) != float(_pending_query["from_ts"]) \
			or float(query.get("to_ts", 0.0)) != float(_pending_query["to_ts"]):
		return
	if is_instance_valid(_veil):
		_veil.done()
	if not bool(data.get("ok", false)):
		_status.text = UIStrings.t("usage.error") % str(data.get("error", "?"))
		_status.add_theme_color_override("font_color", Palette.RED)
		return
	_data = data
	_pending_query = {}
	_status.text = ""
	_render()

## sentinel/meter → [[t, v], …] per la chiave voluta.
static func _pluck(rows: Array, key: String) -> Array:
	var out: Array = []
	for r in rows:
		out.append([float(r.get("t", 0)), float(r.get(key, 0))])
	return out

func _render() -> void:
	var w := UsageRangeBar.window()
	var sentinel: Array = _data.get("sentinel", [])
	var meter: Array = _data.get("meter", [])
	var main_series: Array = []
	match group_key:
		"velocity":
			_main_chart.value_suffix = "%/h"
			# due serie: la reale e l'ideale del pacing — la legenda
			# cliccabile è l'interruttore per accenderle/spegnerle
			main_series = [{"key": "velocity",
					"label": UIStrings.t("usage.series_velocity"),
					"color": Palette.ORANGE,
					"points": _pluck(sentinel, "velocity")},
				{"key": "velocity_ideal",
					"label": UIStrings.t("usage.series_velocity_ideal"),
					"color": Palette.MINT,
					"points": _pluck(sentinel, "velocity_ideal")}]
		"tokens":
			_main_chart.value_suffix = "kt"
			main_series = [{"key": "weighted_kt",
					"label": UIStrings.t("usage.series_weighted"),
					"color": Palette.YELLOW,
					"points": _pluck(meter, "weighted_kt")}]
		"events":
			_main_chart.value_suffix = ""
			main_series = [{"key": "events",
					"label": UIStrings.t("usage.series_events"),
					"color": Palette.MINT,
					"points": _pluck(meter, "events")}]
		_:
			_main_chart.value_suffix = "%"
			main_series = [
				{"key": "usage", "label": UIStrings.t("usage.series_usage"),
						"color": Palette.GREEN, "points": _pluck(sentinel, "usage")},
				{"key": "weekly", "label": UIStrings.t("usage.series_weekly"),
						"color": Palette.BLUE, "points": _pluck(sentinel, "weekly")},
				{"key": "projection", "label": UIStrings.t("usage.series_projection"),
						"color": Palette.PURPLE, "points": _pluck(sentinel, "projection")},
			]
	_main_chart.set_series(main_series, w[0], w[1])

	_mini_velocity.value_suffix = "%/h"
	_mini_velocity.set_series([{"key": "velocity",
			"label": UIStrings.t("usage.series_velocity"),
			"color": Palette.ORANGE,
			"points": _pluck(sentinel, "velocity")},
		{"key": "velocity_ideal",
			"label": UIStrings.t("usage.series_velocity_ideal"),
			"color": Palette.MINT,
			"points": _pluck(sentinel, "velocity_ideal")}], w[0], w[1])
	_mini_tokens.value_suffix = "kt"
	_mini_tokens.set_series([{"key": "weighted_kt",
			"label": UIStrings.t("usage.series_weighted"),
			"color": Palette.YELLOW,
			"points": _pluck(meter, "weighted_kt")}], w[0], w[1])
	_mini_throttle.value_suffix = "s"
	_mini_throttle.set_series([{"key": "throttle_s",
			"label": UIStrings.t("usage.series_throttle"),
			"color": Palette.RED,
			"points": _pluck(_data.get("throttle", []), "throttle_s")}], w[0], w[1])

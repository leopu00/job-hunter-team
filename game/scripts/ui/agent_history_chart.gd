class_name AgentHistoryChart
extends VBoxContainer
## Il grafico storico della scheda agente: UN solo piano temporale (X)
## e tante serie eterogenee in multi-asse (ognuna scala sul proprio
## massimo): token, quota finestra 5h, quota weekly, consumo del giorno
## (cumulato dalla weekly), throttle, azioni sul jobs.db, cpu/ram del
## container come contesto. La legenda cliccabile accende/spegne ogni
## serie — tutte, una sola o in coppia, come preferisce l'utente.
##
## Si autogestisce: fetch on-demand via BackendBus.request_agent_history
## con cache statica per ruolo+finestra, così i rebuild della pagina
## (refresh live del bus, ~60s) non rifanno un giro SSH da 10s.

const SERIES_DEFS := [
	{"key": "tokens_kt", "label_key": "agent.hs_tokens",
		"color": Palette.GREEN, "suffix": "kt"},
	{"key": "pct_5h", "label_key": "agent.hs_pct5h",
		"color": Palette.PURPLE, "suffix": "%"},
	{"key": "pct_weekly", "label_key": "agent.hs_pctweek",
		"color": Palette.BLUE, "suffix": "%"},
	{"key": "day_cum", "label_key": "agent.hs_day",
		"color": Palette.MINT, "suffix": "%"},
	{"key": "throttle_s", "label_key": "agent.hs_throttle",
		"color": Palette.RED, "suffix": "s"},
	{"key": "db_actions", "label_key": "agent.hs_db",
		"color": Palette.YELLOW, "suffix": "az"},
	{"key": "cpu_agent_pct", "label_key": "agent.hs_cpu_agent",
		"color": Palette.ORANGE, "suffix": "%"},
	{"key": "ram_agent_mb", "label_key": "agent.hs_ram_agent",
		"color": Color("#e879f9"), "suffix": "MB"},
	{"key": "cpu_pct", "label_key": "agent.hs_cpu",
		"color": Color("#8a6a3a"), "suffix": "%"},
	{"key": "ram_pct", "label_key": "agent.hs_ram",
		"color": Palette.BASE, "suffix": "%"},
]
## Serie accese di default: le tre che Leone guarda per prime.
const DEFAULT_ON := ["tokens_kt", "pct_5h", "pct_weekly"]

## Cache condivisa {chiave: {data, at}} — sopravvive ai rebuild della
## pagina, si invalida da sola dopo CACHE_SECS.
static var _cache := {}
const CACHE_SECS := 120.0

var role := ""
var _range_bar: UsageRangeBar
var _chart: UsageChart
var _status: Label
var _veil: UsageLoadingVeil
var _data: Dictionary = {}
var _pending_key := ""

func _init(p_role: String) -> void:
	role = p_role

func _ready() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 8)
	BackendBus.agent_history_updated.connect(_on_history)

	add_child(TerminalTheme.label(UIStrings.t("agent.history_title"),
			16, Palette.BRIGHT, "bold"))
	add_child(TerminalTheme.label(UIStrings.t("agent.history_hint"),
			12, Palette.DIM))
	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation", 14)
	add_child(controls)
	_range_bar = UsageRangeBar.new()
	_range_bar.range_changed.connect(func() -> void: _request())
	_range_bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	controls.add_child(_range_bar)
	for spec in [["agent.history_all", false], ["agent.history_none", true]]:
		var btn := Button.new()
		btn.flat = true
		btn.text = UIStrings.t(spec[0])
		btn.add_theme_font_size_override("font_size", 12)
		btn.add_theme_color_override("font_color", Palette.MUTED)
		btn.add_theme_color_override("font_hover_color", Palette.MINT)
		btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var mute_all: bool = spec[1]
		btn.pressed.connect(func() -> void:
			for d in SERIES_DEFS:
				_chart.set_muted(d["key"], mute_all)
			_chart.queue_redraw())
		controls.add_child(btn)
	_status = TerminalTheme.label("", 13, Palette.DIM)
	controls.add_child(_status)

	_chart = UsageChart.new()
	_chart.multi_axis = true
	_chart.custom_minimum_size = Vector2(520, 320)
	add_child(_chart)
	for d in SERIES_DEFS:
		if not DEFAULT_ON.has(d["key"]):
			_chart.set_muted(d["key"], true)
	add_child(TerminalTheme.label(UIStrings.t("agent.history_ctx_note"),
			12, Palette.DIM))
	_request()

func _cache_key() -> String:
	var w := UsageRangeBar.window()
	# la finestra live scorre col tempo: la chiave quantizza a minuto,
	# così i rebuild ravvicinati riusano la stessa entry
	return "%s|%d|%d|%d" % [role, int(w[0] / 60.0), int(w[1] / 60.0),
			UsageRangeBar.bucket_seconds()]

func _request() -> void:
	var key := _cache_key()
	_pending_key = key
	var hit: Dictionary = _cache.get(key, {})
	if not hit.is_empty() and Time.get_unix_time_from_system() \
			- float(hit["at"]) < CACHE_SECS:
		_data = hit["data"]
		_render()
		return
	_status.text = ""
	if not is_instance_valid(_veil):
		_veil = UsageLoadingVeil.cover(_chart)
	var w := UsageRangeBar.window()
	BackendBus.request_agent_history(role, w[0], w[1],
			UsageRangeBar.bucket_seconds())

func _on_history(query: Dictionary, data: Dictionary) -> void:
	if not is_instance_valid(self) or not is_inside_tree():
		return
	if str(query.get("agent", "")) != role:
		return
	if is_instance_valid(_veil):
		_veil.done()
	if not bool(data.get("ok", false)):
		_status.text = UIStrings.t("usage.error") % str(data.get("error", "?"))
		_status.add_theme_color_override("font_color", Palette.RED)
		return
	_cache[_pending_key] = {"data": data,
			"at": Time.get_unix_time_from_system()}
	_data = data
	_status.text = ""
	_render()

## pct_weekly → cumulata del giorno LOCALE: "quanto del budget weekly
## ha bruciato oggi" — azzerata a mezzanotte, come la lettura umana.
static func _day_cumulative(rows: Array) -> Array:
	var out: Array = []
	var tz_off := float(Time.get_time_zone_from_system().get("bias", 0)) * 60.0
	var day := -1
	var cum := 0.0
	for r in rows:
		var t := float(r.get("t", 0))
		var d := int(floorf((t + tz_off) / 86400.0))
		if d != day:
			day = d
			cum = 0.0
		cum += float(r.get("v", 0))
		out.append({"t": t, "v": cum})
	return out

func _render() -> void:
	var w := UsageRangeBar.window()
	var raw: Dictionary = _data.get("series", {})
	var series: Array = []
	for d in SERIES_DEFS:
		var rows: Array = _day_cumulative(raw.get("pct_weekly", [])) \
				if d["key"] == "day_cum" else raw.get(d["key"], [])
		var pts: Array = []
		for r in rows:
			pts.append([float(r.get("t", 0)), float(r.get("v", 0))])
		series.append({"key": d["key"], "label": UIStrings.t(d["label_key"]),
				"color": d["color"], "suffix": d["suffix"], "points": pts})
	_chart.set_series(series, w[0], w[1])

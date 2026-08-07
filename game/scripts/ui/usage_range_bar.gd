class_name UsageRangeBar
extends HBoxContainer
## Barra di navigazione temporale delle finestre di monitoraggio:
## preset di ampiezza (5H default … 30G), frecce ◀ ▶ per scorrere di
## una finestra intera, ANCORA A ORA e etichetta del range visibile.
## Lo stato è STATICO e condiviso: le due finestre (Usage e Consumi
## agenti) guardano sempre lo stesso periodo, come chiesto da Leone
## ("torno indietro e vedo cos'era ieri / la settimana scorsa").

signal range_changed

## [etichetta, ampiezza s, bucket s] — bucket scelti per ~60-180 punti
## a finestra: leggibili e leggeri sia in SSH sia in resa.
const SPANS := [
	["5H", 18000.0, 300],
	["12H", 43200.0, 600],
	["24H", 86400.0, 900],
	["usage.span_3d", 259200.0, 1800],
	["usage.span_7d", 604800.0, 3600],
	["usage.span_30d", 2592000.0, 14400],
]

static var span_idx := 0       # default: finestra 5 ore
static var to_ts := 0.0        # 0 = ancorata a ORA (segue l'orologio)

var _span_buttons: Array = []
var _range_lbl: Label
var _now_btn: Button

func _init() -> void:
	add_theme_constant_override("separation", 8)

func _ready() -> void:
	for i in SPANS.size():
		var raw_label := str(SPANS[i][0])
		var btn := _pill(UIStrings.t(raw_label) if raw_label.begins_with("usage.") \
				else raw_label)
		var idx := i
		btn.pressed.connect(func() -> void:
			span_idx = idx
			_emit())
		add_child(btn)
		_span_buttons.append(btn)
	add_child(_spacer(18))
	var back := _pill("◀")
	back.tooltip_text = UIStrings.t("usage.previous_window")
	back.pressed.connect(func() -> void:
		to_ts = _resolved_to() - span_seconds()
		_emit())
	add_child(back)
	var fwd := _pill("▶")
	fwd.tooltip_text = UIStrings.t("usage.next_window")
	fwd.pressed.connect(func() -> void:
		if to_ts == 0.0:
			return
		to_ts += span_seconds()
		# oltre l'adesso si riaggancia a ORA e torna a seguire l'orologio
		if to_ts >= Time.get_unix_time_from_system() - 60.0:
			to_ts = 0.0
		_emit())
	add_child(fwd)
	_now_btn = _pill(UIStrings.t("usage.to_now"))
	_now_btn.pressed.connect(func() -> void:
		to_ts = 0.0
		_emit())
	add_child(_now_btn)
	add_child(_spacer(18))
	_range_lbl = TerminalTheme.label("", 13, Palette.MUTED)
	_range_lbl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	add_child(_range_lbl)
	_restyle()

static func span_seconds() -> float:
	return float(SPANS[span_idx][1])

static func bucket_seconds() -> int:
	return int(SPANS[span_idx][2])

static func _resolved_to() -> float:
	return Time.get_unix_time_from_system() if to_ts == 0.0 else to_ts

## Range corrente [from, to] in unix UTC.
static func window() -> Array:
	var to := _resolved_to()
	return [to - span_seconds(), to]

func _emit() -> void:
	_restyle()
	range_changed.emit()

func _restyle() -> void:
	for i in _span_buttons.size():
		var active: bool = i == span_idx
		_span_buttons[i].add_theme_color_override("font_color",
				Palette.GREEN if active else Palette.MUTED)
	if is_instance_valid(_now_btn):
		_now_btn.add_theme_color_override("font_color",
				Palette.GREEN if to_ts == 0.0 else Palette.MUTED)
	if is_instance_valid(_range_lbl):
		var w := window()
		_range_lbl.text = "%s → %s" % [_fmt(w[0]), _fmt(w[1])] \
				+ ("  · live" if to_ts == 0.0 else "")

static func _fmt(ts: float) -> String:
	var off := float(Time.get_time_zone_from_system().get("bias", 0)) * 60.0
	var d := Time.get_datetime_dict_from_unix_time(int(ts + off))
	return "%02d/%02d %02d:%02d" % [d["day"], d["month"], d["hour"], d["minute"]]

func _pill(text: String) -> Button:
	var btn := Button.new()
	btn.flat = true
	btn.text = text
	btn.add_theme_font_size_override("font_size", 13)
	btn.add_theme_color_override("font_color", Palette.MUTED)
	btn.add_theme_color_override("font_hover_color", Palette.MINT)
	btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	return btn

static func _spacer(w: float) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(w, 0)
	return c

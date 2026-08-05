class_name AgentStateTag
extends Node2D
## Indicatore persistente dello stato reale proveniente dal backend.
## Deve essere sempre esplicito: senza tag un agente working sembrava avere
## uno stato sconosciuto, mentre attesa/pausa/throttle erano leggibili.

## Soglia calibrata sui vitals REALI (VPS Leone, 21/07, ~36k campioni):
## la TUI a riposo sta sotto il 3,2% (p85, spinner e redraw), il lavoro
## vero sopra il 15% (p90=24). 8% è il centro della valle: niente
## lampeggio da agente fermo, nessun lavoro perso.
const CPU_ACTIVE_THRESHOLD := 8.0
const LED_BLINK_PERIOD := 0.9
const LED_ON_TIME := 0.45

var _status := "working"
var _seconds := 0.0
var _detail := ""
var _font: Font
var _shown_second := -1
var _message := ""
var _message_seconds := 0.0
var _suppressed := false
var _cpu_pct := 0.0
var _cpu_known := false
var _led_phase := 0.0

func _ready() -> void:
	z_index = 52
	_font = ThemeDB.fallback_font
	visible = true
	# Lo stato dell'agente è l'informazione più letta dell'ufficio: si
	# rasterizza a risoluzione piena anche quando il mondo è a scala ridotta.
	WorldText.mark(self)

func set_state(status: String, seconds: float, detail := "") -> void:
	_status = status
	_seconds = maxf(0.0, seconds)
	_shown_second = int(ceil(_seconds))
	_detail = detail
	visible = not _suppressed
	queue_redraw()

func set_suppressed(on: bool) -> void:
	_suppressed = on
	visible = not on

## Il LED non interpreta lo stato tmux: segue esclusivamente il sampler CPU.
## Soglia strettamente maggiore di CPU_ACTIVE_THRESHOLD.
func set_cpu_activity(cpu_pct: float, known := true) -> void:
	var was_active := cpu_led_active()
	_cpu_pct = maxf(0.0, cpu_pct)
	_cpu_known = known
	if cpu_led_active() and not was_active:
		_led_phase = 0.0
	elif not cpu_led_active():
		_led_phase = 0.0
	queue_redraw()

func cpu_led_active() -> bool:
	return _cpu_known and _cpu_pct > CPU_ACTIVE_THRESHOLD

func _cpu_led_lit() -> bool:
	return cpu_led_active() and _led_phase < LED_ON_TIME

## Riusa la stessa targa dello stato per un evento breve ricevuto da un altro
## agente: nessun secondo rettangolo sovrapposto a volto o vignetta.
func show_message(text: String, seconds := 6.0) -> void:
	_message = text.strip_edges().to_upper()
	_message_seconds = maxf(0.0, seconds)
	queue_redraw()

func _process(delta: float) -> void:
	if cpu_led_active():
		_led_phase = fmod(_led_phase + delta, LED_BLINK_PERIOD)
		queue_redraw()
	if _message_seconds > 0.0:
		_message_seconds = maxf(0.0, _message_seconds - delta)
		if _message_seconds <= 0.0:
			_message = ""
			queue_redraw()
	if _status != "throttled" or _seconds <= 0.0:
		return
	_seconds = maxf(0.0, _seconds - delta)
	var second := int(ceil(_seconds))
	if second != _shown_second:
		_shown_second = second
		queue_redraw()

func _label() -> String:
	if _message_seconds > 0.0 and not _message.is_empty():
		return _message
	match _status:
		"working":
			return UIStrings.t("dept.agent_status.working")
		"throttled":
			var total := int(ceil(_seconds))
			return "THROTTLED  %d:%02d" % [total / 60, total % 60]
		"paused":
			return UIStrings.t("dept.agent_status.paused")
		"resting":
			return UIStrings.t("dept.agent_status.resting")
		_:
			return UIStrings.t("dept.agent_status.waiting")

func _color() -> Color:
	if _message_seconds > 0.0 and not _message.is_empty():
		return Palette.MINT
	match _status:
		"working": return Color("#58e68b")
		"throttled": return Color("#f5c518")
		"paused": return Color("#ff7a65")
		"resting": return Color("#a855f7")
		_: return Color("#7a7a96")

## La scala di rendering del mondo è cambiata: la targa si ridisegna alla nuova
## misura (WorldText.boost). Nient'altro da ricalcolare, le quote stanno tutte
## nel _draw.
func refresh_world_text() -> void:
	queue_redraw()

func debug_label() -> String:
	return _label()

## Misure effettive dell'ultima targa disegnata: servono al selftest per
## verificare che il testo cresca col profilo ridotto e che il riquadro lo
## contenga sempre.
func debug_metrics() -> Dictionary:
	var k := WorldText.boost()
	var fs := _font_size(k)
	var text_w: float = _font.get_string_size(_label(), HORIZONTAL_ALIGNMENT_LEFT,
			-1, fs).x if _font != null else 0.0
	return {"font_size": fs, "box_width": text_w + 24.0 * k,
			"text_width": text_w, "boost": k}

func debug_suppressed() -> bool:
	return _suppressed

func debug_cpu_led() -> Dictionary:
	return {"cpu_pct": _cpu_pct, "known": _cpu_known,
			"threshold": CPU_ACTIVE_THRESHOLD, "active": cpu_led_active(),
			"lit": _cpu_led_lit(), "phase": _led_phase}

## Corpo del testo: la compensazione della scala del mondo (WorldText) si somma
## al boost degli schermi piccoli — sono due cause diverse dello stesso rischio,
## un testo troppo piccolo per essere letto.
func _font_size(boost: float) -> int:
	return int(round(11 * TerminalTheme.text_boost() * boost))

func _draw() -> void:
	if not visible or _font == null:
		return
	var text := _label()
	var col := _color()
	# La targa cresce TUTTA insieme — font, riquadro, LED, spessori — altrimenti
	# col profilo ridotto il testo uscirebbe dal suo rettangolo.
	var k := WorldText.boost()
	var fs := _font_size(k)
	var text_size := _font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
	var size := Vector2(text_size.x + 24.0 * k, 24.0 * k)
	var r := Rect2(Vector2(-size.x / 2.0, -size.y / 2.0), size)
	draw_rect(r, Color(Palette.CARD.r, Palette.CARD.g, Palette.CARD.b, 0.96), true)
	draw_rect(r, Color(col.r, col.g, col.b, 0.85), false, 1.4 * k)
	var led_pos := Vector2(r.position.x + 9.0 * k, 0.0)
	# Base spenta sempre presente. Il verde compare e pulsa soltanto quando
	# l'ultimo campione CPU fresco supera davvero la soglia di lavoro.
	draw_circle(led_pos, 3.0 * k, Palette.BORDER)
	if cpu_led_active():
		var alpha := 1.0 if _cpu_led_lit() else 0.16
		draw_circle(led_pos, 2.8 * k,
				Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, alpha))
	else:
		draw_arc(led_pos, 2.7 * k, 0.0, TAU, 12,
				Color(Palette.DIM.r, Palette.DIM.g, Palette.DIM.b, 0.8), 0.8 * k)
	draw_string(_font, Vector2(r.position.x + 16.0 * k, 4.0 * k), text,
			HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Palette.WHITE)

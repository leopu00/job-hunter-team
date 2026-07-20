class_name AgentStateTag
extends Node2D
## Indicatore persistente dello stato reale proveniente dal backend.
## Deve essere sempre esplicito: senza tag un agente working sembrava avere
## uno stato sconosciuto, mentre attesa/pausa/throttle erano leggibili.

var _status := "working"
var _seconds := 0.0
var _detail := ""
var _font: Font
var _shown_second := -1
var _message := ""
var _message_seconds := 0.0
var _suppressed := false

func _ready() -> void:
	z_index = 52
	_font = ThemeDB.fallback_font
	visible = true

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

## Riusa la stessa targa dello stato per un evento breve ricevuto da un altro
## agente: nessun secondo rettangolo sovrapposto a volto o vignetta.
func show_message(text: String, seconds := 6.0) -> void:
	_message = text.strip_edges().to_upper()
	_message_seconds = maxf(0.0, seconds)
	queue_redraw()

func _process(delta: float) -> void:
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
			return "AL LAVORO"
		"throttled":
			var total := int(ceil(_seconds))
			return "THROTTLE  %d:%02d" % [total / 60, total % 60]
		"paused":
			return "IN PAUSA"
		"resting":
			return "RIPOSO"
		_:
			return "IN ATTESA"

func _color() -> Color:
	if _message_seconds > 0.0 and not _message.is_empty():
		return Palette.MINT
	match _status:
		"working": return Color("#58e68b")
		"throttled": return Color("#f5c518")
		"paused": return Color("#ff7a65")
		"resting": return Color("#a855f7")
		_: return Color("#7a7a96")

func debug_label() -> String:
	return _label()

func debug_suppressed() -> bool:
	return _suppressed

func _draw() -> void:
	if not visible or _font == null:
		return
	var text := _label()
	var col := _color()
	var fs := 11
	var text_size := _font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
	var size := Vector2(text_size.x + 24.0, 24.0)
	var r := Rect2(Vector2(-size.x / 2.0, -size.y / 2.0), size)
	draw_rect(r, Color(0.035, 0.035, 0.055, 0.94), true)
	draw_rect(r, Color(col.r, col.g, col.b, 0.85), false, 1.4)
	draw_circle(Vector2(r.position.x + 9.0, 0.0), 2.8, col)
	draw_string(_font, Vector2(r.position.x + 16.0, 4.0), text,
			HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color("#f0f0fa"))

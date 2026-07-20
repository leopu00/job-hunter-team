class_name PrinterFx
extends Node2D
## La stampante LAVORA quando qualcuno stampa (recensione 1: il lavoro
## si deve vedere): LED verde che lampeggia e un foglio bianco che
## scivola fuori dal cassetto per la durata della sosta dell'agente.
## Solo primitive _draw (gotcha GLES3), trigger da AgentNPC via ping().

static var instance: PrinterFx

const LED := Color(0.15, 0.95, 0.55)
const SHEET := Color(0.97, 0.96, 0.92)

var _rect: Rect2
var _busy := 0.0   # secondi di stampa rimanenti
var _was_busy := false
var _t := 0.0

func _init(printer_rect: Rect2) -> void:
	_rect = printer_rect
	position = printer_rect.get_center()
	z_index = 1
	instance = self

## Un agente ha avviato una stampa: il macchinario si anima per `secs`.
static func ping(secs: float) -> void:
	if instance:
		instance._busy = maxf(instance._busy, secs)
		instance.set_process(true)

func _process(delta: float) -> void:
	_t += delta
	if _busy > 0.0:
		_busy -= delta
		_was_busy = true
		queue_redraw()
	elif _was_busy:
		_was_busy = false
		queue_redraw()  # un ultimo frame per pulire LED e foglio
	else:
		set_process(false)  # a riposo dorme: lo risveglia il prossimo ping

func _draw() -> void:
	if _busy <= 0.0:
		return
	# LED di stato che lampeggia sul fronte del mobile
	var on := fmod(_t, 0.5) < 0.3
	draw_circle(Vector2(_rect.size.x * 0.34, -6), 3.0,
			LED if on else Color(LED, 0.25))
	# il foglio esce a scatti dal cassetto frontale (loop ~1.2s)
	var k := fmod(_t, 1.2) / 1.2
	var h := 16.0 * minf(1.0, k * 1.4)
	draw_rect(Rect2(Vector2(-16, 8 - h), Vector2(32, h)), SHEET)
	draw_rect(Rect2(Vector2(-16, 8 - h), Vector2(32, h)),
			Color(0.55, 0.55, 0.6, 0.8), false, 1.0)

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
	# Stessa baseline del FurnitureNode: il nuovo sprite è verticale e il
	# pannello/slot vivono molto sopra il vecchio blockout rettangolare.
	position = Vector2(printer_rect.get_center().x, printer_rect.end.y)
	z_index = 1
	instance = self

## Un agente ha avviato una stampa: il macchinario si anima per `secs`.
static func ping(secs: float) -> void:
	if instance:
		instance._busy = maxf(instance._busy, secs)

func _process(delta: float) -> void:
	_t += delta
	if _busy > 0.0:
		_busy -= delta
		_was_busy = true
		queue_redraw()
	elif _was_busy:
		_was_busy = false
		queue_redraw()  # un ultimo frame per pulire LED e foglio

func _draw() -> void:
	if _busy <= 0.0:
		return
	var s := _rect.size.x / 150.0
	# LED di stato che lampeggia sul fronte del mobile
	var on := fmod(_t, 0.5) < 0.3
	draw_circle(Vector2(43.0, -126.0) * s, 3.2 * s,
			LED if on else Color(LED, 0.25))
	# Un foglio nuovo cresce dallo slot già illustrato; le pagine statiche
	# rendono la stampante leggibile anche quando l'effetto non è attivo.
	var k := fmod(_t, 1.2) / 1.2
	var h := 24.0 * s * minf(1.0, k * 1.5)
	var sheet := Rect2(Vector2(-28.0 * s, -111.0 * s), Vector2(54.0 * s, h))
	draw_rect(sheet, SHEET)
	draw_rect(sheet,
			Color(0.55, 0.55, 0.6, 0.8), false, 1.0)

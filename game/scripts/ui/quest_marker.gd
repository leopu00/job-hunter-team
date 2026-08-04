class_name QuestMarker
extends Node2D
## Segnale diegetico sopra un NPC dello showroom. È volutamente disegnato
## in codice: resta nitido a ogni zoom e non introduce un altro asset piatto.

var seen := false
var _time := 0.0
var _redraw_acc := 0.0

func _ready() -> void:
	z_index = 40
	queue_redraw()

func _process(delta: float) -> void:
	_time += delta
	# Il galleggiamento è una trasformata (gratis); solo la pulsazione del
	# glow richiede _draw → ridisegno a ~15 Hz, non a ogni frame (uno per
	# NPC showroom: a pieno organico erano 16 ri-tessellazioni a frame).
	position.y = -164.0 + sin(_time * 2.4) * 7.0
	_redraw_acc += delta
	# Nel profilo Prestazioni il marker conserva sagoma e bob, ma non ha un
	# glow pulsante da ritessellare a 15 Hz. Quattro refresh al secondo bastano
	# per il cambio di stato e riducono lavoro CPU/GPU su iGPU vecchie.
	var redraw_period := 0.25 if GfxProfile.low() else 0.066
	if _redraw_acc >= redraw_period:
		_redraw_acc = 0.0
		queue_redraw()

func set_seen(value: bool) -> void:
	seen = value
	queue_redraw()

func _draw() -> void:
	var pulse := 0.75 + sin(_time * 3.6) * 0.18
	var color := Palette.MINT if not seen else Palette.MUTED
	var diamond := PackedVector2Array([
		Vector2(0, -18), Vector2(12, 0), Vector2(0, 18), Vector2(-12, 0),
	])
	if GfxProfile.low():
		# Due primitive invece dei tre glow + corpo + contorno + traversa. Il
		# simbolo resta riconoscibile e cambia colore dopo la presentazione.
		draw_colored_polygon(diamond,
				Color(color.r, color.g, color.b, 0.54 if not seen else 0.30))
		draw_polyline(PackedVector2Array([
			Vector2(0, -18), Vector2(12, 0), Vector2(0, 18),
			Vector2(-12, 0), Vector2(0, -18),
		]), color, 2.0, false)
		return
	var glow := Color(color.r, color.g, color.b, 0.12 + pulse * 0.14)
	for radius in [30.0, 23.0, 17.0]:
		draw_circle(Vector2.ZERO, radius, Color(glow.r, glow.g, glow.b,
				glow.a * (31.0 - radius) / 15.0))
	draw_colored_polygon(diamond, Color(color.r, color.g, color.b, 0.22 + pulse * 0.25))
	draw_polyline(PackedVector2Array([
		Vector2(0, -18), Vector2(12, 0), Vector2(0, 18),
		Vector2(-12, 0), Vector2(0, -18),
	]), color, 2.2, true)
	draw_line(Vector2(-8, 0), Vector2(8, 0), Color(color.r, color.g, color.b, 0.8), 1.0)

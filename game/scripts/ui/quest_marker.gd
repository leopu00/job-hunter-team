class_name QuestMarker
extends Node2D
## Segnale diegetico sopra un NPC dello showroom. È volutamente disegnato
## in codice: resta nitido a ogni zoom e non introduce un altro asset piatto.

var seen := false
var _time := 0.0

func _ready() -> void:
	z_index = 40
	queue_redraw()

func _process(delta: float) -> void:
	_time += delta
	position.y = -164.0 + sin(_time * 2.4) * 7.0
	queue_redraw()

func set_seen(value: bool) -> void:
	seen = value
	queue_redraw()

func _draw() -> void:
	var pulse := 0.75 + sin(_time * 3.6) * 0.18
	var color := Palette.MINT if not seen else Palette.MUTED
	var glow := Color(color.r, color.g, color.b, 0.12 + pulse * 0.14)
	for radius in [30.0, 23.0, 17.0]:
		draw_circle(Vector2.ZERO, radius, Color(glow.r, glow.g, glow.b,
				glow.a * (31.0 - radius) / 15.0))
	var diamond := PackedVector2Array([
		Vector2(0, -18), Vector2(12, 0), Vector2(0, 18), Vector2(-12, 0),
	])
	draw_colored_polygon(diamond, Color(color.r, color.g, color.b, 0.22 + pulse * 0.25))
	draw_polyline(PackedVector2Array([
		Vector2(0, -18), Vector2(12, 0), Vector2(0, 18),
		Vector2(-12, 0), Vector2(0, -18),
	]), color, 2.2, true)
	draw_line(Vector2(-8, 0), Vector2(8, 0), Color(color.r, color.g, color.b, 0.8), 1.0)

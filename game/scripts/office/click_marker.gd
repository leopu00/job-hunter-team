class_name ClickMarker
extends Node2D
## Feedback del click-to-move: anello verde che si contrae e svanisce.

var _ttl := 0.55
var _age := 0.0

func _process(delta: float) -> void:
	_age += delta
	if _age >= _ttl:
		queue_free()
		return
	queue_redraw()

func _draw() -> void:
	var k := _age / _ttl
	var alpha := 1.0 - k
	var r := 22.0 * (1.0 - k * 0.6)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2(1.0, 0.5))
	draw_arc(Vector2.ZERO, r, 0, TAU, 32,
			Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, alpha), 2.0)
	draw_line(Vector2(-6, 0), Vector2(6, 0), Color(Palette.MINT.r, Palette.MINT.g, Palette.MINT.b, alpha), 1.5)
	draw_line(Vector2(0, -6), Vector2(0, 6), Color(Palette.MINT.r, Palette.MINT.g, Palette.MINT.b, alpha), 1.5)

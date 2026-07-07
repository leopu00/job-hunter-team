class_name Hologram
extends Node2D
## L'ologramma verde al centro della box: pedana scura + globo wireframe
## che pulsa e ruota (il "cuore" della ricerca, come in the-box.png).

var _rect: Rect2
var _t := 0.0

func _init(rect: Rect2) -> void:
	_rect = rect
	# origine sul fondo per lo Y-sort
	position = Vector2(rect.get_center().x, rect.end.y)

func _process(delta: float) -> void:
	_t += delta
	queue_redraw()

func _draw() -> void:
	var w := _rect.size.x
	var pedestal_c := Vector2(0, -18)
	# pedana ellittica scura con anello verde
	draw_set_transform(pedestal_c, 0.0, Vector2(1.0, 0.42))
	draw_circle(Vector2.ZERO, w * 0.46, Palette.CARD)
	draw_arc(Vector2.ZERO, w * 0.46, 0, TAU, 48, Palette.BORDER_GLOW, 2.0)
	var pulse := 0.5 + 0.5 * sin(_t * 2.2)
	draw_arc(Vector2.ZERO, w * 0.38, 0, TAU, 48,
			Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, 0.25 + 0.35 * pulse), 3.0)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

	# globo wireframe
	var c := Vector2(0, -18 - w * 0.52)
	var r := w * 0.34
	var g := Palette.GREEN
	var alpha := 0.55 + 0.25 * pulse
	draw_arc(c, r, 0, TAU, 64, Color(g.r, g.g, g.b, alpha), 1.8)
	# paralleli
	for i in [-0.55, 0.0, 0.55]:
		var ry := r * sqrt(1.0 - i * i)
		draw_set_transform(c + Vector2(0, r * i), 0.0, Vector2(1.0, 0.32))
		draw_arc(Vector2.ZERO, ry, 0, TAU, 48, Color(g.r, g.g, g.b, alpha * 0.7), 1.2)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# meridiani rotanti
	for k in 3:
		var phase := fmod(_t * 0.5 + k / 3.0, 1.0)
		var sx: float = abs(cos(phase * PI))
		draw_set_transform(c, 0.0, Vector2(sx * 0.95 + 0.05, 1.0))
		draw_arc(Vector2.ZERO, r, 0, TAU, 48, Color(g.r, g.g, g.b, alpha * 0.5), 1.2)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# bagliore centrale
	draw_circle(c, r * 0.1, Color(Palette.MINT.r, Palette.MINT.g, Palette.MINT.b, 0.5 + 0.3 * pulse))

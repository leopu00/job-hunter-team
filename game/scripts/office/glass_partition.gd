class_name GlassPartition
extends Node2D
## Parete divisoria contemporanea a tutta altezza. Le lastre sono accostate
## senza montanti: rimangono soltanto i binari perimetrali e giunti quasi
## invisibili, come nelle vetrate frameless degli uffici moderni.

const HORIZONTAL_TEX := \
		"res://assets/gen-art/environment/glass_partition_frameless_v2.png"
const WALL_HEIGHT := 172.0

var footprint: Rect2
var horizontal := true

func _init(rect: Rect2) -> void:
	footprint = rect
	horizontal = rect.size.x >= rect.size.y
	position = rect.get_center()

func _ready() -> void:
	if horizontal:
		_build_horizontal()
	else:
		queue_redraw()

func _build_horizontal() -> void:
	if not ResourceLoader.exists(HORIZONTAL_TEX):
		return
	var tex: Texture2D = load(HORIZONTAL_TEX)
	if tex == null:
		return
	var width := footprint.size.x
	var sprite := Sprite2D.new()
	sprite.texture = tex
	sprite.centered = false
	sprite.position = Vector2(-width / 2.0, -WALL_HEIGHT)
	sprite.scale = Vector2(width / tex.get_width(), WALL_HEIGHT / tex.get_height())
	sprite.modulate = Color(0.94, 0.97, 1.0, 0.82)
	add_child(sprite)
	queue_redraw()

func _draw() -> void:
	if horizontal:
		var width := footprint.size.x
		var pane_rect := Rect2(-width * 0.493, -WALL_HEIGHT * 0.94,
				width * 0.986, WALL_HEIGHT * 0.88)
		# Il riempimento è quasi impercettibile: il materiale viene dichiarato
		# soprattutto dai riflessi e dai sottilissimi profili superiore/inferiore.
		draw_rect(pane_rect, Color(0.58, 0.78, 0.92, 0.032))
		var shine := Color(0.92, 0.98, 1.0, 0.12)
		for x_ratio in [-0.34, 0.18]:
			var a := Vector2(width * x_ratio, -WALL_HEIGHT * 0.82)
			draw_line(a, a + Vector2(26, 42), shine, 1.2)
		draw_line(Vector2(-width * 0.49, -2), Vector2(width * 0.49, -2),
				Color(0.40, 0.70, 0.88, 0.18), 1.3)
		return
	# Il tratto in profondità è visto quasi di taglio. Il vecchio parallelogramma
	# lo inclinava artificialmente di 18 px e agli angoli sembrava un vetro
	# deformato. Lo rendiamo come un'unica lastra edge-on perfettamente dritta:
	# una fascia sottilissima continua, senza diagonali o prospettiva finta.
	var half := footprint.size.y / 2.0
	var top_y := -half - WALL_HEIGHT
	var bottom_y := half
	var pane := Rect2(-2.0, top_y, 4.0, bottom_y - top_y)
	draw_rect(pane, Color(0.58, 0.78, 0.92, 0.026))
	# Doppio tratto scuro/ciano come il binario del pannello frontale, ma
	# entrambi condividono la stessa x: nessun lato diverge agli estremi.
	draw_line(Vector2(0, top_y), Vector2(0, bottom_y),
			Color(0.04, 0.06, 0.08, 0.72), 3.0)
	draw_line(Vector2(0, top_y), Vector2(0, bottom_y),
			Color(0.55, 0.80, 0.94, 0.48), 0.9)
	# Riflesso longitudinale, anch'esso diritto.
	draw_line(Vector2(1.5, top_y + WALL_HEIGHT * 0.18),
			Vector2(1.5, bottom_y - WALL_HEIGHT * 0.12),
			Color(0.90, 0.97, 1.0, 0.10), 0.7)

class_name LightPool
extends Sprite2D
## Pozza di luce additiva (ricetta Backbone §3.2 del dossier): gradiente
## radiale screen/add sopra la scena. Poche, dipinte, calde sulle lampade
## e fredda sul neon della box.

static var _shared_tex: GradientTexture2D
static var _shared_mat: CanvasItemMaterial

func _init(pos: Vector2, radius: float, color: Color, alpha: float,
		squash := 0.55) -> void:
	if _shared_tex == null:
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 1))
		g.set_color(1, Color(1, 1, 1, 0))
		var t := GradientTexture2D.new()
		t.gradient = g
		t.fill = GradientTexture2D.FILL_RADIAL
		t.fill_from = Vector2(0.5, 0.5)
		t.fill_to = Vector2(0.5, 0.0)
		t.width = 256
		t.height = 256
		_shared_tex = t
		var m := CanvasItemMaterial.new()
		m.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
		_shared_mat = m
	texture = _shared_tex
	material = _shared_mat
	position = pos
	scale = Vector2(radius * 2.0 / 256.0, radius * 2.0 / 256.0 * squash)
	modulate = Color(color.r, color.g, color.b, alpha)
	# la luce investe TUTTA la scena (mobili e agenti compresi), non solo
	# il pavimento: senza, di notte le pozze sparivano sotto il mondo
	z_index = 30
